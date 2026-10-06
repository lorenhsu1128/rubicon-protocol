// 文字排版：橫排／直排、避頭尾的自動換行、自動縮小、九宮格定位、預告模式的分頁

import * as Fonts from '../fonts.js';

const NO_START = new Set('、。，．,.！？!?）」』】〕〉》〗］｝)]}ー～…‥・：；:;%％々ゝゞぁぃぅぇぉっゃゅょァィゥェォッャュョ');
const NO_END = new Set('（「『【〔〈《〖［｛([{');
// 直排時要轉 90 度的全形符號
const ROTATE_V = new Set('ー—―～〜…‥（）「」『』【】〈〉《》〔〕［］｛｝－＝→←：；');
export const PUNCT = new Set('、。，．,.！？!?…‥：；');

export function fontString(fontId, weight, size, italic) {
  const w = Fonts.nearestWeight(fontId, weight);
  return `${italic ? 'italic ' : ''}${w} ${Math.max(1, size).toFixed(2)}px ${Fonts.familyStack(fontId)}`;
}

const measureCache = new Map();
function measure(ctx, font, ch) {
  const key = font + '\u0000' + ch;
  let w = measureCache.get(key);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(ch).width;
    if (measureCache.size > 20000) measureCache.clear();
    measureCache.set(key, w);
  }
  return w;
}
export const clearMeasureCache = () => measureCache.clear();

const isHalfwidth = ch => ch.charCodeAt(0) < 0x2e80 && !ROTATE_V.has(ch);

// 依字數自動換行（避頭尾）
export function wrapLines(lines, maxChars) {
  if (!maxChars) return lines;
  const out = [];
  for (const line of lines) {
    const chars = [...line];
    if (chars.length <= maxChars) { out.push(line); continue; }
    let cur = [];
    for (let i = 0; i < chars.length; i++) {
      cur.push(chars[i]);
      if (cur.length >= maxChars && i < chars.length - 1) {
        // 下一個字不能放行首 → 拉進這一行
        while (i + 1 < chars.length && NO_START.has(chars[i + 1])) cur.push(chars[++i]);
        // 行尾不能是開括號 → 移到下一行
        const carry = [];
        while (cur.length > 1 && NO_END.has(cur[cur.length - 1])) carry.unshift(cur.pop());
        if (i < chars.length - 1 || carry.length) { out.push(cur.join('')); cur = carry; }
      }
    }
    if (cur.length) out.push(cur.join(''));
  }
  return out;
}

// 排一段文字（相對座標）。回傳 { glyphs, w, h }
function layoutBlock(ctx, lines, o) {
  const { size, ls, lh, font, vertical, align } = o;
  const gap = size * lh;
  const glyphs = [];
  const runs = lines.map(line => [...line].map(ch => {
    const half = isHalfwidth(ch);
    const rot = vertical && (half || ROTATE_V.has(ch));
    const adv = vertical && !rot ? size : measure(ctx, font, ch);
    return { ch, adv: adv + size * ls, rot };
  }));
  const lengths = runs.map(r => Math.max(0, r.reduce((s, g) => s + g.adv, 0) - (r.length ? size * ls : 0)));
  const long = Math.max(0, ...lengths);
  const across = lines.length ? (lines.length - 1) * gap + size : 0;
  const k = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
  runs.forEach((run, li) => {
    let cur = (long - lengths[li]) * k;
    run.forEach((g, ci) => {
      const along = cur + (g.adv - size * ls) / 2;
      const lineCenter = li * gap + size / 2;
      const frac = lengths[li] > 0 ? along / lengths[li] : 0;
      if (vertical) glyphs.push({ ch: g.ch, x: across - lineCenter, y: along, rot: g.rot ? Math.PI / 2 : 0, adv: g.adv, line: li, col: ci, frac });
      else glyphs.push({ ch: g.ch, x: along, y: lineCenter, rot: 0, adv: g.adv, line: li, col: ci, frac });
      cur += g.adv;
    });
  });
  return vertical ? { glyphs, w: across, h: long } : { glyphs, w: long, h: across };
}

// 預告模式的分頁
export function splitPages(text, state) {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  if (state.reveal === 'scroll' || !state.pageSplit) return [wrapLines(raw, state.wrapChars)];
  const pages = [];
  let cur = [];
  for (const line of raw) {
    if (line.trim() === '') { if (cur.length) pages.push(cur); cur = []; }
    else cur.push(line);
  }
  if (cur.length) pages.push(cur);
  return (pages.length ? pages : [[]]).map(p => wrapLines(p, state.wrapChars));
}

function composeOnce(ctx, s, size, texts) {
  const vertical = s.writing === 'v';
  const mainFont = fontString(s.fontId, s.weight, size, s.italic);
  const subFontId = s.subFontId === 'same' ? s.fontId : s.subFontId;
  const subSize = size * s.subSize;
  const subFont = fontString(subFontId, s.subWeight, subSize, s.subItalic);
  const pages = texts.pages.map(lines => {
    const main = layoutBlock(ctx, lines, { size, ls: s.letterSpacing, lh: s.lineHeight, font: mainFont, vertical, align: s.align });
    const sub = texts.sub ? layoutBlock(ctx, texts.sub.split('\n'), { size: subSize, ls: s.subLetterSpacing, lh: 1.3, font: subFont, vertical, align: s.align }) : null;
    // 主文字與副文字的組合
    const gap = size * s.subGap;
    let mx = 0, my = 0, sx = 0, sy = 0, w = main.w, h = main.h;
    if (sub && sub.glyphs.length) {
      const k = s.align === 'left' ? 0 : s.align === 'right' ? 1 : 0.5;
      const subFirst = s.subPosition === 'above';
      if (vertical) {
        w = main.w + gap + sub.w;
        h = Math.max(main.h, sub.h);
        // 直排：「上」= 右側，「下」= 左側
        if (subFirst) { sx = main.w + gap; mx = 0; } else { mx = sub.w + gap; sx = 0; }
        my = (h - main.h) * k; sy = (h - sub.h) * k;
      } else {
        w = Math.max(main.w, sub.w);
        h = main.h + gap + sub.h;
        if (subFirst) { sy = 0; my = sub.h + gap; } else { my = 0; sy = main.h + gap; }
        mx = (w - main.w) * k; sx = (w - sub.w) * k;
      }
    }
    return { main, sub, mx, my, sx, sy, w, h };
  });
  return { pages, mainFont, subFont, subSize };
}

// 整體排版。回傳 scene 用的 layout
export function layoutScene(ctx, s, opts = {}) {
  const W = s.width, H = s.height;
  const trailer = s.mode === 'trailer';
  const texts = trailer
    ? { pages: splitPages(opts.text ?? s.text, s), sub: '' }
    : { pages: [(opts.text ?? s.text).replace(/\r\n?/g, '\n').split('\n')], sub: (opts.subText ?? s.subText) || '' };
  const availW = Math.max(10, W - s.marginX * 2), availH = Math.max(10, H - s.marginY * 2);
  const scroll = trailer && s.reveal === 'scroll';
  let size = s.fontSize;
  let comp = composeOnce(ctx, s, size, texts);
  let fit = null;
  if (s.autoFit) {
    for (let iter = 0; iter < 3; iter++) {
      const w = Math.max(...comp.pages.map(p => p.w)), h = Math.max(...comp.pages.map(p => p.h));
      let k = 1;
      const vertical = s.writing === 'v';
      if (!(scroll && vertical) && w > availW) k = Math.min(k, availW / w);
      if (!(scroll && !vertical) && h > availH) k = Math.min(k, availH / h);
      if (k >= 0.999) break;
      size = Math.max(6, size * k * 0.995);
      comp = composeOnce(ctx, s, size, texts);
    }
    if (size < s.fontSize - 0.5) fit = { from: s.fontSize, to: size };
  }

  const glyphs = [];
  const groups = [];
  const pages = [];
  const ax = s.anchor[1], ay = s.anchor[0];
  comp.pages.forEach((p, pi) => {
    const ox = (ax === 'l' ? s.marginX : ax === 'r' ? W - s.marginX - p.w : (W - p.w) / 2) + s.offsetX;
    const oy = (ay === 't' ? s.marginY : ay === 'b' ? H - s.marginY - p.h : (H - p.h) / 2) + s.offsetY;
    const page = { index: pi, groups: [], bounds: { x: ox, y: oy, w: p.w, h: p.h } };
    const addGroup = (block, bx, by, role, gsize, font) => {
      if (!block || !block.glyphs.length) return;
      const x = ox + bx, y = oy + by;
      const group = { role, page: pi, glyphs: [], size: gsize, bounds: { x, y, w: block.w, h: block.h, cx: x + block.w / 2, cy: y + block.h / 2 }, lines: 0 };
      block.glyphs.forEach((g, i) => {
        const gi = glyphs.length;
        glyphs.push({ ...g, x: x + g.x, y: y + g.y, size: gsize, font, role, page: pi, group: groups.length, i, n: block.glyphs.length, gi });
        group.glyphs.push(gi);
        group.lines = Math.max(group.lines, g.line + 1);
      });
      page.groups.push(groups.length);
      groups.push(group);
    };
    addGroup(p.main, p.mx, p.my, 'main', size, comp.mainFont);
    addGroup(p.sub, p.sx, p.sy, 'sub', comp.subSize, comp.subFont);
    pages.push(page);
  });
  return { W, H, size, fit, glyphs, groups, pages, vertical: s.writing === 'v' };
}
