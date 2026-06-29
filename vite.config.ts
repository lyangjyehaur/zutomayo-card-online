import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import type { Connect } from 'vite';

// Vite 預設只 serve public/ 目錄下的檔案。
// 此 middleware 讓 dev server 也能提供 cards.json 和 data/ 給前端 fallback 使用。
function serveStaticData(): { name: string; configureServer: (server: { middlewares: Connect.Server }) => void } {
  return {
    name: 'static-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next();
        const url = req.url;

        if (url === '/cards.json') {
          const filePath = path.resolve('cards.json');
          if (fs.existsSync(filePath)) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath));
            return;
          }
        }

        if (url?.startsWith('/data/')) {
          const filePath = path.resolve('.' + url);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'application/json');
            res.end(fs.readFileSync(filePath));
            return;
          }
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    serveStaticData(),
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
