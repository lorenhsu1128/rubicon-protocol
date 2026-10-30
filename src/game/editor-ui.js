// Game：關卡編輯器的面板——上方工具列、左側的調色盤（依工具）、右側的屬性、下方狀態列、設定、確認視窗。
// 觸控（平板）時左右面板可以收合；所有操作都有按鈕（不靠快捷鍵）。
import { escHtml } from '../core/html.js';
import {
  BEHAVIORS,
  CACHE_LV,
  GROUP_COLORS,
  LEVEL_LV,
  LIMITS,
  MARK_KINDS,
  UNIT_KINDS,
} from '../level/format.js';
import { unitName, unitTypes } from '../level/known.js';
import { placeById, placeList } from '../level/placeables.js';
import { LevelStore } from '../level/store.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const TOOLS = [
  ['select', '選取', 'V'],
  ['prop', '物件', '1'],
  ['terrain', '地形', '2'],
  ['unit', '單位', '3'],
  ['mark', '標記', '4'],
  ['path', '路徑', '5'],
  ['area', '區域', '6'],
  ['trig', '觸發器', '7'],
  ['set', '設定', '8'],
];
const BRUSHES = [
  ['raise', '抬高'],
  ['lower', '降低'],
  ['flat', '整平'],
  ['smooth', '平滑'],
  ['noise', '起伏'],
  ['slope', '斜坡（兩點）'],
];
const HINT = {
  select: '點選物件、單位、標記後可以拖曳移動；拖曳空地平移鏡頭。右鍵（或雙指）旋轉、滾輪（或雙指）縮放。',
  prop: '在左側選一個物件，點地面或物件頂面放置（可以疊上去）。R 旋轉 90°。',
  terrain: '按住拖曳塗抹地形；斜坡是點起點再點終點。',
  unit: '選好種類與群組後點地面放置。',
  mark: '選一種標記後點地面放置。',
  path: '新增路徑後依序點地面加點；拖曳點可以移動。',
  area: '按「新增方形／圓形」後在地面上拖曳出範圍。',
  trig: '觸發器：事件 → 條件 → 動作。',
  set: '關卡名稱、等級、時間天候、作戰區域、底圖與多段出擊。',
};
const deg = (r) => Math.round(((r || 0) * 180) / Math.PI);
const opt = (v, t, cur) =>
  `<option value="${escHtml(v)}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(t)}</option>`;
const field = (label, input) => `<label class="edF"><span>${escHtml(label)}</span>${input}</label>`;
const num = (f, v, min, max, step = 'any') =>
  `<input type="number" data-f="${f}" value="${escHtml(v)}" min="${min}" max="${max}" step="${step}">`;
const txt = (f, v, n = 40) =>
  `<input type="text" data-f="${f}" value="${escHtml(v || '')}" maxlength="${n}">`;
const chk = (f, v) => `<input type="checkbox" data-f="${f}"${v ? ' checked' : ''}>`;
const sel = (f, v, opts) =>
  `<select data-f="${f}">${Object.entries(opts)
    .map(([k, t]) => opt(k, t, v))
    .join('')}</select>`;

Object.assign(Game.prototype, {
  edUiInit() {
    const root = $('editor');
    root.innerHTML = `
      <div id="edTop" class="edBar">
        <button data-ea="back">◀ 關卡選單</button>
        <button data-ea="save" id="edSaveB">存檔</button>
        <button data-ea="undo" title="Ctrl+Z">復原</button>
        <button data-ea="redo" title="Ctrl+Y">重做</button>
        <span class="edSep"></span>
        <span id="edTools">${TOOLS.map(([k, n, key]) => `<button data-tool="${k}" title="${key}">${n}</button>`).join('')}</span>
        <span class="edSep"></span>
        <select id="edSeg" title="多段出擊：切換區段"></select>
        <button class="primary" data-ea="test" title="P：從頭試玩（通關才能上傳）">▶ 試玩</button>
        <button data-ea="testHere" title="從鏡頭注視的位置開始（只玩這一段）">從這裡試玩</button>
        <button data-ea="panels" class="edTouchOnly">面板</button>
      </div>
      <div id="edLeft" class="edSide"></div>
      <div id="edRight" class="edSide"></div>
      <div id="edStat" class="edStat"></div>
      <div id="edTrig" class="edOverlay" hidden></div>
      <div id="edPick" hidden><div id="epPanel" class="edSide"></div><div id="epHist" class="epHist"></div></div>
      <div id="edPickGrid" class="edModal" hidden></div>
      <div id="edModal" class="edModal" hidden></div>`;
    root.addEventListener('click', (e) => {
      // 挑底圖：歷史的縮圖、並排比較的格子（editor-pick.js）
      const ph = e.target.closest('[data-eh],[data-eg]');
      if (ph && this.ed && this.ed.pick) {
        if (ph.dataset.eh !== undefined) return this.edPickFromHist(+ph.dataset.eh);
        return this.edPickGridChoose(+ph.dataset.eg);
      }
      const t = e.target.closest(
        '[data-tool],[data-ea],[data-pp],[data-uk],[data-ut],[data-mk],[data-bk],[data-li],[data-pa],[data-ar]',
      );
      if (!t || !this.ed) return;
      if (t.dataset.tool) return this.edSetTool(t.dataset.tool);
      if (t.dataset.ea) return this.edAction(t.dataset.ea, t);
      if (t.dataset.pp) {
        this.ed.place = this.ed.place === t.dataset.pp ? null : t.dataset.pp;
        this.ed.genMode = false;
        return this.edRenderPalette();
      }
      if (t.dataset.uk) {
        this.ed.unitKind = t.dataset.uk;
        this.ed.unitType = (unitTypes(t.dataset.uk)[0] || {}).id || '';
        return this.edRenderPalette();
      }
      if (t.dataset.ut) {
        this.ed.unitType = t.dataset.ut;
        return this.edRenderPalette();
      }
      if (t.dataset.mk) {
        this.ed.markKind = t.dataset.mk;
        return this.edRenderPalette();
      }
      if (t.dataset.bk) {
        this.ed.brush.k = t.dataset.bk;
        this.ed.slopeA = null;
        return this.edRenderPalette();
      }
      if (t.dataset.li) {
        const [k, i] = t.dataset.li.split(':');
        this.edSelect({ t: k, i: +i });
        return this.edFocus();
      }
      if (t.dataset.pa) {
        const i = +t.dataset.pa;
        this.ed.pathAdd = this.ed.pathAdd === i ? null : i;
        this.edSelect({ t: 'path', i });
        return this.edRenderPalette();
      }
      if (t.dataset.ar) {
        this.ed.areaNew = this.ed.areaNew === t.dataset.ar ? null : t.dataset.ar;
        return this.edRenderPalette();
      }
    });
    root.addEventListener('change', (e) => this.edFieldChange(e));
    root.addEventListener('input', (e) => {
      if (e.target.id === 'edPropQ' || e.target.id === 'edUnitQ' || e.target.id === 'edListQ')
        this.edRenderPalette(true);
      if (e.target.dataset.brush) {
        this.ed.brush[e.target.dataset.brush] = +e.target.value;
        const o = e.target.parentElement.querySelector('output');
        if (o) o.textContent = e.target.value;
      }
    });
    $('edSeg').onchange = (e) => {
      const v = e.target.value;
      if (v === 'add') return this.edAddSeg();
      this.edSetSeg(+v);
    };
  },
  edSetTool(t) {
    const ed = this.ed;
    ed.tool = t;
    ed.place = t === 'prop' ? ed.place : null;
    ed.pathAdd = t === 'path' ? ed.pathAdd : null;
    ed.areaNew = null;
    ed.slopeA = null;
    if (t !== 'prop') ed.genMode = false;
    if (ed.cursor) ed.cursor.visible = false;
    $('edTrig').hidden = t !== 'trig';
    if (t === 'trig') this.edRenderTrig();
    this.edRebuildHelpers();
    this.edRenderUi();
  },
  edAction(a) {
    const ed = this.ed;
    if (a === 'back') return this.edClose();
    if (a === 'save') return this.edSave();
    if (a === 'undo') return this.edUndo(false);
    if (a === 'redo') return this.edUndo(true);
    if (a === 'test') return this.edTest(false);
    if (a === 'testHere') return this.edTest(true);
    if (a === 'panels') {
      document.body.classList.toggle('edHide');
      return;
    }
    if (a === 'del') return this.edDelete();
    if (a === 'dup') return this.edDuplicate();
    if (a === 'rotL') return this.edRotate(-90);
    if (a === 'rotR') return this.edRotate(90);
    if (a === 'rotl') return this.edRotate(-15);
    if (a === 'rotr') return this.edRotate(15);
    if (a === 'focus') return this.edFocus();
    if (a === 'array') {
      ed.arrN = Math.max(1, Math.min(20, Math.round(+$('edArrN').value || 3)));
      ed.arrD = Math.max(0.5, Math.min(300, +$('edArrD').value || 30));
      return this.edArray(ed.arrN, ed.arrD);
    }
    if (a === 'gen') {
      ed.genMode = !ed.genMode;
      ed.place = null;
      this.edRebuildHelpers();
      return this.edRenderPalette();
    }
    if (a === 'newGroup') return this.edNewGroup();
    if (a === 'newPath') {
      const cur = this.edCur();
      if (cur.paths.length >= LIMITS.paths) return this.edMsg(`路徑最多 ${LIMITS.paths} 條`, true);
      this.edPush();
      let n = cur.paths.length + 1;
      while (cur.paths.some((p) => p.id === 'p' + n)) n++;
      cur.paths.push({ id: 'p' + n, name: '路徑 ' + n, pts: [], loop: true });
      ed.pathAdd = cur.paths.length - 1;
      this.edChanged();
      this.edSelect({ t: 'path', i: ed.pathAdd });
      return this.edRenderPalette();
    }
    if (a === 'pathDone') {
      ed.pathAdd = null;
      const cur = this.edCur();
      // 少於 2 點的路徑拿掉
      const bad = cur.paths.findIndex((p) => p.pts.length < 2);
      if (bad >= 0) {
        cur.paths.splice(bad, 1);
        this.edSelect(null);
      }
      this.edRebuildHelpers();
      return this.edRenderPalette();
    }
    if (a === 'water') {
      const on = $('edWaterOn').checked;
      return this.edSetWater(on, $('edWaterY').value);
    }
    if (a === 'rebase') return this.edPickOpen('rebase'); // 挑底圖（editor-pick.js）
    if (a === 'zoneFull') {
      this.edPush();
      this.edCur().base.zone = null;
      this.edChanged();
      return this.edApplyZone();
    }
    if (a === 'zoneRect') {
      this.edPush();
      const L = this.world.lim;
      this.edCur().base.zone = { x0: -L * 0.6, x1: L * 0.6, z0: -L * 0.6, z1: L * 0.6 };
      this.edChanged();
      return this.edApplyZone();
    }
    if (a === 'delSeg')
      return this.edModal('刪除這一段（無法復原）？', [
        ['刪除', () => this.edDelSeg()],
        ['取消', null],
      ]);
    if (a === 'export') {
      return this.edSave(true).then(() => LevelStore.download(ed.L));
    }
    if (a === 'upload') return this.edUpload();
  },
  edApplyZone() {
    const z = this.edCur().base.zone;
    this.world.setZone(z || 'full');
    this.edRebuildHelpers();
    this.edRenderPalette();
  },
  async edUpload() {
    const ed = this.ed;
    if (!LevelStore.serverOn) return this.edMsg('要從伺服器的網址開啟遊戲才能上傳', true);
    if (!ed.L.clear) return this.edMsg('上傳前要先「▶ 試玩」從頭通關一次', true);
    await this.edSave(true);
    try {
      this.edMsg('上傳中…');
      await LevelStore.upload(ed.L);
      LevelStore.markMine(ed.L.id, true);
      this.edMsg(`已上傳「${ed.L.name}」`);
    } catch (e) {
      this.edMsg(e.message, true);
    }
  },
  edNewGroup() {
    const cur = this.edCur();
    if (cur.groups.length >= LIMITS.groups) return this.edMsg(`群組最多 ${LIMITS.groups} 個`, true);
    this.edPush();
    let n = cur.groups.length + 1;
    while (cur.groups.some((g) => g.id === 'g' + n)) n++;
    const name = String.fromCharCode(64 + Math.min(26, n)) + ' 隊';
    cur.groups.push({ id: 'g' + n, name, color: GROUP_COLORS[(n - 1) % GROUP_COLORS.length] });
    this.ed.grp = 'g' + n;
    this.edChanged();
    this.edRenderUi();
  },
  // ---------- 畫面 ----------
  edRenderUi() {
    const ed = this.ed;
    if (!ed) return;
    for (const b of document.querySelectorAll('#edTools [data-tool]'))
      b.classList.toggle('on', b.dataset.tool === ed.tool);
    const L = ed.L;
    const n = 1 + ((L.segs && L.segs.length) || 0);
    $('edSeg').innerHTML =
      Array.from({ length: n }, (_, i) =>
        opt(i, `區段 ${i + 1}${i ? '：' + ((L.segs[i - 1] || {}).name || '') : '（開場）'}`, ed.seg),
      ).join('') + opt('add', '＋ 新增區段', '');
    $('edTrig').hidden = ed.tool !== 'trig';
    // 工具列換行時，面板接在它下面
    const tb = $('edTop');
    if (tb && tb.offsetHeight) $('editor').style.setProperty('--edTop', tb.offsetHeight + 'px');
    this.edRenderPalette();
    this.edRenderInspector();
    this.edStatus();
  },
  edRenderPalette(keepFocus) {
    const ed = this.ed;
    if (!ed) return;
    const cur = this.edCur();
    const el = $('edLeft');
    const focusId = keepFocus && document.activeElement && document.activeElement.id;
    const caret = focusId ? document.activeElement.selectionStart : 0;
    let h = `<div class="edHead">${escHtml(TOOLS.find((t) => t[0] === ed.tool)[1])}</div><div class="edHint">${escHtml(HINT[ed.tool] || '')}</div>`;
    if (ed.tool === 'select') {
      const q = (($('edListQ') || {}).value || '').toLowerCase();
      const item = (k, i, name) =>
        !q || name.toLowerCase().includes(q)
          ? `<button class="edLi${ed.sel && ed.sel.t === k && ed.sel.i === i ? ' on' : ''}" data-li="${k}:${i}">${escHtml(name)}</button>`
          : '';
      h += `<input id="edListQ" placeholder="搜尋" value="${escHtml(q)}">`;
      h +=
        `<div class="edSub">單位（${cur.units.length}）</div>` +
        cur.units
          .map((u, i) =>
            item(
              'unit',
              i,
              unitName(u.kind, u.type) + '・' + ((cur.groups.find((g) => g.id === u.g) || {}).name || ''),
            ),
          )
          .join('');
      h +=
        `<div class="edSub">標記（${cur.marks.length}）</div>` +
        cur.marks.map((m, i) => item('mark', i, m.name || MARK_KINDS[m.k].name)).join('');
      h +=
        `<div class="edSub">區域（${cur.areas.length}）</div>` +
        cur.areas.map((a, i) => item('area', i, a.name)).join('');
      h +=
        `<div class="edSub">路徑（${cur.paths.length}）</div>` +
        cur.paths.map((p, i) => item('path', i, p.name)).join('');
      h +=
        `<div class="edSub">物件（${cur.props.length}）</div>` +
        cur.props
          .map((p, i) =>
            item('prop', i, ((placeById(p.t) || {}).name || p.t) + (p.tag ? '［' + p.tag + '］' : '')),
          )
          .join('');
    } else if (ed.tool === 'prop') {
      const all = placeList();
      const cats = [...new Set(all.map((d) => d.cat))];
      const T = THEMES[cur.base.theme];
      ed.propCat = ed.propCat || '結構';
      const q = (($('edPropQ') || {}).value || '').toLowerCase();
      h += `<div class="row"><button data-ea="gen" class="${ed.genMode ? 'on' : ''}" title="點產生器放的物件就移除，點「✕ 已移除」還原">移除產生器物件</button></div>`;
      h += field(
        '吸附',
        `<select id="edSnap">${[0, 0.5, 1, 2.5, 5].map((v) => opt(v, v ? v + ' m' : '不吸附', ed.snap)).join('')}</select>`,
      );
      h += `<select id="edPropCat">${opt('*', '全部', ed.propCat)}${cats.map((c) => opt(c, c + (T && c === T.name ? '（這個主題）' : ''), ed.propCat)).join('')}</select>`;
      h += `<input id="edPropQ" placeholder="搜尋物件" value="${escHtml(q)}">`;
      const list = all.filter(
        (d) =>
          (ed.propCat === '*' || d.cat === ed.propCat) && (!q || (d.name + d.cat).toLowerCase().includes(q)),
      );
      h += `<div class="edGrid">${list
        .map(
          (d) =>
            `<button class="edPi${ed.place === d.id ? ' on' : ''}" data-pp="${escHtml(d.id)}" title="${escHtml(d.note || '')}">${escHtml(d.name)}</button>`,
        )
        .join('')}</div>`;
      h += `<div class="dim">物件 ${cur.props.length}／${LIMITS.props}</div>`;
    } else if (ed.tool === 'terrain') {
      const B = ed.brush;
      h += `<div class="edGrid">${BRUSHES.map(([k, n]) => `<button class="edPi${B.k === k ? ' on' : ''}" data-bk="${k}">${n}</button>`).join('')}</div>`;
      h += `<label class="edF"><span>半徑</span><input type="range" data-brush="r" min="6" max="120" step="3" value="${B.r}"><output>${B.r}</output></label>`;
      h += `<label class="edF"><span>強度</span><input type="range" data-brush="s" min="0.2" max="3" step="0.1" value="${B.s}"><output>${B.s}</output></label>`;
      const W = this.world.theme.water;
      const wl = cur.terrain.water;
      h += `<div class="edSub">水面</div><label class="edF"><span>自訂水面</span><input type="checkbox" id="edWaterOn"${wl !== null && wl !== undefined ? ' checked' : ''}></label>`;
      h += `<label class="edF"><span>高度 m</span><input type="number" id="edWaterY" step="0.1" value="${wl !== null && wl !== undefined ? wl : W ? W.level : 0}"></label><button data-ea="water">套用水面</button>`;
      h += `<div class="dim">紅色的地方坡度太陡，機甲走不上去（要跳或推進）。</div>`;
    } else if (ed.tool === 'unit') {
      const q = (($('edUnitQ') || {}).value || '').toLowerCase();
      h += `<div class="edGrid">${Object.entries(UNIT_KINDS)
        .map(([k, n]) => `<button class="edPi${ed.unitKind === k ? ' on' : ''}" data-uk="${k}">${n}</button>`)
        .join('')}</div>`;
      h +=
        field(
          '群組',
          `<select id="edGrpSel">${cur.groups.map((g) => opt(g.id, g.name, ed.grp)).join('')}</select>`,
        ) + `<button data-ea="newGroup">＋ 新增群組</button>`;
      h += `<input id="edUnitQ" placeholder="搜尋" value="${escHtml(q)}">`;
      h += `<div class="edList">${unitTypes(ed.unitKind)
        .filter((t) => !q || (t.name + t.note).toLowerCase().includes(q))
        .map(
          (t) =>
            `<button class="edLi${ed.unitType === t.id ? ' on' : ''}" data-ut="${escHtml(t.id)}">${escHtml(t.name)}<small>${escHtml(t.note || '')}</small></button>`,
        )
        .join('')}</div>`;
      h += `<div class="dim">單位 ${cur.units.length}／${LIMITS.units}${ed.unitKind === 'convoy' ? '　護送車輛要在屬性指定路徑' : ''}</div>`;
    } else if (ed.tool === 'mark') {
      h += `<div class="edList">${Object.entries(MARK_KINDS)
        .map(
          ([k, K]) =>
            `<button class="edLi${ed.markKind === k ? ' on' : ''}" data-mk="${k}"><span class="edDot" style="background:#${K.color.toString(16).padStart(6, '0')}"></span>${escHtml(K.name)}${K.max ? `<small>最多 ${K.max} 個</small>` : ''}</button>`,
        )
        .join('')}</div>`;
    } else if (ed.tool === 'path') {
      h += `<div class="row"><button data-ea="newPath">＋ 新增路徑</button>${ed.pathAdd !== null && ed.pathAdd !== undefined ? '<button class="primary" data-ea="pathDone">完成</button>' : ''}</div>`;
      h += `<div class="edList">${cur.paths
        .map(
          (p, i) =>
            `<button class="edLi${ed.pathAdd === i ? ' on' : ''}" data-pa="${i}">${escHtml(p.name)}<small>${p.pts.length} 點${ed.pathAdd === i ? '・加點中' : ''}</small></button>`,
        )
        .join('')}</div>`;
    } else if (ed.tool === 'area') {
      h += `<div class="row"><button class="${ed.areaNew === 'box' ? 'on' : ''}" data-ar="box">＋ 新增方形</button><button class="${ed.areaNew === 'circle' ? 'on' : ''}" data-ar="circle">＋ 新增圓形</button></div>`;
      h += `<div class="edList">${cur.areas.map((a, i) => `<button class="edLi" data-li="area:${i}">${escHtml(a.name)}<small>${a.sh === 'circle' ? '圓形' : '方形'}${a.show ? '・顯示' : ''}</small></button>`).join('')}</div>`;
    } else if (ed.tool === 'trig') {
      h += `<div class="dim">觸發器 ${cur.triggers.length}／${LIMITS.triggers}　群組 ${cur.groups.length}　計數器 ${cur.counters.length}</div>`;
    } else if (ed.tool === 'set') h += this.edSettingsHtml();
    el.innerHTML = h;
    const snap = $('edSnap');
    if (snap) snap.onchange = (e) => (ed.snap = +e.target.value);
    const pc = $('edPropCat');
    if (pc)
      pc.onchange = (e) => {
        ed.propCat = e.target.value;
        this.edRenderPalette();
      };
    const gs = $('edGrpSel');
    if (gs) gs.onchange = (e) => (ed.grp = e.target.value);
    const bt = $('edBTheme');
    if (bt)
      bt.onchange = () => {
        const vs = VARIANTS[bt.value] || {};
        $('edBVariant').innerHTML =
          opt('', '標準', '') +
          Object.keys(vs)
            .filter((k) => !vs[k].border)
            .map((k) => opt(k, vs[k].name || k, ''))
            .join('');
      };
    if (focusId && $(focusId)) {
      $(focusId).focus();
      try {
        $(focusId).setSelectionRange(caret, caret);
      } catch (e) {}
    }
  },
  edSettingsHtml() {
    const ed = this.ed,
      L = ed.L,
      cur = this.edCur(),
      B = cur.base;
    const vs = VARIANTS[B.theme] || {};
    let h = '';
    h += `<div class="edSub">關卡</div>`;
    h += field('名稱', txt('L.name', L.name, LIMITS.name));
    h += field('作者', txt('L.author', L.author, 24));
    h += `<label class="edF col"><span>說明</span><textarea data-f="L.desc" maxlength="${LIMITS.desc}" rows="3">${escHtml(L.desc || '')}</textarea></label>`;
    h += field('等級', num('B.level', B.level, LEVEL_LV[0], LEVEL_LV[1], 1));
    h += field('建議人數', num('L.base.np', L.base.np || 1, 1, 4, 1));
    h += field(
      '時間',
      sel('B.tod', B.tod, { '': '主題預設', day: '白天', dusk: '黃昏', night: '夜間', dawn: '黎明' }),
    );
    h += field(
      '天候',
      sel('B.weather', B.weather, {
        '': '主題預設',
        none: '晴',
        rain: '雨',
        snow: '雪',
        sand: '沙暴',
        dust: '塵埃',
        ash: '落灰',
      }),
    );
    h += field(
      '地圖上的小人',
      sel('B.crowd', B.crowd || 'auto', { auto: '隨機（主題的平民與步兵）', placed: '只有擺放的' }),
    );
    h += `<div class="edSub">作戰區域</div><div class="row"><button data-ea="zoneFull" class="${B.zone ? '' : 'on'}">全場</button><button data-ea="zoneRect" class="${B.zone ? 'on' : ''}">自訂矩形</button></div>`;
    if (B.zone)
      h +=
        field('X 從', num('B.zone.x0', B.zone.x0, -200, 200, 1)) +
        field('X 到', num('B.zone.x1', B.zone.x1, -200, 200, 1)) +
        field('Z 從', num('B.zone.z0', B.zone.z0, -200, 200, 1)) +
        field('Z 到', num('B.zone.z1', B.zone.z1, -200, 200, 1));
    h += `<div class="edSub">底圖${ed.seg ? `（第 ${ed.seg + 1} 段）` : ''}</div>`;
    {
      const vn = B.variant ? (vs[B.variant] || {}).name || B.variant : '';
      h += `<div>${escHtml(THEMES[B.theme].name)}${B.blank ? '・空白' : vn ? '・' + escHtml(vn) : ''}　種子 ${B.seed}${B.blank ? '' : `　產生器物件：${{ all: '全部', big: '只留大型', none: '不留' }[B.props]}`}</div>`;
    }
    h += `<button data-ea="rebase">選擇底圖…（預覽後再套用）</button>`;
    h += `<div class="edSub">多段出擊</div><div class="dim">目前第 ${ed.seg + 1} 段，共 ${1 + ((L.segs && L.segs.length) || 0)} 段；走進出口或觸發器「前往下一段」時轉場，AP 與彈藥帶到下一段。</div>`;
    if (ed.seg)
      h +=
        field('這段的名稱', txt('S.name', cur.name, LIMITS.name)) +
        `<button data-ea="delSeg">刪除這一段</button>`;
    h += `<div class="edSub">檢查</div>`;
    const v = this.edValidate();
    h += v.length
      ? `<ul class="edWarn">${v.map((x) => `<li class="${x.err ? 'err' : ''}">${escHtml(x.msg)}</li>`).join('')}</ul>`
      : '<div class="ok">沒有問題</div>';
    h += `<div class="edSub">通關與分享</div><div class="${L.clear ? 'ok' : 'dim'}">${L.clear ? `已通關（${L.clear.t} 秒）：可以上傳` : '還沒通關：從頭「▶ 試玩」並通關後才能上傳'}</div>`;
    h += `<div class="row"><button data-ea="save">存檔</button><button data-ea="export">匯出檔案</button>${LevelStore.serverOn ? `<button data-ea="upload"${L.clear ? '' : ' disabled'}>上傳到伺服器</button>` : ''}</div>`;
    return h;
  },
  // 右側：選中的東西的屬性
  edRenderInspector() {
    const ed = this.ed;
    if (!ed) return;
    const el = $('edRight');
    const s = ed.sel,
      cur = this.edCur();
    const o = this.edRefObj(s);
    if (!o) {
      el.innerHTML = `<div class="edHead">屬性</div><div class="dim">點選物件、單位、標記、路徑或區域</div>`;
      el.classList.add('empty');
      return;
    }
    el.classList.remove('empty');
    const btns = (rot) =>
      `<div class="row">${rot ? '<button data-ea="rotL">⟲ 90°</button><button data-ea="rotl">⟲ 15°</button><button data-ea="rotr">⟳ 15°</button><button data-ea="rotR">⟳ 90°</button>' : ''}</div><div class="row"><button data-ea="focus">對準</button>${s.t !== 'path' && s.t !== 'pathpt' ? '<button data-ea="dup">複製</button>' : ''}<button data-ea="del" class="danger">刪除</button></div>`;
    const pos = field('X', num('x', o.x, -300, 300, 0.5)) + field('Z', num('z', o.z, -300, 300, 0.5));
    // 陣列複製：沿著物件的 X 方向（朝向轉過的）排成一排
    const arr = () =>
      `<div class="edSub">陣列複製</div>${field('數量', `<input type="number" id="edArrN" value="${ed.arrN || 3}" min="1" max="20" step="1">`)}${field('間距 m', `<input type="number" id="edArrD" value="${ed.arrD || 30}" min="0.5" max="300" step="0.5">`)}<button data-ea="array">沿 X 方向複製成一排</button>`;
    let h = '';
    if (s.t === 'prop') {
      const def = placeById(o.t) || { name: o.t };
      h += `<div class="edHead">${escHtml(def.name)}</div>`;
      h += pos + field('高度', num('y', o.y, -100, 200, 0.1)) + field('貼地（跟著地形）', chk('g', o.g));
      h += field('朝向°', num('yawd', deg(o.yaw), -360, 360, 1));
      if (def.struct) {
        const lab = def.ramp ? ['長', '高低差', '寬'] : ['寬 X', '高 Y', '深 Z'];
        for (let i = 0; i < 3; i++)
          h += field(lab[i] + ' m', num('dim.' + i, +(def.dims[i] * o.s[i]).toFixed(2), 0.2, 200, 0.1));
      } else {
        h += field('縮放', num('sall', o.s[0], 0.2, 8, 0.05));
        h += field('高度縮放', num('s.1', o.s[1], 0.2, 8, 0.05));
      }
      if (!def.ramp)
        h += field('碰撞', sel('col', o.col, { box: '方塊（外框）', circle: '圓柱', none: '無（純裝飾）' }));
      if (!def.ramp) h += field('耐久（0＝不可破壞）', num('hp', o.hp, 0, 99999, 50));
      h += field('標籤（觸發器用）', txt('tag', o.tag, 24));
      if (o.yaw && Math.abs(o.yaw % (Math.PI / 2)) > 0.01 && o.col === 'box')
        h += '<div class="dim">斜放時碰撞用轉過之後的外框，會比外觀大。</div>';
      h += btns(true) + arr();
    } else if (s.t === 'unit') {
      h += `<div class="edHead">${escHtml(unitName(o.kind, o.type))}</div>`;
      h += field(
        '類型',
        sel('type', o.type, Object.fromEntries(unitTypes(o.kind).map((t) => [t.id, t.name]))),
      );
      h += field('群組', sel('g', o.g, Object.fromEntries(cur.groups.map((g) => [g.id, g.name]))));
      h += field('出現', sel('at', o.at, { start: '一開始就在', trig: '等觸發器「生成群組」' }));
      h += field('強度（AP 倍率）', num('k', o.k, 0.2, 5, 0.1));
      if (o.kind === 'convoy') {
        h += field(
          '路徑',
          sel('beh.path', o.beh.path, {
            '': '（選擇）',
            ...Object.fromEntries(cur.paths.map((p) => [p.id, p.name])),
          }),
        );
        h += field('速度', num('beh.speed', o.beh.speed, 0.2, 1.5, 0.05));
      } else {
        h += field('行為', sel('beh.k', o.beh.k, BEHAVIORS));
        if (o.beh.k === 'patrol') {
          h += field(
            '路徑',
            sel('beh.path', o.beh.path, {
              '': '（選擇）',
              ...Object.fromEntries(cur.paths.map((p) => [p.id, p.name])),
            }),
          );
          h += field('發現距離 m', num('beh.r', o.beh.r, 5, 120, 1));
          h += field('速度', num('beh.speed', o.beh.speed, 0.2, 1.5, 0.05));
          h += field('沒看到玩家就回到路徑', chk('beh.back', o.beh.back));
        } else if (o.beh.k === 'guard') h += field('警戒半徑 m', num('beh.r', o.beh.r, 5, 120, 1));
        else if (o.beh.k === 'retreat')
          h += field(
            '撤退到',
            sel('beh.m', o.beh.m, {
              '': '（選擇增援地點）',
              ...Object.fromEntries(cur.marks.filter((m) => m.k === 'spawnpt').map((m) => [m.id, m.name])),
            }),
          );
      }
      h += field('朝向°', num('yawd', deg(o.yaw), -360, 360, 1)) + pos + btns(true) + arr();
    } else if (s.t === 'mark') {
      const K = MARK_KINDS[o.k];
      h += `<div class="edHead">${escHtml(K.name)}</div>` + field('名稱', txt('name', o.name, LIMITS.name));
      if (o.k === 'cache') h += field('獎勵', sel('cache', o.cache, CACHE_LV));
      if (o.k === 'target' || o.k === 'defend') h += field('耐久倍率', num('hp', o.hp, 0.2, 10, 0.1));
      if (o.k === 'term') h += field('站幾秒', num('t', o.t, 1, 60, 1));
      if (o.k === 'exit') h += field('一開始就開啟', chk('open', o.open));
      if (o.k === 'supply') h += field('只能用一次', chk('once', o.once));
      if (o.k === 'spawn') h += field('朝向°', num('yawd', deg(o.yaw), -360, 360, 1));
      h += pos + btns(o.k === 'spawn');
    } else if (s.t === 'path' || s.t === 'pathpt') {
      h += `<div class="edHead">路徑</div>` + field('名稱', txt('name', o.name, LIMITS.name));
      h += field('走法', sel('loop', o.loop ? '1' : '0', { 1: '循環（走回第一點）', 0: '來回' }));
      h += `<div class="dim">${o.pts.length} 點</div><div class="row"><button data-pa="${s.i}">${ed.pathAdd === s.i ? '停止加點' : '繼續加點'}</button></div>`;
      if (s.t === 'pathpt')
        h +=
          `<div class="edSub">第 ${s.j + 1} 點</div>` +
          field('停留秒數', num('pt.wait', o.pts[s.j][2] || 0, 0, 60, 0.5));
      h += `<div class="row"><button data-ea="focus">對準</button><button data-ea="del" class="danger">${s.t === 'pathpt' ? '刪除這個點' : '刪除路徑'}</button></div>`;
    } else if (s.t === 'area') {
      h += `<div class="edHead">區域</div>` + field('名稱', txt('name', o.name, LIMITS.name));
      h += field('形狀', sel('sh', o.sh, { box: '方形', circle: '圓形' }));
      if (o.sh === 'circle') h += field('半徑 m', num('r', o.r, 1, 200, 0.5));
      else
        h +=
          field('寬 X m', num('w', o.w, 2, 400, 0.5)) +
          field('深 Z m', num('d', o.d, 2, 400, 0.5)) +
          field('朝向°', num('yawd', deg(o.yaw), -360, 360, 1));
      h += field('遊玩時一開始就顯示', chk('show', o.show));
      h += field(
        '顏色',
        sel(
          'color',
          o.color,
          Object.fromEntries(
            GROUP_COLORS.map((c, i) => [c, ['紅', '橙', '綠', '藍', '紫', '粉', '黃', '青'][i]]),
          ),
        ),
      );
      h += pos + btns(o.sh === 'box');
    }
    el.innerHTML = h;
  },
  // 欄位修改（左右面板共用）：data-f 的路徑寫回關卡
  edFieldChange(e) {
    const t = e.target;
    const f = t.dataset && t.dataset.f;
    if (!f || !this.ed) return;
    const ed = this.ed,
      cur = this.edCur();
    const v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? +t.value : t.value;
    if (t.type === 'number' && !Number.isFinite(v)) return;
    this.edPush();
    // 設定
    if (f.startsWith('L.') || f.startsWith('B.') || f.startsWith('S.')) {
      const root = f[0] === 'L' ? ed.L : f[0] === 'B' ? cur.base : cur;
      const ks = f.slice(2).split('.');
      let o = root;
      for (const k of ks.slice(0, -1)) o = o[k];
      o[ks[ks.length - 1]] = v;
      this.edChanged();
      if (f === 'B.tod' || f === 'B.weather') {
        // 時間與天候：重建光線（不重算地形）
        this.edBuildWorld();
      }
      if (f.startsWith('B.zone')) this.edApplyZone();
      if (f === 'S.name') this.edRenderUi();
      return;
    }
    const s = ed.sel;
    const o = this.edRefObj(s);
    if (!o) return;
    if (f === 'yawd') o.yaw = +((v * Math.PI) / 180).toFixed(4);
    else if (f === 'sall') {
      o.s[0] = o.s[2] = v;
    } else if (f.startsWith('dim.')) {
      const i = +f[4];
      const def = placeById(o.t);
      o.s[i] = +(v / def.dims[i]).toFixed(4);
    } else if (f === 'pt.wait') o.pts[s.j][2] = v;
    else if (f === 'loop') o.loop = v === '1';
    else if (f === 'color') o.color = +v;
    else if (f === 'g' && s.t === 'prop') {
      // 貼地切換：保持目前的實際高度
      const gy = this.world.terrainHeight(o.x, o.z);
      o.y = +(v ? o.y - gy : o.y + gy).toFixed(2);
      o.g = v;
    } else {
      const ks = f.split('.');
      let p = o;
      for (const k of ks.slice(0, -1)) p = p[k];
      p[ks[ks.length - 1]] = v;
    }
    if (s.t === 'unit' && f === 'type') o.type = v;
    if ((s.t === 'unit' || s.t === 'mark') && (f === 'x' || f === 'z'))
      o.y = +this.world.groundAt(o.x, o.z, 999).toFixed(2);
    if (s.t === 'prop') this.edSyncProps();
    this.edChanged();
    this.edRebuildHelpers();
    this.edRenderInspector();
  },
  edStatus() {
    const ed = this.ed;
    const el = $('edStat');
    if (!ed || !el) return;
    const cur = this.edCur(),
      w = this.world;
    const hv = ed.hover;
    let s = '';
    if (hv && w) {
      const ok = w.slopeOK(hv.x, hv.z);
      s += `X ${hv.x.toFixed(1)}　Z ${hv.z.toFixed(1)}　高度 ${hv.y.toFixed(1)} m　${ok ? '坡度 OK' : '<b class="bad">坡度太陡</b>'}　`;
    }
    s += `物件 ${cur.props.length}／${LIMITS.props}　單位 ${cur.units.length}／${LIMITS.units}　觸發器 ${cur.triggers.length}`;
    s += `　｜　${ed.dirty ? '<b class="warnT">未存檔</b>' : '已存檔'}${ed.L.clear ? '　<span class="ok">已通關</span>' : ''}`;
    if (ed.msg) s += `　｜　<b class="${ed.msgErr ? 'bad' : 'ok'}">${escHtml(ed.msg)}</b>`;
    el.innerHTML = s;
  },
  // 確認視窗（不用瀏覽器的 confirm）：buttons＝[[文字, 函式或 null]]
  edModal(text, buttons) {
    const el = $('edModal');
    el.innerHTML = `<div class="panel"><p>${escHtml(text)}</p><div class="row">${buttons
      .map(([t], i) => `<button data-mi="${i}"${i === 0 ? ' class="primary"' : ''}>${escHtml(t)}</button>`)
      .join('')}</div></div>`;
    el.hidden = false;
    el.onclick = (e) => {
      const b = e.target.closest('[data-mi]');
      if (!b) return;
      el.hidden = true;
      const fn = buttons[+b.dataset.mi][1];
      if (fn) fn();
    };
  },
});
