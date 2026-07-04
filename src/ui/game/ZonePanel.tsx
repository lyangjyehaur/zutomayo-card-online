import type { ReactNode } from 'react';

/**
 * ZonePanel — 遊戲區域的通用容器：官方區域名 label + 用途提示 + 內容。
 * 所有戰場區域元件（SetZone / ChargeZone / AbyssZone / DeckZone …）
 * 以此為外框，保證每個區域「名稱、用途、內容」三要素齊備。
 */
export interface ZonePanelProps {
  /** 官方區域名（i18n 後） */
  label: string;
  /** 規則用途提示（如「設置②・敗者」「持續附魔」） */
  hint?: string;
  side?: 'me' | 'opponent';
  children: ReactNode;
  tutId?: string;
  className?: string;
}

export function ZonePanel({ label, hint, side, children, tutId, className }: ZonePanelProps) {
  return (
    <div
      className={['zonepanel', side ? `zonepanel-${side}` : '', className ?? ''].filter(Boolean).join(' ')}
      role="group"
      aria-label={hint ? `${label} · ${hint}` : label}
      data-tut={tutId}
    >
      {children}
      <span className="zonepanel-label" aria-hidden="true">
        <span className="zonepanel-name">{label}</span>
        {hint && <span className="zonepanel-hint">{hint}</span>}
      </span>
    </div>
  );
}
