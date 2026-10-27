// 駕駛員技能樹的圖示（docs/pilot-ui.md）：每個技能一個線條圖示（SVG 字串，24×24、stroke＝currentColor）。
// 分支的圖示另外一組；沒有登記的技能用分支的圖示
const BR = {
  gun: 'M3 10h13l3 1.5-3 1.5h-5l-2 6H6l1-6H3z',
  melee: 'M5 19l3-3 M7 13l4 4 M9 15L19 5l1 1-10 10',
  mob: 'M12 3l5 9h-3v8h-4v-8H7z',
  en: 'M13 2L5 14h6l-2 8 8-12h-6z',
  armor: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  sup: 'M15 3a5 5 0 0 0-4.6 7L4 16.4 7.6 20l6.4-6.4A5 5 0 0 0 21 9l-3 2-3-3 2-3z',
};
const SK = {
  // 射擊
  g_dmg: 'M12 3v5 M12 16v5 M3 12h5 M16 12h5 M12 7a5 5 0 1 0 .01 0 M12 11.2a.8.8 0 1 0 .01 0',
  g_rld: 'M8 4h6l-1 9H9z M9 13l-1 7h4l1-7 M17 7a5 5 0 0 1 1 7 M19 15l-1-1.2-1.5.8',
  g_mag: 'M7 3h8l-1 18H8z M8 8h6 M8 12h6 M8 16h6',
  g_fcs: 'M4 18a10 10 0 0 1 16 0 M7 18a7 7 0 0 1 10 0 M12 18L17 9 M12 18a1 1 0 1 0 .01 0',
  g_cap: 'M3 12h11 M10 8l4 4-4 4 M17 6a7 7 0 0 1 0 12 M17 9.5a3 3 0 0 1 0 5',
  // 近戰
  m_dmg: 'M5 19l3-3 M7 13l4 4 M9 15L19 5l1 1-10 10 M16 4l4 4',
  m_en: 'M4 20L15 9l1 1L5 21z M18 3l-3 5h3l-2 4',
  m_imp: 'M9 3h6v6H9z M12 9v4 M5 21l7-8 7 8 M3 15h3 M18 15h3',
  m_rch: 'M4 20L18 6 M14 5h5v5 M4 14a10 10 0 0 1 6-6 M10 20a10 10 0 0 0 6-6',
  m_cap: 'M4 20L16 8 M8 20L20 8 M14 5l5 0 0 5 M3 11a9 9 0 0 1 8-8',
  // 機動
  v_spd: 'M4 16h9l5-5 M4 12h6 M4 8h9 M15 16a3 3 0 1 0 .01 0',
  v_qbc: 'M7 4h7l-2 6h4l-7 10 2-7H7z M18 5v4 M16 7h4',
  v_qb: 'M3 12h7 M5 8h6 M5 16h6 M13 7l7 5-7 5z',
  v_air: 'M12 4v9 M8 8l4-4 4 4 M5 20c2-2 4-2 7-2s5 0 7 2 M7 16h10',
  v_cap: 'M6 6h5v12H6z M13 6h3v12h-3 M18 6h1v12h-1',
  // 能源
  e_cap: 'M5 7h12v10H5z M17 10h2v4h-2 M7 9h3v6H7z M11 9h3v6h-3',
  e_rch: 'M5 7h12v10H5z M17 10h2v4h-2 M12 8l-3 4h3l-2 4',
  e_dly: 'M12 4a8 8 0 1 0 .01 0 M12 8v4l3 2 M4 4l3 3',
  e_wpn: 'M3 11h10l7 1-7 1H3z M15 7l4-3 M15 16l4 3 M6 8l1 3 M6 16l1-3',
  e_gnd: 'M3 20h18 M12 4l-4 7h3l-1 6 5-8h-3l1-5z M5 17h3 M16 17h3',
  // 裝甲
  a_ap: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M12 9v6 M9 12h6',
  a_stb: 'M5 20h14 M7 20l2-8h6l2 8 M12 12V5 M9 5h6',
  a_def: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M8 9l8 0 M8 13h8',
  a_rec: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M9 12a3 3 0 1 1 3 3 M9 9v3h3',
  a_cap: 'M6 21V5l6-2 6 2v16 M9 8h6 M9 12h6 M9 16h6',
  // 支援
  s_kit: 'M5 7h14v12H5z M9 7V4h6v3 M12 10v6 M9 13h6',
  s_kitn: 'M4 9h10v10H4z M10 5h10v10 M9 12v4 M7 14h4',
  s_x1: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z M12 8v5 M12 16v.5',
  s_x2: 'M12 4a8 8 0 1 0 .01 0 M14.5 9c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.6 2.5 2 2.5.9 2.5 2.1-1 2-2.5 2-2-.5-2.5-1.5 M12 6.5v1 M12 16.5v1',
  s_cap: 'M7 12h10 M12 7v10 M12 3a9 9 0 1 0 .01 0',
};
const svg = (d) =>
  `<svg viewBox="0 0 24 24" class="pIco" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

export function skillIcon(id, br) {
  return svg(SK[id] || BR[br] || BR.gun);
}
export function branchIcon(br) {
  return svg(BR[br] || BR.gun);
}
