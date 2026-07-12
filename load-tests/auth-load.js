/* global __ENV, __VU */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 認證負載測試：模擬登入、token refresh，記錄成功率與延遲。
//
// 執行：
//   k6 run load-tests/auth-load.js
//   BASE_URL=http://api:3001 LOGIN_EMAIL=test@example.com LOGIN_PASSWORD=secret k6 run load-tests/auth-load.js
//
// 測試帳號：
//   - 指定 LOGIN_EMAIL / LOGIN_PASSWORD 時，所有虛擬使用者共用該帳號登入（建議先用一個預先建立的帳號）。
//   - 未指定時，每個虛擬使用者會註冊一個臨時帳號（會在資料庫建立資料，僅供測試環境使用）。
//
// 注意：API server 對 /api/login、/api/register 的限流為每個 IP 10 req/min（RATE_LIMIT_AUTH）。
// 超過即回 429。高並發認證壓測需要調高限流、或從多個來源 IP 分散請求。

const loginDuration = new Trend('auth_login_duration');
const refreshDuration = new Trend('auth_refresh_duration');
const registerDuration = new Trend('auth_register_duration');
const successRate = new Rate('auth_success');
const throttled = new Counter('auth_rate_limited');

export const options = {
  scenarios: {
    auth_load: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    auth_success: ['rate>0.95'],
    auth_login_duration: ['p(95)<800', 'p(99)<1500'],
    auth_refresh_duration: ['p(95)<300'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const SHARED_EMAIL = __ENV.LOGIN_EMAIL || '';
const SHARED_PASSWORD = __ENV.LOGIN_PASSWORD || 'loadtest123';

const headers = { 'Content-Type': 'application/json' };

export default function () {
  // 未提供共用帳號時，每個 VU 使用專屬 email，避免相互覆蓋。
  const email = SHARED_EMAIL || `loadtest+${__VU}-${Date.now()}@example.com`;
  const password = SHARED_PASSWORD;

  if (!SHARED_EMAIL) {
    group('register', function () {
      const res = http.post(
        `${BASE_URL}/api/register`,
        JSON.stringify({ email, password, nickname: `loadtest-${__VU}` }),
        { headers },
      );
      registerDuration.add(res.timings.duration);
      // 200/201 表示新建成功；409 表示帳號已存在（重複執行時可接受，後續仍可登入）。
      check(res, {
        'register ok or exists': (r) => r.status === 200 || r.status === 201 || r.status === 409,
      });
      if (res.status === 429) throttled.add(1);
    });
  }

  group('login', function () {
    const res = http.post(`${BASE_URL}/api/login`, JSON.stringify({ email, password }), { headers });
    loginDuration.add(res.timings.duration);

    const ok = check(res, {
      'login status 200': (r) => r.status === 200,
      'login has token': (r) => {
        try {
          return typeof r.json('token') === 'string';
        } catch {
          return false;
        }
      },
    });
    successRate.add(ok);
    if (res.status === 429) throttled.add(1);

    // /api/auth/refresh 讀取 zutomayo_refresh cookie（登入時透過 Set-Cookie 設定）。
    // k6 的 cookie jar 會自動在後續同源請求帶上該 cookie，無需手動處理。
    if (ok) {
      group('refresh', function () {
        const r = http.post(`${BASE_URL}/api/auth/refresh`, '', { headers });
        refreshDuration.add(r.timings.duration);
        check(r, {
          'refresh status 200': (rr) => rr.status === 200,
        });
        if (r.status === 429) throttled.add(1);
      });
    }
  });

  sleep(0.5);
}
