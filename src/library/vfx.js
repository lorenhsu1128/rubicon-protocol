// 特效編輯頁（模型庫的「特效」頁籤，網址 #vfx；docs/vfx-design.md 第 5 期）：調整特效預設（fx/presets.js）。
// - 左：特效清單、它的層（發射器）、新增／複製／刪除層、還原、存檔與匯出
// - 中：預覽（顯示卡粒子 fx/gpu.js，和遊戲同一套；旁邊一台機甲當比例的參考）、尺度 S、顏色、間隔、渲染風格的色階
// - 右：選取的層的欄位（空白＝不用這個欄位）
// 「存到瀏覽器」＝遊戲也用（localStorage rubicon_fx_presets，只有外觀，多人各端各自的也沒關係）；
// 要變成內建就匯出 presets.json 覆蓋 src/assets/fx/presets.json 後重新建置。
import { escHtml } from '../core/html.js';
import { START_ASM } from '../data/parts.js';
import { PALETTES } from '../render/materials.js';
import { GpuFx, fxStyle } from '../fx/gpu.js';
import { FXG } from '../fx/atlas.js';
import { emitPreset, fxBuiltin, fxPresets, sanitizePresets, setFxPresets } from '../fx/presets.js';
import { buildGrid } from './refs.js';
import { addLights, applyLight, buildMechWithGlb, disposeObject, fitCamera, makeRenderer } from './stage.js';
import { MB } from '../core/scale.js';

const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
// 欄位：[鍵, 名稱, 種類, 參數]
const FIELDS = [
  [
    'sys',
    '系統',
    'sel',
    [
      ['sm', '煙塵（一般混合）'],
      ['gl', '發光（面向鏡頭）'],
      ['ln', '拉長（沿速度或軸）'],
      ['rg', '地面的環'],
      ['dc', '地面（焦痕）'],
    ],
  ],
  ['n', '數量', 'num', 1],
  ['chance', '每顆的機率', 'num', 0.01],
  ['life', '壽命（秒）', 'pair', 0.01],
  ['lifeDur', '壽命 × 時長', 'bool'],
  ['pos', '起點離中心（× S）', 'pair', 0.05],
  ['ring', '起點的水平距離（× S）', 'num', 0.05],
  ['speed', '速度（× S）', 'pair', 0.1],
  ['dir', '方向的範圍（最小／最大 x y z）', 'dir', 0.05],
  ['inward', '往中心吸進去（蓄力）', 'bool'],
  ['delay', '出發時間（× 時長）', 'pair', 0.01],
  ['s0', '起始大小（× S）', 'pair', 0.01],
  ['s1', '結束大小（× S）', 'pair', 0.01],
  ['c0', '起始顏色', 'color'],
  ['c1', '結束顏色', 'color'],
  ['k', '亮度倍率', 'num', 0.05],
  ['a', '不透明度（＞1＝加強貼圖）', 'num', 0.05],
  ['occ', '遮蔽度（0 加色、1 一般）', 'num', 0.05],
  ['cells', '貼圖（組或格的名稱，逗號分隔）', 'cells'],
  [
    'fade',
    '淡出曲線',
    'sel',
    [
      ['', '線性'],
      [1, '平方（快淡）'],
      [2, '結尾才淡'],
      [3, '淡入淡出'],
      [4, '閃爍'],
      [5, '先維持再淡出'],
      [6, '淡入（蓄力）'],
    ],
  ],
  ['g', '重力（× S，負的往上飄）', 'num', 0.1],
  ['drag', '空氣阻力', 'num', 0.1],
  ['rot', '隨機的角度', 'bool'],
  ['rv', '旋轉速度（弧度／秒）', 'pair', 0.1],
  ['asp', '拉長的比例', 'num', 0.05],
];
const CELL_NAMES = [...Object.keys(FXG), 'soft', 'hard', 'ring', 'puff', 'line', 'shard', 'core', 'beam'];

export class VfxEditor {
  constructor({ store, toast, onClose }) {
    this.store = store;
    this.toast = toast;
    this.onClose = onClose;
    this.open_ = false;
    this.all = clone(fxPresets());
    this.id = Object.keys(this.all)[0];
    this.li = 0;
    this.dirty = false;
    this.S = 3; // 預覽的尺度（遊戲的 k＝3）
    this.color = '#ff6030';
    this.every = 1.2;
    this.dur = 0.6;
    this.cel = 0;
    this.acc = 0;
    this.t = 0;
    this.canvas = $('vxGl');
    this.renderer = makeRenderer(this.canvas, true);
    this.scene = new THREE.Scene();
    this.lights = addLights(this.scene);
    applyLight(this.scene, this.lights, null);
    this.scene.add(buildGrid(new THREE.Vector3(6 * MB, 4 * MB, 6 * MB)));
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 3000);
    this.controls = new THREE.OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.sys = {
      sm: new GpuFx(this.scene, { add: false }),
      gl: new GpuFx(this.scene),
      ln: new GpuFx(this.scene, { mode: 'stretch', spd: 0.035, maxL: 4.8 }),
      rg: new GpuFx(this.scene, { mode: 'ground' }),
      dc: new GpuFx(this.scene, { mode: 'ground', add: false }),
    };
    this.setupUi();
    this.last = performance.now();
    requestAnimationFrame(() => this.loop());
  }
  pre() {
    return this.all[this.id];
  }
  layer() {
    const p = this.pre();
    return p && p.layers[Math.min(this.li, p.layers.length - 1)];
  }
  changed() {
    this.dirty = true;
    setFxPresets(this.all, false); // 預覽（emitPreset 讀目前的）
    this.renderLeft();
  }

  // ---------- 開關 ----------
  async open() {
    $('vfx').hidden = false;
    this.open_ = true;
    this.renderAll();
    if (!this.mech) {
      const { rig } = await buildMechWithGlb(START_ASM, PALETTES.player, this.store, 1);
      this.mech = rig;
      rig.group.position.set(-5 * MB, 0, -1 * MB);
      this.scene.add(rig.group);
    }
    this.resize(true);
    fitCamera(this.camera, new THREE.Vector3(9 * MB, 5 * MB, 9 * MB), this.camera.aspect, 1.3);
    this.controls.target.set(0, 1.4 * MB, 0);
  }
  close() {
    if (this.dirty && !confirm('特效有修改還沒存到瀏覽器，確定要離開？')) return;
    $('vfx').hidden = true;
    this.open_ = false;
    for (const s of Object.values(this.sys)) s.clear();
    fxStyle(0);
    if (this.onClose) this.onClose();
  }
  dispose() {
    if (this.mech) disposeObject(this.mech.group);
  }

  // ---------- 介面 ----------
  setupUi() {
    $('vxBack').onclick = () => this.close();
    addEventListener('keydown', (e) => {
      if (!this.open_ || e.target.closest('input,select,textarea')) return;
      if (e.key === 'Escape') this.close();
      else if (e.key === ' ') {
        e.preventDefault();
        this.play();
      }
    });
    $('vxSel').onchange = () => {
      this.id = $('vxSel').value;
      this.li = 0;
      this.renderAll();
      this.play();
    };
    $('vxAddL').onclick = () => {
      this.pre().layers.push({
        sys: 'gl',
        n: 4,
        life: [0.3, 0.5],
        s0: [0.5, 0.5],
        c0: '#ffffff',
        cells: 'soft',
      });
      this.li = this.pre().layers.length - 1;
      this.changed();
      this.renderRight();
    };
    $('vxDupL').onclick = () => {
      const L = this.layer();
      if (!L) return;
      this.pre().layers.splice(this.li + 1, 0, clone(L));
      this.li++;
      this.changed();
      this.renderRight();
    };
    $('vxDelL').onclick = () => {
      const p = this.pre();
      if (p.layers.length <= 1) return this.toast('至少要有一層');
      p.layers.splice(this.li, 1);
      this.li = Math.max(0, this.li - 1);
      this.changed();
      this.renderRight();
    };
    $('vxRevert').onclick = () => {
      const b = fxBuiltin()[this.id];
      if (!b) return this.toast('這個特效沒有內建的版本');
      this.all[this.id] = b;
      this.li = 0;
      this.changed();
      this.renderAll();
    };
    $('vxResetAll').onclick = () => {
      if (!confirm('全部的特效還原成內建的版本？（瀏覽器裡存的也會清掉）')) return;
      this.all = fxBuiltin();
      setFxPresets(this.all, true);
      this.dirty = false;
      this.renderAll();
    };
    $('vxSave').onclick = () => {
      setFxPresets(this.all, true);
      this.dirty = false;
      this.toast('已存到瀏覽器：遊戲下次建立特效時使用');
      this.renderLeft();
    };
    $('vxExport').onclick = () => {
      const blob = new Blob([JSON.stringify({ v: 1, presets: this.all }, null, 1) + '\n'], {
        type: 'application/json',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'presets.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('vxImport').onclick = () => $('vxImportFile').click();
    $('vxImportFile').onchange = async () => {
      const f = $('vxImportFile').files[0];
      $('vxImportFile').value = '';
      if (!f) return;
      try {
        const got = sanitizePresets(JSON.parse(await f.text()));
        const n = Object.keys(got).length;
        if (!n) return this.toast('檔案裡沒有認得的特效');
        Object.assign(this.all, got);
        this.changed();
        this.renderAll();
        this.toast(`匯入 ${n} 個特效（還沒存到瀏覽器）`);
      } catch (e) {
        this.toast('讀不到這個檔案：' + e.message);
      }
    };
    $('vxPlay').onclick = () => this.play();
    const bind = (id, key, conv) => {
      const el = $(id);
      const f = () => {
        this[key] = conv(el.value);
        if (key === 'cel') fxStyle(this.cel);
      };
      el.oninput = f;
      f();
    };
    bind('vxS', 'S', (v) => +v);
    bind('vxColor', 'color', (v) => v);
    bind('vxEvery', 'every', (v) => +v);
    bind('vxDur', 'dur', (v) => +v);
    bind('vxCel', 'cel', (v) => +v);
    $('vxDark').onchange = () => {
      this.scene.background = $('vxDark').checked ? new THREE.Color(0x101216) : null;
    };
  }
  renderAll() {
    $('vxSel').innerHTML = Object.entries(this.all)
      .map(
        ([id, p]) =>
          `<option value="${id}"${id === this.id ? ' selected' : ''}>${escHtml(p.name)}（${id}）</option>`,
      )
      .join('');
    this.renderLeft();
    this.renderRight();
  }
  renderLeft() {
    const p = this.pre();
    if (!p) return;
    $('vxNote').textContent = p.note || '';
    $('vxLayers').innerHTML = p.layers
      .map(
        (L, i) =>
          `<button data-i="${i}" class="moStage${i === this.li ? ' sel' : ''}">${i + 1}. ${escHtml(L.sys)} × ${L.n != null ? L.n : 1}　${escHtml(L.cells || 'soft')}</button>`,
      )
      .join('');
    for (const b of $('vxLayers').querySelectorAll('button'))
      b.onclick = () => {
        this.li = +b.dataset.i;
        this.renderLeft();
        this.renderRight();
      };
    $('vxDirty').textContent = this.dirty ? '（有修改還沒存）' : '';
  }
  // 右側：這一層的欄位（改了就預覽）
  renderRight() {
    const L = this.layer();
    const box = $('vxFields');
    if (!L) return (box.innerHTML = '');
    const val = (x) => (x == null ? '' : x);
    box.innerHTML = FIELDS.map(([k, name, t, o]) => {
      const v = L[k];
      let inp = '';
      if (t === 'sel')
        inp = `<select data-k="${k}">${o
          .map(
            ([x, nm]) =>
              `<option value="${x}"${String(v == null ? '' : v) === String(x) ? ' selected' : ''}>${nm}</option>`,
          )
          .join('')}</select>`;
      else if (t === 'num') inp = `<input type="number" step="${o}" data-k="${k}" value="${val(v)}" />`;
      else if (t === 'pair')
        inp = [0, 1]
          .map(
            (j) => `<input type="number" step="${o}" data-k="${k}" data-j="${j}" value="${v ? v[j] : ''}" />`,
          )
          .join('');
      else if (t === 'dir')
        inp = [0, 1]
          .map((j) =>
            [0, 1, 2]
              .map(
                (a) =>
                  `<input type="number" step="${o}" data-k="${k}" data-j="${j}" data-a="${a}" value="${v ? v[j][a] : ''}" />`,
              )
              .join(''),
          )
          .join('<br>');
      else if (t === 'bool') inp = `<input type="checkbox" data-k="${k}"${v ? ' checked' : ''} />`;
      else if (t === 'color')
        inp =
          `<input type="checkbox" data-k="${k}" data-on="1"${v ? ' checked' : ''} title="使用這個欄位" />` +
          `<input type="color" data-k="${k}" value="${v && v !== '$' ? v : '#ffffff'}" />` +
          `<label class="small"><input type="checkbox" data-k="${k}" data-d="1"${v === '$' ? ' checked' : ''} /> 呼叫端的顏色</label>`;
      else if (t === 'cells')
        inp = `<input list="vxCellList" data-k="${k}" value="${escHtml(val(v))}" /><datalist id="vxCellList">${CELL_NAMES.map((c) => `<option value="${c}">`).join('')}</datalist>`;
      return `<div class="vxF"><span class="small dim">${name}</span><div class="vxIn">${inp}</div></div>`;
    }).join('');
    for (const el of box.querySelectorAll('[data-k]')) el.onchange = el.oninput = () => this.readField(el);
  }
  readField(el) {
    const L = this.layer();
    const k = el.dataset.k;
    const F = FIELDS.find((f) => f[0] === k);
    const t = F[2];
    const set = (x) => {
      if (x === undefined || x === '' || (typeof x === 'number' && !Number.isFinite(x))) delete L[k];
      else L[k] = x;
    };
    if (t === 'sel') set(k === 'sys' ? el.value : el.value === '' ? undefined : +el.value);
    else if (t === 'num') set(el.value === '' ? undefined : +el.value);
    else if (t === 'pair') {
      const ins = [...document.querySelectorAll(`#vxFields [data-k="${k}"]`)];
      const a = ins.map((i) => i.value);
      if (a[0] === '' && a[1] === '') set(undefined);
      else set([+(a[0] || a[1]), +(a[1] || a[0])]);
    } else if (t === 'dir') {
      const ins = [...document.querySelectorAll(`#vxFields [data-k="${k}"]`)];
      if (ins.every((i) => i.value === '')) set(undefined);
      else set([0, 1].map((j) => [0, 1, 2].map((a) => +(ins[j * 3 + a].value || 0))));
    } else if (t === 'bool') set(el.checked ? true : undefined);
    else if (t === 'color') {
      const ins = [...document.querySelectorAll(`#vxFields [data-k="${k}"]`)];
      const on = ins.find((i) => i.dataset.on),
        dol = ins.find((i) => i.dataset.d),
        col = ins.find((i) => i.type === 'color');
      if (el === col) on.checked = true;
      if (el === dol && dol.checked) on.checked = true;
      set(!on.checked ? undefined : dol.checked ? '$' : col.value);
    } else if (t === 'cells') set(el.value.trim() || undefined);
    if (k === 'rot' && L.rot) L.rot = 1;
    this.changed();
  }

  // ---------- 預覽 ----------
  play() {
    const c = parseInt(this.color.slice(1), 16);
    emitPreset(this.sys, this.id, new THREE.Vector3(0, 1.4 * MB, 0), { S: this.S, color: c, dur: this.dur });
    this.acc = 0;
  }
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
    if (!this.open_) return;
    this.t += dt;
    for (const s of Object.values(this.sys)) {
      s.time = this.t;
      s.update(this.t, dt);
    }
    // 持續的特效（間隔很短的）照間隔重複播放
    if ($('vxLoop').checked && (this.acc += dt) >= this.every) this.play();
    this.resize();
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
