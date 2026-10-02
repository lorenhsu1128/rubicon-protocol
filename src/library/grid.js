// 模型庫格狀檢視：所有格子共用一個固定在視窗後方的 WebGL 畫布，依各格在畫面上的位置裁切繪製
// （每格各開一個 WebGL 會超過瀏覽器的數量上限）。只有接近畫面的格子才建立模型，一次建一個。
// 有 GLB 的格子顯示 GLB（瀏覽器暫存＞內建），沒有則顯示程式模型；可把 GLB 拖曳到格子上替換。
import { escHtml } from '../core/html.js';
import { fmtSize } from '../render/measure.js';
import { animateMech, mechPieces } from '../render/mech-model.js';
import { buildAxes } from './refs.js';
import {
  addLights,
  animState,
  disposeObject,
  fitCamera,
  makeRenderer,
  prepareModel,
  prepareSource,
  scaleText,
} from './stage.js';

const CELL_BG = 0x161b22;

// 來源標籤：程式模型／GLB ✓／GLB ⚠ N／GLB ✗ N；完整機甲為「組合」＋使用 GLB 的區塊數
export function sourceBadge(d, src, entry, store) {
  let comp = d && d.source && d.source.kind === 'composite' ? d.source : null;
  if (!comp && entry && (entry.cat === 'mech' || entry.parts) && store)
    comp = {
      glbSlots: (entry.parts || mechPieces(entry.asm).map((i) => i.slot)).filter(
        (id) => store.source(id).kind === 'glb',
      ),
    };
  if (comp)
    return comp.glbSlots.length
      ? { cls: 'glb', text: `組合・GLB ${comp.glbSlots.length}`, title: comp.glbSlots.join('\n') }
      : { cls: '', text: '組合', title: '由各區塊組合而成（目前都是程式模型）' };
  if (!src || src.kind !== 'glb')
    return { cls: '', text: '程式模型', title: '尚未提供 GLB，顯示 three.js 程式模型' };
  const origin = (src.origin === 'builtin' ? '內建' : '瀏覽器') + (src.fallback ? '，暫用右側' : '');
  if (d && d.loadError) return { cls: 'bad', text: 'GLB 無法讀取', title: d.loadError };
  if (!d || !d.summary) return { cls: 'glb', text: `GLB（${origin}）`, title: src.name };
  const { errors, warns } = d.summary;
  if (errors)
    return { cls: 'bad', text: `GLB ✗${errors}`, title: `${origin}：${src.name}，${errors} 項錯誤` };
  if (warns) return { cls: 'warn', text: `GLB ⚠${warns}`, title: `${origin}：${src.name}，${warns} 項警告` };
  return { cls: 'glb', text: 'GLB ✓', title: `${origin}：${src.name}，規格檢查通過` };
}

export class ModelGrid {
  constructor(canvas, container, entries, { onOpen, onDrop, store }) {
    this.renderer = makeRenderer(canvas, false);
    this.container = container;
    this.onOpen = onOpen;
    this.onDrop = onDrop;
    this.store = store;
    this.palKey = null; // null = 各模型的預設配色
    this.paused = false;
    this.busy = false;
    this.t = 0;
    this.last = performance.now();
    this.observer = new IntersectionObserver(
      (list) => {
        for (const it of list) it.target._cell.near = it.isIntersecting;
      },
      { rootMargin: '400px 0px' },
    );
    this.cells = entries.map((e) => this.makeCell(e));
    requestAnimationFrame(() => this.loop());
  }
  makeCell(entry) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.id = entry.id;
    el.innerHTML =
      `<div class="view"><div class="loading">載入中…</div><div class="dropHint">放開以替換此槽位的 GLB</div></div>` +
      `<div class="meta"><div class="t"><b>${escHtml(entry.name)}</b><span class="badge"></span></div>` +
      `<div class="dim">${escHtml(entry.id)}${entry.note ? '・' + escHtml(entry.note) : ''}</div>` +
      `<div class="sz dim">—</div></div>`;
    const cell = { entry, el, view: el.querySelector('.view'), near: false, data: null, shown: true };
    el._cell = cell;
    el.onclick = () => this.onOpen(entry);
    el.ondragover = (e) => {
      e.preventDefault();
      el.classList.add('drop');
    };
    el.ondragleave = () => el.classList.remove('drop');
    el.ondrop = (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) this.onDrop(entry, f);
    };
    this.container.appendChild(el);
    this.observer.observe(el);
    this.setBadge(cell);
    return cell;
  }
  cellOf(id) {
    return this.cells.find((c) => c.entry.id === id);
  }
  setBadge(c) {
    const b = sourceBadge(c.data, this.store.source(c.entry.id), c.entry, this.store);
    const el = c.el.querySelector('.badge');
    el.className = 'badge ' + b.cls;
    el.textContent = b.text;
    el.title = b.title;
  }
  filter(fn) {
    let n = 0;
    for (const c of this.cells) {
      c.shown = fn(c.entry, c);
      c.el.style.display = c.shown ? '' : 'none';
      if (c.shown) n++;
    }
    return n;
  }
  setPalette(key) {
    this.palKey = key;
    for (const c of this.cells) this.unbuild(c);
  }
  // 來源改變（拖曳替換、移除）後重建該格
  refresh(id) {
    const c = this.cellOf(id);
    if (c) this.unbuild(c);
  }
  unbuild(c) {
    c.tok = (c.tok || 0) + 1; // 進行中的建立結果作廢
    if (c.data && c.data.pivot) disposeObject(c.data.pivot);
    c.data = null;
    c.view.querySelector('.loading').style.display = '';
    this.setBadge(c);
  }
  async build(c) {
    const tok = (c.tok = (c.tok || 0) + 1);
    const src = this.store.source(c.entry.id);
    let d;
    try {
      d = await prepareSource(c.entry, this.palKey, src, this.store);
    } catch (e) {
      // GLB 讀取失敗：顯示程式模型並標示錯誤
      d = prepareModel(c.entry, this.palKey);
      d.loadError = 'GLB 解析失敗：' + (e.message || e);
    }
    if (c.tok !== tok) {
      disposeObject(d.pivot);
      return;
    }
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CELL_BG);
    addLights(scene);
    const span = Math.max(4, Math.ceil(Math.max(d.size.x, d.size.z) * 1.6));
    const grid = new THREE.GridHelper(span, span <= 30 ? span : span / 5, 0x2a3644, 0x222b36); // 每格 1 m（大型模型 5 m）
    scene.add(grid, d.pivot);
    // 原點與三軸（X 紅、Y 綠＝上、Z 藍＝正面），跟著模型轉
    const ax = buildAxes(Math.min(3, Math.max(0.2, Math.max(d.size.x, d.size.y, d.size.z) * 0.3)), {
      sprites: true,
    });
    ax.group.position.copy(d.built.obj.position);
    d.pivot.add(ax.group);
    d.pivot.rotation.y = 0.5;
    const cam = new THREE.PerspectiveCamera(30, 4 / 3, 0.01, 1000);
    fitCamera(cam, d.size, 4 / 3, 1.05);
    c.data = { ...d, scene, cam };
    c.view.querySelector('.loading').style.display = 'none';
    const st = scaleText(d.scale);
    c.el.querySelector('.sz').innerHTML =
      `<span class="size">${fmtSize(d.size)}</span>` +
      (st
        ? `<br><small>原始 ${fmtSize(d.sizeOrig)}　${st}${c.entry.scaleNote ? '（' + c.entry.scaleNote + '）' : ''}</small>`
        : '');
    this.setBadge(c);
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    this.t += dt;
    const r = this.renderer;
    const W = innerWidth,
      H = innerHeight;
    const sz = r.getSize(new THREE.Vector2());
    if (sz.x !== W || sz.y !== H) r.setSize(W, H, false);
    // 一次建立一個接近畫面的格子（GLB 需要非同步解析）
    if (!this.busy) {
      const todo = this.cells.find((c) => c.shown && c.near && !c.data);
      if (todo) {
        this.busy = true;
        todo.data = { pending: true };
        this.build(todo).finally(() => (this.busy = false));
      }
    }
    r.setScissorTest(false);
    r.setClearColor(0x0c1016);
    r.clear();
    r.setScissorTest(true);
    for (const c of this.cells) {
      const d = c.data;
      if (!d || d.pending || !c.shown) continue;
      const rc = c.view.getBoundingClientRect();
      if (rc.bottom < 0 || rc.top > H || rc.width < 2) continue;
      d.pivot.rotation.y += dt * 0.5;
      const rig = d.built.rig;
      if (rig) animateMech(rig, dt, rig.vehicle ? { t: this.t } : animState('garage', this.t));
      const aspect = rc.width / rc.height;
      if (Math.abs(d.cam.aspect - aspect) > 1e-3) {
        d.cam.aspect = aspect;
        fitCamera(d.cam, d.size, aspect, 1.05);
      }
      r.setViewport(rc.left, H - rc.bottom, rc.width, rc.height);
      r.setScissor(rc.left, H - rc.bottom, rc.width, rc.height);
      r.render(d.scene, d.cam);
    }
  }
}
