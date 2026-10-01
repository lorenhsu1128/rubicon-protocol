// 模型量測：外框尺寸（1 單位 = 1 公尺）、三角面數、繪製次數、材質與貼圖統計
import { OUTLINE_MAT } from './geometry.js';

// 描邊外殼與加色發光（推進器火焰、光暈）不算模型本體
export function isFxMaterial(m) {
  if (Array.isArray(m)) return m.every(isFxMaterial);
  return !m || m === OUTLINE_MAT || m.blending === THREE.AdditiveBlending || !!(m.userData && m.userData.fx);
}

// 回傳 obj 在自身父座標系中的外框（obj 不應有父物件，或父物件為單位矩陣）；includeFx 時連發光特效一起量（彈體）
export function measureBox(obj, includeFx = false) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3(),
    tmp = new THREE.Box3();
  obj.traverseVisible((o) => {
    if (!o.isMesh || (!includeFx && isFxMaterial(o.material))) return;
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    box.union(tmp);
  });
  return box;
}

const triCount = (g) =>
  (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
const TEX_KEYS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap'];

// 統計：三角面（不含描邊與特效）、繪製次數（含描邊）、材質與貼圖
export function modelStats(obj, includeFx = false) {
  let tris = 0,
    draws = 0;
  const mats = new Set(),
    texs = new Set();
  obj.traverseVisible((o) => {
    if (!o.isMesh) return;
    draws++;
    if (!includeFx && isFxMaterial(o.material)) return;
    tris += triCount(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      mats.add(m);
      for (const k of TEX_KEYS) if (m[k]) texs.add(m[k]);
    }
  });
  let maxTex = 0;
  for (const t of texs) {
    const img = t.image;
    if (img) maxTex = Math.max(maxTex, img.width || 0, img.height || 0);
  }
  return { tris: Math.round(tris), draws, materials: mats.size, textures: texs.size, maxTex };
}

// 尺寸文字：「寬 × 高 × 深」（公尺，小數兩位）
export const fmtSize = (v) => `${v.x.toFixed(2)} × ${v.y.toFixed(2)} × ${v.z.toFixed(2)} m`;
