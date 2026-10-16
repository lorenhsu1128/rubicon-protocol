// RTS 的導航格（尋路、建築格；之後的視野格用同一套格子）。純資料、不用 THREE，node 也能跑（scripts/rts-map-test.js）。
// world 只需要：size、terrainHeight(x, z)、obstacles（World 的障礙物格式：box／circle、deck、top），
// 選用 waterDepth(x, z)、isVoid(x, z)。
// 格子：邊長 cell，(gx, gz) → i＝gz×W＋gx，格子中心 x＝−S＋(gx＋0.5)×cell。
// pass＝靜態可通行（坡度、障礙物、水、虛空、地圖邊緣）；occ＝建築佔用（block 增減）；res＝資源點保留區（只影響 buildable）；
// clear＝離最近不可通行格的距離（格，倒角距離，上限 CAP），單位大小 size 0／1／2 需要的距離不同。
const SQ2 = Math.SQRT2;
const CAP = 8; // clearance 上限（格）：只需要分辨到最大的單位
export const NAV_SLOPE = 0.6; // 可通行的最大坡度（高差／水平距離，約 31°）
export const BUILD_SLOPE = 0.2; // 建築格的最大坡度
export const SIZE_R = [0, 1.5, 2.5]; // 單位半徑（m）：小型、中型、大型（可以用 opt.sizes 改）
const DX = [1, -1, 0, 0, 1, -1, 1, -1],
  DZ = [0, 0, 1, -1, 1, 1, -1, -1];

export class NavGrid {
  constructor(world, opt = {}) {
    const cell = opt.cell || 2;
    this.world = world;
    this.cell = cell;
    this.S = world.size / 2;
    const W = (this.W = Math.ceil(world.size / cell));
    const N = (this.N = W * W);
    this.maxSlope = opt.maxSlope || NAV_SLOPE;
    this.edge = opt.edge !== undefined ? opt.edge : cell; // 地圖邊緣這麼寬一律不可通行
    this.maxWater = opt.maxWater || 1.8;
    this.hgt = new Float32Array(N);
    this.slope = new Float32Array(N);
    this.pass = new Uint8Array(N);
    this.occ = new Uint8Array(N);
    this.res = new Uint8Array(N);
    this.clear = new Float32Array(N);
    // 單位大小需要的 clearance（格）：半徑＋半格
    this.need = (opt.sizes || SIZE_R).map((r) => (r + cell / 2) / cell);
    this.ver = 0; // 建築改變時加 1（流場、連通分量作廢）
    this.comp = [null, null, null];
    this.masks = [null, null, null];
    this.flows = new Map();
    // 重複使用的搜尋緩衝
    this.gCost = new Float32Array(N);
    this.parent = new Int32Array(N);
    this.seen = new Uint32Array(N); // 本次搜尋碰過（gCost 有效）
    this.done = new Uint32Array(N); // 本次搜尋已關閉
    this.gen = 0;
    this.heap = new Int32Array(N);
    this.hkey = new Float32Array(N);
    this.hpos = new Int32Array(N);
    this.hn = 0;
    this.tmp = new Float32Array(N);
    this.buf = new Int32Array(N);
    this.build();
  }
  // ---------- 建立 ----------
  build() {
    const { W, cell, S, world } = this;
    const th = (x, z) => world.terrainHeight(x, z);
    // 格子角落的高度（(W+1)²）
    const CW = W + 1,
      ch = new Float32Array(CW * CW);
    for (let j = 0; j <= W; j++)
      for (let i = 0; i <= W; i++) ch[j * CW + i] = th(-S + i * cell, -S + j * cell);
    const diag = cell / SQ2;
    const wd = world.waterDepth ? (x, z) => world.waterDepth(x, z) : null;
    const vd = world.isVoid ? (x, z) => world.isVoid(x, z) : null;
    const eg = this.edge;
    for (let gz = 0; gz < W; gz++)
      for (let gx = 0; gx < W; gx++) {
        const i = gz * W + gx;
        const x = -S + (gx + 0.5) * cell,
          z = -S + (gz + 0.5) * cell;
        const h = th(x, z);
        const a = ch[gz * CW + gx],
          b = ch[gz * CW + gx + 1],
          c = ch[(gz + 1) * CW + gx],
          d = ch[(gz + 1) * CW + gx + 1];
        const sl = Math.max(
          Math.abs(h - a) / diag,
          Math.abs(h - b) / diag,
          Math.abs(h - c) / diag,
          Math.abs(h - d) / diag,
          Math.abs(a - b) / cell,
          Math.abs(c - d) / cell,
          Math.abs(a - c) / cell,
          Math.abs(b - d) / cell,
        );
        this.hgt[i] = h;
        this.slope[i] = sl;
        let ok = sl <= this.maxSlope;
        if (ok && (x < -S + eg || x > S - eg || z < -S + eg || z > S - eg)) ok = false;
        if (ok && wd && wd(x, z) > this.maxWater) ok = false;
        if (ok && vd && vd(x, z)) ok = false;
        this.pass[i] = ok ? 1 : 0;
      }
    for (const o of world.obstacles || []) this.stampObstacle(o);
    this.dtRegion(0, 0, W - 1, W - 1, 0);
  }
  // 障礙物蓋掉格子（格子中心落在外形外擴 pad 以內）
  stampObstacle(o) {
    const { cell, S, W } = this;
    const pad = cell * 0.3;
    const g0 = this.world.terrainHeight(o.x, o.z);
    if (o.kind === 'box') {
      if (o.deck) {
        // 橋面板：下方夠高時可以從下面通過（上面的通行由之後的版本處理）
        if (o.y - g0 > 3.5) return;
      } else if (o.top !== undefined && o.top - g0 < 0.9) return; // 低矮的：跨過去
      const x0 = o.x - o.w / 2 - pad,
        x1 = o.x + o.w / 2 + pad,
        z0 = o.z - o.d / 2 - pad,
        z1 = o.z + o.d / 2 + pad;
      const gx0 = Math.max(0, Math.floor((x0 + S) / cell - 0.5)),
        gx1 = Math.min(W - 1, Math.ceil((x1 + S) / cell - 0.5)),
        gz0 = Math.max(0, Math.floor((z0 + S) / cell - 0.5)),
        gz1 = Math.min(W - 1, Math.ceil((z1 + S) / cell - 0.5));
      for (let gz = gz0; gz <= gz1; gz++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const x = -S + (gx + 0.5) * cell,
            z = -S + (gz + 0.5) * cell;
          if (x >= x0 && x <= x1 && z >= z0 && z <= z1) this.pass[gz * W + gx] = 0;
        }
    } else {
      const r = (o.r || 0) + pad;
      const gx0 = Math.max(0, Math.floor((o.x - r + S) / cell)),
        gx1 = Math.min(W - 1, Math.floor((o.x + r + S) / cell)),
        gz0 = Math.max(0, Math.floor((o.z - r + S) / cell)),
        gz1 = Math.min(W - 1, Math.floor((o.z + r + S) / cell));
      for (let gz = gz0; gz <= gz1; gz++)
        for (let gx = gx0; gx <= gx1; gx++) {
          const x = -S + (gx + 0.5) * cell - o.x,
            z = -S + (gz + 0.5) * cell - o.z;
          if (x * x + z * z <= r * r) this.pass[gz * W + gx] = 0;
        }
    }
  }
  blocked(i) {
    return !this.pass[i] || this.occ[i] > 0;
  }
  // 倒角距離轉換（1／√2），在 [gx0..gx1]×[gz0..gz1] 外擴 m 格的範圍計算、只寫回原範圍外擴 m／2 以內。
  // 全圖時 m＝0；局部更新時 m＝2×CAP（外圈的值不正確，但寫回的部分最近的不可通行格一定在計算範圍內）
  dtRegion(gx0, gz0, gx1, gz1, m) {
    const { W } = this;
    const ax = Math.max(0, gx0 - m),
      bx = Math.min(W - 1, gx1 + m),
      az = Math.max(0, gz0 - m),
      bz = Math.min(W - 1, gz1 + m);
    const D = this.tmp;
    for (let gz = az; gz <= bz; gz++)
      for (let gx = ax; gx <= bx; gx++) {
        const i = gz * W + gx;
        D[i] = this.blocked(i) ? 0 : CAP;
      }
    // 地圖外當成不可通行（距離 0），範圍外（地圖內）當成 CAP
    const at = (gx, gz) =>
      gx < 0 || gz < 0 || gx >= W || gz >= W
        ? 0
        : gx < ax || gx > bx || gz < az || gz > bz
          ? CAP
          : D[gz * W + gx];
    for (let gz = az; gz <= bz; gz++)
      for (let gx = ax; gx <= bx; gx++) {
        const i = gz * W + gx;
        let d = D[i];
        if (d === 0) continue;
        d = Math.min(
          d,
          at(gx - 1, gz) + 1,
          at(gx, gz - 1) + 1,
          at(gx - 1, gz - 1) + SQ2,
          at(gx + 1, gz - 1) + SQ2,
        );
        D[i] = d;
      }
    for (let gz = bz; gz >= az; gz--)
      for (let gx = bx; gx >= ax; gx--) {
        const i = gz * W + gx;
        let d = D[i];
        if (d === 0) continue;
        d = Math.min(
          d,
          at(gx + 1, gz) + 1,
          at(gx, gz + 1) + 1,
          at(gx + 1, gz + 1) + SQ2,
          at(gx - 1, gz + 1) + SQ2,
        );
        D[i] = d;
      }
    const h = m >> 1;
    const wx0 = Math.max(0, gx0 - h),
      wx1 = Math.min(W - 1, gx1 + h),
      wz0 = Math.max(0, gz0 - h),
      wz1 = Math.min(W - 1, gz1 + h);
    for (let gz = wz0; gz <= wz1; gz++)
      for (let gx = wx0; gx <= wx1; gx++) this.clear[gz * W + gx] = D[gz * W + gx];
  }
  // ---------- 查詢 ----------
  cellOf(x, z) {
    const gx = Math.floor((x + this.S) / this.cell),
      gz = Math.floor((z + this.S) / this.cell);
    if (gx < 0 || gz < 0 || gx >= this.W || gz >= this.W) return -1;
    return gz * this.W + gx;
  }
  // 地圖外的點夾到最近的格子
  cellClamp(x, z) {
    const W = this.W;
    const gx = Math.min(W - 1, Math.max(0, Math.floor((x + this.S) / this.cell))),
      gz = Math.min(W - 1, Math.max(0, Math.floor((z + this.S) / this.cell)));
    return gz * W + gx;
  }
  center(i, out = {}) {
    out.x = -this.S + ((i % this.W) + 0.5) * this.cell;
    out.z = -this.S + (Math.floor(i / this.W) + 0.5) * this.cell;
    return out;
  }
  heightAt(i) {
    return this.hgt[i];
  }
  slopeAt(i) {
    return this.slope[i];
  }
  walkable(i, size = 0) {
    return i >= 0 && i < this.N && (this.masks[size] || this.mask(size))[i] === 1;
  }
  // 依大小的可通行遮罩（延遲計算，建築改變時作廢）
  mask(size) {
    const M = new Uint8Array(this.N),
      need = this.need[size];
    for (let i = 0; i < this.N; i++)
      M[i] = this.pass[i] === 1 && this.occ[i] === 0 && this.clear[i] >= need - 1e-4 ? 1 : 0;
    return (this.masks[size] = M);
  }
  walkableAt(x, z, size = 0) {
    return this.walkable(this.cellOf(x, z), size);
  }
  // ---------- 建築 ----------
  // 旋轉矩形（中心 x, z，寬 w（本地 X）、深 d（本地 Z），yaw 同 three.js 繞 Y）蓋到的格子；回傳格子數
  rectCells(x, z, w, d, yaw, fn) {
    const { cell, S, W } = this;
    const c = Math.cos(yaw || 0),
      s = Math.sin(yaw || 0);
    const ex = (Math.abs(c) * w + Math.abs(s) * d) / 2,
      ez = (Math.abs(s) * w + Math.abs(c) * d) / 2;
    const gx0 = Math.max(0, Math.floor((x - ex + S) / cell)),
      gx1 = Math.min(W - 1, Math.floor((x + ex + S) / cell)),
      gz0 = Math.max(0, Math.floor((z - ez + S) / cell)),
      gz1 = Math.min(W - 1, Math.floor((z + ez + S) / cell));
    let n = 0;
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = -S + (gx + 0.5) * cell - x,
          dz = -S + (gz + 0.5) * cell - z;
        const lx = c * dx - s * dz,
          lz = s * dx + c * dz;
        if (Math.abs(lx) <= w / 2 + 1e-6 && Math.abs(lz) <= d / 2 + 1e-6) {
          fn(gz * W + gx);
          n++;
        }
      }
    return [gx0, gz0, gx1, gz1, n];
  }
  // 建築蓋好（on）／拆掉：佔用格子、重算附近的 clearance，流場與連通分量作廢
  block(x, z, w, d, yaw = 0, on = true) {
    const r = this.rectCells(x, z, w, d, yaw, (i) => {
      if (on) this.occ[i] = Math.min(255, this.occ[i] + 1);
      else if (this.occ[i] > 0) this.occ[i]--;
    });
    if (r[4]) {
      this.dtRegion(r[0], r[1], r[2], r[3], CAP * 2);
      this.invalidate();
    }
    return r[4];
  }
  invalidate() {
    this.ver++;
    this.comp[0] = this.comp[1] = this.comp[2] = null;
    this.masks[0] = this.masks[1] = this.masks[2] = null;
    this.flows.clear();
  }
  // 資源點保留區（礦脈、Coral 湧出點周圍不能蓋建築）
  reserve(x, z, r, on = true) {
    const { cell, S, W } = this;
    const gx0 = Math.max(0, Math.floor((x - r + S) / cell)),
      gx1 = Math.min(W - 1, Math.floor((x + r + S) / cell)),
      gz0 = Math.max(0, Math.floor((z - r + S) / cell)),
      gz1 = Math.min(W - 1, Math.floor((z + r + S) / cell));
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const dx = -S + (gx + 0.5) * cell - x,
          dz = -S + (gz + 0.5) * cell - z;
        if (dx * dx + dz * dz > r * r) continue;
        const i = gz * W + gx;
        if (on) this.res[i] = Math.min(255, this.res[i] + 1);
        else if (this.res[i] > 0) this.res[i]--;
      }
  }
  // 建築格：軸對齊的 w×d 範圍（中心 x, z）內的格子都可通行、沒有佔用、不在保留區、坡度小、高低差小
  buildable(x, z, w, d) {
    const { cell, S, W } = this;
    if (
      x - w / 2 < -S + this.edge ||
      x + w / 2 > S - this.edge ||
      z - d / 2 < -S + this.edge ||
      z + d / 2 > S - this.edge
    )
      return false;
    const gx0 = Math.max(0, Math.round((x - w / 2 + S) / cell)),
      gx1 = Math.min(W - 1, Math.round((x + w / 2 + S) / cell) - 1),
      gz0 = Math.max(0, Math.round((z - d / 2 + S) / cell)),
      gz1 = Math.min(W - 1, Math.round((z + d / 2 + S) / cell) - 1);
    let lo = 1e9,
      hi = -1e9;
    for (let gz = gz0; gz <= gz1; gz++)
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gz * W + gx;
        if (!this.pass[i] || this.occ[i] || this.res[i] || this.slope[i] > BUILD_SLOPE) return false;
        const h = this.hgt[i];
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    return hi - lo <= 1;
  }
  // ---------- 連通分量（依大小，延遲計算，建築改變時作廢） ----------
  components(size) {
    if (this.comp[size]) return this.comp[size];
    const { N, W } = this;
    const C = new Int32Array(N).fill(-1);
    const Q = this.buf;
    let id = 0;
    for (let s = 0; s < N; s++) {
      if (C[s] >= 0 || !this.walkable(s, size)) continue;
      let qh = 0,
        qt = 0;
      Q[qt++] = s;
      C[s] = id;
      while (qh < qt) {
        const i = Q[qh++];
        const gx = i % W,
          gz = (i - gx) / W;
        for (let k = 0; k < 8; k++) {
          const nx = gx + DX[k],
            nz = gz + DZ[k];
          if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
          const j = nz * W + nx;
          if (C[j] >= 0 || !this.walkable(j, size)) continue;
          if (k >= 4 && (!this.walkable(gz * W + nx, size) || !this.walkable(nz * W + gx, size))) continue;
          C[j] = id;
          Q[qt++] = j;
        }
      }
      id++;
    }
    this.comp[size] = C;
    return C;
  }
  // 離 (x, z) 最近的可通行格（comp 給了時只找那個連通分量）；找不到時 −1
  nearestCell(x, z, size = 0, comp = -1, maxR = 0) {
    const { W, cell, S } = this;
    const C = comp >= 0 ? this.components(size) : null;
    const ok = (i) => (C ? C[i] === comp : this.walkable(i, size));
    const c0 = this.cellClamp(x, z);
    if (ok(c0)) return c0;
    const gx0 = c0 % W,
      gz0 = (c0 - gx0) / W;
    const R = maxR || W;
    for (let r = 1; r <= R; r++) {
      let best = -1,
        bd = 1e18;
      for (let dz = -r; dz <= r; dz++) {
        const step = dz === -r || dz === r ? 1 : 2 * r;
        for (let dx = -r; dx <= r; dx += step) {
          const gx = gx0 + dx,
            gz = gz0 + dz;
          if (gx < 0 || gz < 0 || gx >= W || gz >= W) continue;
          const i = gz * W + gx;
          if (!ok(i)) continue;
          const px = -S + (gx + 0.5) * cell - x,
            pz = -S + (gz + 0.5) * cell - z;
          const dd = px * px + pz * pz;
          if (dd < bd) {
            bd = dd;
            best = i;
          }
        }
      }
      // 這一圈找到的不一定是最近的（下一圈的角落可能更近），再多看一圈就夠準
      if (best >= 0) {
        if (r < R) {
          const r2 = r + 1;
          for (let dz = -r2; dz <= r2; dz++) {
            const step = dz === -r2 || dz === r2 ? 1 : 2 * r2;
            for (let dx = -r2; dx <= r2; dx += step) {
              const gx = gx0 + dx,
                gz = gz0 + dz;
              if (gx < 0 || gz < 0 || gx >= W || gz >= W) continue;
              const i = gz * W + gx;
              if (!ok(i)) continue;
              const px = -S + (gx + 0.5) * cell - x,
                pz = -S + (gz + 0.5) * cell - z;
              const dd = px * px + pz * pz;
              if (dd < bd) {
                bd = dd;
                best = i;
              }
            }
          }
        }
        return best;
      }
    }
    return -1;
  }
  reachable(a, b, size = 0) {
    const C = this.components(size);
    const i = this.cellOf(a.x, a.z),
      j = this.cellOf(b.x, b.z);
    return i >= 0 && j >= 0 && C[i] >= 0 && C[i] === C[j];
  }
  // ---------- 二元堆積（以格子編號為元素、可降鍵） ----------
  hPush(i, f) {
    let k = this.hn++;
    const H = this.heap,
      F = this.hkey,
      P = this.hpos;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      H[k] = H[p];
      F[k] = F[p];
      P[H[k]] = k;
      k = p;
    }
    H[k] = i;
    F[k] = f;
    P[i] = k;
  }
  hDecrease(i, f) {
    const H = this.heap,
      F = this.hkey,
      P = this.hpos;
    let k = P[i];
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (F[p] <= f) break;
      H[k] = H[p];
      F[k] = F[p];
      P[H[k]] = k;
      k = p;
    }
    H[k] = i;
    F[k] = f;
    P[i] = k;
  }
  hPop() {
    const H = this.heap,
      F = this.hkey,
      P = this.hpos;
    const top = H[0];
    const n = --this.hn;
    if (n > 0) {
      const x = H[n],
        f = F[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && F[c + 1] < F[c]) c++;
        if (F[c] >= f) break;
        H[k] = H[c];
        F[k] = F[c];
        P[H[k]] = k;
        k = c;
      }
      H[k] = x;
      F[k] = f;
      P[x] = k;
    }
    return top;
  }
  nextGen() {
    if (++this.gen >= 0xfffffff0) {
      this.seen.fill(0);
      this.done.fill(0);
      this.gen = 1;
    }
    return this.gen;
  }
  // ---------- A* ----------
  // 回傳格子路徑（起點格到終點格，存在 this.buf，長度回傳）；到不了終點時走到最近可達的格子
  // hk：啟發值的倍率（1＝最短路徑；大於 1＝加權 A*，展開的格子少很多，路徑最多長 (hk−1) 倍）
  astar(s, g, size, hk = 1.001) {
    const { W } = this;
    const gen = this.nextGen();
    const G = this.gCost,
      PA = this.parent,
      SE = this.seen,
      DN = this.done;
    const gx1 = g % W,
      gz1 = (g - gx1) / W;
    const hf = (i) => {
      const gx = i % W,
        gz = (i - gx) / W;
      const ax = Math.abs(gx - gx1),
        az = Math.abs(gz - gz1);
      return ax > az ? ax + (SQ2 - 1) * az : az + (SQ2 - 1) * ax;
    };
    this.hn = 0;
    G[s] = 0;
    PA[s] = -1;
    SE[s] = gen;
    const M = this.masks[size] || this.mask(size);
    const HK = hk;
    this.hPush(s, hf(s) * HK);
    let best = s,
      bh = hf(s);
    while (this.hn) {
      const i = this.hPop();
      if (DN[i] === gen) continue;
      DN[i] = gen;
      if (i === g) {
        best = g;
        break;
      }
      const gx = i % W,
        gz = (i - gx) / W;
      const gi = G[i];
      for (let k = 0; k < 8; k++) {
        const nx = gx + DX[k],
          nz = gz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        const j = nz * W + nx;
        if (DN[j] === gen || M[j] !== 1) continue;
        if (k >= 4 && (M[gz * W + nx] !== 1 || M[nz * W + gx] !== 1)) continue;
        const ng = gi + (k >= 4 ? SQ2 : 1);
        if (SE[j] === gen && ng >= G[j]) continue;
        const h = hf(j);
        G[j] = ng;
        PA[j] = i;
        if (SE[j] === gen) this.hDecrease(j, ng + h * HK);
        else {
          SE[j] = gen;
          this.hPush(j, ng + h * HK);
        }
        if (h < bh) {
          bh = h;
          best = j;
        }
      }
    }
    // 回溯
    let n = 0;
    for (let i = best; i >= 0; i = PA[i]) this.tmp[n++] = i;
    for (let k = 0; k < n; k++) this.buf[k] = this.tmp[n - 1 - k];
    this.lastCost = G[best] * this.cell;
    this.lastEnd = best;
    return n;
  }
  // 線段 a → b 經過的格子都可通行（每 0.35 格取樣）
  lineClear(ax, az, bx, bz, size) {
    const dx = bx - ax,
      dz = bz - az;
    const L = Math.hypot(dx, dz);
    const n = Math.ceil(L / (this.cell * 0.35));
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (!this.walkable(this.cellOf(ax + dx * t, az + dz * t), size)) return false;
    }
    return true;
  }
  // 起點 from、終點 to（{x, z}）→ 路徑點 [{x, z}]（不含起點；最後一點是終點或最近可達點）。到不了任何地方時空陣列
  // opt.exact：最短路徑（預設用加權 A*，快很多，拉直後幾乎一樣）
  findPath(from, to, size = 0, opt) {
    this.lastCost = Infinity;
    let s = this.cellOf(from.x, from.z);
    if (!this.walkable(s, size)) {
      s = this.nearestCell(from.x, from.z, size, -1, 6);
      if (s < 0) return [];
    }
    const C = this.components(size);
    const cs = C[s];
    let g = this.cellOf(to.x, to.z);
    const exact = g >= 0 && C[g] === cs;
    if (!exact) g = this.nearestCell(to.x, to.z, size, cs);
    if (g < 0) return [];
    if (g === s) {
      this.lastCost = 0;
      return exact ? [{ x: to.x, z: to.z }] : [this.center(g)];
    }
    const n = this.astar(s, g, size, opt && opt.exact ? 1.001 : 1.2);
    // 先只留轉折點（方向改變處），再以視線拉直（string pulling）
    const W = this.W,
      B = this.buf;
    const corners = [];
    let pdx = 0,
      pdz = 0;
    for (let k = 1; k < n; k++) {
      const a = B[k - 1],
        b = B[k];
      const dx = (b % W) - (a % W),
        dz = Math.floor(b / W) - Math.floor(a / W);
      if (k > 1 && (dx !== pdx || dz !== pdz)) corners.push(a);
      pdx = dx;
      pdz = dz;
    }
    const pts = [{ x: from.x, z: from.z }];
    for (const c of corners) pts.push(this.center(c));
    const end = exact && this.lastEnd === g ? { x: to.x, z: to.z } : this.center(this.lastEnd);
    pts.push(end);
    const out = [];
    let a = 0;
    while (a < pts.length - 1) {
      let b = a + 1;
      while (b + 1 < pts.length && this.lineClear(pts[a].x, pts[a].z, pts[b + 1].x, pts[b + 1].z, size)) b++;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }
  // 路徑長度（拉直後的折線，m）；到不了時 Infinity
  pathLength(a, b, size = 0) {
    if (!this.reachable(a, b, size)) return Infinity;
    const p = this.findPath(a, b, size);
    let L = 0,
      x = a.x,
      z = a.z;
    for (const q of p) {
      L += Math.hypot(q.x - x, q.z - z);
      x = q.x;
      z = q.z;
    }
    return L;
  }
  // A* 的格子路徑代價（m，8 方向）：最佳解唯一，適合比較兩條路徑是否等長；到不了時 Infinity
  pathCost(a, b, size = 0) {
    if (!this.reachable(a, b, size)) return Infinity;
    this.findPath(a, b, size, { exact: true });
    return this.lastCost;
  }
  // ---------- 流場 ----------
  // 群體移動到同一點：從目標格做整張圖的 Dijkstra（8 方向、不切角），以目標格與 size 快取，建築改變時作廢。
  // dir(x, z, out?) → 往目標的單位向量 {x, z}，已到達（在目標格）或到不了時 null；dist(x, z) → 剩下的距離（m）
  flowField(tx, tz, size = 0) {
    let g = this.cellOf(tx, tz);
    if (!this.walkable(g, size)) g = this.nearestCell(tx, tz, size);
    const key = g * 4 + size;
    const hit = this.flows.get(key);
    if (hit) {
      this.flows.delete(key);
      this.flows.set(key, hit); // 最近使用的排到最後
      hit.tx = tx;
      hit.tz = tz;
      return hit;
    }
    const { N, W, cell } = this;
    const D = new Float32Array(N).fill(Infinity);
    const VX = new Float32Array(N),
      VZ = new Float32Array(N);
    if (g >= 0) {
      const gen = this.nextGen();
      const SE = this.seen,
        DN = this.done;
      this.hn = 0;
      D[g] = 0;
      SE[g] = gen;
      this.hPush(g, 0);
      while (this.hn) {
        const i = this.hPop();
        if (DN[i] === gen) continue;
        DN[i] = gen;
        const gx = i % W,
          gz = (i - gx) / W;
        const di = D[i];
        for (let k = 0; k < 8; k++) {
          const nx = gx + DX[k],
            nz = gz + DZ[k];
          if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
          const j = nz * W + nx;
          if (DN[j] === gen || !this.walkable(j, size)) continue;
          if (k >= 4 && (!this.walkable(gz * W + nx, size) || !this.walkable(nz * W + gx, size))) continue;
          const nd = di + (k >= 4 ? SQ2 : 1);
          if (nd >= D[j]) continue;
          D[j] = nd;
          if (SE[j] === gen) this.hDecrease(j, nd);
          else {
            SE[j] = gen;
            this.hPush(j, nd);
          }
        }
      }
      // 每格的方向：往距離最小的鄰格（不切角；不可通行的格子也指向最近的可通行鄰格，被擠進去的單位能走出來）
      for (let i = 0; i < N; i++) {
        if (i === g) continue;
        const gx = i % W,
          gz = (i - gx) / W;
        const inside = D[i] < Infinity;
        let bd = inside ? D[i] : Infinity,
          bk = -1;
        for (let k = 0; k < 8; k++) {
          const nx = gx + DX[k],
            nz = gz + DZ[k];
          if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
          const j = nz * W + nx;
          const dj = D[j];
          if (!(dj < bd)) continue;
          if (inside && k >= 4 && (D[gz * W + nx] === Infinity || D[nz * W + gx] === Infinity)) continue;
          bd = dj;
          bk = k;
        }
        if (bk >= 0) {
          const L = bk >= 4 ? SQ2 : 1;
          VX[i] = DX[bk] / L;
          VZ[i] = DZ[bk] / L;
        }
      }
    }
    const nav = this;
    const S = this.S;
    const F = {
      goal: g,
      size,
      tx,
      tz,
      D,
      dist(x, z) {
        const i = nav.cellOf(x, z);
        return i < 0 ? Infinity : D[i] * cell;
      },
      dir(x, z, out = {}) {
        const i = nav.cellOf(x, z);
        if (i < 0 || g < 0) return null;
        if (i === g) return null;
        // 快到了（2 格內）且視線通：直接對準目標點
        if (D[i] <= 2.5 && nav.lineClear(x, z, F.tx, F.tz, size)) {
          const dx = F.tx - x,
            dz = F.tz - z,
            L = Math.hypot(dx, dz);
          if (L < 0.3) return null;
          out.x = dx / L;
          out.z = dz / L;
          return out;
        }
        // 周圍 4 格的方向雙線性內插（同一路徑的格子才算），讓轉向平順
        const fx = (x + S) / cell - 0.5,
          fz = (z + S) / cell - 0.5;
        const ix = Math.floor(fx),
          iz = Math.floor(fz),
          u = fx - ix,
          v = fz - iz;
        let vx = 0,
          vz = 0;
        for (let q = 0; q < 4; q++) {
          const cx = ix + (q & 1),
            cz = iz + (q >> 1);
          if (cx < 0 || cz < 0 || cx >= W || cz >= W) continue;
          const j = cz * W + cx;
          if (D[j] === Infinity && j !== i) continue;
          const w = (q & 1 ? u : 1 - u) * (q >> 1 ? v : 1 - v);
          vx += VX[j] * w;
          vz += VZ[j] * w;
        }
        let L = Math.hypot(vx, vz);
        if (L < 1e-4) {
          vx = VX[i];
          vz = VZ[i];
          L = Math.hypot(vx, vz);
          if (L < 1e-4) return null;
        }
        out.x = vx / L;
        out.z = vz / L;
        return out;
      },
    };
    this.flows.set(key, F);
    while (this.flows.size > 24) this.flows.delete(this.flows.keys().next().value);
    return F;
  }
}
