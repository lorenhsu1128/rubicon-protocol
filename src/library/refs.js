// 檢視窗的尺寸參考物（單位：公尺）：格線地板、垂直刻度尺、1.8 m 人形剪影、三向尺寸標線與外框
// 回傳的 labels 由檢視窗每幀投影到畫面上顯示
const DIM_COLOR = 0xffb020;
const BOX_COLOR = 0x5cc8ff;

function lines(points, color, opacity = 1) {
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false });
  const l = new THREE.LineSegments(g, m);
  l.renderOrder = 10;
  return l;
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
// 讓刻度數量落在 4～12 之間的「好看」間距
export function niceStep(len) {
  for (const s of [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10]) if (len / s <= 12) return s;
  return 20;
}
const fmt = (v) => (Math.round(v * 100) / 100).toString();

// 地板格線：每 1 m 一格、每 5 m 加粗（跟模型一起在原點，不隨模型旋轉）
export function buildGrid(size) {
  const span = Math.max(10, Math.ceil((Math.max(size.x, size.z) * 2 + 6) / 10) * 10);
  const g = new THREE.Group();
  const minor = new THREE.GridHelper(span, span, 0x2a3644, 0x2a3644);
  const major = new THREE.GridHelper(span, span / 5, 0x4a5a6c, 0x4a5a6c);
  minor.position.y = 0.002;
  major.position.y = 0.004;
  g.add(minor, major);
  return g;
}

// 垂直刻度尺：放在模型左前方
export function buildRuler(size) {
  const g = new THREE.Group();
  const labels = [];
  const step = niceStep(Math.max(size.y, 0.3));
  const top = Math.max(step, Math.ceil(size.y / step) * step);
  const x = -size.x / 2 - Math.max(0.25, size.x * 0.15),
    z = -size.z / 2;
  const tk = Math.max(0.05, top * 0.03);
  const pts = [V(x, 0, z), V(x, top, z)];
  for (let v = 0; v <= top + 1e-6; v += step) {
    pts.push(V(x - tk, v, z), V(x + tk, v, z));
    labels.push({ pos: V(x - tk, v, z), text: `${fmt(v)} m`, cls: 'tick' });
  }
  g.add(lines(pts, 0xe6edf3, 0.85));
  return { group: g, labels };
}

// 1.8 m 人形剪影：站在模型右側
export function buildHuman(size) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x8a97a6, roughness: 0.85 });
  const box = (w, h, d, x, y) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, 0);
    o.castShadow = true;
    g.add(o);
  };
  for (const s of [-1, 1]) box(0.14, 0.86, 0.16, s * 0.1, 0.43); // 腿
  box(0.42, 0.62, 0.22, 0, 1.17); // 軀幹
  for (const s of [-1, 1]) box(0.1, 0.62, 0.12, s * 0.28, 1.15); // 手臂
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), m);
  head.position.y = 1.69;
  head.castShadow = true;
  g.add(head);
  g.position.x = size.x / 2 + Math.max(0.3, size.x * 0.1) + Math.max(0.6, size.x * 0.15);
  return { group: g, labels: [{ pos: V(g.position.x, 1.95, 0), text: '人 1.8 m', cls: 'human' }] };
}

// 三向尺寸標線與外框（掛在模型的旋轉節點上，跟著模型轉）
export function buildDims(size) {
  const w = size.x,
    h = size.y,
    d = size.z;
  const off = Math.max(0.12, Math.max(w, h, d) * 0.06);
  const tk = off * 0.5;
  const zf = -d / 2 - off,
    xr = w / 2 + off;
  const y0 = 0.01;
  const pts = [
    // 寬（X）：模型正面下方
    V(-w / 2, y0, zf),
    V(w / 2, y0, zf),
    V(-w / 2, y0, zf - tk),
    V(-w / 2, y0, zf + tk),
    V(w / 2, y0, zf - tk),
    V(w / 2, y0, zf + tk),
    // 深（Z）：模型右側下方
    V(xr, y0, -d / 2),
    V(xr, y0, d / 2),
    V(xr - tk, y0, -d / 2),
    V(xr + tk, y0, -d / 2),
    V(xr - tk, y0, d / 2),
    V(xr + tk, y0, d / 2),
    // 高（Y）：右前角
    V(xr, 0, zf),
    V(xr, h, zf),
    V(xr - tk, h, zf),
    V(xr + tk, h, zf),
  ];
  const dims = lines(pts, DIM_COLOR);
  const box = new THREE.Box3Helper(new THREE.Box3(V(-w / 2, 0, -d / 2), V(w / 2, h, d / 2)), BOX_COLOR);
  box.material.transparent = true;
  box.material.opacity = 0.45;
  const labels = [
    { pos: V(0, y0, zf - tk * 2), text: `寬 ${w.toFixed(2)} m`, cls: 'dimL' },
    { pos: V(xr + tk * 3, y0, 0), text: `深 ${d.toFixed(2)} m`, cls: 'dimL' },
    { pos: V(xr + tk * 3, h / 2, zf), text: `高 ${h.toFixed(2)} m`, cls: 'dimL' },
  ];
  return { dims, box, labels };
}
