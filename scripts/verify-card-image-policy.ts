import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const CARD_ORIGIN_PATTERN = /https?:\/\/r2\.dan\.tw\/cards\//i;
const CARD_SOURCE_PATTERN = /(?:zutomayocard_|\/cards\/)/i;
const CARD_IMAGE_EXPRESSION_PATTERN =
  /(?:\b(?:backgroundImage|cardImage|cardImageUrl|imageUrl|originalSource)\b|\.image\b)/i;
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export interface CardImagePolicyViolation {
  file: string;
  line: number;
  message: string;
}

export interface CardImagePolicySummary {
  cardImageCallSites: number;
  cardImageFiles: number;
  directCardImageElements: number;
  originalFallbackExceptions: number;
  nonProductionExceptions: number;
  violations: CardImagePolicyViolation[];
}

function walkSourceFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkSourceFiles(absolute);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [absolute] : [];
  });
}

function jsxTagName(node: ts.JsxOpeningLikeElement, sourceFile: ts.SourceFile): string {
  return node.tagName.getText(sourceFile);
}

function jsxAttribute(node: ts.JsxOpeningLikeElement, name: string): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText() === name,
  );
}

function attributeStringValue(attribute: ts.JsxAttribute | undefined): string | null {
  if (!attribute?.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return null;
  const expression = attribute.initializer.expression;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return null;
}

function attributeIsExplicitFalse(attribute: ts.JsxAttribute): boolean {
  if (!attribute.initializer) return false;
  return (
    ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword
  );
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function allowsCardOriginSource(relativeFile: string): boolean {
  return relativeFile.startsWith('src/data/') || relativeFile.includes('/__tests__/');
}

export function auditCardImagePolicy(rootDir: string): CardImagePolicySummary {
  const sourceRoot = path.join(rootDir, 'src');
  const sourceFiles = walkSourceFiles(sourceRoot);
  const violations: CardImagePolicyViolation[] = [];
  const cardImageFiles = new Set<string>();
  let cardImageCallSites = 0;
  let directCardImageElements = 0;
  let originalFallbackExceptions = 0;

  for (const absoluteFile of sourceFiles) {
    const relativeFile = path.relative(rootDir, absoluteFile).split(path.sep).join('/');
    const isTestFile = relativeFile.includes('/__tests__/');
    const sourceText = fs.readFileSync(absoluteFile, 'utf8');
    const sourceFile = ts.createSourceFile(
      absoluteFile,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      absoluteFile.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    if (CARD_ORIGIN_PATTERN.test(sourceText) && !allowsCardOriginSource(relativeFile)) {
      const index = sourceText.search(CARD_ORIGIN_PATTERN);
      violations.push({
        file: relativeFile,
        line: sourceFile.getLineAndCharacterOfPosition(index).line + 1,
        message: 'raw card origin literals belong in src/data and must be rendered through CardImage',
      });
    }

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tagName = jsxTagName(node, sourceFile);

        if (tagName === 'CardImage' && !isTestFile) {
          cardImageCallSites += 1;
          cardImageFiles.add(relativeFile);
          const fallback = jsxAttribute(node, 'fallbackToOriginal');
          if (fallback && !attributeIsExplicitFalse(fallback)) {
            originalFallbackExceptions += 1;
            const reason = attributeStringValue(jsxAttribute(node, 'originalFallbackReason'))?.trim();
            if (!reason) {
              violations.push({
                file: relativeFile,
                line: lineOf(sourceFile, node),
                message: 'fallbackToOriginal requires a non-empty originalFallbackReason',
              });
            }
          }
        }

        if (tagName === 'img' && !isTestFile && relativeFile !== 'src/components/CardImage.tsx') {
          const src = jsxAttribute(node, 'src');
          const literal = attributeStringValue(src);
          const expression =
            src?.initializer && ts.isJsxExpression(src.initializer) && src.initializer.expression
              ? src.initializer.expression.getText(sourceFile)
              : '';
          if (
            (literal && (CARD_ORIGIN_PATTERN.test(literal) || CARD_SOURCE_PATTERN.test(literal))) ||
            (expression && CARD_IMAGE_EXPRESSION_PATTERN.test(expression))
          ) {
            directCardImageElements += 1;
            violations.push({
              file: relativeFile,
              line: lineOf(sourceFile, node),
              message: 'card artwork must use CardImage instead of a direct img element',
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  const cardImageComponent = fs.readFileSync(path.join(rootDir, 'src/components/CardImage.tsx'), 'utf8');
  if (!/fallbackToOriginal\s*=\s*false/.test(cardImageComponent)) {
    violations.push({
      file: 'src/components/CardImage.tsx',
      line: 1,
      message: 'CardImage must fail closed; fallbackToOriginal must default to false',
    });
  }
  if (!cardImageComponent.includes('data-card-image-delivery="imgproxy"')) {
    violations.push({
      file: 'src/components/CardImage.tsx',
      line: 1,
      message: 'CardImage must expose its imgproxy delivery marker for runtime audits',
    });
  }

  const viteConfig = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');
  if (/urlPattern\s*:\s*\/\^https:\\\/\\\/r2\\\.dan\\\.tw/.test(viteConfig)) {
    violations.push({
      file: 'vite.config.ts',
      line: 1,
      message: 'PWA runtime caching must target /api/imgproxy/, not the raw card origin',
    });
  }

  const platformServer = fs.readFileSync(path.join(rootDir, 'src/server.ts'), 'utf8');
  if (platformServer.includes("'https://r2.dan.tw',")) {
    violations.push({
      file: 'src/server.ts',
      line: 1,
      message: 'player-facing CSP must not allow direct card-origin image delivery',
    });
  }

  const reviewServer = fs.readFileSync(path.join(rootDir, 'scripts/card-official-text-review-server.ts'), 'utf8');
  const nonProductionExceptions = (reviewServer.match(/CARD_IMAGE_POLICY_EXCEPTION:/g) ?? []).length;
  if (nonProductionExceptions !== 1) {
    violations.push({
      file: 'scripts/card-official-text-review-server.ts',
      line: 1,
      message: 'the standalone review-tool exception must remain explicitly documented exactly once',
    });
  }

  return {
    cardImageCallSites,
    cardImageFiles: cardImageFiles.size,
    directCardImageElements,
    originalFallbackExceptions,
    nonProductionExceptions,
    violations,
  };
}

function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const summary = auditCardImagePolicy(rootDir);
  if (summary.violations.length > 0) {
    for (const violation of summary.violations) {
      console.error(`${violation.file}:${violation.line} ${violation.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `card image policy: ${summary.cardImageCallSites} CardImage call sites in ${summary.cardImageFiles} files; ` +
      `${summary.directCardImageElements} direct card <img> elements; ` +
      `${summary.originalFallbackExceptions} player-UI original fallbacks; ` +
      `${summary.nonProductionExceptions} documented non-production exception`,
  );
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
