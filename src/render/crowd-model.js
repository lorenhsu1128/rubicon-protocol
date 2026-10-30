// ============================================================
//  地圖上的小人（docs/crew-civilians-design.md 第 2 期）：程式模型，同一種零件合批成 InstancedMesh
//  （頭、帽子／頭盔、軀幹、手臂×2、腳×2），每個人每格算各零件的矩陣；顏色是每個實例的 instanceColor。
//  單位公尺（身高 1.75 m，docs/world-scale.md 的人的尺寸），不跟著機甲放大。純函式＋一個容器類別，不呼叫亂數。
// ============================================================
import { tagStyle } from './style/shader.js';

const box = (w, h, d, y0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y0, 0); // y0：零件的轉軸在原點（腳與手臂掛在上端）
  return g;
};
// 零件：[名稱, 幾何, 每個人幾個]
const PARTS = [
  ['leg', () => box(0.17, 0.86, 0.19, -0.43), 2],
  ['arm', () => box(0.12, 0.62, 0.13, -0.31), 2],
  ['torso', () => box(0.42, 0.58, 0.25, 0.29), 1],
  ['head', () => new THREE.IcosahedronGeometry(0.13, 0), 1],
  ['hat', () => new THREE.CylinderGeometry(0.15, 0.16, 0.08, 7), 1],
];

const _m = new THREE.Matrix4(),
  _b = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _e = new THREE.Euler(0, 0, 0, 'YXZ'),
  _p = new THREE.Vector3(),
  _s = new THREE.Vector3(1, 1, 1),
  _c = new THREE.Color();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

// 姿勢（每個人每格）：{ x, y, z, yaw, sw 擺動（-1～1）, run 0／1, crouch 0～1, work 0～1（手在前面做事）, wave 0～1（揮手、慌張）, aim 0～1（兩手平舉瞄準）, lean }
export class CrowdMesh {
  constructor(max) {
    this.max = max;
    this.group = new THREE.Group();
    this.group.name = 'crowd';
    this.mesh = {};
    for (const [k, geo, n] of PARTS) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.82,
        metalness: 0.05,
        flatShading: true,
      });
      const m = new THREE.InstancedMesh(geo(), mat, max * n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; // 實例散在整張地圖上（幾何的外框在原點）
      m.castShadow = true;
      m.receiveShadow = true;
      // 顏色緩衝先配好整份（setColorAt 自己建立時用的是當下的 count，count 為 0 時顏色會全部遺失）
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * n * 3).fill(1), 3);
      m.count = 0;
      m.userData.noFade = true; // 鏡頭遮擋不處理（World.fadeMeshes）
      for (let i = 0; i < max * n; i++) m.setMatrixAt(i, ZERO);
      this.mesh[k] = m;
      this.group.add(m);
    }
    tagStyle(this.group, 0);
  }
  // 外觀：look＝{ shirt, pants, skin, hat（null＝沒有帽子） }
  setLook(i, look) {
    const M = this.mesh;
    const set = (k, j, hex) => {
      _c.setHex(hex);
      M[k].setColorAt(j, _c);
    };
    set('leg', i * 2, look.pants);
    set('leg', i * 2 + 1, look.pants);
    set('arm', i * 2, look.shirt);
    set('arm', i * 2 + 1, look.shirt);
    set('torso', i, look.shirt);
    set('head', i, look.skin);
    set('hat', i, look.hat === null ? look.skin : look.hat);
    for (const k in M) if (M[k].instanceColor) M[k].instanceColor.needsUpdate = true;
  }
  hide(i) {
    const M = this.mesh;
    M.leg.setMatrixAt(i * 2, ZERO);
    M.leg.setMatrixAt(i * 2 + 1, ZERO);
    M.arm.setMatrixAt(i * 2, ZERO);
    M.arm.setMatrixAt(i * 2 + 1, ZERO);
    M.torso.setMatrixAt(i, ZERO);
    M.head.setMatrixAt(i, ZERO);
    M.hat.setMatrixAt(i, ZERO);
  }
  // 一個人的姿勢 → 各零件的矩陣
  pose(i, P, hatOn) {
    const M = this.mesh;
    const cr = P.crouch || 0;
    const hip = 0.88 - cr * 0.3;
    _e.set(0, P.yaw, 0);
    _q.setFromEuler(_e);
    _b.compose(_p.set(P.x, P.y, P.z), _q, _s);
    const put = (mesh, j, x, y, z, rx, rz, ry = 0) => {
      _e.set(rx, ry, rz);
      _q.setFromEuler(_e);
      _m.compose(_p.set(x, y, z), _q, _s);
      _m.premultiply(_b);
      mesh.setMatrixAt(j, _m);
    };
    const sw = P.sw || 0,
      run = P.run || 0;
    const legA = sw * (0.45 + run * 0.45);
    const lean = (P.lean || 0) + run * 0.25 + cr * 0.35;
    // 腳：蹲下時往前彎
    put(M.leg, i * 2, -0.12, hip, 0, legA - cr * 0.75, -cr * 0.12);
    put(M.leg, i * 2 + 1, 0.12, hip, 0, -legA - cr * 0.55, cr * 0.12);
    // 軀幹（前傾）
    put(M.torso, i, 0, hip, 0, lean, 0);
    // 肩與頭跟著前傾
    const sh = hip + 0.55 * Math.cos(lean),
      fz = 0.55 * Math.sin(lean);
    const armA = -sw * (0.4 + run * 0.5);
    const work = P.work || 0,
      wave = P.wave || 0,
      aim = P.aim || 0;
    const ax = armA * (1 - work) - work * 1.2 - wave * 2.6 - aim * 1.5;
    put(M.arm, i * 2, -0.27, sh, fz, ax, -0.08 - wave * 0.3);
    put(
      M.arm,
      i * 2 + 1,
      0.27,
      sh,
      fz,
      -armA * (1 - work) - work * (1.0 + 0.3 * sw) - wave * 2.6 * (1 - 0.3 * sw) - aim * 1.4,
      0.08 + wave * 0.3,
    );
    const hy = sh + 0.17 * Math.cos(lean),
      hz = fz + 0.17 * Math.sin(lean);
    put(M.head, i, 0, hy, hz, 0, 0);
    if (hatOn) put(M.hat, i, 0, hy + 0.1, hz, 0, 0);
    else M.hat.setMatrixAt(i, ZERO);
  }
  // 這一格用到的數量（之後的實例都是隱藏的）
  commit(n) {
    for (const [k, , per] of PARTS) {
      const m = this.mesh[k];
      m.count = Math.min(this.max, n) * per;
      m.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() {
    for (const k in this.mesh) {
      this.mesh[k].geometry.dispose();
      this.mesh[k].material.dispose();
    }
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
