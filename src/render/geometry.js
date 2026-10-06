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
