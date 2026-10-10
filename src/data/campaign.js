// 主線任務模式的資料（設計見 docs/campaign-design.md）：出擊、主題的轉場方式、轉場演出、區段類型、出口獎勵、陣營抉擇
import { BOSS_DEFS } from './enemies.js';

// 主題的區段串接方式：relay 橫向接力、down 垂直下降、up 垂直上升、mixed 先接力再下降、sim 只當模擬器
export const THEME_MODE = {
  industrial: 'relay',
  wasteland: 'relay',
  snow: 'relay',
  dunes: 'relay',
  flooded: 'relay',
  dam: 'relay',
  desert: 'down',
  grid086: 'down',
  institute: 'down',
  xylem: 'down',
  spaceport: 'mixed',
  orbit: 'up',
  grid: 'sim',
};

// 轉場演出：TRANSITIONS[主題][串接方式]（沒有時用 DEFAULT）；entry＝抵達時出生點的入口結構（lift 升降梯平台、lz 降落區）
const T = (title, sub, entry = '') => ({ title, sub, entry });
const DEFAULT = {
  relay: [T('運輸機吊掛移動', '前往下一個作戰區域', 'lz'), T('穿越公路隧道', '沿公路推進')],
  down: [T('升降梯下降', '深入地下', 'lift'), T('豎井跳降', '沿豎井往下')],
  up: [T('軌道電梯上升', '前往高空', 'lift')],
};
export const TRANSITIONS = {
  drop: T('運輸機空降', '投放至作戰區域', 'lz'),
  wasteland: {
    relay: [
      T('運輸機吊掛移動', '越過荒野的台地', 'lz'),
      T('穿越公路隧道', '沿舊公路推進'),
      T('搭乘貨運列車', '沿鐵路移動到下一個區域'),
      T('從高架橋跳下', '捷徑：直接切入下一區'),
    ],
  },
  industrial: {
    relay: [
      T('穿越公路隧道', '沿集散場的聯絡道推進'),
      T('搭乘貨運列車', '跳上調度中的貨運列車'),
      T('門式起重機吊掛', '被起重機吊過貨櫃堆', 'lz'),
      T('運輸機吊掛移動', '前往下一個堆場', 'lz'),
    ],
  },
  institute: {
    relay: [T('沿維修通道推進', '在研究棟之間的通道前進'), T('搭乘輸送軌道', '沿貨物輸送軌道移動')],
    down: [
      T('大型貨運升降梯下降', '搭乘研究所的貨運升降梯深入地下', 'lift'),
      T('沿維修豎坑垂降', '沿著豎坑往下跳'),
      T('研究棟坍塌', '地板崩落，直接掉進下一層'),
    ],
  },
  snow: {
    relay: [
      T('運輸機吊掛移動', '在暴風雪的白幕裡飛行', 'lz'),
      T('雪地履帶車', '搭乘雪地運輸車前進'),
      T('穿越冰河隧道', '沿冰河底下的隧道推進'),
    ],
  },
  flooded: {
    relay: [
      T('沿高架道路推進', '在水面上的高架道路前進'),
      T('涉水穿過地下道', '從淹沒的地下道通過'),
      T('運輸機吊掛移動', '越過淹沒的市區', 'lz'),
    ],
  },
  dam: {
    relay: [
      T('翻越壩頂', '沿壩頂步道前往上游的下一座壩'),
      T('穿過閘門下的通道', '從洩洪閘門下方通過'),
      T('運輸機吊掛移動', '沿河谷往上游', 'lz'),
      T('沿河谷推進', '溯河而上'),
    ],
  },
  dunes: {
    relay: [
      T('運輸機吊掛移動', '越過沙丘', 'lz'),
      T('沙暴中行軍', '在沙暴的掩護下推進'),
      T('沿沙丘公路推進', '跟著半埋的公路前進'),
    ],
  },
  desert: {
    relay: [T('運輸機吊掛移動', '前往礦場外圍', 'lz'), T('沿礦車軌道推進', '跟著廢棄的礦車軌道前進')],
    down: [
      T('礦坑升降機下降', '搭乘貨運升降機深入礦坑', 'lift'),
      T('豎井跳降', '沿豎井往下跳'),
      T('坍塌墜落', '地面崩落，直接掉進下一層'),
      T('沿輸送帶滑下', '順著斜向輸送帶往下'),
    ],
  },
};
export function transList(theme, mode) {
  return (TRANSITIONS[theme] && TRANSITIONS[theme][mode]) || DEFAULT[mode] || DEFAULT.relay;
}

// 出口獎勵（下一個區段清除後發放）
export const EXIT_REWARDS = {
  coam: { name: '資金', icon: '¥', color: '#ffc040', desc: 'COAM 報酬' },
  repair: { name: '修理', icon: '✚', color: '#7ee081', desc: '回復 AP 35%、補給彈藥 35%' },
  xp: { name: '經驗', icon: '★', color: '#7fc8ff', desc: '駕駛員經驗' },
  // 戰術模組（data/modules.js）：清除後從該委託方的模組三選一
  mod_castron: {
    name: '卡斯特隆模組',
    icon: '◆',
    color: '#d8903a',
    desc: '實彈與衝擊的戰術模組',
    faction: 'castron',
  },
  mod_aetheric: {
    name: '艾瑟立克模組',
    icon: '◆',
    color: '#5ab8ff',
    desc: '能量武器的戰術模組',
    faction: 'aetheric',
  },
  mod_veerwell: {
    name: '維爾威模組',
    icon: '◆',
    color: '#9be070',
    desc: '機動的戰術模組',
    faction: 'veerwell',
  },
  mod_sancta: {
    name: '聖域模組',
    icon: '◆',
    color: '#e0d070',
    desc: '防禦與修理的戰術模組',
    faction: 'sancta',
  },
};

// 區段類型（出口上預告）：goal＝HUD 的目標說明
export const SEG_TYPES = {
  battle: { name: '戰鬥', goal: '肅清敵軍' },
  elite: { name: '精英', goal: '擊破敵對 AC' },
  destroy: { name: '破壞', goal: '摧毀目標設施' },
  defend: { name: '防衛', goal: '守住防衛目標' },
  escort: { name: '護送', goal: '護送車隊抵達終點' },
  breakthrough: { name: '突破', goal: '突破敵陣，抵達出口' },
  supply: { name: '補給', goal: '補給後選擇出口' },
  intel: { name: '情報', goal: '下載資料終端的情報' },
  boss: { name: 'Boss', goal: '擊破 Boss' },
};

// boss：kind（新 Boss）或名稱開頭（JUGGERNAUT、STRIDER 這類沒有 kind 的）
const bossOf = (key) => BOSS_DEFS.find((b) => b.kind === key || b.name.startsWith(key + ' ')) || BOSS_DEFS[0];

// 陣營抉擇（docs/campaign-design.md 第 2 節）：區段的 choice＝這一段清除後出現的是互斥的抉擇出口（每個選項一個），
// 走進去就決定；出擊完成時寫進 save.story.choices[id]，之後的出擊節點（BRIEFINGS 的 when）與通訊（條件 pick）跟著改變
export const CHOICES = {
  c2: {
    name: '抉擇 1：主壩的歸屬',
    opts: [
      { key: 'castron', name: '依約完成委託', sub: '卡斯特隆：照合約拿下主壩', faction: 'castron' },
      { key: 'aetheric', name: '背叛委託方', sub: '艾瑟立克：把主壩交給研究機構', faction: 'aetheric' },
    ],
  },
};

// 出擊：level＝敵人強度的基準（每兩個區段 +1）；segs 依序進行：
// pool＝這一段可能的區段類型（出口各自預告一種；只有一種時各出口類型相同、獎勵不同）、border＝主題交界的區段、
// variants＝限定的主題變體（Boss 要開闊的場地）、choice＝陣營抉擇（見 CHOICES）、
// ace＝精英區段的專屬 AC（不寫時用主題的；{ 選項: AC } 依這一章之前的抉擇；別的主題的 AC＝跨章節再登場，會強化）
export const SORTIES = {
  c1s1: {
    name: '南部荒野 — 礦坑突破',
    chapter: 1,
    level: 2,
    reward: 30000,
    segs: [
      { theme: 'wasteland', pool: ['battle'] },
      { theme: 'dunes', pool: ['battle', 'destroy', 'defend', 'intel', 'elite'] },
      { theme: 'wasteland', pool: ['supply', 'escort', 'breakthrough', 'elite'] },
      { theme: 'desert', border: true, pool: ['elite', 'destroy', 'battle'] },
      { theme: 'desert', pool: ['boss'], boss: 'artillery', variants: ['openpit', 'shaft'] },
    ],
  },
};
SORTIES.c1s2 = {
  name: '礦坑深部 — 震動源調查',
  chapter: 1,
  level: 3,
  reward: 42000,
  segs: [
    { theme: 'desert', border: true, pool: ['battle', 'supply'] },
    { theme: 'desert', pool: ['battle', 'destroy', 'intel'], variants: ['tunnels', 'vein', 'openpit'] },
    { theme: 'desert', pool: ['elite', 'defend', 'breakthrough'], variants: ['tunnels', 'vein', 'shaft'] },
    { theme: 'desert', pool: ['supply', 'battle', 'intel'], variants: ['vein', 'tunnels', 'shaft'] },
    { theme: 'desert', pool: ['boss'], boss: 'worm', variants: ['openpit', 'shaft'] },
  ],
};
// ---- 第 2 章：中部工業帶（抉擇 1 在 c2s2；c2s3a／c2s3b 依抉擇開放其中一個）----
SORTIES.c2s1 = {
  name: '中部工業帶 — 集散場封鎖突破',
  chapter: 2,
  level: 4,
  reward: 52000,
  segs: [
    { theme: 'industrial', pool: ['battle'] },
    { theme: 'industrial', pool: ['battle', 'destroy', 'defend', 'intel', 'elite'] },
    { theme: 'industrial', pool: ['supply', 'escort', 'breakthrough', 'elite'] },
    { theme: 'dam', pool: ['battle', 'destroy', 'intel'] },
    { theme: 'dam', pool: ['supply', 'defend', 'elite', 'breakthrough'] },
    { theme: 'dam', pool: ['boss'], boss: 'railgun', variants: ['plant', 'weirs', 'storm'] },
  ],
};
SORTIES.c2s2 = {
  name: '多重水壩 — 主壩爭奪',
  chapter: 2,
  level: 5,
  reward: 64000,
  segs: [
    { theme: 'dam', pool: ['battle'] },
    { theme: 'dam', pool: ['battle', 'destroy', 'elite', 'intel'] },
    { theme: 'dam', pool: ['supply', 'defend', 'breakthrough'] },
    { theme: 'dam', pool: ['elite', 'battle', 'destroy'], choice: 'c2' },
    { theme: 'flooded', pool: ['battle', 'supply', 'defend', 'intel'] },
    { theme: 'flooded', pool: ['boss'], boss: 'heli', variants: ['suburb', 'highway', 'toxic'] },
  ],
};
SORTIES.c2s3a = {
  name: '水沒市街 — 研究機構掃蕩',
  chapter: 2,
  level: 6,
  reward: 76000,
  segs: [
    { theme: 'flooded', pool: ['battle'] },
    { theme: 'flooded', pool: ['battle', 'destroy', 'elite', 'intel'] },
    { theme: 'flooded', pool: ['supply', 'defend', 'breakthrough'] },
    { theme: 'industrial', pool: ['battle', 'destroy', 'defend'] },
    { theme: 'industrial', pool: ['supply', 'elite', 'breakthrough', 'escort'] },
    { theme: 'industrial', pool: ['boss'], boss: 'rampart', variants: ['warehouse', 'docks', 'stacks'] },
  ],
};
SORTIES.c2s3b = {
  name: '集散場 — 卡斯特隆補給線破壞',
  chapter: 2,
  level: 6,
  reward: 76000,
  segs: [
    { theme: 'industrial', pool: ['battle'] },
    { theme: 'industrial', pool: ['destroy', 'battle', 'intel', 'elite'] },
    { theme: 'industrial', pool: ['supply', 'escort', 'defend'] },
    { theme: 'flooded', pool: ['battle', 'destroy', 'breakthrough'] },
    { theme: 'flooded', pool: ['supply', 'elite', 'intel'] },
    { theme: 'industrial', pool: ['boss'], boss: 'train', variants: ['railyard', 'stacks'] },
  ],
};
// ---- 第 3 章：西部冰原與地下（冰原 → 技研都市，跨主題下降；宿敵再登場）----
SORTIES.c3s1 = {
  name: '西部冰原 — 冰原基地偵察',
  chapter: 3,
  level: 7,
  reward: 88000,
  segs: [
    { theme: 'snow', pool: ['battle'] },
    { theme: 'snow', pool: ['battle', 'destroy', 'defend', 'intel', 'elite'] },
    { theme: 'snow', pool: ['supply', 'escort', 'breakthrough'] },
    { theme: 'snow', pool: ['battle', 'elite', 'destroy'] },
    { theme: 'snow', pool: ['supply', 'defend', 'intel'] },
    { theme: 'snow', pool: ['boss'], boss: 'STRIDER', variants: ['icefield', 'outpost', 'blizzard'] },
  ],
};
SORTIES.c3s2 = {
  name: '冰原之下 — 研究所入口',
  chapter: 3,
  level: 8,
  reward: 98000,
  segs: [
    { theme: 'snow', pool: ['battle'] },
    { theme: 'snow', pool: ['battle', 'destroy', 'elite', 'intel'] },
    { theme: 'snow', pool: ['supply', 'breakthrough', 'defend'] },
    { theme: 'institute', border: true, pool: ['battle', 'destroy', 'elite'] },
    { theme: 'institute', pool: ['supply', 'battle', 'intel'], variants: ['tanks', 'core', 'cavern'] },
    { theme: 'institute', pool: ['boss'], boss: 'phantom', variants: ['core', 'tanks'] },
  ],
};
SORTIES.c3s3 = {
  name: '地下技研都市 — 研究核心',
  chapter: 3,
  level: 9,
  reward: 110000,
  segs: [
    { theme: 'institute', pool: ['battle'], variants: ['tanks', 'core'] },
    {
      theme: 'institute',
      pool: ['battle', 'destroy', 'elite', 'intel'],
      variants: ['core', 'cavern', 'tanks'],
    },
    { theme: 'institute', pool: ['supply', 'defend', 'breakthrough'], variants: ['tanks', 'core', 'cavern'] },
    // 宿敵再登場：依第 2 章的抉擇，對立陣營雇用的傭兵
    {
      theme: 'institute',
      pool: ['elite'],
      ace: { castron: 'marsh', aetheric: 'stevedore' },
      variants: ['cavern', 'core'],
    },
    { theme: 'institute', pool: ['supply', 'battle', 'intel'], variants: ['core', 'tanks', 'cavern'] },
    { theme: 'institute', pool: ['boss'], boss: 'ibis', variants: ['cavern', 'core'] },
  ],
};
export const SORTIE_DEFAULT = 'c1s1';

export function sortieBoss(seg, type) {
  return (type || (seg && seg.pool[0])) === 'boss' ? bossOf(seg.boss) : null;
}
// 兩個區段之間的轉場方式：往交界區段一律接力；同一個垂直主題往下一段用下降
export function transMode(fromSeg, toSeg) {
  const m = THEME_MODE[toSeg.theme] || 'relay';
  if (toSeg.border) return 'relay';
  if (m === 'mixed') return fromSeg.theme === toSeg.theme ? 'down' : 'relay';
  if (m === 'down' || m === 'up') return m;
  return 'relay';
}
