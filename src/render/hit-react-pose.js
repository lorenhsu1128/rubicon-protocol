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
    const a = env(S.c, ph, S) * e.w;
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
    const w = e.w,
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
