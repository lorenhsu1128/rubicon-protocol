// 乘員（docs/crew-civilians-design.md 第 3 期）：哪些敵人有人、幾個人、怎麼出來。純資料。
// 鍵是 ENEMY_TYPES／FOES 的鍵（實體的 etype）。沒列的＝無人（無人機、固定砲台、護盾產生器、實驗體、全像投影、衛星…）。
// 敵對 AC（ace）與人形的 Boss 另外處理：駕駛員爬出來、站在原地拿槍射玩家（crowd.js 的 crewOf）。
export const CREW = {
  // 一般敵人
  mt: 1,
  mth: 1,
  mt_shot: 1,
  mt_gren: 1,
  mt_shield: 1,
  mt_mortar: 1,
  mt_stomp: 1,
  mt_cmd: 1,
  strider: 1,
  tank: 3,
  heli: 2,
  dropship: 2,
  // 地圖專屬敵人
  scav: 1,
  junk: 1,
  crane: 1,
  forklift: 1,
  patrol: 2,
  gunboat: 2,
  sprayer: 1,
  lurker: 1,
  skater: 1,
  spacemt: 1,
  flak: 1,
  vacuum: 1,
  jammer: 2,
  drill: 1,
  harpoon: 2,
  smoker: 2,
  ridgesniper: 1,
  blaster: 1,
  lamp: 1,
  riveter: 1,
  welder: 1,
  watercannon: 2,
  cryo: 1,
  icemortar: 1,
  zipline: 1,
  fueler: 2,
};
// 用降落傘下來的（飛在空中）
export const CREW_CHUTE = new Set(['heli', 'dropship']);
// 數值
export const CREW_K = {
  EARLY_AP: 0.15, // 多人乘員的機體 AP 低於這個比例時，可能先逃一人
  EARLY_P: 0.5, // 先逃的機率
  ESCAPE_P: 0.55, // 擊破時每個人逃出來的機率（其他的沒逃出來）
  GONE_R: 70, // 逃跑的人離所有玩家這麼遠、又跑了一段時間就消失
  GONE_T: 9,
  CHUTE_V: 4.5, // 降落傘的下降速度 m/s
  SHOOT_R: 110, // 駕駛員開槍的距離
  SHOOT_DT: [0.45, 0.9], // 開槍間隔
  SHOOT_DMG: 4, // 每發的傷害（幾乎為零，但有火花）
};
