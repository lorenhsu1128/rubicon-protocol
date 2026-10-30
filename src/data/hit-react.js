// 受擊反應改版（docs/hit-react-design.md）：每把武器的受擊特徵（純資料）。
// 觸發在 entities/mech-hit-react.js（房主／單機，hr 事件給客機），姿勢在 render/hit-react-pose.js。只改外觀：
// 判定、硬直、擊退照原本的數值。
//
// 欄位：T＝秒數；c＝時間曲線（snap 一下、bounce 回彈、shake 連續震、spasm 痙攣、burn 慢慢扭、heavy 大幅維持、
// lift 從下方掀起、press 從上方壓、delay 先黏住再爆）；
// 姿勢（舊尺度的弧度，乘上被推的方向）：b＝全身（連腿）往被推的方向倒、t＝上身後仰／側傾、tw＝上身扭轉、
// cr＝屈膝、fl＝往後翻；jit＝抖動的幅度、jf＝抖動的頻率；dr＝最後垂頭（痙攣之後）；
// 一開始的衝量：ka＝兩手往外甩（負的＝往內縮）、kh＝頭、kp＝背包、kb＝肩上武器；
// pr＝持續挨打的累積（機槍類：被壓著縮身、往後退）；m＝同一種在這個秒數內再打中時合併成同一個（霰彈的彈丸）；
// alt＝每一發左右交替（導彈的連串爆炸）；hold＝持續照射（雷射：再打中時延長而不是重來）
export const HR = {
  // ---- 手持 ----
  rifle: { T: 0.3, c: 'snap', b: 0.05, t: 0.24, tw: 0.22, cr: 0.02, ka: 0.8, kh: 2.2, kp: 1.2 }, // 短促後仰，打頭時頭往後甩
  pistol: { T: 0.26, c: 'bounce', b: 0.02, t: 0.16, tw: 0.36, ka: 0.5, kh: 1.4, m: 0.04 }, // 輕快、扭一下就彈回來
  mg: { T: 0.32, c: 'shake', b: 0.03, t: 0.08, tw: 0.1, jit: 0.07, jf: 41, ka: -0.6, kh: 0.8, pr: 0.12 }, // 高頻小震、縮身
  shotgun: { T: 0.52, c: 'snap', b: 0.13, t: 0.34, tw: 0.12, cr: 0.1, ka: 3.6, kh: 2.4, kp: 2.4, m: 0.06 }, // 整台推開、手腳張開
  lshotgun: {
    T: 0.7,
    c: 'snap',
    b: 0.11,
    t: 0.28,
    tw: 0.18,
    cr: 0.08,
    jit: 0.05,
    jf: 23,
    ka: 2.8,
    kh: 2,
    kp: 1.8,
    m: 0.06,
  }, // 推開＋燒灼的抽搐
  rocket: {
    T: 0.85,
    c: 'heavy',
    b: 0.22,
    t: 0.5,
    tw: 0.2,
    cr: 0.14,
    fl: 0.12,
    ka: 3.4,
    kh: 3.4,
    kp: 3.6,
    kb: 3,
  }, // 大幅後仰
  grenade: { T: 0.75, c: 'lift', b: 0.32, t: 0.18, tw: 0.3, cr: 0.16, ka: 2.6, kh: -1.6, kp: 2.6, kb: 2 }, // 從腳下掀起：側翻
  emp: { T: 0.95, c: 'spasm', t: 0.06, cr: 0.12, jit: 0.13, jf: 31, dr: 0.28, ka: -1.2, kh: -2, kp: 0.8 }, // 通電痙攣、垂手垂頭
  laser: { T: 0.5, c: 'burn', b: 0.03, t: 0.14, tw: 0.55, cr: 0.03, ka: 0.6, kh: 1, hold: 1 }, // 被燒的那一點往後扭
  lcannon: {
    T: 0.95,
    c: 'heavy',
    b: 0.26,
    t: 0.42,
    tw: 0.32,
    cr: 0.16,
    jit: 0.025,
    jf: 17,
    ka: 3,
    kh: 2.6,
    kp: 3,
  }, // 大力推開、晃
  // ---- 肩上 ----
  missile: { T: 0.4, c: 'snap', b: 0.07, t: 0.2, tw: 0.3, cr: 0.06, ka: 1.4, kh: 1.6, kp: 1.6, alt: 1 }, // 連串的爆炸左右晃
  hmissile: { T: 0.8, c: 'heavy', b: 0.18, t: 0.4, tw: 0.16, cr: 0.24, ka: 2.4, kh: 2.8, kp: 3.8, kb: 3.2 }, // 一次大晃、壓低
  plasma: {
    T: 0.95,
    c: 'delay',
    d: 0.36,
    b: 0.16,
    t: 0.36,
    tw: 0.24,
    cr: 0.1,
    jit: 0.06,
    jf: 27,
    ka: 3,
    kh: 2.4,
    kp: 2.6,
  }, // 黏住延遲爆開
  howitzer: { T: 0.8, c: 'press', b: 0.05, t: 0.34, cr: 0.34, ka: 1.8, kh: -2.6, kp: -2.4, kb: -2 }, // 從上方往下壓
  empS: { T: 0.8, c: 'spasm', t: 0.05, cr: 0.1, jit: 0.1, jf: 37, dr: 0.18, ka: -1, kh: -1.6, kp: 0.6 }, // 短的痙攣
  empL: { T: 1.45, c: 'spasm', t: 0.08, cr: 0.3, jit: 0.15, jf: 26, dr: 0.42, ka: -1.6, kh: -2.6, kp: 1.2 }, // 長痙攣、膝蓋軟掉
  lbeam: {
    T: 1.05,
    c: 'burn',
    b: 0.2,
    t: 0.38,
    tw: 0.62,
    cr: 0.14,
    jit: 0.03,
    jf: 15,
    ka: 2.4,
    kh: 2,
    kp: 2.6,
    kb: 2.4,
  }, // 大雷射：被推著扭
  gatling: {
    T: 0.34,
    c: 'shake',
    b: 0.04,
    t: 0.1,
    tw: 0.08,
    jit: 0.1,
    jf: 33,
    ka: -0.9,
    kh: 1,
    kp: 0.6,
    pr: 0.17,
  }, // 機槍的強版
  // ---- 沒有武器 id 的攻擊（Boss 招式、地形、環境）：依屬性 ----
  blast: { T: 0.65, c: 'heavy', b: 0.16, t: 0.36, tw: 0.14, cr: 0.12, ka: 2.4, kh: 2.4, kp: 2.6 }, // 爆炸、衝擊波
  burn: { T: 0.45, c: 'burn', b: 0.03, t: 0.16, tw: 0.4, cr: 0.04, ka: 0.8, kh: 1.2, hold: 1 }, // 光束、能量環
  hit: { T: 0.28, c: 'snap', b: 0.04, t: 0.18, tw: 0.16, ka: 0.6, kh: 1.4, kp: 1 }, // 其他實彈
};
// 網路用的編號（hr 事件）
export const HR_KEYS = Object.keys(HR);
export const HR_IDX = Object.fromEntries(HR_KEYS.map((k, i) => [k, i]));
// 武器 id → 受擊特徵（每把武器各自一種）
export const HR_OF_WEAPON = {
  w_rifle: 'rifle',
  w_mg: 'mg',
  w_hg: 'pistol',
  w_sg: 'shotgun',
  w_lsg: 'lshotgun',
  w_bz: 'rocket',
  w_gl: 'grenade',
  w_emp: 'emp',
  w_lr: 'laser',
  w_lc: 'lcannon',
  bw_ms: 'missile',
  bw_ms8: 'hmissile',
  bw_pm: 'plasma',
  bw_gr: 'howitzer',
  bw_emp_s: 'empS',
  bw_emp_l: 'empL',
  bw_lc: 'lbeam',
  bw_gat: 'gatling',
};
// 沒有登記的武器依種類
const HR_OF_TYPE = {
  bullet: 'rifle',
  shotgun: 'shotgun',
  shell: 'rocket',
  grenade: 'grenade',
  empbeam: 'emp',
  emp: 'empS',
  laser: 'laser',
  missile: 'missile',
};
// 這一下的受擊特徵：W＝武器定義（weaponById）、attr＝屬性、splash＝爆炸（沒有方向）
export function hrKindOf(W, attr, splash) {
  if (W) return HR_OF_WEAPON[W.id] || HR_OF_TYPE[W.type] || 'hit';
  if (attr === 'exp' || splash) return 'blast';
  if (attr === 'en') return 'burn';
  if (attr === 'none') return null; // 水流等環境傷害：照原本的通用反應
  return 'hit';
}
// 受擊動作的幅度：一般敵人完整，敵對 AC／精英約一半，Boss 約三成（霸體），玩家操作的機體稍小
export function hrWeight(e) {
  if (e.isBoss) return 0.3;
  if (e.pilotEnt && e.pilotEnt()) return 0.65;
  if (e.ace || e.ai === 'ac' || e.isElite) return 0.5;
  return 1;
}

// ---------- 近戰：每一招自己的受擊變化（第 2 期）----------
// 加在招式的基本反應（data/melee.js 的 meleeReactOf：light、slash、thrust、spin、blow、launch、slam…）上面，
// 依武器 id 與段號（combo 接 moves 的索引，和 meleeAll 的順序相同）。欄位（舊尺度的弧度，乘上反應的包絡）：
// rx／flip＝全身往後仰／往後翻（負的＝往前）、rz／yaw／tz／tw＝側傾、轉身、上身側傾、上身扭轉（乘上被推的那一側 sd）、
// tx＝上身後仰（負的＝往前彎）、crouch＝屈膝；osc＝[欄位, 幅度, 頻率] 的來回抖（撕扯、連刺、震波）；
// 一開始的衝量 ka（兩手往外甩）、kh（頭往後甩，負的＝往前垂）、kp（背包）
const BASH = { tx: -0.25, rx: 0.1, crouch: 0.15, ka: 1.5, kp: 2 }; // 盾擊：每把武器共用同一招
export const MELEE_HR = {
  w_blade: [
    { tz: 0.12, tw: -0.12 }, // 橫斬：斜斜被掃開
    { tx: 0.12, tw: 0.3, crouch: 0.05 }, // 逆斬：反手，扭得多
    { tx: -0.35, rx: 0.15, crouch: 0.1, kh: -2 }, // 突刺：肚子被刺穿、往前折再被頂飛
    { osc: ['tx', 0.12, 30] }, // 突刺連打 1
    { osc: ['tx', 0.16, 26], tw: 0.1 }, // 突刺連打 2
    { osc: ['tx', 0.2, 22], tw: -0.15, crouch: 0.08 }, // 突刺連打 3
    { flip: 0.35, rx: 0.15, tx: 0.2, ka: 3 }, // 踢開：被踢飛、翻滾
    { yaw: -0.4, crouch: 0.08 }, // 側滑迴旋斬：多轉一點
    { flip: 0.2, kh: 2 }, // 上挑
    { rx: -0.1, tz: 0.15 }, // 空中斬
    { rx: 0.1, tz: -0.2, tw: 0.3 }, // 空中逆斬
    { flip: -0.25 }, // 下劈：往前栽得更多
    { yaw: -0.3, tw: -0.2, rz: -0.1 }, // 衝刺斬：被帶著轉
    { tx: -0.2, osc: ['rz', 0.06, 40], kh: -2.5 }, // 處決・刺穿：被刺著發抖
    BASH,
  ],
  w_saber: [
    { tw: -0.25, tx: 0.15 }, // 斬：重的一刀
    { tw: 0.35, rz: -0.12, crouch: 0.08 }, // 斬（回砍）
    { yaw: -0.6, rx: 0.1 }, // 迴旋斬
    { crouch: 0.15, tx: -0.25, kh: -2.5 }, // 下劈：被劈得蹲下
    { tx: -0.3, rx: 0.2 }, // 突進刺
    { yaw: -0.8, rz: -0.15, crouch: 0.1 }, // 大迴旋：轉最多
    { flip: 0.35, tx: 0.1, ka: 2.5 }, // 斬上
    { tz: -0.25, rx: 0.12 }, // 空中斬
    { flip: -0.4, crouch: 0.1 }, // 空中大斬
    { yaw: -0.5, rz: 0.12 }, // 衝刺斬
    { tw: 0.6, tx: 0.3, rx: -0.15, osc: ['tw', 0.05, 9] }, // 處決・兩斷：上下半身錯開
    BASH,
  ],
  w_claw: [
    { tz: 0.12, tw: -0.1 }, // 爪
    { tz: -0.14, tw: 0.14 }, // 爪（另一手）
    { tx: 0.2, crouch: 0.06, ka: -1.5 }, // 雙爪：兩邊夾住
    { osc: ['tz', 0.12, 18] }, // 撕裂：左右被扯
    { tx: -0.4, rx: 0.25, kh: -2 }, // 貫穿
    { rx: -0.2, tx: -0.25, ka: -2 }, // 抓住：被往前拉
    { osc: ['tw', 0.35, 16] }, // 撕扯：左右甩
    { tw: 0.5, rz: -0.15, ka: 2.5 }, // 撕開：被扯開甩出去
    { yaw: -0.3, osc: ['tz', 0.1, 14] }, // 迴旋爪
    { flip: -0.15, rz: 0.2 }, // 上撈：從側面撈起來
    { rx: -0.12, osc: ['tx', 0.08, 25] }, // 空中爪
    { rx: 0.1, tw: 0.25 }, // 空中爪（另一手）
    { tw: 0.3, flip: -0.15 }, // 下撕
    { tw: -0.4, tz: 0.18 }, // 衝刺爪
    { osc: ['tw', 0.25, 12], crouch: 0.15 }, // 處決・撕裂
    BASH,
  ],
  w_pile: [
    { tx: 0.3, rx: 0.15, kh: 2.5 }, // 撞擊：正面撞上
    { rx: 0.3, tx: 0.35, osc: ['rz', 0.05, 35], kp: 3 }, // 樁擊：被打穿、震波發抖
    { rx: 0.35, flip: 0.15 }, // 衝刺樁擊
    { flip: 0.5, ka: 3 }, // 上頂：被頂得翻過去
    { crouch: 0.25, flip: -0.1, osc: ['tx', 0.08, 30] }, // 空中樁擊：砸進地面
    { rx: 0.25, rz: 0.2 }, // 衝刺撞擊
    { tx: -0.3, osc: ['tx', 0.15, 8] }, // 處決・打穿：每一下往前頓
    BASH,
  ],
  w_fist: [
    { tx: 0.2, kh: 3 }, // 直拳：頭往後甩
    { tw: 0.45, tz: -0.15, kh: 1.5 }, // 勾拳：頭被打偏
    { tx: -0.45, crouch: 0.12, kh: -2.5 }, // 重擊：打在肚子、彎腰
    { tw: -0.3, tx: -0.2 }, // 突進肘擊
    { yaw: -0.7, rz: -0.2 }, // 迴旋踢
    { flip: 0.25, tx: 0.35, kh: 3.5 }, // 上勾拳：下巴被打上去
    { tz: 0.15, rx: 0.08 }, // 空中拳
    { flip: -0.35, tx: -0.1 }, // 下踢
    { rx: 0.12, tx: 0.25, yaw: -0.2 }, // 衝刺拳
    { osc: ['tw', 0.3, 20] }, // 處決・連打：左右被打
    BASH,
  ],
};
// 近戰受擊的變化：v＝'武器 id:段號'（reactSet 的第 5 個參數、rx 事件的 v）
export function meleeHrOf(v) {
  if (!v) return null;
  const i = v.lastIndexOf(':');
  const L = MELEE_HR[v.slice(0, i)];
  return (L && L[+v.slice(i + 1)]) || null;
}
