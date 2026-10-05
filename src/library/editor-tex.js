// GLB 編輯器的「貼圖」：列出每個材質的貼圖（同一張貼圖的欄位合成一列）、下載（目前畫面用的圖／GLB 裡的原始檔）、
// UV 線框、全部打包成 zip、替換圖片（這張貼圖用到的所有材質，或只換這個材質；粗糙度／金屬感／AO 可只換單一通道；
// 換原圖時由它產生的灰階圖依原倍率重算）、為沒有貼圖的材質加入貼圖。
// 貼圖物件一律換成新的（舊的不改），復原靠材質快照裡的貼圖參照（editor-mat.js 的 snap）。
import { escHtml } from '../core/html.js';
import { TEX_KEYS, derivedOf, faceMats, grayTex, slotOfName } from './editor-mat.js';
import { readGlb } from './editor-opt.js';
import { makeZip } from './zip.js';

const $ = (id) => document.getElementById(id);
const KIND = {
  map: '顏色',
  emissiveMap: '發光',
  normalMap: '法線',
  roughnessMap: '粗糙度',
  metalnessMap: '金屬感',
  aoMap: 'AO',
};
const FILE_KEY = {
  map: 'color',
  emissiveMap: 'emissive',
  normalMap: 'normal',
  roughnessMap: 'rough',
  metalnessMap: 'metal',
  aoMap: 'ao',
};
const SRGB = new Set(['map', 'emissiveMap']); // 其他種類是數值資料（線性）
const ADD = [
  ['map', '顏色'],
  ['emissiveMap', '發光'],
  ['normalMap', '法線'],
  ['rm', '粗糙度＋金屬感（G／B 已打包）'],
  ['rough', '粗糙度（灰階圖）'],
  ['metal', '金屬感（灰階圖）'],
  ['aoMap', 'AO（環境光遮蔽）'],
];
const CH = { r: 0, g: 1, b: 2 };
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const UV_COLORS = ['#ffd23f', '#5cc8ff', '#ff6b6b', '#7dff8a', '#c78bff', '#ff9f43', '#4dd0c8', '#ff7ad9'];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const safe = (s) =>
  String(s || '')
    .replace(/[\\/:*?"<>|\s]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tex';
const matsArr = (o) => (Array.isArray(o.material) ? o.material : [o.material]);

// 貼圖 → 原始檔 { bytes, mime }：GLB 裡的圖片，或使用者換上的圖片檔
const ORIG = new WeakMap();
export function registerOriginals(gltf, buf) {
  const assoc = gltf && gltf.parser && gltf.parser.associations;
  if (!assoc) return;
  let json, bin;
  try {
    const ab =
      buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    ({ json, bin } = readGlb(ab));
  } catch (e) {
    return;
  }
  for (const [obj, ref] of assoc) {
    if (!obj || !obj.isTexture || !ref || ref.type !== 'textures') continue;
    const td = (json.textures || [])[ref.index];
    if (!td) continue;
    const ext = td.extensions || {};
    const si = ext.EXT_texture_webp ? ext.EXT_texture_webp.source : td.source;
    const img = (json.images || [])[si];
    if (!img || img.bufferView === undefined) continue;
    const bv = json.bufferViews[img.bufferView];
    const o = bv.byteOffset || 0;
    ORIG.set(obj, { bytes: bin.slice(o, o + bv.byteLength), mime: img.mimeType || 'image/png' });
  }
}

// ---------- 圖片工具 ----------
function canvasOf(img, w, h) {
  const c = document.createElement('canvas');
  c.width = w || img.width;
  c.height = h || img.height;
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const small = (img, max) => {
  const s = Math.min(1, max / Math.max(img.width, img.height));
  return canvasOf(img, Math.max(1, Math.round(img.width * s)), Math.max(1, Math.round(img.height * s)));
};
const pixels = (c) => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));
const blobBytes = async (b) => new Uint8Array(await b.arrayBuffer());
function hasAlpha(img) {
  const a = pixels(small(img, 256));
  for (let i = 3; i < a.length; i += 4) if (a[i] < 255) return true;
  return false;
}
// 平均彩度（0～1）：判斷是不是彩色圖
function chroma(img) {
  const a = pixels(small(img, 64));
  let s = 0,
    n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] < 16) continue;
    s += (Math.max(a[i], a[i + 1], a[i + 2]) - Math.min(a[i], a[i + 1], a[i + 2])) / 255;
    n++;
  }
  return n ? s / n : 0;
}
function save(data, name, type = 'application/octet-stream') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function readImage(file) {
  const mime = EXT[file.type] ? file.type : BY_EXT[(file.name.split('.').pop() || '').toLowerCase()];
  if (!mime) throw new Error('只接受 PNG、JPG、WebP 圖片');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { premultiplyAlpha: 'none' });
  } catch (e) {
    throw new Error(`無法讀取圖片 ${file.name}`);
  }
  return { bmp, bytes, mime, name: file.name.replace(/\.\w+$/, '') };
}
// 新貼圖：沿用 like 的翻轉、色彩空間、重複、過濾與貼圖變換；沒有 like 時用 GLB 的慣例（不翻轉）
function makeTex(img, like, key, name) {
  const t = new THREE.CanvasTexture(img);
  if (like) {
    for (const p of ['flipY', 'encoding', 'wrapS', 'wrapT', 'magFilter', 'minFilter', 'anisotropy'])
      t[p] = like[p];
    t.offset.copy(like.offset);
    t.repeat.copy(like.repeat);
    t.center.copy(like.center);
    t.rotation = like.rotation;
  } else {
    t.flipY = false;
    t.encoding = SRGB.has(key) ? THREE.sRGBEncoding : THREE.LinearEncoding;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
  }
  // 輸出器依格式決定存 PNG（RGBA）或 JPEG（RGB）：有透明的一定要 RGBA，否則透明會不見
  t.format = hasAlpha(img) ? THREE.RGBAFormat : THREE.RGBFormat;
  t.name = name || '';
  return t;
}
// 把 src 的亮度寫進一個通道：底圖是 base（縮放 src 配合它的尺寸），沒有底圖時用 fill（[r,g,b]）、尺寸取 src
function packChannel(base, src, ch, fill) {
  const w = base ? base.width : src.width,
    h = base ? base.height : src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (base) g.drawImage(base, 0, 0, w, h);
  else {
    g.fillStyle = `rgb(${fill.join(',')})`;
    g.fillRect(0, 0, w, h);
  }
  const d = g.getImageData(0, 0, w, h);
  const s = pixels(canvasOf(src, w, h));
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i + ch] = Math.round(lum(s[i], s[i + 1], s[i + 2]));
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  return c;
}
// 共用頂點屬性、加上 uv2（three r128 的 AO 貼圖用第二組貼圖座標）的新幾何
function withUv2(g) {
  const out = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) out.setAttribute(k, a);
  out.setAttribute('uv2', g.attributes.uv);
  out.morphAttributes = g.morphAttributes;
  out.setIndex(g.index);
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.boundingBox = g.boundingBox;
  out.boundingSphere = g.boundingSphere;
  return out;
}

export class TextureTool {
  constructor(ed) {
    this.ed = ed;
    this.pending = null; // 等選圖片的動作
    this.thumbs = new WeakMap();
  }
  get mat() {
    return this.ed.mat;
  }
  setupUi() {
    const f = document.createElement('input');
    f.type = 'file';
    f.id = 'edTexFile';
    f.accept = 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp';
    f.hidden = true;
    document.body.appendChild(f);
    f.onchange = async () => {
      const file = f.files[0];
      f.value = '';
      const job = this.pending;
      this.pending = null;
      if (file && job) await this.runJob(job, file);
    };
    this.file = f;
    $('edTexZip').onclick = () => this.downloadAll();
  }

  // ---------- 查詢 ----------
  // 用到貼圖 t 的（材質, 欄位）：直接使用的，與用它產生的灰階圖的
  users(t) {
    const direct = [],
      gray = [];
    for (const m of this.mat.allMats())
      for (const k of TEX_KEYS) {
        const x = m[k];
        if (!x) continue;
        if (x === t) direct.push({ m, k });
        else {
          const d = derivedOf(x);
          if (d && d.src === t) gray.push({ m, k, d });
        }
      }
    return { direct, gray };
  }
  // 材質 m 的貼圖：同一張貼圖的欄位合成一列
  rowsOf(m) {
    const rows = [];
    for (const k of TEX_KEYS) {
      const t = m[k];
      if (!t || !t.image || !t.image.width) continue;
      const r = rows.find((x) => x.t === t);
      if (r) r.keys.push(k);
      else rows.push({ t, keys: [k] });
    }
    return rows;
  }
  label(keys) {
    const rm = keys.includes('roughnessMap') && keys.includes('metalnessMap');
    return keys
      .filter((k) => !rm || k !== 'metalnessMap')
      .map((k) => (rm && k === 'roughnessMap' ? '粗糙度／金屬感' : KIND[k]))
      .join('／');
  }
  // 和貼圖 t 共用貼圖座標的材質（直接使用、灰階版本；灰階圖則連同它的原圖）
  matsOf(t) {
    const out = new Set();
    const add = (x) => {
      const u = this.users(x);
      for (const e of [...u.direct, ...u.gray]) out.add(e.m);
    };
    add(t);
    const d = derivedOf(t);
    if (d) add(d.src);
    return [...out];
  }
  meshesOf(m) {
    const out = [];
    if (this.ed.content) this.ed.content.traverse((o) => o.isMesh && matsArr(o).includes(m) && out.push(o));
    return out;
  }
  baseName() {
    const e = this.ed.entry;
    return safe(e ? e.id.replace(/\//g, '_') : (this.ed.fileName || 'model').replace(/\.glb$/i, ''));
  }
  texName(t) {
    const d = derivedOf(t);
    const { direct, gray } = this.users(d ? d.src : t);
    const all = d ? direct.concat(gray) : direct.length ? direct : gray;
    const keys = [...new Set(all.map((u) => u.k))].sort((a, b) => TEX_KEYS.indexOf(a) - TEX_KEYS.indexOf(b));
    const m = all.length ? all[0].m : null;
    const who = t.name && !d ? t.name : m ? m.name : 'tex';
    return `${this.baseName()}_${safe(who)}_${keys.map((k) => FILE_KEY[k]).join('-') || 'tex'}${d ? '_gray' : ''}`;
  }
  thumb(t) {
    if (!this.thumbs.has(t)) this.thumbs.set(t, canvasOf(t.image, 40, 40).toDataURL());
    return this.thumbs.get(t);
  }
  async pngOf(t) {
    return blobBytes(await toBlob(canvasOf(t.image)));
  }

  // ---------- 介面（嵌在材質清單的每個材質裡）----------
  html(m) {
    const rows = this.rowsOf(m);
    const shown = new Set(this.mat.list().map((e) => e.m));
    const out = rows.map((r, i) => {
      const u = this.users(r.t);
      const n = new Set([...u.direct, ...u.gray].map((x) => x.m).filter((x) => shown.has(x))).size;
      const d = derivedOf(r.t);
      const info = [
        `${r.t.image.width}×${r.t.image.height}`,
        n > 1 ? `${n} 個材質共用` : '',
        d ? '灰階（由原圖產生）' : '',
      ]
        .filter(Boolean)
        .join('・');
      const rep = [['all', '整張圖片…']];
      if (r.keys.includes('aoMap') && r.keys.length > 1) rep.push(['r', '只換 AO（R 通道）…']);
      if (r.keys.includes('roughnessMap')) rep.push(['g', '只換粗糙度（G 通道）…']);
      if (r.keys.includes('metalnessMap')) rep.push(['b', '只換金屬感（B 通道）…']);
      if (d) rep.push(['src', '換原圖（重算灰階）…']);
      const orig = ORIG.has(r.t);
      return (
        `<div class="edTex" data-r="${i}" title="可以把圖片拖到這裡替換"><img src="${this.thumb(r.t)}" alt="">` +
        `<div class="edTexI"><div><b>${escHtml(this.label(r.keys))}</b> <span class="dim small">${escHtml(info)}</span></div>` +
        `<div class="edTexB"><button class="mini" data-ta="dl" title="下載目前畫面上用的圖（PNG）">下載</button>` +
        `<button class="mini" data-ta="orig" title="${orig ? '下載原始檔（GLB 裡的原本格式與畫質，或換上的圖片檔）' : '這張圖是編輯器產生的，沒有原始檔'}"${orig ? '' : ' disabled'}>原檔</button>` +
        `<button class="mini" data-ta="uv" title="下載 UV 線框（與貼圖同尺寸）">UV</button>` +
        `<select data-ta="rep"><option value="">替換…</option>${rep.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>` +
        `<button class="mini" data-ta="rm" title="移除這張貼圖">✕</button></div></div></div>`
      );
    });
    const has = new Set(rows.flatMap((r) => r.keys));
    const rmFree = 'roughnessMap' in m && !has.has('roughnessMap') && !has.has('metalnessMap');
    const add = ADD.filter(([k]) => (['rm', 'rough', 'metal'].includes(k) ? rmFree : k in m && !has.has(k)));
    return (
      `<div class="edTexs">` +
      out.join('') +
      `<div class="edTexAdd">` +
      (add.length
        ? `<select data-ta="add"><option value="">加入貼圖…</option>${add.map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select>`
        : '') +
      `<button class="mini" data-ta="uvm" title="下載這個材質的 UV 線框">UV 線框</button></div></div>`
    );
  }
  bind(el, m) {
    const rows = this.rowsOf(m);
    for (const row of el.querySelectorAll('.edTex')) {
      const r = rows[+row.dataset.r];
      for (const b of row.querySelectorAll('[data-ta]')) {
        const a = b.dataset.ta;
        if (a === 'rep')
          b.onchange = () => {
            const v = b.value;
            b.value = '';
            if (v) this.pick({ type: 'rep', m, r, ch: v });
          };
        else b.onclick = () => this.act(a, m, r);
      }
      row.ondragover = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      row.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const f = e.dataTransfer && e.dataTransfer.files[0];
        if (f) this.runJob({ type: 'rep', m, r, ch: 'all' }, f);
      };
    }
    const add = el.querySelector('[data-ta="add"]');
    if (add)
      add.onchange = () => {
        const v = add.value;
        add.value = '';
        if (v) this.pick({ type: 'add', m, kind: v });
      };
    el.querySelector('[data-ta="uvm"]').onclick = () => this.downloadUv(m.map || null, [m]);
  }
  pick(job) {
    this.pending = job;
    this.file.click();
  }
  async act(a, m, r) {
    if (a === 'dl') return save(await this.pngOf(r.t), this.texName(r.t) + '.png', 'image/png');
    if (a === 'orig') {
      const o = ORIG.get(r.t);
      if (o) save(o.bytes, `${this.texName(r.t)}.${EXT[o.mime] || 'bin'}`, o.mime);
      return;
    }
    if (a === 'uv') return this.downloadUv(r.t, this.matsOf(r.t));
    if (a === 'rm') return this.remove(m, r);
  }

  // ---------- UV 線框 ----------
  // mats 的三角形畫在貼圖座標上：有貼圖 t 時用它的尺寸、翻轉與貼圖變換（可疊在貼圖上），否則 1024×1024
  uvCanvas(t, mats) {
    const img = t && t.image;
    const W = img ? img.width : 1024,
      H = img ? img.height : 1024;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (img && $('edUvOver').checked) {
      g.drawImage(img, 0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fillRect(0, 0, W, H);
    }
    const mt = new THREE.Matrix3();
    if (t) {
      t.updateMatrix();
      mt.copy(t.matrix);
    }
    const flip = t ? t.flipY : false;
    const onlyAo = t && this.users(t).direct.every((u) => u.k === 'aoMap');
    const paths = mats.map(() => new Path2D());
    const v = new THREE.Vector3();
    for (const o of this.mat.meshes()) {
      const geo = o.geometry;
      const uv = (onlyAo && geo.attributes.uv2) || geo.attributes.uv;
      if (!uv) continue;
      const { mats: ms, fm } = faceMats(o);
      const ci = ms.map((x) => mats.indexOf(x));
      if (ci.every((x) => x < 0)) continue;
      const idx = geo.index ? geo.index.array : null;
      const p = [0, 0, 0, 0, 0, 0];
      for (let tr = 0; tr < fm.length; tr++) {
        const path = paths[ci[fm[tr]]];
        if (!path) continue;
        let su = 0,
          sv = 0;
        for (let k = 0; k < 3; k++) {
          const i = idx ? idx[tr * 3 + k] : tr * 3 + k;
          v.set(uv.getX(i), uv.getY(i), 1).applyMatrix3(mt);
          p[k * 2] = v.x;
          p[k * 2 + 1] = v.y;
          su += v.x / 3;
          sv += v.y / 3;
        }
        // 重複貼圖（UV 超出 0～1）時整個三角形移回貼圖範圍內
        const fu = Math.floor(su),
          fv = Math.floor(sv);
        for (let k = 0; k < 3; k++) {
          const x = (p[k * 2] - fu) * W,
            y = (flip ? 1 - (p[k * 2 + 1] - fv) : p[k * 2 + 1] - fv) * H;
          if (k) path.lineTo(x, y);
          else path.moveTo(x, y);
        }
        path.closePath();
      }
    }
    g.lineWidth = Math.max(1, Math.round(Math.max(W, H) / 1024));
    g.lineJoin = 'round';
    paths.forEach((path, i) => {
      g.strokeStyle = UV_COLORS[i % UV_COLORS.length];
      g.stroke(path);
    });
    return c;
  }
  async downloadUv(t, mats) {
    if (!mats.length) return;
    const name = t ? this.texName(t) : `${this.baseName()}_${safe(mats[0].name)}`;
    save(await toBlob(this.uvCanvas(t, mats)), name + '_uv.png', 'image/png');
  }

  // ---------- 全部下載（zip）----------
  async downloadAll() {
    const ts = [];
    for (const { m } of this.mat.list()) for (const r of this.rowsOf(m)) if (!ts.includes(r.t)) ts.push(r.t);
    if (!ts.length) return this.ed.toast('目前的模型沒有貼圖', true);
    const withOrig = $('edZipOrig').checked,
      withUv = $('edZipUv').checked;
    const files = [],
      used = new Set();
    const uniq = (n) => {
      let x = n;
      for (let i = 2; used.has(x); i++) x = n.replace(/(\.\w+)$/, `_${i}$1`);
      used.add(x);
      return x;
    };
    for (const t of ts) {
      const n = this.texName(t);
      files.push({ name: uniq(`貼圖/${n}.png`), data: await this.pngOf(t) });
      const o = ORIG.get(t);
      if (withOrig && o) files.push({ name: uniq(`原始檔/${n}.${EXT[o.mime] || 'bin'}`), data: o.bytes });
      if (withUv)
        files.push({
          name: uniq(`UV/${n}_uv.png`),
          data: await blobBytes(await toBlob(this.uvCanvas(t, this.matsOf(t)))),
        });
    }
    save(makeZip(files), `${this.baseName()}_textures.zip`);
    this.ed.toast(`已打包 ${ts.length} 張貼圖（${files.length} 個檔案）`);
  }

  // ---------- 修改 ----------
  // 要改的（材質, 欄位）：scope 'tex' 是所有用到這張貼圖的地方，'mat' 只有材質 m
  targets(m, t, scope) {
    if (scope === 'mat') return TEX_KEYS.filter((k) => m[k] === t).map((k) => ({ m, k }));
    return this.users(t).direct;
  }
  done(msg, warn) {
    this.mat.tinted.clear();
    this.ed.changed();
    this.ed.toast(msg, warn);
  }
  async runJob(job, file) {
    let src;
    try {
      src = await readImage(file);
    } catch (e) {
      return this.ed.toast(e.message || String(e), true);
    }
    if (job.type === 'add') return this.add(job.m, job.kind, src);
    if (!TEX_KEYS.some((k) => job.m[k] === job.r.t))
      return this.ed.toast('這張貼圖已經換掉了，請重新操作', true);
    return this.replace(job.m, job.r, job.ch, src);
  }
  // 灰階倍率：材質 m 的三角形在圖上的面積加權平均亮度調到約 0.85（與「依顏色分群」的灰階相同）
  grayK(img, m, flipY) {
    const c = small(img, 512);
    const px = pixels(c);
    let s = 0,
      w = 0;
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      d = new THREE.Vector3();
    for (const o of this.meshesOf(m)) {
      const geo = o.geometry,
        uv = geo.attributes.uv,
        pos = geo.attributes.position;
      if (!uv) continue;
      const { mats, fm } = faceMats(o);
      const idx = geo.index ? geo.index.array : null;
      for (let t = 0; t < fm.length; t++) {
        if (mats[fm[t]] !== m) continue;
        const vi = (k) => (idx ? idx[t * 3 + k] : t * 3 + k);
        a.fromBufferAttribute(pos, vi(0));
        b.fromBufferAttribute(pos, vi(1)).sub(a);
        d.fromBufferAttribute(pos, vi(2)).sub(a);
        const area = b.cross(d).length() / 2;
        let u = 0,
          v = 0;
        for (let k = 0; k < 3; k++) {
          u += uv.getX(vi(k)) / 3;
          v += uv.getY(vi(k)) / 3;
        }
        u -= Math.floor(u);
        v -= Math.floor(v);
        if (flipY) v = 1 - v;
        const o4 =
          (Math.min(c.height - 1, Math.floor(v * c.height)) * c.width +
            Math.min(c.width - 1, Math.floor(u * c.width))) *
          4;
        s += (lum(px[o4], px[o4 + 1], px[o4 + 2]) / 255) * area;
        w += area;
      }
    }
    const avg = w > 0 ? s / w : 0.85;
    return Math.round(Math.min(4, Math.max(1, 0.85 / Math.max(avg, 0.05))) * 20) / 20;
  }
  // 把 old 換成 nt；regray 時由 old 產生的灰階圖改用 nt 依原倍率重算（只在 scope 'tex'）
  apply(old, nt, m, scope, regray) {
    const pairs = this.targets(m, old, scope);
    const grays = scope === 'tex' && regray ? this.users(old).gray : [];
    if (!pairs.length && !grays.length) return 0;
    this.ed.pushUndo();
    for (const { m: x, k } of pairs) {
      x[k] = nt;
      x.needsUpdate = true;
    }
    for (const { m: x, k, d } of grays) {
      x[k] = grayTex(nt, d.k);
      x.needsUpdate = true;
    }
    return pairs.length + grays.length;
  }
  replace(m, r, ch, src) {
    const scope = $('edTexScope').value;
    const warns = [];
    let old = r.t,
      regray = true;
    if (ch === 'src') {
      // 換灰階圖的原圖：所有用到原圖的地方一起換，灰階版本重算
      old = derivedOf(r.t).src;
      const nt = makeTex(src.bmp, old, 'map', src.name);
      ORIG.set(nt, { bytes: src.bytes, mime: src.mime });
      this.sizeWarns(old, src.bmp, warns);
      const n = this.apply(old, nt, m, 'tex', true);
      return this.done(
        `已換原圖並重算灰階（${n} 處）${warns.length ? '：' + warns.join('；') : ''}`,
        !!warns.length,
      );
    }
    let nt;
    if (ch === 'all') {
      nt = makeTex(src.bmp, old, r.keys[0], src.name);
      ORIG.set(nt, { bytes: src.bytes, mime: src.mime });
      this.sizeWarns(old, src.bmp, warns);
      // 色槽材質的顏色貼圖：遊戲是「陣營色 × 貼圖」
      if (r.keys.includes('map') && slotOfName(m.name)) {
        if ($('edTexGray').checked) {
          const d = derivedOf(old);
          nt = grayTex(nt, d ? d.k : this.grayK(src.bmp, m, old.flipY));
          regray = false;
        } else if (chroma(src.bmp) > 0.12)
          warns.push('色槽材質會乘上陣營色，彩色貼圖會變混濁（可勾選「色槽材質換圖時轉灰階」）');
      }
    } else {
      // 只換一個通道：新圖的亮度寫進原圖的 R／G／B（縮放到原圖尺寸）
      if (src.bmp.width !== old.image.width || src.bmp.height !== old.image.height)
        warns.push(`新圖已縮放到原圖尺寸 ${old.image.width}×${old.image.height}`);
      nt = makeTex(packChannel(old.image, src.bmp, CH[ch]), old, r.keys[0], old.name);
    }
    const n = this.apply(old, nt, m, scope, regray);
    const what = { all: '貼圖', r: 'AO（R 通道）', g: '粗糙度（G 通道）', b: '金屬感（B 通道）' }[ch];
    this.done(
      `已替換${what}（${scope === 'mat' ? '只有這個材質' : `${n} 處`}）${warns.length ? '：' + warns.join('；') : ''}`,
      !!warns.length,
    );
  }
  sizeWarns(old, img, warns) {
    const a0 = old.image.width / old.image.height,
      a1 = img.width / img.height;
    if (Math.abs(a1 - a0) / a0 > 0.01)
      warns.push(
        `長寬比和原圖不同（${old.image.width}×${old.image.height} → ${img.width}×${img.height}），貼圖會變形`,
      );
    this.budgetWarn(img, warns);
  }
  budgetWarn(img, warns) {
    const max = this.ed.exportOptsFor(this.ed.entry ? this.ed.entry.spec : 'mech').texMax;
    if (max && Math.max(img.width, img.height) > max)
      warns.push(`輸出時會縮到 ${max} px（輸出設定的貼圖最大邊長）`);
  }
  remove(m, r) {
    const pairs = this.targets(m, r.t, $('edTexScope').value);
    if (!pairs.length) return;
    this.ed.pushUndo();
    for (const { m: x, k } of pairs) {
      x[k] = null;
      x.needsUpdate = true;
    }
    this.done(`已移除貼圖（${pairs.length} 處）`);
  }
  // 為材質加入貼圖（沿用網格的貼圖座標；沒有 UV 的網格不能加）
  add(m, kind, src) {
    const meshes = this.meshesOf(m);
    if (!meshes.length || meshes.some((o) => !o.geometry.attributes.uv))
      return this.ed.toast('這個材質的網格沒有貼圖座標（UV），無法加入貼圖：請先在 3D 軟體展 UV', true);
    const warns = [];
    this.budgetWarn(src.bmp, warns);
    this.ed.pushUndo();
    const notes = [];
    if (kind === 'rm' || kind === 'rough' || kind === 'metal') {
      // glTF 的粗糙度與金屬感是同一張圖的 G、B 通道；只給其中一種時，另一種用目前的數值填滿
      const r255 = Math.round((m.roughness ?? 1) * 255),
        m255 = Math.round((m.metalness ?? 0) * 255);
      const img =
        kind === 'rm'
          ? src.bmp
          : kind === 'rough'
            ? packChannel(null, src.bmp, 1, [255, 0, m255])
            : packChannel(null, src.bmp, 2, [255, r255, 0]);
      const t = makeTex(img, null, 'roughnessMap', src.name);
      if (kind === 'rm') ORIG.set(t, { bytes: src.bytes, mime: src.mime });
      m.roughnessMap = m.metalnessMap = t;
      m.roughness = m.metalness = 1; // 數值與貼圖相乘
    } else {
      const t = makeTex(src.bmp, null, kind, src.name);
      ORIG.set(t, { bytes: src.bytes, mime: src.mime });
      m[kind] = t;
      if (kind === 'map' && m.color && m.color.getHex() !== 0xffffff) {
        m.color.setRGB(1, 1, 1); // 顏色與貼圖相乘
        notes.push('材質顏色改成白色');
      }
      if (kind === 'emissiveMap' && m.emissive && m.emissive.getHex() === 0) {
        m.emissive.setRGB(1, 1, 1);
        if (!m.emissiveIntensity) m.emissiveIntensity = 1;
        notes.push('發光顏色改成白色');
      }
      if (kind === 'aoMap')
        for (const o of meshes) if (!o.geometry.attributes.uv2) o.geometry = withUv2(o.geometry);
      if (kind === 'map' && slotOfName(m.name) && chroma(src.bmp) > 0.12)
        warns.push('色槽材質會乘上陣營色，彩色貼圖會變混濁');
    }
    m.needsUpdate = true;
    const what = ADD.find((x) => x[0] === kind)[1];
    this.done(
      `已加入${what}貼圖${notes.length ? '（' + notes.join('、') + '）' : ''}${warns.length ? '：' + warns.join('；') : ''}`,
      !!warns.length,
    );
  }
}
