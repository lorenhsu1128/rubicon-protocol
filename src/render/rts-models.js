// Coral 戰爭（RTS）的模型：建築（卡斯特隆的重工業風格）、建造中的鷹架、礦脈、Coral 湧出點、工人（作業 MT）的工程套件、
// 攜帶礦石的小貨箱。全部是純函式（不呼叫亂數、不碰遊戲狀態），模型庫以 RTS_CATALOG 登記（render/model-catalog.js）。
// 建築的原點在底面中心、正面 +Z，尺寸符合 data/rts-units.js 的 foot／height；陣營色用 rtsPal（玩家藍、電腦紅）。
// 建築的 rig（給 MechEntity 的 opts.buildModel）：{ group, body（建好的本體，建造中依進度往上長）, scaf（鷹架）, torso,
//   height, vehicle: true, cls: 'bld', glow（陣營色的發光材質）, setProgress(p) }
import { PALETTES } from './materials.js';
import { buildMech } from './mech-model.js';
import { DETAIL, PK, hazard, ladder, mat, railing, truss } from '../world/prop-models.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';

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
const BODY = { c_hq: hqBody, c_depot: depotBody, c_factory: factoryBody, c_extractor: extractorBody };

// 鷹架：佔地四周的柱子與每 2.5 m 一圈橫桿（建造中顯示）
function scaffold(w, d, h, M) {
  const k = new PK();
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
  const D = RTS_DEFS[id];
  const M = mats(pal);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const k = new PK();
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
  return rig;
}

// ---------- 礦脈、Coral 湧出點 ----------
// 礦脈（半徑約 4 m）：岩塊堆＋金色礦石結晶；setMineAmount 依剩下的量縮小
export function buildMineNode() {
  const g = new THREE.Group();
  const rock = mat(0x5a4c40, { roughness: 1, metalness: 0.05 }),
    rock2 = mat(0x6e5e4c, { roughness: 1, metalness: 0.05 }),
    ore = mat(0xe0b040, { emissive: 0x7a5410, emissiveIntensity: 0.6, roughness: 0.35, metalness: 0.7 });
  const k = new PK();
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
  const k = new PK();
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
export function addWorkerKit(rig, pal) {
  const t = rig.torso || rig.group;
  const kit = new THREE.Group();
  const k = new PK();
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
  const hand = rig.arms && rig.arms.r && rig.arms.r.hand;
  if (hand) {
    const dr = new PK();
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
  const k = new PK();
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
];
