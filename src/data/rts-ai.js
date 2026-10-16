// Coral 戰爭（RTS）電腦對手的資料表（純資料；行為在 game/rts-ai.js）：各陣營的開局建造順序與各難度的參數。
// 之後加陣營只要在 RTS_AI_OPENERS 加一組（建築與兵種的 id 換成該陣營的）。
//
// 開局（RTS_AI_OPENERS[陣營] 的一項）：
//   steps：依序執行的建造步驟 { pop, b }＝人口（含生產中的）達到 pop 時蓋 b（同一種建築第 n 次出現＝要有 n 座；
//          主堡的步驟＝開分礦）；步驟的資源會先保留（工人與部隊的生產讓路）。
//   wk0：開局期間（步驟還沒做完）的工人上限；之後用難度的 wkMax。
//   mix：部隊的生產比例 { 兵種 id: 權重 }（Coral 不夠時改生產不用 Coral 的）。
//   armyK：第一次進攻的部隊門檻倍率；attackK：最早進攻時間的倍率；expandK：開分礦時間的倍率。
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
      armyK: 1.3,
      attackK: 1.15,
      expandK: 0.6,
    },
  ],
};

// 各陣營的建築角色（電腦對手用：補給、生產、抽取站、主堡）
export const RTS_AI_ROLES = {
  castron: { hq: 'c_hq', depot: 'c_depot', factory: 'c_factory', extractor: 'c_extractor' },
};

// 難度：
//   dt 決策間隔（秒）、wkMax 工人上限、facMax 兵工廠上限、hqMax 主堡上限（含分礦）、armyMax 部隊上限（台）、
//   attackT 最早進攻（秒）、need0 第一次進攻的部隊門檻（台）、grow 每次進攻失敗後門檻增加、allInT 之後門檻降到 allInN、
//   focus 集火、retreat 打不過就撤退的戰力比（0＝不撤退；敵方戰力² > 我方² × retreat）、pull 撤回受傷的單位、
//   recall 基地被攻擊時召回進攻中的部隊、scoutT 派偵查的時間、expandT 開分礦的最早時間、repair 修理（'hq'＝只修主堡）、
//   income 資源收入倍率（只有瘋狂）、cheat 不受戰爭迷霧限制（只有瘋狂；rts-fog.js 依 cfg.diff 判斷）
export const RTS_AI_DIFFS = {
  easy: {
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
    dt: 0.7,
    wkMax: 20,
    facMax: 2,
    hqMax: 2,
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
