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
// 合併本身（錨點、蒙皮、材質複本）在 mesh-merge.js，機甲與載具也共用。

import { isUnder, mergeStatic, pathsOf, rigMats, rigRefs, shareDecals } from './mesh-merge.js';

const PROBE = new Map(); // 模型種類 → 會動節點的路徑（Set<string>）

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
  const lit = new Set(); // 發光強度會變的材質（RTS 的單一材質合併以 uniform 重現脈動）
  const check = () => {
    for (const s of msnap) if (s.m.emissiveIntensity !== s.emissiveIntensity) lit.add(s.m);
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
  // 每種發光會變的材質記一個用到它的網格的路徑
  out.lit = [];
  for (const m of lit) {
    const o = nodes.find((n) => n.material === m);
    if (o) out.lit.push(paths.get(o));
  }
  for (const o of nodes) delete o._probeParent;
  return out;
}

// 地圖專屬敵人的建模出口：建好後合併靜態零件。會脫落的板與擊破時拆開的區塊也合併，
// rig.dmg.unmerge() 還原（render/foe-damage.js 在拆下之前呼叫）。
// o.raw（RTS 渲染設定，MechEntity 的 modelKind 'boss'）：不在這裡合併，交給 render/rts-merge.js 的單一材質合併；
// 動作函式會動的節點（試驗的結果）放在 rig.rtsAnim（rigRefs 會把它們當成骨頭），rig.dmg 的 unmerge／remerge 轉給整台的
function rawRig(key, build, rig, pal, scale) {
  let probe = PROBE.get(key);
  if (!probe) PROBE.set(key, (probe = probeMoving(build, pal, scale)));
  const nodes = [];
  for (const [o, p] of pathsOf(rig.group)) if (o !== rig.group && probe.has(p)) nodes.push(o);
  rig.rtsAnim = nodes;
  // 發光會脈動的材質（render/rts-merge.js 的 rtsPulse）
  if (probe.lit && probe.lit.length) {
    const byPath = new Map();
    for (const [o, p] of pathsOf(rig.group)) byPath.set(p, o);
    rig.rtsPulseMats = probe.lit.map((p) => byPath.get(p) && byPath.get(p).material).filter(Boolean);
  }
  const d = rig.dmg;
  if (d) {
    d.unmerge = () => rig.unmerge && rig.unmerge();
    d.remerge = () => rig.remerge && rig.remerge();
  }
  return rig;
}
export function foeMerged(key, build) {
  return (pal, scale, o) => {
    const rig = build(pal, scale);
    if (o && o.raw && rig && rig.group) return rawRig(key, build, rig, pal, scale);
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
    rig.merged = true; // 遊戲實體的 mergeRig 不再合併一次
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
