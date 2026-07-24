import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../pages/LobbyPage.tsx'), 'utf8');
const styles = readFileSync(resolve(import.meta.dirname, '../pages/LobbyPage.css'), 'utf8');

describe('lobby home information hierarchy', () => {
  it('separates start actions, announcements, and utility channels', () => {
    expect(source).toContain('START_CHANNELS');
    expect(source).toContain('UTILITY_CHANNELS');
    expect(source).toContain('<HomeAnnouncements');
    expect(source).toContain('lobby.homeExplore');
    expect(source).not.toContain('lg:grid-cols-7');
  });

  it('keeps every primary product destination on the home page', () => {
    for (const path of [
      '/online',
      '/ai',
      '/tutorial',
      '/deck-builder',
      '/deck-shares',
      '/rules/qa',
      '/leaderboard',
      '/history',
      '/community',
    ]) {
      expect(source).toContain(path);
    }
  });

  it('keeps the card-art atmosphere visibly present behind the home content', () => {
    expect(source).toContain('lobby-background-slide');
    expect(source).toContain('bg-surface-canvas/52 sm:bg-surface-canvas/62');
    expect(source).not.toContain('bg-surface-canvas/80');
  });

  it('preloads the next background before starting the crossfade carousel', () => {
    expect(source).toContain('LOBBY_BACKGROUND_HOLD_MS');
    expect(source).toContain('pendingBackgroundImage');
    expect(source).toContain('onLoad={() => setBackgroundTransitioning(true)}');
    expect(source).toContain('data-lobby-background="next"');
    expect(styles).toContain('transition: opacity 1800ms ease-in-out');
    expect(styles).toContain('transform: scale(1.08)');
    expect(styles).toContain('transform: scale(1.02)');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
