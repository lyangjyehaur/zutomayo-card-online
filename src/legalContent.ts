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
            '遊戲資料：私人牌組、公開或僅連結的牌組分享快照、複製紀錄、配對、對局結果、ELO、回合與伺服器產生的操作紀錄。',
            '社交與社群資料：好友、封鎖、牌組分享按讚、聊天訊息、舉報、moderation 與制裁紀錄。',
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
            '登入後可在個人頁匯出帳號、私人牌組、牌組分享、按讚、複製與檢舉資料，或刪除帳號。匯出不包含其他玩家的私人資料或管理員內部備註。刪除帳號會移除玩家擁有的分享與按讚，複製和檢舉證據則會移除帳號識別；維持排行榜、反作弊或爭議處理所需的資料可能在去識別後保留。',
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
            'Game data: private decks, public or link-only deck-share snapshots, trusted copy records, matchmaking, results, ELO, turns, and server-generated action records.',
            'Social data: friends, blocks, deck-share likes, chat, reports, moderation, and sanction records.',
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
            'Signed-in players can export account, private deck, deck-share, like, copy, and report data or delete their account from Profile. Exports exclude other players’ private data and internal moderator notes. Account deletion removes owned shares and likes and de-identifies copy or report evidence; records needed for rating, anti-cheat, or disputes may remain after direct identifiers are removed.',
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
  pageTitle: '政策与联系',
  updatedLabel: '生效与更新日期',
  authoritativeNotice: '繁体中文版是当前项目的主要政策记录；其他语言版本用于帮助玩家理解。',
  navigationLabel: '政策文件',
  documents: {
    overview: {
      title: '非官方与非营利声明',
      summary: '说明项目的社区定位、素材使用基础、运营者与权利人联系方式。',
      sections: [
        {
          heading: '项目定位',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE 是由粉丝维护的非官方、非营利在线对战服务，目的是推广玩法，并让不易购买实体卡牌的海外玩家参与对战。',
            '本项目与 ZUTOMAYO、唱片公司、卡牌制作或发行单位没有从属、代理、赞助或授权合作关系。',
          ],
        },
        {
          heading: '素材使用',
          paragraphs: [
            '项目依据 ZUTOMAYO 官方公开的著作物使用指引，以非商业方式运营。卡牌名称、图像、商标及相关素材权利仍归原权利人所有。',
          ],
        },
        {
          heading: '运营者',
          bullets: [`运营名称：${LEGAL_OPERATOR}`, `联系邮箱：${LEGAL_CONTACT_EMAIL}`, '免费、无广告、非商业运营'],
        },
        {
          heading: '权利人通知',
          paragraphs: [
            '权利人可发送身份、涉及内容与希望采取措施的说明；运营者会优先核实，并可在调查期间暂时限制相关内容。',
          ],
        },
      ],
    },
    privacy: {
      title: '隐私政策',
      summary: '说明服务收集哪些数据、使用目的、保存期限，以及玩家如何导出或删除数据。',
      sections: [
        {
          heading: '数据与联系',
          paragraphs: [`服务由 ${LEGAL_OPERATOR} 维护。隐私、导出、删除或安全问题请联系 ${LEGAL_CONTACT_EMAIL}。`],
        },
        {
          heading: '处理的数据',
          bullets: [
            '账号数据：邮箱、昵称、验证状态与所选登录服务识别信息。',
            '游戏数据：牌组、配对、结果、评分、回合与服务器操作记录。',
            '社区数据：好友、封锁、聊天、举报、审核与制裁记录。',
            '技术数据：IP、user agent、错误、性能、安全与审计日志。',
          ],
        },
        {
          heading: '用途与保存',
          bullets: [
            '用于提供账号、牌组、对战、聊天、支持以及防滥用。',
            '账号删除后通常在 30 天内删除或匿名化；对局与管理记录按安全和完整性需要有限期保存。',
            '服务不出售个人数据，也不会用私人聊天建立广告画像。',
          ],
        },
        {
          heading: '玩家权利与安全',
          paragraphs: [
            '登录玩家可在个人页面导出数据或删除账号。服务使用 TLS、权限分离与加密备份，但任何在线服务都无法保证绝对安全。',
          ],
        },
      ],
    },
    terms: {
      title: '服务条款',
      summary: '使用 Beta 服务前应了解的账号、公平对战、社区行为与服务可用性规则。',
      sections: [
        {
          heading: '接受条款与 Beta 性质',
          paragraphs: [
            '使用或注册即表示同意本条款与隐私政策。服务免费且处于公开测试阶段，功能和可用性可能因维护、安全或规则修正而改变。',
          ],
        },
        {
          heading: '账号与公平对战',
          bullets: [
            '保护登录凭证，不得冒用、买卖账号或规避封锁。',
            '不得利用漏洞、修改客户端、查看隐藏信息、脚本化操作、串通或刷分。',
          ],
        },
        {
          heading: '聊天与知识产权',
          bullets: ['不得骚扰、威胁、歧视、公开他人隐私或发布违法内容。', '不得批量下载、转售或重新散布官方卡牌素材。'],
        },
        {
          heading: '暂停、终止与联系',
          paragraphs: [
            `运营者可因安全、维护、法律或权利人要求限制服务。条款、申诉或支持问题请联系 ${LEGAL_CONTACT_EMAIL}。`,
          ],
        },
      ],
    },
    contact: {
      title: '联系与下架申请',
      summary: '提供客服、隐私、账号、审核、安全与权利人通知的统一入口。',
      sections: [
        {
          heading: '联系方式',
          bullets: [`运营者：${LEGAL_OPERATOR}`, `邮箱：${LEGAL_CONTACT_EMAIL}`],
        },
        {
          heading: '建议邮件主题',
          bullets: [
            '[PRIVACY] 隐私、导出或删除',
            '[RIGHTS] 权利人或素材通知',
            '[MODERATION] 审核或申诉',
            '[SECURITY] 安全问题',
            '[SUPPORT] 玩家支持',
          ],
        },
        {
          heading: '权利人申请内容',
          bullets: ['权利人或代理人的联系方式。', '涉及内容的网址、卡号或画面说明。', '权利依据与希望采取的措施。'],
        },
        {
          heading: '处理方式',
          paragraphs: [
            '运营者会记录并核实请求，必要时要求补充资料。可信的权利或安全通知可能在调查完成前先限制相关内容。',
          ],
        },
      ],
    },
  },
};

const zhHK: LegalLocaleContent = {
  pageTitle: '政策與聯絡',
  updatedLabel: '生效及更新日期',
  authoritativeNotice: '繁體中文版係目前項目的主要政策記錄；其他語言版本方便玩家理解。',
  navigationLabel: '政策文件',
  documents: {
    overview: {
      title: '非官方及非牟利聲明',
      summary: '說明項目嘅社群定位、素材使用基礎、營運者同權利人聯絡方法。',
      sections: [
        {
          heading: '項目定位',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE 係由粉絲維護嘅非官方、非牟利網上對戰服務，目的係推廣玩法，亦俾唔容易買到實體卡牌嘅海外玩家參與。',
            '本項目同 ZUTOMAYO、唱片公司、卡牌製作或發行單位並無從屬、代理、贊助或授權合作關係。',
          ],
        },
        {
          heading: '素材使用',
          paragraphs: [
            '項目依照 ZUTOMAYO 官方公開嘅著作物使用指引，以非商業方式營運；卡牌名稱、圖像、商標及相關素材權利仍屬原權利人。',
          ],
        },
        {
          heading: '營運者',
          bullets: [`營運名稱：${LEGAL_OPERATOR}`, `聯絡電郵：${LEGAL_CONTACT_EMAIL}`, '免費、無廣告、非商業營運'],
        },
        {
          heading: '權利人通知',
          paragraphs: [
            '權利人可以提供身份、涉及內容同希望採取嘅措施；營運者會優先核實，調查期間亦可能暫時限制相關內容。',
          ],
        },
      ],
    },
    privacy: {
      title: '私隱政策',
      summary: '說明服務處理咩資料、用途、保存期，同玩家點樣匯出或刪除資料。',
      sections: [
        {
          heading: '資料及聯絡',
          paragraphs: [`服務由 ${LEGAL_OPERATOR} 維護。私隱、匯出、刪除或安全問題請聯絡 ${LEGAL_CONTACT_EMAIL}。`],
        },
        {
          heading: '處理嘅資料',
          bullets: [
            '帳號資料：電郵、暱稱、驗證狀態及登入供應商識別資料。',
            '遊戲資料：牌組、配對、結果、評分、回合及伺服器操作記錄。',
            '社群資料：好友、封鎖、聊天、舉報、審核及制裁記錄。',
            '技術資料：IP、user agent、錯誤、效能、安全及稽核日誌。',
          ],
        },
        {
          heading: '用途及保存',
          bullets: [
            '用嚟提供帳號、牌組、對戰、聊天、支援同防止濫用。',
            '刪除帳號後通常會喺 30 日內刪除或匿名化；部分對局及管理記錄會按安全需要有限期保存。',
            '服務唔會出售個人資料，亦唔會用私人聊天建立廣告檔案。',
          ],
        },
        {
          heading: '玩家權利及安全',
          paragraphs: [
            '登入玩家可以喺個人頁匯出資料或刪除帳號。服務使用 TLS、權限分離同加密備份，但任何網上服務都無法保證絕對安全。',
          ],
        },
      ],
    },
    terms: {
      title: '服務條款',
      summary: '使用 Beta 服務前需要了解嘅帳號、公平對戰、社群行為同服務可用性規則。',
      sections: [
        {
          heading: '接受條款及 Beta 性質',
          paragraphs: [
            '使用或註冊即代表同意本條款同私隱政策。服務免費並處於公開測試階段，功能同可用性可能因維護、安全或規則修正而改變。',
          ],
        },
        {
          heading: '帳號及公平對戰',
          bullets: [
            '保護登入憑證，唔可以冒用、買賣帳號或避開封鎖。',
            '唔可以利用漏洞、修改客戶端、查看隱藏資料、用腳本操作、串通或洗分。',
          ],
        },
        {
          heading: '聊天及知識產權',
          bullets: [
            '唔可以騷擾、威脅、歧視、公開他人私隱或發布違法內容。',
            '唔可以批量下載、轉售或重新散布官方卡牌素材。',
          ],
        },
        {
          heading: '暫停、終止及聯絡',
          paragraphs: [
            `營運者可以因安全、維護、法律或權利人要求限制服務。條款、申訴或支援問題請聯絡 ${LEGAL_CONTACT_EMAIL}。`,
          ],
        },
      ],
    },
    contact: {
      title: '聯絡及下架申請',
      summary: '提供支援、私隱、帳號、審核、安全同權利人通知嘅統一入口。',
      sections: [
        {
          heading: '聯絡方法',
          bullets: [`營運者：${LEGAL_OPERATOR}`, `電郵：${LEGAL_CONTACT_EMAIL}`],
        },
        {
          heading: '建議電郵主旨',
          bullets: [
            '[PRIVACY] 私隱、匯出或刪除',
            '[RIGHTS] 權利人或素材通知',
            '[MODERATION] 審核或申訴',
            '[SECURITY] 安全問題',
            '[SUPPORT] 玩家支援',
          ],
        },
        {
          heading: '權利人申請內容',
          bullets: ['權利人或代理人聯絡資料。', '涉及內容嘅網址、卡號或畫面說明。', '權利基礎同希望採取嘅措施。'],
        },
        {
          heading: '處理方式',
          paragraphs: [
            '營運者會記錄同核實申請，必要時要求補充資料。可信嘅權利或安全通知可能喺調查完成前先限制相關內容。',
          ],
        },
      ],
    },
  },
};

const ja: LegalLocaleContent = {
  pageTitle: 'ポリシー・お問い合わせ',
  updatedLabel: '施行・更新日',
  authoritativeNotice: '繁体字中国語版が本プロジェクトの主要なポリシー記録です。本翻訳は理解を助けるために提供します。',
  navigationLabel: 'ポリシー文書',
  documents: {
    overview: {
      title: '非公式・非営利について',
      summary: 'コミュニティとしての位置付け、素材利用の根拠、運営者、権利者からの連絡方法を説明します。',
      sections: [
        {
          heading: 'プロジェクトの位置付け',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE は、ゲームの普及と、実物カードを入手しにくい海外ファンの参加を目的とした、ファン運営の非公式・非営利オンライン対戦サービスです。',
            'ZUTOMAYO、レコード会社、カードの制作・販売関係者との所属、代理、協賛、公式ライセンス関係はありません。',
          ],
        },
        {
          heading: '素材の利用',
          paragraphs: [
            'ZUTOMAYO が公開する著作物利用ガイドラインに基づき、非商用で運営します。カード名、画像、商標その他の権利は各権利者に帰属します。',
          ],
        },
        {
          heading: '運営者',
          bullets: [`運営名：${LEGAL_OPERATOR}`, `連絡先：${LEGAL_CONTACT_EMAIL}`, '無料・広告なし・非商用'],
        },
        {
          heading: '権利者からの通知',
          paragraphs: [
            '権利者は、本人確認情報、対象内容、希望する対応をメールで通知できます。信頼できる通知は優先して確認し、調査中に対象を一時的に制限する場合があります。',
          ],
        },
      ],
    },
    privacy: {
      title: 'プライバシーポリシー',
      summary: '処理するデータ、利用目的、保存期間、エクスポート・削除方法を説明します。',
      sections: [
        {
          heading: '管理者と連絡先',
          paragraphs: [
            `本サービスは ${LEGAL_OPERATOR} が運営します。プライバシー、データ出力、削除、セキュリティの依頼は ${LEGAL_CONTACT_EMAIL} へご連絡ください。`,
          ],
        },
        {
          heading: '処理するデータ',
          bullets: [
            'アカウント：メール、ニックネーム、認証状態、選択したログインプロバイダーの識別子。',
            'ゲーム：デッキ、マッチング、結果、レーティング、ターン、サーバー操作記録。',
            'コミュニティ：フレンド、ブロック、チャット、通報、モデレーション、制裁記録。',
            '技術：IP、user agent、エラー、性能、セキュリティ、監査ログ。',
          ],
        },
        {
          heading: '利用目的と保存',
          bullets: [
            'アカウント、デッキ、対戦、チャット、サポート、不正防止の提供。',
            '削除確認後、アカウントは通常30日以内に削除または匿名化します。対戦・監査記録は安全性と整合性のため一定期間保存する場合があります。',
            '個人データを販売せず、非公開チャットを広告プロファイルに利用しません。',
          ],
        },
        {
          heading: '利用者の権利と安全',
          paragraphs: [
            'ログイン後、プロフィールからデータ出力またはアカウント削除ができます。TLS、権限分離、暗号化バックアップを利用しますが、オンラインサービスの絶対的な安全は保証できません。',
          ],
        },
      ],
    },
    terms: {
      title: '利用規約',
      summary: 'アカウント、公平な対戦、コミュニティ行動、公開ベータの提供条件を定めます。',
      sections: [
        {
          heading: '同意とベータ版',
          paragraphs: [
            '利用または登録により、本規約とプライバシーポリシーに同意したものとみなします。本サービスは無料の公開ベータであり、保守、安全、ルール修正のため変更される場合があります。',
          ],
        },
        {
          heading: 'アカウントと公平な対戦',
          bullets: [
            '認証情報を保護し、なりすまし、売買、制限回避をしないでください。',
            '不具合の悪用、クライアント改変、非公開情報の閲覧、自動操作、談合、レーティング操作は禁止です。',
          ],
        },
        {
          heading: 'チャットと知的財産',
          bullets: [
            '嫌がらせ、脅迫、差別、他人の個人情報公開、違法内容は禁止です。',
            '公式カード素材の一括取得、販売、再配布はできません。',
          ],
        },
        {
          heading: '停止・終了・連絡',
          paragraphs: [
            `安全、保守、法令、権利者要請によりサービスを制限する場合があります。規約、異議申立て、サポートは ${LEGAL_CONTACT_EMAIL} へご連絡ください。`,
          ],
        },
      ],
    },
    contact: {
      title: 'お問い合わせ・削除申請',
      summary: 'サポート、プライバシー、モデレーション、セキュリティ、権利者通知の窓口です。',
      sections: [
        {
          heading: '連絡先',
          bullets: [`運営者：${LEGAL_OPERATOR}`, `メール：${LEGAL_CONTACT_EMAIL}`],
        },
        {
          heading: '推奨件名',
          bullets: [
            '[PRIVACY] データ出力・削除・プライバシー',
            '[RIGHTS] 権利者・素材に関する通知',
            '[MODERATION] モデレーション・異議申立て',
            '[SECURITY] セキュリティ',
            '[SUPPORT] その他のサポート',
          ],
        },
        {
          heading: '権利者申請に必要な情報',
          bullets: [
            '権利者または代理人を確認できる連絡先。',
            '対象URL、カード番号、画面の説明。',
            '権利の根拠と希望する対応。',
          ],
        },
        {
          heading: '対応方法',
          paragraphs: [
            '申請を記録・確認し、必要に応じて追加情報を求めます。明確な権利・安全通知については、調査完了前に対象へのアクセスを制限する場合があります。',
          ],
        },
      ],
    },
  },
};

const ko: LegalLocaleContent = {
  pageTitle: '정책 및 문의',
  updatedLabel: '시행 및 최종 업데이트',
  authoritativeNotice: '번체 중국어판이 프로젝트의 기준 정책 기록이며, 이 번역은 이해를 돕기 위해 제공됩니다.',
  navigationLabel: '정책 문서',
  documents: {
    overview: {
      title: '비공식·비영리 안내',
      summary: '커뮤니티 성격, 에셋 사용 근거, 운영자 및 권리자 문의 절차를 설명합니다.',
      sections: [
        {
          heading: '프로젝트 성격',
          paragraphs: [
            'ZUTOMAYO CARD ONLINE은 게임을 알리고 실물 카드를 구하기 어려운 해외 팬도 참여할 수 있도록 팬이 운영하는 비공식·비영리 온라인 대전 서비스입니다.',
            'ZUTOMAYO, 음반사, 카드 제작·유통 관계자와 소속, 대리, 후원 또는 공식 라이선스 관계가 없습니다.',
          ],
        },
        {
          heading: '에셋 사용',
          paragraphs: [
            'ZUTOMAYO가 공개한 저작물 이용 가이드라인에 따라 비상업적으로 운영합니다. 카드명, 이미지, 상표 및 관련 에셋의 권리는 각 권리자에게 있습니다.',
          ],
        },
        {
          heading: '운영자',
          bullets: [`운영명: ${LEGAL_OPERATOR}`, `문의: ${LEGAL_CONTACT_EMAIL}`, '무료·광고 없음·비상업적 운영'],
        },
        {
          heading: '권리자 통지',
          paragraphs: [
            '권리자는 신원, 대상 콘텐츠와 요청 조치를 이메일로 보낼 수 있습니다. 신뢰할 수 있는 통지는 우선 검토하며 조사 중 콘텐츠를 일시 제한할 수 있습니다.',
          ],
        },
      ],
    },
    privacy: {
      title: '개인정보 처리방침',
      summary: '처리하는 데이터, 이용 목적, 보관 기간과 내보내기·삭제 방법을 설명합니다.',
      sections: [
        {
          heading: '관리자 및 문의',
          paragraphs: [
            `서비스는 ${LEGAL_OPERATOR}이 운영합니다. 개인정보, 내보내기, 삭제 또는 보안 요청은 ${LEGAL_CONTACT_EMAIL}로 문의하세요.`,
          ],
        },
        {
          heading: '처리하는 데이터',
          bullets: [
            '계정: 이메일, 닉네임, 인증 상태 및 선택한 로그인 제공자의 식별자.',
            '게임: 덱, 매칭, 결과, 레이팅, 턴 및 서버 작업 기록.',
            '커뮤니티: 친구, 차단, 채팅, 신고, 운영 조치 및 제재 기록.',
            '기술: IP, user agent, 오류, 성능, 보안 및 감사 로그.',
          ],
        },
        {
          heading: '목적 및 보관',
          bullets: [
            '계정, 덱, 대전, 채팅, 지원과 악용 방지를 제공합니다.',
            '확인된 삭제 요청 후 계정은 일반적으로 30일 이내 삭제 또는 익명화하며, 대전·감사 기록은 안전과 무결성을 위해 일정 기간 보관할 수 있습니다.',
            '개인정보를 판매하거나 비공개 채팅을 광고 프로필에 사용하지 않습니다.',
          ],
        },
        {
          heading: '이용자 권리 및 보안',
          paragraphs: [
            '로그인 후 프로필에서 데이터를 내보내거나 계정을 삭제할 수 있습니다. TLS, 권한 분리, 암호화 백업을 사용하지만 온라인 서비스의 절대적 안전을 보장할 수는 없습니다.',
          ],
        },
      ],
    },
    terms: {
      title: '서비스 이용약관',
      summary: '계정, 공정한 플레이, 커뮤니티 행동 및 공개 베타의 이용 조건입니다.',
      sections: [
        {
          heading: '동의 및 베타 상태',
          paragraphs: [
            '서비스를 이용하거나 가입하면 본 약관과 개인정보 처리방침에 동의한 것으로 봅니다. 서비스는 무료 공개 베타이며 유지보수, 안전 또는 규칙 수정으로 변경될 수 있습니다.',
          ],
        },
        {
          heading: '계정 및 공정한 플레이',
          bullets: [
            '로그인 정보를 보호하고 사칭, 계정 거래 또는 차단 우회를 하지 마세요.',
            '버그 악용, 클라이언트 변조, 숨겨진 정보 열람, 자동화, 담합 또는 레이팅 조작을 금지합니다.',
          ],
        },
        {
          heading: '채팅 및 지식재산',
          bullets: [
            '괴롭힘, 협박, 차별, 타인의 개인정보 공개 또는 불법 콘텐츠를 금지합니다.',
            '공식 카드 에셋을 일괄 다운로드, 판매 또는 재배포할 수 없습니다.',
          ],
        },
        {
          heading: '중단·종료·문의',
          paragraphs: [
            `안전, 유지보수, 법률 또는 권리자 요청으로 서비스를 제한할 수 있습니다. 약관, 이의 제기 또는 지원은 ${LEGAL_CONTACT_EMAIL}로 문의하세요.`,
          ],
        },
      ],
    },
    contact: {
      title: '문의 및 삭제 요청',
      summary: '지원, 개인정보, 운영 조치, 보안 및 권리자 통지를 위한 단일 창구입니다.',
      sections: [
        {
          heading: '연락처',
          bullets: [`운영자: ${LEGAL_OPERATOR}`, `이메일: ${LEGAL_CONTACT_EMAIL}`],
        },
        {
          heading: '권장 제목',
          bullets: [
            '[PRIVACY] 내보내기·삭제·개인정보',
            '[RIGHTS] 권리자 또는 에셋 통지',
            '[MODERATION] 운영 조치 또는 이의 제기',
            '[SECURITY] 보안 문제',
            '[SUPPORT] 기타 지원',
          ],
        },
        {
          heading: '권리자 요청 정보',
          bullets: [
            '권리자 또는 대리인을 확인할 수 있는 연락처.',
            '대상 URL, 카드 번호 또는 화면 설명.',
            '권리 근거와 요청 조치.',
          ],
        },
        {
          heading: '처리 방식',
          paragraphs: [
            '요청을 기록하고 검토하며 필요한 경우 추가 정보를 요청합니다. 명확한 권리 또는 보안 통지는 조사 완료 전에 대상 접근을 제한할 수 있습니다.',
          ],
        },
      ],
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
