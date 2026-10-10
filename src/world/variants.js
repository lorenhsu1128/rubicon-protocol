// 主題變體：同一個主題的不同場景構成（主線的區段與自由出擊共用；設計見 docs/campaign-design.md 5.5）。
// 欄位：name、theme（覆寫主題欄位：地形特徵、公路、岩頂、光線、顏色…）、terrain(w)（回傳 (x, z, h) → h 的地形修改，
// 參數用自己的亂數串 makeRng）、build(w)（在一般物件之後加的結構，於關卡生成的 withRng 內呼叫）。
// 不帶變體時 World 完全照原本生成（現有地圖不變）。本模組不可 import world.js，World 一律用參數 w。
import { clamp, makeRng, pick, rnd, rndi } from '../core/math.js';
import { box, buildIceSheet, cyl, mat } from './prop-models.js';
import { CAR, FLOODED, buildBentLamp, buildRuinTower, buildWreckCar } from './themes/flooded.js';
import { buildCavePillar, buildCoralTank, buildLab } from './themes/institute.js';

const M = {
  concrete: mat(0x8e8a82, { roughness: 0.95, metalness: 0.02 }),
  concreteD: mat(0x6a665f, { roughness: 0.95, metalness: 0.02 }),
  rust: mat(0x8a5a36, { roughness: 0.85 }),
  rustD: mat(0x5e3e28, { roughness: 0.9 }),
  steel: mat(0x9aa0a6, { metalness: 0.5 }),
  pipe: mat(0xa88c56),
  yellow: mat(0xc8a040),
  stripe: mat(0xd8d2c0),
  dark: mat(0x2a2c2e),
  rock: mat(0x4a3c32, { roughness: 1, metalness: 0 }),
  crystal: new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.1,
    flatShading: true,
  }),
  lamp: new THREE.MeshStandardMaterial({ color: 0xffe0a0, emissive: 0xffc060, emissiveIntensity: 1.4 }),
};

// ---------- 網格（純函式，尺寸由參數決定） ----------
// 廢工廠廠房：w×d、高 h，屋頂破洞、一側有大門開口（原點在地面中心）
export function buildFactoryHall(w, d, h) {
  const g = new THREE.Group();
  const t = 0.8;
  g.add(box(w, h, t, M.concrete, 0, h / 2, -d / 2));
  g.add(box(t, h, d, M.concrete, -w / 2, h / 2, 0));
  g.add(box(t, h, d, M.concrete, w / 2, h / 2, 0));
  const gw = Math.min(8, w * 0.5);
  for (const s of [-1, 1])
    g.add(box((w - gw) / 2, h, t, M.concrete, s * (gw / 2 + (w - gw) / 4), h / 2, d / 2));
  g.add(box(gw, h * 0.3, t, M.concreteD, 0, h * 0.85, d / 2));
  g.add(box(w * 0.55, 0.5, d, M.rustD, -w * 0.22, h + 0.25, 0));
  for (let x = -w / 2 + 3; x < w / 2; x += 4) g.add(box(0.4, 0.6, d, M.rust, x, h + 0.3, 0));
  g.add(cyl(0.9, 1.1, h * 1.8, M.concreteD, w / 2 - 2, h * 0.9, -d / 2 + 2, 10));
  return g;
}
// 地面管線一段（長 len，沿 Z；管徑 1.1、離地 1.1；每 6 m 一個支座）
export function buildGroundPipe(len) {
  const g = new THREE.Group();
  const p = cyl(0.55, 0.55, len, M.pipe, 0, 1.1, 0, 10);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  for (let z = -len / 2 + 1; z < len / 2; z += 6) {
    g.add(box(1.6, 0.6, 0.5, M.concreteD, 0, 0.3, z));
    const c = cyl(0.7, 0.7, 0.3, M.rust, 0, 1.1, z, 10);
    c.rotation.x = Math.PI / 2;
    g.add(c);
  }
  return g;
}
// 泵站：方形機房＋兩座儲槽
export function buildPumpStation() {
  const g = new THREE.Group();
  g.add(box(8, 5, 6, M.concrete, 0, 2.5, 0));
  g.add(box(8.4, 0.5, 6.4, M.rustD, 0, 5.2, 0));
  g.add(cyl(2, 2, 6, M.pipe, -6.5, 3, 0, 12));
  g.add(cyl(1.6, 1.6, 5, M.pipe, 6, 2.5, 1, 12));
  g.add(box(1, 3, 1, M.yellow, 0, 6.5, 0));
  return g;
}
// 紐澤西護欄（長 4 m）
export function buildBarrier() {
  const g = new THREE.Group();
  g.add(box(4, 0.5, 0.9, M.stripe, 0, 0.25, 0));
  g.add(box(4, 0.6, 0.5, M.stripe, 0, 0.8, 0));
  g.add(box(0.8, 0.4, 0.52, M.rust, -1, 0.9, 0));
  return g;
}
// 燒毀的車輛
export function buildCarWreck() {
  const g = new THREE.Group();
  g.add(box(2, 0.9, 4.4, M.rustD, 0, 0.75, 0));
  g.add(box(1.8, 0.7, 2.2, M.dark, 0, 1.5, -0.3));
  for (const [x, z] of [
    [-1, -1.4],
    [1, -1.4],
    [-1, 1.4],
    [1, 1.4],
  ]) {
    const c = cyl(0.4, 0.4, 0.3, M.dark, x, 0.4, z, 8);
    c.rotation.z = Math.PI / 2;
    g.add(c);
  }
  return g;
}
// 小型結晶簇（發光，高約 h）
export function buildCrystal(h) {
  const g = new THREE.Group();
  const C = [
    [0, 0, 0.35, 1, 0, 0],
    [0.45, 0.25, 0.25, 0.7, 0.35, 0.2],
    [-0.4, 0.2, 0.22, 0.6, -0.4, 0.1],
    [0.1, -0.45, 0.2, 0.5, 0.2, -0.4],
  ];
  for (const [x, z, r, k, rx, rz] of C) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r * h * 0.5, h * k, 6), M.crystal);
    m.position.set(x * h * 0.4, (h * k) / 2 - 0.2, z * h * 0.4);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  }
  return g;
}
// 鹽柱（沙丘「鹽灘平原」；高 h）
export function buildSaltPillar(h) {
  const g = new THREE.Group();
  const m = mat(0xe8e2d0, { roughness: 0.9, metalness: 0 });
  g.add(cyl(0.6, 0.9, h, m, 0, h / 2, 0, 6));
  g.add(cyl(0.35, 0.55, h * 0.4, m, 0.5, h * 0.2, 0.3, 5));
  return g;
}
// 貨櫃堆：n 層、長 len（沿 X）、寬 2.6、每層高 2.6；colors＝各層顏色（材質可透明，鏡頭遮擋時淡出）
export function buildContainerStack(len, n, colors) {
  const g = new THREE.Group();
  const fm = new THREE.MeshStandardMaterial({
    color: 0x26282c,
    roughness: 0.6,
    metalness: 0.5,
    transparent: true,
  });
  for (let i = 0; i < n; i++) {
    const cm = new THREE.MeshStandardMaterial({
      color: colors[i % colors.length],
      roughness: 0.7,
      metalness: 0.3,
      flatShading: true,
      transparent: true,
    });
    const y = i * 2.6,
      off = (i % 2) * 0.3;
    g.add(box(len, 2.5, 2.5, cm, off, y + 1.25, 0));
    for (const s of [-1, 1]) g.add(box(0.25, 2.5, 2.6, fm, off + (s * len) / 2, y + 1.25, 0));
    g.add(box(len, 0.15, 2.6, fm, off, y + 2.5, 0));
  }
  return g;
}
// 倉庫：w×d、高 h；長邊兩面各一個 8 m 寬、6 m 高的大門，屋頂只有桁架（俯視鏡頭看得進去）
export function buildWarehouse(w, d, h, color) {
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.8, metalness: 0.3 });
  const t = 0.6,
    gw = 8;
  for (const s of [-1, 1]) {
    for (const k of [-1, 1])
      g.add(box((w - gw) / 2, h, t, m, k * (gw / 2 + (w - gw) / 4), h / 2, (s * d) / 2));
    g.add(box(gw, h - 6, t, m, 0, 6 + (h - 6) / 2, (s * d) / 2));
    g.add(box(t, h, d, m, (s * w) / 2, h / 2, 0));
    g.add(box(w + 0.2, 0.5, 0.2, M.yellow, 0, 0.9, (s * (d + t)) / 2));
  }
  for (let x = -w / 2 + 2; x < w / 2; x += 4) g.add(box(0.4, 0.8, d, M.steel, x, h + 0.4, 0));
  g.add(box(w, 0.5, 1.2, M.dark, 0, h + 0.25, 0));
  return g;
}
// 有蓋貨車：長 len、寬 3、高 4（含台車）
export function buildBoxcar(len, color) {
  const g = new THREE.Group();
  g.add(box(3, 3.2, len, mat(color, { roughness: 0.75 }), 0, 2.6, 0));
  g.add(box(3.2, 0.3, len + 0.2, M.dark, 0, 4.3, 0));
  g.add(box(3.05, 2.4, 2.4, M.rustD, 0, 2.5, 0));
  for (const s of [-1, 1]) g.add(box(2.4, 0.8, 2.6, M.dark, 0, 0.6, s * len * 0.32));
  return g;
}
// 軌道（裝飾，長 len 沿 Z）
export function buildTrack(len) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(0.15, 0.15, len, M.steel, s * 0.75, 0.12, 0));
  for (let z = -len / 2 + 0.6; z < len / 2; z += 1.2) g.add(box(2.4, 0.1, 0.35, M.rustD, 0, 0.03, z));
  return g;
}
// 岸壁起重機：四支腳（沿 Z 相距 16、沿 X 相距 12），吊臂沿 +X 伸向海面（高約 30 m）
export function buildQuayCrane() {
  const g = new THREE.Group();
  for (const x of [-6, 6]) for (const z of [-8, 8]) g.add(box(1.2, 24, 1.2, M.yellow, x, 12, z));
  for (const z of [-8, 8]) g.add(box(14, 1.6, 1.4, M.yellow, 0, 24.5, z));
  g.add(box(46, 1.8, 3, M.yellow, 14, 27, 0));
  g.add(box(6, 4, 6, M.concrete, -4, 28, 0));
  g.add(box(0.6, 8, 0.6, M.steel, -4, 33, 0));
  g.add(box(4, 1.2, 3, M.dark, 18, 25.4, 0));
  g.add(box(0.08, 12, 0.08, M.dark, 18, 19, 0));
  for (const s of [-1, 1]) g.add(box(0.5, 0.5, 18, M.steel, s * 6, 12, 0));
  return g;
}
// 繫船柱（裝飾）
export function buildBollard() {
  const g = new THREE.Group();
  g.add(cyl(0.35, 0.45, 0.9, M.dark, 0, 0.45, 0, 8));
  g.add(cyl(0.5, 0.5, 0.15, M.dark, 0, 0.95, 0, 8));
  return g;
}
// 攔砂壩一段：長 len（沿 X）、高 h、厚 3（原點在底面中心）
export function buildWeir(len, h) {
  const g = new THREE.Group();
  g.add(box(len, h, 3, M.concrete, 0, h / 2, 0));
  g.add(box(len, 0.3, 3.3, M.concreteD, 0, h + 0.15, 0));
  for (let x = -len / 2 + 2; x < len / 2; x += 4) g.add(box(0.6, 0.8, 0.4, M.dark, x, 0.8, 1.6));
  return g;
}
// 壓力水管：沿 Z 的粗水管一段（長 len、管徑 2.4），每 8 m 一個鞍座
export function buildPenstock(len) {
  const g = new THREE.Group();
  const p = cyl(1.2, 1.2, len, M.steel, 0, 2, 0, 14);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  for (let z = -len / 2 + 2; z < len / 2; z += 8) g.add(box(3.2, 1.6, 1, M.concreteD, 0, 0.8, z));
  return g;
}
// 汙染物桶（發光，高 1.2 m）
export function buildToxicDrum() {
  const g = new THREE.Group();
  g.add(cyl(0.45, 0.45, 1.2, mat(0x8a9a2a, { roughness: 0.6 }), 0, 0.6, 0, 10));
  g.add(cyl(0.47, 0.47, 0.1, M.dark, 0, 0.3, 0, 10));
  g.add(cyl(0.47, 0.47, 0.1, M.dark, 0, 0.9, 0, 10));
  g.add(
    cyl(
      0.3,
      0.3,
      0.05,
      new THREE.MeshStandardMaterial({ color: 0x9aff40, emissive: 0x6acc20, emissiveIntensity: 1.4 }),
      0,
      1.22,
      0,
      10,
    ),
  );
  return g;
}
// 防爆牆（冰原「前線基地」）：長 len、高 4.5 m，頂部積雪
export function buildSnowWall(len) {
  const g = new THREE.Group();
  g.add(box(len, 4.5, 1.4, M.concrete, 0, 2.25, 0));
  g.add(box(len + 0.1, 0.35, 1.6, mat(0xf2f6fa, { roughness: 1, metalness: 0 }), 0, 4.6, 0));
  for (let x = -len / 2 + 1.5; x < len / 2; x += 3) g.add(box(0.15, 4.4, 1.45, M.concreteD, x, 2.2, 0));
  return g;
}
// 瞭望塔：四支腳＋小屋（高約 10 m）
export function buildWatchtower() {
  const g = new THREE.Group();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.3, 8, 0.3, M.steel, sx * 1.4, 4, sz * 1.4));
  g.add(box(4, 0.4, 4, M.concreteD, 0, 8, 0));
  g.add(box(3.4, 2, 3.4, M.concrete, 0, 9.2, 0));
  g.add(box(3.8, 0.3, 3.8, mat(0xf2f6fa, { roughness: 1, metalness: 0 }), 0, 10.35, 0));
  g.add(box(0.6, 0.4, 0.6, M.lamp, 1.6, 9.6, 1.6));
  return g;
}
// 研究所的地表入口：斜坡往下的大型閘門框（寬 24、高 14；技研都市「地表入口」）
export function buildFacilityGate() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(4, 14, 8, M.concreteD, s * 12, 7, 0));
  g.add(box(28, 3, 8, M.concreteD, 0, 15.5, 0));
  g.add(box(20, 11, 0.4, M.dark, 0, 5.5, 2));
  for (const s of [-1, 1]) g.add(box(0.5, 12, 0.5, M.yellow, s * 10, 6, -4.2));
  g.add(box(21, 0.6, 0.6, M.yellow, 0, 12.2, -4.2));
  g.add(
    box(
      6,
      1.2,
      0.3,
      new THREE.MeshStandardMaterial({ color: 0xff3a30, emissive: 0xff2010, emissiveIntensity: 1.6 }),
      0,
      13.6,
      -4.3,
    ),
  );
  return g;
}
// 礦坑坑口：岩壁上的方形入口與照明（寬 12、高 10）
export function buildMinePortal() {
  const g = new THREE.Group();
  g.add(box(4, 12, 6, M.rock, -8, 6, 0));
  g.add(box(4, 12, 6, M.rock, 8, 6, 0));
  g.add(box(20, 3, 6, M.rock, 0, 11.5, 0));
  g.add(box(12, 10, 0.4, M.dark, 0, 5, -2.8));
  for (const s of [-1, 1]) {
    g.add(box(0.6, 10, 0.6, M.yellow, s * 6, 5, 3));
    g.add(box(0.8, 0.5, 0.8, M.lamp, s * 6, 10.3, 3));
  }
  g.add(box(13, 0.8, 0.8, M.yellow, 0, 10.2, 3));
  return g;
}
// 主線的入口結構：升降梯平台（下降後抵達）／降落區標示（空降）——放在出生點，不碰撞
export function buildLiftPad() {
  const g = new THREE.Group();
  g.add(box(10, 0.3, 10, M.concreteD, 0, 0.15, 0));
  for (const [x, z] of [
    [-5.4, -5.4],
    [5.4, -5.4],
    [-5.4, 5.4],
    [5.4, 5.4],
  ]) {
    g.add(box(0.6, 14, 0.6, M.yellow, x, 7, z));
    g.add(box(0.7, 0.5, 0.7, M.lamp, x, 14.2, z));
  }
  for (const s of [-1, 1]) g.add(box(11.4, 0.5, 0.5, M.yellow, 0, 14, s * 5.4));
  return g;
}
export function buildLandingZone() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(4.2, 5, 32),
    new THREE.MeshStandardMaterial({ color: 0xffb020, emissive: 0x804000, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(ring);
  for (const s of [-1, 1]) g.add(box(0.5, 0.06, 6, M.stripe, s * 1.5, 0.06, 0));
  g.add(box(3.5, 0.06, 0.5, M.stripe, 0, 0.06, 0));
  return g;
}

// ---------- 放置工具 ----------
// 在 World 上放一個大型結構（findSpot＋addBig），回傳是否成功
function place(w, g, bx, range, shapes, sink = 0.3) {
  const spot = w.findSpot(bx, range, 40);
  if (!spot) return null;
  g.position.y = spot.lo - sink;
  return w.addBig(
    g,
    spot,
    shapes.map((s) =>
      s.box ? { ...s, y: spot.lo - sink + (s.y || 0), top: spot.lo - sink + s.top } : { ...s, h: s.h },
    ),
  );
}
const smooth = (t) => t * t * (3 - 2 * t);
const lerpH = (a, b, t) => a + (b - a) * t;
// 集散場：矩形範圍內沒有障礙物
const free = (w, x, z, hw, hd, m = 1) =>
  !w.obstacles.some((o) =>
    o.kind === 'box'
      ? Math.abs(o.x - x) < o.w / 2 + hw + m && Math.abs(o.z - z) < o.d / 2 + hd + m
      : Math.abs(o.x - x) < o.r + hw + m && Math.abs(o.z - z) < o.r + hd + m,
  );
const YARD_COLS = [0xe0a020, 0x2b4fb0, 0xb83a2a, 0x3a7a4a, 0x8b8f94, 0xd8d8d8];
// 一個單層貨櫃（集散場變體的散布物件）
function looseContainers(w, n) {
  w.scatter(n, 6, (x, z, y) => {
    const rot = rndi(0, 1),
      long = rnd(6, 9);
    const c = pick(YARD_COLS);
    const g = buildContainerStack(long, 1, [c]);
    if (rot) g.rotation.y = Math.PI / 2;
    w.addSmall(g, x, y - 0.15, z, { w: rot ? 2.6 : long, h: 2.6, d: rot ? long : 2.6 }, 'container', 3000, c);
  });
}
// 沿 axis（0＝列沿 Z、1＝列沿 X）排一列一列的貨櫃堆，each(x, z, len) 決定要不要放
function containerRows(w, axis, span, gap, levels, ok = () => true) {
  for (let off = -span; off <= span; off += rnd(gap[0], gap[1])) {
    if (Math.abs(off) < 7) continue;
    let s = -span;
    while (s < span) {
      const len = rnd(12, 24);
      const c = s + len / 2;
      const x = axis ? c : off,
        z = axis ? off : c;
      const hw = axis ? len / 2 : 1.3,
        hd = axis ? 1.3 : len / 2;
      if (
        Math.hypot(x, z) > 11 &&
        ok(x, z) &&
        !w.offLimits(x, z) &&
        !w.isReserved(x, z, 3) &&
        free(w, x, z, hw, hd) &&
        ![-1, 0, 1].some((k) =>
          w.onCorridor(x + (axis ? (k * len) / 2 : 0), z + (axis ? 0 : (k * len) / 2), 5),
        )
      ) {
        const n = rndi(levels[0], levels[1]);
        const cols = [pick(YARD_COLS), pick(YARD_COLS), pick(YARD_COLS), pick(YARD_COLS)];
        const g = buildContainerStack(len, n, cols);
        g.rotation.y = axis ? 0 : Math.PI / 2;
        w.addSmall(
          g,
          x,
          w.terrainHeight(x, z) - 0.15,
          z,
          { w: hw * 2, h: n * 2.6, d: hd * 2 },
          'stack',
          2500 * n,
          cols[0],
        );
      }
      s += len + rnd(6, 10);
    }
  }
}

// ---------- 變體 ----------
export const VARIANTS = {
  industrial: {
    stacks: {
      name: '貨櫃迷宮',
      theme: {
        featureKinds: ['platforms'],
        corridor: { p: 0.5, kinds: ['road', 'rail'] },
        propNames: { stack: '貨櫃堆' },
        // 沿一個方向排的高貨櫃堆（2～4 層），之間是走道
        buildProps(w) {
          containerRows(w, rndi(0, 1), 52 * w.k, [11, 15], [2, 4]);
          looseContainers(w, w.cnt(4, 7));
        },
      },
      terrain: () => (x, z, h) => h * 0.2,
    },
    warehouse: {
      name: '倉庫區',
      theme: {
        featureKinds: ['bunkers'],
        corridor: { p: 0.6, kinds: ['road'] },
        ground: 0x60646a,
        buildProps(w) {
          for (let k = w.cnt(4, 6); k > 0; k--) {
            const hw = rndi(9, 13),
              hd = rndi(7, 9),
              hh = rnd(9, 12);
            place(
              w,
              buildWarehouse(hw * 2, hd * 2, hh, pick([0x7a8894, 0x8e8a7e, 0x5e7488, 0xa09078])),
              [-hw - 1, hw + 1, -hd - 1, hd + 1],
              2,
              [
                { box: [-hw, -4, -hd - 0.3, -hd + 0.3], top: hh },
                { box: [4, hw, -hd - 0.3, -hd + 0.3], top: hh },
                { box: [-hw, -4, hd - 0.3, hd + 0.3], top: hh },
                { box: [4, hw, hd - 0.3, hd + 0.3], top: hh },
                { box: [-4, 4, -hd - 0.3, -hd + 0.3], y: 6, top: hh },
                { box: [-4, 4, hd - 0.3, hd + 0.3], y: 6, top: hh },
                { box: [-hw - 0.3, -hw + 0.3, -hd, hd], top: hh },
                { box: [hw - 0.3, hw + 0.3, -hd, hd], top: hh },
              ],
              0.2,
            );
          }
          looseContainers(w, w.cnt(10, 14));
        },
      },
      terrain: () => (x, z, h) => h * 0.15,
    },
    railyard: {
      name: '貨運調度場',
      theme: {
        featureKinds: ['overpass'],
        corridor: { p: 1, kinds: ['rail'] },
        propNames: { boxcar: '有蓋貨車' },
        // 平行的側線，停著一列一列的有蓋貨車
        buildProps(w) {
          const axis = rndi(0, 1);
          const span = 54 * w.k;
          for (let off = -span * 0.85; off <= span * 0.85; off += rnd(9, 12)) {
            if (Math.abs(off) < 6) continue;
            // 側線（裝飾）：整條鋪過去，經過公路／鐵路的地方略過
            for (let s = -span; s < span; s += 12) {
              const x = axis ? s + 6 : off,
                z = axis ? off : s + 6;
              if (w.onCorridor(x, z, 3) || w.offLimits(x, z)) continue;
              const t = buildTrack(12);
              t.position.set(x, w.terrainHeight(x, z), z);
              if (axis) t.rotation.y = Math.PI / 2;
              w.scene.add(t);
              w.meshes.push(t);
            }
            let s = -span + rnd(0, 10);
            while (s < span) {
              const n = rndi(1, 3),
                len = 12;
              const L = n * (len + 1);
              const c = s + L / 2;
              const x = axis ? c : off,
                z = axis ? off : c;
              const hw = axis ? L / 2 : 1.6,
                hd = axis ? 1.6 : L / 2;
              if (Math.hypot(x, z) > 11 && free(w, x, z, hw, hd, 0.5) && !w.isReserved(x, z, 2)) {
                let hit = false;
                for (let q = -L / 2; q <= L / 2; q += 3)
                  if (w.onCorridor(x + (axis ? q : 0), z + (axis ? 0 : q), 3)) hit = true;
                if (!hit)
                  for (let i = 0; i < n; i++) {
                    const p = -L / 2 + (len + 1) * (i + 0.5);
                    const cx = x + (axis ? p : 0),
                      cz = z + (axis ? 0 : p);
                    const color = pick([0x8a3a2a, 0x3a5a7a, 0x5a5a52, 0x7a6a3a]);
                    const g = buildBoxcar(len, color);
                    if (axis) g.rotation.y = Math.PI / 2;
                    w.addSmall(
                      g,
                      cx,
                      w.terrainHeight(cx, cz),
                      cz,
                      { w: axis ? len : 3, h: 4.4, d: axis ? 3 : len },
                      'boxcar',
                      3500,
                      color,
                    );
                  }
              }
              s += L + rnd(8, 16);
            }
          }
          looseContainers(w, w.cnt(3, 5));
        },
      },
      terrain: () => (x, z, h) => h * 0.1,
    },
    docks: {
      name: '港灣碼頭',
      theme: {
        featureKinds: ['bunkers'],
        corridor: { p: 0.4, kinds: ['road'] },
        water: { level: -1.6, color: 0x22394a, opacity: 0.86 },
        fog: 0x9aa8b4,
        sky: 0xb0bcc6,
        propNames: { stack: '貨櫃堆' },
        buildProps(w) {
          const [c, s] = w.sea;
          const u0 = w.seaU;
          // 岸壁起重機：沿岸壁排列，吊臂伸向海面
          const ry = Math.atan2(-s, c);
          const cr = Math.cos(ry),
            sr = Math.sin(ry);
          for (let v = -48 * w.k + rnd(0, 12); v < 48 * w.k; v += rnd(30, 40)) {
            const cx = c * (u0 - 9) - s * v,
              cz = s * (u0 - 9) + c * v;
            if (w.onCorridor(cx, cz, 10) || Math.hypot(cx, cz) < 18) continue;
            const g = buildQuayCrane();
            g.position.set(cx, w.terrainHeight(cx, cz) - 0.1, cz);
            g.rotation.y = ry;
            w.scene.add(g);
            w.meshes.push(g);
            for (const lx of [-6, 6])
              for (const lz of [-8, 8])
                w.obstacles.push({
                  kind: 'circle',
                  x: cx + lx * cr + lz * sr,
                  z: cz - lx * sr + lz * cr,
                  r: 0.9,
                  group: g,
                  mats: [],
                  box: null,
                  h: 24,
                });
          }
          // 岸上的貨櫃堆（離岸壁 14 m 以上）、散落的貨櫃與繫船柱
          containerRows(
            w,
            Math.abs(c) > Math.abs(s) ? 0 : 1,
            50 * w.k,
            [12, 16],
            [2, 3],
            (x, z) => x * c + z * s < u0 - 16,
          );
          looseContainers(w, w.cnt(4, 6));
          for (let v = -55 * w.k; v < 55 * w.k; v += 9) {
            const x = c * (u0 - 1.2) - s * v,
              z = s * (u0 - 1.2) + c * v;
            const b = buildBollard();
            b.position.set(x, w.terrainHeight(x, z), z);
            w.scene.add(b);
            w.meshes.push(b);
          }
        },
      },
      // 地圖的一側是海：岸壁往下 7 m
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = r() * Math.PI * 2;
        w.sea = [Math.cos(a), Math.sin(a)];
        w.seaU = (24 + r() * 10) * w.k;
        const [c, s] = w.sea;
        return (x, z, h) => {
          const u = x * c + z * s;
          return h * 0.25 - 7.5 * smooth(clamp((u - w.seaU) / 3, 0, 1));
        };
      },
      // 海裡不放東西、不生成
      offLimits: (w, x, z) => w.terrainHeight(x, z) < -1,
    },
  },
  institute: {
    core: {
      name: '研究核心',
      theme: { featureKinds: ['platforms'], fog: 0x3a1418, fogFar: 120, sunI: 0.35 },
      // 研究棟更多、更高
      build(w) {
        for (let k = w.cnt(3, 5); k > 0; k--) {
          const bw = rnd(12, 20),
            bd = rnd(10, 16),
            h = rnd(16, 26);
          place(w, buildLab(bw, h, bd, Math.floor(rnd(0, 1e6))), [-bw / 2, bw / 2, -bd / 2, bd / 2], 2.5, [
            { box: [-bw / 2, bw / 2, -bd / 2, bd / 2], y: 0, top: h },
          ]);
        }
      },
    },
    cavern: {
      name: '巨大空洞',
      theme: {
        featureKinds: ['trench'],
        roof: { y: 60, color: 0x221c1c, bump: 18 },
        fogFar: 190,
        // 沒有研究棟：粗大的岩柱與起伏的地面
        buildStructures(w) {
          for (let k = w.cnt(6, 9); k > 0; k--) {
            const r = rnd(5, 9);
            const spot = w.findSpot([-r, r, -r, r], 5, 30);
            if (!spot) continue;
            const g = buildCavePillar(r, 64 - spot.lo);
            g.position.y = spot.lo - 0.5;
            w.addBig(g, spot, [{ c: [0, 0], r: r * 0.9, h: 60 }], false);
          }
        },
      },
      terrain: () => (x, z, h) => h * 2.4,
    },
    tanks: {
      name: '收容區',
      theme: { featureKinds: ['bunkers'] },
      // 成排的 Coral 收容槽
      build(w) {
        const axis = rndi(0, 1);
        for (let off = -40 * w.k; off <= 40 * w.k; off += rnd(12, 16)) {
          if (Math.abs(off) < 8) continue;
          for (let v = -44 * w.k; v < 44 * w.k; v += 7) {
            const x = axis ? v : off,
              z = axis ? off : v;
            if (Math.hypot(x, z) < 10 || w.onCorridor(x, z, 4) || !free(w, x, z, 2, 2, 0.5)) continue;
            w.addSmall(
              buildCoralTank(),
              x,
              w.terrainHeight(x, z) - 0.1,
              z,
              { r: 2, h: 5.6 },
              'coraltank',
              2000,
              0xff3a30,
            );
          }
        }
      },
    },
    entrance: {
      name: '地表入口',
      border: true, // 交界區段：冰原往地下技研都市過渡
      theme: {
        roof: null,
        weather: 'snow',
        ground: 0x9aa4ae,
        slope: 0x4a5058,
        sky: 0xa8b4c0,
        fog: 0xa8b4c0,
        sunI: 0.8,
        hemiI: 0.9,
        fogFar: 170,
      },
      // 地面往一側下陷，盡頭是研究所的大型閘門
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = r() * Math.PI * 2;
        w.sinkDir = [Math.cos(a), Math.sin(a)];
        const [c, s] = w.sinkDir;
        return (x, z, h) => h - 10 * smooth(clamp((x * c + z * s - 12) / (45 * w.k), 0, 1));
      },
      build(w) {
        const [c, s] = w.sinkDir;
        const d = 48 * w.k,
          x = c * d,
          z = s * d;
        const g = buildFacilityGate();
        g.rotation.y = Math.atan2(-c, -s);
        const ob = w.addSmall(g, x, w.terrainHeight(x, z) - 0.5, z, { w: 10, h: 16, d: 10 });
        ob.mats = [];
      },
    },
  },
  snow: {
    blizzard: {
      name: '暴風雪',
      theme: {
        featureKinds: ['bunkers', 'platforms'],
        fogNear: 10,
        fogFar: 72,
        fog: 0xdfe6ec,
        sky: 0xdfe6ec,
        sunI: 0.5,
        hemiI: 1.05,
      },
    },
    crevasse: {
      name: '冰河裂谷',
      theme: { featureKinds: ['platforms'], corridor: { p: 0.3, kinds: ['road'] }, slope: 0x7a96b0 },
      // 三道深 9 m 的冰河裂縫（避開出生點附近）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const cuts = [];
        for (let i = 0; i < 3; i++) {
          const a = r() * Math.PI,
            off = (r() * 2 - 1) * 45 * w.k;
          if (Math.abs(off) < 12) continue;
          cuts.push({ c: Math.cos(a), s: Math.sin(a), off, wd: 4 + r() * 3 });
        }
        return (x, z, h) => {
          let k = 0;
          for (const q of cuts) {
            const u = Math.abs(-x * q.s + z * q.c - q.off);
            k = Math.max(k, 1 - smooth(clamp((u - q.wd) / 3, 0, 1)));
          }
          return h - 9 * k;
        };
      },
      offLimits: (w, x, z) => w.terrainHeight(x, z) < -3,
    },
    outpost: {
      name: '前線基地',
      theme: { featureKinds: ['bunkers'], corridor: { p: 0.7, kinds: ['road'] } },
      // 圍住中央的防爆牆（留缺口）與四角的瞭望塔
      build(w) {
        const R = rnd(26, 34) * w.k;
        for (const [ax, sgn] of [
          [0, 1],
          [0, -1],
          [1, 1],
          [1, -1],
        ]) {
          for (let v = -R; v < R; v += 10) {
            if (Math.abs(v + 5) < 7) continue; // 正中央的缺口
            const x = ax ? sgn * R : v + 5,
              z = ax ? v + 5 : sgn * R;
            if (w.onCorridor(x, z, 6) || w.isReserved(x, z, 2) || !free(w, x, z, ax ? 1 : 5, ax ? 5 : 1, 0.5))
              continue;
            const g = buildSnowWall(9.6);
            if (ax) g.rotation.y = Math.PI / 2;
            w.addSmall(
              g,
              x,
              w.terrainHeight(x, z) - 0.3,
              z,
              { w: ax ? 1.4 : 9.6, h: 4.8, d: ax ? 9.6 : 1.4 },
              'snowwall',
              5000,
              0x8e8a82,
            );
          }
          const tx = sgn * (R + 6) * (ax ? 1 : -1),
            tz = sgn * (R + 6);
          if (!w.onCorridor(tx, tz, 4) && free(w, tx, tz, 2, 2, 0.5))
            w.addSmall(
              buildWatchtower(),
              tx,
              w.terrainHeight(tx, tz) - 0.2,
              tz,
              { r: 2, h: 10.5 },
              'tower',
              3000,
              0x9aa0a6,
            );
        }
      },
    },
    icefield: {
      name: '大冰湖',
      theme: { featureKinds: ['bunkers', 'platforms'], corridor: { p: 0.2, kinds: ['road'] } },
      // 地圖的一大片是結冰的湖面（冰面上滑行砲車更快）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = r() * Math.PI * 2;
        w.iceBig = { x: Math.cos(a) * 30 * w.k, z: Math.sin(a) * 30 * w.k, r: (34 + r() * 10) * w.k };
        const L = w.iceBig;
        return (x, z, h) => {
          const t = clamp((L.r - Math.hypot(x - L.x, z - L.z)) / 8, 0, 1);
          return h + (-0.7 - h) * smooth(t);
        };
      },
      build(w) {
        const L = w.iceBig;
        const ice = buildIceSheet(L.r, L.r, makeRng(w.seed * 71 + 29));
        ice.position.set(L.x, -0.65, L.z);
        w.scene.add(ice);
        w.meshes.push(ice);
      },
    },
  },
  flooded: {
    highway: {
      name: '高架道路',
      theme: {
        featureKinds: ['bunkers', 'platforms'],
        // 一條橫越市區的高架道路（高 7.5 m，可以站上去），大樓避開它
        buildProps(w) {
          const axis = rndi(0, 1);
          const off = rnd(-30, 30) * w.k;
          const y = 7.5;
          const half = w.size / 2;
          for (let s = -half + 10; s < half - 10; s += 20) {
            const x = axis ? s : off,
              z = axis ? off : s;
            if (Math.abs(x) < 7 && Math.abs(z) < 7) continue; // 出生點留空
            w.addDeck(x, z, axis ? 20.2 : 11, axis ? 11 : 20.2, y, 0.9, 0);
            for (const k of [-1, 1]) {
              const px = x + (axis ? 0 : k * 3.5),
                pz = z + (axis ? k * 3.5 : 0);
              w.addPillar(px, pz, 0.9, w.terrainHeight(px, pz) - 0.3, y - 0.9);
            }
          }
          const x0 = axis ? -half : off - 6,
            x1 = axis ? half : off + 6,
            z0 = axis ? off - 6 : -half,
            z1 = axis ? off + 6 : half;
          w.reserve(x0, x1, z0, z1);
          FLOODED.buildProps(w);
        },
      },
    },
    canal: {
      name: '水道',
      theme: { featureKinds: ['overpass', 'bunkers'] },
      // 兩條很深的水道（水深約 2.5 m，涉水更慢；潛航砲艇的地盤）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = (r() * 2 - 1) * 40 * w.k,
          b = (r() * 2 - 1) * 40 * w.k;
        return (x, z, h) => {
          const t = Math.min(Math.abs(x - a), Math.abs(z - b));
          return lerpH(h, -2.4, 1 - smooth(clamp((t - 6) / 3, 0, 1)));
        };
      },
    },
    suburb: {
      name: '郊區',
      theme: {
        featureKinds: ['bunkers', 'overpass'],
        fogFar: 190,
        sunI: 0.85,
        // 低矮的住宅廢墟（4～8 m，屋頂可站）、車輛、路燈；沒有高樓
        buildProps(w) {
          w.scatter(w.cnt(16, 22), 7, (x, z, y) => {
            if (w.terrainHeight(x, z) < 0.3) return;
            const bw = rnd(6, 10),
              bd = rnd(6, 9),
              h = rnd(4, 8);
            const g = buildRuinTower(bw, h, bd, rnd(0, 1) < 0.4, Math.floor(rnd(0, 1e6)));
            w.addSmall(g, x, y - 0.3, z, { w: bw, h, d: bd });
          });
          w.scatter(
            w.cnt(8, 12),
            6,
            (x, z, y) => {
              const color = pick([0x7a3a2a, 0x3a4a5a, 0x6a6a5a, 0x8a7a3a]);
              const g = buildWreckCar(color);
              w.addSmall(g, x, y - 0.1, z, { w: CAR[0], h: CAR[1], d: CAR[2] }, 'car', 900, color);
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
        },
      },
    },
    toxic: {
      name: '汙染沼澤',
      theme: {
        featureKinds: ['bunkers', 'platforms'],
        water: { level: 0.2, color: 0x4e5e1e, opacity: 0.93 },
        fog: 0x8a9a5a,
        sky: 0x9aa86a,
        fogNear: 30,
        fogFar: 140,
        weather: 'ash',
        propNames: { drum: '汙染物桶' },
      },
      // 整片往下沉，大部分街區泡在水裡
      terrain: () => (x, z, h) => h - 0.55,
      build(w) {
        w.scatter(
          w.cnt(14, 20),
          4,
          (x, z, y) => {
            const g = buildToxicDrum();
            g.rotation.set(rnd(-0.3, 0.3), rnd(0, 6), rnd(-0.3, 0.3));
            w.addSmall(g, x, y - 0.2, z, { r: 0.5, h: 1.2 }, 'drum', 300, 0x8a9a2a);
          },
          false,
        );
      },
    },
  },
  dam: {
    gorge: {
      name: '峽谷段',
      theme: {
        featureKinds: ['bunkers', 'platforms'],
        corridor: { p: 0.3, kinds: ['road'] },
        rock: 0x3e3c36,
      },
      // 洩洪河道兩側（離河道 40 m 外）是陡峭的岩壁，壩體兩端埋進岩壁裡
      terrain: (w) => (x, z, h) => h + 17 * smooth(clamp((Math.abs(x - w.dam.xr) - 40 * w.k) / 9, 0, 1)),
      offLimits: (w, x, z) => w.terrainHeight(x, z) > 8,
    },
    weirs: {
      name: '攔砂壩群',
      theme: { featureKinds: ['bunkers'], corridor: { p: 0.4, kinds: ['road', 'rail'] } },
      // 下游兩道低矮的攔砂壩（高 4～5 m，跳得過去），河道與公路處留缺口
      build(w) {
        const D = w.dam,
          dn = -D.up;
        const half = w.size / 2;
        for (const off of [26 * w.k, 52 * w.k]) {
          const z = D.zc + dn * (off + rnd(-4, 4));
          const gx = rnd(-w.lim * 0.7, w.lim * 0.7);
          for (let x = -half + 6; x < half - 6; x += 12) {
            if (
              Math.abs(x - D.xr) < 10 ||
              Math.abs(x - gx) < 8 ||
              w.onCorridor(x, z, 7) ||
              w.isReserved(x, z, 2)
            )
              continue;
            if (Math.abs(x) > w.limOut) continue;
            const h = rnd(4, 5);
            const y = w.terrainHeight(x, z) - 1;
            w.addSmall(buildWeir(12, h + 1), x, y, z, { w: 12, h: h + 1, d: 3 });
          }
        }
      },
    },
    plant: {
      name: '水力發電廠',
      theme: { featureKinds: ['bunkers', 'trench'], corridor: { p: 0.5, kinds: ['road'] } },
      // 壩體下游的發電廠房、從壩體往下游的壓力水管
      build(w) {
        const D = w.dam,
          dn = -D.up;
        for (let k = 0; k < 2; k++) {
          const x = rnd(-w.lim * 0.6, w.lim * 0.6);
          if (Math.abs(x - D.xr) < 16) continue;
          const z = D.zc + dn * (18 + k * 6);
          const len = 22;
          const cz = z + (dn * len) / 2;
          if (w.onCorridor(x, cz, 6) || !free(w, x, cz, 2, len / 2)) continue;
          for (const s of [-1, 1]) {
            const g = buildPenstock(len);
            const px = x + s * 3;
            w.addSmall(g, px, w.terrainHeight(px, cz) - 0.3, cz, { w: 3, h: 3.4, d: len });
          }
        }
        for (let k = w.cnt(1, 2); k > 0; k--) {
          const hw = 14,
            hd = 8,
            hh = 11;
          place(w, buildWarehouse(hw * 2, hd * 2, hh, 0xa8a49a), [-hw - 1, hw + 1, -hd - 1, hd + 1], 2.5, [
            { box: [-hw, -4, -hd - 0.3, -hd + 0.3], top: hh },
            { box: [4, hw, -hd - 0.3, -hd + 0.3], top: hh },
            { box: [-hw, -4, hd - 0.3, hd + 0.3], top: hh },
            { box: [4, hw, hd - 0.3, hd + 0.3], top: hh },
            { box: [-4, 4, -hd - 0.3, -hd + 0.3], y: 6, top: hh },
            { box: [-4, 4, hd - 0.3, hd + 0.3], y: 6, top: hh },
            { box: [-hw - 0.3, -hw + 0.3, -hd, hd], top: hh },
            { box: [hw - 0.3, hw + 0.3, -hd, hd], top: hh },
          ]);
        }
      },
    },
    storm: {
      name: '暴雨洩洪',
      theme: {
        featureKinds: ['platforms', 'trench'],
        weather: 'rain',
        fogNear: 22,
        fogFar: 115,
        fog: 0x7a8488,
        sky: 0x6a7478,
        sunI: 0.5,
        hemiI: 0.75,
      },
      // 下游的河道變寬變深
      terrain: (w) => (x, z, h) => {
        const D = w.dam;
        const u = (z - D.zc) * D.up;
        if (u > 0) return h;
        const c = clamp(1 - (Math.abs(x - D.xr) - 12) / 8, 0, 1);
        return h - 2.2 * smooth(c) * clamp(-u / 12, 0, 1);
      },
    },
  },
  wasteland: {
    factory: {
      name: '廢工廠群',
      theme: { featureKinds: ['bunkers', 'platforms'], corridor: { p: 0.35, kinds: ['road'] } },
      // 廠區整地：地形壓平
      terrain: () => (x, z, h) => h * 0.3,
      build(w) {
        for (let k = w.cnt(5, 7); k > 0; k--) {
          const hw = rndi(6, 10),
            hd = rndi(6, 9),
            hh = rnd(7, 11);
          place(w, buildFactoryHall(hw * 2, hd * 2, hh), [-hw - 1, hw + 1, -hd - 1, hd + 1], 2.5, [
            { box: [-hw, hw, -hd - 0.4, -hd + 0.4], top: hh },
            { box: [-hw - 0.4, -hw + 0.4, -hd, hd], top: hh },
            { box: [hw - 0.4, hw + 0.4, -hd, hd], top: hh },
            { box: [-hw, -4, hd - 0.4, hd + 0.4], top: hh },
            { box: [4, hw, hd - 0.4, hd + 0.4], top: hh },
          ]);
        }
      },
    },
    pipeline: {
      name: '輸油管線帶',
      theme: { featureKinds: ['trench'], corridor: { p: 0.5, kinds: ['rail'] } },
      terrain: () => (x, z, h) => h * 0.55,
      build(w) {
        // 幾條平行的地面管線（中間留缺口可以穿過）＋泵站
        const axis = rndi(0, 1);
        const lines = rndi(3, 4);
        const span = 50 * w.k;
        for (let i = 0; i < lines; i++) {
          const off = -span * 0.8 + ((span * 1.6) / (lines - 1)) * i + rnd(-4, 4);
          if (Math.abs(off) < 8) continue;
          let s = -span;
          while (s < span) {
            const len = rnd(22, 36);
            const c = s + len / 2;
            const x = axis ? c : off,
              z = axis ? off : c;
            if (!w.onCorridor(x, z, 6) && !w.isReserved(x, z, 3)) {
              const g = buildGroundPipe(len);
              const y = w.terrainHeight(x, z) - 0.2;
              g.position.set(x, y, z);
              if (axis) g.rotation.y = Math.PI / 2;
              w.scene.add(g);
              w.meshes.push(g);
              w.obstacles.push({
                kind: 'box',
                x,
                z,
                w: axis ? len : 1.6,
                d: axis ? 1.6 : len,
                y,
                top: y + 1.7,
                group: g,
                mats: [],
                box: null,
              });
            }
            s += len + rnd(9, 14);
          }
        }
        for (let k = w.cnt(2, 3); k > 0; k--)
          place(w, buildPumpStation(), [-9, 8, -4, 4], 2, [
            { box: [-4, 4, -3, 3], top: 5.5 },
            { c: [-6.5, 0], r: 2, h: 6 },
            { c: [6, 1], r: 1.6, h: 5 },
          ]);
      },
    },
    slag: {
      name: '礦渣堆場',
      theme: {
        featureKinds: ['platforms'],
        corridor: { p: 0.25, kinds: ['rail'] },
        ground: 0x6a5c52,
        slope: 0x433832,
        rock: 0x2e2824,
        fog: 0xa8988a,
      },
      // 十幾座圓錐形的渣山（避開中央出生點）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const heaps = [];
        const L = 52 * w.k;
        for (let t = 0; t < 80 && heaps.length < Math.round(12 * w.k); t++) {
          const x = (r() * 2 - 1) * L,
            z = (r() * 2 - 1) * L;
          if (Math.hypot(x, z) < 22) continue;
          if (heaps.some((q) => Math.hypot(q.x - x, q.z - z) < q.r * 0.8)) continue;
          heaps.push({ x, z, r: 9 + r() * 10, h: 5 + r() * 9 });
        }
        return (x, z, h) => {
          let m = h * 0.5;
          for (const q of heaps) {
            const t = clamp(1 - Math.hypot(x - q.x, z - q.z) / q.r, 0, 1);
            m = Math.max(m, h * 0.5 + q.h * smooth(t));
          }
          return m;
        };
      },
    },
    junction: {
      name: '公路交流道',
      theme: { featureKinds: ['overpass', 'bunkers'], corridor: { p: 1, kinds: ['road'] } },
      terrain: () => (x, z, h) => h * 0.4,
      build(w) {
        // 護欄列與燒毀的車輛
        w.scatter(w.cnt(10, 14), 7, (x, z, y) => {
          const g = buildBarrier();
          g.rotation.y = rndi(0, 1) * (Math.PI / 2);
          const a = g.rotation.y ? 1 : 0;
          w.addSmall(g, x, y, z, { w: a ? 0.9 : 4, h: 1.1, d: a ? 4 : 0.9 });
        });
        w.scatter(w.cnt(6, 9), 8, (x, z, y) => {
          const g = buildCarWreck();
          w.addSmall(g, x, y, z, { r: 1.6, h: 1.8 }, 'car', 600, 0x5e3e28);
        });
      },
    },
  },
  dunes: {
    ridges: {
      name: '巨大沙丘脊',
      theme: { featureKinds: ['platforms'], corridor: { p: 0.25, kinds: ['road'] } },
      // 沙丘的起伏放大：高低差大、視線常被擋住
      terrain: () => (x, z, h) => h * 1.8,
    },
    flats: {
      name: '鹽灘平原',
      theme: {
        featureKinds: ['bunkers', 'trench'],
        corridor: { p: 0.6, kinds: ['road'] },
        ground: 0xd8ceb4,
        slope: 0xb8aa8a,
        fog: 0xe8e0cc,
        sky: 0xf0e8d8,
      },
      terrain: () => (x, z, h) => h * 0.2,
      build(w) {
        // 鹽柱（可破壞）
        w.scatter(w.cnt(14, 20), 8, (x, z, y) => {
          const h = rnd(2.5, 6);
          const g = buildSaltPillar(h);
          g.rotation.y = rnd(0, 6.28);
          w.addSmall(g, x, y - 0.2, z, { r: 0.9, h }, 'salt', 500, 0xe8e2d0);
        });
      },
    },
    wrecks: {
      name: '艦體墓場',
      theme: { featureKinds: ['bunkers'], corridor: { p: 0.3, kinds: ['road'] } },
      build(w) {
        for (let i = 0; i < 2; i++) w.buildWrecks();
      },
    },
    storm: {
      name: '沙暴區',
      theme: {
        featureKinds: ['bunkers', 'platforms'],
        fogNear: 14,
        fogFar: 85,
        fog: 0xc8a878,
        sky: 0xc8a878,
        sunI: 0.55,
        hemiI: 0.85,
        weather: 'sand',
      },
    },
  },
  desert: {
    openpit: {
      name: '露天礦場',
      theme: { featureKinds: ['platforms'], corridor: { p: 0.3, kinds: ['rail'] } },
      // 階梯式大坑：中心在出生點附近，4 層平台
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const cx = (r() - 0.5) * 30,
          cz = (r() - 0.5) * 30,
          R = 58 * w.k,
          D = 20;
        return (x, z, h) => {
          const t = clamp(1 - Math.hypot(x - cx, z - cz) / R, 0, 1);
          const st = 4;
          const f = t * st;
          const i = Math.floor(f),
            fr = f - i;
          const step = (i + smooth(clamp((fr - 0.7) / 0.3, 0, 1))) / st;
          return h * 0.4 - D * step;
        };
      },
    },
    tunnels: {
      name: '坑道網',
      theme: {
        featureKinds: ['bunkers'],
        corridor: { p: 0, kinds: [] },
        roof: { y: 17, color: 0x2e2620, bump: 5 },
        sunI: 0.45,
        hemiI: 0.7,
        fogNear: 25,
        fogFar: 130,
        fog: 0x4a3c30,
        sky: 0x2a2018,
      },
      // 岩壁圍出的坑道：幾條沿 X／Z 的通道（一條經過中心），通道外是岩壁
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const L = 60 * w.k;
        const xs = [0],
          zs = [0];
        for (let i = 0; i < 2; i++) {
          xs.push((r() * 2 - 1) * L * 0.75);
          zs.push((r() * 2 - 1) * L * 0.75);
        }
        const halls = [];
        for (let i = 0; i < 3; i++)
          halls.push({ x: (r() * 2 - 1) * L * 0.6, z: (r() * 2 - 1) * L * 0.6, r: 12 + r() * 8 });
        const half = 7;
        return (x, z, h) => {
          let d = 1e9;
          for (const a of xs) d = Math.min(d, Math.abs(x - a));
          for (const b of zs) d = Math.min(d, Math.abs(z - b));
          for (const q of halls) d = Math.min(d, Math.hypot(x - q.x, z - q.z) - q.r + half);
          const t = clamp((d - half) / 4, 0, 1);
          return h * 0.2 + 21 * smooth(t);
        };
      },
      // 岩壁（高過岩頂）上不放東西、不生成
      offLimits: (w, x, z) => w.terrainHeight(x, z) > 6,
    },
    shaft: {
      name: '豎井大廳',
      theme: { featureKinds: ['bunkers'], corridor: { p: 0, kinds: [] }, fogFar: 160 },
      // 中央的大豎井（碗形下陷）與環狀台階
      terrain(w) {
        const R = 40 * w.k,
          D = 18;
        return (x, z, h) => {
          const d = Math.hypot(x, z);
          const t = clamp(1 - d / R, 0, 1);
          const ring = d > R * 0.55 && d < R * 0.7 ? 0.45 : null;
          const k = ring !== null ? Math.min(ring, smooth(t)) : smooth(t);
          return h * 0.6 - D * k;
        };
      },
      build(w) {
        // 豎井壁上的懸空平台
        const R = 40 * w.k;
        const n = rndi(4, 6);
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2);
          const x = Math.cos(a) * R * 0.78,
            z = Math.sin(a) * R * 0.78;
          const y = w.terrainHeight(x, z) + rnd(5, 8);
          w.addDeck(x, z, rnd(8, 12), rnd(8, 12), y, 0.8, 0);
        }
      },
    },
    vein: {
      name: '地下礦脈',
      theme: {
        featureKinds: ['bunkers', 'trench'],
        corridor: { p: 0, kinds: [] },
        roof: { y: 22, color: 0x1e1a22, bump: 9 },
        sunI: 0.3,
        hemiI: 0.55,
        fogNear: 20,
        fogFar: 120,
        fog: 0x2a2434,
        sky: 0x16121c,
        ground: 0x5a4a44,
        slope: 0x3e3230,
        rock: 0x2a2226,
      },
      build(w) {
        w.scatter(w.cnt(16, 22), 7, (x, z, y) => {
          const h = rnd(2, 4.5);
          const g = buildCrystal(h);
          g.rotation.y = rnd(0, 6.28);
          w.addSmall(g, x, y, z, { r: h * 0.3, h }, 'crystal', 400, 0x7fe0ff);
        });
      },
    },
    outskirts: {
      name: '礦場外圍',
      border: true, // 交界區段：地表主題往礦坑過渡
      theme: {
        featureKinds: ['bunkers', 'trench'],
        corridor: { p: 0.8, kinds: ['rail'] },
        ground: 0x8a7458,
        slope: 0x5e4a3a,
        weather: 'dust',
      },
      // 地面往一側下陷（礦坑的方向）
      terrain(w) {
        const r = makeRng(w.seed * 71 + 13);
        const a = r() * Math.PI * 2,
          c = Math.cos(a),
          s = Math.sin(a);
        w.sinkDir = [c, s];
        return (x, z, h) => {
          const u = x * c + z * s;
          return h - 12 * smooth(clamp((u - 10) / (50 * w.k), 0, 1));
        };
      },
      build(w) {
        const [c, s] = w.sinkDir || [1, 0];
        // 坑口放在下陷的那一側
        for (let t = 0; t < 10; t++) {
          const d = 45 * w.k + rnd(-6, 6),
            x = c * d + rnd(-10, 10),
            z = s * d + rnd(-10, 10);
          if (w.onCorridor(x, z, 8) || w.isReserved(x, z, 6)) continue;
          const g = buildMinePortal();
          const y = w.terrainHeight(x, z);
          g.rotation.y = Math.atan2(-c, -s);
          const ob = w.addSmall(g, x, y - 0.3, z, { w: 20, h: 13, d: 6 });
          ob.mats = [];
          break;
        }
      },
    },
  },
};
export const variantKeys = (theme) => Object.keys(VARIANTS[theme] || {});
export const variantOf = (theme, key) => (VARIANTS[theme] || {})[key] || null;
// 模型庫登記：[key, 名稱, 備註, build]
export const VARIANT_CATALOG = [
  [
    'container_stack',
    '貨櫃堆',
    '集散場「貨櫃迷宮」等；2–4 層、長 12–24 m，可破壞',
    () => buildContainerStack(14, 3, YARD_COLS),
  ],
  [
    'warehouse',
    '倉庫',
    '集散場「倉庫區」；寬 18–26、深 14–18、高 9–12 m，大門下 6 m 可通行',
    () => buildWarehouse(22, 16, 10, 0x7a8894),
  ],
  ['boxcar', '有蓋貨車', '集散場「貨運調度場」；長 12 m，可破壞', () => buildBoxcar(12, 0x8a3a2a)],
  ['rail_track', '側線軌道', '集散場「貨運調度場」的裝飾；長 12 m', () => buildTrack(12)],
  [
    'quay_crane',
    '岸壁起重機',
    '集散場「港灣碼頭」；高約 30 m，吊臂伸向海面，四支腳有碰撞',
    () => buildQuayCrane(),
  ],
  ['bollard', '繫船柱', '集散場「港灣碼頭」的裝飾', () => buildBollard()],
  ['facility_gate', '研究所閘門', '技研都市「地表入口」；寬 28、高 17 m', () => buildFacilityGate()],
  ['snow_wall', '防爆牆', '冰原「前線基地」；長 9.6、高 4.8 m，可破壞', () => buildSnowWall(9.6)],
  ['watchtower', '瞭望塔', '冰原「前線基地」；高約 10.5 m，可破壞', () => buildWatchtower()],
  ['toxic_drum', '汙染物桶', '水沒市街「汙染沼澤」；可破壞', () => buildToxicDrum()],
  ['weir', '攔砂壩', '水壩「攔砂壩群」；長 12、高 5–6 m，不可破壞', () => buildWeir(12, 5)],
  ['penstock', '壓力水管', '水壩「水力發電廠」；長 22 m、管徑 2.4 m', () => buildPenstock(22)],
  [
    'factory_hall',
    '廢工廠廠房',
    '荒野「廢工廠群」；寬 12–20、深 12–18、高 7–11 m',
    () => buildFactoryHall(16, 14, 9),
  ],
  ['ground_pipe', '地面管線', '荒野「輸油管線帶」；長 22–36 m，管徑 1.1 m', () => buildGroundPipe(24)],
  ['pump_station', '泵站', '荒野「輸油管線帶」；8×6 m', () => buildPumpStation()],
  ['barrier', '紐澤西護欄', '荒野「公路交流道」；長 4 m', () => buildBarrier()],
  ['car_wreck', '燒毀的車輛', '荒野「公路交流道」；可破壞', () => buildCarWreck()],
  ['crystal_s', '結晶簇', '礦坑「地下礦脈」；高 2–4.5 m，可破壞', () => buildCrystal(3)],
  ['salt_pillar', '鹽柱', '沙丘「鹽灘平原」；高 2.5–6 m，可破壞', () => buildSaltPillar(4)],
  ['mine_portal', '礦坑坑口', '礦坑「礦場外圍」；寬 20、高 13 m', () => buildMinePortal()],
  ['lift_pad', '升降梯平台', '主線：下降後的入口結構（不碰撞）', () => buildLiftPad()],
  ['landing_zone', '降落區標示', '主線：空降的入口標示（不碰撞）', () => buildLandingZone()],
];
