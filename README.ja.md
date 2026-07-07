# ZUTOMAYO CARD Online — オンライン対戦カードゲーム

**言語 / Languages:** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md)

> ZUTOMAYO CARD（ずっと真夜中でいいのに。公式 TCG）をデジタル化したオンライン対戦プラットフォーム。
> ローカル 2 人対戦、AI 練習、オンラインリアルタイム対戦に対応し、公式ルールを実装しています。

---

## ゲーム概要

ZUTOMAYO CARD は、日本のバンド「ずっと真夜中でいいのに。」をテーマにした 2 人対戦型トレーディングカードゲーム（TCG）です。

**主な仕組み:**

- 各プレイヤーは 20 枚デッキ、初期 HP は 100
- **Chronos 昼夜システム** — 円形クロックが現在の NIGHT / DAY を決定し、キャラクターの攻撃力に影響
- **3 種類のカードタイプ** — Character、Enchant、Area Enchant
- **5 種類の属性** — 闇、炎、電気、風、カオス
- **じゃんけん開始** — 夜側プレイヤーを決定
- **追い上げ機構** — 敗者は次のターンに 2 枚プレイ可能

---

## 機能一覧

### ゲームモード

- **ローカル対戦** — 同じ画面で 2 人対戦
- **AI 練習** — 簡単 / 普通 / 困難の 3 段階。困難モードは lookahead シミュレーションを使用
- **オンライン対戦** — boardgame.io WebSocket リアルタイム同期、マッチングキュー、再接続対応

### カードシステム

- 422 枚の完全なカードデータ（4 パック）
- 267 行の効果テキストをすべて解析（100% カバレッジ）
- 効果ルールエンジンは 30 種以上のアクションタイプと 15 種以上の条件タイプに対応
- 250 枚の効果カード × 6 言語翻訳（LLM 生成）

### UI/UX

- **フルスクリーン・スクロールなし** — 100vh / 100vw のゲーム画面
- **レスポンシブデザイン** — デスクトップ / タブレット / スマートフォンに適応
- **Design System v1** — セマンティック token と共通 layout / primitive / game UI コンポーネント
- **6 言語対応** — 繁體中文（台灣）、粵語（香港）、簡體中文、日本語、English、한국어
- **インタラクティブチュートリアル** — 初心者向けガイドでルールを段階的に学習
- **デッキエディター** — 422 枚のカードをフィルター / ソート / 構築。サーバー同期とローカルカスタムデッキに対応
- **対戦履歴** — ローカル履歴記録
- **ランキング** — ELO レーティングシステム
- **プロフィールページ** — アカウント情報、OAuth 連携、パスワード変更、Logto Account Center 連携
- **フィードバックボード** — 匿名 / ログイン投稿、投票、コメント、タグ、ステータス、重複マーク、画像添付
- **PWA とバージョン通知** — インストール通知、更新通知、バージョン互換チェック、再接続通知

### 管理画面

- カードデータブラウザー（フィルター / 検索 / 詳細）
- カードデータと効果翻訳の編集、ゲームサーバーのホットリロード
- i18n 翻訳管理と About / コミュニティリンク設定
- ユーザー一覧と ELO リセット
- フィードバックボードのモデレーション（ステータス、タグ、削除、重複マーク）
- Admin token ログイン（`/api/admin/login`、パスワードは `ADMIN_PASSWORD` 環境変数で指定）

### アカウントと運用

- Cookie session と legacy Bearer token の互換
- ローカル email/password、Logto、Google、GitHub、Discord OAuth（環境変数で有効化）
- Cloudflare Turnstile 検証 hook（任意）
- オンライン人数 presence heartbeat
- Sentry / GlitchTip エラー追跡、Pino 構造化 log、Prometheus `/metrics`
- `/health` ヘルスチェックと stale match 自動クリーンアップ

---

## 技術構成

```text
┌─────────────────────────────────────────────┐
│            Frontend (Vite + React)          │
│  React 19 · TypeScript · React Router 7     │
│  Tailwind CSS 4 · daisyUI 5 · Lucide        │
│  boardgame.io Client · PWA · Sentry         │
└──────────────────┬──────────────────────────┘
                   │ HTTP / WebSocket
┌──────────────────┴──────────────────────────┐
│            Game Server (port 3000)          │
│  boardgame.io Server · Koa · Socket.IO      │
│  Redis Adapter (Pub/Sub) · /api/* proxy     │
│  Health / Metrics / Rate Limit              │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴────────────────────────────┐
│             API Server (port 3001)            │
│  Node HTTP · PostgreSQL · Redis · HMAC tokens │
│  Accounts / OAuth / Decks / Matches / Feedback / Admin │
└───────────────────────────────────────────────┘
```

### 技術スタック

| 領域                           | 技術                                             | バージョン |
| ------------------------------ | ------------------------------------------------ | ---------- |
| UI フレームワーク              | React                                            | 19         |
| ルーティング                   | React Router                                     | 7          |
| CSS フレームワーク             | Tailwind CSS + daisyUI 5 + Lucide React アイコン | 4 / 5      |
| マルチプレイヤーフレームワーク | boardgame.io                                     | 0.50.2     |
| ビルドツール                   | Vite                                             | 7          |
| 言語                           | TypeScript（strict モード）                      | 5.8        |
| テスト                         | vitest（`@vitest/coverage-v8` を含む）           | 4          |
| プロパティベーステスト         | fast-check                                       | 4          |
| コードスタイル                 | ESLint（typescript-eslint）                      | 9          |
| フォーマット                   | Prettier                                         | 3          |
| TypeScript 実行                | tsx                                              | 4          |
| PWA                            | vite-plugin-pwa                                  | 1          |
| アナリティクス                 | Umami + web-vitals                               | -          |
| エラー追跡                     | Sentry / GlitchTip                               | 10         |
| 構造化ログ                     | Pino                                             | 10         |
| メトリクス                     | prom-client                                      | 15         |
| バリデーション                 | zod                                              | 4          |
| バックエンド                   | Node HTTP + PostgreSQL + Redis（pg / ioredis）   | Node >=20  |

### コアゲームエンジン

```text
じゃんけん → 引き直し → 初期設定 → カードプレイ → 効果処理 → バトル → ターン終了
```

- **決定的なステートマシン** — `GameState.step` で駆動し、boardgame.io のターン制には依存しない
- **効果ルールエンジン** — 日本語の効果テキストを構造化されたゲームアクションへマッピング。267 行の効果をカバー（100%）し、複数回の独立レビューで検証済み
- **playerView** — オンライン対戦時に相手の手札、デッキ、伏せカードを隠す
- **バージョン互換チェック** — ルーム作成、参加、再開時に app / build / rules version を比較し、異なるバージョンの対戦を防止
- **水平スケーリング対応** — boardgame.io state は PostgreSQL adapter、Socket.IO と boardgame.io Pub/Sub は Redis を使用

### データ保存

| データ                | 保存場所                                      | 説明                                                         |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| カードデータ          | PostgreSQL (`api/server.cjs`)                 | API / game server で共有される動的カードデータ               |
| カード画像            | Cloudflare R2 (`r2.dan.tw`)                   | 422 枚のカード画像 CDN                                       |
| ユーザーアカウント    | PostgreSQL (`api/server.cjs`)                 | 登録 / ログイン / ELO / session / OAuth 身元                 |
| デッキ                | PostgreSQL + localStorage                     | サーバー同期 + ローカルバックアップ + ローカルカスタムデッキ |
| 対戦履歴              | PostgreSQL + localStorage                     | ELO 変動 + 履歴 + クリーン済み action log                    |
| オンライン対戦状態    | PostgreSQL + Redis                            | boardgame.io state、metadata、クロスノード同期               |
| マッチング / presence | Redis                                         | マッチングキュー、rate limit、オンライン人数                 |
| フィードバックデータ  | PostgreSQL + ローカルアップロードディレクトリ | 投稿、投票、コメント、タグ、画像添付                         |
| 動的設定              | PostgreSQL (`game_config`)                    | About ページ、プリセットデッキ、管理可能な設定               |
| オンライン Session    | localStorage                                  | オンライン対戦の再接続情報                                   |
| 言語設定              | localStorage                                  | ブラウザー内保存                                             |

---

## ローカル開発

### 必要環境

- Node.js `>=20`（`package.json` の `engines` を参照。CI と Docker は Node 22 を使用）
- npm 10+

### インストールと起動

```bash
# 依存関係をインストール
npm install

# フロントエンド開発（Vite dev server）
npm run dev
# → http://localhost:3000

# API サーバー
cd api && npm install && npm start
# → http://localhost:3001

# ゲームサーバー（boardgame.io を含む）
npm run build
npm run server
# → http://localhost:3000（ゲーム + API プロキシ）
```

### 開発コマンド一覧

| コマンド                                | 説明                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`                           | Vite dev server を起動                                                             |
| `npm run build`                         | TypeScript チェック（`typecheck` + `typecheck:scripts`）後に Vite 本番ビルドを実行 |
| `npm run typecheck`                     | `tsc --noEmit` で app コードをチェック                                             |
| `npm run typecheck:scripts`             | `tsc --noEmit -p tsconfig.scripts.json` で scripts コードをチェック                |
| `npm run lint`                          | ESLint チェック                                                                    |
| `npm run lint:fix`                      | ESLint 自動修正                                                                    |
| `npm run format`                        | Prettier で整形して書き込み                                                        |
| `npm run format:check`                  | Prettier 整形チェック（CI 用）                                                     |
| `npm test`                              | vitest ユニットテスト（単発実行）                                                  |
| `npm run test:watch`                    | vitest ウォッチモード                                                              |
| `npm run test:coverage`                 | カバレッジ付き vitest ユニットテスト                                               |
| `npm run smoke`                         | ゲームロジック smoke テスト                                                        |
| `npm run smoke:api`                     | アカウント / デッキ / 対戦 / ランキング API loop                                   |
| `npm run smoke:online`                  | オンライン対戦 smoke テスト                                                        |
| `npm run smoke:online-consistency`      | オンライン対戦一貫性 smoke テスト                                                  |
| `npm run smoke:responsive`              | すべてのレスポンシブ UI smoke テストを実行                                         |
| `npm run smoke:ui-responsive`           | ロビー / 基本 UI のレスポンシブ smoke テスト                                       |
| `npm run smoke:admin-responsive`        | 管理画面のレスポンシブ smoke テスト                                                |
| `npm run smoke:battle-responsive`       | 対戦画面のレスポンシブ smoke テスト                                                |
| `npm run smoke:online-lobby-responsive` | オンラインロビーのレスポンシブ smoke テスト                                        |
| `npm run smoke:tools-responsive`        | ツール画面のレスポンシブ smoke テスト                                              |
| `npm run rule:audit`                    | 効果解析カバレッジ監査                                                             |
| `npm run seed:cards`                    | `SEED_CARDS_URL` / `SEED_CARD_API_URL` から PostgreSQL へカードデータをインポート  |
| `npm run migrate:sqlite-to-pg`          | 旧 SQLite データを PostgreSQL へ移行（`users` / `decks` / `matches`、再実行可能）  |
| `npm run server`                        | boardgame.io ゲームサーバーを起動                                                  |
| `npm run preview`                       | Vite 本番ビルドをプレビュー                                                        |

### テスト

```bash
npm run smoke            # ゲームロジックテスト
npm run smoke:api        # アカウント / デッキ / 対戦 / ランキング API loop
npm run smoke:online     # オンライン対戦テスト
npm run smoke:responsive # レスポンシブ UI smoke テスト
npm run rule:audit       # 効果解析カバレッジ監査
```

> `smoke:api` と `smoke:online` には PostgreSQL + Redis コンテナーが必要です。実行前に起動してください:
>
> ```bash
> docker compose up -d postgres redis
> ```
>
> `smoke`（ゲームロジック）と `rule:audit`（効果解析監査）は純粋なゲームロジックテストであり、PG / Redis は不要です。

### ビルド

```bash
npm run build          # TypeScript チェック + Vite 本番ビルド
```

---

## Docker デプロイ

```bash
# 4 サービスをビルドして起動
docker compose up -d --build

# 状態を確認
docker compose ps
docker compose logs -f
```

サービスポート:

- `3000` — ゲームフロントエンド + boardgame.io マルチプレイヤー
- `3001` — API サーバー（アカウント / デッキ / 戦績）

詳細は [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) を参照してください。

---

## プロジェクト構成

```text
zutomayo-card-online/
├── src/
│   ├── game/                  # ゲームエンジン
│   │   ├── GameLogic.ts       # コアルール（ターン、バトル、ダメージ）
│   │   ├── Game.ts            # boardgame.io Game 定義
│   │   ├── types.ts           # 型定義
│   │   ├── ai.ts              # AI 相手ロジック（簡単 / 普通 / 困難）
│   │   ├── useAIMoves.ts      # React hook: AI 自動プレイ
│   │   ├── chronos.ts         # Chronos 昼夜システム
│   │   ├── matchHistory.ts    # 対戦履歴
│   │   ├── cards/             # カードデータ読み込みとデッキ構築
│   │   │   ├── loader.ts      # カードデータ読み込み（ローカル + API）
│   │   │   ├── deckBuilder.ts # デッキ構築バリデーション
│   │   │   ├── presetDecks.ts # プリセットデッキ
│   │   │   ├── customDeck.ts  # ローカルカスタムデッキ（localStorage）
│   │   │   └── i18n.ts        # カード翻訳ツール
│   │   ├── effects/           # 効果エンジン
│   │   │   ├── parser.ts      # 日本語効果テキスト → 構造化データ
│   │   │   ├── executor.ts    # 構造化データ → ゲーム状態変更
│   │   │   ├── types.ts       # 効果型定義
│   │   │   └── choices.ts     # プレイヤー選択フロー
│   │   └── __tests__/         # ゲームエンジンテスト
│   │       ├── chronos.test.ts
│   │       └── invariants.test.ts
│   ├── components/            # React コンポーネントと feature コンポーネント
│   │   ├── Board.tsx          # メインゲーム画面（~78K）
│   │   ├── AIGame.tsx         # AI 対戦 UI ロジック
│   │   ├── OnlineGame.tsx     # オンライン対戦 UI ロジック
│   │   ├── OnlineRoomInfo.tsx # オンラインルーム情報パネル
│   │   ├── OnlinePresenceBadge.tsx # オンライン人数表示
│   │   ├── DeckEditor.tsx     # デッキエディター
│   │   ├── DeckBuilderWorkspace.tsx # デッキ構築ワークスペース
│   │   ├── CardBrowser.tsx    # カードブラウザー
│   │   ├── GameTutorialOverlay.tsx # インタラクティブチュートリアル overlay
│   │   ├── NetworkStatusNotifier.tsx # ネットワーク状態通知
│   │   ├── PwaInstallPrompt.tsx # PWA インストール通知
│   │   ├── PwaStatusPrompt.tsx # PWA 更新通知
│   │   ├── ErrorBoundary.tsx  # フロントエンドエラー境界
│   │   ├── LanguageSwitcher.tsx # 言語切り替え
│   │   ├── MatchHistory.tsx   # 対戦履歴
│   │   └── lobby/             # ロビーサブコンポーネント
│   │       ├── AuthSection.tsx      # ログイン / 登録エリア
│   │       ├── DeckSelector.tsx     # デッキ選択
│   │       ├── DifficultyButtons.tsx # 難易度ボタン（AI モード）
│   │       ├── RoomPanel.tsx        # オンラインルーム / マッチングパネル
│   │       └── shared.ts            # 共通型
│   ├── ui/                    # Design System v1
│   │   ├── primitives/        # Button / Panel / Sheet / Dialog / Toolbar など
│   │   ├── layout/            # AppHeader / PageShell / PageHeader
│   │   ├── game/              # バトル UI コンポーネントと responsive viewport ツール
│   │   ├── feedback/          # フィードバックページ共通状態 UI
│   │   ├── forms/             # フォームコンポーネント
│   │   └── tokens/            # colors / spacing / typography / z-index / motion
│   ├── pages/                 # ページルート
│   │   ├── LobbyPage.tsx      # ホームロビー
│   │   ├── AILobbyPage.tsx    # AI モードメニュー
│   │   ├── AIGamePage.tsx     # AI 対戦ページ
│   │   ├── OnlineLobbyPage.tsx # オンラインモードメニュー
│   │   ├── OnlineGamePage.tsx # オンライン対戦ページ
│   │   ├── TutorialGamePage.tsx # チュートリアル対戦ページ
│   │   ├── DeckEditorPage.tsx # デッキエディター（ルート版）
│   │   ├── MatchHistoryPage.tsx # 対戦履歴
│   │   ├── LeaderboardPage.tsx # ランキング
│   │   ├── FeedbackPage.tsx   # フィードバックボード
│   │   ├── ProfilePage.tsx    # プロフィール / OAuth 身元
│   │   ├── BattleVisualQaPage.tsx # バトル画面ビジュアル QA
│   │   ├── AdminPage.tsx      # 管理画面
│   │   └── I18nManager.tsx    # i18n 翻訳管理
│   ├── i18n/                  # 国際化
│   │   ├── index.ts           # i18n コア（t() / translate()）
│   │   ├── zh-TW.ts           # 繁體中文（台灣）
│   │   ├── zh-HK.ts           # 粵語（香港）
│   │   ├── zh-CN.ts           # 簡體中文
│   │   ├── ja.ts              # 日本語
│   │   ├── en.ts              # English
│   │   └── ko.ts              # 한국어
│   ├── api/                   # API クライアント
│   │   ├── client.ts          # fetch wrapper（認証 / デッキ / 対戦 / マッチング / 管理）
│   │   └── feedbackClient.ts  # フィードバック API クライアント
│   ├── server/                # ゲームサーバー拡張
│   │   ├── db/
│   │   │   └── postgres-adapter.ts # PostgreSQL アダプター
│   │   ├── observability/     # Pino log と Prometheus metrics
│   │   ├── rateLimit.ts       # Redis rate limit
│   │   └── transport/
│   │       └── redis-pubsub.ts     # Redis Pub/Sub トランスポート層
│   ├── analytics.ts           # Umami page view / identify
│   ├── sentry.ts              # フロントエンド Sentry / GlitchTip 初期化
│   ├── webVitals.ts           # Web Vitals 送信
│   ├── version.ts             # app / build / rules version 互換チェック
│   ├── clientVersion.ts       # フロントエンド version check API
│   ├── anonymousIdentity.ts   # 匿名プレイヤー身元
│   ├── onlineSession.ts       # オンライン Session 管理（localStorage 永続化）
│   ├── onlineRoomStatus.ts    # オンラインルーム状態ポーリング
│   ├── onlineStateGuard.ts    # オンライン状態ガード
│   ├── server.ts              # boardgame.io ゲームサーバー入口
│   ├── App.tsx                # アプリ入口（ルーティング + NavBar + チュートリアル + 再接続）
│   └── main.tsx               # React DOM マウントポイント
├── api/                       # API サーバー
│   ├── server.cjs             # Node HTTP + PostgreSQL + Redis + OAuth + feedback
│   ├── *Service.cjs           # アカウント、デッキ、対戦、マッチング、カード、フィードバックサービス
│   ├── schemas.cjs            # zod request schema
│   ├── validate.cjs           # リクエスト検証
│   ├── observability.cjs      # API log / metrics / request tracing
│   ├── package.json
│   └── Dockerfile
├── scripts/                   # テストとユーティリティスクリプト
│   ├── game-smoke.ts          # ゲームロジック smoke test（~148K）
│   ├── api-smoke.ts           # API 統合 smoke test
│   ├── online-smoke.ts        # オンライン対戦 smoke test
│   ├── rule-audit.ts          # 効果解析カバレッジ監査
│   ├── effect-smoke.ts        # 効果エンジンユニットテスト
│   ├── seed-cards-pg.ts       # カードデータを PostgreSQL へインポート
│   ├── migrate-sqlite-to-pg.ts # SQLite → PostgreSQL 移行
│   ├── migrate-users-to-logto.cjs # ローカルユーザー → Logto 移行
│   ├── *responsive-smoke.mjs  # レスポンシブ UI smoke テスト
│   ├── pg-backup.sh           # PostgreSQL バックアップ
│   ├── deploy-server4.sh      # server4 デプロイ補助スクリプト
│   └── semantic-audit-dump.ts # セマンティック監査データ出力
├── data/                      # 翻訳と OCR レビューデータ
├── qa.json                    # 74 件の公式 Q&A
├── rules.md                   # 完全なゲームルール
├── Dockerfile                 # ゲームサーバーイメージ
├── docker-compose.yml         # 4 サービスデプロイ（PG + Redis + game + api）
└── docs/
    ├── API.md                 # REST API ドキュメント
    ├── DEPLOYMENT.md          # デプロイガイド
    └── uiux/                  # UI/UX デザインシステムとリファクタ文書
```

---

## 効果エンジン

### カバレッジ

```text
総カード数: 422 枚
効果カード: 250 枚
効果行: 267 行
解析済み: 267 行 (100%)
未解析: 0
部分解析: 0
```

### アーキテクチャ

```text
日本語効果テキスト → parseEffect() → { trigger, conditions[], action }
                                      ↓
                                executeEffect() → ゲーム状態変更
```

### 対応する効果タイプ（数の多い順）

| タイプ                  | 説明                                         | 数   |
| ----------------------- | -------------------------------------------- | ---- |
| boostAttack             | 攻撃力増加                                   | 150  |
| requestChoice           | プレイヤー選択（深淵 / 手札 / 並び替えなど） | 30   |
| heal                    | HP 回復                                      | 13   |
| damageReduce            | ダメージ軽減                                 | 7    |
| moveSelfAreaEnchant     | Area Enchant の自動移動                      | 5    |
| clockSet                | クロック設定                                 | 4    |
| returnAreaEnchantToDeck | Area Enchant をデッキへ戻す                  | 4    |
| useFromAbyss            | 深淵からカードを使用                         | 3    |
| reduceAttack            | 攻撃力減少                                   | 3    |
| swapAttack              | 昼夜攻撃力の反転                             | 2    |
| drawCards               | ドロー                                       | 2    |
| millDeckToAbyss         | デッキを深淵へ送る                           | 2    |
| directDamage            | 直接ダメージ                                 | 2    |
| clockAdvance            | クロック進行                                 | 2    |
| その他（17 種）         | 特殊効果                                     | 各 1 |

### 対応する条件タイプ

| 条件                              | 説明                           |
| --------------------------------- | ------------------------------ |
| chronos                           | 昼夜判定（夜 / 昼）            |
| opponentElement / selfElement     | 属性チェック                   |
| hpLessOrEqual / hpComparison      | HP 条件                        |
| opponentPowerCost / selfPowerCost | エネルギー消費条件             |
| zoneCountComparison               | ゾーン内カード数比較           |
| previousCharElement               | 前ターンのキャラクター属性     |
| namedCardInBattleZone             | 指定カードがバトルゾーンにある |
| specificElements                  | 特定属性セット                 |
| drawOccurredThisEffect            | この効果でドローが発生した     |
| battleLost                        | バトル敗北                     |

---

## ルーティング構成

| パス                    | ページ             | 説明                           |
| ----------------------- | ------------------ | ------------------------------ |
| `/`                     | LobbyPage          | ホームロビー（モード切り替え） |
| `/online`               | OnlineLobbyPage    | オンライン対戦メニュー         |
| `/ai`                   | AILobbyPage        | AI 練習メニュー                |
| `/play/ai`              | AIGamePage         | AI 対戦                        |
| `/play/online/:matchID` | OnlineGamePage     | オンライン対戦                 |
| `/tutorial`             | TutorialGamePage   | チュートリアル対戦             |
| `/deck-builder`         | DeckEditorPage     | デッキエディター               |
| `/history`              | MatchHistoryPage   | 対戦履歴                       |
| `/leaderboard`          | LeaderboardPage    | ランキング                     |
| `/feedback`             | FeedbackPage       | フィードバックボード           |
| `/profile`              | ProfilePage        | プロフィール / OAuth 身元管理  |
| `/admin`                | AdminPage          | 管理画面（admin token が必要） |
| `/admin/i18n`           | I18nManager        | i18n 翻訳管理                  |
| `/qa/battle`            | BattleVisualQaPage | バトル画面ビジュアル QA        |

---

## API エンドポイント

### システムと公開データ

| メソッド | パス                      | 認証 | 説明                        |
| -------- | ------------------------- | ---- | --------------------------- |
| GET      | `/api/app-version`        | なし | app / build / rules version |
| GET      | `/api/version`            | なし | app / build / rules version |
| GET      | `/api/cards`              | なし | カード一覧                  |
| GET      | `/api/cards/i18n`         | なし | 全カード効果翻訳            |
| GET      | `/api/cards/:id/i18n`     | なし | 単一カードの効果翻訳        |
| GET      | `/api/config`             | なし | About などの動的設定        |
| GET      | `/api/preset-decks`       | なし | プリセットデッキ            |
| GET      | `/api/leaderboard`        | なし | ランキング                  |
| GET      | `/api/presence`           | なし | 現在のオンライン人数        |
| POST     | `/api/presence/heartbeat` | なし | presence heartbeat を更新   |

### アカウント、OAuth、プロフィール

| メソッド | パス                                         | 認証         | 説明                               |
| -------- | -------------------------------------------- | ------------ | ---------------------------------- |
| POST     | `/api/register`                              | なし         | アカウント登録                     |
| POST     | `/api/login`                                 | なし         | ログイン                           |
| POST     | `/api/logout`                                | Cookie / JWT | ログアウトして session を削除      |
| GET      | `/api/oauth/providers`                       | なし         | OAuth / Logto 設定と provider 一覧 |
| GET      | `/api/oauth/:provider/start`                 | なし         | OAuth ログインまたは身元連携開始   |
| GET      | `/api/oauth/:provider/callback`              | なし         | OAuth callback                     |
| POST     | `/api/oauth/session`                         | なし         | OAuth session 交換                 |
| GET      | `/api/profile`                               | Cookie / JWT | ユーザー情報を取得                 |
| PUT      | `/api/profile`                               | Cookie / JWT | ニックネーム変更                   |
| PUT      | `/api/profile/password`                      | Cookie / JWT | ローカルパスワード変更             |
| GET      | `/api/profile/identities`                    | Cookie / JWT | 連携済み OAuth 身元一覧            |
| DELETE   | `/api/profile/identities/:provider`          | Cookie / JWT | OAuth 身元連携を解除               |
| GET      | `/api/account-center`                        | Cookie / JWT | Logto Account Center 情報取得      |
| POST     | `/api/account-center/verifications/password` | Cookie / JWT | Logto パスワード検証を作成         |
| POST     | `/api/account-center/password`               | Cookie / JWT | Logto 経由でパスワード更新         |

### デッキ、対戦、マッチング

| メソッド | パス                      | 認証 | 説明                                               |
| -------- | ------------------------- | ---- | -------------------------------------------------- |
| GET      | `/api/decks`              | JWT  | デッキ一覧                                         |
| POST     | `/api/decks`              | JWT  | デッキ作成                                         |
| PUT      | `/api/decks/:id`          | JWT  | デッキ更新                                         |
| DELETE   | `/api/decks/:id`          | JWT  | デッキ削除                                         |
| POST     | `/api/matches`            | JWT  | 対戦結果を送信（認証ユーザーは勝者である必要あり） |
| GET      | `/api/matches`            | JWT  | 認証ユーザーの対戦履歴を取得                       |
| GET      | `/api/matches/:id/log`    | なし | クリーン済み action log を取得                     |
| POST     | `/api/matchmaking/queue`  | JWT  | マッチングキューに参加                             |
| GET      | `/api/matchmaking/status` | JWT  | マッチング状態を確認                               |
| DELETE   | `/api/matchmaking/queue`  | JWT  | キューから退出                                     |
| PUT      | `/api/matchmaking/match`  | JWT  | host が boardgame.io matchID を報告                |

### 管理画面

| メソッド | パス                        | 認証  | 説明                               |
| -------- | --------------------------- | ----- | ---------------------------------- |
| POST     | `/api/admin/login`          | なし  | Admin ログイン、admin token を返す |
| GET      | `/api/admin/users`          | Admin | ユーザー一覧を取得                 |
| GET      | `/api/admin/matches`        | Admin | 全対戦一覧を取得                   |
| PUT      | `/api/admin/users/:id/elo`  | Admin | ユーザー ELO をリセット            |
| PUT      | `/api/admin/cards/:id`      | Admin | カードデータ更新                   |
| PUT      | `/api/admin/cards/:id/i18n` | Admin | カード効果翻訳更新                 |
| PUT      | `/api/admin/config/:key`    | Admin | 動的設定更新                       |
| POST     | `/api/admin/cards/reload`   | Admin | ゲームサーバーのカードデータ再読込 |

### フィードバックボード

| メソッド      | パス                                          | 認証         | 説明                          |
| ------------- | --------------------------------------------- | ------------ | ----------------------------- |
| GET           | `/api/feedback/posts`                         | なし         | フィードバック投稿一覧        |
| POST          | `/api/feedback/posts`                         | 匿名 / JWT   | フィードバック投稿作成        |
| GET           | `/api/feedback/posts/:id`                     | なし         | 投稿とコメントを取得          |
| PUT           | `/api/feedback/posts/:id`                     | 作者         | 投稿編集                      |
| POST          | `/api/feedback/posts/:id/votes`               | 匿名 / JWT   | 投稿投票を切り替え            |
| POST          | `/api/feedback/posts/:id/comments`            | 匿名 / JWT   | コメント追加                  |
| GET           | `/api/feedback/posts/:id/voters`              | なし         | 投票者一覧                    |
| PUT           | `/api/feedback/comments/:id`                  | 作者         | コメント編集                  |
| DELETE        | `/api/feedback/comments/:id`                  | 作者 / Admin | コメント削除                  |
| POST          | `/api/feedback/comments/:id/votes`            | 匿名 / JWT   | コメントいいねを切り替え      |
| POST / DELETE | `/api/feedback/comments/:id/reactions/:emoji` | 匿名 / JWT   | コメント emoji 反応を切り替え |
| GET           | `/api/feedback/stats`                         | なし         | フィードバック統計            |
| GET           | `/api/feedback/tags`                          | なし         | タグ一覧                      |
| GET           | `/api/feedback/similar`                       | なし         | 類似投稿検索                  |
| POST          | `/api/feedback/uploads`                       | 匿名 / JWT   | 画像添付アップロード          |
| GET           | `/api/feedback/images/:bkey`                  | なし         | 画像添付を取得                |
| PUT           | `/api/feedback/admin/posts/:id/status`        | Admin        | フィードバックステータス更新  |
| PUT           | `/api/feedback/admin/posts/:id/tag`           | Admin        | フィードバックタグ更新        |
| DELETE        | `/api/feedback/admin/posts/:id`               | Admin        | フィードバック投稿削除        |
| POST          | `/api/feedback/admin/posts/:id/duplicate`     | Admin        | 重複投稿としてマーク          |
| POST          | `/api/feedback/admin/tags`                    | Admin        | タグ作成                      |
| DELETE        | `/api/feedback/admin/tags/:id`                | Admin        | タグ削除                      |

### ゲームサーバーエンドポイント

| メソッド | パス                              | 認証 | 説明                       |
| -------- | --------------------------------- | ---- | -------------------------- |
| GET      | `/health`                         | なし | PG / Redis ヘルスチェック  |
| GET      | `/metrics`                        | なし | Prometheus メトリクス      |
| POST     | `/games/zutomayo-card/:id/join`   | なし | boardgame.io 対戦へ参加    |
| POST     | `/games/zutomayo-card/:id/resume` | なし | credentials 検証と座席復帰 |

レート制限: `/api/login`、`/api/register`、`/api/admin/login` は 10/min、それ以外は 120/min。
ゲームサーバーの `/games/*` ルートにも Redis rate limit があり、既定は 120/min です。

詳細は [docs/API.md](docs/API.md) を参照してください。

---

## 国際化

6 言語に対応し、すべての UI テキストと 250 枚の効果カードに翻訳があります。

| 言語             | コード |
| ---------------- | ------ |
| 繁體中文（台灣） | zh-TW  |
| 粵語（香港）     | zh-HK  |
| 簡體中文         | zh-CN  |
| 日本語           | ja     |
| English          | en     |
| 한국어           | ko     |

翻訳管理: `/admin` → i18n 管理ページ

---

## 関連ドキュメント

- [ゲームルール](rules.md) — 完全な公式ルール
- [公式 Q&A](qa.json) — 74 件の公式 Q&A
- [開発計画](docs/PLAN.md) — Phase 完了状況
- [REST API](docs/API.md) — API エンドポイントドキュメント
- [デプロイガイド](docs/DEPLOYMENT.md) — Docker デプロイ手順

---

## ライセンス

本プロジェクトは個人学習用途です。カードの著作権は ZUTOMAYO / Sony Music Entertainment に帰属します。
