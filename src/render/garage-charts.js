// 機甲庫的圖表（docs/garage-ui.md）
import { HEX_AXES } from '../data/garage-hex.js';

const fmt = (v) => Math.round(v).toLocaleString();

// 六角圖（SVG）：cur、prev＝hexScores 的結果（prev 可以是 null）；big＝規格頁的大圖（標出數值）
export function hexSvg(cur, prev, big) {
  const R = 40,
    pt = (i, s) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      const r = R * (0.12 + 0.88 * s);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
  const poly = (S) =>
    HEX_AXES.map(([k], i) =>
      pt(i, S[k])
        .map((v) => v.toFixed(1))
        .join(','),
    ).join(' ');
  const ring = (s) =>
    HEX_AXES.map((_, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      return (Math.cos(a) * R * s).toFixed(1) + ',' + (Math.sin(a) * R * s).toFixed(1);
    }).join(' ');
  const raw = cur.raw;
  const val = {
    fire: fmt(raw.fire),
    armor: fmt(raw.armor),
    mobi: raw.speed.toFixed(0) + '/' + Math.round(raw.qb),
    en: fmt(raw.cap),
    stab: fmt(raw.stab),
    range: Math.round(raw.lock) + ' m',
  };
  const labels = HEX_AXES.map(([k, n], i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    const x = Math.cos(a) * (R + 9),
      y = Math.sin(a) * (R + 9) + 1.5;
    const anc = Math.abs(x) < 2 ? 'middle' : x > 0 ? 'start' : 'end';
    const d = prev ? prev[k] - cur[k] : 0;
    const dc = Math.abs(d) < 0.005 ? '' : d > 0 ? ' up' : ' dn';
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anc}" class="hxL${dc}">${n}</text>${
      big
        ? `<text x="${x.toFixed(1)}" y="${(y + 6).toFixed(1)}" text-anchor="${anc}" class="hxV">${val[k]}</text>`
        : ''
    }`;
  }).join('');
  return `<svg viewBox="${big ? '-80 -62 160 128' : '-74 -58 148 116'}" class="hexSvg" aria-hidden="true">
    <polygon points="${ring(1)}" class="hxG"/><polygon points="${ring(0.66)}" class="hxG2"/><polygon points="${ring(0.33)}" class="hxG2"/>
    ${HEX_AXES.map((_, i) => `<line x1="0" y1="0" x2="${pt(i, 1)[0].toFixed(1)}" y2="${pt(i, 1)[1].toFixed(1)}" class="hxG2"/>`).join('')}
    <polygon points="${poly(cur)}" class="hxCur"/>
    ${prev ? `<polygon points="${poly(prev)}" class="hxPrev"/>` : ''}
    ${labels}</svg>`;
}

// 一般的六角雷達圖：axes＝[[鍵, 名稱]]（6 個）、cur／prev＝{ 鍵: 0～1 }（prev 可以是 null）；small＝不標名稱
export function radarSvg(axes, cur, prev, small) {
  const R = 40,
    n = axes.length,
    ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n,
    pt = (i, s) => [Math.cos(ang(i)) * R * (0.1 + 0.9 * s), Math.sin(ang(i)) * R * (0.1 + 0.9 * s)];
  const poly = (S) =>
    axes
      .map(([k], i) =>
        pt(i, Math.min(1, Math.max(0, S[k] || 0)))
          .map((v) => v.toFixed(1))
          .join(','),
      )
      .join(' ');
  const ring = (s) =>
    axes
      .map((_, i) => (Math.cos(ang(i)) * R * s).toFixed(1) + ',' + (Math.sin(ang(i)) * R * s).toFixed(1))
      .join(' ');
  const labels = small
    ? ''
    : axes
        .map(([k, nm], i) => {
          const x = Math.cos(ang(i)) * (R + 8),
            y = Math.sin(ang(i)) * (R + 8) + 2.5;
          const anc = Math.abs(x) < 2 ? 'middle' : x > 0 ? 'start' : 'end';
          const d = prev ? (prev[k] || 0) - (cur[k] || 0) : 0;
          return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anc}" class="hxL${d > 0.001 ? ' up' : ''}">${nm}</text>`;
        })
        .join('');
  return `<svg viewBox="${small ? '-44 -44 88 88' : '-74 -54 148 108'}" class="hexSvg" aria-hidden="true">
    <polygon points="${ring(1)}" class="hxG"/><polygon points="${ring(0.55)}" class="hxG2"/>
    <polygon points="${poly(cur)}" class="hxCur"/>
    ${prev ? `<polygon points="${poly(prev)}" class="hxPrev"/>` : ''}
    ${labels}</svg>`;
}
