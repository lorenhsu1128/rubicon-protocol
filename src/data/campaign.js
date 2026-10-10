// 主線任務模式的資料（設計見 docs/campaign-design.md）：出擊、主題的轉場方式、轉場演出、區段類型、出口獎勵
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

const bossOf = (kind) => BOSS_DEFS.find((b) => b.kind === kind) || BOSS_DEFS[0];

// 出擊：level＝敵人強度的基準（每兩個區段 +1）；segs 依序進行：
// pool＝這一段可能的區段類型（出口各自預告一種；只有一種時各出口類型相同、獎勵不同）、border＝主題交界的區段、
// variants＝限定的主題變體（Boss 要開闊的場地）
export const SORTIES = {
  c1s1: {
    name: '南部荒野 — 礦坑突破',
    chapter: 1,
    level: 2,
    reward: 30000,
    segs: [
      { theme: 'wasteland', pool: ['battle'] },
      { theme: 'wasteland', pool: ['battle', 'destroy', 'defend', 'intel'] },
      { theme: 'wasteland', pool: ['supply', 'escort', 'breakthrough'] },
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
