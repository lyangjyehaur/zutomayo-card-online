import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CHRONOS_MAPPING } from '../../../game/types';
import { t } from '../../../i18n';
import { ChronosDial } from '../../../ui/game/ChronosDial';

const boardSource = readFileSync('src/components/Board.tsx', 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = boardSource.indexOf(start);
  const endIndex = boardSource.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return boardSource.slice(startIndex, endIndex);
}

describe('battle accessibility contracts', () => {
  it('exposes the visual Chronos dial as one named image', () => {
    const markup = renderToStaticMarkup(
      createElement(ChronosDial, {
        chronos: { position: 3, nightSidePlayer: 0 },
        currentTime: 'night',
        currentPlayer: 0,
      }),
    );

    expect(markup).toContain('class="chronosdial"');
    expect(markup).toContain('role="img"');
    expect(markup).toContain(`aria-label="${t('chronos.title')} 3/${CHRONOS_MAPPING.positions} · ${t('board.night')}"`);
  });

  it('names the opponent hand-back composite and keeps battle log text on AA tokens', () => {
    expect(boardSource).toMatch(/className="bf-opponent-handbacks" role="img" aria-label=/);

    const breakdownSource = sourceBetween('function LogBreakdown', 'function jankenMark');
    const logSource = sourceBetween('function BattleLogSidebarPanel', 'function BattleStatusSidebarPanel');
    const blockingTokens = /text-content-primary\/(?:20|25|30)|text-accent-action\/80|text-accent-primary\/60/;

    expect(breakdownSource).not.toMatch(blockingTokens);
    expect(logSource).not.toMatch(blockingTokens);
    expect(logSource).toContain('text-content-muted');
    expect(logSource).toContain("tone === 'battle'");
    expect(logSource).toContain("? 'text-accent-action'");
  });
});
