// 主題：多重水壩（AC6 貝利烏斯的多重水壩／牆）——橫貫地圖的壩體把戰場分成上游水庫與下游河谷；
// 閘門下方可通行、兩座沿壩體的坡道可上到壩頂
import { RNG, clamp, lerp, pick, rnd } from '../../core/math.js';
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
  ladder,
  grille,
} from './kit.js';
import { overlaps } from './flooded.js';

const WATER = -2,
  TOP = 14, // 壩頂高度
  THICK = 10, // 壩體厚度
  GATE_H = 7; // 閘門下方的通道高度

// ---------- 物件 ----------
// 壩體一段：長 len（沿 X）、厚 THICK、從 y0 到 TOP；dn＝下游方向（±1，扶壁朝下游）；原點在壩頂中心
export function buildDamSegment(len, y0, dn) {
  const glb = propGlb('dam_segment', {
    ref: [40, TOP - y0, THICK],
    size: [len, TOP - y0, THICK],
    y: y0 - TOP,
    rotY: dn > 0 ? 0 : Math.PI,
    fade: true,
  });
  if (glb) return glb;
  const H = TOP - y0;
  const m = fadeMat(0x8c8a84, { roughness: 0.95 }),
    dk = fadeMat(0x6a6862, { roughness: 1 }),
    rail = fadeMat(0x3d4044, { roughness: 0.7, metalness: 0.5 });
  const k = new PK();
  // 外框同原本（壩體、扶壁、步道、護欄、水漬線）
  k.bounds(
    -len / 2,
    Math.min(-H, WATER - TOP - 0.25),
    dn > 0 ? -THICK / 2 - 0.07 : -THICK / 2,
    len / 2,
    1,
    dn > 0 ? THICK / 2 : THICK / 2 + 0.07,
  );
  k.box(m, len, H, THICK - 3, 0, -H / 2, -dn * 1.5);
  // 下游面：漸縮的扶壁＋伸縮縫＋排水廊道口
  const fz = dn * (THICK / 2 - 3);
  for (let x = -len / 2 + 4; x < len / 2 - 2; x += 12) {
    k.prism(
      dk,
      [
        [0, -H],
        [-dn * 3, -H],
        [-dn * 1.2, -2],
        [0, -2],
      ],
      2.2,
      x,
      0,
      fz,
      0,
      Math.PI / 2,
      0,
    );
    if (x + 6 < len / 2) {
      k.box(dk, 0.18, H - 1, 0.1, x + 6, -H / 2 - 0.5, fz + dn * 0.05);
      k.box(DETAIL.black, 1.2, 1.6, 0.1, x + 6, -H + 2.2, fz + dn * 0.04);
    }
  }
  // 壩頂步道：路面＋路緣＋鋼欄杆
  k.box(m, len, 0.6, THICK, 0, -0.3, 0);
  for (const s of [-1, 1]) {
    k.box(m, len, 0.3, 0.5, 0, 0.15, s * (THICK / 2 - 0.25));
    railing(k, rail, len - 0.3, 0.66, 0, 0.3, s * (THICK / 2 - 0.15), 0, 2.4, 0.08);
  }
  // 上游面的水漬線
  k.box(fadeMat(0x4a5048, { roughness: 1 }), len, 1.5, 0.1, 0, WATER - TOP + 0.5, -dn * (THICK / 2 + 0.02));
  return k.build();
}
// 閘門：寬 gw 的開口上方的閘門結構（門楣＋捲揚機），原點在壩頂中心
export function buildDamGate(gw) {
  const glb = propGlb('dam_gate', { ref: [16, 9, THICK], size: [gw, 9, THICK], y: -GATE_H, fade: true });
  if (glb) return glb;
  const m = fadeMat(0x8c8a84, { roughness: 0.95 }),
    steel = fadeMat(0x4a5a66, { roughness: 0.6, metalness: 0.6 }),
    yel = fadeMat(0xd8a020, { roughness: 0.6 });
  const k = new PK().bounds(-gw / 2, -(TOP - GATE_H) - 1.2, -THICK / 2, gw / 2, 5.9, THICK / 2), // 外框同原本
    B = TOP - GATE_H;
  k.box(m, gw, B, THICK, 0, -B / 2, 0);
  // 拉起的閘門：下緣＋門扇的橫肋（露在開口上方）＋兩側的門槽
  k.cb(steel, gw - 1, 1.2, 0.6, 0, -B - 0.6, 0, 0, 0, 0, 0.1);
  for (const s of [-1, 1]) {
    k.box(steel, gw - 1, 0.25, 0.3, 0, -B + 0.6, s * 0.45);
    hazard(k, yel, DETAIL.black, gw - 1.2, 0.6, 0, -B + 0.4, s * (THICK / 2 + 0.03), s > 0 ? 0 : Math.PI);
  }
  // 捲揚機：兩座機架＋捲筒＋馬達＋鋼索；頂部的機房
  for (const s of [-1, 1]) {
    k.cb(steel, 1.2, 5, 1.6, s * (gw / 2 - 1.2), 2.5, 0, 0, 0, 0, 0.1);
    k.cyl(DETAIL.dark, 0.6, 0.6, 1.4, s * (gw / 2 - 2.4), 3.6, 0, 0, 0, Math.PI / 2, 10);
    k.cb(yel, 0.8, 0.7, 0.9, s * (gw / 2 - 3.5), 3.5, 0, 0, 0, 0, 0.06);
    k.pipe(DETAIL.dark, [s * (gw / 2 - 2.4), 3.0, 0.3], [s * (gw / 2 - 2.4), 0.2, 0.3], 0.05, 4);
    k.box(yel, gw * 0.4, 0.4, 0.4, 0, 0.6, s * (THICK / 2 - 0.3));
    k.box(DETAIL.red, 0.25, 0.25, 0.25, s * (gw / 2 - 1.2), 5.15, 0);
  }
  k.cb(steel, gw - 1.2, 1.4, 2.2, 0, 5.2, 0, 0, 0, 0, 0.12);
  for (let i = 0; i < 4; i++) k.box(DETAIL.dark, 0.08, 1.2, 2.25, -gw / 2 + 2 + ((gw - 4) / 3) * i, 5.2, 0);
  return k.build();
}
// 輸電鐵塔：高 h 的格子塔＋三層橫擔；原點在底面中心；GLB 以高 22 m 製作
export function buildPylon(h) {
  const glb = propGlb('power_pylon', { ref: [8, 22, 3], size: [8, h, 3], fade: true });
  if (glb) return glb;
  const m = fadeMat(0x8a9096, { roughness: 0.6, metalness: 0.6 });
  const k = new PK();
  const b0 = 1.6,
    b1 = 0.5;
  // 外框同原本（四支斜腳、三層橫擔與礙子）
  const ta = Math.atan2(b0 - b1, h);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      k.ob(0.22, h, 0.22, sx * ((b0 + b1) / 2), h / 2, sz * ((b0 + b1) / 2), -sz * ta, 0, sx * ta);
  for (const [y, wd] of [
    [h * 0.72, 7],
    [h * 0.84, 5.4],
    [h * 0.96, 3.6],
  ]) {
    k.ob(wd, 0.3, 0.3, 0, y, 0);
    for (const s of [-1, 1]) k.obCyl(0.12, 0.12, 0.9, (s * wd) / 2, y - 0.45, 0, 0, 0, 0, 6);
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(m, [sx * b0, 0, sz * b0], [sx * b1, h, sz * b1], 0.22);
  let yp = 0,
    i = 0;
  for (let y = 2; y < h - 1; y += 2.6, i++) {
    const a = lerp(b0, b1, y / h),
      ap = lerp(b0, b1, yp / h);
    for (const s of [-1, 1]) {
      k.box(m, a * 2, 0.12, 0.12, 0, y, s * a);
      k.box(m, 0.12, 0.12, a * 2, s * a, y, 0);
      // 兩個大面的斜撐（交錯）
      const f = i % 2 ? 1 : -1;
      k.bar(m, [-f * ap, yp, s * ap], [f * a, y, s * a], 0.08);
    }
    yp = y;
  }
  const ins = mat(0xd8e0e6, { roughness: 0.3 });
  for (const [y, wd] of [
    [h * 0.72, 7],
    [h * 0.84, 5.4],
    [h * 0.96, 3.6],
  ]) {
    // 橫擔：上下兩支弦材＋斜撐；兩端的礙子串（三片）
    k.box(m, wd, 0.3, 0.3, 0, y, 0);
    k.box(m, wd * 0.8, 0.14, 0.14, 0, y - 0.7, 0);
    for (const s of [-1, 1]) {
      k.bar(m, [s * wd * 0.4, y - 0.7, 0], [s * wd * 0.5, y, 0], 0.1);
      for (let j = 0; j < 3; j++)
        k.cyl(ins, 0.2, 0.2, 0.08, (s * wd) / 2, y - 0.25 - j * 0.25, 0, 0, 0, 0, 6);
      k.cyl(ins, 0.06, 0.06, 0.9, (s * wd) / 2, y - 0.45, 0, 0, 0, 0, 4);
    }
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.cb(DETAIL.dark, 0.7, 0.4, 0.7, sx * b0, 0.2, sz * b0, 0, 0, 0, 0.06);
  return k.build();
}
// 機房：6 × 4.2 × 5，原點在底面中心
export const CONTROL = [6, 4.2, 5];
export function buildControlHouse(color) {
  const glb = propGlb('control_house', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.85 }),
    dk = fadeMat(0x2e3236, { roughness: 0.6 });
  const k = new PK().bounds(-3.2, 0, -2.7, 3.2, 6.4, 2.7); // 外框同原本
  // 倒角的牆體＋屋頂板（女兒牆）＋空調機＋窗（窗框、窗櫺）＋門（門框、門燈）＋通風格柵＋外牆管線＋天線
  k.cb(m, 6, 3.8, 5, 0, 1.9, 0, 0, 0, 0, 0.1);
  k.cb(dk, 6.4, 0.4, 5.4, 0, 4, 0, 0, 0, 0, 0.06);
  k.cb(m, 1.6, 0.7, 1.2, 1.4, 4.55, -0.8, 0, 0, 0, 0.06);
  k.cyl(dk, 0.42, 0.42, 0.06, 1.4, 4.92, -0.8, 0, 0, 0, 10);
  k.box(fadeMat(0x1d2a33, { roughness: 0.2 }), 3.6, 1, 0.1, 0, 2.6, 2.51);
  k.box(dk, 3.8, 0.12, 0.2, 0, 2.06, 2.55);
  for (const x of [-0.6, 0.6]) k.box(dk, 0.08, 1, 0.14, x, 2.6, 2.54);
  k.box(dk, 1.2, 2.4, 0.1, -2, 1.2, 2.52);
  k.box(DETAIL.steel, 0.12, 0.12, 0.08, -1.6, 1.15, 2.6);
  k.box(DETAIL.lamp, 0.4, 0.12, 0.16, -2, 2.6, 2.6);
  grille(k, dk, m, 1.2, 0.8, 4, 1.6, 2.6, -2.53, Math.PI);
  k.pipe(dk, [3.06, 0.2, 1.8], [3.06, 3.7, 1.8], 0.08);
  k.cyl(dk, 0.12, 0.12, 2.4, 2.4, 5.2, -1.8, 0, 0, 0, 6);
  for (const y of [5.4, 6.0]) k.box(dk, 0.6, 0.05, 0.05, 2.4, y, -1.8);
  return k.build();
}
// 變壓器：3 × 3.6 × 4，原點在底面中心
export const TRANSFORMER = [3.2, 3.6, 4];
export function buildTransformer() {
  const glb = propGlb('transformer', { fade: true });
  if (glb) return glb;
  const m = fadeMat(0x6a7a6a, { roughness: 0.7, metalness: 0.4 }),
    ins = fadeMat(0x8a5a3a, { roughness: 0.4 });
  const k = new PK().bounds(-1.6, 0, -1.7, 1.6, 3.6, 1.7); // 外框同原本
  // 底座＋油箱（倒角）＋散熱鰭片＋套管（三段礙子）＋上方的儲油桶＋警示牌
  k.box(DETAIL.dark, 2.8, 0.2, 3.8, 0, 0.1, 0);
  k.cb(m, 2.4, 2.4, 3.4, 0, 1.4, 0, 0, 0, 0, 0.12);
  for (let i = -3; i <= 3; i++) k.box(m, 3.2, 2.0, 0.08, 0, 1.3, i * 0.45);
  for (const s of [-1, 1]) k.box(m, 3.2, 0.12, 0.1, 0, s > 0 ? 2.35 : 0.3, 0);
  for (const x of [-0.7, 0, 0.7]) {
    k.cyl(ins, 0.15, 0.2, 1, x, 3.1, 0, 0, 0, 0, 6);
    for (const y of [2.85, 3.15]) k.cyl(ins, 0.25, 0.25, 0.07, x, y, 0, 0, 0, 0, 6);
  }
  k.cyl(m, 0.3, 0.3, 1.6, 0, 3.0, -1.2, 0, 0, Math.PI / 2, 8);
  hazard(k, DETAIL.yellow, DETAIL.black, 0.8, 0.5, 0, 1.6, 1.71);
  return k.build();
}
// 消波塊（四腳）：原點在底面中心，半徑約 1.6
export function buildTetrapod() {
  const glb = propGlb('tetrapod', { fade: true });
  if (glb) return glb;
  const m = fadeMat(0xa8a6a0, { roughness: 1 });
  const k = new PK();
  const dirs = [
    [0, 1, 0],
    [0.94, -0.33, 0],
    [-0.47, -0.33, 0.82],
    [-0.47, -0.33, -0.82],
  ];
  // 四支漸細的腳（同原本；外框也照原本的四個零件，呼叫端會任意旋轉）＋中心的接合塊
  dirs.forEach(([x, y, z], i) => {
    const e = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z)),
    );
    k.obCyl(0.35, 0.6, 1.6, x * 0.8, 1 + y * 0.8, z * 0.8, e.x, e.y, e.z, 6);
    k.inPart(i, () => k.cyl(m, 0.35, 0.6, 1.6, x * 0.8, 1 + y * 0.8, z * 0.8, e.x, e.y, e.z, 6));
  });
  k.inPart(0, () => k.cyl(m, 0.62, 0.62, 0.5, 0, 1, 0, 0, 0, 0, 6));
  return k.build();
}
// 浮標（裝飾，浮在水庫上）：浮體＋護舷環＋桅杆＋燈籠＋頂標
export function buildBuoy() {
  const glb = propGlb('buoy');
  if (glb) return glb;
  const k = new PK().bounds(-0.571, -0.2, -0.6, 0.571, 1.9, 0.6); // 外框同原本
  const o = mat(0xd8601c, { roughness: 0.6 }),
    d = mat(0x3d4044);
  k.cyl(o, 0.5, 0.6, 0.8, 0, 0.2, 0, 0, 0, 0, 10);
  k.cyl(d, 0.64, 0.64, 0.12, 0, 0.3, 0, 0, 0, 0, 10);
  k.cyl(d, 0.08, 0.08, 1.4, 0, 1.2, 0, 0, 0, 0, 6);
  for (const a of [0, 2.1, 4.2]) k.bar(d, [Math.cos(a) * 0.4, 0.6, Math.sin(a) * 0.4], [0, 1.4, 0], 0.05);
  k.cyl(DETAIL.lamp, 0.1, 0.1, 0.2, 0, 1.78, 0, 0, 0, 0, 6);
  k.box(o, 0.4, 0.08, 0.4, 0, 1.6, 0, 0, Math.PI / 4, 0);
  return k.build();
}

// ---------- 地形特徵的外觀（混凝土＋黃黑警示）----------
const C = {
  deck: 0x8c8a84,
  trim: 0xd8a020,
  pillar: 0x7d7b75,
  wall: 0x9a9890,
  plat: 0x8a8882,
  rock: 0x4a4842,
};
registerFeatureStyle('dam', C, {
  deck(w, d, thick, rotY, C) {
    const dm = fadeMat(C.deck, { roughness: 0.9 }),
      tm = fadeMat(C.trim, { roughness: 0.6 }),
      rm = fadeMat(0x3d4044, { roughness: 0.7, metalness: 0.5 });
    const L = rotY ? d : w,
      D = rotY ? w : d;
    const k = new PK().bounds(-w / 2, -thick, -d / 2, w / 2, 1, d / 2); // 外框同原本
    k.at(0, 0, 0, 0, rotY ? Math.PI / 2 : 0, 0, () => {
      k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, Math.min(0.1, thick * 0.2));
      for (const s of [-1, 1]) {
        k.box(tm, L, 0.15, 0.4, 0, 0.08, s * (D / 2 - 0.2));
        railing(k, rm, L - 0.2, 0.96, 0, 0, s * (D / 2 - 0.1), 0, 2, 0.08);
        for (let x = -L / 2 + 2; x < L / 2 - 1; x += 4)
          k.box(DETAIL.dark, 0.2, 0.06, 0.5, x, -thick * 0.4, s * (D / 2 - 0.05));
      }
    });
    return k.build();
  },
  pillar(r, h, C) {
    const k = new PK().bounds(-r * 1.2, -h / 2, -r * 1.2, r * 1.2, h / 2, r * 1.2); // 外框同原本
    const pm = mat(C.pillar, { roughness: 0.95 }),
      tm = mat(C.trim, { roughness: 0.6 });
    k.cb(pm, r * 2, h, r * 2, 0, 0, 0, 0, 0, 0, Math.min(0.12, r * 0.2));
    k.cb(tm, r * 2.4, 0.6, r * 2.4, 0, -h / 2 + 0.3, 0, 0, 0, 0, 0.06);
    k.cb(pm, r * 2.3, 0.4, r * 2.3, 0, h / 2 - 0.2, 0, 0, 0, 0, 0.06);
    for (const s of [-1, 1])
      hazard(k, tm, DETAIL.black, r * 1.8, 0.4, 0, -h / 2 + 1.0, s * (r + 0.02), s > 0 ? 0 : Math.PI, 0.4);
    return k.build();
  },
  wall(w, h, d, C) {
    const m = fadeMat(C.wall, { roughness: 0.95 });
    const k = new PK();
    const along = w > d,
      L = along ? w : d,
      T = along ? d : w;
    k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
      k.ob(L + 0.05, h, T + 0.05); // 外框同原本（牆＋警示帶）
      k.cb(m, L, h, T, 0, 0, 0, 0, 0, 0, 0.12);
      k.box(fadeMat(C.trim, { roughness: 0.6 }), L + 0.05, 0.4, T + 0.05, 0, h / 2 - 0.6, 0);
      // 模板的接縫與繫桿孔
      for (let x = -L / 2 + 2.5; x < L / 2 - 1; x += 2.5)
        for (const s of [-1, 1]) k.box(DETAIL.dark, 0.06, h - 1.2, 0.04, x, -0.4, s * (T / 2 + 0.01));
    });
    return k.build();
  },
  platform(w, h, d, C) {
    const m = fadeMat(C.plat, { roughness: 0.95 });
    const tm = fadeMat(C.trim, { roughness: 0.6 });
    const k = new PK().bounds(-w / 2 - 0.15, 0, -d / 2 - 0.15, w / 2 + 0.15, h, d / 2 + 0.15); // 外框同原本
    k.cb(m, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.15);
    for (const s of [-1, 1]) {
      k.box(tm, w + 0.05, 0.3, 0.3, 0, h - 0.15, s * (d / 2));
      k.box(tm, 0.3, 0.3, d + 0.05, s * (w / 2), h - 0.15, 0);
    }
    for (let x = -w / 2 + 3; x < w / 2 - 1; x += 3)
      k.box(DETAIL.dark, 0.08, h - 0.6, 0.04, x, (h - 0.6) / 2, d / 2 + 0.01);
    ladder(k, DETAIL.dark, h - 0.3, w / 2 - 1.5, 0, d / 2 + 0.12);
    return k.build();
  },
  ramp(rw, rd, C) {
    const along = rw >= rd;
    const L = along ? rw : rd,
      D = along ? rd : rw;
    const k = new PK();
    const pm = mat(C.plat, { roughness: 0.95 }),
      tm = mat(C.trim);
    k.at(0, 0, 0, 0, along ? 0 : Math.PI / 2, 0, () => {
      k.cb(pm, L, 0.45, D, 0, 0, 0, 0, 0, 0, 0.06);
      for (let x = -L / 2 + 0.6; x < L / 2; x += 1.2) k.box(DETAIL.dark, 0.1, 0.05, D - 0.8, x, 0.24, 0);
      for (const s of [-1, 1]) k.box(tm, L, 0.2, 0.3, 0, 0.3, s * (D / 2 - 0.15));
    });
    return k.build();
  },
  tunnel(C) {
    const k = new PK();
    const m = mat(0x8c8a84, { roughness: 0.95 });
    k.cb(mat(C.rock, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
    k.cb(m, 14, 9, 2.5, 0, 4.5, 0, 0, 0, 0, 0.15);
    k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
    for (const s of [-1, 1]) {
      k.box(mat(C.trim), 0.6, 6.8, 2.9, s * 4.3, 3.4, 0);
      k.box(DETAIL.lamp, 0.6, 0.2, 0.2, s * 2.5, 7.0, 1.35);
    }
    hazard(k, mat(C.trim), DETAIL.black, 9.2, 0.6, 0, 7.1, 1.27);
    k.box(DETAIL.dark, 3, 0.8, 0.08, 0, 8.1, 1.29);
    return k.build();
  },
});

// ---------- 地形：下游是丘陵與河道，上游（壩的另一側）是水庫 ----------
function planTerrain(w) {
  const sgn = RNG() < 0.5 ? 1 : -1;
  const zc = sgn * rnd(24, 34) * w.k;
  const xr = (RNG() < 0.5 ? 1 : -1) * rnd(22, 40) * w.k; // 洩洪河道
  w.dam = { zc, up: sgn, xr };
  const n = w.noise,
    n2 = w.noise2;
  return (x, z) => {
    let h = n(x * 0.025, z * 0.025) * 1.6 + n2(x * 0.09, z * 0.09) * 0.35;
    const u = (z - zc) * sgn; // 往上游為正
    const t = clamp((u - 6) / 9, 0, 1);
    h = lerp(h, -3.4 + n2(x * 0.05, z * 0.05) * 0.5, t * t * (3 - 2 * t));
    if (u < 0) {
      // 下游河道：從閘門往下游
      const c = clamp(1 - (Math.abs(x - xr) - 6) / 4, 0, 1);
      h -= 3.2 * c * c * (3 - 2 * c) * clamp(-u / 10, 0, 1);
    }
    return h;
  };
}

// 壩體、閘門、坡道（在地形特徵之前建立，並登記保留區）
function buildStructures(w) {
  const D = w.dam,
    zc = D.zc,
    dn = -D.up;
  const half = w.size / 2 + 4;
  // 閘門位置：公路／鐵路經過處、洩洪河道、再一個
  const gates = [];
  const c = w.corridor;
  if (c) {
    // 沿中心線找穿過壩體（z＝zc）的位置；通道和壩體平行時沒有交點
    let prev = null;
    for (let s = -c.len / 2 - 18; s <= c.len / 2 + 18; s += 1) {
      const p = w.corridorPoint(s);
      if (prev && (prev.z - zc) * (p.z - zc) <= 0 && Math.abs(p.z - prev.z) > 1e-3) {
        const t = w.corridorDir(s);
        gates.push({ x: p.x, gw: 14 + 10 / Math.max(0.3, Math.abs(t.y)) });
        break;
      }
      prev = p;
    }
  }
  if (!gates.some((g) => Math.abs(g.x - D.xr) < 30)) gates.push({ x: D.xr, gw: 16 });
  // 坡道可放的位置（壩體下游側 zs＝dn 或上游側 −dn）：避開閘門、已有的坡道與公路／鐵路
  const rl = 32,
    rw = 6;
  const rampZ = (zs) => zc + zs * (THICK / 2 + rw / 2);
  const rampCands = (gs, zs) => {
    const rz = rampZ(zs);
    const ok = (rx) => {
      if (gs.some((g) => Math.abs(g.x - rx) < g.gw / 2 + rl / 2 + 3)) return false;
      if ((w.ramps || []).some((q) => Math.abs(q.x - rx) < rl + 10)) return false;
      for (let q = -rl / 2; q <= rl / 2; q += 4) if (w.onCorridor(rx + q, rz, 2)) return false;
      return true;
    };
    const out = [];
    for (let rx = Math.ceil(-w.lim + rl / 2 + 4); rx <= w.lim - rl / 2 - 4; rx++) if (ok(rx)) out.push(rx);
    return out;
  };
  // 多一座閘門：要留得下至少一座坡道
  for (let t = 0; t < 10; t++) {
    const x = rnd(-w.lim + 15, w.lim - 15);
    const gs = gates.concat([{ x, gw: 16 }]);
    if (
      gates.every((g) => Math.abs(g.x - x) > 34) &&
      (rampCands(gs, dn).length || rampCands(gs, -dn).length)
    ) {
      gates.push({ x, gw: 16 });
      break;
    }
  }
  gates.sort((a, b) => a.x - b.x);
  w.dam.gates = gates;
  const y0 = -4;
  // 壩體分段（閘門之間）
  let x0 = -half;
  const segs = [];
  for (const gt of gates.concat([{ x: half + 1e3, gw: 0 }])) {
    const x1 = Math.min(gt.x - gt.gw / 2, half);
    if (x1 - x0 > 1) segs.push([x0, x1]);
    x0 = gt.x + gt.gw / 2;
    if (x0 > half) break;
  }
  for (const [a, b] of segs) {
    const len = b - a,
      cx = (a + b) / 2;
    const g = buildDamSegment(len, y0, dn);
    g.position.set(cx, TOP, zc);
    w.scene.add(g);
    w.meshes.push(g);
    const mats = fadeMatsOf(g);
    w.obstacles.push({
      kind: 'box',
      x: cx,
      z: zc,
      w: len,
      d: THICK,
      top: TOP,
      y: y0,
      group: g,
      mats,
      box: new THREE.Box3(
        new THREE.Vector3(a, y0, zc - THICK / 2),
        new THREE.Vector3(b, TOP, zc + THICK / 2),
      ),
    });
    w.occluders.push(w.obstacles[w.obstacles.length - 1]);
  }
  // 閘門：上方是可站的門楣（下方可通行）
  for (const gt of gates) {
    if (Math.abs(gt.x) > half) continue;
    const g = buildDamGate(gt.gw);
    g.position.set(gt.x, TOP, zc);
    w.scene.add(g);
    w.meshes.push(g);
    const ob = {
      kind: 'box',
      x: gt.x,
      z: zc,
      w: gt.gw,
      d: THICK,
      top: TOP,
      y: GATE_H,
      group: g,
      mats: fadeMatsOf(g),
      deck: true,
      box: new THREE.Box3(
        new THREE.Vector3(gt.x - gt.gw / 2, GATE_H, zc - THICK / 2),
        new THREE.Vector3(gt.x + gt.gw / 2, TOP, zc + THICK / 2),
      ),
    };
    w.obstacles.push(ob);
    w.occluders.push(ob);
  }
  w.reserve(-half, half, zc - THICK / 2 - 2, zc + THICK / 2 + 2);
  // 坡道：沿壩體的下游側，往 −X 或 +X 爬升到壩頂。可放的位置逐一掃過再隨機挑（閘門多時空隙很窄，
  // 隨機試幾次會挑不到）；下游側被閘門或沿著壩體的公路／鐵路佔滿時，改放在上游側（從水庫底爬上去）
  let made = 0;
  for (const zs of [dn, -dn]) {
    for (; made < 2; made++) {
      const cand = rampCands(gates, zs);
      if (!cand.length) break;
      placeRamp(w, cand[Math.floor(RNG() * cand.length)], rampZ(zs), zs, rl, rw);
    }
    if (made) break;
  }
}
function placeRamp(w, rx, rz, zs, rl, rw) {
  const side = [RNG() < 0.5 ? 1 : -1, 0];
  const lowX = rx + side[0] * (rl / 2);
  const ylow = w.terrainHeight(lowX, rz) - 0.3;
  const rg = buildRampMesh(rl, rw);
  rg.position.set(rx, (ylow + TOP) / 2 - 0.2, rz);
  rg.rotation.z = -side[0] * Math.atan2(TOP - ylow, rl);
  w.scene.add(rg);
  w.meshes.push(rg);
  // 坡道下方的擋牆（外觀）
  const wall = box(
    rl,
    (TOP - ylow) / 2,
    0.6,
    mat(0x7d7b75, { roughness: 1 }),
    rx - side[0] * (rl / 4),
    ylow + (TOP - ylow) / 4,
    rz + zs * (rw / 2),
  );
  w.scene.add(wall);
  w.meshes.push(wall);
  w.ramps = w.ramps || [];
  w.ramps.push({ x: rx, z: rz, w: rl, d: rw, side, y0: ylow, y1: TOP, len: rl });
  w.reserve(rx - rl / 2, rx + rl / 2, rz - rw / 2, rz + rw / 2);
}

function buildRampMesh(rl, rw) {
  // 坡道板＋止滑橫條＋黃色路緣＋外側的欄杆
  const k = new PK();
  k.cb(mat(0x8a8882, { roughness: 0.95 }), rl, 0.6, rw, 0, 0, 0, 0, 0, 0, 0.08);
  for (let x = -rl / 2 + 0.6; x < rl / 2; x += 1.2) k.box(DETAIL.dark, 0.1, 0.05, rw - 0.8, x, 0.32, 0);
  for (const s of [-1, 1]) {
    k.box(mat(0xd8a020), rl, 0.25, 0.3, 0, 0.4, s * (rw / 2 - 0.15));
    railing(k, DETAIL.steel, rl - 0.4, 0.8, 0, 0.5, s * (rw / 2 - 0.08), 0, 2.4, 0.07);
  }
  return k.build();
}
function fadeMatsOf(g) {
  const out = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m.transparent && !out.includes(m)) out.push(m);
  });
  return out;
}

function buildProps(w) {
  const D = w.dam;
  // 輸電鐵塔：沿下游平行壩體排一列
  const pz = D.zc - D.up * rnd(30, 44) * w.k;
  for (let x = -w.lim + 10 + rnd(0, 20); x < w.lim - 8; x += rnd(36, 48)) {
    if (w.onCorridor(x, pz, 4) || w.isReserved(x, pz, 4) || overlaps(w, x, pz, 3)) continue;
    const h = rnd(20, 24);
    const g = buildPylon(h);
    const y = w.terrainHeight(x, pz) - 0.3;
    w.addSmall(g, x, y, pz, { r: 2.2, h }, 'pylon', 3500, 0x8a9096);
  }
  w.scatter(w.cnt(4, 7), 9, (x, z, y) => {
    const color = pick([0xc8c4b8, 0x9aa4ac, 0xb0a890]);
    const g = buildControlHouse(color);
    const rot = RNG() < 0.5;
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(
      g,
      x,
      y - 0.2,
      z,
      { w: rot ? CONTROL[2] : CONTROL[0], h: CONTROL[1], d: rot ? CONTROL[0] : CONTROL[2] },
      'control',
      2600,
      color,
    );
  });
  w.scatter(w.cnt(4, 6), 7, (x, z, y) => {
    const g = buildTransformer();
    w.addSmall(
      g,
      x,
      y - 0.1,
      z,
      { w: TRANSFORMER[0], h: TRANSFORMER[1], d: TRANSFORMER[2] },
      'transformer',
      1800,
      0x6a7a6a,
    );
  });
  // 消波塊：一小群一小群
  w.scatter(
    w.cnt(5, 8),
    10,
    (x, z) => {
      for (let i = 0; i < 4; i++) {
        const px = x + rnd(-3, 3),
          pz2 = z + rnd(-3, 3);
        const g = buildTetrapod();
        g.rotation.set(rnd(-0.3, 0.3), rnd(0, 6.28), rnd(-0.3, 0.3));
        w.addSmall(
          g,
          px,
          w.terrainHeight(px, pz2) - 0.3,
          pz2,
          { r: 1.4, h: 2.4 },
          'tetrapod',
          1600,
          0xa8a6a0,
        );
      }
    },
    false,
  );
  // 浮標：只放在水庫上
  for (let i = 0, n = Math.round(14 * w.kk); i < n; i++) {
    const x = rnd(-w.lim, w.lim),
      z = rnd(-w.lim, w.lim);
    if (w.terrainHeight(x, z) > WATER - 0.4 || w.isReserved(x, z, 2)) continue;
    const m = buildBuoy();
    m.position.set(x, WATER, z);
    w.scene.add(m);
    w.meshes.push(m);
  }
}

export const DAM = {
  name: '多重水壩',
  ground: 0x6f6a5c,
  slope: 0x55524a,
  rock: 0x4a4842,
  fog: 0xa9b0b2,
  sky: 0xb4bcc0,
  sun: 0xfff0dc,
  amb: 0x8b929a,
  container: 0x8c8a84,
  container2: 0xd8a020,
  hasRocks: false,
  props: 'dam',
  water: { level: WATER, color: 0x2e4a56, opacity: 0.88 },
  featureKinds: ['bunkers', 'platforms', 'trench'],
  corridor: { p: 0.6, kinds: ['road', 'rail'] },
  planTerrain,
  buildStructures,
  buildProps,
  propNames: { pylon: '輸電鐵塔', control: '機房', transformer: '變壓器', tetrapod: '消波塊' },
  catalog: [
    [
      'dam_segment',
      '壩體（一段）',
      '多重水壩；長依閘門間距、厚 10、壩頂高 14 m，扶壁朝 +Z（下游）；不可破壞',
      () => buildDamSegment(40, -4, 1),
      { origin: '壩頂中心' },
    ],
    [
      'dam_gate',
      '閘門',
      '多重水壩；寬 16–24 m，下方 7 m 可通行，上方可站；不可破壞',
      () => buildDamGate(16),
      { origin: '壩頂中心' },
    ],
    ['power_pylon', '輸電鐵塔', '多重水壩；高 20–24 m，可破壞；GLB 依高度縮放', () => buildPylon(22)],
    ['control_house', '機房', '多重水壩的掩體；6 × 4.2 × 5 m，可破壞', () => buildControlHouse(0xc8c4b8)],
    ['transformer', '變壓器', '多重水壩；3.2 × 3.6 × 4 m，可破壞', () => buildTransformer()],
    ['tetrapod', '消波塊', '多重水壩；成群擺放，可破壞', () => buildTetrapod()],
    ['buoy', '浮標', '多重水壩的裝飾，浮在水庫上', () => buildBuoy()],
  ],
};
