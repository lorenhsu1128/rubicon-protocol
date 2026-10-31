// 空域的飛行（docs/air-combat-design.md）：高推力機甲的數值。公尺與秒（新尺度的公尺，不再乘 DS）。
// entities/mech-air.js（飛行）與 game/air.js（鏡頭、HUD）共用。
export const AIR = {
  CRUISE: 70, // 巡航（m/s）
  BOOST: 110, // 推進（按住前）
  AB: 150, // 突擊推進
  HOVER: 6, // 減速到底（懸停）
  SIDE: 24, // 橫移
  ACC: 32, // 加速（m/s²）
  DEC: 48, // 減速
  TURN: 1.05, // 轉向（rad/s，中速）
  TURN_HOVER: 2.2, // 懸停時原地轉身
  GTURN: 2, // 急轉彎的倍率
  GDRAG: 26, // 急轉彎的掉速（m/s²）
  PITCH_MAX: 1.45,
  CEIL: 1200, // 高度上限（m）
  EN_BOOST: 0.1, // 每秒耗 EN（最大 EN 的比例）
  EN_AB: 0.32,
  EN_G: 0.12,
  ROLL_IMP: 92, // 側滾翻的側移（m/s，之後衰減）
  FWD_IMP: 50, // 前滾翻的加速
  REV_T: 0.75, // 後空翻的秒數
  FLIP_T: 0.5, // 側滾翻、前滾翻的翻轉秒數
};
