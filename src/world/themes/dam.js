// 主題：多重水壩（AC6 貝利烏斯的多重水壩／牆）——橫貫地圖的壩體把戰場分成上游水庫與下游河谷；
// 閘門下方可通行、兩座沿壩體的坡道可上到壩頂
import { RNG, clamp, lerp, pick, rnd } from '../../core/math.js';
import { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle } from './kit.js';
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
  const g = new THREE.Group();
  const H = TOP - y0;
  const m = fadeMat(0x8c8a84, { roughness: 0.95 }),
    dk = fadeMat(0x6a6862, { roughness: 1 }),
    rail = fadeMat(0x3d4044, { roughness: 0.7, metalness: 0.5 });
  g.add(box(len, H, THICK - 3, m, 0, -H / 2, -dn * 1.5));
  // 下游面的扶壁
  for (let x = -len / 2 + 4; x < len / 2 - 2; x += 12)
    g.add(box(2.2, H - 2, 3, dk, x, -H / 2 - 1, dn * (THICK / 2 - 1.5)));
  g.add(box(len, 0.6, THICK, m, 0, -0.3, 0)); // 壩頂步道
  for (const s of [-1, 1]) g.add(box(len, 1, 0.3, rail, 0, 0.5, s * (THICK / 2 - 0.15)));
  // 上游面的水漬線
  g.add(
    box(len, 1.5, 0.1, fadeMat(0x4a5048, { roughness: 1 }), 0, WATER - TOP + 0.5, -dn * (THICK / 2 + 0.02)),
  );
  return g;
}
// 閘門：寬 gw 的開口上方的閘門結構（門楣＋捲揚機），原點在壩頂中心
export function buildDamGate(gw) {
  const glb = propGlb('dam_gate', { ref: [16, 9, THICK], size: [gw, 9, THICK], y: -GATE_H, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x8c8a84, { roughness: 0.95 }),
    steel = fadeMat(0x4a5a66, { roughness: 0.6, metalness: 0.6 }),
    yel = fadeMat(0xd8a020, { roughness: 0.6 });
  g.add(box(gw, TOP - GATE_H, THICK, m, 0, -(TOP - GATE_H) / 2, 0));
  g.add(box(gw - 1, 1.2, 0.6, steel, 0, -(TOP - GATE_H) - 0.6, 0)); // 拉起的閘門下緣
  for (const s of [-1, 1]) {
    g.add(box(1.2, 5, 1.6, steel, s * (gw / 2 - 1.2), 2.5, 0));
    g.add(box(gw * 0.4, 0.4, 0.4, yel, 0, 0.6, s * (THICK / 2 - 0.3)));
  }
  g.add(box(gw - 1.2, 1.4, 2.2, steel, 0, 5.2, 0));
  return g;
}
// 輸電鐵塔：高 h 的格子塔＋三層橫擔；原點在底面中心；GLB 以高 22 m 製作
export function buildPylon(h) {
  const glb = propGlb('power_pylon', { ref: [8, 22, 3], size: [8, h, 3], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x8a9096, { roughness: 0.6, metalness: 0.6 });
  const b0 = 1.6,
    b1 = 0.5;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = box(0.22, h, 0.22, m, sx * ((b0 + b1) / 2), h / 2, sz * ((b0 + b1) / 2));
      leg.rotation.z = sx * Math.atan2(b0 - b1, h);
      leg.rotation.x = -sz * Math.atan2(b0 - b1, h);
      g.add(leg);
    }
  for (let y = 2; y < h - 1; y += 2.6) {
    const a = lerp(b0, b1, y / h);
    for (const s of [-1, 1]) {
      g.add(box(a * 2, 0.12, 0.12, m, 0, y, s * a));
      g.add(box(0.12, 0.12, a * 2, m, s * a, y, 0));
    }
  }
  const ins = mat(0xd8e0e6, { roughness: 0.3 });
  for (const [y, wd] of [
    [h * 0.72, 7],
    [h * 0.84, 5.4],
    [h * 0.96, 3.6],
  ]) {
    g.add(box(wd, 0.3, 0.3, m, 0, y, 0));
    for (const s of [-1, 1]) g.add(cyl(0.12, 0.12, 0.9, ins, (s * wd) / 2, y - 0.45, 0, 6));
  }
  return g;
}
// 機房：6 × 4.2 × 5，原點在底面中心
export const CONTROL = [6, 4.2, 5];
export function buildControlHouse(color) {
  const glb = propGlb('control_house', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.85 }),
    dk = fadeMat(0x2e3236, { roughness: 0.6 });
  g.add(box(6, 3.8, 5, m, 0, 1.9, 0));
  g.add(box(6.4, 0.4, 5.4, dk, 0, 4, 0));
  g.add(box(3.6, 1, 0.1, fadeMat(0x1d2a33, { roughness: 0.2 }), 0, 2.6, 2.51));
  g.add(box(1.2, 2.4, 0.1, dk, -2, 1.2, 2.52));
  g.add(cyl(0.12, 0.12, 2.4, dk, 2.4, 5.2, -1.8, 6));
  return g;
}
// 變壓器：3 × 3.6 × 4，原點在底面中心
export const TRANSFORMER = [3.2, 3.6, 4];
export function buildTransformer() {
  const glb = propGlb('transformer', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0x6a7a6a, { roughness: 0.7, metalness: 0.4 }),
    ins = fadeMat(0x8a5a3a, { roughness: 0.4 });
  g.add(box(2.4, 2.6, 3.4, m, 0, 1.3, 0));
  for (let i = -3; i <= 3; i++) g.add(box(3.2, 2.2, 0.08, m, 0, 1.3, i * 0.45));
  for (const x of [-0.7, 0, 0.7]) g.add(cyl(0.15, 0.2, 1, ins, x, 3.1, 0, 6));
  return g;
}
// 消波塊（四腳）：原點在底面中心，半徑約 1.6
export function buildTetrapod() {
  const glb = propGlb('tetrapod', { fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xa8a6a0, { roughness: 1 });
  const dirs = [
    [0, 1, 0],
    [0.94, -0.33, 0],
    [-0.47, -0.33, 0.82],
    [-0.47, -0.33, -0.82],
  ];
  for (const [x, y, z] of dirs) {
    const leg = cyl(0.35, 0.6, 1.6, m, x * 0.8, 1 + y * 0.8, z * 0.8, 6);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y, z));
    g.add(leg);
  }
  return g;
}
// 浮標（裝飾，浮在水庫上）
export function buildBuoy() {
  const glb = propGlb('buoy');
  if (glb) return glb;
  const g = new THREE.Group();
  g.add(cyl(0.5, 0.6, 0.8, mat(0xd8601c, { roughness: 0.6 }), 0, 0.2, 0, 10));
  g.add(cyl(0.08, 0.08, 1.4, mat(0x3d4044), 0, 1.2, 0, 6));
  return g;
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
    const g = new THREE.Group();
    const dm = fadeMat(C.deck, { roughness: 0.9 }),
      tm = fadeMat(C.trim, { roughness: 0.6 }),
      rm = fadeMat(0x3d4044, { roughness: 0.7, metalness: 0.5 });
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    for (const s of [-1, 1]) {
      g.add(
        rotY
          ? box(0.4, 0.15, d, tm, s * (w / 2 - 0.2), 0.08, 0)
          : box(w, 0.15, 0.4, tm, 0, 0.08, s * (d / 2 - 0.2)),
      );
      g.add(
        rotY
          ? box(0.15, 1, d, rm, s * (w / 2 - 0.1), 0.5, 0)
          : box(w, 1, 0.15, rm, 0, 0.5, s * (d / 2 - 0.1)),
      );
    }
    return g;
  },
  pillar(r, h, C) {
    const g = new THREE.Group();
    g.add(box(r * 2, h, r * 2, mat(C.pillar, { roughness: 0.95 })));
    g.add(box(r * 2.4, 0.6, r * 2.4, mat(C.trim, { roughness: 0.6 }), 0, -h / 2 + 0.3, 0));
    return g;
  },
  wall(w, h, d, C) {
    const g = new THREE.Group();
    const m = fadeMat(C.wall, { roughness: 0.95 });
    g.add(box(w, h, d, m));
    g.add(box(w + 0.05, 0.4, d + 0.05, fadeMat(C.trim, { roughness: 0.6 }), 0, h / 2 - 0.6, 0));
    return g;
  },
  platform(w, h, d, C) {
    const g = new THREE.Group();
    const m = fadeMat(C.plat, { roughness: 0.95 });
    g.add(box(w, h, d, m, 0, h / 2, 0));
    const tm = fadeMat(C.trim, { roughness: 0.6 });
    for (const s of [-1, 1]) {
      g.add(box(w + 0.05, 0.3, 0.3, tm, 0, h - 0.15, s * (d / 2)));
      g.add(box(0.3, 0.3, d + 0.05, tm, s * (w / 2), h - 0.15, 0));
    }
    return g;
  },
  ramp(rw, rd, C) {
    const g = new THREE.Group();
    g.add(box(rw, 0.45, rd, mat(C.plat, { roughness: 0.95 })));
    const along = rw >= rd;
    for (const s of [-1, 1])
      g.add(
        along
          ? box(rw, 0.2, 0.3, mat(C.trim), 0, 0.3, s * (rd / 2 - 0.15))
          : box(0.3, 0.2, rd, mat(C.trim), s * (rw / 2 - 0.15), 0.3, 0),
      );
    return g;
  },
  tunnel(C) {
    const g = new THREE.Group();
    const m = mat(0x8c8a84, { roughness: 0.95 });
    g.add(box(24, 14, 10, mat(C.rock, { roughness: 1 }), 0, 5, -6));
    g.add(box(14, 9, 2.5, m, 0, 4.5, 0));
    g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
    for (const s of [-1, 1]) g.add(box(0.6, 6.8, 2.9, mat(C.trim), s * 4.3, 3.4, 0));
    return g;
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
  const g = new THREE.Group();
  g.add(box(rl, 0.6, rw, mat(0x8a8882, { roughness: 0.95 })));
  g.add(box(rl, 0.25, 0.3, mat(0xd8a020), 0, 0.4, rw / 2 - 0.15));
  g.add(box(rl, 0.25, 0.3, mat(0xd8a020), 0, 0.4, -rw / 2 + 0.15));
  return g;
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
  for (let i = 0, n = Math.round(14 * w.k * w.k); i < n; i++) {
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
