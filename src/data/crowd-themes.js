// 各地圖主題的小人（docs/crew-civilians-design.md 第 4 期）：人物的外觀、人數、敵方步兵。純資料。
//   civ：平民的人數倍率；near：一群人圍著地圖物件做事的比例；inf：敵方步兵的小隊數 [最少, 最多]
//   look：平民的外觀 { shirt: [...], pants: [...], hat: [...]（null＝沒有帽子）}；soldier：步兵的外觀
//   顏色是 three.js 的 hex（r128 的 setHex 不做 sRGB 轉換，畫面上會亮一些）
const HI = 0xf2c230; // 黃色安全帽
const WH = 0xe8e8e8;

export const CROWD_THEMES = {
  // 貨運集散場：碼頭工人（反光背心、安全帽）
  industrial: {
    civ: 1.1,
    near: 0.7,
    inf: [1, 2],
    look: {
      shirt: [0xe8781e, 0xd8d02a, 0x2f5a8a, 0x4a4f56],
      pants: [0x2c3440, 0x3a3a3a],
      hat: [HI, HI, WH, 0xd05020],
    },
    soldier: { shirt: 0x4a4e3a, pants: 0x3a3d30, hat: 0x33362a },
  },
  // 模擬訓練場：全像的假人（淡藍色）
  grid: {
    civ: 0.6,
    near: 0.3,
    inf: [1, 2],
    look: { shirt: [0x5ab8e0, 0x7ad0f0], pants: [0x3a90c0], hat: [null] },
    soldier: { shirt: 0xe07050, pants: 0xb05040, hat: 0xb05040 },
  },
  // 礦坑遺跡：礦工
  desert: {
    civ: 1,
    near: 0.7,
    inf: [1, 2],
    look: {
      shirt: [0x8a6a42, 0x6a5a3e, 0xb08850, 0x4a4036],
      pants: [0x3e3428, 0x2c2a26],
      hat: [0xe08a20, HI, null],
    },
    soldier: { shirt: 0x7a6a4a, pants: 0x5a4c36, hat: 0x5a4c36 },
  },
  // 冰原：研究隊員（紅橙色的防寒衣）
  snow: {
    civ: 0.6,
    near: 0.6,
    inf: [1, 2],
    look: {
      shirt: [0xd04020, 0xe07020, 0x2a5a9a],
      pants: [0x3a3e48, 0xe0e0e0],
      hat: [0x2a2a2a, 0xd04020, null],
    },
    soldier: { shirt: 0xd8dade, pants: 0xc8cace, hat: 0xd8dade },
  },
  // 荒野：拾荒者
  wasteland: {
    civ: 0.7,
    near: 0.6,
    inf: [1, 3],
    look: {
      shirt: [0x6a5a4a, 0x5a4a3a, 0x7a6a50, 0x4a4a44],
      pants: [0x3a342c, 0x4a4036],
      hat: [null, null, 0x5a4a3a],
    },
    soldier: { shirt: 0x5a503c, pants: 0x4a4232, hat: 0x3a3428 },
  },
  // 沙丘：遊牧民（白與砂色的長袍、頭巾）
  dunes: {
    civ: 0.6,
    near: 0.5,
    inf: [1, 2],
    look: { shirt: [0xe0d6c0, 0xc8b48a, 0x8a5a3a], pants: [0xd0c4a8, 0x8a7a5a], hat: [0xe8e0d0, 0xc8b48a] },
    soldier: { shirt: 0xb8a070, pants: 0x9a8458, hat: 0xb8a070 },
  },
  // 汙染水沒市街：拾荒者（雨衣）
  flooded: {
    civ: 0.8,
    near: 0.6,
    inf: [1, 2],
    look: { shirt: [0xd8c020, 0x3a5a3a, 0x4a4a52], pants: [0x2a3028, 0x3a3a3a], hat: [0xd8c020, null] },
    soldier: { shirt: 0x34402e, pants: 0x2a3226, hat: 0x2a3226 },
  },
  // 多重水壩：工程師（藍色工作服、白色安全帽）
  dam: {
    civ: 1,
    near: 0.7,
    inf: [1, 2],
    look: { shirt: [0x2a5a9a, 0x3a6aaa, 0xe8781e], pants: [0x2a4a7a, 0x2c3440], hat: [WH, WH, HI] },
    soldier: { shirt: 0x4a5040, pants: 0x3a4034, hat: 0x33362a },
  },
  // 舊宇宙港：地勤（橘色連身服、白色頭盔）
  spaceport: {
    civ: 1,
    near: 0.7,
    inf: [1, 2],
    look: { shirt: [0xe8701e, 0xe0e0e0, 0x3a4a6a], pants: [0xe8701e, 0x3a3e48], hat: [WH, WH, null] },
    soldier: { shirt: 0x3e4248, pants: 0x34383e, hat: 0x2a2d30 },
  },
  // 巨型構造體 Grid 086：維修員
  grid086: {
    civ: 0.8,
    near: 0.7,
    inf: [1, 2],
    look: { shirt: [0x5a5e66, 0xd8b020, 0x3a3e46], pants: [0x2c3036, 0x4a4e56], hat: [HI, 0x5a5e66, null] },
    soldier: { shirt: 0x3a3e46, pants: 0x2c3036, hat: 0x2c3036 },
  },
  // 洋上都市 Xylem：市民（各種顏色）
  xylem: {
    civ: 1.3,
    near: 0.4,
    inf: [1, 2],
    look: {
      shirt: [0x3b6ea8, 0xd9822b, 0xb8b2a0, 0x9a4a32, 0x5a8a5a, 0xc8c2b0, 0x8a4a8a],
      pants: [0x2c3440, 0x4a4a42, 0x37465a, 0x5a4a38],
      hat: [null, null, null, 0xe8e8e8],
    },
    soldier: { shirt: 0x3a4a5a, pants: 0x2a3440, hat: 0x2a3440 },
  },
  // 高空軌道：真空作業服（白色、大頭盔）
  orbit: {
    civ: 0.6,
    near: 0.7,
    inf: [1, 2],
    look: { shirt: [0xe8e8e8, 0xd8d8d0], pants: [0xe0e0e0, 0xc8c8c0], hat: [WH] },
    soldier: { shirt: 0x5a5e66, pants: 0x4a4e56, hat: 0x5a5e66 },
  },
  // 地下技研都市：白衣的研究員、黑衣的保全
  institute: {
    civ: 1,
    near: 0.6,
    inf: [1, 3],
    look: {
      shirt: [0xf0f0f0, 0xf0f0f0, 0xe0e0e8, 0x2a2a30],
      pants: [0x3a3e48, 0x2a2a30],
      hat: [null, null, 0x1e1e22],
    },
    soldier: { shirt: 0x1e2024, pants: 0x1e2024, hat: 0x1e2024 },
  },
};
export const CROWD_THEME0 = CROWD_THEMES.industrial;
// 主線的區段類型：平民與步兵的倍率 [平民, 步兵]
export const CROWD_SEG = {
  battle: [1, 1],
  elite: [0.6, 0.5],
  destroy: [0.8, 1.3],
  defend: [0.6, 1.5],
  escort: [0.8, 1.3],
  breakthrough: [0.6, 1.6],
  supply: [1.6, 0],
  intel: [1.2, 0.8],
  boss: [0.4, 0],
};
// 敵方步兵的數值
export const INF_K = {
  SQUAD: [3, 4], // 一隊幾個人
  RANGE: 100, // 開槍的距離
  NEAR: 12, // 機甲這麼近時散開逃跑
  ROCKET_P: 0.25, // 拿火箭筒的比例
  ROCKET_DT: [7, 10], // 火箭筒的間隔
  ROCKET_V: 38, // 火箭的速度 m/s
  ROCKET_DMG: 30, // 火箭的傷害（一點點）
  ROCKET_R: 4, // 爆炸範圍
};
