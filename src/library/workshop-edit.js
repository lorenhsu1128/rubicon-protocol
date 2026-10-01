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
const round = (v, k) => Math.round(v * k) / k;
const SETTINGS_KEY = 'rubicon_workshop_steps';
// 步進：位置以公分、旋轉以角度；吸附預設關閉
const DEFAULT_STEPS = { move: 1, moveBig: 10, rot: 1, rotBig: 15, snap: false, snapMove: 5, snapRot: 15 };
const SWAP_SIDE = { r: 'l', l: 'r', fl: 'fr', fr: 'fl', bl: 'br', br: 'bl' };
// 對稱的另一側：槽位（arms/x/r_upper ↔ l_upper、weapon/x/r ↔ l）與連接點名稱（shoulder_r ↔ shoulder_l、hip_fl ↔ hip_fr）
// 都換邊；兩者都沒有左右之分（例如核心的脖子）時回傳 null
export function mirrorOf(s) {
  const slot = s.slot
    .replace(/\/(r|l|fl|fr|bl|br)_([a-z]+)$/, (m, k, n) => `/${SWAP_SIDE[k]}_${n}`)
    .replace(/\/(r|l)$/, (m, k) => '/' + SWAP_SIDE[k]);
  const name = s.name.replace(/_(r|l|fl|fr|bl|br)$/, (m, k) => '_' + SWAP_SIDE[k]);
  return slot === s.slot && name === s.name ? null : { slot, name };
}
// 鏡像值（對 glTF 的 YZ 平面）：位置 X 取負，旋轉 Y、Z 取負
export const mirrorVal = (v) => ({
  p: [round(-v.p[0], 1000) + 0, v.p[1], v.p[2]],
  r: [v.r[0], round(-v.r[1], 100) + 0, round(-v.r[2], 100) + 0],
});

export class WsEditor {
  // ws：Workshop（提供 rig、store、infoOf、partNameOf、onJoints）
  constructor(ws) {
    this.ws = ws;
    this.sel = null; // { slot }＝選中區塊；{ slot, name }＝選中連接點
    this.mode = 'translate';
    this.marks = [];
    this.timers = {};
    this.undo = [];
    this.redo = [];
    this.sym = false;
    this.loadSettings();
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
        if (!e.value) this.commitDrag();
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
      if (k === 'w' || k === 'W') return this.setMode('translate');
      if (k === 'e' || k === 'E') return this.setMode('rotate');
      const NUDGE = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [1, 1],
        ArrowDown: [1, -1],
        PageUp: [2, 1],
        PageDown: [2, -1],
      };
      if (NUDGE[k] && this.sel && this.sel.name) {
        e.preventDefault();
        this.nudge(NUDGE[k][0], NUDGE[k][1], e.shiftKey);
      }
    });
    this.renderToolbar();
  }

  // ---------- 工具列 ----------
  renderToolbar() {
    const st = this.settings;
    const num = (k, step, unit) =>
      `<label>${unit[0]}<input type="number" min="0" step="${step}" data-st="${k}" value="${st[k]}">${unit[1]}</label>`;
    $('wsToolbar').innerHTML =
      `<div class="wsTools btns">` +
      `<button data-m="translate" title="拖曳三軸箭頭移動（W）">移動</button>` +
      `<button data-m="rotate" title="拖曳旋轉環旋轉（E）">旋轉</button></div>` +
      `<div class="wsTools btns">` +
      `<label class="tog" title="改一側時，另一側自動套用鏡像數值"><input type="checkbox" id="wsSym"> 對稱編輯</label>` +
      `<button id="wsCopy" title="把選中連接點的值鏡像後複製到另一側">複製到另一側</button></div>` +
      `<div class="wsTools btns">` +
      `<button id="wsUndo" title="復原（Ctrl+Z）">↶ 復原</button><button id="wsRedo" title="重做（Ctrl+Y）">↷ 重做</button></div>` +
      `<details class="wsSteps"><summary>步進與吸附</summary>` +
      `<div class="small dim">方向鍵：←→ X、↑↓ Y、PageUp／PageDown Z；按住 Shift 用大步進。旋轉模式下改成繞該軸旋轉。</div>` +
      `<div class="wsStepGrid">` +
      num('move', 0.1, ['移動 ', ' cm']) +
      num('moveBig', 1, ['Shift ', ' cm']) +
      num('rot', 0.5, ['旋轉 ', '°']) +
      num('rotBig', 1, ['Shift ', '°']) +
      `<label class="tog"><input type="checkbox" data-st="snap"${st.snap ? ' checked' : ''}> 拖曳吸附</label>` +
      num('snapMove', 0.5, ['吸附 ', ' cm']) +
      num('snapRot', 1, ['吸附 ', '°']) +
      `</div></details>`;
    for (const b of $('wsToolbar').querySelectorAll('[data-m]')) b.onclick = () => this.setMode(b.dataset.m);
    $('wsSym').onchange = () => (this.sym = $('wsSym').checked);
    $('wsCopy').onclick = () => this.copyToOther();
    $('wsUndo').onclick = () => this.step(true);
    $('wsRedo').onclick = () => this.step(false);
    for (const inp of $('wsToolbar').querySelectorAll('[data-st]'))
      inp.onchange = () => {
        const k = inp.dataset.st;
        if (inp.type === 'checkbox') this.settings[k] = inp.checked;
        else {
          const v = parseFloat(inp.value);
          if (Number.isFinite(v) && v > 0) this.settings[k] = v;
          inp.value = this.settings[k];
        }
        this.saveSettings();
      };
    this.setMode(this.mode);
    this.applySnap();
    this.renderUndo();
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
    if ($('wsCopy')) $('wsCopy').disabled = !(s && s.name && mirrorOf(s));
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
  // 連接點目前的值（glTF）：在畫面上就讀 rig，否則讀設定（瀏覽器暫存＞內建＞預設）
  valueOf(s) {
    return this.current(s) || this.ovOf(s) || this.ws.defaultConn(s.slot, s.name);
  }
  // 瀏覽器暫存的覆寫值（沒有則 null）
  ovOf(s) {
    const j = this.ws.store.joints[s.slot];
    return j && j[s.name] ? { p: [...j[s.name].p], r: [...j[s.name].r] } : null;
  }
  // 只改畫面上的連接點群組（拖曳中的即時預覽）
  setConn(s, val) {
    const m = this.mark(s);
    if (m) {
      const g = gltfToGame(val);
      m.node.position.copy(g.p);
      m.node.rotation.copy(g.r);
    }
    if (same(s, this.sel) && !this.dragging) this.syncProxy();
    this.ws.updateConnRow(s.slot, s.name);
  }
  // 寫入覆寫值（null＝移除瀏覽器暫存，回到內建 joints.json 或程式預設值）並更新畫面
  async applyOv(s, ov) {
    await this.ws.store.setJoint(s.slot, s.name, ov);
    this.setConn(s, ov || this.ws.defaultConn(s.slot, s.name));
  }
  // 對稱編輯開啟時，一併修改另一側（左右互換的槽位與連接點）
  withMirror(list) {
    if (!this.sym) return list;
    const out = [...list];
    for (const { s, ov } of list) {
      const t = mirrorOf(s);
      if (t && !out.some((x) => same(x.s, t))) out.push({ s: t, ov: ov ? mirrorVal(ov) : null });
    }
    return out;
  }
  // 一次修改：list＝[{ s, ov }]；記錄復原（mergeKey 相同且間隔很短的連續修改合併成一步，例如方向鍵、打字）
  async commit(list, mergeKey) {
    const items = list.map(({ s, ov }) => ({ s, before: this.ovOf(s), after: ov }));
    if (items.every((i) => JSON.stringify(i.before) === JSON.stringify(i.after))) {
      for (const i of items) this.setConn(i.s, i.after || this.ws.defaultConn(i.s.slot, i.s.name));
      return;
    }
    const last = this.undo[this.undo.length - 1];
    const now = performance.now();
    if (
      mergeKey &&
      last &&
      last.key === mergeKey &&
      now - last.t < 1000 &&
      last.items.length === items.length
    ) {
      last.items.forEach((x, k) => (x.after = items[k].after));
      last.t = now;
    } else this.undo.push({ key: mergeKey || null, t: now, items });
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    for (const i of items) await this.applyOv(i.s, i.after);
    this.changed();
  }
  async step(back) {
    const e = (back ? this.undo : this.redo).pop();
    if (!e) return this.ws.toast(back ? '沒有可以復原的修改' : '沒有可以重做的修改', true);
    (back ? this.redo : this.undo).push(e);
    for (const i of e.items) await this.applyOv(i.s, back ? i.before : i.after);
    this.changed();
  }
  changed() {
    this.writeDetail();
    this.renderUndo();
    clearTimeout(this.timers.notify);
    this.timers.notify = setTimeout(() => this.ws.onJoints && this.ws.onJoints(), 300);
  }
  fromProxy() {
    if (!this.sel || !this.sel.name) return;
    const q = this.proxy;
    const val = {
      p: [q.position.x, q.position.y, q.position.z].map((v) => Math.round(v * 1000) / 1000),
      r: [q.rotation.x, q.rotation.y, q.rotation.z].map((v) => Math.round((v / D2R) * 100) / 100),
    };
    for (const { s, ov } of this.withMirror([{ s: this.sel, ov: val }])) this.setConn(s, ov);
    this.writeDetail(val);
  }
  commitDrag() {
    const s = this.sel;
    if (!s || !s.name) return;
    this.commit(this.withMirror([{ s, ov: this.current(s) }]));
  }
  // 方向鍵微調（glTF 軸）：←→ X、↑↓ Y、PageUp／PageDown Z；旋轉模式改成繞該軸轉
  nudge(axis, dir, big) {
    const s = this.sel;
    if (!s || !s.name) return;
    const v = this.valueOf(s);
    const st = this.settings;
    if (this.mode === 'rotate') v.r[axis] = round(v.r[axis] + dir * (big ? st.rotBig : st.rot), 100);
    else v.p[axis] = round(v.p[axis] + (dir * (big ? st.moveBig : st.move)) / 100, 1000);
    this.commit(this.withMirror([{ s, ov: v }]), 'key|' + s.slot + s.name);
  }
  // 把目前這一側的值（鏡像後）複製到另一側
  copyToOther() {
    const s = this.sel;
    const t = s && s.name && mirrorOf(s);
    if (!t) return this.ws.toast('這個連接點沒有對應的另一側', true);
    this.commit([{ s: t, ov: mirrorVal(this.valueOf(s)) }]);
    this.ws.toast(`已複製到${this.ws.pieceLabelOf(t.slot)}的${CONN_NAMES[t.name] || t.name}`);
  }
  // 重設（可復原）：移除瀏覽器暫存
  reset(s) {
    return this.commit(this.withMirror([{ s, ov: null }]));
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
    this.commit(this.withMirror([{ s, ov: v }]), 'input|' + s.slot + s.name);
  }

  // ---------- 復原／重做按鈕狀態 ----------
  renderUndo() {
    const u = $('wsUndo'),
      r = $('wsRedo');
    if (u) u.disabled = !this.undo.length;
    if (r) r.disabled = !this.redo.length;
  }
  // ---------- 步進與吸附設定（存在這個瀏覽器）----------
  loadSettings() {
    let st = {};
    try {
      st = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
    } catch (e) {}
    this.settings = { ...DEFAULT_STEPS, ...st };
  }
  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (e) {}
    this.applySnap();
  }
  applySnap() {
    if (!this.tc) return;
    const st = this.settings;
    this.tc.setTranslationSnap(st.snap ? st.snapMove / 100 : null);
    this.tc.setRotationSnap(st.snap ? st.snapRot * D2R : null);
  }
}
