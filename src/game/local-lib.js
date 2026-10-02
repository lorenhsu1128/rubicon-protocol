// Game：本地模型庫（單人模式套用模型庫存在瀏覽器裡的 GLB 與關節設定）
// 讀取時機：進車庫、單機出擊前（沒有變動的檔案沿用快取），以及標題畫面的「重新載入本地模型」
import { Game } from './game.js';
import { escHtml } from '../core/html.js';
import { LM_GROUPS, LocalModels } from '../render/local-models.js';
import { MODEL_CATALOG } from '../render/model-catalog.js';
import { checkGlb } from '../render/glb.js';
import { measureBox } from '../render/measure.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { PIECE_ORIGIN } from '../render/mech-model.js';
import { setModelProvider } from '../render/model-provider.js';

const $ = (id) => document.getElementById(id);
const CATALOG = new Map(MODEL_CATALOG.map((e) => [e.id, e]));

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
  if (entry.noGlb) throw new Error('這個模型由各區塊組成，請把 GLB 放到各區塊的槽位');
  return checkGlb({
    root,
    info,
    bytes,
    spec: entry.spec,
    ref: referenceBox(entry),
    origin: entry.piece ? PIECE_ORIGIN[entry.piece.kind] : entry.origin || '地面中心（模型底面中心）',
  });
}

Object.assign(Game.prototype, {
  lmInit() {
    LocalModels.allow = () => !(this.net && this.net.role);
    LocalModels.applyJoints();
    setModelProvider((slot, pal, unique) => LocalModels.model(slot, pal, unique));
  },
  // 重新讀取本地模型庫；manual：標題畫面的按鈕（一律顯示進度與結果）
  // 自動讀取時只有需要解析檔案才顯示進度條
  async lmRefresh(manual = false) {
    if (!LocalModels.active()) {
      if (manual) this.lmShowResult(LocalModels.settings.on ? '多人連線中不使用本地模型' : null);
      return LocalModels.status;
    }
    const box = $('lmLoad');
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      $('lmLoadTitle').textContent = '讀取本地模型庫…';
      box.classList.add('on');
    };
    if (manual) show();
    const st = await LocalModels.reload((done, total, id) => {
      if (id && done < total) show();
      if (!shown) return;
      $('lmLoadBar').style.width = (total ? (done / total) * 100 : 100) + '%';
      $('lmLoadTxt').textContent = total ? `${done}／${total}　${id || ''}` : '';
    }, checker);
    if (manual) this.lmShowResult();
    else box.classList.remove('on');
    if (this.state === 'settings') this.renderLocalModels();
    return st;
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
    if (txt === null) txt = '本地模型庫沒有開啟：請到「按鍵與操作設定」開啟';
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
  // 車庫：顯示這台機甲有幾個區塊用了本地 GLB
  lmGarageNote(rig) {
    const el = $('gLocal');
    if (!el) return;
    const n = Object.values(rig.pieces).filter((o) => o.userData.localGlb).length;
    el.textContent = n ? `本地模型庫：此機 ${n} 個區塊使用 GLB` : '';
    el.style.display = n ? '' : 'none';
  },
  // 設定畫面的「本地模型庫」區塊
  renderLocalModels() {
    const el = $('lmBox');
    if (!el) return;
    const S = LocalModels.settings;
    const st = LocalModels.status;
    const cnt = (g) => (st && st.slots ? st.slots.filter((s) => s.group === g).length : 0);
    let html =
      `<div class="krow"><span>使用本地模型庫</span><label><input type="checkbox" id="lmOn"${S.on ? ' checked' : ''} /> 單人模式套用模型庫存在這個瀏覽器的 GLB 與關節設定（多人時自動停用）</label></div>` +
      `<div class="lmGroups">` +
      LM_GROUPS.map(
        (g) =>
          `<label title="${escHtml(g.note)}"><input type="checkbox" data-g="${g.id}"${S.groups[g.id] !== false ? ' checked' : ''}${S.on ? '' : ' disabled'} /> ${g.name}<span class="dim">（${cnt(g.id)}）</span></label>`,
      ).join('') +
      `</div>` +
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
  },
});
