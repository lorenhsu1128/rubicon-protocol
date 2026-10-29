// 地圖專屬敵人擴充（C2 組）的程式模型：燃料洩漏車、誘導飛彈架（舊宇宙港）、拋網無人機、迴旋刃無人機（洋上都市）、
// 反射鏡衛星、聚光鏡陣列（高空軌道）。介面同 foe-models.js（vehicle: true；原點在地面，飛行的在機體中心下方，正面 −Z）。
// 會動的節點放在 extra（entities/mech-foe-c2.js 的 foeFx_c2 依 bossVis 驅動：待機／預警／攻擊），
// dmg＝受損狀態（冒煙點、AP 低時脫落的裝甲板（獨立網格）、擊破時飛散的區塊群組）。
import { P, bakeAll, decal, gBox, gCyl, gPod, gSph, kitCable } from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';
import { PB, beam, crect, eye, front, piston, rod, side, slats, top, wheel } from './foe-models.js';

const PI = Math.PI,
  HP = Math.PI / 2;

// 發光材質（每台各自一份：預警時 foeFx_c2 改 emissiveIntensity）
const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });
// 鏡面：高金屬、低粗糙，帶一點自發光讓它在暗處也看得出是鏡子
const mirrorMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0xdfe8f0,
    metalness: 1,
    roughness: 0.06,
    emissive: 0x5a7a96,
    emissiveIntensity: 0.35,
    flatShading: true,
  });
// 警示條的黃色（各色盤的 acc 不一定是黃色）
let HZ = null;
const hzMat = () =>
  HZ || (HZ = new THREE.MeshStandardMaterial({ color: 0xe8b820, roughness: 0.6, metalness: 0.2 }));
// 警示條：底板＋斜向的黃黑條（ry：面朝向，0＝朝 −Z）
function stripes(n, M, x, y, z, w, h, ry = 0) {
  P(n, gBox(w, h, 0.02), M.joint, x, y, z, 0, ry);
  const k = Math.min(7, Math.max(2, Math.round(w / (h * 1.1))));
  const dx = w / k;
  const ox = Math.cos(ry),
    oz = -Math.sin(ry);
  for (let i = 0; i < k; i++) {
    const t = -w / 2 + dx * (i + 0.5);
    P(n, gBox(dx * 0.45, h * 0.92, 0.03), hzMat(), x + ox * t, y, z + oz * t, 0, ry, 0.55);
  }
}
// 螺栓一圈（軸沿 Y 的圓周上）
function boltRing(n, m, y, r, k, x = 0, z = 0, br = 0.045) {
  for (let i = 0; i < k; i++) {
    const a = (i / k) * PI * 2;
    P(n, gCyl(br, br, 0.06, 6), m, x + Math.cos(a) * r, y, z + Math.sin(a) * r);
  }
}
// 獨立網格的裝甲板（不併入 bake，AP 低時共用的受損處理讓它脫落）
function looseBox(n, m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(gBox(w, h, d), m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  n.add(mesh);
  return mesh;
}
function sub(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
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

// ---------- 燃料洩漏車（舊宇宙港）：六輪底盤、駕駛室、圓筒油罐、車尾的噴灑桿（高約 2.9 m、長約 6 m）----------
function buildFueler(pal, scale) {
  const { M, root, torso } = base(pal);
  const cab = sub(torso),
    tank = sub(torso),
    chassis = sub(torso);
  const gl = glow(0xffb040, 1.2);
  // 底盤：縱樑、橫樑、三軸六輪、擋泥板
  for (const s of [-1, 1]) {
    P(chassis, gBox(0.18, 0.22, 5.6), M.joint, s * 0.55, 0.78, 0.1);
    P(chassis, gBox(0.08, 0.3, 1.0), M.sub, s * 1.18, 0.62, 0.6); // 側邊的油泵箱
    stripes(chassis, M, s * 1.23, 0.62, 0.6, 0.9, 0.12, s * HP);
  }
  for (const z of [-1.9, 0.3, 1.5]) {
    P(chassis, gBox(1.3, 0.14, 0.14), M.joint, 0, 0.8, z);
    for (const s of [-1, 1]) {
      wheel(chassis, M, s * 1.0, 0.55, z, 0.55, 0.42);
      top(
        chassis,
        M.main2,
        [
          [s * 0.75, z - 0.7],
          [s * 1.25, z - 0.7],
          [s * 1.25, z + 0.7],
          [s * 0.75, z + 0.7],
        ],
        0.06,
        1.18,
      );
    }
  }
  // 駕駛室：前面收斜的艙＋擋風玻璃（發光）＋保險桿＋大燈＋後照鏡
  P(
    cab,
    gPod([
      [-3.0, 2.3, 0.75, 1.9, 0.2, 0.06],
      [-2.75, 2.4, 0.72, 2.45, 0.28, 0.06],
      [-1.75, 2.4, 0.72, 2.55, 0.25, 0.06],
    ]),
    M.main,
  );
  front(cab, M.sub, crect(2.0, 0.55, 0.1), 0.06, -2.88, 0.01, 1, 1, 0, 2.05, -0.35);
  P(cab, gBox(1.8, 0.42, 0.04), glow(0x7fc8ff, 0.5), 0, 2.08, -2.94, -0.35);
  P(cab, gBox(2.5, 0.28, 0.24), M.joint, 0, 0.82, -3.1);
  for (const s of [-1, 1]) {
    P(cab, gBox(0.36, 0.18, 0.06), gl, s * 0.85, 1.25, -3.02);
    rod(cab, M.joint, [s * 1.2, 2.0, -2.7], [s * 1.45, 2.05, -2.75], 0.025, 4);
    P(cab, gBox(0.06, 0.3, 0.18), M.sub, s * 1.48, 1.95, -2.75);
    slats(cab, M.joint, s * 1.21, 1.6, -2.2, 0.5, 4, 0.1, s * HP); // 側面的進氣縫
  }
  P(cab, gBox(2.3, 0.05, 0.08), M.joint, 0, 1.0, -3.08);
  decal(cab, 1, 0.9, 0.45, 0, 1.55, -3.02, 0, PI, 0);
  // 車頂：機槍座（hand）與旋轉的警示燈
  P(cab, gCyl(0.28, 0.32, 0.18, 8), M.joint, -0.55, 2.62, -2.2);
  P(cab, gBox(0.3, 0.24, 0.5), M.sub, -0.55, 2.82, -2.3);
  P(cab, gCyl(0.05, 0.06, 0.8, 6), M.gun, -0.55, 2.84, -2.85, HP);
  const beacon = sub(cab, 0.5, 2.62, -2.2);
  P(beacon, gCyl(0.16, 0.18, 0.08, 8), M.joint, 0, 0, 0);
  P(beacon, gCyl(0.12, 0.12, 0.22, 8), glow(0xff8a20, 1.6), 0, 0.15, 0);
  P(beacon, gBox(0.04, 0.2, 0.26), M.joint, 0, 0.15, 0); // 遮光板（轉動時一閃一閃）
  // 油罐：圓筒＋兩端的蓋＋加固環＋上方的人孔與走道欄杆
  P(tank, gCyl(1.0, 1.0, 3.6, 14), M.main, 0, 1.9, 0.35, HP);
  for (const z of [-1.45, 2.15]) P(tank, gSph(1.0, 14), M.main, 0, 1.9, z, 0, 0, 0, 1, 1, 0.22);
  for (const z of [-1.2, -0.2, 0.9, 1.9]) P(tank, gCyl(1.04, 1.04, 0.1, 14), M.main2, 0, 1.9, z, HP);
  for (const z of [-0.7, 0.45, 1.5]) {
    P(tank, gCyl(0.22, 0.24, 0.14, 10), M.joint, 0, 2.93, z);
    P(tank, gCyl(0.18, 0.18, 0.05, 10), M.sub, 0, 3.01, z);
  }
  P(tank, gBox(0.7, 0.04, 3.2), M.joint, 0, 2.86, 0.4);
  for (const s of [-1, 1]) {
    for (const z of [-1.0, 0.0, 1.0, 1.9])
      rod(tank, M.joint, [s * 0.36, 2.88, z], [s * 0.36, 3.25, z], 0.02, 4);
    rod(tank, M.joint, [s * 0.36, 3.25, -1.0], [s * 0.36, 3.25, 1.9], 0.02, 4);
    // 側面的管線與閥門
    kitCable(
      tank,
      M,
      [
        [s * 1.0, 1.2, -1.2],
        [s * 1.05, 1.15, 0.4],
        [s * 1.0, 1.15, 2.0],
      ],
      0.05,
    );
    for (const z of [-0.6, 1.2]) {
      P(tank, gCyl(0.08, 0.08, 0.16, 6), M.gun, s * 1.08, 1.16, z, 0, 0, HP);
      P(tank, gCyl(0.12, 0.12, 0.03, 6), M.acc, s * 1.18, 1.16, z, 0, 0, HP);
    }
    stripes(tank, M, s * 1.01, 1.9, 0.35, 2.6, 0.18, s * HP);
    decal(tank, 3, 1.2, 0.5, s * 1.02, 2.35, -0.2, 0, s * HP, 0);
  }
  // 後方的梯子
  for (const s of [-1, 1]) rod(tank, M.joint, [s * 0.25, 1.1, 2.4], [s * 0.25, 2.9, 2.25], 0.02, 4);
  for (let i = 0; i < 5; i++)
    rod(
      tank,
      M.joint,
      [-0.25, 1.3 + i * 0.35, 2.38 - i * 0.03],
      [0.25, 1.3 + i * 0.35, 2.38 - i * 0.03],
      0.015,
      4,
    );
  // 噴灑桿（車尾）：鉸鏈、橫桿、5 個噴嘴（預警時發光）、往油罐的軟管
  const boom = sub(torso, 0, 1.05, 2.55);
  const noz = glow(0xffa030, 0.15);
  P(boom, gCyl(0.1, 0.1, 2.0, 8), M.joint, 0, 0, 0, 0, 0, HP);
  P(boom, gBox(2.6, 0.14, 0.18), M.sub, 0, -0.05, 0.35);
  for (let i = 0; i < 5; i++) {
    const x = -1.1 + i * 0.55;
    P(boom, gCyl(0.05, 0.09, 0.2, 6), M.gun, x, -0.2, 0.38);
    P(boom, gSph(0.07, 6), noz, x, -0.32, 0.38);
  }
  for (const s of [-1, 1]) beam(boom, M.main2, [s * 0.9, 0, 0], [s * 1.2, -0.05, 0.35], 0.12, 0.12);
  piston(torso, M, [0.6, 1.6, 2.2], [0.6, 1.05, 2.85], 0.04);
  kitCable(
    torso,
    M,
    [
      [-0.3, 1.2, 2.2],
      [-0.35, 0.95, 2.55],
      [-0.2, 0.95, 2.9],
    ],
    0.05,
  );
  // 漏油的滴落（待機時閃）
  const drip = sub(torso, 0.7, 0.9, 1.9);
  P(drip, gSph(0.08, 6), glow(0x8a5a20, 0.6), 0, 0, 0, 0, 0, 0, 1, 1.6, 1);
  // 裝甲板（AP 低時脫落）
  const plates = [
    looseBox(tank, M.main3, 0.08, 0.9, 1.4, 1.06, 1.75, -0.6),
    looseBox(tank, M.main3, 0.08, 0.9, 1.4, -1.06, 1.75, 1.2),
    looseBox(cab, M.main3, 1.6, 0.06, 0.8, 0, 2.58, -2.6, 0.1),
  ];
  const hand = new THREE.Group();
  hand.position.set(-0.55, 2.84, -3.3);
  cab.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'fueler',
    height: 3.2 * scale,
    dmg: {
      smoke: [
        [0, 2.6, -2.3],
        [0.6, 2.0, 1.0],
        [-0.8, 1.2, 0.2],
      ],
      plates,
      chunks: [cab, tank, chassis, boom],
    },
    extra: { beacon, boom, noz, drip },
  });
}

// ---------- 誘導飛彈架（舊宇宙港）：八角的底座、四支外伸腳、旋轉台、2×2 的大型飛彈發射筒（高約 4.6 m，不移動）----------
function buildMissileRack(pal, scale) {
  const { M, root, torso } = base(pal);
  const pad = sub(torso),
    cabin = sub(torso);
  // 底座與外伸腳（腳掌、液壓桿）
  P(pad, gCyl(2.0, 2.2, 0.5, 8), M.joint, 0, 0.25, 0, 0, PI / 8);
  P(pad, gCyl(1.7, 1.7, 0.12, 8), M.sub, 0, 0.56, 0, 0, PI / 8);
  boltRing(pad, M.gun, 0.52, 1.85, 12);
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2,
      c = Math.cos(a),
      s = Math.sin(a);
    beam(pad, M.main2, [c * 1.6, 0.45, s * 1.6], [c * 2.9, 0.3, s * 2.9], 0.32, 0.26, 0.04);
    P(pad, gCyl(0.38, 0.45, 0.14, 8), M.joint, c * 3.0, 0.07, s * 3.0);
    piston(pad, M, [c * 1.5, 0.9, s * 1.5], [c * 2.6, 0.45, s * 2.6], 0.045);
  }
  for (let i = 0; i < 4; i++)
    stripes(
      pad,
      M,
      Math.sin((i * PI) / 2) * 2.02,
      0.3,
      Math.cos((i * PI) / 2) * 2.02,
      1.1,
      0.16,
      (i * PI) / 2 + PI,
    );
  // 旋轉台
  P(torso, gCyl(1.35, 1.45, 0.45, 12), M.main2, 0, 0.85, 0);
  P(torso, gCyl(1.0, 1.0, 0.3, 12), M.joint, 0, 1.2, 0);
  // 操作艙：側邊的箱＋窗（發光）＋天線
  P(
    cabin,
    gPod([
      [-0.9, 1.0, 1.1, 2.4, 0.18, 0.05],
      [-0.6, 1.1, 1.1, 2.6, 0.2, 0.05],
      [0.9, 1.1, 1.1, 2.6, 0.2, 0.05],
    ]),
    M.main,
    -1.55,
    0,
    0.2,
  );
  P(cabin, gBox(0.8, 0.32, 0.05), glow(0xffc060, 1.2), -1.55, 2.2, -0.73);
  slats(cabin, M.joint, -2.07, 2.2, 0.3, 0.9, 5, 0.1, -HP);
  decal(cabin, 2, 0.7, 0.35, -2.07, 1.6, 0.4, 0, -HP, 0);
  // 雷達（待機時轉）
  const radar = sub(cabin, -1.55, 2.6, 0.6);
  P(radar, gCyl(0.06, 0.06, 0.5, 6), M.joint, 0, 0.25, 0);
  P(radar, gBox(1.1, 0.32, 0.06), M.sub, 0, 0.55, 0, 0.25);
  P(radar, gBox(0.9, 0.04, 0.08), M.acc, 0, 0.7, 0.03, 0.25);
  // 發射筒組：俯仰軸（rack）、2×2 的筒、筒口環（預警時發光）、筒裡的彈頭
  P(torso, gBox(0.5, 1.2, 1.3), M.main2, 1.0, 1.85, 0.2);
  P(torso, gBox(0.5, 1.2, 1.3), M.main2, -0.55, 1.85, 0.2);
  P(torso, gCyl(0.24, 0.24, 2.0, 10), M.joint, 0.22, 2.3, 0.2, 0, 0, HP);
  const rack = sub(torso, 0.22, 2.3, 0.2);
  const ring = glow(0xff7030, 0.2);
  P(rack, gBox(1.95, 1.95, 3.4), M.main, 0, 0.35, -0.6);
  P(rack, gBox(2.05, 0.12, 3.5), M.main2, 0, 1.36, -0.6);
  for (const s of [-1, 1]) {
    P(rack, gBox(0.1, 1.8, 3.2), M.main2, s * 1.0, 0.35, -0.6);
    stripes(rack, M, s * 1.06, -0.4, -0.6, 2.8, 0.16, s * HP);
    for (const z of [-1.8, -0.6, 0.6]) P(rack, gBox(0.06, 1.95, 0.12), M.joint, s * 1.05, 0.35, z);
  }
  const tips = [];
  for (const [x, y] of [
    [-0.48, -0.12],
    [0.48, -0.12],
    [-0.48, 0.82],
    [0.48, 0.82],
  ]) {
    P(rack, gCyl(0.42, 0.42, 0.18, 12), M.joint, x, y, -2.33, HP);
    P(rack, gCyl(0.44, 0.44, 0.05, 12), ring, x, y, -2.43, HP);
    P(rack, gCyl(0.33, 0.33, 0.05, 12), M.sub, x, y, -2.26, HP);
    const tip = sub(rack, x, y, -2.3);
    P(tip, gCyl(0.02, 0.3, 0.6, 8), M.acc, 0, 0, 0, -HP);
    P(tip, gCyl(0.31, 0.31, 0.06, 8), M.main3, 0, 0, 0.3, HP);
    tips.push(tip);
  }
  // 後方的排焰板與彈藥補給管
  P(rack, gBox(1.9, 1.9, 0.12), M.gun, 0, 0.35, 1.15);
  kitCable(
    torso,
    M,
    [
      [-1.0, 1.2, 1.0],
      [-0.6, 1.9, 1.4],
      [0.0, 2.3, 1.2],
    ],
    0.07,
  );
  const plates = [
    looseBox(cabin, M.main3, 0.06, 0.9, 1.3, -2.1, 1.65, -0.1),
    looseBox(rack, M.main3, 1.6, 0.06, 1.4, 0, 1.45, -1.3),
  ];
  const hand = new THREE.Group();
  hand.position.set(0, 0.35, -2.7);
  rack.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'missilerack',
    height: 4.6 * scale,
    dmg: {
      smoke: [
        [0.2, 3.2, 0.6],
        [-1.6, 2.4, 0.2],
        [1.2, 1.0, -0.8],
      ],
      plates,
      chunks: [rack, cabin, pad],
    },
    extra: { rack, radar, tips, ring },
  });
}

// 無人機共用：導風管的旋翼（ducted fan），回傳轉的節點
function duct(n, M, x, y, z, r) {
  P(n, gCyl(r, r, 0.16, 12), M.main2, x, y, z);
  P(n, gCyl(r * 0.84, r * 0.84, 0.17, 12), M.joint, x, y, z);
  P(n, gCyl(0.06, 0.06, 0.12, 6), M.gun, x, y - 0.02, z);
  for (const a of [0, HP]) P(n, gBox(r * 1.7, 0.02, 0.03), M.joint, x, y - 0.06, z, 0, a);
  const rot = sub(n, x, y + 0.02, z);
  for (let i = 0; i < 3; i++) P(rot, gBox(r * 1.55, 0.015, 0.1), M.sub, 0, 0, 0, 0.18, (i * PI * 2) / 3);
  return rot;
}

// ---------- 拋網無人機（洋上都市）：楔形機身、四個導風管旋翼、腹下的拋網筒（四瓣筒口預警時張開）（飛行，高約 1.4 m）----------
function buildNetter(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.75;
  const hull = sub(torso),
    arms = sub(torso);
  P(
    hull,
    gPod([
      [-0.9, 0.5, -0.22, 0.18, 0.1, 0.08],
      [-0.55, 0.85, -0.3, 0.32, 0.18, 0.12],
      [0.45, 0.9, -0.3, 0.34, 0.2, 0.12],
      [0.8, 0.6, -0.2, 0.22, 0.12, 0.08],
    ]),
    M.main,
  );
  P(hull, gBox(0.6, 0.06, 0.9), M.main2, 0, 0.34, 0.0);
  eye(hull, M, glow(0x60e0ff, 2), 0, 0.02, -0.92, 0.07);
  for (const s of [-1, 1]) eye(hull, M, glow(0x60e0ff, 1.2), s * 0.2, -0.08, -0.8, 0.035);
  slats(hull, M.joint, 0, 0.3, 0.55, 0.4, 3, 0.07);
  decal(hull, 0, 0.32, 0.16, 0.46, 0.05, 0.1, 0, HP, 0);
  // 背上的網包（格子）
  P(hull, gBox(0.5, 0.2, 0.5), M.acc, 0, 0.45, 0.28);
  for (let i = 0; i < 4; i++) {
    P(hull, gBox(0.52, 0.03, 0.02), M.joint, 0, 0.56, 0.06 + i * 0.15);
    P(hull, gBox(0.02, 0.03, 0.52), M.joint, -0.22 + i * 0.15, 0.56, 0.28);
  }
  rod(hull, M.joint, [0.2, 0.32, 0.6], [0.28, 0.75, 0.75], 0.012, 4);
  // 旋翼臂與導風管
  const rotors = [];
  for (const [x, z] of [
    [-0.85, -0.5],
    [0.85, -0.5],
    [-0.85, 0.55],
    [0.85, 0.55],
  ]) {
    beam(arms, M.main2, [Math.sign(x) * 0.35, 0.05, z * 0.6], [x, 0.12, z], 0.1, 0.12);
    rotors.push(duct(arms, M, x, 0.12, z, 0.34));
  }
  // 拋網筒：筒身＋警示環＋四瓣筒口（launcher.petals 張開）
  const launcher = sub(torso, 0, -0.36, -0.15);
  P(launcher, gCyl(0.2, 0.22, 0.75, 10), M.gun, 0, 0, -0.1, HP);
  P(launcher, gCyl(0.23, 0.23, 0.12, 10), hzMat(), 0, 0, 0.12, HP);
  const petals = [];
  for (let i = 0; i < 4; i++) {
    const pv = sub(launcher, 0, 0, -0.48);
    pv.rotation.z = (i * PI) / 2;
    const leaf = sub(pv, 0, 0.17, 0);
    P(leaf, gBox(0.2, 0.04, 0.22), M.main2, 0, 0, -0.1);
    petals.push(leaf);
  }
  rod(torso, M.joint, [0, -0.15, -0.3], [0, -0.32, -0.3], 0.04, 6);
  const ring = glow(0xe0f8ff, 0.3);
  P(launcher, gCyl(0.24, 0.24, 0.03, 10), ring, 0, 0, -0.4, HP);
  // 細節：兩側的感測莢艙、腹下的滑橇、天線陣列、機身的螺栓與分模線
  for (const s of [-1, 1]) {
    P(hull, gCyl(0.09, 0.11, 0.36, 8), M.sub, s * 0.47, -0.05, -0.35, HP);
    eye(hull, M, glow(0x60e0ff, 1.4), s * 0.47, -0.05, -0.55, 0.04);
    beam(hull, M.joint, [s * 0.3, -0.3, -0.5], [s * 0.36, -0.55, -0.45], 0.04, 0.04);
    beam(hull, M.joint, [s * 0.3, -0.3, 0.45], [s * 0.36, -0.55, 0.4], 0.04, 0.04);
    rod(hull, M.joint, [s * 0.36, -0.57, -0.6], [s * 0.36, -0.57, 0.55], 0.03, 6);
    P(hull, gBox(0.02, 0.04, 1.2), M.joint, s * 0.44, 0.15, 0);
    for (const z of [-0.55, -0.2, 0.15, 0.5])
      P(hull, gCyl(0.025, 0.025, 0.03, 6), M.gun, s * 0.455, 0.22, z, 0, 0, HP);
    stripes(hull, M, s * 0.452, -0.18, 0.1, 0.5, 0.06, s * HP);
  }
  for (let i = 0; i < 3; i++)
    rod(hull, M.joint, [-0.15 + i * 0.15, 0.32, 0.7], [-0.15 + i * 0.15, 0.62 - i * 0.08, 0.78], 0.01, 4);
  // 旋翼的護環支柱
  for (const [x, z] of [
    [-0.85, -0.5],
    [0.85, -0.5],
    [-0.85, 0.55],
    [0.85, 0.55],
  ])
    for (let i = 0; i < 4; i++) {
      const a = (i * PI) / 2 + PI / 4;
      P(arms, gBox(0.05, 0.12, 0.05), M.joint, x + Math.cos(a) * 0.36, 0.12, z + Math.sin(a) * 0.36);
    }
  const plates = [looseBox(hull, M.main3, 0.6, 0.05, 0.5, 0, 0.36, -0.45, 0.12)];
  const hand = new THREE.Group();
  hand.position.set(0, -0.36, -0.7);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'netter',
    height: 1.4 * scale,
    dmg: {
      smoke: [
        [0, 0.9, 0.3],
        [0.85, 0.9, 0.55],
      ],
      plates,
      chunks: [hull, arms, launcher],
    },
    extra: { rotors, petals, launcher, ring },
  });
}

// 迴旋刃：三片彎刃＋中央的轂（刃緣發光）。boomer 的背上掛一片；丟出時另外建一片放進場景（entities/mech-foe-c2.js）
export function buildBoomerBlade(edgeColor = 0x60e0ff) {
  const g = new THREE.Group();
  const M = {
    hub: new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      metalness: 0.8,
      roughness: 0.35,
      flatShading: true,
    }),
    blade: new THREE.MeshStandardMaterial({
      color: 0xc8d0d8,
      metalness: 0.9,
      roughness: 0.25,
      flatShading: true,
    }),
    edge: glow(edgeColor, 1.8),
  };
  P(g, gCyl(0.2, 0.2, 0.12, 10), M.hub, 0, 0, 0);
  P(g, gCyl(0.1, 0.1, 0.16, 8), M.edge, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i * PI * 2) / 3;
    const arm = sub(g);
    arm.rotation.y = a;
    // 彎刃：兩段的薄板（往外漸窄、往後彎）＋刃緣
    P(arm, gBox(0.62, 0.04, 0.2), M.blade, 0.45, 0, 0);
    P(arm, gBox(0.5, 0.035, 0.15), M.blade, 0.92, 0, 0.12, 0, -0.45);
    P(arm, gBox(0.62, 0.02, 0.03), M.edge, 0.45, 0, -0.11);
    P(arm, gBox(0.5, 0.02, 0.03), M.edge, 0.9, 0, 0.04, 0, -0.45);
  }
  bakeAll(g);
  return g;
}

// ---------- 迴旋刃無人機（洋上都市）：扁平的機身、三支旋翼臂、背上的刃架（掛著迴旋刃）（飛行，高約 1.3 m）----------
function buildBoomer(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 0.7;
  const hull = sub(torso),
    arms = sub(torso);
  P(hull, gCyl(0.62, 0.5, 0.36, 10), M.main, 0, 0, 0);
  P(hull, gCyl(0.66, 0.66, 0.08, 10), M.main2, 0, 0.12, 0);
  P(hull, gCyl(0.4, 0.3, 0.2, 10), M.sub, 0, -0.27, 0);
  boltRing(hull, M.joint, 0.17, 0.55, 10, 0, 0, 0.03);
  // 正面的感測器帶（發光）、腹下的穩定鰭
  P(hull, gBox(0.5, 0.08, 0.06), glow(0x60e0ff, 1.8), 0, 0.0, -0.58);
  eye(hull, M, glow(0x60e0ff, 2), 0, -0.25, -0.38, 0.05);
  for (const s of [-1, 1])
    side(
      hull,
      M.main2,
      [
        [-0.2, -0.3],
        [0.3, -0.3],
        [0.45, -0.62],
        [0.15, -0.62],
      ],
      0.04,
      s * 0.18,
      0.01,
    );
  decal(hull, 0, 0.3, 0.15, 0.6, 0.0, 0.15, 0, HP, 0);
  // 三支旋翼臂（前左、前右、後）
  const rotors = [];
  for (const a of [-PI / 6 - HP, PI / 6 - HP + PI, HP]) {
    const x = Math.cos(a) * 1.0,
      z = Math.sin(a) * 1.0;
    beam(arms, M.main2, [Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5], [x, 0.08, z], 0.12, 0.1);
    P(arms, gCyl(0.08, 0.1, 0.18, 8), M.joint, x, 0.08, z);
    const rot = sub(arms, x, 0.2, z);
    for (let i = 0; i < 2; i++) P(rot, gBox(0.7, 0.015, 0.09), M.sub, 0, 0, 0, 0.15, i * HP);
    rotors.push(rot);
    stripes(arms, M, Math.cos(a) * 0.75, 0.065, Math.sin(a) * 0.75, 0.3, 0.06, -a);
  }
  // 背上的刃架：兩支夾臂＋迴轉軸（掛著的刃在 cradle 下面轉）
  for (const s of [-1, 1]) {
    beam(hull, M.joint, [s * 0.32, 0.16, 0.0], [s * 0.2, 0.42, 0.0], 0.06, 0.08);
    P(hull, gBox(0.12, 0.06, 0.18), M.sub, s * 0.2, 0.45, 0);
  }
  P(hull, gCyl(0.07, 0.07, 0.3, 6), M.joint, 0, 0.3, 0);
  const blade = buildBoomerBlade();
  blade.position.set(0, 0.48, 0);
  blade.scale.setScalar(0.85);
  torso.add(blade);
  const bladeGlow = blade.children.find(
    (m) => m.material && m.material.emissive && m.material.emissiveIntensity > 1,
  );
  // 細節：馬達的散熱片、旋翼臂下的位置燈與腳、腹下的攝影機轉塔、側緣的進氣柵、天線
  for (const a of [-PI / 6 - HP, PI / 6 - HP + PI, HP]) {
    const x = Math.cos(a) * 1.0,
      z = Math.sin(a) * 1.0;
    for (let i = 0; i < 3; i++) P(arms, gCyl(0.13, 0.13, 0.025, 8), M.sub, x, 0.02 + i * 0.05, z);
    P(arms, gSph(0.04, 6), glow(a === HP ? 0xff4040 : 0x60ff90, 2), x, -0.04, z);
    rod(arms, M.joint, [x, 0.0, z], [x, -0.22, z], 0.025, 6);
    P(arms, gBox(0.12, 0.03, 0.12), M.joint, x, -0.23, z);
  }
  const cam = sub(hull, 0, -0.42, -0.12);
  P(cam, gSph(0.12, 8), M.sub, 0, 0, 0);
  eye(cam, M, glow(0x60e0ff, 1.8), 0, -0.02, -0.12, 0.04);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    P(hull, gBox(0.06, 0.16, 0.03), M.joint, Math.cos(a) * 0.58, -0.08, Math.sin(a) * 0.58, 0, -a + HP);
  }
  rod(hull, M.joint, [-0.3, 0.16, 0.35], [-0.38, 0.55, 0.42], 0.012, 4);
  rod(hull, M.joint, [0.3, 0.16, 0.35], [0.36, 0.45, 0.42], 0.012, 4);
  const plates = [looseBox(hull, M.main3, 0.5, 0.04, 0.4, 0, 0.18, -0.25, 0.08)];
  const hand = new THREE.Group();
  hand.position.set(0, 0.48, -0.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'boomer',
    height: 1.3 * scale,
    dmg: {
      smoke: [
        [0, 0.8, 0.2],
        [0.8, 0.75, -0.4],
      ],
      plates,
      chunks: [hull, arms],
    },
    extra: { rotors, blade, bladeGlow: bladeGlow ? bladeGlow.material : null },
  });
}

// ---------- 反射鏡衛星（高空軌道）：六角的本體、正面六片鏡瓣圍成的聚光盤、中央的發射器、兩片太陽能板（飛行，高約 2.4 m）----------
function buildMirror(pal, scale) {
  const { M, root, torso } = base(pal);
  torso.position.y = 1.45;
  const bus = sub(torso),
    wings = sub(torso);
  P(bus, gCyl(0.6, 0.6, 1.3, 6), M.main, 0, 0, 0.3, HP, 0, 0);
  for (const z of [-0.3, 0.9]) P(bus, gCyl(0.64, 0.64, 0.1, 6), M.main2, 0, 0, z, HP);
  // 隔熱層（金色）面板、推進器、天線
  for (let i = 0; i < 6; i += 2) {
    const a = (i / 6) * PI * 2 + PI / 6;
    PB(
      bus,
      gBox(0.5, 0.04, 0.9),
      M.main2,
      [Math.cos(a) * 0.53, Math.sin(a) * 0.53, 0.3],
      [0, 0, 1],
      [Math.cos(a), Math.sin(a), 0],
    );
  }
  for (const [x, y] of [
    [0.5, 0.5],
    [-0.5, 0.5],
    [0.5, -0.5],
    [-0.5, -0.5],
  ]) {
    P(bus, gBox(0.16, 0.16, 0.16), M.sub, x, y, 0.95);
    P(bus, gCyl(0.04, 0.07, 0.12, 6), M.gun, x, y, 1.08, HP);
  }
  P(bus, gCyl(0.05, 0.05, 0.6, 6), M.joint, 0, 0.6, 0.6);
  P(bus, gCyl(0.28, 0.05, 0.1, 10), M.sub, 0, 0.92, 0.6);
  slats(bus, M.joint, 0, 0.1, 0.96, 0.4, 3, 0.08, PI);
  // 太陽能板：鉸鏈臂＋框＋格子
  for (const s of [-1, 1]) {
    rod(wings, M.joint, [s * 0.55, 0, 0.5], [s * 0.95, 0, 0.5], 0.05, 6);
    P(wings, gBox(0.12, 0.2, 0.2), M.sub, s * 0.95, 0, 0.5);
    P(wings, gBox(1.9, 0.05, 0.8), M.acc, s * 1.98, 0, 0.5);
    for (let i = 0; i < 4; i++) P(wings, gBox(0.03, 0.07, 0.82), M.joint, s * (1.05 + i * 0.6), 0, 0.5);
    P(wings, gBox(1.9, 0.07, 0.03), M.joint, s * 1.98, 0, 0.5);
  }
  // 聚光盤：環形框＋六片鏡瓣（petals：各自的鉸鏈，預警時往內收）＋中央發射器
  P(torso, gCyl(1.0, 1.0, 0.1, 12), M.joint, 0, 0, -0.42, HP);
  P(torso, gCyl(0.3, 0.36, 0.3, 8), M.sub, 0, 0, -0.5, HP);
  const ringG = sub(torso, 0, 0, -0.45);
  const mm = mirrorMat();
  const petals = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * PI * 2) / 6;
    const hinge = sub(ringG, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 0);
    hinge.rotation.z = a - HP;
    const leaf = sub(hinge);
    // 鏡面：六角形的板＋背面的框
    P(leaf, gCyl(0.42, 0.42, 0.04, 6), mm, 0, 0.5, -0.02, HP);
    P(leaf, gCyl(0.44, 0.44, 0.03, 6), M.joint, 0, 0.5, 0.03, HP);
    P(leaf, gBox(0.05, 0.5, 0.05), M.sub, 0, 0.22, 0.05);
    petals.push(leaf);
  }
  const core = glow(0xfff0a0, 0.6);
  P(torso, gSph(0.2, 10), core, 0, 0, -0.7);
  for (let i = 0; i < 3; i++) {
    const a = (i * PI * 2) / 3 + HP;
    rod(
      torso,
      M.joint,
      [Math.cos(a) * 0.3, Math.sin(a) * 0.3, -0.5],
      [Math.cos(a) * 0.1, Math.sin(a) * 0.1, -0.75],
      0.02,
      4,
    );
  }
  // 細節：星象儀、反應輪的罩、本體的螺栓、鏡瓣背面的肋、聚光盤的警示環
  for (const s of [-1, 1]) {
    P(bus, gCyl(0.12, 0.14, 0.24, 8), M.sub, s * 0.3, -0.55, 0.7, 0.4);
    P(bus, gCyl(0.08, 0.08, 0.03, 8), glow(0x9fe8ff, 1.2), s * 0.3, -0.64, 0.6, 0.4);
    P(bus, gCyl(0.2, 0.2, 0.12, 10), M.joint, s * 0.3, 0.58, 0.05);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    for (const z of [-0.2, 0.8])
      P(bus, gCyl(0.03, 0.03, 0.04, 6), M.gun, Math.cos(a) * 0.62, Math.sin(a) * 0.62, z, HP);
  }
  for (const leaf of petals) {
    for (const x of [-0.18, 0.18]) P(leaf, gBox(0.03, 0.6, 0.04), M.joint, x, 0.5, 0.06);
    P(leaf, gBox(0.5, 0.03, 0.04), M.joint, 0, 0.5, 0.06);
  }
  stripes(torso, M, 0, -1.02, -0.42, 0.8, 0.06);
  const plates = [
    looseBox(bus, M.main3, 0.05, 0.6, 0.8, 0.62, 0, 0.3),
    looseBox(bus, M.main3, 0.05, 0.6, 0.8, -0.62, 0, 0.3),
  ];
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.85);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'mirror',
    height: 2.8 * scale,
    dmg: {
      smoke: [
        [0, 1.2, 0.5],
        [1.5, 1.2, 0.5],
      ],
      plates,
      chunks: [bus, wings, ringG],
    },
    extra: { petals, ringG, core, mirror: mm },
  });
}

// ---------- 聚光鏡陣列（高空軌道）：六角的基座、立柱與俯仰架、拋物面的鏡片陣列、三支撐桿上的收光器（高約 5.5 m，不移動）----------
function buildFocus(pal, scale) {
  const { M, root, torso } = base(pal);
  const pad = sub(torso);
  // 基座：六角台＋階梯＋散熱片＋警示條＋導管
  P(pad, gCyl(2.3, 2.5, 0.6, 6), M.joint, 0, 0.3, 0);
  P(pad, gCyl(1.9, 1.9, 0.12, 6), M.sub, 0, 0.66, 0);
  boltRing(pad, M.gun, 0.62, 2.15, 12);
  for (let i = 0; i < 3; i++) P(pad, gBox(1.0, 0.2, 0.4), M.main2, 0, 0.1 + i * 0.2, 2.45 - i * 0.3);
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3 + PI / 6;
    stripes(pad, M, Math.cos(a) * 2.18, 0.3, Math.sin(a) * 2.18, 1.6, 0.16, -a + HP);
  }
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) P(pad, gBox(0.06, 0.6, 0.8), M.sub, s * (1.1 + i * 0.12), 1.0, 0.9);
    kitCable(
      pad,
      M,
      [
        [s * 0.5, 0.7, 1.4],
        [s * 0.9, 0.75, 0.9],
        [s * 0.6, 1.4, 0.4],
      ],
      0.06,
    );
  }
  // 立柱與俯仰軸
  P(torso, gCyl(0.55, 0.75, 1.8, 10), M.main, 0, 1.6, 0);
  P(torso, gCyl(0.8, 0.8, 0.2, 10), M.main2, 0, 2.5, 0);
  for (const s of [-1, 1]) CB0box(torso, M, s * 0.75, 3.0, 0);
  P(torso, gCyl(0.22, 0.22, 1.8, 10), M.joint, 0, 3.2, 0, 0, 0, HP);
  // 俯仰架（gimbal）：鏡片陣列與收光器都在裡面
  const gimbal = sub(torso, 0, 3.2, 0);
  const mm = mirrorMat();
  P(gimbal, gCyl(1.9, 1.9, 0.14, 12), M.joint, 0, 0, 0.15, HP);
  P(gimbal, gCyl(0.5, 0.6, 0.5, 10), M.main2, 0, 0, 0.45, HP);
  // 鏡片：中央六片＋外圈十二片，往內斜（拋物面）
  const petals = [];
  const tile = (r, a, tilt, R) => {
    const t = sub(gimbal, Math.cos(a) * r, Math.sin(a) * r, 0);
    t.rotation.z = a - HP;
    const leaf = sub(t);
    leaf.rotation.x = -tilt;
    P(leaf, gCyl(R, R, 0.05, 6), mm, 0, 0, -0.05, HP);
    P(leaf, gCyl(R * 1.05, R * 1.05, 0.04, 6), M.sub, 0, 0, 0.0, HP);
    petals.push(leaf);
  };
  for (let i = 0; i < 6; i++) tile(0.7, (i * PI) / 3, 0.18, 0.34);
  for (let i = 0; i < 12; i++) tile(1.45, (i * PI) / 6 + PI / 12, 0.35, 0.36);
  // 收光器：三支撐桿＋筒＋透鏡（lens 的顏色隨光束強度黃 → 紅）
  for (let i = 0; i < 3; i++) {
    const a = (i * PI * 2) / 3 + HP;
    rod(
      gimbal,
      M.joint,
      [Math.cos(a) * 1.7, Math.sin(a) * 1.7, -0.05],
      [Math.cos(a) * 0.25, Math.sin(a) * 0.25, -2.2],
      0.04,
      6,
    );
  }
  P(gimbal, gCyl(0.3, 0.26, 0.5, 10), M.sub, 0, 0, -2.3, HP);
  P(gimbal, gCyl(0.32, 0.32, 0.06, 10), hzMat(), 0, 0, -2.1, HP);
  const lens = glow(0xfff080, 0.5);
  P(gimbal, gSph(0.24, 10), lens, 0, 0, -2.58);
  const plates = [
    looseBox(torso, M.main3, 0.08, 1.0, 0.8, 0.62, 1.6, 0, 0, 0, -0.1),
    looseBox(torso, M.main3, 0.08, 1.0, 0.8, -0.62, 1.6, 0, 0, 0, 0.1),
  ];
  const hand = new THREE.Group();
  hand.position.set(0, 0, -2.6);
  gimbal.add(hand);
  finish(root, scale);
  return rig(root, torso, M, {
    hand,
    type: 'focus',
    height: 5.2 * scale,
    dmg: {
      smoke: [
        [0, 2.4, 0.6],
        [1.2, 1.0, 0.9],
        [-0.6, 3.3, 0.2],
      ],
      plates,
      chunks: [gimbal, pad],
    },
    extra: { gimbal, petals, lens, mirror: mm },
  });
}
// 俯仰軸的軸承座
function CB0box(n, M, x, y, z) {
  P(n, gBox(0.3, 1.1, 0.7), M.main2, x, y, z);
  P(n, gCyl(0.3, 0.3, 0.34, 10), M.joint, x, y + 0.2, z, 0, 0, HP);
}

export const FOE_BUILDERS_C2 = {
  fueler: buildFueler,
  missilerack: buildMissileRack,
  netter: buildNetter,
  boomer: buildBoomer,
  mirror: buildMirror,
  focus: buildFocus,
};
// 模型庫登記：[key, 名稱, 備註]
export const FOE_CATALOG_C2 = [
  ['fueler', '燃料洩漏車', '舊宇宙港專屬；灑燃料後點火成燃燒地面，擊破時整片燒起來'],
  ['missilerack', '誘導飛彈架', '舊宇宙港專屬；慢速的大型追蹤飛彈，可以擊落或用障礙物甩掉'],
  ['netter', '拋網無人機', '洋上都市專屬；預警後射出捕獲網（減速、不能跳）'],
  ['boomer', '迴旋刃無人機', '洋上都市專屬；丟出會飛回來的迴旋刃'],
  ['mirror', '反射鏡衛星', '高空軌道專屬；雷射只有 30% 效果，聚光射出光束'],
  ['focus', '聚光鏡陣列', '高空軌道專屬；追蹤光束照越久越痛，掩體能切斷'],
];
