// Game：本地模型庫（單人模式套用模型庫存在瀏覽器裡的 GLB 與關節設定）
// 讀取時機：進車庫、單機出擊前（沒有變動的檔案沿用快取），以及標題畫面的「重新載入本地模型」
import { Game } from './game.js';
import { escHtml } from '../core/html.js';
import { LM_GROUPS, LocalModels, SERVER_SET, setScoped } from '../render/local-models.js';
import { RemoteSets, ServerModels, onServer } from '../render/net-models.js';
import { MODEL_CATALOG } from '../render/model-catalog.js';
import { checkGlb } from '../render/glb.js';
import { measureBox } from '../render/measure.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { PIECE_ORIGIN } from '../render/mech-model.js';
import { setModelProvider } from '../render/model-provider.js';
import { SFX } from '../audio/audio.js';
import { partById } from '../data/parts.js';

const $ = (id) => document.getElementById(id);
const CATALOG = new Map(MODEL_CATALOG.map((e) => [e.id, e]));
// 機甲清單換上的部位（組裝鍵、零件分類）；發電機、火控與消耗品保留目前的
const MECH_KEYS = [
  ['head', 'head'],
  ['core', 'core'],
  ['arms', 'arms'],
  ['legs', 'legs'],
  ['booster', 'booster'],
  ['rarm', 'arm'],
  ['larm', 'arm'],
  ['rback', 'back'],
  ['lback', 'back'],
];

// 程式模型在 GLB 製作尺寸（×1）下的外框（規格檢查的參考）；建立時暫停套用本地模型，避免拿 GLB 跟自己比
function referenceBox(entry) {
  const b = LocalModels.suspend(() => entry.build(entry.pal));
  b.scaleNode.scale.set(1, 1, 1);
  let box = measureBox(b.obj, entry.measureFx);
  if (box.isEmpty()) box = measureBox(b.obj, true);
  b.obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (m !== OUTLINE_MAT) m.dispose();
  });
  return box;
}
function checker(id, root, info, bytes) {
  const entry = CATALOG.get(id);
  // 不會用到的槽位當成失敗（例如整台載具的舊檔，現在要放到各區塊）
  if (!entry) throw new Error('模型目錄沒有這個槽位，不會用到');
  if (entry.noGlb)
    throw new Error(
      entry.parts && !entry.parts.length
        ? '這個物件不接受 GLB（維持程式模型）'
        : '這個模型由各區塊組成，請把 GLB 放到各區塊的槽位',
    );
  return checkGlb({
    root,
    info,
    bytes,
    spec: entry.spec,
    ref: referenceBox(entry),
    origin: entry.piece ? PIECE_ORIGIN[entry.piece.kind] : entry.origin || '地面中心（模型底面中心）',
    pivotFree: !!entry.piece,
  });
}

Object.assign(Game.prototype, {
  // 模型來源：
  // - 直接開檔：單人用本地模型庫（所有機甲與物件），多人一律程式模型
  // - 伺服器網址：機甲依 mechSource 指定模型組；其他物件單人時本地模型庫（載具／地圖物件／小物件）優先，
  //   再來是伺服器預設組；多人只用伺服器預設組（各端一致）
  lmInit() {
    LocalModels.allow = () => !(this.net && this.net.role);
    LocalModels.applyJoints();
    setModelProvider((slot, pal, unique) => {
      if (!onServer()) return LocalModels.model(slot, pal, unique);
      if (!setScoped(slot)) {
        const own = LocalModels.model(slot, pal, unique);
        if (own) return own;
      }
      return ServerModels.model(slot, pal, unique);
    });
  },
  // 機甲用哪一個模型組（buildMech 的 opts.source；null＝全域來源）。o 是 MechEntity 的 opts
  // 伺服器網址：玩家機甲（單人）本地模型庫選的模型組，沒有就用伺服器預設組；玩家機甲（多人）用該玩家上傳的模型組
  // （o.ms，還沒下載好或沒上傳時用伺服器預設組）；敵人、友軍、電腦 AC 一律伺服器預設組
  mechSource(o = {}) {
    if (!onServer()) return null;
    const human = o.team === 'player' && o.slot !== undefined && o.slot >= 0 && !o.pvpAi && !o.modelKind;
    if (human) {
      if (!(this.net && this.net.role)) return LocalModels.mySource() || ServerModels.source();
      return RemoteSets.get(o.ms) || ServerModels.source();
    }
    return ServerModels.source();
  },
  // 進度條（只有真的要下載或解析檔案才顯示）
  lmProgress(title, manual) {
    const box = $('lmLoad');
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      $('lmLoadTitle').textContent = title;
      box.classList.add('on');
    };
    if (manual) show();
    return {
      step: (done, total, id) => {
        if (id && done < total) show();
        if (!shown) return;
        $('lmLoadBar').style.width = (total ? (done / total) * 100 : 100) + '%';
        $('lmLoadTxt').textContent = total ? `${done}／${total}　${id || ''}` : '';
      },
      end: () => {
        if (!manual) box.classList.remove('on');
      },
    };
  },
  // 伺服器網址：重新讀取伺服器預設組（沒變動就沿用）
  async srvRefresh() {
    if (!onServer()) return null;
    const p = this.lmProgress('讀取伺服器模型組…', false);
    const set = await ServerModels.refresh(p.step);
    p.end();
    return set;
  },
  // 重新讀取本地模型庫（伺服器網址時也讀伺服器預設組）；manual：標題畫面的按鈕（一律顯示進度與結果）
  // 自動讀取時只有需要解析檔案才顯示進度條
  async lmRefresh(manual = false) {
    await this.srvRefresh();
    if (!LocalModels.active()) {
      if (manual) this.lmShowResult(LocalModels.settings.on ? '多人連線中不使用本地模型' : null);
      return LocalModels.status;
    }
    const p = this.lmProgress('讀取本地模型庫…', manual);
    const st = await LocalModels.reload(p.step, checker);
    if (manual) this.lmShowResult();
    else p.end();
    if (this.state === 'settings') this.renderLocalModels();
    return st;
  },
  // 伺服器預設組的狀態文字（設定畫面、標題的重新載入）
  srvSummary() {
    const set = ServerModels.source();
    if (ServerModels.error) return '讀不到伺服器模型組（' + ServerModels.error + '）';
    if (!set) return '尚未讀取';
    const s = set.stats();
    return `GLB ${s.glb} 個` + (s.fail ? `、失敗 ${s.fail} 個` : '') + `；關節設定 ${s.joints} 個`;
  },
  lmSummary(st = LocalModels.status) {
    if (!LocalModels.settings.on) return '未開啟';
    if (!st) return '尚未讀取';
    if (!st.db) return '讀不到模型庫的資料';
    const fail = st.slots.filter((s) => s.err).length;
    const warn = st.slots.filter((s) => !s.err && s.checks.length).length;
    const used = st.slots.filter((s) => s.on && !s.err).length;
    return (
      `套用 GLB ${used} 個` +
      (fail ? `、失敗 ${fail} 個` : '') +
      (warn ? `、有提醒 ${warn} 個` : '') +
      `；關節設定 ${LocalModels.settings.groups.mech !== false ? st.joints : 0} 個`
    );
  },
  // 結果停留約 2.5 秒（點一下關閉）；msg 為 null 表示總開關沒開
  lmShowResult(msg) {
    const box = $('lmLoad');
    const st = LocalModels.status;
    let txt = msg;
    if (txt === null)
      txt = onServer()
        ? '伺服器預設組：' + this.srvSummary() + '（本地模型庫沒有開啟）'
        : '本地模型庫沒有開啟：請到「按鍵與操作設定」開啟';
    else if (txt === undefined)
      txt =
        st && !st.db
          ? '讀不到模型庫的資料：遊戲和模型庫要用同一種方式開啟（同一個伺服器網址，或都直接開檔）'
          : '';
    $('lmLoadTitle').textContent = msg !== undefined ? '本地模型庫' : '本地模型庫：' + this.lmSummary();
    $('lmLoadBar').style.width = '100%';
    $('lmLoadTxt').textContent = txt;
    box.classList.add('on');
    clearTimeout(this.lmHideT);
    this.lmHideT = setTimeout(() => box.classList.remove('on'), 2500);
    box.onclick = () => box.classList.remove('on');
  },
  // 車庫：顯示這台機甲有幾個區塊用了 GLB（來自哪個模型組）
  lmGarageNote(rig, src) {
    const el = $('gLocal');
    if (!el) return;
    const n = Object.values(rig.pieces).filter((o) => o.userData.localGlb).length;
    const from = !src
      ? '本地模型庫'
      : src.id === SERVER_SET
        ? '伺服器預設組'
        : src.id.startsWith('local:')
          ? '本地模型組「' + ((LocalModels.setData && LocalModels.setData.name) || '') + '」'
          : '模型組「' + src.name + '」';
    el.textContent = n ? `${from}：此機 ${n} 個區塊使用 GLB` : '';
    el.style.display = n ? '' : 'none';
  },
  // 車庫：模型庫各模型組的機甲清單（組裝調整頁的預組）；選一台＝換上它的零件組合並改用那個模型組
  garageMechsUi() {
    const el = $('gMechs');
    if (!el) return;
    const sets = LocalModels.sets.filter((s) => s.mechs && s.mechs.length);
    el.style.display = sets.length && !this.spectator ? '' : 'none';
    if (!sets.length) return (el.innerHTML = '');
    el.innerHTML =
      `<label>模型組的機甲 <select id="gMechSel"><option value="">選擇要換上的機甲…</option>` +
      sets
        .map(
          (s, i) =>
            `<optgroup label="${escHtml(s.name || s.id)}">` +
            s.mechs.map((m, j) => `<option value="${i}/${j}">${escHtml(m.name)}</option>`).join('') +
            `</optgroup>`,
        )
        .join('') +
      `</select></label><span class="dim" style="font-size:11px">換上零件組合（頭／核心／手臂／腳部／推進器／武器），` +
      `並改用那個模型組的 GLB；零件要先擁有</span>`;
    $('gMechSel').onchange = (e) => {
      const [i, j] = e.target.value.split('/').map(Number);
      const s = sets[i];
      if (s && s.mechs[j]) this.garageUseMech(s, s.mechs[j]);
    };
  },
  garageUseMech(set, mech) {
    const missing = [];
    const keys = MECH_KEYS.filter(([key]) => mech.asm[key]);
    for (const [key, cat] of keys) {
      const id = mech.asm[key];
      const part = partById(cat, id);
      if (!part || part.id !== id || !this.save.owned.includes(id)) missing.push((part && part.name) || id);
    }
    if (missing.length) {
      this.flashMsg('無法換上：缺少零件 ' + missing.join('、'), 0xff4d4d, 2.5);
      return this.garageMechsUi();
    }
    for (const [key] of keys) this.save.asm[key] = mech.asm[key];
    const S = LocalModels.settings;
    S.set = set.id;
    S.on = true;
    LocalModels.saveSettings();
    this.writeSave();
    SFX.ui();
    this.flashMsg(`已換上「${mech.name}」（模型組「${set.name}」）`, 0x7ee081, 1.5);
    this.renderGarage();
    if (this.net && this.net.role) this.mpSyncMySet();
    else this.lmRefresh().then(() => this.state === 'garage' && this.renderGarage());
  },
  // 車庫預覽用的模型組（和出擊時同一個規則）
  garageSource() {
    const n = this.net;
    const mp = !!(n && n.role);
    return this.mechSource({
      team: 'player',
      slot: mp ? n.me : 0,
      ms: mp && this.mySet ? this.mySet.hash : null,
    });
  },
  // 設定畫面的「本地模型庫」區塊
  renderLocalModels() {
    const el = $('lmBox');
    if (!el) return;
    const S = LocalModels.settings;
    const st = LocalModels.status;
    const cnt = (g) => (st && st.slots ? st.slots.filter((s) => s.group === g).length : 0);
    const srv = onServer();
    // 第一次打開設定時還沒讀過伺服器預設組：讀完再重畫
    if (srv && !ServerModels.source() && !ServerModels.loading && !ServerModels.error)
      this.srvRefresh().then(() => this.state === 'settings' && this.renderLocalModels());
    let html =
      (srv
        ? `<div class="krow"><span>伺服器預設組</span><span class="dim" style="font-size:12px">${escHtml(this.srvSummary())}</span><button id="srvReload">重新讀取</button></div>` +
          `<p class="dim" style="font-size:11px">從伺服器開啟時，敵人、AI 機甲、載具、地圖物件，以及沒選本地模型組時你的機甲，都用伺服器預設組（在 /models 的模型庫選「伺服器預設組」編輯）。</p>`
        : '') +
      `<div class="krow"><span>使用本地模型庫</span><label><input type="checkbox" id="lmOn"${S.on ? ' checked' : ''} /> ${srv ? '你的機甲用下面選的本地模型組（多人時上傳給其他玩家）；單人時載具、地圖物件、小物件也優先用本地的' : '單人模式套用模型庫存在這個瀏覽器的 GLB 與關節設定（多人時自動停用）'}</label></div>` +
      `<div class="lmGroups">` +
      LM_GROUPS.map(
        (g) =>
          `<label title="${escHtml(g.note)}"><input type="checkbox" data-g="${g.id}"${S.groups[g.id] !== false ? ' checked' : ''}${S.on ? '' : ' disabled'} /> ${g.name}<span class="dim">（${cnt(g.id)}）</span></label>`,
      ).join('') +
      `</div>` +
      this.lmSetRow() +
      `<div class="krow"><span class="dim" style="font-size:12px">狀態：${escHtml(this.lmSummary())}</span><button id="lmReload"${S.on ? '' : ' disabled'}>重新讀取</button></div>`;
    if (st && st.on && !st.db)
      html += `<p class="dim" style="font-size:11px">遊戲和模型庫要用同一種方式開啟才讀得到：都從同一個伺服器網址（例如 http://主機/ 與 http://主機/models），或都直接開 HTML 檔。</p>`;
    const items = st && st.slots ? st.slots.filter((s) => s.err || s.checks.length) : [];
    if (items.length)
      html +=
        `<details class="lmIssues"><summary>失敗與提醒（${items.length}）</summary>` +
        items
          .map((s) =>
            s.err
              ? `<div class="lmBad">✗ ${escHtml(s.id)}：${escHtml(s.err)}（改用程式模型）</div>`
              : `<div class="lmWarn">⚠ ${escHtml(s.id)}：${s.checks.map((c) => escHtml(c.text)).join('；')}</div>`,
          )
          .join('') +
        `</details>`;
    const sset = srv && ServerModels.source();
    if (sset && sset.tpls.size)
      html +=
        `<details class="srvUsed"><summary>伺服器預設組的 GLB（${sset.tpls.size}）</summary>` +
        [...sset.tpls.entries()]
          .map(
            ([id, e]) =>
              `<div data-slot="${escHtml(id)}">${e.tpl ? '' : '✗ '}${escHtml(id)}<span class="dim">　${escHtml(e.name || '')}　${e.tpl ? '遊戲中已使用 ' + (sset.uses.get(id) || 0) + ' 次' : escHtml(e.err || '')}</span></div>`,
          )
          .join('') +
        `</details>`;
    const ok = st && st.slots ? st.slots.filter((s) => s.on && !s.err) : [];
    if (ok.length)
      html +=
        `<details class="lmUsed"><summary>套用中的 GLB（${ok.length}）</summary>` +
        ok
          .map((s) => {
            const n = LocalModels.uses.get(s.id) || 0;
            return `<div data-slot="${escHtml(s.id)}">${escHtml(s.id)}<span class="dim">　${escHtml(s.name || '')}　遊戲中已使用 ${n} 次</span></div>`;
          })
          .join('') +
        `</details>`;
    html += `<p class="dim" style="font-size:11px">在模型庫拖進 GLB 或調整連接點後，回到遊戲進車庫或出擊時會自動重新讀取。碰撞與判定維持程式模型的數值。</p>`;
    el.innerHTML = html;
    $('lmOn').onchange = (e) => {
      S.on = e.target.checked;
      LocalModels.saveSettings();
      if (S.on) this.lmRefresh();
      this.renderLocalModels();
    };
    for (const c of el.querySelectorAll('[data-g]'))
      c.onchange = () => {
        S.groups[c.dataset.g] = c.checked;
        LocalModels.saveSettings();
        this.lmRefresh();
        this.renderLocalModels();
      };
    $('lmReload').onclick = () => this.lmRefresh();
    if ($('srvReload')) $('srvReload').onclick = () => this.srvRefresh().then(() => this.renderLocalModels());
    $('lmSet').onchange = (e) => {
      S.set = e.target.value;
      LocalModels.saveSettings();
      this.lmRefresh();
      this.renderLocalModels();
    };
  },
  // 模型組選單：機甲區塊與武器的 GLB、關節設定用哪一組（模型庫的「模型組」）
  lmSetRow() {
    const S = LocalModels.settings;
    const sets = LocalModels.sets.length
      ? LocalModels.sets
      : [{ id: S.set, name: S.set === 'default' ? '預設' : S.set }];
    const srv = onServer();
    const missing =
      LocalModels.status &&
      LocalModels.status.db &&
      !sets.some((x) => x.id === S.set) &&
      !(srv && S.set === SERVER_SET);
    const opts =
      (srv
        ? `<option value="${SERVER_SET}"${S.set === SERVER_SET ? ' selected' : ''}>伺服器預設組（不用本地模型組）</option>`
        : '') +
      (missing ? `<option value="${escHtml(S.set)}">（模型庫已刪除這個模型組，改用預設）</option>` : '') +
      sets
        .map(
          (x) =>
            `<option value="${escHtml(x.id)}"${x.id === S.set ? ' selected' : ''}>${escHtml(x.name || x.id)}</option>`,
        )
        .join('');
    return `<div class="krow"><span>模型組</span><label><select id="lmSet"${S.on ? '' : ' disabled'}>${opts}</select> <span class="dim" style="font-size:12px">${srv ? '你的機甲區塊與武器用這一組的 GLB 與關節設定' : '機甲區塊與武器用這一組的 GLB 與關節設定（全部機甲共用；載具與地圖物件不分模型組）'}</span></label></div>`;
  },
});
