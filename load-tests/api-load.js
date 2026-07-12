/* global __ENV */

import http from 'k6/http';
import { check, sleep } from 'k6';

// API 負載測試：對公開 API endpoint 進行壓力測試，記錄 P50/P95/P99 latency、RPS、錯誤率。
//
// 執行：
//   k6 run load-tests/api-load.js
//   BASE_URL=http://api:3001 k6 run load-tests/api-load.js
//
// 注意：API server 預設對每個 IP 限制 120 req/min（RATE_LIMIT_DEFAULT）。
// 100 個虛擬使用者同時施壓時會觸發 429，此時 http_req_failed 會上升——
// 這代表系統瓶頸在限流，可據此評估是否調整測試環境的限流設定。

export const options = {
  stages: [
    { duration: '10s', target: 50 }, // 10 秒內爬升到 50 個虛擬使用者
    { duration: '30s', target: 100 }, // 維持 100 個虛擬使用者 30 秒
    { duration: '10s', target: 0 }, // 10 秒內降至 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// 公開、高頻存取的 endpoint。
const ENDPOINTS = ['/api/cards', '/api/config', '/api/preset-decks', '/api/leaderboard'];

export default function () {
  for (const ep of ENDPOINTS) {
    const res = http.get(`${BASE_URL}${ep}`);
    check(res, {
      'status is 200': (r) => r.status === 200,
      'response time < 500ms': (r) => r.timings.duration < 500,
    });
  }
  sleep(0.1);
}
