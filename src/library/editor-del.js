// GLB 編輯器的「刪除多邊形」：用矩形、套索、筆刷或點選相連選取三角形（紅色標示），確認後刪除。
// - 深度：只選看得到的（另外算繪一張「三角形編號」圖，讀回範圍內的像素）、只選朝向鏡頭的、穿透
// - 判斷：重心在範圍內，或三個頂點都在範圍內；筆刷在「只選看得到的」時直接選筆刷下看得到的三角形
// - 擴展到相連、反選、自動選取小碎塊（相連以頂點位置判斷，AI 模型的頂點常常沒有焊接）、對稱選取（glTF 座標 X=0 鏡像）
// - 刪除：每個網格依保留的三角形重建索引（保留材質分組）並清掉沒用到的頂點；產生新幾何，復原只要保留參照
// 選取模式中左鍵選取，右鍵旋轉、中鍵平移、滾輪縮放；拆分模式中停用（改用拆分的「排除」）。
import { floatAttr } from './editor-cut.js';

const $ = (id) => document.getElementById(id);
const SHAPES = [
  ['rect', '矩形'],
  ['lasso', '套索'],
  ['brush', '筆刷'],
  ['pick', '點選相連'],
];
const triCountOf = (g) => Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
const matsArr = (o) => (Array.isArray(o.material) ? o.material : [o.material]);

// ---------- 三角形編號圖（只選看得到的）----------
const ID_VS = `
attribute float tid;
uniform float base;
varying vec3 vId;
void main() {
  float id = tid + base + 1.0;
  vId = vec3(mod(id, 256.0), mod(floor(id / 256.0), 256.0), floor(id / 65536.0));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const ID_FS = `
varying vec3 vId;
void main() { gl_FragColor = vec4(floor(vId + 0.5) / 255.0, 1.0); }`;
// 不共用頂點的幾何：每個頂點帶所屬三角形的編號
const ID_GEO = new WeakMap();
function idGeo(g) {
  if (ID_GEO.has(g)) return ID_GEO.get(g);
  const pos = g.attributes.position,
    idx = g.index ? g.index.array : null;
  const n = triCountOf(g);
  const p = new Float32Array(n * 9),
    tid = new Float32Array(n * 3);
  for (let t = 0; t < n; t++)
    for (let k = 0; k < 3; k++) {
      const i = idx ? idx[t * 3 + k] : t * 3 + k;
      p[(t * 3 + k) * 3] = pos.getX(i);
      p[(t * 3 + k) * 3 + 1] = pos.getY(i);
      p[(t * 3 + k) * 3 + 2] = pos.getZ(i);
      tid[t * 3 + k] = t;
    }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('tid', new THREE.BufferAttribute(tid, 1));
  ID_GEO.set(g, out);
  return out;
}

// ---------- 相連的碎塊（以頂點位置判斷相連）----------
const COMP = new WeakMap();
function components(g) {
  if (COMP.has(g)) return COMP.get(g);
  const pos = g.attributes.position,
    idx = g.index ? g.index.array : null;
  const n = triCountOf(g);
  const key = new Map();
  const vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let v = key.get(k);
    if (v === undefined) key.set(k, (v = key.size));
    vid[i] = v;
  }
  const par = new Int32Array(key.size).map((_, i) => i);
  const find = (x) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  const vi = (t, k) => vid[idx ? idx[t * 3 + k] : t * 3 + k];
  for (let t = 0; t < n; t++) {
    const a = find(vi(t, 0));
    for (let k = 1; k < 3; k++) {
      const b = find(vi(t, k));
      if (a !== b) par[b] = a;
    }
  }
  const remap = new Map();
  const comp = new Int32Array(n);
  const size = [],
    area = [];
  const A = new THREE.Vector3(),
    B = new THREE.Vector3(),
    C = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    const r = find(vi(t, 0));
    let c = remap.get(r);
    if (c === undefined) {
      remap.set(r, (c = size.length));
      size.push(0);
      area.push(0);
    }
    comp[t] = c;
    size[c]++;
    const i0 = idx ? idx[t * 3] : t * 3;
    A.fromBufferAttribute(pos, i0);
    B.fromBufferAttribute(pos, idx ? idx[t * 3 + 1] : t * 3 + 1).sub(A);
    C.fromBufferAttribute(pos, idx ? idx[t * 3 + 2] : t * 3 + 2).sub(A);
    area[c] += B.cross(C).length() / 2;
  }
  const out = { comp, size, area };
  COMP.set(g, out);
  return out;
}

// ---------- 刪除：保留 keep 為 0 以外的三角形，清掉沒用到的頂點 ----------
function copyAttr(a, used, n) {
  if (a.isInterleavedBufferAttribute) a = floatAttr(a);
  const out = new a.array.constructor(n * a.itemSize);
  for (let i = 0; i < used.length; i++)
    if (used[i] >= 0) out.set(a.array.subarray(i * a.itemSize, (i + 1) * a.itemSize), used[i] * a.itemSize);
  return new THREE.BufferAttribute(out, a.itemSize, a.normalized);
}
export function removeTris(g, del) {
  const src = g.index ? g.index.array : null;
  const n = triCountOf(g);
  const groups = g.groups.length ? g.groups : [{ start: 0, count: n * 3, materialIndex: 0 }];
  const idx = [];
  const ng = [];
  for (const gr of groups) {
    const start = idx.length;
    for (let t = Math.floor(gr.start / 3); t < Math.min(n, Math.floor((gr.start + gr.count) / 3)); t++) {
      if (del[t]) continue;
      for (let k = 0; k < 3; k++) idx.push(src ? src[t * 3 + k] : t * 3 + k);
    }
    if (idx.length > start) ng.push({ start, count: idx.length - start, materialIndex: gr.materialIndex });
  }
  const used = new Int32Array(g.attributes.position.count).fill(-1);
  let m = 0;
  for (const i of idx) if (used[i] < 0) used[i] = m++;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) out.setAttribute(name, copyAttr(a, used, m));
  for (const [name, list] of Object.entries(g.morphAttributes || {}))
    out.morphAttributes[name] = list.map((a) => copyAttr(a, used, m));
  out.morphTargetsRelative = g.morphTargetsRelative;
  const ni = m > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = used[idx[i]];
  out.setIndex(new THREE.BufferAttribute(ni, 1));
  if (g.groups.length) for (const gr of ng) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// 點是否在多邊形內（偶奇規則）
function inPoly(x, y, P) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [xi, yi] = P[i],
      [xj, yj] = P[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

export class FaceTool {
  constructor(ed) {
    this.ed = ed;
    this.on = false;
    this.shape = 'rect';
    this.sel = new Map(); // 網格 → { geo, f: Uint8Array（1＝選取）}
    this.hl = new THREE.Group(); // 選取標示（放在場景根部，不在模型裡，所以不會被匯出）
    this.hl.renderOrder = 20;
    ed.scene.add(this.hl);
    this.hlMat = new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.stroke = null;
    this.rt = null;
  }

  // ---------- 介面 ----------
  setupUi() {
    const ed = this.ed;
    $('edFaceShape').innerHTML = SHAPES.map(([k, n]) => `<button data-s="${k}">${n}</button>`).join('');
    for (const b of $('edFaceShape').querySelectorAll('button'))
      b.onclick = () => {
        this.shape = b.dataset.s;
        this.render();
      };
    $('edFaceOn').onclick = () => this.setOn(!this.on);
    $('edFaceGrow').onclick = () => this.grow();
    $('edFaceInv').onclick = () => this.invert();
    $('edFaceClear').onclick = () => this.clear();
    $('edFaceSmall').onclick = () =>
      this.selectSmall(parseInt($('edFaceSmallN').value, 10) || 0, parseFloat($('edFaceSmallA').value) || 0);
    $('edFaceDel').onclick = () => this.deleteSel();
    // 繪製範圍（矩形、套索、筆刷游標）的透明畫布
    this.draw = document.createElement('canvas');
    this.draw.className = 'edFaceDraw';
    $('edView').appendChild(this.draw);
    // 捕獲階段攔截左鍵：不讓視角、箭頭工具與點選節點接到
    $('edView').addEventListener(
      'pointerdown',
      (e) => {
        if (!this.on || e.button !== 0 || e.target !== ed.canvas) return;
        e.stopPropagation();
        e.preventDefault();
        this.begin(e);
      },
      true,
    );
    $('edView').addEventListener(
      'pointerup',
      (e) => {
        if (!this.stroke) return;
        // 在這裡結束這一筆，不讓點選節點接到（放開在畫面外時由 window 的 pointerup 結束）
        e.stopPropagation();
        this.end(e);
      },
      true,
    );
    addEventListener('pointermove', (e) => this.move(e));
    addEventListener('pointerup', (e) => this.end(e));
    ed.canvas.addEventListener('pointerleave', () => !this.stroke && this.paint(null));
    this.render();
  }
  setOn(on) {
    const ed = this.ed;
    if (on && (!ed.content || ed.split.active)) return;
    if (on === this.on) return;
    this.on = on;
    const c = ed.controls;
    if (on) {
      ed.mat.setBox(false);
      if (ed.originMode) ed.setOriginMode(false);
      if (ed.tc) ed.tc.detach();
      this.buttons = { ...c.mouseButtons };
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      c.enabled = true;
    } else {
      if (this.buttons) c.mouseButtons = this.buttons;
      this.stroke = null;
      this.paint(null);
      this.clear(true);
      if (ed.content && !ed.split.cutting) ed.select(ed.sel);
    }
    this.render();
  }
  reset() {
    this.setOn(false);
    this.clear(true);
  }
  count() {
    let n = 0;
    for (const s of this.sel.values()) for (const v of s.f) n += v;
    return n;
  }
  render() {
    const ed = this.ed;
    const sp = ed.split.active;
    $('edFaceOn').disabled = !ed.content || sp;
    $('edFaceOn').title = sp
      ? '拆分模式中不能刪除多邊形：請改用拆分的「框選」＋「排除」'
      : '用滑鼠選取要刪除的三角形（矩形、套索、筆刷、點選相連）';
    $('edFaceOn').classList.toggle('sel', this.on);
    $('edFacePanel').hidden = !this.on;
    for (const b of $('edFaceShape').querySelectorAll('button'))
      b.classList.toggle('sel', b.dataset.s === this.shape);
    $('edBrushRow').hidden = this.shape !== 'brush';
    const n = this.count();
    $('edFaceInfo').textContent = n ? `已選 ${n.toLocaleString()} 面（${this.sel.size} 個網格）` : '尚未選取';
    $('edFaceDel').disabled = !n;
  }
  // 模型改變後（復原、減面、刪除節點…）選取的網格已換了幾何或被隱藏：丟掉那些選取
  prune() {
    let changed = false;
    for (const [o, s] of this.sel) {
      if (o.geometry === s.geo && this.shown(o)) continue;
      this.sel.delete(o);
      changed = true;
    }
    if (changed) this.rebuildHl();
    this.render();
  }
  shown(o) {
    for (let x = o; x && x !== this.ed.content; x = x.parent) if (!x.visible) return false;
    return !!this.ed.content;
  }

  // ---------- 選取標示 ----------
  rebuildHl() {
    for (const m of [...this.hl.children]) {
      this.hl.remove(m);
      m.geometry.dispose();
    }
    for (const [o, s] of this.sel) {
      const g = o.geometry,
        pos = g.attributes.position,
        idx = g.index ? g.index.array : null;
      let k = 0;
      for (const v of s.f) k += v;
      if (!k) continue;
      const p = new Float32Array(k * 9);
      let w = 0;
      for (let t = 0; t < s.f.length; t++) {
        if (!s.f[t]) continue;
        for (let j = 0; j < 3; j++) {
          const i = idx ? idx[t * 3 + j] : t * 3 + j;
          p[w++] = pos.getX(i);
          p[w++] = pos.getY(i);
          p[w++] = pos.getZ(i);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Mesh(geo, this.hlMat);
      m.matrixAutoUpdate = false;
      m.userData.src = o;
      m.renderOrder = 20;
      this.hl.add(m);
    }
  }
  // 每次繪製前：標示跟著網格的變換
  sync() {
    for (const m of this.hl.children) {
      const o = m.userData.src;
      o.updateWorldMatrix(true, false);
      m.matrix.copy(o.matrixWorld);
      m.visible = this.shown(o);
    }
  }

  // ---------- 三角形的畫面座標 ----------
  // 每個顯示中的網格：三角形重心（與頂點）的畫面座標、是否在鏡頭前、是否朝向鏡頭；base 是編號圖裡的起始編號
  prep() {
    const ed = this.ed;
    ed.scene.updateMatrixWorld(true);
    const W = ed.w,
      H = ed.h,
      cam = ed.camera;
    const camPos = cam.getWorldPosition(new THREE.Vector3());
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      p = new THREE.Vector3(),
      nrm = new THREE.Vector3();
    const list = [];
    let base = 0;
    for (const o of ed.mat.meshes()) {
      const g = o.geometry,
        pos = g.attributes.position,
        idx = g.index ? g.index.array : null;
      const n = triCountOf(g);
      const mw = o.matrixWorld;
      const flip = mw.determinant() < 0;
      const cx = new Float32Array(n),
        cy = new Float32Array(n),
        vs = new Float32Array(n * 6);
      const ok = new Uint8Array(n),
        front = new Uint8Array(n);
      const scr = (v) => {
        v.project(cam);
        return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H, v.z > -1 && v.z < 1];
      };
      for (let t = 0; t < n; t++) {
        const vi = (k) => (idx ? idx[t * 3 + k] : t * 3 + k);
        a.fromBufferAttribute(pos, vi(0)).applyMatrix4(mw);
        b.fromBufferAttribute(pos, vi(1)).applyMatrix4(mw);
        c.fromBufferAttribute(pos, vi(2)).applyMatrix4(mw);
        p.copy(a).add(b).add(c).divideScalar(3);
        nrm.subVectors(b, a).cross(c.clone().sub(a));
        front[t] = nrm.dot(camPos.clone().sub(p)) > 0 !== flip ? 1 : 0;
        const [x, y, in0] = scr(p.clone());
        cx[t] = x;
        cy[t] = y;
        ok[t] = in0 ? 1 : 0;
        [a, b, c].forEach((v, k) => {
          const [vx, vy] = scr(v);
          vs[t * 6 + k * 2] = vx;
          vs[t * 6 + k * 2 + 1] = vy;
        });
      }
      list.push({ o, g, n, base, cx, cy, vs, ok, front });
      base += n;
    }
    return { list, total: base };
  }
  // 三角形編號圖：在畫面外算繪（解析度最多 2 倍，細小的三角形才不容易漏掉），整張讀回
  idImage(P) {
    const ed = this.ed;
    const r = ed.renderer;
    const s = Math.min(2 * r.getPixelRatio(), 4096 / Math.max(ed.w, ed.h, 1));
    const W = Math.max(1, Math.round(ed.w * s)),
      H = Math.max(1, Math.round(ed.h * s));
    if (!this.rt)
      this.rt = new THREE.WebGLRenderTarget(W, H, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
    this.rt.setSize(W, H);
    const scene = new THREE.Scene();
    const mats = [];
    for (const e of P.list) {
      const m = new THREE.ShaderMaterial({
        vertexShader: ID_VS,
        fragmentShader: ID_FS,
        uniforms: { base: { value: e.base } },
        side: matsArr(e.o).some((x) => x.side === THREE.DoubleSide) ? THREE.DoubleSide : THREE.FrontSide,
      });
      mats.push(m);
      const mesh = new THREE.Mesh(idGeo(e.g), m);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(e.o.matrixWorld);
      scene.add(mesh);
    }
    const prevColor = r.getClearColor(new THREE.Color()),
      prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(scene, ed.camera);
    const buf = new Uint8Array(W * H * 4);
    r.readRenderTargetPixels(this.rt, 0, 0, W, H, buf);
    r.setRenderTarget(null);
    r.setClearColor(prevColor, prevAlpha);
    for (const m of mats) m.dispose();
    return { buf, W, H, s, total: P.total };
  }
  // 編號圖中，範圍（外框 x0,y0,x1,y1；inside 為 null 時整個外框）內看得到的三角形
  visibleIn(img, x0, y0, x1, y1, inside) {
    const vis = new Uint8Array(img.total);
    const H = this.ed.h;
    const X0 = Math.max(0, Math.floor(x0 * img.s)),
      X1 = Math.min(img.W - 1, Math.ceil(x1 * img.s));
    const Y0 = Math.max(0, Math.floor((H - y1) * img.s)),
      Y1 = Math.min(img.H - 1, Math.ceil((H - y0) * img.s));
    for (let py = Y0; py <= Y1; py++)
      for (let px = X0; px <= X1; px++) {
        if (inside && !inside((px + 0.5) / img.s, H - (py + 0.5) / img.s)) continue;
        const o = (py * img.W + px) * 4;
        const id = img.buf[o] + img.buf[o + 1] * 256 + img.buf[o + 2] * 65536;
        if (id > 0 && id <= img.total) vis[id - 1] = 1;
      }
    return vis;
  }

  // ---------- 拖曳 ----------
  rel(e) {
    const r = this.ed.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  opOf(e) {
    return e.ctrlKey || e.metaKey ? 'sub' : e.shiftKey ? 'add' : 'set';
  }
  begin(e) {
    const p = this.rel(e);
    if (this.shape === 'pick') return this.pickConnected(e, this.opOf(e));
    this.stroke = { pts: [p], op: this.opOf(e) };
    if (this.shape === 'brush') {
      // 筆刷：一筆之中視角不變，畫面座標與編號圖只算一次；沒按 Ctrl 時一律加選
      if (this.stroke.op === 'set') this.stroke.op = 'add';
      this.stroke.P = this.prep();
      if (this.depth() === 'visible') this.stroke.img = this.idImage(this.stroke.P);
      this.stroke.hits = this.blank(this.stroke.P);
      this.brushAt(p);
    }
    this.paint(p);
  }
  move(e) {
    if (!this.on) return;
    const p = this.rel(e);
    if (!this.stroke) {
      if (this.shape === 'brush' && e.target === this.ed.canvas) this.paint(p);
      return;
    }
    const last = this.stroke.pts[this.stroke.pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
    if (this.shape === 'brush') {
      // 快速拖曳時在兩點間補點，筆畫才不會斷
      const r = this.brushR(),
        d = Math.hypot(p[0] - last[0], p[1] - last[1]);
      const k = Math.max(1, Math.ceil(d / (r * 0.5)));
      for (let i = 1; i <= k; i++)
        this.brushAt([last[0] + ((p[0] - last[0]) * i) / k, last[1] + ((p[1] - last[1]) * i) / k]);
      this.stroke.pts.push(p);
    } else if (this.shape === 'lasso') this.stroke.pts.push(p);
    else this.stroke.pts[1] = p;
    this.paint(p);
  }
  end(e) {
    const st = this.stroke;
    if (!st) return;
    this.stroke = null;
    this.paint(this.shape === 'brush' ? this.rel(e) : null);
    if (this.shape === 'brush') {
      this.commit(st.P, st.hits, st.op);
      return;
    }
    const pts = st.pts;
    if (this.shape === 'rect') {
      const b = pts[1];
      if (!b || (Math.abs(b[0] - pts[0][0]) < 3 && Math.abs(b[1] - pts[0][1]) < 3)) return;
      const x0 = Math.min(pts[0][0], b[0]),
        x1 = Math.max(pts[0][0], b[0]),
        y0 = Math.min(pts[0][1], b[1]),
        y1 = Math.max(pts[0][1], b[1]);
      this.selectRegion([x0, y0, x1, y1], (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1, null, st.op);
    } else {
      if (pts.length < 3) return;
      const xs = pts.map((q) => q[0]),
        ys = pts.map((q) => q[1]);
      const inside = (x, y) => inPoly(x, y, pts);
      this.selectRegion(
        [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
        inside,
        inside,
        st.op,
      );
    }
  }
  depth() {
    return $('edFaceDepth').value;
  }
  brushR() {
    return Math.max(2, parseFloat($('edBrushR').value) || 24);
  }
  blank(P) {
    return new Map(P.list.map((e) => [e, new Uint8Array(e.n)]));
  }
  // 矩形／套索：重心（或三個頂點）在範圍內，再依深度模式篩選
  selectRegion(bb, inside, mask, op) {
    const P = this.prep();
    const depth = this.depth();
    const full = $('edFaceFull').checked;
    const vis =
      depth === 'visible' ? this.visibleIn(this.idImage(P), bb[0], bb[1], bb[2], bb[3], mask) : null;
    const hits = this.blank(P);
    for (const e of P.list) {
      const h = hits.get(e);
      for (let t = 0; t < e.n; t++) {
        if (!e.ok[t]) continue;
        if (depth === 'front' && !e.front[t]) continue;
        if (vis && !vis[e.base + t]) continue;
        const inn = full
          ? inside(e.vs[t * 6], e.vs[t * 6 + 1]) &&
            inside(e.vs[t * 6 + 2], e.vs[t * 6 + 3]) &&
            inside(e.vs[t * 6 + 4], e.vs[t * 6 + 5])
          : inside(e.cx[t], e.cy[t]);
        if (inn) h[t] = 1;
      }
    }
    this.commit(P, hits, op);
  }
  // 筆刷的一點：只選看得到的時直接取筆刷下看得到的三角形，否則重心在半徑內
  brushAt([x, y]) {
    const st = this.stroke;
    const r = this.brushR();
    const depth = this.depth();
    const inside = (px, py) => (px - x) ** 2 + (py - y) ** 2 <= r * r;
    const vis = st.img ? this.visibleIn(st.img, x - r, y - r, x + r, y + r, inside) : null;
    for (const e of st.P.list) {
      const h = st.hits.get(e);
      for (let t = 0; t < e.n; t++) {
        if (h[t] || !e.ok[t]) continue;
        if (vis) {
          if (vis[e.base + t]) h[t] = 1;
          continue;
        }
        if (depth === 'front' && !e.front[t]) continue;
        if (inside(e.cx[t], e.cy[t])) h[t] = 1;
      }
    }
    // 筆刷邊刷邊顯示：先套用到暫時的選取標示
    this.preview(st.P, st.hits, st.op);
  }
  pickConnected(e, op) {
    const ed = this.ed;
    const r = ed.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      ed.camera,
    );
    const hit = ray.intersectObject(ed.content, true).find((h) => h.object.isMesh && this.shown(h.object));
    if (!hit) return;
    const P = this.prep();
    const hits = this.blank(P);
    const ent = P.list.find((x) => x.o === hit.object);
    if (!ent || hit.faceIndex === undefined) return;
    const { comp } = components(ent.g);
    const c = comp[hit.faceIndex];
    const h = hits.get(ent);
    for (let t = 0; t < ent.n; t++) if (comp[t] === c) h[t] = 1;
    this.commit(P, hits, op, true);
  }

  // ---------- 套用選取 ----------
  // hits：Map(網格資料 → 旗標)；op：set 取代、add 加選、sub 減選；對稱選取時加上鏡像的三角形（connected 時擴展成整塊）
  commit(P, hits, op, connected) {
    if ($('edFaceSym').checked) this.mirror(P, hits, connected);
    this.applyHits(P, hits, op);
    this.rebuildHl();
    this.render();
  }
  applyHits(P, hits, op) {
    if (op === 'set') this.sel.clear();
    for (const e of P.list) {
      const h = hits.get(e);
      let s = this.sel.get(e.o);
      if (!s || s.geo !== e.g) {
        if (op === 'sub') continue;
        s = { geo: e.g, f: new Uint8Array(e.n) };
      }
      for (let t = 0; t < e.n; t++) if (h[t]) s.f[t] = op === 'sub' ? 0 : 1;
      if (s.f.some((v) => v)) this.sel.set(e.o, s);
      else this.sel.delete(e.o);
    }
  }
  // 筆刷進行中的顯示：目前的選取＋這一筆（不改動 this.sel）
  preview(P, hits, op) {
    const keep = new Map([...this.sel].map(([o, s]) => [o, { geo: s.geo, f: s.f.slice() }]));
    this.applyHits(P, hits, op);
    this.rebuildHl();
    this.sel = keep;
  }
  // 對稱：glTF 座標（frame）中，三角形的重心鏡像到 X 的另一側後，離某個已選三角形的表面夠近（該三角形大小的 20%）就加入
  // （以表面距離判斷，左右兩側的三角形切法不同也能對上，又不會誤選旁邊相鄰的面）
  mirror(P, hits, connected) {
    const ed = this.ed;
    const inv = ed.frame.matrixWorld.clone().invert();
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      p = new THREE.Vector3();
    const geom = P.list.map((e) => {
      const pos = e.g.attributes.position,
        idx = e.g.index ? e.g.index.array : null;
      const m = new THREE.Matrix4().multiplyMatrices(inv, e.o.matrixWorld);
      const cen = new Float32Array(e.n * 3),
        rad = new Float32Array(e.n),
        vs = new Float32Array(e.n * 9);
      for (let t = 0; t < e.n; t++) {
        const vi = (k) => (idx ? idx[t * 3 + k] : t * 3 + k);
        a.fromBufferAttribute(pos, vi(0)).applyMatrix4(m);
        b.fromBufferAttribute(pos, vi(1)).applyMatrix4(m);
        c.fromBufferAttribute(pos, vi(2)).applyMatrix4(m);
        p.copy(a).add(b).add(c).divideScalar(3);
        cen.set([p.x, p.y, p.z], t * 3);
        vs.set([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], t * 9);
        rad[t] = Math.max(p.distanceTo(a), p.distanceTo(b), p.distanceTo(c));
      }
      return { cen, rad, vs };
    });
    const sel = [];
    P.list.forEach((e, i) => {
      const h = hits.get(e);
      for (let t = 0; t < e.n; t++) if (h[t]) sel.push([i, t]);
    });
    if (!sel.length) return;
    const rs = sel.map(([i, t]) => geom[i].rad[t]).sort((x, y) => x - y);
    const cell = Math.max(1e-4, rs[Math.floor(rs.length / 2)] * 2);
    const grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    for (const [i, t] of sel) {
      const g = geom[i],
        r = g.rad[t];
      const lo = [0, 1, 2].map((k) => Math.floor((g.cen[t * 3 + k] - r) / cell));
      const hi = [0, 1, 2].map((k) => Math.min(lo[k] + 8, Math.floor((g.cen[t * 3 + k] + r) / cell)));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = key(x, y, z);
            if (!grid.has(k)) grid.set(k, []);
            grid.get(k).push([i, t]);
          }
    }
    const add = [];
    const tri = new THREE.Triangle(),
      m = new THREE.Vector3(),
      cp = new THREE.Vector3();
    P.list.forEach((e, i) => {
      const g = geom[i],
        h = hits.get(e);
      for (let t = 0; t < e.n; t++) {
        if (h[t]) continue;
        const mx = -g.cen[t * 3],
          my = g.cen[t * 3 + 1],
          mz = g.cen[t * 3 + 2];
        const list = grid.get(key(Math.floor(mx / cell), Math.floor(my / cell), Math.floor(mz / cell)));
        if (!list) continue;
        for (const [j, s] of list) {
          const q = geom[j];
          tri.a.fromArray(q.vs, s * 9);
          tri.b.fromArray(q.vs, s * 9 + 3);
          tri.c.fromArray(q.vs, s * 9 + 6);
          tri.closestPointToPoint(m.set(mx, my, mz), cp);
          if (cp.distanceTo(m) <= q.rad[s] * 0.2 + 1e-4) {
            add.push([e, t]);
            break;
          }
        }
      }
    });
    const grown = new Set();
    for (const [e, t] of add) {
      hits.get(e)[t] = 1;
      if (connected) grown.add(e);
    }
    // 點選相連：鏡像側也擴展成整塊
    for (const e of grown) {
      const { comp } = components(e.g);
      const h = hits.get(e);
      const cs = new Set();
      for (const [x, t] of add) if (x === e) cs.add(comp[t]);
      for (let t = 0; t < e.n; t++) if (cs.has(comp[t])) h[t] = 1;
    }
  }

  // ---------- 選取工具 ----------
  clear(quiet) {
    this.sel.clear();
    this.rebuildHl();
    if (!quiet || this.on) this.render();
  }
  // 擴展到相連：已選的三角形所在的整塊
  grow() {
    if (!this.sel.size) return this.ed.toast('請先選取一些三角形', true);
    for (const [o, s] of this.sel) {
      const { comp } = components(o.geometry);
      const cs = new Set();
      s.f.forEach((v, t) => v && cs.add(comp[t]));
      for (let t = 0; t < s.f.length; t++) if (cs.has(comp[t])) s.f[t] = 1;
    }
    this.rebuildHl();
    this.render();
  }
  // 反選：顯示中的網格
  invert() {
    const P = this.prep();
    for (const e of P.list) {
      const s = this.sel.get(e.o);
      const f = new Uint8Array(e.n).fill(1);
      if (s && s.geo === e.g) for (let t = 0; t < e.n; t++) f[t] = s.f[t] ? 0 : 1;
      if (f.some((v) => v)) this.sel.set(e.o, { geo: e.g, f });
      else this.sel.delete(e.o);
    }
    this.rebuildHl();
    this.render();
  }
  // 自動選取小碎塊：面數少於 maxTris，或面積小於全部的 pct%（以頂點位置判斷相連；最大的一塊不選）
  selectSmall(maxTris, pct) {
    const P = this.prep();
    const parts = [];
    let total = 0;
    for (const e of P.list) {
      const { size, area } = components(e.g);
      const sc = e.o.matrixWorld.getMaxScaleOnAxis() ** 2;
      size.forEach((n, c) => {
        parts.push({ e, c, n, a: area[c] * sc });
        total += area[c] * sc;
      });
    }
    let big = parts[0];
    for (const p of parts) if (big && p.a > big.a) big = p;
    const pick = parts.filter(
      (p) => p !== big && (p.n < maxTris || (total > 0 && (p.a / total) * 100 < pct)),
    );
    if (!pick.length) return this.ed.toast('沒有符合條件的小碎塊', true);
    const hits = this.blank(P);
    for (const p of pick) {
      const { comp } = components(p.e.g);
      const h = hits.get(p.e);
      for (let t = 0; t < p.e.n; t++) if (comp[t] === p.c) h[t] = 1;
    }
    this.commit(P, hits, 'set');
    this.ed.toast(
      `選取了 ${pick.length} 個小碎塊（${this.count().toLocaleString()} 面）：確認後按「刪除選取的面」`,
    );
  }

  // ---------- 刪除 ----------
  deleteSel() {
    const ed = this.ed;
    const n = this.count();
    if (!n) return;
    ed.pushUndo();
    let emptied = 0;
    for (const [o, s] of this.sel) {
      if (o.geometry !== s.geo) continue;
      if (s.f.every((v) => v)) {
        // 整個網格都刪掉：當成刪除節點（可以復原）
        o.visible = false;
        o.userData.edDeleted = true;
        emptied++;
        continue;
      }
      o.geometry = removeTris(o.geometry, s.f);
    }
    this.sel.clear();
    this.rebuildHl();
    if (ed.sel && ed.sel.userData.edDeleted) ed.sel = null;
    ed.changed();
    ed.toast(`已刪除 ${n.toLocaleString()} 面${emptied ? `（${emptied} 個網格整個刪除）` : ''}`);
  }

  // ---------- 範圍的繪製（矩形、套索、筆刷游標）----------
  paint(p) {
    const c = this.draw;
    const w = this.ed.w,
      h = this.ed.h;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d');
    g.clearRect(0, 0, w, h);
    if (!this.on) return;
    g.strokeStyle = '#ffd23f';
    g.fillStyle = 'rgba(255,210,63,0.12)';
    g.lineWidth = 1;
    g.setLineDash(this.shape === 'brush' ? [] : [5, 4]);
    const st = this.stroke;
    if (this.shape === 'brush') {
      if (!p) return;
      g.beginPath();
      g.arc(p[0], p[1], this.brushR(), 0, Math.PI * 2);
      g.stroke();
      return;
    }
    if (!st || st.pts.length < 2) return;
    g.beginPath();
    if (this.shape === 'rect') {
      const [a, b] = st.pts;
      g.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    } else {
      st.pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
      g.closePath();
    }
    g.fill();
    g.stroke();
  }
}
