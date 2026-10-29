// Coral 戰爭（RTS）的中立模型（docs/rts-design.md 13.6、13.15；D 包）：酒館、中立商店、傭兵營、地上的道具箱、
// 野怪營地的地面標示。全部是純函式（不呼叫亂數、不碰遊戲狀態），模型庫以 RTS_NEUTRAL_CATALOG 登記（只預覽）。
// 建築的原點在底面中心、正面 +Z，尺寸符合 data/rts-neutral.js 的 foot／height（rts-map.js 的 RTS_NEUTRAL_FOOT）；
// rig 的格式同 render/rts-models.js 的 buildRtsBuilding（MechEntity 的 opts.buildModel）。
// 不可 import rts-models.js／rts-units.js（data/rts-neutral.js 會 import 這個檔，rts-units.js 又 import 它）。
import { DETAIL, PK, hazard, mat } from '../world/prop-models.js';

const NEU = 0xe0c040; // 中立的黃色（RTS_TEAM_COLORS[2]）
const glowMat = (c, k = 1.4) => mat(c, { emissive: c, emissiveIntensity: k, roughness: 0.4, metalness: 0 });
function mats(pal) {
  const acc = (pal && pal.acc) || NEU;
  return {
    conc: mat(0x6f6a62, { roughness: 0.95, metalness: 0.05 }),
    rust: mat(0x7a5638, { roughness: 0.85, metalness: 0.35 }),
    plate: mat(0x8a8274, { roughness: 0.7, metalness: 0.4 }),
    wood: mat(0x5a4632, { roughness: 0.9, metalness: 0.05 }),
    cloth: mat(0x8a2c24, { roughness: 0.95, metalness: 0 }),
    cloth2: mat(0x2c4a5a, { roughness: 0.95, metalness: 0 }),
    acc: mat(acc, { roughness: 0.55, metalness: 0.3 }),
    glow: glowMat(acc),
    neon: glowMat(0xff6ad0, 1.6),
    neon2: glowMat(0x60d8ff, 1.6),
    steel: DETAIL.steel,
    dark: DETAIL.dark,
    glass: DETAIL.glass,
    lamp: DETAIL.lamp,
    yellow: DETAIL.yellow,
    black: DETAIL.black,
  };
}
// 中立建築的 rig：建好的、打不壞（setProgress 只是相容）
function rig(group, body, height, glow) {
  const r = {
    group,
    body,
    scaf: null,
    torso: body,
    height,
    vehicle: true,
    cls: 'bld',
    glow,
    progress: 1,
    setProgress(p) {
      r.progress = p;
    },
  };
  return r;
}
function finish(k, height, M) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  k.build(body);
  group.add(body);
  return rig(group, body, height, M.glow);
}

// 酒館（12×12、高 9）：廢棄的貨櫃改裝的兩層酒吧，霓虹招牌、露台的桌子、門口的燈
export function buildTavern(pal) {
  const M = mats(pal);
  const k = new PK(false);
  k.cb(M.conc, 12, 0.5, 12, 0, 0.25, 0, 0, 0, 0, 0.15);
  // 一樓：兩個並排的貨櫃（後方）＋正面的木頭露台
  k.cb(M.rust, 10.5, 3, 4.6, 0, 2, -3.4, 0, 0, 0, 0.06);
  k.cb(M.plate, 4.6, 3, 4.4, -3, 2, 1.2, 0, 0, 0, 0.06);
  for (let i = -5; i <= 5; i += 0.7) k.box(M.dark, 0.08, 2.8, 0.06, i, 2, -1.08);
  // 二樓：橫放的貨櫃＋屋頂
  k.cb(M.cloth2, 9, 2.8, 4.4, 0.6, 4.9, -3.2, 0, 0, 0, 0.06);
  k.box(M.dark, 9.4, 0.25, 4.8, 0.6, 6.45, -3.2);
  k.box(M.glass, 6, 1, 0.08, 0.6, 5.1, -0.98);
  // 招牌：霓虹的酒杯與字條
  k.box(M.black, 5.2, 1.6, 0.25, 0.6, 7.6, -1.3);
  k.box(M.neon, 4.6, 0.18, 0.08, 0.6, 8.2, -1.15);
  k.box(M.neon, 4.6, 0.18, 0.08, 0.6, 7.0, -1.15);
  k.cyl(M.neon2, 0.35, 0.15, 0.8, -1.2, 7.6, -1.12, 0, 0, 0, 8);
  k.box(M.neon2, 2.2, 0.5, 0.06, 1.4, 7.6, -1.12);
  // 天線、水塔
  k.cyl(M.steel, 0.08, 0.1, 3.4, 4.4, 8.2, -4.6);
  k.box(M.glow, 0.3, 0.3, 0.3, 4.4, 9.95, -4.6);
  k.cyl(M.rust, 1.1, 1.1, 1.8, -3.4, 7.5, -4.2, 0, 0, 0, 10);
  // 露台：地板、遮陽布、桌子與凳子
  k.box(M.wood, 7, 0.25, 5, 2, 0.62, 2.4);
  k.box(M.cloth, 6.6, 0.12, 4.2, 2, 3.4, 2.6, 0.12, 0, 0);
  for (const [x, z] of [
    [-1.2, 4.6],
    [5.2, 4.6],
  ])
    k.cyl(M.steel, 0.07, 0.07, 3, x, 2.1, z);
  for (const [x, z] of [
    [0.6, 1.8],
    [3.6, 3.6],
  ]) {
    k.cyl(M.wood, 0.7, 0.7, 0.1, x, 1.6, z, 0, 0, 0, 10);
    k.cyl(M.dark, 0.08, 0.08, 0.9, x, 1.15, z);
    for (const a of [0, 2.1, 4.2])
      k.cyl(M.rust, 0.25, 0.25, 0.55, x + Math.cos(a), 1.0, z + Math.sin(a), 0, 0, 0, 6);
  }
  // 門口的燈與油桶
  k.box(M.lamp, 0.3, 0.3, 0.3, -1.6, 3.2, 3.42);
  for (const [x, z] of [
    [-5, 4.6],
    [-4.2, 5.2],
  ])
    k.cyl(M.yellow, 0.45, 0.45, 1.1, x, 1.05, z, 0, 0, 0, 10);
  return finish(k, 9, M);
}

// 中立商店（10×8、高 8）：鐵皮攤位＋貨架、櫃台上的道具箱、旋轉的招牌燈
export function buildNeutralShop(pal) {
  const M = mats(pal);
  const k = new PK(false);
  k.cb(M.conc, 10, 0.4, 8, 0, 0.2, 0, 0, 0, 0, 0.12);
  // 後牆與兩側
  k.cb(M.plate, 9.4, 4.2, 0.4, 0, 2.5, -3.6);
  k.cb(M.plate, 0.4, 4.2, 7, -4.5, 2.5, -0.3);
  k.cb(M.plate, 0.4, 4.2, 7, 4.5, 2.5, -0.3);
  // 斜屋頂
  k.box(M.rust, 10, 0.25, 8.4, 0, 4.9, -0.2, -0.12, 0, 0);
  hazard(k, M.yellow, M.black, 9.6, 0.4, 0, 4.25, 3.72);
  // 屋頂的條紋（中立黃）與看板：從俯視的鏡頭也認得出是商店
  for (const x of [-3.2, 0, 3.2]) k.box(M.acc, 1.1, 0.06, 8.2, x, 5.04, -0.2, -0.12, 0, 0);
  k.box(M.steel, 0.15, 1.4, 0.15, -2.4, 5.7, -1.4);
  k.box(M.steel, 0.15, 1.4, 0.15, 2.4, 5.7, -1.4);
  k.box(M.black, 6, 1.6, 0.3, 0, 6.9, -1.4, -0.35, 0, 0);
  k.box(M.neon2, 5.4, 0.2, 0.08, 0, 7.45, -1.2, -0.35, 0, 0);
  k.box(M.neon, 5.4, 0.2, 0.08, 0, 6.35, -1.2, -0.35, 0, 0);
  for (const x of [-1.6, 0, 1.6]) k.cb(M.dark, 0.9, 0.6, 0.7, x, 6.9, -1.15, -0.35, 0, 0, 0.05);
  for (const x of [-1.6, 0, 1.6]) k.box(M.glow, 0.92, 0.1, 0.72, x, 7.15, -1.05, -0.35, 0, 0);
  // 櫃台與貨架
  k.cb(M.wood, 7, 1.1, 1.1, 0, 0.95, 1.8, 0, 0, 0, 0.05);
  for (let i = 0; i < 3; i++) {
    k.box(M.dark, 8.4, 0.12, 1, 0, 1.2 + i * 1.1, -2.9);
    for (let j = -3; j <= 3; j++)
      k.box(j % 2 ? M.acc : M.cloth2, 0.6, 0.5, 0.6, j * 1.15, 1.55 + i * 1.1, -2.9);
  }
  // 櫃台上的道具箱（發光）
  for (const x of [-2, 0.4, 2.6]) {
    k.cb(M.dark, 0.9, 0.6, 0.7, x, 1.8, 1.8, 0, 0, 0, 0.05);
    k.box(M.glow, 0.92, 0.1, 0.72, x, 1.95, 1.8);
  }
  // 招牌柱與燈
  k.cyl(M.steel, 0.12, 0.14, 6.6, 4.9, 3.3, 3.6);
  k.box(M.black, 0.25, 1.4, 2.2, 4.9, 6.1, 2.6);
  k.box(M.neon2, 0.08, 0.9, 1.8, 5.05, 6.1, 2.6);
  k.box(M.lamp, 0.4, 0.25, 0.4, -3.8, 4.4, 3.4);
  return finish(k, 7, M);
}

// 傭兵營（12×10、高 6）：沙包圍起來的營地、帳篷、雷達車、旗桿
export function buildMercCamp(pal) {
  const M = mats(pal);
  const k = new PK(false);
  k.cb(M.conc, 12, 0.3, 10, 0, 0.15, 0, 0, 0, 0, 0.1);
  // 沙包牆（三面）
  const sand = mat(0x9a8a62, { roughness: 1, metalness: 0 });
  for (let x = -5.4; x <= 5.4; x += 1.2) k.cb(sand, 1.1, 0.7, 0.7, x, 0.65, -4.5, 0, 0, 0, 0.2);
  for (let z = -3.6; z <= 3.6; z += 1.2) {
    k.cb(sand, 0.7, 0.7, 1.1, -5.6, 0.65, z, 0, 0, 0, 0.2);
    k.cb(sand, 0.7, 0.7, 1.1, 5.6, 0.65, z, 0, 0, 0, 0.2);
  }
  // 帳篷（三角柱）
  k.prism(
    M.cloth2,
    [
      [-2.6, 0],
      [2.6, 0],
      [0, 2.8],
    ],
    5,
    -2.4,
    0.3,
    -1.4,
    0,
    Math.PI / 2,
    0,
  );
  k.prism(
    M.cloth,
    [
      [-2, 0],
      [2, 0],
      [0, 2.3],
    ],
    3.6,
    2.8,
    0.3,
    -2.2,
    0,
    0,
    0,
  );
  // 武器架
  k.box(M.dark, 3, 0.15, 0.5, 2.6, 1.4, 1.6);
  for (let i = 0; i < 4; i++) k.box(M.steel, 0.12, 1.6, 0.12, 1.5 + i * 0.7, 1.4, 1.75, 0.25, 0, 0);
  // 雷達車
  k.cb(M.rust, 2.4, 1.2, 3.6, -3.4, 1.0, 2.6, 0, 0, 0, 0.08);
  k.cyl(M.steel, 0.12, 0.12, 1.6, -3.4, 2.4, 2.4);
  k.box(M.dark, 1.8, 0.9, 0.1, -3.4, 3.4, 2.4, 0.3, 0, 0);
  // 旗桿＋旗子（中立黃）
  k.cyl(M.steel, 0.08, 0.1, 6, 5, 3.3, 3.8);
  k.box(M.acc, 1.6, 0.9, 0.05, 4.15, 5.7, 3.8);
  k.box(M.glow, 0.25, 0.25, 0.25, 5, 6.4, 3.8);
  return finish(k, 6, M);
}

// 地上的道具箱（C 包的 R.items 用：rtsItemSpawn）：發光的小箱子，tier 1～3 的光色不同；約 1.1 m
export function buildItemCrate(tier = 1) {
  const c = [0x9fe8ff, 0x7dff9a, 0xffc04a][Math.max(0, Math.min(2, (tier || 1) - 1))];
  const k = new PK(false);
  const shell = mat(0x3a3f46, { roughness: 0.55, metalness: 0.55 });
  const g = glowMat(c, 1.6);
  k.cb(shell, 1, 0.7, 0.8, 0, 0.35, 0, 0, 0, 0, 0.08);
  k.box(g, 1.02, 0.1, 0.82, 0, 0.5, 0);
  k.box(g, 0.12, 0.72, 0.82, 0, 0.35, 0);
  k.box(DETAIL.black, 0.3, 0.12, 0.84, 0.3, 0.2, 0);
  const group = new THREE.Group();
  k.build(group);
  // 光柱（加色、不投影）：遠處也看得到
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.4, 3, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  beam.position.y = 2;
  beam.userData.noFade = true;
  group.add(beam);
  return group;
}

// 野怪營地的地面標示（營火的灰燼與廢料，tier 越高越大）：只是外觀，不碰撞
export function buildCampMarker(tier = 1) {
  const k = new PK(false);
  const ash = mat(0x2c2622, { roughness: 1, metalness: 0 });
  const scrap = mat(0x5e5246, { roughness: 0.9, metalness: 0.3 });
  const r = 2.2 + tier * 0.6;
  k.cyl(ash, r, r + 0.4, 0.08, 0, 0.04, 0, 0, 0, 0, 14);
  for (let i = 0; i < 4 + tier * 2; i++) {
    const a = i * 2.39,
      d = r * (0.55 + (0.4 * ((i * 37) % 10)) / 10);
    k.cb(
      scrap,
      0.6 + (i % 3) * 0.3,
      0.3 + (i % 2) * 0.3,
      0.5,
      Math.cos(a) * d,
      0.2,
      Math.sin(a) * d,
      0,
      a,
      0.2,
      0.05,
    );
  }
  k.cyl(glowMat(0xff7a30, 1.2), 0.35, 0.45, 0.25, 0, 0.15, 0, 0, 0, 0, 8);
  const group = new THREE.Group();
  k.build(group);
  group.traverse((o) => {
    if (o.isMesh) o.castShadow = false;
  });
  return group;
}

// 模型庫（render/model-catalog.js 以 'rts_' + key 登記；只預覽）
const P0 = () => ({ acc: NEU });
export const RTS_NEUTRAL_CATALOG = [
  [
    'prop',
    'n_tavern',
    '中立：酒館',
    'Coral 戰爭；12×12 m、高 9 m，地圖正中央',
    () => buildTavern(P0()).group,
  ],
  ['prop', 'n_shop', '中立：商店', 'Coral 戰爭；10×8 m、高 8 m，成對', () => buildNeutralShop(P0()).group],
  ['prop', 'n_merc', '中立：傭兵營', 'Coral 戰爭；12×10 m、高 6 m，成對', () => buildMercCamp(P0()).group],
  ['small', 'item_crate', '道具箱', 'Coral 戰爭；地上的道具（約 1 m，光色依階）', () => buildItemCrate(2)],
  ['prop', 'creep_camp', '野怪營地', 'Coral 戰爭；營地的地面標示（大營地）', () => buildCampMarker(3)],
];
