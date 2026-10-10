// 模型目錄：遊戲中每個 3D 模型的「模型槽」。模型庫用它逐一顯示，之後換成 GLB 時也以槽位 id 對應檔案：
//   src/assets/models/<槽位 id>.glb（例如 head/h_std.glb、arms/a_std/r_fore.glb、weapon/w_rifle/l.glb）
// 機甲拆成可以單獨替換的「區塊」（mech-model.js 的 partPieces）：手臂左右各 上臂／前臂／手，腳分襠部與左右
// 大腿／小腿／腳掌，武器分左右。完整機甲只用來預覽區塊組合的結果，不接受整台的 GLB。
// build(palKey) 一律回傳原始比例的模型與遊戲中的縮放：
//   { obj 加進場景的根物件（單位矩陣）, scaleNode 承載遊戲縮放的節點, scale 遊戲縮放（Vector3）, rig 可給 animateMech 驅動的機體,
//     piece 區塊資訊（機甲區塊才有） }
import { withRng } from '../core/math.js';
import { AC_ROSTER, BOSS_DEFS, DUO_BOSS, ENEMY_TYPES, PART_DEFS } from '../data/enemies.js';
import { buildBossModel } from './boss-models.js';
import { FOE_CATALOG } from './foe-models.js';
import { PARTS, START_ASM } from '../data/parts.js';
import { PALETTES } from './materials.js';
import { PIECE_NAMES, SIDE_NAMES, buildMech, buildPiece, partPieces } from './mech-model.js';
import { THEMES } from '../world/world.js';
import { LANDMARKS } from '../world/landmarks.js';
import { VARIANT_CATALOG } from '../world/variants.js';
import {
  box,
  buildContainer,
  buildCorridorSegment,
  buildDebris,
  buildDeck,
  buildGridPillar,
  buildLampPost,
  buildParkedTruck,
  buildPillar,
  buildRock,
  buildTunnelPortal,
  buildDerrick,
  buildMiningRig,
  buildPipeSegment,
  buildPipeSupport,
  buildWreckArch,
  buildWreckHull,
  buildFloodlight,
  buildMtWreck,
  buildOreHopper,
  buildRockSpire,
  buildSandFence,
  buildSandstone,
  buildScrap,
  buildStorageTank,
  buildBeacon,
  buildIceChunk,
  buildIceShard,
  buildObsDome,
  buildQuonset,
  buildRadarDish,
  buildThemeDeck,
  buildThemePillar,
  buildThemePlatform,
  buildThemeRamp,
  buildThemeTunnel,
  buildThemeWall,
  deckMats,
  featureStyles,
  mat,
} from '../world/prop-models.js';
import { PICKUP_DEFS } from '../world/map-extras.js';
import { buildBomberMesh, buildPickupMesh, buildProjectileMesh, buildTransport } from './extra-models.js';
import {
  VEHICLE_PIECES,
  VEHICLE_PIECE_NAMES,
  VEHICLE_PIECE_ORIGIN,
  buildDrone,
  buildHeli,
  buildVehicle,
} from './vehicle-models.js';

export const CATEGORIES = [
  { id: 'head', name: '頭部' },
  { id: 'core', name: '核心' },
  { id: 'arms', name: '手臂' },
  { id: 'legs', name: '腳部' },
  { id: 'booster', name: '推進器（背包）' },
  { id: 'weapon', name: '手持武器' },
  { id: 'back', name: '背部武器' },
  { id: 'mech', name: '完整機甲' },
  { id: 'vehicle', name: '非機甲／載具' },
  { id: 'prop', name: '地圖物件' },
  { id: 'small', name: '小物件' },
];

const v3 = (s) => (s && s.isVector3 ? s.clone() : new THREE.Vector3(s, s, s));
const pal = (key) => PALETTES[key] || PALETTES.player;
// 整台機體：scale 放在 group 上
function wholeRig(rig, scale) {
  rig.group.scale.copy(v3(scale));
  return { obj: rig.group, scaleNode: rig.group, scale: v3(scale), rig };
}

const entries = [];
const add = (e) => entries.push({ pal: 'player', scaleNote: '', ...e });

// ---------- 機甲區塊（依零件編號逐一列出，每個零件再拆成區塊）----------
// 規格類別：頭／核心／背包／襠部與主體為 part，四肢的每一節為 piece，武器為 weapon
const SPEC = { head: 'part', core: 'part', booster: 'part', pelvis: 'part', body: 'part' };
function pieceName(p, info) {
  if (info.cat === 'weapon' || info.cat === 'back') return `${p.name}（${SIDE_NAMES[info.key]}）`;
  if (!info.key && (info.kind === info.cat || info.cat !== 'legs')) return p.name;
  return `${p.name}・${info.key ? SIDE_NAMES[info.key] : ''}${PIECE_NAMES[info.kind]}`;
}
const PART_LISTS = [
  ['head', PARTS.head],
  ['core', PARTS.core],
  ['arms', PARTS.arms],
  ['legs', PARTS.legs],
  ['booster', PARTS.booster],
  ['weapon', PARTS.arm],
  ['back', PARTS.back],
];
for (const [cat, list] of PART_LISTS)
  for (const p of list)
    for (const info of partPieces(cat, p))
      add({
        id: info.slot,
        cat,
        part: p.id,
        piece: info,
        name: pieceName(p, info),
        note: info.kind === 'booster' ? '噴焰是粒子特效' : '',
        spec: cat === 'weapon' || cat === 'back' ? 'weapon' : SPEC[info.kind] || 'piece',
        build: (k) => {
          const wrap = new THREE.Group();
          wrap.add(buildPiece(info, pal(k)));
          return { obj: wrap, scaleNode: wrap, scale: v3(1), rig: null, piece: info };
        },
      });

// ---------- 完整機甲 ----------
const addMech = (key, name, asm, palKey, scale, note = '', boss = false) =>
  add({
    id: `mech/${key}`,
    cat: 'mech',
    name,
    note,
    pal: palKey,
    asm,
    gameScale: scale,
    spec: boss ? 'mech-boss' : 'mech',
    noGlb: true,
    build: (k) => wholeRig(buildMech(asm, pal(k), 1), scale),
  });
addMech('player', 'RAVEN（玩家初始機）', START_ASM, 'player', 1);
for (const [key, r] of Object.entries(AC_ROSTER)) {
  const t = ENEMY_TYPES['ac_' + key];
  addMech('ac_' + key, r.name, r.asm, r.pal, t ? t.scale : 1, '具名 AC');
}
const duo = BOSS_DEFS.find((b) => b.kind === 'duo');
for (const D of DUO_BOSS)
  addMech(
    'boss_' + D.name.toLowerCase(),
    D.name,
    D.asm,
    D.pal,
    duo ? duo.scale : 1,
    'Boss（雙 AC 小隊）',
    true,
  );
BOSS_DEFS.forEach((b) => {
  if (b.kind && !b.mech) return; // 雙 AC 另外列；直升機與程式模型的 Boss 在「非機甲／載具」
  const key = b.name.split(' ')[0].toLowerCase();
  addMech('boss_' + key, b.name, b.asm, b.pal || 'boss', b.scale, 'Boss', true);
});
// 量產敵機：組裝由 gen() 產生（可能含隨機），以固定種子取得代表性的一台
Object.entries(ENEMY_TYPES).forEach(([key, d], i) => {
  if (d.roster || d.modelKind || !d.gen) return;
  const asm = withRng(1000 + i, () => d.gen());
  addMech('enemy_' + key, d.name, asm, d.pal, d.scale, '量產敵機');
});

// ---------- 非機甲敵人／載具 ----------
// 會動的部位拆成區塊（vehicle-models.js）：完整載具只預覽區塊組合的結果（parts），GLB 放到各區塊的格子
// 區塊的程式模型：從整台拆出那個節點，原點移到它的旋轉中心
function vehiclePiece(rig, pc) {
  const node = pc === 'hull' ? rig.legsG : pc === 'rotor' ? rig.rotor : pc === 'tail' ? rig.tail : rig.torso;
  if (node === rig.torso) for (const c of [rig.rotor, rig.tail]) if (c) node.remove(c);
  node.parent.remove(node);
  node.position.set(0, 0, 0);
  node.rotation.set(0, 0, 0);
  node.scale.set(1, 1, 1);
  const wrap = new THREE.Group();
  wrap.add(node);
  return { obj: wrap, scaleNode: wrap, scale: v3(1), rig: null };
}
const addVeh = (key, name, fn, palKey, scale, note, spec, kind) => {
  const parts = VEHICLE_PIECES[kind].map((pc) => `vehicle/${key}/${pc}`);
  add({
    id: `vehicle/${key}`,
    cat: 'vehicle',
    name,
    note: note + '（由區塊組成）',
    pal: palKey,
    gameScale: scale,
    spec,
    noGlb: true,
    parts,
    build: (k) => wholeRig(fn(pal(k), 1, key), scale),
  });
  for (const pc of VEHICLE_PIECES[kind])
    add({
      id: `vehicle/${key}/${pc}`,
      cat: 'vehicle',
      name: `${name}・${VEHICLE_PIECE_NAMES[pc]}`,
      note: pc === 'turret' || pc === 'rotor' || pc === 'tail' ? '會旋轉的區塊' : '',
      pal: palKey,
      gameScale: scale,
      spec,
      origin: VEHICLE_PIECE_ORIGIN[pc],
      build: (k) => {
        const b = vehiclePiece(fn(pal(k), 1, key), pc);
        b.obj.scale.copy(v3(scale));
        return { ...b, scale: v3(scale) };
      },
    });
};
addVeh(
  'tank',
  ENEMY_TYPES.tank.name,
  buildVehicle,
  ENEMY_TYPES.tank.pal,
  ENEMY_TYPES.tank.scale,
  '敵人',
  'vehicle',
  'tank',
);
addVeh(
  'heli',
  ENEMY_TYPES.heli.name,
  buildHeli,
  ENEMY_TYPES.heli.pal,
  ENEMY_TYPES.heli.scale,
  '敵人',
  'vehicle',
  'heli',
);
addVeh(
  'dropship',
  ENEMY_TYPES.dropship.name,
  buildHeli,
  ENEMY_TYPES.dropship.pal,
  ENEMY_TYPES.dropship.scale,
  '敵人',
  'vehicle',
  'heli',
);
{
  const h = BOSS_DEFS.find((b) => b.kind === 'heli');
  if (h) addVeh('boss_helios', h.name, buildHeli, 'helios', h.scale, 'Boss', 'vehicle-boss', 'heli');
}
// 無人機只有一塊（尾焰是程式特效）：原點在機身中心
for (const key of ['swarm', 'minelayer', 'repair']) {
  const d = ENEMY_TYPES[key];
  add({
    id: `vehicle/${key}`,
    cat: 'vehicle',
    name: d.name,
    note: '敵人；尾焰是程式特效',
    pal: d.pal,
    gameScale: d.scale,
    spec: 'vehicle',
    origin: VEHICLE_PIECE_ORIGIN.drone,
    build: (k) => {
      const b = vehiclePiece(buildDrone(pal(k), 1, key), 'body');
      const sc = v3(d.scale);
      b.obj.scale.copy(sc);
      return { ...b, scale: sc };
    },
  });
}

// 新 Boss 的程式模型與附屬部位（render/boss-models.js）：目前只預覽，不接受 GLB
for (const b of BOSS_DEFS) {
  if (b.modelKind !== 'boss') continue;
  add({
    id: `vehicle/boss_${b.vehKey}`,
    cat: 'vehicle',
    name: b.name,
    note: b.vehKey === 'worm' ? 'Boss；身體各節在遊戲中跟著頭部的軌跡排列' : 'Boss',
    pal: b.pal || 'boss',
    gameScale: b.scale,
    spec: 'vehicle-boss',
    noGlb: true,
    build: (k) => wholeRig(buildBossModel(b.vehKey, pal(k), 1), b.scale),
  });
}
for (const [key, d] of Object.entries(PART_DEFS))
  add({
    id: `vehicle/bosspart_${key}`,
    cat: 'vehicle',
    name: `Boss 部位・${d.name}`,
    note: '附屬部位（獨立血量）',
    pal: 'boss',
    gameScale: 1,
    spec: 'vehicle-boss',
    noGlb: true,
    build: (k) => wholeRig(buildBossModel(key, pal(k), 1), 1),
  });

// 主題專屬敵人的程式模型（render/foe-models.js）：目前只預覽，不接受 GLB
for (const [key, name, note] of FOE_CATALOG)
  add({
    id: `vehicle/foe_${key}`,
    cat: 'vehicle',
    name,
    note,
    pal: 'enemy',
    gameScale: 1,
    spec: 'vehicle-boss',
    noGlb: true,
    build: (k) => wholeRig(buildBossModel(key, pal(k), 1), 1),
  });

// 其他載具（不屬於敵人、沒有配色）
const plain = (obj) => {
  const wrap = new THREE.Group();
  wrap.add(obj);
  return { obj: wrap, scaleNode: wrap, scale: v3(1), rig: null };
};
const addPlain = (cat, key, name, note, build, extra = {}) =>
  add({
    id: `${cat}/${key}`,
    cat,
    name,
    note,
    noPal: true,
    spec: cat,
    build: () => plain(build()),
    ...extra,
  });
addPlain('vehicle', 'transport_truck', '運輸貨車', '沿公路行駛的可破壞車輛', () =>
  buildTransport('truck', 1, 8),
);
addPlain(
  'vehicle',
  'transport_train',
  '運輸列車',
  '機車頭＋3 節車廂（遊戲中 3–5 節；由區塊組成）',
  () => buildTransport('train', 4, 7.5),
  { noGlb: true, parts: ['vehicle/transport_train/loco', 'vehicle/transport_train/car'] },
);
addPlain('vehicle', 'transport_train/loco', '運輸列車・機車頭', '地面中心為這一節的底面中心', () =>
  buildTransport('train', 1, 7.5),
);
addPlain('vehicle', 'transport_train/car', '運輸列車・車廂', '遊戲中依節數重複', () =>
  buildTransport('train', 2, 7.5, 1),
);
addPlain('vehicle', 'bomber', '空襲轟炸機', '消耗品 AIRSTRIKE', () => buildBomberMesh(), {
  origin: '機身中心（機頭朝正面）',
});

// ---------- 地圖物件（遊戲中尺寸為隨機，這裡取代表值，備註列出範圍）----------
// GLB 以這裡的代表尺寸製作，遊戲依每個物件的隨機尺寸分別縮放長寬高（prop-models.js 的 propGlb）；
// 由其他物件拼成或沿路線產生的（疊放貨櫃、掩體、高台、公路、鐵路）只預覽，不接受 GLB
const PROP_SCALED = '；GLB 依隨機尺寸縮放長寬高';
const COMPOSED = { noGlb: true, parts: [] };
const T = THEMES.industrial;
const clear = (m) => {
  const c = m.clone();
  c.transparent = true;
  return c;
};
const containerOf = (stack) => () => {
  const frame = mat(0x2a2d31);
  const g = buildContainer(7.5, 2.8, 2.9, false, clear(mat(T.container2)), clear(frame));
  if (!stack) return g;
  const top = buildContainer(7.5, 2.8, 2.9, false, clear(mat(T.container)), clear(frame));
  top.position.y = 2.8;
  const both = new THREE.Group();
  both.add(g, top);
  return both;
};
addPlain(
  'prop',
  'container',
  '貨櫃',
  '長 6–9、寬 2.6–3.2、高 2.6–3.0 m' + PROP_SCALED + '；main 材質為貨櫃顏色',
  containerOf(false),
);
addPlain(
  'prop',
  'container_stack',
  '疊放貨櫃',
  '約 25% 的貨櫃會疊第二層（使用貨櫃的 GLB）',
  containerOf(true),
  {
    noGlb: true,
    parts: ['prop/container'],
  },
);
addPlain(
  'prop',
  'rock',
  '岩石',
  '半徑 1.8–4.2 m，各軸隨機縮放與旋轉' + PROP_SCALED,
  () => {
    const r = buildRock(3, mat(T.rock, { roughness: 1 }));
    r.scale.set(1.15, 0.75, 1.15);
    return r;
  },
  { origin: '物件中心（岩石中心）' },
);
addPlain('prop', 'lamp_post', '柱子／路燈桿', '高 5–9 m' + PROP_SCALED, () => {
  const m = buildLampPost(7, mat(0x33373c));
  m.position.y = 3.5;
  return m;
});
addPlain('prop', 'debris', '散落碎塊', '純裝飾，0.3–1.2 m' + PROP_SCALED, () => {
  const m = buildDebris(0.75, 0.35, 0.75, mat(0x55595e));
  m.position.y = 0.175;
  return m;
});
addPlain('prop', 'parked_truck', '停放卡車', '可破壞', () => buildParkedTruck(clear(mat(0xd8d8d8))));
addPlain(
  'prop',
  'grid_pillar',
  '方格高柱',
  '方格主題，寬 3–7、高 2.5–18 m' + PROP_SCALED,
  () => buildGridPillar(5, 13, 5, mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 })).mesh,
);
addPlain(
  'prop',
  'deck',
  '橋面板',
  '橋梁／高架橋／掩體頂共用；護欄沿 X' + PROP_SCALED,
  () => buildDeck(8, 20, 0.7, false, deckMats()).group,
  { origin: '橋面板頂面中心' },
);
addPlain('prop', 'pillar', '支柱', '橋梁、高架橋、掩體下方' + PROP_SCALED, () =>
  buildPillar(0.6, 6, deckMats().pillar),
);
addPlain(
  'prop',
  'bunker',
  '掩體',
  '頂板＋四支柱＋一面牆；寬 9–14、高 5–6.5 m（頂板與支柱使用橋面板、支柱的 GLB）',
  () => {
    const M = deckMats();
    const w = 11,
      d = 11,
      h = 5.8;
    const g = new THREE.Group();
    const top = buildDeck(w, d, 0.8, false, M).group;
    top.position.y = h;
    g.add(top);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = buildPillar(0.5, h - 0.3, M.pillar);
        p.position.set(sx * (w / 2 - 1), -0.5 + (h - 0.3) / 2, sz * (d / 2 - 1));
        g.add(p);
      }
    g.add(box(w - 2, h - 0.8, 0.8, clear(M.pillar), 0, (h - 0.8) / 2, d / 2 - 0.4));
    return g;
  },
  { noGlb: true, parts: ['prop/deck', 'prop/pillar'] },
);
addPlain(
  'prop',
  'platform',
  '高台＋坡道',
  '寬 10–18、高 4–7 m（程式模型）',
  () => {
    const pm = mat(0x7a7f88, { roughness: 0.8 });
    const w = 14,
      d = 14,
      h = 5.5,
      rl = h * 2.2;
    const g = new THREE.Group();
    g.add(box(w, h, d, clear(pm), 0, h / 2 - 0.5, 0));
    const ramp = box(rl, 0.4, 6, pm, w / 2 + rl / 2, h / 2 - 0.7, 0);
    ramp.rotation.z = -Math.atan2(h - 0.5, rl);
    g.add(ramp);
    return g;
  },
  COMPOSED,
);
addPlain(
  'prop',
  'mining_rig',
  '斗輪採掘機殘骸',
  '荒涼工業荒野；長約 34 m，斗輪臂朝 −Z；main 材質為機身顏色',
  () => buildMiningRig(0xc8a040),
);
addPlain(
  'prop',
  'pipeline',
  '輸送管線（一段）',
  '荒涼工業荒野；長 9 m、沿 Z，遊戲中重複排成約 100 m 的高架管線',
  () => buildPipeSegment(0xb89a5a),
  { origin: '管子中心' },
);
addPlain('prop', 'pipe_support', '管線支架', '高架管線下方，高度依地形' + PROP_SCALED, () =>
  buildPipeSupport(6, 0x5a4a3a),
);
addPlain('prop', 'derrick', '鑽井架', '荒涼工業荒野；高 14–20 m，可破壞' + PROP_SCALED, () =>
  buildDerrick(18, 0x9a6a3a),
);
addPlain('prop', 'wreck_hull', '艦體殘骸', '沙丘地帶；長約 24 m，艦首朝 −Z，遊戲中埋入地面 2.4 m', () =>
  buildWreckHull(0x7d7466),
);
addPlain('prop', 'wreck_arch', '拱形殘骸', '沙丘地帶；跨距 18 m，沿 X', () => buildWreckArch(0x6f675c));
addPlain(
  'prop',
  'ore_hopper',
  '礦石料斗',
  '荒涼工業荒野的掩體；5 × 6.2 × 5 m，可破壞；main 材質為機身顏色',
  () => buildOreHopper(0xb08a3e),
);
addPlain(
  'prop',
  'storage_tank',
  '鏽蝕儲槽',
  '荒涼工業荒野；半徑 2.2–3.4、高 4.5–7.5 m，可破壞' + PROP_SCALED,
  () => buildStorageTank(3, 6, 0x8a5a3a),
);
addPlain(
  'prop',
  'rock_spire',
  '岩柱',
  '荒涼工業荒野的岩石；半徑 1.6–2.8、高 5–10 m，可破壞' + PROP_SCALED,
  () => buildRockSpire(2, 7, 0x4e3e33),
);
addPlain('prop', 'floodlight', '照明塔', '荒涼工業荒野；高 8–11 m，可破壞' + PROP_SCALED, () =>
  buildFloodlight(9, 0x4a4540),
);
addPlain('prop', 'scrap', '廢鐵板', '荒涼工業荒野與沙丘地帶的裝飾，0.8–2 m' + PROP_SCALED, () =>
  buildScrap(1.5, 0.8, 1.2, 0x5a4a3e),
);
addPlain('prop', 'mt_wreck', 'MT 殘骸', '沙丘地帶的掩體；約 4 × 3 × 4 m，遊戲中埋入 0.6 m，可破壞', () =>
  buildMtWreck(0x6a6f66),
);
addPlain(
  'prop',
  'sandstone',
  '風蝕砂岩',
  '沙丘地帶的岩石；半徑 2.2–3.6、高 5–8 m，可破壞' + PROP_SCALED,
  () => buildSandstone(3, 7, 0x7a5a3c),
);
addPlain('prop', 'sand_fence', '防風牆', '沙丘地帶的掩體；長 8–16、高 3 m，沿 X，可破壞' + PROP_SCALED, () =>
  buildSandFence(8, 0x9a8a72),
);
addPlain(
  'prop',
  'quonset',
  '半圓拱屋',
  '冰原的掩體；6 × 3.4 × 9 m，長沿 Z，可破壞；main 材質為外殼顏色',
  () => buildQuonset(0x8a949e),
);
addPlain('prop', 'ice_chunk', '冰塊', '冰原的岩石；半徑 1.6–3 m，可破壞' + PROP_SCALED, () =>
  buildIceChunk(2.5),
);
addPlain('prop', 'beacon', '信號燈桿', '冰原；高 7–9.5 m，可破壞' + PROP_SCALED, () => buildBeacon(8));
addPlain('prop', 'radar_dish', '雷達天線', '冰原；高約 7 m，可破壞', () => buildRadarDish(0xd8dde2));
addPlain('prop', 'obs_dome', '舊時代觀測圓頂', '冰原的大型建築；基座半徑 9 m，不可破壞', () =>
  buildObsDome(0xc8d0d8),
);
addPlain('prop', 'ice_shard', '碎冰', '冰原的裝飾，0.6–1.6 m' + PROP_SCALED, () =>
  buildIceShard(1.2, 0.4, 1),
);
// 主題版的地形特徵（荒野／沙丘／冰原的橋面板、支柱、掩體牆、高台、坡道、隧道口；尺寸與原點同程式模型）
// 主題模組（world/themes/*.js）登記的物件：theme.catalog＝[[key, 名稱, 備註, build, extra?]]
for (const T of Object.values(THEMES))
  for (const [key, name, note, build, extra] of T.catalog || [])
    addPlain('prop', key, name, note, build, extra);
// 主題變體的物件與主線的入口結構（world/variants.js）、地標（world/landmarks.js）
for (const [key, name, note, build] of VARIANT_CATALOG) addPlain('prop', key, name, note, build);
for (const th in LANDMARKS)
  for (const key in LANDMARKS[th]) {
    const L = LANDMARKS[th][key];
    addPlain(
      'prop',
      `lm_${th}_${key}`,
      `地標：${L.name}`,
      `${THEMES[th].name}；主線區段的大型地標，不可破壞`,
      L.build,
    );
  }
const STYLE_LABEL = Object.fromEntries(
  Object.values(THEMES)
    .filter((T) => T.props)
    .map((T) => [T.props, T.name]),
);
for (const [style, label] of featureStyles().map((st) => [st, STYLE_LABEL[st] || st])) {
  addPlain(
    'prop',
    style + '_deck',
    `橋面板（${label}）`,
    '橋梁／高架橋／掩體頂；護欄沿 X' + PROP_SCALED,
    () => buildThemeDeck(style, 8, 20, 0.7, false),
    { origin: '橋面板頂面中心' },
  );
  addPlain('prop', style + '_pillar', `支柱（${label}）`, '橋梁、高架橋、掩體下方' + PROP_SCALED, () => {
    const g = buildThemePillar(style, 0.6, 6);
    g.position.y = 3;
    return g;
  });
  addPlain(
    'prop',
    style + '_wall',
    `掩體牆（${label}）`,
    '掩體的一面牆；長 7–12、高 4–6 m，沿 X' + PROP_SCALED,
    () => {
      const g = buildThemeWall(style, 10, 5, 0.8);
      g.position.y = 2.5;
      return g;
    },
  );
  addPlain('prop', style + '_platform', `高台（${label}）`, '寬 10–18、高 4–7 m' + PROP_SCALED, () =>
    buildThemePlatform(style, 14, 5.5, 14),
  );
  addPlain('prop', style + '_ramp', `坡道（${label}）`, '高台的坡道；長沿 X' + PROP_SCALED, () => {
    const g = buildThemeRamp(style, 12, 6);
    g.position.y = 0.2;
    return g;
  });
  addPlain('prop', style + '_tunnel', `隧道口（${label}）`, '公路／鐵路兩端；開口朝 −Z', () =>
    buildThemeTunnel(style),
  );
}
addPlain('prop', 'tunnel_portal', '隧道口', '公路／鐵路兩端；開口朝 −Z；main 材質為主題的岩石色', () =>
  buildTunnelPortal(T.rock),
);
addPlain(
  'prop',
  'road',
  '穿越公路（一段）',
  '寬 10 m，遊戲中沿路線產生、貫穿整張地圖（程式模型）',
  () => buildCorridorSegment('road', 24),
  COMPOSED,
);
addPlain(
  'prop',
  'rail',
  '穿越鐵路（一段）',
  '寬 9 m，遊戲中沿路線產生、貫穿整張地圖（程式模型）',
  () => buildCorridorSegment('rail', 24),
  COMPOSED,
);

// ---------- 小物件：掉落物、彈體 ----------
const CENTER = '物件中心';
for (const [k, d] of Object.entries(PICKUP_DEFS))
  addPlain(
    'small',
    'pickup_' + k,
    '掉落物：' + d.name,
    '浮動旋轉的方塊；底下的光環是程式特效',
    () => buildPickupMesh(d.color, null, false),
    { origin: CENTER },
  );
const proj = (kind) => {
  const m = buildProjectileMesh(kind, 0xffd080, 95);
  if (kind === 'missile') m.rotation.x = -Math.PI / 2; // 彈頭朝 −Z
  return m;
};
const PROJ_NOTE = '；命名為 glow 的材質改成武器的彈色';
addPlain(
  'small',
  'proj_bullet',
  '子彈',
  '發光彈道（長度隨彈速 0.9–2.0 倍，GLB 以 0.9 倍製作）' + PROJ_NOTE,
  () => proj('bullet'),
  { measureFx: true, origin: '彈體中心' },
);
addPlain('small', 'proj_missile', '飛彈', '彈體（尾焰是程式特效）', () => proj('missile'), {
  origin: '彈體中心',
});
addPlain('small', 'proj_shell', '砲彈／榴彈', '發光彈體' + PROJ_NOTE, () => proj('shell'), {
  measureFx: true,
  origin: '彈體中心',
});

export const MODEL_CATALOG = entries;
