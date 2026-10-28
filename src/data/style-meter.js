// 遠程射擊改版第 6 期「風格評價」（docs/ranged-design.md）：射擊與近戰共用的 Style 量表（D → SSS），純資料。
// 打得花俏（換武器、各種加成、弱點、屬性反應、強力彈、近戰的派生與連接、彈刀、完美 QB、處決、擊破）加分，
// 一直重複同一招加得越來越少；時間一久慢慢掉，被打中掉一截。判定在 entities/mech-style.js。
export const SY = {
  MAX: 1300,
  RANKS: [
    [0, 'D', '#8a94a6'],
    [80, 'C', '#9fd8ff'],
    [180, 'B', '#7fe8a0'],
    [320, 'A', '#ffd040'],
    [500, 'S', '#ff9a40'],
    [720, 'SS', '#ff6a50'],
    [1000, 'SSS', '#ff4ad0'],
  ],
  REPEAT: 0.6, // 最近 HIST 次裡同一招每出現一次，加分 ×0.6
  HIST: 6,
  DECAY: 14, // 每秒掉的分數（＋等級 × DECAY_RANK）
  DECAY_RANK: 7,
  IDLE: 1.2, // 加分後幾秒內不掉
  HURT_K: 0.75, // 被打中：分數 ×0.75 再 −HURT_PTS
  HURT_PTS: 25,
  ACS_UP: 0.06, // 升到新的等級：ACS 回復（ACS 上限 × 比例 × 等級）
  COAM: [1, 1, 1, 1, 1.05, 1.1, 1.2, 1.3], // 主線：擊破獎金依擊破時的等級（索引＝等級＋1，D 以下 0）
};

// 加分的種類：[基本分, 顯示的文字]（key 相同才算重複）
export const SY_EV = {
  hit: [3, ''], // 射擊打中（依傷害另外加，最多 SY_HIT_MAX）
  melee: [16, '近戰'],
  air: [10, '空中'],
  lunge: [8, '突進'],
  swap: [10, '換武器'],
  rb: [12, ''], // 邊閃邊打的加成：文字用加成的名稱
  crit: [10, 'CRITICAL'],
  interrupt: [30, 'INTERRUPT'],
  wpBreak: [25, '破壞'],
  rx: [30, ''], // 屬性反應：文字用反應的名稱
  pw: [25, ''], // 強力彈：文字用名稱
  stag: [25, 'BREAK'],
  pqb: [30, '完美迴避'],
  parry: [35, '彈刀'],
  link: [20, '近戰 ▸ 射擊'],
  resume: [12, 'QB 接回'],
  jc: [10, '跳躍取消'],
  exec: [40, '處決'],
  kill: [40, '擊破'],
  shotDown: [15, '擊落'],
};
export const SY_HIT_MAX = 25;

// 分數 → 等級索引（-1＝沒有等級）
export function syRank(pts) {
  let r = -1;
  for (let i = 0; i < SY.RANKS.length; i++) if (pts >= SY.RANKS[i][0] && pts > 0) r = i;
  return r;
}
