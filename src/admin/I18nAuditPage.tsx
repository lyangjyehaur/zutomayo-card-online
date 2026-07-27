import { useMemo, useState } from 'react';
import { availableLocales, getLocaleLabel, type Locale } from '../i18n';
import { zhTW } from '../i18n/zh-TW';
import { zhHK } from '../i18n/zh-HK';
import { zhCN } from '../i18n/zh-CN';
import { ja } from '../i18n/ja';
import { en } from '../i18n/en';
import { ko } from '../i18n/ko';
import { Badge, Checkbox, DataListCell, DataListTable, Input, SegmentedControl } from '../ui';

const dictionaries: Record<Locale, Record<string, string>> = {
  'zh-TW': zhTW,
  'zh-HK': zhHK,
  'zh-CN': zhCN,
  ja,
  en,
  ko,
} as unknown as Record<Locale, Record<string, string>>;
const keys = Object.keys(zhTW);

export function I18nAuditPage() {
  const [locale, setLocale] = useState<Locale>('en');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const dictionary = dictionaries[locale];
  const rows = useMemo(
    () =>
      keys.filter((key) => {
        const missing = !dictionary[key]?.trim();
        const needle = search.trim().toLocaleLowerCase();
        return (
          (!missingOnly || missing) &&
          (!needle ||
            key.toLocaleLowerCase().includes(needle) ||
            dictionary[key]?.toLocaleLowerCase().includes(needle) ||
            String(zhTW[key as keyof typeof zhTW])
              .toLocaleLowerCase()
              .includes(needle))
        );
      }),
    [dictionary, missingOnly, search],
  );
  const missing = keys.filter((key) => !dictionary[key]?.trim()).length;
  return (
    <section className="admin-resource-page">
      <header className="admin-resource-header">
        <div>
          <h1>介面翻譯稽核</h1>
          <p>檢查程式碼字典的完整度；實際修改仍需進入版本控制並通過 i18n 檢查。</p>
        </div>
        <div className="flex gap-2">
          <Badge>{keys.length} keys</Badge>
          <Badge tone={missing ? 'vermilion' : 'jade'}>{missing} missing</Badge>
        </div>
      </header>
      <div className="mb-4 grid gap-3">
        <SegmentedControl
          behavior="tabs"
          size="sm"
          ariaLabel="語言"
          value={locale}
          onChange={setLocale}
          options={availableLocales.map((value) => ({ value, label: getLocaleLabel(value) }))}
        />
        <div className="flex flex-wrap gap-3">
          <Input
            className="min-w-[16rem] flex-1"
            placeholder="搜尋 key 或譯文"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Checkbox checked={missingOnly} onChange={(event) => setMissingOnly(event.target.checked)}>
            只看缺漏
          </Checkbox>
        </div>
      </div>
      <DataListTable className="admin-responsive-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>繁體中文基準</th>
            <th>{getLocaleLabel(locale)}</th>
            <th>狀態</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((key) => {
            const value = dictionary[key] ?? '';
            return (
              <tr key={key}>
                <DataListCell label="Key" className="font-mono text-xs">
                  {key}
                </DataListCell>
                <DataListCell label="繁體中文基準">{String(zhTW[key as keyof typeof zhTW])}</DataListCell>
                <DataListCell label={getLocaleLabel(locale)}>{value || '—'}</DataListCell>
                <DataListCell label="狀態">
                  <Badge tone={value.trim() ? 'jade' : 'vermilion'}>{value.trim() ? '已翻譯' : '缺漏'}</Badge>
                </DataListCell>
              </tr>
            );
          })}
        </tbody>
      </DataListTable>
    </section>
  );
}
