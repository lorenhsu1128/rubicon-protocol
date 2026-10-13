// 自訂關卡套到 World：底圖參數（World 的 opt）、擺放的物件（網格＋碰撞＋可破壞）、坡道與橋面板。
// 房主、客機、編輯器都用同一套，所以地圖一致（依陣列順序建立、不用亂數）。
import { decodeHeights } from './format.js';
import { buildPlaced, ownMats, placeById } from './placeables.js';

// World 的 opt（new World(scene, theme, seed, level, null, opt)）
export function levelWorldOpt(L) {
  const B = L.base;
  const n = L.terrain && L.terrain.n;
  return {
    variant: B.blank ? '' : B.variant || '',
    tod: B.tod || '',
    weather: B.weather || '',
    zone: B.zone || 'full',
    level: {
      blank: !!B.blank,
      props: B.props,
      h: n ? decodeHeights(L.terrain.h, n) : null,
      water: L.terrain ? L.terrain.water : null,
      removed: L.removed || [],
    },
  };
}
const QDIR = [
  [1, 0],
  [0, -1],
  [-1, 0],
  [0, 1],
];
export const quarter = (yaw) => ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
// 擺放的物件實際的底面高度
export function propBaseY(w, p) {
  return p.g ? w.terrainHeight(p.x, p.z) + p.y : p.y;
}
// 建立一個物件並登記碰撞；回傳紀錄（編輯器移動時用 removePlaced 拿掉再重建）
export function placeProp(w, p, idx) {
  const def = placeById(p.t);
  if (!def) return null;
  const T = w.theme;
  const { group, bounds: b, ramp, deck } = buildPlaced(def, p, T);
  const y = propBaseY(w, p);
  let yaw = p.yaw || 0;
  if (ramp) yaw = (quarter(yaw) * Math.PI) / 2; // 坡道只能 90° 一格（坡面判定是軸對齊的）
  group.position.set(p.x, y, p.z);
  group.rotation.y = yaw;
  w.scene.add(group);
  w.meshes.push(group);
  const rec = { p, idx, group, obs: [], ramp: null, tag: p.tag || '' };
  const mats = ownMats(group);
  if (ramp) {
    const q = quarter(yaw);
    const hi = QDIR[q];
    const side = [-hi[0], -hi[1]];
    const r = {
      x: p.x,
      z: p.z,
      w: side[0] ? ramp.len : ramp.wid,
      d: side[1] ? ramp.len : ramp.wid,
      side,
      y0: y,
      y1: y + ramp.rise,
      len: ramp.len,
      lift: y > w.terrainHeight(p.x, p.z) + 0.6,
      lvl: true,
    };
    (w.ramps || (w.ramps = [])).push(r);
    rec.ramp = r;
    return rec;
  }
  if (p.col === 'none') return rec;
  // 外框轉到世界座標（斜放時用轉過之後的外框，會比實際大）
  const c = Math.cos(yaw),
    s = Math.sin(yaw);
  let x0 = 1e9,
    x1 = -1e9,
    z0 = 1e9,
    z1 = -1e9;
  for (const lx of [b.min.x, b.max.x])
    for (const lz of [b.min.z, b.max.z]) {
      const wx = lx * c + lz * s,
        wz = -lx * s + lz * c;
      x0 = Math.min(x0, wx);
      x1 = Math.max(x1, wx);
      z0 = Math.min(z0, wz);
      z1 = Math.max(z1, wz);
    }
  let ob;
  if (p.col === 'circle') {
    const r = Math.max(0.3, ((x1 - x0) / 2 + (z1 - z0) / 2) / 2);
    ob = {
      kind: 'circle',
      x: p.x + (x0 + x1) / 2,
      z: p.z + (z0 + z1) / 2,
      r,
      group,
      mats,
      h: b.max.y - b.min.y,
      box: new THREE.Box3(
        new THREE.Vector3(p.x + x0, y + b.min.y, p.z + z0),
        new THREE.Vector3(p.x + x1, y + b.max.y, p.z + z1),
      ),
    };
  } else {
    ob = {
      kind: 'box',
      x: p.x + (x0 + x1) / 2,
      z: p.z + (z0 + z1) / 2,
      w: Math.max(0.3, x1 - x0),
      d: Math.max(0.3, z1 - z0),
      top: y + b.max.y,
      y: y + b.min.y,
      group,
      mats,
      deck,
      box: new THREE.Box3(
        new THREE.Vector3(p.x + x0, y + b.min.y, p.z + z0),
        new THREE.Vector3(p.x + x1, y + b.max.y, p.z + z1),
      ),
    };
  }
  w.obstacles.push(ob);
  if (mats.length) w.occluders.push(ob);
  rec.obs.push(ob);
  if (p.hp > 0) {
    const pr = w.regProp(def.id, ob, p.hp, 0x8a8f96);
    pr.name = def.name;
    pr.lvTag = p.tag || '';
  }
  return rec;
}
export function removePlaced(w, rec) {
  if (!rec) return;
  w.scene.remove(rec.group);
  const i = w.meshes.indexOf(rec.group);
  if (i >= 0) w.meshes.splice(i, 1);
  for (const ob of rec.obs) {
    const a = w.obstacles.indexOf(ob);
    if (a >= 0) w.obstacles.splice(a, 1);
    const b = w.occluders.indexOf(ob);
    if (b >= 0) w.occluders.splice(b, 1);
    if (ob.prop) ob.prop.dead = true;
  }
  if (rec.ramp && w.ramps) {
    const r = w.ramps.indexOf(rec.ramp);
    if (r >= 0) w.ramps.splice(r, 1);
  }
  rec.group.traverse((o) => {
    if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
  });
}
// 依標籤隱藏／顯示（觸發器的「移除物件（開門）」）；隱藏時碰撞一起拿掉
export function setPlacedVisible(w, rec, on) {
  rec.group.visible = on;
  rec.hidden = !on;
  for (const ob of rec.obs) {
    const a = w.obstacles.indexOf(ob);
    if (on && a < 0 && !(ob.prop && ob.prop.dead && ob.prop.hp <= 0)) w.obstacles.push(ob);
    if (!on && a >= 0) w.obstacles.splice(a, 1);
  }
  if (rec.ramp && w.ramps) {
    const r = w.ramps.indexOf(rec.ramp);
    if (on && r < 0) w.ramps.push(rec.ramp);
    if (!on && r >= 0) w.ramps.splice(r, 1);
  }
}
export function applyLevelProps(w, L) {
  w.lvProps = (L.props || []).map((p, i) => placeProp(w, p, i));
  return w.lvProps;
}
