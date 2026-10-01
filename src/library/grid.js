// 模型庫格狀檢視：所有格子共用一個固定在視窗後方的 WebGL 畫布，依各格在畫面上的位置裁切繪製
// （每格各開一個 WebGL 會超過瀏覽器的數量上限）。只有接近畫面的格子才建立模型，每幀最多建一個。
import { escHtml } from '../core/html.js';
import { fmtSize } from '../render/measure.js';
import { animateMech } from '../render/mech-model.js';
import {
  addLights,
  animState,
  disposeObject,
  fitCamera,
  makeRenderer,
  prepareModel,
  scaleText,
} from './stage.js';

const CELL_BG = 0x161b22;

export class ModelGrid {
  constructor(canvas, container, entries, onOpen) {
    this.renderer = makeRenderer(canvas, false);
    this.container = container;
    this.onOpen = onOpen;
    this.palKey = null; // null = 各模型的預設配色
    this.paused = false;
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
      `<div class="view"><div class="loading">載入中…</div></div>` +
      `<div class="meta"><div class="t"><b>${escHtml(entry.name)}</b><span class="badge">程式模型</span></div>` +
      `<div class="dim">${escHtml(entry.id)}${entry.note ? '・' + escHtml(entry.note) : ''}</div>` +
      `<div class="sz dim">—</div></div>`;
    const cell = { entry, el, view: el.querySelector('.view'), near: false, data: null, shown: true };
    el._cell = cell;
    el.onclick = () => this.onOpen(entry);
    this.container.appendChild(el);
    this.observer.observe(el);
    return cell;
  }
  filter(fn) {
    let n = 0;
    for (const c of this.cells) {
      c.shown = fn(c.entry);
      c.el.style.display = c.shown ? '' : 'none';
      if (c.shown) n++;
    }
    return n;
  }
  setPalette(key) {
    this.palKey = key;
    for (const c of this.cells) this.unbuild(c);
  }
  unbuild(c) {
    if (!c.data) return;
    disposeObject(c.data.pivot);
    c.data = null;
    c.view.querySelector('.loading').style.display = '';
  }
  build(c) {
    const d = prepareModel(c.entry, this.palKey);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(CELL_BG);
    addLights(scene);
    const span = Math.max(4, Math.ceil(Math.max(d.size.x, d.size.z) * 1.6));
    const grid = new THREE.GridHelper(span, span <= 30 ? span : span / 5, 0x2a3644, 0x222b36); // 每格 1 m（大型模型 5 m）
    scene.add(grid, d.pivot);
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
    // 每幀建立一個接近畫面的格子
    const todo = this.cells.find((c) => c.shown && c.near && !c.data);
    if (todo) this.build(todo);
    r.setScissorTest(false);
    r.setClearColor(0x0c1016);
    r.clear();
    r.setScissorTest(true);
    for (const c of this.cells) {
      if (!c.data || !c.shown) continue;
      const rc = c.view.getBoundingClientRect();
      if (rc.bottom < 0 || rc.top > H || rc.width < 2) continue;
      const d = c.data;
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
