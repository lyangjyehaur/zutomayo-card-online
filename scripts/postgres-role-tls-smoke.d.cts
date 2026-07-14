export type PostgresRoleTlsSmokeRole = 'api' | 'game' | 'platform' | 'retention' | 'monitor' | 'backup';
export type PostgresRoleTlsSmokeFailureStage =
  | 'configuration'
  | 'connect'
  | 'identity'
  | 'tls'
  | 'allow-probe'
  | 'deny-probe'
  | 'internal';

export interface PostgresRoleTlsSmokeSuccessReport {
  schemaVersion: 1;
  artifactType: 'zutomayo-postgres-role-tls-smoke';
  ok: true;
  role: PostgresRoleTlsSmokeRole;
  checkedAt: string;
  identity: { matchesExpectedRole: true };
  tls: { enabled: true; version: string; cipher: string };
  probes: {
    allow: { name: string; status: 'passed' };
    deny: {
      name: string;
      status: 'passed';
      expectedSqlState: '42501';
      observedSqlState: '42501';
    };
  };
}

export interface PostgresRoleTlsSmokeFailureReport {
  schemaVersion: 1;
  artifactType: 'zutomayo-postgres-role-tls-smoke';
  ok: false;
  role: PostgresRoleTlsSmokeRole | null;
  checkedAt: string;
  failure: { stage: PostgresRoleTlsSmokeFailureStage };
}

export interface PostgresRoleTlsSmokeClient {
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows?: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}

export interface PostgresRoleTlsSmokeOptions {
  role: PostgresRoleTlsSmokeRole;
  env?: NodeJS.ProcessEnv;
  clientFactory?: (config: Record<string, unknown>) => PostgresRoleTlsSmokeClient;
  now?: () => Date;
}

export class PostgresRoleTlsSmokeError extends Error {
  constructor(stage: Exclude<PostgresRoleTlsSmokeFailureStage, 'internal'>);
  stage: Exclude<PostgresRoleTlsSmokeFailureStage, 'internal'>;
}

export const ARTIFACT_TYPE: 'zutomayo-postgres-role-tls-smoke';
export const PERMISSION_DENIED_SQLSTATE: '42501';
export const ROLE_TYPES: readonly PostgresRoleTlsSmokeRole[];
export const ROLE_PROBES: Readonly<
  Record<
    PostgresRoleTlsSmokeRole,
    {
      readonly expectedUserVariable: string;
      readonly allow: { readonly name: string; readonly sql: string };
      readonly deny: { readonly name: string; readonly sql: string };
    }
  >
>;

export function parseRoleArgument(argv: string[]): PostgresRoleTlsSmokeRole;
export function postgresClientConfig(env: NodeJS.ProcessEnv, role: PostgresRoleTlsSmokeRole): Record<string, unknown>;
export function postgresRoleTlsSmokeFailureReport(
  error: unknown,
  role: PostgresRoleTlsSmokeRole | null,
  now?: () => Date,
): PostgresRoleTlsSmokeFailureReport;
export function runPostgresRoleTlsSmoke(
  options: PostgresRoleTlsSmokeOptions,
): Promise<PostgresRoleTlsSmokeSuccessReport>;
