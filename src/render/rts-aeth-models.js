// Coral 戰爭（RTS）艾瑟立克研究機構的模型（docs/rts-design.md 14.5，R3 B 包）：建築（白色圓弧、圓柱與圓頂、玻璃槽、
// 地面走著發光的 Coral 管線）、建造中的結晶外殼、導管連線（一隊合併成一個網格）、導管範圍圈、研究作業機的採樣套件、
// 原型體的外加零件。建模函式都是純函式（不呼叫亂數、不碰遊戲狀態）；syncConduitLinks 是遊戲端的導管連線維護。
// 建築的 rig 同 render/rts-models.js 的 buildRtsBuilding：{ group, body, scaf（結晶外殼）, torso, height, vehicle, cls,
//   progress, setProgress(p), aimAt(yaw, pitch), setPower(on) }；研究中樞三階另有 tier2／tier3 與 setTier(1～3)，
//   導管節點 ring（有電時慢慢轉、斷電時熄滅）、雷射網 turret／muzzle。
// 合併（RTS 渲染設定，render/rts-merge.js）：本體的不透明材質整座併成一個網格；所以會變的發光材質（Coral 青、隊伍色）
// 每座建築各自一份、不放在 rig 上（放在 rig 上的材質不會併進單一材質），setPower／setTier 先 unmerge、改完再 remerge。
// 會轉的光環是不合併的加色網格（userData 標記），在 onBeforeRender 自己動，不需要遊戲每格呼叫。
// 斷電的閃爍圖示由 E 包畫在 HUD 畫布上（game/rts-hud.js），模型只做發光熄滅。
import { PALETTES } from './materials.js';
import { DETAIL, PK, mat } from '../world/prop-models.js';
import { RTS_PROP_FOG } from '../world/rts-props.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';
import { buildMech, mechKit } from './mech-model.js';

export const CORAL_CYAN = 0x8fd8ff; // Coral 管線的固定發光色（不換隊伍色，陣營辨識靠它）
const CORAL_BASE = 0x5ab8ff;
const OFF_GRAY = 0x3a4450;

// 配色（同 rts-models.js 的 rtsPal；模型庫預覽用，不 import rts-models.js 以免循環）
function palOf(team = 0) {
  const base = PALETTES.aetheric;
  const tc = RTS_TEAM_COLORS[team] !== undefined ? RTS_TEAM_COLORS[team] : RTS_TEAM_COLORS[0];
  return { ...base, main2: new THREE.Color(tc).multiplyScalar(0.42).getHex(), acc: tc, visor: tc, glow: tc };
}
// 建材：白陶瓷、淺灰、深底、玻璃（不透明的深青色，才能合併）＋每座建築自己的 Coral 發光與隊伍色發光
function mats(pal) {
  const coral = new THREE.MeshStandardMaterial({
    color: CORAL_BASE,
    emissive: CORAL_CYAN,
    emissiveIntensity: 1.5,
    roughness: 0.3,
    metalness: 0.1,
    flatShading: true,
  });
  const teamGlow = new THREE.MeshStandardMaterial({
    color: pal.acc,
    emissive: pal.acc,
    emissiveIntensity: 1,
    roughness: 0.4,
    metalness: 0,
    flatShading: true,
  });
  return {
    white: mat(pal.main || 0xc8d2dc, { roughness: 0.42, metalness: 0.12 }),
    white2: mat(pal.main3 || 0xe0e6ec, { roughness: 0.38, metalness: 0.1 }),
    gray: mat(0x8a96a4, { roughness: 0.55, metalness: 0.3 }),
    dark: mat(pal.sub || 0x1e2632, { roughness: 0.6, metalness: 0.45 }),
    team: mat(pal.main2, { roughness: 0.5, metalness: 0.3 }),
    glass: mat(0x1e3a4a, { roughness: 0.12, metalness: 0.55 }),
    steel: DETAIL.steel,
    coral,
    teamGlow,
  };
}
// 共用的透明材質（不合併、不放在 rig 上）
let SH = null;
function shared() {
  if (SH) return SH;
  SH = {
    crystal: new THREE.MeshStandardMaterial({
      color: 0x7fd0ff,
      emissive: 0x2a7fb0,
      emissiveIntensity: 1.3,
      roughness: 0.1,
      metalness: 0.2,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
      flatShading: true,
    }),
    tankGlass: new THREE.MeshStandardMaterial({
      color: 0xbfeaff,
      roughness: 0.05,
      metalness: 0.2,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    }),
  };
  return SH;
}
// 會轉的加色光環（每座建築一份材質：斷電時熄滅）。spin＝每秒弧度
function spinner(geo, color, opacity, spin) {
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  m.userData.rtsSpin = spin; // 有 userData：網格合併略過（render/mesh-merge.js、rts-merge.js）
  m.userData.op = opacity;
  m.castShadow = false;
  m.onBeforeRender = () => {
    const on = m.userData.on !== false;
    m.rotation.y = on ? (performance.now() / 1000) * spin : m.rotation.y;
    m.updateMatrix();
    if (m.parent) m.matrixWorld.multiplyMatrices(m.parent.matrixWorld, m.matrix);
  };
  return m;
}
const oct = () => new THREE.OctahedronGeometry(1, 0);
const hemi = () => new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const ring = (r, t, seg = 24) => new THREE.TorusGeometry(r, t, 4, seg);

// ---------- 建築 ----------
// 研究中樞（16×16、高 14）：圓形基座＋三層圓筒研究棟＋玻璃圓頂（內有 Coral 結晶）＋環繞的導管環
function hqBody(k, M) {
  k.cyl(M.gray, 7.9, 8, 0.8, 0, 0.4, 0, 0, 0, 0, 24);
  k.cyl(M.white, 7.4, 7.6, 0.5, 0, 1.05, 0, 0, 0, 0, 24);
  k.geo(M.coral, ring(6.9, 0.22, 32), 0, 1.35, 0, Math.PI / 2, 0, 0);
  k.cyl(M.white, 5.4, 5.8, 4, 0, 3.3, 0, 0, 0, 0, 20);
  k.cyl(M.glass, 5.45, 5.45, 0.9, 0, 3.6, 0, 0, 0, 0, 20);
  k.cyl(M.team, 5.5, 5.5, 0.35, 0, 5.3, 0, 0, 0, 0, 20);
  k.cyl(M.white2, 4.2, 4.6, 3.4, 0, 7.15, 0, 0, 0, 0, 18);
  k.cyl(M.glass, 4.28, 4.28, 0.7, 0, 7.4, 0, 0, 0, 0, 18);
  k.cyl(M.team, 4.3, 4.3, 0.3, 0, 8.85, 0, 0, 0, 0, 18);
  k.cyl(M.white, 3.1, 3.5, 2.6, 0, 10.2, 0, 0, 0, 0, 16);
  k.cyl(M.coral, 3.2, 3.2, 0.25, 0, 11.45, 0, 0, 0, 0, 16);
  // 玻璃圓頂（不透明的深色玻璃）＋裡面露出的 Coral 結晶尖
  k.geo(M.glass, hemi(), 0, 11.5, 0, 0, 0, 0, 2.7, 2.4, 2.7);
  k.geo(M.coral, oct(), 0, 13.1, 0, 0, 0.4, 0, 0.55, 1.2, 0.55);
  // 正面（+Z）的入口與兩側的管線
  k.cb(M.white2, 4.2, 3.2, 2, 0, 2.6, 5.6, 0, 0, 0, 0.3);
  k.box(M.dark, 3, 2.4, 0.1, 0, 2.3, 6.62);
  k.box(M.coral, 3.2, 0.15, 0.12, 0, 3.7, 6.64);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const c = Math.cos(a),
      s = Math.sin(a);
    k.pipe(M.coral, [c * 6.9, 1.4, s * 6.9], [c * 5.6, 1.6, s * 5.6], 0.14);
    k.cb(M.white2, 0.8, 1.2, 0.8, c * 7.2, 1.6, s * 7.2, 0, -a, 0, 0.12);
  }
}
// 第二階（Coral 研究院，高 16）：外圈四座玻璃培養槽（槽內是 Coral）、加高的頂環
function hqTier2(k, M) {
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a) * 6.3,
      z = Math.sin(a) * 6.3;
    k.cyl(M.white, 1.25, 1.35, 0.6, x, 1.6, z, 0, 0, 0, 12);
    k.cyl(M.glass, 1.0, 1.0, 3.6, x, 3.7, z, 0, 0, 0, 12);
    k.cyl(M.coral, 0.45, 0.55, 3.2, x, 3.7, z, 0, 0, 0, 8);
    k.cyl(M.white2, 1.15, 1.2, 0.45, x, 5.7, z, 0, 0, 0, 12);
    k.pipe(M.gray, [x, 5.8, z], [x * 0.7, 6.4, z * 0.7], 0.12);
  }
  k.cyl(M.white2, 3.4, 3.4, 1.4, 0, 14.3, 0, 0, 0, 0, 16);
  k.cyl(M.team, 3.45, 3.45, 0.3, 0, 14.6, 0, 0, 0, 0, 16);
  k.cyl(M.coral, 2.2, 2.6, 0.6, 0, 15.3, 0, 0, 0, 0, 16);
}
// 第三階（深層研究院，高 18）：中央的高塔（尖塔）與懸浮的稜鏡環（加色、會轉，另外建）
function hqTier3(k, M) {
  k.cyl(M.white, 0.9, 1.4, 3.5, 0, 16.6, 0, 0, 0, 0, 10);
  k.cyl(M.team, 1.0, 1.0, 0.3, 0, 17.0, 0, 0, 0, 0, 10);
  k.cyl(M.coral, 0.05, 0.6, 2.2, 0, 19.1, 0, 0, 0, 0, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.bar(
      M.gray,
      [Math.cos(a) * 3.2, 14.9, Math.sin(a) * 3.2],
      [Math.cos(a) * 0.8, 17.6, Math.sin(a) * 0.8],
      0.2,
    );
  }
}
function prismRing() {
  const g = new THREE.Group();
  const k = new PK(false);
  const M = new THREE.MeshBasicMaterial({ color: CORAL_CYAN });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.geo(M, oct(), Math.cos(a) * 4.4, 0, Math.sin(a) * 4.4, 0, a, 0, 0.35, 0.8, 0.35);
  }
  const prisms = k.build(new THREE.Group());
  // 稜鏡與光環合成一個加色網格（會轉）
  const geos = [];
  prisms.traverse((o) => {
    if (o.isMesh) geos.push(o.geometry.clone().applyMatrix4(o.matrix));
  });
  geos.push(
    ring(4.4, 0.06, 40)
      .rotateX(Math.PI / 2)
      .toNonIndexed(),
  );
  const merged = mergeGeos(geos);
  const sp = spinner(merged, CORAL_CYAN, 0.85, 0.5);
  sp.position.y = 16.2;
  g.add(sp);
  return { g, sp };
}
// 幾何合併（只有 position＋normal，非索引）
function mergeGeos(list) {
  let n = 0;
  const L = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of L) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  let o = 0;
  for (const g of L) {
    pos.set(g.attributes.position.array, o);
    o += g.attributes.position.array.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.computeVertexNormals();
  return out;
}
// 導管節點（4×4、高 7）：六角座＋細長的白色柱＋頂端的 Coral 球；會轉的發光環另外建（rig.ring）
function nodeBody(k, M) {
  k.cyl(M.gray, 1.9, 2.1, 0.5, 0, 0.25, 0, 0, 0, 0, 6);
  k.cyl(M.white, 1.4, 1.7, 0.7, 0, 0.85, 0, 0, 0, 0, 6);
  k.geo(M.coral, ring(1.55, 0.1, 6), 0, 1.25, 0, Math.PI / 2, 0, Math.PI / 6);
  k.cyl(M.white2, 0.35, 0.5, 5.2, 0, 3.7, 0, 0, 0, 0, 8);
  k.cyl(M.team, 0.52, 0.52, 0.35, 0, 2.2, 0, 0, 0, 0, 8);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.prism(
      M.white,
      [
        [0, 0],
        [0.9, 0],
        [0, 3.2],
      ],
      0.12,
      Math.cos(a) * 0.4,
      1.2,
      Math.sin(a) * 0.4,
      0,
      -a,
      0,
    );
  }
  k.cyl(M.dark, 0.6, 0.45, 0.4, 0, 6.3, 0, 0, 0, 0, 8);
  k.geo(M.coral, oct(), 0, 6.9, 0, 0, 0.3, 0, 0.38, 0.55, 0.38);
}
// Coral 汲取塔（8×8、高 10）：湧出點上的三腳架＋向上的 Coral 管＋頂部的收集器
function tapBody(k, M) {
  k.geo(M.gray, ring(3.6, 0.45, 12), 0, 0.35, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    k.cyl(M.white, 0.55, 0.7, 0.5, c * 3.5, 0.3, s * 3.5, 0, 0, 0, 8);
    k.bar(M.white, [c * 3.5, 0.4, s * 3.5], [c * 0.9, 8.2, s * 0.9], 0.36);
    k.bar(M.team, [c * 2.7, 2.8, s * 2.7], [c * 2.3, 4.0, s * 2.3], 0.42);
  }
  k.cyl(M.coral, 0.42, 0.5, 9, 0, 4.9, 0, 0, 0, 0, 8);
  for (const y of [2.4, 4.6, 6.8]) k.cyl(M.white2, 0.62, 0.62, 0.25, 0, y, 0, 0, 0, 0, 8);
  k.cyl(M.white, 1.6, 1.1, 1.2, 0, 8.8, 0, 0, 0, 0, 12);
  k.cyl(M.team, 1.62, 1.62, 0.25, 0, 9.1, 0, 0, 0, 0, 12);
  k.geo(M.glass, hemi(), 0, 9.4, 0, 0, 0, 0, 1.2, 0.7, 1.2);
  k.geo(M.coral, oct(), 0, 9.9, 0, 0, 0.5, 0, 0.3, 0.5, 0.3);
}
// 生體培養槽（12×12、高 8）：圓形平台＋2×2 的直立玻璃槽（槽內是實驗體的剪影）＋中央的處理機
function labBody(k, M) {
  k.cb(M.gray, 12, 0.6, 12, 0, 0.3, 0, 0, 0, 0, 0.5);
  k.cb(M.white, 11, 0.5, 11, 0, 0.85, 0, 0, 0, 0, 0.6);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const x = sx * 3.1,
        z = sz * 3.1;
      k.cyl(M.white2, 2, 2.2, 1, x, 1.6, z, 0, 0, 0, 14);
      k.cyl(M.glass, 1.75, 1.75, 4.6, x, 4.4, z, 0, 0, 0, 14);
      // 槽內的剪影（深色的肉塊＋發光的液面）
      k.geo(M.dark, new THREE.SphereGeometry(1, 8, 6), x, 3.6, z, 0, 0, 0, 0.95, 1.05, 0.95);
      k.cyl(M.coral, 1.78, 1.78, 0.2, x, 2.4, z, 0, 0, 0, 14);
      k.cyl(M.coral, 1.78, 1.78, 0.12, x, 6.5, z, 0, 0, 0, 14);
      k.cyl(M.white, 2, 1.85, 0.7, x, 7.05, z, 0, 0, 0, 14);
      k.cyl(M.team, 2.02, 2.02, 0.2, x, 7.3, z, 0, 0, 0, 14);
      k.pipe(M.gray, [x * 0.55, 7.2, z * 0.55], [x * 0.18, 5.6, z * 0.18], 0.16);
    }
  k.cyl(M.white, 1.2, 1.5, 4.6, 0, 3.4, 0, 0, 0, 0, 10);
  k.geo(M.coral, ring(1.3, 0.12, 12), 0, 4.2, 0, Math.PI / 2, 0, 0);
  k.geo(M.glass, hemi(), 0, 5.7, 0, 0, 0, 0, 1.2, 0.8, 1.2);
  k.box(M.dark, 2.4, 0.6, 0.12, 0, 1.3, 5.6);
}
// 光學兵器廠（14×12、高 10）：低矮的白色廠房（圓弧屋頂）＋屋頂的光學陣列（三組透鏡）
function foundryBody(k, M) {
  k.cb(M.gray, 14, 0.6, 12, 0, 0.3, 0, 0, 0, 0, 0.4);
  k.cb(M.white, 12.4, 4.6, 10, 0, 2.9, 0, 0, 0, 0, 0.8);
  // 圓弧屋頂（沿 Z 的半圓柱）
  k.geo(
    M.white2,
    new THREE.CylinderGeometry(1, 1, 1, 20, 1, false, 0, Math.PI),
    0,
    5.2,
    0,
    Math.PI / 2,
    0,
    Math.PI / 2,
    6.1,
    9.8,
    2.2,
  );
  k.box(M.team, 12.5, 0.35, 10.1, 0, 5.15, 0);
  k.box(M.glass, 12.45, 0.9, 10.05, 0, 3.6, 0);
  // 正面（+Z）的大門
  k.cb(M.dark, 6.4, 3.8, 0.3, 0, 2.5, 5.05, 0, 0, 0, 0.1);
  k.box(M.coral, 6.8, 0.15, 0.12, 0, 4.55, 5.12);
  // 屋頂的光學陣列
  for (const x of [-4, 0, 4]) {
    k.cyl(M.gray, 0.25, 0.3, 2.2, x, 7.8, -1.5, 0, 0, 0, 6);
    k.at(x, 9.1, -1.5, -0.5, 0, 0, () => {
      k.cyl(M.white, 1.2, 1.3, 0.35, 0, 0, 0, 0, 0, 0, 14);
      k.cyl(M.glass, 1.0, 1.0, 0.4, 0, 0.05, 0, 0, 0, 0, 14);
      k.cyl(M.coral, 0.32, 0.32, 0.45, 0, 0.08, 0, 0, 0, 0, 8);
    });
  }
  // 側面的冷卻槽
  for (const s of [-1, 1]) {
    k.cyl(M.white2, 0.9, 0.9, 3.2, s * 6.6, 1.9, -3.4, 0, 0, 0, 10);
    k.cyl(M.coral, 0.92, 0.92, 0.2, s * 6.6, 2.6, -3.4, 0, 0, 0, 10);
  }
}
// Coral 研究所（12×10、高 11）：天文台風格的圓頂＋觀測鏡＋研究棟
function instBody(k, M) {
  k.cb(M.gray, 12, 0.6, 10, 0, 0.3, 0, 0, 0, 0, 0.4);
  k.cb(M.white, 10, 4.2, 8.4, 0, 2.7, 0, 0, 0, 0, 0.7);
  k.box(M.glass, 10.05, 1, 8.45, 0, 3.1, 0);
  k.box(M.team, 10.1, 0.3, 8.5, 0, 4.75, 0);
  k.cyl(M.white2, 3.9, 4, 0.8, 0, 5.2, 0, 0, 0, 0, 20);
  k.geo(M.white, hemi(), 0, 5.6, 0, 0, 0, 0, 3.8, 3.6, 3.8);
  // 圓頂的開縫與觀測鏡
  k.box(M.dark, 1.1, 0.12, 4, 0, 8.6, 1.3, -0.55, 0, 0);
  k.cyl(M.gray, 0.55, 0.7, 3.6, 0, 9.4, 1.6, -0.75, 0, 0, 10);
  k.cyl(M.coral, 0.5, 0.5, 0.2, 0, 10.5, 2.75, -0.75, 0, 0, 10);
  k.geo(M.coral, ring(3.95, 0.1, 28), 0, 5.6, 0, Math.PI / 2, 0, 0);
  // 側面的天線陣列
  for (const s of [-1, 1]) {
    k.cyl(M.gray, 0.08, 0.1, 2.4, s * 4.3, 6, -3.2, 0, 0, 0, 6);
    k.geo(M.coral, oct(), s * 4.3, 7.4, -3.2, 0, 0, 0, 0.18, 0.3, 0.18);
  }
  k.box(M.dark, 2.2, 2.6, 0.12, 0, 1.9, 4.24);
}
// 保全雷射網（5×5、高 6）：兩根柵欄柱＋柱間的光束＋上方轉動的發射頭（另外建，rig.turret）
function fenceBody(k, M) {
  k.cb(M.gray, 5, 0.5, 5, 0, 0.25, 0, 0, 0, 0, 0.3);
  for (const s of [-1, 1]) {
    k.cyl(M.white, 0.4, 0.5, 4.6, s * 1.9, 2.8, 0, 0, 0, 0, 8);
    k.cyl(M.team, 0.52, 0.52, 0.3, s * 1.9, 1.4, 0, 0, 0, 0, 8);
    k.geo(M.coral, oct(), s * 1.9, 5.3, 0, 0, 0, 0, 0.3, 0.45, 0.3);
  }
  for (const y of [1.6, 2.6, 3.6]) k.box(M.coral, 3.4, 0.08, 0.08, 0, y, 0);
  k.cyl(M.white2, 0.8, 1, 3, 0, 2, -1.3, 0, 0, 0, 10);
}
function fenceHead(M) {
  const k = new PK(false);
  k.cyl(M.white, 0.7, 0.8, 0.6, 0, 0, 0, 0, 0, 0, 10);
  k.cb(M.white2, 1, 0.6, 1.4, 0, 0.5, -0.3, 0, 0, 0, 0.15);
  k.cyl(M.dark, 0.18, 0.24, 1.1, 0, 0.5, -1.3, Math.PI / 2, 0, 0, 8);
  k.cyl(M.coral, 0.2, 0.2, 0.12, 0, 0.5, -1.86, Math.PI / 2, 0, 0, 8);
  const tur = k.build(new THREE.Group());
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.5, -1.95);
  tur.add(muzzle);
  return { tur, muzzle };
}
// 樣本保管庫（10×8、高 7）：低溫保存櫃（結霜的櫃體、青色的狀態燈）
function vaultBody(k, M) {
  k.cb(M.gray, 10, 0.5, 8, 0, 0.25, 0, 0, 0, 0, 0.3);
  k.cb(M.white, 8.6, 3.6, 6.4, 0, 2.3, -0.4, 0, 0, 0, 0.6);
  k.geo(
    M.white2,
    new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, 0, Math.PI),
    0,
    4.1,
    -0.4,
    0,
    0,
    Math.PI / 2,
    2.6,
    8.6,
    3.2,
  );
  k.box(M.team, 8.7, 0.3, 6.5, 0, 4.05, -0.4);
  for (let i = 0; i < 4; i++) {
    const x = -3.1 + i * 2.07;
    k.cb(M.white2, 1.7, 2.8, 0.25, x, 2.2, 2.85, 0, 0, 0, 0.08);
    k.box(M.glass, 1.2, 1.6, 0.06, x, 2.4, 3.0);
    k.box(M.coral, 0.9, 0.12, 0.06, x, 3.35, 3.0);
  }
  for (const s of [-1, 1]) {
    k.cyl(M.white, 0.7, 0.7, 2.4, s * 4.6, 1.7, 2.6, 0, 0, 0, 10);
    k.cyl(M.coral, 0.72, 0.72, 0.15, s * 4.6, 2.5, 2.6, 0, 0, 0, 10);
  }
  k.cyl(M.gray, 0.5, 0.5, 1.4, 2.6, 5.4, -1.6, 0, 0, 0, 8);
}
// 浮游砲格納庫（14×14、高 9）：開放式的圓形停機架（四根弧形支柱＋頂環）
function hangarBody(k, M) {
  k.cyl(M.gray, 6.9, 7, 0.6, 0, 0.3, 0, 0, 0, 0, 24);
  k.cyl(M.white, 6.4, 6.6, 0.5, 0, 0.85, 0, 0, 0, 0, 24);
  k.cyl(M.dark, 4.5, 4.5, 0.08, 0, 1.12, 0, 0, 0, 0, 24);
  k.geo(M.coral, ring(4.6, 0.14, 32), 0, 1.15, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const c = Math.cos(a),
      s = Math.sin(a);
    k.bar(M.white, [c * 6.2, 1, s * 6.2], [c * 6.6, 5, s * 6.6], 0.6);
    k.bar(M.white, [c * 6.6, 5, s * 6.6], [c * 5.6, 8.4, s * 5.6], 0.5);
    k.cb(M.team, 0.9, 0.5, 0.9, c * 6.6, 5, s * 6.6, 0, -a, 0, 0.1);
    // 停機座
    k.cb(M.white2, 1.6, 0.4, 1.6, c * 3, 1.4, s * 3, 0, -a, 0, 0.15);
    k.cyl(M.coral, 0.3, 0.3, 0.12, c * 3, 1.65, s * 3, 0, 0, 0, 8);
  }
  k.geo(M.white2, ring(5.7, 0.3, 32), 0, 8.5, 0, Math.PI / 2, 0, 0);
  k.geo(M.coral, ring(5.7, 0.1, 32), 0, 8.1, 0, Math.PI / 2, 0, 0);
  k.cyl(M.white, 1.2, 1.6, 1.6, 0, 1.9, 0, 0, 0, 0, 12);
}
const BODY = {
  a_hq: hqBody,
  a_hq2: hqBody,
  a_hq3: hqBody,
  a_node: nodeBody,
  a_tap: tapBody,
  a_lab: labBody,
  a_foundry: foundryBody,
  a_inst: instBody,
  a_fence: fenceBody,
  a_vault: vaultBody,
  a_hangar: hangarBody,
};
const HQ_IDS = new Set(['a_hq', 'a_hq2', 'a_hq3']);
export const isAethBuilding = (id) => !!BODY[id];

// 建造中的結晶外殼（取代卡斯特隆的鷹架）：佔地上的六角結晶殼＋地面的結晶尖（依進度從地面往上長）
function crystalShell(w, d, h) {
  const S = shared();
  const g = new THREE.Group();
  const r = Math.max(w, d) * 0.56;
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.82, r, 1, 6, 1, true), S.crystal);
  shell.position.y = 0.5;
  shell.userData.rtsShell = 1;
  g.add(shell);
  const k = new PK(false);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    k.geo(S.crystal, oct(), Math.cos(a) * r * 0.95, 0.5, Math.sin(a) * r * 0.95, 0.3, a, 0.2, 0.5, 1.1, 0.5);
  }
  const spikes = k.build(new THREE.Group(), false);
  spikes.traverse((o) => {
    if (o.isMesh) o.userData.rtsShell = 1;
  });
  g.add(spikes);
  shell.scale.y = h;
  g.userData.shell = shell;
  return g;
}

export function buildAethBuilding(id, pal) {
  const D = RTS_DEFS[id] || { foot: [8, 8], height: 8 };
  const M = mats(pal);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const k = new PK(false);
  (BODY[id] || nodeBody)(k, M);
  k.build(body);
  group.add(body);
  const [w, d] = D.foot;
  const scaf = crystalShell(w, d, D.height);
  scaf.visible = false;
  group.add(scaf);
  const spins = []; // 會轉的光環（斷電時熄滅）
  let powered = true;
  const rig = {
    group,
    body,
    scaf,
    torso: body,
    height: D.height,
    vehicle: true,
    cls: 'bld',
    aeth: true,
    progress: 1,
    // 建造進度（0～1）：本體往上長、結晶外殼從地面長到全高（完成時消失）
    setProgress(p) {
      p = Math.max(0, Math.min(1, p));
      rig.progress = p;
      body.scale.y = 0.06 + 0.94 * p;
      scaf.visible = p < 1;
      scaf.userData.shell.scale.y = D.height * (0.15 + 0.9 * p);
      for (const s of spins) s.visible = p >= 1;
    },
    // 供電（docs 14.2 的停擺外觀）：Coral 與隊伍色的發光熄滅、會轉的光環停下變暗（斷電圖示在 HUD）
    setPower(on) {
      on = !!on;
      if (powered === on) return;
      powered = on;
      rig.powered = on;
      const re = rig.merged && rig.unmerge;
      if (re) rig.unmerge();
      M.coral.emissiveIntensity = on ? 1.5 : 0;
      M.coral.color.setHex(on ? CORAL_BASE : OFF_GRAY);
      M.teamGlow.emissiveIntensity = on ? 1 : 0.1;
      for (const s of spins) {
        s.userData.on = on;
        s.material.opacity = on ? s.userData.op : s.userData.op * 0.15;
      }
      if (re) rig.remerge();
    },
    powered: true,
    coralK: () => M.coral.emissiveIntensity, // 目前的 Coral 發光（測試用）
  };
  // 研究中樞三階（同一個模型切換子群組的 visible）
  if (HQ_IDS.has(id)) {
    const mk = (fn) => {
      const kk = new PK(false);
      fn(kk, M);
      const grp = kk.build(new THREE.Group());
      body.add(grp);
      return grp;
    };
    rig.tier2 = mk(hqTier2);
    rig.tier3 = mk(hqTier3);
    const pr = prismRing();
    rig.tier3.add(pr.g);
    spins.push(pr.sp);
    rig.tier = 0;
    rig.setTier = (n) => {
      n = Math.max(1, Math.min(3, n | 0));
      if (rig.tier === n) return;
      const re = rig.merged && rig.unmerge;
      if (re) rig.unmerge();
      rig.tier = n;
      rig.tier2.visible = n >= 2;
      rig.tier3.visible = n >= 3;
      if (re) rig.remerge();
    };
    rig.setTier(D.tier || 1);
  }
  // 導管節點：頂端的發光環（有電時慢慢轉）
  if (id === 'a_node') {
    const sp = spinner(ring(1.05, 0.07, 20).rotateX(Math.PI / 2), CORAL_CYAN, 0.9, 0.9);
    sp.position.y = 6.2;
    body.add(sp);
    spins.push(sp);
    rig.ring = sp;
  }
  // 汲取塔：收集器外的光環
  if (id === 'a_tap') {
    const sp = spinner(ring(2.1, 0.06, 24).rotateX(Math.PI / 2), CORAL_CYAN, 0.7, -0.6);
    sp.position.y = 7.6;
    body.add(sp);
    spins.push(sp);
  }
  // 雷射網的發射頭（rig.turret 繞 Y；rig.muzzle＝光束的起點）
  if (id === 'a_fence') {
    const { tur, muzzle } = fenceHead(M);
    tur.position.set(0, 5.2, -1.3);
    body.add(tur);
    rig.turret = tur;
    rig.muzzle = muzzle;
  }
  rig.aimAt = (yaw) => {
    if (rig.turret) rig.turret.rotation.y = yaw;
  };
  return rig;
}

// ---------- 研究作業機的採樣套件 ----------
// 背上的 Coral 採樣槽（發光的窗）、頭頂的青色信號燈、右手的掃描頭（採集時轉動，rig.rtsDrill）、攜帶礦石的貨箱（rig.rtsCrate）
export function addAethWorkerKit(rig, pal, buildOreCrate) {
  const t = mechKit(rig, rig.torso || rig.group);
  const kit = new THREE.Group();
  const k = new PK(false);
  const wh = mat(0xd8e0e8, { roughness: 0.4, metalness: 0.15 }),
    gl = mat(CORAL_BASE, { emissive: CORAL_CYAN, emissiveIntensity: 1.4, roughness: 0.3, metalness: 0.1 }),
    dk = mat(0x1e2632, { roughness: 0.6, metalness: 0.45 });
  // 採樣槽：兩支直立的膠囊槽＋連接的管線
  for (const s of [-1, 1]) {
    k.cyl(wh, 0.26, 0.26, 1.1, s * 0.32, 1.75, 0.75, 0, 0, 0, 10);
    k.cyl(gl, 0.18, 0.18, 0.7, s * 0.32, 1.75, 0.95, 0, 0, 0, 8);
    k.cyl(dk, 0.28, 0.28, 0.14, s * 0.32, 2.32, 0.75, 0, 0, 0, 10);
  }
  k.box(dk, 0.9, 0.3, 0.4, 0, 1.2, 0.6);
  k.pipe(wh, [0.32, 2.38, 0.75], [0, 2.5, 0.35], 0.06);
  k.pipe(wh, [-0.32, 2.38, 0.75], [0, 2.5, 0.35], 0.06);
  k.build(kit);
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8),
    mat(CORAL_BASE, { emissive: CORAL_CYAN, emissiveIntensity: 2, roughness: 0.4, metalness: 0 }),
  );
  beacon.position.set(0, 2.05, 0.2);
  kit.add(beacon);
  t.add(kit);
  if (buildOreCrate) {
    const crate = buildOreCrate();
    crate.position.set(0, 0.9, 1.05);
    crate.scale.setScalar(0.7);
    crate.visible = false;
    t.add(crate);
    rig.rtsCrate = crate;
  }
  // 右手的掃描頭：支架＋會轉的掃描環＋發光的鏡頭
  const hand = mechKit(rig, rig.arms && rig.arms.r && rig.arms.r.hand);
  if (hand) {
    const sk = new PK(false);
    sk.cyl(dk, 0.1, 0.12, 0.45, 0, -0.3, 0, 0, 0, 0, 8);
    sk.cyl(gl, 0.14, 0.14, 0.08, 0, -0.58, 0, 0, 0, 0, 10);
    const head = sk.build(new THREE.Group());
    const sr = new PK(false);
    sr.geo(wh, ring(0.32, 0.05, 12), 0, 0, 0, Math.PI / 2, 0, 0);
    sr.box(gl, 0.1, 0.06, 0.1, 0.32, 0, 0);
    sr.box(gl, 0.1, 0.06, 0.1, -0.32, 0, 0);
    const scan = sr.build(new THREE.Group());
    scan.position.y = -0.5;
    head.add(scan);
    hand.add(head);
    rig.rtsDrill = scan;
  }
  rig.rtsKit = kit;
  rig.rtsBeacon = beacon;
  return rig;
}

// ---------- 原型體的外加零件（嵌合體的模型＋背上的 Coral 結晶與發光脈管） ----------
// 合併過的模型先還原、加上去之後再合併（render/rts-merge.js）
export function addProtoKit(rig) {
  if (!rig || rig.rtsProtoKit) return rig;
  const re = rig.merged && rig.unmerge;
  if (re) rig.unmerge();
  const t = mechKit(rig, rig.torso || rig.group);
  const k = new PK(false);
  const gl = mat(CORAL_BASE, {
      emissive: CORAL_CYAN,
      emissiveIntensity: 1.6,
      roughness: 0.25,
      metalness: 0.1,
    }),
    bone = mat(0xd8d2c8, { roughness: 0.7, metalness: 0.05 });
  const C = [
    [0, 4.5, 0.7, 0.42, 1.5, 0],
    [0.7, 4.15, 0.5, 0.3, 1.15, 0.5],
    [-0.75, 4.2, 0.6, 0.32, 1.2, -0.45],
    [0.35, 4.0, 1.35, 0.26, 0.95, 0.3],
    [-0.4, 4.05, -0.1, 0.26, 0.9, -0.3],
  ];
  for (const [x, y, z, s, sy, r] of C) k.geo(gl, oct(), x, y, z, r * 0.4, r, r * 0.6, s, sy, s);
  // 結晶的骨質底座與發光的脈管
  k.geo(bone, new THREE.SphereGeometry(1, 8, 6), 0, 3.65, 0.6, 0, 0, 0, 1.1, 0.4, 1.0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    k.pipe(
      gl,
      [Math.cos(a) * 0.7, 3.7, Math.sin(a) * 0.7 + 0.6],
      [Math.cos(a) * 1.9, 2.6, Math.sin(a) * 1.8 + 0.2],
      0.08,
      4,
    );
  }
  const kit = k.build(new THREE.Group());
  t.add(kit);
  rig.rtsProtoKit = kit;
  if (re) rig.remerge();
  return rig;
}

// ---------- 導管連線（一隊的全部連線合併成一個貼地的網格） ----------
// links＝Game.rtsPowerLinks 的 [[a, b, on]]；沿地形每 4 m 一段取高度、寬 0.35 m 的發光管（有電＝Coral 青、沒電＝暗灰）。
// 著色器查戰爭迷霧的「探索過」貼圖（world/rts-props.js 的 RTS_PROP_FOG），沒探索過的格子不畫（敵方的連線也是）
let LINK_MAT = null;
function linkMat() {
  if (LINK_MAT) return LINK_MAT;
  const m = new THREE.MeshBasicMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, RTS_PROP_FOG);
    sh.vertexShader = sh.vertexShader.replace(
      'void main() {',
      'varying vec2 vRtsW;\nvoid main() {\n\tvRtsW = ( modelMatrix * vec4( position, 1.0 ) ).xz;',
    );
    sh.fragmentShader = sh.fragmentShader.replace(
      'void main() {',
      [
        'uniform sampler2D rtsFogTex;',
        'uniform vec3 rtsFogM;',
        'uniform float rtsFogOn;',
        'varying vec2 vRtsW;',
        'void main() {',
        '\tif ( rtsFogOn > 0.5 ) {',
        '\t\tvec2 rc = floor( ( vRtsW + rtsFogM.x ) / rtsFogM.y );',
        '\t\tif ( rc.x >= 0.0 && rc.y >= 0.0 && rc.x < rtsFogM.z && rc.y < rtsFogM.z && texture2D( rtsFogTex, ( rc + 0.5 ) / rtsFogM.z ).r < 0.5 ) discard;',
        '\t}',
      ].join('\n'),
    );
  };
  m.customProgramCacheKey = () => 'rtsConduitLink';
  LINK_MAT = m;
  return m;
}
export function buildConduitLinks(links, world) {
  const W = 0.3, // 半寬（整條寬約 0.6 m，RTS 的鏡頭才看得到）
    SEG = 4,
    LIFT = 0.22;
  const pos = [],
    col = [];
  const on = new THREE.Color(CORAL_CYAN),
    off = new THREE.Color(0x2c3238),
    edge = new THREE.Color(0x2a6c90),
    edgeOff = new THREE.Color(0x1a1e22);
  const hAt = (x, z) => (world ? world.terrainHeight(x, z) : 0) + LIFT;
  for (const [a, b, lit] of links) {
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    const ux = dx / L,
      uz = dz / L,
      px = -uz * W,
      pz = ux * W;
    const n = Math.max(1, Math.ceil(L / SEG));
    const c = lit ? on : off,
      e = lit ? edge : edgeOff;
    for (let i = 0; i < n; i++) {
      const s0 = (i / n) * L,
        s1 = ((i + 1) / n) * L;
      const x0 = a.x + ux * s0,
        z0 = a.z + uz * s0,
        x1 = a.x + ux * s1,
        z1 = a.z + uz * s1;
      const y0 = hAt(x0, z0),
        y1 = hAt(x1, z1);
      // 中間凸起的管（兩個斜面）：外緣 → 中線（高 0.12）→ 外緣
      const top0 = y0 + 0.12,
        top1 = y1 + 0.12;
      const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, ddx, ddy, ddz, ca, cb) => {
        // 由上往下看是逆時針（正面朝上）
        pos.push(ax, ay, az, cx, cy, cz, bx, by, bz, ax, ay, az, ddx, ddy, ddz, cx, cy, cz);
        for (const q of [ca, cb, cb, ca, ca, cb]) col.push(q.r, q.g, q.b);
      };
      // 左斜面
      quad(x0 + px, y0, z0 + pz, x0, top0, z0, x1, top1, z1, x1 + px, y1, z1 + pz, e, c);
      // 右斜面
      quad(x0, top0, z0, x0 - px, y0, z0 - pz, x1 - px, y1, z1 - pz, x1, top1, z1, c, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, linkMat());
  m.castShadow = false;
  m.receiveShadow = false;
  m.userData.noFade = true;
  m.userData.rtsLinks = true;
  return m;
}
// 遊戲端：這一隊的導管版本號（T.power.ver）變了就重建連線網格（掛在 R.g 底下，rtsClear 一起移除）
export function syncConduitLinks(game, teamId) {
  const R = game && game.rts,
    T = R && R.teams[teamId];
  if (!T || !T.power || !game.rtsPowerLinks) return null;
  const L = R.aethLinks || (R.aethLinks = {});
  const cur = L[teamId];
  if (cur && cur.ver === T.power.ver) return cur.mesh;
  if (cur && cur.mesh) {
    if (cur.mesh.parent) cur.mesh.parent.remove(cur.mesh);
    cur.mesh.geometry.dispose();
  }
  const links = game.rtsPowerLinks(teamId);
  const mesh = links.length ? buildConduitLinks(links, game.world) : null;
  if (mesh) (R.g || game.scene).add(mesh);
  L[teamId] = { ver: T.power.ver, mesh, n: links.length };
  return mesh;
}

// ---------- 模型庫目錄 ----------
const P0 = () => palOf(0);
const bldNote = (id) => {
  const D = RTS_DEFS[id];
  return `Coral 戰爭（艾瑟立克）；佔地 ${D.foot[0]} × ${D.foot[1]} m、高約 ${D.height} m，原點在底面中心、正面 +Z；隊伍色在環帶`;
};
const withState = (id, f) => {
  const r = buildAethBuilding(id, P0());
  f(r);
  return r.group;
};
export const RTS_AETH_CATALOG = [
  ...[
    ['a_hq', '艾瑟立克：研究中樞', '；導管的根'],
    ['a_hq2', '艾瑟立克：Coral 研究院（研究中樞 T2）', '；外圈的培養槽'],
    ['a_hq3', '艾瑟立克：深層研究院（研究中樞 T3）', '；高塔與懸浮的稜鏡環'],
    ['a_node', '艾瑟立克：導管節點', '；頂端的光環有電時轉動'],
    ['a_tap', '艾瑟立克：Coral 汲取塔', '；蓋在 Coral 湧出點上'],
    ['a_lab', '艾瑟立克：生體培養槽', ''],
    ['a_foundry', '艾瑟立克：光學兵器廠', ''],
    ['a_inst', '艾瑟立克：Coral 研究所', ''],
    ['a_fence', '艾瑟立克：保全雷射網', '；發射頭朝目標轉動'],
    ['a_vault', '艾瑟立克：樣本保管庫', ''],
    ['a_hangar', '艾瑟立克：浮游砲格納庫', ''],
  ].map(([id, name, extra]) => [
    'prop',
    id,
    name,
    bldNote(id) + extra,
    () => {
      const r = buildAethBuilding(id, P0());
      if (r.setTier) r.setTier(RTS_DEFS[id].tier || 1);
      return r.group;
    },
  ]),
  [
    'prop',
    'a_site',
    '艾瑟立克：建造中的建築（兵器廠 40%）',
    'Coral 戰爭；結晶外殼從地面往上長（建築自己長，沒有鷹架）',
    () => withState('a_foundry', (r) => r.setProgress(0.4)),
  ],
  [
    'prop',
    'a_off',
    '艾瑟立克：停擺的建築（培養槽）',
    'Coral 戰爭；導管斷電：Coral 管線與隊伍色的發光熄滅（閃爍的斷電圖示畫在 HUD）',
    () => withState('a_lab', (r) => r.setPower(false)),
  ],
  [
    'vehicle',
    'a_worker',
    '艾瑟立克：研究作業機',
    'Coral 戰爭的工人；輕量機甲＋背上的 Coral 採樣槽、右手的掃描頭',
    () => {
      const rig = buildMech(RTS_DEFS.a_worker.asm, P0(), 1);
      return addAethWorkerKit(rig, P0()).group;
    },
  ],
  [
    'small',
    'conduit_link',
    '艾瑟立克：導管連線',
    'Coral 戰爭；節點之間貼地的發光管（一隊合併成一個網格；斷電＝暗灰）',
    () =>
      buildConduitLinks([
        [{ x: -12, z: 0 }, { x: 0, z: 0 }, true],
        [{ x: 0, z: 0 }, { x: 10, z: 8 }, false],
      ]),
  ],
];

// ---------- 結晶護壁的外殼（R6 D 包，docs 17.2 #18） ----------
// 建築外加一層加色的半透明結晶殼（多面體＋稜線）：不合併、一隊共用材質（快取），每座的透明度在 onBeforeRender
// 寫進共用材質（three.js 在 onBeforeRender 之後才上傳 uniform）。group.userData.k＝0～1（淡入淡出，遊戲端每格設定）
const AEGIS_GEO = new THREE.IcosahedronGeometry(1, 1);
const AEGIS_EDGE = new THREE.EdgesGeometry(AEGIS_GEO, 1);
AEGIS_GEO.userData.shared = AEGIS_EDGE.userData.shared = true;
const AEGIS_MATS = new Map();
function aegisMats(team) {
  if (!AEGIS_MATS.has(team)) {
    const fill = new THREE.MeshBasicMaterial({
      color: CORAL_CYAN,
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const edge = new THREE.LineBasicMaterial({
      color: 0xc8f4ff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    AEGIS_MATS.set(team, { fill, edge });
  }
  return AEGIS_MATS.get(team);
}
// w×d＝建築的佔地、h＝高度（m）
export function buildAegisShell(team, w, d, h) {
  const M = aegisMats(team);
  const g = new THREE.Group();
  g.userData.helper = true;
  g.userData.k = 0;
  const fill = new THREE.Mesh(AEGIS_GEO, M.fill);
  const edge = new THREE.LineSegments(AEGIS_EDGE, M.edge);
  fill.castShadow = fill.receiveShadow = false;
  fill.renderOrder = edge.renderOrder = 5;
  fill.onBeforeRender = () => {
    M.fill.opacity = 0.16 * g.userData.k;
  };
  edge.onBeforeRender = () => {
    M.edge.opacity = 0.55 * g.userData.k;
  };
  fill.raycast = edge.raycast = () => {};
  g.add(fill, edge);
  g.scale.set(Math.max(2, w * 0.62), Math.max(2, h * 0.62), Math.max(2, d * 0.62));
  return g;
}
