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
import { FOE_BUILDERS_b1, FOE_CATALOG_b1 } from './foe-models-b1.js';
import { FOE_BUILDERS_C1, FOE_CATALOG_C1 } from './foe-models-c1.js';
import { FOE_BUILDERS_C2, FOE_CATALOG_C2 } from './foe-models-c2.js';
import { mechMats } from './materials.js';
import { FOE_BUILDERS_b2, FOE_CATALOG_b2 } from './foe-models-b2.js';
import { tagStyle } from './style/shader.js';
import { foeMerged } from './foe-merge.js';

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
const FOE_TINT = { ao: 0.8, grime: 0.28 };
function finish(root, scale) {
  bakeAll(root, { tint: FOE_TINT, cache: true, k: scale }); // 精細版（docs/model-detail.md）
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

// ---------- D1：第 1、2 章專屬敵人的細節、動作與受損資料 ----------
// 動作：rig.animD1(rig, st)，由 entities/mech-foe.js 的 foeAnimD1 在房主與客機每格呼叫；
// st＝{ t 秒, dt, warn 預警 0～1（已平滑）, atk 攻擊 0～1（觸發後衰減）, fwd 前進速度 m/s, vis bossVis, remote 客機 }。
// 姿勢直接由 warn／atk 決定（不累積），模型庫的冒煙測試可以直接擺出預警的姿勢；只有轉動的零件累加角度。
// 受損：rig.dmg＝{ smoke 冒煙點（模型座標，縮放前）, plates 會脫落的裝甲板（獨立網格）, chunks 擊破時飛散的區塊 }。
function grp_d1(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// 繞 (x, y, z) 轉動的節點：回傳 [外層（轉這個）, 內層（用原本的絕對座標建模）]
function piv_d1(parent, x, y, z) {
  const o = grp_d1(parent, x, y, z);
  return [o, grp_d1(o, -x, -y, -z)];
}
// 獨立網格的裝甲板（不經過 P，所以 bakeAll 不會合併；AP 低時由共用的受損處理拆下來）
function slab_d1(parent, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const s = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  s.position.set(x, y, z);
  s.rotation.set(rx, ry, rz);
  s.castShadow = true;
  parent.add(s);
  return s;
}
// 一排螺栓頭：a → b 均分 n 顆；ax＝面的法線軸（'x'／'y'／'z'）
function bolts_d1(nd, m, a, b, n, r = 0.03, ax = 'z') {
  const geo = gCyl(r, r, 0.04, 6);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    P(
      nd,
      geo,
      m,
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      ax === 'z' ? HP : 0,
      0,
      ax === 'x' ? HP : 0,
    );
  }
}
// 旋轉警示燈：底座＋燈罩（m，預警時變亮）＋燈罩裡轉動的兩片燈條（回傳 { rot, m }）
function beacon_d1(nd, M, x, y, z, color, r = 0.1) {
  const m = glow(color, 0.5);
  P(nd, gCyl(r * 1.25, r * 1.35, r * 0.5, 8), M.joint, x, y, z);
  P(nd, gCyl(r * 0.9, r, r * 1.2, 8), m, x, y + r * 0.85, z);
  P(nd, gSph(r * 0.5, 6), M.joint, x, y + r * 1.55, z);
  const rot = grp_d1(nd, x, y + r * 0.85, z);
  for (const s of [-1, 1]) P(rot, gBox(r * 0.5, r * 0.9, r * 0.12), m, s * r * 0.75, 0, 0);
  return { rot, m };
}
// 轉動節點的累加角度（每格），讓角度保持在 ±π 之內
function spin_d1(nd, ax, v) {
  nd.rotation[ax] = (nd.rotation[ax] + v) % (PI * 2);
}
const blink_d1 = (t, hz) => (Math.sin(t * hz * PI * 2) > 0 ? 1 : 0);

// 炸藥礦車：四輪礦車＋炸藥桶＋發光的引信（高約 1.7 m）
// 待機：車輪依速度轉、貨物晃動；預警（靠近目標）：引爆器的燈越閃越快、引信變大變亮
function buildCart(pal, scale) {
  const { M, root, torso } = base(pal);
  const fuseM = glow(0xff5a20, 2.2),
    detM = glow(0xff3020, 0.6),
    headM = glow(0xffd080, 0.8);
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
  // 側面的補強肋＋鉚釘
  for (const s of [-1, 1]) {
    for (const z of [-0.75, 0, 0.75]) P(torso, gBox(0.05, 0.56, 0.12), M.joint, s * 0.925, 1.09, z);
    bolts_d1(torso, M.joint, [s * 0.94, 1.33, -1.05], [s * 0.94, 1.33, 1.05], 8, 0.028, 'x');
    bolts_d1(torso, M.joint, [s * 0.9, 0.84, -0.95], [s * 0.9, 0.84, 0.95], 6, 0.028, 'x');
    // 煞車桿
    rod(torso, M.joint, [s * 0.98, 0.55, 0.45], [s * 1.12, 1.25, 0.72], 0.03, 4);
    P(torso, gSph(0.06, 6), M.acc, s * 1.12, 1.27, 0.73);
  }
  // 底盤：縱樑、前後的連結器
  for (const s of [-1, 1]) {
    P(torso, gBox(0.16, 0.16, 2.5), M.joint, s * 0.45, 0.45, 0);
    P(torso, gBox(0.3, 0.2, 0.22), M.joint, 0, 0.62, s * 1.38);
  }
  // 後面的緩衝彈簧
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.07, 0.07, 0.3, 6), M.sub, s * 0.55, 0.62, 1.47, HP);
    P(torso, gCyl(0.12, 0.12, 0.05, 8), M.gun, s * 0.55, 0.62, 1.63, HP);
  }
  // 車軸：輪緣的礦車輪＋輪輻（依速度轉動）
  const axles = [];
  for (const z of [-0.9, 0.9]) {
    const ax = grp_d1(torso, 0, 0.38, z);
    axles.push(ax);
    P(ax, gCyl(0.07, 0.07, 1.9, 4), M.sub, 0, 0, 0, 0, 0, HP);
    for (const s of [-1, 1]) {
      P(ax, gCyl(0.38, 0.38, 0.06, 10), M.gun, s * 0.76, 0, 0, 0, 0, HP);
      P(ax, gCyl(0.33, 0.33, 0.2, 10), M.gun, s * 0.86, 0, 0, 0, 0, HP);
      P(ax, gBox(0.03, 0.5, 0.07), M.joint, s * 0.97, 0, 0);
      P(ax, gBox(0.03, 0.07, 0.5), M.joint, s * 0.97, 0, 0);
    }
  }
  // 車頭：頭燈、警示條、掛鉤的鏈條（擊破時一起飛出去）
  const nose = grp_d1(torso);
  P(nose, gCyl(0.1, 0.12, 0.12, 8), M.joint, 0.6, 1.58, -1.38, HP);
  P(nose, gCyl(0.08, 0.08, 0.03, 8), headM, 0.6, 1.58, -1.45, HP);
  hazard(nose, M, 0, 0.66, -1.32, 1.2, 0.16, 0);
  for (let i = 0; i < 3; i++)
    P(
      nose,
      new THREE.TorusGeometry(0.07, 0.02, 4, 8),
      M.joint,
      0,
      0.6,
      -1.56 - i * 0.11,
      0,
      i % 2 ? HP : 0,
      0,
    );
  decal(torso, 2, 1.1, 0.42, 0, 1.0, -1.31, 0, PI, 0);
  // 貨物：炸藥桶（桶箍）、綁在桶上的炸藥、引爆器與往各桶的電線、天線、引信
  const load = grp_d1(torso);
  const drums = [
    [-0.45, -0.55],
    [0.45, -0.55],
    [0, 0.5],
  ];
  for (const [x, z] of drums) {
    P(load, gCyl(0.38, 0.38, 0.75, 10), M.acc, x, 1.75, z);
    for (const y of [1.5, 2.0]) P(load, gCyl(0.395, 0.395, 0.05, 10), M.joint, x, y, z);
    P(load, gCyl(0.08, 0.08, 0.04, 6), M.joint, x + 0.18, 2.14, z); // 桶蓋
  }
  // 一束炸藥（4 根）用膠帶綁在後面的桶上
  for (let i = 0; i < 4; i++)
    P(load, gCyl(0.045, 0.045, 0.42, 6), M.main3, 0.3 + (i % 2) * 0.09, 1.78, 0.85 + (i >> 1) * 0.09);
  P(load, gBox(0.24, 0.05, 0.24), M.rubber, 0.34, 1.78, 0.89);
  CB(load, 0.34, 0.2, 0.38, M.gun, 0, 2.1, -0.05, 0, 0, 0, 0.03);
  P(load, gBox(0.2, 0.08, 0.03), detM, 0, 2.12, -0.25); // 倒數顯示
  for (const [x, z] of drums)
    rod(load, M.rubber, [x * 0.3, 2.12, -0.05 + (z + 0.05) * 0.3], [x * 0.85, 2.15, z * 0.85], 0.02, 4);
  rod(load, M.joint, [0.12, 2.18, 0.08], [0.12, 2.5, 0.1], 0.012, 4);
  P(load, gSph(0.03, 4), detM, 0.12, 2.52, 0.1);
  const fuse = new THREE.Group();
  fuse.position.set(0, 2.25, 0);
  load.add(fuse);
  P(fuse, gSph(0.16, 8), fuseM, 0, 0, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 1.2, -1.4);
  torso.add(hand);
  const plates = [
    slab_d1(torso, 0.05, 0.42, 0.9, M.main2, 0.965, 1.08, -0.38),
    slab_d1(torso, 0.05, 0.42, 0.9, M.main2, -0.965, 1.08, 0.38),
    slab_d1(torso, 0.9, 0.3, 0.05, M.main3, -0.3, 1.1, 1.34),
  ];
  const animD1 = (r, st) => {
    const roll = (-st.fwd * st.dt) / 0.38;
    for (const a of axles) spin_d1(a, 'x', roll);
    const mv = Math.min(1, Math.abs(st.fwd) / 8);
    load.position.y = Math.abs(Math.sin(st.t * 9)) * mv * 0.04;
    load.rotation.z = Math.sin(st.t * 7) * 0.012 * mv;
    detM.emissiveIntensity = blink_d1(st.t, 1.5 + st.warn * 9) ? 0.6 + st.warn * 3 : 0.12;
    fuseM.emissiveIntensity = 1.6 + st.warn * 2.6 + Math.sin(st.t * 25) * 0.5;
    fuse.scale.setScalar(1 + st.warn * 0.4 + Math.sin(st.t * 30) * 0.08);
    headM.emissiveIntensity = 0.8 + st.warn * 1.2;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'cart',
    height: 2.2 * scale,
    extra: {
      fuse,
      animD1,
      dmg: {
        smoke: [
          [0, 1.6, 0],
          [0.6, 1.2, 0.9],
        ],
        plates,
        chunks: [load, nose, axles[0], axles[1]],
      },
    },
  });
}
// 結晶寄生無人機：發光的結晶核心＋抓住結晶的機械爪座＋繞著轉的碎片（飛行，高約 1.4 m）
// 待機：碎片與約束環繞著轉、爪子微微開合；預警（目標在射程內）：爪子張開、結晶變亮；攻擊：結晶閃光
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
  const thrM = glow(0x6fd0ff, 1.2),
    ringM = glow(0x3aa8ff, 0.8);
  const core = grp_d1(torso);
  P(core, new THREE.OctahedronGeometry(0.55, 0), cry, 0, 0, 0, 0, 0, 0, 1, 1.5, 1);
  // 從爪座長出來的小結晶
  P(core, new THREE.OctahedronGeometry(0.2, 0), cry, 0.32, -0.38, 0.22, 0.3, 0, -0.5, 1, 1.8, 1);
  P(core, new THREE.OctahedronGeometry(0.15, 0), cry, -0.3, -0.4, -0.25, -0.3, 0, 0.6, 1, 1.8, 1);
  P(core, new THREE.OctahedronGeometry(0.1, 0), cry, 0.05, -0.42, -0.36, 0.2, 0, 0.3, 1, 2, 1);
  // 爪座：八角的底座環＋下方的感測器、散熱鰭片、螺栓
  P(torso, gCyl(0.52, 0.42, 0.16, 8), M.main, 0, -0.55, 0, 0, PI / 8);
  P(torso, gCyl(0.3, 0.3, 0.1, 8), M.joint, 0, -0.42, 0, 0, PI / 8);
  P(torso, gCyl(0.16, 0.22, 0.12, 8), M.sub, 0, -0.66, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(torso, gCyl(0.025, 0.025, 0.03, 5), M.joint, Math.cos(a) * 0.4, -0.46, Math.sin(a) * 0.4);
    P(torso, gBox(0.03, 0.1, 0.16), M.joint, Math.cos(a) * 0.3, -0.72, Math.sin(a) * 0.3, 0, HP - a);
  }
  eye(torso, M, glow(0x3aa8ff, 2), 0, -0.55, -0.5, 0.06);
  // 天線（後方）
  rod(torso, M.joint, [0.1, -0.5, 0.42], [0.18, 0.1, 0.62], 0.012, 4);
  P(torso, gSph(0.03, 4), thrM, 0.18, 0.12, 0.62);
  // 三隻爪臂：從底座伸到結晶側面、往內扣（hinge 繞切線方向開合）；姿勢控制噴嘴
  const claws = [],
    clawPiv = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 6;
    const c = Math.cos(a),
      s = Math.sin(a);
    const pv = grp_d1(torso, c * 0.46, -0.5, s * 0.46);
    pv.rotation.y = -a;
    clawPiv.push(pv);
    const h = grp_d1(pv);
    claws.push(h);
    beam(h, M.main2, [0, 0, 0], [0.02, 0.42, 0], 0.1, 0.12, 0.02);
    beam(h, M.joint, [0.02, 0.42, 0], [-0.16, 0.7, 0], 0.07, 0.09, 0.02);
    P(h, gCyl(0.06, 0.06, 0.14, 6), M.joint, 0.02, 0.42, 0, HP);
    P(h, gBox(0.05, 0.12, 0.05), M.acc, -0.19, 0.76, 0, 0, 0, 0.7); // 爪尖
    rod(h, M.sub, [0.06, 0.05, 0], [0.07, 0.3, 0], 0.025, 4); // 液壓桿
    const ta = a + PI / 3;
    P(torso, gCyl(0.07, 0.1, 0.18, 6), M.gun, Math.cos(ta) * 0.6, -0.56, Math.sin(ta) * 0.6);
    P(torso, gCyl(0.06, 0.06, 0.02, 6), thrM, Math.cos(ta) * 0.6, -0.66, Math.sin(ta) * 0.6);
  }
  // 約束環：繞著結晶的環＋四個發射器
  const ring = grp_d1(torso, 0, 0.05, 0);
  P(ring, new THREE.TorusGeometry(0.72, 0.035, 4, 16), M.joint, 0, 0, 0, HP);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    P(ring, gBox(0.1, 0.1, 0.1), ringM, Math.cos(a) * 0.72, 0, Math.sin(a) * 0.72, 0, -a);
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
  const plates = [
    slab_d1(torso, 0.34, 0.12, 0.05, M.main2, 0.32, -0.56, -0.38, 0, -0.7),
    slab_d1(torso, 0.34, 0.12, 0.05, M.main2, -0.32, -0.56, 0.38, 0, -0.7),
  ];
  const animD1 = (r, st) => {
    spin_d1(shards, 'y', st.dt * (0.8 + st.warn * 2.5));
    shards.position.y = Math.sin(st.t * 1.7) * 0.06;
    spin_d1(ring, 'y', st.dt * (1.2 + st.warn * 4));
    ring.rotation.x = Math.sin(st.t * 0.9) * 0.25;
    for (let i = 0; i < 3; i++)
      claws[i].rotation.z = -(0.04 + 0.04 * Math.sin(st.t * 2 + i) + st.warn * 0.4 + st.atk * 0.15);
    cry.emissiveIntensity = 1.3 + st.warn * 1.1 + st.atk * 2 + Math.sin(st.t * 3) * 0.2;
    ringM.emissiveIntensity = 0.6 + st.warn * 2;
    thrM.emissiveIntensity = 1 + Math.sin(st.t * 40) * 0.3;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'crystal',
    height: 1.4 * scale,
    extra: {
      shards,
      animD1,
      dmg: { smoke: [[0, 0.15, 0]], plates, chunks: [core, ring, ...clawPiv] },
    },
  });
}
// 鑽頭採礦機：履帶底盤＋機身＋前方的大鑽頭（drill 會轉）（高約 3 m）
// 待機：鑽頭慢轉、排氣蓋跳動、警示燈轉；預警（貼近目標）：鑽頭往前伸、鑽尖燒紅；攻擊（鑽擊）：突刺、高速旋轉
function buildDriller(pal, scale) {
  const { M, root, torso } = base(pal);
  const heatM = glow(0xff7020, 0.05),
    exM = glow(0xff9040, 0.1);
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
  // 側面的外裝甲板與散熱縫、螺栓、履帶的擋泥板
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
    bolts_d1(torso, M.joint, [s * 1.18, 1.22, -0.35], [s * 1.18, 1.22, 1.42], 7, 0.03, 'x');
    bolts_d1(torso, M.joint, [s * 1.18, 1.93, 0.05], [s * 1.18, 1.93, 1.42], 5, 0.03, 'x');
    top(
      torso,
      M.main3,
      [
        [s * 0.72, -1.25],
        [s * 1.5, -1.25],
        [s * 1.5, 1.65],
        [s * 0.72, 1.65],
      ],
      0.05,
      0.95,
    );
    hazard(torso, M, s * 1.1, 0.95, -1.27, 0.7, 0.12, 0);
  }
  // 排氣管（擊破時飛出去）：管子＋會跳動的雨蓋
  const stacks = grp_d1(torso);
  const flaps = [];
  for (const s of [-1, 1]) {
    P(stacks, gCyl(0.08, 0.1, 0.8, 6), M.gun, s * 0.75, 2.55, 1.35);
    P(stacks, gCyl(0.11, 0.11, 0.08, 6), M.joint, s * 0.75, 2.96, 1.35);
    P(stacks, gCyl(0.075, 0.075, 0.02, 6), exM, s * 0.75, 3.0, 1.35);
    const [fo, fi] = piv_d1(stacks, s * 0.75, 3.01, 1.45);
    P(fi, gBox(0.2, 0.02, 0.22), M.gun, s * 0.75, 3.02, 1.35);
    flaps.push(fo);
  }
  // 駕駛室（擊破時飛出去）：護籠＋車窗＋頭燈條＋警示燈＋扶手＋後照鏡
  const cab = grp_d1(torso);
  P(
    cab,
    gPod([
      [0.4, 1.05, 2.25, 2.85, 0.1, 0.02],
      [1.4, 1.2, 2.25, 2.95, 0.12, 0.02],
    ]),
    M.main3,
  );
  P(cab, gBox(0.85, 0.24, 0.04), M.lens, 0, 2.55, 0.39);
  for (const x of [-0.3, 0, 0.3]) P(cab, gBox(0.04, 0.32, 0.05), M.joint, x, 2.55, 0.36);
  P(cab, gBox(0.8, 0.07, 0.05), glow(0xffb020, 1.2), 0, 2.76, 0.38);
  for (const s of [-1, 1]) {
    rod(cab, M.joint, [s * 0.58, 2.35, 0.6], [s * 0.58, 2.8, 0.6], 0.02, 4);
    rod(cab, M.joint, [s * 0.58, 2.8, 0.6], [s * 0.58, 2.8, 1.2], 0.02, 4);
    rod(cab, M.joint, [s * 0.55, 2.7, 0.45], [s * 0.8, 2.8, 0.3], 0.015, 4);
    P(cab, gBox(0.05, 0.16, 0.1), M.lens, s * 0.82, 2.8, 0.3);
  }
  P(cab, gBox(0.5, 0.04, 0.4), M.joint, 0, 2.97, 1.0); // 頂蓋
  const bc = beacon_d1(cab, M, 0.35, 2.97, 0.7, 0xffa020, 0.09);
  // 鑽頭臂（擊破時飛出去）：減速箱、螺栓、鑽頭；預警時往前伸
  const [boom, boomI] = piv_d1(torso, 0, 1.5, -0.95);
  P(boomI, gCyl(0.6, 0.65, 0.6, 10), M.sub, 0, 1.5, -0.95, HP);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(boomI, gCyl(0.045, 0.045, 0.05, 4), M.joint, Math.cos(a) * 0.48, 1.5 + Math.sin(a) * 0.48, -1.26, HP);
  }
  P(boomI, new THREE.TorusGeometry(0.52, 0.04, 4, 14), heatM, 0, 1.5, -1.27);
  for (const s of [-1, 1]) piston(torso, M, [s * 0.85, 2.05, -0.25], [s * 0.55, 1.75, -1.1], 0.05);
  const drill = new THREE.Group();
  drill.position.set(0, 1.5, -1.2);
  boomI.add(drill);
  P(drill, gCyl(0.05, 0.75, 2.0, 10), M.gun, 0, 0, -1.0, -HP);
  P(drill, gCyl(0.78, 0.78, 0.14, 10), M.joint, 0, 0, -0.04, HP);
  P(drill, gCyl(0.0, 0.1, 0.25, 6), heatM, 0, 0, -2.1, -HP);
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
  // 後面的燃料箱（擊破時飛出去）：橫放的圓筒＋綁帶＋往機身的軟管
  const tank = grp_d1(torso);
  P(tank, gCyl(0.28, 0.28, 1.3, 8), M.sub, 0, 1.45, 1.98, 0, 0, HP);
  for (const x of [-0.4, 0.4]) P(tank, gCyl(0.3, 0.3, 0.06, 8), M.joint, x, 1.45, 1.98, 0, 0, HP);
  kitCable(
    tank,
    M,
    [
      [0.55, 1.6, 1.9],
      [0.7, 1.9, 1.75],
      [0.7, 2.0, 1.6],
    ],
    0.03,
  );
  decal(torso, 1, 0.42, 0.42, 1.18, 1.55, 0.42, 0, HP, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.4);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.06, 0.62, 0.5, M.main2, s * 1.2, 1.58, -0.18));
  const animD1 = (r, st) => {
    boom.position.z = -0.95 - st.warn * 0.18 - st.atk * 0.35;
    if (st.remote) spin_d1(drill, 'z', st.dt * (st.atk > 0.3 ? 30 : 6));
    heatM.emissiveIntensity = 0.05 + st.warn * 1.1 + st.atk * 2.4;
    exM.emissiveIntensity = 0.1 + st.atk * 2.5 + Math.max(0, Math.sin(st.t * 11)) * 0.4;
    for (let i = 0; i < 2; i++)
      flaps[i].rotation.x = -Math.max(0, Math.sin(st.t * (9 + i * 2))) * (0.25 + st.atk * 0.6);
    spin_d1(bc.rot, 'y', st.dt * (3 + st.warn * 6));
    bc.m.emissiveIntensity = 0.5 + st.warn * 2;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'driller',
    height: 3 * scale,
    extra: {
      drill,
      animD1,
      dmg: {
        smoke: [
          [0, 2.3, 0.6],
          [0.75, 3, 1.35],
        ],
        plates,
        chunks: [cab, boom, stacks, tank],
      },
    },
  });
}
// 廢鐵合成體：低矮的履帶身體＋堆成一團的廢鐵外殼（shell 依外殼量縮放）＋兩隻粗手臂（高約 4.5 m）
// 待機：手臂交互晃、外殼搖動、獨眼掃描；預警（貼近目標）：舉起雙拳、獨眼變亮；攻擊：拳頭砸下
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
  const eyeM = glow(0xff5a20, 1.6),
    emberM = glow(0xff7030, 0.8);
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
  // 焊道與焊上去的補丁、螺栓、警示牌
  for (const s of [-1, 1]) {
    P(torso, gBox(0.04, 0.05, 1.8), M.joint, s * 1.27, 2.2, 0.3);
    bolts_d1(torso, M.joint, [s * 1.28, 1.35, -0.4], [s * 1.28, 1.35, 1.0], 5, 0.035, 'x');
  }
  P(torso, gBox(1.6, 0.05, 0.04), M.joint, 0, 1.6, -1.32);
  P(torso, gBox(0.5, 0.36, 0.03), M.acc, 0.45, 2.55, 1.32, 0, 0, 0.2);
  hazard(torso, M, -0.4, 1.25, -1.32, 0.9, 0.16, 0);
  decal(torso, 3, 0.45, 0.45, 0.55, 1.25, -1.33, 0, PI, 0);
  // 吊在前面的鏈條
  for (let i = 0; i < 4; i++)
    P(
      torso,
      new THREE.TorusGeometry(0.08, 0.025, 4, 8),
      M.joint,
      0.05,
      1.95 - i * 0.13,
      -1.34,
      0,
      i % 2 ? HP : 0,
      0,
    );
  // 獨眼（擊破時飛出去）：外框＋發光的眼縫＋左右掃描的光點
  const eyeG = grp_d1(torso);
  CB(eyeG, 1.2, 0.42, 0.2, M.joint, 0, 2.4, -1.25, 0, 0, 0, 0.05);
  P(eyeG, gBox(1.0, 0.25, 0.05), eyeM, 0, 2.4, -1.36);
  for (const x of [-0.25, 0.25]) P(eyeG, gBox(0.04, 0.3, 0.06), M.joint, x, 2.4, -1.38);
  bolts_d1(eyeG, M.gun, [-0.52, 2.57, -1.36], [0.52, 2.57, -1.36], 4, 0.03, 'z');
  const scan = grp_d1(eyeG, 0, 2.4, -1.4);
  P(scan, gBox(0.14, 0.18, 0.03), glow(0xffd0a0, 3), 0, 0, 0);
  const searchM = glow(0xfff0c0, 0.4);
  P(eyeG, gCyl(0.12, 0.15, 0.2, 8), M.gun, -0.7, 2.86, -0.9, HP);
  P(eyeG, gCyl(0.1, 0.1, 0.03, 8), searchM, -0.7, 2.86, -1.01, HP);
  // 身上焊著的廢料：側面的輪胎、鋼筋
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.42, 0.42, 0.22, 10), M.rubber, s * 1.32, 1.95, 0.75, 0, 0, HP + s * 0.25);
    rod(torso, M.sub, [s * 0.6, 2.75, 0.9], [s * 1.0, 3.3, 1.2], 0.03, 4);
  }
  // 煙囪（擊破時飛出去）：歪掉的排氣管＋燒紅的口
  const stack = grp_d1(torso);
  rod(stack, M.gun, [0.75, 2.6, 0.95], [0.9, 3.6, 1.15], 0.13, 6);
  P(stack, gCyl(0.16, 0.16, 0.1, 6), M.joint, 0.9, 3.62, 1.15);
  P(stack, gCyl(0.11, 0.11, 0.02, 6), emberM, 0.9, 3.68, 1.15);
  // 手臂：肩軸＋上臂（液壓桿）＋前臂＋三爪的拳頭（arms 繞肩軸轉）
  const arms = [];
  for (const s of [-1, 1]) {
    const [ao, a] = piv_d1(torso, s * 1.4, 2.45, -0.25);
    arms.push(ao);
    P(a, gCyl(0.38, 0.38, 0.5, 8), M.joint, s * 1.4, 2.45, -0.25, 0, 0, HP);
    beam(a, M.main2, [s * 1.6, 2.5, -0.25], [s * 1.95, 1.4, -0.55], 0.6, 0.62, 0.08);
    piston(a, M, [s * 1.3, 2.1, 0.05], [s * 1.75, 1.15, -0.4], 0.06);
    P(a, gCyl(0.3, 0.3, 0.7, 8), M.joint, s * 1.95, 1.35, -0.55, 0, 0, HP);
    beam(a, M.main3, [s * 1.98, 1.35, -0.6], [s * 2.08, 0.75, -0.8], 0.5, 0.5, 0.06);
    CB(a, 1.0, 0.7, 1.0, M.gun, s * 2.1, 0.55, -0.8, 0, 0, 0, 0.1);
    bolts_d1(a, M.joint, [s * 2.61, 0.75, -1.1], [s * 2.61, 0.75, -0.5], 3, 0.04, 'x');
    for (const fx of [-0.3, 0, 0.3])
      beam(a, M.joint, [s * 2.1 + fx, 0.4, -1.25], [s * 2.1 + fx * 1.1, 0.12, -1.42], 0.16, 0.16, 0.03);
    kitCable(
      a,
      M,
      [
        [s * 1.2, 2.6, 0.1],
        [s * 1.75, 2.3, -0.1],
        [s * 1.95, 1.7, -0.3],
      ],
      0.035,
    );
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
  const plates = [
    slab_d1(torso, 0.7, 0.55, 0.06, M.main2, -0.62, 1.8, -1.36, 0, 0, 0.08),
    slab_d1(torso, 0.6, 0.5, 0.06, M.main3, 0.65, 1.75, -1.36, 0, 0, -0.12),
    slab_d1(torso, 0.06, 0.6, 0.9, M.main2, 1.3, 1.85, -0.35),
  ];
  const animD1 = (r, st) => {
    for (let i = 0; i < 2; i++)
      arms[i].rotation.x =
        Math.sin(st.t * 1.6 + i * PI) * 0.06 + st.warn * 0.55 * (1 - st.atk) - st.atk * 0.05;
    shell.rotation.y = Math.sin(st.t * 0.7) * 0.05;
    shell.rotation.z = Math.sin(st.t * 1.1) * 0.03;
    scan.position.x = Math.sin(st.t * (1.5 + st.warn * 4)) * 0.4;
    eyeM.emissiveIntensity = 1.4 + st.warn * 1.8 + st.atk * 1.5;
    searchM.emissiveIntensity = 0.4 + st.warn * 2.5;
    emberM.emissiveIntensity = 0.6 + Math.max(0, Math.sin(st.t * 5)) * 0.8 + st.atk;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'junk',
    height: 4.5 * scale,
    extra: {
      shell,
      animD1,
      dmg: {
        smoke: [
          [0, 2.9, 0.5],
          [0.9, 3.6, 1.15],
        ],
        plates,
        chunks: [arms[0], arms[1], eyeG, stack, shell],
      },
    },
  });
}

// 沙中伏擊者：從沙裡鑽出的鑽頭頭部＋一圈鉗爪（高約 2.6 m；在地下時整個隱藏）
// 待機：鑽頭慢轉、鉗爪微微開合、錨爪收著；攻擊（鑽出地面）：鉗爪猛然張開再合上、鑽頭高速旋轉、錨爪插地
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
  const eyeM = glow(0xffd060, 1.4);
  // 身體：八角筒＋分節的環＋縱向的裝甲條
  P(torso, gCyl(1.1, 1.3, 1.6, 8), M.main, 0, 0.8, 0, 0, PI / 8);
  for (let i = 0; i < 3; i++) {
    P(torso, gCyl(1.16 - i * 0.07, 1.2 - i * 0.07, 0.16, 8), M.main2, 0, 0.3 + i * 0.5, 0, 0, PI / 8);
    // 環上的螺栓
    for (let j = 0; j < 8; j++) {
      const a = (j / 8) * PI * 2 + PI / 8;
      const rr = 1.2 - i * 0.07;
      P(
        torso,
        gCyl(0.03, 0.03, 0.05, 5),
        M.joint,
        Math.cos(a) * rr,
        0.3 + i * 0.5,
        Math.sin(a) * rr,
        0,
        -a,
        HP,
      );
    }
  }
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
  // 側面的進氣口（格柵）
  for (const sx of [-1, 1]) {
    CB(torso, 0.1, 0.42, 0.55, M.sub, sx * 1.18, 1.05, 0.15, 0, 0, 0, 0.02);
    for (let k = 0; k < 4; k++) P(torso, gBox(0.04, 0.03, 0.5), M.joint, sx * 1.24, 0.9 + k * 0.1, 0.15);
  }
  // 感測器（擊破時飛出去）：正面的眼縫＋側面的感測球
  const sensor = grp_d1(torso);
  CB(sensor, 1.05, 0.32, 0.2, M.joint, 0, 1.2, -1.08, 0, 0, 0, 0.04);
  P(sensor, gBox(0.9, 0.18, 0.05), eyeM, 0, 1.2, -1.2);
  for (const x of [-0.3, 0, 0.3]) P(sensor, gBox(0.03, 0.2, 0.06), M.joint, x, 1.2, -1.22);
  P(sensor, gSph(0.14, 8), M.lens, 0.62, 1.42, -0.92);
  P(sensor, gCyl(0.16, 0.18, 0.08, 8), M.joint, 0.62, 1.42, -0.85, HP);
  hazard(sensor, M, 0, 0.62, -1.16, 0.9, 0.14, 0);
  // 頂部的頸環
  P(torso, gCyl(1.0, 1.08, 0.18, 8), M.sub, 0, 1.6, 0, 0, PI / 8);
  // 錨爪（擊破時飛出去）：底部六支，鑽出時往外插進地面
  const spikes = grp_d1(torso);
  const anchors = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 6;
    const pv = grp_d1(spikes, Math.cos(a) * 1.18, 0.5, Math.sin(a) * 1.18);
    pv.rotation.y = -a;
    const h = grp_d1(pv);
    anchors.push(h);
    P(h, gCyl(0.07, 0.07, 0.2, 6), M.joint, 0, 0, 0, HP);
    beam(h, M.gun, [0.05, 0, 0], [0.22, -0.45, 0], 0.12, 0.14, 0);
  }
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
  // 鉗爪：關節軸＋彎鉤的爪片（每片各自繞切線方向開合）
  const claws = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    const pv = grp_d1(head, c * 0.92, -0.05, s * 0.92);
    pv.rotation.y = -a;
    const h = grp_d1(pv);
    claws.push(h);
    P(h, gCyl(0.12, 0.12, 0.3, 6), M.joint, 0, 0, 0, HP);
    P(h, gPlate(CLAW, 0.2, 0.03), M.acc, 0.06, 0.4, 0, 0, 0, -0.45);
    P(h, gBox(0.06, 0.06, 0.24), M.gun, 0.12, 0.62, 0); // 爪尖的硬化片
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.4, -1.1);
  torso.add(hand);
  const plates = [];
  for (const a of [(3 * PI) / 4, (5 * PI) / 4]) {
    const x = Math.sin(a) * 1.2,
      z = Math.cos(a) * 1.2;
    plates.push(slab_d1(torso, 0.62, 0.9, 0.06, M.main2, x, 0.85, z, 0, a));
  }
  const animD1 = (r, st) => {
    spin_d1(head, 'y', st.dt * (0.8 + st.atk * 14));
    const open = 0.06 + 0.06 * Math.sin(st.t * 2.2) + Math.sin(Math.min(1, st.atk) * PI) * 0.7;
    for (const c of claws) c.rotation.z = -open;
    for (const a of anchors) a.rotation.z = Math.min(1, st.atk * 2) * 0.6;
    eyeM.emissiveIntensity = 1.2 + Math.sin(st.t * 3) * 0.3 + st.atk * 2;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'burrower',
    height: 2.6 * scale,
    extra: {
      head,
      animD1,
      dmg: { smoke: [[0, 1.7, 0.5]], plates, chunks: [head, sensor, spikes] },
    },
  });
}
// 沙暴干擾機：機身＋兩側的涵道風扇＋旋轉的干擾天線陣列（飛行，高約 1.6 m）
// 待機：風扇轉、機身起伏、航行燈閃；預警（25 m 內有目標＝干擾中）：天線端點變亮、天線轉得更快
function buildJammer(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.8;
  const gl = glow(0xffa030, 2),
    emM = glow(0xffa030, 0.3),
    navR = glow(0xff3020, 1.2),
    navG = glow(0x30ff60, 1.2);
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
  // 背上的設備艙與散熱縫、螺栓、後方的天線
  CB(torso, 0.6, 0.12, 0.7, M.main3, 0, 0.29, 0.15, 0, 0, 0, 0.03);
  for (let i = 0; i < 3; i++) P(torso, gBox(0.42, 0.03, 0.05), M.joint, 0, 0.36, 0.02 + i * 0.12);
  bolts_d1(torso, M.joint, [-0.26, 0.36, -0.15], [0.26, 0.36, -0.15], 4, 0.02, 'y');
  for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.15, 0.2, 0.6], [s * 0.25, 0.55, 0.85], 0.01, 4);
  hazard(torso, M, 0, -0.02, 0.71, 0.4, 0.08, PI);
  eye(torso, M, gl, 0, 0, -0.71, 0.07);
  // 兩側：短翼＋翼端的涵道風扇（風扇與涵道一起，擊破時飛出去）
  const fans = [],
    rotors = [];
  for (const s of [-1, 1]) {
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
    bolts_d1(torso, M.joint, [s * 0.55, 0.06, -0.12], [s * 0.55, 0.06, 0.2], 3, 0.02, 'y');
    const fan = grp_d1(torso);
    fans.push(fan);
    P(fan, gCyl(0.36, 0.36, 0.14, 10), M.joint, s * 1.05, 0.04, 0);
    P(fan, new THREE.TorusGeometry(0.33, 0.03, 4, 12), M.sub, s * 1.05, -0.03, 0, HP);
    for (const a of [0, PI / 2]) P(fan, gBox(0.56, 0.02, 0.04), M.joint, s * 1.05, 0.12, 0, 0, a);
    P(fan, gSph(0.04, 4), s > 0 ? navG : navR, s * 1.43, 0.04, 0);
    const rot = grp_d1(fan, s * 1.05, 0.04, 0);
    rotors.push(rot);
    P(rot, gCyl(0.07, 0.07, 0.2, 6), M.joint, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const a = (k * PI) / 2;
      P(rot, gBox(0.27, 0.02, 0.09), M.sub, Math.cos(a) * 0.16, 0, -Math.sin(a) * 0.16, 0.35, a, 0);
    }
  }
  // 下方的感測器莢艙（擊破時飛出去）
  const belly = grp_d1(torso);
  for (const s of [-1, 1]) P(belly, gCyl(0.06, 0.06, 0.3, 6), M.gun, s * 0.3, -0.28, -0.3, HP);
  CB(belly, 0.22, 0.14, 0.34, M.sub, 0, -0.26, 0.05, 0, 0, 0, 0.02);
  P(belly, gSph(0.07, 6), M.lens, 0, -0.33, -0.1);
  const dish = new THREE.Group();
  dish.position.set(0, 0.45, 0);
  torso.add(dish);
  P(dish, gCyl(0.06, 0.08, 0.6, 6), M.joint, 0, 0.3, 0);
  P(dish, gCyl(0.14, 0.14, 0.06, 8), M.sub, 0, 0.5, 0);
  // 天線陣列：三支橫桿，每支兩端有偶極子（干擾中發光）
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    const y = 0.55 + i * 0.1;
    P(dish, gBox(1.2, 0.04, 0.08), M.acc, 0, y, 0, 0, a, 0);
    for (const s of [-1, 1]) {
      P(dish, gBox(0.03, 0.16, 0.03), M.joint, Math.cos(a) * s * 0.58, y + 0.06, -Math.sin(a) * s * 0.58);
      P(dish, gSph(0.035, 4), emM, Math.cos(a) * s * 0.58, y + 0.15, -Math.sin(a) * s * 0.58);
    }
  }
  P(dish, gSph(0.12, 8), gl, 0, 0.85, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.8);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.3, 0.03, 0.36, M.main3, s * 0.7, 0.07, 0.05));
  const animD1 = (r, st) => {
    for (const ro of rotors) spin_d1(ro, 'y', st.dt * 28);
    torso.position.y = 0.8 + Math.sin(st.t * 2.1) * 0.05;
    torso.rotation.z = Math.sin(st.t * 1.3) * 0.04;
    spin_d1(dish, 'y', st.dt * st.warn * 3);
    emM.emissiveIntensity = 0.3 + st.warn * (1.6 + Math.sin(st.t * 20) * 0.5);
    gl.emissiveIntensity = 2 + st.warn * 1.5 + st.atk * 2;
    const nv = blink_d1(st.t, 1.2) ? 1.6 : 0.2;
    navR.emissiveIntensity = navG.emissiveIntensity = nv;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'jammer',
    height: 1.6 * scale,
    extra: {
      dish,
      animD1,
      dmg: { smoke: [[0, 0.95, 0.15]], plates, chunks: [dish, fans[0], fans[1], belly] },
    },
  });
}

// 起重機砲台：格子塔＋旋轉的吊臂，吊臂前端吊著貨櫃（crate：吊著時顯示；高約 13 m，不移動）
// 待機：貨櫃與吊鉤晃動、塔頂紅燈閃；預警（bossVis 2＝快要丟出）：台車往回收、捲揚機轉、警示燈與探照燈變亮；
// 攻擊（丟出）：台車往前甩、捲揚機急轉
function buildCrane(pal, scale) {
  const { M, root, torso } = base(pal);
  const winM = glow(0xffd060, 1.2),
    redM = glow(0xff3a2a, 2),
    floodM = glow(0xfff0c0, 0.5);
  // 基座：切角的混凝土座＋鋼板＋錨栓＋電箱
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
    for (const sz of [-1, 1]) {
      P(torso, gCyl(0.09, 0.09, 0.2, 4), M.gun, sx * 1.35, 0.85, sz * 1.35);
      bolts_d1(torso, M.gun, [sx * 0.85, 1.0, sz * 0.55], [sx * 0.85, 1.0, sz * 0.85], 2, 0.05, 'y');
    }
  hazard(torso, M, 0, 0.45, -1.72, 2.6, 0.22, 0);
  hazard(torso, M, 0, 0.45, 1.72, 2.6, 0.22, PI);
  CB(torso, 0.5, 0.9, 0.3, M.main3, 1.25, 1.45, 1.05, 0, 0, 0, 0.03);
  P(torso, gBox(0.02, 0.7, 0.24), M.joint, 1.51, 1.45, 1.05);
  P(torso, gBox(0.12, 0.08, 0.02), glow(0x60ff80, 1.4), 1.25, 1.75, 0.89);
  rod(torso, M.rubber, [1.15, 1.0, 1.05], [0.75, 1.2, 0.75], 0.04, 4);
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
  // 外側的爬梯（+X 面）＋電纜管
  for (const z of [-0.22, 0.22]) P(torso, gBox(0.05, 8.8, 0.05), M.joint, 0.92, 5.4, z);
  for (let y = 1.2; y < 9.8; y += 0.42) P(torso, gBox(0.04, 0.04, 0.44), M.joint, 0.92, y, 0);
  for (const y of [3.4, 6.6]) {
    for (const z of [-0.3, 0.3]) P(torso, gBox(0.3, 0.04, 0.04), M.joint, 0.8, y, z);
    P(torso, gBox(0.04, 0.04, 0.6), M.joint, 0.95, y + 0.0, 0);
  }
  P(torso, gBox(0.1, 9.0, 0.1), M.rubber, -0.82, 5.4, 0.55);
  // 中段的維修平台＋欄杆
  top(torso, M.main3, crect(2.4, 2.4, 0.3), 0.06, 5.0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) P(torso, gBox(0.04, 0.7, 0.04), M.joint, sx * 1.15, 5.35, sz * 1.15);
  for (const s of [-1, 1]) {
    P(torso, gBox(2.3, 0.04, 0.04), M.joint, 0, 5.7, s * 1.15);
    P(torso, gBox(0.04, 0.04, 2.3), M.joint, s * 1.15, 5.7, 0);
  }
  // 迴轉座＋齒圈的螺栓
  P(torso, gCyl(1.05, 1.05, 0.2, 12), M.joint, 0, 9.95, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    P(torso, gCyl(0.04, 0.04, 0.05, 4), M.gun, Math.cos(a) * 0.95, 10.07, Math.sin(a) * 0.95);
  }
  // 駕駛室（擊破時飛出去）：前面收斜的艙＋發光的窗＋雨刷＋門＋編號
  const cab = grp_d1(torso);
  P(
    cab,
    gPod([
      [-0.85, 1.8, 9.9, 11.1, 0.15, 0.05],
      [-0.5, 2.0, 9.9, 11.3, 0.15, 0.05],
      [1.6, 2.0, 9.9, 11.3, 0.12, 0.05],
    ]),
    M.main2,
  );
  P(cab, gBox(1.3, 0.55, 0.05), winM, 0, 10.75, -0.86);
  for (const x of [-0.35, 0.35]) P(cab, gBox(0.05, 0.6, 0.07), M.joint, x, 10.75, -0.88);
  for (const x of [-0.5, 0.15]) P(cab, gBox(0.03, 0.42, 0.03), M.gun, x, 10.65, -0.9, 0, 0, 0.5);
  slats(cab, M.joint, 1.02, 10.95, 0.9, 0.7, 4, 0.12, HP);
  P(cab, gBox(0.03, 0.9, 0.6), M.joint, -1.01, 10.45, 0.6);
  P(cab, gBox(0.04, 0.05, 0.12), M.gun, -1.04, 10.45, 0.82);
  decal(cab, 2, 0.6, 0.3, -1.02, 11.05, 0.2, 0, -HP, 0);
  // 吊臂：三角斷面的桁架（下弦兩根、上弦一根、斜撐）＋走道
  for (const s of [-1, 1]) P(torso, gBox(0.12, 0.12, 9.4), M.main, s * 0.34, 11.36, -4.8);
  P(torso, gBox(0.14, 0.14, 9.4), M.main, 0, 12.04, -4.8);
  for (let i = 0; i < 10; i++) {
    const z0 = -0.2 - i * 0.92,
      z1 = z0 - 0.92;
    P(torso, gBox(0.7, 0.08, 0.08), M.main, 0, 11.36, z0);
    for (const s of [-1, 1]) rod(torso, M.main2, [s * 0.34, 11.36, z0], [0, 12.04, z1 + 0.46], 0.035, 4);
  }
  // 吊臂下的探照燈（照向落點）與從捲揚機到台車的鋼索
  for (const z of [-3.5, -7.2]) {
    P(torso, gBox(0.3, 0.16, 0.2), M.gun, 0, 11.2, z);
    P(torso, gBox(0.24, 0.02, 0.14), floodM, 0, 11.11, z);
  }
  rod(torso, M.joint, [0, 11.62, 1.0], [0, 11.3, -8.6], 0.02, 4);
  // 平衡臂與配重塊（擊破時飛出去）
  const cw = grp_d1(torso);
  CB(cw, 0.8, 0.2, 4.0, M.main, 0, 11.5, 2.6, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) P(cw, gBox(0.05, 0.4, 3.6), M.joint, s * 0.4, 11.8, 2.4);
  for (let i = 0; i < 3; i++) {
    CB(cw, 1.6, 0.42, 1.4, M.sub, 0, 10.72 + i * 0.46, 4.2, 0, 0, 0, 0.05);
    bolts_d1(cw, M.joint, [-0.82, 10.72 + i * 0.46, 3.75], [-0.82, 10.72 + i * 0.46, 4.65], 3, 0.04, 'x');
  }
  hazard(cw, M, 0, 11.2, 4.92, 1.4, 0.2, PI);
  // 捲揚機（預警時轉動）
  const winch = grp_d1(cw, 0, 11.82, 1.0);
  P(winch, gCyl(0.28, 0.28, 0.6, 10), M.rubber, 0, 0, 0, 0, 0, HP);
  for (const s of [-1, 1]) P(winch, gCyl(0.34, 0.34, 0.05, 10), M.joint, s * 0.32, 0, 0, 0, 0, HP);
  P(winch, gBox(0.66, 0.06, 0.06), M.acc, 0, 0.3, 0);
  for (const s of [-1, 1]) P(cw, gBox(0.06, 0.4, 0.5), M.joint, s * 0.38, 11.72, 1.0);
  // 塔頂的 A 字架與拉索、紅色警示燈（擊破時飛出去）
  const aframe = grp_d1(torso);
  for (const s of [-1, 1]) beam(aframe, M.main, [s * 0.4, 11.4, 0], [0, 14.4, 0], 0.18, 0.22, 0.03);
  rod(aframe, M.joint, [0, 14.3, 0], [0, 12.08, -9.2], 0.03, 4);
  rod(aframe, M.joint, [0, 14.3, 0], [0, 11.62, 4.5], 0.03, 4);
  P(aframe, gCyl(0.12, 0.12, 0.2, 8), redM, 0, 14.5, 0);
  // 吊臂前端的旋轉警示燈
  const bc = beacon_d1(torso, M, 0, 12.12, -9.4, 0xffa020, 0.16);
  // 吊車台車（擊破時飛出去）：台車＋滑輪，下面掛著晃動的吊鉤與貨櫃（crate）
  const trolley = grp_d1(torso, 0, 11.15, -8.9);
  CB(trolley, 0.7, 0.4, 0.9, M.joint, 0, 0, 0, 0, 0, 0, 0.04);
  for (const z of [-0.3, 0.3]) P(trolley, gCyl(0.14, 0.14, 0.5, 8), M.sub, 0, 0.17, z, 0, 0, HP);
  hazard(trolley, M, 0, -0.05, -0.46, 0.6, 0.12, 0);
  const swing = grp_d1(trolley);
  const crate = new THREE.Group();
  crate.position.set(0, -11.15, 0);
  swing.add(crate);
  P(crate, gBox(0.06, 3.0, 0.06), M.joint, 0, 9.4, 0);
  CB(crate, 0.5, 0.4, 0.4, M.acc, 0, 7.85, 0, 0, 0, 0, 0.05);
  P(crate, gBox(4.0, 0.12, 0.22), M.joint, 0, 7.62, 0);
  for (const s of [-1, 1]) rod(crate, M.joint, [s * 1.9, 7.6, 0], [s * 2.1, 7.6 - 0.05, 0], 0.03, 4);
  // 貨櫃：浪板的肋＋兩端的框＋角件
  CB(crate, 4.6, 2.3, 2.4, M.acc, 0, 6.4, 0, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) {
    P(crate, gBox(0.2, 2.4, 2.5), M.joint, s * 2.2, 6.4, 0);
    for (let i = 0; i < 7; i++) P(crate, gBox(0.12, 2.1, 0.05), M.acc, -1.65 + i * 0.55, 6.4, s * 1.22);
    P(crate, gBox(4.2, 0.1, 0.06), M.joint, 0, 6.4 + s * 1.08, 1.22);
    P(crate, gBox(4.2, 0.1, 0.06), M.joint, 0, 6.4 + s * 1.08, -1.22);
    for (const y of [5.3, 7.5])
      for (const z of [-1.2, 1.2]) P(crate, gBox(0.26, 0.2, 0.2), M.gun, s * 2.2, y, z);
  }
  decal(crate, 4, 1.2, 0.6, 0.6, 6.6, -1.25, 0, PI, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 6.4, -8.9);
  torso.add(hand);
  const plates = [
    slab_d1(cab, 0.06, 0.5, 1.2, M.main3, 1.04, 10.35, 0.55),
    slab_d1(cab, 0.06, 0.5, 1.0, M.main3, -1.04, 10.95, 1.15),
    slab_d1(cw, 1.5, 0.35, 0.05, M.main2, 0, 11.1, 3.47),
  ];
  const animD1 = (r, st) => {
    trolley.position.z = -8.9 + st.warn * 0.7 - st.atk * 0.9;
    const amp = 0.025 + st.warn * 0.03;
    swing.rotation.x = Math.sin(st.t * 0.9) * amp - st.warn * 0.05;
    swing.rotation.z = Math.sin(st.t * 0.7 + 1) * amp;
    spin_d1(winch, 'x', st.dt * (0.3 + st.warn * 4 + st.atk * 10));
    spin_d1(bc.rot, 'y', st.dt * (2 + st.warn * 8));
    bc.m.emissiveIntensity = 0.5 + st.warn * 2.5 * (0.6 + 0.4 * blink_d1(st.t, 4));
    redM.emissiveIntensity = Math.sin(st.t * 3) > 0.6 ? 2.5 : 0.4;
    floodM.emissiveIntensity = 0.5 + st.warn * 2.5 + st.atk * 1.5;
    winM.emissiveIntensity = 1.2 + st.warn * 0.8;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'crane',
    height: 13 * scale,
    extra: {
      crate,
      animD1,
      dmg: {
        smoke: [
          [0, 10.8, 0.6],
          [0, 11.4, 4.2],
          [0, 5.2, 0],
        ],
        plates,
        chunks: [cab, cw, aframe, trolley],
      },
    },
  });
}
// 叉架 MT：堆高機的車身與護頂架，前方的貨叉舉著貨櫃當盾牌（crate：舉著時顯示；高約 3.4 m）
// 待機：車輪依速度轉、警示燈轉；預警（bossVis 2＝快要丟出）：貨叉把貨櫃舉高、頭燈與警示燈變亮；攻擊（丟出）：貨叉往前上甩
function buildForklift(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffb040, 1.4),
    headM = glow(0xfff0c0, 0.4);
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
  // 輪拱上的擋泥板、側面的踏板與螺栓
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
  for (const s of [-1, 1]) {
    P(torso, gBox(0.3, 0.05, 0.5), M.joint, s * 1.08, 0.72, 0.25);
    bolts_d1(torso, M.joint, [s * 1.02, 1.55, -0.85], [s * 1.02, 1.55, 1.4], 6, 0.025, 'x');
  }
  // 儀表的燈、座椅與方向盤
  CB(torso, 0.6, 0.18, 0.55, M.joint, 0, 1.8, 0.45, 0, 0, 0, 0.04);
  CB(torso, 0.6, 0.55, 0.14, M.joint, 0, 2.08, 0.72, -0.15, 0, 0, 0.04);
  rod(torso, M.joint, [0, 1.7, -0.45], [0, 2.2, -0.2], 0.04);
  P(torso, gCyl(0.18, 0.18, 0.04, 8), M.sub, 0, 2.22, -0.18, -0.5);
  P(torso, gBox(0.8, 0.14, 0.05), gl, 0, 1.6, -1.22);
  // 配重（擊破時飛出去）：後面圓弧的大塊鑄鐵＋警示條＋瓦斯桶＋排氣管
  const cwG = grp_d1(torso);
  P(
    cwG,
    gPod([
      [0.9, 1.9, 1.45, 2.3, 0.1, 0],
      [1.7, 1.9, 1.45, 2.3, 0.24, 0],
      [1.95, 1.5, 1.5, 2.15, 0.22, 0],
    ]),
    M.sub,
  );
  hazard(cwG, M, 0, 1.68, 1.96, 1.3, 0.18, PI);
  decal(cwG, 2, 0.5, 0.25, 0.96, 1.9, 1.3, 0, HP, 0);
  P(cwG, gCyl(0.2, 0.2, 0.9, 8), M.acc, 0, 2.5, 1.25, 0, 0, HP);
  for (const x of [-0.25, 0.25]) P(cwG, gCyl(0.215, 0.215, 0.05, 8), M.joint, x, 2.5, 1.25, 0, 0, HP);
  P(cwG, gCyl(0.06, 0.06, 0.14, 6), M.joint, 0.5, 2.5, 1.25, 0, 0, HP);
  rod(cwG, M.gun, [-0.75, 1.7, 1.55], [-0.75, 2.55, 1.6], 0.05, 6);
  // 護頂架（擊破時飛出去）：前柱往後斜、頂部是格柵、警示燈、頭燈
  const cage = grp_d1(torso);
  for (const s of [-1, 1]) {
    beam(cage, M.joint, [s * 0.85, 1.7, -0.45], [s * 0.85, 3.3, -0.2], 0.1, 0.1, 0.02);
    P(cage, gBox(0.1, 1.6, 0.1), M.joint, s * 0.85, 2.5, 0.9);
    P(cage, gBox(0.1, 0.1, 1.3), M.main2, s * 0.85, 3.32, 0.35);
    P(cage, gBox(1.8, 0.1, 0.1), M.main2, 0, 3.32, s * 0.6 + 0.3);
    P(cage, gCyl(0.1, 0.1, 0.1, 8), M.joint, s * 0.85, 3.2, -0.29, HP);
    P(cage, gCyl(0.08, 0.08, 0.03, 8), headM, s * 0.85, 3.2, -0.35, HP);
    rod(cage, M.joint, [s * 0.85, 2.6, -0.32], [s * 1.12, 2.7, -0.35], 0.015, 4);
    P(cage, gBox(0.04, 0.18, 0.12), M.lens, s * 1.14, 2.7, -0.35);
  }
  for (let i = 0; i < 4; i++) P(cage, gBox(1.7, 0.04, 0.08), M.joint, 0, 3.34, -0.12 + i * 0.28);
  const bc = beacon_d1(cage, M, 0.6, 3.38, 0.75, 0xffb040, 0.09);
  // 車輪（依速度轉）
  const wheels = [];
  for (const [x, z] of [
    [-1.05, -0.7],
    [1.05, -0.7],
    [-1.05, 1.2],
    [1.05, 1.2],
  ]) {
    const w = grp_d1(torso, x, 0.45, z);
    wheels.push(w);
    wheel(w, M, 0, 0, 0, 0.45, 0.35);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * PI * 2;
      P(
        w,
        gCyl(0.03, 0.03, 0.04, 5),
        M.joint,
        Math.sign(x) * 0.22,
        Math.cos(a) * 0.18,
        Math.sin(a) * 0.18,
        0,
        0,
        HP,
      );
    }
  }
  // 門架（擊破時飛出去）：兩根槽鋼立柱＋橫樑＋升降油壓缸與鏈條＋傾斜油壓缸＋油管
  const mast = grp_d1(torso);
  for (const s of [-1, 1]) {
    P(mast, gBox(0.06, 3.4, 0.2), M.joint, s * 0.6, 1.9, -1.3);
    for (const dz of [-0.09, 0.09]) P(mast, gBox(0.16, 3.4, 0.04), M.joint, s * 0.55, 1.9, -1.3 + dz);
    P(mast, gBox(0.04, 2.0, 0.04), M.sub, s * 0.25, 2.2, -1.38);
    piston(mast, M, [s * 0.5, 1.05, -0.95], [s * 0.55, 1.55, -1.25], 0.05);
    kitCable(
      mast,
      M,
      [
        [s * 0.3, 1.6, -0.95],
        [s * 0.2, 1.3, -1.15],
        [s * 0.12, 0.9, -1.22],
      ],
      0.025,
    );
  }
  for (const y of [0.4, 3.5]) P(mast, gBox(1.35, 0.12, 0.12), M.joint, 0, y, -1.3);
  piston(mast, M, [0, 0.45, -1.25], [0, 3.2, -1.25], 0.07);
  P(mast, gCyl(0.1, 0.1, 0.1, 8), M.gun, 0, 3.45, -1.33, 0, 0, HP); // 鏈輪
  // 叉架（舉高、甩出）：背板＋擋貨架＋L 形貨叉，上面是貨櫃
  const car = grp_d1(torso);
  P(car, gBox(1.4, 0.45, 0.08), M.main2, 0, 0.85, -1.46);
  for (const x of [-0.6, 0, 0.6]) P(car, gBox(0.05, 0.9, 0.05), M.main2, x, 1.5, -1.46);
  P(car, gBox(1.4, 0.06, 0.06), M.main2, 0, 1.95, -1.46);
  for (const s of [-1, 1]) {
    P(car, gBox(0.18, 0.62, 0.08), M.gun, s * 0.5, 0.82, -1.52);
    P(car, gBox(0.2, 0.08, 1.6), M.gun, s * 0.5, 0.55, -2.1);
    P(car, gBox(0.16, 0.03, 0.2), M.acc, s * 0.5, 0.6, -2.82); // 叉尖的警示漆
  }
  bolts_d1(car, M.joint, [-0.55, 0.85, -1.51], [0.55, 0.85, -1.51], 5, 0.025, 'z');
  const crate = new THREE.Group();
  crate.position.set(0, 0, -2.3);
  car.add(crate);
  CB(crate, 3.0, 2.4, 1.5, M.acc, 0, 1.85, 0, 0, 0, 0, 0.04);
  for (let i = 0; i < 6; i++) P(crate, gBox(0.12, 2.2, 0.05), M.acc, -1.1 + i * 0.44, 1.85, -0.77);
  for (const s of [-1, 1]) {
    P(crate, gBox(0.2, 2.5, 1.56), M.joint, s * 1.4, 1.85, 0);
    P(crate, gBox(2.7, 0.1, 0.06), M.joint, 0, 1.85 + s * 1.12, -0.76);
    for (const y of [0.75, 2.95]) P(crate, gBox(0.24, 0.2, 0.2), M.gun, s * 1.4, y, -0.7);
  }
  P(crate, gBox(0.05, 1.2, 0.04), M.gun, 0.35, 1.85, -0.8);
  decal(crate, 4, 0.9, 0.45, -0.6, 2.3, -0.81, 0, PI, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -1.4);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.05, 0.5, 1.2, M.main3, s * 1.03, 1.15, 0.25));
  const animD1 = (r, st) => {
    const roll = (-st.fwd * st.dt) / 0.45;
    for (const w of wheels) spin_d1(w, 'x', roll);
    car.position.y = st.warn * 0.55;
    car.position.z = -st.atk * 0.45;
    car.rotation.x = st.atk * 0.3 - st.warn * 0.04;
    spin_d1(bc.rot, 'y', st.dt * (2.5 + st.warn * 9));
    bc.m.emissiveIntensity = 0.5 + st.warn * 2.4;
    headM.emissiveIntensity = 0.4 + st.warn * 2.2;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'forklift',
    height: 3.4 * scale,
    extra: {
      crate,
      animD1,
      dmg: {
        smoke: [
          [0, 1.9, 1.4],
          [-0.75, 2.6, 1.6],
        ],
        plates,
        chunks: [car, mast, cage, cwG],
      },
    },
  });
}

// 閘門砲台：裝在閘門上的楔形砲塔＋雙砲管＋開閘的捲揚輪（高約 3.2 m，不移動）
// 待機：感測器左右掃；預警（bossVis 1＝開閘前）：藍色警示燈轉、拉下開閘桿、壓力錶指針升高、捲揚輪轉；
// 攻擊（開閘、開火）：砲管後座
function buildGateTurret(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x60c8ff, 1.6);
  // 基座與迴轉環、警示條、爬梯
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
  hazard(torso, M, 0, 0.42, -1.62, 2.4, 0.2, 0);
  for (let k = 0; k < 3; k++) P(torso, gBox(0.04, 0.04, 0.5), M.joint, 1.64, 0.15 + k * 0.22, 0.6);
  // 砲塔：前面收斜的楔形＋防盾＋側面的裝甲板與散熱縫、螺栓
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
  bolts_d1(torso, M.joint, [-0.7, 2.13, -1.58], [0.7, 2.13, -1.58], 6, 0.03, 'z');
  for (const s of [-1, 1]) {
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
    bolts_d1(torso, M.joint, [s * 1.37, 1.08, -0.55], [s * 1.37, 1.08, 1.1], 6, 0.03, 'x');
  }
  // 往閘門的水壓管與彈藥箱
  kitCable(
    torso,
    M,
    [
      [-1.2, 1.1, 0.95],
      [-1.5, 0.95, 1.25],
      [-1.5, 0.65, 1.5],
    ],
    0.06,
  );
  CB(torso, 0.5, 0.45, 0.4, M.acc, 0.6, 1.25, 1.62, 0, 0, 0, 0.03);
  rod(torso, M.gun, [0.6, 1.5, 1.5], [0.55, 1.9, 1.1], 0.04, 4);
  // 壓力錶（右側；預警時指針升高）
  P(torso, gCyl(0.13, 0.13, 0.04, 10), M.gun, 1.42, 1.45, -0.3, 0, 0, HP);
  P(torso, gCyl(0.1, 0.1, 0.01, 10), glow(0xe8f0ff, 0.3), 1.445, 1.45, -0.3, 0, 0, HP);
  const needle = grp_d1(torso, 1.455, 1.45, -0.3);
  P(needle, gBox(0.01, 0.08, 0.015), M.acc, 0, 0.035, 0);
  // 開閘桿（左側前方）
  const lever = grp_d1(torso, -1.0, 2.4, -0.35);
  rod(lever, M.joint, [0, 0, 0], [0, 0.5, 0], 0.03, 4);
  P(lever, gSph(0.07, 6), M.acc, 0, 0.52, 0);
  P(torso, gBox(0.16, 0.1, 0.16), M.gun, -1.0, 2.4, -0.35);
  // 藍色的警示燈（後方兩角）
  const sirens = [
    beacon_d1(torso, M, -1.05, 2.4, 1.25, 0x40a0ff, 0.12),
    beacon_d1(torso, M, 1.05, 2.4, 1.25, 0x40a0ff, 0.12),
  ];
  // 砲管（各自後座、擊破時飛出去）：套筒＋砲身＋砲口制退器＋駐退筒
  const bars = [];
  for (const s of [-1, 1]) {
    const b = grp_d1(torso);
    bars.push(b);
    P(b, gCyl(0.22, 0.22, 0.55, 8), M.joint, s * 0.55, 1.9, -1.75, HP);
    P(b, gCyl(0.15, 0.17, 2.2, 8), M.gun, s * 0.55, 1.9, -2.4, HP);
    P(b, gCyl(0.175, 0.175, 0.1, 8), M.joint, s * 0.55, 1.9, -2.0, HP);
    CB(b, 0.34, 0.34, 0.42, M.joint, s * 0.55, 1.9, -3.3, 0, 0, 0, 0.04);
    P(b, gBox(0.38, 0.08, 0.1), M.sub, s * 0.55, 1.9, -3.25);
    P(b, gCyl(0.07, 0.07, 0.8, 6), M.sub, s * 0.55, 1.62, -1.85, HP);
  }
  // 感測器艙（擊破時飛出去；待機時左右掃）
  const [sensor, sensorI] = piv_d1(torso, 0.75, 2.4, -0.6);
  CB(sensorI, 0.6, 0.32, 0.5, M.sub, 0.75, 2.55, -0.7, 0, 0, 0, 0.04);
  P(sensorI, gBox(0.46, 0.12, 0.05), gl, 0.75, 2.56, -0.97);
  rod(sensorI, M.joint, [0.95, 2.7, -0.55], [0.95, 3.1, -0.5], 0.012, 4);
  // 捲揚機（擊破時飛出去）：兩側的 A 字支架、軸、捲筒、往閘門的鋼索、捲揚輪
  const winchG = grp_d1(torso);
  for (const s of [-1, 1]) {
    beam(winchG, M.acc, [s * 1.4, 1.0, 0.05], [s * 1.4, 2.95, 0.6], 0.2, 0.2, 0.03);
    beam(winchG, M.acc, [s * 1.4, 1.0, 1.2], [s * 1.4, 2.95, 0.6], 0.2, 0.2, 0.03);
    P(winchG, gCyl(0.18, 0.18, 0.16, 8), M.joint, s * 1.42, 2.9, 0.6, 0, 0, HP);
    P(winchG, gCyl(0.3, 0.3, 0.55, 8), M.rubber, s * 0.72, 2.9, 0.6, 0, 0, HP);
    rod(winchG, M.joint, [s * 0.72, 2.62, 0.75], [s * 0.72, 0.9, 1.45], 0.025, 4);
  }
  P(winchG, gCyl(0.08, 0.08, 2.9, 6), M.joint, 0, 2.9, 0.6, 0, 0, HP);
  // 捲揚輪（軸沿 X，開閘前繞 X 轉動）：輪緣＋輻條＋輪轂
  const wheelG = new THREE.Group();
  wheelG.position.set(0, 2.9, 0.6);
  winchG.add(wheelG);
  P(wheelG, new THREE.TorusGeometry(0.74, 0.07, 4, 14), M.main2, 0, 0, 0, 0, HP, 0);
  for (let i = 0; i < 3; i++) P(wheelG, gBox(0.06, 1.48, 0.08), M.main2, 0, 0, 0, (i * Math.PI) / 3);
  P(wheelG, gCyl(0.18, 0.18, 0.24, 8), M.joint, 0, 0, 0, 0, 0, HP);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(wheelG, gSph(0.06, 4), M.acc, 0, Math.cos(a) * 0.74, Math.sin(a) * 0.74);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.9, -3.4);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.06, 0.6, 0.9, M.main3, s * 1.43, 1.55, -0.35));
  const animD1 = (r, st) => {
    for (let i = 0; i < 2; i++) {
      const k = Math.max(0, (st.atk - i * 0.25) / (1 - i * 0.25));
      bars[i].position.z = k * k * 0.35;
    }
    for (const b of sirens) {
      spin_d1(b.rot, 'y', st.dt * st.warn * 10);
      b.m.emissiveIntensity = 0.2 + st.warn * 2.6 * (0.6 + 0.4 * Math.sin(st.t * 16));
    }
    lever.rotation.x = st.warn * 1.0;
    needle.rotation.x = -1 + st.warn * 2;
    sensor.rotation.y = Math.sin(st.t * 0.8) * 0.3 * (1 - st.warn);
    gl.emissiveIntensity = 1.6 + st.warn * 1.6;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'gate_turret',
    height: 3.2 * scale,
    extra: {
      wheel: wheelG,
      animD1,
      dmg: {
        smoke: [
          [0, 2.3, 0.4],
          [-0.6, 2.2, -0.9],
        ],
        plates,
        chunks: [bars[0], bars[1], sensor, winchG],
      },
    },
  });
}
// 壩頂巡邏砲車：六輪裝甲車＋長砲管的砲塔（高約 2.6 m）
// 待機：車輪依速度轉、雷達轉；預警（目標在射程內）：砲管仰起、感測器變亮；攻擊：砲管後座
function buildPatrolCart(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffb040, 1.4),
    eyeM = glow(0xffb040, 1.4);
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
  const wheels = [];
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
    bolts_d1(torso, M.joint, [s * 1.11, 1.22, -1.7], [s * 1.11, 1.22, 1.7], 9, 0.025, 'x');
    for (const z of [-1.4, 0, 1.4]) {
      const w = grp_d1(torso, s * 1.15, 0.45, z);
      wheels.push(w);
      wheel(w, M, 0, 0, 0, 0.45, 0.35);
      P(w, gBox(0.03, 0.5, 0.08), M.joint, s * 0.2, 0, 0);
      P(w, gBox(0.03, 0.08, 0.5), M.joint, s * 0.2, 0, 0);
    }
    // 收納箱、頭燈、拖鉤
    CB(torso, 0.45, 0.28, 1.0, M.sub, s * 0.72, 1.78, 1.3, 0, 0, 0, 0.04);
    P(torso, gBox(0.3, 0.12, 0.05), gl, s * 0.7, 1.05, -2.03);
    P(torso, gBox(0.12, 0.12, 0.2), M.joint, s * 0.5, 0.7, -1.9);
    // 擋泥片
    P(torso, gBox(0.32, 0.3, 0.03), M.rubber, s * 1.15, 0.55, 1.95);
  }
  // 引擎蓋的散熱縫、車頂的扶手
  for (let i = 0; i < 4; i++) P(torso, gBox(1.0, 0.03, 0.06), M.joint, 0, 1.67, 0.95 + i * 0.16);
  for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.9, 1.72, 0.3], [s * 0.9, 1.72, 1.7], 0.02, 4);
  // 前保險桿（擊破時飛出去）
  const bumper = grp_d1(torso);
  P(bumper, gBox(1.9, 0.14, 0.14), M.joint, 0, 0.75, -1.98);
  hazard(bumper, M, 0, 0.75, -2.06, 1.6, 0.1, 0);
  // 後面的備胎與油桶（擊破時飛出去）
  const stow = grp_d1(torso, 0, 1.15, 2.18);
  stow.rotation.y = HP;
  wheel(stow, M, 0, 0, 0, 0.4, 0.25);
  for (const s of [-1, 1]) CB(stow, 0.18, 0.45, 0.3, M.acc, 0.02, 0, s * 0.72, 0, 0, 0, 0.02);
  // 砲塔（擊破時飛出去）：楔形＋防盾＋長砲管＋同軸機槍、艙蓋、感測器、天線、煙幕彈發射器、雷達
  const tur = grp_d1(torso);
  P(
    tur,
    gPod([
      [-0.55, 1.1, 1.6, 2.15, 0.18, 0.05],
      [-0.2, 1.5, 1.6, 2.3, 0.2, 0.05],
      [1.15, 1.5, 1.6, 2.25, 0.15, 0.05],
    ]),
    M.main2,
  );
  CB(tur, 0.6, 0.4, 0.25, M.joint, 0, 1.98, -0.6, 0, 0, 0, 0.05);
  const [gun, gunI] = piv_d1(tur, 0, 2.0, -0.6);
  P(gunI, gCyl(0.16, 0.16, 0.5, 8), M.joint, 0, 2.0, -0.95, HP);
  P(gunI, gCyl(0.1, 0.12, 2.0, 8), M.gun, 0, 2.0, -2.0, HP);
  P(gunI, gCyl(0.13, 0.13, 0.3, 8), M.sub, 0, 2.0, -1.5, HP); // 抽煙器
  CB(gunI, 0.26, 0.22, 0.32, M.joint, 0, 2.0, -2.9, 0, 0, 0, 0.03);
  P(gunI, gCyl(0.03, 0.03, 0.6, 5), M.gun, 0.3, 1.95, -0.85, HP);
  P(tur, gCyl(0.22, 0.24, 0.08, 8), M.sub, -0.35, 2.3, 0.4);
  eye(tur, M, eyeM, 0.5, 2.1, -0.38, 0.06);
  rod(tur, M.joint, [-0.55, 2.2, 0.9], [-0.55, 3.0, 0.95], 0.012, 4);
  for (const s of [-1, 1])
    for (let k = 0; k < 3; k++)
      P(tur, gCyl(0.05, 0.05, 0.24, 6), M.gun, s * 0.78, 2.12, -0.15 + k * 0.13, 0, 0, s * 1.1);
  decal(tur, 1, 0.36, 0.36, 0.77, 1.95, 0.45, 0, HP, 0);
  P(tur, gCyl(0.03, 0.03, 0.25, 5), M.joint, 0.4, 2.42, 0.9);
  const radar = grp_d1(tur, 0.4, 2.56, 0.9);
  P(radar, gBox(0.5, 0.18, 0.04), M.sub, 0, 0, 0);
  P(radar, gBox(0.46, 0.02, 0.05), eyeM, 0, 0.06, -0.01);
  const hand = new THREE.Group();
  hand.position.set(0, 2.0, -3.0);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.05, 0.3, 1.4, M.main3, s * 1.13, 1.05, -0.7));
  const animD1 = (r, st) => {
    const roll = (-st.fwd * st.dt) / 0.45;
    for (const w of wheels) spin_d1(w, 'x', roll);
    gun.rotation.x = st.warn * 0.07 + st.atk * 0.05;
    gun.position.z = -0.6 + st.atk * st.atk * 0.3;
    spin_d1(radar, 'y', st.dt * (2 + st.warn * 4));
    eyeM.emissiveIntensity = 1.2 + st.warn * 1.8;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'patrol_cart',
    height: 2.6 * scale,
    extra: {
      animD1,
      dmg: {
        smoke: [
          [0, 1.75, 1.1],
          [0.4, 2.2, 0.2],
        ],
        plates,
        chunks: [tur, stow, bumper],
      },
    },
  });
}

// 潛航砲艇：V 字的艇身、尖艏、司令塔與潛望鏡、艏部魚雷管、甲板砲（高約 1.8 m；潛航時隱藏）
// 待機：潛望鏡轉、雷達轉、螺旋槳轉；預警（浮出水面）：魚雷管的蓋子打開、管口變亮；攻擊（發射）：管口閃光、甲板砲後座
function buildGunboat(pal, scale) {
  const { M, root, torso } = base(pal);
  const tubeM = glow(0x9aff40, 0.1),
    portM = glow(0xd0ff90, 0.8);
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
  // 甲板（另一個色槽的防滑板）＋防滑紋、繫纜樁
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
  for (let i = 0; i < 5; i++) P(torso, gBox(1.4, 0.015, 0.04), M.joint, 0, 1.09, -0.9 + i * 0.12);
  for (const s of [-1, 1])
    for (const z of [-1.6, 2.0]) {
      P(torso, gCyl(0.05, 0.06, 0.1, 6), M.gun, s * 0.7, 1.13, z);
      P(torso, gBox(0.22, 0.04, 0.05), M.gun, s * 0.7, 1.19, z);
    }
  // 艇身兩側的舷窗
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++)
      P(torso, gCyl(0.07, 0.07, 0.03, 8), portM, s * 1.16, 0.73, -0.8 + i * 0.7, 0, 0, HP);
  }
  // 司令塔（擊破時飛出去）：流線形＋發光的窗、潛望鏡、雷達桿、救生圈、螺栓
  const tower = grp_d1(torso);
  P(
    tower,
    gPod([
      [-0.25, 0.6, 1.0, 1.5, 0.1, 0],
      [0.15, 1.1, 1.0, 1.62, 0.14, 0],
      [1.2, 1.15, 1.0, 1.62, 0.14, 0],
      [1.45, 0.7, 1.0, 1.45, 0.1, 0],
    ]),
    M.main2,
  );
  P(tower, gBox(0.5, 0.12, 0.05), glow(0x9aff40, 1.4), 0, 1.33, -0.27);
  bolts_d1(tower, M.joint, [0.58, 1.56, 0.2], [0.58, 1.56, 1.1], 4, 0.025, 'x');
  P(tower, new THREE.TorusGeometry(0.17, 0.05, 4, 10), M.acc, 0, 1.25, 1.47);
  const peri = grp_d1(tower, 0.3, 2.1, 0.9);
  P(peri, gCyl(0.08, 0.1, 1.1, 6), M.joint, 0, 0, 0);
  CB(peri, 0.16, 0.14, 0.3, M.joint, 0, 0.55, -0.05, 0, 0, 0, 0.02);
  P(peri, gBox(0.1, 0.07, 0.02), M.lens, 0, 0.55, -0.21);
  rod(tower, M.joint, [-0.25, 1.6, 0.9], [-0.25, 2.1, 0.9], 0.03, 5);
  const radar = grp_d1(tower, -0.25, 2.1, 0.9);
  P(radar, gBox(0.6, 0.05, 0.1), M.sub, 0, 0, 0);
  for (const s of [-1, 1]) P(radar, gBox(0.04, 0.12, 0.04), M.joint, s * 0.28, 0.07, 0);
  // 艏部的甲板砲（擊破時飛出去；發射時後座）
  const dg = grp_d1(torso);
  P(dg, gCyl(0.32, 0.36, 0.25, 8), M.main2, 0, 1.18, -1.5);
  CB(dg, 0.4, 0.2, 0.3, M.joint, 0, 1.36, -1.6, 0, 0, 0, 0.02);
  const gb = grp_d1(dg);
  P(gb, gCyl(0.06, 0.07, 1.0, 6), M.gun, 0, 1.24, -2.0, HP);
  P(gb, gCyl(0.09, 0.09, 0.12, 6), M.joint, 0, 1.24, -2.48, HP);
  // 魚雷管（擊破時飛出去）：兩側的管子、管口的發光環、會打開的蓋子
  const bow = grp_d1(torso);
  const doors = [];
  for (const s of [-1, 1]) {
    P(bow, gCyl(0.16, 0.16, 1.2, 8), M.gun, s * 0.6, 0.55, -2.35, HP);
    P(bow, gCyl(0.19, 0.19, 0.08, 8), M.joint, s * 0.6, 0.55, -2.95, HP);
    P(bow, new THREE.TorusGeometry(0.15, 0.025, 4, 10), tubeM, s * 0.6, 0.55, -2.995);
    const d = grp_d1(bow, s * 0.79, 0.55, -3.0);
    doors.push(d);
    P(d, gCyl(0.18, 0.18, 0.04, 8), M.main2, -s * 0.19, 0, -0.01, HP);
  }
  // 艉部（擊破時飛出去）：舵、螺旋槳、天線
  const stern = grp_d1(torso);
  side(
    stern,
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
  rod(stern, M.joint, [0.4, 1.06, 2.25], [0.45, 2.1, 2.3], 0.012, 4);
  const prop = grp_d1(stern, 0, 0.55, 2.72);
  P(prop, gCyl(0.07, 0.1, 0.2, 6), M.joint, 0, 0, 0, HP);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2;
    P(prop, gBox(0.08, 0.3, 0.02), M.acc, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0, 0.4, 0, a - HP);
  }
  // 欄杆
  for (const z of [-0.8, 1.6, 2.1])
    for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.8, 1.06, z], [s * 0.8, 1.4, z], 0.02, 4);
  for (const s of [-1, 1]) rod(torso, M.joint, [s * 0.8, 1.4, 1.6], [s * 0.8, 1.4, 2.1], 0.02, 4);
  const hand = new THREE.Group();
  hand.position.set(0, 0.6, -3.2);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(tower, 0.05, 0.36, 0.7, M.main3, s * 0.6, 1.28, 0.7));
  const animD1 = (r, st) => {
    peri.rotation.y = Math.sin(st.t * 0.5) * 1.2;
    spin_d1(radar, 'y', st.dt * 2.5);
    spin_d1(prop, 'z', st.dt * (5 + Math.abs(st.fwd) * 2));
    for (let i = 0; i < 2; i++) doors[i].rotation.y = -(i ? 1 : -1) * st.warn * 1.4;
    tubeM.emissiveIntensity = 0.1 + st.warn * 1.4 + st.atk * 2.5;
    gb.position.z = st.atk * st.atk * 0.2;
    portM.emissiveIntensity = 0.7 + Math.sin(st.t * 1.5) * 0.15;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'gunboat',
    height: 1.8 * scale,
    extra: {
      animD1,
      dmg: {
        smoke: [
          [0, 1.5, 0.5],
          [0, 1.1, 2.2],
        ],
        plates,
        chunks: [tower, dg, bow, stern],
      },
    },
  });
}
// 汙染噴射 MT：履帶底盤＋背上的汙染液槽＋前方的噴嘴臂（高約 3.2 m）
// 待機：噴嘴臂微微擺動、液位窗的液面晃動；預警（bossVis 1＝快要噴）：噴嘴臂抬起、噴口與通氣閥變亮；攻擊（噴出）：噴口閃光、臂往後彈
function buildSprayer(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x9aff40, 1.8),
    lvM = glow(0x9aff40, 1.6),
    nozM = glow(0xb8ff60, 0.1);
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
  // 履帶的擋泥板、前方的警示條、側面的螺栓、排氣管
  for (const s of [-1, 1]) {
    top(
      torso,
      M.main3,
      [
        [s * 0.7, -1.45],
        [s * 1.45, -1.45],
        [s * 1.45, 1.45],
        [s * 0.7, 1.45],
      ],
      0.05,
      0.95,
    );
    bolts_d1(torso, M.joint, [s * 0.92, 1.0, -0.8], [s * 0.92, 1.0, 1.1], 6, 0.028, 'x');
  }
  hazard(torso, M, 0, 1.05, -1.12, 1.5, 0.16, 0);
  rod(torso, M.gun, [-0.85, 1.6, 1.15], [-0.85, 2.3, 1.2], 0.05, 6);
  P(torso, gCyl(0.07, 0.07, 0.06, 6), M.joint, -0.85, 2.32, 1.2);
  // 液槽（擊破時飛出去）：圓筒＋兩端的蓋＋箍＋鞍座、頂部的通氣閥（發光）、側面的液位窗、注入口、爬梯
  const tank = grp_d1(torso);
  P(tank, gCyl(0.75, 0.75, 2.2, 10), M.acc, 0, 2.4, 0.6, HP);
  P(tank, gCyl(0.75, 0.55, 0.22, 10), M.acc, 0, 2.4, 1.81, HP);
  P(tank, gCyl(0.55, 0.75, 0.22, 10), M.acc, 0, 2.4, -0.61, HP);
  for (const z of [-0.2, 1.4]) {
    P(tank, gCyl(0.8, 0.8, 0.15, 10), M.main2, 0, 2.4, z, HP);
    CB(tank, 1.4, 0.3, 0.25, M.joint, 0, 1.82, z, 0, 0, 0, 0.04);
  }
  P(tank, gCyl(0.16, 0.2, 0.18, 8), M.joint, 0, 3.12, 0.6);
  P(tank, gSph(0.2, 8), gl, 0, 3.24, 0.6);
  P(tank, gBox(0.05, 0.12, 1.2), lvM, 0.76, 2.4, 0.6);
  P(tank, gBox(0.04, 0.2, 1.3), M.joint, 0.74, 2.4, 0.6);
  decal(tank, 0, 0.5, 0.5, -0.77, 2.4, 0.6, 0, -HP, 0);
  // 注入口與一圈螺栓、洩壓閥
  P(tank, gCyl(0.18, 0.18, 0.1, 10), M.sub, 0, 3.14, 1.25);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(tank, gCyl(0.02, 0.02, 0.04, 4), M.joint, Math.cos(a) * 0.15, 3.2, 1.25 + Math.sin(a) * 0.15);
  }
  P(tank, gCyl(0.06, 0.06, 0.2, 6), M.gun, 0.35, 3.05, 0.05);
  P(tank, gCyl(0.09, 0.09, 0.04, 6), M.acc, 0.35, 3.16, 0.05);
  for (const x of [-0.25, 0.25]) P(tank, gBox(0.04, 1.3, 0.04), M.joint, x, 2.35, 2.0);
  for (let k = 0; k < 5; k++) P(tank, gBox(0.5, 0.03, 0.03), M.joint, 0, 1.85 + k * 0.25, 2.0);
  // 噴嘴臂（繞肩軸轉）：肩軸＋臂＋液壓桿＋噴頭，液槽接到噴頭的軟管
  const [arm, armI] = piv_d1(torso, 0.5, 1.8, -0.55);
  P(armI, gCyl(0.2, 0.2, 0.4, 8), M.joint, 0.5, 1.8, -0.55, 0, 0, HP);
  CB(armI, 0.26, 0.26, 1.6, M.gun, 0.5, 1.8, -1.35, 0, 0, 0, 0.04);
  bolts_d1(armI, M.joint, [0.64, 1.8, -0.75], [0.64, 1.8, -1.95], 4, 0.025, 'x');
  piston(armI, M, [0.5, 1.35, -0.7], [0.5, 1.62, -1.85], 0.045);
  P(armI, gCyl(0.12, 0.25, 0.5, 8), M.gun, 0.5, 1.8, -2.5, HP);
  P(armI, gCyl(0.27, 0.27, 0.06, 8), M.joint, 0.5, 1.8, -2.3, HP);
  P(armI, gCyl(0.11, 0.11, 0.02, 8), nozM, 0.5, 1.8, -2.76, HP);
  for (const s of [-1, 1]) P(armI, gBox(0.04, 0.12, 0.2), M.joint, 0.5 + s * 0.2, 1.8, -2.5);
  kitCable(
    armI,
    M,
    [
      [0.3, 1.95, -0.6],
      [0.28, 2.05, -1.3],
      [0.38, 1.98, -2.15],
    ],
    0.045,
  );
  // 感測器艙（擊破時飛出去）
  const sensor = grp_d1(torso);
  CB(sensor, 0.4, 0.25, 0.3, M.sub, -0.5, 1.95, -0.7, 0, 0, 0, 0.04);
  eye(sensor, M, gl, -0.5, 1.95, -0.88, 0.06);
  rod(sensor, M.joint, [-0.62, 2.07, -0.6], [-0.66, 2.55, -0.55], 0.012, 4);
  const hand = new THREE.Group();
  hand.position.set(0.5, 1.8, -2.8);
  torso.add(hand);
  const plates = [];
  for (const s of [-1, 1]) plates.push(slab_d1(torso, 0.05, 0.55, 1.1, M.main3, s * 0.93, 1.35, 0.2));
  const animD1 = (r, st) => {
    arm.rotation.x = Math.sin(st.t * 1.3) * 0.03 + st.warn * 0.28 - st.atk * 0.12;
    arm.rotation.y = Math.sin(st.t * 0.6) * 0.05 * (1 - st.warn);
    nozM.emissiveIntensity = 0.1 + st.warn * 2 + st.atk * 3;
    gl.emissiveIntensity = 1.8 + st.warn * 1.5 * (0.5 + 0.5 * Math.sin(st.t * 12));
    lvM.emissiveIntensity = 1.5 + Math.sin(st.t * 2) * 0.3;
  };
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'sprayer',
    height: 3.2 * scale,
    extra: {
      animD1,
      dmg: {
        smoke: [
          [0, 3.1, 0.6],
          [-0.5, 2.0, -0.7],
        ],
        plates,
        chunks: [arm, tank, sensor],
      },
    },
  });
}

// ---------- 第 3～6 章（冰原、技研都市、Grid 086、舊宇宙港、洋上都市、高空軌道）的專屬敵人 ----------
// 共用：動作旗標、樞紐群組、可脫落的裝甲板、螺栓、受損資料。
// 房主／單機把行為狀態寫進 bossVis 的高位（entities/mech-foe-d2.js 的 foeBits_d2），客機從快照讀；
// 模型的 anim_d2(st) 依 st＝{ t, dt, vis（bossVis）, spd 水平速度, vy 垂直速度, air 離地高度, dead, remote }
// 擺出待機／預警／攻擊的動作與預警發光（房主與客機都跑）。
// rig.dmg＝{ smoke 冒煙點（rig.group 的座標、縮放前）, plates 會脫落的裝甲板（獨立網格）, chunks 擊破時拆開的群組（torso 的子群組）}。
export const FB_D2 = { fire: 16, warn: 32, atk: 64 };
const to_d2 = (a, b, dt, r = 8) => a + (b - a) * Math.min(1, dt * r);
const wave_d2 = (t, f, p = 0) => 0.5 + 0.5 * Math.sin(t * f + p);
function grp_d2(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// 樞紐：回傳 [樞紐群組（位置＝轉軸）, 內層（座標與 parent 相同，零件照絕對座標擺）]
function piv_d2(parent, x, y, z) {
  const g = grp_d2(parent, x, y, z);
  return [g, grp_d2(g, -x, -y, -z)];
}
// 可脫落的裝甲板：獨立網格（不經過 prims，bakeAll 不合併；pg 是沒有 prims 的群組）
function plate_d2(pg, m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(gBox(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  pg.add(mesh);
  return mesh;
}
// 螺栓：ax＝螺栓軸向（'y' 朝上下、'z' 朝前後、'x' 朝左右）
function bolts_d2(n, m, pts, r = 0.035, ax = 'y') {
  for (const [x, y, z] of pts)
    P(n, gCyl(r, r, 0.04, 6), m, x, y, z, ax === 'z' ? HP : 0, 0, ax === 'x' ? HP : 0);
}
// 一圈朝上的螺栓（水平圓）
function boltRing_d2(n, m, x, y, z, R, k, r = 0.035, a0 = 0) {
  const pts = [];
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / k) * PI * 2;
    pts.push([x + Math.cos(a) * R, y, z + Math.sin(a) * R]);
  }
  bolts_d2(n, m, pts, r);
}
// 一排螺栓（a → b 之間 k 顆）
function boltRow_d2(n, m, a, b, k, r = 0.03, ax = 'y') {
  const pts = [];
  for (let i = 0; i < k; i++) {
    const u = k === 1 ? 0.5 : i / (k - 1);
    pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
  }
  bolts_d2(n, m, pts, r, ax);
}
// 砲口閃光、噴焰：加色、不寫深度（不描邊、不算進外框與三角形）
const flash_d2 = (color, opacity = 0.9) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
// 發光強度：死掉時熄滅
const lit_d2 = (mat, k, dead) => (mat.emissiveIntensity = dead ? 0.05 : k);

// 雪中潛伏 MT：伏低的四腳機身＋雪地偽裝布＋雙管機砲（高約 2.2 m；埋在雪裡時隱藏）
// 動作：埋著時蹲低、現身時撐起機身（預警：感測條閃爍、機砲抬起）、移動時四腳交替、開火時雙管交互後座與砲口閃光
function buildLurker(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xff6040, 1.4),
    heat = glow(0xff8050, 0.6),
    fl = flash_d2(0xffc070);
  const hull = grp_d2(torso),
    gunC = grp_d2(torso),
    legF = grp_d2(torso),
    legR = grp_d2(torso);
  const pg = grp_d2(hull);
  // 腳：髖關節＋往上的大腿（液壓桿）＋膝甲＋往下的小腿＋三爪腳掌
  const legs = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const hx = sx * 0.88,
        hz = sz * 0.9;
      const [g, a] = piv_d2(sz < 0 ? legF : legR, hx, 1.2, hz);
      legs.push({ g, sx, p: sx * sz > 0 ? 0 : PI });
      P(a, gCyl(0.16, 0.16, 0.3, 6), M.joint, hx, 1.2, hz, 0, 0, HP);
      beam(a, M.main2, [sx * 0.95, 1.22, sz * 0.92], [sx * 1.34, 1.42, sz * 1.22], 0.24, 0.22);
      P(a, gCyl(0.13, 0.13, 0.24, 6), M.joint, sx * 1.36, 1.42, sz * 1.22, 0, 0, HP);
      CB(a, 0.2, 0.26, 0.3, M.main2, sx * 1.42, 1.48, sz * 1.22);
      beam(a, M.joint, [sx * 1.36, 1.4, sz * 1.22], [sx * 1.3, 0.12, sz * 1.32], 0.16, 0.18);
      piston(a, M, [sx * 1.1, 1.18, sz * 1.0], [sx * 1.34, 0.6, sz * 1.28], 0.03);
      P(a, gBox(0.17, 0.5, 0.05), M.sub, sx * 1.33, 0.75, sz * 1.38);
      P(a, gCyl(0.2, 0.25, 0.1, 6), M.sub, sx * 1.3, 0.05, sz * 1.32);
      for (let i = 0; i < 3; i++) {
        const ang = (i / 3) * PI * 2 + sz * 0.5;
        P(
          a,
          gBox(0.07, 0.05, 0.22),
          M.joint,
          sx * 1.3 + Math.sin(ang) * 0.2,
          0.03,
          sz * 1.32 + Math.cos(ang) * 0.2,
          0,
          ang,
        );
      }
    }
  // 機身：低矮的楔形＋腹甲＋側面的接縫與螺栓
  P(
    hull,
    gPod([
      [-1.3, 1.5, 1.0, 1.65, 0.15, 0.2],
      [-0.9, 2.0, 0.95, 1.85, 0.2, 0.2],
      [1.3, 1.9, 0.98, 1.8, 0.18, 0.2],
    ]),
    M.main,
  );
  P(
    hull,
    gPod([
      [-1.0, 1.5, 0.88, 1.0, 0.04, 0.06],
      [1.1, 1.5, 0.9, 1.0, 0.04, 0.06],
    ]),
    M.sub,
  );
  for (const s of [-1, 1]) {
    for (const z of [-0.45, 0.35]) P(hull, gBox(0.03, 0.6, 0.03), M.joint, s * 1.0, 1.38, z);
    boltRow_d2(hull, M.gun, [s * 1.0, 1.66, -0.7], [s * 0.99, 1.66, 1.1], 5, 0.025, 'x');
    // 排氣管（後方）
    P(hull, gCyl(0.07, 0.08, 0.4, 6), M.gun, s * 0.62, 1.72, 1.2, 0.4);
  }
  // 後方的熱源排出口：散熱縫＋發光（埋在雪裡時冒出白煙的地方）
  P(hull, gBox(1.1, 0.34, 0.03), heat, 0, 1.46, 1.31);
  slats(hull, M.joint, 0, 1.6, 1.33, 1.2, 4, 0.08);
  hazard(hull, M, 0, 1.08, -1.32, 0.8, 0.1);
  decal(hull, 1, 0.42, 0.42, -1.005, 1.38, -0.05, 0, -HP, 0);
  // 偽裝布：不規則的頂面＋兩側垂下的布（綁帶）
  top(
    hull,
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
  for (const s of [-1, 1]) {
    side(
      hull,
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
    for (const z of [-0.8, 0.6]) P(hull, gBox(0.05, 0.3, 0.08), M.joint, s * 1.27, 1.78, z);
  }
  // 可脫落的側裙甲與正面的斜甲
  const plates = [
    plate_d2(pg, M.main2, 0.06, 0.38, 1.1, -1.03, 1.2, 0.1),
    plate_d2(pg, M.main2, 0.06, 0.38, 1.1, 1.03, 1.2, 0.1),
    plate_d2(pg, M.main2, 1.1, 0.06, 0.3, 0, 1.62, -1.25, -0.5),
  ];
  // 機砲：機匣（樞紐，現身時抬起）＋雙管（各自後座）＋彈藥箱＋上方的感測器條
  const [gun, ga] = piv_d2(gunC, 0, 1.42, -1.2);
  CB(ga, 0.9, 0.34, 0.5, M.sub, 0, 1.42, -1.2, 0, 0, 0, 0.05);
  CB(ga, 0.4, 0.3, 0.4, M.acc, 0.6, 1.25, -0.9, 0, 0, 0, 0.04);
  kitCable(
    ga,
    M,
    [
      [0.5, 1.3, -1.05],
      [0.3, 1.3, -1.2],
    ],
    0.04,
  );
  CB(ga, 0.7, 0.18, 0.2, M.joint, 0, 1.68, -1.3, 0, 0, 0, 0.03);
  P(ga, gBox(0.6, 0.08, 0.05), gl, 0, 1.68, -1.41);
  for (const s of [-1, 1]) eye(ga, M, gl, s * 0.38, 1.66, -1.38, 0.035);
  const brl = [];
  for (const s of [-1, 1]) {
    const b = grp_d2(ga);
    P(b, gCyl(0.06, 0.07, 1.3, 6), M.gun, s * 0.35, 1.45, -1.85, HP);
    P(b, gCyl(0.11, 0.11, 0.55, 6), M.gun, s * 0.35, 1.45, -1.62, HP);
    for (const z of [-2.0, -2.15, -2.3]) P(b, gCyl(0.085, 0.085, 0.03, 6), M.joint, s * 0.35, 1.45, z, HP);
    P(b, gCyl(0.09, 0.09, 0.08, 6), M.joint, s * 0.35, 1.45, -2.48, HP);
    const f = grp_d2(b);
    P(f, gCyl(0.0, 0.16, 0.34, 6), fl, s * 0.35, 1.45, -2.68, HP);
    f.visible = false;
    brl.push({ b, f });
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.6);
  torso.add(hand);
  finish(root, scale);
  const chunks = [hull, gunC, legF, legR];
  let crouch = 0,
    ph = 0,
    up = 1;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    if (st.vis & 1) {
      crouch = 1;
      up = 0;
    } else crouch = to_d2(crouch, 0, dt, 3);
    up = Math.min(1, up + dt * 0.7);
    for (const c of chunks) c.position.y = -0.45 * crouch;
    const mv = Math.min(1, st.spd / 4);
    ph += dt * (2 + st.spd * 1.4);
    for (const L of legs) {
      L.g.rotation.x = Math.sin(ph + L.p) * 0.28 * mv;
      L.g.rotation.z = L.sx * 0.35 * crouch;
    }
    const warn = st.vis & FB_D2.warn || up < 1;
    const fire = st.vis & FB_D2.fire && !dead;
    gun.rotation.x = to_d2(gun.rotation.x, warn ? 0.14 : 0, dt, 5);
    lit_d2(gl, warn ? 1.4 + 3 * wave_d2(t, 18) : fire ? 3 : 1.4, dead);
    lit_d2(heat, 0.5 + 0.4 * wave_d2(t, 2), dead);
    brl.forEach((o, i) => {
      const k = fire ? Math.abs(Math.sin(t * 28 + i * HP)) : 0;
      o.b.position.z = to_d2(o.b.position.z, k * 0.14, dt, 30);
      o.f.visible = !!(fire && k > 0.6);
    });
  };
  return rig(root, torso, M, {
    hand,
    type: 'lurker',
    height: 2.2 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.9, 0.6],
          [0.6, 1.7, -0.8],
          [-0.7, 1.75, 1.1],
        ],
        plates,
        chunks,
      },
    },
  });
}
// 冰面滑行砲車：雪橇板＋後方的涵道推進風扇＋機砲塔（高約 2.4 m）
// 動作：風扇轉（extra.fan；房主由行為端轉、客機在這裡轉）、滑行時車身在避震上抖動、涵道內的噴流依速度發亮、
// 方向舵擺動；開火時砲管後座、砲口閃光、感測眼變亮
function buildSkater(pal, scale) {
  const { M, root, torso } = base(pal);
  const eyeM = glow(0xffa060, 1.6),
    jet = glow(0xffa060, 0.4),
    fl = flash_d2(0xffd080);
  const skis = grp_d2(torso),
    hull = grp_d2(torso),
    duct = grp_d2(torso),
    turC = grp_d2(torso);
  const pg = grp_d2(hull);
  for (const s of [-1, 1]) {
    // 前端翹起的雪橇板＋底部的刃＋避震支柱
    side(
      skis,
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
    P(skis, gBox(0.06, 0.03, 3.5), M.gun, s * 1.0, 0.0, 0.25);
    P(skis, gBox(0.34, 0.08, 0.12), M.sub, s * 1.0, 0.24, -1.55);
    boltRow_d2(skis, M.gun, [s * 1.16, 0.1, -1.2], [s * 1.16, 0.1, 1.7], 5, 0.025, 'x');
    for (const z of [-1.0, 1.2]) {
      beam(skis, M.sub, [s * 1.0, 0.2, z], [s * 0.82, 0.55, z * 0.9], 0.12, 0.14, 0.02);
      piston(skis, M, [s * 1.0, 0.2, z + 0.25], [s * 0.82, 0.62, z * 0.9 + 0.3], 0.035);
      P(skis, gCyl(0.08, 0.08, 0.36, 6), M.joint, s * 1.0, 0.22, z, 0, 0, HP);
    }
  }
  // 車身：滑行艇形＋頭燈＋側面的散熱縫、接縫、螺栓、編號
  P(
    hull,
    gPod([
      [-1.5, 1.3, 0.4, 0.85, 0.25, 0.15],
      [-0.9, 1.9, 0.35, 1.15, 0.3, 0.15],
      [1.7, 1.9, 0.35, 1.15, 0.25, 0.15],
    ]),
    M.main,
  );
  P(hull, gBox(0.6, 0.12, 0.05), eyeM, 0, 0.68, -1.52);
  for (const s of [-1, 1]) {
    slats(hull, M.joint, s * 0.96, 0.95, 0.6, 0.6, 3, 0.1, HP);
    P(hull, gCyl(0.08, 0.1, 0.06, 6), M.joint, s * 0.5, 0.58, -1.5, HP);
    P(hull, gCyl(0.06, 0.06, 0.03, 6), eyeM, s * 0.5, 0.58, -1.53, HP);
    P(hull, gBox(0.03, 0.55, 0.03), M.joint, s * 0.955, 0.75, -0.3);
    boltRow_d2(hull, M.gun, [s * 0.95, 1.08, -0.7], [s * 0.95, 1.08, 1.4], 6, 0.022, 'x');
    rod(hull, M.joint, [s * 0.5, 1.2, 1.2], [s * 0.5, 1.2, 1.55], 0.025, 4);
  }
  hazard(hull, M, 0, 0.5, -1.53, 0.9, 0.08);
  decal(hull, 1, 0.38, 0.38, -0.958, 0.78, 0.25, 0, -HP, 0);
  const plates = [
    plate_d2(pg, M.main2, 0.05, 0.36, 1.0, -0.98, 0.62, 0.9),
    plate_d2(pg, M.main2, 0.05, 0.36, 1.0, 0.98, 0.62, 0.9),
  ];
  // 涵道（固定）與支架、護網、整流葉片、內圈的噴流；風扇在中間轉；後方的方向舵
  P(duct, new THREE.TorusGeometry(0.86, 0.09, 4, 14), M.main2, 0, 1.5, 1.7);
  P(duct, new THREE.TorusGeometry(0.78, 0.03, 3, 14), jet, 0, 1.5, 1.82);
  for (const s of [-1, 1]) beam(duct, M.sub, [s * 0.5, 1.05, 1.3], [s * 0.62, 0.95, 1.72], 0.14, 0.14, 0.02);
  for (let i = 0; i < 3; i++) P(duct, gBox(1.6, 0.03, 0.03), M.joint, 0, 1.1 + i * 0.4, 1.82);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + HP;
    P(duct, gBox(0.05, 0.75, 0.04), M.sub, Math.cos(a) * 0.4, 1.5 + Math.sin(a) * 0.4, 1.62, 0, 0, a - HP);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    P(duct, gBox(0.12, 0.04, 0.2), M.acc, Math.cos(a) * 0.86, 1.5 + Math.sin(a) * 0.86, 1.7, 0, 0, a);
  }
  const [rud, ra] = piv_d2(duct, 0, 1.5, 1.95);
  for (const s of [-1, 1]) P(ra, gBox(0.04, 1.1, 0.26), M.main3, s * 0.3, 1.5, 2.0);
  const fan = new THREE.Group();
  fan.position.set(0, 1.5, 1.7);
  duct.add(fan);
  P(fan, gCyl(0.18, 0.2, 0.3, 8), M.joint, 0, 0, 0, HP);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    PB(fan, gBox(0.66, 0.2, 0.03), M.sub, [c * 0.48, s * 0.48, 0], [c, s, 0], [-s, c, 0.45]);
  }
  // 砲塔（樞紐在砲塔中心，開火時微微後仰）：機砲＋散熱套＋彈鼓＋瞄準器＋天線
  const [tur, ta] = piv_d2(turC, 0, 1.3, -0.5);
  P(
    ta,
    gPod([
      [-1.0, 0.7, 1.15, 1.62, 0.12, 0.04],
      [-0.6, 1.0, 1.15, 1.8, 0.15, 0.05],
      [0.0, 1.0, 1.15, 1.8, 0.15, 0.05],
    ]),
    M.main2,
  );
  P(ta, gBox(1.02, 0.03, 0.62), M.joint, 0, 1.6, -0.3);
  CB(ta, 0.24, 0.3, 0.5, M.acc, -0.6, 1.45, -0.35);
  CB(ta, 0.16, 0.16, 0.3, M.sub, 0.32, 1.86, -0.6);
  eye(ta, M, eyeM, 0.32, 1.86, -0.76, 0.05);
  eye(ta, M, eyeM, 0.32, 1.62, -0.98, 0.05);
  rod(ta, M.joint, [-0.35, 1.8, -0.1], [-0.42, 2.35, 0.05], 0.012, 4);
  const brl = grp_d2(ta);
  P(brl, gCyl(0.08, 0.1, 1.2, 8), M.gun, 0, 1.55, -1.55, HP);
  P(brl, gCyl(0.13, 0.13, 0.4, 8), M.gun, 0, 1.55, -1.15, HP);
  for (const z of [-1.45, -1.6, -1.75]) P(brl, gCyl(0.1, 0.1, 0.03, 8), M.joint, 0, 1.55, z, HP);
  P(brl, gCyl(0.11, 0.11, 0.1, 8), M.joint, 0, 1.55, -2.15, HP);
  const flash = grp_d2(brl);
  P(flash, gCyl(0.0, 0.22, 0.45, 6), fl, 0, 1.55, -2.42, HP);
  flash.visible = false;
  const hand = new THREE.Group();
  hand.position.set(0, 1.55, -2.3);
  torso.add(hand);
  finish(root, scale);
  const chunks = [skis, hull, duct, turC];
  let fireK = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const v = Math.min(1, st.spd / 14);
    if (st.remote && !dead) fan.rotation.z += dt * (8 + 20 * v);
    const bob = 0.025 * v * Math.sin(t * 23) + 0.012 * Math.sin(t * 2.1);
    for (const c of [hull, duct, turC]) c.position.y = bob;
    rud.rotation.y = 0.25 * Math.sin(t * 0.9) * v;
    lit_d2(jet, 0.3 + 2.4 * v, dead);
    const fire = st.vis & FB_D2.fire && !dead;
    fireK = to_d2(fireK, fire ? 1 : 0, dt, fire ? 12 : 3);
    brl.position.z = fire ? 0.1 * Math.abs(Math.sin(t * 34)) : to_d2(brl.position.z, 0, dt, 10);
    flash.visible = !!(fire && Math.sin(t * 34) > 0.3);
    tur.rotation.x = 0.04 * fireK;
    lit_d2(eyeM, 1.6 + 2.4 * fireK, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'skater',
    height: 2.4 * scale,
    extra: {
      fan,
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.3, 1.2],
          [0.4, 1.2, -0.6],
          [0, 1.8, 1.7],
        ],
        plates,
        chunks,
      },
    },
  });
}

// 實驗體：發光的肉塊＋爪腳，身上套著拘束環、背著輸液罐（小型高約 1.3 m；融合實驗體 big 高約 3.6 m、更多瘤、爪與背刺）
// 動作：肉塊呼吸起伏、血管脈動；移動時爪腳交互爬行；貼近目標時下顎張開、血管急閃（預警），咬下時下顎闔上（攻擊）
function buildBlob(pal, scale, big = false) {
  const { M, root, torso } = base(pal);
  const k = big ? 2.6 : 1;
  const gl = glow(0xff3a30, 2.2),
    vein = glow(0xff3a30, 1.2),
    fluid = glow(0xff6050, 1.2);
  const body = grp_d2(torso),
    legA = grp_d2(torso),
    legB = grp_d2(torso),
    tankC = grp_d2(torso),
    head = grp_d2(torso);
  const pg = grp_d2(body);
  // 肉塊（樞紐在中心，呼吸時縮放）：本體＋瘤＋血管
  const [flesh, fa] = piv_d2(body, 0, 0.75 * k, 0);
  P(fa, gSph(0.7 * k, big ? 12 : 10), M.main, 0, 0.75 * k, 0);
  const nt = big ? 7 : 3;
  for (let i = 0; i < nt; i++) {
    let a = i * 2.39996 + 1.2;
    if (Math.sin(a) < -0.55) a += 1.3; // 正面留給眼睛與顎
    P(
      fa,
      gSph((0.25 + (i % 3) * 0.08) * k, 8),
      M.main3,
      Math.cos(a) * 0.5 * k,
      (0.9 + (i % 2) * 0.3) * k,
      Math.sin(a) * 0.5 * k,
    );
  }
  const nv = big ? 8 : 4;
  for (let i = 0; i < nv; i++) {
    const a = i * 1.9 + 0.7,
      e1 = 0.15 + (i % 3) * 0.25,
      e2 = e1 + 0.45;
    const pt = (aa, e) => [
      Math.cos(aa) * Math.cos(e) * 0.7 * k,
      (0.75 + Math.sin(e) * 0.7) * k,
      Math.sin(aa) * Math.cos(e) * 0.7 * k,
    ];
    rod(fa, vein, pt(a, e1), pt(a + 0.35, e2), 0.022 * k, 4);
    rod(fa, vein, pt(a + 0.35, e2), pt(a + 0.1, e2 + 0.35), 0.016 * k, 4);
  }
  if (big)
    // 背刺：融合時從背上長出的骨質尖刺
    for (let i = 0; i < 5; i++) {
      const z = (-0.3 + i * 0.22) * k,
        x = (i % 2 ? 0.12 : -0.12) * k;
      PB(
        fa,
        gCyl(0, 0.07 * k, 0.45 * k, 5),
        M.sub,
        [x, (1.35 + 0.08 * Math.cos(i)) * k, z],
        [1, 0, 0],
        [x * 2, 1, z * 0.6],
      );
    }
  // 拘束環：斜套在身上的兩圈金屬環＋鎖扣＋螺栓、識別牌、斷掉的鎖鏈
  P(body, gCyl(0.74 * k, 0.74 * k, 0.07 * k, 12), M.joint, 0, 0.72 * k, 0, 0.35, 0, 0.2);
  P(body, gCyl(0.72 * k, 0.72 * k, 0.07 * k, 12), M.joint, 0, 0.82 * k, 0, -0.3, 0, -0.35);
  for (const s of [-1, 1]) {
    CB(
      body,
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
    bolts_d2(body, M.gun, [[s * 0.79 * k, 0.66 * k + s * 0.14 * k, 0]], 0.025 * k, 'x');
  }
  P(body, gBox(0.2 * k, 0.12 * k, 0.02 * k), M.acc, 0.3 * k, 0.5 * k, -0.62 * k, 0, 0.45, 0.3);
  for (let i = 0; i < 3; i++)
    P(
      body,
      new THREE.TorusGeometry(0.035 * k, 0.012 * k, 3, 6),
      M.joint,
      -0.7 * k,
      (0.55 - i * 0.07) * k,
      0.1 * k,
      0,
      i % 2 ? HP : 0,
    );
  const plates = [
    plate_d2(pg, M.main2, 0.5 * k, 0.3 * k, 0.05 * k, 0, 0.78 * k, 0.66 * k, -0.3),
    plate_d2(pg, M.main2, 0.06 * k, 0.26 * k, 0.34 * k, 0.69 * k, 0.48 * k, -0.15 * k, 0, 0, -0.5),
  ];
  if (big) {
    // 融合時嵌進肉裡的其他個體的拘束環碎片
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + 0.4;
      P(
        body,
        new THREE.TorusGeometry(0.42 * k, 0.03 * k, 3, 8, 2.2),
        M.joint,
        Math.cos(a) * 0.45 * k,
        (1.0 + (i % 2) * 0.2) * k,
        Math.sin(a) * 0.45 * k,
        0.4 * i,
        a,
        0.8,
      );
    }
    plates.push(
      plate_d2(pg, M.main2, 0.4 * k, 0.25 * k, 0.05 * k, -0.6 * k, 0.9 * k, -0.2 * k, 0, HP + 0.4, 0.2),
    );
  }
  // 爪腳：每隻一個樞紐（髖），內層的 +X 朝外；生物的大腿＋金屬的膝套、小腿與爪尖
  const nl = big ? 6 : 4;
  const legs = [];
  for (let i = 0; i < nl; i++) {
    const a = (i / nl) * PI * 2 + 0.4;
    const c = Math.cos(a),
      s = Math.sin(a);
    const g = grp_d2(i % 2 ? legB : legA, c * 0.45 * k, 0.6 * k, s * 0.45 * k);
    g.rotation.y = -a;
    legs.push({ g, a, p: i % 2 ? PI : 0 });
    beam(g, M.main3, [0, 0, 0], [0.35 * k, -0.15 * k, 0], 0.16 * k, 0.16 * k, 0.03 * k);
    P(g, gCyl(0.1 * k, 0.1 * k, 0.12 * k, 6), M.joint, 0.35 * k, -0.15 * k, 0);
    beam(g, M.joint, [0.35 * k, -0.15 * k, 0], [0.5 * k, -0.6 * k, 0], 0.1 * k, 0.12 * k, 0.02 * k);
    P(g, gCyl(0.06 * k, 0.06 * k, 0.03 * k, 6), M.joint, 0.42 * k, -0.37 * k, 0, 0, 0, 0.3);
    PB(g, gCyl(0, 0.05 * k, 0.12 * k, 5), M.joint, [0.52 * k, -0.53 * k, 0], [1, 0, 0], [0.4, -1, 0]);
    if (big) PB(g, gCyl(0, 0.04 * k, 0.18 * k, 5), M.sub, [0.2 * k, -0.02 * k, 0], [0, 0, 1], [0.6, 1, 0]);
  }
  // 背上的輸液罐（發光的液體）與插進身體的管子
  P(tankC, gCyl(0.16 * k, 0.16 * k, 0.5 * k, 8), M.sub, 0, 1.3 * k, 0.45 * k, 0.5);
  P(tankC, gCyl(0.12 * k, 0.12 * k, 0.4 * k, 8), fluid, 0, 1.3 * k, 0.45 * k, 0.5);
  for (const e of [-1, 1])
    P(
      tankC,
      gCyl(0.17 * k, 0.17 * k, 0.04 * k, 8),
      M.joint,
      0,
      (1.3 + e * 0.22 * Math.cos(0.5)) * k,
      (0.45 - e * 0.22 * Math.sin(0.5)) * k,
      0.5,
    );
  kitCable(
    tankC,
    M,
    [
      [0.1 * k, 1.1 * k, 0.6 * k],
      [0.35 * k, 1.05 * k, 0.55 * k],
      [0.45 * k, 0.9 * k, 0.35 * k],
    ],
    0.03 * k,
  );
  kitCable(
    tankC,
    M,
    [
      [-0.1 * k, 1.1 * k, 0.6 * k],
      [-0.3 * k, 1.15 * k, 0.3 * k],
    ],
    0.03 * k,
  );
  // 眼：金屬的眼框＋發光的核（大型多兩顆小眼）；下方的顎（樞紐，咬的時候張開）
  P(head, gCyl(0.24 * k, 0.26 * k, 0.1 * k, 8), M.joint, 0, 0.85 * k, -0.6 * k, HP);
  P(head, gSph(0.18 * k, 8), gl, 0, 0.85 * k, -0.62 * k);
  bolts_d2(
    head,
    M.gun,
    [0, 1, 2, 3, 4, 5].map((i) => [
      Math.cos(i * 1.047) * 0.21 * k,
      (0.85 + Math.sin(i * 1.047) * 0.21) * k,
      -0.66 * k,
    ]),
    0.02 * k,
    'z',
  );
  if (big)
    for (const s of [-1, 1]) {
      P(head, gCyl(0.1 * k, 0.11 * k, 0.06 * k, 6), M.joint, s * 0.3 * k, 1.02 * k, -0.52 * k, HP, 0, 0);
      P(head, gSph(0.07 * k, 6), gl, s * 0.3 * k, 1.02 * k, -0.55 * k);
    }
  const [jaw, ja] = piv_d2(head, 0, 0.6 * k, -0.52 * k);
  P(ja, gBox(0.42 * k, 0.08 * k, 0.3 * k), M.joint, 0, 0.57 * k, -0.68 * k);
  for (let i = 0; i < (big ? 5 : 3); i++) {
    const x = (-0.14 + (i * 0.28) / ((big ? 5 : 3) - 1)) * k;
    P(ja, gCyl(0, 0.035 * k, 0.1 * k, 4), M.gun, x, 0.66 * k, -0.8 * k);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0.8 * k, -0.8 * k);
  torso.add(hand);
  finish(root, scale);
  const chunks = [body, legA, legB, tankC, head];
  let ph = 0,
    open = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const br = 1 + (big ? 0.03 : 0.045) * Math.sin(t * (big ? 1.8 : 3.2));
    flesh.scale.set(br, 2 - br, br);
    const mv = Math.min(1, st.spd / 5);
    ph += dt * (4 + st.spd * (big ? 0.9 : 2.2));
    for (const L of legs) {
      const w = Math.sin(ph + L.p);
      L.g.rotation.z = (0.12 + 0.25 * Math.max(0, w)) * mv;
      L.g.rotation.y = -L.a + 0.3 * Math.cos(ph + L.p) * mv;
    }
    const warn = st.vis & FB_D2.warn,
      atk = st.vis & FB_D2.atk;
    open = to_d2(open, atk ? 0 : warn ? 1 : 0.1 + 0.08 * Math.sin(t * 2), dt, atk ? 30 : 6);
    jaw.rotation.x = 0.7 * open;
    lit_d2(vein, warn ? 1.5 + 3 * wave_d2(t, 20) : 0.8 + 0.9 * wave_d2(t, big ? 2.5 : 4), dead);
    lit_d2(gl, warn || atk ? 4.5 : 2.2, dead);
    lit_d2(fluid, 0.9 + 0.5 * wave_d2(t, 1.3), dead);
  };
  const h = big ? 3.6 : 1.3;
  return rig(root, torso, M, {
    hand,
    type: big ? 'chimera' : 'blob',
    height: h * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.3 * k, 0.45 * k],
          [0.4 * k, 1.0 * k, -0.2 * k],
          [-0.4 * k, 0.9 * k, 0.2 * k],
        ],
        plates,
        chunks,
      },
    },
  });
}
// 保全雷射網：柵欄柱＋往前伸出 16 m 的雷射柵欄（bar，紅色發光；柱子轉動時跟著掃）
// 動作：頂部的感測頭旋轉、背後的散熱風扇轉、發射器隨柵欄閃爍；警報（有人碰到柵欄）時旋轉警示燈與發射器急閃
function buildLaserPost(pal, scale) {
  const { M, root, torso } = base(pal);
  const red = glow(0xff3a30, 2),
    beac = glow(0xff3a30, 0.6),
    pad = glow(0x60c0ff, 1.2);
  const baseC = grp_d2(torso),
    pillar = grp_d2(torso),
    headC = grp_d2(torso);
  const pg = grp_d2(pillar);
  // 底座：八角的座＋底緣法蘭與錨栓＋警示條＋接線箱（鍵盤發光）＋往地面的電纜
  P(baseC, gCyl(0.7, 0.8, 0.6, 8), M.joint, 0, 0.3, 0, 0, PI / 8);
  P(baseC, gCyl(0.84, 0.86, 0.08, 8), M.sub, 0, 0.04, 0, 0, PI / 8);
  boltRing_d2(baseC, M.gun, 0, 0.1, 0, 0.8, 8, 0.03);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    P(baseC, gCyl(0.06, 0.06, 0.08, 4), M.gun, Math.cos(a) * 0.62, 0.63, Math.sin(a) * 0.62);
  }
  hazard(baseC, M, 0, 0.36, -0.7, 0.5, 0.12);
  hazard(baseC, M, 0, 0.36, 0.7, 0.5, 0.12);
  CB(baseC, 0.4, 0.5, 0.2, M.sub, 0, 1.05, 0.47, 0, 0, 0, 0.03);
  P(baseC, gBox(0.22, 0.14, 0.02), pad, 0, 1.12, 0.58);
  decal(baseC, 0, 0.2, 0.2, 0, 0.92, 0.575, 0, 0, 0);
  kitCable(
    baseC,
    M,
    [
      [0.12, 0.82, 0.52],
      [0.2, 0.55, 0.66],
      [0.24, 0.06, 0.76],
    ],
    0.04,
  );
  // 柱身：八角柱＋分段環＋正面的發射器導軌（螺栓）＋兩側的線槽與散熱縫＋編號
  P(pillar, gCyl(0.36, 0.4, 3.6, 8), M.main2, 0, 2.2, 0, 0, PI / 8);
  for (const y of [1.7, 2.7]) P(pillar, gCyl(0.42, 0.42, 0.08, 8), M.joint, 0, y, 0, 0, PI / 8);
  CB(pillar, 0.5, 3.3, 0.16, M.main, 0, 2.2, -0.36, 0, 0, 0, 0.03);
  for (const s of [-1, 1]) {
    P(pillar, gBox(0.12, 3.2, 0.12), M.sub, s * 0.36, 2.2, 0.15);
    slats(pillar, M.joint, 0, 3.6 - (s + 1) * 0.6, 0.39, 0.3, 4, 0.08);
    boltRow_d2(pillar, M.gun, [s * 0.2, 0.75, -0.45], [s * 0.2, 3.65, -0.45], 7, 0.022, 'z');
  }
  decal(pillar, 1, 0.3, 0.3, -0.38, 3.15, 0, 0, -HP, 0);
  const plates = [
    plate_d2(pg, M.main, 0.05, 0.9, 0.34, -0.37, 2.2, 0.05),
    plate_d2(pg, M.main, 0.05, 0.9, 0.34, 0.37, 2.2, 0.05),
    plate_d2(pg, M.main2, 0.42, 0.5, 0.05, 0, 1.7, -0.46),
  ];
  // 發射器：外框＋上下的遮罩＋發光的鏡頭
  for (const y of [1.2, 2.2, 3.2]) {
    CB(pillar, 0.36, 0.3, 0.2, M.joint, 0, y, -0.45, 0, 0, 0, 0.03);
    P(pillar, gBox(0.3, 0.2, 0.3), red, 0, y, -0.45);
    for (const e of [-1, 1]) P(pillar, gBox(0.4, 0.04, 0.12), M.sub, 0, y + e * 0.17, -0.55, e * 0.3);
  }
  // 背後的散熱風扇（轉）
  const [fan, fa] = piv_d2(pillar, 0, 2.6, 0.42);
  P(fa, gCyl(0.05, 0.05, 0.06, 6), M.joint, 0, 2.6, 0.42, HP);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    P(
      fa,
      gBox(0.08, 0.22, 0.02),
      M.sub,
      Math.cos(a) * 0.12,
      2.6 + Math.sin(a) * 0.12,
      0.42,
      0,
      0,
      a - HP + 0.4,
    );
  }
  P(pillar, new THREE.TorusGeometry(0.26, 0.025, 3, 10), M.joint, 0, 2.6, 0.41);
  // 頂部：感測帽＋旋轉的感測頭＋警示燈（旋轉的反光罩）
  CB(headC, 1.1, 0.3, 1.1, M.main, 0, 4.1, 0, 0, PI / 4, 0, 0.06);
  boltRing_d2(headC, M.gun, 0, 4.26, 0, 0.42, 4, 0.03, PI / 4);
  const [spin, sa] = piv_d2(headC, 0, 4.32, 0);
  P(sa, gCyl(0.16, 0.2, 0.15, 8), M.joint, 0, 4.32, 0);
  CB(sa, 0.12, 0.12, 0.3, M.sub, 0.22, 4.32, 0, 0, 0, 0, 0.02);
  P(sa, gCyl(0.04, 0.04, 0.03, 6), pad, 0.22, 4.32, -0.16, HP);
  P(sa, gCyl(0.12, 0.12, 0.08, 8), beac, 0, 4.42, 0);
  const [refl, rfa] = piv_d2(headC, 0, 4.42, 0);
  P(rfa, gBox(0.02, 0.1, 0.16), M.gun, 0.13, 4.42, 0);
  P(rfa, gBox(0.02, 0.1, 0.16), M.gun, -0.13, 4.42, 0);
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
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const alarm = st.vis & FB_D2.warn && !dead;
    if (!dead) {
      spin.rotation.y += dt * (alarm ? 6 : 1.2);
      fan.rotation.z += dt * 9;
      refl.rotation.y += dt * (alarm ? 14 : 0);
    }
    lit_d2(red, alarm ? 2 + 3 * wave_d2(t, 25) : 1.6 + 0.6 * wave_d2(t, 30), dead);
    lit_d2(beac, alarm ? 2.5 + 2.5 * wave_d2(t, 14) : 0.4 + 0.4 * wave_d2(t, 2), dead);
    lit_d2(pad, alarm ? 0.4 + 1.6 * wave_d2(t, 9) : 1.2, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'laserpost',
    height: 4.3 * scale,
    extra: {
      bar,
      anim_d2,
      dmg: {
        smoke: [
          [0, 4.2, 0],
          [0, 2.6, 0.45],
          [0, 1.1, 0.55],
        ],
        plates,
        chunks: [baseC, pillar, headC],
      },
    },
  });
}

// 構造體爬行機：分節的甲殼身體＋六隻多關節腳（高約 1.6 m）
// 動作：三腳交替的步伐；爬牆時（預警旗標）機身仰起、前腳往上搆、眼睛變亮；開火時顎下機槍後座、大顎張開
function buildCrawler(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0xffa040, 1.8),
    fl = flash_d2(0xffc070);
  // 每塊都以 (0, 1, 0) 為樞紐，仰起時一起轉
  const [front, fa] = piv_d2(torso, 0, 1.0, 0);
  const [rear, ra] = piv_d2(torso, 0, 1.0, 0);
  const [legL, la] = piv_d2(torso, 0, 1.0, 0);
  const [legR, lb] = piv_d2(torso, 0, 1.0, 0);
  const pg = grp_d2(ra);
  // 身體：前段（頭胸）與後段（腹）兩節甲殼＋中間的關節；甲殼上的肋條、背上的天線
  P(
    fa,
    gPod([
      [-1.15, 0.9, 0.82, 1.18, 0.12, 0.1],
      [-0.75, 1.5, 0.72, 1.3, 0.2, 0.15],
      [0.05, 1.55, 0.72, 1.3, 0.2, 0.15],
    ]),
    M.main,
  );
  for (const z of [-0.6, -0.3, -0.05]) P(fa, gBox(1.3, 0.04, 0.07), M.joint, 0, 1.31, z);
  for (const s of [-1, 1]) {
    rod(fa, M.joint, [s * 0.22, 1.28, -0.4], [s * 0.34, 1.48, -0.1], 0.015, 4);
    P(fa, gSph(0.03, 4), gl, s * 0.34, 1.49, -0.1);
  }
  P(
    ra,
    gPod([
      [0.15, 1.4, 0.75, 1.28, 0.2, 0.15],
      [0.75, 1.6, 0.72, 1.32, 0.22, 0.15],
      [1.1, 1.0, 0.8, 1.2, 0.15, 0.1],
    ]),
    M.main2,
  );
  P(ra, gCyl(0.42, 0.42, 0.2, 8), M.joint, 0, 1.0, 0.1, HP);
  slats(ra, M.joint, 0, 1.35, 0.6, 0.7, 1);
  for (let i = 0; i < 2; i++) P(ra, gBox(0.7, 0.03, 0.06), M.joint, 0, 1.33, 0.48 + i * 0.16);
  hazard(ra, M, 0, 1.0, 1.12, 0.6, 0.1);
  for (const s of [-1, 1]) boltRow_d2(ra, M.gun, [s * 0.62, 1.1, 0.25], [s * 0.6, 1.1, 0.9], 4, 0.025, 'x');
  decal(ra, 1, 0.3, 0.3, -0.71, 1.02, 0.55, 0, -HP, 0);
  kitCable(
    ra,
    M,
    [
      [0.25, 1.3, 0.2],
      [0.3, 1.36, -0.05],
      [0.2, 1.3, -0.3],
    ],
    0.035,
  );
  const plates = [
    plate_d2(pg, M.main3, 0.9, 0.05, 0.4, 0, 1.36, 0.75, -0.12),
    plate_d2(pg, M.main3, 0.05, 0.3, 0.6, -0.66, 0.98, 0.6),
    plate_d2(pg, M.main3, 0.05, 0.3, 0.6, 0.66, 0.98, 0.6),
  ];
  // 六隻腳：髖（樞紐）＋往上的大腿＋膝＋往下的小腿＋鉤爪
  const legs = [];
  for (const z of [-0.8, 0, 0.8])
    for (const s of [-1, 1]) {
      const zk = z * 1.15;
      const [g, a] = piv_d2(s < 0 ? la : lb, s * 0.72, 1.0, z);
      legs.push({ g, s, p: (z === 0) === s > 0 ? PI : 0, f: z < 0 });
      P(a, gCyl(0.1, 0.1, 0.16, 6), M.joint, s * 0.72, 1.0, z, 0, 0, HP);
      beam(a, M.main3, [s * 0.75, 1.02, z], [s * 1.38, 1.4, zk], 0.14, 0.16, 0.03);
      P(a, gBox(0.3, 0.05, 0.1), M.joint, s * 1.05, 1.27, (z + zk) / 2, 0, 0, s * 0.55);
      P(a, gSph(0.09, 6), M.joint, s * 1.4, 1.4, zk);
      beam(a, M.joint, [s * 1.4, 1.38, zk], [s * 1.82, 0.12, zk * 1.05], 0.1, 0.12, 0.02);
      P(a, gCyl(0.0, 0.06, 0.14, 5), M.joint, s * 1.84, 0.07, zk * 1.05, PI);
      P(a, gBox(0.04, 0.12, 0.04), M.joint, s * 1.9, 0.14, zk * 1.05, 0, 0, s * 0.6);
    }
  // 頭部：大顎（各自的樞紐）、顎下的機槍（後座）、兩顆感測眼
  const mand = [];
  for (const s of [-1, 1]) {
    const [g, a] = piv_d2(fa, s * 0.28, 0.9, -1.1);
    mand.push({ g, s });
    PB(a, gBox(0.07, 0.07, 0.4), M.joint, [s * 0.25, 0.86, -1.28], [1, 0, 0], [0, 1, 0]);
    P(a, gBox(0.05, 0.05, 0.14), M.joint, s * 0.2, 0.86, -1.48, 0, s * 0.8);
  }
  P(fa, gCyl(0.14, 0.14, 0.3, 8), M.sub, 0, 0.95, -1.18, HP);
  kitCable(
    fa,
    M,
    [
      [0.1, 0.88, -1.05],
      [0.3, 0.85, -0.8],
    ],
    0.03,
  );
  const gun = grp_d2(fa);
  P(gun, gCyl(0.05, 0.06, 0.8, 6), M.gun, 0, 0.95, -1.5, HP);
  P(gun, gCyl(0.07, 0.07, 0.2, 6), M.gun, 0, 0.95, -1.3, HP);
  const flash = grp_d2(gun);
  P(flash, gCyl(0.0, 0.14, 0.3, 6), fl, 0, 0.95, -2.05, HP);
  flash.visible = false;
  for (const s of [-1, 1]) {
    P(fa, gCyl(0.14, 0.15, 0.08, 8), M.joint, s * 0.35, 1.1, -1.1, HP + 0.3);
    P(fa, gSph(0.11, 8), gl, s * 0.35, 1.12, -1.13);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 1.1, -1.9);
  torso.add(hand);
  finish(root, scale);
  const chunks = [front, rear, legL, legR];
  let ph = 0,
    climb = 0,
    fireK = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    climb = to_d2(climb, st.vis & FB_D2.warn && !dead ? 1 : 0, dt, 4);
    for (const c of chunks) c.rotation.x = 0.5 * climb;
    const mv = Math.min(1, Math.max(st.spd / 4, climb));
    ph += dt * (5 + st.spd * 1.6 + climb * 6);
    for (const L of legs) {
      const w = Math.sin(ph + L.p);
      L.g.rotation.y = 0.3 * Math.cos(ph + L.p) * mv * -L.s;
      L.g.rotation.z = L.s * (0.25 * Math.max(0, w) * mv + (L.f ? 0.5 * climb : 0));
    }
    const fire = st.vis & FB_D2.fire && !dead;
    fireK = to_d2(fireK, fire ? 1 : 0, dt, fire ? 14 : 4);
    gun.position.z = fire ? 0.08 * Math.abs(Math.sin(t * 40)) : 0;
    flash.visible = !!(fire && Math.sin(t * 40) > 0.4);
    for (const m of mand) m.g.rotation.y = m.s * (0.08 + 0.35 * fireK + 0.05 * Math.sin(t * 3));
    lit_d2(gl, 1.8 + 2.5 * Math.max(fireK, climb * wave_d2(t, 10)), dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'crawler',
    height: 1.6 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.35, 0.6],
          [0, 1.3, -0.5],
          [0.5, 1.1, 0.1],
        ],
        plates,
        chunks,
      },
    },
  });
}
// 平台底部砲塔：頂部的吊掛座＋倒吊的砲塔與雙管（原點在底部；吊在平台底面，高約 2 m）
// 動作：待機時砲塔左右掃描、吊掛座的指示燈慢閃；開火時雙管交互後座與砲口閃光、瞄準鏡頭變亮
function buildUnderTurret(pal, scale) {
  const { M, root, torso } = base(pal);
  const lamp = glow(0xffa040, 0.8),
    lens = glow(0xffa040, 2),
    eyeM = glow(0xffa040, 1.6),
    fl = flash_d2(0xffc070);
  const mount = grp_d2(torso),
    boom = grp_d2(torso);
  const [tur, ta] = piv_d2(torso, 0, 0.9, 0);
  const pg = grp_d2(ta);
  // 吊掛座：八角板＋螺栓＋補強肋＋邊緣的警示條與指示燈
  P(mount, gCyl(1.1, 1.0, 0.3, 8), M.joint, 0, 2.0, 0, 0, PI / 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(mount, gCyl(0.06, 0.06, 0.06, 4), M.gun, Math.cos(a) * 0.82, 1.83, Math.sin(a) * 0.82);
    if (i % 2 === 0)
      PB(
        mount,
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
    else P(mount, gBox(0.12, 0.06, 0.06), lamp, Math.cos(a) * 1.0, 1.9, Math.sin(a) * 1.0, 0, -a);
  }
  hazard(mount, M, 0, 2.0, -1.0, 0.7, 0.14);
  hazard(mount, M, 0, 2.0, 1.0, 0.7, 0.14);
  // 吊桿：迴轉環＋筒＋送彈管
  P(boom, gCyl(0.25, 0.25, 0.6, 8), M.main2, 0, 1.6, 0);
  P(boom, gCyl(0.42, 0.42, 0.1, 10), M.sub, 0, 1.78, 0);
  boltRing_d2(boom, M.gun, 0, 1.72, 0, 0.36, 6, 0.025);
  P(ta, gCyl(0.38, 0.38, 0.1, 10), M.sub, 0, 1.36, 0);
  kitCable(
    boom,
    M,
    [
      [0.3, 1.82, 0.3],
      [0.55, 1.6, 0.42],
      [0.62, 1.25, 0.3],
    ],
    0.05,
  );
  // 砲塔：球體＋赤道的裝甲帶＋正面的防盾（螺栓）＋側面的編號
  P(ta, gSph(0.9, 12), M.main, 0, 0.9, 0);
  P(ta, gCyl(0.93, 0.93, 0.18, 12), M.main2, 0, 0.95, 0);
  front(ta, M.main2, crect(0.95, 0.6, 0.12), 0.14, -0.8, 0.03, 0.9, 1, 0, 0.72, 0.3);
  bolts_d2(
    ta,
    M.gun,
    [
      [-0.38, 0.95, -0.9],
      [0.38, 0.95, -0.9],
      [-0.38, 0.52, -0.78],
      [0.38, 0.52, -0.78],
    ],
    0.03,
    'z',
  );
  slats(ta, M.joint, 0, 1.45, 0.62, 0.5, 3, 0.09);
  decal(ta, 1, 0.34, 0.34, -0.9, 0.95, 0.15, 0, -HP, 0);
  const plates = [
    plate_d2(pg, M.main2, 0.06, 0.5, 0.6, -0.86, 0.75, -0.1, 0, 0, 0.25),
    plate_d2(pg, M.main2, 0.06, 0.5, 0.6, 0.86, 0.75, -0.1, 0, 0, -0.25),
    plate_d2(pg, M.main3, 0.6, 0.06, 0.5, 0, 0.06, 0.1),
  ];
  // 雙管：砲口朝前下方（+y 端＝砲口），各自後座
  const dirY = -Math.sin(0.3),
    dirZ = -Math.cos(0.3);
  const brl = [];
  for (const s of [-1, 1]) {
    const b = grp_d2(ta);
    P(b, gCyl(0.08, 0.1, 1.3, 8), M.gun, s * 0.25, 0.7, -0.95, -(HP + 0.3));
    P(b, gCyl(0.12, 0.12, 0.4, 8), M.gun, s * 0.25, 0.77, -0.71, -(HP + 0.3));
    for (const u of [0.25, 0.4])
      P(b, gCyl(0.1, 0.1, 0.03, 8), M.joint, s * 0.25, 0.7 + dirY * u, -0.95 + dirZ * u, -(HP + 0.3));
    P(b, gCyl(0.1, 0.1, 0.08, 8), M.joint, s * 0.25, 0.52, -1.55, -(HP + 0.3));
    const f = grp_d2(b);
    P(f, gCyl(0.16, 0.0, 0.35, 6), fl, s * 0.25 + 0, 0.52 + dirY * 0.25, -1.55 + dirZ * 0.25, -(HP + 0.3));
    f.visible = false;
    brl.push({ b, f, r: 0 });
  }
  P(ta, gSph(0.15, 8), lens, 0, 0.6, -0.8);
  eye(ta, M, eyeM, 0.45, 1.25, -0.72, 0.05);
  const hand = new THREE.Group();
  hand.position.set(0, 0.5, -1.5);
  torso.add(hand);
  finish(root, scale);
  let fireK = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const fire = st.vis & FB_D2.fire && !dead;
    fireK = to_d2(fireK, fire ? 1 : 0, dt, fire ? 12 : 2);
    if (!dead) tur.rotation.y = 0.18 * Math.sin(t * 0.7) * (1 - fireK);
    brl.forEach((o, i) => {
      const k = fire ? Math.abs(Math.sin(t * 22 + i * HP)) : 0;
      o.r = to_d2(o.r, k * 0.14, dt, 30);
      o.b.position.set(0, -dirY * o.r, -dirZ * o.r);
      o.f.visible = !!(fire && k > 0.65);
    });
    lit_d2(lens, 2 + 3 * fireK, dead);
    lit_d2(eyeM, 1.6 + 2 * fireK, dead);
    lit_d2(lamp, 0.3 + 1.5 * (wave_d2(t, 3) > 0.8 ? 1 : 0), dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'underturret',
    height: 2 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.4, 0.3],
          [0.5, 0.9, 0.2],
          [-0.4, 0.6, -0.3],
        ],
        plates,
        chunks: [mount, boom, tur],
      },
    },
  });
}
// 推進器試車台：台座＋鋼架夾著的大型噴口（朝 −Z）＋燃燒室與管線＋控制台（高約 4 m，不移動）
// 動作（bossVis 低位＝行為端的 ph：1 預警、2 噴火）：待機時渦輪泵慢轉、噴口餘熱；預警時噴口邊緣的導流瓣張開、
// 噴口與燃燒室發光漸強、鋼架上的警示燈旋轉、控制台的螢幕轉紅；噴火時噴口震動、全亮
function buildTestRig(pal, scale) {
  const { M, root, torso } = base(pal);
  const hot = glow(0xff8a30, 1.2),
    core = glow(0xff6020, 0.3),
    beac = glow(0xffa020, 0.4),
    scr = glow(0x60c0ff, 1.4);
  const baseC = grp_d2(torso),
    frame = grp_d2(torso),
    con = grp_d2(torso);
  const [noz, na] = piv_d2(torso, 0, 2.4, 0);
  const pg = grp_d2(frame);
  // 台座：切角的座＋警示條＋錨栓＋兩側的推進劑槽（綁帶）
  P(
    baseC,
    gPod([
      [-1.6, 3.6, 0, 1.2, 0.2, 0],
      [2.4, 3.6, 0, 1.2, 0.2, 0],
    ]),
    M.joint,
  );
  hazard(baseC, M, 0, 0.95, -1.62, 3.0, 0.2);
  for (const s of [-1, 1]) {
    boltRow_d2(baseC, M.gun, [s * 1.6, 1.21, -1.3], [s * 1.6, 1.21, 2.1], 6, 0.035);
    P(baseC, gCyl(0.32, 0.32, 1.4, 10), M.acc, s * 1.25, 1.55, 1.75, HP);
    for (const z of [1.3, 2.2]) P(baseC, gCyl(0.34, 0.34, 0.06, 10), M.joint, s * 1.25, 1.55, z, HP);
  }
  decal(baseC, 0, 0.5, 0.5, 0, 0.6, -1.62, 0, PI, 0);
  // 噴口（樞紐在噴口中心，噴火時震動）：鐘形噴口＋冷卻環＋冷卻管＋發光的口＋邊緣的導流瓣
  P(na, gCyl(1.0, 1.6, 3.2, 14), M.gun, 0, 2.4, -0.8, HP);
  for (const z of [-2.0, -1.2, -0.4]) {
    const r = 1.6 - ((z + 2.4) / 3.2) * 0.6 + 0.04;
    P(na, gCyl(r, r, 0.1, 14), M.joint, 0, 2.4, z, HP);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + 0.3,
      c = Math.cos(a),
      s = Math.sin(a);
    rod(na, M.sub, [c * 1.58, 2.4 + s * 1.58, -2.2], [c * 1.06, 2.4 + s * 1.06, 0.6], 0.03, 4);
  }
  P(na, gCyl(1.1, 1.1, 0.2, 14), hot, 0, 2.4, -2.45, HP);
  P(na, gCyl(0.55, 0.55, 0.22, 10), core, 0, 2.4, -2.47, HP);
  const petals = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    const g = grp_d2(na, Math.cos(a) * 1.6, 2.4 + Math.sin(a) * 1.6, -2.35);
    g.rotation.order = 'ZYX'; // 先繞自己的切線張開，再轉到噴口邊緣的位置
    g.rotation.z = a - HP;
    petals.push(g);
    // 導流瓣：鉸鏈在噴口邊緣，貼著噴口往後（+z）
    P(g, gBox(0.5, 0.04, 0.5), M.sub, 0, 0.0, 0.25);
  }
  // 燃燒室與渦輪泵（轉）、管線
  P(na, gCyl(0.7, 0.85, 0.4, 10), M.sub, 0, 2.4, 1.0, HP);
  P(na, gCyl(0.5, 0.5, 0.06, 10), core, 0, 2.4, 1.21, HP);
  const [pump, pa] = piv_d2(na, 1.05, 1.95, 0.95);
  P(pa, gCyl(0.22, 0.22, 0.45, 8), M.acc, 1.05, 1.95, 0.95, HP);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    P(pa, gBox(0.06, 0.48, 0.05), M.joint, 1.05 + Math.cos(a) * 0.2, 1.95 + Math.sin(a) * 0.2, 0.95, 0, 0, a);
  }
  kitCable(
    na,
    M,
    [
      [1.05, 1.95, 0.7],
      [1.0, 2.6, 0.3],
      [0.55, 3.05, 0.2],
    ],
    0.06,
  );
  kitCable(
    na,
    M,
    [
      [-0.6, 2.9, 1.2],
      [-0.75, 3.2, 1.7],
    ],
    0.05,
  );
  // 鋼架：夾住噴口的環＋立柱＋推力支柱＋爬梯＋警示燈（旋轉）
  for (const z of [-1.4, 0.4]) {
    const r = 1.6 - ((z + 2.4) / 3.2) * 0.6 + 0.1;
    P(frame, gCyl(r, r, 0.18, 12), M.main2, 0, 2.4, z, HP);
    for (const s of [-1, 1]) {
      CB(frame, 0.24, 2.5, 0.24, M.main, s * 1.45, 1.75, z, 0, 0, 0, 0.03);
      bolts_d2(frame, M.gun, [[s * 1.45, 1.2, z - 0.13]], 0.03, 'z');
    }
  }
  for (const s of [-1, 1]) {
    beam(frame, M.main, [s * 1.45, 3.0, -1.4], [s * 1.45, 3.0, 0.4], 0.2, 0.2, 0.03);
    beam(frame, M.joint, [s * 1.45, 1.4, -1.4], [s * 1.45, 2.9, 0.4], 0.08, 0.08);
  }
  for (const s of [-1, 1])
    rod(frame, M.joint, [-1.62, 1.2, -0.5 + s * 0.18], [-1.62, 3.0, -0.5 + s * 0.18], 0.02, 4);
  for (let i = 0; i < 6; i++) P(frame, gBox(0.03, 0.03, 0.36), M.joint, -1.62, 1.35 + i * 0.28, -0.5);
  const beacons = [];
  for (const s of [-1, 1]) {
    P(frame, gCyl(0.1, 0.12, 0.1, 8), M.joint, s * 1.45, 3.15, -0.5);
    P(frame, gCyl(0.08, 0.08, 0.16, 8), beac, s * 1.45, 3.28, -0.5);
    const [b, ba] = piv_d2(frame, s * 1.45, 3.28, -0.5);
    P(ba, gBox(0.02, 0.18, 0.12), M.gun, s * 1.45 + 0.09, 3.28, -0.5);
    beacons.push(b);
  }
  const plates = [
    plate_d2(pg, M.main2, 0.05, 0.9, 1.4, -1.6, 2.1, -0.5),
    plate_d2(pg, M.main2, 0.05, 0.9, 1.4, 1.6, 2.1, -0.5),
    plate_d2(pg, M.main3, 0.9, 0.05, 0.5, 0.6, 3.36, 2.0),
  ];
  // 控制台：前面收斜的箱＋螢幕（發光，預警時轉紅）＋散熱縫＋天線＋把手
  P(
    con,
    gPod([
      [1.2, 1.4, 1.1, 3.0, 0.2, 0.04],
      [1.5, 1.6, 1.1, 3.3, 0.15, 0.04],
      [2.6, 1.6, 1.1, 3.3, 0.12, 0.04],
    ]),
    M.main,
  );
  P(con, gBox(1.2, 0.5, 0.05), scr, 0, 2.8, 1.18);
  P(con, gBox(1.3, 0.06, 0.08), M.joint, 0, 2.5, 1.16);
  slats(con, M.joint, 0.81, 2.6, 2.0, 0.8, 4, 0.12, HP);
  rod(con, M.joint, [0.5, 3.3, 2.2], [0.5, 4.0, 2.2], 0.015, 4);
  boltRow_d2(con, M.gun, [-0.7, 3.3, 1.6], [0.7, 3.3, 1.6], 5, 0.025);
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -2.6);
  torso.add(hand);
  finish(root, scale);
  let heat = 0,
    open = 0;
  const cBlue = new THREE.Color(0x60c0ff),
    cRed = new THREE.Color(0xff3020);
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const ph = dead ? 0 : st.vis & 3;
    heat = ph === 1 ? Math.min(1, heat + dt / 1.5) : ph === 2 ? 1 : Math.max(0, heat - dt * 0.4);
    open = to_d2(open, ph ? 1 : 0, dt, ph === 1 ? 2.5 : 3);
    for (const p of petals) p.rotation.x = -0.55 * open;
    pump.rotation.z += dt * (dead ? 0 : 2 + heat * 25);
    const j = ph === 2 ? 0.05 : 0;
    noz.position.set((Math.random() - 0.5) * j, 2.4 + (Math.random() - 0.5) * j, 0);
    lit_d2(hot, 1.2 + (ph === 2 ? 5 + Math.random() : heat * 3.5), dead);
    lit_d2(core, 0.3 + heat * 4 + (ph === 1 ? 1.5 * wave_d2(t, 16) : 0), dead);
    lit_d2(beac, ph ? 2 + 2 * wave_d2(t, 12) : 0.3, dead);
    for (const b of beacons) b.rotation.y += dt * (ph ? 10 : 0.5);
    const c = ph ? cRed : cBlue;
    scr.color.copy(c);
    scr.emissive.copy(c);
    lit_d2(scr, ph ? 1.4 + 1.6 * wave_d2(t, 8) : 1.4, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'testrig',
    height: 4 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 3.6, -0.6],
          [1.0, 2.4, 1.0],
          [0.6, 3.4, 2.0],
        ],
        plates,
        chunks: [baseC, noz, frame, con],
      },
    },
  });
}
// 舊式宇宙用 MT：圓胖的機身、背上的推進器與氣瓶、姿勢控制噴嘴、短腳與大腳掌（高約 3 m）
// 動作：步行時兩腳交替、滯空時收腳並點亮背部推進器的噴焰與姿勢控制噴嘴；開火時右手砲後座與閃光、面罩變亮；
// 左手的作業臂待機時擺動
function buildSpaceMt(pal, scale) {
  const { M, root, torso } = base(pal);
  const gl = glow(0x60c0ff, 1.4),
    nav = glow(0xff4030, 1),
    flame = flash_d2(0x90c8ff, 0.8),
    fl = flash_d2(0xffd080);
  const body = grp_d2(torso),
    pack = grp_d2(torso);
  const pg = grp_d2(body);
  const legs = [];
  for (const s of [-1, 1]) {
    // 腳（樞紐在髖）：大腿＋膝＋小腿＋寬腳掌、避震桿、腳掌的警示條
    const [g, a] = piv_d2(torso, s * 0.6, 1.15, 0);
    legs.push({ g, s });
    P(a, gCyl(0.22, 0.22, 0.3, 8), M.joint, s * 0.6, 1.15, 0, 0, 0, HP);
    beam(a, M.joint, [s * 0.6, 1.1, 0], [s * 0.62, 0.65, -0.15], 0.34, 0.38, 0.05);
    P(a, gSph(0.18, 8), M.sub, s * 0.62, 0.62, -0.15);
    beam(a, M.main2, [s * 0.62, 0.6, -0.15], [s * 0.6, 0.22, 0.0], 0.4, 0.42, 0.06);
    piston(a, M, [s * 0.82, 1.0, 0.15], [s * 0.82, 0.3, 0.12], 0.04);
    P(
      a,
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
    hazard(a, M, s * 0.6, 0.16, -0.6, 0.4, 0.07);
  }
  // 機身：球體＋腰帶（螺栓）＋正面的面罩框（發光的窗）＋側面的艙門（把手）＋頭頂的燈與天線
  P(body, gSph(1.1, 12), M.main, 0, 1.9, 0);
  P(body, gCyl(1.12, 1.12, 0.2, 12), M.main2, 0, 1.6, 0);
  boltRing_d2(body, M.gun, 0, 1.71, 0, 1.05, 12, 0.03);
  front(body, M.joint, crect(1.2, 0.68, 0.16), 0.16, -0.92, 0.03, 1, 1, 0, 2.1);
  P(body, gBox(1.0, 0.5, 0.1), gl, 0, 2.1, -1.0);
  for (const x of [-0.25, 0.25]) P(body, gBox(0.05, 0.56, 0.06), M.joint, x, 2.1, -1.04);
  P(body, gBox(1.05, 0.05, 0.08), M.joint, 0, 2.38, -1.03);
  P(body, gCyl(0.42, 0.42, 0.08, 10), M.main3, -1.06, 2.05, 0.1, 0, 0, HP);
  P(body, gBox(0.04, 0.06, 0.3), M.joint, -1.12, 2.05, 0.1);
  for (const s of [-1, 1]) P(body, gCyl(0.07, 0.07, 0.06, 6), nav, s * 0.55, 2.82, -0.35);
  rod(body, M.joint, [0.3, 2.9, 0.3], [0.38, 3.0, 0.5], 0.015, 4);
  decal(body, 1, 0.4, 0.4, 1.1, 1.95, 0.25, 0, HP, 0);
  const plates = [
    plate_d2(pg, M.main3, 0.5, 0.5, 0.06, 0.62, 2.35, -0.78, -0.35, 0.6),
    plate_d2(pg, M.main3, 0.5, 0.5, 0.06, -0.62, 2.35, -0.78, -0.35, -0.6),
    plate_d2(pg, M.main2, 0.6, 0.3, 0.06, 0, 1.35, -0.95, 0.4),
  ];
  // 背上的推進器（鐘形噴口＋噴焰）與氣瓶（綁帶）
  const flames = [];
  for (const s of [-1, 1]) {
    P(pack, gCyl(0.25, 0.3, 0.8, 8), M.main2, s * 0.8, 2.1, 0.9, 0.4);
    P(pack, gCyl(0.18, 0.32, 0.3, 8), M.gun, s * 0.8, 1.78, 1.25, 0.4);
    P(pack, gCyl(0.18, 0.18, 0.9, 8), M.acc, s * 0.32, 2.4, 0.95, 0.15);
    for (const e of [-0.25, 0.25])
      P(pack, gCyl(0.19, 0.19, 0.05, 8), M.joint, s * 0.32, 2.4 + e, 0.95 + e * 0.15, 0.15);
    const f = grp_d2(pack, s * 0.8, 1.64, 1.31);
    f.rotation.x = PI - 0.4;
    P(f, gCyl(0.02, 0.24, 0.9, 8), flame, 0, 0.45, 0);
    f.scale.setScalar(0.01);
    f.visible = false;
    flames.push(f);
  }
  // 姿勢控制噴嘴（四角各一組，噴氣時亮）
  const puffs = [];
  for (const [x, y] of [
    [-0.85, 2.6],
    [0.85, 2.6],
    [-0.9, 1.3],
    [0.9, 1.3],
  ]) {
    CB(pack, 0.2, 0.2, 0.2, M.sub, x, y, -0.35, 0, 0, 0, 0.03);
    P(pack, gCyl(0.04, 0.07, 0.1, 6), M.gun, x + Math.sign(x) * 0.12, y, -0.35, 0, 0, HP);
    const f = grp_d2(pack, x + Math.sign(x) * 0.2, y, -0.35);
    P(f, gCyl(0.08, 0.02, 0.3, 6), flame, Math.sign(x) * 0.12, 0, 0, 0, 0, -Math.sign(x) * HP);
    f.visible = false;
    puffs.push(f);
  }
  // 右手的砲（樞紐在肩，開火時後座）：肩軸＋機匣＋砲管＋散熱環
  const [arm, aa] = piv_d2(torso, 0.95, 1.75, -0.3);
  P(aa, gCyl(0.2, 0.2, 0.3, 8), M.joint, 0.95, 1.75, -0.3, 0, 0, HP);
  CB(aa, 0.3, 0.3, 0.6, M.sub, 0.95, 1.7, -0.6, 0, 0, 0, 0.04);
  P(aa, gBox(0.1, 0.12, 0.3), M.acc, 1.12, 1.7, -0.6);
  const brl = grp_d2(aa);
  P(brl, gCyl(0.08, 0.1, 1.0, 8), M.gun, 0.9, 1.7, -1.0, HP);
  for (const z of [-1.1, -1.25]) P(brl, gCyl(0.1, 0.1, 0.03, 8), M.joint, 0.9, 1.7, z, HP);
  const flash = grp_d2(brl);
  P(flash, gCyl(0.0, 0.18, 0.35, 6), fl, 0.9, 1.7, -1.65, HP);
  flash.visible = false;
  // 左手的作業臂（樞紐在肩）：上臂＋爪
  const [larm, lw] = piv_d2(body, -0.95, 1.75, -0.3);
  P(lw, gCyl(0.16, 0.16, 0.26, 8), M.joint, -0.95, 1.75, -0.3, 0, 0, HP);
  beam(lw, M.main2, [-1.0, 1.7, -0.35], [-1.02, 1.3, -0.65], 0.14, 0.14, 0.02);
  for (const s of [-1, 1])
    beam(lw, M.joint, [-1.02, 1.28, -0.68], [-1.02 + s * 0.08, 1.12, -0.82], 0.05, 0.05);
  const hand = new THREE.Group();
  hand.position.set(0.9, 1.7, -1.5);
  torso.add(hand);
  finish(root, scale);
  let tuck = 0,
    thr = 0,
    fireK = 0,
    ph = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const up = st.air > 0.6 && !dead;
    tuck = to_d2(tuck, up ? 1 : 0, dt, 4);
    thr = to_d2(thr, up ? (st.vy > 0.5 ? 1 : 0.55) : 0, dt, 6);
    const mv = up ? 0 : Math.min(1, st.spd / 5);
    ph += dt * (3 + st.spd);
    for (const L of legs) L.g.rotation.x = 0.45 * tuck + Math.sin(ph + (L.s > 0 ? 0 : PI)) * 0.3 * mv;
    for (const f of flames) {
      f.visible = thr > 0.05;
      f.scale.set(1, thr * (0.85 + 0.3 * Math.random()), 1);
    }
    for (let i = 0; i < puffs.length; i++)
      puffs[i].visible = !dead && (up || mv > 0.3) && wave_d2(t, 5, i * 1.7) > 0.85;
    const fire = st.vis & FB_D2.fire && !dead;
    fireK = to_d2(fireK, fire ? 1 : 0, dt, fire ? 12 : 3);
    brl.position.z = fire ? 0.12 * Math.abs(Math.sin(t * 18)) : to_d2(brl.position.z, 0, dt, 10);
    flash.visible = !!(fire && Math.sin(t * 18) > 0.5);
    arm.rotation.x = 0.06 * fireK;
    larm.rotation.x = -0.15 + 0.12 * Math.sin(t * 1.3) - 0.3 * tuck;
    lit_d2(gl, 1.4 + 2.2 * fireK, dead);
    lit_d2(nav, wave_d2(t, 4) > 0.8 ? 3 : 0.3, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'spacemt',
    height: 3 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 2.6, 0.4],
          [0.8, 2.0, 0.9],
          [-0.6, 1.8, -0.4],
        ],
        plates,
        chunks: [body, pack, legs[0].g, legs[1].g, arm],
      },
    },
  });
}
// 衝撞無人機：前端是撞角的楔形機體＋兩側的推進器莢艙（飛行，高約 1.2 m）
// 動作：待機時上下浮動、莢艙微擺；預警（衝撞前 0.8 秒）時撞角往前伸出、邊緣與尾焰發光漸強、莢艙前傾；
// 衝撞中噴焰全開
function buildRammer(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.6;
  const eyeM = glow(0x60e0ff, 2),
    edge = glow(0x60e0ff, 0.4),
    eng = glow(0x60e0ff, 0.8),
    flame = flash_d2(0x80e8ff, 0.85);
  const hull = grp_d2(torso);
  const [ram, rma] = piv_d2(torso, 0, 0, -0.8);
  const pg = grp_d2(hull);
  P(
    hull,
    gPod([
      [-1.2, 0.3, -0.12, 0.12, 0.05, 0.05],
      [-0.7, 0.75, -0.35, 0.35, 0.15, 0.15],
      [0.2, 1.1, -0.5, 0.5, 0.25, 0.25],
      [0.8, 1.1, -0.5, 0.5, 0.25, 0.25],
      [1.35, 0.9, -0.42, 0.42, 0.2, 0.2],
    ]),
    M.main,
  );
  // 背脊（螺栓）、進氣格柵、感測器（發光）、尾部的噴口（發光）與尾翼、編號
  CB(hull, 0.3, 0.12, 1.0, M.main2, 0, 0.5, 0.4, 0, 0, 0, 0.03);
  boltRow_d2(hull, M.gun, [0, 0.57, 0.0], [0, 0.57, 0.8], 4, 0.025);
  for (const s of [-1, 1]) slats(hull, M.joint, s * 0.3, 0.46, 0.0, 0.2, 3, 0.07, s * 0.4);
  for (const s of [-1, 1]) P(hull, gBox(0.03, 0.5, 0.03), M.joint, s * 0.54, 0, 0.3);
  P(hull, gCyl(0.1, 0.12, 0.08, 8), M.joint, 0, 0.27, -0.25);
  P(hull, gSph(0.15, 8), eyeM, 0, 0.3, -0.2);
  P(hull, gCyl(0.38, 0.3, 0.2, 10), M.gun, 0, 0, 1.42, HP);
  P(hull, gCyl(0.24, 0.24, 0.04, 10), eng, 0, 0, 1.53, HP);
  decal(hull, 1, 0.3, 0.3, -0.56, -0.02, 0.5, 0, -HP, 0);
  for (const s of [-1, 1])
    side(
      hull,
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
  const plates = [
    plate_d2(pg, M.main3, 0.05, 0.4, 0.7, -0.57, 0.02, 0.65),
    plate_d2(pg, M.main3, 0.05, 0.4, 0.7, 0.57, 0.02, 0.65),
  ];
  // 撞角：加厚的楔形鋼塊＋尖端＋邊緣的發光條＋警示條
  P(
    rma,
    gPod([
      [-1.5, 0.1, -0.05, 0.05, 0.02, 0.02],
      [-1.15, 0.38, -0.16, 0.16, 0.06, 0.06],
      [-0.75, 0.5, -0.22, 0.22, 0.08, 0.08],
    ]),
    M.joint,
  );
  for (const s of [-1, 1]) rod(rma, edge, [s * 0.04, 0, -1.48], [s * 0.25, 0, -0.78], 0.018, 4);
  rod(rma, edge, [0, 0.04, -1.48], [0, 0.22, -0.78], 0.015, 4);
  hazard(rma, M, 0, 0.17, -0.95, 0.28, 0.06);
  P(rma, gBox(0.5, 0.5, 0.06), M.sub, 0, 0, -0.74);
  // 推進器莢艙（樞紐在掛架，預警時前傾）：進氣環＋筒＋噴口＋噴焰，與機身的掛架
  const pods = [],
    flames = [];
  for (const s of [-1, 1]) {
    const [pd, pa] = piv_d2(torso, s * 0.8, 0, 0.8);
    pods.push(pd);
    P(pa, gCyl(0.25, 0.3, 0.9, 8), M.joint, s * 0.8, 0, 0.8, HP);
    P(pa, gCyl(0.28, 0.28, 0.08, 8), M.sub, s * 0.8, 0, 0.36, HP);
    P(pa, gCyl(0.16, 0.16, 0.06, 8), M.gun, s * 0.8, 0, 0.33, HP);
    P(pa, gCyl(0.22, 0.18, 0.15, 8), M.gun, s * 0.8, 0, 1.3, HP);
    P(pa, gCyl(0.14, 0.14, 0.03, 8), eng, s * 0.8, 0, 1.38, HP);
    P(pa, gBox(0.04, 0.35, 0.5), M.acc, s * 1.06, 0, 0.8);
    top(
      pa,
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
    const f = grp_d2(pa, s * 0.8, 0, 1.4);
    P(f, gCyl(0.15, 0.02, 1, 8), flame, 0, 0, 0.5, HP);
    f.scale.set(1, 1, 0.01);
    flames.push(f);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -1.6);
  torso.add(hand);
  finish(root, scale);
  const chunks = [hull, ram, pods[0], pods[1]];
  let ext = 0,
    thr = 0.3;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const warn = !dead && st.vis & FB_D2.warn,
      atk = !dead && st.vis & FB_D2.atk;
    const bob = dead ? 0 : 0.06 * Math.sin(t * 2.2);
    for (const c of chunks) c.position.y = bob;
    ext = to_d2(ext, warn || atk ? 1 : 0, dt, 6);
    ram.position.z = -0.8 - 0.22 * ext;
    thr = to_d2(thr, atk ? 1.6 : warn ? 0.8 : 0.35, dt, 8);
    pods.forEach((p, i) => (p.rotation.x = -0.25 * ext + 0.04 * Math.sin(t * 1.7 + i)));
    for (const f of flames) {
      f.visible = !dead;
      f.scale.set(1 + 0.4 * (thr > 1), 1 + 0.4 * (thr > 1), thr * (0.85 + 0.3 * Math.random()));
    }
    lit_d2(edge, 0.4 + (warn ? 3 * wave_d2(t, 20) + 1 : atk ? 4 : 0), dead);
    lit_d2(eng, 0.8 + 2.5 * Math.min(1, thr), dead);
    lit_d2(eyeM, warn || atk ? 4 : 2, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'rammer',
    height: 1.2 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.1, 0.5],
          [0.8, 0.7, 1.0],
          [-0.8, 0.7, 1.0],
        ],
        plates,
        chunks,
      },
    },
  });
}
// 艦載防空砲：圓形砲座＋楔形砲塔＋朝上的四連裝砲管＋兩側的彈鼓（高約 3.4 m，不移動）
// 動作：待機時雷達慢轉；目標在空中（預警旗標）時砲管再抬高、雷達快轉、砲塔的燈轉紅閃；
// 射出空炸彈時四根砲管依序後座、砲口閃光
function buildFlak(pal, scale) {
  const { M, root, torso } = base(pal);
  const strip = glow(0x60e0ff, 1.4),
    lamp = glow(0x60ff90, 1),
    fl = flash_d2(0x90e8ff);
  const baseC = grp_d2(torso),
    turC = grp_d2(torso);
  const [guns, gna] = piv_d2(torso, 0, 2.25, -0.55);
  const [radar, rda] = piv_d2(torso, 0.6, 2.4, 0.8);
  const pg = grp_d2(turC);
  // 砲座：甲板上的圓座＋螺栓＋迴轉環＋警示條＋爬梯
  P(baseC, gCyl(1.8, 2.0, 0.8, 14), M.joint, 0, 0.4, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    P(baseC, gCyl(0.06, 0.06, 0.08, 4), M.gun, Math.cos(a) * 1.65, 0.82, Math.sin(a) * 1.65);
  }
  P(baseC, gCyl(1.3, 1.3, 0.14, 14), M.sub, 0, 0.86, 0);
  boltRing_d2(baseC, M.gun, 0, 0.94, 0, 1.2, 12, 0.03);
  for (const z of [-1, 1]) hazard(baseC, M, 0, 0.45, z * 1.92, 1.2, 0.14);
  for (const s of [-1, 1]) rod(baseC, M.joint, [1.95, 0.05, s * 0.2], [1.95, 0.8, s * 0.2], 0.02, 4);
  for (let i = 0; i < 3; i++) P(baseC, gBox(0.03, 0.03, 0.4), M.joint, 1.95, 0.2 + i * 0.25, 0);
  // 砲塔：前面收斜的楔形＋觀測窗＋側面的散熱縫、編號＋背面的燈
  P(
    turC,
    gPod([
      [-1.1, 1.8, 0.9, 1.9, 0.3, 0.1],
      [-0.6, 2.2, 0.85, 2.2, 0.3, 0.1],
      [1.1, 2.2, 0.85, 2.1, 0.25, 0.1],
    ]),
    M.main,
  );
  P(turC, gBox(1.0, 0.25, 0.05), strip, 0, 1.5, -1.12);
  P(turC, gBox(1.1, 0.06, 0.08), M.joint, 0, 1.66, -1.12);
  for (const s of [-1, 1]) {
    slats(turC, M.joint, s * 1.1, 1.85, 0.6, 0.6, 4, 0.1, HP);
    P(turC, gCyl(0.08, 0.08, 0.08, 6), lamp, s * 0.7, 2.18, 1.0);
  }
  decal(turC, 1, 0.45, 0.45, -1.105, 1.45, 0.65, 0, -HP, 0);
  boltRow_d2(turC, M.gun, [-0.9, 2.15, 1.05], [0.9, 2.15, 1.05], 5, 0.03, 'z');
  const plates = [
    plate_d2(pg, M.main2, 0.06, 0.6, 0.9, -1.13, 1.4, 0.0),
    plate_d2(pg, M.main2, 0.06, 0.6, 0.9, 1.13, 1.4, 0.0),
    plate_d2(pg, M.main3, 1.2, 0.06, 0.6, 0, 2.21, 0.5),
  ];
  // 彈鼓（兩側）＋送彈槽
  for (const s of [-1, 1]) {
    P(turC, gCyl(0.42, 0.42, 0.3, 10), M.acc, s * 1.25, 1.75, 0.2, 0, 0, HP);
    P(turC, gCyl(0.2, 0.2, 0.34, 8), M.joint, s * 1.25, 1.75, 0.2, 0, 0, HP);
    bolts_d2(turC, M.gun, [[s * 1.42, 1.75, 0.2]], 0.05, 'x');
    beam(turC, M.sub, [s * 1.15, 2.05, 0.05], [s * 0.7, 2.3, -0.5], 0.12, 0.08);
  }
  // 砲架（樞紐在耳軸，預警時抬高）：耳軸＋四連裝砲管（砲身＋散熱套＋消焰器，各自後座）
  P(gna, gCyl(0.22, 0.22, 1.6, 10), M.joint, 0, 2.25, -0.55, 0, 0, HP);
  for (const s of [-1, 1]) P(gna, gBox(0.12, 0.5, 0.5), M.sub, s * 0.72, 2.3, -0.75);
  // 仰角 e：砲口朝前上方（+y 端＝砲口）
  const e = 0.95,
    pitch = -(HP - e),
    dy = Math.sin(e),
    dz = -Math.cos(e);
  const brl = [];
  for (const sx of [-1, 1])
    for (const sy of [0, 1]) {
      const x = sx * 0.45,
        y = 2.1 + sy * 0.4;
      const b = grp_d2(gna);
      P(b, gCyl(0.1, 0.12, 2.4, 8), M.gun, x, y, -1.0, pitch);
      P(b, gCyl(0.16, 0.16, 0.7, 8), M.sub, x, y - dy * 0.55, -1.0 - dz * 0.55, pitch);
      for (const u of [-0.3, -0.45, -0.6])
        P(b, gCyl(0.17, 0.17, 0.03, 8), M.joint, x, y + dy * u, -1.0 + dz * u, pitch);
      P(b, gCyl(0.14, 0.12, 0.25, 8), M.joint, x, y + dy * 1.15, -1.0 + dz * 1.15, pitch);
      const f = grp_d2(b);
      P(f, gCyl(0.22, 0.0, 0.5, 6), fl, x, y + dy * 1.5, -1.0 + dz * 1.5, pitch);
      f.visible = false;
      brl.push({ b, f, r: 0 });
    }
  // 背上的雷達（轉）
  P(rda, gCyl(0.06, 0.06, 0.6, 6), M.joint, 0.6, 2.4, 0.8);
  P(rda, gCyl(0.4, 0.1, 0.12, 10), M.sub, 0.6, 2.75, 0.8, -0.5);
  P(rda, gCyl(0.04, 0.04, 0.25, 4), M.joint, 0.6, 2.82, 0.67, -0.5 - HP);
  const hand = new THREE.Group();
  hand.position.set(0, 2.9, -1.9);
  torso.add(hand);
  finish(root, scale);
  let aimK = 0,
    shot = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const air = !dead && st.vis & FB_D2.warn,
      fire = !dead && st.vis & (FB_D2.fire | FB_D2.atk);
    aimK = to_d2(aimK, air ? 1 : 0, dt, 3);
    guns.rotation.x = 0.2 * aimK;
    if (!dead) radar.rotation.y += dt * (0.8 + 5 * aimK);
    if (fire) shot += dt * 11;
    brl.forEach((o, i) => {
      const k = fire ? Math.max(0, Math.sin(shot - i * HP)) : 0;
      o.r = to_d2(o.r, k * 0.25, dt, 30);
      o.b.position.set(0, -dy * o.r, -dz * o.r);
      o.f.visible = !!(fire && k > 0.8);
    });
    lit_d2(strip, 1.4 + 1.8 * aimK, dead);
    lamp.color.setHex(air ? 0xff4030 : 0x60ff90);
    lamp.emissive.copy(lamp.color);
    lit_d2(lamp, air ? 1 + 2.5 * wave_d2(t, 12) : 1, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'flak',
    height: 3.4 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 2.3, 0.4],
          [-1.2, 1.9, 0.2],
          [0.9, 1.2, -0.6],
        ],
        plates,
        chunks: [baseC, turC, guns, radar],
      },
    },
  });
}

// 真空作業機：切角的箱形機身＋兩隻三爪作業臂＋四組姿勢控制噴嘴（飛行，高約 1.8 m）
// 動作：待機時作業臂擺動、爪頭轉；換高度時姿勢控制噴嘴噴氣；開火時作業臂抬起對準、三爪張開、觀測窗變亮
function buildVacuum(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.9;
  const win = glow(0x9fe8ff, 1.6),
    nav = glow(0xffc040, 1),
    puffM = flash_d2(0xd8f0ff, 0.7);
  const body = grp_d2(torso),
    pack = grp_d2(torso);
  const pg = grp_d2(body);
  P(
    body,
    gPod([
      [-0.7, 1.2, -0.5, 0.5, 0.2, 0.2],
      [-0.55, 1.4, -0.5, 0.5, 0.25, 0.25],
      [0.7, 1.4, -0.5, 0.5, 0.25, 0.25],
    ]),
    M.main,
  );
  // 觀測窗（發光）、窗框的螺栓、扶手、天線、頂部的作業燈、側面的接縫與編號、警示條
  front(body, M.joint, crect(0.95, 0.36, 0.08), 0.06, -0.7, 0.015, 1, 1, 0, 0.15);
  P(body, gBox(0.8, 0.2, 0.05), win, 0, 0.15, -0.74);
  boltRow_d2(body, M.gun, [-0.4, 0.3, -0.74], [0.4, 0.3, -0.74], 5, 0.02, 'z');
  for (const s of [-1, 1]) {
    rod(body, M.joint, [s * 0.4, 0.55, -0.3], [s * 0.4, 0.55, 0.35], 0.025, 4);
    P(body, gBox(0.03, 0.5, 0.03), M.joint, s * 0.7, 0, 0.1);
    P(body, gCyl(0.05, 0.05, 0.05, 6), nav, s * 0.62, 0.52, -0.5);
  }
  rod(body, M.joint, [-0.45, 0.5, 0.4], [-0.5, 1.0, 0.5], 0.015, 4);
  hazard(body, M, 0, -0.38, -0.68, 0.8, 0.08);
  decal(body, 1, 0.3, 0.3, 0.705, 0.05, 0.25, 0, HP, 0);
  const plates = [
    plate_d2(pg, M.main3, 0.6, 0.05, 0.5, 0, 0.53, 0.25),
    plate_d2(pg, M.main3, 0.05, 0.35, 0.55, -0.72, 0.1, 0.35),
  ];
  // 背上的氣瓶（綁帶）與姿勢控制噴嘴（四角各一組，往三個方向；噴氣時亮）
  P(pack, gCyl(0.18, 0.18, 0.9, 8), M.acc, 0, 0.25, 0.75, HP);
  for (const x of [-0.3, 0.3]) P(pack, gCyl(0.19, 0.19, 0.05, 8), M.joint, x, 0.25, 0.75, 0, 0, HP);
  P(pack, gCyl(0.05, 0.05, 0.08, 6), M.gun, 0.48, 0.25, 0.75, 0, 0, HP);
  const puffs = [];
  for (const [x, z] of [
    [-0.8, -0.8],
    [0.8, -0.8],
    [-0.8, 0.8],
    [0.8, 0.8],
  ]) {
    CB(pack, 0.22, 0.22, 0.22, M.sub, x * 0.92, 0.38, z * 0.85, 0, 0, 0, 0.03);
    P(pack, gCyl(0.05, 0.08, 0.12, 6), M.gun, x * 0.92, 0.55, z * 0.85);
    P(
      pack,
      gCyl(0.05, 0.08, 0.12, 6),
      M.gun,
      x * 0.92 + Math.sign(x) * 0.16,
      0.38,
      z * 0.85,
      0,
      0,
      -Math.sign(x) * HP,
    );
    const fu = grp_d2(pack, x * 0.92, 0.62, z * 0.85),
      fd = grp_d2(pack, x * 0.92, 0.27, z * 0.85);
    P(fu, gCyl(0.12, 0.03, 0.35, 6), puffM, 0, 0.17, 0);
    P(fd, gCyl(0.03, 0.12, 0.35, 6), puffM, 0, -0.17, 0);
    fu.visible = fd.visible = false;
    puffs.push({ fu, fd });
  }
  // 作業臂（樞紐在肩）：肩軸＋上臂＋肘＋前臂＋爪頭（樞紐在手腕，轉動；張開時放大）
  const arms = [];
  for (const s of [-1, 1]) {
    const [ag, aa] = piv_d2(torso, s * 0.72, -0.2, -0.45);
    P(aa, gCyl(0.14, 0.14, 0.24, 8), M.joint, s * 0.72, -0.2, -0.45, 0, 0, HP);
    CB(aa, 0.18, 0.18, 0.6, M.main2, s * 0.72, -0.2, -0.75, 0, 0, 0, 0.03);
    piston(aa, M, [s * 0.72, -0.08, -0.5], [s * 0.72, -0.08, -1.0], 0.025);
    P(aa, gSph(0.11, 6), M.joint, s * 0.72, -0.2, -1.05);
    CB(aa, 0.14, 0.14, 0.4, M.joint, s * 0.72, -0.2, -1.25, 0, 0, 0, 0.02);
    CB(aa, 0.26, 0.26, 0.12, M.main2, s * 0.72, -0.2, -1.47, 0, 0, 0, 0.02);
    const [cg, ca] = piv_d2(aa, s * 0.72, -0.2, -1.5);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * PI * 2;
      beam(
        ca,
        M.joint,
        [s * 0.72 + Math.cos(a) * 0.1, -0.2 + Math.sin(a) * 0.1, -1.5],
        [s * 0.72 + Math.cos(a) * 0.05, -0.2 + Math.sin(a) * 0.05, -1.66],
        0.05,
        0.05,
        0.01,
      );
    }
    arms.push({ ag, cg, s });
  }
  const hand = new THREE.Group();
  hand.position.set(0.7, -0.2, -1.7);
  torso.add(hand);
  finish(root, scale);
  let fireK = 0,
    gas = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const fire = !dead && st.vis & FB_D2.fire;
    fireK = to_d2(fireK, fire ? 1 : 0, dt, fire ? 10 : 2.5);
    gas = to_d2(gas, !dead && (Math.abs(st.vy) > 0.6 || st.spd > 6) ? 1 : 0, dt, 10);
    for (const A of arms) {
      A.ag.rotation.x = (1 - fireK) * (0.12 * Math.sin(t * 1.1 + A.s) - 0.1) + 0.05 * fireK;
      A.ag.rotation.y = 0.08 * Math.sin(t * 0.8 + A.s * 2) * (1 - fireK);
      if (!dead) A.cg.rotation.z += dt * A.s * (0.6 + 6 * fireK);
      const o = 1 + 0.5 * fireK;
      A.cg.scale.set(o, o, 1);
    }
    puffs.forEach((p, i) => {
      const on = gas > 0.3 && wave_d2(t, 9, i * 1.3) > 0.4;
      p.fu.visible = on && st.vy < 0;
      p.fd.visible = on && st.vy >= 0;
    });
    lit_d2(win, 1.6 + 2.4 * fireK, dead);
    lit_d2(nav, wave_d2(t, 3.5) > 0.85 ? 3 : 0.3, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'vacuum',
    height: 1.8 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.5, 0.2],
          [0, 1.15, 0.75],
          [0.5, 1.3, -0.4],
        ],
        plates,
        chunks: [body, pack, arms[0].ag, arms[1].ag],
      },
    },
  });
}
// 軌道標定衛星：八角的本體＋兩片太陽能板＋往下的標定望遠鏡＋頂部的天線（飛行，高約 1.6 m）
// 動作：待機時太陽能板緩緩擺動、天線碟轉、航行燈閃；標定前（預警旗標）太陽能板收成側面、望遠鏡的光圈環轉動、
// 透鏡與充能環發光漸強；標定的瞬間全亮
function buildMarker(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.8;
  const lensM = glow(0xff5050, 2.2),
    ringM = glow(0xff5050, 0.3),
    navR = glow(0xff3030, 1),
    navG = glow(0x40ff80, 1);
  const bus = grp_d2(torso);
  const [scope, sca] = piv_d2(torso, 0, -0.72, 0);
  const pg = grp_d2(bus);
  P(bus, gCyl(0.5, 0.5, 1.4, 8), M.main, 0, 0, 0, 0, PI / 8);
  for (const y of [-0.5, 0.5]) P(bus, gCyl(0.54, 0.54, 0.1, 8), M.main2, 0, y, 0, 0, PI / 8);
  boltRing_d2(bus, M.gun, 0, 0.56, 0, 0.45, 8, 0.025, PI / 8);
  // 隔熱層的面板（一半可脫落）、星象儀、航行燈、編號
  const plates = [];
  for (let i = 0; i < 8; i += 2) {
    const a = (i / 8) * PI * 2;
    const at = [Math.cos(a) * 0.48, 0, Math.sin(a) * 0.48],
      ax = [-Math.sin(a), 0, Math.cos(a)];
    if (i === 2 || i === 6) {
      const m = plate_d2(pg, M.acc, 0.3, 0.7, 0.04, at[0], 0, at[2]);
      m.rotation.y = -a + HP;
      plates.push(m);
    } else PB(bus, gBox(0.3, 0.7, 0.04), M.acc, at, ax, [0, 1, 0]);
  }
  for (const s of [-1, 1]) {
    CB(bus, 0.16, 0.16, 0.2, M.sub, s * 0.3, 0.35, -0.48, 0, 0, 0, 0.02);
    P(bus, gCyl(0.05, 0.05, 0.03, 6), M.gun, s * 0.3, 0.35, -0.59, HP);
    P(bus, gCyl(0.04, 0.04, 0.05, 6), s < 0 ? navR : navG, s * 0.52, 0.62, 0);
  }
  decal(bus, 1, 0.3, 0.3, 0, -0.1, -0.505, 0, PI, 0);
  // 太陽能板（樞紐在鉸鏈臂）：框＋分格＋鉸鏈臂
  const panels = [];
  for (const s of [-1, 1]) {
    rod(bus, M.joint, [s * 0.5, 0, 0], [s * 0.62, 0, 0], 0.05, 6);
    const [pn, pa] = piv_d2(torso, s * 0.62, 0, 0);
    panels.push(pn);
    P(pa, gCyl(0.07, 0.07, 0.12, 6), M.joint, s * 0.66, 0, 0, 0, 0, HP);
    CB(pa, 2.2, 0.05, 0.9, M.acc, s * 1.7, 0, 0, 0, 0, 0, 0.01);
    for (let i = 0; i < 5; i++) P(pa, gBox(0.03, 0.07, 0.92), M.joint, s * (0.65 + i * 0.52), 0, 0);
    P(pa, gBox(2.2, 0.07, 0.03), M.joint, s * 1.7, 0, 0);
  }
  // 標定望遠鏡（樞紐在根部）：筒＋遮光罩＋光圈環（轉）＋充能環＋發光的透鏡
  P(sca, gCyl(0.32, 0.36, 0.2, 10), M.joint, 0, -0.72, 0);
  P(sca, gCyl(0.36, 0.3, 0.12, 10), M.gun, 0, -0.86, 0);
  P(sca, gSph(0.3, 10), lensM, 0, -0.8, 0);
  P(sca, new THREE.TorusGeometry(0.37, 0.025, 4, 16), ringM, 0, -0.93, 0, HP);
  const [iris, ia] = piv_d2(sca, 0, -0.66, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(ia, gBox(0.12, 0.08, 0.06), M.sub, Math.cos(a) * 0.38, -0.66, Math.sin(a) * 0.38, 0, -a);
  }
  // 頂部的天線碟（轉）與推進器
  const [dish, da] = piv_d2(bus, 0, 0.85, 0);
  P(da, gCyl(0.05, 0.05, 0.3, 6), M.joint, 0, 0.85, 0);
  P(da, gCyl(0.32, 0.06, 0.1, 10), M.sub, 0.04, 1.0, 0, 0, 0, 0.3);
  P(da, gCyl(0.015, 0.015, 0.12, 4), M.joint, 0.06, 1.05, 0, 0, 0, 0.3);
  for (const s of [-1, 1]) P(bus, gCyl(0.05, 0.08, 0.14, 6), M.gun, 0, 0.6, s * 0.55, s * HP);
  const hand = new THREE.Group();
  hand.position.set(0, -0.9, 0);
  torso.add(hand);
  finish(root, scale);
  let chg = 0,
    flash = 0;
  const anim_d2 = (st) => {
    const { dt, t, dead } = st;
    const warn = !dead && st.vis & FB_D2.warn,
      atk = !dead && st.vis & FB_D2.atk;
    chg = warn ? Math.min(1, chg + dt / 1.2) : to_d2(chg, 0, dt, 3);
    flash = atk ? 1 : Math.max(0, flash - dt * 2);
    panels.forEach(
      (p, i) => (p.rotation.x = (i ? -1 : 1) * 0.12 * Math.sin(t * 0.4) * (1 - chg) + 1.2 * chg),
    );
    if (!dead) {
      dish.rotation.y += dt * 0.7;
      iris.rotation.y += dt * (0.3 + 6 * chg);
    }
    scope.rotation.z = 0.05 * Math.sin(t * 0.6) * (1 - chg);
    lit_d2(lensM, 2.2 + 4 * chg * (0.7 + 0.3 * wave_d2(t, 20)) + 4 * flash, dead);
    lit_d2(ringM, 0.3 + 4 * chg + 3 * flash, dead);
    lit_d2(navR, wave_d2(t, 3) > 0.85 ? 3 : 0.3, dead);
    lit_d2(navG, wave_d2(t, 3, PI) > 0.85 ? 3 : 0.3, dead);
  };
  return rig(root, torso, M, {
    hand,
    type: 'marker',
    height: 1.6 * scale,
    extra: {
      anim_d2,
      dmg: {
        smoke: [
          [0, 1.3, 0],
          [0.4, 0.8, 0.3],
          [-0.4, 0.6, -0.3],
        ],
        plates,
        chunks: [bus, scope, panels[0], panels[1]],
      },
    },
  });
}
const FOE_RAW = {
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
  ...FOE_BUILDERS_b1, // 地圖專屬敵人擴充 B1（foe-models-b1.js）
  ...FOE_BUILDERS_b2, // 擴充：第 2 章的新敵人（foe-models-b2.js）
  ...FOE_BUILDERS_C1, // 擴充：冰原、技研都市、Grid 086（foe-models-c1.js）
  ...FOE_BUILDERS_C2,
};
// 統一出口：建好後把不會動的零件依材質合併（render/foe-merge.js，降低 draw call）
export const FOE_BUILDERS = Object.fromEntries(Object.entries(FOE_RAW).map(([k, f]) => [k, foeMerged(k, f)]));
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
  ...FOE_CATALOG_b1,
  ...FOE_CATALOG_b2,
  ...FOE_CATALOG_C1,
  ...FOE_CATALOG_C2,
];
