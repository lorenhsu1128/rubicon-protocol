// Coral 戰爭（RTS）的道具與商店（docs/rts-design.md 13.5、13.14；C 包）。
// 不可 import rts-units.js。道具的效果在 game/rts-hero.js（rtsItemUse、永久道具的數值層 item、光環）。
//
// RTS_ITEMS[id]：{ id, name, short（背包格的縮寫）, tier 1～3, cost: { ore, coral }, kind 'use'｜'perm', charges（消耗品的次數）,
//   cd（使用的冷卻秒）, target（'point'＝要選地點；其他＝立刻使用）, mods（永久道具的數值層 item；同名不疊加）,
//   aura（永久道具的光環：{ r, ...數值層 }）, drop（只掉落，商店不賣）, desc }
export const RTS_ITEMS = {
  i_kit: {
    name: '修復套件',
    short: '修',
    tier: 1,
    cost: { ore: 50, coral: 0 },
    kind: 'use',
    charges: 2,
    cd: 6,
    heal: 350,
    t: 5,
    desc: '5 秒內回復 350 AP（受傷中斷）；2 次',
  },
  i_scout: {
    name: '偵察無人機',
    short: '偵',
    tier: 1,
    cost: { ore: 40, coral: 0 },
    kind: 'use',
    charges: 1,
    cd: 2,
    target: 'point',
    range: 120,
    r: 25,
    t: 30,
    desc: '指定地點 25 m 揭露 30 秒',
  },
  i_smoke: {
    name: '煙幕彈',
    short: '煙',
    tier: 1,
    cost: { ore: 60, coral: 0 },
    kind: 'use',
    charges: 2,
    cd: 8,
    r: 10,
    t: 8,
    taken: 0.7,
    desc: '腳下 10 m 煙幕 8 秒：裡面的友軍不能被鎖定、受到的傷害 −30%；2 次',
  },
  i_beacon: {
    name: '回城信標',
    short: '回',
    tier: 1,
    cost: { ore: 120, coral: 0 },
    kind: 'use',
    charges: 1,
    cd: 2,
    t: 3,
    desc: '3 秒後傳送到最近的主堡（受傷中斷）',
  },
  i_barrier: {
    name: '緊急障壁',
    short: '障',
    tier: 2,
    cost: { ore: 100, coral: 25 },
    kind: 'use',
    charges: 1,
    cd: 2,
    absorb: 300,
    t: 10,
    desc: '10 秒內吸收 300 傷害',
  },
  i_fcs: {
    name: '強化火控',
    short: '火',
    tier: 2,
    cost: { ore: 150, coral: 50 },
    kind: 'perm',
    mods: { dmg: 1.1 },
    desc: '傷害 +10%',
  },
  i_plate: {
    name: '追加裝甲',
    short: '甲',
    tier: 2,
    cost: { ore: 175, coral: 25 },
    kind: 'perm',
    mods: { armor: 3 },
    desc: '護甲 +3',
  },
  i_boost: {
    name: '高出力推進器',
    short: '推',
    tier: 2,
    cost: { ore: 125, coral: 50 },
    kind: 'perm',
    mods: { speed: 1.12 },
    desc: '移動速度 +12%',
  },
  i_cooler: {
    name: '散熱器',
    short: '冷',
    tier: 2,
    cost: { ore: 150, coral: 50 },
    kind: 'perm',
    mods: { rof: 1.15 },
    desc: '射速 +15%',
  },
  i_repair: {
    name: '修理模組',
    short: '理',
    tier: 2,
    cost: { ore: 160, coral: 40 },
    kind: 'perm',
    mods: { regen: 3 },
    desc: '每秒回復 3 AP',
  },
  i_scope: {
    name: '遠距照準',
    short: '照',
    tier: 3,
    cost: { ore: 200, coral: 100 },
    kind: 'perm',
    mods: { range: 4, sight: 6 },
    desc: '射程 +4、視野 +6',
  },
  i_antenna: {
    name: '指揮天線',
    short: '天',
    tier: 3,
    cost: { ore: 225, coral: 75 },
    kind: 'perm',
    aura: { r: 25, armor: 1, dmg: 1.05 },
    desc: '光環：25 m 內友軍護甲 +1、傷害 +5%',
  },
  i_stab: {
    name: 'ACS 穩定器',
    short: '穩',
    tier: 3,
    cost: { ore: 0, coral: 0 },
    kind: 'perm',
    drop: true,
    stab: 20,
    desc: '每 20 秒抵消一次失衡與暈眩（只掉落）',
  },
  i_coralcore: {
    name: 'Coral 共振核',
    short: '核',
    tier: 3,
    cost: { ore: 0, coral: 0 },
    kind: 'perm',
    drop: true,
    coralK: 0.75,
    desc: '技能的 Coral 費用 −25%（只掉落）',
  },
  i_contract: {
    name: '傭兵合約',
    short: '約',
    tier: 2,
    cost: { ore: 0, coral: 0 },
    kind: 'use',
    charges: 1,
    cd: 2,
    drop: true,
    t: 60,
    desc: '在英雄旁邊召喚一台這張地圖的傭兵，60 秒（只掉落）',
  },
};
for (const id in RTS_ITEMS) RTS_ITEMS[id].id = id;

// 可以購買的道具（依階）；商店的貨架順序
const BUY = Object.keys(RTS_ITEMS).filter((id) => !RTS_ITEMS[id].drop);
// 補給商店的貨架（依主堡的層級：T1 賣 1 階、T2 起加 2 階、T3 起加 3 階）、中立商店的庫存（依階）與補貨秒數
export const RTS_SHOP = {
  tiers: [1, 2, 3].map((t) => BUY.filter((id) => RTS_ITEMS[id].tier === t)),
  stock: [3, 2, 1],
  restock: [60, 90, 120],
  r: 12, // 英雄離商店幾公尺內可以買、賣
  sellK: 0.5, // 賣出退還的比例
};
export const RTS_SHOP_ITEMS = BUY;
// 掉寶表（D 包的營地掉落用）：各階可以掉的道具（含只掉落的）
export const RTS_LOOT = [1, 2, 3].map((t) => Object.keys(RTS_ITEMS).filter((id) => RTS_ITEMS[id].tier === t));

// 商店的卡片（3×4 格依序，act { k: 'buy', item }）：補給商店（c_market）與中立商店共用；
// req：補給商店的層級（中立商店不看，HUD 依 Game.rtsShopWhy 灰掉）
const KEYS = [
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];
const costTxt = (c) => `礦石 ${c.ore || 0}${c.coral ? '、Coral ' + c.coral : ''}`;
export function shopCard(list = BUY, tierReq = true) {
  return list.slice(0, 12).map((id, i) => {
    const I = RTS_ITEMS[id];
    const at = [Math.floor(i / 4), i % 4];
    return {
      at,
      key: KEYS[at[0]][at[1]],
      name: I.name,
      tip: `${I.desc}（${costTxt(I.cost)}）`,
      act: { k: 'buy', item: id },
      ...(tierReq && I.tier > 1 ? { req: { tier: I.tier } } : {}),
    };
  });
}
export const RTS_SHOP_CARD = shopCard(BUY, true);
