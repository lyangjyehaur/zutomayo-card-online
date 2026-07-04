/**
 * PhaseIndicator — 當前階段與「我現在該做什麼」的唯一提示來源。
 * 桌面：頂欄下方置中橫幅；行動端：緊湊單行（樣式見 battle.css）。
 * 內容由 Board 的 phaseInstruction() 推導，本元件只負責呈現。
 */
export interface PhaseInstructionView {
  title: string;
  body: string;
  meta: { text: string; done: boolean }[];
}

export function PhaseIndicator({ instruction, compact }: { instruction: PhaseInstructionView; compact?: boolean }) {
  return (
    <section
      className={`phaseindicator board-phase-instruction ${compact ? 'phaseindicator-compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="phaseindicator-panel">
        <div className="phaseindicator-text">
          <div className="phaseindicator-title">{instruction.title}</div>
          <p className="phaseindicator-body">{instruction.body}</p>
        </div>
        {instruction.meta.length > 0 && (
          <div className="phaseindicator-meta">
            {instruction.meta.map((item) => (
              <span key={item.text} className="phaseindicator-chip" data-done={item.done}>
                {item.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
