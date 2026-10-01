// 組裝調整的穿幫提示：檢查每一對相鄰區塊（父區塊與接在它連接點上的子區塊）之間的縫隙與重疊。
// - 外框估算（quick）：兩塊的世界座標外框，拖曳或播放動作時即時更新
// - 網格精算（precise）：重疊＝子區塊頂點落在父區塊實體內的比例（射線穿越三角面次數的奇偶判斷）；
//   縫隙＝沒有任何頂點嵌入時，雙向「頂點到三角面」的最短距離
// 都是估算：用來提醒「可能接不好」，不是精確的碰撞判定。
import { isFxMaterial } from '../render/measure.js';

export const GAP_WARN = 0.02; // 縫隙超過 2 cm 提示
export const OVERLAP_WARN = 0.5; // 子區塊超過一半在父區塊裡提示
const MAX_VERTS = 120,
  MAX_TRIS = 400;

// 實體網格：排除描邊、發光特效與貼花（無光照的平面）
function solidMeshes(obj) {
  const out = [];
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.userData.origMat || o.material;
    if (isFxMaterial(m) || (!Array.isArray(m) && m.type === 'MeshBasicMaterial')) return;
    out.push(o);
  });
  return out;
}
function worldBox(obj) {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3(),
    tmp = new THREE.Box3();
  for (const o of solidMeshes(obj)) {
    const g = o.geometry;
    if (!g.boundingBox) g.computeBoundingBox();
    box.union(tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld));
  }
  return box;
}
// 兩個外框之間的距離（重疊時為 0）與交集體積比例（相對於子區塊）
function boxGap(a, b) {
  const d = new THREE.Vector3(
    Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x),
    Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y),
    Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z),
  );
  return d.length();
}
const vol = (b) => (b.isEmpty() ? 0 : (b.max.x - b.min.x) * (b.max.y - b.min.y) * (b.max.z - b.min.z));
function boxOverlap(parent, child) {
  const i = parent.clone().intersect(child);
  const v = vol(child);
  return v > 1e-9 ? vol(i) / v : 0;
}

// 世界座標頂點（抽樣）
function worldVerts(obj, max) {
  const all = [];
  for (const o of solidMeshes(obj)) {
    const p = o.geometry.attributes.position;
    if (!p) continue;
    all.push([o, p]);
  }
  const total = all.reduce((n, [, p]) => n + p.count, 0);
  const stride = Math.max(1, Math.ceil(total / max));
  const out = [];
  for (const [o, p] of all)
    for (let i = 0; i < p.count; i += stride)
      out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
  return out;
}
// 世界座標三角面（抽樣）
function worldTris(obj, max) {
  const list = [];
  for (const o of solidMeshes(obj)) {
    const g = o.geometry,
      p = g.attributes.position;
    if (!p) continue;
    const idx = g.index;
    const n = (idx ? idx.count : p.count) / 3;
    list.push([o, p, idx, n]);
  }
  const total = list.reduce((s, x) => s + x[3], 0);
  const stride = Math.max(1, Math.ceil(total / max));
  const out = [];
  for (const [o, p, idx, n] of list)
    for (let t = 0; t < n; t += stride) {
      const v = [0, 1, 2].map((k) =>
        new THREE.Vector3()
          .fromBufferAttribute(p, idx ? idx.getX(t * 3 + k) : t * 3 + k)
          .applyMatrix4(o.matrixWorld),
      );
      out.push(new THREE.Triangle(v[0], v[1], v[2]));
    }
  return out;
}
// 相鄰的區塊對：{ parent, child, conn, weapon }（武器本來就握在手裡，只檢查縫隙）
export function piecePairs(rig) {
  const out = [];
  for (const m of rig.mounts)
    for (const [slot, obj] of Object.entries(rig.pieces))
      if (obj.parent && obj.parent.parent === m.node)
        out.push({ parent: m.slot, child: slot, conn: m.name, weapon: /^(weapon|back)\//.test(slot) });
  // 肩上武器靠在同側上臂的肩甲上：和上臂接觸也算接上
  for (const p of out) {
    const k = /^back\/[^/]+\/(r|l)$/.exec(p.child);
    if (k) p.also = Object.keys(rig.pieces).filter((s) => new RegExp(`^arms/[^/]+/${k[1]}_upper$`).test(s));
  }
  return out;
}

export function checkPair(rig, pair, precise) {
  const P = rig.pieces[pair.parent],
    C = rig.pieces[pair.child];
  const pb = worldBox(P),
    cb = worldBox(C);
  if (pb.isEmpty() || cb.isEmpty()) return { ...pair, gap: 0, overlap: 0 };
  let gap = boxGap(pb, cb),
    overlap = pair.weapon ? 0 : boxOverlap(pb, cb);
  if (precise) {
    const verts = worldVerts(C, MAX_VERTS);
    const ptris = worldTris(P, MAX_TRIS);
    // 重疊：從頂點往固定方向打一條射線，穿過父區塊三角面的次數為奇數＝在實體裡（外框不相交就不用算）
    let inside = 0;
    if (pb.intersectsBox(cb)) {
      const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0.83, 0.47, 0.31).normalize());
      const hit = new THREE.Vector3();
      for (const v of verts) {
        if (!pb.containsPoint(v)) continue;
        ray.origin.copy(v);
        let n = 0;
        for (const t of ptris) if (ray.intersectTriangle(t.a, t.b, t.c, false, hit)) n++;
        if (n % 2) inside++;
      }
    }
    if (!pair.weapon) overlap = verts.length ? inside / verts.length : 0;
    // 縫隙：有頂點嵌進去就算接上；否則取雙向「頂點到三角面」的最短距離（外框已經分開很遠就不用細算）
    if (inside) gap = 0;
    else if (gap < 0.3) {
      const q = new THREE.Vector3();
      let best = Infinity;
      const near = (vs, tris) => {
        for (const v of vs) {
          for (const t of tris) {
            t.closestPointToPoint(v, q);
            const dd = q.distanceToSquared(v);
            if (dd < best) best = dd;
          }
          if (best < 1e-6) return;
        }
      };
      near(verts, ptris);
      if (best > 1e-6) near(worldVerts(P, MAX_VERTS), worldTris(C, MAX_TRIS));
      gap = Number.isFinite(best) ? Math.sqrt(best) : gap;
    }
  }
  return { ...pair, gap, overlap };
}

// 檢查整台機甲，回傳每一對的結果與需要提示的項目
export function checkRig(rig, precise) {
  rig.group.updateMatrixWorld(true); // 姿勢剛改變、還沒繪製時矩陣是舊的
  const all = piecePairs(rig).map((p) => {
    const r = checkPair(rig, p, precise);
    for (const o of p.also || [])
      if (r.gap > GAP_WARN) r.gap = Math.min(r.gap, checkPair(rig, { ...p, parent: o }, precise).gap);
    return r;
  });
  const warns = all.filter((r) => r.gap > GAP_WARN || r.overlap > OVERLAP_WARN);
  return { all, warns, precise };
}
