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
  pair(corals, (k, f) => ({ pos: f(coralMid), amount: AMOUNT.coralMid, owner: null, near: k }));
  const campsOut = [];
  for (const c of camps)
    pair(campsOut, (k, f) => {
      let g = { type: c.guards.type };
      if (c.guards.type === 'mine') g.mine = mines.findIndex((m) => dist(m.pos, f(c.guards.ref.p)) < 0.01);
      return { pos: f(c.p), tier: c.tier, guards: g, near: k };
    });
  const neutrals = [{ kind: 'tavern', pos: P(0, 0) }];
  pair(neutrals, (k, f) => ({ kind: 'shop', pos: f(shop), near: k }));
  pair(neutrals, (k, f) => ({ kind: 'merc', pos: f(merc), near: k }));
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
  return validate(plan);
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
  const off = Math.hypot(bA.pos.x, bA.pos.z) || 1;
  for (const q of plan.neutrals)
    if (q.near === 0) keys.push([q.kind, q.pos]);
    else if (q.kind === 'tavern')
      keys.push([q.kind, P(q.pos.x + (bA.pos.x / off) * 0.5, q.pos.z + (bA.pos.z / off) * 0.5)]);
  for (const c of plan.chokes.filter((_, i) => i % 2 === 0)) keys.push(['choke', c.pos]);
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
