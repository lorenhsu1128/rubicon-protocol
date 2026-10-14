// 主題專屬敵人的程式模型（docs/campaign-design.md 第 6 節；第 1 章：荒野、沙丘、礦坑；第 2 章：集散場、水壩、水沒市街）
// 介面同 boss-models.js（vehicle: true；animateMech 只處理閃光與噴嘴）；原點在地面（飛行的在機體中心下方），正面 −Z。
// 會動的節點放在 extra（entities/mech-foe.js 使用）。
import {
  CB as CB0,
  P,
  bakeAll,
  decal,
  gBox,
  gCyl,
  gLoft,
  gPlate,
  gPod,
  gSph,
  kitCable,
  sideProfile,
} from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

// ---------- 共用的造型小工具（vehicle-models.js 也用）----------
const PI = Math.PI,
  HP = Math.PI / 2;
const _up = new THREE.Vector3(0, 1, 0);
// 倒角方塊；小零件（最短邊 < 0.4 m）的倒角看不出來，改用一般方塊省三角形（同時出現很多台）
function CB(n, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.06) {
  if (Math.min(w, h, d) < 0.4) P(n, gBox(w, h, d), m, x, y, z, rx, ry, rz);
  else CB0(n, w, h, d, m, x, y, z, rx, ry, rz, c);
}
function span(a, b) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = d.length();
  const e = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()),
  );
  return [L, e, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
// 兩點之間的圓桿（管線、支柱、天線）
export function rod(n, m, a, b, r, seg = 6) {
  const [L, e, x, y, z] = span(a, b);
  P(n, gCyl(r, r, L, seg), m, x, y, z, e.x, e.y, e.z);
}
// 依兩個軸擺放：ax＝區域 X 軸、ay＝大致的區域 Y 軸（自動正交化），s＝縮放
export function PB(n, geo, m, p, ax, ay, s = [1, 1, 1]) {
  const X = new THREE.Vector3(...ax).normalize();
  const Z = new THREE.Vector3().crossVectors(X, new THREE.Vector3(...ay)).normalize();
  const Y = new THREE.Vector3().crossVectors(Z, X);
  const e = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
  P(n, geo, m, p[0], p[1], p[2], e.x, e.y, e.z, s[0], s[1], s[2]);
}
// 兩點之間的方樑（腳、臂、桁架）；c ≥ 0.05 時倒角（細的樑倒角看不出來，省三角形）
export function beam(n, m, a, b, w, d, c = 0) {
  const [L, e, x, y, z] = span(a, b);
  if (c >= 0.05) CB(n, w, L, d, m, x, y, z, e.x, e.y, e.z, c);
  else P(n, gBox(w, L, d), m, x, y, z, e.x, e.y, e.z);
}
// 輪廓擠出：c＝0 時不倒角（只有前後兩圈，省三角形）
export function plate(pts, d, c, sf = 1, sb = 1) {
  if (c > 0) return gPlate(pts, d, c, sf, sb);
  return gLoft([
    { pts, z: -d / 2 },
    { pts, z: d / 2 },
  ]);
}
// 液壓桿：前半段粗的缸筒＋細的活塞桿
export function piston(n, M, a, b, r = 0.05) {
  rod(n, M.joint, a, b, r);
  rod(n, M.sub, a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], r * 1.7);
}
// 側面輪廓板：[[z, y]…] 沿 X 擠出寬度 w，中心在 x
export function side(n, m, zy, w, x = 0, c = 0.04) {
  P(n, plate(sideProfile(zy), w, c), m, x, 0, 0, 0, HP, 0);
}
// 俯視輪廓板：[[x, z]…] 沿 Y 擠出厚度 h，中心在 y
export function top(n, m, xz, h, y = 0, c = 0.02, x = 0, z = 0) {
  P(n, plate(xz, h, c), m, x, y, z, HP, 0, 0);
}
// 正面輪廓板：[[x, y]…] 沿 Z 擠出厚度 d；sf／sb＝前（−z）／後面的縮放（斜面）
export function front(n, m, xy, d, z = 0, c = 0.02, sf = 1, sb = 1, x = 0, y = 0, rx = 0) {
  P(n, plate(xy, d, c, sf, sb), m, x, y, z, rx, 0, 0);
}
export const rect = (w, h, cx = 0, cy = 0) => [
  [cx - w / 2, cy - h / 2],
  [cx + w / 2, cy - h / 2],
  [cx + w / 2, cy + h / 2],
  [cx - w / 2, cy + h / 2],
];
// 切角的矩形（八角形的板）
export const crect = (w, h, c, cx = 0, cy = 0) => {
  const x = w / 2,
    y = h / 2;
  return [
    [cx - x + c, cy - y],
    [cx + x - c, cy - y],
    [cx + x, cy - y + c],
    [cx + x, cy + y - c],
    [cx + x - c, cy + y],
    [cx - x + c, cy + y],
    [cx - x, cy + y - c],
    [cx - x, cy - y + c],
  ];
};
// 輪胎＋輪框（軸沿 X）
export function wheel(n, M, x, y, z, r, w, rim = M.gun) {
  P(n, gCyl(r, r, w, 10), M.rubber, x, y, z, 0, 0, HP);
  P(n, gCyl(r * 0.6, r * 0.6, w + 0.06, 6), rim, x, y, z, 0, 0, HP);
}
// 履帶：前後斜上的橡膠帶（側面輪廓）＋露出兩側的負重輪與輪轂＋前方的驅動輪
export function track(n, M, x, zc, len, h, w, nw = 4, wm = M.sub) {
  const L = len / 2;
  side(
    n,
    M.rubber,
    [
      [zc - L, h * 0.55],
      [zc - L + h * 0.42, 0],
      [zc + L - h * 0.42, 0],
      [zc + L, h * 0.55],
      [zc + L - h * 0.22, h],
      [zc - L + h * 0.22, h],
    ],
    w * 0.84,
    x,
    0,
  );
  const r = h * 0.3;
  for (let i = 0; i < nw; i++) {
    const z = zc - L + h * 0.62 + (i * (len - h * 1.24)) / (nw - 1);
    P(n, gCyl(r, r, w * 0.96, 8), wm, x, r + 0.05, z, 0, 0, HP);
  }
  // 驅動輪（前）與惰輪（後）
  for (const s of [-1, 1])
    P(n, gCyl(h * 0.26, h * 0.26, w * 0.92, 6), M.joint, x, h * 0.58, zc + s * (L - h * 0.3), 0, 0, HP);
}
// 感測器：外框＋發光鏡頭（朝 −Z）
export function eye(n, M, gm, x, y, z, r) {
  P(n, gCyl(r * 1.5, r * 1.7, 0.1, 6), M.joint, x, y, z + 0.04, HP);
  P(n, gCyl(r, r, 0.06, 6), gm, x, y, z - 0.02, HP);
}
// 散熱縫：平貼在面上的幾條橫條（ry：面朝向，0＝朝 −Z）
export function slats(n, m, x, y, z, w, n2, gap = 0.08, ry = 0) {
  for (let i = 0; i < n2; i++) P(n, gBox(w, 0.035, 0.04), m, x, y - i * gap, z, 0, ry);
}
// 警示條：底板＋斜向的黃黑條（ry：面朝向）
export function hazard(n, M, x, y, z, w, h, ry = 0) {
  P(n, gBox(w, h, 0.02), M.joint, x, y, z, 0, ry);
  const k = Math.min(6, Math.max(2, Math.round(w / (h * 1.2))));
  const dx = w / k;
  const ox = Math.cos(ry),
    oz = -Math.sin(ry);
  for (let i = 0; i < k; i++) {
    const t = -w / 2 + dx * (i + 0.5);
    P(n, gBox(dx * 0.45, h * 0.92, 0.03), M.acc, x + ox * t, y, z + oz * t, 0, ry, 0.5);
  }
}

function rig(root, torso, M, o) {
  const hand = o.hand || new THREE.Group();
  const back = new THREE.Group();
  if (!hand.parent) torso.add(hand);
  torso.add(back);
  const arm = () => ({ hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() });
  return {
    group: root,
    legsG: new THREE.Group(),
    torso,
    head: torso,
    arms: { r: arm(), l: arm() },
    legs: [],
    nozzles: [],
    hipY: 0,
    type: o.type,
    cls: 'foe',
    vehicle: true,
    height: o.height,
    coreH: o.height * 0.5,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
    mounts: [],
    body: null,
    legNodes: [],
    rotor: null,
    ...(o.extra || {}),
  };
}
function finish(root, scale) {
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  tagStyle(root);
}
function base(pal) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  return { M, root, torso };
}

// 炸藥礦車：四輪礦車＋炸藥桶＋發光的引信（高約 1.7 m）
function buildCart(pal, scale) {
  const { M, root, torso } = base(pal);
  // 車斗：上寬下窄、前後收斜的鋼板箱
  P(
    torso,
    gPod([
      [-1.3, 1.62, 0.52, 1.4, 0.04, 0.3],
      [-1.16, 1.8, 0.5, 1.42, 0.04, 0.32],
      [1.16, 1.8, 0.5, 1.42, 0.04, 0.32],
      [1.3, 1.62, 0.52, 1.4, 0.04, 0.3],
    ]),
    M.main,
  );
  // 上緣的框與斗內的底板（炸藥桶放在上面）
  for (const s of [-1, 1]) {
    CB(torso, 0.12, 0.14, 2.8, M.joint, s * 0.94, 1.46, 0, 0, 0, 0, 0.03);
    CB(torso, 2.0, 0.14, 0.12, M.joint, 0, 1.46, s * 1.34, 0, 0, 0, 0.03);
  }
  P(torso, gBox(1.66, 0.06, 2.5), M.sub, 0, 1.4, 0);
  // 側面的補強肋
  for (const s of [-1, 1])
    for (const z of [-0.75, 0, 0.75]) P(torso, gBox(0.05, 0.56, 0.12), M.joint, s * 0.925, 1.09, z);
  // 底盤：縱樑、車軸、輪緣的礦車輪、前後的連結器
  for (const s of [-1, 1]) {
    P(torso, gBox(0.16, 0.16, 2.5), M.joint, s * 0.45, 0.45, 0);
    P(torso, gBox(0.3, 0.2, 0.22), M.joint, 0, 0.62, s * 1.38);
  }
  for (const z of [-0.9, 0.9]) {
    P(torso, gCyl(0.07, 0.07, 1.9, 4), M.sub, 0, 0.38, z, 0, 0, HP);
    for (const s of [-1, 1]) {
      P(torso, gCyl(0.38, 0.38, 0.06, 10), M.gun, s * 0.76, 0.38, z, 0, 0, HP);
      P(torso, gCyl(0.33, 0.33, 0.2, 10), M.gun, s * 0.86, 0.38, z, 0, 0, HP);
    }
  }
  // 炸藥桶：桶箍
  for (const [x, z] of [
    [-0.45, -0.55],
    [0.45, -0.55],
    [0, 0.5],
  ]) {
    P(torso, gCyl(0.38, 0.38, 0.75, 10), M.acc, x, 1.75, z);
    for (const y of [1.5, 2.0]) P(torso, gCyl(0.395, 0.395, 0.05, 10), M.joint, x, y, z);
  }
  // 引爆器：桶之間的盒子、往各桶的電線、天線
  CB(torso, 0.34, 0.2, 0.38, M.gun, 0, 2.1, -0.05, 0, 0, 0, 0.03);
  for (const [x, z] of [
    [-0.45, -0.55],
    [0.45, -0.55],
    [0, 0.5],
  ])
    rod(torso, M.rubber, [x * 0.3, 2.12, -0.05 + (z + 0.05) * 0.3], [x * 0.85, 2.15, z * 0.85], 0.02, 4);
  rod(torso, M.joint, [0.12, 2.18, 0.08], [0.12, 2.5, 0.1], 0.012, 4);
  decal(torso, 2, 1.1, 0.42, 0, 1.0, -1.31, 0, PI, 0);
  const fuse = new THREE.Group();
  fuse.position.set(0, 2.25, 0);
  torso.add(fuse);
  P(fuse, gSph(0.16, 8), glow(0xff5a20, 2.2), 0, 0, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 1.2, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'cart', height: 2.2 * scale, extra: { fuse } });
}
// 結晶寄生無人機：發光的結晶核心＋抓住結晶的機械爪座＋繞著轉的碎片（飛行，高約 1.4 m）
function buildCrystalDrone(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.7;
  const cry = new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.3,
    roughness: 0.2,
    flatShading: true,
  });
  P(torso, new THREE.OctahedronGeometry(0.55, 0), cry, 0, 0, 0, 0, 0, 0, 1, 1.5, 1);
  // 從爪座長出來的小結晶
  P(torso, new THREE.OctahedronGeometry(0.2, 0), cry, 0.32, -0.38, 0.22, 0.3, 0, -0.5, 1, 1.8, 1);
  P(torso, new THREE.OctahedronGeometry(0.15, 0), cry, -0.3, -0.4, -0.25, -0.3, 0, 0.6, 1, 1.8, 1);
  // 爪座：八角的底座環＋下方的感測器
  P(torso, gCyl(0.52, 0.42, 0.16, 8), M.main, 0, -0.55, 0, 0, PI / 8);
  P(torso, gCyl(0.3, 0.3, 0.1, 8), M.joint, 0, -0.42, 0, 0, PI / 8);
  P(torso, gCyl(0.16, 0.22, 0.12, 8), M.sub, 0, -0.66, 0);
  eye(torso, M, glow(0x3aa8ff, 2), 0, -0.55, -0.5, 0.06);
  // 三隻爪臂：從底座伸到結晶側面、往內扣
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 6;
    const c = Math.cos(a),
      s = Math.sin(a);
    beam(torso, M.main2, [c * 0.46, -0.5, s * 0.46], [c * 0.48, -0.08, s * 0.48], 0.1, 0.12, 0.02);
    beam(torso, M.joint, [c * 0.48, -0.08, s * 0.48], [c * 0.3, 0.2, s * 0.3], 0.07, 0.09, 0.02);
    P(torso, gCyl(0.06, 0.06, 0.14, 6), M.joint, c * 0.48, -0.08, s * 0.48, 0, -a, HP);
    // 姿勢控制噴嘴
    P(torso, gCyl(0.07, 0.1, 0.18, 6), M.gun, Math.cos(a + PI / 3) * 0.6, -0.56, Math.sin(a + PI / 3) * 0.6);
  }
  const shards = new THREE.Group();
  torso.add(shards);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), cry);
    m.position.set(Math.cos(a) * 0.9, (i % 2) * 0.3 - 0.15, Math.sin(a) * 0.9);
    m.rotation.set(0.4, a, 0.3);
    shards.add(m);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crystal', height: 1.4 * scale, extra: { shards } });
}
// 鑽頭採礦機：履帶底盤＋機身＋前方的大鑽頭（drill 會轉）（高約 3 m）
function buildDriller(pal, scale) {
  const { M, root, torso } = base(pal);
  for (const s of [-1, 1]) track(torso, M, s * 1.1, 0.2, 3.2, 0.9, 0.8, 4, M.acc);
  // 機身：前面往上收的斜面
  side(
    torso,
    M.main,
    [
      [-0.95, 0.85],
      [1.7, 0.85],
      [1.7, 2.1],
      [1.55, 2.25],
      [-0.35, 2.25],
      [-0.95, 1.8],
    ],
    2.2,
    0,
    0.07,
  );
  // 側面的外裝甲板與散熱縫
  for (const s of [-1, 1]) {
    side(
      torso,
      M.main2,
      [
        [-0.5, 1.15],
        [1.5, 1.15],
        [1.5, 2.0],
        [-0.15, 2.0],
        [-0.5, 1.7],
      ],
      0.08,
      s * 1.13,
      0.02,
    );
    slats(torso, M.joint, s * 1.18, 1.85, 0.95, 0.5, 5, 0.12, HP);
    P(torso, gCyl(0.08, 0.1, 0.8, 6), M.gun, s * 0.75, 2.55, 1.35);
    P(torso, gCyl(0.11, 0.11, 0.08, 6), M.joint, s * 0.75, 2.96, 1.35);
  }
  // 駕駛室：護籠＋車窗＋頭燈條
  P(
    torso,
    gPod([
      [0.4, 1.05, 2.25, 2.85, 0.1, 0.02],
      [1.4, 1.2, 2.25, 2.95, 0.12, 0.02],
    ]),
    M.main3,
  );
  P(torso, gBox(0.85, 0.24, 0.04), M.lens, 0, 2.55, 0.39);
  for (const x of [-0.3, 0, 0.3]) P(torso, gBox(0.04, 0.32, 0.05), M.joint, x, 2.55, 0.36);
  P(torso, gBox(0.8, 0.07, 0.05), glow(0xffb020, 1.2), 0, 2.76, 0.38);
  // 鑽頭的減速箱與兩側的液壓桿
  P(torso, gCyl(0.6, 0.65, 0.6, 10), M.sub, 0, 1.5, -0.95, HP);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(torso, gCyl(0.045, 0.045, 0.05, 4), M.joint, Math.cos(a) * 0.48, 1.5 + Math.sin(a) * 0.48, -1.26, HP);
  }
  for (const s of [-1, 1]) piston(torso, M, [s * 0.85, 2.05, -0.25], [s * 0.55, 1.75, -1.1], 0.05);
  const drill = new THREE.Group();
  drill.position.set(0, 1.5, -1.2);
  torso.add(drill);
  P(drill, gCyl(0.05, 0.75, 2.0, 10), M.gun, 0, 0, -1.0, -HP);
  P(drill, gCyl(0.78, 0.78, 0.14, 10), M.joint, 0, 0, -0.04, HP);
  P(drill, gCyl(0.0, 0.1, 0.25, 6), M.joint, 0, 0, -2.1, -HP);
  // 螺旋刃：三道、沿錐面往前繞
  for (let k = 0; k < 3; k++)
    for (let j = 0; j < 5; j++) {
      const t = (j + 0.5) / 5.4;
      const a = (k * PI * 2) / 3 + t * 3.2;
      const rr = 0.75 * (1 - t) + 0.08 * t + 0.03;
      const c = Math.cos(a),
        s = Math.sin(a);
      PB(
        drill,
        gBox(0.12, 0.44, 0.1),
        M.acc,
        [c * rr, s * rr, -0.12 - t * 1.85],
        [c, s, 0],
        [-s * 0.6, c * 0.6, -1],
      );
    }
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'driller', height: 3 * scale, extra: { drill } });
}
// 廢鐵合成體：低矮的履帶身體＋堆成一團的廢鐵外殼（shell 依外殼量縮放）＋兩隻粗手臂（高約 4.5 m）
const SCRAP_POLY = [
  [
    [-0.5, -0.3],
    [0.4, -0.35],
    [0.55, 0.1],
    [0.2, 0.32],
    [-0.45, 0.25],
  ],
  [
    [-0.6, -0.2],
    [0.5, -0.28],
    [0.6, 0.22],
    [-0.3, 0.3],
  ],
  [
    [-0.4, -0.35],
    [0.35, -0.3],
    [0.5, 0.0],
    [0.3, 0.35],
    [-0.35, 0.3],
    [-0.55, 0.0],
  ],
];
function buildJunk(pal, scale) {
  const { M, root, torso } = base(pal);
  for (const s of [-1, 1]) track(torso, M, s * 1.5, 0, 3.4, 1.0, 1.0, 4);
  // 身體：前低後高、往前駝的箱形
  P(
    torso,
    gPod([
      [-1.3, 2.1, 1.0, 2.45, 0.3, 0.12],
      [-0.7, 2.6, 1.0, 2.8, 0.42, 0.14],
      [1.3, 2.5, 1.0, 2.7, 0.38, 0.14],
    ]),
    M.main,
  );
  // 獨眼：外框＋發光的眼縫
  CB(torso, 1.2, 0.42, 0.2, M.joint, 0, 2.4, -1.25, 0, 0, 0, 0.05);
  P(torso, gBox(1.0, 0.25, 0.05), glow(0xff5a20, 1.6), 0, 2.4, -1.36);
  for (const x of [-0.25, 0.25]) P(torso, gBox(0.04, 0.3, 0.06), M.joint, x, 2.4, -1.38);
  // 身上焊著的廢料：側面的輪胎、鋼筋
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.42, 0.42, 0.22, 10), M.rubber, s * 1.32, 1.95, 0.75, 0, 0, HP + s * 0.25);
    rod(torso, M.sub, [s * 0.6, 2.75, 0.9], [s * 1.0, 3.3, 1.2], 0.03, 4);
  }
  // 手臂：肩軸＋上臂（液壓桿）＋前臂＋三爪的拳頭
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.38, 0.38, 0.5, 8), M.joint, s * 1.4, 2.45, -0.25, 0, 0, HP);
    beam(torso, M.main2, [s * 1.6, 2.5, -0.25], [s * 1.95, 1.4, -0.55], 0.6, 0.62, 0.08);
    piston(torso, M, [s * 1.3, 2.1, 0.05], [s * 1.75, 1.15, -0.4], 0.06);
    P(torso, gCyl(0.3, 0.3, 0.7, 8), M.joint, s * 1.95, 1.35, -0.55, 0, 0, HP);
    beam(torso, M.main3, [s * 1.98, 1.35, -0.6], [s * 2.08, 0.75, -0.8], 0.5, 0.5, 0.06);
    CB(torso, 1.0, 0.7, 1.0, M.gun, s * 2.1, 0.55, -0.8, 0, 0, 0, 0.1);
    for (const fx of [-0.3, 0, 0.3])
      beam(torso, M.joint, [s * 2.1 + fx, 0.4, -1.25], [s * 2.1 + fx * 1.1, 0.12, -1.42], 0.16, 0.16, 0.03);
  }
  const shell = new THREE.Group();
  shell.position.set(0, 2.2, 0.2);
  torso.add(shell);
  const scrap = [M.sub, M.main3, M.acc, M.main2];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const r = 1.2 + (i % 3) * 0.25;
    const y = ((i % 5) - 2) * 0.45;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, y + 0.6, Math.sin(a) * r * 0.9);
    g.rotation.set(i * 0.7, a, i * 0.3);
    shell.add(g);
    const k = 0.9 + (i % 4) * 0.25;
    if (i % 3 === 0) CB(g, k, 0.5 + (i % 3) * 0.2, 0.6, scrap[i % 4], 0, 0, 0, 0, 0, 0, 0.04);
    else if (i % 3 === 1)
      P(g, gPlate(SCRAP_POLY[(i >> 1) % 3], 0.22, 0.04), scrap[i % 4], 0, 0, 0, 0, 0, 0, k * 1.2, 1.4, 1);
    else {
      // 折彎的管子
      P(g, gCyl(0.16, 0.16, k, 6), scrap[i % 4], 0, 0, 0, 0, 0, HP);
      P(g, gCyl(0.2, 0.2, 0.08, 6), M.joint, k * 0.45, 0, 0, 0, 0, HP);
    }
  }
  const hand = new THREE.Group();
  hand.position.set(0, 2.2, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'junk', height: 4.5 * scale, extra: { shell } });
}

// 沙中伏擊者：從沙裡鑽出的鑽頭頭部＋一圈鉗爪（高約 2.6 m；在地下時整個隱藏）
const CLAW = [
  [-0.13, -0.5],
  [0.13, -0.5],
  [0.12, 0.15],
  [-0.02, 0.5],
  [-0.22, 0.62],
  [-0.12, 0.25],
];
function buildBurrower(pal, scale) {
  const { M, root, torso } = base(pal);
  // 身體：八角筒＋分節的環＋縱向的裝甲條
  P(torso, gCyl(1.1, 1.3, 1.6, 8), M.main, 0, 0.8, 0, 0, PI / 8);
  for (let i = 0; i < 3; i++)
    P(torso, gCyl(1.16 - i * 0.07, 1.2 - i * 0.07, 0.16, 8), M.main2, 0, 0.3 + i * 0.5, 0, 0, PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    if (i === 6) continue; // 正面留給感測器
    const c = Math.cos(a),
      s = Math.sin(a);
    PB(
      torso,
      gBox(0.26, 1.2, 0.08),
      M.joint,
      [c * 1.14, 0.8, s * 1.14],
      [-s, 0, c],
      [-c * 0.115, 1, -s * 0.115],
    );
  }
  // 感測器：正面的眼縫
  CB(torso, 1.05, 0.32, 0.2, M.joint, 0, 1.2, -1.08, 0, 0, 0, 0.04);
  P(torso, gBox(0.9, 0.18, 0.05), glow(0xffd060, 1.4), 0, 1.2, -1.2);
  // 頂部的頸環
  P(torso, gCyl(1.0, 1.08, 0.18, 8), M.sub, 0, 1.6, 0, 0, PI / 8);
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  torso.add(head);
  P(head, gCyl(0.1, 1.0, 1.2, 10), M.gun, 0, 0.6, 0);
  P(head, gCyl(0.0, 0.12, 0.2, 6), M.joint, 0, 1.3, 0);
  // 螺旋刃
  for (let k = 0; k < 3; k++)
    for (let j = 0; j < 3; j++) {
      const t = (j + 0.5) / 3.4;
      const a = (k * PI * 2) / 3 + t * 2.6;
      const rr = 1.0 * (1 - t) + 0.1 * t + 0.02;
      const c = Math.cos(a),
        s = Math.sin(a);
      PB(
        head,
        gBox(0.12, 0.4, 0.1),
        M.acc,
        [c * rr, 0.08 + t * 1.1, s * rr],
        [c, 0, s],
        [-s * 0.6, 1, c * 0.6],
      );
    }
  // 鉗爪：關節軸＋彎鉤的爪片
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    PB(head, gCyl(0.12, 0.12, 0.3, 6), M.joint, [c * 0.92, -0.05, s * 0.92], [c, 0, s], [-s, 0, c]);
    P(head, gPlate(CLAW, 0.2, 0.03), M.acc, c * 0.98, 0.35, s * 0.98, 0, -a, -0.45);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.4, -1.1);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'burrower', height: 2.6 * scale, extra: { head } });
}
// 沙暴干擾機：機身＋兩側的涵道風扇＋旋轉的干擾天線陣列（飛行，高約 1.6 m）
function buildJammer(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.8;
  const gl = glow(0xffa030, 2);
  P(
    torso,
    gPod([
      [-0.7, 0.6, -0.14, 0.14, 0.08, 0.08],
      [-0.4, 1.05, -0.25, 0.25, 0.14, 0.12],
      [0.45, 1.1, -0.25, 0.25, 0.14, 0.12],
      [0.7, 0.75, -0.18, 0.18, 0.08, 0.08],
    ]),
    M.main,
  );
  // 背上的設備艙與散熱縫
  CB(torso, 0.6, 0.12, 0.7, M.main3, 0, 0.29, 0.15, 0, 0, 0, 0.03);
  for (let i = 0; i < 3; i++) P(torso, gBox(0.42, 0.03, 0.05), M.joint, 0, 0.36, 0.02 + i * 0.12);
  eye(torso, M, gl, 0, 0, -0.71, 0.07);
  for (const s of [-1, 1]) {
    // 短翼＋翼端的涵道風扇
    top(
      torso,
      M.main2,
      [
        [s * 0.45, -0.25],
        [s * 0.9, -0.15],
        [s * 0.9, 0.25],
        [s * 0.45, 0.3],
      ],
      0.07,
      0.02,
      0.015,
    );
    P(torso, gCyl(0.36, 0.36, 0.14, 10), M.joint, s * 1.05, 0.04, 0);
    P(torso, gCyl(0.3, 0.3, 0.15, 10), M.sub, s * 1.05, 0.04, 0);
    P(torso, gCyl(0.07, 0.07, 0.2, 6), M.joint, s * 1.05, 0.04, 0);
    for (const a of [0, PI / 2]) P(torso, gBox(0.56, 0.02, 0.04), M.joint, s * 1.05, 0.12, 0, 0, a);
    // 下方的感測器莢艙
    P(torso, gCyl(0.06, 0.06, 0.3, 6), M.gun, s * 0.3, -0.28, -0.3, HP);
  }
  const dish = new THREE.Group();
  dish.position.set(0, 0.45, 0);
  torso.add(dish);
  P(dish, gCyl(0.06, 0.08, 0.6, 6), M.joint, 0, 0.3, 0);
  P(dish, gCyl(0.14, 0.14, 0.06, 8), M.sub, 0, 0.5, 0);
  // 天線陣列：三支橫桿，每支兩端有偶極子
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    const y = 0.55 + i * 0.1;
    P(dish, gBox(1.2, 0.04, 0.08), M.acc, 0, y, 0, 0, a, 0);
    for (const s of [-1, 1])
      P(dish, gBox(0.03, 0.16, 0.03), M.joint, Math.cos(a) * s * 0.58, y + 0.06, -Math.sin(a) * s * 0.58);
  }
  P(dish, gSph(0.12, 8), gl, 0, 0.85, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.8);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'jammer', height: 1.6 * scale, extra: { dish } });
}

// 起重機砲台：格子塔＋旋轉的吊臂，吊臂前端吊著貨櫃（crate：吊著時顯示；高約 13 m，不移動）
function buildCrane(pal, scale) {
  const { M, root, torso } = base(pal);
  // 基座：切角的混凝土座＋鋼板＋錨栓
  P(
    torso,
    gPod([
      [-1.7, 3.4, 0, 0.8, 0.22, 0],
      [1.7, 3.4, 0, 0.8, 0.22, 0],
    ]),
    M.joint,
  );
  CB(torso, 2.0, 0.2, 2.0, M.sub, 0, 0.88, 0, 0, 0, 0, 0.04);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) P(torso, gCyl(0.09, 0.09, 0.2, 4), M.gun, sx * 1.35, 0.85, sz * 1.35);
  // 格子塔：四根主柱＋每層的橫樑＋交錯的斜撐
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) P(torso, gBox(0.24, 9.2, 0.24), M.main, sx * 0.7, 5.4, sz * 0.7);
  const lv = [];
  for (let y = 1.8; y < 10; y += 1.6) lv.push(y);
  for (const y of lv)
    for (const s of [-1, 1]) {
      P(torso, gBox(1.6, 0.14, 0.14), M.main, 0, y, s * 0.7);
      P(torso, gBox(0.14, 0.14, 1.6), M.main, s * 0.7, y, 0);
    }
  for (let i = 0; i < lv.length - 1; i++) {
    const a = lv[i],
      b = lv[i + 1],
      f = i % 2 ? 1 : -1;
    for (const s of [-1, 1]) {
      rod(torso, M.main2, [-0.7 * f, a, s * 0.7], [0.7 * f, b, s * 0.7], 0.05, 4);
      rod(torso, M.main2, [s * 0.7, a, -0.7 * f], [s * 0.7, b, 0.7 * f], 0.05, 4);
    }
  }
  // 迴轉座
  P(torso, gCyl(1.05, 1.05, 0.2, 12), M.joint, 0, 9.95, 0);
  // 駕駛室：前面收斜的艙＋發光的窗
  P(
    torso,
    gPod([
      [-0.85, 1.8, 9.9, 11.1, 0.15, 0.05],
      [-0.5, 2.0, 9.9, 11.3, 0.15, 0.05],
      [1.6, 2.0, 9.9, 11.3, 0.12, 0.05],
    ]),
    M.main2,
  );
  P(torso, gBox(1.3, 0.55, 0.05), glow(0xffd060, 1.2), 0, 10.75, -0.86);
  for (const x of [-0.35, 0.35]) P(torso, gBox(0.05, 0.6, 0.07), M.joint, x, 10.75, -0.88);
  slats(torso, M.joint, 1.02, 10.95, 0.9, 0.7, 4, 0.12, HP);
  // 吊臂：三角斷面的桁架（下弦兩根、上弦一根、斜撐）
  for (const s of [-1, 1]) P(torso, gBox(0.12, 0.12, 9.4), M.main, s * 0.34, 11.36, -4.8);
  P(torso, gBox(0.14, 0.14, 9.4), M.main, 0, 12.04, -4.8);
  for (let i = 0; i < 10; i++) {
    const z0 = -0.2 - i * 0.92,
      z1 = z0 - 0.92;
    P(torso, gBox(0.7, 0.08, 0.08), M.main, 0, 11.36, z0);
    for (const s of [-1, 1]) rod(torso, M.main2, [s * 0.34, 11.36, z0], [0, 12.04, z1 + 0.46], 0.035, 4);
  }
  // 平衡臂與配重塊
  CB(torso, 0.8, 0.2, 4.0, M.main, 0, 11.5, 2.6, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) P(torso, gBox(0.05, 0.4, 3.6), M.joint, s * 0.4, 11.8, 2.4);
  for (let i = 0; i < 3; i++) CB(torso, 1.6, 0.42, 1.4, M.sub, 0, 10.72 + i * 0.46, 4.2, 0, 0, 0, 0.05);
  hazard(torso, M, 0, 11.2, 4.92, 1.4, 0.2, PI);
  // 塔頂的 A 字架與拉索、警示燈
  for (const s of [-1, 1]) beam(torso, M.main, [s * 0.4, 11.4, 0], [0, 14.4, 0], 0.18, 0.22, 0.03);
  rod(torso, M.joint, [0, 14.3, 0], [0, 12.08, -9.2], 0.03, 4);
  rod(torso, M.joint, [0, 14.3, 0], [0, 11.62, 4.5], 0.03, 4);
  P(torso, gCyl(0.12, 0.12, 0.2, 8), glow(0xff3a2a, 2), 0, 14.5, 0);
  // 吊車台車
  CB(torso, 0.7, 0.4, 0.9, M.joint, 0, 11.15, -8.9, 0, 0, 0, 0.04);
  for (const z of [-9.2, -8.6]) P(torso, gCyl(0.14, 0.14, 0.5, 8), M.sub, 0, 11.32, z, 0, 0, HP);
  const crate = new THREE.Group();
  crate.position.set(0, 0, -8.9);
  torso.add(crate);
  P(crate, gBox(0.06, 3.0, 0.06), M.joint, 0, 9.4, 0);
  CB(crate, 0.5, 0.4, 0.4, M.acc, 0, 7.85, 0, 0, 0, 0, 0.05);
  P(crate, gBox(4.0, 0.12, 0.22), M.joint, 0, 7.62, 0);
  // 貨櫃：浪板的肋＋兩端的框
  CB(crate, 4.6, 2.3, 2.4, M.acc, 0, 6.4, 0, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) {
    P(crate, gBox(0.2, 2.4, 2.5), M.joint, s * 2.2, 6.4, 0);
    for (let i = 0; i < 7; i++) P(crate, gBox(0.12, 2.1, 0.05), M.acc, -1.65 + i * 0.55, 6.4, s * 1.22);
    P(crate, gBox(4.2, 0.1, 0.06), M.joint, 0, 6.4 + s * 1.08, 1.22);
    P(crate, gBox(4.2, 0.1, 0.06), M.joint, 0, 6.4 + s * 1.08, -1.22);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 6.4, -8.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crane', height: 13 * scale, extra: { crate } });
}
// 叉架 MT：堆高機的車身與護頂架，前方的貨叉舉著貨櫃當盾牌（crate：舉著時顯示；高約 3.4 m）
function buildForklift(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffb040, 1.4);
  // 車身：側面輪廓（前低後高）
  side(
    torso,
    M.main,
    [
      [-1.2, 0.55],
      [1.6, 0.5],
      [1.8, 0.75],
      [1.8, 1.5],
      [1.6, 1.7],
      [-1.0, 1.7],
      [-1.2, 1.5],
    ],
    2.0,
    0,
    0.06,
  );
  // 輪拱上的擋泥板
  for (const z of [-0.7, 1.2])
    for (const s of [-1, 1])
      top(
        torso,
        M.main2,
        [
          [s * 0.85, z - 0.45],
          [s * 1.25, z - 0.38],
          [s * 1.25, z + 0.38],
          [s * 0.85, z + 0.45],
        ],
        0.06,
        1.0,
      );
  // 配重：後面圓弧的大塊鑄鐵＋警示條
  P(
    torso,
    gPod([
      [0.9, 1.9, 1.45, 2.3, 0.1, 0],
      [1.7, 1.9, 1.45, 2.3, 0.24, 0],
      [1.95, 1.5, 1.5, 2.15, 0.22, 0],
    ]),
    M.sub,
  );
  hazard(torso, M, 0, 1.68, 1.96, 1.3, 0.18, PI);
  // 座椅與方向盤、儀表的燈
  CB(torso, 0.6, 0.18, 0.55, M.joint, 0, 1.8, 0.45, 0, 0, 0, 0.04);
  CB(torso, 0.6, 0.55, 0.14, M.joint, 0, 2.08, 0.72, -0.15, 0, 0, 0.04);
  rod(torso, M.joint, [0, 1.7, -0.45], [0, 2.2, -0.2], 0.04);
  P(torso, gCyl(0.18, 0.18, 0.04, 8), M.sub, 0, 2.22, -0.18, -0.5);
  P(torso, gBox(0.8, 0.14, 0.05), gl, 0, 1.6, -1.22);
  // 護頂架：前柱往後斜、頂部是格柵、警示燈、頭燈
  for (const s of [-1, 1]) {
    beam(torso, M.joint, [s * 0.85, 1.7, -0.45], [s * 0.85, 3.3, -0.2], 0.1, 0.1, 0.02);
    P(torso, gBox(0.1, 1.6, 0.1), M.joint, s * 0.85, 2.5, 0.9);
    P(torso, gBox(0.1, 0.1, 1.3), M.main2, s * 0.85, 3.32, 0.35);
    P(torso, gBox(1.8, 0.1, 0.1), M.main2, 0, 3.32, s * 0.6 + 0.3);
    P(torso, gCyl(0.08, 0.08, 0.08, 8), M.lens, s * 0.85, 3.2, -0.3, HP);
  }
  for (let i = 0; i < 4; i++) P(torso, gBox(1.7, 0.04, 0.08), M.joint, 0, 3.34, -0.12 + i * 0.28);
  P(torso, gCyl(0.1, 0.1, 0.14, 8), gl, 0.6, 3.44, 0.75);
  // 車輪
  for (const [x, z] of [
    [-1.05, -0.7],
    [1.05, -0.7],
    [-1.05, 1.2],
    [1.05, 1.2],
  ])
    wheel(torso, M, x, 0.45, z, 0.45, 0.35);
  // 門架：兩根槽鋼立柱＋橫樑＋升降油壓缸與鏈條＋傾斜油壓缸
  for (const s of [-1, 1]) {
    P(torso, gBox(0.06, 3.4, 0.2), M.joint, s * 0.6, 1.9, -1.3);
    for (const dz of [-0.09, 0.09]) P(torso, gBox(0.16, 3.4, 0.04), M.joint, s * 0.55, 1.9, -1.3 + dz);
    P(torso, gBox(0.04, 2.0, 0.04), M.sub, s * 0.25, 2.2, -1.38);
    piston(torso, M, [s * 0.5, 1.05, -0.95], [s * 0.55, 1.55, -1.25], 0.05);
  }
  for (const y of [0.4, 3.5]) P(torso, gBox(1.35, 0.12, 0.12), M.joint, 0, y, -1.3);
  piston(torso, M, [0, 0.45, -1.25], [0, 3.2, -1.25], 0.07);
  // 叉架：背板＋擋貨架＋L 形貨叉
  P(torso, gBox(1.4, 0.45, 0.08), M.main2, 0, 0.85, -1.46);
  for (const x of [-0.6, 0, 0.6]) P(torso, gBox(0.05, 0.9, 0.05), M.main2, x, 1.5, -1.46);
  P(torso, gBox(1.4, 0.06, 0.06), M.main2, 0, 1.95, -1.46);
  for (const s of [-1, 1]) {
    P(torso, gBox(0.18, 0.62, 0.08), M.gun, s * 0.5, 0.82, -1.52);
    P(torso, gBox(0.2, 0.08, 1.6), M.gun, s * 0.5, 0.55, -2.1);
  }
  const crate = new THREE.Group();
  crate.position.set(0, 0, -2.3);
  torso.add(crate);
  CB(crate, 3.0, 2.4, 1.5, M.acc, 0, 1.85, 0, 0, 0, 0, 0.04);
  for (let i = 0; i < 6; i++) P(crate, gBox(0.12, 2.2, 0.05), M.acc, -1.1 + i * 0.44, 1.85, -0.77);
  for (const s of [-1, 1]) {
    P(crate, gBox(0.2, 2.5, 1.56), M.joint, s * 1.4, 1.85, 0);
    P(crate, gBox(2.7, 0.1, 0.06), M.joint, 0, 1.85 + s * 1.12, -0.76);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'forklift', height: 3.4 * scale, extra: { crate } });
}

// 閘門砲台：裝在閘門上的楔形砲塔＋雙砲管＋開閘的捲揚輪（高約 3.2 m，不移動）
function buildGateTurret(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x60c8ff, 1.6);
  // 基座與迴轉環
  P(
    torso,
    gPod([
      [-1.6, 3.2, 0, 0.8, 0.22, 0],
      [1.6, 3.2, 0, 0.8, 0.22, 0],
    ]),
    M.joint,
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2 + PI / 8;
    P(torso, gCyl(0.06, 0.06, 0.08, 4), M.gun, Math.cos(a) * 1.4, 0.82, Math.sin(a) * 1.4);
  }
  P(torso, gCyl(1.25, 1.3, 0.12, 12), M.sub, 0, 0.86, 0);
  // 砲塔：前面收斜的楔形＋防盾
  P(
    torso,
    gPod([
      [-1.4, 2.1, 0.88, 2.1, 0.34, 0.12],
      [-0.85, 2.6, 0.85, 2.4, 0.32, 0.12],
      [1.4, 2.6, 0.85, 2.4, 0.2, 0.12],
    ]),
    M.main,
  );
  CB(torso, 1.7, 0.72, 0.3, M.main2, 0, 1.85, -1.42, 0, 0, 0, 0.06);
  for (const s of [-1, 1]) {
    // 砲管：套筒＋砲身＋砲口制退器＋駐退筒
    P(torso, gCyl(0.22, 0.22, 0.55, 8), M.joint, s * 0.55, 1.9, -1.75, HP);
    P(torso, gCyl(0.15, 0.17, 2.2, 8), M.gun, s * 0.55, 1.9, -2.4, HP);
    CB(torso, 0.34, 0.34, 0.42, M.joint, s * 0.55, 1.9, -3.3, 0, 0, 0, 0.04);
    P(torso, gBox(0.38, 0.08, 0.1), M.sub, s * 0.55, 1.9, -3.25);
    P(torso, gCyl(0.07, 0.07, 0.8, 6), M.sub, s * 0.55, 1.62, -1.85, HP);
    // 側面的裝甲板與散熱縫
    side(
      torso,
      M.main2,
      [
        [-0.7, 1.0],
        [1.2, 1.0],
        [1.2, 2.1],
        [-0.4, 2.1],
        [-0.7, 1.75],
      ],
      0.08,
      s * 1.32,
      0.02,
    );
    slats(torso, M.joint, s * 1.37, 1.85, 0.55, 0.5, 4, 0.12, HP);
  }
  // 感測器艙
  CB(torso, 0.6, 0.32, 0.5, M.sub, 0.75, 2.55, -0.7, 0, 0, 0, 0.04);
  P(torso, gBox(0.46, 0.12, 0.05), gl, 0.75, 2.56, -0.97);
  // 捲揚機：兩側的 A 字支架、軸、捲筒、往閘門的鋼索
  for (const s of [-1, 1]) {
    beam(torso, M.acc, [s * 1.4, 1.0, 0.05], [s * 1.4, 2.95, 0.6], 0.2, 0.2, 0.03);
    beam(torso, M.acc, [s * 1.4, 1.0, 1.2], [s * 1.4, 2.95, 0.6], 0.2, 0.2, 0.03);
    P(torso, gCyl(0.18, 0.18, 0.16, 8), M.joint, s * 1.42, 2.9, 0.6, 0, 0, HP);
    P(torso, gCyl(0.3, 0.3, 0.55, 8), M.rubber, s * 0.72, 2.9, 0.6, 0, 0, HP);
    rod(torso, M.joint, [s * 0.72, 2.62, 0.75], [s * 0.72, 0.9, 1.45], 0.025, 4);
  }
  P(torso, gCyl(0.08, 0.08, 2.9, 6), M.joint, 0, 2.9, 0.6, 0, 0, HP);
  // 捲揚輪（軸沿 X，開閘前繞 X 轉動）：輪緣＋輻條＋輪轂
  const wheelG = new THREE.Group();
  wheelG.position.set(0, 2.9, 0.6);
  torso.add(wheelG);
  P(wheelG, new THREE.TorusGeometry(0.74, 0.07, 4, 14), M.main2, 0, 0, 0, 0, HP, 0);
  for (let i = 0; i < 3; i++) P(wheelG, gBox(0.06, 1.48, 0.08), M.main2, 0, 0, 0, (i * Math.PI) / 3);
  P(wheelG, gCyl(0.18, 0.18, 0.24, 8), M.joint, 0, 0, 0, 0, 0, HP);
  const hand = new THREE.Group();
  hand.position.set(0, 1.9, -3.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'gate_turret', height: 3.2 * scale, extra: { wheel: wheelG } });
}
// 壩頂巡邏砲車：六輪裝甲車＋長砲管的砲塔（高約 2.6 m）
function buildPatrolCart(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffb040, 1.4);
  // 車身：前面斜的裝甲車輪廓＋側裙
  side(
    torso,
    M.main,
    [
      [-2.05, 1.0],
      [-1.75, 0.6],
      [1.85, 0.6],
      [2.0, 0.85],
      [1.95, 1.55],
      [1.6, 1.65],
      [-1.0, 1.65],
    ],
    2.0,
    0,
    0.06,
  );
  for (const s of [-1, 1]) {
    side(
      torso,
      M.main2,
      [
        [-2.0, 0.92],
        [-1.85, 1.15],
        [1.85, 1.15],
        [2.0, 0.92],
        [2.0, 1.28],
        [-1.95, 1.28],
      ],
      0.08,
      s * 1.06,
      0.02,
    );
    for (const z of [-1.4, 0, 1.4]) wheel(torso, M, s * 1.15, 0.45, z, 0.45, 0.35);
    // 收納箱、頭燈、拖鉤
    CB(torso, 0.45, 0.28, 1.0, M.sub, s * 0.72, 1.78, 1.3, 0, 0, 0, 0.04);
    P(torso, gBox(0.3, 0.12, 0.05), gl, s * 0.7, 1.05, -2.03);
    P(torso, gBox(0.12, 0.12, 0.2), M.joint, s * 0.5, 0.7, -1.9);
  }
  // 引擎蓋的散熱縫
  for (let i = 0; i < 4; i++) P(torso, gBox(1.0, 0.03, 0.06), M.joint, 0, 1.67, 0.95 + i * 0.16);
  // 砲塔：楔形＋防盾＋長砲管＋同軸機槍、艙蓋、感測器、天線
  P(
    torso,
    gPod([
      [-0.55, 1.1, 1.6, 2.15, 0.18, 0.05],
      [-0.2, 1.5, 1.6, 2.3, 0.2, 0.05],
      [1.15, 1.5, 1.6, 2.25, 0.15, 0.05],
    ]),
    M.main2,
  );
  CB(torso, 0.6, 0.4, 0.25, M.joint, 0, 1.98, -0.6, 0, 0, 0, 0.05);
  P(torso, gCyl(0.16, 0.16, 0.5, 8), M.joint, 0, 2.0, -0.95, HP);
  P(torso, gCyl(0.1, 0.12, 2.0, 8), M.gun, 0, 2.0, -2.0, HP);
  CB(torso, 0.26, 0.22, 0.32, M.joint, 0, 2.0, -2.9, 0, 0, 0, 0.03);
  P(torso, gCyl(0.03, 0.03, 0.6, 5), M.gun, 0.3, 1.95, -0.85, HP);
  P(torso, gCyl(0.22, 0.24, 0.08, 8), M.sub, -0.35, 2.3, 0.4);
  eye(torso, M, gl, 0.5, 2.1, -0.38, 0.06);
  rod(torso, M.joint, [-0.55, 2.2, 0.9], [-0.55, 3.0, 0.95], 0.012, 4);
  const hand = new THREE.Group();
  hand.position.set(0, 2.0, -3.0);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'patrol_cart', height: 2.6 * scale });
}

// 潛航砲艇：V 字的艇身、尖艏、司令塔與潛望鏡、艏部魚雷管、甲板砲（高約 1.8 m；潛航時隱藏）
function buildGunboat(pal, scale) {
  const { M, root, torso } = base(pal);
  P(
    torso,
    gPod([
      [-3.45, 0.2, 0.5, 0.8, 0.05, 0.05],
      [-2.6, 1.5, 0.2, 1.0, 0.2, 0.4],
      [-1.4, 2.3, 0.15, 1.05, 0.25, 0.5],
      [1.8, 2.4, 0.15, 1.05, 0.25, 0.5],
      [2.6, 1.9, 0.25, 0.95, 0.2, 0.4],
    ]),
    M.main,
  );
  // 甲板（另一個色槽的防滑板）
  top(
    torso,
    M.main3,
    [
      [0, -3.0],
      [0.55, -2.2],
      [0.88, -1.2],
      [0.88, 2.3],
      [-0.88, 2.3],
      [-0.88, -1.2],
      [-0.55, -2.2],
    ],
    0.04,
    1.06,
  );
  // 司令塔：流線形＋發光的窗、潛望鏡、雷達桿
  P(
    torso,
    gPod([
      [-0.25, 0.6, 1.0, 1.5, 0.1, 0],
      [0.15, 1.1, 1.0, 1.62, 0.14, 0],
      [1.2, 1.15, 1.0, 1.62, 0.14, 0],
      [1.45, 0.7, 1.0, 1.45, 0.1, 0],
    ]),
    M.main2,
  );
  P(torso, gBox(0.5, 0.12, 0.05), glow(0x9aff40, 1.4), 0, 1.33, -0.27);
  P(torso, gCyl(0.08, 0.1, 1.1, 6), M.joint, 0.3, 2.1, 0.9);
  CB(torso, 0.16, 0.14, 0.3, M.joint, 0.3, 2.65, 0.85, 0, 0, 0, 0.02);
  rod(torso, M.joint, [-0.25, 1.6, 0.9], [-0.25, 2.1, 0.9], 0.03, 5);
  P(torso, gBox(0.6, 0.05, 0.1), M.sub, -0.25, 2.1, 0.9);
  // 艏部的甲板砲
  P(torso, gCyl(0.32, 0.36, 0.25, 8), M.main2, 0, 1.18, -1.5);
  P(torso, gCyl(0.06, 0.07, 1.0, 6), M.gun, 0, 1.24, -2.0, HP);
  // 魚雷管（兩側）與艉部的舵
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.16, 0.16, 1.2, 8), M.gun, s * 0.6, 0.55, -2.35, HP);
    P(torso, gCyl(0.19, 0.19, 0.08, 8), M.joint, s * 0.6, 0.55, -2.95, HP);
  }
  side(
    torso,
    M.joint,
    [
      [2.2, 0.95],
      [2.7, 0.95],
      [2.75, 1.45],
      [2.5, 1.45],
    ],
    0.08,
    0,
    0.02,
  );
  // 欄杆
  for (const z of [-0.8, 1.6, 2.1])
    for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.8, 1.06, z], [s * 0.8, 1.4, z], 0.02, 4);
  for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.8, 1.4, 1.6], [s * 0.8, 1.4, 2.1], 0.02, 4);
  const hand = new THREE.Group();
  hand.position.set(0, 0.6, -3.2);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'gunboat', height: 1.8 * scale });
}
// 汙染噴射 MT：履帶底盤＋背上的汙染液槽＋前方的噴嘴臂（高約 3.2 m）
function buildSprayer(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x9aff40, 1.8);
  for (const s of [-1, 1]) track(torso, M, s * 1.05, 0, 3.0, 0.9, 0.8, 4);
  side(
    torso,
    M.main,
    [
      [-1.1, 0.8],
      [1.3, 0.8],
      [1.3, 1.75],
      [-0.7, 1.8],
      [-1.1, 1.45],
    ],
    1.8,
    0,
    0.06,
  );
  // 液槽：圓筒＋兩端的蓋＋箍＋鞍座、頂部的通氣閥（發光）、側面的液位窗
  P(torso, gCyl(0.75, 0.75, 2.2, 10), M.acc, 0, 2.4, 0.6, HP);
  P(torso, gCyl(0.75, 0.55, 0.22, 10), M.acc, 0, 2.4, 1.81, HP);
  P(torso, gCyl(0.55, 0.75, 0.22, 10), M.acc, 0, 2.4, -0.61, HP);
  for (const z of [-0.2, 1.4]) {
    P(torso, gCyl(0.8, 0.8, 0.15, 10), M.main2, 0, 2.4, z, HP);
    CB(torso, 1.4, 0.3, 0.25, M.joint, 0, 1.82, z, 0, 0, 0, 0.04);
  }
  P(torso, gCyl(0.16, 0.2, 0.18, 8), M.joint, 0, 3.12, 0.6);
  P(torso, gSph(0.2, 8), gl, 0, 3.24, 0.6);
  P(torso, gBox(0.05, 0.12, 1.2), gl, 0.76, 2.4, 0.6);
  decal(torso, 0, 0.5, 0.5, -0.77, 2.4, 0.6, 0, -HP, 0);
  // 噴嘴臂：肩軸＋臂＋液壓桿＋噴頭，液槽接到噴頭的軟管
  P(torso, gCyl(0.2, 0.2, 0.4, 8), M.joint, 0.5, 1.8, -0.55, 0, 0, HP);
  CB(torso, 0.26, 0.26, 1.6, M.gun, 0.5, 1.8, -1.35, 0, 0, 0, 0.04);
  piston(torso, M, [0.5, 1.35, -0.7], [0.5, 1.62, -1.85], 0.045);
  P(torso, gCyl(0.12, 0.25, 0.5, 8), M.gun, 0.5, 1.8, -2.5, HP);
  P(torso, gCyl(0.27, 0.27, 0.06, 8), M.joint, 0.5, 1.8, -2.3, HP);
  kitCable(
    torso,
    M,
    [
      [0.3, 1.95, -0.6],
      [0.28, 2.05, -1.3],
      [0.38, 1.98, -2.15],
    ],
    0.045,
  );
  // 感測器艙
  CB(torso, 0.4, 0.25, 0.3, M.sub, -0.5, 1.95, -0.7, 0, 0, 0, 0.04);
  eye(torso, M, gl, -0.5, 1.95, -0.88, 0.06);
  const hand = new THREE.Group();
  hand.position.set(0.5, 1.8, -2.8);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'sprayer', height: 3.2 * scale });
}

// 雪中潛伏 MT：伏低的四腳機身＋雪地偽裝布＋雙管機砲（高約 2.2 m；埋在雪裡時隱藏）
function buildLurker(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xff6040, 1.4);
  // 腳：髖關節＋往上的大腿＋膝關節＋往下的小腿＋腳掌
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      P(torso, gCyl(0.16, 0.16, 0.3, 6), M.joint, sx * 0.88, 1.2, sz * 0.9, 0, 0, HP);
      beam(torso, M.main2, [sx * 0.95, 1.22, sz * 0.92], [sx * 1.34, 1.42, sz * 1.22], 0.24, 0.22);
      P(torso, gCyl(0.13, 0.13, 0.24, 6), M.joint, sx * 1.36, 1.42, sz * 1.22, 0, 0, HP);
      beam(torso, M.joint, [sx * 1.36, 1.4, sz * 1.22], [sx * 1.3, 0.12, sz * 1.32], 0.16, 0.18);
      P(torso, gCyl(0.2, 0.25, 0.1, 6), M.sub, sx * 1.3, 0.05, sz * 1.32);
    }
  // 機身：低矮的楔形
  P(
    torso,
    gPod([
      [-1.3, 1.5, 1.0, 1.65, 0.15, 0.2],
      [-0.9, 2.0, 0.95, 1.85, 0.2, 0.2],
      [1.3, 1.9, 0.98, 1.8, 0.18, 0.2],
    ]),
    M.main,
  );
  // 偽裝布：不規則的頂面＋兩側垂下的布
  top(
    torso,
    M.main3,
    [
      [-1.2, -1.3],
      [-0.5, -1.48],
      [0.4, -1.36],
      [1.18, -1.42],
      [1.28, -0.4],
      [1.2, 0.7],
      [1.28, 1.48],
      [0.3, 1.58],
      [-0.6, 1.46],
      [-1.28, 1.52],
      [-1.2, 0.5],
      [-1.3, -0.4],
    ],
    0.06,
    1.9,
    0,
  );
  for (const s of [-1, 1])
    side(
      torso,
      M.main3,
      [
        [-1.2, 1.9],
        [1.1, 1.9],
        [1.0, 1.62],
        [0.3, 1.68],
        [-0.4, 1.58],
        [-1.05, 1.66],
      ],
      0.04,
      s * 1.24,
      0,
    );
  // 機砲：機匣＋散熱套＋砲口，彈藥箱，上方的感測器條
  CB(torso, 0.9, 0.34, 0.5, M.sub, 0, 1.42, -1.2, 0, 0, 0, 0.05);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.06, 0.07, 1.3, 6), M.gun, s * 0.35, 1.45, -1.85, HP);
    P(torso, gCyl(0.11, 0.11, 0.55, 6), M.gun, s * 0.35, 1.45, -1.62, HP);
    P(torso, gCyl(0.09, 0.09, 0.08, 6), M.joint, s * 0.35, 1.45, -2.48, HP);
  }
  CB(torso, 0.4, 0.3, 0.4, M.acc, 0.6, 1.25, -0.9, 0, 0, 0, 0.04);
  CB(torso, 0.7, 0.18, 0.2, M.joint, 0, 1.68, -1.3, 0, 0, 0, 0.03);
  P(torso, gBox(0.6, 0.08, 0.05), gl, 0, 1.68, -1.41);
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'lurker', height: 2.2 * scale });
}
// 冰面滑行砲車：雪橇板＋後方的涵道推進風扇＋機砲塔（高約 2.4 m）
function buildSkater(pal, scale) {
  const { M, root, torso } = base(pal);
  for (const s of [-1, 1]) {
    // 前端翹起的雪橇板＋避震支柱
    side(
      torso,
      M.joint,
      [
        [-2.1, 0.55],
        [-1.95, 0.2],
        [-1.6, 0.0],
        [2.05, 0.0],
        [2.1, 0.2],
        [-1.5, 0.2],
        [-1.8, 0.55],
      ],
      0.3,
      s * 1.0,
      0.03,
    );
    for (const z of [-1.0, 1.2]) {
      beam(torso, M.sub, [s * 1.0, 0.2, z], [s * 0.82, 0.55, z * 0.9], 0.12, 0.14, 0.02);
      piston(torso, M, [s * 1.0, 0.2, z + 0.25], [s * 0.82, 0.62, z * 0.9 + 0.3], 0.035);
    }
  }
  P(
    torso,
    gPod([
      [-1.5, 1.3, 0.4, 0.85, 0.25, 0.15],
      [-0.9, 1.9, 0.35, 1.15, 0.3, 0.15],
      [1.7, 1.9, 0.35, 1.15, 0.25, 0.15],
    ]),
    M.main,
  );
  P(torso, gBox(0.6, 0.12, 0.05), glow(0xffa060, 1.4), 0, 0.68, -1.52);
  for (const s of [-1, 1]) slats(torso, M.joint, s * 0.96, 0.95, 0.6, 0.6, 3, 0.1, HP);
  // 涵道（固定）與支架、護網
  P(torso, new THREE.TorusGeometry(0.86, 0.09, 4, 14), M.main2, 0, 1.5, 1.7);
  for (const s of [-1, 1]) beam(torso, M.sub, [s * 0.5, 1.05, 1.3], [s * 0.62, 0.95, 1.72], 0.14, 0.14, 0.02);
  for (let i = 0; i < 3; i++) P(torso, gBox(1.6, 0.03, 0.03), M.joint, 0, 1.1 + i * 0.4, 1.82);
  const fan = new THREE.Group();
  fan.position.set(0, 1.5, 1.7);
  torso.add(fan);
  P(fan, gCyl(0.18, 0.2, 0.3, 8), M.joint, 0, 0, 0, HP);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    PB(fan, gBox(0.66, 0.2, 0.03), M.sub, [c * 0.48, s * 0.48, 0], [c, s, 0], [-s, c, 0.45]);
  }
  // 砲塔
  P(
    torso,
    gPod([
      [-1.0, 0.7, 1.15, 1.62, 0.12, 0.04],
      [-0.6, 1.0, 1.15, 1.8, 0.15, 0.05],
      [0.0, 1.0, 1.15, 1.8, 0.15, 0.05],
    ]),
    M.main2,
  );
  P(torso, gCyl(0.08, 0.1, 1.2, 8), M.gun, 0, 1.55, -1.55, HP);
  P(torso, gCyl(0.13, 0.13, 0.4, 8), M.gun, 0, 1.55, -1.15, HP);
  P(torso, gCyl(0.11, 0.11, 0.1, 8), M.joint, 0, 1.55, -2.15, HP);
  eye(torso, M, glow(0xffa060, 1.6), 0.32, 1.62, -0.98, 0.05);
  const hand = new THREE.Group();
  hand.position.set(0, 1.55, -2.3);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'skater', height: 2.4 * scale, extra: { fan } });
}

// 實驗體：發光的肉塊＋四隻爪腳，身上套著拘束環、背著輸液罐（小型高約 1.3 m；融合實驗體 big 高約 3.6 m、更多瘤與爪）
function buildBlob(pal, scale, big = false) {
  const { M, root, torso } = base(pal);
  const k = big ? 2.6 : 1;
  const gl = glow(0xff3a30, 2.2);
  P(torso, gSph(0.7 * k, 10), M.main, 0, 0.75 * k, 0);
  for (let i = 0; i < (big ? 7 : 3); i++) {
    const a = i * 2.39996;
    P(
      torso,
      gSph((0.25 + (i % 3) * 0.08) * k, 8),
      M.main3,
      Math.cos(a) * 0.5 * k,
      (0.9 + (i % 2) * 0.3) * k,
      Math.sin(a) * 0.5 * k,
    );
  }
  // 爪腳：生物的腿＋金屬的關節套與爪尖
  const nl = big ? 6 : 4;
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * Math.PI * 2 + 0.4;
    const c = Math.cos(a),
      s = Math.sin(a);
    beam(
      torso,
      M.main3,
      [c * 0.45 * k, 0.6 * k, s * 0.45 * k],
      [c * 0.8 * k, 0.45 * k, s * 0.8 * k],
      0.16 * k,
      0.16 * k,
      0.03 * k,
    );
    P(torso, gCyl(0.1 * k, 0.1 * k, 0.12 * k, 6), M.joint, c * 0.8 * k, 0.45 * k, s * 0.8 * k);
    beam(
      torso,
      M.joint,
      [c * 0.8 * k, 0.45 * k, s * 0.8 * k],
      [c * 0.95 * k, 0, s * 0.95 * k],
      0.1 * k,
      0.12 * k,
      0.02 * k,
    );
  }
  // 拘束環：斜套在身上的兩圈金屬環＋鎖扣
  P(torso, gCyl(0.74 * k, 0.74 * k, 0.07 * k, 12), M.joint, 0, 0.72 * k, 0, 0.35, 0, 0.2);
  P(torso, gCyl(0.72 * k, 0.72 * k, 0.07 * k, 12), M.joint, 0, 0.82 * k, 0, -0.3, 0, -0.35);
  for (const s of [-1, 1])
    CB(
      torso,
      0.14 * k,
      0.16 * k,
      0.12 * k,
      M.sub,
      s * 0.72 * k,
      0.66 * k + s * 0.14 * k,
      0,
      0,
      0,
      0,
      0.02 * k,
    );
  // 背上的輸液罐（發光的液體）與插進身體的管子
  P(torso, gCyl(0.16 * k, 0.16 * k, 0.5 * k, 8), M.sub, 0, 1.3 * k, 0.45 * k, 0.5);
  P(torso, gCyl(0.12 * k, 0.12 * k, 0.4 * k, 8), glow(0xff6050, 1.2), 0, 1.3 * k, 0.45 * k, 0.5);
  kitCable(
    torso,
    M,
    [
      [0.1 * k, 1.1 * k, 0.6 * k],
      [0.35 * k, 1.05 * k, 0.55 * k],
      [0.45 * k, 0.9 * k, 0.35 * k],
    ],
    0.03 * k,
  );
  kitCable(
    torso,
    M,
    [
      [-0.1 * k, 1.1 * k, 0.6 * k],
      [-0.3 * k, 1.15 * k, 0.3 * k],
    ],
    0.03 * k,
  );
  // 眼：金屬的眼框＋發光的核
  P(torso, gCyl(0.24 * k, 0.26 * k, 0.1 * k, 8), M.joint, 0, 0.85 * k, -0.6 * k, HP);
  P(torso, gSph(0.18 * k, 8), gl, 0, 0.85 * k, -0.62 * k);
  const hand = new THREE.Group();
  hand.position.set(0, 0.8 * k, -0.8 * k);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: big ? 'chimera' : 'blob', height: (big ? 3.6 : 1.3) * scale });
}
// 保全雷射網：柵欄柱＋往前伸出 16 m 的雷射柵欄（bar，紅色發光；柱子轉動時跟著掃）
function buildLaserPost(pal, scale) {
  const { M, root, torso } = base(pal);
  const red = glow(0xff3a30, 2);
  // 底座：八角的座＋錨栓
  P(torso, gCyl(0.7, 0.8, 0.6, 8), M.joint, 0, 0.3, 0, 0, PI / 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    P(torso, gCyl(0.06, 0.06, 0.08, 4), M.gun, Math.cos(a) * 0.62, 0.63, Math.sin(a) * 0.62);
  }
  // 柱身：八角柱＋正面的發射器導軌＋兩側的線槽與散熱縫
  P(torso, gCyl(0.36, 0.4, 3.6, 8), M.main2, 0, 2.2, 0, 0, PI / 8);
  CB(torso, 0.5, 3.3, 0.16, M.main, 0, 2.2, -0.36, 0, 0, 0, 0.03);
  for (const s of [-1, 1]) {
    P(torso, gBox(0.12, 3.2, 0.12), M.sub, s * 0.36, 2.2, 0.15);
    slats(torso, M.joint, 0, 3.6 - (s + 1) * 0.6, 0.39, 0.3, 4, 0.08);
  }
  // 發射器：外框＋發光的鏡頭
  for (const y of [1.2, 2.2, 3.2]) {
    CB(torso, 0.36, 0.3, 0.2, M.joint, 0, y, -0.45, 0, 0, 0, 0.03);
    P(torso, gBox(0.3, 0.2, 0.3), red, 0, y, -0.45);
  }
  // 頂部：感測器帽＋警示燈
  CB(torso, 1.1, 0.3, 1.1, M.main, 0, 4.1, 0, 0, PI / 4, 0, 0.06);
  P(torso, gCyl(0.16, 0.2, 0.15, 8), M.joint, 0, 4.32, 0);
  P(torso, gCyl(0.12, 0.12, 0.08, 8), red, 0, 4.42, 0);
  const bar = new THREE.Group();
  torso.add(bar);
  const lm = new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.75 });
  for (const y of [1.2, 2.2, 3.2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 16), lm);
    m.position.set(0, y, -8.4);
    bar.add(m);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 2.2, -0.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'laserpost', height: 4.3 * scale, extra: { bar } });
}

// 構造體爬行機：分節的甲殼身體＋六隻多關節腳（高約 1.6 m）
function buildCrawler(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffa040, 1.8);
  // 身體：前段（頭胸）與後段（腹）兩節甲殼＋中間的關節
  P(
    torso,
    gPod([
      [-1.15, 0.9, 0.82, 1.18, 0.12, 0.1],
      [-0.75, 1.5, 0.72, 1.3, 0.2, 0.15],
      [0.05, 1.55, 0.72, 1.3, 0.2, 0.15],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [0.15, 1.4, 0.75, 1.28, 0.2, 0.15],
      [0.75, 1.6, 0.72, 1.32, 0.22, 0.15],
      [1.1, 1.0, 0.8, 1.2, 0.15, 0.1],
    ]),
    M.main2,
  );
  P(torso, gCyl(0.42, 0.42, 0.2, 8), M.joint, 0, 1.0, 0.1, HP);
  slats(torso, M.joint, 0, 1.35, 0.6, 0.7, 1);
  for (let i = 0; i < 2; i++) P(torso, gBox(0.7, 0.03, 0.06), M.joint, 0, 1.33, 0.48 + i * 0.16);
  // 六隻腳：關節＋往上的大腿＋膝＋往下的小腿＋腳尖
  for (const z of [-0.8, 0, 0.8])
    for (const s of [-1, 1]) {
      const zk = z * 1.15;
      P(torso, gCyl(0.1, 0.1, 0.16, 6), M.joint, s * 0.72, 1.0, z, 0, 0, HP);
      beam(torso, M.main3, [s * 0.75, 1.02, z], [s * 1.38, 1.4, zk], 0.14, 0.16, 0.03);
      P(torso, gSph(0.09, 6), M.joint, s * 1.4, 1.4, zk);
      beam(torso, M.joint, [s * 1.4, 1.38, zk], [s * 1.82, 0.12, zk * 1.05], 0.1, 0.12, 0.02);
      P(torso, gCyl(0.0, 0.06, 0.14, 5), M.sub, s * 1.84, 0.07, zk * 1.05, PI);
    }
  // 頭部：顎下的機槍、兩顆感測眼
  P(torso, gCyl(0.14, 0.14, 0.3, 8), M.sub, 0, 0.95, -1.18, HP);
  P(torso, gCyl(0.05, 0.06, 0.8, 6), M.gun, 0, 0.95, -1.5, HP);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.14, 0.15, 0.08, 8), M.joint, s * 0.35, 1.1, -1.1, HP + 0.3);
    P(torso, gSph(0.11, 8), gl, s * 0.35, 1.12, -1.13);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.1, -1.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crawler', height: 1.6 * scale });
}
// 平台底部砲塔：頂部的吊掛座＋倒吊的砲塔與雙管（原點在底部；吊在平台底面，高約 2 m）
function buildUnderTurret(pal, scale) {
  const { M, root, torso } = base(pal);
  // 吊掛座：八角板＋螺栓＋補強肋
  P(torso, gCyl(1.1, 1.0, 0.3, 8), M.joint, 0, 2.0, 0, 0, PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(torso, gCyl(0.06, 0.06, 0.06, 4), M.gun, Math.cos(a) * 0.82, 1.83, Math.sin(a) * 0.82);
    if (i % 2 === 0)
      PB(
        torso,
        gPlate(
          [
            [-0.3, 0.15],
            [0.3, 0.15],
            [-0.3, -0.25],
          ],
          0.05,
          0.01,
        ),
        M.joint,
        [Math.cos(a) * 0.45, 1.72, Math.sin(a) * 0.45],
        [Math.cos(a), 0, Math.sin(a)],
        [0, 1, 0],
      );
  }
  // 吊桿：迴轉環＋筒
  P(torso, gCyl(0.25, 0.25, 0.6, 8), M.main2, 0, 1.6, 0);
  P(torso, gCyl(0.42, 0.42, 0.1, 10), M.sub, 0, 1.78, 0);
  P(torso, gCyl(0.38, 0.38, 0.1, 10), M.sub, 0, 1.36, 0);
  // 砲塔：球體＋赤道的裝甲帶＋正面的防盾
  P(torso, gSph(0.9, 12), M.main, 0, 0.9, 0);
  P(torso, gCyl(0.93, 0.93, 0.18, 12), M.main2, 0, 0.95, 0);
  front(torso, M.main2, crect(0.95, 0.6, 0.12), 0.14, -0.8, 0.03, 0.9, 1, 0, 0.72, 0.3);
  // 雙管：砲口朝前下方（+y 端＝砲口）
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.08, 0.1, 1.3, 8), M.gun, s * 0.25, 0.7, -0.95, -(HP + 0.3));
    P(torso, gCyl(0.12, 0.12, 0.4, 8), M.gun, s * 0.25, 0.77, -0.71, -(HP + 0.3));
    P(torso, gCyl(0.1, 0.1, 0.08, 8), M.joint, s * 0.25, 0.52, -1.55, -(HP + 0.3));
  }
  P(torso, gSph(0.15, 8), glow(0xffa040, 2), 0, 0.6, -0.8);
  eye(torso, M, glow(0xffa040, 1.6), 0.45, 1.25, -0.72, 0.05);
  const hand = new THREE.Group();
  hand.position.set(0, 0.5, -1.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'underturret', height: 2 * scale });
}
// 推進器試車台：台座＋鋼架夾著的大型噴口（朝 −Z）＋燃燒室與管線＋控制台（高約 4 m，不移動）
function buildTestRig(pal, scale) {
  const { M, root, torso } = base(pal);
  const hot = glow(0xff8a30, 1.2);
  // 台座：切角的座＋警示條
  P(
    torso,
    gPod([
      [-1.6, 3.6, 0, 1.2, 0.2, 0],
      [2.4, 3.6, 0, 1.2, 0.2, 0],
    ]),
    M.joint,
  );
  hazard(torso, M, 0, 0.95, -1.62, 3.0, 0.2);
  // 噴口：鐘形噴口＋冷卻環＋內側的暗面與發光的口
  P(torso, gCyl(1.0, 1.6, 3.2, 14), M.gun, 0, 2.4, -0.8, HP);
  for (const z of [-2.0, -0.4]) {
    const r = 1.6 - ((z + 2.4) / 3.2) * 0.6 + 0.04;
    P(torso, gCyl(r, r, 0.1, 14), M.joint, 0, 2.4, z, HP);
  }
  P(torso, gCyl(1.1, 1.1, 0.2, 14), hot, 0, 2.4, -2.45, HP);
  // 燃燒室與渦輪泵、管線
  P(torso, gCyl(0.7, 0.85, 0.4, 10), M.sub, 0, 2.4, 1.0, HP);
  P(torso, gCyl(0.22, 0.22, 0.45, 8), M.acc, 1.05, 1.95, 0.95, HP);
  kitCable(
    torso,
    M,
    [
      [1.05, 1.95, 0.7],
      [1.0, 2.6, 0.3],
      [0.55, 3.05, 0.2],
    ],
    0.06,
  );
  kitCable(
    torso,
    M,
    [
      [-0.6, 2.9, 1.2],
      [-0.75, 3.2, 1.7],
    ],
    0.05,
  );
  // 鋼架：夾住噴口的環＋立柱＋推力支柱
  for (const z of [-1.4, 0.4]) {
    const r = 1.6 - ((z + 2.4) / 3.2) * 0.6 + 0.1;
    P(torso, gCyl(r, r, 0.18, 12), M.main2, 0, 2.4, z, HP);
    for (const s of [-1, 1]) CB(torso, 0.24, 2.5, 0.24, M.main, s * 1.45, 1.75, z, 0, 0, 0, 0.03);
  }
  for (const s of [-1, 1]) beam(torso, M.main, [s * 1.45, 3.0, -1.4], [s * 1.45, 3.0, 0.4], 0.2, 0.2, 0.03);
  // 控制台：前面收斜的箱＋螢幕（發光）＋天線
  P(
    torso,
    gPod([
      [1.2, 1.4, 1.1, 3.0, 0.2, 0.04],
      [1.5, 1.6, 1.1, 3.3, 0.15, 0.04],
      [2.6, 1.6, 1.1, 3.3, 0.12, 0.04],
    ]),
    M.main,
  );
  P(torso, gBox(1.2, 0.5, 0.05), glow(0x60c0ff, 1.4), 0, 2.8, 1.18);
  slats(torso, M.joint, 0.81, 2.6, 2.0, 0.8, 4, 0.12, HP);
  rod(torso, M.joint, [0.5, 3.3, 2.2], [0.5, 4.0, 2.2], 0.015, 4);
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -2.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'testrig', height: 4 * scale });
}
// 舊式宇宙用 MT：圓胖的機身、背上的推進器與氣瓶、姿勢控制噴嘴、短腳與大腳掌（高約 3 m）
function buildSpaceMt(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x60c0ff, 1.4);
  for (const s of [-1, 1]) {
    // 腳：大腿＋膝＋小腿＋寬腳掌、避震桿
    P(torso, gCyl(0.22, 0.22, 0.3, 8), M.joint, s * 0.6, 1.15, 0, 0, 0, HP);
    beam(torso, M.joint, [s * 0.6, 1.1, 0], [s * 0.62, 0.65, -0.15], 0.34, 0.38, 0.05);
    P(torso, gSph(0.18, 8), M.sub, s * 0.62, 0.62, -0.15);
    beam(torso, M.main2, [s * 0.62, 0.6, -0.15], [s * 0.6, 0.22, 0.0], 0.4, 0.42, 0.06);
    piston(torso, M, [s * 0.82, 1.0, 0.15], [s * 0.82, 0.3, 0.12], 0.04);
    P(
      torso,
      gPod([
        [-0.65, 0.5, 0, 0.18, 0.06, 0],
        [-0.4, 0.8, 0, 0.3, 0.08, 0],
        [0.45, 0.8, 0, 0.3, 0.08, 0],
      ]),
      M.main2,
      s * 0.6,
      0,
      0,
    );
  }
  // 機身：球體＋腰帶＋正面的面罩框（發光的窗）＋側面的艙門
  P(torso, gSph(1.1, 12), M.main, 0, 1.9, 0);
  P(torso, gCyl(1.12, 1.12, 0.2, 12), M.main2, 0, 1.6, 0);
  front(torso, M.joint, crect(1.2, 0.68, 0.16), 0.16, -0.92, 0.03, 1, 1, 0, 2.1);
  P(torso, gBox(1.0, 0.5, 0.1), gl, 0, 2.1, -1.0);
  for (const x of [-0.25, 0.25]) P(torso, gBox(0.05, 0.56, 0.06), M.joint, x, 2.1, -1.04);
  P(torso, gCyl(0.42, 0.42, 0.08, 10), M.main3, -1.06, 2.05, 0.1, 0, 0, HP);
  // 背上的推進器（鐘形噴口）與氣瓶
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.25, 0.3, 0.8, 8), M.main2, s * 0.8, 2.1, 0.9, 0.4);
    P(torso, gCyl(0.18, 0.32, 0.3, 8), M.gun, s * 0.8, 1.78, 1.25, 0.4);
    P(torso, gCyl(0.18, 0.18, 0.9, 8), M.acc, s * 0.32, 2.4, 0.95, 0.15);
  }
  // 姿勢控制噴嘴（四角各一組）
  for (const [x, y] of [
    [-0.85, 2.6],
    [0.85, 2.6],
    [-0.9, 1.3],
    [0.9, 1.3],
  ]) {
    CB(torso, 0.2, 0.2, 0.2, M.sub, x, y, -0.35, 0, 0, 0, 0.03);
    P(torso, gCyl(0.04, 0.07, 0.1, 6), M.gun, x + Math.sign(x) * 0.12, y, -0.35, 0, 0, HP);
  }
  // 右手的砲：肩軸＋機匣＋砲管
  P(torso, gCyl(0.2, 0.2, 0.3, 8), M.joint, 0.95, 1.75, -0.3, 0, 0, HP);
  CB(torso, 0.3, 0.3, 0.6, M.sub, 0.95, 1.7, -0.6, 0, 0, 0, 0.04);
  P(torso, gCyl(0.08, 0.1, 1.0, 8), M.gun, 0.9, 1.7, -1.0, HP);
  const hand = new THREE.Group();
  hand.position.set(0.9, 1.7, -1.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'spacemt', height: 3 * scale });
}

// 衝撞無人機：前端是撞角的楔形機體＋兩側的推進器莢艙（飛行，高約 1.2 m）
function buildRammer(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.6;
  P(
    torso,
    gPod([
      [-1.2, 0.3, -0.12, 0.12, 0.05, 0.05],
      [-0.7, 0.75, -0.35, 0.35, 0.15, 0.15],
      [0.2, 1.1, -0.5, 0.5, 0.25, 0.25],
      [0.8, 1.1, -0.5, 0.5, 0.25, 0.25],
      [1.35, 0.9, -0.42, 0.42, 0.2, 0.2],
    ]),
    M.main,
  );
  // 撞角：加厚的楔形鋼塊＋尖端
  P(
    torso,
    gPod([
      [-1.5, 0.1, -0.05, 0.05, 0.02, 0.02],
      [-1.15, 0.38, -0.16, 0.16, 0.06, 0.06],
      [-0.75, 0.5, -0.22, 0.22, 0.08, 0.08],
    ]),
    M.joint,
  );
  // 背脊、感測器（發光）、尾部的噴口
  CB(torso, 0.3, 0.12, 1.0, M.main2, 0, 0.5, 0.4, 0, 0, 0, 0.03);
  P(torso, gCyl(0.1, 0.12, 0.08, 8), M.joint, 0, 0.27, -0.25);
  P(torso, gSph(0.15, 8), glow(0x60e0ff, 2), 0, 0.3, -0.2);
  P(torso, gCyl(0.38, 0.3, 0.2, 10), M.gun, 0, 0, 1.42, HP);
  for (const s of [-1, 1]) {
    // 推進器莢艙：進氣環＋筒＋噴口，與機身的掛架
    P(torso, gCyl(0.25, 0.3, 0.9, 8), M.joint, s * 0.8, 0, 0.8, HP);
    P(torso, gCyl(0.28, 0.28, 0.08, 8), M.sub, s * 0.8, 0, 0.36, HP);
    P(torso, gCyl(0.22, 0.18, 0.15, 8), M.gun, s * 0.8, 0, 1.3, HP);
    top(
      torso,
      M.main2,
      [
        [s * 0.4, 0.45],
        [s * 0.7, 0.6],
        [s * 0.7, 1.0],
        [s * 0.4, 1.05],
      ],
      0.08,
      0,
    );
    // 尾翼
    side(
      torso,
      M.main2,
      [
        [0.8, 0.3],
        [1.3, 0.35],
        [1.4, 0.55],
        [1.15, 0.55],
      ],
      0.05,
      s * 0.3,
      0.01,
    );
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -1.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'rammer', height: 1.2 * scale });
}
// 艦載防空砲：圓形砲座＋楔形砲塔＋朝上的四連裝砲管＋兩側的彈鼓（高約 3.4 m，不移動）
function buildFlak(pal, scale) {
  const { M, root, torso } = base(pal);
  // 砲座：甲板上的圓座＋螺栓＋迴轉環
  P(torso, gCyl(1.8, 2.0, 0.8, 14), M.joint, 0, 0.4, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    P(torso, gCyl(0.06, 0.06, 0.08, 4), M.gun, Math.cos(a) * 1.65, 0.82, Math.sin(a) * 1.65);
  }
  P(torso, gCyl(1.3, 1.3, 0.14, 14), M.sub, 0, 0.86, 0);
  // 砲塔：前面收斜的楔形
  P(
    torso,
    gPod([
      [-1.1, 1.8, 0.9, 1.9, 0.3, 0.1],
      [-0.6, 2.2, 0.85, 2.2, 0.3, 0.1],
      [1.1, 2.2, 0.85, 2.1, 0.25, 0.1],
    ]),
    M.main,
  );
  P(torso, gBox(1.0, 0.25, 0.05), glow(0x60e0ff, 1.4), 0, 1.5, -1.12);
  // 砲架：耳軸＋兩側的彈鼓
  P(torso, gCyl(0.22, 0.22, 1.6, 10), M.joint, 0, 2.25, -0.55, 0, 0, HP);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.42, 0.42, 0.3, 10), M.acc, s * 1.25, 1.75, 0.2, 0, 0, HP);
    P(torso, gCyl(0.2, 0.2, 0.34, 8), M.joint, s * 1.25, 1.75, 0.2, 0, 0, HP);
  }
  // 四連裝砲管：砲身＋散熱套＋砲口的消焰器
  // 仰角 e：砲口朝前上方（+y 端＝砲口）
  const e = 0.95,
    pitch = -(HP - e),
    dy = Math.sin(e),
    dz = -Math.cos(e);
  for (const sx of [-1, 1])
    for (const sy of [0, 1]) {
      const x = sx * 0.45,
        y = 2.1 + sy * 0.4;
      P(torso, gCyl(0.1, 0.12, 2.4, 8), M.gun, x, y, -1.0, pitch);
      P(torso, gCyl(0.16, 0.16, 0.7, 8), M.sub, x, y - dy * 0.55, -1.0 - dz * 0.55, pitch);
      P(torso, gCyl(0.14, 0.12, 0.25, 8), M.joint, x, y + dy * 1.15, -1.0 + dz * 1.15, pitch);
    }
  // 背上的雷達
  P(torso, gCyl(0.06, 0.06, 0.6, 6), M.joint, 0.6, 2.4, 0.8);
  P(torso, gCyl(0.4, 0.1, 0.12, 10), M.sub, 0.6, 2.75, 0.8, -0.5);
  const hand = new THREE.Group();
  hand.position.set(0, 2.9, -1.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'flak', height: 3.4 * scale });
}

// 真空作業機：切角的箱形機身＋兩隻三爪作業臂＋四組姿勢控制噴嘴（飛行，高約 1.8 m）
function buildVacuum(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.9;
  P(
    torso,
    gPod([
      [-0.7, 1.2, -0.5, 0.5, 0.2, 0.2],
      [-0.55, 1.4, -0.5, 0.5, 0.25, 0.25],
      [0.7, 1.4, -0.5, 0.5, 0.25, 0.25],
    ]),
    M.main,
  );
  // 觀測窗（發光）、扶手、背上的氣瓶與天線
  front(torso, M.joint, crect(0.95, 0.36, 0.08), 0.06, -0.7, 0.015, 1, 1, 0, 0.15);
  P(torso, gBox(0.8, 0.2, 0.05), glow(0x9fe8ff, 1.6), 0, 0.15, -0.74);
  for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.4, 0.55, -0.3], [s * 0.4, 0.55, 0.35], 0.025, 4);
  P(torso, gCyl(0.18, 0.18, 0.9, 8), M.acc, 0, 0.25, 0.75, HP);
  rod(torso, M.joint, [-0.45, 0.5, 0.4], [-0.5, 1.0, 0.5], 0.015, 4);
  for (const s of [-1, 1]) {
    // 作業臂：肩軸＋上臂＋肘＋前臂＋三爪
    P(torso, gCyl(0.14, 0.14, 0.24, 8), M.joint, s * 0.72, -0.2, -0.45, 0, 0, HP);
    CB(torso, 0.18, 0.18, 0.6, M.main2, s * 0.72, -0.2, -0.75, 0, 0, 0, 0.03);
    P(torso, gSph(0.11, 6), M.joint, s * 0.72, -0.2, -1.05);
    CB(torso, 0.14, 0.14, 0.4, M.joint, s * 0.72, -0.2, -1.25, 0, 0, 0, 0.02);
    CB(torso, 0.26, 0.26, 0.12, M.main2, s * 0.72, -0.2, -1.47, 0, 0, 0, 0.02);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      beam(
        torso,
        M.joint,
        [s * 0.72 + Math.cos(a) * 0.1, -0.2 + Math.sin(a) * 0.1, -1.5],
        [s * 0.72 + Math.cos(a) * 0.05, -0.2 + Math.sin(a) * 0.05, -1.66],
        0.05,
        0.05,
        0.01,
      );
    }
  }
  // 姿勢控制噴嘴（四角各一組，往三個方向）
  for (const [x, z] of [
    [-0.8, -0.8],
    [0.8, -0.8],
    [-0.8, 0.8],
    [0.8, 0.8],
  ]) {
    CB(torso, 0.22, 0.22, 0.22, M.sub, x * 0.92, 0.38, z * 0.85, 0, 0, 0, 0.03);
    P(torso, gCyl(0.05, 0.08, 0.12, 6), M.gun, x * 0.92, 0.55, z * 0.85);
    P(
      torso,
      gCyl(0.05, 0.08, 0.12, 6),
      M.gun,
      x * 0.92 + Math.sign(x) * 0.16,
      0.38,
      z * 0.85,
      0,
      0,
      -Math.sign(x) * HP,
    );
  }
  const hand = new THREE.Group();
  hand.position.set(0.7, -0.2, -1.7);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'vacuum', height: 1.8 * scale });
}
// 軌道標定衛星：八角的本體＋兩片太陽能板＋往下的標定望遠鏡＋頂部的天線（飛行，高約 1.6 m）
function buildMarker(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.8;
  P(torso, gCyl(0.5, 0.5, 1.4, 8), M.main, 0, 0, 0, 0, PI / 8);
  for (const y of [-0.5, 0.5]) P(torso, gCyl(0.54, 0.54, 0.1, 8), M.main2, 0, y, 0, 0, PI / 8);
  // 隔熱層的面板
  for (let i = 0; i < 8; i += 2) {
    const a = (i / 8) * PI * 2;
    PB(
      torso,
      gBox(0.3, 0.7, 0.04),
      M.acc,
      [Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48],
      [-Math.sin(a), 0, Math.cos(a)],
      [0, 1, 0],
    );
  }
  // 太陽能板：框＋分格＋鉸鏈臂
  for (const s of [-1, 1]) {
    rod(torso, M.joint, [s * 0.5, 0, 0], [s * 0.62, 0, 0], 0.05, 6);
    CB(torso, 2.2, 0.05, 0.9, M.acc, s * 1.7, 0, 0, 0, 0, 0, 0.01);
    for (let i = 0; i < 5; i++) P(torso, gBox(0.03, 0.07, 0.92), M.joint, s * (0.65 + i * 0.52), 0, 0);
    P(torso, gBox(2.2, 0.07, 0.03), M.joint, s * 1.7, 0, 0);
  }
  // 標定望遠鏡：筒＋遮光罩＋發光的透鏡
  P(torso, gCyl(0.32, 0.36, 0.2, 10), M.joint, 0, -0.72, 0);
  P(torso, gCyl(0.36, 0.3, 0.12, 10), M.gun, 0, -0.86, 0);
  P(torso, gSph(0.3, 10), glow(0xff5050, 2.2), 0, -0.8, 0);
  // 頂部的天線碟與推進器
  P(torso, gCyl(0.05, 0.05, 0.3, 6), M.joint, 0, 0.85, 0);
  P(torso, gCyl(0.32, 0.06, 0.1, 10), M.sub, 0, 1.0, 0);
  for (const s of [-1, 1]) P(torso, gCyl(0.05, 0.08, 0.14, 6), M.gun, 0, 0.6, s * 0.55, s * HP);
  const hand = new THREE.Group();
  hand.position.set(0, -0.9, 0);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'marker', height: 1.6 * scale });
}

export const FOE_BUILDERS = {
  vacuum: buildVacuum,
  marker: buildMarker,
  rammer: buildRammer,
  flak: buildFlak,
  crawler: buildCrawler,
  underturret: buildUnderTurret,
  testrig: buildTestRig,
  spacemt: buildSpaceMt,
  blob: (pal, scale) => buildBlob(pal, scale),
  chimera: (pal, scale) => buildBlob(pal, scale, true),
  laserpost: buildLaserPost,
  lurker: buildLurker,
  skater: buildSkater,
  gunboat: buildGunboat,
  sprayer: buildSprayer,
  gate_turret: buildGateTurret,
  patrol_cart: buildPatrolCart,
  crane: buildCrane,
  forklift: buildForklift,
  burrower: buildBurrower,
  jammer: buildJammer,
  cart: buildCart,
  crystal_drone: buildCrystalDrone,
  driller: buildDriller,
  junk: buildJunk,
};
// 模型庫登記：[key, 名稱, 備註]
export const FOE_CATALOG = [
  ['vacuum', '真空作業機', '高空軌道專屬；全程懸浮、忽高忽低'],
  ['marker', '軌道標定衛星', '高空軌道專屬；標定目標，被標定時受傷變重'],
  ['rammer', '衝撞無人機', '洋上都市專屬；高速撞擊，把機體往甲板邊緣推'],
  ['flak', '艦載防空砲', '洋上都市專屬；專打空中的目標'],
  ['crawler', '構造體爬行機', 'Grid 086 專屬；沿柱子爬上平台'],
  ['underturret', '平台底部砲塔', 'Grid 086 專屬；吊在上層平台的底面往下射'],
  ['testrig', '推進器試車台', '舊宇宙港專屬；噴口定期噴火橫掃'],
  ['spacemt', '舊式宇宙用 MT', '舊宇宙港專屬；低重力設計，跳得高、滯空久'],
  ['blob', '實驗體', '技研都市專屬；成群撲咬，三隻以上聚集會融合'],
  ['chimera', '融合實驗體', '技研都市專屬；實驗體融合而成的大型個體'],
  ['laserpost', '保全雷射網', '技研都市專屬；旋轉的雷射柵欄，碰到會觸發警報叫增援'],
  ['lurker', '雪中潛伏 MT', '冰原專屬；埋在雪裡隱藏，靠近才現身'],
  ['skater', '冰面滑行砲車', '冰原專屬；高速繞圈掃射，冰面上更快'],
  ['gunboat', '潛航砲艇', '水沒市街專屬；潛在水下打不到，浮出水面發射魚雷'],
  ['sprayer', '汙染噴射 MT', '水沒市街專屬；噴出汙染液留下腐蝕區'],
  ['gate_turret', '閘門砲台', '水壩專屬；裝在閘門上，開閘的水流把機體往下游推'],
  ['patrol_cart', '壩頂巡邏砲車', '水壩專屬；佔住壩頂等高處砲擊'],
  ['crane', '起重機砲台', '集散場專屬；不移動，吊起貨櫃往預警圈砸下'],
  ['forklift', '叉架 MT', '集散場專屬；舉著貨櫃當盾牌，靠近時丟出'],
  ['burrower', '沙中伏擊者', '沙丘專屬；在沙下移動，從腳下鑽出攻擊'],
  ['jammer', '沙暴干擾機', '沙丘專屬；附近的鎖定距離縮短'],
  ['cart', '炸藥礦車', '礦坑專屬；衝向目標自爆（敵我不分）'],
  ['crystal_drone', '結晶寄生無人機', '礦坑深層專屬；擊破時碎裂四射'],
  ['driller', '鑽頭採礦機', '礦坑專屬；近戰鑽頭，衝擊大'],
  ['junk', '廢鐵合成體', '荒野專屬；吸附可破壞物件長出外殼'],
];
