// ---------------- WEAPONS（Q 版：粗大方塊化） ----------------
import { clamp, lerp } from '../core/math.js';
import { START_ASM, asmParts, partById } from '../data/parts.js';
import {
  CB,
  OUTLINE_MAT,
  P,
  bakeAll,
  decal,
  gBox,
  gCyl,
  gFrustum,
  gPod,
  gPlate,
  gSph,
  kitBolts,
  kitCable,
  kitGrille,
  kitPiston,
  kitVents,
  sideProfile,
} from './geometry.js';
import { mechMats } from './materials.js';
import { jointSetting, resolveConn, withJoints } from './mech-joints.js';
import { matsOf } from './glb.js';
import { providedModel } from './model-provider.js';
import { tagStyle } from './style/shader.js';
// 受擊閃光結束後還原的自發光（GLB 材質記錄在 userData.emis0，程式材質為黑）
const BLACK = new THREE.Color(0);
const unflash = (m) => {
  for (const mm of m.mats) mm.emissive.copy(mm.userData.emis0 || BLACK);
};

// 武器的機匣：切角截面沿 Z 放樣（兩端收小），w×h×l，中心 (x, y, z)
function recv(node, m, w, h, l, x = 0, y = 0, z = 0, k = 0.18) {
  const c = Math.min(w, h) * k,
    e = Math.min(0.12, l * 0.15);
  P(
    node,
    gPod([
      [-l / 2, w * 0.86, -h * 0.42, h * 0.44, c, c],
      [-l / 2 + e, w, -h / 2, h / 2, c, c],
      [l / 2 - e, w, -h / 2, h / 2, c, c],
      [l / 2, w * 0.9, -h * 0.45, h * 0.45, c, c],
    ]),
    m,
    x,
    y,
    z,
  );
}
// 沿 Z 的圓管（z0→z1）
function tube(node, m, r0, r1, z0, z1, x = 0, y = 0, seg = 10) {
  // 圓柱的頂面（radiusTop）轉到 −z 那一端
  const [rt, rb] = z1 < z0 ? [r1, r0] : [r0, r1];
  P(node, gCyl(rt, rb, Math.abs(z1 - z0), seg), m, x, y, (z0 + z1) / 2, -Math.PI / 2);
}
// 側面的散熱縫（武器用，沿 Z 排列、平貼在 x 面上）
function sideSlits(node, M, x, y, z, n, gap = 0.12, h = 0.12) {
  for (let i = 0; i < n; i++) P(node, gBox(0.02, h, 0.04), M.joint, x, y, z - i * gap);
}
// 握把：往後斜的側面輪廓
function grip(node, m, y, z, w = 0.22) {
  P(
    node,
    gPlate(
      sideProfile([
        [z - 0.1, y],
        [z + 0.12, y],
        [z + 0.22, y - 0.4],
        [z + 0.02, y - 0.42],
      ]),
      w,
      0.03,
    ),
    m,
    0,
    0,
    0,
    0,
    Math.PI / 2,
    0,
  );
}
// 尖端的刃（側面輪廓沿 X 擠出）：從 z0 往前到 z1（z1 < z0），高 h，尖端在上緣
function bladeShape(node, m, z0, z1, h, t, y = 0) {
  P(
    node,
    gPlate(
      sideProfile([
        [z0, y - h / 2],
        [z1 + h * 0.6, y - h / 2],
        [z1, y + h * 0.35],
        [z1 + h * 0.3, y + h / 2],
        [z0, y + h / 2],
      ]),
      t,
      Math.min(0.02, t / 3),
    ),
    m,
    0,
    0,
    0,
    0,
    Math.PI / 2,
    0,
  );
}

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
  const PI2 = Math.PI / 2;
  switch (w.id) {
    case 'w_rifle': // 長步槍：切角機匣、八角護木、槍管與制退器、導軌與瞄準鏡、往前斜的彈匣、槍托
      recv(node, G, 0.42, 0.5, 1.4, 0, 0, -0.2);
      P(
        node,
        gPod([
          [-2.7, 0.26, -0.15, 0.17, 0.07, 0.07],
          [-2.6, 0.3, -0.17, 0.19, 0.08, 0.08],
          [-0.85, 0.32, -0.18, 0.2, 0.08, 0.08],
        ]),
        G,
        0,
        0.02,
        0,
      );
      sideSlits(node, M, 0.16 * side, 0.03, -1.2, 6, 0.2, 0.1);
      tube(node, S, 0.07, 0.07, -2.7, -3.0);
      P(
        node,
        gPod([
          [-3.2, 0.2, -0.1, 0.1, 0.05, 0.05],
          [-2.95, 0.22, -0.11, 0.11, 0.05, 0.05],
        ]),
        S,
        0,
        0.02,
        0,
      );
      for (let i = 0; i < 3; i++) P(node, gBox(0.24, 0.05, 0.03), M.joint, 0, 0.02, -3.0 - i * 0.07);
      P(node, gBox(0.2, 0.06, 1.6), A, 0, 0.29, -1.2);
      for (let i = 0; i < 8; i++) P(node, gBox(0.24, 0.03, 0.05), A, 0, 0.33, -0.5 - i * 0.2);
      tube(node, S, 0.09, 0.09, -0.85, -0.3, 0, 0.45, 8); // 瞄準鏡
      tube(node, M.lens, 0.07, 0.07, -0.87, -0.85, 0, 0.45, 8);
      P(node, gBox(0.08, 0.1, 0.12), S, 0, 0.36, -0.6);
      P(
        node,
        gPlate(
          sideProfile([
            [-0.48, -0.2],
            [-0.16, -0.2],
            [-0.22, -0.66],
            [-0.5, -0.62],
          ]),
          0.26,
          0.03,
        ),
        S,
        0,
        0,
        0,
        0,
        PI2,
        0,
      );
      grip(node, S, -0.22, 0.05);
      P(
        node,
        gPlate(
          sideProfile([
            [0.45, 0.2],
            [1.12, 0.14],
            [1.12, -0.22],
            [0.9, -0.26],
            [0.45, -0.1],
          ]),
          0.3,
          0.04,
        ),
        G,
        0,
        0,
        0,
        0,
        PI2,
        0,
      );
      P(node, gBox(0.32, 0.38, 0.06), M.rubber, 0, -0.04, 1.14);
      kitBolts(node, M, [
        [0.22 * side, 0.1, -0.3, 0, PI2],
        [0.22 * side, -0.1, -0.6, 0, PI2],
        [0.22 * side, 0.1, 0.3, 0, PI2],
      ]);
      decal(node, 2, 0.3, 0.3, 0.215 * side, 0.0, -0.75, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_mg': // 機關槍：切角機匣、側面彈箱、帶散熱孔的槍管護套、提把、頂部散熱片
      recv(node, G, 0.46, 0.5, 1.2, 0, 0, -0.2);
      P(
        node,
        gPod([
          [-0.3, 0.42, -0.22, 0.16, 0.05, 0.08],
          [0.3, 0.44, -0.24, 0.18, 0.05, 0.08],
        ]),
        S,
        0.3 * side,
        -0.05,
        0,
      );
      P(node, gBox(0.02, 0.2, 0.4), A, 0.52 * side, -0.05, 0);
      tube(node, G, 0.2, 0.18, -0.75, -2.05, 0, 0.02);
      for (let i = 0; i < 4; i++)
        tube(node, M.joint, 0.205, 0.205, -0.95 - i * 0.28, -1.0 - i * 0.28, 0, 0.02);
      for (let i = 0; i < 3; i++) tube(node, S, 0.15, 0.15, -1.05 - i * 0.28, -1.15 - i * 0.28, 0, 0.02);
      tube(node, S, 0.08, 0.08, -2.0, -2.5, 0, 0.02, 8);
      tube(node, S, 0.12, 0.1, -2.45, -2.62, 0, 0.02, 8);
      P(node, gBox(0.06, 0.06, 0.6), S, 0, 0.42, -0.3); // 提把
      for (const z of [-0.6, 0]) P(node, gBox(0.06, 0.16, 0.06), S, 0, 0.33, z);
      for (let i = 0; i < 4; i++) P(node, gBox(0.44, 0.03, 0.12), A, 0, 0.27, -0.35 - i * 0.2);
      grip(node, S, -0.22, 0.25);
      decal(node, 0, 0.22, 0.22, 0.236 * side, 0.05, -0.4, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_sg': // 霰彈槍：機匣、上下兩根槍管、方形的槍口護罩、泵動護木、握把
      recv(node, G, 0.42, 0.44, 1.1, 0, 0, -0.2);
      tube(node, S, 0.15, 0.15, -0.65, -1.8, 0, 0.1);
      tube(node, S, 0.13, 0.13, -0.65, -1.8, 0, -0.1);
      P(
        node,
        gPod([
          [-2.0, 0.36, -0.26, 0.28, 0.08, 0.08],
          [-1.7, 0.4, -0.28, 0.3, 0.09, 0.09],
        ]),
        A,
      );
      tube(node, M.joint, 0.1, 0.1, -2.0, -2.02, 0, 0.1);
      P(
        node,
        gPod([
          [-1.35, 0.32, -0.3, -0.06, 0.06, 0.06],
          [-0.95, 0.34, -0.31, -0.05, 0.06, 0.06],
        ]),
        S,
      );
      for (let i = 0; i < 4; i++) P(node, gBox(0.36, 0.03, 0.04), M.joint, 0, -0.31, -1.0 - i * 0.1);
      grip(node, S, -0.2, 0.15);
      kitBolts(node, M, [[0.215 * side, 0.1, -0.4, 0, PI2]]);
      break;
    case 'w_lsg':
      // 雷射霰彈槍：短粗的槍身、發光的散射口、上方的能量導管
      recv(node, G, 0.44, 0.46, 1.1, 0, 0, -0.2);
      recv(node, S, 0.34, 0.3, 0.9, 0, 0.04, -1.1);
      P(node, gFrustum(0.36, 0.56, 0.3, 0.5, 0.3), S, 0, 0.04, -1.7, PI2);
      P(node, gPlate(rect(0.26, 0.08), 0.68, 0.02), glow, 0, 0.23, -1.0);
      for (let i = 0; i < 4; i++) P(node, gBox(0.32, 0.03, 0.04), A, 0, 0.27, -0.75 - i * 0.16);
      tube(node, glow, 0.16, 0.16, -1.83, -1.89, 0, 0.04);
      sideSlits(node, M, 0.22 * side, 0, -0.1, 4, 0.12);
      grip(node, S, -0.22, 0.1);
      break;
    case 'w_gl':
      // 手持榴彈槍：粗短的砲管與彈鼓
      recv(node, G, 0.46, 0.48, 1.0, 0, 0, -0.1);
      tube(node, S, 0.22, 0.22, -0.4, -1.4, 0, 0.08, 12);
      tube(node, A, 0.26, 0.26, -1.33, -1.47, 0, 0.08, 12);
      tube(node, M.joint, 0.17, 0.17, -1.47, -1.49, 0, 0.08, 12);
      tube(node, red, 0.2, 0.2, -1.45, -1.48, 0, 0.08, 12);
      P(node, gCyl(0.3, 0.3, 0.3, 10), A, 0.3 * side, -0.1, -0.1, 0, 0, PI2);
      P(node, gCyl(0.12, 0.12, 0.34, 8), M.joint, 0.3 * side, -0.1, -0.1, 0, 0, PI2);
      grip(node, S, -0.22, 0.2);
      break;
    case 'w_bz': // 火箭筒：八角砲身、喇叭狀砲口、瞄準器、後方噴射口
      P(
        node,
        gPod([
          [-1.6, 0.46, -0.17, 0.29, 0.13, 0.13],
          [0.6, 0.5, -0.19, 0.31, 0.14, 0.14],
        ]),
        G,
      );
      tube(node, S, 0.3, 0.34, -1.6, -2.0, 0, 0.06);
      tube(node, M.joint, 0.27, 0.27, -2.0, -2.02, 0, 0.06);
      tube(node, red, 0.28, 0.28, -1.97, -2.0, 0, 0.06);
      tube(node, A, 0.24, 0.3, 0.6, 0.85, 0, 0.06);
      for (const z of [-1.2, -0.2, 0.4]) tube(node, A, 0.27, 0.27, z, z - 0.06, 0, 0.06, 8);
      recv(node, S, 0.18, 0.4, 0.7, 0.32 * side, 0.1, -0.3);
      tube(node, M.lens, 0.06, 0.06, -0.66, -0.68, 0.32 * side, 0.18, 8);
      grip(node, S, -0.18, -0.3);
      decal(node, 2, 0.32, 0.32, 0.255 * side, 0.06, -0.9, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_hg': // 手槍：機匣、滑套、往後斜的握把、槍口
      recv(node, G, 0.3, 0.36, 0.9, 0, 0, -0.25);
      recv(node, S, 0.2, 0.18, 0.5, 0, 0.06, -0.9);
      tube(node, A, 0.12, 0.12, -1.12, -1.28, 0, 0.06);
      tube(node, M.joint, 0.07, 0.07, -1.28, -1.3, 0, 0.06);
      grip(node, S, -0.16, -0.08, 0.24);
      P(node, gBox(0.26, 0.05, 0.6), A, 0, 0.2, -0.4);
      sideSlits(node, M, 0.15 * side, 0.08, -0.3, 3, 0.1, 0.08);
      break;
    case 'w_emp':
      recv(node, G, 0.4, 0.46, 1.3, 0, 0, -0.2);
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
      tube(node, S, 0.08, 0.08, -0.7, -2.1, 0, 0.02, 8);
      for (const z of [-0.85, -1.95]) P(node, gPlate(rect(0.1, 0.5), 0.06, 0.015), S, 0, 0.02, z);
      P(node, gSph(0.12, 8), glow, 0, 0.02, -2.1);
      recv(node, S, 0.3, 0.24, 0.5, 0, -0.34, -0.1);
      grip(node, S, -0.25, 0.2);
      break;
    case 'w_lr': // 雷射步槍：長機匣、發光的導光部、放射口、上方散熱片、下方電池
      recv(node, G, 0.42, 0.52, 1.6, 0, 0, -0.3);
      P(node, gPlate(trap(0.22, 0.16, 0.18), 1.2, 0.03), glow, 0, 0.02, -1.7);
      for (const s2 of [-1, 1]) P(node, gPlate(rect(0.05, 0.3), 1.1, 0.015), S, s2 * 0.15, 0.02, -1.7);
      P(node, gFrustum(0.4, 0.6, 0.3, 0.5, 0.4), S, 0, 0.02, -2.4, PI2);
      tube(node, glow, 0.1, 0.1, -2.6, -2.62, 0, 0.02, 8);
      for (let i = 0; i < 4; i++) P(node, gBox(0.56, 0.03, 0.18), A, 0, 0.29, -0.4 - i * 0.28);
      recv(node, S, 0.4, 0.22, 0.6, 0, -0.36, -0.3);
      P(node, gBox(0.3, 0.02, 0.4), glow, 0, -0.475, -0.3);
      grip(node, S, -0.25, 0.25);
      kitCable(node, M, [
        [0, 0.3, 0.3],
        [0.2 * side, 0.42, 0.6],
        [0, 0.25, 0.9],
      ]);
      break;
    case 'w_lc': // 雷射砲：大型切角砲身、發光砲口、後部發電單元、散熱片
      recv(node, G, 0.56, 0.56, 2.4, 0, 0.05, -0.6);
      P(
        node,
        gPod([
          [-2.6, 0.22, -0.06, 0.16, 0.05, 0.05],
          [-1.8, 0.28, -0.09, 0.19, 0.06, 0.06],
        ]),
        glow,
      );
      tube(node, S, 0.2, 0.2, -1.82, -1.86, 0, 0.05);
      recv(node, S, 0.6, 0.6, 0.9, 0, 0.05, 0.4);
      for (let i = 0; i < 5; i++) P(node, gBox(0.66, 0.03, 0.14), A, 0, 0.38, -0.5 - i * 0.3);
      sideSlits(node, M, 0.31 * side, 0.05, 0.6, 4, 0.12, 0.3);
      decal(node, 3, 0.36, 0.36, 0.285 * side, 0.05, -0.6, 0, (side * Math.PI) / 2, 0);
      break;
    case 'w_blade': // 近戰刀：握柄、護手、帶刀背的發光刀刃（尖端）
      recv(node, G, 0.32, 0.36, 0.8, 0, 0, 0);
      recv(node, A, 0.4, 0.44, 0.24, 0, 0, -0.4);
      bladeShape(node, S, -0.5, -2.5, 0.22, 0.14);
      bladeShape(node, glow, -0.5, -2.55, 0.44, 0.08);
      break;
    case 'w_saber':
      recv(node, G, 0.36, 0.4, 0.9, 0, 0, 0.1);
      recv(node, A, 0.6, 0.6, 0.22, 0, 0, -0.4);
      bladeShape(node, S, -0.5, -3.2, 0.22, 0.16);
      bladeShape(node, glow, -0.5, -3.3, 0.6, 0.1);
      recv(node, S, 0.14, 0.14, 0.6, 0, 0, 0.7);
      break;
    case 'w_claw':
      recv(node, G, 0.4, 0.4, 0.8, 0, 0, 0);
      for (const o of [-0.16, 0, 0.16]) {
        P(node, gBox(1, 1, 1), S, o, 0.05, -0.5, 0, 0, 0, 0.1, 0.2, 0.6);
        P(
          node,
          gPlate(
            sideProfile([
              [-0.5, -0.04],
              [-1.5, 0.02],
              [-1.7, 0.12],
              [-1.4, 0.1],
              [-0.5, 0.08],
            ]),
            0.07,
            0.015,
          ),
          glow,
          o,
          0.05,
          0,
          0,
          PI2,
          0,
        );
      }
      P(node, gPlate(trap(0.46, 0.4, 0.16), 0.4, 0.03), A, 0, 0.24, -0.2);
      break;
    case 'w_pile':
      recv(node, G, 0.5, 0.54, 1.3, 0, 0, -0.1);
      tube(node, S, 0.2, 0.2, -0.5, -1.5, 0, 0, 10);
      for (const z of [-0.7, -1.1]) tube(node, A, 0.23, 0.23, z, z - 0.06, 0, 0, 10);
      tube(node, glow, 0.08, 0.04, -1.3, -2.2, 0, 0, 6);
      recv(node, A, 0.56, 0.6, 0.5, 0, 0, 0.6);
      kitPiston(node, M, 0.26 * side, -0.2, 0.3, 0.26 * side, -0.15, -0.8, 0.05);
      decal(node, 2, 0.4, 0.4, 0.255 * side, 0.0, -0.1, 0, (side * Math.PI) / 2, 0);
      break;
    case 'bw_ms':
    case 'bw_ms8':
    case 'bw_pm':
      {
        const n = w.id === 'bw_ms8' ? 3 : 2;
        const tip = w.id === 'bw_pm' ? glow : red; // 電漿導彈：發光的彈頭
        const W = 0.36 * n + 0.2,
          H = 0.36 * n + 0.2;
        recv(node, G, W, H, 1.1, 0, 0, 0, 0.12);
        P(node, gPlate(rect(W - 0.06, H - 0.06), 0.06, 0.02), M.joint, 0, 0, -0.55);
        for (let i = 0; i < n; i++)
          for (let j = 0; j < n; j++) {
            const x = (i - (n - 1) / 2) * 0.36,
              y = (j - (n - 1) / 2) * 0.36;
            P(node, gPlate(rect(0.3, 0.3), 0.06, 0.02), S, x, y, -0.58);
            tube(node, M.joint, 0.12, 0.12, -0.6, -0.62, x, y, 8);
            tube(node, tip, 0.06, 0.1, -0.6, -0.66, x, y, 8);
          }
        P(node, gBox(W + 0.04, 0.06, 1.14), A, 0, H / 2, 0);
        sideSlits(node, M, (W / 2 + 0.005) * side, 0, 0.4, 3, 0.1, H * 0.5);
        decal(node, 3, 0.4, 0.4, W / 2 + 0.01, 0, 0.0, 0, PI2, 0);
      }
      break;
    case 'bw_gr':
      recv(node, G, 0.6, 0.56, 1.0, 0, 0, 0.2);
      tube(node, G, 0.28, 0.28, 0.2, -1.2, 0, 0.1, 12);
      tube(node, A, 0.34, 0.34, -1.1, -1.3, 0, 0.1, 12);
      tube(node, M.joint, 0.24, 0.24, -1.3, -1.32, 0, 0.1, 12);
      tube(node, red, 0.26, 0.26, -1.29, -1.33, 0, 0.1, 12);
      for (const z of [-0.3, -0.7]) tube(node, S, 0.3, 0.3, z, z - 0.08, 0, 0.1, 12);
      sideSlits(node, M, 0.3 * side, 0, 0.4, 4, 0.12, 0.3);
      break;
    case 'bw_lc':
      recv(node, S, 0.5, 0.5, 1.0, 0, 0.05, 0.4);
      recv(node, G, 0.36, 0.36, 2.4, 0, 0.1, -0.7, 0.22);
      P(node, gPlate(trap(0.14, 0.1, 0.12), 0.6, 0.02), glow, 0, 0.1, -2.1);
      tube(node, S, 0.14, 0.2, -1.8, -1.9, 0, 0.1, 8);
      for (let i = 0; i < 5; i++) P(node, gBox(0.46, 0.03, 0.12), A, 0, 0.3, -0.2 - i * 0.3);
      break;
    case 'bw_sh':
      P(
        node,
        gPlate(
          [
            [-0.5, -0.6],
            [0.4, -0.6],
            [0.5, -0.45],
            [0.5, 0.6],
            [-0.4, 0.6],
            [-0.5, 0.45],
          ],
          0.14,
          0.04,
        ),
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
      recv(node, S, 0.4, 0.5, 0.4, 0, 0, 0.1);
      kitPiston(node, M, 0, 0.1, 0.1, side * 0.3, 0.1, -0.15, 0.05);
      break;
    case 'bw_emp_s':
    case 'bw_emp_l':
      {
        const big = w.id === 'bw_emp_l';
        const R = big ? 0.42 : 0.32;
        P(
          node,
          gPod([
            [-R, R * 1.6, 0, R * 1.6, R * 0.3, R * 0.1],
            [R, R * 2, 0, R * 1.6, R * 0.4, R * 0.1],
          ]),
          S,
          0,
          -R * 0.8,
          0,
        );
        for (let i = 0; i < 3; i++)
          P(
            node,
            new THREE.TorusGeometry(R * (1.1 + i * 0.25), 0.05, 6, 20),
            i % 2 ? glow : A,
            0,
            R * 0.6 + i * 0.28,
            0,
            PI2,
          );
        P(node, gCyl(0.06, 0.06, R * 2.6, 6), M.joint, 0, R * 1.3, 0);
        for (let i = 0; i < 3; i++) P(node, gCyl(0.1, 0.1, 0.04, 8), S, 0, R * 0.6 + i * 0.28, 0);
        P(node, gSph(R * 0.35, 8), glow, 0, R * 2.7, 0);
      }
      break;
    case 'bw_gat':
      recv(node, G, 0.6, 0.56, 1.1, 0, 0.05, 0.2);
      recv(node, S, 0.5, 0.34, 0.5, 0.4 * side, 0, 0.3);
      for (let i = 0; i < 4; i++) {
        const bx = Math.cos(i * 1.57 + 0.78) * 0.14,
          by = 0.05 + Math.sin(i * 1.57 + 0.78) * 0.14;
        tube(node, S, 0.09, 0.09, -0.4, -1.8, bx, by, 8);
        tube(node, red, 0.06, 0.06, -1.8, -1.84, bx, by, 8);
      }
      tube(node, M.joint, 0.08, 0.08, -0.4, -1.75, 0, 0.05, 8);
      for (const z of [-1.6, -1.1]) tube(node, A, 0.26, 0.26, z, z - 0.1, 0, 0.05, 10);
      tube(node, A, 0.26, 0.26, -0.4, -0.56, 0, 0.05, 10);
      break;
  }
}

// ---------------- MECH v7 的幾何（程式模型的造型以這組數值建立；實際比例見下方的 LAY／PIECE_BOX（內建預設機甲）） ----------------
// v7 原本的二足站立：腳踝 0.30、膝 1.12、髖 1.94、腰 2.22、胸頂 3.15、頭 3.02～3.33；肩甲外緣寬約 1.9
// 所有零件共用這組比例，只有裝備與貼花不同
const CUBE = {
  hipY: 1.94, // 髖關節高（二足）
  hipX: 0.34,
  waistUp: 0.28, // 腰（核心座）在髖關節上方多少
  thighL: 0.82,
  thighW: 0.26,
  shinL: 0.82,
  shinW: 0.34,
  ankleH: 0.3, // 腳踝離地
  footL: 0.72,
  footW: 0.38,
  pelvisW: 0.4,
  pelvisH: 0.42,
  pelvisD: 0.46,
  tw: 0.88, // 胸寬
  td: 0.62, // 胸深
  cx: 0.36, // 胸部中央柱寬
  chestTop: 0.93, // 左右胸塊頂（相對腰部）
  neckY: 0.8, // 脖子（中央柱頂，相對腰部）
  shX: 0.5, // 肩關節（相對腰部）
  shY: 0.63,
  padW: 0.5, // 肩甲
  padH: 0.6,
  padD: 0.55,
  upL: 0.48,
  upW: 0.26,
  foreL: 0.52,
  foreW: 0.4,
  fist: 0.3,
  headW: 0.25,
  headH: 0.31,
  headD: 0.3,
  upperH: 0.86, // 腰到判定頂端（遊戲判定身高＝腰高＋此值）
}; // 量自參考圖正視圖（1 px ≈ 0.00431 m，頭頂 3.33）；各區塊程式模型的幾何以這組數值建立

// ---------------- 機甲比例：內建的玩家預設機甲（src/assets/player-mech/） ----------------
// 所有機甲（程式模型、各種零件型號）都照內建預設機甲的比例；之後改機甲的比例或新增零件也以它為準。
// - 骨架（LAY、連接點預設值）＝ src/assets/player-mech/joints.json（換成遊戲座標）：
//   二足站立 腳踝 0.39、膝 1.32、髖 1.93（±0.345）、腰 2.14、肩關節 3.00（±0.656）、脖子 2.93，
//   上臂（肩→肘）0.59、前臂（肘→腕）0.65、大腿 0.61、小腿 0.93
// - 外形（PIECE_BOX）：每種區塊的程式模型逐軸、正負兩側分開變形，讓標準零件（h_std、c_std、a_std、l_bp）
//   的外框對齊內建 GLB 的外框（區塊座標，原點＝旋轉中心）；其他型號的零件套同一組變形，保留彼此的差異
// 程式模型的幾何仍以 v7 的 CUBE 建立；碰撞與判定用 LAY 的數值
const LAY = {
  hipY: 1.932,
  hipX: 0.345,
  thighL: 0.6077,
  shinL: 0.9344,
  waistUp: 0.207, // 腰（核心座）在髖關節上方多少：腰 2.139
  upperH: 1.1, // 腰到判定頂端：判定身高 3.24（外觀：頭頂 3.31、胸頂 3.49）
};
LAY.ankleH = +(LAY.hipY - LAY.thighL - LAY.shinL).toFixed(4); // 0.3899
// 內建預設機甲的連接點（遊戲座標，右側；左側 x 取負）
const JOINT = {
  neck: [0, 0.7935, -0.069],
  backpack: [0, 0.621, 0.552],
  shoulder: [0.6555, 0.8625, 0.0518],
  back: [0.6555, 1.1902, 0.138],
  elbow: [0, -0.5903, 0],
  wrist: [0, -0.6466, 0],
  grip: [-0.0205, -0.1149, 0.0048],
};
// 逆關節腳（四段：大腿 → 膝 → 小腿 → 跗關節 → 蹠骨 → 腳踝 → 腳掌）的骨架＝內建 GLB（LG-KASUAR）的 joints.json，
// 遊戲座標、右側（左側 x 取負）。靜止姿勢＝所有關節角度 0（站姿本身就是彎的，GLB 不轉正）
const REV = {
  hipY: 1.8975,
  knee: [0.1725, -0.6555, -0.1725], // 膝在大腿前下方
  hock: [0.0518, -0.4313, 0.345], // 跗關節在小腿後下方（逆折）
  ankle: [0.1208, -0.4312, 0.138],
};
REV.ankleH = +(REV.hipY + REV.knee[1] + REV.hock[1] + REV.ankle[1]).toFixed(4); // 0.3795
// 四足（LG-SPIDER）的骨架＝內建 GLB 的 joints.json（遊戲座標，左側的腳 x 取 −、右側取 +；f＝前腳、b＝後腳）。
// 靜止姿勢＝所有關節角度 0（GLB 的姿勢就是待機姿勢）；每隻腳 大腿 →（膝）→ 小腿 →（腳踝）→ 腳掌
const QD = {
  waist: [0, 1.85, 0.201], // 核心座比基座頂面（約 1.97）低一點，上半身和基座稍微重疊
  hip: { f: [0.7142, 1.5341, -0.3703], b: [0.7935, 1.296, 0.238] },
  knee: { f: [0.2962, -0.1957, -0.9787], b: [0.4814, 0.4073, 0.9099] },
  ankle: { f: [0.0846, -0.9152, -0.5184], b: [0.6771, -1.1532, 0.7353] },
};
// 坦克（LG-TANK）的腰（核心座）＝內建 GLB 的 joints.json（遊戲座標）：砲塔座的頂面稍微往下，上半身壓進一點；
// 整台比二足矮（和四足同倍率的車體，頭頂約 2.5 m）
const TK = { waist: [0, 1.3013, 0.3597] };
const qdV = (a, sx) => V(sx * a[0], a[1], a[2]); // 左側（sx −1）x 為負
const qdLeg = (key) => QUAD_LEGS.find((q) => q[0] === key); // [key, sx, sz]（sz −1＝前腳）
const qdFB = (key) => (key[0] === 'f' ? 'f' : 'b');
// 蹠骨的角度和膝連動：膝多彎 1 rad，蹠骨往前折 HOCK_K rad（鳥腿式的逆關節）
export const HOCK_K = 0.9;
// 逆關節（四段）的 GLB 站姿兩腳往外斜：走路時大腿往內收（rad），腳踝的側傾補償讓腳掌照樣貼地
const WALK_IN = 0.13;
// [v7 程式模型的外框, 內建 GLB 的外框]（右側的區塊；[minX, minY, minZ, maxX, maxY, maxZ]，量自程式模型與 GLB）
// 襠部只對齊寬與深（高度由 LAY 決定）；腳掌的底面對齊腳踝高度，程式模型剛好站在地上
const PIECE_BOX = {
  head: [
    [-0.17, -0.02, -0.18, 0.17, 0.345, 0.17],
    [-0.11, -0.04, -0.33, 0.11, 0.33, 0.17],
  ],
  core: [
    [-0.53, -0.07, -0.39, 0.53, 0.95, 0.34],
    [-0.56, -0.1, -0.68, 0.56, 1.12, 0.55], // 上緣對齊正面胸甲（GLB 的外框頂 1.31 是背面與肩部的零件，照它會把頭埋住）
  ],
  upper: [
    [-0.14, -0.47, -0.3, 0.47, 0.5, 0.28],
    [-0.22, -0.69, -0.2, 0.29, 0.25, 0.21],
  ],
  fore: [
    [-0.22, -0.5, -0.24, 0.33, 0.1, 0.21],
    [-0.18, -0.66, -0.16, 0.15, 0.24, 0.3],
  ],
  hand: [
    [-0.11, -0.32, -0.12, 0.16, 0.04, 0.12],
    [-0.15, -0.25, -0.13, 0.09, 0.01, 0.12],
  ],
  pelvis: [
    [-0.29, 1, -0.34, 0.29, 1, 0.33],
    [-0.22, 1, -0.46, 0.22, 1, 0.5],
  ],
  thigh: [
    [-0.17, -0.79, -0.23, 0.32, 0.2, 0.21],
    [-0.31, -0.88, -0.45, 0.24, 0.14, 0.53],
  ],
  shin: [
    [-0.19, -0.79, -0.27, 0.31, 0.25, 0.3],
    [-0.27, -1.09, -0.55, 0.33, 0.32, 0.28],
  ],
  foot: [
    [-0.19, -0.3, -0.49, 0.19, 0.1, 0.31],
    [-0.29, -0.39, -0.62, 0.31, 0.16, 0.68],
  ],
};
// 區塊的變形倍率 [x−, y−, z−, x+, y+, z+]（左側的區塊 x 兩側對調）；沒有變形時回傳 null
function pieceDeform(info) {
  if (info.cat === 'legs' && info.legType !== 'biped') return null; // 逆關節的程式模型直接照 REV 的骨架建立
  const b = PIECE_BOX[info.kind];
  if (!b) return null;
  const k = b[0].map((v, i) => b[1][i] / v);
  return info.side < 0 ? [k[3], k[1], k[2], k[0], k[4], k[5]] : k;
}
// 把程式模型（已合併成網格）變形到內建預設機甲的外框：位置依所在的那一側乘倍率，法線乘倒數後正規化
function deformPiece(g, k) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const m = new THREE.Matrix4(),
    nm = new THREE.Matrix3(),
    v = new THREE.Vector3(),
    n = new THREE.Vector3();
  const meshes = [];
  g.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.attributes.position) meshes.push(o);
  });
  for (const o of meshes) {
    m.multiplyMatrices(inv, o.matrixWorld);
    nm.getNormalMatrix(m);
    const geo = o.geometry.clone();
    const pos = geo.attributes.position,
      nor = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const kx = v.x < 0 ? k[0] : k[3],
        ky = v.y < 0 ? k[1] : k[4],
        kz = v.z < 0 ? k[2] : k[5];
      pos.setXYZ(i, v.x * kx, v.y * ky, v.z * kz);
      if (nor) {
        n.fromBufferAttribute(nor, i).applyMatrix3(nm);
        n.set(n.x / kx, n.y / ky, n.z / kz).normalize();
        nor.setXYZ(i, n.x, n.y, n.z);
      }
    }
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    o.geometry = geo;
    // 網格改成直接掛在區塊底下、單位變換
    if (o.parent !== g) g.add(o);
    o.position.set(0, 0, 0);
    o.rotation.set(0, 0, 0);
    o.scale.set(1, 1, 1);
  }
  for (const c of [...g.children]) if (!c.isMesh) g.remove(c);
}

// ===== 區塊（piece）=====
// 機甲由一塊塊「區塊」組成，每塊都可以單獨換成 GLB；區塊的原點＝它的旋轉中心（接到父區塊的位置）。
// 父區塊上的「連接點」決定子區塊接在哪裡（例：核心決定肩、脖子；上臂決定手肘）。連接點預設值在
// pieceConns()，可被關節設定（mech-joints.js）覆寫。槽位 id：
//   head/<id>、core/<id>、booster/<id>
//   arms/<id>/<r|l>_<upper|fore|hand>
//   legs/<id>/pelvis＋<r|l>_<thigh|shin|foot>（二足）、＋<r|l>_meta（逆關節的蹠骨）、legs/<id>/body＋<fl|fr|bl|br>_<thigh|shin>（四足）、
//   legs/<id>/body（履帶）
//   weapon/<id>/<r|l>、back/<id>/<r|l>
const SIDE_OF = { r: 1, l: -1 };
const QUAD_LEGS = [
  ['fl', -1, -1],
  ['fr', 1, -1],
  ['bl', -1, 1],
  ['br', 1, 1],
];
export const PIECE_NAMES = {
  head: '頭',
  core: '核心',
  booster: '背包',
  upper: '上臂（含肩甲）',
  fore: '前臂',
  hand: '手',
  pelvis: '襠部',
  body: '主體',
  thigh: '大腿',
  shin: '小腿',
  meta: '蹠骨',
  qshin: '小腿',
  qfoot: '腳掌',
  foot: '腳掌',
  weapon: '手持武器',
  back: '肩上武器',
};
// 各區塊 GLB 的原點位置（＝旋轉中心）
export const PIECE_ORIGIN = {
  head: '脖子轉軸（頭部底面中心）',
  core: '腰部（核心底部坐在襠部上的點）',
  booster: '背包座（背包中心）',
  upper: '肩關節轉軸',
  fore: '手肘轉軸',
  hand: '手腕轉軸',
  pelvis: '地面中心（兩腳之間的地面）',
  body: '地面中心',
  thigh: '髖關節轉軸',
  shin: '膝關節轉軸',
  meta: '跗關節轉軸',
  qshin: '膝關節轉軸',
  qfoot: '腳踝轉軸',
  foot: '腳踝轉軸',
  weapon: '握把（手的握點）',
  back: '肩上武器座',
};
export const SIDE_NAMES = { r: '右', l: '左', fl: '左前', fr: '右前', bl: '左後', br: '右後' };
export const CONN_NAMES = {
  neck: '脖子',
  shoulder_r: '右肩',
  shoulder_l: '左肩',
  backpack: '背包座',
  back_r: '右肩上武器座',
  back_l: '左肩上武器座',
  waist: '腰（核心座）',
  hip_r: '右髖',
  hip_l: '左髖',
  hip_fl: '左前髖',
  hip_fr: '右前髖',
  hip_bl: '左後髖',
  hip_br: '右後髖',
  knee: '膝',
  hock: '跗關節',
  ankle: '腳踝',
  elbow: '手肘',
  wrist: '手腕',
  grip: '武器握點',
  nozzle_l: '左噴口',
  nozzle_r: '右噴口',
};

const pieceInfo = (slot, cat, part, kind, key = null, extra = {}) => ({
  slot,
  cat,
  part,
  kind,
  key,
  side: key ? (SIDE_OF[key] ?? (key[1] === 'r' ? 1 : -1)) : 0,
  ...extra,
});
// 一個零件拆成哪些區塊（part 為 PARTS 裡的零件物件；cat：head／core／booster／arms／legs／weapon／back）
export function partPieces(cat, part) {
  const id = part.id;
  if (cat === 'head' || cat === 'core' || cat === 'booster')
    return [pieceInfo(`${cat}/${id}`, cat, part, cat)];
  if (cat === 'arms')
    return ['r', 'l'].flatMap((k) =>
      ['upper', 'fore', 'hand'].map((n) => pieceInfo(`arms/${id}/${k}_${n}`, cat, part, n, k)),
    );
  if (cat === 'weapon' || cat === 'back')
    return part.type === 'none'
      ? []
      : ['r', 'l'].map((k) => pieceInfo(`${cat}/${id}/${k}`, cat, part, cat, k));
  // 腳
  const legType = part.type;
  const L = (n, k, kind = n) =>
    pieceInfo(`legs/${id}/${k ? k + '_' : ''}${n}`, cat, part, kind, k, { legType });
  if (legType === 'quad')
    return [
      L('body', null),
      ...QUAD_LEGS.flatMap(([k]) => [L('thigh', k), L('shin', k, 'qshin'), L('foot', k, 'qfoot')]),
    ];
  if (legType === 'tank') return [L('body', null)];
  const segs = legType === 'reverse' ? ['thigh', 'shin', 'meta', 'foot'] : ['thigh', 'shin', 'foot'];
  return [L('pelvis', null), ...['r', 'l'].flatMap((k) => segs.map((n) => L(n, k)))];
}
const ASM_CAT = {
  head: 'head',
  core: 'core',
  booster: 'booster',
  arms: 'arms',
  legs: 'legs',
};
// 整台機甲用到的所有區塊（武器只取實際裝備的那一側）
export function mechPieces(asm) {
  const p = asmParts(asm);
  const out = [];
  for (const [k, cat] of Object.entries(ASM_CAT)) out.push(...partPieces(cat, p[k]));
  for (const [key, cat, k] of [
    ['rarm', 'weapon', 'r'],
    ['larm', 'weapon', 'l'],
    ['rback', 'back', 'r'],
    ['lback', 'back', 'l'],
  ]) {
    const w = partById(cat === 'weapon' ? 'arm' : 'back', asm[key]);
    if (w && w.type !== 'none') out.push(...partPieces(cat, w).filter((i) => i.key === k));
  }
  return out;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const C0 = (p, r = [0, 0, 0]) => ({ p, r: new THREE.Euler(r[0], r[1], r[2]) });
// 區塊的連接點預設值（遊戲座標：正面 −Z、單位公尺、相對於區塊原點）：二足、逆關節的骨架用內建預設機甲的連接點
export function pieceConns(info) {
  return baseConns(info);
}
function baseConns(info) {
  const R = CUBE;
  switch (info.kind) {
    case 'core': {
      const J = JOINT,
        o = { neck: C0(V(...J.neck)), backpack: C0(V(...J.backpack)) };
      for (const [k, s] of Object.entries(SIDE_OF)) {
        o['shoulder_' + k] = C0(V(s * J.shoulder[0], J.shoulder[1], J.shoulder[2]));
        o['back_' + k] = C0(V(s * J.back[0], J.back[1], J.back[2])); // 肩上武器座：肩甲正上方偏後
      }
      return o;
    }
    case 'booster':
      return {
        nozzle_l: C0(V(-0.21, -0.44, 0.26)),
        nozzle_r: C0(V(0.21, -0.44, 0.26)),
      };
    case 'upper':
      return { elbow: C0(V(...JOINT.elbow)) };
    case 'fore':
      return { wrist: C0(V(...JOINT.wrist)) };
    case 'hand': {
      const g = JOINT.grip;
      return { grip: C0(V(info.side * g[0], g[1], g[2]), [-Math.PI / 2, 0, 0]) };
    }
    case 'pelvis': {
      const hipY = legHipY(info.legType);
      return {
        waist: C0(V(0, waistY(info.legType), 0)),
        hip_r: C0(V(LAY.hipX, hipY, 0)),
        hip_l: C0(V(-LAY.hipX, hipY, 0)),
      };
    }
    case 'body': {
      const o = { waist: C0(V(0, waistY(info.legType), 0)) };
      if (info.legType === 'quad') {
        o.waist = C0(V(...QD.waist));
        for (const [k, sx] of QUAD_LEGS) o['hip_' + k] = C0(qdV(QD.hip[qdFB(k)], sx));
      }
      if (info.legType === 'tank') o.waist = C0(V(...TK.waist));
      return o;
    }
    case 'thigh':
      if (info.legType === 'reverse') return { knee: C0(revV(REV.knee, info.side)) };
      if (info.legType === 'quad') return { knee: C0(qdV(QD.knee[qdFB(info.key)], qdLeg(info.key)[1])) };
      return { knee: C0(V(0, -LAY.thighL, 0)) };
    case 'shin':
      if (info.legType === 'reverse') return { hock: C0(revV(REV.hock, info.side)) };
      return { ankle: C0(V(0, -LAY.shinL, 0)) };
    case 'meta':
      return { ankle: C0(revV(REV.ankle, info.side)) };
    case 'qshin':
      return { ankle: C0(qdV(QD.ankle[qdFB(info.key)], qdLeg(info.key)[1])) };
    default:
      return {};
  }
}
const revV = (a, side) => V(side * a[0], a[1], a[2]);
// 髖關節高度：二足＝內建預設機甲、逆關節＝REV 的站姿（關節角度 0 時腳掌貼地）
function legHipY(type) {
  const R = LAY;
  if (type === 'reverse') return REV.hipY;
  return type === 'quad' ? QD.hip.f[1] : type === 'tank' ? 1.1 : R.hipY;
}
// 腰（核心座）高度：決定上半身高度與遊戲判定的身高（不隨關節設定改變）。
// 四足、履帶的下半身造型不變，以腰部支柱把上半身架到和二足差不多的身高
function waistY(type) {
  return type === 'quad' ? QD.waist[1] : type === 'tank' ? TK.waist[1] : legHipY(type) + LAY.waistUp;
}
// 區塊接在哪個父區塊的哪個連接點：{ kind: 父區塊種類, name: 連接點 }（襠部／主體是根，回傳 null）
export function parentConnOf(info) {
  const k = info.key;
  switch (info.kind) {
    case 'head':
      return { kind: 'core', name: 'neck' };
    case 'core':
      return { kind: 'pelvis', name: 'waist' };
    case 'booster':
      return { kind: 'core', name: 'backpack' };
    case 'upper':
      return { kind: 'core', name: 'shoulder_' + k };
    case 'fore':
      return { kind: 'upper', name: 'elbow' };
    case 'hand':
      return { kind: 'fore', name: 'wrist' };
    case 'weapon':
      return { kind: 'hand', name: 'grip' };
    case 'back':
      return { kind: 'core', name: 'back_' + k };
    case 'thigh':
      return { kind: info.legType === 'quad' ? 'body' : 'pelvis', name: 'hip_' + k };
    case 'shin':
    case 'qshin':
      return { kind: 'thigh', name: 'knee' };
    case 'meta':
      return { kind: 'shin', name: 'hock' };
    case 'qfoot':
      return { kind: 'qshin', name: 'ankle' };
    case 'foot':
      return { kind: info.legType === 'reverse' ? 'meta' : 'shin', name: 'ankle' };
    default:
      return null;
  }
}
// 連接點：關節設定覆寫＞預設值
export function connOf(info, name) {
  return resolveConn(info.slot, name, pieceConns(info)[name]);
}

// ----- 各區塊的程式模型（原點＝旋轉中心，座標與舊版各關節群組的區域座標相同）-----
function coreClass(p) {
  return p.core.id === 'c_hv' ? 'heavy' : p.core.id === 'c_lt' || p.core.id === 'c_nat' ? 'light' : 'medium';
}
function pieceCtx(pal, asm) {
  const p = asmParts(asm || START_ASM);
  return {
    M: mechMats(pal),
    red: new THREE.MeshStandardMaterial({
      color: 0xff3a2a,
      emissive: 0xff2a1a,
      emissiveIntensity: 1.3,
      roughness: 0.4,
    }),
    heavy: coreClass(p) === 'heavy',
  };
}
// 區塊上的點：區塊放在 (x, y, z)、轉 (rx, ry)，回傳區域座標 (lx, ly, lz) 在零件裡的位置
function onBlock(x, y, z, rx, ry, lx, ly, lz) {
  return new THREE.Vector3(lx, ly, lz).applyEuler(new THREE.Euler(rx, ry, 0)).add(new THREE.Vector3(x, y, z));
}
// 矩形與梯形輪廓（中心在原點；梯形 wb＝底寬、wt＝頂寬）
const rect = (w, h) => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];
const trap = (wb, wt, h) => [
  [-wb / 2, -h / 2],
  [wb / 2, -h / 2],
  [wt / 2, h / 2],
  [-wt / 2, h / 2],
];
// 輪廓 [[x, y]…] 左右鏡像（s＝−1 時 x 反向）
const mirX = (pts, s) => (s > 0 ? pts : pts.map(([x, y]) => [-x, y]));
// 直立的肢體：secs＝[[y, 寬, 深, 前切角, 後切角]…]（y 由下到上），切角截面沿 Y 放樣，截面中心在 (x, z)
function limb(g, m, x, y, z, secs) {
  P(
    g,
    gPod(secs.map(([yy, w, d, cf, cb]) => [yy, w, -d / 2, d / 2, cf, cb === undefined ? cf : cb])),
    m,
    x,
    y,
    z,
    -Math.PI / 2,
  );
}
// 平貼的散熱縫：n 條細縫沿 Y 排列（ry＝縫面朝向，0＝朝前）
function slits(g, M, x, y, z, n, w, gap = 0.035, ry = 0) {
  for (let i = 0; i < n; i++) P(g, gBox(w, 0.014, 0.012), M.joint, x, y - i * gap, z, 0, ry);
}

// ===== 頭部 =====
// 標準頭部 HD-011：楔形頭盔（截面放樣）＋V 字面罩與紅色眼縫、下巴、頂部冠翼、下半部的頰甲與側面感測器
// o.scan：觀測頭（頂部加旋轉感測盤與長天線）
function headStd(g, { M, red }, o = {}) {
  P(g, gCyl(0.07, 0.08, 0.1, 8), M.joint, 0, 0.03, 0.02); // 脖子
  P(g, gCyl(0.1, 0.12, 0.05, 8), M.sub, 0, 0.065, 0.02); // 頸圈
  // 頭盔：前窄後寬、前面低的楔形
  P(
    g,
    gPod([
      [-0.16, 0.13, 0.12, 0.235, 0.03, 0.03],
      [-0.115, 0.22, 0.08, 0.29, 0.05, 0.045],
      [-0.02, 0.25, 0.07, 0.32, 0.07, 0.05],
      [0.09, 0.24, 0.08, 0.3, 0.07, 0.05],
      [0.14, 0.17, 0.11, 0.245, 0.05, 0.04],
    ]),
    M.grey,
  );
  // 面罩：正面一塊＋兩側斜面各一塊（深色），上面是 V 字的紅色眼縫
  P(g, gPlate(rect(0.13, 0.052), 0.012, 0.004), M.joint, 0, 0.19, -0.164);
  P(g, gPlate(rect(0.1, 0.014), 0.012, 0.003), red, 0, 0.192, -0.17);
  for (const s of [-1, 1]) {
    const ry = -s * Math.PI * 0.25,
      x = s * 0.0915,
      z = -0.1415;
    P(g, gPlate(rect(0.068, 0.06), 0.012, 0.004), M.joint, x, 0.19, z, 0, ry);
    const e = onBlock(x, 0.195, z, 0, ry, 0, 0, -0.007);
    P(g, gPlate(rect(0.056, 0.012), 0.01, 0.003), red, e.x, e.y, e.z, 0, ry, s * 0.22);
  }
  // 下巴（往前凸的小楔形）＋進氣縫
  P(
    g,
    gPod([
      [-0.155, 0.09, 0.07, 0.125, 0.015, 0.02],
      [-0.08, 0.15, 0.055, 0.12, 0.02, 0.03],
    ]),
    M.sub,
  );
  for (let i = 0; i < 2; i++) P(g, gBox(0.06, 0.008, 0.01), M.joint, 0, 0.087 + i * 0.02, -0.158);
  // 頂部冠翼
  const crest = sideProfile([
    [-0.13, 0.25],
    [-0.05, 0.33],
    [0.06, 0.345],
    [0.16, 0.315],
    [0.13, 0.29],
    [-0.08, 0.27],
  ]);
  P(g, gPlate(crest, 0.035, 0.01), M.main, 0, 0, 0, 0, Math.PI / 2, 0);
  // 頰甲（只蓋住下半部）＋側面感測器＋後方散熱片
  const cheek = sideProfile([
    [-0.09, 0.2],
    [-0.1, 0.1],
    [-0.05, 0.065],
    [0.08, 0.08],
    [0.1, 0.17],
    [0.04, 0.21],
  ]);
  for (const s of [-1, 1]) {
    P(g, gPlate(cheek, 0.03, 0.009, 0.85, 1), M.main, s * 0.128, 0, 0, 0, Math.PI / 2, 0);
    P(g, gCyl(0.028, 0.032, 0.025, 8), M.sub, s * 0.148, 0.14, 0.01, 0, 0, Math.PI / 2);
    P(g, gCyl(0.019, 0.019, 0.01, 8), M.lens, s * 0.162, 0.14, 0.01, 0, 0, Math.PI / 2);
    for (let i = 0; i < 3; i++) P(g, gBox(0.01, 0.06, 0.035), M.joint, s * (0.02 + i * 0.026), 0.18, 0.15);
  }
  if (o.scan) {
    // 觀測頭：頂部後方的旋轉感測盤＋鏡頭、左右兩根長天線
    P(g, gCyl(0.02, 0.025, 0.05, 6), M.joint, 0.07, 0.33, 0.06);
    P(g, gCyl(0.075, 0.075, 0.025, 12), M.sub, 0.07, 0.365, 0.06);
    P(g, gCyl(0.05, 0.06, 0.02, 12), M.lens, 0.07, 0.385, 0.06);
    P(g, gCyl(0.006, 0.009, 0.62, 4), M.joint, -0.085, 0.55, 0.08, -0.08, 0, 0.06);
    P(g, gCyl(0.006, 0.009, 0.36, 4), M.joint, 0.1, 0.46, 0.1, -0.15, 0, -0.1);
  } else {
    P(g, gCyl(0.006, 0.009, 0.26, 4), M.joint, 0.09, 0.42, 0.08, -0.12, 0, -0.1); // 天線
    P(g, gCyl(0.016, 0.016, 0.03, 6), M.sub, 0.08, 0.3, 0.08);
  }
}

// 輕量頭部 HD-SEQ：細長的楔形頭、單眼鏡頭與橫向眼縫、往後掠的雙翼天線
function headLt(g, { M, red }) {
  P(g, gCyl(0.06, 0.07, 0.1, 8), M.joint, 0, 0.03, 0.02);
  P(g, gCyl(0.085, 0.1, 0.04, 8), M.sub, 0, 0.065, 0.02);
  P(
    g,
    gPod([
      [-0.15, 0.1, 0.13, 0.215, 0.025, 0.025],
      [-0.08, 0.19, 0.085, 0.265, 0.05, 0.04],
      [0.06, 0.2, 0.08, 0.28, 0.06, 0.045],
      [0.15, 0.13, 0.11, 0.23, 0.04, 0.03],
    ]),
    M.grey,
  );
  // 前面的深色面罩＋橫向眼縫＋單眼
  P(g, gPlate(trap(0.1, 0.09, 0.06), 0.012, 0.004), M.joint, 0, 0.175, -0.154);
  P(g, gPlate(rect(0.08, 0.01), 0.01, 0.003), red, 0, 0.19, -0.161);
  P(g, gCyl(0.02, 0.022, 0.014, 10), M.sub, 0.022, 0.165, -0.161, Math.PI / 2);
  P(g, gCyl(0.013, 0.013, 0.01, 10), red, 0.022, 0.165, -0.167, Math.PI / 2);
  // 下巴
  P(
    g,
    gPod([
      [-0.14, 0.07, 0.08, 0.13, 0.015, 0.015],
      [-0.06, 0.13, 0.06, 0.12, 0.02, 0.02],
    ]),
    M.sub,
  );
  // 往後掠的雙翼天線
  const fin = sideProfile([
    [-0.06, 0.25],
    [0.04, 0.29],
    [0.19, 0.325],
    [0.16, 0.305],
    [0.08, 0.265],
  ]);
  for (const s of [-1, 1]) {
    P(g, gPlate(fin, 0.018, 0.006), M.main, s * 0.06, 0, 0, 0, Math.PI / 2, -s * 0.12);
    P(g, gPlate(trap(0.06, 0.04, 0.09), 0.02, 0.006), M.main, s * 0.103, 0.16, 0.03, 0, (s * Math.PI) / 2);
    P(g, gCyl(0.015, 0.015, 0.012, 8), M.lens, s * 0.114, 0.18, -0.03, 0, 0, Math.PI / 2);
  }
}

// 重裝頭部 HD-HAWK：寬大的裝甲頭盔、前伸的眉甲、雙眼縫、厚頰甲與頂部追加裝甲
function headHv(g, { M, red }) {
  P(g, gCyl(0.08, 0.09, 0.1, 8), M.joint, 0, 0.03, 0.02);
  P(g, gCyl(0.12, 0.14, 0.05, 8), M.sub, 0, 0.065, 0.02);
  P(
    g,
    gPod([
      [-0.17, 0.2, 0.1, 0.24, 0.035, 0.03],
      [-0.12, 0.3, 0.07, 0.29, 0.06, 0.045],
      [0.06, 0.32, 0.07, 0.31, 0.07, 0.05],
      [0.15, 0.25, 0.09, 0.26, 0.05, 0.04],
    ]),
    M.grey,
  );
  // 凹下的面罩帶＋兩道眼縫
  P(g, gPlate(rect(0.19, 0.055), 0.014, 0.004), M.joint, 0, 0.185, -0.173);
  for (const s of [-1, 1])
    P(g, gPlate(trap(0.06, 0.05, 0.016), 0.012, 0.003), red, s * 0.045, 0.19, -0.18, 0, 0, s * 0.12);
  // 眉甲（往前伸的厚板）
  P(g, gPlate(trap(0.3, 0.24, 0.05), 0.12, 0.015, 0.85, 1), M.sub, 0, 0.245, -0.13, 0.25);
  // 下巴（寬、有進氣格柵）
  P(
    g,
    gPod([
      [-0.175, 0.15, 0.07, 0.15, 0.02, 0.025],
      [-0.09, 0.22, 0.05, 0.14, 0.03, 0.035],
    ]),
    M.sub,
  );
  for (let i = 0; i < 3; i++) P(g, gBox(0.11, 0.009, 0.01), M.joint, 0, 0.085 + i * 0.02, -0.178);
  // 厚頰甲
  const cheek = sideProfile([
    [-0.12, 0.23],
    [-0.13, 0.1],
    [-0.07, 0.06],
    [0.1, 0.08],
    [0.13, 0.18],
    [0.06, 0.25],
  ]);
  for (const s of [-1, 1]) {
    P(g, gPlate(cheek, 0.045, 0.012, 0.85, 1), M.main, s * 0.17, 0, 0, 0, Math.PI / 2, 0);
    kitBolts(
      g,
      M,
      [
        [s * 0.195, 0.2, -0.05, 0, Math.PI / 2],
        [s * 0.195, 0.11, 0.06, 0, Math.PI / 2],
      ],
      0.012,
    );
  }
  // 頂部追加裝甲＋後方散熱片
  P(g, gPlate(trap(0.24, 0.2, 0.04), 0.22, 0.012, 0.9, 0.9), M.main, 0, 0.325, 0.02);
  for (let i = -2; i <= 2; i++) P(g, gBox(0.012, 0.07, 0.04), M.joint, i * 0.03, 0.18, 0.165);
}

// ===== 核心 =====
// 核心的外型參數：k＝胸塊寬度倍率、top＝胸塊頂部高低、kind＝附加裝備
const CORE_STYLE = {
  c_std: { k: 1, top: 0, kind: '' },
  c_lt: { k: 0.86, top: -0.04, kind: 'light' },
  c_hv: { k: 1.12, top: 0.02, kind: 'heavy' },
  c_nat: { k: 0.92, top: -0.02, kind: 'nat' },
  c_aeg: { k: 1.02, top: 0, kind: 'aeg' },
};
// 核心：八角收腰＋分節腹甲＋左右楔形胸塊（綠，往外斜）夾著中央的灰色胸骨，
// 胸塊外側的灰色側甲與散熱縫、肩關節座、頸圈；原點在腰部
function coreBody(g, { M, red }, cs) {
  const R = CUBE,
    k = cs.k,
    t = cs.top;
  // 八角收腰（黑色腰部機構）
  P(g, gCyl(0.2, 0.17, 0.24, 8), M.joint, 0, 0.05, 0.02, 0, Math.PI / 8, 0, 1, 1, 0.85);
  P(g, gCyl(0.215, 0.215, 0.03, 8), M.sub, 0, 0.17, 0.02, 0, Math.PI / 8, 0, 1, 1, 0.85);
  // 分節腹甲（前窄後寬）
  for (let i = 0; i < 2; i++) {
    const y = 0.17 + i * 0.085,
      w = 0.4 - i * 0.04;
    P(
      g,
      gPod([
        [-0.23, w * 0.8, y - 0.04, y + 0.04, 0.02, 0.02],
        [0.2, w, y - 0.045, y + 0.045, 0.02, 0.02],
      ]),
      M.grey,
    );
  }
  // 深色的內部胸殼與下胸
  P(
    g,
    gPod([
      [-0.26, 0.36, 0.3, 0.74, 0.05, 0.06],
      [0.28, 0.42, 0.3, 0.8, 0.05, 0.06],
    ]),
    M.sub,
  );
  P(
    g,
    gPod([
      [-0.25, 0.5, 0.31, 0.42, 0.03, 0.04],
      [0.26, 0.68, 0.3, 0.44, 0.03, 0.04],
    ]),
    M.sub,
  );
  // 左右胸塊（前面收窄、上下切角，外緣往後斜）
  const block = gPod([
    [-0.34, 0.2 * k, 0.47, 0.84 + t, 0.05, 0.07],
    [-0.24, 0.3 * k, 0.38, 0.93 + t, 0.08, 0.1],
    [0.12, 0.32 * k, 0.38, 0.95 + t, 0.08, 0.1],
    [0.3, 0.26 * k, 0.44, 0.86 + t, 0.06, 0.08],
  ]);
  const side = sideProfile([
    [-0.2, 0.45],
    [0.2, 0.46],
    [0.24, 0.82 + t],
    [-0.14, 0.88 + t],
    [-0.24, 0.72 + t],
  ]);
  const hw = 0.16 * k; // 胸塊半寬
  for (const s of [-1, 1]) {
    const x = s * (0.11 + hw),
      ry = -s * 0.12;
    const at = (lx, ly, lz) => onBlock(x, 0, 0, 0, ry, lx, ly, lz);
    P(g, block, M.main, x, 0, 0, 0, ry);
    let p = at(0, 0.925 + t, -0.25);
    P(g, gBox(0.17 * k, 0.02, 0.025), M.acc, p.x, p.y, p.z, 0.6, ry); // 上緣黃色飾條
    p = at(0, 0.66, -0.346);
    decal(g, s > 0 ? 1 : 3, 0.15, 0.15, p.x, p.y, p.z, 0, ry + Math.PI, 0);
    kitBolts(
      g,
      M,
      [-0.065, 0.065].map((lx) => {
        const b = at(lx * k, 0.52, -0.345);
        return [b.x, b.y, b.z, Math.PI / 2, ry];
      }),
      0.016,
    );
    // 外側的灰色側甲＋散熱縫
    p = at(s * (hw + 0.01), 0, 0.02);
    P(g, gPlate(side, 0.05, 0.018, 0.88, 1), M.grey, p.x, p.y, p.z, 0, Math.PI / 2 + ry, 0);
    for (let i = 0; i < 3; i++) {
      p = at(s * (hw + 0.036), 0.82 + t - i * 0.04, -0.06);
      P(g, gBox(0.012, 0.016, 0.14), M.joint, p.x, p.y, p.z, 0, ry);
    }
    p = at(s * (hw + 0.037), 0.56, 0.05);
    decal(g, 2, 0.16, 0.16, p.x, p.y, p.z, 0, (s * Math.PI) / 2 + ry, 0);
    // 肩關節座（外接圓筒＋護圈）
    P(g, gCyl(0.12, 0.12, 0.12, 8), M.joint, s * 0.47, R.shY, 0, 0, 0, Math.PI / 2);
    P(g, gCyl(0.14, 0.14, 0.035, 8), M.sub, s * 0.445, R.shY, 0, 0, 0, Math.PI / 2);
    if (cs.kind === 'heavy') {
      // 重核心：胸塊正面下半的追加裝甲＋頂部的厚護甲
      p = at(0, 0.56, -0.355);
      P(g, gPlate(trap(0.22 * k, 0.18 * k, 0.17), 0.05, 0.016, 0.85, 1), M.sub, p.x, p.y, p.z, -0.1, ry);
      p = at(0, 0.962 + t, 0.0);
      P(g, gPlate(trap(0.24 * k, 0.18 * k, 0.04), 0.32, 0.014, 0.9, 0.9), M.grey, p.x, p.y, p.z, 0, ry);
    } else if (cs.kind === 'light') {
      // 輕核心：胸塊下方露出的骨架與液壓桿
      p = at(0, 0.36, 0.0);
      kitPiston(g, M, p.x, p.y - 0.02, p.z - 0.1, p.x * 0.6, 0.2, p.z - 0.05, 0.022);
    } else if (cs.kind === 'nat') {
      // 夜鷺：肩後往上後方掠的翼板
      const wing = sideProfile([
        [0.0, 0.8],
        [0.12, 0.92],
        [0.42, 1.12],
        [0.36, 1.02],
        [0.2, 0.8],
      ]);
      p = at(s * hw * 0.7, 0, 0.05);
      P(g, gPlate(wing, 0.03, 0.01), M.main, p.x, p.y, p.z, 0, Math.PI / 2 + ry, -s * 0.15);
    } else if (cs.kind === 'aeg') {
      // 偏向核心：胸塊前方斜擋的偏向板（灰）＋黃色框
      p = at(0, 0.66, -0.4);
      P(g, gPlate(trap(0.3, 0.26, 0.42), 0.04, 0.014, 0.9, 1), M.grey, p.x, p.y, p.z, 0.08, ry - s * 0.18);
      p = at(0, 0.88, -0.41);
      P(g, gBox(0.27, 0.025, 0.03), M.acc, p.x, p.y, p.z, 0.08, ry - s * 0.18);
    }
  }
  // 中央胸骨（灰，往前凸的斜面，上接頸圈）＋散熱縫＋紅色指示燈
  const keel = sideProfile([
    [-0.33, 0.34],
    [-0.39, 0.48],
    [-0.37, 0.66],
    [-0.28, 0.8],
    [-0.1, 0.82],
    [0.05, 0.82],
    [0.05, 0.34],
  ]);
  P(g, gPlate(keel, 0.2, 0.03, 0.85, 0.85), M.grey, 0, 0, 0, 0, Math.PI / 2, 0);
  for (let i = 0; i < 3; i++) P(g, gBox(0.1, 0.014, 0.012), M.joint, 0, 0.51 + i * 0.04, -0.388 + i * 0.002);
  P(g, gPlate(trap(0.11, 0.09, 0.024), 0.016, 0.004), red, 0, 0.735, -0.333, 0.57);
  for (const s of [-1, 1])
    P(g, gCyl(0.016, 0.016, 0.02, 8), red, s * 0.06, 0.675, -0.367, Math.PI / 2 + 0.57);
  // 頸圈與背板
  P(g, gCyl(0.12, 0.15, 0.06, 8), M.joint, 0, R.neckY - 0.01, 0.02);
  P(g, gPlate(trap(0.6, 0.68, 0.4), 0.06, 0.02), M.grey, 0, 0.64, 0.3);
  P(g, gBox(0.3, 0.04, 0.03), M.acc, 0, 0.82, 0.33);
}

// ----- 逆關節腳（四段）的程式模型：每段沿「原點 → 子關節」的骨頭方向放樣，關節處是橫向的圓盤 -----
// secs＝[[t（0＝原點、1＝子關節）, 寬, 深, 切角]…]
function revSeg(g, m, end, secs) {
  const L = end.length();
  const sub = new THREE.Group();
  limb(sub, m, 0, 0, 0, secs.map(([t, w, d, c]) => [-L * t, w, d, c]).reverse());
  sub.quaternion.setFromUnitVectors(V(0, -1, 0), end.clone().normalize());
  g.add(sub);
  return sub;
}
const revDisc = (g, M, x, y, z, r, w) => {
  P(g, gCyl(r, r, w, 14), M.joint, x, y, z, 0, 0, Math.PI / 2);
  P(g, gCyl(r * 0.62, r * 0.62, w + 0.03, 14), M.grey, x, y, z, 0, 0, Math.PI / 2);
};
function revThigh(g, info, M) {
  const e = revV(REV.knee, info.side);
  P(g, gSph(0.17, 12), M.joint, 0, 0, 0); // 髖球關節
  revSeg(g, M.joint, e, [
    [0.05, 0.22, 0.24, 0.04],
    [0.95, 0.22, 0.24, 0.04],
  ]);
  revSeg(g, M.main, e, [
    [-0.05, 0.3, 0.3, 0.05],
    [0.1, 0.4, 0.4, 0.08],
    [0.75, 0.38, 0.4, 0.08],
    [0.92, 0.28, 0.3, 0.05],
  ]); // 大腿護甲
  revDisc(g, M, e.x, e.y, e.z, 0.19, 0.34); // 膝的圓盤
}
function revShin(g, info, M) {
  const e = revV(REV.hock, info.side);
  revSeg(g, M.main2, e, [
    [0.05, 0.2, 0.3, 0.04],
    [0.5, 0.24, 0.34, 0.05],
    [0.95, 0.2, 0.26, 0.04],
  ]); // 往後下斜的小腿骨架
  P(g, gPlate(trap(0.22, 0.3, 0.4), 0.05, 0.015, 0.9, 1), M.sub, 0, 0.12, 0.2, -0.5); // 膝後方的延伸板
  revDisc(g, M, e.x, e.y, e.z, 0.15, 0.3); // 跗關節的圓盤
}
function revMeta(g, info, M) {
  const e = revV(REV.ankle, info.side);
  revSeg(g, M.main, e, [
    [-0.05, 0.28, 0.3, 0.05],
    [0.15, 0.36, 0.4, 0.08],
    [0.85, 0.36, 0.4, 0.08],
    [1.0, 0.3, 0.32, 0.05],
  ]); // 蹠骨護甲
  const L = e.length(),
    a = Math.atan2(-e.z, -e.y); // (0, −1, 0) 繞 X 轉 a ＝骨頭方向
  P(g, gBox(0.2, L * 0.45, 0.04), M.grey, e.x * 0.5, e.y * 0.5, e.z * 0.5 - 0.21, a); // 正面護板
}
function revFoot(g, info, M) {
  const h = REV.ankleH;
  P(g, gCyl(0.12, 0.12, 0.3, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2); // 腳踝
  P(g, gBox(0.34, 0.12, 0.6), M.main2, 0, -h + 0.1, -0.05); // 腳掌（正面 −Z）
  P(g, gBox(0.2, 0.26, 0.24), M.joint, 0, -h * 0.55, 0.02);
  for (const x of [-0.11, 0, 0.11]) P(g, gBox(0.08, 0.1, 0.2), M.joint, x, -h + 0.05, -0.42, 0.25); // 前爪
  P(g, gCyl(0.2, 0.2, 0.24, 16), M.rubber || M.joint, 0, -h + 0.2, 0.32, 0, 0, Math.PI / 2); // 後輪
  P(g, gCyl(0.1, 0.1, 0.26, 12), M.grey, 0, -h + 0.2, 0.32, 0, 0, Math.PI / 2);
}

const BUILD = {
  head(g, info, ctx) {
    const id = info.part.id;
    if (id === 'h_lt') return headLt(g, ctx);
    if (id === 'h_hv') return headHv(g, ctx);
    headStd(g, ctx, { scan: id === 'h_scan' });
  },
  core(g, info, ctx) {
    coreBody(g, ctx, CORE_STYLE[info.part.id] || CORE_STYLE.c_std);
  },
  // 背包：往後收的切角箱體＋兩側的推進器艙（噴焰是粒子特效，從連接點噴出，不是模型）
  booster(g, info, { M, heavy }) {
    P(
      g,
      gPod([
        [-0.2, 0.64, -0.29, 0.29, 0.08, 0.08],
        [0.1, 0.7, -0.31, 0.31, 0.1, 0.1],
        [0.22, 0.56, -0.25, 0.26, 0.08, 0.08],
      ]),
      M.main,
      0,
      0,
      0.02,
    );
    // 背面的深色面板、貼花與散熱縫
    P(g, gPlate(trap(0.4, 0.34, 0.36), 0.03, 0.01), M.sub, 0, 0.05, 0.245);
    decal(g, 5, 0.22, 0.22, 0, 0.1, 0.262, 0, 0, 0); // Power Backpack
    slits(g, M, 0, -0.04, 0.262, 3, 0.26, 0.032);
    P(g, gPlate(rect(0.62, 0.05), 0.42, 0.015), M.sub, 0, 0.29, 0.02); // 頂部護板
    for (const s of [-1, 1]) {
      // 推進器艙（沿 Y 放樣）＋噴口
      limb(g, M.sub, s * 0.21, 0, 0.26, [
        [-0.36, 0.16, 0.16, 0.03],
        [-0.3, 0.19, 0.19, 0.04],
        [-0.1, 0.2, 0.2, 0.045],
        [-0.04, 0.15, 0.15, 0.03],
      ]);
      P(g, gCyl(0.08, 0.1, 0.1, 10), M.joint, s * 0.21, -0.39, 0.26);
      P(g, gCyl(0.065, 0.065, 0.02, 10), M.lens, s * 0.21, -0.435, 0.26);
      P(g, gBox(0.06, 0.2, 0.02), M.acc, s * 0.29, 0.06, 0.245);
      // 側面的斜板
      P(
        g,
        gPlate(
          sideProfile([
            [-0.16, -0.2],
            [0.16, -0.16],
            [0.18, 0.2],
            [-0.12, 0.24],
          ]),
          0.03,
          0.01,
        ),
        M.sub,
        s * 0.355,
        0,
        0.04,
        0,
        Math.PI / 2,
        0,
      );
    }
    if (heavy)
      for (const s of [-1, 1]) {
        P(g, gCyl(0.14, 0.14, 0.56, 10), M.main, s * 0.126, 0.04, 0.37);
        for (const y of [-0.22, 0.04, 0.3]) P(g, gCyl(0.15, 0.15, 0.03, 10), M.sub, s * 0.126, y, 0.37);
      }
    P(g, gCyl(0.012, 0.012, 0.8, 4), M.joint, 0.084, 0.71, 0.05);
  },
  // 上臂：肩關節＋外伸的大肩甲（五角形輪廓、前後收、上層護甲、下方推進器噴口）＋上臂（綠）＋黃色環帶＋液壓桿
  upper(g, info, { M }) {
    const R = CUBE,
      s = info.side,
      pw = R.padW,
      ph = R.padH,
      pd = R.padD,
      px = s * (pw / 2 - 0.06),
      py = 0.17;
    P(g, gCyl(0.12, 0.12, 0.24, 10), M.joint, -s * 0.02, 0, 0, 0, 0, Math.PI / 2);
    // 大肩甲
    const pad = mirX(
      [
        [-0.25, -0.2],
        [0.1, -0.3],
        [0.25, -0.14],
        [0.25, 0.18],
        [0.13, 0.3],
        [-0.19, 0.3],
        [-0.25, 0.24],
      ],
      s,
    );
    P(g, gPlate(pad, pd, 0.05, 0.86, 0.9), M.grey, px, py, 0);
    // 上層護甲（深色帽簷）
    const cap = mirX(
      [
        [-0.2, -0.04],
        [0.24, -0.04],
        [0.28, 0.02],
        [0.16, 0.05],
        [-0.2, 0.05],
      ],
      s,
    );
    P(g, gPlate(cap, pd * 0.82, 0.02, 0.9, 0.9), M.sub, px, py + 0.28, 0);
    // 正面的凹板＋散熱縫
    P(
      g,
      gPlate(trap(pw * 0.5, pw * 0.56, ph * 0.36), 0.04, 0.012),
      M.sub,
      px + s * 0.03,
      py + 0.04,
      -pd / 2 + 0.005,
    );
    slits(g, M, px + s * 0.03, py + 0.1, -pd / 2 - 0.018, 4, pw * 0.4, 0.035);
    decal(g, 7, 0.2, 0.2, px + s * (pw / 2 + 0.007), py, 0, 0, (s * Math.PI) / 2, 0);
    kitBolts(
      g,
      M,
      [
        [px + s * (pw / 2 + 0.01), py + ph * 0.36, pd * 0.33, 0, Math.PI / 2],
        [px + s * (pw / 2 + 0.01), py + ph * 0.36, -pd * 0.33, 0, Math.PI / 2],
        [px + s * (pw / 2 + 0.01), py - ph * 0.3, 0, 0, Math.PI / 2],
      ],
      0.022,
    );
    P(g, gCyl(0.07, 0.09, 0.1, 10), M.joint, px + s * pw * 0.25, py - ph / 2 - 0.02, pd * 0.18); // 肩甲下噴口
    P(g, gCyl(0.06, 0.06, 0.02, 10), M.lens, px + s * pw * 0.25, py - ph / 2 - 0.07, pd * 0.18);
    // 上臂
    limb(g, M.main, 0, 0, 0, [
      [-0.47, 0.2, 0.22, 0.04],
      [-0.42, 0.26, 0.28, 0.05],
      [-0.17, 0.27, 0.29, 0.05],
      [-0.1, 0.21, 0.24, 0.04],
    ]);
    limb(g, M.acc, 0, 0, 0, [
      [-0.32, 0.29, 0.31, 0.05],
      [-0.28, 0.29, 0.31, 0.05],
    ]);
    kitPiston(g, M, 0, -0.16, 0.17, 0, -0.42, 0.16, 0.022);
    kitBolts(g, M, [[s * 0.137, -0.22, 0, 0, Math.PI / 2]], 0.02);
  },
  // 前臂（藍，八角截面、比上臂粗）＋手肘圓柱＋正面灰色護甲＋外側裝甲板與噴口＋內側散熱縫
  fore(g, info, { M }) {
    const R = CUBE,
      s = info.side,
      fl = R.foreL;
    P(g, gCyl(0.11, 0.11, R.upW + 0.08, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    limb(g, M.main2, 0, 0, 0, [
      [-fl + 0.02, 0.32, 0.32, 0.06],
      [-0.44, 0.4, 0.4, 0.08],
      [-0.14, 0.42, 0.42, 0.085],
      [-0.07, 0.34, 0.34, 0.06],
    ]);
    P(g, gPlate(trap(0.28, 0.34, 0.27), 0.05, 0.015, 0.9, 1), M.grey, 0, -0.28, -0.21, -0.04);
    P(g, gBox(0.2, 0.02, 0.015), M.acc, 0, -0.43, -0.205);
    const outer = sideProfile([
      [-0.17, -0.44],
      [0.15, -0.42],
      [0.17, -0.14],
      [-0.12, -0.12],
    ]);
    P(g, gPlate(outer, 0.04, 0.012), M.sub, s * 0.212, 0, 0, 0, Math.PI / 2, 0);
    decal(g, 7, 0.15, 0.15, s * 0.234, -0.28, 0.0, 0, (s * Math.PI) / 2, 0);
    for (let i = 0; i < 3; i++) P(g, gBox(0.012, 0.016, 0.16), M.joint, -s * 0.209, -0.2 - i * 0.05, 0.04);
    P(g, gCyl(0.06, 0.08, 0.1, 10), M.joint, s * 0.27, -fl * 0.72, 0.06, 0, 0, (s * Math.PI) / 2);
    P(g, gCyl(0.05, 0.05, 0.02, 10), M.lens, s * 0.32, -fl * 0.72, 0.06, 0, 0, (s * Math.PI) / 2);
  },
  // 手：手腕軸＋切角的手掌＋指節護甲＋四指（兩節）＋拇指
  hand(g, info, { M }) {
    const fs = CUBE.fist,
      s = info.side;
    P(g, gCyl(0.06, 0.06, 0.14, 8), M.joint, 0, -0.02, 0, 0, 0, Math.PI / 2);
    limb(g, M.grey, 0, 0, 0, [
      [-0.2, 0.2, 0.22, 0.03],
      [-0.15, 0.225, 0.24, 0.04],
      [-0.03, 0.215, 0.23, 0.04],
    ]);
    P(g, gBox(0.21, 0.035, 0.03), M.sub, 0, -0.19, -0.11);
    for (let f = 0; f < 4; f++) {
      CB(g, 0.045, 0.1, 0.06, M.joint, -0.08 + f * 0.053, -fs * 0.7, -fs * 0.2, 0, 0, 0, 0.012);
      CB(g, 0.04, 0.08, 0.055, M.grey, -0.08 + f * 0.053, -fs * 0.95, -fs * 0.25, 0, 0, 0, 0.012);
    }
    CB(g, 0.06, 0.1, 0.07, M.joint, s * fs * 0.42, -fs * 0.45, -fs * 0.15, 0, 0, 0, 0.012);
  },
  // 襠部（藍，切角放樣）＋髖軸＋V 字的前腰裙與後腰裙；原點在地面
  pelvis(g, info, { M }) {
    const R = CUBE,
      hy = legHipY(info.legType),
      wy = waistY(info.legType),
      pd = R.pelvisD;
    P(
      g,
      gPod([
        [-0.23, 0.3, wy - 0.42, wy - 0.06, 0.06, 0.08],
        [-0.1, 0.4, wy - 0.44, wy - 0.02, 0.06, 0.1],
        [0.12, 0.4, wy - 0.44, wy - 0.02, 0.06, 0.1],
        [0.23, 0.32, wy - 0.4, wy - 0.06, 0.05, 0.08],
      ]),
      M.main2,
    );
    P(g, gCyl(0.1, 0.1, R.hipX * 2 - 0.1, 10), M.joint, 0, hy, 0, 0, 0, Math.PI / 2); // 髖軸
    const skirt = [
      [-0.15, 0.26],
      [-0.15, -0.1],
      [0, -0.26],
      [0.15, -0.1],
      [0.15, 0.26],
    ];
    P(g, gPlate(skirt, 0.06, 0.02, 0.86, 1), M.grey, 0, wy - 0.3, -pd / 2 - 0.05, 0.12); // 前腰裙
    P(g, gBox(0.2, 0.03, 0.02), M.acc, 0, wy - 0.12, -pd / 2 - 0.1, 0.12);
    decal(g, 0, 0.12, 0.12, 0, wy - 0.3, -pd / 2 - 0.085, 0.12, Math.PI, 0);
    P(
      g,
      gPlate(
        mirX(skirt, 1).map(([x, y]) => [x * 1.2, y * 0.8]),
        0.06,
        0.02,
        1,
        0.86,
      ),
      M.main2,
      0,
      wy - 0.26,
      pd / 2 + 0.05,
      -0.15,
    ); // 後腰裙
    for (const s of [-1, 1]) P(g, gPlate(rect(0.04, 0.22), 0.3, 0.012), M.sub, s * 0.205, wy - 0.22, 0); // 側面護板
  },
  body(g, info, { M }) {
    const wy = waistY(info.legType);
    if (info.legType === 'quad') {
      // 四足：扁平的基座（下層深色、上層主色，內建 GLB 的外框）＋腿座＋腰部支柱
      const y0 = 1.0,
        y1 = 1.98;
      P(
        g,
        gPod([
          [-1.05, 1.5, y0, y0 + 0.5, 0.14, 0.1],
          [-0.8, 1.7, y0, y0 + 0.5, 0.16, 0.1],
          [1.2, 1.7, y0, y0 + 0.5, 0.16, 0.1],
          [1.45, 1.4, y0, y0 + 0.5, 0.14, 0.1],
        ]),
        M.sub,
      );
      P(
        g,
        gPod([
          [-0.95, 1.4, y0 + 0.45, y1, 0.12, 0.06],
          [-0.75, 1.6, y0 + 0.45, y1, 0.14, 0.06],
          [1.15, 1.6, y0 + 0.45, y1, 0.14, 0.06],
          [1.35, 1.3, y0 + 0.45, y1, 0.12, 0.06],
        ]),
        M.main,
      );
      for (const [, sx, sz] of QUAD_LEGS) {
        const h = QD.hip[sz < 0 ? 'f' : 'b'];
        P(g, gCyl(0.24, 0.24, 0.2, 10), M.joint, sx * (h[0] - 0.05), h[1], h[2], 0, 0, Math.PI / 2);
      }
      waistPost(g, M, y1 - 0.05, wy);
      return;
    }
    // 履帶：斜面的車體＋上層＋兩側的履帶（側裙、負重輪、上下履帶板）
    P(
      g,
      gPod([
        [-1.1, 1.3, 0.62, 0.95, 0.12, 0.1],
        [-0.85, 1.7, 0.55, 1.15, 0.14, 0.1],
        [0.95, 1.7, 0.55, 1.15, 0.14, 0.1],
        [1.1, 1.5, 0.6, 1.08, 0.12, 0.1],
      ]),
      M.sub,
    );
    P(
      g,
      gPod([
        [-0.7, 1.0, 1.1, 1.38, 0.08, 0.05],
        [-0.55, 1.2, 1.1, 1.4, 0.1, 0.05],
        [0.7, 1.2, 1.1, 1.4, 0.1, 0.05],
      ]),
      M.main,
    );
    P(g, gPlate(trap(1.2, 1.0, 0.3), 0.06, 0.02, 0.9, 1), M.grey, 0, 0.88, -1.03, -0.5); // 正面斜裝甲
    waistPost(g, M, 1.37, wy);
    for (const s of [-1, 1]) {
      P(
        g,
        gPod([
          [-1.4, 0.8, 0.12, 0.7, 0.25, 0.2],
          [-1.15, 0.8, 0.0, 0.9, 0.12, 0.06],
          [1.15, 0.8, 0.0, 0.9, 0.12, 0.06],
          [1.4, 0.8, 0.12, 0.7, 0.25, 0.2],
        ]),
        M.joint,
        s * 1.25,
        0,
        0,
      );
      P(
        g,
        gPlate(
          sideProfile([
            [-1.45, 0.92],
            [-1.2, 1.08],
            [1.3, 1.08],
            [1.45, 0.92],
            [1.3, 0.62],
            [-1.3, 0.62],
          ]),
          0.06,
          0.02,
        ),
        M.main2,
        s * 1.66,
        0,
        0,
        0,
        Math.PI / 2,
        0,
      ); // 側裙
      for (let i = -1; i <= 1; i++) {
        P(g, gCyl(0.36, 0.36, 0.86, 10), M.acc, s * 1.25, 0.45, i * 0.95, 0, 0, Math.PI / 2);
        P(g, gCyl(0.16, 0.16, 0.9, 8), M.joint, s * 1.25, 0.45, i * 0.95, 0, 0, Math.PI / 2);
      }
      for (let i = 0; i < 9; i++) {
        P(g, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.08, -1.3 + i * 0.32);
        P(g, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.93, -1.3 + i * 0.32);
      }
    }
  },
  thigh(g, info, { M }) {
    if (info.legType === 'quad') {
      // 四足：沿「髖 → 膝」放樣的大腿＋髖的球關節、膝的圓盤（QD 的骨架）
      const e = qdV(QD.knee[qdFB(info.key)], qdLeg(info.key)[1]);
      P(g, gSph(0.2, 12), M.joint, 0, 0, 0);
      revSeg(g, M.main2, e, [
        [-0.05, 0.3, 0.3, 0.05],
        [0.12, 0.42, 0.4, 0.08],
        [0.8, 0.4, 0.38, 0.08],
        [0.96, 0.3, 0.3, 0.05],
      ]);
      revDisc(g, M, e.x, e.y, e.z, 0.2, 0.36);
      return;
    }
    if (info.legType === 'reverse') return revThigh(g, info, M);
    // 黑色大腿骨架＋外側大護甲（從腰裙兩側垂下的大板）
    const R = CUBE,
      s = info.side,
      rev = info.legType === 'reverse',
      tl = R.thighL,
      z = rev ? 0.06 : 0,
      ax = s * 0.07;
    P(g, gSph(0.15, 12), M.joint, 0, 0, 0); // 髖球關節
    limb(g, M.joint, 0, 0, z, [
      [-tl + 0.03, 0.2, 0.22, 0.04],
      [-tl + 0.1, 0.26, 0.27, 0.05],
      [-0.2, 0.26, 0.27, 0.05],
      [-0.08, 0.22, 0.22, 0.04],
    ]);
    limb(g, M.main, ax, 0, z, [
      [-0.5, 0.38, 0.34, 0.06],
      [-0.42, 0.46, 0.42, 0.08],
      [0.12, 0.46, 0.42, 0.08],
      [0.2, 0.36, 0.32, 0.06],
    ]); // 大腿護甲
    const fp = mirX(
      [
        [-0.11, -0.15],
        [0.11, -0.15],
        [0.11, 0.12],
        [0.05, 0.17],
        [-0.11, 0.17],
      ],
      s,
    );
    P(g, gPlate(fp, 0.04, 0.012), M.grey, ax - s * 0.06, -0.22, z - 0.215);
    P(g, gBox(0.05, 0.44, 0.015), M.acc, ax + s * 0.13, -0.15, z - 0.212);
    kitBolts(
      g,
      M,
      [
        [ax + s * 0.232, 0.06, z + 0.1, 0, Math.PI / 2],
        [ax + s * 0.232, -0.36, z + 0.1, 0, Math.PI / 2],
      ],
      0.022,
    );
    decal(g, 7, 0.2, 0.2, ax + s * 0.236, -0.15, z - 0.05, 0, (s * Math.PI) / 2, 0);
    for (let i = 0; i < 3; i++)
      P(g, gBox(0.012, 0.016, 0.16), M.joint, ax - s * 0.232, -0.05 - i * 0.04, z + 0.04);
    if (info.part.id === 'l_hv') {
      // 重二足：外側加厚裝甲板＋正面護板
      P(
        g,
        gPlate(
          sideProfile([
            [-0.2, -0.5],
            [0.18, -0.48],
            [0.2, 0.1],
            [-0.16, 0.12],
          ]),
          0.08,
          0.02,
        ),
        M.sub,
        ax + s * 0.27,
        0,
        z,
        0,
        Math.PI / 2,
        0,
      );
      P(g, gPlate(trap(0.3, 0.36, 0.4), 0.07, 0.02, 0.88, 1), M.main2, ax, -0.32, z - 0.25, -0.08);
    }
  },
  // 小腿：膝蓋圓柱＋V 字膝甲＋上段（綠）／下段（藍）的切角放樣＋正面護板＋膝外側與小腿後方的推進器
  shin(g, info, { M }) {
    if (info.legType === 'reverse') return revShin(g, info, M);
    const R = CUBE,
      s = info.side,
      sw = R.shinW,
      sl = R.shinL;
    P(g, gCyl(0.12, 0.12, R.thighW + 0.1, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    const knee = [
      [-0.19, -0.13],
      [0.19, -0.13],
      [0.19, 0.08],
      [0, 0.2],
      [-0.19, 0.08],
    ];
    P(g, gPlate(knee, 0.12, 0.025, 0.82, 1), M.grey, 0, 0.05, -sw / 2 - 0.04); // 膝甲
    limb(g, M.main, 0, 0, 0, [
      [-0.48, 0.32, 0.36, 0.05],
      [-0.2, 0.36, 0.4, 0.07],
      [-0.08, 0.32, 0.36, 0.05],
    ]);
    limb(g, M.main2, 0, 0, 0, [
      [-sl + 0.03, 0.3, 0.33, 0.05],
      [-0.72, 0.33, 0.37, 0.06],
      [-0.46, 0.34, 0.38, 0.06],
    ]);
    P(g, gPlate(trap(0.24, 0.3, 0.3), 0.04, 0.012, 0.9, 1), M.grey, 0, -0.32, -0.205);
    P(g, gBox(sw * 0.6, 0.03, 0.015), M.acc, 0, -sl * 0.56, -0.192);
    decal(g, 7, 0.16, 0.16, 0, -sl * 0.78, -0.19, 0, Math.PI, 0); // 黃分隔線＋「01」
    for (let i = 0; i < 3; i++) P(g, gBox(0.012, 0.016, 0.16), M.joint, -s * 0.172, -0.2 - i * 0.05, 0.04);
    P(g, gCyl(0.06, 0.08, 0.1, 10), M.joint, s * (sw / 2 + 0.06), -0.08, 0.06); // 膝外側噴口
    P(g, gCyl(0.05, 0.05, 0.02, 10), M.lens, s * (sw / 2 + 0.06), -0.14, 0.06);
    limb(g, M.sub, 0, 0, sw * 0.55 + 0.04, [
      [-0.42, 0.16, 0.1, 0.02],
      [-0.4, 0.18, 0.12, 0.03],
      [-0.16, 0.18, 0.12, 0.03],
    ]); // 小腿後推進器
    P(g, gCyl(0.06, 0.07, 0.08, 10), M.joint, 0, -sl * 0.35 - 0.18, sw * 0.55 + 0.04);
    kitPiston(g, M, s * 0.12, -0.08, 0.17, s * 0.12, -0.42, 0.19, 0.018);
    if (info.part.id === 'l_hv') {
      // 重二足：大膝甲＋小腿前方與外側的追加裝甲
      P(
        g,
        gPlate(
          knee.map(([x, y]) => [x * 1.2, y * 1.1]),
          0.14,
          0.03,
          0.8,
          1,
        ),
        M.sub,
        0,
        0.1,
        -sw / 2 - 0.1,
        0.15,
      );
      P(g, gPlate(trap(0.34, 0.38, sl * 0.4), 0.08, 0.02, 0.88, 1), M.main, 0, -sl * 0.42, -sw * 0.62, 0.05);
      P(
        g,
        gPlate(
          sideProfile([
            [-0.15, -0.72],
            [0.13, -0.7],
            [0.15, -0.2],
            [-0.12, -0.18],
          ]),
          0.08,
          0.02,
        ),
        M.main2,
        s * (sw / 2 + 0.05),
        0,
        0,
        0,
        Math.PI / 2,
        0,
      );
    }
  },
  // 四足的小腿（含腳）：八角的小腿＋正面護板＋寬腳掌（底面不變）
  // 四足的小腿：沿「膝 → 腳踝」放樣
  qshin(g, info, { M }) {
    const e = qdV(QD.ankle[qdFB(info.key)], qdLeg(info.key)[1]);
    revSeg(g, M.main, e, [
      [0.0, 0.3, 0.3, 0.05],
      [0.15, 0.36, 0.36, 0.07],
      [0.85, 0.3, 0.32, 0.06],
      [1.0, 0.24, 0.26, 0.04],
    ]);
  },
  // 四足的腳掌：腳踝下的輪子＋前爪，底面貼地（腳踝離地的高度依前腳／後腳）
  qfoot(g, info, { M }) {
    const fb = qdFB(info.key),
      h = QD.hip[fb][1] + QD.knee[fb][1] + QD.ankle[fb][1];
    P(g, gCyl(0.13, 0.13, 0.32, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    P(g, gBox(0.26, h * 0.7, 0.26), M.main2, 0, -h * 0.35, 0);
    P(g, gCyl(h * 0.45, h * 0.45, 0.26, 16), M.rubber || M.joint, 0, -h * 0.55, 0.12, 0, 0, Math.PI / 2);
    for (const x of [-0.09, 0.09]) P(g, gBox(0.08, 0.12, 0.3), M.joint, x, -h + 0.06, -0.3, 0.2);
  },
  // 腳掌（藍）＋腳踝圓柱與護甲＋灰色腳尖＋鞋底＋腳跟推進器；底面在腳踝下 ankleH（貼地，IK 從網格量）
  meta(g, info, { M }) {
    revMeta(g, info, M);
  },
  foot(g, info, { M, red }) {
    if (info.legType === 'reverse') return revFoot(g, info, M);
    const R = CUBE,
      s = info.side,
      fw = R.footW,
      fh = R.ankleH;
    P(g, gCyl(0.1, 0.1, fw * 0.8, 8), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    limb(g, M.main, 0, 0, -0.02, [
      [-0.13, 0.25, 0.3, 0.04, 0.03],
      [0.03, 0.27, 0.3, 0.06, 0.03],
    ]); // 腳踝護甲
    P(
      g,
      gPod([
        [-0.48, 0.38, -fh, -fh + 0.05, 0.01, 0.004],
        [0.24, 0.36, -fh, -fh + 0.05, 0.01, 0.004],
      ]),
      M.joint,
    ); // 鞋底
    P(
      g,
      gPod([
        [-0.36, 0.38, -fh + 0.04, -0.15, 0.05, 0.01],
        [0.1, 0.38, -fh + 0.04, -0.1, 0.06, 0.01],
        [0.22, 0.32, -fh + 0.04, -0.16, 0.04, 0.01],
      ]),
      M.main2,
    );
    P(
      g,
      gPod([
        [-0.49, 0.3, -fh + 0.03, -0.215, 0.035, 0.01],
        [-0.35, 0.37, -fh + 0.03, -0.155, 0.045, 0.01],
      ]),
      M.grey,
    ); // 腳尖
    P(g, gBox(fw * 0.7, 0.02, 0.015), M.acc, 0, -0.16, -0.355, 0.5);
    for (const t of [-0.28, 0.28]) {
      P(g, gBox(fw * 0.22, fh * 0.45, 0.1), M.joint, t * fw, -fh * 0.68, 0.25);
      P(g, gBox(fw * 0.16, fh * 0.26, 0.04), red, t * fw, -fh * 0.68, 0.29);
    }
    decal(g, 2, 0.14, 0.14, s * (fw / 2 + 0.006), -fh * 0.62, -0.06, 0, (s * Math.PI) / 2, 0);
    if (info.part.id === 'l_hv') {
      // 重二足：加寬的鞋底（底面同高）＋腳背護甲
      P(
        g,
        gPod([
          [-0.52, 0.42, -fh, -fh + 0.08, 0.02, 0.004],
          [0.26, 0.46, -fh, -fh + 0.09, 0.02, 0.004],
        ]),
        M.joint,
      );
      P(g, gPlate(trap(0.3, 0.26, 0.24), 0.06, 0.02, 0.85, 1), M.sub, 0, -0.14, -0.24, -1.1);
    }
  },
  // 武器：buildWeapon 的造型以舊版大機甲的尺寸製作，依新比例等比縮小（手持 ×0.5、肩上 ×0.55）
  weapon(g, info, { M }) {
    const inner = new THREE.Group();
    inner.scale.setScalar(0.5);
    g.add(inner);
    buildWeapon(inner, info.part, M, info.side);
  },
  back(g, info, { M }) {
    const inner = new THREE.Group();
    inner.scale.setScalar(0.55);
    g.add(inner);
    buildWeapon(inner, info.part, M, info.side);
  },
};
// 四足／履帶的腰部支柱：把新比例的上半身架到原本的身高（八角柱＋液壓桿＋頂部座板）
function waistPost(g, M, y0, y1) {
  P(g, gCyl(0.2, 0.26, y1 - y0, 8), M.joint, 0, (y0 + y1) / 2, 0);
  for (const s of [-1, 1]) kitPiston(g, M, s * 0.3, y0 + 0.02, 0.15, s * 0.16, y1 - 0.12, 0.08, 0.03);
  P(g, gPlate(trap(0.6, 0.5, 0.6), 0.08, 0.02), M.sub, 0, y1 - 0.08, 0, Math.PI / 2);
}

function makeProcPiece(info, ctx) {
  const g = new THREE.Group();
  (BUILD[info.kind] || (() => {}))(g, info, ctx);
  // 變形到內建預設機甲的外框（先合併成網格；區塊本身維持單位變換，換成 GLB、拖曳原點等都以區塊本身為準）
  const k = pieceDeform(info);
  if (k) {
    bakeAll(g);
    deformPiece(g, k);
  }
  g.userData.slot = info.slot;
  return g;
}
// 單獨建立一個區塊的程式模型（模型庫用）；asm 只影響隨核心變化的細節（重型核心的背包）
export function buildPiece(info, pal, asm) {
  const g = makeProcPiece(info, pieceCtx(pal, asm));
  bakeAll(g);
  g.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  return g;
}

// ===== 組裝整台機甲 =====
// opts.piece(info)：回傳要取代程式模型的物件（GLB），或 null 使用程式模型
// opts.source：這台機甲用的模型組 { model(slot, pal, unique), joints }（遊戲依機甲指定；沒有時用全域的模型來源與關節覆寫）
// 回傳的 rig：animateMech 驅動的關節群組（legs／arms／head／torso）＋ mounts（所有連接點，模型庫顯示與即時調整用）
export function buildMech(asm, pal, scale = 1, opts = {}) {
  if (opts.source && !opts.inSource)
    return withJoints(opts.source.joints, () => buildMech(asm, pal, scale, { ...opts, inSource: true }));
  const p = asmParts(asm);
  const ctx = pieceCtx(pal, asm);
  const all = mechPieces(asm);
  const bySlot = (pred) => all.find(pred);
  const pieces = {};
  const mounts = [];
  const provided = [];
  const place = (parent, info) => {
    // 沒有指定 opts.piece 時問模型來源（遊戲的本地模型庫）；每台機甲各自一份材質（受擊閃光）
    let obj = opts.piece
      ? opts.piece(info)
      : opts.source
        ? opts.source.model(info.slot, pal, true)
        : providedModel(info.slot, pal, true);
    if (obj && !opts.piece) provided.push(obj);
    if (!obj) {
      obj = makeProcPiece(info, ctx);
      obj.userData.proc = true;
    }
    obj.userData.slot = info.slot;
    parent.add(obj);
    pieces[info.slot] = obj;
    return obj;
  };
  // 連接點群組（位置、旋轉來自父區塊）；子區塊的關節群組掛在它下面，動作只改關節群組的旋轉
  const mountAt = (parent, info, name) => {
    const c = opts.defaultConns ? defaultConn(info, name) : connOf(info, name);
    const g = new THREE.Group();
    g.position.copy(c.p);
    g.rotation.copy(c.r);
    g.userData.conn = { slot: info.slot, name };
    parent.add(g);
    mounts.push({ slot: info.slot, name, node: g });
    return g;
  };
  const joint = (parent) => {
    const j = new THREE.Group();
    parent.add(j);
    return j;
  };
  const root = new THREE.Group();
  // lift：自動貼地的上下位移（腿部換成 GLB 或改了腿部連接點時，見 refreshGround），腿與上半身都在它底下
  const lift = new THREE.Group();
  root.add(lift);
  const legsG = new THREE.Group();
  lift.add(legsG);
  const type = p.legs.type;
  const cls = coreClass(p);
  const hipY = legHipY(type);
  const legs = [];
  // ===== 腿 =====
  const lp = (n, k) => bySlot((i) => i.cat === 'legs' && i.kind === n && i.key === k);
  const base = lp(type === 'biped' || type === 'reverse' ? 'pelvis' : 'body', null);
  place(legsG, base);
  if (type === 'biped' || type === 'reverse') {
    const rev = type === 'reverse';
    for (const k of ['l', 'r']) {
      const s = SIDE_OF[k];
      const thigh = joint(mountAt(legsG, base, 'hip_' + k)); // 大腿樞軸：襠部側面偏上（距頂面 0.09）
      const ti = lp('thigh', k);
      place(thigh, ti);
      const knee = joint(mountAt(thigh, ti, 'knee'));
      const si = lp('shin', k);
      place(knee, si);
      // 逆關節：小腿 →（跗關節）→ 蹠骨 →（腳踝）→ 腳掌；站姿＝關節角度全部 0
      let hock = null;
      if (rev) {
        hock = joint(mountAt(knee, si, 'hock'));
        place(hock, lp('meta', k));
      }
      const foot = rev ? joint(mountAt(hock, lp('meta', k), 'ankle')) : joint(mountAt(knee, si, 'ankle'));
      place(foot, lp('foot', k));
      const th = rev ? 0 : 0.08,
        kn = rev ? 0 : -0.15,
        ft = rev ? 0 : 0.07;
      thigh.rotation.x = th;
      knee.rotation.x = kn;
      foot.rotation.x = ft;
      legs.push({ thigh, knee, hock, foot, side: s, th, kn, hk: 0, ft });
    }
  } else if (type === 'quad') {
    for (const [k, sx, sz] of QUAD_LEGS) {
      const thigh = joint(mountAt(legsG, base, 'hip_' + k));
      const ti = lp('thigh', k);
      place(thigh, ti);
      const knee = joint(mountAt(thigh, ti, 'knee'));
      const si = lp('qshin', k);
      place(knee, si);
      const foot = joint(mountAt(knee, si, 'ankle'));
      place(foot, lp('qfoot', k));
      // 站姿＝關節角度全部 0（GLB 的姿勢就是待機姿勢）；步行由 animateMech 的螃蟹步伐解兩段骨頭
      legs.push({ thigh, knee, foot, side: sx, sz, quad: true });
    }
  }
  // ===== 軀幹：腰部連接點下的 torso 群組（動作改它的旋轉與上下起伏）=====
  const torso = joint(mountAt(lift, base, 'waist'));
  const ci = bySlot((i) => i.cat === 'core');
  place(torso, ci);
  // 背包：噴口是連接點（噴焰為粒子特效，由實體依推力發射）
  const bp = joint(mountAt(torso, ci, 'backpack'));
  const bi = bySlot((i) => i.cat === 'booster');
  place(bp, bi);
  const nozzles = ['nozzle_l', 'nozzle_r'].map((n) => mountAt(bp, bi, n));
  // 頭
  const head = joint(mountAt(torso, ci, 'neck'));
  place(
    head,
    bySlot((i) => i.cat === 'head'),
  );
  // 手臂：肩（核心）→ 上臂 → 手肘 → 前臂 → 手腕 → 手 → 握點 → 武器；肩上武器座（核心）→ 肩上武器
  const arms = {};
  for (const k of ['l', 'r']) {
    const ap = (n) => bySlot((i) => i.cat === 'arms' && i.kind === n && i.key === k);
    const shM = mountAt(torso, ci, 'shoulder_' + k);
    const up = joint(shM);
    place(up, ap('upper'));
    const fore = joint(mountAt(up, ap('upper'), 'elbow'));
    place(fore, ap('fore'));
    const hand = joint(mountAt(fore, ap('fore'), 'wrist'));
    place(hand, ap('hand'));
    const weapon = joint(mountAt(hand, ap('hand'), 'grip'));
    const wi = bySlot((i) => i.cat === 'weapon' && i.key === k);
    if (wi) place(weapon, wi);
    up.rotation.order = 'ZYX';
    up.rotation.x = 0.35;
    fore.rotation.x = 1.2;
    const back = joint(mountAt(torso, ci, 'back_' + k)); // 肩上武器箱：外移到肩線外側，避免遮住頭
    const bwi = bySlot((i) => i.cat === 'back' && i.key === k);
    if (bwi) place(back, bwi);
    // 會轉的槍管（GLB 裡名稱為 spin 的節點，例如格林機槍：繞自己的 Z 軸＝槍管方向轉，開火時轉、停火後慢慢停下）
    const spin = weapon.getObjectByName('spin') || null;
    arms[k] = { mount: shM, up, fore, hand, weapon, back, spin, spinV: 0, spinHold: 0 };
  }
  bakeAll(root);
  // 建立時的站姿（腿的關節角度），自動貼地以這個姿勢量測
  for (const L of legs) L.pose0 = legJoints(L).map((o) => o.rotation.clone());
  if (type === 'quad') quadRest(legs, legsG);
  const M = ctx.M;
  const mats = [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun, M.grey];
  if (opts.extraMats) mats.push(...opts.extraMats);
  for (const o of provided) mats.push(...matsOf(o));
  const rig = {
    group: root,
    legsG,
    torso,
    head,
    arms,
    legs,
    nozzles,
    pieces,
    mounts,
    lift,
    ground: {
      legs: asm.legs || START_ASM.legs,
      pal,
      base: base.slot,
      infos: all.filter((i) => i.cat === 'legs'),
      defaults: !!opts.defaultConns,
      joints: opts.source ? opts.source.joints || {} : null, // 模型組的關節設定（重新計算貼地時沿用）
      auto: 0,
      fine: 0,
    },
    hipY,
    torsoY: 0,
    type,
    cls,
    height: (waistY(type) + LAY.upperH) * scale,
    coreH: PIECE_BOX.core[1][4],
    mats,
    flashT: 0,
  };
  if (!opts.noGround) refreshGround(rig);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  tagStyle(root);
  return rig;
}

// 四足：記下站姿時每隻腳的腳踝位置（legsG 座標）與膝的彎曲軸（膝的區域座標），螃蟹步伐與 IK 用
const _qIdent = new THREE.Quaternion(),
  _qp = new THREE.Quaternion(),
  _qr = new THREE.Quaternion(),
  _qd = new THREE.Vector3(),
  _qe = new THREE.Vector3(),
  _qT = new THREE.Vector3();
const _qa = new THREE.Vector3(),
  _qb = new THREE.Vector3(),
  _qc = new THREE.Vector3(),
  _qq = new THREE.Quaternion();
function quadRest(legs, legsG) {
  legsG.updateMatrixWorld(true);
  const inv = legsG.matrixWorld.clone().invert();
  for (const L of legs) {
    L.rest = L.foot.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
    const kinv = L.knee.matrixWorld.clone().invert();
    const a = L.thigh.getWorldPosition(_qa).applyMatrix4(kinv);
    const c = L.foot.getWorldPosition(_qc).applyMatrix4(kinv);
    const h = new THREE.Vector3().crossVectors(c, a);
    L.hinge = h.lengthSq() > 1e-8 ? h.normalize() : new THREE.Vector3(0, 0, 1);
  }
}
// 兩段骨頭：大腿 a、膝 b（繞 L.hinge 彎）讓腳踝到世界座標 T（四足的螃蟹步伐；從站姿 0 開始解）
export function quadSolve(L, T) {
  L.thigh.quaternion.identity();
  L.knee.quaternion.identity();
  L.thigh.updateMatrixWorld(true);
  const A = L.thigh.getWorldPosition(_qa),
    B = L.knee.getWorldPosition(_qb),
    C = L.foot.getWorldPosition(_qc);
  const lab = A.distanceTo(B),
    lcb = B.distanceTo(C);
  const lat = clamp(A.distanceTo(T), Math.abs(lab - lcb) + 1e-3, lab + lcb - 1e-3);
  const ba = _qd.subVectors(A, B).normalize(),
    bc = _qe.subVectors(C, B).normalize();
  const ang0 = Math.acos(clamp(ba.dot(bc), -1, 1));
  const ang1 = Math.acos(clamp((lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb), -1, 1));
  L.knee.quaternion.setFromAxisAngle(L.hinge, ang0 - ang1);
  L.knee.updateMatrixWorld(true);
  const C2 = L.foot.getWorldPosition(_qc).sub(A).normalize();
  const want = _qd.subVectors(T, A).normalize();
  _qq.setFromUnitVectors(C2, want);
  // 世界座標的旋轉換到大腿父節點（髖的連接點）的區域座標
  const pq = L.thigh.parent.getWorldQuaternion(_qp);
  L.thigh.quaternion.copy(_qr.copy(pq).invert().multiply(_qq).multiply(pq));
}
// 腿的關節群組（逆關節多一個跗關節）
export const legJoints = (L) => (L.hock ? [L.thigh, L.knee, L.hock, L.foot] : [L.thigh, L.knee, L.foot]);
// 預設連接點（不套用關節設定）
function defaultConn(info, name) {
  const c = pieceConns(info)[name];
  return c ? { p: c.p.clone(), r: c.r.clone() } : { p: new THREE.Vector3(), r: new THREE.Euler() };
}
// 物件群的最低點（space 的區域座標；逐頂點計算，不含描邊與輔助物件）
function lowestY(objs, space) {
  space.updateMatrixWorld(true);
  const inv = space.matrixWorld.clone().invert();
  const m = new THREE.Matrix4(),
    v = new THREE.Vector3();
  let min = Infinity;
  for (const obj of objs)
    obj.traverse((o) => {
      if (!o.isMesh || o.material === OUTLINE_MAT || !o.geometry.attributes.position) return;
      for (let p = o; p && p !== obj; p = p.parent) if (p.userData.helper) return;
      m.multiplyMatrices(inv, o.matrixWorld);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++)
        min = Math.min(min, v.fromBufferAttribute(pos, i).applyMatrix4(m).y);
    });
  return min;
}
// 程式模型的腿（預設連接點）在站姿下的最低點，依腳部零件快取
const GROUND_REF = new Map();
function groundRef(legs, pal) {
  if (!GROUND_REF.has(legs)) {
    const ref = buildMech({ ...START_ASM, legs }, pal, 1, {
      piece: () => null,
      defaultConns: true,
      noGround: true,
    });
    const g = ref.ground;
    GROUND_REF.set(legs, lowestY(g.infos.map((i) => ref.pieces[i.slot]).filter(Boolean), ref.lift));
    ref.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
  }
  return GROUND_REF.get(legs);
}
// 自動貼地：腿部（襠部／主體、大腿、小腿、腳掌、履帶）有 GLB 或改過連接點時，在站姿下量最低點，
// 整台機甲上下移動到和程式模型的腿同樣的高度（程式模型＋預設連接點時位移為 0，與原本完全相同）；
// 另外加上腿部根區塊的「ground」關節設定（離地微調，glTF 的 p[1]）。只影響外觀，判定仍用 hipY 等常數。
// 組裝調整頁修改腿部連接點或原點後也呼叫它重新計算
export function refreshGround(rig) {
  const g = rig.ground;
  if (!g || !rig.lift) return;
  if (g.joints) return withJoints(g.joints, () => groundNow(rig));
  groundNow(rig);
}
function groundNow(rig) {
  const g = rig.ground;
  const objs = g.infos.map((i) => rig.pieces[i.slot]).filter(Boolean);
  const custom =
    !g.defaults &&
    (objs.some((o) => !o.userData.proc) ||
      g.infos.some((i) => Object.keys(pieceConns(i)).some((n) => jointSetting(i.slot, n))));
  g.auto = 0;
  if (custom) {
    // 暫時擺回建立時的站姿量測
    const saved = rig.legs.map((L) => legJoints(L).map((o) => o.rotation.clone()));
    const lp = rig.legsG.position.clone(),
      lr = rig.legsG.rotation.clone();
    rig.legs.forEach((L) => legJoints(L).forEach((o, k) => o.rotation.copy(L.pose0[k])));
    rig.legsG.position.set(0, 0, 0);
    rig.legsG.rotation.set(0, 0, 0);
    const low = lowestY(objs, rig.lift);
    rig.legs.forEach((L, j) => legJoints(L).forEach((o, k) => o.rotation.copy(saved[j][k])));
    rig.legsG.position.copy(lp);
    rig.legsG.rotation.copy(lr);
    if (Number.isFinite(low)) g.auto = Math.round((groundRef(g.legs, g.pal) - low) * 1000) / 1000;
  }
  const fine = g.defaults ? null : jointSetting(g.base, 'ground');
  g.fine = fine && fine.p ? +fine.p[1] || 0 : 0;
  // 只有上下位移（組裝調整頁拖曳襠部時會暫時移動、旋轉它，這裡一併歸位）
  rig.lift.position.set(0, g.auto + g.fine, 0);
  rig.lift.quaternion.identity();
}

const SPIN_MAX = 32; // 槍管全速（rad/s）
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
      if (m.flashT <= 0) unflash(m);
    }
    if (m.cls === 'heli') {
      m.torso.rotation.x = lerp(m.torso.rotation.x, -(st.leanX || 0) * 0.6, 0.1); // 加速時機頭下壓（正面 −Z）
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
        // 逆關節（四段）的 GLB 原本的姿勢就是待機姿勢：不再往外張
        const sp = L.hock ? 0 : 1;
        P(L.thigh, L.th * 0.3, 0, L.side * 0.14 * sp);
        P(L.knee, L.kn * 0.5, 0, 0);
        if (L.hock) P(L.hock, 0, 0, 0);
        P(L.foot, L.ft * 0.5, 0, -L.side * 0.12 * sp);
      }
    } // 立正：雙腳微張、腳掌貼地
    if (m.type === 'quad')
      for (const L of m.legs) {
        L.thigh.quaternion.slerp(_qIdent, 0.12);
        L.knee.quaternion.slerp(_qIdent, 0.12);
        if (L.qo) L.qo.set(0, 0, 0);
      }
    m.legsG.rotation.z = lerp(m.legsG.rotation.z, 0, 0.12);
    m.legsG.rotation.y = lerp(m.legsG.rotation.y, 0, 0.12);
    P(m.torso, 0, 0, 0);
    m.torso.position.y = m.torsoY !== undefined ? m.torsoY : m.hipY + 0.12;
    if (m.head) P(m.head, 0.05, 0.45, -0.05);
    if (m.head) P(m.head, 0, 0, 0);
    const R = m.arms.r,
      L = m.arms.l;
    P(R.up, 0.05, 0, 0.3);
    P(R.fore, 0.35, 0, 0);
    P(L.up, 0.05, 0, -0.3);
    P(L.fore, 0.35, 0, 0); // 雙手外張（A 字站姿）自然下垂
    m.thrust = lerp(m.thrust || 0, 0.05, 0.2);
    if (m.flashT > 0) {
      m.flashT -= dt;
      if (m.flashT <= 0) unflash(m);
    }
    return;
  }
  const strafe = st.strafe || 0,
    turn = st.turn || 0,
    land = st.landT !== undefined ? st.landT : 9,
    aimRel = st.aimRel || 0,
    ap = clamp(st.aimPitch || 0, -0.6, 0.6);
  const gp = st.gait !== undefined ? st.gait : t * 11; // 步伐相位（實體開「步伐依移動距離」時依速度推進）
  const fwdV = st.fwd || 0; // 前進速度比例（-1 後退 ~ 1 前進，機體座標）
  const ML = st.melee; // 近戰姿勢 {kind, ph, mirror, side}
  const squat = land < 0.35 ? Math.sin((land / 0.35) * Math.PI) * 0.6 : 0; // 落地蹲踞（0.35 s 內壓下再彈回）
  const idle = !st.moving && st.grounded && !st.boost;
  // ===== 腿：髖三軸（俯仰＝擺動、外展＝側移／落地、偏航＝轉向）＋膝＋踝兩軸 =====
  if (m.type === 'biped' || m.type === 'reverse') {
    // 逆關節（四段）的膝和二足同向彎（膝在前），往後折的是跗關節：蹠骨依膝的彎曲連動（HOCK_K），
    // 腳掌再補回同樣的角度保持貼地；所以這裡的膝、腳掌都照二足算
    const rev = false;
    for (const L of m.legs) {
      const sp = L.hock ? 0 : 1; // 逆關節（四段）：站姿就是 GLB 原本的姿勢，待機與步行不再往外張
      let th = L.th,
        kn = L.kn,
        ft = L.ft;
      let abd = 0,
        hy = 0,
        ftRoll = 0;
      if (st.grounded && st.moving) {
        const ph = gp + (L.side > 0 ? 0 : Math.PI);
        const sw = Math.sin(ph);
        const fa = st.amp !== undefined ? st.amp : Math.max(0.35, Math.abs(fwdV)); // 擺幅（依速度推進步伐時由實體給）
        const sa = Math.abs(strafe);
        th += sw * 0.6 * fa * (fwdV < -0.2 ? -1 : 1);
        // 抬腳：依速度推進步伐時在腿往前擺的期間（cos(ph) > 0）抬，支撐腳才會往後踩；否則維持原本的節奏
        kn += (rev ? -0.5 : 0.55) * Math.max(0, st.amp !== undefined ? Math.cos(ph) : -Math.sin(ph + 0.4));
        ft += -sw * 0.25 * fa; // 前後步伐（面向不變，後退時反向擺腿）
        abd =
          L.side * (L.hock ? -WALK_IN : 0.08) +
          sa * 0.42 * Math.max(0, -strafe * L.side) +
          sa * Math.sin(ph) * 0.22 * L.side; // 側步：往側移方向那條腿張開＋交替橫跨
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
        abd = L.side * 0.07 * sp;
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
      if (L.hock) {
        const hk = L.hk - HOCK_K * (kn - L.kn);
        L.hock.rotation.x = lerp(L.hock.rotation.x, hk, k);
        ft -= hk - L.hk;
      }
      L.foot.rotation.x = lerp(L.foot.rotation.x, ft, k);
      L.foot.rotation.z = lerp(L.foot.rotation.z, ftRoll, ks);
    }
    // 髖部搖擺（步行時左右交替）與骨盆偏航
    m.legsG.rotation.z = lerp(m.legsG.rotation.z, st.grounded && st.moving ? Math.sin(gp) * 0.04 : 0, ks);
    m.legsG.rotation.y = 0;
  } else if (m.type === 'quad' && m.legs[0] && m.legs[0].rest) {
    // ===== 四足：螃蟹式步伐 =====
    // 對角的兩隻腳一組（左前＋右後、右前＋左後）交替：擺動期抬腳沿移動方向前送，支撐期貼地往後推；
    // 原地轉向時腳沿身體周圍的切線方向踏步。腳踝的目標位置（legsG 座標）＝站姿＋位移，每格解兩段骨頭
    const moving = st.grounded && st.moving;
    const fa = st.amp !== undefined ? st.amp : Math.max(0.35, Math.abs(fwdV));
    let dx = strafe,
      dz = -fwdV;
    const dl = Math.hypot(dx, dz);
    if (dl > 1) ((dx /= dl), (dz /= dl));
    m.legsG.updateWorldMatrix(true, false);
    for (const L of m.legs) {
      const ph = gp * 0.8 + (L.side * L.sz > 0 ? 0 : Math.PI);
      const sw = Math.sin(ph),
        up = Math.max(0, Math.cos(ph));
      // 這隻腳的步伐方向：移動方向＋轉向的切線（繞身體中心）
      const r = L.rest;
      let ox = dx - turn * r.z * 0.35,
        oz = dz + turn * r.x * 0.35;
      const ol = Math.hypot(ox, oz);
      if (ol > 1) ((ox /= ol), (oz /= ol));
      const stride = 0.55 * Math.min(1.4, fa) * (moving ? 1 : 0);
      const tx = moving ? ox * stride * sw : 0,
        tz = moving ? oz * stride * sw : 0,
        ty = (moving && ol > 0.05 ? up * 0.38 : 0) + (st.grounded ? 0 : 0.3) + squat * 0.45;
      L.qo = L.qo || new THREE.Vector3();
      L.qo.x = lerp(L.qo.x, tx, k);
      L.qo.y = lerp(L.qo.y, ty, k);
      L.qo.z = lerp(L.qo.z, tz, k);
      const tuck = st.grounded ? 1 : 0.9; // 空中：腳往身體收
      const T = _qT
        .set(r.x * tuck + L.qo.x, r.y + L.qo.y, r.z * tuck + L.qo.z)
        .applyMatrix4(m.legsG.matrixWorld);
      quadSolve(L, T);
    }
  }
  m.legsG.position.y = st.grounded ? 0 : Math.sin(t * 4) * 0.05;
  // ===== 軀幹：上下起伏、蹲踞下沉、俯仰跟瞄準、步行時反向扭腰 =====
  m.torso.position.y =
    (m.torsoY !== undefined ? m.torsoY : m.hipY + 0.12) -
    squat * 0.35 +
    (st.grounded && st.moving
      ? Math.abs(Math.sin(gp)) * 0.06
      : idle
        ? Math.sin(t * 1.3) * 0.025
        : Math.sin(t * 3) * 0.04);
  // 俯仰正值＝後仰（機體正面是 −Z）：瞄準往上時後仰；移動時微微前傾、前進／QB／推進更前傾、後退後仰、落地蹲踞前傾
  let tX =
    ap * 0.25 -
    (st.grounded && st.moving ? 0.03 : 0) -
    (st.qb ? 0.12 : 0) -
    squat * 0.25 -
    fwdV * 0.08 -
    (st.boost ? 0.08 : 0);
  let tZ = -strafe * 0.14 - (st.grounded && st.moving ? Math.sin(gp) * 0.03 : 0); // 側移時上身向移動方向傾
  let tYoff = 0; // 人形：上半身不與下半身分離扭轉（近戰招式除外）
  if (ML) {
    const ph = ML.ph,
      s = ML.mirror ? -1 : 1;
    if (ML.kind === 'spin') {
      tYoff += ph * Math.PI * 2;
      tX = -0.25;
    } else if (ML.kind === 'thrust') {
      tX = ph < 0.3 ? 0.25 : -0.45; // 蓄力後仰、刺出前傾
      tYoff += s * (ph < 0.3 ? 0.5 : -0.3);
    } else if (ML.kind === 'slam') {
      tX = ph < 0.4 ? 0.45 : -0.55;
    } else {
      tYoff += s * (ph < 0.3 ? 0.7 : -0.6 * (1 - ph));
      tX = ph < 0.3 ? 0.1 : -0.3;
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
  // ===== 推進器推力（0～1，噴焰粒子依此發射）=====
  const fl = st.boost ? 1 : st.hover ? 0.65 : !st.grounded ? 0.4 : st.moving ? 0.27 : 0.04;
  m.thrust = lerp(m.thrust || 0, fl, Math.min(1, dt * 10));
  // ===== 手臂：肩外展／內收、上臂三軸、前臂、揮擊、後座 =====
  for (const kk of ['l', 'r']) {
    const a = m.arms[kk];
    const side = kk === 'r' ? 1 : -1;
    const rec = (st.recoil && st.recoil[kk]) || 0;
    if (a.spin) {
      // 開火（後座）時加速到全速、停火 0.25 秒後慢慢停下
      if (rec > 0.02) a.spinHold = 0.25;
      else a.spinHold = Math.max(0, a.spinHold - dt);
      const on = a.spinHold > 0;
      a.spinV = on ? Math.min(SPIN_MAX, a.spinV + dt * 60) : Math.max(0, a.spinV - dt * 14);
      if (a.spinV > 0) a.spin.rotation.z = (a.spin.rotation.z + a.spinV * dt * side) % (Math.PI * 2);
    }
    const sw = (st.swing && st.swing[kk]) || 0;
    const firing = rec > 0.05;
    let abd =
      0.35 +
      (st.boost || !st.grounded ? 0.35 : 0) +
      (st.qb ? 0.25 : 0) +
      (idle ? Math.sin(t * 1.3 + side) * 0.03 : 0) -
      (firing ? 0.1 : 0) +
      Math.max(0, sw) * 0.5; // 外展：飛行／QB 張開、開火收攏
    let twist = firing
      ? -side * 0.15
      : st.grounded && st.moving
        ? Math.sin(gp + (side > 0 ? Math.PI : 0)) * 0.08
        : 0;
    let up =
      0.35 +
      ap * 0.4 +
      rec * 0.5 +
      sw * 0.9 +
      (st.grounded && st.moving && !firing
        ? Math.sin(gp + (side > 0 ? Math.PI : 0)) * 0.42 - fwdV * 0.25
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
    a.up.rotation.order = 'ZYX'; // 上臂（含肩甲）以肩關節為軸：外展／內收、扭轉、前後擺
    a.up.rotation.z = lerp(a.up.rotation.z, side * abd * 0.65, ks); // 正值＝外展（左臂在 −X）
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
        L.knee.rotation.x = lerp(L.knee.rotation.x, L.kn + 0.4, 0.2);
        L.thigh.rotation.z = lerp(L.thigh.rotation.z, L.side * 0.35, 0.2);
      }
  }
  if (m.flashT > 0) {
    m.flashT -= dt;
    if (m.flashT <= 0) unflash(m);
  }
}

export function mechFlash(m, color, dur = 0.07) {
  if (!m || !m.mats) return;
  m.flashT = dur;
  const c = color !== undefined ? new THREE.Color(color) : new THREE.Color(0.9, 0.9, 0.9);
  for (const mm of m.mats) mm.emissive.copy(c);
}
