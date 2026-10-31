// Game：存檔（三個存檔槽 localStorage rubicon_save_1～3，目前的槽位 rubicon_save_cur）與存檔畫面；
// 作戰室的存檔終端（docs/hub-ui.md 第六期）與抉擇前備份（rubicon_save_bk_1～3）
import { isBossLevel } from '../data/enemies.js';
import { SORTIES } from '../data/campaign.js';
import { CHAPTER_NAMES } from '../data/story.js';
import { REMOVED_PARTS as REMOVED, REMOVED_REFUND as REFUND, START_ASM, START_OWNED } from '../data/parts.js';
import { newPilot, normalizePilot, levelOf } from '../data/pilot.js';
import { escHtml } from '../core/html.js';
import { SFX } from '../audio/audio.js';
import { Game } from './game.js';

const SLOTS = [1, 2, 3];
const slotKey = (i) => 'rubicon_save_' + i;
const CUR_KEY = 'rubicon_save_cur';
const OLD_KEY = 'rubicon_save'; // 單一存檔的舊版：第一次啟動時搬進存檔 1，舊鍵保留當備份
const FORMAT = 'rubicon-save';
const bkKey = (i) => 'rubicon_save_bk_' + i; // 抉擇前備份：每個槽位最近一份（不佔槽位）

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// 讀檔與匯入共用：補齊欄位、修正型別（零件 id 不認得時 partById 會退回預設零件）
function normalizeSave(o) {
  if (!o || typeof o !== 'object' || !o.asm || typeof o.asm !== 'object') return null;
  const asm = {};
  for (const k in START_ASM) {
    const v = typeof o.asm[k] === 'string' ? o.asm[k] : START_ASM[k];
    asm[k] = REMOVED[v] || v;
  }
  let coam = num(o.coam);
  let owned = Array.isArray(o.owned) ? o.owned.filter((x) => typeof x === 'string') : START_OWNED.slice();
  for (const id of owned) if (REFUND[id]) coam += REFUND[id];
  owned = owned.filter((id) => !REMOVED[id]);
  for (const id of START_OWNED) if (!owned.includes(id)) owned.push(id);
  for (const id of ['cs_none', 'cs_bomber', 'cs_ally']) if (!owned.includes(id)) owned.push(id);
  const items = {};
  const src = o.items && typeof o.items === 'object' ? o.items : { cs_bomber: 2, cs_ally: 1 };
  for (const k in src) items[k] = Math.max(0, num(src[k]));
  return {
    ...o,
    coam,
    owned,
    asm,
    items,
    level: Math.max(1, Math.floor(num(o.level, 1))),
    kills: num(o.kills),
    bosses: num(o.bosses),
    missionsDone: num(o.missionsDone),
    pilot: normalizePilot(o.pilot), // 舊存檔沒有 pilot 時從 Lv1 開始，並修正不合法的配點
    t: num(o.t),
  };
}
function readKey(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? normalizeSave(JSON.parse(s)) : null;
  } catch (e) {
    return null;
  }
}
const fmtTime = (t) => {
  if (!t) return '—';
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

Object.assign(Game.prototype, {
  // ---------- save ----------
  newSave() {
    return {
      coam: 60000,
      owned: START_OWNED.slice(),
      asm: Object.assign({}, START_ASM),
      items: { cs_bomber: 2, cs_ally: 1 },
      level: 1,
      kills: 0,
      bosses: 0,
      missionsDone: 0,
      pilot: newPilot(), // 駕駛員成長：PvE／PvP 各自獨立
    };
  },
  // 啟動時呼叫：舊版單一存檔搬進存檔 1（以 rubicon_save_cur 是否存在判斷是否搬過），決定目前的槽位
  initSaves() {
    try {
      if (localStorage.getItem(CUR_KEY) === null) {
        const old = localStorage.getItem(OLD_KEY);
        if (old && !localStorage.getItem(slotKey(1))) localStorage.setItem(slotKey(1), old);
        localStorage.setItem(CUR_KEY, '1');
      }
    } catch (e) {}
    let cur = 1;
    try {
      cur = Number(localStorage.getItem(CUR_KEY)) || 1;
    } catch (e) {}
    this.saveSlot = SLOTS.includes(cur) ? cur : 1;
  },
  readSlot(i) {
    return readKey(slotKey(i));
  },
  loadSave() {
    return this.readSlot(this.saveSlot || 1);
  },
  writeSave() {
    try {
      this.save.t = Date.now();
      localStorage.setItem(slotKey(this.saveSlot || 1), JSON.stringify(this.save));
      this.saveFlashT = performance.now(); // 作戰室的存檔終端：燈條閃一下
    } catch (e) {}
  },
  // 切換目前的槽位並載入（空的槽位載入新存檔，但要等 writeSave 才會寫入）
  useSlot(i) {
    this.saveSlot = i;
    try {
      localStorage.setItem(CUR_KEY, String(i));
    } catch (e) {}
    this.save = this.loadSave() || this.newSave();
  },

  // ---------- 標題畫面的「繼續存檔」 ----------
  renderContinue() {
    const b = document.getElementById('btnContinue');
    if (!b) return;
    const has = !!this.readSlot(this.saveSlot);
    b.disabled = !has;
    b.textContent = has ? `自由出擊（機甲庫・存檔 ${this.saveSlot}）` : '自由出擊（機甲庫）';
  },

  // ---------- 存檔畫面：三個槽位的繼續／新的傭兵生涯／匯出／匯入／刪除 ----------
  openSaves() {
    this.saveAsk = null;
    this.savesMsg('');
    this.state = 'saves';
    this.showScreen('saves');
    this.renderSaves();
  },
  // 存檔畫面與作戰室的存檔終端共用
  savesMsg(t, err) {
    for (const id of ['savesMsg', 'hubSaveMsg']) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.textContent = t;
      el.style.color = err ? 'var(--danger)' : '';
    }
  },
  renderSaves() {
    const ask = this.saveAsk;
    const html = SLOTS.map((i) => {
      const s = this.readSlot(i);
      const cur = i === this.saveSlot ? ' cur' : '';
      const head = `<div class="saveHead"><b>存檔 ${i}</b>${i === this.saveSlot ? '<span class="dim">（目前）</span>' : ''}</div>`;
      if (ask && ask.slot === i) {
        const q =
          ask.act === 'del'
            ? `確定刪除存檔 ${i}？刪除後無法復原。`
            : `匯入的存檔會覆蓋存檔 ${i} 目前的進度，確定嗎？`;
        return `<div class="saveCard ask${cur}" data-slot="${i}">${head}<p>${q}</p><div class="row">
          <button class="primary" data-act="yes">${ask.act === 'del' ? '確定刪除' : '確定覆蓋'}</button>
          <button data-act="no">取消</button></div></div>`;
      }
      if (!s)
        return `<div class="saveCard empty${cur}" data-slot="${i}">${head}<p class="dim">（空）</p><div class="row">
          <button class="primary" data-act="new">新的傭兵生涯</button><button data-act="imp">匯入</button></div></div>`;
      const L = s.level;
      const info = [
        `任務 ${String(L).padStart(2, '0')}${isBossLevel(L) ? '（決戰）' : ''}`,
        `COAM ${s.coam.toLocaleString()}`,
        `駕駛員 PvE Lv${levelOf(s.pilot.pve.xp)}／PvP Lv${levelOf(s.pilot.pvp.xp)}`,
        `擊破 ${s.kills}${s.bosses ? `（魔王 ${s.bosses}）` : ''}`,
      ];
      return `<div class="saveCard${cur}" data-slot="${i}">${head}<p>${info.map(escHtml).join(' ｜ ')}</p>
        <p class="dim" style="font-size: 12px">最後遊玩 ${escHtml(fmtTime(s.t))}</p><div class="row">
        <button class="primary" data-act="cont">繼續</button><button data-act="exp">匯出</button
        ><button data-act="imp">匯入</button><button data-act="del">刪除</button></div></div>`;
    }).join('');
    document.getElementById('saveSlots').innerHTML = html;
  },
  saveAction(i, act) {
    SFX.init();
    const ask = this.saveAsk;
    if (act === 'cont') {
      this.useSlot(i);
      return this.openGarage();
    }
    if (act === 'new') {
      this.useSlot(i);
      this.save = this.newSave();
      this.writeSave();
      return this.openGarage();
    }
    if (act === 'exp') return this.exportSave(i);
    if (act === 'imp') {
      this.importSlot = i;
      this.importHub = false;
      const f = document.getElementById('saveImportFile');
      f.value = '';
      return f.click();
    }
    if (act === 'del') {
      this.saveAsk = { slot: i, act: 'del' };
      return this.renderSaves();
    }
    if (act === 'no') {
      this.saveAsk = null;
      this.savesMsg('');
      return this.renderSaves();
    }
    if (act === 'yes' && ask) {
      this.saveAsk = null;
      if (ask.act === 'del') this.deleteSlot(i);
      else if (ask.act === 'imp') this.storeImport(i, ask.data);
      this.renderSaves();
    }
  },
  deleteSlot(i) {
    try {
      localStorage.removeItem(slotKey(i));
    } catch (e) {}
    this.bkDrop(i);
    // 刪掉目前的槽位：改用最近玩過的另一個槽位（都沒有就停在原槽位，記憶體裡是新存檔）
    if (i === this.saveSlot) {
      const rest = SLOTS.map((j) => ({ j, s: this.readSlot(j) }))
        .filter((x) => x.s)
        .sort((a, b) => b.s.t - a.s.t);
      this.useSlot(rest.length ? rest[0].j : i);
    }
    this.savesMsg(`已刪除存檔 ${i}`);
  },
  exportSave(i) {
    const s = this.readSlot(i);
    if (!s) return;
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const name = `rubicon-save-${i}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
    const blob = new Blob([JSON.stringify({ format: FORMAT, v: 1, save: s }, null, 1)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    this.savesMsg(`已匯出存檔 ${i}（${name}）`);
  },
  async importFile(file) {
    const i = this.importSlot;
    if (!file || !i) return;
    let data = null;
    try {
      const o = JSON.parse(await file.text());
      if (o && o.format === FORMAT) data = normalizeSave(o.save);
    } catch (e) {}
    if (!data) return this.savesMsg('不是 RUBICON PROTOCOL 的存檔檔案（.json）', true);
    // 從作戰室的存檔終端匯入：覆蓋時用確認視窗
    if (this.importHub) {
      this.importHub = false;
      const go = () => {
        this.storeImport(i, data);
        this.hubSaveRender();
      };
      if (this.readSlot(i))
        return this.uiConfirm(`匯入的存檔會覆蓋存檔 ${i} 目前的進度，確定嗎？`, go, '確定覆蓋');
      return go();
    }
    if (this.readSlot(i)) {
      this.saveAsk = { slot: i, act: 'imp', data };
      this.savesMsg('');
      return this.renderSaves();
    }
    this.storeImport(i, data);
    this.renderSaves();
  },
  storeImport(i, data) {
    try {
      localStorage.setItem(slotKey(i), JSON.stringify(data));
    } catch (e) {
      return this.savesMsg('寫入失敗（瀏覽器儲存空間不足或被停用）', true);
    }
    this.bkDrop(i);
    if (i === this.saveSlot) this.save = this.loadSave() || this.newSave();
    this.savesMsg(`已匯入到存檔 ${i}`);
  },
  // ---------- 作戰室的存檔終端（docs/hub-ui.md 第六期） ----------
  // 遊戲一直自動存在目前的槽位，所以這裡管理三個槽位：把目前的進度存一份到別的槽位（備份、分歧點）、換到別的槽位、
  // 匯出／匯入、刪除（目前的槽位只能匯出）；另有抉擇前備份（接下有陣營抉擇的委託時自動存一份，可以讀回）
  hubSaves(open) {
    const el = document.getElementById('hubSaveBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    SFX.ui();
    this.savesMsg('');
    this.hubSaveRender();
  },
  // 存檔終端的插槽燈（hub-holo.js）：cur／used／empty
  hubSlotSync() {
    this.hubSlotInfo = SLOTS.map((i) => (i === this.saveSlot ? 'cur' : this.readSlot(i) ? 'used' : 'empty'));
  },
  // 槽位卡片的摘要：主線的周目與章節、進行中的出擊、COAM、駕駛員、最後遊玩
  slotSummary(s) {
    const out = [];
    if (!s.story || typeof s.story !== 'object') out.push('主線：還沒開始');
    else {
      // 章節照作戰室的算法（hubChapter 讀 this.save，暫時換成這一份）
      const keep = this.save;
      let ch = 1,
        st = s.story;
      try {
        this.save = s;
        st = this.campStory();
        ch = this.hubChapter();
      } catch (e) {
        // 讀不出來時當第 1 章
      } finally {
        this.save = keep;
      }
      const cyc = st.cycle || 1;
      out.push((cyc > 1 ? `第 ${cyc} 周目・` : '') + (CHAPTER_NAMES[ch] || `第 ${ch} 章`));
      const ck = st.sortie,
        so = ck && SORTIES[ck.sid];
      if (so) out.push(`出擊中：${so.name}（區段 ${ck.seg + 1}／${so.segs.length}）`);
    }
    out.push(
      `COAM ${s.coam.toLocaleString()} ｜ 駕駛員 Lv${levelOf(s.pilot.pve.xp)} ｜ 最後遊玩 ${fmtTime(s.t)}`,
    );
    return out;
  },
  hubSaveRender() {
    this.hubSlotSync();
    const cur = this.saveSlot;
    const btn = (act, t, pri) => `<button data-act="${act}"${pri ? ' class="primary"' : ''}>${t}</button>`;
    let html = SLOTS.map((i) => {
      const s = i === cur ? this.save : this.readSlot(i);
      const head = `<b>存檔 ${i}</b>${i === cur ? '<span class="tag">使用中・自動存檔</span>' : ''}`;
      if (!s)
        return `<div class="hsCard empty" data-slot="${i}"><div>${head}</div><p class="dim">（空）</p><div class="row">${btn('save', '存到這一格', true)}${btn('imp', '匯入')}</div></div>`;
      const info = this.slotSummary(s)
        .map((t) => `<p>${escHtml(t)}</p>`)
        .join('');
      const row =
        i === cur
          ? btn('exp', '匯出')
          : btn('save', '存到這一格') +
            btn('load', '讀取', true) +
            btn('exp', '匯出') +
            btn('imp', '匯入') +
            btn('del', '刪除');
      return `<div class="hsCard${i === cur ? ' cur' : ''}" data-slot="${i}"><div>${head}</div>${info}<div class="row">${row}</div></div>`;
    }).join('');
    const bk = this.readBackup(cur);
    if (bk) {
      const so = SORTIES[bk.sid];
      html += `<div class="hsCard bk" data-slot="bk"><div><b>抉擇前備份</b><span class="tag">存檔 ${cur}</span></div><p>接下「${escHtml(so ? so.name : bk.sid)}」之前的進度</p><p class="dim">${escHtml(fmtTime(bk.t))}</p><div class="row">${btn('load', '讀回')}</div></div>`;
    }
    html += `<p class="dim" style="font-size: 12px">進度會一直自動存在使用中的存檔。接下有陣營抉擇的委託時，會自動存一份抉擇前備份（每個存檔最近一份）。</p>`;
    document.getElementById('hubSaveList').innerHTML = html;
  },
  hubSaveAct(i, act) {
    const cur = this.saveSlot;
    if (i === 'bk') {
      const bk = this.readBackup(cur);
      if (!bk) return;
      const so = SORTIES[bk.sid];
      return this.uiConfirm(
        `讀回接下「${so ? so.name : bk.sid}」之前的備份（${fmtTime(bk.t)}）？存檔 ${cur} 目前的進度會被它取代。`,
        () => {
          try {
            localStorage.setItem(slotKey(cur), JSON.stringify(bk.save));
          } catch (e) {
            return this.savesMsg('寫入失敗（瀏覽器儲存空間不足或被停用）', true);
          }
          this.save = this.loadSave() || this.newSave();
          this.hubSaves(false);
          this.openHub();
        },
        '讀回',
      );
    }
    if (act === 'save') {
      const go = () => {
        this.writeSave();
        try {
          localStorage.setItem(slotKey(i), JSON.stringify(this.save));
        } catch (e) {
          return this.savesMsg('寫入失敗（瀏覽器儲存空間不足或被停用）', true);
        }
        this.bkDrop(i);
        this.savesMsg(`已把目前的進度存到存檔 ${i}`);
        this.hubSaveRender();
      };
      if (this.readSlot(i))
        return this.uiConfirm(`存檔 ${i} 已經有進度，要用目前的進度覆蓋它嗎？`, go, '確定覆蓋');
      return go();
    }
    if (act === 'load')
      return this.uiConfirm(
        `換到存檔 ${i}？目前的進度已經自動存在存檔 ${cur}。`,
        () => {
          this.writeSave();
          this.useSlot(i);
          this.hubSaves(false);
          this.openHub();
        },
        '讀取',
      );
    if (act === 'exp') {
      if (i === cur) this.writeSave();
      return this.exportSave(i);
    }
    if (act === 'imp') {
      this.importSlot = i;
      this.importHub = true;
      const f = document.getElementById('saveImportFile');
      f.value = '';
      return f.click();
    }
    if (act === 'del')
      return this.uiConfirm(
        `確定刪除存檔 ${i}？刪除後無法復原。`,
        () => {
          this.deleteSlot(i);
          this.hubSaveRender();
        },
        '確定刪除',
      );
  },
  // 抉擇前備份（hub.js 的 briefGo：接下有陣營抉擇的委託之前）
  saveBackup(sid) {
    try {
      localStorage.setItem(bkKey(this.saveSlot), JSON.stringify({ t: Date.now(), sid, save: this.save }));
    } catch (e) {}
  },
  readBackup(i) {
    try {
      const o = JSON.parse(localStorage.getItem(bkKey(i)) || 'null');
      const save = o && normalizeSave(o.save);
      return save ? { t: num(o.t), sid: String(o.sid || ''), save } : null;
    } catch (e) {
      return null;
    }
  },
  bkDrop(i) {
    try {
      localStorage.removeItem(bkKey(i));
    } catch (e) {}
  },
  bindSaves() {
    const $ = (id) => document.getElementById(id);
    $('btnSaves').onclick = () => {
      SFX.init();
      this.openSaves();
    };
    $('btnContinue').onclick = () => {
      SFX.init();
      this.useSlot(this.saveSlot);
      this.openGarage();
    };
    $('saveSlots').onclick = (e) => {
      const b = e.target.closest('button[data-act]');
      const card = b && b.closest('[data-slot]');
      if (card) this.saveAction(Number(card.dataset.slot), b.dataset.act);
    };
    $('saveImportFile').onchange = (e) => this.importFile(e.target.files[0]);
    $('btnSavesBack').onclick = () => {
      this.state = 'title';
      this.showScreen('title');
    };
  },
});
