// 機甲庫的格納庫場景（docs/garage-hangar.md）：四種場景的建造、技師人偶、車輛、吊車、火花。
// 機體站在原點、面向 +Z（鏡頭那一側）；整備架在機體兩側與背後。純程式模型：
// 不會動的部分依材質合併成一個網格（不畫描邊外殼），會動的部分（吊車、技師、車輛、燈）是獨立的群組，
// 由 tickHangar 驅動。場景的物件不投影（天花板會擋住陽光），只有整備架與人偶投影。
import { gBox, gCyl, gSph, mergeGeos, P } from './geometry.js';
import { HA, haChar, haProp, pbrMat, splitMeshY } from './hangar-assets.js';

const UP = new THREE.Vector3(0, 1, 0);
// 不改 alpha 的加色混合（後處理以 alpha 分辨機體與環境，加色的特效不能動到它）
export function glowMat(color, opacity = 1, o = {}) {
  const m = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: o.side || THREE.FrontSide,
  });
  keepAlpha(m);
  return m;
}
export function keepAlpha(m) {
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}
const std = (color, rough = 0.75, metal = 0.2, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o });

// ---------- 貼圖 ----------
function canvasTex(w, h, draw, rep = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rep[0], rep[1]);
  t.anisotropy = 4;
  return t;
}
// 亂數（場景的外觀固定，不用 Math.random）
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// 地板：面板格線＋污漬
function floorTex(base, line, rep, seed = 3) {
  return canvasTex(
    256,
    256,
    (g, w, h) => {
      const R = rng(seed);
      g.fillStyle = base;
      g.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(0,0,0,${0.03 + R() * 0.06})`;
        const r = 2 + R() * 18;
        g.beginPath();
        g.arc(R() * w, R() * h, r, 0, Math.PI * 2);
        g.fill();
      }
      g.strokeStyle = line;
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, w - 3, h - 3);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(w / 2, 0);
      g.lineTo(w / 2, h);
      g.moveTo(0, h / 2);
      g.lineTo(w, h / 2);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.05)';
      for (const [x, y] of [
        [12, 12],
        [w - 12, 12],
        [12, h - 12],
        [w - 12, h - 12],
      ]) {
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
    },
    rep,
  );
}
// 黃黑斜紋
function stripeTex(rep) {
  return canvasTex(
    128,
    32,
    (g, w, h) => {
      g.fillStyle = '#1a1a1a';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#d8a814';
      for (let x = -h; x < w + h; x += 32) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 16, h);
        g.lineTo(x + 16 + h, 0);
        g.lineTo(x + h, 0);
        g.fill();
      }
    },
    rep,
  );
}
// 舷窗外的雲海（自發光，會捲動）
function cloudTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#3a6ea8');
    gr.addColorStop(0.55, '#9cc0e0');
    gr.addColorStop(0.62, '#e8eef4');
    gr.addColorStop(1, '#c6d2de');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const R = rng(11);
    for (let i = 0; i < 90; i++) {
      const x = R() * w,
        y = h * (0.58 + R() * 0.4),
        r = 10 + R() * 40;
      g.fillStyle = `rgba(255,255,255,${0.25 + R() * 0.4})`;
      for (const dx of [-w, 0, w]) {
        g.beginPath();
        g.ellipse(x + dx, y, r * 1.8, r * 0.5, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

// ---------- 建造工具 ----------
const _q = new THREE.Quaternion(),
  _e = new THREE.Euler(),
  _a = new THREE.Vector3(),
  _b = new THREE.Vector3();
// 方塊（中心座標）
const B = (n, m, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) => P(n, gBox(w, h, d), m, x, y, z, rx, ry, rz);
// 兩點之間的桿子（方形截面）
function beam(n, m, a, b, t = 0.08) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  if (len < 1e-4) return;
  _q.setFromUnitVectors(UP, _b.clone().sub(_a).normalize());
  _e.setFromQuaternion(_q);
  P(n, gBox(t, len, t), m, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2, _e.x, _e.y, _e.z);
}
// 圓管
function pipe(n, m, a, b, r = 0.05) {
  _a.set(...a);
  _b.set(...b);
  const len = _a.distanceTo(_b);
  _q.setFromUnitVectors(UP, _b.clone().sub(_a).normalize());
  _e.setFromQuaternion(_q);
  P(n, gCyl(r, r, len, 8), m, (_a.x + _b.x) / 2, (_a.y + _b.y) / 2, (_a.z + _b.z) / 2, _e.x, _e.y, _e.z);
}
// 格子塔：四根柱子＋每段的斜撐
function lattice(n, m, x, z, w, d, h, seg = 0.9, t = 0.09) {
  const cs = [
    [x - w / 2, z - d / 2],
    [x + w / 2, z - d / 2],
    [x + w / 2, z + d / 2],
    [x - w / 2, z + d / 2],
  ];
  for (const [cx, cz] of cs) B(n, m, t * 1.3, h, t * 1.3, cx, h / 2, cz);
  const ns = Math.max(1, Math.round(h / seg));
  for (let i = 0; i < ns; i++) {
    const y0 = (i * h) / ns,
      y1 = ((i + 1) * h) / ns;
    for (let k = 0; k < 4; k++) {
      const [ax, az] = cs[k],
        [bx, bz] = cs[(k + 1) % 4];
      if (i % 2) beam(n, m, [ax, y0, az], [bx, y1, bz], t * 0.6);
      else beam(n, m, [bx, y0, bz], [ax, y1, az], t * 0.6);
      beam(n, m, [ax, y1, az], [bx, y1, bz], t * 0.7);
    }
  }
}
// 欄杆（沿 a → b）
function railing(n, m, a, b, h = 1.0, step = 1.2) {
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const k = Math.max(1, Math.round(len / step));
  for (let i = 0; i <= k; i++) {
    const f = i / k,
      x = a[0] + (b[0] - a[0]) * f,
      z = a[2] + (b[2] - a[2]) * f;
    B(n, m, 0.05, h, 0.05, x, a[1] + h / 2, z);
  }
  beam(n, m, [a[0], a[1] + h, a[2]], [b[0], b[1] + h, b[2]], 0.05);
  beam(n, m, [a[0], a[1] + h * 0.5, a[2]], [b[0], b[1] + h * 0.5, b[2]], 0.04);
}
// 依位置與法線投影貼圖座標（PBR 貼圖一格 tile 公尺，不隨方塊大小拉伸）
function boxUV(geo, tile) {
  const p = geo.attributes.position,
    n = geo.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) {
      u = p.getX(i);
      v = p.getZ(i);
    } else if (ax >= az) {
      u = p.getZ(i) * Math.sign(n.getX(i) || 1);
      v = p.getY(i);
    } else {
      u = -p.getX(i) * Math.sign(n.getZ(i) || 1);
      v = p.getY(i);
    }
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
// 平面的貼圖座標換成 w×h 公尺、一格 tile 公尺
function planeUV(geo, w, h, tile) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile);
  return geo;
}
// 群組的 prims 合併成每種材質一個網格（不畫描邊）
function bakeStatic(node, shadow = false) {
  node.traverse((o) => {
    const prims = o.userData.prims;
    if (!prims) return;
    const by = new Map();
    for (const p of prims) {
      if (!by.has(p.m)) by.set(p.m, []);
      by.get(p.m).push(p);
    }
    for (const [m, list] of by) {
      const geo = mergeGeos(list);
      if (m.userData.tile) boxUV(geo, m.userData.tile);
      const mesh = new THREE.Mesh(geo, m);
      mesh.receiveShadow = true;
      mesh.castShadow = shadow;
      o.add(mesh);
    }
    o.userData.prims = null;
  });
}

// ---------- 整備架（機體兩側的格子塔、走道、固定臂、頂梁） ----------
// 回傳 { g, clamps: [左, 右] }；clamps 是肩高的固定臂（會動）
function buildBed(M, o = {}) {
  const g = new THREE.Group();
  const st = new THREE.Group();
  g.add(st);
  const fr = o.frame || M.frame,
    dk = M.deck;
  const tx = o.tx || 2.15,
    tz = -0.95,
    th = o.h || 5.2;
  for (const s of [-1, 1]) {
    lattice(st, fr, s * tx, tz, 0.7, 0.7, th);
    // 走道（肩下）：在塔的前側，只有外側欄杆（不擋從前面看機體）
    const y = 2.35;
    B(st, dk, 1.45, 0.08, 1.5, s * (tx - 0.2), y, -0.45);
    railing(st, M.rail, [s * (tx + 0.52), y, -1.05], [s * (tx + 0.52), y, 0.3]);
    // 走道的支撐
    beam(st, fr, [s * (tx + 0.3), y - 0.05, 0.2], [s * (tx + 0.3), y - 1.2, -0.8], 0.07);
    // 梯子
    for (let k = 0; k < 2; k++) B(st, M.rail, 0.04, y, 0.04, s * (tx + 0.25 + k * 0.4), y / 2, -1.36);
    for (let r = 0.3; r < y; r += 0.3) B(st, M.rail, 0.44, 0.03, 0.03, s * (tx + 0.45), r, -1.36);
    // 塔頂的整備燈
    B(st, M.dark, 0.5, 0.18, 0.3, s * tx, th + 0.12, tz + 0.3);
    B(st, M.lamp, 0.42, 0.04, 0.22, s * tx, th + 0.02, tz + 0.3);
    // 塔腳的底座與管線
    B(st, M.dark, 1.0, 0.12, 1.0, s * tx, 0.06, tz);
    pipe(st, M.hose, [s * (tx - 0.3), 0.1, tz + 0.4], [s * (tx - 0.3), th - 0.4, tz + 0.4], 0.045);
  }
  // 頂梁與背後的固定框
  B(st, fr, tx * 2 + 0.7, 0.4, 0.5, 0, th + 0.25, tz);
  B(st, M.stripe, tx * 2 - 0.7, 0.12, 0.02, 0, th + 0.25, tz + 0.26);
  // 地上的整備位標線與升降板
  B(st, M.stripe, 3.4, 0.012, 0.18, 0, 0.006, 1.9);
  B(st, M.stripe, 3.4, 0.012, 0.18, 0, 0.006, -1.7);
  B(st, M.plate, 3.0, 0.01, 3.2, 0, 0.005, 0.1);
  bakeStatic(st, true);
  // 肩高的固定臂（第二期換裝時伸過來），平常收在塔邊
  const clamps = [-1, 1].map((s) => {
    const c = new THREE.Group();
    c.position.set(s * (tx - 0.35), 3.05, tz + 0.35);
    const arm = new THREE.Group();
    c.add(arm);
    B(arm, M.frame, 0.7, 0.16, 0.2, -s * 0.35, 0, 0);
    B(arm, M.dark, 0.18, 0.3, 0.3, -s * 0.72, 0, 0);
    B(arm, M.stripe, 0.5, 0.17, 0.01, -s * 0.35, 0, 0.11);
    bakeStatic(arm, true);
    c.userData.arm = arm;
    g.add(c);
    return c;
  });
  return { g, clamps };
}

// ---------- 技師人偶 ----------
// 高約 1.7 m；hip／肩是關節。suit＝工作服、hat＝安全帽
function buildWorker(suit, hat) {
  const g = new THREE.Group();
  const ms = std(suit, 0.85, 0),
    mh = std(hat, 0.5, 0.1),
    mk = std(0x2a2a2e, 0.9, 0),
    mf = std(0xd9b08c, 0.8, 0);
  const add = (p, geo, m, x, y, z) => {
    const me = new THREE.Mesh(geo, m);
    me.position.set(x, y, z);
    me.castShadow = true;
    p.add(me);
    return me;
  };
  const body = new THREE.Group();
  g.add(body);
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Group();
    l.position.set(s * 0.1, 0.86, 0);
    body.add(l);
    add(l, gBox(0.14, 0.78, 0.16), ms, 0, -0.4, 0);
    add(l, gBox(0.15, 0.1, 0.26), mk, 0, -0.81, 0.04);
    return l;
  });
  const torso = new THREE.Group();
  torso.position.y = 0.86;
  body.add(torso);
  add(torso, gBox(0.36, 0.56, 0.22), ms, 0, 0.3, 0);
  add(torso, gBox(0.37, 0.06, 0.23), mk, 0, 0.03, 0); // 腰帶
  add(torso, gBox(0.3, 0.2, 0.05), std(0xc8ccd0, 0.6, 0.2), 0, 0.42, 0.12); // 反光條
  const head = new THREE.Group();
  head.position.y = 0.66;
  torso.add(head);
  add(head, gSph(0.105, 10), mf, 0, 0.08, 0);
  const helm = add(
    head,
    new THREE.SphereGeometry(0.125, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
    mh,
    0,
    0.1,
    0,
  );
  helm.scale.set(1, 0.85, 1.1);
  add(head, gBox(0.27, 0.02, 0.14), mh, 0, 0.1, 0.07);
  const arms = [-1, 1].map((s) => {
    const a = new THREE.Group();
    a.position.set(s * 0.23, 0.54, 0);
    torso.add(a);
    add(a, gBox(0.1, 0.56, 0.11), ms, 0, -0.27, 0);
    add(a, gBox(0.09, 0.08, 0.09), mk, 0, -0.58, 0);
    return a;
  });
  // 手上的東西：平板、焊槍（依工作切換顯示）
  const tab = add(arms[0], gBox(0.2, 0.02, 0.14), std(0x111418, 0.4, 0.3), 0, -0.6, 0.1);
  const scr = add(tab, gBox(0.17, 0.005, 0.11), glowMat(0x58c8ff, 0.9), 0, 0.013, 0);
  scr.castShadow = false;
  const torch = add(arms[1], gBox(0.05, 0.05, 0.28), std(0x555a60, 0.5, 0.6), 0, -0.6, 0.12);
  const tip = add(torch, gSph(0.03, 6), glowMat(0x9fd8ff, 1), 0, 0, 0.16);
  tip.castShadow = false;
  return { g, body, legs, arms, torso, head, tab, torch, tip, ph: 0 };
}

// ---------- 車輛 ----------
function buildTug(M, color, noCargo) {
  if (HA.ready) {
    const r = buildTugRich(M, color, noCargo);
    if (r) return r;
  }
  const g = new THREE.Group();
  const st = new THREE.Group();
  g.add(st);
  const mb = std(color, 0.6, 0.3);
  B(st, mb, 1.5, 0.55, 2.4, 0, 0.55, 0);
  B(st, M.dark, 1.3, 0.7, 0.9, 0, 1.15, -0.55);
  B(st, M.glass, 1.2, 0.4, 0.02, 0, 1.25, -0.1);
  B(st, M.stripe, 1.52, 0.12, 0.02, 0, 0.45, 1.21);
  for (const [x, z] of [
    [-0.72, -0.8],
    [0.72, -0.8],
    [-0.72, 0.8],
    [0.72, 0.8],
  ])
    P(st, gCyl(0.28, 0.28, 0.22, 12), M.tire, x, 0.28, z, 0, 0, Math.PI / 2);
  // 後面的貨架與貨箱
  B(st, M.frame, 1.4, 0.06, 1.1, 0, 0.86, 0.6);
  B(st, std(0x5a6a48, 0.8, 0.1), 0.9, 0.5, 0.8, 0, 1.15, 0.6);
  bakeStatic(st, true);
  const beacon = new THREE.Mesh(gBox(0.16, 0.1, 0.16), glowMat(0xffa020, 1));
  beacon.position.set(0, 1.56, -0.55);
  g.add(beacon);
  return { g, beacon };
}

// 外部素材版的牽引車：塗裝鋼板的車身、防滾籠、座椅與方向盤、車燈、輪胎（Poly Haven 的 old_tyre），車頭朝 −Z
function buildTugRich(M, color, noCargo) {
  const mb = pbrMat('paint', color, { tile: 1.0, metal: 0.5, nk: 0.9 });
  if (!mb) return null;
  const g = new THREE.Group();
  const st = new THREE.Group();
  g.add(st);
  // 底盤與車身（前低後高的貨台）
  B(st, M.dark, 1.42, 0.22, 2.5, 0, 0.36, 0);
  B(st, mb, 1.5, 0.42, 1.0, 0, 0.66, -0.78); // 引擎蓋
  B(st, mb, 1.5, 0.12, 0.9, 0, 0.92, -0.86, 0, -0.12);
  B(st, M.dark, 1.3, 0.2, 0.06, 0, 0.62, -1.3); // 水箱護罩
  for (let i = 0; i < 6; i++) B(st, M.hose, 1.1, 0.025, 0.02, 0, 0.55 + i * 0.035, -1.335);
  B(st, mb, 1.5, 0.3, 1.5, 0, 0.62, 0.48); // 後段
  B(st, M.deck, 1.46, 0.05, 1.3, 0, 0.8, 0.55); // 貨台
  for (const s of [-1, 1]) {
    B(st, mb, 0.06, 0.24, 1.32, s * 0.73, 0.93, 0.55);
    B(st, M.dark, 0.25, 0.04, 0.5, s * 0.82, 0.36, -0.2); // 踏板
    B(st, mb, 0.32, 0.05, 0.75, s * 0.68, 0.72, -0.78); // 前輪擋泥板
    B(st, mb, 0.32, 0.05, 0.75, s * 0.68, 0.79, 0.85);
  }
  B(st, M.stripe, 1.52, 0.1, 0.02, 0, 0.68, 1.24);
  // 駕駛座、方向盤、防滾籠
  B(st, M.dark, 0.55, 0.12, 0.5, -0.25, 0.86, -0.15);
  B(st, M.dark, 0.55, 0.55, 0.1, -0.25, 1.15, 0.1);
  pipe(st, M.dark, [-0.25, 0.8, -0.55], [-0.25, 1.15, -0.4], 0.025);
  P(st, new THREE.TorusGeometry(0.17, 0.02, 6, 16), M.dark, -0.25, 1.18, -0.38, -0.9);
  for (const s of [-1, 1]) {
    pipe(st, M.rail, [s * 0.68, 0.8, -0.35], [s * 0.68, 1.9, -0.2], 0.035);
    pipe(st, M.rail, [s * 0.68, 0.8, 0.25], [s * 0.68, 1.9, 0.15], 0.035);
    pipe(st, M.rail, [s * 0.68, 1.9, -0.2], [s * 0.68, 1.9, 0.15], 0.035);
  }
  pipe(st, M.rail, [-0.68, 1.9, -0.2], [0.68, 1.9, -0.2], 0.035);
  pipe(st, M.rail, [-0.68, 1.9, 0.15], [0.68, 1.9, 0.15], 0.035);
  B(st, M.dark, 1.42, 0.04, 0.45, 0, 1.93, -0.03); // 頂棚
  pipe(st, M.hose, [0.55, 0.9, -0.35], [0.55, 1.75, -0.35], 0.045); // 排氣管
  bakeStatic(st, true);
  // 車燈
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff4d8 });
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(gCyl(0.07, 0.07, 0.04, 12), hl);
    h.rotation.x = Math.PI / 2;
    h.position.set(s * 0.55, 0.72, -1.29);
    g.add(h);
    const t2 = new THREE.Mesh(gBox(0.12, 0.08, 0.02), tl);
    t2.position.set(s * 0.6, 0.66, 1.25);
    g.add(t2);
  }
  // 輪胎（軸朝 X）
  for (const [x, z] of [
    [-0.66, -0.78],
    [0.66, -0.78],
    [-0.66, 0.85],
    [0.66, 0.85],
  ]) {
    const t = haProp('old_tyre');
    if (!t) continue;
    t.scale.setScalar(0.95);
    t.rotation.y = Math.PI / 2;
    t.position.set(x, 0, z);
    g.add(t);
    const hub = new THREE.Mesh(gCyl(0.15, 0.15, 0.17, 12), M.dark);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(x, 0.285, z);
    g.add(hub);
  }
  if (!noCargo) {
    const c = haProp('wooden_military_crate');
    if (c) {
      c.position.set(0, 0.83, 0.55);
      c.rotation.y = Math.PI / 2;
      c.scale.setScalar(0.95);
      g.add(c);
    }
  }
  const beacon = new THREE.Mesh(gCyl(0.07, 0.08, 0.12, 10), glowMat(0xffa020, 1));
  beacon.position.set(0.5, 2.01, -0.03);
  g.add(beacon);
  return { g, beacon };
}

// ---------- 天花板吊車 ----------
function buildCrane(M, span, railY, zr) {
  const g = new THREE.Group(); // 橋（沿 z 移動）
  const st = new THREE.Group();
  g.add(st);
  B(st, M.crane, span, 0.55, 0.5, 0, railY, 0);
  B(st, M.stripe, span - 1, 0.14, 0.02, 0, railY - 0.1, 0.26);
  for (const s of [-1, 1]) B(st, M.dark, 0.8, 0.5, 0.9, (s * span) / 2, railY, 0);
  bakeStatic(st);
  const trolley = new THREE.Group();
  trolley.position.y = railY - 0.45;
  g.add(trolley);
  const tt = new THREE.Group();
  trolley.add(tt);
  B(tt, M.dark, 0.9, 0.4, 0.8, 0, 0, 0);
  B(tt, M.crane, 0.6, 0.3, 0.6, 0, -0.3, 0);
  bakeStatic(tt);
  const cable = new THREE.Mesh(gCyl(0.025, 0.025, 1, 6), M.dark);
  cable.position.y = -0.5;
  trolley.add(cable);
  const hook = new THREE.Group();
  trolley.add(hook);
  const hk = new THREE.Group();
  hook.add(hk);
  B(hk, M.crane, 0.5, 0.35, 0.3, 0, 0, 0);
  B(hk, M.dark, 0.1, 0.35, 0.1, 0, -0.3, 0);
  bakeStatic(hk, true);
  return { g, trolley, cable, hook, railY, zr, z: zr[0], tz: zr[0], x: 0, tx: 0, drop: 2, tdrop: 2, wait: 3 };
}

// 外部素材的天車（Poly Haven 的 overhead_crane）：橋（依跨距拉長）＋捲揚機＋吊鉤（從捲揚機的網格切出來，會升降）；
// 介面和 buildCrane 相同（吊鉤的底＝railY − 1.5 − drop）
function buildCraneRich(M, span, railY, zr, kw) {
  const src = HA.glb.overhead_crane;
  const bn = src && src.scene.getObjectByName('overhead_crane');
  const wn = src && src.scene.getObjectByName('overhead_crane_winch');
  if (!bn || !wn) return null;
  src.scene.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(bn);
  const kx = span / (bb.max.x - bb.min.x),
    ky = Math.min(1.3, kx);
  const g = new THREE.Group();
  const bw = new THREE.Group();
  const br = bn.clone(true);
  br.applyMatrix4(bn.parent.matrixWorld);
  bw.add(br);
  bw.scale.set(kx, ky, ky);
  const cz = (bb.min.z + bb.max.z) / 2;
  bw.position.set(-((bb.min.x + bb.max.x) / 2) * kx, railY + 0.35 - bb.max.y * ky, -cz * ky);
  g.add(bw);
  // 捲揚機切成本體與吊鉤（中間的鋼索不要，改成會伸縮的）
  const keep = new THREE.Group(),
    hk = new THREE.Group();
  wn.traverse((o) => {
    if (!o.isMesh) return;
    const r = splitMeshY(o, -1.35, -2.35);
    keep.add(r.keep);
    hk.add(r.cut);
  });
  const kb = new THREE.Box3().setFromObject(keep),
    hb = new THREE.Box3().setFromObject(hk);
  const kc = kb.getCenter(new THREE.Vector3()),
    hc = hb.getCenter(new THREE.Vector3());
  const trolley = new THREE.Group();
  trolley.position.y = railY - 0.45;
  g.add(trolley);
  // 捲揚機的頂端貼在橋的下緣（照原檔的相對位置）
  const top = 0.8 + (kb.max.y - bb.max.y) * ky;
  keep.scale.setScalar(kw);
  keep.position.set(-kc.x * kw, top - kb.max.y * kw, -kc.z * kw);
  trolley.add(keep);
  const yk = top - (kb.max.y - kb.min.y) * kw + 0.05; // 鋼索的上端
  const hook = new THREE.Group();
  hk.scale.setScalar(kw);
  hk.position.set(-hc.x * kw, -hb.min.y * kw, -hc.z * kw);
  hook.add(hk);
  trolley.add(hook);
  const hh = (hb.max.y - hb.min.y) * kw;
  const cable = new THREE.Group();
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(gCyl(0.018 * kw, 0.018 * kw, 1, 6), M.hose);
    c.position.x = s * 0.07 * kw;
    cable.add(c);
  }
  trolley.add(cable);
  for (const o of [keep, hk, br])
    o.traverse((m) => {
      if (m.isMesh) m.castShadow = m.receiveShadow = true;
    });
  return {
    g,
    trolley,
    cable,
    hook,
    railY,
    zr,
    z: zr[0],
    tz: zr[0],
    x: 0,
    tx: 0,
    drop: 2,
    tdrop: 2,
    wait: 3,
    rich: { yk, hh },
  };
}

// ---------- 技師（外部素材：Quaternius 的人物，骨架動畫） ----------
// 手上的平板與焊槍掛在手腕的骨頭上（骨架的單位是公分：掛一個縮放回公尺的群組）
function buildCrewChar(type) {
  const C = haChar(type);
  if (!C) return null;
  C.g.updateMatrixWorld(true);
  const hold = (bone) => {
    const b = C.bone(bone);
    const h = new THREE.Group();
    if (!b) return h;
    const s = b.getWorldScale(new THREE.Vector3()).x || 1;
    h.scale.setScalar(1 / s);
    b.add(h);
    return h;
  };
  const hl = hold('Wrist.L'),
    hr = hold('Wrist.R');
  const tab = new THREE.Mesh(gBox(0.2, 0.014, 0.15), std(0x111418, 0.4, 0.3));
  tab.position.set(0, 0.08, 0.04);
  tab.rotation.set(0, 0, Math.PI / 2);
  const scr = new THREE.Mesh(gBox(0.17, 0.004, 0.12), glowMat(0x58c8ff, 0.9));
  scr.position.y = 0.009;
  tab.add(scr);
  hl.add(tab);
  const torch = new THREE.Group();
  const tb = new THREE.Mesh(gCyl(0.022, 0.026, 0.26, 8), std(0x555a60, 0.45, 0.7));
  tb.rotation.x = Math.PI / 2;
  torch.add(tb);
  const nz = new THREE.Mesh(gCyl(0.008, 0.016, 0.08, 6), std(0xb08040, 0.4, 0.8));
  nz.rotation.x = Math.PI / 2;
  nz.position.z = 0.16;
  torch.add(nz);
  const tip = new THREE.Mesh(gSph(0.025, 6), glowMat(0x9fd8ff, 1));
  tip.position.z = 0.21;
  torch.add(tip);
  torch.position.set(0, 0.09, 0.02);
  torch.rotation.x = -Math.PI / 2;
  hr.add(torch);
  const tipL = new THREE.PointLight(0x9fd0ff, 0, 3, 2);
  tip.add(tipL);
  C.act('Idle', 0);
  C.mixer.update(Math.random() * 2);
  return { g: C.g, C, tab, torch, tip, tipL, ph: 0, rich: true };
}

// ---------- 火花（一個 Points，回收使用） ----------
function buildSparks(n = 180) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3).fill(-999);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = keepAlpha(
    new THREE.PointsMaterial({
      color: 0xffcf7a,
      size: 0.035,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
    }),
  );
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const S = { pts, pos, vel: new Float32Array(n * 3), life: new Float32Array(n), n, i: 0 };
  return S;
}
export function emitSparks(S, p, dir, k = 5) {
  for (let j = 0; j < k; j++) {
    const i = S.i;
    S.i = (S.i + 1) % S.n;
    S.pos[i * 3] = p.x;
    S.pos[i * 3 + 1] = p.y;
    S.pos[i * 3 + 2] = p.z;
    const sp = 0.8 + Math.random() * 1.6;
    S.vel[i * 3] = (dir.x + (Math.random() - 0.5) * 1.4) * sp;
    S.vel[i * 3 + 1] = (dir.y + Math.random() * 0.9) * sp;
    S.vel[i * 3 + 2] = (dir.z + (Math.random() - 0.5) * 1.4) * sp;
    S.life[i] = 0.25 + Math.random() * 0.4;
  }
}
function tickSparks(S, dt) {
  for (let i = 0; i < S.n; i++) {
    if (S.life[i] <= 0) continue;
    S.life[i] -= dt;
    const o = i * 3;
    S.vel[o + 1] -= 9.8 * dt;
    S.pos[o] += S.vel[o] * dt;
    S.pos[o + 1] += S.vel[o + 1] * dt;
    S.pos[o + 2] += S.vel[o + 2] * dt;
    if (S.pos[o + 1] < 0.02 && S.vel[o + 1] < 0) {
      S.pos[o + 1] = 0.02;
      S.vel[o + 1] *= -0.3;
      S.vel[o] *= 0.5;
      S.vel[o + 2] *= 0.5;
    }
    if (S.life[i] <= 0) S.pos[o + 1] = -999;
  }
  S.pts.geometry.attributes.position.needsUpdate = true;
}

// ---------- 空氣中的浮塵（燈光裡看得到；外部素材版） ----------
function buildDust(n, w, h, d) {
  const R = rng(17);
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (R() - 0.5) * w;
    pos[i * 3 + 1] = R() * h;
    pos[i * 3 + 2] = (R() - 0.5) * d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = keepAlpha(
    new THREE.PointsMaterial({
      color: 0xfff0d8,
      size: 0.03,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return { pts, pos, n, w, h, d };
}
function tickDust(D, dt, t) {
  const p = D.pos;
  for (let i = 0; i < D.n; i++) {
    const o = i * 3;
    p[o] += Math.sin(t * 0.3 + i) * 0.05 * dt;
    p[o + 1] += (0.03 + Math.sin(i * 1.7) * 0.02) * dt;
    p[o + 2] += Math.cos(t * 0.25 + i * 0.7) * 0.05 * dt;
    if (p[o + 1] > D.h) p[o + 1] = 0;
  }
  D.pts.geometry.attributes.position.needsUpdate = true;
}

// ---------- 被帆布蓋住的機體（背景） ----------
function coveredMech(n, M, x, z, ry = 0, h = 3.3) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = ry;
  n.add(g);
  B(g, M.tarp, 1.5, h * 0.42, 1.1, 0, h * 0.74, 0);
  B(g, M.tarp, 0.7, 0.4, 0.7, 0, h * 1.02, 0);
  B(g, M.tarp, 1.9, 0.5, 0.9, 0, h * 0.86, 0);
  for (const s of [-1, 1]) {
    B(g, M.tarp, 0.45, h * 0.55, 0.55, s * 0.32, h * 0.27, 0);
    B(g, M.tarp, 0.35, h * 0.4, 0.4, s * 0.98, h * 0.6, 0);
  }
  B(g, M.dark, 0.06, 0.06, 1.2, 0, h * 0.95, 0.5);
  return g;
}

// ---------- 外部素材的佈置（HA.ready 時；docs/garage-hangar.md 的第四期） ----------
// 道具放在場景根（不合併；共用素材的幾何與材質）
function prop(H, name, x, y, z, ry = 0, s = 1, node) {
  const o = haProp(name, node);
  if (!o) return null;
  o.position.set(x, y, z);
  o.rotation.y = ry;
  o.scale.setScalar(s);
  H.root.add(o);
  return o;
}
// 不改 alpha 的一般混合（貼在地上、牆上的標線與文字）
function decalMat(tex, o = {}) {
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    roughness: o.rough != null ? o.rough : 0.75,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.SrcAlphaFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor;
  m.blendDstAlpha = THREE.OneFactor;
  return m;
}
function texCanvas(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 8;
  return t;
}
// 地上的整備位標線（w×d 公尺，每公尺 64 px）：外框、四角的斜紋、編號、箭頭、油漬
function bayDecalTex(w, d, num, o = {}) {
  const k = 64;
  return texCanvas(w * k, d * k, (g, W, D) => {
    const R = rng(num.charCodeAt(0) * 7 + 3);
    // 油漬與輪胎痕（很淡）
    for (let i = 0; i < 26; i++) {
      const x = R() * W,
        y = R() * D,
        r = 20 + R() * 90;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(10,8,6,${0.12 + R() * 0.18})`);
      gr.addColorStop(1, 'rgba(10,8,6,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    const col = o.color || 'rgba(232,190,40,0.92)';
    g.strokeStyle = col;
    g.lineWidth = 0.14 * k;
    g.strokeRect(0.25 * k, 0.25 * k, W - 0.5 * k, D - 0.5 * k);
    // 四角的黃黑斜紋
    const cs = 1.4 * k;
    for (const [cx, cy] of [
      [0.25 * k, 0.25 * k],
      [W - 0.25 * k - cs, 0.25 * k],
      [0.25 * k, D - 0.25 * k - cs],
      [W - 0.25 * k - cs, D - 0.25 * k - cs],
    ]) {
      g.save();
      g.beginPath();
      g.rect(cx, cy, cs, cs);
      g.clip();
      g.fillStyle = 'rgba(20,20,20,0.85)';
      g.fillRect(cx, cy, cs, cs);
      g.fillStyle = col;
      for (let x = -cs; x < cs * 2; x += 0.36 * k) {
        g.beginPath();
        g.moveTo(cx + x, cy + cs);
        g.lineTo(cx + x + 0.18 * k, cy + cs);
        g.lineTo(cx + x + 0.18 * k + cs, cy);
        g.lineTo(cx + x + cs, cy);
        g.fill();
      }
      g.restore();
    }
    // 編號（鏡頭那一側）
    g.fillStyle = 'rgba(236,236,230,0.85)';
    g.font = `900 ${1.6 * k}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(num, W / 2, D - 1.25 * k);
    g.font = `700 ${0.34 * k}px Arial, sans-serif`;
    g.fillText(o.sub || 'MAINTENANCE BAY — KEEP CLEAR', W / 2, D - 0.42 * k);
    // 往前的箭頭
    g.fillStyle = col;
    for (const s of [-1, 1]) {
      const x = W / 2 + s * (W / 2 - 1.2 * k),
        y = D / 2;
      g.beginPath();
      g.moveTo(x, y + 0.6 * k);
      g.lineTo(x - 0.35 * k, y);
      g.lineTo(x - 0.12 * k, y);
      g.lineTo(x - 0.12 * k, y - 0.7 * k);
      g.lineTo(x + 0.12 * k, y - 0.7 * k);
      g.lineTo(x + 0.12 * k, y);
      g.lineTo(x + 0.35 * k, y);
      g.fill();
    }
  });
}
function floorDecal(H, tex, w, d, x, z, ry = 0, y = 0.006) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), decalMat(tex));
  m.rotation.set(-Math.PI / 2, 0, ry);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  H.root.add(m);
  H.own.push(m);
  return m;
}
// 牆上的文字（模板印刷風）
function signTex(lines, o = {}) {
  const w = o.w || 1024,
    h = o.h || 256;
  return texCanvas(w, h, (g) => {
    if (o.bg) {
      g.fillStyle = o.bg;
      g.fillRect(0, 0, w, h);
    }
    if (o.stripe) {
      g.fillStyle = '#d8a814';
      g.fillRect(0, 0, w, h * 0.12);
      g.fillRect(0, h * 0.88, w, h * 0.12);
    }
    g.fillStyle = o.color || 'rgba(230,232,228,0.9)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const n = lines.length;
    lines.forEach((t, i) => {
      const big = i === 0;
      const fs = big ? h * (n > 1 ? 0.46 : 0.7) : h * 0.18;
      g.font = `${big ? 900 : 700} ${fs}px "Arial Black", Impact, Arial, sans-serif`;
      g.fillText(t, w / 2, n > 1 ? (big ? h * 0.38 : h * (0.38 + 0.36 * i)) : h / 2);
    });
  });
}
function wallSign(H, lines, w, h, x, y, z, ry, o = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat(signTex(lines, o), { rough: 0.6 }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  H.root.add(m);
  H.own.push(m);
  return m;
}
// 燈下的光束（加色、上亮下暗）
let CONE_TEX = null;
function coneMat(color, op) {
  if (!CONE_TEX)
    CONE_TEX = texCanvas(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.35, '#7a7a7a');
      gr.addColorStop(1, '#000000');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
  const m = glowMat(color, op, { side: THREE.DoubleSide });
  m.map = CONE_TEX;
  m.fog = false;
  return m;
}
function lightCone(H, x, y, z, r0, r1, h, color = 0xfff0d0, op = 0.09, dir) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, 24, 1, true), coneMat(color, op));
  m.renderOrder = 5;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  m.position.y = -h / 2;
  g.add(m);
  if (dir) g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  H.root.add(g);
  H.own.push(m);
  return g;
}
// 天花板吊下來的工業燈＋光束（top＝吊點的高度）
function hangLamp(H, x, top, z, chain = 1.2, cone = true, k = 1.6) {
  const L = prop(H, 'hanging_industrial_lamp', x, top - 1.355 * k - chain, z, 0, k);
  if (!L) return;
  pipe(H.stRoot, H.M.hose, [x, top, z], [x, top - chain - 0.3, z], 0.015);
  const y = top - chain - 1.355 * k;
  const b = new THREE.Mesh(gSph(0.08 * k, 10), H.M.bulb);
  b.position.set(x, y + 0.075 * k, z);
  H.root.add(b);
  if (cone) lightCone(H, x, y + 0.12 * k, z, 0.22 * k, 3.4, Math.min(9, y - 0.3), 0xfff0d0, 0.05);
}
// 牆上的點綴：配電箱、壁燈、管線、監視器（依牆的方向；nx／nz＝牆面朝向）
function wallKit(H, x, z, nx, nz, i) {
  const ry = Math.atan2(nx, nz);
  const R = rng(i * 31 + 7);
  const kind = i % 4;
  if (kind === 0) prop(H, 'utility_box_01', x + nx * 0.25, 0, z + nz * 0.25, ry, 1.1);
  if (kind === 1) {
    const p = prop(H, 'power_box_01', x + nx * 0.06, 1.5, z + nz * 0.06, ry, 1.2);
    if (p) p.rotation.y = ry;
  }
  if (kind === 2)
    prop(
      H,
      'modular_industrial_pipes_01',
      x + nx * 0.2,
      0,
      z + nz * 0.2,
      ry,
      1.6,
      'modular_industrial_pipes_01_pipe02',
    );
  if (kind === 3)
    prop(
      H,
      'exterior_aircon_unit',
      x + nx * 0.22,
      4.2,
      z + nz * 0.22,
      ry,
      1.4,
      R() < 0.5 ? 'exterior_aircon_unit' : 'exterior_aircon_unit_rusted',
    );
  prop(H, 'industrial_wall_lamp', x + nx * 0.08 + nz * 1.2, 3.4, z + nz * 0.08 - nx * 1.2, ry, 1.6);
}
// 一組地上的雜物（貨架、桶、箱子…；seed 決定組合）
function clutter(H, x, z, ry, seed) {
  const R = rng(seed);
  const c = Math.cos(ry),
    s = Math.sin(ry);
  const at = (dx, dz) => [x + dx * c + dz * s, z - dx * s + dz * c];
  const P2 = (name, dx, dz, y = 0, r = 0, sc = 1, node) => {
    const [px, pz] = at(dx, dz);
    return prop(H, name, px, y, pz, ry + r, sc, node);
  };
  const v = seed % 4;
  if (v === 0) {
    P2('worn_metal_rack', 0, 0);
    P2('cardboard_box_01', -0.1, 0, 0.04, 0.2, 0.9);
    P2('plastic_crate_02', 0.15, 0.05, 0.66, -0.1);
    P2('cardboard_box_01', 0.1, 0, 1.25, 1.5, 0.8);
    P2('worn_metal_rack', 0.95, 0);
    P2('metal_jerrycan_green', 0.8, 0, 0.04, 0.3);
    P2('metal_jerrycan_green', 1.1, 0, 0.04, 0.1);
    P2('plastic_crate_02', 0.95, 0, 1.25);
    P2('barrel_01', 2.0, 0.3, 0, R() * 6);
    P2('barrel_01', 2.6, 0.1, 0, R() * 6);
    P2('barrel_03', 2.3, 0.85, 0, R() * 6);
  } else if (v === 1) {
    P2('industrial_storage_cart', 0, 0);
    P2('metal_tool_chest', 0.2, 0, 1.38, 0.1);
    P2('old_military_compressor', 1.8, 0.2, 0, 1.5);
    P2('propane_tank', -1.2, 0.2);
    P2('propane_tank', -1.55, 0.05);
    P2('hand_truck', -1.4, 0.9, 0, 0.6);
  } else if (v === 2) {
    P2('wooden_military_crate', 0, 0);
    P2('wooden_military_crate', 0.05, 0.02, 0.465, 0.05);
    P2('wooden_military_crate', 1.35, 0.1, 0, -0.08);
    P2('old_military_crate', 1.2, 0.95, 0, 0.3, 1, 'old_military_crate_a');
    P2('cardboard_box_01', -0.9, 0.3, 0, 0.4);
    P2('cardboard_box_01', -0.9, 0.3, 0.34, 1.1, 0.9);
  } else {
    P2('portable_generator', 0, 0, 0, 0, 1.3);
    P2('barrel_03', 1.2, 0.2, 0, 1);
    P2('barrel_03', 1.85, 0.1, 0, 2);
    P2('barrel_01', 1.5, 0.75, 0, 3);
    P2('metal_jerrycan_green', -0.9, 0.2, 0, 0.5);
  }
}
// 基地格納庫（multi 也是）
function dressBase(H, M, st, W, Dz, Fz, Ht, multi) {
  const mid = (Fz + Dz) / 2;
  // 牆的下半段是混凝土
  B(st, M.concrete, W * 2, 3.6, 0.12, 0, 1.8, Dz + 0.26);
  B(st, M.concrete, W * 2, 3.6, 0.12, 0, 1.8, Fz - 0.26);
  for (const s of [-1, 1]) B(st, M.concrete, 0.12, 3.6, Fz - Dz, s * (W - 0.26), 1.8, mid);
  // 背牆的大門：捲門＋門框＋警示燈
  B(st, M.shutter, 8.6, 8.6, 0.06, 0, 4.4, Dz + 0.42);
  for (const s of [-1, 1]) {
    B(st, M.frame, 0.5, 9.4, 0.6, s * 4.7, 4.7, Dz + 0.5);
    const lt = new THREE.Mesh(gBox(0.3, 0.3, 0.2), glowMat(0xff3a20, 0.9));
    lt.position.set(s * 4.7, 9.7, Dz + 0.85);
    H.root.add(lt);
    H.beacons.push(lt);
  }
  wallSign(H, ['HANGAR 07'], 7.5, 1.9, 0, 11.6, Dz + 0.46, 0);
  wallSign(H, ['MECH MAINTENANCE', 'AUTHORIZED PERSONNEL ONLY'], 5.2, 1.3, 0, 9.95, Dz + 0.48, 0, {
    bg: 'rgba(20,24,28,0.85)',
    stripe: true,
  });
  // 側牆與前牆的人員門
  for (const s of [-1, 1]) {
    prop(H, 'rollershutter_door', s * (W - 0.32), 0, 9, (-s * Math.PI) / 2, 1.2, 'rollershutter_door');
    wallSign(H, [s < 0 ? 'A-WING' : 'B-WING'], 3.6, 0.9, s * (W - 0.33), 4.6, 2, (-s * Math.PI) / 2);
  }
  for (const x of [-W + 4, W - 4])
    prop(H, 'rollershutter_door', x, 0, Fz - 0.32, Math.PI, 1.2, 'rollershutter_door');
  // 牆上的點綴
  let i = 0;
  for (let z = Dz + 3; z < Fz - 1; z += 5) for (const s of [-1, 1]) wallKit(H, s * (W - 0.3), z, -s, 0, i++);
  for (let x = -W + 3; x < W - 2; x += 5.5) if (Math.abs(x) > 5.5) wallKit(H, x, Dz + 0.35, 0, 1, i++);
  for (let x = -W + 6; x < W - 2; x += 6) if (Math.abs(x) > 2) wallKit(H, x, Fz - 0.35, 0, -1, i++);
  // 背牆高處的管線
  for (let k = 0; k < 3; k++)
    pipe(st, k === 1 ? M.crane : M.dark, [-W, 9.9 + k * 0.32, Dz + 0.6], [W, 9.9 + k * 0.32, Dz + 0.6], 0.11);
  for (const s of [-1, 1])
    for (let k = 0; k < 2; k++)
      pipe(st, M.dark, [s * (W - 0.6), 7.6 + k * 0.3, Dz], [s * (W - 0.6), 7.6 + k * 0.3, Fz], 0.09);
  // 監視器
  for (const [x, z, ry] of [
    [-W + 0.4, Dz + 0.4, Math.PI * 0.75],
    [W - 0.4, Dz + 0.4, -Math.PI * 0.75],
    [-W + 0.4, Fz - 0.4, Math.PI * 0.25],
    [W - 0.4, Fz - 0.4, -Math.PI * 0.25],
  ])
    prop(H, 'security_camera_01', x, 6.8, z, ry, 1.6);
  // 天花板的吊燈與光束
  for (let z = Dz + 3; z < Fz - 1; z += 5)
    for (let x = -W + 4; x <= W - 4; x += multi ? 8 : 7.5) hangLamp(H, x, Ht - 0.9, z, 1.4, Math.abs(x) < 12);
  // 側牆高架走道下的日光燈
  for (const s of [-1, 1])
    for (let z = Dz + 2; z < Fz - 1; z += 4) {
      const f = prop(
        H,
        'mounted_fluorescent_lights',
        s * (W - 1.0),
        6.9,
        z,
        Math.PI / 2,
        1.8,
        'mounted_fluorescent_lights_a',
      );
      if (f) f.rotation.x = Math.PI;
    }
  // 地上的標線
  const bay = bayDecalTex(7, 7, '03');
  floorDecal(H, bay, 7, 7, 0, 0.2);
  if (multi)
    [-6.8, 6.8, -13.6].forEach((x, k) =>
      floorDecal(H, bayDecalTex(6, 7, ['02', '04', '01'][k]), 6, 7, x, 0.2),
    );
  else
    for (const x of [-8.5, 8.5])
      floorDecal(H, bayDecalTex(6, 6, x < 0 ? '02' : '04', { sub: 'STANDBY' }), 6, 6, x, -3.6);
  // 地上的雜物：靠牆
  const spots = multi
    ? [
        [-W + 2.2, -7.5, Math.PI / 2, 1],
        [W - 2.2, -7.5, -Math.PI / 2, 2],
        [-18, 7.5, 0, 3],
        [18, 7.5, Math.PI, 4],
        [-9.5, -8.6, 0, 6],
        [10, -8.6, 0, 7],
      ]
    : [
        [-W + 2.2, -7.2, Math.PI / 2, 1],
        [-W + 2.2, 6.5, Math.PI / 2, 2],
        [W - 2.6, 8.5, -Math.PI / 2, 3],
        [-5.6, -9.4, 0, 4],
        [7.2, -9.4, 0, 6],
        [-W + 2.4, 12, Math.PI / 2, 8],
        [W - 2.4, 13, -Math.PI / 2, 5],
      ];
  for (const [x, z, ry, sd] of spots) clutter(H, x, z, ry, sd);
  // 整備架旁的工具（避開鏡頭與換裝的開口）
  prop(H, 'tool_cart', -3.4, 0, -2.0, 0.4);
  prop(H, 'portable_welding_cart', 3.5, 0, -2.1, -0.5, 1.1);
  prop(H, 'metal_tool_chest', -4.7, 0, 2.6, 0.9, 1.3);
  prop(H, 'wetfloorsign_01', -2.8, 0, 3.6, 0.5, 1.3);
  prop(H, 'hand_truck', 5.3, 0, -1.2, -1.1);
  prop(H, 'propane_tank', 4.5, 0, -2.6);
  // 辦公桌與螢幕（左前）
  if (!multi) {
    prop(H, 'metal_office_desk', -W + 3.0, 0, 2.2, Math.PI / 2, 1.1);
    for (let k = 0; k < 2; k++) {
      B(st, M.dark, 0.06, 0.5, 0.8, -W + 2.85, 1.15, 1.7 + k * 0.95);
      const sc = new THREE.Mesh(
        new THREE.PlaneGeometry(0.72, 0.42),
        new THREE.MeshBasicMaterial({ color: 0x4ab0e0 }),
      );
      sc.position.set(-W + 2.9, 1.15, 1.7 + k * 0.95);
      sc.rotation.y = Math.PI / 2;
      H.root.add(sc);
      H.own.push(sc);
    }
  }
  // 局部的暖光（整備位）
  const pl = new THREE.PointLight(0xffd8a0, 0.55, 16, 2);
  pl.position.set(-3.5, 6, 3);
  H.root.add(pl);
  const pl2 = new THREE.PointLight(0xa8c8ff, 0.4, 18, 2);
  pl2.position.set(4, 7, -5);
  H.root.add(pl2);
}
// 運輸艦的格納庫
function dressShip(H, M, st, W, Dz, Fz, Ht) {
  // 彈射軌道的標線
  floorDecal(
    H,
    texCanvas(128, 1024, (g, w, h) => {
      g.fillStyle = 'rgba(220,40,30,0.85)';
      for (let y = 0; y < h; y += 96) {
        g.beginPath();
        g.moveTo(8, y + 60);
        g.lineTo(w / 2, y + 10);
        g.lineTo(w - 8, y + 60);
        g.lineTo(w - 8, y + 86);
        g.lineTo(w / 2, y + 36);
        g.lineTo(8, y + 86);
        g.fill();
      }
    }),
    2.2,
    Fz - 3,
    0,
    (Fz + 3) / 2,
    Math.PI,
    0.035,
  );
  floorDecal(
    H,
    bayDecalTex(7, 6, 'L1', { sub: 'CATAPULT DECK — STAND CLEAR', color: 'rgba(225,60,45,0.9)' }),
    7,
    6,
    0,
    0.2,
  );
  wallSign(H, ['CATAPULT', 'LAUNCH SEQUENCE ARMED WHEN LIT'], 4.6, 1.15, 0, 7.4, Fz - 0.36, Math.PI, {
    bg: 'rgba(30,8,8,0.85)',
    stripe: true,
  });
  wallSign(H, ['DECK 2'], 4, 1.1, -W + 0.34, 6.6, 4.5, Math.PI / 2);
  wallSign(H, ['CARGO'], 3, 0.8, 0, 6.9, Dz + 0.2, 0);
  // 天花板的日光燈
  for (let z = Dz + 1.5; z < Fz; z += 3)
    for (const x of [-2.6, 2.6]) {
      const f = prop(
        H,
        'mounted_fluorescent_lights',
        x,
        Ht - 0.15,
        z,
        0,
        2.2,
        'mounted_fluorescent_lights_d',
      );
      if (f) f.rotation.x = Math.PI;
    }
  // 牆上的管線與配電箱
  for (let k = 0; k < 4; k++)
    pipe(st, k % 2 ? M.crane : M.dark, [W - 0.35, 1.0 + k * 0.22, Dz], [W - 0.35, 1.0 + k * 0.22, Fz], 0.07);
  for (let z = Dz + 2.5; z < Fz - 1; z += 4.5) {
    prop(H, 'power_box_01', W - 0.32, 1.7, z + 2, -Math.PI / 2, 1.1);
    prop(H, 'industrial_wall_lamp', -W + 0.32, 3.2, z, Math.PI / 2, 1.5);
  }
  for (const z of [-6, 1, 8])
    prop(
      H,
      'modular_industrial_pipes_01',
      -W + 0.4,
      0,
      z,
      Math.PI / 2,
      1.8,
      'modular_industrial_pipes_01_pipe02',
    );
  prop(H, 'security_camera_01', -W + 0.5, 6.5, Dz + 0.5, Math.PI * 0.75, 1.5);
  prop(H, 'security_camera_01', W - 0.5, 6.5, Fz - 0.5, -Math.PI * 0.25, 1.5);
  // 貨物：右後方與左前方
  clutter(H, 6.2, -6.4, 0, 2);
  clutter(H, 6.5, 6.5, -Math.PI / 2, 4);
  clutter(H, -5.6, 10.5, Math.PI / 2, 1);
  prop(H, 'tool_cart', -3.4, 0, -2.0, 0.4);
  prop(H, 'portable_welding_cart', 3.5, 0, -2.1, -0.5, 1.1);
  prop(H, 'metal_tool_chest', 4.6, 0, -0.4, -1.3, 1.2);
  prop(H, 'wetfloorsign_01', -2.8, 0, 3.6, 0.5, 1.3);
  const pl = new THREE.PointLight(0xc8dcff, 0.5, 14, 2);
  pl.position.set(0, 6.5, 2);
  H.root.add(pl);
}
// 野戰整備區
function dressField(H, M, st) {
  // 照明塔的燈頭與光束（往整備位照）
  for (const s of [-1, 1]) {
    const x = s * 6.5,
      z = 4.5;
    for (const dx of [-0.45, 0.45]) {
      const l = prop(H, 'security_light', x + dx, 6.3, z - 0.1, Math.PI + s * 0.6, 1.6);
      if (l) l.rotation.x = -0.6;
    }
    const dir = new THREE.Vector3(-x, -6.0, -z - 0.5);
    lightCone(H, x - s * 0.1, 6.7, z - 0.4, 0.4, 3.2, 9.5, 0xffe2b0, 0.07, dir);
    const sp = new THREE.SpotLight(0xffe0b0, 1.4, 22, 0.42, 0.6, 1.5);
    sp.position.set(x, 6.9, z - 0.2);
    sp.target.position.set(0, 1.5, 0);
    H.root.add(sp, sp.target);
    prop(H, 'portable_generator', x + s * 0.4, 0, z + 1.4, s * 0.4, 1.5);
  }
  // 帳篷裡的吊燈
  hangLamp(H, -1.3, 6.4, 1.6, 0.2, true, 0.9);
  hangLamp(H, 1.3, 6.4, 1.6, 0.2, true, 0.9);
  // 路障與雜物
  for (let i = 0; i < 7; i++) {
    const a = 0.75 + i * 0.12;
    prop(H, 'concrete_road_barrier', Math.sin(a) * 12, 0, Math.cos(a) * 12, a + Math.PI / 2, 1.4);
    prop(H, 'concrete_road_barrier', -Math.sin(a) * 12, 0, Math.cos(a) * 12, -a + Math.PI / 2, 1.4);
  }
  clutter(H, -7.2, -1.2, Math.PI / 2, 2);
  clutter(H, 6.8, 0.6, -Math.PI / 2, 3);
  clutter(H, -6.8, -6.5, 0.3, 6);
  clutter(H, 7.5, -7.5, -0.2, 0);
  for (let k = 0; k < 4; k++) {
    const t = prop(H, 'old_tyre', 9.2 + (k % 2) * 0.1, 0.16 * k * 1.4 + 0.12, -1.6, 0, 1.4);
    if (t) t.rotation.x = Math.PI / 2;
  }
  prop(H, 'medical_box', -5.5, 0.82, -0.9, 0.4, 1.2);
  prop(H, 'tool_cart', -3.4, 0, -2.0, 0.4);
  prop(H, 'portable_welding_cart', 3.5, 0, -2.1, -0.5, 1.1);
  prop(H, 'metal_tool_chest', -4.4, 0, 2.6, 0.9, 1.3);
  prop(H, 'hand_truck', 4.8, 0, 2.4, -0.8);
  prop(H, 'metal_jerrycan_green', -3.8, 0, -2.6, 0.2);
  prop(H, 'metal_jerrycan_green', -3.45, 0, -2.75, 0.5);
  floorDecal(
    H,
    bayDecalTex(7, 7, 'F2', { sub: 'FORWARD MAINTENANCE', color: 'rgba(225,220,200,0.55)' }),
    7,
    7,
    0,
    0.2,
    0,
    0.01,
  );
}

// ---------- 材質組 ----------
function mats(kind) {
  const M = {
    frame: std(0x5d6670, 0.6, 0.55),
    deck: std(0x3b4148, 0.8, 0.4),
    rail: std(0xc89a28, 0.5, 0.4),
    dark: std(0x24282e, 0.7, 0.5),
    hose: std(0x1c1c1c, 0.9, 0.05),
    crane: std(0xd0a020, 0.55, 0.4),
    plate: std(0x30363c, 0.55, 0.6),
    wall: std(0x4a525c, 0.8, 0.3),
    wall2: std(0x3a4048, 0.85, 0.3),
    tarp: std(0x4f5a46, 0.95, 0),
    tire: std(0x161616, 0.95, 0),
    glass: std(0x8ab0c8, 0.15, 0.6, { emissive: 0x0c1820 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff2d8 }),
    stripe: std(0xffffff, 0.7, 0.1, { map: stripeTex([3, 1]) }),
  };
  if (kind === 'ship') {
    M.frame = std(0x6a7078, 0.5, 0.6);
    M.wall = std(0x5b6168, 0.6, 0.5);
    M.wall2 = std(0x444a52, 0.7, 0.5);
    M.rail = std(0xb02828, 0.5, 0.3);
  }
  if (kind === 'field') {
    M.frame = std(0xc89a28, 0.6, 0.35); // 黃色的鋼管鷹架
    M.deck = std(0x6a5a3a, 0.9, 0.05);
    M.rail = std(0xb8b8b0, 0.5, 0.5);
    M.tarp = std(0x5d6448, 0.95, 0, { side: THREE.DoubleSide });
  }
  if (HA.ready) richMats(M, kind);
  return M;
}
// 外部素材載入後：PBR 貼圖的材質（灰階貼圖×材質顏色決定色調；tile＝一格幾公尺）
function richMats(M, kind) {
  const put = (k, m) => m && (M[k] = m);
  const paint = (c, tile = 1.6, o = {}) => pbrMat('paint', c, { tile, metal: 0.55, nk: 0.8, ...o });
  put('frame', paint(kind === 'field' ? 0xd0a030 : kind === 'ship' ? 0x6e767f : 0x5c6670));
  put('dark', paint(0x3a3e44, 1.2));
  put('crane', paint(0xe0b030, 1.2));
  put('rail', paint(kind === 'ship' ? 0xc03030 : kind === 'field' ? 0xc0c0b8 : 0xe0b030, 0.8));
  put('deck', pbrMat('grate', kind === 'field' ? 0x8a7a60 : 0x9aa0a8, { tile: 1.2, metal: 0.8 }));
  put('plate', pbrMat('grate', 0x80868e, { tile: 1.0, metal: 0.8 }));
  put(
    'wall',
    pbrMat(kind === 'ship' ? 'wall_ship' : 'wall_corr', kind === 'ship' ? 0x9aa6b4 : 0xa8b0b8, {
      tile: 3,
      metal: 0.5,
    }),
  );
  put('wall2', paint(kind === 'ship' ? 0x5a626c : 0x50585f, 2));
  put(
    'tarp',
    pbrMat('canvas', 0x7a8058, {
      tile: 1.2,
      side: kind === 'field' ? THREE.DoubleSide : THREE.FrontSide,
      nk: 1.4,
    }),
  );
  put('concrete', pbrMat('concrete', 0xc8c8c8, { tile: 3 }));
  put('shutter', pbrMat('shutter', 0xc0c8d0, { tile: 2.4, metal: 0.4 }));
  put('container', pbrMat('container', 0xffffff, { tile: 2.5, metal: 0.5 }));
  put('sandbag', pbrMat('canvas', 0xb8a47c, { tile: 0.6, nk: 1.6 }));
  M.hose = std(0x1c1c1c, 0.75, 0.05);
  M.bulb = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
}

// ---------- 四種場景 ----------
// kind：base（基地格納庫）、ship（委託方運輸艦的格納庫）、field（前線的野戰整備區）、multi（多人：多個整備位）
export function buildHangar(kind) {
  const M = mats(kind);
  const root = new THREE.Group();
  root.name = 'hangar';
  const st = new THREE.Group(); // 不會動的部分
  root.add(st);
  const H = {
    kind,
    root,
    M,
    beds: [],
    workers: [],
    cars: [],
    cranes: [],
    beacons: [],
    scroll: [],
    lights: [],
    sparks: buildSparks(),
    t: 0,
    rich: HA.ready, // 用了外部素材（render/hangar-assets.js）
    own: [], // 自己的幾何與材質（disposeHangar 釋放）
    stRoot: st,
    bgBays: [], // 背景整備位（game/hangar.js 放機體）
  };
  root.add(H.sparks.pts);
  // 維修無人機（停在整備架的塔頂）
  H.drones = [-1, 1].map((s) => {
    const d = buildDrone(M);
    d.park = new THREE.Vector3(s * 2.15, 5.75, -0.6);
    d.g.position.copy(d.park);
    root.add(d.g);
    return d;
  });
  // 換裝用的機械臂（平常收在地板下）
  H.robots = [-1, 1].map((s) => {
    const r = buildRobot(M);
    r.g.position.set(s * 3.4, -3.4, 0.6);
    r.home = new THREE.Vector3(s * 3.4, 0, 0.6);
    r.g.visible = false;
    root.add(r.g);
    return r;
  });
  const bed = buildBed(M);
  root.add(bed.g);
  H.beds.push(bed);
  const L = {
    bg: 0x11151b,
    fog: [0x141920, 16, 46],
    sun: [0xfff4e0, 1.5],
    hemi: [0xffffff, 0x334455, 0.7],
  };
  if (kind === 'base' || kind === 'multi') {
    const W = kind === 'multi' ? 24 : 15,
      Dz = -11,
      Fz = 16,
      Ht = 15;
    // 地板（4 m 一格的面板）
    const fl = new THREE.Mesh(
      HA.ready
        ? planeUV(new THREE.PlaneGeometry(W * 2, Fz - Dz), W * 2, Fz - Dz, 4)
        : new THREE.PlaneGeometry(W * 2, Fz - Dz),
      (HA.ready && pbrMat('floor_base', 0xb4b8bc, { tile: 4, metal: 0.2 })) ||
        std(0xffffff, 0.85, 0.15, { map: floorTex('#3a3f45', 'rgba(15,18,22,0.9)', [W / 2, (Fz - Dz) / 4]) }),
    );
    fl.rotation.x = -Math.PI / 2;
    fl.position.z = (Fz + Dz) / 2;
    fl.receiveShadow = true;
    root.add(fl);
    // 牆：背牆有肋材與大門，兩側牆有窗帶
    B(st, M.wall, W * 2, Ht, 0.4, 0, Ht / 2, Dz);
    for (let x = -W; x <= W; x += 3) B(st, M.wall2, 0.5, Ht, 0.5, x, Ht / 2, Dz + 0.3);
    B(st, M.dark, 9, 9, 0.2, 0, 4.5, Dz + 0.25); // 大門
    for (let y = 1; y < 9; y += 1.0) B(st, M.wall2, 9, 0.08, 0.1, 0, y, Dz + 0.38);
    B(st, M.stripe, 9.4, 0.3, 0.05, 0, 9.15, Dz + 0.4);
    for (const s of [-1, 1]) {
      B(st, M.wall, 0.4, Ht, Fz - Dz, s * W, Ht / 2, (Fz + Dz) / 2);
      for (let z = Dz; z <= Fz; z += 4) B(st, M.wall2, 0.5, Ht, 0.5, s * (W - 0.3), Ht / 2, z);
      B(st, M.glass, 0.05, 1.2, Fz - Dz - 2, s * (W - 0.25), 10.5, (Fz + Dz) / 2);
      // 側牆的高架走道
      B(st, M.deck, 1.6, 0.1, Fz - Dz, s * (W - 1.0), 7.0, (Fz + Dz) / 2);
      railing(st, M.rail, [s * (W - 1.8), 7.05, Dz], [s * (W - 1.8), 7.05, Fz], 1.0, 2.4);
    }
    // 前面（鏡頭背後）的牆
    B(st, M.wall, W * 2, Ht, 0.4, 0, Ht / 2, Fz);
    // 天花板與桁架、燈條
    B(st, M.wall2, W * 2, 0.3, Fz - Dz, 0, Ht, (Fz + Dz) / 2);
    for (let z = Dz + 2; z < Fz; z += 4) {
      B(st, M.frame, W * 2, 0.6, 0.35, 0, Ht - 0.6, z);
      B(st, M.lamp, 3.2, 0.06, 0.4, -W / 2, Ht - 0.95, z);
      B(st, M.lamp, 3.2, 0.06, 0.4, W / 2, Ht - 0.95, z);
    }
    // 吊車的軌道
    for (const s of [-1, 1]) B(st, M.dark, 0.5, 0.6, Fz - Dz, s * (W - 2), 12.2, (Fz + Dz) / 2);
    // 地上的通道線
    for (const s of [-1, 1]) B(st, M.stripe, 0.2, 0.012, Fz - Dz - 2, s * 4.4, 0.006, (Fz + Dz) / 2);
    // 武器架（左牆）：幾把槍的剪影
    {
      const x = -W + 0.9;
      B(st, M.frame, 0.4, 5.0, 8.5, x, 2.5, -1);
      for (let i = 0; i < 5; i++) {
        const z = -4.6 + i * 1.8;
        B(st, M.dark, 0.35, 2.4 + (i % 2) * 0.6, 0.32, x + 0.45, 2.4, z);
        B(st, M.dark, 0.3, 0.5, 0.8, x + 0.45, 2.0, z + 0.3);
        B(st, M.stripe, 0.02, 0.1, 1.2, x + 0.22, 4.4, z);
      }
    }
    // 右邊：零件貨架與貨箱
    {
      const x = W - 1.5;
      for (let i = 0; i < 3; i++) {
        const z = -6 + i * 3.4;
        B(st, M.frame, 1.8, 0.1, 2.6, x, 1.6, z);
        B(st, M.frame, 1.8, 0.1, 2.6, x, 3.2, z);
        for (const [dx, dz] of [
          [-0.8, -1.2],
          [0.8, -1.2],
          [-0.8, 1.2],
          [0.8, 1.2],
        ])
          B(st, M.frame, 0.1, 4.6, 0.1, x + dx, 2.3, z + dz);
        B(st, std(0x5a6a48, 0.8, 0.1), 1.3, 1.1, 1.1, x, 0.55, z - 0.5);
        B(st, std(0x6b5a40, 0.85, 0.1), 1.1, 0.9, 1.0, x, 2.1, z + 0.5);
        B(st, std(0x4a5a6a, 0.6, 0.4), 1.2, 0.7, 1.6, x, 3.6, z);
      }
    }
    // 背景的整備位：蓋著帆布的機體
    const side = kind === 'multi' ? [14.4] : [-8.5, 8.5];
    for (const x of side) {
      const b2 = buildBed(M, { tx: 2.0 });
      b2.g.position.set(x, 0, kind === 'multi' ? -1.5 : -4);
      root.add(b2.g);
      if (H.rich) H.bgBays.push({ x, z: kind === 'multi' ? -1.5 : -4, ry: 0 });
      else coveredMech(st, M, x, kind === 'multi' ? -1.6 : -4.1);
    }
    if (kind === 'multi')
      // 隊友的整備位（game/hangar.js 的 hangarMates 依大廳的組裝放隊友的機體）
      for (const x of [-6.8, 6.8, -13.6]) {
        const b2 = buildBed(M);
        b2.g.position.set(x, 0, 0);
        root.add(b2.g);
        H.beds.push(b2);
      }
    // 吊車
    const cr =
      (H.rich && buildCraneRich(M, (W - 2) * 2, 12.2, [-6, 2], 1.15)) ||
      buildCrane(M, (W - 2) * 2, 12.2, [-6, 2]);
    root.add(cr.g);
    H.cranes.push(cr);
    // 搬運車在背景來回
    const tug = buildTug(M, 0xc8a020);
    root.add(tug.g);
    tug.g.position.set(-W + 3.5, 0, -7.5);
    H.cars.push({
      ...tug,
      path: [
        [-W + 3.5, -7.5],
        [W - 3.5, -7.5],
      ],
      i: 0,
      v: 2.4,
      yaw: 0,
      wait: 0,
    });
    H.beacons.push(tug.beacon);
    L.fog = [0x161b22, 20, 52];
    H.ceil = Ht;
    if (H.rich) dressBase(H, M, st, W, Dz, Fz, Ht, kind === 'multi');
  } else if (kind === 'ship') {
    const W = 9,
      Dz = -8,
      Fz = 14,
      Ht = 9;
    const fl = new THREE.Mesh(
      HA.ready
        ? planeUV(new THREE.PlaneGeometry(W * 2, Fz - Dz), W * 2, Fz - Dz, 3)
        : new THREE.PlaneGeometry(W * 2, Fz - Dz),
      (HA.ready && pbrMat('floor_ship', 0xb0b8c0, { tile: 3, metal: 0.7 })) ||
        std(0xffffff, 0.55, 0.55, {
          map: floorTex('#4a5058', 'rgba(20,24,28,0.9)', [W / 1.5, (Fz - Dz) / 3], 7),
        }),
    );
    fl.rotation.x = -Math.PI / 2;
    fl.position.z = (Fz + Dz) / 2;
    fl.receiveShadow = true;
    root.add(fl);
    // 彈射軌道（第三期出擊用）
    B(st, M.dark, 1.2, 0.03, Fz - 2.6, 0, 0.015, (Fz + 2.6) / 2 + 0.3);
    for (const s of [-1, 1]) B(st, M.stripe, 0.12, 0.035, Fz - 2.6, s * 0.7, 0.017, (Fz + 2.6) / 2 + 0.3);
    for (let z = 3; z < Fz; z += 1.5) B(st, M.lamp, 0.25, 0.04, 0.1, 0, 0.03, z);
    // 艙壁：拱形肋材
    for (let z = Dz; z <= Fz; z += 3) {
      for (const s of [-1, 1]) {
        B(st, M.frame, 0.6, Ht - 2, 0.5, s * (W - 0.3), (Ht - 2) / 2, z);
        beam(st, M.frame, [s * (W - 0.3), Ht - 2, z], [s * (W - 3), Ht, z], 0.5);
      }
      B(st, M.frame, (W - 3) * 2, 0.5, 0.5, 0, Ht, z);
    }
    for (const s of [-1, 1]) {
      B(st, M.wall, 0.3, Ht, Fz - Dz, s * W, Ht / 2, (Fz + Dz) / 2);
      // 天花板的斜面
      beam(st, M.wall2, [s * W, Ht - 1.8, (Fz + Dz) / 2], [s * (W - 3.2), Ht + 0.2, (Fz + Dz) / 2], 0.2);
    }
    B(st, M.wall2, (W - 3) * 2 + 0.6, 0.2, Fz - Dz, 0, Ht + 0.3, (Fz + Dz) / 2);
    B(st, M.wall, W * 2, Ht, 0.3, 0, Ht / 2, Dz);
    B(st, M.wall, W * 2, Ht, 0.3, 0, Ht / 2, Fz);
    // 前方（彈射口）的閘門：兩片門往上下打開，外面是天空（出擊演出）
    B(st, M.stripe, 6.4, 0.4, 0.05, 0, 6.4, Fz - 0.4);
    {
      const gct = cloudTex();
      H.scroll.push(gct);
      const sky = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), new THREE.MeshBasicMaterial({ map: gct }));
      sky.position.set(0, 3, Fz - 0.1);
      sky.rotation.y = Math.PI;
      root.add(sky);
      const doors = [0, 1].map((i) => {
        const d = new THREE.Mesh(gBox(6.2, 3.1, 0.25), M.wall2);
        d.position.set(0, i ? 4.55 : 1.55, Fz - 0.3);
        root.add(d);
        return d;
      });
      H.gate = { doors, y0: [1.55, 4.55] };
    }
    // 舷窗：右舷三扇，外面是雲海（捲動的貼圖）
    const ct = cloudTex();
    const win = new THREE.MeshBasicMaterial({ map: ct });
    H.scroll.push(ct);
    for (let i = 0; i < 4; i++) {
      const z = -5 + i * 4.5;
      const w = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), win);
      w.position.set(W - 0.18, 4.2, z);
      w.rotation.y = -Math.PI / 2;
      root.add(w);
      B(st, M.dark, 0.2, 2.2, 3.6, W - 0.12, 4.2, z);
      ct.repeat.set(0.35, 1);
    }
    // 左舷：貨櫃與管線
    for (let i = 0; i < 3; i++) {
      const cont = (c) => {
        if (!M.container) return std(c, 0.8, 0.3);
        const m = M.container.clone();
        m.color.set(c);
        H.own.push({ material: m });
        return m;
      };
      B(st, cont(H.rich ? 0xb05a40 : 0x6a3a2a), 2.2, 2.4, 3.8, -W + 1.5, 1.2, -4 + i * 4.4);
      B(st, cont(H.rich ? 0x4a78a8 : 0x2a4a6a), 2.2, 2.0, 3.8, -W + 1.5, 3.4, -4 + i * 4.4);
    }
    for (let k = 0; k < 4; k++)
      pipe(st, M.hose, [-W + 0.4, 6.5 + k * 0.25, Dz], [-W + 0.4, 6.5 + k * 0.25, Fz], 0.08);
    // 天花板的燈與旋轉警示燈
    for (let z = Dz + 1.5; z < Fz; z += 3) B(st, M.lamp, 2.4, 0.05, 0.3, 0, Ht + 0.18, z);
    for (const [x, z] of [
      [-W + 0.5, Dz + 0.6],
      [W - 0.5, Dz + 0.6],
      [-W + 0.5, Fz - 0.6],
      [W - 0.5, Fz - 0.6],
    ]) {
      const b = new THREE.Group();
      b.position.set(x, 6.8, z);
      const cone = new THREE.Mesh(gBox(0.5, 0.12, 0.12), glowMat(0xff3020, 0.9));
      cone.position.x = 0.2;
      b.add(cone);
      b.add(new THREE.Mesh(gCyl(0.14, 0.16, 0.24, 8), glowMat(0xff4030, 0.8)));
      root.add(b);
      H.beacons.push({ spin: b });
    }
    const cr =
      (H.rich && buildCraneRich(M, (W - 3.2) * 2, Ht - 0.4, [-4, 1.5], 0.72)) ||
      buildCrane(M, (W - 3.2) * 2, Ht - 0.4, [-4, 1.5]);
    root.add(cr.g);
    H.cranes.push(cr);
    if (H.rich) dressShip(H, M, st, W, Dz, Fz, Ht);
    L.bg = 0x10151c;
    L.fog = [0x1a2028, 14, 34];
    L.sun = [0xe8f0ff, 1.35];
    L.hemi = [0xd8e8ff, 0x303a48, 0.8];
  } else if (kind === 'field') {
    // 野戰整備區：夜間、帆布帳篷、照明塔、補給車、沙包
    const gt = floorTex('#4a4238', 'rgba(60,52,40,0.0)', [20, 20], 19);
    const fl = new THREE.Mesh(
      HA.ready ? planeUV(new THREE.PlaneGeometry(90, 90), 90, 90, 5) : new THREE.PlaneGeometry(90, 90),
      (HA.ready && pbrMat('ground', 0x9a9088, { tile: 5, nk: 1.5 })) || std(0xffffff, 0.95, 0, { map: gt }),
    );
    fl.rotation.x = -Math.PI / 2;
    fl.receiveShadow = true;
    root.add(fl);
    // 帳篷
    const ridge = 6.6,
      eave = 5.0,
      hx = 4.2,
      z0 = -2.8,
      z1 = 3.2;
    for (const x of [-hx, hx])
      for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 3) pipe(st, M.frame, [x, 0, z], [x, eave, z], 0.07);
    for (let z = z0; z <= z1 + 0.01; z += (z1 - z0) / 3) {
      pipe(st, M.frame, [-hx, eave, z], [0, ridge, z], 0.06);
      pipe(st, M.frame, [hx, eave, z], [0, ridge, z], 0.06);
    }
    pipe(st, M.frame, [0, ridge, z0], [0, ridge, z1], 0.06);
    const slope = Math.hypot(hx, ridge - eave),
      ang = Math.atan2(ridge - eave, hx);
    for (const s of [-1, 1])
      P(
        st,
        gBox(slope + 0.3, 0.03, z1 - z0 + 0.6),
        M.tarp,
        (s * hx) / 2,
        (ridge + eave) / 2 + 0.06,
        (z0 + z1) / 2,
        0,
        0,
        s * -ang,
      );
    B(st, M.tarp, hx * 2, eave, 0.03, 0, eave / 2, z0 - 0.05); // 背面的帆布
    // 照明塔
    for (const s of [-1, 1]) {
      const x = s * 6.5,
        z = 4.5;
      lattice(st, M.dark, x, z, 0.5, 0.5, 6.5, 1.1, 0.07);
      B(st, M.dark, 1.4, 0.8, 0.3, x, 6.9, z);
      B(st, M.lamp, 1.2, 0.6, 0.05, x - s * 0.02, 6.9, z - 0.17);
      if (!H.rich) B(st, M.dark, 1.2, 1.0, 1.2, x, 0.5, z + 0.8); // 發電機
    }
    // 補給車與貨箱、沙包牆
    for (const [x, z, ry, c] of [
      [-9, -3, 0.3, 0x55603e],
      [8.5, -4.5, -0.5, 0x4c5640],
    ]) {
      const t = buildTug(M, c);
      t.g.position.set(x, 0, z);
      t.g.rotation.y = ry;
      t.g.scale.setScalar(1.6);
      root.add(t.g);
      H.beacons.push(t.beacon);
    }
    for (let i = 0; i < 18; i++) {
      const a = -1.2 + i * 0.14;
      for (let r = 0; r < 3; r++)
        if (M.sandbag)
          P(
            st,
            gSph(0.5, 12),
            M.sandbag,
            Math.sin(a) * 13,
            0.15 + r * 0.26,
            -Math.cos(a) * 13,
            0,
            -a + (r % 2) * 0.07,
            0,
            0.78,
            0.3,
            0.44,
          );
        else
          B(
            st,
            std(0x8a7a58, 0.95, 0),
            0.75,
            0.28,
            0.42,
            Math.sin(a) * 13,
            0.15 + r * 0.28,
            -Math.cos(a) * 13,
            -a,
          );
    }
    for (const [x, z] of [
      [-5.5, -1],
      [-6.2, 0.2],
      [5.8, 0],
      [-5.6, 1.4],
    ])
      if (!H.rich) B(st, std(0x5a5040, 0.85, 0.05), 1.0, 0.8, 1.0, x, 0.4, z);
    if (H.rich) dressField(H, M, st);
    // 遠處的山稜（剪影）
    {
      const R = rng(5);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2,
          h = 4 + R() * 9,
          r = 46;
        B(st, std(0x10141a, 1, 0), 9, h, 3, Math.sin(a) * r, h / 2 - 1, Math.cos(a) * r, a);
      }
    }
    // 星空
    {
      const R = rng(9);
      const n = 400,
        pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2,
          e = 0.08 + R() * 1.3,
          r = 70;
        pos[i * 3] = Math.cos(e) * Math.sin(a) * r;
        pos[i * 3 + 1] = Math.sin(e) * r;
        pos[i * 3 + 2] = Math.cos(e) * Math.cos(a) * r;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const stars = new THREE.Points(
        g,
        keepAlpha(
          new THREE.PointsMaterial({ color: 0xc8d8ff, size: 1.6, sizeAttenuation: false, transparent: true }),
        ),
      );
      stars.material.fog = false;
      root.add(stars);
    }
    L.bg = 0x070b14;
    L.fog = [0x0a0f18, 18, 60];
    L.sun = [0xffd8a0, 1.6];
    L.hemi = [0x8aa0d0, 0x2a2418, 0.55];
  }
  // 技師（各場景的工作清單；座標避開機體與整備架）
  const crew = {
    base: [
      [
        0xd8742a,
        0xf0d020,
        [
          ['weld', [1.62, 2.43, -0.3], [0.95, 2.95, -0.25], 5],
          ['look', [1.9, 2.43, -0.1], 3],
        ],
      ],
      [
        0x3a5a8a,
        0xf2f2f2,
        [
          ['tab', [3.3, 0, 1.8], 6],
          ['walk', [3.6, 0, 3.6]],
          ['tab', [2.8, 0, 2.6], 4],
          ['walk', [3.3, 0, 1.8]],
        ],
      ],
      [
        0xd8742a,
        0xf0d020,
        [
          ['walk', [-3.4, 0, 2.4]],
          ['look', [-3.4, 0, 2.4], 3],
          ['walk', [-6.5, 0, -2]],
          ['look', [-11, 0, -2], 4],
          ['walk', [-5, 0, -5.5]],
        ],
      ],
      [
        0x6a6e72,
        0xf0d020,
        [
          ['weld', [-1.35, 0, 0.35], [-0.6, 0.45, 0.1], 4],
          ['look', [-1.6, 0, 1.6], 2],
        ],
      ],
    ],
    ship: [
      [
        0x2a3a5a,
        0xf2f2f2,
        [
          ['weld', [-1.62, 2.43, -0.3], [-0.95, 2.95, -0.25], 5],
          ['look', [-1.9, 2.43, -0.1], 3],
        ],
      ],
      [
        0x8a2a2a,
        0xf2f2f2,
        [
          ['tab', [4.3, 0, -0.8], 5],
          ['walk', [5.6, 0, 3.5]],
          ['look', [5.6, 0, 3.5], 3],
          ['walk', [4.3, 0, -0.8]],
        ],
      ],
      [
        0x2a3a5a,
        0xf0d020,
        [
          ['walk', [-4.5, 0, 3]],
          ['walk', [-4.5, 0, -5]],
          ['look', [-7, 0, -5], 4],
          ['walk', [-3, 0, -3]],
        ],
      ],
    ],
    field: [
      [
        0x5a6a3a,
        0xc8b070,
        [
          ['weld', [1.35, 0, 0.35], [0.6, 0.5, 0.1], 5],
          ['look', [1.4, 0, 1.8], 2],
        ],
      ],
      [
        0x5a6a3a,
        0xc8b070,
        [
          ['tab', [-3.2, 0, 2.2], 6],
          ['walk', [-5, 0, 3.8]],
          ['look', [-6.5, 0, 4.5], 3],
          ['walk', [-3.2, 0, 2.2]],
        ],
      ],
      [
        0x4a5a40,
        0xc8b070,
        [
          ['weld', [1.62, 2.43, -0.3], [0.95, 2.95, -0.25], 4],
          ['look', [1.9, 2.43, -0.1], 4],
        ],
      ],
      [
        0x5a6a3a,
        0xc8b070,
        [
          ['walk', [6, 0, -1]],
          ['walk', [7.5, 0, -3.5]],
          ['look', [8.5, 0, -4.5], 4],
          ['walk', [5, 0, 1.5]],
        ],
      ],
    ],
  };
  const list = crew[kind === 'multi' ? 'base' : kind];
  const who = {
    base: ['worker', 'worker', 'crew', 'worker'],
    multi: ['worker', 'worker', 'crew', 'worker'],
    ship: ['crew', 'crew', 'worker'],
    field: ['soldier', 'worker', 'soldier', 'soldier'],
  }[kind];
  for (const [i, [suit, hat, tasks]] of list.entries()) {
    const w = (H.rich && buildCrewChar(who[i])) || buildWorker(suit, hat);
    const p0 = tasks[0][1];
    w.g.position.set(p0[0], p0[1], p0[2]);
    root.add(w.g);
    H.workers.push({ ...w, tasks, ti: 0, tt: 0, yaw: 0 });
  }
  if (H.rich) {
    H.dust = buildDust(700, 16, 9, 12);
    H.root.add(H.dust.pts);
    H.own.push(H.dust.pts);
  }
  // 整備架的固定臂、走道的高度
  bakeStatic(st);
  H.light = L;
  return H;
}

const _v = new THREE.Vector3(),
  _d = new THREE.Vector3();
const angTo = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
// 技師：依工作清單走動、看平板、電焊（火花）
function tickWorker(H, w, dt) {
  if (w.rich) return tickCrew(H, w, dt);
  const T = w.tasks[w.ti];
  const [k, at] = T;
  const g = w.g;
  w.tt += dt;
  let walk = 0,
    weld = false;
  _v.set(at[0], at[1], at[2]);
  const dx = _v.x - g.position.x,
    dz = _v.z - g.position.z,
    dist = Math.hypot(dx, dz);
  if (dist > 0.05) {
    // 走過去（同一層才走；走道上的直接定位）
    const sp = 1.15 * dt;
    if (Math.abs(_v.y - g.position.y) > 0.3) g.position.copy(_v);
    else {
      g.position.x += (dx / dist) * Math.min(sp, dist);
      g.position.z += (dz / dist) * Math.min(sp, dist);
    }
    w.yaw += angTo(w.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
    walk = 1;
    w.tt = 0;
  } else {
    // 到了：面向工作的目標
    const look = k === 'weld' ? T[2] : k === 'look' ? [0, 0, 0] : [0, 0, 0];
    const ly = Math.atan2(look[0] - g.position.x, look[2] - g.position.z);
    w.yaw += angTo(w.yaw, ly) * Math.min(1, dt * 4);
    const dur = k === 'weld' ? T[3] : k === 'walk' ? 0 : T[2];
    weld = k === 'weld';
    if (w.tt >= (dur || 0)) {
      w.ti = (w.ti + 1) % w.tasks.length;
      w.tt = 0;
    }
  }
  g.rotation.y = w.yaw;
  w.ph += dt * (walk ? 7 : 2);
  const sw = walk ? Math.sin(w.ph) * 0.55 : 0;
  w.legs[0].rotation.x = sw;
  w.legs[1].rotation.x = -sw;
  w.arms[0].rotation.x = -sw * 0.6 + (k === 'tab' && !walk ? -1.0 : 0);
  w.arms[1].rotation.x = sw * 0.6 + (weld ? -1.25 + Math.sin(w.ph * 3) * 0.05 : 0);
  w.body.position.y = walk ? Math.abs(Math.sin(w.ph)) * 0.04 : 0;
  // 低處的焊接：蹲下
  const low = weld && T[2][1] < g.position.y + 1;
  w.torso.rotation.x = lerp(
    w.torso.rotation.x,
    low ? 0.5 : k === 'tab' && !walk ? 0.12 : 0,
    Math.min(1, dt * 5),
  );
  w.head.rotation.x = k === 'tab' && !walk ? 0.45 : low ? -0.3 : 0;
  w.tab.visible = k === 'tab' || walk;
  w.torch.visible = k === 'weld';
  w.tip.visible = weld && Math.random() < 0.8;
  if (weld && Math.random() < 0.7) {
    w.tip.getWorldPosition(_v);
    _d.set(0, 0, 1).applyQuaternion(g.quaternion);
    emitSparks(H.sparks, _v, _d, 2 + ((Math.random() * 3) | 0));
  }
}
const lerp = (a, b, k) => a + (b - a) * k;
// 外部素材的人物：走路／待機／操作（電焊）／看著機體；手上的平板與焊槍依工作顯示
function tickCrew(H, w, dt) {
  const T = w.tasks[w.ti];
  const [k, at] = T;
  const g = w.g;
  w.tt += dt;
  _v.set(at[0], at[1], at[2]);
  const dx = _v.x - g.position.x,
    dz = _v.z - g.position.z,
    dist = Math.hypot(dx, dz);
  let st = 'Idle';
  if (dist > 0.05) {
    const sp = 1.15 * dt;
    if (Math.abs(_v.y - g.position.y) > 0.3) g.position.copy(_v);
    else {
      g.position.x += (dx / dist) * Math.min(sp, dist);
      g.position.z += (dz / dist) * Math.min(sp, dist);
    }
    w.yaw += angTo(w.yaw, Math.atan2(dx, dz)) * Math.min(1, dt * 6);
    st = 'Walk';
    w.tt = 0;
  } else {
    const look = k === 'weld' ? T[2] : [0, 2, 0];
    w.yaw += angTo(w.yaw, Math.atan2(look[0] - g.position.x, look[2] - g.position.z)) * Math.min(1, dt * 4);
    const dur = k === 'weld' ? T[3] : k === 'walk' ? 0 : T[2];
    st = k === 'weld' ? 'Interact' : k === 'look' ? 'Idle_Neutral' : 'Idle';
    if (w.tt >= (dur || 0)) {
      w.ti = (w.ti + 1) % w.tasks.length;
      w.tt = 0;
    }
  }
  g.rotation.y = w.yaw;
  w.C.act(st);
  w.C.mixer.update(dt);
  const weld = st === 'Interact';
  w.tab.visible = k === 'tab';
  w.torch.visible = k === 'weld';
  const on = weld && Math.random() < 0.8;
  w.tip.visible = on;
  w.tipL.intensity = on ? 0.8 + Math.random() * 0.8 : 0;
  if (on && Math.random() < 0.7) {
    w.tip.getWorldPosition(_v);
    _d.set(0, 0, 1).applyQuaternion(g.quaternion);
    emitSparks(H.sparks, _v, _d, 2 + ((Math.random() * 3) | 0));
  }
}
// 每格更新（dt 秒、t 經過秒）
export function tickHangar(H, dt, t) {
  H.t = t;
  for (const w of H.workers) tickWorker(H, w, dt);
  tickSparks(H.sparks, dt);
  for (const c of H.cars) {
    const p = c.path[c.i];
    const dx = p[0] - c.g.position.x,
      dz = p[1] - c.g.position.z,
      d = Math.hypot(dx, dz);
    if (c.wait > 0) c.wait -= dt;
    else if (d < 0.1) {
      if (c.temp && c.i === c.path.length - 1) {
        c.done = true;
        continue;
      }
      c.i = (c.i + 1) % c.path.length;
      c.wait = c.temp ? 1.2 : 2.5;
      if (c.temp && c.onStop) c.onStop(c);
    } else {
      const ty = Math.atan2(-dx, -dz); // 車頭朝 −Z
      c.yaw += angTo(c.yaw, ty) * Math.min(1, dt * 2.5);
      const sp = Math.min(c.v * dt, d) * Math.max(0, Math.cos(angTo(c.yaw, ty)));
      c.g.position.x += (dx / d) * sp;
      c.g.position.z += (dz / d) * sp;
    }
    c.g.rotation.y = c.yaw;
  }
  for (const c of H.cars.filter((c) => c.done)) {
    H.root.remove(c.g);
    H.beacons = H.beacons.filter((b) => b !== c.beacon);
  }
  H.cars = H.cars.filter((c) => !c.done);
  for (const d of H.drones) tickDrone(d, dt, t);
  for (const b of H.beacons) {
    if (b.spin) b.spin.rotation.y = t * 3.2;
    else if (b.material) b.material.opacity = 0.35 + 0.65 * (Math.sin(t * 8) > 0 ? 1 : 0);
  }
  for (const tx of H.scroll) tx.offset.x = (t * 0.004) % 1;
  tickPuffs(H, dt);
  if (H.dust) tickDust(H.dust, dt, t);
  // 吊車：沒有工作時在軌道上慢慢換位置（第二期換裝時由 game/hangar.js 指定位置）
  for (const c of H.cranes) {
    if (!c.busy) {
      c.wait -= dt;
      if (c.wait <= 0) {
        c.tz = c.zr[0] + ((Math.sin(t * 0.37) + 1) / 2) * (c.zr[1] - c.zr[0]);
        c.tx = Math.sin(t * 0.23) * 4;
        c.tdrop = 1.5 + ((Math.sin(t * 0.5) + 1) / 2) * 3;
        c.wait = 6;
      }
    }
    if (!c.busy) {
      const k = Math.min(1, dt * 0.8);
      c.z += Math.max(-dt * 1.2, Math.min(dt * 1.2, (c.tz - c.z) * k * 4));
      c.x += Math.max(-dt * 1.2, Math.min(dt * 1.2, (c.tx - c.x) * k * 4));
      c.drop += Math.max(-dt * 1.5, Math.min(dt * 1.5, c.tdrop - c.drop));
    }
    c.g.position.z = c.z;
    c.trolley.position.x = c.x;
    if (c.rich) {
      const hy = -1.05 - Math.max(c.drop, c.rich.hh - 1.05 - c.rich.yk + 0.3);
      c.hook.position.y = hy;
      const bot = hy + c.rich.hh * 0.92;
      c.cable.scale.y = Math.max(0.01, c.rich.yk - bot);
      c.cable.position.y = (c.rich.yk + bot) / 2;
      continue;
    }
    c.cable.scale.y = Math.max(0.01, c.drop);
    c.cable.position.y = -0.45 - c.drop / 2;
    c.hook.position.y = -0.55 - c.drop;
  }
}
// ---------- 換裝用的機械臂：底座＋轉台＋兩節手臂＋夾爪；reach 以兩段骨頭的解析解讓夾爪到世界座標的一點 ----------
const RL1 = 1.6,
  RL2 = 1.5,
  RSH = 0.75;
function buildRobot(M) {
  const g = new THREE.Group();
  const base = new THREE.Group();
  g.add(base);
  P(base, gCyl(0.5, 0.6, 0.4, 12), M.dark, 0, 0.2, 0);
  B(base, M.stripe, 1.3, 0.02, 1.3, 0, 0.005, 0);
  bakeStatic(base, true);
  const turn = new THREE.Group();
  turn.position.y = 0.4;
  g.add(turn);
  const tt = new THREE.Group();
  turn.add(tt);
  P(tt, gCyl(0.38, 0.42, 0.3, 12), M.crane, 0, 0.15, 0);
  B(tt, M.crane, 0.3, 0.5, 0.4, 0, 0.45, 0);
  bakeStatic(tt, true);
  const sh = new THREE.Group();
  sh.position.y = RSH - 0.4;
  turn.add(sh);
  const l1 = new THREE.Group();
  sh.add(l1);
  B(l1, M.crane, 0.26, 0.3, RL1, 0, 0, RL1 / 2);
  P(l1, gCyl(0.2, 0.2, 0.4, 10), M.dark, 0, 0, 0, 0, 0, Math.PI / 2);
  pipe(l1, M.hose, [0.16, 0.1, 0.2], [0.16, 0.1, RL1 - 0.2], 0.03);
  bakeStatic(l1, true);
  const el = new THREE.Group();
  el.position.z = RL1;
  sh.add(el);
  const l2 = new THREE.Group();
  el.add(l2);
  B(l2, M.crane, 0.2, 0.24, RL2, 0, 0, RL2 / 2);
  P(l2, gCyl(0.16, 0.16, 0.34, 10), M.dark, 0, 0, 0, 0, 0, Math.PI / 2);
  bakeStatic(l2, true);
  const wr = new THREE.Group();
  wr.position.z = RL2;
  el.add(wr);
  const gw = new THREE.Group();
  wr.add(gw);
  B(gw, M.dark, 0.3, 0.3, 0.16, 0, 0, 0.05);
  bakeStatic(gw, true);
  const fingers = [-1, 1].map((s) => {
    const fg = new THREE.Group();
    fg.position.x = s * 0.1;
    wr.add(fg);
    const ff = new THREE.Group();
    fg.add(ff);
    B(ff, M.frame, 0.05, 0.1, 0.32, 0, 0, 0.28);
    bakeStatic(ff, true);
    return fg;
  });
  return { g, turn, sh, el, wr, fingers, grip: 0 };
}
// 夾爪到世界座標 p（g 的父節點是場景的根，沒有旋轉）
export function robotReach(r, p) {
  const lx = p.x - r.g.position.x,
    lz = p.z - r.g.position.z,
    ly = p.y - r.g.position.y - RSH;
  r.turn.rotation.y = Math.atan2(lx, lz);
  const rr = Math.hypot(lx, lz);
  const d = Math.max(0.3, Math.min(RL1 + RL2 - 0.02, Math.hypot(rr, ly)));
  const a2 = Math.acos(Math.max(-1, Math.min(1, (RL1 * RL1 + RL2 * RL2 - d * d) / (2 * RL1 * RL2))));
  const a1 =
    Math.atan2(ly, rr) +
    Math.acos(Math.max(-1, Math.min(1, (RL1 * RL1 + d * d - RL2 * RL2) / (2 * RL1 * d))));
  r.sh.rotation.x = -a1;
  r.el.rotation.x = Math.PI - a2;
  for (const [i, f] of r.fingers.entries()) f.position.x = (i ? 1 : -1) * (0.1 + 0.08 * (1 - r.grip));
}
// ---------- 維修無人機：四旋翼＋焊槍，會飛到受損處電焊 ----------
function buildDrone(M) {
  const g = new THREE.Group();
  const b = new THREE.Group();
  g.add(b);
  B(b, M.dark, 0.42, 0.14, 0.42, 0, 0, 0);
  B(b, M.crane, 0.3, 0.06, 0.3, 0, 0.09, 0);
  for (const [x, z] of [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ]) {
    beam(b, M.dark, [0, 0, 0], [x, 0.02, z], 0.04);
    P(b, gCyl(0.06, 0.06, 0.06, 8), M.dark, x, 0.04, z);
  }
  B(b, M.frame, 0.06, 0.06, 0.3, 0, -0.1, 0.18); // 焊槍
  bakeStatic(b, true);
  const rotors = [
    [-0.3, -0.3],
    [0.3, -0.3],
    [-0.3, 0.3],
    [0.3, 0.3],
  ].map(([x, z]) => {
    const r = new THREE.Mesh(gBox(0.32, 0.01, 0.04), glowMat(0x9aa4ae, 0.5));
    r.position.set(x, 0.08, z);
    g.add(r);
    return r;
  });
  const tip = new THREE.Mesh(gSph(0.035, 6), glowMat(0x9fd8ff, 1));
  tip.position.set(0, -0.1, 0.34);
  tip.visible = false;
  g.add(tip);
  const led = new THREE.Mesh(gSph(0.03, 6), glowMat(0x40ff80, 1));
  led.position.set(0, 0.0, -0.22);
  g.add(led);
  return { g, rotors, tip, led, yaw: 0 };
}
export function tickDrone(d, dt, t) {
  for (const [i, r] of d.rotors.entries()) r.rotation.y = t * 40 + i;
  d.g.position.y += Math.sin(t * 3 + d.park.x) * 0.002;
  d.led.visible = Math.sin(t * 6) > 0;
}
// ---------- 補給車：從場邊開到機體前面停一下再開回去（彈藥箱／修復套件箱） ----------
export function spawnCart(H, kind, side = 1) {
  const t = buildTug(H.M, kind === 'kits' ? 0xb8b8b8 : 0x5a6a48, true);
  let crate = H.rich && richCrate(kind);
  if (crate) t.g.add(crate);
  else
    crate = new THREE.Mesh(
      gBox(0.9, 0.55, 0.8),
      std(kind === 'kits' ? 0xd8dcdc : 0x6a7a4a, 0.7, 0.1, {
        emissive: kind === 'kits' ? 0x300000 : 0x000000,
      }),
    );
  if (!H.rich) {
    crate.position.set(0, 1.5, 0.6);
    t.g.add(crate);
  }
  if (kind === 'kits' && !H.rich) {
    const cr = new THREE.Mesh(gBox(0.5, 0.15, 0.02), glowMat(0xff3030, 1));
    cr.position.set(0, 1.55, 1.01);
    const cr2 = new THREE.Mesh(gBox(0.15, 0.5, 0.02), glowMat(0xff3030, 1));
    cr2.position.copy(cr.position);
    t.g.add(cr, cr2);
  }
  t.g.scale.setScalar(0.85);
  const a = [side * 7.5, 3.2],
    b = [side * 1.7, 2.1];
  t.g.position.set(a[0], 0, a[1]);
  H.root.add(t.g);
  const c = {
    ...t,
    crate,
    kind,
    path: [b, a],
    i: 0,
    v: 4.5,
    yaw: side > 0 ? -Math.PI / 2 : Math.PI / 2,
    wait: 0,
    temp: true,
    stops: 0,
  };
  c.g.rotation.y = c.yaw;
  H.cars.push(c);
  H.beacons.push(t.beacon);
  return c;
}
// 外部素材版的補給貨物：彈藥＝軍用木箱與鐵罐、修復套件＝醫療箱
function richCrate(kind) {
  const g = new THREE.Group();
  const add = (name, x, y, z, ry, s, node) => {
    const o = haProp(name, node);
    if (!o) return;
    o.position.set(x, y, z);
    o.rotation.y = ry;
    o.scale.setScalar(s);
    g.add(o);
  };
  if (kind === 'kits') {
    add('medical_box', 0, 0, -0.1, 0, 2.2);
    add('medical_box', 0.05, 0.22, -0.05, 0.1, 2.2);
    add('medical_box', -0.02, 0.44, -0.1, -0.08, 2.2);
  } else {
    add('wooden_military_crate', 0, 0, 0, Math.PI / 2, 0.95);
    add('old_military_crate', 0, 0.46, -0.1, Math.PI / 2, 1, 'old_military_crate_a');
  }
  g.position.set(0, 0.83, 0.55);
  return g;
}
// ---------- 出擊：天花板的開口（往上打開，外面是亮的天空） ----------
export function makeRoofHatch(H, w, d) {
  const g = new THREE.Group();
  g.position.y = H.ceil - 0.2;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0xdfeaf5 }));
  sky.rotation.x = Math.PI / 2;
  sky.position.y = -0.02;
  g.add(sky);
  const doors = [-1, 1].map((s) => {
    const m = new THREE.Mesh(gBox(w / 2, 0.2, d), H.M.wall2);
    m.position.set((s * w) / 4, -0.15, 0);
    g.add(m);
    return m;
  });
  H.root.add(g);
  return { g, sky, doors, w };
}
// ---------- 地板的開口：兩片門往兩側滑開，下面是黑的（地板下的東西本來就被地板擋住） ----------
export function makeHatch(H, x, z, w, d) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const hole = new THREE.Mesh(gBox(w, 0.01, d), new THREE.MeshBasicMaterial({ color: 0x030405 }));
  hole.position.y = 0.012;
  g.add(hole);
  const doors = [-1, 1].map((s) => {
    const m = new THREE.Mesh(gBox(w / 2, 0.04, d), H.M.plate);
    m.position.set((s * w) / 4, 0.03, 0);
    m.receiveShadow = true;
    g.add(m);
    const st = new THREE.Mesh(gBox(w / 2, 0.005, 0.12), H.M.stripe);
    st.position.set(0, 0.052, d / 2 - 0.08);
    m.add(st);
    return m;
  });
  H.root.add(g);
  return { g, hole, doors, w, k: 0 };
}
export function hatchOpen(h, k) {
  h.k = k;
  for (const [i, m] of h.doors.entries()) m.position.x = (i ? 1 : -1) * (h.w / 4 + (h.w / 2) * k * 0.98);
  h.hole.visible = k > 0.02;
}
export function removeHatch(H, h) {
  H.root.remove(h.g);
  h.hole.material.dispose();
}
// ---------- 蒸氣（白色煙團，不改 alpha） ----------
const PUFF_GEO = new THREE.SphereGeometry(1, 10, 6);
export function puff(H, p, n = 4, size = 0.35) {
  if (!H.puffs) H.puffs = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.MeshBasicMaterial({
      color: 0xe8eef2,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    m.blendSrcAlpha = THREE.ZeroFactor;
    m.blendDstAlpha = THREE.OneFactor;
    m.blending = THREE.CustomBlending;
    m.blendSrc = THREE.SrcAlphaFactor;
    m.blendDst = THREE.OneMinusSrcAlphaFactor;
    const me = new THREE.Mesh(PUFF_GEO, m);
    me.position.copy(p);
    me.scale.setScalar(size * 0.4);
    H.root.add(me);
    const a = Math.random() * Math.PI * 2;
    H.puffs.push({
      me,
      v: new THREE.Vector3(Math.cos(a) * 0.6, 0.5 + Math.random() * 0.6, Math.sin(a) * 0.6),
      t: 0,
      life: 0.9 + Math.random() * 0.5,
      size,
    });
  }
}
function tickPuffs(H, dt) {
  if (!H.puffs) return;
  H.puffs = H.puffs.filter((q) => {
    q.t += dt;
    const k = q.t / q.life;
    if (k >= 1) {
      H.root.remove(q.me);
      q.me.material.dispose();
      return false;
    }
    q.me.position.addScaledVector(q.v, dt);
    q.v.multiplyScalar(1 - dt * 1.5);
    q.me.scale.setScalar(q.size * (0.4 + k * 1.4));
    q.me.material.opacity = 0.45 * (1 - k);
    return true;
  });
}
export function disposeHangar(H) {
  H.root.traverse((o) => {
    if (o.isMesh || o.isPoints) {
      // gBox／gCyl 的快取幾何不釋放（只釋放合併出來的）
      if (o.geometry && o.geometry.attributes.onormal) o.geometry.dispose();
    }
  });
  for (const m of Object.values(H.M)) {
    if (m.map && !m.map.haShared) m.map.dispose();
    m.dispose();
  }
  for (const o of H.own) {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map && !o.material.map.haShared && o.material.map !== CONE_TEX) o.material.map.dispose();
      o.material.dispose();
    }
  }
  for (const tx of H.scroll) tx.dispose();
}
