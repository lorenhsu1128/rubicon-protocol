// 關節設定：覆寫區塊連接點（例如手肘在上臂的哪裡）的位置與旋轉。
// - 內建：src/assets/models/joints.json（建置時內嵌，遊戲與模型庫都讀）
// - 模型庫另外可以用瀏覽器暫存覆寫（setJointOverrides），只影響模型庫
// 檔案格式採 glTF 座標（與 GLB、模型庫顯示一致：Y 朝上、+Z 為正面、單位公尺、旋轉為角度，XYZ 順序）：
//   { "arms/a_std/r_upper": { "elbow": { "p": [x, y, z], "r": [rx, ry, rz] } }, ... }
// 遊戲內部座標的正面是 −Z（兩者差繞 Y 軸 180°）：位置的 x、z 取負，旋轉的 x、z 取負
import BUILTIN_JOINTS from 'virtual:joints';

let overrides = {};
export const builtinJoints = () => BUILTIN_JOINTS;
export function setJointOverrides(map) {
  overrides = map || {};
}
// 某個連接點的設定（glTF 座標），沒有則為 null；瀏覽器暫存＞內建
export function jointSetting(slot, name) {
  return (
    (overrides[slot] && overrides[slot][name]) || (BUILTIN_JOINTS[slot] && BUILTIN_JOINTS[slot][name]) || null
  );
}

const D2R = Math.PI / 180;
const num = (v) => (Number.isFinite(+v) ? +v : 0);
export function gltfToGame(j) {
  const p = j.p || [0, 0, 0],
    r = j.r || [0, 0, 0];
  return {
    p: new THREE.Vector3(-num(p[0]), num(p[1]), -num(p[2])),
    r: new THREE.Euler(-num(r[0]) * D2R, num(r[1]) * D2R, -num(r[2]) * D2R),
  };
}
const round = (v, k) => Math.round(v * k) / k;
export function gameToGltf(p, r) {
  return {
    p: [round(-p.x, 1000), round(p.y, 1000), round(-p.z, 1000)].map((v) => v + 0),
    r: [round(-r.x / D2R, 100), round(r.y / D2R, 100), round(-r.z / D2R, 100)].map((v) => v + 0),
  };
}
// 連接點（遊戲座標）：有設定就用設定，否則用預設值 def（{ p: Vector3, r: Euler }）
export function resolveConn(slot, name, def) {
  const j = jointSetting(slot, name);
  if (j) return gltfToGame(j);
  return def ? { p: def.p.clone(), r: def.r.clone() } : { p: new THREE.Vector3(), r: new THREE.Euler() };
}
