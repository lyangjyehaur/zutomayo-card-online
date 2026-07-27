# Card Synergy Analysis

## Purpose

The synergy graph is an analysis and review aid for finding cards whose effects, attributes, songs, or printed values work together. It is not a runtime rules source and it does not automatically change deck recommendations.

The model is deliberately explainable. Each relation contains:

- a directional relation (`enables` or `conflicts`);
- one or more mechanic concepts, such as `own-abyss-stock`, `previous-element:炎`, or `named-card:猫リセット`;
- one or more interaction categories plus a primary category for browsing;
- the source and target card IDs;
- parser and text evidence;
- a score and confidence level (`high`, `medium`, or `low`);
- `playabilityEligible`, which only checks whether both cards are playable;
- `recommendationEligible`, which remains `false` in the generated candidate file until a reviewer explicitly approves and publishes the relation to PostgreSQL.

The model does not infer hidden rules from similarity. It extracts outputs (what a card supplies), inputs (what an effect needs), and blockers (what can make an effect invalid), then joins matching concepts. The parser-backed features are supplemented by conservative Japanese-text patterns for effects that are not yet represented by the effect DSL.

Interaction category is independent from confidence and review status. A relation can belong to multiple categories when it combines mechanisms. The current taxonomy is:

- specified song/card;
- element;
- Abyss or Power Charger resource;
- Chronos/time;
- HP, damage, or damage reduction;
- hand or draw;
- Power Cost or card type;
- deck-top or SEND TO POWER routing;
- Area Enchant;
- event triggers such as entering a zone, losing a battle, or receiving damage;
- other.

## Data Sources

Production and staging analysis with database credentials reads the card catalog from PostgreSQL. Without database credentials, the local tool combines:

- the reviewed 422-card Japanese name/effect extraction;
- the ignored PG card snapshot for element, type, song, Power Cost, and SEND TO POWER metadata;
- the 64 unlisted-card review candidates and local human-review ledger.

The fallback files are ignored local artifacts. They are never imported by the application at runtime, uploaded to GitHub, written to R2, or used as a substitute for PostgreSQL in the API.

## Generate Candidates

```bash
npm run analyze:card-synergies
```

This writes the ignored local file `data/card-synergy-candidates.json`. The summary currently reports the total card count, cards with effect text, parser coverage, linked/unlinked cards, relation confidence counts, category counts, conflict count, and mechanism-group count. Category counts can overlap because one relation can have multiple categories.

Unlisted cards are included only when their merged human review has `textReviewStatus: verified`. OCR and machine-suggestion drafts are excluded entirely, including from name-, song-, element-, and other metadata-based candidate relations. The summary separately reports discovered unlisted cards, verified cards included, and unverified cards excluded.

## Human Review

Start the local review surface with:

```bash
npm run review:card-synergies
```

Open `http://127.0.0.1:4177/`. The command regenerates the candidate graph before starting the local server. The review surface supports searching by card ID/name/concept and filtering by review queue, interaction category, relation type, confidence, and review status. It shows both card effects, model evidence, and an editable natural-language rationale.

Do not review every expanded pair. Use the queues in this order:

1. Review the 48 mechanism groups and correct their shared definitions.
2. Review the core relation queue, which contains exact named-card/song, reduced-damage, Chronos-position, and opponent-element interactions.
3. Review conflicts separately.
4. Use the full raw-candidate queue only to investigate a specific card or mechanism. Broad attribute, Power Cost, and zone-element expansions are supporting evidence, not an individual approval checklist.

Review decisions made in the local bulk-review tool stay in the ignored `data/card-synergy-human-reviews.json` ledger and are never runtime data. Approved relations can be recreated or imported through the controlled PostgreSQL workflow, then reviewed in `/admin/synergies`. A relation is player-facing only when its PostgreSQL status is `approved` and `recommendation_eligible=true`.

## Interpreting Results

High-confidence candidates are exact named-card/song links, explicit reduced-damage chains, exact Chronos positions/windows, or explicit opponent-element manipulation. Medium-confidence candidates include resource, attribute, Power Cost, and simultaneous-character packages. Low-confidence candidates usually depend on timing, deck order, or a broad event match and should not be published without manual confirmation.

The graph includes broad pair candidates to avoid hiding useful combinations. Human review should normally start with high-confidence relations, then review mechanism groups and conflicts before considering medium- or low-confidence entries.

## PostgreSQL Publication Model

Migration `000044_card_synergies.js` stores mechanism groups and directional relations separately. Both preserve source/rules version, evidence, Japanese rationale, rationale translations, reviewer state, reviewer identity, and recommendation eligibility. `/admin/synergies` is the Refine review surface for manual creation and correction.

The public recommendation endpoint first returns approved, eligible `enables` relations for the selected card and fills remaining synergy slots only with explicit card-name or song references found in effect text. Ordinary shared type, element, or pack metadata never creates a synergy recommendation. Cards from the same song are returned as the separate `same_song` discovery category. `conflicts`, candidate, rejected, or non-eligible relations never become public recommendations. Candidate JSON and the local ledger remain outside the runtime path and GitHub.
