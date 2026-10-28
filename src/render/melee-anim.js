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
// ---------- 打擊感改版第 3 期（docs/melee-combo-design.md）：派生招式的專屬片段 ----------
const AIR_LEGS = legs([55, -95, 8], [35, -70, 8]); // 空中收腿
const LEG_KEYS = ['thighR', 'kneeR', 'footR', 'thighL', 'kneeL', 'footL', 'drop', 'root'];
// 片段的複本，每個關鍵影格交給 fn(p, key, i) 修改
function tweak(clip, name, fn, hit) {
  return {
    name,
    hit: hit !== undefined ? hit : clip.hit,
    keys: clip.keys.map((key, i) => {
      const p = {};
      for (const [j, v] of Object.entries(key.p)) p[j] = v.slice();
      fn(p, key, i);
      return { t: key.t, e: key.e, p };
    }),
  };
}
// 空中版：拿掉腿、壓低、骨盆位移，改成收腿（出手時兩腿前後甩開），上身多前傾一點
const airify = (clip, name) =>
  tweak(clip, name, (p, key, i) => {
    for (const j of LEG_KEYS) delete p[j];
    if (p.torso) p.torso[0] -= 8;
    Object.assign(p, key.e === 'out' && i > 0 ? legs([30, -70, 10], [65, -105, 10]) : AIR_LEGS);
  });
// 出手的關鍵影格（緩動 out、不是第一個）
const isStrike = (key, i) => key.e === 'out' && i > 0;
// 衝刺斬：壓低身體、刀放在身後（拔刀式）衝進去，一口氣橫斬到底
const DASH = {
  name: '衝刺斬',
  keys: [
    K(0, 'out', {
      twist: [45],
      torso: [-22, 0],
      upR: [15, 45, 15],
      foreR: [70, 0],
      wpnR: [-30, 0, 0],
      ...GUARD_L,
      ...legs([-15, -45, 6], [50, -85, 6]),
      drop: [0.24],
      root: [0.1, 0],
      hip: [15],
    }),
    K(0.28, 'in', {
      twist: [60],
      torso: [-28, 0],
      upR: [5, 60, 10],
      foreR: [85, 0],
      drop: [0.28],
      root: [0.25, 0],
    }),
    K(0.42, 'out', {
      twist: [-60],
      torso: [-12, 0],
      upR: [88, -45, 15],
      foreR: [5, 0],
      wpnR: [10, 0, 0],
      ...legs([65, -80, 6], [-40, -8, 6]),
      drop: [0.32],
      root: [0.7, 0],
      hip: [-15],
    }),
    K(0.7, 'io', {
      twist: [-70],
      torso: [-16, 0],
      upR: [72, -62, 20],
      foreR: [15, 0],
      drop: [0.28],
      root: [0.5, 0],
    }),
    K(1, 'io', {
      twist: [-10],
      torso: [-6, 0],
      upR: [50, -20, 20],
      foreR: [60, 0],
      wpnR: [0, 0, 0],
      ...STAND,
      drop: [0.04],
      root: [0, 0],
      hip: [0],
    }),
  ],
};
// 衝刺拳：身體伸直往前飛的直拳
const DASH_PUNCH = {
  name: '衝刺拳',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [-25, 0],
      upR: [20, 0, 15],
      foreR: [120, 0],
      ...GUARD_L,
      ...legs([-20, -40, 6], [45, -80, 6]),
      drop: [0.22],
      root: [0.1, 0],
    }),
    K(0.25, 'in', { twist: [35], upR: [-10, 0, 15], foreR: [130, 0], drop: [0.26], root: [0.2, 0] }),
    K(0.4, 'out', {
      twist: [-30],
      torso: [-35, 0],
      upR: [100, 0, 3],
      foreR: [0, 0],
      ...legs([70, -60, 6], [-45, -5, 6]),
      drop: [0.3],
      root: [0.7, 0],
    }),
    K(0.7, 'io', {
      twist: [-25],
      torso: [-30, 0],
      upR: [98, 0, 3],
      foreR: [3, 0],
      drop: [0.26],
      root: [0.5, 0],
    }),
    K(1, 'io', {
      twist: [0],
      torso: [-3, 0],
      upR: [45, 0, 15],
      foreR: [90, 0],
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
  ],
};
// 空中的下劈：刀舉過頭、往後弓，整個人跟著往下砸，落地蹲住
const DIVE = {
  name: '空中下劈',
  keys: [
    K(0, 'out', {
      twist: [0],
      torso: [20, 0],
      upR: [160, 0, 15],
      foreR: [40, 0],
      wpnR: [-30, 0, 0],
      upL: [120, 0, -20],
      foreL: [50, 0],
      ...AIR_LEGS,
    }),
    K(0.3, 'in', {
      torso: [30, 0],
      upR: [178, 0, 10],
      foreR: [55, 0],
      wpnR: [-50, 0, 0],
      upL: [150, 0, -15],
      ...legs([30, -90, 8], [30, -90, 8]),
    }),
    K(0.45, 'out', {
      torso: [-42, 0],
      upR: [40, 0, 8],
      foreR: [5, 0],
      wpnR: [20, 0, 0],
      upL: [40, 0, -15],
      foreL: [40, 0],
      ...legs([-10, -20, 6], [25, -60, 6]),
    }),
    K(0.75, 'io', { torso: [-45, 0], upR: [25, 0, 8], foreR: [10, 0] }),
    K(1, 'io', {
      torso: [-15, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      wpnR: [0, 0, 0],
      ...GUARD_L,
      ...legs([25, -55, 6], [20, -50, 6]),
      drop: [0.2],
    }),
  ],
};
// 空中樁擊：樁對著正下方，整個人往下壓
const PILE_DIVE = {
  name: '空中樁擊',
  keys: [
    K(0, 'out', { torso: [10, 0], upR: [90, 0, 10], foreR: [90, 0], ...GUARD_L, ...AIR_LEGS }),
    K(0.4, 'in', { torso: [22, 0], upR: [105, 0, 10], foreR: [115, 0] }),
    K(0.55, 'out', {
      torso: [-55, 0],
      upR: [25, 0, 8],
      foreR: [0, 0],
      ...legs([-15, -10, 6], [10, -40, 6]),
    }),
    K(0.8, 'io', { torso: [-50, 0], upR: [22, 0, 8] }),
    K(1, 'io', {
      torso: [-10, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...legs([25, -55, 6], [20, -50, 6]),
      drop: [0.18],
    }),
  ],
};
// 空中的下踢（劈腿）：右腳舉高再往下砸
const AXE_KICK = {
  name: '下踢',
  keys: [
    K(0, 'out', { torso: [5, 0], upR: [40, 0, 30], foreR: [100, 0], ...GUARD_L, ...AIR_LEGS }),
    K(0.3, 'in', {
      torso: [22, 0],
      thighR: [135, 0, 6],
      kneeR: [-10],
      footR: [0],
      thighL: [10, 0, -6],
      kneeL: [-60],
      footL: [30],
      upR: [20, 0, 60],
      upL: [20, 0, -60],
    }),
    K(0.46, 'out', {
      torso: [-28, 0],
      thighR: [10, 0, 6],
      kneeR: [-5],
      footR: [-10],
      thighL: [40, 0, -6],
      kneeL: [-80],
    }),
    K(0.75, 'io', { torso: [-24, 0], thighR: [18, 0, 6], kneeR: [-12] }),
    K(1, 'io', {
      torso: [-8, 0],
      upR: [40, 0, 15],
      foreR: [100, 0],
      ...GUARD_L,
      ...legs([25, -55, 6], [20, -50, 6]),
      drop: [0.18],
    }),
  ],
};
// 打樁機的上頂：蹲低、樁收在腰邊，全身伸直往上打
const PILE_UP = {
  name: '上頂',
  keys: [
    K(0, 'out', {
      twist: [15],
      torso: [-10, 0],
      upR: [60, 0, 15],
      foreR: [110, 0],
      ...GUARD_L,
      ...legs([30, -70, 6], [30, -70, 6]),
      drop: [0.28],
      root: [0, 0],
    }),
    K(0.35, 'in', { twist: [25], torso: [-14, 0], upR: [45, 0, 15], foreR: [128, 0], drop: [0.34] }),
    K(0.5, 'out', {
      twist: [-5],
      torso: [16, 0],
      upR: [175, 0, 10],
      foreR: [0, 0],
      ...legs([-5, -5, 4], [10, -15, 4]),
      drop: [-0.05],
      root: [0.2, 0],
    }),
    K(0.8, 'io', { torso: [18, 0], upR: [172, 0, 10], foreR: [5, 0], drop: [-0.03] }),
    K(1, 'io', {
      twist: [0],
      torso: [0, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
  ],
};
// 上勾拳：拳放低、膝蓋彎到底，往上伸直
const UPPERCUT = {
  name: '上勾拳',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [-15, 0],
      upR: [10, 20, 20],
      foreR: [120, 0],
      ...GUARD_L,
      ...legs([30, -65, 6], [25, -55, 6]),
      drop: [0.25],
      root: [0, 0],
    }),
    K(0.3, 'in', { twist: [32], torso: [-20, 0], upR: [0, 25, 20], foreR: [125, 0], drop: [0.3] }),
    K(0.45, 'out', {
      twist: [-15],
      torso: [14, 0],
      upR: [140, 0, 10],
      foreR: [70, 0],
      ...legs([-5, -8, 4], [20, -25, 4]),
      drop: [-0.04],
      root: [0.2, 0],
    }),
    K(0.7, 'io', { torso: [16, 0], upR: [145, 0, 10], foreR: [75, 0] }),
    K(1, 'io', {
      twist: [0],
      torso: [-3, 0],
      upR: [45, 0, 15],
      foreR: [90, 0],
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
  ],
};
// ---------- 處決：每一下都有出手，時間對齊招式的 hits ----------
// 刀：刺進去（0.42）、拔出來再更深地刺一次（0.82）
const EX_STAB = {
  name: '處決・刺穿',
  keys: [
    K(0, 'out', {
      twist: [15],
      torso: [6, 0],
      upR: [10, 0, 12],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.02],
      root: [0, 0],
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
      root: [0.4, 0],
    }),
    K(0.58, 'io', { twist: [-15], torso: [-24, 0], upR: [102, 0, 4] }),
    K(0.7, 'in', {
      twist: [35],
      torso: [10, 0],
      upR: [-20, 0, 8],
      foreR: [120, 0],
      root: [0.1, 0],
      drop: [0.1],
    }),
    K(0.82, 'out', {
      twist: [-30],
      torso: [-34, 0],
      upR: [110, 0, 4],
      foreR: [0, 0],
      drop: [0.26],
      ...legs([65, -85, 6], [-40, -6, 6]),
      root: [0.55, 0],
    }),
    K(1, 'io', {
      twist: [-10],
      torso: [-12, 0],
      upR: [60, 0, 10],
      foreR: [40, 0],
      drop: [0.1],
      root: [0.2, 0],
    }),
  ],
};
// 大劍：高高舉起，0.58 一刀兩斷
const EX_SLAM = {
  name: '處決・兩斷',
  keys: [
    K(0, 'out', {
      twist: [10],
      torso: [6, 0],
      upR: [60, 0, 20],
      foreR: [60, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
    K(0.45, 'in', {
      twist: [0],
      torso: [28, 0],
      upR: [170, 0, 10],
      foreR: [30, 0],
      upL: [150, 0, -10],
      foreL: [40, 0],
      drop: [-0.05],
      ...legs([10, -10, 4], [10, -10, 4]),
    }),
    K(0.58, 'out', {
      torso: [-40, 0],
      upR: [50, 0, 8],
      foreR: [30, 0],
      upL: [45, 0, -10],
      foreL: [40, 0],
      drop: [0.32],
      ...legs([55, -90, 8], [25, -65, 8]),
      root: [0.35, 0],
    }),
    K(0.85, 'io', { torso: [-36, 0], upR: [48, 0, 8], drop: [0.3] }),
    K(1, 'io', {
      torso: [-8, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
  ],
};
// 爪：橫抓（0.3）、反手抓（0.5）、收回來貫穿（0.85）
const EX_CLAW = {
  name: '處決・撕裂',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [4, 0],
      upR: [55, 30, 40],
      foreR: [95, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
    K(0.18, 'in', { twist: [50], upR: [70, 45, 55], foreR: [115, 0], drop: [0.06] }),
    K(0.3, 'out', {
      twist: [-40],
      torso: [-16, 0],
      upR: [82, -30, 12],
      foreR: [12, 0],
      drop: [0.15],
      ...LUNGE_R,
      root: [0.25, 0],
    }),
    K(0.4, 'in', { twist: [-50], upR: [70, -55, -5], foreR: [112, 0] }),
    K(0.5, 'out', { twist: [40], torso: [-16, 0], upR: [80, 35, 50], foreR: [15, 0] }),
    K(0.72, 'in', {
      twist: [35],
      torso: [14, 0],
      upR: [-30, 0, 8],
      foreR: [115, 0],
      drop: [0.08],
      ...legs([20, -30, 4], [0, -15, 4]),
      root: [0.1, 0],
    }),
    K(0.85, 'out', {
      twist: [-25],
      torso: [-30, 0],
      upR: [104, 0, 4],
      foreR: [2, 0],
      drop: [0.24],
      ...legs([60, -80, 6], [-38, -8, 6]),
      root: [0.45, 0],
    }),
    K(1, 'io', {
      twist: [0],
      torso: [-8, 0],
      upR: [55, 0, 15],
      foreR: [50, 0],
      drop: [0.08],
      root: [0.2, 0],
    }),
  ],
};
// 打樁機：抵住目標慢慢壓，0.72 擊發
const EX_PILE = {
  name: '處決・打穿',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [6, 0],
      upR: [20, 0, 15],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
    K(0.58, 'in', {
      twist: [40],
      torso: [18, 0],
      upR: [-40, 0, 10],
      foreR: [125, 0],
      drop: [0.14],
      ...legs([25, -45, 6], [-5, -25, 6]),
    }),
    K(0.72, 'out', {
      twist: [-25],
      torso: [-34, 0],
      upR: [106, 0, 3],
      foreR: [0, 0],
      drop: [0.28],
      ...legs([60, -85, 6], [-38, -6, 6]),
      root: [0.5, 0],
    }),
    K(0.9, 'io', { torso: [-30, 0], upR: [104, 0, 3], drop: [0.26] }),
    K(1, 'io', {
      twist: [0],
      torso: [-8, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
  ],
};
// 拳：右、左、右三下刺拳（0.2／0.36／0.52），收拳蓄力後重擊（0.86）
const EX_FIST = {
  name: '處決・連打',
  keys: [
    K(0, 'out', {
      twist: [10],
      upR: [40, 0, 15],
      foreR: [110, 0],
      upL: [40, 0, -15],
      foreL: [110, 0],
      ...STAND,
      drop: [0.05],
      root: [0, 0],
    }),
    K(0.12, 'in', { twist: [15], upR: [25, 0, 12], foreR: [125, 0] }),
    K(0.2, 'out', {
      twist: [-20],
      torso: [-10, 0],
      upR: [96, 0, 4],
      foreR: [5, 0],
      ...legs([25, -35, 6], [-12, -12, 6]),
      root: [0.15, 0],
    }),
    K(0.28, 'in', { twist: [-15], upR: [40, 0, 15], foreR: [110, 0], upL: [25, 0, -12], foreL: [125, 0] }),
    K(0.36, 'out', { twist: [25], torso: [-10, 0], upL: [96, 0, -4], foreL: [5, 0] }),
    K(0.44, 'in', { twist: [15], upL: [40, 0, -15], foreL: [110, 0], upR: [25, 0, 12], foreR: [125, 0] }),
    K(0.52, 'out', { twist: [-25], torso: [-12, 0], upR: [96, 0, 4], foreR: [5, 0], root: [0.2, 0] }),
    K(0.72, 'in', {
      twist: [45],
      torso: [15, 0],
      upR: [-20, 0, 15],
      foreR: [130, 0],
      upL: [40, 0, -15],
      foreL: [110, 0],
      drop: [0.14],
      ...legs([20, -35, 6], [0, -20, 6]),
      root: [0.05, 0],
    }),
    K(0.86, 'out', {
      twist: [-40],
      torso: [-30, 0],
      upR: [104, 0, 3],
      foreR: [0, 0],
      drop: [0.26],
      ...legs([60, -80, 6], [-38, -8, 6]),
      root: [0.45, 0],
    }),
    K(1, 'io', {
      twist: [0],
      torso: [-5, 0],
      upR: [45, 0, 15],
      foreR: [70, 0],
      drop: [0.06],
      root: [0.15, 0],
    }),
  ],
};
// 前派生的突刺連打：高位刺（第 2 下）、低位刺（第 3 下），和第 1 下的中段刺分開
const THRUST_HI = tweak(TP.thrust, '高位刺', (p, key, i) => {
  if (isStrike(key, i) || key.t === 0.75) {
    if (p.upR) p.upR[0] += 28;
    if (p.torso) p.torso[0] += 12;
    if (p.drop) p.drop[0] -= 0.06;
  }
});
const THRUST_LO = tweak(TP.thrust, '低位刺', (p, key, i) => {
  if (isStrike(key, i) || key.t === 0.75) {
    if (p.upR) p.upR[0] -= 22;
    if (p.torso) p.torso[0] -= 12;
    if (p.drop) p.drop[0] += 0.12;
  }
});
// 側派生：壓低身體的迴旋（刀、爪）、轉兩圈的大迴旋（大劍）、伸腳的迴旋踢（拳）
const SPIN_LOW = tweak(TP.spin, '低身迴旋', (p) => {
  if (p.drop) p.drop[0] += 0.12;
  if (p.torso) p.torso[0] -= 10;
});
const BIG_SPIN = tweak(scaled(TP.spin, '大迴旋', 1.25), '大迴旋', (p) => {
  if (p.twist) p.twist[0] = p.twist[0] >= 359 ? 720 : p.twist[0];
});
const SPIN_KICK = tweak(TP.spin, '迴旋踢', (p, key, i) => {
  if (i === 1 || i === 2)
    Object.assign(p, {
      thighR: [25, 0, 80],
      kneeR: [-5],
      footR: [0],
      thighL: [10, 0, -6],
      kneeL: [-35],
      footL: [25],
    });
  if (p.upR) p.upR = [40, 0, 30];
  if (p.foreR) p.foreR = [100, 0];
  if (p.upL) p.upL = [20, 0, -20];
  if (p.foreL) p.foreL = [80, 0];
});
// 突刺連打的第 1 下：不大幅蓄力的快刺（左手往後收）
const THRUST_RUSH = tweak(TP.thrust, '快刺', (p, key, i) => {
  if (i === 1) {
    if (p.twist) p.twist[0] = 12;
    if (p.upR) p.upR[0] += 25;
    if (p.torso) p.torso[0] = 4;
  }
  if (isStrike(key, i) || key.t === 0.75) {
    p.upL = [-25, 0, -20];
    p.foreL = [60, 0];
    if (p.torso) p.torso[0] += 8;
  }
});
// 爪的前派生：伸手抓住 → 兩手撕扯 → 往兩側撕開
const GRAB = {
  name: '抓住',
  keys: [
    K(0, 'out', {
      twist: [10],
      torso: [0, 0],
      upR: [40, 0, 20],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
    K(0.25, 'in', { twist: [25], torso: [8, 0], upR: [70, 0, 35], foreR: [60, 0], drop: [0.08] }),
    K(0.4, 'out', {
      twist: [-15],
      torso: [-22, 0],
      upR: [100, 0, 15],
      foreR: [10, 0],
      ...legs([45, -60, 6], [-25, -12, 6]),
      drop: [0.16],
      root: [0.4, 0],
    }),
    K(0.75, 'io', { twist: [-5], torso: [-12, 0], upR: [80, 0, 10], foreR: [70, 0], root: [0.15, 0] }),
    K(1, 'io', {
      twist: [0],
      torso: [-4, 0],
      upR: [60, 0, 15],
      foreR: [80, 0],
      ...STAND,
      drop: [0.05],
      root: [0, 0],
    }),
  ],
};
const RIP = {
  name: '撕扯',
  keys: [
    K(0, 'out', {
      twist: [-5],
      torso: [-6, 0],
      upR: [75, 0, 10],
      foreR: [70, 0],
      upL: [75, 0, -10],
      foreL: [70, 0],
      drop: [0.06],
    }),
    K(0.25, 'in', {
      twist: [-25],
      torso: [6, 0],
      upR: [95, 0, -10],
      foreR: [40, 0],
      upL: [60, 0, -40],
      foreL: [110, 0],
    }),
    K(0.4, 'out', {
      twist: [25],
      torso: [-14, 0],
      upR: [55, 0, 35],
      foreR: [110, 0],
      upL: [95, 0, 10],
      foreL: [40, 0],
      drop: [0.1],
    }),
    K(1, 'io', {
      twist: [0],
      torso: [-6, 0],
      upR: [70, 0, 10],
      foreR: [70, 0],
      upL: [70, 0, -10],
      foreL: [70, 0],
      drop: [0.06],
    }),
  ],
};
const TEAR = {
  name: '撕開',
  keys: [
    K(0, 'out', {
      twist: [0],
      torso: [-6, 0],
      upR: [80, -30, -15],
      foreR: [50, 0],
      upL: [80, 30, 15],
      foreL: [50, 0],
      ...STAND,
      drop: [0.06],
      root: [0, 0],
    }),
    K(0.3, 'in', {
      torso: [10, 0],
      upR: [95, -40, -25],
      foreR: [60, 0],
      upL: [95, 40, 25],
      foreL: [60, 0],
      drop: [0.1],
    }),
    K(0.45, 'out', {
      torso: [-24, 0],
      upR: [80, 0, 85],
      foreR: [10, 0],
      upL: [80, 0, -85],
      foreL: [10, 0],
      ...legs([40, -60, 8], [-20, -15, 8]),
      drop: [0.18],
      root: [0.35, 0],
    }),
    K(0.75, 'io', { torso: [-20, 0], upR: [70, 0, 80], upL: [70, 0, -80] }),
    K(1, 'io', {
      torso: [-4, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
  ],
};
// 打樁機：雙手架著樁衝進去（衝刺樁擊）、肩膀撞進去（衝刺撞擊）
const PILE_RUSH = tweak(TP.pile, '衝刺樁擊', (p, key, i) => {
  if (i > 0) {
    p.upL = [70, 30, -10];
    p.foreL = [70, 0];
  }
  if (p.drop) p.drop[0] += 0.08;
  if (p.torso) p.torso[0] -= 10;
});
const SHOULDER = {
  name: '肩撞',
  keys: [
    K(0, 'out', {
      twist: [20],
      torso: [-10, 0],
      upR: [30, 0, 15],
      foreR: [100, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.06],
      root: [0, 0],
    }),
    K(0.28, 'in', {
      twist: [70],
      torso: [-18, 0],
      upR: [20, 0, 10],
      foreR: [120, 0],
      upL: [20, 0, -10],
      foreL: [120, 0],
      drop: [0.16],
      root: [0.1, 0],
    }),
    K(0.45, 'out', {
      twist: [80],
      torso: [-30, 0],
      upR: [10, 0, 5],
      foreR: [125, 0],
      ...legs([55, -70, 6], [-40, -8, 6]),
      drop: [0.24],
      root: [0.6, 0],
    }),
    K(0.75, 'io', { twist: [70], torso: [-26, 0], root: [0.45, 0] }),
    K(1, 'io', {
      twist: [0],
      torso: [-5, 0],
      upR: [45, 0, 15],
      foreR: [60, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.03],
      root: [0, 0],
    }),
  ],
};
// 拳的突進肘擊：手肘往前頂
const ELBOW = {
  name: '肘擊',
  keys: [
    K(0, 'out', {
      twist: [15],
      torso: [-6, 0],
      upR: [40, 0, 15],
      foreR: [110, 0],
      ...GUARD_L,
      ...STAND,
      drop: [0.04],
      root: [0, 0],
    }),
    K(0.25, 'in', {
      twist: [40],
      torso: [4, 0],
      upR: [60, 30, 40],
      foreR: [150, 0],
      drop: [0.1],
      root: [0.05, 0],
    }),
    K(0.4, 'out', {
      twist: [-30],
      torso: [-26, 0],
      upR: [95, -20, 10],
      foreR: [150, 0],
      ...legs([50, -70, 6], [-35, -8, 6]),
      drop: [0.2],
      root: [0.5, 0],
    }),
    K(0.7, 'io', { twist: [-25], torso: [-22, 0], root: [0.35, 0] }),
    K(1, 'io', {
      twist: [0],
      torso: [-3, 0],
      upR: [45, 0, 15],
      foreR: [90, 0],
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
  // 第 3 期：派生招式
  dash: DASH,
  bigDash: scaled(DASH, '大衝刺斬', 1.2),
  clawDash: scaled(DASH, '衝刺爪', 0.75),
  dashPunch: DASH_PUNCH,
  airSlash: airify(TP.slash, '空中斬'),
  airSlashB: airify(TP.slashB, '空中逆斬'),
  airBigSlash: airify(scaled(TP.slash, '大斬', 1.25), '空中大斬'),
  airClaw: airify(scaled(TP.slash, '爪', 0.7), '空中爪'),
  airClawB: airify(scaled(TP.slashB, '逆爪', 0.7), '空中逆爪'),
  airPunch: airify(TP.punch, '空中拳'),
  dive: DIVE,
  bigDive: scaled(DIVE, '空中大斬', 1.2),
  clawDive: scaled(DIVE, '下撕', 0.75),
  pileDive: PILE_DIVE,
  axeKick: AXE_KICK,
  thrustHi: THRUST_HI,
  thrustLo: THRUST_LO,
  spinLow: SPIN_LOW,
  bigSpin: BIG_SPIN,
  spinKick: SPIN_KICK,
  bigUpper: scaled(UPPER, '斬上', 1.25),
  scoop: tweak(scaled(UPPER, '上撈', 0.8), '上撈', (p) => {
    if (p.upR) p.upL = [p.upR[0], -p.upR[1], -p.upR[2]]; // 兩手一起往上撈
    if (p.foreR) p.foreL = p.foreR.slice();
  }),
  pileUp: PILE_UP,
  uppercut: UPPERCUT,
  exStab: EX_STAB,
  exSlam: EX_SLAM,
  exClaw: EX_CLAW,
  exPile: EX_PILE,
  exFist: EX_FIST,
  thrustRush: THRUST_RUSH,
  grab: GRAB,
  rip: RIP,
  tear: TEAR,
  pileRush: PILE_RUSH,
  shoulder: SHOULDER,
  elbow: ELBOW,
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
