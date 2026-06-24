# zutomayo-card-online

ZUTOMAYO CARD 線上對戰平台

## 數據來源

- 卡牌數據: [zutomayo-card.net/search](https://zutomayocard.net/search/) (Meilisearch API)
- 規則: [Start Guide](https://zutomayocard.net/start-guide/) + [ルールガイド v1.0.0](https://etbr-cms-site.s3.ap-northeast-1.amazonaws.com/zutomayocard.net/rule/ruleguide_260216.pdf)

## 數據統計

| 項目 | 數量 |
|------|------|
| 總卡牌數 | 422 |
| Character | 242 |
| Enchant | 153 |
| Area Enchant | 27 |
| 有效果文字 | 251 |
| 純數值卡 | 171 |

### 卡包

| 卡包 | 數量 |
|------|------|
| THE WORLD IS CHANGING | 106 |
| ALL ALONG THE WATCHTOWER | 106 |
| Off Minor | 106 |
| Fantasy Is Reality | 104 |

### 屬性

闇(104) / 炎(104) / 電気(106) / 風(104) / カオス(4)

## 檔案結構

```
zutomayo-card-online/
├── README.md           # 本文件
├── cards.json          # 全部 422 張卡（遊戲用格式）
├── schema.json         # 數據結構定義 + 效果模式統計
├── rules.md            # 完整遊戲規則
└── cards-by-pack/      # 按卡包分類
    ├── the-world-is-changing.json
    ├── all-along-the-watchtower.json
    ├── off-minor.json
    └── fantasy-is-reality.json
```

## cards.json 格式

```json
{
  "id": "1st_1",
  "name": "にらちゃん（お勉強しといてよ）",
  "pack": "THE WORLD IS CHANGING",
  "song": "お勉強しといてよ",
  "illustrator": "はなぶし",
  "rarity": "UR",
  "element": "闇",
  "type": "Character",
  "clock": 5,
  "attack": { "night": 130, "day": 50 },
  "powerCost": 5,
  "sendToPower": 0,
  "effect": "",
  "image": "https://d12oj0i0pu43cb.cloudfront.net/...",
  "errata": ""
}
```

## 技術計劃

- 框架: boardgame.io (回合制) + React (UI)
- 效果引擎: Pattern matching + 少量腳本
- 多人: boardgame.io 內建 WebSocket
