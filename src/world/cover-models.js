// 現實尺寸的掩體與雜物（機甲三倍高改版，docs/world-scale.md）：純函式、不使用亂數，參數由關卡生成以亂數決定。
// 尺寸照現實（機甲 9.7 m 時的分級：雜物 ≤ 2 m、低掩體 2–4 m、半身 4–7 m、全身 ≥ 10 m），
// 人會用到的細節（門、樓梯、爬梯、欄杆、窗）照 HUMAN 的尺寸，並以 k.mark 標出（之後的小人互動）。
// 原點一律在底面中心；回傳的群組可直接交給 World.addSmall／addBig（碰撞外框由呼叫端依回傳的尺寸登記）。
import {
  DETAIL,
  HUMAN,
  PK,
  door,
  fadeMat,
  hazard,
  humanLadder,
  mat,
  propGlb,
  railing,
  windowRows,
} from './prop-models.js';
import { D } from '../render/detail.js';
import { vCab, vExhaust, vLamp, vMirror, vWheel } from '../render/vehicle-kit.js';

// ---------- 防爆 T 型牆（低掩體，成排）：每片寬 1.52、高 3.66 m，底座深 1.2 m；n 片沿 X 排成一列 ----------
export const TWALL = { w: 1.52, h: 3.66, d: 1.2 };
export function buildTWall(n, color = 0x8c8a84) {
  const len = n * TWALL.w;
  const glb = propGlb('t_wall', {
    color,
    ref: [TWALL.w * 4, TWALL.h, TWALL.d],
    size: [len, TWALL.h, TWALL.d],
    fade: true,
  });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.95, metalness: 0.02 });
  const k = new PK().bounds(-len / 2, 0, -TWALL.d / 2, len / 2, TWALL.h, TWALL.d / 2);
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + TWALL.w * (i + 0.5);
    // 倒 T 斷面：底座＋直立的牆身（上端略收），頂部兩個吊環，片與片之間留 2 cm 縫
    k.cb(m, TWALL.w - 0.02, 0.35, TWALL.d, x, 0.175, 0, 0, 0, 0, 0.04);
    k.prism(
      m,
      [
        [-0.17, 0.3],
        [0.17, 0.3],
        [0.11, TWALL.h],
        [-0.11, TWALL.h],
      ],
      TWALL.w - 0.02,
      x,
      0,
      0,
      0,
      Math.PI / 2,
      0,
    );
    for (const s of [-0.35, 0.35]) k.box(DETAIL.steel, 0.04, 0.12, 0.12, x + s, TWALL.h + 0.05, 0);
  }
  return k.build();
}

// ---------- 紐澤西護欄（雜物）：每段長 3.0、高 0.81 m，底寬 0.61 m；n 段沿 X ----------
export const JERSEY = { l: 3.0, h: 0.81, d: 0.61 };
export function buildJersey(n, color = 0xc8c4bc) {
  const len = n * JERSEY.l;
  const glb = propGlb('barrier', {
    color,
    ref: [4, 1.1, 0.9], // GLB（prop/barrier）的製作尺寸＝variants.js 的 buildBarrier（長 4 m）
    size: [len, JERSEY.h, JERSEY.d],
  });
  if (glb) return glb;
  const m = mat(color, { roughness: 0.95, metalness: 0.02 });
  const k = new PK().bounds(-len / 2, 0, -JERSEY.d / 2, len / 2, JERSEY.h, JERSEY.d / 2);
  for (let i = 0; i < n; i++)
    k.prism(
      m,
      [
        [-0.305, 0],
        [0.305, 0],
        [0.305, 0.08],
        [0.2, 0.33],
        [0.075, 0.81],
        [-0.075, 0.81],
        [-0.2, 0.33],
        [-0.305, 0.08],
      ],
      JERSEY.l - 0.03,
      -len / 2 + JERSEY.l * (i + 0.5),
      0,
      0,
      0,
      Math.PI / 2,
      0,
    );
  return k.build();
}

// ---------- 倉庫／廠房（全身掩體）：寬 w（沿 X）× 深 d × 簷高 h，緩斜的雙坡屋頂（屋脊沿 X）----------
// 長邊（±Z）各有 doors 扇捲門（寬 5、高 5 m）＋旁邊的人用門；窗帶在 3 m 以上；屋頂有通風器、外牆有落水管。
// 回傳群組；碰撞＝w × (屋脊高) × d 的方塊（ridgeH 由 warehouseRidge 算）
export const warehouseRidge = (d, h) => h + Math.min(3, d * 0.06);
export function buildWarehouse(w, d, h, color = 0x8a9096, opts = {}) {
  const rh = warehouseRidge(d, h);
  const glb = propGlb('warehouse', { color, ref: [40, 13, 24], size: [w, rh, d], fade: true });
  if (glb) return glb;
  const wall = fadeMat(color, { roughness: 0.75, metalness: 0.35 }),
    roof = fadeMat(opts.roof || 0x5a6066, { roughness: 0.7, metalness: 0.4 }),
    trim = fadeMat(0x3a3f45, { roughness: 0.7, metalness: 0.4 }),
    base = fadeMat(0x7c7a74, { roughness: 0.95 }),
    D = DETAIL;
  const k = new PK().bounds(-w / 2, 0, -d / 2, w / 2, rh, d / 2);
  // 混凝土基礎牆（1.2 m）＋浪板牆面（直向肋）
  k.box(base, w, 1.2, d, 0, 0.6, 0);
  k.box(wall, w - 0.1, h - 1.2, d - 0.1, 0, 1.2 + (h - 1.2) / 2, 0);
  for (const sz of [-1, 1]) {
    const nr = Math.floor(w / 0.9);
    for (let i = 0; i <= nr; i++)
      k.box(wall, 0.12, h - 1.3, 0.06, -w / 2 + (w / nr) * i, 1.2 + (h - 1.3) / 2, sz * (d / 2 - 0.02));
  }
  for (const sx of [-1, 1]) {
    const nr = Math.floor(d / 0.9);
    for (let i = 0; i <= nr; i++)
      k.box(wall, 0.06, h - 1.3, 0.12, sx * (w / 2 - 0.02), 1.2 + (h - 1.3) / 2, -d / 2 + (d / nr) * i);
    // 山牆（三角形）
    k.prism(
      wall,
      [
        [-d / 2, h],
        [d / 2, h],
        [0, rh],
      ],
      0.1,
      sx * (w / 2 - 0.05),
      0,
      0,
      0,
      Math.PI / 2,
      0,
    );
  }
  // 屋頂兩片＋屋脊蓋＋簷口與落水管
  const half = d / 2 + 0.4,
    a = Math.atan2(rh - h, d / 2),
    sl = half / Math.cos(a);
  for (const s of [-1, 1]) {
    k.box(roof, w + 0.6, 0.12, sl, 0, (h + rh) / 2 + 0.06, (s * d) / 4 + s * 0.1, s * a, 0, 0);
    k.box(trim, w + 0.6, 0.18, 0.18, 0, h - 0.05, s * (d / 2 + 0.35));
    for (const x of [-w / 2 + 0.6, w / 2 - 0.6])
      k.box(trim, 0.14, h - 0.2, 0.14, x, (h - 0.2) / 2, s * (d / 2 + 0.12));
  }
  k.box(trim, w + 0.6, 0.3, 0.5, 0, rh + 0.05, 0);
  // 屋頂通風器
  for (let x = -w / 2 + 6; x < w / 2 - 4; x += 8) k.cyl(trim, 0.45, 0.55, 0.9, x, rh + 0.4, 0, 0, 0, 0, 8);
  // 長邊的捲門（5 × 5 m）、人用門與窗帶
  const nd = opts.doors === undefined ? Math.max(1, Math.floor(w / 18)) : opts.doors;
  for (const sz of [-1, 1]) {
    const z = sz * (d / 2 + 0.03),
      ry = sz > 0 ? 0 : Math.PI;
    for (let i = 0; i < nd; i++) {
      const x = -w / 2 + (w / nd) * (i + 0.5);
      k.at(x, 0, z, 0, ry, 0, () => {
        k.box(trim, 5.4, 5.3, 0.2, 0, 2.65, 0);
        k.box(D.steel, 5, 5, 0.08, 0, 2.5, 0.08);
        for (let y = 0.4; y < 5; y += 0.5) k.box(D.dark, 5, 0.04, 0.04, 0, y, 0.13);
        k.box(trim, 5.6, 0.5, 0.6, 0, 5.55, 0.25); // 捲門箱
        hazard(k, D.yellow, D.black, 5, 0.25, 0, 0.13, 0.14);
        k.mark(`door_roll_${sz > 0 ? 'n' : 's'}${i}`, 0, 0, 0.5, 0);
        // 旁邊的人用門＋門燈
        door(
          k,
          trim,
          D.steel,
          4.2,
          0,
          0.05,
          0,
          HUMAN.door[0],
          HUMAN.door[1],
          `door_${sz > 0 ? 'n' : 's'}${i}`,
        );
        k.box(D.lamp, 0.35, 0.12, 0.2, 4.2, 2.55, 0.12);
      });
    }
    windowRows(k, D.glass, trim, w - 4, 1, h, 0, h - 3.2, z, ry, 2.4);
  }
  // 一端（+X）的外爬梯上屋頂
  humanLadder(k, D.steel, h, w / 2 + 0.02, 0, d / 2 - 2, Math.PI / 2, true, 'ladder_roof');
  if (opts.sign !== false) k.box(D.yellow, Math.min(8, w * 0.3), 1.2, 0.08, -w * 0.25, h - 1.4, d / 2 + 0.08);
  return k.build();
}

// ---------- 混凝土擋牆（半身掩體）：長 len（沿 X）、高 h，背面（−Z）有扶壁，正面頂部有壓頂與欄杆 ----------
export function buildRetainWall(len, h, color = 0x8a8880) {
  const glb = propGlb('retain_wall', { color, ref: [20, 5, 1.6], size: [len, h, 1.6], fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.95 });
  const k = new PK().bounds(-len / 2, 0, -0.8, len / 2, h + HUMAN.rail, 0.8);
  k.box(m, len, h, 0.5, 0, h / 2, 0.2);
  k.box(m, len + 0.2, 0.25, 0.7, 0, h + 0.12, 0.2);
  for (let x = -len / 2 + 2; x <= len / 2 - 2; x += 4)
    k.prism(
      m,
      [
        [0, 0],
        [0.9, 0],
        [0, h * 0.9],
      ],
      0.35,
      x,
      0,
      -0.05,
      0,
      Math.PI / 2,
      0,
    );
  // 伸縮縫與排水孔
  for (let x = -len / 2 + 5; x < len / 2; x += 5) k.box(DETAIL.dark, 0.04, h, 0.04, x, h / 2, 0.46);
  for (let x = -len / 2 + 2.5; x < len / 2; x += 5)
    k.cyl(DETAIL.dark, 0.06, 0.06, 0.1, x, 0.6, 0.47, Math.PI / 2, 0, 0, 6);
  railing(k, DETAIL.steel, len - 0.4, HUMAN.rail, 0, h + 0.25, 0.4, 0, 1.5, 0.05);
  return k.build();
}

// ---------- 車輛（雜物，現實尺寸）----------
// 小客車 4.5 × 1.5 × 1.8 m（長沿 Z、車頭朝 −Z）
export const CAR = [1.8, 1.5, 4.5];
export function buildCar(color) {
  const glb = propGlb('car', { color, ref: CAR, size: CAR });
  if (glb) return glb;
  const body = mat(color, { roughness: 0.4, metalness: 0.5 }),
    Dt = DETAIL,
    M = vkMats();
  const k = new PK().bounds(-0.9, 0, -2.25, 0.9, 1.5, 2.25).tint(VEH_TINT);
  const HP = Math.PI / 2;
  // 車身側面的輪廓（u＝往前、y），沿 X 擠出；輪拱是往上的半圓缺口
  const arch = (uc, r, yc) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI - (i / 8) * Math.PI;
      pts.push([uc + Math.cos(a) * r, yc + Math.sin(a) * r]);
    }
    return pts;
  };
  const lower = [
    [-2.2, 0.3],
    ...arch(-1.4, 0.42, 0.33),
    ...arch(1.4, 0.42, 0.33),
    [2.2, 0.3],
    [2.27, 0.45],
    [2.25, 0.68],
    [2.08, 0.84],
    [1.2, 0.95],
    [-1.9, 0.98],
    [-2.22, 0.9],
    [-2.27, 0.6],
  ];
  k.geo(body, D.extrude(lower, 1.78, 0.05), 0, 0, 0, 0, HP, 0);
  const cabin = [
    [-1.72, 0.94],
    [1.08, 0.94],
    [0.35, 1.47],
    [-1.15, 1.5],
    [-1.74, 1.04],
  ];
  k.geo(body, D.extrude(cabin, 1.5, 0.06), 0, 0, 0, 0, HP, 0);
  // 玻璃：擋風、後窗、側窗
  k.box(Dt.glass, 1.36, 0.03, 0.84, 0, 1.268, -0.765, -0.62, 0, 0);
  k.box(Dt.glass, 1.34, 0.03, 0.7, 0, 1.33, 1.495, 0.66, 0, 0);
  const win = [
    [-1.52, 1.0],
    [0.95, 1.0],
    [0.36, 1.41],
    [-1.1, 1.44],
    [-1.52, 1.07],
  ];
  for (const s2 of [-1, 1]) {
    k.geo(Dt.glass, D.extrude(win, 0.02), s2 * 0.758, 0, 0, 0, HP, 0);
    k.box(body, 0.03, 0.46, 0.1, s2 * 0.772, 1.21, 0.3); // B 柱
  }
  // 保險桿、水箱護罩、底盤
  k.cb(Dt.dark, 1.82, 0.22, 0.2, 0, 0.42, -2.2, 0, 0, 0, 0.06);
  k.cb(Dt.dark, 1.82, 0.22, 0.2, 0, 0.42, 2.2, 0, 0, 0, 0.06);
  k.cb(Dt.black, 0.9, 0.2, 0.04, 0, 0.64, -2.25, 0, 0, 0, 0.02);
  k.box(Dt.dark, 1.5, 0.14, 3.4, 0, 0.28, 0);
  // 燈
  for (const sx of [-1, 1]) {
    vLamp(k, M, Dt.lamp, sx * 0.64, 0.7, -2.21, 0.34, 0.13);
    vLamp(k, M, Dt.red, sx * 0.66, 0.8, 2.25, 0.3, 0.12, Math.PI);
    vMirror(k, M, sx * 0.78, 1.04, -0.92, sx, 0.12);
    // 車輪
    for (const sz of [-1.4, 1.4]) vWheel(k, M, sx * 0.78, 0.33, sz, 0.33, 0.22, { lugs: 24, depth: 0.012 });
  }
  // 小細節：門縫、把手、車牌、護罩的橫條、排氣管
  k.fine(() => {
    for (const sx of [-1, 1]) {
      for (const z of [-0.88, 0.3, 1.35]) k.box(Dt.black, 0.01, 0.52, 0.015, sx * 0.9, 0.68, z);
      for (const z of [-0.15, 1.0]) k.box(Dt.steel, 0.025, 0.035, 0.16, sx * 0.9, 0.86, z);
    }
    for (const z of [-2.3, 2.31]) k.box(Dt.white, 0.5, 0.12, 0.015, 0, 0.45, z);
    for (const y of [0.6, 0.66, 0.72]) k.box(Dt.steel, 0.84, 0.015, 0.02, 0, y, -2.27);
    k.cyl(Dt.steel, 0.035, 0.035, 0.25, 0.5, 0.26, 2.2, HP, 0, 0, 8);
  });
  return k.build();
}
// 地圖物件的車輛零件用的材質（render/vehicle-kit.js 的 M）
function vkMats() {
  const Dt = DETAIL;
  return { joint: Dt.dark, rubber: Dt.rubber, gun: Dt.steel, lens: Dt.glass, sub: Dt.dark, main3: Dt.dark };
}
const VEH_TINT = { ao: 0.85, grime: 0.32, gh: 0.9 };
// 公車 12 × 3.2 × 2.5 m（長沿 Z、車頭朝 −Z）
export const BUS = [2.5, 3.2, 12];
export function buildBus(color) {
  const glb = propGlb('bus', { color, ref: BUS, size: BUS, fade: true });
  if (glb) return glb;
  const body = fadeMat(color, { roughness: 0.5, metalness: 0.4 }),
    Dt = DETAIL,
    M = vkMats(),
    HP = Math.PI / 2;
  const k = new PK().bounds(-1.25, 0, -6, 1.25, 3.2, 6).tint(VEH_TINT);
  // 車身：側面輪廓（有輪拱）沿 X 擠出；u＝往前（z＝−u）
  const arch = (uc) => {
    const pts = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI - (i / 8) * Math.PI;
      pts.push([uc + Math.cos(a) * 0.62, 0.5 + Math.sin(a) * 0.62]);
    }
    return pts;
  };
  k.geo(
    body,
    D.extrude([[-5.85, 0.5], ...arch(-3.6), ...arch(4), [5.85, 0.5], [5.85, 3.0], [-5.85, 3.0]], 2.2, 0.15),
    0,
    0,
    0,
    0,
    HP,
    0,
  );
  // 窗帶（玻璃）與窗柱、前後的大玻璃
  for (const s2 of [-1, 1]) {
    k.box(Dt.glass, 0.03, 0.95, 10.6, s2 * 1.255, 2.25, 0.3);
    for (let z = -4.9; z < 5.7; z += 1.32) k.box(body, 0.05, 0.98, 0.12, s2 * 1.265, 2.25, z);
    k.box(body, 0.05, 0.12, 10.6, s2 * 1.265, 1.72, 0.3); // 窗下緣
  }
  k.box(Dt.glass, 2.3, 1.4, 0.05, 0, 2.15, -6.01, 0.06, 0, 0);
  k.box(Dt.glass, 2.1, 0.8, 0.05, 0, 2.4, 6.01);
  // 車門（前面右側：兩片折門）
  k.box(Dt.dark, 0.9, 2.1, 0.04, 0.6, 1.4, -6.02); // 前門
  k.mark('door_bus', 0.6, 0.3, -6.3, Math.PI);
  for (const s2 of [-1, 1]) k.box(Dt.glass, 0.38, 1.2, 0.05, 0.6 + s2 * 0.2, 1.75, -6.04);
  // 車頂：冷氣機、行先表示器（發光）
  k.geo(Dt.white, D.box(1.6, 0.3, 2.4, 0.08), 0, 3.28, 0.8);
  k.geo(Dt.lamp, D.box(1.6, 0.22, 0.04, 0.01), 0, 2.98, -6.03);
  // 燈、保險桿、後照鏡
  for (const s2 of [-1, 1]) {
    vLamp(k, M, Dt.lamp, s2 * 0.95, 0.85, -6.03, 0.3, 0.16);
    vLamp(k, M, Dt.red, s2 * 1.0, 1.0, 6.03, 0.22, 0.4, Math.PI);
    vMirror(k, M, s2 * 1.25, 2.6, -5.8, s2, 0.45);
  }
  k.geo(Dt.dark, D.box(2.54, 0.3, 0.2, 0.05), 0, 0.5, -6.05);
  k.geo(Dt.dark, D.box(2.54, 0.3, 0.2, 0.05), 0, 0.5, 6.05);
  // 車輪（前 1 軸、後 1 軸）與輪拱的暗色
  for (const sx of [-1.05, 1.05])
    for (const sz of [-4, 3.6]) {
      vWheel(k, M, sx * 1.02, 0.5, sz, 0.5, 0.32, { lugs: 20, depth: 0.02 });
    }
  k.fine(() => {
    // 雨刷、車身的面板縫、引擎室的散熱格柵（車尾）
    for (const x of [-0.5, 0.5]) k.box(Dt.black, 0.9, 0.03, 0.03, x, 1.55, -6.06, 0, 0, 0.5);
    for (const s2 of [-1, 1])
      for (const z of [-2.5, 1.2]) k.box(Dt.black, 0.01, 1.0, 0.015, s2 * 1.26, 1.1, z);
    for (let i = 0; i < 6; i++) k.box(Dt.black, 1.6, 0.03, 0.02, 0, 1.0 + i * 0.1, 6.04);
    k.geo(Dt.steel, D.cyl(0.05, 0.05, 0.3, 8), 0.9, 0.35, 6.0, HP, 0, 0);
  });
  return k.build();
}
// 聯結車（曳引車＋貨櫃拖車）16.5 × 4.0 × 2.5 m（長沿 Z、車頭朝 −Z）；cm＝拖車上貨櫃的材質
export const SEMI = [2.5, 4.0, 16.5];
export function buildSemiTruck(cm, cab = 0xd8d8d8) {
  const glb = propGlb('parked_truck', { color: cm.color.getHex(), ref: SEMI, size: SEMI, fade: true });
  if (glb) return glb;
  const Dt = DETAIL,
    cb = mat(cab, { roughness: 0.45, metalness: 0.4 }),
    M = vkMats(),
    HP = Math.PI / 2;
  const k = new PK().bounds(-1.25, 0, -8.25, 1.25, 4.0, 8.25).tint(VEH_TINT);
  // 曳引車：平頭駕駛室＋車頂導流罩、排氣管、油箱、底盤與第五輪
  vCab(k, M, -5.5, -8.2, 2.45, 0.9, 3.15, { body: cb, glass: Dt.glass, lamp: Dt.lamp, amber: Dt.yellow });
  k.geo(
    cb,
    D.extrude(
      [
        [0, 3.1],
        [1.6, 3.1],
        [1.3, 3.75],
        [0, 3.8],
      ],
      2.3,
      0.06,
    ),
    0,
    0,
    -5.6,
    0,
    HP,
    0,
  );
  for (const s2 of [-1, 1]) {
    vExhaust(k, M, s2 * 1.12, 1.1, -5.35, 2.6, 0.09);
    k.geo(
      Dt.steel,
      D.lathe(
        [
          [0, -0.6],
          [0.32, -0.58],
          [0.34, -0.5],
          [0.34, 0.5],
          [0.32, 0.58],
          [0, 0.6],
        ],
        16,
      ),
      s2 * 1.0,
      0.75,
      -4.95,
      0,
      0,
      HP,
    );
  }
  k.box(Dt.dark, 1.0, 0.3, 4.6, 0, 0.95, -4.6); // 底盤
  k.geo(Dt.steel, D.cyl(0.8, 0.8, 0.1, 18), 0, 1.15, -4.3);
  // 拖車：40 呎貨櫃＋底架、支撐腳、尾燈、防鑽撞桿
  k.box(Dt.dark, 2.4, 0.3, 12.4, 0, 1.15, 1.9);
  k.at(0, 1.3, 1.9, 0, Math.PI / 2, 0, () => containerKitRef(k, cm));
  for (const s2 of [-1, 1]) {
    k.box(Dt.dark, 0.14, 0.9, 0.14, s2 * 0.9, 0.55, -2.8);
    k.box(Dt.dark, 0.35, 0.06, 0.35, s2 * 0.9, 0.08, -2.8);
    vLamp(k, M, Dt.red, s2 * 1.0, 0.95, 8.12, 0.22, 0.12, Math.PI);
  }
  k.box(Dt.dark, 2.3, 0.12, 0.12, 0, 0.6, 8.1);
  // 車輪：前輪、驅動軸 2 軸、拖車 2 軸（雙輪）
  for (const sx of [-1, 1]) {
    vWheel(k, M, sx * 1.0, 0.52, -7.55, 0.52, 0.32, { lugs: 14, depth: 0.035 });
    // 雙輪：外側是完整的車輪，內側只有輪胎（看不太到）
    for (const sz of [-5.6, -4.4, 5.4, 6.7]) {
      vWheel(k, M, sx * 1.0, 0.52, sz, 0.52, 0.3, { lugs: 14, depth: 0.035 });
      k.geo(Dt.rubber, D.cyl(0.52, 0.52, 0.28, 18, 0.04), sx * 0.68, 0.52, sz, 0, 0, HP);
    }
    k.box(Dt.rubber, 0.6, 0.5, 0.02, sx * 0.85, 0.6, 7.4);
  }
  k.fine(() => {
    // 支撐腳的搖柄、空氣管（駕駛室後到拖車）
    k.box(Dt.steel, 0.4, 0.03, 0.03, 1.1, 0.8, -2.8);
    for (const x of [-0.2, 0.2])
      k.geo(x < 0 ? Dt.red : Dt.yellow, D.cable([x, 1.6, -5.4], [x, 1.45, -4.05], 0.02, 0.15, 6), 0, 0, 0);
  });
  k.mark('door_cab', 1.3, 0.4, -6.8, Math.PI / 2);
  return k.build();
}
// 拖車上的 40 呎貨櫃（簡化：箱體＋框＋側肋），長邊沿 X
function containerKitRef(k, cm) {
  const L = 12.19,
    H = 2.59,
    W = 2.44,
    fm = DETAIL.dark;
  k.box(cm, L - 0.1, H - 0.2, W - 0.12, 0, H / 2, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(fm, 0.18, H, 0.18, sx * (L / 2 - 0.09), H / 2, sz * (W / 2 - 0.09));
  for (const y of [0.08, H - 0.08])
    for (const sz of [-1, 1]) k.box(fm, L, 0.16, 0.14, 0, y, sz * (W / 2 - 0.07));
  for (const sz of [-1, 1])
    for (let x = -L / 2 + 0.6; x < L / 2 - 0.3; x += 0.6)
      k.box(cm, 0.12, H - 0.36, 0.05, x, H / 2, sz * (W / 2 - 0.02));
}
