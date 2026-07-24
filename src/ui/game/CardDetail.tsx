import type { CardInstance, GameState, PlayerIndex } from '../../game/types';
import { getCardDef } from '../../game/cards/loader';
import { getBaseAttack, getEffectiveAttack, isAttackPowerInsufficient } from '../../game/GameLogic';
import { getLocalizedCardEffect, getLocalizedCardName } from '../../game/cards/i18n';
import { t, useLocale } from '../../i18n';
import { CardImage } from '../../components/CardImage';
import { getCardElementTranslationKey, getCardTypeTranslationKey } from '../../game/cards/taxonomy';

/**
 * CardDetail — 卡牌詳情的唯一內容實作。
 * 桌面：常駐側欄 CardDetailPanel；觸控端：包進 Sheet / side sheet。
 * 取代散落的 CardPopover / FocusPanel / BattleFocusSidebarPanel 三套實作。
 */
export type FocusedCard = { card: CardInstance; owner: PlayerIndex; zone: string } | null;

export function CardDetailBody({ focus, G, ownerName }: { focus: FocusedCard; G: GameState; ownerName?: string }) {
  const locale = useLocale();
  const card = focus?.card ?? null;
  const def = card && card.faceUp && card.defId !== '__hidden__' ? getCardDef(card.defId) : undefined;
  const localizedName = def ? getLocalizedCardName(def, locale) : '';
  const localizedEffect = def ? getLocalizedCardEffect(def, locale) : '';

  if (!focus || !def) {
    return (
      <div className="carddetail-empty" aria-hidden="true">
        <div className="carddetail-empty-frame" />
        <p>{t('card.unknown')}</p>
      </div>
    );
  }

  const inBattleZone = focus.zone === t('board.battleZone');

  return (
    <div className="carddetail">
      <div className="carddetail-context">
        {ownerName} · {focus.zone}
      </div>
      <div className="carddetail-art">
        <CardImage cardId={def.id} context="detail" alt={localizedName} loading="eager" referrerPolicy="no-referrer" />
      </div>
      <h2 className="carddetail-name">{localizedName}</h2>
      {def.hasOfficialErrata && (
        <a
          className="inline-flex w-fit text-caption font-bold text-accent-action underline underline-offset-2"
          href={def.officialErrataId ? `/rules/errata/${def.officialErrataId}` : def.officialErrataUrl}
        >
          {t('card.officialErrata')} #{def.officialErrataId}
        </a>
      )}
      <div className="carddetail-taxonomy">
        {t(getCardElementTranslationKey(def.element))} · {t(getCardTypeTranslationKey(def.type))}
      </div>
      <dl className="carddetail-stats">
        <div>
          <dt>{t('card.energy')}</dt>
          <dd>{def.powerCost}</dd>
        </div>
        <div>
          <dt>{t('card.clock')}</dt>
          <dd>{def.clock}</dd>
        </div>
        {def.attack && (
          <>
            <div>
              <dt>🌙 {t('card.night')}</dt>
              <dd>{def.attack.night}</dd>
            </div>
            <div>
              <dt>☀️ {t('card.day')}</dt>
              <dd>{def.attack.day}</dd>
            </div>
          </>
        )}
        <div>
          <dt>{t('card.charge')}</dt>
          <dd>{def.sendToPower ?? 0}</dd>
        </div>
        {inBattleZone && def.attack && (
          <div className="carddetail-stat-wide">
            <dt>{t('board.hpChange.effectiveAttack' as never)}</dt>
            <dd data-warn={isAttackPowerInsufficient(focus.card, G, focus.owner)}>
              {isAttackPowerInsufficient(focus.card, G, focus.owner)
                ? t('board.hpChange.insufficientPower' as never)
                : (getEffectiveAttack(focus.card, G, focus.owner) ?? getBaseAttack(focus.card, G, focus.owner) ?? '—')}
            </dd>
          </div>
        )}
      </dl>
      <p className="carddetail-effect">{localizedEffect || t('card.noEffect' as never)}</p>
    </div>
  );
}

/** 桌面常駐側欄詳情面板 */
export function CardDetailPanel({ focus, G, ownerName }: { focus: FocusedCard; G: GameState; ownerName?: string }) {
  return (
    <section className="carddetail-panel battle-focus-panel" aria-label={t('board.panel.focus')}>
      <header className="battle-panel-heading">
        <span>{t('board.panel.focus')}</span>
      </header>
      <CardDetailBody focus={focus} G={G} ownerName={ownerName} />
    </section>
  );
}
