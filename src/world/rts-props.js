// RTS 地圖（world/rts-map.js）的障礙物外觀：plan 的 model 名稱 → 主題的物件網格（prop-models.js 的純函式）。
// 加主題時在 rts-map.js 的 RTS_THEMES 加障礙物種類，這裡加對應的建模。
import {
  WRECK_HULL,
  buildBeacon,
  buildContainer,
  buildDerrick,
  buildFloodlight,
  buildIceChunk,
  buildLampPost,
  buildMiningRig,
  buildOreHopper,
  buildParkedTruck,
  buildQuonset,
  buildRadarDish,
  buildRock,
  buildRockSpire,
  buildSandFence,
  buildSandstone,
  buildStorageTank,
  buildThemeWall,
  buildWreckArch,
  buildWreckHull,
  box,
  cyl,
  mat,
} from './prop-models.js';
import {
  buildCoralCrystal,
  buildCoralTank,
  buildCoralVein,
  buildLab,
  buildPipeRun,
} from './themes/institute.js';
import {
  buildAntennaMast,
  buildBlastWall,
  buildCargoPod,
  buildFuelTruck,
  buildLaunchTower,
} from './themes/spaceport.js';
import { buildBarrels, buildChimney, buildPipeStack, buildScrapHeap, buildShack } from './themes/grid086.js';
import {
  buildBentLamp,
  buildFloatJunk,
  buildRuinTower,
  buildSunkBus,
  buildWreckCar,
} from './themes/flooded.js';
import { buildDamGate, buildTetrapod } from './themes/dam.js';
import { buildQuayCrane, buildTrack } from './variants.js';
import { attrSig, mergeList } from '../render/mesh-merge.js';
import { styleCat } from '../render/style/shader.js';

const HOPPER_COL = [0xb08a3e, 0x8c8f86, 0xa0522d],
  TANK_COL = [0x8a5a3a, 0x9a8f7a, 0x6f7a80],
  QUONSET_COL = [0x6b7d6a, 0xd7a23c, 0x8a949c],
  RADAR_COL = [0x9aa4ad, 0xb8bec4, 0x7d8790],
  POD_COL = [0xe6e8ea, 0xd8a020, 0xb04a2a],
  SHACK_COL = [0x6a6a5a, 0x5a6470, 0x7a5a3a];
// 發射塔（舊宇宙港的 launch_tower 縮小 o.s）：碰撞的方塊（plan 的外框）＝塔＋火箭，中心在群組原點
function launchTower(o) {
  const g = new THREE.Group();
  const m = buildLaunchTower();
  m.scale.setScalar(o.s || 0.55);
  m.position.x = 3.4 * (o.s || 0.55); // 塔（x −10～−4）與火箭（−3.2～3.2）的中心 −3.4 移到原點
  g.add(m);
  return g;
}
// 依 plan 的方塊尺寸縮放（模型原本的尺寸 [w, h, d]）
function scaled(m, o, w0, h0, d0) {
  const [w, d] = unrot(o);
  m.scale.set(w / w0, o.h / h0, d / d0);
  const g = new THREE.Group();
  g.add(m);
  return g;
}
// Grid 086 的油桶群＋低矮的鈉燈
function barrelsLamp(o) {
  const g = new THREE.Group();
  g.add(buildBarrels());
  const pole = mat(0x3a3836, { roughness: 0.8, metalness: 0.4 });
  g.add(cyl(0.08, 0.1, o.h - 0.3, pole, 0.9, (o.h - 0.3) / 2, -0.6, 6));
  g.add(box(0.7, 0.18, 0.3, pole, 0.65, o.h - 0.25, -0.6));
  g.add(
    box(
      0.5,
      0.08,
      0.22,
      mat(0xffb050, { emissive: 0xff8a20, emissiveIntensity: 1.6 }),
      0.55,
      o.h - 0.36,
      -0.6,
    ),
  );
  return g;
}
// 地面的鋼板接縫（沿本地 X 的細長板＋兩側的暗線）與排水溝（格柵）：plan.decor，不碰撞
function seam(o) {
  const g = new THREE.Group();
  const plate = mat(0x55504a, { roughness: 0.7, metalness: 0.6 }),
    dk = mat(0x1e1c1a, { roughness: 1 });
  g.add(box(o.len, 0.06, 1.6, plate, 0, 0.03, 0));
  for (const s of [-1, 1]) g.add(box(o.len, 0.07, 0.12, dk, 0, 0.035, s * 0.86));
  for (let x = -o.len / 2 + 1; x < o.len / 2; x += 2) g.add(box(0.1, 0.075, 1.6, dk, x, 0.04, 0));
  return g;
}
function drain(o) {
  const g = new THREE.Group();
  const dk = mat(0x161412, { roughness: 1 }),
    st = mat(0x6a645c, { roughness: 0.6, metalness: 0.7 });
  g.add(box(o.len, 0.05, 1.1, dk, 0, 0.02, 0));
  for (let x = -o.len / 2 + 0.2; x < o.len / 2; x += 0.35) g.add(box(0.08, 0.08, 1.1, st, x, 0.05, 0));
  for (const s of [-1, 1]) g.add(box(o.len + 0.2, 0.1, 0.12, st, 0, 0.05, s * 0.6));
  return g;
}
// 冰柱（冰原的岩石）：主線冰原的冰塊（buildIceChunk，模型槽 prop/ice_chunk）拉高成柱狀
function iceSpire(o) {
  const g = new THREE.Group();
  const m = buildIceChunk(o.r);
  m.scale.y = o.h / (1.3 * o.r);
  g.add(m);
  return g;
}
// ---------- R5（docs 16.8、16.14）：汙染水沒市街、多重水壩 ----------
const BUS_COL = [0xb08a2a, 0x5a7a8a, 0x8a3a2a],
  CAR_COL = [0x7a3a2a, 0x4a5a6a, 0x8a8478];
const tilted = (m, rx, rz) => {
  const g = new THREE.Group();
  m.rotation.x = rx || 0;
  m.rotation.z = rz || 0;
  g.add(m);
  return g;
};
// 傾倒的建築殘段（主線的大樓廢墟，方塊碰撞＝plan 的外框；頂部崩塌、微微傾斜）
// 窗戶貼圖每個都是複本（uuid 不同就不能靜態合併）：依來源與重複次數共用一份
const RUIN_TEX = new Map();
function ruinBlock(o) {
  const [w, d] = unrot(o);
  const m = buildRuinTower(w, o.h, d, true, ((o.color || 0) % 3) + 1);
  m.traverse((n) => {
    const t = n.isMesh && n.material && n.material.map;
    if (!t || Array.isArray(n.material)) return;
    const k = `${(o.color || 0) % 3}|${t.repeat.x}|${t.repeat.y}`;
    if (!RUIN_TEX.has(k)) RUIN_TEX.set(k, t);
    if (n.material.emissiveMap === t) n.material.emissiveMap = RUIN_TEX.get(k);
    n.material.map = RUIN_TEX.get(k);
  });
  return tilted(m, 0, ((o.color || 0) % 7) * 0.008 - 0.024);
}
// 水窪裡半沉的街區（裝飾）：車頂、歪斜的路燈、號誌、漂浮雜物
function poolSign(o) {
  const g = new THREE.Group();
  const pole = mat(0x6a6e70, { roughness: 0.6, metalness: 0.5 });
  g.add(cyl(0.07, 0.08, 3.6, pole, 0, 1.8, 0, 6));
  g.add(
    box(1.1, 0.75, 0.06, mat([0x2a5aa0, 0xc8a020, 0xa02a2a][o.color || 0], { roughness: 0.5 }), 0, 3.3, 0.06),
  );
  g.add(box(0.95, 0.06, 0.07, mat(0xe8e8e0, { roughness: 0.5 }), 0, 3.3, 0.08));
  return tilted(g, o.tilt || 0, (o.tilt || 0) * 0.6);
}
// 消波塊群（方塊碰撞＝plan 的外框）：格子排列＋依 color 的固定偏移與轉向（不用亂數）
function tetrapods(o) {
  const g = new THREE.Group();
  const [w, d] = unrot(o);
  const nx = Math.max(2, Math.round(w / 2.4)),
    nz = Math.max(1, Math.round(d / 2.4));
  let h = (o.color || 1) >>> 0;
  const nr = () => (h = (h * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const t = buildTetrapod();
      const s = 0.85 + nr() * 0.2;
      t.scale.setScalar(s);
      t.position.set(
        (i - (nx - 1) / 2) * (w / nx) + (nr() - 0.5) * 0.5,
        0,
        (j - (nz - 1) / 2) * (d / nz) + (nr() - 0.5) * 0.5,
      );
      t.rotation.y = nr() * 6.28;
      g.add(t);
    }
  return g;
}
// 閘門零件：主線的閘門（原點在壩頂中心、往下 8.2 m）縮 0.46、立在地面、微微傾斜
function gateWreck() {
  const m = buildDamGate(10);
  m.scale.setScalar(0.46);
  m.position.y = 8.2 * 0.46;
  return tilted(m, 0, 0.07);
}
// 起重機的殘骸：岸壁起重機縮 0.3、往吊臂的反方向傾斜（碰撞是四支腳的外框）
function craneWreck() {
  const m = buildQuayCrane();
  m.scale.setScalar(0.3);
  return tilted(m, 0, 0.09);
}
// 壩頂的護欄（裝飾，沿本地 X）：每 2 m 一支柱＋兩道欄杆
function damRail(o) {
  const g = new THREE.Group();
  const st = mat(0x8a8e90, { roughness: 0.5, metalness: 0.6 }),
    yel = mat(0xd8a020, { roughness: 0.6 });
  for (let x = -o.len / 2 + 0.2; x <= o.len / 2; x += 2) g.add(box(0.12, 1.1, 0.12, st, x, 0.55, 0));
  g.add(box(o.len, 0.08, 0.1, yel, 0, 1.08, 0));
  g.add(box(o.len, 0.06, 0.08, st, 0, 0.6, 0));
  return g;
}
// 燈（障礙物的燈與壩頂的燈）：主線的路燈（原點在中心）立在地面
function damLamp(o) {
  const g = new THREE.Group();
  const m = buildLampPost(o.h || 7, mat(0x6e7274, { roughness: 0.6, metalness: 0.5 }));
  m.position.y = (o.h || 7) / 2;
  g.add(m);
  return g;
}
// ---------- R6（docs 17.4；C 包）：沙丘地帶、礦坑地表、貨運集散場 ----------
const SAND_COL = [0x9a7a56, 0x8a6a4a, 0xa88a62],
  HULL_COL = [0x6a5a4a, 0x5a5048, 0x7a6450],
  RIG_COL = [0xb08a3e, 0x8c6a3a, 0x9a7a52],
  CTR_COL = [0xc0541e, 0x2b4fb0, 0xd8a020, 0x3a7a4a, 0x8a8f96],
  TRUCK_COL = [0xd04a2a, 0x2a5aa0, 0xe0a020];
// 沙丘：半埋的船殼（主線的艦體殘骸縮 0.5、往下埋）、半埋歪斜的路燈、拱形殘骸（裝飾；碰撞是兩支腳 archfoot）
function wreckHull(o) {
  const g = new THREE.Group();
  const m = buildWreckHull(HULL_COL[o.color || 0]);
  m.scale.setScalar(0.5);
  m.position.y = -WRECK_HULL.sink * 0.5;
  m.rotation.z = 0.06;
  g.add(m);
  return g;
}
function sandLamp(o) {
  const g = damLamp(o);
  return tilted(g, 0.12, -0.08);
}
// 礦坑地表：碎石堆（岩石縮放到 plan 的半徑與高度）、採礦機具（斗輪採掘機縮 0.5）
function boulder(o) {
  const g = new THREE.Group();
  const m = buildRock(1, mat(0x6a5440, { roughness: 1, metalness: 0 }));
  m.scale.set(o.r * 1.15, o.h * 0.6, o.r * 1.15);
  m.position.y = o.h * 0.35;
  g.add(m);
  return g;
}
function miningRig(o) {
  const g = new THREE.Group();
  const m = buildMiningRig(RIG_COL[o.color || 0]);
  m.scale.setScalar(0.5);
  g.add(m);
  return g;
}
// 礦車軌道（沿本地 Z，裝飾）與廢棄的礦車
function mineCart(o) {
  const g = new THREE.Group();
  const body = mat([0x6a5a4a, 0x7a4a2a, 0x5a5a5a][o.color || 0], { roughness: 0.9, metalness: 0.4 }),
    dk = mat(0x2a2622, { roughness: 1 });
  g.add(box(1.6, 1, 2.4, body, 0, 0.9, 0));
  g.add(box(1.4, 0.1, 2.2, dk, 0, 1.42, 0));
  for (const z of [-0.8, 0.8]) for (const x of [-0.7, 0.7]) g.add(cyl(0.3, 0.3, 0.16, dk, x, 0.32, z, 8));
  g.children.forEach((c, i) => i >= 2 && (c.rotation.z = Math.PI / 2));
  return tilted(g, 0, (o.color || 0) === 1 ? 0.35 : 0);
}
// 貨運集散場：一個貨櫃（rocks）、貨櫃堆（列 × 層；方塊碰撞＝外框）、停放的卡車、路燈、龍門起重機（裝飾）、棧板
const CTR_MATS = new Map();
function ctrMats(k) {
  if (!CTR_MATS.has(k)) {
    const cm = mat(CTR_COL[k % CTR_COL.length], { roughness: 0.7, metalness: 0.3 });
    CTR_MATS.set(k, [cm, mat(0x26282c, { roughness: 0.6, metalness: 0.5 })]);
  }
  return CTR_MATS.get(k);
}
function container1(o) {
  const [w, d] = unrot(o);
  const [cm, fm] = ctrMats(o.color || 0);
  return buildContainer(w, o.h, d, false, cm, fm);
}
function ctrStack(o) {
  const g = new THREE.Group();
  const [, d0] = unrot(o);
  const lay = o.lay || [1];
  const n = lay.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < lay[i]; j++) {
      const [cm, fm] = ctrMats((o.color || 0) + i * 2 + j * 3);
      const c = buildContainer(12, 2.6, 2.6, false, cm, fm);
      c.position.set(0, j * 2.6, -d0 / 2 + 1.3 + i * 2.6);
      g.add(c);
    }
  return g;
}
function parkedTruck(o) {
  const g = new THREE.Group();
  const m = buildParkedTruck(mat(TRUCK_COL[o.color || 0], { roughness: 0.6, metalness: 0.3 }));
  m.position.z = 1; // 車廂＋駕駛艙（z −5.5～3.5）的中心移到原點
  g.add(m);
  return g;
}
// 龍門起重機：四支腳（沿本地 X 相距 span、沿 Z 相距 7）＋兩道橫樑（高 h）＋台車與吊著的貨櫃；碰撞只有腳（gantryleg）
function gantry(o) {
  const g = new THREE.Group();
  const Y = mat(0xd8a020, { roughness: 0.55, metalness: 0.45 }),
    dk = mat(0x2e3034, { roughness: 0.8, metalness: 0.4 }),
    st = mat(0x8a8e90, { roughness: 0.5, metalness: 0.6 });
  const s = (o.span || 20) / 2,
    H = o.h || 14;
  for (const x of [-s, s]) {
    for (const z of [-3.5, 3.5]) g.add(box(1.1, H, 1.1, Y, x, H / 2, z));
    g.add(box(1, 1, 8, Y, x, 1.2, 0)); // 腳的底樑
    g.add(box(1.4, 0.5, 8.4, dk, x, 0.25, 0)); // 行走台車
  }
  for (const z of [-3.5, 3.5]) g.add(box(2 * s + 3, 1.8, 1.3, Y, 0, H + 0.6, z));
  g.add(box(4, 2.2, 8.4, dk, s * 0.3, H + 2.2, 0)); // 台車
  g.add(box(0.12, 6, 0.12, st, s * 0.3 - 1, H - 3, 0));
  g.add(box(0.12, 6, 0.12, st, s * 0.3 + 1, H - 3, 0));
  const [cm, fm] = ctrMats(1);
  const c = buildContainer(12, 2.6, 2.6, false, cm, fm);
  c.rotation.y = Math.PI / 2;
  c.position.set(s * 0.3, H - 8.6, 0);
  g.add(c);
  return g;
}
function pallets() {
  const g = new THREE.Group();
  const wd = mat(0x8a6a44, { roughness: 1 });
  for (let i = 0; i < 3; i++) g.add(box(1.2, 0.15, 1.0, wd, (i - 1) * 1.4, 0.08 + (i === 1 ? 0.15 : 0), 0));
  g.add(box(1.1, 0.8, 0.9, mat(0xb8a080, { roughness: 0.9 }), 0, 0.7, 0));
  return g;
}
const empty = () => new THREE.Group();
// 方塊的障礙物：plan 旋轉 90° 的倍數時寬深已對調，建模用旋轉前的尺寸
const unrot = (o) => ((Math.round((o.yaw || 0) / (Math.PI / 2)) & 1) === 1 ? [o.d, o.w] : [o.w, o.d]);
// 障礙物（world/rts-map.js 的 RTS_THEMES 的 model）；全部沿用主線主題的物件（已登記在模型庫，GLB 也照用）
export const RTS_PROPS = {
  spire: (o, T) => buildRockSpire(o.r, o.h, T.rock),
  hopper: (o) => buildOreHopper(HOPPER_COL[o.color || 0]),
  tank: (o) => buildStorageTank(o.r / 1.02, o.h, TANK_COL[o.color || 0]),
  floodlight: (o) => buildFloodlight(o.h, 0x4a4540),
  // 冰原
  icespire: iceSpire,
  quonset: (o) => buildQuonset(QUONSET_COL[o.color || 0]),
  radar: (o) => buildRadarDish(RADAR_COL[o.color || 0]),
  beacon: (o) => buildBeacon(o.h),
  // 技研都市地表：研究設施的殘骸（buildLab 的縮小版，方塊碰撞＝plan 的外框）、Coral 收容槽、管線、Coral 結晶
  labruin: (o) => {
    const [w, d] = unrot(o);
    return buildLab(w, o.h, d, o.color || 1);
  },
  coraltank: () => buildCoralTank(),
  piperun: () => buildPipeRun(),
  crystal: (o) => buildCoralCrystal(o.h / 4),
  // 舊宇宙港外圍（R4）：防爆牆（rocks 的方塊與防爆牆列）、貨物艙、燃料車、天線桿、發射台上的發射塔
  blastwall: (o) => scaled(buildBlastWall(), o, 8, 4, 1.2),
  cargopod: (o) => buildCargoPod(POD_COL[o.color || 0]),
  fueltruck: () => buildFuelTruck(),
  mast: (o) => buildAntennaMast(o.h),
  launchtower: launchTower,
  // Grid 086 地表（R4）：廢料堆、Doser 棚屋（放大 1.2）、管線束、排氣煙囪、油桶群＋鈉燈
  scrap: (o) => buildScrapHeap(o.r / 2.5),
  shack: (o) => {
    const g = new THREE.Group();
    const m = buildShack(SHACK_COL[o.color || 0]);
    m.scale.setScalar(1.2);
    g.add(m);
    return g;
  },
  pipestack: (o) => buildPipeStack(o.h),
  chimney: (o) => buildChimney(o.r, o.h),
  barrels: barrelsLamp,
  // 裝飾（plan.decor：不碰撞）
  coralvein: (o) => {
    const g = buildCoralVein(o.len);
    g.scale.z = 2.5; // RTS 的鏡頭遠：加寬才看得到
    return g;
  },
  // Grid 086 的構造體台階：斷崖外側的金屬牆（主題的 wall 外觀，原點在中心）、鋼板接縫、排水溝
  g86wall: (o) => buildThemeWall('grid086', o.len, o.h, 0.6),
  seam,
  drain,
  // 汙染水沒市街（R5）：傾倒的建築殘段、沉沒的公車與汽車（地圖殘骸）、彎折的路燈；水窪裡的裝飾
  ruinblock: ruinBlock,
  sunkbus: (o) => tilted(buildSunkBus(BUS_COL[o.color || 0]), 0, 0.05),
  wreckcar: (o) => buildWreckCar(CAR_COL[o.color || 0]),
  bentlamp: (o) => buildBentLamp(o.h),
  poolcar: (o) => tilted(buildWreckCar(CAR_COL[o.color || 0]), o.tilt || 0, 0.12),
  poollamp: (o) => tilted(buildBentLamp(6.5), (o.tilt || 0) + 0.15, 0),
  poolsign: poolSign,
  pooljunk: () => buildFloatJunk(),
  // 多重水壩（R5）：消波塊群、閘門零件、起重機的殘骸、燈；裝飾的壩面（主題的 wall 外觀）、護欄、壩頂的燈
  tetrapods,
  gatewreck: gateWreck,
  cranewreck: craneWreck,
  damlamp: damLamp,
  damwall: (o) => buildThemeWall('dam', o.len, o.h, 0.8),
  damrail: damRail,
  // 沙丘地帶（R6）：砂岩柱、半埋的船殼、歪斜的路燈；拱形殘骸（裝飾）與它的兩支腳（只有碰撞）、防沙柵欄（裝飾）
  sandstone: (o, T) => buildSandstone(o.r, o.h, T.rock || SAND_COL[0]),
  wreckhull: wreckHull,
  sandlamp: sandLamp,
  wreckarch: (o) => buildWreckArch(HULL_COL[o.color || 0]),
  archfoot: empty,
  sandfence: (o) => buildSandFence(o.len, SAND_COL[1]),
  // 礦坑地表（R6）：碎石堆、採礦機具、井架、探照燈（同荒野）；裝飾的礦車軌道與礦車
  boulder,
  miningrig: miningRig,
  derrick: (o) => buildDerrick(o.h, 0x8a6a4a),
  minerail: (o) => buildTrack(o.len),
  minecart: mineCart,
  // 貨運集散場（R6）：單個貨櫃、貨櫃堆、停放的卡車、倒下的吊臂（水壩的同一個）、路燈；龍門起重機（裝飾）與腳、棧板
  container1,
  ctrstack: ctrStack,
  truck: parkedTruck,
  lamppost: damLamp,
  gantry,
  gantryleg: empty,
  pallets,
};
export function rtsPropMesh(o, T) {
  const f = RTS_PROPS[o.model];
  return f ? f(o, T) : null;
}

// ---------- 靜態合併（docs/rts-design.md 8.3）----------
// RTS 地圖的障礙物（幾十個，每個 2～5 個網格）依材質合併成少數幾個世界座標的網格；碰撞照舊用障礙物的形狀。
// 戰爭迷霧在未探索時要隱藏地圖物件：合併後的頂點帶著所屬物件的中心（rtsC），著色器查迷霧的「探索過」貼圖
// （game/rts-fog.js 設定 RTS_PROP_FOG：每個視野格一個像素、最近取樣），所在格沒探索過就丟掉，
// 和原本「整個物件的群組在算繪時隱藏」的結果相同；陰影也用同樣規則的深度材質。沒有迷霧時（on＝0）一律顯示。
// 沒合併的網格（半透明、多重材質、燈光…）留在原本的群組裡，迷霧照舊隱藏群組。
export const RTS_PROP_FOG = {
  rtsFogTex: { value: null },
  rtsFogM: { value: new THREE.Vector3(0, 1, 1) }, // 地圖半寬、格寬、每邊格數
  rtsFogOn: { value: 0 },
};
function fogPatch(sh) {
  Object.assign(sh.uniforms, RTS_PROP_FOG);
  sh.vertexShader = sh.vertexShader
    .replace('void main() {', 'attribute vec2 rtsC;\nvarying vec2 vRtsC;\nvoid main() {\n\tvRtsC = rtsC;')
    .replace(/^/, '');
  sh.fragmentShader = sh.fragmentShader.replace(
    'void main() {',
    [
      'uniform sampler2D rtsFogTex;',
      'uniform vec3 rtsFogM;',
      'uniform float rtsFogOn;',
      'varying vec2 vRtsC;',
      'void main() {',
      '\tif ( rtsFogOn > 0.5 ) {',
      '\t\tvec2 rc = floor( ( vRtsC + rtsFogM.x ) / rtsFogM.y );',
      '\t\tif ( rc.x >= 0.0 && rc.y >= 0.0 && rc.x < rtsFogM.z && rc.y < rtsFogM.z && texture2D( rtsFogTex, ( rc + 0.5 ) / rtsFogM.z ).r < 0.5 ) discard;',
      '\t}',
    ].join('\n'),
  );
}
// 材質的複本：先套原本的著色器修改（標準材質的渲染風格在 prototype 上）再加迷霧
function fogMat(m) {
  const c = m.clone();
  c.transparent = false; // 不透明度 1 的淡出材質（RTS 不做鏡頭遮擋淡出）
  const base = Object.getPrototypeOf(m).onBeforeCompile;
  c.onBeforeCompile = function (sh, r) {
    if (base) base.call(this, sh, r);
    fogPatch(sh);
  };
  const key = Object.getPrototypeOf(m).customProgramCacheKey;
  c.customProgramCacheKey = function () {
    return (key ? key.call(this) : '') + '|rtsPropFog';
  };
  return c;
}
let DEPTH = null;
function fogDepth() {
  if (DEPTH) return DEPTH;
  DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  DEPTH.onBeforeCompile = fogPatch;
  DEPTH.customProgramCacheKey = () => 'rtsPropFogDepth';
  return DEPTH;
}
const okMat = (m) =>
  m &&
  !Array.isArray(m) &&
  m.visible !== false &&
  (!m.transparent || (m.depthWrite && m.opacity >= 1)) && // 遮擋淡出用的材質（不透明度 1）當成不透明
  !Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') &&
  (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
// 材質的外觀簽名：遮擋淡出的物件每個都有自己的材質複本，內容相同的當成同一種
const texId = (t) => (t ? t.uuid : '');
const colHex = (c) => (c ? c.getHex() : '');
function matSig(m) {
  return [
    m.type,
    colHex(m.color),
    colHex(m.emissive),
    m.emissiveIntensity,
    m.roughness,
    m.metalness,
    m.flatShading,
    m.side,
    m.vertexColors,
    m.envMapIntensity,
    styleCat(m),
    ...['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'envMap'].map(
      (k) => texId(m[k]),
    ),
    m.normalScale ? m.normalScale.x + ',' + m.normalScale.y : '',
  ].join('/');
}
// obs：World.addSmall 回傳的障礙物（group 在場景裡、x／z 是中心）。回傳合併掉的網格數
export function mergeRtsProps(world, obs) {
  const buckets = new Map();
  const mats = new Map();
  for (const ob of obs) {
    const g = ob && ob.group;
    if (!g) continue;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length) return;
      const m = o.material,
        geo = o.geometry;
      // 單一材質時 three.js 不看 groups（整個幾何一起畫），所以有 groups 也照樣合併
      if (!okMat(m) || !geo || !geo.attributes.position) return;
      if (geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity) return;
      if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) return;
      for (let p = o; p && p !== g.parent; p = p.parent) if (p.visible === false) return;
      const k = [matSig(m), attrSig(geo), +o.castShadow, +o.receiveShadow, o.renderOrder].join('|');
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push({ o, ob });
    });
  }
  let n = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue; // 只有一個的留在群組裡（迷霧照舊隱藏群組）
    const o0 = list[0].o;
    const geo = mergeList(list.map(({ o }) => ({ geo: o.geometry, mm: o.matrixWorld })));
    const total = geo.attributes.position.count;
    const c = new Float32Array(total * 2);
    let off = 0;
    for (const { o, ob } of list) {
      const cnt = o.geometry.attributes.position.count;
      for (let i = 0; i < cnt; i++) {
        c[(off + i) * 2] = ob.x;
        c[(off + i) * 2 + 1] = ob.z;
      }
      off += cnt;
    }
    geo.setAttribute('rtsC', new THREE.BufferAttribute(c, 2));
    const ms = matSig(o0.material);
    let fm = mats.get(ms);
    if (!fm) mats.set(ms, (fm = fogMat(o0.material)));
    const mesh = new THREE.Mesh(geo, fm);
    mesh.castShadow = o0.castShadow;
    mesh.receiveShadow = o0.receiveShadow;
    mesh.renderOrder = o0.renderOrder;
    if (mesh.castShadow) mesh.customDepthMaterial = fogDepth();
    mesh.matrixAutoUpdate = false; // 頂點已經是世界座標
    mesh.userData.rtsProps = true;
    world.scene.add(mesh);
    world.meshes.push(mesh);
    for (const { o } of list) o.parent.remove(o);
    n += list.length;
  }
  return n;
}
