// 模型庫的 GLB 來源：瀏覽器暫存（IndexedDB，拖曳進來的檔案）＞ 內建（src/assets/models/，建置時內嵌）＞ 程式模型
import BUILTIN_MODELS from 'virtual:models';

const DB = 'rubicon-model-library',
  STORE = 'glb';
let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}
const tx = async (mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
};

export class GlbStore {
  constructor() {
    this.local = new Map(); // id → { id, name, size, buf, t }
    this.ok = true;
  }
  async load() {
    try {
      const all = await tx('readonly', (s) => s.getAll());
      for (const r of all || []) this.local.set(r.id, r);
    } catch (e) {
      this.ok = false; // 私密瀏覽或停用儲存：仍可在本次瀏覽中使用
      console.warn('IndexedDB 無法使用', e);
    }
  }
  // 依優先順序取得槽位的來源：{ kind:'glb', origin:'browser'|'builtin', name, buf, size } 或 { kind:'proc' }
  // 左側武器沒有自己的 GLB 時暫用右側的（fallback: true）；完整機甲由區塊組成，一律不接受 GLB
  source(id) {
    const own = this.ownSource(id);
    if (own.kind === 'glb') return own;
    const m = /^((?:weapon|back)\/[^/]+)\/l$/.exec(id);
    if (m) {
      const r = this.ownSource(m[1] + '/r');
      if (r.kind === 'glb') return { ...r, fallback: true };
    }
    return own;
  }
  ownSource(id) {
    if (id.startsWith('mech/')) return { kind: 'proc' };
    const r = this.local.get(id);
    if (r) return { kind: 'glb', origin: 'browser', name: r.name, buf: r.buf, size: r.size, t: r.t };
    const b = BUILTIN_MODELS[id];
    if (b)
      return {
        kind: 'glb',
        origin: 'builtin',
        name: `src/assets/models/${id}.glb`,
        buf: b,
        size: b.byteLength,
      };
    return { kind: 'proc' };
  }
  hasBuiltin(id) {
    return !!BUILTIN_MODELS[id];
  }
  async put(id, file) {
    const buf = await file.arrayBuffer();
    const r = { id, name: file.name, size: buf.byteLength, buf, t: Date.now() };
    this.local.set(id, r);
    if (this.ok)
      try {
        await tx('readwrite', (s) => s.put(r));
      } catch (e) {
        console.warn('GLB 儲存失敗', e);
      }
    return r;
  }
  async remove(id) {
    this.local.delete(id);
    if (this.ok)
      try {
        await tx('readwrite', (s) => s.delete(id));
      } catch (e) {}
  }
}
