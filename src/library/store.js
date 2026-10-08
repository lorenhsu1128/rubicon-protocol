// 模型庫的資料來源（都存在 IndexedDB，只影響這個瀏覽器）：
// - GLB：瀏覽器暫存（拖曳進來的檔案）＞ 內建（src/assets/models/，建置時內嵌）＞ 程式模型
// - 關節設定：瀏覽器暫存的連接點覆寫＞ 內建 joints.json ＞ 程式預設值（套用見 render/mech-joints.js）
// - 模型組：機甲區塊與武器的 GLB、關節設定、建議零件組合各模型組一份（目前模型組記在 localStorage），
//   載具、地圖物件、小物件所有模型組共用（記錄的 set 為 ''）
// 資料庫第 4 版：models（鍵 [set, id]）、setJoints（鍵 [set, slot]）、sets、presets；
// 第 3 版的 glb／joints 升級時搬進「預設」模型組
// - 伺服器預設組（從 rubicon-server 的 /models 開啟時）：資料在伺服器（server-models/default），所有分類都有；
//   選它時所有寫入（存 GLB、刪除、關節設定、零件組合）直接送到伺服器的 /api/models/default/…，不存 IndexedDB
import BUILTIN_MODELS from 'virtual:models';
import { builtinJoints, setJointOverrides } from '../render/mech-joints.js';
import { DEFAULT_SET, SERVER_SET, cleanMechs, setOf, setScoped } from '../render/local-models.js';

const DB = 'rubicon-model-library',
  MODELS = 'models',
  JOINTS = 'setJoints',
  PRESETS = 'presets',
  SETS = 'sets';
const CUR_KEY = 'rubicon_modelset';
const DEFAULT_NAME = '預設';
let dbp = null;
// 升級資料庫時，其他還開著的舊版模型庫分頁不會放開連線（舊版沒有處理 versionchange），升級會一直等待：
// onBlocked() 通知頁面顯示提示，那些分頁關閉或重新整理後自動繼續；onReady() 收回提示
let dbHooks = {};
function db() {
  if (!dbp)
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 4);
      r.onupgradeneeded = () => {
        const d = r.result,
          t = r.transaction;
        const has = (n) => d.objectStoreNames.contains(n);
        if (!has(PRESETS)) d.createObjectStore(PRESETS, { keyPath: 'name' });
        if (!has(MODELS)) d.createObjectStore(MODELS, { keyPath: ['set', 'id'] });
        if (!has(JOINTS)) d.createObjectStore(JOINTS, { keyPath: ['set', 'slot'] });
        if (!has(SETS))
          d.createObjectStore(SETS, { keyPath: 'id' }).put({
            id: DEFAULT_SET,
            name: DEFAULT_NAME,
            asm: null,
            t: Date.now(),
          });
        // 舊版資料搬進預設模型組（共用分類的搬成 ''）
        if (has('glb')) {
          const q = t.objectStore('glb').getAll();
          q.onsuccess = () => {
            for (const rec of q.result || [])
              if (rec && rec.id) t.objectStore(MODELS).put({ ...rec, set: setOf(rec.id, DEFAULT_SET) });
            d.deleteObjectStore('glb');
          };
        }
        if (has('joints')) {
          const q = t.objectStore('joints').getAll();
          q.onsuccess = () => {
            for (const rec of q.result || [])
              if (rec && rec.slot) t.objectStore(JOINTS).put({ ...rec, set: DEFAULT_SET });
            d.deleteObjectStore('joints');
          };
        }
      };
      r.onblocked = () => dbHooks.onBlocked && dbHooks.onBlocked();
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => d.close();
        if (dbHooks.onReady) dbHooks.onReady();
        res(d);
      };
      r.onerror = () => {
        if (dbHooks.onReady) dbHooks.onReady();
        rej(r.error);
      };
    });
  return dbp;
}
// fn(取得 objectStore 的函式) 在同一個交易裡執行，回傳最後一個請求的結果
const tx = async (stores, mode, fn) => {
  const d = await db();
  const names = Array.isArray(stores) ? stores : [stores];
  return new Promise((res, rej) => {
    const t = d.transaction(names, mode);
    const req = fn(Array.isArray(stores) ? (n) => t.objectStore(n) : t.objectStore(stores));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
};
const keyOf = (set, id) => set + '\n' + id;
const copyRec = (r, set) => ({ ...r, set });
const SERVER_NAME = '伺服器預設組';
const slotUrl = (slot) => slot.split('/').map(encodeURIComponent).join('/');
// 伺服器 API：回傳 JSON；失敗時丟出錯誤（訊息用伺服器回的 error）
async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    body: body === undefined ? undefined : body instanceof ArrayBuffer ? body : JSON.stringify(body),
    cache: 'no-store',
  });
  let o = null;
  try {
    o = await r.json();
  } catch (e) {}
  if (!r.ok) throw new Error((o && o.error) || 'HTTP ' + r.status);
  return o;
}
async function fetchBuf(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.arrayBuffer();
}

export class GlbStore {
  constructor() {
    this.recs = new Map(); // 所有模型組的 GLB：`${set}\n${id}` → { set, id, name, size, buf, t, orig? }
    this.local = new Map(); // 目前模型組看得到的 GLB：id → 紀錄
    this.jointsBy = {}; // 模型組 → { 槽位 → { 連接點: { p, r } } }（glTF 座標）
    this.joints = {}; // 目前模型組的關節設定（jointsBy[cur] 的參照）
    this.sets = new Map(); // 模型組：id → { id, name, asm, t }
    this.cur = DEFAULT_SET;
    this.presets = new Map(); // 舊版的共用預組（只用來搬進各模型組的機甲清單）：名稱 → { name, asm, t }
    this.ok = true;
    this.server = typeof window !== 'undefined' && !!window.RUBICON_SERVER; // 從 rubicon-server 開啟
    this.serverLoaded = false;
    this.onError = null; // (訊息) → void：伺服器寫入失敗
  }
  // hooks：{ onBlocked, onReady }（見 db()）
  async load(hooks = {}) {
    dbHooks = hooks;
    try {
      for (const r of (await tx(MODELS, 'readonly', (s) => s.getAll())) || [])
        this.recs.set(keyOf(r.set, r.id), r);
      for (const r of (await tx(JOINTS, 'readonly', (s) => s.getAll())) || [])
        if (r.conns && Object.keys(r.conns).length) {
          if (!this.jointsBy[r.set]) this.jointsBy[r.set] = {};
          this.jointsBy[r.set][r.slot] = r.conns;
        }
      for (const r of (await tx(SETS, 'readonly', (s) => s.getAll())) || []) this.sets.set(r.id, r);
      for (const r of (await tx(PRESETS, 'readonly', (s) => s.getAll())) || []) this.presets.set(r.name, r);
    } catch (e) {
      this.ok = false; // 私密瀏覽或停用儲存：仍可在本次瀏覽中使用
      console.warn('IndexedDB 無法使用', e);
    }
    if (!this.sets.size)
      this.sets.set(DEFAULT_SET, { id: DEFAULT_SET, name: DEFAULT_NAME, asm: null, mechs: [], t: 0 });
    await this.migrateMechs();
    if (this.server)
      this.sets.set(SERVER_SET, {
        id: SERVER_SET,
        name: SERVER_NAME,
        asm: null,
        mechs: [],
        t: 0,
        server: true,
      });
    let cur = null;
    try {
      cur = localStorage.getItem(CUR_KEY);
    } catch (e) {}
    if (cur === SERVER_SET && this.server)
      try {
        await this.loadServer();
      } catch (e) {
        console.warn('伺服器模型組讀取失敗', e);
        cur = null;
      }
    this.view(this.sets.has(cur) ? cur : this.sets.has(DEFAULT_SET) ? DEFAULT_SET : this.setList()[0].id);
  }
  // 讀取伺服器預設組（全部 GLB 與原始檔、關節設定、零件組合）
  async loadServer() {
    const m = await api('GET', '/api/models/default');
    const recs = [];
    for (const [id, info] of Object.entries(m.models || {})) {
      const r = { set: SERVER_SET, id, name: info.name, size: info.size, t: info.t, h: info.h };
      r.buf = await fetchBuf(`/api/models/default/glb/${slotUrl(id)}?h=${info.h}`);
      if (info.orig)
        r.orig = {
          name: info.orig.name,
          size: info.orig.size,
          buf: await fetchBuf(`/api/models/default/orig/${slotUrl(id)}`),
        };
      recs.push(r);
    }
    for (const k of [...this.recs.keys()]) if (k.startsWith(SERVER_SET + '\n')) this.recs.delete(k);
    for (const r of recs) this.recs.set(keyOf(SERVER_SET, r.id), r);
    this.jointsBy[SERVER_SET] = m.joints || {};
    this.sets.get(SERVER_SET).asm = m.asm || null;
    this.sets.get(SERVER_SET).mechs = cleanMechs(m.mechs);
    this.serverRev = m.rev;
    this.serverLoaded = true;
    if (this.cur === SERVER_SET) this.view(SERVER_SET);
  }
  // 切換模型組（伺服器預設組第一次切換時先讀取）
  async useSet(id) {
    if (id === SERVER_SET && !this.serverLoaded) await this.loadServer();
    this.view(id);
  }
  isServer(id = this.cur) {
    return id === SERVER_SET;
  }
  // 伺服器寫入失敗：通知頁面（記憶體裡的修改保留到重新讀取）
  srvFail(e) {
    console.warn('伺服器模型組寫入失敗', e);
    if (this.onError) this.onError('伺服器模型組寫入失敗：' + (e.message || e));
  }
  // 切換目前模型組：重建看得到的 GLB 與關節設定
  view(id) {
    this.cur = id;
    try {
      localStorage.setItem(CUR_KEY, id);
    } catch (e) {}
    this.local = new Map();
    for (const r of this.recs.values()) if (r.set === setOf(r.id, id)) this.local.set(r.id, r);
    if (!this.jointsBy[id]) this.jointsBy[id] = {};
    this.joints = this.jointsBy[id];
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
    if (r)
      return {
        kind: 'glb',
        origin: 'browser',
        server: r.set === SERVER_SET,
        name: r.name,
        buf: r.buf,
        size: r.size,
        t: r.t,
      };
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
    return this.putBuf(id, file.name, await file.arrayBuffer());
  }
  // orig：GLB 編輯器存檔時保留的原始檔 { name, buf }（之後可以還原）；直接拖曳替換時沒有
  // 機甲區塊與武器存進目前模型組，其他分類存成共用
  async putBuf(id, name, buf, orig = null) {
    const set = setOf(id, this.cur);
    const r = { set, id, name, size: buf.byteLength, buf, t: Date.now() };
    if (orig) r.orig = { name: orig.name, buf: orig.buf, size: orig.buf.byteLength };
    this.recs.set(keyOf(set, id), r);
    this.local.set(id, r);
    if (set === SERVER_SET)
      try {
        await this.srvPutGlb(r);
      } catch (e) {
        this.srvFail(e);
      }
    else if (this.ok)
      try {
        await tx(MODELS, 'readwrite', (s) => s.put(r));
      } catch (e) {
        console.warn('GLB 儲存失敗', e);
      }
    return r;
  }
  // 伺服器：寫入一個槽位的 GLB（有原始檔時另外上傳）
  async srvPutGlb(r) {
    const u = slotUrl(r.id);
    await api('PUT', `/api/models/default/glb/${u}?name=${encodeURIComponent(r.name)}`, r.buf);
    if (r.orig)
      await api('PUT', `/api/models/default/orig/${u}?name=${encodeURIComponent(r.orig.name)}`, r.orig.buf);
  }
  async remove(id) {
    const set = setOf(id, this.cur);
    this.recs.delete(keyOf(set, id));
    this.local.delete(id);
    if (set === SERVER_SET)
      try {
        await api('DELETE', `/api/models/default/glb/${slotUrl(id)}`);
      } catch (e) {
        this.srvFail(e);
      }
    else if (this.ok)
      try {
        await tx(MODELS, 'readwrite', (s) => s.delete([set, id]));
      } catch (e) {}
  }

  // ---------- 關節設定（目前模型組）----------
  // 連接點設定的來源：'browser'（瀏覽器暫存）／'builtin'（joints.json）／'default'（程式預設值）
  jointOrigin(slot, name) {
    if (this.joints[slot] && this.joints[slot][name]) return 'browser';
    const b = builtinJoints();
    return b[slot] && b[slot][name] ? 'builtin' : 'default';
  }
  // 寫入一個連接點（val 為 { p, r }，null 表示移除瀏覽器暫存）；記憶體立即生效，IndexedDB 非同步寫入
  setJoint(slot, name, val) {
    const set = this.cur;
    const conns = { ...(this.joints[slot] || {}) };
    if (val) conns[name] = { p: [...val.p], r: [...val.r] };
    else delete conns[name];
    if (Object.keys(conns).length) this.joints[slot] = conns;
    else delete this.joints[slot];
    setJointOverrides(this.joints);
    if (set === SERVER_SET)
      return api('PUT', `/api/models/default/joints/${slotUrl(slot)}`, conns).catch((e) => this.srvFail(e));
    if (!this.ok) return Promise.resolve();
    return tx(JOINTS, 'readwrite', (s) =>
      Object.keys(conns).length ? s.put({ set, slot, conns }) : s.delete([set, slot]),
    ).catch((e) => console.warn('關節設定儲存失敗', e));
  }
  jointCount() {
    return Object.values(this.joints).reduce((n, c) => n + Object.keys(c).length, 0);
  }
  // 匯出用：內建 joints.json ＋ 目前模型組（同一個連接點以瀏覽器為準），槽位排序
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

  // ---------- 模型組 ----------
  // 伺服器預設組最前面，再來是預設，其他依名稱
  setList() {
    const rank = (s) => (s.id === SERVER_SET ? 2 : s.id === DEFAULT_SET ? 1 : 0);
    return [...this.sets.values()].sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
  }
  curSet() {
    return this.sets.get(this.cur);
  }
  // 模型組裡的 GLB 紀錄（只有機甲區塊與武器；伺服器預設組是全部分類）
  setRecs(id) {
    return [...this.recs.values()].filter((r) => r.set === id && (id === SERVER_SET || setScoped(r.id)));
  }
  setStats(id) {
    const j = this.jointsBy[id] || {};
    return {
      glb: this.setRecs(id).length,
      joints: Object.values(j).reduce((n, c) => n + Object.keys(c).length, 0),
    };
  }
  uniqueName(name, skip = null) {
    const base = String(name || '').trim() || '模型組';
    const used = new Set([...this.sets.values()].filter((s) => s.id !== skip).map((s) => s.name));
    if (!used.has(base)) return base;
    let k = 2;
    while (used.has(`${base} (${k})`)) k++;
    return `${base} (${k})`;
  }
  // 新增模型組：data 為 { recs: [{ id, name, buf, orig? }], joints: { 槽位: conns }, asm }（空白時省略）
  async createSet(name, data = {}) {
    const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const set = {
      id,
      name: this.uniqueName(name),
      asm: data.asm ? { ...data.asm } : null,
      mechs: cleanMechs(data.mechs),
      t: Date.now(),
    };
    const recs = (data.recs || [])
      .filter((r) => setScoped(r.id))
      .map((r) => {
        const o = {
          set: id,
          id: r.id,
          name: r.name,
          size: r.buf.byteLength,
          buf: r.buf,
          t: r.t || Date.now(),
        };
        if (r.orig) o.orig = { name: r.orig.name, buf: r.orig.buf, size: r.orig.buf.byteLength };
        return o;
      });
    const joints = {};
    for (const [slot, conns] of Object.entries(data.joints || {}))
      if (conns && Object.keys(conns).length) joints[slot] = JSON.parse(JSON.stringify(conns));
    this.sets.set(id, set);
    for (const r of recs) this.recs.set(keyOf(id, r.id), r);
    this.jointsBy[id] = joints;
    if (this.ok)
      try {
        await tx([SETS, MODELS, JOINTS], 'readwrite', (os) => {
          os(SETS).put(set);
          for (const r of recs) os(MODELS).put(r);
          for (const [slot, conns] of Object.entries(joints)) os(JOINTS).put({ set: id, slot, conns });
        });
      } catch (e) {
        console.warn('模型組儲存失敗', e);
      }
    return set;
  }
  // 複製模型組（GLB 共用同一份資料，IndexedDB 會各存一份）
  duplicateSet(from, name) {
    const s = this.sets.get(from);
    return this.createSet(name || (s ? s.name : ''), {
      recs: this.setRecs(from).map((r) => copyRec(r, from)),
      joints: this.jointsBy[from] || {},
      asm: s && s.asm,
      mechs: s && s.mechs,
    });
  }
  async renameSet(id, name) {
    const s = this.sets.get(id);
    if (!s || id === SERVER_SET) return null;
    s.name = this.uniqueName(name, id);
    if (this.ok)
      try {
        await tx(SETS, 'readwrite', (os) => os.put(s));
      } catch (e) {}
    return s;
  }
  // 刪除模型組（至少留一組）；刪掉目前的模型組時切到第一組
  async deleteSet(id) {
    if (!this.sets.has(id) || id === SERVER_SET || this.localSetCount() < 2) return false;
    const recs = [...this.recs.values()].filter((r) => r.set === id);
    const slots = Object.keys(this.jointsBy[id] || {});
    this.sets.delete(id);
    for (const r of recs) this.recs.delete(keyOf(id, r.id));
    delete this.jointsBy[id];
    if (this.ok)
      try {
        await tx([SETS, MODELS, JOINTS], 'readwrite', (os) => {
          os(SETS).delete(id);
          for (const r of recs) os(MODELS).delete([id, r.id]);
          for (const slot of slots) os(JOINTS).delete([id, slot]);
          return null;
        });
      } catch (e) {
        console.warn('模型組刪除失敗', e);
      }
    if (this.cur === id) this.view(this.setList().find((s) => s.id !== SERVER_SET).id);
    return true;
  }
  localSetCount() {
    return [...this.sets.keys()].filter((k) => k !== SERVER_SET).length;
  }
  // 把本地模型組整組發佈到伺服器預設組：清掉伺服器的機甲區塊、武器與關節設定，換成這一組
  // （載具、地圖物件、小物件保留）；完成後重新讀取伺服器預設組
  async publishToServer(id) {
    const s = this.sets.get(id);
    const recs = this.setRecs(id);
    await api('POST', '/api/models/default/clear?scope=mech');
    for (const r of recs) await this.srvPutGlb(r);
    await api('PUT', '/api/models/default/joints', this.jointsBy[id] || {});
    await api('PUT', '/api/models/default/asm', (s && s.asm) || null);
    await api('PUT', '/api/models/default/mechs', (s && s.mechs) || []);
    await this.loadServer();
    return { glb: recs.length, joints: this.setStats(id).joints };
  }
  // 目前模型組的建議零件組合（組裝調整頁換零件時記下）
  async setAsm(asm) {
    const s = this.curSet();
    if (!s || JSON.stringify(s.asm) === JSON.stringify(asm)) return;
    s.asm = { ...asm };
    if (s.id === SERVER_SET)
      return api('PUT', '/api/models/default/asm', s.asm).catch((e) => this.srvFail(e));
    if (this.ok)
      try {
        await tx(SETS, 'readwrite', (os) => os.put(s));
      } catch (e) {}
  }

  // ---------- 機甲清單（組裝調整頁的預組，每個模型組一份）----------
  // 同一個模型組裡一個零件只有一份 GLB，所以清單裡的機甲是「這一組 GLB 搭配不同零件組合」
  mechsOf(id = this.cur) {
    const s = this.sets.get(id);
    return ((s && s.mechs) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
  }
  async putMech(name, asm) {
    const s = this.curSet();
    const r = { name, asm: { ...asm }, t: Date.now() };
    s.mechs = [...(s.mechs || []).filter((m) => m.name !== name), r];
    await this.saveMechs(s);
    return r;
  }
  async removeMech(name) {
    const s = this.curSet();
    s.mechs = (s.mechs || []).filter((m) => m.name !== name);
    await this.saveMechs(s);
  }
  async saveMechs(s) {
    if (s.id === SERVER_SET)
      return api('PUT', '/api/models/default/mechs', s.mechs).catch((e) => this.srvFail(e));
    if (this.ok)
      try {
        await tx(SETS, 'readwrite', (os) => os.put(s));
      } catch (e) {
        console.warn('機甲清單儲存失敗', e);
      }
  }
  // 舊版的預組是所有模型組共用的：還沒有機甲清單的模型組各複製一份（舊資料保留不動）
  async migrateMechs() {
    const old = cleanMechs([...this.presets.values()]);
    const todo = [...this.sets.values()].filter((s) => !Array.isArray(s.mechs));
    if (!todo.length) return;
    for (const s of todo) s.mechs = old.map((m) => ({ ...m, asm: { ...m.asm } }));
    if (this.ok)
      try {
        await tx(SETS, 'readwrite', (os) => {
          for (const s of todo) os.put(s);
          return null;
        });
      } catch (e) {}
  }
}
