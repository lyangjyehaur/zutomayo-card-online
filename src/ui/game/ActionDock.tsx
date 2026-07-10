import { t } from '../../i18n';

/**
 * ActionDock — 對戰主行動區。任何時刻只有一個 primary 行動；
 * 提示文字告訴玩家「現在該做什麼 / 為什麼不能按」。
 * 行動端固定於拇指區（底部），所有按鈕 >= 44px。
 * 保留 .battle-action-stack 與 data-tut="confirm-set"。
 */
export interface ActionDockProps {
  hintTitle: string;
  hintBody: string;
  ready: boolean;
  canConfirm: boolean;
  cardsSet: number;
  /** 已選中手牌可設置時，顯示「設置這張」次要行動 */
  canSetSelected: boolean;
  onSetSelected: () => void;
  onConfirm: () => void;
  /** 觸控端：查看選中卡詳情 */
  onShowDetail?: () => void;
}

export function ActionDock({
  hintTitle,
  hintBody,
  ready,
  canConfirm,
  cardsSet,
  canSetSelected,
  onSetSelected,
  onConfirm,
  onShowDetail,
}: ActionDockProps) {
  return (
    <div className="actiondock" role="group" aria-label={hintTitle}>
      <div className="actiondock-hint">
        <span>{hintTitle}</span>
        <p>{hintBody}</p>
      </div>
      {canSetSelected && (
        <button type="button" className="actiondock-btn actiondock-btn-set" onClick={onSetSelected}>
          {t('board.setInspectedCard')}
        </button>
      )}
      {canSetSelected && onShowDetail && (
        <button type="button" className="actiondock-btn actiondock-btn-detail" onClick={onShowDetail}>
          {t('board.inspectHandCard')}
        </button>
      )}
      {!ready ? (
        <button
          type="button"
          className="actiondock-btn actiondock-btn-primary"
          data-tut="confirm-set"
          disabled={!canConfirm}
          onClick={onConfirm}
        >
          {t('board.confirmSet')} ({cardsSet} {t('board.cardsUnit')})
        </button>
      ) : (
        <button type="button" className="actiondock-btn actiondock-btn-waiting" disabled>
          {t('board.readyWaiting')}
        </button>
      )}
    </div>
  );
}
