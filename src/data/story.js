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
