// GLB 編輯器的幾何運算：外框、朝向、對齊程式模型、套用變換（寫進頂點）、鏡像、匯出 GLB。
// 編輯中的模型一律用 glTF 座標（+Z 正面、Y 朝上），畫面上再整個轉 180° 顯示成遊戲座標；匯出時不用轉換。
import { MODEL_CATALOG } from '../render/model-catalog.js';

const V3 = () => new THREE.Vector3();
export const AXES = {
  '+X': [1, 0, 0],
  '-X': [-1, 0, 0],
  '+Y': [0, 1, 0],
  '-Y': [0, -1, 0],
  '+Z': [0, 0, 1],
  '-Z': [0, 0, -1],
};

// 遊戲座標的外框 → glTF 座標（繞 Y 轉 180°：X、Z 取負）
export function gameBoxToGltf(b) {
  return new THREE.Box3(V3().set(-b.max.x, b.min.y, -b.max.z), V3().set(-b.min.x, b.max.y, -b.min.z));
}

// 節點（含祖先）是否被排除：隱藏或刪除的節點不匯出、不量測
export const excluded = (o, stop) => {
  for (let x = o; x && x !== stop; x = x.parent) if (!x.visible) return true;
  return false;
};

// root 底下所有網格在 space（glTF 座標框）中的外框；精確模式逐頂點計算（旋轉後外框才不會變大）
export function boxIn(root, space, precise = true) {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const box = new THREE.Box3(),
    m = new THREE.Matrix4(),
    v = V3(),
    tmp = new THREE.Box3();
  root.traverse((o) => {
    if (!o.isMesh || excluded(o, root.parent)) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const p = o.geometry.attributes.position;
    if (!p) return;
    if (precise && p.count <= 400000) {
      for (let i = 0; i < p.count; i++) box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m));
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(m));
    }
  });
  return box;
}

// 三角面數（排除隱藏與刪除的節點）
export function triCount(root) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh || excluded(o, root.parent)) return;
    const g = o.geometry;
    n += (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
  });
  return Math.round(n);
}

// 「正面是 front、上方是 up」→ 轉成 +Z 正面、+Y 上方的旋轉；兩軸平行時回傳 null
export function orientMatrix(front, up) {
  const f = V3().fromArray(AXES[front]),
    u = V3().fromArray(AXES[up]);
  if (Math.abs(f.dot(u)) > 0.5) return null;
  const r = V3().crossVectors(u, f); // 來源的 +X（glTF：X = Y × Z）
  const src = new THREE.Matrix4().makeBasis(r, u, f);
  return src.clone().transpose(); // 正交矩陣的反矩陣：把 r→X、u→Y、f→Z
}

// 在 point 為中心套用矩陣：T(p)·M·T(−p)
export const about = (m, p) =>
  new THREE.Matrix4()
    .makeTranslation(p.x, p.y, p.z)
    .multiply(m)
    .multiply(new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));

// 對齊程式模型：等比縮放後讓外框貼合參考外框
// mode：'fit' 外框整體符合（塞進外框）、'height' 高度相同、'longest' 最長邊相同
// anchor：Y 方向以 'center' 中心、'bottom' 底部、'top' 頂部對齊；X、Z 一律中心對齊
export function fitMatrix(cur, ref, mode, anchor) {
  const cs = cur.getSize(V3()),
    rs = ref.getSize(V3());
  const ratio = (k) => (cs[k] > 1e-6 ? rs[k] / cs[k] : Infinity);
  let s =
    mode === 'height'
      ? ratio('y')
      : mode === 'longest'
        ? Math.max(rs.x, rs.y, rs.z) / Math.max(cs.x, cs.y, cs.z, 1e-6)
        : Math.min(ratio('x'), ratio('y'), ratio('z'));
  if (!Number.isFinite(s) || s <= 0) s = 1;
  const pick = (b) => {
    const c = b.getCenter(V3());
    if (anchor === 'bottom') c.y = b.min.y;
    else if (anchor === 'top') c.y = b.max.y;
    return c;
  };
  const from = pick(cur),
    to = pick(ref);
  return new THREE.Matrix4()
    .makeTranslation(to.x, to.y, to.z)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-from.x, -from.y, -from.z));
}

// 原點預設位置（外框上的點）
export function boxPoint(b, where) {
  const c = b.getCenter(V3());
  if (where === 'bottom') c.y = b.min.y;
  else if (where === 'top') c.y = b.max.y;
  return c;
}

// 左右對稱的另一側槽位（r_fore ↔ l_fore、weapon/x/r ↔ l、四足 fl ↔ fr）；沒有或不在目錄時回傳 null
const SWAP = { r: 'l', l: 'r', fl: 'fr', fr: 'fl', bl: 'br', br: 'bl' };
export function mirrorSlot(id) {
  const out = id
    .replace(/\/(r|l|fl|fr|bl|br)_([a-z]+)$/, (m, k, n) => `/${SWAP[k]}_${n}`)
    .replace(/\/(r|l)$/, (m, k) => '/' + SWAP[k]);
  return out !== id && MODEL_CATALOG.some((e) => e.id === out && !e.noGlb) ? out : null;
}

// 交錯（interleaved）屬性展開成一般屬性，套用矩陣與翻轉三角形時才能直接改陣列
function plainAttr(a) {
  if (!a.isInterleavedBufferAttribute) return a;
  const Arr = a.data.array.constructor;
  const out = new THREE.BufferAttribute(new Arr(a.count * a.itemSize), a.itemSize, a.normalized);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < a.itemSize; k++) out.array[i * a.itemSize + k] = a[get[k]](i);
  return out;
}
// 鏡像後三角形的頂點順序要反過來，否則正反面顛倒（背面剔除時看起來像破洞）
function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const t = a[i + 1];
      a[i + 1] = a[i + 2];
      a[i + 2] = t;
    }
    g.index.needsUpdate = true;
    return;
  }
  for (const attr of Object.values(g.attributes)) {
    const a = attr.array,
      n = attr.itemSize;
    for (let i = 0; i + 2 < attr.count; i += 3)
      for (let k = 0; k < n; k++) {
        const t = a[(i + 1) * n + k];
        a[(i + 1) * n + k] = a[(i + 2) * n + k];
        a[(i + 2) * n + k] = t;
      }
    attr.needsUpdate = true;
  }
  const t = g.attributes.tangent;
  if (t) for (let i = 0; i < t.count; i++) t.array[i * 4 + 3] *= -1;
}

// 套用變換：content 底下每個網格的變換（相對 space）寫進頂點，輸出扁平的根節點（變換全部歸零）
// extra：額外套在最外層的矩陣（例如鏡像）
export function bakeScene(content, space, name, extra = null) {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const root = new THREE.Group();
  root.name = name;
  content.traverse((o) => {
    if (!o.isMesh || excluded(o, content.parent)) return;
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    if (extra) m.premultiply(extra);
    const g = o.geometry.clone();
    for (const k of Object.keys(g.attributes)) g.setAttribute(k, plainAttr(g.attributes[k]));
    g.morphAttributes = {};
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, o.material);
    mesh.name = o.name;
    root.add(mesh);
  });
  return root;
}

// 匯出 GLB（ArrayBuffer）
// maxTex：貼圖輸出的最大邊長（0＝不限）；之後的 processGlb 也會縮圖，先在這裡縮小可以少編碼大張的 PNG
export function exportGlb(root, maxTex = 0) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFExporter) return reject(new Error('GLTFExporter 未載入'));
    try {
      new THREE.GLTFExporter().parse(root, resolve, {
        binary: true,
        onlyVisible: true,
        maxTextureSize: maxTex > 0 ? maxTex : Infinity,
      });
    } catch (e) {
      reject(e);
    }
  });
}

// 合併：root 底下的網格套用變換（相對 space）後，同一個材質合併成一個網格（屬性取共有的，保留索引）；
// 多重材質的網格不合併。回傳新的群組（變換歸零）
export function mergeByMaterial(root, space, name) {
  const flat = bakeScene(root, space, name);
  const out = new THREE.Group();
  out.name = name;
  const byMat = new Map();
  for (const m of flat.children) {
    if (Array.isArray(m.material)) {
      out.add(m);
      continue;
    }
    if (!byMat.has(m.material)) byMat.set(m.material, []);
    byMat.get(m.material).push(m);
  }
  for (const [mat, list] of byMat) {
    if (list.length === 1) {
      out.add(list[0]);
      continue;
    }
    const geos = list.map((m) => m.geometry);
    const names = Object.keys(geos[0].attributes).filter((k) =>
      geos.every((g) => g.attributes[k] && g.attributes[k].itemSize === geos[0].attributes[k].itemSize),
    );
    const g = new THREE.BufferGeometry();
    for (const k of names) {
      const size = geos[0].attributes[k].itemSize;
      const arr = new Float32Array(geos.reduce((n, x) => n + x.attributes[k].count, 0) * size);
      let o = 0;
      for (const x of geos) {
        const a = x.attributes[k];
        for (let i = 0; i < a.count * size; i++) arr[o + i] = a.array[i];
        o += a.count * size;
      }
      g.setAttribute(k, new THREE.BufferAttribute(arr, size));
    }
    const idx = [];
    let base = 0;
    for (const x of geos) {
      const n = x.attributes.position.count;
      if (x.index) for (const i of x.index.array) idx.push(i + base);
      else for (let i = 0; i < n; i++) idx.push(i + base);
      base += n;
      x.dispose();
    }
    g.setIndex(new THREE.BufferAttribute(base > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = list[0].name;
    out.add(mesh);
  }
  return out;
}
