// 地圖專屬敵人擴充（C1 組）的程式模型：冷凍噴霧機、冰錐迫擊砲（冰原）、全像投影器、寄生纏附體（地下技研都市）、
// 重力錨、滑索突擊兵（Grid 086）。介面同 foe-models.js（vehicle: true；原點在地面，正面 −Z）。
// 會動的節點放在 extra（名稱加 c 開頭的前綴，entities/mech-foe-c1.js 的 foeFx_c1 驅動，房主與客機都看得到）；
// rig.dmg＝受損與擊破的共用執行（冒煙點、AP 低時脫落的裝甲板（不合併的獨立網格）、擊破時拆開的區塊）。
// 注意：foe-models.js 也 import 這個檔案（循環相依），所以這裡只能在函式裡用它的工具，不能在模組頂層呼叫。
import { CB as CB0, P, bakeAll, decal, gBox, gCyl, gPlate, gPod, gSph, kitCable } from './geometry.js';
import { beam, crect, eye, front, hazard, piston, rod, side, slats, track } from './foe-models.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

const PI = Math.PI,
  HP = Math.PI / 2;
// 發光材質（預警時由行為端改 emissiveIntensity）
const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
// 加色的光效（量測與描邊略過）
const fxMat = (color, opacity = 0.5) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
// 倒角方塊；小零件不倒角（省三角形）
function CB(n, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.05) {
  if (Math.min(w, h, d) < 0.4) P(n, gBox(w, h, d), m, x, y, z, rx, ry, rz);
  else CB0(n, w, h, d, m, x, y, z, rx, ry, rz, c);
}
// 子群組（會動的節點、擊破時拆開的區塊）
function grp(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// AP 低時脫落的裝甲板：獨立網格（不被 bakeAll 合併）
function plateMesh(parent, geo, m, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
// 螺栓一排
function bolts(n, M, x0, y, z, dx, k, rx = HP) {
  for (let i = 0; i < k; i++) P(n, gCyl(0.03, 0.03, 0.03, 6), M.joint, x0 + i * dx, y, z, rx);
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
  const hand = o.hand;
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
const iceMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0xd8f2ff,
    emissive: 0x5ab8ff,
    emissiveIntensity: 0.25,
    roughness: 0.12,
    metalness: 0.05,
    flatShading: true,
  });

// ---------- 冷凍噴霧機：履帶底盤＋背上的液態冷媒球形槽（結霜）＋前方的噴嘴臂（高約 3.3 m）----------
function buildCryo(pal, scale) {
  const { M, root, torso } = base(pal);
  const frost = glow(0x9fe8ff, 0.3); // 噴嘴與槽的結霜光（預警時漸強）
  const ice = iceMat();
  const hull = grp(torso),
    trkL = grp(torso),
    trkR = grp(torso),
    tank = grp(torso, 0, 2.5, 0.55),
    arm = grp(torso, 0.62, 1.72, -0.95);
  // 履帶：防滑釘＋擋泥板
  track(trkL, M, -1.08, 0.1, 3.1, 0.85, 0.72, 4, M.acc);
  track(trkR, M, 1.08, 0.1, 3.1, 0.85, 0.72, 4, M.acc);
  for (const [g, s] of [
    [trkL, -1],
    [trkR, 1],
  ]) {
    for (let i = 0; i < 6; i++) P(g, gBox(0.74, 0.05, 0.07), M.joint, s * 1.08, 0.87, -1.15 + i * 0.46);
    side(
      g,
      M.main2,
      [
        [-1.7, 0.95],
        [1.6, 0.95],
        [1.5, 1.12],
        [-1.55, 1.12],
      ],
      0.82,
      s * 1.08,
      0.02,
    );
  }
  // 車體：前低後高的楔形
  P(
    hull,
    gPod([
      [-1.5, 1.5, 0.82, 1.3, 0.14, 0.08],
      [-0.95, 1.72, 0.8, 1.78, 0.2, 0.1],
      [1.25, 1.72, 0.8, 1.8, 0.2, 0.1],
      [1.5, 1.55, 0.85, 1.62, 0.16, 0.1],
    ]),
    M.main,
  );
  // 正面：散熱格柵、雙頭燈、警示條、拖鉤
  P(hull, gBox(1.0, 0.36, 0.05), M.sub, 0, 1.08, -1.49);
  slats(hull, M.joint, 0, 1.2, -1.52, 0.9, 4, 0.08);
  for (const s of [-1, 1]) eye(hull, M, frost, s * 0.6, 1.2, -1.52, 0.07);
  hazard(hull, M, 0, 0.9, -1.53, 1.3, 0.14);
  for (const s of [-1, 1]) P(hull, gCyl(0.06, 0.06, 0.2, 6), M.gun, s * 0.4, 0.82, -1.6, HP);
  // 頂部：艙蓋、天線、側面的工具箱、螺栓、編號
  P(hull, gCyl(0.3, 0.32, 0.1, 10), M.main2, -0.45, 1.84, -0.35);
  P(hull, gCyl(0.08, 0.08, 0.06, 6), M.joint, -0.45, 1.92, -0.35);
  rod(hull, M.joint, [-0.72, 1.8, 0.9], [-0.78, 2.9, 1.0], 0.015, 4);
  P(hull, gSph(0.04, 6), frost, -0.78, 2.92, 1.0);
  for (const s of [-1, 1]) {
    CB(hull, 0.22, 0.4, 0.9, M.main2, s * 0.9, 1.45, 0.65, 0, 0, 0, 0.03);
    bolts(hull, M, s * 1.02, 1.62, 0.3, 0, 1);
    bolts(hull, M, s * 1.02, 1.62, 1.0, 0, 1);
  }
  bolts(hull, M, -0.6, 1.79, -0.75, 0.3, 5, 0);
  decal(hull, 3, 0.6, 0.3, 0.88, 1.3, -0.3, 0, HP, 0);
  // 後方的散熱風扇（待機時轉）
  P(hull, gCyl(0.5, 0.5, 0.14, 12), M.joint, 0, 1.3, 1.52, HP);
  const fan = grp(hull, 0, 1.3, 1.6);
  for (let i = 0; i < 5; i++) P(fan, gBox(0.08, 0.42, 0.03), M.sub, 0, 0, 0, 0, 0, (i / 5) * PI);
  P(fan, gCyl(0.09, 0.09, 0.08, 8), M.gun, 0, 0, 0, HP);
  for (let i = 0; i < 3; i++) P(hull, gBox(0.95, 0.03, 0.03), M.joint, 0, 1.0 + i * 0.3, 1.67);
  // 側裙裝甲板（AP 低時脫落）
  const plates = [-1, 1].map((s) =>
    plateMesh(hull, gPlate(crect(2.2, 0.48, 0.1), 0.06, 0.02), M.main3, s * 1.47, 0.82, 0.0, 0, HP, 0),
  );
  // 冷媒槽：球形槽＋補強環＋鞍座＋閥組＋壓力錶＋結霜
  P(tank, gSph(0.8, 14), M.main3, 0, 0, 0);
  for (const r of [0, HP]) P(tank, new THREE.TorusGeometry(0.81, 0.045, 4, 18), M.main2, 0, 0, 0, r, 0, 0);
  for (const s of [-1, 1]) CB(tank, 0.25, 0.42, 1.2, M.joint, s * 0.5, -0.66, 0, 0, 0, 0, 0.03);
  P(tank, gCyl(0.14, 0.18, 0.22, 8), M.joint, 0, 0.86, 0);
  P(tank, new THREE.TorusGeometry(0.16, 0.025, 4, 10), M.acc, 0, 1.0, 0, HP, 0, 0);
  for (let i = 0; i < 3; i++) P(tank, gBox(0.3, 0.02, 0.02), M.acc, 0, 1.0, 0, 0, (i / 3) * PI, 0);
  P(tank, gCyl(0.12, 0.12, 0.06, 10), M.joint, 0.55, 0.3, -0.45, HP, 0, -0.6);
  P(tank, gCyl(0.1, 0.1, 0.02, 10), frost, 0.58, 0.31, -0.49, HP, 0, -0.6);
  // 結霜（不規則的冰塊）
  for (const [x, y, z, s] of [
    [0.3, -0.4, -0.66, 0.2],
    [-0.5, 0.2, -0.6, 0.16],
    [-0.66, -0.3, 0.3, 0.18],
    [0.2, 0.55, 0.5, 0.14],
  ])
    P(tank, gSph(s, 5), ice, x, y, z, 0.4, 0.2, 0, 1.4, 0.7, 1);
  // 排氣閥板（預警時打開）
  const flaps = [-1, 1].map((s) => {
    const f = grp(tank, s * 0.42, 0.55, 0.42);
    P(f, gBox(0.32, 0.04, 0.28), M.main2, 0, 0, 0.14);
    return f;
  });
  // 噴嘴臂：肩座、臂、液壓、隔熱管、噴頭（喇叭口＋霜環），臂的節點以肩為軸
  P(hull, gCyl(0.26, 0.3, 0.3, 10), M.joint, 0.62, 1.72, -0.95, 0, 0, HP);
  CB(arm, 0.3, 0.3, 1.5, M.gun, 0, 0, -0.75, 0, 0, 0, 0.04);
  piston(arm, M, [0, -0.32, -0.15], [0, -0.12, -1.1], 0.045);
  for (let i = 0; i < 4; i++) P(arm, gCyl(0.17, 0.17, 0.05, 8), M.acc, 0, 0, -0.35 - i * 0.3, HP);
  P(arm, gCyl(0.16, 0.16, 0.25, 8), M.joint, 0, 0, -1.55, HP);
  P(arm, gCyl(0.34, 0.15, 0.55, 12), M.main2, 0, 0, -1.92, HP);
  P(arm, gCyl(0.28, 0.28, 0.03, 12), frost, 0, 0, -2.2, HP);
  P(arm, gSph(0.11, 5), ice, 0.15, 0.25, -2.05, 0, 0, 0, 1.5, 0.6, 1);
  const ring = grp(arm, 0, 0, -1.95);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(ring, gCyl(0.05, 0.07, 0.16, 6), M.joint, Math.cos(a) * 0.42, Math.sin(a) * 0.42, 0, HP);
    P(ring, gSph(0.035, 5), frost, Math.cos(a) * 0.42, Math.sin(a) * 0.42, -0.1);
  }
  P(ring, new THREE.TorusGeometry(0.42, 0.03, 4, 16), M.gun, 0, 0, 0);
  kitCable(
    torso,
    M,
    [
      [0.35, 2.1, 0.0],
      [0.55, 2.0, -0.5],
      [0.62, 1.95, -0.95],
    ],
    0.05,
  );
  kitCable(
    torso,
    M,
    [
      [-0.2, 2.0, 0.0],
      [0.1, 1.9, -0.6],
      [0.5, 1.85, -1.0],
    ],
    0.035,
  );
  const hand = grp(arm, 0, 0, -2.3);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'cryo',
    height: 3.3 * scale,
    dmg: {
      smoke: [
        [0, 1.9, 0.9],
        [0.55, 2.9, 0.4],
        [-0.8, 1.4, -0.6],
      ],
      plates,
      chunks: [hull, trkL, trkR, tank, arm],
    },
    extra: { cArm: arm, cRing: ring, cFan: fan, cFlaps: flaps, cGlow: frost },
  });
}

// ---------- 冰錐迫擊砲：四腳砲座＋可俯仰的大口徑砲管＋冰錐彈倉（旋轉的六角彈鼓）＋展開的駐鋤（高約 3.8 m）----------
function buildIceMortar(pal, scale) {
  const { M, root, torso } = base(pal);
  const cry = glow(0x8fdcff, 0.4); // 冰錐的光（裝填、預警時漸強）
  const ice = iceMat();
  const body = grp(torso),
    legsG = grp(torso),
    mount = grp(torso, 0, 2.15, 0.15),
    drumG = grp(torso, 1.05, 1.75, 0.55);
  // 四隻腳：髖關節、往外的大腿、膝、往下的小腿、寬腳掌（雪地）
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      P(legsG, gCyl(0.2, 0.2, 0.32, 8), M.joint, sx * 0.95, 1.35, sz * 0.85, 0, 0, HP);
      beam(legsG, M.main2, [sx * 1.0, 1.4, sz * 0.9], [sx * 1.6, 1.6, sz * 1.35], 0.3, 0.28, 0.05);
      P(legsG, gCyl(0.15, 0.15, 0.3, 8), M.joint, sx * 1.62, 1.6, sz * 1.36, 0, 0, HP);
      beam(legsG, M.main, [sx * 1.62, 1.55, sz * 1.36], [sx * 1.6, 0.2, sz * 1.45], 0.22, 0.24, 0.05);
      piston(legsG, M, [sx * 1.15, 1.15, sz * 1.0], [sx * 1.55, 0.6, sz * 1.42], 0.04);
      P(legsG, gCyl(0.38, 0.42, 0.12, 8), M.sub, sx * 1.6, 0.06, sz * 1.45);
      for (let k = 0; k < 3; k++)
        P(legsG, gBox(0.06, 0.08, 0.5), M.joint, sx * 1.6 + (k - 1) * 0.2, 0.14, sz * 1.45);
    }
  // 車體：八角箱、正面的觀測窗、側面的散熱縫、警示條、編號
  P(
    body,
    gPod([
      [-1.2, 1.7, 1.0, 1.7, 0.18, 0.12],
      [-0.85, 1.9, 0.95, 2.05, 0.2, 0.12],
      [1.05, 1.9, 0.95, 2.05, 0.2, 0.12],
      [1.3, 1.7, 1.0, 1.85, 0.18, 0.12],
    ]),
    M.main,
  );
  P(body, gBox(0.7, 0.18, 0.05), M.sub, 0, 1.7, -1.2);
  P(body, gBox(0.6, 0.1, 0.04), cry, 0, 1.7, -1.23);
  for (const s of [-1, 1]) slats(body, M.joint, s * 0.96, 1.75, -0.2, 0.05, 4, 0.1, HP);
  hazard(body, M, 0, 1.15, -1.21, 1.4, 0.14);
  decal(body, 5, 0.5, 0.3, -0.5, 1.45, -1.22, 0, PI, 0);
  bolts(body, M, -0.75, 2.06, -0.7, 0.3, 6, 0);
  // 駐鋤（預警時往下展開，撐住後座）
  const stabs = [-1, 1].map((s) => {
    const g = grp(body, s * 0.7, 1.05, 1.25);
    beam(g, M.joint, [0, 0, 0], [0, -0.3, 0.75], 0.18, 0.12);
    P(g, gBox(0.45, 0.06, 0.32), M.gun, 0, -0.38, 0.85, -0.6, 0, 0);
    P(g, gCyl(0.1, 0.1, 0.25, 8), M.joint, 0, 0, 0, 0, 0, HP);
    return g;
  });
  // 背面的裝甲板（AP 低時脫落）
  const plates = [
    plateMesh(body, gPlate(crect(1.3, 0.6, 0.12), 0.07, 0.02), M.main3, 0, 1.5, 1.33),
    plateMesh(body, gPlate(crect(0.9, 0.55, 0.1), 0.06, 0.02), M.main3, -0.98, 1.45, 0.4, 0, HP, 0),
  ];
  // 迴轉台與砲架：轉盤、耳軸座，砲管節點以耳軸為軸
  P(body, gCyl(0.95, 1.0, 0.18, 14), M.joint, 0, 2.12, 0.15);
  for (const s of [-1, 1]) {
    front(
      mount,
      M.main2,
      [
        [-0.3, -0.05],
        [0.3, -0.05],
        [0.2, 0.55],
        [-0.2, 0.55],
      ],
      0.18,
      0,
      0.02,
      1,
      1,
      s * 0.62,
      0,
    );
    P(mount, gCyl(0.13, 0.13, 0.22, 8), M.gun, s * 0.62, 0.45, 0, 0, 0, HP);
  }
  const tube = grp(mount, 0, 0.45, 0); // 俯仰（rotation.x，往前倒＝負）
  tube.rotation.x = -0.55;
  const slide = grp(tube); // 後座（沿砲管滑動）
  P(slide, gCyl(0.36, 0.42, 2.6, 12), M.gun, 0, 0.5, 0);
  P(slide, gCyl(0.46, 0.46, 0.5, 12), M.main2, 0, -0.55, 0);
  P(slide, gCyl(0.44, 0.36, 0.18, 12), M.joint, 0, 1.85, 0);
  for (const y of [-0.1, 0.5, 1.1]) P(slide, gCyl(0.4, 0.4, 0.06, 12), M.acc, 0, y, 0);
  P(slide, gCyl(0.3, 0.3, 0.02, 12), cry, 0, 1.95, 0);
  for (const [x, z] of [
    [0.3, -0.3],
    [-0.32, 0.2],
  ])
    P(slide, gSph(0.12, 5), ice, x, 1.7, z, 0, 0, 0, 1, 1.6, 1);
  for (const s of [-1, 1]) piston(mount, M, [s * 0.35, 0.05, 0.55], [s * 0.4, 0.75, 0.15], 0.05);
  // 冰錐彈鼓：六角筒＋冰錐（會轉）
  P(body, gCyl(0.16, 0.16, 0.3, 8), M.joint, 0.92, 1.75, 0.55, 0, 0, HP);
  P(drumG, gCyl(0.55, 0.55, 0.5, 6), M.main2, 0, 0, 0, 0, 0, HP);
  P(drumG, gCyl(0.6, 0.6, 0.06, 6), M.joint, 0.27, 0, 0, 0, 0, HP);
  P(drumG, gCyl(0.6, 0.6, 0.06, 6), M.joint, -0.27, 0, 0, 0, 0, HP);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 6;
    P(drumG, gCyl(0.0, 0.12, 0.55, 5), cry, 0.1, Math.cos(a) * 0.62, Math.sin(a) * 0.62, a, 0, 0);
  }
  // 測距儀：砲架側面的感測器
  CB(mount, 0.25, 0.2, 0.35, M.sub, -0.85, 0.4, -0.1, 0, 0, 0, 0.03);
  eye(mount, M, cry, -0.85, 0.4, -0.3, 0.06);
  kitCable(
    torso,
    M,
    [
      [0.8, 2.0, 0.55],
      [0.5, 2.35, 0.4],
      [0.3, 2.55, 0.2],
    ],
    0.05,
  );
  const hand = grp(slide, 0, 2.0, 0);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'icemortar',
    height: 3.8 * scale,
    dmg: {
      smoke: [
        [0, 2.1, 0.6],
        [0.9, 1.8, 0.5],
        [-0.6, 1.6, -0.6],
      ],
      plates,
      chunks: [body, legsG, mount, drumG],
    },
    extra: { cTube: tube, cSlide: slide, cDrum: drumG, cStabs: stabs, cGlow: cry },
  });
}

// ---------- 全像投影器：三腳架＋六角主機＋頂部的投影頭（旋轉的發射環、預警時張開的花瓣、投影錐）（高約 3.4 m）----------
function buildHoloProj(pal, scale) {
  const { M, root, torso } = base(pal);
  const holo = glow(0x60fff0, 0.6); // 投影光（投影前漸強）
  const lamp = glow(0x60fff0, 1.8);
  const legsG = grp(torso),
    core = grp(torso),
    head = grp(torso, 0, 2.75, 0);
  // 三腳：髖座、往外上的大腿、膝、往下的小腿、腳掌（三點著地）
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    P(legsG, gCyl(0.14, 0.14, 0.25, 8), M.joint, c * 0.5, 1.45, s * 0.5, 0, -a, HP);
    beam(legsG, M.main2, [c * 0.5, 1.45, s * 0.5], [c * 1.25, 1.85, s * 1.25], 0.2, 0.22, 0.05);
    P(legsG, gSph(0.13, 8), M.joint, c * 1.27, 1.85, s * 1.27);
    beam(legsG, M.main, [c * 1.27, 1.82, s * 1.27], [c * 1.55, 0.15, s * 1.55], 0.16, 0.18, 0.05);
    piston(legsG, M, [c * 0.62, 1.2, s * 0.62], [c * 1.4, 1.0, s * 1.4], 0.03);
    P(legsG, gCyl(0.28, 0.32, 0.1, 6), M.sub, c * 1.56, 0.05, s * 1.56);
    P(legsG, gSph(0.05, 6), lamp, c * 1.3, 1.95, s * 1.3);
  }
  // 主機：六角筒＋上下的蓋＋側面的伺服器架（散熱縫、指示燈）＋編號
  P(core, gCyl(0.62, 0.62, 1.1, 6), M.main, 0, 1.75, 0, 0, PI / 6);
  P(core, gCyl(0.45, 0.66, 0.25, 6), M.main3, 0, 1.08, 0, 0, PI / 6);
  P(core, gCyl(0.66, 0.5, 0.2, 6), M.main3, 0, 2.4, 0, 0, PI / 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 6;
    const c = Math.cos(a),
      s = Math.sin(a);
    CB(core, 0.42, 0.75, 0.12, M.sub, c * 0.6, 1.78, s * 0.6, 0, -a + HP, 0, 0.02);
    for (let k = 0; k < 4; k++)
      P(core, gBox(0.3, 0.025, 0.03), M.joint, c * 0.67, 1.55 + k * 0.12, s * 0.67, 0, -a + HP, 0);
    P(core, gBox(0.05, 0.05, 0.03), holo, c * 0.67, 2.08, s * 0.67, 0, -a + HP, 0);
  }
  decal(core, 6, 0.4, 0.28, 0, 1.85, -0.55, 0, PI, 0);
  hazard(core, M, 0, 1.15, -0.5, 0.6, 0.1);
  // 底部的資料脊柱：往下的導管與閃燈
  P(core, gCyl(0.12, 0.12, 0.5, 6), M.gun, 0, 0.75, 0);
  for (const y of [0.6, 0.85]) P(core, gCyl(0.15, 0.15, 0.04, 6), lamp, 0, y, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2;
    kitCable(
      core,
      M,
      [
        [Math.cos(a) * 0.3, 2.3, Math.sin(a) * 0.3],
        [Math.cos(a) * 0.72, 2.0, Math.sin(a) * 0.72],
        [Math.cos(a) * 0.68, 1.3, Math.sin(a) * 0.68],
      ],
      0.03,
    );
  }
  // 側面的面板（AP 低時脫落）
  const plates = [0, 1].map((i) => {
    const a = (i / 3) * PI * 2 + PI / 6 + PI / 3;
    return plateMesh(
      core,
      gPlate(crect(0.55, 0.85, 0.08), 0.05, 0.015),
      M.main3,
      Math.cos(a) * 0.58,
      1.75,
      Math.sin(a) * 0.58,
      0,
      -a + HP,
      0,
    );
  });
  // 投影頭：頸、球形頭、正面的鏡頭（發光）、上方的天線
  P(head, gCyl(0.2, 0.28, 0.3, 8), M.joint, 0, -0.2, 0);
  P(head, gSph(0.5, 12), M.main3, 0, 0.25, 0);
  P(head, gCyl(0.52, 0.52, 0.1, 14), M.main2, 0, 0.25, 0);
  P(head, gCyl(0.24, 0.3, 0.2, 12), M.joint, 0, 0.25, -0.46, HP);
  P(head, gCyl(0.2, 0.2, 0.03, 12), holo, 0, 0.25, -0.57, HP);
  rod(head, M.joint, [0.2, 0.7, 0.1], [0.25, 1.15, 0.15], 0.015, 4);
  P(head, gSph(0.04, 6), lamp, 0.25, 1.16, 0.15);
  // 發射環（待機慢轉、投影時快轉）
  const ringG = grp(head, 0, 0.25, 0);
  P(ringG, new THREE.TorusGeometry(0.78, 0.04, 4, 20), M.gun, 0, 0, 0, HP, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    P(ringG, gBox(0.14, 0.14, 0.14), M.joint, Math.cos(a) * 0.78, 0, Math.sin(a) * 0.78, 0, -a, 0);
    P(ringG, gSph(0.05, 6), holo, Math.cos(a) * 0.86, 0, Math.sin(a) * 0.86);
  }
  // 花瓣（預警時張開）
  const petals = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    const pg = grp(head, Math.cos(a) * 0.35, 0.55, Math.sin(a) * 0.35);
    pg.rotation.y = -a + HP;
    P(
      pg,
      gPlate(
        [
          [-0.16, 0],
          [0.16, 0],
          [0.08, 0.5],
          [-0.08, 0.5],
        ],
        0.04,
        0.01,
      ),
      M.main,
      0,
      0,
      0,
    );
    P(pg, gBox(0.06, 0.3, 0.02), holo, 0, 0.22, -0.03);
    petals.push(pg);
  }
  // 投影錐（加色，只在投影時看得到）
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.4, 3.2, 16, 1, true), fxMat(0x60fff0, 0.18));
  cone.position.set(0, 0.25, -2.0);
  cone.rotation.x = -HP;
  cone.visible = false;
  head.add(cone);
  const hand = grp(head, 0, 0.25, -0.6);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'holoproj',
    height: 3.6 * scale,
    dmg: {
      smoke: [
        [0, 2.3, 0],
        [0.4, 1.6, 0.3],
        [0, 3.0, 0],
      ],
      plates,
      chunks: [legsG, core, head],
    },
    extra: { cHead: head, cRing: ringG, cPetals: petals, cCone: cone, cGlow: holo },
  });
}

// ---------- 寄生纏附體：分節的甲殼＋六隻鉤爪腳＋前顎＋背上的注射脊（發光的藥劑瓶）（高約 1.3 m）----------
function buildParasite(pal, scale) {
  const { M, root, torso } = base(pal);
  const red = glow(0xff3a30, 0.8); // 眼與注射脊（撲擊前漸強）
  const vial = glow(0x9aff40, 1.4);
  const bodyG = grp(torso); // 整個身體（蹲低時下壓）
  const shell = grp(bodyG),
    headG = grp(bodyG, 0, 0.75, -0.75);
  // 甲殼：頭胸＋腹部三節（每節一圈邊）
  P(
    shell,
    gPod([
      [-0.7, 0.9, 0.48, 0.95, 0.18, 0.12],
      [-0.25, 1.1, 0.42, 1.12, 0.25, 0.15],
      [0.15, 1.0, 0.45, 1.05, 0.22, 0.14],
    ]),
    M.main,
  );
  for (let i = 0; i < 3; i++) {
    const z = 0.3 + i * 0.32,
      w = 1.05 - i * 0.18;
    P(
      shell,
      gPod([
        [z - 0.16, w * 0.92, 0.5, 1.0 - i * 0.08, 0.2, 0.12],
        [z + 0.16, w, 0.48, 1.03 - i * 0.08, 0.22, 0.12],
      ]),
      i % 2 ? M.main2 : M.main,
    );
    P(shell, gBox(w * 0.9, 0.04, 0.05), M.joint, 0, 1.02 - i * 0.08, z + 0.17);
  }
  // 尾端的螫針
  beam(shell, M.joint, [0, 0.75, 1.15], [0, 0.95, 1.55], 0.1, 0.1);
  P(shell, gCyl(0.0, 0.07, 0.3, 6), M.acc, 0, 1.05, 1.68, -0.9);
  // 背上的注射脊：脊板＋藥劑瓶（發光）＋管線
  const spine = grp(shell, 0, 1.12, 0.1);
  for (let i = 0; i < 4; i++)
    P(
      spine,
      gPlate(
        [
          [-0.1, 0],
          [0.1, 0],
          [0, 0.28 - i * 0.04],
        ],
        0.04,
        0.01,
      ),
      M.acc,
      0,
      0,
      -0.3 + i * 0.22,
      0,
      HP,
      0,
    );
  for (const s of [-1, 1]) {
    P(spine, gCyl(0.07, 0.07, 0.32, 8), vial, s * 0.2, 0.05, 0.05, HP);
    P(spine, gCyl(0.085, 0.085, 0.04, 8), M.joint, s * 0.2, 0.05, -0.12, HP);
    P(spine, gCyl(0.085, 0.085, 0.04, 8), M.joint, s * 0.2, 0.05, 0.22, HP);
  }
  kitCable(
    shell,
    M,
    [
      [0.2, 1.15, -0.1],
      [0.32, 1.0, -0.45],
      [0.2, 0.9, -0.7],
    ],
    0.025,
  );
  // 腹部的裝甲片（AP 低時脫落）
  const plates = [-1, 1].map((s) =>
    plateMesh(
      shell,
      gPlate(crect(0.6, 0.3, 0.06), 0.04, 0.01),
      M.main3,
      s * 0.5,
      0.72,
      0.45,
      0,
      HP + s * 0.2,
      s * 0.3,
    ),
  );
  // 頭：楔形、眼群（發光）、兩片前顎（撲擊時張開）
  P(
    headG,
    gPod([
      [-0.35, 0.45, -0.15, 0.12, 0.08, 0.06],
      [0.05, 0.7, -0.22, 0.22, 0.12, 0.08],
    ]),
    M.main2,
  );
  for (const [x, y, z, r] of [
    [-0.12, 0.12, -0.3, 0.06],
    [0.12, 0.12, -0.3, 0.06],
    [-0.22, 0.05, -0.22, 0.04],
    [0.22, 0.05, -0.22, 0.04],
    [0, 0.17, -0.25, 0.035],
  ])
    P(headG, gSph(r, 6), red, x, y, z);
  const jaws = [-1, 1].map((s) => {
    const j = grp(headG, s * 0.18, -0.08, -0.3);
    beam(j, M.joint, [0, 0, 0], [s * 0.12, -0.05, -0.32], 0.08, 0.07);
    beam(j, M.acc, [s * 0.12, -0.05, -0.32], [-s * 0.04, -0.08, -0.5], 0.06, 0.05);
    return j;
  });
  // 六隻腳（腳群組以髖為軸：步伐、纏附時收攏）
  const legs = [];
  for (const z of [-0.45, 0.05, 0.55])
    for (const s of [-1, 1]) {
      const L = grp(bodyG, s * 0.42, 0.68, z);
      P(L, gSph(0.08, 6), M.joint, 0, 0, 0);
      beam(L, M.main3, [0, 0, 0], [s * 0.55, 0.38, z * 0.15], 0.09, 0.1);
      P(L, gSph(0.06, 6), M.joint, s * 0.55, 0.38, z * 0.15);
      beam(L, M.joint, [s * 0.55, 0.38, z * 0.15], [s * 0.85, -0.62, z * 0.3], 0.06, 0.07);
      beam(L, M.acc, [s * 0.85, -0.62, z * 0.3], [s * 0.72, -0.66, z * 0.3 - 0.12], 0.04, 0.04);
      L.userData.side = s;
      L.userData.ph = (z + 0.45) * 2 + (s > 0 ? PI : 0);
      legs.push(L);
    }
  const hand = grp(headG, 0, 0, -0.55);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'parasite',
    height: 1.4 * scale,
    dmg: {
      smoke: [
        [0, 1.0, 0.3],
        [0, 0.9, -0.5],
      ],
      plates,
      chunks: [shell, headG, ...legs.filter((_, i) => i % 2 === 0)],
    },
    extra: { cBody: bodyG, cJaws: jaws, cLegs: legs, cSpine: spine, cGlow: red },
  });
}

// ---------- 重力錨：四腳的重裝砲座＋背上的重力核心（兩層陀螺環）＋前方的錨樁發射器＋腳底的固定爪（高約 3.7 m）----------
function buildAnchor(pal, scale) {
  const { M, root, torso } = base(pal);
  const core = glow(0xb060ff, 0.8); // 重力核心（預警時漸強）
  const lamp = glow(0xb060ff, 2);
  const hull = grp(torso),
    legsG = grp(torso),
    gyro = grp(torso, 0, 2.75, 0.45),
    gun = grp(torso, 0, 1.75, -0.95);
  // 四隻粗腳＋固定爪（展開時往下打進地面）
  const clamps = [];
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      P(legsG, gCyl(0.24, 0.24, 0.36, 8), M.joint, sx * 0.9, 1.25, sz * 0.8, 0, 0, HP);
      beam(legsG, M.main2, [sx * 0.95, 1.25, sz * 0.82], [sx * 1.45, 1.05, sz * 1.25], 0.36, 0.34, 0.06);
      beam(legsG, M.main, [sx * 1.45, 1.05, sz * 1.25], [sx * 1.4, 0.25, sz * 1.3], 0.34, 0.36, 0.06);
      P(legsG, gCyl(0.42, 0.48, 0.2, 8), M.sub, sx * 1.4, 0.1, sz * 1.3);
      hazard(legsG, M, sx * 1.62, 0.7, sz * 1.3, 0.3, 0.1, HP);
      const c = grp(legsG, sx * 1.4, 0.35, sz * 1.3);
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * PI * 2;
        P(c, gCyl(0.0, 0.08, 0.5, 5), M.gun, Math.cos(a) * 0.3, -0.25, Math.sin(a) * 0.3, PI);
      }
      clamps.push(c);
    }
  // 車體：寬扁的八角箱＋正面的斜裝甲＋側面散熱縫＋警示燈＋編號
  P(
    hull,
    gPod([
      [-1.25, 1.7, 0.95, 1.7, 0.2, 0.14],
      [-0.85, 1.95, 0.9, 2.05, 0.24, 0.14],
      [1.1, 1.95, 0.9, 2.1, 0.24, 0.14],
      [1.35, 1.75, 0.95, 1.9, 0.2, 0.14],
    ]),
    M.main,
  );
  front(hull, M.main2, crect(1.5, 0.7, 0.14), 0.12, -1.28, 0.03, 0.9, 1, 0, 1.45, 0.35);
  for (const s of [-1, 1]) slats(hull, M.joint, s * 0.99, 1.8, 0.3, 0.05, 5, 0.09, HP);
  for (const s of [-1, 1]) P(hull, gSph(0.07, 6), lamp, s * 0.75, 2.1, -0.75);
  decal(hull, 4, 0.5, 0.3, 0.4, 1.45, -1.36, 0.35, PI, 0);
  bolts(hull, M, -0.75, 2.11, 1.0, 0.3, 6, 0);
  const plates = [-1, 1].map((s) =>
    plateMesh(hull, gPlate(crect(1.3, 0.5, 0.1), 0.06, 0.02), M.main3, s * 1.0, 1.35, 0.1, 0, HP, 0),
  );
  // 重力核心：底座、球形核心、兩層陀螺環（會轉）、支架
  P(hull, gCyl(0.6, 0.75, 0.3, 12), M.joint, 0, 2.15, 0.45);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    beam(
      hull,
      M.gun,
      [Math.cos(a) * 0.55, 2.2, 0.45 + Math.sin(a) * 0.55],
      [Math.cos(a) * 0.2, 2.5, 0.45 + Math.sin(a) * 0.2],
      0.08,
      0.08,
    );
  }
  P(gyro, gSph(0.42, 12), core, 0, 0, 0);
  const g1 = grp(gyro),
    g2 = grp(gyro);
  P(g1, new THREE.TorusGeometry(0.72, 0.06, 4, 22), M.gun, 0, 0, 0);
  for (let i = 0; i < 4; i++)
    P(g1, gBox(0.12, 0.12, 0.12), M.joint, Math.cos((i * PI) / 2) * 0.72, Math.sin((i * PI) / 2) * 0.72, 0);
  P(g2, new THREE.TorusGeometry(0.9, 0.05, 4, 24), M.acc, 0, 0, 0, HP, 0, 0);
  for (let i = 0; i < 6; i++)
    P(g2, gSph(0.05, 6), lamp, Math.cos((i * PI) / 3) * 0.9, 0, Math.sin((i * PI) / 3) * 0.9);
  // 錨樁發射器：砲身＋樁（發射時伸出）＋機槍（hand）
  P(gun, gCyl(0.3, 0.3, 0.4, 10), M.joint, 0, 0, 0, 0, 0, HP);
  CB(gun, 0.5, 0.5, 1.3, M.gun, 0, 0, -0.6, 0, 0, 0, 0.05);
  for (let i = 0; i < 3; i++) P(gun, gBox(0.54, 0.04, 0.06), M.acc, 0, 0.26, -0.2 - i * 0.35);
  const spike = grp(gun, 0, 0, -1.25);
  P(spike, gCyl(0.0, 0.16, 0.6, 6), M.acc, 0, 0, -0.3, -HP);
  P(spike, gCyl(0.1, 0.1, 0.8, 6), M.joint, 0, 0, 0.35, HP);
  P(spike, gSph(0.09, 6), lamp, 0, 0, -0.05);
  P(gun, gCyl(0.05, 0.06, 0.8, 6), M.gun, 0.4, -0.1, -0.85, HP);
  CB(gun, 0.22, 0.24, 0.4, M.sub, 0.4, -0.1, -0.35, 0, 0, 0, 0.02);
  kitCable(
    torso,
    M,
    [
      [0.3, 2.2, 0.2],
      [0.35, 2.0, -0.5],
      [0.2, 1.85, -0.95],
    ],
    0.045,
  );
  const hand = grp(gun, 0.4, -0.1, -1.3);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'anchor',
    height: 3.7 * scale,
    dmg: {
      smoke: [
        [0, 2.1, 0.9],
        [0.7, 1.8, -0.4],
        [-0.7, 1.8, 0.4],
      ],
      plates,
      chunks: [hull, legsG, gyro, gun],
    },
    extra: { cGyro: [g1, g2], cSpike: spike, cClamps: clamps, cGlow: core },
  });
}

// ---------- 滑索突擊兵：逆關節雙腳＋小型軀幹＋背上的絞盤（滑行時轉）＋左手的鉤爪發射器（舉起）＋右手霰彈槍（高約 2.6 m）----------
function buildZipline(pal, scale) {
  const { M, root, torso } = base(pal);
  const lampM = glow(0xffd040, 0.6); // 肩燈（纜索預警時亮）
  const visor = glow(0xffa040, 1.8);
  const legsG = grp(torso, 0, 1.25, 0.05),
    body = grp(torso),
    hookArm = grp(torso, -0.55, 1.9, -0.05),
    gunArm = grp(torso, 0.55, 1.85, -0.05);
  // 逆關節腳：大腿往前下、小腿往後下、腳掌（三爪）
  for (const s of [-1, 1]) {
    P(legsG, gCyl(0.13, 0.13, 0.22, 8), M.joint, s * 0.3, 0, 0, 0, 0, HP);
    beam(legsG, M.main2, [s * 0.32, 0, 0], [s * 0.36, -0.55, -0.35], 0.2, 0.22, 0.05);
    P(legsG, gSph(0.1, 6), M.joint, s * 0.36, -0.55, -0.35);
    beam(legsG, M.main, [s * 0.36, -0.55, -0.35], [s * 0.34, -1.12, 0.12], 0.14, 0.16, 0.03);
    piston(legsG, M, [s * 0.3, -0.12, 0.12], [s * 0.35, -0.85, 0.05], 0.025);
    for (const a of [-0.35, 0, 0.35])
      beam(
        legsG,
        M.joint,
        [s * 0.34, -1.16, 0.12],
        [s * 0.34 + Math.sin(a) * 0.25, -1.24, 0.12 - Math.cos(a) * 0.25],
        0.06,
        0.05,
      );
    P(legsG, gBox(0.12, 0.08, 0.18), M.gun, s * 0.34, -1.2, 0.26);
  }
  // 軀幹：前傾的楔形胸＋腰＋頭（細長的護目鏡）＋背包
  P(
    body,
    gPod([
      [-0.38, 0.75, 1.35, 1.95, 0.14, 0.1],
      [0.0, 0.9, 1.3, 2.1, 0.18, 0.12],
      [0.32, 0.8, 1.35, 2.0, 0.16, 0.1],
    ]),
    M.main,
  );
  P(body, gCyl(0.22, 0.26, 0.2, 8), M.joint, 0, 1.3, 0.02);
  CB(body, 0.36, 0.26, 0.42, M.main2, 0, 2.22, -0.08, 0, 0, 0, 0.04);
  P(body, gBox(0.3, 0.06, 0.04), visor, 0, 2.24, -0.3);
  rod(body, M.joint, [0.12, 2.35, 0.1], [0.14, 2.7, 0.2], 0.012, 4);
  hazard(body, M, 0, 1.55, -0.39, 0.5, 0.08);
  decal(body, 1, 0.3, 0.18, -0.2, 1.8, -0.39, 0, PI, 0);
  bolts(body, M, -0.2, 2.05, -0.36, 0.2, 3);
  const plates = [-1, 1].map((s) =>
    plateMesh(
      body,
      gPlate(crect(0.42, 0.36, 0.06), 0.05, 0.01),
      M.main3,
      s * 0.46,
      1.75,
      -0.05,
      0,
      HP,
      s * 0.15,
    ),
  );
  // 背上的絞盤：外框＋捲軸（會轉）＋纜索出口
  CB(body, 0.6, 0.6, 0.3, M.main2, 0, 1.75, 0.45, 0, 0, 0, 0.04);
  const reel = grp(body, 0, 1.75, 0.68);
  P(reel, gCyl(0.25, 0.25, 0.5, 10), M.joint, 0, 0, 0, 0, 0, HP);
  for (const s of [-1, 1]) P(reel, gCyl(0.32, 0.32, 0.04, 10), M.gun, s * 0.24, 0, 0, 0, 0, HP);
  for (let i = 0; i < 4; i++)
    P(reel, gBox(0.44, 0.05, 0.05), M.acc, 0, Math.cos((i * PI) / 2) * 0.28, Math.sin((i * PI) / 2) * 0.28);
  P(body, gCyl(0.06, 0.06, 0.3, 6), M.gun, -0.3, 2.05, 0.45);
  kitCable(
    body,
    M,
    [
      [-0.2, 1.95, 0.6],
      [-0.45, 2.05, 0.3],
      [-0.55, 1.95, -0.05],
    ],
    0.02,
  );
  // 左手：鉤爪發射器（滑索時舉起），肩燈
  P(hookArm, gSph(0.15, 8), M.joint, 0, 0, 0);
  beam(hookArm, M.main2, [0, 0, 0], [-0.08, -0.5, -0.1], 0.16, 0.16, 0.03);
  CB(hookArm, 0.2, 0.2, 0.55, M.gun, -0.08, -0.55, -0.32, 0, 0, 0, 0.03);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * PI * 2;
    beam(
      hookArm,
      M.acc,
      [-0.08, -0.55, -0.6],
      [-0.08 + Math.cos(a) * 0.14, -0.55 + Math.sin(a) * 0.14, -0.78],
      0.04,
      0.04,
    );
  }
  P(hookArm, gSph(0.06, 6), lampM, -0.12, 0.12, -0.05);
  // 右手：霰彈槍（hand）
  P(gunArm, gSph(0.15, 8), M.joint, 0, 0, 0);
  beam(gunArm, M.main2, [0, 0, 0], [0.06, -0.45, -0.15], 0.16, 0.16, 0.03);
  CB(gunArm, 0.18, 0.22, 0.7, M.gun, 0.06, -0.48, -0.5, 0, 0, 0, 0.03);
  P(gunArm, gCyl(0.06, 0.06, 0.5, 6), M.gun, 0.06, -0.44, -1.05, HP);
  P(gunArm, gCyl(0.045, 0.045, 0.5, 6), M.joint, 0.06, -0.56, -0.95, HP);
  const hand = grp(gunArm, 0.06, -0.44, -1.32);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'zipline',
    height: 2.7 * scale,
    dmg: {
      smoke: [
        [0, 1.8, 0.2],
        [0, 1.75, 0.6],
      ],
      plates,
      chunks: [body, legsG, hookArm, gunArm],
    },
    extra: { cReel: reel, cHook: hookArm, cLegs: legsG, cGlow: lampM },
  });
}

export const FOE_BUILDERS_C1 = {
  cryo: buildCryo,
  icemortar: buildIceMortar,
  holoproj: buildHoloProj,
  parasite: buildParasite,
  anchor: buildAnchor,
  zipline: buildZipline,
};
// 模型庫登記：[key, 名稱, 備註]
export const FOE_CATALOG_C1 = [
  ['cryo', '冷凍噴霧機', '冰原專屬；近中距離噴出冷凍霧，被噴到會變慢'],
  ['icemortar', '冰錐迫擊砲', '冰原專屬；拋射冰錐，落點長出可以打碎的冰牆'],
  ['holoproj', '全像投影器', '技研都市專屬；投出假敵人吸走鎖定'],
  ['parasite', '寄生纏附體', '技研都市專屬；撲上來纏住機體持續損傷'],
  ['anchor', '重力錨', 'Grid 086 專屬；展開重力圈，裡面不能跳、空中被往下拉'],
  ['zipline', '滑索突擊兵', 'Grid 086 專屬；從上層平台沿纜索滑到背後突擊'],
];
