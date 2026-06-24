import { useState } from 'react';

interface TutorialStep {
  title: string;
  content: string;
  highlight?: string;
}

const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: '🎵 ZUTOMAYO CARD',
    content: '歡迎來到 ZUTOMAYO CARD！這是一個 2 人對戰的集換式卡牌遊戲。\n\n你的目標是將對方的 HP 從 100 打到 0。',
  },
  {
    title: '🃏 卡牌種類',
    content: '遊戲有 3 種卡牌：\n\n• Character（角色）— 有攻擊力，用於戰鬥\n• Enchant（附魔）— 一次性效果\n• Area Enchant（區域附魔）— 跨回合持續效果\n\n牌組需要 20 張，角色卡建議佔 50% 以上。',
  },
  {
    title: '🌙☀️ 晝夜系統',
    content: '這是遊戲的核心機制！\n\n每個回合會推進 Chronos 時鐘，決定當前是「夜」還是「晝」。\n\n夜間用 NIGHT 攻擊力，白天用 DAY 攻擊力。同一張卡在不同時間的攻擊力可能差很多！',
  },
  {
    title: '⏱ 回合流程',
    content: '每個回合的流程：\n\n1. 出牌 — 從手牌選卡放到場上\n2. 翻開 — 同時翻開出的牌\n3. 推時間 — 合計出牌的時計數值\n4. 換場 — 新角色進 Battle Zone\n5. 效果處理 — 觸發卡牌效果\n6. 戰鬥 — 比較攻擊力，低者扣血\n7. 抽牌 — 抽出牌數量的牌',
  },
  {
    title: '⚡ Power 系統',
    content: '卡牌有 Power Cost（發動所需能量）。\n\n當卡牌離場時，如果有 SEND TO POWER 值，會進入 Power Charger 產出能量。\n\n如果 Power 不足，該卡的攻擊力變為 0，效果也不會發動！',
  },
  {
    title: '🎯 Catch-Up 機制',
    content: '上回合戰鬥的敗者，下回合可以出 2 張牌！勝者只能出 1 張。\n\n這個機制讓落後的玩家有翻盤的機會。',
  },
  {
    title: '🏆 勝利條件',
    content: '• 先將對方 HP 打到 0 的玩家獲勝\n• 如果牌組耗盡無法抽牌，該玩家落敗\n\n準備好開始了嗎？',
  },
];

interface TutorialProps {
  onClose: () => void;
}

export function Tutorial({ onClose }: TutorialProps) {
  const [step, setStep] = useState(0);
  const current = TUTORIAL_STEPS[step];
  const isLast = step === TUTORIAL_STEPS.length - 1;

  return (
    <div className="tutorial-overlay">
      <div className="tutorial-card">
        <div className="tutorial-progress">
          {TUTORIAL_STEPS.map((_, i) => (
            <div key={i} className={`progress-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
          ))}
        </div>

        <h2>{current.title}</h2>
        <div className="tutorial-content">
          {current.content.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        <div className="tutorial-nav">
          {step > 0 ? (
            <button className="tutorial-btn prev" onClick={() => setStep(step - 1)}>← Back</button>
          ) : (
            <button className="tutorial-btn skip" onClick={onClose}>Skip</button>
          )}

          {isLast ? (
            <button className="tutorial-btn start" onClick={onClose}>🎮 Start Playing!</button>
          ) : (
            <button className="tutorial-btn next" onClick={() => setStep(step + 1)}>Next →</button>
          )}
        </div>
      </div>
    </div>
  );
}
