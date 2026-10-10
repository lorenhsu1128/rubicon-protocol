// 主線的劇情資料（簡報＋通訊的輕量敘事，docs/campaign-design.md 第 9 節）
// 委託方、說話者、戰區總覽圖的區域、出擊的簡報、通訊（依事件與條件觸發）。台詞可以直接在這裡補。

import { escHtml } from '../core/html.js';

// 委託方（4 家；戰術模組的風格在第 4 期使用）
export const FACTIONS = {
  castron: { name: '卡斯特隆重工', short: 'CASTRON', color: '#d8903a', style: '實彈與衝擊' },
  aetheric: { name: '艾瑟立克研究機構', short: 'AETHERIC', color: '#5ab8ff', style: '能量武器' },
  veerwell: { name: '維爾威動態', short: 'VEERWELL', color: '#9be070', style: '機動' },
  sancta: { name: '聖域互助同盟', short: 'SANCTA', color: '#e0d070', style: '防禦與修理' },
};

// 說話者：name、頭像的顏色與縮寫（程式產生的徽章）、所屬
export const SPEAKERS = {
  echo: { name: '操作員 ECHO', color: '#7fc8ff', mark: 'E', note: '你的作戰管制官' },
  castron: { name: '卡斯特隆 聯絡官', color: '#d8903a', mark: 'C', faction: 'castron' },
  aetheric: { name: '艾瑟立克 研究員', color: '#5ab8ff', mark: 'A', faction: 'aetheric' },
  veerwell: { name: '維爾威 調度員', color: '#9be070', mark: 'V', faction: 'veerwell' },
  sancta: { name: '聖域 協調人', color: '#e0d070', mark: 'S', faction: 'sancta' },
  enemy: { name: '敵方通訊', color: '#ff6b6b', mark: '!' },
  rust: { name: 'RUST', color: '#c07040', mark: 'R', note: '拾荒傭兵（第 1 章的宿敵）' },
  sirocco: { name: 'SIROCCO', color: '#e8d4b0', mark: 'S', note: '沙暴裡的快刀（第 1 章的宿敵）' },
  zenith: { name: 'ZENITH', color: '#ffd060', mark: 'Z', note: '軌道的空戰專家（第 6 章的宿敵）' },
  undertow: { name: 'UNDERTOW', color: '#40c0e0', mark: 'U', note: '洋上都市的擊退專家（第 5 章的宿敵）' },
  spire: { name: 'SPIRE', color: '#e0b040', mark: 'P', note: '構造體的跳躍者（第 4 章的宿敵）' },
  countdown: { name: 'COUNTDOWN', color: '#ff6a20', mark: 'C', note: '宇宙港的飛彈手（第 4 章的宿敵）' },
  specimen: { name: 'SPECIMEN', color: '#ff5a50', mark: 'X', note: '技研都市的強化人間（第 3 章的宿敵）' },
  whiteout: { name: 'WHITEOUT', color: '#9fd8ff', mark: 'W', note: '暴風雪裡的狙擊手（第 3 章的宿敵）' },
  marsh: { name: 'MARSH', color: '#40d0a0', mark: 'M', note: '水沒市街的兩棲傭兵（第 2 章的宿敵）' },
  sluice: { name: 'SLUICE', color: '#60c8ff', mark: 'L', note: '水壩的守備隊長（第 2 章的宿敵）' },
  stevedore: { name: 'STEVEDORE', color: '#e0b020', mark: 'D', note: '集散場的砲擊手（第 2 章的宿敵）' },
  prospector: { name: 'PROSPECTOR', color: '#c8aa50', mark: 'P', note: '礦坑的重裝傭兵（第 1 章的宿敵）' },
};

// 戰區總覽圖的區域：x, y 是 0～100 的相對座標；章節依序開放
export const REGIONS = [
  { key: 'south', name: '南部荒野', chapter: 1, x: 48, y: 76, themes: ['wasteland', 'dunes', 'desert'] },
  { key: 'central', name: '中部工業帶', chapter: 2, x: 50, y: 50, themes: ['industrial', 'dam', 'flooded'] },
  { key: 'west', name: '西部冰原', chapter: 3, x: 18, y: 42, themes: ['snow', 'institute'] },
  { key: 'north', name: '北部構造體', chapter: 4, x: 52, y: 18, themes: ['grid086', 'spaceport'] },
  { key: 'east', name: '東岸洋上都市', chapter: 5, x: 84, y: 46, themes: ['xylem'] },
  { key: 'sky', name: '高空軌道', chapter: 6, x: 80, y: 10, themes: ['orbit'] },
];
export const CHAPTER_NAMES = {
  1: '第 1 章　荒野的訊號',
  2: '第 2 章　工業帶的契約',
  3: '第 3 章　冰原之下',
  4: '第 4 章　構造體',
  5: '第 5 章　洋上的抉擇',
  6: '第 6 章　軌道',
};

// 出擊的簡報（data/campaign.js 的 SORTIES 以同樣的 key 對應）：client＝委託方、node＝總覽圖上的位置、
// needs＝先完成哪些出擊才開放、needsAny＝其中一個完成就開放、when＝陣營抉擇的條件（{ 抉擇 id: 選項 }，不符合時總覽圖上不出現）
export const BRIEFINGS = {
  c1s1: {
    client: 'castron',
    node: { x: 40, y: 80 },
    needs: [],
    lines: [
      '傭兵，這裡是卡斯特隆重工。南部荒野的礦坑裡有一座舊時代的砲兵陣地重新啟動了。',
      '它切斷了我們通往礦場的補給線。你的工作是從荒野一路推進，進入礦坑，摧毀那座陣地。',
      '途中會有拾荒者與自律兵器。報酬按區段計算，打得越深拿得越多。',
    ],
    goal: '推進荒野與礦坑，擊破砲兵陣地 BASTILLE',
  },
  c1s2: {
    client: 'veerwell',
    node: { x: 58, y: 70 },
    needs: ['c1s1'],
    lines: [
      '維爾威動態調度中心。砲兵陣地倒下之後，礦坑深處出現了巨大的震動源。',
      '我們的探勘隊在坑道裡失聯了。請深入坑道，找出震動的來源。',
      '情報顯示有一台拾荒傭兵的 AC 也在打礦坑的主意，小心。',
    ],
    goal: '深入坑道，查明並排除震動源',
  },
  // ---- 第 2 章 ----
  c2s1: {
    client: 'aetheric',
    node: { x: 42, y: 56 },
    needs: ['c1s2'],
    lines: [
      '這裡是艾瑟立克研究機構。中部工業帶的貨運集散場被武裝勢力封鎖了。',
      '我們的研究設備卡在封鎖線後面，而水壩那一側還有一座超長程電磁砲台在守著河谷。',
      '突破集散場，沿河谷前進，把那座砲台拆掉。卡斯特隆也在找傭兵，動作要快。',
    ],
    goal: '突破集散場的封鎖，擊破水壩的電磁砲台 HALBERD',
  },
  c2s2: {
    client: 'castron',
    node: { x: 56, y: 44 },
    needs: ['c2s1'],
    lines: [
      '卡斯特隆重工。你在南部荒野的表現我們記得。',
      '多重水壩的主壩控制著整個工業帶的電力。艾瑟立克想拿它去餵他們的實驗設施。',
      '照合約，替我們拿下主壩。……我們知道艾瑟立克也雇過你，希望你分得清楚誰付的錢比較多。',
    ],
    goal: '沿水壩推進，奪取主壩（途中會面臨抉擇）',
  },
  c2s3a: {
    client: 'castron',
    node: { x: 62, y: 56 },
    needs: ['c2s2'],
    when: { c2: 'castron' },
    lines: [
      '主壩到手了，做得好。艾瑟立克撤進了水沒市街的舊研究所。',
      '把他們清乾淨。研究所的出口在集散場那一側，他們的推土要塞會試著衝出包圍。',
      '這一仗打完，中部工業帶就是卡斯特隆的了。',
    ],
    goal: '掃蕩水沒市街的艾瑟立克據點，擊破推土要塞 BEHEMOTH',
  },
  c2s3b: {
    client: 'aetheric',
    node: { x: 38, y: 44 },
    needs: ['c2s2'],
    when: { c2: 'aetheric' },
    lines: [
      '……謝謝你的選擇，傭兵。主壩的電力已經接進我們的設施。',
      '卡斯特隆不會善罷甘休。他們的武裝列車正從集散場運送部隊過來。',
      '穿過水沒市街，切斷補給線，讓那輛列車停下來。',
    ],
    goal: '切斷卡斯特隆的補給線，擊破武裝列車 IRON CITADEL',
  },
  // ---- 第 3 章 ----
  c3s1: {
    client: 'sancta',
    node: { x: 13, y: 48 },
    needs: [],
    needsAny: ['c2s3a', 'c2s3b'],
    lines: [
      '聖域互助同盟。西部冰原的難民營失去了聯絡。',
      '我們的偵察隊發現冰原基地有大型兵器在巡邏，還有……暴風雪裡的狙擊手。',
      '請替我們確認冰原基地的狀況，排除那台巡邏兵器。',
    ],
    goal: '偵察冰原基地，擊破巡邏用超大型四足 STRIDER',
  },
  c3s2: {
    client: 'veerwell',
    node: { x: 24, y: 38 },
    needs: ['c3s1'],
    lines: [
      '維爾威動態。冰原底下有一座沒有登記的研究所，入口就在冰原基地後方。',
      '我們的探測器在那裡失聯，回傳的最後畫面是一台會消失的機體。',
      '找到研究所的入口，打通往下的路。',
    ],
    goal: '找到研究所的地表入口，擊破光學迷彩電戰機 MIRAGE',
  },
  c3s3: {
    client: 'veerwell',
    node: { x: 14, y: 33 },
    needs: ['c3s2'],
    lines: [
      '研究所的深處有 Coral 的讀數，濃度高得不正常。',
      '那裡守著一台脈衝刃翼，還有研究所自己的強化人間。',
      '……另外，你在中部得罪的那一方雇了傭兵追過來了。小心背後。',
    ],
    goal: '深入研究核心，擊破脈衝刃翼 PULSAR',
  },
  // ---- 第 4 章 ----
  c4s1: {
    client: 'veerwell',
    node: { x: 45, y: 22 },
    needs: ['c3s3'],
    lines: [
      '維爾威動態。北部的巨型構造體 Grid 086 底層傳出了和研究所一樣的 Coral 讀數。',
      '構造體裡住著拾荒的 Doser，他們把平台改造成了要塞。',
      '一路往下，找到讀數的來源。底層有一台多足要塞在巡邏。',
    ],
    goal: '深入 Grid 086 的底層，擊破多足要塞 ARACHNE',
  },
  c4s2: {
    client: 'sancta',
    node: { x: 58, y: 15 },
    needs: ['c4s1'],
    lines: [
      '聖域互助同盟。舊宇宙港的發射設施被三機合體的自律兵器佔據了。',
      '附近有難民聚落，發射設施要是重新啟動，整片區域都會被捲進去。',
      '維爾威想要那座設施。……拿下它之後，要交給誰，由你決定。',
    ],
    goal: '奪回舊宇宙港的發射設施，擊破三機合體 CERBERUS（途中會面臨抉擇）',
  },
  c4s3a: {
    client: 'veerwell',
    node: { x: 64, y: 23 },
    needs: ['c4s2'],
    when: { c4: 'veerwell' },
    lines: [
      '發射設施交給我們了，謝謝。重啟需要構造體底層的發電機。',
      '電磁狩獵機在那裡守著。另外，冰原那個狙擊手也被雇來了。',
      '護送我們的工程隊到底層，排除狩獵機。',
    ],
    goal: '護送工程隊到構造體底層，擊破電磁狩獵機 NULLIFIER',
  },
  c4s3b: {
    client: 'sancta',
    node: { x: 41, y: 12 },
    needs: ['c4s2'],
    when: { c4: 'sancta' },
    lines: [
      '你選了我們。聖域會記得的。',
      '維爾威啟動了舊時代的衛星砲導引塔，想逼我們交出設施。',
      '掩護難民撤離宇宙港外圍，把導引塔打下來。研究所的強化人間也在他們那邊。',
    ],
    goal: '掩護難民撤離，擊破衛星砲導引塔 JUDGEMENT',
  },
  // ---- 第 5 章 ----
  c5s1: {
    client: 'castron',
    node: { x: 80, y: 52 },
    needs: [],
    needsAny: ['c4s3a', 'c4s3b'],
    lines: [
      '卡斯特隆重工。好久不見了，傭兵。',
      '東岸的洋上都市 Xylem 裡有一條通往軌道的電纜，所有人都在搶。',
      '我們要先在都市上陸。護盾指揮艦在港區守著，打下它。',
    ],
    goal: '在洋上都市上陸，擊破護盾指揮艦 AEGIS',
  },
  c5s2a: {
    client: 'veerwell',
    node: { x: 88, y: 42 },
    needs: ['c5s1'],
    when: { c4: 'veerwell' },
    lines: [
      '維爾威動態。發射設施已經重啟，我們需要洋上都市的軌道電纜來校準軌道。',
      '空中要塞在電纜上方盤旋。另外，構造體那個跳躍者被聖域雇了。',
      '確保電纜，打下空中要塞。',
    ],
    goal: '確保軌道電纜，擊破空中要塞 LEVIATHAN',
  },
  c5s2b: {
    client: 'sancta',
    node: { x: 88, y: 56 },
    needs: ['c5s1'],
    when: { c4: 'sancta' },
    lines: [
      '聖域互助同盟。洋上都市還有一批居民，我們安排了避難船。',
      '維爾威派了高速突擊機獵殺避難船，宇宙港那個飛彈手也在。',
      '護衛避難船離開都市，擊落突擊機。',
    ],
    goal: '護衛避難船，擊落高速突擊機 VIPER',
  },
  c5s3: {
    client: 'castron',
    node: { x: 82, y: 38 },
    needs: [],
    needsAny: ['c5s2a', 'c5s2b'],
    lines: [
      '電纜塔在都市的最深處。所有勢力的傭兵都往那裡去了。',
      '我們收到情報：那兩台獨立傭兵的 AC 小隊也接了委託。',
      '拿下電纜塔。之後……就是軌道了。',
    ],
    goal: '奪取海底電纜塔，擊破 IGUAZU & VOLTA 雙 AC 小隊',
  },
  // ---- 第 6 章 ----
  c6s1: {
    client: 'aetheric',
    node: { x: 72, y: 13 },
    needs: ['c5s3'],
    lines: [
      '艾瑟立克研究機構。所有 Coral 的訊號，最後都指向軌道上的一座舊時代的站。',
      '電纜塔拿下之後，宇宙港可以發射最後一次。請你搭上去。',
      '軌道上的自律兵器還在運作。浮游砲指揮機守著第一層的平台。',
    ],
    goal: '從宇宙港升空，擊破浮游砲指揮機 SERAPHIM',
  },
  c6s2: {
    client: 'veerwell',
    node: { x: 82, y: 7 },
    needs: ['c6s1'],
    lines: [
      '維爾威動態。軌道站外環的防衛系統讀取了你的戰鬥紀錄。',
      '它做出了一台和你一模一樣的機體。',
      '突破外環，打倒那台複製品。',
    ],
    goal: '突破軌道站外環，擊破複製 AC DOPPEL',
  },
  // ---- 第 2 周目以後（cycle：從那個周目起出現；不算進整章完成）----
  c1x: {
    client: 'aetheric',
    node: { x: 50, y: 88 },
    needs: ['c1s1'],
    cycle: 2,
    lines: [
      '艾瑟立克研究所。我們有一支調查隊在沙丘失去聯絡——就在你第一次接到訊號的那天。',
      '他們最後傳回的資料提到「同樣的訊號又出現了一次」。',
      '找到調查隊的紀錄。荒野裡有一台不該存在的移動要塞在遊蕩。',
    ],
    goal: '回收調查隊的紀錄，擊破移動要塞 JUGGERNAUT',
  },
  c2x: {
    client: 'sancta',
    node: { x: 50, y: 62 },
    needs: ['c2s2'],
    cycle: 2,
    lines: [
      '聖域互助同盟。這是我們第一次直接委託你。',
      '工業帶的熔爐清掃機把整片廠區燒成焦土，裡面還有沒逃出來的工人。',
      '上一次……你站在別人那邊。這一次，請聽聽我們的說法。',
    ],
    goal: '救出困在廠區的工人，擊破熔爐清掃機 CINDER',
  },
  c3x: {
    client: 'aetheric',
    node: { x: 6, y: 40 },
    needs: ['c3s2'],
    cycle: 2,
    lines: [
      '艾瑟立克研究所。地下技研都市的實驗紀錄裡有你的名字。',
      '日期是……你第一次出擊之前。我們也不明白。',
      '紀錄的副本在冰原的觀測站。重武裝母艦直升機在守著它。',
    ],
    goal: '奪回實驗紀錄的副本，擊落母艦直升機 HELIOS',
  },
  c4x: {
    client: 'veerwell',
    node: { x: 52, y: 30 },
    needs: ['c4s2'],
    cycle: 2,
    lines: [
      '維爾威動態。宇宙港還有一座被封鎖的發射台，連我們的紀錄都沒有。',
      '超長程電磁砲台一直對著那座發射台——不是防守，是封印。',
      '打掉砲台。我們想知道是誰把它封起來的。',
    ],
    goal: '解除發射台的封鎖，擊破電磁砲台 HALBERD',
  },
  c5x: {
    client: 'castron',
    node: { x: 95, y: 48 },
    needs: ['c5s1'],
    cycle: 2,
    lines: [
      '卡斯特隆重工。洋上都市的海底有一座停擺的通訊局。',
      '它每隔一段時間就會廣播一段訊號——和你在荒野收到的一模一樣。',
      '電磁狩獵機在附近巡邏。進去之前，先處理它。',
    ],
    goal: '調查海底通訊局，擊破電磁狩獵機 NULLIFIER',
  },
  c6x: {
    client: 'aetheric',
    node: { x: 64, y: 5 },
    needs: ['c6s1'],
    cycle: 2,
    lines: [
      '艾瑟立克研究所。所有的紀錄都指向同一個座標：軌道站的日照面。',
      '訊號的源頭就在那裡。脈衝刃翼守著它。',
      '……傭兵。你一直在重複這場戰爭，對吧？',
    ],
    goal: '抵達訊號的源頭，擊破脈衝刃翼 PULSAR',
  },
  c6s3: {
    client: 'castron',
    node: { x: 90, y: 14 },
    needs: ['c6s2'],
    lines: [
      '卡斯特隆重工。軌道站的中樞就在前面，所有委託方都在等你的結果。',
      '中樞裡守著舊時代的艦載機動兵器。打倒它，軌道站就是你的了——或者說，是付錢的人的。',
      '……最後要怎麼做，你自己決定吧，傭兵。',
    ],
    goal: '進入軌道站中樞，擊破 BALTEUS（途中會面臨最後的抉擇）',
  },
};

// 結局（第 6 章完成時依最後的抉擇決定；beyond 從第 3 周目起才能選）
export const ENDINGS = {
  open: {
    title: '結局：軌道的主人',
    lines: [
      '軌道站交到了委託方的手上。Coral 的訊號被重新接通，地面的工廠又開始運轉。',
      '你的帳戶多了一筆很大的數字。委託方說，以後還會有工作。',
      'ECHO：「……這樣就好了嗎？算了，傭兵就是這樣。」',
    ],
  },
  seal: {
    title: '結局：沉默的天空',
    lines: [
      '軌道站拖著長長的火光墜進雲海。Coral 的訊號一個接一個地消失。',
      '委託方們沉默了很久，最後還是付了錢——付給一個讓他們什麼都拿不到的傭兵。',
      'ECHO：「天空很安靜。我第一次聽到這麼安靜的天空。」',
    ],
  },
  beyond: {
    title: '真結局：彼岸',
    lines: [
      '你切斷了所有委託方的頻道。軌道站的推進器一個接一個地點亮。',
      'ECHO：「……我一直在等這一天。我的意識原本就在這座站裡。」',
      '星球在背後慢慢變小。沒有人再付錢給你，也沒有人能再命令你。',
      '這是一個傭兵的最後一份工作，也是第一次為自己而戰。',
    ],
  },
};

// 通訊：event＝觸發事件；其餘欄位都是條件（沒寫＝不限）；once＝整個存檔只播一次；
// lines＝[說話者, 台詞] 依序播放
// 事件：sortieStart（出擊開始）、segStart（進入區段）、exitsOpen（區段清除開出口）、trans（轉場）、bossHalf（Boss 剩一半）、
//       fail（失敗回機庫）、sortieEnd（出擊完成）、hub（回到機庫）
// 條件：sid、seg（區段編號）、type（區段類型）、theme、chapter、fails（失敗次數 ≥）、killedBy（擊破你的敵人名稱包含）、cycle（周目）、
//       ace（精英區段的專屬 AC）、pick（這一章的陣營抉擇：出擊中選的或存檔裡的）
// 事件另有 choice（抉擇出口出現時）
export const COMMS = [
  // ---- 第 1 章：第 1 次出擊 ----
  {
    event: 'sortieStart',
    sid: 'c1s1',
    once: true,
    lines: [
      ['echo', '空降完成。我是 ECHO，這次作戰由我管制。'],
      ['echo', '先清掉降落區附近的敵人，之後選一個出口往前推進。'],
    ],
  },
  { event: 'sortieStart', sid: 'c1s1', lines: [['echo', '重新投放。路線我已經記下來了，照你的節奏來。']] },
  {
    event: 'exitsOpen',
    sid: 'c1s1',
    seg: 0,
    once: true,
    lines: [
      ['echo', '區段清除。出口上方的標示是下一段的內容和報酬。'],
      ['echo', '走進光環就會出發。轉場時可以先回車庫整備。'],
    ],
  },
  { event: 'segStart', type: 'destroy', lines: [['castron', '那些發電設施在替陣地供電。全部炸掉。']] },
  { event: 'segStart', type: 'defend', lines: [['castron', '我們的中繼站被盯上了。撐住，直到敵人退去。']] },
  { event: 'segStart', type: 'escort', lines: [['veerwell', '車隊出發。它們很脆，別讓敵人靠近公路。']] },
  { event: 'segStart', type: 'breakthrough', lines: [['echo', '敵人太多了，不必全滅。找一個出口衝過去。']] },
  {
    event: 'segStart',
    type: 'supply',
    lines: [['sancta', '聖域的補給台在這附近。站上去，我們會替你補充。']],
  },
  { event: 'segStart', type: 'intel', lines: [['echo', '附近有一座還在運作的資料終端。站在旁邊讓我下載。']] },
  {
    event: 'segStart',
    type: 'elite',
    once: true,
    lines: [
      ['enemy', '……又一個來搶礦坑的傭兵？'],
      ['echo', '具名 AC。小心，這傢伙不是一般的雜兵。'],
    ],
  },
  { event: 'segStart', type: 'elite', lines: [['echo', '具名 AC 反應。集中火力。']] },
  {
    event: 'segStart',
    sid: 'c1s1',
    theme: 'desert',
    type: 'battle',
    lines: [['echo', '這裡開始是礦坑的範圍，視野會變差。']],
  },
  {
    event: 'trans',
    sid: 'c1s1',
    seg: 3,
    lines: [['echo', '前方是礦場外圍。地面在往下陷，礦坑的入口應該就在那一側。']],
  },
  {
    event: 'segStart',
    type: 'boss',
    sid: 'c1s1',
    lines: [
      ['echo', '砲兵陣地確認。砲台的裝甲很厚，先打掉周圍的設施。'],
      ['castron', '就是它。把它拆了。'],
    ],
  },
  { event: 'bossHalf', sid: 'c1s1', lines: [['echo', '陣地的火力在減弱，再加把勁。']] },
  {
    event: 'sortieEnd',
    sid: 'c1s1',
    lines: [
      ['castron', '陣地沉默了。報酬已經匯入，卡斯特隆記住你了。'],
      ['echo', '回收完成。辛苦了。'],
    ],
  },
  // ---- 第 1 章：第 2 次出擊 ----
  {
    event: 'sortieStart',
    sid: 'c1s2',
    once: true,
    lines: [
      ['veerwell', '坑道的結構圖傳過去了。探勘隊最後的訊號在最深處。'],
      ['echo', '坑道裡的出口多半是升降機和豎井，往下走就對了。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c1s2',
    type: 'boss',
    lines: [
      ['echo', '震動源……是活的。巨型鑽地蟲！'],
      ['veerwell', '它鑽出地面的時候才打得到，抓準時機。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c1s2',
    lines: [
      ['veerwell', '震動停止了。探勘隊的殘骸……我們會去回收。謝謝你，傭兵。'],
      ['echo', '南部荒野的委託全部完成。中部工業帶的委託方已經在找你了。'],
    ],
  },
  // ---- 第 1 章的宿敵（data/foes.js 的專屬 AC） ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'rust',
    once: true,
    lines: [
      ['rust', '喲，新來的？這片荒野的廢鐵都是我的。'],
      ['echo', '具名 AC「RUST」。拾荒傭兵，每次遇到的裝備都不一樣。'],
      ['rust', '你那台機體的零件……看起來挺值錢的。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'rust',
    lines: [
      ['rust', '又是你！上次的帳還沒算完。'],
      ['echo', 'RUST 換了一套裝備，注意它的武器。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'prospector',
    once: true,
    lines: [
      ['prospector', '這條礦脈我先佔了。滾出去，或是埋在這裡。'],
      ['echo', '具名 AC「PROSPECTOR」。重裝、打樁機加霰彈，別讓它貼近。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'prospector',
    lines: [
      ['prospector', '還敢下來？坑道裡沒有地方讓你跑。'],
      ['echo', '保持距離，用 QB 甩開它的打樁。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'RUST',
    lines: [
      ['rust', '哈！你的零件我收下了。'],
      ['echo', 'RUST 的裝備每次都不同，先看清楚它拿什麼再決定距離。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'PROSPECTOR',
    lines: [
      ['prospector', '礦坑不歡迎外人。'],
      ['echo', 'PROSPECTOR 的打樁打中就會失衡。不要在它正面停下來。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'wasteland',
    type: 'battle',
    once: true,
    lines: [['echo', '拾荒 MT 的反應。它們會撿同伴的零件變強，先打落單的。']],
  },
  {
    event: 'segStart',
    theme: 'desert',
    type: 'destroy',
    once: true,
    lines: [['echo', '小心礦車，它們裝滿了炸藥。等它們靠近其他敵人再引爆。']],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'sirocco',
    once: true,
    lines: [
      ['sirocco', '……沙暴裡，看得見我嗎？'],
      ['echo', '具名 AC「SIROCCO」。高速近戰型，會從視野外突進。'],
      ['echo', '別在原地等它，保持移動。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'sirocco',
    lines: [
      ['sirocco', '又見面了。這次你的刀快一點了嗎？'],
      ['echo', 'SIROCCO 的格擋很準，近戰不要正面硬拼。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'SIROCCO',
    lines: [
      ['sirocco', '太慢了。'],
      ['echo', 'SIROCCO 會格擋正面的近戰。用射擊逼它，或是繞到側面。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'dunes',
    once: true,
    lines: [['echo', '沙丘地帶。沙下有東西在動——腳下出現沙塵就馬上移開。']],
  },
  // ---- 第 2 章：第 1 次出擊 ----
  {
    event: 'sortieStart',
    sid: 'c2s1',
    once: true,
    lines: [
      ['echo', '中部工業帶。集散場的貨櫃堆會擋住視線，敵人也會躲在後面。'],
      ['aetheric', '封鎖線的另一側就是河谷。我們的人在那裡等你。'],
    ],
  },
  { event: 'sortieStart', sid: 'c2s1', lines: [['echo', '重新投放到集散場。這次走別的路線試試看。']] },
  {
    event: 'trans',
    sid: 'c2s1',
    seg: 3,
    lines: [['echo', '前方是多重水壩的下游。河谷很長，電磁砲台的射程涵蓋整條河道。']],
  },
  {
    event: 'segStart',
    sid: 'c2s1',
    type: 'boss',
    lines: [
      ['echo', '超長程電磁砲台確認。它充能時會鎖定你——躲到壩體或建築物後面打斷它。'],
      ['aetheric', '散熱片打開的時候最脆弱。抓住那個時機。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2s1',
    lines: [
      ['aetheric', '砲台沉默了，研究設備可以通過了。報酬已經匯入。'],
      ['echo', '卡斯特隆發來了委託。他們想要的是主壩。'],
    ],
  },
  // ---- 第 2 章：第 2 次出擊（抉擇 1）----
  {
    event: 'sortieStart',
    sid: 'c2s2',
    once: true,
    lines: [
      ['castron', '主壩在最上游。沿著水壩一座一座往上打。'],
      ['echo', '……艾瑟立克的頻道也在監聽這次作戰。小心。'],
    ],
  },
  {
    event: 'choice',
    sid: 'c2s2',
    lines: [
      ['aetheric', '傭兵，聽我說。主壩落到卡斯特隆手上，他們會把整個工業帶的電切斷。'],
      ['aetheric', '標著「背叛委託方」的出口通往我們的接應點。走過去，報酬是他們的兩倍。'],
      ['castron', '別聽他們的。合約就是合約——走「依約完成委託」的出口，把主壩拿下來。'],
      ['echo', '兩個出口只能選一個。選了就回不了頭，之後的委託也會跟著改變。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c2s2',
    seg: 4,
    pick: 'castron',
    lines: [['castron', '很好。主壩下游的水沒市街有艾瑟立克的殘兵，順路清掉。']],
  },
  {
    event: 'segStart',
    sid: 'c2s2',
    seg: 4,
    pick: 'aetheric',
    lines: [
      ['aetheric', '歡迎過來這一邊。卡斯特隆的追兵在水沒市街，撐過去就是我們的地盤。'],
      ['castron', '……背叛的代價，你會付的。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c2s2',
    type: 'boss',
    lines: [
      ['echo', '重武裝母艦直升機。它會從空中投放部隊，先打掉它的武裝。'],
      ['echo', '高架道路和屋頂能讓你接近它的高度。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2s2',
    pick: 'castron',
    lines: [
      ['castron', '主壩是我們的了。合約完成，下一份委託也準備好了。'],
      ['echo', '艾瑟立克撤進了水沒市街。他們不會就這樣結束的。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2s2',
    pick: 'aetheric',
    lines: [
      ['aetheric', '主壩的電力接上了。你做了正確的選擇。'],
      ['echo', '卡斯特隆把你列進了黑名單。他們的列車正在往這裡開。'],
    ],
  },
  // ---- 第 2 章：第 3 次出擊（依抉擇）----
  {
    event: 'sortieStart',
    sid: 'c2s3a',
    once: true,
    lines: [
      ['castron', '研究所在水沒市街的中心。別留活口給他們的研究資料。'],
      ['echo', '水道很深，涉水會變慢。盡量走屋頂和高架道路。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c2s3a',
    type: 'boss',
    lines: [
      ['echo', '推土要塞衝出來了！正面的裝甲擋得住所有東西。'],
      ['castron', '讓它撞牆。撞上之後它會停住，繞到背後打。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2s3a',
    lines: [
      ['castron', '中部工業帶清乾淨了。卡斯特隆不會忘記忠誠的傭兵。'],
      ['echo', '第 2 章的委託全部完成。西部冰原那邊傳來了奇怪的訊號。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c2s3b',
    once: true,
    lines: [
      ['aetheric', '卡斯特隆的補給線經過水沒市街，終點是集散場的調度場。'],
      ['echo', '武裝列車在調度場整備。在它開出去之前攔下它。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c2s3b',
    type: 'boss',
    lines: [
      ['echo', '武裝列車！它會躲進隧道，出來時才打得到。'],
      ['aetheric', '先打掉車廂上的砲台，機車頭的裝甲很厚。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2s3b',
    lines: [
      ['aetheric', '列車停下來了。中部工業帶的電力會留給研究用。謝謝你，傭兵。'],
      ['echo', '第 2 章的委託全部完成。西部冰原那邊傳來了奇怪的訊號。'],
    ],
  },
  { event: 'fail', killedBy: 'HALBERD', lines: [['echo', '電磁砲台的射線被擋住就會中斷充能。先找掩體。']] },
  { event: 'fail', killedBy: 'HELIOS', lines: [['echo', '母艦直升機在高處。站上屋頂或高架道路再打。']] },
  {
    event: 'fail',
    killedBy: 'BEHEMOTH',
    lines: [['echo', '推土要塞正面打不動。引它撞牆，硬直時繞到背後。']],
  },
  { event: 'fail', killedBy: 'IRON CITADEL', lines: [['echo', '列車進隧道時打不到。守在隧道口等它出來。']] },
  {
    event: 'hub',
    chapter: 2,
    once: true,
    lines: [['echo', '中部工業帶開放了。卡斯特隆和艾瑟立克都在找傭兵——這次要小心選邊。']],
  },
  // ---- 第 3 章 ----
  {
    event: 'sortieStart',
    sid: 'c3s1',
    once: true,
    lines: [
      ['sancta', '冰原很冷，機體的散熱會變好，但視野會被暴風雪吃掉。'],
      ['echo', '雪地裡有東西在等你。注意地上冒出的白煙。'],
    ],
  },
  { event: 'sortieStart', sid: 'c3s1', lines: [['echo', '重新投放到冰原。暴風雪的位置每次都不一樣。']] },
  {
    event: 'segStart',
    sid: 'c3s1',
    type: 'boss',
    lines: [
      ['echo', '巡邏用超大型四足確認。腳下是死角，但它的砲台會往下打。'],
      ['sancta', '它就是讓難民營失聯的原因。拜託了。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c3s1',
    lines: [
      ['sancta', '巡邏兵器倒下了。難民營的人可以撤離了……謝謝你。'],
      ['echo', '冰原基地後方有一條往地下的通道。維爾威想知道那裡有什麼。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c3s2',
    once: true,
    lines: [
      ['veerwell', '研究所的入口在冰原基地的後方。往下走，訊號會變差。'],
      ['echo', '交界區段之後就是地下了。升降梯和豎坑是往下的路。'],
    ],
  },
  {
    event: 'trans',
    sid: 'c3s2',
    seg: 3,
    lines: [['echo', '前方的地面在往下陷。研究所的閘門應該就在那裡。']],
  },
  {
    event: 'segStart',
    sid: 'c3s2',
    type: 'boss',
    lines: [
      ['echo', '光學迷彩電戰機。它會消失，還會放出分身——分身打中會爆炸。'],
      ['veerwell', '它開火的時候會現形。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c3s2',
    lines: [
      ['veerwell', '入口打通了。研究所比我們想的還要深。'],
      ['echo', '最深處有 Coral 的讀數。下一次出擊要一路下去。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c3s3',
    once: true,
    lines: [
      ['veerwell', '研究核心在最底層。中途會有人攔你。'],
      ['echo', '收到。這次的區段都在地下，光線很暗。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c3s3',
    seg: 3,
    pick: 'castron',
    lines: [
      ['marsh', '……又見面了。這次艾瑟立克付了我很多錢。'],
      ['echo', 'MARSH 換了裝備，比在水沒市街的時候更強。這裡沒有水，它沒地方躲。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c3s3',
    seg: 3,
    pick: 'aetheric',
    lines: [
      ['stevedore', '背叛者的貨，我親自來收。'],
      ['echo', 'STEVEDORE 換了更重的砲。研究棟之間的通道很窄，貼近它。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c3s3',
    type: 'boss',
    lines: [
      ['echo', '脈衝刃翼。能量環擴散時用 QB 的無敵時間穿過去。'],
      ['veerwell', '它突刺之後會過熱，那是機會。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c3s3',
    lines: [
      ['veerwell', '研究核心安靜下來了。我們會派人回收資料。'],
      ['echo', '第 3 章的委託全部完成。北部的構造體開始有動靜了。'],
    ],
  },
  { event: 'fail', killedBy: 'STRIDER', lines: [['echo', '四足的腳下是死角，但它會跳起來踩你。保持移動。']] },
  {
    event: 'fail',
    killedBy: 'MIRAGE',
    lines: [['echo', '迷彩機開火時會現形。分身打中會爆炸，先確認哪一台是本體。']],
  },
  {
    event: 'fail',
    killedBy: 'PULSAR',
    lines: [['echo', '能量環要用 QB 穿過去。突刺之後它會過熱，那時候反擊。']],
  },
  { event: 'hub', chapter: 3, once: true, lines: [['echo', '西部冰原開放了。聖域和維爾威都有委託。']] },
  // ---- 第 4 章 ----
  {
    event: 'sortieStart',
    sid: 'c4s1',
    once: true,
    lines: [
      ['veerwell', 'Grid 086 是一層一層的平台。往下走，每一層都更暗。'],
      ['echo', '平台底下有砲塔，柱子上會有東西爬上來。上下都要注意。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s1',
    type: 'boss',
    lines: [
      ['echo', '多足要塞！打斷它的腳——斷三條就會倒下。'],
      ['veerwell', 'Coral 的讀數就在它身上。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4s1',
    lines: [
      ['veerwell', '多足要塞倒下了。讀數……還在往上傳，是從宇宙港那邊來的。'],
      ['echo', '聖域也發來了委託，目標是同一個地方。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c4s2',
    once: true,
    lines: [
      ['sancta', '先穿過外圍跑道，發射台在跑道盡頭。'],
      ['echo', '試車台還會噴火。地上出現橘色預警就離開。'],
    ],
  },
  {
    event: 'choice',
    sid: 'c4s2',
    lines: [
      ['veerwell', '傭兵，發射設施交給我們。重啟它，就能打開往軌道的路。'],
      ['sancta', '別讓他們重啟。發射的餘波會毀掉附近的聚落。'],
      ['echo', '又是只能選一個。這次的選擇會決定最後一章的路線。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s2',
    seg: 4,
    pick: 'veerwell',
    lines: [['veerwell', '很好。地下機庫裡的自律兵器清掉，設施就是我們的了。']],
  },
  {
    event: 'segStart',
    sid: 'c4s2',
    seg: 4,
    pick: 'sancta',
    lines: [
      ['sancta', '謝謝你。地下機庫的兵器清掉之後，我們會把設施封起來。'],
      ['veerwell', '……你會後悔的。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s2',
    type: 'boss',
    lines: [
      ['echo', '三機合體！血量降到一定程度會分離成三台——30 秒內全部擊破。'],
      ['echo', '先打修理的那一台。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4s2',
    pick: 'veerwell',
    lines: [
      ['veerwell', '發射設施交到我們手上了。重啟只是時間問題。'],
      ['echo', '聖域的頻道沉默了。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4s2',
    pick: 'sancta',
    lines: [
      ['sancta', '設施封住了。聚落的人可以安心了。'],
      ['echo', '維爾威在調動兵力。他們不打算放棄。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s3a',
    seg: 3,
    lines: [
      ['whiteout', '……又是你。這次是維爾威的敵人雇我。'],
      ['echo', 'WHITEOUT 換了裝備。構造體裡沒有暴風雪，但它還是會躲。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s3a',
    type: 'boss',
    lines: [
      ['echo', '電磁狩獵機。被 EMP 打中會不能 QB，還會被拉過去。'],
      ['veerwell', '發電機就在它後面。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4s3a',
    lines: [
      ['veerwell', '發電機接上了。發射設施重啟，往軌道的路打開了。'],
      ['echo', '第 4 章的委託全部完成。東岸的洋上都市也傳來了訊號。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s3b',
    seg: 3,
    lines: [
      ['specimen', '新的測試開始了。這次的對手是你。'],
      ['echo', 'SPECIMEN 被維爾威帶出來了，比在研究所時更強。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4s3b',
    type: 'boss',
    lines: [
      ['echo', '衛星砲導引塔！光柱會追著你——用 QB 急轉甩開。'],
      ['sancta', '撤離還差一點，撐住。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4s3b',
    lines: [
      ['sancta', '導引塔倒下了，聚落的人都撤出來了。真的謝謝你。'],
      ['echo', '第 4 章的委託全部完成。東岸的洋上都市也傳來了訊號。'],
    ],
  },
  { event: 'fail', killedBy: 'ARACHNE', lines: [['echo', '多足要塞斷三條腳就會倒下。集中打同一側的腳。']] },
  {
    event: 'fail',
    killedBy: 'CERBERUS',
    lines: [['echo', '三機合體分離後要在 30 秒內全部擊破，否則會合體回復。']],
  },
  { event: 'fail', killedBy: 'NULLIFIER', lines: [['echo', 'EMP 打中就不能 QB。保持距離，躲開它的射線。']] },
  {
    event: 'fail',
    killedBy: 'JUDGEMENT',
    lines: [['echo', '光柱越追越快，但轉彎有上限。用 QB 急轉甩開它。']],
  },
  {
    event: 'hub',
    chapter: 4,
    once: true,
    lines: [['echo', '北部構造體開放了。維爾威和聖域都盯上了舊宇宙港。']],
  },
  // ---- 第 5 章 ----
  {
    event: 'sortieStart',
    sid: 'c5s1',
    once: true,
    lines: [
      ['castron', '洋上都市的街區之間只有橋。掉進海裡會被拉回來，但機體會受損。'],
      ['echo', '衝撞無人機會把你往邊緣推。待在街區中央。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s1',
    type: 'boss',
    lines: [
      ['echo', '護盾指揮艦。先打掉護盾發生器，否則打不進去。'],
      ['castron', '發生器毀了之後過一陣子會重建，抓緊時間。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5s1',
    pick: 'veerwell',
    lines: [
      ['castron', '上陸成功。維爾威也到了，他們想要電纜。'],
      ['echo', '維爾威發來了委託。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5s1',
    pick: 'sancta',
    lines: [
      ['castron', '上陸成功。聖域的避難船也進港了。'],
      ['echo', '聖域發來了委託。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s2a',
    seg: 3,
    lines: [
      ['spire', '這裡的高樓很高。我喜歡。'],
      ['echo', 'SPIRE 被聖域雇了。洋上都市的高樓屋頂是它的地盤。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s2a',
    type: 'boss',
    lines: [
      ['echo', '空中要塞！先打掉引擎，它就會降下來。'],
      ['veerwell', '電纜就在它下面，小心別打斷。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5s2a',
    lines: [
      ['veerwell', '電纜確保了。軌道的校準開始了。'],
      ['echo', '電纜塔在都市的最深處。所有人都往那裡去了。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s2b',
    seg: 3,
    lines: [
      ['countdown', '目標：避難船。倒數開始。'],
      ['echo', 'COUNTDOWN 被維爾威雇了。它的飛彈會瞄準避難船，先處理它。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s2b',
    type: 'boss',
    lines: [
      ['echo', '高速突擊機！它會沿著警示線掃射，往側面閃。'],
      ['sancta', '避難船快出港了，拜託撐住。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5s2b',
    lines: [
      ['sancta', '避難船出港了。所有人都安全。謝謝你。'],
      ['echo', '電纜塔在都市的最深處。所有人都往那裡去了。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c5s3',
    once: true,
    lines: [
      ['castron', '電纜塔是最後的關口。拿下它，軌道就是我們的了。'],
      ['echo', '……卡斯特隆、維爾威、聖域、艾瑟立克。四家的人都在這裡。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5s3',
    type: 'boss',
    lines: [
      ['enemy', '傭兵，這座塔我們收下了。'],
      ['echo', 'IGUAZU 與 VOLTA！兩台 AC 會互相掩護，先集中打一台。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5s3',
    lines: [
      ['castron', '電纜塔拿下了。……軌道上的東西開始動了。'],
      ['echo', '第 5 章的委託全部完成。最後的戰場在上空。'],
    ],
  },
  { event: 'fail', killedBy: 'AEGIS', lines: [['echo', '護盾指揮艦的發生器在時打不進去。先拆發生器。']] },
  { event: 'fail', killedBy: 'LEVIATHAN', lines: [['echo', '空中要塞的引擎全毀後才會降下來。集中打引擎。']] },
  { event: 'fail', killedBy: 'VIPER', lines: [['echo', '突擊機掃射前會有警示線。掉頭減速時是攻擊的機會。']] },
  {
    event: 'fail',
    killedBy: 'IGUAZU',
    lines: [['echo', '兩台 AC 會互相掩護。拉開距離，讓它們分開再各個擊破。']],
  },
  { event: 'hub', chapter: 5, once: true, lines: [['echo', '東岸的洋上都市開放了。往軌道的路就在那裡。']] },
  // ---- 第 6 章 ----
  {
    event: 'sortieStart',
    sid: 'c6s1',
    once: true,
    lines: [
      ['aetheric', '發射設施準備好了。穿過宇宙港，搭上最後一班火箭。'],
      ['echo', '……軌道。我們終於要上去了。'],
    ],
  },
  {
    event: 'trans',
    sid: 'c6s1',
    seg: 4,
    lines: [['echo', '升空完成。從這裡開始是高空軌道，平台外面就是雲海。']],
  },
  {
    event: 'segStart',
    sid: 'c6s1',
    type: 'boss',
    lines: [
      ['echo', '浮游砲指揮機。浮游砲會包圍你，打中 EMP 會讓它們墜落。'],
      ['aetheric', '它回收浮游砲的時候最脆弱。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c6s1',
    lines: [
      ['aetheric', '第一層平台確保了。軌道站的外環就在上面。'],
      ['echo', '外環的防衛系統在讀取我們的資料……不太妙。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c6s2',
    type: 'boss',
    lines: [
      ['echo', '那是……你的機體。複製 AC！它會適應你常用的武器。'],
      ['veerwell', '換著武器打，別讓它的裝甲適應。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c6s2',
    lines: [
      ['veerwell', '複製品倒下了。中樞的門打開了。'],
      ['echo', '最後一段了。……傭兵，到時候你要怎麼做？'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c6s3',
    once: true,
    lines: [
      ['castron', '中樞的訊號很強。所有委託方都在監聽這個頻道。'],
      ['echo', '一路往上。最上層就是中樞。'],
    ],
  },
  {
    event: 'choice',
    sid: 'c6s3',
    lines: [
      ['castron', '把軌道站交給我們。這是合約。'],
      ['sancta', '讓它墜落吧。只要它還在天上，戰爭就不會結束。'],
      ['echo', '……兩個出口。選了之後，就只剩 BALTEUS 了。'],
    ],
  },
  {
    event: 'choice',
    sid: 'c6s3',
    cycle: 3,
    lines: [
      ['castron', '把軌道站交給我們。這是合約。'],
      ['sancta', '讓它墜落吧。只要它還在天上，戰爭就不會結束。'],
      ['echo', '……還有第三個出口。我一直沒有告訴你。'],
      ['echo', '如果你願意相信我——拒絕所有人，跟我一起走。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c6s3',
    type: 'boss',
    lines: [
      ['echo', 'BALTEUS。舊時代的艦載機動兵器，軌道站最後的守衛。'],
      ['echo', '這是最後一戰了。'],
    ],
  },
  { event: 'bossHalf', sid: 'c6s3', lines: [['echo', '它的裝甲在崩落！再一下就好！']] },
  {
    event: 'sortieEnd',
    sid: 'c6s3',
    lines: [['echo', 'BALTEUS 沉默了。……結束了，傭兵。']],
  },
  { event: 'fail', killedBy: 'SERAPHIM', lines: [['echo', '浮游砲包圍時往外衝，別待在包圍圈中央。']] },
  { event: 'fail', killedBy: 'DOPPEL', lines: [['echo', '複製 AC 會適應你常用的武器。換武器打。']] },
  { event: 'fail', killedBy: 'BALTEUS', lines: [['echo', '最後一戰了，別放棄。換個裝備再試一次。']] },
  { event: 'hub', chapter: 6, once: true, lines: [['echo', '高空軌道開放了。這是最後的戰場。']] },
  // ---- 第 2 周目以後 ----
  {
    event: 'hub',
    chapter: 1,
    cycle: 2,
    once: true,
    lines: [['echo', '……又回到這裡了。這一次，你會選另一邊嗎？']],
  },
  {
    event: 'hub',
    chapter: 1,
    cycle: 3,
    once: true,
    lines: [['echo', '第三次了。這一次，我想告訴你一件事——到了軌道站你就會知道。']],
  },
  {
    event: 'sortieStart',
    sid: 'c1s1',
    cycle: 2,
    once: true,
    lines: [
      ['echo', '同樣的荒野，同樣的委託。但你已經知道最後會發生什麼了。'],
      ['castron', '……傭兵，我們以前合作過嗎？'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c2s2',
    cycle: 2,
    once: true,
    lines: [['echo', '主壩的抉擇又要來了。上一次的選擇，記得嗎？']],
  },
  // ---- 第 2 周目以後的委託 ----
  {
    event: 'sortieStart',
    sid: 'c1x',
    lines: [
      ['aetheric', '調查隊最後的位置在沙丘的埋沒都市。'],
      ['echo', '……這個訊號。我好像在哪裡聽過。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c1x',
    type: 'boss',
    lines: [
      ['enemy', '——識別碼不符。排除。'],
      ['echo', 'JUGGERNAUT！它的裝甲很厚，從側面和背後打。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c1x',
    lines: [
      ['aetheric', '調查隊的紀錄回收了。最後一句是：「它在等待同一個傭兵回來。」'],
      ['echo', '……先回去吧。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c2x',
    lines: [
      ['sancta', '工人們躲在儲油槽區的地下室。熔爐清掃機正往那裡去。'],
      ['echo', '濃霧和水道會擋住視線，小心潛航砲艇。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c2x',
    type: 'boss',
    lines: [
      ['echo', 'CINDER！熔渣落下的地方會燒起來，別站在火裡。'],
      ['sancta', '爐口打開的時候最脆弱——工人們是這樣說的。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c2x',
    lines: [
      ['sancta', '工人們都出來了。謝謝你，傭兵。'],
      ['sancta', '上一次，我們以為你只是一把槍。原來不是。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c3x',
    lines: [
      ['aetheric', '觀測站在冰原的針葉林裡。極夜之下很難看見。'],
      ['echo', '紀錄裡如果真的有你的名字……那我又是誰？'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c3x',
    type: 'boss',
    lines: [
      ['echo', 'HELIOS！母艦直升機會放出無人機，先打掉護衛。'],
      ['aetheric', '副本就在它的貨艙裡。打下來就好，別讓它飛走。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c3x',
    lines: [
      ['aetheric', '紀錄寫著：「第 1 次觀測，傭兵抵達軌道。重置。第 2 次觀測……」'],
      ['echo', '……我們不是第一次走這條路。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c4x',
    lines: [
      ['veerwell', '構造體的支柱林裡有一條通往發射台的舊通道。'],
      ['echo', '發射台的識別碼……和軌道站是同一個系列。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c4x',
    type: 'boss',
    lines: [
      ['echo', 'HALBERD！它充能時找掩體擋住射線，充能就會中斷。'],
      ['veerwell', '砲擊後散熱片會打開，那時候打。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c4x',
    lines: [
      ['veerwell', '發射台的紀錄寫著：「為了讓傭兵抵達軌道，保留此台。」'],
      ['echo', '有人在幫你鋪路。……或者，有人在等你。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c5x',
    lines: [
      ['castron', '海底通訊局的入口在夜裡的橋梁群下面。'],
      ['echo', '訊號越來越清楚了。……那是我的聲音。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c5x',
    type: 'boss',
    lines: [
      ['echo', 'NULLIFIER！它的 EMP 會封鎖推進器，被打中前先拉開距離。'],
      ['castron', '別被牽引過去。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c5x',
    lines: [
      ['castron', '通訊局的廣播停了。最後一段是：「ECHO，回到起點。」'],
      ['echo', '……傭兵。等到了軌道站，我會告訴你一切。'],
    ],
  },
  {
    event: 'sortieStart',
    sid: 'c6x',
    lines: [
      ['aetheric', '日照面沒有遮蔽物。直接暴露在陽光下的裝甲會過熱，速戰速決。'],
      ['echo', '這裡是訊號的源頭。也是我……第一次醒來的地方。'],
    ],
  },
  {
    event: 'segStart',
    sid: 'c6x',
    type: 'boss',
    lines: [
      ['echo', 'PULSAR！能量環擴散時用快速推進的無敵時間穿過去。'],
      ['echo', '打倒它，訊號就會停下來。'],
    ],
  },
  {
    event: 'sortieEnd',
    sid: 'c6x',
    lines: [
      ['echo', '訊號停了。……我想起來了。每一次你抵達軌道，世界就重來一次。'],
      ['echo', '第三次的時候，選擇不屬於任何人的那條路。我會在那裡等你。'],
    ],
  },
  {
    event: 'hub',
    chapter: 1,
    cycle: 2,
    lines: [['echo', '總覽圖上多了幾個紫色的節點。上一次沒有的委託。']],
  },
  { event: 'fail', killedBy: 'JUGGERNAUT', lines: [['echo', 'JUGGERNAUT 的正面太硬了。繞到側面。']] },
  { event: 'fail', killedBy: 'CINDER', lines: [['echo', '燃燒的地面會一直扣血。別在火裡跟它對射。']] },
  { event: 'fail', killedBy: 'HELIOS', lines: [['echo', '先清掉它放出來的無人機，再打本體。']] },
  { event: 'fail', killedBy: 'HALBERD', lines: [['echo', '電磁砲充能時一定要躲到掩體後面。']] },
  { event: 'fail', killedBy: 'NULLIFIER', lines: [['echo', 'EMP 封鎖時沒辦法閃，看到預警就先跑。']] },
  { event: 'fail', killedBy: 'PULSAR', lines: [['echo', '能量環的波面要用快速推進穿過，不要往後退。']] },
  // ---- 第 6 章的宿敵與專屬敵人 ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'zenith',
    once: true,
    lines: [
      ['zenith', '地面是給弱者站的。'],
      ['echo', '具名 AC「ZENITH」。純空戰型，幾乎不落地。'],
      ['echo', '它在空中換位置時最好打。注意它的飛彈。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'zenith',
    lines: [
      ['zenith', '再飛高一點。'],
      ['echo', 'ZENITH 能量用完時會落地，那是機會。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'ZENITH',
    lines: [
      ['zenith', '你看不到天空。'],
      ['echo', '別一直在地面跟它對射。跳起來，逼它換位置。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'orbit',
    once: true,
    lines: [['echo', '高空軌道。標定衛星會用光束標記你，被標定時受到的傷害會變重——先打掉它。']],
  },
  { event: 'fail', killedBy: '標定', lines: [['echo', '被標定之後所有攻擊都會更痛。優先擊落標定衛星。']] },
  { event: 'fail', killedBy: '作業機', lines: [['echo', '真空作業機會忽高忽低。用飛彈或預判射擊。']] },
  // ---- 第 5 章的宿敵與專屬敵人 ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'undertow',
    once: true,
    lines: [
      ['undertow', '這裡的海很深。掉下去就不用回來了。'],
      ['echo', '具名 AC「UNDERTOW」。貼身之後會把你往甲板邊緣推。'],
      ['echo', '待在街區中央，別背對虛空跟它近戰。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'undertow',
    lines: [
      ['undertow', '潮水又來了。'],
      ['echo', 'UNDERTOW 推擊之後有 3 秒的空檔，那時候反擊。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'UNDERTOW',
    lines: [
      ['undertow', '沉下去吧。'],
      ['echo', '被推到邊緣時用 QB 往內拉回來。和它保持中距離。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'xylem',
    once: true,
    lines: [['echo', '洋上都市 Xylem。街區外是海，掉下去會被拉回來但會受損。小心衝撞無人機。']],
  },
  {
    event: 'fail',
    killedBy: '衝撞',
    lines: [['echo', '衝撞無人機撞之前會有預警線。橫向閃開，別站在它和虛空之間。']],
  },
  { event: 'fail', killedBy: '防空', lines: [['echo', '防空砲只打空中的目標。貼地接近，別在它附近跳。']] },
  // ---- 第 4 章的宿敵與專屬敵人 ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'spire',
    once: true,
    lines: [
      ['spire', '往上看。我一直在你頭上。'],
      ['echo', '具名 AC「SPIRE」。會跳到高處的平台往下打——高處的攻擊衝擊更大。'],
      ['echo', '爬上同一層平台，別讓它一直佔著高處。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'spire',
    lines: [
      ['spire', '你還在下面嗎？'],
      ['echo', 'SPIRE 換平台的時候會跳起來，那時候最好打。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'SPIRE',
    lines: [
      ['spire', '高度就是一切。'],
      ['echo', '別在 SPIRE 的正下方停留。找坡道上去和它平視。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'countdown',
    once: true,
    lines: [
      ['countdown', '十、九、八……你還有幾秒？'],
      ['echo', '具名 AC「COUNTDOWN」。大量飛彈齊射，聽到鎖定警告就找掩體。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'countdown',
    lines: [
      ['countdown', '倒數重新開始。'],
      ['echo', 'COUNTDOWN 的飛彈追得很緊，用 QB 在最後一刻橫向閃開。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'COUNTDOWN',
    lines: [
      ['countdown', '零。'],
      ['echo', '飛彈齊射時躲到防爆牆或建築物後面，等它換彈再衝。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'grid086',
    once: true,
    lines: [['echo', 'Grid 086。平台底下吊著砲塔，柱子上會有東西爬上來——上下都要注意。']],
  },
  {
    event: 'segStart',
    theme: 'spaceport',
    once: true,
    lines: [['echo', '舊宇宙港。推進器試車台還會噴火，看到地上的橘色預警就離開。']],
  },
  {
    event: 'fail',
    killedBy: '爬行機',
    lines: [['echo', '爬行機會沿著柱子爬上平台。站在平台邊緣時注意下方。']],
  },
  {
    event: 'fail',
    killedBy: '試車台',
    lines: [['echo', '試車台的噴火方向在預警時就決定了。往側面閃，或擊破控制台讓它停下來。']],
  },
  // ---- 第 3 章的宿敵與專屬敵人 ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'whiteout',
    once: true,
    lines: [
      ['whiteout', '……看不見我吧。我也不打算讓你看見。'],
      ['echo', '具名 AC「WHITEOUT」。在暴風雪裡鎖定不到，只有開火的瞬間會暴露位置。'],
      ['echo', '看到槍口的閃光就衝過去，貼近之後它躲不掉。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'whiteout',
    lines: [
      ['whiteout', '雪又變大了。'],
      ['echo', 'WHITEOUT 在遠距離最危險。拉近距離，別在空曠的雪原上停下來。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'WHITEOUT',
    lines: [
      ['whiteout', '一發就夠了。'],
      ['echo', 'WHITEOUT 開火後會現身 2 秒多。抓住那個時機，或是貼近到 14 m 內。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'snow',
    once: true,
    lines: [['echo', '西部冰原。雪裡藏著東西——看到地上冒白煙就是潛伏的 MT。']],
  },
  {
    event: 'fail',
    killedBy: '潛伏',
    lines: [['echo', '雪中潛伏 MT 靠近才會現身。注意地上的白煙，先開火逼它出來。']],
  },
  {
    event: 'fail',
    killedBy: '滑行',
    lines: [['echo', '滑行砲車繞著你轉。往它的前進方向預判射擊，或離開冰面。']],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'specimen',
    once: true,
    lines: [
      ['specimen', '……誰？又是測試嗎？好，我會表現得很好。'],
      ['echo', '具名 AC「SPECIMEN」。研究所的強化人間，會定期過載。'],
      ['echo', '過載時別硬碰，撐過去之後它會硬直——那時候集中火力。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'specimen',
    lines: [
      ['specimen', '這次的數值一定會更好。'],
      ['echo', 'SPECIMEN 過載結束後有 3 秒的硬直。等它。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'SPECIMEN',
    lines: [
      ['specimen', '測試結束。'],
      ['echo', 'SPECIMEN 過載時保持距離，結束後的硬直才是攻擊的時機。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'institute',
    once: true,
    lines: [['echo', '地下技研都市。紅色的雷射柵欄會觸發警報，實驗體聚在一起會融合——先處理它們。']],
  },
  {
    event: 'fail',
    killedBy: '實驗體',
    lines: [['echo', '實驗體聚在一起會融合變大。在它們聚集之前分散擊破。']],
  },
  {
    event: 'fail',
    killedBy: '雷射網',
    lines: [['echo', '雷射柵欄會一直轉。看準它掃過去之後再穿過，或先打掉柵欄柱。']],
  },
  // ---- 第 2 章的宿敵與專屬敵人 ----
  {
    event: 'segStart',
    type: 'elite',
    ace: 'stevedore',
    once: true,
    lines: [
      ['stevedore', '貨到了。簽收吧——用你的裝甲。'],
      ['echo', '具名 AC「STEVEDORE」。雙肩榴彈，會躲在貨櫃堆後面砲擊。'],
      ['echo', '從側面繞過去，別在空曠的地方停下來。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'stevedore',
    lines: [
      ['stevedore', '又一筆退貨。這次換更重的砲彈。'],
      ['echo', 'STEVEDORE 的榴彈落地前有預警，橫向移動。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'STEVEDORE',
    lines: [
      ['stevedore', '簽收完成。'],
      ['echo', 'STEVEDORE 怕近身。貼著貨櫃堆接近，再一口氣衝過去。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'industrial',
    once: true,
    lines: [['echo', '貨運集散場。起重機還在運轉——看到地上的紅圈就是貨櫃要砸下來了。']],
  },
  {
    event: 'fail',
    killedBy: '起重機',
    lines: [['echo', '起重機砲台不會移動。貼近打塔身，它的貨櫃砸不到腳下。']],
  },
  {
    event: 'fail',
    killedBy: '叉架',
    lines: [['echo', '叉架 MT 的正面有貨櫃擋著。繞到側面，或用近戰把貨櫃打掉。']],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'sluice',
    once: true,
    lines: [
      ['sluice', '這座壩由我守著。往上游一步，就沖你下去。'],
      ['echo', '具名 AC「SLUICE」。會佔住壩頂的高處，用重火力壓制。'],
      ['echo', '利用壩體的陰影接近，或是爬上壩頂跟它平視。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'sluice',
    lines: [
      ['sluice', '又回來了？水位已經漲上來了。'],
      ['echo', 'SLUICE 在高處的火力最強。別在下面跟它對射。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'SLUICE',
    lines: [
      ['sluice', '沉下去吧。'],
      ['echo', 'SLUICE 喜歡站在壩頂。從坡道或閘門上方繞上去，近身打它。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'dam',
    once: true,
    lines: [['echo', '多重水壩。閘門上有砲台——地面出現藍色預警就是要開閘了，別待在水道裡。']],
  },
  {
    event: 'fail',
    killedBy: '閘門',
    lines: [['echo', '開閘的水流會把你往下游沖。看到藍色預警就跳起來，或往水道兩側移開。']],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'marsh',
    once: true,
    lines: [
      ['marsh', '……水很冷吧？我一直都待在這裡面。'],
      ['echo', '具名 AC「MARSH」。兩棲型，在水裡會潛行，鎖定不到。'],
      ['echo', '站到高處，等它從水裡出來。'],
    ],
  },
  {
    event: 'segStart',
    type: 'elite',
    ace: 'marsh',
    lines: [
      ['marsh', '又來泡水了？'],
      ['echo', 'MARSH 靠近時才會浮出來。離開水道，逼它上岸。'],
    ],
  },
  {
    event: 'fail',
    killedBy: 'MARSH',
    lines: [
      ['marsh', '沉到底吧。'],
      ['echo', '在水裡你會變慢，MARSH 不會。站上屋頂或高架道路再打。'],
    ],
  },
  {
    event: 'segStart',
    theme: 'flooded',
    once: true,
    lines: [['echo', '水沒市街。水裡移動會變慢，水下還有砲艇——看到水花就是它要浮上來了。']],
  },
  {
    event: 'fail',
    killedBy: '潛航',
    lines: [['echo', '潛航砲艇只在浮出水面時打得到。注意魚雷的來向，橫向閃開。']],
  },
  {
    event: 'fail',
    killedBy: '汙染',
    lines: [['echo', '腐蝕區會持續損傷、讓 ACS 回復變慢。別在綠色的地面上停留。']],
  },
  // ---- 失敗 ----
  { event: 'fail', fails: 3, lines: [['echo', '已經第三次了。換個裝備試試看？重量和射程都會影響打法。']] },
  {
    event: 'fail',
    killedBy: 'BASTILLE',
    lines: [['echo', '砲台正面太硬了。先打周圍的設施，砲台的裝甲才會變弱。']],
  },
  { event: 'fail', killedBy: 'SANDWORM', lines: [['echo', '鑽地蟲在地下時打不到。等它鑽出來再集中火力。']] },
  { event: 'fail', killedBy: 'MT', lines: [['echo', '被雜兵圍住了。用 QB 拉開距離，別停在原地。']] },
  { event: 'fail', lines: [['echo', 'AC 回收完成。從紀錄點重新開始吧。']] },
  // ---- 機庫 ----
  { event: 'hub', chapter: 1, once: true, lines: [['echo', '歡迎來到機庫。總覽圖上會標出可以接的委託。']] },
];

// 說話者的頭像徽章（程式產生的 SVG）
export function speakerBadge(id, size = 44) {
  const S = SPEAKERS[id] || SPEAKERS.echo;
  return `<svg class="cBadge" width="${size}" height="${size}" viewBox="0 0 44 44"><rect x="1" y="1" width="42" height="42" rx="6" fill="#0c1218" stroke="${S.color}" stroke-width="2"/><path d="M6 38 L22 30 L38 38" stroke="${S.color}" stroke-opacity="0.35" stroke-width="6" fill="none"/><text x="22" y="27" text-anchor="middle" font-size="20" font-weight="700" fill="${S.color}" font-family="sans-serif">${escHtml(S.mark)}</text></svg>`;
}
