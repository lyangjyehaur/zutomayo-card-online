import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = process.cwd();
const sourceRoot = path.join(root, 'src');
const outputRoot = path.join(root, 'public', 'fonts');
const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'zutomayo-display-fonts-'));
const charsetPath = path.join(temporaryRoot, 'ui-charset.txt');
const python = process.env.PYTHON?.trim() || 'python3';

const characters = new Set(Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)));
for (const character of '　，。！？：；「」『』（）【】《》〈〉…—・·％＋－×÷→←↑↓♥★☆') {
  characters.add(character);
}

function isProductionSource(filePath) {
  const relative = path.relative(sourceRoot, filePath);
  return (
    /\.(ts|tsx)$/.test(filePath) &&
    !relative.split(path.sep).includes('__tests__') &&
    !/\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath)
  );
}

function collectSourceFile(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit = (node) => {
    let text = '';
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isJsxText(node)) {
      text = node.text;
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      text = node.text;
    }
    for (const character of text) {
      if (character.codePointAt(0) >= 0x80) characters.add(character);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(filePath);
    } else if (isProductionSource(filePath)) {
      collectSourceFile(filePath);
    }
  }
}

function subsetFont(sourceName, outputName) {
  const sourcePath = path.join(outputRoot, sourceName);
  const outputPath = path.join(outputRoot, outputName);
  const result = spawnSync(
    python,
    [
      '-m',
      'fontTools.subset',
      sourcePath,
      `--text-file=${charsetPath}`,
      '--flavor=woff2',
      `--output-file=${outputPath}`,
      '--layout-features=*',
      '--name-IDs=*',
      '--name-languages=*',
    ],
    { encoding: 'utf8', stdio: 'pipe' },
  );

  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Unable to subset ${sourceName}\n`);
    process.exit(result.status || 1);
  }

  const sourceBytes = statSync(sourcePath).size;
  const outputBytes = statSync(outputPath).size;
  if (outputBytes >= sourceBytes || outputBytes > 600_000) {
    throw new Error(`${outputName} is unexpectedly large (${outputBytes} bytes from ${sourceBytes})`);
  }
  console.log(`${outputName}: ${outputBytes} bytes (${Math.round((outputBytes / sourceBytes) * 100)}% of full font)`);
}

walk(sourceRoot);
writeFileSync(charsetPath, [...characters].sort().join(''));
console.log(`Display-font UI charset: ${characters.size} code points`);

subsetFont('uoq-mun-then-khung-regular.woff2', 'uoq-mun-then-khung-ui-v1.woff2');
subsetFont('jiangcheng-jiexing-v1.3.woff2', 'jiangcheng-jiexing-ui-v1.woff2');
