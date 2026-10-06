// 輸出：APNG / WebP / PNG 靜態圖 / PNG 序列
// 流程：（需要時）先分析全部影格的顏色與非透明範圍 → 再逐格產生檔案

import { Renderer } from './engine/render.js';
import { ApngWriter, encodePNG, canCompress } from './codec/png.js';
import { PaletteBuilder, PaletteMapper } from './codec/quantize.js';
import { WebpWriter, canEncodeWebP } from './codec/webp.js';
import { ZipWriter } from './codec/zip.js';
import { yieldToUI } from './util.js';

export const MAX_FRAMES = 1500;
export { canCompress, canEncodeWebP };

export class Cancelled extends Error {}

function makeRenderer(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = scene.layout.W;
  canvas.height = scene.layout.H;
  canvas.getContext('2d', { willReadFrequently: true });
  return new Renderer(canvas);
}

export const frameCount = (scene, fps) => Math.max(1, Math.round(scene.timeline.duration * fps));

function plays(opts) {
  return opts.loop === 'infinite' ? 0 : opts.loop === 'count' ? Math.max(1, Math.min(65535, opts.loopCount | 0)) : 1;
}

// 所有影格中有畫到東西的範圍
function opaqueBounds(data, W, H, acc) {
  const px = new Uint32Array(data.buffer, data.byteOffset, W * H);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let x0 = -1;
    for (let x = 0; x < W; x++) if (px[row + x] >>> 24) { x0 = x; break; }
    if (x0 < 0) continue;
    let x1 = x0;
    for (let x = W - 1; x > x0; x--) if (px[row + x] >>> 24) { x1 = x; break; }
    if (x0 < acc.x0) acc.x0 = x0;
    if (x1 > acc.x1) acc.x1 = x1;
    if (y < acc.y0) acc.y0 = y;
    if (y > acc.y1) acc.y1 = y;
  }
}

async function analyze(scene, r, times, opts, extraTimes) {
  const { W, H } = scene.layout;
  const acc = { x0: W, y0: H, x1: -1, y1: -1 };
  const pal = opts.palette ? new PaletteBuilder() : null;
  const all = [...times, ...extraTimes];
  for (let i = 0; i < all.length; i++) {
    if (opts.signal?.cancelled) throw new Cancelled();
    r.render(scene, all[i]);
    const data = r.ctx.getImageData(0, 0, W, H).data;
    if (opts.trim) opaqueBounds(data, W, H, acc);
    if (pal) pal.add(data);
    if (i % 4 === 0) { opts.onProgress?.('analyze', i + 1, all.length); await yieldToUI(); }
  }
  let rect = { x: 0, y: 0, w: W, h: H };
  if (opts.trim && acc.x1 >= 0) {
    const pad = 2;
    const x = Math.max(0, acc.x0 - pad), y = Math.max(0, acc.y0 - pad);
    rect = { x, y, w: Math.min(W, acc.x1 + pad + 1) - x, h: Math.min(H, acc.y1 + pad + 1) - y };
  }
  return { rect, palette: pal ? pal.build() : null };
}

// format: 'apng' | 'webp'
// opts: { fps, loop, loopCount, palette(bool), poster(bool), trim(bool), signal, onProgress(stage, i, n) }
export async function exportAnimation(scene, format, opts) {
  const fps = opts.fps;
  const n = frameCount(scene, fps);
  if (n > MAX_FRAMES) { const e = new Error('too-many-frames'); e.frames = n; throw e; }
  const times = Array.from({ length: n }, (_, i) => i / fps);
  const r = makeRenderer(scene);
  const { W, H } = scene.layout;
  const usePalette = format === 'apng' && opts.palette;
  const usePoster = format === 'apng' && opts.poster;
  let rect = { x: 0, y: 0, w: W, h: H };
  let palette = null;
  if (opts.trim || usePalette) {
    const res = await analyze(scene, r, times, { ...opts, palette: usePalette }, usePoster ? [scene.timeline.posterTime] : []);
    rect = res.rect;
    palette = res.palette;
  }
  const grab = t => { r.render(scene, t); return r.ctx.getImageData(rect.x, rect.y, rect.w, rect.h); };
  const mapper = palette ? new PaletteMapper(palette.palette) : null;
  const toBuf = img => (mapper ? mapper.map(img.data) : img.data);
  const loopPlays = plays(opts);
  let writer;
  if (format === 'webp') writer = new WebpWriter({ width: rect.w, height: rect.h, fps, plays: loopPlays, quality: opts.quality ?? 0.92 });
  else {
    writer = new ApngWriter({ width: rect.w, height: rect.h, fps, plays: loopPlays, mode: mapper ? 'indexed' : 'rgba', palette: palette?.palette });
    if (usePoster) await writer.setPoster(toBuf(grab(scene.timeline.posterTime)));
  }
  for (let i = 0; i < n; i++) {
    if (opts.signal?.cancelled) throw new Cancelled();
    const img = grab(times[i]);
    if (format === 'webp') await writer.addFrame(img);
    else await writer.addFrame(toBuf(img));
    opts.onProgress?.('encode', i + 1, n);
    if (i % 2 === 0) await yieldToUI();
  }
  const blob = writer.finish();
  return { blob, width: rect.w, height: rect.h, frames: n, stored: writer.frames.length, lossless: palette?.lossless ?? true, palette: Boolean(mapper) };
}

export async function exportStill(scene, t, trim) {
  const r = makeRenderer(scene);
  const { W, H } = scene.layout;
  r.render(scene, t);
  let img = r.ctx.getImageData(0, 0, W, H);
  let w = W, h = H;
  if (trim) {
    const acc = { x0: W, y0: H, x1: -1, y1: -1 };
    opaqueBounds(img.data, W, H, acc);
    if (acc.x1 >= 0) {
      const x = Math.max(0, acc.x0 - 2), y = Math.max(0, acc.y0 - 2);
      w = Math.min(W, acc.x1 + 3) - x; h = Math.min(H, acc.y1 + 3) - y;
      img = r.ctx.getImageData(x, y, w, h);
    }
  }
  return { blob: await encodePNG(img), width: w, height: h };
}

export async function exportSequence(scene, opts, baseName) {
  const fps = opts.fps;
  const n = frameCount(scene, fps);
  if (n > MAX_FRAMES) { const e = new Error('too-many-frames'); e.frames = n; throw e; }
  const r = makeRenderer(scene);
  const { W, H } = scene.layout;
  const times = Array.from({ length: n }, (_, i) => i / fps);
  let rect = { x: 0, y: 0, w: W, h: H };
  if (opts.trim) rect = (await analyze(scene, r, times, opts, [])).rect;
  const zip = new ZipWriter();
  const digits = String(n).length < 4 ? 4 : String(n).length;
  for (let i = 0; i < n; i++) {
    if (opts.signal?.cancelled) throw new Cancelled();
    r.render(scene, times[i]);
    const png = await encodePNG(r.ctx.getImageData(rect.x, rect.y, rect.w, rect.h));
    await zip.add(`${baseName}_${String(i).padStart(digits, '0')}.png`, png);
    opts.onProgress?.('zip', i + 1, n);
    if (i % 2 === 0) await yieldToUI();
  }
  return { blob: zip.finish(), width: rect.w, height: rect.h, frames: n };
}

export { ZipWriter };
