// 地圖專屬敵人擴充 B1 的程式模型（第 1 章：荒野的魚叉拖車、煙幕投射車；沙丘的沙脊狙擊機、旋風產生機；
// 礦坑的坍方爆破手、礦燈哨兵）。介面同 foe-models.js（vehicle: true；原點在地面、正面 −Z）。
// 會動的節點放在 extra（名稱一律 x 開頭，避免和 rig 的 head／legs／body 撞名），由 entities/mech-foe-b1.js 的
// foeFx_b1 依 bossVis／bx 驅動（房主與客機都跑）。預警發光的材質（xWarn）每台各自一份，emissive 依招式漸強。
// rig.dmg：冒煙點、AP 低時脫落的裝甲板（獨立網格，不被 bakeAll 合併）、擊破時拆開的區塊（chunks）。
import { CB as CB0, P, bakeAll, decal, gBox, gCyl, gPod, gSph, kitCable } from './geometry.js';
import {
  beam,
  crect,
  eye,
  front,
  hazard,
  piston,
  rect,
  rod,
  side,
  slats,
  top,
  track,
  wheel,
} from './foe-models.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

const PI = Math.PI,
  HP = Math.PI / 2;
const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
// 加色的光（探照燈光錐、瞄準鏡反光、旋風）：不參與描邊與量測
const addMat = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
// 倒角方塊；小零件（最短邊 < 0.4 m）不倒角（省三角形）
function CB(n, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.06) {
  if (Math.min(w, h, d) < 0.4) P(n, gBox(w, h, d), m, x, y, z, rx, ry, rz);
  else CB0(n, w, h, d, m, x, y, z, rx, ry, rz, c);
}
const grp = (parent, x = 0, y = 0, z = 0) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
};
// 會脫落的裝甲板：獨立網格（不放進 prims，bakeAll 不合併；幾何不共用快取，掉落時可以各自處理）
function plateMesh(parent, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y, z);
  me.rotation.set(rx, ry, rz);
  me.castShadow = true;
  parent.add(me);
  return me;
}
// 螺栓一排（小細節）
function bolts(n, m, x0, y0, z0, dx, dy, dz, k, r = 0.035) {
  for (let i = 0; i < k; i++) P(n, gCyl(r, r, 0.04, 6), m, x0 + dx * i, y0 + dy * i, z0 + dz * i, HP);
}
function base(pal) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  return { M, root, torso };
}
const FOE_TINT = { ao: 0.8, grime: 0.28 };
function finish(root, scale) {
  bakeAll(root, { tint: FOE_TINT, cache: true, k: scale }); // 精細版（docs/model-detail.md）
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material.blending !== THREE.AdditiveBlending) o.castShadow = true;
  });
  tagStyle(root);
}
function rig(root, torso, M, o) {
  const hand = o.hand || new THREE.Group();
  if (!hand.parent) torso.add(hand);
  const back = new THREE.Group();
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
    dmg: o.dmg,
    ...(o.extra || {}),
  };
}

// ---------- 魚叉拖車：六輪重型拖車＋車斗中央的魚叉砲塔＋後方的捲揚機（高約 3.4 m、長 6 m）----------
function buildHarpoon(pal, scale) {
  const { M, root, torso } = base(pal);
  const warn = glow(0xff3a20, 0.3);
  const chassis = grp(torso);
  // 底盤：兩根縱樑、橫樑、三軸六輪與擋泥板
  for (const s of [-1, 1]) {
    P(chassis, gBox(0.22, 0.28, 5.6), M.joint, s * 0.62, 0.78, 0.1);
    for (const z of [-1.9, 0.9, 2.2]) {
      wheel(chassis, M, s * 1.12, 0.55, z, 0.55, 0.42);
      top(chassis, M.main2, crect(0.56, 1.4, 0.18, 0, 0), 0.06, 1.18, 0.02, s * 1.12, z);
      P(chassis, gBox(0.4, 0.3, 0.04), M.rubber, s * 1.12, 0.95, z + 0.66);
    }
  }
  for (const z of [-2.4, -0.6, 1.5, 2.7]) P(chassis, gBox(1.3, 0.14, 0.16), M.joint, 0, 0.82, z);
  for (const z of [-1.9, 0.9, 2.2]) P(chassis, gCyl(0.08, 0.08, 2.0, 6), M.sub, 0, 0.55, z, 0, 0, HP);
  // 車頭：切角的駕駛室＋車窗＋頂上的警示燈條＋前保險桿
  P(
    chassis,
    gPod([
      [-3.0, 2.0, 0.9, 1.7, 0.1, 0.05],
      [-2.75, 2.2, 0.9, 2.45, 0.22, 0.05],
      [-1.45, 2.2, 0.9, 2.55, 0.22, 0.05],
      [-1.3, 2.1, 0.9, 2.4, 0.15, 0.05],
    ]),
    M.main,
  );
  P(chassis, gBox(1.7, 0.36, 0.05), M.lens, 0, 2.15, -2.79, -0.28);
  for (const x of [-0.42, 0.42]) P(chassis, gBox(0.05, 0.4, 0.07), M.joint, x, 2.15, -2.78, -0.28);
  P(chassis, gBox(1.2, 0.1, 0.18), glow(0xffa020, 1.4), 0, 2.62, -2.1);
  CB(chassis, 2.3, 0.3, 0.3, M.joint, 0, 0.95, -3.1, 0, 0, 0, 0.05);
  for (const x of [-0.7, -0.25, 0.25, 0.7]) P(chassis, gBox(0.08, 0.5, 0.08), M.gun, x, 1.25, -3.18);
  for (const s of [-1, 1]) {
    eye(chassis, M, glow(0xfff0c0, 1.6), s * 0.78, 1.45, -3.02, 0.09);
    // 排氣管（駕駛室後方）
    P(chassis, gCyl(0.08, 0.08, 1.3, 6), M.gun, s * 1.0, 2.55, -1.35);
    P(chassis, gCyl(0.1, 0.1, 0.1, 6), M.joint, s * 1.0, 3.2, -1.35);
    // 側面的工具箱＋警示條
    CB(chassis, 0.32, 0.5, 1.3, M.main3, s * 1.0, 1.15, -0.45, 0, 0, 0, 0.03);
    hazard(chassis, M, s * 1.17, 1.32, -0.45, 1.1, 0.12, s * HP);
    bolts(chassis, M.joint, s * 1.17, 1.0, -0.95, 0, 0, 0.25, 5);
  }
  decal(chassis, 3, 0.9, 0.45, 0, 1.75, -2.98, 0, PI, 0);
  // 車斗：低平的板台＋邊框
  P(chassis, gBox(2.0, 0.12, 4.0), M.main2, 0, 1.0, 0.9);
  for (const s of [-1, 1]) P(chassis, gBox(0.1, 0.3, 4.0), M.joint, s * 1.0, 1.18, 0.9);
  // 外伸支腳（鉤住時放下撐地）：xJacks 的 rotation.z 由 0（收起）到 ±1.1（撐地）
  const jacks = [];
  for (const s of [-1, 1]) {
    const j = grp(chassis, s * 0.95, 1.05, 1.9);
    beam(j, M.sub, [0, 0, 0], [s * 1.3, 0, 0], 0.22, 0.24, 0.03);
    piston(j, M, [s * 0.15, 0.2, 0], [s * 1.0, 0.05, 0], 0.045);
    P(j, gBox(0.5, 0.08, 0.5), M.joint, s * 1.35, -0.1, 0);
    jacks.push(j);
  }
  // 捲揚機（車斗後段）：側板、捲筒（xWinch 會轉）、馬達箱與散熱縫
  const winchG = grp(chassis);
  for (const s of [-1, 1]) front(winchG, M.main3, rect(0.12, 1.1), 1.2, 2.5, 0.02, 1, 1, s * 0.75, 1.65);
  const winch = grp(winchG, 0, 1.7, 2.5);
  P(winch, gCyl(0.42, 0.42, 1.3, 10), M.gun, 0, 0, 0, 0, 0, HP);
  for (let i = 0; i < 6; i++) P(winch, gCyl(0.47, 0.47, 0.08, 10), M.rubber, -0.5 + i * 0.2, 0, 0, 0, 0, HP);
  P(winch, gBox(1.32, 0.06, 0.95), M.joint, 0, 0, 0);
  CB(winchG, 0.6, 0.6, 0.7, M.sub, 1.15, 1.6, 2.5, 0, 0, 0, 0.04);
  slats(winchG, M.joint, 1.46, 1.8, 2.5, 0.5, 4, 0.1, -HP);
  kitCable(winchG, M, [
    [0, 2.1, 2.5],
    [0, 2.35, 1.4],
    [0, 2.25, 0.5],
  ]);
  // 魚叉砲塔：旋轉座＋防盾（會脫落）＋長砲管＋後座缸＋瞄準器；砲管前端的鉤頭（xHook）發射時隱藏
  const turret = grp(torso, 0, 1.12, 0.3);
  P(turret, gCyl(0.75, 0.85, 0.3, 10), M.joint, 0, 0.15, 0);
  bolts(turret, M.gun, -0.6, 0.31, -0.3, 0.2, 0, 0.1, 7, 0.03);
  // 砲座的支柱：砲管要高過駕駛室
  P(turret, gCyl(0.32, 0.4, 1.3, 8), M.sub, 0, 0.9, 0.1);
  piston(turret, M, [0.45, 0.3, 0.5], [0.25, 1.4, 0.3], 0.05);
  const launcher = grp(turret, 0, 1.75, 0);
  CB(launcher, 0.9, 0.7, 1.5, M.main, 0, 0, 0.1, 0, 0, 0, 0.08);
  P(launcher, gCyl(0.16, 0.2, 2.6, 8), M.gun, 0, 0.05, -1.7, HP);
  P(launcher, gCyl(0.24, 0.24, 0.35, 8), M.joint, 0, 0.05, -2.95, HP);
  for (const s of [-1, 1]) {
    piston(launcher, M, [s * 0.32, -0.2, 0.3], [s * 0.28, -0.05, -1.4], 0.05);
    P(launcher, gBox(0.06, 0.2, 0.3), M.joint, s * 0.28, 0.05, -2.95);
  }
  CB(launcher, 0.26, 0.26, 0.6, M.sub, 0.5, 0.42, -0.2, 0, 0, 0, 0.02);
  eye(launcher, M, glow(0xff5030, 1.8), 0.5, 0.42, -0.52, 0.06);
  hazard(launcher, M, 0, 0.36, -0.66, 0.8, 0.1);
  decal(launcher, 6, 0.5, 0.25, -0.46, 0.05, 0.1, 0, -HP, 0);
  const hook = grp(launcher, 0, 0.05, -3.15);
  P(hook, gCyl(0.0, 0.22, 0.6, 8), warn, 0, 0, -0.3, -HP);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    beam(hook, M.acc, [0, 0, -0.1], [Math.cos(a) * 0.38, Math.sin(a) * 0.38, 0.25], 0.07, 0.05);
  }
  const hand = grp(launcher, 0, 0.05, -3.5);
  // 會脫落的裝甲板：砲塔防盾與兩側車門
  const plG = grp(torso);
  const plates = [
    plateMesh(launcher, 1.3, 0.9, 0.08, M.main2, 0, 0.1, -0.75),
    plateMesh(plG, 0.06, 0.7, 0.9, M.main2, 1.12, 1.75, -2.1),
    plateMesh(plG, 0.06, 0.7, 0.9, M.main2, -1.12, 1.75, -2.1),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'harpoon',
    height: 3.4 * scale,
    dmg: {
      smoke: [
        [0, 2.4, -2.0],
        [0.6, 1.8, 2.4],
        [0, 2.2, 0.3],
      ],
      plates,
      chunks: [turret, winchG, chassis],
    },
    extra: { xWarn: warn, xHook: hook, xLauncher: launcher, xWinch: winch, xJacks: jacks },
  });
}

// ---------- 煙幕投射車：半履帶的裝甲車＋車斗上的六聯煙幕發射架（xRack 預警時抬起）＋旋轉雷達（高約 3.6 m）----------
function buildSmoker(pal, scale) {
  const { M, root, torso } = base(pal);
  const warn = glow(0xd8dce4, 0.2);
  const hull = grp(torso);
  // 前輪＋後履帶
  for (const s of [-1, 1]) {
    wheel(hull, M, s * 1.05, 0.55, -1.75, 0.55, 0.4);
    track(hull, M, s * 1.0, 0.8, 2.6, 0.95, 0.55, 4, M.acc);
    top(hull, M.main2, crect(0.5, 1.3, 0.15), 0.06, 1.15, 0.02, s * 1.05, -1.75);
  }
  // 車體：前端斜面的裝甲箱
  side(
    hull,
    M.main,
    [
      [-2.6, 0.75],
      [2.2, 0.75],
      [2.2, 1.75],
      [-1.2, 1.75],
      [-1.75, 2.45],
      [-2.4, 2.45],
      [-2.75, 1.5],
    ],
    1.9,
    0,
    0.06,
  );
  // 駕駛室的視窗、天窗蓋、頭燈
  P(hull, gBox(1.4, 0.24, 0.05), M.lens, 0, 2.1, -2.12, 0.9);
  for (const x of [-0.35, 0.35]) P(hull, gBox(0.05, 0.28, 0.07), M.joint, x, 2.1, -2.1, 0.9);
  P(hull, gCyl(0.3, 0.3, 0.1, 8), M.sub, 0.35, 2.5, -1.95);
  for (const s of [-1, 1]) eye(hull, M, glow(0xfff0c0, 1.5), s * 0.72, 1.35, -2.72, 0.08);
  // 側面：煙幕罐的掛架（灰色罐子一排）＋警示條＋螺栓
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      P(hull, gCyl(0.13, 0.13, 0.55, 8), M.grey, s * 1.06, 1.3, -0.4 + i * 0.4);
      P(hull, gCyl(0.14, 0.14, 0.06, 8), M.acc, s * 1.06, 1.5, -0.4 + i * 0.4);
    }
    P(hull, gBox(0.06, 0.08, 1.7), M.joint, s * 1.06, 1.62, 0.2);
    hazard(hull, M, s * 0.97, 0.95, 1.4, 1.0, 0.12, s * HP);
    bolts(hull, M.joint, s * 0.97, 1.6, -1.3, 0, 0, 0.22, 4);
    // 排氣管
    P(hull, gCyl(0.07, 0.07, 1.1, 6), M.gun, s * 0.8, 2.1, 1.95);
  }
  decal(hull, 1, 0.8, 0.4, 0.96, 1.25, -1.6, 0, HP, 0);
  // 雷達桅杆（xMast 會轉）
  const mastBase = grp(hull, -0.55, 2.45, -1.6);
  rod(mastBase, M.joint, [0, 0, 0], [0, 0.9, 0], 0.05);
  const mast = grp(mastBase, 0, 0.9, 0);
  P(mast, gBox(0.9, 0.18, 0.06), M.sub, 0, 0, 0);
  for (const x of [-0.4, -0.2, 0, 0.2, 0.4]) P(mast, gBox(0.03, 0.22, 0.08), M.joint, x, 0, -0.04);
  P(mast, gSph(0.07, 6), glow(0xff4020, 2), 0, 0.15, 0);
  // 發射架：底座與液壓桿在車斗上；xRack 繞 X 軸抬起（rotation.x：−0.15 收起、−0.75 發射角）
  const rackG = grp(torso);
  CB(rackG, 1.6, 0.3, 1.8, M.sub, 0, 1.9, 0.9, 0, 0, 0, 0.05);
  const rack = grp(rackG, 0, 2.1, 1.6);
  const tubes = grp(rack);
  for (let i = 0; i < 6; i++) {
    const x = ((i % 3) - 1) * 0.42,
      y = Math.floor(i / 3) * 0.42 + 0.25;
    P(tubes, gCyl(0.17, 0.17, 1.6, 8), M.gun, x, y, -0.7, HP);
    P(tubes, gCyl(0.2, 0.2, 0.08, 8), M.joint, x, y, -1.5, HP);
    P(tubes, gCyl(0.12, 0.12, 0.02, 8), warn, x, y, -1.55, HP);
  }
  CB(rack, 1.45, 0.08, 1.6, M.main3, 0, 0.0, -0.7, 0, 0, 0, 0.02);
  for (const s of [-1, 1]) {
    front(rack, M.main3, rect(0.06, 0.95, 0, 0.45), 1.6, -0.7, 0.01, 1, 1, s * 0.72, 0);
    piston(rackG, M, [s * 0.6, 1.95, 0.3], [s * 0.6, 2.4, 0.95], 0.05);
  }
  hazard(rack, M, 0, 0.65, -0.05, 1.2, 0.1);
  const hand = grp(rack, 0, 0.5, -1.6);
  const plG = grp(torso);
  const plates = [
    plateMesh(plG, 0.06, 0.6, 1.4, M.main2, 1.0, 1.25, -1.4),
    plateMesh(plG, 0.06, 0.6, 1.4, M.main2, -1.0, 1.25, -1.4),
    plateMesh(rack, 1.5, 0.06, 1.3, M.main2, 0, 0.92, -0.75),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'smoker',
    height: 3.2 * scale,
    dmg: {
      smoke: [
        [0, 2.2, -1.2],
        [0, 2.3, 1.2],
      ],
      plates,
      chunks: [rackG, mastBase, hull],
    },
    extra: { xWarn: warn, xRack: rack, xMast: mast, xTubes: tubes },
  });
}

// ---------- 沙脊狙擊機：四足的低矮機體＋背上的長管電磁狙擊槍＋偽裝布；趴下時機體壓低、四腳張開（高約 2 m）----------
const SN_L1 = 1.0,
  SN_L2 = 1.15; // 大腿／小腿長
// 兩段骨頭的平面 IK：髖在原點、腳掌在 (F, −hy)，膝蓋朝上
export function snLegIK(hip, knee, hy, F, L1 = SN_L1, L2 = SN_L2) {
  const D = Math.min(L1 + L2 - 0.01, Math.hypot(F, hy));
  const th = Math.atan2(-hy, F);
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + D * D - L2 * L2) / (2 * L1 * D))));
  const be = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - D * D) / (2 * L1 * L2))));
  hip.rotation.z = th + al;
  knee.rotation.z = -(Math.PI - be);
}
function buildRidgeSniper(pal, scale) {
  const { M, root, torso } = base(pal);
  const warn = glow(0x50a8ff, 0.4);
  const body = grp(torso, 0, 1.5, 0);
  // 機身：扁平的楔形艙＋背脊＋側面的偽裝布（沙色的斜板）
  P(
    body,
    gPod([
      [-1.4, 0.9, -0.15, 0.2, 0.08, 0.06],
      [-0.9, 1.3, -0.3, 0.35, 0.14, 0.12],
      [0.8, 1.3, -0.3, 0.35, 0.14, 0.12],
      [1.3, 1.0, -0.22, 0.25, 0.08, 0.08],
    ]),
    M.main,
  );
  CB(body, 0.5, 0.18, 1.6, M.main3, 0, 0.42, 0.2, 0, 0, 0, 0.03);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++)
      P(
        body,
        gBox(0.5, 0.03, 0.55),
        M.acc,
        s * 0.78,
        0.18 - i * 0.04,
        -0.6 + i * 0.6,
        0,
        0.1 * s,
        -s * (0.35 + i * 0.05),
      );
    slats(body, M.joint, s * 0.66, 0.2, 0.6, 0.4, 3, 0.08, s * HP);
    bolts(body, M.joint, s * 0.6, -0.05, -0.8, 0, 0, 0.3, 6, 0.03);
  }
  // 頭部感測器：橫向的眼縫＋側面的天線
  CB(body, 0.6, 0.3, 0.4, M.sub, 0, 0.05, -1.45, 0, 0, 0, 0.04);
  P(body, gBox(0.5, 0.08, 0.05), glow(0xffb040, 1.4), 0, 0.08, -1.66);
  rod(body, M.joint, [0.25, 0.2, -1.3], [0.45, 0.75, -1.2], 0.015, 4);
  decal(body, 5, 0.5, 0.25, 0.66, 0.0, 0.0, 0, HP, 0);
  // 狙擊槍：槍架＋長槍管（加速線圈）＋瞄準鏡（鏡頭＝預警發光）＋前端的兩腳架
  const gun = grp(body, 0, 0.55, -0.2);
  P(gun, gBox(0.3, 0.3, 1.6), M.sub, 0, 0, 0.3);
  P(gun, gCyl(0.07, 0.09, 3.6, 8), M.gun, 0, 0, -2.2, HP);
  for (let i = 0; i < 5; i++) P(gun, gCyl(0.14, 0.14, 0.14, 8), M.joint, 0, 0, -0.9 - i * 0.55, HP);
  P(gun, gCyl(0.13, 0.11, 0.3, 8), M.joint, 0, 0, -4.05, HP);
  for (const s of [-1, 1]) {
    P(gun, gBox(0.05, 0.16, 0.5), M.acc, s * 0.18, 0, -0.3);
    kitCable(gun, M, [
      [s * 0.12, -0.1, 0.6],
      [s * 0.16, -0.12, -0.6],
      [s * 0.1, -0.08, -1.3],
    ]);
  }
  const scope = grp(gun, 0, 0.32, -0.4);
  P(scope, gCyl(0.1, 0.1, 0.9, 8), M.main3, 0, 0, 0, HP);
  P(scope, gCyl(0.13, 0.1, 0.18, 8), M.joint, 0, 0, -0.5, HP);
  P(scope, gCyl(0.09, 0.09, 0.02, 8), warn, 0, 0, -0.6, HP);
  P(scope, gBox(0.06, 0.16, 0.1), M.joint, 0, -0.16, 0.2);
  P(scope, gBox(0.06, 0.16, 0.1), M.joint, 0, -0.16, -0.2);
  // 瞄準鏡的反光（加色的小球，預警時放大）
  const glint = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), addMat(0x9fd4ff, 0.9));
  glint.position.set(0, 0, -0.62);
  glint.visible = false;
  scope.add(glint);
  const bipod = grp(gun, 0, -0.05, -3.4);
  for (const s of [-1, 1]) beam(bipod, M.joint, [0, 0, 0], [s * 0.35, -0.75, -0.1], 0.05, 0.05);
  const hand = grp(gun, 0, 0, -4.25);
  // 四隻腳：髖（xLegs[i].hip，繞 Z 抬起）→ 膝（knee）；IK 在 mech-foe-b1.js（腳掌固定在地面）
  const legs = [];
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const L = grp(body, sx * 0.55, -0.1, sz * 0.75);
    L.rotation.y = sx > 0 ? -sz * 0.45 : PI + sz * 0.45; // 區域 +X 朝外、斜向前後
    P(L, gCyl(0.16, 0.16, 0.3, 8), M.joint, 0, 0, 0, HP);
    const hip = grp(L);
    beam(hip, M.main2, [0, 0, 0], [SN_L1, 0, 0], 0.2, 0.24, 0.04);
    piston(hip, M, [0.15, 0.15, 0], [SN_L1 * 0.8, 0.12, 0], 0.035);
    const knee = grp(hip, SN_L1, 0, 0);
    P(knee, gSph(0.13, 6), M.joint, 0, 0, 0);
    beam(knee, M.sub, [0, 0, 0], [SN_L2, 0, 0], 0.14, 0.16, 0.03);
    P(knee, gCyl(0.06, 0.2, 0.12, 6), M.rubber, SN_L2, 0, 0, 0, 0, HP);
    legs.push({ L, hip, knee, sx, sz });
    snLegIK(hip, knee, 1.4, 1.2); // 站姿（模型庫顯示；遊戲中由 mech-foe-b1.js 每格更新）
  }
  const plG = grp(body);
  const plates = [
    plateMesh(plG, 0.9, 0.06, 0.9, M.main2, 0, 0.38, -0.7, 0.1),
    plateMesh(plG, 0.06, 0.4, 0.9, M.main2, 0.66, 0.0, 0.4, 0, 0, -0.2),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'ridgesniper',
    height: 2.1 * scale,
    dmg: {
      smoke: [
        [0, 1.9, 0.3],
        [0, 1.8, -1.2],
      ],
      plates,
      chunks: [gun, body],
    },
    extra: { xWarn: warn, xBody: body, xGun: gun, xGlint: glint, xLegs: legs, xL1: SN_L1, xL2: SN_L2 },
  });
}

// ---------- 旋風產生機：三腳錨定的塔＋頂部的大型涵道旋翼（xRotor）＋兩側進氣渦輪（xIntake）＋底部的噴出環（高約 5 m）----------
function buildTwister(pal, scale) {
  const { M, root, torso } = base(pal);
  const warn = glow(0xffb050, 0.3);
  const baseG = grp(torso);
  // 基座：六角平台＋三支錨定腳（液壓）＋地錨
  P(baseG, gCyl(1.5, 1.7, 0.5, 6), M.main2, 0, 0.6, 0, 0, PI / 6);
  P(baseG, gCyl(1.55, 1.55, 0.1, 6), M.joint, 0, 0.9, 0, 0, PI / 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    beam(baseG, M.main, [c * 1.2, 0.7, s * 1.2], [c * 2.6, 0.15, s * 2.6], 0.4, 0.45, 0.06);
    piston(baseG, M, [c * 1.0, 1.2, s * 1.0], [c * 2.2, 0.45, s * 2.2], 0.06);
    P(baseG, gCyl(0.45, 0.55, 0.2, 6), M.joint, c * 2.7, 0.1, s * 2.7);
    P(baseG, gCyl(0.08, 0.08, 0.5, 4), M.gun, c * 2.95, 0.2, s * 2.95);
    hazard(baseG, M, c * 1.62, 0.62, s * 1.62, 0.9, 0.12, -a + HP);
  }
  // 噴出環（底部的發光環，預警時變亮）
  P(baseG, gCyl(1.25, 1.25, 0.12, 12), warn, 0, 0.3, 0);
  // 塔身：漸細的圓筒＋砂料儲槽＋管線
  P(baseG, gCyl(0.85, 1.1, 2.6, 8), M.main, 0, 2.2, 0, 0, PI / 8);
  for (const y of [1.4, 2.4, 3.3])
    P(baseG, gCyl(0.95 - y * 0.04, 0.98 - y * 0.04, 0.12, 8), M.joint, 0, y, 0, 0, PI / 8);
  for (const s of [-1, 1]) {
    P(baseG, gCyl(0.45, 0.45, 1.6, 8), M.acc, s * 1.15, 2.0, 0.55);
    P(baseG, gSph(0.45, 8), M.acc, s * 1.15, 2.8, 0.55, 0, 0, 0, 1, 0.5, 1);
    rod(baseG, M.gun, [s * 1.15, 3.0, 0.55], [s * 0.5, 3.4, 0.2], 0.07);
    bolts(baseG, M.joint, s * 1.6, 1.4, 0.55, 0, 0.3, 0, 4, 0.03);
  }
  slats(baseG, M.joint, 0, 2.6, -0.98, 0.7, 6, 0.12);
  eye(baseG, M, glow(0xffb040, 1.6), 0, 3.0, -0.92, 0.09);
  decal(baseG, 7, 0.8, 0.4, 0, 1.5, -1.02, 0, PI, 0);
  // 頂部的涵道：外環＋支柱＋旋翼（xRotor）
  const head = grp(torso, 0, 4.0, 0);
  P(head, gCyl(1.7, 1.55, 0.7, 14), M.main3, 0, 0, 0);
  P(head, gCyl(1.45, 1.45, 0.72, 14), M.gun, 0, 0, 0);
  P(head, gCyl(1.75, 1.75, 0.08, 14), M.joint, 0, 0.36, 0);
  for (let i = 0; i < 4; i++)
    beam(
      head,
      M.joint,
      [0, -0.3, 0],
      [Math.cos((i * PI) / 2) * 1.45, -0.3, Math.sin((i * PI) / 2) * 1.45],
      0.1,
      0.1,
    );
  const rotor = grp(head, 0, 0.05, 0);
  P(rotor, gCyl(0.3, 0.3, 0.4, 8), M.sub, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(rotor, gBox(1.2, 0.04, 0.32), M.acc, Math.cos(a) * 0.85, 0, -Math.sin(a) * 0.85, 0.35, a, 0);
  }
  // 涵道外側的導流葉片（xVanes：預警時打開）
  const vanes = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    const v = grp(head, Math.cos(a) * 1.78, -0.1, -Math.sin(a) * 1.78);
    v.rotation.y = a;
    P(v, gBox(0.05, 0.5, 0.45), M.main2, 0.02, 0, 0);
    vanes.push(v);
  }
  // 兩側的進氣渦輪（xIntake）
  const intakes = [];
  for (const s of [-1, 1]) {
    const ib = grp(baseG, s * 1.0, 3.3, -0.3);
    P(ib, gCyl(0.42, 0.38, 0.4, 10), M.main3, s * 0.3, 0, 0, 0, 0, HP);
    const fan = grp(ib, s * 0.52, 0, 0);
    for (let k = 0; k < 4; k++) P(fan, gBox(0.04, 0.68, 0.12), M.joint, 0, 0, 0, (k * PI) / 4);
    intakes.push(fan);
  }
  const hand = grp(torso, 0, 1.0, -1.4);
  const plG = grp(torso);
  const plates = [
    plateMesh(plG, 0.9, 0.9, 0.06, M.main2, 0, 2.0, -1.06),
    plateMesh(plG, 0.06, 0.8, 0.8, M.main2, 1.08, 1.6, -0.3, 0, 0, 0.1),
    plateMesh(plG, 0.06, 0.8, 0.8, M.main2, -1.08, 1.6, -0.3, 0, 0, -0.1),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'twister',
    height: 4.6 * scale,
    dmg: {
      smoke: [
        [0, 4.4, 0],
        [1.1, 2.9, 0.5],
        [-0.6, 1.8, -0.8],
      ],
      plates,
      chunks: [head, baseG],
    },
    extra: { xWarn: warn, xRotor: rotor, xVanes: vanes, xIntake: intakes },
  });
}

// ---------- 坍方爆破手：窄履帶的工程車＋可抬起的炸藥射出臂（xArm）＋閃燈的引爆天線（xBeacon）＋電線捲軸（xSpool）（高約 2.8 m）----------
function buildBlaster(pal, scale) {
  const { M, root, torso } = base(pal);
  const warn = glow(0xff6020, 0.3);
  const hull = grp(torso);
  for (const s of [-1, 1]) track(hull, M, s * 0.85, 0, 2.6, 0.8, 0.5, 4, M.acc);
  // 車體：低矮的箱＋前方的推土鏟
  side(
    hull,
    M.main,
    [
      [-1.15, 0.75],
      [1.25, 0.75],
      [1.25, 1.55],
      [-0.6, 1.55],
      [-1.15, 1.2],
    ],
    1.3,
    0,
    0.05,
  );
  front(
    hull,
    M.main2,
    [
      [-1.15, 0.15],
      [1.15, 0.15],
      [1.2, 0.75],
      [-1.2, 0.75],
    ],
    0.1,
    -1.55,
    0.01,
    1,
    1,
    0,
    0,
    -0.25,
  );
  for (const s of [-1, 1]) beam(hull, M.joint, [s * 0.5, 0.9, -0.9], [s * 0.6, 0.5, -1.45], 0.1, 0.1);
  hazard(hull, M, 0, 0.55, -1.62, 1.8, 0.14);
  // 炸藥箱（車體後段，警示條＋編號）
  for (const [x, z] of [
    [-0.32, 0.65],
    [0.32, 0.65],
    [0, 1.0],
  ]) {
    CB(hull, 0.55, 0.42, 0.42, M.acc, x, 1.78, z, 0, 0, 0, 0.03);
    P(hull, gBox(0.57, 0.06, 0.44), M.joint, x, 1.68, z);
  }
  decal(hull, 2, 0.5, 0.26, 0.66, 1.15, 0.2, 0, HP, 0);
  bolts(hull, M.joint, -0.66, 1.4, -0.4, 0, 0, 0.3, 5, 0.03);
  // 駕駛艙（小型、前方）
  P(
    hull,
    gPod([
      [-0.9, 0.9, 1.55, 2.1, 0.1, 0.02],
      [-0.2, 0.9, 1.55, 2.2, 0.12, 0.02],
    ]),
    M.main3,
  );
  P(hull, gBox(0.7, 0.18, 0.04), M.lens, 0, 1.92, -0.91);
  eye(hull, M, glow(0xfff0c0, 1.5), 0.32, 1.3, -1.18, 0.07);
  // 電線捲軸（xSpool）
  const spoolB = grp(hull, -0.62, 1.95, 0.2);
  for (const s of [-1, 1]) P(spoolB, gBox(0.05, 0.5, 0.4), M.joint, s * 0.2, 0, 0);
  const spool = grp(spoolB);
  P(spool, gCyl(0.18, 0.18, 0.36, 8), M.rubber, 0, 0, 0, 0, 0, HP);
  P(spool, gCyl(0.24, 0.24, 0.04, 8), M.gun, 0.17, 0, 0, 0, 0, HP);
  P(spool, gCyl(0.24, 0.24, 0.04, 8), M.gun, -0.17, 0, 0, 0, 0, HP);
  // 引爆天線（xBeacon：預警時閃爍）
  const bcn = grp(hull, 0.55, 1.6, 0.9);
  rod(bcn, M.joint, [0, 0, 0], [0, 1.0, 0], 0.025, 4);
  P(bcn, gCyl(0.08, 0.08, 0.2, 6), M.sub, 0, 0.3, 0);
  const beacon = grp(bcn, 0, 1.05, 0);
  P(beacon, gSph(0.1, 8), warn, 0, 0, 0);
  // 炸藥射出臂：肩座＋兩節臂（xArm 繞 X 抬起）＋前端的錨釘射出器
  const armB = grp(torso, 0.1, 1.6, -0.25);
  P(armB, gCyl(0.3, 0.34, 0.25, 8), M.joint, 0, 0, 0);
  const arm = grp(armB, 0, 0.15, 0);
  beam(arm, M.main2, [0, 0, 0], [0, 0.3, -1.1], 0.26, 0.3, 0.04);
  piston(arm, M, [0.18, -0.05, 0.1], [0.18, 0.2, -0.9], 0.04);
  const fore = grp(arm, 0, 0.3, -1.1);
  P(fore, gSph(0.15, 6), M.joint, 0, 0, 0);
  beam(fore, M.sub, [0, 0, 0], [0, 0, -0.9], 0.18, 0.2, 0.03);
  P(fore, gCyl(0.13, 0.13, 0.5, 8), M.gun, 0, 0.18, -0.75, HP);
  P(fore, gCyl(0.06, 0.0, 0.2, 6), M.acc, 0, 0.18, -1.1, -HP);
  kitCable(arm, M, [
    [-0.12, 0.05, 0.1],
    [-0.15, 0.25, -0.6],
    [-0.1, 0.3, -1.05],
  ]);
  const hand = grp(fore, 0, 0.18, -1.15);
  const plG = grp(hull);
  const plates = [
    plateMesh(plG, 0.06, 0.55, 1.4, M.main2, 0.68, 1.15, -0.05),
    plateMesh(plG, 0.06, 0.55, 1.4, M.main2, -0.68, 1.15, -0.05),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'blaster',
    height: 2.6 * scale,
    dmg: {
      smoke: [
        [0, 1.9, 0.6],
        [0, 1.6, -0.6],
      ],
      plates,
      chunks: [armB, bcn, hull],
    },
    extra: { xWarn: warn, xArm: arm, xBeacon: beacon, xSpool: spool },
  });
}

// ---------- 礦燈哨兵：三腳的步行哨兵＋桅杆上的大型探照燈（xLamp：弱點，依 bx 轉向）＋光錐（xCone）（高約 3.8 m）----------
function buildLamp(pal, scale) {
  const { M, root, torso } = base(pal);
  const lens = glow(0xffe8a0, 2.2);
  const hub = grp(torso, 0, 1.7, 0);
  // 中央艙：八角的筒＋底部的機槍莢＋散熱縫
  P(hub, gCyl(0.7, 0.55, 0.8, 8), M.main, 0, 0, 0, 0, PI / 8);
  P(hub, gCyl(0.74, 0.74, 0.1, 8), M.joint, 0, 0.36, 0, 0, PI / 8);
  P(hub, gCyl(0.5, 0.42, 0.2, 8), M.sub, 0, -0.48, 0, 0, PI / 8);
  slats(hub, M.joint, 0, 0.2, 0.62, 0.6, 3, 0.1, PI);
  CB(hub, 0.3, 0.26, 0.7, M.gun, 0, -0.45, -0.5, 0, 0, 0, 0.03);
  P(hub, gCyl(0.05, 0.05, 0.6, 6), M.joint, 0, -0.45, -1.0, HP);
  decal(hub, 4, 0.5, 0.25, 0, 0.0, -0.66, 0, PI, 0);
  bolts(hub, M.joint, -0.4, 0.42, -0.4, 0.2, 0, 0, 5, 0.03);
  // 三隻腳：大腿＋小腿＋腳掌（xLegs：待機時微微起伏）
  const legs = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 2;
    const L = grp(hub, Math.cos(a) * 0.55, -0.2, Math.sin(a) * 0.55);
    L.rotation.y = -a;
    P(L, gSph(0.17, 6), M.joint, 0, 0, 0);
    beam(L, M.main2, [0, 0, 0], [0.9, 0.35, 0], 0.18, 0.22, 0.03);
    beam(L, M.sub, [0.9, 0.35, 0], [1.35, -1.5, 0], 0.13, 0.16, 0.03);
    piston(L, M, [0.25, 0.15, 0.08], [1.1, -0.4, 0.08], 0.03);
    P(L, gSph(0.12, 6), M.joint, 0.9, 0.35, 0);
    P(L, gCyl(0.22, 0.28, 0.1, 6), M.rubber, 1.38, -1.62, 0);
    legs.push(L);
  }
  // 桅杆＋燈頭（xLamp：繞 Y 轉向；xLampP：繞 X 俯仰）：圓筒燈罩＋前方的玻璃（發光）＋散熱鰭片＋護籠
  rod(hub, M.joint, [0, 0.4, 0], [0, 1.2, 0], 0.1);
  P(hub, gCyl(0.16, 0.16, 0.25, 8), M.sub, 0, 0.75, 0);
  kitCable(hub, M, [
    [0.2, 0.4, 0.2],
    [0.18, 0.9, 0.15],
    [0.1, 1.25, 0.1],
  ]);
  const lamp = grp(hub, 0, 1.35, 0);
  const lampP = grp(lamp);
  P(lampP, gCyl(0.42, 0.36, 0.7, 12), M.main3, 0, 0, 0.05, HP);
  P(lampP, gCyl(0.46, 0.46, 0.08, 12), M.joint, 0, 0, -0.32, HP);
  P(lampP, gCyl(0.38, 0.38, 0.03, 12), lens, 0, 0, -0.36, HP);
  for (let i = 0; i < 5; i++) P(lampP, gBox(0.86, 0.04, 0.3), M.joint, 0, -0.22 + i * 0.11, 0.42);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    rod(
      lampP,
      M.gun,
      [Math.cos(a) * 0.44, Math.sin(a) * 0.44, -0.32],
      [Math.cos(a) * 0.2, Math.sin(a) * 0.2, -0.5],
      0.015,
      4,
    );
  }
  for (const s of [-1, 1]) P(lampP, gBox(0.08, 0.2, 0.25), M.joint, s * 0.45, 0, 0.05);
  // 光錐（加色、不投影；燈熄時隱藏）：長 14 m 的示意光錐，實際照射範圍由行為端決定
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, 14, 16, 1, true), addMat(0xffe6a0, 0.12));
  cone.geometry.translate(0, -7, 0);
  cone.rotation.x = HP; // 光錐朝 −Z（燈的正面）
  cone.position.z = -0.38;
  cone.userData.helper = true;
  lampP.add(cone);
  const hand = grp(hub, 0, -0.45, -1.3);
  const plG = grp(hub);
  const plates = [
    plateMesh(plG, 0.75, 0.5, 0.06, M.main2, 0, 0.0, -0.7),
    plateMesh(plG, 0.06, 0.45, 0.6, M.main2, 0.72, 0.0, 0.1),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'lamp',
    height: 3.8 * scale,
    dmg: {
      smoke: [
        [0, 2.0, 0.4],
        [0, 3.1, 0.2],
      ],
      plates,
      chunks: [lamp, hub],
    },
    extra: { xWarn: lens, xLamp: lamp, xLampP: lampP, xCone: cone, xLegs: legs, xHub: hub },
  });
}

export const FOE_BUILDERS_b1 = {
  harpoon: buildHarpoon,
  smoker: buildSmoker,
  ridgesniper: buildRidgeSniper,
  twister: buildTwister,
  blaster: buildBlaster,
  lamp: buildLamp,
};
// 模型庫登記：[key, 名稱, 備註]（model-catalog.js 依 FOE_CATALOG 建 vehicle/foe_<key>）
export const FOE_CATALOG_b1 = [
  ['harpoon', '魚叉拖車', '荒野專屬；射出鋼索鉤把機體拖過去'],
  ['smoker', '煙幕投射車', '荒野專屬；拋射煙幕彈，煙裡不能鎖定'],
  ['ridgesniper', '沙脊狙擊機', '沙丘專屬；趴在稜線上，藍色瞄準線後一擊'],
  ['twister', '旋風產生機', '沙丘專屬；放出追蹤的沙塵旋風'],
  ['blaster', '坍方爆破手', '礦坑專屬；在岩頂裝炸藥造成坍方，落石留下當掩體'],
  ['lamp', '礦燈哨兵', '礦坑專屬；探照燈照到就暴露位置，燈頭是弱點'],
];
