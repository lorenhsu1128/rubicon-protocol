// Coral 戰爭（RTS）的中立（docs/rts-design.md 13.6、13.15；D 包）：野怪、營地編成、掉寶、傭兵、中立建築。
// 不可 import rts-units.js（rts-units.js 在檔尾把 RTS_CREEP_DEFS、RTS_NEUTRAL_DEFS 併進 RTS_DEFS）。
//
// RTS_CREEP_DEFS[id]：kind 'unit'、creep: true（野怪）或 merc: true（傭兵：屬於雇用的隊伍）、faction 'neutral'、name、
//   asm／modelKind／vehKey（照 ENEMY_TYPES／FOES 的原型；etype＝原型的鍵，效能基準在一般任務裡生成用）、atk、arm、armor、
//   hp、dps、range、rof、speed、sight、lv、slots；數值照 13.6：lv 1 血量 450／dps 10，每多 1 lv 血量 +300／dps +6
//   （具名 AC：血量 2600、dps 40、英雄甲）。傭兵另有 cost、pop（卡片在 game/rts-neutral.js 載入時補上 RTS_UNIT_CARD）。
// RTS_NEUTRAL_DEFS[id]：kind 'bld'、faction 'neutral'、inv: true（打不壞、noLock）、name、foot、height、sight、
//   buildModel(pal)（render/rts-neutral-models.js）、card；n_tavern 酒館、n_shop 中立商店、n_merc 傭兵營
import { AC_ROSTER } from './enemies.js';
import { ACES } from './foes.js';
import { RTS_HERO_DEFS, RTS_TAVERN } from './rts-heroes.js';
import { RTS_ITEMS, RTS_SHOP_ITEMS, shopCard } from './rts-items.js';
import { RTS_NEUTRAL_FOOT } from '../world/rts-map.js';
import { buildMercCamp, buildNeutralShop, buildTavern } from '../render/rts-neutral-models.js';

const BASE = { booster: 'b_std', generator: 'g_std', fcs: 'f_std' };
const NONE = { rarm: 'w_none', larm: 'w_none', rback: 'bw_none', lback: 'bw_none' };
const LIGHT = { head: 'h_lt', core: 'c_lt', arms: 'a_lt', legs: 'l_bp', ...BASE, ...NONE };
const HEAVY = { head: 'h_hv', core: 'c_hv', arms: 'a_hv', legs: 'l_tk', ...BASE, ...NONE };
// 野怪的數值（依 lv）
const byLv = (lv) => ({ lv, hp: 450 + 300 * (lv - 1), dps: 10 + 6 * (lv - 1) });
const creep = (o) => ({
  kind: 'unit',
  creep: true,
  faction: 'neutral',
  cost: { ore: 0, coral: 0 },
  time: 0,
  pop: 0,
  size: 1,
  scale: 1,
  radius: 1.3,
  speed: 6.5,
  sight: 26,
  rof: 0.25,
  ...byLv(o.lv),
  ...o,
});

// ---------- 野怪 ----------
export const RTS_CREEP_DEFS = {
  cr_mt: creep({
    name: '流浪 MT',
    desc: '野怪：機槍，地空都打',
    etype: 'mt',
    lv: 2,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    aa: 'both',
    range: 24,
    rof: 0.2,
    speed: 7,
    scale: 0.85,
    radius: 1.2,
    asm: { ...LIGHT, rarm: 'w_mg' },
  }),
  cr_scout: creep({
    name: '偵察機',
    desc: '野怪：輕型的雷射偵察機',
    etype: 'drone',
    lv: 1,
    atk: 'en',
    arm: 'light',
    armor: 0,
    range: 24,
    rof: 0.4,
    speed: 8,
    scale: 0.6,
    radius: 1,
    asm: { ...LIGHT, legs: 'l_qd', booster: 'b_hi', rarm: 'w_lr' },
  }),
  cr_scav: creep({
    name: '拾荒 MT',
    desc: '野怪：輕裝的拼裝機體',
    etype: 'scav',
    lv: 2,
    atk: 'kin',
    arm: 'light',
    armor: 0,
    range: 20,
    rof: 0.25,
    speed: 7.5,
    scale: 0.85,
    radius: 1.2,
    asm: { ...LIGHT, rarm: 'w_mg' },
  }),
  cr_junk: creep({
    name: '廢鐵合成體',
    desc: '野怪：廢鐵外殼，慢、耐打',
    etype: 'junk',
    lv: 3,
    atk: 'kin',
    arm: 'heavy',
    armor: 3,
    range: 20,
    rof: 0.25,
    speed: 4.5,
    radius: 2.4,
    modelKind: 'boss',
    vehKey: 'junk',
    asm: { ...HEAVY, rarm: 'w_mg' },
  }),
  cr_harpoon: creep({
    name: '魚叉拖車',
    desc: '野怪：拖車上的重機槍',
    etype: 'harpoon',
    lv: 3,
    atk: 'kin',
    arm: 'heavy',
    armor: 2,
    range: 22,
    rof: 0.25,
    speed: 5.5,
    radius: 1.9,
    modelKind: 'boss',
    vehKey: 'harpoon',
    asm: { ...HEAVY, rarm: 'w_mg' },
  }),
  cr_smoker: creep({
    name: '煙幕投射車',
    desc: '野怪：輕武裝的投射車',
    etype: 'smoker',
    lv: 2,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    range: 24,
    rof: 0.25,
    speed: 5.5,
    radius: 1.7,
    modelKind: 'boss',
    vehKey: 'smoker',
    asm: { ...HEAVY, rarm: 'w_mg' },
  }),
  cr_mth: creep({
    name: 'MT 重型',
    desc: '野怪：火箭筒（穿甲）',
    etype: 'mth',
    lv: 4,
    atk: 'pierce',
    arm: 'heavy',
    armor: 2,
    range: 28,
    rof: 1.2,
    speed: 5.5,
    scale: 1.05,
    radius: 1.4,
    asm: { ...HEAVY, rarm: 'w_bz' },
  }),
  cr_mtshot: creep({
    name: 'MT 突擊型',
    desc: '野怪：近距離的霰彈',
    etype: 'mt_shot',
    lv: 3,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    range: 12,
    rof: 0.6,
    speed: 8,
    scale: 0.9,
    radius: 1.2,
    asm: { ...LIGHT, legs: 'l_bp2', booster: 'b_hi', fcs: 'f_near', rarm: 'w_sg' },
  }),
  cr_tank: creep({
    name: '裝甲車',
    desc: '野怪：火箭筒（穿甲）',
    etype: 'tank',
    lv: 4,
    atk: 'pierce',
    arm: 'heavy',
    armor: 2,
    range: 28,
    rof: 1.2,
    speed: 6.5,
    size: 2,
    scale: 0.9,
    radius: 2,
    modelKind: 'vehicle',
    asm: { ...HEAVY, rarm: 'w_bz' },
  }),
  cr_strider: creep({
    name: '步行砲台',
    desc: '野怪：背上的雷射加農砲，射程長',
    etype: 'strider',
    lv: 5,
    atk: 'en',
    arm: 'heavy',
    armor: 3,
    range: 34,
    rof: 2,
    speed: 5,
    scale: 0.9,
    radius: 1.6,
    slots: ['rback'],
    asm: {
      head: 'h_scan',
      core: 'c_std',
      arms: 'a_std',
      legs: 'l_qd',
      booster: 'b_hi',
      generator: 'g_hi',
      fcs: 'f_far',
      ...NONE,
      rback: 'bw_lc',
    },
  }),
  cr_cmd: creep({
    name: '指揮官 MT',
    desc: '野怪：步槍，營地的指揮官',
    etype: 'mt_cmd',
    lv: 4,
    atk: 'kin',
    arm: 'med',
    armor: 2,
    range: 30,
    rof: 0.4,
    speed: 6,
    scale: 1.05,
    radius: 1.3,
    asm: {
      head: 'h_scan',
      core: 'c_std',
      arms: 'a_std',
      legs: 'l_bp',
      booster: 'b_std',
      generator: 'g_hi',
      fcs: 'f_far',
      ...NONE,
      rarm: 'w_rifle',
    },
  }),
};
// ---------- R3 的主題野怪（docs 14.8、14.14）：冰原、技研都市地表；主題敵人只借模型與數值，特殊行為不做 ----------
const specimenPal = { palBase: 'specimen' };
Object.assign(RTS_CREEP_DEFS, {
  cr_lurker: creep({
    name: '雪中潛伏 MT',
    desc: '野怪：埋在雪裡的機槍 MT',
    etype: 'lurker',
    lv: 2,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    range: 20,
    rof: 0.2,
    speed: 6.5,
    radius: 1.6,
    modelKind: 'boss',
    vehKey: 'lurker',
    asm: { ...LIGHT, rarm: 'w_mg' },
  }),
  cr_skater: creep({
    name: '冰面滑行砲車',
    desc: '野怪：快速的滑行砲車',
    etype: 'skater',
    lv: 2,
    atk: 'kin',
    arm: 'light',
    armor: 0,
    range: 24,
    rof: 0.4,
    speed: 9,
    radius: 1.6,
    modelKind: 'boss',
    vehKey: 'skater',
    asm: { ...HEAVY, rarm: 'w_rifle' },
  }),
  cr_cryo: creep({
    name: '冷凍噴霧機',
    desc: '野怪：近距離的冷凍噴霧（能量）',
    etype: 'cryo',
    lv: 3,
    atk: 'en',
    arm: 'med',
    armor: 1,
    range: 14,
    rof: 0.3,
    speed: 5.5,
    radius: 1.7,
    modelKind: 'boss',
    vehKey: 'cryo',
    asm: { ...HEAVY, rarm: 'w_lr' },
  }),
  cr_icemortar: creep({
    name: '冰錐迫擊砲',
    desc: '野怪：遠距離的冰錐榴彈（範圍 3 m），最短射程 8 m',
    etype: 'icemortar',
    lv: 4,
    atk: 'exp',
    arm: 'light',
    armor: 0,
    range: 36,
    minRange: 8,
    splash: 3,
    rof: 2.2,
    speed: 4.5,
    radius: 1.8,
    modelKind: 'boss',
    vehKey: 'icemortar',
    slots: ['rback'],
    asm: { ...HEAVY, rback: 'bw_gr' },
  }),
  cr_blob: creep({
    name: '實驗體',
    desc: '野怪：啃咬的小型實驗體（不會融合）',
    etype: 'blob',
    lv: 1,
    atk: 'kin',
    arm: 'light',
    armor: 0,
    range: 2.5,
    rof: 0.5,
    melee: { r: 2.5, rof: 0.5 },
    speed: 7.5,
    radius: 0.9,
    modelKind: 'boss',
    vehKey: 'blob',
    ...specimenPal,
    asm: { ...LIGHT, rarm: 'w_sg' },
  }),
  cr_parasite: creep({
    name: '寄生纏附體',
    desc: '野怪：撲上來的寄生體',
    etype: 'parasite',
    lv: 2,
    atk: 'kin',
    arm: 'light',
    armor: 0,
    range: 3,
    rof: 0.6,
    melee: { r: 3, rof: 0.6 },
    speed: 8.5,
    radius: 1,
    modelKind: 'boss',
    vehKey: 'parasite',
    ...specimenPal,
    asm: { ...LIGHT, rarm: 'w_sg' },
  }),
  cr_holo: creep({
    name: '全像投影器',
    desc: '野怪：雷射的投影機',
    etype: 'holo',
    lv: 2,
    atk: 'en',
    arm: 'light',
    armor: 0,
    range: 22,
    rof: 0.4,
    speed: 6,
    radius: 1.2,
    modelKind: 'boss',
    vehKey: 'holoproj',
    palBase: 'whiteout',
    asm: { ...LIGHT, rarm: 'w_lr' },
  }),
  cr_chimera: creep({
    name: '嵌合體',
    desc: '野怪：融合實驗體，耐打的近戰',
    etype: 'chimera',
    lv: 5,
    atk: 'kin',
    arm: 'heavy',
    armor: 2,
    range: 3.5,
    rof: 0.9,
    melee: { r: 3.5, rof: 0.9, splash: 2.5 },
    speed: 6,
    scale: 0.85,
    radius: 2,
    size: 1,
    modelKind: 'boss',
    vehKey: 'chimera',
    ...specimenPal,
    asm: { ...HEAVY, rarm: 'w_sg' },
  }),
  cr_laserpost: creep({
    name: '保全雷射網',
    desc: '野怪：不會移動的雷射柵欄',
    etype: 'laserpost',
    lv: 3,
    atk: 'en',
    arm: 'fort',
    armor: 2,
    range: 18,
    rof: 0.3,
    speed: 0.01, // 不移動（0 會被當成沒有設定）
    radius: 1.4,
    modelKind: 'boss',
    vehKey: 'laserpost',
    asm: { ...HEAVY, rarm: 'w_lr' },
  }),
});
// 主題的具名 AC（主線的宿敵 ACES：只用射擊武器的槽；和酒館的同名英雄無關）
const themeAce = (k, o) =>
  creep({
    name: ACES[k].name,
    desc: '野怪：落單的主題 AC',
    etype: k,
    lv: 6,
    hp: 2600,
    dps: 40,
    arm: 'hero',
    armor: 3,
    range: 30,
    rof: 0.3,
    speed: 8,
    radius: 1.3,
    asm: { ...ACES[k].asm },
    ...o,
  });
RTS_CREEP_DEFS.cr_ac_whiteout = themeAce('whiteout', {
  atk: 'en',
  slots: ['rarm', 'larm'],
  slotAtk: { larm: 'kin' },
});
RTS_CREEP_DEFS.cr_ac_specimen = themeAce('specimen', {
  atk: 'en',
  slots: ['rarm', 'rback'],
  slotAtk: { rback: 'exp' },
});

// 大營地的落單具名 AC（AC_ROSTER；依營地的亂數挑一台，兩邊對稱的營地挑同一台）：只用射擊武器的
export const RTS_CAMP_ACES = {
  longshot: { atk: 'en', slotAtk: { larm: 'kin' } },
  rain: { atk: 'kin' },
  volker: { atk: 'pierce', slotAtk: { rarm: 'en' } },
  hornet: { atk: 'kin' },
  nightfall: { atk: 'en' },
};
for (const k in RTS_CAMP_ACES) {
  const A = AC_ROSTER[k];
  RTS_CREEP_DEFS['cr_ac_' + k] = creep({
    name: A.name,
    desc: '野怪：落單的具名 AC',
    etype: 'ac_' + k,
    lv: 6,
    hp: 2600,
    dps: 40,
    arm: 'hero',
    armor: 3,
    range: 30,
    rof: 0.3,
    speed: 8,
    radius: 1.3,
    slots: ['rarm', 'larm'],
    asm: { ...A.asm },
    ...RTS_CAMP_ACES[k],
  });
}

// ---------- 傭兵（屬於雇用的隊伍、照一般單位的指令；數值同野怪 lv 2～3） ----------
const merc = (from, o) => {
  const D = { ...RTS_CREEP_DEFS[from], ...o };
  delete D.creep;
  D.merc = true;
  return D;
};
export const RTS_MERC_DEFS = {
  m_scav: merc('cr_scav', { name: '拾荒 MT（傭兵）', cost: { ore: 120, coral: 0 }, pop: 2, time: 0 }),
  m_junk: merc('cr_junk', { name: '廢鐵合成體（傭兵）', cost: { ore: 200, coral: 30 }, pop: 3, time: 0 }),
  m_harpoon: merc('cr_harpoon', { name: '魚叉拖車（傭兵）', cost: { ore: 210, coral: 60 }, pop: 3, time: 0 }),
  m_smoker: merc('cr_smoker', {
    name: '煙幕投射車（傭兵）',
    cost: { ore: 180, coral: 80 },
    pop: 2,
    time: 0,
    ...byLv(3),
  }),
};
for (const id in RTS_MERC_DEFS)
  RTS_MERC_DEFS[id].desc = '傭兵：' + RTS_MERC_DEFS[id].desc.replace(/^野怪：/, '');
// R3 的主題傭兵（docs 14.8）：mercN＝雇用一次出現幾台（費用是合計、pop 是每台）
Object.assign(RTS_MERC_DEFS, {
  m_lurker: merc('cr_lurker', {
    name: '雪中潛伏 MT（傭兵）',
    cost: { ore: 140, coral: 20 },
    pop: 2,
    time: 0,
  }),
  m_skater: merc('cr_skater', {
    name: '冰面滑行砲車（傭兵）',
    cost: { ore: 160, coral: 30 },
    pop: 2,
    time: 0,
  }),
  m_cryo: merc('cr_cryo', { name: '冷凍噴霧機（傭兵）', cost: { ore: 200, coral: 60 }, pop: 2, time: 0 }),
  m_icemortar: merc('cr_icemortar', {
    name: '冰錐迫擊砲（傭兵）',
    cost: { ore: 220, coral: 80 },
    pop: 3,
    time: 0,
    ...byLv(3),
  }),
  m_blob: merc('cr_blob', {
    name: '實驗體（傭兵）',
    cost: { ore: 100, coral: 20 },
    pop: 1,
    mercN: 2,
    time: 0,
    ...byLv(2),
  }),
  m_parasite: merc('cr_parasite', {
    name: '寄生纏附體（傭兵）',
    cost: { ore: 150, coral: 50 },
    pop: 2,
    time: 0,
  }),
  m_holo: merc('cr_holo', { name: '全像投影器（傭兵）', cost: { ore: 180, coral: 70 }, pop: 2, time: 0 }),
  m_chimera: merc('cr_chimera', {
    name: '嵌合體（傭兵）',
    cost: { ore: 320, coral: 90 },
    pop: 3,
    time: 0,
    ...byLv(4),
  }),
});
for (const id of [
  'm_lurker',
  'm_skater',
  'm_cryo',
  'm_icemortar',
  'm_blob',
  'm_parasite',
  'm_holo',
  'm_chimera',
])
  RTS_MERC_DEFS[id].desc = '傭兵：' + RTS_MERC_DEFS[id].desc.replace(/^野怪：/, '');
Object.assign(RTS_CREEP_DEFS, RTS_MERC_DEFS);
// 各主題的傭兵（傭兵營的名單與卡片順序）與庫存規則（兩隊共用）
export const RTS_MERCS = {
  wasteland: ['m_scav', 'm_junk', 'm_harpoon', 'm_smoker'],
  snow: ['m_lurker', 'm_skater', 'm_cryo', 'm_icemortar'],
  institute: ['m_blob', 'm_parasite', 'm_holo', 'm_chimera'],
};
export const RTS_MERC_RULE = { stock: 2, restock: 60, r: 14 };
// 酒館：己方單位離酒館多近可以雇用（C 包的 RTS_HIRE.r 相同）
export const RTS_TAVERN_R = 14;

// ---------- 營地編成（RTS_CAMPS[主題][tier − 1]＝2～3 套；'@ac'＝RTS_CAMP_ACES 依營地的亂數挑一台） ----------
// lv 合計：小 5～7、中 10～13、大 17～21（13.6）
export const RTS_CAMPS = {
  wasteland: [
    [
      ['cr_mt', 'cr_mt', 'cr_scout'],
      ['cr_scav', 'cr_scav', 'cr_junk'],
      ['cr_scav', 'cr_scav', 'cr_smoker'],
    ],
    [
      ['cr_mth', 'cr_mtshot', 'cr_tank'],
      ['cr_junk', 'cr_junk', 'cr_harpoon', 'cr_smoker'],
    ],
    [
      ['cr_strider', 'cr_tank', 'cr_tank', 'cr_cmd'],
      ['@ac', 'cr_mth', 'cr_mth', 'cr_mtshot'],
    ],
  ],
  // 冰原（docs 14.8；大營地多一台，lv 合計才在 17～21）
  snow: [
    [
      ['cr_lurker', 'cr_lurker', 'cr_skater'],
      ['cr_cryo', 'cr_mt', 'cr_mt'],
    ],
    [
      ['cr_icemortar', 'cr_lurker', 'cr_lurker', 'cr_skater'],
      ['cr_cryo', 'cr_cryo', 'cr_mth'],
    ],
    [
      ['@ac', 'cr_icemortar', 'cr_lurker', 'cr_lurker', 'cr_mth'],
      ['cr_ac_whiteout', 'cr_icemortar', 'cr_skater', 'cr_skater', 'cr_cryo'],
    ],
  ],
  // 技研都市地表（野怪的實驗體不會融合：融合只看艾瑟立克的定義 id）
  institute: [
    [
      ['cr_blob', 'cr_blob', 'cr_blob', 'cr_parasite'],
      ['cr_holo', 'cr_mt', 'cr_mt'],
    ],
    [
      ['cr_chimera', 'cr_blob', 'cr_blob', 'cr_laserpost'],
      ['cr_holo', 'cr_parasite', 'cr_parasite', 'cr_mth'],
    ],
    [
      ['@ac', 'cr_chimera', 'cr_chimera', 'cr_blob'],
      ['cr_ac_specimen', 'cr_chimera', 'cr_blob', 'cr_blob', 'cr_blob', 'cr_laserpost'],
    ],
  ],
};
// 掉寶（依 tier）：p＝掉道具的機率（否則給 alt 的資源）、item＝道具的階（C 包 rts-items.js 的 RTS_LOOT：含只掉落的）、
// 資源給擊破者的隊伍（不套維持費）
export const RTS_CAMP_LOOT = [
  { p: 0.6, item: 1, alt: { ore: 75 } },
  { p: 1, item: 2, ore: 50 },
  { p: 1, item: 3, ore: 150, coral: 50 },
];
// 行為（entities/mech-rts-creep.js）：出動半徑（tier 3 較大）、追擊上限（離營地中心）、多久沒打到敵人就回營、回營時幾秒回滿
export const RTS_CREEP = { aggro: [12, 12, 16], leash: 28, giveUp: 8, healT: 4, home: 1.5 };

// ---------- 中立建築 ----------
const neutralBld = (o) => ({
  kind: 'bld',
  faction: 'neutral',
  inv: true,
  cost: { ore: 0, coral: 0 },
  time: 0,
  hp: 5000,
  arm: 'fort',
  armor: 10,
  sight: 20,
  ...o,
});
const KEYS = [
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];
const at = (i) => [Math.floor(i / 4), i % 4];
const costTxt = (c) => `礦石 ${c.ore || 0}${c.coral ? '、Coral ' + c.coral : ''}`;
export const RTS_NEUTRAL_DEFS = {
  n_tavern: neutralBld({
    name: '酒館',
    desc: '中立建築：己方單位在 14 m 內時可以雇用宿敵 AC 當英雄（全場唯一）、立刻復活陣亡的英雄（費用 ×1.5、半血）',
    foot: RTS_NEUTRAL_FOOT.tavern,
    height: 9,
    buildModel: (pal) => buildTavern(pal),
    card: [
      ...RTS_TAVERN.slice(0, 8).map((id, i) => ({
        at: at(i),
        key: KEYS[at(i)[0]][at(i)[1]],
        name: (RTS_HERO_DEFS[id] && RTS_HERO_DEFS[id].name) || id,
        tip: (RTS_HERO_DEFS[id] && (RTS_HERO_DEFS[id].role || RTS_HERO_DEFS[id].desc)) || '',
        act: { k: 'hire', hero: id },
      })),
      // 陣亡英雄的立刻復活（Z X C）由 C 包的 rtsHireCard 依隊伍產生（act { k: 'hire', revive: 英雄 id }），
      // HUD 選了酒館時用它取代這份
    ],
  }),
  n_shop: neutralBld({
    name: '中立商店',
    desc: '中立建築：賣全部可購買的道具給 12 m 內的英雄；每種有庫存（兩隊共用），賣掉後慢慢補貨',
    foot: RTS_NEUTRAL_FOOT.shop,
    height: 8,
    buildModel: (pal) => buildNeutralShop(pal),
    card: shopCard(RTS_SHOP_ITEMS, false),
  }),
  n_merc: neutralBld({
    name: '傭兵營',
    desc: '中立建築：己方單位在 14 m 內時可以雇用這張地圖的傭兵（每種庫存 2 台、60 秒補 1 台，兩隊共用）',
    foot: RTS_NEUTRAL_FOOT.merc,
    height: 6,
    buildModel: (pal) => buildMercCamp(pal),
    // 荒野的名單；開局時 game/rts-neutral.js 依主題換掉這個陣列的內容（mercCard）
    card: mercCard('wasteland'),
  }),
};
// 中立商店的貨架（全部可購買的道具，不看層級）；RTS_ITEMS 是 C 包的
export const neutralShopItems = () => RTS_SHOP_ITEMS.filter((id) => RTS_ITEMS[id]);
// 傭兵營的指令卡（依主題的名單；mercN＞1 的名稱加「×n」、人口是合計）
export function mercCard(theme) {
  return (RTS_MERCS[theme] || RTS_MERCS.wasteland).map((id, i) => {
    const D = RTS_MERC_DEFS[id];
    const n = D.mercN || 1;
    return {
      at: at(i),
      key: KEYS[at(i)[0]][at(i)[1]],
      name: D.name.replace('（傭兵）', '') + (n > 1 ? ` ×${n}` : ''),
      tip: `${D.desc}（${costTxt(D.cost)}、人口 ${D.pop * n}${n > 1 ? `、一次 ${n} 台` : ''}）`,
      act: { k: 'hire', merc: id },
    };
  });
}
