import type { CardType, Element } from '../types';
import type { TranslationKey } from '../../i18n';

export function getCardElementTranslationKey(element: Element): TranslationKey {
  switch (element) {
    case '闇':
      return 'card.element.dark';
    case '炎':
      return 'card.element.flame';
    case '電気':
      return 'card.element.electric';
    case '風':
      return 'card.element.wind';
    case 'カオス':
      return 'card.element.chaos';
  }
}

export function getCardTypeTranslationKey(type: CardType): TranslationKey {
  switch (type) {
    case 'Character':
      return 'card.type.character';
    case 'Enchant':
      return 'card.type.enchant';
    case 'Area Enchant':
      return 'card.type.areaEnchant';
  }
}
