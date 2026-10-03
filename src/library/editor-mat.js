// GLB 編輯器的「材質」：讓 AI 生成等外部模型能依陣營換色。
// - 材質清單：色槽（＝材質名稱，遊戲依名稱換色）、粗糙度／金屬感／發光、合併相同的材質
// - 依面指定色槽：框選三角形改用某個色槽的材質（網格依材質分組：重排索引＋groups）
// - 依顏色分群：取每個三角形在貼圖上的顏色做 k-means，各群指定色槽
// - 換色用的貼圖：遊戲換色是「陣營色 × 貼圖」，彩色貼圖會變混濁，所以色槽材質的貼圖轉成灰階（依該群的平均亮度正規化）或移除
// 所有修改都換成新的幾何／材質物件（舊的不改），編輯器的復原只要保留參照；材質參數另外記在快照裡。
import { escHtml } from '../core/html.js';
import { PALETTE_SLOTS, tintMaterial } from '../render/glb.js';
import { PALETTES } from '../render/materials.js';

const $ = (id) => document.getElementById(id);
export const SLOT_NAMES = {
  main: '主色',
  main2: '主色 2',
  main3: '主色 3',
  sub: '副色',
  acc: '強調色',
  joint: '關節',
  visor: '目鏡',
  glow: '發光',
  gun: '槍械',
  grey: '灰色',
};
// 分群後依面積大小建議的色槽
const SUGGEST = ['main', 'sub', 'main2', 'joint', 'acc', 'grey', 'gun', 'main3'];
const TEX_MODES = [
  ['gray', '貼圖轉灰階（保留明暗）'],
  ['keep', '保留彩色貼圖'],
  ['none', '移除貼圖（純色）'],
];
const slotLabel = (s) => (s ? `${SLOT_NAMES[s] || s}（${s}）` : '保留原色');
export const slotOfName = (name) => {
  const n = String(name || '')
    .toLowerCase()
    .replace(/\.\d+$/, '');
  return PALETTE_SLOTS.includes(n) ? n : '';
};
// 色槽材質 → 原材質、原材質 → { 色槽|模式: 色槽材質 }（不放 userData：GLTFExporter 會把 userData 寫進檔案）
const BASE = new WeakMap(),
  SLOTS = new WeakMap();
export const baseOf = (m) => BASE.get(m) || m;
// 材質上的貼圖欄位（快照、貼圖工具共用）
export const TEX_KEYS = ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'];
const matsArr = (o) => (Array.isArray(o.material) ? o.material : [o.material]);
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ---------- 網格的「每個三角形用哪個材質」 ----------
function triCountOf(g) {
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}
export function faceMats(mesh) {
  const g = mesh.geometry;
  const n = Math.floor(triCountOf(g));
  const fm = new Uint16Array(n);
  if (Array.isArray(mesh.material) && g.groups.length)
    for (const gr of g.groups)
      for (let t = Math.floor(gr.start / 3); t < Math.min(n, Math.floor((gr.start + gr.count) / 3)); t++)
        fm[t] = gr.materialIndex || 0;
  return { mats: matsArr(mesh).slice(), fm };
}
// 依每個三角形的材質重排索引並設定 groups；回傳新的幾何（共用頂點屬性）與材質
export function withFaceMats(mesh, mats, fm) {
  const g = mesh.geometry;
  const src = g.index ? g.index.array : null;
  const used = [...new Set(fm)].sort((a, b) => a - b);
  const total = fm.length * 3;
  const idx =
    total > 65535 || g.attributes.position.count > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.morphAttributes = g.morphAttributes;
  let o = 0;
  const newMats = [];
  for (const m of used) {
    const start = o;
    for (let t = 0; t < fm.length; t++) {
      if (fm[t] !== m) continue;
      for (let k = 0; k < 3; k++) idx[o++] = src ? src[t * 3 + k] : t * 3 + k;
    }
    out.addGroup(start, o - start, newMats.length);
    newMats.push(mats[m]);
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.boundingBox = g.boundingBox;
  out.boundingSphere = g.boundingSphere;
  if (newMats.length === 1) out.clearGroups();
  return { geometry: out, material: newMats.length === 1 ? newMats[0] : newMats };
}

// ---------- 取色：貼圖（縮小到 512 內取樣）× 材質顏色 × 頂點色 ----------
const PIX = new WeakMap();
function pixelsOf(tex) {
  const img = tex && tex.image;
  if (!img || !img.width) return null;
  if (PIX.has(img)) return PIX.get(img);
  const s = Math.min(1, 512 / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * s)),
    h = Math.max(1, Math.round(img.height * s));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, w, h);
  const out = { w, h, data: g.getImageData(0, 0, w, h).data };
  PIX.set(img, out);
  return out;
}
// 每個三角形的顏色（sRGB 0～1，三個一組）與面積
export function faceColors(mesh) {
  const g = mesh.geometry;
  const { mats, fm } = faceMats(mesh);
  const n = fm.length;
  const col = new Float32Array(n * 3),
    area = new Float32Array(n);
  const pos = g.attributes.position,
    uv = g.attributes.uv,
    vc = g.attributes.color;
  const idx = g.index ? g.index.array : null;
  const vi = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  const base = mats.map((m) => ({
    px: m.map ? pixelsOf(m.map) : null,
    col: m.color ? m.color.clone().convertLinearToSRGB() : new THREE.Color(1, 1, 1),
  }));
  for (let t = 0; t < n; t++) {
    a.fromBufferAttribute(pos, vi(t, 0));
    b.fromBufferAttribute(pos, vi(t, 1));
    c.fromBufferAttribute(pos, vi(t, 2));
    area[t] = b.sub(a).cross(c.sub(a)).length() / 2;
    const B = base[fm[t]];
    let r = B.col.r,
      gg = B.col.g,
      bb = B.col.b;
    if (B.px && uv) {
      let u = 0,
        v = 0;
      for (let k = 0; k < 3; k++) {
        u += uv.getX(vi(t, k)) / 3;
        v += uv.getY(vi(t, k)) / 3;
      }
      u -= Math.floor(u);
      v -= Math.floor(v);
      const x = Math.min(B.px.w - 1, Math.floor(u * B.px.w)),
        y = Math.min(B.px.h - 1, Math.floor(v * B.px.h));
      const o = (y * B.px.w + x) * 4;
      r *= B.px.data[o] / 255;
      gg *= B.px.data[o + 1] / 255;
      bb *= B.px.data[o + 2] / 255;
    }
    if (vc) {
      let vr = 0,
        vg = 0,
        vb = 0;
      for (let k = 0; k < 3; k++) {
        vr += vc.getX(vi(t, k)) / 3;
        vg += vc.getY(vi(t, k)) / 3;
        vb += vc.getZ(vi(t, k)) / 3;
      }
      r *= vr;
      gg *= vg;
      bb *= vb;
    }
    col[t * 3] = r;
    col[t * 3 + 1] = gg;
    col[t * 3 + 2] = bb;
  }
  return { col, area };
}

// k-means（以面積加權）；初始中心依 k-means++ 的「離已選中心最遠」決定，結果固定不隨機
export function kmeans(points, weights, k, iters = 12) {
  const n = weights.length;
  if (!n) return { centers: [], label: new Uint8Array(0), size: [] };
  const d2 = (i, c) => {
    const x = points[i * 3] - c[0],
      y = points[i * 3 + 1] - c[1],
      z = points[i * 3 + 2] - c[2];
    return x * x + y * y + z * z;
  };
  let first = 0;
  for (let i = 1; i < n; i++) if (weights[i] > weights[first]) first = i;
  const centers = [[points[first * 3], points[first * 3 + 1], points[first * 3 + 2]]];
  const near = new Float32Array(n).fill(Infinity);
  while (centers.length < k) {
    let best = -1,
      bd = -1;
    for (let i = 0; i < n; i++) {
      near[i] = Math.min(near[i], d2(i, centers[centers.length - 1]));
      const s = near[i] * (weights[i] + 1e-9);
      if (s > bd) {
        bd = s;
        best = i;
      }
    }
    if (bd <= 0) break;
    centers.push([points[best * 3], points[best * 3 + 1], points[best * 3 + 2]]);
  }
  const label = new Uint8Array(n);
  for (let it = 0; it < iters; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
      let bi = 0,
        bd = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const d = d2(i, centers[c]);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      label[i] = bi;
      const w = weights[i] + 1e-9;
      acc[bi][0] += points[i * 3] * w;
      acc[bi][1] += points[i * 3 + 1] * w;
      acc[bi][2] += points[i * 3 + 2] * w;
      acc[bi][3] += w;
    }
    centers.forEach((c, i) => {
      if (acc[i][3] > 0) for (let k2 = 0; k2 < 3; k2++) c[k2] = acc[i][k2] / acc[i][3];
    });
  }
  const size = centers.map(() => 0);
  for (let i = 0; i < n; i++) size[label[i]] += weights[i];
  return { centers, label, size };
}

// 灰階貼圖：亮度 × k（讓這一群的平均亮度約 0.85，換色後的顏色才接近陣營色）
// 產生的灰階貼圖 → { src: 原圖, k }（換原圖時依同樣的倍率重算）
const GRAY = new Map(),
  DERIVED = new WeakMap();
export const derivedOf = (t) => (t && DERIVED.get(t)) || null;
export function grayTex(tex, k) {
  const key = tex.uuid + '|' + k.toFixed(2);
  if (GRAY.has(key)) return GRAY.get(key);
  const img = tex.image;
  const s = Math.min(1, 2048 / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * s));
  c.height = Math.max(1, Math.round(img.height * s));
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height);
  const a = d.data;
  for (let i = 0; i < a.length; i += 4) {
    const v = Math.min(255, Math.round(lum(a[i], a[i + 1], a[i + 2]) * k));
    a[i] = a[i + 1] = a[i + 2] = v;
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  for (const p of ['flipY', 'encoding', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy'])
    t[p] = tex[p];
  t.offset.copy(tex.offset);
  t.repeat.copy(tex.repeat);
  t.name = (tex.name || 'tex') + '_gray';
  GRAY.set(key, t);
  DERIVED.set(t, { src: tex, k });
  return t;
}

export class MaterialTool {
  constructor(ed) {
    this.ed = ed;
    this.preview = ''; // 預覽配色（PALETTES 的鍵；空字串＝原色）
    this.tinted = new Map();
    this.boxMode = false;
    this.clusters = null;
    this.shown = []; // 材質清單目前列出的材質（重繪時保留展開狀態）
    this.setupBox();
  }
  reset() {
    this.clusters = null;
    this.tinted.clear();
    this.setBox(false);
  }
  meshes() {
    const out = [];
    if (!this.ed.content) return out;
    this.ed.content.traverse((o) => {
      if (!o.isMesh) return;
      for (let x = o; x && x !== this.ed.content; x = x.parent) if (!x.visible) return;
      out.push(o);
    });
    return out;
  }
  // 顯示中的材質與使用量
  list() {
    const map = new Map();
    for (const o of this.meshes()) {
      const { mats, fm } = faceMats(o);
      const cnt = new Map();
      for (const i of fm) cnt.set(i, (cnt.get(i) || 0) + 1);
      mats.forEach((m, i) => {
        if (!cnt.get(i)) return;
        const e = map.get(m) || { m, meshes: 0, tris: 0 };
        e.meshes++;
        e.tris += cnt.get(i);
        map.set(m, e);
      });
    }
    return [...map.values()];
  }

  // 模型用到的所有材質（含隱藏的節點）＋它們的原材質與已建立的色槽材質（換貼圖時要一起改，之後指定色槽才不會拿到舊圖）
  allMats() {
    const out = new Set();
    if (!this.ed.content) return [];
    this.ed.content.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of matsArr(o)) {
        out.add(m);
        const b = baseOf(m);
        out.add(b);
        const c = SLOTS.get(b);
        if (c) for (const x of Object.values(c)) out.add(x);
      }
    });
    return [...out];
  }

  // ---------- 復原用：材質參數與貼圖 ----------
  snap() {
    return this.allMats().map((m) => [
      m,
      m.name,
      m.color ? m.color.getHex() : null,
      m.roughness,
      m.metalness,
      m.emissive ? m.emissive.getHex() : null,
      m.emissiveIntensity,
      TEX_KEYS.map((k) => (k in m ? m[k] : undefined)),
    ]);
  }
  restore(list) {
    for (const [m, name, col, r, mt, em, ei, maps] of list || []) {
      m.name = name;
      if (col !== null && m.color) m.color.setHex(col);
      if (r !== undefined) m.roughness = r;
      if (mt !== undefined) m.metalness = mt;
      if (em !== null && m.emissive) m.emissive.setHex(em);
      if (ei !== undefined) m.emissiveIntensity = ei;
      if (maps) TEX_KEYS.forEach((k, i) => maps[i] !== undefined && (m[k] = maps[i]));
      m.needsUpdate = true;
    }
    this.tinted.clear();
  }

  // ---------- 色槽材質 ----------
  // base（原材質）的色槽版本：複製並改名；貼圖依模式轉灰階（k 為亮度倍率）或移除
  slotMat(cur, slot, mode, k) {
    const base = baseOf(cur);
    if (!slot) return base;
    const key = `${slot}|${mode}`;
    if (!SLOTS.has(base)) SLOTS.set(base, {});
    const cache = SLOTS.get(base);
    if (cache[key]) return cache[key];
    const m = base.clone();
    m.name = slot;
    BASE.set(m, base);
    if (m.map && mode === 'gray') m.map = grayTex(base.map, k);
    else if (mode === 'none') m.map = null;
    if (mode !== 'keep' && m.color) m.color.setRGB(1, 1, 1); // 原本的顏色交給陣營色
    cache[key] = m;
    return m;
  }
  // sel：Map(網格 → 三角形索引陣列)；slot：色槽（空字串＝保留原色）
  assign(sel, slot) {
    return this.assignMany([[sel, slot]]);
  }
  // 一次套用多組（分群）：每個網格只重排一次索引（重排後三角形的編號會變），記一步復原
  assignMany(jobs) {
    const ed = this.ed;
    const mode = $('edTexMode') ? $('edTexMode').value : 'gray';
    jobs = jobs.filter(([sel]) => sel.size);
    if (!jobs.length) return 0;
    const state = new Map(); // 網格 → { mats, fm, col, area }
    const get = (o) => {
      if (!state.has(o)) state.set(o, { ...faceMats(o), ...faceColors(o) });
      return state.get(o);
    };
    // 亮度正規化：同一組、同一個原材質的三角形的平均亮度
    const lumSum = new Map();
    jobs.forEach(([sel], j) => {
      for (const [o, faces] of sel) {
        const S = get(o);
        for (const t of faces) {
          const key = j + '|' + baseOf(S.mats[S.fm[t]]).uuid;
          const e = lumSum.get(key) || [0, 0];
          e[0] += lum(S.col[t * 3], S.col[t * 3 + 1], S.col[t * 3 + 2]) * S.area[t];
          e[1] += S.area[t];
          lumSum.set(key, e);
        }
      }
    });
    ed.pushUndo();
    let n = 0;
    jobs.forEach(([sel, slot], j) => {
      for (const [o, faces] of sel) {
        const S = get(o);
        const orig = S.fm.slice();
        for (const t of faces) {
          const cur = S.mats[orig[t]];
          const e = lumSum.get(j + '|' + baseOf(cur).uuid) || [0.85, 1];
          const avg = e[1] > 0 ? e[0] / e[1] : 0.85;
          const k = Math.min(4, Math.max(1, 0.85 / Math.max(avg, 0.05)));
          const target = this.slotMat(cur, slot, mode, Math.round(k * 20) / 20);
          let i = S.mats.indexOf(target);
          if (i < 0) i = S.mats.push(target) - 1;
          if (S.fm[t] !== i) n++;
          S.fm[t] = i;
        }
      }
    });
    for (const [o, S] of state) {
      const r = withFaceMats(o, S.mats, S.fm);
      o.geometry = r.geometry;
      o.material = r.material;
    }
    this.tinted.clear();
    ed.changed();
    return n;
  }
  // 整個材質改色槽：所有用它的三角形
  assignMaterial(m, slot) {
    const sel = new Map();
    for (const o of this.meshes()) {
      const { mats, fm } = faceMats(o);
      const i = mats.indexOf(m);
      if (i < 0) continue;
      const faces = [];
      for (let t = 0; t < fm.length; t++) if (fm[t] === i) faces.push(t);
      if (faces.length) sel.set(o, faces);
    }
    this.assign(sel, slot);
  }
  // 合併相同的材質（類型、名稱、顏色、參數、貼圖都相同）
  mergeSame() {
    const ed = this.ed;
    const key = (m) => [
      m.type,
      m.name,
      m.color && m.color.getHex(),
      m.roughness,
      m.metalness,
      m.emissive && m.emissive.getHex(),
      m.emissiveIntensity,
      m.transparent,
      m.opacity,
      m.side,
      m.alphaTest,
      m.vertexColors,
      ...['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'].map((k) =>
        m[k] ? m[k].image || m[k].uuid : null,
      ),
    ];
    const groups = [];
    for (const { m } of this.list()) {
      const k = key(m);
      const g = groups.find((x) => x.k.every((v, i) => v === k[i]));
      if (g) g.list.push(m);
      else groups.push({ k, list: [m] });
    }
    const to = new Map();
    for (const g of groups) for (const m of g.list.slice(1)) to.set(m, g.list[0]);
    if (!to.size) return ed.toast('沒有可以合併的相同材質', true);
    ed.pushUndo();
    for (const o of this.meshes()) {
      if (!matsArr(o).some((m) => to.has(m))) continue;
      const { mats, fm } = faceMats(o);
      const uniq = [];
      const remap = mats.map((m) => {
        const t = to.get(m) || m;
        let i = uniq.indexOf(t);
        if (i < 0) i = uniq.push(t) - 1;
        return i;
      });
      for (let t = 0; t < fm.length; t++) fm[t] = remap[fm[t]];
      const r = withFaceMats(o, uniq, fm);
      o.geometry = r.geometry;
      o.material = r.material;
    }
    this.tinted.clear();
    ed.changed();
    ed.toast(`已合併 ${to.size} 個重複的材質`);
  }
  setParam(m, k, v) {
    this.ed.pushUndo('mat|' + m.uuid + k);
    if (k === 'color' || k === 'emissive') m[k].set(v);
    else m[k] = v;
    m.needsUpdate = true;
    this.tinted.clear();
    this.ed.changed();
  }

  // ---------- 依顏色分群 ----------
  cluster(k) {
    const ms = this.meshes();
    const parts = ms.map((o) => ({ o, geo: o.geometry, ...faceColors(o) }));
    const n = parts.reduce((a, p) => a + p.area.length, 0);
    if (!n) return this.ed.toast('沒有可見的網格', true);
    const pts = new Float32Array(n * 3),
      w = new Float32Array(n);
    let o = 0;
    for (const p of parts) {
      pts.set(p.col, o * 3);
      w.set(p.area, o);
      o += p.area.length;
    }
    const res = kmeans(pts, w, Math.max(2, Math.min(8, k)));
    const order = res.centers.map((c, i) => i).sort((a, b) => res.size[b] - res.size[a]);
    const total = res.size.reduce((a, b) => a + b, 0) || 1;
    const counts = res.centers.map(() => 0);
    for (const l of res.label) counts[l]++;
    this.clusters = {
      parts,
      label: res.label,
      list: order.map((i, rank) => ({
        i,
        color: new THREE.Color(res.centers[i][0], res.centers[i][1], res.centers[i][2]),
        share: res.size[i] / total,
        tris: counts[i],
        slot: SUGGEST[rank] || '',
      })),
    };
    this.render();
  }
  applyClusters() {
    const C = this.clusters;
    if (!C) return;
    if (C.parts.some((p) => p.o.geometry !== p.geo)) {
      this.clusters = null;
      this.render();
      return this.ed.toast('分群之後模型有變動，請重新分群', true);
    }
    const bySlot = new Map();
    let o = 0;
    for (const p of C.parts) {
      for (let t = 0; t < p.area.length; t++) {
        const c = C.list.find((x) => x.i === C.label[o + t]);
        if (!c.slot) continue;
        if (!bySlot.has(c.slot)) bySlot.set(c.slot, new Map());
        const m = bySlot.get(c.slot);
        if (!m.has(p.o)) m.set(p.o, []);
        m.get(p.o).push(t);
      }
      o += p.area.length;
    }
    this.assignMany([...bySlot].map(([slot, sel]) => [sel, slot]));
    this.clusters = null;
    this.render();
    this.ed.toast('已依顏色分群指定色槽');
  }

  // ---------- 框選三角形 ----------
  setupBox() {
    const ed = this.ed;
    const el = document.createElement('div');
    el.className = 'edBoxSel';
    el.hidden = true;
    $('edView').appendChild(el);
    let start = null;
    const rel = (e) => {
      const r = ed.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, r];
    };
    ed.canvas.addEventListener('pointerdown', (e) => {
      if (!this.boxMode) return;
      start = rel(e);
      el.hidden = false;
      Object.assign(el.style, { left: start[0] + 'px', top: start[1] + 'px', width: '0px', height: '0px' });
    });
    addEventListener('pointermove', (e) => {
      if (!start) return;
      const [x, y] = rel(e);
      Object.assign(el.style, {
        left: Math.min(x, start[0]) + 'px',
        top: Math.min(y, start[1]) + 'px',
        width: Math.abs(x - start[0]) + 'px',
        height: Math.abs(y - start[1]) + 'px',
      });
    });
    addEventListener('pointerup', (e) => {
      if (!start) return;
      const [x, y, r] = rel(e);
      const s = start;
      start = null;
      el.hidden = true;
      if (Math.abs(x - s[0]) < 3 && Math.abs(y - s[1]) < 3) return;
      const nx = (v) => (v / r.width) * 2 - 1,
        ny = (v) => -((v / r.height) * 2 - 1);
      this.boxAssign(
        Math.min(nx(x), nx(s[0])),
        Math.max(nx(x), nx(s[0])),
        Math.min(ny(y), ny(s[1])),
        Math.max(ny(y), ny(s[1])),
      );
    });
  }
  setBox(on) {
    if (on && this.ed.faces) this.ed.faces.setOn(false);
    this.boxMode = on;
    this.ed.controls.enabled = !on;
    if ($('edMatBox')) $('edMatBox').classList.toggle('sel', on);
  }
  boxAssign(x0, x1, y0, y1) {
    const ed = this.ed;
    const front = $('edMatFront') && $('edMatFront').checked;
    const slot = $('edMatSlot') ? $('edMatSlot').value : '';
    const cam = ed.camera.position;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3(),
      p = new THREE.Vector3(),
      n = new THREE.Vector3();
    const sel = new Map();
    ed.scene.updateMatrixWorld(true);
    for (const o of this.meshes()) {
      const g = o.geometry,
        pos = g.attributes.position,
        idx = g.index ? g.index.array : null;
      const N = Math.floor(triCountOf(g));
      const faces = [];
      for (let t = 0; t < N; t++) {
        const vi = (k) => (idx ? idx[t * 3 + k] : t * 3 + k);
        a.fromBufferAttribute(pos, vi(0)).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(pos, vi(1)).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(pos, vi(2)).applyMatrix4(o.matrixWorld);
        p.copy(a).add(b).add(c).divideScalar(3);
        if (front) {
          n.subVectors(b, a).cross(c.clone().sub(a));
          if (n.dot(c.copy(cam).sub(p)) <= 0) continue;
        }
        p.project(ed.camera);
        if (p.z > 1 || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        faces.push(t);
      }
      if (faces.length) sel.set(o, faces);
    }
    const n2 = this.assign(sel, slot);
    ed.toast(
      n2 ? `已把 ${n2.toLocaleString()} 個三角形改成「${slotLabel(slot)}」` : '框內沒有要改的三角形',
      !n2,
    );
  }

  // ---------- 預覽配色：繪製前換成換色後的材質，繪製後換回 ----------
  beforeRender() {
    const pal = this.preview && PALETTES[this.preview];
    if (!pal || !this.ed.content) return null;
    const swapped = [];
    const tint = (m) => {
      if (!this.tinted.has(m)) this.tinted.set(m, tintMaterial(m, pal));
      return this.tinted.get(m);
    };
    for (const o of this.meshes()) {
      swapped.push([o, o.material]);
      o.material = Array.isArray(o.material) ? o.material.map(tint) : tint(o.material);
    }
    return swapped;
  }
  afterRender(swapped) {
    if (swapped) for (const [o, m] of swapped) o.material = m;
  }

  // ---------- 介面 ----------
  render() {
    const box = $('edMats');
    if (!box) return;
    const ed = this.ed;
    if (!ed.content) {
      box.innerHTML = '';
      $('edMatTools').hidden = true;
      return;
    }
    $('edMatTools').hidden = false;
    const list = this.list();
    const opened = new Set([...box.querySelectorAll('.edMat[open]')].map((d) => this.shown[+d.dataset.i]));
    this.shown = list.map((x) => x.m);
    const opts = (cur) =>
      ['', ...PALETTE_SLOTS]
        .map((s) => `<option value="${s}"${s === cur ? ' selected' : ''}>${escHtml(slotLabel(s))}</option>`)
        .join('');
    box.innerHTML =
      list
        .map(({ m, tris }, i) => {
          const col = m.color ? '#' + m.color.clone().convertLinearToSRGB().getHexString() : '#888';
          const slot = slotOfName(m.name);
          return (
            `<details class="edMat" data-i="${i}"${opened.has(m) ? ' open' : ''}><summary><i style="background:${col}"></i>` +
            `<span class="nm" title="${escHtml(m.name || '')}">${escHtml(m.name || '（未命名）')}${m.map ? '・貼圖' : ''}</span>` +
            `<span class="dim small">${tris.toLocaleString()}</span></summary>` +
            `<label>色槽 <select data-act="slot">${opts(slot)}</select></label>` +
            (m.roughness !== undefined
              ? `<label>粗糙度 <input type="range" min="0" max="1" step="0.05" data-act="roughness" value="${m.roughness}"></label>` +
                `<label>金屬感 <input type="range" min="0" max="1" step="0.05" data-act="metalness" value="${m.metalness}"></label>`
              : '') +
            (m.emissive
              ? `<label>發光 <input type="color" data-act="emissive" value="#${m.emissive.getHexString()}">` +
                `<input type="range" min="0" max="3" step="0.1" data-act="emissiveIntensity" value="${m.emissiveIntensity}"></label>`
              : '') +
            (m.color && !slot
              ? `<label>顏色 <input type="color" data-act="color" value="${col}"></label>`
              : '') +
            ed.tex.html(m) +
            `</details>`
          );
        })
        .join('') + `<div class="dim small">共 ${list.length} 個材質</div>`;
    for (const d of box.querySelectorAll('.edMat')) {
      const m = list[+d.dataset.i].m;
      for (const inp of d.querySelectorAll('[data-act]')) {
        const k = inp.dataset.act;
        inp.onchange = () => {
          if (k === 'slot') return this.assignMaterial(m, inp.value);
          if (k === 'color') return this.setParam(m, k, new THREE.Color(inp.value).convertSRGBToLinear());
          if (k === 'emissive') return this.setParam(m, k, new THREE.Color(inp.value));
          this.setParam(m, k, parseFloat(inp.value));
        };
      }
      ed.tex.bind(d, m);
    }
    // 分群結果
    const C = this.clusters;
    $('edClusters').innerHTML = C
      ? C.list
          .map(
            (c, i) =>
              `<div class="edCl"><i style="background:#${c.color.getHexString()}"></i>` +
              `<span class="small">${Math.round(c.share * 100)}%・${c.tris.toLocaleString()} 面</span>` +
              `<select data-c="${i}">${opts(c.slot)}</select></div>`,
          )
          .join('') + `<div class="btns"><button id="edClApply" class="primary">套用分群</button></div>`
      : '';
    if (C) {
      for (const s of $('edClusters').querySelectorAll('select'))
        s.onchange = () => (C.list[+s.dataset.c].slot = s.value);
      $('edClApply').onclick = () => this.applyClusters();
    }
  }
  setupUi() {
    $('edPreview').innerHTML =
      `<option value="">原色</option>` +
      Object.keys(PALETTES)
        .map((k) => `<option>${k}</option>`)
        .join('');
    $('edPreview').onchange = () => {
      this.preview = $('edPreview').value;
      this.tinted.clear();
    };
    $('edMatSlot').innerHTML =
      PALETTE_SLOTS.map((s) => `<option value="${s}">${escHtml(slotLabel(s))}</option>`).join('') +
      `<option value="">保留原色</option>`;
    $('edTexMode').innerHTML = TEX_MODES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('');
    $('edMatBox').onclick = () => this.setBox(!this.boxMode);
    $('edMergeMats').onclick = () => this.mergeSame();
    $('edCluster').onclick = () => this.cluster(parseInt($('edClusterK').value, 10) || 5);
  }
}
