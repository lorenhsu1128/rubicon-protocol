// ---------- 第一人稱 ----------
export const FP_FOV = 75,
  TP_FOV = 42,
  CHASE_FOV = 62,
  FP_CONE = (15 * Math.PI) / 180;

// ---------- PVP ----------
export const PVP_TEAM_COLORS = ['#5cc8ff', '#ff6a6a'];
export const AI_DIFF = {
  easy: { hp: 0.8, dmg: 0.8, skill: 0.6, name: '簡單' },
  std: { hp: 1.0, dmg: 1.0, skill: 1.0, name: '標準' },
  hard: { hp: 1.2, dmg: 1.1, skill: 1.4, name: '困難' },
};

// ---------- 據點（outposts.js） ----------
export const GUARD_ALERT_R = 38; // 守衛發現玩家的距離
export const GUARD_MIN_D = GUARD_ALERT_R + 6; // 守衛生成時離玩家至少這麼遠（否則一開場就出動）
