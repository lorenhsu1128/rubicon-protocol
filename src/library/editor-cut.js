// GLB 編輯器「拆分」的幾何：把模型攤成三角形湯（每個三角形記錄分給哪個區塊）、平面切割並補切面、輸出各區塊的網格。
// 三角形湯：[{ mat, attrs: { 屬性名: { size, arr: Float32Array（每個三角形 3 個頂點）} }, tri: Uint8Array（區塊編號）}]
// 所有運算都產生新陣列、不修改舊陣列，復原時只要保留舊的參照。
import { excluded } from './editor-ops.js';

export const NONE = 255; // 未分配
export const DROP = 254; // 排除（不存進任何區塊）
const ATTRS = ['position', 'normal', 'uv', 'uv2', 'color'];
const NORM_MAX = { Uint8Array: 255, Int8Array: 127, Uint16Array: 65535, Int16Array: 32767 };

// 任何屬性（交錯、量化的整數）→ 一般的 Float32 屬性
export function floatAttr(a) {
  const src = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  const k = a.normalized ? 1 / (NORM_MAX[src.constructor.name] || 1) : 1;
  const out = new Float32Array(a.count * a.itemSize);
  const get = ['getX', 'getY', 'getZ', 'getW'];
  for (let i = 0; i < a.count; i++)
    for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a[get[c]](i) * k;
  return new THREE.BufferAttribute(out, a.itemSize);
}

// content 底下顯示中的網格 → 三角形湯（座標相對 space，也就是 glTF 座標）
export function buildSoup(content, space) {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const out = [];
  content.traverse((o) => {
    if (!o.isMesh || excluded(o, content.parent)) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    for (const name of ATTRS) if (src.attributes[name]) g.setAttribute(name, floatAttr(src.attributes[name]));
    if (!g.attributes.position) return;
    if (src.index) g.setIndex(src.index.clone());
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    g.applyMatrix4(m);
    const order = m.determinant() < 0 ? [0, 2, 1] : [0, 1, 2];
    const idx = g.index ? g.index.array : null;
    const total = idx ? idx.length : g.attributes.position.count;
    const groups = src.groups.length ? src.groups : [{ start: 0, count: total, materialIndex: 0 }];
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const gr of groups) {
      const n = Math.floor(Math.min(gr.count, total - gr.start) / 3);
      if (n <= 0) continue;
      const attrs = {};
      for (const [name, a] of Object.entries(g.attributes)) {
        const size = a.itemSize,
          arr = new Float32Array(n * 3 * size);
        for (let t = 0; t < n; t++)
          for (let k = 0; k < 3; k++) {
            const j = gr.start + t * 3 + order[k];
            const vi = idx ? idx[j] : j;
            for (let c = 0; c < size; c++) arr[(t * 3 + k) * size + c] = a.array[vi * size + c];
          }
        attrs[name] = { size, arr };
      }
      out.push({ mat: mats[gr.materialIndex] || mats[0], attrs, tri: new Uint8Array(n).fill(NONE) });
    }
    g.dispose();
  });
  return out;
}

export const triTotal = (soup) => soup.reduce((n, s) => n + s.tri.length, 0);

// 三角形 t 的重心（寫進 v）
export function centroid(s, t, v) {
  const p = s.attrs.position.arr,
    o = t * 9;
  return v.set(
    (p[o] + p[o + 3] + p[o + 6]) / 3,
    (p[o + 1] + p[o + 4] + p[o + 7]) / 3,
    (p[o + 2] + p[o + 5] + p[o + 8]) / 3,
  );
}

// 動態陣列的寫入器（切割時三角形數會變）
function writer(s) {
  const w = { tri: [], attrs: {} };
  for (const [name, a] of Object.entries(s.attrs)) w.attrs[name] = { size: a.size, arr: [] };
  return w;
}
// 原本的頂點 i（三角形 t 的第 k 個）
const vtx = (s, t, k) => {
  const out = {};
  for (const [name, a] of Object.entries(s.attrs)) {
    const o = (t * 3 + k) * a.size;
    out[name] = Array.from(a.arr.subarray(o, o + a.size));
  }
  return out;
};
const lerpV = (a, b, t) => {
  const out = {};
  for (const name of Object.keys(a)) out[name] = a[name].map((x, i) => x + (b[name][i] - x) * t);
  if (out.normal) {
    const [x, y, z] = out.normal;
    const L = Math.hypot(x, y, z) || 1;
    out.normal = [x / L, y / L, z / L];
  }
  return out;
};
function pushTri(w, verts, piece) {
  for (const v of verts)
    for (const [name, a] of Object.entries(w.attrs)) a.arr.push(...(v[name] || new Array(a.size).fill(0)));
  w.tri.push(piece);
}
const finish = (s, w) => {
  const attrs = {};
  for (const [name, a] of Object.entries(w.attrs))
    attrs[name] = { size: a.size, arr: new Float32Array(a.arr) };
  return { mat: s.mat, attrs, tri: Uint8Array.from(w.tri) };
};

// 平面切割：分給 A 或 B 的三角形中，落在以 p 為中心、半徑 r 的圓柱範圍內者，平面正面（法線 n 那側）分給 B、背面分給 A；
// 跨過平面的三角形沿平面切開，切口補上平面（B 的切面朝 −n、A 的朝 +n）。回傳 { soup, cut: 切開的三角形數, capped, open }
export function cutSoup(soup, { p, n, r, A, B }) {
  const segs = [];
  const cuts = soup.map(() => 0);
  const w3 = new THREE.Vector3(),
    c = new THREE.Vector3();
  let cut = 0;
  const next = soup.map((s, si) => {
    let hit = false;
    for (let t = 0; t < s.tri.length && !hit; t++) hit = s.tri[t] === A || s.tri[t] === B;
    if (!hit) return s;
    const w = writer(s);
    const pos = s.attrs.position.arr;
    for (let t = 0; t < s.tri.length; t++) {
      const piece = s.tri[t];
      const verts = [0, 1, 2].map((k) => vtx(s, t, k));
      if (piece !== A && piece !== B) {
        pushTri(w, verts, piece);
        continue;
      }
      centroid(s, t, c);
      w3.copy(c).sub(p);
      const radial = w3.clone().addScaledVector(n, -w3.dot(n));
      if (radial.length() > r) {
        pushTri(w, verts, piece);
        continue;
      }
      const d = [0, 1, 2].map(
        (k) =>
          (pos[t * 9 + k * 3] - p.x) * n.x +
          (pos[t * 9 + k * 3 + 1] - p.y) * n.y +
          (pos[t * 9 + k * 3 + 2] - p.z) * n.z,
      );
      const sd = d.map((x) => x >= 0);
      if (sd[0] === sd[1] && sd[1] === sd[2]) {
        pushTri(w, verts, sd[0] ? B : A);
        continue;
      }
      // 只有一個頂點在另一側：a 是那一點，b、c 照原本的順序（維持三角形方向）
      const k = sd[0] !== sd[1] && sd[0] !== sd[2] ? 0 : sd[1] !== sd[0] && sd[1] !== sd[2] ? 1 : 2;
      const ia = k,
        ib = (k + 1) % 3,
        ic = (k + 2) % 3;
      const P = lerpV(verts[ia], verts[ib], d[ia] / (d[ia] - d[ib]));
      const Q = lerpV(verts[ia], verts[ic], d[ia] / (d[ia] - d[ic]));
      const lone = sd[ia] ? B : A,
        other = sd[ia] ? A : B;
      pushTri(w, [verts[ia], P, Q], lone);
      pushTri(w, [P, verts[ib], verts[ic]], other);
      pushTri(w, [P, verts[ic], Q], other);
      segs.push([P.position, Q.position]);
      cuts[si]++;
      cut++;
    }
    return finish(s, w);
  });
  // 切面：切口線段連成封閉迴圈，投影到平面上三角化，加到切到最多三角形的那個網格（沿用它的材質）
  const cap = capLoops(segs, n);
  let capped = 0;
  if (cap.tris.length) {
    const si = cuts.indexOf(Math.max(...cuts));
    const s = next[si];
    const w = writer(s);
    for (let t = 0; t < s.tri.length; t++)
      pushTri(
        w,
        [0, 1, 2].map((k) => vtx(s, t, k)),
        s.tri[t],
      );
    const u = cap.u,
      v = cap.v;
    for (const [side, nn] of [
      [A, n.clone()],
      [B, n.clone().negate()],
    ])
      for (const tri of cap.tris) {
        let pts = tri;
        const fn = new THREE.Vector3()
          .subVectors(pts[1], pts[0])
          .cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
        if (fn.dot(nn) < 0) pts = [pts[0], pts[2], pts[1]];
        pushTri(
          w,
          pts.map((q) => ({
            position: [q.x, q.y, q.z],
            normal: [nn.x, nn.y, nn.z],
            uv: [q.dot(u), q.dot(v)],
          })),
          side,
        );
        capped++;
      }
    next[si] = finish(s, w);
  }
  return { soup: next, cut, capped, loops: cap.loops, open: cap.open };
}

// 切口線段 → 封閉迴圈 → 三角形（3D）；不封閉的線段鏈（網格破洞、半徑太小）略過並計數
function capLoops(segs, n) {
  const out = { tris: [], loops: 0, open: 0 };
  const axis = Math.abs(n.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  out.u = new THREE.Vector3().crossVectors(n, axis).normalize();
  out.v = new THREE.Vector3().crossVectors(n, out.u);
  if (!segs.length) return out;
  const EPS = 1e-4;
  const key = (q) => `${Math.round(q[0] / EPS)},${Math.round(q[1] / EPS)},${Math.round(q[2] / EPS)}`;
  segs = segs.filter((s) => key(s[0]) !== key(s[1])); // 接縫處的零長度線段
  const at = new Map();
  segs.forEach((s, i) => {
    for (const e of [0, 1]) {
      const k = key(s[e]);
      if (!at.has(k)) at.set(k, []);
      at.get(k).push(i);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const startK = key(segs[i][0]);
    const pts = [segs[i][0]];
    let endP = segs[i][1],
      closed = false;
    for (let guard = 0; guard < segs.length; guard++) {
      const k = key(endP);
      if (k === startK) {
        closed = true;
        break;
      }
      pts.push(endP);
      const j = (at.get(k) || []).find((x) => !used[x]);
      if (j === undefined) break;
      used[j] = 1;
      endP = key(segs[j][0]) === k ? segs[j][1] : segs[j][0];
    }
    if (closed && pts.length >= 3) loops.push(pts.map((q) => new THREE.Vector3(q[0], q[1], q[2])));
    else out.open++;
  }
  out.loops = loops.length;
  // 投影到平面，依包含關係分成外框與洞
  const o = loops.length ? loops[0][0] : new THREE.Vector3();
  const flat = loops.map((L) =>
    L.map((q) => new THREE.Vector2(q.clone().sub(o).dot(out.u), q.clone().sub(o).dot(out.v))),
  );
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
      if (
        poly[i].y > pt.y !== poly[j].y > pt.y &&
        pt.x < ((poly[j].x - poly[i].x) * (pt.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x
      )
        c = !c;
    return c;
  };
  const area = flat.map((f) => Math.abs(THREE.ShapeUtils.area(f)));
  const parents = flat.map((f, i) =>
    flat.map((g, j) => (j !== i && area[j] > area[i] && inside(f[0], g) ? j : -1)).filter((j) => j >= 0),
  );
  const depth = parents.map((p) => p.length);
  flat.forEach((f, i) => {
    if (depth[i] % 2) return; // 洞，由外框處理
    const holes = flat.map((g, j) => j).filter((j) => depth[j] === depth[i] + 1 && parents[j].includes(i));
    const pts3 = [loops[i], ...holes.map((j) => loops[j])].flat();
    let faces;
    try {
      faces = THREE.ShapeUtils.triangulateShape(
        f.slice(),
        holes.map((j) => flat[j].slice()),
      );
    } catch (e) {
      out.open++;
      return;
    }
    for (const [a, b, c] of faces) out.tris.push([pts3[a], pts3[b], pts3[c]]);
  });
  return out;
}

// 某個區塊的三角形 → 網格（同一個材質合併成一個網格，屬性取共有的），套用 matrix（例如轉成區塊的區域座標）
export function pieceMeshes(soup, piece, matrix) {
  const out = [];
  const flip = matrix && matrix.determinant() < 0;
  const order = flip ? [0, 2, 1] : [0, 1, 2];
  const byMat = new Map();
  for (const s of soup) {
    let n = 0;
    for (let t = 0; t < s.tri.length; t++) if (s.tri[t] === piece) n++;
    if (!n) continue;
    if (!byMat.has(s.mat)) byMat.set(s.mat, []);
    byMat.get(s.mat).push({ s, n });
  }
  for (const [mat, list] of byMat) {
    const total = list.reduce((a, x) => a + x.n, 0);
    const names = Object.keys(list[0].s.attrs).filter((k) =>
      list.every((x) => x.s.attrs[k] && x.s.attrs[k].size === list[0].s.attrs[k].size),
    );
    const g = new THREE.BufferGeometry();
    for (const name of names) {
      const size = list[0].s.attrs[name].size;
      const arr = new Float32Array(total * 3 * size);
      let o = 0;
      for (const { s } of list) {
        const src = s.attrs[name].arr;
        for (let t = 0; t < s.tri.length; t++) {
          if (s.tri[t] !== piece) continue;
          for (const k of order) {
            arr.set(src.subarray((t * 3 + k) * size, (t * 3 + k + 1) * size), o);
            o += size;
          }
        }
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    if (matrix) g.applyMatrix4(matrix);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out.push({ geometry: g, mat });
  }
  return out;
}
