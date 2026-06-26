# Remaining gaps after latest development pass

Last checked: 2026-06-26

Verification baseline:

- Git branch is clean and synchronized with `origin/master` at the time this document was written.
- `npm run rule:audit` reports:
  - total cards: 422
  - effect cards: 250
  - effect lines: 267
  - parsed lines: 238
  - unparsed lines: 29
  - parsed-but-partial heuristic: 49
  - false draw positives: 0

Important caveat: `parsed-but-partial` is conservative. It flags text containing words such as `選`, `好きな`, `入れ替え`, `そうしない場合`, and timing suffixes. Some flagged lines are already fully implemented and tested. Treat it as an audit queue, not a precise missing-feature count.

## 1. Non-card / product gaps

Most non-card core work is now done or partially wired:

- Chronos official mapping: done.
- Online reconnect/resume: done.
- API server with SQLite persistence: done.
- API endpoints for accounts, decks, matches, and leaderboard: exist.
- Leaderboard route/page: exists.
- Server deck save/load helpers: exist.
- Hard AI lookahead / persistence hardening: marked done in `PLAN.md`.

Remaining non-card work is mostly integration and cleanup:

### 1.1 Account frontend integration

Current state:

- `src/api/client.ts` has `register`, `login`, `logout`, `isLoggedIn`, and `getProfile` helpers.
- API routes exist in `api/server.cjs`.
- The React app does not yet expose a complete login/register/logout/profile flow.

Needed:

- Add lobby-visible login/register UI or modal.
- Add logged-in user badge / profile display.
- Add logout button.
- Keep guest mode working.
- Ensure token lifecycle is reflected in React state, not only `localStorage`.

### 1.2 Account-aware deck sync closure

Current state:

- `DeckEditorPage` saves to server via `createDeck()` when `isLoggedIn()` is true.
- `App` loads server decks via `getDecks()`.
- Without login UI, the full user path is incomplete.

Needed:

- Verify end-to-end after account UI exists.
- Let users import/migrate existing localStorage decks into server storage.
- Make deck selector UX clear for preset / local / server decks.
- Keep localStorage fallback for guests.

### 1.3 Match result submission and ELO closure

Current state:

- API client has `submitMatch()`.
- API server has match/leaderboard support.
- Leaderboard page exists.

Needed:

- On online game over, submit result once to `/api/matches` when authenticated.
- Do not trust client-only claims without enough match/session context.
- Do not leak hidden deck/hand contents in submitted payload.
- Reflect ELO/result feedback in UI.

### 1.4 Authenticated match ownership

Current state:

- boardgame.io player credentials are preserved for reconnect/resume.
- Account API exists but is not fully tied to boardgame.io seat ownership.

Needed if accounts are product scope:

- Associate created/joined online seats with the logged-in user.
- Prevent another logged-in user from resuming someone else's seat.
- Keep guest rooms possible if desired.

### 1.5 Online lifecycle polish

Remaining UX details:

- Invite/share link clarity.
- Full-room error handling.
- Waiting-for-opponent state polish.
- Stale-room cleanup policy.
- Browser close / abandon handling.
- Reconnect timer and retry affordance.

### 1.6 Documentation consistency

Current docs have minor drift:

- `README.md` still says Hard AI is heuristic-based, while `PLAN.md` says Hard lookahead is done.
- `NON_CARD_GAPS.md` marks some items done while still keeping older missing bullets.

Needed:

- One final docs pass after the next implementation batch.
- Keep `README.md`, `PLAN.md`, `NON_CARD_GAPS.md`, and `RULE_GAP_AUDIT.md` consistent.

## 2. Card-effect gaps

Card effects are the main remaining implementation area.

### 2.1 Completely unparsed effect lines

These 29 effect lines currently return `null` from `parseEffect()`:

```text
1st_6   アビスにあるエンチャントカードの中から自由に１枚選び、このカードの効果として使う
1st_26  このターンのはじまりの時間から相手の時計分、時間が戻る
1st_86  手札１枚とアビスの好きなカード１枚を入れ替える
1st_92  ※このカードを使用後、手札の数はバトル終了まで１枚増える
2nd_6   このターン、同時にセットした自分のキャラクターカードのパワーコストを★２減らす
2nd_7   このカードを使用中、自分の攻撃力は常に昼の攻撃力となる。相手がエリアエンチャントを出したターンの終了時にアビスに置く
2nd_41  前のターンで使用したキャラクターカードの属性が闇なら、デッキの一番上のカードをパワーがあればパワーチャージャーに、なければアビスに置く
2nd_50  アビスに電気属性のカードがあるなら、相手のHPを20減らす
2nd_58  アビスの闇属性のカード１枚につき、★+１。キャラクターカードを自分のパワーチャージャーに置いたターンの終了時にアビスに置く
3rd_45  相手の手札を公開する
3rd_55  相手のエリアエンチャントをデッキの底に戻し、以後相手はエリアエンチャントをセットできない。相手がアビスにカードを置いたターンの終了時にパワーチャージャーに置く
3rd_61  すべてのカードの時計を１にする。ターンの終了時に、相手のフィールドにエリアエンチャントがあるならパワーチャージャーに置く
3rd_64  お互いの自分のHPの分だけ攻撃力+。相手のHPが40以下になったターンの終了時にアビスに置く
3rd_97  相手はターンの開始時にデッキの一番上を公開する。パワーコストが６以上のカードが山札から公開されたらパワーチャージャーに置く
4th_30  相手のアビスにカードが置かれたとき、すぐにこのカードをアビスに置く
4th_32  相手のエリアエンチャントが置かれているなら、すぐにアビスに置く
4th_33  パワーチャージャーにカードを置いたとき、すぐにこのカードをアビスに置く
4th_41  このターンに（シェードの埃は延長）のキャラクターと入れ替えていたなら、
4th_65  バトルゾーンのカードが（お勉強しといてよ）なら、そのキャラクターのパワーコストを★★減らす。
4th_65  バトルゾーンのキャラクターを（お勉強しといてよ）以外のキャラクターに入れ替えたら、すぐにアビスに置く
4th_89  このカードの効果でカードを引いたなら、手札の数はゲーム終了まで１枚増える
4th_90  相手のアビスにあるカード１枚を、相手のデッキの底に戻す
4th_91  HPが50以下になったなら、パワーチャージャーに置く
4th_94  パワーチャージャーにある（シェードの埃は延長）のキャラクターを１枚選び、このカードの効果として使用する。
4th_94  パワーチャージャーにカードが５枚以上置かれているなら、すぐにアビスに置く
4th_95  バトルに負けたとき、すぐにアビスに置く
4th_99  バトルゾーンのカードが（猫リセット）のキャラクターなら、相手の攻撃力を100にする
4th_100 バトルゾーンのカードが（猫リセット）のキャラクターなら、ターン終了時に、
4th_100 このターンに軽減した数値分のダメージを相手に与える
```

### 2.2 High-value implementation slices

Recommended order:

1. Simple deterministic / reusable choice effects
   - `2nd_50`: Abyss contains 電気 → opponent HP -20.
   - `2nd_41`: previous-turn Character element 闇 → move deck top to Power Charger or Abyss based on power/send-to-power condition.
   - `4th_90`: choose opponent Abyss card and return it to opponent deck bottom using the existing `cardMove` pending-choice path.
   - Goal: reduce unparsed count with low architecture risk.

2. Reveal / hand information / name guess
   - `3rd_45`: reveal opponent hand.
   - `3rd_47`, `3rd_59`, `3rd_94`, `3rd_105`: name a card, reveal one opponent hand card, boost if name matches.
   - Needs a safe hidden-information model and UI that reveals only what the effect allows.

3. Continuous / replacement modifiers
   - `2nd_6`: reduce same-turn Character Power Cost.
   - `2nd_7`: force own attack to use day attack while active.
   - `3rd_61`: set all card clocks to 1.
   - `4th_65`: reduce specific Character Power Cost.
   - `4th_99`: set opponent attack to 100 under condition.
   - Needs modifier recomputation rather than one-time mutation.

4. Area Enchant expiry / zone-entry timing
   - `4th_30`, `4th_32`, `4th_33`, `4th_91`, `4th_94`, `4th_95`.
   - Needs broader event emission for Abyss / Power Charger / battle loss / HP thresholds.

5. Deck reveal / deck order / effect copy
   - `1st_6`, `3rd_97`, `4th_94`, `4th_88` partial deck reorder.
   - Needs UI and hidden-information handling for viewed deck cards.

6. Hand-size and delayed damage memory
   - `1st_92`, `4th_89`: hand size changes for battle/game duration.
   - `4th_100`: remember reduced damage amount and deal it later.

### 2.3 Parsed-but-partial audit queue

`npm run rule:audit` currently flags 49 parsed-but-partial lines. The most important groups are:

- name guess / reveal: `3rd_47`, `3rd_59`, `3rd_94`, `3rd_105`;
- hand reveal count boost: `4th_1`, `4th_7`, `4th_10`, `4th_35`, `4th_91`;
- Area Enchant expiry suffixes: `2nd_5`, `2nd_86`, `2nd_98`, `3rd_58`, `3rd_85`, `3rd_86`, `3rd_91`, `3rd_92`, `3rd_98`, `3rd_104`;
- deck view/reorder: `4th_88`;
- already implemented but still conservatively flagged: `4th_53`, `4th_54`, `4th_58`, `4th_61`, `4th_62`, `4th_63`, `4th_6`, `4th_27`, `4th_28`.

## 3. Standard verification

After each slice:

```bash
npm run smoke
npm run build
npm run smoke:online
npm run rule:audit
git diff --check
```

For hidden-information changes, also inspect or test `playerView` redaction.

For API/persistence changes, add targeted API smoke tests and verify SQLite migration behavior on an existing database.
