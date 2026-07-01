export interface AnonymousIdentity {
  baseName: string;
  suffix: string;
}

export const ANONYMOUS_PLAYER_DEFAULT_NAME = 'Player';
export const ANONYMOUS_IDENTITY_STORAGE_KEY = 'zutomayo_anonymous_identity';

let memoryIdentity: AnonymousIdentity | null = null;

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function generateSuffix(): string {
  return Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
}

function normalizeSuffix(value: unknown): string {
  return typeof value === 'string' && /^\d{4}$/.test(value) ? value : generateSuffix();
}

export function sanitizeAnonymousBaseName(value: unknown): string {
  if (typeof value !== 'string') return ANONYMOUS_PLAYER_DEFAULT_NAME;
  const clean = value.slice(0, 30).replace(/[<>#]/g, '').trim();
  return clean || ANONYMOUS_PLAYER_DEFAULT_NAME;
}

function parseIdentity(value: unknown): AnonymousIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<AnonymousIdentity>;
  return {
    baseName: sanitizeAnonymousBaseName(data.baseName),
    suffix: normalizeSuffix(data.suffix),
  };
}

export function saveAnonymousIdentity(identity: AnonymousIdentity): AnonymousIdentity {
  const clean = {
    baseName: sanitizeAnonymousBaseName(identity.baseName),
    suffix: normalizeSuffix(identity.suffix),
  };
  memoryIdentity = clean;
  getStorage()?.setItem(ANONYMOUS_IDENTITY_STORAGE_KEY, JSON.stringify(clean));
  return clean;
}

export function loadAnonymousIdentity(): AnonymousIdentity {
  if (memoryIdentity) return memoryIdentity;
  const storage = getStorage();
  if (storage) {
    try {
      const raw = storage.getItem(ANONYMOUS_IDENTITY_STORAGE_KEY);
      const parsed = raw ? parseIdentity(JSON.parse(raw)) : null;
      if (parsed) return saveAnonymousIdentity(parsed);
    } catch {
      storage.removeItem(ANONYMOUS_IDENTITY_STORAGE_KEY);
    }
  }
  return saveAnonymousIdentity({ baseName: ANONYMOUS_PLAYER_DEFAULT_NAME, suffix: generateSuffix() });
}

export function renameAnonymousIdentity(baseName: string): AnonymousIdentity {
  const current = loadAnonymousIdentity();
  return saveAnonymousIdentity({ ...current, baseName: sanitizeAnonymousBaseName(baseName) });
}

export function formatAnonymousDisplayName(identity = loadAnonymousIdentity()): string {
  return `${identity.baseName}#${identity.suffix}`;
}

export function getRegistrationNickname(): string {
  return loadAnonymousIdentity().baseName;
}

export function resetAnonymousIdentityForTests(): void {
  memoryIdentity = null;
  getStorage()?.removeItem(ANONYMOUS_IDENTITY_STORAGE_KEY);
}
