// 自訂關卡的儲存：本機 IndexedDB `rubicon-levels`（不碰存檔與模型庫的資料庫）、匯出／匯入 .rubicon-level、
// 區網伺服器的上傳（要作者金鑰，只有作者能覆寫與刪除）、下載、清單與遊玩次數。
import { sha256Hex } from '../core/sha256.js';

const DB = 'rubicon-levels';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('levels')) d.createObjectStore('levels', { keyPath: 'id' });
    };
    rq.onsuccess = () => {
      const d = rq.result;
      d.onversionchange = () => {
        d.close();
        dbp = null;
      };
      res(d);
    };
    rq.onerror = () => {
      dbp = null;
      rej(rq.error);
    };
  });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('levels', mode);
    const st = t.objectStore('levels');
    let out;
    const r = fn(st);
    if (r) r.onsuccess = () => (out = r.result);
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};
export const LevelStore = {
  // 本機
  async list() {
    const all = (await tx('readonly', (st) => st.getAll())) || [];
    return all.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  },
  get: (id) => tx('readonly', (st) => st.get(id)),
  put: (L) => tx('readwrite', (st) => st.put(JSON.parse(JSON.stringify(L)))),
  del: (id) => tx('readwrite', (st) => st.delete(id)),
  // 作者金鑰：第一次上傳時產生（只存在這個瀏覽器；換電腦就不能改舊的上傳）
  authorKey() {
    let k = null;
    try {
      k = localStorage.getItem('rubicon_author');
    } catch (e) {}
    if (!k || k.length < 16) {
      const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
      k = '';
      for (let i = 0; i < 32; i++) k += c[Math.floor(Math.random() * c.length)];
      try {
        localStorage.setItem('rubicon_author', k);
      } catch (e) {}
    }
    return k;
  },
  get serverOn() {
    return !!window.RUBICON_SERVER;
  },
  async serverList() {
    const r = await fetch('/api/levels', { cache: 'no-store' });
    if (!r.ok) throw new Error('伺服器回應 ' + r.status);
    return ((await r.json()).levels || []).sort((a, b) => (b.t || 0) - (a.t || 0));
  },
  async serverGet(id) {
    const r = await fetch('/api/levels/' + id, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status === 404 ? '伺服器上沒有這個關卡' : '伺服器回應 ' + r.status);
    return r.json();
  },
  async upload(L) {
    const r = await fetch('/api/levels/' + L.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Author-Key': this.authorKey() },
      body: JSON.stringify(L),
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(o.error || '上傳失敗（' + r.status + '）');
    return o;
  },
  async serverDel(id) {
    const r = await fetch('/api/levels/' + id, {
      method: 'DELETE',
      headers: { 'X-Author-Key': this.authorKey() },
    });
    const o = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(o.error || '刪除失敗（' + r.status + '）');
    return o;
  },
  played(id, clear) {
    if (!this.serverOn) return;
    fetch('/api/levels/' + id + '/play', { method: 'POST', body: JSON.stringify({ clear: !!clear }) }).catch(
      () => {},
    );
  },
  // 我上傳過的（記在 localStorage，清單顯示「我的」與刪除按鈕；伺服器以金鑰另外檢查）
  mine() {
    try {
      return JSON.parse(localStorage.getItem('rubicon_author_lv') || '[]');
    } catch (e) {
      return [];
    }
  },
  markMine(id, on) {
    const s = new Set(this.mine());
    if (on) s.add(id);
    else s.delete(id);
    try {
      localStorage.setItem('rubicon_author_lv', JSON.stringify([...s]));
    } catch (e) {}
  },
  hash: (L) => LevelStore.hashTxt(JSON.stringify(L)),
  hashTxt: (txt) => sha256Hex(new TextEncoder().encode(txt)),
  download(L) {
    const blob = new Blob([JSON.stringify(L)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (L.name || 'level').replace(/[\\/:*?"<>|]/g, '_') + '.rubicon-level';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  },
};
