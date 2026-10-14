// 主題：地下技研都市（AC6 第 4 章的地下探查與技研都市）——封閉的大洞窟：岩頂（朝下的平面，俯視的鏡頭看得穿）、
// 昏暗的紅色光、研究設施廢墟、Coral 收容槽與結晶、頂天立地的岩柱
import { RNG, rnd } from '../../core/math.js';
import { fadeMat, mat, propGlb, registerFeatureStyle, windowMat, PK, DETAIL, HOLE, ladder } from './kit.js';

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
  const wm = windowMat(
    { base: '#5a5250', win: '#1a1416', lit: 0.35, litColor: '#ff4a3a', broken: 0.05, seed },
    Math.max(w, d),
    h,
    0xff3020,
  );
  const trim = fadeMat(0x3a3434, { roughness: 0.8 });
  const k = new PK().bounds(-w / 2 - 0.2, 0, -d / 2 - 0.2, w / 2 + 0.2, h + 2, d / 2 + 0.2); // 外框同原本
  k.box(wm, w, h, d, 0, h / 2, 0);
  // 基座＋屋頂女兒牆＋發光帶＋四角的柱＋屋頂機房與排氣扇＋入口的門楣與門＋外牆的管線
  k.box(trim, w + 0.3, 0.8, d + 0.3, 0, 0.4, 0);
  k.box(trim, w + 0.4, 0.6, d + 0.4, 0, h, 0);
  k.box(coralMat(0.6), w + 0.1, 0.25, d + 0.1, 0, h * 0.5, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(trim, 0.6, h, 0.6, sx * (w / 2 - 0.15), h / 2, sz * (d / 2 - 0.15));
  k.box(trim, w * 0.3, 2, d * 0.3, w * 0.2, h + 1, 0);
  for (const x of [-w * 0.15, -w * 0.32]) {
    k.cyl(trim, 0.8, 0.8, 0.5, x, h + 0.55, -d * 0.2, 0, 0, 0, 10);
    k.box(DETAIL.dark, 1.2, 0.05, 0.12, x, h + 0.82, -d * 0.2, 0, x, 0);
  }
  k.box(trim, 3.4, 0.25, 0.2, 0, 3.4, d / 2 + 0.1);
  k.box(DETAIL.dark, 2.4, 3, 0.1, 0, 1.5, d / 2 + 0.03);
  k.box(coralMat(0.6), 2.6, 0.1, 0.12, 0, 3.15, d / 2 + 0.06);
  for (const x of [-w / 2 + 1.2, w / 2 - 1.2])
    k.cyl(trim, 0.09, 0.09, h - 0.8, x, h / 2, d / 2 + 0.1, 0, 0, 0, 6);
  return k.build();
}
// Coral 收容槽：玻璃圓筒＋發光核心；原點在底面中心，半徑約 1.8
export function buildCoralTank() {
  const glb = propGlb('coral_tank', { fade: true });
  if (glb) return glb;
  const steel = fadeMat(0x4a4446, { roughness: 0.5, metalness: 0.6 }),
    glass = new THREE.MeshStandardMaterial({
      color: 0xffb0a8,
      roughness: 0.05,
      metalness: 0.2,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
  const k = new PK().obCyl(1.9, 2, 0.8, 0, 0.4, 0, 0, 0, 0, 14).obCyl(1.9, 1.9, 0.6, 0, 5.3, 0, 0, 0, 0, 14); // 外框同原本的零件
  for (let i = 0; i < 4; i++) k.ob(0.2, 4.4, 0.2, Math.cos(i * 1.571) * 1.7, 2.9, Math.sin(i * 1.571) * 1.7);
  // 底座（兩段＋檢修面板）＋頂蓋（管線接頭）＋玻璃筒＋發光核心＋四支支柱（中段的固定環）
  k.cyl(steel, 1.9, 2, 0.8, 0, 0.4, 0, 0, 0, 0, 14);
  k.cyl(steel, 1.75, 1.85, 0.25, 0, 0.92, 0, 0, 0, 0, 14);
  k.box(DETAIL.dark, 1.0, 0.45, 0.1, 0, 0.4, 1.96);
  k.cyl(steel, 1.9, 1.9, 0.6, 0, 5.3, 0, 0, 0, 0, 14);
  k.cyl(steel, 1.3, 1.6, 0.25, 0, 5.72, 0, 0, 0, 0, 14);
  for (const a of [0.4, 2.5, 4.4])
    k.cyl(DETAIL.dark, 0.18, 0.18, 0.4, Math.cos(a) * 0.8, 5.95, Math.sin(a) * 0.8, 0, 0, 0, 6);
  k.cyl(glass, 1.6, 1.6, 4.2, 0, 2.9, 0, 0, 0, 0, 14);
  k.cyl(coralMat(1), 0.7, 0.9, 3.8, 0, 2.9, 0, 0, 0, 0, 10);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.571 + 0.785;
    k.box(steel, 0.2, 4.4, 0.2, Math.cos(a) * 1.7, 2.9, Math.sin(a) * 1.7, 0, -a, 0);
    k.box(steel, 0.32, 0.25, 0.32, Math.cos(a) * 1.7, 2.9, Math.sin(a) * 1.7, 0, -a, 0);
  }
  return k.build();
}
// Coral 結晶簇：數根發光的尖柱；原點在底面中心，s＝大小倍率
export function buildCoralCrystal(s) {
  const glb = propGlb('coral_crystal', { ref: [3, 4, 3], size: [3 * s, 4 * s, 3 * s], fade: true });
  if (glb) return glb;
  const m = coralMat(1);
  const k = new PK();
  for (let i = 0; i < 6; i++) {
    const h = s * (1.6 + (i % 3) * 1.1);
    const a = i * 1.05;
    const g = new THREE.ConeGeometry(s * (0.3 + (i % 2) * 0.15), h, 5);
    const t = [
      Math.cos(a) * s * 0.6,
      h / 2 - 0.1,
      Math.sin(a) * s * 0.6,
      Math.sin(a) * 0.35,
      0,
      Math.cos(a) * 0.35,
    ];
    k.obMesh(g, ...t); // 外框同原本（每根尖柱各自的外框；呼叫端會任意旋轉）
    k.inPart(i, () => k.geo(m, g, ...t));
  }
  return k.build();
}
// 岩柱：從地面一路連到岩頂；原點在底面中心，半徑 r
export function buildCavePillar(r, h) {
  const glb = propGlb('cave_pillar', { ref: [8, 38, 8], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const m = fadeMat(0x2e2828, { roughness: 1 });
  const k = new PK();
  k.cyl(m, r * 0.55, r, h * 0.55, 0, h * 0.275, 0, 0, 0, 0, 7);
  k.cyl(m, r * 1.1, r * 0.55, h * 0.5, 0, h * 0.75, 0, 0, 0, 0, 7);
  // 岩縫裡的 Coral
  const v = coralMat(0.7);
  for (let i = 0; i < 3; i++)
    k.box(
      v,
      0.25,
      h * 0.25,
      0.25,
      Math.cos(i * 2.1) * r * 0.62,
      h * (0.2 + i * 0.12),
      Math.sin(i * 2.1) * r * 0.62,
    );
  return k.build();
}
// 管線（橫躺的一束，矮掩體）：6 × 1.6 × 2（沿 X），原點在底面中心
export const PIPE_RUN = [6, 1.7, 2];
export function buildPipeRun() {
  const glb = propGlb('pipe_run', { fade: true });
  if (glb) return glb;
  const cols = [0x6a5a5a, 0x4a4446, 0x7a3a34];
  const k = new PK().bounds(-3, 0, -1.02, 3, 1.7, 1.02); // 外框同原本
  const st = fadeMat(0x2e2828);
  for (let i = 0; i < 3; i++) {
    const m = fadeMat(cols[i], { roughness: 0.5, metalness: 0.5 });
    const y = 0.45 + (i === 1 ? 0.8 : 0),
      z = -0.6 + i * 0.6;
    k.cyl(m, 0.42, 0.42, 6, 0, y, z, 0, 0, Math.PI / 2, 10);
    // 法蘭與管箍
    for (const x of [-1.2, 1.2]) k.cyl(m, 0.5, 0.5, 0.18, x, y, z, 0, 0, Math.PI / 2, 10);
  }
  // 支架（門型＋底板＋管箍）、閥門與警示
  for (const x of [-2.4, 2.4]) {
    k.box(st, 0.4, 1.7, 2, x, 0.85, 0);
    k.box(st, 0.7, 0.08, 2.2, x, 0.04, 0);
  }
  k.cyl(DETAIL.red, 0.3, 0.3, 0.06, 0, 1.75, 0, 0, 0, 0, 8);
  k.cyl(st, 0.06, 0.06, 0.4, 0, 1.55, 0, 0, 0, 0, 4);
  k.box(coralMat(0.6), 0.08, 0.08, 1.9, 2.62, 1.5, 0);
  return k.build();
}
// 地上的 Coral 脈（裝飾，發光的細帶）
export function buildCoralVein(len) {
  const glb = propGlb('coral_vein', { ref: [6, 0.1, 0.4], size: [len, 0.1, 0.4] });
  if (glb) return glb;
  const m = coralMat(0.8);
  const k = new PK();
  for (let i = 0; i < 4; i++)
    k.box(
      m,
      len / 4 + 0.2,
      0.08,
      0.3,
      -len / 2 + (len / 4) * (i + 0.5),
      0.04,
      (i % 2 ? 0.3 : -0.2) * i * 0.4,
      0,
      (i % 2 ? 1 : -1) * 0.25,
      0,
    );
  return k.build();
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
registerFeatureStyle('institute', C, {
  deck(w, d, thick, rotY, C) {
    const L = rotY ? d : w,
      D = rotY ? w : d;
    const dm = fadeMat(C.deck, { roughness: 0.7, metalness: 0.3 }),
      glow = coralMat(0.6);
    const k = new PK();
    k.at(0, 0, 0, 0, rotY ? Math.PI / 2 : 0, 0, () => {
      k.ob(L, thick, D, 0, -thick / 2, 0); // 外框同原本（板＋發光帶）
      for (const s of [-1, 1]) k.ob(L, 0.12, 0.2, 0, 0.06, s * (D / 2 - 0.2));
      k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, Math.min(0.1, thick * 0.2));
      // 側面的面板（凹縫）、兩側的路緣＋發光帶
      for (const s of [-1, 1]) {
        k.box(glow, L, 0.12, 0.2, 0, 0.06, s * (D / 2 - 0.2));
        k.box(dm, L, 0.12, 0.15, 0, 0.06, s * (D / 2 - 0.075));
        for (let x = -L / 2 + 2; x < L / 2 - 0.5; x += 2)
          k.box(DETAIL.dark, 0.05, thick * 0.7, 0.03, x, -thick / 2, s * (D / 2 + 0.005));
      }
    });
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().bounds(-r * 0.875, -h / 2, -r * 0.875, r * 0.875, h / 2, r * 0.875); // 外框同原本
    const m = mat(C.pillar, { roughness: 0.6, metalness: 0.4 });
    k.cb(m, r * 1.7, h, r * 1.7, 0, 0, 0, 0, 0, 0, Math.min(0.15, r * 0.2));
    k.cb(m, r * 1.75, 0.6, r * 1.75, 0, -h / 2 + 0.3, 0, 0, 0, 0, 0.06);
    k.box(coralMat(0.6), r * 1.75, 0.12, r * 1.75, 0, h / 2 - 0.6, 0);
    for (const s of [-1, 1]) k.box(DETAIL.dark, 0.08, h - 1.6, 0.05, s * r * 0.4, 0, r * 0.86);
    return k.build();
  },
  wall(w, h, d, C) {
    const k = new PK();
    const m = fadeMat(C.wall, { roughness: 0.7 });
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L + 0.05, h, T + 0.05); // 外框同原本
      k.cb(m, L, h, T, 0, 0, 0, 0, 0, 0, 0.1);
      k.box(coralMat(0.6), L + 0.05, 0.12, T + 0.05, 0, h / 2 - 0.5, 0);
      // 面板接縫與警示標記
      for (let x = -L / 2 + 2; x < L / 2 - 0.5; x += 2)
        for (const s of [-1, 1]) k.box(DETAIL.dark, 0.05, h - 1.2, 0.03, x, -0.3, s * (T / 2 + 0.01));
      k.box(DETAIL.black, 0.8, 0.8, T + 0.04, -L / 2 + 1, -h / 2 + 1.4, 0);
    });
    return k.build();
  },
  platform(w, h, d, C) {
    const k = new PK().bounds(-w / 2 - 0.025, 0, -d / 2 - 0.025, w / 2 + 0.025, h, d / 2 + 0.025); // 外框同原本
    const m = fadeMat(C.plat, { roughness: 0.7 });
    k.cb(m, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.15);
    k.box(coralMat(0.6), w + 0.05, 0.12, d + 0.05, 0, h - 0.3, 0);
    for (let x = -w / 2 + 2.5; x < w / 2 - 1; x += 2.5)
      for (const s of [-1, 1]) k.box(DETAIL.dark, 0.06, h - 0.8, 0.03, x, (h - 0.8) / 2, s * (d / 2 + 0.01));
    return k.build();
  },
  ramp(rw, rd, C) {
    const along = rw >= rd;
    const L = along ? rw : rd,
      D = along ? rd : rw;
    const k = new PK().ob(rw, 0.35, rd); // 外框同原本
    k.at(0, 0, 0, 0, along ? 0 : Math.PI / 2, 0, () => {
      k.cb(mat(C.deck, { roughness: 0.7 }), L, 0.35, D, 0, 0, 0, 0, 0, 0, 0.06);
      for (let x = -L / 2 + 0.6; x < L / 2; x += 1.2) k.box(DETAIL.dark, 0.1, 0.04, D - 0.8, x, 0.19, 0);
      for (const s of [-1, 1]) k.box(coralMat(0.6), L, 0.08, 0.12, 0, 0.2, s * (D / 2 - 0.15));
    });
    return k.build();
  },
  tunnel(C) {
    const k = new PK().bounds(-12, -2, -11, 12, 12, 1.45); // 外框同原本
    const glow = coralMat(0.8);
    k.cb(mat(C.rock, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
    k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
    k.box(glow, 9, 0.3, 2.9, 0, 6.7, 0);
    for (const s of [-1, 1]) {
      k.box(glow, 0.3, 6.5, 2.9, s * 4.3, 3.25, 0);
      k.cb(mat(C.pillar, { roughness: 0.6, metalness: 0.4 }), 1.4, 7.6, 3.2, s * 5.2, 3.8, 0, 0, 0, 0, 0.12);
    }
    k.cb(mat(C.pillar, { roughness: 0.6, metalness: 0.4 }), 11.8, 1.2, 3.2, 0, 7.6, 0, 0, 0, 0, 0.12);
    return k.build();
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
