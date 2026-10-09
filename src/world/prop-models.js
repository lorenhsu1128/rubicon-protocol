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

// ---------- 荒涼工業荒野（wasteland）：斗輪採掘機殘骸、輸送管線、鑽井架 ----------
// 透明材質（擋住鏡頭時半透明）
const fadeMat = (color, opts) => {
  const m = mat(color, opts).clone();
  m.transparent = true;
  return m;
};
const lerpN = (a, b, t) => a + (b - a) * t;
// 斗輪採掘機殘骸：原點在地面中心，斗輪臂朝 −Z。body＝機身碰撞箱（寬、頂高、長，中心在原點），
// 斗輪中心在 (0, wheelY, wheelZ)、半徑 wheelR（呼叫端以圓柱碰撞）
export const MINING_RIG = { body: [8.2, 7.4, 11], wheelZ: -15.6, wheelY: 4.3, wheelR: 4.6 };
export function buildMiningRig(color) {
  const glb = propGlb('mining_rig', { color, fade: true });
  if (glb) return glb;
  const R = MINING_RIG;
  const g = new THREE.Group();
  const main = fadeMat(color, { roughness: 0.8, metalness: 0.35 }),
    dark = fadeMat(0x2f2a26, { roughness: 0.9 }),
    rust = fadeMat(0x7a3f22, { roughness: 0.95 });
  for (const sx of [-1, 1]) g.add(box(2.6, 2.2, 11, dark, sx * 2.8, 1.1, 0));
  g.add(box(6, 1.2, 8, dark, 0, 2.6, 0));
  const body = new THREE.Group();
  body.position.set(0, 3.2, 0.5);
  body.rotation.z = 0.05;
  body.add(box(8, 4.2, 9, main, 0, 2.1, 0));
  body.add(box(5, 2.2, 4, main, 0, 5.3, 2));
  body.add(box(5.2, 0.4, 4.2, rust, 0, 6.5, 2));
  body.add(box(1.1, 1.1, 8, rust, 2.6, 4.7, -0.5));
  g.add(body);
  // 斗輪臂：從機身前上方斜向下伸到斗輪
  const boom = new THREE.Group();
  boom.position.set(0, 6.4, -3.5);
  boom.rotation.x = 0.18;
  boom.add(box(1.8, 1.6, 12.5, main, 0, 0, -6.25));
  for (const sx of [-1, 1]) boom.add(box(0.3, 2.6, 12, rust, sx * 0.9, 1.2, -6));
  g.add(boom);
  // 斗輪：軸沿 X
  const wheel = new THREE.Group();
  wheel.position.set(0, R.wheelY, R.wheelZ);
  wheel.rotation.x = 0.4;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(R.wheelR - 0.5, 0.45, 6, 20), main);
  ring.rotation.y = Math.PI / 2;
  ring.castShadow = true;
  wheel.add(ring);
  const hub = cyl(0.9, 0.9, 2.2, dark, 0, 0, 0, 10);
  hub.rotation.z = Math.PI / 2;
  wheel.add(hub);
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    const b = box(1.6, 1.3, 1.3, rust, 0, Math.sin(a) * R.wheelR, Math.cos(a) * R.wheelR);
    b.rotation.x = -a;
    wheel.add(b);
    if (k % 2 === 0) {
      const s = box(
        0.3,
        0.3,
        R.wheelR - 0.6,
        dark,
        0,
        Math.sin(a) * (R.wheelR / 2),
        Math.cos(a) * (R.wheelR / 2),
      );
      s.rotation.x = -a;
      wheel.add(s);
    }
  }
  g.add(wheel);
  // 配重臂
  const cw = new THREE.Group();
  cw.position.set(0, 7.2, 4.5);
  cw.rotation.x = 0.22;
  cw.add(box(1.4, 1.2, 8, main, 0, 0, 4));
  cw.add(box(4, 3, 3, dark, 0, -0.6, 8.2));
  g.add(cw);
  return g;
}

// 輸送管線一段（沿 Z，長 PIPE.seg）：原點在管子中心
export const PIPE = { seg: 9, r: 0.8 };
export function buildPipeSegment(color) {
  const glb = propGlb('pipeline', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.55, metalness: 0.55 }),
    fl = fadeMat(0x3b3631, { roughness: 0.8 });
  const p = cyl(PIPE.r, PIPE.r, PIPE.seg, m, 0, 0, 0, 12);
  p.rotation.x = Math.PI / 2;
  g.add(p);
  for (const z of [-PIPE.seg / 2 + 0.2, PIPE.seg / 2 - 0.2]) {
    const f = cyl(PIPE.r + 0.15, PIPE.r + 0.15, 0.35, fl, 0, 0, z, 12);
    f.rotation.x = Math.PI / 2;
    g.add(f);
  }
  return g;
}
// 管線支架（A 字形）：原點在底面中心，高 h（到管子底部）；GLB 以高 6 m 製作，依高度縮放
export function buildPipeSupport(h, color) {
  const glb = propGlb('pipe_support', { color, ref: [3, 6, 0.6], size: [3, h, 0.6] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.85 });
  for (const s of [-1, 1]) {
    const leg = box(0.35, Math.hypot(h, 0.9), 0.4, m, s * 0.95, h / 2, 0);
    leg.rotation.z = s * Math.atan2(0.9, h);
    g.add(leg);
  }
  g.add(box(2.4, 0.35, 0.5, m, 0, h - 0.2, 0));
  g.add(box(1.6, 0.25, 0.4, m, 0, h * 0.45, 0));
  return g;
}

// 鑽井架：格子塔＋中段平台＋頂部滑輪架；原點在底面中心；GLB 以 4 × 18 × 4 m 製作，依高度縮放
export function buildDerrick(h, color) {
  const glb = propGlb('derrick', { color, ref: [4, 18, 4], size: [4, h, 4], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.45 }),
    dk = fadeMat(0x34302c, { roughness: 0.9 });
  const b0 = 2,
    b1 = 0.6;
  const half = (y) => lerpN(b0, b1, y / h);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = box(0.3, h, 0.3, m, sx * ((b0 + b1) / 2), h / 2, sz * ((b0 + b1) / 2));
      leg.rotation.z = sx * Math.atan2(b0 - b1, h);
      leg.rotation.x = -sz * Math.atan2(b0 - b1, h);
      g.add(leg);
    }
  for (let y = 2.5; y < h - 1; y += 3) {
    const w = half(y) * 2;
    g.add(box(w, 0.18, 0.18, m, 0, y, half(y)));
    g.add(box(w, 0.18, 0.18, m, 0, y, -half(y)));
    g.add(box(0.18, 0.18, w, m, half(y), y, 0));
    g.add(box(0.18, 0.18, w, m, -half(y), y, 0));
  }
  const py = h * 0.35;
  g.add(box(half(py) * 2 + 1.6, 0.3, half(py) * 2 + 1.6, dk, 0, py, 0));
  g.add(box(1.8, 1.2, 1.8, dk, 0, h + 0.5, 0));
  g.add(box(4.4, 1.4, 4.4, dk, 0, 0.7, 0));
  return g;
}

// ---------- 沙丘地帶（dunes）：半埋的艦體殘骸、拱形殘骸 ----------
// 艦體殘骸：長約 24、寬 7 m，沿 Z，艦首朝 −Z；原點在艦底中心（呼叫端往下埋 sink）。
// box：碰撞箱的寬、長與埋好之後露出地面的高度
export const WRECK_HULL = { box: [7.4, 24, 5.2], sink: 2.4 };
export function buildWreckHull(color) {
  const glb = propGlb('wreck_hull', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.9, metalness: 0.3 }),
    dk = fadeMat(0x3a3029, { roughness: 1 }),
    rust = fadeMat(0x8a4a2a, { roughness: 1 });
  const hull = new THREE.Group();
  hull.rotation.z = 0.22; // 側傾
  hull.add(box(7, 6, 20, m, 0, 3, 2));
  const bow = box(4.95, 6, 4.95, m, 0, 3, -8);
  bow.rotation.y = Math.PI / 4;
  hull.add(bow);
  hull.add(box(7.2, 0.5, 20.2, rust, 0, 6, 2));
  hull.add(box(4.5, 3.5, 6, dk, 0.4, 7.6, 6)); // 艦橋（殘骸）
  hull.add(box(3, 0.4, 5, rust, 0.4, 9.5, 6.4));
  for (let k = 0; k < 4; k++) hull.add(box(0.3, 4.5, 0.4, dk, -3.6, 3.5, -4 + k * 4));
  g.add(hull);
  return g;
}
// 拱形殘骸（半埋的巨大環狀構造）：跨距 18 m，沿 X；原點在地面中心；feet＝兩腳的 x 與碰撞半徑
export const WRECK_ARCH = { span: 18, feet: [9, 1.7] };
export function buildWreckArch(color) {
  const glb = propGlb('wreck_arch', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const R = WRECK_ARCH.span / 2;
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.35 }),
    rib = fadeMat(0x4a3a2e, { roughness: 1 });
  const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 1.3, 8, 28, Math.PI), m);
  arc.castShadow = true;
  arc.position.y = -0.8;
  g.add(arc);
  for (let k = 1; k < 8; k++) {
    const a = (k / 8) * Math.PI;
    const r = box(0.5, 3.4, 3.2, rib, Math.cos(a) * R, Math.sin(a) * R - 0.8, 0);
    r.rotation.z = a - Math.PI / 2;
    g.add(r);
  }
  g.rotation.x = 0.12;
  return g;
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
// 礦石料斗（荒野的掩體）：方形漏斗＋四腳＋滑槽；原點在底面中心；HOPPER＝碰撞箱 寬、高、深
export const HOPPER = [5, 6.2, 5];
export function buildOreHopper(color) {
  const glb = propGlb('ore_hopper', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.75, metalness: 0.4 }),
    dk = fadeMat(0x3a332d, { roughness: 0.9 }),
    ore = fadeMat(0x5b4a3c, { roughness: 1 });
  g.add(box(5, 2.2, 5, m, 0, 5, 0));
  const fun = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 1.2, 2.2, 4, 1), m);
  fun.rotation.y = Math.PI / 4;
  fun.position.y = 2.8;
  fun.castShadow = true;
  g.add(fun);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.4, 4, 0.4, dk, sx * 2.2, 2, sz * 2.2));
  g.add(box(4.6, 0.6, 4.6, ore, 0, 6.3, 0));
  const ch = box(1.2, 0.3, 3, dk, 0, 1.2, 2.2);
  ch.rotation.x = 0.5;
  g.add(ch);
  return g;
}
// 鏽蝕儲槽：圓槽＋頂蓋＋箍＋爬梯；原點在底面中心；GLB 以半徑 3、高 6 m 製作，依尺寸縮放
export function buildStorageTank(r, h, color) {
  const glb = propGlb('storage_tank', { color, ref: [6, 6, 6], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.8, metalness: 0.35 }),
    rust = fadeMat(0x7a3f22, { roughness: 1 });
  g.add(cyl(r, r, h, m, 0, h / 2, 0, 16));
  g.add(cyl(r * 0.3, r, 0.8, m, 0, h + 0.4, 0, 16));
  for (const y of [h * 0.3, h * 0.7]) g.add(cyl(r + 0.08, r + 0.08, 0.25, rust, 0, y, 0, 16));
  g.add(box(0.5, h, 0.15, rust, 0, h / 2, r + 0.1));
  return g;
}
// 岩柱（荒野的岩石）：下粗上細的六角柱＋頂部岩塊；原點在底面中心；GLB 以半徑 2、高 7 m 製作
export function buildRockSpire(r, h, color) {
  const glb = propGlb('rock_spire', { color, ref: [4, 7, 4], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 1 });
  const p = cyl(r * 0.55, r, h * 0.85, m, 0, h * 0.425, 0, 6);
  p.receiveShadow = true;
  g.add(p);
  const top = new THREE.Mesh(new THREE.DodecahedronGeometry(r * 0.7, 0), m);
  top.position.y = h * 0.85;
  top.scale.set(1, 0.6, 1);
  top.castShadow = true;
  g.add(top);
  return g;
}
// 照明塔（荒野的柱子）：桿＋橫臂＋燈箱；原點在底面中心；GLB 以高 9 m 製作，依高度縮放
export function buildFloodlight(h, color) {
  const glb = propGlb('floodlight', { color, ref: [3, 9, 1], size: [3, h, 1] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.7, metalness: 0.5 });
  g.add(box(0.45, h, 0.45, m, 0, h / 2, 0));
  g.add(box(3, 0.25, 0.3, m, 0, h - 0.4, 0));
  const lm = mat(0xfff2c8, { emissive: 0x806a3a, roughness: 0.4 });
  for (const sx of [-1.1, 0, 1.1]) g.add(box(0.8, 0.6, 0.5, lm, sx, h - 0.85, 0.2));
  g.add(box(1.2, 0.6, 1.2, m, 0, 0.3, 0));
  return g;
}
// 廢鐵板（純裝飾）：兩片斜插的鐵板；原點在地面中心；GLB 以 1.5 × 0.8 × 1.2 m 製作
export function buildScrap(w, h, d, color) {
  const glb = propGlb('scrap', { color, ref: [1.5, 0.8, 1.2], size: [w, h, d] });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = mat(color, { roughness: 0.9, metalness: 0.4 });
  const a = box(w, 0.08, d * 0.7, m, 0, h * 0.4, 0);
  a.rotation.z = 0.5;
  g.add(a);
  const b = box(w * 0.6, 0.08, d * 0.5, m, w * 0.2, h * 0.3, d * 0.3);
  b.rotation.x = -0.6;
  g.add(b);
  return g;
}
// MT 殘骸（沙丘的掩體）：半埋的小型機體殘骸；原點在地面中心；MT_WRECK＝碰撞箱 寬、高、深
export const MT_WRECK = [4.2, 3.2, 4.2];
export function buildMtWreck(color) {
  const glb = propGlb('mt_wreck', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.85, metalness: 0.4 }),
    dk = fadeMat(0x2e2a26, { roughness: 1 });
  const body = new THREE.Group();
  body.rotation.set(0.15, 0.3, -0.25);
  body.add(box(3.6, 2.2, 3.4, m, 0, 1.2, 0));
  body.add(box(1.6, 1, 1.4, m, 0.4, 2.7, -0.6));
  const gun = cyl(0.18, 0.18, 3.2, dk, 1.9, 1.8, -1.2, 6);
  gun.rotation.x = Math.PI / 2 - 0.3;
  body.add(gun);
  g.add(body);
  const leg = box(0.7, 2.6, 0.7, dk, -1.6, 0.6, 1.6);
  leg.rotation.z = 1.1;
  g.add(leg);
  return g;
}
// 風蝕砂岩（沙丘的岩石）：細莖＋寬大的岩帽；原點在底面中心；GLB 以半徑 3、高 7 m 製作
export function buildSandstone(r, h, color) {
  const glb = propGlb('sandstone', { color, ref: [6, 7, 6], size: [r * 2, h, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 1 });
  g.add(cyl(r * 0.4, r * 0.6, h * 0.7, m, 0, h * 0.35, 0, 7));
  const cap = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), m);
  cap.scale.set(1, 0.38, 0.85);
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
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.7, metalness: 0.45 }),
    dk = fadeMat(0x4a4038, { roughness: 0.9 });
  const n = Math.max(2, Math.round(len / 1.2));
  for (let i = 0; i < n; i++) {
    const p = box(
      len / n - 0.08,
      SAND_FENCE_H - 0.4,
      0.12,
      m,
      -len / 2 + (len / n) * (i + 0.5),
      1.5,
      i % 2 ? 0.06 : -0.06,
    );
    g.add(p);
  }
  for (let x = -len / 2; x <= len / 2 + 1e-6; x += len / Math.max(1, Math.round(len / 4)))
    g.add(box(0.25, SAND_FENCE_H + 0.2, 0.3, dk, x, (SAND_FENCE_H + 0.2) / 2, 0));
  return g;
}

// ---------- 冰原（snow）：半圓拱屋、冰塊、信號燈桿、雷達天線、舊時代觀測圓頂、碎冰 ----------
// 半圓拱屋（冰原的掩體）：長沿 Z；原點在底面中心；QUONSET＝碰撞箱 寬、高、深
export const QUONSET = [6, 3.4, 9];
export function buildQuonset(color) {
  const glb = propGlb('quonset', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.6, metalness: 0.45 }),
    snow = fadeMat(0xf2f6fa, { roughness: 0.95 }),
    dk = fadeMat(0x3d434a, { roughness: 0.8 });
  const shell = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 9, 14, 1, false, -Math.PI / 2, Math.PI), m);
  shell.rotation.x = Math.PI / 2;
  shell.rotation.y = Math.PI / 2;
  shell.position.y = 0.2;
  shell.scale.set(1, 1, 1.1);
  shell.castShadow = shell.receiveShadow = true;
  g.add(shell);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3.08, 3.08, 8.6, 14, 1, false, -0.9, 1.8), snow);
  cap.rotation.x = Math.PI / 2;
  cap.rotation.y = Math.PI / 2;
  cap.position.y = 0.2;
  cap.scale.set(1, 1, 1.1);
  g.add(cap);
  for (const z of [-4.5, 4.5]) g.add(box(5.6, 3, 0.2, dk, 0, 1.6, z));
  g.add(box(1.6, 2.2, 0.3, m, 0, 1.1, -4.6));
  return g;
}
// 冰塊（冰原的岩石）：幾塊稜角分明的半透明冰；原點在底面中心；GLB 以半徑 2.5 製作
export function buildIceChunk(r) {
  const glb = propGlb('ice_chunk', { ref: [5, 4, 5], size: [r * 2, r * 1.6, r * 2], fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(0xbfe0f0, { roughness: 0.15, metalness: 0.1 });
  const a = new THREE.Mesh(new THREE.OctahedronGeometry(r, 0), m);
  a.scale.set(1, 0.8, 0.85);
  a.position.y = r * 0.5;
  a.rotation.set(0.3, 0.5, 0.2);
  a.castShadow = true;
  g.add(a);
  const b = new THREE.Mesh(new THREE.OctahedronGeometry(r * 0.6, 0), m);
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
  const g = new THREE.Group();
  const red = mat(0xc8322a, { roughness: 0.6 }),
    white = mat(0xe8ecef, { roughness: 0.6 });
  const n = 6;
  for (let i = 0; i < n; i++) g.add(box(0.4, h / n, 0.4, i % 2 ? white : red, 0, (h / n) * (i + 0.5), 0));
  g.add(box(0.6, 0.5, 0.6, mat(0xff4030, { emissive: 0xa01810, roughness: 0.3 }), 0, h + 0.25, 0));
  g.add(box(1.2, 0.5, 1.2, mat(0x3d434a), 0, 0.25, 0));
  return g;
}
// 雷達天線：支架＋傾斜的碟形天線；原點在底面中心；GLB 以高 7 m 製作
export function buildRadarDish(color) {
  const glb = propGlb('radar_dish', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.5, metalness: 0.5 }),
    dk = fadeMat(0x3d434a, { roughness: 0.8 });
  g.add(box(2.4, 1, 2.4, dk, 0, 0.5, 0));
  g.add(cyl(0.35, 0.45, 4, dk, 0, 3, 0, 8));
  const dish = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 6, 0, Math.PI * 2, 0, 0.9), m);
  dish.material.side = THREE.DoubleSide;
  dish.position.set(0, 5.2, 0.6);
  dish.rotation.x = -2.2;
  dish.castShadow = true;
  g.add(dish);
  g.add(box(0.15, 0.15, 2.2, dk, 0, 5.6, -0.4));
  return g;
}
// 舊時代觀測圓頂（大型，不可破壞）：圓形基座＋半球＋觀測縫＋天線；原點在地面中心；DOME_R＝基座半徑
export const DOME_R = 9;
export function buildObsDome(color) {
  const glb = propGlb('obs_dome', { color, fade: true });
  if (glb) return glb;
  const g = new THREE.Group();
  const m = fadeMat(color, { roughness: 0.55, metalness: 0.35 }),
    base = fadeMat(0x5a6068, { roughness: 0.85 }),
    snow = fadeMat(0xf2f6fa, { roughness: 0.95 }),
    dk = fadeMat(0x22262b, { roughness: 0.9 });
  g.add(cyl(DOME_R, DOME_R + 0.6, 3.5, base, 0, 1.75, 0, 20));
  const d = new THREE.Mesh(new THREE.SphereGeometry(DOME_R - 0.6, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), m);
  d.position.y = 3.5;
  d.castShadow = d.receiveShadow = true;
  g.add(d);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(DOME_R - 0.45, 20, 4, 0, Math.PI * 2, 0, 0.6), snow);
  cap.position.y = 3.5;
  g.add(cap);
  const slit = box(1.6, 0.2, DOME_R - 1, dk, 0, 3.5 + (DOME_R - 0.6) * 0.72, -2.2);
  slit.rotation.x = 0.75;
  g.add(slit);
  g.add(box(2.4, 2.6, 1.2, base, 0, 1.3, DOME_R + 0.2));
  g.add(cyl(0.12, 0.12, 6, dk, DOME_R * 0.6, 3.5 + 6, 0, 6));
  return g;
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
  const g = new THREE.Group();
  const dm = fadeMat(C.deck, { roughness: 0.85, metalness: style === 'wasteland' ? 0.5 : 0.1 }),
    tm = fadeMat(C.trim, { roughness: 0.8, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
  // 長邊（護欄方向）的長度與兩側位置
  const L = rotY ? d : w;
  const side = (s, h, t, y, len = L, at = 0) =>
    rotY ? box(t, h, len, tm, s * ((w - t) / 2), y, at) : box(len, h, t, tm, at, y, s * ((d - t) / 2));
  if (style === 'wasteland') {
    // 鋼桁架：上弦＋直桿＋斜桿
    for (const s of [-1, 1]) {
      g.add(side(s, 0.3, 0.3, 1.9));
      const n = Math.max(2, Math.round(L / 3));
      for (let i = 0; i <= n; i++) g.add(side(s, 1.9, 0.2, 0.95, 0.2, -L / 2 + (L / n) * i));
      for (let i = 0; i < n; i++) {
        const b = side(s, 0.18, 0.18, 0.95, Math.hypot(L / n, 1.9), -L / 2 + (L / n) * (i + 0.5));
        if (rotY) b.rotation.x = (i % 2 ? 1 : -1) * Math.atan2(1.9, L / n);
        else b.rotation.z = (i % 2 ? 1 : -1) * Math.atan2(1.9, L / n);
        g.add(b);
      }
    }
  } else if (style === 'dunes') {
    // 風化的矮牆（有缺口）＋板面上的積沙
    const n = Math.max(2, Math.round(L / 4));
    for (const s of [-1, 1])
      for (let i = 0; i < n; i++) {
        if ((i * 7 + (s > 0 ? 3 : 0)) % 5 === 0) continue;
        g.add(side(s, 0.8, 0.5, 0.4, (L / n) * 0.8, -L / 2 + (L / n) * (i + 0.5)));
      }
    const sand = fadeMat(0xd4b483, { roughness: 1 });
    const pile = rotY
      ? box(w * 0.6, 0.25, d * 0.3, sand, 0, 0.12, d * 0.2)
      : box(w * 0.3, 0.25, d * 0.6, sand, w * 0.2, 0.12, 0);
    g.add(pile);
  } else {
    // 冰原：板面積雪＋護欄＋板下冰柱
    g.add(box(w - 0.3, 0.2, d - 0.3, tm, 0, 0.1, 0));
    const rm = fadeMat(0x3d434a, { roughness: 0.7 });
    for (const s of [-1, 1]) {
      const r = side(s, 0.9, 0.3, 0.45);
      r.material = rm;
      g.add(r);
    }
    const ice = fadeMat(0xcfe8f4, { roughness: 0.15 });
    const n = Math.max(3, Math.round(L / 2));
    for (const s of [-1, 1])
      for (let i = 0; i < n; i++) {
        const t = -L / 2 + (L / n) * (i + 0.5);
        const len = 0.5 + ((i * 37 + (s > 0 ? 11 : 0)) % 7) * 0.12;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.12, len, 5), ice);
        c.rotation.x = Math.PI;
        if (rotY) c.position.set(s * (w / 2 - 0.2), -thick - len / 2, t);
        else c.position.set(t, -thick - len / 2, s * (d / 2 - 0.2));
        g.add(c);
      }
  }
  return g;
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
  const g = new THREE.Group();
  const m = mat(C.pillar, { roughness: 0.85, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  if (style === 'wasteland') {
    // 格子鋼塔
    const a = r * 0.75;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.18, h, 0.18, m, sx * a, 0, sz * a));
    for (let y = -h / 2 + 1; y < h / 2; y += 1.6) {
      g.add(box(a * 2, 0.12, 0.12, m, 0, y, a));
      g.add(box(a * 2, 0.12, 0.12, m, 0, y, -a));
      g.add(box(0.12, 0.12, a * 2, m, a, y, 0));
      g.add(box(0.12, 0.12, a * 2, m, -a, y, 0));
    }
  } else if (style === 'dunes') {
    g.add(cyl(r * 0.85, r, h, m, 0, 0, 0, 8));
    const band = mat(0x8e7656, { roughness: 1 });
    for (const y of [-h / 2 + 0.3, h / 2 - 0.3]) g.add(cyl(r * 1.15, r * 1.15, 0.6, band, 0, y, 0, 8));
  } else {
    g.add(cyl(r, r * 1.1, h, m, 0, 0, 0, 8));
    g.add(cyl(r * 1.25, r * 1.4, 0.8, mat(0xcfe8f4, { roughness: 0.15 }), 0, -h / 2 + 0.4, 0, 8));
    g.add(cyl(r * 1.05, r * 1.05, 0.25, mat(0xf2f6fa, { roughness: 0.95 }), 0, h / 2 - 0.1, 0, 8));
  }
  return g;
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
  const g = new THREE.Group();
  const m = fadeMat(C.wall, { roughness: 0.75, metalness: style === 'wasteland' ? 0.5 : 0.05 });
  const along = w > d;
  const L = along ? w : d,
    T = along ? d : w;
  const piece = (len, hh, t, at, y, mm = m) =>
    along ? box(len, hh, t, mm, at, y, 0) : box(t, hh, len, mm, 0, y, at);
  if (style === 'wasteland') {
    // 波浪鐵皮：一片片前後錯開
    const n = Math.max(3, Math.round(L / 0.8));
    for (let i = 0; i < n; i++)
      g.add(piece(L / n + 0.02, h, T * (i % 2 ? 0.7 : 1), -L / 2 + (L / n) * (i + 0.5), 0));
  } else if (style === 'dunes') {
    // 沙袋：一層層錯開堆疊
    const rows = Math.max(3, Math.round(h / 0.55));
    for (let r = 0; r < rows; r++) {
      const n = Math.max(3, Math.round(L / 1.1));
      const off = r % 2 ? 0.5 : 0;
      for (let i = 0; i < n; i++) {
        const at = -L / 2 + (L / n) * (i + 0.5 + off);
        if (at > L / 2) continue;
        g.add(piece(L / n - 0.08, h / rows - 0.05, T, at, -h / 2 + (h / rows) * (r + 0.5)));
      }
    }
  } else {
    // 隔熱板：白／橘相間，頂部積雪
    const n = Math.max(2, Math.round(L / 2));
    const orange = fadeMat(0xd8742a, { roughness: 0.6 });
    for (let i = 0; i < n; i++)
      g.add(piece(L / n - 0.06, h, T, -L / 2 + (L / n) * (i + 0.5), 0, i % 3 === 1 ? orange : m));
    g.add(piece(L, 0.25, T + 0.2, 0, h / 2 + 0.12, fadeMat(0xf2f6fa, { roughness: 0.95 })));
  }
  return g;
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
  const g = new THREE.Group();
  const m = fadeMat(C.plat, { roughness: style === 'snow' ? 0.2 : 0.95, metalness: 0.05 });
  g.add(box(w, h, d, m, 0, h / 2, 0));
  if (style === 'wasteland') {
    // 礦渣台：木樁擋土＋頂面碎石
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
        g.add(
          box(
            0.35,
            h + 0.4,
            0.35,
            post,
            alongX ? t : sx * (w / 2 + 0.1),
            (h + 0.4) / 2,
            alongX ? sz * (d / 2 + 0.1) : t,
          ),
        );
      }
    }
    g.add(box(w - 0.6, 0.15, d - 0.6, fadeMat(0x3e3530, { roughness: 1 }), 0, h + 0.05, 0));
  } else if (style === 'dunes') {
    // 石台座：上下兩道外凸的石帶
    const band = fadeMat(0x8e7656, { roughness: 1 });
    g.add(box(w + 0.5, 0.6, d + 0.5, band, 0, 0.3, 0));
    g.add(box(w + 0.3, 0.5, d + 0.3, band, 0, h - 0.25, 0));
  } else {
    // 冰台：頂面積雪
    g.add(box(w + 0.1, 0.4, d + 0.1, fadeMat(0xf2f6fa, { roughness: 0.95 }), 0, h - 0.15, 0));
  }
  return g;
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
  const g = new THREE.Group();
  g.add(box(rw, 0.4, rd, mat(style === 'snow' ? 0xe9eef2 : C.plat, { roughness: 0.95 })));
  const tm = mat(style === 'wasteland' ? 0x5a4030 : C.trim, { roughness: 0.9 });
  for (const s of [-1, 1])
    g.add(
      alongX
        ? box(rw, 0.35, 0.3, tm, 0, 0.35, s * (rd / 2 - 0.15))
        : box(0.3, 0.35, rd, tm, s * (rw / 2 - 0.15), 0.35, 0),
    );
  return g;
}
// 隧道口：原點在地面中心，開口朝 −Z（同 buildTunnelPortal）
export function buildThemeTunnel(style) {
  const C = FEATURE_COLORS[style];
  const glb = propGlb(style + '_tunnel', { color: C.rock });
  if (glb) return glb;
  const g = new THREE.Group();
  const rock = mat(C.rock, { roughness: 1 });
  const hole = new THREE.MeshBasicMaterial({ color: 0x07080a });
  g.add(box(24, 14, 10, rock, 0, 5, -6));
  g.add(box(8, 6.5, 2.8, hole, 0, 3.25, 0));
  if (style === 'wasteland') {
    // 木框礦坑口
    const wood = mat(0x5a4030, { roughness: 1 });
    for (const sx of [-4.4, 4.4]) g.add(box(0.8, 7.2, 0.8, wood, sx, 3.6, 0.6));
    g.add(box(10, 0.9, 1, wood, 0, 7.4, 0.6));
    g.add(box(12, 3, 2.5, rock, 0, 9.5, 0));
    for (const sx of [-1, 1]) g.add(box(3, 8, 2.5, rock, sx * 6.5, 4, 0));
  } else if (style === 'dunes') {
    // 半埋拱門＋沙坡
    const stone = mat(0xa88d68, { roughness: 1 });
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5, 1, 6, 12, Math.PI), stone);
    arch.position.set(0, 2.2, 0.6);
    g.add(arch);
    for (const sx of [-1, 1]) g.add(box(2, 3, 2.2, stone, sx * 5, 1.1, 0.6));
    const sand = mat(0xd4b483, { roughness: 1 });
    const slope = box(16, 2.5, 6, sand, 0, 0.2, 2.5);
    slope.rotation.x = -0.35;
    g.add(slope);
  } else {
    // 防雪棚：A 字屋頂＋積雪
    const m = mat(0x5a6068, { roughness: 0.8 }),
      snow = mat(0xf2f6fa, { roughness: 0.95 });
    for (const sx of [-1, 1]) {
      const roof = box(6.4, 0.5, 8, m, sx * 2.6, 7.3, 2);
      roof.rotation.z = -sx * 0.55;
      g.add(roof);
      const s2 = box(6.4, 0.35, 8.1, snow, sx * 2.5, 7.75, 2);
      s2.rotation.z = -sx * 0.55;
      g.add(s2);
      g.add(box(0.6, 6.5, 8, m, sx * 4.6, 3.25, 2));
    }
    g.add(box(26, 1.2, 11, snow, 0, 12.4, -6));
  }
  return g;
}
