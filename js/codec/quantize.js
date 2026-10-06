// 256 色調色盤：先統計所有影格的顏色，不超過 255 色就原樣保留（無損），否則用 median cut 減色
// 索引 0 固定為完全透明

const MAX_KEYS = 400000;

export class PaletteBuilder {
  constructor() {
    this.counts = new Map();
    this.overflow = false;
  }

  add(data) {
    const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    const counts = this.counts;
    let last = -1, lastCount = 0;
    const flush = () => { if (last >= 0) counts.set(last, (counts.get(last) || 0) + lastCount); };
    for (let i = 0; i < px.length; i++) {
      let k = px[i];
      if ((k >>> 24) === 0) continue; // 透明像素不列入
      k >>>= 0;
      if (k === last) { lastCount++; continue; }
      flush();
      if (!counts.has(k) && counts.size >= MAX_KEYS) { this.overflow = true; last = -1; continue; }
      last = k; lastCount = 1;
    }
    flush();
  }

  build() {
    const keys = [...this.counts.keys()];
    const palette = new Uint8Array(256 * 4); // index 0 = (0,0,0,0)
    if (keys.length <= 255 && !this.overflow) {
      keys.forEach((k, i) => writeKey(palette, i + 1, k));
      return { palette: palette.slice(0, (keys.length + 1) * 4), lossless: true };
    }
    const n = keys.length;
    const ch = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    const w = new Float64Array(n);
    keys.forEach((k, i) => {
      ch[0][i] = k & 255; ch[1][i] = (k >>> 8) & 255; ch[2][i] = (k >>> 16) & 255; ch[3][i] = k >>> 24;
      w[i] = this.counts.get(k);
    });
    let boxes = [makeBox(Uint32Array.from({ length: n }, (_, i) => i), ch, w)];
    while (boxes.length < 255) {
      let bi = -1, bestScore = 0;
      boxes.forEach((b, i) => {
        if (b.idx.length < 2) return;
        const score = b.span * Math.sqrt(b.weight);
        if (score > bestScore) { bestScore = score; bi = i; }
      });
      if (bi < 0) break;
      const [a, b] = splitBox(boxes[bi], ch, w);
      boxes.splice(bi, 1, a, b);
    }
    boxes.forEach((b, i) => {
      let r = 0, g = 0, bl = 0, al = 0, tw = 0;
      for (const j of b.idx) {
        const ww = w[j] * (ch[3][j] + 1);
        r += ch[0][j] * ww; g += ch[1][j] * ww; bl += ch[2][j] * ww; tw += ww;
        al += ch[3][j] * w[j];
      }
      const o = (i + 1) * 4;
      palette[o] = Math.round(r / tw); palette[o + 1] = Math.round(g / tw); palette[o + 2] = Math.round(bl / tw);
      palette[o + 3] = Math.round(al / b.weight);
    });
    return { palette: palette.slice(0, (boxes.length + 1) * 4), lossless: false };
  }
}

function writeKey(p, i, k) {
  p[i * 4] = k & 255; p[i * 4 + 1] = (k >>> 8) & 255; p[i * 4 + 2] = (k >>> 16) & 255; p[i * 4 + 3] = k >>> 24;
}

// 透明度差異的影響比色彩大，乘上權重
const CH_WEIGHT = [1, 1.2, 0.8, 2];

function makeBox(idx, ch, w) {
  let weight = 0;
  const lo = [255, 255, 255, 255], hi = [0, 0, 0, 0];
  for (const j of idx) {
    weight += w[j];
    for (let c = 0; c < 4; c++) {
      const v = ch[c][j];
      if (v < lo[c]) lo[c] = v;
      if (v > hi[c]) hi[c] = v;
    }
  }
  let axis = 0, span = -1;
  for (let c = 0; c < 4; c++) {
    const s = (hi[c] - lo[c]) * CH_WEIGHT[c];
    if (s > span) { span = s; axis = c; }
  }
  return { idx, weight, axis, span };
}

function splitBox(box, ch, w) {
  const vals = ch[box.axis];
  const sorted = Array.from(box.idx).sort((a, b) => vals[a] - vals[b]);
  let acc = 0, cut = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    acc += w[sorted[i]];
    if (acc >= box.weight / 2) { cut = i + 1; break; }
    cut = i + 1;
  }
  return [makeBox(Uint32Array.from(sorted.slice(0, cut)), ch, w), makeBox(Uint32Array.from(sorted.slice(cut)), ch, w)];
}

export class PaletteMapper {
  constructor(palette) {
    this.palette = palette;
    this.n = palette.length / 4;
    this.cache = new Map();
    // 先算好預乘後的值
    this.pm = new Float32Array(this.n * 4);
    for (let i = 0; i < this.n; i++) {
      const a = palette[i * 4 + 3] / 255;
      this.pm[i * 4] = palette[i * 4] * a;
      this.pm[i * 4 + 1] = palette[i * 4 + 1] * a;
      this.pm[i * 4 + 2] = palette[i * 4 + 2] * a;
      this.pm[i * 4 + 3] = palette[i * 4 + 3];
    }
  }

  nearest(k) {
    const a = (k >>> 24) / 255;
    const r = (k & 255) * a, g = ((k >>> 8) & 255) * a, b = ((k >>> 16) & 255) * a, al = k >>> 24;
    let best = 0, bd = Infinity;
    const pm = this.pm;
    for (let i = 1; i < this.n; i++) {
      const dr = pm[i * 4] - r, dg = pm[i * 4 + 1] - g, db = pm[i * 4 + 2] - b, da = pm[i * 4 + 3] - al;
      const d = dr * dr + dg * dg * 1.4 + db * db * 0.7 + da * da * 2;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  map(data) {
    const px = new Uint32Array(data.buffer, data.byteOffset, data.length >> 2);
    const out = new Uint8Array(px.length);
    const cache = this.cache;
    let lastK = -1, lastI = 0;
    for (let i = 0; i < px.length; i++) {
      const k = px[i] >>> 0;
      if ((k >>> 24) === 0) { out[i] = 0; continue; }
      if (k === lastK) { out[i] = lastI; continue; }
      let idx = cache.get(k);
      if (idx === undefined) { idx = this.nearest(k); cache.set(k, idx); }
      out[i] = idx; lastK = k; lastI = idx;
    }
    return out;
  }
}
