// CUBEE AC-01：Q 版矮胖比例的一套零件（頭部、核心、手臂、二足腳部、背包，與步槍、3×3 導彈莢、2×2 四聯砲）。
// 移植自使用者的程式模型（test-results/my_ac_model/cubee_ac_01_3d.html）：原檔正面 +Z、單位約為遊戲的 2 倍，
// 這裡照原檔的座標寫，經由 frame 轉成遊戲座標（繞 Y 轉 180° 讓正面朝 −Z、縮 0.5 倍）。
// 原檔的待機姿勢（腿外張、膝彎、前臂彎、頭部轉向）不放進模型，區塊一律是拉直的靜止姿勢，由遊戲的動作驅動。
// 原檔的 sign＝+1 那一側（原檔 +X）轉 180° 之後在遊戲的左側，所以遊戲的 side s 對應原檔的 sign＝−s。
// 貼圖改成配色槽（可換色），01／AC 等標記用貼花、黃色條紋用 acc 色的薄板。
import { decal, gCyl, gPod } from './geometry.js';

export const CUBEE_K = 0.5; // 原檔 → 遊戲的縮放
// 步槍：粗細照 0.45 倍、長度壓到 0.32 倍（約 1.4 m，和標準步槍差不多；原稿約 2.2 m，太長會和從手部射出的子彈對不上）
const RIFLE_SCALE = new THREE.Matrix4()
  .makeScale(0.45, 0.45, 0.32)
  .multiply(new THREE.Matrix4().makeRotationY(Math.PI));
const PI2 = Math.PI / 2;

// 遊戲裡的 CUBEE 零件與武器
export const CUBEE_PARTS = new Set(['h_cubee', 'c_cubee', 'a_cubee', 'l_cubee', 'b_cubee']);
const CUBEE_WEAPONS = new Set(['w_crifle', 'bw_cms', 'bw_cqc']);
export const isCubeeWeapon = (id) => CUBEE_WEAPONS.has(id);

// 全邊倒角的方塊（原檔 createBevelBoxGeometry 的對應：切角截面沿 Z 放樣，兩端也切角）
const BEV = {};
function gBev(w, h, d, b) {
  const c = Math.max(0.005, Math.min(b, w * 0.28, h * 0.28, d * 0.28));
  const k = [w, h, d, c].join(',');
  return (
    BEV[k] ||
    (BEV[k] = gPod([
      [-d / 2, w - 2 * c, -h / 2 + c, h / 2 - c, c * 0.6, c * 0.6],
      [-d / 2 + c, w, -h / 2, h / 2, c, c],
      [d / 2 - c, w, -h / 2, h / 2, c, c],
      [d / 2, w - 2 * c, -h / 2 + c, h / 2 - c, c * 0.6, c * 0.6],
    ]))
  );
}
const TMP = new THREE.Euler();
const mat4 = (x, y, z, rx = 0, ry = 0, rz = 0) =>
  new THREE.Matrix4().makeRotationFromEuler(TMP.set(rx, ry, rz)).setPosition(x, y, z);

// 以原檔座標擺放的收集器：frame＝原檔座標（相對於區塊原點）→ 遊戲座標
class Frame {
  constructor(node, M, k = CUBEE_K, m = null) {
    this.node = node;
    this.M = M;
    this.m = m || new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
  }
  push(geo, mat, mm) {
    if (!this.node.userData.prims) this.node.userData.prims = [];
    this.node.userData.prims.push({ geo, m: mat, mm: this.m.clone().multiply(mm) });
  }
  // 原檔的 addBevelMesh(parent, w, h, d, mat, x, y, z, bevel, rx, ry, rz)
  box(w, h, d, mat, x = 0, y = 0, z = 0, b = 0.05, rx = 0, ry = 0, rz = 0) {
    this.push(gBev(w, h, d, b), mat, mat4(x, y, z, rx, ry, rz));
    return this;
  }
  // 原檔的 addCylinderMesh(parent, rt, rb, h, segs, mat, x, y, z, rx, ry, rz)（分段數上限 12）
  cyl(rt, rb, h, segs, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    this.push(gCyl(rt, rb, h, Math.min(segs, 12)), mat, mat4(x, y, z, rx, ry, rz));
    return this;
  }
  // 子群組（原檔的 Group：位置＋旋轉）
  sub(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return new Frame(this.node, this.M, 0, this.m.clone().multiply(mat4(x, y, z, rx, ry, rz)));
  }
  // 貼花：在原檔座標的 (x, y, z) 放一張朝 +Z（原檔的正面）的平面，ry 轉向其他面
  decal(tile, w, h, x, y, z, rx = 0, ry = 0) {
    const n = this.node.children.length;
    decal(this.node, tile, w, h, 0, 0, 0);
    const mesh = this.node.children[n];
    const m = this.m.clone().multiply(mat4(x, y, z, rx, ry, 0));
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    return this;
  }
}

// 原檔材質 → 配色槽（M＝mechMats）
function mats(M, red) {
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.32, metalness: 0.85 });
  steel.name = 'cubee_steel';
  const copper = new THREE.MeshStandardMaterial({ color: 0xc9522b, roughness: 0.38, metalness: 0.55 });
  copper.name = 'cubee_copper';
  return {
    olive: M.main,
    grey: M.grey,
    heel: M.main3,
    slate: M.main2,
    gun: M.sub,
    dark: M.joint,
    yellow: M.acc,
    steel,
    copper,
    visor: red,
  };
}

// ===== 連接點（遊戲座標，相對於區塊原點；照原檔的關節位置換算） =====
const k = CUBEE_K;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C = (p, r = [0, 0, 0]) => ({ p, r: new THREE.Euler(r[0], r[1], r[2]) });
// 原檔：骨盆群組 y 3.92、軀幹 +1.52（5.44）；遊戲的腰（核心原點）＝ 2.22 m ＝原檔 4.44
const WAIST = 4.44;
const TORSO = 5.44 - WAIST; // 核心原點到原檔軀幹群組
export function cubeeConns(info) {
  switch (info.kind) {
    case 'core':
      return {
        neck: C(V(0, (TORSO + 1.18) * k, -0.08 * k)),
        backpack: C(V(0, (TORSO + 0.28) * k, 1.18 * k)),
        shoulder_r: C(V(2.42 * k, (TORSO + 0.36) * k, -0.02 * k)),
        shoulder_l: C(V(-2.42 * k, (TORSO + 0.36) * k, -0.02 * k)),
        back_r: C(V(2.13 * k, (TORSO + 2.15) * k, 0.1 * k)),
        back_l: C(V(-2.13 * k, (TORSO + 2.15) * k, 0.1 * k)),
      };
    case 'booster':
      return {
        nozzle_l: C(V(-0.52 * k, -0.844 * k, 0.659 * k), [-0.35, 0, 0]),
        nozzle_r: C(V(0.52 * k, -0.844 * k, 0.659 * k), [-0.35, 0, 0]),
      };
    case 'pelvis':
      return {
        waist: C(V(0, WAIST * k, 0)),
        hip_r: C(V(1.32 * k, 3.86 * k, -0.02 * k)),
        hip_l: C(V(-1.32 * k, 3.86 * k, -0.02 * k)),
      };
    case 'thigh':
      return { knee: C(V(0, -1.52 * k, 0)) };
    case 'shin':
      return { ankle: C(V(0, -1.52 * k, -0.06 * k)) };
    case 'upper':
      return { elbow: C(V(info.side * 0.08 * k, -1.48 * k, 0)) };
    case 'fore':
      return { wrist: C(V(0, -1.56 * k, -0.05 * k)) };
    case 'hand':
      return { grip: C(V(0, -0.16, -0.12), [-PI2, 0, 0]) };
    default:
      return null;
  }
}

// ===== 各區塊 =====
function head(f, m) {
  f.cyl(0.46, 0.54, 0.42, 16, m.gun, 0, -0.12, 0); // 脖子
  const t = f.sub(0, 0, 0, 0.135, 0, 0); // 頭往前下方傾
  t.box(1.34, 0.96, 1.28, m.grey, 0, 0.46, -0.06, 0.07);
  t.box(0.96, 0.26, 1.08, m.grey, 0, 0.96, -0.06, 0.05); // 頂蓋
  t.box(0.52, 0.07, 0.18, m.dark, 0, 0.96, 0.44, 0.01);
  t.box(1.28, 0.34, 0.56, m.grey, 0, 0.72, 0.46, 0.05, 0.34); // 斜眉甲
  t.box(0.54, 0.06, 0.12, m.dark, 0, 0.74, 0.71, 0.01, 0.34);
  t.box(1.16, 0.36, 0.38, m.dark, 0, 0.44, 0.52, 0.03); // 面罩凹槽
  t.box(0.92, 0.19, 0.14, m.visor, 0, 0.44, 0.65, 0.02); // 紅色護目鏡
  t.box(0.64, 0.34, 0.46, m.gun, 0, 0.12, 0.58, 0.04, 0.12); // 下巴
  t.box(0.52, 0.24, 0.42, m.grey, 0, 0.08, 0.64, 0.04, 0.15);
  for (const s of [-1, 1]) {
    t.box(0.32, 0.4, 0.44, m.grey, s * 0.52, 0.18, 0.5, 0.04, 0.14, s * 0.18); // 頰甲
    t.box(0.24, 0.64, 0.68, m.grey, s * 0.74, 0.46, -0.06, 0.04); // 耳部感測器
    t.cyl(0.15, 0.15, 0.28, 16, m.gun, s * 0.74, 0.46, -0.06, 0, 0, PI2);
  }
  const a = t.sub(-0.54, 0.86, -0.46, -0.26, 0, -0.14); // 天線
  a.box(0.2, 0.28, 0.26, m.gun, 0, 0, 0, 0.03);
  a.cyl(0.032, 0.055, 1.55, 12, m.steel, 0, 0.85, 0);
  a.cyl(0.052, 0.052, 0.16, 12, m.yellow, 0, 0.32, 0);
}

// 胸塊下方的雙圓形噴口（原檔 addTwinCircularVents）
function twinVents(f, m, x, y, z) {
  f.box(1.08, 0.54, 1.68, m.gun, x, y, z - 0.58, 0.05);
  f.box(0.92, 0.4, 0.22, m.dark, x, y, z + 0.18, 0.03);
  for (const dx of [-0.21, 0.21]) {
    f.cyl(0.15, 0.15, 0.16, 18, m.gun, x + dx, y, z + 0.25, PI2);
    f.cyl(0.095, 0.095, 0.18, 16, m.dark, x + dx, y, z + 0.26, PI2);
  }
}
function core(f0, m) {
  const f = f0.sub(0, TORSO, 0);
  f.box(2.55, 1.95, 1.65, m.dark, 0, 0.05, -0.08, 0.05); // 內部骨架
  // 中央胸部（比左右胸塊低）
  f.box(1.16, 0.58, 0.96, m.grey, 0, 0.52, 0.54, 0.05, -0.52);
  f.box(1.18, 0.96, 1.05, m.olive, 0, -0.02, 0.72, 0.06);
  f.box(0.48, 0.1, 0.1, m.dark, 0, 0.04, 1.22, 0.02);
  f.box(1.14, 0.64, 1.12, m.gun, 0, -0.74, 0.52, 0.05); // 下腹
  for (const x of [-0.25, 0.25]) f.box(0.32, 0.15, 0.1, m.dark, x, -0.72, 1.06, 0.02);
  f.decal(3, 0.34, 0.34, 0.3, -0.25, 1.25);
  f.box(0.2, 0.04, 0.02, m.yellow, 0.3, -0.43, 1.25, 0.005);
  // 左右胸塊：上層後甲板＋往前傾的引擎蓋＋正面＋下方的雙噴口
  for (const X of [-1.18, 1.18]) {
    f.box(1.1, 0.56, 1.12, m.olive, X, 0.98, -0.14, 0.05);
    f.box(1.1, 0.76, 1.08, m.olive, X, 0.84, 0.42, 0.05, -0.52);
    f.box(1.12, 1.08, 1.78, m.olive, X, 0.18, 0.16, 0.06);
    twinVents(f, m, X, -0.58, 0.78);
    f.box(1.0, 0.025, 0.02, m.dark, X, -0.24, 1.055, 0.005); // 面板線
  }
  // 原檔 +X 的胸塊：01＋白條與黃條
  f.decal(7, 0.5, 0.5, 1.18 - 0.15, 0.32, 1.06);
  f.box(0.34, 0.035, 0.02, m.grey, 1.18 - 0.15, 0.05, 1.055, 0.005);
  f.box(0.34, 0.045, 0.02, m.yellow, 1.18 - 0.15, -0.0, 1.055, 0.005);
  // 原檔 −X 的胸塊：縱向黃條（延伸到引擎蓋）＋AC
  f.box(0.17, 1.06, 0.02, m.yellow, -1.18 + 0.12, 0.18, 1.055, 0.005);
  f.sub(-1.18, 0.84, 0.42, -0.52).box(0.17, 0.74, 0.02, m.yellow, 0.12, 0, 0.545, 0.005);
  f.sub(-1.18, 0.84, 0.42, -0.52).decal(3, 0.3, 0.3, -0.2, 0, 0.546);
  f.decal(3, 0.3, 0.3, -1.18 - 0.25, 0.08, 1.06);
}

function pelvis(f0, m) {
  const f = f0.sub(0, 3.92, 0);
  f.cyl(0.72, 0.78, 0.55, 18, m.gun, 0, 0.42, 0); // 腰部機構
  f.box(1.35, 0.78, 1.32, m.gun, 0, 0.02, -0.05, 0.05);
  f.box(1.04, 0.26, 1.42, m.gun, 0, 0.22, 0.2, 0.04);
  f.box(1.06, 1.26, 1.52, m.slate, 0, -0.4, 0.26, 0.06); // 深藍的襠部
  f.box(0.92, 0.3, 1.24, m.slate, 0, -1.04, 0.18, 0.05);
  f.box(1.0, 0.07, 0.02, m.grey, 0, -0.08, 1.025, 0.005); // 白色橫條
  f.cyl(0.34, 0.34, 2.42, 18, m.dark, 0, -0.06, 0.02, 0, 0, PI2); // 髖軸
  for (const hx of [-0.86, 0.86]) f.cyl(0.42, 0.42, 0.28, 16, m.gun, hx, -0.06, 0.02, 0, 0, PI2);
}

function thigh(f, m) {
  f.box(1.36, 0.7, 1.42, m.olive, 0, -0.22, 0.04, 0.06);
  f.box(1.24, 0.76, 1.3, m.gun, 0, -0.84, -0.06, 0.05);
  const fr = f.sub(0, -0.86, 0.14, -0.13);
  fr.box(1.38, 0.78, 1.4, m.grey, 0, 0, 0, 0.06); // 前面往前傾的灰板
  fr.box(0.17, 0.76, 0.02, m.yellow, 0, 0, 0.705, 0.005);
  fr.decal(1, 0.3, 0.3, 0.42, 0.12, 0.706);
  f.box(1.2, 0.035, 0.02, m.grey, 0, 0.07, 0.755, 0.005); // 白線
  f.box(0.17, 0.6, 0.02, m.yellow, 0, -0.27, 0.755, 0.005); // 中央黃條
  f.box(0.94, 0.44, 1.02, m.gun, 0, -1.38, -0.02, 0.04); // 膝關節
  f.cyl(0.38, 0.38, 1.2, 18, m.dark, 0, -1.42, 0.02, 0, 0, PI2);
}

function shin(f, m, sign) {
  f.box(1.54, 0.78, 1.62, m.olive, 0, -0.94, 0.06, 0.06); // 下段（比膝甲寬）
  f.box(1.52, 0.86, 1.46, m.olive, 0, -0.4, -0.08, 0.06);
  f.box(0.44, 1.26, 1.54, m.olive, -sign * 0.56, -0.66, 0.02, 0.05); // 內側板
  f.box(0.42, 1.26, 1.5, m.olive, sign * 0.56, -0.66, -0.02, 0.05); // 外側板
  f.box(1.24, 1.06, 0.48, m.gun, 0, -0.68, -0.84, 0.05); // 小腿後方
  f.box(0.17, 0.42, 0.02, m.yellow, 0, -1.12, 0.875, 0.005);
  f.decal(7, 0.42, 0.42, -sign * 0.785, -0.62, 0.1, 0, -sign * PI2);
  // 往前傾的深藍膝甲（比小腿窄）
  f.box(1.14, 0.92, 1.22, m.slate, sign * 0.02, -0.32, 0.42, 0.06, -0.14);
  const kn = f.sub(sign * 0.02, -0.3, 0.9, -0.16);
  kn.box(1.06, 0.8, 0.38, m.slate, 0, 0, 0, 0.05);
  kn.box(0.2, 0.05, 0.02, m.yellow, 0.3, -0.3, 0.195, 0.005);
  kn.box(0.38, 0.03, 0.02, m.grey, -0.22, -0.12, 0.195, 0.005);
  f.box(0.64, 0.2, 0.28, m.gun, sign * 0.02, 0.14, 0.76, 0.03, -0.14);
}

function foot(f0, m) {
  const f = f0.sub(0, 0.055, 0); // 拉直腿之後鞋底剛好貼地
  f.cyl(0.48, 0.54, 0.42, 16, m.gun, 0, 0.14, 0); // 腳踝
  f.box(1.48, 0.22, 1.24, m.slate, 0, 0.12, 0.26, 0.04);
  f.box(1.72, 0.94, 1.46, m.slate, 0, -0.32, 0.36, 0.06);
  f.box(1.66, 0.82, 0.94, m.slate, 0, -0.28, 0.88, 0.05, 0.42);
  f.box(1.68, 0.52, 0.52, m.slate, 0, -0.54, 0.98, 0.05);
  f.box(0.44, 0.12, 0.12, m.dark, 0, -0.14, 1.26, 0.02, 0.42);
  f.box(1.66, 0.92, 0.88, m.heel, 0, -0.33, -0.82, 0.06); // 腳跟
  f.box(1.72, 0.2, 2.32, m.gun, 0, -0.775, -0.12, 0.03); // 鞋底
  for (const tx of [-0.48, 0.48]) {
    f.box(0.58, 0.6, 0.76, m.grey, tx, -0.51, 1.42, 0.05); // 雙腳趾
    f.box(0.54, 0.38, 0.48, m.grey, tx, -0.38, 1.56, 0.04, 0.34);
    f.box(0.56, 0.14, 0.74, m.dark, tx, -0.805, 1.42, 0.02);
  }
}

function upper(f, m, sign) {
  f.cyl(0.38, 0.38, 0.85, 18, m.gun, -sign * 0.42, 0.06, 0, 0, 0, PI2); // 肩軸
  f.box(0.42, 0.56, 0.68, m.dark, -sign * 0.46, 0.06, 0, 0.04);
  f.box(1.36, 1.42, 1.62, m.grey, sign * 0.08, 0.12, 0, 0.07); // 大肩甲
  f.box(1.4, 0.24, 1.66, m.gun, sign * 0.08, -0.54, 0, 0.04);
  f.decal(7, 0.8, 0.8, sign * 0.765, 0.18, 0, 0, sign * PI2);
  f.box(0.02, 0.09, 0.21, m.yellow, sign * 0.765, -0.32, 0.5, 0.005);
  f.box(0.5, 0.42, 0.02, m.gun, sign * 0.08 - sign * 0.3, 0.5, 0.815, 0.005); // 正面的深色小板
  const ua = f.sub(sign * 0.08, -0.92, 0);
  ua.box(0.78, 0.72, 0.84, m.gun, 0, 0.04, 0, 0.05);
  ua.cyl(0.32, 0.32, 0.96, 18, m.dark, 0, -0.44, 0, 0, 0, PI2); // 手肘
}

function fore(f, m, sign) {
  f.box(1.12, 0.26, 1.16, m.olive, 0, -0.16, 0.02, 0.04);
  f.box(1.24, 1.36, 1.28, m.olive, 0, -0.76, 0.04, 0.06);
  f.box(1.27, 0.2, 1.31, m.yellow, 0, -1.08, 0.04, 0.02); // 繞一圈的黃色腕帶
  f.box(0.3, 1.1, 0.86, m.olive, sign * 0.54, -0.66, -0.04, 0.04);
  f.box(0.92, 0.42, 0.54, m.gun, 0, -0.16, -0.44, 0.04);
}

function hand(f, m, sign) {
  f.cyl(0.34, 0.36, 0.24, 16, m.gun, 0, 0.08, 0);
  f.box(0.68, 0.58, 0.74, m.gun, 0, -0.24, 0, 0.04);
  f.box(0.38, 0.54, 0.68, m.grey, sign * 0.24, -0.25, 0, 0.04);
  for (let i = -1; i <= 1; i++) f.box(0.32, 0.3, 0.19, m.dark, -sign * 0.12, -0.5, i * 0.21, 0.03);
  f.box(0.26, 0.34, 0.22, m.grey, -sign * 0.16, -0.24, 0.38, 0.03);
}

// 背包（原檔軀幹的 (0, 0.28, −1.18)）：推進器往後下方傾，噴焰從連接點往 −Y 噴
function booster(f, m) {
  f.box(2.65, 1.95, 1.05, m.gun, 0, 0, 0, 0.07);
  f.box(1.78, 1.38, 0.52, m.slate, 0, 0.06, -0.44, 0.06);
  f.box(0.5, 0.06, 0.02, m.yellow, 0.5, -0.45, -0.705, 0.005);
  for (const tx of [-0.52, 0.52]) {
    f.cyl(0.26, 0.4, 0.52, 20, m.steel, tx, -0.6, -0.57, 0.35);
    f.cyl(0.2, 0.3, 0.55, 16, m.dark, tx, -0.61, -0.6, 0.35);
  }
}

// ===== 武器（原點＝握把／肩上武器座） =====
function rifle(f0, m) {
  const f = f0.sub(0, 0.18, 0.36); // 原點移到手握的握把
  f.box(0.38, 0.54, 3.25, m.gun, 0, 0.08, 0.82, 0.04); // 機匣與護木
  f.box(0.34, 0.28, 1.85, m.dark, 0, -0.22, 0.48, 0.03);
  f.box(0.32, 0.42, 0.82, m.gun, 0, 0.02, -0.95, 0.04); // 槍托
  f.box(0.22, 0.48, 0.28, m.dark, 0, -0.18, -0.36, 0.02, 0.22); // 握把
  f.box(0.26, 0.16, 1.95, m.grey, 0, 0.41, 0.45, 0.03); // 導軌
  f.box(0.28, 0.18, 0.36, m.gun, 0, 0.42, 2.05, 0.02);
  const mag = f.sub(0, -0.58, 0.52, -0.18); // 往前斜的彈匣
  mag.box(0.26, 0.72, 0.44, m.gun, 0, 0, 0, 0.03);
  for (const mz of [-0.08, 0.08]) mag.box(0.28, 0.56, 0.06, m.dark, 0, -0.02, mz, 0.01);
  for (let v = 0; v < 5; v++) f.box(0.41, 0.22, 0.065, m.dark, 0, 0.05, 1.15 + v * 0.18, 0.01, -0.38); // 斜散熱縫
  for (const by of [0.14, -0.08]) {
    // 上下雙槍管
    f.cyl(0.105, 0.105, 0.68, 18, m.steel, 0, by, 2.68, PI2);
    f.cyl(0.12, 0.12, 0.22, 18, m.gun, 0, by, 2.92, PI2);
    f.cyl(0.068, 0.068, 0.25, 16, m.dark, 0, by, 2.94, PI2);
  }
}
// 3×3 導彈莢（sign：裝在原檔的哪一側，掛架在內側）
function missilePod(f, m, sign) {
  f.box(0.52, 0.92, 0.72, m.gun, -sign * 0.28, -0.78, -0.42, 0.05); // 掛架
  f.box(1.46, 1.48, 1.92, m.slate, 0, 0, -0.18, 0.07);
  f.box(1.5, 1.52, 0.46, m.olive, 0, 0, 0.66, 0.06);
  f.box(1.48, 0.28, 1.98, m.olive, 0, -0.76, -0.05, 0.04);
  f.box(1.5, 0.08, 0.52, m.yellow, 0, -0.76, 0.64, 0.01);
  f.box(0.02, 0.42, 0.32, m.yellow, sign * 0.735, 0.0, -0.55, 0.005);
  f.decal(7, 0.36, 0.36, sign * 0.735, 0.42, -0.55, 0, sign * PI2);
  for (let row = -1; row <= 1; row++)
    for (let col = -1; col <= 1; col++) {
      const cx = col * 0.39,
        cy = row * 0.39;
      f.box(0.33, 0.33, 0.24, m.olive, cx, cy, 0.84, 0.03);
      f.box(0.25, 0.25, 0.24, m.dark, cx, cy, 0.87, 0.02);
      f.cyl(0.04, 0.105, 0.22, 16, m.copper, cx, cy, 0.92, PI2); // 彈頭
      f.cyl(0.035, 0.035, 0.06, 12, m.steel, cx, cy, 1.03, PI2);
    }
}
// 2×2 四聯砲
function quadCannon(f, m, sign) {
  f.box(0.62, 0.88, 0.82, m.gun, -sign * 0.28, -0.72, -0.4, 0.05); // 掛架
  f.box(1.44, 1.26, 1.82, m.slate, 0, 0, -0.22, 0.07);
  f.box(1.48, 0.84, 1.12, m.grey, 0, 0.04, -0.05, 0.05);
  f.box(1.26, 1.1, 0.44, m.gun, 0, 0, 0.66, 0.05);
  f.decal(7, 0.5, 0.5, sign * 0.745, 0.04, -0.05, 0, sign * PI2);
  for (const [bx, by] of [
    [-0.29, 0.29],
    [0.29, 0.29],
    [-0.29, -0.29],
    [0.29, -0.29],
  ]) {
    const b = f.sub(bx, by, 0.82);
    b.cyl(0.22, 0.22, 0.44, 20, m.gun, 0, 0, 0.15, PI2);
    b.cyl(0.175, 0.185, 1.32, 20, m.gun, 0, 0, 0.64, PI2);
    b.cyl(0.205, 0.205, 0.16, 20, m.dark, 0, 0, 0.7, PI2);
    b.cyl(0.195, 0.195, 0.22, 20, m.steel, 0, 0, 1.26, PI2);
    b.cyl(0.105, 0.105, 0.25, 16, m.dark, 0, 0, 1.27, PI2);
    b.box(0.31, 0.06, 0.12, m.dark, 0, 0, 1.34, 0.01);
    b.box(0.06, 0.31, 0.12, m.dark, 0, 0, 1.34, 0.01);
  }
}

// 建立 CUBEE 區塊：回傳 true＝已建立（由 mech-model.js 的 BUILD 呼叫）
export function buildCubeePiece(g, info, M, red) {
  const id = info.part.id;
  if (!CUBEE_PARTS.has(id)) return false;
  const m = mats(M, red);
  const f = new Frame(g, M);
  const sign = -info.side; // 遊戲的右側＝原檔的 sign −1
  const B = { head, core, pelvis, thigh, foot, booster };
  if (B[info.kind]) B[info.kind](f, m);
  else if (info.kind === 'shin') shin(f, m, sign);
  else if (info.kind === 'upper') upper(f, m, sign);
  else if (info.kind === 'fore') fore(f, m, sign);
  else if (info.kind === 'hand') hand(f, m, sign);
  else return false;
  return true;
}
export function buildCubeeWeapon(g, part, M, side) {
  if (!CUBEE_WEAPONS.has(part.id)) return false;
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.3 });
  const m = mats(M, red);
  const sign = -side;
  if (part.id === 'w_crifle') rifle(new Frame(g, M, 0, RIFLE_SCALE.clone()), m);
  else if (part.id === 'bw_cms') missilePod(new Frame(g, M), m, sign);
  else quadCannon(new Frame(g, M), m, sign);
  return true;
}
