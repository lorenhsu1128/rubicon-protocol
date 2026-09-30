// ---------------- WEAPONS（Q 版：粗大方塊化） ----------------
import { clamp, lerp } from '../core/math.js';
import { asmParts, partById } from '../data/parts.js';
import {
  CB,
  OUTLINE_MAT,
  P,
  bakeAll,
  decal,
  gBox,
  gCyl,
  gFrustum,
  gSph,
  kitBolts,
  kitCable,
  kitGrille,
  kitVents,
} from './geometry.js';
import { mechMats } from './materials.js';

function buildWeapon(node, w, M, side) {
  if (!w || w.type === 'none') return;
  const G = M.gun,
    S = M.sub,
    A = M.acc;
  const glow = new THREE.MeshStandardMaterial({
    color: w.color || 0xffffff,
    emissive: w.color || 0xffffff,
    emissiveIntensity: 1.6,
    roughness: 0.3,
  });
  const red = new THREE.MeshStandardMaterial({
    color: 0xff3a2a,
    emissive: 0xff2a1a,
    emissiveIntensity: 1.2,
    roughness: 0.4,
  });
  const C = 0.05;
  switch (w.id) {
    case 'w_rifle': // 超長步槍：機匣方塊、長槍管盒、槍托、彈匣、導軌、消焰器
      CB(node, 0.42, 0.5, 1.4, G, 0, 0, -0.2, 0, 0, 0, 0.06);
      CB(node, 0.3, 0.34, 1.9, G, 0, 0.02, -1.75, 0, 0, 0, C);
      CB(node, 0.2, 0.2, 0.5, S, 0, 0.02, -2.9, 0, 0, 0, 0.03);
      for (let i = 0; i < 3; i++) P(node, gBox(0.26, 0.06, 0.04), A, 0, 0.02, -2.85 - i * 0.1);
      P(node, gBox(0.24, 0.08, 1.6), A, 0, 0.3, -1.2);
      CB(node, 0.3, 0.44, 0.28, S, 0, -0.42, -0.3, 0, 0, 0, 0.03);
      CB(node, 0.36, 0.36, 0.6, G, 0, 0.0, 0.7, 0, 0, 0, C);
      P(node, gBox(0.4, 0.16, 0.2), S, 0, 0.05, 1.0);
      kitBolts(node, M, [
        [0.22 * side, 0.1, -0.3, 0, Math.PI / 2],
        [0.22 * side, -0.1, -0.6, 0, Math.PI / 2],
        [0.22 * side, 0.1, 0.4, 0, Math.PI / 2],
      ]);
      decal(node, 2, 0.3, 0.3, 0.22 * side, 0.0, -0.9, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_mg':
      CB(node, 0.46, 0.5, 1.2, G, 0, 0, -0.2, 0, 0, 0, 0.06);
      CB(node, 0.5, 0.4, 0.6, S, 0.3 * side, -0.05, 0.0, 0, 0, 0, C);
      P(node, gCyl(0.2, 0.18, 1.3, 8), G, 0, 0.02, -1.4, Math.PI / 2);
      for (let i = 0; i < 3; i++) P(node, gCyl(0.14, 0.14, 0.1, 8), S, 0, 0.02, -1.0 - i * 0.35, Math.PI / 2);
      P(node, gCyl(0.08, 0.08, 0.6, 6), S, 0, 0.02, -2.3, Math.PI / 2);
      for (let i = 0; i < 4; i++) P(node, gBox(0.5, 0.05, 0.14), A, 0, 0.28, -0.3 - i * 0.22);
      decal(node, 0, 0.22, 0.22, 0.24 * side, 0.05, -0.4, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_sg':
      CB(node, 0.42, 0.44, 1.1, G, 0, 0, -0.2, 0, 0, 0, 0.06);
      P(node, gCyl(0.15, 0.15, 1.2, 8), S, 0, 0.1, -1.2, Math.PI / 2);
      P(node, gCyl(0.13, 0.13, 1.2, 8), S, 0, -0.1, -1.2, Math.PI / 2);
      P(node, gCyl(0.2, 0.2, 0.3, 8), A, 0, 0, -1.85, Math.PI / 2);
      CB(node, 0.3, 0.26, 0.5, G, 0, -0.32, 0.1, 0, 0, 0, C);
      kitBolts(node, M, [[0.22 * side, 0.1, -0.4, 0, Math.PI / 2]]);
      break;
    case 'w_bz':
      CB(node, 0.5, 0.5, 2.2, G, 0, 0.06, -0.5, 0, 0, 0, 0.08);
      P(node, gCyl(0.34, 0.3, 0.5, 10), S, 0, 0.06, -1.75, Math.PI / 2);
      P(node, gCyl(0.3, 0.3, 0.06, 10), red, 0, 0.06, -2.0, Math.PI / 2);
      CB(node, 0.34, 0.34, 0.4, A, 0, 0.06, 0.4, 0, 0, 0, C);
      CB(node, 0.18, 0.4, 0.7, S, 0.32 * side, 0.1, -0.3, 0, 0, 0, C);
      decal(node, 2, 0.34, 0.34, 0.26 * side, 0.06, -0.9, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_hg':
      CB(node, 0.3, 0.36, 0.9, G, 0, 0, -0.25, 0, 0, 0, C);
      CB(node, 0.18, 0.18, 0.5, S, 0, 0.06, -0.9, 0, 0, 0, 0.03);
      P(node, gCyl(0.12, 0.12, 0.16, 8), A, 0, 0.06, -1.2, Math.PI / 2);
      CB(node, 0.24, 0.28, 0.34, S, 0, -0.28, -0.05, 0, 0, 0, 0.03);
      P(node, gBox(0.3, 0.06, 0.6), A, 0, 0.22, -0.4);
      break;
    case 'w_emp':
      CB(node, 0.4, 0.46, 1.3, G, 0, 0, -0.2, 0, 0, 0, 0.06);
      for (let i = 0; i < 4; i++)
        P(
          node,
          new THREE.TorusGeometry(0.22, 0.04, 6, 16),
          i % 2 ? glow : A,
          0,
          0.02,
          -1.0 - i * 0.28,
          0,
          0,
          0,
        );
      P(node, gCyl(0.08, 0.08, 1.4, 8), S, 0, 0.02, -1.4, Math.PI / 2);
      P(node, gSph(0.12, 8), glow, 0, 0.02, -2.1);
      CB(node, 0.3, 0.24, 0.5, S, 0, -0.34, -0.1, 0, 0, 0, 0.03);
      break;
    case 'w_lr':
      CB(node, 0.42, 0.52, 1.6, G, 0, 0, -0.3, 0, 0, 0, 0.06);
      CB(node, 0.2, 0.2, 1.2, glow, 0, 0.02, -1.7, 0, 0, 0, 0.03);
      P(node, gFrustum(0.4, 0.6, 0.3, 0.5, 0.4), S, 0, 0.02, -2.4, Math.PI / 2);
      for (let i = 0; i < 4; i++) P(node, gBox(0.56, 0.04, 0.2), A, 0, 0.3, -0.4 - i * 0.3);
      CB(node, 0.4, 0.22, 0.6, S, 0, -0.36, -0.3, 0, 0, 0, C);
      kitCable(node, M, [
        [0, 0.3, 0.3],
        [0.2 * side, 0.42, 0.6],
        [0, 0.25, 0.9],
      ]);
      break;
    case 'w_lc':
      CB(node, 0.56, 0.56, 2.4, G, 0, 0.05, -0.6, 0, 0, 0, 0.08);
      CB(node, 0.26, 0.26, 0.8, glow, 0, 0.05, -2.2, 0, 0, 0, 0.03);
      CB(node, 0.6, 0.6, 0.9, S, 0, 0.05, 0.4, 0, 0, 0, 0.06);
      for (let i = 0; i < 5; i++) P(node, gBox(0.66, 0.04, 0.16), A, 0, 0.4, -0.5 - i * 0.3);
      decal(node, 3, 0.4, 0.4, 0.31 * side, 0.05, -0.4, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_blade':
      CB(node, 0.32, 0.36, 0.8, G, 0, 0, 0, 0, 0, 0, C);
      CB(node, 0.4, 0.44, 0.24, A, 0, 0, -0.4, 0, 0, 0, C);
      CB(node, 0.08, 0.44, 2.0, glow, 0, 0, -1.5, 0, 0, 0, 0.02);
      CB(node, 0.14, 0.2, 2.0, S, 0, 0, -1.5, 0, 0, 0, 0.02);
      break;
    case 'w_saber':
      CB(node, 0.36, 0.4, 0.9, G, 0, 0, 0.1, 0, 0, 0, C);
      CB(node, 0.6, 0.6, 0.22, A, 0, 0, -0.4, 0, 0, 0, C);
      CB(node, 0.1, 0.6, 2.8, glow, 0, 0, -1.9, 0, 0, 0, 0.02);
      CB(node, 0.16, 0.22, 2.6, S, 0, 0, -1.9, 0, 0, 0, 0.02);
      CB(node, 0.14, 0.14, 0.6, S, 0, 0, 0.7, 0, 0, 0, 0.02);
      break;
    case 'w_claw':
      CB(node, 0.4, 0.4, 0.8, G, 0, 0, 0, 0, 0, 0, C);
      for (const o of [-0.16, 0, 0.16]) {
        CB(node, 0.08, 0.1, 1.4, glow, o, 0.05, -1.0, 0, 0, 0, 0.02);
        CB(node, 0.1, 0.2, 0.6, S, o, 0.05, -0.5, 0, 0, 0, 0.02);
      }
      P(node, gBox(0.46, 0.16, 0.4), A, 0, 0.24, -0.2);
      break;
    case 'w_pile':
      CB(node, 0.5, 0.54, 1.3, G, 0, 0, -0.1, 0, 0, 0, 0.06);
      P(node, gCyl(0.2, 0.2, 1.0, 8), S, 0, 0, -1.0, Math.PI / 2);
      P(node, gCyl(0.08, 0.08, 0.9, 6), glow, 0, 0, -1.75, Math.PI / 2);
      CB(node, 0.56, 0.6, 0.5, A, 0, 0, 0.6, 0, 0, 0, 0.05);
      decal(node, 2, 0.4, 0.4, 0.28 * side, 0.0, -0.1, 0, (side * Math.PI) / 2, 0);
      break;
    case 'bw_ms':
    case 'bw_ms8':
      {
        const n = w.id === 'bw_ms' ? 2 : 3;
        const W = 0.36 * n + 0.2,
          H = 0.36 * n + 0.2;
        CB(node, W, H, 1.1, G, 0, 0, 0, 0, 0, 0, 0.08);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const x = (i - (n - 1) / 2) * 0.36,
              y = (j - (n - 1) / 2) * 0.36;
            P(node, gBox(0.3, 0.3, 0.06), S, x, y, -0.56);
            P(node, gCyl(0.1, 0.1, 0.06, 8), red, x, y, -0.6, Math.PI / 2);
          }
        P(node, gBox(W + 0.04, 0.06, 1.14), A, 0, H / 2, 0);
        decal(node, 3, 0.4, 0.4, W / 2 + 0.01, 0, 0.1, 0, Math.PI / 2, 0);
      }
      break;
    case 'bw_gr':
      CB(node, 0.6, 0.56, 1.0, G, 0, 0, 0.2, 0, 0, 0, 0.08);
      P(node, gCyl(0.28, 0.28, 1.4, 10), G, 0, 0.1, -0.5, Math.PI / 2);
      P(node, gCyl(0.34, 0.34, 0.2, 10), A, 0, 0.1, -1.2, Math.PI / 2);
      P(node, gCyl(0.3, 0.3, 0.06, 10), red, 0, 0.1, -1.34, Math.PI / 2);
      break;
    case 'bw_lc':
      CB(node, 0.5, 0.5, 1.0, S, 0, 0.05, 0.4, 0, 0, 0, 0.06);
      CB(node, 0.36, 0.36, 2.4, G, 0, 0.1, -0.7, 0, 0, 0, 0.05);
      CB(node, 0.16, 0.16, 0.6, glow, 0, 0.1, -2.1, 0, 0, 0, 0.02);
      for (let i = 0; i < 5; i++) P(node, gBox(0.46, 0.04, 0.14), A, 0, 0.36, -0.2 - i * 0.3);
      break;
    case 'bw_sh':
      P(
        node,
        gBox(1.0, 1.2, 0.14),
        new THREE.MeshStandardMaterial({
          color: M.acc.color,
          transparent: true,
          opacity: 0.6,
          emissive: M.acc.color,
          emissiveIntensity: 0.4,
        }),
        side * 0.45,
        0.1,
        -0.2,
        0,
        side * 0.3,
      );
      CB(node, 0.4, 0.5, 0.4, S, 0, 0, 0.1, 0, 0, 0, C);
      break;
    case 'bw_emp_s':
    case 'bw_emp_l':
      {
        const big = w.id === 'bw_emp_l';
        const R = big ? 0.42 : 0.32;
        CB(node, R * 2, R * 1.6, R * 2, S, 0, 0, 0, 0, 0, 0, 0.05);
        for (let i = 0; i < 3; i++)
          P(
            node,
            new THREE.TorusGeometry(R * (1.1 + i * 0.25), 0.05, 6, 20),
            i % 2 ? glow : A,
            0,
            R * 0.6 + i * 0.28,
            0,
            Math.PI / 2,
          );
        P(node, gCyl(0.06, 0.06, R * 2.6, 6), M.joint, 0, R * 1.3, 0);
        P(node, gSph(R * 0.35, 8), glow, 0, R * 2.7, 0);
      }
      break;
    case 'bw_gat':
      CB(node, 0.6, 0.56, 1.1, G, 0, 0.05, 0.2, 0, 0, 0, 0.08);
      CB(node, 0.5, 0.34, 0.5, S, 0.4 * side, 0, 0.3, 0, 0, 0, C);
      for (let i = 0; i < 4; i++) {
        P(
          node,
          gCyl(0.09, 0.09, 1.4, 8),
          S,
          Math.cos(i * 1.57 + 0.78) * 0.14,
          0.05 + Math.sin(i * 1.57 + 0.78) * 0.14,
          -1.1,
          Math.PI / 2,
        );
        P(
          node,
          gCyl(0.06, 0.06, 0.04, 8),
          red,
          Math.cos(i * 1.57 + 0.78) * 0.14,
          0.05 + Math.sin(i * 1.57 + 0.78) * 0.14,
          -1.82,
          Math.PI / 2,
        );
      }
      P(node, gCyl(0.24, 0.24, 0.2, 8), A, 0, 0.05, -1.7, Math.PI / 2);
      P(node, gCyl(0.24, 0.24, 0.12, 8), A, 0, 0.05, -0.5, Math.PI / 2);
      break;
  }
}

// ---------------- MECH v6 — Q 版 3D CUBE 風格（CUBEE AC-01 比例） ----------------
// 三頭身：頭 0.55、軀幹立方 1.2、腿短、腳大；所有等級比例相同，只有裝備與貼花不同
const CUBE = {
  hipY: 1.34,
  hipX: 0.495,
  thighL: 0.58,
  thighW: 0.49,
  shinL: 0.6,
  shinW: 0.49,
  footL: 0.8,
  footW: 0.49,
  footH: 0.34,
  pelvisW: 0.5,
  tw: 1.56,
  th: 1.02,
  td: 0.95,
  cx: 0.65,
  pelvisH: 0.5,
  headW: 0.5,
  headH: 0.5,
  headD: 0.55,
  shX: 1.16,
  shPad: 0.6,
  upL: 0.5,
  upW: 0.44,
  foreL: 0.55,
  foreW: 0.56,
  fist: 0.5,
}; // 量自設計圖正視圖（1 px ≈ 0.00465 m，總高 3.5）
export function buildMech(asm, pal, scale = 1) {
  const p = asmParts(asm);
  const M = mechMats(pal);
  const R = CUBE;
  const C = 0.08;
  const red = new THREE.MeshStandardMaterial({
    color: 0xff3a2a,
    emissive: 0xff2a1a,
    emissiveIntensity: 1.3,
    roughness: 0.4,
  });
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  const type = p.legs.type;
  const cls =
    p.core.id === 'c_hv' ? 'heavy' : p.core.id === 'c_lt' || p.core.id === 'c_nat' ? 'light' : 'medium';
  const heavy = cls === 'heavy',
    light = cls === 'light';
  const legs = [];
  let hipY = R.hipY;
  // ===== 腿 =====
  if (type === 'biped' || type === 'reverse') {
    const rev = type === 'reverse';
    if (rev) hipY += 0.15;
    CB(legsG, R.pelvisW, R.pelvisH, R.td * 0.72, M.main2, 0, hipY + 0.2, 0, 0, 0, 0, 0.06);
    decal(legsG, 0, 0.18, 0.18, 0, hipY + 0.22, -R.td * 0.36 - 0.01, 0, Math.PI, 0); // 襠部（藍）：寬度＝胸部中央柱，直接接上半身
    for (const s of [-1, 1]) {
      const L = new THREE.Group();
      L.position.set(s * R.hipX, hipY + 0.36, 0);
      legsG.add(L); // 大腿樞軸：襠部側面偏上（距頂面 0.09）
      const thigh = new THREE.Group();
      L.add(thigh);
      const tw = R.thighW,
        tl = R.thighL;
      P(thigh, gSph(0.19, 12), M.joint, -s * tw * 0.5, 0, 0); // 髖球關節：位於大腿根部內側面與襠部側面的交接點
      CB(thigh, tw, tl + 0.1, tw * 0.95, M.main, 0, -tl / 2 + 0.06, rev ? 0.08 : 0, 0, 0, 0, C); // 大腿立方（綠），頂面略高於樞軸
      P(thigh, gBox(tw * 0.2, tl * 0.7, 0.03), M.acc, s * tw * 0.15, -tl * 0.5, rev ? -tw * 0.46 : -tw * 0.5); // 黃色直條（設計圖大腿正面）
      CB(
        thigh,
        tw * 0.5,
        tl * 0.4,
        0.1,
        M.grey,
        -s * tw * 0.2,
        -tl * 0.55,
        rev ? -tw * 0.45 : -tw * 0.5,
        0,
        0,
        0,
        0.02,
      );
      kitBolts(thigh, M, [
        [s * tw * 0.5, -tl * 0.3, 0.1, 0, Math.PI / 2],
        [s * tw * 0.5, -tl * 0.7, 0.1, 0, Math.PI / 2],
      ]);
      decal(thigh, 7, tw * 0.45, tw * 0.45, s * (tw * 0.5 + 0.01), -tl * 0.5, 0.05, 0, (s * Math.PI) / 2, 0);
      const knee = new THREE.Group();
      knee.position.set(0, -tl - 0.05, rev ? 0.12 : 0);
      thigh.add(knee);
      const sw = R.shinW,
        sl = R.shinL;
      P(knee, gCyl(sw * 0.32, sw * 0.32, tw * 1.2, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
      for (const q of [-1, 1])
        P(knee, gCyl(sw * 0.2, sw * 0.2, 0.05, 10), M.acc, q * tw * 0.6, 0, 0, 0, 0, Math.PI / 2); // 圓形膝蓋蓋
      CB(knee, sw, sl * 0.55, sw * 0.95, M.main, 0, -sl * 0.28, 0, 0, 0, 0, C); // 小腿上段（綠）
      CB(knee, sw * 0.96, sl * 0.55, sw * 0.92, M.main2, 0, -sl * 0.8, 0, 0, 0, 0, C); // 小腿下段（藍）
      P(knee, gBox(sw * 0.6, 0.05, 0.02), M.acc, 0, -sl * 0.5, -sw * 0.5);
      decal(knee, 7, sw * 0.42, sw * 0.42, 0, -sl * 0.8, -sw * 0.48, 0, Math.PI, 0); // 黃分隔線＋「01」
      kitVents(knee, M, -s * sw * 0.5, -sl * 0.25, 0.1, 3, 0.05, Math.PI / 2);
      kitBolts(knee, M, [[s * sw * 0.49, -sl * 0.3, 0.12, 0, Math.PI / 2]]);
      const foot = new THREE.Group();
      foot.position.set(0, -sl - 0.1, 0);
      knee.add(foot);
      const fl = R.footL,
        fw = R.footW,
        fh = R.footH;
      P(foot, gCyl(sw * 0.26, sw * 0.26, sw * 1.1, 8), M.joint, 0, 0.05, 0, 0, 0, Math.PI / 2);
      CB(foot, fw, fh, fl * 0.75, M.main2, 0, -fh / 2, -fl * 0.05, 0, 0, 0, 0.05); // 腳板（藍）
      CB(foot, fw * 0.92, fh * 0.8, fl * 0.3, M.grey, 0, -fh * 0.5, -fl * 0.55, 0, 0, 0, 0.04);
      for (const t of [-0.28, 0.28])
        P(foot, gBox(fw * 0.3, fh * 0.35, 0.1), M.joint, t * fw, -fh * 0.6, -fl * 0.72); // 灰色腳趾塊
      for (const t of [-0.28, 0.28]) {
        P(foot, gBox(fw * 0.22, fh * 0.5, 0.14), M.joint, t * fw, -fh * 0.5, fl * 0.38);
        P(foot, gBox(fw * 0.16, fh * 0.3, 0.06), red, t * fw, -fh * 0.5, fl * 0.47);
      } // 腳跟推進器（橙紅）
      CB(foot, fw * 0.5, fh * 0.5, fl * 0.2, M.main, 0, 0.05, -fl * 0.1, 0, 0, 0, 0.03);
      decal(foot, 2, 0.28, 0.28, s * (fw / 2 + 0.01), -fh / 2, -fl * 0.05, 0, (s * Math.PI) / 2, 0);
      const th = rev ? -0.35 : 0.08,
        kn = rev ? 0.6 : -0.15,
        ft = rev ? -0.25 : 0.07;
      thigh.rotation.x = th;
      knee.rotation.x = kn;
      foot.rotation.x = ft;
      legs.push({ thigh, knee, foot, side: s, th, kn, ft });
    }
  } else if (type === 'quad') {
    hipY = 1.3;
    CB(legsG, 1.6, 0.5, 1.6, M.sub, 0, hipY - 0.05, 0, 0, 0, 0, 0.08);
    CB(legsG, 1.2, 0.3, 1.2, M.main, 0, hipY + 0.3, 0, 0, 0, 0, 0.05);
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const L = new THREE.Group();
      L.position.set(sx * 0.85, hipY - 0.1, sz * 0.7);
      legsG.add(L);
      const thigh = new THREE.Group();
      L.add(thigh);
      P(thigh, gCyl(0.18, 0.18, 0.5, 8), M.joint, 0, 0, 0, Math.PI / 2);
      CB(thigh, 0.42, 0.8, 0.42, M.main2, 0, -0.4, 0, 0, 0, 0, 0.06);
      const knee = new THREE.Group();
      knee.position.y = -0.8;
      thigh.add(knee);
      P(knee, gCyl(0.16, 0.16, 0.46, 8), M.joint, 0, 0, 0, Math.PI / 2);
      CB(knee, 0.38, 0.7, 0.38, M.main, 0, -0.35, 0, 0, 0, 0, 0.05);
      const foot = new THREE.Group();
      foot.position.y = -0.7;
      knee.add(foot);
      CB(foot, 0.5, 0.24, 0.6, M.sub, 0, -0.1, 0, 0, 0, 0, 0.04);
      thigh.rotation.z = sx * 0.8;
      thigh.rotation.x = sz * 0.3;
      knee.rotation.z = -sx * 1.4;
      legs.push({ thigh, knee, foot, side: sx, sz });
    }
  } else {
    hipY = 1.1;
    CB(legsG, 1.7, 0.6, 2.2, M.sub, 0, 0.85, 0, 0, 0, 0, 0.08);
    CB(legsG, 1.2, 0.3, 1.4, M.main, 0, 1.25, 0, 0, 0, 0, 0.05);
    for (const s of [-1, 1]) {
      CB(legsG, 0.8, 0.9, 2.8, M.joint, s * 1.25, 0.5, 0, 0, 0, 0, 0.1);
      CB(legsG, 0.84, 0.16, 2.9, M.main2, s * 1.25, 1.0, 0, 0, 0, 0, 0.04);
      for (let i = -1; i <= 1; i++)
        P(legsG, gCyl(0.36, 0.36, 0.86, 10), M.acc, s * 1.25, 0.45, i * 0.95, 0, 0, Math.PI / 2);
      for (let i = 0; i < 9; i++) {
        P(legsG, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.08, -1.3 + i * 0.32);
        P(legsG, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.96, -1.3 + i * 0.32);
      }
    }
  }
  // ===== 軀幹：近立方體 =====
  torso.position.y = hipY + 0.33;
  const cw = R.tw,
    ch = R.th,
    cd = R.td;
  // 胸部三塊：中央柱（放頭，頂面較低、整體較高）＋左右胸塊（較短但頂面較高、外推）＋下腹連接板
  const cx = R.cx,
    sx = (cw - cx) / 2,
    sideH = ch * 0.85,
    cenTop = ch + 0.12,
    sideTop = ch + 0.28;
  CB(torso, cx, ch, cd, M.grey, 0, cenTop - ch / 2, 0, 0, 0, 0, 0.08); // 中央柱（灰）
  CB(torso, cx * 0.7, 0.12, 0.1, red, 0, cenTop - 0.12, -cd * 0.5, 0, 0, 0, 0.02); // 中央頂端紅色指示燈
  for (let i = 0; i < 3; i++)
    P(torso, gBox(cx * 0.8, 0.03, 0.03), M.joint, 0, cenTop - ch + 0.1 + i * 0.08, -cd * 0.51); // 中央柱下段的橫向散熱縫（設計圖腹部）
  for (const s of [-1, 1]) {
    const x = s * (cx / 2 + sx / 2 - 0.02);
    CB(torso, sx, sideH, cd * 1.02, M.main, x, sideTop - sideH / 2, -0.02, 0, 0, 0, 0.08); // 左右胸塊（綠）
    P(torso, gBox(sx * 0.86, 0.05, 0.03), M.acc, x, sideTop - 0.12, -cd * 0.53);
    kitBolts(torso, M, [
      [x - s * sx * 0.32, sideTop - sideH * 0.85, -cd * 0.53],
      [x + s * sx * 0.32, sideTop - sideH * 0.85, -cd * 0.53],
      [x + s * sx * 0.32, sideTop - 0.25, -cd * 0.53],
    ]);
    decal(torso, s > 0 ? 1 : 3, 0.34, 0.34, x, sideTop - sideH * 0.5, -cd * 0.53, 0, Math.PI, 0);
    decal(
      torso,
      2,
      0.46,
      0.46,
      s * (cx / 2 + sx + 0.01 - 0.02),
      sideTop - sideH * 0.5,
      0.05,
      0,
      (s * Math.PI) / 2,
      0,
    );
    kitVents(torso, M, s * (cx / 2 + sx - 0.02), sideTop - 0.2, -cd * 0.2, 4, 0.14, Math.PI / 2);
  }
  P(torso, gBox(cx * 0.7, ch * 0.45, 0.04), M.sub, 0, cenTop - ch * 0.5, -cd * 0.52);
  for (let i = 0; i < 2; i++)
    P(torso, gCyl(0.05, 0.05, 0.04, 8), red, -0.1 + i * 0.2, cenTop - ch * 0.3, -cd * 0.54, Math.PI / 2);
  decal(torso, 3, 0.26, 0.26, 0, cenTop - ch * 0.62, -cd * 0.55, 0, Math.PI, 0); // 中央面板＋紅燈＋AC 標記
  P(torso, gBox(cx * 0.8, 0.06, cd * 0.6), M.acc, 0, cenTop + 0.03, 0);
  // 背包：兩個方塊推進器 + 中央箱
  const bp = new THREE.Group();
  bp.position.set(0, ch * 0.5 + 0.2, cd * 0.6);
  torso.add(bp);
  CB(bp, cw * 0.86, ch * 0.92, 0.6, M.main, 0, 0.02, 0.02, 0, 0, 0, 0.08);
  decal(bp, 5, 0.5, 0.5, 0, ch * 0.22, 0.33, 0, 0, 0); // Power Backpack：大型綠色背箱＋ CUBEE AC-01
  kitGrille(bp, M, 0, -ch * 0.12, 0.32, cw * 0.5, 0.22, 5);
  for (const s of [-1, 1]) {
    kitGrille(bp, M, s * cw * 0.3, -ch * 0.32, 0.32, 0.22, 0.16, 3);
    CB(bp, 0.3, 0.44, 0.3, M.sub, s * cw * 0.3, -ch * 0.3, 0.42, 0, 0, 0, 0.04);
    P(bp, gCyl(0.13, 0.15, 0.14, 10), M.joint, s * cw * 0.3, -ch * 0.3 - 0.28, 0.42);
    P(bp, gBox(0.12, 0.4, 0.06), M.acc, s * cw * 0.44, 0.1, 0.33);
  }
  if (heavy) {
    for (const s of [-1, 1]) P(bp, gCyl(0.24, 0.24, ch * 0.9, 10), M.main, s * cw * 0.15, 0.05, 0.5);
  }
  P(bp, gCyl(0.02, 0.02, 1.2, 4), M.joint, cw * 0.1, ch * 0.9, 0.05);
  const nozzles = [];
  for (const s of [-1, 1]) {
    const fl = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.9, 8),
      new THREE.MeshBasicMaterial({
        color: pal.glow || 0x9ff0ff,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    fl.position.set(s * cw * 0.3, -ch * 0.3 - 0.75, 0.42);
    fl.rotation.x = Math.PI;
    fl.scale.set(1, 0.01, 1);
    bp.add(fl);
    nozzles.push(fl);
  }
  // ===== 頭：扁方盒，陷進肩線，紅色發光面罩 =====
  const head = new THREE.Group();
  head.position.y = ch + 0.14;
  torso.add(head);
  const hw = R.headW,
    hh = R.headH,
    hd = R.headD;
  CB(head, hw, hh, hd, M.grey, 0, hh / 2, 0, 0, 0, 0, 0.08);
  CB(head, hw * 0.72, hh * 0.26, 0.08, red, 0, hh * 0.58, -hd * 0.5, 0, 0, 0, 0.02);
  P(head, gBox(hw * 0.5, hh * 0.14, 0.05), M.sub, 0, hh * 0.22, -hd * 0.52); // 灰色頭盒＋紅色面罩＋下巴格
  CB(head, hw * 0.7, 0.08, hd * 0.5, M.sub, 0, hh + 0.03, 0.05, 0, 0, 0, 0.02);
  P(head, gCyl(0.02, 0.02, 0.9, 4), M.joint, hw * 0.2, hh + 0.45, 0.1);
  for (const s of [-1, 1]) {
    CB(head, 0.16, hh * 0.7, hd * 0.55, M.sub, s * (hw / 2 + 0.08), hh * 0.45, 0, 0, 0, 0, 0.03);
    P(head, gCyl(0.05, 0.05, 0.04, 8), M.lens, s * (hw / 2 + 0.17), hh * 0.45, -hd * 0.1, 0, 0, Math.PI / 2);
  } // 側耳感測塊
  if (p.head.id === 'h_hv') {
    P(head, gBox(hw * 1.1, 0.1, hd * 0.4), M.sub, 0, hh * 0.95, -hd * 0.2);
  }
  if (p.head.id === 'h_scan') {
    P(head, gCyl(0.12, 0.12, 0.1, 8), M.lens, hw * 0.25, hh + 0.1, 0.1);
    P(head, gCyl(0.03, 0.03, 1.2, 4), M.joint, -hw * 0.25, hh + 0.6, 0.1);
  }
  // ===== 肩：肩上武器箱直接坐在肩線；手臂方塊 =====
  const arms = {};
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(s * (cw / 2 + 0.05), ch + 0.02, 0);
    torso.add(sh);
    P(sh, gCyl(0.16, 0.16, 0.4, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    CB(sh, R.shPad, R.shPad, R.shPad, M.grey, s * (R.shPad / 2 - 0.02), 0.0, 0, 0, 0, 0, 0.06);
    decal(sh, 7, 0.3, 0.3, s * (R.shPad - 0.01), 0.0, 0, 0, (s * Math.PI) / 2, 0);
    kitBolts(sh, M, [
      [s * (R.shPad - 0.01), 0.22, 0.2, 0, Math.PI / 2],
      [s * (R.shPad - 0.01), 0.22, -0.2, 0, Math.PI / 2],
    ]); // 灰色方形肩甲「01」（0.6 立方）
    const up = new THREE.Group();
    up.position.set(s * (R.shPad / 2 - 0.02), -R.shPad / 2, 0);
    sh.add(up);
    const ul = R.upL,
      aw = R.upW;
    CB(up, aw, ul + 0.1, aw, M.main, 0, -ul / 2 - 0.05, 0, 0, 0, 0, 0.06);
    P(up, gBox(aw * 1.02, 0.09, aw * 1.02), M.acc, 0, -ul * 0.55, 0);
    kitBolts(up, M, [[s * aw * 0.5, -ul * 0.25, 0, 0, Math.PI / 2]]); // 上臂（綠）＋黃色環帶
    const fore = new THREE.Group();
    fore.position.y = -ul - 0.1;
    up.add(fore);
    const fl2 = R.foreL,
      fw = R.foreW;
    P(fore, gCyl(0.2, 0.2, aw + 0.2, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    CB(fore, fw, fl2 + 0.1, fw, M.main2, 0, -fl2 / 2 - 0.05, 0, 0, 0, 0, 0.06);
    CB(fore, fw * 0.8, fl2 * 0.5, 0.1, M.grey, 0, -fl2 * 0.45, -fw * 0.5, 0, 0, 0, 0.03);
    decal(fore, 7, 0.3, 0.3, s * (fw / 2 + 0.01), -fl2 * 0.5, 0, 0, (s * Math.PI) / 2, 0);
    kitVents(fore, M, -s * fw * 0.5, -fl2 * 0.35, 0.1, 3, 0.06, Math.PI / 2); // 前臂（藍）＋灰板＋「01」
    const hand = new THREE.Group();
    hand.position.set(0, -fl2 - 0.12, 0);
    fore.add(hand);
    const fs = R.fist;
    CB(hand, fs * 0.9, fs * 0.8, fs * 0.9, M.grey, 0, -fs * 0.25, 0, 0, 0, 0, 0.05);
    for (let f = 0; f < 4; f++) {
      CB(hand, 0.09, 0.16, 0.1, M.joint, -0.15 + f * 0.1, -fs * 0.7, -fs * 0.3, 0, 0, 0, 0.02);
      CB(hand, 0.08, 0.12, 0.09, M.grey, -0.15 + f * 0.1, -fs * 0.95, -fs * 0.36, 0, 0, 0, 0.02);
    }
    CB(hand, 0.1, 0.14, 0.12, M.joint, s * fs * 0.5, -fs * 0.45, -fs * 0.2, 0, 0, 0, 0.02); // 四指關節手＋拇指（設計圖 Detail A）
    const wm = new THREE.Group();
    wm.position.set(0, -fs * 0.3, -fs * 0.3);
    wm.rotation.x = -Math.PI / 2;
    wm.scale.set(0.72, 0.72, 0.5);
    hand.add(wm);
    buildWeapon(wm, partById('arm', s > 0 ? asm.rarm : asm.larm), M, s); // Q 版：武器縮小、縮短一半
    up.rotation.x = 0.35;
    fore.rotation.x = 1.2;
    const bwp = new THREE.Group();
    bwp.position.set(s * (cw / 2 + 0.05 + R.shPad / 2), ch + 0.02 + R.shPad / 2 + 0.3, 0.2);
    bwp.scale.set(0.8, 0.8, 0.65);
    torso.add(bwp);
    buildWeapon(bwp, partById('back', s > 0 ? asm.rback : asm.lback), M, s); // 肩上武器箱：外移到肩線外側，避免遮住頭
    arms[s > 0 ? 'r' : 'l'] = { sh, up, fore, hand, weapon: wm, back: bwp };
  }
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  const mats = [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun, M.grey];
  return {
    group: root,
    legsG,
    torso,
    head,
    arms,
    legs,
    nozzles,
    hipY,
    torsoY: hipY + 0.33,
    type,
    cls,
    height: (hipY + ch + 0.22 + R.headH) * scale,
    coreH: ch,
    mats,
    flashT: 0,
  };
}

export function animateMech(m, dt, st) {
  const t = st.t;
  const k = Math.min(1, dt * 14),
    ks = Math.min(1, dt * 6);
  if (m.vehicle) {
    if (m.rotor) {
      m.rotor.rotation.y += dt * 28;
    }
    if (m.tail) m.tail.rotation.x += dt * 40;
    for (const n of m.nozzles) {
      n.scale.y = lerp(n.scale.y, 1.2 + Math.random() * 0.5, 0.4);
    }
    if (m.flashT > 0) {
      m.flashT -= dt;
      if (m.flashT <= 0) for (const mm of m.mats) mm.emissive.setRGB(0, 0, 0);
    }
    if (m.cls === 'heli') {
      m.torso.rotation.x = lerp(m.torso.rotation.x, (st.leanX || 0) * 0.6, 0.1);
      m.torso.rotation.z = lerp(m.torso.rotation.z, (st.leanZ || 0) * 0.8, 0.1);
    }
    return;
  }
  // ===== 車庫展示姿勢（參考圖：重心左腳、右腳前踏外開、上身左擰、右手步槍斜指前下、左拳抬起、頭側看） =====
  if (st.pose === 'garage') {
    const P = (o, x, y, z, r = 0.12) => {
      o.rotation.x = lerp(o.rotation.x, x, r);
      o.rotation.y = lerp(o.rotation.y, y, r);
      o.rotation.z = lerp(o.rotation.z, z, r);
    };
    if (m.type === 'biped' || m.type === 'reverse') {
      for (const L of m.legs) {
        P(L.thigh, L.th * 0.3, 0, L.side * 0.14);
        P(L.knee, L.kn * 0.5, 0, 0);
        P(L.foot, L.ft * 0.5, 0, -L.side * 0.12);
      }
    } // 立正：雙腳微張、腳掌貼地
    m.legsG.rotation.z = lerp(m.legsG.rotation.z, 0, 0.12);
    m.legsG.rotation.y = lerp(m.legsG.rotation.y, 0, 0.12);
    P(m.torso, 0, 0, 0);
    m.torso.position.y = m.torsoY !== undefined ? m.torsoY : m.hipY + 0.12;
    if (m.head) P(m.head, 0.05, 0.45, -0.05);
    if (m.head) P(m.head, 0, 0, 0);
    const R = m.arms.r,
      L = m.arms.l;
    P(R.sh, 0, 0, 0.06);
    P(R.up, 0.05, 0, 0.3);
    P(R.fore, 0.35, 0, 0);
    P(L.sh, 0, 0, -0.06);
    P(L.up, 0.05, 0, -0.3);
    P(L.fore, 0.35, 0, 0); // 雙手微張自然下垂
    for (const n of m.nozzles) {
      n.scale.y = lerp(n.scale.y, 0.12, 0.2);
    }
    if (m.flashT > 0) {
      m.flashT -= dt;
      if (m.flashT <= 0) for (const mm of m.mats) mm.emissive.setRGB(0, 0, 0);
    }
    return;
  }
  const strafe = st.strafe || 0,
    turn = st.turn || 0,
    land = st.landT !== undefined ? st.landT : 9,
    aimRel = st.aimRel || 0,
    ap = clamp(st.aimPitch || 0, -0.6, 0.6);
  const fwdV = st.fwd || 0; // 前進速度比例（-1 後退 ~ 1 前進，機體座標）
  const ML = st.melee; // 近戰姿勢 {kind, ph, mirror, side}
  const squat = land < 0.35 ? Math.sin((land / 0.35) * Math.PI) * 0.6 : 0; // 落地蹲踞（0.35 s 內壓下再彈回）
  const idle = !st.moving && st.grounded && !st.boost;
  // ===== 腿：髖三軸（俯仰＝擺動、外展＝側移／落地、偏航＝轉向）＋膝＋踝兩軸 =====
  if (m.type === 'biped' || m.type === 'reverse') {
    const f = 11;
    const rev = m.type === 'reverse';
    for (const L of m.legs) {
      let th = L.th,
        kn = L.kn,
        ft = L.ft;
      let abd = 0,
        hy = 0,
        ftRoll = 0;
      if (st.grounded && st.moving) {
        const ph = t * f + (L.side > 0 ? 0 : Math.PI);
        const sw = Math.sin(ph);
        const fa = Math.max(0.35, Math.abs(fwdV));
        const sa = Math.abs(strafe);
        th += sw * 0.6 * fa * (fwdV < -0.2 ? -1 : 1);
        kn += (rev ? -0.5 : 0.55) * Math.max(0, -Math.sin(ph + 0.4));
        ft += -sw * 0.25 * fa; // 前後步伐（面向不變，後退時反向擺腿）
        abd = L.side * 0.08 + sa * 0.42 * Math.max(0, -strafe * L.side) + sa * Math.sin(ph) * 0.22 * L.side; // 側步：往側移方向那條腿張開＋交替橫跨
        hy = 0;
      } else if (!st.grounded) {
        th += rev ? -0.35 : 0.55;
        kn += rev ? 0.55 : -0.75;
        ft += 0.35;
        abd = L.side * 0.22;
        hy = L.side * 0.1;
      } // 空中：雙腿外展、微八字
      else if (st.qb) {
        th += 0.3;
        kn -= 0.3;
        abd = L.side * 0.12;
      } else if (idle) {
        th += Math.sin(t * 1.3 + L.side) * 0.03;
        abd = L.side * 0.07;
      } // 待機：微幅外展與呼吸
      th += squat * 0.55 * (rev ? -1 : 1);
      kn += squat * (rev ? 0.9 : -1.0);
      ft += squat * 0.45;
      abd += L.side * squat * 0.25; // 落地蹲踞：屈膝、張腿
      if (ML) {
        const ph = ML.ph;
        const front = L.side === (ML.mirror ? -1 : 1);
        if (ML.kind === 'spin') {
          abd = L.side * 0.35;
          th = L.th - 0.2;
          kn = L.kn - 0.2;
        } else {
          th = front ? L.th - 0.55 * (1 - ph * 0.3) : L.th + 0.5;
          kn = front ? L.kn + 0.7 * (rev ? -1 : 1) * 0.6 : L.kn - 0.1;
          abd = L.side * 0.18;
        }
      } // 弓箭步：前腳屈、後腳蹬
      ftRoll = -(st.leanZ || 0) * 0.8 - abd * 0.9; // 腳踝側傾補償，讓腳掌貼地
      L.thigh.rotation.x = lerp(L.thigh.rotation.x, th, k);
      L.thigh.rotation.z = lerp(L.thigh.rotation.z, abd, ks);
      L.thigh.rotation.y = lerp(L.thigh.rotation.y, hy, ks);
      L.knee.rotation.x = lerp(L.knee.rotation.x, kn, k);
      L.foot.rotation.x = lerp(L.foot.rotation.x, ft, k);
      L.foot.rotation.z = lerp(L.foot.rotation.z, ftRoll, ks);
    }
    // 髖部搖擺（步行時左右交替）與骨盆偏航
    m.legsG.rotation.z = lerp(m.legsG.rotation.z, st.grounded && st.moving ? Math.sin(t * f) * 0.04 : 0, ks);
    m.legsG.rotation.y = 0;
  } else if (m.type === 'quad') {
    for (const L of m.legs) {
      const ph = (L.side > 0 ? 0 : Math.PI) + (L.sz > 0 ? Math.PI / 2 : 0);
      const sw = st.grounded && st.moving ? Math.sin(t * 10 + ph) * 0.35 : 0;
      L.thigh.rotation.x = lerp(L.thigh.rotation.x, L.sz * 0.3 + sw, 0.25);
      L.thigh.rotation.z = lerp(
        L.thigh.rotation.z,
        L.side * (st.grounded ? 0.8 : 0.45) + squat * 0.2 * L.side,
        0.2,
      );
    }
  }
  m.legsG.position.y = st.grounded ? 0 : Math.sin(t * 4) * 0.05;
  // ===== 軀幹：上下起伏、蹲踞下沉、俯仰跟瞄準、步行時反向扭腰 =====
  m.torso.position.y =
    (m.torsoY !== undefined ? m.torsoY : m.hipY + 0.12) -
    squat * 0.35 +
    (st.grounded && st.moving
      ? Math.abs(Math.sin(t * 11)) * 0.06
      : idle
        ? Math.sin(t * 1.3) * 0.025
        : Math.sin(t * 3) * 0.04);
  let tX = ap * 0.25 + (st.qb ? 0.15 : 0) + squat * 0.25 + fwdV * 0.22 + (st.boost ? 0.15 : 0); // 前進時上身前傾、後退後仰
  let tZ = -strafe * 0.14 - (st.grounded && st.moving ? Math.sin(t * 11) * 0.03 : 0); // 側移時上身向移動方向傾
  let tYoff = 0; // 人形：上半身不與下半身分離扭轉（近戰招式除外）
  if (ML) {
    const ph = ML.ph,
      s = ML.mirror ? -1 : 1;
    if (ML.kind === 'spin') {
      tYoff += ph * Math.PI * 2;
      tX = 0.25;
    } else if (ML.kind === 'thrust') {
      tX = ph < 0.3 ? -0.25 : 0.45;
      tYoff += s * (ph < 0.3 ? 0.5 : -0.3);
    } else if (ML.kind === 'slam') {
      tX = ph < 0.4 ? -0.45 : 0.55;
    } else {
      tYoff += s * (ph < 0.3 ? 0.7 : -0.6 * (1 - ph));
      tX = ph < 0.3 ? -0.1 : 0.3;
    }
  }
  m.torso.rotation.x = lerp(m.torso.rotation.x, tX, ks * 1.5);
  m.torso.rotation.z = lerp(m.torso.rotation.z, tZ, ks);
  m.torsoTwist = lerp(m.torsoTwist || 0, tYoff, Math.min(1, dt * 18));
  // ===== 頭：偏航領先軀幹看向目標、俯仰跟瞄準、側傾隨機體傾斜 =====
  if (m.head) {
    m.head.rotation.order = 'YXZ';
    m.head.rotation.y = lerp(m.head.rotation.y, idle ? Math.sin(t * 0.7) * 0.12 : 0, ks);
    m.head.rotation.x = lerp(m.head.rotation.x, -ap * 0.5 + (st.boost ? 0.12 : 0), ks);
    m.head.rotation.z = lerp(m.head.rotation.z, -(st.leanZ || 0) * 0.5, ks);
  }
  // ===== 推進器火焰 =====
  const fl = st.boost ? 2.2 : st.hover ? 1.4 : !st.grounded ? 0.9 : st.moving ? 0.6 : 0.08;
  for (const n of m.nozzles) {
    n.scale.y = lerp(n.scale.y, fl * (0.8 + Math.random() * 0.4), 0.5);
    n.scale.x = n.scale.z = lerp(n.scale.x, 0.6 + fl * 0.35, 0.3);
  }
  // ===== 手臂：肩外展／內收、上臂三軸、前臂、揮擊、後座 =====
  for (const kk of ['l', 'r']) {
    const a = m.arms[kk];
    const side = kk === 'r' ? 1 : -1;
    const rec = (st.recoil && st.recoil[kk]) || 0;
    const sw = (st.swing && st.swing[kk]) || 0;
    const firing = rec > 0.05;
    let abd =
      0.12 +
      (st.boost || !st.grounded ? 0.35 : 0) +
      (st.qb ? 0.25 : 0) +
      (idle ? Math.sin(t * 1.3 + side) * 0.03 : 0) -
      (firing ? 0.1 : 0) +
      Math.max(0, sw) * 0.5; // 外展：飛行／QB 張開、開火收攏
    let twist = firing
      ? -side * 0.15
      : st.grounded && st.moving
        ? Math.sin(t * 11 + (side > 0 ? Math.PI : 0)) * 0.08
        : 0;
    let up =
      0.35 +
      ap * 0.4 +
      rec * 0.5 +
      sw * 0.9 +
      (st.grounded && st.moving && !firing
        ? Math.sin(t * 11 + (side > 0 ? Math.PI : 0)) * 0.42 - fwdV * 0.25
        : 0) -
      squat * 0.2 +
      (!st.grounded ? -0.15 : 0) +
      (st.boost && !firing ? -0.45 : 0); // 步行手臂大幅擺動、前進時武器下垂拖後、推進時雙臂後張
    let foreT =
      1.2 +
      ap * 0.6 -
      rec * 0.3 -
      sw * 0.4 +
      (!st.grounded ? 0.15 : 0) +
      (st.grounded && st.moving && !firing ? 0.25 : 0);
    if (ML) {
      const ph = ML.ph,
        s = ML.mirror ? -1 : 1;
      const active = ML.side === side || ML.kind === 'spin';
      const wind = ph < 0.3,
        hit = ph >= 0.3 && ph < 0.7;
      if (ML.kind === 'thrust') {
        if (active) {
          up = wind ? -0.6 : 1.55;
          foreT = wind ? 1.6 : 0.05;
          abd = 0.05;
          twist = 0;
        } else {
          up = 0.2;
          foreT = 1.4;
          abd = 0.6;
        }
      } else if (ML.kind === 'slam') {
        up = ph < 0.4 ? 2.6 : 0.9;
        foreT = ph < 0.4 ? 0.2 : 0.9;
        abd = 0.25;
      } else if (ML.kind === 'spin') {
        up = 1.3;
        foreT = 0.3;
        abd = 1.1;
      } else {
        if (active) {
          up = wind ? 0.9 : hit ? 1.4 : 1.0;
          foreT = wind ? 1.5 : hit ? 0.3 : 0.9;
          abd = wind ? 0.9 : 0.25;
          twist = wind ? s * 0.6 : -s * 0.5;
        } else {
          up = 0.1;
          foreT = 1.5;
          abd = 0.45;
        }
      }
    }
    a.sh.rotation.z = lerp(a.sh.rotation.z, side * abd * 0.35, ks); // 肩莢艙微抬
    a.up.rotation.order = 'ZYX';
    a.up.rotation.z = lerp(a.up.rotation.z, -side * abd, ks);
    a.up.rotation.y = lerp(a.up.rotation.y, twist, ks);
    a.up.rotation.x = lerp(a.up.rotation.x, up, 0.4);
    a.fore.rotation.x = lerp(a.fore.rotation.x, foreT, 0.4);
    a.fore.rotation.y = lerp(a.fore.rotation.y, firing ? side * 0.08 : 0, ks);
  }
  // ===== 失衡傾倒 =====
  const kd = st.knock || 0;
  if (kd > 0) {
    m.group.rotation.x = lerp(m.group.rotation.x, kd * 0.55, 0.2);
    m.group.rotation.z = lerp(m.group.rotation.z, kd * 0.25 * (st.knockSide || 1), 0.2);
    if (m.type === 'biped' || m.type === 'reverse')
      for (const L of m.legs) {
        L.thigh.rotation.x = lerp(L.thigh.rotation.x, L.th - 0.5, 0.2);
        L.knee.rotation.x = lerp(L.knee.rotation.x, L.kn + 0.4 * (m.type === 'reverse' ? -1 : 1), 0.2);
        L.thigh.rotation.z = lerp(L.thigh.rotation.z, L.side * 0.35, 0.2);
      }
  }
  if (m.flashT > 0) {
    m.flashT -= dt;
    if (m.flashT <= 0) for (const mm of m.mats) mm.emissive.setRGB(0, 0, 0);
  }
}

export function mechFlash(m, color, dur = 0.07) {
  if (!m || !m.mats) return;
  m.flashT = dur;
  const c = color !== undefined ? new THREE.Color(color) : new THREE.Color(0.9, 0.9, 0.9);
  for (const mm of m.mats) mm.emissive.copy(c);
}
