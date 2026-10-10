// 主題：舊宇宙港（AC6 中央冰原的伯特蘭舊宇宙港／燃料基地）——平坦的停機坪、發射塔與火箭、
// 可以走進去的機庫、管制塔、球形燃料槽
import { RNG, clamp, pick, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle } from './kit.js';

// ---------- 物件 ----------
// 發射塔＋火箭：塔在 −X、火箭在原點；原點在地面中心。TOWER＝塔的碰撞箱（中心 x、寬、高），ROCKET＝火箭（半徑、高）
export const TOWER = { x: -7, w: 6, h: 46 };
export const ROCKET = { r: 3.2, h: 36 };
export function buildLaunchTower() {
  const glb = propGlb('launch_tower', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const steel = fadeMat(0xb04a2a, { roughness: 0.6, metalness: 0.5 }),
    white = fadeMat(0xe6e8ea, { roughness: 0.5, metalness: 0.2 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 }),
    pad = fadeMat(0x8a8c8e, { roughness: 0.95 });
  g.add(box(24, 0.4, 24, pad, 0, 0.2, 0));
  // 格子塔
  const T = TOWER,
    a = T.w / 2 - 0.2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) g.add(box(0.4, T.h, 0.4, steel, T.x + sx * a, T.h / 2, sz * a));
  for (let y = 3; y < T.h; y += 3.5) {
    for (const s of [-1, 1]) {
      g.add(box(T.w, 0.25, 0.25, steel, T.x, y, s * a));
      g.add(box(0.25, 0.25, T.w, steel, T.x + s * a, y, 0));
    }
    if (Math.round(y) % 7 === 3) g.add(box(T.w - 0.4, 0.2, T.w - 0.4, dk, T.x, y, 0));
  }
  // 連接臂
  for (const y of [12, 24, 32]) g.add(box(4, 0.6, 1.6, steel, T.x + 3.6, y, 0));
  // 火箭
  const R = ROCKET;
  g.add(cyl(R.r, R.r, R.h * 0.8, white, 0, R.h * 0.4 + 1, 0, 16));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(R.r, R.h * 0.2, 16), white);
  nose.position.y = R.h * 0.9 + 1;
  nose.castShadow = true;
  g.add(nose);
  g.add(cyl(R.r + 0.05, R.r + 0.05, 1.2, dk, 0, R.h * 0.55, 0, 16));
  for (let k = 0; k < 4; k++) {
    const fin = box(
      0.3,
      4,
      2.4,
      dk,
      Math.cos((k * Math.PI) / 2) * (R.r + 1),
      3,
      Math.sin((k * Math.PI) / 2) * (R.r + 1),
    );
    fin.rotation.y = (-k * Math.PI) / 2;
    g.add(fin);
  }
  return g;
}
// 機庫：寬 HANGAR.w（X）× 深 HANGAR.d（Z）× 高 HANGAR.h，開口朝 −Z；原點在地面中心
export const HANGAR = { w: 26, d: 22, h: 12, wall: 1 };
export function buildHangar(color) {
  const glb = propGlb('hangar', { color, fade: true });
  if (glb) return glb;
  const H = HANGAR;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 }),
    lamp = fadeMat(0xfff4d8, { emissive: 0x806a40, roughness: 0.4 });
  g.add(box(H.w, H.h, H.wall, m, 0, H.h / 2, H.d / 2 - H.wall / 2));
  for (const s of [-1, 1]) {
    g.add(box(H.wall, H.h, H.d, m, s * (H.w / 2 - H.wall / 2), H.h / 2, 0));
    for (let z = -H.d / 2 + 2; z < H.d / 2; z += 4)
      g.add(box(0.3, H.h, 0.4, dk, s * (H.w / 2 + 0.1), H.h / 2, z));
  }
  g.add(box(H.w + 0.6, 1, H.d + 0.6, m, 0, H.h - 0.5, 0)); // 屋頂
  g.add(box(H.w + 0.8, 1.6, 0.8, dk, 0, H.h - 1.2, -H.d / 2)); // 門楣
  for (let x = -H.w / 2 + 4; x < H.w / 2 - 2; x += 6) g.add(box(2.4, 0.2, 0.8, lamp, x, H.h - 1.2, 0));
  g.add(box(H.w - 2, 0.05, 0.4, fadeMat(0xd8a020), 0, 0.03, -H.d / 2 + 1));
  return g;
}
// 管制塔：圓柱塔身＋頂部玻璃艙；原點在地面中心；CTRL_TOWER＝塔身半徑、高
export const CTRL_TOWER = { r: 3, h: 26 };
export function buildControlTower() {
  const glb = propGlb('control_tower', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xc8ccd0, { roughness: 0.7 }),
    glass = fadeMat(0x24384a, { roughness: 0.15, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 });
  const T = CTRL_TOWER;
  g.add(cyl(T.r, T.r * 1.2, T.h, m, 0, T.h / 2, 0, 12));
  g.add(cyl(T.r * 1.9, T.r * 1.5, 3.2, glass, 0, T.h + 1.6, 0, 12));
  g.add(cyl(T.r * 2, T.r * 2, 0.6, dk, 0, T.h + 3.4, 0, 12));
  g.add(cyl(0.15, 0.15, 5, dk, 0, T.h + 6, 0, 6));
  return g;
}
// 球形燃料槽（四腳）：半徑 r，原點在地面中心
export function buildFuelSphere(r) {
  const glb = propGlb('fuel_sphere', { ref: [8, 10, 8], size: [r * 2, r * 2.5, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xe6e8ea, { roughness: 0.4, metalness: 0.3 }),
    leg = fadeMat(0x8a5a3a, { roughness: 0.7, metalness: 0.5 });
  const s = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10), m);
  s.position.y = r * 1.4;
  s.castShadow = s.receiveShadow = true;
  g.add(s);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    g.add(box(0.35, r * 1.4, 0.35, leg, Math.cos(a) * r * 0.85, r * 0.7, Math.sin(a) * r * 0.85));
  }
  g.add(cyl(r * 1.02, r * 1.02, 0.3, fadeMat(0xb04a2a), 0, r * 1.4, 0, 16));
  return g;
}
// 燃料車：2.6 × 3 × 8（長沿 Z），原點在底面中心
export const FUEL_TRUCK = [2.6, 3, 8];
export function buildFuelTruck() {
  const glb = propGlb('fuel_truck', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xd8d8d0, { roughness: 0.5, metalness: 0.4 }),
    cab = fadeMat(0xb04a2a, { roughness: 0.6 }),
    dk = fadeMat(0x22262a, { roughness: 0.9 });
  const tank = cyl(1.25, 1.25, 5.6, m, 0, 1.9, 0.9, 12);
  tank.rotation.x = Math.PI / 2;
  g.add(tank);
  g.add(box(2.5, 2.2, 2, cab, 0, 1.6, -3));
  for (const sx of [-1.1, 1.1])
    for (const sz of [-3, 0.5, 2.6]) {
      const wh = cyl(0.5, 0.5, 0.4, dk, sx, 0.5, sz, 8);
      wh.rotation.z = Math.PI / 2;
      g.add(wh);
    }
  return g;
}
// 防爆牆：8 × 4 × 1（沿 X），原點在底面中心
export const BLAST_WALL = [8, 4, 1.2];
export function buildBlastWall() {
  const glb = propGlb('blast_wall', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x9a9c9e, { roughness: 0.95 }),
    yel = fadeMat(0xd8a020, { roughness: 0.6 }),
    blk = fadeMat(0x22262a, { roughness: 0.6 });
  g.add(box(8, 4, 1.2, m, 0, 2, 0));
  for (let i = 0; i < 8; i++) {
    const s = box(1, 0.6, 0.05, i % 2 ? yel : blk, -3.5 + i, 0.6, 0.62);
    g.add(s);
  }
  return g;
}
// 貨物艙（橫放的膠囊）：2.6 × 2.6 × 6（長沿 Z），原點在底面中心
export const CARGO_POD = [2.8, 2.7, 6];
export function buildCargoPod(color) {
  const glb = propGlb('cargo_pod', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.5, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 });
  const body = cyl(1.3, 1.3, 4.4, m, 0, 1.35, 0, 12);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(1.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), m);
    cap.rotation.x = (s * Math.PI) / 2;
    cap.position.set(0, 1.35, s * 2.2);
    g.add(cap);
  }
  g.add(box(2.8, 0.4, 3.6, dk, 0, 0.2, 0));
  return g;
}
// 天線桿：原點在底面中心，高 h
export function buildAntennaMast(h) {
  const glb = propGlb('antenna_mast', { ref: [2, 14, 2], size: [2, h, 2] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  g.add(cyl(0.18, 0.3, h, m, 0, h / 2, 0, 6));
  for (const y of [h * 0.6, h * 0.8]) g.add(box(2, 0.12, 0.12, m, 0, y, 0));
  g.add(box(0.5, 0.5, 0.5, mat(0xff4030, { emissive: 0xa01810 }), 0, h + 0.2, 0));
  return g;
}

// ---------- 地形特徵的外觀（鋼構步道、H 型鋼、防爆牆、發射台、鋼坡道、機庫式隧道口）----------
const C = {
  deck: 0x5a6068,
  trim: 0xd8a020,
  pillar: 0x7a8088,
  wall: 0x9a9c9e,
  plat: 0x8a8c8e,
  rock: 0x55585b,
};
registerFeatureStyle('spaceport', C, {
  deck(w, d, thick, rotY, C) {
    const g = new THREE.Group();
    const dm = fadeMat(C.deck, { roughness: 0.6, metalness: 0.6 }),
      rm = fadeMat(C.trim, { roughness: 0.6 });
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    const L = rotY ? d : w;
    for (const s of [-1, 1]) {
      g.add(
        rotY
          ? box(0.12, 0.12, L, rm, s * (w / 2 - 0.15), 1, 0)
          : box(L, 0.12, 0.12, rm, 0, 1, s * (d / 2 - 0.15)),
      );
      for (let q = -L / 2; q <= L / 2; q += 2)
        g.add(
          rotY
            ? box(0.1, 1, 0.1, rm, s * (w / 2 - 0.15), 0.5, q)
            : box(0.1, 1, 0.1, rm, q, 0.5, s * (d / 2 - 0.15)),
        );
    }
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    const m = mat(C.pillar, { roughness: 0.6, metalness: 0.6 });
    g.add(box(r * 1.8, h, 0.25, m));
    for (const s of [-1, 1]) g.add(box(0.25, h, r * 1.6, m, s * r * 0.9, 0, 0));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.wall, { roughness: 0.95 })));
    const along = w > d,
      L = along ? w : d;
    const yel = fadeMat(C.trim),
      blk = fadeMat(0x22262a);
    for (let i = 0; i < Math.floor(L); i++) {
      const at = -L / 2 + i + 0.5;
      g.add(
        along
          ? box(1, 0.6, d + 0.05, i % 2 ? yel : blk, at, -h / 2 + 0.6, 0)
          : box(w + 0.05, 0.6, 1, i % 2 ? yel : blk, 0, -h / 2 + 0.6, at),
      );
    }
    return g;
  },
  platform(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.plat, { roughness: 0.95 }), 0, h / 2, 0));
    g.add(box(w * 0.6, 0.05, d * 0.6, fadeMat(0x3a3c3e), 0, h + 0.03, 0)); // 焦痕
    for (const s of [-1, 1]) g.add(box(w, 0.4, 0.3, fadeMat(C.trim), 0, h - 0.2, s * (d / 2)));
    return g;
  },
  ramp(rw, rd, C) {
    const g = new THREE.Group();
    g.add(box(rw, 0.35, rd, mat(C.deck, { roughness: 0.6, metalness: 0.6 })));
    return g;
  },
  tunnel(C) {
    const g = new THREE.Group();
    const m = mat(0x8a8c8e, { roughness: 0.9 });
    g.add(box(24, 14, 10, mat(C.rock, { roughness: 1 }), 0, 5, -6));
    g.add(box(16, 10, 2.5, m, 0, 5, 0));
    g.add(box(10, 7.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.75, 0));
    g.add(box(10.6, 0.6, 2.9, mat(C.trim), 0, 7.8, 0));
    return g;
  },
});

// ---------- 地形：中央是平坦的停機坪，外圍漸漸起伏 ----------
function planTerrain(w) {
  const n = w.noise,
    n2 = w.noise2;
  const half = w.size / 2;
  return (x, z) => {
    const e = Math.max(Math.abs(x), Math.abs(z)) / half;
    // 地圖外（e＞1，遠景地形）慢慢回到平地，不圍成一圈高台
    const t = clamp((e - 0.62) / 0.2, 0, 1) * (1 - clamp((e - 1.1) / 0.35, 0, 1));
    return (n2(x * 0.1, z * 0.1) - 0.5) * 0.12 + t * t * (n(x * 0.03, z * 0.03) * 4 + 1);
  };
}
// 停機坪的標線（裝飾）：跑道邊線、中線、黃色滑行線
function markings(w) {
  const white = mat(0xe8e8e0, { roughness: 0.8 }),
    yel = mat(0xd8a020, { roughness: 0.8 });
  const L = w.size * 0.55;
  const zr = rnd(-20, 20) * w.k;
  const add = (m) => {
    w.scene.add(m);
    w.meshes.push(m);
  };
  for (const s of [-1, 1]) add(box(L, 0.04, 0.5, white, 0, 0.1, zr + s * 14));
  for (let x = -L / 2; x < L / 2; x += 10) add(box(5, 0.04, 0.6, white, x, 0.1, zr));
  const xt = rnd(-30, 30) * w.k;
  add(box(0.4, 0.04, L * 0.8, yel, xt, 0.1, 0));
}

function placeBig(w, g, spot, shapes) {
  g.position.y = spot.lo;
  w.addBig(
    g,
    spot,
    shapes.map((s) => (s.box ? { ...s, y: spot.lo + s.y, top: spot.lo + s.top } : s)),
  );
  w.reserve(spot.aabb[0], spot.aabb[1], spot.aabb[2], spot.aabb[3]);
}
function buildStructures(w) {
  markings(w);
  {
    const spot = w.findSpot([-12, 12, -12, 12], 1.5, 40);
    if (spot) {
      const T = TOWER;
      placeBig(w, buildLaunchTower(), spot, [
        { box: [T.x - T.w / 2, T.x + T.w / 2, -T.w / 2, T.w / 2], y: 0, top: T.h },
        { c: [0, 0], r: ROCKET.r + 0.3, h: ROCKET.h },
      ]);
    }
  }
  const H = HANGAR;
  for (let k = w.cnt(1, 2); k > 0; k--) {
    const spot = w.findSpot([-H.w / 2, H.w / 2, -H.d / 2 - 6, H.d / 2], 1.5, 40);
    if (!spot) continue;
    const color = pick([0x8a949e, 0x9a8a74, 0x7a8a7a]);
    const g = buildHangar(color);
    g.position.y = spot.lo;
    const wl = H.wall;
    w.addBig(g, spot, [
      { box: [-H.w / 2, H.w / 2, H.d / 2 - wl, H.d / 2], y: spot.lo, top: spot.lo + H.h },
      { box: [-H.w / 2, -H.w / 2 + wl, -H.d / 2, H.d / 2], y: spot.lo, top: spot.lo + H.h },
      { box: [H.w / 2 - wl, H.w / 2, -H.d / 2, H.d / 2], y: spot.lo, top: spot.lo + H.h },
      { box: [-H.w / 2, H.w / 2, -H.d / 2, H.d / 2], y: spot.lo + H.h - 1, top: spot.lo + H.h, deck: true },
    ]);
    w.reserve(spot.aabb[0], spot.aabb[1], spot.aabb[2], spot.aabb[3]);
  }
  {
    const r = CTRL_TOWER.r * 1.2;
    const spot = w.findSpot([-r, r, -r, r], 1.5, 40);
    if (spot) placeBig(w, buildControlTower(), spot, [{ c: [0, 0], r, h: CTRL_TOWER.h }]);
  }
}

function buildProps(w) {
  w.scatter(w.cnt(4, 6), 12, (x, z, y) => {
    const r = rnd(3.4, 4.6);
    w.addSmall(buildFuelSphere(r), x, y - 0.1, z, { r: r * 1.02, h: r * 2.4 }, 'fuelsphere', 3200, 0xe6e8ea);
  });
  w.scatter(w.cnt(3, 5), 8, (x, z, y) => {
    const g = buildFuelTruck();
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    const [a, h, b] = FUEL_TRUCK;
    w.addSmall(g, x, y, z, { w: rot ? b : a, h, d: rot ? a : b }, 'fueltruck', 1400, 0xd8d8d0);
  });
  w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
    const g = buildBlastWall();
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    const [a, h, b] = BLAST_WALL;
    w.addSmall(g, x, y - 0.1, z, { w: rot ? b : a, h, d: rot ? a : b }, 'blastwall', 2400, 0x9a9c9e);
  });
  w.scatter(w.cnt(5, 8), 7, (x, z, y) => {
    const color = pick([0xe6e8ea, 0xb04a2a, 0x4a6a8a]);
    const g = buildCargoPod(color);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    const [a, h, b] = CARGO_POD;
    w.addSmall(g, x, y, z, { w: rot ? b : a, h, d: rot ? a : b }, 'cargopod', 1800, color);
  });
  w.scatter(w.cnt(4, 6), 6, (x, z, y) => {
    const h = rnd(11, 15);
    w.addSmall(buildAntennaMast(h), x, y - 0.2, z, { r: 0.6, h }, 'mast', 900, 0xc8ccd0);
  });
  // 跑道燈（裝飾）
  w.addDecor(Math.round(24 * w.k * w.k), () => box(0.5, 0.25, 0.5, mat(0xffe0a0, { emissive: 0x805a20 })));
}

export const SPACEPORT = {
  name: '舊宇宙港',
  ground: 0x7c7f80,
  slope: 0x5f6366,
  rock: 0x55585b,
  fog: 0xb8bcbd,
  sky: 0xc2c8cc,
  sun: 0xfff4e0,
  amb: 0x939aa0,
  container: 0x8a8c8e,
  container2: 0xb04a2a,
  hasRocks: false,
  props: 'spaceport',
  fogFar: 210,
  featureKinds: ['bunkers', 'platforms', 'overpass'],
  corridor: { p: 0.7, kinds: ['road'] },
  planTerrain,
  buildStructures,
  buildProps,
  propNames: {
    fuelsphere: '燃料槽',
    fueltruck: '燃料車',
    blastwall: '防爆牆',
    cargopod: '貨物艙',
    mast: '天線桿',
  },
  catalog: [
    ['launch_tower', '發射塔與火箭', '舊宇宙港；塔高 46、火箭高 36 m，不可破壞', () => buildLaunchTower()],
    [
      'hangar',
      '機庫',
      '舊宇宙港；26 × 22 × 12 m，開口朝 −Z，可以走進去、屋頂可站；不可破壞',
      () => buildHangar(0x8a949e),
    ],
    ['control_tower', '管制塔', '舊宇宙港；高約 30 m，不可破壞', () => buildControlTower()],
    [
      'fuel_sphere',
      '球形燃料槽',
      '舊宇宙港；半徑 3.4–4.6 m，可破壞；GLB 依尺寸縮放',
      () => buildFuelSphere(4),
    ],
    ['fuel_truck', '燃料車', '舊宇宙港；2.6 × 3 × 8 m（長沿 Z），可破壞', () => buildFuelTruck()],
    ['blast_wall', '防爆牆', '舊宇宙港的掩體；8 × 4 × 1.2 m（沿 X），可破壞', () => buildBlastWall()],
    ['cargo_pod', '貨物艙', '舊宇宙港；2.8 × 2.7 × 6 m（長沿 Z），可破壞', () => buildCargoPod(0xe6e8ea)],
    ['antenna_mast', '天線桿', '舊宇宙港；高 11–15 m，可破壞；GLB 依高度縮放', () => buildAntennaMast(14)],
  ],
};
