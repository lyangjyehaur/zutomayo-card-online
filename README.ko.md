# ZUTOMAYO CARD Online — 온라인 카드 대전 게임

**언어 / Languages:** [繁體中文](README.md) | [日本語](README.ja.md) | [English](README.en.md) | [한국어](README.ko.md)

현재 버전: **0.2.6**

> ZUTOMAYO 공식 TCG인 ZUTOMAYO CARD를 디지털화한 비공식 대전 플랫폼입니다.
> 로컬 2인 대전, AI 연습, 인터랙티브 튜토리얼, 실시간 온라인 대전을 지원합니다.

## 프로젝트 현황

0.2.0에서는 단일 대전 앱을 멀티플레이어 플랫폼으로 확장했습니다. `boardgame.io`는 계속해서 카드 상태의 권위 있는 소스를 담당하고, Colyseus는 로비, 매칭, 방, 초대, 관전자의 presence를 관리하며, ChatService는 영구 채팅, 읽지 않음 상태, 번역, 신고, 운영자 검토를 담당합니다.

0.2.6에서는 라이브 서비스 안정화 기준과 영구 익명 대전 분석을 구축하여 runtime state가 삭제되기 전에 권위 있는 결과, 덱, allowlist 규칙 이벤트를 보관합니다. 또한 결정론적 decision trace, 대전 참가자만 조회할 수 있는 개인정보 보호 리플레이 요약, 배포·복구·알림·신뢰 경계 검수 게이트를 추가했습니다.

### 게임과 대전

- 로컬 2인 대전과 쉬움, 보통, 어려움 AI를 지원합니다. AI는 전략적 멀리건, 효과 및 대상 평가를 사용하며, 어려움 AI는 규칙 기반의 제한된 턴 시뮬레이션으로 수를 계획합니다.
- 플레이 가능한 카드 479장과 도감 전용 카드 7장의 데이터를 제공하며, 플레이 가능한 효과 문구 322개를 모두 파싱합니다. 증분 한정 카드는 이미지, 공식 일본어/영어 문구, 규칙을 각각 검토합니다.
- 가위바위보, 멀리건, 초기 세팅, 효과 순서, 플레이어 선택, 배틀, Chronos 낮/밤 흐름을 구현합니다.
- 권위 있는 페이즈 타이머와 타임아웃 복구로 연결이 끊기거나 응답하지 않는 플레이어가 대전을 영구히 멈추지 않게 합니다.
- 카드별 Chronos 이동, HP/공격/피해 경감/회복 처리 애니메이션, 반응형 전장, 모바일 터치 조작을 제공합니다. 튜토리얼도 실제 대전과 같은 전장 표현을 사용합니다.
- 결과 화면에서 ELO와 전적 전송을 다시 시도할 수 있습니다. 서버 기록은 멱등성을 보장하며, 로컬 기록은 중복을 제거하고 대전 후 채팅 출처를 보존합니다.

### 멀티플레이어 플랫폼

- Colyseus 공개 방 목록, 커스텀 방, 친구 초대, 관전, 로비 친구 presence를 제공합니다. 아직 공개하지 않은 빠른 매칭 진입점은 기본적으로 숨겨져 있습니다.
- 안정적인 대전 전환과 재접속 복구를 지원합니다. 온라인 세션은 플랫폼 신원, 좌석 토큰, boardgame.io credential을 유지합니다.
- 운영 환경은 Redis driver/presence를 사용하고, 로컬 개발에서는 memory mode를 사용할 수 있습니다.
- Colyseus는 플랫폼 셸 상태만 저장하며 손패, 덱, 효과 등 권위 있는 게임 데이터는 다루지 않습니다.

### 소셜과 채팅

- 친구 관리, 친구 온라인 상태, 대전 초대를 지원합니다.
- 전체 로비, 친구 개인 채팅, 커스텀 방, 대전 중, 대전 후 채팅을 제공합니다.
- 대화 간 읽지 않음 요약, 읽음 커서, 메시지 번역, 신고, 삭제 후에도 남는 증거 스냅샷을 지원합니다.
- 운영자는 전체 대화 증거를 확인하고 신고를 처리하며 여러 대화 유형에 적용되는 지속적 음소거 처분을 내릴 수 있습니다.
- ChatService와 PostgreSQL이 사실의 원천이며, Colyseus는 메시지 본문이 없는 동기화 신호만 전송합니다.

### 기타 제품 기능

- 번체 중국어, 광둥어, 간체 중국어, 일본어, 영어, 한국어의 6개 UI 언어를 지원합니다.
- 덱 편집기, 카드 메타데이터와 시너지 추천을 포함한 덱 공유 및 카드 도감, 랭킹, 기기 간 전적, 프로필, OAuth 신원, 피드백 보드를 제공합니다.
- 카드 이름/효과/곡명, 공식 Q&A, 규칙 섹션, 정오표, 공개 덱을 대상으로 하는 다국어 전체 및 페이지별 전문 검색을 제공합니다. IME 조합 중에는 요청을 보내지 않습니다.
- 공식 Grand Rules와 기본 Floor Rules, 일본어 Q&A 및 정오표, 현지화된 열람 페이지, 수동 교정 및 출처 동기화 관리자 화면을 제공합니다.
- PWA 설치/업데이트 안내와 app, build, rules 3단계 버전 호환성 검사를 제공합니다.
- Refine 5 관리자 화면에서 카드/한정 카드, 번역, 사용자, ELO, 채팅 증거, 처분, 공지, 공식 판정을 통합 관리합니다.
- Playwright 핵심 E2E, k6 API/WebSocket/인증/매칭 부하 테스트, staging/production CD 파이프라인을 제공합니다.

## 아키텍처

```text
Browser / PWA
  |- HTTP + Socket.IO --> game :3000
  |                        boardgame.io 권위 대전, 정적 프런트엔드, /api 프록시
  |- HTTP -------------> api :3001
  |                        계정, 덱, 전적, 친구, ChatService, 관리
  `- WebSocket --------> platform :3002
                           Colyseus 로비, 매칭, 방, 초대, 관전

game / api / platform
  |- PostgreSQL: 영구 데이터, 대전 상태, 참가자, 채팅 증거
  |- Redis: Pub/Sub, Colyseus presence/driver, 속도 제한, 일시적 조정
  `- Meilisearch: PostgreSQL에서 원자적으로 재구성하는 공개 지식 전문 색인
```

### 권위 경계

| 영역                | 사실의 원천                  | 책임                                                 |
| ------------------- | ---------------------------- | ---------------------------------------------------- |
| 카드 대전           | `boardgame.io` + `GameLogic` | 숨은 정보, 합법 행동, 타이머, 효과, 승패, action log |
| 멀티플레이어 플랫폼 | Colyseus                     | 로비, 방 수명 주기, 매칭, 초대, presence, 관전자     |
| 채팅                | ChatService + PostgreSQL     | 기록, ACL, 읽지 않음 상태, 번역, 신고, 검토, 음소거  |
| 제품 데이터         | PostgreSQL                   | 계정, 덱, 전적, 친구, 설정, 피드백                   |
| 일시적 조정         | Redis                        | 노드 간 동기화, 방 검색, 속도 제한, 호환성 큐        |

### 주요 기술

| 계층   | 기술                                                             |
| ------ | ---------------------------------------------------------------- |
| Web    | React 19, React Router 7, TypeScript 5.8, Vite 7, Tailwind CSS 4 |
| 대전   | boardgame.io 0.50, 결정론적 `GameState.step` 상태 머신           |
| 플랫폼 | Colyseus, `colyseus.js`, Redis presence/driver                   |
| 백엔드 | Node.js, Koa/Node HTTP, PostgreSQL, Redis, Zod                   |
| 품질   | Vitest, fast-check, Playwright, k6, ESLint, Prettier, Husky      |
| 운영   | Docker Compose, GitHub Actions CI/CD, Pino, Prometheus, Sentry   |

## 로컬 개발

### 요구 사항

- Node.js `>=20`; CI와 Docker는 Node 22를 사용합니다.
- npm 10 이상.
- 전체 온라인 흐름에는 PostgreSQL과 Redis가 필요합니다. Colyseus는 memory mode로 단독 실행할 수 있습니다.

### 설치와 실행

```bash
npm ci
cp .env.example .env

# 백엔드 의존성, schema, REST API, Colyseus platform
docker compose up -d postgres redis migrate api platform

# Vite 프런트엔드(HMR), http://localhost:3000
npm run dev
```

실제 boardgame.io 서버가 필요하면 Compose의 `game`을 실행하거나, `.env` 변수를 불러온 셸에서 `npm run build && npm run server`를 실행합니다. `npm run platform`은 memory mode로 플랫폼 서비스를 단독 실행할 수 있습니다. 독립 API는 환경 변수를 불러온 후 `cd api && npm ci && npm start`로 실행합니다.

### 자주 사용하는 명령

| 명령                                           | 용도                                                   |
| ---------------------------------------------- | ------------------------------------------------------ |
| `npm run verify`                               | 포맷, 정책, 설정, lint, 타입, coverage, 운영 빌드 검사 |
| `npm test` / `npm run test:watch`              | Vitest 일회 실행/감시 모드                             |
| `npm run typecheck`                            | 애플리케이션과 서버 TypeScript 검사                    |
| `npm run typecheck:scripts`                    | scripts TypeScript 검사                                |
| `npm run lint`                                 | ESLint 실행                                            |
| `npm run format:check:tracked`                 | Git 추적 파일만 Prettier 검사                          |
| `npm run build`                                | 타입 검사 후 운영 프런트엔드 bundle 생성               |
| `npm run server`                               | game/boardgame.io 서버 실행                            |
| `npm run platform`                             | Colyseus 플랫폼 서비스 실행                            |
| `npm run db:migrate`                           | PostgreSQL migration 적용                              |
| `npm run import:official-rulings-translations` | 추적하지 않는 공식 판정 번역을 PostgreSQL에 가져오기   |
| `npm run release:official-rulings`             | 최신 공식 출처와 5개 정적 번역을 원자적으로 배포       |
| `npm run search:reindex` / `search:check`      | 공개 지식 검색 색인을 원자적으로 재구성/검사           |
| `npm run sync:official-rulings`                | 공식 Q&A/정오표 출처 차이를 읽기 전용으로 검사         |
| `npm run translate:official-rulings`           | 누락된 공식 판정 파생 번역 생성                        |
| `npm run smoke`                                | 핵심 게임 흐름 smoke test                              |
| `npm run smoke:api`                            | REST API 통합 smoke test                               |
| `npm run smoke:online`                         | boardgame.io 온라인 대전 smoke test                    |
| `npm run smoke:platform-deployment`            | 플랫폼 상태와 실제 로비 WebSocket join/leave 검사      |
| `npm run smoke:responsive`                     | 전체 반응형 브라우저 smoke test                        |
| `npm run rule:audit`                           | 카드 효과 parser 적용 범위 감사                        |
| `npm run e2e` / `npm run e2e:ui`               | Playwright 전체 E2E/인터랙티브 UI                      |
| `npm run load:api` / `load:ws`                 | k6 API/WebSocket 부하 테스트(k6 별도 설치)             |

## Docker 배포

```bash
cp .env.example .env
# 최소한 PG_PASSWORD, REDIS_PASSWORD, 길이 32 이상의 JWT_SECRET을 설정합니다.
docker compose up -d --build
docker compose ps
```

Compose는 `postgres`, `redis`, 내부 `meilisearch`, 일회성 `migrate`, `game`, `api`, `platform`의 7개 단위로 구성됩니다. Meilisearch는 host port를 공개하지 않으며, 운영 환경에서는 별도의 `MEILI_MASTER_KEY`를 설정해야 합니다.

저장소는 `docker-compose.e2e.yml`, `docker-compose.load-test.yml`, 격리된 port/database를 사용하는 `docker-compose.staging.yml`도 제공합니다. Production hardening CD는 현재 `codex/deferred-production-hardening`에 분리되어 있으며, staging/production SSH 배포는 검증된 artifact를 사용해 `workflow_dispatch`로 명시적으로 실행합니다.

| Port   | 서비스   | 용도                                              |
| ------ | -------- | ------------------------------------------------- |
| `3000` | game     | Web/PWA, boardgame.io, Socket.IO, `/api/*` 프록시 |
| `3001` | api      | REST API, ChatService, 계정, 관리                 |
| `3002` | platform | Colyseus WebSocket 방, `/health`, `/ready`        |

운영 환경, 외부 PostgreSQL/Redis, 백업, migration, 수평 확장에 대한 자세한 내용은 [배포 가이드](docs/DEPLOYMENT.md)를 참고하십시오. 공식 Q&A/정오표 동기화, 가져오기, 번역 절차는 [공식 판정 데이터베이스 가이드](docs/official-rulings.md)에 설명되어 있습니다.

## 저장소 구조

```text
src/game/             권위 규칙, AI, 효과, 카드 로딩, 대전 테스트
src/components/       대전, 튜토리얼, 로비, 공용 React 기능
src/ui/               디자인 토큰, primitive, layout, 전장 UI
src/pages/            route 단위 페이지
src/platform/         Colyseus runtime, 방, 신원, 영속성 adapter
src/chat/             개인 채팅 키, 대전 채팅 ACL, 읽지 않음 탐색
src/server/           PostgreSQL, Redis, 속도 제한, 관측성 확장
api/                  REST API와 계정, 친구, 채팅, 전적, 관리 서비스
migrations/           node-pg-migrate schema 이력
scripts/              smoke, migration, 배포, 감사 도구
e2e/                  Playwright 인증, 덱, 튜토리얼, smoke 시나리오
load-tests/           k6 API, WebSocket, 인증, 매칭 부하 테스트
docs/                 아키텍처, API, 배포, 멀티플레이어, UI/UX 문서
```

주요 페이지는 `/online`, `/ai`, `/tutorial`, `/deck-builder`, `/deck-shares`, `/history`, `/leaderboard`, `/feedback`, `/profile`, `/rules/grand`, `/rules/floor`, `/rules/qa`, `/rules/errata`, `/admin`입니다.

## 보안과 운영

- Cookie session과 기존 Bearer token 호환, Redis `GETDEL` 기반의 원자적 refresh token 교체, double-submit CSRF 보호를 사용합니다.
- OAuth token 암호화 키와 JWT secret을 분리하며, Colyseus도 같은 계정 session을 검증합니다.
- 대전 좌석 token, 영구 채팅 참가 증거, 서버 측 ACL로 클라이언트의 역할 위조를 방지합니다.
- 운영 Redis 비밀번호, 신뢰 proxy allowlist, 참가자 전용 전적 log, transaction lock으로 속도 제한 우회, IDOR, 동시 ELO 덮어쓰기를 방지합니다.
- Platform `/health`는 PostgreSQL/Redis 의존성을 검사합니다. `/ready`, 보호된 `/metrics`, 구조화 log, request ID, Sentry metadata를 운영에 사용합니다.
- Git hook: pre-commit은 staged format/lint를, pre-push는 타입 검사와 테스트를 실행합니다.

## 문서

- [전체 아키텍처](docs/ARCHITECTURE.md)
- [REST API](docs/API.md)
- [카드 문구 i18n 유지보수 가이드(번체 중국어)](docs/card-text-i18n.md)
- [공식 판정 데이터베이스 가이드](docs/official-rulings.md)
- [배포 가이드](docs/DEPLOYMENT.md)
- [멀티플레이어 플랫폼 아키텍처](docs/MULTIPLAYER_PLATFORM_ARCHITECTURE.md)
- [멀티플레이어 정합성 감사](docs/MULTIPLAYER_PLATFORM_ALIGNMENT_AUDIT.md)
- [기여 가이드](CONTRIBUTING.md)
- [변경 기록](CHANGELOG.md)
- [부하 테스트](load-tests/README.md)
- [게임 규칙](rules.md) / [공식 Q&A](https://battle.zutomayocard.online/rules/qa) / [공식 정오표](https://battle.zutomayocard.online/rules/errata)

## 라이선스

이 프로젝트는 개인 학습과 기술 연구 목적으로만 제공됩니다. 카드 아트, 상표 및 관련 저작권은 ZUTOMAYO/Sony Music Entertainment와 각 권리자에게 있습니다.
