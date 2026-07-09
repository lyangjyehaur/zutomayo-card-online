import packageJson from '../package.json';

export interface AppVersionInfo {
  appVersion: string;
  buildId: string;
  rulesVersion: string;
}

declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD_ID__: string | undefined;
declare const __APP_BUILT_AT__: string | undefined;
declare const __GAME_RULES_VERSION__: string | undefined;

const PACKAGE_VERSION = packageJson.version;

function definedValue(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readRuntimeEnv(name: string): string | undefined {
  const clientEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const nodeEnv = typeof process === 'undefined' ? undefined : process.env;
  return definedValue(clientEnv?.[`VITE_${name}`]) ?? definedValue(clientEnv?.[name]) ?? definedValue(nodeEnv?.[name]);
}

function readDefinedAppVersion(): string | undefined {
  return typeof __APP_VERSION__ === 'undefined' ? undefined : __APP_VERSION__;
}

function readDefinedBuildId(): string | undefined {
  return typeof __APP_BUILD_ID__ === 'undefined' ? undefined : __APP_BUILD_ID__;
}

function readDefinedBuiltAt(): string | undefined {
  return typeof __APP_BUILT_AT__ === 'undefined' ? undefined : __APP_BUILT_AT__;
}

function readDefinedRulesVersion(): string | undefined {
  return typeof __GAME_RULES_VERSION__ === 'undefined' ? undefined : __GAME_RULES_VERSION__;
}

const definedAppVersion = definedValue(readDefinedAppVersion());

export const APP_BUILT_AT =
  definedValue(readDefinedBuiltAt()) ??
  readRuntimeEnv('APP_BUILT_AT') ??
  readRuntimeEnv('APP_BUILD_TIME') ??
  new Date().toISOString();

export const APP_VERSION_INFO: AppVersionInfo = Object.freeze({
  appVersion: definedAppVersion ?? readRuntimeEnv('APP_VERSION') ?? PACKAGE_VERSION,
  buildId:
    definedValue(readDefinedBuildId()) ??
    readRuntimeEnv('APP_BUILD_ID') ??
    definedAppVersion ??
    readRuntimeEnv('APP_VERSION') ??
    PACKAGE_VERSION,
  rulesVersion:
    definedValue(readDefinedRulesVersion()) ??
    readRuntimeEnv('GAME_RULES_VERSION') ??
    definedAppVersion ??
    readRuntimeEnv('APP_VERSION') ??
    PACKAGE_VERSION,
});

export function normalizeVersionInfo(value: unknown): AppVersionInfo | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Partial<Record<keyof AppVersionInfo, unknown>>;
  if (
    typeof data.appVersion !== 'string' ||
    typeof data.buildId !== 'string' ||
    typeof data.rulesVersion !== 'string'
  ) {
    return null;
  }
  return {
    appVersion: data.appVersion,
    buildId: data.buildId,
    rulesVersion: data.rulesVersion,
  };
}

export function isSameAppVersion(left: AppVersionInfo, right: AppVersionInfo): boolean {
  return (
    left.appVersion === right.appVersion && left.buildId === right.buildId && left.rulesVersion === right.rulesVersion
  );
}

export function isCompatibleVersion(value: unknown, expected: AppVersionInfo = APP_VERSION_INFO): boolean {
  const version = normalizeVersionInfo(value);
  return Boolean(version && isSameAppVersion(version, expected));
}
