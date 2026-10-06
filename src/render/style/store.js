// 渲染風格：選擇與儲存（localStorage rubicon_style）、我的預設、伺服器上分享的風格（/api/styles）
// 內容：{ sel: { k: 'builtin'|'mine'|'server', id }, metal, res, mine: [{ id, name, base, params }],
//         server: { id: { name, author, params } }（伺服器清單的快取，伺服器暫時連不上時仍可使用）}
import { BUILTIN_STYLES, builtinParams, normalizeStyle } from './params.js';

const KEY = 'rubicon_style';
const read = () => {
  try {
    const o = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (o && typeof o === 'object') return o;
  } catch (e) {}
  return {};
};

export const StyleStore = {
  d: null,
  load() {
    const o = read();
    this.d = {
      sel: o.sel && typeof o.sel.id === 'string' ? o.sel : { k: 'builtin', id: 'real' },
      metal: !!o.metal,
      res: typeof o.res === 'number' ? Math.min(1, Math.max(0.5, o.res)) : 1,
      mine: Array.isArray(o.mine) ? o.mine.filter((m) => m && typeof m.id === 'string') : [],
      server: o.server && typeof o.server === 'object' ? o.server : {},
    };
    return this.d;
  },
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.d));
    } catch (e) {}
  },
  get data() {
    return this.d || this.load();
  },
  // 選項清單：[{ k, id, name, author? }]
  choices() {
    const d = this.data;
    return [
      ...BUILTIN_STYLES.map((s) => ({ k: 'builtin', id: s.id, name: s.name })),
      ...d.mine.map((s) => ({ k: 'mine', id: s.id, name: s.name })),
      ...Object.keys(d.server).map((id) => ({
        k: 'server',
        id,
        name: d.server[id].name,
        author: d.server[id].author,
      })),
    ];
  },
  // 某個風格的參數（不含金屬開關）；找不到時回傳 null
  paramsOf(k, id) {
    const d = this.data;
    if (k === 'builtin') return BUILTIN_STYLES.some((s) => s.id === id) ? builtinParams(id) : null;
    if (k === 'mine') {
      const m = d.mine.find((x) => x.id === id);
      return m ? normalizeStyle(m.params) : null;
    }
    if (k === 'server') return d.server[id] ? normalizeStyle(d.server[id].params) : null;
    return null;
  },
  nameOf(k, id) {
    const c = this.choices().find((x) => x.k === k && x.id === id);
    return c ? c.name : '';
  },
  // 遊戲實際使用的參數：選中的風格＋金屬開關
  current() {
    const d = this.data;
    const P = this.paramsOf(d.sel.k, d.sel.id) || builtinParams('real');
    P.metal = d.metal;
    return P;
  },
  select(k, id) {
    this.data.sel = { k, id };
    this.save();
  },
  setMetal(on) {
    this.data.metal = !!on;
    this.save();
  },
  setRes(r) {
    this.data.res = Math.min(1, Math.max(0.5, r));
    this.save();
  },
  saveMine(name, params, id) {
    const d = this.data;
    const p = normalizeStyle(params);
    delete p.metal;
    let m = id && d.mine.find((x) => x.id === id);
    if (m) {
      m.name = name;
      m.params = p;
    } else {
      m = { id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, params: p };
      d.mine.push(m);
    }
    this.save();
    return m;
  },
  removeMine(id) {
    const d = this.data;
    d.mine = d.mine.filter((x) => x.id !== id);
    if (d.sel.k === 'mine' && d.sel.id === id) d.sel = { k: 'builtin', id: 'real' };
    this.save();
  },
  // 匯出／匯入（JSON 檔）
  exportJson(name, params) {
    const p = normalizeStyle(params);
    delete p.metal;
    return JSON.stringify({ type: 'rubicon-style', v: 1, name, params: p }, null, 1);
  },
  parseJson(text) {
    const o = JSON.parse(text);
    if (!o || o.type !== 'rubicon-style' || !o.params) throw new Error('不是渲染風格檔');
    return { name: String(o.name || '匯入的風格').slice(0, 40), params: normalizeStyle(o.params) };
  },
  // ---------- 伺服器 ----------
  get serverOn() {
    return !!window.RUBICON_SERVER;
  },
  async fetchServer() {
    if (!this.serverOn) return false;
    const r = await fetch('/api/styles', { cache: 'no-store' });
    if (!r.ok) throw new Error('伺服器回應 ' + r.status);
    const j = await r.json();
    const d = this.data;
    d.server = {};
    for (const s of j.styles || [])
      if (s && typeof s.id === 'string')
        d.server[s.id] = { name: s.name, author: s.author || '', params: s.params };
    this.save();
    return true;
  },
  async upload(name, author, params, id) {
    const p = normalizeStyle(params);
    delete p.metal;
    const sid = id || 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const r = await fetch('/api/styles/' + sid, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, author, params: p }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || '伺服器回應 ' + r.status);
    this.data.server[sid] = { name, author, params: p };
    this.save();
    return sid;
  },
  async removeServer(id) {
    const r = await fetch('/api/styles/' + id, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || '伺服器回應 ' + r.status);
    }
    delete this.data.server[id];
    const d = this.data;
    if (d.sel.k === 'server' && d.sel.id === id) d.sel = { k: 'builtin', id: 'real' };
    this.save();
  },
};
