// 主題：高空軌道（AC6 第 5 章的卡門線／封鎖衛星）——雲海之上的金屬平台以桁架橋相連，平台外是虛空
import { RNG, pick, rnd } from '../../core/math.js';
import { WS } from '../../core/scale.js';
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
import { buildBridges, planIslands } from './xylem.js';

// ---------- 物件 ----------
// 太陽能板陣列：傾斜的板＋支柱，6 × 4 × 3（沿 X），原點在底面中心
export const SOLAR = [6.4, 4, 3];
export function buildSolarArray() {
  const glb = propGlb('solar_array', { fade: true });
  if (glb) return glb;
  const panel = fadeMat(0x1d3a6a, { roughness: 0.2, metalness: 0.6 }),
    frame = fadeMat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  const k = new PK().bounds(-3.2, 0, -1.297, 3.2, 3.927, 1.297); // 外框同原本
  // 支柱（底板＋斜撐＋頂部的轉軸）＋板面（框、格線）
  for (const x of [-2.6, 0, 2.6]) {
    k.box(frame, 0.3, 2.4, 0.3, x, 1.2, 0);
    k.box(frame, 0.7, 0.1, 0.9, x, 0.05, 0);
    k.bar(frame, [x, 0.1, 0.4], [x, 1.4, 0.05], 0.1);
    k.cyl(frame, 0.2, 0.2, 0.5, x, 2.55, 0, 0, 0, Math.PI / 2, 8);
  }
  k.cyl(frame, 0.1, 0.1, 6.2, 0, 2.55, 0, 0, 0, Math.PI / 2, 6);
  k.at(0, 3, 0, -0.6, 0, 0, () => {
    k.box(panel, 6.4, 0.15, 3, 0, 0, 0);
    for (let i = -2; i <= 2; i++) k.box(frame, 0.06, 0.18, 3.02, i * 1.3, 0, 0);
    for (const z of [-1.51, 0, 1.51]) k.box(frame, 6.42, 0.18, 0.06, 0, 0, z);
  });
  return k.build();
}
// 散熱板：高而薄的鰭片列，1.2 × h × 6（沿 Z），原點在底面中心
export function buildRadiator(h) {
  const glb = propGlb('radiator', { ref: [1.2, 8, 6], size: [1.2, h, 6], fade: true });
  if (glb) return glb;
  const m = fadeMat(0xe6e8ea, { roughness: 0.3, metalness: 0.5 }),
    dk = fadeMat(0x5a6068, { roughness: 0.6, metalness: 0.5 });
  const k = new PK().bounds(-0.6, 0, -3, 0.6, h, 3); // 外框同原本
  // 基座（倒角＋冷卻管接頭）＋鰭片（每片中段一條冷媒管）＋上緣的集管
  k.cb(dk, 1.2, 0.8, 6, 0, 0.4, 0, 0, 0, 0, 0.08);
  for (const z of [-2.7, 2.7]) k.cyl(dk, 0.18, 0.18, 1.3, 0, 0.5, z, 0, 0, Math.PI / 2, 6);
  for (let z = -2.5; z <= 2.5; z += 1) {
    k.box(m, 0.1, h - 0.8, 0.9, 0, (h + 0.8) / 2, z);
    k.box(dk, 0.16, h - 1.2, 0.08, 0, (h + 0.8) / 2, z);
  }
  k.cyl(dk, 0.12, 0.12, 5.4, 0, h - 0.1, 0, Math.PI / 2, 0, 0, 6);
  return k.build();
}
// 對接艙（直立的圓筒）：半徑 2、高 5，原點在底面中心
export function buildDockModule(color) {
  const glb = propGlb('dock_module', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.4, metalness: 0.5 }),
    dk = fadeMat(0x3d4044, { roughness: 0.6 });
  const k = new PK()
    .obCyl(2, 2, 4.4, 0, 2.2, 0, 0, 0, 0, 14)
    .obCyl(1.4, 2, 0.8, 0, 4.8, 0, 0, 0, 0, 14)
    .obCyl(2.05, 2.05, 0.3, 0, 3.2, 0, 0, 0, 0, 14); // 外框同原本的零件
  // 艙體＋外殼的縱向接縫＋警示帶＋頂部的對接環＋側面的艙門與舷窗
  k.cyl(m, 2, 2, 4.4, 0, 2.2, 0, 0, 0, 0, 14);
  k.cyl(dk, 2.08, 2.08, 0.2, 0, 0.1, 0, 0, 0, 0, 14);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box(dk, 0.08, 4.0, 0.06, Math.sin(a) * 2.01, 2.2, Math.cos(a) * 2.01, 0, a, 0);
  }
  k.cyl(dk, 1.4, 2, 0.8, 0, 4.8, 0, 0, 0, 0, 14);
  k.cyl(dk, 1.05, 1.05, 0.25, 0, 5.3, 0, 0, 0, 0, 12);
  k.cyl(fadeMat(0xd8a020), 2.05, 2.05, 0.3, 0, 3.2, 0, 0, 0, 0, 14);
  k.cb(dk, 1.3, 2.0, 0.3, 0, 1.4, 1.92, 0, 0, 0, 0.06);
  k.box(DETAIL.lamp, 0.2, 0.2, 0.08, 0.85, 2.3, 1.95);
  k.cyl(DETAIL.glass, 0.3, 0.3, 0.1, 0, 2.4, -1.97, Math.PI / 2, 0, 0, 8);
  return k.build();
}
// 推進器噴口（裝飾，掛在平台邊緣朝下）：原點在噴口頂
export function buildThruster() {
  const glb = propGlb('thruster');
  if (glb) return glb;
  const m = mat(0x5a6068, { roughness: 0.4, metalness: 0.7 });
  m.side = THREE.DoubleSide;
  const k = new PK().bounds(-2.6, -4, -2.6, 2.6, 0.8, 2.6); // 外框同原本
  // 噴管（外側的冷卻環）＋燃燒室＋萬向架＋發光的噴口
  k.geo(m, new THREE.CylinderGeometry(1.2, 2.6, 4, 12, 1, true), 0, -2, 0);
  for (const [y, r] of [
    [-1.0, 1.65],
    [-2.6, 2.25],
  ])
    k.cyl(m, r, r, 0.18, 0, y, 0, 0, 0, 0, 12);
  k.cyl(m, 1.3, 1.3, 1.2, 0, 0.2, 0, 0, 0, 0, 12);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    k.bar(
      DETAIL.dark,
      [Math.cos(a) * 1.25, 0.6, Math.sin(a) * 1.25],
      [Math.cos(a) * 1.8, 1.4, Math.sin(a) * 1.8],
      0.15,
    );
  }
  k.geo(
    new THREE.MeshBasicMaterial({ color: 0x80c8ff }),
    new THREE.CircleGeometry(2.4, 16),
    0,
    -3.9,
    0,
    Math.PI / 2,
    0,
    0,
  );
  return k.build();
}
// 通信桅杆：格子桿＋碟形天線，原點在底面中心，高 h
export function buildCommMast(h) {
  const glb = propGlb('comm_mast', { ref: [3, 16, 3], size: [3, h, 3] });
  if (glb) return glb;
  const m = mat(0xc8ccd0, { roughness: 0.5, metalness: 0.5 });
  m.side = THREE.DoubleSide;
  const k = new PK();
  // 外框同原本（四支柱＋碟形天線；頂部的鞭狀天線在外框外）
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) k.ob(0.12, h, 0.12, sx, h / 2, sz);
  k.obMesh(new THREE.SphereGeometry(1.4, 12, 4, 0, Math.PI * 2, 0, 0.9), 0, h - 1, 0.9, -1.9, 0, 0);
  for (const sx of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) k.box(m, 0.12, h, 0.12, sx, h / 2, sz);
  let yp = 0,
    i = 0;
  for (let y = 1; y < h; y += 1.8, i++) {
    k.box(m, 1.1, 0.08, 1.1, 0, y, 0);
    const f = i % 2 ? 0.5 : -0.5;
    k.bar(m, [f, yp, 0.5], [-f, y, 0.5], 0.05);
    k.bar(m, [0.5, yp, -f], [0.5, y, f], 0.05);
    yp = y;
  }
  k.cb(DETAIL.dark, 1.6, 0.4, 1.6, 0, 0.2, 0, 0, 0, 0, 0.06);
  k.geo(m, new THREE.SphereGeometry(1.4, 12, 4, 0, Math.PI * 2, 0, 0.9), 0, h - 1, 0.9, -1.9, 0, 0);
  // 碟的饋源與鞭狀天線、障礙燈
  k.bar(DETAIL.dark, [0, h - 1.3, 0.1], [0, h - 0.6, 1.25], 0.06);
  k.cyl(DETAIL.dark, 0.03, 0.03, 1.5, 0.4, h + 0.75, -0.4, 0, 0, 0, 4);
  k.box(DETAIL.red, 0.2, 0.2, 0.2, -0.4, h + 0.1, -0.4);
  return k.build();
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
    const dm = fadeMat(C.deck, { roughness: 0.4, metalness: 0.7 }),
      tm = fadeMat(0xc8ccd0, { roughness: 0.4, metalness: 0.6 });
    const L = rotY ? d : w,
      D = rotY ? w : d;
    const n = Math.max(2, Math.round(L / 3));
    const k = new PK();
    // 外框同原本（板、兩側護欄的立柱與上弦、板下的橫材）
    const ex = L / 2 + 0.09;
    if (rotY) k.bounds(-D / 2, -thick - 1.1, -ex, D / 2, 1.725, ex);
    else k.bounds(-ex, -thick - 1.1, -D / 2, ex, 1.725, D / 2);
    k.at(0, 0, 0, 0, rotY ? Math.PI / 2 : 0, 0, () => {
      k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, Math.min(0.1, thick * 0.2));
      // 兩側的桁架護欄（上弦＋直桿＋斜桿）＋邊緣警示條＋板下的桁架
      for (const s of [-1, 1]) {
        const z = s * (D / 2 - 0.15);
        k.box(tm, L, 0.25, 0.25, 0, 1.6, z);
        for (let i = 0; i <= n; i++) k.box(tm, 0.18, 1.6, 0.18, -L / 2 + (L / n) * i, 0.8, z);
        for (let i = 0; i < n; i++) {
          const x0 = -L / 2 + (L / n) * i;
          k.bar(tm, [x0, i % 2 ? 1.5 : 0.05, z], [x0 + L / n, i % 2 ? 0.05 : 1.5, z], 0.1);
        }
        k.box(DETAIL.yellow, L, 0.03, 0.2, 0, 0.015, s * (D / 2 - 0.45));
        k.box(tm, L, 0.18, 0.18, 0, -thick - 1, s * D * 0.42);
      }
      for (let i = 0; i < n; i++) {
        const at = -L / 2 + (L / n) * (i + 0.5);
        k.box(tm, 0.2, 0.2, D * 0.9, at, -thick - 1, 0);
        for (const s of [-1, 1]) k.bar(tm, [at, -thick - 1, s * D * 0.42], [at, -thick, s * D * 0.25], 0.1);
      }
    });
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().bounds(-r, -h / 2, -r, r, h / 2, r); // 外框同原本
    const m = mat(C.pillar, { roughness: 0.4, metalness: 0.7 });
    k.cyl(m, r * 0.7, r, h, 0, 0, 0, 0, 0, 0, 8);
    for (const y of [-h / 2 + 0.3, h / 2 - 0.3])
      k.cyl(DETAIL.dark, r * 1.05, r * 1.1, 0.6, 0, y, 0, 0, Math.PI / 8, 0, 8);
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      k.box(DETAIL.dark, 0.12, h - 1.4, 0.12, Math.cos(a) * r * 0.85, 0, Math.sin(a) * r * 0.85);
    }
    return k.build();
  },
  wall(w, h, d, C) {
    const k = new PK();
    const m = fadeMat(C.wall, { roughness: 0.4, metalness: 0.5 });
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L, h, T); // 外框同原本
      k.cb(m, L, h, T, 0, 0, 0, 0, 0, 0, 0.1);
      // 外殼板的接縫＋上下框＋警示條
      for (let x = -L / 2 + 2; x < L / 2 - 0.5; x += 2)
        for (const s of [-1, 1]) k.box(DETAIL.dark, 0.06, h - 0.6, 0.03, x, 0, s * (T / 2 + 0.01));
      for (const y of [-h / 2 + 0.2, h / 2 - 0.2]) k.box(DETAIL.steel, L + 0.04, 0.3, T + 0.06, 0, y, 0);
      for (const s of [-1, 1])
        hazard(
          k,
          DETAIL.yellow,
          DETAIL.black,
          L - 1,
          0.4,
          0,
          -h / 2 + 0.7,
          s * (T / 2 + 0.02),
          s > 0 ? 0 : Math.PI,
        );
    });
    return k.build();
  },
  platform(w, h, d, C) {
    const k = new PK().bounds(-w / 2, 0, -d / 2, w / 2, h, d / 2); // 外框同原本
    const m = fadeMat(C.plat, { roughness: 0.4, metalness: 0.6 });
    k.cb(m, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.15);
    for (const s of [-1, 1]) {
      k.box(DETAIL.yellow, w + 0.04, 0.15, 0.3, 0, h - 0.1, s * (d / 2 - 0.1));
      for (let x = -w / 2 + 2; x < w / 2 - 0.5; x += 2)
        k.box(DETAIL.dark, 0.06, h - 0.6, 0.03, x, h / 2, s * (d / 2 + 0.01));
    }
    ladder(k, DETAIL.steel, h, w / 2 - 1.2, 0, d / 2 + 0.12);
    return k.build();
  },
  ramp(rw, rd, C) {
    const along = rw >= rd;
    const L = along ? rw : rd,
      D = along ? rd : rw;
    const k = new PK().ob(rw, 0.35, rd); // 外框同原本
    k.at(0, 0, 0, 0, along ? 0 : Math.PI / 2, 0, () => {
      k.cb(mat(C.deck, { roughness: 0.4, metalness: 0.7 }), L, 0.35, D, 0, 0, 0, 0, 0, 0, 0.06);
      for (let x = -L / 2 + 0.6; x < L / 2; x += 1.2) k.box(DETAIL.dark, 0.1, 0.04, D - 0.8, x, 0.19, 0);
      for (const s of [-1, 1]) k.box(DETAIL.yellow, L, 0.06, 0.2, 0, 0.2, s * (D / 2 - 0.2));
    });
    return k.build();
  },
  tunnel(C) {
    // 對接閘門：外殼（倒角）＋閘門框（警示條紋）＋兩側的鎖定機構＋指示燈
    const k = new PK().bounds(-9, -1, -9, 9, 11, 1.45); // 外框同原本
    const wm = mat(C.wall, { roughness: 0.4, metalness: 0.5 });
    k.cb(wm, 18, 12, 8, 0, 5, -5, 0, 0, 0, 0.8);
    k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
    k.box(mat(C.trim), 9, 0.4, 2.9, 0, 6.8, 0);
    k.cb(DETAIL.steel, 10.4, 1.2, 2.6, 0, 7.6, 0, 0, 0, 0, 0.1);
    hazard(k, DETAIL.yellow, DETAIL.black, 9.6, 0.6, 0, 7.6, 1.32);
    for (const s of [-1, 1]) {
      k.cb(DETAIL.steel, 1.2, 7.2, 2.6, s * 4.6, 3.6, 0, 0, 0, 0, 0.1);
      k.cyl(DETAIL.dark, 0.5, 0.5, 0.4, s * 4.6, 5.6, 1.4, Math.PI / 2, 0, 0, 10);
      k.box(DETAIL.red, 0.3, 0.3, 0.2, s * 4.6, 7.0, 1.35);
    }
    return k.build();
  },
});

// 平台的高度（舊尺度；planIslands 乘上 G）；平台上的設備（虛構的軌道設施）放大 EQ_S 倍
const G = WS;
const H = 0.5;
const EQ_S = 2;
function planTerrain(w) {
  return planIslands(w, { h: H, deep: -40, central: 40, n: [7, 10], size: [24, 40], span: 40, gap: 14 });
}
function buildStructures(w) {
  buildBridges(w, 8);
  stars(w);
  // 平台邊緣朝下的推進器
  for (const b of w.islands.blocks) {
    for (const [x, z] of [
      [b.x0 + 4 * G, b.z0 + 4 * G],
      [b.x1 - 4 * G, b.z0 + 4 * G],
      [b.x0 + 4 * G, b.z1 - 4 * G],
      [b.x1 - 4 * G, b.z1 - 4 * G],
    ]) {
      const t = buildThruster();
      t.scale.setScalar(G);
      t.position.set(x, (H - 1.5) * G, z);
      w.addDecorMesh(t);
    }
    // 平台側面的厚板（從下方看是金屬平台）：倒角的板＋縮進的下層＋側面的加強肋＋上緣的標示燈帶
    const sw = b.x1 - b.x0,
      sd = b.z1 - b.z0;
    const cx = (b.x0 + b.x1) / 2,
      cz = (b.z0 + b.z1) / 2;
    const sm = mat(0x6d757e, { roughness: 0.5, metalness: 0.6 });
    const k = new PK();
    k.scaled(G, () => {
      const sw0 = sw / G,
        sd0 = sd / G;
      k.cb(sm, sw0, 3, sd0, 0, 0, 0, 0, 0, 0, 0.3);
      k.cb(sm, Math.max(4, sw0 - 14), 1.6, Math.max(4, sd0 - 14), 0, -2.2, 0, 0, 0, 0, 0.3);
      for (const s of [-1, 1]) {
        for (let x = -sw0 / 2 + 2; x < sw0 / 2 - 1; x += 4)
          k.box(DETAIL.dark, 0.4, 2.6, 0.2, x, -0.1, s * (sd0 / 2 + 0.05));
        for (let z = -sd0 / 2 + 2; z < sd0 / 2 - 1; z += 4)
          k.box(DETAIL.dark, 0.2, 2.6, 0.4, s * (sw0 / 2 + 0.05), -0.1, z);
        k.box(DETAIL.lamp, sw0 - 1, 0.1, 0.06, 0, 1.2, s * (sd0 / 2 + 0.03));
        k.box(DETAIL.lamp, 0.06, 0.1, sd0 - 1, s * (sw0 / 2 + 0.03), 1.2, 0);
      }
    });
    const slab = k.build();
    slab.position.set(cx, (H - 2) * G, cz);
    w.scene.add(slab);
    w.meshes.push(slab);
  }
}
function buildProps(w) {
  const E = EQ_S;
  w.scatter(w.cnt(8, 12), 12, (x, z, y) => {
    const g = buildSolarArray();
    g.scale.setScalar(E);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(
      g,
      x,
      y,
      z,
      { w: (rot ? SOLAR[2] : SOLAR[0]) * E, h: SOLAR[1] * E, d: (rot ? SOLAR[0] : SOLAR[2]) * E },
      'solar',
      2800,
      0x1d3a6a,
    );
  });
  w.scatter(w.cnt(6, 10), 12, (x, z, y) => {
    const h = rnd(6, 9);
    const g = buildRadiator(h);
    g.scale.setScalar(E);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(
      g,
      x,
      y,
      z,
      { w: (rot ? 6 : 1.2) * E, h: h * E, d: (rot ? 1.2 : 6) * E },
      'radiator',
      3600,
      0xe6e8ea,
    );
  });
  w.scatter(w.cnt(5, 8), 12, (x, z, y) => {
    const color = pick([0xe6e8ea, 0xd8a020, 0x8a949e]);
    const g = buildDockModule(color);
    g.scale.setScalar(E);
    w.addSmall(g, x, y, z, { r: 2.05 * E, h: 5.2 * E }, 'dock', 4800, color);
  });
  w.scatter(w.cnt(4, 6), 10, (x, z, y) => {
    const h = rnd(25, 40);
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
  water: { level: -16, color: 0xeef2f8, opacity: 0.97, rough: 1, wide: true, cloud: true }, // 雲海（粒子的煙霧，fx/cloudsea.js）
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
    [
      'solar_array',
      '太陽能板陣列',
      '高空軌道的掩體；遊戲中放大 2 倍（12.8 × 8 × 6 m），可破壞',
      () => buildSolarArray(),
    ],
    [
      'radiator',
      '散熱板',
      '高空軌道；遊戲中放大 2 倍（高 12–18 m），可破壞；GLB 依高度縮放',
      () => buildRadiator(8),
    ],
    [
      'dock_module',
      '對接艙',
      '高空軌道；遊戲中放大 2 倍（半徑 4、高 10.4 m），可破壞',
      () => buildDockModule(0xe6e8ea),
    ],
    [
      'thruster',
      '推進器噴口',
      '高空軌道的裝飾，掛在平台底下（遊戲中放大 3 倍）',
      () => buildThruster(),
      { origin: '噴口頂' },
    ],
    ['comm_mast', '通信桅杆', '高空軌道；高 25–40 m，可破壞；GLB 依高度縮放', () => buildCommMast(15)],
  ],
};
