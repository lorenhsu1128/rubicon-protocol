// 近戰的關鍵影格動作（機甲動作改版第二期，docs/mech-animation.md）：每個連段招式一個動作片段（clip），
// 時間以招式的進度 0～1 表示（招式長度照武器資料，判定與時間不受動作影響）。
// - clip：{ name, keys: [{ t, e, p: { 關節: [各軸的值] } }] }；角度用「度」、壓低用公尺；e＝到這個關鍵影格的緩動。
//   每個關節各自一條軌跡（只在有寫它的關鍵影格之間內插），沒有寫的關節照程式算的姿勢。
// - 片段是為右手武器做的；左手武器左右鏡像（mirrorPose）。
// - 資料來源：預設片段（TEMPLATES）＜內建 src/assets/anims/melee.json（模型庫的動作編輯器匯出後放回）＜
//   單人時模型庫動作編輯器存在瀏覽器的版本（localStorage rubicon_melee_anim；多人一律用內建，各端一致）。
import BUILTIN from '../assets/anims/melee.json';
import { meleeMove } from '../data/melee.js';

// 關節：[鍵, 名稱, 軸]；值的單位：drop 是公尺，其他是度
export const MJ = [
  ['twist', '上身扭轉', ['y']],
  ['torso', '上身', ['x', 'z']],
  ['hip', '下半身朝向', ['y']],
  ['drop', '壓低（公尺）', ['y']],
  ['root', '骨盆位移（公尺：前、右）', ['z', 'x']],
  ['head', '頭', ['x', 'y']],
  ['upR', '右上臂', ['x', 'y', 'z']],
  ['foreR', '右前臂', ['x', 'y']],
  ['wpnR', '右手武器', ['x', 'y', 'z']],
  ['upL', '左上臂', ['x', 'y', 'z']],
  ['foreL', '左前臂', ['x', 'y']],
  ['wpnL', '左手武器', ['x', 'y', 'z']],
  ['thighR', '右大腿', ['x', 'y', 'z']],
  ['kneeR', '右膝', ['x']],
  ['footR', '右腳掌', ['x']],
  ['thighL', '左大腿', ['x', 'y', 'z']],
  ['kneeL', '左膝', ['x']],
  ['footL', '左腳掌', ['x']],
];
export const MJ_AXES = Object.fromEntries(MJ.map(([k, , a]) => [k, a]));
// 單位是公尺的關節（其他是度）
export const isLen = (j) => j === 'drop' || j === 'root';
// 緩動（到下一個關鍵影格的曲線）
export const EASES = [
  ['io', '緩入緩出'],
  ['out', '快出（爆發）'],
  ['in', '慢起（蓄力）'],
  ['lin', '等速'],
  ['back', '過衝'],
  ['hold', '停住（瞬間切換）'],
];
const EASE = {
  lin: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - (1 - u) ** 3,
  io: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  back: (u) => {
    const c = 1.9;
    return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
  },
  hold: (u) => (u < 1 ? 0 : 1),
};
const D2R = Math.PI / 180;

// ---------- 預設片段 ----------
// 腿：腳掌照大腿＋膝補回水平
const leg = (s, th, kn, ab = 0) => ({
  ['thigh' + s]: [th, 0, s === 'R' ? ab : -ab],
  ['knee' + s]: [kn],
  ['foot' + s]: [-(th + kn)],
});
const legs = (r, l) => ({ ...leg('R', ...r), ...leg('L', ...l) });
const STAND = legs([5, -12, 4], [5, -12, 4]);
const LUNGE_R = legs([45, -60, 6], [-28, -12, 6]); // 右腳在前的弓箭步
const LUNGE_L = legs([-28, -12, 6], [45, -60, 6]);
const GUARD_L = { upL: [20, 0, -20], foreL: [80, 0] };
const K = (t, e, p) => ({ t, e, p });
// 右手片段的強度變化（大劍放大、爪縮小）：扭轉、手臂的 y／z、壓低乘上倍率
function scaled(clip, name, k) {
  return {
    name,
    hit: clip.hit,
    keys: clip.keys.map((key) => {
      const p = {};
      for (const [j, v] of Object.entries(key.p))
        p[j] =
          j === 'twist' || j === 'drop' || j === 'root'
            ? v.map((x) => x * k)
            : j === 'upR'
              ? [v[0], v[1] * k, v[2] * k]
              : v.slice();
      return { t: key.t, e: key.e, p };
    }),
  };
}
const SLASH = {
  name: '橫斬',
  keys: [
    K(0, 'out', {
      twist: [25],
      torso: [4, 0],
      upR: [55, 30, 40],
      foreR: [95, 0],
      wpnR: [0, 0, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.02],
      hip: [0],
    }),
    K(0.22, 'in', {
      twist: [50],
      torso: [8, 0],
      upR: [70, 45, 55],
      foreR: [115, 0],
      wpnR: [-25, 0, 0],
      drop: [0.06],
      hip: [10],
    }),
    K(0.38, 'out', {
      twist: [-35],
      torso: [-16, 0],
      upR: [82, -30, 12],
      foreR: [12, 0],
      wpnR: [15, 0, 0],
      ...LUNGE_R,
      drop: [0.16],
      hip: [-10],
    }),
    K(0.62, 'io', { twist: [-48], torso: [-18, 0], upR: [72, -50, 18], foreR: [22, 0], drop: [0.14] }),
    K(1, 'io', {
      twist: [-12],
      torso: [-6, 0],
      upR: [50, -20, 20],
      foreR: [60, 0],
      wpnR: [0, 0, 0],
      ...STAND,
      drop: [0.04],
      hip: [0],
    }),
  ],
};
const SLASH_B = {
  name: '逆斬',
  keys: [
    K(0, 'out', {
      twist: [-25],
      torso: [4, 0],
      upR: [60, -35, 5],
      foreR: [100, 0],
      wpnR: [0, 0, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.02],
      hip: [0],
    }),
    K(0.22, 'in', {
      twist: [-50],
      torso: [8, 0],
      upR: [70, -55, -5],
      foreR: [112, 0],
      wpnR: [-20, 0, 0],
      drop: [0.06],
      hip: [-10],
    }),
    K(0.38, 'out', {
      twist: [38],
      torso: [-16, 0],
      upR: [80, 35, 50],
      foreR: [15, 0],
      wpnR: [15, 0, 0],
      ...LUNGE_L,
      drop: [0.16],
      hip: [10],
    }),
    K(0.62, 'io', { twist: [50], torso: [-18, 0], upR: [65, 55, 60], foreR: [25, 0], drop: [0.14] }),
    K(1, 'io', {
      twist: [12],
      torso: [-6, 0],
      upR: [50, 20, 30],
      foreR: [60, 0],
      wpnR: [0, 0, 0],
      ...STAND,
      drop: [0.04],
      hip: [0],
    }),
  ],
};
const THRUST = {
  name: '突刺',
  keys: [
    K(0, 'out', {
      twist: [15],
      torso: [6, 0],
      upR: [10, 0, 12],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.02],
    }),
    K(0.3, 'in', {
      twist: [30],
      torso: [14, 0],
      upR: [-30, 0, 8],
      foreR: [115, 0],
      drop: [0.07],
      ...legs([20, -30, 4], [0, -15, 4]),
    }),
    K(0.42, 'out', {
      twist: [-20],
      torso: [-26, 0],
      upR: [104, 0, 4],
      foreR: [2, 0],
      drop: [0.2],
      ...legs([55, -75, 6], [-35, -8, 6]),
    }),
    K(0.75, 'io', { twist: [-15], torso: [-22, 0], upR: [100, 0, 4], foreR: [5, 0], drop: [0.17] }),
    K(1, 'io', { twist: [0], torso: [-5, 0], upR: [45, 0, 12], foreR: [60, 0], drop: [0.03], ...STAND }),
  ],
};
const SLAM = {
  name: '下劈',
  keys: [
    K(0, 'out', {
      twist: [10],
      torso: [10, 0],
      upR: [100, 0, 20],
      foreR: [40, 0],
      upL: [60, 0, -25],
      foreL: [60, 0],
      ...STAND,
      drop: [0],
    }),
    K(0.35, 'in', {
      twist: [5],
      torso: [24, 0],
      upR: [160, 0, 10],
      foreR: [25, 0],
      upL: [140, 0, -10],
      foreL: [40, 0],
      drop: [-0.05],
      ...legs([10, -8, 4], [10, -8, 4]),
    }),
    K(0.48, 'out', {
      twist: [0],
      torso: [-32, 0],
      upR: [50, 0, 8],
      foreR: [35, 0],
      upL: [45, 0, -10],
      foreL: [40, 0],
      drop: [0.28],
      ...legs([50, -85, 8], [25, -60, 8]),
    }),
    K(0.8, 'io', { torso: [-28, 0], upR: [48, 0, 8], foreR: [38, 0], drop: [0.24] }),
    K(1, 'io', {
      twist: [0],
      torso: [-6, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...GUARD_L,
      drop: [0.04],
      ...STAND,
    }),
  ],
};
const SPIN = {
  name: '迴旋斬',
  hit: 0.2, // 出手的時間點（clipStrike）：迴旋一開始轉就算
  keys: [
    K(0, 'out', {
      twist: [0],
      torso: [-6, 0],
      upR: [60, 0, 50],
      foreR: [40, 0],
      upL: [50, 0, -50],
      foreL: [40, 0],
      ...STAND,
      drop: [0.05],
    }),
    K(0.15, 'in', {
      twist: [-35],
      torso: [-10, 0],
      upR: [75, 0, 70],
      foreR: [15, 0],
      upL: [70, 0, -75],
      foreL: [15, 0],
      drop: [0.1],
      ...legs([20, -40, 10], [20, -40, 10]),
    }),
    K(0.85, 'out', {
      twist: [360],
      torso: [-14, 0],
      upR: [80, 0, 75],
      foreR: [10, 0],
      upL: [70, 0, -75],
      foreL: [15, 0],
      drop: [0.12],
    }),
    K(1, 'io', {
      twist: [360],
      torso: [-6, 0],
      upR: [55, 0, 30],
      foreR: [55, 0],
      ...GUARD_L,
      drop: [0.04],
      ...STAND,
    }),
  ],
};
const RAM = {
  name: '撞擊',
  keys: [
    K(0, 'out', {
      twist: [30],
      torso: [8, 0],
      upR: [30, 0, 25],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
    }),
    K(0.3, 'in', {
      twist: [45],
      torso: [12, 0],
      upR: [10, 0, 20],
      foreR: [120, 0],
      drop: [0.1],
      ...legs([20, -40, 6], [0, -20, 6]),
    }),
    K(0.45, 'out', {
      twist: [-25],
      torso: [-30, 0],
      upR: [75, 0, 10],
      foreR: [30, 0],
      drop: [0.2],
      ...LUNGE_R,
    }),
    K(1, 'io', { twist: [0], torso: [-5, 0], upR: [45, 0, 15], foreR: [60, 0], drop: [0.03], ...STAND }),
  ],
};
const PILE = {
  name: '樁擊',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [6, 0],
      upR: [20, 0, 15],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
    }),
    K(0.45, 'in', {
      twist: [40],
      torso: [18, 0],
      upR: [-40, 0, 10],
      foreR: [125, 0],
      drop: [0.12],
      ...legs([25, -45, 6], [-5, -25, 6]),
    }),
    K(0.55, 'out', {
      twist: [-25],
      torso: [-30, 0],
      upR: [106, 0, 3],
      foreR: [0, 0],
      drop: [0.25],
      ...legs([60, -85, 6], [-38, -6, 6]),
    }),
    K(0.85, 'io', { torso: [-26, 0], upR: [103, 0, 3], foreR: [3, 0], drop: [0.22] }),
    K(1, 'io', { twist: [0], torso: [-5, 0], upR: [45, 0, 15], foreR: [60, 0], drop: [0.03], ...STAND }),
  ],
};
const PUNCH = {
  name: '直拳',
  keys: [
    K(0, 'out', {
      twist: [10],
      torso: [0, 0],
      upR: [40, 0, 15],
      foreR: [110, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
    }),
    K(0.25, 'in', { twist: [20], torso: [5, 0], upR: [20, 0, 12], foreR: [125, 0], drop: [0.06] }),
    K(0.4, 'out', {
      twist: [-25],
      torso: [-14, 0],
      upR: [96, 0, 4],
      foreR: [5, 0],
      drop: [0.1],
      ...legs([30, -40, 6], [-15, -12, 6]),
    }),
    K(1, 'io', { twist: [0], torso: [-3, 0], upR: [45, 0, 15], foreR: [90, 0], drop: [0.03], ...STAND }),
  ],
};
const HOOK = {
  name: '勾拳',
  keys: [
    K(0, 'out', {
      twist: [-10],
      upR: [40, 0, 15],
      foreR: [110, 0],
      upL: [40, 0, -15],
      foreL: [110, 0],
      ...STAND,
      drop: [0.03],
    }),
    K(0.25, 'in', { twist: [-25], torso: [4, 0], upL: [55, -20, -60], foreL: [100, 0], drop: [0.06] }),
    K(0.42, 'out', {
      twist: [35],
      torso: [-10, 0],
      upL: [85, 40, -30],
      foreL: [60, 0],
      drop: [0.1],
      ...legs([-15, -12, 6], [30, -40, 6]),
    }),
    K(1, 'io', { twist: [0], torso: [-3, 0], ...GUARD_L, drop: [0.03], ...STAND }),
  ],
};
const HEAVY = {
  name: '重擊',
  keys: [
    K(0, 'out', {
      twist: [15],
      torso: [4, 0],
      upR: [30, 0, 20],
      foreR: [110, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
    }),
    K(0.35, 'in', {
      twist: [45],
      torso: [15, 0],
      upR: [-20, 0, 15],
      foreR: [130, 0],
      drop: [0.1],
      ...legs([20, -35, 6], [0, -20, 6]),
    }),
    K(0.5, 'out', {
      twist: [-35],
      torso: [-28, 0],
      upR: [104, 0, 3],
      foreR: [0, 0],
      drop: [0.24],
      ...legs([55, -78, 6], [-35, -8, 6]),
    }),
    K(1, 'io', { twist: [0], torso: [-5, 0], upR: [45, 0, 15], foreR: [70, 0], drop: [0.03], ...STAND }),
  ],
};
// 第四期（docs/mech-animation.md）：預設片段整體放大（扭轉、上身、下半身朝向、壓低、手臂的 y／z、腿），
// 並加上骨盆位移 root（出招時往前送＝跨步突進；只是外觀，位移與判定照武器資料）
function amp(clip, k, roots) {
  const kl = 1 + (k - 1) * 0.6;
  return {
    name: clip.name,
    hit: clip.hit,
    keys: clip.keys.map((key) => {
      const p = {};
      for (const [j, v] of Object.entries(key.p)) {
        if (j === 'twist') p[j] = v.map((x) => (Math.abs(x) <= 180 ? x * k : x));
        else if (j === 'torso' || j === 'hip' || j === 'drop') p[j] = v.map((x) => x * k);
        else if (j === 'upR' || j === 'upL') p[j] = [v[0], v[1] * k, v[2] * k];
        else if (/^(thigh|knee|foot)/.test(j)) p[j] = v.map((x) => x * kl);
        else p[j] = v.slice();
      }
      const r = roots && roots.find((rt) => Math.abs(rt[0] - key.t) < 1e-6);
      if (r) p.root = [r[1], r[2] || 0];
      return { t: key.t, e: key.e, p };
    }),
  };
}
const AMP = 1.4;
// 骨盆位移的關鍵影格：[時間, 往前, 往右]（舊尺度的公尺）；蓄力往後收、出手往前送
const TP = {
  slash: amp(SLASH, AMP, [
    [0, 0],
    [0.22, -0.08],
    [0.38, 0.38, 0.06],
    [0.62, 0.32],
    [1, 0],
  ]),
  slashB: amp(SLASH_B, AMP, [
    [0, 0],
    [0.22, -0.08],
    [0.38, 0.38, -0.06],
    [0.62, 0.32],
    [1, 0],
  ]),
  thrust: amp(THRUST, AMP, [
    [0, 0],
    [0.3, -0.12],
    [0.42, 0.5],
    [0.75, 0.4],
    [1, 0],
  ]),
  slam: amp(SLAM, AMP, [
    [0, 0],
    [0.35, -0.06],
    [0.48, 0.34],
    [0.8, 0.28],
    [1, 0],
  ]),
  spin: amp(SPIN, AMP, [
    [0, 0],
    [0.15, -0.06],
    [0.85, 0.22],
    [1, 0],
  ]),
  ram: amp(RAM, AMP, [
    [0, 0],
    [0.3, -0.12],
    [0.45, 0.55],
    [1, 0],
  ]),
  pile: amp(PILE, AMP, [
    [0, 0],
    [0.45, -0.12],
    [0.55, 0.45],
    [0.85, 0.38],
    [1, 0],
  ]),
  punch: amp(PUNCH, AMP, [
    [0, 0],
    [0.25, -0.06],
    [0.4, 0.32],
    [1, 0],
  ]),
  hook: amp(HOOK, AMP, [
    [0, 0],
    [0.25, -0.05],
    [0.42, 0.26, -0.08],
    [1, 0],
  ]),
  heavy: amp(HEAVY, AMP, [
    [0, 0],
    [0.35, -0.12],
    [0.5, 0.45],
    [1, 0],
  ]),
};
// 近戰連擊（docs/melee-combo-design.md）的派生招式用的片段：上挑（把目標打上去）、踢（踢開）
const UPPER = {
  name: '上挑',
  keys: [
    K(0, 'out', {
      twist: [-20],
      torso: [10, 0],
      upR: [20, 10, 25],
      foreR: [100, 0],
      wpnR: [30, 0, 0],
      ...GUARD_L,
      ...legs([14, -50, 6], [10, -42, 6]),
      drop: [0.16],
      hip: [0],
      root: [0, 0],
    }),
    K(0.3, 'in', {
      twist: [-35],
      torso: [18, 0],
      upR: [5, 15, 30],
      foreR: [115, 0],
      wpnR: [55, 0, 0],
      drop: [0.24],
      root: [-0.08, 0],
    }),
    K(0.46, 'out', {
      twist: [20],
      torso: [16, 0],
      upR: [150, -10, 25],
      foreR: [20, 0],
      wpnR: [-40, 0, 0],
      ...legs([-8, -6, 4], [28, -34, 8]),
      drop: [0],
      root: [0.34, 0],
    }),
    K(0.72, 'io', { upR: [165, -5, 20], foreR: [30, 0], torso: [20, 0], drop: [-0.02] }),
    K(1, 'io', {
      twist: [0],
      torso: [0, 0],
      upR: [50, 0, 15],
      foreR: [70, 0],
      wpnR: [0, 0, 0],
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
  ],
};
const KICK = {
  name: '踢',
  keys: [
    K(0, 'out', {
      twist: [10],
      torso: [0, 0],
      upR: [40, 0, 30],
      foreR: [90, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
    K(0.3, 'in', {
      twist: [28],
      torso: [10, 0],
      thighR: [75, 0, 6],
      kneeR: [-100],
      footR: [20],
      thighL: [-6, 0, -6],
      kneeL: [-18],
      footL: [24],
      upR: [25, 0, 55],
      drop: [0.08],
      root: [-0.06, 0],
    }),
    K(0.46, 'out', {
      twist: [12],
      torso: [22, 0],
      thighR: [92, 0, 8],
      kneeR: [-6],
      footR: [-30],
      upR: [15, 0, 70],
      upL: [10, 0, -70],
      drop: [0.04],
      root: [0.32, 0],
    }),
    K(0.72, 'io', { thighR: [80, 0, 6], kneeR: [-20], torso: [18, 0] }),
    K(1, 'io', {
      twist: [0],
      torso: [0, 0],
      upR: [45, 0, 15],
      foreR: [70, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
  ],
};
export const TEMPLATES = {
  ...TP,
  upper: UPPER,
  kick: KICK,
  bigSlash: scaled(TP.slash, '大斬', 1.25),
  bigSlashB: scaled(TP.slashB, '大逆斬', 1.25),
  claw: scaled(TP.slash, '爪', 0.7),
  clawB: scaled(TP.slashB, '逆爪', 0.7),
};
// 武器 → 各段招式用的片段（沒有列的武器依招式種類：spin／thrust／slam／mirror＝逆斬／其他＝橫斬）
export const DEFAULT_MAP = {
  w_blade: ['slash', 'slashB', 'thrust'],
  w_saber: ['bigSlash', 'bigSlashB', 'spin', 'slam'],
  w_claw: ['claw', 'clawB', 'claw', 'clawB', 'thrust'],
  w_pile: ['ram', 'pile'],
  w_fist: ['punch', 'hook', 'heavy'],
};

// ---------- 片段的資料組 ----------
export const LOCAL_KEY = 'rubicon_melee_anim';
function merge(data) {
  return {
    clips: { ...TEMPLATES, ...((data && data.clips) || {}) },
    map: { ...DEFAULT_MAP, ...((data && data.map) || {}) },
  };
}
const builtinSet = merge(BUILTIN);
export const MeleeAnim = {
  allowLocal: () => true, // 遊戲設定：多人時回傳 false
  local: undefined, // 單人時用的瀏覽器版本（undefined＝還沒讀）
  builtin: () => builtinSet,
  raw: BUILTIN, // 內建的覆寫資料（動作編輯器的起點）
  // 重新讀取瀏覽器裡的版本（遊戲的 lmRefresh、模型庫的動作編輯器存檔後）
  reloadLocal() {
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    } catch (e) {}
    this.local = d && d.clips ? merge(d) : null;
  },
  set() {
    if (this.local === undefined) this.reloadLocal();
    return this.local && this.allowLocal() ? this.local : builtinSet;
  },
  // 武器定義與招式編號 → 片段（沒有時 null，照程式算的近戰姿勢）
  clipFor(def, stage) {
    const S = this.set();
    const st = meleeMove(def, stage);
    if (!st) return null;
    const m = S.map[def.id];
    const id =
      (m && m[stage]) ||
      st.clip ||
      (st.spin ? 'spin' : st.thrust ? 'thrust' : st.slam ? 'slam' : st.mirror ? 'slashB' : 'slash');
    return S.clips[id] || null;
  },
  // 這一招的出手時間點（比例）：招式的 hitAt＞片段的 clipStrike
  strikeFor(def, stage) {
    const st = meleeMove(def, stage);
    if (st && typeof st.hitAt === 'number') return st.hitAt;
    return clipStrike(this.clipFor(def, stage));
  },
};

// 片段的出手時間點（比例；判定從這裡開始，MechEntity.updateMelee）：片段的 hit，沒寫時＝蓄力的關鍵影格（緩動 in）
// 到下一個關鍵影格之間的 55%（揮下去最快的地方），都沒有時 0.3
const STRIKE = new WeakMap();
export function clipStrike(clip) {
  if (!clip) return 0.3;
  if (typeof clip.hit === 'number') return clip.hit;
  let v = STRIKE.get(clip);
  if (v !== undefined) return v;
  const ks = [...(clip.keys || [])].sort((a, b) => a.t - b.t);
  v = 0.3;
  for (let i = 1; i < ks.length - 1; i++)
    if (ks[i].e === 'in') {
      v = ks[i].t + 0.55 * (ks[i + 1].t - ks[i].t);
      break;
    }
  STRIKE.set(clip, v);
  return v;
}

// ---------- 求值 ----------
const TRACKS = new WeakMap();
// 片段 → 每個關節的軌跡 [{ t, v, e }]（依時間排序；編輯器修改後要 clipChanged）
function tracksOf(clip) {
  let T = TRACKS.get(clip);
  if (T) return T;
  T = {};
  const keys = [...clip.keys].sort((a, b) => a.t - b.t);
  for (const k of keys)
    for (const [j, v] of Object.entries(k.p || {}))
      if (MJ_AXES[j]) (T[j] = T[j] || []).push({ t: k.t, v, e: k.e });
  TRACKS.set(clip, T);
  return T;
}
export const clipChanged = (clip) => TRACKS.delete(clip);
// 進度 ph（0～1）的姿勢：{ 關節: [值] }（角度換成弧度、壓低是公尺）；mirror＝左手武器
export function clipPose(clip, ph, mirror) {
  const T = tracksOf(clip),
    out = {};
  for (const j in T) {
    const tr = T[j];
    let v;
    if (ph <= tr[0].t) v = tr[0].v;
    else if (ph >= tr[tr.length - 1].t) v = tr[tr.length - 1].v;
    else {
      let i = 0;
      while (i < tr.length - 2 && tr[i + 1].t <= ph) i++;
      const a = tr[i],
        b = tr[i + 1];
      const u = (EASE[b.e] || EASE.io)((ph - a.t) / Math.max(1e-6, b.t - a.t));
      v = a.v.map((x, n) => x + ((b.v[n] !== undefined ? b.v[n] : x) - x) * u);
    }
    out[j] = isLen(j) ? v.slice() : v.map((x) => x * D2R);
  }
  return mirror ? mirrorPose(out) : out;
}
// 左右鏡像：左右關節對調，繞 y、z 的角度（扭轉、下半身朝向、側傾）變號
export function mirrorPose(P) {
  const out = {};
  for (const j in P) {
    const v = P[j];
    const to = j.endsWith('R') ? j.slice(0, -1) + 'L' : j.endsWith('L') ? j.slice(0, -1) + 'R' : j;
    const ax = MJ_AXES[j];
    out[to] =
      j === 'drop' ? v.slice() : j === 'root' ? [v[0], -v[1]] : v.map((x, n) => (ax[n] === 'x' ? x : -x));
  }
  return out;
}
// 關節鍵 → 模型上的物件與用法：{ o: 旋轉的 Euler 或其他, kind: 'rot'|'twist'|'drop' }
export function clipTarget(rig, j) {
  if (j === 'twist') return { kind: 'twist' };
  if (j === 'drop') return { kind: 'drop' };
  if (j === 'root') return { kind: 'root' };
  if (j === 'torso') return { kind: 'rot', o: rig.torso.rotation };
  if (j === 'hip') return { kind: 'rot', o: rig.legsG.rotation };
  if (j === 'head') return rig.head ? { kind: 'rot', o: rig.head.rotation } : null;
  const side = j.endsWith('R') ? 'r' : 'l',
    base = j.slice(0, -1);
  if (base === 'up' || base === 'fore' || base === 'wpn') {
    const a = rig.arms && rig.arms[side];
    if (!a) return null;
    return { kind: 'rot', o: (base === 'up' ? a.up : base === 'fore' ? a.fore : a.weapon).rotation };
  }
  if (rig.type !== 'biped' && rig.type !== 'reverse') return null; // 四足、履帶的腳不套用
  const L = rig.legs.find((l) => (side === 'r' ? l.side > 0 : l.side < 0));
  if (!L) return null;
  return { kind: 'rot', o: (base === 'thigh' ? L.thigh : base === 'knee' ? L.knee : L.foot).rotation };
}
