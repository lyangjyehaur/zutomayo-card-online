import { describe, expect, it } from 'vitest';
import type { SynergyCard } from '../cardSynergyModel';
import { buildSynergyGroups, buildSynergyRelations, deriveSynergyProfiles } from '../cardSynergyModel';

function card(id: string, name: string, effect: string, metadata: Partial<SynergyCard> = {}): SynergyCard {
  return { id, name, effect, playStatus: 'playable', source: 'reviewed-extraction', ...metadata };
}

describe('card synergy model', () => {
  it('links an Abyss enabler to a card that consumes Abyss stock', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '深淵準備', 'デッキの上からカードを３枚アビスに置く'),
      card('b', '深淵收益', 'アビスにカードが３枚以上あるなら、HPを10回復する'),
    ]);
    const relations = buildSynergyRelations(profiles);

    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceCardId: 'a',
          targetCardId: 'b',
          kind: 'enables',
          concepts: expect.arrayContaining(['own-abyss-stock']),
        }),
      ]),
    );
  });

  it('links damage reduction to a payoff based on the reduced value', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '減傷', '受けるダメージを30軽減する'),
      card('b', '反擊', 'このターンに軽減した数値分のダメージを相手に与える'),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation?.concepts).toContain('damage-reduced');
    expect(relation?.categories).toContain('hp_damage');
    expect(relation?.score).toBeGreaterThanOrEqual(70);
  });

  it('marks Abyss filling as a conflict with an empty-Abyss condition', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '深淵準備', 'デッキの上からカードを３枚アビスに置く'),
      card('b', '空無', 'アビスにカードがないなら、攻撃力+50'),
    ]);
    const relation = buildSynergyRelations(profiles).find((entry) => entry.kind === 'conflicts');

    expect(relation).toMatchObject({ sourceCardId: 'a', targetCardId: 'b', recommendationEligible: false });
  });

  it('builds multi-card packages from reviewed pair candidates', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '深淵準備一', 'デッキの上からカードを３枚アビスに置く'),
      card('b', '深淵準備二', '手札からカードを１枚アビスに置く'),
      card('c', '深淵收益', 'アビスにカードが３枚以上あるなら、HPを10回復する'),
    ]);
    const relations = buildSynergyRelations(profiles);
    const group = buildSynergyGroups(profiles, relations).find((entry) => entry.concept === 'own-abyss-stock');

    expect(group?.enablerCardIds).toEqual(expect.arrayContaining(['a', 'b']));
    expect(group?.payoffCardIds).toContain('c');
    expect(group?.category).toBe('zone_resource');
  });

  it('links a Character song to a named battle-zone condition', () => {
    const profiles = deriveSynergyProfiles([
      card('a', 'にらちゃん（猫リセット）', '', { type: 'Character', song: '猫リセット' }),
      card('b', '爆弾の在処', 'バトルゾーンのカードが（猫リセット）のキャラクターなら、攻撃力+30'),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation).toMatchObject({ confidence: 'high', playabilityEligible: true, recommendationEligible: false });
    expect(relation?.concepts).toContain('named-card:猫リセット');
    expect(relation?.categories).toContain('named_card_song');
  });

  it('links a Character element to a previous-turn element condition', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '炎のキャラクター', '', { type: 'Character', element: '炎' }),
      card('b', '次の一手', '前のターンで使用したキャラクターカードの属性が炎なら攻撃力+20'),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation?.concepts).toContain('previous-element:炎');
    expect(relation?.categories).toContain('element');
  });

  it('does not link cards merely because they share a card type', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '角色一', '', { type: 'Character' }),
      card('b', '角色二', '', { type: 'Character' }),
    ]);

    expect(buildSynergyRelations(profiles)).toEqual([]);
  });

  it('links a Character only when another effect explicitly benefits from that type', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '角色一', '', { type: 'Character' }),
      card('b', '角色支援', '同時に出した自分のキャラクターカードの攻撃力+20', { type: 'Enchant' }),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation?.concepts).toContain('simultaneous-character');
    expect(relation?.categories).toContain('card_stats_type');
  });

  it('keeps multiple interaction categories on a single relation', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '猫リセット', '受けるダメージを30軽減する'),
      card(
        'b',
        '複合收益',
        'バトルゾーンのカードが（猫リセット）なら、このターンに軽減した数値分のダメージを相手に与える',
      ),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation?.categories).toEqual(expect.arrayContaining(['named_card_song', 'hp_damage']));
    expect(relation?.primaryCategory).toBe('named_card_song');
  });

  it('keeps disabled cards out of the future playable recommendation pool', () => {
    const profiles = deriveSynergyProfiles([
      card('a', '深淵準備', 'デッキの上からカードを３枚アビスに置く', { playStatus: 'disabled' }),
      card('b', '深淵收益', 'アビスにカードが３枚以上あるなら、HPを10回復する'),
    ]);
    const relation = buildSynergyRelations(profiles).find(
      (entry) => entry.sourceCardId === 'a' && entry.targetCardId === 'b',
    );

    expect(relation).toMatchObject({ playabilityEligible: false, recommendationEligible: false });
  });
});
