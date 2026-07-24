# Tutorial V2 Remediation Plan

Last updated: 2026-07-21

Owner: Frontend / Game UX / QA

Status: Implemented and locally release-verified for `0.2.2`; external staging and moderated first-player evidence remain pending

Implementation log (2026-07-20): TV2-01 tooltip sizing, fixed action instruction,
scroll affordance, keyboard-focusable scroll region, and compact Previous action are
implemented. TV2-02 now uses `src/data/tutorialPresentation.ts` snapshots for the
visible player board while authority and AI remain unchanged. TV2-03 has decoded
JPEG/WebP/AVIF browser coverage and deployment smoke validation; fixed CH.02 examples
always use reviewed showcase definitions. TV2-04/05 add mobile contextual field
feedback, card-detail reveal, versioned exploration persistence, completion gating, and
chapter-heading scroll landing. TV2-06 fixes localized card taxonomy labels, completion
semantics, and victory copy. The repository-wide `npm run verify` passes for `0.2.2`;
the remaining release evidence requires the target staging environment and moderated
first-player validation.

Release policy: Public Beta tutorial remediation is not complete until every P0 item in this document has executable evidence. The plan does not authorize changes to the production rules engine.

## 1. Objective

Make the five-chapter onboarding reliably teach the first two turns on desktop and mobile, instead of only allowing the scripted journey to be clicked through.

The completed result must satisfy all of the following:

- Every tutorial title, rule explanation, calculation, and required action is perceptible at the moment it is needed.
- The visible board state matches the turn, HP, Chronos, cards, and zones described by the current tutorial step.
- Card and battlefield interactions provide immediate contextual feedback on mobile.
- A completed chapter represents a minimum learning interaction, while players remain free to navigate or leave the tutorial.
- Tutorial card artwork is available in the release environment and its successful decoding is verified, not inferred from a URL attribute.
- All changes remain isolated from Local, AI, and Online Battle authority.

## 2. Current Evidence Baseline

The 2026-07-20 review established the following reproducible baseline:

- Full Tutorial Playwright passes `15/15` on Chromium.
- Static `/tutorial` Axe coverage has no serious or critical violations.
- The automated suite proves state transitions and DOM text existence, but does not prove that text or images are perceptible.
- At `390x844`, the completion step leaves approximately `12px` of visible tutorial body height while the body requires approximately `219px`.
- At `390x844`, the opening-hand explanation exposes approximately `84px` of a `265px` body.
- At `1280x720`, the short-height media query caps the tooltip at approximately `232px`, so long copy is internally clipped on a common laptop viewport.
- After CH.04 confirmation, the authoritative state is already Turn 2, player HP `80`, Chronos `3`, while CH.05 recap describes Turn 1, HP `100`, Chronos `0`.
- After the Turn 2 effect action, the authoritative state is already Turn 3 with opponent HP `30`, while the tutorial still explains target selection, HP calculation, and cleanup for Turn 2.
- With imgproxy unavailable, the tutorial card image has `naturalWidth === 0`; the canonical source image itself remains reachable.
- Battlefield and card interaction explanations remain below the full illustration on mobile, with no automatic reveal or contextual sheet.
- CH.02 and CH.03 can be marked complete without performing their advertised interactions; CH.03 displays `1 / 7` while the completion button is already enabled.
- Completing a long chapter preserves the old scroll position. Moving from CH.03 to CH.04 can place the new chapter heading above the viewport.

## 3. Scope And Non-Goals

### In scope

- `TutorialChapterHub`, `TutorialGamePage`, `GameTutorialOverlay`, tutorial-only AIGame/Board presentation props, tutorial copy, card-image delivery checks, accessibility semantics, and Tutorial E2E.
- Deterministic display snapshots derived from the existing tutorial scenario.
- Versioned local persistence for static chapter exploration progress.
- Responsive verification at the viewports listed in this document.

### Out of scope

- Changing production turn resolution, card effects, `confirmReady`, or boardgame.io move semantics.
- Introducing a general replay/undo system.
- Rebuilding the production board layout.
- Adding new tutorial chapters, achievements, rewards, voice-over, sound, or animation systems.
- Requiring every printed card field to be opened before the player may continue.
- Broad design-system, App.css, or Board.tsx refactors unrelated to the tutorial defects.

## 4. Design Principles

1. The authoritative `GameState` remains untouched by presentation overrides.
2. Moves and AI decisions always use authoritative state; only the visible player board may receive a tutorial display state.
3. A required action sentence must never depend on an undiscoverable inner scroll area.
4. The board, explanation, highlight, and next action must describe the same instant in the match.
5. Static chapters should encourage the minimum interaction needed to understand the concept, not force exhaustive busywork.
6. Release checks must validate rendered output: decoded images, visible text, correct geometry, and displayed values.

## 5. Workstream Summary

| ID     | Priority | Workstream                                                       | Estimate   | Dependency               | Beta gate            |
| ------ | -------- | ---------------------------------------------------------------- | ---------- | ------------------------ | -------------------- |
| TV2-01 | P0       | Tooltip readability and action visibility                        | 1-1.5 days | None                     | Yes                  |
| TV2-02 | P0       | Tutorial presentation timeline and state synchronization         | 2-3 days   | TV2-01 test helpers      | Yes                  |
| TV2-03 | P0       | Card artwork delivery and release image gate                     | 0.5-1 day  | None                     | Yes                  |
| TV2-04 | P1       | Mobile contextual feedback for card and battlefield lessons      | 1-1.5 days | TV2-01                   | Complete remediation |
| TV2-05 | P1       | Chapter exploration, completion, persistence, and scroll landing | 1-1.5 days | TV2-04 interaction model | Complete remediation |
| TV2-06 | P1       | Tutorial i18n, accessibility, and copy precision                 | 0.5-1 day  | TV2-02                   | Complete remediation |
| TV2-07 | P0       | Visual, functional, and release regression gates                 | 1 day      | TV2-01 through TV2-06    | Yes                  |

Expected total: `7-10 engineer-days`, plus one moderated first-time-player session after deployment.

## 6. Detailed Implementation Plan

### TV2-01: Tooltip Readability And Action Visibility

#### Problem

The tooltip body is scrollable but lacks a clear scroll affordance. Mobile height caps and the `(max-height: 760px)` rule also affect desktop browser viewports. The final three-button footer can reduce the body to almost zero height.

#### Implementation

1. Add failing viewport regressions before changing CSS:
   - `320x568`
   - `375x812`
   - `390x844`
   - `1280x720`
   - `1366x768`
   - `1440x900`
2. Split tutorial copy into two responsibilities:
   - explanatory body, which may scroll when genuinely necessary;
   - a fixed `instruction` line for the required next action.
3. Extend `TutorialStep` with an optional instruction translation key. Move sentences such as “請點擊高亮的…” out of long bodies and render them above the footer.
4. Correct the short-height media query so a desktop viewport is not treated as a narrow mobile sheet solely because its content height is below 760px.
5. Increase mobile sheet capacity without covering the active target:
   - normal action sheet target: up to roughly `46-52dvh`;
   - centered explanation/completion sheet: up to roughly `70dvh`;
   - continue using the existing top/bottom target-aware placement.
6. Give scrollable bodies a visible affordance: scrollbar, bottom fade, or explicit “向下捲動閱讀完整說明”. Remove it when the body fits.
7. Redesign the final step footer:
   - primary: continue the tutorial match;
   - secondary: return to tutorial;
   - previous becomes a compact tertiary action in the header or a separate row.
8. Preserve 44px minimum touch targets and safe-area insets.

#### Acceptance criteria

- No tutorial title is clipped at any required viewport.
- The fixed action instruction is visible without scrolling at every action step.
- The final step shows its title, completion summary, and two primary choices without reducing the body below a usable height.
- When internal scrolling is required, the user can visually identify that more content exists.
- Tooltip and highlighted target do not overlap.
- Keyboard focus remains trapped between the tooltip and the one permitted interaction target.

### TV2-02: Tutorial Presentation Timeline And State Synchronization

#### Problem

The rules engine correctly resolves turns atomically, but the tutorial explains sub-events after authoritative state has already advanced. Reusing the CH.04 session exposes Turn 2 while CH.05 explains Turn 1; resolving the Turn 2 effect exposes Turn 3 before HP and cleanup explanations.

#### Architecture

Introduce a tutorial-only display-state layer:

```text
Authoritative GameState
  ├─ moves / AI / rules / completion checks
  └─ Tutorial presentation adapter
       └─ visible player Board only
```

The hidden AI board and all move dispatchers must always receive authoritative state.

#### Implementation

1. Add a typed `TutorialPresentationState` rather than a growing list of unrelated scalar props.
2. Capture deterministic authoritative snapshots at these checkpoints:
   - initial placement confirmed / before first-turn explanation;
   - Turn 2 set phase before any cards are committed;
   - Turn 2 effect-order state before the player resolves the scripted effect;
   - authoritative post-Turn-2 state.
3. Build display snapshots for the visible player board:
   - `flow-recap`: Turn 1, HP `100/100`, Chronos `0`, initial cards visible as described;
   - `clock-advance`: Turn 1, HP `100/100`, Chronos `3`;
   - first `hp-calc`: Turn 1, HP `80/100`, Chronos `3`;
   - `turn-end-draw-t1`: Turn 1 result with correct five-card hands and reduced decks;
   - `turnSet-character-select` onward: authoritative Turn 2 state;
   - `choice-mechanics`: Turn 2 post-effect/pre-battle presentation, opponent HP still `100`;
   - second `hp-calc`: Turn 2 with opponent HP `30` and the correct `100 - 30 = 70` notice;
   - `turn-end-cleanup`: Turn 2 post-cleanup zones, hands, decks, and Abyss;
   - `complete`: authoritative Turn 3 state.
4. Ensure phase header copy uses the displayed tutorial phase, not the authoritative Turn 3 `turnSet` label during retrospective explanation.
5. Keep recent notices authoritative, but select the notice appropriate to the current tutorial step.
6. Reuse the same snapshot builder for direct CH.05 entry, CH.04-to-CH.05 continuation, and checkpoint replay.
7. Preserve existing safe Previous behavior. Rebuild checkpoints must reproduce both authoritative and presentation snapshots before displaying the target step.
8. Do not add pauses, branches, or flags to production `GameLogic.resolveTurn`.

#### Acceptance criteria

- CH.05 never displays Turn 2 while its current text says Turn 1.
- The first Clock step displays HP `100`, Chronos `3`, and Turn 1.
- The first HP step displays HP `80` only when damage is explained.
- Turn 2 appears only when the player begins the catch-up selection.
- Opponent HP remains `100` through effect/choice explanation and changes to `30` at the second HP step.
- Turn 3 appears only after Turn 2 cleanup is explained.
- Authoritative state hashes before and after the tutorial remain identical to the current deterministic scenario.
- Local, AI, and Online Battle tests show no behavior change.

### TV2-03: Card Artwork Delivery And Release Image Gate

#### Problem

URL-shape assertions pass even when imgproxy returns `503` and the browser decodes no image. Static tutorial examples and scripted battle cards can therefore become blank while E2E remains green.

#### Implementation

1. Add a release smoke request for one representative card in each required output format:
   - original/default;
   - WebP;
   - AVIF.
2. Validate status `200`, image content type, non-zero payload, and decodable dimensions.
3. Add browser assertions for `complete === true` and `naturalWidth > 0` on:
   - the three CH.02 examples;
   - representative cards in CH.03;
   - the opening hand and battle zones in CH.04/CH.05.
4. Make the three fixed CH.02 tutorial examples deterministic even when the card API or imgproxy is unavailable:
   - preferred: reviewed local tutorial assets under `public/tutorial/cards/` with an explicit documented policy exception;
   - alternative only if deployment policy permits: explicit `fallbackToOriginal` with a tutorial-specific reason and matching CSP.
5. Keep real match card delivery on imgproxy and fail the release gate when it is misconfigured.
6. Ensure synthetic E2E cards cannot replace the reviewed CH.02 showcase definitions merely because they share an ID and have a truthy image field.

#### Acceptance criteria

- A misconfigured imgproxy fails CI/release smoke rather than producing a green Tutorial suite.
- All tutorial images have `naturalWidth > 0` at desktop and mobile.
- CH.02 continues to show the reviewed card, values, localized name, and localized effect when `/api/cards` and `/api/cards/texts` fail.
- No undocumented direct original-card request is introduced.

### TV2-04: Mobile Contextual Feedback

#### Problem

Tapping a card hotspot or an upper battlefield zone changes state, but the explanation can remain hundreds of pixels below the visual object.

#### Card introduction implementation

1. Keep the desktop two-column arrangement.
2. On mobile, order content as:
   - card type selector;
   - card image and hotspots;
   - selected fact explanation;
   - complete fact button grid.
3. When a hotspot is tapped and its explanation is outside the viewport, scroll only the explanation header into view with reduced-motion support.
4. Keep the fact button grid as the accessible non-geometric alternative.
5. Retain the existing high-contrast frames and omit Attack for non-Character cards.

#### Battlefield implementation

1. Keep the simplified mirrored board unchanged.
2. On mobile, show the selected zone in a compact contextual sheet immediately after a tap:
   - zone title;
   - one-sentence summary;
   - expandable full explanation.
3. Keep the complete explanation below the board for document flow and screen readers.
4. Preserve the selected/explored inset markers and keyboard access.
5. Do not auto-scroll the entire page so aggressively that the selected zone disappears before the player sees the highlight.

#### Acceptance criteria

- A player can tap any mobile card hotspot and see which rule changed without manually searching below the illustration.
- A player can tap opponent HP, Power, deck, or Abyss and immediately see the corresponding title and summary.
- No contextual sheet obscures the selected zone or creates horizontal overflow.
- Keyboard and screen-reader users receive the same selected fact through `aria-live`.

### TV2-05: Chapter Exploration, Completion, Persistence, And Scroll Landing

#### Implementation

1. Lift CH.02 and CH.03 exploration state into the hub or a dedicated hook.
2. Persist partial exploration under a versioned key separate from the existing completed-chapter array.
3. Define minimum completion criteria:
   - CH.01: explicit completion action;
   - CH.02: all three card types viewed and the core fields `type`, `clock`, `powerCost`, `sendToPower`, and `effect` opened at least once across the examples;
   - CH.03: all seven zone categories explored;
   - CH.04/CH.05: existing scripted completion behavior.
4. Keep chapter tabs freely navigable. Do not lock players inside a chapter.
5. Disable the “complete” action until the minimum criteria are satisfied and show the exact remaining requirement.
6. Preserve partial progress after switching chapters, reloading, or returning from battle.
7. On tab selection or `completeAndContinue`, scroll the active chapter panel header into view. Do not always jump to the global page title.
8. When a chapter is already complete, allow replay without clearing completion.

#### Acceptance criteria

- CH.03 cannot show `1 / 7` and simultaneously offer an enabled completion action.
- Partially explored regions remain explored after switching away and back.
- Completing the long battlefield chapter lands the player at the CH.04 title, not halfway through its numbered list.
- Replay does not duplicate or corrupt the completed chapter count.

### TV2-06: i18n, Accessibility, And Copy Precision

#### Implementation

1. Replace dynamic raw keys such as `card.element.${def.element}` and `card.type.${def.type}` with shared mapping helpers.
2. Use localized card name/effect helpers in the tutorial battle detail and effect-order panel.
3. Add screen-reader-only completion text to completed chapter buttons; the visual icon may remain `aria-hidden`.
4. Announce chapter changes and exploration progress without moving keyboard focus unexpectedly.
5. Change the victory condition from vague “無法繼續出牌” wording to the exact deck-draw loss condition.
6. Review all six locales after instructions are separated from explanatory bodies.
7. Run Axe against:
   - the static hub;
   - one card fact interaction;
   - one battlefield interaction;
   - CH.04 action overlay;
   - CH.05 effect-order overlay;
   - completion overlay.

#### Acceptance criteria

- No raw `card.element.*` or `card.type.*` key appears in any supported locale.
- Tutorial effect text follows the selected UI locale where translations exist.
- A screen reader can identify active and completed chapters.
- No serious or critical Axe violations occur on the expanded tutorial surfaces.

### TV2-07: QA And Release Gates

#### Required automated coverage

1. Unit tests:
   - presentation snapshot builder;
   - chapter exploration reducer/persistence migration;
   - card type/element mapping;
   - instruction/body separation policy.
2. Tutorial Playwright:
   - existing full deterministic flow;
   - displayed turn/HP/Chronos/hand/deck/zone assertions at every narrative boundary;
   - visible tooltip geometry and action instruction assertions;
   - decoded card image assertions;
   - mobile contextual feedback;
   - completion gating and scroll landing;
   - Previous checkpoint rebuilds.
3. Accessibility:
   - static and overlay Axe checks;
   - keyboard-only CH.02 navigation;
   - focus confinement during scripted action steps.
4. Release smoke:
   - imgproxy health and decoding;
   - tutorial route loads with the release card dataset;
   - no direct original-card delivery except documented exceptions.

#### Required manual matrix

| Surface            | Viewports                                                         |
| ------------------ | ----------------------------------------------------------------- |
| Static CH.01-CH.05 | 320x568, 375x812, 390x844, 768x1024, 1280x720, 1366x768, 1440x900 |
| CH.04 full flow    | 375x812, 390x844, 1280x720, 1440x900                              |
| CH.05 full flow    | 375x812, 390x844, 1280x720, 1440x900                              |
| Reduced motion     | 390x844 and 1280x720                                              |
| Keyboard only      | 1280x720                                                          |

#### Verification commands

```bash
npm run typecheck
npm run typecheck:scripts
npm run i18n:check
npx vitest run src/data/__tests__/tutorialSteps.test.ts
npx playwright test e2e/tutorial.spec.ts --project=chromium
npx playwright test e2e/accessibility.spec.ts --project=chromium --grep tutorial
npm run image:policy
npm run build
npm run verify
git diff --check
```

`npm run verify` is mandatory before commit or push. A failure in an unrelated user-owned file must be reported exactly and must not be hidden by claiming the tree is CI-clean.

## 7. Recommended Execution Order

### Batch 1: Establish failing evidence

1. Add tooltip visibility, decoded-image, display-state, completion-gating, and scroll-landing regressions.
2. Capture reference screenshots for the current defects.

### Batch 2: Close P0 readability

3. Implement instruction separation, responsive tooltip sizing, scroll affordance, and completion footer redesign.
4. Re-run the full viewport matrix before touching match presentation.

### Batch 3: Close P0 timeline correctness

5. Implement the typed tutorial display snapshot adapter.
6. Cover first-turn and second-turn narrative boundaries, direct CH.05 entry, CH.04 continuation, and Previous rebuilds.

### Batch 4: Close image reliability

7. Make CH.02 fixed examples deterministic and add imgproxy release decoding gates.

### Batch 5: Complete interaction UX

8. Add mobile card/field contextual feedback.
9. Add exploration persistence, completion rules, and chapter scroll landing.

### Batch 6: Polish and release evidence

10. Fix card taxonomy localization, completion semantics, copy precision, and expanded Axe coverage.
11. Run full verification and manual visual inspection.
12. Conduct one moderated first-time-player session only after the implementation candidate is frozen.

## 8. Definition Of Done

Tutorial V2 remediation is complete only when:

- TV2-01 through TV2-07 acceptance criteria pass.
- Full Tutorial E2E passes without retries or conditional skips against the intended Beta dataset and image service.
- `npm run verify` passes on the exact candidate or its unrelated limitation is explicitly recorded.
- Desktop and mobile screenshots demonstrate readable tooltips and synchronized board values.
- One first-time player can explain, without prompting:
  - why the high-Power-Cost opening card was redrawn;
  - how Clock advances Chronos;
  - how attack difference becomes HP damage;
  - why losing Turn 1 allows up to two cards on Turn 2;
  - how SEND TO POWER enables the new Character;
  - why the Area Enchant raises attack;
  - how failure to draw the required cards loses the game.

## 9. Stop Conditions

Stop and reassess instead of expanding scope when:

- a proposed fix requires production rules-engine branching for tutorial mode;
- a presentation snapshot cannot be proven read-only;
- tooltip changes obscure the only permitted action target;
- chapter completion rules become exhaustive busywork;
- card-image fallback would violate the repository image policy without an explicit documented exception;
- unrelated Board or design-system refactors become prerequisites.
