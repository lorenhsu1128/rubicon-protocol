// 主題：高空軌道（AC6 第 5 章的卡門線／封鎖衛星）——雲海之上的金屬平台以桁架橋相連，平台外是虛空
import { RNG, pick, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle } from './kit.js';
import { buildBridges, planIslands } from './xylem.js';

// ---------- 物件 ----------
// 太陽能板陣列：傾斜的板＋支柱，6 × 4 × 3（沿 X），原點在底面中心
export const SOLAR = [6.4, 4, 3];
export function buildSolarArray() {
  const glb = propGlb('solar_array', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const panel = fadeMat(0x1d3a6a, { roughness: 0.2, metalness: 0.6 }),
    frame = fadeMat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  for (const x of [-2.6, 0, 2.6]) g.add(box(0.3, 2.4, 0.3, frame, x, 1.2, 0));
  const p = box(6.4, 0.15, 3, panel, 0, 3, 0);
  p.rotation.x = -0.6;
  g.add(p);
  for (let i = -2; i <= 2; i++) {
    const l = box(0.06, 0.18, 3.02, frame, i * 1.3, 3, 0);
    l.rotation.x = -0.6;
    g.add(l);
  }
  return g;
}
// 散熱板：高而薄的鰭片列，1.2 × h × 6（沿 Z），原點在底面中心
export function buildRadiator(h) {
  const glb = propGlb('radiator', { ref: [1.2, 8, 6], size: [1.2, h, 6], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xe6e8ea, { roughness: 0.3, metalness: 0.5 }),
    dk = fadeMat(0x5a6068, { roughness: 0.6, metalness: 0.5 });
  g.add(box(1.2, 0.8, 6, dk, 0, 0.4, 0));
  for (let z = -2.5; z <= 2.5; z += 1) g.add(box(0.1, h - 0.8, 0.9, m, 0, (h + 0.8) / 2, z));
  return g;
}
// 對接艙（直立的圓筒）：半徑 2、高 5，原點在底面中心
export function buildDockModule(color) {
  const glb = propGlb('dock_module', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.4, metalness: 0.5 }),
    dk = fadeMat(0x3d4044, { roughness: 0.6 });
  g.add(cyl(2, 2, 4.4, m, 0, 2.2, 0, 14));
  g.add(cyl(1.4, 2, 0.8, dk, 0, 4.8, 0, 14));
  g.add(cyl(2.05, 2.05, 0.3, fadeMat(0xd8a020), 0, 3.2, 0, 14));
  return g;
}
// 推進器噴口（裝飾，掛在平台邊緣朝下）：原點在噴口頂
export function buildThruster() {
  const glb = propGlb('thruster');
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(0x5a6068, { roughness: 0.4, metalness: 0.7 });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.6, 4, 12, 1, true), m);
  cone.material.side = THREE.DoubleSide;
  cone.position.y = -2;
  g.add(cone);
  g.add(cyl(1.3, 1.3, 1.2, m, 0, 0.2, 0, 12));
  const glow = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 16),
    new THREE.MeshBasicMaterial({ color: 0x80c8ff }),
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = -3.9;
  g.add(glow);
  return g;
}
// 通信桅杆：格子桿＋碟形天線，原點在底面中心，高 h
export function buildCommMast(h) {
  const glb = propGlb('comm_mast', { ref: [3, 16, 3], size: [3, h, 3] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) g.add(box(0.12, h, 0.12, m, sx, h / 2, sz));
  for (let y = 1; y < h; y += 1.8) g.add(box(1.1, 0.08, 1.1, m, 0, y, 0));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 12, 4, 0, Math.PI * 2, 0, 0.9), m);
  dish.material.side = THREE.DoubleSide;
  dish.position.set(0, h - 1, 0.9);
  dish.rotation.x = -1.9;
  g.add(dish);
  return g;
}
// 星空（裝飾；跟著場景原點，不受霧影響）
function stars(w) {
  const n = 1500,
    pos = new Float32Array(n * 3);
  let s = w.seed >>> 0 || 1;
  const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2,
      y = 0.15 + r() * 0.85,
      q = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * q * 420;
    pos[i * 3 + 1] = y * 420;
    pos[i * 3 + 2] = Math.sin(a) * q * 420;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(
    g,
    new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, fog: false }),
  );
  p.frustumCulled = false;
  w.scene.add(p);
  w.meshes.push(p);
}

// ---------- 地形特徵的外觀（桁架橋、金屬柱）----------
const C = {
  deck: 0x7a828c,
  trim: 0xd8a020,
  pillar: 0x8a929c,
  wall: 0xb8c0c8,
  plat: 0x9aa2ab,
  rock: 0x5a6068,
};
registerFeatureStyle('orbit', C, {
  deck(w, d, thick, rotY, C) {
    const g = new THREE.Group();
    const dm = fadeMat(C.deck, { roughness: 0.4, metalness: 0.7 }),
      tm = fadeMat(0xc8ccd0, { roughness: 0.4, metalness: 0.6 });
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    const L = rotY ? d : w;
    const n = Math.max(2, Math.round(L / 3));
    for (const s of [-1, 1]) {
      g.add(
        rotY
          ? box(0.25, 0.25, L, tm, s * (w / 2 - 0.15), 1.6, 0)
          : box(L, 0.25, 0.25, tm, 0, 1.6, s * (d / 2 - 0.15)),
      );
      for (let i = 0; i <= n; i++) {
        const at = -L / 2 + (L / n) * i;
        g.add(
          rotY
            ? box(0.18, 1.6, 0.18, tm, s * (w / 2 - 0.15), 0.8, at)
            : box(0.18, 1.6, 0.18, tm, at, 0.8, s * (d / 2 - 0.15)),
        );
      }
    }
    // 底面的桁架
    for (let i = 0; i < n; i++) {
      const at = -L / 2 + (L / n) * (i + 0.5);
      const b = rotY
        ? box(w * 0.9, 0.2, 0.2, tm, 0, -thick - 1, at)
        : box(0.2, 0.2, d * 0.9, tm, at, -thick - 1, 0);
      g.add(b);
    }
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    g.add(cyl(r * 0.7, r, h, mat(C.pillar, { roughness: 0.4, metalness: 0.7 }), 0, 0, 0, 8));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.wall, { roughness: 0.4, metalness: 0.5 })));
    return g;
  },
  platform(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.plat, { roughness: 0.4, metalness: 0.6 }), 0, h / 2, 0));
    return g;
  },
  ramp(rw, rd, C) {
    const g = new THREE.Group();
    g.add(box(rw, 0.35, rd, mat(C.deck, { roughness: 0.4, metalness: 0.7 })));
    return g;
  },
  tunnel(C) {
    // 對接閘門
    const g = new THREE.Group();
    g.add(box(18, 12, 8, mat(C.wall, { roughness: 0.4, metalness: 0.5 }), 0, 5, -5));
    g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
    g.add(box(9, 0.4, 2.9, mat(C.trim), 0, 6.8, 0));
    return g;
  },
});

const H = 0.5;
function planTerrain(w) {
  return planIslands(w, { h: H, deep: -40, central: 40, n: [7, 10], size: [24, 40], span: 40, gap: 14 });
}
function buildStructures(w) {
  buildBridges(w, 8);
  stars(w);
  // 平台邊緣朝下的推進器
  for (const b of w.islands.blocks) {
    for (const [x, z] of [
      [b.x0 + 4, b.z0 + 4],
      [b.x1 - 4, b.z0 + 4],
      [b.x0 + 4, b.z1 - 4],
      [b.x1 - 4, b.z1 - 4],
    ]) {
      const t = buildThruster();
      t.position.set(x, H - 1.5, z);
      w.scene.add(t);
      w.meshes.push(t);
    }
    // 平台側面的厚板（從下方看是金屬平台）
    const sw = b.x1 - b.x0,
      sd = b.z1 - b.z0;
    const slab = box(
      sw,
      3,
      sd,
      mat(0x6d757e, { roughness: 0.5, metalness: 0.6 }),
      (b.x0 + b.x1) / 2,
      H - 2,
      (b.z0 + b.z1) / 2,
    );
    w.scene.add(slab);
    w.meshes.push(slab);
  }
}
function buildProps(w) {
  w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
    const g = buildSolarArray();
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(
      g,
      x,
      y,
      z,
      { w: rot ? SOLAR[2] : SOLAR[0], h: SOLAR[1], d: rot ? SOLAR[0] : SOLAR[2] },
      'solar',
      1400,
      0x1d3a6a,
    );
  });
  w.scatter(w.cnt(5, 8), 7, (x, z, y) => {
    const h = rnd(6, 9);
    const g = buildRadiator(h);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(g, x, y, z, { w: rot ? 6 : 1.2, h, d: rot ? 1.2 : 6 }, 'radiator', 1800, 0xe6e8ea);
  });
  w.scatter(w.cnt(4, 6), 8, (x, z, y) => {
    const color = pick([0xe6e8ea, 0xd8a020, 0x8a949e]);
    w.addSmall(buildDockModule(color), x, y, z, { r: 2.05, h: 5.2 }, 'dock', 2400, color);
  });
  w.scatter(w.cnt(3, 5), 7, (x, z, y) => {
    const h = rnd(12, 16);
    w.addSmall(buildCommMast(h), x, y, z, { r: 0.8, h }, 'commmast', 1000, 0xc8ccd0);
  });
}

export const ORBIT = {
  name: '高空軌道',
  ground: 0x9aa2ab,
  slope: 0x6d757e,
  rock: 0x5a6068,
  fog: 0x8aa4c8,
  sky: 0x2a4a7a,
  sun: 0xffffff,
  amb: 0x7088a8,
  container: 0xc8ccd0,
  container2: 0xd8a020,
  hasRocks: false,
  props: 'orbit',
  water: { level: -16, color: 0xeef2f8, opacity: 0.97, rough: 1, wide: true }, // 雲海
  void: { y: -4, fall: -7, ref: H },
  sunI: 1.15,
  fogNear: 90,
  fogFar: 280,
  featureKinds: [],
  noCorridor: true,
  bossBan: ['worm', 'rampart', 'train'],
  planTerrain,
  buildStructures,
  buildProps,
  propNames: { solar: '太陽能板', radiator: '散熱板', dock: '對接艙', commmast: '通信桅杆' },
  catalog: [
    ['solar_array', '太陽能板陣列', '高空軌道的掩體；6.4 × 4 × 3 m（沿 X），可破壞', () => buildSolarArray()],
    ['radiator', '散熱板', '高空軌道；高 6–9 m（沿 Z），可破壞；GLB 依高度縮放', () => buildRadiator(8)],
    ['dock_module', '對接艙', '高空軌道；半徑 2、高 5.2 m，可破壞', () => buildDockModule(0xe6e8ea)],
    ['thruster', '推進器噴口', '高空軌道的裝飾，掛在平台底下', () => buildThruster(), { origin: '噴口頂' }],
    ['comm_mast', '通信桅杆', '高空軌道；高 12–16 m，可破壞；GLB 依高度縮放', () => buildCommMast(15)],
  ],
};
