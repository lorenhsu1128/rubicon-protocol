// Coral 戰爭（RTS，docs/rts-design.md）的兵種、建築與陣營（純資料，數值都是暫定、好調整的表）。
// 節奏參考魔獸爭霸3：開局 500 礦石＋100 Coral、5 個工人；一場 15～20 分鐘、第一次交戰約 4～6 分鐘。
//
// 每個定義（RTS_DEFS[id]）：
//   kind 'unit'｜'bld'、faction、name、cost { ore, coral }、time（生產／建造秒數）、pop（人口）、hp、sight（視野 m）、
//   單位：size（world/nav.js 的尺寸 0／1／2）、speed（m/s）、scale（模型縮放）、radius（碰撞）、asm（組裝，
//         data/parts.js 的零件 id）、ai（MechEntity 的 ai：'shield' 會掛上 mech-special.js 的正面大盾）、
//         range（攻擊距離 m，比武器射程短，讓交戰集中）、rof（兩發之間的最短秒數：控制子彈數量）、dps（目標每秒傷害，
//         開局時換算成 dmgMul）、res（[實彈, 爆發, 能量] 的額外減傷）、worker（工人：採集、建造、修理）
//   建築：foot [w, d]（佔地 m，原點在底面中心）、height（模型高度 m）、popCap（提供的人口上限）、dropoff（資源回收點）、
//         trains（可以生產的單位）、on 'coral'（只能蓋在 Coral 湧出點上）、coralRate（每秒產出的 Coral）
//   card：指令卡 3×4 格 [{ at: [列, 行], key, alt?, name, tip, act }]；key 預設為位置對應的鍵（CARD_KEYS），
//         act：{ k: 'order', o: 指令, target: 'point'｜'unit'｜'any'｜null } 下指令（需要目標的由輸入端選點）、
//              { k: 'train', id } 生產、{ k: 'build', id } 工人建造（選位置）、{ k: 'menu', menu } 換指令卡、
//              { k: 'back' } 回上一層、{ k: 'rally' } 設集結點（選點）、{ k: 'cancel' } 取消佇列的最後一項
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
  trip: 10, // 每趟帶回的礦石
  time: 2, // 採一趟的秒數
  drop: 0.5, // 在主堡卸貨的秒數
  sat: 5, // 一座礦脈同時採集的工人數（超過的排隊或換礦）
  reach: 1.8, // 工人離礦脈表面多近開始採
  mineR: 4, // 礦脈的半徑（m）
};
export const RTS_REPAIR = { costK: 0.35, timeK: 1.5 }; // 修理：補滿血量要花建造成本的 35%、建造時間的 1.5 倍
export const RTS_BUILD_ASSIST = 0.5; // 多個工人一起蓋：每多一個工人速度 +50%
export const RTS_BLD_RES = [0.35, -0.3, 0.35]; // 建築的「城甲」：實彈與能量減傷、爆發（攻城）加傷
export const CARD_KEYS = [
  ['Q', 'W', 'E', 'R'],
  ['A', 'S', 'D', 'F'],
  ['Z', 'X', 'C', 'V'],
];

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

// ---------- 定義 ----------
export const RTS_DEFS = {
  // ===== 卡斯特隆重工 =====
  c_worker: {
    kind: 'unit',
    faction: 'castron',
    name: '作業 MT',
    desc: '採礦、建造、修理的工程機；沒有武裝',
    cost: { ore: 75, coral: 0 },
    time: 14,
    pop: 1,
    hp: 260,
    sight: 26,
    size: 0,
    speed: 5.5,
    scale: 0.72,
    radius: 1.1,
    worker: true,
    asm: {
      head: 'h_lt',
      core: 'c_lt',
      arms: 'a_lt',
      legs: 'l_tk',
      booster: 'b_std',
      generator: 'g_std',
      fcs: 'f_std',
      rarm: 'w_none',
      larm: 'w_none',
      rback: 'bw_none',
      lback: 'bw_none',
    },
    card: WORKER_CARD,
    menus: {
      build: [
        { at: [0, 0], name: '主堡', tip: '', act: { k: 'build', id: 'c_hq' } },
        { at: [0, 1], name: '補給庫', tip: '', act: { k: 'build', id: 'c_depot' } },
        { at: [0, 2], name: '兵工廠', tip: '', act: { k: 'build', id: 'c_factory' } },
        { at: [0, 3], name: 'Coral 抽取站', tip: '', act: { k: 'build', id: 'c_extractor' } },
        back,
      ],
    },
  },
  c_mt: {
    kind: 'unit',
    faction: 'castron',
    name: 'MT',
    desc: '基本的步兵機甲：機槍，均衡',
    cost: { ore: 135, coral: 0 },
    time: 18,
    pop: 2,
    hp: 560,
    sight: 30,
    size: 1,
    speed: 7.5,
    scale: 0.85,
    radius: 1.2,
    range: 26,
    rof: 0.2,
    dps: 14,
    asm: {
      head: 'h_lt',
      core: 'c_lt',
      arms: 'a_lt',
      legs: 'l_bp',
      booster: 'b_std',
      generator: 'g_std',
      fcs: 'f_std',
      rarm: 'w_mg',
      larm: 'w_none',
      rback: 'bw_none',
      lback: 'bw_none',
    },
    card: UNIT_CARD,
  },
  c_shield: {
    kind: 'unit',
    faction: 'castron',
    name: '盾牌 MT',
    desc: '正面大盾擋下大部分射擊；慢、射程短，適合打頭陣',
    cost: { ore: 170, coral: 30 },
    time: 24,
    pop: 3,
    hp: 820,
    sight: 28,
    size: 1,
    speed: 6,
    scale: 1,
    radius: 1.4,
    range: 20,
    rof: 0.25,
    dps: 10,
    ai: 'shield',
    res: [0.2, 0, -0.25],
    asm: {
      head: 'h_hv',
      core: 'c_hv',
      arms: 'a_hv',
      legs: 'l_bp',
      booster: 'b_std',
      generator: 'g_std',
      fcs: 'f_std',
      rarm: 'w_mg',
      larm: 'w_none',
      rback: 'bw_none',
      lback: 'bw_none',
    },
    card: UNIT_CARD,
  },
  c_hq: {
    kind: 'bld',
    faction: 'castron',
    name: '主堡',
    desc: '生產作業 MT、礦石的回收點；人口 +10',
    cost: { ore: 385, coral: 120 },
    time: 110,
    hp: 4200,
    sight: 40,
    foot: [16, 16],
    height: 13,
    popCap: 10,
    dropoff: true,
    trains: ['c_worker'],
    card: [{ at: [0, 0], name: '作業 MT', tip: '', act: { k: 'train', id: 'c_worker' } }, cancel, rally],
  },
  c_depot: {
    kind: 'bld',
    faction: 'castron',
    name: '補給庫',
    desc: '人口 +10',
    cost: { ore: 90, coral: 0 },
    time: 30,
    hp: 700,
    sight: 20,
    foot: [8, 8],
    height: 6,
    popCap: 10,
    card: [],
  },
  c_factory: {
    kind: 'bld',
    faction: 'castron',
    name: '兵工廠',
    desc: '生產 MT 與盾牌 MT',
    cost: { ore: 180, coral: 40 },
    time: 55,
    hp: 1500,
    sight: 24,
    foot: [14, 12],
    height: 10,
    trains: ['c_mt', 'c_shield'],
    card: [
      { at: [0, 0], name: 'MT', tip: '', act: { k: 'train', id: 'c_mt' } },
      { at: [0, 1], name: '盾牌 MT', tip: '', act: { k: 'train', id: 'c_shield' } },
      cancel,
      rally,
    ],
  },
  c_extractor: {
    kind: 'bld',
    faction: 'castron',
    name: 'Coral 抽取站',
    desc: '蓋在 Coral 湧出點上，自動產出 Coral',
    cost: { ore: 120, coral: 0 },
    time: 35,
    hp: 900,
    sight: 18,
    foot: [8, 8],
    height: 9,
    on: 'coral',
    coralRate: 0.8,
    card: [],
  },
};
// 指令卡的預設快捷鍵（依位置）與說明（建造、生產的名稱帶成本）
for (const id in RTS_DEFS) {
  const D = RTS_DEFS[id];
  D.id = id;
  const fix = (card) => {
    for (const c of card) {
      if (!c.key) c.key = CARD_KEYS[c.at[0]][c.at[1]];
      const ref = c.act && (c.act.k === 'train' || c.act.k === 'build') ? RTS_DEFS[c.act.id] : null;
      if (ref && !c.tip)
        c.tip = `${ref.desc}（礦石 ${ref.cost.ore}${ref.cost.coral ? '、Coral ' + ref.cost.coral : ''}）`;
    }
  };
  fix(D.card || []);
  for (const m in D.menus || {}) fix(D.menus[m]);
}

// ---------- 陣營（四個，R1 只有卡斯特隆可以選） ----------
export const RTS_FACTIONS = {
  castron: {
    name: '卡斯特隆重工',
    leader: '霍斯特',
    style: '重裝、要塞、砲兵',
    avail: true,
    pal: 'castron',
    hq: 'c_hq',
    worker: 'c_worker',
    units: ['c_worker', 'c_mt', 'c_shield'],
    blds: ['c_hq', 'c_depot', 'c_factory', 'c_extractor'],
  },
  aetheric: {
    name: '艾瑟立克研究機構',
    leader: '薩奇博士',
    style: '能量、實驗體、研究',
    avail: false,
    pal: 'aetheric',
  },
  veerwell: { name: '維爾威動態', leader: '派克', style: '機動、空中、物流', avail: false, pal: 'veerwell' },
  sancta: { name: '聖域互助同盟', leader: '諾拉', style: '便宜、數量、回收', avail: false, pal: 'castron' },
};
export const RTS_DIFFS = [
  { id: 'easy', name: '簡單' },
  { id: 'normal', name: '普通' },
  { id: 'hard', name: '困難' },
  { id: 'insane', name: '瘋狂' }, // 看全圖、資源 +50%（data/rts-ai.js）
];
export const RTS_TEAM_COLORS = [0x3a8cff, 0xff4433]; // 玩家藍、電腦紅

export const rtsDef = (id) => RTS_DEFS[id] || null;
export const isBld = (id) => !!(RTS_DEFS[id] && RTS_DEFS[id].kind === 'bld');
// 維持費的倍率與等級（0～2）
export function upkeepOf(pop) {
  for (let i = 0; i < RTS_UPKEEP.length; i++)
    if (pop <= RTS_UPKEEP[i].max) return { lv: i, ...RTS_UPKEEP[i] };
  return { lv: RTS_UPKEEP.length - 1, ...RTS_UPKEEP[RTS_UPKEEP.length - 1] };
}
