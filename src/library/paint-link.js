// 和貼圖繪製（Rubicon Paint，子專案 rubicon_paint/，建置到 dist/paint/）的連線：
// 模型庫開一個新視窗，以 postMessage 傳 GLB 過去；畫完在那邊按「存回模型庫」，GLB 傳回來存進槽位。
// 不靠共用 IndexedDB：直接開檔與伺服器都能用，伺服器預設組也一樣（putBuf 會寫到伺服器）。
// 訊息（data.t）：
//   繪圖 → 模型庫  rp-ready（視窗準備好）、rp-save { id, slot, set, name, buf }
//   模型庫 → 繪圖  rp-open { slot, set, setName, slotName, name, buf }、rp-saved { id, ok, msg }
// 只認 t 以 rp- 開頭、格式正確的訊息；存檔時槽位必須在目錄裡，而且模型庫目前還在同一個模型組。
import { MODEL_CATALOG } from '../render/model-catalog.js';

const PAINT_URL = () => (window.RUBICON_SERVER ? '/paint/' : 'paint/index.html');
const WIN_NAME = 'rubicon-paint';

export class PaintLink {
  constructor({ store, toast, onSaved }) {
    this.store = store;
    this.toast = toast;
    this.onSaved = onSaved;
    this.win = null;
    this.pending = null; // 等繪圖視窗準備好後要送的 rp-open
    addEventListener('message', (e) => this.onMessage(e));
  }
  // 只開工具（沒有指定槽位）
  openTool() {
    const w = window.open(PAINT_URL(), WIN_NAME);
    if (w) w.focus();
  }
  // 把槽位目前的 GLB 送去繪製
  open(entry) {
    const src = this.store.source(entry.id);
    if (src.kind !== 'glb' || src.fallback)
      return this.toast('這個槽位還沒有 GLB：先載入或用 GLB 編輯器存一個，才能繪製貼圖', true);
    const set = this.store.cur;
    const info = this.store.setList().find((s) => s.id === set);
    this.pending = {
      t: 'rp-open',
      slot: entry.id,
      slotName: entry.name,
      set,
      setName: info ? info.name : set,
      name: src.name,
      buf: src.buf.slice(0), // 複製：不能把模型庫存著的那份轉移出去
    };
    // 同名視窗已經開著時 window.open 只會換網址的 # 而不重新載入，所以另外問一次它準備好了沒
    const w = window.open(PAINT_URL() + '#lib', WIN_NAME);
    if (!w) return this.toast('瀏覽器擋住了新視窗：請允許這個頁面開啟彈出視窗', true);
    this.win = w;
    w.focus();
    try {
      w.postMessage({ t: 'rp-ping' }, '*');
    } catch (e) {
      // 還在載入：等它送 rp-ready
    }
  }
  reply(e, msg) {
    try {
      e.source.postMessage(msg, '*');
    } catch (err) {
      // 繪圖視窗已關閉
    }
  }
  async onMessage(e) {
    const d = e.data;
    if (!d || typeof d.t !== 'string' || !d.t.startsWith('rp-') || !e.source) return;
    if (d.t === 'rp-ready') {
      if (!this.pending || e.source !== this.win) return;
      const msg = this.pending;
      this.pending = null;
      this.reply(e, msg);
    } else if (d.t === 'rp-save') {
      const fail = (msg) => this.reply(e, { t: 'rp-saved', id: d.id, ok: false, msg });
      const entry = typeof d.slot === 'string' && MODEL_CATALOG.find((x) => x.id === d.slot);
      if (!entry || entry.noGlb || !(d.buf instanceof ArrayBuffer)) return fail('模型庫沒有這個槽位');
      if (d.set !== this.store.cur) {
        const info = this.store.setList().find((s) => s.id === d.set);
        return fail(`模型庫目前是另一個模型組：請先在模型庫切回「${info ? info.name : d.set}」再存`);
      }
      const head = new Uint8Array(d.buf, 0, 4);
      if (String.fromCharCode(...head) !== 'glTF') return fail('不是有效的 GLB');
      try {
        await this.save(entry, d.name, d.buf);
      } catch (err) {
        return fail(String((err && err.message) || err));
      }
      this.reply(e, { t: 'rp-saved', id: d.id, ok: true });
    }
  }
  // 存進目前模型組；保留繪製前的檔案當原始檔，之後可以在 GLB 編輯器「還原原始檔」
  async save(entry, name, buf) {
    const src = this.store.source(entry.id);
    let orig = null;
    if (src.kind === 'glb' && !src.fallback) {
      const rec = src.origin === 'browser' ? this.store.local.get(entry.id) : null;
      orig = rec && rec.orig ? rec.orig : { name: src.name, buf: src.buf };
    }
    const base = String(name || entry.id.replace(/\//g, '_')).replace(/\.glb$/i, '');
    await this.store.putBuf(entry.id, base + '.glb', buf, orig);
    this.toast(`已存回「${entry.name}」（貼圖繪製）`);
    if (this.onSaved) await this.onSaved(entry);
  }
}
