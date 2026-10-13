// Game：關卡編輯器的「挑底圖」（新建關卡、設定的「選擇底圖…」）——全畫面 3D 預覽，參數改了就重新產生
// （停手 0.3 秒）；種子上一個／換一張／下一個；看過的底圖拍成縮圖排在下方（最多 8 張，點一下回到那張）；
// 「並排比較」一次產生 6 個種子的俯視縮圖。新建時按「用這張地圖開始編輯」才存檔；
// 重新選底圖時已經擺好的物件、單位疊在預覽上，按「套用」才算（可復原），「取消」回到原本的底圖。
import { escHtml } from '../core/html.js';
import { LEVEL_LV, LIMITS } from '../level/format.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const opt = (v, t, cur) =>
  `<option value="${escHtml(v)}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(t)}</option>`;
const HIST = 8;
const GRID = 6;
const BASE_KEYS = ['theme', 'blank', 'variant', 'seed', 'props', 'tod', 'weather'];
const rndSeed = () => 1 + Math.floor(Math.random() * 999999999);

Object.assign(Game.prototype, {
  // mode：'new'（新建關卡）／'rebase'（編輯器裡重新選底圖）
  edPickOpen(mode) {
    const ed = this.ed,
      cur = this.edCur();
    ed.pick = {
      mode,
      t: 0,
      busy: false,
      hist: [],
      grid: null,
      view: 'top',
      orbit: false,
      before: mode === 'rebase' ? { snap: this.edSnap(), base: JSON.parse(JSON.stringify(cur.base)) } : null,
    };
    ed.sel = null;
    document.body.classList.add('edPicking');
    $('edPick').hidden = false;
    this.edPickView('top');
    this.edPickRender();
    this.edPickShot();
  },
  edPickClose() {
    const ed = this.ed;
    ed.pick = null;
    document.body.classList.remove('edPicking');
    $('edPick').hidden = true;
    $('edPickGrid').hidden = true;
    ed.cam = { x: 0, z: 0, yaw: 0.7, pitch: 0.95, dist: 110 };
    if (this.camera.view && this.camera.view.enabled) this.camera.clearViewOffset();
    this.edSlopeTint();
    this.edRenderUi();
  },
  // 俯視全圖／斜角
  edPickView(v) {
    const ed = this.ed,
      w = this.world;
    const P = ed.pick;
    P.view = v;
    const Z = w.zone;
    ed.cam.x = (Z[0] + Z[1]) / 2;
    ed.cam.z = (Z[2] + Z[3]) / 2;
    if (v === 'top') {
      ed.cam.yaw = 0;
      ed.cam.pitch = 1.45;
      ed.cam.dist = w.size * 1.25;
    } else {
      ed.cam.pitch = 0.75;
      ed.cam.dist = w.size * 0.85;
    }
  },
  // 每格：停手後重新產生；環繞時慢慢轉
  edPickTick(dt) {
    const P = this.ed.pick;
    if (P.orbit) this.ed.cam.yaw += dt * 0.18;
    if (P.t > 0) {
      P.t -= dt;
      if (P.t <= 0) {
        // 先畫一格「生成中…」再建（建地圖會卡住一下）
        P.busy = true;
        this.edPickInfo();
        setTimeout(() => this.edPickBuild(), 30);
      }
    }
  },
  // 依面板的參數重建這一段的底圖（地形重算、移除的產生器物件清空；擺放的東西保留）
  edPickBuild(base) {
    const ed = this.ed;
    if (!ed || !ed.pick) return;
    const cur = this.edCur();
    const B = base || this.edPickRead();
    const keep = { ...ed.cam };
    Object.assign(cur.base, B);
    cur.terrain = { n: 0, h: '', water: cur.terrain.water };
    cur.removed = [];
    this.edBuildWorld();
    ed.cam = keep;
    ed.pick.busy = false;
    if (!base || !ed.pick.fromHist) this.edPickShot();
    ed.pick.fromHist = false;
    this.edPickInfo();
  },
  // 面板 → 底圖參數
  edPickRead() {
    const blank = $('epBase').value === 'blank';
    return {
      theme: $('epTheme').value,
      blank,
      variant: blank ? '' : $('epVariant').value,
      seed: Math.max(1, Math.floor(+$('epSeed').value || 1)),
      props: blank ? 'none' : $('epProps').value,
      tod: $('epTod').value,
      weather: $('epWeather').value,
    };
  },
  edPickChanged(now) {
    const P = this.ed.pick;
    P.t = now ? 0.01 : 0.3;
    this.edPickSync();
  },
  // 現在的地圖拍成縮圖放進歷史（同樣的參數不重複）
  edPickShot() {
    const P = this.ed.pick;
    const B = {};
    for (const k of BASE_KEYS) B[k] = this.edCur().base[k];
    const key = JSON.stringify(B);
    P.hist = P.hist.filter((h) => h.key !== key);
    let thumb = '';
    try {
      this.edCamApply();
      thumb = this.edThumb();
    } catch (e) {}
    P.hist.unshift({ key, base: B, thumb, info: this.edPickSummary() });
    if (P.hist.length > HIST) P.hist.length = HIST;
    this.edPickHist();
  },
  // 這張地圖有什麼
  edPickSummary() {
    const w = this.world;
    const T = w.theme;
    const Z = w.zone;
    let lo = 1e9,
      hi = -1e9;
    for (let x = Z[0]; x <= Z[1]; x += 5)
      for (let z = Z[2]; z <= Z[3]; z += 5) {
        const h = w.terrainHeight(x, z);
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    const B = this.edCur().base;
    const vName = B.variant ? ((VARIANTS[B.theme] || {})[B.variant] || {}).name || B.variant : '';
    return {
      name: T.name + (B.blank ? '・空白' : vName ? '・' + vName : ''),
      feats: (w.featureNames || []).filter(Boolean).join('、'),
      props: (w.genItems || []).filter((it) => !it.removed && !it.decor).length,
      rise: Math.max(0, hi - lo),
      water: !!T.water,
      seed: B.seed,
    };
  },
  edPickInfo() {
    const P = this.ed.pick;
    if (!P) return;
    const el = $('epInfo');
    if (!el) return;
    if (P.busy || P.t > 0) {
      el.innerHTML = '<span class="warnT">生成中…</span>';
      return;
    }
    const I = this.edPickSummary();
    el.innerHTML = `<b>${escHtml(I.name)}</b>　種子 ${I.seed}<br>${I.feats ? '地形特徵：' + escHtml(I.feats) + '<br>' : ''}產生器物件 ${I.props} 個　最大高低差 ${I.rise.toFixed(0)} m${I.water ? '　有水面' : ''}`;
  },
  edPickHist() {
    const P = this.ed.pick;
    $('epHist').innerHTML = P.hist
      .map(
        (h, i) =>
          `<button class="epThumb${i === 0 ? ' on' : ''}" data-eh="${i}" title="${escHtml(h.info.name)}　種子 ${h.base.seed}">${h.thumb ? `<img src="${escHtml(h.thumb)}" alt="">` : ''}<span>${escHtml(h.info.name)}<br>${h.base.seed}</span></button>`,
      )
      .join('');
  },
  // 面板的欄位依底圖顯示（空白時沒有變體與產生器物件）
  edPickSync() {
    const blank = $('epBase').value === 'blank';
    $('epGenRow').style.display = blank ? 'none' : '';
    const th = $('epTheme').value;
    const vs = VARIANTS[th] || {};
    const cur = $('epVariant').value;
    $('epVariant').innerHTML =
      opt('', '標準', cur) +
      Object.keys(vs)
        .filter((k) => !vs[k].border)
        .map((k) => opt(k, vs[k].name || k, cur))
        .join('');
  },
  edPickRender() {
    const ed = this.ed,
      P = ed.pick,
      cur = this.edCur(),
      B = cur.base,
      L = ed.L;
    const isNew = P.mode === 'new';
    const vs = VARIANTS[B.theme] || {};
    let h = `<div class="edHead">${isNew ? '新建關卡：選擇底圖' : '選擇底圖' + (ed.seg ? `（第 ${ed.seg + 1} 段）` : '')}</div>`;
    h += `<div class="edHint">改了參數會重新產生地圖；拖曳旋轉、滾輪縮放。${isNew ? '' : '已經擺好的物件與單位會疊在上面，按「套用」才會換。'}</div>`;
    if (isNew) {
      h += `<label class="edF"><span>名稱</span><input id="epName" maxlength="${LIMITS.name}" placeholder="新關卡" value="${escHtml(L.name === '新關卡' ? '' : L.name)}"></label>`;
      h += `<label class="edF"><span>關卡等級</span><input type="number" id="epLevel" min="${LEVEL_LV[0]}" max="${LEVEL_LV[1]}" step="1" value="${B.level}"></label>`;
    }
    h += `<label class="edF"><span>主題</span><select id="epTheme">${Object.keys(THEMES)
      .map((k) => opt(k, THEMES[k].name, B.theme))
      .join('')}</select></label>`;
    h += `<label class="edF"><span>底圖</span><select id="epBase">${opt('blank', '空白（平地）', B.blank ? 'blank' : 'gen')}${opt('gen', '產生器', B.blank ? 'blank' : 'gen')}</select></label>`;
    h += `<div id="epGenRow"><label class="edF"><span>變體</span><select id="epVariant">${opt('', '標準', B.variant)}${Object.keys(
      vs,
    )
      .filter((k) => !vs[k].border)
      .map((k) => opt(k, vs[k].name || k, B.variant))
      .join('')}</select></label>`;
    h += `<label class="edF"><span>產生器物件</span><select id="epProps">${opt('all', '全部保留', B.props)}${opt('big', '只留大型結構', B.props)}${opt('none', '不留', B.props)}</select></label>`;
    h += `<label class="edF"><span>種子</span><input type="number" id="epSeed" value="${B.seed}"></label>`;
    h += `<div class="row epSeedRow"><button id="epPrev" title="種子 −1">◀ 上一個</button><button id="epRand" class="primary">換一張 🎲</button><button id="epNext" title="種子 ＋1">下一個 ▶</button></div>`;
    h += `<button id="epGrid">並排比較 ${GRID} 張</button></div>`;
    h += `<label class="edF"><span>時間</span><select id="epTod">${[
      ['', '主題預設'],
      ['day', '白天'],
      ['dusk', '黃昏'],
      ['night', '夜間'],
      ['dawn', '黎明'],
    ]
      .map(([k, t]) => opt(k, t, B.tod))
      .join('')}</select></label>`;
    h += `<label class="edF"><span>天候</span><select id="epWeather">${[
      ['', '主題預設'],
      ['none', '晴'],
      ['rain', '雨'],
      ['snow', '雪'],
      ['sand', '沙暴'],
      ['dust', '塵埃'],
      ['ash', '落灰'],
    ]
      .map(([k, t]) => opt(k, t, B.weather))
      .join('')}</select></label>`;
    h += `<div class="row"><button id="epTop" class="${P.view === 'top' ? 'on' : ''}">俯視全圖</button><button id="epTilt" class="${P.view === 'tilt' ? 'on' : ''}">斜角</button><button id="epOrbit" class="${P.orbit ? 'on' : ''}">環繞</button></div>`;
    h += `<div id="epInfo" class="epInfo"></div>`;
    h += `<div class="row epGo"><button class="primary" id="epGo">${isNew ? '用這張地圖開始編輯' : '套用這張底圖'}</button><button id="epCancel">取消</button></div>`;
    if (!isNew) h += `<div class="dim">套用後：地形筆刷的修改與移除的產生器物件會清掉（可以復原）。</div>`;
    $('epPanel').innerHTML = h;
    this.edPickSync();
    this.edPickInfo();
    const ch = () => this.edPickChanged();
    for (const id of ['epTheme', 'epBase', 'epVariant', 'epProps', 'epTod', 'epWeather', 'epSeed'])
      $(id).onchange = () => {
        if (id === 'epTheme') $('epVariant').value = '';
        // 空白 → 產生器：產生器物件預設全部保留（空白底圖存的是「不留」）
        if (id === 'epBase' && $('epBase').value === 'gen' && $('epProps').value === 'none')
          $('epProps').value = 'all';
        ch();
      };
    const seed = (d) => {
      $('epSeed').value = d === 0 ? rndSeed() : Math.max(1, (+$('epSeed').value || 1) + d);
      this.edPickChanged(true);
    };
    $('epPrev').onclick = () => seed(-1);
    $('epNext').onclick = () => seed(1);
    $('epRand').onclick = () => seed(0);
    $('epGrid').onclick = () => this.edPickGridRun();
    $('epTop').onclick = () => {
      this.edPickView('top');
      this.edPickRender();
    };
    $('epTilt').onclick = () => {
      this.edPickView('tilt');
      this.edPickRender();
    };
    $('epOrbit').onclick = () => {
      P.orbit = !P.orbit;
      if (P.orbit && P.view === 'top') this.edPickView('tilt');
      this.edPickRender();
    };
    $('epGo').onclick = () => this.edPickGo();
    $('epCancel').onclick = () => this.edPickCancel();
  },
  // 點歷史的縮圖：回到那張
  edPickFromHist(i) {
    const P = this.ed.pick;
    const h = P.hist[i];
    if (!h || P.busy) return;
    P.fromHist = true;
    this.edPickBuild({ ...h.base });
    this.edPickRender();
    P.hist.unshift(P.hist.splice(P.hist.indexOf(h), 1)[0]);
    this.edPickHist();
  },
  // 並排比較：目前的參數＋6 個隨機種子，一張一張產生俯視縮圖
  async edPickGridRun() {
    const ed = this.ed,
      P = ed.pick;
    if (!P || P.busy) return;
    const base = this.edPickRead();
    const seeds = Array.from({ length: GRID }, rndSeed);
    P.busy = true;
    P.grid = seeds.map((s) => ({ seed: s, thumb: '', info: null }));
    const el = $('edPickGrid');
    el.hidden = false;
    this.edPickGridRender();
    const keep = { ...ed.cam };
    P.gridStop = false;
    for (const g of P.grid) {
      if (!this.ed || this.ed.pick !== P || P.gridStop) break;
      await new Promise((r) => setTimeout(r, 30));
      Object.assign(this.edCur().base, base, { seed: g.seed });
      this.edCur().terrain = { n: 0, h: '', water: this.edCur().terrain.water };
      this.edCur().removed = [];
      this.edBuildWorld();
      this.edPickView('top');
      this.edCamApply();
      g.thumb = this.edThumb();
      g.info = this.edPickSummary();
      this.edPickGridRender();
    }
    if (!this.ed || this.ed.pick !== P) return;
    P.busy = false;
    ed.cam = keep;
    // 比較完回到原本的種子
    if (!P.chosen) this.edPickBuild({ ...base });
    P.chosen = false;
  },
  edPickGridRender() {
    const P = this.ed.pick;
    if (!P || !P.grid) return;
    $('edPickGrid').innerHTML =
      `<div class="panel"><div class="row"><b class="edHead">並排比較（俯視）</b><span class="grow"></span><button id="epGridClose">關閉</button></div><div class="epGridList">${P.grid
        .map(
          (g, i) =>
            `<button class="epCell" data-eg="${i}"${g.thumb ? '' : ' disabled'}>${g.thumb ? `<img src="${escHtml(g.thumb)}" alt="">` : '<span class="dim">生成中…</span>'}<span>種子 ${g.seed}${g.info ? `<br>${escHtml(g.info.feats || '沒有地形特徵')}　高低差 ${g.info.rise.toFixed(0)} m` : ''}</span></button>`,
        )
        .join('')}</div><div class="dim">點一張縮圖改用那個種子。</div></div>`;
    $('epGridClose').onclick = () => {
      P.gridStop = true;
      $('edPickGrid').hidden = true;
    };
  },
  edPickGridChoose(i) {
    const P = this.ed.pick;
    const g = P.grid && P.grid[i];
    if (!g || !g.thumb) return;
    P.gridStop = true;
    P.chosen = true;
    $('edPickGrid').hidden = true;
    const run = () => {
      if (P.busy) return setTimeout(run, 100);
      const base = { ...this.edPickRead(), seed: g.seed };
      this.edPickBuild(base);
      this.edPickRender();
    };
    run();
  },
  // 確定
  async edPickGo() {
    const ed = this.ed,
      P = ed.pick;
    if (P.busy) return setTimeout(() => this.ed && this.ed.pick === P && this.edPickGo(), 200); // 生成中：等它建完
    if (P.t > 0) {
      P.t = 0;
      this.edPickBuild();
    }
    if (P.mode === 'new') {
      const name = ($('epName').value || '').trim().slice(0, LIMITS.name);
      ed.L.name = name || '新關卡';
      ed.L.base.level = Math.max(LEVEL_LV[0], Math.min(LEVEL_LV[1], Math.round(+$('epLevel').value || 5)));
      this.edPickClose();
      ed.dirty = true;
      await this.edSave(true);
      this.edMsg('已建立關卡');
      return;
    }
    // 重新選底圖：底圖前的內容放進復原紀錄
    ed.undo.push(P.before.snap);
    ed.redo = [];
    this.edPickClose();
    this.edChanged();
    this.edMsg('已換底圖（可以復原）');
  },
  edPickCancel() {
    const ed = this.ed,
      P = ed.pick;
    if (P.gridStop === false && P.busy) P.gridStop = true;
    if (P.mode === 'new') {
      ed.dirty = false;
      ed.pick = null;
      document.body.classList.remove('edPicking');
      $('edPick').hidden = true;
      $('edPickGrid').hidden = true;
      return this.edClose();
    }
    // 回到原本的底圖
    const o = JSON.parse(P.before.snap);
    const cur = this.edCur();
    for (const k of Object.keys(o)) cur[k] = o[k];
    this.edPickClose();
    this.edBuildWorld();
    this.edRenderUi();
  },
});
