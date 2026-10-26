// 主題：汙染水沒市街（AC6 貝利烏斯南部的水沒市街）——街道泡在汙水裡、街區高出水面，大樓廢墟可站上屋頂
import { RNG, clamp, lerp, pick, rnd } from '../../core/math.js';
import { fadeMat, hashRng, mat, propGlb, registerFeatureStyle, windowMat, PK, DETAIL, HOLE } from './kit.js';

const CELL = 30, // 街區＋街道
  STREET = 9,
  WATER = 0.2;

// ---------- 物件（純函式，支援 GLB：prop/<槽位>）----------
// 大樓廢墟：w × h × d，原點在底面中心；broken：頂部崩塌（外觀）
export function buildRuinTower(w, h, d, broken, seed) {
  const glb = propGlb('ruin_tower', { ref: [16, 24, 16], size: [w, h, d], fade: true });
  if (glb) return glb;
  const wm = windowMat({ base: '#7a7d78', win: '#22282b', broken: 0.2, seed }, Math.max(w, d), h);
  const trim = fadeMat(0x5a5d5a, { roughness: 0.9 });
  const k = new PK();
  // 外框同原本（樓身、屋頂邊、水漬帶、屋頂上的斷牆或機房）
  k.ob(w, h, d, 0, h / 2, 0)
    .ob(w + 0.3, 0.6, d + 0.3, 0, h, 0)
    .ob(w + 0.05, 1.2, d + 0.05, 0, 0.9, 0);
  k.box(wm, w, h, d, 0, h / 2, 0);
  // 樓層的樓板邊緣（每 4 m 一道）＋四角的柱
  for (let y = 4; y < h - 1; y += 4) k.box(trim, w + 0.2, 0.25, d + 0.2, 0, y, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(trim, 0.5, h, 0.5, sx * (w / 2 - 0.1), h / 2, sz * (d / 2 - 0.1));
  k.box(trim, w + 0.3, 0.6, d + 0.3, 0, h, 0);
  const r = hashRng(seed);
  if (broken) {
    // 屋頂上的斷牆與傾斜的樓板、外露的鋼筋
    for (let i = 0; i < 4; i++) {
      const bw = w * (0.25 + r() * 0.3),
        bh = 1.5 + r() * 3;
      const x = (r() - 0.5) * (w - bw),
        z = (r() > 0.5 ? 1 : -1) * (d / 2 - 0.25);
      k.ob(bw, bh, 0.5, x, h + bh / 2, z);
      k.box(trim, bw, bh, 0.5, x, h + bh / 2, z);
      rebarK(k, 3, 0.9, [x, h + bh, z], false);
    }
    k.ob(w * 0.6, 0.4, d * 0.5, w * 0.15, h + 0.8, 0, 0, 0, 0.25);
    k.box(trim, w * 0.6, 0.4, d * 0.5, w * 0.15, h + 0.8, 0, 0, 0, 0.25);
  } else {
    // 屋頂機房、水塔與空調
    k.ob(w * 0.3, 2.2, d * 0.3, -w * 0.2, h + 1.1, d * 0.15);
    k.box(trim, w * 0.3, 2.2, d * 0.3, -w * 0.2, h + 1.1, d * 0.15);
    k.cyl(trim, 1.1, 1.1, 1.4, w * 0.22, h + 1.3, -d * 0.2, 0, 0, 0, 8);
    for (const s of [-1, 1]) k.box(DETAIL.dark, 0.12, 1.0, 0.12, w * 0.22 + s * 0.8, h + 0.5, -d * 0.2);
    k.box(DETAIL.dark, 1.4, 0.8, 1.0, w * 0.2, h + 0.7, d * 0.25);
  }
  // 水線的汙漬
  k.box(fadeMat(0x3e4a3e, { roughness: 1 }), w + 0.05, 1.2, d + 0.05, 0, 0.9, 0);
  return k.build();
}
// 外露的鋼筋（PK）：n 根、長 len，從 at 往上斜斜伸出；ob＝原本就有的鋼筋（算進外框）
function rebarK(k, n, len, at, ob = true) {
  const m = mat(0x5a3a2a, { roughness: 0.7, metalness: 0.6 });
  for (let i = 0; i < n; i++) {
    const a = [
      0.08,
      len,
      0.08,
      at[0] + (i - n / 2) * 0.35,
      at[1] + len / 2,
      at[2],
      0,
      0,
      (i % 2 ? 1 : -1) * 0.3,
    ];
    k.box(m, ...a);
    if (ob) k.ob(...a);
  }
  return k;
}
// 廢棄車輛：2 × 1.4 × 4.4（長沿 Z），原點在底面中心
export const CAR = [2, 1.5, 4.4];
export function buildWreckCar(color) {
  const glb = propGlb('wreck_car', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.4 }),
    dk = fadeMat(0x22262a, { roughness: 0.9 });
  const k = new PK().bounds(-1.077, -0.13, -2.2, 1.001, 1.771, 2.2); // 外框同原本
  k.at(0, 0, 0, 0, 0, 0.08, () => {
    // 側面輪廓（引擎蓋、擋風玻璃、車頂、後車廂）沿 X 擠出
    k.prism(
      m,
      [
        [-2.2, 0.25],
        [2.2, 0.25],
        [2.2, 0.95],
        [1.4, 1.05],
        [0.7, 1.55],
        [-0.9, 1.55],
        [-1.5, 1.05],
        [-2.2, 0.98],
      ],
      1.9,
      0,
      0,
      0,
      0,
      Math.PI / 2,
      0,
    );
    // 車窗（黑色）、保險桿、車燈、輪拱與車輪
    for (const s of [-1, 1]) k.box(dk, 0.04, 0.38, 1.4, s * 0.96, 1.28, 0.1);
    k.box(dk, 1.6, 0.4, 0.05, 0, 1.3, -1.06, 0.95, 0, 0);
    for (const z of [-2.22, 2.22]) k.box(dk, 2.0, 0.2, 0.12, 0, 0.42, z);
    for (const s of [-1, 1]) k.box(DETAIL.glass, 0.35, 0.12, 0.05, s * 0.65, 0.78, 2.23);
    for (const sx of [-0.85, 0.85])
      for (const sz of [-1.4, 1.4]) {
        k.cyl(dk, 0.35, 0.35, 0.3, sx, 0.3, sz, 0, 0, Math.PI / 2, 10);
        k.cyl(DETAIL.steel, 0.18, 0.18, 0.32, sx, 0.3, sz, 0, 0, Math.PI / 2, 6);
      }
  });
  return k.build();
}
// 半沉的公車：2.6 × 3 × 10（長沿 Z），原點在底面中心
export const BUS = [2.8, 2.6, 10];
export function buildSunkBus(color) {
  const glb = propGlb('sunk_bus', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.3 }),
    win = fadeMat(0x1d2326, { roughness: 0.3 });
  const k = new PK().bounds(-1.744, -0.729, -5.017, 1.315, 3.086, 5.158); // 外框同原本
  k.at(0, 0, 0, 0.06, 0, 0.18, () => {
    k.cb(m, 2.6, 2.8, 10, 0, 1.2, 0, 0, 0, 0, 0.2);
    // 窗帶（窗柱）、前後擋風、車門、車頂空調、行先牌、保險桿
    for (const s of [-1, 1]) {
      k.box(win, 0.05, 0.9, 8.6, s * 1.31, 1.9, 0);
      for (let z = -3.6; z <= 3.6; z += 1.2) k.box(m, 0.07, 0.9, 0.12, s * 1.32, 1.9, z);
      k.box(DETAIL.dark, 0.06, 0.12, 9.6, s * 1.31, 1.2, 0);
    }
    k.box(win, 2.2, 1.0, 0.05, 0, 1.9, -5.01);
    k.box(win, 2.0, 0.7, 0.05, 0, 2.0, 5.01);
    k.box(DETAIL.dark, 0.05, 1.8, 1.0, 1.31, 1.0, -3.6);
    k.cb(m, 1.6, 0.35, 2.4, 0, 2.75, 0.5, 0, 0, 0, 0.08);
    k.box(DETAIL.lamp, 1.6, 0.25, 0.05, 0, 2.48, -5.02);
    for (const z of [-5.05, 5.05]) k.box(DETAIL.dark, 2.5, 0.3, 0.1, 0, 0.1, z);
  });
  return k.build();
}
// 斷牆：w × h × 0.8（沿 X），原點在底面中心；頂部呈階梯狀崩落
export function buildRuinWall(w, h, color) {
  const glb = propGlb('ruin_wall', { color, ref: [6, 3.5, 0.8], size: [w, h, 0.8], fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.95 });
  const k = new PK();
  const n = 4;
  for (let i = 0; i < n; i++) {
    const hh = h * (1 - Math.abs(i - 1.2) * 0.22);
    const x = -w / 2 + (w / n) * (i + 0.5);
    k.ob(w / n, hh, 0.8, x, hh / 2, 0); // 外框同原本
    k.cb(m, w / n, hh, 0.8, x, hh / 2, 0, 0, 0, 0, 0.06);
    if (i === 1 || i === 3) rebarK(k, 2, 0.7, [x, hh, 0], false);
  }
  // 樓板的殘邊與窗洞
  k.box(m, w, 0.3, 0.9, 0, h * 0.55, 0);
  k.box(DETAIL.black, w * 0.18, h * 0.25, 0.84, -w * 0.12, h * 0.3, 0);
  return k.build();
}
// 彎折的路燈：原點在底面中心
export function buildBentLamp(h) {
  const glb = propGlb('bent_lamp', { ref: [2, 7, 1], size: [2, h, 1] });
  if (glb) return glb;
  const m = mat(0x4a4f52, { roughness: 0.6, metalness: 0.5 });
  const k = new PK();
  // 外框同原本（下段的桿＋折彎的上段與燈頭）
  k.ob(0.25, h * 0.6, 0.25, 0, h * 0.3, 0);
  k.at(0, h * 0.6, 0, 0, 0, -0.9, () =>
    k.ob(0.22, h * 0.4, 0.22, 0, h * 0.2, 0).ob(0.8, 0.25, 0.4, 0.3, h * 0.4, 0),
  );
  // 呼叫端會任意旋轉：零件分到原本的零件上（下段 0、上段 1、燈頭 2）
  k.cur = 0;
  k.cb(m, 0.25, 0.3, 0.25, 0, 0.15, 0, 0, 0, 0, 0.04);
  k.cyl(m, 0.1, 0.12, h * 0.6, 0, h * 0.3, 0, 0, 0, 0, 6);
  k.cb(m, 0.2, 0.36, 0.1, 0, 1.4, 0.07, 0, 0, 0, 0.02);
  k.at(0, h * 0.6, 0, 0, 0, -0.9, () => {
    k.inPart(1, () => k.cyl(m, 0.09, 0.1, h * 0.4, 0, h * 0.2, 0, 0, 0, 0, 6));
    k.inPart(2, () => {
      k.cb(mat(0x9aa0a0), 0.8, 0.22, 0.4, 0.3, h * 0.4, 0, 0, 0, 0, 0.05);
      k.box(DETAIL.glass, 0.6, 0.04, 0.28, 0.3, h * 0.4 - 0.12, 0);
    });
  });
  return k.build();
}
// 瓦礫堆（純裝飾）
export function buildRubble(s) {
  const glb = propGlb('rubble', { ref: [3, 1.2, 3], size: [3 * s, 1.2 * s, 3 * s] });
  if (glb) return glb;
  const m = mat(0x6a6c68, { roughness: 1 });
  const k = new PK();
  for (let i = 0; i < 5; i++) {
    const a = [
      s * (0.6 + (i % 3) * 0.3),
      s * 0.4,
      s * (0.5 + (i % 2) * 0.4),
      (i - 2) * s * 0.35,
      s * 0.2,
      (((i * 7) % 5) - 2) * s * 0.25,
      i * 0.3,
      i * 0.9,
      i * 0.2,
    ];
    k.box(m, ...a);
    k.ob(...a); // 外框同原本
  }
  rebarK(k, 2, s * 0.8, [0, s * 0.2, 0], false);
  return k.build();
}
// 漂浮雜物（純裝飾，浮在水面）：木板＋油桶（桶箍）
export function buildFloatJunk() {
  const glb = propGlb('float_junk');
  if (glb) return glb;
  const k = new PK().bounds(-0.7, -0.25, -0.45, 1.35, 0.45, 0.65); // 外框同原本
  const wood = mat(0x6b5a44, { roughness: 1 }),
    drum = mat(0x7a3c2a, { roughness: 0.8 });
  for (const z of [-0.3, 0, 0.3]) k.box(wood, 1.4, 0.15, 0.26, 0, 0, z);
  k.box(wood, 0.15, 0.08, 0.9, -0.4, 0.1, 0);
  k.cyl(drum, 0.35, 0.35, 0.9, 0.9, 0.1, 0.3, 0, 0, Math.PI / 2, 8);
  for (const x of [0.62, 1.18]) k.cyl(DETAIL.dark, 0.37, 0.37, 0.05, x, 0.1, 0.3, 0, 0, Math.PI / 2, 8);
  return k.build();
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
registerFeatureStyle('flooded', C, {
  deck(w, d, thick, rotY, C) {
    const dm = fadeMat(C.deck, { roughness: 0.9 }),
      tm = fadeMat(C.trim, { roughness: 0.9 });
    const L = rotY ? d : w,
      D = rotY ? w : d;
    const k = new PK();
    k.ob(w, thick, d, 0, -thick / 2, 0);
    {
      const n = Math.max(3, Math.round(L / 3));
      for (const s of [-1, 1])
        for (let i = 0; i < n; i++) {
          if ((i * 5 + (s > 0 ? 2 : 0)) % 4 === 0) continue;
          const at = -L / 2 + (L / n) * (i + 0.5);
          if (rotY) k.ob(0.35, 0.9, L / n - 0.1, s * (w / 2 - 0.2), 0.45, at);
          else k.ob(L / n - 0.1, 0.9, 0.35, at, 0.45, s * (d / 2 - 0.2));
        }
    }
    rebarK(k, 5, 1.2, rotY ? [0, -thick, d / 2] : [w / 2, -thick, 0]);
    k.at(0, 0, 0, 0, rotY ? -Math.PI / 2 : 0, 0, () => {
      k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, Math.min(0.1, thick * 0.2));
      // 高架道路的紐澤西護欄（有缺口）＋褪色的車道線
      const n = Math.max(3, Math.round(L / 3));
      for (const s of [-1, 1])
        for (let i = 0; i < n; i++) {
          if ((i * 5 + (s > 0 ? 2 : 0)) % 4 === 0) continue; // 護欄缺口
          const at = -L / 2 + (L / n) * (i + 0.5);
          k.prism(
            tm,
            [
              [-0.2, 0],
              [0.2, 0],
              [0.08, 0.35],
              [0.08, 0.9],
              [-0.08, 0.9],
              [-0.08, 0.35],
            ],
            L / n - 0.1,
            at,
            0,
            s * (D / 2 - 0.2),
            0,
            Math.PI / 2,
            0,
          );
        }
      k.box(fadeMat(0xb8b49a, { roughness: 1 }), L * 0.7, 0.02, 0.15, -L * 0.1, 0.01, 0);
    });
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().ob(r * 1.7, h, r * 1.7); // 外框同原本（柱＋柱頂的鋼筋）
    const m = mat(C.pillar, { roughness: 0.95 });
    k.cb(m, r * 1.7, h, r * 1.7, 0, 0, 0, 0, 0, 0, Math.min(0.12, r * 0.2));
    k.box(mat(0x3e4a3e, { roughness: 1 }), r * 1.72, 1.0, r * 1.72, 0, -h / 2 + 0.7, 0);
    k.box(DETAIL.dark, r * 1.72, 0.15, r * 1.72, 0, h / 2 - 0.6, 0);
    rebarK(k, 3, 0.8, [0, h / 2 - 0.2, r * 0.6]);
    return k.build();
  },
  wall(w, h, d, C) {
    const m = fadeMat(C.wall, { roughness: 1 });
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    const k = new PK();
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L, h, T); // 外框同原本
      // 磚牆：崩落的頂部、磚縫（凹線）、混凝土的楣樑
      const n = 5;
      for (let i = 0; i < n; i++) {
        const hh = h * (1 - (i % 3) * 0.18);
        const at = -L / 2 + (L / n) * (i + 0.5);
        k.box(m, L / n, hh, T, at, (hh - h) / 2, 0);
      }
      const dk = fadeMat(0x5a3a2e, { roughness: 1 });
      for (let y = -h / 2 + 0.5; y < h / 2 - h * 0.36; y += 0.5)
        for (const s of [-1, 1]) k.box(dk, L - 0.1, 0.04, 0.02, 0, y, s * (T / 2 + 0.01));
      k.box(fadeMat(0x8a8c86, { roughness: 1 }), L + 0.1, 0.35, T + 0.1, 0, -h / 2 + 0.17, 0);
    });
    return k.build();
  },
  platform(w, h, d, C) {
    // 塌落的樓板：幾層錯開的板，頂面平整（碰撞同方盒）；板與板之間的殘柱
    const m = fadeMat(C.plat, { roughness: 0.95 });
    const k = new PK();
    const n = Math.max(2, Math.round(h / 2));
    for (let i = 0; i < n; i++) {
      const s = 1 - (n - 1 - i) * 0.04;
      k.cb(
        m,
        w * s,
        h / n - 0.15,
        d * s,
        (i % 2 ? 0.3 : -0.3) * (1 - s) * 10,
        (h / n) * (i + 0.5),
        0,
        0,
        0,
        0,
        0.08,
      );
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        k.box(m, 0.5, h - 0.3, 0.5, sx * (w / 2 - 1.2), (h - 0.3) / 2 + 0.075, sz * (d / 2 - 1.2));
    rebarK(k, 6, 1, [0, h - 0.2, d / 2 - 0.3], false);
    return k.build();
  },
  ramp(rw, rd) {
    const k = new PK().ob(rw, 0.45, rd); // 外框同原本（瓦礫畫在外框外）
    const m = mat(0x6a6c68, { roughness: 1 });
    k.cb(m, rw, 0.45, rd, 0, 0, 0, 0, 0, 0, 0.08);
    const along = rw >= rd;
    for (let i = 0; i < 4; i++) {
      const t = (i - 1.5) * 0.22;
      k.box(
        m,
        along ? 0.8 : 0.6,
        0.25,
        along ? 0.6 : 0.8,
        along ? t * rw : (i % 2 ? 0.25 : -0.25) * rw,
        0.3,
        along ? (i % 2 ? 0.25 : -0.25) * rd : t * rd,
        0.2,
        i,
        0.1,
      );
    }
    return k.build();
  },
  tunnel(C) {
    const k = new PK().bounds(-12, -2, -11, 12, 12, 1.45); // 外框同原本
    const m = mat(0x5d605c, { roughness: 0.95 });
    k.cb(mat(C.rock, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
    k.cb(m, 14, 9, 2.5, 0, 4.5, 0, 0, 0, 0, 0.15);
    k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
    k.cb(mat(C.trim, { roughness: 0.95 }), 9.2, 0.7, 2.7, 0, 6.85, 0, 0, 0, 0, 0.08);
    k.box(mat(0x2a5a8a), 6, 1.2, 0.3, 0, 7.8, 1.3); // 地下道的路牌
    k.box(mat(0xd8dcd8), 4.6, 0.12, 0.05, 0, 7.8, 1.46);
    k.box(mat(0x3e4a3e, { roughness: 1 }), 14.05, 1.2, 2.55, 0, 0.6, 0);
    return k.build();
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
  w.addDecor(Math.round(26 * w.kk), () => buildRubble(rnd(0.6, 1.4)), 0.2);
  // 漂浮雜物：只放在水面上（地形低於水面的地方）
  for (let i = 0, n = Math.round(30 * w.kk); i < n; i++) {
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
