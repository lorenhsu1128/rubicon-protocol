// 模型庫的資料來源（都存在 IndexedDB，只影響這個瀏覽器）：
// - GLB：瀏覽器暫存（拖曳進來的檔案）＞ 內建（src/assets/models/，建置時內嵌）＞ 程式模型
// - 關節設定：瀏覽器暫存的連接點覆寫＞ 內建 joints.json ＞ 程式預設值（套用見 render/mech-joints.js）
import BUILTIN_MODELS from 'virtual:models';
import { builtinJoints, setJointOverrides } from '../render/mech-joints.js';

const DB = 'rubicon-model-library',
  GLB = 'glb',
  JOINTS = 'joints',
  PRESETS = 'presets';
let dbp = null;
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 3);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(GLB)) d.createObjectStore(GLB, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(JOINTS)) d.createObjectStore(JOINTS, { keyPath: 'slot' });
        if (!d.objectStoreNames.contains(PRESETS)) d.createObjectStore(PRESETS, { keyPath: 'name' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  return dbp;
}
const tx = async (store, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
};

export class GlbStore {
  constructor() {
    this.local = new Map(); // id → { id, name, size, buf, t }
    this.joints = {}; // 槽位 → { 連接點: { p, r } }（glTF 座標）
    this.presets = new Map(); // 組裝調整頁的預組：名稱 → { name, asm, t }
    this.ok = true;
  }
  async load() {
    try {
      const all = await tx(GLB, 'readonly', (s) => s.getAll());
      for (const r of all || []) this.local.set(r.id, r);
      const js = await tx(JOINTS, 'readonly', (s) => s.getAll());
      for (const r of js || []) if (r.conns && Object.keys(r.conns).length) this.joints[r.slot] = r.conns;
      const ps = await tx(PRESETS, 'readonly', (s) => s.getAll());
      for (const r of ps || []) this.presets.set(r.name, r);
    } catch (e) {
      this.ok = false; // 私密瀏覽或停用儲存：仍可在本次瀏覽中使用
      console.warn('IndexedDB 無法使用', e);
    }
    setJointOverrides(this.joints);
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
        await tx(GLB, 'readwrite', (s) => s.put(r));
      } catch (e) {
        console.warn('GLB 儲存失敗', e);
      }
    return r;
  }
  async remove(id) {
    this.local.delete(id);
    if (this.ok)
      try {
        await tx(GLB, 'readwrite', (s) => s.delete(id));
      } catch (e) {}
  }

  // ---------- 關節設定 ----------
  // 連接點設定的來源：'browser'（瀏覽器暫存）／'builtin'（joints.json）／'default'（程式預設值）
  jointOrigin(slot, name) {
    if (this.joints[slot] && this.joints[slot][name]) return 'browser';
    const b = builtinJoints();
    return b[slot] && b[slot][name] ? 'builtin' : 'default';
  }
  // 寫入一個連接點（val 為 { p, r }，null 表示移除瀏覽器暫存）；記憶體立即生效，IndexedDB 非同步寫入
  setJoint(slot, name, val) {
    const conns = { ...(this.joints[slot] || {}) };
    if (val) conns[name] = { p: [...val.p], r: [...val.r] };
    else delete conns[name];
    if (Object.keys(conns).length) this.joints[slot] = conns;
    else delete this.joints[slot];
    setJointOverrides(this.joints);
    if (!this.ok) return Promise.resolve();
    return tx(JOINTS, 'readwrite', (s) =>
      Object.keys(conns).length ? s.put({ slot, conns }) : s.delete(slot),
    ).catch((e) => console.warn('關節設定儲存失敗', e));
  }
  jointCount() {
    return Object.values(this.joints).reduce((n, c) => n + Object.keys(c).length, 0);
  }
  // 匯出用：內建 joints.json ＋ 瀏覽器暫存（同一個連接點以瀏覽器為準），槽位排序
  mergedJoints() {
    const out = {};
    for (const src of [builtinJoints(), this.joints])
      for (const [slot, conns] of Object.entries(src)) out[slot] = { ...(out[slot] || {}), ...conns };
    return Object.fromEntries(
      Object.keys(out)
        .sort()
        .map((k) => [k, out[k]]),
    );
  }

  // ---------- 預組（組裝調整頁）----------
  async putPreset(name, asm) {
    const r = { name, asm: { ...asm }, t: Date.now() };
    this.presets.set(name, r);
    if (this.ok)
      try {
        await tx(PRESETS, 'readwrite', (s) => s.put(r));
      } catch (e) {
        console.warn('預組儲存失敗', e);
      }
    return r;
  }
  async removePreset(name) {
    this.presets.delete(name);
    if (this.ok)
      try {
        await tx(PRESETS, 'readwrite', (s) => s.delete(name));
      } catch (e) {}
  }
}
