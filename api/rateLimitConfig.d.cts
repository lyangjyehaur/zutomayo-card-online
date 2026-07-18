export interface ApiRateLimitConfig {
  windowMs: number;
  auth: number;
  default: number;
  imgproxy: number;
  upload: number;
}

export const MAX_RATE_LIMIT: number;
export function apiRateLimitConfig(env?: NodeJS.ProcessEnv): Readonly<ApiRateLimitConfig>;
