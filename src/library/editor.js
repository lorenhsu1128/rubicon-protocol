// GLB 編輯器（模型庫的「GLB 編輯」頁籤）：修正 AI 生成等外部 GLB 的朝向、尺寸、原點與節點，
// 以程式模型為參考對齊，套用變換後存回槽位（保留原始檔可還原）、鏡像存到另一側，或下載。
// 編輯中的模型用 glTF 座標：場景裡 frame（繞 Y 轉 180°）＞ xform（整體變換＝原點與模型的關係）＞ 原始場景
import { escHtml } from '../core/html.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { budgetFor, checkGlb, materialSlot, parseGlb } from '../render/glb.js';
import { CONN_NAMES, connOf, pieceConns } from '../render/mech-model.js';
import { CATEGORIES, MODEL_CATALOG } from '../render/model-catalog.js';
import {
  AXES,
  about,
  bakeScene,
  boxIn,
  boxPoint,
  exportGlb,
  fitMatrix,
  mergeByMaterial,
  gameBoxToGltf,
  mirrorSlot,
  orientMatrix,
  triCount,
} from './editor-ops.js';
import { FaceTool } from './editor-del.js';
import { MaterialTool } from './editor-mat.js';
import {
  loadExportOpts,
  processGlb,
  saveExportOpts,
  simplifyGeometry,
  triCountOf,
  weldGeometry,
} from './editor-opt.js';
import { SplitTool } from './editor-split.js';
import { TextureTool, registerOriginals } from './editor-tex.js';
import { buildAxes, buildConnMarker, buildGrid } from './refs.js';
import {
  addLights,
  applyLight,
  disposeObject,
  fitCamera,
  makeRenderer,
  originText,
  referenceBox,
} from './stage.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const GHOST = new THREE.MeshBasicMaterial({
  color: 0x5cc8ff,
  wireframe: true,
  transparent: true,
  opacity: 0.3,
});
const FIT_MODES = [
  ['fit', '外框整體符合'],
  ['height', '高度相同'],
  ['longest', '最長邊相同'],
];
const ANCHORS = [
  ['center', '中心對齊'],
  ['bottom', '底部對齊'],
  ['top', '頂部對齊'],
];
const fmt = (v, d = 3) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
const groundText = (y) =>
  Math.abs(y) < 0.05 ? '貼地' : y < 0 ? `沉入地面 ${(-y).toFixed(2)} m` : `懸空 ${y.toFixed(2)} m`;
const editable = MODEL_CATALOG.filter((e) => !e.noGlb);

export class GlbEditor {
  // store：GlbStore；onSaved(id)：存回槽位後通知模型庫；onInspect(id)：到檢視窗查看
  constructor({ store, toast, onSaved, onInspect, onClose }) {
    this.store = store;
    this.toast = toast;
    this.onSaved = onSaved;
    this.onInspect = onInspect;
    this.onClose = onClose;
    this.open_ = false;
    this.entry = null; // 目標槽位（null＝不指定）
    this.content = null; // 原始場景（glTF 座標）
    this.nodes = [];
    this.sel = null; // null＝整體模型，否則為節點
    this.undo = [];
    this.redo = [];
    this.dirty = false;
    this.pickOrigin = false;
    this.canvas = $('edGl');
    this.renderer = makeRenderer(this.canvas, true);
    this.scene = new THREE.Scene();
    this.lights = addLights(this.scene);
    this.lights.sun.castShadow = true;
    this.lights.sun.shadow.mapSize.set(2048, 2048);
    applyLight(this.scene, this.lights, null);
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.grid = buildGrid(new THREE.Vector3(4, 4, 4));
    this.axes = buildAxes(0.5);
    this.scene.add(this.floor, this.grid, this.axes.group);
    this.frame = new THREE.Group();
    this.frame.rotation.y = Math.PI;
    this.xform = new THREE.Group();
    this.frame.add(this.xform);
    this.scene.add(this.frame);
    this.refObj = null; // 程式模型（半透明線框）
    this.connMarks = [];
    this.selBox = new THREE.BoxHelper(undefined, 0xffd23f);
    this.selBox.material.depthTest = false;
    this.selBox.material.transparent = true;
    this.selBox.renderOrder = 25;
    this.selBox.visible = false;
    this.scene.add(this.selBox);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2000);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.show = { ref: true, conns: true, grid: true };
    this.tc = null;
    if (THREE.TransformControls) {
      const tc = new THREE.TransformControls(this.camera, this.canvas);
      tc.setSize(0.85);
      tc.addEventListener('dragging-changed', (e) => {
        this.controls.enabled = !e.value && !this.split.boxMode && !this.mat.boxMode;
        if (this.faces.on) return;
        this.dragging = e.value;
        if (this.split.cutting) return; // 拖曳的是切割平面
        if (this.originMode) {
          if (!e.value) this.applyOriginHandle();
          return;
        }
        if (e.value) this.pushUndo();
        else this.changed();
      });
      tc.addEventListener(
        'objectChange',
        () => !this.split.cutting && !this.originMode && this.writeDetail(),
      );
      this.scene.add(tc);
      this.tc = tc;
    }
    // 拖曳原點的把手（glTF 座標，放在 frame 裡）
    this.originMode = false;
    this.oh = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xff8a3d, depthTest: false, transparent: true }),
    );
    this.oh.renderOrder = 30;
    this.oh.visible = false;
    this.frame.add(this.oh);
    // 程式模型的原點（在場景原點）：黃色圓環＋十字，作為設定原點的參考
    this.refOrigin = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false, transparent: true });
    for (const r of [
      [Math.PI / 2, 0],
      [0, 0],
      [0, Math.PI / 2],
    ]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.006, 6, 32), ringMat);
      ring.rotation.set(r[0], r[1], 0);
      ring.renderOrder = 29;
      this.refOrigin.add(ring);
    }
    this.refOrigin.visible = false;
    this.scene.add(this.refOrigin);
    this.mode = 'translate';
    this.buildLabels();
    this.split = new SplitTool(this);
    this.mat = new MaterialTool(this);
    this.tex = new TextureTool(this);
    this.faces = new FaceTool(this);
    this.exportOpts = loadExportOpts();
    this.setupUi();
    this.mat.setupUi();
    this.tex.setupUi();
    this.faces.setupUi();
    this.setupOpt();
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  // ---------- 開關 ----------
  async open(slot) {
    $('editor').hidden = false;
    this.open_ = true;
    this.resize(true);
    if (slot && (!this.entry || this.entry.id !== slot)) {
      if (this.content && this.dirty && !confirm('目前的修改尚未存檔，確定要切換到其他槽位？')) return;
      this.setSlot(slot);
      await this.loadFromSlot(true);
    } else if (!this.content) this.frameView();
    this.render();
  }
  close() {
    $('editor').hidden = true;
    this.open_ = false;
    if (this.onClose) this.onClose();
  }

  // ---------- 介面 ----------
  setupUi() {
    $('edBack').onclick = () => this.close();
    const groups = CATEGORIES.map((c) => {
      const list = editable.filter((e) => e.cat === c.id);
      return list.length
        ? `<optgroup label="${escHtml(c.name)}">` +
            list
              .map((e) => `<option value="${escHtml(e.id)}">${escHtml(e.name)}（${escHtml(e.id)}）</option>`)
              .join('') +
            `</optgroup>`
        : '';
    }).join('');
    $('edSlot').innerHTML = `<option value="">（不指定槽位）</option>` + groups;
    $('edSlot').onchange = () => this.setSlot($('edSlot').value || null);
    $('edOpen').onclick = () => $('edFile').click();
    $('edFile').onchange = async () => {
      const f = $('edFile').files[0];
      $('edFile').value = '';
      if (f) await this.loadFile(f);
    };
    $('edFromSlot').onclick = () => this.loadFromSlot(false);
    $('edAdd').onclick = () => $('edAddFile').click();
    $('edAddFile').onchange = async () => {
      const f = $('edAddFile').files[0];
      $('edAddFile').value = '';
      if (f) await this.addFile(f);
    };
    $('edRevert').onclick = () => this.revert();
    $('edSplitOn').onclick = () => this.split.toggle();
    const view = $('edView');
    view.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    view.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) this.loadFile(f);
    });
    // 工具列
    $('edToolbar').innerHTML =
      `<div class="wsTools btns">` +
      `<button data-m="translate" title="拖曳箭頭移動（W）">移動</button>` +
      `<button data-m="rotate" title="拖曳旋轉環旋轉（E）">旋轉</button>` +
      `<button data-m="scale" title="拖曳縮放（R）">縮放</button></div>` +
      `<div class="wsTools btns"><button id="edUndo" title="復原（Ctrl+Z）">↶ 復原</button>` +
      `<button id="edRedo" title="重做（Ctrl+Y）">↷ 重做</button>` +
      `<button id="edFrameBtn" title="重新取景（F）">取景</button></div>` +
      `<div class="wsTools btns wsShow"><span class="small dim">顯示</span>` +
      [
        ['ref', '程式模型對照'],
        ['conns', '連接點'],
        ['grid', '格線'],
      ]
        .map(
          ([k, n]) =>
            `<label class="tog"><input type="checkbox" data-show="${k}"${this.show[k] ? ' checked' : ''}> ${n}</label>`,
        )
        .join('') +
      `</div>`;
    for (const b of $('edToolbar').querySelectorAll('[data-m]')) b.onclick = () => this.setMode(b.dataset.m);
    for (const c of $('edToolbar').querySelectorAll('[data-show]'))
      c.onchange = () => {
        this.show[c.dataset.show] = c.checked;
        this.applyShow();
      };
    $('edUndo').onclick = () => this.step(true);
    $('edRedo').onclick = () => this.step(false);
    $('edFrameBtn').onclick = () => this.frameView();
    // 朝向
    const axisOpts = Object.keys(AXES)
      .map((k) => `<option>${k}</option>`)
      .join('');
    $('edFront').innerHTML = axisOpts;
    $('edUp').innerHTML = axisOpts;
    $('edFront').value = '+Z';
    $('edUp').value = '+Y';
    $('edOrient').onclick = () => {
      const m = orientMatrix($('edFront').value, $('edUp').value);
      if (!m) return this.toast('正面與上方不能是同一條軸', true);
      this.applyWorld(m, true);
      $('edFront').value = '+Z';
      $('edUp').value = '+Y';
    };
    for (const b of document.querySelectorAll('#edRot button'))
      b.onclick = () => {
        const [ax, deg] = [b.dataset.ax, +b.dataset.deg];
        const m = new THREE.Matrix4()[{ x: 'makeRotationX', y: 'makeRotationY', z: 'makeRotationZ' }[ax]](
          deg * D2R,
        );
        this.applyWorld(m, true);
      };
    $('edMirror').onclick = () => this.applyWorld(new THREE.Matrix4().makeScale(-1, 1, 1), true);
    // 尺寸
    $('edFitMode').innerHTML = FIT_MODES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('edAnchor').innerHTML = ANCHORS.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('edFit').onclick = () => this.fitToRef();
    $('edHeightGo').onclick = () => {
      const h = parseFloat($('edHeight').value);
      const b = this.box();
      const cur = b.getSize(new THREE.Vector3()).y;
      if (!(h > 0) || !(cur > 1e-6)) return this.toast('請輸入大於 0 的高度', true);
      const s = h / cur;
      this.applyWorld(new THREE.Matrix4().makeScale(s, s, s), false);
    };
    $('edScaleGo').onclick = () => {
      const s = parseFloat($('edScaleK').value);
      if (!(s > 0)) return this.toast('請輸入大於 0 的倍率', true);
      this.applyWorld(new THREE.Matrix4().makeScale(s, s, s), false);
    };
    // 原點
    for (const b of document.querySelectorAll('#edOrigin button[data-o]'))
      b.onclick = () => this.setOrigin(boxPoint(this.box(), b.dataset.o));
    $('edOriginDrag').onclick = () => this.setOriginMode(!this.originMode);
    $('edPick').onclick = () => {
      this.pickOrigin = !this.pickOrigin;
      $('edPick').classList.toggle('sel', this.pickOrigin);
      if (this.pickOrigin) this.toast('在模型上點一下，設定為原點（Esc 取消）');
    };
    // 存檔
    $('edSave').onclick = () => this.saveToSlot(false);
    $('edSaveMirror').onclick = () => this.saveToSlot(true);
    $('edDownload').onclick = () => this.download();
    $('edInspect').onclick = () => this.entry && this.onInspect && this.onInspect(this.entry.id);
    // 點選：節點或設定原點
    let down = null;
    this.canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    this.canvas.addEventListener('pointerup', (e) => {
      if (!down || this.dragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      this.pick(e);
    });
    addEventListener('keydown', (e) => {
      if (!this.open_ || e.target.closest('input,select,textarea')) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) {
        e.preventDefault();
        return this.step(!e.shiftKey);
      }
      if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) {
        e.preventDefault();
        return this.step(false);
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === 'Escape') {
        if (this.faces.on) {
          if (this.faces.count()) this.faces.clear();
          else this.faces.setOn(false);
          return;
        }
        if (this.originMode) this.setOriginMode(false);
        else if (this.pickOrigin) {
          this.pickOrigin = false;
          $('edPick').classList.remove('sel');
        } else this.close();
        return;
      }
      if (k === 'w' || k === 'W') return this.setMode('translate');
      if (k === 'e' || k === 'E') return this.setMode('rotate');
      if (k === 'r' || k === 'R') return this.setMode('scale');
      if (k === 'f' || k === 'F') return this.frameView();
      if (k === 'Delete' && this.faces.count()) return this.faces.deleteSel();
      if (k === 'Delete' && this.sel && !this.split.cutting) return this.removeNode(this.sel);
    });
    this.setMode(this.mode);
    this.renderAll();
  }
  setMode(m) {
    this.mode = m;
    if (this.tc) {
      this.tc.setMode(m);
      this.tc.setSpace(m === 'translate' ? 'world' : 'local');
    }
    for (const b of $('edToolbar').querySelectorAll('[data-m]')) b.classList.toggle('sel', b.dataset.m === m);
  }

  // ---------- 槽位 ----------
  setSlot(id) {
    this.entry = (id && editable.find((e) => e.id === id)) || null;
    $('edSlot').value = this.entry ? this.entry.id : '';
    $('edOptTris').value = budgetFor(this.entry ? this.entry.spec : 'mech').tris;
    this.buildRef();
    this.renderAll();
  }
  // 參考：程式模型（GLB 製作尺寸 ×1）、外框、連接點；地板放在原點（區塊放在程式模型的最低點）
  buildRef() {
    if (this.refObj) {
      this.scene.remove(this.refObj);
      disposeObject(this.refObj);
    }
    for (const m of this.connMarks) this.scene.remove(m.mk);
    this.refObj = null;
    this.refBox = this.refGame = null;
    this.connMarks = [];
    const e = this.entry;
    let floorY = 0;
    if (e) {
      const b = e.build(e.pal);
      b.scaleNode.scale.set(1, 1, 1);
      b.obj.traverse((o) => {
        if (o.isLineSegments) o.visible = false;
        if (!o.isMesh) return;
        if (o.material === OUTLINE_MAT) o.visible = false;
        else o.material = GHOST;
      });
      this.refObj = b.obj;
      this.scene.add(b.obj);
      this.refGame = referenceBox(e, e.pal);
      this.refBox = gameBoxToGltf(this.refGame);
      if (e.piece) {
        floorY = this.refBox.isEmpty() ? 0 : this.refBox.min.y;
        for (const name of Object.keys(pieceConns(e.piece))) {
          const c = connOf(e.piece, name);
          const mk = buildConnMarker(0.04, true);
          mk.position.copy(c.p);
          mk.rotation.copy(c.r);
          this.scene.add(mk);
          this.connMarks.push({ name, mk });
        }
      }
    }
    this.floor.position.y = floorY;
    this.grid.position.y = floorY;
    this.applyShow();
    this.buildLabels();
  }
  applyShow() {
    const sp = this.split && this.split.active;
    if (this.refObj) this.refObj.visible = this.show.ref && !sp;
    for (const m of this.connMarks) m.mk.visible = this.show.conns && !sp;
    if (sp && this.split.rig) this.split.rig.group.visible = this.show.ref;
    this.refOrigin.visible = !!this.entry && !sp && this.show.ref;
    this.grid.visible = this.show.grid;
  }

  // ---------- 載入 ----------
  async loadFile(f) {
    if (!/\.glb$/i.test(f.name)) return this.toast('只接受 .glb 檔（glTF 二進位）', true);
    const buf = await f.arrayBuffer();
    await this.load(buf, f.name, { name: f.name, buf }, '檔案：' + f.name);
  }
  // 槽位目前的 GLB（瀏覽器暫存＞內建；左側武器可暫用右側）
  async loadFromSlot(quiet) {
    const e = this.entry;
    if (!e) return this.toast('請先選擇槽位', true);
    if (this.content && this.dirty && !quiet && !confirm('目前的修改尚未存檔，確定要重新載入？')) return;
    const src = this.store.source(e.id);
    if (src.kind !== 'glb') {
      if (!quiet) this.toast('這個槽位還沒有 GLB：請拖入檔案或按「開啟 GLB…」', true);
      this.clearModel();
      return;
    }
    const rec = src.origin === 'browser' && !src.fallback ? this.store.local.get(e.id) : null;
    const orig = rec && rec.orig ? rec.orig : { name: src.name, buf: src.buf };
    const where =
      src.origin === 'builtin' ? '內建' : src.fallback ? '右側的瀏覽器暫存（暫用）' : '瀏覽器暫存';
    await this.load(src.buf, src.name, orig, `槽位的 GLB（${where}）：${src.name}`);
  }
  async revert() {
    if (!this.orig) return;
    if (this.dirty && !confirm('放棄目前的修改，還原成原始檔？')) return;
    await this.load(this.orig.buf, this.orig.name, this.orig, '原始檔：' + this.orig.name);
    this.dirty = true; // 還原後要存檔才會寫回槽位
    this.renderAll();
  }
  async load(buf, name, orig, label) {
    let gltf;
    try {
      gltf = await parseGlb(buf);
    } catch (err) {
      return this.toast(`無法讀取 ${name}：${err.message || err}`, true);
    }
    registerOriginals(gltf, buf);
    if (this.split.cutting) {
      this.split.stopCut();
      this.split.render();
    }
    this.clearModel();
    this.mat.reset();
    this.faces.reset();
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    this.content = root;
    this.anims = (gltf.animations || []).length;
    this.xform.add(root);
    this.nodes = [];
    root.traverse((o) => {
      if (o === root) return;
      this.nodes.push(o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.fileName = name;
    this.orig = orig;
    this.srcLabel = label;
    this.undo = [];
    this.redo = [];
    this.dirty = false;
    this.select(null);
    this.frameView();
    this.renderAll();
  }
  clearModel() {
    if (this.tc) this.tc.detach();
    if (this.content) {
      this.xform.remove(this.content);
      disposeObject(this.content);
    }
    this.content = null;
    this.nodes = [];
    this.sel = null;
    this.xform.position.set(0, 0, 0);
    this.xform.quaternion.identity();
    this.xform.scale.set(1, 1, 1);
    this.undo = [];
    this.redo = [];
    this.dirty = false;
    this.renderAll();
  }

  // ---------- 變換 ----------
  // 模型在 glTF 座標（frame）中的外框
  box() {
    return this.content ? boxIn(this.content, this.frame) : new THREE.Box3();
  }
  // 對整體模型套用 glTF 座標的矩陣；centered 時以外框中心為軸心（旋轉、翻轉後模型不會跑走），否則以原點為中心
  applyWorld(m, centered) {
    if (!this.content) return;
    this.pushUndo();
    const mm = centered ? about(m, this.box().getCenter(new THREE.Vector3())) : m;
    this.xform.updateMatrix();
    this.xform.matrix.premultiply(mm);
    this.xform.matrix.decompose(this.xform.position, this.xform.quaternion, this.xform.scale);
    this.changed();
  }
  // 拖曳原點：把手從目前的原點出發，用箭頭拖到想要的位置，放開後模型移動、讓那一點成為原點
  setOriginMode(on) {
    if (on && !this.content) return;
    this.originMode = on;
    this.oh.position.set(0, 0, 0);
    this.oh.visible = on;
    this.oh.scale.setScalar(this.axes.group.scale.x);
    $('edOriginDrag').classList.toggle('sel', on);
    if (!this.tc) return;
    if (on) {
      this.setMode('translate');
      this.tc.attach(this.oh);
    } else if (this.content && !this.split.cutting) this.tc.attach(this.sel || this.xform);
  }
  applyOriginHandle() {
    const p = this.oh.position.clone();
    this.oh.position.set(0, 0, 0);
    if (p.lengthSq() > 1e-12) this.setOrigin(p);
  }
  // 把 glTF 座標中的點 p 設為原點（移動模型，使 p 落在 0,0,0）
  setOrigin(p) {
    if (!this.content) return;
    this.applyWorld(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z), false);
  }
  // 對齊與比例的參考外框：拆分模式時是參與分配的區塊，否則是目標槽位的程式模型
  curRef() {
    return this.split.active ? this.split.refBox() : this.refBox;
  }
  fitToRef() {
    if (!this.content) return;
    const ref = this.curRef();
    if (!ref || ref.isEmpty()) return this.toast('請先選擇槽位，才有程式模型可以對齊', true);
    this.applyWorld(fitMatrix(this.box(), ref, $('edFitMode').value, $('edAnchor').value), false);
  }

  // ---------- 節點 ----------
  select(o) {
    if (this.originMode) this.setOriginMode(false);
    this.sel = o;
    if (this.tc) {
      if (this.content && !this.split.cutting) this.tc.attach(o || this.xform);
      else this.tc.detach();
    }
    this.selBox.visible = !!o;
    if (o) this.selBox.setFromObject(o);
    this.renderTree();
    this.renderDetail();
  }
  // 加入節點（加入 GLB、合併的結果）：登記到節點清單並選取
  addNode(root, parent = this.content) {
    parent.add(root);
    root.traverse((o) => {
      this.nodes.push(o);
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    this.select(root);
  }
  // 組合：另一個 GLB 加入成新節點（放在原點，用移動／旋轉／縮放調整位置）
  async addFile(f) {
    if (!this.content) return this.loadFile(f);
    if (!/\.glb$/i.test(f.name)) return this.toast('只接受 .glb 檔（glTF 二進位）', true);
    let gltf;
    const buf = await f.arrayBuffer();
    try {
      gltf = await parseGlb(buf);
    } catch (err) {
      return this.toast(`無法讀取 ${f.name}：${err.message || err}`, true);
    }
    registerOriginals(gltf, buf);
    this.pushUndo();
    const root = gltf.scene;
    root.name = f.name.replace(/\.glb$/i, '');
    this.addNode(root);
    this.changed();
    this.toast(`已加入「${root.name}」：選取後可移動、旋轉、縮放`);
  }
  // 合併：節點與它的子節點合成一個節點，同材質的網格合併成一個（變換寫進頂點）
  mergeNode(o) {
    if (!o) return;
    let n = 0;
    o.traverse((x) => x.isMesh && x.visible && n++);
    if (!n) return this.toast('這個節點底下沒有可見的網格', true);
    this.pushUndo();
    const merged = mergeByMaterial(o, o.parent, o.name || '合併');
    o.visible = false;
    o.userData.edDeleted = true;
    this.addNode(merged, o.parent);
    this.changed();
    this.toast(`已合併 ${n} 個網格 → ${merged.children.length} 個（依材質）`);
  }
  removeNode(o) {
    if (!o) return;
    this.pushUndo();
    o.visible = false;
    o.userData.edDeleted = true;
    this.select(null);
    this.changed();
  }
  pick(e) {
    if (this.split.cutting) return this.split.pick(e);
    if (this.split.active && this.split.pickBox(e)) return;
    if (this.mat.boxMode || this.faces.on) return;
    if (!this.content) return;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const hits = ray.intersectObject(this.content, true).filter((h) => {
      for (let o = h.object; o && o !== this.xform; o = o.parent) if (!o.visible) return false;
      return h.object.isMesh;
    });
    if (this.pickOrigin) {
      if (!hits.length) return;
      // 取前後表面的中點：點在關節圓柱上時，原點會落在圓柱中心而不是表面
      const a = hits[0].point.clone();
      const b = hits.find((h) => h.distance > hits[0].distance + 1e-4);
      const p = $('edPickMid').checked && b ? a.add(b.point).multiplyScalar(0.5) : a;
      this.pickOrigin = false;
      $('edPick').classList.remove('sel');
      this.setOrigin(this.frame.worldToLocal(p));
      return;
    }
    this.select(hits.length ? hits[0].object : null);
  }

  // ---------- 復原／重做（整體變換＋各節點的變換、顯示、名稱）----------
  snapshot() {
    const t = (o) => [o.position.toArray(), o.quaternion.toArray(), o.scale.toArray()];
    return {
      x: t(this.xform),
      n: this.nodes.map((o) => [...t(o), o.visible, !!o.userData.edDeleted, o.name, o.geometry, o.material]),
      m: this.mat.snap(),
      sp: this.split.snapBoxes(),
    };
  }
  restore(s) {
    const set = (o, [p, q, sc]) => {
      o.position.fromArray(p);
      o.quaternion.fromArray(q);
      o.scale.fromArray(sc);
    };
    set(this.xform, s.x);
    this.nodes.forEach((o, i) => {
      const v = s.n[i];
      if (!v) {
        // 快照之後才加入的節點（加入 GLB、合併）：復原時移除
        o.visible = false;
        o.userData.edDeleted = true;
        return;
      }
      set(o, v);
      o.visible = v[3];
      o.userData.edDeleted = v[4];
      o.name = v[5];
      if (v[6]) o.geometry = v[6];
      if (v[7]) o.material = v[7];
    });
    this.mat.restore(s.m);
    this.split.restoreBoxes(s.sp);
  }
  // 修改前呼叫；mergeKey 相同且間隔很短的連續修改（例如打字）合併成一步
  pushUndo(mergeKey) {
    const now = performance.now();
    const last = this.undo[this.undo.length - 1];
    if (mergeKey && last && last.key === mergeKey && now - last.t < 1000) {
      last.t = now;
      return;
    }
    this.undo.push({ key: mergeKey || null, t: now, s: this.snapshot() });
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
  }
  step(back) {
    if (this.split.cutting) return this.split.step(back);
    if (!this.content) return;
    const from = back ? this.undo : this.redo;
    const e = from.pop();
    if (!e) return this.toast(back ? '沒有可以復原的修改' : '沒有可以重做的修改', true);
    (back ? this.redo : this.undo).push({ key: null, t: 0, s: this.snapshot() });
    this.restore(e.s);
    if (this.sel && this.sel.userData.edDeleted) this.select(null);
    this.changed();
  }
  changed() {
    this.dirty = true;
    if (this.sel) this.selBox.setFromObject(this.sel);
    this.renderTree();
    this.writeDetail();
    this.renderStats();
    this.renderUndo();
    this.mat.render();
    this.faces.prune();
    clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => this.renderChecks(), 250);
  }

  // ---------- 畫面：左側節點樹 ----------
  renderTree() {
    const box = $('edTree');
    if (!this.content) {
      box.innerHTML = '';
      return;
    }
    const rows = [
      `<div class="edNode${this.sel ? '' : ' sel'}" data-i="-1" style="--d:0"><b>整體模型</b><span class="dim small">${escHtml(this.fileName || '')}</span></div>`,
    ];
    const depth = (o) => {
      let d = 0;
      for (let x = o.parent; x && x !== this.content; x = x.parent) d++;
      return d + 1;
    };
    this.nodes.forEach((o, i) => {
      for (let x = o; x && x !== this.content; x = x.parent) if (x.userData.edDeleted) return; // 刪除（含被合併）的節點與其子節點
      const tris = o.isMesh
        ? Math.round(
            (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3,
          ).toLocaleString() + ' 面'
        : '';
      rows.push(
        `<div class="edNode${o === this.sel ? ' sel' : ''}${o.visible ? '' : ' off'}" data-i="${i}" style="--d:${depth(o)}">` +
          `<span class="nm">${o.isMesh ? '▣' : '○'} ${escHtml(o.name || '（未命名）')}</span>` +
          `<span class="dim small">${tris}</span>` +
          `<button class="mini" data-act="vis" title="顯示／隱藏（隱藏的節點不會匯出）">${o.visible ? '👁' : '—'}</button>` +
          `<button class="mini" data-act="del" title="刪除節點（Delete）">✕</button></div>`,
      );
    });
    box.innerHTML = rows.join('');
    for (const r of box.querySelectorAll('.edNode')) {
      const i = +r.dataset.i;
      const o = i >= 0 ? this.nodes[i] : null;
      r.onclick = (ev) => {
        const act = ev.target.dataset && ev.target.dataset.act;
        if (act === 'vis') {
          this.pushUndo();
          o.visible = !o.visible;
          return this.changed();
        }
        if (act === 'del') return this.removeNode(o);
        this.select(o);
      };
    }
  }

  // ---------- 畫面：右側數值 ----------
  renderDetail() {
    const box = $('edDetail');
    if (!this.content) {
      box.innerHTML = `<div class="dim small">拖入 .glb 到畫面上，或按左側「開啟 GLB…」。</div>`;
      return;
    }
    const o = this.sel;
    const f = (k, i, a, step) =>
      `<label><i class="ax-${a.toLowerCase()}">${a}</i><input type="number" step="${step}" data-k="${k}" data-i="${i}"></label>`;
    const row = (k, name, step) =>
      `<span class="dim">${name}</span>` + ['X', 'Y', 'Z'].map((a, i) => f(k, i, a, step)).join('');
    box.innerHTML =
      `<div class="wsDh"><b>${escHtml(o ? o.name || '（未命名節點）' : '整體模型')}</b>` +
      `<span class="dim small">${o ? '節點（父節點座標）' : '模型相對原點的位置（glTF 座標）'}</span></div>` +
      (o
        ? `<label class="edName">名稱 <input id="edNodeName" value="${escHtml(o.name)}" maxlength="60"></label>` +
          `<div class="btns"><button id="edMergeNode" title="這個節點與子節點合成一個節點，同材質的網格合併">合併成一個節點</button></div>`
        : '') +
      `<div class="jgrid">${row('p', '位置 m', 0.01)}${row('r', '旋轉 °', 1)}${row('s', '縮放', 0.01)}</div>` +
      `<label class="tog small"><input type="checkbox" id="edLock" checked> 等比縮放</label>`;
    for (const inp of box.querySelectorAll('.jgrid input')) inp.onchange = () => this.fromInputs(inp);
    if ($('edMergeNode')) $('edMergeNode').onclick = () => this.mergeNode(o);
    const nm = $('edNodeName');
    if (nm)
      nm.onchange = () => {
        this.pushUndo();
        o.name = nm.value.trim();
        this.changed();
        this.renderDetail();
      };
    this.writeDetail();
  }
  target() {
    return this.sel || this.xform;
  }
  writeDetail() {
    const o = this.target();
    const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'XYZ');
    const vals = {
      p: o.position.toArray().map((v) => fmt(v)),
      r: [e.x, e.y, e.z].map((v) => fmt(v / D2R, 2)),
      s: o.scale.toArray().map((v) => fmt(v, 4)),
    };
    for (const inp of $('edDetail').querySelectorAll('.jgrid input')) {
      if (document.activeElement === inp) continue;
      inp.value = +vals[inp.dataset.k][+inp.dataset.i];
    }
    if (this.sel) this.selBox.setFromObject(this.sel);
  }
  fromInputs(inp) {
    const o = this.target();
    const v = parseFloat(inp.value);
    if (!Number.isFinite(v)) return this.writeDetail();
    const k = inp.dataset.k,
      i = +inp.dataset.i;
    this.pushUndo('input|' + k);
    if (k === 'p') o.position.setComponent(i, v);
    else if (k === 'r') {
      const e = new THREE.Euler().setFromQuaternion(o.quaternion, 'XYZ');
      const arr = [e.x, e.y, e.z];
      arr[i] = v * D2R;
      o.quaternion.setFromEuler(new THREE.Euler(arr[0], arr[1], arr[2], 'XYZ'));
    } else {
      if (v === 0) return this.writeDetail();
      if ($('edLock') && $('edLock').checked) {
        const r = v / (o.scale.getComponent(i) || 1);
        o.scale.multiplyScalar(r);
      } else o.scale.setComponent(i, v);
    }
    this.changed();
  }

  // ---------- 最佳化與輸出 ----------
  setupOpt() {
    const o = this.exportOpts;
    $('edTexMax').value = String(o.texMax);
    $('edWebp').checked = !!o.webp;
    $('edDraco').checked = !!o.draco;
    const save = () => {
      this.exportOpts = {
        texMax: $('edTexMax').value === 'budget' ? 'budget' : +$('edTexMax').value,
        webp: $('edWebp').checked,
        draco: $('edDraco').checked,
      };
      saveExportOpts(this.exportOpts);
    };
    for (const id of ['edTexMax', 'edWebp', 'edDraco']) $(id).onchange = save;
    $('edOptGo').onclick = () => this.simplifyTo(parseInt($('edOptTris').value, 10));
    $('edOptBudget').onclick = () => this.simplifyTo(budgetFor(this.entry ? this.entry.spec : 'mech').tris);
    $('edWeld').onclick = () => this.weld();
  }
  // 匯出設定（貼圖最大邊長「依預算」時取槽位的預算）
  exportOptsFor(spec) {
    const o = this.exportOpts;
    return {
      texMax: o.texMax === 'budget' ? budgetFor(spec).tex : +o.texMax || 0,
      webp: o.webp,
      draco: o.draco,
    };
  }
  // 減面：所有顯示中的網格依比例減到總面數約 target
  async simplifyTo(target) {
    const ms = this.mat.meshes();
    if (!ms.length) return;
    const total = ms.reduce((n, o) => n + triCountOf(o.geometry), 0);
    if (!(target > 0)) return this.toast('請輸入目標三角面數', true);
    if (total <= target) return this.toast(`目前 ${total.toLocaleString()} 面，已在目標以內`);
    const ratio = (target * 0.98) / total; // 減面器不一定剛好命中，留一點餘裕
    let res;
    try {
      res = [];
      for (const o of ms) res.push(await simplifyGeometry(o.geometry, ratio));
    } catch (err) {
      return this.toast('減面失敗：' + (err.message || err), true);
    }
    this.pushUndo();
    ms.forEach((o, i) => (o.geometry = res[i]));
    this.changed();
    const after = ms.reduce((n, o) => n + triCountOf(o.geometry), 0);
    this.toast(`減面：${total.toLocaleString()} → ${after.toLocaleString()} 面`);
  }
  weld() {
    const ms = this.mat.meshes();
    if (!ms.length) return;
    const vc = () => ms.reduce((n, o) => n + o.geometry.attributes.position.count, 0);
    const before = vc();
    this.pushUndo();
    for (const o of ms) o.geometry = weldGeometry(o.geometry);
    this.changed();
    this.toast(`焊接重複頂點：${before.toLocaleString()} → ${vc().toLocaleString()} 個頂點`);
  }

  // ---------- 畫面：資訊與檢查 ----------
  renderAll() {
    const has = !!this.content;
    const e = this.entry;
    $('edSrc').textContent = has ? this.srcLabel : '尚未載入模型';
    this.mat.render();
    $('edFromSlot').disabled = !e;
    $('edRevert').disabled = !has || !this.orig;
    $('edAdd').disabled = this.split.cutting;
    for (const id of [
      'edOrient',
      'edMirror',
      'edHeightGo',
      'edScaleGo',
      'edPick',
      'edDownload',
      'edOptGo',
      'edOptBudget',
      'edWeld',
    ])
      $(id).disabled = !has;
    for (const b of document.querySelectorAll('#edRot button, #edOrigin button[data-o]')) b.disabled = !has;
    $('edFit').disabled = !has || !e;
    $('edSave').disabled = !has || !e;
    const ms = e && mirrorSlot(e.id);
    $('edSaveMirror').disabled = !has || !ms;
    $('edSaveMirror').textContent = ms ? `鏡像存到另一側（${ms.split('/').pop()}）` : '鏡像存到另一側';
    $('edInspect').disabled = !e;
    $('edSpec').innerHTML = e
      ? `<div class="kv"><span class="dim">槽位</span><span>${escHtml(e.name)}</span></div>` +
        `<div class="kv"><span class="dim">原點應在</span><span>${escHtml(originText(e))}</span></div>`
      : `<div class="dim small">不指定槽位時沒有程式模型可以對照，只能下載。整台機甲或整隻手臂請用左側的「拆分成區塊」。</div>`;
    $('edInfo').textContent = has ? this.fileName : '';
    this.renderTree();
    this.renderDetail();
    this.renderStats();
    this.renderUndo();
    this.renderChecks();
    this.faces.render();
  }
  renderUndo() {
    $('edUndo').disabled = !this.undo.length;
    $('edRedo').disabled = !this.redo.length;
  }
  renderStats() {
    const box = $('edStats');
    if (!this.content) {
      box.innerHTML = '';
      return;
    }
    const b = this.box();
    const s = b.getSize(new THREE.Vector3());
    const e = this.entry;
    const B = budgetFor(e ? e.spec : 'mech');
    const tris = triCount(this.content);
    const lv = tris <= B.tris ? 'ok' : tris <= B.tris * 1.5 ? 'warn' : 'error';
    const rows = [
      ['尺寸（寬×高×深）', `${fmt(s.x, 2)} × ${fmt(s.y, 2)} × ${fmt(s.z, 2)} m`],
      ['材質', String(this.mat.list().length)],
      [
        '頂點',
        this.mat
          .meshes()
          .reduce((n, o) => n + o.geometry.attributes.position.count, 0)
          .toLocaleString(),
      ],
    ];
    const ref = this.curRef();
    if (ref && !ref.isEmpty()) {
      const rs = ref.getSize(new THREE.Vector3());
      rows.push(['程式模型', `${fmt(rs.x, 2)} × ${fmt(rs.y, 2)} × ${fmt(rs.z, 2)} m`]);
      rows.push([
        '比例（GLB／程式）',
        ['x', 'y', 'z'].map((k) => (rs[k] > 0.01 ? Math.round((s[k] / rs[k]) * 100) + '%' : '—')).join('／'),
      ]);
    }
    rows.push(['外框範圍 Y', `${fmt(b.min.y, 2)} ～ ${fmt(b.max.y, 2)} m`]);
    if (!e || !e.piece) rows.push(['最低點（遊戲中離地）', groundText(b.min.y)]);
    box.innerHTML =
      rows
        .map(
          (r) =>
            `<div class="kv"><span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span></div>`,
        )
        .join('') +
      `<div class="kv"><span class="dim">三角面</span><span class="${lv}" id="edTris">${tris.toLocaleString()}（${e ? '建議' : '整台機甲建議'} ≤ ${B.tris.toLocaleString()}）</span></div>` +
      (lv !== 'ok'
        ? `<div class="small warnTxt">面數超出預算：可用「最佳化與輸出」的「減到預算」減面</div>`
        : '');
  }
  // 規格檢查：與模型庫檢視窗相同（檔案大小要存檔後才知道，這裡不列）
  renderChecks() {
    const ul = $('edChecks');
    if (!this.content || !this.entry || this.split.active) {
      ul.innerHTML = '';
      return;
    }
    const e = this.entry;
    const info = {
      tinted: new Set(),
      kept: new Set(),
      skinned: 0,
      unlit: 0,
      materials: 0,
      animations: this.anims,
    };
    this.content.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.isSkinnedMesh) info.skinned++;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        info.materials++;
        if (m.type === 'MeshBasicMaterial') info.unlit++;
        const slot = materialSlot(m.name);
        if (slot) info.tinted.add(slot);
        else info.kept.add(m.name || '（未命名）');
      }
    });
    this.frame.updateMatrixWorld(true);
    const list = checkGlb({
      root: this.frame,
      info,
      bytes: 0,
      spec: e.spec,
      ref: this.refGame,
      origin: originText(e),
    }).filter((c) => !c.text.startsWith('檔案大小') && !c.text.startsWith('正面朝向'));
    ul.innerHTML = list.map((c) => `<li class="${c.lv}">${escHtml(c.text)}</li>`).join('');
  }

  // ---------- 標籤（原點三軸、連接點名稱）----------
  buildLabels() {
    const box = $('edLabels');
    box.innerHTML = '';
    this.labels = [
      ...this.axes.labels.map((l) => ({ ...l, obj: this.axes.group })),
      ...this.connMarks.map((m) => ({
        pos: new THREE.Vector3(),
        text: CONN_NAMES[m.name] || m.name,
        cls: 'conn',
        obj: m.mk,
      })),
      ...(this.entry
        ? [
            {
              pos: new THREE.Vector3(0, -0.09, 0),
              text: '程式模型原點：' + originText(this.entry),
              cls: 'conn refo',
              obj: this.refOrigin,
            },
          ]
        : []),
      { pos: new THREE.Vector3(0, 0.05, 0), text: '新原點（放開套用）', cls: 'conn cur', obj: this.oh },
    ];
    for (const l of this.labels) {
      l.el = document.createElement('div');
      l.el.className = 'lbl ' + l.cls;
      l.el.textContent = l.text;
      box.appendChild(l.el);
    }
  }
  updateLabels() {
    const v = new THREE.Vector3();
    const shown = (o) => {
      for (let x = o; x; x = x.parent) if (!x.visible) return false;
      return true;
    };
    for (const l of [...(this.labels || []), ...this.split.labels]) {
      v.copy(l.pos);
      l.obj.localToWorld(v);
      v.project(this.camera);
      const off = v.z > 1 || v.z < -1 || !shown(l.obj);
      l.el.style.display = off ? 'none' : '';
      if (off) continue;
      l.el.style.left = ((v.x + 1) / 2) * this.w + 'px';
      l.el.style.top = ((1 - v.y) / 2) * this.h + 'px';
    }
  }

  // ---------- 存檔 ----------
  async bake(mirror) {
    const name = this.entry
      ? this.entry.id.replace(/\//g, '_')
      : (this.fileName || 'model').replace(/\.glb$/i, '');
    const root = bakeScene(
      this.content,
      this.frame,
      name,
      mirror ? new THREE.Matrix4().makeScale(-1, 1, 1) : null,
    );
    try {
      const opts = this.exportOptsFor(this.entry ? this.entry.spec : 'mech');
      return await processGlb(await exportGlb(root, opts.texMax), opts);
    } finally {
      for (const m of root.children) m.geometry.dispose();
    }
  }
  editedName(id) {
    const base = (this.orig ? this.orig.name : this.fileName || 'model').replace(/\.glb$/i, '');
    return `${base}（編輯）${id ? '→' + id.split('/').slice(1).join('_') : ''}.glb`;
  }
  async saveToSlot(mirror) {
    const e = this.entry;
    if (!this.content || !e) return;
    const id = mirror ? mirrorSlot(e.id) : e.id;
    if (!id) return this.toast('這個槽位沒有對應的另一側', true);
    let buf;
    try {
      buf = await this.bake(mirror);
    } catch (err) {
      return this.toast('匯出失敗：' + (err.message || err), true);
    }
    // 鏡像產生的另一側沒有原始檔（之後在那一側開啟編輯時，以鏡像結果為起點）
    await this.store.putBuf(id, this.editedName(mirror ? id : null), buf, mirror ? null : this.orig);
    if (!mirror) this.dirty = false;
    const target = MODEL_CATALOG.find((x) => x.id === id);
    this.toast(
      `已存到「${target ? target.name : id}」（${(buf.byteLength / 1024).toFixed(0)} KB${this.store.ok ? '' : '，瀏覽器無法保存，重新整理後會消失'}）`,
    );
    if (this.onSaved) this.onSaved(id);
    this.renderAll();
  }
  async download() {
    if (!this.content) return;
    let buf;
    try {
      buf = await this.bake(false);
    } catch (err) {
      return this.toast('匯出失敗：' + (err.message || err), true);
    }
    const name = this.entry
      ? this.entry.id.split('/').slice(1).join('_') + '.glb'
      : (this.fileName || 'model.glb').replace(/\.glb$/i, '') + '_edited.glb';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buf], { type: 'model/gltf-binary' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---------- 繪製 ----------
  frameView() {
    this.resize(true);
    const b = this.box().clone().applyMatrix4(this.frame.matrixWorld);
    if (this.refObj && !this.split.active) b.union(new THREE.Box3().setFromObject(this.refObj));
    if (this.split.active && this.split.rig) b.union(new THREE.Box3().setFromObject(this.split.rig.group));
    const size = b.isEmpty() ? new THREE.Vector3(2, 2, 2) : b.getSize(new THREE.Vector3());
    const t = fitCamera(this.camera, size, this.camera.aspect, 1.6);
    const c = b.isEmpty() ? new THREE.Vector3(0, 1, 0) : b.getCenter(new THREE.Vector3());
    const off = c.clone().sub(t);
    this.camera.position.add(off);
    this.controls.target.copy(c);
    this.controls.update();
    const r = Math.max(4, size.length());
    const sc = this.lights.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 0.5;
    sc.far = r * 6;
    sc.updateProjectionMatrix();
    this.lights.sun.position.set(c.x + r * 0.6, c.y + r * 1.4, c.z - r * 0.8);
    this.lights.sun.target.position.copy(c);
    const len = Math.min(3, Math.max(0.15, size.length() * 0.15));
    this.axes.group.scale.setScalar(len / 0.5);
    this.refOrigin.scale.setScalar(len / 0.5);
    this.oh.scale.setScalar(len / 0.5);
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
  }
  render() {
    this.controls.update();
    this.faces.sync();
    const sw = this.mat.beforeRender(); // 預覽配色
    this.renderer.render(this.scene, this.camera);
    this.mat.afterRender(sw);
    this.updateLabels();
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    if (!this.open_) return;
    this.resize(false);
    this.render();
  }
}
