import { useState, useEffect, useCallback } from 'react';

// ===== Tutorial Step Types =====

interface TutorialStep {
  id: string;
  message: string;
  highlight?: string; // CSS selector to highlight
  action: 'click' | 'wait' | 'auto';
  target?: string; // CSS selector for expected click
  validator?: () => boolean;
  duration?: number; // ms for auto steps
}

// ===== Tutorial State Machine =====

type TutorialPhase =
  | 'welcome'
  | 'show-battle-zone'
  | 'show-hand'
  | 'select-card'
  | 'card-placed'
  | 'show-chronos'
  | 'show-hp'
  | 'explain-attack'
  | 'explain-turn'
  | 'explain-power'
  | 'explain-catchup'
  | 'start-practice';

interface TutorialState {
  phase: TutorialPhase;
  highlightSelector: string | null;
  message: string;
  waitingForClick: string | null;
}

const PHASES: Record<TutorialPhase, {
  message: string;
  highlight?: string;
  next?: TutorialPhase;
  auto?: boolean;
  duration?: number;
}> = {
  'welcome': {
    message: '歡迎來到 ZUTOMAYO CARD！讓我帶你認識這個遊戲 ★\n\n這是你的場地，中間是 Chronos 時鐘。',
    next: 'show-battle-zone',
    auto: true,
    duration: 3000,
  },
  'show-battle-zone': {
    message: '這是 Battle Zone（戰鬥區）— 你的角色在這裡和對手戰鬥。\n\n點一下戰鬥區看看 👇',
    highlight: '.battle-zone',
    next: 'show-hand',
  },
  'show-hand': {
    message: '很好！這裡是你的手牌。\n\n每回合你需要從手牌選卡放到場上。敗者下回合可以出 2 張，勝者只能出 1 張。',
    highlight: '.hand',
    next: 'select-card',
  },
  'select-card': {
    message: '現在試試點一張手牌出牌吧！\n\n點選一張卡 👇',
    highlight: '.hand .card',
    next: 'card-placed',
  },
  'card-placed': {
    message: '出牌成功！你的卡會進入 Set Zone。\n\n翻開後，如果是角色卡就會進入 Battle Zone 和對手戰鬥。',
    next: 'show-chronos',
    auto: true,
    duration: 2500,
  },
  'show-chronos': {
    message: '這是 Chronos 時鐘 🕐\n\n每回合會根據出牌的「時計」數值推進。時鐘決定當前是夜🌙還是晝☀️。\n\n夜間用 NIGHT 攻擊力，白天用 DAY 攻擊力！',
    highlight: '.chronos',
    next: 'show-hp',
    auto: true,
    duration: 4000,
  },
  'show-hp': {
    message: '這是 HP 條 ❤️\n\n初始 100 點，戰鬥中攻擊力低的一方會受到差值傷害。\n\nHP 歸零就輸了！',
    highlight: '.player-info .hp',
    next: 'explain-attack',
    auto: true,
    duration: 3000,
  },
  'explain-attack': {
    message: '戰鬥時比較雙方攻擊力：\n\n🌙 NIGHT 攻擊力 vs ☀️ DAY 攻擊力\n\n差值就是敗者受到的傷害。例如 60 vs 30 = 30 點傷害！',
    next: 'explain-turn',
    auto: true,
    duration: 4000,
  },
  'explain-turn': {
    message: '完整回合流程：\n\n1. 出牌 → 2. 翻開 → 3. 推時間 → 4. 換場 → 5. 效果處理 → 6. 戰鬥 → 7. 抽牌\n\n每回合自動執行，你只需要選牌！',
    next: 'explain-power',
    auto: true,
    duration: 5000,
  },
  'explain-power': {
    message: 'Power 系統 ⚡\n\n卡牌有 Power Cost（發動能量）。卡牌離場時如果有 SEND TO POWER，會進入 Power Charger 產出能量。\n\nPower 不足 → 攻擊力變 0！',
    highlight: '.power',
    next: 'explain-catchup',
    auto: true,
    duration: 4000,
  },
  'explain-catchup': {
    message: 'Catch-Up 機制 🔄\n\n上回合的敗者可以出 2 張牌！勝者只能出 1 張。\n\n這個設計讓落後的玩家有翻盤機會，遊戲不會一邊倒。',
    next: 'start-practice',
    auto: true,
    duration: 4000,
  },
  'start-practice': {
    message: '教學完成！🎉\n\n現在進入 AI 練習模式（Easy），實際玩一局來鞏固吧！\n\n準備好了嗎？',
  },
};

interface InteractiveTutorialProps {
  onComplete: () => void;
  onStartPractice: () => void;
}

export function InteractiveTutorial({ onComplete, onStartPractice }: InteractiveTutorialProps) {
  const [phase, setPhase] = useState<TutorialPhase>('welcome');
  const [highlightEl, setHighlightEl] = useState<HTMLElement | null>(null);
  const current = PHASES[phase];

  // Auto-advance for auto phases
  useEffect(() => {
    if (current.auto && current.duration) {
      const timer = setTimeout(() => {
        if (current.next) setPhase(current.next);
      }, current.duration);
      return () => clearTimeout(timer);
    }
  }, [phase, current]);

  // Handle highlight
  useEffect(() => {
    if (current.highlight) {
      const el = document.querySelector(current.highlight) as HTMLElement;
      if (el) {
        setHighlightEl(el);
        el.style.position = 'relative';
        el.style.zIndex = '1001';
        el.style.boxShadow = '0 0 0 4px #f4d35e, 0 0 20px rgba(244,211,94,0.5)';
        el.style.borderRadius = '8px';
        el.style.transition = 'box-shadow 0.3s';

        return () => {
          el.style.position = '';
          el.style.zIndex = '';
          el.style.boxShadow = '';
          el.style.borderRadius = '';
        };
      }
    }
  }, [current.highlight]);

  // Handle click targets
  const handleGlobalClick = useCallback((e: MouseEvent) => {
    if (phase === 'show-battle-zone') {
      const target = (e.target as HTMLElement).closest('.battle-zone');
      if (target && current.next) {
        setPhase(current.next);
      }
    }
    if (phase === 'select-card') {
      const target = (e.target as HTMLElement).closest('.hand .card');
      if (target && current.next) {
        setPhase(current.next);
      }
    }
  }, [phase, current]);

  useEffect(() => {
    document.addEventListener('click', handleGlobalClick);
    return () => document.removeEventListener('click', handleGlobalClick);
  }, [handleGlobalClick]);

  // Final phase
  if (phase === 'start-practice') {
    return (
      <div className="tutorial-overlay interactive">
        <div className="tutorial-card">
          <h2>🎉 教學完成！</h2>
          <div className="tutorial-content">
            <p>你已經了解了 Zutomayo Card 的基本規則。</p>
            <p>現在進入 AI 練習模式（Easy），實際玩一局來鞏固吧！</p>
          </div>
          <div className="tutorial-nav">
            <button className="tutorial-btn skip" onClick={onComplete}>返回大廳</button>
            <button className="tutorial-btn start" onClick={onStartPractice}>🎮 開始 AI 練習</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tutorial-overlay interactive">
      {/* Dark overlay with cutout for highlighted element */}
      <div className="tutorial-backdrop" />

      {/* Message bubble */}
      <div className="tutorial-bubble">
        <div className="bubble-content">
          {current.message.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>

        {!current.auto && (
          <div className="bubble-action">
            {phase === 'select-card' && <span className="action-hint">👆 點選一張手牌</span>}
            {phase === 'show-battle-zone' && <span className="action-hint">👆 點一下戰鬥區</span>}
          </div>
        )}

        <div className="bubble-footer">
          <button className="tutorial-btn skip" onClick={onComplete}>跳過教學</button>
          <div className="phase-dots">
            {Object.keys(PHASES).map((p, i) => (
              <div key={p} className={`dot ${p === phase ? 'active' : i < Object.keys(PHASES).indexOf(phase) ? 'done' : ''}`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
