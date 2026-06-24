// 4 themed preset decks by element, 20 cards each
// Built from low-cost cards for fast games

export const PRESET_DECKS: Record<string, { name: string; ids: string[] }> = {
  dark: {
    name: '闇デッキ — Dark Side',
    ids: [
      '1st_9', '1st_9',   // にらちゃん SR
      '1st_10', '1st_10', // にらちゃん R
      '1st_33', '1st_34', // にらチャイナ
      '1st_65', '1st_66', // 配達員
      '1st_37', '1st_36', // にらちゃん N
      '1st_25', '1st_26', // 顕現するハサミ / 開幕宣言 (Enchant)
      '1st_53', '1st_54', // お勉強会 / 稲妻のレンジ
      '1st_55', '1st_81', // Enchant
      '2nd_5', '2nd_86',  // Enchant / AE
      '1st_11', '1st_11', // にらちゃん R x2
    ],
  },
  flame: {
    name: '炎デッキ — Flame Burst',
    ids: [
      '1st_13', '1st_13', // にらちゃん SR
      '1st_14', '1st_14', // にらちゃん R
      '1st_38', '1st_39', // にらチャイナ
      '1st_69', '1st_70', // 配達員
      '1st_40', '1st_41', // にらちゃん N
      '1st_6', '1st_27',  // Enchant
      '1st_28', '1st_56', // Enchant
      '1st_57', '1st_58', // Enchant
      '2nd_58', '2nd_92', // Enchant / AE
      '1st_71', '1st_72', // にらちゃん N x2
    ],
  },
  electric: {
    name: '電気デッキ — Thunder Strike',
    ids: [
      '1st_17', '1st_17', // にらちゃん SR
      '1st_18', '1st_18', // にらちゃん R
      '1st_43', '1st_44', // にらチャイナ
      '1st_73', '1st_74', // 配達員
      '1st_45', '1st_46', // にらちゃん N
      '1st_7', '1st_29',  // Enchant
      '1st_30', '1st_59', // Enchant
      '1st_60', '1st_61', // Enchant
      '2nd_7', '2nd_98',  // Enchant / AE
      '1st_47', '1st_47', // にらちゃん N x2
    ],
  },
  wind: {
    name: '風デッキ — Wind Rider',
    ids: [
      '1st_4', '1st_4',   // にらちゃん UR
      '1st_21', '1st_21', // にらちゃん SR
      '1st_22', '1st_23', // にらチャイナ
      '1st_48', '1st_49', // 配達員
      '1st_50', '1st_51', // にらちゃん N
      '1st_8', '1st_31',  // Enchant
      '1st_62', '1st_63', // Enchant
      '1st_64', '1st_99', // Enchant
      '2nd_64', '2nd_104', // Enchant / AE
      '1st_52', '1st_52', // にらちゃん N x2
    ],
  },
};
