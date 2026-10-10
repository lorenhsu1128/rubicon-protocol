// 地標：每個區段放一個只出現一次的大型物件，讓區段之間好認（主線的排程保證同一章不重複；自由出擊不放）。
// 網格建造是純函式（不呼叫亂數，尺寸固定）；原點在地面中心，+Z 為正面。放置由 World.addLandmark 處理。
// 欄位：name、build()、bx＝局部外框 [x0, x1, z0, z1]（findSpot 用）、range＝容許的地面高低差、
//       sink＝往地面下沉的深度、shapes＝局部碰撞形狀（box 的 y／top 相對原點；circle 的 h）
import { box, cyl, mat } from './prop-models.js';

const M = {
  hull: mat(0x6c7176),
  hullD: mat(0x4a4e52),
  rust: mat(0x8a5a36, { roughness: 0.85 }),
  rustD: mat(0x5e3e28, { roughness: 0.9 }),
  steel: mat(0x9aa0a6, { metalness: 0.5 }),
  yellow: mat(0xc8a040),
  orange: mat(0xc06a30),
  concrete: mat(0x9a948a, { roughness: 0.95, metalness: 0.02 }),
  dark: mat(0x2a2c2e),
  glow: new THREE.MeshStandardMaterial({ color: 0xff8a30, emissive: 0xff6a10, emissiveIntensity: 1.6 }),
  crystal: new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.2,
    roughness: 0.2,
    metalness: 0.1,
    flatShading: true,
  }),
  dish: new THREE.MeshStandardMaterial({ color: 0x6c7176, side: THREE.DoubleSide, flatShading: true }),
  window: new THREE.MeshStandardMaterial({ color: 0x9fd4ff, emissive: 0x4080b0, emissiveIntensity: 0.5 }),
  blue: mat(0x2b4fb0, { roughness: 0.7 }),
  red: mat(0xb83a2a, { roughness: 0.7 }),
  green: mat(0x3a7a4a, { roughness: 0.7 }),
  white: mat(0xd8d8d0, { roughness: 0.6 }),
};

const group = (...ch) => {
  const g = new THREE.Group();
  for (const c of ch) g.add(c);
  return g;
};
const rot = (o, x = 0, y = 0, z = 0) => {
  o.rotation.set(x, y, z);
  return o;
};

// ---------- 荒野 ----------
// 墜毀運輸艦：長 34 m 的艦體斜插地面，機翼折斷
function crashedShip() {
  const g = new THREE.Group();
  const hull = new THREE.Group();
  hull.add(box(8, 6, 30, M.hull, 0, 3, 0));
  hull.add(box(6, 3, 8, M.hullD, 0, 6.5, -6));
  hull.add(box(5, 4, 4, M.window, 0, 4, 15.5));
  hull.add(box(9, 1.2, 26, M.rustD, 0, 0.4, 0));
  for (const s of [-1, 1]) hull.add(cyl(1.6, 1.8, 5, M.dark, s * 3, 3, -16.5, 10));
  hull.add(rot(box(12, 0.8, 6, M.hull, -9, 3.5, 2), 0, 0, 0.25));
  hull.add(rot(box(7, 0.8, 5, M.rust, 8, 1.2, 5), 0, 0.3, -0.5));
  rot(hull, -0.12, 0.35, 0.08);
  hull.position.y = -1.2;
  g.add(hull);
  for (let i = 0; i < 5; i++) g.add(rot(box(2.5, 1.2, 2, M.rustD, -8 + i * 4, 0.4, 12 - i * 5), 0, i, 0.2));
  return g;
}
// 倒塌的雷達塔：橫躺的格子塔＋碟形天線
function fallenRadar() {
  const g = new THREE.Group();
  const tower = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const z = -14 + i * 5;
    for (const [x, y] of [
      [-1.5, 0],
      [1.5, 0],
      [-1.5, 3],
      [1.5, 3],
    ])
      tower.add(box(0.4, 0.4, 5, M.steel, x, y + 0.6, z + 2.5));
    tower.add(rot(box(0.25, 4.2, 0.25, M.steel, 0, 2.1, z), 0, 0, 0.8));
  }
  g.add(tower);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, 0.9), M.dish);
  rot(dish, 1.2, 0, 0.3);
  dish.position.set(2, 3.2, 20);
  dish.castShadow = true;
  g.add(dish);
  g.add(box(5, 2, 5, M.concrete, 0, 1, -17));
  return g;
}
// 燃燒中的油井：井架＋火炬（發光）＋儲槽
function burningWell() {
  const g = new THREE.Group();
  for (const [x, z] of [
    [-2.5, -2.5],
    [2.5, -2.5],
    [-2.5, 2.5],
    [2.5, 2.5],
  ])
    g.add(rot(box(0.5, 22, 0.5, M.rust, x * 0.6, 11, z * 0.6), x * 0.012, 0, z * 0.012));
  for (let i = 1; i < 6; i++) g.add(box(4.5 - i * 0.4, 0.3, 4.5 - i * 0.4, M.rust, 0, i * 4, 0));
  g.add(box(6, 1, 6, M.concrete, 0, 0.5, 0));
  const fire = cyl(0.2, 2.2, 7, M.glow, 0, 25, 0, 8);
  fire.castShadow = false;
  g.add(fire);
  for (const [x, z, r] of [
    [9, 3, 3.5],
    [9, -5, 3],
    [-8, 6, 2.6],
  ]) {
    g.add(cyl(r, r, 5, M.hull, x, 2.5, z, 14));
    g.add(cyl(r * 0.9, r, 0.6, M.rustD, x, 5.2, z, 14));
  }
  return g;
}
// 半埋的舊 AC 殘骸：巨大頭部與伸出地面的手臂（舊時代的大型機體）
function buriedAc() {
  const g = new THREE.Group();
  const head = group(
    box(7, 5, 7, M.hullD, 0, 2.5, 0),
    box(5.5, 1.2, 0.6, M.glow, 0, 3.2, 3.6),
    box(1.2, 4, 1.2, M.hull, 2.8, 6, -1.5),
    box(8, 1, 3, M.hull, 0, 5.2, -2),
  );
  rot(head, 0.25, 0.6, -0.3);
  head.position.set(-3, -1.2, 0);
  g.add(head);
  const arm = group(
    box(2.6, 12, 2.6, M.hull, 0, 6, 0),
    box(3.2, 3, 3.2, M.hullD, 0, 12, 0),
    box(2.2, 9, 2.2, M.hull, 0, 16.5, 0),
    box(3, 3, 2, M.hullD, 0, 22, 0),
  );
  rot(arm, 0.3, 0, 0.45);
  arm.position.set(7, -2, 4);
  g.add(arm);
  for (let i = 0; i < 6; i++)
    g.add(rot(box(3, 1.5, 2, M.rustD, -9 + i * 3.5, 0.3, -6 + (i % 3) * 3), 0, i, 0.3));
  return g;
}
// 巨型隔牆的破口：兩段高牆夾著塌落的缺口
function breachedWall() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(14, 20, 4, M.concrete, s * 13, 10, 0));
    g.add(box(14, 1.5, 4.6, M.hullD, s * 13, 18, 0));
    for (let i = 0; i < 3; i++) g.add(box(0.8, 20, 0.6, M.dark, s * (8 + i * 4), 10, 2.3));
  }
  for (let i = 0; i < 7; i++)
    g.add(
      rot(
        box(3 + (i % 3), 2 + (i % 2) * 2, 3, M.concrete, -5 + i * 1.7, 1, -3 + (i % 4) * 2),
        i,
        i * 0.7,
        0.3,
      ),
    );
  return g;
}
// 廢棄的煉油塔群：三座高塔與連接管
function crackingTowers() {
  const g = new THREE.Group();
  const T = [
    [-5, 0, 2.2, 24],
    [2, -3, 1.8, 30],
    [4, 4, 2.6, 20],
  ];
  for (const [x, z, r, h] of T) {
    g.add(cyl(r, r * 1.1, h, M.steel, x, h / 2, z, 12));
    for (let y = 4; y < h; y += 5) g.add(cyl(r * 1.25, r * 1.25, 0.5, M.rust, x, y, z, 12));
  }
  g.add(rot(cyl(0.6, 0.6, 9, M.rust, -1.5, 14, -1.5, 8), 0, 0.7, Math.PI / 2));
  g.add(rot(cyl(0.6, 0.6, 8, M.rust, 3, 12, 0.5, 8), Math.PI / 2, 0, 0));
  g.add(box(16, 1, 14, M.concrete, 0, 0.5, 0));
  return g;
}

// ---------- 礦坑 ----------
// 巨型鑽機：履帶底盤＋直立鑽桿
function giantDrill() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) g.add(box(3, 3, 16, M.dark, s * 5, 1.5, 0));
  g.add(box(9, 6, 12, M.yellow, 0, 6, 0));
  g.add(box(6, 4, 5, M.window, 0, 10, 4));
  g.add(box(2.6, 34, 2.6, M.steel, 0, 20, -5));
  g.add(cyl(1.4, 0.2, 6, M.dark, 0, 1.5, -5, 8));
  for (let y = 8; y < 36; y += 6) g.add(box(4, 0.4, 4, M.orange, 0, y, -5));
  return g;
}
// 斗輪採掘機：巨大斗輪＋吊臂＋車體
function bucketWheel() {
  const g = new THREE.Group();
  g.add(box(12, 7, 14, M.yellow, 0, 4, 4));
  g.add(box(14, 2.5, 16, M.dark, 0, 1.2, 4));
  g.add(rot(box(3, 3, 26, M.yellow, 0, 9, -10), 0.25, 0, 0));
  const wheel = new THREE.Mesh(new THREE.TorusGeometry(7, 1.2, 8, 24), M.orange);
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(0, 9, -24);
  wheel.castShadow = true;
  g.add(wheel);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    g.add(box(2, 2, 2, M.dark, 0, 9 + Math.sin(a) * 7.5, -24 + Math.cos(a) * 7.5));
  }
  return g;
}
// 礦石運輸車殘骸：巨大的翻倒卡車
function haulTruck() {
  const g = new THREE.Group();
  const t = group(
    box(9, 5, 16, M.yellow, 0, 4, 0),
    box(10, 6, 9, M.orange, 0, 8, -3),
    box(6, 3, 3, M.window, 0, 8, 6),
  );
  for (const [x, z] of [
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ])
    t.add(rot(cyl(2.6, 2.6, 2, M.dark, x, 2.6, z, 12), 0, 0, Math.PI / 2));
  rot(t, 0, 0.4, 1.35);
  t.position.set(-2, 3, 0);
  g.add(t);
  for (let i = 0; i < 6; i++)
    g.add(rot(box(2, 1.5, 2, M.rustD, 6 + (i % 3) * 2, 0.5, -6 + i * 2.5), i, i, 0));
  return g;
}
// 選礦廠塔：多層廠房＋斜向輸送帶
function processingTower() {
  const g = new THREE.Group();
  g.add(box(10, 26, 10, M.rust, 0, 13, 0));
  g.add(box(12, 1, 12, M.dark, 0, 18, 0));
  g.add(box(8, 6, 8, M.hull, 0, 29, 0));
  g.add(rot(box(2.5, 1.2, 30, M.steel, 0, 12, 16), -0.6, 0, 0));
  for (let i = 0; i < 4; i++) g.add(box(0.6, 12 - i * 3, 0.6, M.rust, 0, (12 - i * 3) / 2, 6 + i * 6));
  return g;
}
// 巨大結晶簇（發光）
function crystalCluster() {
  const g = new THREE.Group();
  const C = [
    [0, 0, 2.2, 16, 0, 0],
    [3, 2, 1.6, 11, 0.3, 0.2],
    [-3, 1, 1.4, 9, -0.35, 0.1],
    [1, -3, 1.2, 8, 0.2, -0.4],
    [-2, -2.5, 1, 6, -0.2, -0.3],
    [4, -1, 0.9, 5, 0.5, -0.1],
  ];
  for (const [x, z, r, h, rx, rz] of C) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6), M.crystal);
    m.position.set(x, h / 2 - 0.5, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  }
  g.add(box(9, 1, 9, M.rustD, 0, 0, 0));
  return g;
}
// 坍塌的礦井升降塔：歪斜的頭架與滑輪
function headframe() {
  const g = new THREE.Group();
  const f = new THREE.Group();
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ])
    f.add(box(0.7, 24, 0.7, M.steel, x, 12, z));
  for (let y = 4; y < 24; y += 5) f.add(box(6.6, 0.4, 6.6, M.steel, 0, y, 0));
  f.add(rot(cyl(3, 3, 0.8, M.dark, 0, 25, 0, 16), Math.PI / 2, 0, 0));
  f.add(rot(box(0.6, 26, 0.6, M.steel, 0, 12, 9), -0.4, 0, 0));
  rot(f, 0.18, 0, -0.12);
  g.add(f);
  g.add(box(10, 3, 10, M.concrete, 0, 1.5, 0));
  return g;
}

// ---------- 貨運集散場 ----------
// 一個貨櫃（長軸沿 X）
const ctr = (m, x, y, z, ry = 0, rz = 0) => rot(box(7, 2.6, 2.6, m, x, y, z), 0, ry, rz);
// 巨型門式起重機：四支腳跨過貨櫃列，頂部大梁與台車，吊著一個貨櫃
function gantryCrane() {
  const g = new THREE.Group();
  for (const x of [-12, 12]) for (const z of [-5, 5]) g.add(box(1.3, 24, 1.3, M.yellow, x, 12, z));
  for (const z of [-5, 5]) g.add(box(28, 2.2, 1.6, M.yellow, 0, 24.6, z));
  for (const x of [-12, 12]) g.add(box(1.2, 1.2, 11, M.yellow, x, 2, 0));
  g.add(box(5, 3, 12, M.hullD, 4, 26.8, 0));
  g.add(box(0.1, 10, 0.1, M.dark, 4, 20, 0));
  g.add(ctr(M.red, 4, 13.8, 0));
  g.add(ctr(M.blue, -4, 1.3, 0));
  g.add(ctr(M.green, -4, 3.9, 0));
  return g;
}
// 調度管制塔：高塔＋玻璃管制室＋天線
function controlTower() {
  const g = new THREE.Group();
  g.add(cyl(2.2, 2.8, 26, M.concrete, 0, 13, 0, 12));
  g.add(box(9, 4, 9, M.window, 0, 28, 0));
  g.add(box(10, 1, 10, M.hullD, 0, 25.6, 0));
  g.add(box(10, 0.8, 10, M.hullD, 0, 30.4, 0));
  g.add(box(0.4, 7, 0.4, M.steel, 2, 34, 1));
  g.add(cyl(1.6, 1.6, 0.3, M.steel, -2, 31.2, -2, 10));
  g.add(box(6, 4, 6, M.concrete, 0, 2, 0));
  return g;
}
// 倒塌的貨櫃塔：疊到很高的貨櫃倒成一堆
function fallenStack() {
  const g = new THREE.Group();
  const C = [M.red, M.blue, M.yellow, M.green, M.white];
  for (let i = 0; i < 3; i++) g.add(ctr(C[i], -4 + i * 0.4, 1.3 + i * 2.6, -2));
  for (let i = 0; i < 3; i++) g.add(ctr(C[(i + 1) % 5], 3.5, 1.3 + i * 2.6, 2.4, 0.2));
  g.add(ctr(C[3], 8, 2.2, -3, 0.6, 0.35));
  g.add(ctr(C[4], -9, 1.6, 3, -0.9, -0.2));
  g.add(ctr(C[0], 1, 8.6, 0.4, 1.2, 0.4));
  g.add(ctr(C[2], 6, 0.9, 6, 1.5, 1.3));
  g.add(ctr(C[1], -6, 1.2, -6, 0.3, 1.5));
  return g;
}
// 翻覆的油罐列車：三節油罐車倒在地上，一節起火
function tankerTrain() {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const t = new THREE.Group();
    const x = -13 + i * 13;
    const c = cyl(1.7, 1.7, 11, i === 1 ? M.rustD : M.white, 0, 0, 0, 14);
    c.rotation.z = Math.PI / 2;
    t.add(c);
    for (const s of [-1, 1]) t.add(box(2.4, 1, 2.4, M.dark, s * 3.6, 1.8, 0));
    t.position.set(x, 1.7, (i % 2) * 1.6);
    t.rotation.set(1.2 * (i === 2 ? -1 : 1), 0.12 * (i - 1), 0);
    g.add(t);
  }
  g.add(cyl(0.6, 2.2, 6, M.glow, 0, 4, 0.8, 8));
  return g;
}
// 穀倉群：四座圓筒穀倉＋高處的輸送橋
function silos() {
  const g = new THREE.Group();
  for (const [x, z] of [
    [-4, -4],
    [4, -4],
    [-4, 4],
    [4, 4],
  ]) {
    g.add(cyl(3, 3, 20, M.white, x, 10, z, 14));
    g.add(cyl(0.5, 3, 2, M.steel, x, 21, z, 14));
  }
  g.add(box(3, 24, 3, M.hullD, 0, 12, 13));
  g.add(rot(box(2, 1.6, 12, M.steel, 0, 22, 7), -0.15, 0, 0));
  return g;
}
// 墜落的貨運飛船：半洩氣的長圓艇身、吊艙與尾翼
function cargoAirship() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), M.white);
  hull.scale.set(16, 5, 5.5);
  hull.position.set(0, 4, 0);
  hull.rotation.set(0, 0, 0.08);
  g.add(hull);
  g.add(rot(box(10, 3, 4, M.hullD, -2, 1.2, 0), 0, 0, 0.05));
  for (const s of [-1, 1]) g.add(rot(box(4, 0.4, 5, M.red, 14, 5, s * 3.5), s * 0.5, 0, 0));
  g.add(box(4, 5, 0.4, M.red, 14.5, 8, 0));
  for (let i = 0; i < 4; i++) g.add(rot(ctr(M.blue, -12 + i * 7, 1.1, 7 - (i % 2) * 2), 0, i * 0.7, 0));
  return g;
}

// ---------- 多重水壩 ----------
// 巨型水輪機：橫倒的轉輪＋葉片＋主軸
function turbineRunner() {
  const g = new THREE.Group();
  const r = new THREE.Group();
  r.add(cyl(2.2, 2.2, 3, M.steel, 0, 0, 0, 16));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    r.add(rot(box(5, 2.6, 0.4, M.hull, Math.cos(a) * 4, 0, Math.sin(a) * 4), 0.4, -a, 0));
  }
  r.add(cyl(6.4, 6.4, 0.6, M.hullD, 0, -1.5, 0, 24));
  rot(r, Math.PI / 2 - 0.25, 0, 0);
  r.position.set(0, 5.6, 0);
  g.add(r);
  g.add(rot(cyl(0.9, 0.9, 10, M.steel, 0, 1, 7, 10), Math.PI / 2 - 0.1, 0, 0));
  return g;
}
// 弧形閘門殘骸：彎曲的門板＋兩支轉臂，斜倒在地上
function radialGate() {
  const g = new THREE.Group();
  const t = new THREE.Group();
  for (let i = 0; i < 7; i++) {
    const a = -0.6 + i * 0.2;
    t.add(rot(box(16, 0.6, 2.4, M.hull, 0, Math.sin(a) * 8, -Math.cos(a) * 8 + 8), a, 0, 0));
  }
  for (const s of [-1, 1]) t.add(rot(box(0.8, 0.8, 8, M.yellow, s * 7.6, 0, 4), 0.2, 0, 0));
  rot(t, 0, 0.3, 0.25);
  t.position.y = 3;
  g.add(t);
  return g;
}
// 取水塔：高塔＋環狀平台＋斷掉的連絡橋
function intakeTower() {
  const g = new THREE.Group();
  g.add(cyl(4, 4.6, 22, M.concrete, 0, 11, 0, 16));
  for (const y of [8, 16, 22]) g.add(cyl(5, 5, 0.6, M.hullD, 0, y, 0, 16));
  g.add(box(3, 3, 3, M.hull, 0, 23.5, 0));
  g.add(rot(box(3, 1, 12, M.concrete, 0, 18, 10), -0.25, 0, 0));
  return g;
}
// 水文觀測站：小屋＋格子天線桅杆＋碟形天線
function gaugeStation() {
  const g = new THREE.Group();
  g.add(box(8, 4, 6, M.white, 0, 2, 0));
  g.add(box(8.6, 0.5, 6.6, M.hullD, 0, 4.2, 0));
  for (let y = 0; y < 18; y += 3) g.add(box(1.2, 0.2, 1.2, M.steel, 7, y + 1.5, 0));
  for (const [x, z] of [
    [6.4, -0.6],
    [7.6, -0.6],
    [6.4, 0.6],
    [7.6, 0.6],
  ])
    g.add(box(0.15, 18, 0.15, M.steel, x, 9, z));
  g.add(rot(cyl(2, 0.3, 0.6, M.dish, -2, 5.2, 0, 14), -0.6, 0, 0));
  return g;
}
// 擱淺的駁船：傾斜的平底船身與散落的貨櫃
function strandedBarge() {
  const g = new THREE.Group();
  const h = new THREE.Group();
  h.add(box(26, 4, 9, M.rustD, 0, 2, 0));
  h.add(box(5, 4, 7, M.hull, 10, 6, 0));
  h.add(ctr(M.blue, -6, 5.3, -2));
  h.add(ctr(M.red, -6, 5.3, 2));
  h.add(ctr(M.green, 1, 5.3, 0));
  rot(h, 0.18, 0.2, 0.06);
  h.position.y = -0.6;
  g.add(h);
  g.add(rot(ctr(M.yellow, -4, 1.2, 8), 0, 0.8, 0.3));
  return g;
}
// 倒塌的輸水橋：三座拱腳＋斷成兩截的渠道，一截落在地上
function aqueduct() {
  const g = new THREE.Group();
  for (const x of [-14, 0, 14]) g.add(box(3, 14, 4, M.concrete, x, 7, 0));
  g.add(box(16, 2.4, 4.6, M.concreteD, -7, 15, 0));
  g.add(rot(box(15, 2.4, 4.6, M.concreteD, 9, 7.5, 0.5), 0, 0.1, 0.9));
  return g;
}

// ---------- 沙丘 ----------
// 半埋巨艦的艦橋：傾斜的高塔與窗
function shipBridge() {
  const g = new THREE.Group();
  const t = group(
    box(10, 18, 8, M.hull, 0, 9, 0),
    box(11, 2.5, 9, M.hullD, 0, 15, 0),
    box(9, 1.6, 0.4, M.window, 0, 15, -4.6),
    box(3, 8, 3, M.hull, 2, 22, 1),
    box(0.6, 6, 0.6, M.steel, -2, 25, 0),
  );
  rot(t, 0.12, 0.4, -0.18);
  t.position.y = -3;
  g.add(t);
  for (let i = 0; i < 5; i++)
    g.add(rot(box(4, 1.5, 3, M.rustD, -8 + i * 4, 0.3, 7 - (i % 2) * 3), 0, i, 0.2));
  return g;
}
// 古代風力塔：高柱＋三片葉片
function windTower() {
  const g = new THREE.Group();
  g.add(cyl(1.2, 2, 30, M.concrete, 0, 15, 0, 10));
  g.add(box(3, 3, 5, M.hull, 0, 30, 0.5));
  const hub = new THREE.Group();
  hub.position.set(0, 30, -2.4);
  g.add(hub);
  for (let i = 0; i < 3; i++) hub.add(rot(box(1.2, 14, 0.3, M.steel, 0, 7, 0), 0, 0, (i * Math.PI * 2) / 3));
  rot(hub, 0, 0, 0.4);
  g.add(box(6, 1, 6, M.concrete, 0, 0.5, 0));
  return g;
}
// 沙中巨像：半埋的巨大石像頭部
function colossus() {
  const g = new THREE.Group();
  const head = group(
    box(12, 14, 11, M.concrete, 0, 7, 0),
    box(9, 2, 1, M.dark, 0, 9, -5.6),
    box(2, 4, 2, M.concrete, 0, 6, -6),
    box(13, 3, 12, M.rust, 0, 15, 0),
  );
  rot(head, -0.15, 0.5, 0.12);
  head.position.y = -4;
  g.add(head);
  return g;
}
// 倒塌的天線陣：幾支高桅杆，一支倒下
function antennaArray() {
  const g = new THREE.Group();
  for (const [x, z, h] of [
    [-8, -6, 22],
    [6, -4, 26],
    [-2, 8, 18],
  ]) {
    g.add(box(0.8, h, 0.8, M.steel, x, h / 2, z));
    for (let y = 4; y < h; y += 6) g.add(box(3, 0.3, 0.3, M.steel, x, y, z));
    g.add(box(2.4, 2.4, 2.4, M.concrete, x, 1.2, z));
  }
  g.add(rot(box(0.8, 24, 0.8, M.steel, 10, 0.8, 8), Math.PI / 2 - 0.05, 0.6, 0));
  return g;
}
// 沙漠要塞門：兩座塔＋拱門
function fortressGate() {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    g.add(box(7, 18, 7, M.concrete, s * 8, 9, 0));
    g.add(box(8, 1.5, 8, M.rust, s * 8, 18.5, 0));
  }
  g.add(box(9, 4, 6, M.concrete, 0, 15, 0));
  g.add(box(4, 1, 0.4, M.glow, 0, 13, -3.2));
  for (let i = 0; i < 4; i++) g.add(rot(box(3, 2, 2.5, M.concrete, -6 + i * 4, 0.6, 5), i, i * 0.6, 0.2));
  return g;
}
// 機械蠍殘骸：身體、彎曲的尾巴、兩隻鉗子
function scorpionWreck() {
  const g = new THREE.Group();
  g.add(rot(box(8, 3, 12, M.hullD, 0, 2, 0), 0, 0, 0.12));
  for (let i = 0; i < 5; i++) {
    const a = i * 0.35;
    g.add(rot(box(2.2, 2.2, 3, M.hull, 0, 4 + Math.sin(a) * 6, 7 + Math.cos(a) * 3 - i * 0.6), -a, 0, 0));
  }
  g.add(cyl(0.2, 0.8, 3, M.glow, 0, 13, 4, 6));
  for (const s of [-1, 1]) {
    g.add(rot(box(1.6, 1.6, 7, M.hull, s * 4.5, 1.6, -8), 0, s * 0.4, 0));
    g.add(rot(box(3, 1.2, 3, M.hullD, s * 6, 1.4, -12), 0, s * 0.8, 0));
  }
  for (let i = 0; i < 6; i++)
    g.add(
      rot(
        box(0.6, 3, 0.6, M.hull, (i < 3 ? -1 : 1) * 4.5, 1.2, -3 + (i % 3) * 3),
        0,
        0,
        (i < 3 ? 1 : -1) * 0.8,
      ),
    );
  return g;
}

export const LANDMARKS = {
  dam: {
    runner: {
      name: '巨型水輪機',
      build: turbineRunner,
      bx: [-8, 8, -8, 13],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 6.5, h: 12 }],
    },
    radial: {
      name: '弧形閘門殘骸',
      build: radialGate,
      bx: [-10, 10, -6, 12],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-8, 8, -1, 9], y: -1, top: 8 }],
    },
    intake: {
      name: '取水塔',
      build: intakeTower,
      bx: [-6, 6, -6, 16],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 4.8, h: 25 }],
    },
    gauge: {
      name: '水文觀測站',
      build: gaugeStation,
      bx: [-5, 9, -4, 4],
      range: 2.5,
      sink: 0.2,
      shapes: [
        { box: [-4, 4, -3, 3], y: -1, top: 4.5 },
        { c: [7, 0], r: 1, h: 18 },
      ],
    },
    barge: {
      name: '擱淺的駁船',
      build: strandedBarge,
      bx: [-14, 14, -6, 11],
      range: 3,
      sink: 0.5,
      shapes: [{ box: [-13, 13, -4.5, 4.5], y: -1, top: 6 }],
    },
    aqueduct: {
      name: '倒塌的輸水橋',
      build: aqueduct,
      bx: [-16, 17, -4, 4],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-15.5, -12.5, -2, 2], y: -1, top: 16 },
        { box: [-1.5, 1.5, -2, 2], y: -1, top: 16 },
        { box: [12.5, 15.5, -2, 2], y: -1, top: 14 },
        { box: [-15, 1, -2.3, 2.3], y: 13.8, top: 16.2, deck: true },
      ],
    },
  },
  industrial: {
    gantry: {
      name: '巨型門式起重機',
      build: gantryCrane,
      bx: [-13, 13, -6, 6],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-12, -5], r: 1, h: 24 },
        { c: [-12, 5], r: 1, h: 24 },
        { c: [12, -5], r: 1, h: 24 },
        { c: [12, 5], r: 1, h: 24 },
        { box: [-7.5, -0.5, -1.3, 1.3], y: 0, top: 5.2 },
      ],
    },
    tower: {
      name: '調度管制塔',
      build: controlTower,
      bx: [-5, 5, -5, 5],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-3, 3, -3, 3], y: -1, top: 31 }],
    },
    stack: {
      name: '倒塌的貨櫃塔',
      build: fallenStack,
      bx: [-12, 12, -9, 9],
      range: 3,
      sink: 0.3,
      shapes: [
        { box: [-7.5, 7.5, -3.5, 3.8], y: -1, top: 8 },
        { box: [-12, -6, 1, 5], y: -1, top: 3 },
      ],
    },
    tanker: {
      name: '翻覆的油罐列車',
      build: tankerTrain,
      bx: [-20, 20, -4, 5],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-19, 19, -2.5, 4], y: -1, top: 4 }],
    },
    silos: {
      name: '穀倉群',
      build: silos,
      bx: [-8, 8, -8, 15],
      range: 3,
      sink: 0.3,
      shapes: [
        { c: [-4, -4], r: 3, h: 22 },
        { c: [4, -4], r: 3, h: 22 },
        { c: [-4, 4], r: 3, h: 22 },
        { c: [4, 4], r: 3, h: 22 },
        { box: [-1.5, 1.5, 11.5, 14.5], y: -1, top: 24 },
      ],
    },
    airship: {
      name: '墜落的貨運飛船',
      build: cargoAirship,
      bx: [-17, 17, -6, 9],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-15, 15, -5, 5], y: -1, top: 8 }],
    },
  },
  dunes: {
    bridge: {
      name: '半埋巨艦的艦橋',
      build: shipBridge,
      bx: [-12, 12, -8, 10],
      range: 5,
      sink: 1,
      shapes: [{ box: [-6, 6, -5, 5], y: -1, top: 20 }],
    },
    turbine: {
      name: '古代風力塔',
      build: windTower,
      bx: [-4, 4, -10, 4],
      range: 3,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 2.4, h: 32 }],
    },
    colossus: {
      name: '沙中巨像',
      build: colossus,
      bx: [-9, 9, -9, 9],
      range: 5,
      sink: 1,
      shapes: [{ box: [-7, 7, -7, 7], y: -1, top: 12 }],
    },
    array: {
      name: '倒塌的天線陣',
      build: antennaArray,
      bx: [-11, 22, -8, 11],
      range: 4,
      sink: 0.3,
      shapes: [
        { c: [-8, -6], r: 1.6, h: 22 },
        { c: [6, -4], r: 1.6, h: 26 },
        { c: [-2, 8], r: 1.6, h: 18 },
      ],
    },
    gate: {
      name: '沙漠要塞門',
      build: fortressGate,
      bx: [-12, 12, -5, 7],
      range: 3,
      sink: 0.5,
      shapes: [
        { box: [-11.5, -4.5, -3.5, 3.5], y: -1, top: 19 },
        { box: [4.5, 11.5, -3.5, 3.5], y: -1, top: 19 },
      ],
    },
    scorpion: {
      name: '機械蠍殘骸',
      build: scorpionWreck,
      bx: [-8, 8, -14, 11],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-4, 4, -6, 6], y: -1, top: 5 }],
    },
  },
  wasteland: {
    ship: {
      name: '墜毀運輸艦',
      build: crashedShip,
      bx: [-11, 11, -18, 18],
      range: 4,
      sink: 0.5,
      shapes: [{ box: [-5, 5, -16, 16], y: -1, top: 8 }],
    },
    radar: {
      name: '倒塌的雷達塔',
      build: fallenRadar,
      bx: [-7, 7, -19, 25],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-2, 2, -19, 15], y: 0, top: 4 },
        { c: [2, 20], r: 5, h: 8 },
      ],
    },
    well: {
      name: '燃燒中的油井',
      build: burningWell,
      bx: [-12, 13, -9, 10],
      range: 3,
      sink: 0.2,
      shapes: [
        { c: [0, 0], r: 3.5, h: 24 },
        { c: [9, 3], r: 3.5, h: 5 },
        { c: [9, -5], r: 3, h: 5 },
        { c: [-8, 6], r: 2.6, h: 5 },
      ],
    },
    ac: {
      name: '半埋的舊 AC 殘骸',
      build: buriedAc,
      bx: [-11, 14, -8, 10],
      range: 4,
      sink: 0.5,
      shapes: [
        { box: [-7, 1, -4, 4], y: -1, top: 6 },
        { c: [9, 5], r: 2.5, h: 18 },
      ],
    },
    wall: {
      name: '巨型隔牆的破口',
      build: breachedWall,
      bx: [-21, 21, -5, 5],
      range: 3,
      sink: 0.5,
      shapes: [
        { box: [-20, -6, -2, 2], y: -1, top: 20 },
        { box: [6, 20, -2, 2], y: -1, top: 20 },
      ],
    },
    towers: {
      name: '廢棄的煉油塔群',
      build: crackingTowers,
      bx: [-9, 9, -8, 8],
      range: 2.5,
      sink: 0.3,
      shapes: [
        { c: [-5, 0], r: 2.5, h: 24 },
        { c: [2, -3], r: 2.1, h: 30 },
        { c: [4, 4], r: 2.9, h: 20 },
      ],
    },
  },
  desert: {
    drill: {
      name: '巨型鑽機',
      build: giantDrill,
      bx: [-7, 7, -9, 9],
      range: 3,
      sink: 0.2,
      shapes: [{ box: [-6.5, 6.5, -8, 8], y: 0, top: 9 }],
    },
    wheel: {
      name: '斗輪採掘機',
      build: bucketWheel,
      bx: [-8, 8, -33, 13],
      range: 4,
      sink: 0.3,
      shapes: [
        { box: [-7, 7, -4, 12], y: 0, top: 8 },
        { c: [0, -24], r: 6, h: 17 },
      ],
    },
    truck: {
      name: '翻倒的礦石運輸車',
      build: haulTruck,
      bx: [-10, 11, -10, 10],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-9, 5, -9, 9], y: 0, top: 9 }],
    },
    plant: {
      name: '選礦廠塔',
      build: processingTower,
      bx: [-7, 7, -7, 30],
      range: 3,
      sink: 0.3,
      shapes: [{ box: [-5, 5, -5, 5], y: 0, top: 32 }],
    },
    crystal: {
      name: '巨大結晶簇',
      build: crystalCluster,
      bx: [-6, 6, -6, 6],
      range: 2.5,
      sink: 0.3,
      shapes: [{ c: [0, 0], r: 4.5, h: 16 }],
    },
    headframe: {
      name: '坍塌的礦井升降塔',
      build: headframe,
      bx: [-6, 6, -6, 15],
      range: 2.5,
      sink: 0.3,
      shapes: [{ box: [-5, 5, -5, 5], y: 0, top: 25 }],
    },
  },
};
export const landmarkKeys = (theme) => Object.keys(LANDMARKS[theme] || {});
