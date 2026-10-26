// 機甲的 IK（反向運動學）：疊在 animateMech 的動作（FK）之後的修正層——腳踩地形、身體隨坡度、腳步鎖定、
// 四足腳與履帶貼地、頭看目標、手臂與肩上武器瞄準、空手扶槍、近戰對準高度。
// 每格在 animateMech 之前以 ikRestore 把關節還原成動作層的結果，animateMech 的平滑（lerp）不會吃到 IK 的修正。
// 只在遊戲中（MechEntity）使用；模型庫、車庫、組裝調整不套用（存檔一律是拉直靜止姿勢）。
// 骨頭長度一律在執行時從關節群組的世界座標量（連接點可被關節設定與 GLB 原點改變）。
// 手臂瞄準與壓低骨盆會移動手的位置，也就是子彈發射點（MechEntity.muzzle）；多人只在房主計算子彈，各端不必一致。
// 開關存在 localStorage rubicon_ik（渲染風格實驗室的「動作 IK」面板）。
import { clamp, lerp } from '../core/math.js';
import { OUTLINE_MAT } from './geometry.js';

const KEY = 'rubicon_ik';
// [鍵, 名稱, 說明]
export const IK_ITEMS = [
  ['feet', '腳部貼地', '二足／逆關節的腳踩在斜坡、坡道與台階上，高低差大時壓低骨盆'],
  ['tilt', '機體隨地形傾斜', '依腳下坡度讓下半身與上身微傾（二足、逆關節、四足）'],
  ['stride', '步伐依移動距離', '步頻跟著實際速度（步幅依腳長），減少滑步'],
  ['lock', '腳步鎖定', '慢速走動時支撐腳固定在地面上，快速移動時自動放開'],
  ['quad', '四足腳貼地', '四隻腳各自踩在地面上'],
  ['tank', '履帶貼合地形', '履帶車身依坡度俯仰與側傾'],
  ['knock', '失衡時腳貼地', '失衡、倒地時腳留在地面上'],
  ['head', '頭部注視', '頭轉向瞄準目標（有角度上限）'],
  ['arms', '手臂瞄準', '持槍的手把槍管對準目標（子彈發射點會跟著手移動）'],
  ['back', '肩上武器指向', '肩上武器轉向目標（有角度上限）'],
  ['support', '空手扶槍', '一隻手沒有武器時扶著另一隻手的槍'],
  ['melee', '近戰對準高度', '近戰時上身俯仰對準目標'],
];
export const IK = { on: true };
for (const [k] of IK_ITEMS) IK[k] = true;
try {
  const o = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (o && typeof o === 'object') for (const k in IK) if (typeof o[k] === 'boolean') IK[k] = o[k];
} catch (e) {}
export function setIK(k, v) {
  if (!(k in IK)) return;
  IK[k] = !!v;
  try {
    localStorage.setItem(KEY, JSON.stringify(IK));
  } catch (e) {}
}
export const ikOn = (k) => IK.on && !!IK[k];

const V3 = () => new THREE.Vector3();
const _a = V3(),
  _b = V3(),
  _c = V3(),
  _t = V3(),
  _u = V3(),
  _w = V3(),
  _n = V3(),
  _x = V3(),
  _p = V3(),
  _s = V3(),
  _d = V3(),
  _g = V3();
const _q = new THREE.Quaternion(),
  _q2 = new THREE.Quaternion(),
  _qw = new THREE.Quaternion(),
  _qp = new THREE.Quaternion(),
  _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const AX = new THREE.Vector3(1, 0, 0),
  AZ = new THREE.Vector3(0, 0, 1),
  UP = new THREE.Vector3(0, 1, 0),
  FWD = new THREE.Vector3(0, 0, -1);

// 世界座標（呼叫前 matrixWorld 必須是最新的：開頭整台更新一次，之後每次修改都更新該節點的子樹）
const wpos = (o, out) => out.setFromMatrixPosition(o.matrixWorld);
const wquat = (o, out) => (o.matrixWorld.decompose(_p, out, _s), out);
// 只更新骨架的世界矩陣：略過沒有子節點的網格（IK 只讀關節群組；網格在算繪時由 scene.updateMatrixWorld 更新，
// 讀網格 matrixWorld 的地方都會自己先更新）。整台 updateMatrixWorld(true) 是 IK 最大的開銷
let _keep = null; // 這一台 IK 會讀的節點（rig.ik.keep；就算是網格也要更新）
function upd(o) {
  if (o.matrixAutoUpdate) o.updateMatrix();
  if (o.parent) o.matrixWorld.multiplyMatrices(o.parent.matrixWorld, o.matrix);
  else o.matrixWorld.copy(o.matrix);
  o.matrixWorldNeedsUpdate = false;
  const ch = o.children;
  for (let i = 0; i < ch.length; i++) {
    const c = ch[i];
    if (c.children.length || !(c.isMesh || c.isLine || c.isPoints || c.isSprite) || (_keep && _keep.has(c)))
      upd(c);
  }
}
// 距離分級（MechEntity.ikCtx 的 off：離鏡頭遠或在畫面外）：所有項目當作關閉，權重淡出到 0 後整個略過
let _off = false;
const on = (k) => !_off && ikOn(k);
// 在世界座標套一個旋轉 q（以節點自己的原點為中心）
function rotWorld(o, q) {
  wquat(o, _qw).premultiply(q);
  wquat(o.parent, _qp).invert();
  o.quaternion.copy(_qp.multiply(_qw));
  upd(o);
}
function rotLocal(o, axis, ang) {
  o.quaternion.multiply(_q2.setFromAxisAngle(axis, ang));
  upd(o);
}
// q 從單位四元數插值到 q 的 w 倍（w=1 時原樣），另外限制最大角度
function partial(q, w, maxAng) {
  const ang = 2 * Math.acos(clamp(Math.abs(q.w), 0, 1));
  const f = ang > 1e-6 ? Math.min(w, maxAng / ang) : w;
  q.slerp(_qi.identity(), 1 - f);
  return q;
}
// 從 from（世界）轉到 to（世界）的最小旋轉，乘上權重與角度上限
function aimQuat(from, to, w, maxAng) {
  _q.setFromUnitVectors(from, to);
  return partial(_q, w, maxAng);
}

// 兩段骨頭：a（球關節）→ b（鉸鏈，區域軸 hinge）→ 末端（end(out) 回傳世界座標），讓末端到 T（世界）。
// 先只轉鉸鏈讓距離對上（膝、手肘維持單軸），再整段繞 a 轉向 T。伸不到時盡量伸直
function twoBone(a, b, end, T, hinge, bendSign) {
  const A = wpos(a, _a),
    B = wpos(b, _b),
    C = end(_c);
  const lab = A.distanceTo(B),
    lcb = B.distanceTo(C);
  if (lab < 1e-4 || lcb < 1e-4) return;
  const lat = clamp(A.distanceTo(T), Math.abs(lab - lcb) + 1e-3, lab + lcb - 1e-3);
  const ba = _u.subVectors(A, B).normalize(),
    bc = _w.subVectors(C, B).normalize();
  const ang0 = Math.acos(clamp(ba.dot(bc), -1, 1));
  const ang1 = Math.acos(clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1));
  // bc 繞 n＝bc×ba 正轉會靠近 ba（夾角變小）；換算成鉸鏈區域軸的方向（伸直時用預設的彎曲方向）
  _n.crossVectors(bc, ba);
  const hx = _x.copy(hinge).applyQuaternion(wquat(b, _q));
  const s = _n.lengthSq() > 1e-8 ? Math.sign(_n.dot(hx)) || bendSign : bendSign;
  rotLocal(b, hinge, s * (ang0 - ang1));
  const C2 = end(_c);
  _u.subVectors(C2, A).normalize();
  _w.subVectors(T, A).normalize();
  rotWorld(a, _q.setFromUnitVectors(_u, _w));
}

// 節點區域座標裡最低（−Y）的頂點：腳掌底（二足）、四足小腿的腳尖
function lowestLocal(node) {
  node.updateMatrixWorld(true);
  const inv = _m.copy(node.matrixWorld).invert();
  const m = new THREE.Matrix4(),
    v = V3(),
    best = V3(0, 0, 0);
  let min = Infinity;
  node.traverse((o) => {
    if (!o.isMesh || o.material === OUTLINE_MAT || !o.geometry.attributes.position) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      if (v.y < min) {
        min = v.y;
        best.copy(v);
      }
    }
  });
  return Number.isFinite(min) ? best : null;
}

// 腳掌深度、四足腳尖（量網格）：遊戲實體在合併網格之前先量好存在 rig.ikMeas（render/mesh-merge.js 會把網格
// 移到模型的根，之後就量不到各關節底下的網格）
export function ikMeasure(rig) {
  const quad = rig.type === 'quad';
  rig.ikMeas = (rig.legs || []).map((L) => {
    // 二足：腳踝（foot 關節）到腳底的距離；四足：膝關節區域座標的腳尖
    let sole = 0.3,
      tip = null;
    if (quad) tip = lowestLocal(L.knee) || V3(0, -0.9, 0);
    else {
      const lo = lowestLocal(L.foot);
      if (lo) sole = Math.max(0.05, -lo.y);
    }
    return { sole, tip };
  });
  return rig.ikMeas;
}

// 第一次套用時建立狀態：要還原的關節、腳掌深度、四足腳尖
function initIK(rig) {
  const joints = [];
  for (const L of rig.legs) joints.push(L.thigh, L.knee, ...(L.hock ? [L.hock] : []), L.foot);
  joints.push(rig.torso);
  if (rig.head) joints.push(rig.head);
  for (const k of ['l', 'r']) {
    const a = rig.arms[k];
    joints.push(a.up, a.fore, a.back);
  }
  const uniq = [...new Set(joints)];
  const keep = new Set([...uniq, rig.group, rig.lift]);
  for (const L of rig.legs) {
    keep.add(L.thigh).add(L.knee).add(L.foot);
    if (L.hock) keep.add(L.hock);
  }
  for (const k of ['l', 'r']) {
    const a = rig.arms[k];
    for (const o of [a.up, a.fore, a.back, a.weapon, a.hand]) if (o) keep.add(o);
  }
  const meas = rig.ikMeas || ikMeasure(rig);
  const legs = meas.map((m) => ({ sole: m.sole, tip: m.tip && m.tip.clone(), dy: 0, lockP: null, lockW: 0 }));
  rig.ik = {
    joints: uniq,
    keep,
    fk: new Float32Array(uniq.length * 3),
    saved: false,
    liftY: 0,
    legs,
    w: { feet: 0, tilt: 0, head: 0, melee: 0, back: 0, arm: { l: 0, r: 0 }, sup: { l: 0, r: 0 } },
    drop: 0,
    tiltQ: new THREE.Quaternion(),
  };
}

// 每格 animateMech 之前呼叫：把 IK 改過的關節還原成動作層的結果
export function ikRestore(rig) {
  const S = rig.ik;
  if (!S || !S.saved) return;
  S.joints.forEach((o, i) => o.rotation.set(S.fk[i * 3], S.fk[i * 3 + 1], S.fk[i * 3 + 2]));
  rig.lift.position.y = S.liftY;
  rig.lift.quaternion.identity();
  S.saved = false;
}

// 地面高度與法線（差分）
function groundH(world, x, z, y) {
  return world.groundAt(x, z, y);
}
function groundN(world, x, z, y, e, out) {
  const hx0 = groundH(world, x - e, z, y),
    hx1 = groundH(world, x + e, z, y),
    hz0 = groundH(world, x, z - e, y),
    hz1 = groundH(world, x, z + e, y);
  return out.set(hx0 - hx1, 2 * e, hz0 - hz1).normalize();
}
const smooth = (cur, to, dt, rate) => lerp(cur, to, Math.min(1, dt * rate));

// ctx（MechEntity.ikCtx）：dt、world、pos（腳下地面的機體位置）、scale、grounded、moving、boost、knock、
// melee、meleePt、aim（瞄準點，世界）、armAim（手臂與肩上武器瞄準的點，沒有時＝aim）、guns {l,r}（'gun'／'melee'／'none'）、backs {l,r}、recoil、gait、lockOK、glide、near
export function applyIK(rig, ctx) {
  if (!rig || rig.vehicle || !rig.lift) return;
  if (!rig.ik) initIK(rig);
  const S = rig.ik,
    W = S.w,
    dt = ctx.dt;
  _off = !!ctx.off;
  _keep = S.keep;
  if (_off) {
    // 距離分級：權重都淡出到 0 之後不再計算（ikRestore 已經把關節還原成動作層，不留下殘留姿勢）
    const lo = 0.002;
    if (
      W.feet <= lo &&
      W.tilt <= lo &&
      W.head <= lo &&
      W.melee <= lo &&
      W.back <= lo &&
      W.arm.l <= lo &&
      W.arm.r <= lo &&
      W.sup.l <= lo &&
      W.sup.r <= lo
    ) {
      W.feet = W.tilt = W.head = W.melee = W.back = W.arm.l = W.arm.r = W.sup.l = W.sup.r = 0;
      S.drop = 0;
      S.tiltQ.identity();
      for (const st of S.legs) {
        st.lockP = null;
        st.lockW = 0;
        st.dy = 0;
      }
      return;
    }
  }
  // 記下動作層的結果（下一格開頭還原）
  S.joints.forEach((o, i) => {
    S.fk[i * 3] = o.rotation.x;
    S.fk[i * 3 + 1] = o.rotation.y;
    S.fk[i * 3 + 2] = o.rotation.z;
  });
  S.liftY = rig.lift.position.y;
  S.saved = true;
  upd(rig.group);
  const sc = ctx.scale || 1;
  const type = rig.type;
  const legged = type === 'biped' || type === 'reverse';
  // ===== 下半身：腳貼地、身體傾斜、腳步鎖定、四足、履帶 =====
  const legFeat = legged ? 'feet' : type === 'quad' ? 'quad' : null;
  const groundOK = ctx.grounded && ctx.near;
  const feetOn = legFeat && on(legFeat) && groundOK && (!ctx.knock || on('knock'));
  W.feet = smooth(W.feet, feetOn ? 1 : 0, dt, 8);
  const tiltOn = on(type === 'tank' ? 'tank' : 'tilt') && groundOK && !ctx.knock;
  W.tilt = smooth(W.tilt, tiltOn ? 1 : 0, dt, 6);
  if (W.feet > 0.002 || W.tilt > 0.002) lowerBody(rig, ctx, sc);
  // ===== 上半身 =====
  if (ctx.aim) upperBody(rig, ctx, sc);
}

function lowerBody(rig, ctx, sc) {
  // sc：實體的倍率（下面寫死的數字照舊尺度）；rs：模型根節點的倍率（量出來的區域座標換成世界座標用）
  const rs = rig.group.scale.x || 1;
  const S = rig.ik,
    W = S.w,
    dt = ctx.dt,
    world = ctx.world,
    pos = ctx.pos;
  const qy = pos.y + 0.8 * sc; // 腳能踩上去的台階高度（groundAt 只算頂面在這附近以下的箱子）
  const legged = rig.type === 'biped' || rig.type === 'reverse';
  const quad = rig.type === 'quad';
  // 1. 動作層的腳踝（四足：腳尖）位置與腳下地面
  const targets = [];
  if (legged || quad) {
    const lockOn = legged && on('lock') && ctx.lockOK && ctx.moving && !ctx.knock && !ctx.glide;
    rig.legs.forEach((L, i) => {
      const st = S.legs[i];
      const C = quad ? _t.copy(st.tip).applyMatrix4(L.knee.matrixWorld) : wpos(L.foot, _t);
      const gy = groundH(world, C.x, C.z, qy);
      let dy = gy - pos.y;
      if (Math.abs(dy) > 1.1 * sc) dy = 0; // 牆、懸崖：放棄這隻腳
      st.dy = smooth(st.dy, dy, dt, 14);
      const T = C.clone();
      T.y += st.dy;
      // 腳步鎖定：支撐期把腳固定在進入支撐時的位置（水平），擺動期放開
      if (legged) {
        const ph = (ctx.gait || 0) + (L.side > 0 ? 0 : Math.PI);
        // 支撐期：和 animateMech 的抬腳相反（依速度推進步伐時腿往後擺的期間）
        const stance = ctx.stride ? -Math.cos(ph) : Math.sin(ph + 0.4);
        const want = lockOn ? clamp((stance - 0.15) / 0.35, 0, 1) : 0;
        if (want > 0 && !st.lockP) st.lockP = C.clone();
        if (st.lockP && (want <= 0 || Math.hypot(st.lockP.x - C.x, st.lockP.z - C.z) > 0.9 * sc)) {
          st.lockP = null;
        }
        st.lockW = st.lockP ? smooth(st.lockW, want, dt, 20) : 0;
        if (st.lockP) {
          T.x = lerp(T.x, st.lockP.x, st.lockW);
          T.z = lerp(T.z, st.lockP.z, st.lockW);
        }
        // 支撐腳（站著、走路的支撐期、失衡）踩在地面上；擺動期沿用動作層的抬腳高度，只是不沉進地面
        const floor = gy + st.sole * rs * 0.95;
        // 空中（離地後權重淡出的期間）：不把腳拉回地面，照動作層的收腿姿勢
        st.stance = !ctx.grounded
          ? 0
          : ctx.moving && !ctx.knock && !ctx.glide
            ? clamp((stance - 0.1) / 0.3, 0, 1)
            : 1;
        T.y = Math.max(lerp(T.y, floor, st.stance), floor);
      } else T.y = Math.max(T.y, gy + 0.02 * sc);
      st.need = T.y - C.y; // 負值＝腳要往下伸
      targets.push(T);
    });
  }
  // 2. 身體傾斜：lift 繞地面中心轉，往地面法線偏（二足／四足部分、履帶整個）。
  // 二足與四足只加「垂直 → 坡度」的那一段（以世界的垂直為起點），所以整台的前後／側傾（mesh 的 leanX／leanZ、
  // animateMech 的全身傾斜）不會被拉回垂直；履帶照舊整個貼齊地面
  if (W.tilt > 0.002) {
    const tank = rig.type === 'tank';
    const n = groundN(world, pos.x, pos.z, qy, (tank ? 1.4 : 0.9) * sc, _d);
    const up = tank ? _u.copy(UP).applyQuaternion(wquat(rig.lift.parent, _qw)) : _u.copy(UP);
    const k = tank ? 1 : 0.35;
    _w.copy(up).lerp(n, k).normalize();
    aimQuat(up, _w, W.tilt, tank ? 0.4 : 0.14);
    S.tiltQ.slerp(_q, Math.min(1, ctx.dt * 8));
    rotWorld(rig.lift, S.tiltQ);
  } else S.tiltQ.identity();
  if (!targets.length || W.feet <= 0.002) return;
  // 3. 壓低骨盆：最低那隻腳伸不到時整台往下（最多 0.5 m）
  let lo = 0;
  for (const st of S.legs) lo = Math.min(lo, st.need);
  S.drop = smooth(S.drop, ctx.knock ? 0 : Math.max(lo, -0.5 * sc), dt, 12);
  const drop = S.drop * W.feet;
  if (drop < -1e-4) {
    rig.lift.position.y += drop / rs;
    upd(rig.lift);
  }
  // 4. 每隻腳解兩段骨頭，二足再把腳掌貼齊地面法線
  rig.legs.forEach((L, i) => {
    const st = S.legs[i];
    const T = targets[i];
    if (legged) {
      const cur = wpos(L.foot, _b);
      T.lerp(cur, 1 - W.feet);
      // 逆關節（四段）：小腿＋蹠骨照目前的跗關節角度當成一根骨頭（膝和二足同向彎）
      twoBone(L.thigh, L.knee, (o) => wpos(L.foot, o), T, AX, -1);
      const n = groundN(world, T.x, T.z, qy, 0.35 * sc, _d);
      const fu = _u.copy(UP).applyQuaternion(wquat(L.foot, _qw));
      rotWorld(L.foot, aimQuat(fu, n, W.feet * st.stance, 0.6));
    } else {
      const cur = _b.copy(st.tip).applyMatrix4(L.knee.matrixWorld);
      T.lerp(cur, 1 - W.feet);
      twoBone(
        L.thigh,
        L.knee,
        (o) => o.copy(st.tip).applyMatrix4(L.knee.matrixWorld),
        T,
        L.hinge || AZ,
        L.hinge ? 1 : -L.side,
      );
    }
  });
}

// 父節點座標裡看向 P 的偏航／俯仰（前方＝−Z；俯仰正值往上）
function lookAngles(o, P) {
  const d = _d.subVectors(P, wpos(o, _a)).applyQuaternion(wquat(o.parent, _qw).invert());
  return [Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z))];
}

function upperBody(rig, ctx, sc) {
  const S = rig.ik,
    W = S.w,
    dt = ctx.dt;
  const aim = ctx.aim;
  const gunAim = ctx.armAim || aim; // 手臂與肩上武器瞄準的點（機體沒有面向準星時是機體正面，頭照樣看準星）
  // ===== 近戰：上身俯仰對準目標的高度（俯仰正值＝後仰）=====
  W.melee = smooth(W.melee, on('melee') && ctx.melee && ctx.meleePt ? 1 : 0, dt, 10);
  if (W.melee > 0.002 && ctx.meleePt) S.meleePt = ctx.meleePt.clone();
  if (W.melee > 0.002 && S.meleePt) {
    const T = wpos(rig.torso, _a);
    const P = S.meleePt;
    const pitch = Math.atan2(P.y - T.y, Math.hypot(P.x - T.x, P.z - T.z));
    rig.torso.rotation.x += clamp(pitch, -0.45, 0.45) * W.melee;
    upd(rig.torso);
  }
  // ===== 頭：看向瞄準點（區域角度上限：偏航 ±1.0、俯仰 ±0.5）=====
  W.head = smooth(W.head, on('head') && !ctx.knock ? 1 - ((rig.an && rig.an.rh) || 0) : 0, dt, 6);
  if (rig.head && W.head > 0.002) {
    const h = rig.head;
    const [yaw, pitch] = lookAngles(h, aim);
    h.rotation.y = lerp(h.rotation.y, clamp(yaw, -1.0, 1.0), W.head);
    h.rotation.x = lerp(h.rotation.x, clamp(pitch, -0.5, 0.5), W.head);
    upd(h);
  }
  // ===== 肩上武器：轉向瞄準點（偏航 ±0.5、俯仰 −0.35～0.7）=====
  W.back = smooth(W.back, on('back') && !ctx.knock ? 1 : 0, dt, 6);
  for (const k of ['l', 'r']) {
    const b = rig.arms[k].back;
    if (W.back <= 0.002 || !ctx.backs[k] || !b.children.length) continue;
    const [yaw, pitch] = lookAngles(b, gunAim);
    b.rotation.order = 'YXZ';
    b.rotation.y = lerp(b.rotation.y, clamp(yaw, -0.5, 0.5), W.back);
    b.rotation.x = lerp(b.rotation.x, clamp(pitch, -0.35, 0.7), W.back);
    upd(b);
  }
  // 肩上武器的後座（動作層的彈簧，rig.an.kk）：瞄準之後才套用
  if (rig.an && rig.an.kk)
    for (const k of ['l', 'r']) {
      const b = rig.arms[k].back,
        kx = rig.an.kk['b' + k].x;
      if (Math.abs(kx) > 1e-4 && b.children.length) rotLocal(b, AX, kx);
    }
  // ===== 空手扶槍的權重：一隻手沒有武器、另一隻手持槍（要開手臂瞄準）=====
  for (const k of ['l', 'r']) {
    const o = k === 'l' ? 'r' : 'l';
    const want =
      on('support') &&
      on('arms') &&
      ctx.guns[k] === 'none' &&
      ctx.guns[o] === 'gun' &&
      !ctx.melee &&
      !ctx.knock &&
      !ctx.boost;
    W.sup[k] = smooth(W.sup[k], want ? 1 : 0, dt, 6);
  }
  // ===== 手臂：持槍的手把槍管（武器的 −Z；有持握角度時是 a.aim）對準瞄準點；肩關節整段轉，手肘維持動作層 =====
  const aimArm = (a, w) => {
    const H = wpos(a.weapon, _a);
    const f = _u.copy(FWD).applyQuaternion(wquat(a.aim || a.weapon, _qw));
    const d = _w.subVectors(gunAim, H);
    if (d.lengthSq() < 1e-4) return;
    rotWorld(a.up, aimQuat(f, d.normalize(), w, 1.3));
  };
  for (const k of ['l', 'r']) {
    const a = rig.arms[k];
    const rec = (ctx.recoil && ctx.recoil[k]) || 0;
    const firing = rec > 0.05;
    // 換彈中（槍往下翻）、待機時檢查武器：瞄準放鬆
    const rl = rig.an
      ? Math.max((rig.an.rl && rig.an.rl[k]) || 0, (rig.an.relax && rig.an.relax[k]) || 0)
      : 0;
    const want =
      on('arms') && ctx.guns[k] === 'gun' && !ctx.melee && !ctx.knock
        ? (ctx.boost && !firing ? 0.35 : 1) * (1 - 0.8 * rl)
        : 0;
    W.arm[k] = smooth(W.arm[k], want, dt, 8);
    if (W.arm[k] <= 0.002) continue;
    aimArm(a, W.arm[k]);
    aimArm(a, W.arm[k]);
    // 另一隻手要扶槍：繞槍管方向（過肩關節）轉，把槍移向身體中線（槍管方向不變），再修正一次瞄準
    const ws = W.sup[k === 'l' ? 'r' : 'l'];
    if (ws > 0.002) {
      const sh = wpos(a.up, _b);
      const d = _d.subVectors(gunAim, wpos(a.weapon, _a)).normalize();
      const gv = _a.sub(sh),
        pv = wpos(rig.arms[k === 'l' ? 'r' : 'l'].up, _c).sub(sh);
      gv.addScaledVector(d, -gv.dot(d));
      pv.addScaledVector(d, -pv.dot(d));
      const phi = Math.atan2(_n.crossVectors(gv, pv).dot(d), gv.dot(pv));
      rotWorld(a.up, _q.setFromAxisAngle(d, clamp(phi, -1.1, 1.1) * ws));
      aimArm(a, W.arm[k]);
    }
    // 後座力往上跳（動作層的彈簧 rig.an.kk，依武器種類；沒有時照後座量）＋蓄力時舉槍
    const kx = rig.an && rig.an.kk ? rig.an.kk[k].x + 0.1 * ((rig.an.ch && rig.an.ch[k]) || 0) : rec * 0.35;
    if (kx) rotLocal(a.up, AX, kx * W.arm[k]);
  }
  // ===== 空手扶槍：沒有武器的手伸到另一隻手的槍身上離肩膀最近的點（伸不到時盡量伸直）=====
  for (const k of ['l', 'r']) {
    if (W.sup[k] <= 0.002) continue;
    const a = rig.arms[k],
      ga = rig.arms[k === 'l' ? 'r' : 'l'],
      g = ga.weapon;
    const sh = wpos(a.up, _a);
    const gp = wpos(g, _g),
      f = _u.copy(FWD).applyQuaternion(wquat(ga.aim || g, _qw));
    const tt = clamp(_w.subVectors(sh, gp).dot(f), 0.2 * sc, 0.9 * sc);
    const T = _t.copy(gp).addScaledVector(f, tt);
    const Tw = T.lerp(wpos(a.hand, _g), 1 - W.sup[k]).clone();
    twoBone(a.up, a.fore, (out) => wpos(a.hand, out), Tw, AX, 1);
  }
}
