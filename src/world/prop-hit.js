// ---------- 可破壞地圖物件的命中形狀（純函式，不是 mixin）----------
// 以前子彈、光束、爆炸、近戰對物件用外接球（半徑 3～7 m），子彈從物件旁邊幾公尺經過也會被擋下，
// 和 hitsWorld（障礙物的方塊／圓柱）不一致：AI 判定看得到、射出去卻打在空氣裡的物件上。
// 現在物件的命中形狀＝它的碰撞障礙物（world.obstacles 裡的那一個）：
// - 方塊：軸對齊的方塊（x±w/2、z±d/2、y～top）
// - 圓柱：垂直圓柱（半徑 r，粗的乘 0.9 和 hitsWorld 相同）；有網格外框（ob.box）時再和外框取交集（卡車、岩石這類
//   斜放的物件，圓柱比實際大），高度也取外框的
// 先用外框的外接球粗篩，再做精確判定。world.hitsWorld 對物件也用同一個形狀（shapeContains），
// 所以點取樣的視線（rayClear／losClear）和投射物的判定一致；投射物另外以線段判定（shapeSegT），不會穿過細的柱子。
export const PROP_PAD = 0.15; // 投射物、光束對物件的判定加寬（公尺）：只擦過邊緣的也算打中，但不會隔空命中

export function propShape(w, ob) {
  // 欄位一律齊全（同一種物件形狀，判定迴圈不會變慢）：b＝方塊；x0～z1＝水平外框（圓柱是圓的外框，或和網格外框的交集）
  let b, x, z, r, x0, x1, z0, z1, y0, y1;
  if (ob.kind === 'box') {
    b = true;
    x = ob.x;
    z = ob.z;
    r = 0;
    x0 = ob.x - ob.w / 2;
    x1 = ob.x + ob.w / 2;
    z0 = ob.z - ob.d / 2;
    z1 = ob.z + ob.d / 2;
    y0 = ob.y !== undefined ? ob.y : ob.box ? ob.box.min.y : w.terrainHeight(ob.x, ob.z) - 0.5;
    y1 = ob.top !== undefined ? ob.top : ob.box ? ob.box.max.y : y0 + (ob.h || 3);
  } else {
    b = false;
    x = ob.x;
    z = ob.z;
    r = ob.r > 1 ? ob.r * 0.9 : ob.r;
    const bx = ob.box && !ob.box.isEmpty() ? ob.box : null;
    const g = w.terrainHeight(ob.x, ob.z);
    y0 = bx ? bx.min.y : g - 0.5;
    y1 = ob.top !== undefined ? ob.top : bx ? bx.max.y : g + (ob.h || ob.r * 2);
    x0 = x - r;
    x1 = x + r;
    z0 = z - r;
    z1 = z + r;
    // 和網格外框取交集（只取水平範圍；沒有交集時不應該發生，只用圓柱）
    if (bx) {
      const a0 = Math.max(bx.min.x, x0),
        a1 = Math.min(bx.max.x, x1),
        c0 = Math.max(bx.min.z, z0),
        c1 = Math.min(bx.max.z, z1);
      if (a0 < a1 && c0 < c1) [x0, x1, z0, z1] = [a0, a1, c0, c1];
    }
  }
  // 粗篩用的外接球（外框的）
  const cx = (x0 + x1) / 2,
    cy = (y0 + y1) / 2,
    cz = (z0 + z1) / 2;
  const R = Math.hypot((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2);
  return { b, x, z, r, x0, x1, z0, z1, y0, y1, cx, cy, cz, R };
}

// 一個軸的 slab：回傳更新後的 [t0, t1]（沒有交集時 t0 > t1）
function slab(p, v, lo, hi, iv) {
  if (Math.abs(v) < 1e-9) {
    if (p < lo || p > hi) iv[0] = 2;
    return;
  }
  let ta = (lo - p) / v,
    tb = (hi - p) / v;
  if (ta > tb) [ta, tb] = [tb, ta];
  if (ta > iv[0]) iv[0] = ta;
  if (tb < iv[1]) iv[1] = tb;
}
const IV = [0, 1];

// 線段 a → a+v（t∈[0,1]）第一次進入（加寬 pad 的）形狀的 t；沒有碰到時 -1。a 在形狀裡面時 0。
export function shapeSegT(sh, a, v, pad = 0) {
  // 粗篩：線段到外接球中心的最近距離
  const L2 = v.x * v.x + v.y * v.y + v.z * v.z;
  const fx = sh.cx - a.x,
    fy = sh.cy - a.y,
    fz = sh.cz - a.z;
  const tc = L2 > 1e-9 ? Math.min(1, Math.max(0, (fx * v.x + fy * v.y + fz * v.z) / L2)) : 0;
  const ex = fx - v.x * tc,
    ey = fy - v.y * tc,
    ez = fz - v.z * tc;
  const RR = sh.R + pad;
  if (ex * ex + ey * ey + ez * ez > RR * RR) return -1;
  const iv = IV;
  iv[0] = 0;
  iv[1] = 1;
  slab(a.y, v.y, sh.y0 - pad, sh.y1 + pad, iv);
  if (iv[0] > iv[1]) return -1;
  slab(a.x, v.x, sh.x0 - pad, sh.x1 + pad, iv);
  if (iv[0] > iv[1]) return -1;
  slab(a.z, v.z, sh.z0 - pad, sh.z1 + pad, iv);
  if (iv[0] > iv[1]) return -1;
  if (!sh.b) {
    // 垂直圓柱（水平面上的圓）
    const R = sh.r + pad;
    const dx = v.x,
      dz = v.z,
      px = a.x - sh.x,
      pz = a.z - sh.z;
    const A = dx * dx + dz * dz,
      C = px * px + pz * pz - R * R;
    if (A < 1e-9) {
      if (C > 0) return -1;
    } else {
      const B = 2 * (px * dx + pz * dz);
      const disc = B * B - 4 * A * C;
      if (disc < 0) return -1;
      const s = Math.sqrt(disc);
      const ta = (-B - s) / (2 * A),
        tb = (-B + s) / (2 * A);
      if (ta > iv[0]) iv[0] = ta;
      if (tb < iv[1]) iv[1] = tb;
      if (iv[0] > iv[1]) return -1;
    }
  }
  return iv[0];
}

// 點 p 在形狀裡面（hitsWorld 用，不加寬）
export function shapeContains(sh, p) {
  if (p.x < sh.x0 || p.x > sh.x1 || p.z < sh.z0 || p.z > sh.z1 || p.y < sh.y0 || p.y > sh.y1) return false;
  if (sh.b) return true;
  const dx = p.x - sh.x,
    dz = p.z - sh.z;
  return dx * dx + dz * dz < sh.r * sh.r;
}

// 形狀上離 p 最近的點（out）；p 在裡面時就是 p
export function shapeClosest(sh, p, out) {
  out.copy(p);
  out.y = Math.min(sh.y1, Math.max(sh.y0, p.y));
  if (!sh.b) {
    const dx = p.x - sh.x,
      dz = p.z - sh.z,
      d = Math.hypot(dx, dz);
    if (d > sh.r) {
      out.x = sh.x + (dx / d) * sh.r;
      out.z = sh.z + (dz / d) * sh.r;
    }
  }
  out.x = Math.min(sh.x1, Math.max(sh.x0, out.x));
  out.z = Math.min(sh.z1, Math.max(sh.z0, out.z));
  return out;
}

// ---------- 對任何目標（機體、載具、投射物的代理目標、物件）的判定 ----------
// 物件（有 shape）用形狀，其他照原本的球（center()＋radius）。
const _c = new THREE.Vector3();

// 線段 a → a+v 碰到目標的 t（-1＝沒碰到）；pad：球的加寬（radius＋pad），物件用 propPad
// 球的 t 是線段上離球心最近的點（和原本的判定相同）
export function targetSegT(t, a, v, pad, propPad = PROP_PAD) {
  if (t.shape) return shapeSegT(t.shape, a, v, propPad);
  const c = t.center();
  const L2 = v.lengthSq();
  const tt =
    L2 > 1e-9
      ? Math.min(1, Math.max(0, ((c.x - a.x) * v.x + (c.y - a.y) * v.y + (c.z - a.z) * v.z) / L2))
      : 0;
  _c.copy(a).addScaledVector(v, tt);
  const r = t.radius + pad;
  return _c.distanceToSquared(c) < r * r ? tt : -1;
}

// 點 p 到目標表面的距離（爆炸、近戰）：物件＝到形狀的距離，其他＝到球心的距離減半徑
export function targetDist(t, p) {
  if (t.shape) return shapeClosest(t.shape, p, _c).distanceTo(p);
  return t.center().distanceTo(p) - t.radius;
}

// 目標上離 p 最近的點（命中特效、近戰的方向）：物件＝形狀上的點，其他＝球心
export function targetNear(t, p, out = new THREE.Vector3()) {
  if (t.shape) return shapeClosest(t.shape, p, out);
  return out.copy(t.center());
}
