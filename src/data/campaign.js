// 主線任務模式的資料（設計見 docs/campaign-design.md）：出擊、主題的轉場方式、轉場演出、出口獎勵
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

// 轉場演出：依串接方式（之後各主題再細分）
export const TRANSITIONS = {
  drop: { title: '運輸機空降', sub: '投放至作戰區域' },
  relay: [
    { title: '運輸機吊掛移動', sub: '前往下一個作戰區域' },
    { title: '穿越公路隧道', sub: '沿公路推進' },
  ],
  down: [
    { title: '升降梯下降', sub: '深入地下' },
    { title: '豎井跳降', sub: '沿豎井往下' },
  ],
  up: [{ title: '軌道電梯上升', sub: '前往高空' }],
};

// 出口獎勵（下一個區段清除後發放）
export const EXIT_REWARDS = {
  coam: { name: '資金', icon: '¥', color: '#ffc040', desc: 'COAM 報酬' },
  repair: { name: '修理', icon: '✚', color: '#7ee081', desc: '回復 AP 35%、補給彈藥 35%' },
  xp: { name: '經驗', icon: '★', color: '#7fc8ff', desc: '駕駛員經驗' },
};

// 區段類型（第 1 期：戰鬥與 Boss）
export const SEG_TYPES = {
  battle: { name: '戰鬥' },
  boss: { name: 'Boss' },
};

const bossOf = (kind) => BOSS_DEFS.find((b) => b.kind === kind) || BOSS_DEFS[0];

// 出擊：level＝敵人強度的基準（每兩個區段 +1）；segs 依序進行，最後一段通常是 Boss
export const SORTIES = {
  c1s1: {
    name: '南部荒野 — 礦坑突破',
    chapter: 1,
    level: 2,
    reward: 30000,
    segs: [
      { theme: 'wasteland', type: 'battle' },
      { theme: 'wasteland', type: 'battle' },
      { theme: 'wasteland', type: 'battle' },
      { theme: 'desert', type: 'battle' },
      { theme: 'desert', type: 'boss', boss: 'artillery' },
    ],
  },
};
export const SORTIE_DEFAULT = 'c1s1';

export function sortieBoss(seg) {
  return seg && seg.type === 'boss' ? bossOf(seg.boss) : null;
}
// 兩個區段之間的轉場方式：換到垂直主題時用下降，同主題依該主題
export function transMode(fromTheme, toTheme) {
  const m = THEME_MODE[toTheme] || 'relay';
  if (m === 'mixed') return fromTheme === toTheme ? 'down' : 'relay';
  if (m === 'down' || m === 'up') return m;
  return 'relay';
}
