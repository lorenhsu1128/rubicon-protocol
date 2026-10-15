// 地圖專屬敵人擴充（B2 組）的程式模型：鉚釘槍 MT、電焊 MT（集散場）、高壓水砲車、渦輪吸入機（水壩）、
// 電鰻無人機、漂流水雷浮標（水沒市街）。介面同 foe-models.js（vehicle: true；原點在地面、飛行的在機體下方；正面 −Z）。
// 會動的節點放在 extra（entities/mech-foe-b2.js 的 foeFx_b2 依 bossVis 驅動，房主與客機都跑）：
//   待機（步伐、天線、葉片、起伏）、預警（展開、發光漸強）、攻擊（後座、旋轉、全亮）三種狀態。
// rig.dmg＝{ smoke 冒煙點（模型座標）, plates 會脫落的裝甲板（獨立網格，不被 bakeAll 合併）, chunks 擊破時拆開的群組 }。
import {
  CB as CB0,
  P,
  bakeAll,
  decal,
  gBox,
  gCyl,
  gPlate,
  gPod,
  gSph,
  kitBolts,
  kitCable,
} from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';
import { beam, crect, eye, hazard, piston, rod, side, slats, wheel } from './foe-models.js';

const PI = Math.PI,
  HP = Math.PI / 2;
const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
// 倒角方塊；小零件（最短邊 < 0.4 m）不倒角，省三角形
function CB(n, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.06) {
  if (Math.min(w, h, d) < 0.4) P(n, gBox(w, h, d), m, x, y, z, rx, ry, rz);
  else CB0(n, w, h, d, m, x, y, z, rx, ry, rz, c);
}
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// 會脫落的裝甲板：放在沒有 prims 的子群組裡，bakeAll 不會合併它（A2 的受損表現直接拿這個網格）
function plateMesh(parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const h = grp(parent);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  h.add(mesh);
  return mesh;
}
function base(pal) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  return { M, root, torso };
}
function finish(root, scale) {
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  tagStyle(root);
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
    dmg: o.dmg || null,
    ...(o.extra || {}),
  };
}

// ---------- 雙足 MT 的腳（前彎膝）：髖關節在群組原點，腳底在 −1.45 ----------
function legFwd(g, M, s) {
  P(g, gCyl(0.22, 0.22, 0.4, 8), M.joint, 0, 0, 0, 0, 0, HP);
  CB(g, 0.42, 0.34, 0.46, M.main2, s * 0.04, -0.06, 0.02, 0, 0, 0, 0.05);
  beam(g, M.main2, [0, -0.05, 0], [0, -0.66, -0.26], 0.3, 0.36, 0.05);
  side(
    g,
    M.main,
    [
      [0.08, -0.08],
      [-0.22, -0.6],
      [-0.4, -0.52],
      [-0.14, -0.02],
    ],
    0.06,
    s * 0.19,
    0.02,
  );
  P(g, gCyl(0.17, 0.17, 0.44, 8), M.joint, 0, -0.68, -0.27, 0, 0, HP);
  CB(g, 0.32, 0.3, 0.2, M.main3, 0, -0.64, -0.42, 0.25, 0, 0, 0.04);
  beam(g, M.main2, [0, -0.68, -0.27], [0, -1.25, 0.02], 0.26, 0.3, 0.05);
  side(
    g,
    M.main,
    [
      [-0.38, -0.75],
      [-0.12, -1.15],
      [0.02, -1.08],
      [-0.2, -0.7],
    ],
    0.05,
    s * 0.16,
    0.02,
  );
  piston(g, M, [0, -0.12, 0.22], [0, -0.98, 0.16], 0.045);
  // 腳掌：底板＋鋼頭＋腳踝＋警示條
  P(g, gCyl(0.12, 0.12, 0.38, 6), M.joint, 0, -1.27, 0.02, 0, 0, HP);
  CB(g, 0.52, 0.16, 0.86, M.joint, 0, -1.37, -0.1, 0, 0, 0, 0.04);
  CB(g, 0.46, 0.12, 0.3, M.main3, 0, -1.25, -0.42, -0.2, 0, 0, 0.03);
  P(g, gBox(0.3, 0.1, 0.16), M.sub, 0, -1.33, 0.33);
  hazard(g, M, 0, -1.35, -0.54, 0.42, 0.07);
  kitBolts(g, M, [
    [s * 0.22, -0.06, -0.12, 0, 0, HP],
    [s * 0.22, -0.06, 0.16, 0, 0, HP],
  ]);
}
// 逆關節的腳：髖關節在群組原點，膝蓋往後、腳爪三根，腳底在 −1.4
function legRev(g, M, s) {
  P(g, gCyl(0.2, 0.2, 0.38, 8), M.joint, 0, 0, 0, 0, 0, HP);
  CB(g, 0.4, 0.4, 0.5, M.main2, s * 0.03, -0.05, 0.05, 0, 0, 0, 0.05);
  beam(g, M.main, [0, -0.05, 0.05], [0, -0.56, 0.42], 0.3, 0.34, 0.05);
  P(g, gCyl(0.15, 0.15, 0.4, 8), M.joint, 0, -0.58, 0.44, 0, 0, HP);
  beam(g, M.main2, [0, -0.58, 0.44], [0, -1.16, -0.04], 0.22, 0.26, 0.05);
  piston(g, M, [0, -0.2, 0.32], [0, -0.92, 0.16], 0.04);
  side(
    g,
    M.main3,
    [
      [0.3, -0.62],
      [0.02, -1.0],
      [-0.08, -0.92],
      [0.2, -0.55],
    ],
    0.05,
    s * 0.14,
    0.02,
  );
  P(g, gSph(0.13, 8), M.joint, 0, -1.18, -0.04);
  for (const a of [-0.45, 0, 0.45]) {
    const tx = Math.sin(a) * 0.38,
      tz = -Math.cos(a) * 0.38;
    beam(g, M.joint, [0, -1.2, -0.04], [tx, -1.35, tz - 0.04], 0.09, 0.08);
    P(g, gBox(0.1, 0.08, 0.14), M.main3, tx, -1.36, tz - 0.08, 0, -a);
  }
  beam(g, M.joint, [0, -1.2, -0.02], [0, -1.36, 0.26], 0.08, 0.08); // 後爪
}

// ---------- 鉚釘槍 MT（集散場）：雙足、右臂大型鉚釘槍＋彈鼓、背上空壓機（高約 3.0 m） ----------
function buildRiveter(pal, scale) {
  const { M, root, torso } = base(pal);
  const vis = glow(0xffb040, 1.4);
  const muzzleM = glow(0xffa030, 0.3);
  const hullG = grp(torso),
    packG = grp(torso);
  const legL = grp(torso, -0.55, 1.45, 0.05),
    legR = grp(torso, 0.55, 1.45, 0.05);
  legFwd(legL, M, -1);
  legFwd(legR, M, 1);
  // 機身：楔形的駕駛艙＋腰部
  CB(hullG, 1.0, 0.34, 0.78, M.main2, 0, 1.5, 0.05, 0, 0, 0, 0.05);
  P(hullG, gCyl(0.3, 0.34, 0.3, 8), M.joint, 0, 1.72, 0.05);
  P(
    hullG,
    gPod([
      [-0.78, 1.3, 1.85, 2.6, 0.2, 0.14],
      [-0.5, 1.62, 1.75, 2.82, 0.24, 0.16],
      [0.5, 1.62, 1.75, 2.82, 0.24, 0.16],
      [0.74, 1.38, 1.85, 2.66, 0.2, 0.14],
    ]),
    M.main,
  );
  // 駕駛艙的視窗：外框＋發光的細縫＋護條
  CB(hullG, 0.92, 0.3, 0.12, M.sub, 0, 2.42, -0.76, 0, 0, 0, 0.03);
  P(hullG, gBox(0.74, 0.08, 0.04), vis, 0, 2.43, -0.83);
  for (const x of [-0.2, 0.2]) P(hullG, gBox(0.04, 0.26, 0.05), M.joint, x, 2.42, -0.85);
  eye(hullG, M, vis, -0.4, 2.12, -0.79, 0.06);
  eye(hullG, M, vis, -0.24, 2.12, -0.79, 0.04);
  hazard(hullG, M, 0, 1.96, -0.8, 1.1, 0.12);
  slats(hullG, M.joint, 0.82, 2.4, 0.15, 0.5, 4, 0.1, HP);
  slats(hullG, M.joint, -0.82, 2.4, 0.15, 0.5, 4, 0.1, -HP);
  decal(hullG, 2, 0.46, 0.46, -0.82, 2.1, -0.25, 0, -HP, 0);
  kitBolts(hullG, M, [
    [-0.55, 2.62, -0.7],
    [0.55, 2.62, -0.7],
    [-0.55, 2.02, -0.8],
    [0.55, 2.02, -0.8],
  ]);
  // 頂部的警示燈與天線（天線待機時轉動）
  P(hullG, gCyl(0.08, 0.1, 0.12, 6), M.joint, -0.35, 2.88, -0.2);
  P(hullG, gSph(0.08, 6), glow(0xffa020, 2), -0.35, 2.97, -0.2);
  const ant = grp(hullG, 0.42, 2.82, 0.3);
  rod(ant, M.joint, [0, 0, 0], [0, 0.55, 0], 0.025, 5);
  P(ant, gBox(0.36, 0.04, 0.08), M.sub, 0, 0.5, 0);
  P(ant, gBox(0.04, 0.12, 0.04), M.sub, 0.16, 0.56, 0);
  // 左臂：鉚釘料斗＋夾爪
  P(hullG, gCyl(0.2, 0.2, 0.3, 8), M.joint, -0.86, 2.3, -0.05, 0, 0, HP);
  CB(hullG, 0.46, 0.62, 0.54, M.main2, -1.08, 2.0, -0.12, 0, 0, 0, 0.05);
  for (let i = 0; i < 4; i++) P(hullG, gCyl(0.045, 0.045, 0.1, 6), M.gun, -1.08, 2.24 - i * 0.12, -0.42, HP);
  beam(hullG, M.joint, [-1.08, 1.7, -0.25], [-1.0, 1.42, -0.48], 0.08, 0.08);
  beam(hullG, M.joint, [-1.12, 1.7, -0.25], [-1.2, 1.42, -0.48], 0.08, 0.08);
  // 背包：空壓機（儲氣筒＋壓力錶＋配管）
  P(packG, gCyl(0.32, 0.32, 1.1, 10), M.acc, 0, 2.45, 0.92, 0, 0, HP);
  for (const x of [-0.56, 0.56]) P(packG, gCyl(0.33, 0.28, 0.05, 10), M.joint, x, 2.45, 0.92, 0, 0, HP);
  for (const x of [-0.25, 0.25]) P(packG, gCyl(0.34, 0.34, 0.06, 10), M.main2, x, 2.45, 0.92, 0, 0, HP);
  CB(packG, 0.8, 0.5, 0.3, M.main2, 0, 2.05, 0.82, 0, 0, 0, 0.04);
  P(packG, gCyl(0.1, 0.1, 0.05, 8), M.joint, 0.2, 2.15, 0.98, HP);
  P(packG, gCyl(0.075, 0.075, 0.03, 8), glow(0xfff0c0, 0.8), 0.2, 2.15, 1.0, HP);
  kitCable(packG, M, [
    [0.4, 2.55, 0.7],
    [0.75, 2.7, 0.3],
    [0.95, 2.45, -0.1],
  ]);
  // 右臂：肩關節＋上臂（整個是可轉的群組）＋鉚釘槍（後座的群組）＋彈鼓（轉動）
  const arm = grp(torso, 0.95, 2.3, -0.02);
  P(arm, gCyl(0.22, 0.22, 0.32, 8), M.joint, 0, 0, 0, 0, 0, HP);
  CB(arm, 0.36, 0.62, 0.44, M.main2, 0.12, -0.25, -0.05, 0, 0, 0, 0.05);
  const gun = grp(arm, 0.14, -0.48, -0.3);
  CB(gun, 0.42, 0.42, 0.9, M.gun, 0, 0, -0.25, 0, 0, 0, 0.05);
  P(gun, gCyl(0.16, 0.18, 1.1, 10), M.gun, 0, 0.02, -1.15, HP);
  P(gun, gCyl(0.22, 0.22, 0.18, 10), M.joint, 0, 0.02, -1.66, HP);
  P(gun, gCyl(0.12, 0.12, 0.04, 10), muzzleM, 0, 0.02, -1.76, HP);
  for (let i = 0; i < 3; i++) P(gun, gCyl(0.19, 0.19, 0.04, 10), M.sub, 0, 0.02, -0.8 - i * 0.18, HP);
  P(gun, gBox(0.06, 0.08, 0.5), M.sub, 0, 0.24, -0.6); // 照準器的導軌
  CB(gun, 0.12, 0.14, 0.22, M.joint, 0, 0.31, -0.5, 0, 0, 0, 0.02);
  hazard(gun, M, -0.22, 0, -0.45, 0.44, 0.08, -HP);
  const drum = grp(gun, 0, 0.0, 0.32);
  P(drum, gCyl(0.3, 0.3, 0.32, 12), M.main3, 0, 0, 0, HP);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(drum, gCyl(0.045, 0.045, 0.36, 5), M.gun, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0, HP);
  }
  P(drum, gCyl(0.08, 0.08, 0.38, 6), M.joint, 0, 0, 0, HP);
  kitCable(arm, M, [
    [-0.1, 0.1, 0.25],
    [0.1, -0.1, 0.32],
    [0.14, -0.4, 0.2],
  ]);
  const hand = grp(gun, 0, 0.02, -1.82);
  // 會脫落的裝甲板：右肩甲、胸甲、料斗側板
  const plates = [
    plateMesh(arm, gPlate(crect(0.56, 0.5, 0.1), 0.08, 0.02), M.main, 0.12, 0.24, -0.05, -HP, 0, -0.35),
    plateMesh(hullG, gPlate(crect(0.9, 0.42, 0.1), 0.07, 0.02), M.main3, 0, 2.08, -0.86, -0.12, 0, 0),
    plateMesh(hullG, gBox(0.05, 0.5, 0.46), M.main, -1.33, 2.0, -0.12),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'riveter',
    height: 3.0 * scale,
    dmg: {
      smoke: [
        [0, 2.7, 0.4],
        [0.95, 2.2, 0],
        [0, 2.45, 1.0],
      ],
      plates,
      chunks: [hullG, legL, legR, arm, packG],
    },
    extra: { legL, legR, gun, drum, ant, muzzleM, visM: vis },
  });
}

// ---------- 電焊 MT（集散場）：逆關節、焊接面罩、右臂焊槍、背上氣瓶與電容線圈（高約 2.9 m） ----------
function buildWelder(pal, scale) {
  const { M, root, torso } = base(pal);
  const torchM = glow(0x60a8ff, 0.4);
  const coilM = glow(0x60c8ff, 0.5);
  const hullG = grp(torso),
    tankG = grp(torso);
  const legL = grp(torso, -0.5, 1.4, 0.1),
    legR = grp(torso, 0.5, 1.4, 0.1);
  legRev(legL, M, -1);
  legRev(legR, M, 1);
  // 機身：前傾的駝背外殼
  CB(hullG, 0.9, 0.3, 0.7, M.main2, 0, 1.45, 0.12, 0, 0, 0, 0.05);
  P(
    hullG,
    gPod([
      [-0.62, 1.2, 1.4, 2.25, 0.2, 0.15],
      [-0.25, 1.5, 1.35, 2.5, 0.26, 0.18],
      [0.55, 1.42, 1.42, 2.48, 0.26, 0.16],
      [0.82, 1.0, 1.55, 2.22, 0.18, 0.12],
    ]),
    M.main,
  );
  slats(hullG, M.joint, 0.73, 2.15, 0.2, 0.45, 4, 0.09, HP);
  slats(hullG, M.joint, -0.73, 2.15, 0.2, 0.45, 4, 0.09, -HP);
  hazard(hullG, M, 0, 1.55, -0.6, 0.9, 0.1);
  decal(hullG, 5, 0.4, 0.4, 0.75, 1.85, 0.25, 0, HP, 0);
  kitBolts(hullG, M, [
    [-0.45, 2.4, -0.5],
    [0.45, 2.4, -0.5],
    [-0.5, 1.7, -0.62],
    [0.5, 1.7, -0.62],
  ]);
  // 焊接面罩（預警時拉下來）：深色面板＋發光的觀察窗＋鉸鏈
  const mask = grp(hullG, 0, 2.48, -0.3);
  P(mask, gCyl(0.07, 0.07, 1.0, 6), M.joint, 0, 0, 0, 0, 0, HP);
  P(mask, gPlate(crect(0.86, 0.62, 0.14), 0.08, 0.02), M.sub, 0, -0.32, -0.32, -0.2, 0, 0);
  P(mask, gBox(0.56, 0.1, 0.04), glow(0x4060a0, 1.2), 0, -0.26, -0.38, -0.2, 0, 0);
  for (const x of [-0.42, 0.42]) beam(mask, M.joint, [x, 0, 0], [x, -0.18, -0.3], 0.06, 0.06);
  hazard(mask, M, 0, -0.6, -0.27, 0.74, 0.07);
  // 左臂：夾鉗（短臂＋兩根爪）
  P(hullG, gCyl(0.18, 0.18, 0.28, 8), M.joint, -0.72, 1.95, -0.2, 0, 0, HP);
  beam(hullG, M.main2, [-0.8, 1.9, -0.2], [-0.86, 1.5, -0.6], 0.2, 0.22, 0.04);
  for (const s of [-1, 1]) {
    beam(hullG, M.joint, [-0.86, 1.5, -0.6], [-0.86 + s * 0.12, 1.3, -0.82], 0.06, 0.06);
    beam(hullG, M.joint, [-0.86 + s * 0.12, 1.3, -0.82], [-0.86 + s * 0.05, 1.2, -0.96], 0.05, 0.05);
  }
  // 背上：兩支氣瓶（閥、護套、束帶）＋電容線圈（待機慢轉、預警時發光漸強）
  for (const s of [-1, 1]) {
    P(tankG, gCyl(0.17, 0.17, 1.0, 10), s < 0 ? M.acc : M.main3, s * 0.3, 2.15, 0.85);
    P(tankG, gSph(0.17, 8), s < 0 ? M.acc : M.main3, s * 0.3, 2.65, 0.85);
    P(tankG, gCyl(0.05, 0.05, 0.14, 6), M.joint, s * 0.3, 2.85, 0.85);
    P(tankG, gBox(0.14, 0.05, 0.05), M.joint, s * 0.3, 2.9, 0.85);
    for (const y of [1.85, 2.4]) P(tankG, gCyl(0.185, 0.185, 0.05, 10), M.joint, s * 0.3, y, 0.85);
  }
  CB(tankG, 0.9, 0.18, 0.3, M.main2, 0, 1.62, 0.85, 0, 0, 0, 0.03);
  const coil = grp(tankG, 0, 2.35, 0.42);
  for (let i = 0; i < 3; i++)
    P(coil, new THREE.TorusGeometry(0.22, 0.035, 4, 12), coilM, 0, 0, -0.12 + i * 0.12);
  P(coil, gCyl(0.06, 0.06, 0.45, 6), M.joint, 0, 0, 0, HP);
  // 右臂：肩＋上臂＋前臂＋焊槍（整個群組，預警時舉起）
  const arm = grp(torso, 0.78, 2.05, -0.3);
  P(arm, gCyl(0.19, 0.19, 0.3, 8), M.joint, 0, 0, 0, 0, 0, HP);
  beam(arm, M.main2, [0.06, 0, 0], [0.12, -0.35, -0.5], 0.22, 0.24, 0.04);
  P(arm, gCyl(0.12, 0.12, 0.3, 8), M.joint, 0.12, -0.35, -0.5, 0, 0, HP);
  beam(arm, M.main, [0.12, -0.35, -0.5], [0.08, -0.2, -1.05], 0.18, 0.2, 0.04);
  piston(arm, M, [0.0, -0.1, -0.1], [0.0, -0.3, -0.85], 0.03);
  P(arm, gCyl(0.1, 0.13, 0.22, 8), M.gun, 0.08, -0.18, -1.15, HP);
  P(arm, gCyl(0.16, 0.16, 0.05, 8), M.joint, 0.08, -0.18, -1.2, HP);
  P(arm, gCyl(0.035, 0.07, 0.3, 6), M.gun, 0.08, -0.18, -1.38, HP);
  P(arm, gSph(0.05, 6), torchM, 0.08, -0.18, -1.55);
  kitCable(arm, M, [
    [-0.05, 0.15, 0.25],
    [0.0, 0.05, -0.3],
    [0.02, -0.1, -0.9],
    [0.05, -0.12, -1.15],
  ]);
  kitCable(torso, M, [
    [0.3, 2.3, 0.7],
    [0.6, 2.25, 0.3],
    [0.75, 2.12, -0.15],
  ]);
  const hand = grp(arm, 0.08, -0.18, -1.58);
  const plates = [
    plateMesh(arm, gPlate(crect(0.42, 0.36, 0.08), 0.07, 0.02), M.main3, 0.18, 0.12, 0, 0, HP, 0.25),
    plateMesh(hullG, gBox(0.06, 0.42, 0.6), M.main3, -0.78, 2.05, 0.2),
    plateMesh(tankG, gBox(0.8, 0.06, 0.32), M.main, 0, 2.95, 0.85),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'welder',
    height: 2.9 * scale,
    dmg: {
      smoke: [
        [0, 2.5, 0.2],
        [0.3, 2.8, 0.85],
        [0.8, 2.0, -0.3],
      ],
      plates,
      chunks: [hullG, legL, legR, arm, tankG],
    },
    extra: { legL, legR, mask, arm, coil, torchM, coilM },
  });
}

// ---------- 高壓水砲車（水壩）：六輪底盤、駕駛室、水槽、後方砲塔的長砲管、泵浦飛輪、側面支撐腳（高約 3.4 m） ----------
function buildWaterCannon(pal, scale) {
  const { M, root, torso } = base(pal);
  const mistM = glow(0xe8f6ff, 0.2);
  const chassisG = grp(torso),
    cabG = grp(torso),
    tankG = grp(torso),
    turG = grp(torso, 0, 2.75, 1.55);
  // 底盤：大樑＋擋泥板＋六個輪子
  CB(chassisG, 1.9, 0.38, 5.2, M.main2, 0, 0.92, 0, 0, 0, 0, 0.06);
  CB(chassisG, 2.3, 0.12, 5.0, M.joint, 0, 1.12, 0.05, 0, 0, 0, 0.03);
  for (const z of [-1.75, 0.15, 1.75])
    for (const sd of [-1, 1]) {
      wheel(chassisG, M, sd * 1.12, 0.52, z, 0.52, 0.42);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * PI * 2;
        P(
          chassisG,
          gCyl(0.03, 0.03, 0.06, 5),
          M.joint,
          sd * 1.35,
          0.52 + Math.sin(a) * 0.2,
          z + Math.cos(a) * 0.2,
          0,
          0,
          HP,
        );
      }
      side(
        chassisG,
        M.main,
        [
          [z - 0.7, 1.05],
          [z - 0.55, 1.22],
          [z + 0.55, 1.22],
          [z + 0.7, 1.05],
        ],
        0.5,
        sd * 1.12,
        0.02,
      );
    }
  hazard(chassisG, M, 0, 0.92, 2.62, 1.6, 0.16, PI);
  // 駕駛室：斜面擋風玻璃＋車頂燈條＋保險桿＋頭燈
  P(
    cabG,
    gPod([
      [-2.75, 2.1, 1.15, 2.3, 0.35, 0.08],
      [-2.4, 2.2, 1.12, 2.6, 0.2, 0.08],
      [-1.35, 2.2, 1.12, 2.65, 0.15, 0.08],
    ]),
    M.main,
  );
  P(cabG, gBox(1.7, 0.42, 0.05), M.lens, 0, 2.28, -2.62, -0.55, 0, 0);
  for (const s of [-1, 1]) P(cabG, gBox(0.05, 0.4, 0.7), M.lens, s * 1.11, 2.25, -2.0);
  CB(cabG, 1.6, 0.12, 0.25, M.joint, 0, 2.72, -2.2, 0, 0, 0, 0.03);
  const barM = glow(0xffa020, 1.6),
    headM = glow(0xfff4d0, 1.6);
  for (let i = 0; i < 4; i++) P(cabG, gBox(0.3, 0.07, 0.08), barM, -0.6 + i * 0.4, 2.8, -2.2);
  CB(cabG, 2.2, 0.32, 0.25, M.joint, 0, 1.05, -2.78, 0, 0, 0, 0.04);
  hazard(cabG, M, 0, 1.05, -2.92, 1.8, 0.16);
  for (const s of [-1, 1]) {
    P(cabG, gCyl(0.12, 0.12, 0.06, 8), M.joint, s * 0.8, 1.45, -2.78, HP);
    P(cabG, gCyl(0.09, 0.09, 0.04, 8), headM, s * 0.8, 1.45, -2.81, HP);
    P(cabG, gBox(0.06, 0.3, 0.12), M.joint, s * 1.14, 2.3, -2.45); // 後照鏡
  }
  decal(cabG, 3, 0.5, 0.5, 1.12, 1.75, -1.85, 0, HP, 0);
  // 水槽：圓筒＋兩端的蓋＋束帶＋梯子＋液位計
  P(tankG, gCyl(0.88, 0.88, 2.5, 14), M.main3, 0, 2.0, 0.1, HP);
  for (const z of [-1.18, 1.38]) P(tankG, gCyl(0.92, 0.92, 0.08, 14), M.joint, 0, 2.0, z, HP);
  for (const z of [-0.5, 0.7]) {
    P(tankG, gCyl(0.91, 0.91, 0.12, 14), M.main2, 0, 2.0, z, HP);
    CB(tankG, 2.0, 0.2, 0.18, M.joint, 0, 1.18, z, 0, 0, 0, 0.03);
  }
  P(tankG, gBox(0.06, 1.0, 0.06), M.joint, -0.9, 2.0, 0.1);
  P(tankG, gBox(0.04, 0.8, 0.05), glow(0x60c0ff, 1.2), -0.9, 2.0, 0.1);
  for (let i = 0; i < 5; i++) P(tankG, gBox(0.36, 0.04, 0.04), M.joint, 0.95, 1.3 + i * 0.22, 0.95, 0, 0, 0);
  for (const z of [0.82, 1.08]) rod(tankG, M.joint, [0.95, 1.2, z], [0.95, 2.4, z], 0.025, 4);
  decal(tankG, 6, 0.8, 0.8, 0.89, 2.0, -0.3, 0, HP, 0);
  // 泵浦：側面的飛輪（待機慢轉、攻擊時快轉）
  CB(tankG, 0.5, 0.6, 0.6, M.main2, 1.0, 1.55, 1.75, 0, 0, 0, 0.04);
  const pump = grp(tankG, 1.3, 1.6, 1.75);
  P(pump, new THREE.TorusGeometry(0.3, 0.05, 4, 12), M.gun, 0, 0, 0, 0, HP, 0);
  for (let i = 0; i < 3; i++) P(pump, gBox(0.04, 0.58, 0.06), M.gun, 0, 0, 0, (i * PI) / 3);
  P(pump, gCyl(0.08, 0.08, 0.16, 8), M.joint, 0, 0, 0, 0, 0, HP);
  kitCable(tankG, M, [
    [0.8, 1.5, 1.3],
    [0.5, 2.6, 1.5],
    [0.2, 2.8, 1.55],
  ]);
  // 支撐腳：預警時往外放下（繞 Z 轉）
  const outs = [];
  for (const s of [-1, 1]) {
    const o = grp(chassisG, s * 1.0, 1.05, 2.25);
    beam(o, M.main, [0, 0, 0], [s * 0.7, 0, 0], 0.18, 0.22, 0.04);
    piston(o, M, [s * 0.1, 0.1, -0.12], [s * 0.6, 0.02, -0.12], 0.035);
    P(o, gBox(0.12, 0.6, 0.12), M.joint, s * 0.72, -0.3, 0);
    P(o, gCyl(0.22, 0.26, 0.08, 8), M.joint, s * 0.72, -0.62, 0);
    hazard(o, M, s * 0.35, 0.12, 0, 0.5, 0.06, HP);
    o.rotation.z = s * 0.15;
    outs.push(o);
  }
  // 砲塔：旋轉座＋外殼＋長砲管（後座的群組）
  P(turG, gCyl(0.7, 0.78, 0.22, 12), M.joint, 0, -0.15, 0);
  CB(turG, 1.2, 0.6, 1.1, M.main, 0, 0.2, 0.05, 0, 0, 0, 0.08);
  slats(turG, M.joint, 0.61, 0.32, 0.25, 0.5, 3, 0.1, HP);
  const barrel = grp(turG, 0, 0.25, -0.5);
  P(barrel, gCyl(0.22, 0.26, 0.6, 10), M.joint, 0, 0, -0.1, HP);
  P(barrel, gCyl(0.15, 0.2, 2.6, 10), M.gun, 0, 0, -1.6, HP);
  for (let i = 0; i < 3; i++) P(barrel, gCyl(0.2, 0.2, 0.06, 10), M.sub, 0, 0, -0.7 - i * 0.7, HP);
  P(barrel, gCyl(0.24, 0.18, 0.3, 10), M.joint, 0, 0, -3.0, HP);
  P(barrel, gCyl(0.13, 0.13, 0.04, 10), mistM, 0, 0, -3.16, HP);
  kitCable(barrel, M, [
    [0.2, -0.15, 0.2],
    [0.25, -0.1, -0.6],
    [0.18, -0.05, -1.3],
  ]);
  const hand = grp(barrel, 0, 0, -3.2);
  const plates = [
    plateMesh(chassisG, gBox(0.05, 0.42, 1.4), M.main, 1.2, 1.45, 0.95),
    plateMesh(chassisG, gBox(0.05, 0.42, 1.4), M.main, -1.2, 1.45, 0.95),
    plateMesh(cabG, gBox(1.6, 0.06, 0.8), M.main3, 0, 2.66, -1.75),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'water_cannon',
    height: 3.4 * scale,
    dmg: {
      smoke: [
        [0, 2.6, -2.0],
        [0.9, 1.7, 1.7],
        [0, 3.0, 1.5],
      ],
      plates,
      chunks: [chassisG, cabG, tankG, turG],
    },
    extra: { pump, outs, barrel, mistM },
  });
}

// ---------- 渦輪吸入機（水壩）：浮筒底座、大口徑導管、前方的六片虹彩蓋（弱點）、葉片、旋轉警示燈（高約 4.2 m） ----------
function buildTurbine(pal, scale) {
  const { M, root, torso } = base(pal);
  const intakeM = glow(0x60d0ff, 0.4);
  const beaconM = glow(0xffa020, 2);
  const baseG = grp(torso),
    ductG = grp(torso, 0, 2.3, 0),
    motorG = grp(torso);
  // 底座：兩條浮筒＋橫樑＋四支錨腳
  for (const s of [-1, 1]) {
    P(
      baseG,
      gPod([
        [-2.0, 0.8, 0.1, 0.8, 0.25, 0.25],
        [-1.4, 1.0, 0.05, 0.9, 0.3, 0.3],
        [1.4, 1.0, 0.05, 0.9, 0.3, 0.3],
        [2.0, 0.8, 0.1, 0.8, 0.25, 0.25],
      ]),
      M.main3,
      s * 1.65,
    );
    hazard(baseG, M, s * 2.16, 0.5, 0, 2.4, 0.14, s * HP);
    for (const z of [-1.5, 1.5]) {
      piston(baseG, M, [s * 1.65, 0.6, z], [s * 2.1, 0.0, z * 1.15], 0.05);
      P(baseG, gCyl(0.18, 0.22, 0.08, 8), M.joint, s * 2.1, 0.04, z * 1.15);
    }
  }
  for (const z of [-1.0, 1.0]) CB(baseG, 3.6, 0.26, 0.36, M.main2, 0, 0.95, z, 0, 0, 0, 0.04);
  CB(baseG, 1.6, 0.9, 1.6, M.main2, 0, 1.3, 0.2, 0, 0, 0, 0.08);
  kitBolts(baseG, M, [
    [-0.6, 1.5, -0.62],
    [0.6, 1.5, -0.62],
    [-0.6, 1.1, -0.62],
    [0.6, 1.1, -0.62],
  ]);
  // 導管：厚環（車床成形）＋前緣的警示條＋螺栓環＋固定架
  const lp = [
    [1.33, -0.95],
    [1.62, -0.95],
    [1.74, -0.7],
    [1.74, 0.7],
    [1.62, 0.95],
    [1.33, 0.95],
    [1.33, -0.95],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  P(ductG, new THREE.LatheGeometry(lp, 20), M.main, 0, 0, 0, HP, 0, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    P(ductG, gCyl(0.05, 0.05, 0.05, 6), M.joint, Math.cos(a) * 1.68, Math.sin(a) * 1.68, -0.96, HP);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(
      ductG,
      gBox(0.4, 0.14, 0.03),
      i % 2 ? M.acc : M.joint,
      Math.cos(a) * 1.48,
      Math.sin(a) * 1.48,
      -0.97,
      0,
      0,
      a + HP,
    );
  }
  P(ductG, new THREE.TorusGeometry(1.3, 0.04, 4, 24), intakeM, 0, 0, -0.5);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    beam(
      ductG,
      M.joint,
      [Math.cos(a) * 0.28, Math.sin(a) * 0.28, 0.35],
      [Math.cos(a) * 1.34, Math.sin(a) * 1.34, 0.35],
      0.08,
      0.08,
    );
  }
  decal(ductG, 4, 0.6, 0.6, 1.75, 0.2, 0, 0, HP, 0);
  // 葉片（待機慢轉、吸入時高速）
  const fan = grp(ductG, 0, 0, -0.15);
  P(fan, gCyl(0.3, 0.42, 0.5, 10), M.gun, 0, 0, 0, HP);
  P(fan, gCyl(0.06, 0.3, 0.25, 10), M.joint, 0, 0, -0.37, -HP);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * PI * 2;
    P(fan, gBox(0.32, 0.9, 0.04), M.sub, Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0, 0.35, 0, a - HP);
  }
  // 虹彩蓋：六片三角形的蓋板，鉸鏈在前緣；預警時打開一半、吸入時全開
  const iris = grp(ductG, 0, 0, -0.98);
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const a = i * (PI / 3) + PI / 6;
    const pv = grp(iris, Math.cos(a) * 1.4, Math.sin(a) * 1.4, 0);
    pv.rotation.z = a;
    const h = grp(pv);
    P(
      h,
      gPlate(
        [
          [0, -0.78],
          [0, 0.78],
          [-1.36, 0],
        ],
        0.07,
        0.015,
      ),
      i % 2 ? M.main2 : M.main3,
    );
    P(h, gBox(1.1, 0.06, 0.05), M.joint, -0.6, 0, -0.05);
    P(h, gCyl(0.05, 0.05, 1.2, 6), M.joint, 0, 0, 0.02);
    h.rotation.y = -0.12;
    petals.push(h);
  }
  // 馬達艙：導管後方的外殼＋散熱片＋排水管
  P(
    motorG,
    gPod([
      [0.95, 1.6, 1.55, 3.05, 0.3, 0.3],
      [1.6, 1.4, 1.65, 2.95, 0.3, 0.3],
      [2.2, 0.9, 1.9, 2.7, 0.2, 0.2],
    ]),
    M.main2,
  );
  for (let i = 0; i < 5; i++) P(motorG, gBox(1.5, 0.04, 0.12), M.joint, 0, 3.08, 1.1 + i * 0.22);
  slats(motorG, M.joint, 0.78, 2.6, 1.6, 0.6, 4, 0.1, HP);
  P(motorG, gCyl(0.25, 0.3, 0.9, 8), M.gun, 0.4, 1.4, 2.0, HP);
  kitCable(motorG, M, [
    [-0.5, 2.9, 1.2],
    [-0.9, 2.2, 1.5],
    [-0.7, 1.4, 1.4],
  ]);
  // 頂部：旋轉警示燈＋小型哨戒機槍（rarm 的發射點）
  const mast = grp(torso, 0, 4.05, 0.2);
  P(mast, gCyl(0.12, 0.16, 0.2, 8), M.joint, 0, 0, 0);
  const beacon = grp(mast, 0, 0.2, 0);
  P(beacon, gCyl(0.12, 0.12, 0.2, 8), beaconM, 0, 0, 0);
  P(beacon, gBox(0.3, 0.12, 0.05), M.joint, 0, 0, 0.1);
  CB(mast, 0.36, 0.26, 0.5, M.gun, 0.5, -0.05, -0.1, 0, 0, 0, 0.03);
  P(mast, gCyl(0.05, 0.05, 0.7, 6), M.gun, 0.5, -0.05, -0.65, HP);
  const hand = grp(mast, 0.5, -0.05, -1.0);
  const plates = [
    plateMesh(ductG, gBox(0.08, 1.1, 1.2), M.main3, 1.8, 0, 0),
    plateMesh(ductG, gBox(0.08, 1.1, 1.2), M.main3, -1.8, 0, 0),
    plateMesh(motorG, gBox(1.2, 0.07, 0.8), M.main, 0, 3.14, 1.6),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'turbine',
    height: 4.2 * scale,
    dmg: {
      smoke: [
        [0, 3.2, 1.6],
        [1.2, 2.3, 0],
        [-1.0, 1.4, 0.4],
      ],
      plates,
      chunks: [baseG, ductG, motorG, mast],
    },
    extra: { fan, petals, beacon, intakeM, beaconM },
  });
}

// ---------- 電鰻無人機（水沒市街）：細長的分節機身（擺動）、頭部的放電叉、側面的電容條、尾部推進器（高約 0.9 m） ----------
function buildEel(pal, scale) {
  const { M, root, torso } = base(pal);
  const coilM = glow(0x60e8ff, 0.4);
  const eyeM = glow(0x9aff40, 1.6);
  // 頭部
  const headG = grp(torso, 0, 0.45, -1.0);
  P(
    headG,
    gPod([
      [-1.0, 0.25, -0.12, 0.08, 0.08, 0.06],
      [-0.6, 0.62, -0.3, 0.3, 0.18, 0.14],
      [0.0, 0.78, -0.36, 0.38, 0.22, 0.16],
      [0.3, 0.72, -0.34, 0.36, 0.2, 0.15],
    ]),
    M.main,
  );
  for (const s of [-1, 1]) {
    eye(headG, M, eyeM, s * 0.22, 0.12, -0.62, 0.05);
    beam(headG, M.joint, [s * 0.18, -0.12, -0.6], [s * 0.3, -0.18, -1.15], 0.06, 0.06);
    P(headG, gSph(0.07, 6), coilM, s * 0.3, -0.18, -1.18);
    // 胸鰭
    P(
      headG,
      gPlate(
        [
          [0, 0],
          [0.5, -0.1],
          [0.42, 0.12],
        ],
        0.04,
        0.01,
      ),
      M.main3,
      s * 0.36,
      -0.12,
      -0.05,
      HP,
      s < 0 ? PI : 0,
      0,
    );
  }
  CB(headG, 0.42, 0.14, 0.3, M.sub, 0, 0.36, -0.15, 0, 0, 0, 0.02);
  P(headG, gBox(0.03, 0.22, 0.03), M.joint, 0, 0.5, -0.05);
  hazard(headG, M, 0, 0.0, -0.75, 0.3, 0.05);
  // 機身：四節（串成鏈，每節的擺動往後累加）
  const segs = [];
  let parent = torso,
    off = [0, 0.45, -0.7];
  const plates = [];
  for (let i = 0; i < 4; i++) {
    const g = grp(parent, off[0], off[1], off[2]);
    const k = 1 - i * 0.14;
    P(
      g,
      gPod([
        [0.0, 0.72 * k, -0.32 * k, 0.34 * k, 0.2 * k, 0.15 * k],
        [0.85, 0.66 * k, -0.3 * k, 0.32 * k, 0.18 * k, 0.14 * k],
      ]),
      i % 2 ? M.main2 : M.main,
    );
    P(g, gCyl(0.3 * k, 0.3 * k, 0.1, 10), M.joint, 0, 0, 0.92, HP);
    for (const s of [-1, 1]) P(g, gBox(0.04, 0.12 * k, 0.6), coilM, s * 0.37 * k, 0, 0.42);
    P(
      g,
      gPlate(
        [
          [0, 0],
          [0.7, 0],
          [0.5, 0.22 * k],
          [0.1, 0.2 * k],
        ],
        0.04,
        0.01,
      ),
      M.main3,
      0,
      0.32 * k,
      0.1,
      0,
      -HP,
      0,
    );
    kitBolts(g, M, [
      [0.25 * k, 0.28 * k, 0.2, 0, 0, 0],
      [-0.25 * k, 0.28 * k, 0.2, 0, 0, 0],
    ]);
    if (i < 2) plates.push(plateMesh(g, gBox(0.5 * k, 0.05, 0.5), M.main3, 0, -0.3 * k, 0.45));
    segs.push(g);
    parent = g;
    off = [0, 0, 1.0];
  }
  // 尾部：推進器的護罩＋三片螺旋槳
  const tail = segs[3];
  P(tail, new THREE.TorusGeometry(0.28, 0.05, 4, 12), M.joint, 0, 0, 1.15);
  const prop = grp(tail, 0, 0, 1.12);
  for (let i = 0; i < 3; i++) P(prop, gBox(0.08, 0.48, 0.03), M.gun, 0, 0, 0, 0.3, 0, (i * PI * 2) / 3);
  P(prop, gCyl(0.06, 0.06, 0.12, 6), M.joint, 0, 0, 0, HP);
  for (const s of [-1, 1]) P(tail, gBox(0.03, 0.34, 0.36), M.main3, 0, s * 0.22, 1.0, 0, 0, 0);
  const hand = grp(headG, 0, -0.18, -1.2);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'eel_drone',
    height: 0.9 * scale,
    dmg: {
      smoke: [
        [0, 0.8, -0.6],
        [0, 0.7, 1.0],
      ],
      plates,
      chunks: [headG, ...segs],
    },
    extra: { segs, prop, coilM, eyeM },
  });
}

// ---------- 漂流水雷浮標（水沒市街）：浮環＋球形水雷（觸角）＋閃燈桅杆＋水下的配重鏈（高約 1.7 m） ----------
function buildMineBuoy(pal, scale) {
  const { M, root, torso } = base(pal);
  const lampM = glow(0xff3020, 0.4);
  const body = grp(torso);
  const floatG = grp(body),
    mineG = grp(body),
    mastG = grp(body);
  // 浮環：環＋上下的護條＋警示條
  P(floatG, new THREE.TorusGeometry(0.66, 0.16, 6, 16), M.acc, 0, 0.15, 0, HP, 0, 0);
  P(floatG, new THREE.TorusGeometry(0.66, 0.04, 4, 16), M.joint, 0, 0.3, 0, HP, 0, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(
      floatG,
      gBox(0.12, 0.34, 0.06),
      i % 2 ? M.main3 : M.joint,
      Math.cos(a) * 0.82,
      0.15,
      Math.sin(a) * 0.82,
      0,
      -a,
      0,
    );
  }
  // 水雷本體：球＋赤道的螺栓環＋檢修蓋
  P(mineG, gSph(0.52, 12), M.main2, 0, 0.55, 0);
  P(mineG, new THREE.TorusGeometry(0.53, 0.03, 4, 16), M.joint, 0, 0.55, 0, HP, 0, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * PI * 2;
    P(mineG, gCyl(0.025, 0.025, 0.04, 5), M.joint, Math.cos(a) * 0.54, 0.6, Math.sin(a) * 0.54, 0, 0, HP);
  }
  decal(mineG, 7, 0.32, 0.32, 0, 0.58, -0.535, 0, PI, 0);
  // 觸角（引信）：上半球的 6 根，爆炸前伸長並變紅
  const horns = grp(mineG, 0, 0.55, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    const tilt = 0.75;
    const v = new THREE.Vector3(Math.cos(a) * Math.sin(tilt), Math.cos(tilt), Math.sin(a) * Math.sin(tilt));
    rod(horns, M.gun, [v.x * 0.45, v.y * 0.45, v.z * 0.45], [v.x * 0.72, v.y * 0.72, v.z * 0.72], 0.04, 6);
    P(horns, gSph(0.055, 6), lampM, v.x * 0.74, v.y * 0.74, v.z * 0.74);
  }
  // 桅杆：桿＋燈籠架＋閃燈＋小旗
  rod(mastG, M.joint, [0, 1.0, 0], [0, 1.55, 0], 0.035, 6);
  P(mastG, gCyl(0.1, 0.1, 0.04, 8), M.joint, 0, 1.5, 0);
  P(mastG, gSph(0.08, 8), lampM, 0, 1.6, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2;
    rod(
      mastG,
      M.joint,
      [Math.cos(a) * 0.1, 1.5, Math.sin(a) * 0.1],
      [Math.cos(a) * 0.1, 1.7, Math.sin(a) * 0.1],
      0.012,
      4,
    );
  }
  P(mastG, gCyl(0.11, 0.08, 0.04, 8), M.joint, 0, 1.71, 0);
  P(mastG, gBox(0.02, 0.16, 0.24), M.acc, 0, 1.38, 0.13);
  hazard(mastG, M, 0, 1.15, -0.04, 0.12, 0.08);
  // 水下：配重鏈與錘
  for (let i = 0; i < 4; i++)
    P(mineG, new THREE.TorusGeometry(0.06, 0.018, 4, 6), M.joint, 0, -0.02 - i * 0.12, 0, 0, (i % 2) * HP, 0);
  P(mineG, gCyl(0.14, 0.18, 0.22, 8), M.gun, 0, -0.55, 0);
  const plates = [
    plateMesh(mineG, gPlate(crect(0.36, 0.3, 0.06), 0.05, 0.01), M.main3, 0.5, 0.62, 0.0, 0, HP, 0),
    plateMesh(mineG, gPlate(crect(0.36, 0.3, 0.06), 0.05, 0.01), M.main3, -0.5, 0.62, 0.0, 0, HP, 0),
  ];
  finish(root, scale);
  return rig(root, torso, M, {
    type: 'mine_buoy',
    height: 1.7 * scale,
    dmg: {
      smoke: [[0, 1.0, 0]],
      plates,
      chunks: [floatG, mineG, mastG],
    },
    extra: { body, horns, lampM, mast: mastG },
  });
}

export const FOE_BUILDERS_b2 = {
  riveter: buildRiveter,
  welder: buildWelder,
  water_cannon: buildWaterCannon,
  turbine: buildTurbine,
  eel_drone: buildEel,
  mine_buoy: buildMineBuoy,
};
// 模型庫登記：[key, 名稱, 備註]（model-catalog.js 依此建立 vehicle/foe_<key>）
export const FOE_CATALOG_b2 = [
  ['riveter', '鉚釘槍 MT', '集散場專屬；射出黏性鉚釘，黏上 3 秒後爆炸'],
  ['welder', '電焊 MT', '集散場專屬；貼近後以電弧吸走 EN'],
  ['water_cannon', '高壓水砲車', '水壩專屬；蓄水後噴出高衝擊的水柱'],
  ['turbine', '渦輪吸入機', '水壩專屬；打開前蓋把周圍的機體吸向葉片'],
  ['eel_drone', '電鰻無人機', '水沒市街專屬；貼著水面游，放電讓水中的機體受傷'],
  ['mine_buoy', '漂流水雷浮標', '水沒市街專屬；成群漂向目標，靠近就爆炸'],
];
