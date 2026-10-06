// 參考圖、正交視圖與快速姿勢（組裝調整頁、檢視窗的組合預覽、GLB 編輯器的全身參考共用）
// - 參考圖：每個模型組一套（正面、側面各一張＋校正值），存在獨立的 IndexedDB（rubicon-ref-images，
//   不動模型庫資料庫的版本），匯出／匯入模型組時一起帶（set-pack.js 的 refs/）
// - 校正：在圖上拖頭頂、腳底與身體中心三條線，依「目標身高」（空白＝遊戲身高）換算成公尺；
//   圖片放在機甲背後的平面上，腳底中心對準機甲原點（地面）
// - 正交視圖：正視（從正面 −Z 看）、側視（從右側 +X 看）、背視；和平面圖比對時不會有透視變形。
//   切換時把宿主的 camera／controls 換成正交鏡頭（宿主一律透過 this.camera、this.controls 使用），
//   TransformControls 的鏡頭也跟著換
import { escHtml } from '../core/html.js';
import { A_POSE, NO_POSE, QUICK_POSE, poseActive } from './pose.js';

const OFF = 20; // 參考圖平面離機甲原點的距離（m）
const VIEWS = [
  ['persp', '透視'],
  ['front', '正視'],
  ['side', '側視'],
  ['back', '背視'],
];
const IMG_VIEWS = [
  ['front', '正面圖'],
  ['side', '側面圖'],
];

// ---------- 儲存 ----------
// 紀錄：{ views: { front?, side? }, height, opacity, onTop }；
// 每張圖：{ buf, type, w, h, top, bottom, cx, flip }（top／bottom／cx 是圖片的比例座標 0～1）
export const RefStore = {
  cache: new Map(),
  listeners: new Set(),
  db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res, rej) => {
      const r = indexedDB.open('rubicon-ref-images', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('refs');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const t = db.transaction('refs', mode);
      const q = fn(t.objectStore('refs'));
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    });
  },
  async get(set) {
    if (this.cache.has(set)) return this.cache.get(set);
    let r = null;
    try {
      r = (await this.tx('readonly', (s) => s.get(set))) || null;
    } catch (e) {
      r = null;
    }
    this.cache.set(set, r);
    return r;
  },
  async put(set, rec) {
    this.cache.set(set, rec);
    try {
      await this.tx('readwrite', (s) => (rec ? s.put(rec, set) : s.delete(set)));
    } catch (e) {
      console.warn('ref image save failed', e);
    }
    for (const fn of this.listeners) fn(set);
  },
  remove(set) {
    return this.put(set, null);
  },
  async copy(from, to) {
    const r = await this.get(from);
    if (r) await this.put(to, cloneRec(r));
  },
};
function cloneRec(r) {
  const views = {};
  for (const k in r.views || {}) views[k] = { ...r.views[k], buf: r.views[k].buf.slice(0) };
  return { ...r, views };
}
export function emptyRec() {
  return { views: {}, height: null, opacity: 0.55, onTop: false };
}

// 圖片尺寸
function imageSize(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      res({ w: img.naturalWidth, h: img.naturalHeight, img });
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    img.onerror = () => rej(new Error('無法讀取圖片'));
    img.src = url;
  });
}

// ---------- 校正對話框（全頁共用一個）----------
let calDom = null;
function calDialog() {
  if (calDom) return calDom;
  const el = document.createElement('div');
  el.id = 'refCal';
  el.hidden = true;
  el.innerHTML = `<div class="refCalBox">
    <div class="refCalHead"><b id="refCalTitle">校正參考圖</b>
      <span class="dim small">拖曳<b style="color:#ff6b6b">紅線＝頭頂</b>、<b style="color:#6be08a">綠線＝腳底</b>、<b style="color:#5cc8ff">藍線＝身體中心</b>；滾輪縮放、右鍵拖曳平移</span></div>
    <canvas id="refCalCv"></canvas>
    <div class="refCalFoot">
      <label>目標身高 <input id="refCalH" type="number" min="0.1" step="0.01" style="width:80px" /> m</label>
      <span class="dim small" id="refCalHint"></span>
      <label><input type="checkbox" id="refCalFlip" /> 左右翻轉</label>
      <span class="sp"></span>
      <button id="refCalOk" class="primary">完成</button><button id="refCalCancel">取消</button>
    </div></div>`;
  document.body.appendChild(el);
  calDom = el;
  return el;
}
// 開啟校正：v＝圖的紀錄（會直接修改 top／bottom／cx／flip），回傳 { ok, height }
function calibrate(img, v, title, height, gameH) {
  const el = calDialog();
  el.hidden = false;
  const cv = el.querySelector('#refCalCv');
  const ctx = cv.getContext('2d');
  el.querySelector('#refCalTitle').textContent = title;
  const hIn = el.querySelector('#refCalH');
  hIn.value = height ? String(height) : '';
  hIn.placeholder = gameH.toFixed(2);
  el.querySelector('#refCalHint').textContent = `空白＝目前機甲高度 ${gameH.toFixed(2)} m`;
  const flip = el.querySelector('#refCalFlip');
  flip.checked = !!v.flip;
  const st = { top: v.top, bottom: v.bottom, cx: v.cx };
  const W = Math.min(innerWidth * 0.86, 1100),
    H = Math.min(innerHeight * 0.68, 760);
  const pr = devicePixelRatio || 1;
  cv.width = W * pr;
  cv.height = H * pr;
  cv.style.width = W + 'px';
  cv.style.height = H + 'px';
  let k = Math.min(W / img.naturalWidth, H / img.naturalHeight) * 0.95;
  let ox = (W - img.naturalWidth * k) / 2,
    oy = (H - img.naturalHeight * k) / 2;
  const sx = (u) => ox + u * img.naturalWidth * k,
    sy = (t) => oy + t * img.naturalHeight * k;
  const draw = () => {
    ctx.setTransform(pr, 0, 0, pr, 0, 0);
    ctx.fillStyle = '#0c1016';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (flip.checked) {
      ctx.translate(sx(0.5) * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(img, ox, oy, img.naturalWidth * k, img.naturalHeight * k);
    ctx.restore();
    const line = (x0, y0, x1, y1, c) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    line(0, sy(st.top), W, sy(st.top), '#ff6b6b');
    line(0, sy(st.bottom), W, sy(st.bottom), '#6be08a');
    line(sx(st.cx), 0, sx(st.cx), H, '#5cc8ff');
  };
  draw();
  let drag = null;
  cv.onpointerdown = (e) => {
    const r = cv.getBoundingClientRect();
    const x = e.clientX - r.left,
      y = e.clientY - r.top;
    if (e.button === 2 || e.button === 1) {
      drag = { pan: true, x: e.clientX, y: e.clientY };
    } else {
      const d = [
        ['top', Math.abs(y - sy(st.top))],
        ['bottom', Math.abs(y - sy(st.bottom))],
        ['cx', Math.abs(x - sx(st.cx))],
      ].sort((a, b) => a[1] - b[1])[0];
      drag = d[1] < 14 ? { k: d[0] } : null;
    }
    if (drag) cv.setPointerCapture(e.pointerId);
  };
  cv.onpointermove = (e) => {
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    if (drag.pan) {
      ox += e.clientX - drag.x;
      oy += e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
    } else if (drag.k === 'cx')
      st.cx = Math.min(1, Math.max(0, (e.clientX - r.left - ox) / (img.naturalWidth * k)));
    else st[drag.k] = Math.min(1, Math.max(0, (e.clientY - r.top - oy) / (img.naturalHeight * k)));
    draw();
  };
  cv.onpointerup = () => (drag = null);
  cv.oncontextmenu = (e) => e.preventDefault();
  cv.onwheel = (e) => {
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = e.clientX - r.left,
      my = e.clientY - r.top;
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    ox = mx - (mx - ox) * f;
    oy = my - (my - oy) * f;
    k *= f;
    draw();
  };
  flip.onchange = draw;
  return new Promise((res) => {
    const done = (ok) => {
      el.hidden = true;
      if (ok) {
        if (st.bottom - st.top < 0.02) {
          const t = Math.min(st.top, st.bottom);
          st.bottom = Math.max(st.top, st.bottom);
          st.top = t;
        }
        Object.assign(v, st, { flip: flip.checked });
      }
      const hv = parseFloat(hIn.value);
      res({ ok, height: Number.isFinite(hv) && hv > 0 ? hv : null });
    };
    el.querySelector('#refCalOk').onclick = () => done(true);
    el.querySelector('#refCalCancel').onclick = () => done(false);
  });
}

// ---------- 工具（每個畫面一個）----------
export class RefTools {
  // box：放介面的元素；host：有 camera／controls 屬性的物件（切換正交視圖時換掉）；canvas：3D 畫布；
  // store：GlbStore（目前模型組）；getRig()：目前畫面上的機甲（null＝沒有）；tcs()：要跟著換鏡頭的 TransformControls；
  // onPose(q)：快速姿勢改變；onView(view)：視圖改變；toast(text, bad)
  constructor({ box, host, canvas, store, getRig, tcs, onPose, onView, toast }) {
    this.box = box;
    this.host = host;
    this.canvas = canvas;
    this.store = store;
    this.getRig = getRig;
    this.tcs = tcs || (() => []);
    this.onPose = onPose || (() => {});
    this.onView = onView || (() => {});
    this.toast = toast || (() => {});
    this.q = { ...NO_POSE };
    this.view = 'persp';
    this.rec = null;
    this.set = null;
    this.planes = null;
    this.tex = {};
    this.persp = { camera: host.camera, controls: host.controls };
    this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 4000);
    this.oc = new THREE.OrbitControls(this.ortho, canvas);
    this.oc.enableRotate = false;
    this.oc.screenSpacePanning = true;
    this.oc.enabled = false;
    this.halfH = 3;
    this.aspect = 1;
    this.render();
    RefStore.listeners.add((set) => {
      if (set === this.set) this.load(true);
    });
  }
  render() {
    const sl = QUICK_POSE.map(
      ([k, n, a, b]) =>
        `<label class="refSl"><span>${n}</span><input type="range" min="${a}" max="${b}" step="1" data-rq="${k}" value="${this.q[k]}"><span class="v" data-rqv="${k}">${this.q[k]}°</span></label>`,
    ).join('');
    this.box.innerHTML =
      `<div class="btns refViews">${VIEWS.map(([v, n]) => `<button data-v="${v}">${n}</button>`).join('')}</div>` +
      `<div class="btns refPose"><button data-pose="a" title="手臂往外約 40°、腿微開">A pose</button><button data-pose="0" title="回到拉直靜止姿勢">靜止</button></div>` +
      `<div class="refSls">${sl}</div>` +
      IMG_VIEWS.map(
        ([v, n]) =>
          `<div class="refImg"><span>${n}</span><button data-load="${v}">載入…</button><button data-cal="${v}">校正…</button><button data-del="${v}">移除</button></div>`,
      ).join('') +
      `<label class="refSl"><span>透明度</span><input type="range" min="0.1" max="1" step="0.05" data-op><span class="v" data-opv></span></label>` +
      `<label class="tog"><input type="checkbox" data-top> 疊在模型上</label>` +
      `<div class="dim small refNote"></div>` +
      `<input type="file" accept="image/*" hidden data-file>`;
    const q = (s) => this.box.querySelector(s);
    for (const b of this.box.querySelectorAll('[data-v]')) b.onclick = () => this.setView(b.dataset.v);
    for (const b of this.box.querySelectorAll('[data-pose]'))
      b.onclick = () => this.setPose(b.dataset.pose === 'a' ? { ...A_POSE } : { ...NO_POSE });
    for (const r of this.box.querySelectorAll('[data-rq]'))
      r.oninput = () => {
        this.q[r.dataset.rq] = Number(r.value);
        this.setPose(this.q);
      };
    let want = null;
    for (const b of this.box.querySelectorAll('[data-load]'))
      b.onclick = () => {
        want = b.dataset.load;
        q('[data-file]').click();
      };
    q('[data-file]').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f && want) await this.loadImage(want, f);
    };
    for (const b of this.box.querySelectorAll('[data-cal]')) b.onclick = () => this.calibrate(b.dataset.cal);
    for (const b of this.box.querySelectorAll('[data-del]'))
      b.onclick = async () => {
        const r = this.rec;
        if (!r || !r.views[b.dataset.del]) return;
        delete r.views[b.dataset.del];
        await RefStore.put(this.set, Object.keys(r.views).length ? r : null);
      };
    q('[data-op]').oninput = (e) => {
      const r = this.ensureRec();
      r.opacity = Number(e.target.value);
      this.applyLook();
      clearTimeout(this.saveT);
      this.saveT = setTimeout(() => RefStore.put(this.set, r), 400);
    };
    q('[data-top]').onchange = (e) => {
      const r = this.ensureRec();
      r.onTop = e.target.checked;
      this.applyLook();
      RefStore.put(this.set, r);
    };
    this.sync();
  }
  sync() {
    const r = this.rec;
    for (const b of this.box.querySelectorAll('[data-v]'))
      b.classList.toggle('sel', b.dataset.v === this.view);
    for (const el of this.box.querySelectorAll('[data-rq]')) {
      el.value = this.q[el.dataset.rq];
      this.box.querySelector(`[data-rqv="${el.dataset.rq}"]`).textContent = this.q[el.dataset.rq] + '°';
    }
    for (const [v] of IMG_VIEWS) {
      const has = !!(r && r.views[v]);
      this.box.querySelector(`[data-cal="${v}"]`).disabled = !has;
      this.box.querySelector(`[data-del="${v}"]`).disabled = !has;
    }
    const op = r ? r.opacity : 0.55;
    this.box.querySelector('[data-op]').value = op;
    this.box.querySelector('[data-opv]').textContent = Math.round(op * 100) + '%';
    this.box.querySelector('[data-top]').checked = !!(r && r.onTop);
    const rig = this.getRig();
    const H = this.targetH();
    const names = IMG_VIEWS.filter(([v]) => r && r.views[v]).map(([, n]) => n);
    this.box.querySelector('.refNote').textContent = names.length
      ? `${names.join('、')}：身高 ${H.toFixed(2)} m${r.height ? '（自訂）' : '（目前機甲高度）'}；正視顯示正面圖、側視顯示側面圖`
      : rig
        ? '載入機甲的正面／側面設定圖後校正，切到正視或側視比對'
        : '';
  }
  ensureRec() {
    if (!this.rec) this.rec = emptyRec();
    return this.rec;
  }
  targetH() {
    const rig = this.getRig();
    return (this.rec && this.rec.height) || this.bodyH(rig);
  }
  // 機甲目前的實際高度（各區塊網格在 rig.group 座標的最高點；遊戲判定用的 height 不一定等於外觀）
  bodyH(rig = this.getRig()) {
    if (!rig) return 4;
    rig.group.updateMatrixWorld(true);
    const inv = rig.group.matrixWorld.clone().invert();
    const box = new THREE.Box3(),
      tmp = new THREE.Box3(),
      m = new THREE.Matrix4();
    for (const obj of Object.values(rig.pieces || {}))
      obj.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.material === undefined || o.isLineSegments) return;
        if (o.material.type === 'ShaderMaterial') return; // 描邊外殼
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        m.multiplyMatrices(inv, o.matrixWorld);
        box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(m));
      });
    return box.isEmpty() ? rig.height || 4 : Math.max(0.5, box.max.y);
  }
  // ---------- 模型組 ----------
  async load(force) {
    const set = this.store.cur;
    if (!force && set === this.set && this.rec !== undefined) return;
    this.set = set;
    this.rec = await RefStore.get(set);
    for (const k in this.tex) this.tex[k].dispose();
    this.tex = {};
    this.build();
    this.sync();
  }
  async loadImage(v, file) {
    if (!/^image\//.test(file.type)) return this.toast('請選擇圖片檔（PNG、JPG、WebP）', true);
    const buf = await file.arrayBuffer();
    let sz;
    try {
      sz = await imageSize(new Blob([buf], { type: file.type }));
    } catch (e) {
      return this.toast(e.message, true);
    }
    const r = this.ensureRec();
    r.views[v] = { buf, type: file.type, w: sz.w, h: sz.h, top: 0.05, bottom: 0.95, cx: 0.5, flip: false };
    await RefStore.put(this.set, r);
    await this.calibrate(v);
    if (this.view === 'persp') this.setView(v === 'side' ? 'side' : 'front');
  }
  async calibrate(v) {
    const r = this.rec;
    const iv = r && r.views[v];
    if (!iv) return;
    const { img } = await imageSize(new Blob([iv.buf], { type: iv.type }));
    const rig = this.getRig();
    const res = await calibrate(
      img,
      iv,
      `校正${v === 'side' ? '側面圖' : '正面圖'}`,
      r.height,
      this.bodyH(rig),
    );
    if (!res.ok) return;
    r.height = res.height;
    await RefStore.put(this.set, r);
  }
  // ---------- 平面 ----------
  texOf(v) {
    if (this.tex[v]) return this.tex[v];
    const iv = this.rec.views[v];
    const url = URL.createObjectURL(new Blob([iv.buf], { type: iv.type }));
    const t = new THREE.TextureLoader().load(url, () => URL.revokeObjectURL(url));
    t.encoding = THREE.sRGBEncoding;
    this.tex[v] = t;
    return t;
  }
  // 機甲重建後呼叫（平面掛在 rig.group 底下，座標＝機甲的遊戲座標，腳底中心為原點）
  attach() {
    this.build();
    this.sync();
    if (this.view !== 'persp') this.fitOrtho(false);
  }
  build() {
    if (this.planes && this.planes.parent) this.planes.parent.remove(this.planes);
    this.planes = null;
    const rig = this.getRig();
    const r = this.rec;
    if (!rig || !r || !Object.keys(r.views).length) return;
    const g = new THREE.Group();
    g.userData.helper = true;
    const H = this.targetH();
    for (const [v] of IMG_VIEWS) {
      const iv = r.views[v];
      if (!iv) continue;
      const s = H / Math.max(1e-3, (iv.bottom - iv.top) * iv.h);
      const mat = new THREE.MeshBasicMaterial({
        map: this.texOf(v),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(iv.w * s, iv.h * s), mat);
      mesh.position.set(-(iv.cx - 0.5) * iv.w * s, (iv.bottom - 0.5) * iv.h * s, 0);
      const holder = new THREE.Group();
      holder.add(mesh);
      holder.scale.x = iv.flip ? -1 : 1;
      holder.userData.view = v;
      holder.userData.helper = true;
      g.add(holder);
    }
    rig.group.add(g);
    this.planes = g;
    this.applyLook();
  }
  applyLook() {
    const g = this.planes;
    if (!g) return;
    const r = this.rec;
    for (const h of g.children) {
      const v = h.userData.view;
      const m = h.children[0];
      m.material.opacity = r.opacity;
      m.material.depthTest = !r.onTop;
      m.renderOrder = r.onTop ? 999 : -1;
      if (v === 'front') {
        h.visible = this.view === 'front' || this.view === 'back';
        h.rotation.y = Math.PI;
        h.position.set(0, 0, r.onTop ? 0 : this.view === 'back' ? -OFF : OFF);
      } else {
        h.visible = this.view === 'side';
        h.rotation.y = Math.PI / 2;
        h.position.set(r.onTop ? 0 : -OFF, 0, 0);
      }
    }
  }
  // ---------- 視圖 ----------
  setView(v) {
    if (v !== 'persp' && !this.getRig()) return this.toast('沒有可以對照的機甲', true);
    const was = this.view;
    this.view = v;
    const host = this.host;
    if (v === 'persp') {
      host.camera = this.persp.camera;
      host.controls = this.persp.controls;
      this.oc.enabled = false;
      this.persp.controls.enabled = true;
    } else {
      host.camera = this.ortho;
      host.controls = this.oc;
      this.persp.controls.enabled = false;
      this.oc.enabled = true;
      this.fitOrtho(true, was === 'persp');
    }
    for (const tc of this.tcs()) if (tc) tc.camera = host.camera;
    this.applyLook();
    this.sync();
    this.onView(v);
  }
  // 正交鏡頭對準機甲（身體座標的正面／側面／背面）；reset＝重設縮放
  fitOrtho(reset) {
    const rig = this.getRig();
    if (!rig) return;
    const H = Math.max(this.targetH(), this.bodyH(rig));
    const g = rig.group;
    g.updateMatrixWorld(true);
    const qw = g.getWorldQuaternion(new THREE.Quaternion());
    const center = g.localToWorld(new THREE.Vector3(0, H * 0.42, 0)); // 稍微偏下：畫面下方常有工具列
    this.oc.enableDamping = false;
    const dir = { front: [0, 0, -1], side: [1, 0, 0], back: [0, 0, 1] }[this.view];
    const off = new THREE.Vector3(...dir).applyQuaternion(qw).multiplyScalar(60);
    const cam = this.ortho;
    cam.up.set(0, 1, 0).applyQuaternion(qw);
    if (reset) {
      cam.zoom = 1;
      this.halfH = H * 0.72 * g.getWorldScale(new THREE.Vector3()).y;
    }
    cam.position.copy(center).add(off);
    cam.lookAt(center);
    this.oc.target.copy(center);
    this.applyFrustum();
    this.oc.update();
  }
  resize(w, h) {
    this.aspect = w / Math.max(1, h);
    this.applyFrustum();
  }
  applyFrustum() {
    const c = this.ortho,
      h = this.halfH;
    c.left = -h * this.aspect;
    c.right = h * this.aspect;
    c.top = h;
    c.bottom = -h;
    c.updateProjectionMatrix();
  }
  // ---------- 姿勢 ----------
  setPose(q) {
    this.q = { ...q };
    this.sync();
    this.onPose(this.q);
  }
  poseOn() {
    return poseActive(this.q);
  }
  label() {
    return escHtml(VIEWS.find((x) => x[0] === this.view)[1]);
  }
}
