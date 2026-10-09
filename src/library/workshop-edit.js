// 組裝調整頁的編輯：選取（點區塊、點連接點菱形、右側清單）、拖曳移動／旋轉、數值輸入、影響範圍說明。
// 連接點的值一律以 glTF 座標顯示與儲存（Y 朝上、+Z 為正面、角度），內部套到 rig 的連接點群組（遊戲座標）。
import { escHtml } from '../core/html.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { CONN_NAMES, refreshGround } from '../render/mech-model.js';
import { gameToGltf, gltfToGame } from '../render/mech-joints.js';
import { readOrigin, writeOrigin } from './glb-origin.js';
import { buildConnMarker } from './refs.js';
import { GAP_WARN, OVERLAP_WARN, checkRig } from './workshop-check.js';

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
// 顯示方式：高亮選中區塊、其他區塊半透明、隱藏無關區塊、穿幫提示
// keep：移動連接點時「只動關節」（子區塊不動，改它的原點）；false＝子區塊跟著連接點移動
const DEFAULT_STEPS = {
  keep: true,
  move: 1,
  moveBig: 10,
  rot: 1,
  rotBig: 15,
  snap: false,
  snapMove: 5,
  snapRot: 15,
  hl: true,
  ghost: true,
  hide: false,
  check: true,
  ruler: true,
};
const FLAG = 0xff5a4d;
const GHOSTS = new Map();
// 半透明替身材質（同一個原材質共用一個）
function ghostOf(m) {
  if (Array.isArray(m)) return m.map(ghostOf);
  if (!GHOSTS.has(m)) {
    const g = m.clone();
    g.transparent = true;
    g.opacity = 0.16;
    g.depthWrite = false;
    GHOSTS.set(m, g);
  }
  return GHOSTS.get(m);
}
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
// 連接點值（glTF）↔ 遊戲座標的矩陣
const ONE = new THREE.Vector3(1, 1, 1);
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
function matOf(v) {
  const g = gltfToGame(v);
  return new THREE.Matrix4().compose(g.p, new THREE.Quaternion().setFromEuler(g.r), ONE);
}
function valOf(m) {
  const p = new THREE.Vector3(),
    q = new THREE.Quaternion(),
    s = new THREE.Vector3();
  m.decompose(p, q, s);
  return gameToGltf(p, new THREE.Euler().setFromQuaternion(q));
}

export class WsEditor {
  // ws：Workshop（提供 rig、store、infoOf、partNameOf、onJoints）
  constructor(ws) {
    this.ws = ws;
    this.sel = null; // { slot }＝選中區塊；{ slot, name }＝選中連接點
    this.mode = 'translate';
    this.editModel = false; // true＝調整區塊的模型（縮放／位移／旋轉，寫回 GLB 的原點節點），false＝連接點
    this.uniform = true; // 模型縮放維持等比例
    this.marks = [];
    this.timers = {};
    this.undo = [];
    this.redo = [];
    this.sym = false;
    this.origin0 = {}; // 槽位 → 建立畫面時 GLB 裡的原點節點矩陣（glTF）；即時預覽以它為基準
    this.savedSlots = new Set(); // 改寫過 GLB（原點）、待通知模型庫的槽位
    this.loadSettings();
    this.flags = new Set(); // 有穿幫提示的連接點（父槽位|連接點）
    this.checkT = 0;
    this.boxes = [0xffd23f, 0x5cc8ff].map((c) => {
      const b = new THREE.BoxHelper(undefined, c);
      b.material.depthTest = false;
      b.material.transparent = true;
      b.renderOrder = 25;
      b.visible = false;
      ws.scene.add(b);
      return b;
    });
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
        // 拖曳腿部根區塊時固定核心在畫面上的位置（放開後再自動貼地）
        const t = e.value && this.target();
        this.anchor = t && t.inverse ? this.rig.torso.matrixWorld.clone() : null;
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
      if ((k === 'r' || k === 'R') && this.editModel) return this.setMode('scale');
      const NUDGE = {
        ArrowLeft: [0, -1],
        ArrowRight: [0, 1],
        ArrowUp: [1, 1],
        ArrowDown: [1, -1],
        PageUp: [2, 1],
        PageDown: [2, -1],
      };
      if (NUDGE[k] && this.target()) {
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
      `<button data-m="rotate" title="拖曳旋轉環旋轉（E）">旋轉</button>` +
      `<button data-m="scale" title="拖曳方塊縮放（R，只在調整模型時）">縮放</button></div>` +
      `<div class="wsTools btns">` +
      `<button data-edit="0" title="調整連接點（關節的位置與旋轉）">連接點</button>` +
      `<button data-edit="1" title="調整選中區塊的模型：以原點為中心縮放、位移、旋轉（寫回它的 GLB，原點不變）">模型</button>` +
      `<label class="tog" title="縮放時三軸一起變"><input type="checkbox" id="wsUniform"> 等比例</label></div>` +
      `<div class="wsTools btns">` +
      `<button data-keep="1" title="移動關節點時零件不動，只改轉軸（子零件的原點自動寫回 GLB）">只動關節</button>` +
      `<button data-keep="0" title="移動關節點時，接在上面的零件與下游的零件一起移動">零件跟著動</button></div>` +
      `<div class="wsTools btns">` +
      `<label class="tog" title="改一側時，另一側自動套用鏡像數值"><input type="checkbox" id="wsSym"> 對稱編輯</label>` +
      `<button id="wsCopy" title="把選中連接點的值鏡像後複製到另一側">複製到另一側</button></div>` +
      `<div class="wsTools btns">` +
      `<button id="wsUndo" title="復原（Ctrl+Z）">↶ 復原</button><button id="wsRedo" title="重做（Ctrl+Y）">↷ 重做</button></div>` +
      `<div class="wsTools btns wsShow"><span class="small dim">顯示</span>` +
      [
        ['hl', '高亮選中'],
        ['ghost', '其他半透明'],
        ['hide', '隱藏無關'],
        ['check', '穿幫提示'],
        ['ruler', '高度尺'],
      ]
        .map(
          ([k, n]) =>
            `<label class="tog"><input type="checkbox" data-st="${k}"${st[k] ? ' checked' : ''}> ${n}</label>`,
        )
        .join('') +
      `</div>` +
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
    for (const b of $('wsToolbar').querySelectorAll('[data-edit]'))
      b.onclick = () => this.setEditModel(b.dataset.edit === '1');
    $('wsUniform').checked = this.uniform;
    $('wsUniform').onchange = () => (this.uniform = $('wsUniform').checked);
    this.markEdit();
    for (const b of $('wsToolbar').querySelectorAll('[data-keep]'))
      b.onclick = () => {
        this.settings.keep = b.dataset.keep === '1';
        this.saveSettings();
        this.markKeep();
        this.renderDetail();
      };
    this.markKeep();
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
  markKeep() {
    for (const b of $('wsToolbar').querySelectorAll('[data-keep]'))
      b.classList.toggle('sel', (b.dataset.keep === '1') === !!this.settings.keep);
  }
  setEditModel(on) {
    this.editModel = on;
    if (!on && this.mode === 'scale') this.mode = 'translate';
    this.markEdit();
    this.setMode(this.mode);
    this.apply();
  }
  markEdit() {
    for (const b of $('wsToolbar').querySelectorAll('[data-edit]'))
      b.classList.toggle('sel', (b.dataset.edit === '1') === this.editModel);
    const sb = $('wsToolbar').querySelector('[data-m=scale]');
    if (sb) sb.disabled = !this.editModel;
  }
  setMode(m) {
    if (m === 'scale' && !this.editModel) m = 'translate';
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
    this.origin0 = {};
    for (const slot of this.ws.glbSlots) this.origin0[slot] = this.originOf(slot);
    const s = this.sel;
    if (s && !(s.name ? this.mark(s) : rig.pieces[s.slot])) this.sel = null;
    this.apply();
    this.dirty();
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
  colorMarks() {
    const s = this.sel;
    const pieceSlot = s ? s.slot : null;
    const parent = s && !s.name ? this.parentMark(s.slot) : null;
    for (const m of this.marks) {
      const cur = s && s.name && same(m, s);
      const hot = cur || m.slot === pieceSlot || m === parent;
      const flag = this.settings.check && this.flags.has(m.slot + '|' + m.name);
      m.mk.children[0].material.color.setHex(cur ? CUR : hot ? HOT : flag ? FLAG : COLD);
      m.mk.children[0].material.opacity = hot || flag ? 1 : 0.6;
      m.mk.scale.setScalar(cur ? 1.6 : flag ? 1.3 : 1);
    }
  }
  // 焦點區塊：選中的區塊；選中連接點時是擁有它的區塊＋接在上面的子區塊
  focusSlots() {
    const s = this.sel;
    if (!s) return [];
    const out = [s.slot];
    if (s.name) {
      const m = this.mark(s);
      const c = m && this.childSlot(m);
      if (c) out.push(c);
    }
    return out;
  }
  // 顯示方式：半透明（焦點以外）、隱藏無關區塊（只留焦點與它們的父、子區塊）
  applyDisplay() {
    const rig = this.rig;
    if (!rig) return;
    const st = this.settings;
    const focus = new Set(this.focusSlots());
    const related = new Set(focus);
    for (const f of focus) {
      const pm = this.parentMark(f);
      if (pm) related.add(pm.slot);
      for (const m of this.marks) if (m.slot === f) related.add(this.childSlot(m));
    }
    const any = focus.size > 0;
    for (const [slot, obj] of Object.entries(rig.pieces)) {
      obj.visible = !(st.hide && any && !related.has(slot));
      const ghost = st.ghost && any && !focus.has(slot);
      obj.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === OUTLINE_MAT) {
          o.visible = !ghost;
          return;
        }
        if (ghost) {
          if (!o.userData.origMat) o.userData.origMat = o.material;
          o.material = ghostOf(o.userData.origMat);
        } else if (o.userData.origMat) {
          o.material = o.userData.origMat;
          delete o.userData.origMat;
        }
      });
    }
    for (const m of this.marks) m.mk.visible = !(st.hide && any && !related.has(m.slot));
    const fs = [...focus];
    this.boxes.forEach((b, i) => {
      b.userData.target = st.hl && fs[i] ? rig.pieces[fs[i]] : null;
      b.visible = !!b.userData.target;
    });
  }
  // 每幀：更新高亮外框；穿幫提示在移動中用外框估算、停下來後用網格精算
  tick(dt) {
    for (const b of this.boxes) if (b.userData.target) b.setFromObject(b.userData.target);
    if (!this.rig) return;
    if (!this.settings.check) return;
    const moving = this.dragging || this.ws.playing;
    this.checkT -= dt;
    if (moving) {
      if (this.checkT <= 0) {
        this.runCheck(false);
        this.checkT = 0.25;
      }
      this.needPrecise = true;
    } else if (this.needPrecise) {
      this.needPrecise = false;
      this.runCheck(true);
    }
  }
  dirty() {
    this.needPrecise = true;
  }
  runCheck(precise) {
    const res = checkRig(this.rig, precise);
    this.flags = new Set(res.warns.map((w) => w.parent + '|' + w.conn));
    this.colorMarks();
    const box = $('wsChecks');
    if (!box) return;
    const label = (slot) => this.ws.pieceLabelOf(slot);
    box.innerHTML =
      `<div class="small dim">${precise ? '網格精算' : '外框估算（移動中）'}：縫隙 > ${GAP_WARN * 100} cm 或重疊 > ${OVERLAP_WARN * 100}% 時提示</div>` +
      (res.warns.length
        ? res.warns
            .map(
              (w) =>
                `<div class="wsWarn" data-slot="${w.parent}" data-n="${w.conn}">⚠ ${escHtml(label(w.child))} ↔ ${escHtml(label(w.parent))}（${escHtml(CONN_NAMES[w.conn] || w.conn)}）：` +
                [
                  w.gap > GAP_WARN ? `縫隙 ${(w.gap * 100).toFixed(1)} cm` : '',
                  w.overlap > OVERLAP_WARN ? `重疊 ${Math.round(w.overlap * 100)}%` : '',
                ]
                  .filter(Boolean)
                  .join('、') +
                `</div>`,
            )
            .join('')
        : `<div class="small ok">✓ 沒有明顯的縫隙或重疊（${res.all.length} 對相鄰區塊）</div>`);
    for (const r of box.querySelectorAll('.wsWarn'))
      r.onclick = () => this.select({ slot: r.dataset.slot, name: r.dataset.n });
  }
  apply() {
    const s = this.sel;
    this.colorMarks();
    this.applyDisplay();
    for (const r of document.querySelectorAll('#wsTree .wsNode, #wsTree .wsConn, #wsParts .wsPiece')) {
      const on =
        s && r.dataset.slot === s.slot && (r.classList.contains('wsConn') ? r.dataset.n === s.name : !s.name);
      r.classList.toggle('sel', !!on);
    }
    const row = s && document.querySelector(`#wsTree .sel`);
    if (row) row.scrollIntoView({ block: 'nearest' });
    if (this.target() || this.modelSlot()) this.attachGizmo();
    else this.detachGizmo();
    if ($('wsCopy')) $('wsCopy').disabled = !(s && s.name && mirrorOf(s));
    this.renderDetail();
    this.ws.updateLabels && this.ws.updateLabels(true);
  }
  // 拖曳／方向鍵的對象：選中連接點＝該連接點（依「只動關節」設定）；選中區塊＝它接上的連接點，
  // 一律「零件跟著動」（移動整個零件與下游的零件）；機體根部沒有可移動的連接點
  // 腿部根區塊（襠部／主體）：組裝調整以核心為準，拖曳它＝整組腿相對核心移動（inverse：反向換算成腰的連接點）
  target(s = this.sel) {
    if (!s || !this.rig || s.name === 'ground' || this.editModel) return null;
    if (s.name) return this.mark(s) ? { s, keep: !!this.settings.keep } : null;
    if (this.rig.ground && s.slot === this.rig.ground.base) {
      const w = this.mark({ slot: s.slot, name: 'waist' });
      return w ? { s: { slot: s.slot, name: 'waist' }, keep: false, inverse: true } : null;
    }
    const pm = this.parentMark(s.slot);
    return pm ? { s: { slot: pm.slot, name: pm.name }, keep: false } : null;
  }
  // 腿部根區塊在核心（torso 關節群組）座標裡的矩陣 X＝(W·T)⁻¹；W＝腰的連接點、T＝torso 的區域變換。
  // 把手放在腰（不是腿的原點＝腳底）：回傳 Y＝X·P，P＝平移到腰在腿座標裡的位置（記在 waistPivot，
  // 拖曳中不變），所以旋轉以腰為中心
  legsInCore(W) {
    this.rig.torso.updateMatrix();
    this.waistPivot = new THREE.Matrix4().copyPosition(W);
    return W.clone().multiply(this.rig.torso.matrix).invert().multiply(this.waistPivot);
  }
  // 由 Y 反推腰的連接點：X＝Y·P⁻¹、W＝X⁻¹·T⁻¹
  waistFromLegs(Y) {
    this.rig.torso.updateMatrix();
    const X = Y.clone().multiply(this.waistPivot.clone().invert());
    return X.invert().multiply(this.rig.torso.matrix.clone().invert());
  }
  attachGizmo() {
    const ms = this.modelSlot();
    if (ms) {
      const obj = this.rig.pieces[ms];
      if (!obj || !this.tc) return this.detachGizmo();
      obj.parent.add(this.frame);
      this.resetProxy();
      this.tc.attach(this.proxy);
      return;
    }
    const t = this.target();
    const m = t && this.mark(t.s);
    if (!m || !this.tc) return this.detachGizmo();
    (t.inverse ? this.rig.torso : m.node.parent).add(this.frame);
    this.syncProxy();
    this.tc.attach(this.proxy);
  }
  detachGizmo() {
    if (this.tc) this.tc.detach();
    if (this.frame.parent) this.frame.parent.remove(this.frame);
  }
  syncProxy() {
    const t = this.target();
    const m = t && this.mark(t.s);
    if (!m) return;
    m.node.updateMatrix();
    const v = t.inverse
      ? valOf(this.legsInCore(m.node.matrix))
      : gameToGltf(m.node.position, m.node.rotation);
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
      if (!h.object.isMesh || h.object.material === OUTLINE_MAT) return false;
      for (let o = h.object; o; o = o.parent) if (o.userData.helper || !o.visible) return false;
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
  // 只改畫面上的連接點群組（拖曳中的即時預覽）；ground＝腿部根區塊的離地微調
  setConn(s, val) {
    if (s.name === 'ground') {
      refreshGround(this.rig);
      return;
    }
    const m = this.mark(s);
    if (m) {
      const g = gltfToGame(val);
      m.node.position.copy(g.p);
      m.node.rotation.copy(g.r);
    }
    const t = this.target();
    if (t && same(s, t.s) && !this.dragging) this.syncProxy();
    this.ws.updateConnRow(s.slot, s.name);
    this.dirty();
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
    for (const { s, ov, keep } of list) {
      const t = mirrorOf(s);
      if (t && !out.some((x) => same(x.s, t))) out.push({ s: t, ov: ov ? mirrorVal(ov) : null, keep });
    }
    return out;
  }

  // ---------- 調整模型：以原點為中心縮放／位移／旋轉，寫回 GLB 的原點節點 ----------
  // 原點節點 W（glTF）把模型放到以關節為原點的位置；調整 T（glTF，原點座標）後 W'＝T·W。
  // 代理物件放在區塊的關節群組裡的 glTF 框，拖曳時它的矩陣就是 T
  modelSlot(s = this.sel) {
    if (!this.editModel || !s || s.name || !this.rig || !this.rig.pieces[s.slot]) return null;
    return this.canKeep(s.slot) ? s.slot : null;
  }
  resetProxy() {
    this.proxy.position.set(0, 0, 0);
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.scale.set(1, 1, 1);
  }
  proxyMat() {
    const q = this.proxy;
    if (this.uniform && this.mode === 'scale') {
      const s = [q.scale.x, q.scale.y, q.scale.z].reduce(
        (a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a),
        1,
      );
      q.scale.setScalar(s);
    }
    return new THREE.Matrix4().compose(q.position, q.quaternion, q.scale);
  }
  // 對稱編輯：另一側（鏡像 T＝S·T·S，S＝X 取負）
  modelList(slot, T) {
    const out = [{ slot, T }];
    if (this.sym) {
      const m = mirrorOf({ slot, name: '' });
      if (m && m.slot !== slot && this.rig.pieces[m.slot] && this.canKeep(m.slot)) {
        const S = new THREE.Matrix4().makeScale(-1, 1, 1);
        out.push({ slot: m.slot, T: S.clone().multiply(T).multiply(S) });
      }
    }
    return out;
  }
  modelPreview() {
    const slot = this.modelSlot();
    if (!slot) return;
    for (const x of this.modelList(slot, this.proxyMat()))
      this.setPivotLive(x.slot, x.T.clone().multiply(this.originOf(x.slot)).toArray());
    this.writeModelDetail();
  }
  async commitModel(T, slot = this.modelSlot()) {
    if (!slot) return;
    const items = this.modelList(slot, T).map((x) => {
      const W = this.originOf(x.slot);
      return { pivot: x.slot, before: W.toArray(), after: x.T.clone().multiply(W).toArray() };
    });
    this.resetProxy();
    if (items.every((i) => i.before.every((v, k) => Math.abs(v - i.after[k]) < 1e-9))) return;
    this.undo.push({ key: null, t: performance.now(), items });
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    for (const i of items) await this.applyItem(i, i.after);
    this.changed();
    this.writeModelDetail();
  }
  // 數值輸入（增量）：等比縮放 %、位移 cm、旋轉 °
  applyModelInputs() {
    const box = $('wsDetail');
    const g = (k) => parseFloat((box.querySelector(`[data-mk="${k}"]`) || {}).value) || 0;
    const s = (box.querySelector('[data-mk="s"]') || {}).value;
    const k = Number.isFinite(parseFloat(s)) && parseFloat(s) > 0 ? parseFloat(s) / 100 : 1;
    const T = new THREE.Matrix4().compose(
      new THREE.Vector3(g('x'), g('y'), g('z')).multiplyScalar(0.01),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(g('rx') * D2R, g('ry') * D2R, g('rz') * D2R)),
      new THREE.Vector3(k, k, k),
    );
    for (const inp of box.querySelectorAll('[data-mk]')) inp.value = inp.dataset.mk === 's' ? 100 : 0;
    return this.commitModel(T);
  }
  writeModelDetail() {
    const el = $('wsDetail').querySelector('.wsMcur');
    const slot = this.modelSlot();
    if (!el || !slot) return;
    const T = this.dragging ? this.proxyMat() : new THREE.Matrix4();
    const W = T.multiply(this.originOf(slot));
    const p = new THREE.Vector3(),
      q = new THREE.Quaternion(),
      s = new THREE.Vector3();
    W.decompose(p, q, s);
    const r = (v) => Math.round(v * 1000) / 1000;
    el.textContent =
      Math.abs(s.x - s.y) < 1e-4 && Math.abs(s.y - s.z) < 1e-4
        ? `模型目前的縮放 ×${r(s.x)}（相對 GLB 原檔）`
        : `模型目前的縮放 ×${r(s.x)}／${r(s.y)}／${r(s.z)}（相對 GLB 原檔）`;
  }
  modelDetailHtml(slot) {
    if (!this.canKeep(slot))
      return `<div class="wsModel small dim">這個區塊是程式模型或暫用另一側的 GLB：先放入它自己的 GLB 才能調整模型</div>`;
    const f = (k, label, v, step) =>
      `<label>${label}<input type="number" step="${step}" data-mk="${k}" value="${v}"></label>`;
    return (
      `<div class="wsModel"><div class="small"><b>調整模型</b>：拖曳畫面上的箭頭（移動）、旋轉環或方塊（縮放），或輸入增量後套用；以原點（關節）為中心，原點與連接點不變</div>` +
      `<div class="small wsMcur"></div>` +
      `<div class="jgrid">` +
      f('s', '縮放 %', 100, 1) +
      f('x', 'X cm', 0, 0.5) +
      f('y', 'Y cm', 0, 0.5) +
      f('z', 'Z cm', 0, 0.5) +
      f('rx', '旋轉 X°', 0, 1) +
      f('ry', 'Y°', 0, 1) +
      f('rz', 'Z°', 0, 1) +
      `</div><div class="wsDf"><button data-act="mapply">套用</button><span class="small dim">對稱編輯開啟時另一側一起改；可復原</span></div></div>`
    );
  }

  // ---------- 只動關節：子區塊不動，改它的原點 ----------
  // 子區塊有自己的 GLB（不是程式模型、也不是暫用另一側的檔案）才能改原點
  canKeep(slot) {
    return this.ws.glbSlots.has(slot) && !this.ws.store.source(slot).fallback;
  }
  // 存檔中的連接點值（不含拖曳中的畫面）：瀏覽器暫存＞內建＞預設
  storedVal(s) {
    return this.ovOf(s) || this.ws.defaultConn(s.slot, s.name);
  }
  // 槽位 GLB 目前的原點節點矩陣（glTF）；沒有原點節點時為單位矩陣
  originOf(slot) {
    const src = this.ws.store.source(slot);
    const a = src.kind === 'glb' ? readOrigin(src.buf) : null;
    return a ? new THREE.Matrix4().fromArray(a) : new THREE.Matrix4();
  }
  // 一次修改要寫入的所有項目：list＝[{ s, ov, keep }]（keep 未指定時依「只動關節」設定）。
  // 只動關節時，連接點從 v0 改成 v1，子區塊的 D＝M1⁻¹·M0（靜止姿勢下子區塊位置不變）：
  // 子區塊的原點（GLB 原點節點）與子區塊自己的連接點都套用 D
  plan(list) {
    const items = [];
    for (const { s, ov, keep } of list) {
      items.push({ s, before: this.ovOf(s), after: ov });
      if (!(keep === undefined ? this.settings.keep : keep) || s.name === 'ground') continue;
      const m = this.mark(s);
      const child = m && this.childSlot(m);
      if (!child || !this.canKeep(child)) continue;
      const D = matOf(ov || this.ws.defaultConn(s.slot, s.name))
        .invert()
        .multiply(matOf(this.storedVal(s)));
      for (const cm of this.marks) {
        if (cm.slot !== child) continue;
        const cs = { slot: child, name: cm.name };
        items.push({
          s: cs,
          before: this.ovOf(cs),
          after: valOf(D.clone().multiply(matOf(this.storedVal(cs)))),
        });
      }
      const W0 = this.originOf(child);
      items.push({
        pivot: child,
        before: W0.toArray(),
        after: FLIP.clone().multiply(D).multiply(FLIP).multiply(W0).toArray(),
      });
    }
    return items;
  }
  // 畫面上的區塊換成原點矩陣 W（glTF）：場景根部的變換＝F·W·W0⁻¹·F（W0＝建立畫面時檔案裡的原點）
  setPivotLive(slot, arr) {
    const obj = this.rig && this.rig.pieces[slot];
    if (!obj) return;
    const W = new THREE.Matrix4().fromArray(arr);
    const R = FLIP.clone()
      .multiply(W)
      .multiply((this.origin0[slot] || new THREE.Matrix4()).clone().invert())
      .multiply(FLIP);
    R.decompose(obj.position, obj.quaternion, obj.scale);
    this.dirty();
  }
  // 把原點寫回槽位的 GLB（只改 JSON 區塊；內建 GLB 會存成瀏覽器暫存的複本）
  async applyPivot(slot, arr) {
    this.setPivotLive(slot, arr);
    const store = this.ws.store;
    const src = store.source(slot);
    if (src.kind !== 'glb') return;
    const rec = store.local.get(slot);
    await store.putBuf(
      slot,
      rec ? rec.name : src.name.split('/').pop(),
      writeOrigin(src.buf, arr),
      rec && rec.orig ? rec.orig : null,
    );
    this.savedSlots.add(slot);
  }
  applyItem(i, val) {
    return i.pivot ? this.applyPivot(i.pivot, val) : this.applyOv(i.s, val);
  }
  // 拖曳中的即時預覽（不寫入）
  preview(list) {
    for (const i of this.plan(list))
      if (i.pivot) this.setPivotLive(i.pivot, i.after);
      else this.setConn(i.s, i.after || this.ws.defaultConn(i.s.slot, i.s.name));
  }
  // 一次修改：list＝[{ s, ov, keep }]；記錄復原（mergeKey 相同且間隔很短的連續修改合併成一步，例如方向鍵、打字）
  async commit(list, mergeKey) {
    const items = this.plan(list);
    if (items.every((i) => JSON.stringify(i.before) === JSON.stringify(i.after))) {
      for (const i of items)
        if (i.pivot) this.setPivotLive(i.pivot, i.after);
        else this.setConn(i.s, i.after || this.ws.defaultConn(i.s.slot, i.s.name));
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
    for (const i of items) await this.applyItem(i, i.after);
    this.changed();
  }
  async step(back) {
    const e = (back ? this.undo : this.redo).pop();
    if (!e) return this.ws.toast(back ? '沒有可以復原的修改' : '沒有可以重做的修改', true);
    (back ? this.redo : this.undo).push(e);
    for (const i of e.items) await this.applyItem(i, back ? i.before : i.after);
    this.changed();
  }
  changed() {
    refreshGround(this.rig);
    this.writeDetail();
    this.renderUndo();
    clearTimeout(this.timers.notify);
    this.timers.notify = setTimeout(() => {
      if (this.ws.onJoints) this.ws.onJoints();
      for (const slot of this.savedSlots) if (this.ws.onSaved) this.ws.onSaved(slot);
      this.savedSlots.clear();
    }, 300);
  }
  fromProxy() {
    if (this.modelSlot()) return this.modelPreview();
    const t = this.target();
    if (!t) return;
    const q = this.proxy;
    let val = {
      p: [q.position.x, q.position.y, q.position.z].map((v) => Math.round(v * 1000) / 1000),
      r: [q.rotation.x, q.rotation.y, q.rotation.z].map((v) => Math.round((v / D2R) * 100) / 100),
    };
    if (t.inverse) val = valOf(this.waistFromLegs(matOf(val)));
    this.preview(this.withMirror([{ s: t.s, ov: val, keep: t.keep }]));
    if (t.inverse && this.anchor) this.holdCore();
    this.writeDetail(val);
  }
  // 拖曳腿部根區塊時：移動 lift，讓核心（torso）的世界矩陣維持拖曳開始時的值
  holdCore() {
    const rig = this.rig;
    rig.group.updateMatrixWorld(true);
    const delta = this.anchor.clone().multiply(rig.torso.matrixWorld.clone().invert());
    const liftW = delta.multiply(rig.lift.matrixWorld);
    const local = rig.lift.parent.matrixWorld.clone().invert().multiply(liftW);
    local.decompose(rig.lift.position, rig.lift.quaternion, new THREE.Vector3());
    rig.group.updateMatrixWorld(true);
    this.dirty();
  }
  commitDrag() {
    if (this.modelSlot()) return this.commitModel(this.proxyMat());
    const t = this.target();
    if (!t) return;
    this.commit(this.withMirror([{ s: t.s, ov: this.current(t.s), keep: t.keep }]));
  }
  // 方向鍵微調（glTF 軸）：←→ X、↑↓ Y、PageUp／PageDown Z；旋轉模式改成繞該軸轉
  nudge(axis, dir, big) {
    const t = this.target();
    if (!t) return;
    const s = t.s;
    // 腿部根區塊：微調的是它在核心座標裡的位置，再反算成腰的連接點
    let v = t.inverse ? valOf(this.legsInCore(matOf(this.valueOf(s)))) : this.valueOf(s);
    const st = this.settings;
    if (this.mode === 'rotate') v.r[axis] = round(v.r[axis] + dir * (big ? st.rotBig : st.rot), 100);
    else v.p[axis] = round(v.p[axis] + (dir * (big ? st.moveBig : st.move)) / 100, 1000);
    if (t.inverse) v = valOf(this.waistFromLegs(matOf(v)));
    this.commit(this.withMirror([{ s, ov: v, keep: t.keep }]), 'key|' + s.slot + s.name);
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
      const g = this.rig && this.rig.ground;
      const isBase = g && g.base === s.slot;
      box.innerHTML =
        `<div class="wsDh"><b>${escHtml(label(s.slot))}</b><span class="dim small">${escHtml(s.slot)}</span></div>` +
        (parent
          ? `<div class="small">接在：<button class="link" data-slot="${parent.slot}" data-n="${parent.name}">${escHtml(label(parent.slot))}的${escHtml(CONN_NAMES[parent.name] || parent.name)}</button></div>` +
            `<div class="small dim">拖曳箭頭（或方向鍵）移動整個零件，下游的零件一起移動（改的是${escHtml(CONN_NAMES[parent.name] || parent.name)}連接點）</div>`
          : isBase && this.target()
            ? `<div class="small">接在：<button class="link" data-slot="${s.slot}" data-n="waist">核心的${escHtml(CONN_NAMES.waist || 'waist')}</button></div>` +
              `<div class="small dim">組裝調整以核心為準：拖曳箭頭（或方向鍵）移動整組腿，核心不動（改的是腰的連接點，放開後自動貼地）</div>`
            : `<div class="small dim">機體根部（地面）</div>`) +
        (own.length
          ? `<div class="small">此區塊的連接點：${own.map((m) => `<button class="link" data-slot="${m.slot}" data-n="${m.name}">${escHtml(CONN_NAMES[m.name] || m.name)}</button>`).join('')}</div>`
          : `<div class="small dim">此區塊沒有連接點</div>`) +
        (this.editModel ? this.modelDetailHtml(s.slot) : '') +
        (isBase
          ? `<div class="wsGround"><div class="small">自動貼地：<span class="gAuto"></span></div>` +
            `<div class="wsDf"><label class="small">離地微調 <input type="number" step="0.5" id="wsGroundFine"> cm</label>` +
            `<button data-act="greset">重設</button></div></div>`
          : '');
      const ma = box.querySelector('[data-act=mapply]');
      if (ma) ma.onclick = () => this.applyModelInputs();
      this.writeModelDetail();
      if (isBase) {
        $('wsGroundFine').onchange = () => {
          const cm = parseFloat($('wsGroundFine').value);
          if (!Number.isFinite(cm)) return;
          const y = Math.round(cm * 10) / 1000;
          this.commit([
            { s: { slot: s.slot, name: 'ground' }, ov: y ? { p: [0, y, 0], r: [0, 0, 0] } : null },
          ]);
        };
        box.querySelector('[data-act=greset]').onclick = () =>
          this.commit([{ s: { slot: s.slot, name: 'ground' }, ov: null }]);
        this.writeDetail();
      }
    } else {
      const m = this.mark(s);
      const child = m && this.childSlot(m);
      const keepNote = !child
        ? ''
        : !this.settings.keep
          ? `零件跟著動：${label(child)}與下游的零件一起移動`
          : this.canKeep(child)
            ? `只動關節：${label(child)}不動，只改轉軸（原點自動寫回它的 GLB）`
            : `${label(child)}是程式模型，不能改原點：關節移動時零件會跟著動`;
      box.innerHTML =
        `<div class="wsDh"><b>${escHtml(CONN_NAMES[s.name] || s.name)}</b><span class="dim small">${escHtml(label(s.slot))}・${escHtml(s.slot)}</span></div>` +
        (child
          ? `<div class="small">接在這裡：<button class="link" data-slot="${child}">${escHtml(label(child))}</button></div>`
          : '') +
        (keepNote ? `<div class="small keepNote">${escHtml(keepNote)}</div>` : '') +
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
    if (!s) return;
    const box = $('wsDetail');
    if (!s.name) {
      // 腿部根區塊：自動貼地的位移與離地微調
      const g = this.rig && this.rig.ground;
      const a = box.querySelector('.gAuto');
      if (!g || !a) return;
      a.textContent = g.auto
        ? `${g.auto > 0 ? '上移' : '下移'} ${Math.abs(g.auto * 100).toFixed(1)} cm（腿的最低點和程式模型同高）`
        : '不需要位移';
      const fi = $('wsGroundFine');
      if (document.activeElement !== fi) fi.value = Math.round(g.fine * 1000) / 10;
      box.querySelector('[data-act=greset]').disabled = !g.fine;
      return;
    }
    const v = this.current(s);
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
    this.applyDisplay();
    this.colorMarks();
    if (!this.settings.check) {
      this.flags = new Set();
      this.colorMarks();
      if ($('wsChecks')) $('wsChecks').innerHTML = '<div class="small dim">穿幫提示已關閉</div>';
    } else this.dirty();
  }
  applySnap() {
    if (!this.tc) return;
    const st = this.settings;
    this.tc.setTranslationSnap(st.snap ? st.snapMove / 100 : null);
    this.tc.setRotationSnap(st.snap ? st.snapRot * D2R : null);
  }
}
