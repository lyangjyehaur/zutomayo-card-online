/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_UMAMI_WEBSITE_ID?: string;
  readonly VITE_UMAMI_SCRIPT_URL?: string;
  readonly VITE_UMAMI_HOST_URL?: string;
  readonly VITE_UMAMI_TELEMETRY_SCRIPT_URL?: string;
  readonly VITE_UMAMI_SECONDARY_WEBSITE_ID?: string;
  readonly VITE_UMAMI_SECONDARY_HOST_URL?: string;
  readonly VITE_IMGPROXY_BASE_URL?: string;
}
