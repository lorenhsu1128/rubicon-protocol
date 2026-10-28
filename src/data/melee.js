// 近戰的招式圖（docs/melee-combo-design.md）：純函式，可以在 node 載入。
// 武器的 combo＝預設連段（照舊是一條直線，HUD、機甲庫、理論火力都看它），moves＝派生招式、衝刺斬、空中招式、處決；
// 段號（快照的 s.m、動作片段、客機）＝把 combo 與 moves 接起來的索引。招式之間以 id 互相參照（沒有 id 的 combo
// 招式用索引）。

// 這一招過了這個比例之後按近戰＝排入下一招（電腦；玩家照 MELEE_ASSIST 的 buf，可以更早按）
export const QUEUE_AT = 0.35;
// 玩家的輸入寬容（設定「近戰輸入輔助」ctrl.meleeAssist，預設寬鬆；近戰訓練一律寬鬆）：
//   buf＝這一招過了這個比例之後按近戰就記住下一招（先行輸入）；grace＝收招後幾秒內按近戰還是接下一招（不從第一招重來）；
//   lead＝敵人的紅色「!」比這一擊打到早幾秒（CUE_LEAD 的段落）；
// 方向派生只看按下近戰那一格按著的方向（meleeKeyDir），沒有前後的時間窗
export const MELEE_ASSIST = {
  easy: { buf: 0, grace: 0.35, lead: 0.33 },
  std: { buf: 0.15, grace: 0.2, lead: 0.28 },
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
// 在這一擊打到前 lead 秒出現（目標玩家的 MELEE_ASSIST 的 lead；不是玩家時 CUE_LEAD），看到就按剛好趕上：
// 一般敵人對玩家的近戰先停 lead 秒（出「!」）再揮刀；預警招式（data/ai.js 的 MOVES）照原本的預警線，
// 「!」對著子彈飛到（或衝到）的時間，飛得久的在開火之後才出。「!」出現後到這一擊結束前按近戰＝彈刀、
// 按 QB＝完美迴避（MechEntity.cueArmSet），「!」之前按的不算。CUE_POST＝各預警招式的 [準備秒數, 出手後還算的秒數]
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

// ---------- 打擊感（docs/melee-combo-design.md 的「打擊感改版」）----------
// 招式的派生種類（音效、刀痕、受擊反應用）：'n' 預設連段、'f' 前派生、's' 側派生、'b' 後派生（上挑）、
// 'a' 空中、'd' 空中的下劈、'x' 衝刺斬、'e' 處決、'h' 盾擊
const CAT = new WeakMap();
export function meleeCat(d, i) {
  let m = CAT.get(d);
  if (!m) {
    m = new Map();
    const walk = (ref, k) => {
      for (let j = meleeIdx(d, ref), n = 0; j >= 0 && n < 8 && !m.has(j); n++) {
        const st = meleeMove(d, j);
        m.set(j, k === 'a' && st.dive ? 'd' : k);
        if (st.end || st.next === undefined || typeof st.next === 'number') break;
        j = meleeIdx(d, st.next);
      }
    };
    if (d.start) for (const k of ['f', 's', 'b']) if (d.start[k] !== undefined) walk(d.start[k], k);
    walk(d.airMoves, 'a');
    walk(d.dashMove, 'x');
    (d.moves || []).forEach((st, j) => {
      const idx = (d.combo || []).length + j;
      if (st.exec) m.set(idx, 'e');
      else if (st.id === 'bash') m.set(idx, 'h');
    });
    CAT.set(d, m);
  }
  return m.get(i) || 'n';
}
// 招式的重量（頓格、震動）：0 輕、1 一般、2 重（終結技）、3 極重（打樁機與大劍的終結技、處決的最後一下）
export function meleeWeight(d, st) {
  if (!st) return 1;
  if (st.weight !== undefined) return st.weight;
  if (st.finisher) return d.id === 'w_pile' || d.id === 'w_saber' ? 3 : 2;
  if (d.id === 'w_pile') return 2;
  return st.dur <= 0.22 ? 0 : 1;
}
// 依重量的頓格秒數（只有攻擊者與被打的目標停住，MechEntity.hitStopLocal）
export const HITSTOP = [0.04, 0.065, 0.1, 0.15];
// 頓格中的時間倍率
export const HITSTOP_K = 0.06;
// 打中之後提早接下一招：過了「出手的時間點＋CHAIN_AFTER」（且至少 CHAIN_MIN）就切進下一招，不等收招播完（玩家）
export const CHAIN_AFTER = 0.24,
  CHAIN_MIN = 0.6;
// 判定從出手的時間點前 STRIKE_PRE 開始（比例）
export const STRIKE_PRE = 0.06;

// ---------- 第 2 期：敵人依招式的受擊反應（animateMech 的 st.react）----------
// light 輕擊（小後仰）、slash 被斬（往被推的一側扭身）、thrust 被刺（往前彎腰、骨盆往後）、spin 被轉開（整台轉過去）、
// blow 被打飛（大後仰、往後滑、腳下揚塵）、launch 被挑飛（空中往後翻）、slam 被往下砸（空中時落地才倒）、
// down 倒地（跪地前屈，一般敵人另外硬直）、land 被挑飛之後落地（蹲一下）、held 被處決中（垂著頭撐住，每一下之間回到這個姿勢）
export function meleeReactOf(st) {
  if (!st) return 'light';
  if (st.react) return st.react;
  if (st.exec) return st.thrust ? 'thrust' : 'slash';
  if (st.launch) return 'launch';
  if (st.dive || st.slam) return 'slam';
  if (st.spin) return 'spin';
  if (st.finisher || st.kb >= 40) return 'blow';
  if (st.thrust) return 'thrust';
  if (st.dur <= 0.22) return 'light';
  return 'slash';
}
// 受擊動作的秒數（至少照被打的硬直；被挑飛／往下砸在空中時維持到落地）
export const REACT_T = {
  light: 0.3,
  slash: 0.42,
  thrust: 0.45,
  spin: 0.5,
  blow: 0.65,
  launch: 1.0,
  slam: 1.0,
  down: 0.85,
  land: 0.4,
  held: 1.2,
};
// 被打倒（down）時一般敵人的硬直秒數
export const DOWN_STUN = 0.7;
