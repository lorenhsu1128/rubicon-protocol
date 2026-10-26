// 機甲庫的圖示（docs/garage-ui.md）：部位、武器種類、消耗品的線條圖示（SVG 字串，24×24、stroke＝currentColor）。
// 零件縮圖（render/part-thumbs.js）還沒拍好或沒有外觀（發電機、火控、消耗品）時用它
const P = {
  head: 'M6 9l2-4h8l2 4v6l-3 3H9l-3-3z M9 11h6',
  core: 'M5 5h14l-1 9-6 5-6-5z M9 9h6',
  arms: 'M6 4h5v7H8v8H5v-8z M13 4h5l1 7h-3v8h-3z',
  legs: 'M7 3h10v5l-2 3 1 9h-3l-1-8-1 8H8l1-9-2-3z',
  booster: 'M8 3h8v9l-4 3-4-3z M9 16l-1 5 M15 16l1 5 M12 16v5',
  generator: 'M5 6h14v12H5z M13 8l-3 5h4l-3 5',
  fcs: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 7a5 5 0 1 0 .01 0 M12 11a1 1 0 1 0 .01 0',
  consumable: 'M7 4h10l2 4v12H5V8z M5 8h14 M10 12h4',
  none: 'M5 5h14v14H5z M5 19L19 5',
  // 武器種類
  bullet: 'M3 10h14l3 1.5-3 1.5H11l-2 6H6l1-6H3z',
  shotgun: 'M3 9h15v4H11l-2 6H6l1-6H3z M18 10h3 M18 12h3',
  shell: 'M3 8h16v6H3z M19 9.5h2v3h-2 M8 14l-1 5h3l1-5',
  grenade: 'M3 9h12l2-2h3v8h-3l-2-2H11l-2 6H6l1-6H3z',
  laser: 'M3 10h12l6 1.5-6 1.5H11l-2 6H6l1-6H3z M15 7l3-2 M15 16l3 2',
  empbeam: 'M3 10h11v3H11l-2 6H6l1-6H3z M15 8l2 3-2 0 2 3 M19 8l2 3-2 0 2 3',
  missile:
    'M4 5h16v14H4z M8 9a1.6 1.6 0 1 0 .01 0 M16 9a1.6 1.6 0 1 0 .01 0 M8 15a1.6 1.6 0 1 0 .01 0 M16 15a1.6 1.6 0 1 0 .01 0',
  emp: 'M12 4a8 8 0 1 0 .01 0 M12 8a4 4 0 1 0 .01 0 M13 10l-2 2h2l-2 2',
  melee: 'M5 19l3-3 M7 13l4 4 M9 15L19 5l1 1-10 10',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  bomber: 'M3 12l7-2 3-6h2l-1 6 7 1v2l-7 1 1 6h-2l-3-6-7-2z',
  ally: 'M9 4h6l1 4-2 2v3l3 2v5H7v-5l3-2v-3L8 8z',
};
const svg = (d) =>
  `<svg viewBox="0 0 24 24" class="gIco" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

// 部位的圖示（SLOTS 的分類：arm／back 用武器種類，沒有零件時 none）
export function slotIcon(cat, part) {
  if (cat === 'arm' || cat === 'back') return partIcon(cat, part);
  if (cat === 'consumable') return partIcon(cat, part);
  return svg(P[cat] || P.none);
}
// 零件的圖示
export function partIcon(cat, part) {
  if (!part) return svg(P.none);
  if (cat === 'consumable') {
    if (part.id === 'cs_none') return svg(P.none);
    return svg(part.id === 'cs_ally' ? P.ally : part.id === 'cs_bomber' ? P.bomber : P.consumable);
  }
  if (cat === 'arm' || cat === 'back') return svg(P[part.type] || P.bullet);
  return svg(P[cat] || P.none);
}
