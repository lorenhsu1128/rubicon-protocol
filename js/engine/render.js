// 描繪：給定場景與時間，畫出一張畫面。同樣的時間一定畫出同樣的結果（預覽 = 輸出）

import { IN, OUT, HOLD, newT, glowMultiplier } from './effects.js';
import { layoutScene } from './layout.js';
import { buildTimeline } from './timeline.js';
import { EASE, TAU, clamp, hash, hashSigned, rgba } from '../util.js';

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');
const FILTER_OK = typeof measureCtx.filter === 'string';

// opts: { text, subText }（批次輸出時覆寫文字）
export function createScene(state, flags = { entry: true, exit: true }, opts = {}) {
  const layout = layoutScene(measureCtx, state, opts);
  const timeline = buildTimeline(state, layout, flags);
  return { state, layout, timeline, flags, sprites: new Map() };
}

const ease = (name, fallback) => EASE[name === 'auto' || !name ? fallback : name] || EASE.out;

export function activePage(scene, t) {
  const pts = scene.timeline.pageTimes;
  let idx = 0;
  for (let i = 0; i < pts.length; i++) if (t >= pts[i].start) idx = i;
  return idx;
}

/* ---------- 文字的小圖（sprite） ---------- */

function makeSprite(scene, g, size, variant) {
  const key = `${g.gi}|${size.toFixed(2)}|${variant}`;
  const hit = scene.sprites.get(key);
  if (hit) return hit;
  let canvas;
  if (variant !== 'base') {
    const base = makeSprite(scene, g, size, 'base');
    canvas = document.createElement('canvas');
    canvas.width = base.width; canvas.height = base.height;
    const c = canvas.getContext('2d');
    c.drawImage(base, 0, 0);
    c.globalCompositeOperation = 'source-in';
    const s = scene.state;
    c.fillStyle = variant === 'white' ? '#ffffff' : variant === 'tintA' ? s.glitchColor : s.glitchColor2;
    c.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    canvas = drawGlyphSprite(scene, g, size);
  }
  scene.sprites.set(key, canvas);
  return canvas;
}

function drawGlyphSprite(scene, g, size) {
  const s = scene.state;
  const layout = scene.layout;
  const isSub = g.role === 'sub';
  const k = isSub ? Math.max(0.35, g.size / layout.size) : size / g.size;
  const sw1 = s.stroke.on ? s.stroke.width * k : 0;
  const sw2 = s.stroke2.on ? s.stroke2.width * k : 0;
  const font = g.font.replace(/[\d.]+px/, `${size.toFixed(2)}px`);
  measureCtx.font = font;
  measureCtx.textAlign = 'center';
  measureCtx.textBaseline = 'middle';
  const m = measureCtx.measureText(g.ch);
  const pad = Math.ceil(sw1 + sw2 + 3 + size * 0.06);
  const hw = Math.max(m.actualBoundingBoxLeft || 0, m.actualBoundingBoxRight || 0, size * 0.5) + pad;
  const hh = Math.max(m.actualBoundingBoxAscent || 0, m.actualBoundingBoxDescent || 0, size * 0.5) + pad;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(hw * 2));
  canvas.height = Math.max(1, Math.ceil(hh * 2));
  const c = canvas.getContext('2d');
  const cx = canvas.width / 2, cy = canvas.height / 2;
  c.font = font;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.miterLimit = 2;
  if (sw2) { c.strokeStyle = s.stroke2.color; c.lineWidth = 2 * (sw1 + sw2); c.strokeText(g.ch, cx, cy); }
  if (sw1) { c.strokeStyle = s.stroke.color; c.lineWidth = 2 * sw1; c.strokeText(g.ch, cx, cy); }
  c.globalAlpha = s.fillOpacity;
  c.fillStyle = fillStyle(c, scene, g, size, cx, cy, isSub);
  c.fillText(g.ch, cx, cy);
  return canvas;
}

function fillStyle(c, scene, g, size, cx, cy, isSub) {
  const s = scene.state;
  if (isSub && s.subColorOn) return s.subColor;
  const f = s.fill;
  if (f.type !== 'gradient') return f.color;
  const scale = size / g.size;
  const b = scene.layout.groups[g.group].bounds;
  let grad;
  if (f.dir === 'h') {
    // 直排的字已旋轉 → 用相對座標換算
    grad = c.createLinearGradient(cx + (b.x - g.x) * scale, 0, cx + (b.x + b.w - g.x) * scale, 0);
  } else if (f.dir === 'd') {
    grad = c.createLinearGradient(cx + (b.x - g.x) * scale, cy + (b.y - g.y) * scale, cx + (b.x + b.w - g.x) * scale, cy + (b.y + b.h - g.y) * scale);
  } else {
    grad = c.createLinearGradient(0, cy - size / 2, 0, cy + size / 2);
  }
  grad.addColorStop(0, f.color);
  if (f.color3) { grad.addColorStop(0.5, f.color2); grad.addColorStop(1, f.color3); } else grad.addColorStop(1, f.color2);
  return grad;
}

/* ---------- 每個字在時間 t 的狀態 ---------- */

function glyphTransform(scene, g, t) {
  const s = scene.state;
  const tl = scene.timeline;
  const layout = scene.layout;
  const group = layout.groups[g.group];
  const T = newT();
  const ctx = { i: g.i, n: g.n, rx: g.x - group.bounds.cx, ry: g.y - group.bounds.cy, em: g.size, vertical: layout.vertical, block: group.bounds };
  if (t < g.showFrom || t >= g.hideAt) return null;

  if (tl.scroll) {
    const sc = tl.scroll;
    const off = sc.from + (sc.to - sc.from) * clamp((t - sc.start) / sc.moveDur);
    if (sc.vertical) T.x += off; else T.y += off;
    if (s.scrollFade) {
      const pos = sc.vertical ? g.x + off : g.y + off;
      const span = sc.vertical ? layout.W : layout.H;
      const fz = span * 0.12;
      T.a *= clamp(pos / fz) * clamp((span - pos) / fz);
    }
    applyHold(s, T, ctx, t, 1);
    return T;
  }

  const sp = g.special;
  if (sp && sp.kind === 'spread') {
    if (t < sp.start) return null;
    const k = t < sp.move ? 0 : EASE.smooth(clamp((t - sp.move) / (sp.end - sp.move)));
    T.x -= ctx.rx * (1 - k);
    T.y -= ctx.ry * (1 - k);
    T.a *= clamp((t - sp.start) / 0.25);
  } else if (t < g.inStart) {
    return null;
  } else if (t < g.inEnd && g.inFx) {
    const r = (t - g.inStart) / (g.inEnd - g.inStart);
    if (g.inFx.id === 'land') {
      const e = EASE.out(r);
      T.s *= 1 + 0.35 * g.inFx.power * (1 - e);
      T.x += ctx.rx * 0.35 * g.inFx.power * (1 - e);
      T.y += ctx.ry * 0.35 * g.inFx.power * (1 - e);
      const f = Math.floor(t * 30);
      T.x += hashSigned(f, 1) * 0.06 * g.size * g.inFx.power * (1 - r);
      T.y += hashSigned(f, 2) * 0.06 * g.size * g.inFx.power * (1 - r);
      T.a *= clamp(r * 5);
    } else {
      const def = IN[g.inFx.id] || IN.fade;
      const dir = def.dirs && !def.dirs.includes(g.inFx.dir) ? def.dirs[0] : g.inFx.dir;
      def.apply(T, ease(g.inFx.ease, def.ease)(clamp(r)), clamp(r), ctx, { power: g.inFx.power, dir, t });
    }
  }

  if (g.outFx && t >= g.outStart) {
    if (t >= g.outEnd) return null;
    const def = OUT[g.outFx.id] || OUT.fade;
    const r = clamp((t - g.outStart) / (g.outEnd - g.outStart));
    const dir = def.dirs && !def.dirs.includes(g.outFx.dir) ? def.dirs[0] : g.outFx.dir;
    def.apply(T, ease(g.outFx.ease, def.ease)(r), r, ctx, { power: g.outFx.power, dir, t });
  }

  if (t >= g.inEnd) {
    const e = clamp(Math.min((t - g.inEnd) / 0.3, (g.outStart - t) / 0.3));
    applyHold(s, T, ctx, t, e);
  }
  return T.a <= 0.002 ? null : T;
}

function applyHold(s, T, ctx, t, e) {
  const fn = HOLD[s.holdFx];
  if (fn && e > 0) fn(T, ctx, { power: s.holdPower, t }, e);
}

/* ---------- 描繪器 ---------- */

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.lctx = this.layer.getContext('2d');
    this.scratch = document.createElement('canvas');
    this.sctx = this.scratch.getContext('2d');
  }

  resize(W, H) {
    for (const c of [this.canvas, this.layer, this.scratch]) {
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
    }
  }

  render(scene, t) {
    const { W, H } = scene.layout;
    this.resize(W, H);
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const s = scene.state;
    const page = activePage(scene, t);
    const env = envelope(scene, t);
    if (s.bg.type !== 'none') this.drawBackground(scene, s.bg.sync ? env : 1);
    if (s.deco.type !== 'none') this.drawDeco(scene, t, page);
    this.drawText(scene, t, page);
  }

  drawBackground(scene, env) {
    const { W, H } = scene.layout;
    const bg = scene.state.bg;
    const ctx = this.ctx;
    const a = bg.opacity * env;
    if (a <= 0) return;
    let style;
    if (bg.type === 'solid') style = rgba(bg.color, a);
    else if (bg.type === 'vignette') {
      style = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.hypot(W, H) / 2);
      style.addColorStop(0, rgba(bg.color, 0));
      style.addColorStop(1, rgba(bg.color, a));
    } else {
      const top = bg.type === 'top';
      style = ctx.createLinearGradient(0, top ? 0 : H, 0, top ? H * 0.6 : H * 0.4);
      style.addColorStop(0, rgba(bg.color, a));
      style.addColorStop(1, rgba(bg.color, 0));
    }
    ctx.fillStyle = style;
    ctx.fillRect(0, 0, W, H);
  }

  drawText(scene, t, page) {
    const s = scene.state;
    const { W, H, glyphs } = scene.layout;
    const L = this.lctx;
    L.setTransform(1, 0, 0, 1, 0, 0);
    L.clearRect(0, 0, W, H);
    let any = false;
    for (const g of glyphs) {
      if (g.special?.kind === 'solo') any = this.drawSolo(scene, g, t) || any;
      const T = glyphTransform(scene, g, t);
      if (!T) continue;
      this.drawGlyph(scene, g, T, t);
      any = true;
    }
    if (s.mode === 'trailer' && s.cursor && s.reveal === 'char' && scene.timeline.entry) any = this.drawCursor(scene, t, page) || any;
    if (!any) return;

    const ctx = this.ctx;
    const OFF = 30000;
    if (s.glow.on) {
      const pt = scene.timeline.pageTimes[page];
      const e = clamp(Math.min((t - pt.holdStart) / 0.3, (pt.holdEnd - t) / 0.3));
      const strength = s.glow.strength * glowMultiplier(s.holdFx, t, s.holdPower, e);
      ctx.save();
      ctx.shadowColor = s.glow.color;
      ctx.shadowBlur = s.glow.size;
      ctx.shadowOffsetX = OFF;
      for (let k = strength; k > 0.01; k -= 1) {
        ctx.globalAlpha = Math.min(1, k);
        ctx.drawImage(this.layer, -OFF, 0);
      }
      ctx.restore();
    }
    if (s.shadow.on && s.shadow.opacity > 0) {
      ctx.save();
      ctx.shadowColor = rgba(s.shadow.color, s.shadow.opacity);
      ctx.shadowBlur = s.shadow.blur;
      ctx.shadowOffsetX = OFF + s.shadow.x;
      ctx.shadowOffsetY = s.shadow.y;
      ctx.drawImage(this.layer, -OFF, 0);
      ctx.restore();
    }
    ctx.drawImage(this.layer, 0, 0);
  }

  drawGlyph(scene, g, T, t) {
    const L = this.lctx;
    const spr = makeSprite(scene, g, g.size, 'base');
    L.save();
    if (T.clip) clipRect(L, scene, g, T.clip);
    const a = clamp(T.a);
    L.globalAlpha = a;
    if (FILTER_OK && T.blur > 0.4) L.filter = `blur(${T.blur.toFixed(1)}px)`;
    L.translate(g.x + T.x, g.y + T.y);
    L.rotate(g.rot + T.rot);
    L.scale(T.s * T.sx, T.s * T.sy);
    const w = spr.width, h = spr.height;
    if (T.glitch > 0.02) {
      const G = Math.min(1.5, T.glitch);
      const f = Math.floor(t * 24);
      const d = G * 0.07 * g.size * (0.6 + hash(f, g.gi, 3));
      L.globalAlpha = a * 0.8;
      L.drawImage(makeSprite(scene, g, g.size, 'tintA'), -w / 2 - d, -h / 2);
      L.drawImage(makeSprite(scene, g, g.size, 'tintB'), -w / 2 + d, -h / 2);
      L.globalAlpha = a;
      const strips = 6;
      for (let k = 0; k < strips; k++) {
        const sy = Math.floor((h * k) / strips), sh = Math.ceil(h / strips);
        const off = hash(f, k, g.gi, 4) < 0.4 * G ? hashSigned(f, k, g.gi, 5) * G * 0.25 * g.size : 0;
        L.drawImage(spr, 0, sy, w, Math.min(sh, h - sy), -w / 2 + off, -h / 2 + sy, w, Math.min(sh, h - sy));
      }
    } else {
      L.drawImage(spr, -w / 2, -h / 2);
    }
    if (T.white > 0.01) {
      L.globalAlpha = a * clamp(T.white);
      L.drawImage(makeSprite(scene, g, g.size, 'white'), -w / 2, -h / 2);
    }
    L.restore();
  }

  // 「中央逐字」：每個字輪流大大地出現在畫面中央
  drawSolo(scene, g, t) {
    const sp = g.special;
    if (t < sp.start || t >= sp.end) return false;
    const s = scene.state;
    const { W, H } = scene.layout;
    const big = s.soloSize * Math.min(W, H);
    const spr = makeSprite(scene, g, big, 'base');
    const u = (t - sp.start) / (sp.end - sp.start);
    const sc = 1.25 - 0.25 * EASE.out(clamp(u / 0.35));
    const a = clamp(u / 0.15) * clamp((1 - u) / 0.2);
    const L = this.lctx;
    L.save();
    L.globalAlpha = a;
    L.translate(W / 2, H / 2);
    L.rotate(g.rot);
    L.scale(sc, sc);
    L.drawImage(spr, -spr.width / 2, -spr.height / 2);
    L.restore();
    return a > 0;
  }

  drawCursor(scene, t, pageIdx) {
    const s = scene.state;
    const layout = scene.layout;
    const pt = scene.timeline.pageTimes[pageIdx];
    if (t < pt.start || t >= pt.holdEnd) return false;
    const group = layout.pages[pageIdx].groups.map(i => layout.groups[i]).find(gr => gr.role === 'main');
    if (!group) return false;
    const gs = group.glyphs.map(i => layout.glyphs[i]);
    let cur = null;
    for (const g of gs) if (g.inStart <= t) cur = g;
    const lastStart = gs.length ? gs[gs.length - 1].inStart : 0;
    const typing = t < lastStart + 0.35;
    if (!typing && (t - pt.start) % 1 >= 0.55) return false;
    const ref = cur || gs[0];
    if (!ref) return false;
    const em = ref.size;
    const L = this.lctx;
    L.save();
    L.fillStyle = s.cursorColor || s.fill.color;
    if (layout.vertical) {
      const y = cur ? ref.y + ref.adv / 2 : ref.y - ref.adv / 2;
      L.fillRect(ref.x - em * 0.45, y + em * 0.04, em * 0.9, em * 0.08);
    } else {
      const x = cur ? ref.x + ref.adv / 2 : ref.x - ref.adv / 2;
      L.fillRect(x + em * 0.04, ref.y - em * 0.45, em * 0.08, em * 0.9);
    }
    L.restore();
    return true;
  }

  /* ---------- 裝飾 ---------- */

  drawDeco(scene, t, pageIdx) {
    const s = scene.state;
    const d = s.deco;
    const layout = scene.layout;
    const tl = scene.timeline;
    const pt = tl.pageTimes[pageIdx];
    const dt = pt.deco;
    if (dt.inStart >= 0 && t < dt.inStart) return;
    if (t >= dt.outEnd) return;
    const inP = dt.inStart < 0 || dt.inDur <= 0 ? 1 : EASE.out(clamp((t - dt.inStart) / dt.inDur));
    const outP = dt.outDur > 0 && dt.outEnd !== Infinity ? EASE.in(clamp((t - (dt.outEnd - dt.outDur)) / dt.outDur)) : 0;
    const vis = clamp(inP * (1 - outP));
    if (vis <= 0) return;
    const grow = d.anim === 'grow' ? vis : 1;
    const alpha = d.anim === 'fade' ? vis : d.anim === 'grow' ? clamp(vis * 3) : 1;

    // 文字範圍（u：沿著文字方向，v：垂直於文字方向）
    const page = layout.pages[pageIdx];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const gi of page.groups) {
      const b = layout.groups[gi].bounds;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    if (!isFinite(x0)) return;
    if (tl.scroll) {
      const sc = tl.scroll;
      const off = sc.from + (sc.to - sc.from) * clamp((t - sc.start) / sc.moveDur);
      if (sc.vertical) { x0 += off; x1 += off; } else { y0 += off; y1 += off; }
    }
    const V = layout.vertical;
    const r = V ? { u0: y0, u1: y1, v0: x0, v1: x1 } : { u0: x0, u1: x1, v0: y0, v1: y1 };
    const U = V ? layout.H : layout.W;
    const em = layout.size;
    const pad = d.pad * em;
    const th = d.thickness;
    const sw = (s.stroke.on ? s.stroke.width : 0) + (s.stroke2.on ? s.stroke2.width : 0);
    const outlineColor = s.stroke2.on ? s.stroke2.color : s.stroke.color;
    const cu = (r.u0 + r.u1) / 2;

    const c = this.sctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, layout.W, layout.H);
    if (V) c.setTransform(0, 1, 1, 0, 0, 0); // (u,v) → (x=v, y=u)
    const bar = (ua, ub, v, thick, color) => {
      if (ub <= ua || thick <= 0) return;
      if (d.outline && sw > 0) { c.fillStyle = outlineColor; c.fillRect(ua - sw, v - thick / 2 - sw, ub - ua + sw * 2, thick + sw * 2); }
      c.fillStyle = color;
      c.fillRect(ua, v - thick / 2, ub - ua, thick);
    };
    const vbar = (u, va, vb, thick, color) => {
      if (vb <= va || thick <= 0) return;
      if (d.outline && sw > 0) { c.fillStyle = outlineColor; c.fillRect(u - thick / 2 - sw, va - sw, thick + sw * 2, vb - va + sw * 2); }
      c.fillStyle = color;
      c.fillRect(u - thick / 2, va, thick, vb - va);
    };
    const fillA = rgba(d.color, d.opacity);

    switch (d.type) {
      case 'band': {
        const va = r.v0 - pad, vb = r.v1 + pad;
        const half = (U / 2) * grow;
        const ua = cu - half, ub = cu + half;
        const soft = d.soft * (vb - va) * 0.5;
        const gv = c.createLinearGradient(0, va, 0, vb);
        const sf = soft / Math.max(1, vb - va);
        gv.addColorStop(0, rgba(d.color, 0));
        gv.addColorStop(clamp(sf, 0, 0.5), fillA);
        gv.addColorStop(clamp(1 - sf, 0.5, 1), fillA);
        gv.addColorStop(1, rgba(d.color, 0));
        if (sf <= 0) { c.fillStyle = fillA; } else c.fillStyle = gv;
        c.fillRect(ua, va, ub - ua, vb - va);
        if (d.sideFade > 0) {
          c.globalCompositeOperation = 'destination-in';
          const gu = c.createLinearGradient(ua, 0, ub, 0);
          const f = d.sideFade * 0.5;
          gu.addColorStop(0, 'rgba(0,0,0,0)');
          gu.addColorStop(f, 'rgba(0,0,0,1)');
          gu.addColorStop(1 - f, 'rgba(0,0,0,1)');
          gu.addColorStop(1, 'rgba(0,0,0,0)');
          c.fillStyle = gu;
          c.fillRect(ua, va, ub - ua, vb - va);
          c.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'tape': {
        const ts = d.tapeSize;
        const half = (U / 2) * grow;
        const ua = cu - half, ub = cu + half;
        const blink = 1 - d.tapeBlink * (0.5 - 0.5 * Math.cos(TAU * t / 0.9));
        c.globalAlpha = blink;
        const strip = (va, dirSign) => {
          c.save();
          c.beginPath();
          c.rect(ua, va, ub - ua, ts);
          c.clip();
          c.fillStyle = d.tapeColor;
          c.fillRect(ua, va, ub - ua, ts);
          c.fillStyle = d.tapeStripe;
          const period = ts * 1.2;
          const shift = ((d.tapeSpeed * t * dirSign) % period + period) % period;
          for (let u = ua - ts - period + shift; u < ub + ts; u += period) {
            c.beginPath();
            c.moveTo(u, va + ts);
            c.lineTo(u + period / 2, va + ts);
            c.lineTo(u + period / 2 + ts, va);
            c.lineTo(u + ts, va);
            c.closePath();
            c.fill();
          }
          c.restore();
        };
        strip(r.v0 - pad - ts, 1);
        strip(r.v1 + pad, -1);
        c.globalAlpha = 1;
        break;
      }
      case 'box': {
        const k = 0.85 + 0.15 * grow;
        const cv = (r.v0 + r.v1) / 2;
        const hu = ((r.u1 - r.u0) / 2 + pad) * (d.anim === 'grow' ? grow : 1), hv = ((r.v1 - r.v0) / 2 + pad) * k;
        c.beginPath();
        roundRect(c, cu - hu, cv - hv, hu * 2, hv * 2, Math.min(d.radius * em, hu, hv));
        c.fillStyle = fillA;
        c.fill();
        if (th > 0) { c.lineWidth = th; c.strokeStyle = d.color2; c.stroke(); }
        break;
      }
      case 'frame': {
        const ext = d.extend * em;
        const lo = Math.max(th, r.u0 - pad - ext), hi = Math.min(U - th, r.u1 + pad + ext);
        const ua = cu - (cu - lo) * grow, ub = cu + (hi - cu) * grow;
        const va = r.v0 - pad, vb = r.v1 + pad;
        c.fillStyle = fillA;
        c.fillRect(ua, va, ub - ua, vb - va);
        if (th > 0) {
          bar(ua, ub, va, th, d.color2);
          bar(ua, ub, vb, th, d.color2);
          vbar(ua, va - th / 2, vb + th / 2, th, d.color2);
          vbar(ub, va - th / 2, vb + th / 2, th, d.color2);
        }
        break;
      }
      case 'lines': {
        const ext = d.extend * em;
        const half = ((r.u1 - r.u0) / 2 + ext) * grow;
        bar(cu - half, cu + half, r.v0 - pad, th, d.color2);
        bar(cu - half, cu + half, r.v1 + pad, th, d.color2);
        break;
      }
      case 'underline': {
        const ext = d.extend * em * 0.5;
        const ua = r.u0 - ext, ub = r.u1 + ext;
        bar(ua, ua + (ub - ua) * grow, r.v1 + pad, th, d.color2);
        break;
      }
      case 'sides': {
        const len = d.extend * em * grow;
        const cv = (r.v0 + r.v1) / 2;
        bar(r.u0 - pad - len, r.u0 - pad, cv, th, d.color2);
        bar(r.u1 + pad, r.u1 + pad + len, cv, th, d.color2);
        break;
      }
      case 'bar': {
        const w = Math.max(3, th * 2);
        const va = r.v0, vb = r.v1;
        // 直排時強調條在文字上方（u0 側）
        vbarAlong(c, r.u0 - pad - w / 2, va, va + (vb - va) * grow, w, d, sw, outlineColor);
        break;
      }
      case 'corners': {
        const arm = Math.min(0.6 * em, (r.u1 - r.u0) / 2 + pad, (r.v1 - r.v0) / 2 + pad) * grow;
        const ua = r.u0 - pad, ub = r.u1 + pad, va = r.v0 - pad, vb = r.v1 + pad;
        for (const [u, v, su, sv] of [[ua, va, 1, 1], [ub, va, -1, 1], [ua, vb, 1, -1], [ub, vb, -1, -1]]) {
          bar(Math.min(u, u + su * arm), Math.max(u, u + su * arm), v, th, d.color2);
          vbar(u, Math.min(v, v + sv * arm) - th / 2, Math.max(v, v + sv * arm) + th / 2, th, d.color2);
        }
        break;
      }
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.scratch, 0, 0);
    ctx.restore();
  }
}

function vbarAlong(c, u, va, vb, w, d, sw, outlineColor) {
  if (vb <= va) return;
  if (d.outline && sw > 0) { c.fillStyle = outlineColor; c.fillRect(u - w / 2 - sw, va - sw, w + sw * 2, vb - va + sw * 2); }
  c.fillStyle = d.color2;
  c.fillRect(u - w / 2, va, w, vb - va);
}

function roundRect(c, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// 擦除・展開的裁切範圍（世界座標）
function clipRect(L, scene, g, clip) {
  const b = scene.layout.groups[g.group].bounds;
  const m = g.size * 0.6 + 40;
  const x0 = b.x - m, y0 = b.y - m, x1 = b.x + b.w + m, y1 = b.y + b.h + m;
  const w = x1 - x0, h = y1 - y0;
  const p = clamp(clip.p);
  let rx = x0, ry = y0, rw = w, rh = h;
  if (clip.kind === 'wipe') {
    const horiz = clip.dir === 'lr' || clip.dir === 'rl';
    const forward = clip.dir === 'lr' || clip.dir === 'tb';
    const len = horiz ? w : h;
    // 登場：前緣從起點推進；退場：後緣從起點推進
    let a, z;
    if (!clip.out) { a = forward ? 0 : len * (1 - p); z = forward ? len * p : len; }
    else { a = forward ? len * p : 0; z = forward ? len : len * (1 - p); }
    if (horiz) { rx = x0 + a; rw = z - a; } else { ry = y0 + a; rh = z - a; }
  } else {
    const k = clip.out ? 1 - p : p;
    if (clip.dir === 'h') { rw = w * k; rx = b.x + b.w / 2 - rw / 2; } else { rh = h * k; ry = b.y + b.h / 2 - rh / 2; }
  }
  L.beginPath();
  L.rect(rx, ry, Math.max(0, rw), Math.max(0, rh));
  L.clip();
}

// 背景隨文字淡入淡出用的整體可見度
export function envelope(scene, t) {
  const pts = scene.timeline.pageTimes;
  if (!pts.length) return 1;
  const first = pts[0], last = pts[pts.length - 1];
  const tl = scene.timeline;
  const inP = !tl.entry || first.holdStart <= first.inStart ? 1 : clamp((t - first.inStart) / Math.max(0.2, first.holdStart - first.inStart));
  const outP = !tl.exit || last.outEnd === Infinity ? 0 : clamp((t - last.holdEnd) / Math.max(0.2, last.outEnd - last.holdEnd));
  return EASE.smooth(inP) * (1 - EASE.smooth(outP));
}
