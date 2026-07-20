import type { TutorialAIScript } from '../game/useAIMoves';

/**
 * 教學模式固定劇本。
 *
 * 設計目標（對應使用者 7 點需求）：
 * 1. 固定一場對戰，玩家穩贏
 * 2. 覆蓋規則：猜拳、mulligan、powerCost 歸零、時鐘推進、戰鬥、SEND TO POWER、
 *    充能區/深淵交互、Area Enchant、Enchant、敗者出 2 張追趕、效果優先權
 * 3. 猜拳玩家贏（AI 出剪刀，引導玩家出石頭）
 * 4. 初始手牌第 0 張是高費卡 1st_2（powerCost=7），引導重抽並說明攻擊力歸零
 * 5. 使用 Enchant（1st_98）與 Area Enchant（2nd_98）
 * 6. 玩家輸一把（T1）贏一把（T2），T2 玩家為敗者可出 2 張卡追趕
 * 7. 涵蓋 SEND TO POWER、zoneEntered、效果優先權（夜側玩家優先）、HP 計算
 *
 * 牌庫順序即陣列順序（skipShuffle=true），前 5 張為初始手牌。
 *
 * === 回合 1（initialSet，玩家夜側）===
 * 玩家手牌：[1st_2(pc7), 1st_70, 1st_46, 2nd_98, 1st_66]
 *   - 1st_2 powerCost=7，回合 1 充能區空(power=0) < 7 → 攻擊力 0，引導重抽
 *   - 重抽 1st_2 後手牌：[1st_70, 1st_46, 2nd_98, 1st_66, 1st_66]
 * 玩家出 1st_70 到 battleZone（pc0, night atk 30, sendToPower 2）
 * AI 出 1st_67 到 battleZone（pc0, night atk 50）
 * 時鐘推進：0 + 1st_70.clock(2) + 1st_67.clock(1) = 3（夜）
 * 戰鬥：AI 50 > 玩家 30 → AI 贏，玩家受 20 傷害（100→80）
 *
 * === 回合 2（turnSet，玩家敗者出 2 張）===
 * 玩家出 1st_46（Character, slot A）+ 2nd_98（Area Enchant → setZoneC）
 * AI 出 1st_98（Enchant, slot A）
 * 時鐘推進：3 + 1st_46.clock(1) + 2nd_98.clock(2) + 1st_98.clock(4) = 10（晝）
 * placeRevealedCards：1st_46 替換 1st_70 進 battleZone；1st_70(sendToPower=2)送充能區
 * 玩家 power = 2（充能區 1st_70）
 *   - 1st_46 pc2, power 2≥2 ✓, day atk 80
 *   - 2nd_98「昼なら攻撃力+20」→ 玩家 atk = 80+20 = 100
 * AI power = 0（充能區空，1st_67 未替換）
 *   - 1st_67 pc0, power 0≥0 ✓, day atk 30
 *   - 1st_98「対手角色 pc0/1 なら攻撃力+30」→ 1st_46 pc2 不符合 → AI atk = 30
 * 戰鬥：玩家 100 > AI 30 → 玩家贏，AI 受 70 傷害（100→30）
 * 回合結束：1st_98(sendToPower=0)送深淵
 */

/**
 * 玩家牌組（20 張，陣列順序 = 牌庫順序）。
 * 前 5 張為初始手牌：[1st_2, 1st_70, 1st_46, 2nd_98, 1st_66]
 * 1st_2（powerCost=7）放第 0 位，作為 mulligan 引導目標。
 */
export const TUTORIAL_DECK0_IDS: string[] = [
  '1st_2', // 手牌0: 高費卡(pc7)，mulligan 目標
  '1st_70', // 手牌1: T1 battleZone（pc0, night30, sendToPower2）
  '1st_46', // 手牌2: T2 battleZone（pc2, day80）
  '2nd_98', // 手牌3: T2 Area Enchant（晝+20攻）
  '1st_66', // 手牌4: 填充（pc0, night40, sendToPower1）
  '1st_66', // mulligan 後抽到的牌
  '1st_67', // T1 結束抽到
  '1st_67',
  '1st_68',
  '1st_68',
  '1st_70',
  '1st_46',
  '2nd_98',
  '1st_35',
  '1st_35',
  '1st_2',
  '1st_98',
  '1st_98',
  '2nd_92',
  '2nd_92',
];

/**
 * AI 牌組（20 張，陣列順序 = 牌庫順序）。
 * 前 5 張為初始手牌：[1st_67, 1st_98, 1st_67, 1st_98, 1st_66]
 * AI 不重抽（keepHand），T1 出 1st_67，T2 出 1st_98。
 */
export const TUTORIAL_DECK1_IDS: string[] = [
  '1st_67', // 手牌0: T1 battleZone（pc0, night50）
  '1st_98', // 手牌1: T2 Enchant（対手pc0/1則+30攻）
  '1st_67',
  '1st_98',
  '1st_66',
  '1st_66', // T1 結束抽到
  '1st_68',
  '1st_68',
  '1st_70',
  '1st_70',
  '1st_34',
  '1st_34',
  '1st_35',
  '1st_35',
  '2nd_86',
  '2nd_86',
  '1st_2',
  '1st_2',
  '2nd_92',
  '2nd_92',
];

/**
 * AI 腳本：覆寫 AI 決策，確保劇本完全可預測。
 * - janken: AI 必出會輸的拳，玩家不管出什麼都贏成為夜側玩家
 * - T2: AI 出 1st_98 到 setZoneA（Enchant，加自己攻擊力但玩家仍贏）
 */
export const TUTORIAL_AI_SCRIPT: TutorialAIScript = {
  setCardsByTurn: {
    1: [{ defId: '1st_67', slot: 'A' }],
    2: [{ defId: '1st_98', slot: 'A' }],
  },
};
