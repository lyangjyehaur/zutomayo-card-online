# Refine 管理後台

管理後台使用 Refine 5 headless、React Router 7、React Hook Form、Zod 與項目既有的 Tailwind Design System。Refine 負責 `/admin/*` 的資源路由、認證生命週期、RBAC、CRUD data provider 與未儲存變更提示；PostgreSQL、API 權限、TOTP、站內帳號連結及 audit log 仍沿用既有後端。

## 登入

1. 已登入且已由 `npm run admin:link` 連結的站內帳號，進入 `/admin/login` 時會由 Refine auth provider 呼叫 `POST /api/admin/session` 交換管理員 session。
2. 傳統獨立管理員可在相同頁面輸入帳號、密碼與六位 TOTP，呼叫 `POST /api/admin/login`。
3. token 與角色只保存於 `sessionStorage`。登出會呼叫 `POST /api/admin/logout`，401／403 會清除 session 並返回登入頁。

## 資源與權限

| Resource         | 路徑                      | 最低角色／權限                  | 說明                                        |
| ---------------- | ------------------------- | ------------------------------- | ------------------------------------------- |
| cards            | `/admin/cards`            | operator / `cards:write`        | 卡牌清單、新增、編輯、狀態與翻譯複核        |
| songs            | `/admin/songs`            | operator / `config:write`       | 歌曲名稱多語設定                            |
| synergies        | `/admin/synergies`        | operator / `cards:write`        | 方向性聯動、證據、翻譯與公開推薦資格        |
| official-rulings | `/admin/official-rulings` | operator / `config:write`       | Q&A／勘誤同步、生成與人工複核               |
| users            | `/admin/users`            | viewer / `users:read`           | 查詢帳號；只有 admin 可管理角色             |
| matches          | `/admin/matches`          | viewer / `matches:read`         | 最近對戰紀錄，只讀                          |
| support-inbox    | `/admin/support-inbox`    | moderator / `support:read`      | Resend 收件、討論串回覆與處理狀態           |
| chat             | `/admin/chat`             | moderator / `chat:moderate`     | 檢舉、上下文、訊息處置與禁言                |
| deck-shares      | `/admin/deck-shares`      | moderator / `feedback:moderate` | 牌組分享檢舉與可見性                        |
| operations       | `/admin/operations`       | operator                        | 賽季及 legal hold；高風險寫入仍只允許 admin |
| about            | `/admin/about`            | operator / `config:write`       | About 多語內容                              |
| announcements    | `/admin/announcements`    | operator / `config:write`       | 公告生命週期                                |
| translation      | `/admin/translation`      | operator / `config:write`       | 翻譯服務設定與測試                          |
| notifications    | `/admin/notifications`    | operator / `config:write`       | Bark、Telegram、Webhook 管理員通知與測試    |
| i18n             | `/admin/i18n`             | viewer                          | 程式碼 UI 字典完整度稽核，只讀              |

Refine access control 用來隱藏無權限入口及按鈕，但不視為安全邊界；API 仍會逐一驗證 token、角色、權限與 CSRF。

## 新卡與限定卡工作流

- 新增卡牌必填 ID、日文卡名、系列、屬性、卡種與稀有度。
- 預設狀態為 `catalog_status=unlisted`、`publication_status=draft`、`play_status=disabled`，避免未審資料進入圖鑑或實際牌組。
- `display_only` 只會出現在已發布圖鑑，不會由 `/api/cards` 進入對戰或牌組編輯器。
- 圖片欄位只保存人工待審 URL 並提供預覽。管理後台沒有 R2 upload action；圖片通過人工審核後再使用既有受控流程上傳與替換 URL。
- 日文與官方英文在卡牌主資料維護；繁中、簡中、粵語、韓語在翻譯區逐語保存 `pending_review` 或 `verified`。卡牌名稱應引用已校對 canonical 名稱。
- 所有寫入走 PostgreSQL upsert 並記錄 `admin_audit_log`，不以 JSON 作 runtime 資料來源。

## 驗證

前端、路由或 provider 修改至少執行：

```bash
npm run typecheck
npx vitest run src/admin/__tests__/providers.test.ts
npm run build
```

提交或推送前仍必須依倉庫規範執行完整 `npm run verify`。
