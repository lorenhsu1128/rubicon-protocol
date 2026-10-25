// 機甲庫的格納庫場景（docs/garage-hangar.md）：四種場景的建造、技師人偶、車輛、吊車、火花。
// 機體站在原點、面向 +Z（鏡頭那一側）；整備架在機體兩側與背後。純程式模型：
// 不會動的部分依材質合併成一個網格（不畫描邊外殼），會動的部分（吊車、技師、車輛、燈）是獨立的群組，
// 由 tickHangar 驅動。場景的物件不投影（天花板會擋住陽光），只有整備架與人偶投影。
import { gBox, gCyl, gSph, mergeGeos, P } from './geometry.js';

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
      const mesh = new THREE.Mesh(mergeGeos(list), m);
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
function buildTug(M, color) {
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
  return M;
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
      new THREE.PlaneGeometry(W * 2, Fz - Dz),
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
      coveredMech(st, M, x, kind === 'multi' ? -1.6 : -4.1);
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
    const cr = buildCrane(M, (W - 2) * 2, 12.2, [-6, 2]);
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
  } else if (kind === 'ship') {
    const W = 9,
      Dz = -8,
      Fz = 14,
      Ht = 9;
    const fl = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 2, Fz - Dz),
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
      B(st, std(0x6a3a2a, 0.8, 0.3), 2.2, 2.4, 3.8, -W + 1.5, 1.2, -4 + i * 4.4);
      B(st, std(0x2a4a6a, 0.8, 0.3), 2.2, 2.0, 3.8, -W + 1.5, 3.4, -4 + i * 4.4);
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
    const cr = buildCrane(M, (W - 3.2) * 2, Ht - 0.4, [-4, 1.5]);
    root.add(cr.g);
    H.cranes.push(cr);
    L.bg = 0x10151c;
    L.fog = [0x1a2028, 14, 34];
    L.sun = [0xe8f0ff, 1.35];
    L.hemi = [0xd8e8ff, 0x303a48, 0.8];
  } else if (kind === 'field') {
    // 野戰整備區：夜間、帆布帳篷、照明塔、補給車、沙包
    const gt = floorTex('#4a4238', 'rgba(60,52,40,0.0)', [20, 20], 19);
    const fl = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), std(0xffffff, 0.95, 0, { map: gt }));
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
      B(st, M.dark, 1.2, 1.0, 1.2, x, 0.5, z + 0.8); // 發電機
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
      B(st, std(0x5a5040, 0.85, 0.05), 1.0, 0.8, 1.0, x, 0.4, z);
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
          ['tab', [3.0, 0, 2.2], 5],
          ['walk', [3.2, 0, 5]],
          ['look', [3.2, 0, 5], 3],
          ['walk', [3.0, 0, 2.2]],
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
  for (const [suit, hat, tasks] of list) {
    const w = buildWorker(suit, hat);
    const p0 = tasks[0][1];
    w.g.position.set(p0[0], p0[1], p0[2]);
    root.add(w.g);
    H.workers.push({ ...w, tasks, ti: 0, tt: 0, yaw: 0 });
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
  const t = buildTug(H.M, kind === 'kits' ? 0xb8b8b8 : 0x5a6a48);
  const crate = new THREE.Mesh(
    gBox(0.9, 0.55, 0.8),
    std(kind === 'kits' ? 0xd8dcdc : 0x6a7a4a, 0.7, 0.1, { emissive: kind === 'kits' ? 0x300000 : 0x000000 }),
  );
  crate.position.set(0, 1.5, 0.6);
  t.g.add(crate);
  if (kind === 'kits') {
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
    if (m.map) m.map.dispose();
    m.dispose();
  }
  for (const tx of H.scroll) tx.dispose();
}
