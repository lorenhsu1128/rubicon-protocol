// Coral 戰爭（RTS）的單位模型：整台合併成「一個網格＋一個描邊外殼」（docs/rts-design.md 8.3）。
// 一般的網格合併（mesh-merge.js 的 mergeRig）是每種材質一個網格（一台約 10 個），RTS 一場 120 台以上，
// draw call 與材質切換仍然太多。這裡改成：
// - 不透明的標準材質（以及不透明、沒有貼圖的 Basic／Lambert／Phong）全部併成一個 SkinnedMesh，
//   材質是每台一個 RtsUnitMat：顏色寫進頂點色，粗糙度、金屬感、自發光、貼圖與凹凸的權重寫進頂點屬性
//   （rtsA：Uint8 交錯：粗糙度、金屬感、貼圖權重、粗糙度貼圖權重；自發光 rgb／4、凹凸倍率），
//   共用的磨損貼圖、面板法線貼圖（整台最常用的那張）照舊取樣，所以拉近時質感和原本接近；
// - 描邊外殼併成一個（OUTLINE_SKIN）；
// - 每個錨點（rig 參照到的節點）一根骨頭，動作照舊改錨點；隱藏的錨點骨頭矩陣歸零（mesh-merge.js 的 makeSkeleton）；
// - 貼花（半透明、不寫深度的 Basic 貼圖）在 RTS 鏡頭看不見，拿掉；
// - 其他（別的貼圖、半透明、動作會改的材質（rig 參照到的，rig.mats 除外）、多重材質、有子節點…）不動，照原本獨立。
// 受擊閃光：RtsUnitMat 加進 rig.mats，mechFlash 照舊改它的 emissive（著色器是 emissive＋頂點自發光）。
// 迷彩、透明：材質是一般的 MeshStandardMaterial（子類別），改 opacity／transparent 照常作用（整台一起）。
// 拆下零件（丟出武器、碎裂）照 mergeRig 的介面：rig.unmerge() 還原成原本的網格與材質、rig.remerge() 再合併。
// 只在 RTS 渲染設定（Game.setRtsRender）開著時建立的遊戲實體使用（MechEntity.mergeModel）。

import { OUTLINE_SKIN, isOutline } from './geometry.js';
import { attrSig, makeSkeleton, mergeList, mergeStatic, rigMats, rigRefs } from './mesh-merge.js';
import { styleCat, tagStyle } from './style/shader.js';

const STD = THREE.MeshStandardMaterial.prototype;
const E_K = 4; // 自發光以 1/4 存進 Uint8（面罩 2.2 倍）
const SKIN1_BASE = '#ifdef USE_SKINNING\n\tmat4 boneMatX = getBoneMatrix( skinIndex.x );\n#endif';
const SKIN1_NORMAL = [
  '#ifdef USE_SKINNING',
  '\tmat4 skinMatrix = bindMatrixInverse * boneMatX * bindMatrix;',
  '\tobjectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;',
  '\t#ifdef USE_TANGENT',
  '\t\tobjectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;',
  '\t#endif',
  '#endif',
].join('\n');
const SKIN1_POS =
  '#ifdef USE_SKINNING\n\ttransformed = ( bindMatrixInverse * ( boneMatX * ( bindMatrix * vec4( transformed, 1.0 ) ) ) ).xyz;\n#endif';

// 頂點屬性取代材質的數值；其餘照風格著色器（render/style/shader.js，先套用它再改）
export class RtsUnitMat extends THREE.MeshStandardMaterial {
  constructor(p) {
    super(p);
    this.isRtsUnitMat = true;
  }
}
RtsUnitMat.prototype.onBeforeCompile = function (sh, r) {
  if (STD.onBeforeCompile) STD.onBeforeCompile.call(this, sh, r);
  const rep = (s, a, b) => {
    if (!s.includes(a)) console.warn('rts-merge: 找不到', a);
    return s.replace(a, b);
  };
  let v = sh.vertexShader;
  v =
    'attribute vec4 rtsA;\nattribute vec4 rtsB;\nuniform vec4 rtsPulse;\nvarying vec4 vRtsA;\nvarying vec4 vRtsB;\nvarying float vRtsP;\n' +
    v;
  // 自發光的脈動（skinIndex.y＝頻道 1～4，0＝固定）：動作函式改的發光材質（地圖專屬敵人的 lit_d2）以 uniform 的倍率重現
  v = rep(
    v,
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvRtsA = rtsA;\nvRtsB = rtsB;\nint rtsPc = int( skinIndex.y + 0.5 );\n' +
      'vRtsP = rtsPc == 1 ? rtsPulse.x : rtsPc == 2 ? rtsPulse.y : rtsPc == 3 ? rtsPulse.z : rtsPc == 4 ? rtsPulse.w : 1.0;',
  );
  sh.uniforms.rtsPulse = this.rtsPulseU || (this.rtsPulseU = { value: new THREE.Vector4(1, 1, 1, 1) });
  // 每個頂點只屬於一根骨頭（權重 1）：只取一個骨頭矩陣（原本 4 根、骨頭貼圖讀 16 次）
  v = rep(v, '#include <skinbase_vertex>', SKIN1_BASE);
  v = rep(v, '#include <skinnormal_vertex>', SKIN1_NORMAL);
  v = rep(v, '#include <skinning_vertex>', SKIN1_POS);
  sh.vertexShader = v;
  let f = sh.fragmentShader;
  f = 'varying vec4 vRtsA;\nvarying vec4 vRtsB;\nvarying float vRtsP;\n' + f;
  f = rep(
    f,
    'vec3 totalEmissiveRadiance = emissive;',
    `vec3 totalEmissiveRadiance = emissive + vRtsB.rgb * ${E_K.toFixed(1)} * vRtsP;`,
  );
  // 貼圖：風格著色器的 MAP 段落（沒有時是原本的 map_fragment）
  if (f.includes('diffuseColor *= texelColor;'))
    f = f.replace('diffuseColor *= texelColor;', 'diffuseColor *= mix( vec4( 1.0 ), texelColor, vRtsA.z );');
  f = rep(
    f,
    '#include <roughnessmap_fragment>',
    'float roughnessFactor = vRtsA.x;\n#ifdef USE_ROUGHNESSMAP\n\troughnessFactor *= mix( 1.0, texture2D( roughnessMap, vUv ).g, vRtsA.w );\n#endif',
  );
  f = rep(f, '#include <metalnessmap_fragment>', 'float metalnessFactor = vRtsA.y;');
  if (f.includes('mapN.xy *= normalScale * stE.z;'))
    f = f.replace('mapN.xy *= normalScale * stE.z;', 'mapN.xy *= normalScale * stE.z * vRtsB.w;');
  else f = rep(f, '#include <normal_fragment_maps>', '#include <normal_fragment_maps>'); // 沒有風格著色器：照原本
  sh.fragmentShader = f;
};
RtsUnitMat.prototype.customProgramCacheKey = function () {
  return 'rubicon-rts-unit-3';
};

const OK_MAPS = ['map', 'roughnessMap', 'normalMap'];
const BAD_MAPS = [
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'lightMap',
  'bumpMap',
  'displacementMap',
  'envMap',
];
// 貼花（geometry.js 的 decal）：半透明、不寫深度、多邊形偏移的 Basic 貼圖
const isDecal = (m) =>
  m && m.isMeshBasicMaterial && m.map && m.transparent && !m.depthWrite && m.polygonOffset;

// 網格本身能不能併（不看材質）
// 網格本身是 rig 參照到的節點（工人的警示燈等）也可以：它自己當骨頭，原本的網格留在原處但不畫（layers 清空）
function meshOK(o, root, moving, only) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || !o.layers.mask) return false;
  if (only && !only.has(o)) return false;
  if (Object.keys(o.userData).length || o.children.length) return false;
  const m = o.material;
  if (!m || Array.isArray(m)) return false;
  const g = o.geometry;
  // 單一材質時 three.js 不看 groups（整個幾何一起畫），所以有 groups（BoxGeometry 等）也照樣合併
  if (!g || !g.isBufferGeometry || !g.attributes.position) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  for (let p = o; p && p !== root && (p === o || !moving.has(p)); p = p.parent)
    if (p.visible === false) return false;
  return true;
}
// 材質能不能併進單一材質（base＝整台共用的貼圖）
function matOK(m, base, keep) {
  if (keep.has(m) || m.transparent || m.visible === false || m.side !== THREE.FrontSide) return false;
  if (m.alphaTest > 0 || m.wireframe || m.vertexColors || (m.opacity !== undefined && m.opacity < 1))
    return false;
  if (m.isMeshStandardMaterial) {
    for (const k of BAD_MAPS) if (m[k]) return false;
    for (const k of OK_MAPS) if (m[k] && m[k] !== base[k]) return false;
    return true;
  }
  if (m.isMeshBasicMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)
    return !m.map && !m.alphaMap && !m.envMap && !m.lightMap && !m.aoMap;
  return false;
}
// 一個材質的頂點屬性（rtsA、rtsB 各 4 個 0～255）與顏色
// unit：脈動的材質（自發光以強度 1 存，倍率由 uniform 給）
function matVals(m, base, unit) {
  const c = [0, 0, 0],
    a = [0, 0, 0, 0],
    b = [0, 0, 0, 0];
  const e = new THREE.Color(0, 0, 0);
  if (m.isMeshStandardMaterial) {
    c[0] = m.color.r;
    c[1] = m.color.g;
    c[2] = m.color.b;
    a[0] = m.roughness;
    a[1] = m.metalness;
    a[2] = m.map && m.map === base.map ? 1 : 0;
    a[3] = m.roughnessMap && m.roughnessMap === base.roughnessMap ? 1 : 0;
    e.copy(m.emissive).multiplyScalar(unit ? 1 : m.emissiveIntensity);
    b[3] = m.normalMap && m.normalMap === base.normalMap ? Math.min(1, Math.abs(m.normalScale.x)) : 0;
  } else if (m.isMeshBasicMaterial) {
    // 不受光的顏色：當成自發光
    e.copy(m.color);
    a[0] = 1;
  } else {
    c[0] = m.color.r;
    c[1] = m.color.g;
    c[2] = m.color.b;
    a[0] = 0.85;
    if (m.emissive) e.copy(m.emissive).multiplyScalar(m.emissiveIntensity || 1);
  }
  b[0] = e.r / E_K;
  b[1] = e.g / E_K;
  b[2] = e.b / E_K;
  const q = (x) => Math.max(0, Math.min(255, Math.round(x * 255)));
  return { c: c.map(q), a: a.map(q), b: b.map(q) };
}
// 整台最常用的貼圖（磨損、面板法線）
function baseMaps(meshes) {
  const base = {};
  for (const k of OK_MAPS) {
    const n = new Map();
    for (const o of meshes) {
      const t = o.material.isMeshStandardMaterial && o.material[k];
      if (t) n.set(t, (n.get(t) || 0) + o.geometry.attributes.position.count);
    }
    let best = null,
      bn = 0;
    for (const [t, c] of n) if (c > bn) ((best = t), (bn = c));
    base[k] = best;
  }
  return base;
}

const _v = new THREE.Vector3();
// 實心的部分：一律輸出沒有索引的三角形（索引幾何展開），屬性 position、uv、color（Uint8 正規化）、
// rtsA／rtsB（Uint8 正規化）、skinIndex（Uint8）、skinWeight（Uint8 正規化）
function buildSolid(items, base, pulse) {
  let total = 0;
  for (const it of items) total += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
  const pos = new Float32Array(total * 3),
    uv = new Float32Array(total * 2),
    col = new Uint8Array(total * 4), // 3 個分量（stride 4）
    at = new Uint8Array(total * 8), // rtsA(4)＋rtsB(4)
    si = new Uint8Array(total * 4),
    sw = new Uint8Array(total * 4);
  let o = 0;
  for (const it of items) {
    const g = it.geo,
      P = g.attributes.position,
      U = g.attributes.uv,
      I = g.index;
    const n = I ? I.count : P.count;
    const flip = it.mm.determinant() < 0;
    const pc = pulse ? pulse.get(it.mat) || 0 : 0;
    const mv = matVals(it.mat, base, pc > 0);
    for (let i = 0; i < n; i++) {
      // 鏡像（行列式為負）時每個三角形的第 2、3 個頂點對調，維持正面朝外
      const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i;
      const k = I ? I.getX(j) : j;
      const t = o + i;
      _v.set(P.getX(k), P.getY(k), P.getZ(k)).applyMatrix4(it.mm);
      pos[t * 3] = _v.x;
      pos[t * 3 + 1] = _v.y;
      pos[t * 3 + 2] = _v.z;
      if (U) {
        uv[t * 2] = U.getX(k);
        uv[t * 2 + 1] = U.getY(k);
      }
      col[t * 4] = mv.c[0];
      col[t * 4 + 1] = mv.c[1];
      col[t * 4 + 2] = mv.c[2];
      for (let c = 0; c < 4; c++) {
        at[t * 8 + c] = mv.a[c];
        at[t * 8 + 4 + c] = mv.b[c];
      }
      si[t * 4] = it.bi;
      si[t * 4 + 1] = pc;
      sw[t * 4] = 255;
    }
    o += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const ci = new THREE.InterleavedBuffer(col, 4);
  out.setAttribute('color', new THREE.InterleavedBufferAttribute(ci, 3, 0, true));
  const ib = new THREE.InterleavedBuffer(at, 8);
  out.setAttribute('rtsA', new THREE.InterleavedBufferAttribute(ib, 4, 0, true));
  out.setAttribute('rtsB', new THREE.InterleavedBufferAttribute(ib, 4, 4, true));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

// 合併一次；回傳還原函式（沒有合併任何東西時為 null）
function mergeOnce(rig, ctx) {
  const root = rig.group;
  const moving = rigRefs(rig, rig.dmg);
  if (ctx.extra) for (const o of rigRefs(ctx.extra)) moving.add(o); // 實體的附加物（MechEntity 的 sx：盾牌 MT 的大盾）
  moving.delete(root);
  root.updateMatrixWorld(true);
  // 動作會改的材質（rig 參照到的；rig.mats 是受擊閃光用的，照樣合併）
  const keep = rigMats(rig);
  for (const m of rig.mats || []) keep.delete(m);
  keep.delete(ctx.mat);
  const solids = [],
    outlines = [],
    decals = [];
  root.traverse((o) => {
    if (!meshOK(o, root, moving, ctx.only)) return;
    if (isOutline(o.material)) outlines.push(o);
    else if (isDecal(o.material) && !keep.has(o.material)) decals.push(o);
    else solids.push(o);
  });
  const base = ctx.base || (ctx.base = baseMaps(solids));
  const sol = solids.filter((o) => matOK(o.material, base, keep));
  if (sol.length + outlines.length < 2 && !decals.length) return null;
  const anchorOf = (o) => {
    if (moving.has(o)) return o;
    let p = o.parent;
    while (p && p !== root && !moving.has(p)) p = p.parent;
    return p || root;
  };
  const bones = [],
    boneIdx = new Map();
  const item = (o) => {
    const an = anchorOf(o);
    let bi = boneIdx.get(an);
    if (bi === undefined) {
      bi = bones.length;
      boneIdx.set(an, bi);
      bones.push(an);
    }
    // 網格到根（不含根）的矩陣
    const mm = o.matrix.clone();
    for (let p = o.parent; p && p !== root; p = p.parent) mm.premultiply(p.matrix);
    return { geo: o.geometry, mm, bi, mat: o.material };
  };
  const made = [];
  const src = [];
  if (sol.length) {
    const items = sol.map(item);
    if (bones.length < 256) {
      const mat = ctx.mat;
      if (!ctx.matInit) {
        ctx.matInit = true;
        mat.map = base.map;
        mat.roughnessMap = base.roughnessMap;
        mat.normalMap = base.normalMap;
        tagStyle({ traverse: (f) => f({ material: mat }) }, styleCat(sol[0].material));
        if (rig.mats && !rig.mats.includes(mat)) rig.mats.push(mat);
      }
      const mesh = new THREE.SkinnedMesh(buildSolid(items, base, ctx.pulse), mat);
      if (ctx.pulseList) mesh.onBeforeRender = ctx.pulseUpd;
      mesh.castShadow = sol.some((o) => o.castShadow);
      mesh.receiveShadow = sol.some((o) => o.receiveShadow);
      made.push(mesh);
      for (const o of sol) src.push([o, o.parent]);
    }
  }
  // 描邊外殼：屬性相同的一組一個（通常整台一個）
  const bySig = new Map();
  for (const o of outlines) {
    const k = attrSig(o.geometry);
    if (!bySig.has(k)) bySig.set(k, []);
    bySig.get(k).push(o);
  }
  for (const list of bySig.values()) {
    if (bones.length >= 65535) break;
    const mesh = new THREE.SkinnedMesh(mergeList(list.map(item)), OUTLINE_SKIN);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = list[0].renderOrder;
    made.push(mesh);
    for (const o of list) src.push([o, o.parent]);
  }
  for (const o of decals) src.push([o, o.parent]);
  // 自己是骨頭的網格不拿掉（節點還要動），只是不畫
  const masks = [];
  for (const [o, p] of src)
    if (moving.has(o)) {
      masks.push([o, o.layers.mask]);
      o.layers.mask = 0;
    } else p.remove(o);
  if (made.length) {
    const sk = makeSkeleton(root, bones, []);
    for (const m of made) {
      root.add(m);
      // 動作會讓零件離開建模時的外框：放大包圍球，避免在畫面邊緣被提早剔除
      m.geometry.boundingSphere.radius *= 1.5;
      m.updateMatrixWorld(true);
      m.bind(sk, m.matrixWorld);
    }
  }
  return () => {
    for (const m of made) {
      root.remove(m);
      m.geometry.dispose();
    }
    for (const [o, p] of src) if (!moving.has(o)) p.add(o);
    for (const [o, mk] of masks) o.layers.mask = mk;
  };
}

// ---------- 骨頭的群組（延後更新矩陣）----------
// 合併之後模型的節點（約 60 個）只剩骨頭的用途：網格都直接掛在根上。把根原本的子節點收進一個群組，
// 沒有其他網格留在裡面時群組設成不顯示（rtsGlass：骨頭的可見度不看它），算繪時 three.js 走訪場景就不必進去；
// 場景每格的 updateMatrixWorld 也略過它（RTS_LAZY.on 的期間），改在這台模型的骨架要算繪時才更新
// （makeSkeleton 呼叫 root.rtsLazyUpd），所以畫面外的單位不算節點矩陣。
// 遊戲端讀節點位置一律用 getWorldPosition（會自己往上更新），不受影響。
// 之後有網格掛進骨頭（特效、盾牌…）時，更新時發現就改回一般的群組（顯示、每格更新）。
export const RTS_LAZY = { on: false };
const UMW = THREE.Object3D.prototype.updateMatrixWorld;
function lazyUMW(force) {
  if (RTS_LAZY.on) {
    this.lazyDirty = true;
    return;
  }
  UMW.call(this, force);
  this.lazyDirty = false;
}
const isDrawn = (o) => (o.isMesh || o.isLine || o.isPoints || o.isSprite || o.isLight) && o.layers.mask !== 0;
function hasDrawn(o) {
  for (const c of o.children) if (isDrawn(c) || hasDrawn(c)) return true;
  return false;
}
// 節點矩陣（同 Object3D.updateMatrixWorld(true)），回傳子樹裡有沒有要畫的東西
function updTree(o) {
  let d = false;
  const ch = o.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c.matrixAutoUpdate) c.updateMatrix();
    c.matrixWorld.multiplyMatrices(o.matrixWorld, c.matrix);
    c.matrixWorldNeedsUpdate = false;
    if (isDrawn(c)) d = true;
    if (c.children.length && updTree(c)) d = true;
  }
  return d;
}
function setLazy(root, holder, on) {
  holder.visible = !on;
  if (on) {
    holder.updateMatrixWorld = lazyUMW;
    holder.lazyDirty = true;
    // 骨頭（掛在根上的蒙皮網格的骨架）與上次整棵更新時根的反矩陣
    const bones = [];
    for (const c of root.children)
      if (c.isSkinnedMesh && c.skeleton)
        for (const b of c.skeleton.bones) if (!bones.includes(b)) bones.push(b);
    const inv = new THREE.Matrix4(),
      invFull = new THREE.Matrix4(),
      dm = new THREE.Matrix4();
    let fresh = false,
      skips = 0;
    // 節點相對根的矩陣（上次整棵更新時的姿勢）：遊戲端每格要讀的節點（推進器噴口）用「現在的根 × 它」，
    // 不必每次往上更新一整串（MechEntity.thrusterFx）。還沒整棵更新過時回傳 null
    root.rtsRel = (node, out) => (fresh ? out.multiplyMatrices(invFull, node.matrixWorld) : null);
    root.rtsLazyUpd = () => {
      if (!holder.lazyDirty || holder.parent !== root) return;
      holder.lazyDirty = false;
      // 這一格沒有更新動作（MechEntity.move 拉遠時動作隔格，rtsPosed＝false）：骨頭只跟著根移動
      // （新的根 × 舊的根的反矩陣），不重算整棵；連續最多 3 格
      const posed = root.rtsPosed !== false;
      root.rtsPosed = undefined;
      if (!posed && fresh && skips < 3) {
        skips++;
        dm.multiplyMatrices(root.matrixWorld, inv);
        for (const b of bones) if (b !== root) b.matrixWorld.premultiply(dm);
        inv.copy(root.matrixWorld).invert();
        return;
      }
      skips = 0;
      if (holder.matrixAutoUpdate) holder.updateMatrix();
      holder.matrixWorld.multiplyMatrices(root.matrixWorld, holder.matrix);
      if (updTree(holder)) return void setLazy(root, holder, false); // 有網格掛進來了：改回一般的群組
      inv.copy(root.matrixWorld).invert();
      invFull.copy(inv);
      fresh = true;
    };
  } else {
    delete holder.updateMatrixWorld;
    holder.lazyDirty = false;
    root.rtsLazyUpd = null;
    root.rtsRel = null;
    holder.matrixWorldNeedsUpdate = true;
  }
}

// MechEntity.mergeModel（RTS 渲染設定開著時）：先記下模型本身的節點（根的子節點），真正的合併延到第一次算繪前
// （Game.rtsRenderTick 呼叫 rtsMergeNow）：生產時才加上去的零件（工人的工程套件、貨箱、鑽頭，掛在模型的節點上）
// 一起合併；之後直接掛在根上的附加物（盾牌 MT 的大盾等，MechEntity.specialInit）不收進骨頭群組、不合併。
// rig 的介面同 mesh-merge.js 的 mergeRig（合併之後才有 unmerge／remerge）
export function mergeRtsRig(rig) {
  const root = rig && rig.group;
  if (!root || rig.merged || rig.rtsKids) return rig;
  rig.rtsKids = [...root.children];
  rig.rtsPending = true;
  return rig;
}
export function rtsMergeNow(rig, extra) {
  const root = rig && rig.group;
  if (!root || !rig.rtsPending) return rig;
  rig.rtsPending = false;
  if (rig.merged) return rig;
  const holder = new THREE.Group();
  holder.rtsGlass = true;
  holder.matrixAutoUpdate = false;
  for (const c of rig.rtsKids) if (c.parent === root) holder.add(c);
  root.add(holder);
  root.rtsHolder = holder;
  const only = new Set();
  holder.traverse((o) => {
    if (o.isMesh) only.add(o);
  });
  // 直接掛在根上的附加物也併進單一材質（extra 參照到的節點當骨頭），沒併的照原樣留在根上
  for (const c of root.children)
    if (c !== holder)
      c.traverse((o) => {
        if (o.isMesh) only.add(o);
      });
  const ctx = {
    only,
    extra,
    base: null,
    mat: new RtsUnitMat({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 1,
      flatShading: true,
      skinning: true,
    }),
    matInit: false,
  };
  // 脈動的發光材質：動作函式會改發光強度的標準材質（rig.rtsPulseMats：地圖專屬敵人的模型，foe-merge.js 試驗出的），
  // 有自發光顏色的最多 4 種
  const pl = [];
  for (const m of rig.rtsPulseMats || []) {
    if (
      m &&
      m.isMeshStandardMaterial &&
      !pl.includes(m) &&
      m.emissive &&
      m.emissive.getHex() &&
      pl.length < 4
    )
      pl.push(m);
  }
  if (pl.length) {
    ctx.pulse = new Map(pl.map((m, i) => [m, i + 1]));
    ctx.pulseList = pl;
    const U = ctx.mat.rtsPulseU || (ctx.mat.rtsPulseU = { value: new THREE.Vector4(1, 1, 1, 1) });
    ctx.pulseUpd = () => {
      U.value.set(
        pl[0].emissiveIntensity,
        pl[1] ? pl[1].emissiveIntensity : 1,
        pl[2] ? pl[2].emissiveIntensity : 1,
        pl[3] ? pl[3].emissiveIntensity : 1,
      );
    };
  }
  const skinCache = new Map();
  const build = () => {
    const r1 = mergeOnce(rig, ctx);
    // 剩下的：合併時就有、還掛在模型上的網格，依材質合併
    const rest = new Set();
    holder.traverse((o) => {
      if (o.isMesh && only.has(o)) rest.add(o);
    });
    const moving = rigRefs(rig, rig.dmg);
    if (extra) for (const o of rigRefs(extra)) moving.add(o);
    moving.delete(root);
    moving.delete(holder);
    const r2 = rest.size ? mergeStatic(root, moving, true, { names: true, skinCache, only: rest }) : null;
    setLazy(root, holder, !hasDrawn(holder));
    return () => {
      setLazy(root, holder, false);
      if (r2) r2();
      if (r1) r1();
    };
  };
  let restore = build();
  rig.merged = true;
  rig.rtsMerged = true;
  rig.unmerge = () => {
    if (restore) restore();
    restore = null;
  };
  rig.remerge = () => {
    if (!restore) restore = build();
  };
  return rig;
}
