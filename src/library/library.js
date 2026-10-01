// 模型庫入口：分類頁籤、搜尋、配色與來源篩選、格狀檢視、檢視窗、GLB 拖曳替換與對照表匯出
// （網址 #槽位 id 可直接開啟指定模型）
import { escHtml } from '../core/html.js';
import { PALETTES } from '../render/materials.js';
import { CATEGORIES, MODEL_CATALOG } from '../render/model-catalog.js';
import { ModelGrid } from './grid.js';
import { Inspector } from './inspect.js';
import { GlbStore } from './store.js';

const $ = (id) => document.getElementById(id);
const state = { cat: 'all', q: '', src: '' };
const store = new GlbStore();

function toast(text, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

// 拖曳／載入 GLB：確認是 glTF 二進位檔才存進瀏覽器
async function useFile(entry, file) {
  if (entry.noGlb)
    return toast('完整機甲由各區塊組成：請把 GLB 拖到各區塊的格子（頭、核心、上臂、前臂…）', true);
  if (!/\.glb$/i.test(file.name)) return toast('只接受 .glb 檔（glTF 二進位）', true);
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (String.fromCharCode(...head) !== 'glTF') throw new Error('不是有效的 GLB 檔');
    await store.put(entry.id, file);
  } catch (e) {
    return toast(`無法使用 ${file.name}：${e.message || e}`, true);
  }
  toast(`已替換「${entry.name}」：${file.name}${store.ok ? '' : '（瀏覽器無法保存，重新整理後會消失）'}`);
  refreshRelated(entry.id);
  if (inspector.open_ && inspector.entry === entry) await inspector.rebuild();
  applyFilter();
}
async function removeFile(entry) {
  await store.remove(entry.id);
  toast(`已移除「${entry.name}」的瀏覽器暫存 GLB`);
  refreshRelated(entry.id);
  if (inspector.open_ && inspector.entry === entry) await inspector.rebuild();
  applyFilter();
}

// 來源改變時一併重建：該格、暫用右側檔案的左側武器、所有完整機甲（由區塊組成）
function refreshRelated(id) {
  grid.refresh(id);
  if (/^(weapon|back)\/.+\/r$/.test(id)) grid.refresh(id.replace(/r$/, 'l'));
  for (const e of MODEL_CATALOG) if (e.cat === 'mech') grid.refresh(e.id);
}

let grid, inspector;
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
      (!state.src || store.source(e.id).kind === state.src) &&
      (!q ||
        e.name.toLowerCase().includes(q) ||
        e.id.toLowerCase().includes(q) ||
        (e.note || '').includes(q)),
  );
  const glb = MODEL_CATALOG.filter((e) => store.source(e.id).kind === 'glb').length;
  $('count').textContent = `顯示 ${n} / 共 ${MODEL_CATALOG.length} 個模型槽・已有 GLB ${glb} 個`;
}

// 對照表：每個槽位的來源、檔案、目標路徑、尺寸與檢查結果
function exportManifest() {
  const rows = MODEL_CATALOG.map((e) => {
    const src = store.source(e.id);
    const c = grid.cellOf(e.id);
    const d = c && c.data && !c.data.pending ? c.data : null;
    return {
      slot: e.id,
      name: e.name,
      category: (CATEGORIES.find((x) => x.id === e.cat) || {}).name,
      source: src.kind === 'glb' ? (src.origin === 'builtin' ? '內建' : '瀏覽器暫存') : '程式模型',
      file: src.kind === 'glb' ? src.name : null,
      bytes: src.kind === 'glb' ? src.size : null,
      target: `src/assets/models/${e.id}.glb`,
      sizeM: d ? [d.size.x, d.size.y, d.size.z].map((v) => +v.toFixed(3)) : null,
      check: d && d.summary ? d.summary : null,
    };
  });
  const out = {
    exportedAt: new Date().toISOString(),
    note: '槽位 id 即 GLB 檔名；採用的檔案放到 target 路徑後重新建置。sizeM 與 check 為格子建立時的結果（尚未捲動到的格子為 null）。',
    glbCount: rows.filter((r) => r.file).length,
    slots: rows,
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = 'rubicon-model-manifest.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function main() {
  await store.load();
  grid = new ModelGrid($('gridGl'), $('grid'), MODEL_CATALOG, {
    onOpen: (entry) => openEntry(entry),
    onDrop: useFile,
    store,
  });
  inspector = new Inspector({
    store,
    onFile: useFile,
    onRemove: removeFile,
    onClose: () => {
      grid.paused = false;
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    },
  });
  $('search').oninput = (e) => {
    state.q = e.target.value;
    applyFilter();
  };
  $('srcSel').onchange = (e) => {
    state.src = e.target.value;
    applyFilter();
  };
  $('palSel').innerHTML =
    `<option value="">各模型預設</option>` +
    Object.keys(PALETTES)
      .map((k) => `<option>${k}</option>`)
      .join('');
  $('palSel').onchange = (e) => grid.setPalette(e.target.value || null);
  $('btnManifest').onclick = exportManifest;
  // 拖到格子以外的地方：避免瀏覽器直接開啟檔案
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    if (!e.target.closest || !e.target.closest('.cell')) toast('請把 .glb 拖到要替換的那一格上', true);
  });
  renderTabs();
  applyFilter();
  // 網址 #head/h_std 直接開啟該模型
  const openFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    const entry = id && MODEL_CATALOG.find((e) => e.id === id);
    if (entry && (!inspector.open_ || inspector.entry !== entry)) openEntry(entry);
  };
  addEventListener('hashchange', openFromHash);
  openFromHash();
}
main();
