/* global __ENV, __VU */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// 配對負載測試：模擬多個玩家同時加入配對佇列，記錄配對成功率與配對時間。
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
//   - 配對需要「成對」玩家才能成立；奇數玩家會停留在佇列直到 timeout。

const queueDuration = new Trend('mm_queue_duration');
const matchDuration = new Trend('mm_match_duration');
const statusDuration = new Trend('mm_status_duration');
const joinSuccess = new Rate('mm_join_success');
const matchSuccess = new Rate('mm_matched');
const throttled = new Counter('mm_rate_limited');

export const options = {
  scenarios: {
    matchmaking_load: {
      executor: 'ramping-vus',
      stages: [
        { duration: '10s', target: 20 },
        { duration: '30s', target: 100 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    mm_join_success: ['rate>0.9'],
    mm_queue_duration: ['p(95)<500'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
const SHARED_EMAIL = __ENV.LOGIN_EMAIL || '';
const SHARED_PASSWORD = __ENV.LOGIN_PASSWORD || 'loadtest123';
const POLL_TIMES = Number(__ENV.MM_POLL_TIMES || 5);
const POLL_INTERVAL = Number(__ENV.MM_POLL_INTERVAL || 1);

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
    joinSuccess.add(false);
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

  const deckIds = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10'];
  const joinStart = Date.now();

  group('join_queue', function () {
    const res = http.post(`${BASE_URL}/api/matchmaking/queue`, JSON.stringify({ deckName: `deck-${__VU}`, deckIds }), {
      headers: authHeaders(token, csrfToken),
    });
    queueDuration.add(res.timings.duration);
    const ok = check(res, {
      'join status 200': (r) => r.status === 200,
    });
    joinSuccess.add(ok);
    if (res.status === 429) throttled.add(1);
  });

  // 輪詢配對狀態，直到 matched 或達到輪詢次數上限。
  let matched = false;
  for (let i = 0; i < POLL_TIMES; i++) {
    sleep(POLL_INTERVAL);
    const res = http.get(`${BASE_URL}/api/matchmaking/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    statusDuration.add(res.timings.duration);
    if (res.status === 429) {
      throttled.add(1);
      continue;
    }
    try {
      if (res.json('status') === 'matched') {
        matched = true;
        matchDuration.add(Date.now() - joinStart);
        break;
      }
    } catch {
      // 忽略解析失敗，繼續輪詢。
    }
  }
  matchSuccess.add(matched);

  // 離開佇列（清理狀態）。
  group('leave_queue', function () {
    const res = http.del(`${BASE_URL}/api/matchmaking/queue`, '', {
      headers: authHeaders(token, csrfToken),
    });
    if (res.status === 429) throttled.add(1);
  });
}
