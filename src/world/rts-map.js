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
};

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

export function planRtsMap(seed, opt = {}) {
  const theme = RTS_THEMES[opt.theme] ? opt.theme : 'wasteland';
  const size = opt.size || 400;
  const t0 = Date.now();
  let plan = null,
    full = null;
  const fails = [];
  const maxT = opt.tries || 20; // 最多試幾個子種子（除錯時可以設 1）
  for (let n = 0; n < maxT; n++) {
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
  const U = S - EDGE - 8; // 可以放東西的範圍（|x|、|z|）
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
  const plateau = (c, r, H, rampAng, rampW) => {
    const ph1 = R(0, 6.28),
      ph2 = R(0, 6.28);
    const dx = Math.cos(rampAng),
      dz = Math.sin(rampAng);
    const len = H / 0.27;
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
  const isLow = (p, m = 4) => {
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
  const base = plateau(A, rB, Hb, rampAng, R(11, 14));
  const ramp = base.ramp;
  const rdx = Math.cos(rampAng),
    rdz = Math.sin(rampAng);
  // 坡道下的自然分礦、基地旁的 Coral（坡道的兩側）
  const side = sgn();
  const pdx = -rdz * side,
    pdz = rdx * side;
  const natural = P(
    ramp.bottom.x + rdx * R(12, 18) + pdx * R(12, 18),
    ramp.bottom.z + rdz * R(12, 18) + pdz * R(12, 18),
  );
  const coralA = P(
    ramp.bottom.x + rdx * R(6, 12) - pdx * R(16, 22),
    ramp.bottom.z + rdz * R(6, 12) - pdz * R(16, 22),
  );
  // 主礦：平台上、坡道的反側
  const mAng = rampAng + Math.PI + R(-0.5, 0.5);
  const mainMine = P(A.x + Math.cos(mAng) * rB * 0.55, A.z + Math.sin(mAng) * rB * 0.55);

  // 山脊（主軸 u＝U1，橫跨地圖）＋ 2～3 個窄路口
  const [uNat] = L(natural);
  const U1 = Math.min(uNat - 32, Rb * R(0.42, 0.5));
  let vmin = 0,
    vmax = 0;
  for (let v = 0; v > -size * 1.5; v -= 2) if (inUse(W(U1, v), -40)) vmin = v;
  for (let v = 0; v < size * 1.5; v += 2) if (inUse(W(U1, v), -40)) vmax = v;
  const nGap = rng() < 0.5 ? 2 : 3;
  const span = vmax - vmin;
  const gaps = [];
  for (let k = 0; k < nGap; k++) {
    const f = nGap === 2 ? [0.3, 0.7][k] : [0.2, 0.5, 0.8][k];
    gaps.push({ v: vmin + span * (f + R(-0.06, 0.06)), w: R(13, 19) });
  }
  const ridgeHW = R(4, 6);
  const Hr = RA(TH.ridgeH);
  const uAt = (v) => U1 + (n2(v * 0.025 + 3.1, 7.7) - 0.5) * 14;
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
  for (const c of chokes) addKeep(c.pos, c.w / 2 + 16);
  const free = (p, r) =>
    keep.every((k) => dist(p, k.p) > k.r + r && dist(neg(p), k.p) > k.r + r) && dist(p, neg(p)) > 2 * r + 10;
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
    const p = W(R(30, U1 - 25), sgn() * R(55, 115));
    if (!inUse(p, r + 30) || !free(p, r + 26)) continue;
    const a = Math.atan2(-p.z, -p.x) + R(-1.2, 1.2);
    watch = plateau(p, r, RA(TH.watchH), a, R(11, 13));
    addKeep(p, r + 30);
  }

  // ---------- 點位（半張圖） ----------
  if (!inUse(natural, 10) || !isLow(natural, 8)) return fail({ sub }, '自然分礦不在低地');
  if (!inUse(coralA, 10) || !isLow(coralA, 6)) return fail({ sub }, '基地的 Coral 不在低地');
  const pts = [{ p: P(0, 0), r: 14 }]; // 已佔用的點（含鏡像）：{ p, r }
  const taken = (p, r) => pts.some((q) => dist(p, q.p) < q.r + r) || dist(p, neg(p)) < 2 * r;
  const put = (p, r) => {
    pts.push({ p, r }, { p: neg(p), r });
  };
  put(A, rB + 12);
  put(natural, 14);
  put(coralA, 10);
  put(mainMine, 6);
  // 外圍分礦：基地這側（山脊後）1 個＋中立區 1～2 個
  const outer = [];
  const nOuterMid = rng() < 0.5 ? 1 : 2;
  const findLow = (uR, vR, r, tries = 60) => {
    for (let t = 0; t < tries; t++) {
      const p = W(R(uR[0], uR[1]), R(vR[0], vR[1]) * (t & 1 ? 1 : -1));
      if (!inUse(p, 14) || !isLow(p, r) || taken(p, r + 10)) continue;
      return p;
    }
    return null;
  };
  const back = findLow([U1 + 22, Rb - 10], [70, 170], 12);
  if (back) {
    outer.push({ p: back, rich: false });
    put(back, 14);
  }
  for (let k = 0; k < nOuterMid; k++) {
    const p = findLow([12, U1 - 22], [55, 170], 12);
    if (!p) continue;
    outer.push({ p, rich: k === 0 });
    put(p, 14);
  }
  // 中立區：酒館在正中央；商店、傭兵營、中立的 Coral 成對（p 與 −p）
  const shop = findLow([-12, 12], [24, 46], 8) || W(0, 34);
  put(shop, 10);
  const merc = findLow([-25, 25], [30, 70], 8) || W(0, -54);
  put(merc, 10);
  const coralMid = findLow([-20, 30], [60, 110], 8) || W(10, 80);
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
  const campNear = (c, r0, r1, tier, guards) => {
    for (let t = 0; t < 40; t++) {
      const a = R(0, 6.28),
        d = R(r0, r1);
      const p = P(c.x + Math.cos(a) * d, c.z + Math.sin(a) * d);
      if (!inUse(p, 12) || !isLow(p, 5) || taken(p, 8)) continue;
      camps.push({ p, tier, guards });
      put(p, 9);
      return true;
    }
    return false;
  };
  outer.forEach((o, i) => campNear(o.p, 12, 20, o.rich ? 3 : 2, { type: 'mine', ref: o }));
  if (watch) {
    camps.push({ p: watch.c, tier: 2, guards: { type: 'high' } });
    put(watch.c, 9);
  }
  for (const c of chokes.slice(0, 1)) campNear(c.pos, 22, 34, 1, { type: 'item' });
  for (let t = 0; t < 30 && camps.length < 4; t++) {
    const p = findLow([10, U1 - 10], [20, 150], 6, 4);
    if (p) {
      camps.push({ p, tier: rng() < 0.3 ? 2 : 1, guards: { type: 'item' } });
      put(p, 9);
    }
  }
  if (rng() < 0.4) {
    const p = findLow([10, U1 - 10], [20, 150], 6);
    if (p) {
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
      const lo = 0.5 * (lowN(x, z) + lowN(-x, -z));
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
  noObs(P(0, 0), 26);
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
  const ground = (p, sink) => hAt(p.x, p.z) - sink;
  scatterObs(Math.round(RA(C.rocks)), TH.rocks, (p, r) => {
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
  for (let k = 0, nW = Math.round(RA(C.wrecks)); k < nW; k++) {
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
  scatterObs(Math.round(RA(C.lights)), TH.lights, (p) => {
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
  const neutrals = [{ kind: 'tavern', pos: P(0, 0), yaw: 0 }];
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
  if (campsOut.length < 6 || campsOut.length > 10) return fail(plan, `營地數 ${campsOut.length}`);
  if (outer.length < 2) return fail(plan, '外圍分礦不足');
  // 主題的附加地形（冰湖…）：在高度圖與障礙物之後、檢查之前；自己的亂數串 makeRng(sub × 53 ＋ 19)
  const ctx = { rng: makeRng((sub * 53 + 19) >>> 0), high, W, S, U1, chokes, inUse, sub };
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
  const keep = [];
  for (const b of plan.highs) keep.push([b.pos, b.r + 6], [b.ramp.bottom, 16], [b.ramp.top, 12]);
  for (const m of plan.mines) keep.push([m.pos, 20]);
  for (const q of plan.corals) keep.push([q.pos, 20]);
  for (const q of plan.camps) keep.push([q.pos, 10]);
  for (const q of plan.neutrals) keep.push([q.pos, 12]);
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
  let rMax = 20;
  const make = (x, z, rot) => {
    const rx = R(12, rMax);
    return { x, z, rx, rz: rx * R(0.55, 0.8), rot };
  };
  // 第一個：主要通道（第一次檢查算出的 plan.lanes，A 側的前半段）上，長軸順著通道
  for (let t = 0; t < 80 && !lakes.length; t++) {
    if (t === 40) rMax = 15;
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) break;
    let tot = 0;
    for (let k = 1; k < lane.length; k++)
      tot += Math.hypot(lane[k].x - lane[k - 1].x, lane[k].z - lane[k - 1].z);
    let want = tot * R(0.12, 0.42);
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
  rMax = 20;
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
  const keep = structKeep(plan, { base: 25, res: 20, camp: 12, neutral: 15 });
  const dots = laneDots(plan);
  let pad = null;
  for (let t = 0; t < 300 && !pad; t++) {
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) return '通道不足';
    const q = laneAt(lane, R(0.25, 0.65));
    const rad = R(14, 18),
      H = R(6, 8),
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
  const ts = 0.55;
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
  const nRows = wr() < 0.5 ? 2 : 3;
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
  if (walls.length < 6) return '防爆牆放不下';
  // 重新檢查；新的通道（繞過防爆牆）離某一列不到 WALL_GAP 時拿掉那一列（成對）再檢查，最多兩次
  for (let it = 0; ; it++) {
    if (!validate(plan).ok) return plan.fail;
    const bad = wallsBad(plan);
    if (!bad.size) break;
    if (it >= 2) return '防爆牆擋到通道';
    plan.obstacles = plan.obstacles.filter((o) => !bad.has(o.row));
  }
  return plan.obstacles.filter((o) => o.row).length >= 12 ? '' : '防爆牆放不下';
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
  const keep = structKeep(plan, { base: 20, res: 20, camp: 12, neutral: 15 });
  const dots = laneDots(plan);
  const steps = [];
  for (let t = 0; t < 400 && steps.length < 2; t++) {
    const lane = plan.lanes[Math.floor(r() * plan.lanes.length)];
    if (!lane || lane.length < 2) return '通道不足';
    const q = laneAt(lane, R(0.12, 0.8));
    const H1 = R(4, 5),
      H2 = R(4, 5);
    const len2 = H2 / STRUCT_SLOPE;
    // 下層：地面坡道上來的平台（landing 3 m）＋上層坡道（整個寬度）；上層 Lu ≥ 14 m（頂層才放得下 8×8 的建築）
    const L = R(Math.max(24, len2 + 17), 38),
      W = R(16, 20);
    const Lu = L - len2 - 3;
    const rw1 = R(11, 13);
    const vb = R(-0.5, 0.5) * Math.max(0, W / 2 - rw1 / 2 - 0.5);
    const off = W / 2 + R(6, 24);
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
  if (steps.length < 2) return '構造體台階放不下';
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
    else if (q.kind === 'tavern')
      keys.push([q.kind, P(q.pos.x + (bA.pos.x / off) * fd, q.pos.z + (bA.pos.z / off) * fd)]);
  }
  for (const c of plan.chokes.filter((_, i) => i % 2 === 0)) keys.push(['choke', c.pos]);
  // R4 的結構（只有舊宇宙港外圍、Grid 086 地表有）：發射台的頂面、台階的上層
  for (const q of plan.pads || []) if (q.near === 0) keys.push(['pad', q.pos]);
  for (const q of plan.steps || []) if (q.near === 0) keys.push(['step', q.top]);
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
