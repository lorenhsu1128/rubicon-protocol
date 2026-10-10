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
// needs＝先完成哪些出擊才開放
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
};

// 通訊：event＝觸發事件；其餘欄位都是條件（沒寫＝不限）；once＝整個存檔只播一次；
// lines＝[說話者, 台詞] 依序播放
// 事件：sortieStart（出擊開始）、segStart（進入區段）、exitsOpen（區段清除開出口）、trans（轉場）、bossHalf（Boss 剩一半）、
//       fail（失敗回機庫）、sortieEnd（出擊完成）、hub（回到機庫）
// 條件：sid、seg（區段編號）、type（區段類型）、theme、chapter、fails（失敗次數 ≥）、killedBy（擊破你的敵人名稱包含）、cycle（周目）
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
    lines: [['veerwell', '震動停止了。探勘隊的殘骸……我們會去回收。謝謝你，傭兵。']],
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
