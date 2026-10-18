// Coral 戰爭（RTS）的對稱地圖產生器：planRtsMap(seed, { theme, size }) → 純資料（node 也能跑）。
// 半張圖的地形特徵（主基地平台＋坡道、山脊與窄路口、台地、瞭望高地）與點位決定後，繞中心轉 180° 複製：
// 高度圖 h(p)＝max(F(p), F(−p))＋對稱的起伏，再把格點 k 與 N²−1−k 設成同一個值（完全對稱）；障礙物與點位成對產生。
// 檢查（NavGrid）：兩邊主基地到各自要點的路徑代價相等、要點全部連通、主基地只有一條坡道、平台的建築格夠多；
// 不合格換子種子 seed×31＋n 重試（最多 20 次）。
// 高度圖格式同 World 的地形網格：邊長 RTS_CELL（2.5 m）、(n×n) 點、x＝i×cell−size/2。
import { clamp, makeNoise, makeRng } from '../core/math.js';
import { NavGrid } from './nav.js';

export const RTS_CELL = 2.5;
const NAV_CELL = 2;
const EDGE = 16; // 地圖邊緣的斷崖從離邊界這麼遠開始
// 中立建築的佔地（m，旋轉 0 時的 [寬, 深]；data/rts-neutral.js 的 n_tavern／n_shop／n_merc 用同樣的值）：
// 檢查時先佔用導航格，路徑相等、連通、通道都已經繞過這些建築（docs 13.15）
export const RTS_NEUTRAL_FOOT = { tavern: [12, 12], shop: [10, 8], merc: [12, 10] };
// 中立建築的朝向：正面（+Z）轉向地圖中心、以 90° 為單位（兩邊差 180°，佔地也點對稱）
export const neutralYaw = (p) =>
  Math.abs(p.x) + Math.abs(p.z) < 1e-6
    ? 0
    : (Math.round(Math.atan2(-p.x, -p.z) / (Math.PI / 2)) * Math.PI) / 2;
// 中立建築佔用的導航格（rtsSpawnBld 同樣的規則：旋轉 90° 時寬深對調）
export function neutralFoot(q) {
  const f = RTS_NEUTRAL_FOOT[q.kind] || [8, 8];
  const k = Math.round((q.yaw || 0) / (Math.PI / 2)) & 1;
  return k ? [f[1], f[0]] : f;
}
const sm = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

// 各主題的地形參數與障礙物外觀（model＝world/rts-props.js 的建模名稱）；之後加主題只要在這裡加一項＋rts-props 的建模
export const RTS_THEMES = {
  wasteland: {
    name: '荒涼工業荒野',
    baseH: [7, 9], // 主基地平台的高度
    ridgeH: [12, 16], // 山脊
    mesaH: [11, 15], // 中立區的台地（不能上去）
    watchH: [5, 6.5], // 瞭望高地（一條坡道）
    rimH: 24, // 地圖邊緣的斷崖（一路升到邊界，上面不能走）
    rough: 1.4, // 低地的起伏（m）
    rocks: { model: 'spire', r: [1.6, 2.8], h: [5, 10], sink: 0.5 },
    wrecks: [
      { model: 'hopper', box: [5, 6.2, 5], sink: 0.2 },
      { model: 'tank', r: [2.2, 3.4], h: [4.5, 7.5], sink: 0.2 },
    ],
    lights: { model: 'floodlight', r: 0.6, h: [8, 11], sink: 0.3 },
    counts: { rocks: [16, 24], wrecks: [5, 8], lights: [3, 5] }, // 半張圖
  },
  // R3（docs 14.8、14.14）：冰原（冰湖）與技研都市地表（廢墟台地、Coral 脈、中立區多一對湧出點）。
  // look＝World 的主題覆寫（plan.themeOver：不畫岩頂、不疊加時間）；extra／after＝附加地形（獨立的亂數串，
  // 只有這些主題呼叫，荒野的地圖完全不變）；rocks 有 boxW 時是方塊碰撞（boxW／boxH／boxD 的範圍）
  snow: {
    name: '冰原',
    baseH: [6.5, 8.5],
    ridgeH: [11, 15],
    mesaH: [10, 13],
    watchH: [5, 6],
    rimH: 22,
    rough: 0.9,
    rocks: { model: 'icespire', r: [1.6, 2.8], h: [5, 10], sink: 0.4 },
    wrecks: [
      { model: 'quonset', box: [6.2, 3.4, 9.4], sink: 0.15 },
      { model: 'radar', r: [1.4, 1.6], h: [7, 7], sink: 0.1 },
    ],
    lights: { model: 'beacon', r: 0.6, h: [8, 11], sink: 0.2 },
    counts: { rocks: [16, 24], wrecks: [5, 8], lights: [3, 5] },
    look: { sun: 0xf2f6ff, sunI: 1.05, hemiI: 1.05, fogNear: 50, fogFar: 170, weather: 'snow' },
    after: iceAfter,
  },
  institute: {
    name: '技研都市地表',
    baseH: [8, 10],
    ridgeH: [13, 17],
    mesaH: [12, 16],
    watchH: [6, 7],
    rimH: 26,
    rough: 0.6,
    rocks: { model: 'labruin', box: [8.5, 6, 7], boxW: [6, 8.5], boxH: [4, 7], boxD: [5, 7], sink: 0.2 },
    wrecks: [
      { model: 'coraltank', r: [2, 2], h: [6.2, 6.2], sink: 0.1 },
      { model: 'piperun', box: [6, 1.7, 2], sink: 0.05 },
    ],
    lights: { model: 'crystal', r: 1.2, h: [3.5, 5], sink: 0.2 },
    counts: { rocks: [11, 17], wrecks: [5, 8], lights: [3, 5] },
    corals: { mid: 2 },
    look: {
      ground: 0x625e60,
      slope: 0x45403f,
      rock: 0x3a3434,
      sky: 0xc89478,
      fog: 0xa08c84,
      sun: 0xffb27a,
      amb: 0x4f8a90,
      sunI: 0.95,
      hemiI: 1.0,
      fogNear: 55,
      fogFar: 180,
      weather: 'coral',
    },
    after: coralVeins,
  },
  // R4（docs 15.8、15.14）：舊宇宙港外圍（發射台的台地＋防爆牆列、寬廣的平地）與 Grid 086 地表（兩層的構造體台階）
  spaceport: {
    name: '舊宇宙港外圍',
    baseH: [6.5, 8.5],
    ridgeH: [10, 13],
    mesaH: [8, 11],
    watchH: [4.5, 6],
    rimH: 22,
    rough: 0.4,
    rocks: {
      model: 'blastwall',
      box: [8, 4, 2],
      boxW: [6, 8],
      boxH: [3, 4],
      boxD: [1.2, 2],
      sink: 0.1,
    },
    wrecks: [
      { model: 'cargopod', box: [2.8, 2.7, 6], sink: 0.05 },
      { model: 'fueltruck', box: [2.6, 3.2, 8], sink: 0.05 },
    ],
    lights: { model: 'mast', r: 0.5, h: [11, 15], sink: 0.1 },
    counts: { rocks: [10, 16], wrecks: [5, 8], lights: [3, 5] },
    look: {
      ground: 0x6c7073,
      slope: 0x55595c,
      rock: 0x4c5053,
      sky: 0xc6ccd0,
      fog: 0xbcc1c4,
      sun: 0xfff8f0,
      amb: 0x8a9298,
      sunI: 0.95,
      hemiI: 0.9,
      fogNear: 70,
      fogFar: 230,
      weather: null,
    },
    after: padsAfter,
  },
  grid086: {
    name: 'Grid 086 地表',
    baseH: [8, 10],
    ridgeH: [13, 17],
    mesaH: [12, 16],
    watchH: [6, 7],
    rimH: 26,
    rough: 0.5,
    rocks: { model: 'scrap', r: [1.8, 2.8], h: [2.2, 3.2], sink: 0.2 },
    wrecks: [
      { model: 'shack', box: [6, 4.3, 4.8], sink: 0.05 },
      { model: 'pipestack', box: [3.2, 9, 1], sink: 0.05 },
      { model: 'chimney', r: [1.2, 1.6], h: [16, 24], sink: 0.1 },
    ],
    lights: { model: 'barrels', r: 1.1, h: [3.4, 3.4], sink: 0.05 },
    counts: { rocks: [16, 24], wrecks: [5, 8], lights: [3, 5] },
    look: { sunI: 0.8, hemiI: 1.0, fogNear: 50, fogFar: 170, weather: 'ash' },
    after: stepsAfter,
  },
  // R5（docs 16.8、16.14）：汙染水沒市街（淺水窪橫過通道、地圖殘骸多）與多重水壩（點對稱的壩體高地＋兩組坡道＋壩腳的
  // 淺水河道）。水面一律 RTS_WATER_Y（look.water 覆寫 World 主題原本的水面）；水深最多 1.4 m（全部可以走、涉水 ×0.85），
  // 水深 > 0.3 m 的格子不能蓋（World.buildRts 與 validate 的 waterY）
  flooded: {
    name: '汙染水沒市街',
    baseH: [6.5, 8.5],
    ridgeH: [10, 14],
    mesaH: [9, 12],
    watchH: [4.5, 6],
    rimH: 22,
    rough: 0.5,
    rocks: { model: 'ruinblock', box: [8, 6, 7], boxW: [6, 9], boxH: [4, 8], boxD: [5, 8], sink: 0.3 },
    wrecks: [
      { model: 'sunkbus', box: [2.8, 2.6, 10], sink: 0.3 },
      { model: 'wreckcar', box: [2.1, 1.6, 4.4], sink: 0.1 },
    ],
    lights: { model: 'bentlamp', r: 0.5, h: [6, 8], sink: 0.2 },
    counts: { rocks: [11, 17], wrecks: [8, 12], lights: [3, 5] },
    waterY: -0.4,
    look: {
      ground: 0x55594f,
      slope: 0x44483f,
      rock: 0x3a403a,
      sky: 0x7f8c80,
      fog: 0x77847a,
      sun: 0xd6dca2,
      amb: 0x5d6a62,
      sunI: 0.8,
      hemiI: 0.95,
      fogNear: 45,
      fogFar: 160,
      weather: 'rain',
      water: { level: -0.4, color: 0x26332b, opacity: 0.9, rough: 0.12 },
    },
    after: poolsAfter,
  },
  dam: {
    name: '多重水壩',
    baseH: [7, 9],
    ridgeH: [12, 16],
    mesaH: [10, 14],
    watchH: [5, 6.5],
    rimH: 24,
    rough: 0.7,
    rocks: { model: 'tetrapods', box: [6, 2.6, 5], boxW: [5, 7], boxH: [2.4, 2.8], boxD: [4, 6], sink: 0.2 },
    wrecks: [
      { model: 'gatewreck', box: [4.6, 6.4, 4.6], sink: 0.1 },
      { model: 'cranewreck', box: [4.4, 8, 5.4], sink: 0.05 },
    ],
    lights: { model: 'damlamp', r: 0.5, h: [7, 9], sink: 0.1 },
    counts: { rocks: [10, 16], wrecks: [5, 8], lights: [3, 5] },
    ridgeU: [0.46, 0.54], // 山脊離中心遠一點（中央是壩體與河道）
    waterY: -0.4,
    look: {
      ground: 0x696862,
      slope: 0x54534e,
      rock: 0x52504b,
      sky: 0xb4bcc0,
      fog: 0xa9b0b2,
      sun: 0xfff4e6,
      amb: 0x8b929a,
      sunI: 0.95,
      hemiI: 0.95,
      fogNear: 60,
      fogFar: 200,
      weather: null,
      water: { level: -0.4, color: 0x2e4a56, opacity: 0.88, rough: 0.1 },
    },
    pre: damPre,
    after: damAfter,
  },
  // R6（docs 17.4；C 包）：沙丘地帶（新月沙丘擋低處的視線）、礦坑地表（中央的露天礦坑、坑底的富礦）、貨運集散場
  // （貨櫃堆的巷道、龍門起重機）。r6＝新主題（多檢查營地與傭兵營的間距）
  dunes: {
    name: '沙丘地帶',
    r6: true,
    baseH: [6.5, 8.5],
    ridgeH: [10, 14],
    mesaH: [9, 12],
    watchH: [5, 6],
    rimH: 22,
    rough: 1.0,
    rocks: { model: 'sandstone', r: [1.6, 2.6], h: [5, 9], sink: 0.3 },
    wrecks: [{ model: 'wreckhull', box: [3.7, 2.8, 12], sink: 0.1 }],
    lights: { model: 'sandlamp', r: 0.5, h: [5, 7], sink: 0.4 },
    counts: { rocks: [12, 18], wrecks: [4, 6], lights: [3, 5] },
    look: {
      ground: 0xc29a66,
      slope: 0xa07648,
      rock: 0x7a5a3c,
      sky: 0xeedcb8,
      fog: 0xe6cfa6,
      sun: 0xffd29a,
      amb: 0xc8ab82,
      sunI: 1.0,
      hemiI: 0.9,
      fogNear: 55,
      fogFar: 190,
      weather: 'sand',
    },
    after: dunesAfter,
  },
  desert: {
    name: '礦坑地表',
    r6: true,
    baseH: [7, 9],
    ridgeH: [12, 16],
    mesaH: [11, 14],
    watchH: [5, 6.5],
    rimH: 24,
    rough: 1.1,
    rocks: { model: 'boulder', r: [1.6, 2.8], h: [2.4, 4], sink: 0.4 },
    wrecks: [
      { model: 'miningrig', box: [4.6, 3.8, 6], sink: 0.1 },
      { model: 'derrick', r: [2, 2], h: [10, 14], sink: 0.1 },
    ],
    lights: { model: 'floodlight', r: 0.6, h: [8, 11], sink: 0.3 },
    counts: { rocks: [16, 24], wrecks: [5, 8], lights: [3, 5] },
    look: {
      ground: 0x9c8360,
      slope: 0x6a5240,
      rock: 0x5a4636,
      sky: 0xe3d4b7,
      fog: 0xd8c7a8,
      sun: 0xffe2b0,
      amb: 0xb8a48a,
      sunI: 0.95,
      hemiI: 0.95,
      fogNear: 55,
      fogFar: 180,
      weather: 'dust',
    },
    pre: pitPre,
    after: pitAfter,
  },
  industrial: {
    name: '貨運集散場',
    r6: true,
    baseH: [6.5, 8.5],
    ridgeH: [10, 13],
    mesaH: [8, 11],
    watchH: [4.5, 6],
    rimH: 22,
    rough: 0.3,
    rocks: {
      model: 'container1',
      box: [12, 2.6, 2.6],
      boxW: [12, 12],
      boxH: [2.6, 2.6],
      boxD: [2.6, 2.6],
      sink: 0.1,
    },
    wrecks: [
      { model: 'truck', box: [3.2, 3, 9.6], sink: 0.05 },
      { model: 'cranewreck', box: [4.4, 8, 5.4], sink: 0.05 },
    ],
    lights: { model: 'lamppost', r: 0.4, h: [7, 9], sink: 0.1 },
    counts: { rocks: [10, 14], wrecks: [5, 8], lights: [3, 5] },
    look: {
      ground: 0x4c5158, // 鋪面：俯視時整片太亮會發白，比主線的集散場暗一點
      slope: 0x383c42,
      rock: 0x44494f,
      sky: 0xa9b3bc,
      fog: 0x9aa3ad,
      sun: 0xfff0d0,
      amb: 0x8894a2,
      sunI: 0.9,
      hemiI: 0.9,
      fogNear: 60,
      fogFar: 200,
      weather: null,
    },
    after: yardAfter,
  },
};
export const RTS_WATER_Y = -0.4;

const AMOUNT = { main: 12000, natural: 10000, outer: 8000, rich: 15000, coralBase: 6000, coralMid: 10000 };

// 高度圖的取樣（同 World.terrainHeight）
export function heightSampler(h, n, size) {
  const S = size / 2,
    c = RTS_CELL,
    m = n - 1;
  const at = (i, j) => h[(j < 0 ? 0 : j > m ? m : j) * n + (i < 0 ? 0 : i > m ? m : i)];
  return (x, z) => {
    const fx = (x + S) / c,
      fz = (z + S) / c;
    const i = Math.floor(fx),
      j = Math.floor(fz),
      u = fx - i,
      v = fz - j;
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u,
      b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
    return a + (b - a) * v;
  };
}
// NavGrid 用的輕量世界（node 的檢查、或 World 建好之前）
export function rtsShim(plan) {
  return {
    size: plan.size,
    obstacles: plan.obstacles,
    terrainHeight: heightSampler(plan.h, plan.n, plan.size),
  };
}

const P = (x, z) => ({ x, z });
const neg = (p) => ({ x: -p.x, z: -p.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 地圖大小（docs 17.4；選單讀這張表）：400 m 的產生路徑一行都不改，大小相依的參數在 genOnce 以 SZ(400 m 的值, 其他) 選
export const RTS_SIZES = { s: { size: 300, name: '小' }, m: { size: 400, name: '中' } };
export const RTS_SIZE_LIST = [300, 400];

export function planRtsMap(seed, opt = {}) {
  const theme = RTS_THEMES[opt.theme] ? opt.theme : 'wasteland';
  const size = RTS_SIZE_LIST.includes(opt.size) ? opt.size : 400;
  const t0 = Date.now();
  let plan = null,
    full = null;
  const fails = [];
  const maxT = opt.tries || 20; // 最多試幾個子種子（除錯時可以設 1）
  // 小地圖（R6）：20 次都在高度圖之前就不合格時多試幾次（回傳的圖一定有高度圖）
  for (let n = 0; n < maxT || (!full && !opt.tries && size !== 400 && n < 80); n++) {
    const sub = n === 0 ? seed : (seed * 31 + n) >>> 0;
    plan = genOnce(sub, theme, size);
    plan.tries = n + 1;
    if (plan.h) full = plan;
    if (plan.ok) break;
    fails.push(plan.fail);
  }
  // 20 次都不合格時仍回傳最後一張完整的圖（ok 為 false）
  if (!plan.ok && full) plan = full;
  plan.seed = seed;
  plan.fails = fails;
  // World 的主題覆寫（buildRts）：RTS 不畫岩頂、不疊加時間；荒野沒有（plan 的內容和以前相同）
  const TH = RTS_THEMES[theme];
  if (TH.look) plan.themeOver = { roof: null, noTod: true, ...TH.look };
  plan.ms = Date.now() - t0;
  return plan;
}

function genOnce(sub, theme, size) {
  const TH = RTS_THEMES[theme];
  const rng = makeRng(sub);
  const R = (a, b) => a + (b - a) * rng();
  const RA = (ab) => R(ab[0], ab[1]);
  const sgn = () => (rng() < 0.5 ? -1 : 1);
  const S = size / 2;
  // R6（docs 17.4）：大小相依的參數（400 m 一律用第一個值，地圖和以前完全相同）；NEW＝R6 的新主題或小地圖
  // （只有它們多檢查營地與傭兵營的間距，17.2 #11）
  const SZ = (a400, aOther) => (size === 400 ? a400 : aOther);
  const U = S - EDGE - SZ(8, 2); // 可以放東西的範圍（|x|、|z|；小地圖：主基地更靠角落，中立區才夠寬）
  const NEW = !!TH.r6 || size !== 400;
  const n1 = makeNoise(sub * 7 + 1),
    n2 = makeNoise(sub * 13 + 5);
  // 主軸：主基地 A 在 θ 方向（對角線附近），B 在反方向
  const th = Math.PI / 4 + Math.floor(rng() * 4) * (Math.PI / 2) + R(-0.22, 0.22);
  const ax = Math.cos(th),
    az = Math.sin(th);
  const W = (u, v) => P(u * ax - v * az, u * az + v * ax); // 本地 (u 沿主軸, v 橫向) → 世界
  const L = (p) => [p.x * ax + p.z * az, -p.x * az + p.z * ax];
  const inUse = (p, m = 0) => Math.abs(p.x) < U - m && Math.abs(p.z) < U - m;

  // ---------- 半張圖的地形特徵 ----------
  const feats = []; // { bb:[x0,x1,z0,z1], f(x, z) → 0～1 的高度比例, H }
  // 平台（主基地、瞭望高地）：雜訊打亂的圓＋陡峭的崖，坡道是一條斜面（側面也是崖）
  const plateau = (c, r, H, rampAng, rampW, slope = 0.27) => {
    const ph1 = R(0, 6.28),
      ph2 = R(0, 6.28);
    const dx = Math.cos(rampAng),
      dz = Math.sin(rampAng);
    const len = H / slope;
    const cw = 3;
    const rad = (x, z) => {
      const a = Math.atan2(z - c.z, x - c.x);
      return r * (1 + 0.07 * Math.sin(3 * a + ph1) + 0.04 * Math.sin(5 * a + ph2));
    };
    // 坡道從平台邊緣（這個方向實際的半徑）往外
    const r0 = rad(c.x + dx, c.z + dz) - 1;
    const rs = P(c.x + dx * r0, c.z + dz * r0);
    const re = P(rs.x + dx * len, rs.z + dz * len);
    const ext = r * 1.12 + cw + len + rampW;
    feats.push({
      bb: [c.x - ext, c.x + ext, c.z - ext, c.z + ext],
      H,
      f(x, z) {
        const d = Math.hypot(x - c.x, z - c.z);
        let t = sm((rad(x, z) + cw - d) / cw);
        if (t >= 1) return 1;
        const px = x - rs.x,
          pz = z - rs.z;
        const al = px * dx + pz * dz,
          lat = Math.abs(-px * dz + pz * dx);
        if (al > -4 && al < len && lat < rampW / 2 + 2) {
          const rt = 1 - clamp(al / len, 0, 1);
          const lm = clamp((rampW / 2 + 2 - lat) / 2, 0, 1);
          t = Math.max(t, rt * lm);
        }
        return t;
      },
    });
    return { c, r, H, ramp: { top: rs, bottom: re, w: rampW, len, dir: Math.atan2(dx, dz), ang: rampAng } };
  };
  // 一段山脊（折線，兩端圓頭）：線段距離 < hw 是頂、外側 cw 是崖
  const ridgeSeg = (pts, hw, H) => {
    const cw = 4;
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (const p of pts) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const e = hw + cw + 1;
    feats.push({
      bb: [x0 - e, x1 + e, z0 - e, z1 + e],
      H,
      f(x, z) {
        let best = 1e9;
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1],
            b = pts[k];
          const vx = b.x - a.x,
            vz = b.z - a.z;
          const t = clamp(((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
          const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
          if (d < best) best = d;
        }
        return sm((hw + cw - best) / cw);
      },
    });
  };
  const blob = (c, r, H) => {
    const ph = R(0, 6.28);
    const cw = 4;
    feats.push({
      bb: [c.x - r * 1.2 - cw, c.x + r * 1.2 + cw, c.z - r * 1.2 - cw, c.z + r * 1.2 + cw],
      H,
      f(x, z) {
        const a = Math.atan2(z - c.z, x - c.x);
        const rr = r * (1 + 0.15 * Math.sin(2 * a + ph) + 0.06 * Math.sin(5 * a + ph * 2));
        return sm((rr + cw - Math.hypot(x - c.x, z - c.z)) / cw);
      },
    });
  };
  // F(p)：半張圖特徵的最高值（m）
  const F = (x, z) => {
    let h = 0;
    for (const f of feats) {
      if (x < f.bb[0] || x > f.bb[1] || z < f.bb[2] || z > f.bb[3]) continue;
      const v = f.f(x, z) * f.H;
      if (v > h) h = v;
    }
    return h;
  };
  const high = (p) => Math.max(F(p.x, p.z), F(-p.x, -p.z));
  // 低地（四周 m 公尺內都沒有地形特徵）
  // 主題的前置地形（多重水壩：壩體、坡道、河道）：在其他特徵與點位之前，自己的亂數串；其他主題不呼叫、不改任何東西
  const PRE = TH.pre ? TH.pre({ W, L, S, U, feats }, sub) : null;
  const isLow = (p, m = 4) => {
    if (PRE && PRE.block(p, m)) return false;
    for (const [ox, oz] of [
      [0, 0],
      [m, 0],
      [-m, 0],
      [0, m],
      [0, -m],
      [m * 0.7, m * 0.7],
      [-m * 0.7, m * 0.7],
      [m * 0.7, -m * 0.7],
      [-m * 0.7, -m * 0.7],
    ])
      if (high(P(p.x + ox, p.z + oz)) > 0.05) return false;
    return true;
  };

  // 主基地 A：平台盡量靠角落
  const rB = R(30, 35);
  const Rmax = (U - 6 - rB) / Math.max(Math.abs(ax), Math.abs(az));
  const Rb = Rmax * R(0.94, 1);
  const A = W(Rb, 0);
  const Hb = RA(TH.baseH);
  const toC = Math.atan2(-A.z, -A.x);
  const rampAng = toC + R(0.35, 0.75) * sgn();
  const base = plateau(A, rB, Hb, rampAng, R(11, 14), SZ(0.27, 0.32)); // 小地圖：坡道陡一點、短一點
  const ramp = base.ramp;
  const rdx = Math.cos(rampAng),
    rdz = Math.sin(rampAng);
  // 坡道下的自然分礦、基地旁的 Coral（坡道的兩側）
  // 小地圖：自然分礦與 Coral 都在坡道下往外（遠離中心）的那一側、不往前推，山脊才放得下（亂數的次數照舊）
  const side0 = sgn();
  const side = size === 400 ? side0 : -rdz * ax + rdx * az >= 0 ? 1 : -1;
  const pdx = -rdz * side,
    pdz = rdx * side;
  const nk = SZ(1, 0.5);
  const natural = P(
    ramp.bottom.x + rdx * R(12, 18) * nk + pdx * R(12, 18),
    ramp.bottom.z + rdz * R(12, 18) * nk + pdz * R(12, 18),
  );
  const ck = SZ(1, -0.8),
    cs = SZ(-1, 1.25);
  const coralA = P(
    ramp.bottom.x + rdx * R(6, 12) * ck + pdx * R(16, 22) * cs,
    ramp.bottom.z + rdz * R(6, 12) * ck + pdz * R(16, 22) * cs,
  );
  // 主礦：平台上、坡道的反側
  const mAng = rampAng + Math.PI + R(-0.5, 0.5);
  const mainMine = P(A.x + Math.cos(mAng) * rB * 0.55, A.z + Math.sin(mAng) * rB * 0.55);

  // 山脊（主軸 u＝U1，橫跨地圖）＋ 2～3 個窄路口
  const [uNat] = L(natural);
  // 小地圖：山脊窄一點、彎曲小一點，所以離自然分礦 22 m 就夠（中央才留得下中立區）
  const U1 = Math.min(uNat - SZ(32, 22), Rb * RA(TH.ridgeU || [0.42, 0.5]));
  if (size !== 400 && U1 < 26) return fail({ sub }, '山脊離中心太近');
  // 礦坑的範圍（PRE.clear）、小地圖的壩體（PRE.plan.zone）離山脊要有空間
  if (PRE && PRE.clear && U1 < PRE.clear + SZ(10, 6)) return fail({ sub }, '山脊碰到礦坑');
  if (PRE && size !== 400 && !PRE.clear && PRE.plan.zone && U1 < PRE.plan.zone + 9)
    return fail({ sub }, '山脊碰到壩體');
  let vmin = 0,
    vmax = 0;
  for (let v = 0; v > -size * 1.5; v -= 2) if (inUse(W(U1, v), -40)) vmin = v;
  for (let v = 0; v < size * 1.5; v += 2) if (inUse(W(U1, v), -40)) vmax = v;
  const nGap = rng() < 0.5 ? 2 : SZ(3, 2); // 小地圖：主要通道 2 條
  const span = vmax - vmin;
  const gaps = [];
  for (let k = 0; k < nGap; k++) {
    const f = nGap === 2 ? [0.3, 0.7][k] : [0.2, 0.5, 0.8][k];
    gaps.push({ v: vmin + span * (f + R(-0.06, 0.06)), w: R(13, 19) });
  }
  const ridgeHW = size === 400 ? R(4, 6) : R(3, 4);
  const Hr = RA(TH.ridgeH);
  const uAt = (v) => U1 + (n2(v * 0.025 + 3.1, 7.7) - 0.5) * SZ(14, 8);
  const chokes = [];
  let vs = vmin - 60;
  for (let k = 0; k <= gaps.length; k++) {
    const g = gaps[k];
    const ve = g ? g.v - (g.w / 2 + ridgeHW + 4) : vmax + 60;
    const pts = [];
    for (let v = vs; v < ve; v += 8) pts.push(W(uAt(v), v));
    pts.push(W(uAt(ve), ve));
    if (pts.length >= 2) ridgeSeg(pts, ridgeHW, Hr);
    if (g) {
      chokes.push({ pos: W(uAt(g.v), g.v), w: g.w });
      vs = g.v + (g.w / 2 + ridgeHW + 4);
    }
  }
  // 中立區的台地（1～2 個，分隔通道，離中心與路口遠一點）＋瞭望高地
  const keep = [];
  const addKeep = (p, r) => keep.push({ p, r });
  addKeep(P(0, 0), 34);
  if (PRE && PRE.tavern) addKeep(P(0, 0), Math.hypot(PRE.tavern.x, PRE.tavern.z) + 12); // 礦坑地表：兩座酒館在坑緣
  for (const c of chokes) addKeep(c.pos, c.w / 2 + 16);
  const free = (p, r) =>
    (!PRE || !PRE.block(p, r)) &&
    keep.every((k) => dist(p, k.p) > k.r + r && dist(neg(p), k.p) > k.r + r) &&
    dist(p, neg(p)) > 2 * r + 10;
  const nMesa = rng() < 0.5 ? 1 : 2;
  for (let k = 0, tries = 0; k < nMesa && tries < 40; tries++) {
    const r = R(9, 15);
    const p = W(R(25, U1 - 30), R(-0.8, 0.8) * S);
    if (!inUse(p, r + 10) || !free(p, r + 8)) continue;
    blob(p, r, RA(TH.mesaH));
    addKeep(p, r + 6);
    k++;
  }
  let watch = null;
  for (let tries = 0; tries < 40 && !watch; tries++) {
    const r = R(10, 13);
    const p = W(R(30, U1 - 25), sgn() * R(...SZ([55, 115], [40, 80])));
    if (!inUse(p, r + 30) || !free(p, r + 26)) continue;
    const a = Math.atan2(-p.z, -p.x) + R(-1.2, 1.2);
    watch = plateau(p, r, RA(TH.watchH), a, R(11, 13));
    addKeep(p, r + 30);
  }

  // ---------- 點位（半張圖） ----------
  if (!inUse(natural, 10) || !isLow(natural, 8)) return fail({ sub }, '自然分礦不在低地');
  if (!inUse(coralA, 10) || !isLow(coralA, 6)) return fail({ sub }, '基地的 Coral 不在低地');
  const pts = [{ p: P(0, 0), r: PRE && PRE.clear ? PRE.clear : 14 }]; // 已佔用的點（含鏡像）：{ p, r }
  const taken = (p, r) => pts.some((q) => dist(p, q.p) < q.r + r) || dist(p, neg(p)) < 2 * r;
  const put = (p, r) => {
    pts.push({ p, r }, { p: neg(p), r });
  };
  put(A, rB + 12);
  put(natural, 14);
  put(coralA, 10);
  put(mainMine, 6);
  // 礦坑地表：兩座酒館在坑緣（成對、點對稱；R6 之後的 C 包。原本只有一間、位置由 validate 依路徑代價挑，兩邊差到 8%）
  if (PRE && PRE.tavern) put(PRE.tavern, 10);
  // 外圍分礦：基地這側（山脊後）1 個＋中立區 1～2 個
  const outer = [];
  const nOuterMid = rng() < 0.5 ? 1 : 2;
  // okP（只有小地圖的多重水壩）：另外的條件（中立建築的佔地角落與正面）
  const findLow = (uR, vR, r, tries = 60, okP = null) => {
    for (let t = 0; t < tries; t++) {
      const p = W(R(uR[0], uR[1]), R(vR[0], vR[1]) * (t & 1 ? 1 : -1));
      if (!inUse(p, 14) || !isLow(p, r) || taken(p, r + 10) || (okP && !okP(p))) continue;
      return p;
    }
    return null;
  };
  const back = findLow([U1 + 22, Rb - 10], SZ([70, 170], [45, 110]), 12);
  if (back) {
    outer.push({ p: back, rich: false });
    put(back, 14);
  }
  // 小地圖：外圍分礦每半張圖 1 座（山脊後的；放不下才放中立區的）
  const nMid = SZ(nOuterMid, back ? 0 : 1);
  for (let k = 0; k < nMid; k++) {
    const p = findLow(PRE ? PRE.range.outer(U1) : [12, U1 - 22], SZ([55, 170], [40, 110]), 12);
    if (!p) continue;
    outer.push({ p, rich: k === 0 });
    put(p, 14);
  }
  // 中立區：酒館在正中央；商店、傭兵營、中立的 Coral 成對（p 與 −p）
  // 多重水壩：中央是壩體，商店、傭兵營、中立的 Coral 放在河道外的低地（PRE.range；找不到就換子種子）
  // 小地圖：佔地的斷崖檢查多留 3 m（佔地的角落 7.8 m，isLow 只看 8 m 圓上的 9 點）
  const nbR = SZ(8, PRE && PRE.plan && PRE.plan.river ? 9 : 11); // 小地圖的多重水壩：壩體與山脊之間只有 9 m 的餘裕
  // PRE.range 的項目可以是函式（小地圖的多重水壩：依山脊的位置）
  const preR = (k) => (typeof PRE.range[k] === 'function' ? PRE.range[k](U1) : PRE.range[k]);
  // 小地圖的多重水壩（R6 之後的 C 包）：壩體與山脊之間很窄，中立建築的佔地角落與正面（validate 的要點）常常落在
  // 山脊或河岸的斷崖上：佔地的四個角與正面外 6 m 的點都要在低地（其他主題與 400 m 不檢查，地圖不變）
  const damS = !!(PRE && size !== 400 && PRE.plan && PRE.plan.river);
  const footOk = (kind) =>
    damS
      ? (p) => {
          const q = { kind, pos: p, yaw: neutralYaw(p) };
          const [fw, fd] = neutralFoot(q);
          const f = RTS_NEUTRAL_FOOT[kind][1] / 2 + 6;
          if (!isLow(P(p.x + Math.sin(q.yaw) * f, p.z + Math.cos(q.yaw) * f), 4)) return false;
          for (const [sx, sz] of [
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ])
            if (!isLow(P(p.x + (sx * fw) / 2, p.z + (sz * fd) / 2), 3)) return false;
          return true;
        }
      : null;
  const shop = PRE
    ? findLow(...preR('shop'), nbR, damS ? 400 : SZ(60, 120), footOk('shop')) ||
      (damS && findLow(...PRE.range.back(U1), nbR, 400, footOk('shop')))
    : findLow(
        ...SZ(
          [
            [-12, 12],
            [24, 46],
          ],
          [
            [-20, 20],
            [20, 60],
          ],
        ),
        nbR,
        SZ(60, 120),
      ) || SZ(W(0, 34), null);
  if (!shop) return fail({ sub }, '商店放不下');
  put(shop, 10);
  const merc = PRE
    ? findLow(...preR('merc'), nbR, damS ? 400 : SZ(60, 200), footOk('merc')) ||
      (damS && findLow(...PRE.range.back(U1), nbR, 400, footOk('merc')))
    : findLow(
        ...SZ(
          [
            [-25, 25],
            [30, 70],
          ],
          [
            [-40, 40],
            [24, 100],
          ],
        ),
        nbR,
        SZ(60, 120),
      ) || SZ(W(0, -54), null);
  if (!merc) return fail({ sub }, '傭兵營放不下');
  put(merc, 10);
  const coralMid = PRE
    ? findLow(...preR('coral'), 8, damS ? 400 : SZ(60, 200))
    : findLow(
        ...SZ(
          [
            [-20, 30],
            [60, 110],
          ],
          [
            [-30, 40],
            [28, 112],
          ],
        ),
        8,
        SZ(60, 160),
      ) || SZ(W(10, 80), null);
  if (!coralMid) return fail({ sub }, '中立的 Coral 放不下');
  put(coralMid, 10);
  // 主題的中立 Coral 多幾對（技研都市：corals.mid 2）：獨立的亂數串，荒野不呼叫
  const coralMids = [coralMid];
  if (TH.corals && TH.corals.mid > 1) {
    const xr = makeRng((sub * 59 + 23) >>> 0);
    for (let k = 1; k < TH.corals.mid; k++)
      for (let t = 0; t < 80; t++) {
        const p = W(-20 + xr() * 60, (40 + xr() * 120) * (t & 1 ? 1 : -1));
        if (!inUse(p, 14) || !isLow(p, 8) || taken(p, 18)) continue;
        put(p, 10);
        coralMids.push(p);
        break;
      }
  }
  // 野怪營地（半張圖 3～5 個）
  const camps = [];
  // 營地中心到傭兵營佔地 ≥ 30 m（雇用的單位不引出野怪；17.2 #11，只有 R6 的新主題與小地圖）
  const mercR = Math.hypot(...RTS_NEUTRAL_FOOT.merc) / 2;
  const campOk = (p) => !NEW || (dist(p, merc) > 30 + mercR && dist(p, neg(merc)) > 30 + mercR);
  const campNear = (c, r0, r1, tier, guards) => {
    for (let t = 0; t < 40; t++) {
      const a = R(0, 6.28),
        d = R(r0, r1);
      const p = P(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d);
      if (!inUse(p, 12) || !isLow(p, 5) || taken(p, 8) || !campOk(p)) continue;
      camps.push({ p, tier, guards });
      put(p, 9);
      return true;
    }
    return false;
  };
  // 小地圖：唯一的外圍分礦旁是 tier 3（大營地一對）
  outer.forEach((o, i) => campNear(o.p, 12, damS ? 30 : 20, SZ(o.rich ? 3 : 2, 3), { type: 'mine', ref: o }));
  // 瞭望高地的營地離傭兵營太近時不放（高地照樣有）
  if (watch && campOk(watch.c)) {
    camps.push({ p: watch.c, tier: 2, guards: { type: 'high' } });
    put(watch.c, 9);
  }
  for (const c of chokes.slice(0, 1)) campNear(c.pos, 22, 34, 1, { type: 'item' });
  for (let t = 0; t < SZ(30, 120) && camps.length < SZ(4, 2); t++) {
    const p = findLow(SZ([10, U1 - 10], damS ? [0, U1 + 40] : [0, U1 + 24]), SZ([20, 150], [10, 112]), 6, 4);
    if (p && campOk(p)) {
      camps.push({ p, tier: rng() < 0.3 ? 2 : 1, guards: { type: 'item' } });
      put(p, 9);
    }
  }
  if (rng() < 0.4 && camps.length < SZ(99, 3)) {
    const p = findLow(SZ([10, U1 - 10], [4, U1 - 6]), SZ([20, 150], [10, 110]), 6);
    if (p && campOk(p)) {
      camps.push({ p, tier: 1, guards: { type: 'item' } });
      put(p, 9);
    }
  }

  // ---------- 高度圖（對稱） ----------
  const n = Math.round(size / RTS_CELL) + 1;
  const h = new Float32Array(n * n);
  const rough = TH.rough;
  const lowN = (x, z) =>
    (n1(x * 0.018 + 50, z * 0.018 + 50) - 0.5) * rough + (n2(x * 0.07, z * 0.07) - 0.5) * 0.35;
  const half = (n * n - 1) / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (k > half) continue;
      const x = i * RTS_CELL - S,
        z = j * RTS_CELL - S;
      const hi = Math.max(F(x, z), F(-x, -z));
      let lo = 0.5 * (lowN(x, z) + lowN(-x, -z));
      if (PRE) lo = PRE.low(x, z, lo); // 多重水壩：壩腳的河道（低地往河床拉）
      const e = Math.max(Math.abs(x), Math.abs(z));
      const rim = TH.rimH * clamp((e - (S - EDGE)) / EDGE, 0, 1);
      const v = lo * (1 - clamp(hi / 4, 0, 0.8)) + hi + rim;
      h[k] = v;
      h[n * n - 1 - k] = v;
    }
  const hAt = heightSampler(h, n, size);
  const slopeAt = (x, z) =>
    Math.max(Math.abs(hAt(x + 1.5, z) - hAt(x - 1.5, z)), Math.abs(hAt(x, z + 1.5) - hAt(x, z - 1.5))) / 3;

  // ---------- 障礙物（半張圖散布，鏡像複製） ----------
  const obstacles = [];
  const clearOf = []; // 不能放障礙物的地方
  const noObs = (p, r) => clearOf.push({ p, r });
  noObs(A, rB + 8);
  noObs(P(0, 0), PRE && PRE.clear ? PRE.clear + 4 : 26);
  for (const q of pts) noObs(q.p, q.r + 6);
  for (const c of chokes) noObs(c.pos, c.w / 2 + 10);
  const rampMid = P((ramp.top.x + ramp.bottom.x) / 2, (ramp.top.z + ramp.bottom.z) / 2);
  noObs(rampMid, ramp.len / 2 + 14);
  noObs(ramp.bottom, 20);
  if (watch)
    noObs(P((watch.ramp.top.x + watch.ramp.bottom.x) / 2, (watch.ramp.top.z + watch.ramp.bottom.z) / 2), 18);
  const obsFree = (p, r) =>
    clearOf.every((c) => dist(p, c.p) > c.r + r && dist(neg(p), c.p) > c.r + r) &&
    obstacles.every((o) => dist(p, o) > (o.r || o.w * 0.7) + r + 6) &&
    dist(p, neg(p)) > 2 * r + 8;
  const addObs = (o) => {
    obstacles.push(o);
    const m = { ...o, x: -o.x, z: -o.z, yaw: o.yaw + Math.PI };
    obstacles.push(m);
  };
  const scatterObs = (count, spec, place) => {
    for (let k = 0, t = 0; k < count && t < count * 25; t++) {
      // 半張圖：本地 u ≥ 0 的這一側
      const p = W(R(0, Rb + 40), R(-1.2, 1.2) * S);
      const r = spec.box ? spec.box[0] * 0.75 : spec.r ? RA(spec.r) : 1;
      if (!inUse(p, 4) || !isLow(p, r + 1) || slopeAt(p.x, p.z) > 0.25 || !obsFree(p, r)) continue;
      place(p, r);
      k++;
    }
  };
  const C = TH.counts;
  // 障礙物的數量（小地圖 ×0.6，無條件進位、至少 1；400 m 和以前一樣：同樣一次亂數）
  const cnt = (ab) => {
    const v = Math.round(RA(ab));
    return SZ(v, Math.max(1, Math.ceil(v * 0.6)));
  };
  const ground = (p, sink) => hAt(p.x, p.z) - sink;
  scatterObs(cnt(C.rocks), TH.rocks, (p, r) => {
    const s = TH.rocks;
    if (s.boxW) {
      // 方塊的岩石（技研都市的廢墟）：尺寸與 90° 為單位的朝向（荒野不走這裡）
      const q = Math.floor(rng() * 4);
      const bw = RA(s.boxW),
        bd = RA(s.boxD),
        bh = RA(s.boxH);
      const [w, d] = q & 1 ? [bd, bw] : [bw, bd];
      const y = ground(p, s.sink);
      const color = Math.floor(rng() * 1e6);
      addObs({
        model: s.model,
        kind: 'box',
        x: p.x,
        z: p.z,
        w,
        d,
        h: bh,
        y,
        top: y + bh,
        yaw: q * (Math.PI / 2),
        color,
      });
      return;
    }
    const hh = RA(s.h);
    const y = ground(p, s.sink);
    addObs({ model: s.model, kind: 'circle', x: p.x, z: p.z, r, h: hh, y, top: y + hh, yaw: R(0, 6.28) });
  });
  for (let k = 0, nW = cnt(C.wrecks); k < nW; k++) {
    const s = TH.wrecks[Math.floor(rng() * TH.wrecks.length)];
    scatterObs(1, s, (p, r) => {
      const y = ground(p, s.sink);
      if (s.box) {
        const q = Math.floor(rng() * 4);
        const yaw = q * (Math.PI / 2);
        const [w, d] = q & 1 ? [s.box[2], s.box[0]] : [s.box[0], s.box[2]];
        addObs({
          model: s.model,
          kind: 'box',
          x: p.x,
          z: p.z,
          w,
          d,
          h: s.box[1],
          y,
          top: y + s.box[1],
          yaw,
          color: Math.floor(rng() * 3),
        });
      } else {
        const hh = RA(s.h);
        addObs({
          model: s.model,
          kind: 'circle',
          x: p.x,
          z: p.z,
          r,
          h: hh,
          y,
          top: y + hh,
          yaw: R(0, 6.28),
          color: Math.floor(rng() * 3),
        });
      }
    });
  }
  scatterObs(cnt(C.lights), TH.lights, (p) => {
    const s = TH.lights;
    const hh = RA(s.h);
    const y = ground(p, s.sink);
    addObs({
      model: s.model,
      kind: 'circle',
      x: p.x,
      z: p.z,
      r: s.r,
      h: hh,
      y,
      top: y + hh,
      yaw: R(0, 6.28),
    });
  });

  // ---------- 輸出（兩邊） ----------
  const yawTo = (p) => Math.atan2(-p.x, -p.z);
  const mkBase = (k) => {
    const f = k ? neg : (p) => p;
    const pos = f(A);
    const r = ramp;
    return {
      owner: k,
      pos,
      yaw: yawTo(pos),
      r: rB,
      h: Hb,
      ramp: { top: f(r.top), bottom: f(r.bottom), w: r.w, len: r.len, dir: r.dir + (k ? Math.PI : 0) },
    };
  };
  const bases = [mkBase(0), mkBase(1)];
  const mines = [];
  const pair = (arr, mk) => {
    arr.push(mk(0, (p) => p));
    arr.push(mk(1, neg));
  };
  pair(mines, (k, f) => ({ pos: f(mainMine), amount: AMOUNT.main, kind: 'main', owner: k }));
  pair(mines, (k, f) => ({ pos: f(natural), amount: AMOUNT.natural, kind: 'natural', owner: k }));
  for (const o of outer)
    pair(mines, (k, f) => ({
      pos: f(o.p),
      amount: o.rich ? AMOUNT.rich : AMOUNT.outer,
      kind: 'outer',
      owner: o.rich ? null : k,
      near: k,
    }));
  const corals = [];
  pair(corals, (k, f) => ({ pos: f(coralA), amount: AMOUNT.coralBase, owner: k }));
  for (const cm of coralMids)
    pair(corals, (k, f) => ({ pos: f(cm), amount: AMOUNT.coralMid, owner: null, near: k }));
  const campsOut = [];
  for (const c of camps)
    pair(campsOut, (k, f) => {
      let g = { type: c.guards.type };
      if (c.guards.type === 'mine') g.mine = mines.findIndex((m) => dist(m.pos, f(c.guards.ref.p)) < 0.01);
      return { pos: f(c.p), tier: c.tier, guards: g, near: k };
    });
  // 酒館在正中央（礦坑地表：坑緣的兩座，成對；near 在 validate 依路徑代價改成離主基地近的那一座）
  const tav = PRE && PRE.tavern ? PRE.tavern : null;
  const neutrals = tav ? [] : [{ kind: 'tavern', pos: P(0, 0), yaw: 0 }];
  if (tav) pair(neutrals, (k, f) => ({ kind: 'tavern', pos: f(tav), near: k, yaw: neutralYaw(f(tav)) }));
  pair(neutrals, (k, f) => ({ kind: 'shop', pos: f(shop), near: k, yaw: neutralYaw(f(shop)) }));
  pair(neutrals, (k, f) => ({ kind: 'merc', pos: f(merc), near: k, yaw: neutralYaw(f(merc)) }));
  const highs = [{ kind: 'base', pos: A, r: rB, h: Hb, ramp: bases[0].ramp }];
  if (watch) highs.push({ kind: 'watch', pos: watch.c, r: watch.r, h: watch.H, ramp: watch.ramp });
  const highsOut = [];
  for (const q of highs)
    pair(highsOut, (k, f) => ({
      kind: q.kind,
      pos: f(q.pos),
      r: q.r,
      h: q.h,
      ramp: {
        top: f(q.ramp.top),
        bottom: f(q.ramp.bottom),
        w: q.ramp.w,
        len: q.ramp.len,
        dir: q.ramp.dir + (k ? Math.PI : 0),
      },
    }));
  const chokesOut = [];
  for (const c of chokes) pair(chokesOut, (k, f) => ({ pos: f(c.pos), w: c.w }));

  const plan = {
    ok: false,
    sub,
    theme,
    size,
    cell: RTS_CELL,
    n,
    h,
    axis: th,
    obstacles,
    bases,
    mines,
    corals,
    camps: campsOut,
    neutrals,
    highs: highsOut,
    chokes: chokesOut,
    lanes: [],
  };
  // R5 的水面主題：水深 > 0.3 m 的格子不能蓋（validate）；多重水壩的壩體與坡道
  if (TH.waterY !== undefined) plan.waterY = TH.waterY;
  if (PRE) plan[PRE.key || 'dam'] = PRE.plan; // 多重水壩 plan.dam、礦坑地表 plan.pit
  // 礦坑地表：坑底的富礦與固定的 tier 3 營地（正中央，沒有成對）
  if (PRE && PRE.pitMine) {
    mines.push({ pos: P(0, 0), amount: PRE.pitMine, kind: 'outer', owner: null, rich: true, pit: true });
    campsOut.push({ pos: P(0, 0), tier: 3, guards: { type: 'mine', mine: mines.length - 1 }, pit: true });
  }
  const nCamp = campsOut.filter((c) => !c.pit).length;
  const [cMin, cMax] = SZ([6, 10], [4, 6]);
  if (nCamp < cMin || nCamp > cMax) return fail(plan, `營地數 ${nCamp}`);
  if (outer.length < SZ(2, 1)) return fail(plan, '外圍分礦不足');
  // 主題的附加地形（冰湖…）：在高度圖與障礙物之後、檢查之前；自己的亂數串 makeRng(sub × 53 ＋ 19)
  const ctx = { rng: makeRng((sub * 53 + 19) >>> 0), high, W, S, U1, chokes, inUse, sub, pre: PRE, size, SZ };
  if (TH.extra) {
    const why = TH.extra(plan, ctx);
    if (why) return fail(plan, why);
  }
  const v = validate(plan);
  if (v.ok && TH.after) {
    const why = TH.after(v, ctx);
    if (why) return fail(v, why);
  }
  return v;
}

// ---------- 主題的附加地形（docs 14.8、14.14） ----------
export const RTS_ICE_Y = -0.7; // World.onIce 的冰面高度
const ICE_BAND = 5; // 冰湖邊緣的過渡（m）
// 點在橢圓裡的程度：< 1＝湖面裡（rot＝長軸的方向角）
const lakeQ = (L, x, z) => {
  const dx = x - L.x,
    dz = z - L.z,
    c = Math.cos(L.rot),
    s = Math.sin(L.rot);
  const lx = dx * c + dz * s,
    lz = -dx * s + dz * c;
  return Math.sqrt((lx / L.rx) ** 2 + (lz / L.rz) ** 2);
};
export const rtsOnLake = (plan, x, z) => (plan.ice || []).some((L) => lakeQ(L, x, z) < 1);
// 冰原：每半張圖 1～2 個橢圓冰湖（長軸 24～40 m），壓平到冰面高度；第一個在主要通道上，
// 不放在主基地、分礦、湧出點 20 m 內，避開營地、中立建築、高地；湖裡與邊緣的障礙物移除
function iceLakes(plan, c) {
  const r = c.rng;
  const R = (a, b) => a + (b - a) * r();
  const K = c.SZ; // 小地圖（R6）：湖小一點、離資源近一點
  const keep = [];
  for (const b of plan.highs)
    keep.push([b.pos, b.r + 6], [b.ramp.bottom, K(16, 10)], [b.ramp.top, K(12, 10)]);
  for (const m of plan.mines) keep.push([m.pos, K(20, 12)]);
  for (const q of plan.corals) keep.push([q.pos, K(20, 12)]);
  const kc = K(10, 7),
    kn = K(12, 9);
  for (const q of plan.camps) keep.push([q.pos, kc]);
  for (const q of plan.neutrals) keep.push([q.pos, kn]);
  const lakes = [];
  const fits = (L) => {
    const big = Math.max(L.rx, L.rz),
      small = Math.min(L.rx, L.rz);
    if (Math.hypot(L.x, L.z) < big + 8) return false; // 不碰到自己的鏡像
    // 到湖緣的距離（沿著從湖心出發的射線）
    for (const [p, rr] of keep) {
      const q = lakeQ(L, p.x, p.z);
      if (q < 1 || Math.hypot(p.x - L.x, p.z - L.z) * (1 - 1 / q) < rr + ICE_BAND) return false;
    }
    for (const o of lakes)
      for (const sg of [1, -1])
        if (Math.hypot(L.x - sg * o.x, L.z - sg * o.z) < big + Math.max(o.rx, o.rz) + 10) return false;
    // 整個湖（含邊緣的過渡）都是低地
    const sc = 1 + (ICE_BAND + 2) / small;
    const cs = Math.cos(L.rot),
      sn = Math.sin(L.rot);
    for (const k of [0, 0.55, sc])
      for (let a = 0; a < (k ? 16 : 1); a++) {
        const t = (a / 16) * Math.PI * 2,
          lx = Math.cos(t) * L.rx * k,
          lz = Math.sin(t) * L.rz * k;
        const p = { x: L.x + lx * cs - lz * sn, z: L.z + lx * sn + lz * cs };
        if (!c.inUse(p, 6) || c.high(p) > 0.05) return false;
      }
    return true;
  };
  let rMax = K(20, 12);
  const make = (x, z, rot) => {
    const rx = R(K(12, 8), rMax);
    return { x, z, rx, rz: rx * R(0.55, 0.8), rot };
  };
  // 第一個：主要通道（第一次檢查算出的 plan.lanes，A 側的前半段）上，長軸順著通道
  for (let t = 0; t < K(80, 240) && !lakes.length; t++) {
    if (t === 40) rMax = K(15, 10);
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) break;
    let tot = 0;
    for (let k = 1; k < lane.length; k++)
      tot += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].z - lane[k - 1].z);
    let want = tot * R(...K([0.12, 0.42], [0.12, 0.6]));
    for (let k = 1; k < lane.length; k++) {
      const a = lane[k - 1],
        b = lane[k];
      const sl = Math.hypot(b.x - a.x, b.z - a.z);
      if (want > sl) {
        want -= sl;
        continue;
      }
      const ux = (b.x - a.x) / (sl || 1),
        uz = (b.z - a.z) / (sl || 1),
        side = R(-3, 3);
      const L = make(
        a.x + ux * want - uz * side,
        a.z + uz * want + ux * side,
        Math.atan2(uz, ux) + R(-0.25, 0.25),
      );
      if (fits(L)) lakes.push(L);
      break;
    }
  }
  rMax = K(20, 12);
  if (!lakes.length) return '冰湖放不下';
  if (r() < 0.5)
    for (let t = 0; t < 40; t++) {
      const p = c.W(R(10, c.U1 + 40), R(-0.9, 0.9) * c.S);
      const L = make(p.x, p.z, R(0, Math.PI));
      if (fits(L)) {
        lakes.push(L);
        break;
      }
    }
  const all = [];
  for (const L of lakes) all.push(L, { ...L, x: -L.x, z: -L.z });
  // 高度：湖面＝冰面高度，邊緣 ICE_BAND 公尺平滑過渡（k 與 N²−1−k 同值，維持對稱）
  const n = plan.n,
    h = plan.h,
    S = plan.size / 2,
    half = (n * n - 1) / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (k > half) continue;
      const x = i * RTS_CELL - S,
        z = j * RTS_CELL - S;
      let w = 0;
      for (const L of all) {
        const e = L.rx + ICE_BAND + 1;
        if (Math.abs(x - L.x) > e || Math.abs(z - L.z) > e) continue;
        const q = lakeQ(L, x, z);
        const v = q <= 1 ? 1 : 1 - sm(((q - 1) * Math.min(L.rx, L.rz)) / ICE_BAND);
        if (v > w) w = v;
      }
      if (w <= 0) continue;
      const v = h[k] + (RTS_ICE_Y - h[k]) * w;
      h[k] = v;
      h[n * n - 1 - k] = v;
    }
  // 湖裡與邊緣的障礙物移除（成對：鏡像的湖蓋住鏡像的障礙物）
  plan.obstacles = plan.obstacles.filter((o) => {
    const or = o.r || Math.hypot(o.w || 0, o.d || 0) / 2;
    return all.every((L) => lakeQ(L, o.x, o.z) > 1 + (or + ICE_BAND + 1) / Math.min(L.rx, L.rz));
  });
  plan.ice = all.map((L) => ({ x: L.x, z: L.z, rx: L.rx, rz: L.rz, rot: L.rot, y: RTS_ICE_Y }));
  return '';
}
// 冰原：冰湖放在第一次檢查算出的通道上 → 改了高度圖與障礙物，所以整個重新檢查一次（不合格換子種子）→
// 至少一個冰湖在重新算出的通道上
function iceAfter(plan, c) {
  const why = iceLakes(plan, c);
  if (why) return why;
  if (!validate(plan).ok) return plan.fail;
  // 小地圖（R6）：冰湖在通道 8 m 內就好（重新算出的通道常常繞過小的湖）
  if (
    c.size !== 400 &&
    plan.ice.some((L) =>
      laneDots(plan).some((d) => lakeQ({ ...L, rx: L.rx + 8, rz: L.rz + 8 }, d.x, d.z) < 1),
    )
  )
    return '';
  return iceOnLane(plan);
}
function iceOnLane(plan) {
  for (const lane of plan.lanes)
    for (let k = 1; k < lane.length; k++) {
      const a = lane[k - 1],
        b = lane[k];
      const m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let s = 0; s <= m; s++)
        if (rtsOnLake(plan, a.x + ((b.x - a.x) * s) / m, a.z + ((b.z - a.z) * s) / m)) return '';
    }
  return '冰湖不在通道上';
}
// 技研都市：地表裂開的 Coral 脈（只有外觀、不擋路），沿主要通道（A 側的前半段）每 10～18 m 一段，轉 180° 複製
function coralVeins(plan, c) {
  const r = c.rng;
  const R = (a, b) => a + (b - a) * r();
  const th = heightSampler(plan.h, plan.n, plan.size);
  const decor = [];
  const ok = (x, z, len, yaw) => {
    for (const m of plan.mines) if (Math.hypot(m.pos.x - x, m.pos.z - z) < 10 + len / 2) return false;
    for (const q of plan.corals) if (Math.hypot(q.pos.x - x, q.pos.z - z) < 8 + len / 2) return false;
    for (const q of plan.neutrals) if (Math.hypot(q.pos.x - x, q.pos.z - z) < 12 + len / 2) return false;
    for (const o of plan.obstacles)
      if (Math.hypot(o.x - x, o.z - z) < (o.r || Math.hypot(o.w, o.d) / 2) + len / 2 + 1) return false;
    for (const d of decor) if (Math.hypot(d.x - x, d.z - z) < 5) return false;
    const ex = (Math.cos(yaw) * len) / 2,
      ez = (-Math.sin(yaw) * len) / 2;
    return Math.abs(th(x + ex, z + ez) - th(x - ex, z - ez)) < 0.5 && Math.hypot(x, z) > len;
  };
  for (const lane of plan.lanes) {
    let tot = 0;
    for (let k = 1; k < lane.length; k++)
      tot += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].z - lane[k - 1].z);
    let walked = 0,
      next = R(6, 14);
    for (let k = 1; k < lane.length && walked < tot / 2; k++) {
      const a = lane[k - 1],
        b = lane[k];
      const sl = Math.hypot(b.x - a.x, b.z - a.z) || 1e-6;
      const dx = (b.x - a.x) / sl,
        dz = (b.z - a.z) / sl;
      while (next <= walked + sl && next < tot / 2) {
        const f = (next - walked) / sl;
        const side = R(-5, 5);
        const x = a.x + (b.x - a.x) * f - dz * side,
          z = a.z + (b.z - a.z) * f + dx * side;
        const len = R(4, 8),
          yaw = Math.atan2(-dz, dx) + R(-0.4, 0.4);
        if (r() < 0.75 && ok(x, z, len, yaw)) {
          const y = th(x, z) + 0.02;
          decor.push({ model: 'coralvein', x, z, y, len, yaw });
          decor.push({ model: 'coralvein', x: -x, z: -z, y, len, yaw: yaw + Math.PI });
        }
        next += R(10, 18);
      }
      walked += sl;
    }
  }
  plan.decor = decor;
  return '';
}

// ---------- R4 的附加地形（docs 15.8、15.14）：舊宇宙港外圍的發射台與防爆牆列、Grid 086 地表的構造體台階 ----------
// 共用：通道（plan.lanes）加密成每 2 m 一點；結構的高度函式 F(x, z)（0＝沒有）＋鏡像，寫進高度圖時取 max
// （k 與 N²−1−k 同值，維持對稱），結構蓋到的障礙物成對移除，改了地形所以整個重新 validate。
const STRUCT_SLOPE = 0.36; // 結構坡道的坡度（地形的坡道 0.27；NAV_SLOPE 0.6 以下都能走）
function laneDots(plan) {
  const out = [];
  for (const ln of plan.lanes)
    for (let k = 1; k < ln.length; k++) {
      const a = ln[k - 1],
        b = ln[k];
      const m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
      for (let s = 0; s < m; s++)
        out.push({ x: a.x + ((b.x - a.x) * s) / m, z: a.z + ((b.z - a.z) * s) / m });
    }
  return out;
}
// 通道上 f（0～1，依長度）的位置與方向（單位向量）
function laneAt(lane, f) {
  let tot = 0;
  for (let k = 1; k < lane.length; k++)
    tot += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].z - lane[k - 1].z);
  let want = tot * f;
  for (let k = 1; k < lane.length; k++) {
    const a = lane[k - 1],
      b = lane[k];
    const sl = Math.hypot(b.x - a.x, b.z - a.z);
    if (want > sl && k < lane.length - 1) {
      want -= sl;
      continue;
    }
    const t = sl ? Math.min(1, want / sl) : 0;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      dx: (b.x - a.x) / (sl || 1),
      dz: (b.z - a.z) / (sl || 1),
    };
  }
  return null;
}
// 不能靠近的點（{ p, r }：結構的高度函式在這個圓上要是 0）
function structKeep(plan, m) {
  const keep = [];
  for (const b of plan.highs) {
    const base = b.kind === 'base';
    keep.push({ p: b.pos, r: b.r + (base ? m.base : 8) });
    keep.push({ p: b.ramp.bottom, r: base ? 14 : 10 }, { p: b.ramp.top, r: 8 });
  }
  for (const q of plan.mines) keep.push({ p: q.pos, r: m.res });
  for (const q of plan.corals) keep.push({ p: q.pos, r: m.res });
  for (const q of plan.camps) keep.push({ p: q.pos, r: m.camp });
  for (const q of plan.neutrals) keep.push({ p: q.pos, r: m.neutral });
  for (const q of plan.chokes) keep.push({ p: q.pos, r: q.w / 2 + 6 });
  return keep;
}
// 高度圖寫入（all＝含鏡像的結構，各有 F(x, z)）
function stampStructs(plan, all) {
  const n = plan.n,
    h = plan.h,
    S = plan.size / 2,
    half = (n * n - 1) / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (k > half) continue;
      const v = structH(all, i * RTS_CELL - S, j * RTS_CELL - S);
      if (v <= h[k]) continue;
      h[k] = v;
      h[n * n - 1 - k] = v;
    }
}
function structH(all, x, z) {
  let v = 0;
  for (const s of all)
    if (!(x < s.bb[0] || x > s.bb[1] || z < s.bb[2] || z > s.bb[3])) v = Math.max(v, s.F(x, z));
  return v;
}
// 結構蓋到的障礙物移除（中心與外圍 4 點有高度＝蓋到；結構是對稱的，所以成對移除）
function clearUnder(plan, all, pad = 2) {
  plan.obstacles = plan.obstacles.filter((o) => {
    const r = (o.r || Math.hypot(o.w || 0, o.d || 0) / 2) + pad;
    for (const [dx, dz] of [
      [0, 0],
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ])
      if (structH(all, o.x + dx, o.z + dz) > 0.05) return false;
    return true;
  });
}
// 圓形台地＋一條坡道（發射台）：頂面平（H）、邊緣 cw 公尺的斷崖、坡道沿 ang 往外
function padStruct(c, r, H, ang, rw) {
  const cw = 2.5;
  const dx = Math.cos(ang),
    dz = Math.sin(ang);
  const len = H / STRUCT_SLOPE;
  const rs = P(c.x + dx * (r - 1), c.z + dz * (r - 1));
  const re = P(rs.x + dx * len, rs.z + dz * len);
  const ext = r + cw + len + rw;
  return {
    c,
    r,
    H,
    ramp: { top: rs, bottom: re, w: rw, len, dir: Math.atan2(dx, dz), ang },
    bb: [c.x - ext, c.x + ext, c.z - ext, c.z + ext],
    F(x, z) {
      let t = sm((r + cw - Math.hypot(x - c.x, z - c.z)) / cw);
      if (t < 1) {
        const px = x - rs.x,
          pz = z - rs.z;
        const al = px * dx + pz * dz,
          lat = Math.abs(-px * dz + pz * dx);
        if (al > -3 && al < len && lat < rw / 2 + 2) {
          const rt = 1 - clamp(al / len, 0, 1);
          t = Math.max(t, rt * clamp((rw / 2 + 2 - lat) / 2, 0, 1));
        }
      }
      return t * H;
    },
  };
}
// 兩層的長方形台階（構造體）：本地 u 沿長軸（phi 方向）、v 橫向；下層 L×W 高 H1，上層在 +u 端（長 Lu）高 H1＋H2；
// 地面坡道接在 −u 端往外（橫向位置 vb、寬 rw1），上層坡道在下層上沿 +u 爬升到上層（橫向位置 vr、寬 rw2）
function stepStruct(o) {
  const { c, phi, L, W, H1, H2, Lu, vb, rw1, vr, rw2 } = o;
  const cw = 2;
  const cs = Math.cos(phi),
    sn = Math.sin(phi);
  const len1 = H1 / STRUCT_SLOPE,
    len2 = H2 / STRUCT_SLOPE;
  const u2 = L / 2 - Lu; // 上層的起點
  const ext = Math.hypot(L / 2 + len1 + cw, W / 2 + cw) + 1;
  const toW = (u, v) => P(c.x + u * cs - v * sn, c.z + u * sn + v * cs);
  const lm = (d, w) => clamp((w / 2 + 2.5 - d) / 2.5, 0, 1);
  return {
    ...o,
    len1,
    len2,
    u2,
    toW,
    ramp1: { bottom: toW(-L / 2 - len1, vb), top: toW(-L / 2, vb), w: rw1 },
    ramp2: { bottom: toW(u2 - len2, vr), top: toW(u2, vr), w: rw2 },
    top: toW(u2 + Lu / 2, 0),
    bb: [c.x - ext, c.x + ext, c.z - ext, c.z + ext],
    F(x, z) {
      const dx = x - c.x,
        dz = z - c.z;
      const u = dx * cs + dz * sn,
        v = -dx * sn + dz * cs;
      const au = Math.abs(u),
        av = Math.abs(v);
      let h = H1 * sm((Math.min(L / 2 - au, W / 2 - av) + cw) / cw);
      const up = sm((Math.min(Lu / 2 - Math.abs(u - (u2 + Lu / 2)), W / 2 - av) + cw) / cw);
      if (up > 0) h = Math.max(h, (H1 + H2) * up);
      // 地面坡道（−u 端往外）
      if (u < -L / 2 + 1 && u > -L / 2 - len1 - 1) {
        const k = lm(Math.abs(v - vb), rw1);
        if (k > 0) h = Math.max(h, H1 * (1 - clamp((-L / 2 - u) / len1, 0, 1)) * k);
      }
      // 上層坡道（在下層上）
      if (u > u2 - len2 - 1 && u < u2 + 1 && au < L / 2 && av < W / 2) {
        const k = lm(Math.abs(v - vr), rw2);
        if (k > 0) h = Math.max(h, H1 + H2 * clamp((u - (u2 - len2)) / len2, 0, 1) * k);
      }
      return h;
    },
  };
}
// 放得下：keep 的圓上與中心沒有高度、離通道 laneGap 以上、不碰到其他結構與自己的鏡像、取樣點都在低地與範圍裡
function structFits(s, c, m, keep, dots, laneGap, others) {
  const outline = s.samples(0);
  for (const k of keep) {
    if (s.F(k.p.x, k.p.z) > 0.02) return false;
    for (const [x, z] of outline) if (Math.hypot(x - k.p.x, z - k.p.z) < k.r) return false;
  }
  for (const d of dots) if (s.near(d.x, d.z, laneGap)) return false;
  for (const o of others)
    for (const [x, z] of outline) if (o.near(x, z, 8) || o.near(-x, -z, 8)) return false;
  const mi = s.mirror();
  for (const [x, z] of s.samples(m)) {
    const p = P(x, z);
    if (!c.inUse(p, 6)) return false;
    if (c.high(p) > 0.05) return false;
    if (mi.F(x, z) > 0.02) return false;
  }
  return true;
}

// 舊宇宙港外圍：發射台（每半張圖 1 個圓形台地＋坡道，頂面可以蓋，台上一角是發射塔）→ 重新檢查 →
// 防爆牆列（另一條亂數串）→ 再檢查（新的通道離防爆牆 6 m 以上）
function padsAfter(plan, c) {
  const r = c.rng;
  const R = (a, b) => a + (b - a) * r();
  const K = c.SZ; // 小地圖（R6）：發射台小一點、間距小一點
  const keep = structKeep(
    plan,
    K({ base: 25, res: 20, camp: 12, neutral: 15 }, { base: 10, res: 10, camp: 8, neutral: 13 }),
  );
  const dots = laneDots(plan);
  let pad = null;
  for (let t = 0; t < K(300, 1200) && !pad; t++) {
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) return '通道不足';
    let q = laneAt(lane, R(0.25, 0.65));
    // 小地圖（R6）：一半的嘗試改在中立區隨機的位置與方向
    if (c.size !== 400 && t % 2 === 1) {
      const p = c.W(R(0, c.U1 + 20), R(-0.9, 0.9) * c.S),
        a = R(0, Math.PI * 2);
      q = { x: p.x, z: p.z, dx: Math.cos(a), dz: Math.sin(a) };
    }
    const rad = R(...K([14, 18], [12, 14])),
      H = R(...K([6, 8], [5, 6])),
      rw = R(12, 14),
      side = r() < 0.5 ? 1 : -1;
    const off = rad + R(8, 22);
    const cc = P(q.x - q.dz * side * off, q.z + q.dx * side * off);
    // 坡道順著通道（往前或往後）或背向通道，不橫越通道（三個方向依序試，不另外用亂數）
    const a0 = Math.atan2(q.dz, q.dx);
    for (const ang of [a0, a0 + Math.PI, Math.atan2(cc.z - q.z, cc.x - q.x)]) {
      const s = padStruct(cc, rad, H, ang, rw);
      s.R = rad + s.ramp.len;
      s.mirror = () => padStruct(neg(cc), rad, H, ang + Math.PI, rw);
      s.near = (x, z, m) => s.F(x, z) > 0.02 || Math.hypot(x - cc.x, z - cc.z) < rad + m;
      s.samples = (m) => {
        const out = [[cc.x, cc.z]];
        for (let a = 0; a < 16; a++) {
          const th = (a / 16) * Math.PI * 2;
          out.push([cc.x + Math.cos(th) * (rad + m), cc.z + Math.sin(th) * (rad + m)]);
        }
        const rp = s.ramp;
        for (let f = 0; f <= 1; f += 0.25)
          for (const sd of [-1, 1])
            out.push([
              rp.top.x + (rp.bottom.x - rp.top.x) * f - Math.sin(ang) * sd * (rw / 2 + m),
              rp.top.z + (rp.bottom.z - rp.top.z) * f + Math.cos(ang) * sd * (rw / 2 + m),
            ]);
        return out;
      };
      if (Math.hypot(cc.x, cc.z) < s.R + 12) continue;
      if (structFits(s, c, 3, keep, dots, 6, [])) {
        pad = s;
        break;
      }
    }
  }
  if (!pad) return '發射台放不下';
  const all = [pad, pad.mirror()];
  stampStructs(plan, all);
  clearUnder(plan, all);
  // 發射塔（縮小 0.55）：頂面上、坡道的反側一角；方塊碰撞＝塔＋火箭的外框（朝向以 90° 為單位）
  const ts = K(0.55, 0.42); // 小地圖：發射塔小一點（台頂留得下路）
  const q4 = Math.floor(r() * 4);
  const [tw, td] = q4 & 1 ? [6.4 * ts, 13.2 * ts] : [13.2 * ts, 6.4 * ts];
  const back = pad.ramp.ang + Math.PI + R(-0.6, 0.6);
  const td0 = pad.r - Math.hypot(tw, td) / 2 - 1.5;
  const tx = pad.c.x + Math.cos(back) * td0,
    tz = pad.c.z + Math.sin(back) * td0;
  const tower = {
    model: 'launchtower',
    kind: 'box',
    x: tx,
    z: tz,
    w: tw,
    d: td,
    h: 46 * ts,
    y: pad.H - 0.1,
    top: pad.H - 0.1 + 46 * ts,
    yaw: q4 * (Math.PI / 2),
    s: ts,
  };
  plan.obstacles.push(tower, { ...tower, x: -tx, z: -tz, yaw: tower.yaw + Math.PI });
  plan.pads = all.map((s, k) => ({
    pos: s.c,
    r: s.r,
    h: s.H,
    near: k,
    ramp: { top: s.ramp.top, bottom: s.ramp.bottom, w: s.ramp.w, len: s.ramp.len, dir: s.ramp.dir },
  }));
  if (!validate(plan).ok) return plan.fail;
  // 防爆牆列：每半張圖 2～3 列、每列 3～5 段（8 × 4 × 1.2 m），雁行斜放（每段沿列錯開）在通道旁，
  // 離通道的路徑 6 m 以外（不擋中線）
  const wr = makeRng((c.sub * 61 + 29) >>> 0);
  const WR = (a, b) => a + (b - a) * wr();
  const dots2 = laneDots(plan);
  const keep2 = structKeep(plan, { base: 8, res: 12, camp: 10, neutral: 12 });
  const hAt = heightSampler(plan.h, plan.n, plan.size);
  const segFree = (x, z, w, d, rows) => {
    const hw = w / 2,
      hd = d / 2,
      hr = Math.hypot(hw, hd);
    for (const p of dots2)
      if (Math.max(Math.abs(p.x - x) - hw, 0) ** 2 + Math.max(Math.abs(p.z - z) - hd, 0) ** 2 < 64)
        return false;
    for (const k of keep2) if (Math.hypot(k.p.x - x, k.p.z - z) < k.r + hr) return false;
    for (const o of plan.obstacles)
      if (Math.hypot(o.x - x, o.z - z) < (o.r || Math.hypot(o.w, o.d) / 2) + hr + 2) return false;
    for (const q of rows) if (Math.hypot(q.x - x, q.z - z) < 2 * hr + 1 && !q.same) return false;
    if (Math.hypot(x, z) < hr + 6) return false; // 自己的鏡像
    for (const s of all) if (Math.hypot(x - s.c.x, z - s.c.z) < s.r + 8 || s.F(x, z) > 0.02) return false;
    for (const [ox, oz] of [
      [0, 0],
      [-hw, -hd],
      [hw, -hd],
      [-hw, hd],
      [hw, hd],
    ]) {
      const p = P(x + ox, z + oz);
      if (!c.inUse(p, 6) || c.high(p) > 0.05 || structH(all, p.x, p.z) > 0.02) return false;
    }
    return Math.abs(hAt(x - hw, z - hd) - hAt(x + hw, z + hd)) < 1.2;
  };
  const nRows = wr() < 0.5 ? 2 : K(3, 2);
  const walls = [];
  for (let k = 0, t = 0; k < nRows && t < 200; t++) {
    const lane = plan.lanes[Math.floor(wr() * plan.lanes.length)];
    const q = laneAt(lane, WR(0.08, 0.5));
    if (!q) continue;
    const side = wr() < 0.5 ? 1 : -1;
    const off = WR(10, 20);
    const nSeg = 3 + Math.floor(wr() * 3);
    // 列的方向：以 90° 為單位、最接近通道方向（障礙物的碰撞是軸對齊的方塊）；雁行錯開 stag
    const alongX = Math.abs(q.dx) >= Math.abs(q.dz);
    const stag = WR(1.2, 2.2) * (wr() < 0.5 ? 1 : -1);
    const [w, d] = alongX ? [8, 1.2] : [1.2, 8];
    const cx = q.x - q.dz * side * off,
      cz = q.z + q.dx * side * off;
    const segs = [];
    for (let s = 0; s < nSeg; s++) {
      const a = (s - (nSeg - 1) / 2) * 8.6,
        b = (s - (nSeg - 1) / 2) * stag;
      const x = alongX ? cx + a : cx + b,
        z = alongX ? cz + b : cz + a;
      if (!segFree(x, z, w, d, [...walls, ...segs.map((p) => ({ ...p, same: true }))])) break;
      segs.push({ x, z });
    }
    if (segs.length < 3) continue; // 放不滿的列至少 3 段
    for (const p of segs) {
      const y = hAt(p.x, p.z) - 0.1;
      const o = {
        model: 'blastwall',
        kind: 'box',
        x: p.x,
        z: p.z,
        w,
        d,
        h: 4,
        y,
        top: y + 4,
        yaw: alongX ? 0 : Math.PI / 2,
        row: k + 1,
      };
      plan.obstacles.push(o, { ...o, x: -p.x, z: -p.z, yaw: o.yaw + Math.PI });
      walls.push(p);
    }
    k++;
  }
  if (walls.length < K(6, 3)) return '防爆牆放不下';
  // 重新檢查；新的通道（繞過防爆牆）離某一列不到 WALL_GAP 時拿掉那一列（成對）再檢查，最多兩次
  for (let it = 0; ; it++) {
    if (!validate(plan).ok) return plan.fail;
    const bad = wallsBad(plan);
    if (!bad.size) break;
    if (it >= 2) return '防爆牆擋到通道';
    plan.obstacles = plan.obstacles.filter((o) => !bad.has(o.row));
  }
  return plan.obstacles.filter((o) => o.row).length >= K(12, 4) ? '' : '防爆牆放不下';
}
// 防爆牆列（row）離通道的路徑：WALL_GAP 公尺以內的列（放的時候離檢查前的通道 8 m 以上；通道會繞過防爆牆，所以重新算的
// 通道只要求 WALL_GAP）
export const WALL_GAP = 3;
export function wallsBad(plan, gap = WALL_GAP) {
  const dots = laneDots(plan);
  const bad = new Set();
  for (const o of plan.obstacles) {
    if (!o.row || bad.has(o.row)) continue;
    for (const p of dots)
      if (
        Math.max(Math.abs(p.x - o.x) - o.w / 2, 0) ** 2 + Math.max(Math.abs(p.z - o.z) - o.d / 2, 0) ** 2 <
        gap * gap - 1e-6
      ) {
        bad.add(o.row);
        break;
      }
  }
  return bad;
}

// Grid 086 地表：每半張圖 2 組兩層的構造體台階（順著通道、放在通道旁），頂層可以蓋；
// 邊緣的金屬牆（地形的斷崖外側，裝飾）＋地面的鋼板接縫與排水溝（裝飾）
function stepsAfter(plan, c) {
  const r = c.rng;
  const R = (a, b) => a + (b - a) * r();
  const K = c.SZ; // 小地圖（R6）：每半張圖 1 組、小一點
  const keep = structKeep(
    plan,
    K({ base: 20, res: 20, camp: 12, neutral: 15 }, { base: 10, res: 10, camp: 8, neutral: 13 }),
  );
  const dots = laneDots(plan);
  const steps = [];
  const nSteps = K(2, 1);
  for (let t = 0; t < K(400, 1600) && steps.length < nSteps; t++) {
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) return '通道不足';
    let q = laneAt(lane, R(0.12, 0.8));
    // 小地圖（R6）：一半的嘗試改在中立區隨機的位置與方向（通道旁常常放不下）
    if (c.size !== 400 && t % 2 === 1) {
      const p = c.W(R(0, c.U1 + 20), R(-0.9, 0.9) * c.S),
        a = R(0, Math.PI * 2);
      q = { x: p.x, z: p.z, dx: Math.cos(a), dz: Math.sin(a) };
    }
    const H1 = R(4, 5),
      H2 = R(4, 5);
    const len2 = H2 / STRUCT_SLOPE;
    // 下層：地面坡道上來的平台（landing 3 m）＋上層坡道（整個寬度）；上層 Lu ≥ 14 m（頂層才放得下 8×8 的建築）
    const L = R(Math.max(24, len2 + 17), K(38, 31)),
      W = R(...K([16, 20], [16, 17]));
    const Lu = L - len2 - 3;
    const rw1 = R(11, 13);
    const vb = R(-0.5, 0.5) * Math.max(0, W / 2 - rw1 / 2 - 0.5);
    const off = W / 2 + R(6, K(24, 12));
    let got = null;
    // 通道的兩側 × 兩個方向依序試（不另外用亂數）
    for (const side of [1, -1])
      for (const flip of [0, Math.PI]) {
        if (got) break;
        const cc = P(q.x - q.dz * side * off, q.z + q.dx * side * off);
        const s = stepStruct({
          c: cc,
          phi: Math.atan2(q.dz, q.dx) + flip,
          L,
          W,
          H1,
          H2,
          Lu,
          vb,
          rw1,
          vr: 0,
          rw2: W + 4,
        });
        s.R = Math.hypot(L / 2 + s.len1, W / 2);
        s.mirror = () => stepStruct({ ...s, c: neg(cc), phi: s.phi + Math.PI });
        const cs = Math.cos(s.phi),
          sn = Math.sin(s.phi);
        s.near = (x, z, m) => {
          const dx = x - cc.x,
            dz = z - cc.z;
          const u = dx * cs + dz * sn,
            v = -dx * sn + dz * cs;
          return u > -L / 2 - s.len1 - m && u < L / 2 + m && Math.abs(v) < W / 2 + m;
        };
        s.samples = (m) => {
          const out = [];
          const su = (L + s.len1 + 2 * m) / 8,
            sv = (W + 2 * m) / 4;
          for (let u = -L / 2 - s.len1 - m; u <= L / 2 + m + 1e-6; u += su)
            for (let v = -W / 2 - m; v <= W / 2 + m + 1e-6; v += sv) {
              const p = s.toW(u, v);
              out.push([p.x, p.z]);
            }
          return out;
        };
        if (Math.hypot(cc.x, cc.z) < s.R + 12) continue;
        if (structFits(s, c, 3, keep, dots, 5, steps)) got = s;
      }
    if (got) steps.push(got);
  }
  if (steps.length < nSteps) return '構造體台階放不下';
  const all = [];
  for (const s of steps) all.push(s, s.mirror());
  stampStructs(plan, all);
  clearUnder(plan, all);
  plan.steps = all.map((s, k) => ({
    pos: s.c,
    yaw: s.phi,
    L: s.L,
    W: s.W,
    h1: s.H1,
    h2: s.H2,
    near: k & 1,
    top: s.top,
    ramps: [
      { bottom: s.ramp1.bottom, top: s.ramp1.top, w: s.ramp1.w },
      { bottom: s.ramp2.bottom, top: s.ramp2.top, w: s.ramp2.w },
    ],
  }));
  if (!validate(plan).ok) return plan.fail;
  // 金屬牆：斷崖（cw 2 m）的中段、坡道接上的地方留空；每段約 6 m
  const decor = [];
  const wallRun = (s, a0, a1, fixed, alongU, hBot, hTop, skip) => {
    const L0 = Math.abs(a1 - a0);
    const nSeg = Math.max(1, Math.round(L0 / 6));
    const sl = L0 / nSeg;
    for (let k = 0; k < nSeg; k++) {
      const m = Math.min(a0, a1) + sl * (k + 0.5);
      if (skip && skip(m)) continue;
      const p = alongU ? s.toW(m, fixed) : s.toW(fixed, m);
      const hh = hTop - hBot;
      decor.push({
        model: 'g86wall',
        x: p.x,
        z: p.z,
        y: hBot + hh / 2 - 0.3,
        len: sl + 0.05,
        h: hh + 0.6,
        yaw: alongU ? -s.phi : -s.phi + Math.PI / 2,
      });
    }
  };
  for (const s of steps) {
    const { L, W, H1, H2, u2, vb, rw1, vr, rw2 } = s;
    const o = 1.0;
    wallRun(s, -L / 2, u2, W / 2 + o, true, 0, H1);
    wallRun(s, -L / 2, u2, -W / 2 - o, true, 0, H1);
    wallRun(s, -W / 2, W / 2, -L / 2 - o, false, 0, H1, (v) => Math.abs(v - vb) < rw1 / 2 + 2);
    wallRun(s, u2, L / 2, W / 2 + o, true, 0, H1 + H2);
    wallRun(s, u2, L / 2, -W / 2 - o, true, 0, H1 + H2);
    wallRun(s, -W / 2, W / 2, L / 2 + o, false, 0, H1 + H2);
    wallRun(s, -W / 2, W / 2, u2 - o, false, H1, H1 + H2, (v) => Math.abs(v - vr) < rw2 / 2 + 2);
  }
  const n0 = decor.length;
  for (let k = 0; k < n0; k++) {
    const d = decor[k];
    decor.push({ ...d, x: -d.x, z: -d.z, yaw: d.yaw + Math.PI });
  }
  // 鋼板接縫與排水溝：沿通道（A 側前半段）每 9～16 m 一段，避開礦脈、湧出點、中立建築、障礙物、結構與坡（另一條亂數串）
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  const DR = (a, b) => a + (b - a) * dr();
  const th = heightSampler(plan.h, plan.n, plan.size);
  const seams = [];
  const ok = (x, z, len, yaw) => {
    for (const m of plan.mines) if (Math.hypot(m.pos.x - x, m.pos.z - z) < 10 + len / 2) return false;
    for (const q of plan.corals) if (Math.hypot(q.pos.x - x, q.pos.z - z) < 8 + len / 2) return false;
    for (const q of plan.neutrals) if (Math.hypot(q.pos.x - x, q.pos.z - z) < 12 + len / 2) return false;
    for (const o of plan.obstacles)
      if (Math.hypot(o.x - x, o.z - z) < (o.r || Math.hypot(o.w, o.d) / 2) + len / 2 + 1) return false;
    for (const d of seams) if (Math.hypot(d.x - x, d.z - z) < 5) return false;
    if (structH(all, x, z) > 0.02) return false;
    const ex = (Math.cos(yaw) * len) / 2,
      ez = (-Math.sin(yaw) * len) / 2;
    return Math.abs(th(x + ex, z + ez) - th(x - ex, z - ez)) < 0.4 && Math.hypot(x, z) > len;
  };
  for (const lane of plan.lanes) {
    let tot = 0;
    for (let k = 1; k < lane.length; k++)
      tot += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].z - lane[k - 1].z);
    for (let at = DR(5, 12); at < tot / 2; at += DR(9, 16)) {
      const q = laneAt(lane, at / tot);
      const sd = DR(-6, 6);
      const x = q.x - q.dz * sd,
        z = q.z + q.dx * sd;
      const drain = dr() < 0.3;
      const len = drain ? DR(3, 5) : DR(6, 12);
      const yaw = Math.atan2(-q.dz, q.dx) + (drain ? Math.PI / 2 : 0) + DR(-0.1, 0.1);
      if (!ok(x, z, len, yaw)) continue;
      const d = { model: drain ? 'drain' : 'seam', x, z, y: th(x, z) + 0.03, len, yaw };
      seams.push(d, { ...d, x: -x, z: -z, yaw: yaw + Math.PI });
    }
  }
  plan.decor = [...decor, ...seams];
  return '';
}

// ---------- R5 的附加地形（docs 16.8、16.14）：汙染水沒市街的淺水窪、多重水壩的壩體與河道 ----------
// 水深 > 0.3 m 的格子不能蓋（res＋1，同資源點的保留區；只影響 buildable）：World.buildRts 與 validate 共用
export function rtsReserveWater(nav, level, minDepth = 0.3) {
  let n = 0;
  for (let i = 0; i < nav.N; i++)
    if (level - nav.hgt[i] > minDepth) {
      nav.res[i] = Math.min(255, nav.res[i] + 1);
      n++;
    }
  return n;
}
const reserveWater = rtsReserveWater;
const POOL_BAND = 5; // 水窪邊緣的過渡（m）
export const rtsInPool = (plan, x, z) => (plan.pools || []).some((L) => lakeQ(L, x, z) < 1);
// 線段（2 m 一點）有沒有經過 test(x, z)
function laneHits(lane, test) {
  for (let k = 1; k < lane.length; k++) {
    const a = lane[k - 1],
      b = lane[k];
    const m = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 2));
    for (let s = 0; s <= m; s++)
      if (test(a.x + ((b.x - a.x) * s) / m, a.z + ((b.z - a.z) * s) / m)) return true;
  }
  return false;
}
// 汙染水沒市街：每半張圖 3～5 個橢圓的淺水窪（長軸 20～40 m、底部 −1.3～−1.6 m＝水深 0.9～1.2 m、5 m 的過渡帶）；
// 每條主要通道（A 側 8～45% 處）至少一個橫跨（長軸和通道垂直：涉水的捷徑，繞過去比較遠），其他放在通道旁當側翼；
// 離主基地與坡道 18 m、礦脈與湧出點 14 m、營地 10 m、中立建築 12 m；水窪裡的障礙物移除 → 整個重新檢查 →
// 每條重新算出的通道都經過水窪 → 半沉的街區（裝飾：路燈、車頂、號誌、漂浮雜物；另一條亂數串）
function poolsAfter(plan, c) {
  const r = c.rng;
  const R = (a, b) => a + (b - a) * r();
  const K = c.SZ; // 小地圖（R6）：水窪小一點、間距小一點、每半張圖至少 2 個
  const keep = [];
  for (const b of plan.highs) {
    keep.push(
      [b.pos, b.r + (b.kind === 'base' ? K(18, 10) : 6)],
      [b.ramp.bottom, K(18, 10)],
      [b.ramp.top, K(18, 10)],
    );
  }
  for (const m of plan.mines) keep.push([m.pos, K(14, 10)]);
  for (const q of plan.corals) keep.push([q.pos, K(14, 10)]);
  for (const q of plan.camps) keep.push([q.pos, K(10, 6)]);
  for (const q of plan.neutrals) keep.push([q.pos, K(12, 8)]);
  const pools = [];
  const fits = (L) => {
    const big = Math.max(L.rx, L.rz),
      small = Math.min(L.rx, L.rz);
    if (Math.hypot(L.x, L.z) < big + 8) return false; // 不碰到自己的鏡像
    for (const [p, rr] of keep) {
      const q = lakeQ(L, p.x, p.z);
      if (q < 1 || Math.hypot(p.x - L.x, p.z - L.z) * (1 - 1 / q) < rr + POOL_BAND) return false;
    }
    for (const o of pools)
      for (const sg of [1, -1])
        if (Math.hypot(L.x - sg * o.x, L.z - sg * o.z) < big + Math.max(o.rx, o.rz) + 10) return false;
    const sc = 1 + (POOL_BAND + 2) / small;
    const cs = Math.cos(L.rot),
      sn = Math.sin(L.rot);
    for (const k of [0, 0.55, sc])
      for (let a = 0; a < (k ? 16 : 1); a++) {
        const t = (a / 16) * Math.PI * 2,
          lx = Math.cos(t) * L.rx * k,
          lz = Math.sin(t) * L.rz * k;
        const p = { x: L.x + lx * cs - lz * sn, z: L.z + lx * sn + lz * cs };
        if (!c.inUse(p, 6) || c.high(p) > 0.05) return false;
      }
    return true;
  };
  const make = (x, z, rot, rMax) => {
    const rx = R(K(10, 7), rMax);
    return { x, z, rx, rz: rx * R(0.5, 0.8), rot, y: -R(1.3, 1.6) };
  };
  const onPool = (L) => (x, z) => lakeQ(L, x, z) < 1;
  // 橫跨通道的：每條通道一個（已經被前面的水窪跨過的通道略過）
  for (const lane of plan.lanes) {
    if (!lane || lane.length < 2) continue;
    if (pools.some((L) => laneHits(lane, onPool(L)) || laneHits(lane, onPool({ ...L, x: -L.x, z: -L.z }))))
      continue;
    let got = null;
    for (let t = 0; t < K(120, 360) && !got; t++) {
      const q = laneAt(lane, R(...K([0.08, 0.45], [0.12, 0.62])));
      if (!q) break;
      const side = R(-3, 3);
      const L = make(
        q.x - q.dz * side,
        q.z + q.dx * side,
        Math.atan2(q.dz, q.dx) + Math.PI / 2 + R(-0.3, 0.3),
        K(t < 50 ? 20 : t < 90 ? 14 : 11, t < 150 ? 12 : t < 270 ? 10 : 8),
      );
      if (fits(L)) got = L;
    }
    if (!got) return '水窪放不下';
    pools.push(got);
  }
  // 側翼的：補到 3～5 個
  const want = 3 + Math.floor(r() * 3);
  for (let t = 0; t < 120 && pools.length < want; t++) {
    const p = c.W(R(10, c.U1 + 40), R(-0.9, 0.9) * c.S);
    const L = make(p.x, p.z, R(0, Math.PI), K(20, 14));
    if (fits(L)) pools.push(L);
  }
  if (pools.length < K(3, 1)) return '水窪不足';
  const all = [];
  for (const L of pools) all.push(L, { ...L, x: -L.x, z: -L.z });
  // 高度：水窪底部，邊緣 POOL_BAND 公尺平滑過渡（k 與 N²−1−k 同值，維持對稱）
  const n = plan.n,
    h = plan.h,
    S = plan.size / 2,
    half = (n * n - 1) / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (k > half) continue;
      const x = i * RTS_CELL - S,
        z = j * RTS_CELL - S;
      let v = h[k];
      for (const L of all) {
        const e = L.rx + POOL_BAND + 1;
        if (Math.abs(x - L.x) > e || Math.abs(z - L.z) > e) continue;
        const q = lakeQ(L, x, z);
        const w = q <= 1 ? 1 : 1 - sm(((q - 1) * Math.min(L.rx, L.rz)) / POOL_BAND);
        if (w > 0) v = Math.min(v, h[k] + (L.y - h[k]) * w);
      }
      h[k] = v;
      h[n * n - 1 - k] = v;
    }
  plan.obstacles = plan.obstacles.filter((o) => {
    const or = o.r || Math.hypot(o.w || 0, o.d || 0) / 2;
    return all.every((L) => lakeQ(L, o.x, o.z) > 1 + (or + POOL_BAND + 1) / Math.min(L.rx, L.rz));
  });
  plan.pools = all.map((L) => ({ x: L.x, z: L.z, rx: L.rx, rz: L.rz, rot: L.rot, y: L.y }));
  if (!validate(plan).ok) return plan.fail;
  // 小地圖（R6）：至少一條通道經過水窪就好
  const hitN = plan.lanes.filter((lane) => laneHits(lane, (x, z) => rtsInPool(plan, x, z))).length;
  if (hitN < K(plan.lanes.length, 1)) return '水窪不在通道上';
  // 半沉的街區（不碰撞，和障礙物一起合併）：每個水窪 1～3 個，水窪的內側 60%
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  const DR = (a, b) => a + (b - a) * dr();
  const KINDS = ['poolcar', 'poollamp', 'poolsign', 'pooljunk'];
  const decor = [];
  for (const L of pools) {
    const cnt = 1 + Math.floor(dr() * 3);
    const cs = Math.cos(L.rot),
      sn = Math.sin(L.rot);
    for (let k = 0, t = 0; k < cnt && t < 12; t++) {
      const a = DR(0, Math.PI * 2),
        f = DR(0, 0.6);
      const lx = Math.cos(a) * L.rx * f,
        lz = Math.sin(a) * L.rz * f;
      const x = L.x + lx * cs - lz * sn,
        z = L.z + lx * sn + lz * cs;
      if (decor.some((d) => Math.hypot(d.x - x, d.z - z) < 4)) continue;
      const model = KINDS[Math.floor(dr() * KINDS.length)];
      const y = model === 'pooljunk' ? RTS_WATER_Y - 0.05 : L.y;
      const d = {
        model,
        x,
        z,
        y,
        yaw: DR(0, Math.PI * 2),
        tilt: DR(-0.25, 0.25),
        color: Math.floor(dr() * 3),
      };
      decor.push(d, { ...d, x: -x, z: -z, yaw: d.yaw + Math.PI });
      k++;
    }
  }
  plan.decor = decor;
  return '';
}

// 多重水壩：通過地圖中心、和兩邊主基地的連線垂直的壩體高地（寬 18～22 m、高 7～9 m、頂面平、兩端接到邊緣的斷崖；
// 中央是放酒館的圓形平台），兩組坡道（每組在壩的兩側各一條，沿著壩、寬 12～14 m、坡度 STRUCT_SLOPE，在離中心
// ±(30～45)% 處、兩組互為 180° 的鏡像），壩腳兩側各一條淺水河道（寬 10～14 m、水深 0.8 m）：坡道的下端落在河道裡
// （涉水的關口）。在其他特徵與點位之前（genOnce 的 PRE）：壩體與坡道是半張圖特徵（feats，點位與障礙物自動避開）、
// 河道改低地的高度（PRE.low）、河道外的範圍不能放東西（PRE.block）、中立建築與外圍分礦的範圍（PRE.range）。
// 自己的亂數串 makeRng(sub × 67 ＋ 31)
const DAM_RIVER_Y = -1.2; // 河床（水面 −0.4：水深 0.8 m）
function damPre(c, sub) {
  const r = makeRng((sub * 67 + 31) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const { W, L, S, feats } = c;
  const small = S !== 200; // 小地圖（R6）：壩體、坡道、河道窄一點，點位的範圍改小
  const o = W(1, 0),
    ax = o.x,
    az = o.z;
  const hw = small ? R(7.5, 9) : R(9, 11),
    H = small ? R(6, 7) : R(7, 9),
    cw = 2.5,
    rw = small ? R(11, 12) : R(12, 14),
    rwid = small ? R(8, 10) : R(10, 14),
    plaza = small ? R(19, 20) : R(20, 22);
  const len = H / STRUCT_SLOPE;
  const vEnd = (S - EDGE) / Math.max(Math.abs(ax), Math.abs(az));
  const v1 = R(0.3, 0.45) * vEnd;
  const d = r() < 0.5 ? 1 : -1; // +v1 那一組往 +v（離中心）或 −v 下坡
  const big = S * 3;
  feats.push({
    bb: [-big, big, -big, big],
    H,
    f(x, z) {
      const u = Math.abs(x * ax + z * az);
      const t = sm((hw + cw - u) / cw);
      if (t >= 1) return 1;
      return Math.max(t, sm((plaza + cw - Math.hypot(x, z)) / cw));
    },
  });
  // 坡道：側 s（壩的哪一側，u 的正負）、上端 vt、下坡方向 dd（沿 v）；內側和壩頂重疊 1 m；上端先有 LAND 公尺的平台
  // （和壩頂同高，接口才夠寬：大型單位上得去）
  // 坡面在壩的斷崖外側（u＝hw＋cw 起、寬 rw）；上端的平台往內延伸到壩頂（hw − 1），往下 6 m 內漸漸收回斷崖外
  const uc = hw + cw + rw / 2 - 0.5,
    LAND = 10;
  const ramps = [];
  for (const g of [1, -1])
    for (const s of [1, -1]) {
      const vt = g * v1,
        dd = g * d;
      const cs = [
        W(s * (hw - 4), vt - dd * (LAND + 3)),
        W(s * (hw + cw + rw + 3), vt - dd * (LAND + 3)),
        W(s * (hw - 4), vt + dd * (len + 1)),
        W(s * (hw + cw + rw + 3), vt + dd * (len + 1)),
      ];
      const bb = [
        Math.min(...cs.map((p) => p.x)),
        Math.max(...cs.map((p) => p.x)),
        Math.min(...cs.map((p) => p.z)),
        Math.max(...cs.map((p) => p.z)),
      ];
      feats.push({
        bb,
        H,
        f(x, z) {
          const [u, v] = L({ x, z });
          const al = (v - vt) * dd,
            su = s * u;
          if (al < -LAND - 2 || al > len) return 0;
          const ui = hw - 1 + clamp(al / 6, 0, 1) * (cw + 0.5),
            uo = hw + cw + rw - 0.5;
          const lm = Math.min(clamp((su - ui + 2) / 2, 0, 1), clamp((uo + 2 - su) / 2, 0, 1));
          return lm > 0 ? (1 - clamp(al / len, 0, 1)) * lm : 0;
        },
      });
      ramps.push({
        g,
        side: s,
        vt,
        dd,
        top: W(s * uc, vt),
        bottom: W(s * uc, vt + dd * len),
        w: rw,
        len,
        land: LAND,
      });
    }
  const Zb = hw + cw + Math.max(rwid, rw) + 3;
  const rc = hw + cw + rwid / 2,
    rh = rwid / 2;
  return {
    block: (p, m) => Math.abs(p.x * ax + p.z * az) < Zb + m,
    low(x, z, lo) {
      const u = Math.abs(x * ax + z * az);
      const w = sm((rh + 2 - Math.abs(u - rc)) / 2);
      return w > 0 ? lo + (DAM_RIVER_Y - lo) * w : lo;
    },
    // 小地圖：商店與傭兵營在壩體和山脊之間（依山脊的位置），中立的 Coral 也可以在山脊後面
    range: small
      ? {
          outer: (U1) => [Zb + 10, U1 - 12],
          // 壩體和山脊之間放不下時改放山脊後面（成對，各自靠近一邊的主基地）
          shop: (U1) =>
            U1 - Zb >= 28
              ? [
                  [Zb + 8, U1 - 11],
                  [10, 104],
                ]
              : [
                  [U1 + 12, U1 + 40],
                  [30, 108],
                ],
          merc: (U1) =>
            U1 - Zb >= 28
              ? [
                  [Zb + 8, U1 - 11],
                  [16, 108],
                ]
              : [
                  [U1 + 12, U1 + 44],
                  [30, 108],
                ],
          coral: (U1) => [
            [Zb + 8, U1 + 40],
            [24, 108],
          ],
          // 上面的範圍放不下時：山脊後面（R6 之後的 C 包）
          back: (U1) => [
            [U1 + 12, U1 + 44],
            [24, 110],
          ],
        }
      : {
          outer: (U1) => [Zb + 12, U1 - 14],
          shop: [
            [Zb + 9, Zb + 30],
            [10, 90],
          ],
          merc: [
            [Zb + 9, Zb + 34],
            [30, 120],
          ],
          coral: [
            [Zb + 10, Zb + 44],
            [50, 140],
          ],
        },
    plan: {
      hw,
      h: H,
      cw,
      plaza,
      v1,
      vEnd,
      zone: Zb,
      river: { u0: hw + cw, w: rwid, y: DAM_RIVER_Y },
      ramps: ramps.map((q) => ({
        top: q.top,
        bottom: q.bottom,
        w: q.w,
        len: q.len,
        land: q.land,
        side: q.side,
        vt: q.vt,
        dd: q.dd,
      })),
      // 兩組坡道上去的壩頂（validate 的要點）
      tops: [W(0, v1 - d * 4), W(0, -(v1 - d * 4))],
    },
  };
}
// 多重水壩（檢查之後）：坡道以外沒有路（四條坡道堵住後兩邊主基地不通）、每條通道都經過壩頂 →
// 裝飾（另一條亂數串）：壩體兩側的混凝土壩面（主題的 wall 外觀，坡道接上的地方留空）、中央平台的壩面、壩頂的護欄與燈
function damAfter(plan, c) {
  const D = plan.dam,
    nav = plan.nav;
  const ax = Math.cos(plan.axis),
    az = Math.sin(plan.axis);
  const uOf = (x, z) => x * ax + z * az;
  const Wp = (u, v) => P(u * ax - v * az, u * az + v * ax);
  const [bA, bB] = plan.bases;
  const fyaw = (dd) => Math.atan2(-az * dd, ax * dd); // 沿 +v（×dd）的朝向（nav.block 的 yaw：前方＝(sin, cos)）
  for (const q of D.ramps)
    nav.block((q.top.x + q.bottom.x) / 2, (q.top.z + q.bottom.z) / 2, q.w + 8, q.len + 6, fyaw(q.dd), true);
  const sealed = !nav.reachable(bA.pos, bB.pos, 0);
  for (const q of D.ramps)
    nav.block((q.top.x + q.bottom.x) / 2, (q.top.z + q.bottom.z) / 2, q.w + 8, q.len + 6, fyaw(q.dd), false);
  if (!sealed) return '壩體有坡道以外的路';
  const hAt = heightSampler(plan.h, plan.n, plan.size);
  for (const lane of plan.lanes)
    if (!laneHits(lane, (x, z) => Math.abs(uOf(x, z)) < D.hw - 1 && hAt(x, z) > D.h - 1))
      return '通道沒有經過壩頂';
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  const decor = [];
  const SEG = 8;
  const wallYaw = Math.atan2(-ax, -az); // 本地 X 沿 +v
  const yb = DAM_RIVER_Y - 0.4,
    yt = D.h + 0.3;
  const onRamp = (s, v, m) =>
    D.ramps.some((q) => {
      if (q.side !== s) return false;
      const a = q.vt - q.dd * (q.land + m),
        b = q.vt + q.dd * (q.len + m);
      return v > Math.min(a, b) && v < Math.max(a, b);
    });
  // A 半（v > 0）兩側都放，轉 180° 複製到 v < 0
  for (let v = SEG / 2; v < D.vEnd - 2; v += SEG) {
    if (v < D.plaza + D.cw + 2) continue;
    for (const s of [1, -1]) {
      if (!onRamp(s, v, 3)) {
        const p = Wp(s * (D.hw + D.cw * 0.55), v);
        decor.push({
          model: 'damwall',
          x: p.x,
          z: p.z,
          y: (yb + yt) / 2,
          len: SEG + 0.05,
          h: yt - yb,
          yaw: wallYaw,
        });
        const q = Wp(s * (D.hw - 0.35), v);
        decor.push({ model: 'damrail', x: q.x, z: q.z, y: hAt(q.x, q.z), len: SEG - 0.3, yaw: wallYaw });
      }
    }
  }
  // 中央平台的壩面（圓周上、壩體以外的部分，每段約 6 m）：角度 0～π，轉 180° 複製
  const pr = D.plaza + D.cw * 0.55;
  const nA = Math.round((Math.PI * pr) / 6);
  for (let k = 0; k < nA; k++) {
    const a = ((k + 0.5) / nA) * Math.PI;
    const ul = Math.cos(a) * pr,
      vl = Math.sin(a) * pr;
    if (Math.abs(ul) < D.hw + D.cw) continue;
    const p = Wp(ul, vl);
    // 切線方向（世界）：d/da (ul, vl) = (−sin a, cos a) → 世界向量
    const tx = -Math.sin(a) * ax - Math.cos(a) * az,
      tz = -Math.sin(a) * az + Math.cos(a) * ax;
    decor.push({
      model: 'damwall',
      x: p.x,
      z: p.z,
      y: (yb + yt) / 2,
      len: (Math.PI * pr) / nA + 0.3,
      h: yt - yb,
      yaw: Math.atan2(-tz, tx),
    });
  }
  // 壩頂的燈（不碰撞）：每 30～40 m，兩側交錯
  let side = dr() < 0.5 ? 1 : -1;
  for (let v = D.plaza + 8 + dr() * 10; v < D.vEnd - 6; v += 30 + dr() * 10) {
    side = -side;
    if (onRamp(side, v, 2)) continue;
    const p = Wp(side * (D.hw - 1.2), v);
    decor.push({ model: 'damlamp', x: p.x, z: p.z, y: hAt(p.x, p.z), h: 7, yaw: wallYaw });
  }
  const n0 = decor.length;
  for (let k = 0; k < n0; k++) {
    const d = decor[k];
    decor.push({ ...d, x: -d.x, z: -d.z, yaw: d.yaw + Math.PI });
  }
  plan.decor = decor;
  return '';
}

// ---------- R6 的附加地形（docs 17.4；C 包）：沙丘的新月沙丘、礦坑地表的露天礦坑、貨運集散場的貨櫃堆與龍門起重機 ----------
// 結構用自己的亂數串 makeRng(sub × 71 ＋ 37)（R5 的 pre 是 × 67 ＋ 31），裝飾 makeRng(sub × 61 ＋ 29)；
// 數量在小地圖 ×0.6（無條件進位、至少 1）；改了地形後整個重新 validate。
const r6Count = (c, n) => c.SZ(n, Math.max(1, Math.ceil(n * 0.6)));
// 不能靠近的點（[點, 半徑]）：主基地平台與坡道 18 m、礦脈與湧出點 14、營地 10、中立建築 12（17.4）
// 小地圖（small）：主基地與坡道 12、資源 10、營地 8、中立建築 10
function r6Keep(plan, small) {
  const keep = [];
  const kb = small ? 12 : 18;
  for (const b of plan.highs) {
    const base = b.kind === 'base';
    keep.push(
      { p: b.pos, r: b.r + (base ? kb : 6) },
      { p: b.ramp.bottom, r: kb },
      { p: b.ramp.top, r: base ? kb : 10 },
    );
  }
  for (const m of plan.mines) keep.push({ p: m.pos, r: small ? 10 : 14 });
  for (const q of plan.corals) keep.push({ p: q.pos, r: small ? 10 : 14 });
  for (const q of plan.camps) keep.push({ p: q.pos, r: small ? 8 : 10 });
  for (const q of plan.neutrals) keep.push({ p: q.pos, r: small ? 10 : 12 });
  return keep;
}
// 點到軸對齊方塊（中心 x, z、寬 w、深 d）的距離；方塊與方塊的間隙
const boxDist = (px, pz, b) =>
  Math.hypot(Math.max(Math.abs(px - b.x) - b.w / 2, 0), Math.max(Math.abs(pz - b.z) - b.d / 2, 0));
const boxGap = (a, b) =>
  Math.hypot(
    Math.max(Math.abs(a.x - b.x) - (a.w + b.w) / 2, 0),
    Math.max(Math.abs(a.z - b.z) - (a.d + b.d) / 2, 0),
  );
// 障礙物外形到點的距離（圓柱或軸對齊方塊）
const obDist = (o, x, z) => (o.kind === 'box' ? boxDist(x, z, o) : Math.hypot(o.x - x, o.z - z) - (o.r || 0));

// ----- 沙丘：新月形沙丘（長軸 rot 方向、兩角往 +v 彎 bow；迎風面（−v）坡度 0.4、背風面 0.55） -----
const DUNE_WIND = 0.4,
  DUNE_LEE = 0.55;
function duneStruct(cx, cz, len, h, rot, bow) {
  const cs = Math.cos(rot),
    sn = Math.sin(rot),
    L2 = len / 2;
  // 截面是 (1＋cos)/2：最大坡度 h·π／(2·半寬)
  const hwW = (h * Math.PI) / (2 * DUNE_WIND),
    hwL = (h * Math.PI) / (2 * DUNE_LEE);
  const loc = (x, z) => {
    const dx = x - cx,
      dz = z - cz;
    return [dx * cs + dz * sn, -dx * sn + dz * cs];
  };
  const v0 = (u) => bow * (u / L2) ** 2;
  const ext = L2 + Math.max(hwW, hwL) + Math.abs(bow) + 1;
  const s = {
    x: cx,
    z: cz,
    len,
    h,
    rot,
    bow,
    hwW,
    hwL,
    bb: [cx - ext, cx + ext, cz - ext, cz + ext],
    toW: (u, v) => P(cx + u * cs - v * sn, cz + u * sn + v * cs),
    F(x, z) {
      const [u, v] = loc(x, z);
      if (Math.abs(u) >= L2) return 0;
      const dv = v - v0(u);
      const a = Math.abs(dv) / (dv < 0 ? hwW : hwL);
      if (a >= 1) return 0;
      return h * Math.cos(((u / L2) * Math.PI) / 2) ** 2 * 0.5 * (1 + Math.cos(Math.PI * a));
    },
    near(x, z, m) {
      const [u, v] = loc(x, z);
      if (Math.abs(u) > L2 + m) return false;
      const dv = v - v0(clamp(u, -L2, L2));
      return dv > -hwW - m && dv < hwL + m;
    },
    samples(m) {
      const out = [P(cx, cz)];
      for (let k = 0; k <= 8; k++) {
        const u = -L2 + (k * len) / 8;
        out.push(s.toW(u, v0(u) - hwW - m), s.toW(u, v0(u) + hwL + m), s.toW(u, v0(u)));
      }
      return out;
    },
  };
  return s;
}
// 沙丘的外觀（world.js 的 RTS 地形著色用；R6 之後的 C 包）：plan.dunes 重建形狀 → (x, z) 的
// { a：沙丘高度的比例 0～1（0＝不在沙丘上）, lee：在背風面（+v）, crest：離脊線多近 0～1 }；沒有沙丘時 null
export function rtsDuneShade(plan) {
  const ds = (plan && plan.dunes) || [];
  if (!ds.length) return null;
  const all = ds.map((d) => duneStruct(d.x, d.z, d.len, d.h, d.rot, d.bow));
  return (x, z) => {
    let best = null,
      bh = 0;
    for (const s of all) {
      if (x < s.bb[0] || x > s.bb[1] || z < s.bb[2] || z > s.bb[3]) continue;
      const v = s.F(x, z);
      if (v > bh) ((bh = v), (best = s));
    }
    if (!best) return { a: 0, lee: false, crest: 0 };
    const dx = x - best.x,
      dz = z - best.z,
      cs = Math.cos(best.rot),
      sn = Math.sin(best.rot);
    const u = dx * cs + dz * sn,
      v = -dx * sn + dz * cs;
    const dv = v - best.bow * (u / (best.len / 2)) ** 2;
    return { a: bh / best.h, lee: dv > 0, crest: clamp(1 - Math.abs(dv) / 2.5, 0, 1) * (bh / best.h) };
  };
}
// 高度圖加上結構（沙丘：疊在原本的地面上；k 與 N²−1−k 同值，維持對稱）
function stampAdd(plan, all) {
  const n = plan.n,
    h = plan.h,
    S = plan.size / 2,
    half = (n * n - 1) / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      if (k > half) continue;
      const v = structH(all, i * RTS_CELL - S, j * RTS_CELL - S);
      if (v <= 0) continue;
      h[k] += v;
      h[n * n - 1 - k] = h[k];
    }
}
// 沙丘地帶：每半張圖 4～6 道新月沙丘（一半貼著通道旁、長軸順著通道；其他在中立區），不橫越通道的中線（通道 6 m 內
// 不放）→ 疊進高度圖（沙丘頂比旁邊高 2.6～3.5 m：低處的視線被擋住）、蓋到的障礙物移除 → 拱形殘骸（只有兩支腳碰撞）→
// 整個重新檢查 → 迎風面的防沙柵欄（裝飾）
function dunesAfter(plan, c) {
  const r = makeRng((c.sub * 71 + 37) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const small = c.size !== 400;
  const keep = r6Keep(plan, small);
  const dots = laneDots(plan);
  const want = r6Count(c, 4 + Math.floor(r() * 3));
  const dunes = [];
  const mirrorOf = (d) => duneStruct(-d.x, -d.z, d.len, d.h, d.rot + Math.PI, d.bow);
  const fits = (d) => {
    if (Math.hypot(d.x, d.z) < d.len / 2 + Math.max(d.hwW, d.hwL) + 6) return false; // 不碰到自己的鏡像
    const out = d.samples(0);
    for (const p of out) if (!c.inUse(p, 6) || c.high(p) > 0.05) return false;
    for (const k of keep) if (d.near(k.p.x, k.p.z, k.r)) return false;
    for (const q of dots) if (d.near(q.x, q.z, 6)) return false;
    for (const o of dunes)
      for (const p of d.samples(6)) if (o.near(p.x, p.z, 0) || o.near(-p.x, -p.z, 0)) return false;
    return true;
  };
  for (let t = 0; t < 400 && dunes.length < want; t++) {
    const h = small ? R(2.8, 3.1) : R(2.9, 3.5), // 高 2.5 m 以上擋住低處的視線（地面有起伏：留一點餘裕）
      len = small ? R(18, 26) : R(24, 35),
      bow = R(3, 6) * (r() < 0.5 ? 1 : -1);
    let d;
    if (t % 2 === 0) {
      // 通道旁：長軸順著通道，離中線 6 m 以外
      const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
      if (!lane || lane.length < 2) return '通道不足';
      const q = laneAt(lane, R(0.12, 0.55));
      const side = r() < 0.5 ? 1 : -1;
      const rot = Math.atan2(q.dz, q.dx) + R(-0.25, 0.25);
      const off = small ? R(12, 18) : R(14, 24);
      d = duneStruct(q.x - q.dz * side * off, q.z + q.dx * side * off, len, h, rot, bow);
    } else {
      const p = c.W(R(5, c.U1 + 30), R(-0.9, 0.9) * c.S);
      d = duneStruct(p.x, p.z, len, h, R(0, Math.PI), bow);
    }
    if (fits(d)) dunes.push(d);
  }
  if (dunes.length < c.SZ(4, 2)) return '沙丘放不下';
  const all = [];
  for (const d of dunes) all.push(d, mirrorOf(d));
  stampAdd(plan, all);
  clearUnder(plan, all);
  plan.dunes = all.map((d) => ({
    x: d.x,
    z: d.z,
    len: d.len,
    w: d.hwW + d.hwL,
    ww: d.hwW, // 迎風面（−v）的半寬
    h: d.h,
    rot: d.rot,
    bow: d.bow,
  }));
  // 拱形殘骸（每半張圖 1 座，放不下就不放）：兩支腳是圓柱障礙物（模型是裝飾），從下面可以過
  const hAt = heightSampler(plan.h, plan.n, plan.size);
  const decor = [];
  const SPAN = 9;
  for (let t = 0; t < 120; t++) {
    const p = c.W(R(10, c.U1 + 20), R(-0.85, 0.85) * c.S);
    const yaw = R(0, Math.PI);
    const fx = Math.cos(yaw) * SPAN,
      fz = -Math.sin(yaw) * SPAN;
    const feet = [P(p.x + fx, p.z + fz), P(p.x - fx, p.z - fz)];
    if (Math.hypot(p.x, p.z) < SPAN + 14) continue;
    let ok = true;
    for (const f of [...feet, p]) {
      if (!c.inUse(f, 6) || c.high(f) > 0.05 || structH(all, f.x, f.z) > 0.05) ok = false;
      for (const k of keep) if (dist(f, k.p) < k.r) ok = false;
      for (const o of plan.obstacles) if (obDist(o, f.x, f.z) < 4) ok = false;
    }
    if (!ok || Math.abs(hAt(feet[0].x, feet[0].z) - hAt(feet[1].x, feet[1].z)) > 0.6) continue;
    const gy = (hAt(feet[0].x, feet[0].z) + hAt(feet[1].x, feet[1].z)) / 2;
    for (const f of feet) {
      const o = {
        model: 'archfoot',
        kind: 'circle',
        x: f.x,
        z: f.z,
        r: 1.7,
        h: 9.5,
        y: gy - 0.2,
        top: gy + 9.3,
        yaw: 0,
      };
      plan.obstacles.push(o, { ...o, x: -f.x, z: -f.z });
    }
    const col = Math.floor(r() * 3);
    decor.push({ model: 'wreckarch', x: p.x, z: p.z, y: gy - 0.3, yaw, color: col });
    plan.arches = [
      { x: p.x, z: p.z, yaw, span: SPAN * 2 },
      { x: -p.x, z: -p.z, yaw: yaw + Math.PI, span: SPAN * 2 },
    ];
    break;
  }
  if (!validate(plan).ok) return plan.fail;
  // 防沙柵欄（裝飾，不碰撞）：每道沙丘 1～2 段，沿迎風面（−v 側）的坡腳
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  for (const d of dunes) {
    const nf = 1 + Math.floor(dr() * 2);
    for (let k = 0; k < nf; k++) {
      const u = (dr() - 0.5) * d.len * 0.6;
      const v = d.bow * (u / (d.len / 2)) ** 2 - d.hwW - 1.5;
      const q = d.toW(u, v);
      // 切線（沿本地 u 加上彎曲）：沿本地 X 的柵欄轉到切線方向
      const du = 1,
        dv = (2 * d.bow * u) / (d.len / 2) ** 2;
      const tx = Math.cos(d.rot) * du - Math.sin(d.rot) * dv,
        tz = Math.sin(d.rot) * du + Math.cos(d.rot) * dv;
      const len = 6 + dr() * 3;
      decor.push({
        model: 'sandfence',
        x: q.x,
        z: q.z,
        y: hAt(q.x, q.z) - 0.6,
        len,
        yaw: Math.atan2(-tz, tx),
      });
    }
  }
  const n0 = decor.length;
  for (let k = 0; k < n0; k++) {
    const q = decor[k];
    decor.push({ ...q, x: -q.x, z: -q.z, yaw: q.yaw + Math.PI });
  }
  plan.decor = decor;
  return '';
}

// ----- 礦坑地表：中央的露天礦坑（前置地形：在點位與障礙物之前，同多重水壩的 PRE） -----
// 階梯狀的凹坑（半徑 26～32 m、2～3 階、坑底 −6～−8 m、斷崖 2 m）＋兩條互為 180° 的徑向坡道（寬 12～14、坡度
// STRUCT_SLOPE：坑外的一段是切進地面的溝），所以本身點對稱。坑底正中央是富礦（rich）與固定的 tier 3 營地；
// 酒館移到坑的邊緣（和主軸垂直的兩個位置之一：validate 挑兩邊主基地路徑差較小的）。
// 低地的高度改成 PRE.low（坑裡的起伏壓小），坑與周圍不能放點位（PRE.block），中立建築與外圍分礦的範圍 PRE.range。
const PIT_CW = 2;
function pitPre(c, sub) {
  const r = makeRng((sub * 71 + 37) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const { W, S } = c;
  const small = S < 200;
  const Rp = small ? R(15, 17) : R(26, 32);
  const N = r() < 0.5 ? 2 : 3;
  const D = small ? R(5.5, 6.5) : R(6, 8);
  const Rf = small ? R(7, 8) : R(11, 13.5);
  const slope = small ? 0.5 : STRUCT_SLOPE; // 小地圖：坑小一點、坡道陡一點（NAV_SLOPE 0.6 以下）
  const ph = R(0, 6.28);
  const o = W(1, 0);
  const th = Math.atan2(o.z, o.x);
  const a0 = th + R(0.3, 0.8) * (r() < 0.5 ? 1 : -1);
  const rw = R(12, 14);
  const r0 = Math.max(Rp - 2, Rf + D / slope);
  // 各階斷崖的頂（由外往內）：最後一階落到坑底（Rf）
  const tops = [];
  for (let i = 0; i < N; i++) tops.push(Rp - (i * (Rp - (Rf + PIT_CW))) / (N - 1));
  const d = D / N;
  const Zp = Math.max(Rp, r0) + 6;
  const side = r() < 0.5 ? 1 : -1;
  const tavern = W(0, side * (Zp + 8));
  const rMax = Math.max(Rp, r0) + 4;
  const vCap = S - EDGE - 8 - 18; // 點位 v 的上限（inUse 的邊界內）
  const ramps = [a0, a0 + Math.PI].map((a) => ({
    ang: a,
    w: rw,
    top: P(Math.cos(a) * r0, Math.sin(a) * r0),
    bottom: P(Math.cos(a) * Rf, Math.sin(a) * Rf),
  }));
  return {
    key: 'pit',
    clear: Zp,
    tavern,
    pitMine: 8000,
    block: (p, m) => Math.hypot(p.x, p.z) < Zp + m,
    low(x, z, lo) {
      const rad = Math.hypot(x, z);
      if (rad > rMax) return lo;
      const a = Math.atan2(z, x);
      const rr = rad / (1 + 0.04 * Math.sin(2 * a + ph)); // 輪廓的起伏（週期 π：點對稱）
      let off = 0;
      for (const t of tops) off -= d * sm((t - rr) / PIT_CW);
      for (const q of ramps) {
        const cs = Math.cos(q.ang),
          sn = Math.sin(q.ang);
        const al = x * cs + z * sn;
        if (al < Rf - 4 || al > r0 + 2) continue;
        const lat = Math.abs(-x * sn + z * cs);
        const lm = clamp((rw / 2 + 2 - lat) / 2, 0, 1);
        if (lm <= 0) continue;
        const ro = -D * clamp((r0 - al) / (r0 - Rf), 0, 1);
        off += (ro - off) * lm;
      }
      const w = sm((Rp + 2 - rad) / 4);
      return lo * (1 - 0.7 * w) + off;
    },
    range: {
      outer: (U1) => [12, U1 - 22],
      // 酒館在坑緣的一圈（Zp＋8）：商店、傭兵營、中立的 Coral 在它外側
      shop: [
        [-24, 24],
        [Zp + 30, Math.min(Zp + 64, vCap)],
      ],
      merc: [
        [-56, 56],
        [Zp + 30, Math.min(Zp + 72, vCap)],
      ],
      coral: [
        [-50, 50],
        [Zp + 30, Math.min(Zp + 90, vCap)],
      ],
    },
    plan: { r: Rp, rf: Rf, depth: D, tiers: N, tops, ph, zone: Zp, r0, ramps },
  };
}
// 礦坑地表（檢查之後）：坑底到得了（validate 的要點 'pit'）→ 裝飾（另一條亂數串）：階地上的礦車軌道與廢棄的礦車
function pitAfter(plan, c) {
  const D = plan.pit;
  const hAt = heightSampler(plan.h, plan.n, plan.size);
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  const decor = [];
  const ringR = (a, rm) => rm * (1 + 0.04 * Math.sin(2 * a + D.ph));
  // 每一階的平台中線（坑底除外）；坡道兩側 0.6 rad 內不放
  const rings = [];
  for (let i = 0; i + 1 < D.tops.length; i++) rings.push((D.tops[i] - PIT_CW + D.tops[i + 1]) / 2);
  rings.push(Math.max(4, D.rf - 4)); // 坑底的一圈
  const a0 = D.ramps[0].ang;
  for (const rm of rings) {
    const seg = 5;
    for (let a = a0 + 0.6; a < a0 + Math.PI - 0.6; a += seg / rm) {
      const rr = ringR(a, rm);
      const x = Math.cos(a) * rr,
        z = Math.sin(a) * rr;
      decor.push({ model: 'minerail', x, z, y: hAt(x, z) + 0.02, len: seg + 0.1, yaw: -a });
      if (dr() < 0.12)
        decor.push({ model: 'minecart', x, z, y: hAt(x, z) + 0.15, yaw: -a, color: Math.floor(dr() * 3) });
    }
  }
  const n0 = decor.length;
  for (let k = 0; k < n0; k++) {
    const q = decor[k];
    decor.push({ ...q, x: -q.x, z: -q.z, yaw: q.yaw + Math.PI });
  }
  plan.decor = decor;
  return '';
}

// ----- 貨運集散場：龍門起重機（每半張圖 1 座跨在通道上，只有四支腳碰撞）與貨櫃堆（每半張圖 5～8 組，排成巷道） -----
const CTR_L = 12,
  CTR_H = 2.6;
function yardAfter(plan, c) {
  const r = makeRng((c.sub * 71 + 37) >>> 0);
  const R = (a, b) => a + (b - a) * r();
  const small = c.size !== 400;
  const keep = r6Keep(plan, small);
  const dots = laneDots(plan);
  const hAt = heightSampler(plan.h, plan.n, plan.size);
  const decor = [];
  // 龍門起重機：通道 A 側 20～60% 處，腳在通道兩側 ±span/2（橫樑 14 m 高，從下面過）、沿通道 ±3.5
  let gan = null;
  for (let t = 0; t < 200 && !gan; t++) {
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) return '通道不足';
    const q = laneAt(lane, R(0.2, 0.6));
    const span = R(18, 22);
    if (Math.hypot(q.x, q.z) < span + 10) continue;
    const px = -q.dz,
      pz = q.dx;
    const legs = [];
    for (const s of [-1, 1])
      for (const a of [-3.5, 3.5])
        legs.push(P(q.x + px * s * (span / 2) + q.dx * a, q.z + pz * s * (span / 2) + q.dz * a));
    let ok = true;
    const gs = legs.map((p) => hAt(p.x, p.z));
    if (Math.max(...gs) - Math.min(...gs) > 0.8) continue;
    for (const p of legs) {
      if (!c.inUse(p, 6) || c.high(p) > 0.05) ok = false;
      for (const k of keep) if (dist(p, k.p) < k.r - 4) ok = false;
      for (const o of plan.obstacles) if (obDist(o, p.x, p.z) < 2.5) ok = false;
    }
    if (ok)
      gan = {
        x: q.x,
        z: q.z,
        span,
        legs,
        gy: Math.min(...gs),
        yaw: Math.atan2(-q.dx, -q.dz),
        dx: q.dx,
        dz: q.dz,
      };
  }
  if (!gan) return '龍門起重機放不下';
  const GH = 14;
  for (const p of gan.legs) {
    const o = { model: 'gantryleg', kind: 'circle', x: p.x, z: p.z, r: 0.8, h: GH + 1.5, y: gan.gy - 0.1 };
    o.top = o.y + o.h;
    plan.obstacles.push(o, { ...o, x: -p.x, z: -p.z });
  }
  decor.push({ model: 'gantry', x: gan.x, z: gan.z, y: gan.gy - 0.1, yaw: gan.yaw, span: gan.span, h: GH });
  plan.gantries = [
    { x: gan.x, z: gan.z, yaw: gan.yaw, span: gan.span, h: GH },
    { x: -gan.x, z: -gan.z, yaw: gan.yaw + Math.PI, span: gan.span, h: GH },
  ];
  // 起重機底下（腳的外框＋4 m）不放貨櫃堆
  const ganBox = (g) => {
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (const p of g.legs) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    return { x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: x1 - x0 + 8, d: z1 - z0 + 8 };
  };
  const gb = ganBox(gan);
  const gbs = [gb, { ...gb, x: -gb.x, z: -gb.z }];
  // 貨櫃堆：1～3 列（沿短邊並排）、每列 1～3 層，合計 2～6 個；方塊碰撞＝外框（90° 為單位）
  const want = r6Count(c, 5 + Math.floor(r() * 4));
  const stacks = [];
  for (let t = 0; t < 700 && stacks.length < want; t++) {
    const cols = 1 + Math.floor(r() * 3);
    const lay = [];
    for (let i = 0; i < cols; i++) lay.push(1 + Math.floor(r() * 3));
    while (lay.reduce((a, b) => a + b, 0) > 6) lay[lay.indexOf(Math.max(...lay))]--;
    if (lay.reduce((a, b) => a + b, 0) < 2) lay[0] = 2;
    const q4 = Math.floor(r() * 4);
    const d0 = CTR_H * cols;
    const [w, d] = q4 & 1 ? [d0, CTR_L] : [CTR_L, d0];
    let p;
    if (t % 3 !== 2) {
      const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
      const q = laneAt(lane, R(0.08, 0.55));
      const side = r() < 0.5 ? 1 : -1;
      const off = 6 + Math.max(w, d) / 2 + R(1, 9);
      p = P(q.x - q.dz * side * off, q.z + q.dx * side * off);
    } else p = c.W(R(5, c.U1 + 25), R(-0.9, 0.9) * c.S);
    const b = { x: p.x, z: p.z, w, d };
    const cs = [
      P(p.x - w / 2, p.z - d / 2),
      P(p.x + w / 2, p.z - d / 2),
      P(p.x - w / 2, p.z + d / 2),
      P(p.x + w / 2, p.z + d / 2),
    ];
    let ok = Math.hypot(p.x, p.z) > Math.hypot(w, d) / 2 + 3; // 和自己的鏡像隔 5 m 以上
    for (const q of [p, ...cs]) if (!c.inUse(q, 4) || c.high(q) > 0.05) ok = false;
    if (!ok) continue;
    const gs = cs.map((q) => hAt(q.x, q.z));
    if (Math.max(...gs) - Math.min(...gs) > 1) continue;
    if (dots.some((q) => boxDist(q.x, q.z, b) < 6)) continue;
    if (keep.some((k) => boxDist(k.p.x, k.p.z, b) < k.r)) continue;
    if (
      plan.obstacles.some(
        (o) =>
          (o.kind === 'box' ? boxGap(o, b) : boxDist(o.x, o.z, b) - (o.r || 0)) <
          (o.model === 'ctrstack' ? 5 : 3),
      )
    )
      continue;
    if (gbs.some((g) => boxGap(g, b) < 0.01)) continue;
    const y = Math.min(...gs) - 0.15;
    const h = Math.max(...lay) * CTR_H;
    const o = {
      model: 'ctrstack',
      kind: 'box',
      x: p.x,
      z: p.z,
      w,
      d,
      h,
      y,
      top: y + h,
      yaw: q4 * (Math.PI / 2),
      lay,
      color: Math.floor(r() * 5),
    };
    plan.obstacles.push(o, { ...o, x: -o.x, z: -o.z, yaw: o.yaw + Math.PI });
    stacks.push(o);
  }
  if (stacks.length < c.SZ(4, 2)) return '貨櫃堆放不下';
  plan.stacks = [];
  for (const o of stacks)
    plan.stacks.push(
      { x: o.x, z: o.z, w: o.w, d: o.d, h: o.h, rot: o.yaw },
      { x: -o.x, z: -o.z, w: o.w, d: o.d, h: o.h, rot: o.yaw + Math.PI },
    );
  if (!validate(plan).ok) return plan.fail;
  // 巷道：重新算出的通道上每 2 m 往兩側找到不能走的地方，有一側是貨櫃堆時寬度要 ≥ 8 m
  const narrow = yardNarrow(plan);
  if (narrow < 8) return `貨櫃巷道只有 ${narrow.toFixed(1)} m`;
  plan.yardMin = narrow;
  // 地面的裝飾（另一條亂數串）：貨櫃堆旁的棧板（不碰撞）
  const dr = makeRng((c.sub * 61 + 29) >>> 0);
  for (const o of stacks)
    if (dr() < 0.5) {
      const s = dr() < 0.5 ? 1 : -1;
      const along = o.w > o.d;
      const x = o.x + (along ? (dr() - 0.5) * o.w * 0.6 : s * (o.w / 2 + 1.2)),
        z = o.z + (along ? s * (o.d / 2 + 1.2) : (dr() - 0.5) * o.d * 0.6);
      decor.push({ model: 'pallets', x, z, y: hAt(x, z), yaw: o.yaw });
    }
  const n0 = decor.length;
  for (let k = 0; k < n0; k++) {
    const q = decor[k];
    decor.push({ ...q, x: -q.x, z: -q.z, yaw: q.yaw + Math.PI });
  }
  plan.decor = decor;
  return '';
}
// 通道最窄處（只算有一側碰到貨櫃堆的地方；m）：rts-map-test 也用
export function yardNarrow(plan) {
  const nav = plan.nav;
  if (!nav) return Infinity;
  const stacks = plan.obstacles.filter((o) => o.model === 'ctrstack');
  const inStack = (x, z) => stacks.some((b) => boxDist(x, z, b) < 1.2);
  let worst = Infinity;
  for (const ln of plan.lanes)
    for (let k = 1; k < ln.length; k++) {
      const a = ln[k - 1],
        b = ln[k];
      const sl = Math.hypot(b.x - a.x, b.z - a.z);
      if (sl < 1e-6) continue;
      const nx = -(b.z - a.z) / sl,
        nz = (b.x - a.x) / sl;
      const m = Math.max(1, Math.ceil(sl / 2));
      for (let s = 0; s < m; s++) {
        const x = a.x + ((b.x - a.x) * s) / m,
          z = a.z + ((b.z - a.z) * s) / m;
        if (!nav.walkableAt(x, z, 0)) continue;
        let w = 0,
          hit = false;
        for (const sg of [1, -1]) {
          let e = 0;
          while (e < 12 && nav.walkableAt(x + nx * sg * (e + 0.5), z + nz * sg * (e + 0.5), 0)) e += 0.5;
          if (e < 12 && inStack(x + nx * sg * (e + 0.5), z + nz * sg * (e + 0.5))) hit = true;
          w += e;
        }
        if (hit && w < worst) worst = w;
      }
    }
  return worst;
}

function fail(plan, why) {
  plan.ok = false;
  plan.fail = why;
  return plan;
}

// ---------- 檢查（NavGrid） ----------
// 回傳的 plan.check：各要點的路徑代價（兩邊）、最大差異比例、建築格數
export function validate(plan, nav) {
  nav = nav || new NavGrid(rtsShim(plan), { cell: NAV_CELL });
  for (const m of plan.mines) nav.reserve(m.pos.x, m.pos.z, 7);
  for (const c of plan.corals) nav.reserve(c.pos.x, c.pos.z, 5);
  if (plan.waterY !== undefined) reserveWater(nav, plan.waterY); // R5：水裡不能蓋（同 World.buildRts）
  // 中立建築（酒館、商店、傭兵營）佔地：不能壓在斷崖上，檢查與通道都要繞過它們
  for (const q of plan.neutrals) {
    const [fw, fd] = neutralFoot(q);
    for (const [sx, sz] of [
      [0, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ])
      if (!nav.walkableAt(q.pos.x + (sx * fw) / 2, q.pos.z + (sz * fd) / 2, 0))
        return fail(plan, `${q.kind} 的佔地不能通行`);
    nav.block(q.pos.x, q.pos.z, fw, fd, 0, true);
  }
  // 檢查用的導航格（不列舉：plan 本身維持純資料）
  Object.defineProperty(plan, 'nav', { value: nav, enumerable: false, writable: true, configurable: true });
  const [bA, bB] = plan.bases;
  // 主基地的平台上要能走（大型）
  if (!nav.walkableAt(bA.pos.x, bA.pos.z, 2)) return fail(plan, '主基地中心不能通行');
  // 礦坑地表的兩座酒館（成對）：離主基地 A 路徑比較近的那一座是 near 0（電腦去雇用時找自己這邊的）；
  // 兩座點對稱，要點照一般的成對建築檢查（差 < 3%，實際上是 0）
  const tavs = plan.pit ? plan.neutrals.filter((q) => q.kind === 'tavern' && q.near !== undefined) : [];
  if (tavs.length === 2) {
    const fdT = RTS_NEUTRAL_FOOT.tavern[1] / 2 + 6;
    const front = (q) => P(q.pos.x + Math.sin(q.yaw) * fdT, q.pos.z + Math.cos(q.yaw) * fdT);
    const c0 = nav.pathCost(bA.pos, front(tavs[0]), 1),
      c1 = nav.pathCost(bA.pos, front(tavs[1]), 1);
    tavs[0].near = c1 < c0 ? 1 : 0;
    tavs[1].near = 1 - tavs[0].near;
  }
  // 要點：A 側的點與它在 B 側的鏡像
  const keys = [];
  for (const m of plan.mines) if (m.owner === 0 || m.near === 0) keys.push(['mine:' + m.kind, m.pos]);
  for (const c of plan.corals) if (c.owner === 0 || c.near === 0) keys.push(['coral', c.pos]);
  for (const c of plan.camps) if (c.near === 0) keys.push(['camp' + c.tier, c.pos]);
  // 酒館在正中央（格子的角落上）：往 A 側偏 0.5 m，兩邊才落在互相對稱的格子
  // 中立建築佔用導航格：要點是正面外 6 m（中型單位的間隙）（酒館在正中央：朝 A 側那一面的外面，兩邊才互相對稱）
  const off = Math.hypot(bA.pos.x, bA.pos.z) || 1;
  for (const q of plan.neutrals) {
    const fd = (RTS_NEUTRAL_FOOT[q.kind] || [8, 8])[1] / 2 + 6;
    if (q.near === 0)
      keys.push([q.kind, P(q.pos.x + Math.sin(q.yaw || 0) * fd, q.pos.z + Math.cos(q.yaw || 0) * fd)]);
    else if (q.kind === 'tavern' && q.near === undefined)
      keys.push([q.kind, P(q.pos.x + (bA.pos.x / off) * fd, q.pos.z + (bA.pos.z / off) * fd)]);
  }
  for (const c of plan.chokes.filter((_, i) => i % 2 === 0)) keys.push(['choke', c.pos]);
  // R4 的結構（只有舊宇宙港外圍、Grid 086 地表有）：發射台的頂面、台階的上層
  for (const q of plan.pads || []) if (q.near === 0) keys.push(['pad', q.pos]);
  for (const q of plan.steps || []) if (q.near === 0) keys.push(['step', q.top]);
  // R5 的多重水壩：兩組坡道上去的壩頂（兩邊都要到得了、代價相等）
  for (const q of (plan.dam && plan.dam.tops) || []) keys.push(['dam', q]);
  // R6 的礦坑地表：坑底（正中央的富礦，兩邊到得了、大型單位下得去）
  if (plan.pit) keys.push(['pit', P(0, 0)]);
  keys.push(['enemyBase', bB.pos]);
  let worst = 0;
  const costs = [];
  for (const [name, p] of keys) {
    // 大型單位要到得了（礦與營地本身不是障礙物）
    const q = nav.nearestCell(p.x, p.z, 2, -1, 6);
    if (q < 0) return fail(plan, `${name} 附近沒有可通行的格子`);
    const qc = nav.center(q);
    if (!nav.reachable(bA.pos, qc, 2)) return fail(plan, `${name} 到不了`);
    const ca = nav.pathCost(bA.pos, p, 1),
      cb = nav.pathCost(bB.pos, neg(p), 1);
    if (!isFinite(ca) || !isFinite(cb)) return fail(plan, `${name} 到不了（中型）`);
    const d = Math.abs(ca - cb) / Math.max(ca, cb, 1);
    worst = Math.max(worst, d);
    costs.push({ name, a: Math.round(ca), b: Math.round(cb) });
    if (d > 0.03) return fail(plan, `${name} 路徑長度差 ${(d * 100).toFixed(1)}%`);
  }
  // 主基地只有一條坡道：把坡道堵住後，平台和自然分礦不通
  const r = bA.ramp;
  const mx = (r.top.x + r.bottom.x) / 2,
    mz = (r.top.z + r.bottom.z) / 2;
  nav.block(mx, mz, r.w + 8, r.len * 0.5, r.dir, true);
  const nat = plan.mines.find((m) => m.kind === 'natural' && m.owner === 0).pos;
  const sealed = !nav.reachable(bA.pos, nav.center(nav.nearestCell(nat.x, nat.z, 0)), 0);
  nav.block(mx, mz, r.w + 8, r.len * 0.5, r.dir, false);
  if (!sealed) return fail(plan, '主基地有坡道以外的出入口');
  // 平台的建築格（8×8 m、不重疊）
  const slots = countSlots(nav, bA.pos, bA.r);
  if (slots < 20) return fail(plan, `建築格只有 ${slots}`);
  plan.check = { worst, costs, slots };
  plan.lanes = makeLanes(plan, nav);
  plan.ok = true;
  plan.fail = '';
  return plan;
}
function countSlots(nav, c, r) {
  let best = 0;
  for (const ox of [0, 2, 4, 6])
    for (const oz of [0, 2, 4, 6]) {
      let n = 0;
      const gx0 = Math.floor((c.x - r) / 8) * 8 + ox,
        gz0 = Math.floor((c.z - r) / 8) * 8 + oz;
      for (let x = gx0; x <= c.x + r; x += 8)
        for (let z = gz0; z <= c.z + r; z += 8) {
          if (Math.hypot(x - c.x, z - c.z) > r) continue;
          if (nav.buildable(x, z, 8, 8)) n++;
        }
      best = Math.max(best, n);
    }
  return best;
}
// 主要通道（電腦 AI 參考）：A 的坡道下 → 每個窄路口（A 側）→ 中心或對面的路口 → B 的坡道下
function makeLanes(plan, nav) {
  const a = plan.bases[0].ramp.bottom,
    b = plan.bases[1].ramp.bottom;
  const ch = plan.chokes.filter((_, i) => i % 2 === 0);
  const lanes = [];
  const join = (...segs) => {
    const out = [{ x: a.x, z: a.z }];
    for (const s of segs)
      for (const p of s) out.push({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10 });
    return out;
  };
  // 橫向位置（垂直主軸）：A 側的路口 c 接 B 側橫向位置最接近的路口 −c'（同一側的通道）
  const ax = Math.cos(plan.axis),
    az = Math.sin(plan.axis);
  const vOf = (p) => -p.x * az + p.z * ax;
  for (const c of ch) {
    let best = ch[0];
    for (const d of ch)
      if (Math.abs(vOf(neg(d.pos)) - vOf(c.pos)) < Math.abs(vOf(neg(best.pos)) - vOf(c.pos))) best = d;
    const p1 = nav.findPath(a, c.pos, 1);
    const p2 = nav.findPath(c.pos, neg(best.pos), 1);
    // B 側：a → c' 的路徑轉 180° 再反向＝−c' → b
    const p3 = nav.findPath(a, best.pos, 1).slice(0, -1).reverse().map(neg);
    lanes.push(join(p1, p2, p3, [{ x: b.x, z: b.z }]));
  }
  return lanes.slice(0, 3);
}
