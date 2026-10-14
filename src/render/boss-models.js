// 新 Boss 與附屬部位的程式模型（鑽地蟲、多足要塞、空中要塞、砲兵指揮所；砲台、懸吊砲塔、引擎、護盾發生器、腳部關節）
// 介面和載具模型相同（vehicle: true，animateMech 只處理閃光與噴嘴），另外：
//   mounts：附屬部位掛載的節點（部位實體每格移到這個節點的世界位置）
//   body：多足要塞的機身群組（倒下時降低）、legNodes：多足要塞的 6 條腿
// 這些模型目前不接受 GLB（模型庫只預覽）。
// 造型：主體用 gPod／gPlate／gLoft 做出楔形、斜面與分層（深色骨架＋外裝甲板＋細節），
// 會動的節點（mounts、hand、back、rotor、fins、jaws…）的名稱、位置與層級和遊戲端的判定一致，不可移動。
import {
  CB,
  P,
  bakeAll,
  decal,
  gBox,
  gCyl,
  gLoft,
  gPlate,
  gPod,
  gSph,
  mergeGeos,
  sideProfile,
} from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';
import { FOE_BUILDERS } from './foe-models.js';

const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

// ---------- 區域造型工具 ----------
const HP = Math.PI / 2;
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const RX = (a) => new THREE.Matrix4().makeRotationX(a);
const RY = (a) => new THREE.Matrix4().makeRotationY(a);
const RZ = (a) => new THREE.Matrix4().makeRotationZ(a);
// 放樣沿 Y：環的 [x, y] → 世界 (x, −y)、環的 z → 世界 y
const UP = () => RX(-HP);
// XY 輪廓平放：輪廓的 [x, y] → 世界 (x, z)、擠出方向 → 世界 −y
const FLAT = () => RX(HP);
// 矩陣串列相乘（左到右）
function mx(...ms) {
  const mm = new THREE.Matrix4();
  for (const x of ms) mm.multiply(x);
  return mm;
}
// 以矩陣串列擺放（左到右相乘）
function PM(node, geo, m, ...ms) {
  const mm = new THREE.Matrix4();
  for (const x of ms) mm.multiply(x);
  if (!node.userData.prims) node.userData.prims = [];
  node.userData.prims.push({ geo, m, mm });
}
// 讓區域的 −Z（正面）朝向水平方向 (dx, dz) 的繞 Y 角度
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
const rect = (w, h, x = 0, y = 0) => [
  [x - w / 2, y - h / 2],
  [x + w / 2, y - h / 2],
  [x + w / 2, y + h / 2],
  [x - w / 2, y + h / 2],
];
// 四角切掉 c 的矩形（八角）
const cutRect = (w, h, c, x = 0, y = 0) => [
  [x - w / 2 + c, y - h / 2],
  [x + w / 2 - c, y - h / 2],
  [x + w / 2, y - h / 2 + c],
  [x + w / 2, y + h / 2 - c],
  [x + w / 2 - c, y + h / 2],
  [x - w / 2 + c, y + h / 2],
  [x - w / 2, y + h / 2 - c],
  [x - w / 2, y - h / 2 + c],
];
const ngon = (n, r, rot = 0) =>
  Array.from({ length: n }, (_, i) => [
    Math.cos(rot + (i / n) * Math.PI * 2) * r,
    Math.sin(rot + (i / n) * Math.PI * 2) * r,
  ]);
// 切角的正多邊形：每個角切成兩點（t＝切掉邊長的比例）
function chamferNgon(n, R, t, rot = 0) {
  const C = ngon(n, R, rot);
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = C[i],
      p = C[(i + n - 1) % n],
      q = C[(i + 1) % n];
    out.push([c[0] + (p[0] - c[0]) * t, c[1] + (p[1] - c[1]) * t]);
    out.push([c[0] + (q[0] - c[0]) * t, c[1] + (q[1] - c[1]) * t]);
  }
  return out;
}
// 沿 Y 放樣（levels＝[[y, 輪廓]…]），擺在 (x, 0, z)
function loftY(node, m, levels, x = 0, z = 0) {
  PM(node, gLoft(levels.map(([y, pts]) => ({ z: y, pts }))), m, T(x, 0, z), UP());
}
// 側面輪廓 [[z, y]…] 沿 X 擠出 d，中心在 x
function sidePlate(node, m, zy, d, c, x = 0, sf = 1, sb = 1) {
  P(node, gPlate(sideProfile(zy), d, c, sf, sb), m, x, 0, 0, 0, HP, 0);
}
// 兩點間的圓柱
function rod(node, m, a, b, r, s = 6) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  const mm = new THREE.Matrix4().compose(
    new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2),
    q,
    new THREE.Vector3(1, 1, 1),
  );
  PM(node, gCyl(r, r, L, s), m, mm);
}
// 液壓桿：細的活塞桿＋粗的缸筒＋兩端的關節
function piston(node, M, a, b, r) {
  const k = 0.5;
  const mid = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  rod(node, M.joint, a, b, r, 6);
  rod(node, M.sub, a, mid, r * 1.7, 8);
  PM(node, gSph(r * 2, 6), M.joint, T(...a));
  PM(node, gSph(r * 1.8, 6), M.joint, T(...b));
}
// 以下的細節都畫在區域的 XY 平面、朝 −Z（B＝擺放矩陣）
// 散熱格柵：深色底板＋橫向葉片（平貼，凸出很少）
function louver(node, M, B, w, h, n, k = 1) {
  PM(node, gBox(w, h, 0.06 * k), M.joint, B);
  for (let i = 0; i < n; i++)
    PM(
      node,
      gBox(w - 0.1 * k, (h / n) * 0.5, 0.05 * k),
      M.sub,
      B,
      T(0, -h / 2 + ((i + 0.5) * h) / n, -0.05 * k),
    );
}
// 警示條紋：黃色底＋深色斜紋
function stripes(node, M, B, w, h, n) {
  PM(node, gBox(w, h, 0.05), M.acc, B);
  const sw = w / (2 * n),
    sk = Math.min(h * 0.5, sw);
  for (let i = 0; i < n; i++) {
    const x0 = -w / 2 + (i * (w - sk)) / n + sw * 0.25;
    PM(
      node,
      gPlate(
        [
          [x0, -h / 2],
          [x0 + sw, -h / 2],
          [x0 + sw + sk, h / 2],
          [x0 + sk, h / 2],
        ],
        0.03,
        0.005,
      ),
      M.joint,
      B,
      T(0, 0, -0.035),
    );
  }
}
// 螺栓：pts＝[[x, y]…]
function bolts(node, M, B, pts, r = 0.06) {
  for (const [x, y] of pts) PM(node, gCyl(r, r, r * 0.8, 6), M.joint, B, T(x, y, -r * 0.3), RX(HP));
}
// 感測器鏡頭：外殼＋鏡片（g＝中心的小發光點）
function lens(node, M, B, r, g) {
  PM(node, gCyl(r * 1.4, r * 1.55, r * 0.8, 10), M.sub, B, RX(HP));
  PM(node, gCyl(r, r, r * 0.3, 10), M.lens, B, T(0, 0, -r * 0.45), RX(HP));
  if (g) PM(node, gSph(r * 0.32, 6), g, B, T(0, 0, -r * 0.62));
}

// 共用的回傳結構
function rigOf(root, torso, M, o) {
  const hand = o.hand || new THREE.Group();
  const back = o.back || new THREE.Group();
  if (!hand.parent) torso.add(hand);
  if (!back.parent) torso.add(back);
  const arm = () => ({ hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() });
  return {
    group: root,
    legsG: o.legsG || new THREE.Group(),
    torso,
    head: torso,
    arms: { r: arm(), l: arm() },
    legs: [],
    nozzles: o.nozzles || [],
    hipY: 0,
    type: o.type,
    cls: o.cls || 'boss',
    vehicle: true,
    height: o.height,
    coreH: o.height * 0.5,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
    mounts: o.mounts || [],
    body: o.body || null,
    legNodes: o.legNodes || [],
    rotor: o.rotor || null,
    ...(o.extra || {}), // 各 Boss 自己會動的節點（mech-boss2.js 的 boss2Fx 使用）
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

// 圓周上的擺放：角度 a、半徑 r、z；區域 +Y 朝外、區域 Z 沿機體軸
const radial = (a, r, z) => [T(Math.cos(a) * r, Math.sin(a) * r, z), RZ(a - HP)];

// 鑽地蟲的頭（身體各節由 segments 另外建立，跟著頭的軌跡排列）：正面 −Z，原點在頭部底面
// 深色的骨架筒＋三節鱗片狀的裝甲環（板與板之間留縫）＋三片液壓驅動的顎、口部一圈鑽齒與發光的感測器
function buildWormHead(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.9;
  root.add(torso);
  P(torso, gCyl(1.64, 1.5, 4.3, 12), M.joint, 0, 0, 0.35, HP);
  // 裝甲環：每節 10 片，前緣往內收，後一節蓋住前一節的尾端
  const plate = gPlate(rect(1.0, 1.3), 0.2, 0.05, 1, [0.86, 0.9]);
  for (let k = 0; k < 3; k++)
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + (k % 2) * (Math.PI / 10);
      const r = 1.76 + k * 0.05;
      PM(torso, plate, k === 1 ? M.main3 : M.main, ...radial(a, r, -1.15 + k * 1.25), RX(-HP - 0.07));
    }
  // 節與節之間的肋環＋後端的連接環
  for (const z of [-0.5, 0.75]) P(torso, gCyl(1.96, 1.96, 0.26, 10), M.main2, 0, 0, z, HP);
  P(torso, gCyl(1.98, 1.98, 0.32, 10), M.main2, 0, 0, 2.2, HP);
  P(torso, gCyl(1.55, 1.75, 0.3, 12), M.sub, 0, 0, 2.36, HP);
  // 側面的感測器（顎與顎之間）＋後段的散熱格柵
  for (const a of [Math.PI / 6, (5 * Math.PI) / 6, -HP]) {
    lens(torso, M, mx(...radial(a, 1.93, -1.05), RX(HP)), 0.16);
    louver(torso, M, mx(...radial(a, 1.92, 1.5), RX(HP)), 0.6, 0.8, 4, 0.8);
  }
  // 顎：三片往前伸的爪（側面輪廓，切向擠出），內側有齒，兩側各一支液壓桿
  const claw = gPlate(
    sideProfile([
      [-1.2, 2.02],
      [-2.4, 1.92],
      [-3.4, 1.42],
      [-3.8, 0.88],
      [-3.35, 0.92],
      [-2.6, 1.18],
      [-1.4, 1.34],
    ]),
    0.44,
    0.07,
  );
  const tooth = gCyl(0.02, 0.14, 0.4, 4);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + HP;
    const at = (r, z, t = 0) => [Math.cos(a) * r - Math.sin(a) * t, Math.sin(a) * r + Math.cos(a) * t, z];
    PM(torso, claw, M.sub, RZ(a - HP), RY(HP));
    // 爪背的裝甲脊
    PM(
      torso,
      gPlate(
        sideProfile([
          [-1.3, 2.0],
          [-2.4, 1.9],
          [-3.1, 1.6],
          [-2.4, 1.78],
          [-1.4, 1.86],
        ]),
        0.56,
        0.05,
      ),
      M.acc,
      RZ(a - HP),
      RY(HP),
    );
    for (const [r, z] of [
      [1.22, -2.0],
      [1.08, -2.6],
      [0.98, -3.2],
    ])
      PM(torso, tooth, M.joint, T(...at(r, z)), RZ(a + HP));
    // 鉸鏈軸
    PM(torso, gCyl(0.34, 0.34, 0.8, 8), M.joint, T(...at(1.86, -1.35)), RZ(a));
    for (const t of [-0.34, 0.34]) piston(torso, M, at(1.95, -0.45, t), at(1.8, -2.2, t), 0.07);
  }
  // 口部：發光的感測器（弱點）＋框＋一圈鑽齒＋放射狀的肋
  P(torso, gSph(0.75, 10), glow(0xff7a20, 2.2), 0, 0, -1.75);
  P(torso, gCyl(1.1, 1.1, 0.2, 12), M.joint, 0, 0, -1.65, HP);
  P(torso, gCyl(0.92, 1.0, 0.28, 12), M.sub, 0, 0, -1.82, HP);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    PM(torso, tooth, M.gun, T(Math.cos(a) * 1.32, Math.sin(a) * 1.32, -1.95), RX(-HP));
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    PM(torso, gBox(0.14, 0.5, 0.12), M.main2, T(Math.cos(a) * 1.4, Math.sin(a) * 1.4, -1.84), RZ(a - HP));
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -2.4);
  const back = new THREE.Group();
  back.position.set(0, 1.6, 0.6);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'worm', height: 3.8 * scale });
}
// 鑽地蟲的身體節（由大到小）：深色骨架＋8 片裝甲板＋前端的肋環（幾何共用，各節只縮放）
export function buildWormSegments(pal, n) {
  const M = mechMats(pal);
  const out = [];
  const plate = gPlate(rect(0.66, 1.3), 0.14, 0.04, 1, [0.84, 0.9]);
  const plates = [],
    core = [],
    rib = [];
  const mat = (...ms) => {
    const mm = new THREE.Matrix4();
    for (const x of ms) mm.multiply(x);
    return mm;
  };
  core.push({ geo: gCyl(0.86, 0.86, 1.8, 12), mm: RX(HP) });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    plates.push({ geo: plate, mm: mat(...radial(a, 0.95, -0.1), RX(-HP - 0.06)) });
    // 板與板之間的導軌
    core.push({ geo: gBox(0.1, 0.12, 1.5), mm: mat(...radial(a + Math.PI / 8, 0.9, -0.1)) });
  }
  rib.push({ geo: gCyl(1.06, 1.06, 0.26, 12), mm: mat(T(0, 0, 0.75), RX(HP)) });
  rib.push({ geo: gBox(0.22, 0.2, 1.3), mm: mat(T(0, 1.0, -0.1)) }); // 背脊
  const gPlates = mergeGeos(plates),
    gCore = mergeGeos(core),
    gRib = mergeGeos(rib);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    g.add(
      new THREE.Mesh(gCore, M.joint),
      new THREE.Mesh(gPlates, i % 2 ? M.main : M.main3),
      new THREE.Mesh(gRib, M.main2),
    );
    const s = 1.8 * (1 - (i / n) * 0.55);
    g.scale.set(s, s, 1.25);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    out.push(g);
  }
  return { list: out, mats: [M.main, M.main2, M.main3] };
}

// 多足要塞：六條腿撐起扁平機身，機身底部是發光核心（弱點），腿的膝關節是附屬部位
// 機身＝切角六角的放樣船殼＋外側的傾斜裝甲裙板＋上層甲板與指揮塔、前方楔形的感測頭、髖關節座；
// 腿＝深色骨樑＋上方的裝甲殼與冠板、下方的液壓桿，小腿是帶脛甲的刃形支柱
function buildSpider(pal, scale) {
  const M = mechMats(pal);
  const red = glow(0xff3a2a, 1.4);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Group();
  torso.position.y = 7.2;
  body.add(torso);
  const hex = (R, t) => chamferNgon(6, R, t, Math.PI / 6);
  // 下層船殼
  loftY(torso, M.main, [
    [-0.9, hex(4.0, 0.2)],
    [-0.45, hex(5.0, 0.18)],
    [0.45, hex(5.2, 0.18)],
    [0.8, hex(4.75, 0.18)],
  ]);
  // 上層甲板
  loftY(torso, M.main2, [
    [0.8, hex(4.3, 0.16)],
    [1.35, hex(4.0, 0.16)],
    [1.8, hex(3.45, 0.16)],
  ]);
  // 指揮塔（八角）
  loftY(
    torso,
    M.main3,
    [
      [1.8, chamferNgon(8, 2.0, 0.12, Math.PI / 8)],
      [2.35, chamferNgon(8, 1.85, 0.12, Math.PI / 8)],
      [2.7, chamferNgon(8, 1.4, 0.12, Math.PI / 8)],
    ],
    0,
    0.6,
  );
  P(torso, gCyl(0.85, 0.95, 0.18, 8), M.sub, 0, 2.78, 0.6);
  lens(torso, M, mx(T(0, 2.95, 0.2), RX(-0.3)), 0.22, red);
  // 六面的裝甲裙板（上緣往內傾）＋螺栓，前方兩面加警示條紋，後方兩面是散熱格柵
  for (let i = 0; i < 6; i++) {
    const m = ((i + 1) / 6) * Math.PI * 2;
    const cx = Math.cos(m) * 4.62,
      cz = Math.sin(m) * 4.62;
    const B = mx(T(cx, -0.05, cz), RY(yawTo(Math.cos(m), Math.sin(m))), RX(0.28));
    PM(torso, gPlate(cutRect(3.1, 1.05, 0.2), 0.26, 0.08, 0.94), M.main2, B);
    bolts(torso, M, mx(B, T(0, 0, -0.14)), [
      [-1.3, 0.35],
      [1.3, 0.35],
      [-1.3, -0.35],
      [1.3, -0.35],
    ]);
    const B2 = mx(B, T(0, 0, -0.15));
    if (Math.sin(m) < -0.1) stripes(torso, M, B2, 2.0, 0.4, 6);
    else if (Math.sin(m) > 0.1) louver(torso, M, B2, 2.0, 0.6, 4, 1.2);
  }
  // 上層甲板斜面的裝甲板（側面與前方）
  for (const m of [0, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3]) {
    const B = mx(
      T(Math.cos(m) * 3.38, 1.3, Math.sin(m) * 3.38),
      RY(yawTo(Math.cos(m), Math.sin(m))),
      RX(0.63),
    );
    PM(torso, gPlate(cutRect(2.5, 0.95, 0.18), 0.12, 0.04, 0.92), M.main, B);
    bolts(torso, M, mx(B, T(0, 0, -0.07)), [
      [-1.0, 0],
      [1.0, 0],
    ]);
  }
  // 上層甲板的散熱格柵、天線、扶手
  for (const s of [-1, 1]) {
    louver(torso, M, mx(T(s * 2.5, 1.82, -1.4), RX(HP)), 1.4, 1.2, 5, 1.2);
    rod(torso, M.joint, [s * 1.2, 2.6, 1.9], [s * 1.35, 2.85, 2.2], 0.04);
  }
  // 背上的導彈莢艙（gun）：楔形艙體＋正面 2×3 的發射管
  for (const s of [-1, 1]) {
    P(
      torso,
      gPod([
        [-1.0, 1.15, -0.42, 0.38, 0.14, 0.06],
        [-0.6, 1.2, -0.42, 0.45, 0.16, 0.06],
        [1.0, 1.2, -0.42, 0.45, 0.16, 0.06],
      ]),
      M.gun,
      s * 2.6,
      2.25,
      1.25,
    );
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        P(torso, gCyl(0.15, 0.15, 0.08, 8), M.sub, s * 2.6 + (c - 1) * 0.34, 2.12 + r * 0.32, 0.23, HP);
        P(torso, gCyl(0.1, 0.1, 0.09, 8), M.joint, s * 2.6 + (c - 1) * 0.34, 2.12 + r * 0.32, 0.22, HP);
      }
    P(torso, gBox(0.3, 0.5, 1.4), M.joint, s * 2.6, 1.95, 1.3);
  }
  // 前方的感測頭：楔形＋紅色眼縫＋兩側的鏡頭
  P(
    torso,
    gPod([
      [-5.05, 1.5, 1.0, 1.45, 0.16, 0.1],
      [-4.45, 2.3, 0.85, 1.75, 0.3, 0.2],
      [-3.3, 2.5, 0.85, 1.8, 0.3, 0.15],
    ]),
    M.sub,
  );
  P(torso, gBox(1.1, 0.14, 0.08), red, 0, 1.24, -5.08);
  for (const s of [-1, 1]) lens(torso, M, mx(T(s * 0.95, 1.22, -4.72), RY(-s * 0.6)), 0.14, red);
  // 髖關節座：每條腿的根部
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const x = Math.cos(a) * 4.2,
      z = Math.sin(a) * 4.2;
    P(torso, gCyl(1.15, 1.25, 1.5, 8), M.joint, x, 0, z);
    P(torso, gCyl(1.32, 1.32, 0.22, 8), M.main2, x, 0.82, z);
    P(torso, gCyl(0.55, 0.55, 0.12, 8), M.sub, x, 0.98, z);
  }
  // 底部核心（弱點）：發光球＋座＋護籠
  P(torso, gSph(1.5, 12), glow(0xff8a2a, 2.0), 0, -1.2, 0);
  P(torso, gCyl(2.2, 1.6, 0.6, 8), M.joint, 0, -0.9, 0);
  for (let i = 0; i < 6; i++) {
    const b = (i / 6) * Math.PI * 2;
    PM(
      torso,
      gBox(0.22, 1.3, 0.3),
      M.sub,
      T(Math.cos(b) * 1.62, -1.65, Math.sin(b) * 1.62),
      RY(yawTo(Math.cos(b), Math.sin(b))),
      RX(-0.45),
    );
  }
  const back = new THREE.Group();
  back.position.set(0, 2.6, 1.6);
  // 底部機砲：六管旋轉砲
  const hand = new THREE.Group();
  hand.position.set(0, -1.6, -2.6);
  P(
    hand,
    gPod([
      [-0.7, 0.85, -0.35, 0.35, 0.12, 0.12],
      [0.7, 0.95, -0.4, 0.4, 0.15, 0.12],
    ]),
    M.gun,
  );
  P(hand, gCyl(0.3, 0.3, 0.9, 8), M.joint, 0, 0.6, 0.2);
  P(hand, gCyl(0.32, 0.32, 0.3, 10), M.sub, 0, 0, -0.85, HP);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P(hand, gCyl(0.06, 0.06, 1.6, 6), M.sub, Math.cos(a) * 0.18, Math.sin(a) * 0.18, -1.2, HP);
  }
  P(hand, gCyl(0.3, 0.3, 0.12, 10), M.joint, 0, 0, -1.7, HP);
  torso.add(hand, back);
  // 腿：髖（繞 Y 擺動）→ 大腿往上外 → 膝（掛載點）→ 小腿往下到地面
  // 大腿的截面在腿的區域 XY（x 往外、y 往上），沿 Z 擠出
  const beam = (H, K, wH, wK, off, t0, t1) => {
    const u = [K[0] - H[0], K[1] - H[1]];
    const L = Math.hypot(u[0], u[1]);
    u[0] /= L;
    u[1] /= L;
    const v = [-u[1], u[0]];
    const at = (t, w) => [H[0] + u[0] * L * t + v[0] * (w + off), H[1] + u[1] * L * t + v[1] * (w + off)];
    return [at(t0, -wH), at(t1, -wK), at(t1, wK), at(t0, wH)];
  };
  const H = [0, 0],
    K = [5.0, 2.6];
  const thighFrame = gPlate(beam(H, K, 0.55, 0.45, 0, -0.08, 1.06), 0.7, 0.08);
  const thighShell = gPlate(beam(H, K, 0.6, 0.45, 0.15, 0.1, 0.86), 1.2, 0.12, [1, 0.86], [1, 0.86]);
  const thighCrest = gPlate(beam(H, K, 0.12, 0.1, 0.7, 0.14, 0.8), 0.6, 0.05);
  // 小腿：膝 → 腳
  const F = [3.05, -9.8];
  const shinPts = (() => {
    const u = [F[0], F[1]],
      L = Math.hypot(F[0], F[1]);
    u[0] /= L;
    u[1] /= L;
    const v = [-u[1], u[0]];
    const P2 = (t, w) => [u[0] * L * t + v[0] * w, u[1] * L * t + v[1] * w];
    return {
      shin: [
        P2(-0.06, -0.5),
        P2(0.3, -0.62),
        P2(0.92, -0.26),
        P2(1.0, -0.12),
        P2(1.0, 0.12),
        P2(0.92, 0.3),
        P2(0.3, 0.7),
        P2(-0.06, 0.52),
      ],
      greave: [P2(0.06, 0.3), P2(0.5, 0.42), P2(0.62, 0.62), P2(0.5, 0.86), P2(0.1, 0.84)],
      frame: [P2(0.12, -0.74), P2(0.85, -0.42), P2(0.85, -0.28), P2(0.12, -0.56)],
      at: P2,
    };
  })();
  const shin = gPlate(shinPts.shin, 0.85, 0.1, [0.9, 0.9], [0.9, 0.9]);
  const greave = gPlate(shinPts.greave, 1.15, 0.1, [0.85, 0.9], [0.85, 0.9]);
  const sframe = gPlate(shinPts.frame, 0.5, 0.05);
  const legNodes = [],
    mounts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const hip = new THREE.Group();
    hip.position.set(Math.cos(a) * 4.2, 7.2, Math.sin(a) * 4.2);
    hip.rotation.y = -a;
    body.add(hip);
    const leg = new THREE.Group(); // 抬腿用（繞 Z）
    hip.add(leg);
    P(leg, gCyl(0.85, 0.85, 1.4, 10), M.joint, 0, 0, 0, HP);
    P(leg, gCyl(0.6, 0.6, 1.62, 8), M.sub, 0, 0, 0, HP);
    P(leg, thighFrame, M.joint);
    P(leg, thighShell, M.main2);
    P(leg, thighCrest, M.main);
    piston(leg, M, [0.9, -0.75, 0], [4.3, 1.55, 0], 0.15);
    for (const s of [-1, 1])
      bolts(
        leg,
        M,
        mx(T(0, 0, s * 0.61), RY(s > 0 ? Math.PI : 0)),
        [
          [1.4, 1.15],
          [2.6, 1.75],
          [3.8, 2.35],
        ].map(([x, y]) => [s > 0 ? -x : x, y]),
        0.07,
      );
    const knee = new THREE.Group();
    knee.position.set(5.0, 2.6, 0);
    leg.add(knee);
    P(knee, gCyl(0.62, 0.62, 1.3, 10), M.joint, 0, 0, 0, HP);
    P(knee, shin, M.main);
    P(knee, greave, M.main3);
    P(knee, sframe, M.joint);
    piston(knee, M, shinPts.at(0.06, -0.7).concat(0), shinPts.at(0.55, -0.55).concat(0), 0.12);
    // 腳：踝環＋腳墊
    const ank = shinPts.at(0.88, 0);
    P(knee, gCyl(0.36, 0.36, 0.5, 8), M.sub, ank[0], ank[1], 0, 0, 0, 0.3);
    P(knee, gCyl(0.18, 0.5, 0.8, 6), M.joint, 3.05, -9.8, 0);
    P(knee, gCyl(0.62, 0.72, 0.2, 8), M.sub, 3.05, -10.1, 0);
    legNodes.push({ hip, leg, knee, a });
    mounts.push(knee);
  }
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'spider', height: 9 * scale, body, legNodes, mounts });
}

// 空中要塞：長型機身＋機翼，底部 4 個懸吊砲塔、翼端 2 具引擎（都是附屬部位）。原點在機身底面
// 機身＝切角截面的放樣（機首收窄）＋兩側分段的裝甲板與舷窗燈、背上的階梯式艦橋；
// 後掠主翼（翼面裝甲＋襟翼＋引擎掛架）、外傾的雙垂尾、機尾三具推進器、腹部的彈艙門與砲塔座
function buildFortress(pal, scale) {
  const M = mechMats(pal);
  const red = glow(0xff3a2a, 1.4);
  const amber = glow(0xffc060, 1.2);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 2.2;
  root.add(torso);
  // 機身
  P(
    torso,
    gPod([
      [-17.1, 2.4, -0.7, 1.0, 0.5, 0.5],
      [-15.2, 4.6, -1.5, 1.8, 0.9, 0.9],
      [-12.0, 7.0, -2.0, 2.0, 1.2, 1.3],
      [8.5, 7.0, -2.0, 2.0, 1.2, 1.3],
      [12.25, 5.0, -1.5, 1.6, 1.0, 1.0],
    ]),
    M.main,
  );
  // 機首：紅色感測窗＋下巴的感測器
  P(
    torso,
    gPod([
      [-17.15, 1.6, 0.2, 0.9, 0.25, 0.1],
      [-15.6, 3.2, 0.1, 1.85, 0.6, 0.1],
      [-13.4, 3.8, 0.1, 2.0, 0.7, 0.1],
    ]),
    M.main2,
  );
  P(torso, gBox(1.2, 0.2, 0.1), red, 0, 0.62, -17.13);
  for (const s of [-1, 1]) {
    lens(torso, M, mx(T(s * 1.5, -0.4, -15.9), RY(-s * 0.5)), 0.22, red);
  }
  // 兩側：三段裝甲板＋舷窗燈＋散熱格柵
  for (const s of [-1, 1]) {
    for (const [z0, z1] of [
      [-11.2, -4.6],
      [-4.2, 2.4],
      [2.8, 8.2],
    ]) {
      const B = mx(T(s * 3.56, 0.05, (z0 + z1) / 2), RY(-s * HP));
      PM(torso, gPlate(cutRect(z1 - z0, 1.42, 0.3), 0.18, 0.06, 0.95), M.main2, B);
      bolts(torso, M, mx(B, T(0, 0, -0.09)), [
        [(z0 - z1) / 2 + 0.3, 0.5],
        [(z1 - z0) / 2 - 0.3, 0.5],
        [(z0 - z1) / 2 + 0.3, -0.5],
        [(z1 - z0) / 2 - 0.3, -0.5],
      ]);
    }
    for (let i = 0; i < 5; i++) P(torso, gBox(0.12, 0.26, 0.6), amber, s * 3.67, 0.35, -8 + i * 4);
    louver(torso, M, mx(T(s * 3.67, -0.3, -3), RY(-s * HP)), 3.0, 0.5, 4, 1.4);
    louver(torso, M, mx(T(s * 3.67, -0.3, 5.5), RY(-s * HP)), 3.0, 0.5, 4, 1.4);
  }
  // 背上：階梯式的艦橋與上層結構
  P(
    torso,
    gPod([
      [-3.0, 3.0, 1.8, 2.9, 0.4, 0.01],
      [-1.5, 4.4, 1.8, 3.4, 0.5, 0.01],
      [6.5, 4.4, 1.8, 3.4, 0.5, 0.01],
      [7.2, 3.6, 1.8, 3.0, 0.4, 0.01],
    ]),
    M.main3,
  );
  P(
    torso,
    gPod([
      [2.4, 1.8, 3.35, 4.3, 0.3, 0.01],
      [3.0, 2.4, 3.35, 4.6, 0.35, 0.01],
      [5.5, 2.4, 3.35, 4.6, 0.35, 0.01],
    ]),
    M.sub,
  );
  P(torso, gBox(1.9, 0.16, 0.1), amber, 0, 4.25, 2.62, -0.6, 0, 0);
  for (const s of [-1, 1]) {
    louver(torso, M, mx(T(s * 1.2, 3.42, -0.2), RX(HP)), 1.4, 2.6, 6, 1.2);
    P(torso, gBox(0.08, 0.14, 1.8), amber, s * 1.22, 4.1, 4.2);
  }
  P(torso, gSph(0.55, 8), M.main2, 0, 4.7, 4.8);
  P(torso, gCyl(0.4, 0.5, 0.25, 8), M.joint, 0, 4.6, 4.8);
  rod(torso, M.joint, [0.7, 4.6, 4.0], [0.8, 5.5, 4.2], 0.05);
  rod(torso, M.joint, [-0.7, 4.6, 4.0], [-0.9, 5.3, 4.4], 0.04);
  for (let i = 0; i < 4; i++) P(torso, gBox(3.4, 0.12, 0.3), M.joint, 0, 2.02, -9 + i * 1.4); // 背脊的肋
  decal(torso, 1, 1.6, 1.6, 0, 2.03, -11, -HP, 0, 0);
  // 主翼：後掠的翼身（main2）＋翼面裝甲（main）＋後緣襟翼（sub）＋引擎掛架
  for (const s of [-1, 1]) {
    const sx = (pts) => pts.map(([x, z]) => [x * s, z]);
    PM(
      torso,
      gPlate(
        sx([
          [3.3, 1.2],
          [20.3, 5.4],
          [20.35, 7.3],
          [3.3, 9.0],
        ]),
        0.7,
        0.2,
      ),
      M.main2,
      T(0, -0.2, 0),
      FLAT(),
    );
    for (const [a, b] of [
      [4.2, 11.4],
      [11.9, 19.2],
    ])
      PM(
        torso,
        gPlate(
          sx([
            [a, 1.6 + (a - 3.3) * 0.245],
            [b, 1.6 + (b - 3.3) * 0.245],
            [b, 8.5 - (b - 3.3) * 0.1],
            [a, 8.5 - (a - 3.3) * 0.1],
          ]),
          0.14,
          0.05,
        ),
        M.main,
        T(0, 0.2, 0),
        FLAT(),
      );
    for (let i = 0; i < 3; i++) {
      const a = 4.0 + i * 5.3,
        b = a + 5.0;
      PM(
        torso,
        gPlate(
          sx([
            [a, 9.1 - (a - 3.3) * 0.1],
            [b, 9.1 - (b - 3.3) * 0.1],
            [b, 10.4 - (b - 3.3) * 0.1],
            [a, 10.4 - (a - 3.3) * 0.1],
          ]),
          0.3,
          0.06,
        ),
        M.sub,
        T(0, -0.2, 0),
        FLAT(),
      );
    }
    // 翼刀、引擎掛架、翼端燈
    for (const x of [8.5, 14.5]) P(torso, gBox(0.12, 0.3, 4.2), M.joint, s * x, 0.3, 3.4 + (x - 3.3) * 0.24);
    CB(torso, 1.4, 0.3, 4.2, M.joint, s * 17, 0.3, 7.6, 0, 0, 0, 0.08);
    P(torso, gBox(0.3, 0.14, 1.2), red, s * 20.3, 0, 7.0);
  }
  // 背後的垂直發射器（2×4 艙蓋）與兩座近防砲塔
  P(torso, gBox(2.8, 0.14, 2.6), M.joint, 0, 1.93, 9.7, 0.1, 0, 0);
  for (let i = 0; i < 4; i++)
    for (const s of [-1, 1])
      P(torso, gBox(0.55, 0.08, 0.5), M.sub, s * 0.65, 2.02, 8.8 + i * 0.62, 0.1, 0, 0);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.55, 0.65, 0.3, 8), M.joint, s * 1.9, 2.12, -7.5);
    P(torso, gSph(0.5, 8), M.sub, s * 1.9, 2.3, -7.5);
    P(torso, gCyl(0.06, 0.06, 1.1, 6), M.gun, s * 1.9, 2.42, -8.2, HP);
  }
  // 雙垂尾（外傾）
  for (const s of [-1, 1])
    PM(
      torso,
      gPlate(
        sideProfile([
          [8.4, 0],
          [12.0, 0],
          [12.4, 3.9],
          [10.9, 3.9],
        ]),
        0.45,
        0.1,
      ),
      M.main,
      T(s * 2.0, 1.5, 0),
      RZ(-s * 0.25),
      RY(HP),
    );
  // 機尾的推進器
  for (const x of [-1.8, 0, 1.8]) {
    P(torso, gCyl(0.75, 0.9, 0.5, 10), M.joint, x, 0, 12.3, HP);
    P(torso, gCyl(0.55, 0.55, 0.06, 10), glow(0x7fd8ff, 2.0), x, 0, 12.56, HP);
  }
  // 腹部：彈艙門（投彈）＋龍骨＋砲塔座
  const back = new THREE.Group();
  back.position.set(0, -2.4, 2);
  CB(torso, 3.2, 0.3, 6.4, M.joint, 0, -2.05, 2, 0, 0, 0, 0.06);
  for (const s of [-1, 1]) CB(torso, 1.45, 0.2, 6.0, M.sub, s * 0.76, -2.25, 2, 0, 0, 0, 0.05);
  CB(torso, 0.6, 0.4, 16, M.joint, 0, -2.1, -6.5, 0, 0, 0, 0.08);
  const hand = new THREE.Group();
  hand.position.set(0, -1.2, -15);
  // 機首砲：球形砲座＋雙管
  P(hand, gCyl(0.55, 0.65, 0.5, 8), M.joint, 0, 0.45, 0);
  P(
    hand,
    gPod([
      [-0.8, 1.0, -0.45, 0.45, 0.2, 0.2],
      [0.8, 1.2, -0.5, 0.5, 0.25, 0.25],
    ]),
    M.gun,
  );
  for (const s of [-1, 1]) {
    P(hand, gCyl(0.1, 0.1, 1.6, 6), M.sub, s * 0.25, 0, -1.4, HP);
    P(hand, gCyl(0.15, 0.15, 0.3, 6), M.joint, s * 0.25, 0, -2.1, HP);
  }
  torso.add(hand, back);
  const mounts = [];
  for (const [x, z] of [
    [-2.4, -8],
    [2.4, -8],
    [-2.4, 6],
    [2.4, 6],
  ]) {
    P(torso, gCyl(0.95, 1.05, 0.55, 8), M.joint, x, -2.05, z);
    P(torso, gCyl(1.15, 1.15, 0.12, 8), M.sub, x, -1.8, z);
    const m = new THREE.Group();
    m.position.set(x, -2.6, z);
    torso.add(m);
    mounts.push(m);
  }
  for (const s of [-1, 1]) {
    const m = new THREE.Group();
    m.position.set(s * 17, 0.2, 8);
    torso.add(m);
    mounts.push(m);
  }
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'fortress', height: 4.4 * scale, mounts });
}

// 砲兵指揮所：低矮的碉堡＋旋轉雷達，固定不動
// 斜面的基座（切角放樣）＋左右的傾斜護牆、射擊孔、八角形的指揮塊、桁架雷達塔與碟形天線、屋頂的近防機砲
function buildBunker(pal, scale) {
  const M = mechMats(pal);
  const red = glow(0xff3a2a, 1.2);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  loftY(torso, M.main2, [
    [0, cutRect(11.0, 11.4, 1.0)],
    [2.6, cutRect(10.2, 10.6, 0.9)],
    [3.2, cutRect(9.6, 10.0, 0.8)],
  ]);
  // 左右的傾斜護牆
  for (const s of [-1, 1]) {
    PM(
      torso,
      gPlate(
        sideProfile([
          [-5.7, 0],
          [5.7, 0],
          [5.2, 2.6],
          [-5.2, 2.6],
        ]),
        1.1,
        0.12,
      ),
      M.sub,
      T(s * 5.45, 0, 0),
      RZ(s * 0.22),
      RY(HP),
    );
    for (const z of [-3.6, 0, 3.6]) P(torso, gBox(0.3, 0.5, 0.5), M.joint, s * 5.62, 1.6, z, 0, 0, s * 0.22);
  }
  // 正面：射擊孔（深色凹槽＋紅光）＋警示條紋，背面散熱格柵
  for (const s of [-1, 1]) {
    const B = mx(T(s * 2.4, 2.25, -5.3), RX(0.15));
    PM(torso, gBox(2.9, 0.62, 0.12), M.joint, B);
    PM(torso, gBox(2.5, 0.18, 0.1), red, B, T(0, 0, -0.04));
    PM(torso, gPlate(cutRect(3.4, 0.4, 0.12), 0.2, 0.05), M.main, B, T(0, 0.52, -0.06));
  }
  stripes(torso, M, mx(T(0, 0.75, -5.6), RX(0.15)), 3.2, 0.5, 7);
  decal(torso, 1, 1.2, 1.2, -3.9, 1.2, -5.6, 0.15, Math.PI, 0);
  louver(torso, M, mx(T(0, 1.6, 5.5), RY(Math.PI), RX(-0.15)), 4.2, 1.2, 6, 1.4);
  // 八角形的指揮塊＋觀測窗
  const oct = (R) => chamferNgon(4, R, 0.3, Math.PI / 4);
  loftY(torso, M.main, [
    [3.2, oct(5.0)],
    [4.4, oct(4.6)],
    [4.9, oct(3.9)],
  ]);
  const win = glow(0xffc060, 1.0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const B = mx(T(Math.sin(a) * 3.42, 4.05, -Math.cos(a) * 3.42), RY(-a), RX(0.32));
    PM(torso, gBox(1.6, 0.2, 0.08), win, B);
  }
  // 屋頂：艙門、散熱口、天線
  P(torso, gCyl(0.6, 0.6, 0.15, 8), M.sub, -1.4, 4.97, 1.4);
  P(torso, gBox(1.0, 0.1, 0.2), M.joint, -1.4, 5.06, 1.4);
  louver(torso, M, mx(T(1.2, 4.93, -1.2), RX(HP)), 1.6, 1.2, 5, 1.2);
  rod(torso, M.joint, [-2.0, 4.9, 1.8], [-2.1, 6.8, 1.9], 0.05);
  rod(torso, M.joint, [-2.4, 4.9, 1.5], [-2.45, 6.2, 1.5], 0.04);
  // 雷達塔：三支桁架＋平台
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    rod(torso, M.joint, [2.2 + Math.cos(a) * 0.6, 4.9, 2.2 + Math.sin(a) * 0.6], [2.2, 7.2, 2.2], 0.09);
  }
  P(torso, gCyl(0.25, 0.32, 3, 6), M.sub, 2.2, 6.2, 2.2);
  P(torso, gCyl(0.55, 0.55, 0.2, 8), M.joint, 2.2, 7.3, 2.2);
  const rotor = new THREE.Group();
  rotor.position.set(2.2, 7.7, 2.2);
  torso.add(rotor);
  // 碟形天線（仰 0.5）：碟面＋邊環＋饋源桿＋背面桁架
  P(rotor, gCyl(1.6, 0.35, 0.5, 12), M.main3, 0, 0, 0, 0.5);
  PM(rotor, gCyl(1.66, 1.66, 0.1, 12), M.sub, RX(0.5), T(0, 0.26, 0));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = new THREE.Vector3(Math.cos(a) * 1.4, 0.3, Math.sin(a) * 1.4).applyMatrix4(RX(0.5));
    const q = new THREE.Vector3(0, 1.25, 0).applyMatrix4(RX(0.5));
    rod(rotor, M.joint, p.toArray(), q.toArray(), 0.04);
  }
  P(rotor, gSph(0.25, 6), glow(0xff5a2a, 1.6), 0, 0.2, -0.6);
  PM(rotor, gCyl(0.3, 0.3, 0.6, 8), M.joint, RX(0.5), T(0, -0.45, 0));
  // 近防機砲
  const hand = new THREE.Group();
  hand.position.set(-2.2, 5.6, -2.2);
  P(hand, gCyl(0.5, 0.6, 0.6, 8), M.joint, 0, -0.4, 0);
  P(
    hand,
    gPod([
      [-0.55, 0.85, -0.35, 0.35, 0.15, 0.1],
      [0.5, 1.0, -0.4, 0.4, 0.15, 0.1],
    ]),
    M.gun,
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    P(hand, gCyl(0.06, 0.06, 1.6, 6), M.sub, Math.cos(a) * 0.1, Math.sin(a) * 0.1, -1.3, HP);
  }
  P(hand, gCyl(0.18, 0.18, 0.2, 8), M.joint, 0, 0, -0.75, HP);
  lens(hand, M, T(0.38, 0.2, -0.55), 0.08, red);
  const back = new THREE.Group();
  back.position.set(0, 5.4, 0);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'bunker', height: 5.5 * scale, rotor });
}

// ---------- 附屬部位 ----------
// 長程砲台：底座＋會轉的砲塔（torso 繞 Y 轉向目標），砲管仰角 35°
// 八角的錨定底座＋迴轉齒環、楔形砲塔與側面頰甲、耳軸、分段砲管與制退器、駐退筒
function buildCannon(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  loftY(legsG, M.main2, [
    [0, chamferNgon(8, 2.6, 0.15, Math.PI / 8)],
    [0.8, chamferNgon(8, 2.45, 0.15, Math.PI / 8)],
    [1.2, chamferNgon(8, 2.05, 0.15, Math.PI / 8)],
  ]);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    PM(legsG, gBox(0.5, 0.5, 0.4), M.joint, T(Math.cos(a) * 2.25, 0.35, Math.sin(a) * 2.25), RY(-a));
    P(legsG, gCyl(0.1, 0.1, 0.12, 6), M.sub, Math.cos(a) * 2.3, 0.65, Math.sin(a) * 2.3);
  }
  P(legsG, gCyl(1.6, 1.6, 0.4, 16), M.joint, 0, 1.4, 0);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    PM(legsG, gBox(0.18, 0.3, 0.14), M.sub, T(Math.cos(a) * 1.62, 1.4, Math.sin(a) * 1.62), RY(-a));
  }
  const torso = new THREE.Group();
  torso.position.y = 1.6;
  root.add(torso);
  P(
    torso,
    gPod([
      [-1.4, 2.0, 0.1, 1.2, 0.5, 0.15],
      [-0.6, 2.6, 0.1, 1.75, 0.35, 0.15],
      [1.9, 2.6, 0.1, 1.75, 0.3, 0.2],
    ]),
    M.main,
  );
  for (const s of [-1, 1]) {
    sidePlate(
      torso,
      M.main2,
      [
        [-1.1, 0.3],
        [1.7, 0.3],
        [1.7, 1.5],
        [-0.2, 1.55],
      ],
      0.18,
      0.05,
      s * 1.38,
    );
    P(torso, gCyl(0.42, 0.42, 0.5, 10), M.sub, s * 1.25, 1.2, -0.6, 0, 0, HP);
    louver(torso, M, mx(T(s * 1.48, 0.9, 1.0), RY(-s * HP)), 1.0, 0.6, 3, 0.8);
  }
  CB(torso, 1.8, 0.8, 0.6, M.sub, 0, 0.9, 2.1, 0, 0, 0, 0.08); // 後方的平衡塊
  P(torso, gBox(0.8, 0.12, 0.06), glow(0xff3a2a, 1.4), 0, 0.8, -1.42);
  lens(torso, M, T(0.62, 0.45, -1.42), 0.11);
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.2, -0.6);
  barrel.rotation.x = 0.6;
  torso.add(barrel);
  PM(barrel, gPlate(cutRect(1.5, 1.1, 0.25), 0.3, 0.06, 0.9), M.main3, T(0, 0, -0.4));
  P(barrel, gCyl(0.5, 0.46, 2.6, 10), M.gun, 0, 0, -1.8, HP);
  P(barrel, gCyl(0.42, 0.42, 0.25, 10), M.sub, 0, 0, -3.1, HP);
  P(barrel, gCyl(0.36, 0.32, 2.4, 10), M.gun, 0, 0, -4.3, HP);
  P(
    barrel,
    gPod([
      [-6.2, 0.8, -0.32, 0.32, 0.12, 0.12],
      [-5.4, 0.8, -0.32, 0.32, 0.12, 0.12],
    ]),
    M.sub,
  );
  for (const s of [-1, 1]) P(barrel, gBox(0.06, 0.34, 0.22), M.joint, s * 0.41, 0, -5.9);
  for (const s of [-1, 1]) piston(barrel, M, [s * 0.3, 0.55, -0.4], [s * 0.3, 0.45, -2.4], 0.1);
  const back = new THREE.Group();
  back.position.set(0, 0, -6.4);
  barrel.add(back);
  finish(root, scale);
  return rigOf(root, torso, M, { back, legsG, type: 'cannon', height: 3.4 * scale });
}
// 懸吊砲塔（掛在空中要塞底部）：原點在頂部，往下吊；torso 轉向目標
// 吊架與軸承環、八角的球形砲座、側面頰甲、雙管砲與護套、感測鏡頭
function buildFTurret(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  root.add(torso);
  P(torso, gCyl(0.55, 0.72, 0.55, 8), M.joint, 0, 0.72, 0);
  P(torso, gCyl(0.88, 0.88, 0.12, 12), M.sub, 0, 0.5, 0);
  const o = (r) => chamferNgon(8, r, 0.15, Math.PI / 8);
  PM(
    torso,
    gLoft([
      { z: -0.98, pts: o(0.5) },
      { z: -0.62, pts: o(0.88) },
      { z: 0.45, pts: o(0.98) },
      { z: 0.9, pts: o(0.62) },
    ]),
    M.main,
  );
  for (const s of [-1, 1]) {
    sidePlate(
      torso,
      M.main2,
      [
        [-0.7, -0.45],
        [0.6, -0.5],
        [0.7, 0.35],
        [-0.4, 0.5],
      ],
      0.12,
      0.03,
      s * 0.98,
    );
    P(torso, gCyl(0.16, 0.16, 0.5, 6), M.sub, s * 0.25, -0.2, -0.95, HP);
    P(torso, gCyl(0.08, 0.08, 1.2, 6), M.gun, s * 0.25, -0.2, -1.35, HP);
    P(torso, gCyl(0.11, 0.11, 0.18, 6), M.joint, s * 0.25, -0.2, -1.9, HP);
  }
  P(torso, gBox(0.9, 0.1, 0.06), glow(0xff3a2a, 1.4), 0, 0.22, -0.92);
  lens(torso, M, T(0.42, 0.42, -0.76), 0.08);
  const hand = new THREE.Group();
  hand.position.set(0, -0.2, -1.9);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'fturret', height: 1.9 * scale });
}
// 引擎：沿 Z 的大型短艙，後端發光噴口
// 放樣的十二角整流罩＋分段環、進氣口的風扇葉片與整流錐、兩側的散熱格柵、上方掛架、後端的噴嘴瓣
function buildEngine(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.7;
  root.add(torso);
  const r12 = (r) => ngon(12, r, Math.PI / 12);
  PM(
    torso,
    gLoft([
      { z: -2.95, pts: r12(1.5) },
      { z: -2.6, pts: r12(1.72) },
      { z: 1.6, pts: r12(1.62) },
      { z: 2.7, pts: r12(1.36) },
    ]),
    M.main3,
  );
  P(torso, gCyl(1.8, 1.8, 0.4, 12), M.main2, 0, 0, -2.6, HP);
  for (const z of [-0.6, 1.4]) P(torso, gCyl(1.69, 1.69, 0.18, 12), M.joint, 0, 0, z, HP);
  // 進氣口：深色底＋12 片風扇葉片＋整流錐
  P(torso, gCyl(1.42, 1.42, 0.08, 12), M.joint, 0, 0, -2.95, HP);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    PM(
      torso,
      gBox(0.12, 1.05, 0.04),
      M.sub,
      T(Math.cos(a) * 0.82, Math.sin(a) * 0.82, -3.04),
      RZ(a - HP),
      RY(0.5),
    );
  }
  P(torso, gCyl(0.02, 0.42, 0.45, 10), M.sub, 0, 0, -3.2, -HP);
  P(torso, gCyl(0.3, 0.3, 0.1, 10), M.joint, 0, 0, -3.0, HP);
  // 兩側的散熱格柵與螺栓、上方的掛架
  for (const s of [-1, 1]) {
    louver(torso, M, mx(T(s * 1.62, 0, 0.4), RY(-s * HP)), 1.8, 0.8, 4, 0.9);
    bolts(torso, M, mx(T(s * 1.64, 0, -1.6), RY(-s * HP)), [
      [-0.3, 0.5],
      [0.3, 0.5],
      [-0.3, -0.5],
      [0.3, -0.5],
    ]);
  }
  sidePlate(
    torso,
    M.joint,
    [
      [-1.8, 1.4],
      [1.8, 1.4],
      [1.4, 1.75],
      [-1.2, 1.75],
    ],
    0.5,
    0.06,
  );
  // 後端：噴嘴瓣＋發光的噴口
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    PM(
      torso,
      gBox(0.62, 0.08, 0.7),
      M.sub,
      T(Math.cos(a) * 1.22, Math.sin(a) * 1.22, 2.85),
      RZ(a - HP),
      RX(0.25),
    );
  }
  P(torso, gCyl(1.2, 1.2, 0.2, 12), glow(0x7fd8ff, 2.0), 0, 0, 3.05, HP);
  const fl = new THREE.Mesh(
    new THREE.ConeGeometry(1.0, 3.2, 10),
    new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  fl.position.set(0, 0, 4.6);
  fl.rotation.x = Math.PI / 2;
  torso.add(fl);
  finish(root, scale);
  return rigOf(root, torso, M, { type: 'engine', height: 3.4 * scale, nozzles: [fl] });
}
// 護盾發生器：細高的柱子，頂端是發光的晶體（旋轉）
// 兩層的錨定底座、八角的錐形柱身與電容環、三片導流鰭（發光導管）、頂端的三爪支架
function buildPylon(pal, scale) {
  const M = mechMats(pal);
  const cyan = glow(0x60e0ff, 1.6);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const o = (r) => chamferNgon(6, r, 0.18, Math.PI / 6);
  loftY(torso, M.main2, [
    [0, o(1.8)],
    [0.55, o(1.7)],
    [0.7, o(1.35)],
    [1.05, o(1.2)],
  ]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P(torso, gCyl(0.09, 0.09, 0.1, 6), M.joint, Math.cos(a) * 1.5, 0.6, Math.sin(a) * 1.5);
  }
  const c8 = (r) => chamferNgon(8, r, 0.12, Math.PI / 8);
  loftY(torso, M.main, [
    [1.0, c8(0.85)],
    [6.3, c8(0.55)],
  ]);
  for (const y of [2.2, 3.6, 5.0]) {
    const r = 0.85 - ((y - 1) * 0.3) / 5.3;
    P(torso, gCyl(r + 0.1, r + 0.1, 0.3, 8), M.sub, 0, y, 0, 0, Math.PI / 8, 0);
    P(torso, gCyl(r + 0.04, r + 0.04, 0.12, 8), cyan, 0, y + 0.21, 0, 0, Math.PI / 8, 0);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + HP;
    const B = mx(RY(-a));
    PM(
      torso,
      gPlate(
        [
          [0.6, 1.0],
          [1.45, 1.0],
          [0.9, 5.4],
          [0.55, 5.6],
        ],
        0.26,
        0.05,
      ),
      M.sub,
      B,
    );
    PM(torso, gBox(0.08, 3.8, 0.1), cyan, B, T(1.2, 3.2, 0), RZ(0.125));
    // 頂端的爪
    rod(
      torso,
      M.joint,
      [Math.cos(a) * 0.5, 6.2, Math.sin(a) * 0.5],
      [Math.cos(a) * 1.15, 7.4, Math.sin(a) * 1.15],
      0.09,
    );
    P(torso, gBox(0.2, 0.5, 0.2), M.sub, Math.cos(a) * 1.18, 7.6, Math.sin(a) * 1.18);
  }
  P(torso, gCyl(0.7, 0.55, 0.4, 8), M.joint, 0, 6.45, 0);
  const rotor = new THREE.Group();
  rotor.position.y = 7.2;
  torso.add(rotor);
  P(rotor, new THREE.OctahedronGeometry(0.9, 0), glow(0x60e0ff, 2.2), 0, 0, 0, 0, 0, 0, 1, 1.6, 1);
  P(rotor, gCyl(1.4, 1.4, 0.12, 12), M.joint, 0, -1.0, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    P(rotor, gBox(0.3, 0.2, 0.3), M.sub, Math.cos(a) * 1.4, -1.0, Math.sin(a) * 1.4);
  }
  const back = new THREE.Group();
  back.position.y = 7.2;
  torso.add(back);
  finish(root, scale);
  return rigOf(root, torso, M, { back, type: 'pylon', height: 8 * scale, rotor });
}
// 多足要塞的膝關節致動器（弱點）：裝甲球＋發光環
// 沿 Z 的致動器鼓＋齒環、發光環、兩側八角的裝甲蓋（螺栓與軸心）、上下的液壓桿
function buildJoint(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.1;
  root.add(torso);
  P(torso, gCyl(1.0, 1.0, 1.7, 12), M.sub, 0, 0, 0, HP);
  P(torso, gCyl(1.3, 1.3, 0.3, 12), glow(0xff8a2a, 1.8), 0, 0, 0, HP);
  for (const z of [-0.62, 0.62]) {
    P(torso, gCyl(1.08, 1.08, 0.18, 12), M.joint, 0, 0, z, HP);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      PM(torso, gBox(0.18, 0.14, 0.16), M.joint, T(Math.cos(a) * 1.12, Math.sin(a) * 1.12, z), RZ(a - HP));
    }
  }
  for (const z of [-0.86, 0.86]) {
    P(torso, gCyl(0.55, 0.6, 0.12, 8), M.main3, 0, 0, z, HP, Math.PI / 8, 0);
    P(torso, gCyl(0.22, 0.22, 0.16, 8), M.joint, 0, 0, z, HP);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(torso, gCyl(0.05, 0.05, 0.16, 6), M.joint, Math.cos(a) * 0.4, Math.sin(a) * 0.4, z, HP);
    }
  }
  for (const s of [-1, 1]) {
    const B = mx(T(s * 0.95, 0, 0), RY(-s * HP));
    PM(torso, gPlate(cutRect(1.6, 1.6, 0.42), 0.4, 0.08, 0.86), M.acc, B);
    PM(torso, gCyl(0.38, 0.42, 0.2, 8), M.joint, B, T(0, 0, -0.26), RX(HP));
    bolts(torso, M, mx(B, T(0, 0, -0.2)), [
      [-0.5, 0.5],
      [0.5, 0.5],
      [-0.5, -0.5],
      [0.5, -0.5],
    ]);
    piston(torso, M, [s * 1.22, 0.95, -0.45], [s * 1.22, -0.95, 0.45], 0.07);
  }
  finish(root, scale);
  return rigOf(root, torso, M, { type: 'joint', height: 2.2 * scale });
}

// ---------- 第三批 Boss ----------
// 履帶底座（推土要塞、熔爐、電磁砲台共用）：左右兩條履帶＋輪
// 履帶＝前後上斜的側面輪廓＋上下兩段履帶板，外側是負重輪與上半部的側裙（螺栓）
function crawler(g, M, w, l, h = 1.6) {
  const tw = 1.2;
  const e = h * 0.5;
  const track = gPlate(
    sideProfile([
      [-l / 2 + e, 0],
      [l / 2 - e, 0],
      [l / 2, h * 0.5],
      [l / 2 - 0.25, h - 0.04],
      [-l / 2 + 0.25, h - 0.04],
      [-l / 2, h * 0.5],
    ]),
    tw,
    0.06,
  );
  const skirt = gPlate(
    sideProfile([
      [-l / 2 + 0.2, h * 0.6],
      [l / 2 - 0.2, h * 0.6],
      [l / 2 + 0.05, h * 0.82],
      [l / 2 - 0.2, h + 0.08],
      [-l / 2 + 0.2, h + 0.08],
      [-l / 2 - 0.05, h * 0.82],
    ]),
    0.12,
    0.04,
  );
  const shoe = gBox(tw + 0.08, 0.07, 0.16);
  const nShoe = Math.round((l - h) / 0.55);
  const nW = Math.max(3, Math.round(l / 1.7));
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - 0.7);
    P(g, track, M.joint, x, 0, 0, 0, HP, 0);
    for (let i = 0; i <= nShoe; i++) {
      const z = -l / 2 + e + ((l - 2 * e) * i) / nShoe;
      P(g, shoe, M.joint, x, 0.035, z);
      P(g, shoe, M.joint, x, h - 0.02, z * 0.97);
    }
    const xo = x + s * (tw / 2 + 0.03);
    for (let i = 0; i < nW; i++) {
      const z = -l / 2 + e + ((l - 2 * e) * i) / (nW - 1);
      P(g, gCyl(h * 0.3, h * 0.3, 0.12, 10), M.acc, xo, h * 0.34, z, 0, 0, HP);
      P(g, gCyl(h * 0.11, h * 0.11, 0.18, 6), M.joint, xo + s * 0.03, h * 0.34, z, 0, 0, HP);
    }
    for (const z of [-l / 2 + 0.55, l / 2 - 0.55]) {
      P(g, gCyl(h * 0.36, h * 0.36, 0.14, 12), M.sub, xo, h * 0.5, z, 0, 0, HP);
      P(g, gCyl(h * 0.14, h * 0.14, 0.2, 6), M.joint, xo + s * 0.03, h * 0.5, z, 0, 0, HP);
    }
    const xs = x + s * (tw / 2 + 0.07);
    P(g, skirt, M.main2, xs, 0, 0, 0, HP, 0);
    const n = Math.max(3, Math.round(l / 2));
    bolts(
      g,
      M,
      mx(T(xs + s * 0.06, 0, 0), RY(-s * HP)),
      Array.from({ length: n }, (_, i) => [s * (-l / 2 + 0.8 + ((l - 1.6) * i) / (n - 1)), h - 0.06]),
      0.06,
    );
  }
}
// 超長程電磁砲台：履帶底座＋旋轉砲塔，兩條長導軌夾著線圈；散熱片（fins）在發射後打開。原點在地面
// 楔形砲塔＋電容器組、刃形截面的導軌（前端收細）與方框形的線圈套環、後膛、散熱片
function buildRailgun(pal, scale) {
  const M = mechMats(pal);
  const red = glow(0xff3a2a, 1.4);
  const cyan = glow(0x7fd8ff, 1.2);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  crawler(legsG, M, 8, 9, 1.6);
  P(
    legsG,
    gPod([
      [-4.0, 5.4, 1.5, 2.55, 0.35, 0.05],
      [-3.3, 6.0, 1.5, 2.7, 0.35, 0.05],
      [3.4, 6.0, 1.5, 2.7, 0.35, 0.05],
      [4.0, 5.4, 1.5, 2.55, 0.35, 0.05],
    ]),
    M.main2,
  );
  P(legsG, gCyl(2.7, 2.7, 0.14, 16), M.joint, 0, 2.72, 0.4);
  // 四角的駐鋤液壓腳
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      piston(legsG, M, [sx * 2.7, 2.1, sz * 3.4], [sx * 3.25, 0.35, sz * 3.95], 0.1);
      P(legsG, gCyl(0.38, 0.45, 0.16, 8), M.joint, sx * 3.25, 0.08, sz * 3.95);
    }
  stripes(legsG, M, mx(T(0, 2.05, -4.02), RX(0.1)), 3.0, 0.4, 7);
  const torso = new THREE.Group();
  torso.position.y = 2.7;
  root.add(torso);
  P(
    torso,
    gPod([
      [-2.45, 3.6, 0.0, 1.55, 0.5, 0.2],
      [-1.6, 5.0, 0.0, 2.4, 0.55, 0.2],
      [3.3, 5.0, 0.0, 2.4, 0.5, 0.2],
      [3.6, 4.6, 0.05, 2.2, 0.45, 0.2],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-0.8, 2.8, 2.2, 3.15, 0.3, 0.01],
      [0.0, 3.4, 2.2, 3.4, 0.35, 0.01],
      [3.2, 3.4, 2.2, 3.4, 0.35, 0.01],
    ]),
    M.main3,
  );
  // 電容器組（三筒＋發光環）
  for (const x of [-0.95, 0, 0.95]) {
    P(torso, gCyl(0.3, 0.3, 2.4, 8), M.sub, x, 3.6, 1.6, HP);
    for (const z of [0.7, 1.6, 2.5]) P(torso, gCyl(0.32, 0.32, 0.1, 8), cyan, x, 3.6, z, HP);
  }
  P(torso, gBox(2.6, 0.1, 0.3), M.joint, 0, 3.42, 0.4);
  P(torso, gBox(2.8, 0.2, 0.1), red, 0, 0.75, -2.47);
  for (const s of [-1, 1]) {
    lens(torso, M, T(s * 1.35, 0.75, -2.5), 0.14, red);
    louver(torso, M, mx(T(s * 2.52, 1.25, -1.2), RY(-s * HP)), 1.0, 1.2, 5, 1.0);
    decal(torso, 2, 0.9, 0.9, s * 2.52, 0.5, -0.4, 0, s * HP, 0);
  }
  louver(torso, M, mx(T(0, 1.2, 3.62), RY(Math.PI)), 3.0, 1.4, 6, 1.2);
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.6, -2.2);
  torso.add(barrel);
  // 後膛
  P(
    barrel,
    gPod([
      [-1.8, 2.0, -0.7, 0.7, 0.3, 0.3],
      [-0.9, 2.4, -0.85, 0.85, 0.35, 0.35],
      [0.6, 2.4, -0.85, 0.85, 0.35, 0.35],
    ]),
    M.main2,
  );
  for (const s of [-1, 1]) {
    // 導軌：外側切角的刃形截面，前端收細
    const rail = [
      [0.38, -0.45],
      [0.75, -0.45],
      [0.92, -0.25],
      [0.92, 0.25],
      [0.75, 0.45],
      [0.38, 0.45],
    ].map(([x, y]) => [s * x, y]);
    P(barrel, gPlate(rail, 12.4, 0.05, [1, 0.6], 1), M.gun, 0, 0, -6.8);
    P(barrel, gBox(0.08, 0.5, 12), cyan, s * 0.36, 0, -6.8);
    rod(barrel, M.rubber, [s * 0.7, -0.55, -1.0], [s * 0.7, -0.55, -11.5], 0.07);
  }
  // 線圈套環
  for (let i = 0; i < 6; i++) {
    const z = -1.5 - i * 2;
    for (const s of [-1, 1]) {
      P(barrel, gBox(2.0, 0.24, 0.4), M.sub, 0, s * 0.6, z);
      P(barrel, gBox(0.3, 1.44, 0.4), M.sub, s * 1.0, 0, z);
      P(barrel, gBox(0.1, 0.9, 0.3), M.joint, s * 1.17, 0, z);
    }
  }
  // 砲口套
  for (const s of [-1, 1]) {
    P(barrel, gBox(0.22, 1.4, 1.0), M.sub, s * 1.05, 0, -12.6);
    P(barrel, gBox(2.2, 0.2, 1.0), M.sub, 0, s * 0.65, -12.6);
  }
  const back = new THREE.Group(); // 砲口
  back.position.set(0, 0, -13.2);
  barrel.add(back);
  // 散熱片：左右各 3 片，打開時往外翻
  const fin = gPlate(
    sideProfile([
      [-1.7, -0.26],
      [1.7, -0.26],
      [1.55, 0.26],
      [-1.35, 0.26],
    ]),
    0.12,
    0.03,
  );
  const fins = [];
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Group();
      f.position.set(s * 2.5, 1.0 + i * 0.7, 1.6);
      torso.add(f);
      P(f, fin, M.sub, s * 0.06, 0, 0, 0, HP, 0);
      P(f, gBox(0.05, 0.08, 3.0), M.joint, s * 0.12, 0.12, 0);
      P(f, gBox(0.04, 0.3, 3.0), glow(0xff8a2a, 1.6), s * 0.14, -0.04, 0);
      f.userData.side = s;
      fins.push(f);
    }
  // 近防機砲
  const hand = new THREE.Group();
  hand.position.set(1.8, 3.6, -1.2);
  torso.add(hand);
  P(hand, gCyl(0.3, 0.36, 0.3, 8), M.joint, 0, -0.28, 0.3);
  P(
    hand,
    gPod([
      [-0.1, 0.65, -0.28, 0.28, 0.1, 0.08],
      [0.7, 0.8, -0.3, 0.3, 0.12, 0.08],
    ]),
    M.gun,
  );
  for (const s of [-1, 1]) P(hand, gCyl(0.06, 0.06, 1.0, 6), M.sub, s * 0.13, 0, -0.5, HP);
  finish(root, scale);
  return rigOf(root, torso, M, {
    hand,
    back,
    legsG,
    type: 'railgun',
    height: 6 * scale,
    extra: { barrel, fins },
  });
}
// 浮游砲：尖錐形的小型無人砲台，尾端三片翼，前端發光砲口
// 八角放樣的機身（中段的裝甲環）、後掠的三片翼、砲口套、兩個感測點、尾端噴口
function buildBit(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.7;
  root.add(torso);
  const o = (r) => chamferNgon(6, r, 0.2, Math.PI / 6);
  PM(
    torso,
    gLoft([
      { z: -1.0, pts: o(0.1) },
      { z: -0.55, pts: o(0.27) },
      { z: 0.15, pts: o(0.42) },
      { z: 0.65, pts: o(0.4) },
      { z: 1.0, pts: o(0.3) },
    ]),
    M.main,
  );
  P(torso, gCyl(0.45, 0.45, 0.14, 6), M.main2, 0, 0, 0.2, HP, 0, 0);
  P(torso, gCyl(0.42, 0.42, 0.08, 6), M.joint, 0, 0, 0.36, HP);
  const fin = gPlate(
    sideProfile([
      [0.1, 0.32],
      [0.95, 0.3],
      [1.05, 0.74],
      [0.72, 0.74],
    ]),
    0.06,
    0.015,
  );
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    PM(torso, fin, M.acc, RZ(a - HP), RY(HP));
  }
  P(torso, gCyl(0.12, 0.14, 0.2, 8), M.sub, 0, 0, -0.98, HP);
  P(torso, gSph(0.16, 8), glow(0xffd070, 2.2), 0, 0, -1.1);
  for (const s of [-1, 1]) P(torso, gCyl(0.05, 0.05, 0.04, 6), M.lens, s * 0.17, 0.18, -0.42, -0.5);
  P(torso, gCyl(0.28, 0.32, 0.22, 10), M.joint, 0, 0, 1.06, HP);
  P(torso, gCyl(0.22, 0.22, 0.1, 10), glow(0x60d0ff, 1.6), 0, 0, 1.18, HP);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -1.2);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'bit', height: 1.4 * scale });
}
// 武裝列車：機車頭（正面 −Z）與車廂（car_aa 防空、car_ms 飛彈、car_lz 雷射舷砲、car_mine 布雷）。原點在軌道面
// 底架＋兩端的轉向架（側框、兩軸四輪、彈簧箱）與連結器
function trainBase(g, M, len) {
  CB(g, 3.0, 0.5, len, M.joint, 0, 0.75, 0, 0, 0, 0, 0.06);
  for (const s of [-1, 1]) P(g, gBox(0.12, 0.2, len - 0.4), M.sub, s * 1.5, 0.92, 0);
  for (const z of [-len / 2 + 1.4, len / 2 - 1.4]) {
    for (const s of [-1, 1]) {
      sidePlate(
        g,
        M.joint,
        [
          [z - 1.1, 0.3],
          [z + 1.1, 0.3],
          [z + 0.85, 0.72],
          [z - 0.85, 0.72],
        ],
        0.12,
        0.03,
        s * 1.36,
      );
      for (const dz of [-0.62, 0.62]) {
        P(g, gCyl(0.45, 0.45, 0.22, 12), M.acc, s * 1.18, 0.45, z + dz, 0, 0, HP);
        P(g, gCyl(0.16, 0.16, 0.12, 8), M.sub, s * 1.44, 0.45, z + dz, 0, 0, HP);
      }
      P(g, gBox(0.2, 0.26, 0.5), M.sub, s * 1.45, 0.62, z);
    }
    P(g, gBox(2.2, 0.16, 0.5), M.joint, 0, 0.42, z);
  }
  for (const z of [-len / 2 + 0.12, len / 2 - 0.12]) P(g, gBox(0.4, 0.3, 0.3), M.sub, 0, 0.7, z);
}
// 機車頭：楔形的裝甲車鼻＋長引擎罩、後方的駕駛室、兩側發光的鍋爐格柵（boiler，衝撞後過熱時變亮）、
// 排障器、雙排氣管、屋頂的散熱器與砲塔
function buildLoco(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  trainBase(torso, M, 9);
  P(
    torso,
    gPod([
      [-2.5, 2.9, 1.0, 3.1, 0.5, 0.05],
      [-1.9, 3.2, 1.0, 3.6, 0.6, 0.05],
      [1.8, 3.2, 1.0, 3.6, 0.6, 0.05],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-4.3, 2.6, 1.0, 1.9, 0.45, 0.05],
      [-3.4, 3.2, 1.0, 2.65, 0.6, 0.05],
      [-2.45, 3.2, 1.0, 3.0, 0.6, 0.05],
    ]),
    M.main2,
  );
  P(
    torso,
    gPod([
      [1.7, 3.0, 1.0, 3.85, 0.35, 0.05],
      [2.3, 3.1, 1.0, 3.95, 0.4, 0.05],
      [4.3, 3.1, 1.0, 3.95, 0.4, 0.05],
    ]),
    M.main3, // 駕駛室
  );
  const win = glow(0xffc060, 1.2);
  P(torso, gBox(2.4, 0.3, 0.06), win, 0, 3.45, 1.95, -0.6, 0, 0);
  for (const s of [-1, 1]) P(torso, gBox(0.06, 0.3, 1.2), win, s * 1.56, 3.4, 3.2);
  // 排障器（楔形＋肋）
  sidePlate(
    torso,
    M.sub,
    [
      [-5.4, 0.15],
      [-4.0, 0.15],
      [-4.0, 1.9],
      [-4.5, 1.9],
    ],
    3.4,
    0.1,
  );
  for (let i = 0; i < 5; i++)
    sidePlate(
      torso,
      M.acc,
      [
        [-5.48, 0.2],
        [-5.3, 0.2],
        [-4.45, 1.85],
        [-4.62, 1.85],
      ],
      0.18,
      0.03,
      -1.3 + i * 0.65,
    );
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.28, 0.28, 0.2, 10), M.sub, s * 0.95, 1.62, -4.32, HP);
    P(torso, gCyl(0.2, 0.2, 0.1, 10), glow(0xfff0c0, 2.4), s * 0.95, 1.62, -4.44, HP);
  }
  // 兩側：鍋爐格柵（發光葉片＋護條）、扶手、側裙
  const boiler = glow(0xff6a20, 0.4); // 衝撞後過熱時變亮
  for (const s of [-1, 1]) {
    P(torso, gBox(0.06, 1.1, 4.3), M.joint, s * 1.6, 2.1, -0.1);
    for (let i = 0; i < 9; i++) P(torso, gBox(0.08, 0.95, 0.24), boiler, s * 1.62, 2.1, -2.0 + i * 0.48);
    for (const y of [1.7, 2.1, 2.5]) P(torso, gBox(0.1, 0.08, 4.4), M.sub, s * 1.67, y, -0.1);
    rod(torso, M.joint, [s * 1.66, 2.95, -2.2], [s * 1.66, 2.95, 1.5], 0.04);
    P(torso, gBox(0.1, 0.4, 8.4), M.main2, s * 1.63, 1.18, 0);
  }
  // 屋頂：散熱器、雙排氣管
  louver(torso, M, mx(T(0, 3.62, 0.5), RX(HP)), 1.8, 1.6, 6, 1.0);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.24, 0.3, 1.1, 8), M.sub, s * 0.5, 4.0, -1.2);
    P(torso, gCyl(0.3, 0.3, 0.12, 8), M.joint, s * 0.5, 4.55, -1.2);
  }
  stripes(torso, M, mx(T(0, 1.15, -4.31)), 2.2, 0.24, 6);
  const hand = new THREE.Group();
  hand.position.set(0, 3.9, -2.4);
  torso.add(hand);
  P(torso, gCyl(0.4, 0.5, 0.6, 8), M.joint, 0, 3.35, -2.1);
  P(
    hand,
    gPod([
      [-0.25, 0.7, -0.25, 0.25, 0.1, 0.06],
      [0.8, 0.85, -0.28, 0.28, 0.12, 0.06],
    ]),
    M.gun,
  );
  P(hand, gCyl(0.07, 0.07, 1.4, 6), M.sub, 0, 0, -0.5, HP);
  P(hand, gCyl(0.11, 0.11, 0.2, 6), M.joint, 0, 0, -1.15, HP);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'loco', height: 4.6 * scale, extra: { boiler } });
}
function buildCar(kind) {
  return (pal, scale) => {
    const M = mechMats(pal);
    const root = new THREE.Group();
    const legsG = new THREE.Group();
    root.add(legsG);
    trainBase(legsG, M, 8.6);
    // 平板車台：切角的車台＋側緣、柱槽、螺栓
    P(
      legsG,
      gPod([
        [-4.1, 3.1, 1.0, 2.0, 0.12, 0.25],
        [4.1, 3.1, 1.0, 2.0, 0.12, 0.25],
      ]),
      M.main2,
    );
    for (const s of [-1, 1]) {
      P(legsG, gBox(0.12, 0.18, 8.0), M.sub, s * 1.5, 2.02, 0);
      for (let i = 0; i < 5; i++) P(legsG, gBox(0.14, 0.4, 0.22), M.joint, s * 1.56, 1.6, -3.2 + i * 1.6);
    }
    const torso = new THREE.Group();
    torso.position.y = 2.0;
    root.add(torso);
    const hand = new THREE.Group(),
      back = new THREE.Group();
    torso.add(hand, back);
    const extra = {};
    if (kind === 'car_aa') {
      // 雙聯防空砲塔（torso 轉向目標）：八角座圈、砲塔殼、仰起的雙管、後方的雷達盒、兩側彈鼓
      loftY(torso, M.main, [
        [0, chamferNgon(8, 1.55, 0.15, Math.PI / 8)],
        [0.6, chamferNgon(8, 1.35, 0.15, Math.PI / 8)],
      ]);
      P(
        torso,
        gPod([
          [-0.95, 1.4, 0.6, 1.25, 0.25, 0.01],
          [-0.5, 1.9, 0.6, 1.5, 0.3, 0.01],
          [0.95, 1.9, 0.6, 1.5, 0.3, 0.01],
        ]),
        M.main3,
      );
      for (const s of [-1, 1]) {
        const a = [s * 0.42, 1.25, -0.5],
          b = [s * 0.42, 1.25 + Math.sin(0.35) * 2.2, -0.5 - Math.cos(0.35) * 2.2];
        rod(torso, M.gun, a, b, 0.1, 6);
        rod(torso, M.sub, a, [a[0], a[1] + Math.sin(0.35) * 0.9, a[2] - Math.cos(0.35) * 0.9], 0.17, 8);
        P(torso, gCyl(0.13, 0.13, 0.25, 6), M.joint, b[0], b[1], b[2], -HP + 0.35);
        P(torso, gCyl(0.4, 0.4, 0.4, 10), M.sub, s * 1.15, 0.95, 0.2, 0, 0, HP);
      }
      CB(torso, 0.9, 0.6, 0.7, M.sub, 0, 1.8, 0.6, 0, 0, 0, 0.06);
      P(torso, gBox(1.0, 0.5, 0.06), M.joint, 0, 2.3, 0.6, -0.3, 0, 0);
      lens(torso, M, T(0.6, 1.25, -0.98), 0.1);
      hand.position.set(0, 2.0, -2.4);
      back.position.set(0, 2.0, -2.4);
    } else if (kind === 'car_ms') {
      // 飛彈發射箱：斜面的箱體、2×4 的艙蓋（框＋蓋）、側面裝甲與條紋、後方的射控盒
      P(
        torso,
        gPod([
          [-2.3, 2.1, 0.0, 1.25, 0.3, 0.05],
          [-1.9, 2.4, 0.0, 1.4, 0.3, 0.05],
          [1.9, 2.4, 0.0, 1.4, 0.3, 0.05],
          [2.3, 2.1, 0.0, 1.25, 0.3, 0.05],
        ]),
        M.main,
      );
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++) {
          P(torso, gCyl(0.24, 0.24, 0.06, 8), M.joint, -0.75 + i * 0.5, 1.41, -1 + j * 2);
          P(torso, gCyl(0.2, 0.2, 0.1, 8), M.sub, -0.75 + i * 0.5, 1.44, -1 + j * 2);
        }
      for (const s of [-1, 1]) {
        sidePlate(
          torso,
          M.main2,
          [
            [-2.0, 0.15],
            [2.0, 0.15],
            [1.8, 1.1],
            [-1.8, 1.1],
          ],
          0.12,
          0.03,
          s * 1.24,
        );
        stripes(torso, M, mx(T(s * 1.32, 0.45, -1.2), RY(-s * HP)), 1.2, 0.3, 4);
      }
      CB(torso, 1.2, 0.8, 0.8, M.sub, 0, 0.5, 2.7, 0, 0, 0, 0.06);
      lens(torso, M, mx(T(0.3, 0.6, 3.12), RY(Math.PI)), 0.1);
      back.position.set(0, 1.6, 0);
    } else if (kind === 'car_lz') {
      // 兩側的雷射舷砲（大鏡片）：斜面的車體、八角的發射器座＋冷卻環、頂部的散熱鰭、導管
      P(
        torso,
        gPod([
          [-3.0, 2.2, 0.0, 1.5, 0.5, 0.05],
          [-2.4, 2.6, 0.0, 1.8, 0.55, 0.05],
          [2.4, 2.6, 0.0, 1.8, 0.55, 0.05],
          [3.0, 2.2, 0.0, 1.5, 0.5, 0.05],
        ]),
        M.main,
      );
      const lens2 = glow(0xff4a8a, 1.2);
      for (const s of [-1, 1])
        for (const z of [-1.6, 1.6]) {
          const B = mx(T(s * 1.3, 1.0, z), RY(-s * HP));
          PM(torso, gPlate(cutRect(1.3, 1.3, 0.35), 0.3, 0.06, 0.85), M.joint, B);
          PM(torso, gCyl(0.48, 0.5, 0.16, 12), M.sub, B, T(0, 0, -0.2), RX(HP));
          PM(torso, gCyl(0.4, 0.4, 0.06, 12), lens2, B, T(0, 0, -0.26), RX(HP));
          rod(torso, M.rubber, [s * 1.2, 1.55, z], [s * 0.6, 1.82, z * 0.6], 0.06);
        }
      for (let i = 0; i < 7; i++) P(torso, gBox(1.4, 0.3, 0.08), M.sub, 0, 1.92, -1.5 + i * 0.5);
      P(torso, gBox(0.2, 0.32, 3.4), M.joint, 0, 1.9, 0);
      hand.position.set(0, 1.0, 0);
      extra.lens = lens2;
    } else {
      // 布雷：八角漏斗（肋）＋尾端的投放槽與閘門、前方的地雷架、警示條紋
      loftY(
        torso,
        M.main,
        [
          [0, chamferNgon(8, 0.65, 0.15, Math.PI / 8)],
          [0.5, chamferNgon(8, 1.0, 0.15, Math.PI / 8)],
          [1.8, chamferNgon(8, 1.45, 0.15, Math.PI / 8)],
        ],
        0,
        0.8,
      );
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        PM(
          torso,
          gBox(0.12, 1.4, 0.16),
          M.joint,
          T(Math.cos(a) * 1.1, 1.05, 0.8 + Math.sin(a) * 1.1),
          RY(yawTo(Math.cos(a), Math.sin(a))),
          RX(0.35),
        );
      }
      P(torso, gCyl(1.5, 1.5, 0.12, 8), M.sub, 0, 1.82, 0.8, 0, Math.PI / 8, 0);
      CB(torso, 1.2, 0.6, 1.4, M.sub, 0, 0.1, 3.6, 0.3, 0, 0, 0.06);
      P(torso, gBox(1.0, 0.08, 0.6), M.acc, 0, -0.12, 4.15, 0.3, 0, 0);
      // 地雷架：兩列圓盤
      const mineRed = glow(0xff3a2a, 1.6);
      for (let i = 0; i < 3; i++)
        for (const s of [-1, 1]) {
          P(torso, gCyl(0.3, 0.3, 0.2, 10), M.acc, s * 0.45, 0.12, -1.6 + i * 0.7);
          P(torso, gCyl(0.08, 0.08, 0.1, 6), mineRed, s * 0.45, 0.26, -1.6 + i * 0.7);
        }
      stripes(torso, M, mx(T(0, 0.03, -2.7), RX(HP)), 2.2, 0.5, 6);
      back.position.set(0, 0, 4.2);
    }
    P(torso, gBox(1.6, 0.12, 0.06), glow(0xff3a2a, 1.4), 0, 0.2, -4.2);
    finish(root, scale);
    return rigOf(root, torso, M, { hand, back, legsG, type: kind, height: 4 * scale, extra });
  };
}
// 熔爐清掃機：寬大的履帶車，正面是熔爐口（左右兩片顎門 jaws，打開時露出發光的熔爐），頂上煙囪
// 斜面車體與側面裝甲（條紋）、八角的爐口框與隔熱罩、上層甲板的散熱格柵、八角煙囪（熱環、內部發光）、
// 熔渣導管；顎門＝帶肋的厚門板＋內緣的齒＋鉸鏈
function buildFurnace(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  crawler(torso, M, 9, 10, 1.8);
  P(
    torso,
    gPod([
      [-4.1, 6.6, 1.8, 4.6, 0.8, 0.15],
      [-3.4, 7.4, 1.8, 5.0, 0.8, 0.15],
      [4.4, 7.4, 1.8, 5.0, 0.7, 0.15],
      [4.9, 7.0, 1.8, 4.7, 0.6, 0.15],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-1.35, 4.4, 4.95, 6.0, 0.5, 0.01],
      [-0.6, 5.2, 4.95, 6.3, 0.5, 0.01],
      [4.15, 5.2, 4.95, 6.3, 0.5, 0.01],
    ]),
    M.main2,
  );
  louver(torso, M, mx(T(0, 6.32, 1.0), RX(HP)), 2.6, 2.0, 7, 1.4);
  louver(torso, M, mx(T(0, 3.4, 4.92), RY(Math.PI)), 4.4, 1.6, 6, 1.4);
  // 側面裝甲＋條紋
  for (const s of [-1, 1]) {
    sidePlate(
      torso,
      M.main2,
      [
        [-3.4, 2.0],
        [4.5, 2.0],
        [4.5, 4.4],
        [-2.8, 4.4],
      ],
      0.2,
      0.05,
      s * 3.78,
    );
    stripes(torso, M, mx(T(s * 3.9, 3.2, -2.3), RY(-s * HP)), 1.6, 2.0, 5);
    bolts(
      torso,
      M,
      mx(T(s * 3.89, 0, 0), RY(-s * HP)),
      [-0.6, 0.8, 2.2, 3.6].map((z) => [s * z, 4.2]),
      0.08,
    );
  }
  // 煙囪：八角筒＋熱環＋帽，頂端內部發光（跟著熔爐變亮）
  const core = glow(0xff6a10, 1.0);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.6, 0.75, 3, 8), M.sub, s * 1.8, 7.4, 2.8, 0, Math.PI / 8, 0);
    for (const y of [6.6, 7.6])
      P(torso, gCyl(0.72, 0.72, 0.16, 8), M.acc, s * 1.8, y, 2.8, 0, Math.PI / 8, 0);
    P(torso, gCyl(0.66, 0.66, 0.3, 8), M.joint, s * 1.8, 8.9, 2.8, 0, Math.PI / 8, 0);
    P(torso, gCyl(0.45, 0.45, 0.04, 8), core, s * 1.8, 9.04, 2.8);
    // 熔渣導管：爐口 → 煙囪
    rod(torso, M.joint, [s * 1.2, 5.0, -3.6], [s * 1.2, 6.0, -1.0], 0.22, 8);
    rod(torso, M.joint, [s * 1.2, 6.0, -1.0], [s * 1.6, 6.4, 1.9], 0.22, 8);
    P(torso, gSph(0.26, 8), M.sub, s * 1.2, 6.0, -1.0);
  }
  // 熔爐（內部發光）＋八角爐口框＋隔熱罩
  P(torso, gSph(1.6, 12), core, 0, 3.2, -4.0);
  P(torso, gCyl(2.0, 2.0, 0.6, 8), M.joint, 0, 3.2, -4.3, HP, Math.PI / 8, 0);
  P(torso, gCyl(1.75, 1.75, 0.64, 8), M.gun, 0, 3.2, -4.3, HP, Math.PI / 8, 0);
  PM(torso, gPlate(cutRect(6.0, 0.6, 0.2), 0.5, 0.1, [1, 0.6]), M.sub, T(0, 4.75, -4.2), RX(0.5));
  const jaws = [];
  for (const s of [-1, 1]) {
    const j = new THREE.Group();
    j.position.set(s * 2.4, 3.2, -4.6);
    torso.add(j);
    PM(
      j,
      gPlate(
        [
          [0, -1.7],
          [-s * 2.1, -1.7],
          [-s * 2.45, -1.35],
          [-s * 2.45, 1.35],
          [-s * 2.1, 1.7],
          [0, 1.7],
        ],
        0.6,
        0.1,
        0.94,
      ),
      M.main3,
    );
    for (const y of [-1.0, 0, 1.0]) P(j, gBox(2.0, 0.18, 0.12), M.main2, -s * 1.15, y, -0.34);
    for (let i = 0; i < 5; i++) {
      const y = -1.4 + i * 0.7 + s * 0.17;
      PM(j, gCyl(0.02, 0.18, 0.3, 4), M.sub, T(-s * 2.42, y, -0.2), RZ(s * HP));
    }
    for (const y of [-1.2, 0, 1.2]) P(j, gCyl(0.24, 0.24, 0.6, 8), M.joint, 0, y, 0);
    j.userData.side = s;
    jaws.push(j);
  }
  const back = new THREE.Group(); // 熔渣投射口
  back.position.set(0, 3.4, -5.4);
  const hand = new THREE.Group();
  hand.position.set(0, 3.0, -5.2);
  torso.add(back, hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'furnace', height: 7 * scale, extra: { jaws, core } });
}
// 衛星砲導引塔：六角底座＋高塔，塔頂旋轉的導引鏡（rotor），冷卻時鏡面變暗
// 切角六角的兩層底座（扶壁、格柵、條紋）、六角錐形塔身與裝甲環、三條發光導管（跟著鏡面變亮）、
// 維修平台、塔頂的頭部；導引鏡＝碟面＋邊環＋肋＋往內傾的四爪（發光尖端）
function buildTower(pal, scale) {
  const M = mechMats(pal);
  const lens = glow(0x9fe8ff, 2.0);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const hx = (R, t) => chamferNgon(6, R, t, HP);
  loftY(torso, M.main2, [
    [0, hx(5.0, 0.14)],
    [1.2, hx(4.8, 0.14)],
    [1.6, hx(4.3, 0.14)],
  ]);
  loftY(torso, M.main, [
    [1.6, hx(3.6, 0.14)],
    [2.6, hx(3.0, 0.14)],
  ]);
  loftY(torso, M.main, [
    [2.6, hx(1.85, 0.12)],
    [13.1, hx(1.25, 0.12)],
  ]);
  for (let i = 0; i < 6; i++) {
    const a = HP + (i / 6) * Math.PI * 2;
    // 扶壁（角）
    PM(
      torso,
      gPlate(
        [
          [1.55, 2.6],
          [3.25, 2.6],
          [1.8, 6.2],
          [1.45, 6.2],
        ],
        0.5,
        0.06,
      ),
      M.main3,
      RY(-a),
    );
    // 底座的面：格柵或條紋
    const m = a + Math.PI / 6;
    const B = mx(T(Math.cos(m) * 4.3, 0.7, Math.sin(m) * 4.3), RY(yawTo(Math.cos(m), Math.sin(m))), RX(0.1));
    if (i % 2) louver(torso, M, B, 2.4, 0.8, 4, 1.2);
    else stripes(torso, M, B, 2.4, 0.5, 7);
  }
  // 導管（發光）＋裝甲環
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 3;
    PM(
      torso,
      gPlate(
        [
          [1.35, 2.6],
          [2.0, 2.6],
          [1.65, 11.4],
          [1.15, 11.4],
        ],
        0.55,
        0.06,
      ),
      M.sub,
      RY(-a),
    );
    PM(torso, gBox(0.1, 8.6, 0.2), lens, RY(-a), T(1.84, 7.0, 0), RZ(0.04));
  }
  for (let i = 0; i < 4; i++) {
    const y = 4 + i * 2.4,
      r = 1.85 - ((y - 2.6) * 0.6) / 10.5;
    P(torso, gCyl(r + 0.12, r + 0.12, 0.3, 6), M.acc, 0, y, 0);
  }
  // 維修平台
  P(torso, gCyl(2.5, 2.5, 0.16, 8), M.joint, 0, 9.6, 0, 0, Math.PI / 8, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    rod(
      torso,
      M.joint,
      [Math.cos(a) * 2.35, 9.6, Math.sin(a) * 2.35],
      [Math.cos(a) * 2.35, 10.4, Math.sin(a) * 2.35],
      0.04,
    );
    rod(
      torso,
      M.joint,
      [Math.cos(a) * 2.35, 10.35, Math.sin(a) * 2.35],
      [Math.cos(a + Math.PI / 4) * 2.35, 10.35, Math.sin(a + Math.PI / 4) * 2.35],
      0.035,
    );
  }
  // 塔頂的頭部
  P(torso, gCyl(1.5, 1.3, 0.6, 8), M.main3, 0, 13.0, 0);
  P(torso, gCyl(1.0, 1.0, 0.3, 12), M.joint, 0, 13.35, 0);
  const rotor = new THREE.Group();
  rotor.position.y = 13.6;
  torso.add(rotor);
  P(rotor, gCyl(3.2, 0.8, 1.0, 12), M.main3, 0, 0, 0);
  P(rotor, gCyl(3.28, 3.28, 0.16, 12), M.sub, 0, 0.44, 0);
  P(rotor, gCyl(2.4, 2.4, 0.1, 16), lens, 0, 0.52, 0);
  P(rotor, gCyl(0.7, 0.7, 0.2, 10), M.joint, 0, 0.55, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 4;
    PM(
      rotor,
      gBox(0.18, 0.5, 2.2),
      M.sub,
      T(Math.cos(a) * 1.9, -0.15, Math.sin(a) * 1.9),
      RY(-a + HP),
      RX(-0.35),
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    PM(
      rotor,
      gPlate(
        [
          [2.45, 0.3],
          [2.85, 0.3],
          [2.55, 2.0],
          [2.3, 2.0],
        ],
        0.3,
        0.05,
      ),
      M.sub,
      RY(-a),
    );
    P(rotor, gBox(0.14, 0.3, 0.14), lens, Math.cos(a) * 2.42, 2.05, Math.sin(a) * 2.42);
  }
  const back = new THREE.Group();
  back.position.y = 14.6;
  const hand = new THREE.Group();
  hand.position.set(0, 4.4, -3.0);
  torso.add(back, hand);
  // 下方的機砲（從塔身伸出的支架）
  P(torso, gBox(0.5, 0.4, 1.4), M.joint, 0, 4.0, -2.2);
  P(
    torso,
    gPod([
      [-3.4, 0.9, 4.05, 4.75, 0.15, 0.1],
      [-2.2, 1.1, 4.0, 4.8, 0.2, 0.1],
    ]),
    M.gun,
  );
  P(torso, gCyl(0.1, 0.1, 1.2, 6), M.sub, 0, 4.4, -3.8, HP);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, rotor, type: 'tower', height: 15 * scale, extra: { lens } });
}
// 高速突擊機：三角翼戰機（正面 −Z），雙垂尾、尾端兩具發光噴口
// 切角截面放樣的機身（尖機首）、兩側進氣道、多面座艙罩、薄的三角翼（翼下飛彈）、前翼、外傾雙垂尾、噴嘴瓣
function buildJet(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.4;
  root.add(torso);
  P(
    torso,
    gPod([
      [-9.3, 0.12, -0.08, 0.06, 0.01, 0.01],
      [-7.5, 1.0, -0.42, 0.45, 0.28, 0.24],
      [-5.0, 1.6, -0.62, 0.68, 0.48, 0.34],
      [-1.5, 2.1, -0.7, 0.7, 0.5, 0.35],
      [4.2, 2.1, -0.66, 0.66, 0.45, 0.3],
      [6.0, 1.8, -0.58, 0.56, 0.4, 0.28],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-3.0, 0.5, 0.6, 0.78, 0.1, 0.01],
      [4.6, 0.6, 0.6, 0.85, 0.12, 0.01],
    ]),
    M.main3,
  ); // 背脊
  // 座艙罩＋框
  P(
    torso,
    gPod([
      [-4.7, 0.42, 0.5, 0.72, 0.12, 0.01],
      [-3.7, 0.86, 0.5, 1.15, 0.26, 0.01],
      [-2.1, 0.8, 0.5, 1.05, 0.25, 0.01],
    ]),
    glow(0xffa040, 0.8),
  );
  P(torso, gBox(0.08, 0.1, 2.6), M.sub, 0, 1.1, -3.4);
  // 進氣道
  for (const s of [-1, 1]) {
    P(
      torso,
      gPod([
        [-3.9, 0.7, -0.55, 0.3, 0.15, 0.1],
        [-2.8, 0.8, -0.6, 0.35, 0.15, 0.1],
        [2.4, 0.8, -0.6, 0.35, 0.15, 0.1],
      ]),
      M.main3,
      s * 1.15,
      0,
      0,
    );
    P(torso, gBox(0.55, 0.62, 0.06), M.joint, s * 1.15, -0.13, -3.92);
  }
  // 三角翼：薄翼身＋後緣的發光條＋翼下的飛彈
  for (const s of [-1, 1]) {
    const sx = (pts) => pts.map(([x, z]) => [x * s, z]);
    PM(
      torso,
      gPlate(
        sx([
          [1.0, -2.6],
          [7.3, 2.7],
          [7.39, 3.7],
          [1.0, 4.7],
        ]),
        0.22,
        0.07,
      ),
      M.main2,
      T(0, -0.1, 0),
      FLAT(),
    );
    PM(
      torso,
      gPlate(
        sx([
          [1.6, -0.6],
          [5.0, 2.3],
          [5.0, 3.6],
          [1.6, 3.9],
        ]),
        0.06,
        0.02,
      ),
      M.main3,
      T(0, 0.03, 0),
      FLAT(),
    );
    P(torso, gBox(1.4, 0.06, 0.4), glow(0xff4030, 1.2), s * 5.8, 0.05, 3.3);
    P(torso, gBox(0.12, 0.2, 2.4), M.gun, s * 3.6, -0.3, 1.4);
    P(torso, gCyl(0.14, 0.14, 2.2, 6), M.sub, s * 3.6, -0.5, 1.3, HP);
    P(torso, gCyl(0.01, 0.14, 0.4, 6), M.acc, s * 3.6, -0.5, -0.0, -HP);
    // 前翼
    PM(
      torso,
      gPlate(
        sx([
          [0.95, -5.2],
          [2.4, -4.4],
          [2.4, -4.0],
          [0.95, -4.1],
        ]),
        0.1,
        0.03,
      ),
      M.main2,
      T(0, 0.1, 0),
      FLAT(),
    );
  }
  // 外傾的雙垂尾
  for (const s of [-1, 1])
    PM(
      torso,
      gPlate(
        sideProfile([
          [3.4, 0],
          [6.0, 0],
          [6.3, 1.95],
          [5.4, 1.95],
        ]),
        0.16,
        0.05,
      ),
      M.main2,
      T(s * 0.8, 0.5, 0),
      RZ(-s * 0.3),
      RY(HP),
    );
  const nozzles = [];
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.55, 0.6, 1.0, 10), M.joint, s * 0.5, 0, 6.2, HP);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      PM(
        torso,
        gBox(0.4, 0.05, 0.45),
        M.sub,
        T(s * 0.5 + Math.cos(a) * 0.5, Math.sin(a) * 0.5, 6.75),
        RZ(a - HP),
        RX(0.18),
      );
    }
    P(torso, gCyl(0.42, 0.42, 0.05, 10), glow(0xffb060, 1.8), s * 0.5, 0, 6.68, HP);
    const fl = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 2.6, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffb060,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    fl.position.set(s * 0.5, 0, 7.8);
    fl.rotation.x = Math.PI / 2;
    torso.add(fl);
    nozzles.push(fl);
  }
  const hand = new THREE.Group();
  hand.position.set(0.6, -0.4, -6.4);
  P(torso, gCyl(0.1, 0.1, 0.6, 6), M.gun, 0.6, -0.4, -6.2, HP);
  const back = new THREE.Group();
  back.position.set(0, -0.8, 0);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, nozzles, type: 'jet', height: 2.8 * scale });
}
// 衝撞推土要塞：正面大鏟刀、兩側絞碎滾筒（grinders，會轉）、背面散熱口（vents，衝撞失敗後打開）
// 斜面車體與駕駛艙、內凹的鏟刀（背肋、刀齒、推臂與液壓桿）、螺旋排列刀齒的滾筒、帶葉片的散熱蓋
function buildDozer(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  crawler(torso, M, 9, 11, 2.0);
  P(
    torso,
    gPod([
      [-4.2, 6.0, 1.9, 4.6, 0.9, 0.15],
      [-3.0, 7.2, 1.9, 5.3, 0.8, 0.15],
      [5.0, 7.2, 1.9, 5.3, 0.6, 0.15],
      [5.4, 6.8, 1.9, 5.1, 0.5, 0.15],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-0.5, 4.0, 5.2, 6.6, 0.6, 0.01],
      [0.4, 4.6, 5.2, 7.0, 0.6, 0.01],
      [3.7, 4.6, 5.2, 7.0, 0.5, 0.01],
    ]),
    M.main3,
  );
  P(torso, gBox(3.0, 0.24, 0.08), glow(0xff3a2a, 1.4), 0, 6.1, -0.52);
  for (const s of [-1, 1]) lens(torso, M, T(s * 1.75, 5.65, -0.5), 0.14);
  louver(torso, M, mx(T(0, 7.02, 2.2), RX(HP)), 3.0, 1.6, 6, 1.2);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.25, 0.3, 1.4, 8), M.sub, s * 1.6, 6.0, 4.5);
    P(torso, gCyl(0.3, 0.3, 0.12, 8), M.joint, s * 1.6, 6.7, 4.5);
    stripes(torso, M, mx(T(s * 3.62, 3.4, -2.6), RY(-s * HP)), 1.8, 1.4, 5);
    louver(torso, M, mx(T(s * 3.62, 3.6, 2.4), RY(-s * HP)), 3.0, 1.2, 5, 1.2);
  }
  // 鏟刀：內凹的刀面（側面輪廓沿 X 擠出）＋背肋＋刀齒＋刃口
  sidePlate(
    torso,
    M.sub,
    [
      [-7.0, 0.3],
      [-6.6, 0.8],
      [-6.3, 1.6],
      [-6.25, 2.6],
      [-6.45, 3.5],
      [-6.9, 4.1],
      [-6.55, 4.15],
      [-6.0, 3.5],
      [-5.8, 2.6],
      [-5.85, 1.6],
      [-6.1, 0.8],
      [-6.5, 0.3],
    ],
    10.4,
    0.08,
  );
  for (const x of [-4.4, -2.2, 0, 2.2, 4.4])
    sidePlate(
      torso,
      M.main2,
      [
        [-6.45, 0.4],
        [-5.85, 1.6],
        [-5.8, 2.6],
        [-6.0, 3.5],
        [-5.4, 3.0],
        [-5.4, 1.0],
      ],
      0.3,
      0.04,
      x,
    );
  P(torso, gBox(10.4, 0.18, 0.5), M.joint, 0, 0.32, -6.78, -0.9, 0, 0);
  for (let i = 0; i < 7; i++)
    sidePlate(
      torso,
      M.acc,
      [
        [-7.2, 0.05],
        [-6.7, 0.05],
        [-6.55, 0.6],
        [-6.95, 0.6],
      ],
      0.5,
      0.04,
      -4.5 + i * 1.5,
    );
  // 推臂＋液壓桿
  for (const s of [-1, 1]) {
    sidePlate(
      torso,
      M.joint,
      [
        [-6.0, 1.5],
        [-2.4, 2.6],
        [-2.4, 1.6],
        [-5.8, 0.9],
      ],
      0.6,
      0.06,
      s * 3.2,
    );
    piston(torso, M, [s * 2.4, 4.3, -3.9], [s * 2.4, 3.0, -5.6], 0.14);
  }
  // 絞碎滾筒：滾筒＋兩端輪轂＋螺旋排列的刀齒；外側的支臂
  const grinders = [];
  for (const s of [-1, 1]) {
    for (const z of [-3.75, 2.95]) P(torso, gBox(1.4, 0.5, 0.4), M.joint, s * 4.3, 2.4, z);
    const gr = new THREE.Group();
    gr.position.set(s * 5.0, 2.4, -0.4);
    torso.add(gr);
    P(gr, gCyl(0.95, 0.95, 6, 12), M.gun, 0, 0, 0, HP);
    for (const z of [-1.5, 0, 1.5]) P(gr, gCyl(1.0, 1.0, 0.2, 12), M.acc, 0, 0, z, HP);
    for (const z of [-3.0, 3.0]) P(gr, gCyl(1.1, 1.1, 0.25, 12), M.joint, 0, 0, z, HP);
    for (let k = 0; k < 8; k++)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + k * 0.38;
        PM(
          gr,
          gBox(0.24, 0.36, 0.42),
          M.sub,
          T(Math.cos(a) * 1.0, Math.sin(a) * 1.0, -2.6 + k * 0.74),
          RZ(a - HP),
        );
      }
    grinders.push(gr);
  }
  // 背面散熱口：兩片蓋板，打開時往上掀，露出發光的散熱器
  const heat = glow(0xff7a20, 0.3);
  P(torso, gBox(5.4, 2.0, 0.1), heat, 0, 3.8, 5.45);
  for (let i = 0; i < 6; i++) P(torso, gBox(0.12, 2.0, 0.14), M.joint, -2.5 + i, 3.8, 5.5);
  const vents = [];
  for (const s of [-1, 1]) {
    const v = new THREE.Group();
    v.position.set(s * 1.4, 4.9, 5.5);
    torso.add(v);
    PM(v, gPlate(cutRect(2.7, 2.2, 0.25, 0, -1.1), 0.3, 0.06, 1, 0.92), M.main2);
    for (let i = 0; i < 4; i++) P(v, gBox(2.2, 0.12, 0.1), M.sub, 0, -0.35 - i * 0.48, 0.18);
    P(v, gCyl(0.14, 0.14, 2.4, 8), M.joint, 0, 0, -0.05, 0, 0, HP);
    vents.push(v);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 6.4, -1.0);
  torso.add(hand);
  P(torso, gBox(0.6, 0.3, 0.6), M.joint, 0, 6.6, -0.7);
  P(hand, gCyl(0.1, 0.1, 1.0, 6), M.gun, 0, 0, -0.3, HP);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'dozer', height: 7 * scale, extra: { grinders, vents, heat } });
}
// 脈衝刃翼：細長機身＋四片刃翼（wings，會張開），胸口的珊瑚色核心在充能時變亮
// 切角放樣的機身與鳥喙形的頭部（感測點）、核心的環框與下顎、分節的尾刺；
// 刃翼＝羽毛狀後緣的刃板＋根部的副翼板＋前緣的發光條＋根部致動器
function buildIbis(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.6;
  root.add(torso);
  P(
    torso,
    gPod([
      [-1.5, 1.0, -0.6, 0.7, 0.3, 0.3],
      [-0.8, 1.2, -0.75, 0.8, 0.3, 0.3],
      [1.0, 1.2, -0.7, 0.8, 0.3, 0.3],
      [1.9, 0.8, -0.45, 0.55, 0.2, 0.2],
    ]),
    M.main,
  );
  P(
    torso,
    gPod([
      [-3.8, 0.1, 0.42, 0.5, 0.01, 0.01],
      [-2.8, 0.5, 0.4, 0.72, 0.12, 0.08],
      [-1.3, 0.8, 0.42, 0.9, 0.25, 0.1],
    ]),
    M.main3,
  );
  for (const s of [-1, 1])
    P(torso, gBox(0.04, 0.06, 0.5), glow(0xff6080, 1.8), s * 0.22, 0.62, -2.5, 0, -s * 0.15, 0);
  P(
    torso,
    gPod([
      [-0.9, 0.5, 0.75, 0.95, 0.12, 0.01],
      [0.6, 0.6, 0.75, 1.02, 0.14, 0.01],
    ]),
    M.sub,
  );
  const core = glow(0xff5070, 1.4);
  P(torso, gSph(0.42, 10), core, 0, 0, -1.6);
  P(torso, gCyl(0.5, 0.5, 0.12, 12), M.joint, 0, 0, -1.5, HP);
  P(
    torso,
    gPod([
      [-2.0, 0.6, -0.68, -0.42, 0.08, 0.12],
      [-1.3, 0.9, -0.72, -0.35, 0.12, 0.18],
    ]),
    M.sub,
  );
  // 尾刺
  P(torso, gCyl(0.3, 0.26, 0.5, 8), M.joint, 0, -0.2, 1.85, HP);
  P(torso, gCyl(0.24, 0.2, 0.5, 8), M.main2, 0, -0.2, 2.35, HP);
  P(torso, gCyl(0.18, 0.12, 0.45, 8), M.joint, 0, -0.2, 2.8, HP);
  P(torso, gCyl(0.1, 0.01, 0.4, 6), M.main3, 0, -0.2, 3.0, HP);
  const bladePts = [
    [-2.1, -0.5],
    [1.3, -0.56],
    [2.12, -0.26],
    [1.95, 0.08],
    [1.2, 0.52],
    [0.6, 0.32],
    [0.0, 0.58],
    [-0.6, 0.36],
    [-1.2, 0.6],
    [-2.1, 0.52],
  ];
  const bladeR = gPlate(bladePts, 0.12, 0.035),
    bladeL = gPlate(
      bladePts.map(([x, z]) => [-x, z]),
      0.12,
      0.035,
    );
  const edge = glow(0xff6080, 1.6);
  const cover = gPlate(cutRect(1.6, 0.9, 0.2), 0.2, 0.05, 0.9);
  const wings = [];
  for (const [sx, sy] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.6, sy * 0.3, 0.6);
    torso.add(w);
    const B = mx(T(sx * 2.2, 0, 0.2), RY(sx * 0.35), RZ(sy * 0.25));
    PM(w, sx > 0 ? bladeR : bladeL, M.main2, B, FLAT());
    PM(w, cover, M.main3, B, T(-sx * 1.2, sy * 0.05, -0.05), FLAT());
    PM(w, gBox(3.6, 0.05, 0.12), edge, B, T(sx * 0.1, 0, -0.56));
    P(w, gCyl(0.2, 0.2, 0.9, 8), M.joint, 0, 0, 0.2, HP);
    w.userData.sx = sx;
    w.userData.sy = sy;
    wings.push(w);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -2.0);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'ibis', height: 3.2 * scale, extra: { wings, core } });
}

const BUILDERS = {
  worm: buildWormHead,
  spider: buildSpider,
  fortress: buildFortress,
  bunker: buildBunker,
  cannon: buildCannon,
  fturret: buildFTurret,
  engine: buildEngine,
  pylon: buildPylon,
  joint: buildJoint,
  railgun: buildRailgun,
  bit: buildBit,
  loco: buildLoco,
  car_aa: buildCar('car_aa'),
  car_ms: buildCar('car_ms'),
  car_lz: buildCar('car_lz'),
  car_mine: buildCar('car_mine'),
  furnace: buildFurnace,
  tower: buildTower,
  jet: buildJet,
  dozer: buildDozer,
  ibis: buildIbis,
  ...FOE_BUILDERS, // 主題專屬敵人（foe-models.js）
};
export const BOSS_MODEL_KEYS = Object.keys(BUILDERS);
export function buildBossModel(key, pal, scale = 1) {
  return (BUILDERS[key] || buildJoint)(pal, scale);
}
