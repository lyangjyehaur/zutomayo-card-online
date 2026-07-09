import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';
import fs from 'fs';
import path from 'path';

const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string };
const fallbackVersion = packageJson.version ?? '0.1.0';
const fallbackBuildTime = new Date().toISOString();

function versionEnv(name: string, fallback: string): string {
  return process.env[`VITE_${name}`] || process.env[name] || fallback;
}

// Release 字串必須與 src/sentry.ts 的 release 完全一致，source map 才能正確關聯。
const release = `${versionEnv('APP_VERSION', fallbackVersion)}@${versionEnv('APP_BUILD_ID', fallbackVersion)}`;

// 只有四個 Sentry upload 變數都存在時才啟用 source map 上傳，避免配置不完整導致 build 異常或上傳到錯誤目標。
// SENTRY_AUTH_TOKEN 僅用於 build 時上傳 source map，不會進入前端 bundle。
const sentrySourceMapUploadEnabled =
  Boolean(process.env.SENTRY_URL) &&
  Boolean(process.env.SENTRY_ORG) &&
  Boolean(process.env.SENTRY_PROJECT) &&
  Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versionEnv('APP_VERSION', fallbackVersion)),
    __APP_BUILD_ID__: JSON.stringify(versionEnv('APP_BUILD_ID', fallbackVersion)),
    __APP_BUILT_AT__: JSON.stringify(versionEnv('APP_BUILT_AT', fallbackBuildTime)),
    __GAME_RULES_VERSION__: JSON.stringify(versionEnv('GAME_RULES_VERSION', fallbackVersion)),
  },
  build: {
    // hidden：產生 source map 但不寫入 //# sourceMappingURL 註解，避免 .map 檔暴露到公網。
    // Source map 透過 @sentry/vite-plugin 上傳到 GlitchTip，線上只部署壓縮後的 JS。
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          // 核心框架單獨打包
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // boardgame.io 框架
          'vendor-game': ['boardgame.io/react', 'boardgame.io/client'],
          // UI 組件庫
          'vendor-ui': ['lucide-react'],
        },
      },
    },
    // 提高 chunk 大小警告門檻（遊戲邏輯較複雜）
    chunkSizeWarningLimit: 800,
  },
  plugins: [
    tailwindcss(),
    react(),
    // 只有四個 Sentry upload 變數都存在時才啟用 source map 上傳。
    // 無配置或配置不完整時 vite build 正常完成，只是不做 source map upload。
    ...(sentrySourceMapUploadEnabled
      ? [
          sentryVitePlugin({
            url: process.env.SENTRY_URL,
            org: process.env.SENTRY_ORG,
            project: process.env.SENTRY_PROJECT,
            authToken: process.env.SENTRY_AUTH_TOKEN,
            release: { name: release },
            // 不注入 release header 到 bundle，由 src/sentry.ts 的 Sentry.init release 負責。
            injectRelease: false,
          }),
        ]
      : []),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'ZUTOMAYO CARD Online',
        short_name: 'ZC Card',
        description: 'ZUTOMAYO CARD 對戰遊戲',
        theme_color: '#130d21',
        background_color: '#130d21',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/r2\.dan\.tw\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'card-images',
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
});
