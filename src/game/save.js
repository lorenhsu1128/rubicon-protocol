// Game：存檔（三個存檔槽 localStorage rubicon_save_1～3，目前的槽位 rubicon_save_cur）與存檔畫面
import { isBossLevel } from '../data/enemies.js';
import { START_ASM, START_OWNED } from '../data/parts.js';
import { newPilot, normalizePilot, levelOf } from '../data/pilot.js';
import { escHtml } from '../core/html.js';
import { SFX } from '../audio/audio.js';
import { Game } from './game.js';

const SLOTS = [1, 2, 3];
const slotKey = (i) => 'rubicon_save_' + i;
const CUR_KEY = 'rubicon_save_cur';
const OLD_KEY = 'rubicon_save'; // 單一存檔的舊版：第一次啟動時搬進存檔 1，舊鍵保留當備份
const FORMAT = 'rubicon-save';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
// 讀檔與匯入共用：補齊欄位、修正型別（零件 id 不認得時 partById 會退回預設零件）
function normalizeSave(o) {
  if (!o || typeof o !== 'object' || !o.asm || typeof o.asm !== 'object') return null;
  const asm = {};
  for (const k in START_ASM) asm[k] = typeof o.asm[k] === 'string' ? o.asm[k] : START_ASM[k];
  const owned = Array.isArray(o.owned) ? o.owned.filter((x) => typeof x === 'string') : START_OWNED.slice();
  for (const id of ['cs_none', 'cs_bomber', 'cs_ally']) if (!owned.includes(id)) owned.push(id);
  const items = {};
  const src = o.items && typeof o.items === 'object' ? o.items : { cs_bomber: 2, cs_ally: 1 };
  for (const k in src) items[k] = Math.max(0, num(src[k]));
  return {
    ...o,
    coam: num(o.coam),
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
    b.textContent = has ? `繼續存檔（存檔 ${this.saveSlot}）` : '繼續存檔';
  },

  // ---------- 存檔畫面：三個槽位的繼續／新的傭兵生涯／匯出／匯入／刪除 ----------
  openSaves() {
    this.saveAsk = null;
    this.savesMsg('');
    this.state = 'saves';
    this.showScreen('saves');
    this.renderSaves();
  },
  savesMsg(t, err) {
    const el = document.getElementById('savesMsg');
    el.textContent = t;
    el.style.color = err ? 'var(--danger)' : '';
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
    if (i === this.saveSlot) this.save = this.loadSave() || this.newSave();
    this.savesMsg(`已匯入到存檔 ${i}`);
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
