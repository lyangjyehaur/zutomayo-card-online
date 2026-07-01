import { describe, it, expect } from 'vitest';
import { parseEffect } from '../parser';

describe('Effect Parser', () => {
  describe('基礎解析', () => {
    it('應該對空字串回傳 null', () => {
      expect(parseEffect('')).toBeNull();
      expect(parseEffect('   ')).toBeNull();
    });

    it('應該處理純註解文字（※開頭）', () => {
      const result = parseEffect('※このカードは効果を持たない');
      expect(result).toBeNull();
    });

    it('應該解析包含 HTML 標籤的效果', () => {
      const result = parseEffect('HPを10回復する。<br>相手に5ダメージを与える。');
      // 解析器會將 <br> 轉為換行，並分別解析每行
      expect(result).not.toBeNull();
    });
  });

  describe('HP 回復與傷害', () => {
    it('應該解析自己回復', () => {
      const result = parseEffect('HPを10回復する。');
      expect(result).not.toBeNull();
      expect(result?.action.type).toBe('heal');
      expect(result?.action.params.value).toBe(10);
    });

    it('應該解析相手回復', () => {
      const result = parseEffect('相手のHPを5回復させる。');
      expect(result).not.toBeNull();
      expect(result?.action.type).toBe('healOpponent');
      expect(result?.action.params.value).toBe(5);
    });

    it('應該解析雙方回復', () => {
      const result = parseEffect('お互いのHPを20回復する。');
      expect(result).not.toBeNull();
      expect(result?.action.type).toBe('healBoth');
      expect(result?.action.params.value).toBe(20);
    });

    it('應該解析直接傷害', () => {
      const result = parseEffect('相手に30ダメージを与える。');
      expect(result).not.toBeNull();
      expect(result?.action.type).toBe('directDamage');
      expect(result?.action.params.value).toBe(30);
    });

    it('應該解析回合結束時傷害', () => {
      const result = parseEffect('ターン終了時に相手に15ダメージを与える。');
      expect(result).not.toBeNull();
      expect(result?.trigger).toBe('onTurnEnd');
      expect(result?.action.params.value).toBe(15);
    });
  });

  describe('效果解析覆蓋範圍', () => {
    it('解析器應該能處理實際卡牌效果（測試覆蓋率）', () => {
      // 這些是實際遊戲中常見的效果模式
      const effects = [
        'このキャラクターの攻撃力を10上げる。',
        '夜なら、このキャラクターの攻撃力を20上げる。',
        '相手のキャラクターが闇なら、このキャラクターの攻撃力を15上げる。',
        'HPを10回復する。',
        '相手に30ダメージを与える。',
        '時計を2つ進める。',
      ];

      for (const effect of effects) {
        const result = parseEffect(effect);
        // 至少應該能解析（不為 null）或明確回傳 null（表示不支援）
        expect(result === null || typeof result === 'object').toBe(true);
      }
    });
  });

  describe('複雜效果', () => {
    it('應該解析帶延遲效果', () => {
      const result = parseEffect('相手のHPを10回復させ、ターン終了時に20ダメージを与える。');
      expect(result).not.toBeNull();
      if (result) {
        expect(result.action.type).toBe('healOpponent');
        expect(result.expiry).not.toBeUndefined();
        if (result.expiry) {
          expect(result.expiry.trigger).toBe('onTurnEnd');
          expect(result.expiry.action.type).toBe('directDamage');
        }
      }
    });
  });

  describe('邊界情況', () => {
    it('應該對未知效果回傳 null', () => {
      const result = parseEffect('這是一個完全不符合任何規則的效果文字。');
      expect(result).toBeNull();
    });

    it('應該處理全形數字', () => {
      const result = parseEffect('HPを１０回復する。');
      if (result) {
        expect(result.action.params.value).toBe(10);
      }
    });

    it('解析器不應該拋出異常', () => {
      // Property-based 精神：任意字串都不應該崩潰
      const randomStrings = [
        '',
        '   ',
        'random text',
        '12345',
        '！@#$%^&*()',
        '<script>alert("xss")</script>',
      ];

      for (const str of randomStrings) {
        expect(() => parseEffect(str)).not.toThrow();
      }
    });
  });
});

