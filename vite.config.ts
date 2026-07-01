import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';

const packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as { version?: string };
const fallbackVersion = packageJson.version ?? '0.1.0';

function versionEnv(name: string, fallback: string): string {
  return process.env[`VITE_${name}`] || process.env[name] || fallback;
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(versionEnv('APP_VERSION', fallbackVersion)),
    __APP_BUILD_ID__: JSON.stringify(versionEnv('APP_BUILD_ID', fallbackVersion)),
    __GAME_RULES_VERSION__: JSON.stringify(versionEnv('GAME_RULES_VERSION', fallbackVersion)),
  },
  build: {
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
    VitePWA({
      registerType: 'autoUpdate',
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
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
