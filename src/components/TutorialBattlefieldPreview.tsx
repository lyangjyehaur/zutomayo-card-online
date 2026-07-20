import { TUTORIAL_SHOWCASE_CARDS, type TutorialShowcaseCardId } from '../data/tutorialShowcaseCards';
import { registerCardDefFallbacks } from '../game/cards/loader';
import type { CardInstance } from '../game/types';
import type { CSSProperties } from 'react';
import { t } from '../i18n';
import { AbyssZone, BattleZone, ChargeZone, ChronosPanel, DeckZone, PlayerStatus, SetZone } from '../ui/game';

registerCardDefFallbacks(Object.values(TUTORIAL_SHOWCASE_CARDS));

function previewCard(defId: TutorialShowcaseCardId, suffix: string): CardInstance {
  return { instanceId: `tutorial-preview-${defId}-${suffix}`, defId, faceUp: true };
}

const PLAYER = {
  battle: previewCard('1st_34', 'player-battle'),
  area: previewCard('3rd_58', 'player-area'),
  power: [previewCard('2nd_40', 'player-power-1'), previewCard('2nd_40', 'player-power-2')],
  abyss: [previewCard('1st_67', 'player-abyss')],
};

const OPPONENT = {
  battle: previewCard('1st_67', 'opponent-battle'),
  enchant: previewCard('1st_100', 'opponent-enchant'),
  power: [previewCard('3rd_58', 'opponent-power-1')],
  abyss: [previewCard('2nd_40', 'opponent-abyss')],
};

export type TutorialFieldZone = 'battle' | 'chronos' | 'set' | 'power' | 'deck' | 'abyss' | 'hp';

function targetClass(active: boolean, explored: boolean): string {
  return `tutorial-field-target rounded-sm ring-inset transition focus-within:outline-none focus-within:ring-2 focus-within:ring-inset focus-within:ring-accent-primary/70 ${
    active
      ? 'ring-2 ring-accent-primary/80 bg-accent-primary/10'
      : explored
        ? 'ring-1 ring-accent-action/60 bg-accent-action/5 hover:ring-2 hover:ring-accent-action/75'
        : 'hover:ring-2 hover:ring-accent-primary/45'
  }`;
}

function SideLabel({ side }: { side: 'me' | 'opponent' }) {
  return (
    <div className="min-w-20 text-center font-mono uppercase tracking-[var(--tracking-label)]">
      <span className="block text-[0.625rem] opacity-65">{side === 'me' ? 'PLAYER' : 'OPPONENT'}</span>
      <strong className="mt-1 block text-body-sm">{t(side === 'me' ? 'player.me' : 'player.opponent')}</strong>
    </div>
  );
}

export function TutorialBattlefieldPreview({
  selectedZone,
  exploredZones,
  onSelectZone,
}: {
  selectedZone: TutorialFieldZone;
  exploredZones: ReadonlySet<TutorialFieldZone>;
  onSelectZone: (zone: TutorialFieldZone) => void;
}) {
  return (
    <section
      className="h-[44rem] min-h-0 overflow-hidden rounded-md border border-border-soft bg-surface-canvas shadow-raised min-[30rem]:h-[38rem] min-[35rem]:h-[36rem] min-[40rem]:h-[35rem]"
      aria-label={t('tutorial.chapter.field.subtitle')}
      data-testid="tutorial-real-board-preview"
    >
      <div className="bf-root chrono-night" data-board-layout="tutorial-simplified">
        <div className="bf-field" data-time="night" data-night-side="me">
          <section className="bf-opponent" aria-label={t('player.opponent')}>
            <div className="flex w-full max-w-md items-center justify-center gap-3">
              <SideLabel side="opponent" />
              <button
                type="button"
                className={`${targetClass(selectedZone === 'hp', exploredZones.has('hp'))} min-w-40 flex-1 p-2 text-left`}
                data-testid="tutorial-field-target-hp-opponent"
                data-explored={exploredZones.has('hp') || undefined}
                aria-pressed={selectedZone === 'hp'}
                onClick={() => onSelectZone('hp')}
              >
                <PlayerStatus
                  side="opponent"
                  name={t('player.opponent')}
                  hp={70}
                  className="[&_.playerstatus-name]:sr-only"
                />
              </button>
            </div>
            <div className="bf-strip !flex !w-full !flex-col !items-center !justify-center !gap-1 !overflow-visible [--card-height-sm:calc(var(--card-width-sm)*7/5)] [--card-width-sm:clamp(2rem,9vw,2.5rem)] [--slot-height-sm:calc(var(--card-height-sm)+0.25rem)] [--slot-width-sm:calc(var(--card-width-sm)+0.25rem)] [--space-slot-gap:clamp(0.125rem,1vw,0.5rem)] min-[30rem]:!flex-row min-[30rem]:!flex-nowrap min-[30rem]:!items-end min-[30rem]:!gap-2 min-[30rem]:[--card-width-sm:clamp(2.25rem,5vw,3rem)]">
              <div
                className="flex items-end justify-center gap-2 min-[30rem]:contents"
                data-testid="tutorial-field-opponent-upper-row"
              >
                <div
                  className={targetClass(selectedZone === 'abyss', exploredZones.has('abyss'))}
                  data-testid="tutorial-field-target-abyss-opponent"
                  data-card-ids={OPPONENT.abyss.map((card) => card.defId).join(',')}
                  data-explored={exploredZones.has('abyss') || undefined}
                >
                  <AbyssZone
                    side="opponent"
                    size="sm"
                    cards={OPPONENT.abyss}
                    chronosSide="day"
                    tutId="opponent-abyss"
                    onOpen={() => onSelectZone('abyss')}
                  />
                </div>
                <button
                  type="button"
                  className={targetClass(selectedZone === 'deck', exploredZones.has('deck'))}
                  data-testid="tutorial-field-target-deck-opponent"
                  data-explored={exploredZones.has('deck') || undefined}
                  aria-pressed={selectedZone === 'deck'}
                  onClick={() => onSelectZone('deck')}
                >
                  <DeckZone side="opponent" size="sm" count={12} chronosSide="day" />
                </button>
              </div>
              <div
                className="flex items-end justify-center gap-2 min-[30rem]:contents"
                data-testid="tutorial-field-opponent-lower-row"
              >
                <div
                  className={`bf-slot-group ${targetClass(selectedZone === 'set', exploredZones.has('set'))}`}
                  data-testid="tutorial-field-target-set"
                  data-explored={exploredZones.has('set') || undefined}
                >
                  <SetZone
                    slot="A"
                    side="opponent"
                    size="sm"
                    card={OPPONENT.enchant}
                    chronosSide="day"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                  <SetZone
                    slot="B"
                    side="opponent"
                    size="sm"
                    card={null}
                    chronosSide="day"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                  <SetZone
                    slot="C"
                    side="opponent"
                    size="sm"
                    card={null}
                    chronosSide="day"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                </div>
                <div
                  className={targetClass(selectedZone === 'power', exploredZones.has('power'))}
                  data-testid="tutorial-field-target-power-opponent"
                  data-card-ids={OPPONENT.power.map((card) => card.defId).join(',')}
                  data-explored={exploredZones.has('power') || undefined}
                >
                  <ChargeZone
                    side="opponent"
                    size="sm"
                    cards={OPPONENT.power}
                    totalPower={1}
                    chronosSide="day"
                    tutId="opponent-power"
                    onOpen={() => onSelectZone('power')}
                  />
                </div>
              </div>
            </div>
          </section>

          <section
            className="bf-stage"
            data-tut="central-arena"
            aria-label={t('chronos.title')}
            style={{ '--bf-stage-character-opacity': 0 } as CSSProperties}
          >
            <div
              className={targetClass(selectedZone === 'battle', exploredZones.has('battle'))}
              data-testid="tutorial-field-target-battle"
              data-explored={exploredZones.has('battle') || undefined}
              onClick={() => onSelectZone('battle')}
            >
              <BattleZone
                side="opponent"
                card={OPPONENT.battle}
                time="night"
                attack={{ value: 50, insufficient: false }}
                tutId="opponent-battle-zone"
                state={selectedZone === 'battle' ? 'highlight' : 'idle'}
                onActivate={() => onSelectZone('battle')}
              />
            </div>
            <button
              type="button"
              className={targetClass(selectedZone === 'chronos', exploredZones.has('chronos'))}
              data-testid="tutorial-field-target-chronos"
              data-explored={exploredZones.has('chronos') || undefined}
              aria-pressed={selectedZone === 'chronos'}
              onClick={() => onSelectZone('chronos')}
            >
              <ChronosPanel
                chronos={{ position: 3, nightSidePlayer: 0 }}
                currentTime="night"
                currentPlayer={0}
                size="sm"
              />
            </button>
            <div
              className={targetClass(selectedZone === 'battle', exploredZones.has('battle'))}
              data-testid="tutorial-field-target-battle-player"
              data-explored={exploredZones.has('battle') || undefined}
              onClick={() => onSelectZone('battle')}
            >
              <BattleZone
                side="me"
                card={PLAYER.battle}
                time="night"
                attack={{ value: 70, insufficient: false }}
                tutId="player-battle-zone"
                state={selectedZone === 'battle' ? 'highlight' : 'idle'}
                onActivate={() => onSelectZone('battle')}
              />
            </div>
          </section>

          <section className="bf-player" aria-label={t('player.me')}>
            <div className="bf-strip !flex-wrap !justify-center !overflow-visible sm:!flex-nowrap sm:!overflow-x-auto sm:!overflow-y-hidden">
              <div
                className={targetClass(selectedZone === 'power', exploredZones.has('power'))}
                data-testid="tutorial-field-target-power"
                data-card-ids={PLAYER.power.map((card) => card.defId).join(',')}
                data-explored={exploredZones.has('power') || undefined}
              >
                <ChargeZone
                  side="me"
                  size="sm"
                  cards={PLAYER.power}
                  totalPower={2}
                  chronosSide="night"
                  tutId="player-power"
                  onOpen={() => onSelectZone('power')}
                />
              </div>
              <div
                className={targetClass(selectedZone === 'set', exploredZones.has('set'))}
                data-testid="tutorial-field-target-set-player"
                data-explored={exploredZones.has('set') || undefined}
              >
                <div className="bf-slot-group">
                  <SetZone
                    slot="A"
                    side="me"
                    size="sm"
                    card={null}
                    chronosSide="night"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                  <SetZone
                    slot="B"
                    side="me"
                    size="sm"
                    card={null}
                    chronosSide="night"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                  <SetZone
                    slot="C"
                    side="me"
                    size="sm"
                    card={PLAYER.area}
                    chronosSide="night"
                    state={selectedZone === 'set' ? 'highlight' : 'idle'}
                    onActivate={() => onSelectZone('set')}
                  />
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1" data-testid="tutorial-field-player-deck-abyss-group">
                <button
                  type="button"
                  className={targetClass(selectedZone === 'deck', exploredZones.has('deck'))}
                  data-testid="tutorial-field-target-deck"
                  data-explored={exploredZones.has('deck') || undefined}
                  aria-pressed={selectedZone === 'deck'}
                  onClick={() => onSelectZone('deck')}
                >
                  <DeckZone side="me" size="sm" count={11} chronosSide="night" />
                </button>
                <div
                  className={targetClass(selectedZone === 'abyss', exploredZones.has('abyss'))}
                  data-testid="tutorial-field-target-abyss"
                  data-card-ids={PLAYER.abyss.map((card) => card.defId).join(',')}
                  data-explored={exploredZones.has('abyss') || undefined}
                >
                  <AbyssZone
                    side="me"
                    size="sm"
                    cards={PLAYER.abyss}
                    chronosSide="night"
                    tutId="player-abyss"
                    onOpen={() => onSelectZone('abyss')}
                  />
                </div>
              </div>
            </div>
            <div className="flex w-full max-w-md items-center justify-center gap-3">
              <SideLabel side="me" />
              <button
                type="button"
                className={`${targetClass(selectedZone === 'hp', exploredZones.has('hp'))} min-w-40 flex-1 p-2 text-left`}
                data-testid="tutorial-field-target-hp"
                data-explored={exploredZones.has('hp') || undefined}
                aria-pressed={selectedZone === 'hp'}
                onClick={() => onSelectZone('hp')}
              >
                <PlayerStatus side="me" name={t('player.me')} hp={100} className="[&_.playerstatus-name]:sr-only" />
              </button>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
