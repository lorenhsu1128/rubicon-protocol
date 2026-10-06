// 時間軸：決定每個字何時登場、顯示、退場，以及整體長度與區段

import { IN, OUT } from './effects.js';
import { hash, clamp } from '../util.js';
import { PUNCT } from './layout.js';

// 逐字順序 → 每個字的延遲倍數
export function orderKeys(n, order, seed = 0) {
  const mid = (n - 1) / 2;
  switch (order) {
    case 'reverse': return Array.from({ length: n }, (_, i) => n - 1 - i);
    case 'center': return Array.from({ length: n }, (_, i) => Math.abs(i - mid));
    case 'edges': return Array.from({ length: n }, (_, i) => mid - Math.abs(i - mid));
    case 'random': {
      const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => hash(a, seed, 7) - hash(b, seed, 7));
      const keys = new Array(n);
      idx.forEach((gi, rank) => { keys[gi] = rank; });
      return keys;
    }
    default: return Array.from({ length: n }, (_, i) => i);
  }
}

function fxParams(def, dur, stagger, minStagger = 0.05) {
  if (def.instant) return { dur: 0, stagger: Math.max(stagger, minStagger) };
  if (def.level === 'block') return { dur, stagger: 0 };
  return { dur, stagger };
}

// 給一組字排登場時間
function scheduleIn(layout, group, start, fxId, dur, stagger, order, ease, power, dir) {
  const def = IN[fxId] || IN.fade;
  const p = fxParams(def, dur, stagger);
  const keys = orderKeys(group.glyphs.length, order, group.page);
  let end = start;
  group.glyphs.forEach((gi, k) => {
    const g = layout.glyphs[gi];
    g.inStart = start + keys[k] * p.stagger;
    g.inEnd = g.inStart + p.dur;
    g.inFx = { id: fxId, ease, power, dir };
    end = Math.max(end, g.inEnd);
  });
  return end;
}

function scheduleOut(layout, group, start, s) {
  const def = OUT[s.outFx] || OUT.fade;
  const p = fxParams(def, s.outDur, s.outStagger);
  const keys = orderKeys(group.glyphs.length, def.instant && s.outOrder === 'forward' ? 'reverse' : s.outOrder, group.page + 50);
  let end = start;
  group.glyphs.forEach((gi, k) => {
    const g = layout.glyphs[gi];
    g.outStart = start + keys[k] * p.stagger;
    g.outEnd = g.outStart + p.dur;
    g.outFx = { id: s.outFx, ease: s.outEase, power: s.outPower, dir: s.outDir };
    end = Math.max(end, g.outEnd);
  });
  return end;
}

function resetGlyphs(layout) {
  for (const g of layout.glyphs) {
    g.inStart = 0; g.inEnd = 0; g.outStart = Infinity; g.outEnd = Infinity;
    g.showFrom = -Infinity; g.hideAt = Infinity;
    g.inFx = null; g.outFx = null; g.special = null;
  }
}

// flags: { entry, exit }（預覽下方的開關）
export function buildTimeline(s, layout, flags = { entry: true, exit: true }) {
  resetGlyphs(layout);
  return s.mode === 'trailer' ? trailerTimeline(s, layout, flags) : messageTimeline(s, layout, flags);
}

function messageTimeline(s, layout, flags) {
  const entry = flags.entry && s.inEnabled;
  const exit = flags.exit && s.outEnabled && s.outFx !== 'none';
  const page = layout.pages[0];
  const groups = page.groups.map(i => layout.groups[i]);
  const main = groups.find(g => g.role === 'main');
  const sub = groups.find(g => g.role === 'sub');
  const t0 = entry ? s.startDelay : 0;
  let mainEnd = t0;
  if (entry) {
    if (main) mainEnd = scheduleIn(layout, main, t0, s.inFx, s.inDur, s.inStagger, s.inOrder, s.inEase, s.inPower, s.inDir);
    if (sub) {
      const same = s.subFx === 'same';
      const fx = same ? s.inFx : s.subFx;
      const subStart = Math.max(t0, mainEnd + s.subDelay);
      const stagger = same ? s.inStagger : IN[fx]?.instant ? 0.05 : 0;
      scheduleIn(layout, sub, subStart, fx, same ? s.inDur : Math.max(0.3, s.inDur), stagger, same ? s.inOrder : 'forward', same ? s.inEase : 'auto', same ? s.inPower : 1, s.inDir);
    }
  }
  const holdStart = entry ? Math.max(t0, ...layout.glyphs.map(g => g.inEnd)) : 0;
  const holdEnd = holdStart + s.hold;
  let outEnd = holdEnd;
  if (exit) for (const g of groups) outEnd = Math.max(outEnd, scheduleOut(layout, g, holdEnd, s));
  const duration = Math.max(0.1, outEnd + s.endDelay);
  const firstIn = entry ? Math.min(...layout.glyphs.map(g => g.inStart), holdStart) : 0;
  const segments = [];
  if (holdStart > 0) segments.push({ type: 'in', start: 0, end: holdStart });
  segments.push({ type: 'hold', start: holdStart, end: holdEnd });
  if (exit) segments.push({ type: 'out', start: holdEnd, end: duration });
  else if (duration > holdEnd) segments[segments.length - 1].end = duration;
  const decoDur = s.deco.anim === 'none' ? 0 : s.deco.dur;
  const pageTimes = [{
    start: 0, end: duration, inStart: firstIn, holdStart, holdEnd, outEnd: exit ? outEnd : Infinity,
    deco: { inStart: entry ? firstIn : -1, inDur: entry ? decoDur : 0, outEnd: exit ? outEnd : Infinity, outDur: decoDur }
  }];
  return { duration, segments, pageTimes, posterTime: holdStart + Math.min(0.05, s.hold / 2), entry, exit, scroll: null };
}

function trailerTimeline(s, layout, flags) {
  const entry = flags.entry && s.inEnabled;
  const reveal = s.reveal;
  if (reveal === 'scroll') return scrollTimeline(s, layout);
  const exit = flags.exit && s.outEnabled && s.outFx !== 'none';
  const inFx = s.inFx;
  const def = IN[inFx] || IN.fade;
  const glyphDur = def.instant ? 0 : s.glyphDur;
  const segments = [];
  const pageTimes = [];
  let T = entry ? s.startDelay : 0;
  layout.pages.forEach((page, pi) => {
    const group = page.groups.map(i => layout.groups[i]).find(g => g.role === 'main');
    const pageStart = T;
    const glyphs = group ? group.glyphs.map(i => layout.glyphs[i]) : [];
    const fx = { id: inFx, ease: s.inEase, power: s.inPower, dir: s.inDir };
    const set = (g, start, dur = glyphDur, f = fx) => { g.inStart = start; g.inEnd = start + dur; g.inFx = f; };
    if (!entry) glyphs.forEach(g => set(g, T, 0));
    else if (reveal === 'char') {
      let c = T;
      glyphs.forEach((g, k) => {
        set(g, c);
        c += 1 / s.cps;
        if (PUNCT.has(g.ch)) c += s.punctPause;
        const next = glyphs[k + 1];
        if (next && next.line !== g.line) c += s.linePause;
      });
    } else if (reveal === 'line') glyphs.forEach(g => set(g, T + g.line * s.lineInterval));
    else if (reveal === 'sweep') glyphs.forEach(g => set(g, T + g.line * s.lineInterval + clamp(g.frac) * s.sweepDur));
    else if (reveal === 'all') glyphs.forEach(g => set(g, T));
    else if (reveal === 'solo') {
      const step = 1 / s.cps;
      const land = T + glyphs.length * step + s.soloPause;
      glyphs.forEach((g, k) => {
        g.special = { kind: 'solo', start: T + k * step, end: T + (k + 1) * step, land };
        set(g, land, 0.45, { id: 'land', power: s.soloImpact });
      });
    } else if (reveal === 'spread') {
      const move = T + 0.25 + s.spreadHold;
      glyphs.forEach(g => {
        g.special = { kind: 'spread', start: T, move, end: move + s.spreadDur };
        set(g, T, 0.25 + s.spreadHold + s.spreadDur, { id: 'spread-reveal' });
      });
    }
    const inEnd = Math.max(T, ...glyphs.map(g => g.inEnd));
    const holdEnd = inEnd + s.hold;
    let end = holdEnd;
    if (exit && group) end = scheduleOut(layout, group, holdEnd, s);
    const last = pi === layout.pages.length - 1;
    if (!exit && !last) glyphs.forEach(g => { g.hideAt = holdEnd; });
    if (inEnd > pageStart) segments.push({ type: 'in', start: pageStart, end: inEnd });
    segments.push({ type: 'hold', start: inEnd, end: holdEnd });
    if (exit) segments.push({ type: 'out', start: holdEnd, end });
    const decoDur = s.deco.anim === 'none' ? 0 : s.deco.dur;
    pageTimes.push({
      start: pageStart, end, inStart: pageStart, holdStart: inEnd, holdEnd, outEnd: exit ? end : last ? Infinity : holdEnd,
      deco: { inStart: entry ? pageStart : (pi === 0 ? -1 : pageStart), inDur: entry ? decoDur : 0, outEnd: exit ? end : last ? Infinity : holdEnd, outDur: exit ? decoDur : 0 }
    });
    T = end + (last ? 0 : s.pageGap);
  });
  if (segments.length && segments[0].start > 0) segments[0].start = 0;
  const duration = Math.max(0.1, T + s.endDelay);
  if (!exit && segments.length) segments[segments.length - 1].end = duration;
  const lastPage = pageTimes[pageTimes.length - 1];
  return { duration, segments, pageTimes, posterTime: lastPage ? lastPage.holdStart + 0.01 : 0, entry, exit, scroll: null };
}

function scrollTimeline(s, layout) {
  const b = layout.pages[0].bounds;
  const vertical = layout.vertical;
  const dist = vertical ? layout.W + b.w : layout.H + b.h;
  const moveDur = dist / Math.max(1, s.scrollSpeed);
  const start = s.startDelay;
  const duration = start + moveDur + s.endDelay;
  for (const g of layout.glyphs) { g.inStart = g.inEnd = -1; }
  // 起點：整段文字剛好在畫面外（橫排在下方、直排在右方）
  const from = vertical ? layout.W - b.x : layout.H - b.y;
  const to = vertical ? -(b.x + b.w) : -(b.y + b.h);
  return {
    duration,
    segments: [{ type: 'hold', start: 0, end: duration }],
    pageTimes: [{ start: 0, end: duration, inStart: 0, holdStart: 0, holdEnd: duration, outEnd: Infinity, deco: { inStart: -1, inDur: 0, outEnd: Infinity, outDur: 0 } }],
    posterTime: start + moveDur / 2,
    entry: false, exit: false,
    scroll: { start, moveDur, from, to, vertical }
  };
}
