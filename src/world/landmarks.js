// 地標：每個區段放一個只出現一次的大型物件，讓區段之間好認（主線的排程保證同一章不重複；自由出擊不放）。
// 網格建造是純函式（不呼叫亂數，尺寸固定）；原點在地面中心，+Z 為正面。放置由 World.addLandmark 處理。
// 欄位：name、build()、bx＝局部外框 [x0, x1, z0, z1]（findSpot 用）、range＝容許的地面高低差、
//       sink＝往地面下沉的深度、shapes＝局部碰撞形狀（box 的 y／top 相對原點；circle 的 h）
import { WS } from '../core/scale.js';
import { D } from '../render/detail.js';
import { bakeGroup, box, cyl, mat } from './prop-models.js';

const M = {
  hull: mat(0x6c7176),
  hullD: mat(0x4a4e52),
  rust: mat(0x8a5a36, { roughness: 0.85 }),
  rustD: mat(0x5e3e28, { roughness: 0.9 }),
  steel: mat(0x9aa0a6, { metalness: 0.5 }),
  yellow: mat(0xc8a040),
  orange: mat(0xc06a30),
  concrete: mat(0x9a948a, { roughness: 0.95, metalness: 0.02 }),
  dark: mat(0x2a2c2e),
  glow: new THREE.MeshStandardMaterial({ color: 0xff8a30, emissive: 0xff6a10, emissiveIntensity: 1.6 }),
  crystal: new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.1,
    flatShading: true,
  }),
  dish: new THREE.MeshStandardMaterial({ color: 0x6c7176, side: THREE.DoubleSide, flatShading: true }),
  window: new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x4080b0, emissiveIntensity: 0.5 }),
  blue: mat(0x2b4fb0, { roughness: 0.7 }),
  red: mat(0xb83a2a, { roughness: 0.7 }),
  green: mat(0x3a7a4a, { roughness: 0.7 }),
  white: mat(0xd8d8d0, { roughness: 0.6 }),
};

const group = (...ch) => {
  const g = new THREE.Group();
  for (const c of ch) g.add(c);
  return g;
};
const rot = (o, x = 0, y = 0, z = 0) => {
  o.rotation.set(x, y, z);
  return o;
};

// ---------- 地標的造型工具（舊尺度；建好之後 bakeGroup 合併成精細版，docs/model-detail.md）----------
const HP = Math.PI / 2;
const mesh = (geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = o.receiveShadow = true;
  return o;
};
// 固定種子的亂數（建模是純函式：同一個地標每次長得一樣）
function lcg(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}
const darker = new Map();
// 材質的暗色版（接縫、燒焦、陰影處）
function dk(m, k = 0.55) {
  const key = m.uuid + k;
  let d = darker.get(key);
  if (!d) darker.set(key, (d = mat(m.color.clone().multiplyScalar(k).getHex(), { roughness: 0.85 })));
  return d;
}
// 板金的箱體：倒角的箱子＋側面的水平接縫（每 sp）＋一排鉚釘
function plated(g, w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0, sp = 2.4) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  o.add(mesh(D.box(w, h, d, Math.min(0.25, Math.min(w, h, d) * 0.12)), m));
  const sm = dk(m);
  for (let yy = -h / 2 + sp; yy < h / 2 - sp * 0.4; yy += sp) {
    for (const s of [-1, 1]) {
      o.add(mesh(D.box(w * 0.96, 0.08, 0.06, 0.01), sm, 0, yy, s * (d / 2 + 0.02)));
      o.add(mesh(D.box(0.06, 0.08, d * 0.96, 0.01), sm, s * (w / 2 + 0.02), yy, 0));
    }
  }
  for (let xx = -w / 2 + 0.6; xx < w / 2 - 0.3; xx += 0.9)
    for (const s of [-1, 1])
      o.add(mesh(D.cyl(0.06, 0.06, 0.06, 6), sm, xx, h / 2 - 0.3, s * (d / 2 + 0.02), HP));
  return o;
}
// 兩點之間的樑
function bar(g, m, a, b, t = 0.3) {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const L = v.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize());
  const o = mesh(D.box(t, L, t, t * 0.15), m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  o.quaternion.copy(q);
  g.add(o);
  return o;
}
// 格子塔：四支腳（往上收窄）＋每層的橫樑與 X 斜撐
function lattice(g, m, w0, w1, h, x, z, levels = 5, t = 0.35) {
  const P = (u, sx, sz) => {
    const w = (w0 + (w1 - w0) * u) / 2;
    return [x + sx * w, u * h, z + sz * w];
  };
  const C = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  for (const [sx, sz] of C) bar(g, m, P(0, sx, sz), P(1, sx, sz), t);
  for (let i = 0; i <= levels; i++) {
    const u = i / levels,
      u2 = (i + 1) / levels;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = C[c],
        [bx, bz] = C[(c + 1) % 4];
      bar(g, m, P(u, ax, az), P(u, bx, bz), t * 0.7);
      if (i < levels) {
        bar(g, m, P(u, ax, az), P(u2, bx, bz), t * 0.5);
        bar(g, m, P(u, bx, bz), P(u2, ax, az), t * 0.5);
      }
    }
  }
}
// 圓管（沿折線）
const pipe = (g, m, pts, r = 0.5) => g.add(mesh(D.sweep(pts, D.ring(r, 10)), m));
// 儲槽：圓頂的槽身＋補強環＋外側的爬梯
function tank(g, m, r, h, x, z, y = 0) {
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [r, 0],
          [r, h],
          [r * 0.8, h + r * 0.22],
          [r * 0.35, h + r * 0.32],
          [0, h + r * 0.34],
        ],
        20,
      ),
      m,
      x,
      y,
      z,
    ),
  );
  for (let yy = h * 0.25; yy < h; yy += h * 0.25)
    g.add(mesh(D.cyl(r * 1.03, r * 1.03, 0.25, 20), dk(m), x, y + yy, z));
  ladder(g, M.steel, x + r + 0.3, y, z, h);
}
// 爬梯（沿 Y，面朝 +X）
function ladder(g, m, x, y, z, h) {
  for (const s of [-0.3, 0.3]) g.add(mesh(D.box(0.1, h, 0.1, 0.02), m, x, y + h / 2, z + s));
  for (let yy = 0.4; yy < h; yy += 0.6) g.add(mesh(D.box(0.08, 0.08, 0.6, 0.01), m, x, y + yy, z));
}
// 欄杆：沿折線的扶手＋立柱
function rail(g, m, pts, hh = 1.1) {
  const up = pts.map(([x, y, z]) => [x, y + hh, z]);
  g.add(mesh(D.sweep(up, D.ring(0.05, 5)), m));
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let t = 0; t <= L; t += 1.5) {
      const u = L ? t / L : 0;
      g.add(
        mesh(D.cyl(0.04, 0.04, hh, 5), m, a[0] + (b[0] - a[0]) * u, a[1] + hh / 2, a[2] + (b[2] - a[2]) * u),
      );
    }
  }
}
// 碎石與殘片的裙邊（大物件落地的地方）：n 塊，半徑 R 的範圍
function rubble(g, x, z, R, n, seed, m = M.concrete) {
  const r = lcg(seed);
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2,
      d = R * (0.3 + r() * 0.7),
      s = 0.6 + r() * 1.6;
    const o = mesh(
      D.rock(((seed + i) % 24) + 1, 1, 0.3, 0.5, 0.2),
      r() < 0.35 ? M.rustD : m,
      x + Math.cos(a) * d,
      s * 0.25,
      z + Math.sin(a) * d,
      r() * 3,
      r() * 3,
      r() * 3,
    );
    o.scale.set(s, s * (0.4 + r() * 0.4), s * (0.6 + r() * 0.6));
    g.add(o);
  }
}
// 燒焦的地面（薄的暗色板）
const scorch = (g, w, d, x, z, ry = 0) => g.add(mesh(D.box(w, 0.06, d, 0.02), M.dark, x, 0.04, z, 0, ry, 0));

// ---------- 荒野 ----------
// 墜毀運輸艦：長 34 m 的艦體斜插地面，機翼折斷
function crashedShip() {
  const g = new THREE.Group();
  const hull = new THREE.Group();
  // 艦體：板金的主體＋往前收的機首（側面輪廓擠出）＋背上的貨艙與艦橋
  plated(hull, 8, 6, 22, M.hull, 0, 3, -2);
  hull.add(
    mesh(
      D.extrude(
        [
          [0, 0],
          [6, 0.6],
          [8, 2.4],
          [8, 4.6],
          [5.5, 6],
          [0, 6],
        ],
        7.6,
        0.3,
      ),
      M.hull,
      0,
      0,
      9,
      0,
      -HP,
      0,
    ),
  );
  hull.add(mesh(D.box(5.2, 2.2, 0.3, 0.05), M.window, 0, 4.6, 16.4, -0.5, 0, 0));
  plated(hull, 6, 3, 8, M.hullD, 0, 7.5, -6, 0, 0, 0, 1.4);
  hull.add(mesh(D.box(9.2, 1.2, 24, 0.2), M.rustD, 0, 0.4, -1));
  // 貨艙門（掀開）與裡面的暗處
  hull.add(mesh(D.box(5, 3.4, 0.1, 0.02), M.dark, 0, 3, -13.05));
  hull.add(mesh(D.box(5.2, 0.3, 4, 0.05), M.hullD, 0, 1.0, -15.2, 0.35, 0, 0));
  // 引擎：剖面旋轉的推進器（進氣唇口、噴口、內部的暗色）
  for (const s2 of [-1, 1]) {
    hull.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [1.4, 0.2],
            [1.9, 1.2],
            [1.8, 4.2],
            [1.5, 5.2],
            [1.1, 5.4],
          ],
          18,
        ),
        M.hullD,
        s2 * 3.2,
        3,
        -12,
        -HP,
        0,
        0,
      ),
    );
    hull.add(mesh(D.cyl(1.1, 1.1, 0.4, 16), M.dark, s2 * 3.2, 3, -17.3, HP, 0, 0));
  }
  // 折斷的機翼（一邊歪著、一邊斷在地上）＋天線
  plated(hull, 12, 0.8, 6, M.hull, -9, 3.5, 2, 0, 0, 0.25, 0.4);
  plated(hull, 7, 0.8, 5, M.rust, 8, 1.2, 5, 0, 0.3, -0.5, 0.4);
  bar(hull, M.steel, [1.5, 9, -5], [1.8, 13, -5.5], 0.15);
  bar(hull, M.steel, [-1.5, 9, -7], [-1.3, 11.5, -7], 0.12);
  rot(hull, -0.12, 0.35, 0.08);
  hull.position.y = -1.2;
  g.add(hull);
  // 墜地的痕跡：燒焦的地面、刮出來的碎石、散落的板
  scorch(g, 14, 30, 0, -2, 0.35);
  rubble(g, 2, 14, 8, 14, 3, M.rustD);
  rubble(g, -5, -6, 9, 10, 9);
  for (let i = 0; i < 5; i++) plated(g, 2.5, 1.2, 2, M.rustD, -8 + i * 4, 0.4, 12 - i * 5, 0, i, 0.2, 9);
  return g;
}
// 倒塌的雷達塔：橫躺的格子塔＋碟形天線
function fallenRadar() {
  const g = new THREE.Group();
  // 橫躺的格子塔：四根主樑＋每節的 X 斜撐
  const tw = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const z = -14 + i * 5;
    for (const [x, y] of [
      [-1.5, 0],
      [1.5, 0],
      [-1.5, 3],
      [1.5, 3],
    ])
      bar(tw, M.steel, [x, y + 0.6, z], [x, y + 0.6, z + 5], 0.4);
    bar(tw, M.steel, [-1.5, 0.6, z], [1.5, 3.6, z + 5], 0.22);
    bar(tw, M.steel, [1.5, 0.6, z], [-1.5, 3.6, z + 5], 0.22);
    bar(tw, M.steel, [-1.5, 0.6, z], [-1.5, 3.6, z + 5], 0.22);
    bar(tw, M.steel, [1.5, 0.6, z], [1.5, 3.6, z + 5], 0.22);
  }
  rot(tw, 0, 0, 0.06);
  g.add(tw);
  // 碟形天線：反射面（雙面）＋背面的補強架＋饋源支架
  const dish = new THREE.Group();
  dish.add(mesh(new THREE.SphereGeometry(6, 28, 10, 0, Math.PI * 2, 0, 0.9), M.dish));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    bar(dish, M.steel, [0, -6, 0], [Math.cos(a) * 4.7, -3.6, Math.sin(a) * 4.7], 0.18);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    bar(dish, M.steel, [Math.cos(a) * 4.5, -3.8, Math.sin(a) * 4.5], [0, -10, 0], 0.14);
  }
  dish.add(mesh(D.cyl(0.6, 0.4, 1.2, 12), M.dark, 0, -10, 0));
  rot(dish, 1.2, 0, 0.3);
  dish.position.set(2, 3.2, 20);
  g.add(dish);
  // 基座（斷掉的錨栓）、碎石
  plated(g, 5, 2, 5, M.concrete, 0, 1, -17, 0, 0, 0, 9);
  for (const x of [-1.6, 1.6]) g.add(mesh(D.cyl(0.25, 0.25, 1.2, 8), M.rust, x, 2.4, -15.4, 0.4, 0, 0));
  rubble(g, 2, 18, 7, 12, 5);
  return g;
}
// 燃燒中的油井：井架＋火炬（發光）＋儲槽
function burningWell() {
  const g = new THREE.Group();
  // 井架：四支腳的格子塔、天車、作業平台與欄杆
  lattice(g, M.rust, 6, 2.2, 22, 0, 0, 6, 0.45);
  g.add(mesh(D.box(3, 1.2, 3, 0.15), M.rustD, 0, 22.6, 0));
  plated(g, 7, 1, 7, M.dark, 0, 5, 0, 0, 0, 0, 9);
  rail(g, M.yellow, [
    [-3.4, 5.5, -3.4],
    [3.4, 5.5, -3.4],
    [3.4, 5.5, 3.4],
    [-3.4, 5.5, 3.4],
    [-3.4, 5.5, -3.4],
  ]);
  ladder(g, M.steel, 3.6, 0, -1, 5);
  plated(g, 9, 1, 9, M.concrete, 0, 0.5, 0, 0, 0, 0, 9);
  // 火炬（發光）＋井口的防噴器
  const fire = cyl(0.2, 2.2, 7, M.glow, 0, 25, 0, 12);
  fire.castShadow = false;
  g.add(fire);
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.2, 0],
          [1.2, 1.5],
          [0.9, 1.8],
          [0.9, 3],
          [0, 3],
        ],
        14,
      ),
      M.red,
      0,
      1,
      0,
    ),
  );
  // 儲槽群與連接管
  for (const [x, z, r] of [
    [9, 3, 3.5],
    [9, -5, 3],
    [-8, 6, 2.6],
  ])
    tank(g, M.hull, r, 5, x, z);
  pipe(
    g,
    M.rust,
    [
      [1.2, 1.5, 0],
      [5, 1.5, 0],
      [5, 1.5, 3],
      [5.6, 1.5, 3],
    ],
    0.35,
  );
  pipe(
    g,
    M.rust,
    [
      [5, 1.5, 0],
      [5, 1.5, -5],
      [6.1, 1.5, -5],
    ],
    0.35,
  );
  scorch(g, 12, 12, 0, 0);
  rubble(g, -2, -7, 5, 8, 7, M.rustD);
  return g;
}
// 半埋的舊 AC 殘骸：巨大頭部與伸出地面的手臂（舊時代的大型機體）
function buriedAc() {
  const g = new THREE.Group();
  // 頭部：裝甲的頭殼、發光的單眼、天線、側面的感測器
  const head = new THREE.Group();
  plated(head, 7, 5, 7, M.hullD, 0, 2.5, 0, 0, 0, 0, 1.6);
  head.add(mesh(D.box(5.5, 1.2, 0.6, 0.15), M.glow, 0, 3.2, 3.6));
  head.add(mesh(D.box(6.2, 1.8, 0.4, 0.1), M.dark, 0, 3.2, 3.4));
  head.add(mesh(D.box(1.2, 4, 1.2, 0.15), M.hull, 2.8, 6, -1.5));
  plated(head, 8, 1, 3, M.hull, 0, 5.2, -2, 0, 0, 0, 9);
  for (const s2 of [-1, 1]) head.add(mesh(D.cyl(0.8, 0.9, 1, 14), M.hull, s2 * 3.8, 2.6, 0.5, 0, 0, HP));
  rot(head, 0.25, 0.6, -0.3);
  head.position.set(-3, -1.2, 0);
  g.add(head);
  // 伸出地面的手臂：上臂、手肘的關節、前臂、手掌與手指、液壓管
  const arm = new THREE.Group();
  plated(arm, 2.6, 12, 2.6, M.hull, 0, 6, 0, 0, 0, 0, 2);
  arm.add(mesh(D.cyl(1.8, 1.8, 3.4, 16, 0.2), M.hullD, 0, 12, 0, 0, 0, HP));
  plated(arm, 2.2, 9, 2.2, M.hull, 0, 16.5, 0, 0, 0, 0, 2);
  plated(arm, 3, 2.4, 2, M.hullD, 0, 22, 0, 0, 0, 0, 9);
  for (let i = 0; i < 4; i++)
    arm.add(mesh(D.box(0.5, 2.4, 0.5, 0.08), M.hull, -1.1 + i * 0.75, 24.2, 0.6, 0.4, 0, 0));
  pipe(
    arm,
    M.dark,
    [
      [1.4, 3, 1],
      [1.6, 12, 1.5],
      [1.3, 19, 1],
    ],
    0.18,
  );
  rot(arm, 0.3, 0, 0.45);
  arm.position.set(7, -2, 4);
  g.add(arm);
  rubble(g, 0, 0, 10, 18, 11, M.rustD);
  return g;
}
// 巨型隔牆的破口：兩段高牆夾著塌落的缺口
function breachedWall() {
  const g = new THREE.Group();
  for (const s2 of [-1, 1]) {
    // 牆身：混凝土＋頂部的鋼製壓頂、垂直的補強柱、斷口處露出的鋼筋、作業通道與欄杆
    g.add(mesh(D.box(14, 20, 4, 0.2), M.concrete, s2 * 13, 10, 0));
    plated(g, 14, 1.5, 4.6, M.hullD, s2 * 13, 18, 0, 0, 0, 0, 9);
    for (let i = 0; i < 3; i++) g.add(mesh(D.box(0.8, 20, 0.6, 0.1), M.dark, s2 * (8 + i * 4), 10, 2.3));
    for (let y = 3; y < 19; y += 2.2)
      g.add(mesh(D.box(0.6, 0.15, 3.6, 0.02), dk(M.concrete, 0.8), s2 * 6.05, y, 0));
    for (let i = 0; i < 6; i++)
      bar(
        g,
        M.rust,
        [s2 * 6, 4 + i * 2.5, -1.4 + (i % 3) * 1.2],
        [s2 * (4.5 + (i % 2)), 4.6 + i * 2.5, -1.2 + (i % 3) * 1.2],
        0.12,
      );
    g.add(mesh(D.box(14, 0.3, 1.2, 0.05), M.steel, s2 * 13, 14, -2.6));
    rail(g, M.yellow, [
      [s2 * 6.4, 14.15, -3.1],
      [s2 * 19.6, 14.15, -3.1],
    ]);
  }
  rubble(g, 0, -1, 6, 16, 13);
  for (let i = 0; i < 7; i++)
    g.add(
      rot(
        mesh(D.box(3 + (i % 3), 2 + (i % 2) * 2, 3, 0.3), M.concrete, -5 + i * 1.7, 1, -3 + (i % 4) * 2),
        i,
        i * 0.7,
        0.3,
      ),
    );
  return g;
}
// 廢棄的煉油塔群：三座高塔與連接管
function crackingTowers() {
  const g = new THREE.Group();
  for (const [x, z, r, h] of [
    [-5, 0, 2.2, 24],
    [2, -3, 1.8, 30],
    [4, 4, 2.6, 20],
  ]) {
    // 塔身＋補強環＋頂部的圓頂與排氣口＋半圈的維修平台＋爬梯
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [r * 1.1, 0],
            [r, h],
            [r * 0.6, h + r * 0.4],
            [0, h + r * 0.45],
          ],
          20,
        ),
        M.steel,
        x,
        0,
        z,
      ),
    );
    for (let y = 4; y < h; y += 5) g.add(mesh(D.cyl(r * 1.25, r * 1.25, 0.5, 20, 0.05), M.rust, x, y, z));
    g.add(mesh(D.cyl(0.3, 0.3, 2.5, 8), M.dark, x, h + r * 0.4 + 1.2, z));
    for (let y = 6; y < h - 2; y += 8)
      g.add(
        mesh(
          D.lathe(
            [
              [r * 1.15, 0],
              [r * 1.9, 0],
              [r * 1.9, 0.2],
              [r * 1.15, 0.2],
              [r * 1.15, 0],
            ],
            20,
            0,
            Math.PI,
          ),
          M.dark,
          x,
          y,
          z,
          0,
          y * 0.3,
          0,
        ),
      );
    ladder(g, M.steel, x + r * 1.1, 0, z, h - 1);
  }
  // 連接管（彎管）、地上的管線與管架
  pipe(
    g,
    M.rust,
    [
      [-3, 14, 0],
      [-1, 14, -1.5],
      [0.4, 14, -2.6],
    ],
    0.6,
  );
  pipe(
    g,
    M.rust,
    [
      [3, 12, -1.5],
      [3.2, 12, 1],
      [3.6, 12, 2],
    ],
    0.6,
  );
  pipe(
    g,
    M.hullD,
    [
      [-7, 1.2, 4],
      [-2, 1.2, 6],
      [4, 1.2, 7],
    ],
    0.5,
  );
  for (const x of [-5, -1, 3]) g.add(mesh(D.box(0.4, 1.2, 0.4, 0.05), M.steel, x, 0.6, 5.6 + x * 0.12));
  plated(g, 16, 1, 14, M.concrete, 0, 0.5, 0, 0, 0, 0, 9);
  return g;
}

// ---------- 礦坑 ----------
// 巨型鑽機：履帶底盤＋直立鑽桿
function giantDrill() {
  const g = new THREE.Group();
  // 履帶底盤（側板、上方的負重輪）＋黃色的機體（引擎室的格柵）＋駕駛室
  for (const s2 of [-1, 1]) {
    plated(g, 3, 3, 16, M.dark, s2 * 5, 1.5, 0, 0, 0, 0, 1.2);
    for (let i = 0; i < 6; i++)
      g.add(mesh(D.cyl(0.9, 0.9, 0.4, 14), M.steel, s2 * 6.6, 1.4, -6.5 + i * 2.6, 0, 0, HP));
  }
  plated(g, 9, 6, 12, M.yellow, 0, 6, 0, 0, 0, 0, 1.8);
  for (let i = 0; i < 6; i++) g.add(mesh(D.box(0.3, 3, 0.2, 0.03), M.dark, 4.62, 6, -4 + i * 0.9, 0, 0, 0));
  plated(g, 6, 4, 5, M.yellow, 0, 10, 4, 0, 0, 0, 9);
  g.add(mesh(D.box(5.6, 2, 0.3, 0.05), M.window, 0, 10.6, 6.55));
  rail(g, M.dark, [
    [-4.4, 9, -5.8],
    [4.4, 9, -5.8],
    [4.4, 9, 5.8],
  ]);
  // 鑽塔：格子桅杆＋鑽桿＋鑽頭（剖面）＋液壓缸
  lattice(g, M.orange, 3.2, 1.4, 34, 0, -5, 8, 0.35);
  g.add(mesh(D.cyl(0.7, 0.7, 34, 12), M.steel, 0, 18, -5));
  g.add(
    mesh(
      D.lathe(
        [
          [0, -3],
          [0.6, -2.4],
          [1.4, -0.8],
          [1.4, 0],
          [0, 0],
        ],
        12,
      ),
      M.dark,
      0,
      1.5,
      -5,
    ),
  );
  for (const s2 of [-1, 1]) bar(g, M.steel, [s2 * 2, 9, -2], [s2 * 0.8, 20, -4.6], 0.4);
  rubble(g, 0, -7, 5, 10, 31, M.rustD);
  return g;
}
// 斗輪採掘機：巨大斗輪＋吊臂＋車體
function bucketWheel() {
  const g = new THREE.Group();
  // 車體＋履帶＋旋轉台
  plated(g, 12, 7, 14, M.yellow, 0, 4, 4, 0, 0, 0, 2);
  plated(g, 14, 2.5, 16, M.dark, 0, 1.2, 4, 0, 0, 0, 9);
  g.add(mesh(D.cyl(6, 6.4, 1, 24, 0.1), M.dark, 0, 7.8, 4));
  // 吊臂：格子桁架（傾斜）＋輸送帶
  const boom = new THREE.Group();
  boom.position.set(0, 9, 3);
  boom.rotation.x = 0.25;
  g.add(boom);
  for (let i = 0; i < 6; i++) {
    const z = -i * 4.4;
    for (const [x, y] of [
      [-1.4, -1.4],
      [1.4, -1.4],
      [-1.4, 1.4],
      [1.4, 1.4],
    ])
      bar(boom, M.yellow, [x, y, z], [x, y, z - 4.4], 0.35);
    bar(boom, M.yellow, [-1.4, -1.4, z], [1.4, 1.4, z - 4.4], 0.2);
    bar(boom, M.yellow, [1.4, -1.4, z], [-1.4, 1.4, z - 4.4], 0.2);
  }
  boom.add(mesh(D.box(1.6, 0.3, 26, 0.04), M.dark, 0, 1.6, -13));
  // 斗輪：輪圈（剖面旋轉）＋輪輻＋10 個鏟斗（有齒）
  const wheel = new THREE.Group();
  wheel.position.set(0, 9, -24);
  g.add(wheel);
  wheel.add(mesh(new THREE.TorusGeometry(7, 1.0, 10, 36), M.orange, 0, 0, 0, 0, HP, 0));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    bar(wheel, M.orange, [0, 0, 0], [0, Math.sin(a) * 6.5, Math.cos(a) * 6.5], 0.4);
  }
  wheel.add(mesh(D.cyl(1.4, 1.4, 2, 14), M.dark, 0, 0, 0, 0, 0, HP));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const b = new THREE.Group();
    b.position.set(0, Math.sin(a) * 7.6, Math.cos(a) * 7.6);
    b.rotation.x = -a;
    b.add(mesh(D.box(2.2, 1.6, 2, 0.15), M.dark, 0, 0, 0));
    for (let k = 0; k < 4; k++) b.add(mesh(D.box(0.25, 0.6, 0.25, 0.04), M.steel, -0.8 + k * 0.53, 1.0, 0.8));
    wheel.add(b);
  }
  rubble(g, 0, -24, 8, 12, 33, M.rustD);
  return g;
}
// 礦石運輸車殘骸：巨大的翻倒卡車
function haulTruck() {
  const g = new THREE.Group();
  // 翻倒的大型礦車：車斗（有肋）、車頭、駕駛室、四個大輪胎（胎紋）
  const t = new THREE.Group();
  plated(t, 9, 5, 16, M.yellow, 0, 4, 0, 0, 0, 0, 1.6);
  for (let i = 0; i < 6; i++)
    t.add(mesh(D.box(9.3, 0.4, 0.4, 0.06), dk(M.yellow, 0.8), 0, 1.8, -6 + i * 2.4));
  plated(t, 10, 6, 9, M.orange, 0, 8, -3, 0, 0, 0, 2);
  t.add(mesh(D.box(6, 3, 3, 0.2), M.window, 0, 8, 6));
  for (const [x, z] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]) {
    t.add(mesh(D.tire(2.6, 2, 18, 0.25), M.dark, x, 2.6, z));
    t.add(mesh(D.rim(1.5, 1.8, 6, 8), M.steel, x, 2.6, z, 0, x < 0 ? Math.PI : 0, 0));
  }
  rot(t, 0, 0.4, 1.35);
  t.position.set(-2, 3, 0);
  g.add(t);
  rubble(g, 6, -2, 7, 12, 37, M.rustD);
  return g;
}
// 選礦廠塔：多層廠房＋斜向輸送帶
function processingTower() {
  const g = new THREE.Group();
  // 廠房：板金的主體、樓層的外廊與欄杆、窗、頂部的機房
  plated(g, 10, 26, 10, M.rust, 0, 13, 0, 0, 0, 0, 3);
  for (const y of [8, 14, 20]) {
    g.add(mesh(D.box(12, 0.3, 12, 0.05), M.dark, 0, y, 0));
    rail(g, M.yellow, [
      [-6, y + 0.15, -6],
      [6, y + 0.15, -6],
      [6, y + 0.15, 6],
      [-6, y + 0.15, 6],
      [-6, y + 0.15, -6],
    ]);
    g.add(mesh(D.box(7, 1, 0.2, 0.03), M.window, 0, y + 2.4, -5.05));
  }
  plated(g, 12, 1, 12, M.dark, 0, 18, 0, 0, 0, 0, 9);
  plated(g, 8, 6, 8, M.hull, 0, 29, 0, 0, 0, 0, 2);
  // 斜向的輸送帶（桁架＋覆蓋的屋頂）與支柱、樓梯
  const cv = new THREE.Group();
  cv.position.set(0, 12, 16);
  cv.rotation.x = -0.6;
  g.add(cv);
  for (let i = 0; i < 6; i++) {
    const z = -15 + i * 5;
    for (const [x, y] of [
      [-1.2, -0.6],
      [1.2, -0.6],
      [-1.2, 1.2],
      [1.2, 1.2],
    ])
      bar(cv, M.steel, [x, y, z], [x, y, z + 5], 0.25);
    bar(cv, M.steel, [-1.2, -0.6, z], [1.2, 1.2, z + 5], 0.15);
  }
  cv.add(mesh(D.box(3, 0.2, 30, 0.04), M.hullD, 0, 1.5, 0));
  for (let i = 0; i < 4; i++)
    g.add(mesh(D.box(0.6, 12 - i * 3, 0.6, 0.08), M.rust, 0, (12 - i * 3) / 2, 6 + i * 6));
  ladder(g, M.steel, 5.2, 0, 3, 26);
  rubble(g, 4, 8, 6, 8, 41, M.rustD);
  return g;
}
// 巨大結晶簇（發光）
function crystalCluster() {
  const g = new THREE.Group();
  // 結晶：六角柱＋尖端（剖面旋轉 6 段），大小不一、往外傾；底部的岩床
  const C = [
    [0, 0, 2.2, 16, 0, 0],
    [3, 2, 1.6, 11, 0.3, 0.2],
    [-3, 1, 1.4, 9, -0.35, 0.1],
    [1, -3, 1.2, 8, 0.2, -0.4],
    [-2, -2.5, 1, 6, -0.2, -0.3],
    [4, -1, 0.9, 5, 0.5, -0.1],
    [-4.2, -0.8, 0.7, 4, -0.5, 0.2],
    [2.2, 3.8, 0.6, 3.5, 0.2, 0.5],
  ];
  for (const [x, z, r, h, rx, rz] of C) {
    const m = mesh(
      D.lathe(
        [
          [0, 0],
          [r, 0],
          [r * 1.05, h * 0.72],
          [r * 0.3, h * 0.97],
          [0, h],
        ],
        6,
      ),
      M.crystal,
      x,
      -0.5,
      z,
      rx,
      x,
      rz,
    );
    g.add(m);
  }
  const bed = mesh(D.rock(13, 3, 0.35, 0.5, 0.3), M.rustD, 0, 0, 0);
  bed.scale.set(6, 1.5, 6);
  g.add(bed);
  rubble(g, 0, 0, 7, 10, 43, M.rustD);
  return g;
}
// 坍塌的礦井升降塔：歪斜的頭架與滑輪
function headframe() {
  const g = new THREE.Group();
  const f = new THREE.Group();
  // 頭架：格子塔＋頂部的滑輪（輪輻）＋斜撐的後腿＋鋼索
  lattice(f, M.steel, 6, 5, 24, 0, 0, 5, 0.4);
  const wh = new THREE.Group();
  wh.position.set(0, 25, 0);
  wh.rotation.x = HP;
  f.add(wh);
  wh.add(mesh(new THREE.TorusGeometry(3, 0.35, 8, 28), M.dark, 0, 0, 0, HP, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    bar(wh, M.dark, [0, 0, 0], [Math.cos(a) * 2.8, 0, Math.sin(a) * 2.8], 0.18);
  }
  bar(f, M.steel, [0, 0, 9], [0, 24, 1.5], 0.6);
  bar(f, M.steel, [-2, 0, 9], [-1, 22, 1.5], 0.35);
  f.add(mesh(D.cable([0, 27.8, 0], [0, 3, -9], 0.12, 1.2, 10), M.dark));
  rot(f, 0.18, 0, -0.12);
  g.add(f);
  plated(g, 10, 3, 10, M.concrete, 0, 1.5, 0, 0, 0, 0, 9);
  // 卷揚機房
  plated(g, 6, 4, 5, M.rust, 0, 2, -11, 0, 0, 0, 1.6);
  rubble(g, 0, 0, 9, 12, 47);
  return g;
}

// ---------- 貨運集散場 ----------
// 一個貨櫃（長軸沿 X）
const ctr = (m, x, y, z, ry = 0, rz = 0) => rot(box(7, 2.6, 2.6, m, x, y, z), 0, ry, rz);
// 巨型門式起重機：四支腳跨過貨櫃列，頂部大梁與台車，吊著一個貨櫃
// 一個 40 呎貨櫃（長軸沿 X、中心在 x, y, z）：箱體、側面的波紋肋、角柱、門與門閂
function cont(g, m, x, y, z, ry = 0, rz = 0, rx = 0) {
  const o = new THREE.Group();
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  g.add(o);
  o.add(mesh(D.box(7, 2.6, 2.6, 0.08), m));
  for (let i = 0; i < 10; i++)
    for (const s2 of [-1, 1]) o.add(mesh(D.box(0.28, 2.2, 0.06, 0.01), m, -3.1 + i * 0.69, 0, s2 * 1.32));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) o.add(mesh(D.box(0.2, 2.62, 0.2, 0.03), M.dark, sx * 3.42, 0, sz * 1.22));
  for (const zz of [-0.7, -0.25, 0.25, 0.7]) o.add(mesh(D.cyl(0.04, 0.04, 2.2, 6), M.steel, 3.52, 0, zz));
  return o;
}
function gantryCrane() {
  const g = new THREE.Group();
  // 四支箱形腳（有斜撐）、兩根主樑（桁架感的開孔）、底部的行走台車與車輪、頂部的台車、機房、吊具與鋼索
  for (const x of [-12, 12]) {
    for (const z of [-5, 5]) plated(g, 1.3, 24, 1.3, M.yellow, x, 12, z, 0, 0, 0, 3);
    bar(g, M.yellow, [x, 2, -5], [x, 14, 5], 0.6);
    bar(g, M.yellow, [x, 2, 5], [x, 14, -5], 0.6);
    plated(g, 1.6, 1.4, 12, M.yellow, x, 1.6, 0, 0, 0, 0, 9);
    for (const z of [-4.5, -3, 3, 4.5]) g.add(mesh(D.cyl(0.5, 0.5, 0.5, 12), M.dark, x, 0.5, z, 0, 0, HP));
  }
  for (const z of [-5, 5]) {
    plated(g, 28, 2.2, 1.6, M.yellow, 0, 24.6, z, 0, 0, 0, 9);
    for (let x = -12; x <= 12; x += 3) g.add(mesh(D.box(1.4, 1.2, 0.2, 0.05), M.dark, x, 24.6, z - 0.82));
    rail(g, M.yellow, [
      [-14, 25.7, z],
      [14, 25.7, z],
    ]);
  }
  plated(g, 5, 3, 12, M.hullD, 4, 26.8, 0, 0, 0, 0, 1.4);
  g.add(mesh(D.box(2, 1.2, 0.2, 0.03), M.window, 2.2, 27, -6.05));
  for (const s2 of [-0.5, 0.5]) g.add(mesh(D.cyl(0.05, 0.05, 10, 4), M.dark, 4 + s2, 20, 0));
  plated(g, 6.4, 0.8, 2.6, M.yellow, 4, 15.4, 0, 0, 0, 0, 9);
  cont(g, M.red, 4, 13.8, 0);
  cont(g, M.blue, -4, 1.3, 0);
  cont(g, M.green, -4, 3.9, 0);
  return g;
}
// 調度管制塔：高塔＋玻璃管制室＋天線
function controlTower() {
  const g = new THREE.Group();
  // 塔身（往上收、有樓梯間的窗）、管制室（往外斜的玻璃、窗框）、屋頂的雷達與天線、基座的入口
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.8, 0],
          [2.2, 26],
          [0, 26],
        ],
        18,
      ),
      M.concrete,
      0,
      0,
      0,
    ),
  );
  for (let y = 3; y < 24; y += 3) g.add(mesh(D.box(0.8, 1.4, 0.3, 0.05), M.window, 0, y, -2.7 + y * 0.022));
  plated(g, 10, 1, 10, M.hullD, 0, 25.6, 0, 0, 0, 0, 9);
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [4.6, 0],
          [5.4, 4],
          [0, 4],
        ],
        8,
        Math.PI / 8,
        Math.PI / 8 + Math.PI * 2,
      ),
      M.window,
      0,
      26,
      0,
    ),
  );
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    bar(
      g,
      M.hullD,
      [Math.cos(a) * 4.6, 26, Math.sin(a) * 4.6],
      [Math.cos(a) * 5.4, 30, Math.sin(a) * 5.4],
      0.2,
    );
  }
  plated(g, 11, 0.8, 11, M.hullD, 0, 30.4, 0, 0, 0, 0, 9);
  rail(g, M.steel, [
    [-5.3, 30.8, -5.3],
    [5.3, 30.8, -5.3],
    [5.3, 30.8, 5.3],
    [-5.3, 30.8, 5.3],
    [-5.3, 30.8, -5.3],
  ]);
  {
    const lt = new THREE.Group();
    lt.position.y = 30.8;
    g.add(lt);
    lattice(lt, M.steel, 0.8, 0.3, 7, 2, 1, 3, 0.15);
  }
  g.add(mesh(D.cyl(1.6, 1.6, 0.3, 18), M.steel, -2, 31.2, -2));
  g.add(mesh(D.box(3.6, 0.6, 0.4, 0.05), M.steel, -2, 32, -2));
  plated(g, 6, 4, 6, M.concrete, 0, 2, 0, 0, 0, 0, 9);
  g.add(mesh(D.box(1.8, 2.6, 0.2, 0.04), M.dark, 0, 1.3, -3.05));
  return g;
}
// 倒塌的貨櫃塔：疊到很高的貨櫃倒成一堆
function fallenStack() {
  const g = new THREE.Group();
  const C = [M.red, M.blue, M.yellow, M.green, M.white];
  for (let i = 0; i < 3; i++) cont(g, C[i], -4 + i * 0.4, 1.3 + i * 2.6, -2);
  for (let i = 0; i < 3; i++) cont(g, C[(i + 1) % 5], 3.5, 1.3 + i * 2.6, 2.4, 0.2);
  cont(g, C[3], 8, 2.2, -3, 0.6, 0.35);
  cont(g, C[4], -9, 1.6, 3, -0.9, -0.2);
  cont(g, C[0], 1, 8.6, 0.4, 1.2, 0.4);
  cont(g, C[2], 6, 0.9, 6, 1.5, 1.3);
  cont(g, C[1], -6, 1.2, -6, 0.3, 1.5);
  rubble(g, 0, 0, 10, 10, 61, M.rustD);
  return g;
}
// 翻覆的油罐列車：三節油罐車倒在地上，一節起火
function tankerTrain() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    // 罐車：弧形封頭的罐、罐箍、頂部的人孔與走道、台車（有輪緣的輪子）
    const t = new THREE.Group();
    const m = i === 1 ? M.rustD : M.white;
    t.add(
      mesh(
        D.lathe(
          [
            [0, -5.6],
            [1.2, -5.5],
            [1.7, -5],
            [1.7, 5],
            [1.2, 5.5],
            [0, 5.6],
          ],
          18,
        ),
        m,
        0,
        0,
        0,
        0,
        0,
        HP,
      ),
    );
    for (const x of [-3, 0, 3]) t.add(mesh(D.cyl(1.76, 1.76, 0.2, 18), M.dark, x, 0, 0, 0, 0, HP));
    t.add(mesh(D.cyl(0.5, 0.55, 0.4, 12), M.dark, 0, 1.8, 0));
    t.add(mesh(D.box(6, 0.15, 0.8, 0.02), M.steel, 0, 1.75, 0));
    for (const s2 of [-1, 1]) {
      plated(t, 2.4, 1, 2.4, M.dark, s2 * 3.6, -1.8, 0, 0, 0, 0, 9);
      for (const dz of [-0.6, 0.6])
        for (const sz of [-1, 1])
          t.add(mesh(D.cyl(0.45, 0.45, 0.2, 14), M.steel, s2 * 3.6 + dz, -2.3, sz * 1.1, HP, 0, 0));
    }
    t.position.set(-13 + i * 13, 1.7, (i % 2) * 1.6);
    t.rotation.set(1.2 * (i === 2 ? -1 : 1), 0.12 * (i - 1), 0);
    g.add(t);
  }
  g.add(cyl(0.6, 2.2, 6, M.glow, 0, 4, 0.8, 10));
  scorch(g, 12, 8, 0, 1);
  // 鐵軌（翻開的一段）
  for (const z of [-1.2, 1.2]) g.add(mesh(D.box(40, 0.2, 0.2, 0.03), M.steel, 0, 0.1, z + 5));
  for (let x = -19; x <= 19; x += 1.4) g.add(mesh(D.box(0.4, 0.15, 3.2, 0.02), M.rustD, x, 0.02, 5));
  rubble(g, 0, 1, 9, 10, 67, M.rustD);
  return g;
}
// 穀倉群：四座圓筒穀倉＋高處的輸送橋
function silos() {
  const g = new THREE.Group();
  for (const [x, z] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ]) {
    // 筒倉：圓錐頂、補強環、底部的卸料斗
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [1, 0],
            [3, 2.4],
            [3, 20],
            [0.6, 22],
            [0, 22],
          ],
          20,
        ),
        M.white,
        x,
        0,
        z,
      ),
    );
    for (let y = 4; y < 20; y += 4) g.add(mesh(D.cyl(3.06, 3.06, 0.2, 20), dk(M.white, 0.75), x, y, z));
    g.add(mesh(D.cyl(0.4, 0.4, 2.4, 8), M.steel, x, 1.2, z));
  }
  // 升降塔（板金、窗）、通往筒倉頂部的輸送橋（桁架）
  plated(g, 3, 24, 3, M.hullD, 0, 12, 13, 0, 0, 0, 3);
  for (let y = 4; y < 22; y += 4) g.add(mesh(D.box(1.4, 1, 0.2, 0.03), M.window, 0, y, 11.45));
  const br = new THREE.Group();
  br.position.set(0, 22, 7);
  br.rotation.x = -0.15;
  g.add(br);
  for (const [x, y] of [
    [-1, -0.8],
    [1, -0.8],
    [-1, 0.8],
    [1, 0.8],
  ])
    bar(br, M.steel, [x, y, -6], [x, y, 6], 0.25);
  for (let z = -6; z < 6; z += 2) bar(br, M.steel, [-1, -0.8, z], [1, 0.8, z + 2], 0.15);
  pipe(
    g,
    M.steel,
    [
      [0, 22, 1.5],
      [0, 22.5, 0],
      [-4, 22.5, -4],
    ],
    0.35,
  );
  pipe(
    g,
    M.steel,
    [
      [0, 22.5, 0],
      [4, 22.5, 4],
    ],
    0.35,
  );
  return g;
}
// 墜落的貨運飛船：半洩氣的長圓艇身、吊艙與尾翼
function cargoAirship() {
  const g = new THREE.Group();
  // 飛艇：剖面旋轉的氣囊、縱向的骨架線、吊艙（窗）、尾翼（十字）、引擎莢艙與螺旋槳
  const env = new THREE.Group();
  env.position.set(0, 4, 0);
  env.rotation.set(0, 0, 0.08);
  g.add(env);
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const u = i / 12;
    prof.push([
      Math.sin(u * Math.PI) * 5.2 * (u < 0.5 ? 1 : 0.85 + 0.15 * Math.cos((u - 0.5) * 2)),
      -16 + u * 32,
    ]);
  }
  env.add(mesh(D.lathe(prof, 24), M.white, 0, 0, 0, 0, 0, -HP));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    env.add(
      mesh(D.box(28, 0.12, 0.12, 0.02), dk(M.white, 0.7), 0, Math.cos(a) * 5.15, Math.sin(a) * 5.15, a, 0, 0),
    );
  }
  for (const s2 of [-1, 1]) {
    env.add(
      mesh(
        D.extrude(
          [
            [0, 0],
            [4, 0],
            [4.5, 4],
            [1, 2],
          ],
          0.4,
          0.08,
        ),
        M.red,
        12,
        0,
        s2 * 3.5,
        s2 * HP,
        0,
        0,
      ),
    );
    env.add(
      mesh(
        D.lathe(
          [
            [0, -1.2],
            [0.6, -0.8],
            [0.6, 0.8],
            [0, 1.2],
          ],
          12,
        ),
        M.hullD,
        -2,
        -3.5,
        s2 * 5.8,
        0,
        0,
        HP,
      ),
    );
    env.add(mesh(D.blade(1.4, 0.3, 0.2, 0.06, 0.4), M.dark, -3.3, -3.5, s2 * 5.8, 0, 0, HP));
  }
  env.add(
    mesh(
      D.extrude(
        [
          [0, 0],
          [4, 0],
          [4.5, 5],
          [1, 3],
        ],
        0.4,
        0.08,
      ),
      M.red,
      12,
      0,
      0,
    ),
  );
  plated(g, 10, 3, 4, M.hullD, -2, 1.2, 0, 0, 0, 0.05, 1.2);
  for (let i = 0; i < 5; i++) g.add(mesh(D.box(1.2, 1, 0.2, 0.03), M.window, -6 + i * 2, 1.6, -2.05));
  for (let i = 0; i < 4; i++) cont(g, M.blue, -12 + i * 7, 1.3, 7 - (i % 2) * 2, i * 0.7);
  rubble(g, 0, 0, 12, 10, 71, M.rustD);
  return g;
}

// ---------- 多重水壩 ----------
// 巨型水輪機：橫倒的轉輪＋葉片＋主軸
function turbineRunner() {
  const g = new THREE.Group();
  const r = new THREE.Group();
  // 水輪機的轉輪：輪轂（剖面）＋9 片彎的葉片（扭轉的葉）＋下環；斜放
  r.add(
    mesh(
      D.lathe(
        [
          [0, -1.6],
          [2.2, -1.5],
          [2.4, 1.2],
          [1.2, 2],
          [0, 2.1],
        ],
        20,
      ),
      M.steel,
      0,
      0,
      0,
    ),
  );
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const b = mesh(
      D.blade(4.4, 2.6, 2.0, 0.35, 0.7),
      M.hull,
      Math.cos(a) * 2,
      0,
      Math.sin(a) * 2,
      0,
      -a,
      0.35,
    );
    r.add(b);
  }
  r.add(mesh(new THREE.TorusGeometry(6.4, 0.5, 8, 36), M.hullD, 0, -1.5, 0, HP, 0, 0));
  rot(r, HP - 0.25, 0, 0);
  r.position.set(0, 5.6, 0);
  g.add(r);
  g.add(rot(mesh(D.cyl(0.9, 0.9, 10, 14, 0.05), M.steel, 0, 1, 7), HP - 0.1, 0, 0));
  for (const z of [5, 9]) g.add(mesh(D.box(2.4, 1.4, 1, 0.1), M.concrete, 0, 0.7, z));
  rubble(g, 0, 0, 8, 8, 73);
  return g;
}
// 弧形閘門殘骸：彎曲的門板＋兩支轉臂，斜倒在地上
function radialGate() {
  const g = new THREE.Group();
  const t = new THREE.Group();
  // 弧形閘門：弧面的板（有肋）＋兩側的扇形支臂（桁架）＋樞軸
  for (let i = 0; i < 7; i++) {
    const a = -0.6 + i * 0.2;
    t.add(rot(mesh(D.box(16, 0.6, 2.4, 0.1), M.hull, 0, Math.sin(a) * 8, -Math.cos(a) * 8 + 8), a, 0, 0));
    for (const x of [-6, -2, 2, 6])
      t.add(
        rot(mesh(D.box(0.3, 0.9, 2.4, 0.04), M.hullD, x, Math.sin(a) * 7.6, -Math.cos(a) * 7.6 + 8), a, 0, 0),
      );
  }
  for (const s2 of [-1, 1]) {
    for (const a of [-0.5, 0, 0.5])
      bar(t, M.yellow, [s2 * 7.6, 0, 8], [s2 * 7.6, Math.sin(a) * 7.4, -Math.cos(a) * 7.4 + 8], 0.6);
    t.add(mesh(D.cyl(1, 1, 1.4, 14), M.dark, s2 * 7.6, 0, 8, 0, 0, HP));
  }
  rot(t, 0, 0.3, 0.25);
  t.position.y = 3;
  g.add(t);
  rubble(g, 0, 2, 9, 10, 79);
  return g;
}
// 取水塔：高塔＋環狀平台＋斷掉的連絡橋
function intakeTower() {
  const g = new THREE.Group();
  // 取水塔：塔身＋三圈的維修平台（欄杆）＋取水口的格柵＋頂部的機房＋通往壩的橋
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [4.6, 0],
          [4, 22],
          [0, 22],
        ],
        20,
      ),
      M.concrete,
      0,
      0,
      0,
    ),
  );
  for (const y of [8, 16, 22]) {
    g.add(mesh(D.cyl(5, 5, 0.6, 20, 0.05), M.hullD, 0, y, 0));
    const pts = [];
    for (let i = 0; i <= 20; i++)
      pts.push([Math.cos((i / 20) * Math.PI * 2) * 4.9, y + 0.3, Math.sin((i / 20) * Math.PI * 2) * 4.9]);
    rail(g, M.yellow, pts, 1);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(D.box(1.6, 3, 0.4, 0.05), M.dark, Math.cos(a) * 4.45, 3, Math.sin(a) * 4.45, 0, -a + HP, 0));
  }
  plated(g, 3, 3, 3, M.hull, 0, 23.5, 0, 0, 0, 0, 9);
  plated(g, 3, 1, 12, M.concrete, 0, 18, 10, -0.25, 0, 0, 9);
  return g;
}
// 水文觀測站：小屋＋格子天線桅杆＋碟形天線
function gaugeStation() {
  const g = new THREE.Group();
  // 觀測站：建物（窗、門、屋頂的空調）、格子塔與儀器、碟形天線
  plated(g, 8, 4, 6, M.white, 0, 2, 0, 0, 0, 0, 1.6);
  plated(g, 8.6, 0.5, 6.6, M.hullD, 0, 4.2, 0, 0, 0, 0, 9);
  for (const x of [-2.5, 0, 2.5]) g.add(mesh(D.box(1.6, 1, 0.2, 0.03), M.window, x, 2.6, -3.05));
  g.add(mesh(D.box(1.2, 2.2, 0.2, 0.03), M.dark, 3, 1.1, 3.05));
  g.add(mesh(D.box(1.6, 0.8, 1.2, 0.1), M.steel, -2, 4.85, 1));
  lattice(g, M.steel, 1.6, 0.8, 18, 7, 0, 6, 0.15);
  for (let y = 0; y < 18; y += 3) g.add(mesh(D.box(1.2, 0.2, 1.2, 0.03), M.steel, 7, y + 1.5, 0));
  g.add(mesh(D.box(0.8, 0.6, 0.6, 0.05), M.white, 7, 18.4, 0));
  g.add(
    mesh(new THREE.SphereGeometry(2, 18, 6, 0, Math.PI * 2, 0, 1.1), M.dish, -2, 5.6, 0, -0.6 - HP, 0, 0),
  );
  return g;
}
// 擱淺的駁船：傾斜的平底船身與散落的貨櫃
function strandedBarge() {
  const g = new THREE.Group();
  const h = new THREE.Group();
  // 駁船：船殼（船首往上收）＋舷緣、甲板上的貨櫃、船尾的艙樓（窗、桅杆）、繫纜樁
  h.add(
    mesh(
      D.extrude(
        [
          [-13, 0.6],
          [11, 0],
          [13, 2],
          [13.6, 4],
          [-13, 4],
        ],
        9,
        0.25,
      ),
      M.rustD,
      0,
      0,
      0,
      0,
      -HP,
      0,
    ),
  );
  for (const s2 of [-1, 1]) h.add(mesh(D.box(26.5, 0.4, 0.3, 0.05), M.dark, 0, 4.1, s2 * 4.5));
  plated(h, 5, 4, 7, M.hull, 10, 6, 0, 0, 0, 0, 1.4);
  h.add(mesh(D.box(0.2, 1.2, 5, 0.03), M.window, 7.45, 7, 0));
  bar(h, M.steel, [10, 8, 0], [10, 12, 0], 0.2);
  cont(h, M.blue, -6, 5.3, -2);
  cont(h, M.red, -6, 5.3, 2);
  cont(h, M.green, 1, 5.3, 0);
  for (const x of [-11, -2, 6])
    for (const s2 of [-1, 1]) h.add(mesh(D.cyl(0.3, 0.3, 0.6, 8), M.dark, x, 4.4, s2 * 4));
  rot(h, 0.18, 0.2, 0.06);
  h.position.y = -0.6;
  g.add(h);
  cont(g, M.yellow, -4, 1.2, 8, 0.8, 0.3);
  rubble(g, 0, 0, 12, 10, 83, M.rustD);
  return g;
}
// 倒塌的輸水橋：三座拱腳＋斷成兩截的渠道，一截落在地上
function aqueduct() {
  const g = new THREE.Group();
  // 輸水橋：橋墩（往上收、有水線的汙漬）＋拱的托架＋水道（側牆）＋斷落的一段
  for (const x of [-14, 0, 14]) {
    g.add(
      mesh(
        D.extrude(
          [
            [-1.8, 0],
            [1.8, 0],
            [1.4, 14],
            [-1.4, 14],
          ],
          4,
          0.2,
        ),
        M.concrete,
        x,
        0,
        0,
      ),
    );
    g.add(mesh(D.box(3.8, 1.2, 4.2, 0.05), dk(M.concrete, 0.7), x, 1.4, 0));
    for (const s2 of [-1, 1]) bar(g, M.concrete, [x + s2 * 1.4, 11, 0], [x + s2 * 4, 14, 0], 0.9);
  }
  const ch = (x, y, z, rz, len) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    o.rotation.set(0, 0.1 * (rz ? 1 : 0), rz);
    g.add(o);
    o.add(mesh(D.box(len, 1.4, 4.6, 0.1), M.concrete, 0, 0, 0));
    for (const s2 of [-1, 1]) o.add(mesh(D.box(len, 1.4, 0.4, 0.05), M.concrete, 0, 1.4, s2 * 2.1));
    return o;
  };
  ch(-7, 15, 0, 0, 16);
  ch(9, 7.5, 0.5, 0.9, 15);
  rubble(g, 10, 1, 7, 12, 89);
  return g;
}

// ---------- 高空軌道 ----------
// 軌道電梯纜索：粗大的纜索往上延伸到看不見的地方
function elevatorTether() {
  const g = new THREE.Group();
  // 軌道電梯的纜索：基座（錨定環、支架）、纜索（三股＋護套環）、攀爬車（窗、夾具）
  plated(g, 10, 3, 10, M.hullD, 0, 1.5, 0, 0, 0, 0, 9);
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [4, 0],
          [3.6, 2],
          [1.8, 3],
          [1.8, 5],
          [0, 5],
        ],
        20,
      ),
      M.steel,
      0,
      3,
      0,
    ),
  );
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    bar(
      g,
      M.steel,
      [Math.cos(a) * 4.6, 3, Math.sin(a) * 4.6],
      [Math.cos(a) * 1.8, 7.5, Math.sin(a) * 1.8],
      0.5,
    );
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    g.add(mesh(D.cyl(0.6, 0.6, 120, 10), M.steel, Math.cos(a) * 0.8, 60, Math.sin(a) * 0.8));
  }
  for (let y = 10; y < 118; y += 8) g.add(mesh(D.cyl(1.8, 1.8, 0.5, 14), M.dark, 0, y, 0));
  for (const y of [20, 45, 70]) {
    plated(g, 5, 4, 5, M.yellow, 0, y, 0, 0, 0, 0, 1.4);
    for (const s2 of [-1, 1]) g.add(mesh(D.box(3, 1, 0.2, 0.03), M.window, 0, y + 0.6, s2 * 2.55));
    for (const s2 of [-1, 1]) g.add(mesh(D.box(1, 1.6, 1, 0.1), M.dark, s2 * 2.8, y - 1.4, 0));
  }
  return g;
}
// 巨型太陽能陣列：一排傾斜的大型面板
function solarField() {
  const g = new THREE.Group();
  // 太陽能陣列：支柱、轉軸、面板（格線）、背面的框
  for (let i = 0; i < 4; i++) {
    const x = -12 + i * 8;
    g.add(mesh(D.cyl(0.3, 0.4, 6, 10), M.steel, x, 3, 0));
    g.add(mesh(D.cyl(0.25, 0.25, 7.4, 10), M.dark, x, 6.2, 0, 0, 0, HP));
    const p = new THREE.Group();
    p.position.set(x, 6.4, 0);
    p.rotation.x = 0.5;
    g.add(p);
    p.add(mesh(D.box(7, 0.3, 10, 0.05), M.blue, 0, 0, 0));
    for (let k = -2; k <= 2; k++) p.add(mesh(D.box(7.02, 0.32, 0.08, 0.01), M.steel, 0, 0, k * 2));
    for (let k = -1; k <= 1; k++) p.add(mesh(D.box(0.08, 0.32, 10.02, 0.01), M.steel, k * 2.33, 0, 0));
    for (const s2 of [-1, 1]) bar(p, M.steel, [s2 * 3.3, -0.3, -4.8], [s2 * 3.3, -0.3, 4.8], 0.15);
  }
  return g;
}
// 失事的運輸艦：斷成兩截的艦體
function brokenFreighter() {
  const g = new THREE.Group();
  // 斷成兩截的運輸艦：前段（艦橋、窗）＋後段（引擎）＋斷口的骨架與暗處、散落的貨櫃
  const f = new THREE.Group();
  f.position.set(-2, 3, -8);
  f.rotation.set(0.05, 0.1, 0.1);
  g.add(f);
  plated(f, 8, 6, 18, M.hull, 0, 0, 0, 0, 0, 0, 1.6);
  plated(f, 5, 2.4, 5, M.hullD, 0, 4.2, -4, 0, 0, 0, 9);
  f.add(mesh(D.box(4, 0.8, 0.2, 0.03), M.window, 0, 4.4, -6.55));
  f.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.5, 0.5],
          [2.8, 2],
          [2, 4],
        ],
        14,
      ),
      M.dark,
      0,
      0,
      -10,
      -HP,
      0,
      0,
    ),
  );
  f.add(mesh(D.box(7.6, 5.6, 0.2, 0.02), M.dark, 0, 0, 9.05));
  for (let i = 0; i < 5; i++)
    bar(f, M.steel, [-3.5 + i * 1.75, -2.8, 9], [-3.5 + i * 1.75 + 0.6, 2.4, 10.8], 0.18);
  const b = new THREE.Group();
  b.position.set(3, 2.5, 10);
  b.rotation.set(-0.1, -0.3, -0.15);
  g.add(b);
  plated(b, 8, 6, 14, M.hullD, 0, 0, 0, 0, 0, 0, 1.6);
  for (const s2 of [-1, 1])
    b.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [1.6, 0.3],
            [2.1, 1.5],
            [2, 4],
            [1.6, 5],
          ],
          16,
        ),
        M.hull,
        s2 * 2.4,
        0,
        7,
        HP,
        0,
        0,
      ),
    );
  for (let i = 0; i < 4; i++) cont(g, M.blue, -10 + i * 5, 1.3, 6 + (i % 2) * 3, i * 0.8);
  return g;
}
// 深空天線：高桅杆＋大碟朝上
function deepAntenna() {
  const g = new THREE.Group();
  // 深空天線：基座建物、旋轉台、支柱（格子）、碟形反射面（背架）、饋源與支撐腳
  plated(g, 6, 4, 6, M.concrete, 0, 2, 0, 0, 0, 0, 9);
  g.add(mesh(D.cyl(3.4, 3.6, 1, 20, 0.1), M.dark, 0, 4.5, 0));
  {
    const lt = new THREE.Group();
    lt.position.y = 5;
    g.add(lt);
    lattice(lt, M.steel, 3, 1.4, 14, 0, 0, 4, 0.3);
  }
  const d = new THREE.Group();
  d.position.y = 26;
  d.rotation.x = Math.PI;
  g.add(d);
  d.add(mesh(new THREE.SphereGeometry(8, 28, 8, 0, Math.PI * 2, 0, 0.7), M.dish));
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    bar(d, M.steel, [0, -8, 0], [Math.cos(a) * 5.2, -6.2, Math.sin(a) * 5.2], 0.2);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    bar(d, M.steel, [Math.cos(a) * 5, -6.3, Math.sin(a) * 5], [0, -12, 0], 0.15);
  }
  d.add(mesh(D.cyl(0.7, 0.5, 1.4, 12), M.dark, 0, -12, 0));
  return g;
}
// 斷裂的環形結構：巨大圓環的一段立在平台上
function brokenRing() {
  const g = new THREE.Group();
  // 斷裂的居住環：環形的艙段（剖面旋轉一段角度）、窗帶、輻條、斷口
  const r = new THREE.Group();
  r.rotation.y = 0.3;
  r.position.y = -2;
  g.add(r);
  r.add(mesh(new THREE.TorusGeometry(14, 1.6, 10, 36, Math.PI * 0.8), M.hull, 0, 0, 0));
  r.add(mesh(new THREE.TorusGeometry(15.6, 0.3, 6, 36, Math.PI * 0.8), M.window, 0, 0, 0));
  for (let i = 0; i <= 6; i++) {
    const a = (i / 6) * Math.PI * 0.8;
    r.add(
      mesh(
        new THREE.TorusGeometry(1.7, 0.25, 6, 14),
        M.hullD,
        Math.cos(a) * 14,
        Math.sin(a) * 14,
        0,
        0,
        HP,
        a,
      ),
    );
  }
  for (const a of [0.3, 1.2, 2.1])
    bar(r, M.steel, [Math.cos(a) * 13, Math.sin(a) * 13, 0], [Math.cos(a) * 4, Math.sin(a) * 4, 0], 0.6);
  rubble(g, 0, 0, 14, 12, 139, M.hullD);
  return g;
}
// 居住艙模組：圓筒艙橫放、連接通道
function habModule() {
  const g = new THREE.Group();
  // 居住艙：兩個圓頂端的艙（窗、接合環、天線）＋連接通道＋支腳
  for (const x of [-7, 7]) {
    g.add(
      mesh(
        D.lathe(
          [
            [0, -6],
            [2, -5.6],
            [3, -4.6],
            [3, 4.6],
            [2, 5.6],
            [0, 6],
          ],
          18,
        ),
        M.white,
        x,
        3,
        0,
        HP,
        0,
        0,
      ),
    );
    for (const z of [-3, 0, 3]) g.add(mesh(D.cyl(3.08, 3.08, 0.3, 18), M.hullD, x, 3, z, HP, 0, 0));
    g.add(mesh(D.box(4, 1, 0.2, 0.03), M.window, x, 4, -6.05));
    for (const z of [-4, 4])
      for (const s2 of [-1, 1]) bar(g, M.steel, [x + s2 * 2, 0, z], [x + s2 * 1.2, 1.2, z], 0.3);
    bar(g, M.steel, [x, 6, 2], [x + 0.5, 9, 2], 0.12);
  }
  g.add(mesh(D.cyl(1.4, 1.4, 8, 14, 0.05), M.steel, 0, 3, 0, 0, 0, HP));
  for (const x of [-2.5, 2.5]) g.add(mesh(D.cyl(1.6, 1.6, 0.4, 14), M.dark, x, 3, 0, 0, 0, HP));
  return g;
}

// ---------- 洋上都市 ----------
// 巨型風力發電機：高柱＋三片長葉片
function seaTurbine() {
  const g = new THREE.Group();
  // 海上風力機：基礎（剖面）、塔身、機艙、輪轂、葉片（扭轉）、維修平台
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [4, 0],
          [4, 2],
          [2.4, 3],
          [0, 3],
        ],
        20,
      ),
      M.yellow,
      0,
      0,
      0,
    ),
  );
  g.add(
    mesh(
      D.lathe(
        [
          [0, 3],
          [2.2, 3],
          [1.4, 36],
          [0, 36],
        ],
        18,
      ),
      M.white,
      0,
      0,
      0,
    ),
  );
  g.add(mesh(D.cyl(3.6, 3.6, 0.3, 20), M.dark, 0, 3.2, 0));
  rail(
    g,
    M.yellow,
    Array.from({ length: 21 }, (_, i) => [
      Math.cos((i / 20) * Math.PI * 2) * 3.4,
      3.35,
      Math.sin((i / 20) * Math.PI * 2) * 3.4,
    ]),
  );
  g.add(
    mesh(
      D.lathe(
        [
          [0, -3.5],
          [1.4, -3],
          [1.7, 0],
          [1.5, 2.8],
          [0, 3.4],
        ],
        14,
      ),
      M.white,
      0,
      36.6,
      0.8,
      HP,
      0,
      0,
    ),
  );
  const hub = new THREE.Group();
  hub.position.set(0, 36.6, -2.6);
  g.add(hub);
  hub.add(
    mesh(
      D.lathe(
        [
          [0, -1.3],
          [0.9, -0.6],
          [1.1, 0.5],
          [0, 0.7],
        ],
        12,
      ),
      M.white,
      0,
      0,
      0,
      -HP,
      0,
      0,
    ),
  );
  for (let i = 0; i < 3; i++)
    hub.add(mesh(D.blade(16, 1.5, 0.5, 0.3, 0.3), M.white, 0, 0, 0, 0, 0, HP + (i * Math.PI * 2) / 3));
  rot(hub, 0, 0, 0.3);
  return g;
}
// 玻璃穹頂：半球形的植物園
function glassDome() {
  const g = new THREE.Group();
  // 玻璃溫室：測地線的骨架（低段數的球＋框）、基座、裡面的樹（剖面旋轉的樹冠）、入口
  g.add(mesh(new THREE.SphereGeometry(10, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.window));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(new THREE.TorusGeometry(10.05, 0.12, 4, 24, Math.PI / 2), M.white, 0, 0, 0, 0, a, HP));
  }
  for (const y of [3, 6, 8.5]) {
    const r = Math.sqrt(100 - y * y) + 0.05;
    g.add(mesh(new THREE.TorusGeometry(r, 0.12, 4, 36), M.white, 0, y, 0, HP, 0, 0));
  }
  g.add(mesh(D.cyl(10.4, 10.6, 1, 28, 0.1), M.white, 0, 0.5, 0));
  for (let i = 0; i < 6; i++) {
    const x = Math.cos(i) * 5,
      z = Math.sin(i) * 5;
    g.add(mesh(D.cyl(0.25, 0.35, 3, 8), M.rustD, x, 1.5, z));
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [1.6, 0.6],
            [1.4, 2],
            [0.6, 3],
            [0, 3.2],
          ],
          8,
        ),
        M.green,
        x,
        2.6,
        z,
      ),
    );
  }
  plated(g, 3, 3, 2, M.white, 0, 1.5, -10.2, 0, 0, 0, 9);
  return g;
}
// 斷裂的高架單軌：橋墩與掉下去的車廂
function brokenMonorail() {
  const g = new THREE.Group();
  // 斷裂的單軌：橋墩（往上收、T 字托架）、軌道樑、斷口的鋼筋、墜落的車廂（窗帶）
  for (const x of [-14, 0]) {
    g.add(
      mesh(
        D.extrude(
          [
            [-1.2, 0],
            [1.2, 0],
            [0.9, 11],
            [-0.9, 11],
          ],
          2,
          0.1,
        ),
        M.white,
        x,
        0,
        0,
      ),
    );
    g.add(mesh(D.box(2.4, 0.8, 3.6, 0.1), M.white, x, 11.6, 0));
  }
  plated(g, 24, 1.2, 3, M.white, -8, 12.6, 0, 0, 0, 0, 9);
  for (let i = 0; i < 5; i++)
    bar(g, M.rust, [4, 12.2, -1.2 + i * 0.6], [5 + (i % 2) * 0.6, 11.2, -1.2 + i * 0.6], 0.1);
  const car = new THREE.Group();
  car.position.set(9, 4, 0);
  car.rotation.set(0, 0.2, -0.7);
  g.add(car);
  car.add(mesh(D.box(12, 3, 3, 0.4), M.blue, 0, 0, 0));
  for (const s2 of [-1, 1]) car.add(mesh(D.box(10, 1, 0.1, 0.02), M.window, 0, 0.5, s2 * 1.52));
  car.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.4, 0.3],
          [1.5, 1.6],
          [0, 2],
        ],
        10,
      ),
      M.blue,
      6,
      0,
      0,
      0,
      0,
      -HP,
    ),
  );
  rubble(g, 10, 0, 6, 10, 149, M.white);
  return g;
}
// 海上鑽油平台：四支腳撐起的平台與吊臂
function oilRig() {
  const g = new THREE.Group();
  // 鑽油平台：四支腳（斜撐）、兩層甲板（欄杆）、居住區、井架（格子）、吊臂、直升機甲板
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      g.add(mesh(D.cyl(1, 1.2, 14, 14, 0.05), M.yellow, sx * 7, 7, sz * 7));
      for (const y of [3, 9]) g.add(mesh(D.cyl(1.25, 1.25, 0.4, 14), M.dark, sx * 7, y, sz * 7));
    }
  for (const [a, b] of [
    [
      [-7, 2, -7],
      [7, 10, -7],
    ],
    [
      [7, 2, 7],
      [-7, 10, 7],
    ],
    [
      [-7, 2, 7],
      [-7, 10, -7],
    ],
    [
      [7, 2, -7],
      [7, 10, 7],
    ],
  ])
    bar(g, M.yellow, a, b, 0.5);
  plated(g, 18, 1.4, 18, M.hullD, 0, 14, 0, 0, 0, 0, 9);
  rail(g, M.yellow, [
    [-9, 14.7, -9],
    [9, 14.7, -9],
    [9, 14.7, 9],
    [-9, 14.7, 9],
    [-9, 14.7, -9],
  ]);
  plated(g, 6, 6, 6, M.white, -4, 18, -4, 0, 0, 0, 2);
  for (const y of [16.5, 19]) g.add(mesh(D.box(5, 0.8, 0.2, 0.03), M.window, -4, y, -7.05));
  {
    const lt = new THREE.Group();
    lt.position.set(4, 14.7, 4);
    g.add(lt);
    lattice(lt, M.yellow, 4, 1.4, 16, 0, 0, 4, 0.3);
  }
  bar(g, M.yellow, [5, 15, 2], [5, 23, -8], 0.8);
  g.add(mesh(D.cyl(3, 3, 0.4, 8), M.hullD, -4, 21.2, -4));
  g.add(mesh(D.cyl(1.8, 1.8, 0.05, 8), M.yellow, -4, 21.45, -4));
  return g;
}
// 擱淺的貨櫃船：傾斜的船身與成堆的貨櫃
function containerShip() {
  const g = new THREE.Group();
  const h = new THREE.Group();
  // 貨櫃船：船殼（船首往上收、水線帶）、甲板上的貨櫃列、船尾的艙樓（窗帶、煙囪、雷達桅）
  h.add(
    mesh(
      D.extrude(
        [
          [-17, 0.5],
          [13, 0],
          [17, 3.5],
          [17.6, 6],
          [-17, 6],
        ],
        10,
        0.3,
      ),
      M.red,
      0,
      0,
      0,
      0,
      -HP,
      0,
    ),
  );
  for (const s2 of [-1, 1]) h.add(mesh(D.box(0.2, 0.8, 34, 0.04), M.dark, s2 * 5.02, 1.4, 0.3));
  for (let i = 0; i < 4; i++)
    for (let k = 0; k < 2; k++) cont(h, i % 2 ? M.blue : M.green, 0, 7.3 + k * 2.6, -12 + i * 6, HP);
  plated(h, 8, 8, 5, M.white, 0, 10, 14, 0, 0, 0, 2);
  for (const y of [8, 10, 12]) h.add(mesh(D.box(7.6, 0.8, 0.2, 0.02), M.window, 0, y, 11.45));
  h.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.4, 0],
          [1.2, 4],
          [1.4, 4.3],
          [0, 4.3],
        ],
        14,
      ),
      M.dark,
      0,
      14,
      15.5,
    ),
  );
  {
    const lt = new THREE.Group();
    lt.position.set(2, 14, 13);
    h.add(lt);
    lattice(lt, M.steel, 0.8, 0.3, 4, 0, 0, 2, 0.12);
  }
  rot(h, 0, 0.2, 0.12);
  g.add(h);
  return g;
}
// 都市的紀念塔：細長的尖塔與環
function citySpire() {
  const g = new THREE.Group();
  // 都市尖塔：往上收的塔身（剖面）、兩圈發光的觀景環（有支柱）、頂部的天線、基座
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [3, 0],
          [2.4, 10],
          [1.4, 26],
          [0.5, 40],
          [0, 40],
        ],
        16,
      ),
      M.steel,
      0,
      0,
      0,
    ),
  );
  for (const y of [14, 26]) {
    g.add(mesh(new THREE.TorusGeometry(4, 0.4, 8, 28), M.window, 0, y, 0, HP, 0, 0));
    g.add(mesh(D.cyl(4.4, 4.4, 0.3, 28), M.hullD, 0, y - 0.6, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      bar(
        g,
        M.steel,
        [Math.cos(a) * 1.6, y - 3, Math.sin(a) * 1.6],
        [Math.cos(a) * 4, y - 0.6, Math.sin(a) * 4],
        0.2,
      );
    }
  }
  g.add(mesh(D.cyl(0.08, 0.15, 8, 6), M.steel, 0, 44, 0));
  plated(g, 8, 2, 8, M.concrete, 0, 1, 0, 0, 0, 0, 9);
  return g;
}

// ---------- Grid 086 ----------
// 斷裂的主樑：巨大的鋼樑從高處斜插到地面
function brokenGirder() {
  const g = new THREE.Group();
  // 斷裂的主樑：箱形的支柱（加勁板）＋斜倒的 I 字樑（翼板、腹板、加勁肋）＋斷口
  plated(g, 4, 30, 4, M.hullD, -10, 15, 0, 0, 0, 0, 3);
  const b = new THREE.Group();
  b.position.set(4, 12, 0);
  b.rotation.z = -0.65;
  g.add(b);
  for (const y of [-1.4, 1.4]) b.add(mesh(D.box(34, 0.3, 3, 0.04), M.rust, 0, y, 0));
  b.add(mesh(D.box(34, 2.6, 0.4, 0.04), M.rust, 0, 0, 0));
  for (let x = -16; x <= 16; x += 2.2)
    for (const s2 of [-1, 1]) b.add(mesh(D.box(0.2, 2.5, 1.2, 0.02), dk(M.rust, 0.8), x, 0, s2 * 0.8));
  for (let i = 0; i < 5; i++)
    g.add(rot(mesh(D.box(2, 0.6, 3.4, 0.08), M.steel, -4 + i * 4.4, 15 - i * 3.4, 0), 0, 0, -0.65));
  rubble(g, 14, 0, 7, 10, 151, M.hullD);
  return g;
}
// Doser 聚落：棚屋圍成一圈，中間有篝火與旗桿
function doserCamp() {
  const g = new THREE.Group();
  // 拾荒者的營地：一圈的貨櫃屋（門、窗、屋頂的雜物）、營火（石圈）、旗杆、帆布棚
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const o = new THREE.Group();
    o.position.set(Math.cos(a) * 9, 0, Math.sin(a) * 9);
    o.rotation.y = -a;
    g.add(o);
    plated(o, 5, 3.6, 4, i % 2 ? M.rustD : M.hull, 0, 1.8, 0, 0, 0, 0, 9);
    o.add(mesh(D.box(1, 2.2, 0.1, 0.02), M.dark, -2.55, 1.1, 0, 0, HP, 0));
    o.add(mesh(D.box(0.1, 0.8, 1.2, 0.02), M.window, -2.55, 2.3, 1.2));
    o.add(mesh(D.box(1.4, 0.8, 1, 0.1), M.steel, 1, 4, 0.6));
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const st = mesh(
      D.rock((i % 24) + 1, 1, 0.3, 0.5, 0),
      M.concrete,
      Math.cos(a) * 1.4,
      0.2,
      Math.sin(a) * 1.4,
    );
    st.scale.setScalar(0.4);
    g.add(st);
  }
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [0.8, 0],
          [0.2, 1.6],
          [0, 1.8],
        ],
        8,
      ),
      M.glow,
      0,
      0.1,
      0,
    ),
  );
  g.add(mesh(D.cyl(0.1, 0.12, 10, 6), M.steel, 3, 5, 3));
  g.add(mesh(D.box(2.4, 1.4, 0.05, 0.01), M.red, 4.2, 9.2, 3));
  g.add(
    mesh(
      D.extrude(
        [
          [-3, 0],
          [3, 0],
          [0, 1.6],
        ],
        4,
        0.05,
      ),
      M.orange,
      -4,
      3,
      -4,
      0,
      0.6,
      0,
    ),
  );
  return g;
}
// 貨運升降井：方形的豎井框架與停在中間的貨台
function cargoShaft() {
  const g = new THREE.Group();
  // 貨物豎井：四支柱（加勁）、每層的橫樑與斜撐、懸吊的升降台（欄杆、鋼索）、頂部的滑輪
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) plated(g, 1.6, 34, 1.6, M.hullD, sx * 7, 17, sz * 7, 0, 0, 0, 3);
  for (let y = 6; y < 34; y += 7)
    for (const s2 of [-1, 1]) {
      g.add(mesh(D.box(14, 0.6, 0.6, 0.06), M.rust, 0, y, s2 * 7));
      g.add(mesh(D.box(0.6, 0.6, 14, 0.06), M.rust, s2 * 7, y, 0));
      bar(g, M.rust, [-7, y, s2 * 7], [7, y + 7, s2 * 7], 0.3);
    }
  plated(g, 12, 1, 12, M.steel, 0, 14, 0, 0, 0, 0, 9);
  rail(g, M.yellow, [
    [-5.8, 14.5, -5.8],
    [5.8, 14.5, -5.8],
    [5.8, 14.5, 5.8],
    [-5.8, 14.5, 5.8],
    [-5.8, 14.5, -5.8],
  ]);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) g.add(mesh(D.cyl(0.06, 0.06, 20, 4), M.dark, sx * 5, 24.5, sz * 5));
  for (const s2 of [-1, 1]) g.add(mesh(new THREE.TorusGeometry(1.4, 0.3, 6, 16), M.dark, s2 * 3, 34.6, 0));
  return g;
}
// 停機的巨型步行機：四隻長腳的巨大機體，關節彎曲
function giantWalker() {
  const g = new THREE.Group();
  // 停機的巨型步行機：機身（板金、裝甲板）、頭部（感測器）、四支腳（大腿、膝的關節、小腿、腳掌）
  plated(g, 14, 6, 10, M.hullD, 0, 16, 0, 0, 0, 0, 1.8);
  for (const s2 of [-1, 1]) plated(g, 0.6, 4, 8, M.hull, s2 * 7.3, 16, 0, 0, 0, 0, 9);
  plated(g, 6, 4, 4, M.hull, 0, 17, -7, 0, 0, 0, 9);
  g.add(mesh(D.box(3, 0.6, 0.3, 0.05), M.glow, 0, 17.6, -9.1));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const hip = [sx * 7, 14, sz * 4],
        knee = [sx * 11, 17, sz * 7.5],
        foot = [sx * 12, 0.8, sz * 9];
      bar(g, M.hull, hip, knee, 1.6);
      g.add(mesh(D.cyl(1.3, 1.3, 2, 14, 0.1), M.dark, knee[0], knee[1], knee[2], 0, 0, HP));
      bar(g, M.hullD, knee, foot, 1.4);
      g.add(
        mesh(
          D.lathe(
            [
              [0, 0],
              [2, 0],
              [1.6, 0.8],
              [0.8, 1.2],
              [0, 1.2],
            ],
            10,
          ),
          M.hullD,
          foot[0],
          0,
          foot[2],
        ),
      );
      pipe(
        g,
        M.dark,
        [
          [hip[0], hip[1] - 1, hip[2]],
          [knee[0] - sx * 0.8, knee[1] - 1.6, knee[2]],
          [foot[0], 4, foot[2]],
        ],
        0.2,
      );
    }
  rubble(g, 0, 0, 12, 8, 157);
  return g;
}
// 構造體核心柱：一根粗大的柱子貫穿上下，表面有發光的管線
function coreColumn() {
  const g = new THREE.Group();
  // 構造體的核心柱：柱身（剖面、往上收）、發光的導管、三圈的作業環（欄杆）、管線
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [7.2, 0],
          [7, 2],
          [6, 38],
          [5, 40],
          [0, 40],
        ],
        20,
      ),
      M.hullD,
      0,
      0,
      0,
    ),
  );
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    g.add(mesh(D.box(0.5, 36, 0.5, 0.05), M.glow, Math.cos(a) * 6.6, 18, Math.sin(a) * 6.6));
    for (const s2 of [-1, 1])
      g.add(
        mesh(
          D.box(0.3, 36, 0.6, 0.05),
          M.dark,
          Math.cos(a + s2 * 0.12) * 6.5,
          18,
          Math.sin(a + s2 * 0.12) * 6.5,
          0,
          -a,
          0,
        ),
      );
  }
  for (const y of [11, 21, 31]) {
    g.add(mesh(D.cyl(8, 8, 0.8, 24, 0.08), M.rust, 0, y, 0));
    rail(
      g,
      M.yellow,
      Array.from({ length: 25 }, (_, i) => [
        Math.cos((i / 24) * Math.PI * 2) * 7.8,
        y + 0.4,
        Math.sin((i / 24) * Math.PI * 2) * 7.8,
      ]),
    );
  }
  pipe(
    g,
    M.steel,
    [
      [7, 2, 2],
      [9, 6, 3],
      [9, 18, 3],
      [6.8, 21, 2],
    ],
    0.6,
  );
  return g;
}
// 巨型熔爐：方形的爐體、發光的爐口與傾倒的熔渣
function bigFurnace() {
  const g = new THREE.Group();
  // 巨型熔爐：爐體（耐火磚的帶）、發光的爐口與流出的熔渣、煙囪（補強環）、投料的斜槽、管線
  plated(g, 14, 16, 12, M.rustD, 0, 8, 0, 0, 0, 0, 2);
  g.add(mesh(D.box(6, 5, 0.4, 0.05), M.glow, 0, 4, -6.2));
  g.add(mesh(D.box(7.2, 6.2, 0.6, 0.1), M.dark, 0, 4.2, -6.1));
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.4, 0],
          [2, 10],
          [2.2, 10.4],
          [0, 10.4],
        ],
        16,
      ),
      M.dark,
      4,
      16,
      2,
    ),
  );
  for (let y = 18; y < 26; y += 2.5)
    g.add(mesh(D.cyl(2.3 - (y - 16) * 0.04, 2.3 - (y - 16) * 0.04, 0.3, 16), M.rust, 4, y, 2));
  g.add(rot(mesh(D.box(5, 0.4, 10, 0.05), M.glow, 0, 0.3, -11), 0.05, 0, 0));
  bar(g, M.steel, [-4, 16, -3], [-10, 8, -10], 1.4);
  for (const s2 of [-1, 1])
    pipe(
      g,
      M.steel,
      [
        [s2 * 7, 12, 3],
        [s2 * 9, 12, 3],
        [s2 * 9, 0.5, 3],
      ],
      0.5,
    );
  scorch(g, 10, 12, 0, -10);
  return g;
}

// ---------- 舊宇宙港 ----------
// 倒下的火箭：長長的箭體倒在地上，引擎噴口朝外
function fallenRocket() {
  const g = new THREE.Group();
  // 倒下的火箭：剖面旋轉的箭體（級間的環、窗）、整流罩、引擎噴口、翼、管線
  const r = new THREE.Group();
  r.position.y = 3.2;
  r.rotation.z = HP;
  g.add(r);
  r.add(
    mesh(
      D.lathe(
        [
          [0, -17],
          [3.2, -16.6],
          [3.2, 17],
          [2.2, 20],
          [0.4, 23],
          [0, 23.2],
        ],
        20,
      ),
      M.white,
      0,
      0,
      0,
    ),
  );
  for (const y of [-8, 2, 12]) r.add(mesh(D.cyl(3.26, 3.26, 0.5, 20), M.dark, 0, y, 0));
  r.add(mesh(D.box(4, 1, 0.2, 0.03), M.red, 0, 6, 3.18));
  for (const s2 of [-1, 1]) {
    r.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [1.4, 0],
            [2.2, -3],
            [2, -3.2],
          ],
          14,
        ),
        M.dark,
        s2 * 1.5,
        -17,
        s2 * 1.2,
      ),
    );
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    r.add(
      mesh(
        D.extrude(
          [
            [0, 0],
            [3, -2],
            [3, -5],
            [0, -4],
          ],
          0.3,
          0.05,
        ),
        M.red,
        Math.cos(a) * 3.1,
        -12,
        Math.sin(a) * 3.1,
        0,
        -a,
        0,
      ),
    );
  }
  rubble(g, 0, 0, 16, 14, 163, M.white);
  scorch(g, 34, 10, 0, 0);
  return g;
}
// 巨型通訊天線：台座＋傾斜的大碟
function bigDish() {
  const g = new THREE.Group();
  // 巨型碟形天線：建物、旋轉台與仰角架（扇形齒輪）、碟面（背架、饋源三腳架）
  plated(g, 8, 6, 8, M.concrete, 0, 3, 0, 0, 0, 0, 9);
  g.add(mesh(D.cyl(3.6, 3.8, 1.2, 20, 0.1), M.dark, 0, 6.6, 0));
  for (const s2 of [-1, 1]) plated(g, 0.8, 6, 3, M.steel, s2 * 2, 10, 0, 0, 0, 0, 9);
  g.add(mesh(D.cyl(0.6, 0.6, 5, 12), M.dark, 0, 12.6, 0, 0, 0, HP));
  const d = new THREE.Group();
  d.position.set(0, 14, 2);
  d.rotation.x = -0.9;
  g.add(d);
  d.add(mesh(new THREE.SphereGeometry(10, 30, 8, 0, Math.PI * 2, 0, 0.7), M.dish, 0, 10, 0, Math.PI, 0, 0));
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    bar(d, M.steel, [0, 0.4, 0], [Math.cos(a) * 6.4, 2.4, Math.sin(a) * 6.4], 0.2);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    bar(d, M.steel, [Math.cos(a) * 6, 2.6, Math.sin(a) * 6], [0, 8, 0], 0.18);
  }
  d.add(mesh(D.cyl(0.8, 0.6, 1.6, 12), M.dark, 0, 8, 0));
  return g;
}
// 太空梭殘骸：機身、三角翼、垂直尾翼，翼端斷掉
function shuttleWreck() {
  const g = new THREE.Group();
  // 太空梭殘骸：機身（剖面旋轉、機首）、三角翼（翼剖面、隔熱瓦的暗色）、垂直尾翼、引擎、貨艙門
  g.add(
    mesh(
      D.lathe(
        [
          [0, -14],
          [2.4, -13],
          [3, -10],
          [3, 11],
          [2.6, 14],
          [0, 14],
        ],
        18,
      ),
      M.white,
      0,
      3.2,
      0,
      HP,
      0,
      0,
    ),
  );
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.4, 1.2],
          [1.6, 3.6],
          [0.4, 4.6],
          [0, 4.7],
        ],
        18,
      ),
      M.white,
      0,
      3.2,
      -14,
      -HP,
      0,
      0,
    ),
  );
  g.add(mesh(D.box(2, 0.8, 0.2, 0.03), M.window, 0, 5.4, -13.2, -0.6, 0, 0));
  g.add(
    mesh(
      D.extrude(
        [
          [-11, 0],
          [11, 0],
          [2.2, 14],
          [-2.2, 14],
        ],
        0.8,
        0.2,
      ),
      M.white,
      0,
      1.6,
      11,
      -HP,
      0,
      0,
    ),
  );
  g.add(
    mesh(
      D.extrude(
        [
          [-10, 0],
          [10, 0],
          [2, 12.5],
          [-2, 12.5],
        ],
        0.82,
        0.2,
      ),
      M.dark,
      0,
      1.0,
      11,
      -HP,
      0,
      0,
    ),
  );
  g.add(
    mesh(
      D.extrude(
        [
          [0, 0],
          [6, 0],
          [5, 9],
          [2, 9],
        ],
        0.8,
        0.15,
      ),
      M.white,
      0,
      4,
      14,
      0,
      HP,
      0,
    ),
  );
  for (const [x, y] of [
    [-1.5, 2],
    [1.5, 2],
    [0, 4.2],
  ])
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [0.9, 0],
            [1.4, 1.8],
          ],
          12,
        ),
        M.dark,
        x,
        2.2 + y * 0.4,
        14.2,
        HP,
        0,
        0,
      ),
    );
  g.add(mesh(D.box(4.6, 0.2, 14, 0.03), M.hullD, 0, 6.2, 0));
  rubble(g, 0, 0, 14, 12, 167, M.white);
  return g;
}
// 液態燃料大槽：三座球形燃料槽與連接管
function fuelFarm() {
  const g = new THREE.Group();
  // 球形燃料槽群：球（赤道的環）、支柱（斜撐）、爬梯、頂部的平台、連接的管線
  for (const [x, z] of [
    [-8, 0],
    [8, 0],
    [0, 10],
  ]) {
    g.add(mesh(new THREE.SphereGeometry(6, 24, 16), M.white, x, 8, z));
    g.add(mesh(D.cyl(6.08, 6.08, 0.4, 24), M.orange, x, 8, z));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const px = x + Math.cos(a) * 5.2,
        pz = z + Math.sin(a) * 5.2;
      g.add(mesh(D.cyl(0.3, 0.35, 8, 10), M.steel, px, 4, pz));
      const a2 = ((i + 1) / 6) * Math.PI * 2;
      bar(g, M.steel, [px, 0.5, pz], [x + Math.cos(a2) * 5.2, 6, z + Math.sin(a2) * 5.2], 0.15);
    }
    g.add(mesh(D.cyl(1.4, 1.4, 0.2, 14), M.steel, x, 14.1, z));
    pipe(
      g,
      M.steel,
      [
        [x + 4.4, 13, z],
        [x + 6.5, 8, z],
        [x + 6.5, 0.5, z],
      ],
      0.15,
    );
  }
  pipe(
    g,
    M.steel,
    [
      [-8, 1.2, 0],
      [0, 1.2, 0],
      [8, 1.2, 0],
    ],
    0.6,
  );
  pipe(
    g,
    M.steel,
    [
      [0, 1.2, 0],
      [0, 1.2, 10],
    ],
    0.6,
  );
  return g;
}
// 組裝塔：高大的格子塔與懸臂
function assemblyTower() {
  const g = new THREE.Group();
  // 組裝塔：紅色的格子塔（每層平台）、兩支擺臂（桁架）、頂部的吊車、電梯井
  {
    const lt = new THREE.Group();
    g.add(lt);
    lattice(lt, M.red, 6.6, 6, 44, 0, 0, 11, 0.45);
  }
  for (let y = 4; y < 44; y += 6) g.add(mesh(D.box(7, 0.4, 7, 0.05), M.steel, 0, y, 0));
  for (const y of [20, 34]) {
    const arm = new THREE.Group();
    arm.position.set(3.4, y, 0);
    g.add(arm);
    for (const [yy, zz] of [
      [-0.5, -0.6],
      [-0.5, 0.6],
      [0.5, 0],
    ])
      bar(arm, M.red, [0, yy, zz], [10, yy, zz], 0.25);
    for (let x = 0; x < 10; x += 2) bar(arm, M.red, [x, -0.5, -0.6], [x + 2, 0.5, 0], 0.15);
  }
  plated(g, 2.4, 3, 8, M.red, 0, 45.5, 2, 0, 0, 0, 9);
  g.add(mesh(D.box(2, 44, 2, 0.05), M.dark, -2.2, 22, -2.2));
  return g;
}
// 墜落的軌道站碎片：環形的站體碎塊插在地上
function stationChunk() {
  const g = new THREE.Group();
  // 太空站的殘骸：環形的艙段（窗帶、補強肋）、斷裂的艙（板金、骨架露出）、散落的太陽能板
  const ring = new THREE.Group();
  ring.rotation.set(0.3, 0.4, 0);
  ring.position.y = 3;
  g.add(ring);
  ring.add(mesh(new THREE.TorusGeometry(10, 2, 10, 36, Math.PI * 0.9), M.hull));
  ring.add(mesh(new THREE.TorusGeometry(12, 0.35, 6, 36, Math.PI * 0.9), M.window));
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * Math.PI * 0.9;
    ring.add(
      mesh(
        new THREE.TorusGeometry(2.1, 0.25, 6, 14),
        M.hullD,
        Math.cos(a) * 10,
        Math.sin(a) * 10,
        0,
        0,
        HP,
        a,
      ),
    );
  }
  const c = new THREE.Group();
  c.position.set(4, 1.5, -2);
  c.rotation.set(0.2, 0.5, 0.3);
  g.add(c);
  plated(c, 8, 3, 6, M.hullD, 0, 0, 0, 0, 0, 0, 1.2);
  for (let i = 0; i < 4; i++) bar(c, M.steel, [4, -1.4, -2.8 + i * 1.8], [5.4, 1.4, -2.4 + i * 1.8], 0.15);
  for (let i = 0; i < 5; i++) {
    const p = mesh(D.box(1.5, 0.15, 3, 0.02), M.blue, -8 + i * 4, 0.3, 8, 0, i, 0.1);
    g.add(p);
  }
  rubble(g, 0, 0, 12, 10, 173, M.hullD);
  return g;
}

// ---------- 地下技研都市 ----------
const CORAL = new THREE.MeshStandardMaterial({
  color: 0xff3a30,
  emissive: 0xff2010,
  emissiveIntensity: 1.4,
  roughness: 0.3,
});
// Coral 反應爐：圓筒爐心＋四根冷卻柱＋發光的爐口
function coralReactor() {
  const g = new THREE.Group();
  // 反應爐：爐體（剖面、補強環、觀察窗）＋頂部發光的 Coral 核心與蓋框＋四支冷卻柱（有環）與連接的管
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [7, 0],
          [7, 1],
          [6, 2],
          [6, 11],
          [6.6, 12],
          [0, 12],
        ],
        24,
      ),
      M.hullD,
      0,
      0,
      0,
    ),
  );
  for (const y of [4, 8]) g.add(mesh(D.cyl(6.15, 6.15, 0.4, 24), M.steel, 0, y, 0));
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    g.add(mesh(D.box(1.4, 0.8, 0.2, 0.03), CORAL, Math.cos(a) * 6.05, 6, Math.sin(a) * 6.05, 0, -a + HP, 0));
  }
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [3, 0],
          [3.2, 0.8],
          [2, 1.4],
          [0, 1.5],
        ],
        18,
      ),
      CORAL,
      0,
      12,
      0,
    ),
  );
  g.add(mesh(new THREE.TorusGeometry(3.4, 0.35, 8, 24), M.steel, 0, 12.6, 0, HP, 0, 0));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * 9,
      z = Math.sin(a) * 9;
    g.add(mesh(D.cyl(1.2, 1.4, 18, 14, 0.1), M.steel, x, 9, z));
    for (let y = 3; y < 18; y += 4) g.add(mesh(D.cyl(1.35, 1.35, 0.3, 14), M.dark, x, y, z));
    pipe(
      g,
      M.steel,
      [
        [x, 15, z],
        [Math.cos(a) * 6.5, 15, Math.sin(a) * 6.5],
        [Math.cos(a) * 5, 12.2, Math.sin(a) * 5],
      ],
      0.4,
    );
  }
  return g;
}
// 巨大結晶柱：從地面長到很高的 Coral 結晶
function coralSpire() {
  const g = new THREE.Group();
  // Coral 的晶柱：六角柱＋尖端、旁邊的小晶簇、底部的岩床（發光的裂縫）
  for (const [x, z, h, r, tx, tz] of [
    [0, 0, 28, 3, 0.05, 0],
    [3, 2, 16, 1.8, 0.3, 0.2],
    [-3, 1, 12, 1.5, -0.3, 0.1],
    [1, -3, 10, 1.3, 0.1, -0.35],
    [-2, -2.6, 7, 1, -0.2, -0.3],
    [4, -1.5, 6, 0.8, 0.45, -0.2],
  ])
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [r, 0],
            [r * 1.04, h * 0.78],
            [r * 0.25, h * 0.98],
            [0, h],
          ],
          6,
        ),
        CORAL,
        x,
        -0.5,
        z,
        tx,
        x * 0.7,
        tz,
      ),
    );
  const bed = mesh(D.rock(17, 3, 0.35, 0.5, 0.3), M.hullD, 0, 0, 0);
  bed.scale.set(6, 1.6, 6);
  g.add(bed);
  return g;
}
// 大型貨運升降梯：四角的導軌塔與停在中間的平台
function freightLift() {
  const g = new THREE.Group();
  // 貨運升降梯：四支格子柱、升降台（有欄杆、警示條、貨櫃）、頂部的卷揚機與鋼索、配重
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) lattice(g, M.yellow, 1.6, 1.4, 26, sx * 9, sz * 7, 6, 0.25);
  plated(g, 18, 1.2, 14, M.hullD, 0, 4, 0, 0, 0, 0, 9);
  rail(g, M.yellow, [
    [-8.6, 4.6, -6.6],
    [8.6, 4.6, -6.6],
    [8.6, 4.6, 6.6],
    [-8.6, 4.6, 6.6],
  ]);
  for (let x = -8; x < 8; x += 1.2)
    g.add(mesh(D.box(0.6, 0.05, 0.4, 0.01), x % 2.4 < 1.2 ? M.yellow : M.dark, x, 4.62, -6.6));
  cont(g, M.blue, -2, 5.9, 0);
  for (const sz of [-1, 1]) plated(g, 20, 1.2, 1.2, M.yellow, 0, 26.5, sz * 7, 0, 0, 0, 9);
  plated(g, 4, 3, 3, M.hull, 0, 28, 0, 0, 0, 0, 9);
  for (const x of [-6, 6]) for (const z of [-5, 5]) g.add(mesh(D.cyl(0.06, 0.06, 22, 4), M.dark, x, 15.5, z));
  plated(g, 2, 6, 1.4, M.concrete, 10, 14, 0, 0, 0, 0, 9);
  return g;
}
// 實驗體收容籠：格子籠與破掉的一面
function specimenCage() {
  const g = new THREE.Group();
  // 實驗體的籠子：上下的框（螺栓）、圓柱的鐵欄、破開的缺口（彎曲的欄）、裡面發光的實驗體殘骸
  plated(g, 14, 0.6, 10, M.hullD, 0, 0.3, 0, 0, 0, 0, 9);
  plated(g, 14, 0.6, 10, M.hullD, 0, 9.7, 0, 0, 0, 0, 9);
  for (let x = -7; x <= 7; x += 1.75)
    for (const z of [-5, 5])
      if (!(z === 5 && x > -2 && x < 3)) g.add(mesh(D.cyl(0.14, 0.14, 9.4, 8), M.steel, x, 5, z));
  for (let z = -5; z <= 5; z += 1.75)
    for (const x of [-7, 7]) g.add(mesh(D.cyl(0.14, 0.14, 9.4, 8), M.steel, x, 5, z));
  for (const x of [-1.2, 0.5, 2.2])
    pipe(
      g,
      M.steel,
      [
        [x, 0.6, 5],
        [x + 0.4, 3, 6.4],
        [x + 0.2, 6, 5.6],
        [x, 9.4, 5],
      ],
      0.14,
    );
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.2, 0],
          [1.8, 1.6],
          [1, 3],
          [0, 3.2],
        ],
        10,
      ),
      CORAL,
      0,
      0.6,
      0,
    ),
  );
  const blob = mesh(D.rock(19, 2, 0.4, 0.6, 0), M.hullD, 2, 1.4, -1);
  blob.scale.setScalar(1.5);
  g.add(blob);
  return g;
}
// 斷裂的輸送管：粗大的管線從高處斷開，一截倒在地上
function brokenTube() {
  const g = new THREE.Group();
  // 斷裂的輸送管：支柱、管（補強環、斷口的內部是暗色）、外漏的 Coral、垂下的電纜
  plated(g, 3, 16, 3, M.concrete, -12, 8, 0, 0, 0, 0, 4);
  const tube = (x, y, z, ry, rz) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    o.rotation.set(0, ry, rz);
    g.add(o);
    o.add(mesh(D.cyl(2.2, 2.2, 14, 18, 0.05), M.steel, 0, 0, 0));
    o.add(mesh(D.cyl(1.9, 1.9, 0.1, 18), M.dark, 0, 7.02, 0));
    for (let yy = -5; yy <= 5; yy += 2.5) o.add(mesh(D.cyl(2.32, 2.32, 0.35, 18), M.hullD, 0, yy, 0));
    return o;
  };
  tube(-5, 15, 0, 0, HP);
  tube(7, 6, 0, 0.2, HP + 0.7);
  g.add(mesh(D.cyl(1.4, 1.4, 0.3, 14), CORAL, 2, 11.2, 0));
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2, 0],
          [0.4, 1.6],
          [0, 1.7],
        ],
        8,
      ),
      CORAL,
      4,
      0,
      1,
    ),
  );
  for (let i = 0; i < 3; i++)
    g.add(mesh(D.cable([1.8, 14 - i * 0.3, -1 + i], [3, 1, -2 + i * 1.5], 0.08, 0.8, 6), M.dark));
  rubble(g, 6, 0, 7, 10, 137, M.hullD);
  return g;
}
// 研究所紀念碑：台座上的環形雕塑
function monument() {
  const g = new THREE.Group();
  // 紀念碑：三層的台座（銘板）、支柱、圓環（內圈的肋）、中心發光的 Coral 球、周圍的燈柱
  plated(g, 10, 2, 10, M.concrete, 0, 1, 0, 0, 0, 0, 9);
  plated(g, 6, 2, 6, M.concrete, 0, 3, 0, 0, 0, 0, 9);
  g.add(mesh(D.box(3, 1, 0.1, 0.02), M.steel, 0, 3, -3.06));
  g.add(mesh(new THREE.TorusGeometry(5, 0.7, 10, 36), M.steel, 0, 10, 0));
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(D.box(0.3, 1.2, 0.3, 0.04), M.dark, Math.cos(a) * 4.2, 10 + Math.sin(a) * 4.2, 0, 0, 0, a));
  }
  g.add(mesh(D.cyl(0.6, 0.8, 5, 12), M.steel, 0, 6.5, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.4, 2), CORAL, 0, 10, 0));
  for (const [x, z] of [
    [-4.5, -4.5],
    [4.5, -4.5],
    [-4.5, 4.5],
    [4.5, 4.5],
  ]) {
    g.add(mesh(D.cyl(0.12, 0.15, 3, 8), M.dark, x, 3.5, z));
    g.add(mesh(D.box(0.5, 0.3, 0.5, 0.04), CORAL, x, 5.1, z));
  }
  return g;
}

// ---------- 冰原 ----------
const SNOW = mat(0xf2f6fa, { roughness: 1, metalness: 0 });
// 凍結的破冰船：船身斜埋在冰裡、艦橋與煙囪
function icebreaker() {
  const g = new THREE.Group();
  const h = new THREE.Group();
  // 船殼（船首尖、往上外擴）＋舷側的水線帶、積雪的甲板、艙樓（三層、窗帶、雷達桅）、煙囪、吊臂
  h.add(
    mesh(
      D.extrude(
        [
          [-15, 0.5],
          [12, 0],
          [16, 3.5],
          [17, 6],
          [-15, 6],
        ],
        10,
        0.3,
      ),
      M.red,
      0,
      0,
      0,
      0,
      -HP,
      0,
    ),
  );
  for (const s2 of [-1, 1]) h.add(mesh(D.box(0.2, 0.8, 31, 0.04), M.dark, s2 * 5.02, 1.4, 0.5));
  h.add(mesh(D.box(10.4, 0.6, 31, 0.1), SNOW, 0, 6.2, 0.5));
  for (let i = 0; i < 3; i++) {
    plated(h, 7 - i * 1.2, 2, 7 - i, M.white, 0, 7.5 + i * 2, 6 - i * 0.3, 0, 0, 0, 9);
    h.add(mesh(D.box(7.2 - i * 1.2, 0.9, 0.2, 0.02), M.window, 0, 7.8 + i * 2, 2.45 + i * 0.2));
    h.add(mesh(D.box(7.4 - i * 1.2, 0.3, 7.4 - i, 0.04), SNOW, 0, 8.6 + i * 2, 6 - i * 0.3));
  }
  h.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.6, 0],
          [1.4, 6],
          [1.6, 6.3],
          [0, 6.3],
        ],
        14,
      ),
      M.dark,
      0,
      11,
      10,
    ),
  );
  {
    const lt = new THREE.Group();
    lt.position.y = 13.4;
    h.add(lt);
    lattice(lt, M.steel, 1, 0.3, 6, 0, 4, 3, 0.15);
  }
  bar(h, M.yellow, [-3, 6.4, -6], [-3, 12, -10], 0.4);
  h.add(mesh(D.cable([-3, 12, -10], [-3, 7, -11], 0.06, 0.1, 4), M.dark));
  rot(h, 0.06, 0.3, 0.14);
  h.position.y = -2;
  g.add(h);
  rubble(g, 0, -6, 12, 12, 107, SNOW);
  return g;
}
// 巨型雷達罩：球形雷達罩＋底座
function radome() {
  const g = new THREE.Group();
  // 雷達罩：基座（有門、通風口、外梯）＋球形罩（六角面板感：段數低的球＋縫）＋頂上的避雷針
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [8, 0],
          [7, 6],
          [0, 6],
        ],
        20,
      ),
      M.concrete,
      0,
      0,
      0,
    ),
  );
  g.add(mesh(new THREE.IcosahedronGeometry(9, 2), M.white, 0, 6, 0));
  g.add(mesh(D.cyl(7.2, 7.2, 0.4, 20), M.hullD, 0, 6.1, 0));
  g.add(mesh(D.box(3, 4, 0.4, 0.05), M.dark, 0, 2, 7.6));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    g.add(mesh(D.box(1.6, 0.8, 0.3, 0.04), M.dark, Math.cos(a) * 7.4, 4.6, Math.sin(a) * 7.4, 0, -a + HP, 0));
  }
  ladder(g, M.steel, 7.7, 0, -2, 6);
  g.add(mesh(D.cyl(0.08, 0.12, 3, 6), M.steel, 0, 16.4, 0));
  rubble(g, 0, 0, 10, 8, 109, SNOW);
  return g;
}
// 冰封的運輸機：機身、主翼與尾翼，一半被雪埋住
function frozenPlane() {
  const g = new THREE.Group();
  const p = new THREE.Group();
  // 機身（剖面旋轉、機首圓、機尾往上收）＋駕駛艙的窗、主翼（翼剖面＋引擎）、尾翼、積雪
  const prof = [];
  for (let i = 0; i <= 10; i++) {
    const u = i / 10;
    prof.push([u < 0.15 ? 2.6 * Math.sqrt(u / 0.15) : u > 0.75 ? 2.6 - (u - 0.75) * 7 : 2.6, -13 + u * 26]);
  }
  prof[0][0] = 0;
  p.add(mesh(D.lathe(prof, 18), M.hull, 0, 0, 0, HP, 0, 0));
  p.add(mesh(D.box(2.2, 0.8, 0.2, 0.05), M.window, 0, 1.2, -11.6, -0.6, 0, 0));
  for (const s2 of [-1, 1]) {
    p.add(
      mesh(
        D.extrude(
          [
            [0, -2],
            [17, 0.5],
            [17, 2],
            [0, 3],
          ],
          0.6,
          0.15,
        ),
        M.hull,
        s2 * 0.5,
        0.6,
        2,
        HP,
        s2 > 0 ? 0 : Math.PI,
        0,
      ),
    );
    p.add(
      mesh(
        D.lathe(
          [
            [0, -1.6],
            [0.9, -1.3],
            [1, 1.2],
            [0.7, 1.6],
          ],
          14,
        ),
        M.hullD,
        s2 * 7,
        -0.4,
        1.5,
        HP,
        0,
        0,
      ),
    );
  }
  p.add(mesh(D.box(10, 0.4, 3, 0.1), M.hull, 0, 1.6, 12));
  p.add(
    mesh(
      D.extrude(
        [
          [0, 0],
          [4, 0],
          [4, 1],
          [1.6, 6],
        ],
        0.4,
        0.1,
      ),
      M.hull,
      0,
      1.6,
      10,
      0,
      -HP,
      0,
    ),
  );
  p.add(mesh(D.box(30, 0.5, 4, 0.2), SNOW, 0, 1.1, 2));
  rot(p, 0.05, 0.4, 0.1);
  p.position.y = 1.2;
  g.add(p);
  rubble(g, 0, 0, 14, 12, 113, SNOW);
  return g;
}
// 凍結的輸送管橋：兩座橋墩撐起的大管線
function pipeBridge() {
  const g = new THREE.Group();
  // 管橋：橋墩（有積雪）、桁架、兩根輸送管（有保溫套的環）、垂下的冰柱
  for (const x of [-12, 12]) {
    g.add(
      mesh(
        D.extrude(
          [
            [-1.2, 0],
            [1.2, 0],
            [1, 10],
            [-1, 10],
          ],
          3,
          0.1,
        ),
        M.concrete,
        x,
        0,
        0,
      ),
    );
    g.add(mesh(D.box(2.4, 0.3, 3.2, 0.05), SNOW, x, 10.1, 0));
  }
  for (const [y, z] of [
    [10.2, -1.2],
    [10.2, 1.2],
    [12.6, -1.2],
    [12.6, 1.2],
  ])
    bar(g, M.steel, [-18, y, z], [18, y, z], 0.3);
  for (let x = -18; x < 18; x += 3) {
    bar(g, M.steel, [x, 10.2, -1.2], [x + 3, 12.6, -1.2], 0.18);
    bar(g, M.steel, [x, 10.2, 1.2], [x + 3, 12.6, 1.2], 0.18);
  }
  for (const z of [-0.6, 0.6]) {
    g.add(mesh(D.cyl(0.8, 0.8, 36, 14), M.steel, 0, 11.4, z, 0, 0, HP));
    for (let x = -16; x <= 16; x += 4) g.add(mesh(D.cyl(0.86, 0.86, 0.3, 14), M.dark, x, 11.4, z, 0, 0, HP));
  }
  g.add(mesh(D.box(36, 0.5, 3, 0.2), SNOW, 0, 12.9, 0));
  for (let i = 0; i < 10; i++)
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [0.25, 0],
            [0, -(rnd0(i) * 3 + 1)],
          ],
          5,
        ),
        M.crystal,
        -14 + i * 3,
        10,
        1.2 - (i % 2) * 2.4,
      ),
    );
  return g;
}
const rnd0 = (i) => ((i * 7919) % 13) / 13; // 固定的「亂數」（地標是純函式）
// 墜毀的軌道艙：圓錐形的返回艙斜插在雪裡，旁邊是降落傘
function capsule() {
  const g = new THREE.Group();
  // 軌道艙：圓錐的艙體（隔熱罩、艙門、窗、推進器）＋展開的降落傘（拖在地上）＋撞擊坑
  const c = new THREE.Group();
  c.add(
    mesh(
      D.lathe(
        [
          [0, -3],
          [4.5, -3],
          [4.6, -2.6],
          [1.6, 3],
          [0, 3.2],
        ],
        20,
      ),
      M.hullD,
      0,
      0,
      0,
    ),
  );
  c.add(
    mesh(
      D.lathe(
        [
          [0, -3.4],
          [4.6, -3.2],
          [4.4, -2.8],
          [0, -2.9],
        ],
        20,
      ),
      M.dark,
      0,
      0,
      0,
    ),
  );
  c.add(mesh(D.box(1.4, 2, 0.3, 0.05), M.dark, 0, 0, 3.2, -0.45, 0, 0));
  c.add(mesh(D.cyl(0.4, 0.4, 0.2, 10), M.window, 2.2, 0.8, 1.4, 0, 0.9, HP));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    c.add(mesh(D.box(0.6, 0.6, 0.6, 0.05), M.steel, Math.cos(a) * 2.6, 1.6, Math.sin(a) * 2.6));
  }
  rot(c, 0.7, 0, 0.2);
  c.position.set(0, 2.6, 0);
  g.add(c);
  for (let i = 0; i < 5; i++)
    g.add(
      rot(
        mesh(D.box(1.8, 0.1, 9, 0.02), i % 2 ? M.orange : M.white, -3.5 + i * 1.8, 0.2, 9),
        0.05,
        0.3,
        0.04,
      ),
    );
  for (let i = 0; i < 4; i++) g.add(mesh(D.cable([0, 3, 4], [-3.5 + i * 2.3, 0.3, 5], 0.04, 0.2, 4), M.dark));
  rubble(g, 0, -2, 8, 14, 127, SNOW);
  return g;
}
// 冰封的巨型 AC：埋到胸口的巨大機甲頭部與肩甲
function frozenGiant() {
  const g = new THREE.Group();
  // 冰封的巨型 AC：胸甲（分層）、肩甲、頭部（單眼）、冰的結晶、積雪
  plated(g, 14, 10, 8, M.hullD, 0, 3, 0, 0, 0, 0, 2);
  for (const s2 of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s2 * 9, 6, 0);
    sh.rotation.z = s2 * 0.3;
    g.add(sh);
    plated(sh, 6, 5, 9, M.hull, 0, 0, 0, 0, 0, 0, 1.6);
    sh.add(mesh(D.box(6.4, 0.6, 9.4, 0.1), SNOW, 0, 2.7, 0));
  }
  plated(g, 5, 4, 5, M.hull, 0, 10, -1, 0, 0, 0, 9);
  g.add(mesh(D.box(3.6, 0.6, 0.3, 0.05), M.glow, 0, 10.4, -3.6));
  g.add(mesh(D.box(16, 1, 9, 0.3), SNOW, 0, 8.4, 0));
  for (let i = 0; i < 9; i++)
    g.add(
      mesh(
        D.lathe(
          [
            [0, 0],
            [0.5 + rnd0(i) * 0.4, 0],
            [0.4, 2 + i * 0.5],
            [0, 3 + i * 0.6],
          ],
          6,
        ),
        M.crystal,
        -7 + i * 1.8,
        0,
        5 + (i % 3) - 1,
        0.2,
        i,
        -0.3 + i * 0.07,
      ),
    );
  rubble(g, 0, 0, 11, 14, 131, SNOW);
  return g;
}

// ---------- 汙染水沒市街 ----------
// 傾倒的摩天樓：斜靠的高樓與成排的窗
function leaningTower() {
  const g = new THREE.Group();
  const t = new THREE.Group();
  // 傾斜的大樓：每層的窗帶與樓板、角柱、屋頂的水塔與機房、斷掉的外牆
  t.add(mesh(D.box(10, 40, 10, 0.2), M.concrete, 0, 20, 0));
  for (let y = 4; y < 40; y += 4) {
    for (const s2 of [-1, 1]) {
      t.add(mesh(D.box(8, 1.2, 0.2, 0.02), M.window, 0, y, s2 * 5.05));
      t.add(mesh(D.box(0.2, 1.2, 8, 0.02), M.window, s2 * 5.05, y, 0));
    }
    t.add(mesh(D.box(10.3, 0.3, 10.3, 0.04), dk(M.concrete, 0.8), 0, y - 1.4, 0));
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      t.add(mesh(D.box(0.6, 40, 0.6, 0.05), dk(M.concrete, 0.85), sx * 5, 20, sz * 5));
  plated(t, 11, 2, 11, M.hullD, 0, 40.5, 0, 0, 0, 0, 9);
  t.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.6, 0],
          [1.6, 3],
          [0, 3.6],
        ],
        12,
      ),
      M.rustD,
      2,
      41.5,
      2,
    ),
  );
  lattice(t, M.steel, 2, 2, 2, 2, 2, 1, 0.15);
  rot(t, 0, 0, 0.32);
  t.position.x = -4;
  g.add(t);
  rubble(g, 8, 0, 8, 16, 97);
  return g;
}
// 半沉的摩天輪：大圓環＋輻條＋車廂，斜插進水裡
function ferrisWheel() {
  const g = new THREE.Group();
  const w = new THREE.Group();
  const R = 14;
  // 摩天輪：雙層的輪圈（圓環）、輪輻（成對）、車廂（剖面旋轉、吊在輪圈上）、輪軸
  for (const z of [-0.8, 0.8]) w.add(mesh(new THREE.TorusGeometry(R, 0.35, 8, 48), M.steel, 0, 0, z));
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    for (const z of [-0.8, 0.8])
      bar(w, M.steel, [0, 0, z * 0.3], [Math.cos(a) * R, Math.sin(a) * R, z], 0.15);
    bar(w, M.steel, [Math.cos(a) * R, Math.sin(a) * R, -0.8], [Math.cos(a) * R, Math.sin(a) * R, 0.8], 0.2);
    if (i % 3 === 0) {
      const cx = Math.cos(a) * R,
        cy = Math.sin(a) * R - 1.8;
      w.add(
        mesh(
          D.lathe(
            [
              [0, -1],
              [1.1, -0.9],
              [1.2, 0.6],
              [0.4, 1],
              [0, 1],
            ],
            10,
          ),
          i % 2 ? M.red : M.blue,
          cx,
          cy,
          0,
        ),
      );
      w.add(mesh(D.box(0.1, 1, 0.1, 0.02), M.steel, cx, cy + 1.4, 0));
    }
  }
  w.add(mesh(D.cyl(1.2, 1.2, 2.4, 16, 0.1), M.hullD, 0, 0, 0, HP, 0, 0));
  rot(w, 0.25, 0, 0);
  w.position.y = 10;
  g.add(w);
  // 支柱（A 字形、有橫撐）＋售票亭
  for (const s2 of [-1, 1])
    for (const z of [-2.2, 2.2]) bar(g, M.steel, [s2 * 6, 0, z], [0, 10, z * 0.4], 0.7);
  for (const z of [-2.2, 2.2]) bar(g, M.steel, [-3, 5, z * 0.7], [3, 5, z * 0.7], 0.4);
  plated(g, 4, 3, 3, M.white, 9, 1.5, 4, 0, 0, 0, 9);
  return g;
}
// 鐘樓：教堂的方塔與尖頂（下半泡在水裡）
function bellTower() {
  const g = new THREE.Group();
  // 鐘樓：塔身（角柱、腰線）、鐘樓的開口（拱）、尖頂、時鐘（鐘面＋指針）、附屬的建物
  plated(g, 7, 20, 7, M.concrete, 0, 10, 0, 0, 0, 0, 4);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      g.add(mesh(D.box(0.8, 20, 0.8, 0.06), dk(M.concrete, 0.85), sx * 3.5, 10, sz * 3.5));
  plated(g, 7.6, 1, 7.6, M.hullD, 0, 20.5, 0, 0, 0, 0, 9);
  for (const s2 of [-1, 1]) {
    g.add(mesh(D.box(2.4, 4, 0.3, 0.05), M.dark, 0, 17, s2 * 3.55));
    g.add(mesh(D.box(0.3, 4, 2.4, 0.05), M.dark, s2 * 3.55, 17, 0));
  }
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [5, 0],
          [0.2, 9],
          [0, 9],
        ],
        4,
        Math.PI / 4,
        Math.PI / 4 + Math.PI * 2,
      ),
      M.rustD,
      0,
      21,
      0,
    ),
  );
  g.add(mesh(D.cyl(1.6, 1.6, 0.3, 24), M.white, 0, 13, 3.6, HP, 0, 0));
  g.add(mesh(D.box(0.15, 1.2, 0.08, 0.02), M.dark, 0, 13.5, 3.8, 0, 0, 0.4));
  g.add(mesh(D.box(0.15, 0.9, 0.08, 0.02), M.dark, 0.3, 13, 3.8, 0, 0, -1.2));
  plated(g, 10, 6, 14, M.concrete, 0, 3, 10, 0, 0, 0, 9);
  g.add(
    mesh(
      D.extrude(
        [
          [-5.2, 0],
          [5.2, 0],
          [0, 3],
        ],
        14.2,
        0.1,
      ),
      M.rustD,
      0,
      6,
      10,
    ),
  );
  return g;
}
// 體育場殘骸：弧形的看台與燈塔
function stadium() {
  const g = new THREE.Group();
  // 看台：三層的階梯座位（每段有座位列）、頂上的遮陽棚的桁架、照明塔（格子塔＋燈架）
  for (let i = 0; i < 9; i++) {
    const a = -1.1 + i * 0.275;
    for (let k = 0; k < 3; k++) {
      const x = Math.sin(a) * (20 + k * 2.4),
        z = Math.cos(a) * (20 + k * 2.4) - 20;
      g.add(rot(mesh(D.box(7, 1.6 + k * 1.6, 2.4, 0.08), M.concrete, x, 0.8 + k * 0.8, z), 0, a, 0));
      g.add(
        rot(mesh(D.box(6.6, 0.3, 0.5, 0.03), i % 2 ? M.red : M.blue, x, 1.75 + k * 1.6, z - 0.6), 0, a, 0),
      );
    }
  }
  for (const s2 of [-1, 1]) {
    lattice(g, M.steel, 1.6, 0.8, 22, s2 * 18, -8, 6, 0.18);
    g.add(mesh(D.box(5, 3, 1, 0.1), M.white, s2 * 18, 23, -8));
    for (let i = 0; i < 6; i++)
      g.add(
        mesh(
          D.box(0.7, 0.7, 0.2, 0.03),
          M.window,
          s2 * 18 - 1.8 + (i % 3) * 1.8,
          22.3 + Math.floor(i / 3) * 1.4,
          -8.55,
        ),
      );
  }
  rubble(g, 0, -8, 10, 8, 101);
  return g;
}
// 巨型廣告看板：兩支柱子撐起的大螢幕（一半碎裂）
function billboard() {
  const g = new THREE.Group();
  // 巨型廣告看板：格子支柱、背面的桁架、看板的框、發光的畫面、維修走道
  for (const s2 of [-1, 1]) lattice(g, M.steel, 1.6, 1.2, 13, s2 * 7, 0.8, 4, 0.2);
  for (let x = -8; x <= 8; x += 2) bar(g, M.steel, [x, 12.6, 1], [x, 21.4, 1], 0.2);
  bar(g, M.steel, [-9, 13, 1], [9, 21, 1], 0.2);
  plated(g, 18, 9, 0.8, M.hullD, 0, 17, 0, 0, 0, 0, 9);
  g.add(mesh(D.box(8, 8, 0.2, 0.02), M.window, -4, 17, -0.5));
  g.add(rot(mesh(D.box(7, 6, 0.2, 0.02), M.glow, 5, 16, -0.5), 0, 0, 0.1));
  g.add(mesh(D.box(18, 0.2, 1.2, 0.02), M.steel, 0, 12.3, -0.9));
  rail(g, M.yellow, [
    [-9, 12.4, -1.4],
    [9, 12.4, -1.4],
  ]);
  return g;
}
// 沉沒的高架電車：斷掉的高架軌道與栽進水裡的車廂
function sunkTram() {
  const g = new THREE.Group();
  // 高架軌道：橋墩、軌道樑（有軌道）、斷裂處；電車：車身（窗帶、車門）、集電弓
  for (const x of [-14, 0]) {
    g.add(
      mesh(
        D.extrude(
          [
            [-1.2, 0],
            [1.2, 0],
            [1, 10],
            [-1, 10],
          ],
          2,
          0.1,
        ),
        M.concrete,
        x,
        0,
        0,
      ),
    );
    plated(g, 3, 1, 4.4, M.concrete, x, 10, 0, 0, 0, 0, 9);
  }
  plated(g, 22, 1.4, 4, M.concrete, -8, 10.7, 0, 0, 0, 0, 9);
  for (const z of [-0.8, 0.8]) g.add(mesh(D.box(22, 0.2, 0.2, 0.03), M.steel, -8, 11.5, z));
  const car = (x, y, z, ry, rz) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    o.rotation.set(0, ry, rz);
    g.add(o);
    o.add(mesh(D.box(14, 3.4, 3.2, 0.3), M.white, 0, 0, 0));
    o.add(mesh(D.box(14.05, 0.6, 3.25, 0.05), M.blue, 0, 1.9, 0));
    for (const s2 of [-1, 1]) o.add(mesh(D.box(12, 1.2, 0.1, 0.02), M.window, 0, 0.5, s2 * 1.62));
    for (const x2 of [-3, 3])
      for (const s2 of [-1, 1]) o.add(mesh(D.box(1.2, 2.6, 0.08, 0.02), M.dark, x2, -0.3, s2 * 1.64));
    bar(o, M.dark, [0, 1.8, 0], [1.2, 3, 0], 0.08);
    return o;
  };
  car(9, 4.5, 0, 0.15, -0.55);
  car(-7, 13.1, 0, 0, 0);
  rubble(g, 10, 0, 7, 10, 103);
  return g;
}

// ---------- 沙丘 ----------
// 半埋巨艦的艦橋：傾斜的高塔與窗
function shipBridge() {
  const g = new THREE.Group();
  const t = new THREE.Group();
  // 半埋的艦橋：分層的上部構造（每層一圈窗與甲板邊）、桅杆與雷達、煙囪
  plated(t, 10, 18, 8, M.hull, 0, 9, 0, 0, 0, 0, 3);
  plated(t, 11, 2.5, 9, M.hullD, 0, 15, 0, 0, 0, 0, 9);
  t.add(mesh(D.box(9, 1.6, 0.4, 0.08), M.window, 0, 15, -4.6));
  for (const s2 of [-1, 1]) t.add(mesh(D.box(0.4, 1.4, 6, 0.06), M.window, s2 * 5.6, 15, 0));
  for (const y of [6, 9, 12]) {
    t.add(mesh(D.box(10.6, 0.25, 8.6, 0.05), M.hullD, 0, y, 0));
    t.add(mesh(D.box(8.4, 0.8, 0.2, 0.03), M.window, 0, y + 1.1, -4.05));
  }
  rail(t, M.steel, [
    [-5.4, 16.3, -4.4],
    [5.4, 16.3, -4.4],
    [5.4, 16.3, 4.4],
    [-5.4, 16.3, 4.4],
    [-5.4, 16.3, -4.4],
  ]);
  plated(t, 3, 8, 3, M.hull, 2, 22, 1, 0, 0, 0, 2);
  t.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [1.3, 0],
          [1.1, 5],
          [1.25, 5.3],
          [0, 5.3],
        ],
        14,
      ),
      M.rustD,
      -3,
      16.3,
      2.5,
    ),
  );
  lattice(t, M.steel, 1.2, 0.4, 8, -2, 0, 3, 0.18);
  t.position.y = 0;
  const top = new THREE.Group();
  top.position.set(-2, 24.5, 0);
  top.add(mesh(D.box(4, 0.3, 0.8, 0.05), M.steel, 0, 0, 0));
  top.add(mesh(D.cyl(0.15, 0.15, 1.2, 8), M.steel, 0, 0.6, 0));
  t.add(top);
  rot(t, 0.12, 0.4, -0.18);
  t.position.y = -3;
  g.add(t);
  // 埋在沙裡的艦體甲板（傾斜的板）與沙堆
  plated(g, 18, 1.2, 10, M.rustD, 2, 0.2, 4, 0.05, 0.4, -0.1, 9);
  rubble(g, 0, 2, 10, 14, 17, M.rustD);
  for (let i = 0; i < 5; i++)
    g.add(rot(mesh(D.box(4, 1.5, 3, 0.2), M.rustD, -8 + i * 4, 0.3, 7 - (i % 2) * 3), 0, i, 0.2));
  return g;
}
// 古代風力塔：高柱＋三片葉片
function windTower() {
  const g = new THREE.Group();
  // 塔身（往上收的混凝土筒、補強環、維修門、外側的爬梯）
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [2.1, 0],
          [2, 1],
          [1.2, 30],
          [0, 30],
        ],
        18,
      ),
      M.concrete,
      0,
      0,
      0,
    ),
  );
  for (let y = 6; y < 29; y += 6)
    g.add(mesh(D.cyl(2.05 - y * 0.027, 2.05 - y * 0.027, 0.3, 18), dk(M.concrete, 0.8), 0, y, 0));
  g.add(mesh(D.box(1.2, 2.4, 0.3, 0.05), M.dark, 0, 1.4, -2.0));
  ladder(g, M.steel, 1.7, 1, 0, 27);
  // 機艙（流線型）＋輪轂＋三片葉片（剖面）
  g.add(
    mesh(
      D.lathe(
        [
          [0, -3],
          [1.3, -2.6],
          [1.6, 0],
          [1.4, 2.4],
          [0, 3],
        ],
        14,
      ),
      M.hull,
      0,
      30.8,
      0.5,
      HP,
      0,
      0,
    ),
  );
  const hub = new THREE.Group();
  hub.position.set(0, 30.8, -2.4);
  g.add(hub);
  hub.add(
    mesh(
      D.lathe(
        [
          [0, -1.2],
          [0.9, -0.6],
          [1.1, 0.4],
          [0, 0.6],
        ],
        12,
      ),
      M.steel,
      0,
      0,
      0,
      -HP,
      0,
      0,
    ),
  );
  for (let i = 0; i < 3; i++) {
    const bl = mesh(D.blade(13, 1.4, 0.5, 0.3, 0.3), M.steel, 0, 0, 0, 0, 0, HP + (i * Math.PI * 2) / 3);
    bl.rotation.order = 'ZXY';
    hub.add(bl);
  }
  rot(hub, 0, 0, 0.4);
  plated(g, 6, 1, 6, M.concrete, 0, 0.5, 0, 0, 0, 0, 9);
  rubble(g, 0, 0, 6, 8, 21);
  return g;
}
// 沙中巨像：半埋的巨大石像頭部
function colossus() {
  const g = new THREE.Group();
  // 沙中巨像的頭：分層的頭盔、面罩的縫、側面的耳罩、頂部的冠飾
  const head = new THREE.Group();
  plated(head, 12, 14, 11, M.concrete, 0, 7, 0, 0, 0, 0, 2.2);
  head.add(mesh(D.box(9, 2, 1, 0.2), M.dark, 0, 9, -5.6));
  head.add(mesh(D.box(2, 4, 2, 0.3), M.concrete, 0, 6, -6));
  plated(head, 13, 3, 12, M.rust, 0, 15, 0, 0, 0, 0, 9);
  for (const s2 of [-1, 1]) head.add(mesh(D.cyl(3, 3.2, 1.6, 20, 0.2), M.rust, s2 * 6.6, 8, 0, 0, 0, HP));
  head.add(
    mesh(
      D.extrude(
        [
          [-1, 0],
          [1, 0],
          [0.4, 6],
          [-0.4, 6],
        ],
        1,
        0.15,
      ),
      M.rust,
      0,
      16.5,
      0,
    ),
  );
  rot(head, -0.15, 0.5, 0.12);
  head.position.y = -4;
  g.add(head);
  rubble(g, 0, 0, 9, 16, 53, M.concrete);
  return g;
}
// 倒塌的天線陣：幾支高桅杆，一支倒下
function antennaArray() {
  const g = new THREE.Group();
  for (const [x, z, h] of [
    [-8, -6, 22],
    [6, -4, 26],
    [-2, 8, 18],
  ]) {
    // 三角斷面的桅杆（格子）＋橫臂與天線元件＋拉線的錨＋基座
    lattice(g, M.steel, 1.6, 0.6, h, x, z, Math.round(h / 4), 0.22);
    for (let y = 4; y < h; y += 6) {
      g.add(mesh(D.box(3, 0.3, 0.3, 0.04), M.steel, x, y, z));
      for (const s2 of [-1, 1]) g.add(mesh(D.cyl(0.08, 0.08, 2, 6), M.steel, x + s2 * 1.5, y + 1, z));
    }
    g.add(mesh(D.box(2.4, 2.4, 2.4, 0.2), M.concrete, x, 1.2, z));
    g.add(mesh(D.cyl(0.4, 0.4, 0.6, 8), M.red, x, h + 0.3, z));
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2 + x;
      g.add(
        mesh(
          D.cable(
            [x, h * 0.75, z],
            [x + Math.cos(a) * h * 0.45, 0.2, z + Math.sin(a) * h * 0.45],
            0.05,
            0.4,
            8,
          ),
          M.dark,
        ),
      );
    }
  }
  // 倒下的一支（斷口與散落的天線元件）
  const f = new THREE.Group();
  lattice(f, M.steel, 1.6, 0.6, 24, 0, 0, 6, 0.22);
  rot(f, HP - 0.05, 0.6, 0);
  f.position.set(10, 0.8, 8);
  g.add(f);
  rubble(g, 10, 8, 6, 8, 23, M.rustD);
  return g;
}
// 沙漠要塞門：兩座塔＋拱門
function fortressGate() {
  const g = new THREE.Group();
  for (const s2 of [-1, 1]) {
    // 塔：往上收的混凝土＋射擊口＋頂部的鋼製城垛＋側面的補強
    g.add(
      mesh(
        D.extrude(
          [
            [-3.5, 0],
            [3.5, 0],
            [3.1, 18],
            [-3.1, 18],
          ],
          7,
          0.25,
        ),
        M.concrete,
        s2 * 8,
        0,
        0,
      ),
    );
    plated(g, 8, 1.5, 8, M.rust, s2 * 8, 18.5, 0, 0, 0, 0, 9);
    for (let i = 0; i < 4; i++)
      g.add(mesh(D.box(1.2, 1.4, 1.2, 0.1), M.rust, s2 * 8 + (i - 1.5) * 2, 19.9, -3.4));
    for (const y of [8, 13]) g.add(mesh(D.box(2.2, 0.8, 0.3, 0.05), M.dark, s2 * 8, y, -3.55));
    for (const z of [-2.5, 2.5])
      g.add(mesh(D.box(0.6, 17, 0.6, 0.08), dk(M.concrete, 0.8), s2 * 11.6, 8.5, z));
  }
  // 拱門的大樑、發光的門標、門框、塌下的閘門
  plated(g, 9, 4, 6, M.concrete, 0, 15, 0, 0, 0, 0, 1.6);
  g.add(mesh(D.box(4, 1, 0.4, 0.08), M.glow, 0, 13, -3.2));
  for (const s2 of [-1, 1]) g.add(mesh(D.box(0.6, 13, 0.6, 0.08), M.rust, s2 * 4.4, 6.5, -2.8));
  plated(g, 8.2, 6, 0.6, M.rust, 0, 1.6, -1.5, 1.2, 0, 0.08, 1.2);
  rubble(g, 0, 4, 7, 14, 29);
  return g;
}
// 機械蠍殘骸：身體、彎曲的尾巴、兩隻鉗子
function scorpionWreck() {
  const g = new THREE.Group();
  // 身體（多節的甲殼）
  for (let i = 0; i < 4; i++)
    plated(g, 8 - i * 0.6, 3, 3.2, M.hullD, 0, 2 + i * 0.1, -4 + i * 3, 0, 0, 0.12, 9);
  // 彎曲的尾巴：一節一節的甲殼＋尾針（發光）
  for (let i = 0; i < 5; i++) {
    const a = i * 0.35;
    g.add(
      rot(
        mesh(
          D.box(2.2 - i * 0.15, 2.2 - i * 0.15, 3, 0.3),
          M.hull,
          0,
          4 + Math.sin(a) * 6,
          7 + Math.cos(a) * 3 - i * 0.6,
        ),
        -a,
        0,
        0,
      ),
    );
  }
  g.add(
    mesh(
      D.lathe(
        [
          [0, 0],
          [0.8, 0.5],
          [0.5, 2],
          [0, 3],
        ],
        10,
      ),
      M.glow,
      0,
      11.5,
      4,
      -0.6,
      0,
      0,
    ),
  );
  // 鉗子（上下兩片）與腳（兩節）
  for (const s2 of [-1, 1]) {
    plated(g, 1.6, 1.6, 7, M.hull, s2 * 4.5, 1.6, -8, 0, s2 * 0.4, 0, 9);
    plated(g, 3, 0.8, 3, M.hullD, s2 * 6, 1.8, -12, 0, s2 * 0.8, 0, 9);
    plated(g, 3, 0.8, 3, M.hullD, s2 * 6.2, 0.9, -12.2, 0, s2 * 0.6, 0, 9);
  }
  for (let i = 0; i < 6; i++) {
    const s2 = i < 3 ? -1 : 1,
      z = -3 + (i % 3) * 3;
    bar(g, M.hull, [s2 * 3.5, 2.2, z], [s2 * 5.5, 3, z + 0.5], 0.6);
    bar(g, M.hull, [s2 * 5.5, 3, z + 0.5], [s2 * 6.5, 0, z + 0.8], 0.45);
  }
  rubble(g, 0, 0, 9, 14, 59, M.rustD);
  return g;
}

export const LANDMARKS = {
  orbit: {
    tether: {
      name: '軌道電梯纜索',
      build: elevatorTether,
      bx: [-6, 6, -6, 6],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { box: [-5, 5, -5, 5], y: -1, top: 3 },
        { c: [0, 0], r: 2, h: 120 },
      ],
    },
    solar: {
      name: '巨型太陽能陣列',
      build: solarField,
      bx: [-16, 16, -6, 6],
      range: 2.5,
      sink: 0.2,
      shapes: [{ box: [-13, 13, -0.5, 0.5], y: -1, top: 6 }],
    },
    freighter: {
      name: '失事的運輸艦',
      build: brokenFreighter,
      bx: [-8, 9, -19, 18],
      range: 3,
      sink: 0.3,
      shapes: [
        { box: [-6, 6, -17, 1], y: -1, top: 6 },
        { box: [-1, 7, 3, 17], y: -1, top: 6 },
      ],
    },
    antenna: {
      name: '深空天線',
      build: deepAntenna,
      bx: [-9, 9, -9, 9],
      range: 2.5,
      sink: 0.2,
      shapes: [{ box: [-3, 3, -3, 3], y: -1, top: 20 }],
    },
    ring: {
      name: '斷裂的環形結構',
      build: brokenRing,
      bx: [-16, 16, -16, 16],
      range: 3,
      sink: 0.2,
      shapes: [
        { box: [-15, -12, -2, 2], y: -1, top: 12 },
        { box: [12, 15, -2, 2], y: -1, top: 12 },
      ],
    },
    hab: {
      name: '居住艙模組',
      build: habModule,
      bx: [-11, 11, -7, 7],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { box: [-10, -4, -6, 6], y: -1, top: 6 },
        { box: [4, 10, -6, 6], y: -1, top: 6 },
      ],
    },
  },
  xylem: {
    turbine: {
      name: '巨型風力發電機',
      build: seaTurbine,
      bx: [-4, 4, -10, 4],
      range: 2.5,
      sink: 0.2,
      shapes: [{ c: [0, 0], r: 2.4, h: 38 }],
    },
    dome: {
      name: '玻璃穹頂植物園',
      build: glassDome,
      bx: [-11, 11, -11, 11],
      range: 2.5,
      sink: 0.2,
      shapes: [{ c: [0, 0], r: 10, h: 10 }],
    },
    monorail: {
      name: '斷裂的高架單軌',
      build: brokenMonorail,
      bx: [-15, 15, -2, 2],
      range: 3,
      sink: 0.2,
      shapes: [
        { box: [-15, -13, -1, 1], y: -1, top: 12 },
        { box: [-1, 1, -1, 1], y: -1, top: 12 },
        { box: [-20, 4, -1.5, 1.5], y: 12, top: 13.2, deck: true },
      ],
    },
    rig: {
      name: '海上鑽油平台',
      build: oilRig,
      bx: [-9, 9, -9, 9],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { c: [-7, -7], r: 1.2, h: 14 },
        { c: [7, -7], r: 1.2, h: 14 },
        { c: [-7, 7], r: 1.2, h: 14 },
        { c: [7, 7], r: 1.2, h: 14 },
        { box: [-9, 9, -9, 9], y: 13.3, top: 14.7, deck: true },
      ],
    },
    ship: {
      name: '擱淺的貨櫃船',
      build: containerShip,
      bx: [-7, 7, -18, 18],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-5, 5, -17, 17], y: -1, top: 12 }],
    },
    spire: {
      name: '都市紀念塔',
      build: citySpire,
      bx: [-5, 5, -5, 5],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { box: [-4, 4, -4, 4], y: -1, top: 2 },
        { c: [0, 0], r: 2, h: 40 },
      ],
    },
  },
  grid086: {
    girder: {
      name: '斷裂的主樑',
      build: brokenGirder,
      bx: [-13, 19, -3, 3],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-12, -8, -2, 2], y: -1, top: 30 }],
    },
    doser: {
      name: 'Doser 聚落',
      build: doserCamp,
      bx: [-12, 12, -12, 12],
      range: 3,
      sink: 0.2,
      shapes: [
        { box: [-11.5, -6.5, -2, 2], y: -1, top: 3.6 },
        { box: [6.5, 11.5, -2, 2], y: -1, top: 3.6 },
      ],
    },
    shaft: {
      name: '貨運升降井',
      build: cargoShaft,
      bx: [-8, 8, -8, 8],
      range: 2.5,
      sink: 0.3,
      shapes: [
        { c: [-7, -7], r: 1, h: 34 },
        { c: [7, -7], r: 1, h: 34 },
        { c: [-7, 7], r: 1, h: 34 },
        { c: [7, 7], r: 1, h: 34 },
        { box: [-6, 6, -6, 6], y: 13.5, top: 14.5, deck: true },
      ],
    },
    walker: {
      name: '停機的巨型步行機',
      build: giantWalker,
      bx: [-13, 13, -10, 10],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-12, -9], r: 1, h: 9 },
        { c: [12, -9], r: 1, h: 9 },
        { c: [-12, 9], r: 1, h: 9 },
        { c: [12, 9], r: 1, h: 9 },
        { box: [-7, 7, -5, 5], y: 13, top: 19, deck: true },
      ],
    },
    column: {
      name: '構造體核心柱',
      build: coreColumn,
      bx: [-8, 8, -8, 8],
      range: 2.5,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 7, h: 40 }],
    },
    furnace: {
      name: '巨型熔爐',
      build: bigFurnace,
      bx: [-8, 8, -16, 7],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-7, 7, -6, 6], y: -1, top: 16 }],
    },
  },
  spaceport: {
    rocket: {
      name: '倒下的火箭',
      build: fallenRocket,
      bx: [-24, 21, -4, 4],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-22, 20, -3.2, 3.2], y: -1, top: 6.4 }],
    },
    dish: {
      name: '巨型通訊天線',
      build: bigDish,
      bx: [-10, 10, -8, 12],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-4, 4, -4, 4], y: -1, top: 12 }],
    },
    shuttle: {
      name: '太空梭殘骸',
      build: shuttleWreck,
      bx: [-12, 12, -19, 15],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-3, 3, -16, 14], y: -1, top: 6 }],
    },
    fuel: {
      name: '液態燃料大槽',
      build: fuelFarm,
      bx: [-15, 15, -7, 17],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-8, 0], r: 6, h: 14 },
        { c: [8, 0], r: 6, h: 14 },
        { c: [0, 10], r: 6, h: 14 },
      ],
    },
    assembly: {
      name: '組裝塔',
      build: assemblyTower,
      bx: [-4, 14, -4, 4],
      range: 2.5,
      sink: 0.3,
      shapes: [{ box: [-3.4, 3.4, -3.4, 3.4], y: -1, top: 44 }],
    },
    station: {
      name: '墜落的軌道站碎片',
      build: stationChunk,
      bx: [-13, 13, -10, 10],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [0, 8, -5, 1], y: -1, top: 4 }],
    },
  },
  institute: {
    reactor: {
      name: 'Coral 反應爐',
      build: coralReactor,
      bx: [-11, 11, -11, 11],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [0, 0], r: 7, h: 13 },
        { c: [8.3, 3.5], r: 1.3, h: 18 },
        { c: [-3.5, 8.3], r: 1.3, h: 18 },
        { c: [-8.3, -3.5], r: 1.3, h: 18 },
        { c: [3.5, -8.3], r: 1.3, h: 18 },
      ],
    },
    spire: {
      name: '巨大結晶柱',
      build: coralSpire,
      bx: [-6, 6, -6, 6],
      range: 3,
      sink: 0.5,
      shapes: [{ c: [0, 0], r: 4, h: 26 }],
    },
    lift: {
      name: '大型貨運升降梯',
      build: freightLift,
      bx: [-10, 10, -8, 8],
      range: 2.5,
      sink: 0.3,
      shapes: [
        { c: [-9, -7], r: 1, h: 26 },
        { c: [9, -7], r: 1, h: 26 },
        { c: [-9, 7], r: 1, h: 26 },
        { c: [9, 7], r: 1, h: 26 },
        { box: [-9, 9, -7, 7], y: 3.4, top: 4.6, deck: true },
      ],
    },
    cage: {
      name: '實驗體收容籠',
      build: specimenCage,
      bx: [-8, 8, -6, 7],
      range: 2.5,
      sink: 0.3,
      shapes: [
        { box: [-7.3, 7.3, -5.3, -4.7], y: -1, top: 10 },
        { box: [-7.3, -6.7, -5, 5], y: -1, top: 10 },
        { box: [6.7, 7.3, -5, 5], y: -1, top: 10 },
        { box: [-7, 7, -5, 5], y: 9.4, top: 10, deck: true },
      ],
    },
    tube: {
      name: '斷裂的輸送管',
      build: brokenTube,
      bx: [-14, 14, -3, 3],
      range: 3,
      sink: 0.3,
      shapes: [
        { box: [-13.5, -10.5, -1.5, 1.5], y: -1, top: 16 },
        { box: [2, 13, -2, 2], y: -1, top: 6 },
      ],
    },
    monument: {
      name: '研究所紀念碑',
      build: monument,
      bx: [-6, 6, -6, 6],
      range: 2.5,
      sink: 0.3,
      shapes: [{ box: [-5, 5, -5, 5], y: -1, top: 4 }],
    },
  },
  snow: {
    icebreaker: {
      name: '凍結的破冰船',
      build: icebreaker,
      bx: [-12, 12, -20, 18],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-6, 6, -16, 16], y: -1, top: 10 }],
    },
    radome: {
      name: '巨型雷達罩',
      build: radome,
      bx: [-10, 10, -10, 10],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 8.5, h: 14 }],
    },
    plane: {
      name: '冰封的運輸機',
      build: frozenPlane,
      bx: [-19, 19, -15, 15],
      range: 4,
      sink: 0.3,
      shapes: [{ box: [-4, 4, -13, 13], y: -1, top: 4 }],
    },
    pipebridge: {
      name: '凍結的輸送管橋',
      build: pipeBridge,
      bx: [-19, 19, -3, 3],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-13, -11, -1.5, 1.5], y: -1, top: 10 },
        { box: [11, 13, -1.5, 1.5], y: -1, top: 10 },
      ],
    },
    capsule: {
      name: '墜毀的軌道艙',
      build: capsule,
      bx: [-9, 8, -7, 12],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 4, h: 7 }],
    },
    giant: {
      name: '冰封的巨型 AC',
      build: frozenGiant,
      bx: [-13, 13, -6, 7],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-12, 12, -4.5, 4.5], y: -1, top: 9 }],
    },
  },
  flooded: {
    leaning: {
      name: '傾倒的摩天樓',
      build: leaningTower,
      bx: [-18, 16, -7, 7],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-7, 3, -5, 5], y: -1, top: 30 }],
    },
    ferris: {
      name: '半沉的摩天輪',
      build: ferrisWheel,
      bx: [-16, 16, -6, 6],
      range: 3,
      sink: 0.5,
      shapes: [
        { c: [-3.5, 0], r: 1.2, h: 14 },
        { c: [3.5, 0], r: 1.2, h: 14 },
      ],
    },
    bell: {
      name: '鐘樓',
      build: bellTower,
      bx: [-6, 6, -5, 18],
      range: 3,
      sink: 0.5,
      shapes: [
        { box: [-3.5, 3.5, -3.5, 3.5], y: -1, top: 21 },
        { box: [-5, 5, 3.5, 17], y: -1, top: 6 },
      ],
    },
    stadium: {
      name: '體育場殘骸',
      build: stadium,
      bx: [-22, 22, -22, 6],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-19, 19, 0, 5], y: -1, top: 4 }],
    },
    billboard: {
      name: '巨型廣告看板',
      build: billboard,
      bx: [-10, 10, -2, 2],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-7, 0], r: 0.8, h: 22 },
        { c: [7, 0], r: 0.8, h: 22 },
      ],
    },
    tram: {
      name: '沉沒的高架電車',
      build: sunkTram,
      bx: [-20, 17, -3, 3],
      range: 4,
      sink: 0.5,
      shapes: [
        { box: [-15, -13, -1, 1], y: -1, top: 10 },
        { box: [-1, 1, -1, 1], y: -1, top: 10 },
        { box: [-19, 3, -2, 2], y: 10, top: 14.8, deck: true },
        { box: [3, 15, -1.6, 1.6], y: -1, top: 7 },
      ],
    },
  },
  dam: {
    runner: {
      name: '巨型水輪機',
      build: turbineRunner,
      bx: [-8, 8, -8, 13],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 6.5, h: 12 }],
    },
    radial: {
      name: '弧形閘門殘骸',
      build: radialGate,
      bx: [-10, 10, -6, 12],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-8, 8, -1, 9], y: -1, top: 8 }],
    },
    intake: {
      name: '取水塔',
      build: intakeTower,
      bx: [-6, 6, -6, 16],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 4.8, h: 25 }],
    },
    gauge: {
      name: '水文觀測站',
      build: gaugeStation,
      bx: [-5, 9, -4, 4],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { box: [-4, 4, -3, 3], y: -1, top: 4.5 },
        { c: [7, 0], r: 1, h: 18 },
      ],
    },
    barge: {
      name: '擱淺的駁船',
      build: strandedBarge,
      bx: [-14, 14, -6, 11],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-13, 13, -4.5, 4.5], y: -1, top: 6 }],
    },
    aqueduct: {
      name: '倒塌的輸水橋',
      build: aqueduct,
      bx: [-16, 17, -4, 4],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-15.5, -12.5, -2, 2], y: -1, top: 16 },
        { box: [-1.5, 1.5, -2, 2], y: -1, top: 16 },
        { box: [12.5, 15.5, -2, 2], y: -1, top: 14 },
        { box: [-15, 1, -2.3, 2.3], y: 13.8, top: 16.2, deck: true },
      ],
    },
  },
  industrial: {
    gantry: {
      name: '巨型門式起重機',
      build: gantryCrane,
      bx: [-13, 13, -6, 6],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-12, -5], r: 1, h: 24 },
        { c: [-12, 5], r: 1, h: 24 },
        { c: [12, -5], r: 1, h: 24 },
        { c: [12, 5], r: 1, h: 24 },
        { box: [-7.5, -0.5, -1.3, 1.3], y: 0, top: 5.2 },
      ],
    },
    tower: {
      name: '調度管制塔',
      build: controlTower,
      bx: [-5, 5, -5, 5],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-3, 3, -3, 3], y: -1, top: 31 }],
    },
    stack: {
      name: '倒塌的貨櫃塔',
      build: fallenStack,
      bx: [-12, 12, -9, 9],
      range: 3,
      sink: 0.3,
      shapes: [
        { box: [-7.5, 7.5, -3.5, 3.8], y: -1, top: 8 },
        { box: [-12, -6, 1, 5], y: -1, top: 3 },
      ],
    },
    tanker: {
      name: '翻覆的油罐列車',
      build: tankerTrain,
      bx: [-20, 20, -4, 5],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-19, 19, -2.5, 4], y: -1, top: 4 }],
    },
    silos: {
      name: '穀倉群',
      build: silos,
      bx: [-8, 8, -8, 15],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-4, -4], r: 3, h: 22 },
        { c: [4, -4], r: 3, h: 22 },
        { c: [-4, 4], r: 3, h: 22 },
        { c: [4, 4], r: 3, h: 22 },
        { box: [-1.5, 1.5, 11.5, 14.5], y: -1, top: 24 },
      ],
    },
    airship: {
      name: '墜落的貨運飛船',
      build: cargoAirship,
      bx: [-17, 17, -6, 9],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-15, 15, -5, 5], y: -1, top: 8 }],
    },
  },
  dunes: {
    bridge: {
      name: '半埋巨艦的艦橋',
      build: shipBridge,
      bx: [-12, 12, -8, 10],
      range: 5,
      sink: 1,
      shapes: [{ box: [-6, 6, -5, 5], y: -1, top: 20 }],
    },
    turbine: {
      name: '古代風力塔',
      build: windTower,
      bx: [-4, 4, -10, 4],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 2.4, h: 32 }],
    },
    colossus: {
      name: '沙中巨像',
      build: colossus,
      bx: [-9, 9, -9, 9],
      range: 5,
      sink: 1,
      shapes: [{ box: [-7, 7, -7, 7], y: -1, top: 12 }],
    },
    array: {
      name: '倒塌的天線陣',
      build: antennaArray,
      bx: [-11, 22, -8, 11],
      range: 4,
      sink: 0.3,
      shapes: [
        { c: [-8, -6], r: 1.6, h: 22 },
        { c: [6, -4], r: 1.6, h: 26 },
        { c: [-2, 8], r: 1.6, h: 18 },
      ],
    },
    gate: {
      name: '沙漠要塞門',
      build: fortressGate,
      bx: [-12, 12, -5, 7],
      range: 3,
      sink: 0.5,
      shapes: [
        { box: [-11.5, -4.5, -3.5, 3.5], y: -1, top: 19 },
        { box: [4.5, 11.5, -3.5, 3.5], y: -1, top: 19 },
      ],
    },
    scorpion: {
      name: '機械蠍殘骸',
      build: scorpionWreck,
      bx: [-8, 8, -14, 11],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-4, 4, -6, 6], y: -1, top: 5 }],
    },
  },
  wasteland: {
    ship: {
      name: '墜毀運輸艦',
      build: crashedShip,
      bx: [-11, 11, -18, 18],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-5, 5, -16, 16], y: -1, top: 8 }],
    },
    radar: {
      name: '倒塌的雷達塔',
      build: fallenRadar,
      bx: [-7, 7, -19, 25],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-2, 2, -19, 15], y: 0, top: 4 },
        { c: [2, 20], r: 5, h: 8 },
      ],
    },
    well: {
      name: '燃燒中的油井',
      build: burningWell,
      bx: [-12, 13, -9, 10],
      range: 3,
      sink: 0.2,
      shapes: [
        { c: [0, 0], r: 3.5, h: 24 },
        { c: [9, 3], r: 3.5, h: 5 },
        { c: [9, -5], r: 3, h: 5 },
        { c: [-8, 6], r: 2.6, h: 5 },
      ],
    },
    ac: {
      name: '半埋的舊 AC 殘骸',
      build: buriedAc,
      bx: [-11, 14, -8, 10],
      range: 4,
      sink: 0.5,
      shapes: [
        { box: [-7, 1, -4, 4], y: -1, top: 6 },
        { c: [9, 5], r: 2.5, h: 18 },
      ],
    },
    wall: {
      name: '巨型隔牆的破口',
      build: breachedWall,
      bx: [-21, 21, -5, 5],
      range: 3,
      sink: 0.5,
      shapes: [
        { box: [-20, -6, -2, 2], y: -1, top: 20 },
        { box: [6, 20, -2, 2], y: -1, top: 20 },
      ],
    },
    towers: {
      name: '廢棄的煉油塔群',
      build: crackingTowers,
      bx: [-9, 9, -8, 8],
      range: 2.5,
      sink: 0.3,
      shapes: [
        { c: [-5, 0], r: 2.5, h: 24 },
        { c: [2, -3], r: 2.1, h: 30 },
        { c: [4, 4], r: 2.9, h: 20 },
      ],
    },
  },
  desert: {
    drill: {
      name: '巨型鑽機',
      build: giantDrill,
      bx: [-7, 7, -9, 9],
      range: 3,
      sink: 0.2,
      shapes: [{ box: [-6.5, 6.5, -8, 8], y: 0, top: 9 }],
    },
    wheel: {
      name: '斗輪採掘機',
      build: bucketWheel,
      bx: [-8, 8, -33, 13],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-7, 7, -4, 12], y: 0, top: 8 },
        { c: [0, -24], r: 6, h: 17 },
      ],
    },
    truck: {
      name: '翻倒的礦石運輸車',
      build: haulTruck,
      bx: [-10, 11, -10, 10],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-9, 5, -9, 9], y: 0, top: 9 }],
    },
    plant: {
      name: '選礦廠塔',
      build: processingTower,
      bx: [-7, 7, -7, 30],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-5, 5, -5, 5], y: 0, top: 32 }],
    },
    crystal: {
      name: '巨大結晶簇',
      build: crystalCluster,
      bx: [-6, 6, -6, 6],
      range: 2.5,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 4.5, h: 16 }],
    },
    headframe: {
      name: '坍塌的礦井升降塔',
      build: headframe,
      bx: [-6, 6, -6, 15],
      range: 2.5,
      sink: 0.3,
      shapes: [{ box: [-5, 5, -5, 5], y: 0, top: 25 }],
    },
  },
};
// 精細版（docs/model-detail.md）：box()／cyl() 拼的網格整個換成精細版（基本形體升級以放大 WS 倍之後的尺寸判斷）
const LM_TINT = { ao: 0.75, grime: 0.2, k: WS };
for (const th in LANDMARKS)
  for (const key in LANDMARKS[th]) {
    const L = LANDMARKS[th][key];
    const f = L.build;
    L.build = () => bakeGroup(f(), LM_TINT);
  }
export const landmarkKeys = (theme) => Object.keys(LANDMARKS[theme] || {});
