// 組裝調整頁（模型庫的「組裝調整」頁籤）：自由選擇各部位零件預組一台機甲，在整台機甲上逐一調整每個區塊的連接點。
// - 左：零件（每個部位的零件＋各區塊的來源切換）、預組（從現有機甲載入、命名儲存、匯出／匯入）
// - 中：3D 機甲（拉直靜止姿勢＋動作預覽，可暫停並拖曳時間軸停在任一幀）
// - 右：依組裝層級列出所有區塊與連接點
// 連接點的修改和區塊檢視窗共用同一份關節設定（GlbStore.joints，存在瀏覽器，可匯出 joints.json）。
import { escHtml } from '../core/html.js';
import { PARTS, START_ASM, partById } from '../data/parts.js';
import { PALETTES } from '../render/materials.js';
import {
  CONN_NAMES,
  PIECE_NAMES,
  SIDE_NAMES,
  animateMech,
  partPieces,
  pieceConns,
} from '../render/mech-model.js';
import { builtinJoints, gameToGltf } from '../render/mech-joints.js';
import { MODEL_CATALOG } from '../render/model-catalog.js';
import { buildGrid } from './refs.js';
import { WsEditor } from './workshop-edit.js';
import {
  ANIMS,
  addLights,
  animState,
  applyLight,
  buildMechWithGlb,
  disposeObject,
  fitCamera,
  makeRenderer,
} from './stage.js';

const $ = (id) => document.getElementById(id);
// 左側零件欄：組裝鍵、名稱、零件清單、partPieces 的分類
export const WS_SLOTS = [
  ['head', '頭部', 'head', 'head'],
  ['core', '核心', 'core', 'core'],
  ['arms', '手臂', 'arms', 'arms'],
  ['legs', '腳部', 'legs', 'legs'],
  ['booster', '背包（推進器）', 'booster', 'booster'],
  ['rarm', '右手武器', 'arm', 'weapon'],
  ['larm', '左手武器', 'arm', 'weapon'],
  ['rback', '右肩武器', 'back', 'back'],
  ['lback', '左肩武器', 'back', 'back'],
];
const SIDE_KEY = { rarm: 'r', larm: 'l', rback: 'r', lback: 'l' };
export const WS_ANIMS = [['rest', '拉直靜止姿勢'], ...ANIMS];
const LOOP = 4; // 時間軸長度（秒）
const STEP = 1 / 60;

// 組裝鍵 → 這個部位的區塊（武器只取該側）
export function slotPieces(key, asm) {
  const [, , list, cat] = WS_SLOTS.find((s) => s[0] === key);
  const part = partById(list, asm[key]);
  if (!part) return [];
  const all = partPieces(cat, part);
  return SIDE_KEY[key] ? all.filter((i) => i.key === SIDE_KEY[key]) : all;
}
const pieceLabel = (info) => (info.key ? SIDE_NAMES[info.key] : '') + (PIECE_NAMES[info.kind] || info.kind);
// 只保留目前零件表裡存在的零件（匯入的預組可能來自舊版）
export function sanitizeAsm(asm) {
  const out = { ...START_ASM };
  for (const [key, , list] of WS_SLOTS) if (asm && partById(list, asm[key])) out[key] = asm[key];
  return out;
}

// 拉直靜止姿勢：所有關節角度歸零、四肢下垂
export function restPose(rig) {
  rig.group.rotation.set(0, 0, 0);
  rig.legsG.position.set(0, 0, 0);
  rig.legsG.rotation.set(0, 0, 0);
  for (const L of rig.legs) {
    L.thigh.rotation.set(0, 0, 0);
    L.knee.rotation.set(0, 0, 0);
    L.foot.rotation.set(0, 0, 0);
  }
  rig.torso.position.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.torsoTwist = 0;
  rig.head.rotation.set(0, 0, 0);
  for (const a of Object.values(rig.arms)) {
    a.up.rotation.set(0, 0, 0);
    a.fore.rotation.set(0, 0, 0);
  }
  rig.thrust = 0;
}

export class Workshop {
  // onJoints(slot)：連接點修改後通知模型庫；onSaved(slot)：區塊的 GLB 改寫（原點）後通知模型庫；toast(text, bad)：提示訊息
  constructor({ store, onJoints, onSaved, onClose, toast }) {
    this.store = store;
    this.onJoints = onJoints;
    this.onSaved = onSaved;
    this.glbSlots = new Set(); // 目前畫面上用 GLB 的槽位
    this.onClose = onClose;
    this.toast = toast;
    this.asm = { ...START_ASM };
    this.srcOff = new Set(); // 強制用程式模型的槽位
    this.anim = 'rest';
    this.t = 0;
    this.playing = false;
    this.open_ = false;
    this.tok = 0;
    this.rig = null;
    this.canvas = $('wsGl');
    this.renderer = makeRenderer(this.canvas, true);
    this.scene = new THREE.Scene();
    this.lights = addLights(this.scene);
    this.lights.sun.castShadow = true;
    this.lights.sun.shadow.mapSize.set(2048, 2048);
    applyLight(this.scene, this.lights, null);
    const sc = this.lights.sun.shadow.camera;
    sc.left = sc.bottom = -8;
    sc.right = sc.top = 8;
    sc.far = 60;
    this.lights.sun.position.set(6, 14, -8);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor, buildGrid(new THREE.Vector3(4, 4, 4)));
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 2000);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.setupUi();
    this.edit = new WsEditor(this);
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  // ---------- 開關 ----------
  async open() {
    $('workshop').hidden = false;
    this.open_ = true;
    this.renderPresets();
    await this.rebuild(true);
  }
  close() {
    $('workshop').hidden = true;
    this.open_ = false;
    if (this.onClose) this.onClose();
  }

  // ---------- 介面 ----------
  setupUi() {
    $('wsBack').onclick = () => this.close();
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open_ && !e.target.closest('input,select,textarea')) this.close();
    });
    // 從現有機甲載入
    const mechs = MODEL_CATALOG.filter((e) => e.cat === 'mech');
    $('wsFrom').innerHTML =
      `<option value="">從現有機甲載入…</option>` +
      mechs.map((e) => `<option value="${escHtml(e.id)}">${escHtml(e.name)}</option>`).join('');
    $('wsFrom').onchange = () => {
      const e = mechs.find((m) => m.id === $('wsFrom').value);
      $('wsFrom').value = '';
      if (!e) return;
      this.asm = sanitizeAsm(e.asm);
      $('wsPresetName').value = e.name;
      this.rebuild(true);
    };
    // 預組
    $('wsSavePreset').onclick = async () => {
      const name = $('wsPresetName').value.trim();
      if (!name) return this.toast('請先輸入預組名稱', true);
      await this.store.putPreset(name, this.asm);
      this.renderPresets(name);
      this.toast(`已儲存預組「${name}」`);
    };
    $('wsLoadPreset').onclick = () => {
      const p = this.store.presets.get($('wsPresets').value);
      if (!p) return;
      this.asm = sanitizeAsm(p.asm);
      $('wsPresetName').value = p.name;
      this.rebuild(true);
    };
    $('wsDelPreset').onclick = async () => {
      const name = $('wsPresets').value;
      if (!name || !confirm(`刪除預組「${name}」？`)) return;
      await this.store.removePreset(name);
      this.renderPresets();
    };
    $('wsExport').onclick = () => this.exportPresets();
    $('wsImport').onclick = () => $('wsImportFile').click();
    $('wsImportFile').onchange = async () => {
      const f = $('wsImportFile').files[0];
      $('wsImportFile').value = '';
      if (f) await this.importPresets(f);
    };
    // 動作與時間軸
    $('wsAnims').innerHTML = WS_ANIMS.map(([k, n]) => `<button data-a="${k}">${n}</button>`).join('');
    for (const b of $('wsAnims').querySelectorAll('button'))
      b.onclick = () => {
        this.anim = b.dataset.a;
        this.t = 0;
        this.playing = this.anim !== 'rest';
        this.applyPose();
        this.markAnim();
      };
    $('wsPlay').onclick = () => {
      if (this.anim === 'rest') return;
      this.playing = !this.playing;
      if (!this.playing) this.applyPose();
      this.markAnim();
    };
    $('wsTime').oninput = () => {
      this.playing = false;
      this.t = +$('wsTime').value;
      this.applyPose();
      this.markAnim();
    };
    this.markAnim();
  }
  markAnim() {
    for (const b of $('wsAnims').querySelectorAll('button'))
      b.classList.toggle('sel', b.dataset.a === this.anim);
    const rest = this.anim === 'rest';
    $('wsPlay').disabled = $('wsTime').disabled = rest;
    $('wsPlay').textContent = this.playing ? '❚❚ 暫停' : '▶ 播放';
    $('wsTime').value = this.t;
    $('wsTimeText').textContent = rest ? '靜止' : `${this.t.toFixed(2)} s`;
  }
  renderPresets(sel) {
    const list = [...this.store.presets.values()].sort((a, b) => a.name.localeCompare(b.name));
    $('wsPresets').innerHTML = list.length
      ? list.map((p) => `<option value="${escHtml(p.name)}">${escHtml(p.name)}</option>`).join('')
      : `<option value="">（尚無預組）</option>`;
    if (sel) $('wsPresets').value = sel;
    $('wsLoadPreset').disabled = $('wsDelPreset').disabled = !list.length;
  }
  // 零件欄：每個部位的零件選單＋拆成的區塊（來源與切換）
  renderParts() {
    $('wsParts').innerHTML = WS_SLOTS.map(([key, name, list]) => {
      const opts = PARTS[list]
        .map(
          (p) =>
            `<option value="${p.id}"${p.id === this.asm[key] ? ' selected' : ''}>${escHtml(p.name)}</option>`,
        )
        .join('');
      const pieces = slotPieces(key, this.asm)
        .map((info) => {
          const src = this.store.source(info.slot);
          const glb = src.kind === 'glb';
          const on = glb && !this.srcOff.has(info.slot);
          return (
            `<div class="wsPiece" data-slot="${info.slot}"><span>${escHtml(pieceLabel(info))}</span>` +
            (glb
              ? `<label title="切換這一塊用 GLB 或程式模型"><input type="checkbox" data-src="${info.slot}"${on ? ' checked' : ''}> GLB${src.fallback ? '（右側）' : ''}</label>`
              : `<span class="badge">程式模型</span>`) +
            `</div>`
          );
        })
        .join('');
      return `<div class="wsSlot"><label>${name}<select data-k="${key}">${opts}</select></label>${pieces}</div>`;
    }).join('');
    for (const s of $('wsParts').querySelectorAll('select'))
      s.onchange = () => {
        this.asm[s.dataset.k] = s.value;
        this.rebuild(false);
      };
    for (const r of $('wsParts').querySelectorAll('.wsPiece'))
      r.onclick = (e) => {
        if (!e.target.closest('label')) this.edit.select({ slot: r.dataset.slot });
      };
    for (const c of $('wsParts').querySelectorAll('input[data-src]'))
      c.onchange = () => {
        if (c.checked) this.srcOff.delete(c.dataset.src);
        else this.srcOff.add(c.dataset.src);
        this.rebuild(false);
      };
  }

  // ---------- 建立機甲 ----------
  async rebuild(refit) {
    const tok = ++this.tok;
    this.renderParts();
    const { rig, glbSlots, errors } = await buildMechWithGlb(
      this.asm,
      PALETTES.player,
      this.store,
      1,
      (slot) => !this.srcOff.has(slot),
    );
    if (tok !== this.tok) return disposeObject(rig.group);
    if (this.rig) {
      this.scene.remove(this.rig.group);
      disposeObject(this.rig.group);
    }
    this.rig = rig;
    this.glbSlots = new Set(glbSlots);
    this.scene.add(rig.group);
    this.applyPose();
    if (refit || !this.fitted) {
      this.resize(true);
      this.controls.target.copy(
        fitCamera(this.camera, new THREE.Vector3(3, 4.2, 3), this.camera.aspect, 1.5),
      );
      this.controls.update();
      this.fitted = true;
    }
    $('wsInfo').textContent =
      `區塊 ${Object.keys(rig.pieces).length} 塊・GLB ${glbSlots.length} 塊・連接點 ${rig.mounts.length} 個` +
      (errors.length ? `・GLB 讀取失敗 ${errors.length} 塊` : '');
    this.renderTree();
    this.edit.attach(rig);
  }
  // 依目前的動作與時間擺姿勢：從靜止姿勢以固定 60 Hz 模擬到 t，暫停或拖曳時間軸時姿勢可以重現
  applyPose() {
    const rig = this.rig;
    if (!rig) return;
    restPose(rig);
    if (this.anim === 'rest') return;
    const t0 = Math.max(0, this.t - 1.5);
    for (let x = t0; x <= this.t; x += STEP) animateMech(rig, STEP, animState(this.anim, x));
    if (this.edit) this.edit.dirty();
  }

  // ---------- 區塊資訊（給編輯器與清單用）----------
  infoOf(slot) {
    for (const [key] of WS_SLOTS) {
      const info = slotPieces(key, this.asm).find((x) => x.slot === slot);
      if (info) return { info, key };
    }
    return null;
  }
  pieceLabelOf(slot) {
    const f = this.infoOf(slot);
    return f ? pieceLabel(f.info) : slot;
  }
  // 槽位屬於哪個零件：{ part: 零件名稱, cat: 部位名稱 }
  partNameOf(slot) {
    const f = this.infoOf(slot);
    if (!f) return null;
    const [, name, list] = WS_SLOTS.find((s) => s[0] === f.key);
    const p = partById(list, this.asm[f.key]);
    return p ? { part: p.name, cat: name.replace(/（.*）/, '') } : null;
  }
  // 連接點的內建（joints.json）／程式預設值（glTF），不含瀏覽器暫存；重設與沒有暫存時使用
  defaultConn(slot, name) {
    const b = builtinJoints()[slot];
    if (b && b[name]) return { p: [...b[name].p], r: [...(b[name].r || [0, 0, 0])] };
    const f = this.infoOf(slot);
    const c = f && pieceConns(f.info)[name];
    return c ? gameToGltf(c.p, c.r) : { p: [0, 0, 0], r: [0, 0, 0] };
  }

  // ---------- 右側：組裝層級 ----------
  // 每個區塊之下列出它的連接點，連接點之下是接在那裡的子區塊
  renderTree() {
    const rig = this.rig;
    const childOf = new Map(); // 連接點群組 → 子區塊槽位
    for (const [slot, obj] of Object.entries(rig.pieces)) {
      const mount = obj.parent && obj.parent.parent;
      if (mount && mount.userData.conn) childOf.set(mount, slot);
    }
    // 以核心為根顯示（組裝時拿著上半身把腿對上去）：核心 →◆腰→ 襠部／主體 →◆髖 → 腿。
    // 內部仍是腿為根（腰的連接點在襠部上），所以腰這一列列在核心底下、掛的是襠部
    const base = Object.entries(rig.pieces).find(([, o]) => o.parent === rig.legsG)[0];
    const core = (Object.entries(rig.pieces).find(([, o]) => o.parent === rig.torso) || [])[0];
    const rows = [];
    const connRow = (slot, name, depth) =>
      `<div class="wsConn" data-slot="${slot}" data-n="${name}" style="--d:${depth}">` +
      `<span class="cn">◆ ${escHtml(CONN_NAMES[name] || name)}</span><span class="cv"></span></div>`;
    const walk = (slot, depth) => {
      const p = this.partNameOf(slot);
      rows.push(
        `<div class="wsNode" data-slot="${slot}" style="--d:${depth}"><b>${escHtml(this.pieceLabelOf(slot))}</b>` +
          `<span class="dim small">${escHtml(p ? p.part : '')}・${escHtml(slot)}</span></div>`,
      );
      for (const m of rig.mounts.filter((x) => x.slot === slot)) {
        if (core && slot === base && m.name === 'waist') continue;
        rows.push(connRow(slot, m.name, depth + 1));
        const child = childOf.get(m.node);
        if (child) walk(child, depth + 2);
      }
      if (core && slot === core && rig.mounts.some((x) => x.slot === base && x.name === 'waist')) {
        rows.push(connRow(base, 'waist', depth + 1));
        walk(base, depth + 2);
      }
    };
    walk(core || base, 0);
    $('wsTree').innerHTML = rows.join('');
    for (const r of $('wsTree').children) {
      if (r.classList.contains('wsConn')) this.updateConnRow(r.dataset.slot, r.dataset.n);
      r.onclick = () =>
        this.edit.select(
          r.dataset.n ? { slot: r.dataset.slot, name: r.dataset.n } : { slot: r.dataset.slot },
        );
    }
  }
  updateConnRow(slot, name) {
    const r = $('wsTree').querySelector(`.wsConn[data-slot="${slot}"][data-n="${name}"]`);
    const m = this.rig && this.rig.mounts.find((x) => x.slot === slot && x.name === name);
    if (!r || !m) return;
    const v = gameToGltf(m.node.position, m.node.rotation);
    r.querySelector('.cv').textContent =
      v.p.map((n) => n.toFixed(3)).join(', ') +
      (v.r.some((n) => n) ? `　∠ ${v.r.map((n) => n.toFixed(1)).join(', ')}°` : '');
    r.classList.toggle('mod', this.store.jointOrigin(slot, name) === 'browser');
  }
  // 選中的區塊或連接點：在畫面上標出連接點名稱
  updateLabels(rebuild) {
    const box = $('wsLabels');
    if (rebuild) {
      box.innerHTML = '';
      this.labels = [];
      const s = this.edit.sel;
      if (s && this.rig) {
        const parent = !s.name ? this.edit.parentMark(s.slot) : null;
        for (const m of this.edit.marks) {
          if (!(m.slot === s.slot || m === parent)) continue;
          const el = document.createElement('div');
          el.className = 'lbl conn' + (s.name === m.name && m.slot === s.slot ? ' cur' : '');
          el.textContent = CONN_NAMES[m.name] || m.name;
          box.appendChild(el);
          this.labels.push({ el, obj: m.mk });
        }
      }
    }
    const v = new THREE.Vector3();
    for (const l of this.labels || []) {
      l.obj.getWorldPosition(v);
      v.project(this.camera);
      const off = v.z > 1 || v.z < -1 || !l.obj.visible;
      l.el.style.display = off ? 'none' : '';
      if (off) continue;
      l.el.style.left = ((v.x + 1) / 2) * this.w + 'px';
      l.el.style.top = ((1 - v.y) / 2) * this.h + 'px';
    }
  }

  // ---------- 預組匯出／匯入 ----------
  exportPresets() {
    const presets = [...this.store.presets.values()].map((p) => ({ name: p.name, asm: p.asm }));
    if (!presets.length) return this.toast('還沒有儲存任何預組', true);
    const data = {
      format: 'rubicon-mech-presets',
      version: 1,
      exportedAt: new Date().toISOString(),
      presets,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = 'rubicon-mech-presets.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast(`已匯出 ${presets.length} 組預組`);
  }
  async importPresets(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (e) {
      return this.toast('無法讀取：不是有效的 JSON 檔', true);
    }
    const list =
      data && data.format === 'rubicon-mech-presets' && Array.isArray(data.presets) ? data.presets : null;
    if (!list) return this.toast('這不是組裝調整的預組檔', true);
    let n = 0;
    for (const p of list) {
      const name = String((p && p.name) || '').trim();
      if (!name) continue;
      await this.store.putPreset(name, sanitizeAsm(p.asm));
      n++;
    }
    this.renderPresets();
    this.toast(`已匯入 ${n} 組預組（同名的會覆蓋）`);
  }

  // ---------- 繪製 ----------
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
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.open_ || !this.rig) return;
    this.resize(false);
    if (this.playing && this.anim !== 'rest') {
      this.t = (this.t + dt) % LOOP;
      animateMech(this.rig, dt, animState(this.anim, this.t));
      $('wsTime').value = this.t;
      $('wsTimeText').textContent = `${this.t.toFixed(2)} s`;
    }
    this.edit.tick(dt);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(false);
  }
}
