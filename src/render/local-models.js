// 本地模型庫（只在單人模式套用）：讀取模型庫存在這個瀏覽器的 GLB 與關節設定，取代遊戲中的程式模型。
// - 資料在模型庫的 IndexedDB（rubicon-model-library）；瀏覽器暫存以「來源」區分，遊戲與模型庫要用同一種方式開啟
//   （都從同一個伺服器網址，或都用 file://）才讀得到，讀不到就維持程式模型
// - 設定（總開關＋分類開關）存在 localStorage 的 rubicon_localmodels
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

function loadSettings() {
  const def = { on: false, groups: Object.fromEntries(LM_GROUPS.map((g) => [g.id, true])) };
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (s && typeof s === 'object') return { on: !!s.on, groups: { ...def.groups, ...(s.groups || {}) } };
  } catch (e) {}
  return def;
}

// 讀取模型庫的資料；資料庫不存在時不建立它（中止升級），回傳 null
function readDb() {
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
      const names = ['glb', 'joints'].filter((n) => d.objectStoreNames.contains(n));
      if (!names.length) {
        d.close();
        return res({ glb: [], joints: [] });
      }
      const out = { glb: [], joints: [] };
      const t = d.transaction(names, 'readonly');
      for (const n of names) {
        const q = t.objectStore(n).getAll();
        q.onsuccess = () => (out[n] = q.result || []);
      }
      t.oncomplete = () => {
        d.close(); // 不佔住連線，模型庫之後才能升級資料庫
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
    this.cache = new Map(); // 槽位 → { t, size, name, tpl, info, err, checks }
    this.joints = {};
    this.status = null; // 最近一次讀取的結果
    this.loading = null;
    this.tinted = new WeakMap(); // 共用材質的換色快取：原材質 → Map(配色 → 材質)
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
  applyJoints() {
    const on = this.settings.on && this.settings.groups.mech !== false;
    setJointOverrides(on ? this.joints : {}, () => this.active());
  }
  // 重新讀取模型庫。onProgress(完成數, 總數, 槽位)；checker(槽位, root, info, bytes) → 規格檢查清單（可省略）
  // 同一個檔案（修改時間與大小相同）沿用上次解析的結果
  reload(onProgress, checker) {
    if (this.loading) return this.loading;
    this.loading = this._reload(onProgress, checker).finally(() => (this.loading = null));
    return this.loading;
  }
  async _reload(onProgress, checker) {
    const st = { t: Date.now(), on: this.settings.on, db: false, glb: 0, joints: 0, slots: [] };
    if (!this.settings.on) {
      this.status = st;
      return st;
    }
    const data = await readDb();
    st.db = !!data;
    const recs = ((data && data.glb) || []).filter((r) => r && r.id && r.buf && groupOf(r.id));
    this.joints = {};
    for (const r of (data && data.joints) || [])
      if (r && r.slot && r.conns && Object.keys(r.conns).length) this.joints[r.slot] = r.conns;
    st.joints = Object.values(this.joints).reduce((n, c) => n + Object.keys(c).length, 0);
    this.applyJoints();
    // 已不存在的槽位移出快取
    const ids = new Set(recs.map((r) => r.id));
    for (const id of [...this.cache.keys()]) if (!ids.has(id)) this.cache.delete(id);
    const todo = recs.filter((r) => this.groupOn(r.id));
    let done = 0;
    if (onProgress) onProgress(0, todo.length, '');
    for (const r of todo) {
      const old = this.cache.get(r.id);
      if (!old || old.t !== r.t || old.size !== r.size) {
        if (onProgress) onProgress(done, todo.length, r.id);
        await tick(); // 讓進度條有機會重繪
        const e = { t: r.t, size: r.size, name: r.name, tpl: null, info: null, err: null, checks: [] };
        try {
          const { root, info } = glbScene(await parseGlb(r.buf), null);
          let meshes = 0;
          root.traverse((o) => {
            if (o.isMesh && o.material !== OUTLINE_MAT) meshes++;
          });
          if (!meshes) throw new Error('模型沒有可見的網格');
          if (info.skinned) throw new Error('含蒙皮網格（遊戲不使用骨架蒙皮）');
          e.tpl = root;
          e.info = info;
          if (checker)
            e.checks = (checker(r.id, root, info, r.size) || []).filter(
              (c) => c.lv === 'warn' || c.lv === 'error',
            );
        } catch (err) {
          e.err = err.message || String(err);
        }
        this.cache.set(r.id, e);
      }
      done++;
      if (onProgress) onProgress(done, todo.length, r.id);
    }
    st.glb = recs.length;
    st.slots = recs.map((r) => {
      const e = this.cache.get(r.id);
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
  template(id) {
    if (!this.active() || !this.groupOn(id)) return null;
    const own = this.cache.get(id);
    if (own && own.tpl) return own.tpl;
    if (own) return null;
    const m = /^((?:weapon|back)\/[^/]+)\/l$/.exec(id);
    if (m) {
      const r = this.cache.get(m[1] + '/r');
      if (r && r.tpl) return r.tpl;
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
    const obj = tpl.clone(true);
    obj.traverse((o) => {
      if (!o.isMesh || o.material === OUTLINE_MAT) return;
      const one = (m) => {
        if (unique) {
          const c = tintMaterial(m, pal);
          return c === m ? m.clone() : c;
        }
        if (!pal) return m;
        let by = this.tinted.get(m);
        if (!by) this.tinted.set(m, (by = new Map()));
        if (!by.has(pal)) by.set(pal, tintMaterial(m, pal));
        return by.get(pal);
      };
      o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
    });
    obj.userData.localGlb = id;
    return obj;
  }
}

export const LocalModels = new LocalModelLib();
