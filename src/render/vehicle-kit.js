// 載具的零件（docs/model-detail.md）：車輪、履帶、車燈、後照鏡、排氣管、艙蓋、油桶、旋翼的轉動圓盤…
// 都畫進 geometry.js 的 P（之後 bakeAll 合併）；會動的車輪是自己的群組（回傳，放進 rig.wheels 讓 animateMech 轉動），
// 履帶帶子的材質有自己的貼圖（rig.treads，依移動距離捲動）。小細節包在 fine() 裡。
import { P as P0, fine as fine0, gBox } from './geometry.js';
import { D } from './detail.js';

const HP = Math.PI / 2;
// 兩種建模工具都能用：n 是群組（geometry.js 的 P，之後 bakeAll）或地圖物件的 PK（world/prop-models.js，有 geo 方法）
let SINK = null;
function P(n, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  if (n.geo) n.geo(m, geo, x, y, z, rx, ry, rz, sx, sy, sz);
  else P0(n, geo, m, x, y, z, rx, ry, rz, sx, sy, sz);
}
function fine(fn, dist) {
  if (SINK && SINK.fine) SINK.fine(fn, dist);
  else fine0(fn);
}
// 車輪群組：PK 沒有子群組，直接畫在 PK 裡（不會轉）
function wheelNode(parent, x, y, z) {
  if (parent.geo) return { pk: parent, x, y, z };
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// 在車輪節點裡畫（PK 時加上車輪的位置）
function PW(w, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  if (w.pk) w.pk.geo(m, geo, w.x + x, w.y + y, w.z + z, rx, ry, rz);
  else P0(w, geo, m, x, y, z, rx, ry, rz);
}
// fn 裡的零件畫到 n（PK 時 fine 走 PK 的）
function withSink(n, fn) {
  const prev = SINK;
  SINK = n.geo ? n : null;
  try {
    return fn();
  } finally {
    SINK = prev;
  }
}

// ---------- 貼圖 ----------
let TREAD = null,
  DISC = null;
// 履帶片：沿 u 一片一片（每 1 單位一片），中間的履齒亮一點
function treadImage() {
  if (TREAD) return TREAD;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 16;
  const x = c.getContext('2d');
  x.fillStyle = '#3a3c3f';
  x.fillRect(0, 0, 64, 16);
  x.fillStyle = '#55585c';
  x.fillRect(6, 0, 40, 16); // 履帶板
  x.fillStyle = '#6e7276';
  x.fillRect(18, 0, 10, 16); // 履齒
  x.fillStyle = '#1e1f21';
  x.fillRect(52, 0, 6, 16); // 銷與縫
  TREAD = c;
  return c;
}
// 旋翼高速轉動時的模糊圓盤：同心的淡環＋幾道放射的條紋
function discImage() {
  if (DISC) return DISC;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
  g.addColorStop(0, 'rgba(40,42,46,0)');
  g.addColorStop(0.15, 'rgba(40,42,46,0.55)');
  g.addColorStop(0.92, 'rgba(40,42,46,0.35)');
  g.addColorStop(0.97, 'rgba(200,190,120,0.6)'); // 葉尖的配重（黃）
  g.addColorStop(1, 'rgba(40,42,46,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 256, 256);
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 12; i++) {
    x.strokeStyle = `rgba(0,0,0,${0.15 + (i % 3) * 0.1})`;
    x.lineWidth = 2;
    x.beginPath();
    x.arc(128, 128, 30 + i * 8, 0, Math.PI * 2);
    x.stroke();
  }
  DISC = c;
  return c;
}
// 履帶帶子的材質：每台一份（貼圖的位移各自捲動），顏色同 rubber
export function treadMat(M) {
  const t = new THREE.CanvasTexture(treadImage());
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  const m = M.rubber.clone();
  m.color.set(0xb0b0b0);
  m.map = t;
  m.name = 'rubber';
  return m;
}

// ---------- 車輪 ----------
// 車輪群組（中心在 x, y, z，繞 X 轉）：輪胎（胎紋）＋碗形輪框＋螺帽＋輪轂蓋；side＝外側方向（+1／−1，預設依 x）
export function vWheel(parent, M, x, y, z, R, w, o = {}) {
  return withSink(parent, () => {
    const g = wheelNode(parent, x, y, z);
    const s = o.side || Math.sign(x) || 1;
    PW(g, D.tire(R, w, o.lugs ?? 16, o.depth ?? R * 0.07), M.rubber);
    PW(g, D.rim(R * 0.6, w * 0.92, 6, o.nuts ?? 6), o.rim || M.gun, 0, 0, 0, 0, s < 0 ? Math.PI : 0, 0);
    // 輪框內側的暗色（看起來有深度）
    PW(g, D.cyl(R * 0.56, R * 0.56, w * 0.3, 14), M.joint, -s * w * 0.12, 0, 0, 0, 0, HP);
    fine(() => PW(g, D.cyl(R * 0.13, R * 0.15, 0.05, 10), M.joint, s * (w * 0.47 + 0.02), 0, 0, 0, 0, HP));
    return g.pk ? null : g;
  });
}
// 負重輪（履帶用，比較薄、有橡膠圈與輪轂）
export function vRoadWheel(parent, M, x, y, z, R, w, s) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  P(g, D.cyl(R, R, w * 0.9, 16, 0.02), M.rubber, 0, 0, 0, 0, 0, HP);
  P(
    g,
    D.lathe(
      [
        [R * 0.86, w * 0.3],
        [R * 0.84, w * 0.5],
        [R * 0.4, w * 0.6],
        [0, w * 0.62],
      ],
      14,
    ),
    M.sub,
    0,
    0,
    0,
    0,
    0,
    -s * HP,
  );
  fine(() => {
    P(g, D.cyl(R * 0.22, R * 0.26, 0.06, 10), M.joint, s * w * 0.66, 0, 0, 0, 0, HP);
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      P(
        g,
        D.cyl(0.025, 0.025, 0.03, 6),
        M.joint,
        s * w * 0.6,
        Math.cos(a) * R * 0.32,
        Math.sin(a) * R * 0.32,
        0,
        0,
        HP,
      );
    }
  });
  return g;
}

// ---------- 履帶 ----------
// 一側的履帶（在 node 的座標）：x＝中心、zc＝前後中心、len＝長度（前＝−Z）、h＝高、w＝寬、nw＝負重輪數；
// 回傳 { wheels: [{ o, r }], mat }：wheels 放進 rig.wheels、mat 的貼圖放進 rig.treads
export function vTrack(node, M, x, zc, len, h, w, nw = 5, mat = null) {
  const s = Math.sign(x) || 1;
  const L = len / 2,
    th = 0.07; // 履帶片的厚度
  const rw = h * 0.27,
    rs = h * 0.27,
    ri = h * 0.25,
    rr = h * 0.09;
  const wheels = [];
  const circles = []; // [z, y, r]：履帶包住的圓
  for (let i = 0; i < nw; i++) {
    const z = zc - L + rs * 1.9 + (i * (len - rs * 3.8)) / (nw - 1);
    const y = rw + th;
    wheels.push({ o: vRoadWheel(node, M, x, y, z, rw, w * 0.62, s), r: rw });
    circles.push([z, y, rw + th * 0.5]);
  }
  // 驅動輪（前）：齒輪＋輪轂
  const sp = new THREE.Group();
  sp.position.set(x, h * 0.62, zc - L + rs);
  node.add(sp);
  P(sp, D.gear(rs, 11, w * 0.5), M.joint);
  P(sp, D.cyl(rs * 0.55, rs * 0.6, w * 0.7, 14, 0.02), M.sub, 0, 0, 0, 0, 0, HP);
  fine(() => P(sp, D.cyl(rs * 0.22, rs * 0.25, w * 0.85, 8), M.gun, 0, 0, 0, 0, 0, HP));
  wheels.push({ o: sp, r: rs });
  circles.push([zc - L + rs, h * 0.62, rs + th * 0.5]);
  // 惰輪（後）
  const id = vRoadWheel(node, M, x, h * 0.55, zc + L - ri, ri, w * 0.5, s);
  wheels.push({ o: id, r: ri });
  circles.push([zc + L - ri, h * 0.55, ri + th * 0.5]);
  // 托帶輪（上方）
  for (const t of [0.3, 0.7]) {
    const z = zc - L + len * t;
    const g = new THREE.Group();
    g.position.set(x, h - th - rr, z);
    node.add(g);
    P(g, D.cyl(rr, rr, w * 0.4, 10), M.rubber, 0, 0, 0, 0, 0, HP);
    wheels.push({ o: g, r: rr });
    circles.push([z, h - th - rr, rr + th * 0.5]);
  }
  // 履帶：包住所有圓的凸包，沿它掃出矩形截面
  const pts = [];
  for (const [z, y, r] of circles)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      pts.push([z + Math.cos(a) * r, y + Math.sin(a) * r]);
    }
  const hull = convexHull(pts);
  const path = resample(hull, 0.18).map(([z, y]) => [x, y, z]);
  const tm = mat || treadMat(M);
  const sec = [
    [-w / 2, -th / 2],
    [w / 2, -th / 2],
    [w / 2, th / 2],
    [-w / 2, th / 2],
  ];
  P(node, D.sweep(path, sec, true), tm);
  tm.map.repeat.set(1 / 0.3, 1);
  return { wheels, mat: tm };
}
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [],
    up = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  up.pop();
  lo.pop();
  return lo.concat(up);
}
// 封閉折線依長度重新取樣（每段最長 step），去掉太近的點
function resample(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out.filter((q, i) => i === 0 || Math.hypot(q[0] - out[i - 1][0], q[1] - out[i - 1][1]) > 0.02);
}

// ---------- 車體的小零件 ----------
// 頭燈（面朝 dir：0＝−Z 前、π＝+Z 後）：燈殼＋燈罩（發光材質 lm）＋護欄
export function vLight(n, M, lm, x, y, z, r = 0.12, ry = 0, guard = true) {
  withSink(n, () => {
    // 圓柱的軸（Y）先轉到 Z 再繞 Y 轉 ry
    const e = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(HP, ry, 0, 'YXZ')),
    );
    P(n, D.cyl(r * 1.25, r * 1.1, r * 0.9, 14, 0.015), M.joint, x, y, z, e.x, e.y, e.z);
    const dz = -Math.cos(ry) * r * 0.48,
      dx = -Math.sin(ry) * r * 0.48;
    P(n, D.cyl(r, r, 0.03, 14), lm, x + dx, y, z + dz, e.x, e.y, e.z);
    if (guard)
      fine(() => {
        for (const k of [-0.4, 0, 0.4])
          P(
            n,
            gBox(0.02, r * 2.2, 0.02),
            M.joint,
            x + dx * 1.6 + Math.cos(ry) * k * r,
            y,
            z + dz * 1.6 - Math.sin(ry) * k * r,
            0,
            ry,
            0,
          );
      });
  });
}
// 方形的燈（尾燈、方向燈）
export function vLamp(n, M, lm, x, y, z, w, h, ry = 0) {
  withSink(n, () => {
    P(n, D.box(w + 0.04, h + 0.04, 0.06, 0.012), M.joint, x, y, z, 0, ry, 0);
    P(n, D.box(w, h, 0.04, 0.008), lm, x - Math.sin(ry) * 0.02, y, z - Math.cos(ry) * 0.02, 0, ry, 0);
  });
}
// 後照鏡：支桿＋鏡殼（s＝左右）
export function vMirror(n, M, x, y, z, s, len = 0.35) {
  withSink(n, () => {
    fine(() => {
      P(n, D.cyl(0.015, 0.015, len, 6), M.joint, x + (s * len) / 2, y, z, 0, 0, HP);
      P(n, D.box(0.08, 0.3, 0.18, 0.02), M.joint, x + s * len, y - 0.05, z);
      P(n, gBox(0.01, 0.26, 0.14), M.lens, x + s * len - s * 0.045, y - 0.05, z);
    });
  });
}
// 排氣管（直立）：管＋頂端的斜口與防熱罩
export function vExhaust(n, M, x, y, z, h, r = 0.07) {
  withSink(n, () => {
    P(n, D.cyl(r, r, h, 12), M.gun, x, y + h / 2, z);
    P(n, D.cyl(r * 1.5, r * 1.5, h * 0.4, 12, 0.01), M.joint, x, y + h * 0.45, z);
    fine(() => {
      for (let i = 0; i < 4; i++)
        P(n, gBox(r * 3.1, 0.015, 0.02), M.sub, x, y + h * 0.3 + i * h * 0.06, z - r * 1.5);
    });
  });
}
// 艙蓋（圓形，頂面在 y）：蓋＋鉸鏈＋把手
export function vHatch(n, M, x, y, z, r = 0.24) {
  withSink(n, () => {
    P(n, D.cyl(r * 1.12, r * 1.15, 0.06, 18, 0.012), M.sub, x, y + 0.03, z);
    P(n, D.cyl(r, r * 0.98, 0.05, 18, 0.012), M.main3 || M.sub, x, y + 0.08, z);
    fine(() => {
      P(n, D.cyl(0.03, 0.03, r * 0.9, 8), M.joint, x, y + 0.09, z + r * 0.95, 0, 0, HP);
      P(n, D.cyl(0.012, 0.012, r * 0.6, 6), M.joint, x, y + 0.14, z - r * 0.2, 0, 0, HP);
      for (const k of [-1, 1]) P(n, gBox(0.02, 0.05, 0.02), M.joint, x + k * r * 0.3, y + 0.12, z - r * 0.2);
    });
  });
}
// 油桶（20 L 的方形桶，沿 Z 站立）
export function vJerry(n, M, m, x, y, z, ry = 0) {
  withSink(n, () => {
    P(n, D.box(0.17, 0.46, 0.34, 0.03), m, x, y + 0.23, z, 0, ry, 0);
    fine(() => {
      P(n, gBox(0.18, 0.06, 0.12), M.joint, x, y + 0.48, z, 0, ry, 0);
      P(n, D.cyl(0.03, 0.03, 0.06, 8), M.joint, x, y + 0.5, z + 0.1, 0, ry, 0);
    });
  });
}
// 工具箱（側面帶扣）
export function vBox(n, M, m, x, y, z, w, h, d, ry = 0) {
  withSink(n, () => {
    P(n, D.box(w, h, d, Math.min(0.03, h * 0.15)), m, x, y + h / 2, z, 0, ry, 0);
    fine(() => {
      P(n, gBox(w + 0.01, 0.03, d + 0.01), M.joint, x, y + h * 0.78, z, 0, ry, 0);
      // 前面（−Z，轉 ry）的兩個扣
      for (const k of [-0.3, 0.3]) {
        const kx = k * w,
          kz = -(d / 2 + 0.01);
        P(
          n,
          gBox(0.05, 0.08, 0.02),
          M.joint,
          x + Math.cos(ry) * kx + Math.sin(ry) * kz,
          y + h * 0.65,
          z - Math.sin(ry) * kx + Math.cos(ry) * kz,
          0,
          ry,
          0,
        );
      }
    });
  });
}
// 天線底座＋細桿（會被 rig.dmg 折彎的放在呼叫端的群組）
export function vAntenna(n, M, x, y, z, h) {
  withSink(n, () => {
    P(n, D.cyl(0.05, 0.065, 0.1, 10), M.joint, x, y + 0.05, z);
    fine(() => P(n, D.cyl(0.008, 0.012, h, 5), M.joint, x, y + 0.1 + h / 2, z), 120);
  });
}
// 旋翼的轉動圓盤（半透明、不寫深度；放在旋翼群組裡，旋翼轉動時顯示）
export function vRotorDisc(r) {
  const t = new THREE.CanvasTexture(discImage());
  const m = new THREE.MeshBasicMaterial({
    map: t,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0.85,
  });
  const g = new THREE.Mesh(new THREE.CircleGeometry(r, 48), m);
  g.rotation.x = -HP;
  g.renderOrder = 2;
  return g;
}

// ---------- 卡車的駕駛室 ----------
// 平頭的駕駛室（側面輪廓擠出）：後面在 z0、車頭在 z1（車頭朝 z1 的方向），寬 w、底 y0、頂 h；sl＝擋風玻璃的斜長（沿 z）
// o：{ body, glass, lamp, amber, grille（材質）, mirror, steps } ；M＝零件的材質（joint／rubber／gun／lens…）
export function vCab(n, M, z0, z1, w, y0, h, o) {
  withSink(n, () => {
    const fz = Math.sign(z1 - z0) || 1,
      L = Math.abs(z1 - z0),
      sl = o.sl ?? Math.min(0.5, L * 0.22),
      yb = y0 + (h - y0) * 0.45;
    const prof = [
      [0, y0],
      [L, y0],
      [L, yb],
      [L - sl, h],
      [0, h],
    ];
    // 擠出沿 Z、轉成寬度沿 X：u（往前）→ z0 + fz·u
    P(n, D.extrude(prof, w, 0.07), o.body, 0, 0, z0, 0, -fz * HP, 0);
    // 擋風玻璃
    const dz = -fz * sl,
      dy = h - yb,
      len = Math.hypot(dz, dy);
    const th = Math.atan2(-dy, dz);
    // 玻璃往外推一點（駕駛室的倒角會蓋住）：外側法線的 y、z 分量
    const oy = fz > 0 ? -dz / len : dz / len,
      oz = fz > 0 ? dy / len : -dy / len;
    const mz = z1 - fz * sl * 0.5,
      my = (yb + h) / 2;
    P(n, D.box(w - 0.3, 0.03, len - 0.14, 0.01), o.glass, 0, my + oy * 0.08, mz + oz * 0.08, th, 0, 0);
    // 側窗、門縫、把手
    const wz = z1 - fz * (sl + 0.55);
    for (const s of [-1, 1]) {
      P(n, D.box(0.03, (h - yb) * 0.72, 0.85, 0.01), o.glass, s * (w / 2 + 0.005), yb + (h - yb) * 0.5, wz);
      if (o.mirror !== false) vMirror(n, M, s * (w / 2), yb + 0.25, z1 - fz * 0.25, s, 0.3);
      fine(() => {
        P(n, gBox(0.02, h - y0 - 0.25, 0.02), M.joint, s * (w / 2 + 0.01), (y0 + h) / 2, wz - fz * 0.55);
        P(n, gBox(0.03, 0.04, 0.18), M.gun, s * (w / 2 + 0.02), yb + 0.05, wz - fz * 0.35);
        if (o.steps !== false)
          for (const y of [y0 - 0.15, y0 + 0.15])
            P(n, D.box(0.28, 0.04, 0.38, 0.01), M.gun, s * (w / 2 - 0.12), y, wz);
      });
    }
    // 正面：水箱護罩、頭燈、方向燈、保險桿
    const fzz = z1 + fz * 0.04;
    P(n, D.box(w * 0.55, (yb - y0) * 0.62, 0.06, 0.02), o.grille || M.joint, 0, y0 + (yb - y0) * 0.55, fzz);
    for (const s of [-1, 1]) {
      vLamp(n, M, o.lamp, s * w * 0.36, y0 + (yb - y0) * 0.35, fzz, w * 0.14, 0.18, fz > 0 ? 0 : Math.PI);
      if (o.amber)
        vLamp(n, M, o.amber, s * w * 0.45, y0 + (yb - y0) * 0.35, fzz, 0.1, 0.16, fz > 0 ? 0 : Math.PI);
    }
    P(n, D.box(w + 0.04, 0.3, 0.24, 0.05), M.joint, 0, y0 - 0.02, z1 + fz * 0.1);
    fine(() => {
      for (let i = 0; i < 5; i++)
        P(n, gBox(w * 0.5, 0.03, 0.04), M.gun, 0, y0 + (yb - y0) * (0.32 + i * 0.11), fzz + fz * 0.03);
    });
  });
}
// 火車的車輪（有輪緣的鋼輪，軸沿 X）
export function vRailWheel(parent, M, x, y, z, R, w, s = Math.sign(x) || 1) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  P0(
    g,
    D.lathe(
      [
        [0, -w / 2],
        [R * 0.9, -w / 2],
        [R, -w * 0.3],
        [R, w * 0.3],
        [R * 1.12, w * 0.4], // 輪緣（內側）
        [R * 1.12, w / 2],
        [R * 0.45, w * 0.6],
        [0, w * 0.6],
      ],
      18,
    ),
    M.gun,
    0,
    0,
    0,
    0,
    0,
    s * HP, // 輪緣在內側
  );
  return g;
}
