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
