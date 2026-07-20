# ZUTOMAYO CARD Online — オンライン対戦カードゲーム

**言語 / Languages：** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

現在のバージョン：**0.2.2**

> ZUTOMAYO CARD（ずっと真夜中でいいのに。公式 TCG）の非公式デジタル対戦プラットフォームです。
> ローカル 2 人対戦、AI 練習、インタラクティブチュートリアル、リアルタイムオンライン対戦に対応します。

## プロジェクトの現状

0.2.0 では、単体の対戦アプリからマルチプレイヤープラットフォームへ拡張しました。カード状態の権威は引き続き `boardgame.io` が持ち、Colyseus がロビー、マッチング、ルーム、招待、観戦 presence を担当し、ChatService が永続チャット、未読、翻訳、通報、モデレーションを担当します。

0.2.2 では、共有デッキロビーと、PostgreSQL を正本とする公式日本語 Q&A／訂正情報、多言語ページ、管理レビュー、公式ソース同期フローを追加しました。

### ゲームと対戦

- ローカル 2 人対戦と、かんたん／ふつう／むずかしい AI。難しい AI は lookahead シミュレーションを使用します。
- 4 パック・422 枚のカードデータと、267 行すべての効果テキスト解析。
- じゃんけん、引き直し、初期配置、効果順、プレイヤー選択、バトル、Chronos 昼夜フロー。
- サーバー権威のフェーズタイマーとタイムアウト復旧により、切断・無応答プレイヤーが対局を永久停止させません。
- バトルアニメーション、レスポンシブ戦場、モバイルタッチ操作、再設計されたチュートリアル overlay。
- 結果画面から ELO／戦績送信を再試行可能。サーバー送信は冪等で、ローカル履歴は重複を防ぎ、試合後チャットの参照元を保持します。

### マルチプレイヤープラットフォーム

- Colyseus によるクイックマッチ、カスタムルーム、フレンド招待、観戦、ロビーのフレンド presence。
- 安定した対局引き継ぎと再接続復旧。オンライン session は platform identity、seat token、boardgame.io credentials を保持します。
- 本番環境では Redis driver/presence、ローカル開発では memory mode を利用できます。
- Colyseus はプラットフォーム shell の状態だけを保持し、手札、デッキ、効果などの権威ゲームデータを所有しません。

### ソーシャルとチャット

- フレンド管理、オンライン状態、対戦招待。
- グローバルロビー、フレンド DM、カスタムルーム、対局中、試合後チャット。
- 会話横断の未読概要、既読 cursor、メッセージ翻訳、通報、削除後も残る証拠 snapshot。
- 管理者は完全な会話証拠を確認し、通報処理と会話種別をまたぐ永続 mute を実行できます。
- ChatService と PostgreSQL が正本であり、Colyseus は本文を含まない同期シグナルだけを送信します。

### その他の機能

- 6 言語 UI：繁体字中国語、広東語、簡体字中国語、日本語、英語、韓国語。
- デッキエディター、共有デッキロビー、ランキング、端末間戦績、プロフィール、OAuth identity、フィードバックボード。
- 公式日本語 Q&A／訂正情報、多言語閲覧ページ、管理レビュー、公式ソース同期。
- PWA インストール／更新通知と app、build、rules の 3 層バージョン互換チェック。
- カード、翻訳、ユーザー、ELO、チャット証拠、制裁、フィードバックの管理画面。
- Playwright core E2E、k6 API／WebSocket／認証／matchmaking 負荷テスト、staging／production CD pipeline。

## アーキテクチャ

```text
Browser / PWA
  ├─ HTTP + Socket.IO ──> game :3000
  │                        boardgame.io 権威対局、フロントエンド、/api proxy
  ├─ HTTP ──────────────> api :3001
  │                        アカウント、デッキ、戦績、フレンド、ChatService、管理
  └─ WebSocket ─────────> platform :3002
                           Colyseus ロビー、マッチング、ルーム、招待、観戦

game / api / platform
  ├─ PostgreSQL：永続データ、対局状態、参加者、チャット証拠
  └─ Redis：Pub/Sub、Colyseus presence/driver、rate limit、一時的な協調
```

### 権威境界

| ドメイン         | 正本                         | 責務                                                         |
| ---------------- | ---------------------------- | ------------------------------------------------------------ |
| カード対局       | `boardgame.io` + `GameLogic` | 非公開情報、合法手、タイマー、効果、勝敗、action log         |
| マルチプレイヤー | Colyseus                     | ロビー、ルーム lifecycle、マッチング、招待、presence、観戦者 |
| チャット         | ChatService + PostgreSQL     | 履歴、ACL、未読、翻訳、通報、審査、mute                      |
| プロダクトデータ | PostgreSQL                   | アカウント、デッキ、戦績、フレンド、設定、フィードバック     |
| 一時的な協調     | Redis                        | ノード間同期、room discovery、rate limit、互換キュー         |

### 主な技術

| レイヤー | 技術                                                             |
| -------- | ---------------------------------------------------------------- |
| Web      | React 19、React Router 7、TypeScript 5.8、Vite 7、Tailwind CSS 4 |
| 対局     | boardgame.io 0.50、決定的な `GameState.step` 状態機械            |
| Platform | Colyseus、`colyseus.js`、Redis presence/driver                   |
| Backend  | Node.js、Koa／Node HTTP、PostgreSQL、Redis、Zod                  |
| 品質     | Vitest、fast-check、Playwright、k6、ESLint、Prettier、Husky      |
| 運用     | Docker Compose、GitHub Actions CI/CD、Pino、Prometheus、Sentry   |

## ローカル開発

### 必要環境

- Node.js `>=20`。CI と Docker は Node 22 を使用します。
- npm 10+。
- 完全なオンラインフローには PostgreSQL と Redis が必要です。Colyseus は memory mode で単独起動できます。

### インストールと起動

```bash
npm ci
cp .env.example .env

# backend 依存、schema、REST API、Colyseus platform
docker compose up -d postgres redis migrate api platform

# HMR 付き Vite フロントエンド、http://localhost:3000
npm run dev
```

実際の boardgame.io サーバーを使う場合は Compose の `game` を起動するか、`.env` の値を export 済みの shell で `npm run build && npm run server` を実行します。`npm run platform` は memory mode で単独起動できます。API を単独起動する場合は環境変数を export してから `cd api && npm ci && npm start` を使用します。

### 主なコマンド

| コマンド                                       | 用途                                                        |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `npm run verify`                               | format、policy、設定、lint、typecheck、coverage、本番 build |
| `npm test` / `npm run test:watch`              | Vitest の単発実行／watch mode                               |
| `npm run typecheck`                            | app と server の TypeScript 検査                            |
| `npm run typecheck:scripts`                    | scripts の TypeScript 検査                                  |
| `npm run lint`                                 | ESLint                                                      |
| `npm run format:check:tracked`                 | Git 管理ファイルだけを Prettier 検査                        |
| `npm run build`                                | typecheck 後に本番 frontend bundle を作成                   |
| `npm run server`                               | game／boardgame.io サーバーを起動                           |
| `npm run platform`                             | Colyseus platform サービスを起動                            |
| `npm run db:migrate`                           | PostgreSQL migration を適用                                 |
| `npm run import:official-rulings-translations` | 未追跡の公式裁定翻訳を PostgreSQL に import                 |
| `npm run sync:official-rulings`                | 公式 Q&A／訂正情報ソースを読み取り専用で比較                |
| `npm run translate:official-rulings`           | 不足している公式裁定の派生翻訳を生成                        |
| `npm run smoke`                                | コアゲームフロー smoke                                      |
| `npm run smoke:api`                            | REST API integration smoke                                  |
| `npm run smoke:online`                         | boardgame.io オンライン対戦 smoke                           |
| `npm run smoke:platform-deployment`            | platform health と実 lobby WebSocket join/leave を検証      |
| `npm run smoke:responsive`                     | 全レスポンシブ browser smoke                                |
| `npm run rule:audit`                           | カード効果 parser の coverage 監査                          |
| `npm run e2e` / `npm run e2e:ui`               | Playwright 全 E2E／interactive UI                           |
| `npm run load:api` / `load:ws`                 | k6 API／WebSocket 負荷テスト（k6 は別途インストール）       |

## Docker デプロイ

```bash
cp .env.example .env
# 最低限 PG_PASSWORD、REDIS_PASSWORD、32 文字以上の JWT_SECRET を設定
docker compose up -d --build
docker compose ps
```

Compose は `postgres`、`redis`、一度だけ実行する `migrate`、`game`、`api`、`platform` の 6 unit で構成されます。

さらに `docker-compose.e2e.yml`、`docker-compose.load-test.yml`、port／DB を分離した `docker-compose.staging.yml` を提供します。Production-hardening CD は現在 `codex/deferred-production-hardening` に分離され、staging／production の SSH deploy は検証済み artifact を使って `workflow_dispatch` で明示的に実行します。

| Port   | サービス | 用途                                             |
| ------ | -------- | ------------------------------------------------ |
| `3000` | game     | Web/PWA、boardgame.io、Socket.IO、`/api/*` proxy |
| `3001` | api      | REST API、ChatService、アカウント、管理          |
| `3002` | platform | Colyseus WebSocket rooms、`/health`、`/ready`    |

本番環境、外部 PostgreSQL／Redis、backup、migration、水平スケールについては [デプロイガイド](docs/DEPLOYMENT.md) を参照してください。公式 Q&A／訂正情報の同期、import、翻訳手順は [公式裁定データベースガイド](docs/official-rulings.md) に記載しています。

## リポジトリ構成

```text
src/game/             権威ルール、AI、効果、カード読込、対戦テスト
src/components/       対戦、チュートリアル、ロビー、共通 React feature
src/ui/               design tokens、primitives、layout、戦場 UI
src/pages/            route 単位のページ
src/platform/         Colyseus runtime、rooms、identity、永続化 adapter
src/chat/             DM key、対局チャット ACL、未読 navigation
src/server/           PostgreSQL、Redis、rate-limit、可観測性拡張
api/                  REST API と account、friend、chat、match、admin service
migrations/           node-pg-migrate schema 履歴
scripts/              smoke、migration、deployment、audit tools
e2e/                  Playwright 認証、デッキ、tutorial、smoke scenario
load-tests/           k6 API、WebSocket、認証、matchmaking 負荷テスト
docs/                 architecture、API、deployment、multiplayer、UI/UX 文書
```

主なページは `/online`、`/ai`、`/tutorial`、`/deck-builder`、`/deck-shares`、`/history`、`/leaderboard`、`/feedback`、`/profile`、`/rules/qa`、`/rules/errata`、`/admin` です。

## セキュリティと運用

- Cookie session と legacy Bearer token の互換、Redis `GETDEL` による原子的 refresh rotation、double-submit CSRF 保護。
- OAuth 暗号鍵を JWT secret から分離し、Colyseus も同じ account session を検証します。
- 対局 seat token、永続チャット参加証拠、server-side ACL で client の role 詐称を防ぎます。
- 本番 Redis password、trusted proxy allowlist、参加者限定 match log、transaction lock で rate-limit bypass、IDOR、ELO 競合更新を防ぎます。
- PostgreSQL／Redis 依存を確認する platform `/health`、`/ready`、保護された `/metrics`、構造化 log、request ID、Sentry metadata。
- Git hooks：pre-commit は staged format/lint、pre-push は typecheck と test を実行します。

## ドキュメント

- [完全なアーキテクチャ](docs/ARCHITECTURE.md)
- [REST API](docs/API.md)
- [カードテキスト i18n メンテナンスガイド（繁体字中国語）](docs/card-text-i18n.md)
- [公式裁定データベースガイド](docs/official-rulings.md)
- [デプロイガイド](docs/DEPLOYMENT.md)
- [マルチプレイヤープラットフォーム設計](docs/MULTIPLAYER_PLATFORM_ARCHITECTURE.md)
- [マルチプレイヤー整合性監査](docs/MULTIPLAYER_PLATFORM_ALIGNMENT_AUDIT.md)
- [コントリビューションガイド](CONTRIBUTING.md)
- [変更履歴](CHANGELOG.md)
- [負荷テスト](load-tests/README.md)
- [ゲームルール](rules.md) / [公式 Q&A](https://battle.zutomayocard.online/rules/qa) / [公式訂正情報](https://battle.zutomayocard.online/rules/errata)

## ライセンス

本プロジェクトは個人学習と技術研究のみを目的とします。カード画像、商標、関連著作権は ZUTOMAYO／Sony Music Entertainment および各権利者に帰属します。
