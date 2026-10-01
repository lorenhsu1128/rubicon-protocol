// 關節設定編輯器（檢視窗內）：調整目前區塊的連接點位置與旋轉。
// - 畫面上：點選連接點（或按清單的「選取」）後拖曳三軸箭頭移動；箭頭方向用 glTF 軸（X 紅、Y 綠＝上、Z 藍＝正面）
// - 數值：位置（公尺）與旋轉（角度）都是 glTF 座標，與 GLB、joints.json 相同
// - 修改存在瀏覽器（GlbStore.setJoint），組合預覽與完整機甲立即套用；匯出 joints.json 後才會進遊戲
import { escHtml } from '../core/html.js';
import { CONN_NAMES, connOf } from '../render/mech-model.js';
import { gameToGltf, gltfToGame } from '../render/mech-joints.js';

const $ = (id) => document.getElementById(id);
const ORIGIN_TEXT = { browser: '已修改（瀏覽器暫存）', builtin: '內建 joints.json', default: '程式預設值' };
const FIELDS = [
  ['p', 0, 'X'],
  ['p', 1, 'Y'],
  ['p', 2, 'Z'],
  ['r', 0, 'X'],
  ['r', 1, 'Y'],
  ['r', 2, 'Z'],
];

export class JointEditor {
  // orbit：OrbitControls（拖曳箭頭時暫停）；onChange()：設定寫入後通知模型庫（重建完整機甲的格子）
  constructor({ scene, camera, canvas, orbit, store, onChange }) {
    this.store = store;
    this.onChange = onChange;
    this.camera = camera;
    this.canvas = canvas;
    this.edits = [];
    this.sel = null;
    this.timers = {};
    // glTF 座標框：繞 Y 轉 180°，代理物件在這個框裡的位置就是 glTF 座標，拖曳箭頭也沿 glTF 軸
    this.frame = new THREE.Group();
    this.frame.rotation.y = Math.PI;
    this.proxy = new THREE.Group();
    this.frame.add(this.proxy);
    this.tc = null;
    if (THREE.TransformControls) {
      const tc = new THREE.TransformControls(camera, canvas);
      tc.setSpace('local');
      tc.setSize(0.8);
      tc.addEventListener('dragging-changed', (e) => {
        orbit.enabled = !e.value;
        this.dragging = e.value;
      });
      tc.addEventListener('objectChange', () => this.fromProxy());
      scene.add(tc);
      this.tc = tc;
    }
    // 點選連接點標記（滑鼠按下與放開位置相近才算點擊，避免和旋轉視角衝突）
    let down = null;
    canvas.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    canvas.addEventListener('pointerup', (e) => {
      if (!down || this.dragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      this.pick(e);
    });
  }
  // edits：[{ name, target, marker }]；target 的位置與旋轉＝連接點（遊戲座標，相對於區塊原點）
  bind(entry, edits, note) {
    this.unbind();
    this.entry = entry;
    this.slot = entry.id;
    this.edits = edits;
    this.render(note);
  }
  unbind() {
    if (this.tc) this.tc.detach();
    if (this.frame.parent) this.frame.parent.remove(this.frame);
    this.edits = [];
    this.sel = null;
  }
  render(note) {
    const box = $('insJoints');
    if (!this.edits.length) {
      box.innerHTML = `<div class="dim small">${escHtml(note || '此區塊沒有連接點')}</div>`;
      return;
    }
    box.innerHTML =
      this.edits
        .map(
          (ed) =>
            `<div class="jrow" data-n="${ed.name}">` +
            `<div class="jhead"><b>${escHtml(CONN_NAMES[ed.name] || ed.name)}</b>` +
            `<span class="jsrc dim small"></span>` +
            `<button data-act="sel" title="在畫面上用箭頭拖曳">選取</button>` +
            `<button data-act="reset" title="移除瀏覽器暫存的修改">重設</button></div>` +
            `<div class="jgrid"><span class="dim">位置 m</span>` +
            FIELDS.slice(0, 3)
              .map(([k, i, a]) => this.field(k, i, a, 0.01))
              .join('') +
            `<span class="dim">旋轉 °</span>` +
            FIELDS.slice(3)
              .map(([k, i, a]) => this.field(k, i, a, 1))
              .join('') +
            `</div></div>`,
        )
        .join('') +
      `<div class="dim small">數值為 glTF 座標（Y 朝上、+Z 為正面）。修改存在這個瀏覽器；按下方「匯出關節設定」，` +
      `把 joints.json 放到 src/assets/models/ 重新建置後，遊戲才會套用。</div>`;
    for (const row of box.querySelectorAll('.jrow')) {
      const name = row.dataset.n;
      row.querySelector('[data-act=sel]').onclick = () => this.select(name);
      row.querySelector('[data-act=reset]').onclick = () => this.reset(name);
      for (const inp of row.querySelectorAll('input')) inp.oninput = () => this.fromInputs(name);
      this.writeRow(name);
    }
  }
  field(k, i, a, step) {
    return `<label><i class="ax-${a.toLowerCase()}">${a}</i><input type="number" step="${step}" data-k="${k}" data-i="${i}"></label>`;
  }
  edit(name) {
    return this.edits.find((e) => e.name === name);
  }
  row(name) {
    return $('insJoints').querySelector(`.jrow[data-n="${name}"]`);
  }
  // 目前值（glTF 座標）寫進輸入框與來源說明
  writeRow(name) {
    const ed = this.edit(name),
      row = this.row(name);
    if (!ed || !row) return;
    const v = gameToGltf(ed.target.position, ed.target.rotation);
    for (const inp of row.querySelectorAll('input')) {
      if (document.activeElement === inp) continue;
      inp.value = v[inp.dataset.k][+inp.dataset.i];
    }
    const o = this.store.jointOrigin(this.slot, name);
    const src = row.querySelector('.jsrc');
    src.textContent = ORIGIN_TEXT[o];
    src.classList.toggle('mod', o === 'browser');
    row.querySelector('[data-act=reset]').disabled = o !== 'browser';
  }
  select(name) {
    this.sel = name;
    for (const r of $('insJoints').querySelectorAll('.jrow')) r.classList.toggle('sel', r.dataset.n === name);
    const ed = this.edit(name);
    if (!ed || !this.tc) return;
    ed.target.parent.add(this.frame);
    this.syncProxy();
    this.tc.attach(this.proxy);
  }
  syncProxy() {
    const ed = this.edit(this.sel);
    if (!ed) return;
    const p = ed.target.position;
    this.proxy.position.set(-p.x, p.y, -p.z);
  }
  pick(e) {
    if (!this.edits.length) return;
    const r = this.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      this.camera,
    );
    const meshes = this.edits.map((ed) => ed.marker && ed.marker.children[0]).filter(Boolean);
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit) this.select(this.edits.find((ed) => ed.marker && ed.marker.children[0] === hit.object).name);
  }
  // 拖曳箭頭：代理物件的位置（glTF）→ 連接點
  fromProxy() {
    const ed = this.edit(this.sel);
    if (!ed) return;
    const q = this.proxy.position;
    ed.target.position.set(-q.x, q.y, -q.z);
    this.save(ed.name);
  }
  // 輸入框 → 連接點
  fromInputs(name) {
    const ed = this.edit(name),
      row = this.row(name);
    if (!ed || !row) return;
    const v = { p: [0, 0, 0], r: [0, 0, 0] };
    for (const inp of row.querySelectorAll('input')) {
      const n = parseFloat(inp.value);
      if (!Number.isFinite(n)) return;
      v[inp.dataset.k][+inp.dataset.i] = n;
    }
    const g = gltfToGame(v);
    ed.target.position.copy(g.p);
    ed.target.rotation.copy(g.r);
    if (this.sel === name) this.syncProxy();
    this.save(name);
  }
  // 寫入瀏覽器暫存（記憶體立即生效，IndexedDB 與格子重建稍後一起做）
  save(name) {
    const ed = this.edit(name);
    const slot = this.slot;
    const val = gameToGltf(ed.target.position, ed.target.rotation);
    this.store.joints[slot] = { ...(this.store.joints[slot] || {}), [name]: val };
    this.writeRow(name);
    clearTimeout(this.timers[slot + name]);
    this.timers[slot + name] = setTimeout(async () => {
      await this.store.setJoint(slot, name, val);
      if (this.onChange) this.onChange(slot);
    }, 300);
  }
  async reset(name) {
    const slot = this.slot;
    clearTimeout(this.timers[slot + name]);
    await this.store.setJoint(slot, name, null);
    const ed = this.edit(name);
    if (ed && this.entry.piece) {
      const c = connOf(this.entry.piece, name);
      ed.target.position.copy(c.p);
      ed.target.rotation.copy(c.r);
      if (this.sel === name) this.syncProxy();
    }
    this.writeRow(name);
    if (this.onChange) this.onChange(slot);
  }
}
