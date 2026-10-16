// Coral 戰爭（RTS）電腦對手的資料表（純資料；行為在 game/rts-ai.js）：各陣營的開局建造順序與各難度的參數。
// 之後加陣營只要在 RTS_AI_OPENERS 加一組（建築與兵種的 id 換成該陣營的）。
//
// 開局（RTS_AI_OPENERS[陣營] 的一項）：
//   steps：依序執行的建造步驟 { pop, b }＝人口（含生產中的）達到 pop 時蓋 b（同一種建築第 n 次出現＝要有 n 座；
//          主堡的步驟＝開分礦）；步驟的資源會先保留（工人與部隊的生產讓路）。
//   wk0：開局期間（步驟還沒做完）的工人上限；之後用難度的 wkMax。
//   mix：部隊的生產比例 { 兵種 id: 權重 }（Coral 不夠時改生產不用 Coral 的）。
//   armyK：第一次進攻的部隊門檻倍率；attackK：最早進攻時間的倍率；expandK：開分礦時間的倍率。
//   （R2 第二輪，F 包）hero：第 1 個英雄；heroes：英雄的優先順序（第 2、3 個依序挑還沒有的）；
//   tech：{ t2, t3 }＝升級主堡的人口門檻（難度的 t2T／t3T 是時間下限；時間超過下限 90 秒時不看人口）；
//   research：研究順序（同一個 id 出現第 n 次＝第 n 級；難度的 resMax 限制級數）；
//   mix2／mix3：T2、T3 之後的兵種比例（沒有生產建築的兵種略過）；towers：基地被攻擊兩次之後蓋幾座防禦塔。
export const RTS_AI_OPENERS = {
  castron: [
    {
      id: 'std',
      name: '標準',
      steps: [
        { pop: 7, b: 'c_depot' },
        { pop: 9, b: 'c_factory' },
        { pop: 11, b: 'c_extractor' },
        { pop: 14, b: 'c_depot' },
        { pop: 17, b: 'c_factory' },
      ],
      wk0: 13,
      mix: { c_mt: 2, c_shield: 1 },
      armyK: 1,
      attackK: 1,
      expandK: 1,
      hero: 'h_bastion',
      heroes: ['h_bastion', 'h_rain', 'h_pile'],
      tech: { t2: 24, t3: 40 },
      research: ['r_kin', 'r_arm', 'r_wall', 'r_kin', 'r_fort', 'r_arm', 'r_kin', 'r_arm', 'r_exp'],
      mix2: { c_mt: 2, c_shield: 1, c_tank: 1, c_mortar: 1 },
      mix3: { c_mt: 2, c_shield: 1, c_tank: 2, c_mortar: 1, c_arty: 1, c_heli: 1 },
      towers: 2,
    },
    {
      id: 'rush',
      name: '速攻',
      steps: [
        { pop: 6, b: 'c_factory' },
        { pop: 7, b: 'c_depot' },
        { pop: 9, b: 'c_factory' },
        { pop: 13, b: 'c_depot' },
        { pop: 18, b: 'c_extractor' },
      ],
      wk0: 9,
      mix: { c_mt: 1 },
      armyK: 0.7,
      attackK: 1,
      expandK: 1.2,
      hero: 'h_pile',
      heroes: ['h_pile', 'h_bastion', 'h_rain'],
      tech: { t2: 26, t3: 44 },
      research: ['r_kin', 'r_kin', 'r_arm', 'r_stomp', 'r_arm', 'r_kin', 'r_exp', 'r_fort'],
      mix2: { c_mt: 2, c_forklift: 1, c_stomper: 1, c_tank: 1 },
      mix3: { c_mt: 2, c_stomper: 2, c_tank: 1, c_heli: 2 },
      towers: 1,
    },
    {
      id: 'eco',
      name: '偏經濟',
      steps: [
        { pop: 7, b: 'c_depot' },
        { pop: 9, b: 'c_extractor' },
        { pop: 11, b: 'c_hq' },
        { pop: 13, b: 'c_factory' },
        { pop: 16, b: 'c_depot' },
        { pop: 19, b: 'c_factory' },
      ],
      wk0: 20,
      mix: { c_mt: 1, c_shield: 1 },
      armyK: 1.15,
      attackK: 1.1,
      expandK: 0.6,
      hero: 'h_rain',
      heroes: ['h_rain', 'h_bastion', 'h_pile'],
      tech: { t2: 22, t3: 36 },
      research: ['r_exp', 'r_arm', 'r_shell', 'r_exp', 'r_arm', 'r_fort', 'r_barrel', 'r_exp', 'r_kin'],
      mix2: { c_mt: 1, c_shield: 1, c_tank: 1, c_mortar: 2 },
      mix3: { c_mt: 1, c_shield: 1, c_tank: 1, c_mortar: 1, c_arty: 2, c_heli: 1 },
      towers: 3,
    },
  ],
};

// 各陣營的建築角色（電腦對手用：補給、生產、抽取站、主堡）
// （F 包）works 研究、heavy 重工廠、pad 停機坪、market 補給商店、tower 防禦塔、flak 防空砲塔、wall 城牆、
// hq2／hq3 主堡的第 2、3 階（升級的目標）
export const RTS_AI_ROLES = {
  castron: {
    hq: 'c_hq',
    hq2: 'c_hq2',
    hq3: 'c_hq3',
    depot: 'c_depot',
    factory: 'c_factory',
    extractor: 'c_extractor',
    works: 'c_works',
    heavy: 'c_heavy',
    pad: 'c_helipad',
    market: 'c_market',
    tower: 'c_tower',
    flak: 'c_flak',
    wall: 'c_wall',
  },
};

// 難度：
//   dt 決策間隔（秒）、wkMax 工人上限、facMax 兵工廠上限、hqMax 主堡上限（含分礦）、armyMax 部隊上限（台）、
//   attackT 最早進攻（秒）、need0 第一次進攻的部隊門檻（台）、grow 每次進攻失敗後門檻增加、allInT 之後門檻降到 allInN、
//   focus 集火、retreat 打不過就撤退的戰力比（0＝不撤退；敵方戰力² > 我方² × retreat）、pull 撤回受傷的單位、
//   recall 基地被攻擊時召回進攻中的部隊、scoutT 派偵查的時間、expandT 開分礦的最早時間、repair 修理（'hq'＝只修主堡）、
//   income 資源收入倍率（只有瘋狂）、cheat 不受戰爭迷霧限制（只有瘋狂；rts-fog.js 依 cfg.diff 判斷）
// （R2 第二輪，F 包）hero1T 第 1 個英雄的時間、t2T／t3T 升級主堡的最早時間（1e9＝不升）、heroMax 英雄數上限
//   （第 2、3 個在升階之後）、creepTier 打野的營地等級上限、creepT 最早打野、creepLv 英雄幾級以上才打野、
//   creepFar 也搶對方那一側的營地、resMax 研究的級數上限（{ 研究 id: 級數 }，沒列的不研究；null＝全部）、
//   items 買道具（'none'｜'kit' 修復套件｜'all' 再加永久道具）、tavern 雇用酒館英雄的機率（開局時決定）、
//   cast 施放技能（'z'＝只用 Z、隨機時機；'rules'＝依 RTS_AI_CAST）、heroRetreat 英雄血量低於這個比例時撤回（0＝不撤）、
//   markFocus 集火被標定的目標、towerMax 防禦塔上限、walls 防禦塔旁蓋城牆、militia 基地被打而部隊不足時動員工人
export const RTS_AI_DIFFS = {
  easy: {
    hero1T: 180,
    t2T: 540,
    t3T: 1e9,
    heroMax: 2,
    creepTier: 1,
    creepT: 240,
    creepLv: 2,
    creepFar: false,
    resMax: { r_kin: 1 },
    items: 'none',
    tavern: 0,
    cast: 'z',
    heroRetreat: 0,
    markFocus: false,
    towerMax: 1,
    walls: false,
    militia: false,
    dt: 1,
    wkMax: 13,
    facMax: 1,
    hqMax: 1,
    armyMax: 14,
    attackT: 420,
    need0: 6,
    grow: 2,
    allInT: 1200,
    allInN: 6,
    focus: false,
    retreat: 0,
    pull: false,
    recall: false,
    scoutT: 150,
    expandT: 9999,
    repair: 'hq',
    income: 1,
  },
  normal: {
    hero1T: 105,
    t2T: 300,
    t3T: 660,
    heroMax: 3,
    creepTier: 2,
    creepT: 150,
    creepLv: 1,
    creepFar: false,
    resMax: { r_kin: 2, r_arm: 2 },
    items: 'kit',
    tavern: 0.3,
    cast: 'rules',
    heroRetreat: 0.25,
    markFocus: false,
    towerMax: 2,
    walls: true,
    militia: true,
    dt: 0.7,
    wkMax: 20,
    facMax: 2,
    hqMax: 3,
    armyMax: 32,
    attackT: 255,
    need0: 8,
    grow: 3,
    allInT: 780,
    allInN: 5,
    focus: true,
    retreat: 2,
    pull: false,
    recall: true,
    scoutT: 75,
    expandT: 330,
    repair: 'all',
    income: 1,
  },
  hard: {
    hero1T: 90,
    t2T: 240,
    t3T: 540,
    heroMax: 3,
    creepTier: 3,
    creepT: 120,
    creepLv: 1,
    creepFar: true,
    resMax: null,
    items: 'all',
    tavern: 0.5,
    cast: 'rules',
    heroRetreat: 0.25,
    markFocus: true,
    towerMax: 3,
    walls: true,
    militia: true,
    dt: 0.5,
    wkMax: 24,
    facMax: 3,
    hqMax: 3,
    armyMax: 46,
    attackT: 225,
    need0: 9,
    grow: 3,
    allInT: 840,
    allInN: 5,
    focus: true,
    retreat: 1.6,
    pull: true,
    recall: true,
    scoutT: 45,
    expandT: 200,
    repair: 'all',
    income: 1,
  },
  insane: {
    hero1T: 90,
    t2T: 225,
    t3T: 510,
    heroMax: 3,
    creepTier: 3,
    creepT: 120,
    creepLv: 1,
    creepFar: true,
    resMax: null,
    items: 'all',
    tavern: 0.5,
    cast: 'rules',
    heroRetreat: 0.25,
    markFocus: true,
    towerMax: 3,
    walls: true,
    militia: true,
    dt: 0.5,
    wkMax: 24,
    facMax: 4,
    hqMax: 3,
    armyMax: 50,
    attackT: 210,
    need0: 9,
    grow: 3,
    allInT: 840,
    allInN: 5,
    focus: true,
    retreat: 1.6,
    pull: true,
    recall: true,
    scoutT: 45,
    expandT: 200,
    repair: 'all',
    income: 1.5,
    cheat: true,
  },
};

// 英雄技能的施放條件（rts-ai.js 的 rtsAiCast；沒有列的技能用通用規則：敵方單位技能＝交戰中最強的敵人、
// 地點技能＝敵方單位聚集 3 台以上、自己＝附近敵人 3 台以上、友軍技能＝血量 < 50% 的友軍）
//   k：'cluster' 範圍內 n 台以上的敵方單位（或 bld 座建築）的中心；'line' 同 cluster、朝那個方向（飽和砲擊）；
//   'mark' 敵方英雄或血量最高的單位；'ally' 血量 < hp 的己方英雄或 units 裡的單位；'self' 英雄血量 < hp 而且 r 內敵人 ≥ n；
//   'ranged' 敵方的 defs 裡的單位或血量 < hp 的英雄；'armor' 重甲（arm）目標；'fan' 前方扇形 r 內 n 台以上
export const RTS_AI_CAST = {
  sk_rain: { k: 'cluster', n: 4, bld: 1, r: 8 },
  sk_barrage: { k: 'line', n: 4, bld: 1, r: 10 },
  sk_mark: { k: 'mark' },
  sk_plate: { k: 'ally', hp: 0.5 },
  sk_bulwark: { k: 'cluster', n: 3, r: 10, near: 26 },
  sk_fortress: { k: 'self', hp: 0.45, n: 6, r: 20 },
  sk_rush: { k: 'ranged', defs: ['c_arty', 'c_mortar'], hp: 0.3 },
  sk_pile: { k: 'armor', arm: 'heavy' },
  sk_quake: { k: 'fan', n: 4, r: 14 },
};
// 單位技能（電腦）：盾牆＝交戰中、敵人在 r 內；投擲貨櫃、火箭齊射＝範圍 r 內 n 台以上的敵方單位
export const RTS_AI_ABILS = {
  ab_wall: { r: 22 },
  ab_crate: { n: 3, r: 4 },
  ab_rockets: { n: 3, r: 6 },
};
// 永久道具的購買順序（items 'all'）
export const RTS_AI_ITEMS = ['i_fcs', 'i_plate', 'i_scope'];
