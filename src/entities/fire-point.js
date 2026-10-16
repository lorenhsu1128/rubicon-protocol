// ---------- 發射點：敵人招式的視線檢查與實際發射用同一個點（不是 mixin，純函式）----------
// 視線檢查若用機體中心或「現在」的砲口（還沒轉過去、還沒架好、俯仰架還沒對準），和實際發射的位置差了幾十公分到 1 m 以上，
// 會出現「判定看得到、開火卻打在掩體上」或「一開始就被擋住而中斷」。做法（沙脊狙擊機 snipeMz_b1 的通用版）：
// - measureLocal：把模型擺成發射時的姿勢量砲口節點在機體網格座標裡的位置（量完還原），模型固定的由呼叫端快取
// - firePoint：機體在 pos（腳底）面向 aim 時，該點的世界座標（機身朝向和 setAim 相同：由機體位置指向目標）
// - losTol：開始攻擊前的檢查加容差：發射點本身與往上、左右各偏一點都要看得到（只擦過掩體邊緣的不算）
// - rayClear：投射物（網、迴旋刃、鉤頭）與光束的視線：game.losClear 從 2 m 起每 1 m 取樣（給機體中心用），
//   砲口貼著貨櫃、薄牆夾在兩個取樣點之間時判定看得到、投射物卻一出膛就撞上，所以從砲口起每 0.5 m 取樣
// 只在房主／單機呼叫（行為判定），不影響同步。
import { PROP_PAD } from '../world/prop-hit.js';

const UP = new THREE.Vector3(0, 1, 0);
export const TOL_UP = 0.3,
  TOL_SIDE = 0.35;

// node 在 ent.mesh 座標裡的位置：上半身的旋轉（載具砲塔的轉向、移動時的前傾、硬直的搖晃）先歸零，
// pose(model) 再擺成發射姿勢並回傳還原用的函式
export function measureLocal(ent, node, pose) {
  const m = ent.model,
    mesh = ent.mesh,
    tr = m.torso.rotation;
  const rx = tr.x,
    ry = tr.y,
    rz = tr.z;
  tr.set(0, 0, 0);
  const undo = pose ? pose(m) : null;
  mesh.updateMatrixWorld(true);
  const v = mesh.worldToLocal(node.getWorldPosition(new THREE.Vector3()));
  if (undo) undo();
  tr.set(rx, ry, rz);
  mesh.updateMatrixWorld(true);
  return v;
}
// 網格座標的 off 在機體位於 pos、面向 aim 時的世界座標
export function firePoint(ent, off, pos, aim) {
  const yaw = Math.atan2(-(aim.x - pos.x), -(aim.z - pos.z));
  return off.clone().multiply(ent.mesh.scale).applyAxisAngle(UP, yaw).add(pos);
}
// a → b 沒有被地形／障礙物擋住（world.hitsWorld）：從 a 起每 step 取樣到 b 前 1.5 m（目標腳邊的地面不算）
export function rayClear(world, a, b, step = 0.5) {
  const d = a.distanceTo(b);
  if (d < 1e-3) return true;
  const dir = b.clone().sub(a).divideScalar(d);
  const p = new THREE.Vector3();
  for (let t = 0; t < d - 1.5; t += step)
    if (world.hitsWorld(p.copy(a).addScaledVector(dir, t))) return false;
  // 可破壞物件以線段判定，和投射物、光束相同的命中形狀與加寬（world/prop-hit.js）
  if (d > 1.5 && world.propBlocks(a, p.copy(a).addScaledVector(dir, d - 1.5), PROP_PAD)) return false;
  return true;
}
// a → b 的視線：a 本身與往上 up、左右各 side 偏移的點都通過 clear(p, b)
export function losTol(clear, a, b, up = TOL_UP, side = TOL_SIDE) {
  const s = new THREE.Vector3(b.z - a.z, 0, a.x - b.x);
  if (s.lengthSq() > 1e-6) s.setLength(side);
  const pts = [a, a.clone().add(s), a.clone().sub(s), a.clone().setY(a.y + up)];
  return pts.every((p) => clear(p, b));
}
