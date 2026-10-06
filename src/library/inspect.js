// 模型庫檢視窗：放大檢視單一模型（滑鼠／觸控旋轉縮放）、後處理、尺寸參考物、配色與光線、動作預覽，
// 以及 GLB 工具：單獨／並排對照／疊合對照／組合預覽四種模式、規格檢查報告、載入／下載／移除
import { escHtml } from '../core/html.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { PALETTES } from '../render/materials.js';
import { fmtSize } from '../render/measure.js';
import { CATEGORIES } from '../render/model-catalog.js';
import {
  CONN_NAMES,
  PIECE_NAMES,
  PIECE_ORIGIN,
  animateMech,
  connOf,
  parentConnOf,
  pieceConns,
} from '../render/mech-model.js';
import { THEMES } from '../world/world.js';
import { buildAxes, buildConnMarker, buildDims, buildGrid, buildHuman, buildRuler } from './refs.js';
import { ThrusterFx } from '../fx/thruster.js';
import { JointEditor } from './joint-editor.js';
import { exportTemplate } from './template.js';
import {
  ANIMS,
  COMPOSE_CATS,
  addLights,
  animState,
  applyLight,
  disposeObject,
  fitCamera,
  makeRenderer,
  prepareComposite,
  prepareModel,
  prepareSource,
  scaleText,
} from './stage.js';

const $ = (id) => document.getElementById(id);
const TOGGLES = [
  ['axes', '原點與三軸', true],
  ['conns', '連接點', true],
  ['flame', '噴焰特效', true],
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
const MODES = [
  ['single', '單獨'],
  ['side', '並排對照'],
  ['overlay', '疊合對照'],
  ['compose', '組合預覽'],
];
const GHOST = new THREE.MeshBasicMaterial({
  color: 0x5cc8ff,
  wireframe: true,
  transparent: true,
  opacity: 0.35,
});
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
// 模型最低點相對原點（遊戲中原點貼地）的高度
const groundText = (y) =>
  Math.abs(y) < 0.05 ? '貼地' : y < 0 ? `沉入地面 ${(-y).toFixed(2)} m` : `懸空 ${y.toFixed(2)} m`;

export class Inspector {
  // store：GlbStore；onFile(entry, file)／onRemove(entry)：由模型庫處理儲存與格子更新
  constructor({ store, onClose, onFile, onRemove, onJoints, onError, onEdit, onPaint }) {
    this.store = store;
    this.onClose = onClose;
    this.onFile = onFile;
    this.onRemove = onRemove;
    this.onError = onError;
    this.onEdit = onEdit;
    this.onPaint = onPaint;
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
    this.mode = 'single';
    this.t = 0;
    this.tok = 0;
    this.open_ = false;
    this.items = []; // 場景中的模型（並排／疊合時有兩個）
    this.labels = [];
    this.setupPost();
    this.setupUi();
    this.thruster = new ThrusterFx(this.scene); // 背包噴焰（與遊戲相同的粒子特效）
    this.joints = new JointEditor({
      scene: this.scene,
      camera: this.camera,
      canvas: this.canvas,
      orbit: this.controls,
      store,
      onChange: (slot) => onJoints && onJoints(slot),
    });
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
        this.markButtons();
      };
    $('insModes').innerHTML = MODES.map(([k, n]) => `<button data-m="${k}">${n}</button>`).join('');
    for (const b of $('insModes').querySelectorAll('button'))
      b.onclick = () => {
        this.mode = b.dataset.m;
        this.rebuild();
      };
    $('insLoad').onclick = () => $('insFile').click();
    $('insFile').onchange = async () => {
      const f = $('insFile').files[0];
      $('insFile').value = '';
      if (f) await this.onFile(this.entry, f);
    };
    $('insRemove').onclick = () => this.onRemove(this.entry);
    $('insDownload').onclick = () => this.download();
    $('insTemplate').onclick = () => this.downloadTemplate();
    $('insEdit').onclick = () => this.onEdit && this.onEdit(this.entry.id);
    $('insPaint').onclick = () => this.onPaint && this.onPaint(this.entry);
  }
  markButtons() {
    for (const b of $('insAnims').querySelectorAll('button'))
      b.classList.toggle('sel', b.dataset.a === this.anim);
    for (const b of $('insModes').querySelectorAll('button'))
      b.classList.toggle('sel', b.dataset.m === this.mode);
  }
  // mode：開啟時的模式（預設單獨；GLB 編輯器存檔後可直接開組合預覽）
  open(entry, palKey, mode = 'single') {
    this.entry = entry;
    $('insPal').value = palKey || '';
    $('inspect').hidden = false;
    this.open_ = true;
    this.anim = 'garage';
    this.mode = mode;
    return this.rebuild();
  }
  close() {
    $('inspect').hidden = true;
    this.open_ = false;
    this.tok++;
    this.clear();
    if (this.onClose) this.onClose();
  }
  clear() {
    for (const it of this.items) {
      this.scene.remove(it.pivot);
      disposeObject(it.pivot);
    }
    this.items = [];
    if (this.refs)
      for (const o of [this.refs.grid, this.refs.ruler.group, this.refs.human.group]) {
        this.scene.remove(o);
        disposeObject(o);
      }
    this.refs = null;
    this.labels = [];
    $('insLabels').innerHTML = '';
    if (this.joints) this.joints.unbind();
    if (this.thruster) this.thruster.clear();
    this.flameSrc = null;
  }
  // 依目前模式建立場景（非同步：GLB 需要解析）
  async rebuild() {
    const tok = ++this.tok;
    const e = this.entry,
      pal = $('insPal').value || null,
      src = this.store.source(e.id);
    const glb = src.kind === 'glb' && !e.noGlb;
    const canCompose = COMPOSE_CATS.includes(e.cat);
    if ((this.mode === 'side' || this.mode === 'overlay') && !glb) this.mode = 'single';
    if (this.mode === 'compose' && !canCompose) this.mode = 'single';
    for (const b of $('insModes').querySelectorAll('button')) {
      const m = b.dataset.m;
      b.disabled = ((m === 'side' || m === 'overlay') && !glb) || (m === 'compose' && !canCompose);
      b.title = b.disabled ? (m === 'compose' ? '只有機甲部件與武器可組合預覽' : '此槽位還沒有 GLB') : '';
    }
    this.markButtons();
    let main,
      ref = null;
    try {
      main =
        this.mode === 'compose'
          ? await prepareComposite(e, pal, this.store)
          : await prepareSource(e, pal, src, this.store);
    } catch (err) {
      main = prepareModel(e, pal);
      main.loadError = 'GLB 解析失敗：' + (err.message || err);
      if (this.onError) this.onError(`${e.name}：${main.loadError}`);
    }
    if (this.mode === 'side' || this.mode === 'overlay') ref = prepareModel(e, pal);
    if (tok !== this.tok) {
      for (const d of [main, ref]) if (d) disposeObject(d.pivot);
      return;
    }
    this.clear();
    this.main = main;
    this.items = [main, ...(ref ? [ref] : [])];
    // 擺放：並排時 GLB 在左、程式模型在右，整體置中
    let size = main.size.clone();
    if (this.mode === 'side') {
      const gap = Math.max(0.6, Math.max(main.size.x, ref.size.x) * 0.35);
      const shift = (main.size.x - ref.size.x) / 2;
      main.pivot.position.x = -(gap / 2 + main.size.x / 2) + shift;
      ref.pivot.position.x = gap / 2 + ref.size.x / 2 + shift;
      size = new THREE.Vector3(
        main.size.x + gap + ref.size.x,
        Math.max(main.size.y, ref.size.y),
        Math.max(main.size.z, ref.size.z),
      );
    } else if (this.mode === 'overlay') {
      ref.pivot.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === OUTLINE_MAT) o.visible = false;
        else o.material = GHOST;
      });
    }
    for (const it of this.items) this.scene.add(it.pivot);
    // 參考物與尺寸標線
    const grid = buildGrid(size),
      ruler = buildRuler(size),
      human = buildHuman(size);
    this.scene.add(grid, ruler.group, human.group);
    const dimsList = this.items
      .filter((it, i) => this.mode !== 'overlay' || i === 0)
      .map((it) => {
        const d = buildDims(it.size);
        it.pivot.add(d.dims, d.box);
        return { it, d };
      });
    this.refs = { grid, ruler, human, dims: dimsList.map((x) => x.d) };
    this.labels = [
      ...dimsList.flatMap(({ it, d }) => d.labels.map((l) => ({ ...l, key: 'dims', obj: it.pivot }))),
      ...ruler.labels.map((l) => ({ ...l, key: 'ruler', obj: this.scene })),
      ...human.labels.map((l) => ({ ...l, key: 'human', obj: this.scene })),
      ...this.addHelpers(main, size),
    ];
    if (this.mode === 'side') {
      for (const [it, text] of [
        [main, 'GLB'],
        [ref, '程式模型'],
      ])
        this.labels.push({
          pos: new THREE.Vector3(0, it.size.y * 1.08 + 0.2, 0),
          text,
          cls: 'tag',
          key: 'always',
          obj: it.pivot,
        });
    }
    const box = $('insLabels');
    for (const l of this.labels) {
      l.el = document.createElement('div');
      l.el.className = 'lbl ' + l.cls;
      l.el.textContent = l.text;
      box.appendChild(l.el);
    }
    // 陰影範圍與相機
    const r = Math.max(4, size.length());
    const sc = this.lights.sun.shadow.camera;
    sc.left = sc.bottom = -r;
    sc.right = sc.top = r;
    sc.near = 0.5;
    sc.far = r * 6;
    sc.updateProjectionMatrix();
    this.lights.sun.position.set(r * 0.6, r * 1.4, -r * 0.8);
    this.resize(true);
    this.controls.target.copy(fitCamera(this.camera, size, this.camera.aspect, 1.6));
    this.controls.update();
    this.renderInfo(src, ref);
    this.applyOpts();
    $('insPal').disabled = !!e.noPal; // 地圖物件等沒有陣營配色
    const rig = main.built.rig;
    const canAnim = rig && !rig.vehicle;
    $('insAnimH').style.display = $('insAnims').style.display = canAnim ? '' : 'none';
  }
  // 原點與三軸、連接點標記：加在模型的節點上，跟著模型旋轉與動作
  addHelpers(main, size) {
    const e = this.entry,
      rig = main.built.rig,
      obj = main.built.obj;
    const V3 = () => new THREE.Vector3();
    main.pivot.updateMatrixWorld(true);
    const ws = (o) => o.getWorldScale(V3()).x || 1;
    const span = Math.max(size.x, size.y, size.z);
    const len = Math.min(3, Math.max(0.25, span * 0.28));
    const msize = Math.min(0.2, Math.max(0.03, span * 0.016));
    const labels = [];
    this.helpers = { axes: [], conns: [] };
    // 原點：組合預覽時是這個區塊的原點，其他是模型本身的原點
    const own = this.mode === 'compose' && rig && rig.pieces ? rig.pieces[e.id] : null;
    const host = own || obj;
    const ax = buildAxes(len / ws(host));
    host.add(ax.group);
    this.helpers.axes.push(ax.group);
    for (const l of ax.labels) labels.push({ ...l, key: 'axes', obj: ax.group });
    const mark = (parent, hot, name) => {
      const mk = buildConnMarker(msize / ws(parent), hot);
      parent.add(mk);
      this.helpers.conns.push(mk);
      if (name)
        labels.push({ pos: V3(), text: CONN_NAMES[name] || name, cls: 'conn', key: 'conns', obj: mk });
      return mk;
    };
    // 可編輯的連接點：target 的位置／旋轉就是連接點（組合預覽時直接移動連接點群組，子區塊會跟著動）
    const edits = [];
    if (rig && rig.mounts) {
      // 整台機甲：所有連接點；組合預覽時標出此區塊自己的連接點與它接上的那一個
      const parentMount = own && own.parent ? own.parent.parent : null;
      for (const m of rig.mounts) {
        const hot = e.cat === 'mech' || m.slot === e.id || m.node === parentMount;
        const mk = mark(m.node, hot, hot ? m.name : null);
        if (m.slot === e.id && e.cat !== 'mech') edits.push({ name: m.name, target: m.node, marker: mk });
      }
    } else if (e.piece) {
      for (const name of Object.keys(pieceConns(e.piece))) {
        const c = connOf(e.piece, name);
        const mk = mark(obj, true, name);
        mk.position.copy(c.p);
        mk.rotation.copy(c.r);
        edits.push({ name, target: mk, marker: mk });
        if (name.startsWith('nozzle_')) (this.flameSrc = this.flameSrc || { nozzles: [] }).nozzles.push(mk);
      }
    }
    this.joints.bind(
      e,
      edits,
      e.cat === 'mech' ? '完整機甲由各區塊組成：請在各區塊的檢視窗調整連接點（例如上臂決定手肘的位置）' : '',
    );
    $('insJointH').style.display =
      $('insJoints').style.display =
      $('insJointBtns').style.display =
        e.piece || e.cat === 'mech' ? '' : 'none';
    return labels;
  }
  renderInfo(src, ref) {
    const e = this.entry,
      d = this.main;
    const cat = CATEGORIES.find((c) => c.id === e.cat);
    $('insName').textContent = e.name;
    $('insId').textContent = `${e.id}${e.note ? '・' + e.note : ''}`;
    const st = scaleText(d.scale);
    const comp = d.source && d.source.kind === 'composite' ? d.source : null;
    const srcText = comp
      ? comp.glbSlots.length
        ? `區塊組合：${comp.glbSlots.length} 個區塊用 GLB，其餘為程式模型`
        : '區塊組合：全部為程式模型'
      : src.kind !== 'glb'
        ? '程式模型（three.js）'
        : `GLB（${src.origin === 'builtin' ? '內建' : src.server ? '伺服器預設組' : '瀏覽器暫存'}${src.fallback ? '，暫用右側' : ''}）${src.name}・${kb(src.size)}`;
    const rows = [
      ['分類', cat ? cat.name : e.cat],
      ...(e.piece ? this.pieceRows(e.piece) : e.origin ? [['原點', e.origin]] : []),
      ['來源', d.loadError ? d.loadError + '（改顯示程式模型）' : srcText],
      [this.mode === 'compose' ? '組合後尺寸（寬×高×深）' : '遊戲尺寸（寬×高×深）', fmtSize(d.size)],
      ...(d.ground !== null && d.ground !== undefined
        ? [['最低點（遊戲中離地）', groundText(d.ground)]]
        : []),
      ...(st
        ? [
            ['原始尺寸', fmtSize(d.sizeOrig)],
            ['遊戲縮放', st + (e.scaleNote ? `（${e.scaleNote}）` : '')],
          ]
        : []),
      ...(ref
        ? [
            ['程式模型尺寸', fmtSize(ref.size)],
            [
              '尺寸比例（GLB／程式）',
              ['x', 'y', 'z']
                .map((k) => (ref.size[k] > 0.01 ? `${Math.round((d.size[k] / ref.size[k]) * 100)}%` : '—'))
                .join('／'),
            ],
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
    // GLB 工具與檢查報告
    const glb = src.kind === 'glb';
    $('insLoad').disabled = $('insEdit').disabled = !!e.noGlb;
    $('insDownload').disabled = $('insPaint').disabled = !glb || !!src.fallback;
    $('insRemove').disabled = !(glb && src.origin === 'browser' && !src.fallback);
    $('insGlbHint').textContent = e.noGlb
      ? e.cat === 'mech'
        ? '完整機甲由各區塊組成，不接受整台的 GLB：請把 GLB 放到各區塊的格子（頭、核心、上臂、前臂…）'
        : e.parts.length
          ? '這個模型由各區塊組成，不接受整台的 GLB：請把 GLB 放到各區塊的格子（' + e.parts.join('、') + '）'
          : '這個物件在遊戲中由其他物件拼成或沿路線產生，不接受 GLB，維持程式模型'
      : glb && !src.fallback
        ? `確定採用時放到 src/assets/models/${e.id}.glb，建置後會內嵌進遊戲`
        : `尚未提供 GLB。製作規格見 docs/glb-spec.md；完成後拖到格子上或按「載入 GLB…」`;
    const checks = [
      ...(d.loadError ? [{ lv: 'error', text: d.loadError + '（目前顯示程式模型）' }] : []),
      ...(d.notes || []).map((t) => ({ lv: 'warn', text: t })),
      ...(this.mode === 'compose' || !d.checks ? [] : d.checks),
    ];
    if (this.mode === 'compose')
      checks.push({
        lv: 'info',
        text: '組合預覽：玩家初始機換上此零件，所有區塊依各自的來源組裝，可用動作預覽確認接點與比例',
      });
    $('insChecks').innerHTML = checks.map((c) => `<li class="${c.lv}">${escHtml(c.text)}</li>`).join('');
  }
  pieceRows(info) {
    const pc = parentConnOf(info);
    const names = Object.keys(pieceConns(info)).map((n) => CONN_NAMES[n]);
    return [
      ['原點', PIECE_ORIGIN[info.kind]],
      [
        '接在',
        pc
          ? `${pc.name === 'waist' ? '襠部／主體' : PIECE_NAMES[pc.kind]}的${CONN_NAMES[pc.name]}`
          : '機體根部（地面）',
      ],
      ...(names.length ? [['此區塊的連接點', names.join('、')]] : []),
    ];
  }
  download() {
    const src = this.store.source(this.entry.id);
    if (src.kind !== 'glb') return;
    this.saveBlob(
      new Blob([src.buf], { type: 'model/gltf-binary' }),
      this.entry.id.split('/').slice(1).join('_') + '.glb',
    );
  }
  // 程式模型照規格匯出的範本（檔名加 _template，避免和正式檔混淆）
  async downloadTemplate() {
    const buf = await exportTemplate(this.entry, $('insPal').value || null);
    this.saveBlob(
      new Blob([buf], { type: 'model/gltf-binary' }),
      this.entry.id.split('/').slice(1).join('_') + '_template.glb',
    );
  }
  saveBlob(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  applyOpts() {
    const o = this.opts,
      R = this.refs;
    if (!R) return;
    for (const d of R.dims) {
      d.dims.visible = o.dims;
      d.box.visible = o.box;
    }
    R.ruler.group.visible = o.ruler;
    R.human.group.visible = o.human;
    R.grid.visible = o.grid;
    for (const a of this.helpers.axes) a.visible = o.axes;
    for (const c of this.helpers.conns) c.visible = o.conns;
    for (const it of this.items.slice(0, this.mode === 'overlay' ? 1 : 2))
      it.pivot.traverse((m) => {
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
    if (!this.open_ || !this.items.length) return;
    this.t += dt;
    this.resize(false);
    for (const it of this.items) {
      if (this.opts.rotate) it.pivot.rotation.y += dt * 0.4;
      const rig = it.built.rig;
      if (rig) animateMech(rig, dt, rig.vehicle ? { t: this.t } : animState(this.anim, this.t));
    }
    // 噴焰：整台機甲依動作的推力；單獨檢視背包時以中等推力從噴口連接點噴出
    if (this.opts.flame) {
      const rig = this.main && this.main.built.rig;
      const pal = $('insPal').value || this.entry.pal;
      const col = pal === 'player' ? 0x8fe8ff : 0xffb060;
      if (rig && !rig.vehicle && rig.nozzles && rig.nozzles.length)
        this.thruster.stream(rig, rig.thrust || 0, col, rig.group.getWorldScale(new THREE.Vector3()).x, dt);
      else if (this.flameSrc) this.thruster.stream(this.flameSrc, 0.6, col, 1, dt);
    }
    this.thruster.update(dt);
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
      if (l.key !== 'always' && !this.opts[l.key]) {
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
