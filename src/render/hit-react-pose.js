// 受擊反應改版（docs/hit-react-design.md）：依武器的受擊特徵（data/hit-react.js）算人形機甲的姿勢，
// 加在近戰的受擊反應（mech-model.js 的 reactPose）上面；animateMech 呼叫 hrPose（姿勢）與 hrKicks（一開始的衝量、
// 痙攣的抖動）。st.hr＝{ L: [{ k, t, T, x, z（機體座標的推力方向，z 正＝往後推）, y（−1 腳～1 頭）, w, s, n }], p（持續挨打）}
import { clamp } from '../core/math.js';
import { HR } from '../data/hit-react.js';

const sm = (e) => e * e * (3 - 2 * e);
// 時間曲線：0～1 的進度 → 幅度
function env(c, ph, S) {
  switch (c) {
    case 'bounce':
      return ph < 0.07 ? ph / 0.07 : Math.pow(1 - ph, 1.6) * Math.cos((ph - 0.07) * Math.PI * 2.6);
    case 'shake':
      return ph < 0.08 ? ph / 0.08 : (1 - ph) / 0.92;
    case 'spasm':
      return ph < 0.06 ? ph / 0.06 : ph < 0.7 ? 1 : sm((1 - ph) / 0.3);
    case 'burn':
      return ph < 0.3 ? sm(ph / 0.3) : sm((1 - ph) / 0.7);
    case 'heavy':
    case 'lift':
    case 'press':
      return ph < 0.12 ? sm(ph / 0.12) : ph < 0.4 ? 1 : sm((1 - ph) / 0.6);
    case 'delay': {
      const d = S.d || 0.3;
      if (ph < d) return 0.18 * (ph / d);
      const q = (ph - d) / (1 - d);
      return q < 0.12 ? 0.18 + 0.82 * (q / 0.12) : sm((1 - q) / 0.88);
    }
    default: {
      // snap
      if (ph < 0.1) return ph / 0.1;
      const q = (1 - ph) / 0.9;
      return q * q;
    }
  }
}
// 幾種可以單獨看的曲線（測試用）
export function hrEnv(k, ph) {
  const S = HR[k];
  return S ? env(S.c, ph, S) : 0;
}
const OUT = { rx: 0, rz: 0, yaw: 0, flip: 0, tx: 0, tz: 0, tw: 0, crouch: 0, on: 0 };
// 姿勢：欄位同 reactPose（rx／rz＝全身連腿、tx／tz／tw＝上身、crouch＝屈膝、flip＝往後翻、on＝彈簧加快）
export function hrPose(H, t) {
  const o = OUT;
  for (const k in o) o[k] = 0;
  if (!H) return o;
  for (const e of H.L) {
    const S = HR[e.k];
    if (!S) continue;
    const ph = clamp(e.t / e.T, 0, 1);
    const a = env(S.c, ph, S) * e.w * (e.a || 1);
    if (!a) continue;
    const x = e.x * e.s,
      z = e.z;
    // 扭轉的方向：打在側面依推的方向，正面／背後依序左右交替
    const ts = Math.abs(x) > 0.25 ? Math.sign(x) : e.n % 2 ? 1 : -1;
    const head = e.y > 0.45,
      leg = e.y < -0.35;
    const tk = leg ? 0.55 : head ? 1.25 : 1;
    const b = S.b || 0,
      tt = (S.t || 0) * tk;
    if (S.c === 'lift') {
      // 從腳下掀起：往遠離爆炸的一側翻倒（正面／背後時改成前後）
      o.rz += -ts * b * a;
      o.rx += z * b * 0.45 * a;
      o.tz += -ts * tt * a;
      o.tx += z * tt * 0.5 * a;
    } else if (S.c === 'press') {
      // 從上方壓：彎腰、壓低，不看方向
      o.rx += -b * a;
      o.tx += -tt * a;
    } else {
      o.rx += z * b * a;
      o.rz += -x * b * a;
      o.tx += z * tt * a;
      o.tz += -x * tt * 0.8 * a;
    }
    o.tw += -ts * (S.tw || 0) * a;
    o.crouch += (S.cr || 0) * a * (leg ? 1.8 : 1);
    if (leg) o.rz += -ts * 0.1 * a; // 打在腳：膝蓋往那一側軟
    if (head) o.tx += 0.12 * Math.sign(z || 1) * a; // 打在頭：上身多仰一點
    if (S.fl) o.flip += S.fl * a * Math.sign(z || 1);
    // 抖動（機槍的連續震、痙攣、燒灼）
    if (S.jit) {
      const j = S.jit * (S.c === 'spasm' || S.c === 'shake' ? a : a * (1 - ph)),
        f = S.jf || 30,
        n = e.n;
      o.tx += Math.sin(t * f + n * 1.7) * j;
      o.tz += Math.sin(t * f * 1.37 + n * 2.9) * j;
      o.tw += Math.sin(t * f * 0.71 + n) * j * 1.4;
      if (S.c === 'spasm') o.rz += Math.sin(t * f * 0.53 + n * 4.1) * j * 0.4;
    }
    // 痙攣之後垂頭
    if (S.dr && ph > 0.45)
      o.tx += -S.dr * sm(clamp((ph - 0.45) / 0.3, 0, 1)) * (ph > 0.85 ? (1 - ph) / 0.15 : 1) * e.w;
    o.on = Math.max(o.on, Math.abs(a));
  }
  // 持續挨打（機槍類）：縮身、壓低、往後被推
  const p = H.p || 0;
  if (p > 0) {
    o.crouch += 0.16 * p;
    o.tx += -0.2 * p;
    o.rx += 0.07 * p;
    o.on = Math.max(o.on, p * 0.6);
  }
  o.rx = clamp(o.rx, -0.5, 0.5);
  o.rz = clamp(o.rz, -0.5, 0.5);
  o.tx = clamp(o.tx, -0.9, 0.9);
  o.tz = clamp(o.tz, -0.6, 0.6);
  o.tw = clamp(o.tw, -0.9, 0.9);
  o.crouch = clamp(o.crouch, 0, 0.45);
  o.flip = clamp(o.flip, -0.4, 0.4);
  return o;
}
// 把兩組姿勢加起來（近戰的 reactPose＋這裡的）
export function addPose(A, B) {
  if (!B.on) return A;
  return {
    rx: A.rx + B.rx,
    rz: A.rz + B.rz,
    yaw: A.yaw + B.yaw,
    flip: A.flip + B.flip,
    tx: A.tx + B.tx,
    tz: A.tz + B.tz,
    tw: A.tw + B.tw,
    crouch: A.crouch + B.crouch,
    on: Math.max(A.on, B.on),
  };
}
// 一開始的衝量（每個新的受擊動作一次）與痙攣中的抖動（每格）：手臂、頭、背包、肩上武器
export function hrKicks(m, an, H, kick) {
  if (!H) return;
  const n0 = an.hrN || 0;
  for (const e of H.L) {
    const S = HR[e.k];
    if (!S) continue;
    const w = e.w * (e.a || 1),
      zs = Math.sign(e.z || 1);
    if (e.n > n0) {
      if (S.ka && m.arms) {
        kick(m.arms.r.up.rotation, 'z', S.ka * w); // 正的＝兩手往外甩，負的＝往內縮
        kick(m.arms.l.up.rotation, 'z', -S.ka * w);
      }
      if (S.kh && m.head) kick(m.head.rotation, 'x', S.kh * zs * w * (e.y > 0.45 ? 2 : 1));
      if (S.kp && m.pack) kick(m.pack.rotation, 'x', S.kp * zs * w);
      if (S.kb && an.kk) {
        kick(an.kk.bl, 'x', S.kb * zs * w);
        kick(an.kk.br, 'x', S.kb * zs * w);
      }
    }
    // 痙攣：手臂、頭不規則地抖
    if (S.c === 'spasm' && e.t < e.T * 0.75 && m.arms) {
      const j = S.jit * 26 * w;
      kick(m.arms.r.up.rotation, 'x', (Math.random() - 0.5) * j);
      kick(m.arms.l.up.rotation, 'x', (Math.random() - 0.5) * j);
      if (m.arms.r.fore) kick(m.arms.r.fore.rotation, 'x', (Math.random() - 0.5) * j);
      if (m.arms.l.fore) kick(m.arms.l.fore.rotation, 'x', (Math.random() - 0.5) * j);
      if (m.head) kick(m.head.rotation, 'z', (Math.random() - 0.5) * j * 0.6);
    }
  }
  for (const e of H.L) an.hrN = Math.max(an.hrN || 0, e.n);
}

// ---------- 第 3 期：載具與飛行（車身／機身整台的受擊偏移）----------
// 依模型種類把受擊姿勢（全身、上身、扭轉、屈膝、翻）換成整台的俯仰 x、側滾 z、偏航 y、高度 dy（公尺）、砲塔的扭轉 tw、
// 抖動 j：地面載具＝懸吊晃動（側傾、車頭抬起、壓低），直升機＝姿態被打歪、高度掉，無人機＝翻滾、打轉
const BODY = {
  vehicle: { x: 0.55, z: 0.6, y: 0.25, dy: -0.35, tw: 0.35, flip: 0.3, j: 0.4 },
  heli: { x: 0.8, z: 1.0, y: 0.6, dy: -0.9, tw: 0.2, flip: 0.5, j: 0.7 },
  drone: { x: 1.1, z: 1.7, y: 1.3, dy: -0.7, tw: 0.3, flip: 0.8, j: 1 },
  // 第 4 期：專屬敵人的身體類別（data/hit-react.js 的 FOE_HR 的 b）
  ground: { x: 0.6, z: 0.7, y: 0.3, dy: -0.3, flip: 0.3, j: 0.5 },
  heavy: { x: 0.3, z: 0.35, y: 0.12, dy: -0.15, flip: 0.1, j: 0.3 },
  fixed: { x: 0.12, z: 0.15, y: 0.04, dy: -0.05, flip: 0, j: 0.6 },
  fly: { x: 1, z: 1.4, y: 1.1, dy: -0.6, flip: 0.7, j: 1 },
  soft: { x: 0.4, z: 0.5, y: 0.2, dy: -0.2, flip: 0.2, j: 0.3 },
  boat: { x: 0.5, z: 1.1, y: 0.2, dy: -0.5, flip: 0.2, j: 0.3 },
  hang: { x: 0.9, z: 0.9, y: 0.3, dy: 0, flip: 0, j: 0.4 },
  // 第 5 期：Boss 程式模型（霸體，小幅）與附屬部位（被打的那一塊晃）
  boss: { x: 0.35, z: 0.4, y: 0.1, dy: -0.15, flip: 0.1, j: 0.4 },
  part: { x: 0.55, z: 0.6, y: 0.25, dy: -0.15, flip: 0.2, j: 0.8 },
};
// m.group 的旋轉 x／z 由實體 lerp 到前傾（leanTilt），所以上一格加的偏移要在那之前扣掉（hrBodyRestore）；
// 位置與偏航由實體每格直接設定，不用扣
export function hrBodyRestore(m) {
  if (!m) return;
  const o = m.hrOff;
  if (o) {
    m.group.rotation.x -= o.x;
    m.group.rotation.z -= o.z;
    o.x = o.z = 0;
    if (o.sy) {
      // 壓扁（專屬敵人的 sq）
      m.group.scale.y /= o.sy;
      m.group.scale.x /= o.sxz;
      m.group.scale.z /= o.sxz;
      o.sy = o.sxz = 0;
    }
  }
  // 專屬敵人的零件動作（hrFoeNodes）：在模型自己的動作（animD1／anim_d2）之前扣掉
  const L = m.hrNodes;
  if (L && L.length) {
    for (const [obj, pr, ax, v] of L) obj[pr][ax] -= v;
    L.length = 0;
  }
}
export function hrBody(m, P, t) {
  const B = BODY[m.hrBody || m.cls];
  if (!B) return;
  const o = m.hrOff || (m.hrOff = { x: 0, z: 0 });
  if (!P.on) return;
  const j = P.on * B.j;
  let x = (P.rx + P.tx * 0.45 + P.flip * B.flip) * B.x + Math.sin(t * 37) * 0.012 * j;
  let z = (P.rz + P.tz * 0.5) * B.z + Math.sin(t * 43 + 1) * 0.015 * j;
  let yaw = 0,
    dy = 0;
  // 專屬敵人整台的特有動作（FOE_HR 的 sp）
  const F = m.hrFoe,
    s = P.tw < 0 ? -1 : 1,
    on = Math.min(1, P.on),
    H = m.height || 3;
  if (F)
    for (const op of F.sp) {
      const [k, a, f] = op;
      if (k === 'sw') {
        x += a * on * Math.sin(t * f);
        z += a * on * Math.cos(t * f * 0.8) * 0.6;
      } else if (k === 'spin') yaw += a * on * s;
      else if (k === 'flip') z += -a * on * s;
      else if (k === 'hop') dy += a * Math.abs(Math.sin(t * f)) * on * H;
      else if (k === 'float') dy += a * on * H;
      else if (k === 'sq') {
        const sy = 1 - a * on * (0.6 + 0.4 * Math.sin(t * f)),
          sxz = 1 / Math.sqrt(sy);
        m.group.scale.y *= sy;
        m.group.scale.x *= sxz;
        m.group.scale.z *= sxz;
        o.sy = sy;
        o.sxz = sxz;
      }
    }
  m.group.rotation.x += x;
  m.group.rotation.z += z;
  o.x = x;
  o.z = z;
  m.group.rotation.y += (P.yaw + P.tw * 0.25) * B.y + yaw;
  m.group.position.y +=
    (P.crouch + (m.cls === 'vehicle' ? 0 : P.on * 0.15)) * B.dy * (m.height || 3) * 0.5 + dy;
  if (m.torso && m.cls === 'vehicle') m.torso.rotation.y += P.tw * B.tw; // 砲塔被推得轉一下
  if (m.rotor) m.rotor.rotation.x = Math.sin(t * 31) * 0.06 * P.on; // 旋翼抖
}
// 專屬敵人的零件動作（FOE_HR 的 n／p）：在模型自己的動作之後套用（實體的 hrFoeApply），記下來給 hrBodyRestore 扣掉
export function hrFoeNodes(m, P, t) {
  const F = m.hrFoe;
  if (!F || !P.on) return;
  const L = m.hrNodes || (m.hrNodes = []);
  const s = P.tw < 0 ? -1 : 1,
    on = Math.min(1, P.on);
  for (const op of F.sp) {
    if (op[0] !== 'n' && op[0] !== 'p') continue;
    const [k, name, ax, a, f] = op;
    const pr = k === 'n' ? 'rotation' : 'position';
    const T = m[name];
    const list = Array.isArray(T) ? T : [T];
    list.forEach((obj, i) => {
      if (!obj || !obj.isObject3D) return;
      const v = a * on * (f ? Math.sin(t * f + i * 1.3) : s);
      obj[pr][ax] += v;
      L.push([obj, pr, ax, v]);
    });
  }
}
