// 主題：汙染水沒市街（AC6 貝利烏斯南部的水沒市街）——街道泡在汙水裡、街區高出水面，大樓廢墟可站上屋頂
import { RNG, clamp, lerp, pick, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, hashRng, mat, propGlb, registerFeatureStyle, windowMat } from './kit.js';

const CELL = 30, // 街區＋街道
  STREET = 9,
  WATER = 0.2;

// ---------- 物件（純函式，支援 GLB：prop/<槽位>）----------
// 大樓廢墟：w × h × d，原點在底面中心；broken：頂部崩塌（外觀）
export function buildRuinTower(w, h, d, broken, seed) {
  const glb = propGlb('ruin_tower', { ref: [16, 24, 16], size: [w, h, d], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const wm = windowMat({ base: '#7a7d78', win: '#22282b', broken: 0.2, seed }, Math.max(w, d), h);
  const body = box(w, h, d, wm, 0, h / 2, 0);
  g.add(body);
  const trim = fadeMat(0x5a5d5a, { roughness: 0.9 });
  g.add(box(w + 0.3, 0.6, d + 0.3, trim, 0, h, 0));
  const r = hashRng(seed);
  if (broken) {
    // 屋頂上的斷牆與傾斜的樓板
    for (let i = 0; i < 4; i++) {
      const bw = w * (0.25 + r() * 0.3),
        bh = 1.5 + r() * 3;
      const b = box(
        bw,
        bh,
        0.5,
        trim,
        (r() - 0.5) * (w - bw),
        h + bh / 2,
        (r() > 0.5 ? 1 : -1) * (d / 2 - 0.25),
      );
      g.add(b);
    }
    const slab = box(w * 0.6, 0.4, d * 0.5, trim, w * 0.15, h + 0.8, 0);
    slab.rotation.z = 0.25;
    g.add(slab);
  } else {
    g.add(box(w * 0.3, 2.2, d * 0.3, trim, -w * 0.2, h + 1.1, d * 0.15));
  }
  // 水線的汙漬
  g.add(box(w + 0.05, 1.2, d + 0.05, fadeMat(0x3e4a3e, { roughness: 1 }), 0, 0.9, 0));
  return g;
}
// 廢棄車輛：2 × 1.4 × 4.4（長沿 Z），原點在底面中心
export const CAR = [2, 1.5, 4.4];
export function buildWreckCar(color) {
  const glb = propGlb('wreck_car', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.4 }),
    dk = fadeMat(0x22262a, { roughness: 0.9 });
  g.add(box(2, 0.8, 4.4, m, 0, 0.6, 0));
  const cab = box(1.8, 0.7, 2.2, dk, 0, 1.3, -0.2);
  cab.rotation.x = 0.05;
  g.add(cab);
  for (const sx of [-0.85, 0.85])
    for (const sz of [-1.4, 1.4]) {
      const w = cyl(0.35, 0.35, 0.3, dk, sx, 0.3, sz, 8);
      w.rotation.z = Math.PI / 2;
      g.add(w);
    }
  g.rotation.z = 0.08;
  return g;
}
// 半沉的公車：2.6 × 3 × 10（長沿 Z），原點在底面中心
export const BUS = [2.8, 2.6, 10];
export function buildSunkBus(color) {
  const glb = propGlb('sunk_bus', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.3 }),
    win = fadeMat(0x1d2326, { roughness: 0.3 });
  const body = new THREE.Group();
  body.rotation.set(0.06, 0, 0.18);
  body.add(box(2.6, 2.8, 10, m, 0, 1.2, 0));
  for (const s of [-1, 1]) body.add(box(0.05, 0.9, 8.6, win, s * 1.31, 1.9, 0));
  g.add(body);
  return g;
}
// 斷牆：w × h × 0.8（沿 X），原點在底面中心；頂部呈階梯狀崩落
export function buildRuinWall(w, h, color) {
  const glb = propGlb('ruin_wall', { color, ref: [6, 3.5, 0.8], size: [w, h, 0.8], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.95 });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const hh = h * (1 - Math.abs(i - 1.2) * 0.22);
    g.add(box(w / n, hh, 0.8, m, -w / 2 + (w / n) * (i + 0.5), hh / 2, 0));
  }
  return g;
}
// 彎折的路燈：原點在底面中心
export function buildBentLamp(h) {
  const glb = propGlb('bent_lamp', { ref: [2, 7, 1], size: [2, h, 1] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(0x4a4f52, { roughness: 0.6, metalness: 0.5 });
  const pole = box(0.25, h * 0.6, 0.25, m, 0, h * 0.3, 0);
  g.add(pole);
  const top = new THREE.Group();
  top.position.y = h * 0.6;
  top.rotation.z = -0.9;
  top.add(box(0.22, h * 0.4, 0.22, m, 0, h * 0.2, 0));
  top.add(box(0.8, 0.25, 0.4, mat(0x9aa0a0), 0.3, h * 0.4, 0));
  g.add(top);
  return g;
}
// 瓦礫堆（純裝飾）
export function buildRubble(s) {
  const glb = propGlb('rubble', { ref: [3, 1.2, 3], size: [3 * s, 1.2 * s, 3 * s] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(0x6a6c68, { roughness: 1 });
  for (let i = 0; i < 5; i++) {
    const b = box(
      s * (0.6 + (i % 3) * 0.3),
      s * 0.4,
      s * (0.5 + (i % 2) * 0.4),
      m,
      (i - 2) * s * 0.35,
      s * 0.2,
      (((i * 7) % 5) - 2) * s * 0.25,
    );
    b.rotation.set(i * 0.3, i * 0.9, i * 0.2);
    g.add(b);
  }
  return g;
}
// 漂浮雜物（純裝飾，浮在水面）
export function buildFloatJunk() {
  const glb = propGlb('float_junk');
  if (glb) return glb;
  const g = new THREE.Group();
  g.add(box(1.4, 0.15, 0.9, mat(0x6b5a44, { roughness: 1 })));
  const drum = cyl(0.35, 0.35, 0.9, mat(0x7a3c2a, { roughness: 0.8 }), 0.9, 0.1, 0.3, 8);
  drum.rotation.z = Math.PI / 2;
  g.add(drum);
  return g;
}

// ---------- 地形特徵的外觀（崩塌的高架道路、鋼筋外露的柱、磚牆、塌落的樓板、瓦礫坡、地下道口）----------
const C = {
  deck: 0x6c6e6a,
  trim: 0x8a8c86,
  pillar: 0x777a76,
  wall: 0x7a4e3c,
  plat: 0x6e706c,
  rock: 0x3a403a,
};
const rebar = (n, len, at) => {
  const g = new THREE.Group();
  const m = mat(0x5a3a2a, { roughness: 0.7, metalness: 0.6 });
  for (let i = 0; i < n; i++) {
    const b = box(0.08, len, 0.08, m, at[0] + (i - n / 2) * 0.35, at[1] + len / 2, at[2]);
    b.rotation.z = (i % 2 ? 1 : -1) * 0.3;
    g.add(b);
  }
  return g;
};
registerFeatureStyle('flooded', C, {
  deck(w, d, thick, rotY, C) {
    const g = new THREE.Group();
    const dm = fadeMat(C.deck, { roughness: 0.9 }),
      tm = fadeMat(C.trim, { roughness: 0.9 });
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    const L = rotY ? d : w;
    const n = Math.max(3, Math.round(L / 3));
    for (const s of [-1, 1])
      for (let i = 0; i < n; i++) {
        if ((i * 5 + (s > 0 ? 2 : 0)) % 4 === 0) continue; // 護欄缺口
        const at = -L / 2 + (L / n) * (i + 0.5);
        g.add(
          rotY
            ? box(0.35, 0.9, L / n - 0.1, tm, s * (w / 2 - 0.2), 0.45, at)
            : box(L / n - 0.1, 0.9, 0.35, tm, at, 0.45, s * (d / 2 - 0.2)),
        );
      }
    g.add(rebar(5, 1.2, rotY ? [0, -thick, d / 2] : [w / 2, -thick, 0]));
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    g.add(box(r * 1.7, h, r * 1.7, mat(C.pillar, { roughness: 0.95 })));
    g.add(rebar(3, 0.8, [0, h / 2 - 0.2, r * 0.6]));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    const m = fadeMat(C.wall, { roughness: 1 });
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    const n = 5;
    for (let i = 0; i < n; i++) {
      const hh = h * (1 - (i % 3) * 0.18);
      const at = -L / 2 + (L / n) * (i + 0.5);
      g.add(along ? box(L / n, hh, T, m, at, (hh - h) / 2, 0) : box(T, hh, L / n, m, 0, (hh - h) / 2, at));
    }
    return g;
  },
  platform(w, h, d, C) {
    // 塌落的樓板：幾層錯開的板，頂面平整（碰撞同方盒）
    const g = new THREE.Group();
    const m = fadeMat(C.plat, { roughness: 0.95 });
    const n = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < n; i++) {
      const s = 1 - (n - 1 - i) * 0.04;
      g.add(box(w * s, h / n - 0.15, d * s, m, (i % 2 ? 0.3 : -0.3) * (1 - s) * 10, (h / n) * (i + 0.5), 0));
    }
    g.add(rebar(6, 1, [0, h - 0.2, d / 2 - 0.3]));
    return g;
  },
  ramp(rw, rd) {
    const g = new THREE.Group();
    g.add(box(rw, 0.45, rd, mat(0x6a6c68, { roughness: 1 })));
    return g;
  },
  tunnel(C) {
    const g = new THREE.Group();
    const m = mat(0x5d605c, { roughness: 0.95 });
    g.add(box(24, 14, 10, mat(C.rock, { roughness: 1 }), 0, 5, -6));
    g.add(box(14, 9, 2.5, m, 0, 4.5, 0));
    g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
    g.add(box(6, 1.2, 0.3, mat(0x2a5a8a), 0, 7.8, 1.3)); // 地下道的路牌
    return g;
  },
});

// ---------- 地形：街區網格（街道在水面下，街區高出水面，部分街區塌陷）----------
function planTerrain(w) {
  const ox = rnd(0, CELL),
    oz = rnd(0, CELL);
  const n = w.noise,
    n2 = w.noise2;
  w.city = { ox, oz };
  const mod = (a) => ((a % CELL) + CELL) % CELL;
  return (x, z) => {
    const u = mod(x - ox),
      v = mod(z - oz);
    const dx = Math.min(u - STREET, CELL - u),
      dz = Math.min(v - STREET, CELL - v);
    const t = clamp(Math.min(dx, dz) / 1.5, 0, 1);
    // 塌陷的街區（低頻雜訊高的地方）整塊在水面下
    const sunk = n(x * 0.012 + 3, z * 0.012 - 2) > 0.72;
    const top = sunk ? -0.25 : 0.75;
    return lerp(-0.6, top, t * t * (3 - 2 * t)) + (n2(x * 0.08, z * 0.08) - 0.5) * 0.3;
  };
}
// 街區中心清單
function blocks(w) {
  const out = [];
  const half = w.lim - 6;
  for (let bx = w.city.ox + STREET - CELL * 6; bx < half; bx += CELL)
    for (let bz = w.city.oz + STREET - CELL * 6; bz < half; bz += CELL) {
      const cx = bx + (CELL - STREET) / 2,
        cz = bz + (CELL - STREET) / 2;
      if (Math.abs(cx) > half || Math.abs(cz) > half) continue;
      out.push([cx, cz]);
    }
  return out;
}

// (x, z) 周圍 r 內是否已有障礙物（地形特徵的掩體、高台…）
export function overlaps(w, x, z, r) {
  return w.obstacles.some((o) =>
    o.kind === 'box'
      ? Math.abs(x - o.x) < o.w / 2 + r && Math.abs(z - o.z) < o.d / 2 + r
      : Math.hypot(x - o.x, z - o.z) < o.r + r,
  );
}

function buildProps(w) {
  const B = CELL - STREET;
  // 大樓廢墟：佔一個街區，可站上屋頂
  for (const [cx, cz] of blocks(w)) {
    if (Math.hypot(cx, cz) < 24 || RNG() > 0.5) continue;
    if (w.onCorridor(cx, cz, B * 0.6) || w.terrainHeight(cx, cz) < 0.2) continue;
    if (overlaps(w, cx, cz, B / 2)) continue;
    const bw = rnd(11, B - 2),
      bd = rnd(11, B - 2),
      h = RNG() < 0.25 ? rnd(26, 40) : rnd(10, 24),
      broken = RNG() < 0.55;
    const g = buildRuinTower(bw, h, bd, broken, Math.floor(RNG() * 1e6));
    const y = w.terrainHeight(cx, cz) - 0.3;
    g.position.y = y;
    w.addBig(g, { x: cx, z: cz, q: 0, rotY: 0 }, [
      { box: [-bw / 2, bw / 2, -bd / 2, bd / 2], y, top: y + h },
    ]);
  }
  w.scatter(
    w.cnt(8, 12),
    6,
    (x, z, y) => {
      const color = pick([0x7a3a2a, 0x3a4a5a, 0x6a6a5a, 0x8a7a3a]);
      const g = buildWreckCar(color);
      const rot = RNG() < 0.5;
      if (rot) g.rotation.y = Math.PI / 2;
      w.addSmall(
        g,
        x,
        y - 0.1,
        z,
        { w: rot ? CAR[2] : CAR[0], h: CAR[1], d: rot ? CAR[0] : CAR[2] },
        'car',
        900,
        color,
      );
    },
    false,
  );
  w.scatter(
    w.cnt(2, 4),
    10,
    (x, z, y) => {
      const color = pick([0xb08a2a, 0x4a6a8a]);
      const g = buildSunkBus(color);
      const rot = RNG() < 0.5;
      if (rot) g.rotation.y = Math.PI / 2;
      w.addSmall(
        g,
        x,
        y - 0.6,
        z,
        { w: rot ? BUS[2] : BUS[0], h: BUS[1], d: rot ? BUS[0] : BUS[2] },
        'bus',
        2500,
        color,
      );
    },
    false,
  );
  w.scatter(
    w.cnt(6, 10),
    7,
    (x, z, y) => {
      const len = rnd(5, 9),
        h = rnd(3, 5),
        color = pick([0x7a4e3c, 0x8a8a84]);
      const g = buildRuinWall(len, h, color);
      const rot = RNG() < 0.5;
      if (rot) g.rotation.y = Math.PI / 2;
      w.addSmall(g, x, y - 0.3, z, { w: rot ? 0.8 : len, h, d: rot ? len : 0.8 }, 'ruinwall', 1800, color);
    },
    false,
  );
  w.scatter(
    w.cnt(6, 10),
    5,
    (x, z, y) => {
      const h = rnd(6, 8);
      const g = buildBentLamp(h);
      g.rotation.y = rnd(0, 6.28);
      w.addSmall(g, x, y - 0.2, z, { r: 0.5, h }, 'streetlamp', 600, 0x4a4f52);
    },
    false,
  );
  w.addDecor(Math.round(26 * w.k * w.k), () => buildRubble(rnd(0.6, 1.4)), 0.2);
  // 漂浮雜物：只放在水面上（地形低於水面的地方）
  for (let i = 0, n = Math.round(30 * w.k * w.k); i < n; i++) {
    const x = rnd(-w.lim, w.lim),
      z = rnd(-w.lim, w.lim);
    if (w.terrainHeight(x, z) > WATER - 0.2) continue;
    const m = buildFloatJunk();
    m.position.set(x, WATER + 0.02, z);
    m.rotation.y = rnd(0, 6.28);
    w.scene.add(m);
    w.meshes.push(m);
  }
}

export const FLOODED = {
  name: '汙染水沒市街',
  ground: 0x55594f,
  slope: 0x44483f,
  rock: 0x3a403a,
  fog: 0x7d8a80,
  sky: 0x8d9a92,
  sun: 0xd8dcc8,
  amb: 0x5d6a62,
  container: 0x6a6a5a,
  container2: 0x7a3a2a,
  hasRocks: false,
  weather: 'rain',
  props: 'flooded',
  water: { level: WATER, color: 0x26332b, opacity: 0.9 },
  sunI: 0.75,
  fogFar: 170,
  featureKinds: ['overpass', 'bunkers', 'platforms'],
  noCorridor: true, // 街道泡在水裡，沒有穿越的公路／鐵路
  planTerrain,
  buildProps,
  propNames: { car: '廢棄車輛', bus: '公車殘骸', ruinwall: '斷牆', streetlamp: '路燈' },
  catalog: [
    [
      'ruin_tower',
      '大樓廢墟',
      '汙染水沒市街；寬 11–19、高 10–40 m，可站上屋頂、不可破壞' + '；GLB 依尺寸縮放',
      () => buildRuinTower(16, 24, 16, true, 7),
    ],
    [
      'wreck_car',
      '廢棄車輛',
      '汙染水沒市街；2 × 1.5 × 4.4 m（長沿 Z），可破壞',
      () => buildWreckCar(0x7a3a2a),
    ],
    [
      'sunk_bus',
      '半沉的公車',
      '汙染水沒市街；2.8 × 2.6 × 10 m（長沿 Z），可破壞',
      () => buildSunkBus(0xb08a2a),
    ],
    [
      'ruin_wall',
      '斷牆',
      '汙染水沒市街；長 5–9、高 3–5 m（沿 X），可破壞；GLB 依尺寸縮放',
      () => buildRuinWall(6, 3.5, 0x7a4e3c),
    ],
    ['bent_lamp', '彎折的路燈', '汙染水沒市街；高 6–8 m，可破壞；GLB 依高度縮放', () => buildBentLamp(7)],
    ['rubble', '瓦礫堆', '汙染水沒市街的裝飾；GLB 依尺寸縮放', () => buildRubble(1)],
    ['float_junk', '漂浮雜物', '汙染水沒市街的裝飾，浮在水面', () => buildFloatJunk()],
  ],
};
