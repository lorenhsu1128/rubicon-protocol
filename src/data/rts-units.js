// Coral 戰爭（RTS，docs/rts-design.md）的兵種、建築與陣營（純資料，數值都是暫定、好調整的表）。
// 節奏參考魔獸爭霸3：開局 500 礦石＋100 Coral、5 個工人；一場 15～20 分鐘、第一次交戰約 4～6 分鐘。
//
// 每個定義（RTS_DEFS[id]）：
//   kind 'unit'｜'bld'、faction、name、desc、cost { ore, coral }、time（生產／建造秒數）、pop（人口）、hp、sight（視野 m）、
//   tier（層級 1～3，只是顯示；實際的需求看 req）、req（需求：{ tier, blds: [建築 id], res: [研究 id] }，
//         陣列＝{ blds }；Game.rtsReqWhy 檢查，'c_hq' 也接受升級過的 c_hq2／c_hq3）、
//   atk（攻擊類型：kin／pierce／exp／en／hero，data/rts-combat.js）、arm（護甲類型：none／light／med／heavy／fort／hero）、
//   armor（護甲點數）、lv（單位等級：英雄擊破的經驗）、
//   單位：size（world/nav.js 的尺寸 0／1／2）、speed（m/s）、scale（模型縮放）、radius（碰撞）、asm（組裝，
//         data/parts.js 的零件 id）、ai（MechEntity 的 ai：'shield' 會掛上 mech-special.js 的正面大盾）、
//         modelKind／vehKey／flying／hoverH（照 ENEMY_TYPES 的同名欄位，rtsSpawn 轉給 MechEntity）、
//         range（攻擊距離 m，比武器射程短，讓交戰集中）、minRange（最短射程）、splash（範圍半徑 m）、
//         rof（兩發之間的最短秒數：控制子彈數量）、dps（目標每秒傷害：開局時依 slots 換算各武器槽的傷害倍率）、
//         slots（RTS 指揮時開火的武器槽，預設 ['rarm']）、slotDps（{ 槽: dps } 另外指定某個槽的 dps，不算進 dps）、
//         slotAtk（{ 槽: atk } 某個槽的攻擊類型）、aa（'both' 地空都打、'air' 只打空中，沒有＝只打地面）、
//         slotAa（{ 槽: aa } 某個槽的對空設定）、abil（技能 id，RTS_ABILS）、worker（工人：採集、建造、修理）、
//         militia（動員的民兵：rts.js 的 rtsMilitia 換過去）
//   建築：foot [w, d]（佔地 m，原點在底面中心）、height（模型高度 m）、popCap（提供的人口上限）、dropoff（資源回收點）、
//         trains（可以生產的單位）、heroes（可以生產／復活英雄：主堡）、upTo（原地升級成哪個建築）、from（從哪個升級來）、
//         on 'coral'（只能蓋在 Coral 湧出點上）、coralRate（每秒產出的 Coral）、research（可以研究的 RTS_RESEARCH id）、
//         range／minRange／dps／splash／atk／aa（防禦塔：B 包的 rtsTowerAI）、fortGun（研究「要塞化」後主堡的攻擊）、
//         inv（中立建築：打不壞）、buildModel(pal)（模型；沒有時用 render/rts-models.js 的 buildRtsBuilding）
//   card：指令卡 3×4 格 [{ at: [列, 行], key, alt?, name, tip, act, req? }]；key 預設為位置對應的鍵（CARD_KEYS），
//         act：{ k: 'order', o: 指令, target: 'point'｜'unit'｜'any'｜null } 下指令（需要目標的由輸入端選點）、
//              { k: 'train', id } 生產、{ k: 'build', id } 工人建造（選位置）、{ k: 'menu', menu } 換指令卡、
//              { k: 'back' } 回上一層、{ k: 'rally' } 設集結點（選點）、{ k: 'cancel' } 取消佇列的最後一項、
//              R2（docs 13.3）：{ k: 'upgrade', to }、{ k: 'research', id }、{ k: 'ability', ab, target }、
//              { k: 'hero', id }（生產或復活）、{ k: 'learn' }、{ k: 'pilot' }、{ k: 'loop' }、{ k: 'buy', item }、
//              { k: 'hire', hero｜merc }、{ k: 'militia' }、{ k: 'demob' }
//         卡片的 req（同定義的 req）：不符合時灰掉（例：盾牆要研究 r_wall）
import { RTS_RESEARCH } from './rts-combat.js';
import { RTS_AETH_ABILS, RTS_AETH_DEFS, RTS_AETH_FACTION, RTS_AETH_RESEARCH } from './rts-aetheric.js';
import { RTS_VEER_ABILS, RTS_VEER_DEFS, RTS_VEER_FACTION, RTS_VEER_RESEARCH } from './rts-veerwell.js';
import { RTS_SANC_ABILS, RTS_SANC_DEFS, RTS_SANC_FACTION, RTS_SANC_RESEARCH } from './rts-sancta.js';
import { RTS_HERO_DEFS } from './rts-heroes.js';
import { RTS_CREEP_DEFS, RTS_NEUTRAL_DEFS } from './rts-neutral.js';

export const RTS_POP_MAX = 150; // 人口上限
export const RTS_UPKEEP = [
  // 維持費（照魔獸3）：人口在這個範圍內時礦石收入的倍率（Coral 不受影響）
  { max: 60, k: 1, name: '無維持費' },
  { max: 100, k: 0.7, name: '低維持費' },
  { max: 150, k: 0.4, name: '高維持費' },
];
export const RTS_START = { ore: 500, coral: 100, workers: 5 };
export const RTS_QUEUE_MAX = 5; // 生產佇列
export const RTS_SEL_MAX = 24; // 一次最多選幾個單位
export const RTS_GATHER = {
  trip: 10, // 每趟帶回的礦石（定義沒有 trip 時的預設值；艾瑟立克的研究作業機 8）
  time: 2, // 採一趟的秒數
  drop: 0.5, // 在主堡卸貨的秒數
  sat: 5, // 一座礦脈同時採集的工人數（超過的排隊或換礦）
  reach: 1.8, // 工人離礦脈表面多近開始採
  mineR: 4, // 礦脈的半徑（m）
};
export const RTS_REPAIR = { costK: 0.35, timeK: 1.5 }; // 修理：補滿血量要花建造成本的 35%、建造時間的 1.5 倍
export const RTS_BUILD_ASSIST = 0.5; // 多個工人一起蓋：每多一個工人速度 +50%
export const RTS_HERO_MAX = 3; // 一隊最多幾位英雄
export const RTS_HERO_COST = { ore: 425, coral: 100 }; // 第 2、3 位英雄（第 1 位免費）
export const RTS_MILITIA = { r: 45, t: 45, t2: 60 }; // 動員：主堡多遠內的工人、持續秒數（研究民兵訓練後 t2）
export const RTS_NEUTRAL = 2; // 中立隊伍的編號（R.teams[2]）
// R6（docs 17.6）：沒有蓋好的主堡時，倒數 t 秒後對其他隊伍揭露全部建築與單位的位置（只標位置、不給視野）
export const RTS_REVEAL = { t: 120 };
// R6（docs 17.6）：結果畫面的時間軸，每 dt 秒取樣一次兩隊（超過 max 筆時間隔加倍、去掉一半）
export const RTS_TIMELINE = { dt: 30, max: 120 };
export const CARD_KEYS = [
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];

// ---------- 技能（B 包實作行為：entities/mech-rts.js；指令 { k: 'ability', ab, x, z, id }） ----------
// target：'point' 地點、'unit' 單位、'self' 自己（切換）；range（m）、coral（Coral 費用，隊伍扣）、cd（冷卻秒，記在
// e.rtsCd[ab]）、auto（可以右鍵切換自動施放，記在 e.rtsAuto[ab]）、req（需要的研究）
export const RTS_ABILS = {
  ab_wall: {
    name: '盾牆',
    target: 'self',
    coral: 0,
    cd: 2,
    req: { res: ['r_wall'] },
    desc: '不能移動；正面範圍 ±110°、正面傷害 ×0.12；身後 6 m 的友軍受到的遠程傷害 −30%',
  },
  ab_crate: {
    name: '投擲貨櫃',
    target: 'point',
    range: 24,
    coral: 0,
    cd: 12,
    desc: '1 秒後落地，範圍 4 m 90 爆發＋衝擊；之後 20 秒沒有貨櫃盾',
  },
  ab_cover: {
    name: '貨櫃掩體',
    target: 'point',
    range: 8,
    coral: 15,
    cd: 30,
    desc: '放下 8×2.6 m 的臨時牆（血量 800、30 秒）',
  },
  ab_flare: {
    name: '照明彈',
    target: 'point',
    range: 50,
    coral: 10,
    cd: 30,
    desc: '照亮半徑 18 m 10 秒',
  },
  ab_stomp: {
    name: '踏地',
    target: 'self',
    coral: 0,
    cd: 14,
    auto: true,
    desc: '半徑 9 m 地面衝擊波 60 爆發＋失衡（研究重踏強化後暈眩 1.5 秒）；右鍵切換自動施放',
  },
  ab_siege: {
    name: '架設／收起',
    target: 'self',
    coral: 0,
    cd: 0,
    desc: '架設 3 秒、收起 2 秒；只有架設好才能開火，架設時視野 +6',
  },
  ab_rockets: {
    name: '火箭齊射',
    target: 'point',
    range: 30,
    coral: 20,
    cd: 18,
    desc: '1 秒後沿 24 m 直線落下 8 發，每發 45 穿甲',
  },
};
for (const id in RTS_ABILS) RTS_ABILS[id].id = id;
// 艾瑟立克的技能（data/rts-aetheric.js；docs 14.3）
Object.assign(RTS_ABILS, RTS_AETH_ABILS);
// 維爾威的技能（data/rts-veerwell.js；docs 15.3）
Object.assign(RTS_ABILS, RTS_VEER_ABILS);
// 聖域的技能（data/rts-sancta.js；docs 16.3）
Object.assign(RTS_ABILS, RTS_SANC_ABILS);

// ---------- 共用的指令卡 ----------
const ORD = {
  move: {
    at: [0, 0],
    alt: 'M',
    name: '移動',
    tip: '移動到指定地點（不理會敵人）',
    act: { k: 'order', o: 'move', target: 'point' },
  },
  hold: {
    at: [0, 1],
    alt: 'H',
    name: '守住',
    tip: '原地不動，只攻擊射程內的敵人',
    act: { k: 'order', o: 'hold' },
  },
  patrol: {
    at: [0, 2],
    alt: 'P',
    name: '巡邏',
    tip: '在目前位置與指定地點之間來回，遇敵就交戰',
    act: { k: 'order', o: 'patrol', target: 'point' },
  },
  amove: {
    at: [1, 0],
    name: '攻擊',
    tip: '攻擊移動：沿路迎擊遇到的敵人；指定敵人時集中攻擊',
    act: { k: 'order', o: 'amove', target: 'any' },
  },
  stop: { at: [1, 1], name: '停止', tip: '取消所有指令', act: { k: 'order', o: 'stop' } },
};
const UNIT_CARD = [ORD.move, ORD.hold, ORD.patrol, ORD.amove, ORD.stop];
export const RTS_UNIT_CARD = UNIT_CARD; // 英雄（C 包）、野怪與傭兵（D 包）共用
const WORKER_CARD = [
  ...UNIT_CARD,
  { at: [2, 0], alt: 'B', name: '建造', tip: '選擇要建造的建築', act: { k: 'menu', menu: 'build' } },
  {
    at: [2, 1],
    alt: 'G',
    name: '採集',
    tip: '採集礦脈的礦石，帶回主堡',
    act: { k: 'order', o: 'gather', target: 'any' },
  },
  {
    at: [2, 2],
    name: '修理',
    tip: '修理受損的建築（花費礦石）',
    act: { k: 'order', o: 'repair', target: 'unit' },
  },
];
const back = { at: [2, 3], key: 'V', alt: 'Escape', name: '返回', tip: '回上一層', act: { k: 'back' } };
const rally = {
  at: [2, 3],
  key: 'V',
  alt: 'Y',
  name: '集結點',
  tip: '生產完成的單位前往的地點（點礦脈＝工人自動採集）',
  act: { k: 'rally', target: 'any' },
};
const cancel = {
  at: [2, 2],
  key: 'C',
  alt: 'Escape',
  name: '取消',
  tip: '取消佇列的最後一項（退還資源）',
  act: { k: 'cancel' },
};
const loop = {
  at: [2, 1],
  key: 'X',
  name: '循環生產',
  tip: '佇列空了時自動再生產最後一項（自動管家）',
  act: { k: 'loop' },
};
const ab = (at, id, extra = {}) => {
  const A = RTS_ABILS[id];
  return {
    at,
    name: A.name,
    tip: A.desc,
    act: { k: 'ability', ab: id, target: A.target === 'self' ? null : A.target },
    req: A.req,
    ...extra,
  };
};
const train = (at, id) => ({ at, name: '', tip: '', act: { k: 'train', id } });
const research = (at, id) => ({ at, name: RTS_RESEARCH[id].name, tip: '', act: { k: 'research', id } });
const towerCard = [
  {
    at: [1, 0],
    name: '攻擊',
    tip: '攻擊指定目標',
    act: { k: 'order', o: 'attack', target: 'unit' },
  },
  ORD.stop,
];
const W_NONE = { rarm: 'w_none', larm: 'w_none', rback: 'bw_none', lback: 'bw_none' };
const BASE = { booster: 'b_std', generator: 'g_std', fcs: 'f_std' };

// 主堡三階共用的卡片（升級卡依階）
const hqCard = (next) => [
  train([0, 0], 'c_worker'),
  {
    at: [0, 1],
    name: '英雄',
    tip: '生產或復活英雄（第 2 位要 T2、第 3 位要 T3）',
    act: { k: 'menu', menu: 'hero' },
  },
  ...(next ? [{ at: [0, 2], name: '', tip: '', act: { k: 'upgrade', to: next } }] : []),
  {
    at: [0, 3],
    name: '動員',
    tip: '45 m 內的作業 MT 拿起步槍變成民兵（45 秒，研究民兵訓練後 60 秒）',
    act: { k: 'militia' },
  },
  { at: [1, 0], name: '解除動員', tip: '民兵變回作業 MT 並回去採集', act: { k: 'demob' } },
  cancel,
  rally,
];
// 主堡的英雄子選單（Q W E＝陣營的三位英雄、V 返回）：依 RTS_FACTIONS[陣營].heroes 在檔尾產生（docs 14.3）
const heroMenu = (ids) => [
  ...ids.map((id, i) => {
    const H = RTS_DEFS[id] || {};
    return {
      at: [0, i],
      name: H.name || id.replace(/^h_/, '').toUpperCase(),
      tip: H.role || '',
      act: { k: 'hero', id },
    };
  }),
  back,
];

// ---------- 定義 ----------
export const RTS_DEFS = {
  // ===== 卡斯特隆重工：單位 =====
  c_worker: {
    kind: 'unit',
    faction: 'castron',
    name: '作業 MT',
    desc: '採礦、建造、修理的工程機；沒有武裝（主堡的動員：變成民兵）',
    tier: 1,
    cost: { ore: 75, coral: 0 },
    time: 14,
    pop: 1,
    hp: 260,
    sight: 26,
    atk: 'kin',
    arm: 'none',
    armor: 0,
    lv: 1,
    size: 0,
    speed: 5.5,
    scale: 0.72,
    radius: 1.1,
    worker: true,
    asm: { head: 'h_lt', core: 'c_lt', arms: 'a_lt', legs: 'l_tk', ...BASE, ...W_NONE },
    card: WORKER_CARD,
    menus: {
      build: [
        { at: [0, 0], name: '主堡', tip: '', act: { k: 'build', id: 'c_hq' } },
        { at: [0, 1], name: '補給庫', tip: '', act: { k: 'build', id: 'c_depot' } },
        { at: [0, 2], name: '兵工廠', tip: '', act: { k: 'build', id: 'c_factory' } },
        { at: [0, 3], name: 'Coral 抽取站', tip: '', act: { k: 'build', id: 'c_extractor' } },
        { at: [1, 0], name: '工程研究所', tip: '', act: { k: 'build', id: 'c_works' } },
        { at: [1, 1], name: '起重機砲台', tip: '', act: { k: 'build', id: 'c_tower' } },
        { at: [1, 2], name: '城牆', tip: '', act: { k: 'build', id: 'c_wall' } },
        { at: [1, 3], name: '補給商店', tip: '', act: { k: 'build', id: 'c_market' } },
        { at: [2, 0], name: '重工廠', tip: '', act: { k: 'build', id: 'c_heavy' } },
        { at: [2, 1], name: '防空砲塔', tip: '', act: { k: 'build', id: 'c_flak' } },
        { at: [2, 2], name: '停機坪', tip: '', act: { k: 'build', id: 'c_helipad' } },
        back,
      ],
    },
  },
  // 民兵（主堡的「動員」把作業 MT 換成它；不能生產）
  c_militia: {
    kind: 'unit',
    faction: 'castron',
    name: '民兵',
    desc: '拿起步槍的作業 MT（時間到或解除動員時變回工人）',
    militia: true,
    tier: 1,
    cost: { ore: 0, coral: 0 },
    time: 0,
    pop: 1,
    hp: 260,
    sight: 26,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    lv: 1,
    size: 0,
    speed: 5.5,
    scale: 0.72,
    radius: 1.1,
    range: 18,
    rof: 0.4,
    dps: 9,
    asm: { head: 'h_lt', core: 'c_lt', arms: 'a_lt', legs: 'l_tk', ...BASE, ...W_NONE, rarm: 'w_rifle' },
    card: UNIT_CARD,
  },
  c_mt: {
    kind: 'unit',
    faction: 'castron',
    name: 'MT',
    desc: '基本的步兵機甲：機槍，地空都打',
    tier: 1,
    cost: { ore: 135, coral: 0 },
    time: 18,
    pop: 2,
    hp: 560,
    sight: 30,
    atk: 'kin',
    arm: 'med',
    armor: 1,
    lv: 2,
    aa: 'both',
    size: 1,
    speed: 7.5,
    scale: 0.85,
    radius: 1.2,
    range: 26,
    rof: 0.2,
    dps: 14,
    asm: { head: 'h_lt', core: 'c_lt', arms: 'a_lt', legs: 'l_bp', ...BASE, ...W_NONE, rarm: 'w_mg' },
    card: UNIT_CARD,
  },
  c_shield: {
    kind: 'unit',
    faction: 'castron',
    name: '盾牌 MT',
    desc: '正面大盾擋下大部分射擊；慢、射程短，適合打頭陣',
    tier: 1,
    cost: { ore: 170, coral: 30 },
    time: 24,
    pop: 3,
    hp: 820,
    sight: 28,
    atk: 'kin',
    arm: 'heavy',
    armor: 3,
    lv: 3,
    size: 1,
    speed: 6,
    scale: 1,
    radius: 1.4,
    range: 20,
    rof: 0.25,
    dps: 10,
    ai: 'shield',
    abil: ['ab_wall'],
    asm: { head: 'h_hv', core: 'c_hv', arms: 'a_hv', legs: 'l_bp', ...BASE, ...W_NONE, rarm: 'w_mg' },
    card: [...UNIT_CARD, ab([2, 0], 'ab_wall')],
  },
  c_forklift: {
    kind: 'unit',
    faction: 'castron',
    name: '叉架 MT',
    desc: '舉著貨櫃當盾牌（正面傷害減半），可以丟出貨櫃或放下貨櫃當掩體',
    tier: 1,
    cost: { ore: 155, coral: 20 },
    time: 22,
    pop: 3,
    hp: 700,
    sight: 26,
    atk: 'kin',
    arm: 'med',
    armor: 2,
    lv: 3,
    size: 1,
    speed: 7,
    scale: 1,
    radius: 1.8,
    range: 18,
    rof: 0.2,
    dps: 12,
    modelKind: 'boss',
    vehKey: 'forklift',
    abil: ['ab_crate', 'ab_cover'],
    asm: { head: 'h_hv', core: 'c_hv', arms: 'a_hv', legs: 'l_bp', ...BASE, ...W_NONE, rarm: 'w_mg' },
    card: [...UNIT_CARD, ab([2, 0], 'ab_crate'), ab([2, 1], 'ab_cover')],
  },
  c_mortar: {
    kind: 'unit',
    faction: 'castron',
    name: '迫擊砲 MT',
    desc: '遠距離的榴彈（範圍 4 m，攻城），最短射程 10 m；可以打照明彈',
    tier: 2,
    req: { tier: 2 },
    cost: { ore: 190, coral: 60 },
    time: 26,
    pop: 3,
    hp: 480,
    sight: 30,
    atk: 'exp',
    arm: 'light',
    armor: 0,
    lv: 3,
    size: 1,
    speed: 5.5,
    scale: 0.95,
    radius: 1.2,
    range: 46,
    minRange: 10,
    splash: 4,
    rof: 2.4,
    dps: 16,
    slots: ['rback'],
    abil: ['ab_flare'],
    asm: {
      head: 'h_scan',
      core: 'c_std',
      arms: 'a_std',
      legs: 'l_qd',
      ...BASE,
      fcs: 'f_far',
      ...W_NONE,
      rarm: 'w_rifle',
      rback: 'bw_gr',
    },
    card: [...UNIT_CARD, ab([2, 0], 'ab_flare')],
  },
  c_stomper: {
    kind: 'unit',
    faction: 'castron',
    name: '重踏機甲',
    desc: '近距離的霰彈與踏地衝擊波（可自動施放）；耐打',
    tier: 2,
    req: { tier: 2 },
    cost: { ore: 260, coral: 80 },
    time: 32,
    pop: 4,
    hp: 1300,
    sight: 26,
    atk: 'kin',
    arm: 'heavy',
    armor: 3,
    lv: 4,
    size: 1,
    speed: 6,
    scale: 1.15,
    radius: 1.6,
    range: 12,
    rof: 0.6,
    dps: 30,
    abil: ['ab_stomp'],
    asm: {
      head: 'h_hv',
      core: 'c_hv',
      arms: 'a_hv',
      legs: 'l_hv',
      booster: 'b_hi',
      generator: 'g_std',
      fcs: 'f_near',
      ...W_NONE,
      rarm: 'w_sg',
    },
    card: [...UNIT_CARD, ab([2, 0], 'ab_stomp')],
  },
  c_tank: {
    kind: 'unit',
    faction: 'castron',
    name: '裝甲車',
    desc: '火箭筒（穿甲，對重甲）；車頂的加特林只打空中',
    tier: 2,
    req: { tier: 2 },
    cost: { ore: 240, coral: 60 },
    time: 30,
    pop: 4,
    hp: 1100,
    sight: 30,
    atk: 'pierce',
    arm: 'heavy',
    armor: 2,
    lv: 4,
    size: 2,
    speed: 8,
    scale: 0.9,
    radius: 2.0,
    range: 30,
    rof: 1.2,
    dps: 22,
    slots: ['rarm', 'rback'],
    slotDps: { rback: 10 },
    slotAtk: { rback: 'kin' },
    slotAa: { rback: 'air' },
    modelKind: 'vehicle',
    asm: {
      head: 'h_hv',
      core: 'c_hv',
      arms: 'a_hv',
      legs: 'l_tk',
      ...BASE,
      ...W_NONE,
      rarm: 'w_bz',
      rback: 'bw_gat',
    },
    card: UNIT_CARD,
  },
  c_arty: {
    kind: 'unit',
    faction: 'castron',
    name: '自走砲',
    desc: '超遠距離的砲擊（範圍 5 m，攻城）；要架設才能開火，最短射程 16 m',
    tier: 3,
    req: { tier: 3 },
    cost: { ore: 330, coral: 165 },
    time: 40,
    pop: 5,
    hp: 900,
    sight: 28,
    atk: 'exp',
    arm: 'heavy',
    armor: 1,
    lv: 5,
    size: 2,
    speed: 6.5,
    scale: 0.9,
    radius: 2.0,
    range: 72,
    minRange: 16,
    splash: 5,
    rof: 3,
    dps: 34,
    slots: ['rback'],
    modelKind: 'vehicle',
    abil: ['ab_siege'],
    asm: {
      head: 'h_hv',
      core: 'c_hv',
      arms: 'a_hv',
      legs: 'l_tk',
      ...BASE,
      fcs: 'f_far',
      ...W_NONE,
      rback: 'bw_gr',
    },
    card: [...UNIT_CARD, ab([2, 0], 'ab_siege')],
  },
  c_heli: {
    kind: 'unit',
    faction: 'castron',
    name: '武裝直升機',
    desc: '空中單位：飛越地形，只有對空武器打得到；火箭齊射',
    tier: 3,
    req: { tier: 3 },
    cost: { ore: 252, coral: 108 },
    time: 34,
    pop: 4,
    hp: 750,
    sight: 34,
    atk: 'pierce',
    arm: 'light',
    armor: 1,
    lv: 4,
    aa: 'both',
    size: 1,
    speed: 12,
    scale: 0.9,
    radius: 1.9,
    range: 28,
    rof: 0.2,
    dps: 20,
    flying: true,
    hoverH: 7,
    modelKind: 'heli',
    abil: ['ab_rockets'],
    asm: {
      head: 'h_std',
      core: 'c_std',
      arms: 'a_std',
      legs: 'l_bp',
      booster: 'b_hi',
      generator: 'g_hi',
      fcs: 'f_std',
      ...W_NONE,
      rarm: 'w_mg',
    },
    card: [...UNIT_CARD, ab([2, 0], 'ab_rockets')],
  },

  // ===== 卡斯特隆重工：建築 =====
  c_hq: {
    kind: 'bld',
    faction: 'castron',
    name: '主堡',
    desc: '生產作業 MT 與英雄、礦石的回收點；人口 +10；可以升級成要塞主堡（T2）',
    tier: 1,
    cost: { ore: 385, coral: 120 },
    time: 110,
    hp: 4200,
    sight: 40,
    atk: 'kin',
    arm: 'fort',
    armor: 5,
    foot: [16, 16],
    height: 13,
    popCap: 10,
    dropoff: true,
    heroes: true,
    trains: ['c_worker'],
    upTo: 'c_hq2',
    card: hqCard('c_hq2'),
  },
  c_hq2: {
    kind: 'bld',
    faction: 'castron',
    name: '要塞主堡',
    desc: '主堡的第二階（T2）：解鎖重工廠、防空砲塔、迫擊砲 MT 與第 2 位英雄；人口 +12',
    tier: 2,
    req: { blds: ['c_factory'] },
    cost: { ore: 300, coral: 150 },
    time: 60,
    hp: 5200,
    sight: 42,
    atk: 'kin',
    arm: 'fort',
    armor: 6,
    foot: [16, 16],
    height: 15,
    popCap: 12,
    dropoff: true,
    heroes: true,
    trains: ['c_worker'],
    from: 'c_hq',
    upTo: 'c_hq3',
    fortGun: { range: 30, dps: 20, atk: 'kin', rof: 0.25 },
    card: hqCard('c_hq3'),
  },
  c_hq3: {
    kind: 'bld',
    faction: 'castron',
    name: '重工司令部',
    desc: '主堡的第三階（T3）：解鎖停機坪、自走砲、武裝直升機與第 3 位英雄；人口 +15',
    tier: 3,
    req: { blds: ['c_heavy', 'c_works'] },
    cost: { ore: 400, coral: 250 },
    time: 75,
    hp: 6400,
    sight: 44,
    atk: 'kin',
    arm: 'fort',
    armor: 7,
    foot: [16, 16],
    height: 17,
    popCap: 15,
    dropoff: true,
    heroes: true,
    trains: ['c_worker'],
    from: 'c_hq2',
    fortGun: { range: 30, dps: 20, atk: 'kin', rof: 0.25 },
    card: hqCard(null),
  },
  c_depot: {
    kind: 'bld',
    faction: 'castron',
    name: '補給庫',
    desc: '人口 +10',
    tier: 1,
    cost: { ore: 90, coral: 0 },
    time: 30,
    hp: 700,
    sight: 20,
    arm: 'fort',
    armor: 3,
    foot: [8, 8],
    height: 6,
    popCap: 10,
    card: [],
  },
  c_factory: {
    kind: 'bld',
    faction: 'castron',
    name: '兵工廠',
    desc: '生產 MT、盾牌 MT、叉架 MT、迫擊砲 MT（T2）',
    tier: 1,
    cost: { ore: 180, coral: 40 },
    time: 55,
    hp: 1500,
    sight: 24,
    arm: 'fort',
    armor: 4,
    foot: [14, 12],
    height: 10,
    trains: ['c_mt', 'c_shield', 'c_forklift', 'c_mortar'],
    card: [
      train([0, 0], 'c_mt'),
      train([0, 1], 'c_shield'),
      train([0, 2], 'c_forklift'),
      train([0, 3], 'c_mortar'),
      loop,
      cancel,
      rally,
    ],
  },
  c_extractor: {
    kind: 'bld',
    faction: 'castron',
    name: 'Coral 抽取站',
    desc: '蓋在 Coral 湧出點上，自動產出 Coral',
    tier: 1,
    cost: { ore: 120, coral: 0 },
    time: 35,
    hp: 900,
    sight: 18,
    arm: 'fort',
    armor: 3,
    foot: [8, 8],
    height: 9,
    on: 'coral',
    coralRate: 0.8,
    card: [],
  },
  c_works: {
    kind: 'bld',
    faction: 'castron',
    name: '工程研究所',
    desc: '研究武器、裝甲與兵種的能力',
    tier: 1,
    req: { blds: ['c_factory'] },
    cost: { ore: 160, coral: 60 },
    time: 50,
    hp: 1100,
    sight: 22,
    arm: 'fort',
    armor: 3,
    foot: [12, 10],
    height: 9,
    research: ['r_kin', 'r_exp', 'r_arm', 'r_fort', 'r_militia', 'r_wall', 'r_shell', 'r_barrel', 'r_stomp'],
    card: [
      research([0, 0], 'r_kin'),
      research([0, 1], 'r_exp'),
      research([0, 2], 'r_arm'),
      research([0, 3], 'r_fort'),
      research([1, 0], 'r_militia'),
      research([1, 1], 'r_wall'),
      research([1, 2], 'r_shell'),
      research([1, 3], 'r_barrel'),
      research([2, 0], 'r_stomp'),
      cancel,
    ],
  },
  c_tower: {
    kind: 'bld',
    faction: 'castron',
    name: '起重機砲台',
    desc: '防禦塔：拋出貨櫃（爆發、範圍 3 m），射程 36（最短 6）；不打空中',
    tier: 1,
    req: { blds: ['c_factory'] },
    cost: { ore: 130, coral: 30 },
    time: 40,
    hp: 900,
    sight: 34,
    atk: 'exp',
    arm: 'fort',
    armor: 4,
    foot: [6, 6],
    height: 16,
    range: 36,
    minRange: 6,
    splash: 3,
    dps: 18,
    rof: 2.5,
    card: towerCard,
  },
  c_wall: {
    kind: 'bld',
    faction: 'castron',
    name: '城牆',
    desc: '擋路；Shift 拖曳連續蓋一排',
    tier: 1,
    cost: { ore: 25, coral: 0 },
    time: 10,
    hp: 600,
    sight: 4,
    arm: 'fort',
    armor: 6,
    foot: [4, 2],
    height: 4,
    wall: true,
    card: [],
  },
  c_market: {
    kind: 'bld',
    faction: 'castron',
    name: '補給商店',
    desc: '賣道具給 12 m 內的英雄（依主堡的層級）',
    tier: 1,
    cost: { ore: 130, coral: 30 },
    time: 45,
    hp: 900,
    sight: 18,
    arm: 'fort',
    armor: 3,
    foot: [10, 8],
    height: 7,
    shop: true,
    card: [], // 貨架的卡片（Q W E R A S D F Z X：{ k: 'buy', item }）由 C／E 包依 RTS_SHOP 產生
  },
  c_heavy: {
    kind: 'bld',
    faction: 'castron',
    name: '重工廠',
    desc: '生產重踏機甲、裝甲車、自走砲（T3）',
    tier: 2,
    req: { tier: 2 },
    cost: { ore: 240, coral: 120 },
    time: 70,
    hp: 2000,
    sight: 24,
    arm: 'fort',
    armor: 5,
    foot: [16, 14],
    height: 12,
    trains: ['c_stomper', 'c_tank', 'c_arty'],
    card: [train([0, 0], 'c_stomper'), train([0, 1], 'c_tank'), train([0, 2], 'c_arty'), loop, cancel, rally],
  },
  c_flak: {
    kind: 'bld',
    faction: 'castron',
    name: '防空砲塔',
    desc: '防禦塔：只打空中（穿甲），射程 34',
    tier: 2,
    req: { tier: 2 },
    cost: { ore: 120, coral: 40 },
    time: 35,
    hp: 750,
    sight: 34,
    atk: 'pierce',
    arm: 'fort',
    armor: 3,
    foot: [5, 5],
    height: 8,
    range: 34,
    dps: 28,
    rof: 0.5,
    aa: 'air',
    card: towerCard,
  },
  c_helipad: {
    kind: 'bld',
    faction: 'castron',
    name: '停機坪',
    desc: '生產武裝直升機',
    tier: 3,
    req: { tier: 3 },
    cost: { ore: 200, coral: 150 },
    time: 60,
    hp: 1300,
    sight: 22,
    arm: 'fort',
    armor: 3,
    foot: [14, 14],
    height: 5,
    trains: ['c_heli'],
    card: [train([0, 0], 'c_heli'), loop, cancel, rally],
  },
};
// 其他包的定義：英雄（C）、野怪與中立建築（D）、艾瑟立克（data/rts-aetheric.js）、維爾威（data/rts-veerwell.js）
Object.assign(
  RTS_DEFS,
  RTS_HERO_DEFS,
  RTS_CREEP_DEFS,
  RTS_NEUTRAL_DEFS,
  RTS_AETH_DEFS,
  RTS_VEER_DEFS,
  RTS_SANC_DEFS,
);
Object.assign(RTS_RESEARCH, RTS_AETH_RESEARCH, RTS_VEER_RESEARCH, RTS_SANC_RESEARCH);
// 指令卡的預設快捷鍵（依位置）與說明（建造、生產的名稱帶成本）
// 零件（聖域，docs 16.2）只有定義的費用有 parts 時顯示
export const costTxt = (c) =>
  `礦石 ${c.ore || 0}${c.coral ? '、Coral ' + c.coral : ''}${c.parts ? '、零件 ' + c.parts : ''}`;
const fixCard = (card) => {
  for (const c of card) {
    if (!c.key) c.key = CARD_KEYS[c.at[0]][c.at[1]];
    const a = c.act || {};
    const ref =
      a.k === 'train' || a.k === 'build' ? RTS_DEFS[a.id] : a.k === 'upgrade' ? RTS_DEFS[a.to] : null;
    if (ref && !c.name) c.name = a.k === 'upgrade' ? '升級：' + ref.name : ref.name;
    if (ref && !c.tip) c.tip = `${ref.desc}（${costTxt(ref.cost)}）`;
    if (a.k === 'research' && !c.tip) c.tip = RTS_RESEARCH[a.id].desc;
  }
};
for (const id in RTS_DEFS) {
  const D = RTS_DEFS[id];
  D.id = id;
  fixCard(D.card || []);
  for (const m in D.menus || {}) fixCard(D.menus[m]);
}

// ---------- 陣營（四個；R5 起四個都可以選） ----------
export const RTS_FACTIONS = {
  castron: {
    name: '卡斯特隆重工',
    leader: '霍斯特',
    style: '重裝、要塞、砲兵',
    avail: true,
    pal: 'castron',
    hq: 'c_hq',
    worker: 'c_worker',
    militia: 'c_militia',
    units: [
      'c_worker',
      'c_mt',
      'c_shield',
      'c_forklift',
      'c_mortar',
      'c_stomper',
      'c_tank',
      'c_arty',
      'c_heli',
    ],
    blds: [
      'c_hq',
      'c_hq2',
      'c_hq3',
      'c_depot',
      'c_factory',
      'c_extractor',
      'c_works',
      'c_tower',
      'c_wall',
      'c_market',
      'c_heavy',
      'c_flak',
      'c_helipad',
    ],
    heroes: ['h_bastion', 'h_rain', 'h_pile'],
    market: 'c_market',
    traits: ['工人修理、主堡動員民兵', '城牆、防禦塔、重裝的兵種', '礦石多、單位耐打'],
  },
  // 艾瑟立克（docs 14.2；hq／worker／units／blds／heroes／grid… 在 data/rts-aetheric.js 的 RTS_AETH_FACTION）
  aetheric: {
    name: '艾瑟立克研究機構',
    leader: '薩奇博士',
    style: '能量、實驗體、研究',
    pal: 'aetheric',
    ...RTS_AETH_FACTION,
  },
  // 維爾威（docs 15.2；hq／worker／units／blds／heroes／airdrop… 在 data/rts-veerwell.js 的 RTS_VEER_FACTION）
  veerwell: {
    name: '維爾威動態',
    leader: '派克',
    style: '機動、空中、物流',
    pal: 'veerwell',
    ...RTS_VEER_FACTION,
  },
  // 聖域（docs 16.2；hq／worker／units／blds／heroes／salvage… 在 data/rts-sancta.js 的 RTS_SANC_FACTION）
  sancta: {
    name: '聖域互助同盟',
    leader: '諾拉',
    style: '便宜、數量、回收',
    pal: 'sancta',
    ...RTS_SANC_FACTION,
  },
};
// 主堡（有 heroes 的建築）的英雄子選單：依陣營的英雄產生
for (const id in RTS_DEFS) {
  const D = RTS_DEFS[id];
  const F = D.heroes && RTS_FACTIONS[D.faction];
  if (!F || !F.heroes) continue;
  D.menus = { ...(D.menus || {}), hero: heroMenu(F.heroes) };
  fixCard(D.menus.hero);
}
export const RTS_DIFFS = [
  { id: 'easy', name: '簡單' },
  { id: 'normal', name: '普通' },
  { id: 'hard', name: '困難' },
  { id: 'insane', name: '瘋狂' }, // 看全圖、資源 +50%（data/rts-ai.js）
];
export const RTS_TEAM_COLORS = [0x3a8cff, 0xff4433, 0xe0c040]; // 玩家藍、電腦紅、中立黃

export const rtsDef = (id) => RTS_DEFS[id] || null;
export const isBld = (id) => !!(RTS_DEFS[id] && RTS_DEFS[id].kind === 'bld');
// 需求的正規化：陣列（R1 的格式）＝{ blds }
export function reqOf(D) {
  const r = D && D.req;
  if (!r) return null;
  return Array.isArray(r) ? { blds: r } : r;
}
// 建築 have 能不能當作需求 want（升級過的主堡也算低階的主堡）
export function bldSatisfies(have, want) {
  for (let id = have, n = 0; id && n < 8; id = RTS_DEFS[id] && RTS_DEFS[id].from, n++)
    if (id === want) return true;
  return false;
}
// 維持費的倍率與等級（0～2）
export function upkeepOf(pop) {
  for (let i = 0; i < RTS_UPKEEP.length; i++)
    if (pop <= RTS_UPKEEP[i].max) return { lv: i, ...RTS_UPKEEP[i] };
  return { lv: RTS_UPKEEP.length - 1, ...RTS_UPKEEP[RTS_UPKEEP.length - 1] };
}
