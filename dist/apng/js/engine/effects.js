// 動畫效果定義
// 每個效果把變形寫進 T（位移、縮放、旋轉、透明度、模糊、白化、故障、裁切）
//  p：套用緩動後的進度（登場：0→1 出現；退場：0→1 消失）
//  r：未套用緩動的進度
//  g：字的資訊 { i, n, key, rx, ry（相對於整段文字中心）, em, vertical, block }
//  o：{ power, dir, t }
// level: 'glyph' 可逐字錯開；'block' 整段一起動（忽略逐字延遲）

import { TAU, clamp, lerp, hash, hashSigned } from '../util.js';

export function newT() {
  return { x: 0, y: 0, s: 1, sx: 1, sy: 1, rot: 0, a: 1, blur: 0, white: 0, glitch: 0, clip: null };
}

// 以整段文字中心為基準縮放
function scaleAbout(T, g, k) {
  T.s *= k;
  T.x += g.rx * (k - 1);
  T.y += g.ry * (k - 1);
}

const DIR_VEC = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const alt = g => (g.i % 2 ? 1 : -1);

export const IN = {
  fade: { level: 'glyph', ease: 'out', apply(T, p) { T.a *= p; } },
  rise: { level: 'glyph', ease: 'out', apply(T, p, r, g, o) { T.y += (1 - p) * 0.6 * g.em * o.power; T.a *= clamp(r * 1.6); } },
  drop: { level: 'glyph', ease: 'out', apply(T, p, r, g, o) { T.y -= (1 - p) * 0.8 * g.em * o.power; T.a *= clamp(r * 1.6); } },
  converge: {
    level: 'glyph', ease: 'strong',
    apply(T, p, r, g, o) {
      const d = alt(g) * (1 - p) * 1.2 * g.em * o.power;
      if (g.vertical) T.x += d; else T.y += d;
      T.a *= clamp(r * 1.5);
    }
  },
  slide: {
    level: 'glyph', ease: 'strong', dirs: ['left', 'right', 'up', 'down'],
    apply(T, p, r, g, o) {
      const [dx, dy] = DIR_VEC[o.dir] || DIR_VEC.left;
      T.x += dx * (1 - p) * 2 * g.em * o.power;
      T.y += dy * (1 - p) * 2 * g.em * o.power;
      T.a *= clamp(r * 1.5);
    }
  },
  tracking: {
    level: 'block', ease: 'strong',
    apply(T, p, r, g, o) {
      const k = (1 - p) * 0.9 * o.power;
      if (g.vertical) T.y += g.ry * k; else T.x += g.rx * k;
      T.a *= clamp(r * 1.4);
    }
  },
  spread: {
    level: 'block', ease: 'strong',
    apply(T, p, r, g) {
      if (g.vertical) T.y -= g.ry * (1 - p); else T.x -= g.rx * (1 - p);
      T.a *= clamp(r * 2.5);
    }
  },
  blurIn: { level: 'glyph', ease: 'out', apply(T, p, r, g, o) { T.blur += (1 - p) * 0.25 * g.em * o.power; T.s *= 1 + (1 - p) * 0.15; T.a *= p; } },
  pop: { level: 'glyph', ease: 'back', apply(T, p, r) { T.s *= Math.max(0, p); T.a *= clamp(r * 3); } },
  shrinkIn: { level: 'glyph', ease: 'strong', apply(T, p, r, g, o) { T.s *= 1 + (1 - p) * 2 * o.power; T.a *= clamp(r * 1.5); } },
  spin: { level: 'glyph', ease: 'back', apply(T, p, r, g, o) { T.rot += (1 - p) * Math.PI * 1.5 * o.power; T.s *= lerp(0.2, 1, clamp(p)); T.a *= clamp(r * 2); } },
  flip: {
    level: 'glyph', ease: 'back',
    apply(T, p, r) {
      const c = Math.cos(clamp(1 - p, -0.3, 1) * Math.PI / 2);
      T.sx *= Math.abs(c) < 0.02 ? 0.02 : c;
      T.a *= clamp(r * 3);
    }
  },
  bounce: { level: 'glyph', ease: 'bounce', apply(T, p, r, g, o) { T.y -= (1 - p) * 1.6 * g.em * o.power; T.a *= clamp(r * 5); } },
  scatter: {
    level: 'glyph', ease: 'strong',
    apply(T, p, r, g, o) {
      const k = (1 - p) * o.power;
      T.x += hashSigned(g.i, 11) * 3 * g.em * k;
      T.y += hashSigned(g.i, 12) * 2 * g.em * k;
      T.rot += hashSigned(g.i, 13) * Math.PI * k;
      T.a *= clamp(r * 1.5);
    }
  },
  typewriter: { level: 'glyph', instant: true, ease: 'linear', apply() {} },
  flicker: {
    level: 'glyph', ease: 'linear',
    apply(T, p, r, g) { if (r < 1) T.a *= hash(g.i, Math.floor(r * 14), 21) < r * 1.15 ? 1 : 0.08; }
  },
  slam: {
    level: 'block', ease: 'linear',
    apply(T, p, r, g, o) {
      const land = 0.55;
      if (r < land) {
        const e = 1 - Math.pow(1 - r / land, 3);
        scaleAbout(T, g, 1 + (1 - e) * 2.5 * o.power);
        T.a *= clamp(r * 6);
      } else {
        const k = (1 - (r - land) / (1 - land)) * 0.09 * g.em * o.power;
        const f = Math.floor(o.t * 30);
        T.x += hashSigned(f, 31) * k;
        T.y += hashSigned(f, 32) * k;
      }
    }
  },
  zoomIn: { level: 'block', ease: 'strong', apply(T, p, r, g) { scaleAbout(T, g, lerp(0.05, 1, p)); T.blur += (1 - p) * 0.1 * g.em; T.a *= clamp(r * 2); } },
  emerge: {
    level: 'glyph', ease: 'smooth',
    apply(T, p, r, g, o) { T.s *= lerp(0.5, 1, p); T.blur += (1 - p) * 0.3 * g.em * o.power; T.y += (1 - p) * 0.2 * g.em; T.a *= p; }
  },
  wipe: { level: 'block', ease: 'smooth', dirs: ['lr', 'rl', 'tb', 'bt'], apply(T, p, r, g, o) { T.clip = { kind: 'wipe', dir: o.dir, p, out: false }; } },
  shutter: { level: 'block', ease: 'strong', dirs: ['v', 'h'], apply(T, p, r, g, o) { T.clip = { kind: 'shutter', dir: o.dir, p, out: false }; } },
  glitch: {
    level: 'block', ease: 'linear',
    apply(T, p, r, g, o) {
      T.glitch = Math.max(T.glitch, (1 - r) * o.power);
      if (r < 0.4) T.a *= hash(Math.floor(o.t * 24), 41) < 0.35 + r ? 1 : 0;
    }
  },
  flash: {
    level: 'block', ease: 'out',
    apply(T, p, r, g) { T.white = Math.max(T.white, 1 - p); scaleAbout(T, g, 1 + (1 - p) * 0.08); T.a *= clamp(r * 5); }
  }
};

export const OUT = {
  none: { level: 'block', ease: 'linear', apply() {} },
  fade: { level: 'glyph', ease: 'in', apply(T, p) { T.a *= 1 - p; } },
  rise: { level: 'glyph', ease: 'in', apply(T, p, r, g, o) { T.y -= p * 0.6 * g.em * o.power; T.a *= 1 - p; } },
  sink: { level: 'glyph', ease: 'in', apply(T, p, r, g, o) { T.y += p * 0.6 * g.em * o.power; T.a *= 1 - p; } },
  diverge: {
    level: 'glyph', ease: 'in',
    apply(T, p, r, g, o) {
      const d = alt(g) * p * 1.2 * g.em * o.power;
      if (g.vertical) T.x += d; else T.y += d;
      T.a *= 1 - p;
    }
  },
  slide: {
    level: 'glyph', ease: 'in', dirs: ['left', 'right', 'up', 'down'],
    apply(T, p, r, g, o) {
      const [dx, dy] = DIR_VEC[o.dir] || DIR_VEC.left;
      T.x += dx * p * 2 * g.em * o.power;
      T.y += dy * p * 2 * g.em * o.power;
      T.a *= 1 - p;
    }
  },
  tracking: {
    level: 'block', ease: 'out',
    apply(T, p, r, g, o) {
      const k = p * 1.0 * o.power;
      if (g.vertical) T.y += g.ry * k; else T.x += g.rx * k;
      T.a *= 1 - r;
    }
  },
  blurOut: { level: 'glyph', ease: 'in', apply(T, p, r, g, o) { T.blur += p * 0.25 * g.em * o.power; T.s *= 1 + p * 0.1; T.a *= 1 - p; } },
  growOut: { level: 'glyph', ease: 'out', apply(T, p, r, g, o) { T.s *= 1 + p * 1.2 * o.power; T.a *= 1 - r; } },
  shrink: { level: 'glyph', ease: 'in', apply(T, p, r) { T.s *= Math.max(0, 1 - p); T.a *= clamp(1.4 - r); } },
  scatter: {
    level: 'glyph', ease: 'in',
    apply(T, p, r, g, o) {
      const k = p * o.power;
      T.x += hashSigned(g.i, 51) * 3 * g.em * k;
      T.y += hashSigned(g.i, 52) * 2 * g.em * k;
      T.rot += hashSigned(g.i, 53) * Math.PI * k;
      T.a *= 1 - p;
    }
  },
  erase: { level: 'glyph', instant: true, ease: 'linear', apply() {} },
  flicker: {
    level: 'glyph', ease: 'linear',
    apply(T, p, r, g) { T.a *= r >= 1 ? 0 : hash(g.i, Math.floor(r * 14), 61) > r ? 1 : 0.08; }
  },
  zoomThrough: { level: 'block', ease: 'in', apply(T, p, r, g, o) { scaleAbout(T, g, 1 + p * 3 * o.power); T.blur += p * 0.08 * g.em; T.a *= 1 - p; } },
  recede: { level: 'block', ease: 'smooth', apply(T, p, r, g) { scaleAbout(T, g, 1 - p * 0.7); T.a *= 1 - p; } },
  wipe: { level: 'block', ease: 'smooth', dirs: ['lr', 'rl', 'tb', 'bt'], apply(T, p, r, g, o) { T.clip = { kind: 'wipe', dir: o.dir, p, out: true }; } },
  shutter: { level: 'block', ease: 'in', dirs: ['v', 'h'], apply(T, p, r, g, o) { T.clip = { kind: 'shutter', dir: o.dir, p, out: true }; } },
  glitch: {
    level: 'block', ease: 'linear',
    apply(T, p, r, g, o) {
      T.glitch = Math.max(T.glitch, r * o.power);
      if (r > 0.6) T.a *= hash(Math.floor(o.t * 24), 71) > (r - 0.6) * 2.5 ? 1 : 0;
      if (r >= 1) T.a = 0;
    }
  }
};

// 顯示中的效果。e：淡入淡出用的強度（避免開始或結束時突然跳動）
export const HOLD = {
  none: null,
  float(T, g, o, e) { T.y += Math.sin(TAU * o.t / 2.4) * 0.06 * g.em * o.power * e; },
  wave(T, g, o, e) {
    const d = Math.sin(TAU * o.t / 1.4 - g.i * 0.55) * 0.07 * g.em * o.power * e;
    if (g.vertical) T.x += d; else T.y += d;
  },
  pulse(T, g, o, e) {
    const u = (o.t % 1.1) / 1.1;
    const beat = Math.max(0, Math.sin(Math.min(1, u / 0.18) * Math.PI)) + 0.6 * Math.max(0, Math.sin(clamp((u - 0.22) / 0.16) * Math.PI));
    scaleAbout(T, g, 1 + 0.05 * o.power * e * beat);
  },
  shake(T, g, o, e) {
    const f = Math.floor(o.t * 30);
    T.x += hashSigned(f, g.i, 81) * 0.03 * g.em * o.power * e;
    T.y += hashSigned(f, g.i, 82) * 0.03 * g.em * o.power * e;
  },
  glow() { /* 由描繪端調整光暈強度 */ },
  flicker(T, g, o, e) { if (hash(Math.floor(o.t * 20), 91) < 0.1 * o.power * e) T.a *= 0.3; },
  blink(T, g, o, e) { if (o.t % 1 >= 0.55) T.a *= 1 - clamp(0.85 * o.power) * e; },
  glitch(T, g, o, e) {
    const w = Math.floor(o.t / 0.7);
    if (hash(w, 101) < 0.4 * o.power && o.t % 0.7 < 0.18) T.glitch = Math.max(T.glitch, 0.8 * e);
  }
};

export function glowMultiplier(holdFx, t, power, e) {
  if (holdFx !== 'glow') return 1;
  return Math.max(0, 1 + 0.75 * power * e * Math.sin(TAU * t / 1.6));
}

export const IN_IDS = Object.keys(IN);
export const OUT_IDS = Object.keys(OUT);
export const HOLD_IDS = Object.keys(HOLD);
