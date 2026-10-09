// 主題：地下技研都市（AC6 第 4 章的地下探查與技研都市）——封閉的大洞窟：岩頂（朝下的平面，俯視的鏡頭看得穿）、
// 昏暗的紅色光、研究設施廢墟、Coral 收容槽與結晶、頂天立地的岩柱
import { RNG, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle, windowMat } from './kit.js';

const ROOF = 38;
const CORAL = 0xff3a30;
const coralMat = (o = 1) => {
  const m = fadeMat(0xff6050, { emissive: CORAL, roughness: 0.3, metalness: 0.1 });
  m.emissiveIntensity = 1.4 * o;
  return m;
};

// ---------- 物件 ----------
// 研究棟：w × h × d，發光的紅窗；原點在底面中心
export function buildLab(w, h, d, seed) {
  const glb = propGlb('lab_building', { ref: [16, 14, 12], size: [w, h, d], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const wm = windowMat(
    { base: '#5a5250', win: '#1a1416', lit: 0.35, litColor: '#ff4a3a', broken: 0.05, seed },
    Math.max(w, d),
    h,
    0xff3020,
  );
  g.add(box(w, h, d, wm, 0, h / 2, 0));
  const trim = fadeMat(0x3a3434, { roughness: 0.8 });
  g.add(box(w + 0.4, 0.6, d + 0.4, trim, 0, h, 0));
  g.add(box(w + 0.1, 0.25, d + 0.1, coralMat(0.6), 0, h * 0.5, 0));
  g.add(box(w * 0.3, 2, d * 0.3, trim, w * 0.2, h + 1, 0));
  return g;
}
// Coral 收容槽：玻璃圓筒＋發光核心；原點在底面中心，半徑約 1.8
export function buildCoralTank() {
  const glb = propGlb('coral_tank', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const steel = fadeMat(0x4a4446, { roughness: 0.5, metalness: 0.6 }),
    glass = new THREE.MeshStandardMaterial({
      color: 0xffb0a8,
      roughness: 0.05,
      metalness: 0.2,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
  g.add(cyl(1.9, 2, 0.8, steel, 0, 0.4, 0, 14));
  g.add(cyl(1.9, 1.9, 0.6, steel, 0, 5.3, 0, 14));
  g.add(cyl(1.6, 1.6, 4.2, glass, 0, 2.9, 0, 14));
  g.add(cyl(0.7, 0.9, 3.8, coralMat(1), 0, 2.9, 0, 10));
  for (let k = 0; k < 4; k++)
    g.add(box(0.2, 4.4, 0.2, steel, Math.cos(k * 1.571) * 1.7, 2.9, Math.sin(k * 1.571) * 1.7));
  return g;
}
// Coral 結晶簇：數根發光的尖柱；原點在底面中心，s＝大小倍率
export function buildCoralCrystal(s) {
  const glb = propGlb('coral_crystal', { ref: [3, 4, 3], size: [3 * s, 4 * s, 3 * s], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = coralMat(1);
  for (let i = 0; i < 6; i++) {
    const h = s * (1.6 + (i % 3) * 1.1);
    const c = new THREE.Mesh(new THREE.ConeGeometry(s * (0.3 + (i % 2) * 0.15), h, 5), m);
    const a = i * 1.05;
    c.position.set(Math.cos(a) * s * 0.6, h / 2 - 0.1, Math.sin(a) * s * 0.6);
    c.rotation.set(Math.sin(a) * 0.35, 0, Math.cos(a) * 0.35);
    c.castShadow = true;
    g.add(c);
  }
  return g;
}
// 岩柱：從地面一路連到岩頂；原點在底面中心，半徑 r
export function buildCavePillar(r, h) {
  const glb = propGlb('cave_pillar', { ref: [8, 38, 8], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x2e2828, { roughness: 1 });
  g.add(cyl(r * 0.55, r, h * 0.55, m, 0, h * 0.275, 0, 7));
  g.add(cyl(r * 1.1, r * 0.55, h * 0.5, m, 0, h * 0.75, 0, 7));
  // 岩縫裡的 Coral
  const v = coralMat(0.7);
  for (let i = 0; i < 3; i++)
    g.add(
      box(
        0.25,
        h * 0.25,
        0.25,
        v,
        Math.cos(i * 2.1) * r * 0.62,
        h * (0.2 + i * 0.12),
        Math.sin(i * 2.1) * r * 0.62,
      ),
    );
  return g;
}
// 管線（橫躺的一束，矮掩體）：6 × 1.6 × 2（沿 X），原點在底面中心
export const PIPE_RUN = [6, 1.7, 2];
export function buildPipeRun() {
  const glb = propGlb('pipe_run', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const cols = [0x6a5a5a, 0x4a4446, 0x7a3a34];
  for (let i = 0; i < 3; i++) {
    const p = cyl(
      0.42,
      0.42,
      6,
      fadeMat(cols[i], { roughness: 0.5, metalness: 0.5 }),
      0,
      0.45 + (i === 1 ? 0.8 : 0),
      -0.6 + i * 0.6,
      10,
    );
    p.rotation.z = Math.PI / 2;
    g.add(p);
  }
  for (const x of [-2.4, 2.4]) g.add(box(0.4, 1.7, 2, fadeMat(0x2e2828), x, 0.85, 0));
  return g;
}
// 地上的 Coral 脈（裝飾，發光的細帶）
export function buildCoralVein(len) {
  const glb = propGlb('coral_vein', { ref: [6, 0.1, 0.4], size: [len, 0.1, 0.4] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = coralMat(0.8);
  for (let i = 0; i < 4; i++) {
    const b = box(
      len / 4 + 0.2,
      0.08,
      0.3,
      m,
      -len / 2 + (len / 4) * (i + 0.5),
      0.04,
      (i % 2 ? 0.3 : -0.2) * i * 0.4,
    );
    b.rotation.y = (i % 2 ? 1 : -1) * 0.25;
    g.add(b);
  }
  return g;
}

// ---------- 地形特徵的外觀（研究設施：灰白面板＋紅色指示燈）----------
const C = {
  deck: 0x5a5452,
  trim: 0xff3a30,
  pillar: 0x4a4446,
  wall: 0x6a6462,
  plat: 0x5a5452,
  rock: 0x241f1f,
};
const glowStrip = (w, d, x, y, z) => box(w, 0.12, d, coralMat(0.6), x, y, z);
registerFeatureStyle('institute', C, {
  deck(w, d, thick, rotY, C) {
    const g = new THREE.Group();
    g.add(box(w, thick, d, fadeMat(C.deck, { roughness: 0.7, metalness: 0.3 }), 0, -thick / 2, 0));
    for (const s of [-1, 1])
      g.add(
        rotY ? glowStrip(0.2, d, s * (w / 2 - 0.2), 0.06, 0) : glowStrip(w, 0.2, 0, 0.06, s * (d / 2 - 0.2)),
      );
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    g.add(box(r * 1.7, h, r * 1.7, mat(C.pillar, { roughness: 0.6, metalness: 0.4 })));
    g.add(glowStrip(r * 1.75, r * 1.75, 0, h / 2 - 0.6, 0));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.wall, { roughness: 0.7 })));
    g.add(glowStrip(w + 0.05, d + 0.05, 0, h / 2 - 0.5, 0));
    return g;
  },
  platform(w, h, d, C) {
    const g = new THREE.Group();
    g.add(box(w, h, d, fadeMat(C.plat, { roughness: 0.7 }), 0, h / 2, 0));
    g.add(glowStrip(w + 0.05, d + 0.05, 0, h - 0.3, 0));
    return g;
  },
  ramp(rw, rd, C) {
    const g = new THREE.Group();
    g.add(box(rw, 0.35, rd, mat(C.deck, { roughness: 0.7 })));
    return g;
  },
  tunnel(C) {
    const g = new THREE.Group();
    g.add(box(24, 14, 10, mat(C.rock, { roughness: 1 }), 0, 5, -6));
    g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
    g.add(box(9, 0.3, 2.9, coralMat(0.8), 0, 6.7, 0));
    for (const s of [-1, 1]) g.add(box(0.3, 6.5, 2.9, coralMat(0.8), s * 4.3, 3.25, 0));
    return g;
  },
});

// ---------- 地形：粗糙的洞窟地面，邊緣是洞壁 ----------
function planTerrain(w) {
  const n = w.noise,
    n2 = w.noise2;
  return (x, z) => n(x * 0.03, z * 0.03) * 2.2 + (n2(x * 0.12, z * 0.12) - 0.5) * 0.6;
}
function buildStructures(w) {
  // 岩柱：頂天立地（不可破壞）
  for (let k = w.cnt(4, 6); k > 0; k--) {
    const r = rnd(3.5, 5.5);
    const spot = w.findSpot([-r, r, -r, r], 3, 30);
    if (!spot) continue;
    const g = buildCavePillar(r, ROOF + 4 - spot.lo);
    g.position.y = spot.lo - 0.5;
    w.addBig(g, spot, [{ c: [0, 0], r: r * 0.9, h: ROOF }], false);
    w.reserve(spot.aabb[0], spot.aabb[1], spot.aabb[2], spot.aabb[3]);
  }
  // 研究棟
  for (let k = w.cnt(4, 6); k > 0; k--) {
    const bw = rnd(10, 18),
      bd = rnd(9, 14),
      h = rnd(8, 16);
    const spot = w.findSpot([-bw / 2, bw / 2, -bd / 2, bd / 2], 2.5, 30);
    if (!spot) continue;
    const g = buildLab(bw, h, bd, Math.floor(RNG() * 1e6));
    g.position.y = spot.lo - 0.3;
    w.addBig(g, spot, [
      { box: [-bw / 2, bw / 2, -bd / 2, bd / 2], y: spot.lo - 0.3, top: spot.lo - 0.3 + h },
    ]);
  }
}
function buildProps(w) {
  w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
    w.addSmall(buildCoralTank(), x, y - 0.1, z, { r: 2, h: 5.6 }, 'coraltank', 2000, 0xff3a30);
  });
  w.scatter(
    w.cnt(8, 12),
    7,
    (x, z, y) => {
      const s = rnd(0.8, 1.5);
      const g = buildCoralCrystal(s);
      g.rotation.y = rnd(0, 6.28);
      w.addSmall(g, x, y - 0.2, z, { r: 1.4 * s, h: 4 * s }, 'crystal', 1500, 0xff3a30);
    },
    false,
  );
  w.scatter(w.cnt(6, 9), 7, (x, z, y) => {
    const g = buildPipeRun();
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    const [a, h, b] = PIPE_RUN;
    w.addSmall(g, x, y - 0.1, z, { w: rot ? b : a, h, d: rot ? a : b }, 'piperun', 1800, 0x6a5a5a);
  });
  w.addDecor(Math.round(30 * w.k * w.k), () => buildCoralVein(rnd(4, 8)), 0);
}

export const INSTITUTE = {
  name: '地下技研都市',
  ground: 0x3a3434,
  slope: 0x2c2828,
  rock: 0x241f1f,
  fog: 0x2a1416,
  sky: 0x1a0e10,
  sun: 0xff9070,
  amb: 0x40202a,
  container: 0x5a5452,
  container2: 0x7a3a34,
  hasRocks: false,
  weather: 'coral',
  props: 'institute',
  roof: { y: ROOF, color: 0x2a2222, bump: 10 },
  sunI: 0.4,
  hemiI: 0.75,
  fogNear: 30,
  fogFar: 150,
  featureKinds: ['bunkers', 'platforms', 'trench'],
  corridor: { p: 0.5, kinds: ['rail'] },
  planTerrain,
  buildStructures,
  buildProps,
  propNames: { coraltank: 'Coral 收容槽', crystal: 'Coral 結晶', piperun: '管線' },
  catalog: [
    [
      'lab_building',
      '研究棟',
      '地下技研都市；寬 10–18、高 8–16 m，紅色發光窗，可站上屋頂、不可破壞；GLB 依尺寸縮放',
      () => buildLab(16, 14, 12, 5),
    ],
    ['coral_tank', 'Coral 收容槽', '地下技研都市；半徑約 2、高 5.6 m，可破壞', () => buildCoralTank()],
    ['coral_crystal', 'Coral 結晶簇', '地下技研都市；可破壞；GLB 依尺寸縮放', () => buildCoralCrystal(1)],
    [
      'cave_pillar',
      '岩柱',
      '地下技研都市；地面連到岩頂，半徑 3.5–5.5 m，不可破壞；GLB 依尺寸縮放',
      () => buildCavePillar(4, 38),
    ],
    ['pipe_run', '管線', '地下技研都市的矮掩體；6 × 1.7 × 2 m（沿 X），可破壞', () => buildPipeRun()],
    ['coral_vein', 'Coral 脈', '地下技研都市的裝飾，地上發光的細帶；GLB 依長度縮放', () => buildCoralVein(6)],
  ],
};
