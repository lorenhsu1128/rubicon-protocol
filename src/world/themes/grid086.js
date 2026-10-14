// 主題：Grid 086 巨型構造體（AC6 貝利烏斯西部的 Grid 086）——地面層之上有兩層鋼構平台（Y1、Y2），
// 平台之間留有空隙；坡道從地面接到第一層、從第一層接到第二層（懸空坡道 lift），也可以跳躍、懸浮上下
import { RNG, pick, rnd } from '../../core/math.js';
import {
  fadeMat,
  mat,
  propGlb,
  registerFeatureStyle,
  PK,
  DETAIL,
  HOLE,
  hazard,
  railing,
  ladder,
} from './kit.js';

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
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.4 }),
    rust = fadeMat(0x7a3f22, { roughness: 1 }),
    dk = fadeMat(0x22201e, { roughness: 1 });
  const k = new PK().bounds(-2.792, 0, -2.3, 2.792, 4.7, 2.3); // 外框同原本
  // 牆（拼接的鐵皮：板縫與補丁）＋斜屋頂（壓條）＋門＋遮雨板＋煙囪＋外掛的箱子與管線
  k.box(m, 5, 3, 4, 0, 1.5, 0);
  for (const x of [-1.6, 0.2, 1.7]) k.box(dk, 0.06, 2.9, 4.06, x, 1.5, 0);
  k.box(rust, 1.2, 1.1, 0.06, 1.6, 0.8, -2.02);
  k.at(0, 3.3, 0, 0, 0, 0.12, () => {
    k.box(rust, 5.6, 0.2, 4.6, 0, 0, 0);
    for (let x = -2.4; x <= 2.4; x += 0.8) k.box(rust, 0.08, 0.1, 4.6, x, 0.14, 0);
  });
  k.box(dk, 1.4, 2.2, 0.1, -1, 1.1, 2.01);
  k.box(DETAIL.steel, 0.1, 0.1, 0.1, -0.45, 1.1, 2.08);
  k.box(rust, 1.8, 1, 0.1, 1.2, 1.6, 2.02);
  k.box(rust, 2.0, 0.08, 0.5, 1.2, 2.2, 2.25, 0.3, 0, 0);
  k.cyl(dk, 0.2, 0.2, 1.4, 1.8, 4, -1.2, 0, 0, 0, 6);
  k.cyl(dk, 0.28, 0.28, 0.12, 1.8, 4.72, -1.2, 0, 0, 0, 6);
  k.cb(m, 0.3, 1.0, 0.8, 2.64, 1.6, -0.8, 0, 0, 0, 0.04);
  k.pipe(dk, [2.6, 2.1, -0.8], [2.6, 3.0, -0.8], 0.05);
  return k.build();
}
// 廢料堆：半徑約 2.5，原點在底面中心
export function buildScrapHeap(s) {
  const glb = propGlb('scrap_heap', { ref: [5, 2.6, 5], size: [5 * s, 2.6 * s, 5 * s], fade: true });
  if (glb) return glb;
  const cols = [0x5a4a3e, 0x7a3f22, 0x4a4e52, 0x6a5a3a];
  const ms = cols.map((c) => fadeMat(c, { roughness: 0.9, metalness: 0.4 }));
  const k = new PK();
  // 外框同原本（9 塊旋轉的方塊）
  for (let i = 0; i < 9; i++)
    k.ob(
      s * (0.8 + (i % 3) * 0.5),
      s * (0.4 + (i % 2) * 0.5),
      s * (0.7 + ((i * 5) % 3) * 0.4),
      (((i * 7) % 5) - 2) * s * 0.55,
      s * (0.3 + (i % 4) * 0.45),
      (((i * 3) % 5) - 2) * s * 0.5,
      i * 0.4,
      i * 1.1,
      i * 0.3,
    );
  for (let i = 0; i < 9; i++)
    k.box(
      ms[i % 4],
      s * (0.8 + (i % 3) * 0.5),
      s * (0.4 + (i % 2) * 0.5),
      s * (0.7 + ((i * 5) % 3) * 0.4),
      (((i * 7) % 5) - 2) * s * 0.55,
      s * (0.3 + (i % 4) * 0.45),
      (((i * 3) % 5) - 2) * s * 0.5,
      i * 0.4,
      i * 1.1,
      i * 0.3,
    );
  // 插在堆裡的鋼樑與管子
  k.box(ms[2], s * 3.2, s * 0.2, s * 0.3, 0, s * 1.2, 0, 0.2, 0.6, 0.35);
  k.cyl(ms[3], s * 0.18, s * 0.18, s * 2.4, s * 0.6, s * 1.0, -s * 0.5, 0.9, 0.3, 0, 6);
  return k.build();
}
// 油桶群（3 個）：原點在底面中心；桶箍與桶蓋
export function buildBarrels() {
  const glb = propGlb('barrels', { fade: true });
  if (glb) return glb;
  const cols = [0x8a3a2a, 0x3a5a7a, 0x6a6a2a];
  const k = new PK(); // 外框同原本的零件（三個油桶）
  for (let i = 0; i < 3; i++)
    k.obCyl(0.45, 0.45, 1.3, Math.cos(i * 2.1) * 0.6, 0.65, Math.sin(i * 2.1) * 0.6, 0, 0, 0, 10);
  for (let i = 0; i < 3; i++) {
    const m = fadeMat(cols[i], { roughness: 0.7, metalness: 0.4 });
    const x = Math.cos(i * 2.1) * 0.6,
      z = Math.sin(i * 2.1) * 0.6;
    k.cyl(m, 0.45, 0.45, 1.3, x, 0.65, z, 0, 0, 0, 10);
    for (const y of [0.4, 0.9]) k.cyl(m, 0.47, 0.47, 0.06, x, y, z, 0, 0, 0, 10);
    k.cyl(m, 0.4, 0.4, 0.03, x, 1.31, z, 0, 0, 0, 10);
    k.cyl(DETAIL.dark, 0.06, 0.06, 0.04, x + 0.22, 1.33, z, 0, 0, 0, 6);
  }
  return k.build();
}
// 排氣煙囪：半徑 r、高 h，原點在底面中心；GLB 以半徑 1.5、高 30 m 製作
export function buildChimney(r, h) {
  const glb = propGlb('chimney', { ref: [3, 30, 3], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const m = fadeMat(0x5a4e46, { roughness: 0.9, metalness: 0.3 }),
    band = fadeMat(0xb04a2a, { roughness: 0.7 });
  const k = new PK().bounds(-r, 0, -r, r, h, r); // 外框同原本（檢修平台與頂部的燈在外框外）
  // 煙囪＋警示色帶＋基座＋爬梯＋檢修平台＋頂部的航空障礙燈
  k.cyl(m, r * 0.8, r, h, 0, h / 2, 0, 0, 0, 0, 12);
  for (const y of [h * 0.3, h * 0.6, h - 1.5]) k.cyl(band, r * 0.9, r * 0.9, 0.8, 0, y, 0, 0, 0, 0, 12);
  k.cyl(m, r * 0.98, r, 1.2, 0, 0.6, 0, 0, 0, 0, 12);
  const rr = (y) => r - (r * 0.2 * y) / h;
  ladder(k, DETAIL.dark, h - 1.6, 0, 1.2, rr(h / 2) + 0.12, 0, 0.6);
  const py = h * 0.6 + 1.2;
  k.cyl(DETAIL.dark, rr(py) + 0.8, rr(py) + 0.8, 0.12, 0, py, 0, 0, 0, 0, 12);
  k.geo(DETAIL.dark, new THREE.TorusGeometry(rr(py) + 0.75, 0.04, 3, 16), 0, py + 0.9, 0, Math.PI / 2, 0, 0);
  k.cyl(m, r * 0.85, r * 0.82, 0.5, 0, h + 0.25, 0, 0, 0, 0, 12);
  k.box(DETAIL.red, 0.25, 0.25, 0.25, r * 0.6, h + 0.6, 0);
  return k.build();
}
// 垂直的管線束：原點在底面中心，高 h
export function buildPipeStack(h) {
  const glb = propGlb('pipe_stack', { ref: [3, 9, 1.4], size: [3, h, 1.4], fade: true });
  if (glb) return glb;
  const cols = [0x8a7a5a, 0x5a6a72, 0x7a5a3a];
  const k = new PK().bounds(-1.6, 0, -0.5, 1.6, h, 0.5); // 外框同原本
  const fm = fadeMat(0x3a3836);
  for (let i = 0; i < 4; i++) {
    const pm = fadeMat(cols[i % 3], { roughness: 0.6, metalness: 0.5 });
    const x = -1.1 + i * 0.75;
    k.cyl(pm, 0.32, 0.32, h, x, h / 2, 0, 0, 0, 0, 8);
    // 法蘭與閥門
    for (const y of [h * 0.25 + i * 0.4, h * 0.75 - i * 0.3]) k.cyl(pm, 0.4, 0.4, 0.16, x, y, 0, 0, 0, 0, 8);
    if (i % 2 === 0) k.cyl(DETAIL.red, 0.18, 0.18, 0.06, x, h * 0.4, 0.45, Math.PI / 2, 0, 0, 8);
  }
  for (const y of [1.5, h * 0.5, h - 1]) {
    k.box(fm, 3.2, 0.3, 1, 0, y, 0);
    for (let i = 0; i < 4; i++) k.box(fm, 0.08, 0.6, 0.75, -1.1 + i * 0.75 - 0.38, y, 0);
  }
  return k.build();
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
    const dm = fadeMat(C.deck, { roughness: 0.6, metalness: 0.6 }),
      tm = fadeMat(C.trim, { roughness: 0.6 }),
      rib = fadeMat(0x2e2a28, { roughness: 0.8, metalness: 0.4 });
    const k = new PK();
    // 外框同原本（板、底面的大梁、邊緣警示條）
    k.ob(w, thick, d, 0, -thick / 2, 0).ob(w, 0.06, d, 0, 0.03, 0);
    for (let x = -w / 2 + 3; x < w / 2; x += 6) k.ob(0.6, 1.2, d, x, -thick - 0.6, 0);
    k.cb(dm, w, thick, d, 0, -thick / 2, 0, 0, 0, 0, 0.1);
    // 底面的大梁（工字斷面）＋橫樑
    for (let x = -w / 2 + 3; x < w / 2; x += 6) {
      k.box(rib, 0.2, 1.2, d, x, -thick - 0.6, 0);
      k.box(rib, 0.7, 0.14, d, x, -thick - 1.13, 0);
    }
    for (let z = -d / 2 + 4; z < d / 2 - 1; z += 8) k.box(rib, w - 0.4, 0.6, 0.2, 0, -thick - 0.3, z);
    // 頂面：格柵板的接縫＋邊緣警示條紋（黑底黃紋）
    for (let x = -w / 2 + 4; x < w / 2 - 1; x += 4) k.box(rib, 0.08, 0.02, d - 1.2, x, 0.01, 0);
    for (const s of [-1, 1]) {
      k.at(0, 0.03, s * (d / 2 - 0.25), -Math.PI / 2, 0, 0, () =>
        hazard(k, tm, rib, w - 1, 0.5, 0, 0, 0, 0, 1.0),
      );
      k.at(s * (w / 2 - 0.25), 0.03, 0, -Math.PI / 2, 0, Math.PI / 2, () =>
        hazard(k, tm, rib, d - 1, 0.5, 0, 0, 0, 0, 1.0),
      );
    }
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().bounds(-r * 1.05, -h / 2, -r * 1.05, r * 1.05, h / 2, r * 1.05); // 外框同原本
    const m = mat(C.pillar, { roughness: 0.6, metalness: 0.6 }),
      dk = mat(0x3a3632, { metalness: 0.5 });
    // H 型鋼柱（翼板＋腹板）＋上下的柱腳／柱頭（鉚釘）＋加勁板
    const a = r * 0.8;
    for (const s of [-1, 1]) k.box(m, a * 2, h, 0.16, 0, 0, s * (a - 0.08));
    k.box(m, 0.18, h, a * 2, 0, 0, 0);
    for (const y of [-h / 2 + 0.4, h / 2 - 0.4]) {
      k.cb(dk, r * 2.1, 0.8, r * 2.1, 0, y, 0, 0, 0, 0, 0.06);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) k.box(DETAIL.steel, 0.1, 0.1, 0.1, sx * r * 0.85, y + 0.42, sz * r * 0.85);
    }
    for (let y = -h / 2 + 3; y < h / 2 - 2; y += 3)
      for (const s of [-1, 1]) k.box(m, 0.08, 0.1, a * 2, s * a * 0.5, y, 0);
    return k.build();
  },
  wall(w, h, d, C) {
    const k = new PK();
    const m = fadeMat(C.wall, { roughness: 0.8, metalness: 0.4 });
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L, h, T); // 外框同原本
      k.cb(m, L, h, T, 0, 0, 0, 0, 0, 0, 0.08);
      // 鋼板的加強肋與鉚釘列
      for (let x = -L / 2 + 1.5; x < L / 2 - 0.5; x += 1.5)
        for (const s of [-1, 1]) k.box(m, 0.14, h - 0.3, 0.1, x, 0, s * (T / 2 + 0.04));
      for (const s of [-1, 1]) k.box(DETAIL.dark, L, 0.25, 0.06, 0, h / 2 - 0.4, s * (T / 2 + 0.03));
    });
    return k.build();
  },
  platform(w, h, d, C) {
    const k = new PK().bounds(-w / 2, 0, -d / 2, w / 2, h, d / 2); // 外框同原本
    const m = fadeMat(C.plat, { roughness: 0.8, metalness: 0.4 });
    k.cb(m, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.12);
    // 側面的框架（柱＋橫樑）與頂緣的警示色
    for (const s of [-1, 1]) {
      for (let x = -w / 2 + 0.3; x <= w / 2 - 0.3 + 1e-6; x += (w - 0.6) / Math.max(1, Math.round(w / 4)))
        k.box(DETAIL.dark, 0.3, h, 0.1, x, h / 2, s * (d / 2 + 0.04));
      for (let z = -d / 2 + 0.3; z <= d / 2 - 0.3 + 1e-6; z += (d - 0.6) / Math.max(1, Math.round(d / 4)))
        k.box(DETAIL.dark, 0.1, h, 0.3, s * (w / 2 + 0.04), h / 2, z);
    }
    k.box(DETAIL.yellow, w + 0.1, 0.2, d + 0.1, 0, h - 0.1, 0);
    return k.build();
  },
  ramp(rw, rd, C) {
    return gridRamp(rw, rd, mat(C.deck, { roughness: 0.6, metalness: 0.6 }), mat(C.trim));
  },
  tunnel(C) {
    const k = new PK().bounds(-12, -2, -11, 12, 12, 1.4); // 外框同原本
    const wm = mat(C.wall, { metalness: 0.4 });
    k.cb(mat(C.rock, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
    k.cb(wm, 14, 10, 2.5, 0, 5, 0, 0, 0, 0, 0.12);
    k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
    for (const s of [-1, 1]) {
      k.box(DETAIL.dark, 0.6, 7.2, 2.7, s * 4.3, 3.6, 0);
      for (const x of [5.6, 6.8]) k.box(wm, 0.25, 9.6, 2.7, s * x, 4.8, 0);
    }
    k.box(DETAIL.dark, 9.2, 0.7, 2.7, 0, 7.2, 0);
    hazard(k, DETAIL.yellow, DETAIL.black, 8.6, 0.5, 0, 7.2, 1.37);
    return k.build();
  },
});
// 鋼坡道：格柵板＋止滑條＋兩側的黃色護欄（實心擋板＋扶手）
function gridRamp(rw, rd, pm, tm) {
  const along = rw >= rd;
  const L = along ? rw : rd,
    D = along ? rd : rw;
  const k = new PK();
  k.at(0, 0, 0, 0, along ? 0 : Math.PI / 2, 0, () => {
    // 外框同原本（板＋兩側的擋板）
    k.ob(L, 0.5, D);
    for (const s of [-1, 1]) k.ob(L, 1, 0.2, 0, 0.6, s * (D / 2 - 0.1));
    k.cb(pm, L, 0.5, D, 0, 0, 0, 0, 0, 0, 0.06);
    for (let x = -L / 2 + 0.5; x < L / 2; x += 1) k.box(DETAIL.dark, 0.1, 0.05, D - 0.6, x, 0.27, 0);
    for (const s of [-1, 1]) {
      k.box(tm, L, 0.5, 0.2, 0, 0.35, s * (D / 2 - 0.1));
      railing(k, tm, L - 0.2, 0.46, 0, 0.6, s * (D / 2 - 0.1), 0, 2.4, 0.08);
    }
  });
  return k.build();
}

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
  return gridRamp(rw, rd, mat(0x4a4642, { roughness: 0.6, metalness: 0.6 }), mat(0xd8a020));
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
