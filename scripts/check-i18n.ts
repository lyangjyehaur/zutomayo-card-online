import { en } from '../src/i18n/en';
import { ja } from '../src/i18n/ja';
import { ko } from '../src/i18n/ko';
import { zhCN } from '../src/i18n/zh-CN';
import { zhHK } from '../src/i18n/zh-HK';
import { zhTW } from '../src/i18n/zh-TW';

type LocaleCode = 'en' | 'ja' | 'ko' | 'zh-HK' | 'zh-CN';

const locales: Array<{ code: LocaleCode; label: string; dict: Record<string, string> }> = [
  { code: 'en', label: 'en', dict: en },
  { code: 'ja', label: 'ja', dict: ja },
  { code: 'ko', label: 'ko', dict: ko },
  { code: 'zh-HK', label: 'zh-HK', dict: zhHK },
  { code: 'zh-CN', label: 'zh-CN', dict: zhCN },
];

// zh-HK 與 zh-CN 同為中文變體，值與 zh-TW 相同屬合理，不列為可疑。
const suspiciousCheckLocales = new Set<LocaleCode>(['en', 'ja', 'ko']);

const baseDict: Record<string, string> = zhTW;
const baseKeys = Object.keys(baseDict);

interface LocaleReport {
  missing: string[];
  empty: string[];
  suspicious: Array<{ key: string; value: string }>;
}

function checkLocale(dict: Record<string, string>): LocaleReport {
  const missing: string[] = [];
  const empty: string[] = [];
  const suspicious: Array<{ key: string; value: string }> = [];

  for (const key of baseKeys) {
    if (!(key in dict)) {
      missing.push(key);
      continue;
    }
    const value = dict[key];
    const baseValue = baseDict[key];

    // 基準語言本身為空字串時，其他語言留空屬合理設計，不標為空值。
    if (value === '' && baseValue !== '') {
      empty.push(key);
    }

    // 值與 zh-TW 完全相同且非空，可能是忘記翻譯。
    if (value !== '' && value === baseValue) {
      suspicious.push({ key, value });
    }
  }

  return { missing, empty, suspicious };
}

function printList(items: string[]): void {
  for (const item of items) {
    console.log(`      - ${item}`);
  }
}

console.log('=== i18n 完整性檢查 ===');
console.log(`基準語言: zh-TW (${baseKeys.length} keys)`);

let hasMissing = false;
let hasWarnings = false;

for (const { code, label, dict } of locales) {
  const report = checkLocale(dict);
  const checkSuspicious = suspiciousCheckLocales.has(code);

  console.log('');
  console.log(`[${label}]`);

  if (report.missing.length > 0) {
    hasMissing = true;
    console.log(`  ❌ 缺失 key: ${report.missing.length} 個`);
    printList(report.missing);
  } else {
    console.log('  ✅ 所有 key 都存在');
  }

  if (report.empty.length > 0) {
    hasWarnings = true;
    console.log(`  ⚠️  空值: ${report.empty.length} 個`);
    printList(report.empty);
  }

  if (checkSuspicious && report.suspicious.length > 0) {
    hasWarnings = true;
    console.log(`  ⚠️  可疑未翻譯: ${report.suspicious.length} 個`);
    for (const { key, value } of report.suspicious) {
      console.log(`      - ${key}: "${value}" (與 zh-TW 相同)`);
    }
  }
}

console.log('');

if (hasMissing) {
  console.error('❌ i18n 檢查失敗：有缺失的 key，請補上對應翻譯。');
  process.exit(1);
}

if (hasWarnings) {
  console.log('⚠️  i18n 檢查通過，但有可疑值需人工確認。');
} else {
  console.log('✅ i18n 檢查通過，所有語言完整。');
}

process.exit(0);
