// 模型的網格合併（降低 draw call），地圖專屬敵人（foe-merge.js）與遊戲實體的機甲、載具、Boss（mergeRig）共用。
// 程式模型的每個群組都是「每種材質一個網格＋描邊外殼」，一台機甲 80～150 個網格。這裡在建模之後把網格依材質合併，
// 外觀與動作不變：
// - 不會動的零件併到最近的「錨點」（會動的節點或根）；
// - 同材質但分在不同錨點的，合併成一個 SkinnedMesh：每個錨點一根骨頭（頂點權重 1），整台模型共用一副骨架，
//   錨點照舊由動作與行為端移動、旋轉、縮放、顯示／隱藏（隱藏的骨頭矩陣歸零），所以每種材質大約只剩一個網格。
// 錨點＝rig 物件裡參照到的任何 Object3D（關節群組、連接點、區塊、mounts、extra…；陣列與一般物件往下找），
// 地圖專屬敵人另外以試驗找出動作函式會改的節點（foe-merge.js）。
// 有名稱（機甲與載具可以放寬：GLB 的網格都有名稱）、userData 不是空的、半透明（不寫深度的貼花與加色光除外）、
// 不顯示、多重材質、有子節點的網格不合併。
// 蒙皮網格的材質是複本（見 skinMat），陰影、描邊外殼（OUTLINE_SKIN）、SSAO 的法線（style/pipeline.js 的
// skinAwareSSAO）、冰殼（mech-status.js）、透視輪廓（game/camera.js 的 camXray）都有蒙皮版。只改外觀的網格數，
// 不影響判定與協定。
// 只在遊戲實體使用：模型庫、組裝調整頁、GLB 編輯器、機甲庫的展示台要點選與編輯各個區塊，不合併。

import { OUTLINE_MAT, OUTLINE_SKIN, isOutline } from './geometry.js';
import { styleCat, tagStyle } from './style/shader.js';

// 網址帶 nomerge 時不合併遊戲實體（效能比較用）
const OFF = typeof location !== 'undefined' && /[?&]nomerge\b/.test(location.search || '');

export const isUnder = (o, root) => {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
};
// 節點路徑：從根開始的子節點索引
export function pathsOf(root) {
  const map = new Map();
  const walk = (o, p) => {
    map.set(o, p);
    o.children.forEach((c, i) => walk(c, p + '/' + i));
  };
  walk(root, '');
  return map;
}

// rig 物件裡參照到的材質（動作會改的發光材質等）
export function rigMats(rig) {
  const out = new Set();
  const seen = new Set();
  const visit = (v, d) => {
    if (!v || typeof v !== 'object' || seen.has(v) || d > 6) return;
    seen.add(v);
    if (v.isMaterial) return void out.add(v);
    if (v.isObject3D || v.isTexture || v.isBufferGeometry) return;
    if (Array.isArray(v)) for (const x of v) visit(x, d + 1);
    else if (Object.getPrototypeOf(v) === Object.prototype)
      for (const k of Object.keys(v)) visit(v[k], d + 1);
  };
  for (const k of Object.keys(rig)) visit(rig[k], 0);
  return out;
}
// 貼花（geometry.js 的 decal：每張各自 new 一個相同設定的材質）改用同一個材質，才能和同一錨點的其他貼花合併
export function shareDecals(root, keep) {
  const by = new Map();
  root.traverse((o) => {
    const m = o.isMesh && o.material;
    if (!m || !m.isMeshBasicMaterial || !m.map || !m.transparent || m.depthWrite || !m.polygonOffset) return;
    if (keep.has(m) || o.name || Object.keys(o.userData).length) return;
    const k = [
      m.map.uuid,
      m.color.getHex(),
      m.opacity,
      m.blending,
      m.side,
      m.polygonOffsetFactor,
      m.polygonOffsetUnits,
      m.alphaTest,
    ].join('|');
    const c = by.get(k);
    if (!c) by.set(k, m);
    else o.material = c;
  });
}

// rig 物件裡參照到的 Object3D（skip＝略過的子物件：rig.dmg 另外處理）
export function rigRefs(rig, skip) {
  const out = new Set();
  const seen = new Set();
  const visit = (v, d) => {
    if (!v || typeof v !== 'object' || v === skip || seen.has(v) || d > 6) return;
    seen.add(v);
    if (v.isObject3D) {
      out.add(v);
      return;
    }
    if (v.isMaterial || v.isTexture || v.isBufferGeometry) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, d + 1);
      return;
    }
    const pr = Object.getPrototypeOf(v);
    if (pr !== Object.prototype && pr !== null) return;
    for (const k of Object.keys(v)) visit(v[k], d + 1);
  };
  for (const k of Object.keys(rig)) visit(rig[k], 0);
  return out;
}

// 依錨點與材質合併
export function attrSig(g) {
  return (
    (g.index ? 'i:' : '') +
    Object.keys(g.attributes)
      .sort()
      .map((k) => k + g.attributes[k].itemSize + (g.attributes[k].normalized ? 'n' : ''))
      .join(',')
  );
}
const _m3 = new THREE.Matrix3();
const GET = ['getX', 'getY', 'getZ', 'getW']; // r128 的 BufferAttribute 沒有 getComponent
const _v = new THREE.Vector3();
// 正規化的整數屬性（GLB 的頂點色等）：r128 的 getX 回傳原始整數，合併成 Float32 時換算成 0～1
function denormOf(a) {
  if (!a.normalized) return 0;
  const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  if (arr instanceof Uint8Array || arr instanceof Uint8ClampedArray) return 255;
  if (arr instanceof Int8Array) return 127;
  if (arr instanceof Uint16Array) return 65535;
  if (arr instanceof Int16Array) return 32767;
  return 0;
}
export function mergeList(list) {
  // list: [{ geo, mm, bi }]（mm＝網格到錨點（蒙皮時是根）的矩陣、bi＝骨頭編號，只有蒙皮時有）
  // 來源有索引時輸出索引幾何（GLB），否則照原本攤平的頂點（程式模型）；屬性一律以 getX… 讀（交錯緩衝也可以）
  const names = Object.keys(list[0].geo.attributes);
  const indexed = !!list[0].geo.index; // 同一組的索引有無相同（attrSig）
  let total = 0,
    totalIx = 0;
  for (const { geo } of list) {
    const n = geo.attributes.position.count;
    total += n;
    totalIx += indexed ? geo.index.count : n;
  }
  const flips = list.map(({ mm }) => mm.determinant() < 0);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = list[0].geo.attributes[name];
    const sz = a0.itemSize;
    const den = denormOf(a0);
    const arr = new Float32Array(total * sz);
    let off = 0;
    for (let k = 0; k < list.length; k++) {
      const { geo, mm } = list[k];
      const a = geo.attributes[name];
      const n = a.count;
      const flip = !indexed && flips[k];
      const nm = name === 'normal' ? _m3.getNormalMatrix(mm) : null;
      for (let i = 0; i < n; i++) {
        // 沒有索引、行列式為負（鏡像）時把每個三角形的第 2、3 個頂點對調，維持正面朝外
        const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i;
        const o = (off + j) * sz;
        if (name === 'position') {
          _v.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix4(mm);
          arr[o] = _v.x;
          arr[o + 1] = _v.y;
          arr[o + 2] = _v.z;
        } else if (name === 'normal') {
          _v.set(a.getX(i), a.getY(i), a.getZ(i)).applyMatrix3(nm).normalize();
          arr[o] = _v.x;
          arr[o + 1] = _v.y;
          arr[o + 2] = _v.z;
        } else if (name === 'onormal') {
          // 描邊外殼的位移方向：照原本「在網格座標位移、再經過網格的變換」，只套線性部分、不正規化
          const e = mm.elements;
          const x = a.getX(i),
            y = a.getY(i),
            z = a.getZ(i);
          arr[o] = e[0] * x + e[4] * y + e[8] * z;
          arr[o + 1] = e[1] * x + e[5] * y + e[9] * z;
          arr[o + 2] = e[2] * x + e[6] * y + e[10] * z;
        } else if (den) {
          for (let c = 0; c < sz; c++) arr[o + c] = a[GET[c]](i) / den;
        } else {
          for (let c = 0; c < sz; c++) arr[o + c] = a[GET[c]](i);
        }
      }
      off += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz, den ? false : a0.normalized));
  }
  if (indexed) {
    const ix = total > 65535 ? new Uint32Array(totalIx) : new Uint16Array(totalIx);
    let o = 0,
      base = 0;
    for (let k = 0; k < list.length; k++) {
      const g = list[k].geo;
      const I = g.index;
      const n = I.count;
      const flip = flips[k];
      for (let i = 0; i < n; i++) {
        const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i;
        ix[o + j] = base + I.getX(i);
      }
      o += n;
      base += g.attributes.position.count;
    }
    out.setIndex(new THREE.BufferAttribute(ix, 1));
  }
  if (list[0].bi !== undefined) {
    // 骨頭編號（Uint16）與權重（Uint8 正規化，第一個分量 1）
    const si = new Uint16Array(total * 4),
      sw = new Uint8Array(total * 4);
    let off = 0;
    for (let k = 0; k < list.length; k++) {
      const n = list[k].geo.attributes.position.count;
      const b = list[k].bi;
      for (let i = 0; i < n; i++) {
        si[(off + i) * 4] = b;
        sw[(off + i) * 4] = 255;
      }
      off += n;
    }
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, true));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function mergeable(o, root, moving, names) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || moving.has(o)) return false;
  if ((o.name && !names) || Object.keys(o.userData).length || o.children.length) return false;
  const m = o.material;
  // 半透明的只合併不寫深度的（貼花、加色的光）：彼此不重疊，不受排序影響
  // 描邊外殼的材質由渲染風格整個開關（RTS 拉遠時暫時關掉，style/pipeline.js 的 hullOff），關著時照樣合併
  if (!m || Array.isArray(m) || (m.transparent && m.depthWrite) || (!m.visible && !isOutline(m)))
    return false;
  const g = o.geometry;
  if (!g || !g.isBufferGeometry || !g.attributes.position || g.groups.length) return false;
  if (g.drawRange.start !== 0 || g.drawRange.count !== Infinity) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  // 自己與到錨點之間的群組都要顯示
  for (let p = o; p && p !== root && !moving.has(p); p = p.parent) if (p.visible === false) return false;
  return true;
}

// 可以蒙皮（skinning）的材質：標準／基本材質與描邊外殼。three.js r128 的同一個材質不會依物件是不是
// SkinnedMesh 換著色程式，所以蒙皮網格一律用材質的複本（描邊外殼用 geometry.js 的 OUTLINE_SKIN），
// 原本的材質留給沒有合併的網格。複本每格從原本的材質同步會變的值（閃光、受傷變色、預警發光、透明度…），
// 所以動作與行為端照舊只改原本的材質；直接改複本的（迷彩等 traverse 整台模型的效果）也保留，
// 因為只有原本的材質改變時才覆寫。
const skinOK = (m) =>
  m === OUTLINE_MAT ||
  m.isMeshStandardMaterial ||
  m.isMeshBasicMaterial ||
  m.isMeshLambertMaterial ||
  m.isMeshPhongMaterial;
const SYNC_N = [
  'emissiveIntensity',
  'opacity',
  'transparent',
  'visible',
  'depthWrite',
  'roughness',
  'metalness',
];
const SYNC_C = ['color', 'emissive'];
function skinMat(orig) {
  if (orig === OUTLINE_MAT) return { mat: OUTLINE_SKIN, sync: null };
  const c = orig.clone();
  c.skinning = true;
  const last = { v: orig.version };
  for (const k of SYNC_N) last[k] = orig[k];
  for (const k of SYNC_C) if (orig[k]) last[k] = orig[k].clone();
  const sync = () => {
    for (const k of SYNC_N) if (orig[k] !== last[k]) c[k] = last[k] = orig[k];
    for (const k of SYNC_C) if (last[k] && !orig[k].equals(last[k])) c[k].copy(last[k].copy(orig[k]));
    if (orig.version !== last.v) {
      last.v = orig.version;
      c.needsUpdate = true;
    }
  };
  return { mat: c, sync };
}
// 每格只算一次骨架（同一台模型的蒙皮網格共用）：骨頭（錨點）本身或上層不顯示時把矩陣歸零（頂點縮到一點＝
// 隱藏），並同步材質複本（three.js 在投影物件時呼叫，不受材質的 visible 影響）。
// 骨頭被拆離模型、又不在場景裡（沒有上層）時也當成隱藏，不會停在原地。
// 一根骨頭看不看得到（慢的版本：一路往上走到根）
function boneVisSlow(root, b) {
  let p = b;
  // 和 three.js 一樣只認 === false（有些動作把 visible 設成 0 之類的假值，畫面上照樣顯示）
  for (; p && p !== root; p = p.parent) if (p.visible === false && !p.rtsGlass) return false;
  if (!p) {
    // 走到最上層還沒遇到根：拆離了模型。在場景裡的照常跟著它（例如被丟到場上的零件）
    let top = b;
    while (top.parent) top = top.parent;
    if (!top.isScene) return false;
  }
  return true;
}
// rtsGlass 的節點（render/rts-merge.js 收骨頭的群組）不看 visible。
// 骨頭的可見度由上往下算：建立時記下每根骨頭到上一根骨頭（或根）之間的節點，每格只看這段＋上一根骨頭的結果
// （原本每根骨頭都走到根，骨頭多時是 O(骨頭數×深度)）；中間的節點被拆離、換了上層時改走慢的版本
export function makeSkeleton(root, bones, syncs) {
  const sk = new THREE.Skeleton(bones);
  const n = bones.length;
  const idx = new Map();
  bones.forEach((b, i) => idx.set(b, i));
  const chain = [],
    stop = [],
    pb = new Int32Array(n),
    depth = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = [];
    let p = bones[i];
    if (p !== root) {
      c.push(p);
      for (p = p.parent; p && p !== root && !idx.has(p); p = p.parent) c.push(p);
    }
    chain.push(c);
    stop.push(p || null);
    pb[i] = p && p !== root && idx.has(p) ? idx.get(p) : -1;
  }
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let j = pb[i]; j >= 0 && d <= n; j = pb[j]) d++;
    depth[i] = d;
  }
  const order = [...Array(n).keys()].sort((x, y) => depth[x] - depth[y]);
  const vis = new Uint8Array(n);
  const upd = sk.update;
  sk.update = function () {
    if (root.rtsLazyUpd) root.rtsLazyUpd(); // RTS 單位：骨頭的矩陣延到算繪時才算（render/rts-merge.js）
    upd.call(this);
    const a = this.boneMatrices;
    for (const i of order) {
      const b = bones[i],
        c = chain[i];
      let v = 1;
      if (b !== root) {
        // 這一段的節點都還接著（每個節點的上層是建立時的那個）
        let ok = !!stop[i];
        for (let k = 0; ok && k < c.length; k++) if (c[k].parent !== (c[k + 1] || stop[i])) ok = false;
        if (!ok) v = boneVisSlow(root, b) ? 1 : 0;
        else {
          v = pb[i] < 0 ? 1 : vis[pb[i]];
          for (let k = 0; v && k < c.length; k++) if (c[k].visible === false && !c[k].rtsGlass) v = 0;
        }
      }
      vis[i] = v;
      if (!v) a.fill(0, i * 16, i * 16 + 16);
    }
    for (const f of syncs) f();
  };
  return sk;
}

// 合併 root 底下的網格。moving＝會動的節點（錨點）：
// - 同一個錨點底下、同材質的網格合併成一個一般網格，掛在錨點上（跟著錨點動）；
// - 同材質但分在不同錨點的，合併成一個 SkinnedMesh（每個錨點一根骨頭，頂點權重 1），整台模型共用一副骨架，
//   所以每種材質只剩一個網格，動作照舊由錨點的變換決定。
// detach＝之後會從模型拆下的節點（rig.dmg 的 plates／chunks）：牽涉到它們的合併記下來，拆下之前
// restore() 還原成原本的網格；detach 為 true 時記下全部的合併（整台還原）。
// opts.names：有名稱的網格也合併（機甲與載具：GLB 的網格都有名稱，遊戲端不靠名稱找網格）。
// opts.only：只合併這些網格（Set；再合併時只動建模時就有的網格，之後掛上去的特效、盾牌等不動）。
// opts.skinCache：材質複本的快取（Map），再合併時沿用同一個複本（迷彩、適應裝甲記下的材質照樣有效）。
// 回傳 restore（沒有記下的合併時為 null）。
export function mergeStatic(root, moving, detach = new Set(), opts = {}) {
  const all = detach === true;
  const names = !!opts.names;
  root.updateMatrixWorld(true);
  const anchorOf = (o) => {
    let p = o.parent;
    while (p && p !== root && !moving.has(p)) p = p.parent;
    return p || root;
  };
  // 材質（與屬性、陰影…）→ 錨點 → 網格
  const buckets = new Map();
  root.traverse((o) => {
    if (!mergeable(o, root, moving, names) || (opts.only && !opts.only.has(o))) return;
    const a = anchorOf(o);
    const key = [
      o.material.uuid,
      attrSig(o.geometry),
      +o.castShadow,
      +o.receiveShadow,
      +o.frustumCulled,
      o.renderOrder,
      o.layers.mask,
    ].join('|');
    let byA = buckets.get(key);
    if (!byA) buckets.set(key, (byA = new Map()));
    let l = byA.get(a);
    if (!l) byA.set(a, (l = []));
    l.push(o);
  });
  const undo = [];
  const bones = [];
  const boneIdx = new Map();
  const skinned = [];
  const skinMats = new Map();
  const cache = opts.skinCache || new Map(); // 原本的材質 → 蒙皮用的複本（同一台再合併時沿用）
  const make = (geo, o0, skin) => {
    const mesh = skin ? new THREE.SkinnedMesh(geo, o0.material) : new THREE.Mesh(geo, o0.material);
    mesh.castShadow = o0.castShadow;
    mesh.receiveShadow = o0.receiveShadow;
    mesh.frustumCulled = o0.frustumCulled;
    mesh.renderOrder = o0.renderOrder;
    mesh.layers.mask = o0.layers.mask;
    return mesh;
  };
  for (const byA of buckets.values()) {
    const list0 = [...byA.values()].flat();
    if (list0.length < 2) continue;
    const skin = byA.size > 1 && skinOK(list0[0].material);
    const groups = skin ? [[root, list0]] : [...byA.entries()];
    for (const [a, list] of groups) {
      if (list.length < 2) continue;
      let det = all;
      const items = list.map((o) => {
        const mm = o.matrix.clone();
        if (!all && detach.has(o)) det = true;
        const an = anchorOf(o);
        for (let p = o.parent; p && p !== a; p = p.parent) {
          mm.premultiply(p.matrix);
          if (!all && detach.has(p)) det = true;
        }
        let bi;
        if (skin) {
          bi = boneIdx.get(an);
          if (bi === undefined) {
            bi = bones.length;
            boneIdx.set(an, bi);
            bones.push(an);
          }
        }
        return { geo: o.geometry, mm, bi };
      });
      const mesh = make(mergeList(items), list[0], skin);
      const src = list.map((o) => [o, o.parent]);
      for (const o of list) o.parent.remove(o);
      a.add(mesh);
      if (skin) {
        const o0 = mesh.material;
        let sm = cache.get(o0);
        if (!sm) cache.set(o0, (sm = skinMat(o0)));
        skinMats.set(o0, sm);
        mesh.material = sm.mat;
        tagStyle(mesh, styleCat(o0)); // 渲染風格的材質分類（機體＝1）跟著原本的材質
        // 動作會讓零件離開建模時的外框：放大包圍球，避免在畫面邊緣被提早剔除
        mesh.geometry.boundingSphere.radius *= 1.5;
        skinned.push(mesh);
      }
      if (det) undo.push({ a, mesh, src });
    }
  }
  if (skinned.length) {
    const syncs = [...skinMats.values()].map((x) => x.sync).filter(Boolean);
    const sk = makeSkeleton(root, bones, syncs);
    // root 此時沒有上層（或在場景裡也只取 root 的世界矩陣）：之後整台移動、縮放都不影響（bindMode 'attached'）
    for (const m of skinned) {
      m.updateMatrixWorld(true);
      m.bind(sk, m.matrixWorld);
    }
  }
  if (!undo.length) return null;
  return () => {
    for (const u of undo.splice(0)) {
      u.a.remove(u.mesh);
      u.mesh.geometry.dispose();
      for (const [o, p] of u.src) p.add(o);
    }
  };
}

// 遊戲實體（MechEntity）的模型：機甲（buildMech）、載具／直升機／無人機（vehicle-models.js）、Boss 與附屬部位
// （boss-models.js）。錨點＝rig 參照到的節點（關節群組、連接點、區塊的根、武器、噴口、mounts、extra…）。
// 已經合併過的（地圖專屬敵人的 foeMerged）略過。之後要把零件從模型拆下（丟出武器、擊破時支離破碎）時，
// 先呼叫 rig.unmerge() 還原成原本的網格；rig.remerge() 再合併一次（拆下的零件已不在模型裡）。
export function mergeRig(rig, opts = {}) {
  const root = rig && rig.group;
  if (!root || rig.merged || OFF) return rig;
  const skinCache = new Map();
  // 建模時就有的網格：再合併（remerge）時只合併這些，之後由行為端掛上去的網格（盾牌、特效…）照舊獨立
  const only = new Set();
  root.traverse((o) => {
    if (o.isMesh) only.add(o);
  });
  shareDecals(root, rigMats(rig));
  const build = () => {
    const moving = rigRefs(rig, rig.dmg);
    moving.delete(root);
    return mergeStatic(root, moving, true, { names: opts.names !== false, skinCache, only });
  };
  let restore = build();
  rig.merged = true;
  rig.unmerge = () => {
    if (restore) restore();
    restore = null;
  };
  rig.remerge = () => {
    if (!restore) restore = build();
  };
  return rig;
}

// 網格數（量測與測試用）
export function meshCount(root) {
  let n = 0;
  root.traverse((o) => {
    if (o.isMesh) n++;
  });
  return n;
}
