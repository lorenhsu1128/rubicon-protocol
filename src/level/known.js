// 自訂關卡可以用的東西（主題、變體、物件、單位）：讀檔驗證、編輯器的選單、執行時共用
import { AC_ROSTER, BOSS_DEFS, ENEMY_TYPES } from '../data/enemies.js';
import { ACES, FOES } from '../data/foes.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES } from '../world/world.js';
import { sanitizeLevel } from './format.js';
import { placeIds } from './placeables.js';

const enemyName = (k) => {
  const d = ENEMY_TYPES[k] || FOES[k];
  if (!d) return k;
  if (d.roster) return '敵對 AC：' + ((AC_ROSTER[d.roster] || {}).name || d.roster);
  if (k === 'ac') return '敵對 AC（隨機）';
  return d.name || k;
};
let UT = null;
// 各種類的單位：[{ id, name, note }]
export function unitTypes(kind) {
  if (!UT) {
    UT = {
      enemy: [
        ...Object.keys(ENEMY_TYPES).map((k) => ({ id: k, name: enemyName(k), note: '一般敵人' })),
        ...Object.keys(FOES)
          .filter((k) => !FOES[k].spawnOnly || k === 'chimera')
          .map((k) => ({
            id: k,
            name: FOES[k].name,
            note: '主題專屬：' + ((THEMES[FOES[k].theme] || {}).name || ''),
          })),
      ],
      ace: Object.keys(ACES).map((k) => ({ id: k, name: ACES[k].name, note: '宿敵 AC' })),
      boss: BOSS_DEFS.map((b, i) => ({
        id: String(i),
        name: b.name,
        note: 'Boss' + (b.rail ? '（需要鐵路）' : ''),
      })),
      ally: Object.keys(AC_ROSTER).map((k) => ({ id: k, name: AC_ROSTER[k].name, note: '友軍 AC' })),
      convoy: [{ id: 'convoy', name: '護送車輛', note: '沿路徑前進' }],
      // 地圖上的小人（game/crowd.js）：不算敵人、不擋勝負
      human: [
        { id: 'civ', name: '平民', note: '主題的人物，靠近會逃' },
        { id: 'soldier', name: '敵方步兵', note: '對玩家開槍' },
        { id: 'rocket', name: '敵方步兵（火箭筒）', note: '火箭筒' },
        { id: 'pilot', name: '駕駛員（拿槍）', note: '站著開槍、不逃' },
      ],
    };
  }
  return UT[kind] || [];
}
export function unitName(kind, type) {
  const t = unitTypes(kind).find((x) => x.id === type);
  return t ? t.name : type;
}
let KN = null;
export function knownSets() {
  if (KN) return KN;
  const ok = {};
  for (const k of ['enemy', 'ace', 'boss', 'ally', 'convoy', 'human'])
    ok[k] = new Set(unitTypes(k).map((t) => t.id));
  KN = {
    themes: new Set(Object.keys(THEMES)),
    props: placeIds(),
    units: (kind, type) => !!(ok[kind] && ok[kind].has(type)),
    variants: (theme, key) => !key || !!(VARIANTS[theme] || {})[key],
  };
  return KN;
}
export function loadLevel(raw, warn) {
  return sanitizeLevel(raw, knownSets(), warn || []);
}
