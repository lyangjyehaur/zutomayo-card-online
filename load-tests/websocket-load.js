/* global __ENV, console */

import ws from 'k6/ws';
import { check } from 'k6';

// WebSocket 負載測試：對 game server（boardgame.io + socket.io）的 WebSocket 連線進行壓力測試。
//
// 預設指向 game server 的 socket.io endpoint（/socket.io/?EIO=4&transport=websocket）。
// 每個虛擬使用者建立一條連線、定期發送 engine.io heartbeat（ping/pong），並在持有期間維持連線。
//
// 執行：
//   k6 run load-tests/websocket-load.js
//   WS_URL=ws://game:3000/socket.io/?EIO=4&transport=websocket k6 run load-tests/websocket-load.js
//
// 注意：game server 預設 MAX_CONN_PER_IP=10，從單一 IP 建立超過此數量的連線會被立即 disconnect。
// 進行 200/500 並發測試時請提高 MAX_CONN_PER_IP，或從多個來源 IP 分散連線。

const targetConnections = Number(__ENV.WS_TARGET_CONNECTIONS || 200);
const rampDuration = __ENV.WS_RAMP_DURATION || '30s';
const soakDuration = __ENV.WS_SOAK_DURATION || '60s';

export const options = {
  stages: [
    { duration: rampDuration, target: targetConnections },
    { duration: soakDuration, target: targetConnections },
    { duration: rampDuration, target: 0 },
  ],
  thresholds: {
    ws_connecting: ['p(95)<2000'],
    ws_msgs_received: ['count>0'],
  },
};

const WS_URL = __ENV.WS_URL || 'ws://localhost:3000/socket.io/?EIO=4&transport=websocket';
// 每條連線持有的時間（毫秒）；需大於測試總時長才能維持穩定並發。
const HOLD_MS = Number(__ENV.WS_HOLD_MS || 90000);

export default function () {
  const res = ws.connect(WS_URL, {}, function (socket) {
    socket.on('open', function open() {
      // 定期發送 engine.io heartbeat（client 主動 ping）。
      socket.setInterval(function () {
        socket.send('2');
      }, 5000);

      // 持有連線一段時間後關閉，避免單一 iteration 無限阻塞。
      socket.setTimeout(function () {
        socket.close();
      }, HOLD_MS);
    });

    socket.on('message', function message(data) {
      // engine.io 協定：收到 server ping（"2"）時回 pong（"3"）以維持連線。
      if (typeof data === 'string' && data.startsWith('2')) {
        socket.send('3');
      }
    });

    socket.on('error', function error(e) {
      if (__ENV.DEBUG) {
        console.log('ws error:', e.error());
      }
    });
  });

  check(res, {
    'ws connected': (r) => r && r.status === 101,
  });
}
