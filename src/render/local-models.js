// 本地模型庫（只在單人模式套用）：讀取模型庫存在這個瀏覽器的 GLB 與關節設定，取代遊戲中的程式模型。
// - 資料在模型庫的 IndexedDB（rubicon-model-library）；瀏覽器暫存以「來源」區分，遊戲與模型庫要用同一種方式開啟
//   （都從同一個伺服器網址，或都用 file://）才讀得到，讀不到就維持程式模型
// - 設定（總開關＋分類開關＋模型組）存在 localStorage 的 rubicon_localmodels
// - 模型組：機甲區塊與武器的 GLB、關節設定依設定的模型組讀取（全部機甲共用一組），其他分類共用
// - 多人時一律停用（allow 由遊戲設定，有連線角色時回傳 false）；碰撞與判定一律維持程式模型的數值
import { OUTLINE_MAT } from './geometry.js';
import { glbScene, parseGlb, tintMaterial } from './glb.js';
import { setJointOverrides } from './mech-joints.js';

const DB = 'rubicon-model-library';
const SETTINGS_KEY = 'rubicon_localmodels';

// 分類：槽位 id 的第一段 → 分類
export const LM_GROUPS = [
  {
    id: 'mech',
    name: '機甲區塊',
    note: '頭、核心、手臂、腳、背包，含關節設定',
    cats: ['head', 'core', 'arms', 'legs', 'booster'],
  },
  { id: 'weapon', name: '武器', note: '手持武器、背部武器', cats: ['weapon', 'back'] },
  { id: 'vehicle', name: '載具', note: '戰車、直升機、無人機、運輸車輛、轟炸機', cats: ['vehicle'] },
  { id: 'prop', name: '地圖物件', note: '只換外觀，碰撞不變', cats: ['prop'] },
  { id: 'small', name: '小物件', note: '掉落物、彈體', cats: ['small'] },
];
export const groupOf = (id) => {
  const c = String(id).split('/')[0];
  const g = LM_GROUPS.find((x) => x.cats.includes(c));
  return g ? g.id : null;
};
// 模型組：機甲區塊與武器的 GLB 和關節設定一起切換（關節設定要配合 GLB 的原點）；其他分類所有模型組共用
export const DEFAULT_SET = 'default';
export const SET_GROUPS = ['mech', 'weapon'];
export const setScoped = (id) => SET_GROUPS.includes(groupOf(id));
// 伺服器預設組（從伺服器網址開啟時）：涵蓋所有分類
export const SERVER_SET = '@server';
// 槽位的紀錄屬於哪個模型組（共用的為 ''；伺服器預設組不分）
export const setOf = (id, set) => (set === SERVER_SET || setScoped(id) ? set : '');

// 解析 GLB 成範本：{ root, info }；沒有網格或含蒙皮時丟出錯誤
export async function parseTemplate(buf) {
  const { root, info } = glbScene(await parseGlb(buf), null);
  let meshes = 0;
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) meshes++;
  });
  if (!meshes) throw new Error('模型沒有可見的網格');
  if (info.skinned) throw new Error('含蒙皮網格（遊戲不使用骨架蒙皮）');
  return { root, info };
}
// 由範本建立一個實例（共用幾何；材質依配色換色）。unique：每個實例各自一份材質（機甲受擊閃光會改材質）
// tinted：共用材質的換色快取（WeakMap：原材質 → Map(配色 → 材質)）
export function instanceOf(tpl, slot, pal, unique, tinted) {
  const obj = tpl.clone(true);
  obj.traverse((o) => {
    if (!o.isMesh || o.material === OUTLINE_MAT) return;
    const one = (m) => {
      if (unique) {
        const c = tintMaterial(m, pal);
        const u = c === m ? m.clone() : c;
        if (u.emissive) u.userData.emis0 = u.emissive.clone(); // 受擊閃光後還原
        return u;
      }
      if (!pal) return m;
      let by = tinted.get(m);
      if (!by) tinted.set(m, (by = new Map()));
      if (!by.has(pal)) by.set(pal, tintMaterial(m, pal));
      return by.get(pal);
    };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  obj.userData.localGlb = slot;
  return obj;
}
// 左側武器沒有自己的 GLB 時暫用右側的：回傳要找的槽位清單
export const slotChain = (id) => {
  const m = /^((?:weapon|back)\/[^/]+)\/l$/.exec(id);
  return m ? [id, m[1] + '/r'] : [id];
};

function loadSettings() {
  const def = { on: false, groups: Object.fromEntries(LM_GROUPS.map((g) => [g.id, true])), set: DEFAULT_SET };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && typeof s === 'object')
      return {
        on: !!s.on,
        groups: { ...def.groups, ...(s.groups || {}) },
        set: typeof s.set === 'string' && s.set ? s.set : DEFAULT_SET,
      };
  } catch (e) {}
  return def;
}

// 讀取模型庫的資料：{ glb: [{ set, id, … }], joints: [{ set, slot, conns }], sets: [{ id, name, asm }] }
// 資料庫不存在時不建立它（中止升級），回傳 null；模型庫還沒升級的舊版資料（glb／joints）當成預設模型組
// only：只讀這幾類（例如 ['sets'] 只列模型組，不讀 GLB）
function readDb(only = null) {
  return new Promise((res) => {
    let r;
    try {
      r = indexedDB.open(DB);
    } catch (e) {
      return res(null);
    }
    r.onupgradeneeded = () => r.transaction.abort();
    r.onerror = () => res(null);
    r.onblocked = () => res(null);
    r.onsuccess = () => {
      const d = r.result;
      const v4 = d.objectStoreNames.contains('models');
      const map = v4
        ? { glb: 'models', joints: 'setJoints', sets: 'sets' }
        : { glb: 'glb', joints: 'joints' };
      const keys = Object.keys(map).filter(
        (k) => d.objectStoreNames.contains(map[k]) && (!only || only.includes(k)),
      );
      const out = { glb: [], joints: [], sets: [] };
      if (!keys.length) {
        d.close();
        return res(out);
      }
      const t = d.transaction(
        keys.map((k) => map[k]),
        'readonly',
      );
      for (const k of keys) {
        const q = t.objectStore(map[k]).getAll();
        q.onsuccess = () => (out[k] = q.result || []);
      }
      t.oncomplete = () => {
        d.close(); // 不佔住連線，模型庫之後才能升級資料庫
        if (!v4) {
          for (const r of out.glb) if (r) r.set = setOf(r.id, DEFAULT_SET);
          for (const r of out.joints) if (r) r.set = DEFAULT_SET;
        }
        if (!out.sets.some((s) => s && s.id === DEFAULT_SET))
          out.sets.unshift({ id: DEFAULT_SET, name: '預設' });
        res(out);
      };
      t.onerror = () => {
        d.close();
        res(null);
      };
    };
  });
}

const tick = () => new Promise((r) => setTimeout(r, 0));

class LocalModelLib {
  constructor() {
    this.settings = loadSettings();
    this.allow = () => true; // 遊戲設定：多人時回傳 false
    this.cache = new Map(); // `${模型組}|${槽位}`（共用的模型組為 ''）→ { t, size, name, tpl, info, err, checks }
    this.jointsBy = {}; // 模型組 → { 槽位 → 連接點 }
    this.sets = []; // 模型庫裡的模型組 [{ id, name }]
    this.set = DEFAULT_SET; // 實際讀取的模型組（設定的模型組不存在時改用預設）
    this.setData = null; // 讀取的模型組原始資料 { id, name, asm, recs, joints }（多人上傳到伺服器用）
    this.status = null; // 最近一次讀取的結果
    this.loading = null;
    this.tinted = new WeakMap(); // 共用材質的換色快取：原材質 → Map(配色 → 材質)
    this.uses = new Map(); // 槽位 → 這次開啟遊戲後建立過幾個實例（設定畫面顯示，確認遊戲真的用到）
  }
  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch (e) {}
    this.applyJoints();
  }
  // 是否套用（總開關開啟、單人模式）
  active() {
    return this.settings.on && !this.paused && this.allow();
  }
  // 暫停套用（建立程式模型當規格檢查的參考時）
  suspend(fn) {
    this.paused = (this.paused || 0) + 1;
    try {
      return fn();
    } finally {
      this.paused--;
    }
  }
  groupOn(id) {
    const g = groupOf(id);
    return !!g && this.settings.groups[g] !== false;
  }
  // 模型組的關節設定（預設為目前讀取的模型組）
  jointsOf(set = this.set) {
    return this.jointsBy[set] || {};
  }
  applyJoints() {
    const on = this.settings.on && this.settings.groups.mech !== false;
    setJointOverrides(on ? this.jointsOf() : {}, () => this.active());
  }
  // 重新讀取模型庫。onProgress(完成數, 總數, 槽位)；checker(槽位, root, info, bytes) → 規格檢查清單（可省略）
  // 同一個檔案（修改時間與大小相同）沿用上次解析的結果
  reload(onProgress, checker) {
    if (this.loading) return this.loading;
    this.loading = this._reload(onProgress, checker).finally(() => (this.loading = null));
    return this.loading;
  }
  async _reload(onProgress, checker) {
    const st = { t: Date.now(), on: this.settings.on, db: false, glb: 0, joints: 0, slots: [], set: null };
    if (!this.settings.on) {
      this.status = st;
      return st;
    }
    const data = await readDb();
    st.db = !!data;
    this.sets = ((data && data.sets) || [])
      .filter((s) => s && s.id)
      .map((s) => ({ id: s.id, name: s.name, asm: s.asm || null }));
    this.set = this.sets.some((s) => s.id === this.settings.set) ? this.settings.set : DEFAULT_SET;
    st.set = this.set;
    // 只讀這個模型組的機甲區塊與武器，加上共用分類
    const recs = ((data && data.glb) || []).filter(
      (r) => r && r.id && r.buf && groupOf(r.id) && r.set === setOf(r.id, this.set),
    );
    this.jointsBy = {};
    for (const r of (data && data.joints) || [])
      if (r && r.slot && r.conns && Object.keys(r.conns).length)
        (this.jointsBy[r.set] = this.jointsBy[r.set] || {})[r.slot] = r.conns;
    st.joints = Object.values(this.jointsOf()).reduce((n, c) => n + Object.keys(c).length, 0);
    this.applyJoints();
    const meta = this.sets.find((s) => s.id === this.set);
    this.setData = st.db
      ? {
          id: this.set,
          name: meta ? meta.name : this.set,
          asm: meta ? meta.asm : null,
          recs: recs
            .filter((r) => setScoped(r.id))
            .map((r) => ({ id: r.id, name: r.name, buf: r.buf, t: r.t })),
          joints: this.jointsOf(),
        }
      : null;
    // 已不存在的槽位移出快取
    const keys = new Set(recs.map((r) => r.set + '|' + r.id));
    for (const k of [...this.cache.keys()]) if (!keys.has(k)) this.cache.delete(k);
    const todo = recs.filter((r) => this.groupOn(r.id));
    let done = 0;
    if (onProgress) onProgress(0, todo.length, '');
    for (const r of todo) {
      const key = r.set + '|' + r.id;
      const old = this.cache.get(key);
      if (!old || old.t !== r.t || old.size !== r.size) {
        if (onProgress) onProgress(done, todo.length, r.id);
        await tick(); // 讓進度條有機會重繪
        const e = { t: r.t, size: r.size, name: r.name, tpl: null, info: null, err: null, checks: [] };
        try {
          const { root, info } = await parseTemplate(r.buf);
          e.tpl = root;
          e.info = info;
          if (checker)
            e.checks = (checker(r.id, root, info, r.size) || []).filter(
              (c) => c.lv === 'warn' || c.lv === 'error',
            );
        } catch (err) {
          e.err = err.message || String(err);
        }
        this.cache.set(key, e);
      }
      done++;
      if (onProgress) onProgress(done, todo.length, r.id);
    }
    st.glb = recs.length;
    st.slots = recs.map((r) => {
      const e = this.cache.get(r.set + '|' + r.id);
      return {
        id: r.id,
        group: groupOf(r.id),
        on: this.groupOn(r.id),
        name: r.name,
        err: e ? e.err : null,
        checks: e ? e.checks : [],
      };
    });
    this.status = st;
    return st;
  }
  // 槽位目前要用的 GLB 範本（沒有、失敗、分類關閉或未啟用時為 null）；左側武器沒有自己的 GLB 時暫用右側
  // set：模型組（預設為目前讀取的模型組；只有讀取過的模型組有範本）
  template(id, set = this.set) {
    if (!this.active() || !this.groupOn(id)) return null;
    for (const slot of slotChain(id)) {
      const e = this.cache.get(setOf(slot, set) + '|' + slot);
      if (e) return e.tpl || null; // 有自己的檔案但失敗時不暫用右側
    }
    return null;
  }
  has(id) {
    return !!this.template(id);
  }
  // 建立一個實例（共用幾何；材質依配色換色）。unique：每個實例各自一份材質（機甲受擊閃光會改材質）
  model(id, pal, unique = false) {
    const tpl = this.template(id);
    if (!tpl) return null;
    this.uses.set(id, (this.uses.get(id) || 0) + 1);
    return instanceOf(tpl, id, pal, unique, this.tinted);
  }
  // 自己的機甲用的模型組（buildMech 的 opts.source）：沒開啟、選了伺服器預設組或讀不到時為 null
  mySource() {
    const S = this.settings;
    if (!this.active() || S.set === SERVER_SET || !this.status || !this.status.db) return null;
    return {
      id: 'local:' + this.set,
      model: (slot, pal, unique) => (setScoped(slot) ? this.model(slot, pal, unique) : null),
      joints: S.groups.mech !== false ? this.jointsOf() : {},
    };
  }
  // 只列出模型庫的模型組（不讀 GLB）
  async listSets() {
    const data = await readDb(['sets']);
    if (data)
      this.sets = data.sets
        .filter((s) => s && s.id)
        .map((s) => ({ id: s.id, name: s.name, asm: s.asm || null }));
    return this.sets;
  }
}

export const LocalModels = new LocalModelLib();
