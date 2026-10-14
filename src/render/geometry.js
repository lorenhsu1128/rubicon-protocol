// --- geometry helpers ---
import { rnd } from '../core/math.js';
import { DECAL } from './materials.js';

const GEO_CACHE = {};
export function gBox(w, h, d) {
  const k = 'b' + w + ',' + h + ',' + d;
  return GEO_CACHE[k] || (GEO_CACHE[k] = new THREE.BoxGeometry(w, h, d));
}
export function gCyl(rt, rb, h, s = 8) {
  const k = 'c' + rt + ',' + rb + ',' + h + ',' + s;
  return GEO_CACHE[k] || (GEO_CACHE[k] = new THREE.CylinderGeometry(rt, rb, h, s));
}
export function gSph(r, s = 8) {
  const k = 's' + r + ',' + s;
  return GEO_CACHE[k] || (GEO_CACHE[k] = new THREE.SphereGeometry(r, s, Math.max(4, s >> 1)));
}
export function gFrustum(tw, td, bw, bd, h) {
  const k = 'f' + [tw, td, bw, bd, h].join(',');
  if (GEO_CACHE[k]) return GEO_CACHE[k];
  const t = [
      [-tw / 2, h / 2, -td / 2],
      [tw / 2, h / 2, -td / 2],
      [tw / 2, h / 2, td / 2],
      [-tw / 2, h / 2, td / 2],
    ],
    b = [
      [-bw / 2, -h / 2, -bd / 2],
      [bw / 2, -h / 2, -bd / 2],
      [bw / 2, -h / 2, bd / 2],
      [-bw / 2, -h / 2, bd / 2],
    ];
  const quads = [
    [t[0], t[1], t[2], t[3]],
    [b[3], b[2], b[1], b[0]],
    [b[0], b[1], t[1], t[0]],
    [b[1], b[2], t[2], t[1]],
    [b[2], b[3], t[3], t[2]],
    [b[3], b[0], t[0], t[3]],
  ];
  const pos = [],
    uv = [];
  for (const q of quads) {
    for (const i of [0, 2, 1, 0, 3, 2]) pos.push(...q[i]);
    uv.push(0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  GEO_CACHE[k] = g;
  return g;
}
// ----- 有輪廓的裝甲：放樣與倒角擠出 -----
// 多邊形 [[x, y]…] 的有號面積（正＝逆時針）
function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i],
      [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
// 多邊形往內縮 c（每條邊平移後求交點；尖角的位移限制在 3c，不會翻轉）
function polyInset(pts, c) {
  const n = pts.length,
    out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i + n - 1) % n],
      q = pts[i],
      r = pts[(i + 1) % n];
    const e1 = [q[0] - p[0], q[1] - p[1]],
      e2 = [r[0] - q[0], r[1] - q[1]];
    const l1 = Math.hypot(e1[0], e1[1]) || 1,
      l2 = Math.hypot(e2[0], e2[1]) || 1;
    // 逆時針多邊形的內側法線＝邊方向往左轉
    const n1 = [-e1[1] / l1, e1[0] / l1],
      n2 = [-e2[1] / l2, e2[0] / l2];
    let bx = n1[0] + n2[0],
      by = n1[1] + n2[1];
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl;
    by /= bl;
    const cos = bx * n1[0] + by * n1[1];
    const k = Math.min(c / Math.max(cos, 0.2), c * 3);
    out.push([q[0] + bx * k, q[1] + by * k]);
  }
  return out;
}
// 放樣：rings＝[{ pts: [[x, y]…], z }…]（z 由小到大、每圈點數相同），兩端以三角化的面封口
// 每個面（側面的四邊形、封口）各自 0～1 的貼圖座標，和方塊一樣讓面板法線貼圖在每個面都有邊緣高光
export function gLoft(rings) {
  const k = 'L' + JSON.stringify(rings);
  if (GEO_CACHE[k]) return GEO_CACHE[k];
  const ccw = polyArea(rings[0].pts) > 0;
  const R = rings.map((r) => ({ z: r.z, pts: ccw ? r.pts : r.pts.slice().reverse() }));
  const pos = [],
    uv = [];
  const n = R[0].pts.length;
  for (let i = 0; i < R.length - 1; i++) {
    const A = R[i],
      B = R[i + 1];
    for (let j = 0; j < n; j++) {
      const a0 = [...A.pts[j], A.z],
        b0 = [...A.pts[(j + 1) % n], A.z],
        a1 = [...B.pts[j], B.z],
        b1 = [...B.pts[(j + 1) % n], B.z];
      pos.push(...a0, ...b0, ...b1, ...a0, ...b1, ...a1);
      uv.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
    }
  }
  const cap = (ring, front) => {
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.pts.map((p) => new THREE.Vector2(p[0], p[1])),
      [],
    );
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const [x, y] of ring.pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    for (const t of tris) {
      let [a, b, c] = t.map((i) => ring.pts[i]);
      // 朝 +z 的封口要逆時針、朝 −z 的要順時針
      const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cz > 0 !== front) [b, c] = [c, b];
      for (const p of [a, b, c]) {
        pos.push(p[0], p[1], ring.z);
        uv.push((p[0] - x0) / (x1 - x0 || 1), (p[1] - y0) / (y1 - y0 || 1));
      }
    }
  };
  cap(R[0], false);
  cap(R[R.length - 1], true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  GEO_CACHE[k] = g;
  return g;
}
function scalePts(pts, s) {
  const sx = Array.isArray(s) ? s[0] : s,
    sy = Array.isArray(s) ? s[1] : s;
  // 以外框中心縮放，輪廓不會往原點偏
  const xs = pts.map((p) => p[0]),
    ys = pts.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2,
    cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  return pts.map(([x, y]) => [cx + (x - cx) * sx, cy + (y - cy) * sy]);
}
// 倒角擠出：輪廓 pts（XY 平面，原點附近）沿 Z 擠出厚度 d，兩面的邊都切掉 c 的倒角
// sf／sb：前面（−z）／後面（+z）的輪廓以外框中心縮放（數字或 [sx, sy]），做出往一面收的斜面裝甲
export function gPlate(pts, d, c = 0.02, sf = 1, sb = 1) {
  if (polyArea(pts) < 0) pts = pts.slice().reverse();
  const cc = Math.min(c, d / 3);
  const f = scalePts(pts, sf),
    b = scalePts(pts, sb);
  return gLoft([
    { pts: polyInset(f, cc), z: -d / 2 },
    { pts: f, z: -d / 2 + cc },
    { pts: b, z: d / 2 - cc },
    { pts: polyInset(b, cc), z: d / 2 },
  ]);
}
// 切角截面的放樣：secs＝[[z, 寬, 底, 頂, 上切角, 下切角]…]（z 由前（−）到後），
// 每個截面是上下四角切掉的八角形，前後截面大小不同就成了楔形的胸部、頭盔
export function gPod(secs) {
  return gLoft(
    secs.map(([z, w, yb, yt, ct, cb]) => {
      const h = w / 2;
      return {
        z,
        pts: [
          [-h + cb, yb],
          [h - cb, yb],
          [h, yb + cb],
          [h, yt - ct],
          [h - ct, yt],
          [-h + ct, yt],
          [-h, yt - ct],
          [-h, yb + cb],
        ],
      };
    }),
  );
}
// 側面輪廓 [[z, y]…]（z 往前為負）沿 X 擠出寬度 w：搭配 P(…, 0, Math.PI / 2, 0) 擺放
// （繞 Y 轉 90° 時，區域的 x＝−世界 z、區域的 z＝世界 x）
export function sideProfile(zy) {
  return zy.map(([z, y]) => [-z, y]);
}
function gWedge(w, h, d) {
  return gFrustum(w * 0.35, d, w, d, h);
}
// triangular prism: triangle cross-section in XY (apex +y), extruded along Z
function gTri(w, h, d, apexX = 0) {
  const k = 't' + [w, h, d, apexX].join(',');
  if (GEO_CACHE[k]) return GEO_CACHE[k];
  const A = [-w / 2, -h / 2],
    B = [w / 2, -h / 2],
    C = [(apexX * w) / 2, h / 2];
  const f = d / 2,
    bk = -d / 2;
  const pos = [],
    uv = [];
  const tri = (a, b, c) => {
    pos.push(...a, ...c, ...b);
    uv.push(0, 0, 0.5, 1, 1, 0);
  };
  tri([A[0], A[1], f], [B[0], B[1], f], [C[0], C[1], f]);
  tri([B[0], B[1], bk], [A[0], A[1], bk], [C[0], C[1], bk]);
  const quad = (a, b, c, dd) => {
    pos.push(...a, ...c, ...b, ...a, ...dd, ...c);
    uv.push(0, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1);
  };
  quad([A[0], A[1], bk], [B[0], B[1], bk], [B[0], B[1], f], [A[0], A[1], f]);
  quad([B[0], B[1], bk], [C[0], C[1], bk], [C[0], C[1], f], [B[0], B[1], f]);
  quad([C[0], C[1], bk], [A[0], A[1], bk], [A[0], A[1], f], [C[0], C[1], f]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  GEO_CACHE[k] = g;
  return g;
}
// blade plate: tapers to an edge at the top (tw≈0) — the streamlined armour fin used all over the slim design
function gBlade(bw, bd, h, tw = 0.04, td = 0.05) {
  return gFrustum(Math.max(tw, 0.04), Math.max(td, 0.05), bw, bd, h);
}
// diamond cross-section limb: two triangular prisms mirrored (lozenge)
function LZ(node, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, apex = 0.5) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  g.updateMatrix();
  const mm = g.matrix;
  if (!node.userData.prims) node.userData.prims = [];
  const t1 = new THREE.Matrix4().makeTranslation(0, h * apex * 0.5, 0).premultiply(mm);
  const t2 = new THREE.Matrix4()
    .makeRotationX(Math.PI)
    .premultiply(new THREE.Matrix4().makeTranslation(0, -h * (1 - apex) * 0.5, 0))
    .premultiply(mm);
  node.userData.prims.push({ geo: gTri(w, h * apex, d), m, mm: t1 });
  node.userData.prims.push({ geo: gTri(w, h * (1 - apex), d), m, mm: t2 });
}
// hexagonal armor slab (6-sided prism lying flat) — the reference art uses these everywhere
function gHexSlab(r, h) {
  return gCyl(r, r, h, 6);
}

export function P(node, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  if (!node.userData.prims) node.userData.prims = [];
  const mm = new THREE.Matrix4();
  mm.compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
  node.userData.prims.push({ geo, m, mm });
}
// chamfered box = mid box + top/bottom frustums (bevelled edges like the concept art)
export function CB(node, w, h, d, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, c = 0.06) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.set(rx, ry, rz);
  const mm = new THREE.Matrix4();
  g.updateMatrix();
  mm.copy(g.matrix);
  const add = (geo, ox, oy, oz) => {
    const m2 = new THREE.Matrix4().makeTranslation(ox, oy, oz).premultiply(mm);
    if (!node.userData.prims) node.userData.prims = [];
    node.userData.prims.push({ geo, m, mm: m2 });
  };
  const cc = Math.min(c, h / 3, w / 3, d / 3);
  add(gBox(w, h - 2 * cc, d), 0, 0, 0);
  add(gFrustum(w - 2 * cc, d - 2 * cc, w, d, cc), 0, h / 2 - cc / 2, 0);
  add(gFrustum(w, d, w - 2 * cc, d - 2 * cc, cc), 0, -h / 2 + cc / 2, 0);
}
export function mergeGeos(list) {
  const pos = [],
    nor = [],
    uv = [];
  const n = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const { geo, mm } of list) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position,
      nn = g.attributes.normal,
      u = g.attributes.uv;
    nm.getNormalMatrix(mm);
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mm);
      pos.push(v.x, v.y, v.z);
      n.set(nn.getX(i), nn.getY(i), nn.getZ(i)).applyMatrix3(nm).normalize();
      nor.push(n.x, n.y, n.z);
      if (u) uv.push(u.getX(i), u.getY(i));
      else uv.push(0, 0);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  // smoothed normals for the ink outline (avoid cracks at hard edges)
  const map = new Map();
  const sm = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 3) {
    const k = pos[i].toFixed(3) + ',' + pos[i + 1].toFixed(3) + ',' + pos[i + 2].toFixed(3);
    const e = map.get(k) || [0, 0, 0];
    e[0] += nor[i];
    e[1] += nor[i + 1];
    e[2] += nor[i + 2];
    map.set(k, e);
  }
  for (let i = 0; i < pos.length; i += 3) {
    const e = map.get(pos[i].toFixed(3) + ',' + pos[i + 1].toFixed(3) + ',' + pos[i + 2].toFixed(3));
    const L = Math.hypot(e[0], e[1], e[2]) || 1;
    sm[i] = e[0] / L;
    sm[i + 1] = e[1] / L;
    sm[i + 2] = e[2] / L;
  }
  g.setAttribute('onormal', new THREE.BufferAttribute(sm, 3));
  return g;
}
// 墨線描邊（放大的背面外殼）。alpha 0.5＝機體類（見 render/style/shader.js：後處理的描線以 alpha 分辨機體與地形）
export const OUTLINE_MAT = new THREE.ShaderMaterial({
  uniforms: { th: { value: 0.012 } },
  vertexShader:
    'attribute vec3 onormal; uniform float th; void main(){ vec4 mv=modelViewMatrix*vec4(position+onormal*th,1.0); gl_Position=projectionMatrix*mv; }',
  fragmentShader: 'void main(){ gl_FragColor=vec4(0.03,0.035,0.05,0.5); }',
  side: THREE.BackSide,
});
function bake(node, outline = true) {
  const prims = node.userData.prims;
  if (!prims) return;
  const byMat = new Map();
  for (const p of prims) {
    if (!byMat.has(p.m)) byMat.set(p.m, []);
    byMat.get(p.m).push(p);
  }
  for (const [m, list] of byMat) {
    const geo = mergeGeos(list);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    node.add(mesh);
  }
  if (outline) {
    const o = new THREE.Mesh(mergeGeos(prims.filter((p) => p.m.type !== 'MeshBasicMaterial')), OUTLINE_MAT);
    o.castShadow = false;
    node.add(o);
  }
  node.userData.prims = null;
}
export function bakeAll(root) {
  root.traverse((o) => {
    if (o.isGroup) bake(o);
  });
}
// decal plane
export function decal(node, tile, w, h, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.MeshBasicMaterial({
    map: DECAL,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  const uv = mesh.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (tile % 4) / 4 + uv.getX(i) / 4, 0.5 * (1 - Math.floor(tile / 4)) + uv.getY(i) * 0.5);
  }
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  node.add(mesh);
}

// --- detail kits ---
function kitPiston(node, M, x1, y1, z1, x2, y2, z2, r = 0.05) {
  const dx = x2 - x1,
    dy = y2 - y1,
    dz = z2 - z1;
  const L = Math.hypot(dx, dy, dz);
  const mx = (x1 + x2) / 2,
    my = (y1 + y2) / 2,
    mz = (z1 + z2) / 2;
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx, dy, dz).normalize(),
  );
  const e = new THREE.Euler().setFromQuaternion(q);
  P(node, gCyl(r, r, L, 6), M.joint, mx, my, mz, e.x, e.y, e.z);
  P(
    node,
    gCyl(r * 1.7, r * 1.7, L * 0.45, 6),
    M.sub,
    x1 + dx * 0.25,
    y1 + dy * 0.25,
    z1 + dz * 0.25,
    e.x,
    e.y,
    e.z,
  );
  P(node, gCyl(r * 2.2, r * 2.2, 0.06, 6), M.joint, x1, y1, z1, e.x, e.y, e.z);
}
export function kitVents(node, M, x, y, z, n, w, ry = 0, gap = 0.09) {
  for (let i = 0; i < n; i++) P(node, gBox(w, 0.045, 0.16), M.sub, x, y - i * gap, z, 0, ry);
  P(
    node,
    gBox(w * 1.3, gap * n + 0.02, 0.03, M.joint),
    M.joint,
    x,
    y - (gap * (n - 1)) / 2,
    z - (ry ? 0 : 0.08),
    0,
    ry,
  );
}
export function kitBolts(node, M, pts, r = 0.035) {
  for (const [x, y, z, rx, ry, rz] of pts)
    P(node, gCyl(r, r, 0.03, 6), M.joint, x, y, z, rx === undefined ? Math.PI / 2 : rx, ry || 0, rz || 0);
}
export function kitGrille(node, M, x, y, z, w, h, n, ry = 0) {
  P(node, gBox(w + 0.06, h + 0.06, 0.05), M.sub, x, y, z, 0, ry);
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1) - 0.5) * h;
    P(node, gBox(w, 0.03, 0.08), M.joint, x + (ry ? 0 : 0), y + t, z + (ry ? 0 : 0.02), 0, ry);
  }
}
export function kitCable(node, M, pts, r = 0.035) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(dx, dy, dz).normalize(),
    );
    const e = new THREE.Euler().setFromQuaternion(q);
    P(
      node,
      gCyl(r, r, L + r, 5),
      M.rubber,
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2,
      e.x,
      e.y,
      e.z,
    );
    P(node, gSph(r * 1.05, 5), M.rubber, b[0], b[1], b[2]);
  }
}
function kitGreeble(node, M, x, y, z, w, h, d, n) {
  for (let i = 0; i < n; i++)
    P(
      node,
      gBox(rnd(0.08, 0.2) * w, rnd(0.06, 0.14) * h, rnd(0.08, 0.2) * d),
      Math.random() < 0.5 ? M.sub : M.joint,
      x + rnd(-0.5, 0.5) * w,
      y + rnd(-0.5, 0.5) * h,
      z + rnd(-0.5, 0.5) * d,
    );
}
function kitHex(node, M, x, y, z, r, rx = Math.PI / 2, ry = 0, rz = 0) {
  P(node, gHexSlab(r, 0.06), M.main3, x, y, z, rx, ry, rz);
  P(node, gCyl(r * 0.4, r * 0.4, 0.03, 6), M.joint, x, y, z - 0.04, rx, ry, rz);
}
