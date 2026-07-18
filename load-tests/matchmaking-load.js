/* global __ENV, __VU */

import http from 'k6/http';
import { check, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Legacy matchmaking retirement load: every authenticated endpoint must stay
// read/write inert and return 410 under concurrency.
//
// 執行：
//   k6 run load-tests/matchmaking-load.js
//   BASE_URL=http://api:3001 LOGIN_EMAIL=test@example.com LOGIN_PASSWORD=secret k6 run load-tests/matchmaking-load.js
//
// 測試帳號：
//   - 指定 LOGIN_EMAIL / LOGIN_PASSWORD 時共用該帳號（注意：同一 user 無法重複加入佇列，
//     共用帳號僅適合驗證流程；要模擬多玩家並發配對請保留預設行為讓每個 VU 註冊專屬帳號）。
//   - 未指定時，每個虛擬使用者註冊一個臨時帳號（會在資料庫建立資料，僅供測試環境使用）。
//
// 注意：
//   - /api/login、/api/register 限流 10 req/min/IP；高並發需調高限流或多 IP 分散。
//   - Supported matchmaking load belongs on the Colyseus quick_match protocol.

const retirementDuration = new Trend('mm_legacy_retirement_duration');
const retirementSuccess = new Rate('mm_legacy_retired');
const throttled = new Counter('mm_rate_limited');

export const options = {
  scenarios: {
    legacy_matchmaking_retirement_load: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 20 },
        { duration: '30s', target: 100 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    mm_legacy_retired: ['rate>0.99'],
    mm_legacy_retirement_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const SHARED_EMAIL = __ENV.LOGIN_EMAIL || '';
const SHARED_PASSWORD = __ENV.LOGIN_PASSWORD || 'loadtest123';
const jsonHeaders = { 'Content-Type': 'application/json' };

function authHeaders(token, csrfToken) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'x-csrf-token': csrfToken,
  };
}

export default function () {
  const email = SHARED_EMAIL || `mm+${__VU}-${Date.now()}@example.com`;
  const password = SHARED_PASSWORD;

  let token = '';
  if (SHARED_EMAIL) {
    const res = http.post(`${BASE_URL}/api/login`, JSON.stringify({ email, password }), {
      headers: jsonHeaders,
    });
    if (res.status === 429) throttled.add(1);
    try {
      token = res.json('token');
    } catch {
      token = '';
    }
  } else {
    group('register', function () {
      const res = http.post(`${BASE_URL}/api/register`, JSON.stringify({ email, password, nickname: `mm-${__VU}` }), {
        headers: jsonHeaders,
      });
      if (res.status === 429) throttled.add(1);
      try {
        token = res.json('token');
      } catch {
        token = '';
      }
    });
  }

  if (!token) {
    retirementSuccess.add(false);
    return;
  }

  // 取得 CSRF token（double-submit cookie pattern）：response body 的 token 必須與
  // zutomayo_csrf cookie 一致，並透過 x-csrf-token header 回傳。
  const csrfRes = http.get(`${BASE_URL}/api/csrf-token`, { headers: { Authorization: `Bearer ${token}` } });
  let csrfToken = '';
  try {
    csrfToken = csrfRes.json('token');
  } catch {
    csrfToken = '';
  }

  group('legacy_routes_stay_retired', function () {
    const startedAt = Date.now();
    const responses = [
      http.post(`${BASE_URL}/api/matchmaking/queue`, '{}', { headers: authHeaders(token, csrfToken) }),
      http.get(`${BASE_URL}/api/matchmaking/status`, { headers: { Authorization: `Bearer ${token}` } }),
      http.del(`${BASE_URL}/api/matchmaking/queue`, '', { headers: authHeaders(token, csrfToken) }),
      http.put(`${BASE_URL}/api/matchmaking/match`, JSON.stringify({ matchId: 'retired' }), {
        headers: authHeaders(token, csrfToken),
      }),
    ];
    retirementDuration.add(Date.now() - startedAt);
    const retired = responses.every((response) =>
      check(response, {
        'legacy matchmaking returns 410': (result) => result.status === 410,
      }),
    );
    retirementSuccess.add(retired);
    for (const response of responses) {
      if (response.status === 429) throttled.add(1);
    }
  });
}
