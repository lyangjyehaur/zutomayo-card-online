import type { Locale } from './i18n';

export const LEGAL_OPERATOR = 'ZUTOMAYO CARD ONLINE Community';
export const LEGAL_CONTACT_EMAIL = 'contact@mail.zutomayocard.online';
export const OFFICIAL_FAN_GUIDELINE_URL = 'https://zutomayo.net/legal/';
export const LEGAL_EFFECTIVE_DATE = '2026-07-19';

export type LegalDocumentId = 'overview' | 'privacy' | 'terms' | 'contact';

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDocument {
  title: string;
  summary: string;
  sections: LegalSection[];
}

export interface LegalLocaleContent {
  pageTitle: string;
  updatedLabel: string;
  authoritativeNotice: string;
  navigationLabel: string;
  documents: Record<LegalDocumentId, LegalDocument>;
}

const zhTW: LegalLocaleContent = {
  pageTitle: '政策與聯絡',
  updatedLabel: '生效與更新日期',
  authoritativeNotice: '繁體中文版是目前專案的主要政策記錄；其他語言版本供玩家理解與參考。',
  navigationLabel: '政策文件',
  documents: {
    overview: {
      title: '非官方與非營利聲明',
      summary: '說明本專案的社群定位、素材使用基礎、營運者與權利人聯絡方式。',
      sections: [
        {
          heading: '專案定位',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE 是由粉絲維護的非官方、非營利線上對戰服務，目的是推廣 ZUTOMAYO CARD 的玩法，讓不易取得實體卡牌的海外玩家也能參與對戰與社群交流。',
            '本專案與 ZUTOMAYO、相關唱片公司、卡牌發行或製作單位沒有從屬、代理、贊助或授權合作關係。',
          ],
        },
        {
          heading: '素材與二次創作基礎',
          paragraphs: [
            '本專案依據 ZUTOMAYO 官方公開的著作物使用指引，以非營利、非商用方式製作與營運。卡牌名稱、圖像、商標及相關素材的權利仍歸原權利人所有。',
            '服務只在遊戲、牌組構築與規則說明所需範圍展示素材，不販售卡圖、不提供素材包、批量下載或以素材本身獲利。',
          ],
        },
        {
          heading: '營運者',
          bullets: [
            `營運名稱：${LEGAL_OPERATOR}`,
            `聯絡信箱：${LEGAL_CONTACT_EMAIL}`,
            '營運模式：免費、無廣告、非商用',
          ],
        },
        {
          heading: '權利人通知',
          paragraphs: [
            '權利人如對內容使用有疑問，請寄送可識別權利人身分、涉及內容及希望採取措施的說明。營運者會優先確認，並可在調查期間限制或暫時隱藏相關內容。',
          ],
        },
      ],
    },
    privacy: {
      title: '隱私政策',
      summary: '說明服務蒐集哪些資料、使用目的、保存期限，以及玩家如何匯出或刪除資料。',
      sections: [
        {
          heading: '資料控制與聯絡',
          paragraphs: [
            `本服務由 ${LEGAL_OPERATOR} 維護。隱私、資料匯出、帳號刪除或安全相關問題請聯絡 ${LEGAL_CONTACT_EMAIL}。`,
          ],
        },
        {
          heading: '蒐集的資料',
          bullets: [
            '帳號資料：Email、暱稱、驗證狀態及玩家選擇使用的登入供應商識別資料。',
            '遊戲資料：牌組、配對、對局結果、ELO、回合與伺服器產生的操作紀錄。',
            '社交與社群資料：好友、封鎖、聊天訊息、舉報、moderation 與制裁紀錄。',
            '技術資料：IP、user agent、request ID、錯誤、效能、安全與稽核日誌。',
          ],
        },
        {
          heading: '使用目的',
          bullets: [
            '提供帳號、牌組、配對、對戰、聊天、排行榜與客服功能。',
            '維持遊戲公平、偵測濫用、處理舉報及保護服務安全。',
            '分析不識別個人的首次體驗、效能與服務可靠性。',
          ],
          paragraphs: ['本服務不出售個人資料，也不使用私人聊天或帳號資料建立廣告画像。'],
        },
        {
          heading: '服務供應與分析',
          paragraphs: [
            '服務可能使用主機與 CDN、Postgres/Redis、OAuth 或 Logto 登入、Email 寄送、Umami 分析及 Sentry 相容錯誤追蹤。只有玩家選擇或正式環境實際啟用的供應者才會收到必要資料。',
            '分析事件採允許清單，不包含聊天內容、卡牌內容或不必要的原始玩家識別碼。',
          ],
        },
        {
          heading: '保存期限',
          bullets: [
            '帳號與牌組：帳號有效期間；刪除請求確認後 30 天內刪除或匿名化。',
            '完成對局與排名：365 天；操作紀錄與聊天：通常 180 天。',
            '舉報、制裁與管理稽核：通常 365 天；應用日誌 30 天；metrics 90 天；加密備份 35 天。',
          ],
          paragraphs: ['安全事件、爭議或合法保存要求可能暫停特定資料的刪除。'],
        },
        {
          heading: '玩家權利',
          paragraphs: [
            '登入後可在個人頁匯出帳號資料或刪除帳號。無法登入時可由註冊 Email 聯絡營運者。刪除後，維持排行榜與反作弊完整性所需的對局資料可能在移除直接識別資訊後保留。',
          ],
        },
        {
          heading: '安全、跨境與變更',
          paragraphs: [
            '服務使用 TLS、權限分離與加密備份等措施，但網路服務無法保證絕對安全。資料可能在服務供應者所在地處理。政策有重大變更時會更新日期並透過服務公告。',
          ],
        },
      ],
    },
    terms: {
      title: '服務條款',
      summary: '使用本 Beta 服務前應了解的帳號、公平對戰、社群行為與服務可用性規則。',
      sections: [
        {
          heading: '接受條款與 Beta 性質',
          paragraphs: [
            '使用或註冊本服務即表示同意本條款與隱私政策。本服務是免費的公開測試版本，功能、資料格式與可用性可能因維護、安全或規則校正而變更。',
            '未達所在地獨立同意網路服務所需年齡的玩家，應先取得監護人同意。',
          ],
        },
        {
          heading: '帳號責任',
          bullets: [
            '提供可用的 Email 與適當暱稱，並保護登入憑證。',
            '不得冒用他人、買賣帳號、規避封鎖或大量自動建立帳號。',
            '發現帳號遭未授權使用時應立即聯絡營運者。',
          ],
        },
        {
          heading: '公平對戰',
          paragraphs: ['伺服器紀錄是牌組、操作、配對與結果的主要依據。以下行為可能導致排名撤銷、暫停或終止帳號：'],
          bullets: [
            '利用漏洞操縱結果或排名。',
            '窺探隱藏資訊、修改客戶端、腳本化操作或干擾服務。',
            '與其他玩家串通洗分或故意破壞配對。',
          ],
        },
        {
          heading: '聊天與社群行為',
          bullets: [
            '不得騷擾、威脅、歧視、冒充、散播違法內容或公開他人私人資料。',
            '聊天與舉報證據可為安全與 moderation 目的被保存、隱藏或審查。',
            '玩家可使用封鎖、舉報與申訴管道；營運者會記錄制裁理由與期限。',
          ],
        },
        {
          heading: '智慧財產與非商用限制',
          paragraphs: [
            '本服務不授予玩家重新販售、批量下載或重新散布官方卡牌素材的權利。玩家自行提交的內容仍由提交者負責，並須有權在本服務中使用。',
          ],
        },
        {
          heading: '暫停、終止與免責',
          paragraphs: [
            '營運者可為安全、維護、法律或權利人要求暫停部分或全部服務。除適用法律另有要求外，不保證服務永久不中斷、資料永不遺失或與實體賽事裁定完全一致。',
            '玩家可停止使用、匯出資料或刪除帳號。違反條款、危害玩家或服務安全時，營運者可限制或終止存取。',
          ],
        },
        {
          heading: '變更與聯絡',
          paragraphs: [`重大變更會更新本頁日期。條款、申訴或客服問題請聯絡 ${LEGAL_CONTACT_EMAIL}。`],
        },
      ],
    },
    contact: {
      title: '聯絡與下架申請',
      summary: '提供客服、隱私、帳號、moderation、安全與權利人通知的單一聯絡入口。',
      sections: [
        {
          heading: '聯絡方式',
          bullets: [`營運者：${LEGAL_OPERATOR}`, `Email：${LEGAL_CONTACT_EMAIL}`],
          paragraphs: ['請勿在公開 Issue 或聊天室提交密碼、token、身分文件或其他敏感個人資料。'],
        },
        {
          heading: '建議主旨',
          bullets: [
            '[PRIVACY] 資料匯出、刪除或隱私問題',
            '[RIGHTS] 卡牌、圖片、名稱或其他權利人通知',
            '[MODERATION] 聊天、舉報、封鎖或制裁申訴',
            '[SECURITY] 安全漏洞或帳號遭未授權使用',
            '[SUPPORT] 其他玩家支援問題',
          ],
        },
        {
          heading: '權利人申請內容',
          bullets: [
            '可識別的權利人或代理人聯絡資料。',
            '涉及內容的網址、卡牌編號或畫面說明。',
            '權利基礎及希望採取的措施。',
            '確認資料真實且有權提出申請的聲明。',
          ],
        },
        {
          heading: '處理方式',
          paragraphs: [
            '營運者會確認收件、保存處理紀錄，必要時要求補充資料。對明確且可信的權利或安全通知，可先限制存取或暫時隱藏內容，再完成調查與回覆。',
          ],
        },
      ],
    },
  },
};

const en: LegalLocaleContent = {
  pageTitle: 'Policies & Contact',
  updatedLabel: 'Effective and last updated',
  authoritativeNotice:
    'The Traditional Chinese version is the primary project policy record. Translations are provided for accessibility.',
  navigationLabel: 'Policy documents',
  documents: {
    overview: {
      title: 'Unofficial & Non-commercial Notice',
      summary: 'The community status, basis for asset use, operator identity, and rightsholder contact process.',
      sections: [
        {
          heading: 'Project purpose',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE is an unofficial, non-commercial fan service that promotes the game and lets players who cannot easily obtain physical cards participate in matches and community play.',
            'The service is not affiliated with, sponsored by, represented by, or officially licensed by ZUTOMAYO or the card production and distribution parties.',
          ],
        },
        {
          heading: 'Assets and fan-creation basis',
          paragraphs: [
            'The project operates on a non-commercial basis under ZUTOMAYO’s published copyright guidelines. Card names, images, marks, and related assets remain the property of their respective rightsholders.',
            'Assets are displayed only as needed for gameplay, deck building, and rules. The service does not sell card images or provide asset packs, bulk downloads, or asset-based monetization.',
          ],
        },
        {
          heading: 'Operator',
          bullets: [
            `Operator: ${LEGAL_OPERATOR}`,
            `Contact: ${LEGAL_CONTACT_EMAIL}`,
            'Model: free, advertising-free, and non-commercial',
          ],
        },
        {
          heading: 'Rightsholder notices',
          paragraphs: [
            'A rightsholder may email identification, the affected material, and the requested action. The operator will prioritize credible notices and may restrict or temporarily hide material while reviewing them.',
          ],
        },
      ],
    },
    privacy: {
      title: 'Privacy Policy',
      summary:
        'What data the service processes, why it is used, how long it is retained, and how players can export or delete it.',
      sections: [
        {
          heading: 'Controller and contact',
          paragraphs: [
            `The service is maintained by ${LEGAL_OPERATOR}. Contact ${LEGAL_CONTACT_EMAIL} for privacy, export, deletion, or security requests.`,
          ],
        },
        {
          heading: 'Data processed',
          bullets: [
            'Account data: email, nickname, verification state, and identifiers from a login provider selected by the player.',
            'Game data: decks, matchmaking, results, ELO, turns, and server-generated action records.',
            'Social data: friends, blocks, chat, reports, moderation, and sanction records.',
            'Technical data: IP address, user agent, request IDs, errors, performance, security, and audit logs.',
          ],
        },
        {
          heading: 'Purposes',
          bullets: [
            'Provide accounts, decks, matchmaking, games, chat, leaderboards, and support.',
            'Protect fair play, prevent abuse, review reports, and secure the service.',
            'Measure non-identifying onboarding, performance, and reliability.',
          ],
          paragraphs: [
            'The service does not sell personal data or use private chat or account data for advertising profiles.',
          ],
        },
        {
          heading: 'Providers and analytics',
          paragraphs: [
            'The service may use hosting/CDN, Postgres/Redis, OAuth or Logto, email delivery, Umami analytics, and Sentry-compatible error tracking. Only providers actually enabled or selected receive necessary data.',
            'Analytics uses an allowlist and excludes chat content, card content, and unnecessary raw player identifiers.',
          ],
        },
        {
          heading: 'Retention',
          bullets: [
            'Accounts and decks: while active; deletion or anonymization within 30 days after a verified request.',
            'Completed matches and rating changes: 365 days; action logs and chat: normally 180 days.',
            'Reports, sanctions, and admin audit: normally 365 days; application logs 30 days; metrics 90 days; encrypted backups 35 days.',
          ],
          paragraphs: [
            'Security incidents, disputes, or a lawful preservation requirement may pause deletion of specific records.',
          ],
        },
        {
          heading: 'Player rights',
          paragraphs: [
            'Signed-in players can export data or delete their account from Profile. If sign-in is unavailable, contact the operator from the registered email. Match records needed for rating and anti-cheat integrity may remain after direct identifiers are removed.',
          ],
        },
        {
          heading: 'Security, transfers, and changes',
          paragraphs: [
            'The service uses TLS, separated permissions, and encrypted backups, but no online service is perfectly secure. Data may be processed where service providers operate. Material changes will update the date and be announced in the service.',
          ],
        },
      ],
    },
    terms: {
      title: 'Terms of Service',
      summary: 'Rules for accounts, fair play, community conduct, moderation, and availability of this public Beta.',
      sections: [
        {
          heading: 'Acceptance and Beta status',
          paragraphs: [
            'Using or registering for the service means accepting these Terms and the Privacy Policy. This is a free public Beta; features, data formats, and availability may change for maintenance, safety, or rules corrections.',
            'Players below the age required to consent independently to online services where they live must obtain guardian consent.',
          ],
        },
        {
          heading: 'Account responsibility',
          bullets: [
            'Provide a usable email and appropriate nickname, and protect login credentials.',
            'Do not impersonate others, trade accounts, evade blocks, or automate mass registration.',
            'Report unauthorized account use promptly.',
          ],
        },
        {
          heading: 'Fair play',
          paragraphs: [
            'Server records are the primary authority for decks, actions, matchmaking, and results. The following may result in rating reversal, suspension, or termination:',
          ],
          bullets: [
            'Exploiting defects to manipulate matches or ratings.',
            'Viewing hidden information, modifying clients, scripted play, or disrupting the service.',
            'Collusion, rating manipulation, or deliberate matchmaking abuse.',
          ],
        },
        {
          heading: 'Chat and community conduct',
          bullets: [
            'No harassment, threats, discrimination, impersonation, illegal content, or disclosure of another person’s private information.',
            'Chat and report evidence may be retained, hidden, or reviewed for safety and moderation.',
            'Players may block, report, and appeal. Sanction reasons and durations are recorded.',
          ],
        },
        {
          heading: 'Intellectual property and non-commercial limits',
          paragraphs: [
            'The service does not grant players a right to resell, bulk-download, or redistribute official card assets. Players remain responsible for content they submit and must have the right to use it in the service.',
          ],
        },
        {
          heading: 'Suspension, termination, and disclaimer',
          paragraphs: [
            'The operator may suspend some or all service for security, maintenance, law, or a rightsholder request. Unless applicable law requires otherwise, uninterrupted availability, zero data loss, and identity with official tournament rulings are not guaranteed.',
            'Players may stop using, export data, or delete accounts. Access may be limited or terminated for violations or threats to players or the service.',
          ],
        },
        {
          heading: 'Changes and contact',
          paragraphs: [
            `Material changes update the date on this page. Contact ${LEGAL_CONTACT_EMAIL} for terms, appeals, or support.`,
          ],
        },
      ],
    },
    contact: {
      title: 'Contact & Takedown Requests',
      summary: 'A single contact for support, privacy, accounts, moderation, security, and rightsholder notices.',
      sections: [
        {
          heading: 'Contact',
          bullets: [`Operator: ${LEGAL_OPERATOR}`, `Email: ${LEGAL_CONTACT_EMAIL}`],
          paragraphs: [
            'Do not post passwords, tokens, identity documents, or sensitive personal data in public issues or chat.',
          ],
        },
        {
          heading: 'Suggested subjects',
          bullets: [
            '[PRIVACY] Data export, deletion, or privacy',
            '[RIGHTS] Card, image, name, or other rightsholder notice',
            '[MODERATION] Chat, report, block, sanction, or appeal',
            '[SECURITY] Vulnerability or unauthorized account access',
            '[SUPPORT] Other player support',
          ],
        },
        {
          heading: 'Rightsholder request details',
          bullets: [
            'Contact information identifying the rightsholder or representative.',
            'URL, card number, or description of the affected material.',
            'The basis of the rights and requested action.',
            'A statement that the information is accurate and the sender is authorized.',
          ],
        },
        {
          heading: 'Handling',
          paragraphs: [
            'The operator records and reviews requests and may ask for clarification. Clearly credible rights or security notices may lead to restricted access or temporary removal before the review and response are complete.',
          ],
        },
      ],
    },
  },
};

const zhCN: LegalLocaleContent = {
  ...zhTW,
  pageTitle: '政策与联系',
  updatedLabel: '生效与更新日期',
  authoritativeNotice: '繁体中文版是当前项目的主要政策记录；其他语言版本用于帮助玩家理解。',
  navigationLabel: '政策文件',
  documents: {
    overview: {
      ...zhTW.documents.overview,
      title: '非官方与非营利声明',
      summary: '说明项目的社区定位、素材使用基础、运营者与权利人联系方式。',
    },
    privacy: {
      ...zhTW.documents.privacy,
      title: '隐私政策',
      summary: '说明服务收集哪些数据、使用目的、保存期限，以及玩家如何导出或删除数据。',
    },
    terms: {
      ...zhTW.documents.terms,
      title: '服务条款',
      summary: '使用 Beta 服务前应了解的账号、公平对战、社区行为与服务可用性规则。',
    },
    contact: {
      ...zhTW.documents.contact,
      title: '联系与下架申请',
      summary: '提供客服、隐私、账号、审核、安全与权利人通知的统一入口。',
    },
  },
};

const zhHK: LegalLocaleContent = {
  ...zhTW,
  pageTitle: '政策與聯絡',
  updatedLabel: '生效及更新日期',
  authoritativeNotice: '繁體中文版係目前項目的主要政策記錄；其他語言版本方便玩家理解。',
  navigationLabel: '政策文件',
};

const ja: LegalLocaleContent = {
  ...en,
  pageTitle: 'ポリシー・お問い合わせ',
  updatedLabel: '施行・更新日',
  authoritativeNotice: '本文は現在英語で提供しています。繁体字中国語版が本プロジェクトの主要なポリシー記録です。',
  navigationLabel: 'ポリシー文書',
  documents: {
    overview: {
      ...en.documents.overview,
      title: '非公式・非営利について',
      summary: 'コミュニティとしての位置付け、素材利用の根拠、運営者、権利者からの連絡方法を説明します。',
    },
    privacy: {
      ...en.documents.privacy,
      title: 'プライバシーポリシー',
      summary: '処理するデータ、利用目的、保存期間、エクスポート・削除方法を説明します。',
    },
    terms: {
      ...en.documents.terms,
      title: '利用規約',
      summary: 'アカウント、公平な対戦、コミュニティ行動、公開ベータの提供条件を定めます。',
    },
    contact: {
      ...en.documents.contact,
      title: 'お問い合わせ・削除申請',
      summary: 'サポート、プライバシー、モデレーション、セキュリティ、権利者通知の窓口です。',
    },
  },
};

const ko: LegalLocaleContent = {
  ...en,
  pageTitle: '정책 및 문의',
  updatedLabel: '시행 및 최종 업데이트',
  authoritativeNotice: '본문은 현재 영어로 제공됩니다. 번체 중국어판이 프로젝트의 기준 정책 기록입니다.',
  navigationLabel: '정책 문서',
  documents: {
    overview: {
      ...en.documents.overview,
      title: '비공식·비영리 안내',
      summary: '커뮤니티 성격, 에셋 사용 근거, 운영자 및 권리자 문의 절차를 설명합니다.',
    },
    privacy: {
      ...en.documents.privacy,
      title: '개인정보 처리방침',
      summary: '처리하는 데이터, 이용 목적, 보관 기간과 내보내기·삭제 방법을 설명합니다.',
    },
    terms: {
      ...en.documents.terms,
      title: '서비스 이용약관',
      summary: '계정, 공정한 플레이, 커뮤니티 행동 및 공개 베타의 이용 조건입니다.',
    },
    contact: {
      ...en.documents.contact,
      title: '문의 및 삭제 요청',
      summary: '지원, 개인정보, 운영 조치, 보안 및 권리자 통지를 위한 단일 창구입니다.',
    },
  },
};

export const LEGAL_CONTENT: Record<Locale, LegalLocaleContent> = {
  'zh-TW': zhTW,
  'zh-HK': zhHK,
  'zh-CN': zhCN,
  ja,
  en,
  ko,
};

export function getLegalContent(locale: Locale): LegalLocaleContent {
  return LEGAL_CONTENT[locale];
}
