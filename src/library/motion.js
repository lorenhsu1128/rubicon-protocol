// 動作編輯頁（模型庫的「動作編輯」頁籤，網址 #motion）：編輯近戰招式的關鍵影格（render/melee-anim.js）。
// - 左：武器與它的連段招式（每段用哪個片段）、片段的新增／刪除／還原、存檔與匯出
// - 中：3D 機甲（目前模型組的 GLB）、時間軸（招式進度 0～1，依招式長度播放）、關鍵影格的位置
// - 右：關鍵影格清單（時間、緩動）與選取的關鍵影格的各關節數值（度）
// 修改的只是覆寫（this.data：{ v, clips, map }，沒改過的片段與對應用預設）。「存到瀏覽器」＝單人遊戲用
// （localStorage rubicon_melee_anim）；要變成內建（多人也用）就匯出 melee.json 覆蓋 src/assets/anims/melee.json 後重新建置。
import { escHtml } from '../core/html.js';
import { FIST_DEF, PARTS, START_ASM } from '../data/parts.js';
import { PALETTES } from '../render/materials.js';
import { animateMech } from '../render/mech-model.js';
import { springClear } from '../render/mech-spring.js';
import {
  DEFAULT_MAP,
  EASES,
  LOCAL_KEY,
  MJ,
  MJ_AXES,
  MeleeAnim,
  TEMPLATES,
  clipChanged,
  clipPose,
  clipTarget,
} from '../render/melee-anim.js';
import { buildGrid } from './refs.js';
import { addLights, applyLight, buildMechWithGlb, disposeObject, fitCamera, makeRenderer } from './stage.js';
import { restPose, sanitizeAsm } from './workshop.js';

const $ = (id) => document.getElementById(id);
const R2D = 180 / Math.PI;
const EASE_IDS = EASES.map((e) => e[0]);
const STEP = 1 / 60;
const SETTLE = 0.5; // 彈簧模式：招式開始前先站穩的秒數
const clone = (o) => JSON.parse(JSON.stringify(o));
// 有連段的武器（含空手的拳擊）
const WEAPONS = () => [...PARTS.arm.filter((w) => w.combo), FIST_DEF];
// 招式種類（程式算的近戰姿勢與預設片段）
const kindOf = (st) => (st.spin ? 'spin' : st.thrust ? 'thrust' : st.slam ? 'slam' : 'slash');
const defaultClipId = (st) =>
  st.spin ? 'spin' : st.thrust ? 'thrust' : st.slam ? 'slam' : st.mirror ? 'slashB' : 'slash';

// 讀進來的資料只留認得的內容（匯入、瀏覽器裡的舊資料）
export function sanitizeMotion(raw) {
  const out = { v: 1, clips: {}, map: {} };
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, c] of Object.entries(raw.clips || {})) {
    if (!/^[\w-]{1,40}$/.test(id) || !c || !Array.isArray(c.keys)) continue;
    const keys = [];
    for (const k of c.keys.slice(0, 64)) {
      if (!k || !Number.isFinite(+k.t)) continue;
      const p = {};
      for (const [j, v] of Object.entries(k.p || {})) {
        const ax = MJ_AXES[j];
        if (!ax || !Array.isArray(v)) continue;
        p[j] = ax.map((_, n) => {
          const x = +v[n];
          return Number.isFinite(x) ? Math.max(-720, Math.min(720, x)) : 0;
        });
      }
      keys.push({ t: Math.max(0, Math.min(1, +k.t)), e: EASE_IDS.includes(k.e) ? k.e : 'io', p });
    }
    if (keys.length) out.clips[id] = { name: String(c.name || id).slice(0, 40), keys };
  }
  for (const [w, list] of Object.entries(raw.map || {}))
    if (/^[\w-]{1,40}$/.test(w) && Array.isArray(list))
      out.map[w] = list.slice(0, 12).map((x) => (typeof x === 'string' ? x.slice(0, 40) : ''));
  return out;
}

export class MotionEditor {
  constructor({ store, toast, onClose }) {
    this.store = store;
    this.toast = toast;
    this.onClose = onClose;
    this.open_ = false;
    this.rig = null;
    this.tok = 0;
    this.wid = 'w_blade';
    this.stage = 0;
    this.keyI = 0;
    this.ph = 0;
    this.playing = false;
    this.speed = 1;
    this.springs = true; // 彈簧（遊戲中的樣子）／原始的關鍵影格
    this.left = false; // 左手武器（左右鏡像）
    this.simT = -1; // 彈簧模式：目前模擬到的招式進度（-1＝要從頭模擬）
    this.data = this.loadData();
    this.canvas = $('moGl');
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
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  // ---------- 資料 ----------
  loadData() {
    let d = null;
    try {
      d = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    } catch (e) {}
    return sanitizeMotion(d || MeleeAnim.raw || { clips: {}, map: {} });
  }
  clips() {
    return { ...TEMPLATES, ...this.data.clips };
  }
  weapon() {
    return WEAPONS().find((w) => w.id === this.wid) || WEAPONS()[0];
  }
  // 這把武器各段用的片段 id
  mapOf(w = this.weapon()) {
    const m = this.data.map[w.id] || DEFAULT_MAP[w.id] || [];
    return w.combo.map((st, i) => m[i] || defaultClipId(st));
  }
  clipId() {
    return this.mapOf()[this.stage];
  }
  clip() {
    return this.clips()[this.clipId()] || TEMPLATES.slash;
  }
  // 要修改的片段：預設片段第一次修改時複製成覆寫
  editable() {
    const id = this.clipId();
    if (!this.data.clips[id]) this.data.clips[id] = clone(this.clip());
    return this.data.clips[id];
  }
  key() {
    const c = this.clip();
    return c.keys[Math.min(this.keyI, c.keys.length - 1)];
  }
  changed() {
    this.dirty = true;
    clipChanged(this.clip());
    this.simT = -1;
    this.renderKeys();
    this.renderJoints();
    this.pose();
  }

  // ---------- 開關 ----------
  async open() {
    $('motion').hidden = false;
    this.open_ = true;
    this.renderAll();
    await this.rebuild(true);
  }
  close() {
    $('motion').hidden = true;
    this.open_ = false;
    this.playing = false;
    if (this.onClose) this.onClose();
  }
  useSet() {
    if (this.open_) this.rebuild(false);
  }

  // ---------- 介面 ----------
  setupUi() {
    $('moBack').onclick = () => this.close();
    addEventListener('keydown', (e) => {
      if (!this.open_ || e.target.closest('input,select,textarea')) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === ' ') {
        e.preventDefault();
        this.togglePlay();
      }
    });
    $('moWpn').onchange = () => {
      this.wid = $('moWpn').value;
      this.stage = 0;
      this.selectStage();
      this.rebuild(false);
    };
    $('moNew').onclick = () => {
      const name = $('moName').value.trim() || this.clip().name + ' 複本';
      let id = 'c' + Date.now().toString(36);
      while (this.clips()[id]) id += 'x';
      this.data.clips[id] = { ...clone(this.clip()), name: name.slice(0, 40) };
      this.setStageClip(id);
      $('moName').value = '';
      this.toast(`已新增片段「${name}」，並套用到這一段招式`);
    };
    $('moRename').onclick = () => {
      const name = $('moName').value.trim();
      if (!name) return this.toast('請先輸入新的名稱', true);
      this.editable().name = name.slice(0, 40);
      $('moName').value = '';
      this.dirty = true;
      this.renderAll();
    };
    $('moRevert').onclick = () => {
      const id = this.clipId();
      if (!this.data.clips[id]) return this.toast('這個片段沒有修改過');
      if (!TEMPLATES[id]) {
        if (!confirm(`刪除自訂片段「${this.clip().name}」？用到它的招式改回預設片段`)) return;
        for (const w in this.data.map) this.data.map[w] = this.data.map[w].map((x) => (x === id ? '' : x));
      } else if (!confirm(`把「${this.clip().name}」還原成預設的動作？`)) return;
      delete this.data.clips[id];
      this.keyI = 0;
      this.changed();
      this.renderAll();
    };
    $('moSave').onclick = () => this.saveLocal();
    $('moExport').onclick = () => this.exportFile();
    $('moImport').onclick = () => $('moImportFile').click();
    $('moImportFile').onchange = async () => {
      const f = $('moImportFile').files[0];
      $('moImportFile').value = '';
      if (!f) return;
      try {
        this.data = sanitizeMotion(JSON.parse(await f.text()));
      } catch (e) {
        return this.toast('讀不到這個檔案：' + (e.message || e), true);
      }
      this.dirty = true;
      this.keyI = 0;
      this.simT = -1;
      this.renderAll();
      this.pose();
      this.toast(`已匯入 ${Object.keys(this.data.clips).length} 個片段（還沒存到瀏覽器）`);
    };
    $('moResetAll').onclick = () => {
      if (!confirm('捨棄所有修改，回到內建的動作？（瀏覽器裡存的版本也會刪除）')) return;
      try {
        localStorage.removeItem(LOCAL_KEY);
      } catch (e) {}
      this.data = sanitizeMotion(MeleeAnim.raw || {});
      this.dirty = false;
      this.keyI = 0;
      this.simT = -1;
      this.renderAll();
      this.pose();
    };
    // 時間軸
    $('moPlay').onclick = () => this.togglePlay();
    $('moSpeed').onchange = () => (this.speed = +$('moSpeed').value);
    $('moTime').oninput = () => {
      this.playing = false;
      this.ph = +$('moTime').value;
      this.pose();
      this.renderTime();
    };
    $('moSpring').onchange = () => {
      this.springs = $('moSpring').checked;
      this.simT = -1;
      this.pose();
    };
    $('moLeftHand').onchange = () => {
      this.left = $('moLeftHand').checked;
      this.rebuild(false);
    };
    // 關鍵影格
    $('moAddKey').onclick = () => {
      const c = this.editable();
      const P = clipPose(this.clip(), this.ph, false);
      const p = {};
      for (const j in P)
        p[j] = j === 'drop' ? P[j].map((x) => +x.toFixed(3)) : P[j].map((x) => Math.round(x * R2D));
      const t = Math.round(this.ph * 1000) / 1000;
      const at = c.keys.findIndex((k) => Math.abs(k.t - t) < 0.0005);
      if (at >= 0) return this.toast('這個時間已經有關鍵影格', true);
      c.keys.push({ t, e: 'io', p });
      c.keys.sort((a, b) => a.t - b.t);
      this.keyI = c.keys.findIndex((k) => k.t === t);
      this.changed();
    };
    $('moDelKey').onclick = () => {
      const c = this.editable();
      if (c.keys.length <= 1) return this.toast('至少要留一個關鍵影格', true);
      c.keys.splice(this.keyI, 1);
      this.keyI = Math.max(0, this.keyI - 1);
      this.changed();
    };
    $('moGoKey').onclick = () => {
      this.playing = false;
      this.ph = this.key().t;
      this.pose();
      this.renderTime();
    };
  }
  togglePlay() {
    this.playing = !this.playing;
    if (this.playing && this.ph >= 1) this.ph = 0;
    this.simT = -1;
    this.renderTime();
  }
  // 換招式（套用片段）
  setStageClip(id) {
    const w = this.weapon();
    const m = this.mapOf(w).slice();
    m[this.stage] = id;
    this.data.map[w.id] = m;
    this.keyI = 0;
    this.dirty = true;
    this.simT = -1;
    this.renderAll();
    this.pose();
  }
  selectStage() {
    this.keyI = 0;
    this.ph = 0;
    this.simT = -1;
    this.renderAll();
    this.pose();
  }
  renderAll() {
    const ws = WEAPONS();
    $('moWpn').innerHTML = ws
      .map(
        (w) => `<option value="${w.id}"${w.id === this.wid ? ' selected' : ''}>${escHtml(w.name)}</option>`,
      )
      .join('');
    const w = this.weapon(),
      map = this.mapOf(w),
      clips = this.clips();
    const opts = (sel) =>
      Object.entries(clips)
        .map(
          ([id, c]) =>
            `<option value="${id}"${id === sel ? ' selected' : ''}>${escHtml(c.name)}${this.data.clips[id] ? (TEMPLATES[id] ? '（已修改）' : '（自訂）') : ''}</option>`,
        )
        .join('');
    $('moStages').innerHTML = w.combo
      .map(
        (st, i) =>
          `<div class="moStage${i === this.stage ? ' sel' : ''}" data-i="${i}">` +
          `<span>${i + 1}. ${escHtml(st.name)} <span class="dim">${st.dur}s・${kindOf(st)}${st.mirror ? '・逆' : ''}${st.finisher ? '・終結' : ''}</span></span>` +
          `<select data-i="${i}" title="這一段用的動作片段">${opts(map[i])}</select></div>`,
      )
      .join('');
    for (const r of $('moStages').querySelectorAll('.moStage'))
      r.onclick = (e) => {
        if (e.target.closest('select')) return;
        this.stage = +r.dataset.i;
        this.selectStage();
      };
    for (const s of $('moStages').querySelectorAll('select'))
      s.onchange = () => {
        this.stage = +s.dataset.i;
        this.setStageClip(s.value);
      };
    const c = this.clip();
    $('moClipInfo').textContent =
      `目前的片段：${c.name}（${this.clipId()}）` +
      (this.data.clips[this.clipId()] ? (TEMPLATES[this.clipId()] ? '・已修改' : '・自訂') : '・預設');
    $('moRevert').textContent = TEMPLATES[this.clipId()] ? '還原預設' : '刪除片段';
    this.renderKeys();
    this.renderJoints();
    this.renderTime();
  }
  renderKeys() {
    const c = this.clip();
    if (this.keyI >= c.keys.length) this.keyI = c.keys.length - 1;
    $('moKeys').innerHTML = c.keys
      .map(
        (k, i) =>
          `<div class="moKey${i === this.keyI ? ' sel' : ''}" data-i="${i}">` +
          `<input type="number" min="0" max="1" step="0.01" value="${k.t}" data-t="${i}" title="時間（招式進度 0～1）">` +
          `<select data-e="${i}" title="從上一個關鍵影格到這裡的緩動">${EASES.map(([id, n]) => `<option value="${id}"${id === k.e ? ' selected' : ''}>${n}</option>`).join('')}</select>` +
          `<span class="dim">${Object.keys(k.p).length} 個關節</span></div>`,
      )
      .join('');
    for (const r of $('moKeys').querySelectorAll('.moKey'))
      r.onclick = (e) => {
        if (e.target.closest('input,select')) return;
        this.keyI = +r.dataset.i;
        this.renderKeys();
        this.renderJoints();
      };
    for (const inp of $('moKeys').querySelectorAll('input[data-t]'))
      inp.onchange = () => {
        const c2 = this.editable(),
          k = c2.keys[+inp.dataset.t];
        k.t = Math.max(0, Math.min(1, +inp.value || 0));
        c2.keys.sort((a, b) => a.t - b.t);
        this.keyI = c2.keys.indexOf(k);
        this.changed();
      };
    for (const s of $('moKeys').querySelectorAll('select[data-e]'))
      s.onchange = () => {
        this.editable().keys[+s.dataset.e].e = s.value;
        this.changed();
      };
    // 時間軸上的關鍵影格位置
    $('moMarks').innerHTML = c.keys
      .map(
        (k, i) =>
          `<span class="moMark${i === this.keyI ? ' sel' : ''}" style="left:${(k.t * 100).toFixed(2)}%" data-i="${i}" title="關鍵影格 ${k.t}"></span>`,
      )
      .join('');
    for (const m of $('moMarks').querySelectorAll('.moMark'))
      m.onclick = () => {
        this.keyI = +m.dataset.i;
        this.playing = false;
        this.ph = c.keys[this.keyI].t;
        this.renderKeys();
        this.renderJoints();
        this.pose();
        this.renderTime();
      };
  }
  renderJoints() {
    const k = this.key();
    $('moKeyTitle').textContent = `關鍵影格 ${this.keyI + 1}（時間 ${k.t}）的關節`;
    $('moJoints').innerHTML = MJ.map(([j, name, axes]) => {
      const on = !!k.p[j];
      const v = k.p[j] || axes.map(() => 0);
      const drop = j === 'drop';
      return (
        `<div class="moJoint${on ? '' : ' off'}"><label title="勾選＝這個關鍵影格有寫這個關節"><input type="checkbox" data-on="${j}"${on ? ' checked' : ''}> ${escHtml(name)}</label>` +
        axes
          .map(
            (ax, n) =>
              `<div class="moAxis"><span>${ax.toUpperCase()}</span>` +
              `<input type="range" data-j="${j}" data-n="${n}" min="${drop ? -0.5 : -180}" max="${drop ? 0.6 : 180}" step="${drop ? 0.01 : 1}" value="${v[n]}"${on ? '' : ' disabled'}>` +
              `<input type="number" data-j="${j}" data-n="${n}" step="${drop ? 0.01 : 1}" value="${v[n]}"${on ? '' : ' disabled'}></div>`,
          )
          .join('') +
        `</div>`
      );
    }).join('');
    for (const cb of $('moJoints').querySelectorAll('input[data-on]'))
      cb.onchange = () => {
        const kk = this.editable().keys[this.keyI],
          j = cb.dataset.on;
        if (cb.checked) {
          // 加入時用這個時間點目前的值
          const P = clipPose(this.clip(), kk.t, false);
          kk.p[j] = P[j]
            ? j === 'drop'
              ? P[j].map((x) => +x.toFixed(3))
              : P[j].map((x) => Math.round(x * R2D))
            : MJ_AXES[j].map(() => 0);
        } else delete kk.p[j];
        this.changed();
      };
    for (const inp of $('moJoints').querySelectorAll('input[data-j]'))
      inp.oninput = () => {
        const kk = this.editable().keys[this.keyI],
          j = inp.dataset.j,
          n = +inp.dataset.n;
        if (!kk.p[j]) return;
        kk.p[j][n] = +inp.value || 0;
        // 拉桿與數字同步（不重畫整個面板，拖曳才不會中斷）
        for (const o of $('moJoints').querySelectorAll(`input[data-j="${j}"][data-n="${n}"]`))
          if (o !== inp) o.value = inp.value;
        this.dirty = true;
        clipChanged(this.clip());
        this.simT = -1;
        if (!this.playing) this.ph = kk.t;
        this.pose();
        this.renderTime();
      };
  }
  renderTime() {
    $('moPlay').textContent = this.playing ? '❚❚ 暫停' : '▶ 播放';
    $('moTime').value = this.ph;
    const st = this.weapon().combo[this.stage];
    $('moTimeText').textContent = `${this.ph.toFixed(2)}（${(this.ph * st.dur).toFixed(2)} / ${st.dur} s）`;
  }

  // ---------- 存檔與匯出 ----------
  saveLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.data));
    } catch (e) {
      return this.toast('存不進瀏覽器：' + (e.message || e), true);
    }
    this.dirty = false;
    this.toast('已存到瀏覽器：單人遊戲下次出擊時使用（多人連線一律用內建的動作）');
  }
  exportFile() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(this.data, null, 1) + '\n'], { type: 'application/json' }),
    );
    a.download = 'melee.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast(
      '已匯出 melee.json：放到 src/assets/anims/melee.json 後重新建置，就成為內建的動作（多人也使用）',
    );
  }

  // ---------- 機甲與姿勢 ----------
  async rebuild(refit) {
    const tok = ++this.tok;
    const set = this.store.curSet();
    const asm = sanitizeAsm((set && set.asm) || START_ASM);
    const w = this.weapon();
    const wid = w.id === FIST_DEF.id ? 'w_none' : w.id;
    asm.rarm = this.left ? 'w_none' : wid;
    asm.larm = this.left ? wid : 'w_none';
    const { rig } = await buildMechWithGlb(asm, PALETTES.player, this.store, 1);
    if (tok !== this.tok) return disposeObject(rig.group);
    if (this.rig) {
      this.scene.remove(this.rig.group);
      disposeObject(this.rig.group);
    }
    this.rig = rig;
    this.scene.add(rig.group);
    this.simT = -1;
    this.pose();
    if (refit || !this.fitted) {
      this.resize(true);
      this.controls.target.copy(
        fitCamera(this.camera, new THREE.Vector3(4, 4.2, 4), this.camera.aspect, 1.4),
      );
      this.camera.position.set(
        this.controls.target.x + 7,
        this.controls.target.y + 2,
        this.controls.target.z - 6,
      );
      this.controls.update();
      this.fitted = true;
    }
  }
  // 站姿（彈簧模式的起點、原始模式的底）：拉直靜止姿勢＋持武器的手臂與微彎的腳
  basePose() {
    const rig = this.rig;
    restPose(rig);
    for (const a of Object.values(rig.arms)) {
      a.up.rotation.x = 0.35;
      a.fore.rotation.x = 1.2;
      a.weapon.rotation.set(0, 0, 0);
    }
    for (const L of rig.legs) {
      L.thigh.rotation.x = L.th || 0;
      L.knee.rotation.x = L.kn || 0;
      L.foot.rotation.x = L.ft || 0;
      if (L.hock) L.hock.rotation.x = L.hk || 0;
    }
  }
  meleeSt(ph) {
    const st = this.weapon().combo[this.stage];
    return {
      kind: kindOf(st),
      ph,
      mirror: !!st.mirror,
      side: this.left ? -1 : 1,
      clip: this.clip(),
    };
  }
  animSt(t, melee) {
    return {
      t,
      grounded: true,
      moving: false,
      recoil: { l: 0, r: 0 },
      swing: { l: 0, r: 0 },
      strafe: 0,
      fwd: 0,
      melee,
      landT: 9,
      leanZ: 0,
      leanX: 0,
      vr: 0,
      heavy: 0.4,
    };
  }
  // 依目前的進度擺姿勢：彈簧模式從頭以 60 Hz 模擬（遊戲中的樣子），原始模式直接套關鍵影格
  pose() {
    const rig = this.rig;
    if (!rig) return;
    if (!this.springs) {
      this.basePose();
      rig.torsoTwist = 0;
      const P = clipPose(this.clip(), this.ph, this.left);
      for (const j in P) {
        const tg = clipTarget(rig, j);
        if (!tg) continue;
        if (tg.kind === 'twist') rig.torso.rotation.y = P[j][0];
        else if (tg.kind === 'drop') {
          rig.torso.position.y -= P[j][0];
          rig.legsG.position.y -= P[j][0];
        } else MJ_AXES[j].forEach((ax, n) => (tg.o[ax] = P[j][n]));
      }
      this.simT = -1;
      return;
    }
    const dur = this.weapon().combo[this.stage].dur;
    if (this.simT < 0 || this.ph < this.simT - 1e-6) {
      this.basePose();
      rig.group.traverse((o) => {
        springClear(o.rotation);
        springClear(o.position);
      });
      rig.an = null;
      rig.torsoTwist = 0;
      for (let t = 0; t < SETTLE; t += STEP) animateMech(rig, STEP, this.animSt(t, null));
      this.simT = 0;
    }
    // 從 simT 模擬到 ph
    while (this.simT < this.ph - 1e-6) {
      const step = Math.min(STEP / dur, this.ph - this.simT);
      this.simT += step;
      animateMech(rig, step * dur, this.animSt(SETTLE + this.simT * dur, this.meleeSt(this.simT)));
    }
    rig.torso.rotation.y = rig.torsoTwist || 0;
  }

  // ---------- 繪製 ----------
  resize(force) {
    const c = this.canvas,
      w = c.clientWidth,
      h = c.clientHeight;
    if (!w || !h) return;
    if (
      force ||
      c.width !== Math.round(w * devicePixelRatio) ||
      c.height !== Math.round(h * devicePixelRatio)
    ) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now(),
      dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.open_ || !this.rig) return;
    if (this.playing) {
      const dur = this.weapon().combo[this.stage].dur;
      this.ph += (dt * this.speed) / dur;
      if (this.ph > 1) {
        this.ph = 0;
        this.simT = -1;
      }
      this.pose();
      this.renderTime();
    }
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
