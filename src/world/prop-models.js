// 地圖物件的網格建造（純函式，不使用亂數）：關卡生成以亂數決定參數後呼叫這裡，模型庫也直接使用。
// 修改這裡的幾何會改變所有種子產生的地圖外觀，但不影響亂數序列（多人各端仍一致）。
import { OUTLINE_MAT } from '../render/geometry.js';
import { materialSlot } from '../render/glb.js';
import { providedModel } from '../render/model-provider.js';

const MatCache = {};

// ---------- 本地模型庫的 GLB（單人模式，見 render/model-provider.js）----------
// GLB 以模型庫的代表尺寸（ref）製作，遊戲依實際尺寸（size，GLB 本身的 X／Y／Z）分別縮放；rotY 再繞 Y 轉；
// y：GLB 原點相對於回傳群組的高度（呼叫端把群組放在物件中心時用）。命名為 main 的材質改成物件的顏色；
// 不加描邊（與程式模型一致）；fade：材質設為可透明（擋住鏡頭時半透明）
const PROP_MATS = new WeakMap();
// 換成 GLB 時的材質清單（遮擋半透明、受擊閃光用）；程式模型為 null
export const propMats = (obj) => PROP_MATS.get(obj) || null;
function propGlb(slot, { color, ref, size, rotY = 0, y = 0, fade = false } = {}) {
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
  const g = box(w, h, d, m2, 0, h / 2, 0);
  const eg = new THREE.LineSegments(
    new THREE.EdgesGeometry(g.geometry),
    new THREE.LineBasicMaterial({ color: 0x7a8290, transparent: true, opacity: 0.5 }),
  );
  g.add(eg);
  return { mesh: g, mat: m2 };
}

// 貨櫃：箱體＋兩道框＋上下邊條；rot 為真時長邊沿 Z 軸（GLB 以長邊沿 X 製作，rot 時轉 90°）
export function buildContainer(w, h, d, rot, cm, fm) {
  const glb = propGlb('container', {
    color: cm.color.getHex(),
    ref: [7.5, 2.8, 2.9],
    size: rot ? [d, h, w] : [w, h, d],
    rotY: rot ? Math.PI / 2 : 0,
    fade: true,
  });
  if (glb) return glb;
  const g = new THREE.Group();
  g.add(box(w, h, d, cm, 0, h / 2, 0));
  for (const t of [-0.35, 0.35]) {
    g.add(
      box(rot ? w + 0.1 : 0.3, h + 0.1, rot ? 0.3 : d + 0.1, fm, rot ? 0 : t * w, h / 2, rot ? t * d : 0),
    );
  }
  g.add(box(w + 0.08, 0.2, d + 0.08, fm, 0, h, 0));
  g.add(box(w + 0.08, 0.2, d + 0.08, fm, 0, 0.1, 0));
  return g;
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
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 柱子／路燈桿（中心在原點；GLB 原點在底面中心、以高 7 m 製作）
export const buildLampPost = (h, m) =>
  propGlb('lamp_post', { color: m.color.getHex(), ref: [1, 7, 1], size: [1, h, 1], y: -h / 2 }) ||
  box(0.6, h, 0.6, m);
// 散落碎塊（中心在原點；GLB 原點在底面中心、以 0.75 × 0.35 × 0.75 m 製作）
export const buildDebris = (w, h, d, m) =>
  propGlb('debris', { color: m.color.getHex(), ref: [0.75, 0.35, 0.75], size: [w, h, d], y: -h / 2 }) ||
  box(w, h, d, m);

// 路邊停放的卡車：車廂＋駕駛艙＋6 輪
export function buildParkedTruck(cm) {
  const glb = propGlb('parked_truck', { color: cm.color.getHex(), fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  g.add(box(3, 2.4, 7, cm, 0, 1.6, 0));
  g.add(box(3, 1.6, 2.2, mat(0xe6e6e6).clone(), 0, 1.2, -4.4));
  for (const sx of [-1.4, 1.4])
    for (const sz of [-3.8, -1.5, 2.2]) {
      const w = cyl(0.6, 0.6, 0.5, mat(0x1c1e20), sx, 0.6, sz);
      w.rotateZ(Math.PI / 2);
      g.add(w);
    }
  return g;
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
  const g = new THREE.Group();
  const dm = mats.deck.clone();
  dm.transparent = true;
  const rm = mats.rail.clone();
  rm.transparent = true;
  g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
  for (const s of [-1, 1]) {
    g.add(
      box(
        rotY ? 0.3 : w,
        0.9,
        rotY ? d : 0.3,
        rm,
        rotY ? s * (w / 2 - 0.15) : 0,
        0.45,
        rotY ? 0 : s * (d / 2 - 0.15),
      ),
    );
  }
  return { group: g, dm, rm };
}
export const deckMats = () => ({
  deck: mat(0x6a6f77, { roughness: 0.85, metalness: 0.2 }),
  rail: mat(0x3a3d42),
  pillar: mat(0x4a4f57, { roughness: 0.9 }),
});

// 支柱（下粗上細的圓柱）：原點在底面中心（呼叫端會把位置改到中心；GLB 以半徑 0.6、高 6 m 製作）
export const buildPillar = (r, h, m) =>
  propGlb('pillar', { color: m.color.getHex(), ref: [0.6, 6, 0.6], size: [r, h, r], y: -h / 2 }) ||
  cyl(r, r * 1.15, h, m, 0, h / 2, 0, 8);

// 隧道口：牆面＋拱頂＋黑洞＋門柱＋背後山體；原點在地面中心，開口朝 −Z
export function buildTunnelPortal(rockColor) {
  const glb = propGlb('tunnel_portal', { color: rockColor });
  if (glb) return glb;
  const g = new THREE.Group();
  const dm = mat(0x5b5f66, { roughness: 0.95 });
  g.add(box(14, 9, 2.5, dm, 0, 4.5, 0));
  g.add(box(10, 0.9, 2.7, mat(0x8a8f96), 0, 8.1, 0));
  g.add(box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0));
  g.add(box(1.4, 7, 3, mat(0x3d4147), -4.7, 3.5, 0));
  g.add(box(1.4, 7, 3, mat(0x3d4147), 4.7, 3.5, 0));
  g.add(box(24, 14, 10, mat(rockColor, { roughness: 1 }), 0, 5, -6));
  return g;
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
