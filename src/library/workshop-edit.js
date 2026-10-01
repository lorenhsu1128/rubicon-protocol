// 組裝調整頁的編輯：選取（點區塊、點連接點菱形、右側清單）、拖曳移動／旋轉、數值輸入、影響範圍說明。
// 連接點的值一律以 glTF 座標顯示與儲存（Y 朝上、+Z 為正面、角度），內部套到 rig 的連接點群組（遊戲座標）。
import { escHtml } from '../core/html.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { CONN_NAMES } from '../render/mech-model.js';
import { gameToGltf, gltfToGame } from '../render/mech-joints.js';
import { buildConnMarker } from './refs.js';

const $ = (id) => document.getElementById(id);
const HOT = 0xffd23f,
  COLD = 0xc084fc,
  CUR = 0xffffff;
const D2R = Math.PI / 180;
const ORIGIN_TEXT = { browser: '已修改（瀏覽器暫存）', builtin: '內建 joints.json', default: '程式預設值' };
const FIELDS = [
  ['p', 0, 'X'],
  ['p', 1, 'Y'],
  ['p', 2, 'Z'],
  ['r', 0, 'X'],
  ['r', 1, 'Y'],
  ['r', 2, 'Z'],
];
const same = (a, b) => a && b && a.slot === b.slot && a.name === b.name;

export class WsEditor {
  // ws：Workshop（提供 rig、store、infoOf、partNameOf、onJoints）
  constructor(ws) {
    this.ws = ws;
    this.sel = null; // { slot }＝選中區塊；{ slot, name }＝選中連接點
    this.mode = 'translate';
    this.marks = [];
    this.timers = {};
    // glTF 座標框：繞 Y 轉 180°，代理物件在框內的位置與旋轉就是 glTF 值，拖曳箭頭也沿 glTF 軸
    this.frame = new THREE.Group();
    this.frame.rotation.y = Math.PI;
    this.proxy = new THREE.Group();
    this.frame.add(this.proxy);
    this.tc = null;
    if (THREE.TransformControls) {
      const tc = new THREE.TransformControls(ws.camera, ws.canvas);
      tc.setSpace('local');
      tc.setSize(0.85);
      tc.addEventListener('dragging-changed', (e) => {
        ws.controls.enabled = !e.value;
        this.dragging = e.value;
        if (e.value) this.dragStart = this.current();
        else this.commitDrag();
      });
      tc.addEventListener('objectChange', () => this.fromProxy());
      ws.scene.add(tc);
      this.tc = tc;
    }
    let down = null;
    ws.canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    ws.canvas.addEventListener('pointerup', (e) => {
      if (!down || this.dragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      this.pick(e);
    });
    addEventListener('keydown', (e) => {
      if (!ws.open_ || e.target.closest('input,select,textarea')) return;
      if (e.key === 'w' || e.key === 'W') this.setMode('translate');
      else if (e.key === 'e' || e.key === 'E') this.setMode('rotate');
    });
    this.renderToolbar();
  }

  // ---------- 工具列 ----------
  renderToolbar() {
    $('wsToolbar').innerHTML =
      `<div class="wsTools btns">` +
      `<button data-m="translate" title="拖曳三軸箭頭移動（W）">移動</button>` +
      `<button data-m="rotate" title="拖曳旋轉環旋轉（E）">旋轉</button>` +
      `</div>`;
    for (const b of $('wsToolbar').querySelectorAll('[data-m]')) b.onclick = () => this.setMode(b.dataset.m);
    this.setMode(this.mode);
  }
  setMode(m) {
    this.mode = m;
    if (this.tc) this.tc.setMode(m);
    for (const b of $('wsToolbar').querySelectorAll('[data-m]')) b.classList.toggle('sel', b.dataset.m === m);
  }

  // ---------- 機甲重建後掛上標記、恢復選取 ----------
  attach(rig) {
    this.detachGizmo();
    this.rig = rig;
    this.marks = rig.mounts.map((m) => {
      const mk = buildConnMarker(0.05, false);
      mk.userData.helper = true;
      m.node.add(mk);
      return { ...m, mk };
    });
    const s = this.sel;
    if (s && !(s.name ? this.mark(s) : rig.pieces[s.slot])) this.sel = null;
    this.apply();
  }
  mark(s) {
    return this.marks.find((m) => same(m, s));
  }

  // ---------- 選取 ----------
  select(sel) {
    this.sel = sel;
    this.apply();
  }
  // 子區塊接在哪個連接點、連接點上接的是哪個子區塊
  parentMark(slot) {
    const obj = this.rig.pieces[slot];
    const mount = obj && obj.parent && obj.parent.parent;
    return this.marks.find((m) => m.node === mount) || null;
  }
  childSlot(m) {
    for (const [slot, obj] of Object.entries(this.rig.pieces))
      if (obj.parent && obj.parent.parent === m.node) return slot;
    return null;
  }
  apply() {
    const s = this.sel;
    const pieceSlot = s ? s.slot : null;
    const parent = s && !s.name ? this.parentMark(s.slot) : null;
    for (const m of this.marks) {
      const cur = s && s.name && same(m, s);
      const hot = cur || m.slot === pieceSlot || m === parent;
      m.mk.children[0].material.color.setHex(cur ? CUR : hot ? HOT : COLD);
      m.mk.children[0].material.opacity = hot ? 1 : 0.6;
      m.mk.scale.setScalar(cur ? 1.6 : 1);
    }
    for (const r of document.querySelectorAll('#wsTree .wsNode, #wsTree .wsConn, #wsParts .wsPiece')) {
      const on =
        s && r.dataset.slot === s.slot && (r.classList.contains('wsConn') ? r.dataset.n === s.name : !s.name);
      r.classList.toggle('sel', !!on);
    }
    const row = s && document.querySelector(`#wsTree .sel`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (s && s.name) this.attachGizmo();
    else this.detachGizmo();
    this.renderDetail();
    this.ws.updateLabels && this.ws.updateLabels(true);
  }
  attachGizmo() {
    const m = this.mark(this.sel);
    if (!m || !this.tc) return;
    m.node.parent.add(this.frame);
    this.syncProxy();
    this.tc.attach(this.proxy);
  }
  detachGizmo() {
    if (this.tc) this.tc.detach();
    if (this.frame.parent) this.frame.parent.remove(this.frame);
  }
  syncProxy() {
    const m = this.sel && this.sel.name && this.mark(this.sel);
    if (!m) return;
    const v = gameToGltf(m.node.position, m.node.rotation);
    this.proxy.position.set(v.p[0], v.p[1], v.p[2]);
    this.proxy.rotation.set(v.r[0] * D2R, v.r[1] * D2R, v.r[2] * D2R);
  }
  // 點擊：連接點菱形優先，其次是區塊
  pick(e) {
    if (!this.rig) return;
    const r = this.ws.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      this.ws.camera,
    );
    const hit = ray.intersectObjects(
      this.marks.filter((m) => m.mk.visible).map((m) => m.mk.children[0]),
      false,
    )[0];
    if (hit) {
      const m = this.marks.find((x) => x.mk.children[0] === hit.object);
      return this.select({ slot: m.slot, name: m.name });
    }
    const hits = ray.intersectObject(this.rig.group, true).filter((h) => {
      if (!h.object.isMesh || h.object.material === OUTLINE_MAT || !h.object.visible) return false;
      for (let o = h.object; o; o = o.parent) if (o.userData.helper) return false;
      return true;
    });
    for (const h of hits) {
      for (let o = h.object; o && o !== this.rig.group; o = o.parent)
        if (o.userData.slot && this.rig.pieces[o.userData.slot] === o)
          return this.select({ slot: o.userData.slot });
    }
    this.select(null);
  }

  // ---------- 數值 ----------
  current(s = this.sel) {
    const m = s && this.mark(s);
    return m ? gameToGltf(m.node.position, m.node.rotation) : null;
  }
  // 套用一個連接點的值（glTF）：rig 立即更新；persist 時寫入瀏覽器暫存
  setConn(s, val, persist) {
    const m = this.mark(s);
    if (m) {
      const g = gltfToGame(val);
      m.node.position.copy(g.p);
      m.node.rotation.copy(g.r);
    }
    if (same(s, this.sel) && !this.dragging) this.syncProxy();
    this.ws.updateConnRow(s.slot, s.name);
    if (persist) this.persist(s, val);
  }
  persist(s, val) {
    const key = s.slot + '|' + s.name;
    clearTimeout(this.timers[key]);
    this.timers[key] = setTimeout(async () => {
      await this.ws.store.setJoint(s.slot, s.name, val);
      this.ws.updateConnRow(s.slot, s.name);
      if (same(s, this.sel)) this.writeDetail();
      this.ws.onJoints && this.ws.onJoints(s.slot);
    }, 250);
  }
  fromProxy() {
    if (!this.sel || !this.sel.name) return;
    const q = this.proxy;
    const val = {
      p: [q.position.x, q.position.y, q.position.z].map((v) => Math.round(v * 1000) / 1000),
      r: [q.rotation.x, q.rotation.y, q.rotation.z].map((v) => Math.round((v / D2R) * 100) / 100),
    };
    this.setConn(this.sel, val, false);
    this.writeDetail();
  }
  commitDrag() {
    const s = this.sel;
    if (!s || !s.name) return;
    this.change(s, this.dragStart, this.current(s));
  }
  // 一次修改（拖曳結束、輸入框、重設）：寫入並通知（之後的對稱、復原也走這裡）
  change(s, before, after) {
    if (!after || JSON.stringify(before) === JSON.stringify(after)) return;
    this.setConn(s, after, true);
  }

  // ---------- 右側詳細資料 ----------
  impactText(slot) {
    const p = this.ws.partNameOf(slot);
    return p ? `修改會套用到所有使用「${p.part}」${p.cat}的機甲（零件的連接點）` : '';
  }
  renderDetail() {
    const s = this.sel,
      box = $('wsDetail');
    if (!s) {
      box.innerHTML = `<div class="dim small">點畫面上的區塊或黃色菱形，或點下方清單，選取要調整的連接點。</div>`;
      return;
    }
    const label = (slot) => this.ws.pieceLabelOf(slot);
    if (!s.name) {
      const own = this.marks.filter((m) => m.slot === s.slot);
      const parent = this.parentMark(s.slot);
      box.innerHTML =
        `<div class="wsDh"><b>${escHtml(label(s.slot))}</b><span class="dim small">${escHtml(s.slot)}</span></div>` +
        (parent
          ? `<div class="small">接在：<button class="link" data-slot="${parent.slot}" data-n="${parent.name}">${escHtml(label(parent.slot))}的${escHtml(CONN_NAMES[parent.name] || parent.name)}</button></div>`
          : `<div class="small dim">機體根部（地面）</div>`) +
        (own.length
          ? `<div class="small">此區塊的連接點：${own.map((m) => `<button class="link" data-slot="${m.slot}" data-n="${m.name}">${escHtml(CONN_NAMES[m.name] || m.name)}</button>`).join('')}</div>`
          : `<div class="small dim">此區塊沒有連接點</div>`);
    } else {
      const m = this.mark(s);
      const child = m && this.childSlot(m);
      box.innerHTML =
        `<div class="wsDh"><b>${escHtml(CONN_NAMES[s.name] || s.name)}</b><span class="dim small">${escHtml(label(s.slot))}・${escHtml(s.slot)}</span></div>` +
        (child
          ? `<div class="small">接在這裡：<button class="link" data-slot="${child}">${escHtml(label(child))}</button></div>`
          : '') +
        `<div class="small warnTxt">${escHtml(this.impactText(s.slot))}</div>` +
        `<div class="jgrid"><span class="dim">位置 m</span>` +
        FIELDS.slice(0, 3)
          .map(([k, i, a]) => this.field(k, i, a, 0.01))
          .join('') +
        `<span class="dim">旋轉 °</span>` +
        FIELDS.slice(3)
          .map(([k, i, a]) => this.field(k, i, a, 1))
          .join('') +
        `</div><div class="wsDf"><span class="jsrc small"></span><button data-act="reset">重設</button></div>`;
      for (const inp of box.querySelectorAll('input')) inp.oninput = () => this.fromInputs();
      box.querySelector('[data-act=reset]').onclick = () => this.reset(s);
      this.writeDetail();
    }
    for (const b of box.querySelectorAll('button.link'))
      b.onclick = () =>
        this.select(b.dataset.n ? { slot: b.dataset.slot, name: b.dataset.n } : { slot: b.dataset.slot });
  }
  field(k, i, a, step) {
    return `<label><i class="ax-${a.toLowerCase()}">${a}</i><input type="number" step="${step}" data-k="${k}" data-i="${i}"></label>`;
  }
  writeDetail() {
    const s = this.sel;
    if (!s || !s.name) return;
    const v = this.current(s);
    const box = $('wsDetail');
    for (const inp of box.querySelectorAll('input')) {
      if (document.activeElement === inp || !v) continue;
      inp.value = v[inp.dataset.k][+inp.dataset.i];
    }
    const o = this.ws.store.jointOrigin(s.slot, s.name);
    const src = box.querySelector('.jsrc');
    if (src) {
      src.textContent = ORIGIN_TEXT[o];
      src.classList.toggle('mod', o === 'browser');
    }
    const rb = box.querySelector('[data-act=reset]');
    if (rb) rb.disabled = o !== 'browser';
  }
  fromInputs() {
    const s = this.sel;
    const v = { p: [0, 0, 0], r: [0, 0, 0] };
    for (const inp of $('wsDetail').querySelectorAll('input')) {
      const n = parseFloat(inp.value);
      if (!Number.isFinite(n)) return;
      v[inp.dataset.k][+inp.dataset.i] = n;
    }
    this.change(s, this.current(s), v);
  }
  // 重設：移除瀏覽器暫存，回到內建 joints.json 或程式預設值
  async reset(s) {
    const before = this.current(s);
    await this.ws.store.setJoint(s.slot, s.name, null);
    const after = this.ws.defaultConn(s.slot, s.name);
    this.setConn(s, after, false);
    this.writeDetail();
    this.ws.onJoints && this.ws.onJoints(s.slot);
    return { before, after };
  }
}
