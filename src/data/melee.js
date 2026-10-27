// 近戰的招式圖（docs/melee-combo-design.md）：純函式，可以在 node 載入。
// 武器的 combo＝預設連段（照舊是一條直線，HUD、機甲庫、理論火力都看它），moves＝派生招式、衝刺斬、空中招式、處決；
// 段號（快照的 s.m、動作片段、客機）＝把 combo 與 moves 接起來的索引。招式之間以 id 互相參照（沒有 id 的 combo
// 招式用索引）。

// 這一招過了這個比例之後按近戰＝排入下一招（電腦；玩家照 MELEE_ASSIST 的 buf，可以更早按）
export const QUEUE_AT = 0.35;
// 玩家的輸入寬容（設定「近戰輸入輔助」ctrl.meleeAssist，預設寬鬆；近戰訓練一律寬鬆）：
//   buf＝這一招過了這個比例之後按近戰就記住下一招（先行輸入）；grace＝收招後幾秒內按近戰還是接下一招（不從第一招重來）；
// 方向派生只看按下近戰那一格按著的方向（meleeKeyDir），沒有前後的時間窗
export const MELEE_ASSIST = {
  easy: { buf: 0, grace: 0.35 },
  std: { buf: 0.15, grace: 0.2 },
};
export const meleeAssist = (k) => MELEE_ASSIST[k] || MELEE_ASSIST.easy;
// 被近戰打中的硬直（秒）：一般敵人照招式的 stun（沒寫時一般 0.32、終結技 0.6）；敵對 AC 最多 0.12；Boss 沒有
export const STUN_BASE = 0.32,
  STUN_FIN = 0.6,
  STUN_ACE = 0.12;
// 同一個目標連續被近戰打（comboHits）：第 DECAY_FROM 下起每下 ×DECAY_K，最低 DECAY_MIN
export const DECAY_FROM = 5,
  DECAY_K = 0.92,
  DECAY_MIN = 0.5;

const IDX = new WeakMap();
// 招式 id → 段號（依武器定義快取；pilotWeaponDef 的副本另外算）
function index(d) {
  let m = IDX.get(d);
  if (m) return m;
  m = new Map();
  const c = d.combo || [],
    mv = d.moves || [];
  c.forEach((st, i) => st.id && m.set(st.id, i));
  mv.forEach((st, i) => st.id && m.set(st.id, c.length + i));
  IDX.set(d, m);
  return m;
}
// 段號 → 招式（沒有時 null）
export function meleeMove(d, i) {
  if (!d || !d.combo || !(i >= 0)) return null;
  const n = d.combo.length;
  return i < n ? d.combo[i] : (d.moves && d.moves[i - n]) || null;
}
// 招式的參照（id 字串或段號）→ 段號（沒有時 −1）
export function meleeIdx(d, ref) {
  if (ref === undefined || ref === null || !d) return -1;
  if (typeof ref === 'number') return meleeMove(d, ref) ? ref : -1;
  const i = index(d).get(ref);
  return i === undefined ? -1 : i;
}
// 這一招之後接哪一招（dir＝方向派生的 'f'／'s'／'b'，'' 或沒給＝中立）：沒有時 −1
export function meleeNext(d, i, dir) {
  const st = meleeMove(d, i);
  if (!st) return -1;
  if (dir && st.dirs && st.dirs[dir] !== undefined) {
    const j = meleeIdx(d, st.dirs[dir]);
    if (j >= 0) return j;
  }
  // 預設連段的中途（最後一招以外）按方向：切換到武器起手的那條路線（d.start）
  if (dir && d.start && d.start[dir] !== undefined && i < d.combo.length - 1) {
    const j = meleeIdx(d, d.start[dir]);
    if (j >= 0 && j !== i) return j;
  }
  if (st.end) return -1;
  if (st.next !== undefined) return meleeIdx(d, st.next);
  return i < d.combo.length - 1 ? i + 1 : -1;
}
// 全部的招式（預設連段＋派生），索引＝段號
export function meleeAll(d) {
  return d && d.combo ? [...d.combo, ...(d.moves || [])] : [];
}
// 預設連段裡的第幾招（HUD 的「連擊 n/m」）；派生招式回傳 −1
export function meleeChainPos(d, i) {
  return d && d.combo && i >= 0 && i < d.combo.length ? i : -1;
}
// 方向派生（玩家）：按鍵／搖桿本身的方向（輸入軸：x＝右、z＝下，換成世界方向之前），和目標在哪裡無關：
// 上＝前、下＝後、左右＝側（各 ±60°；斜上、斜下算前、後）；side＝+1 右、−1 左
export function meleeKeyDir(x, z) {
  const l = Math.hypot(x, z);
  if (l < 0.3) return { k: '', side: 0 };
  const up = -z / l;
  if (up > 0.5) return { k: 'f', side: 0 };
  if (up < -0.5) return { k: 'b', side: 0 };
  return { k: 's', side: x >= 0 ? 1 : -1 };
}
// 敵人出招前的提示（docs/melee-combo-design.md 的「反擊的提示與放寬」）：紅色「!」（紅光、紅圈、警報、HUD 的大「!」）
// 在出手前 CUE_LEAD 秒出現，看到就按剛好趕上：一般敵人對玩家的近戰先停 CUE_LEAD 秒（出「!」）再揮刀，
// 預警招式（data/ai.js 的 MOVES）照原本的預警線，在準備結束（出手）前 CUE_LEAD 秒出「!」。「!」出現後到這一擊結束前
// 按近戰＝彈刀、按 QB＝完美迴避（MechEntity.cueArmSet），「!」之前按的不算。CUE_POST＝各預警招式的
// [準備秒數, 出手後還算的秒數]
export const CUE_LEAD = 0.3;
export const CUE_POST = {
  burst: [0.45, 1.3],
  aimShot: [0.7, 1.0],
  volley: [0.9, 2.2],
  charge: [0.8, 0.4],
  sweep: [0.8, 2.1],
  dash: [0.55, 1.4],
  lob: [0.55, 1.8],
  beep: [0.75, 3],
  strafeRun: [1.1, 2.6],
};
// 被打的硬直（秒）：kind＝'boss'｜'ace'｜''（一般）
export function meleeStun(st, kind) {
  if (kind === 'boss') return 0;
  const s = st.stun !== undefined ? st.stun : st.finisher ? STUN_FIN : STUN_BASE;
  return kind === 'ace' ? Math.min(s, STUN_ACE) : s;
}
// 傷害遞減的倍率（n＝這一下是第幾下）
export function comboDecay(n) {
  if (n < DECAY_FROM) return 1;
  return Math.max(DECAY_MIN, Math.pow(DECAY_K, n - DECAY_FROM + 1));
}

// ---------- 第 1 期：跨系統的連接與取消 ----------
// 近戰 → 射擊：這一招打中過、過了這個比例；目標在 LINK_SHOT_R（舊尺度 m）內時傷害 ×LINK_SHOT_K
export const LINK_SHOT_AT = 0.5,
  LINK_SHOT_R = 20,
  LINK_SHOT_K = 1.15;
// 射擊 → 近戰：對失衡中的目標突進距離最多放寬到 LUNGE_K 倍
export const LUNGE_K = 3;
// 近戰 → QB → 近戰：QB 取消後 RESUME_T 秒內再按近戰接回下一招；一個連段最多 QB_RESUME_MAX 次
export const RESUME_T = 0.6,
  QB_RESUME_MAX = 2;
// 左右手交替：一個連段最多換手幾次
export const SWAP_MAX = 4;
// 空中連段的下劈：往下的速度（舊尺度 m/s）
export const DIVE_V = 30;
// 側滑的招式（side）：突進方向從目標方向轉開的角度（rad）
export const SIDE_ANG = 1.05;

// ---------- 第 3 期：處決 ----------
// 近戰鍵按住 EXEC_HOLD 秒；目標在處決招式的 reach＋EXEC_R（舊尺度 m）內；AC 與精英受到 EXEC_ACE_K 的 AP；處決方回復 EXEC_HEAL 的 AP
export const EXEC_HOLD = 0.35,
  EXEC_R = 3,
  EXEC_ACE_K = 0.4,
  EXEC_HEAL = 0.05;

// ---------- 第 4 期：防禦反擊 ----------
// 彈刀：敵人硬直 PARRY_STUN 秒（Boss PARRY_STUN_BOSS）；之後 PARRY_T 秒內玩家的近戰必定打出失衡
export const PARRY_STUN = 1,
  PARRY_STUN_BOSS = 0.4,
  PARRY_T = 1;
// 完美 QB：QB 開始後 PQB_WIN 秒內被打到＝迴避（不受傷；PvP 照原本的無敵時間）；PQB_BUFF 秒內第一下近戰的衝擊 ×PQB_IMP、
// 突進 ×PQB_LUNGE；單人時頓格 PQB_SLOW 秒
export const PQB_WIN = 0.3,
  PQB_BUFF = 1.5,
  PQB_IMP = 2,
  PQB_LUNGE = 2,
  PQB_SLOW = 0.12;
// 盾擊：脈衝盾擋下攻擊後 SHIELD_BASH_T 秒內按近戰（每把近戰武器都有，parts.js 在載入時加進 moves）
export const SHIELD_BASH_T = 0.5;
export const SHIELD_BASH = {
  id: 'bash',
  name: '盾擊',
  dmg: 500,
  impact: 1400,
  dash: 10,
  dur: 0.36,
  arc: 120,
  reach: 4.2,
  kb: 16,
  lift: 0,
  stun: 0.8,
  clip: 'ram',
  end: true,
};
