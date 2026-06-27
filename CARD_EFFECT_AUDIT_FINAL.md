# 卡牌效果一致性審查 — 最終報告

> 審查日期：2026-06-27
> 審查基準：以卡牌日文效果原文為準，比對 `parser.ts` 解析結果與 `executor.ts` / `GameLogic.ts` 實際生效邏輯。

## 結論

250 張有效果卡已重新對照日文原文、parser AST 與 executor 行為。現行基準：

- 267/267 效果行可解析
- `unparsedLines=0`
- `parsedButPartial=0`
- smoke regression 覆蓋 parser、executor、choice、timing、online playerView 等主要行為

## 本輪修正

| 嚴重度 | 問題 | 涵蓋卡 / 行為 | 修正 |
|---|---|---|---|
| 中 | `specificElements` 用完全相等判斷，導致 Abyss 同時有闇・炎・電気・風與額外カオス時不觸發 | 3rd_8、3rd_22 | 改為 required elements 子集判斷 |
| 中 | 同一卡多段效果可被玩家反序選擇 | 4th_89 等後段依賴前段的效果 | `resolvePendingEffect` 禁止跳過同一卡前面的未處理效果 |
| 低 | `moveSelfAreaEnchant` 自移到 Power Charger / Abyss 未發 `zoneEntered` | Area Enchant 離場後與 4th_33 等 zone-entry 連動 | 自移後補 `emitZoneEntered` |

## 目前已覆蓋的高風險語義

- 多段效果依卡面順序執行。
- 玩家仍可選擇不同卡之間的效果處理順序。
- `specificElements` 表示「指定屬性都有」，不表示「只能有這些屬性」。
- `handElements` 條件會公開自己的手牌資訊。
- `nameGuessOpponentHandReveal`、`revealHandAttackBoost`、`useFromHand`、`useFromAbyss`、`cardMove`、`abyssToDeckBottomOrLose` 等選擇型效果走 pendingChoice，不自動代選。
- Area Enchant 的 onTurnEnd、onDamageReceived、onChronosChanged、onZoneEntered、onBattle 離場條件均有 runtime 事件支援。
- `setAllCardClocks` 與 `nullifyOpponentClock` 在 Chronos 推進前有必要的預處理，避免時計語義在 advance 後才生效。

## 驗證命令

```bash
npm run smoke
npm run rule:audit
npm run typecheck
npm run build
npm run smoke:online
```

## 相關文件

- [RULE_ENGINE_AUDIT.md](RULE_ENGINE_AUDIT.md)
- [RULE_ENGINE_AUDIT_CORE.md](RULE_ENGINE_AUDIT_CORE.md)
- [RULE_ENGINE_AUDIT_SETUP.md](RULE_ENGINE_AUDIT_SETUP.md)
