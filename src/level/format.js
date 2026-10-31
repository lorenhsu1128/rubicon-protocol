// 自訂關卡的檔案格式（.rubicon-level，一個 JSON；設計見 docs/level-editor-design.md）：
// 欄位定義、上限、讀檔的驗證（sanitizeLevel：別人做的關卡一律先經過它）、高度圖編碼、
// 觸發器的事件／條件／動作表（編輯器的表單與執行時共用）。純資料，不碰 THREE 與 DOM。

export const LEVEL_FORMAT = 'rubicon-level';
export const LEVEL_V = 2; // 2：三倍高改版（座標與高度乘 LEVEL_K，舊檔在 migrateLevel 轉換）
export const LEVEL_K = 3; // 尺度的倍率（core/scale.js 的 WS；這裡是純資料，不 import）
export const LIMITS = {
  props: 600,
  units: 120,
  marks: 80,
  paths: 60,
  pathPts: 64,
  areas: 80,
  groups: 40,
  counters: 40,
  triggers: 200,
  acts: 24,
  conds: 8,
  removed: 3000,
  name: 40,
  desc: 300,
  text: 120,
  bytes: 2 * 1024 * 1024,
};
export const LEVEL_LV = [1, 30]; // 關卡等級（作者固定）
export const MARK_KINDS = {
  spawn: { name: '玩家出生點', color: 0x5cc8ff, max: 4 },
  cache: { name: '補給箱', color: 0xffd060 },
  supply: { name: '補給台', color: 0x7ee081 },
  term: { name: '資料終端', color: 0x7fc8ff },
  exit: { name: '出口', color: 0xffb020 },
  target: { name: '目標設施（破壞）', color: 0xff5050 },
  defend: { name: '防衛目標', color: 0x7ee081 },
  spawnpt: { name: '增援地點', color: 0xff8040 },
};
export const CACHE_LV = { repair: '全員修理', ammo: '彈藥補給', kit: '修理套件補滿' }; // 自訂關卡沒有資金與模組
export const BEHAVIORS = {
  attack: '進攻',
  hold: '守住（不移動）',
  guard: '警戒（靠近才出動）',
  patrol: '巡邏',
  retreat: '撤退',
};
export const UNIT_KINDS = {
  enemy: '敵人',
  ace: '宿敵 AC',
  boss: 'Boss',
  ally: '友軍',
  convoy: '護送車輛',
  human: '小人',
};
export const GROUP_COLORS = [0xff5050, 0xffb020, 0x7ee081, 0x5cc8ff, 0xc090ff, 0xff80c0, 0xe8e070, 0x80e0d0];

const clampN = (v, a, b, d = a) => {
  v = Number(v);
  if (!Number.isFinite(v)) return d;
  return Math.min(b, Math.max(a, v));
};
const str = (v, n) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, n);
const id = (v) => str(v, 24).replace(/[^\w-]/g, '');
const bool = (v) => !!v;
const r2 = (v) => Math.round(v * 100) / 100;

// ---------- 觸發器 ----------
// 參數型別：num（min／max／def）、text、sel（opts）、area、group、path、counter、trigger、mark（mk＝限定種類）、
// tag（物件標籤）、cue、who。編輯器依型別產生欄位，執行時也依型別驗證。
export const EVENTS = {
  start: { name: '任務開始', p: [] },
  time: { name: '經過時間', p: [{ k: 't', type: 'num', name: '秒', min: 0, max: 3600, def: 30 }] },
  every: { name: '每隔一段時間', p: [{ k: 't', type: 'num', name: '秒', min: 1, max: 600, def: 20 }] },
  enter: {
    name: '玩家進入區域',
    p: [
      { k: 'a', type: 'area', name: '區域' },
      { k: 'who', type: 'sel', name: '誰', opts: { any: '任一玩家', all: '全部玩家' }, def: 'any' },
    ],
  },
  leave: { name: '玩家離開區域', p: [{ k: 'a', type: 'area', name: '區域' }] },
  gdead: { name: '群組全滅', p: [{ k: 'g', type: 'group', name: '群組' }] },
  gleft: {
    name: '群組剩下幾台',
    p: [
      { k: 'g', type: 'group', name: '群組' },
      { k: 'n', type: 'num', name: '台數以下', min: 0, max: 99, def: 1 },
    ],
  },
  ghp: {
    name: '群組有單位 AP 低於',
    p: [
      { k: 'g', type: 'group', name: '群組' },
      { k: 'p', type: 'num', name: '%', min: 1, max: 99, def: 50 },
    ],
  },
  bphase: {
    name: 'Boss 進入型態',
    p: [
      { k: 'g', type: 'group', name: '群組（空白＝任一 Boss）' },
      { k: 'ph', type: 'sel', name: '型態', opts: { 2: '第 2 型態', 3: '第 3 型態' }, def: '2' },
    ],
  },
  prop: { name: '物件被破壞', p: [{ k: 'tag', type: 'tag', name: '物件標籤' }] },
  target: { name: '目標設施被破壞', p: [{ k: 'm', type: 'mark', mk: 'target', name: '目標（空白＝任一）' }] },
  defend: { name: '防衛目標被毀', p: [{ k: 'm', type: 'mark', mk: 'defend', name: '目標（空白＝任一）' }] },
  cache: { name: '補給箱打開', p: [{ k: 'm', type: 'mark', mk: 'cache', name: '補給箱（空白＝任一）' }] },
  term: { name: '資料終端完成', p: [{ k: 'm', type: 'mark', mk: 'term', name: '終端（空白＝任一）' }] },
  exit: { name: '玩家走進出口', p: [{ k: 'm', type: 'mark', mk: 'exit', name: '出口（空白＝任一）' }] },
  counter: {
    name: '計數器符合',
    p: [
      { k: 'c', type: 'counter', name: '計數器' },
      { k: 'op', type: 'sel', name: '比較', opts: OPS(), def: '>=' },
      { k: 'v', type: 'num', name: '數值', min: -9999, max: 9999, def: 1 },
    ],
  },
  trig: { name: '其他觸發器執行後', p: [{ k: 'tr', type: 'trigger', name: '觸發器' }] },
  timer: { name: '倒數歸零', p: [] },
  pdown: { name: '有玩家倒下', p: [] },
  convoy: { name: '護送車輛全部抵達', p: [{ k: 'g', type: 'group', name: '群組' }] },
};
function OPS() {
  return { '=': '＝', '!=': '≠', '>': '＞', '<': '＜', '>=': '≧', '<=': '≦' };
}
export const CONDS = {
  counter: {
    name: '計數器',
    p: [
      { k: 'c', type: 'counter', name: '計數器' },
      { k: 'op', type: 'sel', name: '比較', opts: OPS(), def: '=' },
      { k: 'v', type: 'num', name: '數值', min: -9999, max: 9999, def: 0 },
    ],
  },
  galive: {
    name: '群組存活台數',
    p: [
      { k: 'g', type: 'group', name: '群組' },
      { k: 'op', type: 'sel', name: '比較', opts: OPS(), def: '>' },
      { k: 'v', type: 'num', name: '台數', min: 0, max: 99, def: 0 },
    ],
  },
  players: {
    name: '玩家人數',
    p: [
      { k: 'op', type: 'sel', name: '比較', opts: OPS(), def: '>=' },
      { k: 'v', type: 'num', name: '人', min: 1, max: 4, def: 2 },
    ],
  },
  time: {
    name: '任務時間',
    p: [
      { k: 'op', type: 'sel', name: '比較', opts: OPS(), def: '>=' },
      { k: 'v', type: 'num', name: '秒', min: 0, max: 3600, def: 60 },
    ],
  },
  fired: {
    name: '觸發器執行過',
    p: [
      { k: 'tr', type: 'trigger', name: '觸發器' },
      { k: 'yes', type: 'sel', name: '', opts: { 1: '執行過', 0: '還沒執行' }, def: '1' },
    ],
  },
};
export const CUES = {
  banner: '橫幅（作戰開始的樣式）',
  warning: 'WARNING 橫幅',
  info: '中央訊息',
  good: '中央訊息（好消息）',
  warn: '中央訊息（警告）',
  clear: '清除',
  ace: '敵對 AC 介入',
};
export const WHO = {
  echo: 'ECHO（作戰支援）',
  cmd: '指揮官',
  ally: '友軍',
  enemy: '敵方',
  custom: '自訂名字',
};
export const ACTIONS = {
  spawn: {
    name: '生成群組',
    p: [
      { k: 'g', type: 'group', name: '群組' },
      {
        k: 'how',
        type: 'sel',
        name: '方式',
        opts: { place: '擺放的位置', edge: '從增援地點進入', drop: '在增援地點空降' },
        def: 'place',
      },
      { k: 'm', type: 'mark', mk: 'spawnpt', name: '增援地點' },
      { k: 'warn', type: 'sel', name: '預告', opts: { 1: 'ECHO 預告方向', 0: '不預告' }, def: '1' },
    ],
  },
  beh: {
    name: '改變群組行為',
    p: [
      { k: 'g', type: 'group', name: '群組' },
      { k: 'b', type: 'sel', name: '行為', opts: BEHAVIORS, def: 'attack' },
      { k: 'path', type: 'path', name: '巡邏路徑' },
      { k: 'm', type: 'mark', mk: 'spawnpt', name: '撤退到（增援地點）' },
    ],
  },
  remove: { name: '移除群組（不算擊破）', p: [{ k: 'g', type: 'group', name: '群組' }] },
  obj: { name: '顯示目標文字', p: [{ k: 'text', type: 'text', name: '文字（空白＝隱藏）' }] },
  open: { name: '開啟出口', p: [{ k: 'm', type: 'mark', mk: 'exit', name: '出口（空白＝全部）' }] },
  win: { name: '任務成功', p: [] },
  lose: { name: '任務失敗', p: [{ k: 'text', type: 'text', name: '原因' }] },
  count: {
    name: '開始倒數',
    p: [
      { k: 't', type: 'num', name: '秒', min: 1, max: 3600, def: 120 },
      { k: 'text', type: 'text', name: '標題' },
    ],
  },
  stop: { name: '停止倒數', p: [] },
  tfx: {
    name: '文字演出',
    p: [
      { k: 'cue', type: 'sel', name: '樣式', opts: CUES, def: 'banner' },
      { k: 'm', type: 'text', name: '主字' },
      { k: 's', type: 'text', name: '副字' },
    ],
  },
  comm: {
    name: '通訊',
    p: [
      { k: 'who', type: 'sel', name: '說話者', opts: WHO, def: 'echo' },
      { k: 'name', type: 'text', name: '自訂名字' },
      { k: 'text', type: 'text', name: '台詞' },
    ],
  },
  alarm: { name: '警報音', p: [] },
  shake: { name: '鏡頭震動', p: [] },
  area: {
    name: '顯示／隱藏區域圈',
    p: [
      { k: 'a', type: 'area', name: '區域' },
      { k: 'on', type: 'sel', name: '', opts: { 1: '顯示', 0: '隱藏' }, def: '1' },
    ],
  },
  hide: { name: '移除物件（開門）', p: [{ k: 'tag', type: 'tag', name: '物件標籤' }] },
  show: { name: '顯示物件', p: [{ k: 'tag', type: 'tag', name: '物件標籤' }] },
  weather: {
    name: '改天候',
    p: [
      {
        k: 'w',
        type: 'sel',
        name: '天候',
        opts: { none: '晴', rain: '雨', snow: '雪', sand: '沙暴', dust: '塵埃', ash: '落灰' },
        def: 'rain',
      },
    ],
  },
  heal: {
    name: '修理全員',
    p: [{ k: 'p', type: 'num', name: '% AP', min: 1, max: 100, def: 50 }],
  },
  ammo: {
    name: '補充彈藥',
    p: [{ k: 'p', type: 'num', name: '%', min: 1, max: 100, def: 50 }],
  },
  set: {
    name: '計數器設定',
    p: [
      { k: 'c', type: 'counter', name: '計數器' },
      { k: 'v', type: 'num', name: '數值', min: -9999, max: 9999, def: 0 },
    ],
  },
  add: {
    name: '計數器加減',
    p: [
      { k: 'c', type: 'counter', name: '計數器' },
      { k: 'v', type: 'num', name: '加（負數＝減）', min: -9999, max: 9999, def: 1 },
    ],
  },
  enable: {
    name: '啟用／停用觸發器',
    p: [
      { k: 'tr', type: 'trigger', name: '觸發器' },
      { k: 'on', type: 'sel', name: '', opts: { 1: '啟用', 0: '停用' }, def: '1' },
    ],
  },
  wait: { name: '等待', p: [{ k: 't', type: 'num', name: '秒', min: 0.1, max: 600, def: 3 }] },
  next: { name: '前往下一段（多段出擊）', p: [] },
};

// 依參數表補齊預設值、限制範圍；refs＝{ area, group, path, counter, trigger, mark }（id 的集合），不存在的參考清成 ''
function cleanParams(spec, raw, refs) {
  const out = {};
  const r = raw && typeof raw === 'object' ? raw : {};
  for (const p of spec) {
    const v = r[p.k];
    if (p.type === 'num') out[p.k] = clampN(v === undefined ? p.def : v, p.min, p.max, p.def);
    else if (p.type === 'text') out[p.k] = str(v, LIMITS.text);
    else if (p.type === 'tag') out[p.k] = str(v, 24);
    else if (p.type === 'sel') {
      const s = str(v === undefined ? p.def : v, 24);
      out[p.k] = s in p.opts ? s : String(p.def);
    } else {
      const s = id(v);
      const set = refs[p.type];
      out[p.k] = set && set.has(s) ? s : '';
    }
  }
  return out;
}
export function blankParams(spec) {
  return cleanParams(spec, {}, {});
}

// ---------- 高度圖：Int16（2 cm）→ base64 ----------
export const H_STEP = 0.02;
export function encodeHeights(h) {
  const a = new Int16Array(h.length);
  for (let i = 0; i < h.length; i++) a[i] = Math.max(-32767, Math.min(32767, Math.round(h[i] / H_STEP)));
  const u = new Uint8Array(a.buffer);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function decodeHeights(b64, n) {
  try {
    const s = atob(b64);
    if (s.length !== n * 2) return null;
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    const a = new Int16Array(u.buffer);
    const h = new Float32Array(n);
    for (let i = 0; i < n; i++) h[i] = a[i] * H_STEP;
    return h;
  } catch (e) {
    return null;
  }
}

export function newLevelId() {
  const c = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = 'lv';
  for (let i = 0; i < 14; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}
// 新關卡：底圖之外都是空的（地形高度在編輯器建好 World 後才寫入）
export function newLevel(base = {}) {
  const t = Date.now();
  return {
    format: LEVEL_FORMAT,
    v: LEVEL_V,
    gen: '',
    id: newLevelId(),
    name: '新關卡',
    desc: '',
    author: '',
    created: t,
    updated: t,
    thumb: '',
    base: {
      theme: base.theme || 'industrial',
      variant: base.variant || '',
      seed: base.seed || Math.floor(Math.random() * 1e9),
      blank: base.blank !== undefined ? !!base.blank : true,
      props: base.props || 'all',
      tod: base.tod || '',
      weather: base.weather || '',
      crowd: base.crowd || 'auto',
      zone: null,
      level: base.level || 5,
      np: 1,
    },
    terrain: { n: 0, h: '', water: null },
    removed: [],
    props: [],
    marks: [{ k: 'spawn', id: 'm1', name: '出生點 1', x: 0, y: 0, z: 0, yaw: 0 }],
    paths: [],
    areas: [],
    groups: [{ id: 'g1', name: 'A 隊', color: GROUP_COLORS[0] }],
    units: [],
    counters: [],
    triggers: [],
    segs: null,
    clear: null,
  };
}

// 讀檔一律經過這裡：限制數量、範圍、字串長度；不認得的項目略過（warn 收集提示）。
// known＝{ themes: Set, props: Set, units: (type) => bool, variants: (theme, key) => bool }，由呼叫端提供（避免這裡 import 遊戲資料）
export function sanitizeLevel(raw, known, warn = []) {
  if (!raw || typeof raw !== 'object' || raw.format !== LEVEL_FORMAT) throw new Error('不是自訂關卡檔');
  const L = migrateLevel(JSON.parse(JSON.stringify(raw)));
  const lim = 260 * LEVEL_K; // 座標範圍（場地 ±345 m，留一點餘裕）
  const xyz = (o) => ({
    x: r2(clampN(o.x, -lim, lim, 0)),
    y: r2(clampN(o.y, -200 * LEVEL_K, 400 * LEVEL_K, 0)),
    z: r2(clampN(o.z, -lim, lim, 0)),
  });
  const B = L.base || {};
  const theme = known.themes.has(B.theme) ? B.theme : 'industrial';
  if (theme !== B.theme) warn.push(`不認得的主題「${str(B.theme, 20)}」，改成貨運集散場`);
  const out = {
    format: LEVEL_FORMAT,
    v: LEVEL_V,
    gen: str(L.gen, 16),
    id: id(L.id) || newLevelId(),
    name: str(L.name, LIMITS.name) || '未命名關卡',
    desc: str(L.desc, LIMITS.desc),
    author: str(L.author, 24),
    created: clampN(L.created, 0, 9e15, Date.now()),
    updated: clampN(L.updated, 0, 9e15, Date.now()),
    thumb:
      typeof L.thumb === 'string' &&
      /^data:image\/(jpeg|png|webp);base64,/.test(L.thumb) &&
      L.thumb.length < 200000
        ? L.thumb
        : '',
    base: {
      theme,
      variant: known.variants(theme, B.variant) ? str(B.variant, 24) : '',
      seed: Math.floor(clampN(B.seed, 0, 2e9, 1)),
      blank: bool(B.blank),
      props: ['all', 'big', 'none'].includes(B.props) ? B.props : 'all',
      tod: ['', 'day', 'dusk', 'night', 'dawn'].includes(B.tod) ? B.tod : '',
      weather: ['', 'none', 'rain', 'snow', 'sand', 'dust', 'ash', 'coral'].includes(B.weather)
        ? B.weather
        : '',
      crowd: B.crowd === 'placed' ? 'placed' : 'auto', // 地圖上的小人：auto＝隨機加上主題的平民與步兵、placed＝只有擺放的
      zone:
        B.zone && typeof B.zone === 'object'
          ? (() => {
              const z = [B.zone.x0, B.zone.x1, B.zone.z0, B.zone.z1].map((v) => r2(clampN(v, -lim, lim, 0)));
              return z[1] - z[0] >= 20 * LEVEL_K && z[3] - z[2] >= 20 * LEVEL_K
                ? { x0: z[0], x1: z[1], z0: z[2], z1: z[3] }
                : null;
            })()
          : null,
      level: Math.round(clampN(B.level, LEVEL_LV[0], LEVEL_LV[1], 5)),
      np: Math.round(clampN(B.np, 1, 4, 1)),
    },
    terrain: { n: 0, h: '', water: null },
    removed: [],
    props: [],
    marks: [],
    paths: [],
    areas: [],
    groups: [],
    units: [],
    counters: [],
    triggers: [],
    segs: null,
    clear: null,
  };
  const T = L.terrain || {};
  if (typeof T.h === 'string' && T.n > 0 && T.n < 200 * 200 && T.h.length < 200000) {
    out.terrain.n = Math.floor(T.n);
    out.terrain.h = T.h;
  }
  if (T.water !== null && T.water !== undefined)
    out.terrain.water = r2(clampN(T.water, -50 * LEVEL_K, 80 * LEVEL_K, 0));
  const arr = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
  for (const r of arr(L.removed, LIMITS.removed))
    if (Array.isArray(r)) out.removed.push([r2(clampN(r[0], -lim, lim)), r2(clampN(r[1], -lim, lim))]);
  let skipped = 0;
  for (const p of arr(L.props, LIMITS.props)) {
    if (!p || !known.props.has(p.t)) {
      skipped++;
      continue;
    }
    const s = Array.isArray(p.s) ? p.s : [1, 1, 1];
    out.props.push({
      t: p.t,
      ...xyz(p),
      g: bool(p.g),
      yaw: r2(clampN(p.yaw, -7, 7, 0)),
      s: [0, 1, 2].map((i) => r2(clampN(s[i], 0.2, 8, 1))),
      col: ['box', 'circle', 'none'].includes(p.col) ? p.col : 'box',
      hp: Math.round(clampN(p.hp, 0, 99999, 0)),
      tag: str(p.tag, 24),
    });
  }
  if (skipped) warn.push(`略過 ${skipped} 個不認得的物件`);
  if (Array.isArray(L.props) && L.props.length > LIMITS.props)
    warn.push(`物件超過上限 ${LIMITS.props}，多的略過`);
  const ids = (a) => new Set(a.map((x) => x.id));
  const uniq = (list, pre) => {
    const seen = new Set();
    for (const x of list) {
      if (!x.id || seen.has(x.id)) {
        let i = 1;
        while (seen.has(pre + i)) i++;
        x.id = pre + i;
      }
      seen.add(x.id);
    }
  };
  const markCount = {};
  for (const m of arr(L.marks, LIMITS.marks)) {
    if (!m || !MARK_KINDS[m.k]) continue;
    markCount[m.k] = (markCount[m.k] || 0) + 1;
    if (MARK_KINDS[m.k].max && markCount[m.k] > MARK_KINDS[m.k].max) continue;
    out.marks.push({
      k: m.k,
      id: id(m.id),
      name: str(m.name, LIMITS.name),
      ...xyz(m),
      yaw: r2(clampN(m.yaw, -7, 7, 0)),
      cache: m.k === 'cache' ? (m.cache in CACHE_LV ? m.cache : 'repair') : undefined,
      g: '',
      hp: m.k === 'target' || m.k === 'defend' ? r2(clampN(m.hp, 0.2, 10, 1)) : undefined,
      t: m.k === 'term' ? r2(clampN(m.t, 1, 60, 4)) : undefined,
      open: m.k === 'exit' ? bool(m.open) : undefined,
      once: m.k === 'supply' ? m.once !== false : undefined,
    });
  }
  uniq(out.marks, 'm');
  if (!out.marks.some((m) => m.k === 'spawn'))
    out.marks.unshift({ k: 'spawn', id: 'm0', name: '出生點', x: 0, y: 0, z: 0, yaw: 0 });
  for (const p of arr(L.paths, LIMITS.paths)) {
    if (!p) continue;
    const pts = arr(p.pts, LIMITS.pathPts)
      .filter(Array.isArray)
      .map((q) => [
        r2(clampN(q[0], -lim, lim)),
        r2(clampN(q[1], -lim, lim)),
        r2(clampN(q[2], 0, 60, 0)), // 停留秒數
      ]);
    if (pts.length < 2) continue;
    out.paths.push({ id: id(p.id), name: str(p.name, LIMITS.name), pts, loop: p.loop !== false });
  }
  uniq(out.paths, 'p');
  for (const a of arr(L.areas, LIMITS.areas)) {
    if (!a) continue;
    out.areas.push({
      id: id(a.id),
      name: str(a.name, LIMITS.name),
      sh: a.sh === 'circle' ? 'circle' : 'box',
      x: r2(clampN(a.x, -lim, lim)),
      z: r2(clampN(a.z, -lim, lim)),
      w: r2(clampN(a.w, 2, 400 * LEVEL_K, 20 * LEVEL_K)),
      d: r2(clampN(a.d, 2, 400 * LEVEL_K, 20 * LEVEL_K)),
      r: r2(clampN(a.r, 1, 200 * LEVEL_K, 10 * LEVEL_K)),
      yaw: r2(clampN(a.yaw, -7, 7, 0)),
      show: bool(a.show),
      color: Math.floor(clampN(a.color, 0, 0xffffff, 0x5cc8ff)),
    });
  }
  uniq(out.areas, 'a');
  for (const g of arr(L.groups, LIMITS.groups)) {
    if (!g) continue;
    out.groups.push({
      id: id(g.id),
      name: str(g.name, LIMITS.name),
      color: Math.floor(clampN(g.color, 0, 0xffffff, 0xff5050)),
    });
  }
  uniq(out.groups, 'g');
  for (const c of arr(L.counters, LIMITS.counters)) {
    if (!c) continue;
    out.counters.push({
      id: id(c.id),
      name: str(c.name, LIMITS.name),
      v: Math.round(clampN(c.v, -9999, 9999, 0)),
    });
  }
  uniq(out.counters, 'c');
  const G = ids(out.groups),
    P = ids(out.paths),
    M = ids(out.marks);
  let badU = 0;
  for (const u of arr(L.units, LIMITS.units)) {
    if (!u || !UNIT_KINDS[u.kind] || !known.units(u.kind, u.type)) {
      badU++;
      continue;
    }
    const b = u.beh || {};
    out.units.push({
      id: id(u.id),
      kind: u.kind,
      type: str(u.type, 40),
      x: r2(clampN(u.x, -lim, lim)),
      y: r2(clampN(u.y, -200 * LEVEL_K, 400 * LEVEL_K, 0)),
      z: r2(clampN(u.z, -lim, lim)),
      yaw: r2(clampN(u.yaw, -7, 7, 0)),
      g: G.has(u.g) ? u.g : '',
      at: u.at === 'trig' ? 'trig' : 'start',
      k: r2(clampN(u.k, 0.2, 5, 1)),
      beh: {
        k: b.k in BEHAVIORS ? b.k : u.kind === 'convoy' ? 'patrol' : 'attack',
        path: P.has(b.path) ? b.path : '',
        r: r2(clampN(b.r, 5, 120 * LEVEL_K, 35 * LEVEL_K)),
        m: M.has(b.m) ? b.m : '',
        back: bool(b.back),
        speed: r2(clampN(b.speed, 0.2, 1.5, 0.6)),
      },
    });
  }
  if (badU) warn.push(`略過 ${badU} 個不認得的單位`);
  uniq(out.units, 'u');
  for (const m of out.marks)
    if (m.k === 'cache') {
      const g = (arr(L.marks, LIMITS.marks).find((x) => x && id(x.id) === m.id) || {}).g;
      m.g = G.has(g) ? g : '';
    }
  // 觸發器：先收 id（參考其他觸發器），再清參數
  const trRaw = arr(L.triggers, LIMITS.triggers).filter((t) => t && t.ev && EVENTS[t.ev.k]);
  const tr0 = trRaw.map((t) => ({ id: id(t.id) }));
  uniq(tr0, 't');
  const refs = {
    area: ids(out.areas),
    group: G,
    path: P,
    counter: ids(out.counters),
    trigger: ids(tr0),
    mark: M,
  };
  trRaw.forEach((t, i) => {
    out.triggers.push({
      id: tr0[i].id,
      name: str(t.name, LIMITS.name),
      on: t.on !== false,
      once: t.once !== false,
      any: bool(t.any),
      ev: { k: t.ev.k, ...cleanParams(EVENTS[t.ev.k].p, t.ev, refs) },
      cond: arr(t.cond, LIMITS.conds)
        .filter((c) => c && CONDS[c.k])
        .map((c) => ({ k: c.k, ...cleanParams(CONDS[c.k].p, c, refs) })),
      act: arr(t.act, LIMITS.acts)
        .filter((a) => a && ACTIONS[a.k])
        .map((a) => ({ k: a.k, ...cleanParams(ACTIONS[a.k].p, a, refs) })),
    });
  });
  // 多段出擊：每一段是一份完整的關卡內容（不含 segs 與作者資訊）
  if (Array.isArray(L.segs) && L.segs.length) {
    out.segs = [];
    for (const s of L.segs.slice(0, 5)) {
      if (!s || typeof s !== 'object') continue;
      try {
        const sub = sanitizeLevel(
          { ...s, format: LEVEL_FORMAT, segs: null, name: s.name || '區段' },
          known,
          warn,
        );
        out.segs.push(stripMeta(sub));
      } catch (e) {
        warn.push('略過一個讀不出來的區段');
      }
    }
    if (!out.segs.length) out.segs = null;
  }
  if (L.clear && typeof L.clear === 'object')
    out.clear = {
      by: str(L.clear.by, 24),
      t: r2(clampN(L.clear.t, 0, 1e6, 0)),
      at: clampN(L.clear.at, 0, 9e15, 0),
    };
  return out;
}
// 區段只留地圖與玩法的部分
export function stripMeta(L) {
  const { format, v, id: _id, author, created, updated, thumb, segs, clear, desc, ...rest } = L;
  return rest;
}
// 第 n 段（0＝主關卡本身）的內容
export function segOf(L, n) {
  if (!n || !L.segs || !L.segs[n - 1]) return L;
  return { ...L.segs[n - 1], format: LEVEL_FORMAT, id: L.id, name: L.name };
}
export function segCount(L) {
  return 1 + ((L.segs && L.segs.length) || 0);
}
// 格式升級（v1 → v2 …）：之後改格式時在這裡加，舊檔一定讀得進來
export function migrateLevel(L) {
  if (!L.v) L.v = 1;
  if (L.v < 2) {
    // v1 → v2（三倍高改版）：位置、高度、範圍乘 LEVEL_K；高度圖的格數不變（World 載入時重新取樣到新的格子）
    scaleSeg(L, LEVEL_K);
    if (Array.isArray(L.segs)) for (const s of L.segs) if (s) scaleSeg(s, LEVEL_K);
    L.v = 2;
  }
  return L;
}
// 一段關卡內容的座標乘 k（migrateLevel 用）
function scaleSeg(L, k) {
  const n = (v) => (Number.isFinite(Number(v)) ? Number(v) * k : v);
  const pos = (o) => {
    if (!o) return;
    o.x = n(o.x);
    o.y = n(o.y);
    o.z = n(o.z);
  };
  const B = L.base || {};
  if (B.zone && typeof B.zone === 'object')
    for (const f of ['x0', 'x1', 'z0', 'z1']) B.zone[f] = n(B.zone[f]);
  const T = L.terrain || {};
  if (T.water !== null && T.water !== undefined) T.water = n(T.water);
  if (typeof T.h === 'string' && T.n > 0) {
    const h = decodeHeights(T.h, T.n);
    if (h) {
      for (let i = 0; i < h.length; i++) h[i] *= k;
      T.h = encodeHeights(h);
    }
  }
  for (const r of L.removed || []) if (Array.isArray(r)) ((r[0] = n(r[0])), (r[1] = n(r[1])));
  for (const p of L.props || []) pos(p);
  for (const m of L.marks || []) pos(m);
  for (const u of L.units || []) {
    pos(u);
    if (u && u.beh && u.beh.r !== undefined) u.beh.r = n(u.beh.r);
  }
  for (const p of L.paths || [])
    for (const q of (p && p.pts) || []) if (Array.isArray(q)) for (let i = 0; i < 2; i++) q[i] = n(q[i]); // q[2] 是停留秒數
  for (const a of L.areas || []) {
    if (!a) continue;
    a.x = n(a.x);
    a.z = n(a.z);
    a.w = n(a.w);
    a.d = n(a.d);
    a.r = n(a.r);
  }
}
export function cmpOp(a, op, b) {
  switch (op) {
    case '=':
      return a === b;
    case '!=':
      return a !== b;
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
  }
  return false;
}
// 點在區域裡（box 依 yaw 旋轉）
export function inArea(a, x, z) {
  const dx = x - a.x,
    dz = z - a.z;
  if (a.sh === 'circle') return dx * dx + dz * dz <= a.r * a.r;
  const c = Math.cos(a.yaw || 0),
    s = Math.sin(a.yaw || 0);
  const lx = dx * c - dz * s,
    lz = dx * s + dz * c;
  return Math.abs(lx) <= a.w / 2 && Math.abs(lz) <= a.d / 2;
}
// 關卡的大小（上傳前檢查）
export function levelBytes(L) {
  return new Blob([JSON.stringify(L)]).size;
}
