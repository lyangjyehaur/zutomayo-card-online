import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { t, availableLocales, getLocaleLabel, type Locale } from '../i18n';
import { zhTW } from '../i18n/zh-TW';
import { zhHK } from '../i18n/zh-HK';
import { zhCN } from '../i18n/zh-CN';
import { ja } from '../i18n/ja';
import { en } from '../i18n/en';
import { ko } from '../i18n/ko';
import { ApiError, adminLogin } from '../api/client';
import {
  BackButton,
  Badge,
  Button,
  Dialog,
  FormActions,
  FormField,
  Input,
  PageShell,
  Panel,
  Sheet,
  Textarea,
} from '../components/ui';
import '../components/I18nManager.css';

const ADMIN_TOKEN_KEY = 'zutomayo_admin_token';

const allDictionaries: Record<string, Record<string, string>> = {
  'zh-TW': zhTW as unknown as Record<string, string>,
  'zh-HK': zhHK as unknown as Record<string, string>,
  'zh-CN': zhCN as unknown as Record<string, string>,
  ja: ja as unknown as Record<string, string>,
  en: en as unknown as Record<string, string>,
  ko: ko as unknown as Record<string, string>,
};

const allKeys = Object.keys(zhTW as Record<string, string>);

function useCompactI18nEditing() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsCompact(media.matches);

    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isCompact;
}

export function I18nManager() {
  const navigate = useNavigate();
  const [authenticated, setAuthenticated] = useState(() => Boolean(sessionStorage.getItem(ADMIN_TOKEN_KEY)));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [selectedLocale, setSelectedLocale] = useState<Locale>('zh-TW');
  const [filterMissing, setFilterMissing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saveNotice, setSaveNotice] = useState('');
  const useSheetEdit = useCompactI18nEditing();

  const filteredKeys = useMemo(() => {
    const dict = allDictionaries[selectedLocale] || {};
    let keys = allKeys;
    if (filterMissing) {
      keys = keys.filter((k) => !dict[k] || dict[k].trim() === '');
    }
    if (searchText) {
      const q = searchText.toLowerCase();
      keys = keys.filter(
        (k) =>
          k.toLowerCase().includes(q) ||
          (dict[k] || '').toLowerCase().includes(q) ||
          ((zhTW as Record<string, string>)[k] || '').toLowerCase().includes(q),
      );
    }
    return keys;
  }, [selectedLocale, filterMissing, searchText]);

  const handleLogin = useCallback(async () => {
    setError('');
    setLoggingIn(true);
    try {
      const { token } = await adminLogin(password);
      sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
      setAuthenticated(true);
      setPassword('');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('admin.loginFailed');
      setError(msg === 'Invalid password' ? t('admin.passwordError') : msg);
    } finally {
      setLoggingIn(false);
    }
  }, [password]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    setAuthenticated(false);
  }, []);

  const startEdit = useCallback((key: string, value: string) => {
    setEditKey(key);
    setEditValue(value);
  }, []);

  const closeEdit = useCallback(() => {
    setEditKey(null);
    setEditValue('');
  }, []);

  if (!authenticated) {
    return (
      <PageShell variant="scroll" className="admin-page i18n-page flex flex-col px-4 py-4 md:px-6">
        <header className="i18n-header flex items-center justify-between border-b border-bone/5 pb-4">
          <BackButton onClick={() => navigate('/')}>{t('common.backToLobby')}</BackButton>
          <h1 className="i18n-heading font-display text-3xl italic text-gold">{t('admin.i18nTitle')}</h1>
          <div />
        </header>
        <Panel className="admin-login mx-auto mt-6 w-full max-w-md" size="lg">
          <h2 className="font-display text-xl italic">{t('admin.adminVerify')}</h2>
          <Input
            type="password"
            placeholder={t('admin.passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !loggingIn) void handleLogin();
            }}
            disabled={loggingIn}
          />
          <Button size="sm" onClick={() => void handleLogin()} disabled={loggingIn || !password}>
            {loggingIn ? t('admin.verifying') : t('admin.login')}
          </Button>
          {error && (
            <Panel className="border-l-2 border-vermilion/50 bg-vermilion/10 text-xs text-vermilion/80" role="alert">
              {error}
            </Panel>
          )}
        </Panel>
      </PageShell>
    );
  }

  const dict = allDictionaries[selectedLocale] || {};

  const missingCount = allKeys.filter((k) => !dict[k] || dict[k].trim() === '').length;

  const handleSaveEdit = () => {
    if (editKey && editValue.trim()) {
      setSaveNotice(
        `${t('admin.i18nSaved')}: ${editKey}\n${t('admin.i18nNewValue')}: ${editValue}\n\n${t('admin.i18nSaveNotice')}src/i18n/${selectedLocale}.ts`,
      );
      closeEdit();
    }
  };

  const activeEditBaseValue = editKey ? ((zhTW as Record<string, string>)[editKey] ?? '') : '';

  return (
    <PageShell variant="workspace" className="admin-page i18n-page flex flex-col px-4 py-4 md:px-6">
      <header className="i18n-header flex items-center justify-between border-b border-bone/5 pb-4">
        <BackButton onClick={() => navigate('/')}>{t('common.backToLobby')}</BackButton>
        <h1 className="i18n-heading font-display text-3xl italic text-gold">{t('admin.i18nTitle')}</h1>
        <Button size="sm" variant="secondary" onClick={handleLogout}>
          {t('admin.logout')}
        </Button>
      </header>

      <div className="i18n-controls">
        <div className="i18n-locale-tabs">
          {availableLocales.map((locale) => (
            <Button
              key={locale}
              size="sm"
              variant={selectedLocale === locale ? 'primary' : 'ghost'}
              onClick={() => setSelectedLocale(locale)}
            >
              {getLocaleLabel(locale)}
            </Button>
          ))}
        </div>

        <div className="i18n-stats">
          <span>
            {t('admin.i18nTotalKeys')}: {allKeys.length}
          </span>
          <span className={missingCount > 0 ? 'stat-warn' : 'stat-ok'}>
            {t('admin.i18nMissing')}: {missingCount}
          </span>
          <span>
            {t('admin.i18nTranslated')}: {allKeys.length - missingCount}
          </span>
        </div>

        <div className="i18n-filters">
          <Input
            type="text"
            placeholder={t('admin.i18nSearchPlaceholder')}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="i18n-search"
          />
          <label className="i18n-checkbox">
            <input type="checkbox" checked={filterMissing} onChange={(e) => setFilterMissing(e.target.checked)} />
            {t('admin.i18nFilterMissing')}
          </label>
        </div>
      </div>

      <div className="i18n-table-wrapper">
        <table className="i18n-table i18n-responsive-table w-full border-collapse text-left text-sm">
          <thead className="font-mono text-[10px] uppercase tracking-[0.3em] text-bone/40">
            <tr className="border-b border-bone/10">
              <th className="px-3 py-2">{t('admin.i18nColKey')}</th>
              <th className="px-3 py-2">{t('admin.i18nColBase')}</th>
              <th className="px-3 py-2">{getLocaleLabel(selectedLocale)}</th>
              <th className="px-3 py-2">{t('admin.i18nColStatus')}</th>
            </tr>
          </thead>
          <tbody>
            {filteredKeys.map((key) => {
              const baseValue = (zhTW as Record<string, string>)[key] || '';
              const translated = dict[key] || '';
              const isMissing = !translated || translated.trim() === '';
              const isSame = translated === baseValue && selectedLocale !== 'zh-TW';

              return (
                <tr key={key} className={isMissing ? 'row-missing' : isSame ? 'row-same' : ''}>
                  <td data-label={t('admin.i18nColKey')} className="i18n-key px-3 py-2">
                    {key}
                  </td>
                  <td data-label={t('admin.i18nColBase')} className="i18n-base px-3 py-2">
                    {baseValue}
                  </td>
                  <td
                    data-label={getLocaleLabel(selectedLocale)}
                    className="i18n-translated px-3 py-2"
                    role={!isMissing ? 'button' : undefined}
                    tabIndex={!isMissing ? 0 : undefined}
                    onClick={() => {
                      if (!isMissing) {
                        startEdit(key, translated);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (!isMissing && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        startEdit(key, translated);
                      }
                    }}
                  >
                    {editKey === key && !useSheetEdit ? (
                      <div className="i18n-edit">
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                          }}
                          autoFocus
                        />
                        <Button size="sm" onClick={handleSaveEdit}>
                          {t('common.save')}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={closeEdit}>
                          {t('common.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <span className={isMissing ? 'text-missing' : ''}>
                        {isMissing ? t('admin.i18nMissingBadge') : translated}
                      </span>
                    )}
                  </td>
                  <td data-label={t('admin.i18nColStatus')} className="i18n-status px-3 py-2">
                    {isMissing ? (
                      <Badge tone="vermilion">{t('admin.i18nMissingBadge')}</Badge>
                    ) : isSame ? (
                      <Badge tone="gold">{t('admin.i18nColBase')}</Badge>
                    ) : (
                      <Badge tone="jade">{t('admin.i18nTranslated')}</Badge>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Sheet
        open={useSheetEdit && Boolean(editKey)}
        onOpenChange={(open) => !open && closeEdit()}
        title={getLocaleLabel(selectedLocale)}
        description={editKey}
        closeLabel={t('common.close')}
        footer={
          <FormActions className="grid grid-cols-2 gap-2">
            <Button type="button" size="md" variant="secondary" fullWidth className="min-h-11" onClick={closeEdit}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              size="md"
              variant="primary"
              fullWidth
              className="min-h-11"
              onClick={handleSaveEdit}
              disabled={!editValue.trim()}
            >
              {t('common.save')}
            </Button>
          </FormActions>
        }
      >
        <div className="i18n-edit-sheet grid gap-4">
          <FormField label={t('admin.i18nColKey')}>
            <p className="i18n-edit-sheet-key">{editKey}</p>
          </FormField>
          <FormField label={t('admin.i18nColBase')}>
            <p className="i18n-edit-sheet-copy">{activeEditBaseValue}</p>
          </FormField>
          <FormField label={getLocaleLabel(selectedLocale)}>
            <Textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} autoFocus />
          </FormField>
        </div>
      </Sheet>
      <Dialog
        open={Boolean(saveNotice)}
        onOpenChange={(open) => !open && setSaveNotice('')}
        title={t('admin.i18nSaved')}
      >
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-bone/70">{saveNotice}</p>
      </Dialog>
    </PageShell>
  );
}
