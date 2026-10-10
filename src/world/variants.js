// 主題變體：同一個主題的不同場景構成（主線的區段與自由出擊共用；設計見 docs/campaign-design.md 5.5）。
// 欄位：name、theme（覆寫主題欄位：地形特徵、公路、岩頂、光線、顏色…）、terrain(w)（回傳 (x, z, h) → h 的地形修改，
// 參數用自己的亂數串 makeRng）、build(w)（在一般物件之後加的結構，於關卡生成的 withRng 內呼叫）。
// 不帶變體時 World 完全照原本生成（現有地圖不變）。本模組不可 import world.js，World 一律用參數 w。
import { clamp, makeRng, rnd, rndi } from '../core/math.js';
import { box, cyl, mat } from './prop-models.js';

const M = {
  concrete: mat(0x8e8a82, { roughness: 0.95, metalness: 0.02 }),
  concreteD: mat(0x6a665f, { roughness: 0.95, metalness: 0.02 }),
  rust: mat(0x8a5a36, { roughness: 0.85 }),
  rustD: mat(0x5e3e28, { roughness: 0.9 }),
  steel: mat(0x9aa0a6, { metalness: 0.5 }),
  pipe: mat(0xa88c56),
  yellow: mat(0xc8a040),
  stripe: mat(0xd8d2c0),
  dark: mat(0x2a2c2e),
  rock: mat(0x4a3c32, { roughness: 1, metalness: 0 }),
  crystal: new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.1,
    flatShading: true,
  }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 1.4 }),
};

// ---------- 網格（純函式，尺寸由參數決定） ----------
// 廢工廠廠房：w×d、高 h，屋頂破洞、一側有大門開口（原點在地面中心）
export function buildFactoryHall(w, d, h) {
  const g = new THREE.Group();
  const t = 0.8;
  g.add(box(w, h, t, M.concrete, 0, h / 2, -d / 2));
  g.add(box(t, h, d, M.concrete, -w / 2, h / 2, 0));
  g.add(box(t, h, d, M.concrete, w / 2, h / 2, 0));
  const gw = Math.min(8, w * 0.5);
  for (const s of [-1, 1])
    g.add(box((w - gw) / 2, h, t, M.concrete, s * (gw / 2 + (w - gw) / 4), h / 2, d / 2));
  g.add(box(gw, h * 0.3, t, M.concreteD, 0, h * 0.85, d / 2));
  g.add(box(w * 0.55, 0.5, d, M.rustD, -w * 0.22, h + 0.25, 0));
  for (let x = -w / 2 + 3; x < w / 2; x += 4) g.add(box(0.4, 0.6, d, M.rust, x, h + 0.3, 0));
  g.add(cyl(0.9, 1.1, h * 1.8, M.concreteD, w / 2 - 2, h * 0.9, -d / 2 + 2, 10));
  return g;
}
// 地面管線一段（長 len，沿 Z；管徑 1.1、離地 1.1；每 6 m 一個支座）
export function buildGroundPipe(len) {
  const g = new THREE.Group();
  const p = cyl(0.55, 0.55, len, M.pipe, 0, 1.1, 0, 10);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  for (let z = -len / 2 + 1; z < len / 2; z += 6) {
    g.add(box(1.6, 0.6, 0.5, M.concreteD, 0, 0.3, z));
    const c = cyl(0.7, 0.7, 0.3, M.rust, 0, 1.1, z, 10);
    c.rotation.x = Math.PI / 2;
    g.add(c);
  }
  return g;
}
// 泵站：方形機房＋兩座儲槽
export function buildPumpStation() {
  const g = new THREE.Group();
  g.add(box(8, 5, 6, M.concrete, 0, 2.5, 0));
  g.add(box(8.4, 0.5, 6.4, M.rustD, 0, 5.2, 0));
  g.add(cyl(2, 2, 6, M.pipe, -6.5, 3, 0, 12));
  g.add(cyl(1.6, 1.6, 5, M.pipe, 6, 2.5, 1, 12));
  g.add(box(1, 3, 1, M.yellow, 0, 6.5, 0));
  return g;
}
// 紐澤西護欄（長 4 m）
export function buildBarrier() {
  const g = new THREE.Group();
  g.add(box(4, 0.5, 0.9, M.stripe, 0, 0.25, 0));
  g.add(box(4, 0.6, 0.5, M.stripe, 0, 0.8, 0));
  g.add(box(0.8, 0.4, 0.52, M.rust, -1, 0.9, 0));
  return g;
}
// 燒毀的車輛
export function buildCarWreck() {
  const g = new THREE.Group();
  g.add(box(2, 0.9, 4.4, M.rustD, 0, 0.75, 0));
  g.add(box(1.8, 0.7, 2.2, M.dark, 0, 1.5, -0.3));
  for (const [x, z] of [
    [-1, -1.4],
    [1, -1.4],
    [-1, 1.4],
    [1, 1.4],
  ]) {
    const c = cyl(0.4, 0.4, 0.3, M.dark, x, 0.4, z, 8);
    c.rotation.z = Math.PI / 2;
    g.add(c);
  }
  return g;
}
// 小型結晶簇（發光，高約 h）
export function buildCrystal(h) {
  const g = new THREE.Group();
  const C = [
    [0, 0, 0.35, 1, 0, 0],
    [0.45, 0.25, 0.25, 0.7, 0.35, 0.2],
    [-0.4, 0.2, 0.22, 0.6, -0.4, 0.1],
    [0.1, -0.45, 0.2, 0.5, 0.2, -0.4],
  ];
  for (const [x, z, r, k, rx, rz] of C) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r * h * 0.5, h * k, 6), M.crystal);
    m.position.set(x * h * 0.4, (h * k) / 2 - 0.2, z * h * 0.4);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  }
  return g;
}
// 礦坑坑口：岩壁上的方形入口與照明（寬 12、高 10）
export function buildMinePortal() {
  const g = new THREE.Group();
  g.add(box(4, 12, 6, M.rock, -8, 6, 0));
  g.add(box(4, 12, 6, M.rock, 8, 6, 0));
  g.add(box(20, 3, 6, M.rock, 0, 11.5, 0));
  g.add(box(12, 10, 0.4, M.dark, 0, 5, -2.8));
  for (const s of [-1, 1]) {
    g.add(box(0.6, 10, 0.6, M.yellow, s * 6, 5, 3));
    g.add(box(0.8, 0.5, 0.8, M.lamp, s * 6, 10.3, 3));
  }
  g.add(box(13, 0.8, 0.8, M.yellow, 0, 10.2, 3));
  return g;
}
// 主線的入口結構：升降梯平台（下降後抵達）／降落區標示（空降）——放在出生點，不碰撞
export function buildLiftPad() {
  const g = new THREE.Group();
  g.add(box(10, 0.3, 10, M.concreteD, 0, 0.15, 0));
  for (const [x, z] of [
    [-5.4, -5.4],
    [5.4, -5.4],
    [-5.4, 5.4],
    [5.4, 5.4],
  ]) {
    g.add(box(0.6, 14, 0.6, M.yellow, x, 7, z));
    g.add(box(0.7, 0.5, 0.7, M.lamp, x, 14.2, z));
  }
  for (const s of [-1, 1]) g.add(box(11.4, 0.5, 0.5, M.yellow, 0, 14, s * 5.4));
  return g;
}
export function buildLandingZone() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.2, 5, 32),
    new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x804000, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  for (const s of [-1, 1]) g.add(box(0.5, 0.06, 6, M.stripe, s * 1.5, 0.06, 0));
  g.add(box(3.5, 0.06, 0.5, M.stripe, 0, 0.06, 0));
  return g;
}

// ---------- 放置工具 ----------
// 在 World 上放一個大型結構（findSpot＋addBig），回傳是否成功
function place(w, g, bx, range, shapes, sink = 0.3) {
  const spot = w.findSpot(bx, range, 40);
  if (!spot) return null;
  g.position.y = spot.lo - sink;
  return w.addBig(
    g,
    spot,
    shapes.map((s) =>
      s.box ? { ...s, y: spot.lo - sink + (s.y || 0), top: spot.lo - sink + s.top } : { ...s, h: s.h },
    ),
  );
}
const smooth = (t) => t * t * (3 - 2 * t);

// ---------- 變體 ----------
export const VARIANTS = {
  wasteland: {
    factory: {
      name: '廢工廠群',
      theme: { featureKinds: ['bunkers', 'platforms'], corridor: { p: 0.35, kinds: ['road'] } },
      // 廠區整地：地形壓平
      terrain: () => (x, z, h) => h * 0.3,
      build(w) {
        for (let k = w.cnt(5, 7); k > 0; k--) {
          const hw = rndi(6, 10),
            hd = rndi(6, 9),
            hh = rnd(7, 11);
          place(w, buildFactoryHall(hw * 2, hd * 2, hh), [-hw - 1, hw + 1, -hd - 1, hd + 1], 2.5, [
            { box: [-hw, hw, -hd - 0.4, -hd + 0.4], top: hh },
            { box: [-hw - 0.4, -hw + 0.4, -hd, hd], top: hh },
            { box: [hw - 0.4, hw + 0.4, -hd, hd], top: hh },
            { box: [-hw, -4, hd - 0.4, hd + 0.4], top: hh },
            { box: [4, hw, hd - 0.4, hd + 0.4], top: hh },
          ]);
        }
      },
    },
    pipeline: {
      name: '輸油管線帶',
      theme: { featureKinds: ['trench'], corridor: { p: 0.5, kinds: ['rail'] } },
      terrain: () => (x, z, h) => h * 0.55,
      build(w) {
        // 幾條平行的地面管線（中間留缺口可以穿過）＋泵站
        const axis = rndi(0, 1);
        const lines = rndi(3, 4);
        const span = 50 * w.k;
        for (let i = 0; i < lines; i++) {
          const off = -span * 0.8 + ((span * 1.6) / (lines - 1)) * i + rnd(-4, 4);
          if (Math.abs(off) < 8) continue;
          let s = -span;
          while (s < span) {
            const len = rnd(22, 36);
            const c = s + len / 2;
            const x = axis ? c : off,
              z = axis ? off : c;
            if (!w.onCorridor(x, z, 6) && !w.isReserved(x, z, 3)) {
              const g = buildGroundPipe(len);
              const y = w.terrainHeight(x, z) - 0.2;
              g.position.set(x, y, z);
              if (axis) g.rotation.y = Math.PI / 2;
              w.scene.add(g);
              w.meshes.push(g);
              w.obstacles.push({
                kind: 'box',
                x,
                z,
                w: axis ? len : 1.6,
                d: axis ? 1.6 : len,
                y,
                top: y + 1.7,
                group: g,
                mats: [],
                box: null,
              });
            }
            s += len + rnd(9, 14);
          }
        }
        for (let k = w.cnt(2, 3); k > 0; k--)
          place(w, buildPumpStation(), [-9, 8, -4, 4], 2, [
            { box: [-4, 4, -3, 3], top: 5.5 },
            { c: [-6.5, 0], r: 2, h: 6 },
            { c: [6, 1], r: 1.6, h: 5 },
          ]);
      },
    },
    slag: {
      name: '礦渣堆場',
      theme: {
        featureKinds: ['platforms'],
        corridor: { p: 0.25, kinds: ['rail'] },
        ground: 0x6a5c52,
        slope: 0x433832,
        rock: 0x2e2824,
        fog: 0xa8988a,
      },
      // 十幾座圓錐形的渣山（避開中央出生點）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const heaps = [];
        const L = 52 * w.k;
        for (let t = 0; t < 80 && heaps.length < Math.round(12 * w.k); t++) {
          const x = (r() * 2 - 1) * L,
            z = (r() * 2 - 1) * L;
          if (Math.hypot(x, z) < 22) continue;
          if (heaps.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 0.8)) continue;
          heaps.push({ x, z, r: 9 + r() * 10, h: 5 + r() * 9 });
        }
        return (x, z, h) => {
          let m = h * 0.5;
          for (const q of heaps) {
            const t = clamp(1 - Math.hypot(x - q.x, z - q.z) / q.r, 0, 1);
            m = Math.max(m, h * 0.5 + q.h * smooth(t));
          }
          return m;
        };
      },
    },
    junction: {
      name: '公路交流道',
      theme: { featureKinds: ['overpass', 'bunkers'], corridor: { p: 1, kinds: ['road'] } },
      terrain: () => (x, z, h) => h * 0.4,
      build(w) {
        // 護欄列與燒毀的車輛
        w.scatter(w.cnt(10, 14), 7, (x, z, y) => {
          const g = buildBarrier();
          g.rotation.y = rndi(0, 1) * (Math.PI / 2);
          const a = g.rotation.y ? 1 : 0;
          w.addSmall(g, x, y, z, { w: a ? 0.9 : 4, h: 1.1, d: a ? 4 : 0.9 });
        });
        w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
          const g = buildCarWreck();
          w.addSmall(g, x, y, z, { r: 1.6, h: 1.8 }, 'car', 600, 0x5e3e28);
        });
      },
    },
  },
  desert: {
    openpit: {
      name: '露天礦場',
      theme: { featureKinds: ['platforms'], corridor: { p: 0.3, kinds: ['rail'] } },
      // 階梯式大坑：中心在出生點附近，4 層平台
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const cx = (r() - 0.5) * 30,
          cz = (r() - 0.5) * 30,
          R = 58 * w.k,
          D = 20;
        return (x, z, h) => {
          const t = clamp(1 - Math.hypot(x - cx, z - cz) / R, 0, 1);
          const st = 4;
          const f = t * st;
          const i = Math.floor(f),
            fr = f - i;
          const step = (i + smooth(clamp((fr - 0.7) / 0.3, 0, 1))) / st;
          return h * 0.4 - D * step;
        };
      },
    },
    tunnels: {
      name: '坑道網',
      theme: {
        featureKinds: ['bunkers'],
        corridor: { p: 0, kinds: [] },
        roof: { y: 17, color: 0x2e2620, bump: 5 },
        sunI: 0.45,
        hemiI: 0.7,
        fogNear: 25,
        fogFar: 130,
        fog: 0x4a3c30,
        sky: 0x2a2018,
      },
      // 岩壁圍出的坑道：幾條沿 X／Z 的通道（一條經過中心），通道外是岩壁
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const L = 60 * w.k;
        const xs = [0],
          zs = [0];
        for (let i = 0; i < 2; i++) {
          xs.push((r() * 2 - 1) * L * 0.75);
          zs.push((r() * 2 - 1) * L * 0.75);
        }
        const halls = [];
        for (let i = 0; i < 3; i++)
          halls.push({ x: (r() * 2 - 1) * L * 0.6, z: (r() * 2 - 1) * L * 0.6, r: 12 + r() * 8 });
        const half = 7;
        return (x, z, h) => {
          let d = 1e9;
          for (const a of xs) d = Math.min(d, Math.abs(x - a));
          for (const b of zs) d = Math.min(d, Math.abs(z - b));
          for (const q of halls) d = Math.min(d, Math.hypot(x - q.x, z - q.z) - q.r + half);
          const t = clamp((d - half) / 4, 0, 1);
          return h * 0.2 + 21 * smooth(t);
        };
      },
      // 岩壁（高過岩頂）上不放東西、不生成
      offLimits: (w, x, z) => w.terrainHeight(x, z) > 6,
    },
    shaft: {
      name: '豎井大廳',
      theme: { featureKinds: ['bunkers'], corridor: { p: 0, kinds: [] }, fogFar: 160 },
      // 中央的大豎井（碗形下陷）與環狀台階
      terrain(w) {
        const R = 40 * w.k,
          D = 18;
        return (x, z, h) => {
          const d = Math.hypot(x, z);
          const t = clamp(1 - d / R, 0, 1);
          const ring = d > R * 0.55 && d < R * 0.7 ? 0.45 : null;
          const k = ring !== null ? Math.min(ring, smooth(t)) : smooth(t);
          return h * 0.6 - D * k;
        };
      },
      build(w) {
        // 豎井壁上的懸空平台
        const R = 40 * w.k;
        const n = rndi(4, 6);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
          const x = Math.cos(a) * R * 0.78,
            z = Math.sin(a) * R * 0.78;
          const y = w.terrainHeight(x, z) + rnd(5, 8);
          w.addDeck(x, z, rnd(8, 12), rnd(8, 12), y, 0.8, 0);
        }
      },
    },
    vein: {
      name: '地下礦脈',
      theme: {
        featureKinds: ['bunkers', 'trench'],
        corridor: { p: 0, kinds: [] },
        roof: { y: 22, color: 0x1e1a22, bump: 9 },
        sunI: 0.3,
        hemiI: 0.55,
        fogNear: 20,
        fogFar: 120,
        fog: 0x2a2434,
        sky: 0x16121c,
        ground: 0x5a4a44,
        slope: 0x3e3230,
        rock: 0x2a2226,
      },
      build(w) {
        w.scatter(w.cnt(16, 22), 7, (x, z, y) => {
          const h = rnd(2, 4.5);
          const g = buildCrystal(h);
          g.rotation.y = rnd(0, 6.28);
          w.addSmall(g, x, y, z, { r: h * 0.3, h }, 'crystal', 400, 0x7fe0ff);
        });
      },
    },
    outskirts: {
      name: '礦場外圍',
      border: true, // 交界區段：地表主題往礦坑過渡
      theme: {
        featureKinds: ['bunkers', 'trench'],
        corridor: { p: 0.8, kinds: ['rail'] },
        ground: 0x8a7458,
        slope: 0x5e4a3a,
        weather: 'dust',
      },
      // 地面往一側下陷（礦坑的方向）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = r() * Math.PI * 2,
          c = Math.cos(a),
          s = Math.sin(a);
        w.sinkDir = [c, s];
        return (x, z, h) => {
          const u = x * c + z * s;
          return h - 12 * smooth(clamp((u - 10) / (50 * w.k), 0, 1));
        };
      },
      build(w) {
        const [c, s] = w.sinkDir || [1, 0];
        // 坑口放在下陷的那一側
        for (let t = 0; t < 10; t++) {
          const d = 45 * w.k + rnd(-6, 6),
            x = c * d + rnd(-10, 10),
            z = s * d + rnd(-10, 10);
          if (w.onCorridor(x, z, 8) || w.isReserved(x, z, 6)) continue;
          const g = buildMinePortal();
          const y = w.terrainHeight(x, z);
          g.rotation.y = Math.atan2(-c, -s);
          const ob = w.addSmall(g, x, y - 0.3, z, { w: 20, h: 13, d: 6 });
          ob.mats = [];
          break;
        }
      },
    },
  },
};
export const variantKeys = (theme) => Object.keys(VARIANTS[theme] || {});
export const variantOf = (theme, key) => (VARIANTS[theme] || {})[key] || null;
// 模型庫登記：[key, 名稱, 備註, build]
export const VARIANT_CATALOG = [
  [
    'factory_hall',
    '廢工廠廠房',
    '荒野「廢工廠群」；寬 12–20、深 12–18、高 7–11 m',
    () => buildFactoryHall(16, 14, 9),
  ],
  ['ground_pipe', '地面管線', '荒野「輸油管線帶」；長 22–36 m，管徑 1.1 m', () => buildGroundPipe(24)],
  ['pump_station', '泵站', '荒野「輸油管線帶」；8×6 m', () => buildPumpStation()],
  ['barrier', '紐澤西護欄', '荒野「公路交流道」；長 4 m', () => buildBarrier()],
  ['car_wreck', '燒毀的車輛', '荒野「公路交流道」；可破壞', () => buildCarWreck()],
  ['crystal_s', '結晶簇', '礦坑「地下礦脈」；高 2–4.5 m，可破壞', () => buildCrystal(3)],
  ['mine_portal', '礦坑坑口', '礦坑「礦場外圍」；寬 20、高 13 m', () => buildMinePortal()],
  ['lift_pad', '升降梯平台', '主線：下降後的入口結構（不碰撞）', () => buildLiftPad()],
  ['landing_zone', '降落區標示', '主線：空降的入口標示（不碰撞）', () => buildLandingZone()],
];
