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
  gSph,
  kitBolts,
  kitCable,
  kitGrille,
  kitVents,
} from './geometry.js';
import { mechMats } from './materials.js';
import { jointSetting, resolveConn } from './mech-joints.js';
import { matsOf } from './glb.js';
import { providedModel } from './model-provider.js';
// 受擊閃光結束後還原的自發光（GLB 材質記錄在 userData.emis0，程式材質為黑）
const BLACK = new THREE.Color(0);
const unflash = (m) => {
  for (const mm of m.mats) mm.emissive.copy(mm.userData.emis0 || BLACK);
};

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

// ---------------- MECH v7 — 寫實比例（參考圖：約 10.7 頭身、腿長約 58%、細腰、寬肩甲） ----------------
// 二足站立：腳踝 0.30、膝 1.12、髖 1.94、腰 2.22、胸頂 3.15、頭 3.02～3.33；肩甲外緣寬約 1.9
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
}; // 量自參考圖正視圖（1 px ≈ 0.00431 m，頭頂 3.33）

// ===== 區塊（piece）=====
// 機甲由一塊塊「區塊」組成，每塊都可以單獨換成 GLB；區塊的原點＝它的旋轉中心（接到父區塊的位置）。
// 父區塊上的「連接點」決定子區塊接在哪裡（例：核心決定肩、脖子；上臂決定手肘）。連接點預設值在
// pieceConns()，可被關節設定（mech-joints.js）覆寫。槽位 id：
//   head/<id>、core/<id>、booster/<id>
//   arms/<id>/<r|l>_<upper|fore|hand>
//   legs/<id>/pelvis＋<r|l>_<thigh|shin|foot>（二足、逆關節）、legs/<id>/body＋<fl|fr|bl|br>_<thigh|shin>（四足）、
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
  qshin: '小腿（含腳）',
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
  qshin: '膝關節轉軸',
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
    return [L('body', null), ...QUAD_LEGS.flatMap(([k]) => [L('thigh', k), L('shin', k, 'qshin')])];
  if (legType === 'tank') return [L('body', null)];
  return [L('pelvis', null), ...['r', 'l'].flatMap((k) => [L('thigh', k), L('shin', k), L('foot', k)])];
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
// 區塊的連接點預設值（遊戲座標：正面 −Z、單位公尺、相對於區塊原點）
export function pieceConns(info) {
  const R = CUBE;
  switch (info.kind) {
    case 'core': {
      const o = {
        neck: C0(V(0, R.neckY, 0)),
        backpack: C0(V(0, 0.55, R.td / 2 + 0.2)),
      };
      for (const [k, s] of Object.entries(SIDE_OF)) {
        o['shoulder_' + k] = C0(V(s * R.shX, R.shY, 0));
        o['back_' + k] = C0(V(s * 0.6, R.shY + R.padH / 2 + 0.36, 0.22)); // 肩上武器座：肩甲正上方偏後
      }
      return o;
    }
    case 'booster':
      return {
        nozzle_l: C0(V(-0.21, -0.44, 0.26)),
        nozzle_r: C0(V(0.21, -0.44, 0.26)),
      };
    case 'upper':
      return { elbow: C0(V(0, -R.upL, 0)) };
    case 'fore':
      return { wrist: C0(V(0, -R.foreL, 0)) };
    case 'hand':
      return { grip: C0(V(0, -R.fist * 0.3, -R.fist * 0.3), [-Math.PI / 2, 0, 0]) };
    case 'pelvis': {
      const hipY = legHipY(info.legType);
      return {
        waist: C0(V(0, waistY(info.legType), 0)),
        hip_r: C0(V(R.hipX, hipY, 0)),
        hip_l: C0(V(-R.hipX, hipY, 0)),
      };
    }
    case 'body': {
      const hipY = legHipY(info.legType);
      const o = { waist: C0(V(0, waistY(info.legType), 0)) };
      if (info.legType === 'quad')
        for (const [k, sx, sz] of QUAD_LEGS) o['hip_' + k] = C0(V(sx * 0.85, hipY - 0.1, sz * 0.7));
      return o;
    }
    case 'thigh':
      return info.legType === 'quad'
        ? { knee: C0(V(0, -0.8, 0)) }
        : { knee: C0(V(0, -R.thighL, info.legType === 'reverse' ? 0.12 : 0)) };
    case 'shin':
      return { ankle: C0(V(0, -R.shinL, 0)) };
    default:
      return {};
  }
}
// 髖關節高度：二足、逆關節依待機姿勢讓腳掌貼地（逆關節的大腿後擺 0.35、膝前彎 0.6，所以較低）
function legHipY(type) {
  const R = CUBE;
  if (type === 'reverse')
    return +(R.thighL * Math.cos(0.35) + R.shinL * Math.cos(0.25) + R.ankleH).toFixed(2);
  return type === 'quad' ? 1.3 : type === 'tank' ? 1.1 : R.hipY;
}
// 腰（核心座）高度：決定上半身高度與遊戲判定的身高（不隨關節設定改變）。
// 四足、履帶的下半身造型不變，以腰部支柱把上半身架到和舊版相同的身高
function waistY(type) {
  return type === 'quad' ? 2.18 : type === 'tank' ? 1.98 : legHipY(type) + CUBE.waistUp;
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
    case 'foot':
      return { kind: 'shin', name: 'ankle' };
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
const BUILD = {
  // 小頭盔：灰色頭盒＋紅色護目鏡＋黑色下巴，半埋在左右胸塊之間
  head(g, info, { M, red }) {
    const R = CUBE,
      hw = R.headW,
      hh = R.headH,
      hd = R.headD;
    P(g, gCyl(0.07, 0.08, 0.1, 8), M.joint, 0, 0.03, 0.02); // 脖子
    CB(g, hw, hh * 0.78, hd, M.grey, 0, hh * 0.55, 0.01, 0, 0, 0, 0.05);
    CB(g, hw * 1.06, hh * 0.18, hd * 0.92, M.sub, 0, hh * 0.9, 0.03, 0, 0, 0, 0.03); // 頂蓋
    CB(g, hw * 0.82, hh * 0.15, 0.05, red, 0, hh * 0.6, -hd * 0.5, 0, 0, 0, 0.015); // 護目鏡
    CB(g, hw * 0.62, hh * 0.24, hd * 0.4, M.joint, 0, hh * 0.22, -hd * 0.3, 0, 0, 0, 0.02); // 下巴
    for (const s of [-1, 1]) {
      CB(g, 0.05, hh * 0.42, hd * 0.5, M.sub, s * (hw / 2 + 0.025), hh * 0.55, 0.02, 0, 0, 0, 0.015);
      P(g, gCyl(0.03, 0.03, 0.02, 8), M.lens, s * (hw / 2 + 0.055), hh * 0.55, -hd * 0.05, 0, 0, Math.PI / 2);
    } // 側耳感測塊
    P(g, gCyl(0.01, 0.01, 0.5, 4), M.joint, hw * 0.25, hh + 0.25, 0.06);
    if (info.part.id === 'h_hv')
      CB(g, hw * 1.2, 0.06, hd * 0.5, M.sub, 0, hh * 0.98, -hd * 0.15, 0, 0, 0, 0.02);
    if (info.part.id === 'h_scan') {
      P(g, gCyl(0.06, 0.06, 0.06, 8), M.lens, hw * 0.25, hh + 0.04, 0.06);
      P(g, gCyl(0.015, 0.015, 0.7, 4), M.joint, -hw * 0.25, hh + 0.35, 0.06);
    }
  },
  // 核心：黑色細腰＋腹甲＋胸部三塊（中央柱放頭、左右胸塊較高）；原點在腰部
  core(g, info, { M, red }) {
    const R = CUBE,
      cd = R.td,
      cx = R.cx,
      sx = (R.tw - cx) / 2,
      top = R.chestTop,
      nk = R.neckY,
      sideB = 0.36;
    CB(g, 0.48, 0.24, 0.4, M.joint, 0, 0.05, 0.02, 0, 0, 0, 0.04); // 細腰（黑色腰部機構）
    for (let i = 0; i < 2; i++)
      CB(g, 0.38 - i * 0.04, 0.09, 0.44, M.grey, 0, 0.14 + i * 0.09, -0.02, 0, 0, 0, 0.02); // 腹甲
    CB(g, 0.7, 0.16, cd * 0.86, M.sub, 0, 0.36, 0, 0, 0, 0, 0.04); // 下胸
    CB(g, cx, nk - 0.3, cd, M.grey, 0, (nk + 0.3) / 2, 0, 0, 0, 0, 0.05); // 中央柱（灰）
    CB(g, cx * 0.7, 0.06, 0.05, red, 0, nk - 0.08, -cd * 0.5, 0, 0, 0, 0.015); // 中央頂端紅色指示燈
    for (let i = 0; i < 3; i++) P(g, gBox(cx * 0.8, 0.02, 0.02), M.joint, 0, 0.36 + i * 0.05, -cd * 0.44); // 散熱縫
    for (const s of [-1, 1]) {
      const x = s * (cx / 2 + sx / 2 - 0.01);
      CB(g, sx, top - sideB, cd * 1.04, M.main, x, (top + sideB) / 2, -0.02, 0, 0, 0, 0.05); // 左右胸塊
      P(g, gBox(sx * 0.86, 0.03, 0.02), M.acc, x, top - 0.07, -cd * 0.53);
      kitBolts(
        g,
        M,
        [
          [x - s * sx * 0.32, sideB + 0.08, -cd * 0.53],
          [x + s * sx * 0.32, sideB + 0.08, -cd * 0.53],
          [x + s * sx * 0.32, top - 0.15, -cd * 0.53],
        ],
        0.02,
      );
      decal(g, s > 0 ? 1 : 3, 0.18, 0.18, x, (top + sideB) / 2, -cd * 0.53, 0, Math.PI, 0);
      decal(g, 2, 0.24, 0.24, s * (R.tw / 2 + 0.005), (top + sideB) / 2, 0.03, 0, (s * Math.PI) / 2, 0);
      kitVents(g, M, s * (R.tw / 2 - 0.02), top - 0.14, -cd * 0.2, 4, 0.08, Math.PI / 2, 0.055);
      CB(g, 0.14, 0.2, 0.3, M.joint, s * (R.tw / 2 + 0.03), R.shY, 0, 0, 0, 0, 0.02); // 肩關節座
    }
    P(g, gBox(cx * 0.7, (nk - 0.3) * 0.45, 0.03), M.sub, 0, nk - 0.26, -cd * 0.51);
    for (let i = 0; i < 2; i++)
      P(g, gCyl(0.03, 0.03, 0.03, 8), red, -0.06 + i * 0.12, nk - 0.16, -cd * 0.53, Math.PI / 2);
    decal(g, 3, 0.15, 0.15, 0, nk - 0.32, -cd * 0.52, 0, Math.PI, 0); // 中央面板＋紅燈＋AC 標記
    P(g, gBox(cx * 0.8, 0.04, cd * 0.6), M.acc, 0, nk + 0.01, 0);
  },
  // 背包：中央箱＋兩個方塊推進器（噴焰是粒子特效，不是模型）
  booster(g, info, { M, heavy }) {
    const bw = 0.7,
      bh = 0.62,
      bd = 0.4;
    CB(g, bw, bh, bd, M.main, 0, 0, 0.02, 0, 0, 0, 0.05);
    decal(g, 5, 0.28, 0.28, 0, bh * 0.22, bd / 2 + 0.03, 0, 0, 0); // Power Backpack
    kitGrille(g, M, 0, -bh * 0.12, bd / 2 + 0.03, bw * 0.45, 0.12, 5);
    for (const s of [-1, 1]) {
      CB(g, 0.18, 0.26, 0.18, M.sub, s * 0.21, -0.22, 0.26, 0, 0, 0, 0.03);
      P(g, gCyl(0.08, 0.1, 0.1, 10), M.joint, s * 0.21, -0.39, 0.26);
      P(g, gBox(0.07, 0.24, 0.04), M.acc, s * bw * 0.42, 0.06, bd / 2 + 0.02);
    }
    if (heavy)
      for (const s of [-1, 1])
        P(g, gCyl(0.14, 0.14, bh * 0.9, 10), M.main, s * bw * 0.18, 0.04, bd / 2 + 0.12);
    P(g, gCyl(0.012, 0.012, 0.8, 4), M.joint, bw * 0.12, bh / 2 + 0.4, 0.05);
  },
  // 上臂：肩關節＋外伸的灰色大肩甲（下方有推進器噴口）＋上臂（綠）＋黃色環帶
  upper(g, info, { M }) {
    const R = CUBE,
      s = info.side,
      pw = R.padW,
      ph = R.padH,
      pd = R.padD,
      px = s * (pw / 2 - 0.06),
      py = 0.17;
    P(g, gCyl(0.12, 0.12, 0.24, 10), M.joint, -s * 0.02, 0, 0, 0, 0, Math.PI / 2);
    CB(g, pw, ph, pd, M.grey, px, py, 0, 0, 0, 0, 0.06); // 大肩甲
    CB(g, pw * 0.62, ph * 0.4, 0.05, M.sub, px + s * 0.04, py + ph * 0.12, -pd / 2 - 0.02, 0, 0, 0, 0.015);
    decal(g, 7, 0.22, 0.22, px + s * (pw / 2 + 0.01), py, 0, 0, (s * Math.PI) / 2, 0);
    kitBolts(
      g,
      M,
      [
        [px + s * (pw / 2 + 0.01), py + ph * 0.38, pd * 0.35, 0, Math.PI / 2],
        [px + s * (pw / 2 + 0.01), py + ph * 0.38, -pd * 0.35, 0, Math.PI / 2],
      ],
      0.025,
    );
    P(g, gCyl(0.07, 0.09, 0.1, 10), M.joint, px + s * pw * 0.25, py - ph / 2 - 0.05, pd * 0.18); // 肩甲下噴口
    P(g, gCyl(0.06, 0.06, 0.02, 10), M.lens, px + s * pw * 0.25, py - ph / 2 - 0.1, pd * 0.18);
    const ul = R.upL,
      aw = R.upW;
    CB(g, aw, ul - 0.12, aw * 1.08, M.main, 0, -(ul + 0.08) / 2, 0, 0, 0, 0, 0.04);
    P(g, gBox(aw * 1.04, 0.05, aw * 1.12), M.acc, 0, -ul * 0.62, 0);
    kitBolts(g, M, [[s * aw * 0.5, -ul * 0.4, 0, 0, Math.PI / 2]], 0.025);
  },
  // 前臂（藍，比上臂粗）＋手肘圓柱＋灰板＋外側噴口＋「01」
  fore(g, info, { M }) {
    const R = CUBE,
      s = info.side,
      fl = R.foreL,
      fw = R.foreW;
    P(g, gCyl(0.11, 0.11, R.upW + 0.08, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    CB(g, fw, fl - 0.08, fw, M.main2, 0, -fl / 2 - 0.02, 0, 0, 0, 0, 0.05);
    CB(g, fw * 0.76, fl * 0.5, 0.05, M.grey, 0, -fl * 0.45, -fw * 0.5, 0, 0, 0, 0.015);
    decal(g, 7, 0.18, 0.18, s * (fw / 2 + 0.01), -fl * 0.4, 0, 0, (s * Math.PI) / 2, 0);
    kitVents(g, M, -s * fw * 0.5, -fl * 0.3, 0.06, 3, 0.04, Math.PI / 2, 0.06);
    P(g, gCyl(0.06, 0.08, 0.1, 10), M.joint, s * (fw / 2 + 0.05), -fl * 0.72, 0.06, 0, 0, (s * Math.PI) / 2);
    P(g, gCyl(0.05, 0.05, 0.02, 10), M.lens, s * (fw / 2 + 0.1), -fl * 0.72, 0.06, 0, 0, (s * Math.PI) / 2);
  },
  // 四指關節手＋拇指
  hand(g, info, { M }) {
    const fs = CUBE.fist,
      s = info.side;
    P(g, gCyl(0.06, 0.06, 0.14, 8), M.joint, 0, -0.02, 0, 0, 0, Math.PI / 2);
    CB(g, fs * 0.75, fs * 0.55, fs * 0.8, M.grey, 0, -fs * 0.32, 0, 0, 0, 0, 0.03);
    for (let f = 0; f < 4; f++) {
      CB(g, 0.045, 0.1, 0.06, M.joint, -0.08 + f * 0.053, -fs * 0.7, -fs * 0.2, 0, 0, 0, 0.012);
      CB(g, 0.04, 0.08, 0.055, M.grey, -0.08 + f * 0.053, -fs * 0.95, -fs * 0.25, 0, 0, 0, 0.012);
    }
    CB(g, 0.06, 0.1, 0.07, M.joint, s * fs * 0.42, -fs * 0.45, -fs * 0.15, 0, 0, 0, 0.012);
  },
  // 襠部（藍）＋髖軸＋前後腰裙；原點在地面
  pelvis(g, info, { M }) {
    const R = CUBE,
      hy = legHipY(info.legType),
      wy = waistY(info.legType),
      pd = R.pelvisD;
    CB(g, R.pelvisW, R.pelvisH, pd, M.main2, 0, wy - R.pelvisH / 2 - 0.02, 0, 0, 0, 0, 0.05);
    P(g, gCyl(0.1, 0.1, R.hipX * 2 - 0.1, 10), M.joint, 0, hy, 0, 0, 0, Math.PI / 2); // 髖軸
    CB(g, 0.3, 0.52, 0.06, M.grey, 0, wy - 0.3, -pd / 2 - 0.05, 0.12, 0, 0, 0.02); // 前腰裙
    P(g, gBox(0.2, 0.03, 0.02), M.acc, 0, wy - 0.12, -pd / 2 - 0.1, 0.12);
    decal(g, 0, 0.12, 0.12, 0, wy - 0.3, -pd / 2 - 0.1, 0.12, Math.PI, 0);
    CB(g, 0.36, 0.42, 0.06, M.main2, 0, wy - 0.26, pd / 2 + 0.05, -0.15, 0, 0, 0.02); // 後腰裙
  },
  body(g, info, { M }) {
    const wy = waistY(info.legType);
    if (info.legType === 'quad') {
      const hipY = legHipY('quad');
      CB(g, 1.6, 0.5, 1.6, M.sub, 0, hipY - 0.05, 0, 0, 0, 0, 0.08);
      CB(g, 1.2, 0.3, 1.2, M.main, 0, hipY + 0.3, 0, 0, 0, 0, 0.05);
      waistPost(g, M, hipY + 0.42, wy);
      return;
    }
    // 履帶
    CB(g, 1.7, 0.6, 2.2, M.sub, 0, 0.85, 0, 0, 0, 0, 0.08);
    CB(g, 1.2, 0.3, 1.4, M.main, 0, 1.25, 0, 0, 0, 0, 0.05);
    waistPost(g, M, 1.37, wy);
    for (const s of [-1, 1]) {
      CB(g, 0.8, 0.9, 2.8, M.joint, s * 1.25, 0.5, 0, 0, 0, 0, 0.1);
      CB(g, 0.84, 0.16, 2.9, M.main2, s * 1.25, 1.0, 0, 0, 0, 0, 0.04);
      for (let i = -1; i <= 1; i++)
        P(g, gCyl(0.36, 0.36, 0.86, 10), M.acc, s * 1.25, 0.45, i * 0.95, 0, 0, Math.PI / 2);
      for (let i = 0; i < 9; i++) {
        P(g, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.08, -1.3 + i * 0.32);
        P(g, gBox(0.86, 0.08, 0.16), M.rubber, s * 1.25, 0.96, -1.3 + i * 0.32);
      }
    }
  },
  thigh(g, info, { M }) {
    if (info.legType === 'quad') {
      P(g, gCyl(0.18, 0.18, 0.5, 8), M.joint, 0, 0, 0, Math.PI / 2);
      CB(g, 0.42, 0.8, 0.42, M.main2, 0, -0.4, 0, 0, 0, 0, 0.06);
      return;
    }
    // 黑色大腿骨架＋外側大護甲（參考圖從腰裙兩側垂下的大板）
    const R = CUBE,
      s = info.side,
      rev = info.legType === 'reverse',
      tw = R.thighW,
      tl = R.thighL,
      z = rev ? 0.06 : 0,
      ax = s * 0.07,
      aw = 0.46,
      ad = 0.42;
    P(g, gSph(0.15, 12), M.joint, 0, 0, 0); // 髖球關節
    CB(g, tw, tl - 0.1, tw * 1.05, M.joint, 0, -tl / 2 - 0.02, z, 0, 0, 0, 0.04);
    CB(g, aw, 0.7, ad, M.main, ax, -0.15, z, 0, 0, 0, 0.06); // 大腿護甲
    P(g, gBox(0.07, 0.44, 0.02), M.acc, ax + s * 0.12, -0.15, z - ad / 2 - 0.005);
    CB(g, 0.2, 0.26, 0.05, M.grey, ax - s * 0.08, -0.22, z - ad / 2 - 0.01, 0, 0, 0, 0.015);
    kitBolts(
      g,
      M,
      [
        [ax + s * (aw / 2 + 0.005), 0.06, z + 0.1, 0, Math.PI / 2],
        [ax + s * (aw / 2 + 0.005), -0.36, z + 0.1, 0, Math.PI / 2],
      ],
      0.025,
    );
    decal(g, 7, 0.22, 0.22, ax + s * (aw / 2 + 0.01), -0.15, z - 0.05, 0, (s * Math.PI) / 2, 0);
  },
  // 小腿：膝蓋圓柱＋灰色膝甲＋上段（綠）／下段（藍）＋膝外側與小腿後方的推進器
  shin(g, info, { M }) {
    const R = CUBE,
      s = info.side,
      sw = R.shinW,
      sl = R.shinL;
    P(g, gCyl(0.12, 0.12, R.thighW + 0.1, 10), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    CB(g, sw + 0.04, 0.34, 0.12, M.grey, 0, 0.06, -sw / 2 - 0.04, 0, 0, 0, 0.03); // 膝甲
    CB(g, sw, sl * 0.5, sw * 1.1, M.main, 0, -sl * 0.33, 0, 0, 0, 0, 0.05);
    CB(g, sw * 0.96, sl * 0.42, sw * 1.04, M.main2, 0, -sl * 0.76, 0, 0, 0, 0, 0.05);
    P(g, gBox(sw * 0.6, 0.03, 0.02), M.acc, 0, -sl * 0.56, -sw * 0.53);
    decal(g, 7, 0.18, 0.18, 0, -sl * 0.78, -sw * 0.53, 0, Math.PI, 0); // 黃分隔線＋「01」
    kitVents(g, M, -s * sw * 0.5, -sl * 0.2, 0.06, 3, 0.04, Math.PI / 2, 0.06);
    P(g, gCyl(0.06, 0.08, 0.1, 10), M.joint, s * (sw / 2 + 0.06), -0.08, 0.06); // 膝外側噴口
    P(g, gCyl(0.05, 0.05, 0.02, 10), M.lens, s * (sw / 2 + 0.06), -0.14, 0.06);
    CB(g, 0.18, 0.28, 0.1, M.sub, 0, -sl * 0.35, sw * 0.55 + 0.04, 0, 0, 0, 0.02); // 小腿後推進器
    P(g, gCyl(0.06, 0.07, 0.08, 10), M.joint, 0, -sl * 0.35 - 0.18, sw * 0.55 + 0.04);
  },
  // 四足的小腿（含腳）
  qshin(g, info, { M }) {
    P(g, gCyl(0.16, 0.16, 0.46, 8), M.joint, 0, 0, 0, Math.PI / 2);
    CB(g, 0.38, 0.7, 0.38, M.main, 0, -0.35, 0, 0, 0, 0, 0.05);
    CB(g, 0.5, 0.24, 0.6, M.sub, 0, -0.8, 0, 0, 0, 0, 0.04);
  },
  // 腳掌（藍）＋腳踝圓柱與護甲＋腳趾塊＋腳跟推進器；底面在腳踝下 ankleH（貼地）
  foot(g, info, { M, red }) {
    const R = CUBE,
      s = info.side,
      fl = R.footL,
      fw = R.footW,
      fh = R.ankleH;
    P(g, gCyl(0.1, 0.1, fw * 0.8, 8), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
    CB(g, fw * 0.72, 0.16, 0.3, M.main, 0, -0.04, -0.02, 0, 0, 0, 0.03); // 腳踝護甲
    CB(g, fw, fh * 0.6, fl * 0.7, M.main2, 0, -fh * 0.7, -fl * 0.06, 0, 0, 0, 0.04);
    CB(g, fw * 0.92, fh * 0.45, fl * 0.3, M.grey, 0, -fh + fh * 0.225, -fl * 0.52, 0, 0, 0, 0.03); // 腳趾
    for (const t of [-0.28, 0.28])
      P(g, gBox(fw * 0.3, fh * 0.3, 0.06), M.joint, t * fw, -fh * 0.8, -fl * 0.69);
    for (const t of [-0.28, 0.28]) {
      P(g, gBox(fw * 0.22, fh * 0.45, 0.1), M.joint, t * fw, -fh * 0.68, fl * 0.33);
      P(g, gBox(fw * 0.16, fh * 0.26, 0.04), red, t * fw, -fh * 0.68, fl * 0.39);
    }
    decal(g, 2, 0.16, 0.16, s * (fw / 2 + 0.01), -fh * 0.7, -fl * 0.06, 0, (s * Math.PI) / 2, 0);
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
// 四足／履帶的腰部支柱：把新比例的上半身架到原本的身高
function waistPost(g, M, y0, y1) {
  P(g, gCyl(0.2, 0.26, y1 - y0, 12), M.joint, 0, (y0 + y1) / 2, 0);
  CB(g, 0.6, 0.08, 0.6, M.sub, 0, y1 - 0.08, 0, 0, 0, 0, 0.02);
}

function makeProcPiece(info, ctx) {
  const g = new THREE.Group();
  (BUILD[info.kind] || (() => {}))(g, info, ctx);
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
// 回傳的 rig：animateMech 驅動的關節群組（legs／arms／head／torso）＋ mounts（所有連接點，模型庫顯示與即時調整用）
export function buildMech(asm, pal, scale = 1, opts = {}) {
  const p = asmParts(asm);
  const ctx = pieceCtx(pal, asm);
  const all = mechPieces(asm);
  const bySlot = (pred) => all.find(pred);
  const pieces = {};
  const mounts = [];
  const provided = [];
  const place = (parent, info) => {
    // 沒有指定 opts.piece 時問模型來源（遊戲的本地模型庫）；每台機甲各自一份材質（受擊閃光）
    let obj = opts.piece ? opts.piece(info) : providedModel(info.slot, pal, true);
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
      const foot = joint(mountAt(knee, si, 'ankle'));
      place(foot, lp('foot', k));
      const th = rev ? -0.35 : 0.08,
        kn = rev ? 0.6 : -0.15,
        ft = rev ? -0.25 : 0.07;
      thigh.rotation.x = th;
      knee.rotation.x = kn;
      foot.rotation.x = ft;
      legs.push({ thigh, knee, foot, side: s, th, kn, ft });
    }
  } else if (type === 'quad') {
    for (const [k, sx, sz] of QUAD_LEGS) {
      const thigh = joint(mountAt(legsG, base, 'hip_' + k));
      const ti = lp('thigh', k);
      place(thigh, ti);
      const knee = joint(mountAt(thigh, ti, 'knee'));
      place(knee, lp('qshin', k));
      thigh.rotation.z = sx * 0.8;
      thigh.rotation.x = sz * 0.3;
      knee.rotation.z = -sx * 1.4;
      legs.push({ thigh, knee, foot: knee, side: sx, sz });
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
    arms[k] = { mount: shM, up, fore, hand, weapon, back };
  }
  bakeAll(root);
  // 建立時的站姿（腿的關節角度），自動貼地以這個姿勢量測
  for (const L of legs) L.pose0 = [L.thigh, L.knee, L.foot].map((o) => o.rotation.clone());
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
      auto: 0,
      fine: 0,
    },
    hipY,
    torsoY: 0,
    type,
    cls,
    height: (waistY(type) + CUBE.upperH) * scale,
    coreH: CUBE.chestTop,
    mats,
    flashT: 0,
  };
  if (!opts.noGround) refreshGround(rig);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  return rig;
}

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
  const objs = g.infos.map((i) => rig.pieces[i.slot]).filter(Boolean);
  const custom =
    !g.defaults &&
    (objs.some((o) => !o.userData.proc) ||
      g.infos.some((i) => Object.keys(pieceConns(i)).some((n) => jointSetting(i.slot, n))));
  g.auto = 0;
  if (custom) {
    // 暫時擺回建立時的站姿量測
    const saved = rig.legs.map((L) => [L.thigh, L.knee, L.foot].map((o) => o.rotation.clone()));
    const lp = rig.legsG.position.clone(),
      lr = rig.legsG.rotation.clone();
    rig.legs.forEach((L) => [L.thigh, L.knee, L.foot].forEach((o, k) => o.rotation.copy(L.pose0[k])));
    rig.legsG.position.set(0, 0, 0);
    rig.legsG.rotation.set(0, 0, 0);
    const low = lowestY(objs, rig.lift);
    rig.legs.forEach((L, j) => [L.thigh, L.knee, L.foot].forEach((o, k) => o.rotation.copy(saved[j][k])));
    rig.legsG.position.copy(lp);
    rig.legsG.rotation.copy(lr);
    if (Number.isFinite(low)) g.auto = Math.round((groundRef(g.legs, g.pal) - low) * 1000) / 1000;
  }
  const fine = g.defaults ? null : jointSetting(g.base, 'ground');
  g.fine = fine && fine.p ? +fine.p[1] || 0 : 0;
  rig.lift.position.y = g.auto + g.fine;
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
      if (m.flashT <= 0) unflash(m);
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
  // ===== 推進器推力（0～1，噴焰粒子依此發射）=====
  const fl = st.boost ? 1 : st.hover ? 0.65 : !st.grounded ? 0.4 : st.moving ? 0.27 : 0.04;
  m.thrust = lerp(m.thrust || 0, fl, Math.min(1, dt * 10));
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
    a.up.rotation.order = 'ZYX'; // 上臂（含肩甲）以肩關節為軸：外展／內收、扭轉、前後擺
    a.up.rotation.z = lerp(a.up.rotation.z, -side * abd * 0.65, ks);
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
    if (m.flashT <= 0) unflash(m);
  }
}

export function mechFlash(m, color, dur = 0.07) {
  if (!m || !m.mats) return;
  m.flashT = dur;
  const c = color !== undefined ? new THREE.Color(color) : new THREE.Color(0.9, 0.9, 0.9);
  for (const mm of m.mats) mm.emissive.copy(c);
}
