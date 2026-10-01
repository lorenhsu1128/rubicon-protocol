// 地圖物件的網格建造（純函式，不使用亂數）：關卡生成以亂數決定參數後呼叫這裡，模型庫也直接使用。
// 修改這裡的幾何會改變所有種子產生的地圖外觀，但不影響亂數序列（多人各端仍一致）。
const MatCache = {};
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

// 貨櫃：箱體＋兩道框＋上下邊條；rot 為真時長邊沿 Z 軸
export function buildContainer(w, h, d, rot, cm, fm) {
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
export function buildRock(r, m) {
  const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), m);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 柱子／路燈桿（中心在原點）
export const buildLampPost = (h, m) => box(0.6, h, 0.6, m);

// 路邊停放的卡車：車廂＋駕駛艙＋6 輪
export function buildParkedTruck(cm) {
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
export function buildDeck(w, d, thick, rotY, mats) {
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

// 支柱（下粗上細的圓柱）：原點在底面中心
export const buildPillar = (r, h, m) => cyl(r, r * 1.15, h, m, 0, h / 2, 0, 8);

// 隧道口：牆面＋拱頂＋黑洞＋門柱＋背後山體；原點在地面中心，開口朝 −Z
export function buildTunnelPortal(rockColor) {
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
