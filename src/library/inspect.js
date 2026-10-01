// 模型庫檢視窗：放大檢視單一模型（滑鼠／觸控旋轉縮放）、後處理、尺寸參考物、配色與光線、動作預覽
import { escHtml } from '../core/html.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { PALETTES } from '../render/materials.js';
import { fmtSize } from '../render/measure.js';
import { CATEGORIES } from '../render/model-catalog.js';
import { animateMech } from '../render/mech-model.js';
import { THEMES } from '../world/world.js';
import { buildDims, buildGrid, buildHuman, buildRuler } from './refs.js';
import {
  ANIMS,
  addLights,
  animState,
  applyLight,
  disposeObject,
  fitCamera,
  makeRenderer,
  prepareModel,
  scaleText,
} from './stage.js';

const $ = (id) => document.getElementById(id);
const TOGGLES = [
  ['dims', '尺寸標線', true],
  ['box', '外框', true],
  ['ruler', '刻度尺', true],
  ['human', '人形 1.8 m', true],
  ['grid', '1 m 格線', true],
  ['outline', '描邊', true],
  ['post', '後處理（Bloom／SSAO）', true],
  ['shadow', '陰影', true],
  ['rotate', '自動旋轉', false],
];

export class Inspector {
  constructor(onClose) {
    this.onClose = onClose;
    this.canvas = $('insGl');
    this.renderer = makeRenderer(this.canvas, true);
    this.scene = new THREE.Scene();
    this.lights = addLights(this.scene);
    this.lights.sun.castShadow = true;
    this.lights.sun.shadow.mapSize.set(2048, 2048);
    applyLight(this.scene, this.lights, null);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2000);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.opts = Object.fromEntries(TOGGLES.map(([k, , v]) => [k, v]));
    this.anim = 'garage';
    this.t = 0;
    this.open_ = false;
    this.setupPost();
    this.setupUi();
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open_) this.close();
    });
    $('insClose').onclick = () => this.close();
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }
  setupPost() {
    this.composer = null;
    if (!THREE.EffectComposer || !THREE.SSAOPass) return;
    try {
      const c = new THREE.EffectComposer(this.renderer);
      c.addPass(new THREE.RenderPass(this.scene, this.camera));
      this.ssao = new THREE.SSAOPass(this.scene, this.camera, 16, 16);
      this.ssao.kernelRadius = 0.5;
      this.ssao.minDistance = 0.001;
      this.ssao.maxDistance = 0.03;
      c.addPass(this.ssao);
      c.addPass(new THREE.UnrealBloomPass(new THREE.Vector2(16, 16), 0.4, 0.4, 0.9));
      c.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
      this.composer = c;
    } catch (e) {
      console.warn('post failed', e);
    }
  }
  setupUi() {
    $('insToggles').innerHTML = TOGGLES.map(
      ([k, name]) => `<label><input type="checkbox" data-k="${k}"> ${name}</label>`,
    ).join('');
    for (const cb of $('insToggles').querySelectorAll('input')) {
      cb.checked = this.opts[cb.dataset.k];
      cb.onchange = () => {
        this.opts[cb.dataset.k] = cb.checked;
        this.applyOpts();
      };
    }
    $('insPal').innerHTML =
      `<option value="">預設</option>` +
      Object.keys(PALETTES)
        .map((k) => `<option>${k}</option>`)
        .join('');
    $('insPal').onchange = () => this.rebuild();
    $('insLight').innerHTML =
      `<option value="">車庫</option>` +
      Object.entries(THEMES)
        .map(([k, t]) => `<option value="${k}">${escHtml(t.name)}</option>`)
        .join('');
    $('insLight').onchange = () => applyLight(this.scene, this.lights, THEMES[$('insLight').value] || null);
    $('insAnims').innerHTML = ANIMS.map(([k, n]) => `<button data-a="${k}">${n}</button>`).join('');
    for (const b of $('insAnims').querySelectorAll('button'))
      b.onclick = () => {
        this.anim = b.dataset.a;
        this.markAnim();
      };
  }
  markAnim() {
    for (const b of $('insAnims').querySelectorAll('button'))
      b.classList.toggle('sel', b.dataset.a === this.anim);
  }
  open(entry, palKey) {
    this.entry = entry;
    $('insPal').value = palKey || '';
    $('inspect').hidden = false;
    this.open_ = true;
    this.anim = 'garage';
    this.markAnim();
    this.rebuild();
  }
  close() {
    $('inspect').hidden = true;
    this.open_ = false;
    this.clear();
    if (this.onClose) this.onClose();
  }
  clear() {
    for (const o of [
      this.data && this.data.pivot,
      this.refs && this.refs.grid,
      this.refs && this.refs.ruler.group,
      this.refs && this.refs.human.group,
    ]) {
      if (!o) continue;
      this.scene.remove(o);
      disposeObject(o);
    }
    this.data = null;
    this.refs = null;
    $('insLabels').innerHTML = '';
  }
  rebuild() {
    this.clear();
    const e = this.entry;
    const d = prepareModel(e, $('insPal').value || null);
    this.data = d;
    this.scene.add(d.pivot);
    // 參考物
    const grid = buildGrid(d.size),
      ruler = buildRuler(d.size),
      human = buildHuman(d.size),
      dims = buildDims(d.size);
    d.pivot.add(dims.dims, dims.box);
    this.scene.add(grid, ruler.group, human.group);
    this.refs = { grid, ruler, human, dims };
    this.labels = [
      ...dims.labels.map((l) => ({ ...l, key: 'dims', obj: d.pivot })),
      ...ruler.labels.map((l) => ({ ...l, key: 'ruler', obj: this.scene })),
      ...human.labels.map((l) => ({ ...l, key: 'human', obj: this.scene })),
    ];
    const box = $('insLabels');
    box.innerHTML = '';
    for (const l of this.labels) {
      l.el = document.createElement('div');
      l.el.className = 'lbl ' + l.cls;
      l.el.textContent = l.text;
      box.appendChild(l.el);
    }
    // 陰影範圍
    const r = Math.max(4, d.size.length());
    const sc = this.lights.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 0.5;
    sc.far = r * 6;
    sc.updateProjectionMatrix();
    this.lights.sun.position.set(r * 0.6, r * 1.4, -r * 0.8);
    this.resize(true);
    this.controls.target.copy(fitCamera(this.camera, d.size, this.camera.aspect, 1.6));
    this.controls.update();
    this.renderInfo();
    this.applyOpts();
    $('insPal').disabled = !!e.noPal; // 地圖物件等沒有陣營配色
    const rig = d.built.rig;
    const canAnim = rig && !rig.vehicle;
    $('insAnimH').style.display = $('insAnims').style.display = canAnim ? '' : 'none';
  }
  renderInfo() {
    const e = this.entry,
      d = this.data;
    const cat = CATEGORIES.find((c) => c.id === e.cat);
    $('insName').textContent = e.name;
    $('insId').textContent = `${e.id}${e.note ? '・' + e.note : ''}`;
    const st = scaleText(d.scale);
    const rows = [
      ['分類', cat ? cat.name : e.cat],
      ['來源', '程式模型（three.js）'],
      ['遊戲尺寸（寬×高×深）', fmtSize(d.size)],
      ...(st
        ? [
            ['原始尺寸', fmtSize(d.sizeOrig)],
            ['遊戲縮放', st + (e.scaleNote ? `（${e.scaleNote}）` : '')],
          ]
        : []),
      ['三角面', d.stats.tris.toLocaleString()],
      ['繪製次數', d.stats.draws],
      ['材質', d.stats.materials],
      ['貼圖', d.stats.textures ? `${d.stats.textures} 張（最大 ${d.stats.maxTex}px）` : '無'],
    ];
    $('insInfo').innerHTML = rows
      .map(
        (r) => `<div class="kv"><span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span></div>`,
      )
      .join('');
  }
  applyOpts() {
    const o = this.opts,
      R = this.refs;
    if (!R) return;
    R.dims.dims.visible = o.dims;
    R.dims.box.visible = o.box;
    R.ruler.group.visible = o.ruler;
    R.human.group.visible = o.human;
    R.grid.visible = o.grid;
    this.data.pivot.traverse((m) => {
      if (m.isMesh && m.material === OUTLINE_MAT) m.visible = o.outline;
    });
    this.renderer.shadowMap.enabled = o.shadow;
    this.lights.sun.castShadow = o.shadow;
    this.scene.traverse((m) => {
      if (m.material) m.material.needsUpdate = true;
    });
  }
  resize(force) {
    const el = this.canvas.parentElement;
    const w = el.clientWidth,
      h = el.clientHeight;
    if (!force && this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const pr = this.renderer.getPixelRatio();
      this.composer.setSize(w, h);
      this.ssao.setSize(w * pr, h * pr);
    }
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.open_ || !this.data) return;
    this.t += dt;
    this.resize(false);
    const d = this.data;
    if (this.opts.rotate) d.pivot.rotation.y += dt * 0.4;
    const rig = d.built.rig;
    if (rig) animateMech(rig, dt, rig.vehicle ? { t: this.t } : animState(this.anim, this.t));
    this.controls.update();
    if (this.opts.post && this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }
  updateLabels() {
    const w = this.w,
      h = this.h,
      v = new THREE.Vector3();
    for (const l of this.labels) {
      const show = this.opts[l.key];
      if (!show) {
        l.el.style.display = 'none';
        continue;
      }
      v.copy(l.pos);
      l.obj.localToWorld(v);
      v.project(this.camera);
      if (v.z > 1 || v.z < -1) {
        l.el.style.display = 'none';
        continue;
      }
      l.el.style.display = '';
      l.el.style.left = ((v.x + 1) / 2) * w + 'px';
      l.el.style.top = ((1 - v.y) / 2) * h + 'px';
    }
  }
}
