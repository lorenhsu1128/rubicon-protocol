// 模型庫入口：分類頁籤、搜尋、配色切換、格狀檢視、檢視窗（網址 #槽位 id 可直接開啟指定模型）
import { escHtml } from '../core/html.js';
import { PALETTES } from '../render/materials.js';
import { CATEGORIES, MODEL_CATALOG } from '../render/model-catalog.js';
import { ModelGrid } from './grid.js';
import { Inspector } from './inspect.js';

const $ = (id) => document.getElementById(id);
const state = { cat: 'all', q: '' };

const grid = new ModelGrid($('gridGl'), $('grid'), MODEL_CATALOG, (entry) => openEntry(entry));
const inspector = new Inspector(() => {
  grid.paused = false;
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
});

function openEntry(entry) {
  grid.paused = true;
  history.replaceState(null, '', '#' + entry.id);
  inspector.open(entry, grid.palKey);
}

function renderTabs() {
  const count = (id) => MODEL_CATALOG.filter((e) => id === 'all' || e.cat === id).length;
  const tabs = [{ id: 'all', name: '全部' }, ...CATEGORIES];
  $('tabs').innerHTML = tabs
    .map(
      (c) =>
        `<button data-c="${c.id}" class="${state.cat === c.id ? 'sel' : ''}">${escHtml(c.name)}<span class="n">${count(c.id)}</span></button>`,
    )
    .join('');
  for (const b of $('tabs').querySelectorAll('button'))
    b.onclick = () => {
      state.cat = b.dataset.c;
      renderTabs();
      applyFilter();
    };
}
function applyFilter() {
  const q = state.q.trim().toLowerCase();
  const n = grid.filter(
    (e) =>
      (state.cat === 'all' || e.cat === state.cat) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.note || '').includes(q)),
  );
  $('count').textContent = `顯示 ${n} / 共 ${MODEL_CATALOG.length} 個模型槽`;
}

$('search').oninput = (e) => {
  state.q = e.target.value;
  applyFilter();
};
$('palSel').innerHTML =
  `<option value="">各模型預設</option>` +
  Object.keys(PALETTES)
    .map((k) => `<option>${k}</option>`)
    .join('');
$('palSel').onchange = (e) => grid.setPalette(e.target.value || null);

renderTabs();
applyFilter();
// 網址 #head/h_std 直接開啟該模型
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  const entry = id && MODEL_CATALOG.find((e) => e.id === id);
  if (entry && (!inspector.open_ || inspector.entry !== entry)) openEntry(entry);
}
addEventListener('hashchange', openFromHash);
openFromHash();
