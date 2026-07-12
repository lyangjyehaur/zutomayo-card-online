export interface RenderedRoleEnvironmentOptions {
  requiredPgSslMode?: string;
  requireRediss?: boolean;
}

export function validateRenderedRoleEnvironment(
  composeConfig: string | Record<string, unknown>,
  options?: RenderedRoleEnvironmentOptions,
): true;
