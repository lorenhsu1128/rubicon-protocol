// 模型庫入口：分類頁籤、搜尋、配色與來源篩選、格狀檢視、檢視窗、GLB 拖曳替換與對照表匯出
// （網址 #槽位 id 可直接開啟指定模型）
import { escHtml } from '../core/html.js';
import { PALETTES } from '../render/materials.js';
import { CATEGORIES, MODEL_CATALOG } from '../render/model-catalog.js';
import { ModelGrid } from './grid.js';
import { Inspector } from './inspect.js';
import { COMPOSE_CATS } from './stage.js';
import { GlbStore } from './store.js';
import { Workshop } from './workshop.js';
import { GlbEditor } from './editor.js';
import { SetMenu } from './model-sets.js';
import { PaintLink } from './paint-link.js';
import { SERVER_SET, setScoped } from '../render/local-models.js';

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
    return toast(
      entry.cat === 'mech'
        ? '完整機甲由各區塊組成：請把 GLB 拖到各區塊的格子（頭、核心、上臂、前臂…）'
        : entry.parts && entry.parts.length
          ? '這個模型由各區塊組成：請把 GLB 拖到各區塊的格子（' + entry.parts.join('、') + '）'
          : '這個物件在遊戲中由其他物件拼成或沿路線產生，不接受 GLB',
      true,
    );
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

// 來源改變時一併重建：該格、暫用右側檔案的左側武器、所有完整機甲（由區塊組成）、用到這個區塊的完整載具
function refreshRelated(id) {
  grid.refresh(id);
  if (/^(weapon|back)\/.+\/r$/.test(id)) grid.refresh(id.replace(/r$/, 'l'));
  for (const e of MODEL_CATALOG)
    if (e.cat === 'mech' || (e.parts && e.parts.includes(id))) grid.refresh(e.id);
}

// 切換模型組：重建機甲區塊、武器與完整機甲的格子，檢視窗與組裝調整頁改用新的模型組
// （伺服器預設組涵蓋所有分類：切換到它或從它切走時全部重建）
let lastSet = null;
let paint = null;
function onSetSwitch() {
  const all = store.isServer() || lastSet === SERVER_SET;
  lastSet = store.cur;
  for (const e of MODEL_CATALOG) if (all || e.cat === 'mech' || setScoped(e.id)) grid.refresh(e.id);
  if (inspector.open_) inspector.rebuild();
  workshop.useSet();
  if (editor.open_) editor.ref.load().then(() => editor.ctx.build());
  applyFilter();
}

let grid, inspector, workshop, editor, setMenu;
function openWorkshop() {
  grid.paused = true;
  history.replaceState(null, '', '#workshop');
  workshop.open();
}
// GLB 編輯器：網址 #editor 或 #editor=槽位 id
function openEditor(slot) {
  if (inspector.open_) inspector.close();
  grid.paused = true;
  history.replaceState(null, '', '#editor' + (slot ? '=' + slot : ''));
  editor.open(slot);
}
function openEntry(entry) {
  // 從編輯頁、組裝調整頁以網址切換到模型時，先關掉全螢幕頁面
  if (editor.open_) editor.close();
  if (workshop.open_) workshop.close();
  grid.paused = true;
  history.replaceState(null, '', '#' + entry.id);
  inspector.open(entry, grid.palKey);
}

function renderTabs() {
  const count = (id) => MODEL_CATALOG.filter((e) => id === 'all' || e.cat === id).length;
  const tabs = [{ id: 'all', name: '全部' }, ...CATEGORIES];
  $('tabs').innerHTML =
    tabs
      .map(
        (c) =>
          `<button data-c="${c.id}" class="${state.cat === c.id ? 'sel' : ''}">${escHtml(c.name)}<span class="n">${count(c.id)}</span></button>`,
      )
      .join('') +
    `<button data-c="workshop" class="wsTab" title="自由預組機甲，在整台機甲上調整連接點">組裝調整</button>` +
    `<button data-c="editor" class="wsTab edTab" title="修正 GLB 的朝向、尺寸、原點與節點">GLB 編輯</button>`;
  for (const b of $('tabs').querySelectorAll('button'))
    b.onclick = () => {
      if (b.dataset.c === 'workshop') return openWorkshop();
      if (b.dataset.c === 'editor') return openEditor(null);
      state.cat = b.dataset.c;
      renderTabs();
      applyFilter();
    };
}
// 回遊戲：從遊戲開的（有 opener）就切回遊戲分頁並關掉這一頁；否則在這一頁開遊戲
function backToGame() {
  if (editor && editor.content && editor.dirty && !confirm('GLB 編輯器有尚未存檔的修改，確定要回遊戲？'))
    return;
  const url = window.RUBICON_SERVER ? '/' : 'rubicon-protocol.html';
  const op = window.opener;
  if (op && !op.closed) {
    try {
      op.focus(); // 跨來源也允許（直接開檔時 file:// 各頁是不同來源）
    } catch (e) {}
    window.close();
    // 瀏覽器不讓關（不是由程式開的分頁）時改成在這一頁開遊戲
    setTimeout(() => {
      if (!window.closed) location.href = url;
    }, 300);
  } else location.href = url;
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
  const jn = store.jointCount();
  if (setMenu) setMenu.render();
  $('count').textContent =
    `顯示 ${n} / 共 ${MODEL_CATALOG.length} 個模型槽・已有 GLB ${glb} 個` + (jn ? `・關節修改 ${jn} 個` : '');
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

// 關節設定：內建 joints.json ＋這個瀏覽器的修改，放到 src/assets/models/joints.json 後重新建置
function exportJoints() {
  const n = store.jointCount();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(store.mergedJoints(), null, 2) + '\n'], { type: 'application/json' }),
  );
  a.download = 'joints.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`已匯出 joints.json（含這個瀏覽器的 ${n} 個修改）：放到 src/assets/models/joints.json 後重新建置`);
}

async function main() {
  await store.load({
    onBlocked: () => {
      if ($('dbNotice')) return;
      const el = document.createElement('div');
      el.id = 'dbNotice';
      el.innerHTML =
        '<b>模型庫正在升級資料格式（模型組）</b>' +
        '<p>還有其他開著的模型庫分頁（舊版頁面）佔住資料，升級無法進行。</p>' +
        '<p>請<b>關閉或重新整理其他所有模型庫分頁</b>，這一頁會自動繼續載入；原本的 GLB 與關節設定會搬進「預設」模型組，不會遺失。</p>';
      document.body.appendChild(el);
    },
    onReady: () => {
      if ($('dbNotice')) $('dbNotice').remove();
    },
  });
  grid = new ModelGrid($('gridGl'), $('grid'), MODEL_CATALOG, {
    onOpen: (entry) => openEntry(entry),
    onDrop: useFile,
    store,
  });
  $('gridCols').value = String(grid.cols);
  $('gridSpin').checked = grid.spinAll;
  $('gridCols').onchange = (e) => {
    grid.setCols(Number(e.target.value) || 3);
    $('gridSpin').checked = grid.spinAll;
  };
  $('gridSpin').onchange = (e) => grid.setSpin(e.target.checked);
  $('btnBack').onclick = backToGame;
  inspector = new Inspector({
    store,
    onFile: useFile,
    onRemove: removeFile,
    onError: (msg) => toast(msg, true),
    onJoints: () => {
      for (const e of MODEL_CATALOG) if (e.cat === 'mech') grid.refresh(e.id);
      applyFilter();
    },
    onEdit: (id) => openEditor(id),
    onPaint: (entry) => paint.open(entry),
    // 匯入機甲：新增或改了模型組（切換到它）→ 和模型組選單的切換相同
    onSets: (msg) => setMenu.changed(msg),
    onClose: () => {
      grid.paused = false;
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    },
  });
  editor = new GlbEditor({
    store,
    toast,
    onSaved: (id) => {
      refreshRelated(id);
      applyFilter();
    },
    onInspect: (id) => {
      const entry = MODEL_CATALOG.find((e) => e.id === id);
      if (!entry) return;
      editor.close();
      grid.paused = true;
      history.replaceState(null, '', '#' + id);
      inspector.open(entry, grid.palKey, COMPOSE_CATS.includes(entry.cat) ? 'compose' : 'single');
    },
    // 匯入機甲：新增或改了模型組（切換到它）→ 和模型組選單的切換相同
    onSets: (msg) => setMenu.changed(msg),
    onClose: () => {
      grid.paused = false;
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    },
  });
  // 冒煙測試用：網址帶 ?test 時讓測試取得編輯器（算控制點在畫面上的位置）
  if (/[?&]test\b/.test(location.search)) window.__glbEditor = editor;
  workshop = new Workshop({
    store,
    toast,
    onJoints: () => {
      for (const e of MODEL_CATALOG) if (e.cat === 'mech') grid.refresh(e.id);
      applyFilter();
    },
    onSaved: (id) => {
      refreshRelated(id);
      applyFilter();
    },
    // 匯入機甲：新增或改了模型組（切換到它）→ 和模型組選單的切換相同
    onSets: (msg) => setMenu.changed(msg),
    onClose: () => {
      grid.paused = false;
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    },
  });
  if (/[?&]test\b/.test(location.search)) window.__workshop = workshop;
  // 貼圖繪製：存回時和拖曳替換一樣更新格子與檢視窗
  paint = new PaintLink({
    store,
    toast,
    onSaved: async (entry) => {
      refreshRelated(entry.id);
      if (inspector.open_ && inspector.entry === entry) await inspector.rebuild();
      applyFilter();
    },
  });
  $('btnPaint').onclick = () => paint.openTool();
  lastSet = store.cur;
  setMenu = new SetMenu({ store, toast, onSwitch: onSetSwitch });
  store.onError = (msg) => toast(msg, true);
  // 點選單外面時收起
  addEventListener('pointerdown', (e) => {
    if ($('setMenu').open && !e.target.closest('#setMenu')) $('setMenu').open = false;
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
  $('btnJoints').onclick = $('insJointsExport').onclick = exportJoints;
  // 拖到格子以外的地方：避免瀏覽器直接開啟檔案
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    if (!e.target.closest || !e.target.closest('.cell,#editor'))
      toast('請把 .glb 拖到要替換的那一格上', true);
  });
  renderTabs();
  applyFilter();
  // 網址 #head/h_std 直接開啟該模型
  const openFromHash = () => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id === 'editor' || id.startsWith('editor=')) {
      const slot = id.slice(7) || null;
      if (!editor.open_ || (slot && (!editor.entry || editor.entry.id !== slot))) openEditor(slot);
      return;
    }
    if (id === 'workshop') {
      if (!workshop.open_) openWorkshop();
      return;
    }
    const entry = id && MODEL_CATALOG.find((e) => e.id === id);
    if (entry && (!inspector.open_ || inspector.entry !== entry)) openEntry(entry);
  };
  addEventListener('hashchange', openFromHash);
  openFromHash();
}
main();
