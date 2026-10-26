// 主題：舊宇宙港（AC6 中央冰原的伯特蘭舊宇宙港／燃料基地）——平坦的停機坪、發射塔與火箭、
// 可以走進去的機庫、管制塔、球形燃料槽
import { RNG, clamp, pick, rnd } from '../../core/math.js';
import {
  box,
  fadeMat,
  mat,
  propGlb,
  registerFeatureStyle,
  PK,
  DETAIL,
  HOLE,
  hazard,
  railing,
  grille,
} from './kit.js';

// ---------- 物件 ----------
// 發射塔＋火箭：塔在 −X、火箭在原點；原點在地面中心。TOWER＝塔的碰撞箱（中心 x、寬、高），ROCKET＝火箭（半徑、高）
export const TOWER = { x: -7, w: 6, h: 46 };
export const ROCKET = { r: 3.2, h: 36 };
export function buildLaunchTower() {
  const glb = propGlb('launch_tower', { fade: true });
  if (glb) return glb;
  const steel = fadeMat(0xb04a2a, { roughness: 0.6, metalness: 0.5 }),
    white = fadeMat(0xe6e8ea, { roughness: 0.5, metalness: 0.2 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 }),
    pad = fadeMat(0x8a8c8e, { roughness: 0.95 });
  const k = new PK().bounds(-12, 0, -12, 12, 46, 12); // 外框同原本
  // 發射台：台面＋導焰槽＋四角的固定臂
  k.cb(pad, 24, 0.4, 24, 0, 0.2, 0, 0, 0, 0, 0.15);
  k.box(dk, 8, 0.05, 8, 0, 0.42, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    k.cb(steel, 1.2, 3, 1.2, Math.cos(a) * 5.2, 1.9, Math.sin(a) * 5.2, 0, 0, 0, 0.1);
    k.bar(
      steel,
      [Math.cos(a) * 5.2, 3.2, Math.sin(a) * 5.2],
      [Math.cos(a) * 3.4, 4.2, Math.sin(a) * 3.4],
      0.4,
    );
  }
  // 格子塔：四角柱＋橫材＋斜撐＋每兩層的平台（欄杆）＋頂部的避雷針與吊臂
  const T = TOWER,
    a = T.w / 2 - 0.2;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(steel, 0.4, T.h, 0.4, T.x + sx * a, T.h / 2, sz * a);
  let yp = 0,
    i = 0;
  for (let y = 3; y < T.h; y += 3.5, i++) {
    for (const s of [-1, 1]) {
      k.box(steel, T.w, 0.25, 0.25, T.x, y, s * a);
      k.box(steel, 0.25, 0.25, T.w, T.x + s * a, y, 0);
      const f = i % 2 ? 1 : -1;
      k.bar(steel, [T.x - f * a, yp, s * a], [T.x + f * a, y, s * a], 0.16);
      k.bar(steel, [T.x + s * a, yp, -f * a], [T.x + s * a, y, f * a], 0.16);
    }
    if (Math.round(y) % 7 === 3) {
      k.box(dk, T.w - 0.4, 0.2, T.w - 0.4, T.x, y, 0);
      railing(k, dk, T.w - 0.4, 1, T.x, y, -a + 0.1, 0, 2, 0.06);
    }
    yp = y;
  }
  k.cyl(dk, 0.1, 0.15, 6, T.x, T.h + 3, 0, 0, 0, 0, 6);
  k.box(steel, 9, 0.6, 0.6, T.x + 2, T.h - 1, 0);
  k.pipe(dk, [T.x + 6.2, T.h - 1.3, 0], [T.x + 6.2, T.h - 6, 0], 0.05, 4);
  // 連接臂（桁架＋前端的抱臂）與加注管
  for (const y of [12, 24, 32]) {
    k.box(steel, 4, 0.6, 1.6, T.x + 3.6, y, 0);
    k.box(steel, 4, 0.2, 0.2, T.x + 3.6, y + 0.9, 0.7);
    k.bar(steel, [T.x + 1.8, y + 0.3, 0.7], [T.x + 5.2, y + 0.9, 0.7], 0.12);
    k.cb(dk, 0.6, 1.4, 2.4, T.x + 5.8, y, 0, 0, 0, 0, 0.08);
  }
  k.pipe(dk, [T.x + a + 0.4, 1, 1.2], [T.x + a + 0.4, 24, 1.2], 0.2, 6);
  // 火箭：箭體（段間的接縫環、警示塗裝、標記）＋鼻錐＋四片尾翼＋引擎噴口
  const R = ROCKET;
  k.cyl(white, R.r, R.r, R.h * 0.8, 0, R.h * 0.4 + 1, 0, 0, 0, 0, 16);
  k.geo(white, new THREE.ConeGeometry(R.r, R.h * 0.2, 16), 0, R.h * 0.9 + 1, 0);
  k.cyl(dk, R.r + 0.05, R.r + 0.05, 1.2, 0, R.h * 0.55, 0, 0, 0, 0, 16);
  for (const y of [R.h * 0.25, R.h * 0.75]) k.cyl(dk, R.r + 0.03, R.r + 0.03, 0.25, 0, y, 0, 0, 0, 0, 16);
  k.cyl(steel, R.r + 0.04, R.r + 0.04, 2.0, 0, R.h * 0.82, 0, 0, 0, 0, 16);
  k.box(dk, 0.1, 6, 1.2, R.r + 0.02, R.h * 0.4, 0);
  for (let j = 0; j < 4; j++) {
    const fa = (j * Math.PI) / 2;
    k.prism(
      dk,
      [
        [0, 0],
        [1.6, 0],
        [1.6, 1.4],
        [0, 4.5],
      ],
      0.3,
      Math.cos(fa) * R.r * 0.95,
      1,
      Math.sin(fa) * R.r * 0.95,
      0,
      -fa,
      0,
    );
  }
  k.cyl(dk, R.r * 0.6, R.r * 0.8, 1.0, 0, 0.9, 0, 0, 0, 0, 12);
  return k.build();
}
// 機庫：寬 HANGAR.w（X）× 深 HANGAR.d（Z）× 高 HANGAR.h，開口朝 −Z；原點在地面中心
export const HANGAR = { w: 26, d: 22, h: 12, wall: 1 };
export function buildHangar(color) {
  const glb = propGlb('hangar', { color, fade: true });
  if (glb) return glb;
  const H = HANGAR;
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 }),
    lamp = fadeMat(0xfff4d8, { emissive: 0x806a40, roughness: 0.4 });
  const k = new PK().bounds(-13.4, 0, -11.4, 13.4, 12, 11.3); // 外框同原本
  // 牆（碰撞同原本）＋外側的柱＋牆板的波紋＋屋頂（屋脊的通風帽）＋門楣（警示條紋、門軌）＋內部的燈＋地面標線
  k.box(m, H.w, H.h, H.wall, 0, H.h / 2, H.d / 2 - H.wall / 2);
  for (let x = -H.w / 2 + 1.5; x < H.w / 2 - 1; x += 1.5)
    k.box(m, 0.2, H.h - 1, 0.12, x, H.h / 2 - 0.5, H.d / 2 + 0.05);
  for (const s of [-1, 1]) {
    k.box(m, H.wall, H.h, H.d, s * (H.w / 2 - H.wall / 2), H.h / 2, 0);
    for (let z = -H.d / 2 + 2; z < H.d / 2; z += 4) {
      k.box(dk, 0.3, H.h, 0.4, s * (H.w / 2 + 0.1), H.h / 2, z);
      k.box(dk, 0.5, 0.3, 0.6, s * (H.w / 2 + 0.15), 0.15, z);
    }
    k.box(DETAIL.lamp, 0.12, 0.3, 0.6, s * (H.w / 2 + 0.25), H.h - 2.5, -H.d / 2 + 1);
  }
  k.box(m, H.w + 0.6, 1, H.d + 0.6, 0, H.h - 0.5, 0); // 屋頂
  for (let z = -H.d / 2 + 3; z < H.d / 2 - 2; z += 5) k.cb(dk, 2.2, 0.8, 1.6, 0, H.h + 0.4, z, 0, 0, 0, 0.1);
  k.box(dk, H.w + 0.8, 1.6, 0.8, 0, H.h - 1.2, -H.d / 2); // 門楣
  hazard(k, DETAIL.yellow, DETAIL.black, H.w - 1, 0.8, 0, H.h - 1.2, -H.d / 2 - 0.42, Math.PI, 1);
  k.box(DETAIL.steel, H.w + 0.6, 0.15, 0.3, 0, H.h - 2.1, -H.d / 2 - 0.3);
  for (let x = -H.w / 2 + 4; x < H.w / 2 - 2; x += 6) k.box(lamp, 2.4, 0.2, 0.8, x, H.h - 1.2, 0);
  k.box(fadeMat(0xd8a020), H.w - 2, 0.05, 0.4, 0, 0.03, -H.d / 2 + 1);
  return k.build();
}
// 管制塔：圓柱塔身＋頂部玻璃艙；原點在地面中心；CTRL_TOWER＝塔身半徑、高
export const CTRL_TOWER = { r: 3, h: 26 };
export function buildControlTower() {
  const glb = propGlb('control_tower', { fade: true });
  if (glb) return glb;
  const m = fadeMat(0xc8ccd0, { roughness: 0.7 }),
    glass = fadeMat(0x24384a, { roughness: 0.15, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 });
  const T = CTRL_TOWER;
  const k = new PK().bounds(-6, 0, -6, 6, 34.5, 6); // 外框同原本
  // 塔身（基座、樓層線、縱向的窗帶）＋玻璃艙（窗框、下方的走道）＋屋頂（雷達、天線、障礙燈）
  k.cyl(m, T.r, T.r * 1.2, T.h, 0, T.h / 2, 0, 0, 0, 0, 12);
  k.cyl(dk, T.r * 1.35, T.r * 1.4, 1.2, 0, 0.6, 0, 0, 0, 0, 12);
  for (let y = 5; y < T.h - 1; y += 5)
    k.cyl(
      dk,
      T.r * (1.2 - (0.2 * y) / T.h) + 0.04,
      T.r * (1.2 - (0.2 * y) / T.h) + 0.04,
      0.2,
      0,
      y,
      0,
      0,
      0,
      0,
      12,
    );
  k.box(glass, 0.8, T.h - 6, 0.1, 0, T.h / 2 + 1, T.r * 1.1);
  k.box(dk, 2.0, 2.6, 0.1, 0, 1.3, T.r * 1.22);
  k.cyl(dk, T.r * 1.7, T.r * 1.5, 0.5, 0, T.h + 0.1, 0, 0, 0, 0, 12);
  k.cyl(glass, T.r * 1.9, T.r * 1.5, 3.2, 0, T.h + 1.6, 0, 0, 0, 0, 12);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    k.box(dk, 0.12, 3.2, 0.12, Math.cos(a) * T.r * 1.72, T.h + 1.6, Math.sin(a) * T.r * 1.72, 0, -a, -0.36);
  }
  k.cyl(dk, T.r * 2, T.r * 2, 0.6, 0, T.h + 3.4, 0, 0, 0, 0, 12);
  k.cyl(dk, 0.15, 0.15, 5, 0, T.h + 6, 0, 0, 0, 0, 6);
  k.box(m, 3, 0.4, 0.6, 1.8, T.h + 4.4, 0);
  k.box(DETAIL.red, 0.3, 0.3, 0.3, 0, T.h + 8.6, 0);
  return k.build();
}
// 球形燃料槽（四腳）：半徑 r，原點在地面中心
export function buildFuelSphere(r) {
  const glb = propGlb('fuel_sphere', { ref: [8, 10, 8], size: [r * 2, r * 2.5, r * 2], fade: true });
  if (glb) return glb;
  const m = fadeMat(0xe6e8ea, { roughness: 0.4, metalness: 0.3 }),
    leg = fadeMat(0x8a5a3a, { roughness: 0.7, metalness: 0.5 });
  const k = new PK()
    .obMesh(new THREE.SphereGeometry(r, 16, 10), 0, r * 1.4, 0)
    .obCyl(r * 1.02, r * 1.02, 0.3, 0, r * 1.4, 0, 0, 0, 0, 16); // 外框同原本的零件
  for (let i = 0; i < 6; i++)
    k.ob(
      0.35,
      r * 1.4,
      0.35,
      Math.cos((i / 6) * Math.PI * 2) * r * 0.85,
      r * 0.7,
      Math.sin((i / 6) * Math.PI * 2) * r * 0.85,
    );
  // 球槽＋赤道帶＋六支腳（底板、腳間的斜撐）＋頂部的閥座＋側面的管線
  k.geo(m, new THREE.SphereGeometry(r, 16, 10), 0, r * 1.4, 0);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    pts.push([Math.cos(a) * r * 0.85, Math.sin(a) * r * 0.85]);
    k.box(leg, 0.35, r * 1.4, 0.35, pts[i][0], r * 0.7, pts[i][1]);
    k.box(leg, 0.7, 0.1, 0.7, pts[i][0], 0.05, pts[i][1]);
  }
  for (let i = 0; i < 6; i++) {
    const [x0, z0] = pts[i],
      [x1, z1] = pts[(i + 1) % 6];
    k.bar(leg, [x0, 0.3, z0], [x1, r * 0.9, z1], 0.12);
  }
  k.cyl(fadeMat(0xb04a2a), r * 1.02, r * 1.02, 0.3, 0, r * 1.4, 0, 0, 0, 0, 16);
  k.cyl(leg, r * 0.3, r * 0.3, 0.2, 0, r * 2.37, 0, 0, 0, 0, 10);
  k.pipe(leg, [r * 0.85, 0.4, r * 0.15], [r * 0.85, r * 0.9, r * 0.15], 0.15);
  return k.build();
}
// 燃料車：2.6 × 3 × 8（長沿 Z），原點在底面中心
export const FUEL_TRUCK = [2.6, 3, 8];
export function buildFuelTruck() {
  const glb = propGlb('fuel_truck', { fade: true });
  if (glb) return glb;
  const m = fadeMat(0xd8d8d0, { roughness: 0.5, metalness: 0.4 }),
    cab = fadeMat(0xb04a2a, { roughness: 0.6 }),
    dk = fadeMat(0x22262a, { roughness: 0.9 });
  const k = new PK().bounds(-1.3, 0, -4, 1.3, 3.15, 3.7); // 外框同原本
  // 底盤＋油罐（罐箍、頂部的走道與人孔、警示帶）＋駕駛艙（斜擋風玻璃）＋車輪
  k.box(dk, 1.4, 0.3, 7.6, 0, 0.75, -0.2);
  k.cyl(m, 1.25, 1.25, 5.6, 0, 1.9, 0.9, Math.PI / 2, 0, 0, 12);
  for (const z of [-1.6, 0.9, 3.4]) k.cyl(dk, 1.29, 1.29, 0.15, 0, 1.9, z, Math.PI / 2, 0, 0, 12);
  k.box(dk, 0.6, 0.08, 5.0, 0, 3.17, 0.9);
  for (const z of [-0.5, 2.3]) k.cyl(dk, 0.35, 0.35, 0.2, 0, 3.2, z, 0, 0, 0, 8);
  k.box(DETAIL.yellow, 0.05, 0.25, 5.4, 1.26, 1.6, 0.9);
  k.box(DETAIL.yellow, 0.05, 0.25, 5.4, -1.26, 1.6, 0.9);
  k.prism(
    cab,
    [
      [2.0, 0.5],
      [4.0, 0.5],
      [4.0, 1.6],
      [3.7, 2.7],
      [2.0, 2.7],
    ],
    2.5,
    0,
    0,
    0,
    0,
    Math.PI / 2,
    0,
  );
  k.quad(DETAIL.glass, [1.1, 1.75, -3.99], [-1.1, 1.75, -3.99], [-1.1, 2.55, -3.76], [1.1, 2.55, -3.76]);
  for (const s of [-1, 1]) k.box(DETAIL.glass, 0.04, 0.6, 1.0, s * 1.26, 2.1, -2.9);
  k.box(dk, 2.6, 0.3, 0.2, 0, 0.6, -4.0);
  for (const s of [-1, 1]) k.box(DETAIL.lamp, 0.35, 0.18, 0.05, s * 0.9, 1.0, -4.02);
  for (const sx of [-1.1, 1.1])
    for (const sz of [-3, 0.5, 2.6]) {
      k.cyl(dk, 0.5, 0.5, 0.4, sx, 0.5, sz, 0, 0, Math.PI / 2, 10);
      k.cyl(DETAIL.steel, 0.25, 0.25, 0.42, sx, 0.5, sz, 0, 0, Math.PI / 2, 6);
    }
  return k.build();
}
// 防爆牆：8 × 4 × 1（沿 X），原點在底面中心
export const BLAST_WALL = [8, 4, 1.2];
export function buildBlastWall() {
  const glb = propGlb('blast_wall', { fade: true });
  if (glb) return glb;
  const m = fadeMat(0x9a9c9e, { roughness: 0.95 }),
    yel = fadeMat(0xd8a020, { roughness: 0.6 }),
    blk = fadeMat(0x22262a, { roughness: 0.6 });
  const k = new PK().bounds(-4, 0, -0.6, 4, 4, 0.645); // 外框同原本
  // 混凝土 T 型牆：牆身（倒角、上緣收窄）＋背面的扶壁＋吊環＋正面的警示條紋（兩面）
  k.prism(
    m,
    [
      [-0.6, 0],
      [0.6, 0],
      [0.6, 0.5],
      [0.35, 0.9],
      [0.3, 4],
      [-0.3, 4],
      [-0.35, 0.9],
      [-0.6, 0.5],
    ],
    8,
    0,
    0,
    0,
    0,
    Math.PI / 2,
    0,
  );
  for (const x of [-2.5, 2.5]) {
    k.cb(m, 0.5, 0.25, 0.25, x, 4.1, 0, 0, 0, 0, 0.05);
    k.box(DETAIL.dark, 0.06, 3, 0.04, x + 1.25, 2.4, 0.33);
  }
  for (const s of [-1, 1]) hazard(k, yel, blk, 8, 0.45, 0, 0.28, s * 0.61, s > 0 ? 0 : Math.PI, 1);
  return k.build();
}
// 貨物艙（橫放的膠囊）：2.6 × 2.6 × 6（長沿 Z），原點在底面中心
export const CARGO_POD = [2.8, 2.7, 6];
export function buildCargoPod(color) {
  const glb = propGlb('cargo_pod', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.5, metalness: 0.4 }),
    dk = fadeMat(0x3d4044, { roughness: 0.8 });
  const k = new PK().bounds(-1.4, 0, -3.5, 1.4, 2.65, 3.5); // 外框同原本
  // 膠囊＋接縫環＋側面的艙門與把手＋托架（兩道鞍座）＋吊點
  k.cyl(m, 1.3, 1.3, 4.4, 0, 1.35, 0, Math.PI / 2, 0, 0, 12);
  for (const s of [-1, 1])
    k.geo(
      m,
      new THREE.SphereGeometry(1.3, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      0,
      1.35,
      s * 2.2,
      (s * Math.PI) / 2,
      0,
      0,
    );
  for (const z of [-1.4, 1.4]) k.cyl(dk, 1.34, 1.34, 0.18, 0, 1.35, z, Math.PI / 2, 0, 0, 12);
  k.box(dk, 0.06, 1.2, 1.6, 1.29, 1.5, 0);
  k.box(DETAIL.yellow, 0.08, 0.1, 0.5, 1.32, 1.5, 0.5);
  k.box(dk, 2.8, 0.4, 3.6, 0, 0.2, 0);
  for (const z of [-1.4, 1.4]) k.box(dk, 2.4, 0.5, 0.3, 0, 0.55, z);
  k.cb(dk, 0.4, 0.3, 0.4, 0, 2.7, 0, 0, 0, 0, 0.05);
  return k.build();
}
// 天線桿：原點在底面中心，高 h
export function buildAntennaMast(h) {
  const glb = propGlb('antenna_mast', { ref: [2, 14, 2], size: [2, h, 2] });
  if (glb) return glb;
  const m = mat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  const k = new PK().bounds(-1, 0, -0.3, 1, h + 0.45, 0.3); // 外框同原本
  k.cb(DETAIL.dark, 0.6, 0.4, 0.6, 0, 0.2, 0, 0, 0, 0, 0.06);
  k.cyl(m, 0.18, 0.3, h, 0, h / 2, 0, 0, 0, 0, 6);
  for (const y of [h * 0.6, h * 0.8]) {
    k.box(m, 2, 0.12, 0.12, 0, y, 0);
    for (const s of [-1, 1]) k.cyl(m, 0.04, 0.04, 1.2, s * 0.95, y - 0.6, 0, 0, 0, 0, 4);
  }
  k.cb(m, 0.4, 1.0, 0.16, 0, h * 0.4, 0.2, 0, 0, 0, 0.04);
  k.box(DETAIL.red, 0.5, 0.5, 0.5, 0, h + 0.2, 0);
  return k.build();
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
    const dm = fadeMat(C.deck, { roughness: 0.6, metalness: 0.6 }),
      rm = fadeMat(C.trim, { roughness: 0.6 });
    const L = rotY ? d : w,
      D = rotY ? w : d;
    const k = new PK();
    k.at(0, 0, 0, 0, rotY ? -Math.PI / 2 : 0, 0, () => {
      // 外框同原本（板、扶手、立柱）
      k.ob(L, thick, D, 0, -thick / 2, 0);
      for (const s of [-1, 1]) {
        k.ob(L, 0.12, 0.12, 0, 1, s * (D / 2 - 0.15));
        for (let q = -L / 2; q <= L / 2; q += 2) k.ob(0.1, 1, 0.1, q, 0.5, s * (D / 2 - 0.15));
      }
      // 鋼構步道：格柵板（接縫）＋側面的槽鋼＋黃色欄杆（立柱、扶手、中欄、踢腳板）
      k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, 0.05);
      for (let x = -L / 2 + 2; x < L / 2 - 0.5; x += 2) k.box(DETAIL.dark, 0.06, 0.02, D - 0.4, x, 0.01, 0);
      for (const s of [-1, 1]) {
        k.box(DETAIL.dark, L, thick * 0.8, 0.12, 0, -thick / 2, s * (D / 2 - 0.05));
        k.box(rm, L, 0.12, 0.12, 0, 1, s * (D / 2 - 0.15));
        k.box(rm, L, 0.08, 0.08, 0, 0.5, s * (D / 2 - 0.15));
        k.box(rm, L, 0.15, 0.04, 0, 0.08, s * (D / 2 - 0.1));
        for (let q = -L / 2; q <= L / 2; q += 2) k.box(rm, 0.1, 1, 0.1, q, 0.5, s * (D / 2 - 0.15));
      }
    });
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().bounds(-(r * 0.9 + 0.125), -h / 2, -r * 0.8, r * 0.9 + 0.125, h / 2, r * 0.8); // 外框同原本
    const m = mat(C.pillar, { roughness: 0.6, metalness: 0.6 });
    // H 型鋼＋加勁板＋柱腳（底板與錨栓）＋柱頭
    k.box(m, r * 1.8, h, 0.25, 0, 0, 0);
    for (const s of [-1, 1]) k.box(m, 0.25, h, r * 1.6, s * r * 0.9, 0, 0);
    for (let y = -h / 2 + 2; y < h / 2 - 1; y += 2.5)
      for (const s of [-1, 1]) k.box(m, r * 1.6, 0.1, 0.06, 0, y, s * r * 0.4);
    k.box(DETAIL.dark, r * 1.8 + 0.25, 0.2, r * 1.6, 0, -h / 2 + 0.1, 0);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        k.box(DETAIL.steel, 0.12, 0.2, 0.12, sx * r * 0.5, -h / 2 + 0.3, sz * r * 0.6);
    k.box(DETAIL.dark, r * 1.8 + 0.25, 0.2, r * 1.6, 0, h / 2 - 0.1, 0);
    return k.build();
  },
  wall(w, h, d, C) {
    const k = new PK();
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    const yel = fadeMat(C.trim),
      blk = fadeMat(0x22262a);
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L, h, T + 0.05); // 外框同原本
      // 防爆牆：倒角牆身＋上緣的壓頂＋兩面的斜向警示條紋＋吊環
      k.cb(fadeMat(C.wall, { roughness: 0.95 }), L, h, T, 0, 0, 0, 0, 0, 0, 0.12);
      k.box(blk, L + 0.04, 0.2, T + 0.1, 0, h / 2 - 0.1, 0);
      for (const s of [-1, 1])
        hazard(k, yel, blk, L, 0.6, 0, -h / 2 + 0.6, s * (T / 2 + 0.03), s > 0 ? 0 : Math.PI, 1);
      for (const x of [-L / 4, L / 4]) k.cb(blk, 0.4, 0.25, 0.25, x, h / 2 + 0.1, 0, 0, 0, 0, 0.04);
    });
    return k.build();
  },
  platform(w, h, d, C) {
    const k = new PK().bounds(-w / 2, 0, -d / 2 - 0.15, w / 2, h + 0.055, d / 2 + 0.15); // 外框同原本
    k.cb(fadeMat(C.plat, { roughness: 0.95 }), w, h, d, 0, h / 2, 0, 0, 0, 0, 0.15);
    k.box(fadeMat(0x3a3c3e), w * 0.6, 0.05, d * 0.6, 0, h + 0.03, 0); // 焦痕
    const tm = fadeMat(C.trim);
    for (const s of [-1, 1]) k.box(tm, w, 0.4, 0.3, 0, h - 0.2, s * (d / 2));
    // 發射台：導焰口（側面的黑洞）＋四角的固定座
    k.box(DETAIL.black, w * 0.3, h * 0.5, 0.1, 0, h * 0.3, d / 2 + 0.02);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        k.box(DETAIL.dark, 1, 0.05, 1, sx * (w / 2 - 1.2), h + 0.025, sz * (d / 2 - 1.2));
    return k.build();
  },
  ramp(rw, rd, C) {
    const along = rw >= rd;
    const L = along ? rw : rd,
      D = along ? rd : rw;
    const k = new PK().ob(rw, 0.35, rd); // 外框同原本
    k.at(0, 0, 0, 0, along ? 0 : Math.PI / 2, 0, () => {
      k.cb(mat(C.deck, { roughness: 0.6, metalness: 0.6 }), L, 0.35, D, 0, 0, 0, 0, 0, 0, 0.05);
      for (let x = -L / 2 + 0.5; x < L / 2; x += 1) k.box(DETAIL.dark, 0.08, 0.04, D - 0.5, x, 0.19, 0);
      for (const s of [-1, 1])
        k.box(mat(C.trim, { roughness: 0.6 }), L, 0.06, 0.2, 0, 0.2, s * (D / 2 - 0.2));
    });
    return k.build();
  },
  tunnel(C) {
    // 機庫式隧道口：混凝土頭牆＋捲門的門楣（警示條紋）＋兩側的鋼柱＋燈
    const k = new PK();
    const m = mat(0x8a8c8e, { roughness: 0.9 });
    k.cb(mat(C.rock, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
    k.cb(m, 16, 10, 2.5, 0, 5, 0, 0, 0, 0, 0.15);
    k.box(HOLE, 10, 7.5, 2.8, 0, 3.75, 0);
    k.box(mat(C.trim), 10.6, 0.6, 2.9, 0, 7.8, 0);
    hazard(k, DETAIL.yellow, DETAIL.black, 10, 0.5, 0, 8.4, 1.27);
    for (const s of [-1, 1]) {
      k.box(DETAIL.dark, 0.6, 7.5, 2.9, s * 5.3, 3.75, 0);
      k.box(DETAIL.lamp, 0.6, 0.25, 0.2, s * 3.5, 9.0, 1.33);
      grille(k, DETAIL.dark, m, 1.2, 2.4, 6, s * 6.8, 4, 1.27);
    }
    return k.build();
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
  w.addDecor(Math.round(24 * w.kk), () => box(0.5, 0.25, 0.5, mat(0xffe0a0, { emissive: 0x805a20 })));
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
