// 主題：Grid 086 巨型構造體（AC6 貝利烏斯西部的 Grid 086）——地面層之上有兩層鋼構平台（Y1、Y2），
// 平台之間留有空隙；坡道從地面接到第一層、從第一層接到第二層（懸空坡道 lift），也可以跳躍、懸浮上下
import { RNG, pick, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle } from './kit.js';

const TILE = 24,
  Y1 = 11,
  Y2 = 21,
  THICK = 1.2;

// ---------- 物件 ----------
// Doser 棚屋：拼湊的鐵皮屋，5 × 3.6 × 4，原點在底面中心
export const SHACK = [5, 3.6, 4];
export function buildShack(color) {
  const glb = propGlb('doser_shack', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.4 }),
    rust = fadeMat(0x7a3f22, { roughness: 1 }),
    dk = fadeMat(0x22201e, { roughness: 1 });
  g.add(box(5, 3, 4, m, 0, 1.5, 0));
  const roof = box(5.6, 0.2, 4.6, rust, 0, 3.3, 0);
  roof.rotation.z = 0.12;
  g.add(roof);
  g.add(box(1.4, 2.2, 0.1, dk, -1, 1.1, 2.01));
  g.add(box(1.8, 1, 0.1, rust, 1.2, 1.6, 2.02));
  g.add(cyl(0.2, 0.2, 1.4, dk, 1.8, 4, -1.2, 6));
  return g;
}
// 廢料堆：半徑約 2.5，原點在底面中心
export function buildScrapHeap(s) {
  const glb = propGlb('scrap_heap', { ref: [5, 2.6, 5], size: [5 * s, 2.6 * s, 5 * s], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const cols = [0x5a4a3e, 0x7a3f22, 0x4a4e52, 0x6a5a3a];
  for (let i = 0; i < 9; i++) {
    const b = box(
      s * (0.8 + (i % 3) * 0.5),
      s * (0.4 + (i % 2) * 0.5),
      s * (0.7 + ((i * 5) % 3) * 0.4),
      fadeMat(cols[i % 4], { roughness: 0.9, metalness: 0.4 }),
      (((i * 7) % 5) - 2) * s * 0.55,
      s * (0.3 + (i % 4) * 0.45),
      (((i * 3) % 5) - 2) * s * 0.5,
    );
    b.rotation.set(i * 0.4, i * 1.1, i * 0.3);
    g.add(b);
  }
  return g;
}
// 油桶群（3 個）：原點在底面中心
export function buildBarrels() {
  const glb = propGlb('barrels', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const cols = [0x8a3a2a, 0x3a5a7a, 0x6a6a2a];
  for (let i = 0; i < 3; i++)
    g.add(
      cyl(
        0.45,
        0.45,
        1.3,
        fadeMat(cols[i], { roughness: 0.7, metalness: 0.4 }),
        Math.cos(i * 2.1) * 0.6,
        0.65,
        Math.sin(i * 2.1) * 0.6,
        10,
      ),
    );
  return g;
}
// 排氣煙囪：半徑 r、高 h，原點在底面中心；GLB 以半徑 1.5、高 30 m 製作
export function buildChimney(r, h) {
  const glb = propGlb('chimney', { ref: [3, 30, 3], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x5a4e46, { roughness: 0.9, metalness: 0.3 }),
    band = fadeMat(0xb04a2a, { roughness: 0.7 });
  g.add(cyl(r * 0.8, r, h, m, 0, h / 2, 0, 12));
  for (const y of [h * 0.3, h * 0.6, h - 1.5]) g.add(cyl(r * 0.9, r * 0.9, 0.8, band, 0, y, 0, 12));
  return g;
}
// 垂直的管線束：原點在底面中心，高 h
export function buildPipeStack(h) {
  const glb = propGlb('pipe_stack', { ref: [3, 9, 1.4], size: [3, h, 1.4], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const cols = [0x8a7a5a, 0x5a6a72, 0x7a5a3a];
  for (let i = 0; i < 4; i++)
    g.add(
      cyl(
        0.32,
        0.32,
        h,
        fadeMat(cols[i % 3], { roughness: 0.6, metalness: 0.5 }),
        -1.1 + i * 0.75,
        h / 2,
        0,
        8,
      ),
    );
  for (const y of [1.5, h * 0.5, h - 1]) g.add(box(3.2, 0.3, 1, fadeMat(0x3a3836), 0, y, 0));
  return g;
}

// ---------- 平台、柱、坡道的外觀（鋼格柵＋警示邊、鉚接鋼柱）----------
const C = {
  deck: 0x4a4642,
  trim: 0xd8a020,
  pillar: 0x5e5650,
  wall: 0x6a625a,
  plat: 0x5a524a,
  rock: 0x2a2826,
};
registerFeatureStyle('grid086', C, {
  deck(w, d, thick, rotY, C) {
    const g = new THREE.Group();
    const dm = fadeMat(C.deck, { roughness: 0.6, metalness: 0.6 }),
      tm = fadeMat(C.trim, { roughness: 0.6 }),
      rib = fadeMat(0x2e2a28, { roughness: 0.8, metalness: 0.4 });
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    // 底面的大梁
    for (let x = -w / 2 + 3; x < w / 2; x += 6) g.add(box(0.6, 1.2, d, rib, x, -thick - 0.6, 0));
    // 邊緣警示條
    for (const s of [-1, 1]) {
      g.add(box(w, 0.06, 0.5, tm, 0, 0.03, s * (d / 2 - 0.25)));
      g.add(box(0.5, 0.06, d, tm, s * (w / 2 - 0.25), 0.03, 0));
    }
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    const m = mat(C.pillar, { roughness: 0.6, metalness: 0.6 });
    g.add(box(r * 1.6, h, r * 1.6, m));
    for (const y of [-h / 2 + 0.4, h / 2 - 0.4])
      g.add(box(r * 2.1, 0.8, r * 2.1, mat(0x3a3632, { metalness: 0.5 }), 0, y, 0));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.wall, { roughness: 0.8, metalness: 0.4 })));
    return g;
  },
  platform(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.plat, { roughness: 0.8, metalness: 0.4 }), 0, h / 2, 0));
    return g;
  },
  ramp(rw, rd, C) {
    const g = new THREE.Group();
    g.add(box(rw, 0.5, rd, mat(C.deck, { roughness: 0.6, metalness: 0.6 })));
    const along = rw >= rd;
    for (const s of [-1, 1])
      g.add(
        along
          ? box(rw, 1, 0.2, mat(C.trim), 0, 0.6, s * (rd / 2 - 0.1))
          : box(0.2, 1, rd, mat(C.trim), s * (rw / 2 - 0.1), 0.6, 0),
      );
    return g;
  },
  tunnel(C) {
    const g = new THREE.Group();
    g.add(box(24, 14, 10, mat(C.rock, { roughness: 1 }), 0, 5, -6));
    g.add(box(14, 10, 2.5, mat(C.wall, { metalness: 0.4 }), 0, 5, 0));
    g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
    return g;
  },
});

// ---------- 地形：平坦的底層 ----------
function planTerrain(w) {
  const n2 = w.noise2;
  return (x, z) => (n2(x * 0.1, z * 0.1) - 0.5) * 0.25;
}

// 平台格子：第一層、第二層的佔用與坡道
function buildStructures(w) {
  const n = w.noise,
    n2 = w.noise2;
  const lim = w.lim - 4;
  const cells = [];
  const N = Math.floor((lim * 2) / TILE);
  const off = -(N * TILE) / 2 + TILE / 2;
  const key = (i, j) => i + ',' + j;
  const L1 = new Set(),
    L2 = new Set();
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const cx = off + i * TILE,
        cz = off + j * TILE;
      cells.push([i, j, cx, cz]);
      if (Math.hypot(cx, cz) < TILE * 0.8) continue; // 出生點上方保持開闊
      if (w.onCorridor(cx, cz, TILE * 0.55)) continue; // 公路／鐵路上方開闊（列車與運輸車）
      if (n(cx * 0.03 + 5, cz * 0.03 - 7) > 0.42) L1.add(key(i, j));
    }
  for (const k of L1) {
    const [i, j] = k.split(',').map(Number);
    const cx = off + i * TILE,
      cz = off + j * TILE;
    if (n2(cx * 0.04 - 3, cz * 0.04 + 8) > 0.55) L2.add(k);
  }
  const deckW = TILE - 0.4;
  const pillars = new Set();
  const pillar = (x, z, y0, y1) => {
    const k = Math.round(x) + ',' + Math.round(z) + ',' + y1;
    if (pillars.has(k)) return;
    pillars.add(k);
    w.addPillar(x, z, 0.9, y0, y1, null);
  };
  for (const [i, j, cx, cz] of cells) {
    const k = key(i, j);
    if (!L1.has(k)) continue;
    w.addDeck(cx, cz, deckW, deckW, Y1, THICK, false, null);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        pillar(cx + sx * (TILE / 2 - 2), cz + sz * (TILE / 2 - 2), w.terrainHeight(cx, cz) - 0.5, Y1 - THICK);
    if (L2.has(k)) {
      w.addDeck(cx, cz, deckW, deckW, Y2, THICK, false, null);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) pillar(cx + sx * (TILE / 2 - 2), cz + sz * (TILE / 2 - 2), Y1, Y2 - THICK);
    }
  }
  w.grid086 = {
    L1,
    L2,
    off,
    key,
    covered: (x, z) => L1.has(key(Math.round((x - off) / TILE), Math.round((z - off) / TILE))),
  };
  // 坡道：地面 → 第一層（在沒有平台的鄰格），第一層 → 第二層（懸空坡道，在沒有第二層的第一層格子）
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const ramps = [];
  const tryRamp = (from, toSet, y0, y1, lift, maxN) => {
    const list = [...from].sort(() => RNG() - 0.5);
    for (const k of list) {
      if (ramps.filter((r) => r.lift === lift).length >= maxN) break;
      const [i, j] = k.split(',').map(Number);
      for (const [di, dj] of dirs.sort(() => RNG() - 0.5)) {
        const nk = key(i + di, j + dj);
        if (i + di < 0 || j + dj < 0 || i + di >= N || j + dj >= N) continue;
        const ok = lift ? L1.has(nk) && !L2.has(nk) : !L1.has(nk);
        if (!ok || ramps.some((r) => r.k === nk)) continue;
        const rx = off + (i + di) * TILE,
          rz = off + (j + dj) * TILE;
        if (!lift && (w.onCorridor(rx, rz, TILE * 0.5) || Math.hypot(rx, rz) < TILE)) continue;
        if (!toSet.has(k)) continue;
        // 坡道佔鄰格靠近平台那一半的長條（寬 8、長＝一格）
        const side = [di, dj];
        const rw = di ? TILE : 8,
          rd = di ? 8 : TILE;
        ramps.push({ k: nk, x: rx, z: rz, w: rw, d: rd, side, y0, y1, len: TILE, lift });
        break;
      }
    }
  };
  tryRamp(L1, L1, null, Y1, false, Math.max(3, w.cnt(2, 3)));
  tryRamp(L2, L2, Y1, Y2, true, Math.max(2, w.cnt(1, 2)));
  w.ramps = w.ramps || [];
  for (const r of ramps) {
    const y0 = r.y0 === null ? w.terrainHeight(r.x, r.z) - 0.4 : r.y0;
    const rg = buildGridRamp(r.side[0] ? r.len : 8, r.side[0] ? 8 : r.len);
    const a = Math.atan2(r.y1 - y0, r.len);
    rg.position.set(r.x, (y0 + r.y1) / 2 - 0.25, r.z);
    rg.rotation.z = r.side[0] ? -r.side[0] * a : 0;
    rg.rotation.x = r.side[1] ? r.side[1] * a : 0;
    w.scene.add(rg);
    w.meshes.push(rg);
    w.ramps.push({ x: r.x, z: r.z, w: r.w, d: r.d, side: r.side, y0, y1: r.y1, len: r.len, lift: r.lift });
    if (!r.lift) w.reserve(r.x - r.w / 2, r.x + r.w / 2, r.z - r.d / 2, r.z + r.d / 2);
  }
}
function buildGridRamp(rw, rd) {
  const g = new THREE.Group();
  g.add(box(rw, 0.5, rd, mat(0x4a4642, { roughness: 0.6, metalness: 0.6 })));
  const along = rw >= rd;
  for (const s of [-1, 1])
    g.add(
      along
        ? box(rw, 1, 0.2, mat(0xd8a020), 0, 0.6, s * (rd / 2 - 0.1))
        : box(0.2, 1, rd, mat(0xd8a020), s * (rw / 2 - 0.1), 0.6, 0),
    );
  return g;
}

function buildProps(w) {
  const G = w.grid086;
  w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
    const color = pick([0x6a6a5a, 0x5a4a3e, 0x4a5a62]);
    const g = buildShack(color);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(
      g,
      x,
      y - 0.1,
      z,
      { w: rot ? SHACK[2] : SHACK[0], h: SHACK[1], d: rot ? SHACK[0] : SHACK[2] },
      'shack',
      1600,
      color,
    );
  });
  w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
    const s = rnd(0.8, 1.3);
    w.addSmall(buildScrapHeap(s), x, y - 0.3, z, { r: 2.2 * s, h: 2.6 * s }, 'scrapheap', 2600, 0x5a4a3e);
  });
  w.scatter(w.cnt(6, 10), 5, (x, z, y) => {
    w.addSmall(buildBarrels(), x, y, z, { r: 1.2, h: 1.3 }, 'barrels', 500, 0x8a3a2a);
  });
  w.scatter(w.cnt(5, 8), 6, (x, z, y) => {
    const h = rnd(7, 9.5);
    const g = buildPipeStack(h);
    if (RNG() < 0.5) g.rotation.y = Math.PI / 2;
    w.addSmall(g, x, y - 0.2, z, { r: 1.5, h }, 'pipestack', 1800, 0x8a7a5a);
  });
  // 煙囪：只放在沒有平台的格子（會穿過平台高度）
  w.scatter(
    w.cnt(3, 5),
    12,
    (x, z, y) => {
      if (G.covered(x, z)) return;
      const r = rnd(1.3, 2),
        h = rnd(26, 36);
      w.addSmall(buildChimney(r, h), x, y - 0.3, z, { r, h }, null, 0, 0);
    },
    false,
  );
  // 第一層平台上也放一些掩體
  for (const k of G.L1) {
    if (G.L2.has(k) || RNG() > 0.4) continue;
    const [i, j] = k.split(',').map(Number);
    const cx = G.off + i * TILE + rnd(-6, 6),
      cz = G.off + j * TILE + rnd(-6, 6);
    if ((w.ramps || []).some((r) => Math.abs(r.x - cx) < r.w / 2 + 3 && Math.abs(r.z - cz) < r.d / 2 + 3))
      continue;
    if (RNG() < 0.5) {
      const color = pick([0x6a6a5a, 0x5a4a3e]);
      w.addSmall(
        buildShack(color),
        cx,
        Y1,
        cz,
        { w: SHACK[0], h: SHACK[1], d: SHACK[2] },
        'shack',
        1600,
        color,
      );
    } else w.addSmall(buildBarrels(), cx, Y1, cz, { r: 1.2, h: 1.3 }, 'barrels', 500, 0x8a3a2a);
  }
}

export const GRID086 = {
  name: '巨型構造體 Grid 086',
  ground: 0x3d3a37,
  slope: 0x2e2c2a,
  rock: 0x2a2826,
  fog: 0x5a524a,
  sky: 0x6a5e52,
  sun: 0xffc890,
  amb: 0x4a4038,
  container: 0x5a524a,
  container2: 0xb04a2a,
  hasRocks: false,
  weather: 'ash',
  props: 'grid086',
  sunI: 0.8,
  fogFar: 180,
  featureKinds: [],
  corridor: { p: 0.6, kinds: ['rail', 'road'] },
  planTerrain,
  buildStructures,
  buildProps,
  propNames: { shack: 'Doser 棚屋', scrapheap: '廢料堆', barrels: '油桶', pipestack: '管線束' },
  catalog: [
    ['doser_shack', 'Doser 棚屋', 'Grid 086 的掩體；5 × 3.6 × 4 m，可破壞', () => buildShack(0x6a6a5a)],
    ['scrap_heap', '廢料堆', 'Grid 086；半徑約 2.5 m，可破壞；GLB 依尺寸縮放', () => buildScrapHeap(1)],
    ['barrels', '油桶群', 'Grid 086；3 個一組，可破壞', () => buildBarrels()],
    ['chimney', '排氣煙囪', 'Grid 086；高 26–36 m，不可破壞；GLB 依尺寸縮放', () => buildChimney(1.5, 30)],
    ['pipe_stack', '管線束', 'Grid 086；高 7–9.5 m，可破壞；GLB 依高度縮放', () => buildPipeStack(9)],
  ],
};
