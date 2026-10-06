// PNG / APNG 編碼：自行組 chunk，壓縮交給瀏覽器內建的 CompressionStream（zlib 格式）

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

export const canCompress = () => typeof CompressionStream === 'function';

export async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function u32(...vals) {
  const out = new Uint8Array(vals.length * 4);
  const v = new DataView(out.buffer);
  vals.forEach((n, i) => v.setUint32(i * 4, n));
  return out;
}

function ihdr(w, h, colorType) {
  const d = new Uint8Array(13);
  const v = new DataView(d.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  d[8] = 8;
  d[9] = colorType;
  return d;
}

// RGBA 的一個矩形 → 加上濾波位元組的列資料。每列從 None/Sub/Up/Paeth 中挑變化量最小的濾波器
function filterRGBA(rgba, stride, x, y, w, h) {
  const rowLen = w * 4;
  const out = new Uint8Array(h * (rowLen + 1));
  const prev = new Uint8Array(rowLen);
  const cur = new Uint8Array(rowLen);
  const cand = [new Uint8Array(rowLen), new Uint8Array(rowLen), new Uint8Array(rowLen), new Uint8Array(rowLen)];
  const [c0, c1, c2, c3] = cand;
  const sums = [0, 0, 0, 0];
  for (let r = 0; r < h; r++) {
    const start = ((y + r) * stride + x) * 4;
    cur.set(rgba.subarray(start, start + rowLen));
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
    for (let i = 0; i < rowLen; i++) {
      const v = cur[i];
      const a = i >= 4 ? cur[i - 4] : 0;
      const b = prev[i];
      const c = i >= 4 ? prev[i - 4] : 0;
      const p = a + b - c;
      const pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v1 = (v - a) & 255, v2 = (v - b) & 255, v3 = (v - pred) & 255;
      c0[i] = v; c1[i] = v1; c2[i] = v2; c3[i] = v3;
      s0 += v < 128 ? v : 256 - v;
      s1 += v1 < 128 ? v1 : 256 - v1;
      s2 += v2 < 128 ? v2 : 256 - v2;
      s3 += v3 < 128 ? v3 : 256 - v3;
    }
    sums[0] = s0; sums[1] = s1; sums[2] = s2; sums[3] = s3;
    let best = 0;
    for (let f = 1; f < 4; f++) if (sums[f] < sums[best]) best = f;
    const o = r * (rowLen + 1);
    out[o] = [0, 1, 2, 4][best];
    out.set(cand[best], o + 1);
    prev.set(cur);
  }
  return out;
}

// 調色盤索引圖：濾波一律用 None（PNG 規範對索引圖的建議）
function filterIndexed(idx, stride, x, y, w, h) {
  const out = new Uint8Array(h * (w + 1));
  for (let r = 0; r < h; r++) {
    const start = (y + r) * stride + x;
    out.set(idx.subarray(start, start + w), r * (w + 1) + 1);
  }
  return out;
}

export async function encodePNG(imageData) {
  const { width: w, height: h, data } = imageData;
  const idat = await deflate(filterRGBA(data, w, 0, 0, w, h));
  return new Blob([SIGNATURE, chunk('IHDR', ihdr(w, h, 6)), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}

// 逐格加入的 APNG 組裝器
// mode: 'rgba' | 'indexed'（indexed 時需提供 palette: Uint8Array RGBA × n）
export class ApngWriter {
  constructor({ width, height, fps, plays, mode, palette }) {
    Object.assign(this, { width, height, fps, plays, mode, palette });
    this.parts = [];
    this.seq = 0;
    this.frames = []; // { x, y, w, h, data(壓縮後), delay }
    this.poster = null;
    this.prev = null;
  }

  async setPoster(buf) {
    this.poster = await this.compress(buf, 0, 0, this.width, this.height);
  }

  compress(buf, x, y, w, h) {
    const rows = this.mode === 'indexed' ? filterIndexed(buf, this.width, x, y, w, h) : filterRGBA(buf, this.width, x, y, w, h);
    return deflate(rows);
  }

  // buf：整張畫布大小的 RGBA(Uint8ClampedArray) 或索引(Uint8Array)。回傳是否新增了影格（相同影格會合併）
  async addFrame(buf) {
    const W = this.width, H = this.height;
    let rect = { x: 0, y: 0, w: W, h: H };
    if (this.prev) {
      rect = diffRect(this.prev, buf, W, H, this.mode === 'indexed' ? 1 : 4);
      if (!rect) {
        this.frames[this.frames.length - 1].delay++;
        return false;
      }
    }
    this.prev = buf.slice();
    const data = await this.compress(buf, rect.x, rect.y, rect.w, rect.h);
    this.frames.push({ ...rect, data, delay: 1 });
    return true;
  }

  finish() {
    const W = this.width, H = this.height;
    const colorType = this.mode === 'indexed' ? 3 : 6;
    const out = [SIGNATURE, chunk('IHDR', ihdr(W, H, colorType))];
    out.push(chunk('acTL', u32(this.frames.length, this.plays)));
    if (this.mode === 'indexed') {
      const n = this.palette.length / 4;
      const plte = new Uint8Array(n * 3), trns = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        plte[i * 3] = this.palette[i * 4];
        plte[i * 3 + 1] = this.palette[i * 4 + 1];
        plte[i * 3 + 2] = this.palette[i * 4 + 2];
        trns[i] = this.palette[i * 4 + 3];
      }
      out.push(chunk('PLTE', plte), chunk('tRNS', trns));
    }
    if (this.poster) out.push(chunk('IDAT', this.poster));
    this.frames.forEach((f, i) => {
      const fc = new Uint8Array(26);
      const v = new DataView(fc.buffer);
      v.setUint32(0, this.seq++);
      v.setUint32(4, f.w);
      v.setUint32(8, f.h);
      v.setUint32(12, f.x);
      v.setUint32(16, f.y);
      // 影格數 / FPS 直接當作分數，避免四捨五入誤差累積
      let num = f.delay, den = this.fps;
      while (num > 65535) { num = Math.round(num / 2); den = Math.max(1, Math.round(den / 2)); }
      v.setUint16(20, num);
      v.setUint16(22, den);
      fc[24] = 0; // dispose: NONE
      fc[25] = 0; // blend: SOURCE（矩形內整塊取代，含透明度）
      out.push(chunk('fcTL', fc));
      if (i === 0 && !this.poster) {
        out.push(chunk('IDAT', f.data));
      } else {
        const fd = new Uint8Array(4 + f.data.length);
        new DataView(fd.buffer).setUint32(0, this.seq++);
        fd.set(f.data, 4);
        out.push(chunk('fdAT', fd));
      }
    });
    out.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(out, { type: 'image/apng' });
  }
}

// 兩張畫面的差異矩形（沒有差異回傳 null）
export function diffRect(a, b, W, H, bpp) {
  const A = bpp === 4 ? new Uint32Array(a.buffer, a.byteOffset, W * H) : a;
  const B = bpp === 4 ? new Uint32Array(b.buffer, b.byteOffset, W * H) : b;
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x0 = -1;
    for (let x = 0; x < W; x++) if (A[row + x] !== B[row + x]) { x0 = x; break; }
    if (x0 < 0) continue;
    let x1 = x0;
    for (let x = W - 1; x > x0; x--) if (A[row + x] !== B[row + x]) { x1 = x; break; }
    if (y < minY) minY = y;
    maxY = y;
    if (x0 < minX) minX = x0;
    if (x1 > maxX) maxX = x1;
  }
  if (maxY < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}
