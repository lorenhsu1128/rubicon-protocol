// GLB 編輯器的「最佳化與輸出」：焊接重複頂點、減面（meshoptimizer，保留貼圖座標與法線）、
// 匯出後處理 GLB：縮小貼圖、貼圖改存 WebP（有透明的存 PNG）、Draco 網格壓縮（編碼器在 lib/draco/draco-encoder.js，用到才載入）。
import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import { floatAttr } from './editor-cut.js';

// ---------- 焊接：屬性完全相同（量化後）的頂點合併成一個，回傳有索引的新幾何（保留 groups）----------
export function weldGeometry(g) {
  const names = Object.keys(g.attributes);
  const attrs = names.map((n) => floatAttr(g.attributes[n]));
  const q = names.map((n) => (n === 'position' ? 1e5 : 1e4));
  const count = g.attributes.position.count;
  const map = new Map();
  const remap = new Uint32Array(count);
  let uniq = 0;
  const first = [];
  for (let i = 0; i < count; i++) {
    let key = '';
    attrs.forEach((a, k) => {
      for (let c = 0; c < a.itemSize; c++) key += Math.round(a.array[i * a.itemSize + c] * q[k]) + ',';
    });
    let j = map.get(key);
    if (j === undefined) {
      j = uniq++;
      map.set(key, j);
      first.push(i);
    }
    remap[i] = j;
  }
  const out = new THREE.BufferGeometry();
  attrs.forEach((a, k) => {
    const arr = new Float32Array(uniq * a.itemSize);
    first.forEach((src, j) =>
      arr.set(a.array.subarray(src * a.itemSize, (src + 1) * a.itemSize), j * a.itemSize),
    );
    out.setAttribute(names[k], new THREE.BufferAttribute(arr, a.itemSize));
  });
  const src = g.index ? g.index.array : null;
  const n = src ? src.length : count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = remap[src ? src[i] : i];
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  for (const gr of g.groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  return out;
}

// 只留下索引用到的頂點
function compact(g, idx, groups) {
  const used = new Int32Array(g.attributes.position.count).fill(-1);
  let n = 0;
  for (const i of idx) if (used[i] < 0) used[i] = n++;
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(n * a.itemSize);
    for (let i = 0; i < used.length; i++)
      if (used[i] >= 0) arr.set(a.array.subarray(i * a.itemSize, (i + 1) * a.itemSize), used[i] * a.itemSize);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const ni = n > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length);
  for (let i = 0; i < idx.length; i++) ni[i] = used[idx[i]];
  out.setIndex(new THREE.BufferAttribute(ni, 1));
  for (const gr of groups) out.addGroup(gr.start, gr.count, gr.materialIndex);
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

export const triCountOf = (g) => Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);

// 減面到約 ratio 倍（每個材質群組各自減）：以法線與貼圖座標為屬性，避免貼圖拉扯；回傳新幾何
export async function simplifyGeometry(g, ratio) {
  await MeshoptSimplifier.ready;
  const w = weldGeometry(g);
  if (ratio >= 1) return compact(w, w.index.array, w.groups);
  const pos = w.attributes.position.array;
  const nv = w.attributes.position.count;
  const extra = [];
  const weights = [];
  if (w.attributes.normal) {
    extra.push([w.attributes.normal, 3]);
    weights.push(0.5, 0.5, 0.5);
  }
  if (w.attributes.uv) {
    extra.push([w.attributes.uv, 2]);
    weights.push(1, 1);
  }
  const stride = weights.length;
  const attr = new Float32Array(nv * stride);
  for (let i = 0; i < nv; i++) {
    let o = i * stride;
    for (const [a, s] of extra) for (let c = 0; c < s; c++) attr[o++] = a.array[i * s + c];
  }
  const index = w.index.array;
  const groups = w.groups.length ? w.groups : [{ start: 0, count: index.length, materialIndex: 0 }];
  const parts = [];
  const outGroups = [];
  let start = 0;
  for (const gr of groups) {
    const sub = index.slice(gr.start, gr.start + gr.count);
    const target = Math.max(3, Math.floor((sub.length * ratio) / 3) * 3);
    let res;
    if (target >= sub.length) res = sub;
    else if (stride)
      res = MeshoptSimplifier.simplifyWithAttributes(
        sub,
        pos,
        3,
        attr,
        stride,
        weights,
        null,
        target,
        1,
        [],
      )[0];
    else res = MeshoptSimplifier.simplify(sub, pos, 3, target, 1, [])[0];
    parts.push(res);
    if (w.groups.length) outGroups.push({ start, count: res.length, materialIndex: gr.materialIndex });
    start += res.length;
  }
  const all = new Uint32Array(start);
  let o = 0;
  for (const p of parts) {
    all.set(p, o);
    o += p.length;
  }
  return compact(w, all, outGroups);
}

// ---------- 匯出設定（存在這個瀏覽器）----------
const KEY = 'rubicon_glb_export';
export function loadExportOpts() {
  let o = {};
  try {
    o = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {}
  return { texMax: 'budget', webp: true, draco: false, ...o };
}
export function saveExportOpts(o) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch (e) {}
}

// ---------- GLB 讀寫 ----------
function readGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('不是 GLB 檔');
  const jl = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jl)));
  let bin = new Uint8Array(0);
  if (20 + jl < buf.byteLength) {
    const bl = dv.getUint32(20 + jl, true);
    bin = new Uint8Array(buf, 28 + jl, bl);
  }
  return { json, bin };
}
const pad4 = (n) => (n + 3) & ~3;
function writeGlb(json, bin) {
  const js = new TextEncoder().encode(JSON.stringify(json));
  const jl = pad4(js.length),
    bl = pad4(bin.length);
  const out = new Uint8Array(12 + 8 + jl + (bl ? 8 + bl : 0));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jl, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jl);
  out.set(js, 20);
  if (bl) {
    dv.setUint32(20 + jl, bl, true);
    dv.setUint32(24 + jl, 0x004e4942, true);
    out.set(bin, 28 + jl);
  }
  return out.buffer;
}
const addExt = (json, name, required) => {
  json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), name])];
  if (required) json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), name])];
};

// 貼圖：縮小到 texMax 以內；webp 時不透明的改存 WebP、有透明的存 PNG
async function processImages(json, views, { texMax, webp }) {
  for (const img of json.images || []) {
    if (img.bufferView === undefined) continue;
    const data = views[img.bufferView];
    let bmp;
    try {
      bmp = await createImageBitmap(new Blob([data], { type: img.mimeType || 'image/png' }));
    } catch (e) {
      continue;
    }
    const s = texMax ? Math.min(1, texMax / Math.max(bmp.width, bmp.height)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * s));
    c.height = Math.max(1, Math.round(bmp.height * s));
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0, c.width, c.height);
    let alpha = false;
    if (webp) {
      const a = g.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < a.length && !alpha; i += 4) alpha = a[i] < 255;
    }
    const type = webp && !alpha ? 'image/webp' : 'image/png';
    if (s === 1 && type === img.mimeType) continue;
    const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
    if (!blob || blob.type !== type) continue; // 瀏覽器不支援該格式
    views[img.bufferView] = new Uint8Array(await blob.arrayBuffer());
    img.mimeType = type;
  }
  let used = false;
  for (const tex of json.textures || []) {
    const img = tex.source !== undefined && json.images[tex.source];
    if (!img || img.mimeType !== 'image/webp') continue;
    tex.extensions = { ...(tex.extensions || {}), EXT_texture_webp: { source: tex.source } };
    delete tex.source;
    used = true;
  }
  if (used) addExt(json, 'EXT_texture_webp', true);
}

// ---------- Draco ----------
const ENCODER = 'lib/draco/draco-encoder.js';
let encP = null;
function loadEncoder() {
  if (!encP)
    encP = new Promise((resolve, reject) => {
      // Emscripten 的模組物件有 then（thenable），直接 resolve 會被 Promise 當成另一個 Promise 而永遠等不到，所以先拿掉
      const init = () => {
        let done = false;
        const finish = (mod) => {
          if (done || !mod || !mod.Encoder) return;
          done = true;
          delete mod.then;
          resolve(mod);
        };
        const m = window.DracoEncoderModule({ onModuleLoaded: finish });
        finish(m);
      };
      if (window.DracoEncoderModule) return init();
      const s = document.createElement('script');
      s.src = ENCODER;
      s.onload = init;
      s.onerror = () => {
        encP = null;
        reject(new Error(`找不到 Draco 編碼器（${ENCODER}，應放在頁面旁的 lib 資料夾）`));
      };
      document.head.appendChild(s);
    });
  return encP;
}
const COMP = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const NORM = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };
function readAccessor(json, views, i) {
  const acc = json.accessors[i];
  const n = SIZE[acc.type] * acc.count;
  if (acc.bufferView === undefined) return new Float32Array(n);
  const view = json.bufferViews[acc.bufferView];
  const data = views[acc.bufferView];
  const T = COMP[acc.componentType];
  const size = SIZE[acc.type];
  const stride = view.byteStride || size * T.BYTES_PER_ELEMENT;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const get = {
    5120: 'getInt8',
    5121: 'getUint8',
    5122: 'getInt16',
    5123: 'getUint16',
    5125: 'getUint32',
    5126: 'getFloat32',
  }[acc.componentType];
  const out = acc.type === 'SCALAR' && acc.componentType !== 5126 ? new Uint32Array(n) : new Float32Array(n); // 索引用整數
  const k = acc.normalized ? 1 / NORM[acc.componentType] : 1;
  for (let e = 0; e < acc.count; e++)
    for (let c = 0; c < size; c++)
      out[e * size + c] = dv[get]((acc.byteOffset || 0) + e * stride + c * T.BYTES_PER_ELEMENT, true) * k;
  return out;
}
async function dracoCompress(json, views) {
  const M = await loadEncoder();
  const typeOf = (name) =>
    name === 'POSITION'
      ? M.POSITION
      : name === 'NORMAL'
        ? M.NORMAL
        : name.startsWith('TEXCOORD')
          ? M.TEX_COORD
          : name.startsWith('COLOR')
            ? M.COLOR
            : M.GENERIC;
  const QBITS = { POSITION: 14, NORMAL: 10, TEX_COORD: 12, COLOR: 8, GENERIC: 12 };
  const dropped = new Set();
  let n = 0;
  for (const mesh of json.meshes || [])
    for (const prim of mesh.primitives) {
      if ((prim.mode !== undefined && prim.mode !== 4) || prim.targets) continue;
      const pos = json.accessors[prim.attributes.POSITION];
      const count = pos.count;
      let idx = prim.indices !== undefined ? readAccessor(json, views, prim.indices) : null;
      if (!idx) {
        idx = new Uint32Array(count);
        for (let i = 0; i < count; i++) idx[i] = i;
      }
      const encoder = new M.Encoder(),
        builder = new M.MeshBuilder(),
        dm = new M.Mesh();
      builder.AddFacesToMesh(dm, idx.length / 3, Uint32Array.from(idx));
      const ids = {};
      for (const [name, ai] of Object.entries(prim.attributes)) {
        const acc = json.accessors[ai];
        const arr = Float32Array.from(readAccessor(json, views, ai));
        ids[name] = builder.AddFloatAttributeToMesh(dm, typeOf(name), acc.count, SIZE[acc.type], arr);
        dropped.add(ai);
      }
      for (const [k, b] of Object.entries(QBITS)) encoder.SetAttributeQuantization(M[k], b);
      encoder.SetSpeedOptions(5, 5);
      encoder.SetEncodingMethod(M.MESH_EDGEBREAKER_ENCODING);
      const da = new M.DracoInt8Array();
      const len = encoder.EncodeMeshToDracoBuffer(dm, da);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = da.GetValue(i);
      M.destroy(da);
      M.destroy(dm);
      M.destroy(builder);
      M.destroy(encoder);
      if (!len) continue;
      views.push(bytes);
      json.bufferViews.push({ buffer: 0, byteLength: len });
      prim.extensions = {
        ...(prim.extensions || {}),
        KHR_draco_mesh_compression: { bufferView: json.bufferViews.length - 1, attributes: ids },
      };
      if (prim.indices !== undefined) dropped.add(prim.indices);
      n++;
    }
  // 被壓縮的 accessor 不再指向原本的資料；整數屬性解碼後是浮點數
  for (const ai of dropped) {
    const acc = json.accessors[ai];
    delete acc.bufferView;
    delete acc.byteOffset;
    if (acc.componentType !== 5126 && acc.type !== 'SCALAR') {
      acc.componentType = 5126;
      delete acc.normalized;
    }
  }
  if (n) addExt(json, 'KHR_draco_mesh_compression', true);
}

// 重新打包：只留下還有人用的 bufferView，4 位元組對齊
function repack(json, views) {
  const used = new Set();
  for (const a of json.accessors || []) if (a.bufferView !== undefined) used.add(a.bufferView);
  for (const img of json.images || []) if (img.bufferView !== undefined) used.add(img.bufferView);
  for (const m of json.meshes || [])
    for (const p of m.primitives) {
      const d = p.extensions && p.extensions.KHR_draco_mesh_compression;
      if (d) used.add(d.bufferView);
    }
  const order = [...used].sort((a, b) => a - b);
  const remap = new Map();
  let len = 0;
  const views2 = order.map((i, k) => {
    remap.set(i, k);
    const v = { ...json.bufferViews[i], buffer: 0, byteOffset: len, byteLength: views[i].length };
    len = pad4(len + views[i].length);
    return v;
  });
  const bin = new Uint8Array(len);
  order.forEach((i, k) => bin.set(views[i], views2[k].byteOffset));
  for (const a of json.accessors || [])
    if (a.bufferView !== undefined) a.bufferView = remap.get(a.bufferView);
  for (const img of json.images || [])
    if (img.bufferView !== undefined) img.bufferView = remap.get(img.bufferView);
  for (const m of json.meshes || [])
    for (const p of m.primitives) {
      const d = p.extensions && p.extensions.KHR_draco_mesh_compression;
      if (d) d.bufferView = remap.get(d.bufferView);
    }
  json.bufferViews = views2;
  json.buffers = len ? [{ byteLength: len }] : [];
  return bin;
}

// 匯出後處理：opts = { texMax: 像素（0＝不縮小）, webp, draco }
export async function processGlb(buf, opts) {
  if (!opts.texMax && !opts.webp && !opts.draco) return buf;
  const { json, bin } = readGlb(buf);
  const views = (json.bufferViews || []).map((v) =>
    bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength),
  );
  await processImages(json, views, opts);
  if (opts.draco) await dracoCompress(json, views);
  const out = repack(json, views);
  return writeGlb(json, out);
}
