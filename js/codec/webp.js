// 動畫 WebP：每格的變化矩形交給 canvas.toBlob('image/webp') 壓縮，再組成 VP8X + ANIM + ANMF

import { diffRect } from './png.js';

export function canEncodeWebP() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    return c.toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
}

const ascii = s => Uint8Array.from(s, c => c.charCodeAt(0));
function le(n, bytes) {
  const out = new Uint8Array(bytes);
  for (let i = 0; i < bytes; i++) out[i] = (n >>> (8 * i)) & 255;
  return out;
}
function concat(parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function riffChunk(type, data) {
  const pad = data.length & 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concat([ascii(type), le(data.length, 4), data, pad]);
}

// toBlob 的單張 WebP → 取出影像資料 chunk（ALPH + VP8，或 VP8L）
function extractImageChunks(bytes) {
  const out = [];
  let o = 12;
  while (o + 8 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(o, o + 4));
    const size = bytes[o + 4] | (bytes[o + 5] << 8) | (bytes[o + 6] << 16) | (bytes[o + 7] << 24);
    const padded = size + (size & 1);
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L') out.push(bytes.subarray(o, o + 8 + padded));
    o += 8 + padded;
  }
  return concat(out);
}

export class WebpWriter {
  constructor({ width, height, fps, plays, quality }) {
    Object.assign(this, { width, height, fps, plays, quality });
    this.frames = []; // { x, y, w, h, data, frames }
    this.prev = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  async addFrame(imageData) {
    const W = this.width, H = this.height;
    const buf = imageData.data;
    let rect = { x: 0, y: 0, w: W, h: H };
    if (this.prev) {
      rect = diffRect(this.prev, buf, W, H, 4);
      if (!rect) { this.frames[this.frames.length - 1].frames++; return false; }
      // ANMF 的座標以 2px 為單位
      const x0 = rect.x & ~1, y0 = rect.y & ~1;
      rect = { x: x0, y: y0, w: Math.min(W - x0, rect.w + rect.x - x0), h: Math.min(H - y0, rect.h + rect.y - y0) };
    }
    this.prev = buf.slice();
    this.canvas.width = rect.w;
    this.canvas.height = rect.h;
    this.ctx.putImageData(imageData, -rect.x, -rect.y, rect.x, rect.y, rect.w, rect.h);
    const blob = await new Promise(r => this.canvas.toBlob(r, 'image/webp', this.quality));
    if (!blob || blob.type !== 'image/webp') throw new Error('webp-unsupported');
    const data = extractImageChunks(new Uint8Array(await blob.arrayBuffer()));
    this.frames.push({ ...rect, data, frames: 1 });
    return true;
  }

  finish() {
    const W = this.width, H = this.height;
    const vp8x = concat([new Uint8Array([0x12, 0, 0, 0]), le(W - 1, 3), le(H - 1, 3)]); // animation + alpha
    const anim = concat([le(0, 4), le(this.plays, 2)]);
    const parts = [riffChunk('VP8X', vp8x), riffChunk('ANIM', anim)];
    let elapsed = 0;
    for (const f of this.frames) {
      const start = Math.round((elapsed / this.fps) * 1000);
      elapsed += f.frames;
      const dur = Math.round((elapsed / this.fps) * 1000) - start;
      const head = concat([le(f.x / 2, 3), le(f.y / 2, 3), le(f.w - 1, 3), le(f.h - 1, 3), le(dur, 3), new Uint8Array([0x02])]); // no blend, no dispose
      parts.push(riffChunk('ANMF', concat([head, f.data])));
    }
    const body = concat([ascii('WEBP'), ...parts]);
    return new Blob([ascii('RIFF'), le(body.length, 4), body], { type: 'image/webp' });
  }
}
