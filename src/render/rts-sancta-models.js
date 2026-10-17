// Coral 戰爭（RTS）聖域互助同盟的模型（docs/rts-design.md 16.5，R5 B 包）：「撿來的東西拼的」聚落——組合屋、貨櫃改的房間、
// 帆布棚、補丁屋頂、水塔、晾衣繩、太陽能板、輪胎與沙包；固定的辨識材質是鏽紅的補丁鋼板＋白色手漆的互助圓環（不換隊伍色，
// 不用黃色：中立隊伍是黃色）。建模函式都是純函式（不呼叫亂數、不碰遊戲狀態；需要變化時用固定的雜湊）。
// 建築的 rig 同 render/rts-models.js 的 buildRtsBuilding：{ group, body, scaf, torso, height, vehicle, cls, progress,
//   setProgress(p), aimAt(yaw, pitch) }；另外：
//   - 聚落中心三階：tier2／tier3 與 setTier(1～3)（T2 廢車圍牆與瞭望台、T3 混凝土外牆、大水塔與無線電天線）。
//   - 回收站：crane（磁吸吊車，慢慢轉）。改裝工坊：spark（焊接火花，閃爍）。瞭望塔：turret（繞 Y）、gun（俯仰）、muzzle。
//   - 廢鐵路障：variants（4 種外觀，骨頭、只切 visible）與 setVariant(i)；第一次算繪時依位置的雜湊選（兩邊同一個位置同一種）。
//   - 施工：鷹架換成木架＋帆布（scaf），和卡斯特隆的鋼鷹架區分。
// 單位的外加零件：互助作業機的拾荒套件 addSancWorkerKit、回收拖車的吊臂 addHaulerKit（砲塔換掉，setHaul(f) 展開）、
// 拼裝巨像 addColossusKit、改裝的零件 addRefitKits（6 種一次建好、隱藏，換改裝只切 visible，不必重新合併）。
// 殘骸 buildWreckBatch（4 種廢鐵堆各一個 InstancedMesh）、地雷 buildMineBatch、圓頂 buildDomeShell。
import { PALETTES } from './materials.js';
import { DETAIL, PK, ladder, mat, railing, truss } from '../world/prop-models.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';
import { buildMech } from './mech-model.js';
import { buildVehicle } from './vehicle-models.js';
import { isOutline } from './geometry.js';

export const SANC_RUST = 0x9a4a32;
export const SANC_LAMP = 0xffd890;
const glowMat = (c, k = 1.4) => mat(c, { emissive: c, emissiveIntensity: k, roughness: 0.4, metalness: 0 });

// 配色（同 rts-models.js 的 rtsPal；不 import rts-models.js 以免循環）
export function sancPal(team = 0) {
  const base = PALETTES.sancta;
  const tc = RTS_TEAM_COLORS[team] !== undefined ? RTS_TEAM_COLORS[team] : RTS_TEAM_COLORS[0];
  return { ...base, main2: new THREE.Color(tc).multiplyScalar(0.42).getHex(), acc: tc, visor: tc, glow: tc };
}
// 建材：米白、淺米、灰褐、深底、隊伍色塗裝、鏽紅補丁、白漆、木頭、帆布、輪胎、沙包、混凝土、太陽能板、暖燈、隊伍色的燈
function mats(pal) {
  return {
    beige: mat(pal.main || 0xa89c7e, { roughness: 0.82, metalness: 0.2 }),
    beige2: mat(pal.main3 || 0xc0b494, { roughness: 0.8, metalness: 0.18 }),
    brown: mat(0x5e5848, { roughness: 0.85, metalness: 0.25 }),
    dark: mat(pal.sub || 0x2a2620, { roughness: 0.8, metalness: 0.35 }),
    team: mat(pal.main2, { roughness: 0.7, metalness: 0.3 }),
    rust: mat(SANC_RUST, { roughness: 0.9, metalness: 0.45 }),
    white: mat(0xe6e0cc, { roughness: 0.75, metalness: 0.05 }),
    wood: mat(0x7a5a3a, { roughness: 0.92, metalness: 0.02 }),
    canvas: mat(0xb8a888, { roughness: 0.95, metalness: 0 }),
    canvas2: mat(0x8a7a5a, { roughness: 0.95, metalness: 0 }),
    tire: mat(0x1c1c1c, { roughness: 0.95, metalness: 0.05 }),
    sand: mat(0x9c8a64, { roughness: 1, metalness: 0 }),
    conc: mat(0x77736b, { roughness: 0.95, metalness: 0.05 }),
    solar: mat(0x1e2a44, { roughness: 0.35, metalness: 0.55 }),
    steel: DETAIL.steel,
    glass: DETAIL.glass,
    lamp: glowMat(SANC_LAMP, 1.2),
    glow: glowMat(pal.glow || SANC_LAMP),
    coral: mat(0xff3d5a, { emissive: 0xff2244, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 }),
  };
}
// 位置的雜湊（0～1，固定）
const hash01 = (a, b = 0) => {
  let h = (Math.imul((a * 73856093) | 0, 1) ^ Math.imul((b * 19349663) | 0, 1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// ---------- 會自己動的獨立網格（不合併；onBeforeRender 自己更新矩陣） ----------
function selfAnim(mesh, { spin = 0, blink = 0, op = 1 } = {}) {
  mesh.userData.rtsSpin = spin || blink; // 有 userData：網格合併略過（render/mesh-merge.js、rts-merge.js）
  mesh.castShadow = false;
  mesh.onBeforeRender = () => {
    const t = performance.now() / 1000;
    if (spin) mesh.rotation.y = t * spin;
    if (blink) mesh.material.opacity = Math.sin(t * blink * 6.283) > 0.55 || (t * 7.3) % 1 < 0.12 ? op : 0;
    mesh.updateMatrix();
    if (mesh.parent) mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
  };
  return mesh;
}
function addMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
// 一組 PK 的零件合成一個獨立網格（用在會自己動的零件）
function oneMesh(fn, material) {
  const k = new PK();
  fn(k, material);
  const g = k.build(new THREE.Group(), false);
  const m = g.children[0];
  g.remove(m);
  m.material = material;
  return m;
}

// ---------- 共用的零件 ----------
// 互助圓環（白色手漆，面向 +Z；ry 轉向）
function emblem(k, M, r, x, y, z, ry = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.cb(M.rust, r * 2.6, r * 2.6, 0.06, 0, 0, 0, 0, 0, 0, 0.02);
    k.geo(M.white, new THREE.TorusGeometry(r, r * 0.16, 4, 14), 0, 0, 0.05);
    k.box(M.white, r * 0.22, r * 1.3, 0.04, 0, 0, 0.05); // 圓環中的「手」：兩條交叉的線
    k.box(M.white, r * 1.3, r * 0.22, 0.04, 0, 0, 0.05);
  });
}
// 補丁鋼板（鏽紅，貼在面上；ry 指向外側法線）
function patch(k, M, w, h, x, y, z, ry = 0, tilt = 0.06) {
  k.at(x, y, z, 0, ry, tilt, () => {
    k.box(M.rust, w, h, 0.06, 0, 0, 0);
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) k.box(M.dark, 0.07, 0.07, 0.04, (sx * w) / 2.4, (sy * h) / 2.4, 0.04);
  });
}
// 組合屋（w×h×d，原點在底面中心）：外牆、窗帶、門、略微出簷的屋頂、補丁；col＝外牆材質
function prefab(k, M, w, h, d, x, y, z, ry = 0, col = null, seed = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.cb(col || M.beige, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.05);
    k.box(M.brown, w + 0.25, 0.14, d + 0.25, 0, h + 0.07, 0); // 屋頂板
    const nw = Math.max(1, Math.floor(w / 1.8));
    for (let i = 0; i < nw; i++) {
      const xx = -w / 2 + (w * (i + 0.5)) / nw;
      if (i === 0 && w > 2.4) {
        k.box(M.dark, 0.9, Math.min(2, h * 0.75), 0.06, xx, Math.min(1, h * 0.375), d / 2 + 0.02); // 門
        continue;
      }
      k.box(M.glass, 0.8, 0.55, 0.05, xx, h * 0.62, d / 2 + 0.02);
      k.box(M.dark, 0.95, 0.08, 0.08, xx, h * 0.62 - 0.32, d / 2 + 0.05);
    }
    if (hash01(seed, 3) > 0.35) patch(k, M, 1.2, 0.9, w * 0.28, h * 0.4, d / 2 + 0.04);
    if (hash01(seed, 5) > 0.5) patch(k, M, 0.9, 1.1, w / 2 + 0.04, h * 0.5, 0, Math.PI / 2);
  });
}
// 貨櫃改的房間（w×h×d）：波浪板外殼＋開窗＋鏽紅門
function crate(k, M, w, h, d, x, y, z, ry = 0, col = null) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.cb(col || M.brown, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.05);
    const n = Math.max(2, Math.round(w / 0.8));
    for (let i = 1; i < n; i++) k.box(M.dark, 0.06, h * 0.85, d + 0.04, -w / 2 + (w * i) / n, h / 2, 0);
    k.box(M.rust, 0.9, h * 0.8, 0.06, w / 2 - 0.6, h * 0.42, d / 2 + 0.03);
    k.box(M.glass, 0.9, 0.5, 0.05, -w * 0.15, h * 0.6, d / 2 + 0.03);
  });
}
// 帆布棚：4 根木柱＋斜的帆布頂（w×d，前高 h0、後高 h1）
function tarp(k, M, w, d, h0, h1, x, z, ry = 0, cloth = null) {
  k.at(x, 0, z, 0, ry, 0, () => {
    for (const sx of [-1, 1]) {
      k.box(M.wood, 0.14, h0, 0.14, (sx * w) / 2, h0 / 2, d / 2);
      k.box(M.wood, 0.14, h1, 0.14, (sx * w) / 2, h1 / 2, -d / 2);
    }
    const ang = Math.atan2(h1 - h0, d);
    k.box(
      cloth || M.canvas,
      w + 0.4,
      0.06,
      Math.hypot(d, h1 - h0) + 0.3,
      0,
      (h0 + h1) / 2 + 0.05,
      0,
      ang,
      0,
      0,
    );
  });
}
// 水塔：4 根腳＋斜撐＋圓桶＋圓錐頂
function waterTower(k, M, r, h, x, z, y = 0) {
  k.at(x, y, z, 0, 0, 0, () => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        k.box(M.steel, 0.14, h, 0.14, sx * r * 0.75, h / 2, sz * r * 0.75);
        k.bar(
          M.steel,
          [sx * r * 0.75, h * 0.2, sz * r * 0.75],
          [-sx * r * 0.75, h * 0.7, sz * r * 0.75],
          0.06,
        );
      }
    k.cyl(M.beige2, r, r, r * 1.5, 0, h + r * 0.75, 0, 0, 0, 0, 12);
    k.cyl(M.rust, r * 1.02, r * 1.02, r * 0.3, 0, h + r * 0.5, 0, 0, 0, 0, 12);
    k.cyl(M.brown, 0.05, r * 1.08, r * 0.55, 0, h + r * 1.78, 0, 0, 0, 0, 12);
  });
}
function sandbags(k, M, n, x, y, z, ry = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    for (let r = 0; r < 2; r++)
      for (let i = 0; i < n - r; i++)
        k.cb(
          M.sand,
          0.7,
          0.3,
          0.42,
          -((n - 1 - r) * 0.36) + i * 0.72,
          0.15 + r * 0.28,
          0,
          0,
          0.05 * (i % 2),
          0,
          0.1,
        );
  });
}
function tires(k, M, n, x, y, z) {
  for (let i = 0; i < n; i++)
    k.geo(
      M.tire,
      new THREE.TorusGeometry(0.42, 0.17, 5, 10),
      x + (i % 2) * 0.06,
      y + 0.17 + i * 0.32,
      z,
      Math.PI / 2,
      0,
      0,
    );
}
function barrel(k, M, x, y, z, col = null) {
  k.cyl(col || M.rust, 0.32, 0.32, 0.95, x, y + 0.48, z, 0, 0, 0, 8);
  k.cyl(M.dark, 0.34, 0.34, 0.06, x, y + 0.25, z, 0, 0, 0, 8);
  k.cyl(M.dark, 0.34, 0.34, 0.06, x, y + 0.72, z, 0, 0, 0, 8);
}
function solar(k, M, w, x, y, z, ry = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.box(M.steel, 0.1, 0.8, 0.1, 0, 0.4, 0);
    k.box(M.solar, w, 0.06, w * 0.6, 0, 0.85, 0, -0.45, 0, 0);
    k.box(M.steel, w + 0.08, 0.04, 0.06, 0, 0.88, -w * 0.27, -0.45, 0, 0);
  });
}
// 晾衣繩：兩根桿子＋繩子＋幾塊布（顏色是固定的）
function clothesline(k, M, len, x, y, z, ry = 0) {
  k.at(x, y, z, 0, ry, 0, () => {
    for (const s of [-1, 1]) k.box(M.wood, 0.08, 2.2, 0.08, (s * len) / 2, 1.1, 0);
    k.box(M.dark, len, 0.025, 0.025, 0, 2.05, 0);
    const cols = [M.white, M.canvas2, M.rust, M.beige2];
    const n = Math.max(2, Math.floor(len / 0.9));
    for (let i = 0; i < n; i++)
      k.box(cols[i % cols.length], 0.55, 0.7, 0.03, -len / 2 + 0.6 + i * 0.85, 1.68, 0);
  });
}
// 舊車的車殼（廢車圍牆）：車身＋車頂＋輪子
function carHulk(k, M, x, y, z, ry = 0, col = null) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.cb(col || M.rust, 3.6, 0.9, 1.7, 0, 0.75, 0, 0, 0, 0, 0.12);
    k.cb(M.beige, 1.9, 0.7, 1.55, -0.2, 1.5, 0, 0, 0, 0, 0.12);
    k.box(M.dark, 1.7, 0.45, 1.58, -0.2, 1.5, 0);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        k.cyl(M.tire, 0.36, 0.36, 0.24, sx * 1.2, 0.36, sz * 0.86, Math.PI / 2, 0, 0, 8);
  });
}

// ---------- 建築的本體 ----------
// 聚落中心（16×16、高 12）：舊倉庫改的主屋（拼接的組合屋＋帆布棚＋水塔＋旗竿上的互助圓環旗）
function hqBody(k, M) {
  k.cb(M.conc, 16, 0.6, 16, 0, 0.3, 0, 0, 0, 0, 0.2);
  // 主屋：舊倉庫（鋸齒屋頂）
  k.cb(M.beige, 11, 6, 9, -0.5, 3.6, -2, 0, 0, 0, 0.1);
  for (let i = 0; i < 3; i++)
    k.prism(
      M.brown,
      [
        [0, 0],
        [3.7, 0],
        [3.7, 1.6],
      ],
      9.2,
      -6 + i * 3.67,
      6.6,
      -2,
    );
  for (let i = 0; i < 3; i++) k.box(M.glass, 0.06, 1.3, 8.8, -2.35 + i * 3.67, 7.35, -2);
  k.box(M.team, 11.2, 0.6, 9.2, -0.5, 6.2, -2); // 隊伍色的腰帶
  k.box(M.dark, 3.6, 3.4, 0.1, -0.5, 2.3, 2.52); // 大門
  for (let i = 0; i < 5; i++) k.box(M.brown, 3.6, 0.08, 0.12, -0.5, 0.9 + i * 0.68, 2.58);
  patch(k, M, 2.2, 1.6, -4.2, 4.2, 2.56);
  patch(k, M, 1.6, 2.2, 3.6, 2.4, 2.56, 0, -0.05);
  patch(k, M, 2.4, 1.4, 5.04, 3.4, -3, Math.PI / 2);
  emblem(k, M, 0.9, 2.3, 4.6, 2.6);
  // 前面的帆布棚與兩個組合屋
  tarp(k, M, 7, 4, 3.2, 4.0, -0.5, 4.8, 0, M.canvas);
  prefab(k, M, 3.2, 2.6, 2.6, 5.6, 0.6, 5.2, -Math.PI / 2, M.beige2, 11);
  crate(k, M, 4.4, 2.5, 2.3, -6.0, 0.6, 5.4, Math.PI / 2, M.brown);
  // 屋頂的太陽能板、側面的水塔、旗竿
  solar(k, M, 2.4, -3.5, 7.0, -4.8);
  solar(k, M, 2.4, 0.2, 7.0, -4.8);
  waterTower(k, M, 1.3, 6.5, 6.0, -5.6, 0.6);
  k.cyl(M.steel, 0.07, 0.09, 6, -6.8, 3.6, 1.6, 0, 0, 0, 6);
  k.box(M.rust, 1.6, 1.0, 0.04, -6.0, 6.1, 1.6);
  k.geo(M.white, new THREE.TorusGeometry(0.3, 0.06, 4, 12), -6.0, 6.1, 1.63);
  // 回收點：前方的廢鐵與礦石投入斜槽
  k.cb(M.rust, 3, 0.8, 1.6, 3.4, 1.0, 6.9, -0.3, 0, 0, 0.08);
  tires(k, M, 3, -2.8, 0.6, 7.2);
  sandbags(k, M, 4, 1.0, 0.6, 7.4);
  clothesline(k, M, 3.6, 4.6, 0.6, -0.4, Math.PI / 2);
  k.box(M.lamp, 0.3, 0.2, 0.2, -0.5, 4.3, 2.6);
}
// T2：外圍的廢車圍牆與瞭望台
function hqTier2(k, M) {
  for (const [x, z, ry, c] of [
    [-6, -7.3, 0, 0],
    [-1.6, -7.4, 0.08, 1],
    [6.5, -6.2, Math.PI / 2, 0],
    [7.0, 0.6, Math.PI / 2 - 0.1, 1],
    [-7.1, -2.2, Math.PI / 2, 1],
  ])
    carHulk(k, M, x, 0.6, z, ry, c ? M.brown : M.rust);
  // 瞭望台（木架＋平台＋欄杆）
  k.at(-6.2, 0.6, -6.2, 0, 0, 0, () => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.wood, 0.18, 7.5, 0.18, sx * 1, 3.75, sz * 1);
    for (const y of [2.5, 5]) {
      k.bar(M.wood, [-1, y - 1.6, 1], [1, y, 1], 0.1);
      k.bar(M.wood, [1, y - 1.6, -1], [-1, y, -1], 0.1);
    }
    k.box(M.wood, 2.6, 0.16, 2.6, 0, 7.5, 0);
    railing(k, M.wood, 2.6, 0.9, 0, 7.6, 1.3);
    railing(k, M.wood, 2.6, 0.9, 0, 7.6, -1.3);
    k.box(M.canvas2, 2.8, 0.08, 2.8, 0, 9.3, 0, 0.12, 0, 0);
    for (const sx of [-1, 1]) k.box(M.wood, 0.1, 1.7, 0.1, sx * 1.25, 8.45, -1.25);
    ladder(k, M.wood, 7.5, 0, 0, 1.2);
  });
  emblem(k, M, 0.7, 7.75, 2.2, 0.6, Math.PI / 2);
}
// T3：整修的混凝土外牆、大型水塔與無線電天線
function hqTier3(k, M) {
  for (const [x, z, w, d] of [
    [0, -7.7, 15, 0.5],
    [-7.7, 0, 0.5, 9],
    [7.7, -2.5, 0.5, 10],
  ]) {
    k.cb(M.conc, w, 2.2, d, x, 1.7, z, 0, 0, 0, 0.08);
    k.box(M.team, w + 0.02, 0.3, d + 0.02, x, 2.5, z);
  }
  waterTower(k, M, 1.9, 9.5, -3.2, -5.8, 0.6);
  emblem(k, M, 0.9, -3.2, 12.8, -3.85);
  // 無線電天線（桁架）
  k.at(4.2, 6.6, -5.0, 0, 0, 0, () => {
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) k.bar(M.steel, [sx * 0.6, 0, sz * 0.6], [sx * 0.12, 9, sz * 0.12], 0.08);
    for (let y = 1.5; y < 9; y += 1.5) {
      const r = 0.6 - (0.48 * y) / 9;
      k.box(M.steel, r * 2, 0.06, 0.06, 0, y, r);
      k.box(M.steel, r * 2, 0.06, 0.06, 0, y, -r);
    }
    k.box(M.lamp, 0.3, 0.3, 0.3, 0, 9.3, 0);
  });
}
// 避難屋（7×7、高 5）：半埋的貨櫃＋沙包＋門口的燈
function depotBody(k, M) {
  k.cb(M.sand, 7, 1.1, 6.6, 0, 0.35, 0, 0, 0, 0, 0.5); // 堆起來的土
  crate(k, M, 6.2, 2.6, 2.6, 0, 0.2, -1.2, 0, M.brown);
  crate(k, M, 4.6, 2.4, 2.4, -0.6, 2.8, -1.0, 0, M.beige);
  sandbags(k, M, 4, -1.8, 0.4, 2.6);
  sandbags(k, M, 3, 2.2, 0.4, 2.4, -0.3);
  k.box(M.lamp, 0.25, 0.25, 0.25, 1.9, 2.2, 0.15);
  patch(k, M, 1.2, 0.9, -1.4, 3.9, 0.22);
  emblem(k, M, 0.45, 1.2, 4.0, 0.22);
  k.cyl(M.steel, 0.12, 0.12, 1.2, 2.2, 5.6, -2.2, 0, 0, 0, 6); // 煙囪
}
// 集會所（14×12、高 9）：大帳篷＋組合屋
function hallBody(k, M) {
  k.cb(M.conc, 14, 0.4, 12, 0, 0.2, 0, 0, 0, 0, 0.15);
  // 大帳篷：兩片斜帆布＋山牆
  k.at(-1.5, 0.4, -0.5, 0, 0, 0, () => {
    k.prism(
      M.canvas,
      [
        [-5, 0],
        [5, 0],
        [5, 3],
        [0, 7.6],
        [-5, 3],
      ],
      9,
      0,
      0,
      0,
    );
    k.box(M.canvas2, 10.6, 0.08, 5.8, -2.6, 5.35, 0, 0, 0, 0.73);
    k.box(M.canvas2, 10.6, 0.08, 5.8, 2.6, 5.35, 0, 0, 0, -0.73);
    k.box(M.team, 10.1, 0.5, 9.1, 0, 2.6, 0);
    k.box(M.dark, 3, 2.8, 0.1, 0, 1.4, 4.52); // 入口
    for (const sx of [-1, 1]) k.box(M.canvas2, 1.4, 2.8, 0.08, sx * 2.1, 1.4, 4.85, 0, sx * 0.5, 0);
    patch(k, M, 1.8, 1.2, 3.0, 3.6, 4.54);
    emblem(k, M, 0.8, 0, 5.1, 4.56);
  });
  prefab(k, M, 3, 3, 4.5, 5.4, 0.4, -2.6, 0, M.beige2, 21);
  crate(k, M, 3.6, 2.4, 2.3, 5.2, 0.4, 3.6, Math.PI / 2);
  barrel(k, M, -6.2, 0.4, 4.6);
  barrel(k, M, -5.4, 0.4, 5.0, M.brown);
  clothesline(k, M, 4, -1, 0.4, -5.6);
  k.box(M.lamp, 0.3, 0.2, 0.2, -1.5, 3.8, 4.1);
}
// 抽取站（8×8、高 9）：湧出點上的手搖式鑽塔＋油桶
function extractorBody(k, M) {
  k.cb(M.wood, 7.4, 0.4, 7.4, 0, 0.2, 0, 0, 0, 0, 0.1);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(M.wood, [sx * 3, 0.4, sz * 3], [sx * 0.5, 8.4, sz * 0.5], 0.22);
  for (const y of [2.5, 5]) {
    const r = 3 - (2.5 * (y - 0.4)) / 8;
    for (const s of [-1, 1]) {
      k.box(M.wood, r * 2, 0.14, 0.14, 0, y, s * r);
      k.box(M.wood, 0.14, 0.14, r * 2, s * r, y, 0);
    }
  }
  k.box(M.rust, 1.6, 0.4, 1.6, 0, 8.6, 0);
  k.cyl(M.steel, 0.18, 0.18, 7, 0, 4.4, 0, 0, 0, 0, 6);
  // 手搖輪與儲槽
  k.geo(M.rust, new THREE.TorusGeometry(0.7, 0.08, 4, 12), 2.2, 1.6, 1.9, 0, Math.PI / 2, 0);
  k.cyl(M.dark, 0.1, 0.1, 1.2, 2.2, 1.6, 1.9, 0, 0, Math.PI / 2, 6);
  k.cyl(M.beige2, 1.0, 1.0, 2.2, -2.4, 1.5, 2.2, 0, 0, 0, 10);
  k.box(M.coral, 0.15, 1.6, 0.06, -2.4, 1.6, 3.22);
  k.cyl(M.coral, 0.5, 0.7, 0.4, 0, 0.6, 0, 0, 0, 0, 8);
  for (let i = 0; i < 3; i++) barrel(k, M, 2.6 - i * 0.75, 0.4, -2.6, i === 1 ? M.brown : M.rust);
  emblem(k, M, 0.5, -2.4, 2.0, 3.25);
}
// 回收站（10×8、高 5）：廢鐵堆（磁吸吊車另外是轉動的獨立網格）
function yardBody(k, M) {
  k.cb(M.conc, 10, 0.3, 8, 0, 0.15, 0, 0, 0, 0, 0.1);
  for (let i = 0; i < 14; i++) {
    const a = hash01(i, 1),
      b = hash01(i, 2),
      c = hash01(i, 3);
    const x = -3.4 + a * 4.2,
      z = -2.4 + b * 4.2;
    k.cb(
      [M.rust, M.brown, M.beige, M.dark][i % 4],
      0.8 + c * 1.4,
      0.4 + b * 0.8,
      0.6 + a,
      x,
      0.6 + c * 1.2,
      z,
      a * 0.8,
      b * 3,
      c * 0.6,
      0.05,
    );
  }
  carHulk(k, M, -1.6, 0.3, -2.6, 0.2, M.rust);
  tires(k, M, 4, 3.8, 0.3, 2.9);
  // 圍籬
  for (const s of [-1, 1]) railing(k, M.steel, 8, 1.4, 0, 0.3, s * 3.85);
  k.box(M.steel, 0.4, 4.6, 0.4, 3.0, 2.6, -1.6); // 吊車柱
  emblem(k, M, 0.5, 3.0, 2.4, -1.38);
}
function yardCrane(M) {
  return oneMesh(
    (kk, mm) => {
      kk.box(mm, 0.5, 0.5, 0.5, 0, 0, 0);
      kk.bar(mm, [0, 0.2, 0], [0, 1.3, -4.2], 0.24);
      kk.box(mm, 0.06, 1.6, 0.06, 0, 0.5, -4.2);
      kk.cyl(mm, 0.7, 0.7, 0.3, 0, -0.4, -4.2, 0, 0, 0, 10);
    },
    mat(SANC_RUST, { roughness: 0.85, metalness: 0.45 }),
  );
}
// 改裝工坊（12×10、高 8）：車庫門＋懸吊的零件（焊接火花另外是閃爍的獨立網格）
function shopBody(k, M) {
  k.cb(M.conc, 12, 0.4, 10, 0, 0.2, 0, 0, 0, 0, 0.12);
  k.cb(M.beige, 11, 5.5, 8, 0, 3.15, -0.5, 0, 0, 0, 0.1);
  k.prism(
    M.brown,
    [
      [-5.8, 0],
      [5.8, 0],
      [0, 2],
    ],
    8.4,
    0,
    5.9,
    -0.5,
  );
  // 兩扇車庫門（一扇半開）
  for (const [x, open] of [
    [-2.6, 0],
    [2.6, 1],
  ]) {
    k.box(M.dark, 4, 4.2, 0.1, x, 2.5, 3.52);
    if (!open) for (let i = 0; i < 7; i++) k.box(M.brown, 4, 0.06, 0.14, x, 0.8 + i * 0.6, 3.6);
    else k.box(M.brown, 4, 1.4, 0.16, x, 3.9, 3.6);
  }
  k.box(M.team, 11.2, 0.5, 8.2, 0, 5.4, -0.5);
  patch(k, M, 1.6, 1.2, 5.54, 3, 1, Math.PI / 2);
  emblem(k, M, 0.7, 0, 6.3, 3.54);
  // 半開的門裡：吊起來的引擎與零件（鏈條）
  k.box(M.steel, 0.06, 1.6, 0.06, 2.6, 3.7, 1.8);
  k.cb(M.rust, 1.2, 0.8, 0.9, 2.6, 2.6, 1.8, 0, 0.4, 0, 0.08);
  k.cb(M.dark, 2.2, 0.9, 1.2, 1.4, 0.85, 2.0, 0, 0, 0, 0.08); // 工作台
  // 側面的零件架與輪胎
  for (const y of [0.9, 2.0]) k.box(M.wood, 0.8, 0.08, 3.6, -5.9, y, -0.5);
  for (const sz of [-1, 1]) k.box(M.wood, 0.08, 2.2, 0.08, -6.2, 1.1, -0.5 + sz * 1.7);
  k.cb(M.rust, 0.6, 0.6, 0.8, -5.9, 1.3, -1.2, 0, 0, 0, 0.05);
  tires(k, M, 3, 5.2, 0.4, 4.4);
  k.box(M.lamp, 0.3, 0.2, 0.2, 0, 4.8, 3.6);
}
// 診療所（12×10、高 8）：白色帳篷＋互助圓環（取代紅十字）＋擔架
function clinicBody(k, M) {
  k.cb(M.wood, 12, 0.3, 10, 0, 0.15, 0, 0, 0, 0, 0.08);
  k.at(-0.5, 0.3, -0.5, 0, 0, 0, () => {
    k.prism(
      M.white,
      [
        [-4.5, 0],
        [4.5, 0],
        [4.5, 3.2],
        [0, 6.8],
        [-4.5, 3.2],
      ],
      8,
      0,
      0,
      0,
    );
    k.box(M.dark, 2.4, 2.6, 0.08, 0, 1.3, 4.02);
    emblem(k, M, 0.9, 0, 4.4, 4.05);
    k.box(M.rust, 9.1, 0.4, 8.1, 0, 3.0, 0); // 鏽紅的帶子（固定）
  });
  tarp(k, M, 3.6, 3, 2.6, 3.0, 4.2, 2.8, 0, M.white);
  // 擔架（帆布＋木架）
  for (const x of [3.6, 5.0]) {
    k.box(M.wood, 0.7, 0.06, 2.0, x, 0.75, 2.8);
    k.box(M.canvas, 0.6, 0.05, 1.8, x, 0.8, 2.8);
    for (const s of [-1, 1]) k.box(M.wood, 0.06, 0.45, 0.06, x + s * 0.3, 0.5, 2.8 + s * 0.85);
  }
  waterTower(k, M, 0.8, 3.2, -5.0, -3.8, 0.3);
  barrel(k, M, -5.2, 0.3, 3.6, M.white);
  clothesline(k, M, 3.2, 4.8, 0.3, -2.8, Math.PI / 2);
  k.box(M.lamp, 0.3, 0.2, 0.2, -0.5, 3.0, 3.6);
}
// 瞭望塔（5×5、高 12）：鷹架塔＋平台與射擊口（探照燈與機槍是轉動的砲塔）
function towerBody(k, M) {
  sandbags(k, M, 3, 0, 0, 2.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.wood, 0.22, 9.4, 0.22, sx * 1.9, 4.7, sz * 1.9);
  for (let y = 1.5; y < 9; y += 2.2)
    for (const s of [-1, 1]) {
      k.bar(M.wood, [-1.9, y, s * 1.9], [1.9, y + 1.8, s * 1.9], 0.1);
      k.bar(M.wood, [s * 1.9, y + 1.8, -1.9], [s * 1.9, y, 1.9], 0.1);
    }
  ladder(k, M.wood, 9.4, 0, 0, 2.0);
  // 平台：沙包與鐵板圍起來的射擊口
  k.cb(M.wood, 4.6, 0.3, 4.6, 0, 9.5, 0, 0, 0, 0, 0.05);
  for (const [x, z, ry] of [
    [0, 2.2, 0],
    [0, -2.2, 0],
    [2.2, 0, Math.PI / 2],
    [-2.2, 0, Math.PI / 2],
  ]) {
    k.at(x, 9.65, z, 0, ry, 0, () => {
      k.box(M.rust, 1.5, 1.1, 0.12, -1.35, 0.55, 0);
      k.box(M.rust, 1.5, 1.1, 0.12, 1.35, 0.55, 0);
      k.box(M.brown, 4.4, 0.3, 0.14, 0, 1.25, 0);
    });
  }
  k.box(M.canvas2, 4.8, 0.08, 4.8, 0, 12, 0, 0.1, 0, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(M.wood, 0.12, 2.3, 0.12, sx * 2.1, 10.85, sz * 2.1);
  emblem(k, M, 0.5, 0, 10.3, 2.3);
}
function towerTurret(M) {
  const tur = new THREE.Group();
  const k = new PK();
  k.cyl(M.dark, 0.5, 0.6, 0.4, 0, 0.2, 0, 0, 0, 0, 8);
  k.build(tur);
  const gun = new THREE.Group();
  gun.position.y = 0.75;
  const kk = new PK();
  kk.box(M.dark, 0.5, 0.45, 0.8, 0, 0, 0.1);
  kk.cyl(M.steel, 0.07, 0.07, 1.6, 0.14, 0, -0.9, Math.PI / 2, 0, 0, 6);
  kk.cyl(M.steel, 0.07, 0.07, 1.6, -0.14, 0, -0.9, Math.PI / 2, 0, 0, 6);
  // 探照燈
  kk.cyl(M.beige2, 0.36, 0.3, 0.5, 0.75, 0.15, -0.1, Math.PI / 2, 0, 0, 10);
  kk.cyl(M.lamp, 0.3, 0.3, 0.04, 0.75, 0.15, -0.37, Math.PI / 2, 0, 0, 10);
  kk.build(gun);
  tur.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.75);
  gun.add(muzzle);
  return { tur, gun, muzzle };
}
// 廢鐵路障（4×2、高 3）：4 種外觀（v＝0 車門、1 鋼板、2 輪胎堆、3 混合）
function barricadeVariant(v, M) {
  const k = new PK();
  if (v === 0) {
    for (let i = 0; i < 4; i++) {
      const x = -1.5 + i;
      k.cb(
        i % 2 ? M.rust : M.beige,
        1.1,
        1.3,
        0.12,
        x,
        0.75,
        0.15 * (i % 2),
        0.08,
        0.15 * (i - 1.5),
        0,
        0.04,
      );
      k.box(M.glass, 0.6, 0.4, 0.05, x, 1.15, 0.15 * (i % 2) + 0.06, 0.08, 0.15 * (i - 1.5), 0);
    }
    k.cb(M.brown, 3.8, 0.9, 0.9, 0, 0.45, -0.4, 0, 0, 0, 0.1);
    k.cb(M.rust, 1.6, 1.0, 0.1, 0.8, 1.9, 0.1, 0, 0, 0.2, 0.03);
  } else if (v === 1) {
    for (let i = 0; i < 3; i++)
      k.box(
        [M.rust, M.brown, M.dark][i],
        1.5,
        2.4,
        0.14,
        -1.3 + i * 1.3,
        1.2,
        (i - 1) * 0.12,
        0.05,
        (i - 1) * 0.12,
        0,
      );
    for (const s of [-1, 1]) k.bar(M.steel, [s * 1.2, 0, -0.9], [s * 1.2, 2.1, 0], 0.12);
    k.box(M.dark, 3.8, 0.16, 0.2, 0, 2.3, 0);
  } else if (v === 2) {
    for (let c = 0; c < 4; c++) tires(k, M, 3 - (c % 2), -1.45 + c * 0.97, 0, (c % 2) * 0.3 - 0.15);
    k.cb(M.rust, 1.4, 0.8, 0.1, 0, 1.6, 0.45, 0.1, 0, 0.1, 0.03);
  } else {
    k.cb(M.rust, 2.2, 1.4, 0.14, -0.9, 0.8, 0, 0.06, 0.1, 0, 0.04);
    tires(k, M, 3, 1.25, 0, 0.1);
    sandbags(k, M, 3, -0.6, 0, 0.55);
    k.cb(M.beige, 1.2, 1.0, 0.1, 0.4, 1.5, -0.2, -0.2, 0, -0.15, 0.03);
  }
  return k.build(new THREE.Group());
}
// 互助市集（10×8、高 7）：攤位與遮陽布
function marketBody(k, M) {
  k.cb(M.conc, 10, 0.3, 8, 0, 0.15, 0, 0, 0, 0, 0.1);
  const cloths = [M.rust, M.canvas, M.team, M.canvas2];
  for (let i = 0; i < 3; i++) {
    const x = -3.2 + i * 3.2;
    tarp(k, M, 2.8, 2.6, 2.6, 3.0, x, 1.8, 0, cloths[i]);
    k.cb(M.wood, 2.4, 0.9, 1.0, x, 0.75, 2.6, 0, 0, 0, 0.04);
    for (let j = 0; j < 3; j++)
      k.cb([M.beige2, M.rust, M.white][j], 0.5, 0.35, 0.4, x - 0.7 + j * 0.7, 1.4, 2.6, 0, j * 0.3, 0, 0.04);
  }
  prefab(k, M, 6, 3.4, 3, -1.6, 0.3, -2.4, 0, M.beige, 31);
  crate(k, M, 3.4, 2.4, 2.3, 3.2, 0.3, -2.4);
  // 招牌（互助圓環）與串燈
  k.box(M.wood, 0.12, 5.6, 0.12, 4.6, 3.1, 3.4);
  emblem(k, M, 0.6, 4.6, 5.4, 3.5);
  for (let i = 0; i < 6; i++) k.box(M.lamp, 0.14, 0.14, 0.14, -4.2 + i * 1.6, 3.6 - (i % 2) * 0.15, 3.3);
  k.box(M.dark, 9.2, 0.03, 0.03, 0, 3.7, 3.3);
}
// 回收工廠（16×14、高 11）：大型棚屋＋門型吊車＋壓縮機
function worksBody(k, M) {
  k.cb(M.conc, 16, 0.5, 14, 0, 0.25, 0, 0, 0, 0, 0.15);
  // 大型棚屋：拱形屋頂（多片斜板）
  k.cb(M.beige, 11, 6.5, 12, -2.2, 3.75, -0.5, 0, 0, 0, 0.1);
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI,
      a1 = ((i + 1) / 6) * Math.PI;
    const x0 = Math.cos(a0) * 5.6,
      y0 = Math.sin(a0) * 3.4,
      x1 = Math.cos(a1) * 5.6,
      y1 = Math.sin(a1) * 3.4;
    k.box(
      i % 2 ? M.brown : M.rust,
      Math.hypot(x1 - x0, y1 - y0) + 0.05,
      0.12,
      12.2,
      -2.2 + (x0 + x1) / 2,
      7.0 + (y0 + y1) / 2,
      -0.5,
      0,
      0,
      Math.atan2(y1 - y0, x1 - x0),
    );
  }
  k.box(M.dark, 6, 5.2, 0.1, -2.2, 3.1, 5.52);
  k.box(M.team, 11.2, 0.6, 12.2, -2.2, 6.6, -0.5);
  emblem(k, M, 1.0, -2.2, 8.8, 5.6);
  patch(k, M, 2, 1.6, -7.74, 3.6, 1.5, -Math.PI / 2);
  // 門型吊車（右側的露天作業場）
  for (const sz of [-1, 1]) {
    k.box(M.rust, 0.4, 8.5, 0.4, 3.9, 4.75, sz * 5.4);
    k.box(M.rust, 0.4, 8.5, 0.4, 7.4, 4.75, sz * 5.4);
  }
  truss(k, M.rust, 11.2, 0.8, 3.9, 9.0, 0, Math.PI / 2, 0.16);
  truss(k, M.rust, 11.2, 0.8, 7.4, 9.0, 0, Math.PI / 2, 0.16);
  k.box(M.dark, 4.0, 0.6, 1.0, 5.65, 9.0, 1.4);
  k.box(M.steel, 0.05, 4.2, 0.05, 5.65, 6.6, 1.4);
  k.cyl(M.dark, 0.8, 0.8, 0.3, 5.65, 4.4, 1.4, 0, 0, 0, 10);
  // 壓縮機與壓扁的廢鐵塊
  k.cb(M.dark, 3, 2.4, 2.4, 5.65, 1.7, -3.6, 0, 0, 0, 0.1);
  k.cyl(M.steel, 0.4, 0.4, 1.6, 5.65, 3.6, -3.6, 0, 0, 0, 8);
  for (let i = 0; i < 4; i++)
    k.cb(
      [M.rust, M.brown, M.beige2, M.rust][i],
      1,
      1,
      1,
      4.6 + (i % 2) * 1.1,
      1.0 + Math.floor(i / 2),
      3.6,
      0,
      i * 0.2,
      0,
      0.06,
    );
  waterTower(k, M, 1.0, 5, -7.0, -5.8, 0.5);
  k.box(M.lamp, 0.3, 0.2, 0.2, -2.2, 5.9, 5.6);
}

const BODY = {
  s_hq: hqBody,
  s_hq2: hqBody,
  s_hq3: hqBody,
  s_depot: depotBody,
  s_hall: hallBody,
  s_extractor: extractorBody,
  s_yard: yardBody,
  s_shop: shopBody,
  s_clinic: clinicBody,
  s_tower: towerBody,
  s_barricade: null,
  s_market: marketBody,
  s_works: worksBody,
};
const HQ_IDS = new Set(['s_hq', 's_hq2', 's_hq3']);
export const isSancBuilding = (id) => Object.prototype.hasOwnProperty.call(BODY, id);

// 施工的木架＋帆布（取代卡斯特隆的鋼鷹架）：佔地四周的木柱、每 2.5 m 一圈橫木、兩面的帆布
function woodScaffold(w, d, h, M) {
  const k = new PK();
  const hw = w / 2 + 0.3,
    hd = d / 2 + 0.3;
  const nx = Math.max(2, Math.round(w / 4)),
    nz = Math.max(2, Math.round(d / 4));
  for (let i = 0; i <= nx; i++)
    for (const s of [-1, 1]) k.box(M.wood, 0.18, h, 0.18, -hw + (2 * hw * i) / nx, h / 2, s * hd);
  for (let i = 1; i < nz; i++)
    for (const s of [-1, 1]) k.box(M.wood, 0.18, h, 0.18, s * hw, h / 2, -hd + (2 * hd * i) / nz);
  for (let y = 2.5; y < h + 0.1; y += 2.5)
    for (const s of [-1, 1]) {
      k.box(M.wood, 2 * hw, 0.14, 0.14, 0, y, s * hd);
      k.box(M.wood, 0.14, 0.14, 2 * hd, s * hw, y, 0);
    }
  // 帆布（背面整片、左側半片），斜撐
  k.box(M.canvas, 2 * hw - 0.2, h * 0.8, 0.04, 0, h * 0.45, -hd - 0.06);
  k.box(M.canvas2, 0.04, h * 0.55, hd, -hw - 0.06, h * 0.35, -hd / 2);
  for (let i = 0; i < nx; i++) {
    const x0 = -hw + (2 * hw * i) / nx,
      x1 = x0 + (2 * hw) / nx;
    k.bar(M.wood, [x0, 0.2, hd], [x1, Math.min(h, 4), hd], 0.1);
  }
  return k.build(new THREE.Group());
}

export function buildSancBuilding(id, pal) {
  const D = RTS_DEFS[id] || { foot: [8, 8], height: 8 };
  const M = mats(pal);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const fn = BODY[id];
  if (fn) {
    const k = new PK();
    fn(k, M);
    k.build(body);
  }
  group.add(body);
  const [w, d] = D.foot;
  const scaf = woodScaffold(w, d, D.height, M);
  scaf.visible = false;
  group.add(scaf);
  const rig = {
    group,
    body,
    scaf,
    torso: body,
    height: D.height,
    vehicle: true,
    cls: 'bld',
    sancta: true,
    glow: M.glow,
    progress: 1,
    setProgress(p) {
      p = Math.max(0, Math.min(1, p));
      rig.progress = p;
      body.scale.y = 0.06 + 0.94 * p;
      scaf.visible = p < 1;
    },
  };
  if (HQ_IDS.has(id)) {
    const mk = (f) => {
      const kk = new PK();
      f(kk, M);
      const grp = kk.build(new THREE.Group());
      body.add(grp);
      return grp;
    };
    rig.tier2 = mk(hqTier2);
    rig.tier3 = mk(hqTier3);
    rig.tier = 0;
    rig.setTier = (n) => {
      n = Math.max(1, Math.min(3, n | 0));
      if (rig.tier === n) return;
      const re = rig.merged && rig.unmerge;
      if (re) rig.unmerge();
      rig.tier = n;
      rig.tier2.visible = n >= 2;
      rig.tier3.visible = n >= 3;
      if (re) rig.remerge();
    };
    rig.setTier(D.tier || 1);
  }
  if (id === 's_yard') {
    const c = yardCrane(M);
    c.position.set(3.0, 5.0, -1.6);
    selfAnim(c, { spin: 0.25 });
    body.add(c);
    rig.crane = c;
  }
  if (id === 's_shop') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), addMat(0xffe0a0, 0.95));
    s.position.set(1.4, 1.5, 2.1);
    selfAnim(s, { blink: 1.7, op: 0.95 });
    body.add(s);
    rig.spark = s;
  }
  if (id === 's_tower') {
    const { tur, gun, muzzle } = towerTurret(M);
    tur.position.set(0, 9.65, 0);
    body.add(tur);
    rig.turret = tur;
    rig.gun = gun;
    rig.muzzle = muzzle;
  }
  if (id === 's_barricade') {
    rig.variants = [0, 1, 2, 3].map((v) => {
      const g = barricadeVariant(v, M);
      g.visible = v === 0;
      body.add(g);
      return g;
    });
    rig.variant = 0;
    rig.setVariant = (v) => {
      v = (((v | 0) % 4) + 4) % 4;
      rig.variant = v;
      rig.variants.forEach((g, i) => (g.visible = i === v));
    };
    // 第一次算繪時依世界座標選外觀（模型建好時還不知道位置；兩邊同一個位置選同一種）。
    // 選好之後這個小網格就隱藏（只有第一次多一個 draw call）
    const pick = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 0.05),
      new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    );
    pick.userData.sancPick = true; // 有 userData：網格合併略過
    pick.position.y = 1;
    pick.frustumCulled = false;
    pick.castShadow = false;
    pick.onBeforeRender = () => {
      if (rig.picked) return;
      const p = group.position;
      if (!p.x && !p.z) return;
      rig.picked = true;
      rig.setVariant(Math.floor(hash01(Math.round(p.x * 2), Math.round(p.z * 2)) * 4));
      pick.visible = false;
    };
    body.add(pick);
    rig.pick = pick;
  }
  rig.aimAt = (yaw, pitch = 0) => {
    if (rig.turret) rig.turret.rotation.y = yaw;
    if (rig.gun) rig.gun.rotation.x = Math.max(-0.3, Math.min(1.3, pitch));
  };
  return rig;
}

// ---------- 單位的外加零件 ----------
// 模型在 torso 座標裡的外框（加零件的位置依它；量的是組好、還沒合併的模型）
function boxIn(rig, node) {
  const g = rig.group;
  g.updateMatrixWorld(true);
  const b = new THREE.Box3();
  g.traverse((o) => {
    if (!o.isMesh || !o.geometry || isOutline(o.material)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });
  if (b.isEmpty()) b.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 2, 1));
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  return b.applyMatrix4(inv);
}
// 互助作業機的拾荒套件：背上的拾荒網籃（裝著廢鐵）、右手的磁吸臂（rtsDrill，採集與拾荒時轉）、拼裝的補丁板、暖色信號燈
export function addSancWorkerKit(rig, pal, buildOreCrate) {
  const t = rig.torso || rig.group;
  const M = mats(pal);
  const kit = new THREE.Group();
  const k = new PK();
  // 網籃：木框＋網（細條）＋裡面的廢鐵
  for (const sx of [-1, 1])
    for (const sz of [0, 1]) k.box(M.wood, 0.07, 0.9, 0.07, sx * 0.45, 1.6, 0.6 + sz * 0.6);
  for (const y of [1.15, 2.05]) {
    k.box(M.wood, 0.97, 0.06, 0.06, 0, y, 0.6);
    k.box(M.wood, 0.97, 0.06, 0.06, 0, y, 1.2);
    for (const sx of [-1, 1]) k.box(M.wood, 0.06, 0.06, 0.66, sx * 0.45, y, 0.9);
  }
  for (let i = 0; i < 4; i++) k.box(M.dark, 0.02, 0.85, 0.02, -0.3 + i * 0.2, 1.6, 1.21);
  k.cb(M.rust, 0.4, 0.3, 0.3, -0.15, 1.95, 0.85, 0.3, 0.2, 0, 0.03);
  k.cb(M.beige2, 0.35, 0.22, 0.4, 0.17, 1.9, 0.95, -0.2, 0.5, 0.1, 0.03);
  // 補丁板（肩與胸）
  k.box(M.rust, 0.5, 0.4, 0.05, 0.42, 1.55, -0.42, 0, 0.3, 0.1);
  k.box(M.beige2, 0.36, 0.3, 0.05, -0.38, 1.35, -0.43, 0, -0.2, -0.08);
  k.build(kit);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), glowMat(SANC_LAMP, 2));
  beacon.position.set(0.38, 2.15, 0.6);
  kit.add(beacon);
  t.add(kit);
  if (buildOreCrate) {
    const crateG = buildOreCrate();
    crateG.position.set(0, 0.9, 1.25);
    crateG.scale.setScalar(0.7);
    crateG.visible = false;
    t.add(crateG);
    rig.rtsCrate = crateG;
  }
  // 右手的磁吸臂（圓盤磁鐵＋短臂；採集、拾荒、修理時轉）
  const hand = rig.arms && rig.arms.r && rig.arms.r.hand;
  if (hand) {
    const dk = new PK();
    dk.box(M.dark, 0.12, 0.45, 0.12, 0, -0.3, 0);
    dk.cyl(M.rust, 0.26, 0.26, 0.1, 0, -0.58, 0, 0, 0, 0, 10);
    dk.cyl(M.dark, 0.12, 0.12, 0.06, 0, -0.65, 0, 0, 0, 0, 8);
    const mag = dk.build(new THREE.Group());
    hand.add(mag);
    rig.rtsDrill = mag;
  }
  rig.rtsKit = kit;
  rig.rtsBeacon = beacon;
  return rig;
}
// 回收拖車（裝甲車的車體）：砲塔換成吊臂、磁鐵與貨斗；setHaul(f)＝展開（0 收起、1 展開：吊臂放下、磁鐵降到地面、支腳伸出）
export function addHaulerKit(rig, pal) {
  if (!rig || rig.rtsHaul) return rig;
  const t = rig.torso || rig.group;
  const M = mats(pal);
  // 砲塔（torso 下的程式網格）拿掉
  for (const c of [...t.children]) if (c.isMesh) t.remove(c);
  const base = new THREE.Group();
  const k = new PK();
  // 貨斗（在車身後段，掛在 torso 上：torso 會轉向，所以貨斗放在轉台的正後方）
  k.cyl(M.dark, 0.7, 0.8, 0.3, 0, 0.1, 0, 0, 0, 0, 10);
  k.cb(M.rust, 2.0, 0.8, 1.5, 0, 0.6, 1.2, 0, 0, 0, 0.06);
  k.cb(M.brown, 1.6, 0.35, 1.1, 0, 1.05, 1.2, 0.1, 0.3, 0, 0.05);
  k.cb(M.beige2, 0.6, 0.3, 0.5, 0.4, 1.2, 1.4, 0.2, -0.4, 0, 0.04);
  k.box(M.team, 2.02, 0.2, 1.52, 0, 0.55, 1.2);
  emblem(k, M, 0.25, 0, 0.7, 1.97);
  k.build(base);
  t.add(base);
  // 吊臂（boom：根部在轉台上，往前（−Z）伸；展開時放低）
  const boom = new THREE.Group();
  boom.position.set(0, 0.5, 0.1);
  const bk = new PK();
  bk.bar(M.rust, [0, 0, 0], [0, 0.4, -3.2], 0.24);
  bk.bar(M.dark, [0, -0.15, 0.1], [0, 0.25, -3.0], 0.1);
  bk.box(M.dark, 0.36, 0.3, 0.36, 0, 0.4, -3.2);
  bk.build(boom);
  t.add(boom);
  // 吊索與磁鐵（掛在吊臂尖端；scale.y＝吊索長度）
  const cable = new THREE.Group();
  cable.position.set(0, 0.35, -3.2);
  const ck = new PK();
  ck.box(M.steel, 0.05, 1, 0.05, 0, -0.5, 0);
  ck.build(cable);
  boom.add(cable);
  const magnet = new THREE.Group();
  const mk = new PK();
  mk.cyl(M.rust, 0.55, 0.55, 0.2, 0, -0.1, 0, 0, 0, 0, 10);
  mk.cyl(M.dark, 0.2, 0.2, 0.2, 0, 0.1, 0, 0, 0, 0, 8);
  mk.build(magnet);
  boom.add(magnet);
  // 支腳（車身兩側，掛在模型的根：不跟著轉台轉）
  const legs = [];
  const root = rig.group;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const lg = new THREE.Group();
      lg.position.set(sx * 1.9, 0.9, sz * 1.3);
      const lk = new PK();
      lk.box(M.dark, 0.18, 0.9, 0.18, 0, -0.45, 0);
      lk.box(M.rust, 0.5, 0.08, 0.5, 0, -0.9, 0);
      lk.build(lg);
      root.add(lg);
      legs.push(lg);
    }
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8), glowMat(SANC_LAMP, 2));
  beacon.position.set(0.6, 0.45, 0.4);
  t.add(beacon);
  rig.rtsHaul = { base, boom, cable, magnet, legs, beacon };
  rig.haul = 0;
  rig.setHaul = (f) => {
    f = Math.max(0, Math.min(1, f));
    rig.haul = f;
    boom.rotation.x = -0.15 + 0.5 * f; // 收起時略微抬起、展開時往下
    const L = 0.6 + 1.6 * f;
    cable.scale.y = L;
    magnet.position.set(0, 0.35 - L, -3.2);
    for (const lg of legs) {
      lg.position.x = Math.sign(lg.position.x) * (1.7 + 0.5 * f);
      lg.scale.y = 0.25 + 0.75 * f;
    }
  };
  rig.setHaul(0);
  return rig;
}
// 拼裝巨像（拾荒外殼機的模型放大 1.5 倍）：背上的榴彈砲（GL-90）、堆起來的貨櫃、車門補丁
export function addColossusKit(rig, pal) {
  if (!rig || rig.rtsColossus) return rig;
  const t = rig.torso || rig.group;
  const M = mats(pal);
  const bb = boxIn(rig, t);
  const top = bb.max.y,
    cz = (bb.min.z + bb.max.z) / 2,
    hw = (bb.max.x - bb.min.x) / 2;
  const kit = new THREE.Group();
  const k = new PK();
  const s = Math.max(0.6, hw / 2.2);
  k.at(0, top - 0.3 * s, cz + 0.4 * s, 0, 0, 0, () => {
    crate(k, M, 2.6 * s, 1.1 * s, 1.2 * s, -0.4 * s, 0, 0.7 * s, 0.1, M.brown);
    crate(k, M, 2.0 * s, 1.0 * s, 1.1 * s, 0.3 * s, 1.1 * s, 0.5 * s, -0.2, M.rust);
    // GL-90 的砲管（右肩上方，往前）
    k.cb(M.dark, 0.9 * s, 0.8 * s, 1.4 * s, 1.2 * s, 0.6 * s, -0.2 * s, 0, 0, 0, 0.05);
    k.cyl(M.steel, 0.22 * s, 0.26 * s, 2.6 * s, 1.2 * s, 1.0 * s, -1.6 * s, Math.PI / 2 - 0.25, 0, 0, 8);
    k.cyl(M.dark, 0.3 * s, 0.3 * s, 0.4 * s, 1.2 * s, 1.35 * s, -2.8 * s, Math.PI / 2 - 0.25, 0, 0, 8);
    emblem(k, M, 0.35 * s, -0.4 * s, 0.55 * s, 1.32 * s);
  });
  // 車門補丁（左右）
  for (const sx of [-1, 1]) {
    k.cb(
      sx > 0 ? M.rust : M.beige,
      0.1,
      1.2 * s,
      1.4 * s,
      sx * (hw + 0.05),
      top * 0.55,
      cz,
      0,
      0,
      sx * 0.1,
      0.03,
    );
    k.box(
      M.glass,
      0.06,
      0.4 * s,
      0.7 * s,
      sx * (hw + 0.1),
      top * 0.55 + 0.3 * s,
      cz - 0.1 * s,
      0,
      0,
      sx * 0.1,
    );
  }
  k.build(kit);
  t.add(kit);
  rig.rtsColossus = kit;
  return rig;
}
// 改裝的外加零件（docs 16.5）：6 種一次建好、隱藏（骨頭，合併之後只切 visible，不必重新合併）；
// rig.rtsRefitKits＝{ 改裝 id: 群組 }。廢鐵裝甲＝肩與腿的補丁板、拼裝槍管＝槍管的延長管、對空支架＝背上的機槍架、
// 改造推進器＝背後的大噴口、自爆裝藥＝胸前的油桶、加高天線＝頭上的天線。ids＝要建的（沒給＝全部）
export function addRefitKits(rig, pal, ids = null) {
  if (!rig || rig.rtsRefitKits) return rig;
  const t = rig.torso || rig.group;
  const M = mats(pal);
  const bb = boxIn(rig, t);
  const kits = {};
  for (const rf of ids || ['rf_plate', 'rf_gun', 'rf_aa', 'rf_boost', 'rf_bomb', 'rf_scope']) {
    const g = addRefitKit(rf, bb, M);
    g.visible = false;
    t.add(g);
    kits[rf] = g;
  }
  rig.rtsRefitKits = kits;
  return rig;
}
// 一種改裝的零件（bb＝模型在掛載節點座標裡的外框；正面 −Z、背面 +Z）
export function addRefitKit(rf, bb, M) {
  const g = new THREE.Group();
  const k = new PK();
  const cx = (bb.min.x + bb.max.x) / 2,
    cz = (bb.min.z + bb.max.z) / 2;
  const hw = Math.max(0.3, (bb.max.x - bb.min.x) / 2),
    hd = Math.max(0.3, (bb.max.z - bb.min.z) / 2);
  const y0 = bb.min.y,
    y1 = bb.max.y,
    H = Math.max(0.6, y1 - y0);
  const s = Math.max(0.35, Math.min(1.6, H / 3));
  if (rf === 'rf_plate') {
    for (const sx of [-1, 1]) {
      k.cb(M.rust, 0.1, 0.7 * s, 0.9 * s, cx + sx * (hw + 0.04), y0 + H * 0.72, cz, 0, 0, sx * 0.12, 0.03);
      k.cb(
        M.brown,
        0.1,
        0.6 * s,
        0.7 * s,
        cx + sx * (hw * 0.8 + 0.04),
        y0 + H * 0.3,
        cz - 0.1 * s,
        0,
        0,
        sx * 0.05,
        0.03,
      );
      for (const dy of [-1, 1])
        k.box(M.dark, 0.06, 0.07, 0.07, cx + sx * (hw + 0.1), y0 + H * 0.72 + dy * 0.25 * s, cz);
    }
    k.cb(M.rust, hw * 1.1, 0.5 * s, 0.08, cx, y0 + H * 0.55, bb.min.z - 0.04, 0.1, 0, 0, 0.03);
  } else if (rf === 'rf_gun') {
    const x = cx + hw * 0.75,
      y = y0 + H * 0.55;
    k.cyl(M.dark, 0.09 * s, 0.11 * s, 1.4 * s, x, y, bb.min.z - 0.55 * s, Math.PI / 2, 0, 0, 6);
    k.cyl(M.rust, 0.15 * s, 0.15 * s, 0.3 * s, x, y, bb.min.z - 0.2 * s, Math.PI / 2, 0, 0, 6);
    for (let i = 0; i < 3; i++) k.box(M.steel, 0.24 * s, 0.03, 0.03, x, y, bb.min.z - (0.6 + i * 0.25) * s);
    k.cyl(M.steel, 0.13 * s, 0.13 * s, 0.12 * s, x, y, bb.min.z - 1.25 * s, Math.PI / 2, 0, 0, 6);
  } else if (rf === 'rf_aa') {
    k.at(cx - hw * 0.3, y1 - 0.05, cz + hd * 0.3, 0, 0, 0, () => {
      k.box(M.dark, 0.12 * s, 0.6 * s, 0.12 * s, 0, 0.3 * s, 0);
      k.cb(M.rust, 0.5 * s, 0.3 * s, 0.4 * s, 0, 0.7 * s, 0, 0, 0, 0, 0.03);
      for (const sx of [-1, 1])
        k.cyl(
          M.steel,
          0.05 * s,
          0.05 * s,
          1.0 * s,
          sx * 0.12 * s,
          0.9 * s,
          -0.45 * s,
          Math.PI / 2 - 0.7,
          0,
          0,
          6,
        );
    });
  } else if (rf === 'rf_boost') {
    k.at(cx, y0 + H * 0.6, bb.max.z + 0.1, 0, 0, 0, () => {
      k.cyl(M.dark, 0.32 * s, 0.42 * s, 0.7 * s, 0, 0, 0.3 * s, Math.PI / 2, 0, 0, 10);
      k.cyl(M.rust, 0.44 * s, 0.44 * s, 0.12 * s, 0, 0, 0.62 * s, Math.PI / 2, 0, 0, 10);
      k.cyl(M.glow, 0.24 * s, 0.24 * s, 0.04, 0, 0, 0.7 * s, Math.PI / 2, 0, 0, 10);
      for (const sx of [-1, 1]) k.bar(M.steel, [sx * 0.3 * s, 0, -0.1], [sx * 0.2 * s, 0, 0.4 * s], 0.06);
    });
  } else if (rf === 'rf_bomb') {
    k.at(cx, y0 + H * 0.5, bb.min.z - 0.25 * s, 0, 0, 0, () => {
      k.cyl(M.rust, 0.26 * s, 0.26 * s, 0.75 * s, 0, 0, 0, 0, 0, Math.PI / 2, 8);
      for (const sx of [-1, 1])
        k.cyl(M.dark, 0.28 * s, 0.28 * s, 0.05, sx * 0.25 * s, 0, 0, 0, 0, Math.PI / 2, 8);
      k.box(M.white, 0.2 * s, 0.2 * s, 0.03, 0, 0.05 * s, -0.26 * s);
      k.box(M.coral, 0.07, 0.07, 0.07, 0.3 * s, 0.25 * s, -0.1 * s);
    });
  } else if (rf === 'rf_scope') {
    k.at(cx - hw * 0.4, y1 - 0.05, cz, 0, 0, 0, () => {
      k.cyl(M.steel, 0.025, 0.04, 2.2 * s, 0, 1.1 * s, 0, 0, 0, 0, 5);
      k.box(M.rust, 0.5 * s, 0.04, 0.04, 0, 1.6 * s, 0);
      k.box(M.rust, 0.36 * s, 0.04, 0.04, 0, 1.9 * s, 0);
      k.box(M.lamp, 0.08, 0.08, 0.08, 0, 2.22 * s, 0);
    });
  }
  k.build(g);
  return g;
}

// ---------- 殘骸（4 種廢鐵堆，各一個 InstancedMesh） ----------
// 小 1.2 m、中 2 m、大 3 m、建築瓦礫 6 m（直徑）；頂點色（鏽、深鋼、米白板、焦黑），實例色另外乘上（原本的隊伍色 30%＋鏽色）。
// 原點在地面中心。幾何用固定的雜湊產生，同一種一律相同
const WRECK_SPEC = [
  { d: 1.2, n: 24, h: 0.5 },
  { d: 2.0, n: 32, h: 0.8 },
  { d: 3.0, n: 40, h: 1.2 },
  { d: 6.0, n: 46, h: 2.0 },
];
const WRECK_COLS = [0x8a4a30, 0x3a3632, 0xb0a488, 0x5a3a28, 0x242220, 0x9a5a38];
const WRECK_GEO = [];
export function wreckGeo(size) {
  if (WRECK_GEO[size]) return WRECK_GEO[size];
  const S = WRECK_SPEC[size];
  const box = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const bp = box.attributes.position,
    bn = box.attributes.normal;
  const pos = [],
    nor = [],
    col = [];
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    nm = new THREE.Matrix3(),
    c = new THREE.Color();
  const R = S.d / 2;
  for (let i = 0; i < S.n; i++) {
    const a = hash01(size * 100 + i, 1),
      b = hash01(size * 100 + i, 2),
      cc = hash01(size * 100 + i, 3),
      dd = hash01(size * 100 + i, 4);
    const rr = Math.sqrt(a) * R * 0.85,
      ang = b * Math.PI * 2;
    const x = Math.cos(ang) * rr,
      z = Math.sin(ang) * rr;
    // 中間堆得高、外圍低
    const hk = 1 - rr / R;
    const big = size === 3 && i < 6;
    const sx = big ? R * 0.5 : R * (0.12 + cc * 0.3),
      sy = big ? S.h * 0.5 : S.h * (0.12 + dd * 0.35),
      sz = big ? R * 0.35 : R * (0.1 + dd * 0.25);
    const y = sy * 0.35 + hk * S.h * 0.55 * cc;
    e.set((cc - 0.5) * 1.4, b * 6.28, (dd - 0.5) * 1.2);
    q.setFromEuler(e);
    m4.compose(v.set(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    nm.getNormalMatrix(m4);
    c.setHex(big ? 0x6a6660 : WRECK_COLS[(i * 7 + size) % WRECK_COLS.length]);
    const sh = 0.8 + 0.4 * hash01(i, size + 9);
    for (let j = 0; j < bp.count; j++) {
      v.set(bp.getX(j), bp.getY(j), bp.getZ(j)).applyMatrix4(m4);
      pos.push(v.x, Math.max(0, v.y), v.z);
      v.set(bn.getX(j), bn.getY(j), bn.getZ(j)).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      col.push(c.r * sh, c.g * sh, c.b * sh);
    }
  }
  // 建築瓦礫：外圍幾根歪掉的鋼梁（細長方塊）
  if (size === 3)
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2 + 0.3;
      e.set(0.3 * (i % 2), ang, 0.25);
      q.setFromEuler(e);
      m4.compose(
        v.set(Math.cos(ang) * R * 0.5, 0.9, Math.sin(ang) * R * 0.5),
        q,
        new THREE.Vector3(R * 0.9, 0.14, 0.14),
      );
      nm.getNormalMatrix(m4);
      c.setHex(0x5a4a40);
      for (let j = 0; j < bp.count; j++) {
        v.set(bp.getX(j), bp.getY(j), bp.getZ(j)).applyMatrix4(m4);
        pos.push(v.x, Math.max(0, v.y), v.z);
        v.set(bn.getX(j), bn.getY(j), bn.getZ(j)).applyMatrix3(nm).normalize();
        nor.push(v.x, v.y, v.z);
        col.push(c.r, c.g, c.b);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return (WRECK_GEO[size] = g);
}
let WRECK_MAT = null;
export function wreckMat() {
  return (
    WRECK_MAT ||
    (WRECK_MAT = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.35,
      flatShading: true,
    }))
  );
}
// 4 個 InstancedMesh（容量 cap，count 依使用的最高編號；不投影、接受陰影、不做視錐剔除：實例散在整張地圖）
export function buildWreckBatch(cap = 160) {
  const group = new THREE.Group();
  group.userData.sancWrecks = true;
  const meshes = [];
  for (let s = 0; s < 4; s++) {
    const m = new THREE.InstancedMesh(wreckGeo(s), wreckMat(), cap);
    m.count = 0;
    m.visible = false;
    m.frustumCulled = false;
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.sancWrecks = s;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // instanceColor 依容量建立（setColorAt 會依目前的 count 建立，count 已經是 0）
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
    group.add(m);
    meshes.push(m);
  }
  return { group, meshes, cap };
}
// 地雷（地雷盤＋紅燈，一個 InstancedMesh；直徑約 0.9 m，原點在地面）
let MINE_GEO = null;
export function mineGeo() {
  if (MINE_GEO) return MINE_GEO;
  const parts = [
    [new THREE.CylinderGeometry(0.42, 0.48, 0.16, 10), 0, 0.08, 0, 0x3a3630],
    [new THREE.CylinderGeometry(0.3, 0.34, 0.08, 10), 0, 0.2, 0, 0x6a4a34],
    [new THREE.CylinderGeometry(0.07, 0.07, 0.08, 6), 0, 0.27, 0, 0xff2a1a],
  ];
  const pos = [],
    nor = [],
    col = [];
  const c = new THREE.Color();
  for (const [g0, x, y, z, hex] of parts) {
    const g = g0.toNonIndexed();
    g.translate(x, y, z);
    const p = g.attributes.position,
      n = g.attributes.normal;
    c.setHex(hex);
    for (let j = 0; j < p.count; j++) {
      pos.push(p.getX(j), p.getY(j), p.getZ(j));
      nor.push(n.getX(j), n.getY(j), n.getZ(j));
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return (MINE_GEO = g);
}
export function buildMineBatch(cap = 120) {
  const mat0 = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.4,
    flatShading: true,
    emissive: 0x000000,
  });
  const m = new THREE.InstancedMesh(mineGeo(), mat0, cap);
  m.count = 0;
  m.visible = false;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = true;
  m.userData.sancMines = true;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
  return m;
}

// ---------- 模型庫目錄 ----------
const P0 = () => sancPal(0);
const bldNote = (id) => {
  const D = RTS_DEFS[id];
  return `Coral 戰爭（聖域）；佔地 ${D.foot[0]} × ${D.foot[1]} m、高約 ${D.height} m，原點在底面中心、正面 +Z；隊伍色在塗裝帶，鏽紅補丁與互助圓環固定`;
};
const withState = (id, f) => {
  const r = buildSancBuilding(id, P0());
  if (r.setTier) r.setTier(RTS_DEFS[id].tier || 1);
  f(r);
  return r.group;
};
const wreckPreview = () => {
  const g = new THREE.Group();
  for (let s = 0; s < 4; s++) {
    const m = new THREE.Mesh(wreckGeo(s), wreckMat());
    m.position.x = [-6, -4, -0.8, 5][s];
    g.add(m);
  }
  return g;
};
export const RTS_SANC_CATALOG = [
  ...[
    ['s_hq', '聖域：聚落中心', '；舊倉庫改的主屋、帆布棚、水塔與互助圓環旗'],
    ['s_hq2', '聖域：互助據點（聚落中心 T2）', '；廢車圍牆與瞭望台'],
    ['s_hq3', '聖域：聖域要塞（聚落中心 T3）', '；混凝土外牆、大型水塔與無線電天線'],
    ['s_depot', '聖域：避難屋', '；半埋的貨櫃、沙包與門口的燈'],
    ['s_hall', '聖域：集會所', '；大帳篷＋組合屋'],
    ['s_extractor', '聖域：Coral 抽取站', '；湧出點上的手搖式鑽塔'],
    ['s_yard', '聖域：回收站', '；廢鐵堆與慢慢轉的磁吸吊車'],
    ['s_shop', '聖域：改裝工坊', '；車庫門、吊起來的零件與焊接火花'],
    ['s_clinic', '聖域：診療所', '；白色帳篷、互助圓環與擔架'],
    ['s_tower', '聖域：瞭望塔', '；鷹架塔、射擊口、探照燈與機槍'],
    ['s_barricade', '聖域：廢鐵路障', '；4 種外觀依位置選（車門、鋼板、輪胎、混合）'],
    ['s_market', '聖域：互助市集', '；攤位與遮陽布'],
    ['s_works', '聖域：回收工廠', '；大型棚屋、門型吊車與壓縮機'],
  ].map(([id, name, extra]) => ['prop', id, name, bldNote(id) + extra, () => withState(id, () => {})]),
  [
    'prop',
    's_site',
    '聖域：施工中的建築（集會所 40%）',
    'Coral 戰爭；木架＋帆布的施工架、依進度長高的本體',
    () => withState('s_hall', (r) => r.setProgress(0.4)),
  ],
  [
    'vehicle',
    's_worker',
    '聖域：互助作業機',
    'Coral 戰爭的工人；作業 MT＋背上的拾荒網籃、右手的磁吸臂、補丁板',
    () => {
      const rig = buildMech(RTS_DEFS.s_worker.asm, P0(), 1);
      return addSancWorkerKit(rig, P0()).group;
    },
  ],
  [
    'vehicle',
    's_hauler',
    '聖域：回收拖車（展開）',
    'Coral 戰爭；裝甲車的車體＋吊臂、磁鐵與貨斗，展開時支腳伸出',
    () => {
      const rig = addHaulerKit(buildVehicle(P0(), 0.85), P0());
      rig.setHaul(1);
      return rig.group;
    },
  ],
  [
    'vehicle',
    's_refit',
    '聖域：改裝零件（民兵 MT，6 種全部顯示）',
    'Coral 戰爭；廢鐵裝甲、拼裝槍管、對空支架、改造推進器、自爆裝藥、加高天線',
    () => {
      const rig = buildMech(RTS_DEFS.s_militia.asm, P0(), 0.8);
      addRefitKits(rig, P0());
      for (const k in rig.rtsRefitKits) rig.rtsRefitKits[k].visible = true;
      return rig.group;
    },
  ],
  [
    'small',
    's_wrecks',
    '聖域：殘骸（小、中、大、建築瓦礫）',
    'Coral 戰爭；地面上的廢鐵堆（拾荒的來源）',
    wreckPreview,
  ],
  [
    'small',
    's_mine',
    '聖域：地雷',
    'Coral 戰爭；布雷無人機放下的地雷盤',
    () => new THREE.Mesh(mineGeo(), wreckMat()),
  ],
];
