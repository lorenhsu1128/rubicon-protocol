// RTS 地圖（world/rts-map.js）的障礙物外觀：plan 的 model 名稱 → 主題的物件網格（prop-models.js 的純函式）。
// 加主題時在 rts-map.js 的 RTS_THEMES 加障礙物種類，這裡加對應的建模。
import { buildFloodlight, buildOreHopper, buildRockSpire, buildStorageTank } from './prop-models.js';
import { attrSig, mergeList } from '../render/mesh-merge.js';
import { styleCat } from '../render/style/shader.js';

const HOPPER_COL = [0xb08a3e, 0x8c8f86, 0xa0522d],
  TANK_COL = [0x8a5a3a, 0x9a8f7a, 0x6f7a80];
export const RTS_PROPS = {
  spire: (o, T) => buildRockSpire(o.r, o.h, T.rock),
  hopper: (o) => buildOreHopper(HOPPER_COL[o.color || 0]),
  tank: (o) => buildStorageTank(o.r / 1.02, o.h, TANK_COL[o.color || 0]),
  floodlight: (o) => buildFloodlight(o.h, 0x4a4540),
};
export function rtsPropMesh(o, T) {
  const f = RTS_PROPS[o.model];
  return f ? f(o, T) : null;
}

// ---------- 靜態合併（docs/rts-design.md 8.3）----------
// RTS 地圖的障礙物（幾十個，每個 2～5 個網格）依材質合併成少數幾個世界座標的網格；碰撞照舊用障礙物的形狀。
// 戰爭迷霧在未探索時要隱藏地圖物件：合併後的頂點帶著所屬物件的中心（rtsC），著色器查迷霧的「探索過」貼圖
// （game/rts-fog.js 設定 RTS_PROP_FOG：每個視野格一個像素、最近取樣），所在格沒探索過就丟掉，
// 和原本「整個物件的群組在算繪時隱藏」的結果相同；陰影也用同樣規則的深度材質。沒有迷霧時（on＝0）一律顯示。
// 沒合併的網格（半透明、多重材質、燈光…）留在原本的群組裡，迷霧照舊隱藏群組。
export const RTS_PROP_FOG = {
  rtsFogTex: { value: null },
  rtsFogM: { value: new THREE.Vector3(0, 1, 1) }, // 地圖半寬、格寬、每邊格數
  rtsFogOn: { value: 0 },
};
function fogPatch(sh) {
  Object.assign(sh.uniforms, RTS_PROP_FOG);
  sh.vertexShader = sh.vertexShader
    .replace('void main() {', 'attribute vec2 rtsC;\nvarying vec2 vRtsC;\nvoid main() {\n\tvRtsC = rtsC;')
    .replace(/^/, '');
  sh.fragmentShader = sh.fragmentShader.replace(
    'void main() {',
    [
      'uniform sampler2D rtsFogTex;',
      'uniform vec3 rtsFogM;',
      'uniform float rtsFogOn;',
      'varying vec2 vRtsC;',
      'void main() {',
      '\tif ( rtsFogOn > 0.5 ) {',
      '\t\tvec2 rc = floor( ( vRtsC + rtsFogM.x ) / rtsFogM.y );',
      '\t\tif ( rc.x >= 0.0 && rc.y >= 0.0 && rc.x < rtsFogM.z && rc.y < rtsFogM.z && texture2D( rtsFogTex, ( rc + 0.5 ) / rtsFogM.z ).r < 0.5 ) discard;',
      '\t}',
    ].join('\n'),
  );
}
// 材質的複本：先套原本的著色器修改（標準材質的渲染風格在 prototype 上）再加迷霧
function fogMat(m) {
  const c = m.clone();
  c.transparent = false; // 不透明度 1 的淡出材質（RTS 不做鏡頭遮擋淡出）
  const base = Object.getPrototypeOf(m).onBeforeCompile;
  c.onBeforeCompile = function (sh, r) {
    if (base) base.call(this, sh, r);
    fogPatch(sh);
  };
  const key = Object.getPrototypeOf(m).customProgramCacheKey;
  c.customProgramCacheKey = function () {
    return (key ? key.call(this) : '') + '|rtsPropFog';
  };
  return c;
}
let DEPTH = null;
function fogDepth() {
  if (DEPTH) return DEPTH;
  DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  DEPTH.onBeforeCompile = fogPatch;
  DEPTH.customProgramCacheKey = () => 'rtsPropFogDepth';
  return DEPTH;
}
const okMat = (m) =>
  m &&
  !Array.isArray(m) &&
  m.visible !== false &&
  (!m.transparent || (m.depthWrite && m.opacity >= 1)) && // 遮擋淡出用的材質（不透明度 1）當成不透明
  !Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') &&
  (m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
// 材質的外觀簽名：遮擋淡出的物件每個都有自己的材質複本，內容相同的當成同一種
const texId = (t) => (t ? t.uuid : '');
const colHex = (c) => (c ? c.getHex() : '');
function matSig(m) {
  return [
    m.type,
    colHex(m.color),
    colHex(m.emissive),
    m.emissiveIntensity,
    m.roughness,
    m.metalness,
    m.flatShading,
    m.side,
    m.vertexColors,
    m.envMapIntensity,
    styleCat(m),
    ...['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap', 'envMap'].map(
      (k) => texId(m[k]),
    ),
    m.normalScale ? m.normalScale.x + ',' + m.normalScale.y : '',
  ].join('/');
}
// obs：World.addSmall 回傳的障礙物（group 在場景裡、x／z 是中心）。回傳合併掉的網格數
export function mergeRtsProps(world, obs) {
  const buckets = new Map();
  const mats = new Map();
  for (const ob of obs) {
    const g = ob && ob.group;
    if (!g) continue;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.children.length) return;
      const m = o.material,
        geo = o.geometry;
      // 單一材質時 three.js 不看 groups（整個幾何一起畫），所以有 groups 也照樣合併
      if (!okMat(m) || !geo || !geo.attributes.position) return;
      if (geo.drawRange.start !== 0 || geo.drawRange.count !== Infinity) return;
      if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) return;
      for (let p = o; p && p !== g.parent; p = p.parent) if (p.visible === false) return;
      const k = [matSig(m), attrSig(geo), +o.castShadow, +o.receiveShadow, o.renderOrder].join('|');
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push({ o, ob });
    });
  }
  let n = 0;
  for (const list of buckets.values()) {
    if (list.length < 2) continue; // 只有一個的留在群組裡（迷霧照舊隱藏群組）
    const o0 = list[0].o;
    const geo = mergeList(list.map(({ o }) => ({ geo: o.geometry, mm: o.matrixWorld })));
    const total = geo.attributes.position.count;
    const c = new Float32Array(total * 2);
    let off = 0;
    for (const { o, ob } of list) {
      const cnt = o.geometry.attributes.position.count;
      for (let i = 0; i < cnt; i++) {
        c[(off + i) * 2] = ob.x;
        c[(off + i) * 2 + 1] = ob.z;
      }
      off += cnt;
    }
    geo.setAttribute('rtsC', new THREE.BufferAttribute(c, 2));
    const ms = matSig(o0.material);
    let fm = mats.get(ms);
    if (!fm) mats.set(ms, (fm = fogMat(o0.material)));
    const mesh = new THREE.Mesh(geo, fm);
    mesh.castShadow = o0.castShadow;
    mesh.receiveShadow = o0.receiveShadow;
    mesh.renderOrder = o0.renderOrder;
    if (mesh.castShadow) mesh.customDepthMaterial = fogDepth();
    mesh.matrixAutoUpdate = false; // 頂點已經是世界座標
    mesh.userData.rtsProps = true;
    world.scene.add(mesh);
    world.meshes.push(mesh);
    for (const { o } of list) o.parent.remove(o);
    n += list.length;
  }
  return n;
}
