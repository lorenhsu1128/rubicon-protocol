// 地圖物件的網格建造（純函式，不使用亂數）：關卡生成以亂數決定參數後呼叫這裡，模型庫也直接使用。
// 修改這裡的幾何會改變所有種子產生的地圖外觀，但不影響亂數序列（多人各端仍一致）。
import { MS } from '../core/scale.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { materialSlot } from '../render/glb.js';
import { providedModel } from '../render/model-provider.js';
import { D, classMat, fineReg, matClass, tintCtx, tintMerge, upgradeGeo, vcMat } from '../render/detail.js';
// 岩石的形狀：依尺寸決定 24 種之一（不用亂數；同一種共用幾何）
const rockSeed = (v) => (Math.floor(Math.abs(v) * 977) % 24) + 1;

const MatCache = {};

// ---------- 本地模型庫的 GLB（單人模式，見 render/model-provider.js）----------
// GLB 以模型庫的代表尺寸（ref）製作，遊戲依實際尺寸（size，GLB 本身的 X／Y／Z）分別縮放；rotY 再繞 Y 轉；
// y：GLB 原點相對於回傳群組的高度（呼叫端把群組放在物件中心時用）。命名為 main 的材質改成物件的顏色；
// 不加描邊（與程式模型一致）；fade：材質設為可透明（擋住鏡頭時半透明）
const PROP_MATS = new WeakMap();
// 換成 GLB 時的材質清單（遮擋半透明、受擊閃光用）；程式模型為 null
export const propMats = (obj) => PROP_MATS.get(obj) || null;
export function propGlb(slot, { color, ref, size, rotY = 0, y = 0, fade = false } = {}) {
  const obj = providedModel('prop/' + slot, null, true);
  if (!obj) return null;
  const mats = [],
    outlines = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.material === OUTLINE_MAT) return outlines.push(o);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (color !== undefined && materialSlot(m.name) === 'main') m.color.set(color);
      if (fade) m.transparent = true;
      if (!mats.includes(m)) mats.push(m);
    }
  });
  for (const o of outlines) o.parent.remove(o);
  if (ref && size) obj.scale.set(size[0] / ref[0], size[1] / ref[1], size[2] / ref[2]);
  const g = new THREE.Group();
  const holder = new THREE.Group();
  holder.position.y = y;
  holder.rotation.y = rotY;
  holder.add(obj);
  g.add(holder);
  PROP_MATS.set(g, mats);
  return g;
}
export function mat(color, opts) {
  const k = color + '|' + JSON.stringify(opts || {});
  if (MatCache[k]) return MatCache[k];
  const m = new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness: 0.62, metalness: 0.28, flatShading: true }, opts || {}),
  );
  MatCache[k] = m;
  return m;
}
export function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.set(x, y, z);
  g.castShadow = true;
  g.receiveShadow = true;
  return g;
}
export function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  g.position.set(x, y, z);
  g.castShadow = true;
  return g;
}

// ---------- 合併建造（PK）：同一材質的零件合併成一個網格，減少繪製次數 ----------
// 用法：const k = new PK(); k.box(材質, w, h, d, x, y, z, rx, ry, rz)…；k.at(x, y, z, rx, ry, rz, () => {…}) 疊加群組變換；
// 最後 k.build(群組) 依材質各產生一個網格（castShadow／receiveShadow）。不使用亂數，純幾何。
const _mx = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _eu = new THREE.Euler(),
  _v1 = new THREE.Vector3(),
  _v2 = new THREE.Vector3();
const UNIT_GEO = {};
// 攤平索引時保留形體的參數（精細版的 upgradeGeo 依它換成倒角方塊／段數多的圓柱）
const nonIdx = (g) => {
  if (!g.index) return g;
  const o = g.toNonIndexed();
  if (g.parameters) {
    o.parameters = g.parameters;
    o.userData.ptype = g.type;
  }
  return o;
};
const unitGeo = (k, make) => UNIT_GEO[k] || (UNIT_GEO[k] = nonIdx(make()));
function compose(x, y, z, rx, ry, rz, sx, sy, sz) {
  return new THREE.Matrix4().compose(
    _v1.set(x, y, z),
    _q.setFromEuler(_eu.set(rx, ry, rz)),
    _v2.set(sx, sy, sz),
  );
}
// 倒角方塊（12 條邊都切角）：凸多面體，三角形一律朝外（以中心判斷方向）
function chamferGeo(w, h, d, c) {
  const H = [w / 2, h / 2, d / 2];
  c = Math.max(0.001, Math.min(c, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9));
  const P = (a, s) => s.map((sv, i) => sv * (i === a ? H[i] : H[i] - c));
  const pos = [];
  const tri = (A, B, C2) => {
    const ux = B[0] - A[0],
      uy = B[1] - A[1],
      uz = B[2] - A[2],
      vx = C2[0] - A[0],
      vy = C2[1] - A[1],
      vz = C2[2] - A[2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const cx = A[0] + B[0] + C2[0],
      cy = A[1] + B[1] + C2[1],
      cz = A[2] + B[2] + C2[2];
    if (nx * cx + ny * cy + nz * cz < 0) pos.push(...A, ...C2, ...B);
    else pos.push(...A, ...B, ...C2);
  };
  const quad = (A, B, C2, D) => {
    tri(A, B, C2);
    tri(A, C2, D);
  };
  const sg = (a, s1, s2) => {
    // 軸 a 以外兩軸的符號
    const o = [0, 1, 2].filter((i) => i !== a);
    const s = [0, 0, 0];
    s[o[0]] = s1;
    s[o[1]] = s2;
    return s;
  };
  for (let a = 0; a < 3; a++)
    for (const s of [-1, 1]) {
      const v = (s1, s2) => {
        const q = sg(a, s1, s2);
        q[a] = s;
        return P(a, q);
      };
      quad(v(1, 1), v(1, -1), v(-1, -1), v(-1, 1));
    }
  for (let a = 0; a < 3; a++)
    for (let b = a + 1; b < 3; b++) {
      const t = 3 - a - b;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const s = (st) => {
            const q = [0, 0, 0];
            q[a] = sa;
            q[b] = sb;
            q[t] = st;
            return q;
          };
          quad(P(a, s(1)), P(a, s(-1)), P(b, s(-1)), P(b, s(1)));
        }
    }
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1]) {
        const s = [sx, sy, sz];
        tri(P(0, s), P(1, s), P(2, s));
      }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
// 精細版的預設選項（docs/model-detail.md）：地圖物件一律打開；建好之後還會改材質顏色的模型（RTS 的建築、過場）用 new PK(false)
const PK_TINT = { ao: 0.75, grime: 0.22, lite: true };
export class PK {
  constructor(t) {
    this.tintOpts = t === false ? null : t || PK_TINT;
    this.by = new Map(); // [材質, 零件] → [[幾何, 矩陣]…]
    this.keys = new Map();
    this.stack = [new THREE.Matrix4()];
    this.cur = -1; // inPart 指定的外框零件（−1＝不指定）
  }
  get top() {
    return this.stack[this.stack.length - 1];
  }
  // 在 fn 裡加入的零件都套上這個變換（相當於子群組）
  at(x, y, z, rx, ry, rz, fn) {
    this.stack.push(compose(x, y, z, rx, ry, rz, 1, 1, 1).premultiply(this.top));
    fn();
    this.stack.pop();
    return this;
  }
  // 在 fn 裡加入的零件（含外框登記）整體縮放 s 倍：舊尺寸的結構本體放大成現實尺寸時用；
  // 人會用到的細節（欄杆、爬梯、門）畫在 fn 之外，維持人的尺寸（docs/world-scale.md）
  scaled(s, fn) {
    this.stack.push(compose(0, 0, 0, 0, 0, 0, s, s, s).premultiply(this.top));
    fn();
    this.stack.pop();
    return this;
  }
  // 以矩陣加入一個幾何（bakeGroup 用）
  geoM(m, g, matrix) {
    return this.geoAt(m, g, matrix.clone().premultiply(this.top));
  }
  geo(m, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    return this.geoAt(m, g, compose(x, y, z, rx, ry, rz, sx, sy, sz).premultiply(this.top));
  }
  geoAt(m, g, mm) {
    let km = this.keys.get(m);
    if (!km) this.keys.set(m, (km = new Map()));
    const kk = this.isFine ? this.cur + 'f' : this.cur;
    let key = km.get(kk);
    if (!key) {
      key = [m, this.cur, !!this.isFine];
      km.set(kk, key);
      this.by.set(key, []);
    }
    this.by.get(key).push([nonIdx(g), mm]);
    return this;
  }
  box(m, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.geo(
      m,
      unitGeo('box', () => new THREE.BoxGeometry(1, 1, 1)),
      x,
      y,
      z,
      rx,
      ry,
      rz,
      w,
      h,
      d,
    );
  }
  // 倒角方塊（c＝倒角寬）
  cb(m, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.08) {
    return this.geo(m, chamferGeo(w, h, d, c), x, y, z, rx, ry, rz);
  }
  // 圓柱（軸沿 Y；rt 頂半徑、rb 底半徑）
  cyl(m, rt, rb, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 8) {
    const R = Math.max(rt, rb) || 1;
    const t = Math.round((rt / R) * 100) / 100,
      b = Math.round((rb / R) * 100) / 100;
    const g = unitGeo(`c${t},${b},${seg}`, () => new THREE.CylinderGeometry(t, b, 1, seg));
    return this.geo(m, g, x, y, z, rx, ry, rz, R, h, R);
  }
  // 兩點之間的桿（方形斷面 t）
  bar(m, a, b, t = 0.12) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return this;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    const e = new THREE.Euler().setFromQuaternion(_q);
    return this.box(m, t, L, t, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, e.x, e.y, e.z);
  }
  // 兩點之間的圓管
  pipe(m, a, b, r = 0.1, seg = 6) {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    if (L < 1e-4) return this;
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
    const e = new THREE.Euler().setFromQuaternion(_q);
    return this.cyl(m, r, r, L, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, e.x, e.y, e.z, seg);
  }
  // 平面多邊形輪廓（XY 平面）沿 Z 擠出 depth（置中）
  prism(m, pts, depth, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const sh = new THREE.Shape(pts.map(([px, py]) => new THREE.Vector2(px, py)));
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, steps: 1 });
    g.translate(0, 0, -depth / 2);
    return this.geo(m, g, x, y, z, rx, ry, rz);
  }
  // 單面四邊形（a→b→c→d 逆時針看到正面）
  quad(m, a, b, c, d) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
    g.computeVertexNormals();
    return this.geo(m, g);
  }
  // 精細版（docs/model-detail.md）：build 時整個物件一起烘焙頂點色（遮蔽、凸邊、貼地的髒污，render/detail.js），
  // 材質換成打開 vertexColors 的複本（vcMat）。o＝tintCtx 的選項
  tint(o = {}) {
    this.tintOpts = o;
    return this;
  }
  // fn 裡加的零件是小細節：tint 時另外合併成一個網格，鏡頭遠了隱藏（fineReg；沒有 tint 時照一般零件）
  fine(fn, dist) {
    const prev = this.isFine;
    this.isFine = true;
    if (dist) this.fineDist = dist;
    fn();
    this.isFine = prev;
    return this;
  }
  // 人的介面標記（門、樓梯、爬梯、可以走的面；之後的小人互動用）：build 時加成這個名稱的空節點
  mark(name, x = 0, y = 0, z = 0, ry = 0) {
    (this.marks = this.marks || []).push([name, compose(x, y, z, 0, ry, 0, 1, 1, 1).premultiply(this.top)]);
    return this;
  }
  // 依材質合併成網格，加到 group（沒給時新建）並回傳
  build(group = new THREE.Group(), shadow = true) {
    for (const [name, mm] of this.marks || []) {
      const o = new THREE.Object3D();
      o.name = name;
      mm.decompose(o.position, o.quaternion, o.scale);
      o.userData.human = true;
      group.add(o);
    }
    this.marks = null;
    const parts = this.parts || [];
    // 沒有指定零件的網格：外框＝登記的外框（原本程式模型的各零件外框的聯集；沒有登記時照實際的頂點）
    let union = null;
    if (parts.length) {
      union = new THREE.Box3();
      for (const p of parts) union.union(p.box.clone().applyMatrix4(p.mm));
    }
    const inv = new THREE.Matrix4(),
      m2 = new THREE.Matrix4(),
      nm = new THREE.Matrix3();
    if (this.tintOpts) return this.buildTint(group, shadow, parts, union);
    for (const [key, list] of this.by) {
      const [m, pi] = key;
      const part = pi >= 0 ? parts[pi] : null;
      if (part) inv.copy(part.mm).invert();
      let n = 0;
      for (const [g] of list) n += g.attributes.position.count;
      const pos = new Float32Array(n * 3),
        nor = new Float32Array(n * 3),
        uv = new Float32Array(n * 2);
      let o = 0;
      for (const [g, mm] of list) {
        const p = g.attributes.position,
          nn = g.attributes.normal,
          u = g.attributes.uv;
        // 指定零件的網格放在零件的位置與旋轉上，頂點換成零件座標
        const M = part ? m2.multiplyMatrices(inv, mm) : mm;
        nm.getNormalMatrix(M);
        for (let i = 0; i < p.count; i++, o++) {
          _v1.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(M);
          pos[o * 3] = _v1.x;
          pos[o * 3 + 1] = _v1.y;
          pos[o * 3 + 2] = _v1.z;
          if (nn) {
            _v2.set(nn.getX(i), nn.getY(i), nn.getZ(i)).applyMatrix3(nm).normalize();
            nor[o * 3] = _v2.x;
            nor[o * 3 + 1] = _v2.y;
            nor[o * 3 + 2] = _v2.z;
          }
          if (u) {
            uv[o * 2] = u.getX(i);
            uv[o * 2 + 1] = u.getY(i);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.computeBoundingSphere();
      if (part) geo.boundingBox = part.box.clone();
      else if (union) geo.boundingBox = union.clone();
      const mesh = new PropMesh(geo, m);
      if (part) part.mm.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.by.clear();
    this.keys.clear();
    this.parts = null;
    return group;
  }
  buildTint(group, shadow, parts, union) {
    const all = [];
    for (const [key, list] of this.by) {
      const m = key[0];
      // 舊的基本形體換成精細的（倒角方塊、段數多的圓柱）
      if (this.tintOpts.upgrade !== false)
        for (const e of list)
          [e[0], e[1]] = upgradeGeo(e[0], e[1], this.tintOpts.k || 1, !!this.tintOpts.lite);
      if (m.transparent && m.opacity < 1) continue;
      for (const e of list) all.push({ geo: e[0], mm: e[1] });
    }
    const ctx = tintCtx(all, this.tintOpts);
    // 同類的材質合併成一個網格（顏色烘進頂點色，減少繪製次數）；小細節（fine）全部併成一類
    const groups = new Map();
    let ai = 0;
    for (const [key, list] of this.by) {
      const [m, pi, isFine] = key;
      const skip = m.transparent && m.opacity < 1;
      const c = matClass(m);
      const fade = !!m.transparent;
      const gk = c === null ? m : `${isFine ? 'f' : c}|${pi}|${fade ? 1 : 0}`;
      let G = groups.get(gk);
      if (!G) groups.set(gk, (G = { m, c: isFine && c !== null ? 4 : c, pi, isFine, fade, items: [] }));
      const part = pi >= 0 ? parts[pi] : null;
      const inv = part ? new THREE.Matrix4().copy(part.mm).invert() : null;
      for (const [g, mm] of list) {
        const it = { geo: g, mm: part ? new THREE.Matrix4().multiplyMatrices(inv, mm) : mm, wm: mm };
        if (c !== null) it.col = m.color;
        if (!skip) ctx.index.set(it, ai++);
        G.items.push(it);
      }
    }
    for (const G of groups.values()) {
      const part = G.pi >= 0 ? parts[G.pi] : null;
      const geo = tintMerge(G.items, ctx);
      geo.computeBoundingSphere();
      if (part) geo.boundingBox = part.box.clone();
      else if (union) geo.boundingBox = union.clone();
      const mat =
        G.c !== null ? classMat(G.c, G.fade ? G.m : null) : G.m.isMeshStandardMaterial ? vcMat(G.m) : G.m;
      if (G.c === null && !G.m.isMeshStandardMaterial) geo.deleteAttribute('color');
      const mesh = new PropMesh(geo, mat);
      if (part) part.mm.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = shadow && !G.isFine;
      mesh.receiveShadow = true;
      if (G.isFine) fineReg(mesh, this.fineDist);
      group.add(mesh);
    }
    this.by.clear();
    this.keys.clear();
    this.parts = null;
    return group;
  }
  // 外框：世界的掩體牆、可破壞物件的命中半徑與鏡頭遮擋、自訂關卡的碰撞都由 Box3.setFromObject／外框量測產生，
  // 細節造型不能改變它們，所以外框照原本的程式模型登記（bounds＝整個外框，ob＝原本的一個零件），細節畫在外框內。
  // 網格的 geometry.boundingBox 設成登記的外框（聯集）。呼叫端會任意旋轉的物件，改用 inPart 把零件分到原本的各個零件上
  // （網格放在零件的位置與旋轉、外框是零件自己的），所以旋轉之後量到的外框也和原本完全相同。
  bounds(x0, y0, z0, x1, y1, z1) {
    const b = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    (this.parts = this.parts || []).push({ box: b, mm: new THREE.Matrix4() });
    return this;
  }
  // 外框加上原本的一個方塊零件（同樣的位置與旋轉）
  ob(w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const b = new THREE.Box3(
      new THREE.Vector3(-w / 2, -h / 2, -d / 2),
      new THREE.Vector3(w / 2, h / 2, d / 2),
    );
    return this.obGeo(b, x, y, z, rx, ry, rz);
  }
  // 外框加上原本的一個圓柱零件（CylinderGeometry 的外框）
  obCyl(rt, rb, h, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, seg = 8) {
    const k = `oc${rt},${rb},${h},${seg}`;
    if (!UNIT_GEO[k]) {
      const g = new THREE.CylinderGeometry(rt, rb, h, seg);
      g.computeBoundingBox();
      UNIT_GEO[k] = g.boundingBox;
    }
    return this.obGeo(UNIT_GEO[k], x, y, z, rx, ry, rz);
  }
  // 外框加上原本的任意幾何零件（例如 Torus／Sphere）
  obMesh(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    geo.computeBoundingBox();
    return this.obGeo(geo.boundingBox, x, y, z, rx, ry, rz);
  }
  obGeo(box3, x, y, z, rx, ry, rz) {
    const mm = compose(x, y, z, rx, ry, rz, 1, 1, 1).premultiply(this.top);
    (this.parts = this.parts || []).push({ box: box3.clone(), mm });
    return this;
  }
  // fn 裡加入的零件歸到第 i 個登記的外框零件（見上面的說明）
  inPart(i, fn) {
    const prev = this.cur;
    this.cur = i;
    fn();
    this.cur = prev;
    return this;
  }
  // 只有一種材質時直接回傳那個網格（呼叫端會改 castShadow 之類的）
  mesh(shadow = true) {
    const g = this.build(new THREE.Group(), shadow);
    if (g.children.length !== 1) return g;
    const m = g.children[0];
    g.remove(m);
    return m;
  }
}
// 一般網格組成的群組（地標等用 box()／cyl() 拼的模型）整個換成精細版：網格依矩陣放進 PK（基本形體升級、頂點色、
// 同類材質合併），原本的網格移除。o＝tintCtx 的選項（k＝之後才放大的倍率）。實例化、蒙皮、多重材質、著色器材質的網格不動
export function bakeGroup(root, o) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const k = new PK(o || PK_TINT);
  const rm = [];
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m.isSkinnedMesh || Array.isArray(m.material) || !m.geometry) return;
    if (!m.material || m.material.isShaderMaterial || m.material.isLineBasicMaterial) return;
    const mm = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    k.geoM(m.material, m.geometry, mm);
    rm.push(m);
  });
  for (const m of rm) m.parent.remove(m);
  return k.build(root);
}
// 合併網格：geometry.boundingBox 是登記的外框（可能比實際的三角形小），射線檢測時改用實際的三角形
class PropMesh extends THREE.Mesh {
  raycast(raycaster, intersects) {
    const bb = this.geometry.boundingBox;
    this.geometry.boundingBox = null;
    super.raycast(raycaster, intersects);
    this.geometry.boundingBox = bb;
  }
}
// ---------- 共用的機械細節（都畫進 PK）----------
// 警示條紋：長 len、高 hh 的板（底色 mk），上面斜向的 my 色條紋；面朝 +Z（板厚 0.04），ry 轉向
export function hazard(k, my, mk, len, hh, x, y, z, ry = 0, step = 0.6) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.box(mk, len, hh, 0.04, 0, 0, 0);
    const n = Math.max(1, Math.floor(len / step));
    const sk = hh * 0.6,
      bw = step * 0.5;
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + (len - n * step) / 2 + i * step + (step - bw - sk) / 2;
      k.quad(
        my,
        [x0, -hh / 2, 0.021],
        [x0 + bw, -hh / 2, 0.021],
        [x0 + bw + sk, hh / 2, 0.021],
        [x0 + sk, hh / 2, 0.021],
      );
    }
  });
  return k;
}
// 欄杆：長 len（沿 X）、高 hh；支柱間距約 step；ry 轉向
export function railing(k, m, len, hh, x, y, z, ry = 0, step = 2, t = 0.07) {
  k.at(x, y, z, 0, ry, 0, () => {
    const n = Math.max(1, Math.round(len / step));
    for (let i = 0; i <= n; i++) k.box(m, t, hh, t, -len / 2 + (len / n) * i, hh / 2, 0);
    k.box(m, len, t, t * 1.2, 0, hh, 0);
    k.box(m, len, t * 0.8, t * 0.8, 0, hh * 0.5, 0);
  });
  return k;
}
// 爬梯：高 hh、寬 0.5，面朝 +Z；rung＝橫檔間距
export function ladder(k, m, hh, x, y, z, ry = 0, rung = 0.5) {
  k.at(x, y, z, 0, ry, 0, () => {
    for (const s of [-1, 1]) k.box(m, 0.06, hh, 0.06, s * 0.25, hh / 2, 0);
    for (let v = rung; v < hh - 0.1; v += rung) k.box(m, 0.5, 0.04, 0.04, 0, v, 0);
  });
  return k;
}
// 鉚釘／螺栓：面朝 +Z 的小方塊排成一列
export function rivets(k, m, pts, s = 0.08) {
  for (const [x, y, z] of pts) k.box(m, s, s, s * 0.6, x, y, z);
  return k;
}
// 格柵：w × hh 的框＋n 條橫片，面朝 +Z
export function grille(k, frame, slat, w, hh, n, x, y, z, ry = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.box(frame, w + 0.08, hh + 0.08, 0.05, 0, 0, 0);
    for (let i = 0; i < n; i++)
      k.box(slat, w, (hh / n) * 0.45, 0.06, 0, -hh / 2 + (hh / n) * (i + 0.5), 0.02, -0.5);
  });
  return k;
}
// 桁架（沿 X 長 len、高 hh 的平面桁架：上下弦＋直桿＋斜桿），面在 XY 平面
export function truss(k, m, len, hh, x, y, z, ry = 0, t = 0.14, bay = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    const n = Math.max(1, Math.round(len / (bay || hh)));
    k.box(m, len, t, t, 0, hh / 2, 0);
    k.box(m, len, t, t, 0, -hh / 2, 0);
    for (let i = 0; i <= n; i++) k.box(m, t * 0.8, hh, t * 0.8, -len / 2 + (len / n) * i, 0, 0);
    for (let i = 0; i < n; i++) {
      const xa = -len / 2 + (len / n) * i,
        xb = xa + len / n;
      k.bar(m, [xa, i % 2 ? hh / 2 : -hh / 2, 0], [xb, i % 2 ? -hh / 2 : hh / 2, 0], t * 0.7);
    }
  });
  return k;
}
// ---------- 人的尺寸（docs/world-scale.md 第 2 節）：物件照現實尺寸，人會用到的細節一律照這些，不跟著機甲放大 ----------
export const HUMAN = {
  door: [0.9, 2.1], // 門 寬、高
  rail: 1.1, // 欄杆高
  rise: 0.18, // 樓梯級高
  run: 0.28, // 樓梯級深
  stairW: 1.1, // 樓梯寬
  ladderW: 0.45,
  rung: 0.3,
  walkW: 1.0, // 走道寬
  win: [1.2, 1.3, 0.9], // 窗 寬、高、窗台高
};
// 人的介面標記（之後的小人互動）：fn 裡用 k.mark('door_1', x, y, z, ry) 標出門、樓梯、爬梯、可以走的面，
// build 時加成名稱為該字串的空節點（不畫、不碰撞）
// 人用的門：門框＋門扇＋把手，面朝 +Z，(x, y, z) 是門底中心
export function door(k, frame, leaf, x, y, z, ry = 0, w = HUMAN.door[0], h = HUMAN.door[1], name) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.box(frame, w + 0.16, 0.1, 0.12, 0, h + 0.05, 0);
    for (const s of [-1, 1]) k.box(frame, 0.08, h, 0.12, s * (w / 2 + 0.04), h / 2, 0);
    k.box(leaf, w, h, 0.05, 0, h / 2, 0.02);
    k.box(DETAIL.steel, 0.12, 0.03, 0.05, w / 2 - 0.12, h * 0.48, 0.06);
    if (name) k.mark(name, 0, 0, 0.1, 0);
  });
  return k;
}
// 直跑樓梯：從 (x, y, z) 往 +Z 爬升 rise（級高、級深照人的尺寸），兩側側梁＋踏板＋一側扶手；回傳水平長度
export function stairs(k, m, rise, x, y, z, ry = 0, w = HUMAN.stairW, name) {
  const n = Math.max(1, Math.round(rise / HUMAN.rise)),
    r = rise / n,
    run = HUMAN.run,
    L = n * run;
  k.at(x, y, z, 0, ry, 0, () => {
    for (let i = 0; i < n; i++) k.box(m, w, 0.05, run * 1.05, 0, r * (i + 1) - 0.025, run * (i + 0.5));
    const a = Math.atan2(rise, L),
      len = Math.hypot(rise, L);
    for (const s of [-1, 1]) k.box(m, 0.06, 0.22, len, s * (w / 2 + 0.03), rise / 2, L / 2, -a, 0, 0);
    k.box(m, 0.04, 0.04, len, w / 2 + 0.03, rise / 2 + HUMAN.rail * 0.9, L / 2, -a, 0, 0);
    for (let i = 0; i <= Math.ceil(n / 6); i++) {
      const t = Math.min(1, i / Math.ceil(n / 6));
      k.box(m, 0.04, HUMAN.rail, 0.04, w / 2 + 0.03, rise * t + HUMAN.rail / 2, L * t);
    }
    if (name) k.mark(name, 0, 0, 0, 0);
  });
  return L;
}
// 人用的爬梯（hh 高、面朝 +Z）；cage：3 m 以上加護籠
export function humanLadder(k, m, hh, x, y, z, ry = 0, cage = hh > 3, name) {
  const w = HUMAN.ladderW;
  k.at(x, y, z, 0, ry, 0, () => {
    for (const s of [-1, 1]) k.box(m, 0.05, hh, 0.05, (s * w) / 2, hh / 2, 0);
    for (let v = HUMAN.rung; v < hh - 0.05; v += HUMAN.rung) k.box(m, w, 0.03, 0.03, 0, v, 0);
    if (cage)
      for (let v = 2.4; v < hh; v += 0.9) {
        k.box(m, w + 0.3, 0.03, 0.03, 0, v, 0.7);
        for (const s of [-1, 1]) k.box(m, 0.03, 0.03, 0.7, s * (w / 2 + 0.15), v, 0.35);
      }
    if (name) k.mark(name, 0, 0, 0.3, 0);
  });
  return k;
}
// 窗列：寬 len 的牆面（面朝 +Z）上每層一排窗；floors＝層數、fh＝樓層高；y0＝第一層地板高
export function windowRows(k, glass, frame, len, floors, fh, x, y0, z, ry = 0, gap = 1.2) {
  const [ww, wh, sill] = HUMAN.win;
  const n = Math.max(1, Math.floor((len - 1) / (ww + gap)));
  const sp = len / n;
  k.at(x, y0, z, 0, ry, 0, () => {
    for (let f = 0; f < floors; f++)
      for (let i = 0; i < n; i++) {
        const cx = -len / 2 + sp * (i + 0.5),
          cy = f * fh + sill + wh / 2;
        k.box(glass, ww, wh, 0.05, cx, cy, 0.02);
        k.box(frame, ww + 0.1, 0.08, 0.1, cx, cy - wh / 2 - 0.04, 0.04);
      }
  });
  return k;
}

// 共用的細節材質（不透明、各地圖共用一份；不會隨遮擋半透明，所以只用在小零件）
export const DETAIL = {
  get yellow() {
    return mat(0xd8a020, { roughness: 0.6, metalness: 0.2 });
  },
  get black() {
    return mat(0x1e2023, { roughness: 0.8 });
  },
  get steel() {
    return mat(0x5a6068, { roughness: 0.5, metalness: 0.6 });
  },
  get dark() {
    return mat(0x2a2d31, { roughness: 0.7, metalness: 0.4 });
  },
  get glass() {
    return mat(0x1c2a33, { roughness: 0.15, metalness: 0.6 });
  },
  get lamp() {
    return mat(0xfff2c8, { emissive: 0xa08a50, roughness: 0.4 });
  },
  get red() {
    return mat(0xff4030, { emissive: 0xa01810, roughness: 0.3 });
  },
  get rubber() {
    return mat(0x1c1e20, { roughness: 0.9 });
  },
  get white() {
    return mat(0xe6e8ea, { roughness: 0.5 });
  },
};

// 方格主題的高柱方塊（含邊線）；原點在底面中心下方 h/2（呼叫端設定位置）
export function buildGridPillar(w, h, d, baseMat) {
  const glb = propGlb('grid_pillar', {
    color: baseMat.color.getHex(),
    ref: [5, 13, 5],
    size: [w, h, d],
    y: -h / 2,
    fade: true,
  });
  if (glb) return { mesh: glb, mat: null };
  const m2 = baseMat.clone();
  m2.transparent = true;
  // 中心在原點：倒角的柱身（略內縮）＋底座與頂部的外框帶；面板接縫用線
  const k = new PK();
  const bh = Math.min(0.6, h * 0.12),
    th = Math.min(0.4, h * 0.08);
  k.cb(m2, w - 0.16, h - bh - th, d - 0.16, 0, (bh - th) / 2, 0, 0, 0, 0, 0.12);
  k.cb(m2, w, bh, d, 0, -h / 2 + bh / 2, 0, 0, 0, 0, 0.06);
  k.cb(m2, w, th, d, 0, h / 2 - th / 2, 0, 0, 0, 0, 0.06);
  const g = k.build();
  g.position.y = h / 2;
  const pts = [];
  const ring = (y, hw, hd) => {
    const c = [
      [-hw, -hd],
      [hw, -hd],
      [hw, hd],
      [-hw, hd],
    ];
    for (let i = 0; i < 4; i++) pts.push(c[i][0], y, c[i][1], c[(i + 1) % 4][0], y, c[(i + 1) % 4][1]);
  };
  const hw = w / 2 - 0.075,
    hd = d / 2 - 0.075;
  for (let y = -h / 2 + bh + 3; y < h / 2 - th - 1; y += 3) ring(y, hw + 0.01, hd + 0.01);
  ring(-h / 2 + bh, w / 2, d / 2);
  ring(h / 2 - th, w / 2, d / 2);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(
    new THREE.LineSegments(
      lg,
      new THREE.LineBasicMaterial({ color: 0x7a8290, transparent: true, opacity: 0.5 }),
    ),
  );
  return { mesh: g, mat: m2 };
}

// 貨櫃的現實尺寸（ISO）：20 呎 6.06 × 2.44 × 2.59 m、40 呎 12.19 m；疊放時上下相接
export const ISO = { L20: 6.06, L40: 12.19, W: 2.44, H: 2.59 };
// 貨櫃：箱體＋兩道框＋上下邊條；rot 為真時長邊沿 Z 軸（GLB 以長邊沿 X 製作，rot 時轉 90°）
export function buildContainer(w, h, d, rot, cm, fm) {
  const glb = propGlb('container', {
    color: cm.color.getHex(),
    ref: [ISO.L40, ISO.H, ISO.W],
    size: rot ? [d, h, w] : [w, h, d],
    rotY: rot ? Math.PI / 2 : 0,
    fade: true,
  });
  if (glb) return glb;
  const L = rot ? d : w,
    D = rot ? w : d;
  const k = new PK();
  // 外框同原本的程式模型（兩道框＋上下邊條）
  for (const t of [-0.35, 0.35])
    k.ob(rot ? w + 0.1 : 0.3, h + 0.1, rot ? 0.3 : d + 0.1, rot ? 0 : t * w, h / 2, rot ? t * d : 0);
  for (const y of [h, 0.1]) k.ob(w + 0.08, 0.2, d + 0.08, 0, y, 0);
  k.at(0, 0, 0, 0, rot ? Math.PI / 2 : 0, 0, () => containerKit(k, L, h, D, cm, fm));
  return k.build();
}
// 疊放的貨櫃堆（現實尺寸）：rows 排（沿 Z 並排，間隔 gap）× levels 層，長邊沿 X；cms[i]＝第 i 個貨櫃的材質
// （i＝排 × levels＋層，呼叫端決定顏色）；tops[r]＝第 r 排的層數（沒給時一律 levels）；cols＝沿 X 接幾個貨櫃
// （同一堆合併成少數網格）。原點在底面中心。回傳 { group, w, d, h }：碰撞用的整堆外框（h＝最高的那排）
export function buildContainerStack(L, rows, levels, cms, fm, tops = null, gap = 0.3, cols = 1) {
  const D = ISO.W,
    H = ISO.H,
    dd = rows * D + (rows - 1) * gap,
    ww = cols * L + (cols - 1) * gap;
  let top = 0;
  for (let r = 0; r < rows; r++) top = Math.max(top, tops ? tops[r] : levels);
  const glb0 = propGlb('container', { color: cms[0].color.getHex(), ref: [ISO.L40, H, D], size: [L, H, D] });
  if (glb0) {
    const g = new THREE.Group();
    for (let c = 0; c < cols; c++)
      for (let r = 0; r < rows; r++)
        for (let lv = 0; lv < (tops ? tops[r] : levels); lv++) {
          const o = propGlb('container', {
            color: cms[(c + r * levels + lv) % cms.length].color.getHex(),
            ref: [ISO.L40, H, D],
            size: [L, H, D],
            fade: true,
          });
          o.position.set(-ww / 2 + L / 2 + c * (L + gap), lv * H, -dd / 2 + D / 2 + r * (D + gap));
          g.add(o);
        }
    return { group: g, w: ww, d: dd, h: top * H };
  }
  const k = new PK().bounds(-ww / 2, 0, -dd / 2, ww / 2, top * H, dd / 2);
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++)
      for (let lv = 0; lv < (tops ? tops[r] : levels); lv++)
        k.at(-ww / 2 + L / 2 + c * (L + gap), lv * H, -dd / 2 + D / 2 + r * (D + gap), 0, 0, 0, () =>
          containerLite(k, L, H, D, cms[(c + r * levels + lv) % cms.length], fm),
        );
  return { group: k.build(), w: ww, d: dd, h: top * H };
}
// 一個貨櫃的造型（長邊沿 X、L 長、D 寬、h 高，原點在底面中心）：角柱＋上下框＋波紋側板＋一端的門（門閂）
// 貨櫃堆用的簡化貨櫃（箱體＋角柱＋上下框＋門閂，約 120 個三角形）：堆裡的貨櫃看不到波紋細節，三角形數少很多
function containerLite(k, L, h, D, cm, fm) {
  k.box(cm, L - 0.12, h - 0.3, D - 0.16, 0, h / 2, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(fm, 0.2, h, 0.2, sx * (L / 2 - 0.1), h / 2, sz * (D / 2 - 0.1));
  for (const y of [0.09, h - 0.09]) {
    k.box(fm, L, 0.18, D, 0, y, 0);
  }
  for (const z of [-D * 0.24, D * 0.24]) k.box(fm, 0.05, h - 0.4, 0.05, L / 2 - 0.02, h / 2, z);
  // 波紋側板的肋（小細節：遠處隱藏）
  k.fine(() => {
    const n = Math.max(4, Math.round((L - 0.5) / 0.62)),
      sp = (L - 0.5) / n;
    for (const sz of [-1, 1])
      for (let i = 0; i < n; i++)
        k.box(cm, sp * 0.4, h - 0.42, 0.05, -L / 2 + 0.25 + sp * (i + 0.5), h / 2, sz * (D / 2 - 0.05));
  });
}
function containerKit(k, L, h, D, cm, fm) {
  {
    const bx = L / 2 - 0.06,
      bz = D / 2 - 0.08;
    k.box(cm, bx * 2, h - 0.3, bz * 2, 0, h / 2, 0);
    // 角柱與上下框
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) k.box(fm, 0.2, h, 0.2, sx * (L / 2 - 0.1), h / 2, sz * (D / 2 - 0.1));
    for (const y of [0.09, h - 0.09]) {
      for (const sz of [-1, 1]) k.box(fm, L, 0.18, 0.16, 0, y, sz * (D / 2 - 0.08));
      for (const sx of [-1, 1]) k.box(fm, 0.16, 0.18, D - 0.3, sx * (L / 2 - 0.08), y, 0);
    }
    k.box(fm, L - 0.3, 0.05, D - 0.3, 0, h - 0.05, 0); // 頂板
    // 波紋側板：外凸的梯形肋（正面＋兩個斜面，上下藏在框裡）
    const y0 = 0.18,
      y1 = h - 0.18,
      n = Math.max(4, Math.round((L - 0.5) / 0.62)),
      sp = (L - 0.5) / n;
    for (const sz of [-1, 1])
      for (let i = 0; i < n; i++) {
        const xc = -L / 2 + 0.25 + sp * (i + 0.5),
          a = sp * 0.22,
          b = sp * 0.32,
          zi = sz * bz,
          zo = sz * (bz + 0.06);
        const F = (x0, z0, x1, z1) =>
          sz > 0
            ? k.quad(cm, [x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0])
            : k.quad(cm, [x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1]);
        F(xc - b, zi, xc - a, zo);
        F(xc - a, zo, xc + a, zo);
        F(xc + a, zo, xc + b, zi);
      }
    // 門（+X 端）：中縫＋四支門閂＋把手
    const xd = L / 2 - 0.03;
    k.box(fm, 0.04, h - 0.36, 0.05, xd, h / 2, 0);
    for (const z of [-D * 0.36, -D * 0.12, D * 0.12, D * 0.36]) {
      k.box(fm, 0.05, h - 0.4, 0.05, xd, h / 2, z);
      k.box(fm, 0.07, 0.07, 0.2, xd, h * 0.45, z + 0.08);
    }
    // 前端（−X）的橫向加強板
    for (const y of [h * 0.35, h * 0.65]) k.box(fm, 0.04, 0.08, D - 0.4, -xd, y, 0);
  }
}

// 岩石（十二面體，縮放與旋轉由呼叫端決定）
// GLB：代表尺寸是半徑 3 的岩石再縮放 (1.15, 0.75, 1.15)，原點在岩石中心
export function buildRock(r, m) {
  const glb = propGlb('rock', {
    color: m.color.getHex(),
    ref: [3 * 1.15, 3 * 0.75, 3 * 1.15],
    size: [r, r, r],
    fade: true,
  });
  if (glb) return glb;
  // 雜訊岩石（render/detail.js 的 D.rock）：形狀依尺寸決定（24 種），大的細分多一層
  // 呼叫端會改 scale，所以半徑放進幾何（複本）
  const geo = D.rock(rockSeed(r), r > 5 ? 6 : 3, 0.35, 0.45, 0.3).clone();
  geo.scale(r, r, r);
  const mesh = new THREE.Mesh(geo, vcMat(m));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 柱子／路燈桿（中心在原點；GLB 原點在底面中心、以高 7 m 製作）
export function buildLampPost(h, m) {
  const glb = propGlb('lamp_post', { color: m.color.getHex(), ref: [1, 7, 1], size: [1, h, 1], y: -h / 2 });
  if (glb) return glb;
  // 底座（螺栓）＋八角桿＋配電箱＋頂部懸臂燈
  const k = new PK(),
    b = -h / 2;
  k.ob(0.6, h, 0.6); // 外框同原本（0.6 見方的柱）；頂部的懸臂在外框之外
  k.cb(m, 0.6, 0.35, 0.6, 0, b + 0.175, 0, 0, 0, 0, 0.06);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(DETAIL.steel, 0.07, 0.08, 0.07, sx * 0.22, b + 0.38, sz * 0.22);
  k.cyl(m, 0.2, 0.28, h - 0.6, 0, b + 0.35 + (h - 0.6) / 2, 0);
  k.cb(m, 0.36, 0.5, 0.1, 0, b + 1.6, 0.25, 0, 0, 0, 0.03);
  k.box(DETAIL.yellow, 0.37, 0.06, 0.11, 0, b + 1.75, 0.25);
  k.cyl(m, 0.24, 0.24, 0.25, 0, h / 2 - 0.4, 0);
  k.bar(m, [0, h / 2 - 0.35, 0], [0.75, h / 2 - 0.15, 0], 0.1);
  k.cb(m, 0.6, 0.16, 0.34, 0.85, h / 2 - 0.12, 0, 0, 0, 0.1, 0.04);
  k.box(DETAIL.lamp, 0.46, 0.04, 0.24, 0.86, h / 2 - 0.21, 0, 0, 0, 0.1);
  return k.build();
}
// 散落碎塊（中心在原點；GLB 原點在底面中心、以 0.75 × 0.35 × 0.75 m 製作）：碎板＋折斷的鋼樑頭
export function buildDebris(w, h, d, m) {
  const glb = propGlb('debris', {
    color: m.color.getHex(),
    ref: [0.75, 0.35, 0.75],
    size: [w, h, d],
    y: -h / 2,
  });
  if (glb) return glb;
  const k = new PK().ob(w, h, d);
  k.cb(m, w * 0.8, h * 0.55, d * 0.85, -w * 0.08, -h * 0.2, 0, 0, 0.3, 0.06, Math.min(w, d) * 0.08);
  k.box(m, w * 0.55, h * 0.22, h * 0.22, w * 0.18, h * 0.3, -d * 0.1, 0, -0.5, 0.25);
  k.box(m, w * 0.3, h * 0.35, d * 0.3, w * 0.3, -h * 0.25, d * 0.3, 0.2, 0.7, 0);
  return k.mesh();
}

// 路邊停放的卡車：車廂＋駕駛艙＋6 輪
export function buildParkedTruck(cm) {
  const glb = propGlb('parked_truck', { color: cm.color.getHex(), fade: true });
  if (glb) return glb;
  const k = new PK();
  const cab = mat(0xe6e6e6).clone(),
    D = DETAIL;
  // 外框同原本（車廂＋駕駛艙＋6 輪）
  k.ob(3, 2.4, 7, 0, 1.6, 0).ob(3, 1.6, 2.2, 0, 1.2, -4.4);
  for (const sx of [-1.4, 1.4])
    for (const sz of [-3.8, -1.5, 2.2]) k.obCyl(0.6, 0.6, 0.5, sx, 0.6, sz, 0, 0, Math.PI / 2);
  // 呼叫端會任意旋轉：零件分到原本的零件上（車廂 0、駕駛艙 1、車輪 2～7）
  k.cur = 0;
  // 底盤
  for (const sx of [-0.55, 0.55]) k.box(D.dark, 0.18, 0.28, 8.6, sx, 0.62, -0.95);
  // 貨廂：倒角箱＋側面加強肋＋後門
  k.cb(cm, 2.94, 2.3, 6.9, 0, 1.63, 0, 0, 0, 0, 0.08);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) k.box(cm, 0.05, 2.1, 0.12, sx * 1.48, 1.63, -3 + i * 1.2);
    k.box(D.dark, 0.06, 0.12, 6.9, sx * 1.47, 0.55, 0);
  }
  k.box(D.dark, 0.04, 2.1, 0.05, 0, 1.63, 3.46);
  for (const sx of [-0.9, -0.3, 0.3, 0.9]) k.box(D.steel, 0.06, 1.9, 0.05, sx, 1.63, 3.47);
  k.box(D.yellow, 2.8, 0.12, 0.05, 0, 0.6, 3.47);
  // 駕駛艙：側面輪廓（斜擋風玻璃）沿 X 擠出
  k.cur = 1;
  k.prism(
    cab,
    [
      [3.32, 0.42],
      [5.45, 0.42],
      [5.45, 1.32],
      [5.15, 2.12],
      [3.32, 2.2],
    ],
    2.9,
    0,
    0,
    0,
    0,
    Math.PI / 2,
    0,
  );
  k.cur = 0;
  k.quad(D.glass, [1.25, 1.42, -5.43], [-1.25, 1.42, -5.43], [-1.25, 2.0, -5.21], [1.25, 2.0, -5.21]);
  for (const sx of [-1, 1]) k.box(D.glass, 0.04, 0.6, 1.1, sx * 1.46, 1.7, -4.35);
  k.box(D.dark, 2.95, 0.3, 0.12, 0, 0.55, -5.44); // 保險桿
  k.box(D.dark, 1.6, 0.5, 0.05, 0, 1.0, -5.47); // 水箱護罩
  for (const sx of [-1.1, 1.1]) k.box(D.lamp, 0.4, 0.18, 0.05, sx, 0.95, -5.47);
  k.cyl(D.steel, 0.07, 0.07, 1.4, 1.25, 2.05, -3.25); // 排氣管
  k.cyl(D.steel, 0.28, 0.28, 0.9, -1.25, 0.65, -2.4, Math.PI / 2, 0, 0, 10); // 油箱
  // 車輪
  let wi = 2;
  for (const sx of [-1.4, 1.4])
    for (const sz of [-3.8, -1.5, 2.2]) {
      k.cyl(D.steel, 0.3, 0.3, 0.5, sx, 0.6, sz, 0, 0, Math.PI / 2, 8);
      k.inPart(wi++, () => k.cyl(D.rubber, 0.6, 0.6, 0.48, sx, 0.6, sz, 0, 0, Math.PI / 2, 12));
    }
  return k.build();
}

// 高架板（橋面／高架橋／掩體頂）：板＋兩側護欄；原點在板頂面
// GLB 以 8 × 0.7 × 20 m（護欄沿 X）製作；rotY 時護欄沿 Z，轉 90°
export function buildDeck(w, d, thick, rotY, mats) {
  const glb = propGlb('deck', {
    color: mats.deck.color.getHex(),
    ref: [8, 0.7, 20],
    size: rotY ? [d, thick, w] : [w, thick, d],
    rotY: rotY ? Math.PI / 2 : 0,
    fade: true,
  });
  if (glb) return { group: glb, dm: null, rm: null };
  const dm = mats.deck.clone();
  dm.transparent = true;
  const rm = mats.rail.clone();
  rm.transparent = true;
  const k = new PK().bounds(-w / 2, -thick, -d / 2, w / 2, 0.9, d / 2);
  deckKit(k, dm, rm, rotY ? d : w, rotY ? w : d, thick, rotY);
  return { group: k.build(), dm, rm };
}
// 橋面板的共用造型（長邊沿 X 建造，rotY 時轉 90°）：面板＋板下縱梁與橫隔板＋混凝土護欄座＋鋼欄杆＋伸縮縫
function deckKit(k, dm, rm, L, D, thick, rotY) {
  k.at(0, 0, 0, 0, rotY ? Math.PI / 2 : 0, 0, () => {
    const tp = thick * 0.6,
      gh = thick - tp;
    k.cb(dm, L, tp, D, 0, -tp / 2, 0, 0, 0, 0, Math.min(0.12, tp * 0.3));
    const ng = Math.max(2, Math.round(D / 3));
    for (let i = 0; i < ng; i++)
      k.box(dm, L - 0.4, gh, 0.45, 0, -tp - gh / 2, -D / 2 + 0.5 + ((D - 1) / (ng - 1)) * i);
    for (const sx of [-1, 1]) k.box(dm, 0.35, gh * 0.8, D - 1, sx * (L / 2 - 0.4), -tp - gh * 0.4, 0);
    for (const s of [-1, 1]) {
      const z = s * (D / 2 - 0.18);
      k.cb(rm, L, 0.45, 0.36, 0, 0.225, z, 0, 0, 0, 0.06);
      railing(k, rm, L - 0.2, 0.41, 0, 0.45, s * (D / 2 - 0.12), 0, 2.2, 0.08);
    }
    for (const sx of [-1, 1]) k.box(rm, 0.25, 0.03, D - 0.8, sx * (L / 2 - 0.5), 0.012, 0);
  });
}
export const deckMats = () => ({
  deck: mat(0x6a6f77, { roughness: 0.85, metalness: 0.2 }),
  rail: mat(0x3a3d42),
  pillar: mat(0x4a4f57, { roughness: 0.9 }),
});

// 支柱（下粗上細的圓柱）：原點在底面中心（呼叫端會把位置改到中心；GLB 以半徑 0.6、高 6 m 製作）
export function buildPillar(r, h, m) {
  const glb = propGlb('pillar', { color: m.color.getHex(), ref: [0.6, 6, 0.6], size: [r, h, r], y: -h / 2 });
  if (glb) return glb;
  // 中心在原點：基礎墩＋八角柱身＋頂部的支承塊與鋼墊
  const k = new PK().bounds(-r * 1.15, -h / 2, -r * 1.15, r * 1.15, h / 2, r * 1.15);
  const fb = Math.min(0.6, h * 0.12),
    cp = Math.min(0.55, h * 0.1);
  k.cyl(m, r * 1.12, r * 1.15, fb, 0, -h / 2 + fb / 2, 0, 0, 0, 0, 8);
  k.cyl(m, r, r * 1.12, h - fb - cp, 0, (fb - cp) / 2, 0, 0, Math.PI / 8, 0, 8);
  k.cb(m, r * 2, cp, r * 2, 0, h / 2 - cp / 2, 0, 0, 0, 0, 0.08);
  k.cyl(DETAIL.dark, r * 1.03, r * 1.03, 0.12, 0, h / 2 - cp - 0.3, 0, 0, Math.PI / 8, 0, 8);
  const g = k.build();
  g.position.y = h / 2;
  return g;
}

// 隧道口：牆面＋拱頂＋黑洞＋門柱＋背後山體；原點在地面中心，開口朝 −Z
export function buildTunnelPortal(rockColor) {
  const glb = propGlb('tunnel_portal', { color: rockColor });
  if (glb) return glb;
  const k = new PK();
  const dm = mat(0x5b5f66, { roughness: 0.95 }),
    fr = mat(0x3d4147),
    li = mat(0x8a8f96);
  k.bounds(-12, -2, -11, 12, 12, 1.5); // 外框同原本（山體＋門柱）
  portalKit(k, dm, fr, li);
  k.cb(mat(rockColor, { roughness: 1 }), 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
  return k.build();
}
export const HOLE = new THREE.MeshBasicMaterial({ color: 0x07080a });
// 隧道口的共用造型：混凝土頭牆＋壓頂＋鋼門框（警示條紋）＋兩端的扶壁＋通風格柵＋燈；開口 8 × 6.5
function portalKit(k, wall, frame, lintel) {
  const D = DETAIL;
  k.cb(wall, 14, 9, 2.5, 0, 4.5, 0, 0, 0, 0, 0.15);
  k.cb(lintel, 14.4, 0.5, 2.9, 0, 9.05, 0, 0, 0, 0, 0.1);
  k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
  for (const sx of [-1, 1]) {
    k.cb(frame, 1.4, 7, 3, sx * 4.7, 3.5, 0, 0, 0, 0, 0.12);
    for (const y of [1.6, 3.6, 5.6]) k.box(D.steel, 1.0, 0.12, 0.06, sx * 4.7, y, 1.47);
    // 頭牆兩端的扶壁（上端斜切）
    k.prism(
      wall,
      [
        [-0.5, 0],
        [0.5, 0],
        [0.5, 7.8],
        [-0.5, 8.6],
      ],
      0.25,
      sx * 6.5,
      0,
      1.37,
    );
    grille(k, frame, D.dark, 0.45, 2.2, 6, sx * 5.72, 4.4, 1.27);
    k.box(D.lamp, 0.7, 0.22, 0.2, sx * 2.6, 8.2, 1.33);
  }
  k.cb(lintel, 10, 0.9, 2.7, 0, 7.45, 0, 0, 0, 0, 0.08);
  hazard(k, D.yellow, D.black, 9.4, 0.5, 0, 7.45, 1.36);
  k.box(D.dark, 3.2, 0.7, 0.08, 0, 8.4, 1.29);
}

// ---------- 公路／鐵路 ----------
// 路面帶：[左緣, 右緣, 顏色, 粗糙度, 離地高度]（相對走廊中心線）
export const ROAD_STRIPS = [
  [-5, 5, 0x3a3d42, 0.9, 0.06],
  [-5.2, -4.8, 0xd8d8d0, 0.8, 0.02],
  [4.8, 5.2, 0xd8d8d0, 0.8, 0.02],
];
export const RAIL_STRIPS = [
  [-4.5, 4.5, 0x6e6558, 1, 0.02],
  [-1.6, -1.3, 0x9aa0a8, 0.4, 0.16],
  [1.3, 1.6, 0x9aa0a8, 0.4, 0.16],
];
// 沿線重複的小物件：公路中線標線、鐵路枕木
export const LANE_MARK = { w: 0.3, h: 0.05, d: 3.2, color: 0xe8d070, step: 8, y: 0.09 };
export const RAIL_TIE = { w: 4.2, h: 0.12, d: 0.5, color: 0x4a3b2e, step: 1.6, y: 0.06 };
export const corridorPiece = (P) => box(P.w, P.h, P.d, mat(P.color));

// 由兩條等長的點列（左緣、右緣）組成帶狀網格
export function stripMesh(A, B, color, rough, y) {
  const pos = [];
  for (let i = 0; i < A.length - 1; i++) {
    const a = A[i],
      b = B[i],
      c2 = A[i + 1],
      d = B[i + 1];
    pos.push(
      a.x,
      a.y + y,
      a.z,
      b.x,
      b.y + y,
      b.z,
      c2.x,
      c2.y + y,
      c2.z,
      b.x,
      b.y + y,
      b.z,
      d.x,
      d.y + y,
      d.z,
      c2.x,
      c2.y + y,
      c2.z,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat(color, { roughness: rough }));
  m.receiveShadow = true;
  return m;
}

// 模型庫用：平地上一段直線公路或鐵路（長 len，沿 Z 軸）
export function buildCorridorSegment(kind, len) {
  const g = new THREE.Group();
  const line = (u) => {
    const out = [];
    for (let s = -len / 2; s <= len / 2 + 1e-6; s += 2) out.push(new THREE.Vector3(u, 0.06, s));
    return out;
  };
  for (const [u0, u1, color, rough, y] of kind === 'road' ? ROAD_STRIPS : RAIL_STRIPS)
    g.add(stripMesh(line(u0), line(u1), color, rough, y));
  const P = kind === 'road' ? LANE_MARK : RAIL_TIE;
  for (let s = -len / 2; s < len / 2; s += P.step) {
    const m = corridorPiece(P);
    m.position.set(0, P.y, s);
    g.add(m);
  }
  return g;
}

// ---------- 荒涼工業荒野（wasteland）：斗輪採掘機殘骸、輸送管線、鑽井架 ----------
// 透明材質（擋住鏡頭時半透明）
export const fadeMat = (color, opts) => {
  const m = mat(color, opts).clone();
  m.transparent = true;
  return m;
};
const lerpN = (a, b, t) => a + (b - a) * t;
// 斗輪採掘機殘骸：原點在地面中心，斗輪臂朝 −Z。body＝機身碰撞箱（寬、頂高、長，中心在原點），
// 斗輪中心在 (0, wheelY, wheelZ)、半徑 wheelR（呼叫端以圓柱碰撞）
// 現實尺寸（地標）：舊模型放大 RIG_S 倍（長約 140、高約 44 m）；欄杆與爬梯照人的尺寸
const RIG_S = 4;
const R0 = { body: [8.2, 7.4, 11], wheelZ: -15.6, wheelY: 4.3, wheelR: 4.6 };
export const MINING_RIG = {
  body: R0.body.map((v) => v * RIG_S),
  wheelZ: R0.wheelZ * RIG_S,
  wheelY: R0.wheelY * RIG_S,
  wheelR: R0.wheelR * RIG_S,
};
export function buildMiningRig(color) {
  const glb = propGlb('mining_rig', { color, fade: true });
  if (glb) return glb;
  const main = fadeMat(color, { roughness: 0.8, metalness: 0.35 }),
    dark = fadeMat(0x2f2a26, { roughness: 0.9 }),
    rust = fadeMat(0x7a3f22, { roughness: 0.95 });
  const k = new PK();
  // 機身頂（舊尺寸 y 3.2＋4.2）的欄杆、機身側面上到頂的爬梯（人的尺寸）
  const top = (3.2 + 4.2) * RIG_S;
  k.at(0, 0, 0.5 * RIG_S, 0, 0, 0.05, () => {
    railing(k, rust, 7.6 * RIG_S, HUMAN.rail, 0, top, -4.3 * RIG_S, 0, 1.5, 0.06);
    railing(k, rust, 8.4 * RIG_S, HUMAN.rail, -3.8 * RIG_S, top, 0, Math.PI / 2, 1.5, 0.06);
    humanLadder(k, rust, top, -4.05 * RIG_S - 0.05, 0, 3 * RIG_S, -Math.PI / 2, true, 'ladder_rig');
    k.mark('walk_rig', 0, top, 0, 0);
  });
  k.scaled(RIG_S, () => rigKit(k, main, dark, rust));
  return k.build();
}
function rigKit(k, main, dark, rust) {
  const R = R0,
    D = DETAIL;
  k.bounds(-4.205, -1.663, -21.563, 4.1, 11.008, 14.163); // 外框同原本
  // 履帶：倒角的履帶架＋履帶板的橫紋＋惰輪
  for (const sx of [-1, 1]) {
    k.cb(dark, 2.6, 2.2, 11, sx * 2.8, 1.1, 0, 0, 0, 0, 0.5);
    for (let i = 0; i < 13; i++) k.box(dark, 2.66, 0.12, 0.3, sx * 2.8, 2.2, -4.9 + i * 0.82);
    for (const z of [-4.6, 4.6]) k.cyl(rust, 0.75, 0.75, 2.7, sx * 2.8, 1.1, z, 0, 0, Math.PI / 2, 10);
  }
  k.box(dark, 6, 1.2, 8, 0, 2.6, 0);
  // 機身（略傾斜）：箱體＋機房＋機房窗＋屋頂欄杆＋爬梯＋排氣
  k.at(0, 3.2, 0.5, 0, 0, 0.05, () => {
    k.cb(main, 8, 4.2, 9, 0, 2.1, 0, 0, 0, 0, 0.25);
    for (const z of [-3, 0, 3]) k.box(rust, 8.08, 0.2, 0.3, 0, 3.3, z);
    k.cb(main, 5, 2.2, 4, 0, 5.3, 2, 0, 0, 0, 0.18);
    k.box(D.glass, 4.2, 0.7, 0.06, 0, 5.6, -0.02);
    k.box(rust, 5.2, 0.4, 4.2, 0, 6.5, 2);
    k.box(rust, 1.1, 1.1, 8, 2.6, 4.7, -0.5);
    grille(k, dark, rust, 2.4, 1.4, 5, -1.8, 2.2, 4.52);
    k.cyl(dark, 0.3, 0.35, 1.6, -1.6, 7.2, 3.2);
  });
  // 斗輪臂：從機身前上方斜向下伸到斗輪（箱形樑＋兩側的桁架板）
  k.at(0, 6.4, -3.5, 0.18, 0, 0, () => {
    k.cb(main, 1.8, 1.6, 12.5, 0, 0, -6.25, 0, 0, 0, 0.2);
    for (const sx of [-1, 1]) {
      k.box(rust, 0.3, 0.3, 12, sx * 0.9, 2.4, -6);
      for (let i = 0; i < 5; i++) {
        const z0 = -0.6 - i * 2.3;
        k.box(rust, 0.25, 1.6, 0.25, sx * 0.9, 1.6, z0);
        k.bar(rust, [sx * 0.9, 0.8, z0], [sx * 0.9, 2.4, z0 - 2.3], 0.2);
      }
    }
    k.pipe(dark, [0.6, 1.0, -0.5], [0.6, 1.0, -11.5], 0.12);
  });
  // 斗輪：軸沿 X
  k.at(0, R.wheelY, R.wheelZ, 0.4, 0, 0, () => {
    k.geo(main, new THREE.TorusGeometry(R.wheelR - 0.5, 0.45, 6, 20), 0, 0, 0, 0, Math.PI / 2, 0);
    k.cyl(dark, 0.9, 0.9, 2.2, 0, 0, 0, 0, 0, Math.PI / 2, 10);
    k.cyl(rust, 1.3, 1.3, 0.3, 0, 0, 0, 0, 0, Math.PI / 2, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2,
        s = Math.sin(a),
        c = Math.cos(a);
      // 挖斗：斜口的箱＋三顆斗齒
      k.cb(rust, 1.6, 1.3, 1.3, 0, s * R.wheelR, c * R.wheelR, -a, 0, 0, 0.18);
      for (const tx of [-0.5, 0, 0.5])
        k.at(0, s * R.wheelR, c * R.wheelR, -a, 0, 0, () => k.box(dark, 0.18, 0.18, 0.4, tx, 0.45, 0.75));
      if (i % 2 === 0)
        k.box(dark, 0.3, 0.3, R.wheelR - 0.6, 0, s * (R.wheelR / 2), c * (R.wheelR / 2), -a, 0, 0);
    }
  });
  // 配重臂
  k.at(0, 7.2, 4.5, 0.22, 0, 0, () => {
    k.cb(main, 1.4, 1.2, 8, 0, 0, 4, 0, 0, 0, 0.15);
    k.cb(dark, 4, 3, 3, 0, -0.6, 8.2, 0, 0, 0, 0.3);
    k.box(rust, 4.06, 0.3, 3.06, 0, 0.4, 8.2);
  });
}

// 輸送管線一段（沿 Z，長 PIPE.seg）：原點在管子中心
export const PIPE = { seg: 9, r: 0.8 };
export function buildPipeSegment(color) {
  const glb = propGlb('pipeline', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.55, metalness: 0.55 }),
    fl = fadeMat(0x3b3631, { roughness: 0.8 });
  const k = new PK(),
    R = PIPE.r,
    X = Math.PI / 2;
  k.bounds(-R - 0.15, -R - 0.15, -PIPE.seg / 2, R + 0.15, R + 0.15, PIPE.seg / 2);
  k.cyl(m, R, R, PIPE.seg, 0, 0, 0, X, 0, 0, 12);
  for (const s of [-1, 1]) {
    const z = s * (PIPE.seg / 2 - 0.2);
    k.cyl(fl, R + 0.15, R + 0.15, 0.35, 0, 0, z, X, 0, 0, 12);
    k.cyl(fl, R + 0.06, R + 0.06, 0.5, 0, 0, z - s * 0.4, X, 0, 0, 12);
    k.cyl(fl, R + 0.03, R + 0.03, 0.1, 0, 0, s * 1.4, X, 0, 0, 12); // 保溫層接縫
  }
  // 上方的電纜槽
  k.box(fl, 0.3, 0.08, PIPE.seg - 1.6, 0, R + 0.09, 0);
  return k.build();
}
// 整條輸送管線（沿 Z、長 len，置中）：合併成一個網格（每段一個 GLB 時改成逐段排列）；每 PIPE.seg 一組法蘭、上方電纜槽
export function buildPipeline(len, color) {
  const n = Math.max(1, Math.round(len / PIPE.seg));
  if (providedModel('prop/pipeline', null, true)) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const s = buildPipeSegment(color);
      s.position.z = -len / 2 + PIPE.seg * (i + 0.5);
      g.add(s);
    }
    return g;
  }
  const m = fadeMat(color, { roughness: 0.55, metalness: 0.55 }),
    fl = fadeMat(0x3b3631, { roughness: 0.8 });
  const k = new PK(),
    R = PIPE.r,
    X = Math.PI / 2;
  k.cyl(m, R, R, len, 0, 0, 0, X, 0, 0, 12);
  for (let i = 0; i <= n; i++) {
    const z = -len / 2 + PIPE.seg * i;
    k.cyl(fl, R + 0.15, R + 0.15, 0.35, 0, 0, z, X, 0, 0, 12);
    k.cyl(fl, R + 0.06, R + 0.06, 0.5, 0, 0, z + (i < n ? 0.4 : -0.4), X, 0, 0, 12);
  }
  k.box(fl, 0.3, 0.08, len - 1, 0, R + 0.09, 0);
  return k.build();
}
// 管線支架（A 字形）：原點在底面中心，高 h（到管子底部）；GLB 以高 6 m 製作，依高度縮放
export function buildPipeSupport(h, color) {
  const glb = propGlb('pipe_support', { color, ref: [3, 6, 0.6], size: [3, h, 0.6] });
  if (glb) return glb;
  const m = mat(color, { roughness: 0.85 });
  const k = new PK();
  // 外框同原本（兩支斜腳＋頂部橫樑）
  const th = Math.atan2(0.9, h);
  for (const s of [-1, 1]) k.ob(0.35, Math.hypot(h, 0.9), 0.4, s * 0.95, h / 2, 0, 0, 0, s * th);
  k.ob(2.4, 0.35, 0.5, 0, h - 0.2, 0);
  // A 字兩腳（H 型鋼的翼板）＋底板＋X 斜撐＋頂部的橫樑與管箍
  for (const s of [-1, 1]) {
    const a = [s * 1.3, 0.1, 0],
      b = [s * 0.5, h - 0.35, 0];
    k.bar(m, a, b, 0.3);
    for (const z of [-0.18, 0.18]) k.bar(m, [a[0], 0.1, z], [b[0], b[1], z], 0.06);
    k.box(DETAIL.dark, 0.5, 0.08, 0.5, s * 1.3, 0.04, 0);
    k.box(DETAIL.dark, 0.12, 0.3, 0.46, s * 0.75, h - 0.05, 0);
  }
  k.bar(m, [-1.2, 0.6, 0], [0.62, h * 0.82, 0], 0.12);
  k.bar(m, [1.2, 0.6, 0], [-0.62, h * 0.82, 0], 0.12);
  k.box(m, 1.6, 0.25, 0.4, 0, h * 0.45, 0);
  k.cb(m, 2.4, 0.35, 0.5, 0, h - 0.2, 0, 0, 0, 0, 0.05);
  // 高的支架（管底離地 12 m 以上）腳要張開一點，不然太細長
  const g = k.build();
  g.scale.x = Math.max(1, h / 7);
  return g;
}

// 鑽井架（現實高 30–45 m）：格子塔＋作業平台（欄杆、樓梯照人的尺寸）＋頂部滑輪架；原點在底面中心；
// 底寬依高度（derrickBase）；GLB 以高 36 m 製作，依尺寸縮放
export const derrickBase = (h) => Math.max(2, h * 0.11);
export function buildDerrick(h, color) {
  const B = derrickBase(h);
  const glb = propGlb('derrick', { color, ref: [7.9, 36, 7.9], size: [B * 2, h, B * 2], fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.45 }),
    dk = fadeMat(0x34302c, { roughness: 0.9 });
  const k = new PK();
  const b0 = B,
    b1 = Math.max(0.6, h * 0.035);
  const half = (y) => lerpN(b0, b1, y / h);
  // 外框同原本（四支斜腳、平台、頂部滑輪架、底座）
  const ta = Math.atan2(b0 - b1, h);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      k.ob(0.3, h, 0.3, sx * ((b0 + b1) / 2), h / 2, sz * ((b0 + b1) / 2), -sz * ta, 0, sx * ta);
  k.ob(half(h * 0.35) * 2 + 1.6, 0.3, half(h * 0.35) * 2 + 1.6, 0, h * 0.35, 0);
  k.ob(b1 * 3, 1.2, b1 * 3, 0, h + 0.5, 0).ob(b0 * 2.2, 1.4, b0 * 2.2, 0, 0.7, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(m, [sx * b0, 0.15, sz * b0], [sx * b1, h, sz * b1], 0.3);
  // 每一節：四面的橫材＋單向斜撐
  let yp = 0,
    bay = 0;
  for (let y = 2.5; y < h - 1; y += 3, bay++) {
    const a = half(y),
      ap = half(yp);
    k.box(m, a * 2, 0.18, 0.18, 0, y, a);
    k.box(m, a * 2, 0.18, 0.18, 0, y, -a);
    k.box(m, 0.18, 0.18, a * 2, a, y, 0);
    k.box(m, 0.18, 0.18, a * 2, -a, y, 0);
    const f = bay % 2 ? -1 : 1;
    for (const s of [-1, 1]) {
      k.bar(m, [-f * ap, yp, s * ap], [f * a, y, s * a], 0.1);
      k.bar(m, [s * ap, yp, f * ap], [s * a, y, -f * a], 0.1);
    }
    yp = y;
  }
  // 作業平台（格柵板＋欄杆）
  const py = h * 0.35,
    pw = half(py) * 2 + 1.6;
  k.box(dk, pw, 0.3, pw, 0, py, 0);
  for (let i = 0; i < 4; i++)
    k.at(0, py + 0.15, 0, 0, (i * Math.PI) / 2, 0, () =>
      railing(k, dk, pw - 0.1, HUMAN.rail, 0, 0, pw / 2 - 0.05, 0, 1.5, 0.05),
    );
  // 地面到作業平台的爬梯（人用）
  humanLadder(k, dk, py, half(py * 0.5), 0, 0, Math.PI / 2, true, 'ladder_floor');
  k.mark('walk_floor', 0, py + 0.15, 0, 0);
  // 頂部滑輪架與滑輪
  k.cb(dk, b1 * 3, 1.2, b1 * 3, 0, h + 0.5, 0, 0, 0, 0, 0.1);
  k.cyl(m, 0.5, 0.5, 0.3, 0, h + 0.6, 0.75, Math.PI / 2, 0, 0, 10);
  k.pipe(DETAIL.dark, [0, h, 0], [0, 1.5, 0], 0.05, 4); // 鋼索
  // 底座與機房
  k.cb(dk, b0 * 2.18, 1.4, b0 * 2.18, 0, 0.7, 0, 0, 0, 0, 0.12);
  k.box(DETAIL.yellow, b0 * 2.2, 0.15, b0 * 2.2, 0, 1.25, 0);
  door(k, dk, DETAIL.steel, 0, 0, b0 * 1.09 + 0.02, 0, HUMAN.door[0], 1.2, 'door_cellar');
  return k.build();
}

// ---------- 沙丘地帶（dunes）：半埋的艦體殘骸、拱形殘骸 ----------
// 艦體殘骸：長約 24、寬 7 m，沿 Z，艦首朝 −Z；原點在艦底中心（呼叫端往下埋 sink）。
// box：碰撞箱的寬、長與埋好之後露出地面的高度
// 現實尺寸：舊模型放大 HULL_S 倍（長約 84 m 的貨輪殘骸，地標）
const HULL_S = 3.5;
export const WRECK_HULL = { box: [7.4 * HULL_S, 24 * HULL_S, 5.2 * HULL_S], sink: 2.4 * HULL_S };
export function buildWreckHull(color) {
  const glb = propGlb('wreck_hull', { color, fade: true });
  if (glb) return glb;
  const k = new PK();
  k.scaled(HULL_S, () => hullKit(k, color));
  return k.build();
}
function hullKit(k, color) {
  const m = fadeMat(color, { roughness: 0.9, metalness: 0.3 }),
    dk = fadeMat(0x3a3029, { roughness: 1 }),
    rust = fadeMat(0x8a4a2a, { roughness: 1 });
  k.bounds(-4.914, -0.764, -11.5, 3.416, 9.881, 12.1); // 外框同原本
  k.at(0, 0, 0, 0, 0, 0.22, () => {
    // 艦體斷面（舭部切角）沿 Z 擠出＋艦首楔形
    k.prism(
      m,
      [
        [-2.6, 0],
        [2.6, 0],
        [3.5, 0.9],
        [3.5, 6],
        [-3.5, 6],
        [-3.5, 0.9],
      ],
      20,
      0,
      0,
      2,
    );
    k.prism(
      m,
      [
        [-3.5, 7.95],
        [3.5, 7.95],
        [1.4, 10.6],
        [0, 11.6],
        [-1.4, 10.6],
      ],
      6,
      0,
      3,
      0,
      -Math.PI / 2,
      0,
      0,
    );
    // 外板接縫（兩側的水平帶）、甲板邊緣、破口
    for (const s of [-1, 1]) for (const y of [2.6, 4.4]) k.box(dk, 0.06, 0.18, 19.6, s * 3.52, y, 2);
    k.box(rust, 7.2, 0.5, 20.2, 0, 6, 2);
    for (const [z, hh] of [
      [-2, 1.6],
      [5, 2.4],
    ])
      k.box(dk, 0.1, hh, 2.6, 3.5, 3.6, z);
    // 甲板：艙口蓋＋繫纜柱
    for (const z of [-4, 0]) k.cb(m, 3.6, 0.5, 2.6, 0, 6.4, z, 0, 0, 0, 0.1);
    for (const s of [-1, 1]) for (const z of [-6.5, 10]) k.cyl(dk, 0.22, 0.25, 0.6, s * 2.8, 6.5, z);
    // 艦橋（殘骸）：窗帶＋屋頂＋折斷的桅杆
    k.cb(dk, 4.5, 3.5, 6, 0.4, 7.6, 6, 0, 0, 0, 0.2);
    k.box(DETAIL.glass, 4.56, 0.6, 0.4, 0.4, 8.5, 3.1);
    k.box(rust, 3, 0.4, 5, 0.4, 9.5, 6.4);
    k.cyl(dk, 0.18, 0.22, 4, 0.9, 11, 7.2, 0.5, 0, 0.2, 6);
    for (let i = 0; i < 4; i++) k.box(dk, 0.3, 4.5, 0.4, -3.6, 3.5, -4 + i * 4);
  });
}
// 拱形殘骸（半埋的巨大環狀構造）：跨距 18 m，沿 X；原點在地面中心；feet＝兩腳的 x 與碰撞半徑
// 現實尺寸：舊模型放大 ARCH_S 倍（跨距 54 m 的巨大構造殘骸）
const ARCH_S = 3;
export const WRECK_ARCH = { span: 18 * ARCH_S, feet: [9 * ARCH_S, 1.7 * ARCH_S] };
export function buildWreckArch(color) {
  const glb = propGlb('wreck_arch', { color, fade: true });
  if (glb) return glb;
  const R = 9;
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.35 }),
    rib = fadeMat(0x4a3a2e, { roughness: 1 });
  const k = new PK();
  k.scaled(ARCH_S, () => archKit(k, R, m, rib));
  const g = k.build();
  g.rotation.x = 0.12; // 整體略傾斜（同原本，呼叫端只改 rotation.y）
  return g;
}
function archKit(k, R, m, rib) {
  // 外框同原本的零件（主環＋7 片肋板）
  k.obMesh(new THREE.TorusGeometry(R, 1.3, 8, 28, Math.PI), 0, -0.8, 0);
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI;
    k.ob(0.5, 3.4, 3.2, Math.cos(a) * R, Math.sin(a) * R - 0.8, 0, 0, 0, a - Math.PI / 2);
  }
  // 主環＋內側的導軌環＋肋板（每片有內外兩層凸緣）；整體有傾斜，零件分到原本的零件上（主環 0、肋板 1～7）
  k.cur = 0;
  k.geo(m, new THREE.TorusGeometry(R, 1.3, 8, 28, Math.PI), 0, -0.8, 0);
  k.geo(rib, new THREE.TorusGeometry(R - 1.35, 0.3, 5, 28, Math.PI), 0, -0.8, 0);
  for (const z of [-1.15, 1.15])
    k.geo(rib, new THREE.TorusGeometry(R + 0.15, 0.22, 4, 28, Math.PI), 0, -0.8, z);
  for (let i = 1; i < 8; i++) {
    const a = (i / 8) * Math.PI,
      c = Math.cos(a),
      s = Math.sin(a);
    k.cur = i;
    k.at(c * R, s * R - 0.8, 0, 0, 0, a - Math.PI / 2, () => {
      k.cb(rib, 0.5, 3.4, 3.2, 0, 0, 0, 0, 0, 0, 0.1);
      k.box(rib, 0.9, 0.2, 3.3, 0, 1.6, 0);
      k.box(rib, 0.9, 0.2, 3.3, 0, -1.6, 0);
    });
  }
}

// ---------- 冰湖：橢圓冰面＋裂紋貼圖；rng 決定裂紋（各端相同）；原點在冰面中心，單位圓再以 rx、rz 縮放 ----------
export function buildIceSheet(rx, rz, rng) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 512;
  const c = cv.getContext('2d');
  const gr = c.createRadialGradient(256, 256, 40, 256, 256, 256);
  gr.addColorStop(0, '#9fc6dc');
  gr.addColorStop(1, '#d7e8f1');
  c.fillStyle = gr;
  c.fillRect(0, 0, 512, 512);
  c.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    let x = rng() * 512,
      y = rng() * 512,
      a = rng() * Math.PI * 2;
    c.strokeStyle = `rgba(255,255,255,${(0.35 + rng() * 0.4).toFixed(2)})`;
    c.lineWidth = 0.8 + rng() * 1.6;
    c.beginPath();
    c.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      a += (rng() - 0.5) * 1.1;
      x += Math.cos(a) * (14 + rng() * 22);
      y += Math.sin(a) * (14 + rng() * 22);
      c.lineTo(x, y);
    }
    c.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding;
  const geo = new THREE.CircleGeometry(1, 48);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.12, metalness: 0.3 }),
  );
  m.scale.set(rx, 1, rz);
  m.receiveShadow = true;
  return m;
}

// ---------- 新主題的散布物件（取代舊主題的貨櫃／卡車／路燈／岩石／碎塊）----------
// 礦石料斗（荒野的掩體，現實尺寸約 12 × 15 × 12 m＝全身掩體）：方形漏斗＋四腳＋滑槽；原點在底面中心；
// HOPPER＝碰撞箱 寬、高、深。本體是舊模型放大 HOPPER_S 倍，爬梯照人的尺寸
const HOPPER_S = 2.4;
export const HOPPER = [5 * HOPPER_S, 6.2 * HOPPER_S, 5 * HOPPER_S];
export function buildOreHopper(color) {
  const glb = propGlb('ore_hopper', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.75, metalness: 0.4 }),
    dk = fadeMat(0x3a332d, { roughness: 0.9 }),
    ore = fadeMat(0x5b4a3c, { roughness: 1 });
  const k = new PK();
  humanLadder(
    k,
    dk,
    HOPPER[1] - 1.2,
    2.45 * HOPPER_S + 0.1,
    0,
    -1.2 * HOPPER_S,
    Math.PI / 2,
    true,
    'ladder_hopper',
  );
  k.scaled(HOPPER_S, () => hopperKit(k, m, dk, ore));
  return k.build();
}
function hopperKit(k, m, dk, ore) {
  k.bounds(-4.95, 0, -4.95, 4.95, 6.6, 4.95); // 外框同原本
  // 料倉（倒角＋外側加強肋＋上緣）＋方錐漏斗＋H 型鋼四腳與斜撐＋滑槽與閘門＋爬梯
  k.cb(m, 4.9, 2.2, 4.9, 0, 5, 0, 0, 0, 0, 0.12);
  for (const s of [-1, 1])
    for (const t of [-1.2, 0, 1.2]) {
      k.box(dk, 0.14, 2.2, 0.12, t, 5, s * 2.48);
      k.box(dk, 0.12, 2.2, 0.14, s * 2.48, 5, t);
    }
  k.box(dk, 5, 0.22, 5, 0, 6.05, 0);
  k.geo(m, new THREE.CylinderGeometry(3.45, 1.2, 2.2, 4, 1), 0, 2.8, 0, 0, Math.PI / 4, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      k.box(dk, 0.4, 4, 0.4, sx * 2.2, 2, sz * 2.2);
      k.box(dk, 0.7, 0.08, 0.7, sx * 2.2, 0.04, sz * 2.2);
    }
  for (const s of [-1, 1]) {
    k.bar(dk, [-2.2, 0.4, s * 2.2], [2.2, 3.6, s * 2.2], 0.12);
    k.bar(dk, [s * 2.2, 0.4, -2.2], [s * 2.2, 3.6, 2.2], 0.12);
  }
  k.box(ore, 4.6, 0.6, 4.6, 0, 6.3, 0);
  k.at(0, 1.2, 2.2, 0.5, 0, 0, () => {
    k.box(dk, 1.2, 0.12, 3, 0, 0, 0);
    for (const s of [-1, 1]) k.box(dk, 0.1, 0.4, 3, s * 0.6, 0.2, 0);
  });
  k.cb(m, 1.0, 0.5, 0.9, 0, 1.6, 0, 0, 0, 0, 0.06);
  hazard(k, DETAIL.yellow, DETAIL.black, 1.0, 0.24, 0, 1.6, 0.46);
}
// 鏽蝕儲槽：圓槽＋頂蓋＋箍＋爬梯；原點在底面中心；GLB 以半徑 3、高 6 m 製作，依尺寸縮放
export function buildStorageTank(r, h, color) {
  const glb = propGlb('storage_tank', { color, ref: [6, 6, 6], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.35 }),
    rust = fadeMat(0x7a3f22, { roughness: 1 });
  const k = new PK().bounds(-(r + 0.08), 0, -(r + 0.08), r + 0.08, h + 0.8, r + 0.175); // 外框同原本
  // 槽身＋底座環＋錐頂＋補強箍＋螺旋梯（簡化成直梯＋護籠）＋通氣口＋人孔
  k.cyl(m, r, r, h, 0, h / 2, 0, 0, 0, 0, 16);
  k.cyl(rust, r + 0.1, r + 0.12, 0.35, 0, 0.17, 0, 0, 0, 0, 16);
  k.cyl(m, r * 0.3, r, 0.8, 0, h + 0.4, 0, 0, 0, 0, 16);
  for (const y of [h * 0.3, h * 0.7]) k.cyl(rust, r + 0.08, r + 0.08, 0.25, 0, y, 0, 0, 0, 0, 16);
  ladder(k, rust, h, 0, 0, r + 0.12);
  for (let y = 2.4; y < h - 0.3; y += 1.2)
    k.geo(rust, new THREE.TorusGeometry(0.4, 0.03, 3, 8, Math.PI), 0, y, r + 0.12, Math.PI / 2, 0, 0);
  k.cyl(rust, 0.18, 0.18, 0.6, r * 0.3, h + 0.95, -r * 0.2, 0, 0, 0, 6);
  k.cyl(rust, 0.45, 0.45, 0.12, -r - 0.02, 0.9, 0, 0, 0, Math.PI / 2, 10);
  return k.build();
}
// 岩柱（荒野的岩石）：下粗上細的六角柱＋頂部岩塊；原點在底面中心；GLB 以半徑 2、高 7 m 製作
export function buildRockSpire(r, h, color) {
  const glb = propGlb('rock_spire', { color, ref: [4, 7, 4], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 1 });
  m.vertexColors = true;
  const sd = rockSeed(r + h);
  // 柱身：拉長的雜訊岩石（層理明顯）＋頂上一塊
  const p = new THREE.Mesh(D.rock(sd, 6, 0.28, 0.95, 0.65), m);
  p.scale.set(r * 0.85, h * 0.48, r * 0.85);
  p.position.y = h * 0.44;
  p.castShadow = p.receiveShadow = true;
  g.add(p);
  const top = new THREE.Mesh(D.rock(sd + 7, 4, 0.4, 0.5, 0.4), m);
  top.position.y = h * 0.86;
  top.scale.set(r * 0.65, r * 0.42, r * 0.65);
  top.castShadow = true;
  g.add(top);
  return g;
}
// 照明塔（現實高 20–35 m）：格子桿（寬度依高度）＋燈架（頂部的燈數依高度）＋人用爬梯與燈架平台；
// 原點在底面中心；GLB 以高 25 m 製作，依尺寸縮放
export const floodW = (h) => Math.max(0.45, h * 0.035);
export function buildFloodlight(h, color) {
  const W = floodW(h),
    hw = Math.max(3, h * 0.2); // 燈架寬
  const glb = propGlb('floodlight', { color, ref: [5, 25, 1.6], size: [hw, h, hw * 0.32] });
  if (glb) return glb;
  const m = mat(color, { roughness: 0.7, metalness: 0.5 });
  const lm = mat(0xfff2c8, { emissive: 0x806a3a, roughness: 0.4 });
  const nl = Math.max(3, Math.round(hw / 1.1)); // 燈數
  const k = new PK(); // 外框同原本的零件（桿、燈架、各盞燈、底座；呼叫端會任意旋轉）
  k.ob(W, h, W, 0, h / 2, 0)
    .ob(hw, 0.25, 0.3, 0, h - 0.4, 0)
    .ob(W * 2.6, 0.6, W * 2.6, 0, 0.3, 0);
  const lx = (j) => -hw / 2 + (hw / nl) * (j + 0.5);
  for (let j = 0; j < nl; j++) k.ob(0.8, 0.6, 0.5, lx(j), h - 0.85, 0.2);
  // 底座（倒角＋螺栓）
  k.cur = 2;
  k.cb(m, W * 2.6, 0.6, W * 2.6, 0, 0.3, 0, 0, 0, 0, 0.08);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(DETAIL.dark, 0.1, 0.1, 0.1, sx * W, 0.62, sz * W);
  // 格子桿：四角材＋每 1.4 m 的橫材＋斜撐
  k.cur = 0;
  const c = W / 2 - 0.05;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(m, 0.1, h - 0.6, 0.1, sx * c, h / 2 + 0.3, sz * c);
  let yp = 0.6;
  for (let y = 2; y < h - 1; y += 1.4) {
    for (const s of [-1, 1]) {
      k.box(m, W, 0.06, 0.06, 0, y, s * c);
      k.box(m, 0.06, 0.06, W, s * c, y, 0);
      k.bar(m, [-c, yp, s * c], [c, y, s * c], 0.05);
    }
    yp = y;
  }
  humanLadder(k, m, h - 1.2, 0, 0.6, -c - 0.12, Math.PI, true, 'ladder_light');
  // 燈架：橫臂＋維修平台（格柵＋欄杆）＋各盞燈（燈罩＋發光面），分到原本的零件上
  k.cur = 1;
  k.box(m, hw, 0.25, 0.3, 0, h - 0.4, 0);
  k.box(m, hw, 0.06, 1.0, 0, h - 1.4, -0.2);
  railing(k, m, hw, HUMAN.rail, 0, h - 1.4, -0.7, 0, 1.5, 0.04);
  k.mark('walk_lamp', 0, h - 1.37, -0.2, 0);
  for (let j = 0; j < nl; j++)
    k.inPart(3 + j, () =>
      k.at(lx(j), h - 0.85, 0.2, 0.3, 0, 0, () => {
        k.cb(m, 0.8, 0.6, 0.45, 0, 0, -0.05, 0, 0, 0, 0.05);
        k.box(lm, 0.72, 0.52, 0.05, 0, 0, 0.19);
      }),
    );
  return k.build();
}
// 廢鐵板（純裝飾）：兩片斜插的鐵板；原點在地面中心；GLB 以 1.5 × 0.8 × 1.2 m 製作
export function buildScrap(w, h, d, color) {
  const glb = propGlb('scrap', { color, ref: [1.5, 0.8, 1.2], size: [w, h, d] });
  if (glb) return glb;
  const m = mat(color, { roughness: 0.9, metalness: 0.4 });
  const k = new PK()
    .ob(w, 0.08, d * 0.7, 0, h * 0.4, 0, 0, 0, 0.5)
    .ob(w * 0.6, 0.08, d * 0.5, w * 0.2, h * 0.3, d * 0.3, -0.6, 0, 0);
  // 兩片斜插的鐵板（一片帶加強肋）＋一截 L 型鋼
  k.at(0, h * 0.4, 0, 0, 0, 0.5, () => {
    k.box(m, w, 0.08, d * 0.7, 0, 0, 0);
    for (const t of [-0.25, 0.25]) k.box(m, w * 0.95, 0.12, 0.06, 0, 0.08, t * d);
  });
  k.box(m, w * 0.6, 0.08, d * 0.5, w * 0.2, h * 0.3, d * 0.3, -0.6, 0, 0);
  k.at(-w * 0.25, h * 0.15, -d * 0.3, 0, 0.8, 0.15, () => {
    k.box(m, w * 0.7, 0.05, 0.16, 0, 0, 0);
    k.box(m, w * 0.7, 0.16, 0.05, 0, 0.08, -0.08);
  });
  return k.build();
}
// MT 殘骸（沙丘的掩體）：半埋的小型機體殘骸；原點在地面中心；MT_WRECK＝碰撞箱 寬、高、深
// MT 也放大了 3 倍（MS），殘骸同樣放大 MS 倍
export const MT_WRECK = [4.2 * MS, 3.2 * MS, 4.2 * MS];
export function buildMtWreck(color) {
  const glb = propGlb('mt_wreck', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.4 }),
    dk = fadeMat(0x2e2a26, { roughness: 1 });
  const k = new PK();
  k.scaled(MS, () => mtWreckKit(k, m, dk));
  return k.build();
}
function mtWreckKit(k, m, dk) {
  k.bounds(-2.917, -0.509, -3.177, 2.712, 3.367, 2.349); // 外框同原本
  k.at(0, 0, 0, 0.15, 0.3, -0.25, () => {
    // 胴體：倒角主體＋前方斜裝甲＋側面裝甲板與螺栓
    k.cb(m, 3.6, 2.2, 3.4, 0, 1.2, 0, 0, 0, 0, 0.3);
    k.cb(m, 3.2, 1.0, 0.6, 0, 1.6, -1.75, -0.4, 0, 0, 0.12);
    for (const s of [-1, 1]) {
      k.cb(dk, 0.2, 1.4, 2.4, s * 1.85, 1.2, 0.1, 0, 0, 0, 0.05);
      rivets(
        k,
        m,
        [
          [s * 1.96, 1.7, -0.8],
          [s * 1.96, 1.7, 1.0],
          [s * 1.96, 0.7, -0.8],
          [s * 1.96, 0.7, 1.0],
        ],
        0.12,
      );
    }
    // 頭部：感測器窗＋天線
    k.cb(m, 1.6, 1, 1.4, 0.4, 2.7, -0.6, 0, 0, 0, 0.15);
    k.box(DETAIL.glass, 1.0, 0.25, 0.06, 0.4, 2.8, -1.31);
    k.cyl(dk, 0.04, 0.04, 1.2, -0.1, 3.6, -0.2, 0, 0, 0.3, 4);
    // 機砲：機匣＋砲管＋砲口
    k.at(1.9, 1.8, -1.2, Math.PI / 2 - 0.3, 0, 0, () => {
      k.cb(dk, 0.6, 1.0, 0.6, 0, 1.1, 0, 0, 0, 0, 0.08);
      k.cyl(dk, 0.18, 0.18, 3.2, 0, 0, 0, 0, 0, 0, 6);
      k.cyl(dk, 0.26, 0.26, 0.4, 0, -1.5, 0, 0, 0, 0, 6);
    });
    k.pipe(dk, [-1.4, 2.3, 1.2], [-0.6, 2.4, 1.9], 0.08);
  });
  // 折斷的腳：大腿＋膝關節＋小腿殘段
  k.at(-1.6, 0.6, 1.6, 0, 0, 1.1, () => {
    k.cb(dk, 0.7, 1.5, 0.7, 0, 0.5, 0, 0, 0, 0, 0.1);
    k.cyl(m, 0.42, 0.42, 0.8, 0, -0.3, 0, 0, 0, Math.PI / 2, 8);
    k.cb(dk, 0.55, 1.0, 0.55, 0, -0.95, 0.15, 0.4, 0, 0, 0.08);
  });
}
// 風蝕砂岩（沙丘的岩石）：細莖＋寬大的岩帽；原點在底面中心；GLB 以半徑 3、高 7 m 製作
export function buildSandstone(r, h, color) {
  const glb = propGlb('sandstone', { color, ref: [6, 7, 6], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 1 });
  m.vertexColors = true;
  const sd = rockSeed(r * 3 + h);
  // 風蝕的柱身（細腰、層理）＋寬的岩帽
  const st = new THREE.Mesh(D.rock(sd, 6, 0.3, 0.95, 0.8), m);
  st.scale.set(r * 0.5, h * 0.4, r * 0.5);
  st.position.y = h * 0.37;
  st.castShadow = st.receiveShadow = true;
  g.add(st);
  const cap = new THREE.Mesh(D.rock(sd + 11, 5, 0.3, 0.6, 0.7), m);
  cap.scale.set(r, r * 0.38, r * 0.85);
  cap.position.y = h * 0.78;
  cap.castShadow = true;
  g.add(cap);
  return g;
}
// 防風牆（沙丘的掩體）：一排波浪板＋支柱，長 len、高 3 m，沿 X；原點在底面中心；GLB 以長 8 m 製作，依長度縮放
export const SAND_FENCE_H = 3;
export function buildSandFence(len, color) {
  const glb = propGlb('sand_fence', { color, ref: [8, 3, 0.5], size: [len, 3, 0.5], fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.45 }),
    dk = fadeMat(0x4a4038, { roughness: 0.9 });
  const k = new PK().bounds(-len / 2 - 0.125, 0, -0.15, len / 2 + 0.125, SAND_FENCE_H + 0.2, 0.15); // 外框同原本
  const n = Math.max(2, Math.round(len / 1.2));
  // 波浪板：每片前後錯開、上緣捲邊；H 型鋼支柱＋上下橫樑＋斜撐腳
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (len / n) * (i + 0.5),
      z = i % 2 ? 0.06 : -0.06;
    k.box(m, len / n - 0.08, SAND_FENCE_H - 0.4, 0.12, x, 1.5, z);
    for (const y of [0.75, 1.5, 2.25]) k.box(m, len / n - 0.12, 0.08, 0.18, x, y, z);
  }
  for (const y of [0.45, SAND_FENCE_H - 0.35]) k.box(dk, len, 0.14, 0.08, 0, y, 0.16);
  const step = len / Math.max(1, Math.round(len / 4));
  for (let x = -len / 2; x <= len / 2 + 1e-6; x += step) {
    k.box(dk, 0.25, SAND_FENCE_H + 0.2, 0.08, x, (SAND_FENCE_H + 0.2) / 2, 0.11);
    k.box(dk, 0.25, SAND_FENCE_H + 0.2, 0.08, x, (SAND_FENCE_H + 0.2) / 2, -0.11);
    k.box(dk, 0.06, SAND_FENCE_H + 0.2, 0.22, x, (SAND_FENCE_H + 0.2) / 2, 0);
  }
  return k.build();
}

// ---------- 冰原（snow）：半圓拱屋、冰塊、信號燈桿、雷達天線、舊時代觀測圓頂、碎冰 ----------
// 半圓拱屋（冰原的掩體）：長沿 Z；原點在底面中心；QUONSET＝碰撞箱 寬、高、深
// 現實尺寸：舊模型放大 QUON_S 倍（12 × 6.8 × 18 m，半身掩體）；端牆的大門是車輛用，旁邊另有人用門
const QUON_S = 2;
export const QUONSET = [6 * QUON_S, 3.4 * QUON_S, 9 * QUON_S];
export function buildQuonset(color) {
  const glb = propGlb('quonset', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.6, metalness: 0.45 }),
    snow = fadeMat(0xf2f6fa, { roughness: 0.95 }),
    dk = fadeMat(0x3d434a, { roughness: 0.8 });
  const k = new PK();
  door(
    k,
    dk,
    DETAIL.steel,
    2.6 * QUON_S,
    0,
    -4.6 * QUON_S - 0.05,
    Math.PI,
    HUMAN.door[0],
    HUMAN.door[1],
    'door_quonset',
  );
  k.scaled(QUON_S, () => quonsetKit(k, m, snow, dk));
  return k.build();
}
function quonsetKit(k, m, snow, dk) {
  const X = Math.PI / 2;
  k.bounds(-2.8, -2.8, -4.75, 3.388, 3.2, 4.6); // 外框同原本
  // 半圓外殼＋拱肋＋屋頂積雪＋兩側基礎＋端牆（門、窗、通風口、燈）
  k.geo(m, new THREE.CylinderGeometry(3, 3, 9, 14, 1, false, -X, Math.PI), 0, 0.2, 0, X, X, 0, 1, 1, 1.1);
  for (const z of [-3.3, -1.1, 1.1, 3.3])
    k.geo(dk, new THREE.TorusGeometry(3.02, 0.08, 3, 12, Math.PI), 0, 0.2, z, 0, 0, 0, 1, 1.1, 1);
  k.geo(
    snow,
    new THREE.CylinderGeometry(3.08, 3.08, 8.6, 14, 1, false, -0.9, 1.8),
    0,
    0.2,
    0,
    X,
    X,
    0,
    1,
    1,
    1.1,
  );
  for (const s of [-1, 1]) k.box(dk, 0.4, 0.35, 9.2, s * 2.85, 0.17, 0);
  for (const z of [-4.5, 4.5]) k.box(dk, 5.6, 3, 0.2, 0, 1.6, z);
  k.cb(m, 1.6, 2.2, 0.3, 0, 1.1, -4.6, 0, 0, 0, 0.05);
  k.box(dk, 0.06, 2.0, 0.05, 0, 1.1, -4.77);
  k.box(DETAIL.steel, 0.25, 0.06, 0.08, 0.5, 1.15, -4.79);
  for (const s of [-1, 1]) k.box(DETAIL.glass, 0.9, 0.55, 0.06, s * 1.8, 1.9, -4.62);
  grille(k, dk, m, 1.0, 0.5, 3, 0, 2.75, -4.62);
  k.box(DETAIL.lamp, 0.4, 0.14, 0.18, 0, 2.35, -4.68);
  grille(k, dk, m, 1.2, 0.8, 4, 1.4, 1.6, 4.62);
}
// 冰塊（冰原的岩石）：幾塊稜角分明的半透明冰；原點在底面中心；GLB 以半徑 2.5 製作
export function buildIceChunk(r) {
  const glb = propGlb('ice_chunk', { ref: [5, 4, 5], size: [r * 2, r * 1.6, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xbfe0f0, { roughness: 0.15, metalness: 0.1 });
  m.vertexColors = true;
  // 冰塊：稜角分明（雜訊小、沒有層理、細分少）的兩塊
  const sd = rockSeed(r * 5);
  const a = new THREE.Mesh(D.rock(sd, 1, 0.18, 0.7, 0), m);
  a.scale.set(r, r * 0.8, r * 0.85);
  a.position.y = r * 0.5;
  a.rotation.set(0.3, 0.5, 0.2);
  a.castShadow = true;
  g.add(a);
  const b = new THREE.Mesh(D.rock(sd + 3, 1, 0.18, 0.7, 0), m);
  b.scale.setScalar(r * 0.6);
  b.position.set(r * 0.7, r * 0.3, r * 0.3);
  b.rotation.set(0.6, 0.2, 0.9);
  b.castShadow = true;
  g.add(b);
  return g;
}
// 信號燈桿（冰原的柱子）：紅白相間的桿＋頂部紅燈；原點在底面中心；GLB 以高 8 m 製作
export function buildBeacon(h) {
  const glb = propGlb('beacon', { ref: [1, 8, 1], size: [1, h, 1] });
  if (glb) return glb;
  const red = mat(0xc8322a, { roughness: 0.6 }),
    white = mat(0xe8ecef, { roughness: 0.6 }),
    base = mat(0x3d434a);
  const k = new PK().bounds(-0.6, 0, -0.6, 0.6, h + 0.5, 0.6); // 外框同原本
  // 底座（倒角＋螺栓）＋紅白相間的八角桿＋中段的接線盒＋頂部燈籠（框＋紅燈）＋避雷針
  k.cb(base, 1.2, 0.5, 1.2, 0, 0.25, 0, 0, 0, 0, 0.08);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(DETAIL.steel, 0.1, 0.1, 0.1, sx * 0.42, 0.52, sz * 0.42);
  const n = 6;
  for (let i = 0; i < n; i++)
    k.cyl(i % 2 ? white : red, 0.2, 0.22, h / n, 0, (h / n) * (i + 0.5), 0, 0, Math.PI / 8, 0, 8);
  k.cb(base, 0.4, 0.55, 0.25, 0, 1.6, 0.28, 0, 0, 0, 0.04);
  k.cyl(base, 0.36, 0.36, 0.08, 0, h + 0.04, 0, 0, 0, 0, 8);
  k.cyl(DETAIL.red, 0.24, 0.24, 0.32, 0, h + 0.24, 0, 0, 0, 0, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    k.box(base, 0.05, 0.36, 0.05, Math.cos(a) * 0.3, h + 0.26, Math.sin(a) * 0.3);
  }
  k.cyl(base, 0.3, 0.36, 0.08, 0, h + 0.46, 0, 0, 0, 0, 8);
  return k.build();
}
// 雷達天線：支架＋傾斜的碟形天線；原點在底面中心；GLB 以高約 15 m 製作（現實尺寸，照原樣使用）
// 現實尺寸：舊模型放大 RADAR_S 倍（高約 17 m、碟面直徑約 12 m）；桅桿的爬梯照人的尺寸
export const RADAR_S = 2.5;
export function buildRadarDish(color) {
  const glb = propGlb('radar_dish', { color, fade: true });
  if (glb) return glb;
  const m = fadeMat(color, { roughness: 0.5, metalness: 0.5 }),
    dk = fadeMat(0x3d434a, { roughness: 0.8 });
  m.side = THREE.DoubleSide;
  const k = new PK();
  k.scaled(RADAR_S, () => radarKit(k, m, dk));
  k.cur = 1;
  humanLadder(k, dk, 3.6 * RADAR_S, 0, 1.3 * RADAR_S, -0.45 * RADAR_S - 0.08, Math.PI, true, 'ladder_radar');
  k.cur = -1;
  door(k, dk, DETAIL.steel, 0, 0, 1.2 * RADAR_S + 0.03, 0, HUMAN.door[0], HUMAN.door[1], 'door_radar');
  return k.build();
}
function radarKit(k, m, dk) {
  // 外框同原本的零件（底座、桅桿、碟、饋源；呼叫端會任意旋轉）
  k.ob(2.4, 1, 2.4, 0, 0.5, 0).obCyl(0.35, 0.45, 4, 0, 3, 0).ob(0.15, 0.15, 2.2, 0, 5.6, -0.4);
  k.obMesh(new THREE.SphereGeometry(3, 16, 6, 0, Math.PI * 2, 0, 0.9), 0, 5.2, 0.6, -2.2, 0, 0);
  // 底座（機房：倒角＋格柵＋門）＋旋轉座＋桅桿＋碟面（邊環、背後的轂）＋三支饋源支架與饋源；分到原本的零件上
  k.cur = 0;
  k.cb(dk, 2.4, 1, 2.4, 0, 0.5, 0, 0, 0, 0, 0.1);
  grille(k, dk, m, 1.2, 0.5, 3, 0, 0.55, 1.22);
  k.cyl(m, 0.7, 0.8, 0.35, 0, 1.17, 0, 0, 0, 0, 10);
  k.cur = 1;
  k.cyl(dk, 0.35, 0.45, 4, 0, 3, 0, 0, 0, 0, 8);
  k.inPart(3, () =>
    k.geo(m, new THREE.SphereGeometry(3, 16, 6, 0, Math.PI * 2, 0, 0.9), 0, 5.2, 0.6, -2.2, 0, 0),
  );
  k.cur = 2;
  const a = [0, -Math.sin(0.63), -Math.cos(0.63)],
    v = [0, -Math.cos(0.63), Math.sin(0.63)],
    C = [0, 5.2, 0.6];
  const at = (t) => [C[0] + a[0] * t, C[1] + a[1] * t, C[2] + a[2] * t];
  const rc = at(3 * Math.cos(0.9)),
    rr = 3 * Math.sin(0.9);
  k.geo(dk, new THREE.TorusGeometry(rr, 0.08, 3, 20), rc[0], rc[1], rc[2], Math.PI - 0.63, 0, 0);
  const hub = at(3.35);
  k.cyl(dk, 0.5, 0.5, 0.6, hub[0], hub[1], hub[2], Math.PI / 2 - 0.63 + Math.PI, 0, 0, 8);
  k.bar(dk, [0, 4.6, 0], hub, 0.25);
  const f = at(1.5);
  for (let i = 0; i < 3; i++) {
    const p = (i / 3) * Math.PI * 2 + Math.PI / 2,
      c = Math.cos(p) * rr,
      s = Math.sin(p) * rr;
    k.bar(dk, [rc[0] + c, rc[1] + v[1] * s, rc[2] + v[2] * s], f, 0.07);
  }
  k.pipe(dk, f, at(1.1), 0.18, 6);
}
// 舊時代觀測圓頂（大型，不可破壞）：圓形基座＋半球＋觀測縫＋天線；原點在地面中心；DOME_R＝基座半徑
// 現實尺寸：舊模型放大 DOME_S 倍（基座直徑約 37 m 的雷達罩）；入口的人用門與走道欄杆照人的尺寸；GLB 以這個大小製作
const DOME_S = 2;
export const DOME_R = 9 * DOME_S;
export function buildObsDome(color) {
  const glb = propGlb('obs_dome', { color, fade: true });
  if (glb) return glb;
  const k = new PK();
  const base = fadeMat(0x5a6068, { roughness: 0.85 }),
    dk = fadeMat(0x22262b, { roughness: 0.9 });
  k.scaled(DOME_S, () => domeKit(k, color));
  // 基座頂的走道欄杆（人的尺寸）、入口的人用門與門燈
  const R0 = DOME_R - 0.2,
    yw = 3.5 * DOME_S;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    k.box(dk, 0.06, HUMAN.rail, 0.06, Math.sin(a) * R0, yw + HUMAN.rail / 2, Math.cos(a) * R0);
  }
  k.geo(dk, new THREE.TorusGeometry(R0, 0.04, 3, 48), 0, yw + HUMAN.rail, 0, Math.PI / 2, 0, 0);
  k.mark('walk_dome', 0, yw, R0 - 1, 0);
  door(k, dk, DETAIL.steel, 0, 0, (9 + 0.82) * DOME_S + 0.03, 0, HUMAN.door[0], HUMAN.door[1], 'door_dome');
  k.box(base, 0.3, 0.3, 0.3, 0, 2.6, (9 + 0.82) * DOME_S + 0.15);
  return k.build();
}
function domeKit(k, color) {
  const DOME_R = 9;
  const m = fadeMat(color, { roughness: 0.55, metalness: 0.35 }),
    base = fadeMat(0x5a6068, { roughness: 0.85 }),
    snow = fadeMat(0xf2f6fa, { roughness: 0.95 }),
    dk = fadeMat(0x22262b, { roughness: 0.9 });
  k.bounds(-9.6, 0, -9.6, 9.6, 12.5, 9.8); // 外框同原本
  const R = DOME_R - 0.6;
  // 基座（壁柱＋上緣）＋圓頂（經線肋）＋積雪＋觀測縫（兩側導軌）＋走道與欄杆＋入口（門、燈）＋天線
  k.cyl(base, DOME_R, DOME_R + 0.6, 3.5, 0, 1.75, 0, 0, 0, 0, 20);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    k.box(dk, 0.5, 3.2, 0.3, Math.sin(a) * (DOME_R + 0.32), 1.6, Math.cos(a) * (DOME_R + 0.32), 0, a, 0);
  }
  k.cyl(dk, DOME_R + 0.15, DOME_R + 0.15, 0.25, 0, 3.4, 0, 0, 0, 0, 20);
  k.geo(m, new THREE.SphereGeometry(R, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 3.5, 0);
  for (let i = 0; i < 6; i++)
    k.geo(
      dk,
      new THREE.TorusGeometry(R + 0.04, 0.07, 3, 10, Math.PI),
      0,
      3.5,
      0,
      0,
      (i / 6) * Math.PI + 0.26,
      0,
    );
  k.geo(snow, new THREE.SphereGeometry(DOME_R - 0.45, 20, 4, 0, Math.PI * 2, 0, 0.6), 0, 3.5, 0);
  k.at(0, 3.5 + R * 0.72, -2.2, 0.75, 0, 0, () => {
    k.box(dk, 1.6, 0.2, DOME_R - 1, 0, 0, 0);
    for (const s of [-1, 1]) k.box(m, 0.25, 0.35, DOME_R - 0.6, s * 0.95, 0.05, 0);
  });
  // 入口（門與門燈在外面另外畫，照人的尺寸）
  k.cb(base, 2.4, 2.6, 1.2, 0, 1.3, DOME_R + 0.2, 0, 0, 0, 0.1);
  k.box(snow, 2.5, 0.2, 1.3, 0, 2.68, DOME_R + 0.2);
  k.cyl(dk, 0.12, 0.12, 6, DOME_R * 0.6, 3.5 + 6, 0, 0, 0, 0, 6);
  for (const y of [7.5, 10.5]) k.box(dk, 1.4, 0.06, 0.06, DOME_R * 0.6, y, 0);
}
// 碎冰（純裝飾）：扁平的冰片；原點在地面中心；GLB 以 1.2 × 0.4 × 1 m 製作
export function buildIceShard(w, h, d) {
  const glb = propGlb('ice_shard', { ref: [1.2, 0.4, 1], size: [w, h, d] });
  if (glb) return glb;
  const m = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.5, 0),
    mat(0xd6ecf6, { roughness: 0.2, metalness: 0.1 }),
  );
  m.scale.set(w, h, d);
  m.position.y = h * 0.2;
  return m;
}

// ---------- 主題版的地形特徵（荒野 wasteland／沙丘 dunes／冰原 snow）----------
// 和程式模型的橋面板、支柱、掩體牆、高台、隧道口同樣的尺寸與原點（碰撞不變，只換外觀）；
// GLB 槽位 prop/<主題>_deck 等，依尺寸縮放
// 其他主題（world/themes/*.js）以 registerFeatureStyle 登記自己的顏色與六種外觀（deck／pillar／wall／platform／ramp／tunnel，
// 參數同下面的函式，最後一個是顏色表）；GLB 槽位仍是 prop/<主題>_deck 等
const FEATURE_IMPL = {};
export function registerFeatureStyle(style, colors, impl) {
  FEATURE_COLORS[style] = colors;
  FEATURE_IMPL[style] = impl;
}
export const featureStyles = () => Object.keys(FEATURE_COLORS);
const FEATURE_COLORS = {
  wasteland: {
    deck: 0x5e5048,
    trim: 0xa0522d,
    pillar: 0x7a4a2a,
    wall: 0x8c8a80,
    plat: 0x6a5240,
    rock: 0x4e3e33,
  },
  dunes: { deck: 0xb59a76, trim: 0x8e7656, pillar: 0xa88d68, wall: 0xc2a77a, plat: 0xb0946c, rock: 0x7a5a3c },
  snow: { deck: 0x6a7078, trim: 0xe9eef2, pillar: 0x7a828c, wall: 0xd8dde2, plat: 0xa9cbe0, rock: 0x2c3238 },
};
// 高架板：原點在板頂面（同 buildDeck）；rotY 時長邊沿 Z（護欄沿 Z）
export function buildThemeDeck(style, w, d, thick, rotY) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_deck', {
    color: C.deck,
    ref: [8, 0.7, 20],
    size: rotY ? [d, thick, w] : [w, thick, d],
    rotY: rotY ? Math.PI / 2 : 0,
    fade: true,
  });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].deck(w, d, thick, rotY, C);
  const dm = fadeMat(C.deck, { roughness: 0.85, metalness: style === 'wasteland' ? 0.5 : 0.1 }),
    tm = fadeMat(C.trim, { roughness: 0.8, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  // 長邊沿 X 建造（L 長、D 寬），rotY 時轉 90°
  const L = rotY ? d : w,
    D = rotY ? w : d;
  const k = new PK();
  k.at(0, 0, 0, 0, rotY ? Math.PI / 2 : 0, 0, () => {
    k.cb(dm, L, thick, D, 0, -thick / 2, 0, 0, 0, 0, Math.min(0.1, thick * 0.2));
    k.ob(L, thick, D, 0, -thick / 2, 0);
    const z = (s, t) => s * ((D - t) / 2);
    if (style === 'wasteland') {
      // 鋼橋：兩側桁架（上下弦＋直桿＋斜桿＋節點板）；外框同原本（上弦、直桿、旋轉的斜桿）
      for (const s of [-1, 1]) {
        const n = Math.max(2, Math.round(L / 3));
        k.ob(L, 0.3, 0.3, 0, 1.9, z(s, 0.3));
        for (const x of [-L / 2, L / 2]) k.ob(0.2, 1.9, 0.2, x, 0.95, z(s, 0.2));
        for (let i = 0; i < n; i++)
          k.ob(
            Math.hypot(L / n, 1.9),
            0.18,
            0.18,
            -L / 2 + (L / n) * (i + 0.5),
            0.95,
            z(s, 0.18),
            0,
            0,
            (i % 2 ? 1 : -1) * Math.atan2(1.9, L / n),
          );
        k.box(tm, L, 0.3, 0.3, 0, 1.9, z(s, 0.3));
        k.box(tm, L, 0.2, 0.24, 0, 0.1, z(s, 0.24));
        for (let i = 0; i <= n; i++) {
          const x = -L / 2 + (L / n) * i;
          k.box(tm, 0.2, 1.9, 0.2, x, 0.95, z(s, 0.2));
          k.box(tm, 0.5, 0.5, 0.06, x, 1.75, s * (D / 2 - 0.03));
        }
        for (let i = 0; i < n; i++) {
          const x0 = -L / 2 + (L / n) * i,
            x1 = x0 + L / n,
            up = i % 2 ? 0.1 : 1.9;
          k.bar(tm, [x0, up, z(s, 0.18)], [x1, 2 - up, z(s, 0.18)], 0.18);
        }
      }
    } else if (style === 'dunes') {
      // 風化的石造護牆（有缺口、壓頂石）＋板面上的積沙
      const n = Math.max(2, Math.round(L / 4));
      for (const s of [-1, 1])
        for (let i = 0; i < n; i++) {
          if ((i * 7 + (s > 0 ? 3 : 0)) % 5 === 0) continue;
          const x = -L / 2 + (L / n) * (i + 0.5);
          k.ob((L / n) * 0.8, 0.8, 0.5, x, 0.4, z(s, 0.5));
          k.cb(tm, (L / n) * 0.8, 0.7, 0.44, x, 0.35, z(s, 0.5), 0, 0, 0, 0.08);
          k.cb(tm, (L / n) * 0.8, 0.14, 0.5, x, 0.73, z(s, 0.5), 0, 0, 0, 0.04);
        }
      const sand = fadeMat(0xd4b483, { roughness: 1 });
      k.cb(sand, L * 0.6, 0.25, D * 0.3, 0, 0.12, D * 0.2, 0, 0, 0, 0.1);
    } else {
      // 冰原：板面積雪＋護欄座與鋼欄杆＋板下冰柱
      k.cb(tm, L - 0.3, 0.2, D - 0.3, 0, 0.1, 0, 0, 0, 0, 0.08);
      const rm = fadeMat(0x3d434a, { roughness: 0.7 });
      for (const s of [-1, 1]) {
        k.ob(L, 0.9, 0.3, 0, 0.45, z(s, 0.3));
        k.cb(rm, L, 0.4, 0.3, 0, 0.2, z(s, 0.3), 0, 0, 0, 0.05);
        railing(k, rm, L - 0.2, 0.46, 0, 0.4, z(s, 0.12), 0, 2, 0.07);
        k.box(tm, L, 0.12, 0.34, 0, 0.46, z(s, 0.3));
      }
      const ice = fadeMat(0xcfe8f4, { roughness: 0.15 });
      const n = Math.max(3, Math.round(L / 2));
      for (const s of [-1, 1])
        for (let i = 0; i < n; i++) {
          const t = -L / 2 + (L / n) * (i + 0.5);
          const len = 0.5 + ((i * 37 + (s > 0 ? 11 : 0)) % 7) * 0.12;
          k.ob(0.2, len, 0.2, t, -thick - len / 2, s * (D / 2 - 0.2));
          k.geo(
            ice,
            unitGeo('icicle', () => new THREE.ConeGeometry(0.12, 1, 5)),
            t,
            -thick - len / 2,
            s * (D / 2 - 0.2),
            Math.PI,
            0,
            0,
            1,
            len,
            1,
          );
        }
    }
  });
  return k.build();
}
// 支柱：原點在中心（呼叫端把位置設在支柱中心；GLB 原點在底面，以半徑 0.6、高 6 m 製作）
export function buildThemePillar(style, r, h) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_pillar', {
    color: C.pillar,
    ref: [1.2, 6, 1.2],
    size: [r * 2, h, r * 2],
    y: -h / 2,
  });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].pillar(r, h, C);
  const m = mat(C.pillar, { roughness: 0.85, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  const k = new PK();
  if (style === 'wasteland') {
    // 格子鋼塔：四角材＋橫材＋單向斜撐＋底板與頂部承板
    const a = r * 0.75;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(m, 0.18, h, 0.18, sx * a, 0, sz * a);
    let yp = -h / 2 + 0.12,
      i = 0;
    for (let y = -h / 2 + 1; y < h / 2; y += 1.6, i++) {
      k.box(m, a * 2, 0.12, 0.12, 0, y, a);
      k.box(m, a * 2, 0.12, 0.12, 0, y, -a);
      k.box(m, 0.12, 0.12, a * 2, a, y, 0);
      k.box(m, 0.12, 0.12, a * 2, -a, y, 0);
      const f = i % 2 ? 1 : -1;
      k.bar(m, [-f * a, yp, a], [f * a, y, a], 0.08);
      k.bar(m, [a, yp, f * a], [a, y, -f * a], 0.08);
      yp = y;
    }
    k.box(DETAIL.dark, a * 2 + 0.18, 0.1, a * 2 + 0.18, 0, -h / 2 + 0.05, 0);
    k.box(m, a * 2 + 0.18, 0.16, a * 2 + 0.18, 0, h / 2 - 0.08, 0);
  } else if (style === 'dunes') {
    // 石柱：柱身＋上下的石帶＋柱身的凹槽線
    k.cyl(m, r * 0.85, r, h, 0, 0, 0, 0, 0, 0, 8);
    const band = mat(0x8e7656, { roughness: 1 });
    for (const y of [-h / 2 + 0.3, h / 2 - 0.3]) k.cyl(band, r * 1.15, r * 1.15, 0.6, 0, y, 0, 0, 0, 0, 8);
    k.cyl(band, r * 1.05, r * 1.05, 0.2, 0, h / 2 - 0.75, 0, 0, Math.PI / 8, 0, 8);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.box(band, 0.08, h - 1.6, 0.06, Math.sin(a) * r * 0.92, 0, Math.cos(a) * r * 0.92, 0, a, 0);
    }
  } else {
    // 冰原：鋼筋混凝土柱＋冰的底座＋頂部積雪＋警示帶
    k.cyl(m, r, r * 1.1, h, 0, 0, 0, 0, Math.PI / 8, 0, 8);
    k.cyl(mat(0xcfe8f4, { roughness: 0.15 }), r * 1.25, r * 1.4, 0.8, 0, -h / 2 + 0.4, 0, 0, 0, 0, 8);
    k.cyl(
      mat(0xf2f6fa, { roughness: 0.95 }),
      r * 1.05,
      r * 1.05,
      0.25,
      0,
      h / 2 - 0.1,
      0,
      0,
      Math.PI / 8,
      0,
      8,
    );
    k.cyl(DETAIL.yellow, r * 1.08, r * 1.12, 0.3, 0, -h / 2 + 1.2, 0, 0, Math.PI / 8, 0, 8);
    k.cyl(DETAIL.dark, r * 1.04, r * 1.04, 0.12, 0, h / 2 - 0.6, 0, 0, Math.PI / 8, 0, 8);
  }
  return k.build();
}
// 掩體的側牆：w × h × d（中心在原點）
export function buildThemeWall(style, w, h, d) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_wall', {
    color: C.wall,
    ref: [10, 5, 0.8],
    size: w > d ? [w, h, d] : [d, h, w],
    rotY: w > d ? 0 : Math.PI / 2,
    fade: true,
  });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].wall(w, h, d, C);
  const m = fadeMat(C.wall, { roughness: 0.75, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  const along = w > d;
  const L = along ? w : d,
    T = along ? d : w;
  // 長邊沿 X 建造，沿 Z 時轉 −90°（區域 +X 對到 +Z，和原本的排列方向相同）
  const k = new PK();
  k.at(0, 0, 0, 0, along ? 0 : -Math.PI / 2, 0, () => {
    if (style === 'wasteland') {
      // 波浪鐵皮：一片片前後錯開（外框同原本）；凹下去的那幾片上有 H 型鋼的立柱與上下橫樑（深色，不超出外框）
      const n = Math.max(3, Math.round(L / 0.8));
      for (let i = 0; i < n; i++)
        k.box(m, L / n + 0.02, h, T * (i % 2 ? 0.7 : 1), -L / 2 + (L / n) * (i + 0.5), 0, 0);
      const dk = DETAIL.dark;
      for (let i = 1; i < n; i += 4) {
        const x = -L / 2 + (L / n) * (i + 0.5);
        k.box(dk, 0.28, h, T, x, 0, 0);
        for (const y of [-h / 2 + 0.3, h / 2 - 0.3]) k.box(dk, L / n, 0.16, T * 0.92, x, y, 0);
      }
    } else if (style === 'dunes') {
      // 沙袋：一層層錯開堆疊（上面略收，看起來圓一點；外框同原本的方塊）
      const rows = Math.max(3, Math.round(h / 0.55));
      for (let r = 0; r < rows; r++) {
        const n = Math.max(3, Math.round(L / 1.1));
        const off = r % 2 ? 0.5 : 0;
        for (let i = 0; i < n; i++) {
          const at = -L / 2 + (L / n) * (i + 0.5 + off);
          if (at > L / 2) continue;
          k.ob(L / n - 0.08, h / rows - 0.05, T, at, -h / 2 + (h / rows) * (r + 0.5), 0); // 外框同原本的方塊
          k.geo(
            m,
            unitGeo('sandbag', () => new THREE.CylinderGeometry(0.42, 0.5, 1, 4, 1).rotateY(Math.PI / 4)),
            at,
            -h / 2 + (h / rows) * (r + 0.5),
            0,
            0,
            0,
            0,
            (L / n - 0.08) / 0.707,
            h / rows - 0.05,
            T / 0.707,
          );
        }
      }
    } else {
      // 隔熱板：白／橘相間＋板間的鋁框與螺栓＋頂部積雪
      const n = Math.max(2, Math.round(L / 2));
      const orange = fadeMat(0xd8742a, { roughness: 0.6 });
      for (let i = 0; i < n; i++) {
        const x = -L / 2 + (L / n) * (i + 0.5);
        k.cb(i % 3 === 1 ? orange : m, L / n - 0.06, h, T, x, 0, 0, 0, 0, 0, 0.05);
        if (i)
          for (const s of [-1, 1]) k.box(DETAIL.steel, 0.1, h, 0.04, x - L / n / 2, 0, s * (T / 2 + 0.01));
      }
      k.box(DETAIL.steel, L, 0.12, T + 0.08, 0, -h / 2 + 0.3, 0);
      k.cb(fadeMat(0xf2f6fa, { roughness: 0.95 }), L, 0.25, T + 0.2, 0, h / 2 + 0.12, 0, 0, 0, 0, 0.1);
    }
  });
  return k.build();
}
// 高台：w × h × d，原點在底面中心（呼叫端放在 y0 − 0.5）
export function buildThemePlatform(style, w, h, d) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_platform', {
    color: C.plat,
    ref: [14, 5.5, 14],
    size: [w, h, d],
    fade: true,
  });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].platform(w, h, d, C);
  const m = fadeMat(C.plat, { roughness: style === 'snow' ? 0.2 : 0.95, metalness: 0.05 });
  const k = new PK();
  k.cb(m, w, h, d, 0, h / 2, 0, 0, 0, 0, style === 'snow' ? 0.35 : 0.15);
  if (style === 'wasteland') {
    // 礦渣台：木樁擋土（兩道橫木）＋頂面碎石＋一側的爬梯
    const post = fadeMat(0x5a4030, { roughness: 1 });
    for (const [sx, sz, len, alongX] of [
      [0, 1, w, true],
      [0, -1, w, true],
      [1, 0, d, false],
      [-1, 0, d, false],
    ]) {
      const n = Math.max(2, Math.round(len / 1.6));
      for (let i = 0; i <= n; i++) {
        const t = -len / 2 + (len / n) * i;
        k.box(
          post,
          0.35,
          h + 0.4,
          0.35,
          alongX ? t : sx * (w / 2 + 0.1),
          (h + 0.4) / 2,
          alongX ? sz * (d / 2 + 0.1) : t,
        );
      }
      for (const y of [h * 0.3, h * 0.75])
        k.box(
          post,
          alongX ? len : 0.14,
          0.22,
          alongX ? 0.14 : len,
          alongX ? 0 : sx * (w / 2 + 0.2),
          y,
          alongX ? sz * (d / 2 + 0.2) : 0,
        );
    }
    k.box(fadeMat(0x3e3530, { roughness: 1 }), w - 0.6, 0.15, d - 0.6, 0, h + 0.05, 0);
    ladder(k, DETAIL.dark, h + 0.4, w * 0.25 + 0.4, 0, d / 2 + 0.22);
  } else if (style === 'dunes') {
    // 石台座：上下兩道外凸的石帶＋四角的角柱＋石塊接縫
    const band = fadeMat(0x8e7656, { roughness: 1 });
    k.cb(band, w + 0.5, 0.6, d + 0.5, 0, 0.3, 0, 0, 0, 0, 0.1);
    k.cb(band, w + 0.3, 0.5, d + 0.3, 0, h - 0.25, 0, 0, 0, 0, 0.08);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        k.cb(band, 1, h - 1.1, 1, sx * (w / 2 - 0.35), h / 2 + 0.05, sz * (d / 2 - 0.35), 0, 0, 0, 0.1);
    for (let y = 1.5; y < h - 1; y += 1.4) {
      k.box(band, w + 0.04, 0.08, d - 1.6, 0, y, 0);
      k.box(band, w - 1.6, 0.08, d + 0.04, 0, y, 0);
    }
  } else {
    // 冰台：頂面積雪（倒角，邊緣垂下）
    const snow = fadeMat(0xf2f6fa, { roughness: 0.95 });
    k.cb(snow, w + 0.1, 0.4, d + 0.1, 0, h - 0.15, 0, 0, 0, 0, 0.15);
    for (const sx of [-1, 1]) k.cb(snow, 0.1, 0.6, d * 0.6, sx * (w / 2), h - 0.5, d * 0.1, 0, 0, 0, 0.03);
  }
  return k.build();
}
// 坡道板：rw × 0.4 × rd，原點在中心；護欄沿長邊；GLB 以 12 × 0.4 × 6 m（長邊沿 X）製作
export function buildThemeRamp(style, rw, rd) {
  const C = FEATURE_COLORS[style];
  const alongX = rw >= rd;
  const glb = propGlb(style + '_ramp', {
    color: C.plat,
    ref: [12, 0.4, 6],
    size: alongX ? [rw, 0.4, rd] : [rd, 0.4, rw],
    rotY: alongX ? 0 : Math.PI / 2,
  });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].ramp(rw, rd, C);
  const k = new PK();
  const pm = mat(style === 'snow' ? 0xe9eef2 : C.plat, { roughness: 0.95 });
  const tm = mat(style === 'wasteland' ? 0x5a4030 : C.trim, { roughness: 0.9 });
  // 長邊沿 X 建造：坡道板＋止滑橫條＋兩側護緣（每段有支柱，不超出原本的外框）
  const L = alongX ? rw : rd,
    D = alongX ? rd : rw;
  k.at(0, 0, 0, 0, alongX ? 0 : Math.PI / 2, 0, () => {
    k.cb(pm, L, 0.4, D, 0, 0, 0, 0, 0, 0, 0.06);
    const n = Math.max(2, Math.round(L / 0.9));
    for (let i = 0; i < n; i++) k.box(tm, 0.12, 0.06, D - 0.8, -L / 2 + (L / n) * (i + 0.5), 0.22, 0);
    for (const s of [-1, 1]) {
      k.cb(tm, L, 0.35, 0.3, 0, 0.35, s * (D / 2 - 0.15), 0, 0, 0, 0.05);
      const np = Math.max(1, Math.round(L / 3));
      for (let i = 0; i <= np; i++)
        k.box(tm, 0.18, 0.4, 0.3, -L / 2 + 0.1 + ((L - 0.2) / np) * i, 0.32, s * (D / 2 - 0.15));
    }
  });
  return k.build();
}
// 隧道口：原點在地面中心，開口朝 −Z（同 buildTunnelPortal）
export function buildThemeTunnel(style) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_tunnel', { color: C.rock });
  if (glb) return glb;
  if (FEATURE_IMPL[style]) return FEATURE_IMPL[style].tunnel(C);
  const k = new PK(),
    D = DETAIL;
  const rock = mat(C.rock, { roughness: 1 });
  // 外框同原本
  if (style === 'wasteland') k.bounds(-12, -2, -11, 12, 12, 1.4);
  else if (style === 'snow') k.bounds(-13, -2, -11.5, 13, 13, 6.05);
  else k.bounds(-12, -2.003, -11, 12, 12, 5.747);
  k.cb(rock, 24, 14, 10, 0, 5, -6, 0, 0, 0, 1.6);
  k.box(HOLE, 8, 6.5, 2.8, 0, 3.25, 0);
  if (style === 'wasteland') {
    // 木框礦坑口：門柱＋橫樑＋斜撐＋警示牌＋燈
    const wood = mat(0x5a4030, { roughness: 1 });
    for (const sx of [-4.4, 4.4]) {
      k.cb(wood, 0.8, 7.2, 0.8, sx, 3.6, 0.6, 0, 0, 0, 0.08);
      k.bar(wood, [sx, 5.6, 0.8], [sx * 0.7, 7.0, 0.8], 0.35);
    }
    k.cb(wood, 10, 0.9, 1, 0, 7.4, 0.6, 0, 0, 0, 0.08);
    hazard(k, D.yellow, D.black, 3.4, 0.5, 0, 7.4, 1.12);
    k.box(D.lamp, 0.4, 0.2, 0.2, -2.8, 6.8, 1.0);
    k.cb(rock, 12, 3, 2.5, 0, 9.5, 0, 0, 0, 0, 0.5);
    for (const sx of [-1, 1]) k.cb(rock, 3, 8, 2.5, sx * 6.5, 4, 0, 0, 0, 0, 0.5);
  } else if (style === 'dunes') {
    // 半埋拱門（拱石、拱心石）＋門柱＋沙坡
    const stone = mat(0xa88d68, { roughness: 1 }),
      dark = mat(0x8e7656, { roughness: 1 });
    k.geo(stone, new THREE.TorusGeometry(5, 1, 6, 12, Math.PI), 0, 2.2, 0.6);
    k.geo(dark, new THREE.TorusGeometry(5, 1.08, 4, 12, Math.PI), 0, 2.2, 0.6, 0, 0, 0, 1, 1, 0.35);
    k.cb(dark, 1.4, 1.8, 2.4, 0, 7.4, 0.6, 0, 0, 0, 0.15);
    for (const sx of [-1, 1]) {
      k.cb(stone, 2, 3, 2.2, sx * 5, 1.1, 0.6, 0, 0, 0, 0.15);
      k.cb(dark, 2.4, 0.4, 2.6, sx * 5, 2.6, 0.6, 0, 0, 0, 0.08);
    }
    k.box(mat(0xd4b483, { roughness: 1 }), 16, 2.5, 6, 0, 0.2, 2.5, -0.35, 0, 0);
  } else {
    // 防雪棚：A 字屋頂（桁條）＋積雪＋側牆的鋼柱＋燈
    const m = mat(0x5a6068, { roughness: 0.8 }),
      snow = mat(0xf2f6fa, { roughness: 0.95 });
    for (const sx of [-1, 1]) {
      k.box(m, 6.4, 0.5, 8, sx * 2.6, 7.3, 2, 0, 0, -sx * 0.55);
      k.box(snow, 6.4, 0.35, 8.1, sx * 2.5, 7.75, 2, 0, 0, -sx * 0.55);
      k.box(m, 0.6, 6.5, 8, sx * 4.6, 3.25, 2);
      for (const z of [-1.6, 0.4, 2.4, 4.4, 5.9]) k.box(D.dark, 0.3, 6.6, 0.3, sx * 4.95, 3.3, z);
      k.box(D.lamp, 0.25, 0.4, 0.6, sx * 4.2, 5.6, 5.5);
    }
    k.box(D.dark, 0.4, 0.4, 8.2, 0, 8.9, 2);
    hazard(k, D.yellow, D.black, 8.6, 0.5, 0, 6.2, 6.02);
    k.box(snow, 26, 1.2, 11, 0, 12.4, -6);
  }
  return k.build();
}
