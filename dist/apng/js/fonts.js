// 字型管理
//  - Google Fonts：選到時才載入 CSS，document.fonts.load 只會下載實際用到的字元切片
//  - 使用者上傳的字型：存在這個瀏覽器的 IndexedDB，下次也能用
//  - 電腦已安裝的字型：只記名稱
//  - 每套字型都有一個風格相近的繁中後備字型，缺字時自動補上

export const CATEGORIES = [
  { id: 'sans', label: { 'zh-TW': '黑體', en: 'Sans' } },
  { id: 'serif', label: { 'zh-TW': '明體・宋體', en: 'Serif' } },
  { id: 'round', label: { 'zh-TW': '圓體・可愛', en: 'Rounded / Cute' } },
  { id: 'display', label: { 'zh-TW': '設計字', en: 'Display' } },
  { id: 'hand', label: { 'zh-TW': '毛筆・手寫', en: 'Brush / Hand' } },
  { id: 'latin', label: { 'zh-TW': '西文', en: 'Latin' } },
  { id: 'other', label: { 'zh-TW': '日文・韓文・簡中', en: 'JP / KR / SC' } },
  { id: 'user', label: { 'zh-TW': '我的字型', en: 'My fonts' } }
];

// fb：後備字型的 id（缺字時使用）
const F = (id, family, weights, cat, fb, note) => ({ id, family, weights, cat, fb, note, google: true });
const CATALOG = [
  F('noto-sans-tc', 'Noto Sans TC', [400, 500, 700, 900], 'sans'),
  F('chocolate-classical-sans', 'Chocolate Classical Sans', [400], 'sans', 'noto-sans-tc'),
  F('noto-sans-jp', 'Noto Sans JP', [400, 700, 900], 'sans', 'noto-sans-tc'),
  F('zen-kaku-gothic-new', 'Zen Kaku Gothic New', [400, 700, 900], 'sans', 'noto-sans-tc'),
  F('biz-udpgothic', 'BIZ UDPGothic', [400, 700], 'sans', 'noto-sans-tc'),

  F('noto-serif-tc', 'Noto Serif TC', [400, 700, 900], 'serif'),
  F('cactus-classical-serif', 'Cactus Classical Serif', [400], 'serif', 'noto-serif-tc'),
  F('noto-serif-jp', 'Noto Serif JP', [400, 700, 900], 'serif', 'noto-serif-tc'),
  F('shippori-mincho-b1', 'Shippori Mincho B1', [400, 700, 800], 'serif', 'noto-serif-tc'),
  F('zen-old-mincho', 'Zen Old Mincho', [400, 700, 900], 'serif', 'noto-serif-tc'),
  F('biz-udpmincho', 'BIZ UDPMincho', [400, 700], 'serif', 'noto-serif-tc'),

  F('huninn', 'Huninn', [400], 'round', 'noto-sans-tc'),
  F('m-plus-rounded-1c', 'M PLUS Rounded 1c', [400, 700, 900], 'round', 'huninn'),
  F('zen-maru-gothic', 'Zen Maru Gothic', [400, 700, 900], 'round', 'huninn'),
  F('kosugi-maru', 'Kosugi Maru', [400], 'round', 'huninn'),
  F('kiwi-maru', 'Kiwi Maru', [400, 500], 'round', 'huninn'),
  F('mochiy-pop-one', 'Mochiy Pop One', [400], 'round', 'huninn'),
  F('hachi-maru-pop', 'Hachi Maru Pop', [400], 'round', 'huninn'),
  F('potta-one', 'Potta One', [400], 'round', 'huninn'),

  F('dela-gothic-one', 'Dela Gothic One', [400], 'display', 'noto-sans-tc'),
  F('rocknroll-one', 'RocknRoll One', [400], 'display', 'noto-sans-tc'),
  F('reggae-one', 'Reggae One', [400], 'display', 'noto-sans-tc'),
  F('rampart-one', 'Rampart One', [400], 'display', 'noto-sans-tc'),
  F('train-one', 'Train One', [400], 'display', 'noto-sans-tc'),
  F('stick', 'Stick', [400], 'display', 'noto-sans-tc'),
  F('dotgothic16', 'DotGothic16', [400], 'display', 'noto-sans-tc'),
  F('kaisei-decol', 'Kaisei Decol', [400, 700], 'display', 'noto-serif-tc'),
  F('zen-antique', 'Zen Antique', [400], 'display', 'noto-serif-tc'),
  F('new-tegomin', 'New Tegomin', [400], 'display', 'noto-serif-tc'),

  F('lxgw-wenkai-tc', 'LXGW WenKai TC', [300, 400, 700], 'hand'),
  F('iansui', 'Iansui', [400], 'hand', 'lxgw-wenkai-tc'),
  F('yuji-syuku', 'Yuji Syuku', [400], 'hand', 'lxgw-wenkai-tc'),
  F('yuji-mai', 'Yuji Mai', [400], 'hand', 'lxgw-wenkai-tc'),
  F('yuji-boku', 'Yuji Boku', [400], 'hand', 'lxgw-wenkai-tc'),
  F('klee-one', 'Klee One', [400, 600], 'hand', 'lxgw-wenkai-tc'),
  F('yomogi', 'Yomogi', [400], 'hand', 'lxgw-wenkai-tc'),
  F('zen-kurenaido', 'Zen Kurenaido', [400], 'hand', 'lxgw-wenkai-tc'),
  F('yusei-magic', 'Yusei Magic', [400], 'hand', 'lxgw-wenkai-tc'),

  F('cinzel', 'Cinzel', [400, 700, 900], 'latin', 'noto-serif-tc'),
  F('cinzel-decorative', 'Cinzel Decorative', [400, 700, 900], 'latin', 'noto-serif-tc'),
  F('playfair-display', 'Playfair Display', [400, 700, 900], 'latin', 'noto-serif-tc'),
  F('cormorant-garamond', 'Cormorant Garamond', [400, 700], 'latin', 'noto-serif-tc'),
  F('im-fell-english', 'IM Fell English', [400], 'latin', 'noto-serif-tc'),
  F('unifrakturmaguntia', 'UnifrakturMaguntia', [400], 'latin', 'noto-serif-tc'),
  F('bebas-neue', 'Bebas Neue', [400], 'latin', 'noto-sans-tc'),
  F('oswald', 'Oswald', [400, 700], 'latin', 'noto-sans-tc'),
  F('montserrat', 'Montserrat', [400, 700, 900], 'latin', 'noto-sans-tc'),
  F('orbitron', 'Orbitron', [400, 700, 900], 'latin', 'noto-sans-tc'),
  F('audiowide', 'Audiowide', [400], 'latin', 'noto-sans-tc'),
  F('russo-one', 'Russo One', [400], 'latin', 'noto-sans-tc'),
  F('black-ops-one', 'Black Ops One', [400], 'latin', 'noto-sans-tc'),
  F('righteous', 'Righteous', [400], 'latin', 'noto-sans-tc'),
  F('special-elite', 'Special Elite', [400], 'latin', 'noto-serif-tc'),
  F('share-tech-mono', 'Share Tech Mono', [400], 'latin', 'noto-sans-tc'),
  F('vt323', 'VT323', [400], 'latin', 'noto-sans-tc'),
  F('press-start-2p', 'Press Start 2P', [400], 'latin', 'noto-sans-tc'),
  F('creepster', 'Creepster', [400], 'latin', 'noto-sans-tc'),
  F('nosifer', 'Nosifer', [400], 'latin', 'noto-sans-tc'),

  F('noto-sans-kr', 'Noto Sans KR', [400, 700, 900], 'other', 'noto-sans-tc'),
  F('black-han-sans', 'Black Han Sans', [400], 'other', 'noto-sans-tc'),
  F('noto-sans-sc', 'Noto Sans SC', [400, 700, 900], 'other', 'noto-sans-tc'),
  F('ma-shan-zheng', 'Ma Shan Zheng', [400], 'other', 'lxgw-wenkai-tc'),
  F('zcool-kuaile', 'ZCOOL KuaiLe', [400], 'other', 'huninn')
];

const GENERIC = { serif: 'serif', hand: 'cursive' };
const userFonts = new Map(); // id → { id, family, label, cat:'user', weights, buffer? }
const cssLoaded = new Map(); // family → Promise
const ready = new Set(); // 已載入的 `${family}|${weight}|${text}`

export function list() {
  return [...CATALOG, ...userFonts.values()];
}
export function get(id) {
  return CATALOG.find(f => f.id === id) || userFonts.get(id) || null;
}
export function label(font) {
  return font ? font.label || font.family : '';
}

// canvas 用的 font-family 串（主字型 → 後備字型 → 通用字族）
export function familyStack(id) {
  const font = get(id) || get('noto-sans-tc');
  const chain = [font];
  let fb = font.fb ? get(font.fb) : null;
  while (fb && chain.length < 3 && !chain.includes(fb)) { chain.push(fb); fb = fb.fb ? get(fb.fb) : null; }
  if (!chain.some(f => f.id === 'noto-sans-tc')) chain.push(get('noto-sans-tc'));
  const generic = GENERIC[(get(font.fb) || font).cat] || 'sans-serif';
  return chain.map(f => `"${f.family}"`).join(', ') + ', ' + generic;
}

export function nearestWeight(id, weight) {
  const font = get(id);
  const ws = font?.weights || [400];
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}

function loadCss(font) {
  if (!font.google) return Promise.resolve();
  if (cssLoaded.has(font.family)) return cssLoaded.get(font.family);
  const fam = font.family.replace(/ /g, '+');
  const spec = font.weights.length > 1 || font.weights[0] !== 400 ? `:wght@${font.weights.join(';')}` : '';
  const href = `https://fonts.googleapis.com/css2?family=${fam}${spec}&display=block`;
  const p = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.append(link);
  });
  cssLoaded.set(font.family, p);
  return p;
}

// 確保畫這些文字所需的字型（含後備字型）都已下載完成
export async function ensure(id, weight, text) {
  const font = get(id) || get('noto-sans-tc');
  const chain = [font];
  for (let f = font; f?.fb && chain.length < 3;) { f = get(f.fb); if (f && !chain.includes(f)) chain.push(f); else break; }
  const sample = text && text.trim() ? text : 'あ文A';
  const jobs = chain.map(async f => {
    const w = nearestWeight(f.id, weight);
    const key = `${f.family}|${w}|${sample}`;
    if (ready.has(key)) return true;
    await loadCss(f);
    try {
      await document.fonts.load(`${w} 40px "${f.family}"`, sample);
      ready.add(key);
      return true;
    } catch {
      return false;
    }
  });
  const res = await Promise.all(jobs);
  return res.every(Boolean);
}

// 字型卡片預覽用：只載入字型名稱與幾個範例字
export function preview(id, sample) {
  return ensure(id, get(id)?.weights?.[0] || 400, sample);
}

/* ---------- 使用者字型（IndexedDB） ---------- */

const DB_NAME = 'text-anim-maker';
const STORE = 'fonts';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

async function registerFace(rec) {
  const face = new FontFace(rec.family, rec.buffer);
  await face.load();
  document.fonts.add(face);
  userFonts.set(rec.id, { id: rec.id, family: rec.family, label: rec.label, cat: 'user', weights: [400, 700], fb: 'noto-sans-tc', local: rec.local });
}

export async function restoreUserFonts() {
  try {
    const all = (await idb('readonly', s => s.getAll())) || [];
    for (const rec of all) {
      if (rec.local) userFonts.set(rec.id, { id: rec.id, family: rec.family, label: rec.label, cat: 'user', weights: [400, 700], fb: 'noto-sans-tc', local: true });
      else await registerFace(rec).catch(() => {});
    }
  } catch { /* IndexedDB 不能用時就只在這次有效 */ }
}

// 回傳 { font, saved, duplicate }
export async function addFontFile(file) {
  const buffer = await file.arrayBuffer();
  const label = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
  const id = `user-${label.toLowerCase().replace(/[^a-z0-9぀-鿿]+/g, '-')}`;
  if (userFonts.has(id)) return { font: userFonts.get(id), duplicate: true };
  const rec = { id, family: `UserFont ${label}`, label, buffer };
  await registerFace(rec);
  let saved = true;
  try { await idb('readwrite', s => s.put(rec)); } catch { saved = false; }
  return { font: userFonts.get(id), saved };
}

// 電腦已安裝的字型：確認畫得出來就記名稱
export async function addLocalFont(name) {
  const family = name.trim();
  if (!family) return null;
  const probe = 'あ永A';
  const c = document.createElement('canvas').getContext('2d');
  const width = f => { c.font = `40px ${f}`; return c.measureText(probe).width; };
  const differs = ['monospace', 'serif'].some(g => width(`"${family}", ${g}`) !== width(g));
  if (!differs) return null;
  const id = `local-${family.toLowerCase().replace(/\s+/g, '-')}`;
  const rec = { id, family, label: family, local: true };
  userFonts.set(id, { ...rec, cat: 'user', weights: [400, 700], fb: 'noto-sans-tc' });
  try { await idb('readwrite', s => s.put(rec)); } catch { /* 只在這次有效 */ }
  return userFonts.get(id);
}

export async function removeUserFont(id) {
  userFonts.delete(id);
  try { await idb('readwrite', s => s.delete(id)); } catch { /* ignore */ }
}
