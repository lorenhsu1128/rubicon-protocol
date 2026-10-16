// 地圖專屬敵人模型的網格合併（降低 draw call）：bakeAll 只合併同一個群組裡的零件，而模型分了很多群組
// （會動的零件、擊破時拆開的區塊…），每個群組都是「每種材質一個網格＋描邊外殼」，一台 30～70 個網格。
// 這裡在建模之後（foe-models.js 的 FOE_BUILDERS 統一出口）把網格依材質合併，外觀與動作不變：
// - 不會動的零件併到最近的「錨點」（會動的節點或根）；
// - 同材質但分在不同錨點的，合併成一個 SkinnedMesh：每個錨點一根骨頭（頂點權重 1），整台模型共用一副骨架，
//   錨點照舊由動作與行為端移動、旋轉、縮放、顯示／隱藏（隱藏的骨頭矩陣歸零），所以每種材質大約只剩一個網格。
//
// 錨點＝會動的節點：
// 1. 模型 rig 物件裡參照到的任何 Object3D（extra 的節點、mounts、hand、torso…；陣列與一般物件會往下找）
//    ——行為端（mech-foe*.js、mech-special.js）都透過這些參照驅動。rig.dmg 的 plates／chunks 例外：
//    活著的時候不動，一樣合併；AP 低到裝甲板脫落或擊破時，foe-damage.js 先呼叫 rig.dmg.unmerge() 還原成
//    原本的網格再拆下，裝甲板拆完後 rig.dmg.remerge() 把剩下的再合併一次。
// 2. 動作函式（rig.animD1、rig.anim_d2）閉包裡用到的節點：建一個試驗用的模型，以各種狀態
//    （預警、攻擊、bossVis 各位元、移動、空中、擊破、客機）實際呼叫動作函式，位置／旋轉／縮放／
//    顯示／材質有變的節點都算會動。結果依模型種類快取（節點以子節點索引的路徑記錄，模型的結構是固定的）。
// 3. 有名稱、userData 不是空的（例如 helper 光錐）、半透明（不寫深度的貼花與加色光除外）、不顯示、
//    多重材質、有子節點的網格不合併。貼花（geometry.js 的 decal 每張各一個相同設定的材質）先改用同一個材質。
// 試驗與合併只在建模時做（第一次建某種模型時多花幾毫秒做試驗）；每格只多一次骨架更新與材質同步。
// 蒙皮網格的材質是複本（見 skinMat），陰影、描邊外殼（OUTLINE_SKIN）、SSAO 的法線（style/pipeline.js 的
// skinAwareSSAO）、冰殼（mech-status.js）都有蒙皮版。只改外觀的網格數，不影響判定與協定。

import { OUTLINE_MAT, OUTLINE_SKIN } from './geometry.js';
import { styleCat, tagStyle } from './style/shader.js';

const PROBE = new Map(); // 模型種類 → 會動節點的路徑（Set<string>）

const isUnder = (o, root) => {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
};
// 節點路徑：從根開始的子節點索引
function pathsOf(root) {
  const map = new Map();
  const walk = (o, p) => {
    map.set(o, p);
    o.children.forEach((c, i) => walk(c, p + '/' + i));
  };
  walk(root, '');
  return map;
}

// rig 物件裡參照到的材質（動作會改的發光材質等）
function rigMats(rig) {
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
function shareDecals(root, keep) {
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
function rigRefs(rig, skip) {
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

// 試驗用的狀態（animD1 與 anim_d2 的欄位都有）
function probeStates() {
  const out = [];
  const vis = [0, 1, 2, 3, 4, 8, 15, 16, 32, 64, 17, 33, 65, 112, 127];
  let i = 0;
  for (const v of vis)
    for (const warn of [0, 0.5, 1])
      for (const atk of [0, 1])
        for (const mv of [0, 1]) {
          i++;
          out.push({
            t: 0.37 + i * 0.29,
            dt: 0.05,
            warn,
            atk,
            fwd: mv ? (i % 2 ? 7 : -5) : 0,
            spd: mv ? 9 : 0,
            vy: mv ? (i % 2 ? 6 : -6) : 0,
            air: mv ? 7 : 0,
            vis: v,
            dead: false,
            remote: !!(i % 3 === 0),
          });
        }
  for (const v of [0, 1, 2, 4, 32, 64]) {
    out.push({ t: 50 + v, dt: 0.05, warn: 1, atk: 1, fwd: 0, spd: 0, vy: -3, air: 2, vis: v, dead: true });
    out.push({
      t: 60 + v,
      dt: 0.05,
      warn: 0,
      atk: 0,
      fwd: 0,
      spd: 0,
      vy: 0,
      air: 0,
      vis: v,
      dead: true,
      remote: true,
    });
  }
  return out;
}

const MAT_KEYS = ['opacity', 'emissiveIntensity', 'visible', 'transparent', 'depthWrite', 'wireframe'];
// 以試驗模型找出動作函式會改的節點（路徑）
function probeMoving(build, pal, scale) {
  const r = build(pal, scale);
  const fns = [];
  if (typeof r.animD1 === 'function') fns.push((st) => r.animD1(r, st));
  if (typeof r.anim_d2 === 'function') fns.push((st) => r.anim_d2(st));
  const moving = new Set();
  if (!fns.length) return moving;
  const root = r.group;
  const paths = pathsOf(root);
  const nodes = [...paths.keys()];
  const snap = nodes.map((o) => ({
    p: o.position.clone(),
    q: o.quaternion.clone(),
    s: o.scale.clone(),
    v: o.visible,
    m: o.material,
  }));
  const mats = new Set();
  for (const o of nodes) if (o.material && !Array.isArray(o.material)) mats.add(o.material);
  const msnap = [...mats].map((m) => {
    const o = { m };
    for (const k of MAT_KEYS) o[k] = m[k];
    if (m.color) o.color = m.color.getHex();
    if (m.emissive) o.emissive = m.emissive.getHex();
    return o;
  });
  const E = 1e-6;
  const check = () => {
    nodes.forEach((o, i) => {
      if (moving.has(o)) return;
      const s = snap[i];
      if (
        o.position.distanceToSquared(s.p) > E ||
        Math.abs(o.quaternion.dot(s.q)) < 1 - E ||
        o.scale.distanceToSquared(s.s) > E ||
        o.visible !== s.v ||
        o.material !== s.m ||
        o.parent !== (i ? nodes[i]._probeParent : null)
      )
        moving.add(o);
    });
  };
  nodes.forEach((o) => (o._probeParent = o.parent));
  root._probeParent = null;
  for (const st of probeStates())
    for (const f of fns) {
      try {
        f(st);
      } catch (e) {
        /* 試驗的狀態不一定合理：略過 */
      }
      check();
    }
  // 材質的值有變（發光、透明度）：用到它的網格本身不受影響（合併後仍用同一個材質物件），只要還原就好
  for (const s of msnap) {
    for (const k of MAT_KEYS) s.m[k] = s[k];
    if (s.color !== undefined) s.m.color.setHex(s.color);
    if (s.emissive !== undefined) s.m.emissive.setHex(s.emissive);
  }
  const out = new Set();
  for (const o of moving) out.add(paths.get(o));
  for (const o of nodes) delete o._probeParent;
  return out;
}

// 依錨點與材質合併
function attrSig(g) {
  return Object.keys(g.attributes)
    .sort()
    .map((k) => k + g.attributes[k].itemSize + (g.attributes[k].normalized ? 'n' : ''))
    .join(',');
}
const _m3 = new THREE.Matrix3();
const GET = ['getX', 'getY', 'getZ', 'getW']; // r128 的 BufferAttribute 沒有 getComponent
const _v = new THREE.Vector3();
function mergeList(list) {
  // list: [{ geo, mm, bi }]（mm＝網格到錨點（蒙皮時是根）的矩陣、bi＝骨頭編號，只有蒙皮時有）
  const names = Object.keys(list[0].geo.attributes);
  const geos = list.map(({ geo, mm }) => ({ g: geo.index ? geo.toNonIndexed() : geo, mm }));
  let total = 0;
  for (const { g } of geos) total += g.attributes.position.count;
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const a0 = geos[0].g.attributes[name];
    const sz = a0.itemSize;
    const arr = new Float32Array(total * sz);
    let off = 0;
    for (const { g, mm } of geos) {
      const a = g.attributes[name];
      const n = a.count;
      const flip = mm.determinant() < 0;
      const nm = name === 'normal' ? _m3.getNormalMatrix(mm) : null;
      for (let i = 0; i < n; i++) {
        // 行列式為負（鏡像）時把每個三角形的第 2、3 個頂點對調，維持正面朝外
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
        } else {
          for (let c = 0; c < sz; c++) arr[o + c] = a[GET[c]](i);
        }
      }
      off += n;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, sz, a0.normalized));
  }
  if (list[0].bi !== undefined) {
    const si = new Float32Array(total * 4),
      sw = new Float32Array(total * 4);
    let off = 0;
    for (let k = 0; k < geos.length; k++) {
      const n = geos[k].g.attributes.position.count;
      for (let i = 0; i < n; i++) {
        si[(off + i) * 4] = list[k].bi;
        sw[(off + i) * 4] = 1;
      }
      off += n;
    }
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

function mergeable(o, root, moving) {
  if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || moving.has(o)) return false;
  if (o.name || Object.keys(o.userData).length || o.children.length) return false;
  const m = o.material;
  // 半透明的只合併不寫深度的（貼花、加色的光）：彼此不重疊，不受排序影響
  if (!m || Array.isArray(m) || (m.transparent && m.depthWrite) || !m.visible) return false;
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
  m === OUTLINE_MAT || m.isMeshStandardMaterial || m.isMeshBasicMaterial || m.isMeshLambertMaterial;
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
// 隱藏），並同步材質複本（three.js 在投影物件時呼叫，不受材質的 visible 影響）
function makeSkeleton(root, bones, syncs) {
  const sk = new THREE.Skeleton(bones);
  const upd = sk.update;
  sk.update = function () {
    upd.call(this);
    const a = this.boneMatrices;
    for (let i = 0; i < bones.length; i++) {
      let vis = true;
      // 和 three.js 一樣只認 === false（有些動作把 visible 設成 0 之類的假值，畫面上照樣顯示）
      for (let p = bones[i]; p && p !== root; p = p.parent)
        if (p.visible === false) {
          vis = false;
          break;
        }
      if (!vis) a.fill(0, i * 16, i * 16 + 16);
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
// restore() 還原成原本的網格。回傳 restore（沒有這種合併時為 null）。
export function mergeStatic(root, moving, detach = new Set()) {
  root.updateMatrixWorld(true);
  const anchorOf = (o) => {
    let p = o.parent;
    while (p && p !== root && !moving.has(p)) p = p.parent;
    return p || root;
  };
  // 材質（與屬性、陰影…）→ 錨點 → 網格
  const buckets = new Map();
  root.traverse((o) => {
    if (!mergeable(o, root, moving)) return;
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
    const all = [...byA.values()].flat();
    if (all.length < 2) continue;
    const skin = byA.size > 1 && skinOK(all[0].material);
    const groups = skin ? [[root, all]] : [...byA.entries()];
    for (const [a, list] of groups) {
      if (list.length < 2) continue;
      let det = false;
      const items = list.map((o) => {
        const mm = o.matrix.clone();
        if (detach.has(o)) det = true;
        const an = anchorOf(o);
        for (let p = o.parent; p && p !== a; p = p.parent) {
          mm.premultiply(p.matrix);
          if (detach.has(p)) det = true;
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
        const sm = skinMats.get(o0) || skinMat(o0);
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
    // root 此時沒有上層，matrixWorld＝root 自己的變換；之後整台移動、縮放都不影響（bindMode 'attached'）
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

// 地圖專屬敵人的建模出口：建好後合併靜態零件。會脫落的板與擊破時拆開的區塊也合併，
// rig.dmg.unmerge() 還原（render/foe-damage.js 在拆下之前呼叫）。
export function foeMerged(key, build) {
  return (pal, scale) => {
    const rig = build(pal, scale);
    const root = rig && rig.group;
    if (!root) return rig;
    let probe = PROBE.get(key);
    if (!probe) PROBE.set(key, (probe = probeMoving(build, pal, scale)));
    const d = rig.dmg;
    const moving = rigRefs(rig, d);
    for (const [o, p] of pathsOf(root)) if (probe.has(p)) moving.add(o);
    moving.delete(root);
    shareDecals(root, rigMats(rig));
    // 拆下的節點（還在模型裡的 plates／chunks）
    const detach = () => {
      const s = new Set();
      if (d)
        for (const o of [...(d.plates || []), ...(d.chunks || [])])
          if (o && o.isObject3D && o.parent && isUnder(o, root)) s.add(o);
      return s;
    };
    const restore = mergeStatic(root, moving, detach());
    if (d && restore) {
      d.unmerge = () => {
        restore();
        d.unmerge = null;
      };
      // 裝甲板拆下之後再合併一次（只剩擊破時拆開的區塊要記下來）
      d.remerge = () => {
        if (d.unmerge) return;
        const r = mergeStatic(root, moving, detach());
        d.unmerge = r
          ? () => {
              r();
              d.unmerge = null;
            }
          : null;
      };
    }
    return rig;
  };
}
