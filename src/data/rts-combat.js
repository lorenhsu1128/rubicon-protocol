// Coral 戰爭（RTS，docs/rts-design.md 13.2、13.3）的戰鬥數值（純資料與純函式）：攻擊／護甲類型的相剋表、
// 護甲換算（照魔獸3）、研究（RTS_RESEARCH）與數值層（rtsMods）的合併。
// 不 import rts-units.js（rts-units.js 會 import 這裡）。
//
// 攻擊類型 atk：kin 實彈、pierce 穿甲、exp 爆發（攻城）、en 能量、hero 英雄、none（環境傷害：不看相剋與護甲）
// 護甲類型 arm：none 無（工人）、light 輕、med 中、heavy 重、fort 城甲（建築）、hero 英雄
export const RTS_ATKS = ['kin', 'pierce', 'exp', 'en', 'hero'];
export const RTS_ARMS = ['none', 'light', 'med', 'heavy', 'fort', 'hero'];
export const RTS_ATK_NAME = { kin: '實彈', pierce: '穿甲', exp: '爆發', en: '能量', hero: '英雄', none: '—' };
export const RTS_ARM_NAME = {
  none: '無',
  light: '輕甲',
  med: '中甲',
  heavy: '重甲',
  fort: '城甲',
  hero: '英雄甲',
};
// 相剋表 RTS_TYPE_K[atk][arm]
export const RTS_TYPE_K = {
  kin: { none: 1, light: 1, med: 1.5, heavy: 1, fort: 0.7, hero: 1 },
  pierce: { none: 1.25, light: 0.75, med: 1, heavy: 1.75, fort: 0.5, hero: 0.75 },
  exp: { none: 1.25, light: 1.25, med: 0.75, heavy: 0.75, fort: 1.5, hero: 0.5 },
  en: { none: 1, light: 1.25, med: 1, heavy: 1.25, fort: 0.5, hero: 0.75 },
  hero: { none: 1, light: 1, med: 1, heavy: 1, fort: 0.5, hero: 1 },
};
// 護甲的減傷倍率（照魔獸3）：5 點＝0.77（−23%）、10 點＝0.625；負的護甲加傷
export function armorK(A) {
  A = A || 0;
  return A >= 0 ? 1 - (0.06 * A) / (1 + 0.06 * A) : 2 - Math.pow(0.94, -A);
}
// 一次命中的倍率：相剋 × 護甲（atk 'none'＝1）
export function typeK(atk, arm) {
  if (!atk || atk === 'none') return 1;
  const row = RTS_TYPE_K[atk] || RTS_TYPE_K.kin;
  const k = row[arm || 'med'];
  return k === undefined ? 1 : k;
}
// 顯示與失衡用的屬性（data/attrs.js 的 kin／exp／en）
export const atkAttr = (atk) => (atk === 'exp' ? 'exp' : atk === 'en' ? 'en' : 'kin');
// 沒有定義 atk 的來源（一般的投射物、爆炸、地形傷害）：依屬性推算
export const attrAtk = (attr) =>
  attr === 'exp' ? 'exp' : attr === 'en' ? 'en' : attr === 'none' ? 'none' : 'kin';

// ---------- 數值層（docs 13.3「數值層」） ----------
// e.rtsMods = { up, hero, item, aura, buff: [] }；每層是部分的 { 欄位: 值 }，buff 是 [{ src, t（到期的局內時間）, ...欄位 }]
// 倍率欄位（相乘、預設 1）：dmg 傷害、rof 射速（>1 較快）、speed 移動、taken 受到的傷害、imp 受到的衝擊（失衡值）、
//   hpK 最大血量、splash 範圍半徑、skill 技能傷害（R3：C 包的 rtsHeroDmg／rtsHeroSplash 再乘施放者的 rtsM.skill）
// 加算欄位（相加、預設 0）：armor 護甲、range 射程（m）、sight 視野（m）、regen 每秒回復 AP、hp 最大血量
export const MOD_MUL = ['dmg', 'rof', 'speed', 'taken', 'imp', 'hpK', 'splash', 'skill'];
export const MOD_ADD = ['armor', 'range', 'sight', 'regen', 'hp'];
export const MOD_LAYERS = ['up', 'hero', 'item', 'aura'];
export function emptyMods() {
  return { up: {}, hero: {}, item: {}, aura: {}, buff: [] };
}
// 合併成一個 { 欄位: 值 }；now＝局內時間（過期的 buff 略過）
export function mergeMods(M, now = 0) {
  const o = {};
  for (const k of MOD_MUL) o[k] = 1;
  for (const k of MOD_ADD) o[k] = 0;
  const add = (L) => {
    if (!L) return;
    for (const k of MOD_MUL) if (L[k] !== undefined) o[k] *= L[k];
    for (const k of MOD_ADD) if (L[k] !== undefined) o[k] += L[k];
  };
  if (!M) return o;
  for (const k of MOD_LAYERS) add(M[k]);
  for (const b of M.buff || []) if (!(b.t !== undefined && b.t <= now)) add(b);
  return o;
}

// ---------- 研究（工程研究所；docs 13.2） ----------
// lv：每一級 { cost, time, tier }；mods(D, lv, e)＝這一級（累計 lv 級）對實體的效果（部分的數值層 up；D＝實體的定義）；
// 沒有 mods 的研究是旗標（B 包的技能、行為讀 rtsResLv）
const L3 = (c, t) =>
  c.map((cost, i) => ({ cost: { ore: cost[0], coral: cost[1] }, time: t[i], tier: i + 1 }));
const isBldD = (D) => D && D.kind === 'bld';
const atkOf = (D) => (D && D.atk) || 'kin';
export const RTS_RESEARCH = {
  r_kin: {
    name: '實彈武器',
    desc: '實彈、穿甲攻擊的單位與防禦塔傷害 +10%／級',
    lv: L3(
      [
        [100, 50],
        [175, 125],
        [250, 200],
      ],
      [40, 55, 70],
    ),
    mods: (D, n) => (['kin', 'pierce'].includes(atkOf(D)) && !(D && D.hero) ? { dmg: 1 + 0.1 * n } : null),
  },
  r_exp: {
    name: '爆發武器',
    desc: '爆發攻擊 +10%／級、範圍 +5%／級',
    lv: L3(
      [
        [100, 50],
        [175, 125],
        [250, 200],
      ],
      [40, 55, 70],
    ),
    mods: (D, n) =>
      atkOf(D) === 'exp' && !(D && D.hero) ? { dmg: 1 + 0.1 * n, splash: 1 + 0.05 * n } : null,
  },
  r_arm: {
    name: '複合裝甲',
    desc: '單位護甲 +2／級（不含建築與英雄）',
    lv: L3(
      [
        [125, 50],
        [200, 125],
        [275, 200],
      ],
      [40, 55, 70],
    ),
    mods: (D, n) => (D && D.kind === 'unit' && !D.hero ? { armor: 2 * n } : null),
  },
  r_fort: {
    name: '要塞化',
    desc: '建築護甲 +3、血量 +20%；防禦塔射程 +4；主堡（T2 起）可以開火',
    lv: [{ cost: { ore: 150, coral: 100 }, time: 50, tier: 2 }],
    mods: (D) => (isBldD(D) ? { armor: 3, hpK: 1.2, range: D.range ? 4 : 0 } : null),
  },
  r_militia: {
    name: '民兵訓練',
    desc: '動員時間 45 → 60 秒、民兵傷害 +30%',
    lv: [{ cost: { ore: 75, coral: 25 }, time: 30, tier: 1 }],
    mods: (D) => (D && D.militia ? { dmg: 1.3 } : null),
  },
  r_wall: {
    name: '盾牆',
    desc: '盾牌 MT 學會「盾牆」',
    lv: [{ cost: { ore: 125, coral: 75 }, time: 45, tier: 2 }],
  },
  r_shell: {
    name: '榴彈改良',
    desc: '迫擊砲 MT、起重機砲台的範圍 +30%',
    lv: [{ cost: { ore: 150, coral: 75 }, time: 45, tier: 2 }],
    mods: (D) => (D && (D.id === 'c_mortar' || D.id === 'c_tower') ? { splash: 1.3 } : null),
  },
  r_barrel: {
    name: '長程砲管',
    desc: '自走砲射程 +12',
    lv: [{ cost: { ore: 200, coral: 150 }, time: 60, tier: 3 }],
    mods: (D) => (D && D.id === 'c_arty' ? { range: 12 } : null),
  },
  r_stomp: {
    name: '重踏強化',
    desc: '重踏機甲的「踏地」暈眩 1.5 秒',
    lv: [{ cost: { ore: 175, coral: 100 }, time: 50, tier: 3 }],
  },
};
for (const id in RTS_RESEARCH) RTS_RESEARCH[id].id = id;
// 某一隊的研究對實體的數值層 up（res＝{ 研究 id: 級數 }）
export function researchMods(res, D) {
  const o = {};
  for (const id in res || {}) {
    const n = res[id];
    const R = RTS_RESEARCH[id];
    if (!n || !R || !R.mods) continue;
    const m = R.mods(D, n);
    if (!m) continue;
    for (const k of MOD_MUL) if (m[k] !== undefined) o[k] = (o[k] === undefined ? 1 : o[k]) * m[k];
    for (const k of MOD_ADD) if (m[k]) o[k] = (o[k] || 0) + m[k];
  }
  return o;
}
