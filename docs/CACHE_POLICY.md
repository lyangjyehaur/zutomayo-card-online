# 線上快取與 GeoDNS 路由

正式網域以 GeoDNS 分成兩條傳輸路徑，但共用同一套源站快取語義：

```text
中國大陸解析 -> 香港入口 -> game/api/platform
其他地區解析 -> Cloudflare -> game/api/platform
```

兩條路必須使用相同 hostname、公開可信 TLS 憑證、應用 build、PostgreSQL、Redis 與 session secret。快取正確性由源站 `Cache-Control` 決定；Cloudflare 只為明確公開且可共享的回應提供邊緣快取。

## 快取矩陣

| 類型                                   | 源站策略                                 | Cloudflare     |
| -------------------------------------- | ---------------------------------------- | -------------- |
| HTML、SPA、版本 API                    | `no-store`                               | bypass         |
| `sw.js`、manifest                      | `max-age=0, must-revalidate`             | bypass         |
| `/assets/*`、字體                      | 1 年 `immutable`                         | 1 年           |
| `/battle/*?v=<active-build-id>`        | 1 年 `immutable`                         | respect origin |
| 無版本或版本不符的 battle 素材         | `no-store`                               | 不保存         |
| 官方規則、Q&A、勘誤                    | browser `max-age=0`、edge `s-maxage=300` | respect origin |
| 官方發布狀態、公告                     | browser `max-age=0`、edge `s-maxage=60`  | respect origin |
| imgproxy 成功回應                      | 1 年 `immutable`                         | respect origin |
| 房間、presence、聊天、帳號、牌組、對局 | `private, no-store`                      | bypass         |
| 靜態 404、所有 5xx                     | `no-store`                               | TTL 0          |

香港反向代理不得使用 `proxy_hide_header Cache-Control`，也不得以全域 `add_header Cache-Control` 覆蓋應用回應。如果之後改由 Nginx 直接服務靜態檔，必須逐類複製上表策略，並由 cache smoke 驗證。

## Cloudflare 自動化

Cloudflare Cache Rules 由 `scripts/cloudflare-cache-rules.ts` 管理。工具先讀取 zone 的 `http_request_cache_settings` entrypoint，保留沒有 `zutomayo-cache-` ref 的規則，替換倉庫管理的規則，且只在 `apply` 模式寫入。

使用最小權限 API Token：

- `Zone / Zone / Read`
- `Zone / Cache Rules / Edit`

Token 與 Zone ID 只注入本機部署 shell 或 GitHub Environment secrets，不得寫入 server4 `.env`、Compose、日誌或 Git：

```bash
export CLOUDFLARE_API_TOKEN='...'
export CLOUDFLARE_ZONE_ID='32-character-zone-id'

npm run cloudflare:cache:plan
npm run cloudflare:cache:apply
```

`plan` 是唯讀操作。首次 `apply` 前必須查看輸出的 managed rule 清單，並確認沒有其他產品依賴現有的全站 Cache Everything 規則。部署器只有在 token 與 zone ID 同時存在時才套用；設定 `CLOUDFLARE_CACHE_RULES_REQUIRED=true` 後，缺少任一憑證會阻止部署。

## 雙路徑 Smoke

同一正式 URL 可透過正常 DNS 和強制指定香港 IP 驗證，後者仍保留 hostname、Host header、SNI 與 TLS 憑證驗證：

```bash
npm run smoke:cache-policy -- \
  --base-url https://battle.zutomayocard.online \
  --direct-address 149.104.6.238 \
  --expected-build-id "$(git rev-parse HEAD)"
```

部署器使用：

- `PUBLIC_SMOKE_BASE_URL`：正式同源 URL，預設 `https://battle.zutomayocard.online`。
- `DIRECT_SMOKE_ADDRESS`：香港 HTTPS 入口 IP，預設使用 `SERVER_HOST`。
- `CLOUDFLARE_CACHE_RULES_REQUIRED`：是否強制要求 Cloudflare IaC 憑證，預設 `false`。

Smoke 會核對兩條路的 build ID 一致，並檢查 HTML、PWA 控制檔、hashed asset、版本化／未版本化 battle 素材、缺失 SVG、官方規則 API 與 presence API。Cloudflare 規則剛套用時還會要求 immutable asset 在重試後出現可接受的 `CF-Cache-Status`。

## 發布與素材更新

可變內容不得使用不變 URL 搭配 `immutable`。Battle 素材以 build ID 作版本；R2 卡圖若覆蓋相同 key，必須改用內容 hash／版本化 URL，或精確 purge 該 URL。禁止用全站 purge 代替版本管理。

字體 URL 同樣視為 immutable 契約；字體內容變更時必須換檔名，不能覆蓋既有名稱。
