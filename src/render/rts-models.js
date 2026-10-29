// Coral 戰爭（RTS）的模型：建築（卡斯特隆的重工業風格）、建造中的鷹架、礦脈、Coral 湧出點、工人（作業 MT）的工程套件、
// 攜帶礦石的小貨箱。全部是純函式（不呼叫亂數、不碰遊戲狀態），模型庫以 RTS_CATALOG 登記（render/model-catalog.js）。
// 建築的原點在底面中心、正面 +Z，尺寸符合 data/rts-units.js 的 foot／height；陣營色用 rtsPal（玩家藍、電腦紅）。
// 建築的 rig（給 MechEntity 的 opts.buildModel）：{ group, body（建好的本體，建造中依進度往上長）, scaf（鷹架）, torso,
//   height, vehicle: true, cls: 'bld', glow（陣營色的發光材質）, setProgress(p), aimAt(yaw, pitch)（防禦塔轉向） }；
//   主堡三階另有 tier2／tier3 群組與 setTier(1～3)，起重機砲台 arm／hook、防空砲塔 turret／gun／muzzle。
// 另外：叉架 MT 的貨櫃掩體 buildCoverCrates、自走砲的駐鋤 buildArtyLegs（entities/mech-rts.js 的技能用）
import { PALETTES } from './materials.js';
import { buildMech, mechKit } from './mech-model.js';
import { DETAIL, PK, hazard, ladder, mat, railing, truss } from '../world/prop-models.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';
import { addAethWorkerKit, buildAethBuilding, isAethBuilding } from './rts-aeth-models.js';
import { addVeerWorkerKit, buildVeerBuilding, isVeerBuilding } from './rts-veer-models.js';
import { addSancWorkerKit, buildSancBuilding, isSancBuilding } from './rts-sancta-models.js';

// ---------- 陣營色 ----------
const PAL_CACHE = {};
// 陣營的配色＋隊伍色（main2、acc、visor、glow 換成隊伍色）
export function rtsPal(faction, team) {
  const k = faction + '|' + team;
  if (PAL_CACHE[k]) return PAL_CACHE[k];
  const base = PALETTES[faction] || PALETTES.castron;
  const tc = RTS_TEAM_COLORS[team] !== undefined ? RTS_TEAM_COLORS[team] : RTS_TEAM_COLORS[0];
  const dark = new THREE.Color(tc).multiplyScalar(0.42).getHex();
  return (PAL_CACHE[k] = { ...base, main2: dark, acc: tc, visor: tc, glow: tc, team: tc });
}
const glowMat = (c, k = 1.4) => mat(c, { emissive: c, emissiveIntensity: k, roughness: 0.4, metalness: 0 });
// 卡斯特隆的建材：底色（土黃鏽鋼）、深色鋼、隊伍色塗裝、混凝土
function mats(pal) {
  return {
    main: mat(pal.main, { roughness: 0.78, metalness: 0.35 }),
    main3: mat(pal.main3 || pal.main, { roughness: 0.7, metalness: 0.4 }),
    team: mat(pal.main2, { roughness: 0.6, metalness: 0.35 }),
    sub: mat(pal.sub || 0x2a241c, { roughness: 0.75, metalness: 0.45 }),
    steel: DETAIL.steel,
    dark: DETAIL.dark,
    conc: mat(0x77736b, { roughness: 0.95, metalness: 0.05 }),
    glow: glowMat(pal.glow || 0xffb060),
    lamp: DETAIL.lamp,
    glass: DETAIL.glass,
    yellow: DETAIL.yellow,
    black: DETAIL.black,
  };
}

// ---------- 建築 ----------
// 主堡（16×16、高 13）：基座平台、主廠房、指揮塔、兩座儲料筒、煙囪、正面的礦石投入口
function hqBody(k, M) {
  k.cb(M.conc, 16, 1.2, 16, 0, 0.6, 0, 0, 0, 0, 0.3);
  k.cb(M.main, 12, 6.5, 11, 0, 4.45, -0.5, 0, 0, 0, 0.25);
  k.box(M.team, 12.2, 0.7, 11.2, 0, 7.2, -0.5);
  k.cb(M.main3, 6, 4.2, 5.5, -1.5, 9.6, -1.5, 0, 0, 0, 0.2);
  k.box(M.glass, 5, 0.9, 0.1, -1.5, 10.3, 1.27);
  k.box(M.team, 6.2, 0.4, 5.7, -1.5, 11.9, -1.5);
  // 天線與信號燈
  k.cyl(M.steel, 0.12, 0.16, 3.2, -3.4, 13.6, -3);
  k.box(M.glow, 0.4, 0.4, 0.4, -3.4, 15.3, -3);
  // 儲料筒
  for (const s of [-1, 1]) {
    k.cyl(M.main3, 1.7, 1.7, 8.5, s * 6.2, 5.45, -5.8, 0, 0, 0, 12);
    k.cyl(M.sub, 1.85, 1.85, 0.4, s * 6.2, 9.8, -5.8, 0, 0, 0, 12);
    k.cyl(M.team, 1.78, 1.78, 0.6, s * 6.2, 4, -5.8, 0, 0, 0, 12);
  }
  // 煙囪
  k.cyl(M.dark, 0.7, 0.9, 6, 4, 10.5, -3.5, 0, 0, 0, 10);
  k.cyl(M.glow, 0.72, 0.72, 0.25, 4, 12.2, -3.5, 0, 0, 0, 10);
  // 正面：投入口與大門
  k.cb(M.sub, 6, 3.6, 1.2, 0, 2.2 + 1.2, 5.4, 0, 0, 0, 0.12);
  k.box(M.dark, 4.6, 2.8, 0.2, 0, 2.6, 6.05);
  hazard(k, M.yellow, M.black, 6, 0.5, 0, 4.6, 6.06);
  k.box(M.lamp, 0.5, 0.3, 0.3, -3.6, 4.6, 6.0);
  k.box(M.lamp, 0.5, 0.3, 0.3, 3.6, 4.6, 6.0);
  // 側面的輸送帶與漏斗（礦石回收）
  k.at(6.8, 1.2, 2.5, 0, 0, 0, () => {
    k.box(M.dark, 2.2, 0.4, 4, 0, 0.5, 0);
    k.cyl(M.main3, 1.4, 0.5, 1.8, 0, 1.8, 0, 0, Math.PI / 4, 0, 4);
  });
  railing(k, M.steel, 12, 1, 0, 7.55, 5.0);
  ladder(k, M.steel, 6.3, -5.6, 1.2, 5.05);
  // 角落的隊伍色燈
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.glow, 0.5, 0.5, 0.5, sx * 7.4, 1.45, sz * 7.4);
}
// 補給庫（8×8、高 6）：疊放的物資貨櫃、燃料槽、隊伍旗燈
function depotBody(k, M) {
  k.cb(M.conc, 8, 0.5, 8, 0, 0.25, 0, 0, 0, 0, 0.15);
  k.cb(M.main, 6.2, 2.4, 2.6, -0.5, 1.7, -2.2, 0, 0, 0, 0.08);
  k.cb(M.team, 6.2, 2.4, 2.6, -0.5, 4.1, -2.2, 0, 0, 0, 0.08);
  k.cb(M.main3, 4, 2.4, 2.6, -1.6, 1.7, 1.0, 0, 0, 0, 0.08);
  for (const x of [-2.6, -1.3, 0, 1.3, 2.6]) k.box(M.sub, 0.08, 2.2, 2.66, x - 0.5, 1.7, -2.2);
  k.cyl(M.main3, 1.3, 1.3, 3.6, 2.4, 2.3, 1.6, 0, 0, 0, 10);
  k.cyl(M.dark, 1.36, 1.36, 0.25, 2.4, 3.2, 1.6, 0, 0, 0, 10);
  k.cyl(M.steel, 0.08, 0.08, 5.6, 3.4, 3.3, -3.4);
  k.box(M.glow, 1.2, 0.7, 0.06, 2.8, 5.6, -3.4);
  hazard(k, M.yellow, M.black, 4, 0.35, -1.6, 0.68, 2.31);
}
// 兵工廠（14×12、高 10）：鋸齒屋頂的廠房、大門、屋頂的龍門吊、煙囪
function factoryBody(k, M) {
  k.cb(M.conc, 14, 0.8, 12, 0, 0.4, 0, 0, 0, 0, 0.2);
  k.cb(M.main, 12.4, 6, 10.4, 0, 3.8, 0, 0, 0, 0, 0.2);
  // 鋸齒屋頂（三段）
  for (let i = 0; i < 3; i++) {
    const z = -3.4 + i * 3.4;
    k.prism(
      M.main3,
      [
        [-1.7, 0],
        [1.7, 0],
        [1.7, 2.2],
      ],
      12.4,
      0,
      6.8,
      z,
      0,
      Math.PI / 2,
      0,
    );
    k.box(M.glass, 12, 2, 0.1, 0, 7.9, z + 1.62, 0.0);
  }
  k.box(M.team, 12.6, 0.6, 10.6, 0, 6.6, 0);
  // 大門（+Z）
  k.box(M.dark, 7, 5, 0.25, 0, 3.3, 5.22);
  for (let y = 1.4; y < 5.6; y += 0.7) k.box(M.sub, 7, 0.1, 0.08, 0, y, 5.36);
  hazard(k, M.yellow, M.black, 8, 0.5, 0, 6.05, 5.25);
  k.box(M.lamp, 0.6, 0.3, 0.3, -4.2, 5.4, 5.3);
  k.box(M.lamp, 0.6, 0.3, 0.3, 4.2, 5.4, 5.3);
  // 屋頂的龍門吊
  for (const s of [-1, 1]) k.box(M.steel, 0.4, 3, 0.4, s * 5.6, 8.3, 3.8);
  truss(k, M.steel, 11.6, 0.9, 0, 9.9, 3.8, 0, 0.16);
  k.box(M.yellow, 1.4, 0.8, 1.2, 1.5, 9.1, 3.8);
  // 煙囪與通風
  k.cyl(M.dark, 0.6, 0.75, 4.5, -5, 8.9, -4, 0, 0, 0, 10);
  k.cyl(M.glow, 0.62, 0.62, 0.22, -5, 10.2, -4, 0, 0, 0, 10);
  for (const x of [-2, 0, 2]) k.cyl(M.sub, 0.45, 0.45, 0.8, x, 7.9, -4.6, 0, 0, 0, 8);
  // 側面的零件架
  k.at(-6.6, 0.8, -1, 0, 0, 0, () => {
    k.box(M.steel, 0.12, 3, 4, 0, 1.5, 0);
    k.cb(M.team, 0.8, 0.8, 1.2, -0.2, 0.5, -1, 0, 0, 0, 0.05);
    k.cb(M.main3, 0.8, 0.8, 1.2, -0.2, 0.5, 1, 0, 0, 0, 0.05);
  });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(M.glow, 0.4, 0.4, 0.4, sx * 6.6, 1.0, sz * 5.6);
}
// Coral 抽取站（8×8、高 9）：四腳鑽塔、抽取頭、往下插進湧出點的管子、Coral 儲槽（發光）
function extractorBody(k, M) {
  k.cb(M.conc, 8, 0.6, 8, 0, 0.3, 0, 0, 0, 0, 0.15);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(M.main3, [sx * 3, 0.6, sz * 3], [sx * 1, 8.2, sz * 1], 0.32);
  for (const y of [2.6, 4.8, 6.8]) {
    const r = 3 - ((y - 0.6) / 7.6) * 2;
    k.box(M.steel, r * 2, 0.16, 0.16, 0, y, r);
    k.box(M.steel, r * 2, 0.16, 0.16, 0, y, -r);
    k.box(M.steel, 0.16, 0.16, r * 2, r, y, 0);
    k.box(M.steel, 0.16, 0.16, r * 2, -r, y, 0);
  }
  k.cb(M.team, 2.6, 1.2, 2.6, 0, 8.6, 0, 0, 0, 0, 0.1);
  k.cyl(M.dark, 0.45, 0.45, 8, 0, 4.6, 0, 0, 0, 0, 8);
  k.box(M.glow, 0.5, 0.5, 0.5, 0, 9.5, 0);
  // Coral 儲槽：發光的窗
  for (const s of [-1, 1]) {
    k.cyl(M.main, 1.1, 1.1, 3, s * 2.6, 2.1, 2.6, 0, 0, 0, 10);
    k.cyl(CORAL_GLOW(), 0.6, 0.6, 2.2, s * 2.6, 2.1, 3.25, 0, 0, 0, 6);
    k.pipe(M.steel, [s * 2.6, 3.5, 2.6], [0, 3.5, 0.4], 0.15);
  }
  hazard(k, M.yellow, M.black, 6, 0.3, 0, 0.75, -3.98, Math.PI);
}
// 主堡 T2（要塞主堡，高 15）：四周的外牆（正面留大門）、兩座前角的砲座、加高的指揮塔頂
function hqTier2(k, M) {
  for (const s of [-1, 1]) {
    // 側牆與後牆
    k.cb(M.conc, 0.9, 2.6, 13.6, s * 7.55, 1.3 + 1.2, -0.6, 0, 0, 0, 0.12);
    k.box(M.team, 0.95, 0.4, 13.6, s * 7.55, 3.7, -0.6);
    // 正面牆（大門兩側）
    k.cb(M.conc, 3.8, 2.6, 0.9, s * 5.7, 2.5, 7.55, 0, 0, 0, 0.12);
    k.box(M.team, 3.8, 0.4, 0.95, s * 5.7, 3.7, 7.55);
    // 前角的砲座：基座＋雙管
    k.at(s * 6.9, 3.9, 6.9, 0, 0, 0, () => {
      k.cyl(M.main3, 1.15, 1.3, 1.2, 0, 0.6, 0, 0, 0, 0, 10);
      k.cb(M.sub, 1.4, 0.8, 1.6, 0, 1.6, 0, 0, 0, 0, 0.1);
      for (const g of [-0.3, 0.3]) k.cyl(M.dark, 0.12, 0.14, 2.2, g, 1.7, 1.6, Math.PI / 2, 0, 0, 6);
      k.box(M.glow, 0.3, 0.2, 0.1, 0, 2.05, 0.81);
    });
  }
  k.cb(M.conc, 15.1, 2.6, 0.9, 0, 2.5, -7.55, 0, 0, 0, 0.12);
  k.box(M.team, 15.1, 0.4, 0.95, 0, 3.7, -7.55);
  // 加高的指揮塔頂（到 15 m）
  k.cb(M.main3, 4.4, 2.4, 4, -1.5, 13.3, -1.5, 0, 0, 0, 0.15);
  k.box(M.glass, 3.8, 0.7, 0.1, -1.5, 13.6, 0.52);
  k.box(M.team, 4.6, 0.3, 4.2, -1.5, 14.65, -1.5);
}
// 主堡 T3（重工司令部，高 17）：司令塔、雷達盤、兩根天線與屋頂的信號燈
function hqTier3(k, M) {
  k.cb(M.main, 3.2, 2.2, 3, -1.5, 15.9, -1.5, 0, 0, 0, 0.12);
  k.box(M.glass, 2.8, 0.6, 0.1, -1.5, 16.2, 0.02);
  k.cyl(M.steel, 0.1, 0.12, 4.5, -2.8, 16.2, -2.8, 0, 0, 0, 6);
  k.cyl(M.steel, 0.08, 0.1, 3.4, 4, 15.2, -3.5, 0, 0, 0, 6);
  k.box(M.glow, 0.35, 0.35, 0.35, -2.8, 18.5, -2.8);
  k.box(M.glow, 0.3, 0.3, 0.3, 4, 17, -3.5);
  // 雷達盤（傾斜的圓盤＋支架）
  k.cyl(M.dark, 0.25, 0.25, 0.8, -0.5, 17.4, -0.5, 0, 0, 0, 6);
  k.cyl(M.main3, 1.4, 0.6, 0.35, -0.5, 18, -0.5, 0.5, 0, 0, 12);
  // 側面的旗桿與隊伍色布條
  for (const s of [-1, 1]) {
    k.cyl(M.steel, 0.07, 0.07, 6, s * 7.55, 6.6, 7.55, 0, 0, 0, 6);
    k.box(M.team, 0.06, 2, 1.2, s * 7.55, 8.4, 6.9);
  }
}
// 工程研究所（12×10、高 9）：研究棟、圓頂的實驗室、衛星天線、側面的試驗台
function worksBody(k, M) {
  k.cb(M.conc, 12, 0.6, 10, 0, 0.3, 0, 0, 0, 0, 0.15);
  k.cb(M.main, 8, 4.6, 7, -1.5, 2.9, -0.5, 0, 0, 0, 0.2);
  k.box(M.team, 8.2, 0.5, 7.2, -1.5, 5.3, -0.5);
  for (let i = 0; i < 4; i++) k.box(M.glass, 1.2, 1.4, 0.1, -4.4 + i * 1.95, 3.2, 3.04);
  // 圓頂
  k.geo(
    M.main3,
    new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    2.2,
    5.4,
    -1,
    0,
    0,
    0,
    2.6,
    2.4,
    2.6,
  );
  k.box(M.glass, 0.6, 2.2, 0.08, 2.2, 6.6, 1.55, -0.4, 0, 0);
  // 衛星天線
  k.cyl(M.steel, 0.12, 0.14, 2.4, -4.2, 6.6, -2.6, 0, 0, 0, 6);
  k.cyl(M.main3, 1.3, 0.3, 0.4, -4.2, 8.0, -2.6, -0.6, 0, 0.3, 12);
  k.box(M.glow, 0.25, 0.25, 0.25, -4.2, 8.4, -2.4);
  // 試驗台：架上的零件與夾具
  k.at(4.4, 0.6, 2.6, 0, 0, 0, () => {
    k.box(M.dark, 2.6, 0.3, 2.6, 0, 0.15, 0);
    for (const sx of [-1, 1]) k.box(M.steel, 0.15, 2.6, 0.15, sx * 1.1, 1.3, 0);
    k.box(M.steel, 2.4, 0.15, 0.15, 0, 2.6, 0);
    k.cb(M.team, 0.9, 1.1, 0.9, 0, 1.0, 0, 0.3, 0.5, 0, 0.06);
  });
  hazard(k, M.yellow, M.black, 3, 0.35, 4.4, 0.8, 3.95);
  k.box(M.lamp, 0.5, 0.3, 0.3, -1.5, 4.7, 3.05);
}
// 起重機砲台（6×6、高 16）：格子塔＋塔頂的駕駛室；旋轉的吊臂另外建（towerArm，rig.arm）
function towerBody(k, M) {
  k.cb(M.conc, 6, 0.8, 6, 0, 0.4, 0, 0, 0, 0, 0.15);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(M.main3, [sx * 2.2, 0.8, sz * 2.2], [sx * 1, 13.4, sz * 1], 0.3);
  for (const y of [3.4, 6.4, 9.4, 12.2]) {
    const r = 2.2 - ((y - 0.8) / 12.6) * 1.2;
    k.box(M.steel, r * 2, 0.15, 0.15, 0, y, r);
    k.box(M.steel, r * 2, 0.15, 0.15, 0, y, -r);
    k.box(M.steel, 0.15, 0.15, r * 2, r, y, 0);
    k.box(M.steel, 0.15, 0.15, r * 2, -r, y, 0);
  }
  k.cyl(M.team, 1.5, 1.5, 0.6, 0, 13.7, 0, 0, 0, 0, 12);
  ladder(k, M.steel, 12, 0, 0.8, 1.6);
  hazard(k, M.yellow, M.black, 5, 0.3, 0, 0.95, 3.02);
}
// 吊臂（原點在旋轉軸、吊臂朝 −Z）：駕駛室、配重、吊臂、吊鉤與貨櫃
function towerArm(M) {
  const k = new PK(false);
  k.cb(M.main, 2.2, 1.6, 2.4, 0, 0.8, 0.4, 0, 0, 0, 0.1);
  k.box(M.glass, 1.6, 0.7, 0.08, 0, 1.0, -0.82);
  k.cb(M.sub, 2, 1.2, 1.6, 0, 0.7, 2.6, 0, 0, 0, 0.08); // 配重
  truss(k, M.yellow, 9, 0.9, 0, 1.4, -4.6, Math.PI / 2, 0.14);
  k.pipe(M.steel, [0, 2.6, 0.5], [0, 1.9, -8.8], 0.05);
  k.box(M.steel, 0.05, 2.2, 0.05, 0, 0.3, -8.6);
  k.cb(M.team, 1.6, 1, 1, 0, -1.2, -8.6, 0, 0, 0, 0.05);
  k.box(M.glow, 0.25, 0.2, 0.25, 0, 2.05, -9);
  const g = k.build(new THREE.Group());
  const hook = new THREE.Object3D();
  hook.position.set(0, -1.2, -8.6);
  g.add(hook);
  return { g, hook };
}
// 城牆（4×2、高 4）：混凝土牆段＋頂部的隊伍色條與鐵絲網支架
function wallBody(k, M) {
  k.cb(M.conc, 4, 3.4, 1.6, 0, 1.7, 0, 0, 0, 0, 0.18);
  k.cb(M.conc, 4.1, 0.6, 2, 0, 0.3, 0, 0, 0, 0, 0.12);
  k.box(M.team, 4.04, 0.35, 1.64, 0, 2.9, 0);
  for (const x of [-1.6, 0, 1.6]) k.box(M.steel, 0.08, 0.6, 0.08, x, 3.7, 0);
  k.box(M.steel, 3.4, 0.05, 0.05, 0, 3.9, 0);
  k.box(M.steel, 3.4, 0.05, 0.05, 0, 3.6, 0);
  hazard(k, M.yellow, M.black, 3.6, 0.3, 0, 0.8, 1.02);
  hazard(k, M.yellow, M.black, 3.6, 0.3, 0, 0.8, -1.02, Math.PI);
}
// 補給商店（10×8、高 7）：倉庫＋前面的遮雨棚、陳列的貨箱、發光的招牌
function marketBody(k, M) {
  k.cb(M.conc, 10, 0.5, 8, 0, 0.25, 0, 0, 0, 0, 0.15);
  k.cb(M.main, 8, 4.4, 5, 0, 2.7, -1.2, 0, 0, 0, 0.18);
  k.prism(
    M.main3,
    [
      [-4.2, 0],
      [4.2, 0],
      [0, 1.6],
    ],
    5.2,
    0,
    4.9,
    -1.2,
  );
  k.box(M.dark, 4, 2.8, 0.15, 0, 1.9, 1.35);
  // 遮雨棚（隊伍色）與柱子
  k.box(M.team, 8.6, 0.15, 2.6, 0, 4.2, 2.5, 0.18, 0, 0);
  for (const s of [-1, 1]) k.box(M.steel, 0.12, 3.6, 0.12, s * 4, 2.3, 3.6);
  // 招牌
  k.box(M.sub, 4.4, 1.1, 0.2, 0, 5.4, 1.4);
  k.box(M.glow, 3.8, 0.5, 0.06, 0, 5.4, 1.52);
  // 貨箱
  k.cb(M.team, 1.2, 1, 1.2, -3.4, 1.0, 3.1, 0, 0.3, 0, 0.06);
  k.cb(M.main3, 1, 0.9, 1, -3.0, 1.95, 3.0, 0, -0.2, 0, 0.06);
  k.cb(M.sub, 1.4, 1.1, 1.0, 3.3, 1.05, 3.2, 0, 0.1, 0, 0.06);
  k.cyl(M.main3, 0.5, 0.5, 1.2, 4.3, 1.1, 1.6, 0, 0, 0, 8);
  k.box(M.lamp, 0.4, 0.3, 0.3, -2.4, 3.9, 1.4);
  k.box(M.lamp, 0.4, 0.3, 0.3, 2.4, 3.9, 1.4);
}
// 重工廠（16×14、高 12）：高大的組裝廠房、兩扇大門、屋頂的大型龍門吊與排氣塔
function heavyBody(k, M) {
  k.cb(M.conc, 16, 0.8, 14, 0, 0.4, 0, 0, 0, 0, 0.2);
  k.cb(M.main, 14.4, 8, 12, 0, 4.8, 0, 0, 0, 0, 0.25);
  k.box(M.team, 14.6, 0.7, 12.2, 0, 8.6, 0);
  k.prism(
    M.main3,
    [
      [-7.2, 0],
      [7.2, 0],
      [5.6, 1.4],
      [-5.6, 1.4],
    ],
    12,
    0,
    8.95,
    0,
    0,
    0,
    0,
  );
  // 兩扇大門（+Z）
  for (const s of [-1, 1]) {
    k.box(M.dark, 5.6, 6.6, 0.25, s * 3.4, 4.1, 6.05);
    for (let y = 1.5; y < 7.4; y += 0.8) k.box(M.sub, 5.6, 0.1, 0.08, s * 3.4, y, 6.2);
    k.box(M.lamp, 0.6, 0.3, 0.3, s * 6.6, 7.7, 6.1);
  }
  hazard(k, M.yellow, M.black, 13, 0.5, 0, 7.75, 6.07);
  // 屋頂的龍門吊
  for (const s of [-1, 1]) k.box(M.steel, 0.45, 2.8, 0.45, s * 6.6, 11.2, 4);
  truss(k, M.yellow, 13.6, 1, 0, 12.4, 4, 0, 0.18);
  k.cb(M.sub, 1.6, 1, 1.4, -2, 11.5, 4, 0, 0, 0, 0.08);
  // 排氣塔
  for (const x of [-5.5, -3.8]) {
    k.cyl(M.dark, 0.6, 0.75, 4, x, 11.4, -4.5, 0, 0, 0, 10);
    k.cyl(M.glow, 0.62, 0.62, 0.22, x, 13.2, -4.5, 0, 0, 0, 10);
  }
  // 側面的零件堆與油槽
  k.at(7.9, 0.8, -3, 0, 0, 0, () => {
    k.cyl(M.main3, 1, 1, 3.2, 0, 1.6, 0, 0, 0, 0, 10);
    k.cyl(M.team, 1.04, 1.04, 0.4, 0, 2.4, 0, 0, 0, 0, 10);
  });
  railing(k, M.steel, 14, 1, 0, 9.3, 6.0);
  ladder(k, M.steel, 8.6, -7.3, 0.8, 4, Math.PI / 2);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.box(M.glow, 0.45, 0.45, 0.45, sx * 7.6, 1.0, sz * 6.6);
}
// 防空砲塔（5×5、高 8）：基座與支柱；旋轉的砲塔另外建（flakTurret，rig.turret／rig.gun）
function flakBody(k, M) {
  k.cb(M.conc, 5, 0.8, 5, 0, 0.4, 0, 0, 0, 0, 0.15);
  k.cyl(M.main3, 1.4, 2, 3.6, 0, 2.6, 0, 0, 0, 0, 10);
  k.cyl(M.team, 1.5, 1.5, 0.5, 0, 4.0, 0, 0, 0, 0, 10);
  for (const s of [-1, 1]) {
    k.cb(M.sub, 1, 1.2, 1, s * 1.9, 1.4, 1.9, 0, 0, 0, 0.06);
    k.cb(M.sub, 1, 1.2, 1, s * 1.9, 1.4, -1.9, 0, 0, 0, 0.06);
  }
  hazard(k, M.yellow, M.black, 4, 0.3, 0, 0.95, 2.52);
}
// 防空砲塔的砲塔（原點在旋轉軸）：砲塔本體＋可以俯仰的四管機砲（gun，朝 −Z）
function flakTurret(M) {
  const k = new PK(false);
  k.cb(M.main, 2.6, 1.4, 2.6, 0, 0.7, 0, 0, 0, 0, 0.15);
  k.box(M.glass, 1, 0.35, 0.08, 0.6, 1.1, -1.32);
  k.cyl(M.dark, 0.5, 0.5, 0.3, -0.8, 1.55, 0.6, 0, 0, 0, 8);
  const tur = k.build(new THREE.Group());
  const g = new PK(false);
  g.cb(M.sub, 1.6, 0.8, 1.2, 0, 0, 0, 0, 0, 0, 0.08);
  for (const x of [-0.45, -0.15, 0.15, 0.45])
    g.cyl(M.dark, 0.08, 0.1, 3, x, 0.05, -1.9, Math.PI / 2, 0, 0, 6);
  g.box(M.glow, 1.2, 0.12, 0.1, 0, 0.45, -0.62);
  const gun = g.build(new THREE.Group());
  gun.position.set(0, 1.5, -0.2);
  tur.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.05, -3.5);
  gun.add(muzzle);
  return { tur, gun, muzzle };
}
// 停機坪（14×14、高 5）：平台、H 標示與邊燈、塔台、油槽
function helipadBody(k, M) {
  k.cb(M.conc, 14, 1, 14, 0, 0.5, 0, 0, 0, 0, 0.2);
  k.cb(M.dark, 11, 0.12, 11, 0, 1.06, 0, 0, 0, 0, 0.05);
  // H 標示
  k.box(M.yellow, 0.8, 0.04, 5, -1.8, 1.14, 0);
  k.box(M.yellow, 0.8, 0.04, 5, 1.8, 1.14, 0);
  k.box(M.yellow, 2.8, 0.04, 0.8, 0, 1.14, 0);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(M.glow, 0.3, 0.2, 0.3, Math.cos(a) * 5.3, 1.2, Math.sin(a) * 5.3);
  }
  // 塔台
  k.at(-5.9, 1, -5.9, 0, 0, 0, () => {
    k.cb(M.main, 1.8, 2.6, 1.8, 0, 1.3, 0, 0, 0, 0, 0.1);
    k.cb(M.main3, 2.2, 1, 2.2, 0, 3.1, 0, 0, 0, 0, 0.1);
    k.box(M.glass, 2.24, 0.5, 2.24, 0, 3.15, 0);
    k.cyl(M.steel, 0.05, 0.05, 1.2, 0.6, 4.2, 0.6, 0, 0, 0, 5);
    k.box(M.glow, 0.2, 0.2, 0.2, 0.6, 4.85, 0.6);
  });
  // 油槽
  for (const z of [3.6, 5.6]) k.cyl(M.team, 0.8, 0.8, 1.8, -6.2, 1.9, z, Math.PI / 2, 0, 0, 10);
  // 風向袋的桿
  k.cyl(M.steel, 0.06, 0.06, 3, 6.2, 2.5, -6.2, 0, 0, 0, 5);
  k.cyl(M.yellow, 0.25, 0.12, 1, 6.2, 3.6, -5.7, Math.PI / 2, 0, 0, 6);
}
const BODY = {
  c_hq: hqBody,
  c_hq2: hqBody,
  c_hq3: hqBody,
  c_depot: depotBody,
  c_factory: factoryBody,
  c_extractor: extractorBody,
  c_works: worksBody,
  c_tower: towerBody,
  c_wall: wallBody,
  c_market: marketBody,
  c_heavy: heavyBody,
  c_flak: flakBody,
  c_helipad: helipadBody,
};
const HQ_IDS = new Set(['c_hq', 'c_hq2', 'c_hq3']);

// 鷹架：佔地四周的柱子與每 2.5 m 一圈橫桿（建造中顯示）
function scaffold(w, d, h, M) {
  const k = new PK(false);
  const hw = w / 2 + 0.3,
    hd = d / 2 + 0.3;
  const nx = Math.max(2, Math.round(w / 4)),
    nz = Math.max(2, Math.round(d / 4));
  for (let i = 0; i <= nx; i++)
    for (const s of [-1, 1]) k.box(M.yellow, 0.14, h, 0.14, -hw + (2 * hw * i) / nx, h / 2, s * hd);
  for (let i = 1; i < nz; i++)
    for (const s of [-1, 1]) k.box(M.yellow, 0.14, h, 0.14, s * hw, h / 2, -hd + (2 * hd * i) / nz);
  for (let y = 2.5; y < h + 0.1; y += 2.5) {
    for (const s of [-1, 1]) {
      k.box(M.steel, 2 * hw, 0.1, 0.1, 0, y, s * hd);
      k.box(M.steel, 0.1, 0.1, 2 * hd, s * hw, y, 0);
    }
    k.box(M.dark, 2 * hw, 0.08, 0.9, 0, y - 0.05, hd - 0.45); // 踏板
  }
  for (let i = 0; i < nx; i++) {
    const x0 = -hw + (2 * hw * i) / nx,
      x1 = x0 + (2 * hw) / nx;
    k.bar(M.steel, [x0, 0.2, hd], [x1, Math.min(h, 4), hd], 0.08);
  }
  return k.build(new THREE.Group());
}

export function buildRtsBuilding(id, pal) {
  if (isAethBuilding(id)) return buildAethBuilding(id, pal); // 艾瑟立克（R3 B 包：render/rts-aeth-models.js）
  if (isVeerBuilding(id)) return buildVeerBuilding(id, pal); // 維爾威（R4 B 包：render/rts-veer-models.js）
  if (isSancBuilding(id)) return buildSancBuilding(id, pal); // 聖域（R5 B 包：render/rts-sancta-models.js）
  const D = RTS_DEFS[id];
  const M = mats(pal);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const k = new PK(false);
  (BODY[id] || depotBody)(k, M);
  k.build(body);
  group.add(body);
  const [w, d] = D.foot;
  const scaf = scaffold(w, d, D.height, M);
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
    glow: M.glow,
    progress: 1,
    // 建造進度（0～1）：本體往上長、鷹架在完成前顯示
    setProgress(p) {
      p = Math.max(0, Math.min(1, p));
      rig.progress = p;
      body.scale.y = 0.06 + 0.94 * p;
      scaf.visible = p < 1;
    },
  };
  // 主堡三階（docs 13.3）：T2 外牆與砲座、T3 司令塔與天線；同一個模型切換子群組的 visible
  if (HQ_IDS.has(id)) {
    const mk = (fn) => {
      const kk = new PK(false);
      fn(kk, M);
      const grp = kk.build(new THREE.Group());
      body.add(grp);
      return grp;
    };
    rig.tier2 = mk(hqTier2);
    rig.tier3 = mk(hqTier3);
    rig.tier = 0;
    // 合併過的（RTS 渲染設定）先還原、切換後再合併，合併出來的網格才會照新的可見度
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
  // 起重機砲台的吊臂（rig.arm 繞 Y 轉、rig.hook＝貨櫃的出手點）
  if (id === 'c_tower') {
    const { g, hook } = towerArm(M);
    g.position.set(0, 14, 0);
    body.add(g);
    rig.arm = g;
    rig.hook = hook;
  }
  // 防空砲塔的砲塔（rig.turret 繞 Y、rig.gun 俯仰、rig.muzzle＝砲口）
  if (id === 'c_flak') {
    const { tur, gun, muzzle } = flakTurret(M);
    tur.position.set(0, 4.25, 0);
    body.add(tur);
    rig.turret = tur;
    rig.gun = gun;
    rig.muzzle = muzzle;
  }
  // 防禦塔轉向（yaw：建築座標裡的方位，朝 −Z 為 0；pitch：仰角）
  rig.aimAt = (yaw, pitch = 0) => {
    const piv = rig.arm || rig.turret;
    if (piv) piv.rotation.y = yaw;
    if (rig.gun) rig.gun.rotation.x = Math.max(0, Math.min(1.3, pitch));
  };
  return rig;
}
// 叉架 MT 的貨櫃掩體（docs 13.3 的 ab_cover）：兩層疊放的貨櫃；原點在底面中心、寬沿 X、厚沿 Z（game/hazards2.js 的
// 臨時障礙物換上這個外觀，所以尺寸跟著臨時牆）
export function buildCoverCrates(w = 8, h = 3, d = 2.6, pal = rtsPal('castron', 0)) {
  const M = mats(pal);
  const k = new PK(false);
  const cw = w / 2 - 0.05;
  for (const s of [-1, 1]) {
    k.cb(s < 0 ? M.team : M.main3, cw, h * 0.5, d, (s * w) / 4, h * 0.25, 0, 0, 0, 0, 0.05);
    for (let i = 0; i < 6; i++)
      k.box(M.sub, 0.08, h * 0.46, d + 0.04, (s * w) / 4 - cw / 2 + 0.3 + (i * (cw - 0.6)) / 5, h * 0.25, 0);
  }
  k.cb(M.main, cw, h * 0.48, d * 0.92, -w / 8, h * 0.75, 0, 0, 0.06, 0, 0.05);
  for (let i = 0; i < 5; i++)
    k.box(
      M.sub,
      0.08,
      h * 0.44,
      d * 0.95,
      -w / 8 - cw / 2 + 0.3 + (i * (cw - 0.6)) / 4,
      h * 0.75,
      0,
      0,
      0.06,
      0,
    );
  hazard(k, M.yellow, M.black, cw * 0.8, 0.3, w / 4, h * 0.42, d / 2 + 0.03);
  return k.build(new THREE.Group());
}
// 自走砲架設時放下的四支駐鋤（MechEntity 的 sx.rtsLegs；原點在車體中心的地面，k＝放下的程度 0～1 由 scale 控制）
export function buildArtyLegs(pal) {
  const M = mats(pal);
  const k = new PK(false);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      k.cb(M.dark, 0.5, 0.5, 0.5, sx * 1.3, 1.2, sz * 1.7, 0, 0, 0, 0.04);
      k.bar(M.yellow, [sx * 1.3, 1.2, sz * 1.7], [sx * 3.1, 0.2, sz * 3.0], 0.3);
      k.bar(M.steel, [sx * 1.3, 0.8, sz * 1.7], [sx * 2.4, 0.35, sz * 2.5], 0.14);
      k.cb(M.dark, 1, 0.18, 1, sx * 3.15, 0.09, sz * 3.05, 0, 0, 0, 0.03);
    }
  return k.build(new THREE.Group());
}

// ---------- 礦脈、Coral 湧出點 ----------
// 礦脈（半徑約 4 m）：岩塊堆＋金色礦石結晶；setMineAmount 依剩下的量縮小
export function buildMineNode() {
  const g = new THREE.Group();
  const rock = mat(0x5a4c40, { roughness: 1, metalness: 0.05 }),
    rock2 = mat(0x6e5e4c, { roughness: 1, metalness: 0.05 }),
    ore = mat(0xe0b040, { emissive: 0x7a5410, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.7 });
  const k = new PK(false);
  const ROCKS = [
    [0, 1.3, 0, 2.2, 2.6, 0.2],
    [2.1, 0.8, 1, 1.5, 1.6, 0.9],
    [-1.9, 0.9, 1.2, 1.6, 1.8, 2.1],
    [-0.8, 0.7, -2.2, 1.4, 1.4, 1.3],
    [1.6, 0.6, -1.8, 1.2, 1.2, 0.4],
    [0.3, 0.45, 2.6, 1, 0.9, 2.7],
  ];
  const dode = new THREE.DodecahedronGeometry(1, 0);
  ROCKS.forEach(([x, y, z, s, sy, r], i) =>
    k.geo(i % 2 ? rock : rock2, dode, x, y, z, 0.3 * i, r, 0.2, s, sy, s),
  );
  const oct = new THREE.OctahedronGeometry(1, 0);
  const CR = [
    [0.4, 2.9, 0.5, 0.45, 1.2, 0.2],
    [-0.6, 2.6, -0.3, 0.38, 1.0, -0.3],
    [1.9, 1.8, 0.9, 0.35, 0.8, 0.5],
    [-2.0, 2.0, 1.3, 0.4, 0.9, -0.4],
    [0.9, 1.4, -2.1, 0.33, 0.8, 0.3],
    [-1.1, 1.3, -2.3, 0.3, 0.7, -0.6],
    [0.2, 1.2, 2.9, 0.32, 0.7, 0.4],
  ];
  for (const [x, y, z, s, sy, rz] of CR) k.geo(ore, oct, x, y, z, 0, rz * 2, rz, s, sy, s);
  const pile = k.build(new THREE.Group());
  pile.scale.setScalar(1.25);
  g.add(pile);
  g.userData.pile = pile;
  return g;
}
export function setMineAmount(g, frac) {
  const p = g.userData.pile;
  if (!p) return;
  const s = 1.25 * (frac <= 0 ? 0.35 : 0.55 + 0.45 * Math.max(0, Math.min(1, frac)));
  p.scale.set(s, s, s);
}
// Coral 湧出點：地面的裂口＋發光的結晶（材質共用，主迴圈可以改亮度做脈動）
let CORAL_MAT = null;
export function CORAL_GLOW() {
  return (
    CORAL_MAT ||
    (CORAL_MAT = new THREE.MeshStandardMaterial({
      color: 0xff3d5a,
      emissive: 0xff2244,
      emissiveIntensity: 1.6,
      roughness: 0.3,
      metalness: 0.1,
      flatShading: true,
    }))
  );
}
export function buildCoralVent() {
  const g = new THREE.Group();
  const k = new PK(false);
  const rock = mat(0x3a3330, { roughness: 1, metalness: 0.05 });
  const tor = new THREE.TorusGeometry(3.4, 0.8, 5, 10);
  k.geo(rock, tor, 0, 0.2, 0, Math.PI / 2, 0, 0, 1, 1, 0.55);
  k.cyl(mat(0x1a1214, { roughness: 1 }), 3.2, 3.2, 0.1, 0, 0.12, 0, 0, 0, 0, 12);
  const oct = new THREE.OctahedronGeometry(1, 0);
  const CR = [
    [0, 1.6, 0, 0.6, 2.2, 0],
    [1.2, 1.0, 0.6, 0.45, 1.4, 0.5],
    [-1.1, 1.1, 0.8, 0.5, 1.6, -0.4],
    [0.5, 0.8, -1.4, 0.4, 1.2, 0.3],
    [-0.8, 0.7, -1.0, 0.35, 1.0, -0.6],
    [1.8, 0.5, -0.6, 0.3, 0.8, 0.8],
    [-1.9, 0.5, -0.2, 0.3, 0.7, -0.9],
  ];
  for (const [x, y, z, s, sy, r] of CR) k.geo(CORAL_GLOW(), oct, x, y, z, r * 0.4, r, r * 0.3, s, sy, s);
  k.build(g);
  return g;
}

// ---------- 工人（作業 MT） ----------
// 程式模型的機甲（data/rts-units.js 的 asm：履帶＋輕量上身）加上工程套件：背上的小吊臂、右手的鑽頭、
// 頭頂的旋轉警示燈、背後的貨箱（攜帶礦石時顯示，rig.rtsCrate）。掛在 torso 上（網格合併之後再加，各自可以開關）
export function addWorkerKit(rig, pal, faction) {
  if (faction === 'aetheric') return addAethWorkerKit(rig, pal, buildOreCrate); // 研究作業機的採樣套件（R3）
  if (faction === 'veerwell') return addVeerWorkerKit(rig, pal, buildOreCrate); // 物流 MT 的貨架與吊鉤（R4）
  if (faction === 'sancta') return addSancWorkerKit(rig, pal, buildOreCrate); // 互助作業機的拾荒網籃與磁吸臂（R5）
  const t = mechKit(rig, rig.torso || rig.group);
  const kit = new THREE.Group();
  const k = new PK(false);
  const y = mat(0xd8a020, { roughness: 0.6, metalness: 0.25 }),
    st = DETAIL.steel,
    dk = DETAIL.dark;
  // 背上的吊臂
  k.box(dk, 0.5, 0.4, 0.5, 0, 1.6, 0.55);
  k.bar(y, [0, 1.8, 0.55], [0, 3.0, 1.4], 0.22);
  k.bar(y, [0, 3.0, 1.4], [0, 2.6, 2.4], 0.18);
  k.box(st, 0.06, 0.8, 0.06, 0, 2.2, 2.4);
  k.box(dk, 0.3, 0.2, 0.3, 0, 1.75, 2.4);
  hazard(k, y, DETAIL.black, 0.9, 0.18, 0, 1.25, 0.82);
  k.build(kit);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8), glowMat(0xffa020, 2));
  beacon.position.set(0, 2.05, 0.2);
  kit.add(beacon);
  t.add(kit);
  // 貨箱（攜帶礦石時顯示）
  const crate = buildOreCrate();
  crate.position.set(0, 0.9, 1.0);
  crate.scale.setScalar(0.85);
  crate.visible = false;
  t.add(crate);
  // 右手的鑽頭
  const hand = mechKit(rig, rig.arms && rig.arms.r && rig.arms.r.hand);
  if (hand) {
    const dr = new PK(false);
    dr.cyl(st, 0.02, 0.22, 0.8, 0, -0.55, 0, 0, 0, 0, 8);
    dr.cyl(y, 0.25, 0.25, 0.25, 0, -0.1, 0, 0, 0, 0, 8);
    const drill = dr.build(new THREE.Group());
    hand.add(drill);
    rig.rtsDrill = drill;
  }
  rig.rtsKit = kit;
  rig.rtsBeacon = beacon;
  rig.rtsCrate = crate;
  return rig;
}
// 模型庫用：組好的作業 MT
export function buildRtsWorker(pal) {
  const rig = buildMech(RTS_DEFS.c_worker.asm, pal, 1);
  return addWorkerKit(rig, pal);
}
// 攜帶礦石的小貨箱（約 1 × 0.6 × 0.8 m，原點在底面中心）
export function buildOreCrate() {
  const k = new PK(false);
  const fr = mat(0x4a4438, { roughness: 0.8, metalness: 0.5 }),
    ore = mat(0xe0b040, { emissive: 0x7a5410, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.7 });
  k.cb(fr, 1, 0.5, 0.8, 0, 0.25, 0, 0, 0, 0, 0.05);
  const oct = new THREE.OctahedronGeometry(1, 0);
  k.geo(ore, oct, -0.2, 0.55, 0, 0, 0.4, 0.2, 0.25, 0.22, 0.25);
  k.geo(ore, oct, 0.2, 0.55, 0.1, 0, 1, -0.2, 0.22, 0.2, 0.22);
  k.geo(ore, oct, 0.05, 0.6, -0.15, 0, 2, 0.3, 0.2, 0.25, 0.2);
  return k.build(new THREE.Group());
}

// ---------- 模型庫目錄 ----------
// [分類, key, 名稱, 備註, build]（槽位 id＝`${分類}/rts_${key}`；目前只預覽、不接受 GLB）
const P0 = () => rtsPal('castron', 0);
const bldNote = (id) => {
  const D = RTS_DEFS[id];
  return `Coral 戰爭；佔地 ${D.foot[0]} × ${D.foot[1]} m、高約 ${D.height} m，原點在底面中心、正面 +Z；陣營色隨隊伍`;
};
const withProgress = (id, p) => {
  const r = buildRtsBuilding(id, P0());
  r.setProgress(p);
  return r.group;
};
export const RTS_CATALOG = [
  ['prop', 'c_hq', '卡斯特隆：主堡', bldNote('c_hq'), () => buildRtsBuilding('c_hq', P0()).group],
  ['prop', 'c_depot', '卡斯特隆：補給庫', bldNote('c_depot'), () => buildRtsBuilding('c_depot', P0()).group],
  [
    'prop',
    'c_factory',
    '卡斯特隆：兵工廠',
    bldNote('c_factory'),
    () => buildRtsBuilding('c_factory', P0()).group,
  ],
  [
    'prop',
    'c_extractor',
    '卡斯特隆：Coral 抽取站',
    bldNote('c_extractor') + '；蓋在 Coral 湧出點上',
    () => buildRtsBuilding('c_extractor', P0()).group,
  ],
  [
    'prop',
    'build_site',
    '建造中的建築（兵工廠 40%）',
    'Coral 戰爭；鷹架＋依進度長高的本體',
    () => withProgress('c_factory', 0.4),
  ],
  ['prop', 'mine', '礦脈', 'Coral 戰爭；半徑約 4 m，依剩下的量縮小', () => buildMineNode()],
  [
    'prop',
    'coral_vent',
    'Coral 湧出點',
    'Coral 戰爭；半徑約 4 m，發光的結晶（抽取站蓋在上面）',
    () => buildCoralVent(),
  ],
  [
    'vehicle',
    'c_worker',
    '卡斯特隆：作業 MT',
    'Coral 戰爭的工人；履帶機甲＋吊臂、鑽頭、警示燈',
    () => buildRtsWorker(P0()).group,
  ],
  ['small', 'ore_crate', '礦石貨箱', 'Coral 戰爭；工人攜帶礦石時背在背後', () => buildOreCrate()],
  ...[
    ['c_hq2', '卡斯特隆：要塞主堡（主堡 T2）', '；主堡升級：外牆與砲座'],
    ['c_hq3', '卡斯特隆：重工司令部（主堡 T3）', '；主堡升級：司令塔、雷達與天線'],
    ['c_works', '卡斯特隆：工程研究所', ''],
    ['c_tower', '卡斯特隆：起重機砲台', '；吊臂朝目標旋轉，從吊鉤拋出貨櫃'],
    ['c_wall', '卡斯特隆：城牆', ''],
    ['c_market', '卡斯特隆：補給商店', ''],
    ['c_heavy', '卡斯特隆：重工廠', ''],
    ['c_flak', '卡斯特隆：防空砲塔', '；砲塔與四管機砲朝空中目標轉動'],
    ['c_helipad', '卡斯特隆：停機坪', ''],
  ].map(([id, name, extra]) => [
    'prop',
    id,
    name,
    bldNote(id) + extra,
    () => buildRtsBuilding(id, P0()).group,
  ]),
  [
    'prop',
    'cover_crates',
    '卡斯特隆：貨櫃掩體',
    'Coral 戰爭；叉架 MT 的技能放下的臨時牆（8 × 2.6 m、高 3 m），原點在底面中心',
    () => buildCoverCrates(),
  ],
  [
    'small',
    'arty_legs',
    '卡斯特隆：自走砲的駐鋤',
    'Coral 戰爭；自走砲架設時放下（掛在車體上）',
    () => buildArtyLegs(P0()),
  ],
];
