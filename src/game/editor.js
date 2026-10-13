// Game：關卡編輯器（state 'editor'；設計見 docs/level-editor-design.md）的核心——地圖的建立與同步、鏡頭、
// 點選與拖曳、擺放、地形筆刷、移除產生器物件、輔助標示（單位、標記、路徑、區域、作戰區域）、復原／重做、
// 存檔、試玩。面板在 editor-ui.js，觸發器的編輯在 editor-trig.js。
// 編輯中的關卡在 this.ed.L（整份，含多段）；目前這一段的內容是 edCur()（第 0 段＝L 本身）。
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { applyLevelProps, levelWorldOpt, placeProp, removePlaced } from '../level/build.js';
import {
  GROUP_COLORS,
  LIMITS,
  MARK_KINDS,
  decodeHeights,
  encodeHeights,
  levelBytes,
  segOf,
  stripMeta,
} from '../level/format.js';
import { loadLevel, unitName } from '../level/known.js';
import { placeById } from '../level/placeables.js';
import { LevelStore } from '../level/store.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
// 復原紀錄存的欄位（目前這一段的內容）
const SNAP = [
  'base',
  'terrain',
  'removed',
  'props',
  'marks',
  'paths',
  'areas',
  'groups',
  'units',
  'counters',
  'triggers',
];
const UNDO_MAX = 60;
const CELL = 2.5;
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0').slice(-6);
const LABELS = new Map();
// 標籤的貼圖（同樣的文字與顏色共用）
function labelTex(text, color) {
  const k = text + '|' + color;
  if (LABELS.has(k)) return LABELS.get(k);
  const cv = document.createElement('canvas');
  const c = cv.getContext('2d');
  c.font = 'bold 30px sans-serif';
  const w = Math.min(512, Math.ceil(c.measureText(text).width) + 24);
  cv.width = w;
  cv.height = 44;
  c.font = 'bold 30px sans-serif';
  c.fillStyle = 'rgba(8,12,18,0.78)';
  c.fillRect(0, 0, w, 44);
  c.strokeStyle = color;
  c.lineWidth = 3;
  c.strokeRect(1.5, 1.5, w - 3, 41);
  c.fillStyle = color;
  c.textBaseline = 'middle';
  c.fillText(text, 12, 23);
  const t = new THREE.CanvasTexture(cv);
  t.userData = { w, h: 44 };
  LABELS.set(k, t);
  if (LABELS.size > 600) LABELS.delete(LABELS.keys().next().value);
  return t;
}
function label(text, color, y, scale = 0.045) {
  const t = labelTex(text, color);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(t.userData.w * scale, t.userData.h * scale, 1);
  s.position.y = y;
  s.renderOrder = 20;
  return s;
}
const MATS = new Map();
const flatMat = (color, op = 1) => {
  const k = color + '|' + op;
  if (!MATS.has(k))
    MATS.set(
      k,
      new THREE.MeshBasicMaterial({
        color,
        transparent: op < 1,
        opacity: op,
        depthWrite: op >= 1,
        side: THREE.DoubleSide,
      }),
    );
  return MATS.get(k);
};
const GEO = {};
const geo = (k, make) => GEO[k] || (GEO[k] = make());

Object.assign(Game.prototype, {
  edInit() {
    const cv = this.canvas;
    const P = (type) => (e) => this.state === 'editor' && this.edPointer(type, e);
    cv.addEventListener('pointerdown', P('down'));
    addEventListener('pointermove', P('move'));
    addEventListener('pointerup', P('up'));
    addEventListener('pointercancel', P('up'));
    cv.addEventListener('wheel', (e) => this.state === 'editor' && this.edWheel(e), { passive: false });
    addEventListener('keydown', (e) => this.state === 'editor' && this.edKey(e));
    this.edUiInit();
  },
  edCur() {
    const ed = this.ed;
    return ed.seg ? ed.L.segs[ed.seg - 1] : ed.L;
  },
  // ---------- 開啟／離開 ----------
  edOpen(L, o = {}) {
    if (this.net && this.net.role) return;
    if (this.edPhone()) return this.flashMsg('請用電腦或平板編輯關卡', 0xff8a8a, 2);
    SFX.init();
    this.clearMission();
    this.ed = {
      L,
      seg: 0,
      tool: 'select',
      sel: null,
      undo: [],
      redo: [],
      cam: { x: 0, z: 0, yaw: 0.7, pitch: 0.95, dist: 110 },
      brush: { k: 'raise', r: 8, s: 1 },
      place: null,
      unitKind: 'enemy',
      unitType: 'mt',
      markKind: 'spawnpt',
      grp: (L.groups[0] || {}).id || '',
      snap: 1,
      dirty: !!o.fresh,
      ptrs: new Map(),
      hg: null,
      genMode: false,
      msg: '',
      saved: !o.fresh,
    };
    document.body.classList.add('editing');
    this.edBuildWorld();
    this.state = 'editor';
    this.showScreen('editor');
    this.edRenderUi();
    if (o.pick)
      this.edPickOpen('new'); // 新建：先挑底圖（editor-pick.js），按確定才存檔
    else if (o.fresh) this.edSave(true);
  },
  edClose() {
    const ed = this.ed;
    if (!ed) return;
    const go = () => {
      this.edDisposeHelpers();
      this.clearMission();
      this.camera.far = 400;
      if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
      this.camera.updateProjectionMatrix();
      document.body.classList.remove('editing', 'edPicking');
      const id = ed.L.id;
      this.ed = null;
      this.openLevels(id);
    };
    if (ed.dirty)
      return this.edModal('關卡還沒存檔。', [
        ['存檔並離開', () => this.edSave().then(go)],
        ['不存檔離開', go],
        ['取消', null],
      ]);
    go();
  },
  // 建立目前這一段的地圖（底圖改了、換段、試玩回來時重建）
  edBuildWorld() {
    const ed = this.ed,
      cur = this.edCur();
    this.edDisposeHelpers();
    this.clearMission();
    const B = cur.base;
    this.world = new World(this.scene, B.theme, B.seed, B.level, null, levelWorldOpt(cur));
    const w = this.world;
    w.applyLight(this);
    if (this.scene.fog) this.scene.fog = new THREE.Fog(this.scene.fog.color.getHex(), 160, 620);
    this.camera.far = 900;
    this.camera.updateProjectionMatrix();
    applyLevelProps(w, cur);
    for (const r of w.lvProps) if (r) r.key = JSON.stringify(r.p);
    // 新關卡（或重建底圖）：寫入這張地圖的高度
    if (!cur.terrain.n || !decodeHeights(cur.terrain.h, cur.terrain.n)) {
      cur.terrain = { n: w.h.length, h: encodeHeights(w.h), water: cur.terrain.water };
    }
    ed.hApplied = cur.terrain.h;
    this.edSlopeTint();
    this.worldSeed = B.seed;
    this.worldTheme = B.theme;
    this.styleRefresh();
    this.stylePipe.resetHistory();
    ed.hg = new THREE.Group();
    ed.hg.userData.helper = true;
    this.scene.add(ed.hg);
    this.edRebuildHelpers();
  },
  edDisposeHelpers() {
    const ed = this.ed;
    if (!ed || !ed.hg) return;
    this.scene.remove(ed.hg);
    ed.hg.traverse((o) => {
      if (o.isSprite) o.material.dispose();
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    ed.hg = null;
    if (ed.selBox) {
      this.scene.remove(ed.selBox);
      ed.selBox = null;
    }
    if (ed.cursor) {
      this.scene.remove(ed.cursor);
      ed.cursor = null;
    }
  },
  // ---------- 每格 ----------
  edTick(dt) {
    const ed = this.ed;
    if (!ed || !this.world) return;
    const k = this.keys;
    const C = ed.cam;
    if (!this.edTyping()) {
      const sp = dt * C.dist * 0.9;
      const fx = -Math.sin(C.yaw),
        fz = -Math.cos(C.yaw);
      if (k.KeyW) ((C.x += fx * sp), (C.z += fz * sp));
      if (k.KeyS) ((C.x -= fx * sp), (C.z -= fz * sp));
      if (k.KeyA) ((C.x += fz * sp), (C.z -= fx * sp));
      if (k.KeyD) ((C.x -= fz * sp), (C.z += fx * sp));
      if (k.KeyQ) C.yaw += dt * 1.4;
      if (k.KeyE) C.yaw -= dt * 1.4;
    }
    const lim = this.world.size * 0.75;
    C.x = clamp(C.x, -lim, lim);
    C.z = clamp(C.z, -lim, lim);
    // 筆刷：按住時持續作用
    if (ed.stroke && ed.stroke.down) this.edBrushStep(dt);
    if (ed.pick) this.edPickTick(dt); // 挑底圖（editor-pick.js）
    if (!this.world) return;
    this.edCamApply();
    if (ed.selBox) ed.selBox.update();
    this.renderMain();
    this.hctx.clearRect(0, 0, innerWidth, innerHeight);
  },
  // 鏡頭與太陽跟著 ed.cam（注視點 x／z、方位 yaw、俯角 pitch、距離 dist）
  edCamApply() {
    const C = this.ed.cam;
    // 挑底圖：畫面中心移到左側面板以外的地方（拍縮圖時 edThumb 會暫時拿掉）
    const pp = this.ed.pick && document.getElementById('epPanel');
    const off = pp ? pp.offsetWidth / 2 : 0;
    if (off) this.camera.setViewOffset(innerWidth, innerHeight, -off, 0, innerWidth, innerHeight);
    else if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    const gy = this.world.terrainHeight(C.x, C.z);
    const cp = Math.cos(C.pitch);
    const cam = this.camera;
    cam.position.set(
      C.x + Math.sin(C.yaw) * cp * C.dist,
      gy + Math.sin(C.pitch) * C.dist,
      C.z + Math.cos(C.yaw) * cp * C.dist,
    );
    cam.lookAt(C.x, gy, C.z);
    const focus = new THREE.Vector3(C.x, gy, C.z);
    this.camTarget.copy(focus);
    this.sun.position.copy(focus).add(this.sunOff);
    this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    const R = clamp(C.dist * 0.9, 70, 160);
    if (sc.right !== R) {
      sc.left = sc.bottom = -R;
      sc.right = sc.top = R;
      sc.updateProjectionMatrix();
    }
  },
  edTyping() {
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  },
  // ---------- 點選 ----------
  edRay(e) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    ray.camera = this.camera;
    return ray;
  },
  // 地面（地形＋物件頂面）上的點；skip＝拖曳中的物件不算
  edGround(e, skip) {
    const w = this.world;
    const ray = this.edRay(e);
    const objs = [w.terrainMesh];
    for (const r of w.lvProps || []) if (r && r.group !== skip && r.group.visible) objs.push(r.group);
    for (const it of w.genItems || []) if (!it.removed && it.g.visible && !it.decor) objs.push(it.g);
    const hits = ray.intersectObjects(objs, true).filter((h) => h.object.isMesh && !h.object.userData.xray);
    if (hits.length) {
      const h = hits[0];
      const onTerrain = h.object === w.terrainMesh;
      return { x: h.point.x, y: h.point.y, z: h.point.z, terrain: onTerrain };
    }
    // 沒打到：和 y＝0 的平面求交
    const o = ray.ray.origin,
      d = ray.ray.direction;
    if (Math.abs(d.y) < 1e-4) return null;
    const t = -o.y / d.y;
    if (t < 0) return null;
    const x = o.x + d.x * t,
      z = o.z + d.z * t;
    return { x, y: w.terrainHeight(x, z), z, terrain: true };
  },
  // 點到的東西：輔助標示（單位、標記、路徑點、區域）＞擺放的物件＞（移除模式）產生器物件
  edPick(e) {
    const ed = this.ed,
      w = this.world;
    const ray = this.edRay(e);
    if (ed.hg) {
      const hits = ray.intersectObjects(ed.hg.children, true);
      for (const h of hits) {
        let o = h.object;
        while (o && !o.userData.edRef) o = o.parent;
        if (o && o.userData.edRef) return o.userData.edRef;
      }
    }
    const props = (w.lvProps || []).filter((r) => r && r.group.visible).map((r) => r.group);
    const ph = ray.intersectObjects(props, true).filter((h) => h.object.isMesh);
    const th = ray.intersectObject(w.terrainMesh, false);
    if (ph.length && (!th.length || ph[0].distance < th[0].distance + 0.5)) {
      let o = ph[0].object;
      while (o && !o.userData.levelProp) o = o.parent;
      const i = w.lvProps.findIndex((r) => r && r.group === o);
      if (i >= 0) return { t: 'prop', i };
    }
    if (ed.genMode) {
      const gi = (w.genItems || []).filter((it) => !it.removed && it.g.visible);
      const gh = ray.intersectObjects(
        gi.map((it) => it.g),
        true,
      );
      if (gh.length && (!th.length || gh[0].distance < th[0].distance + 0.5)) {
        let o = gh[0].object;
        while (o && !gi.some((it) => it.g === o)) o = o.parent;
        const it = gi.find((x) => x.g === o);
        if (it) return { t: 'gen', it };
      }
    }
    return null;
  },
  // ---------- 指標 ----------
  edPointer(type, e) {
    const ed = this.ed;
    if (!ed) return;
    if (type === 'down') {
      if (e.target !== this.canvas) return;
      this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId);
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    }
    const ptrs = ed.ptrs;
    if (type === 'down')
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, b: e.button });
    const p = ptrs.get(e.pointerId);
    if (!p) {
      if (type === 'move') this.edHover(e);
      return;
    }
    // 雙指：縮放、旋轉、俯仰（平板）
    if (ptrs.size >= 2) {
      ed.drag = null;
      if (ed.stroke) this.edStrokeEnd();
      if (type === 'move') {
        const [a, b] = [...ptrs.values()];
        const d0 = Math.hypot(a.x - b.x, a.y - b.y),
          ang0 = Math.atan2(b.y - a.y, b.x - a.x),
          my0 = (a.y + b.y) / 2;
        p.x = e.clientX;
        p.y = e.clientY;
        const d1 = Math.hypot(a.x - b.x, a.y - b.y),
          ang1 = Math.atan2(b.y - a.y, b.x - a.x),
          my1 = (a.y + b.y) / 2;
        const C = ed.cam;
        if (d0 > 10) C.dist = clamp((C.dist * d0) / Math.max(10, d1), 8, 320);
        C.yaw += ang1 - ang0;
        C.pitch = clamp(C.pitch + (my1 - my0) * 0.004, 0.15, 1.5);
      }
      if (type === 'up') ptrs.delete(e.pointerId);
      return;
    }
    const dx = e.clientX - p.x,
      dy = e.clientY - p.y;
    if (type === 'down') return this.edDown(e, p);
    if (type === 'move') {
      p.x = e.clientX;
      p.y = e.clientY;
      p.moved = p.moved || Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6;
      const C = ed.cam;
      if (p.cam === 'rot') {
        C.yaw -= dx * 0.006;
        C.pitch = clamp(C.pitch + dy * 0.005, 0.15, 1.5);
      } else if (p.cam === 'pan') {
        const k = C.dist * 0.0018;
        const fx = -Math.sin(C.yaw),
          fz = -Math.cos(C.yaw);
        C.x -= (-fz * dx - fx * dy) * k * -1;
        C.z -= (fx * dx - fz * dy) * k * -1;
      } else if (ed.drag) this.edDragMove(e);
      else if (ed.stroke) this.edStrokeMove(e);
      else if (ed.areaDraw) this.edAreaMove(e);
      this.edHover(e);
      return;
    }
    if (type === 'up') {
      ptrs.delete(e.pointerId);
      if (ed.drag) this.edDragEnd(e);
      if (ed.stroke) this.edStrokeEnd();
      if (ed.areaDraw) this.edAreaEnd(e);
      // 點一下（沒移動）：選取 tap
      if (!p.moved && p.tap) p.tap();
    }
  },
  edWheel(e) {
    e.preventDefault();
    const C = this.ed.cam;
    C.dist = clamp(C.dist * (e.deltaY > 0 ? 1.12 : 0.89), 8, 320);
  },
  edDown(e, p) {
    const ed = this.ed;
    // 挑底圖：只能轉鏡頭（左鍵旋轉、右鍵或 Shift 平移）
    if (ed.pick) return (p.cam = e.button === 0 && !e.shiftKey ? 'rot' : 'pan');
    if (e.button === 2 || (e.button === 0 && e.altKey)) return (p.cam = 'rot');
    if (e.button === 1 || (e.button === 0 && e.shiftKey && ed.tool === 'select')) return (p.cam = 'pan');
    const tool = ed.tool;
    const hit = this.edPick(e);
    const gp = this.edGround(e);
    if (tool === 'terrain') {
      if (!gp) return;
      return this.edStrokeStart(gp);
    }
    if (tool === 'area' && ed.areaNew) {
      if (!gp) return;
      ed.areaDraw = { x0: gp.x, z0: gp.z, x1: gp.x, z1: gp.z, sh: ed.areaNew };
      return;
    }
    if (tool === 'path' && ed.pathAdd !== undefined && ed.pathAdd !== null) {
      // 加路徑點（點到已有的點時拖曳它）
      if (hit && hit.t === 'pathpt' && hit.i === ed.pathAdd) {
        this.edSelect(hit);
        return this.edDragStart(hit, gp);
      }
      if (gp) this.edAddPathPoint(gp);
      return;
    }
    // 放置（選了物件時點哪裡都放，點在物件頂面＝疊上去）；移除模式：點產生器物件移除、點標示還原
    if (tool === 'prop') {
      if (ed.genMode) {
        if (hit && hit.t === 'gen') return this.edGenToggle(hit.it);
        if (hit && hit.t === 'removed') return this.edGenRestore(hit.i);
      } else if (ed.place && gp) return this.edPlaceProp(gp);
    }
    if (tool === 'unit' && !hit && gp) return this.edPlaceUnit(gp);
    if (tool === 'mark' && !hit && gp) return this.edPlaceMark(gp);
    if (hit && hit.t !== 'gen' && hit.t !== 'removed') {
      this.edSelect(hit);
      return this.edDragStart(hit, gp);
    }
    // 空地：拖曳＝平移鏡頭，點一下＝取消選取
    p.cam = 'pan';
    p.tap = () => {
      if (tool === 'unit' && gp) return this.edPlaceUnit(gp);
      if (tool === 'mark' && gp) return this.edPlaceMark(gp);
      this.edSelect(null);
    };
  },
  edHover(e) {
    const ed = this.ed;
    if (!ed || e.target !== this.canvas) return;
    const gp = this.edGround(e);
    ed.hover = gp;
    const cur = this.edCursor();
    if (cur) {
      cur.visible = !!gp && ed.tool === 'terrain';
      if (gp && cur.visible) {
        cur.position.set(gp.x, gp.y + 0.3, gp.z);
        cur.scale.setScalar(ed.brush.r);
      }
    }
    this.edStatus();
  },
  edCursor() {
    const ed = this.ed;
    if (!ed.cursor) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 48),
        new THREE.MeshBasicMaterial({
          color: 0xffd060,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 30;
      ed.cursor = m;
      this.scene.add(m);
    }
    return ed.cursor;
  },
  // ---------- 選取與拖曳 ----------
  edSelect(ref) {
    const ed = this.ed;
    ed.sel = ref;
    if (ed.selBox) {
      this.scene.remove(ed.selBox);
      ed.selBox = null;
    }
    if (ref && ref.t === 'prop') {
      const r = this.world.lvProps[ref.i];
      if (r) {
        ed.selBox = new THREE.BoxHelper(r.group, 0xffd060);
        ed.selBox.material.depthTest = false;
        ed.selBox.renderOrder = 25;
        this.scene.add(ed.selBox);
      }
    }
    this.edRebuildHelpers();
    this.edRenderInspector();
  },
  edRefObj(ref) {
    const cur = this.edCur();
    if (!ref) return null;
    if (ref.t === 'prop') return cur.props[ref.i];
    if (ref.t === 'unit') return cur.units[ref.i];
    if (ref.t === 'mark') return cur.marks[ref.i];
    if (ref.t === 'area') return cur.areas[ref.i];
    if (ref.t === 'path') return cur.paths[ref.i];
    if (ref.t === 'pathpt') return cur.paths[ref.i];
    return null;
  },
  edDragStart(ref, gp) {
    const o = this.edRefObj(ref);
    if (!o || !gp) return;
    const ed = this.ed;
    if (ref.t === 'pathpt') {
      const q = o.pts[ref.j];
      ed.drag = { ref, ox: q[0] - gp.x, oz: q[1] - gp.z, moved: false };
    } else if (ref.t === 'path') return;
    else ed.drag = { ref, ox: o.x - gp.x, oz: o.z - gp.z, moved: false };
  },
  edDragMove(e) {
    const ed = this.ed,
      d = ed.drag;
    const ref = d.ref;
    const rec = ref.t === 'prop' ? this.world.lvProps[ref.i] : null;
    const gp = this.edGround(e, rec && rec.group);
    if (!gp) return;
    if (!d.moved) {
      this.edPush();
      d.moved = true;
    }
    const sn = (v) => (ed.snap ? Math.round(v / ed.snap) * ed.snap : v);
    const x = sn(gp.x + d.ox),
      z = sn(gp.z + d.oz);
    const o = this.edRefObj(ref);
    if (ref.t === 'pathpt') {
      o.pts[ref.j][0] = +x.toFixed(2);
      o.pts[ref.j][1] = +z.toFixed(2);
    } else {
      o.x = +x.toFixed(2);
      o.z = +z.toFixed(2);
      if (ref.t === 'unit' || ref.t === 'mark') o.y = +this.world.groundAt(o.x, o.z, 99).toFixed(2);
    }
    if (rec) {
      rec.group.position.x = o.x;
      rec.group.position.z = o.z;
      rec.group.position.y = o.g ? this.world.terrainHeight(o.x, o.z) + o.y : o.y;
    } else this.edRebuildHelpers();
  },
  edDragEnd() {
    const ed = this.ed,
      d = ed.drag;
    ed.drag = null;
    if (!d.moved) return;
    if (d.ref.t === 'prop') this.edSyncProps();
    this.edChanged();
    this.edRenderInspector();
  },
  // ---------- 擺放 ----------
  edPlaceProp(gp) {
    const ed = this.ed,
      cur = this.edCur();
    if (cur.props.length >= LIMITS.props) return this.edMsg(`物件已達上限 ${LIMITS.props}`, true);
    const def = placeById(ed.place);
    if (!def) return;
    this.edPush();
    const sn = (v) => (ed.snap ? Math.round(v / ed.snap) * ed.snap : v);
    const p = {
      t: def.id,
      x: +sn(gp.x).toFixed(2),
      y: gp.terrain ? 0 : +gp.y.toFixed(2),
      z: +sn(gp.z).toFixed(2),
      g: !!gp.terrain,
      yaw: ed.lastYaw || 0,
      s: [1, 1, 1],
      col: def.col || 'box',
      hp: def.hp || 0,
      tag: '',
    };
    cur.props.push(p);
    this.edSyncProps();
    this.edChanged();
    this.edSelect({ t: 'prop', i: cur.props.length - 1 });
  },
  edPlaceUnit(gp) {
    const ed = this.ed,
      cur = this.edCur();
    if (cur.units.length >= LIMITS.units) return this.edMsg(`單位已達上限 ${LIMITS.units}`, true);
    if (ed.unitKind === 'boss' && cur.units.some((u) => u.kind === 'boss'))
      return this.edMsg('每一段最多放一隻 Boss', true);
    this.edPush();
    if (!cur.groups.length) cur.groups.push({ id: 'g1', name: 'A 隊', color: GROUP_COLORS[0] });
    if (!cur.groups.some((g) => g.id === ed.grp)) ed.grp = cur.groups[0].id;
    let n = cur.units.length + 1;
    while (cur.units.some((u) => u.id === 'u' + n)) n++;
    const u = {
      id: 'u' + n,
      kind: ed.unitKind,
      type: ed.unitType,
      x: +gp.x.toFixed(2),
      y: +gp.y.toFixed(2),
      z: +gp.z.toFixed(2),
      yaw: 0,
      g: ed.grp,
      at: 'start',
      k: 1,
      beh: {
        k: ed.unitKind === 'convoy' ? 'patrol' : 'attack',
        path: '',
        r: 35,
        m: '',
        back: false,
        speed: 0.6,
      },
    };
    cur.units.push(u);
    this.edChanged();
    this.edSelect({ t: 'unit', i: cur.units.length - 1 });
  },
  edPlaceMark(gp) {
    const ed = this.ed,
      cur = this.edCur();
    const K = MARK_KINDS[ed.markKind];
    if (cur.marks.length >= LIMITS.marks) return this.edMsg(`標記已達上限 ${LIMITS.marks}`, true);
    if (K.max && cur.marks.filter((m) => m.k === ed.markKind).length >= K.max)
      return this.edMsg(`${K.name}最多 ${K.max} 個`, true);
    this.edPush();
    let n = cur.marks.length + 1;
    while (cur.marks.some((m) => m.id === 'm' + n)) n++;
    const cnt = cur.marks.filter((m) => m.k === ed.markKind).length + 1;
    const m = {
      k: ed.markKind,
      id: 'm' + n,
      name: K.name.replace(/（.*）/, '') + ' ' + cnt,
      x: +gp.x.toFixed(2),
      y: +gp.y.toFixed(2),
      z: +gp.z.toFixed(2),
      yaw: 0,
    };
    if (m.k === 'cache') m.cache = 'repair';
    if (m.k === 'target' || m.k === 'defend') m.hp = 1;
    if (m.k === 'term') m.t = 4;
    if (m.k === 'exit') m.open = false;
    if (m.k === 'supply') m.once = true;
    cur.marks.push(m);
    this.edChanged();
    this.edSelect({ t: 'mark', i: cur.marks.length - 1 });
  },
  edAddPathPoint(gp) {
    const ed = this.ed,
      P = this.edCur().paths[ed.pathAdd];
    if (!P) return;
    if (P.pts.length >= LIMITS.pathPts) return this.edMsg(`路徑點最多 ${LIMITS.pathPts} 個`, true);
    this.edPush();
    P.pts.push([+gp.x.toFixed(2), +gp.z.toFixed(2), 0]);
    this.edChanged();
    this.edRebuildHelpers();
    this.edRenderInspector();
  },
  edAreaMove(e) {
    const gp = this.edGround(e);
    if (!gp) return;
    const a = this.ed.areaDraw;
    a.x1 = gp.x;
    a.z1 = gp.z;
    this.edRebuildHelpers();
  },
  edAreaEnd() {
    const ed = this.ed,
      a = ed.areaDraw,
      cur = this.edCur();
    ed.areaDraw = null;
    const w = Math.abs(a.x1 - a.x0),
      d = Math.abs(a.z1 - a.z0);
    if (cur.areas.length >= LIMITS.areas) return this.edMsg(`區域已達上限 ${LIMITS.areas}`, true);
    this.edPush();
    let n = cur.areas.length + 1;
    while (cur.areas.some((x) => x.id === 'a' + n)) n++;
    const circle = a.sh === 'circle';
    const area = {
      id: 'a' + n,
      name: '區域 ' + n,
      sh: circle ? 'circle' : 'box',
      x: +(circle ? a.x0 : (a.x0 + a.x1) / 2).toFixed(2),
      z: +(circle ? a.z0 : (a.z0 + a.z1) / 2).toFixed(2),
      w: +Math.max(4, w).toFixed(1),
      d: +Math.max(4, d).toFixed(1),
      r: +Math.max(3, Math.hypot(a.x1 - a.x0, a.z1 - a.z0)).toFixed(1),
      yaw: 0,
      show: false,
      color: GROUP_COLORS[(n + 2) % GROUP_COLORS.length],
    };
    cur.areas.push(area);
    ed.areaNew = null;
    this.edChanged();
    this.edSelect({ t: 'area', i: cur.areas.length - 1 });
    this.edRenderPalette();
  },
  // ---------- 產生器物件的移除 ----------
  edGenToggle(it) {
    const cur = this.edCur();
    this.edPush();
    this.world.removeGenItem(it);
    cur.removed.push([+it.x.toFixed(2), +it.z.toFixed(2)]);
    this.edChanged();
    this.edRebuildHelpers();
  },
  edGenRestore(i) {
    const cur = this.edCur();
    const r = cur.removed[i];
    if (!r) return;
    this.edPush();
    cur.removed.splice(i, 1);
    this.edSyncGen();
    this.edChanged();
    this.edRebuildHelpers();
  },
  edSyncGen() {
    const w = this.world,
      cur = this.edCur();
    for (const it of w.genItems || []) {
      const rm =
        (cur.base.props === 'big' && it.small) ||
        cur.removed.some((r) => Math.hypot(r[0] - it.x, r[1] - it.z) < 1.5);
      if (rm && !it.removed) w.removeGenItem(it);
      else if (!rm && it.removed) w.restoreGenItem(it);
    }
  },
  // ---------- 地形筆刷 ----------
  edStrokeStart(gp) {
    const ed = this.ed,
      w = this.world;
    const B = ed.brush;
    if (B.k === 'slope') {
      // 斜坡：第一下定起點，第二下定終點
      if (!ed.slopeA) {
        ed.slopeA = { x: gp.x, z: gp.z, h: w.terrainHeight(gp.x, gp.z) };
        this.edMsg('斜坡：再點一下終點');
        this.edRebuildHelpers();
        return;
      }
      this.edPush();
      this.edSlope(ed.slopeA, { x: gp.x, z: gp.z, h: w.terrainHeight(gp.x, gp.z) });
      ed.slopeA = null;
      this.edTerrainCommit();
      this.edRebuildHelpers();
      return;
    }
    this.edPush();
    ed.stroke = { down: true, x: gp.x, z: gp.z, target: w.terrainHeight(gp.x, gp.z), n: 0 };
  },
  edStrokeMove(e) {
    const gp = this.edGround(e);
    if (gp && this.ed.stroke) {
      this.ed.stroke.x = gp.x;
      this.ed.stroke.z = gp.z;
    }
  },
  edBrushStep(dt) {
    const ed = this.ed,
      w = this.world,
      S = ed.stroke,
      B = ed.brush;
    const n = w.cells + 1,
      h = w.h,
      half = w.size / 2;
    const i0 = Math.max(0, Math.floor((S.x - B.r + half) / CELL)),
      i1 = Math.min(n - 1, Math.ceil((S.x + B.r + half) / CELL)),
      j0 = Math.max(0, Math.floor((S.z - B.r + half) / CELL)),
      j1 = Math.min(n - 1, Math.ceil((S.z + B.r + half) / CELL));
    const src = B.k === 'smooth' ? Float32Array.from(h) : h;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = i * CELL - half,
          z = j * CELL - half;
        const d = Math.hypot(x - S.x, z - S.z);
        if (d > B.r) continue;
        const t = 1 - d / B.r;
        const f = t * t * (3 - 2 * t);
        const k = j * n + i;
        if (B.k === 'raise') h[k] += f * B.s * 6 * dt;
        else if (B.k === 'lower') h[k] -= f * B.s * 6 * dt;
        else if (B.k === 'flat') h[k] += (S.target - h[k]) * Math.min(1, f * B.s * 8 * dt);
        else if (B.k === 'smooth') {
          const g = (a, b) => src[clamp(b, 0, n - 1) * n + clamp(a, 0, n - 1)];
          const avg = (g(i - 1, j) + g(i + 1, j) + g(i, j - 1) + g(i, j + 1)) / 4;
          h[k] += (avg - h[k]) * Math.min(1, f * B.s * 8 * dt);
        } else if (B.k === 'noise') {
          const nv =
            Math.sin(x * 0.37 + z * 0.11) * Math.cos(z * 0.29 - x * 0.07) + Math.sin(x * 0.9 + z * 1.3) * 0.3;
          h[k] += nv * f * B.s * 3 * dt;
        }
        h[k] = clamp(h[k], -40, 80);
      }
    S.n++;
    if (S.n % 3 === 0) {
      w.buildTerrainMesh(true);
      this.edSlopeTint();
    }
  },
  // 編輯器：坡度太陡（機甲走不上去，同 World.slopeOK）的三角形染紅
  edSlopeTint() {
    const w = this.world,
      m = w && w.terrainMesh;
    if (!m || (this.ed && this.ed.pick)) return; // 挑底圖時不染（預覽看原本的顏色）
    const pos = m.geometry.attributes.position,
      col = m.geometry.attributes.color;
    for (let f = 0; f < pos.count; f += 3) {
      const x = (pos.getX(f) + pos.getX(f + 1) + pos.getX(f + 2)) / 3,
        z = (pos.getZ(f) + pos.getZ(f + 1) + pos.getZ(f + 2)) / 3;
      if (w.slopeOK(x, z)) continue;
      for (let q = 0; q < 3; q++) col.setXYZ(f + q, 0.85, 0.25, 0.2);
    }
    col.needsUpdate = true;
  },
  edSlope(A, Bp) {
    const w = this.world,
      r = this.ed.brush.r;
    const n = w.cells + 1,
      h = w.h,
      half = w.size / 2;
    const vx = Bp.x - A.x,
      vz = Bp.z - A.z,
      L2 = vx * vx + vz * vz || 1;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = i * CELL - half,
          z = j * CELL - half;
        const t = clamp(((x - A.x) * vx + (z - A.z) * vz) / L2, 0, 1);
        const px = A.x + vx * t,
          pz = A.z + vz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d > r) continue;
        const e = d < r * 0.6 ? 1 : 1 - (d - r * 0.6) / (r * 0.4);
        const target = A.h + (Bp.h - A.h) * t;
        const k = j * n + i;
        h[k] += (target - h[k]) * e;
      }
  },
  edStrokeEnd() {
    const ed = this.ed;
    if (!ed.stroke) return;
    ed.stroke = null;
    this.edTerrainCommit();
  },
  // 筆刷結束：寫回關卡、重建網格、貼地的物件跟著地形
  edTerrainCommit() {
    const ed = this.ed,
      w = this.world,
      cur = this.edCur();
    w.buildTerrainMesh(true);
    this.edSlopeTint();
    cur.terrain.h = encodeHeights(w.h);
    cur.terrain.n = w.h.length;
    ed.hApplied = cur.terrain.h;
    this.edSyncProps(true);
    this.edChanged();
    this.edRebuildHelpers();
  },
  edSetWater(on, y) {
    const cur = this.edCur();
    this.edPush();
    cur.terrain.water = on ? +(+y || 0).toFixed(2) : null;
    this.edChanged();
    if (on) this.world.setWaterLevel(cur.terrain.water);
    else if (this.world.waterMesh) this.edMsg('拿掉自訂水面：重建底圖後生效（回到主題原本的水面）');
  },
  // ---------- 同步：關卡內容 → 場景 ----------
  // 擺放的物件：內容變了的重建；ground＝貼地的一律重建（地形改了）
  edSyncProps(ground) {
    const w = this.world,
      cur = this.edCur();
    const recs = w.lvProps || (w.lvProps = []);
    const n = Math.max(recs.length, cur.props.length);
    for (let i = 0; i < n; i++) {
      const p = cur.props[i],
        r = recs[i];
      const key = p ? JSON.stringify(p) : '';
      if (r && p && r.key === key && !(ground && p.g)) continue;
      if (r) removePlaced(w, r);
      recs[i] = p ? placeProp(w, p, i) : null;
      if (recs[i]) recs[i].key = key;
    }
    recs.length = cur.props.length;
    if (this.ed.sel && this.ed.sel.t === 'prop')
      this.edSelect(this.ed.sel.i < cur.props.length ? this.ed.sel : null);
  },
  // 復原／重做後：整個場景依關卡內容同步（底圖不同就重建）
  edApply(prevBase) {
    const ed = this.ed,
      cur = this.edCur();
    const baseChanged = JSON.stringify(prevBase) !== JSON.stringify(cur.base);
    if (baseChanged) return this.edBuildWorld();
    const w = this.world;
    if (ed.hApplied !== cur.terrain.h) {
      const h = decodeHeights(cur.terrain.h, cur.terrain.n);
      if (h && h.length === w.h.length) {
        w.h = h;
        w.buildTerrainMesh(true);
        this.edSlopeTint();
      }
      ed.hApplied = cur.terrain.h;
      this.edSyncProps(true);
    } else this.edSyncProps();
    if (cur.terrain.water !== null && cur.terrain.water !== undefined) w.setWaterLevel(cur.terrain.water);
    this.edSyncGen();
    this.edSelect(null);
  },
  // ---------- 復原 ----------
  edSnap() {
    const cur = this.edCur();
    const o = {};
    for (const k of SNAP) o[k] = cur[k];
    return JSON.stringify(o);
  },
  edPush() {
    const ed = this.ed;
    ed.undo.push(this.edSnap());
    if (ed.undo.length > UNDO_MAX) ed.undo.shift();
    ed.redo = [];
  },
  edUndo(redo) {
    const ed = this.ed;
    const from = redo ? ed.redo : ed.undo,
      to = redo ? ed.undo : ed.redo;
    if (!from.length) return this.edMsg(redo ? '沒有可以重做的' : '沒有可以復原的');
    const prevBase = JSON.parse(JSON.stringify(this.edCur().base));
    to.push(this.edSnap());
    const o = JSON.parse(from.pop());
    const cur = this.edCur();
    for (const k of SNAP) cur[k] = o[k];
    this.edChanged();
    this.edApply(prevBase);
    this.edRenderUi();
  },
  edChanged() {
    const ed = this.ed;
    ed.dirty = true;
    if (ed.L.clear) {
      ed.L.clear = null;
      this.edMsg('關卡改過了：上傳前要重新試玩通關一次');
    }
    this.edStatus();
  },
  // ---------- 輔助標示 ----------
  edRebuildHelpers() {
    const ed = this.ed;
    if (!ed || !ed.hg) return;
    const hg = ed.hg,
      w = this.world,
      cur = this.edCur();
    for (const c of hg.children.slice()) {
      hg.remove(c);
      c.traverse((o) => {
        if (o.isSprite) o.material.dispose();
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
      });
    }
    const sel = ed.sel;
    const isSel = (t, i) => sel && sel.t === t && sel.i === i;
    const gColor = (g) => (cur.groups.find((x) => x.id === g) || {}).color || 0xff5050;
    const ring = geo('ring', () => {
      const g = new THREE.RingGeometry(0.75, 1, 32);
      g.rotateX(-Math.PI / 2);
      g.userData.shared = true;
      return g;
    });
    const pole = geo('pole', () => {
      const g = new THREE.CylinderGeometry(0.12, 0.12, 4, 6);
      g.translate(0, 2, 0);
      g.userData.shared = true;
      return g;
    });
    const disc = geo('disc', () => {
      const g = new THREE.CylinderGeometry(1, 1, 0.5, 20);
      g.translate(0, 0.25, 0);
      g.userData.shared = true;
      return g;
    });
    const arrow = geo('arrow', () => {
      const g = new THREE.ConeGeometry(0.5, 1.4, 8);
      g.rotateX(-Math.PI / 2);
      g.translate(0, 0.6, -1.6);
      g.userData.shared = true;
      return g;
    });
    const dot = geo('dot', () => {
      const g = new THREE.SphereGeometry(0.7, 10, 8);
      g.userData.shared = true;
      return g;
    });
    // 單位
    cur.units.forEach((u, i) => {
      const g = new THREE.Group();
      const col = u.kind === 'ally' || u.kind === 'convoy' ? 0x7ee081 : gColor(u.g);
      const big = u.kind === 'boss' ? 2.4 : u.kind === 'ace' ? 1.5 : 1;
      const s = isSel('unit', i) ? 1.35 : 1;
      const d = new THREE.Mesh(disc, flatMat(isSel('unit', i) ? 0xffd060 : col));
      d.scale.set(big * s * 1.3, 1, big * s * 1.3);
      g.add(d);
      const a = new THREE.Mesh(arrow, flatMat(col));
      a.scale.setScalar(big);
      g.add(a);
      const pl = new THREE.Mesh(pole, flatMat(col));
      g.add(pl);
      const grp = cur.groups.find((x) => x.id === u.g);
      const txt = `${unitName(u.kind, u.type)}${grp ? '・' + grp.name : ''}${u.at === 'trig' ? '（觸發）' : ''}`;
      g.add(label(txt, hex(col), 4.8 + big));
      g.position.set(u.x, w.groundAt(u.x, u.z, (u.y || 0) + 2), u.z);
      g.rotation.y = u.yaw || 0;
      g.userData.edRef = { t: 'unit', i };
      hg.add(g);
    });
    // 標記
    cur.marks.forEach((m, i) => {
      const K = MARK_KINDS[m.k] || { color: 0xffffff, name: m.k };
      const g = new THREE.Group();
      const col = isSel('mark', i) ? 0xffd060 : K.color;
      const r = new THREE.Mesh(ring, flatMat(col));
      r.scale.setScalar(m.k === 'exit' || m.k === 'supply' || m.k === 'term' ? 4 : 2.4);
      r.position.y = 0.15;
      g.add(r);
      g.add(new THREE.Mesh(pole, flatMat(col)));
      if (m.k === 'spawn') {
        const a = new THREE.Mesh(arrow, flatMat(col));
        g.add(a);
      }
      g.add(label(m.name || K.name, hex(K.color), 5.6));
      g.position.set(m.x, w.groundAt(m.x, m.z, (m.y || 0) + 2), m.z);
      g.rotation.y = m.yaw || 0;
      g.userData.edRef = { t: 'mark', i };
      hg.add(g);
    });
    // 路徑
    cur.paths.forEach((P, i) => {
      const col =
        isSel('path', i) || (sel && sel.t === 'pathpt' && sel.i === i) || ed.pathAdd === i
          ? 0xffd060
          : 0x9fe0ff;
      const pts = P.pts.map((q) => new THREE.Vector3(q[0], w.groundAt(q[0], q[1], 99) + 0.6, q[1]));
      if (P.loop && pts.length > 2) pts.push(pts[0].clone());
      if (pts.length > 1) {
        const ln = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true }),
        );
        ln.renderOrder = 22;
        ln.userData.edRef = { t: 'path', i };
        hg.add(ln);
      }
      P.pts.forEach((q, j) => {
        const m = new THREE.Mesh(
          dot,
          flatMat(sel && sel.t === 'pathpt' && sel.i === i && sel.j === j ? 0xffd060 : col),
        );
        m.position.set(q[0], w.groundAt(q[0], q[1], 99) + 0.6, q[1]);
        m.userData.edRef = { t: 'pathpt', i, j };
        hg.add(m);
        if (j === 0) {
          const l = label(P.name || '路徑', hex(col), 2.4);
          l.position.add(m.position);
          hg.add(l);
        }
      });
    });
    // 區域
    cur.areas.forEach((a, i) => hg.add(this.edAreaHelper(a, i, isSel('area', i))));
    if (ed.areaDraw) {
      const A = ed.areaDraw;
      const circle = A.sh === 'circle';
      hg.add(
        this.edAreaHelper(
          {
            sh: circle ? 'circle' : 'box',
            x: circle ? A.x0 : (A.x0 + A.x1) / 2,
            z: circle ? A.z0 : (A.z0 + A.z1) / 2,
            w: Math.max(1, Math.abs(A.x1 - A.x0)),
            d: Math.max(1, Math.abs(A.z1 - A.z0)),
            r: Math.max(1, Math.hypot(A.x1 - A.x0, A.z1 - A.z0)),
            color: 0xffd060,
            name: '',
          },
          -1,
          true,
        ),
      );
    }
    // 作戰區域
    {
      const Z = w.zone;
      const pts = [];
      const edge = (x0, z0, x1, z1) => {
        for (let t = 0; t <= 20; t++) {
          const x = x0 + ((x1 - x0) * t) / 20,
            z = z0 + ((z1 - z0) * t) / 20;
          pts.push(new THREE.Vector3(x, w.terrainHeight(x, z) + 0.4, z));
        }
      };
      edge(Z[0], Z[2], Z[1], Z[2]);
      edge(Z[1], Z[2], Z[1], Z[3]);
      edge(Z[1], Z[3], Z[0], Z[3]);
      edge(Z[0], Z[3], Z[0], Z[2]);
      const ln = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0xff7030, transparent: true, opacity: 0.8 }),
      );
      hg.add(ln);
    }
    // 移除的產生器物件（移除模式時可以點回來）
    if (ed.genMode || ed.tool === 'prop')
      cur.removed.forEach((r, i) => {
        const l = label('✕ 已移除', '#ff6060', 0);
        l.position.set(r[0], w.terrainHeight(r[0], r[1]) + 2, r[1]);
        l.userData.edRef = { t: 'removed', i };
        hg.add(l);
      });
    // 斜坡的起點
    if (ed.slopeA) {
      const m = new THREE.Mesh(ring, flatMat(0xffd060));
      m.scale.setScalar(ed.brush.r);
      m.position.set(ed.slopeA.x, ed.slopeA.h + 0.3, ed.slopeA.z);
      hg.add(m);
    }
  },
  edAreaHelper(a, i, sel) {
    const w = this.world;
    const g = new THREE.Group();
    const col = sel ? 0xffd060 : a.color || 0x5cc8ff;
    const y = w.terrainHeight(a.x, a.z);
    g.position.set(a.x, y, a.z);
    g.rotation.y = a.yaw || 0;
    const m = flatMat(col, 0.18);
    const H = 5;
    if (a.sh === 'circle') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(a.r, a.r, H, 40, 1, true), m);
      c.position.y = H / 2;
      g.add(c);
    } else {
      const bx = new THREE.Mesh(new THREE.BoxGeometry(a.w, H, a.d), m);
      bx.position.y = H / 2;
      g.add(bx);
    }
    if (a.name) g.add(label(a.name, hex(col), H + 1.5));
    if (i >= 0) g.userData.edRef = { t: 'area', i };
    return g;
  },
  // ---------- 操作 ----------
  edDelete() {
    const ed = this.ed,
      cur = this.edCur(),
      s = ed.sel;
    if (!s) return;
    this.edPush();
    if (s.t === 'prop') cur.props.splice(s.i, 1);
    else if (s.t === 'unit') cur.units.splice(s.i, 1);
    else if (s.t === 'mark') {
      if (cur.marks[s.i].k === 'spawn' && cur.marks.filter((m) => m.k === 'spawn').length <= 1) {
        ed.undo.pop();
        return this.edMsg('至少要有一個玩家出生點', true);
      }
      cur.marks.splice(s.i, 1);
    } else if (s.t === 'area') cur.areas.splice(s.i, 1);
    else if (s.t === 'path') cur.paths.splice(s.i, 1);
    else if (s.t === 'pathpt') {
      const P = cur.paths[s.i];
      P.pts.splice(s.j, 1);
      if (P.pts.length < 1) cur.paths.splice(s.i, 1);
    }
    if (s.t === 'prop') this.edSyncProps();
    ed.sel = null;
    this.edChanged();
    this.edSelect(null);
  },
  edDuplicate() {
    const ed = this.ed,
      cur = this.edCur(),
      s = ed.sel;
    if (!s || !['prop', 'unit', 'mark', 'area'].includes(s.t)) return;
    const list = { prop: cur.props, unit: cur.units, mark: cur.marks, area: cur.areas }[s.t];
    const o = JSON.parse(JSON.stringify(list[s.i]));
    o.x += 3;
    o.z += 3;
    if (s.t === 'unit') {
      let n = cur.units.length + 1;
      while (cur.units.some((u) => u.id === 'u' + n)) n++;
      o.id = 'u' + n;
    } else if (s.t === 'mark') {
      if (MARK_KINDS[o.k].max && cur.marks.filter((m) => m.k === o.k).length >= MARK_KINDS[o.k].max)
        return this.edMsg(`${MARK_KINDS[o.k].name}最多 ${MARK_KINDS[o.k].max} 個`, true);
      let n = cur.marks.length + 1;
      while (cur.marks.some((m) => m.id === 'm' + n)) n++;
      o.id = 'm' + n;
    } else if (s.t === 'area') {
      let n = cur.areas.length + 1;
      while (cur.areas.some((a) => a.id === 'a' + n)) n++;
      o.id = 'a' + n;
    }
    this.edPush();
    list.push(o);
    if (s.t === 'prop') this.edSyncProps();
    this.edChanged();
    this.edSelect({ t: s.t, i: list.length - 1 });
  },
  // 陣列複製：選中的物件或單位沿著它的 X 方向（依朝向）複製 n 個
  edArray(n, d) {
    const ed = this.ed,
      cur = this.edCur(),
      s = ed.sel;
    if (!s || (s.t !== 'prop' && s.t !== 'unit')) return;
    const list = s.t === 'prop' ? cur.props : cur.units;
    const max = s.t === 'prop' ? LIMITS.props : LIMITS.units;
    if (list.length + n > max) return this.edMsg(`超過上限 ${max}`, true);
    const o = list[s.i];
    this.edPush();
    const c = Math.cos(o.yaw || 0),
      sn = Math.sin(o.yaw || 0);
    for (let k = 1; k <= n; k++) {
      const q = JSON.parse(JSON.stringify(o));
      q.x = +(o.x + c * d * k).toFixed(2);
      q.z = +(o.z - sn * d * k).toFixed(2);
      if (s.t === 'unit') {
        let m = cur.units.length + 1;
        while (cur.units.some((u) => u.id === 'u' + m)) m++;
        q.id = 'u' + m;
        q.y = +this.world.groundAt(q.x, q.z, 99).toFixed(2);
      }
      list.push(q);
    }
    if (s.t === 'prop') this.edSyncProps();
    this.edChanged();
    this.edRebuildHelpers();
    this.edMsg(`複製了 ${n} 個`);
  },
  edRotate(deg) {
    const o = this.edRefObj(this.ed.sel);
    if (!o || o.yaw === undefined) return;
    this.edPush();
    o.yaw = +((((o.yaw || 0) + (deg * Math.PI) / 180 + Math.PI * 3) % (Math.PI * 2)) - Math.PI).toFixed(4);
    if (this.ed.sel.t === 'prop') {
      this.ed.lastYaw = o.yaw;
      this.edSyncProps();
    }
    this.edChanged();
    this.edRebuildHelpers();
    this.edRenderInspector();
  },
  edFocus() {
    const o = this.edRefObj(this.ed.sel);
    if (!o) return;
    const q = o.pts ? o.pts[this.ed.sel.j || 0] : null;
    this.ed.cam.x = q ? q[0] : o.x;
    this.ed.cam.z = q ? q[1] : o.z;
    this.ed.cam.dist = Math.min(this.ed.cam.dist, 50);
  },
  edKey(e) {
    const ed = this.ed;
    if (!ed || this.edTyping() || ed.pick) return;
    const c = e.code,
      ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && c === 'KeyZ') {
      e.preventDefault();
      return this.edUndo(e.shiftKey);
    }
    if (ctrl && c === 'KeyY') {
      e.preventDefault();
      return this.edUndo(true);
    }
    if (ctrl && c === 'KeyS') {
      e.preventDefault();
      return this.edSave();
    }
    if (ctrl && c === 'KeyD') {
      e.preventDefault();
      return this.edDuplicate();
    }
    if (c === 'Delete' || c === 'Backspace') return this.edDelete();
    if (c === 'KeyR') return this.edRotate(e.shiftKey ? 15 : 90);
    if (c === 'KeyF') return this.edFocus();
    if (c === 'KeyP') return this.edTest(false);
    if (c === 'Escape') {
      ed.place = null;
      ed.pathAdd = null;
      ed.areaNew = null;
      ed.slopeA = null;
      this.edSelect(null);
      this.edRenderPalette();
      return;
    }
    const tools = {
      KeyV: 'select',
      Digit1: 'prop',
      Digit2: 'terrain',
      Digit3: 'unit',
      Digit4: 'mark',
      Digit5: 'path',
      Digit6: 'area',
      Digit7: 'trig',
      Digit8: 'set',
    };
    if (tools[c]) this.edSetTool(tools[c]);
  },
  edMsg(t, err) {
    if (!this.ed) return;
    this.ed.msg = t;
    this.ed.msgErr = !!err;
    clearTimeout(this.ed.msgTo);
    this.ed.msgTo = setTimeout(() => {
      if (this.ed) {
        this.ed.msg = '';
        this.edStatus();
      }
    }, 4000);
    this.edStatus();
  },
  // ---------- 存檔 ----------
  async edSave(quiet) {
    const ed = this.ed;
    if (!ed) return;
    const L = ed.L;
    L.updated = Date.now();
    L.gen = '1';
    if (!L.author) L.author = this.edAuthorName();
    try {
      L.thumb = this.edThumb();
    } catch (e) {}
    try {
      if (levelBytes(L) > LIMITS.bytes) return this.edMsg('關卡太大（上限 2 MB），請減少物件或段數', true);
      await LevelStore.put(L);
      ed.dirty = false;
      ed.saved = true;
      if (!quiet) this.edMsg('已存檔');
    } catch (e) {
      this.edMsg('存檔失敗：' + e.message, true);
    }
    this.edStatus();
  },
  edThumb() {
    const vo = this.camera.view && this.camera.view.enabled;
    if (vo) this.camera.clearViewOffset();
    this.renderMain();
    const src = this.canvas;
    const cv = document.createElement('canvas');
    cv.width = 256;
    cv.height = 144;
    const c = cv.getContext('2d');
    const r = src.width / src.height,
      R = 256 / 144;
    let sw = src.width,
      sh = src.height;
    if (r > R) sw = sh * R;
    else sh = sw / R;
    c.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, 256, 144);
    if (vo) this.edCamApply();
    return cv.toDataURL('image/jpeg', 0.7);
  },
  // ---------- 試玩 ----------
  // here：從鏡頭的注視點開始（只玩目前這一段、不記通關）
  edTest(here) {
    const ed = this.ed;
    if (!ed) return;
    const warn = this.edValidate().filter((x) => x.err);
    if (warn.length) return this.edMsg(warn[0].msg, true);
    const L = JSON.parse(JSON.stringify(ed.L));
    let full;
    try {
      full = loadLevel(
        here || ed.seg ? { ...segOf(L, ed.seg), format: L.format, segs: null, clear: null } : L,
      );
    } catch (e) {
      return this.edMsg('關卡讀不出來：' + e.message, true);
    }
    ed.testFull = !here && !ed.seg;
    ed.camSave = { ...ed.cam };
    this.edDisposeHelpers();
    const at = here ? { x: ed.cam.x, z: ed.cam.z, y: this.world.terrainHeight(ed.cam.x, ed.cam.z) } : null;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();
    this.lvPlay(full, { test: true, at });
  },
  edTestDone(success, t, reason) {
    const ed = this.ed;
    this.clearMission();
    if (!ed) return this.openLevels();
    this.state = 'editor';
    if (success && ed.testFull) {
      ed.L.clear = { by: ed.L.author || this.edAuthorName(), t: +t.toFixed(1), at: Date.now() };
      ed.dirty = true;
    }
    this.edBuildWorld();
    if (ed.camSave) ed.cam = ed.camSave;
    this.showScreen('editor');
    this.edRenderUi();
    this.edMsg(
      success
        ? ed.testFull
          ? `通關！（${t.toFixed(1)} 秒）存檔後就可以上傳到伺服器`
          : `試玩完成（${t.toFixed(1)} 秒）；從頭試玩通關才算上傳的通關紀錄`
        : `試玩結束：${reason || '任務失敗'}`,
      !success,
    );
  },
  // ---------- 多段 ----------
  edSetSeg(n) {
    const ed = this.ed;
    if (n === ed.seg) return;
    ed.seg = n;
    ed.undo = [];
    ed.redo = [];
    ed.sel = null;
    this.edBuildWorld();
    this.edRenderUi();
  },
  edAddSeg() {
    const ed = this.ed,
      L = ed.L;
    if ((L.segs || []).length >= 4) return this.edMsg('最多 5 段', true);
    const base = JSON.parse(JSON.stringify(this.edCur().base));
    base.seed = Math.floor(Math.random() * 1e9);
    const seg = stripMeta({
      ...JSON.parse(JSON.stringify(L)),
      base,
      terrain: { n: 0, h: '', water: null },
      removed: [],
      props: [],
      marks: [{ k: 'spawn', id: 'm1', name: '出生點 1', x: 0, y: 0, z: 0, yaw: 0 }],
      paths: [],
      areas: [],
      groups: [{ id: 'g1', name: 'A 隊', color: GROUP_COLORS[0] }],
      units: [],
      counters: [],
      triggers: [],
    });
    seg.name = '區段 ' + ((L.segs || []).length + 2);
    L.segs = (L.segs || []).concat([seg]);
    this.edChanged();
    this.edSetSeg(L.segs.length);
  },
  edDelSeg() {
    const ed = this.ed,
      L = ed.L;
    if (!ed.seg) return this.edMsg('第 1 段不能刪除', true);
    L.segs.splice(ed.seg - 1, 1);
    if (!L.segs.length) L.segs = null;
    ed.seg = 0;
    this.edChanged();
    ed.seg = -1;
    this.edSetSeg(0);
  },
  // ---------- 驗證 ----------
  edValidate() {
    const ed = this.ed;
    const out = [];
    const L = ed.L;
    const segs = [L, ...(L.segs || [])];
    segs.forEach((S, si) => {
      const pre = segs.length > 1 ? `第 ${si + 1} 段：` : '';
      const w = si === ed.seg ? this.world : null;
      const spawns = S.marks.filter((m) => m.k === 'spawn');
      if (!spawns.length) out.push({ err: true, msg: pre + '沒有玩家出生點' });
      if (w)
        for (const m of spawns) {
          if (w.isVoid(m.x, m.z)) out.push({ err: true, msg: pre + `「${m.name}」在虛空上` });
          else if (
            w
              .collide(m.x, m.z, w.groundAt(m.x, m.z, (m.y || 0) + 2), 1.5)
              .some((v, k) => Math.abs(v - [m.x, m.z][k]) > 0.3)
          )
            out.push({ msg: pre + `「${m.name}」卡在物件裡` });
        }
      const wins = S.triggers.some((t) => t.act.some((a) => a.k === 'win' || a.k === 'next'));
      const exits = S.marks.some((m) => m.k === 'exit');
      const enemies =
        S.units.some((u) => u.kind !== 'ally' && u.kind !== 'convoy') ||
        S.marks.some((m) => m.k === 'target');
      const convoy = S.units.some((u) => u.kind === 'convoy');
      if (!wins && !exits && !enemies && !convoy)
        out.push({ err: true, msg: pre + '沒有結束條件（放敵人、出口、護送，或用觸發器「任務成功」）' });
      if (
        exits &&
        !S.marks.some((m) => m.k === 'exit' && m.open) &&
        !S.triggers.some((t) => t.act.some((a) => a.k === 'open'))
      )
        out.push({ msg: pre + '出口沒有一開始開啟，也沒有觸發器「開啟出口」' });
      const spawnG = new Set(S.triggers.flatMap((t) => t.act.filter((a) => a.k === 'spawn').map((a) => a.g)));
      for (const g of new Set(S.units.filter((u) => u.at === 'trig').map((u) => u.g)))
        if (!spawnG.has(g))
          out.push({
            msg:
              pre +
              `群組「${(S.groups.find((x) => x.id === g) || {}).name || g}」的單位等觸發器，但沒有觸發器生成它`,
          });
      for (const u of S.units) {
        if (u.beh.k === 'patrol' && u.kind !== 'convoy' && !u.beh.path)
          out.push({ msg: pre + `${unitName(u.kind, u.type)}是巡邏但沒有指定路徑` });
        if (u.kind === 'convoy' && !u.beh.path) out.push({ err: true, msg: pre + '護送車輛要指定路徑' });
        if (
          u.kind === 'boss' &&
          +u.type >= 0 &&
          w &&
          /列車/.test(unitName('boss', u.type)) &&
          !(w.corridor && w.corridor.kind === 'rail')
        )
          out.push({ msg: pre + 'Boss 需要有鐵路的地圖（產生器的底圖才有）' });
      }
      for (const t of S.triggers) {
        const need = { enter: 'a', leave: 'a', gdead: 'g', gleft: 'g', ghp: 'g', counter: 'c', trig: 'tr' }[
          t.ev.k
        ];
        if (need && !t.ev[need])
          out.push({
            msg:
              pre +
              `觸發器「${t.name || t.id}」的事件還沒選${{ a: '區域', g: '群組', c: '計數器', tr: '觸發器' }[need]}`,
          });
        if (!t.act.length) out.push({ msg: pre + `觸發器「${t.name || t.id}」沒有動作` });
      }
    });
    if (levelBytes(L) > LIMITS.bytes) out.push({ err: true, msg: '關卡太大（上限 2 MB）' });
    return out;
  },
});
