import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置。
 *
 * 本地執行：
 *   1. 啟動 dev server (`npm run dev`) 或用 docker-compose 起完整服務棧
 *   2. `npm run e2e` 跑全部測試 / `npm run e2e:ui` 用互動模式
 *
 * CI 執行：
 *   使用 docker-compose.e2e.yml 起獨立服務棧， 再跑 playwright test。
 *   需要 backend 的測試以 `@requires-backend` tag 標記， 可用 grep 過濾。
 */
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // 序列執行：E2E 多數場景共享同一服務棧，避免並行造成的狀態污染。
  workers: 1,
  retries: isCI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reportSlowTests: { max: 5, threshold: 10_000 },
  reporter: isCI ? [['github'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
