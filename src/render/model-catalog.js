// 模型目錄：遊戲中每個 3D 模型的「模型槽」。模型庫用它逐一顯示，之後換成 GLB 時也以槽位 id 對應檔案：
//   src/assets/models/<槽位 id>.glb（例如 head/h_std.glb、arms/a_std/r_fore.glb、weapon/w_rifle/l.glb）
// 機甲拆成可以單獨替換的「區塊」（mech-model.js 的 partPieces）：手臂左右各 上臂／前臂／手，腳分襠部與左右
// 大腿／小腿／腳掌，武器分左右。完整機甲只用來預覽區塊組合的結果，不接受整台的 GLB。
// build(palKey) 一律回傳原始比例的模型與遊戲中的縮放：
//   { obj 加進場景的根物件（單位矩陣）, scaleNode 承載遊戲縮放的節點, scale 遊戲縮放（Vector3）, rig 可給 animateMech 驅動的機體,
//     piece 區塊資訊（機甲區塊才有） }
import { withRng } from '../core/math.js';
import { AC_ROSTER, BOSS_DEFS, DUO_BOSS, ENEMY_TYPES } from '../data/enemies.js';
import { PARTS, START_ASM } from '../data/parts.js';
import { PALETTES } from './materials.js';
import { PIECE_NAMES, SIDE_NAMES, buildMech, buildPiece, partPieces } from './mech-model.js';
import { THEMES } from '../world/world.js';
import {
  box,
  buildContainer,
  buildCorridorSegment,
  buildDeck,
  buildGridPillar,
  buildLampPost,
  buildParkedTruck,
  buildPillar,
  buildRock,
  buildTunnelPortal,
  deckMats,
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
  if (b.kind) return;
  const key = b.name.split(' ')[0].toLowerCase();
  addMech('boss_' + key, b.name, b.asm, 'boss', b.scale, 'Boss', true);
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
{
  const h = BOSS_DEFS.find((b) => b.kind === 'heli');
  if (h) addVeh('boss_helios', h.name, buildHeli, 'helios', h.scale, 'Boss', 'vehicle-boss', 'heli');
}
// 無人機只有一塊（尾焰是程式特效）：原點在機身中心
add({
  id: 'vehicle/swarm',
  cat: 'vehicle',
  name: ENEMY_TYPES.swarm.name,
  note: '敵人；尾焰是程式特效',
  pal: ENEMY_TYPES.swarm.pal,
  gameScale: ENEMY_TYPES.swarm.scale,
  spec: 'vehicle',
  origin: VEHICLE_PIECE_ORIGIN.drone,
  build: (k) => {
    const b = vehiclePiece(buildDrone(pal(k), 1), 'body');
    const sc = v3(ENEMY_TYPES.swarm.scale);
    b.obj.scale.copy(sc);
    return { ...b, scale: sc };
  },
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
addPlain('vehicle', 'bomber', '空襲轟炸機', '消耗品 AIRSTRIKE', () => buildBomberMesh());

// ---------- 地圖物件（遊戲中尺寸為隨機，這裡取代表值，備註列出範圍）----------
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
addPlain('prop', 'container', '貨櫃', '長 6–9、寬 2.6–3.2、高 2.6–3.0 m', containerOf(false));
addPlain('prop', 'container_stack', '疊放貨櫃', '約 25% 的貨櫃會疊第二層', containerOf(true));
addPlain('prop', 'rock', '岩石', '半徑 1.8–4.2 m，各軸隨機縮放', () => {
  const r = buildRock(3, mat(T.rock, { roughness: 1 }));
  r.scale.set(1.15, 0.75, 1.15);
  return r;
});
addPlain('prop', 'lamp_post', '柱子／路燈桿', '高 5–9 m', () => buildLampPost(7, mat(0x33373c)));
addPlain('prop', 'debris', '散落碎塊', '純裝飾，0.3–1.2 m', () => box(0.75, 0.35, 0.75, mat(0x55595e)));
addPlain('prop', 'parked_truck', '停放卡車', '可破壞', () => buildParkedTruck(clear(mat(0xd8d8d8))));
addPlain(
  'prop',
  'grid_pillar',
  '方格高柱',
  '方格主題，寬 3–7、高 2.5–18 m',
  () => buildGridPillar(5, 13, 5, mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 })).mesh,
);
addPlain(
  'prop',
  'deck',
  '橋面板',
  '橋梁／高架橋／掩體頂共用',
  () => buildDeck(8, 20, 0.7, false, deckMats()).group,
);
addPlain('prop', 'pillar', '支柱', '橋梁與高架橋下方', () => buildPillar(0.6, 6, deckMats().pillar));
addPlain('prop', 'bunker', '掩體', '頂板＋四支柱＋一面牆；寬 9–14、高 5–6.5 m', () => {
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
});
addPlain('prop', 'platform', '高台＋坡道', '寬 10–18、高 4–7 m', () => {
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
});
addPlain('prop', 'tunnel_portal', '隧道口', '公路／鐵路兩端', () => buildTunnelPortal(T.rock));
addPlain('prop', 'road', '穿越公路（一段）', '寬 10 m，遊戲中貫穿整張地圖', () =>
  buildCorridorSegment('road', 24),
);
addPlain('prop', 'rail', '穿越鐵路（一段）', '寬 9 m，遊戲中貫穿整張地圖', () =>
  buildCorridorSegment('rail', 24),
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
