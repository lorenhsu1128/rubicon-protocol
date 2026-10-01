// 模型目錄：遊戲中每個 3D 模型的「模型槽」。模型庫用它逐一顯示，之後換成 GLB 時也以槽位 id 對應檔案：
//   src/assets/models/<槽位 id>.glb（例如 head/h_std.glb、weapon/w_rifle.glb、mech/ac_longshot.glb）
// build(palKey) 一律回傳原始比例的模型與遊戲中的縮放：
//   { obj 加進場景的根物件（單位矩陣）, scaleNode 承載遊戲縮放的節點, scale 遊戲縮放（Vector3）, rig 可給 animateMech 驅動的機體 }
import { withRng } from '../core/math.js';
import { AC_ROSTER, BOSS_DEFS, DUO_BOSS, ENEMY_TYPES } from '../data/enemies.js';
import { PARTS, START_ASM } from '../data/parts.js';
import { PALETTES } from './materials.js';
import { buildMech } from './mech-model.js';
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
import { buildDrone, buildHeli, buildVehicle } from './vehicle-models.js';

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
// 拆下子節點並歸零位置與旋轉（掛點旋轉是配合手部姿勢用的；模型本身一律正面朝 −Z、上方 +Y），保留縮放
function detach(node) {
  if (node.parent) node.parent.remove(node);
  node.position.set(0, 0, 0);
  node.rotation.set(0, 0, 0);
  return node;
}
const mechWith = (over, palKey) => buildMech({ ...START_ASM, ...over }, pal(palKey), 1);
const NO_WEAPONS = { rarm: 'w_none', larm: 'w_none', rback: 'bw_none', lback: 'bw_none' };
// 整台機體：scale 放在 group 上
function wholeRig(rig, scale) {
  rig.group.scale.copy(v3(scale));
  return { obj: rig.group, scaleNode: rig.group, scale: v3(scale), rig };
}
// 從機體上拆下的部件：以外層群組包住；keepScale 時保留掛點縮放（武器在遊戲中是縮小掛載的）
function partOf(node, keepScale) {
  const wrap = new THREE.Group();
  wrap.add(detach(node));
  if (!keepScale) node.scale.set(1, 1, 1);
  return { obj: wrap, scaleNode: node, scale: node.scale.clone(), rig: null };
}

const entries = [];
const add = (e) => entries.push({ pal: 'player', scaleNote: '', ...e });

// ---------- 機甲部件（依零件編號逐一列出）----------
for (const p of PARTS.head)
  add({
    id: `head/${p.id}`,
    cat: 'head',
    part: p.id,
    name: p.name,
    spec: 'part-head',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, head: p.id }, k).head),
  });
for (const p of PARTS.core)
  add({
    id: `core/${p.id}`,
    cat: 'core',
    part: p.id,
    name: p.name,
    spec: 'part-core',
    build: (k) => {
      const m = mechWith({ ...NO_WEAPONS, core: p.id }, k);
      for (const n of [m.head, m.arms.r.sh, m.arms.l.sh, m.arms.r.back, m.arms.l.back, m.nozzles[0].parent])
        m.torso.remove(n);
      return partOf(m.torso);
    },
  });
for (const p of PARTS.arms)
  add({
    id: `arms/${p.id}`,
    cat: 'arms',
    part: p.id,
    name: p.name,
    note: '右臂（左臂為鏡像）',
    spec: 'part-arm',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, arms: p.id }, k).arms.r.sh),
  });
for (const p of PARTS.legs)
  add({
    id: `legs/${p.id}`,
    cat: 'legs',
    part: p.id,
    name: p.name,
    spec: 'part-legs',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, legs: p.id }, k).legsG),
  });
for (const p of PARTS.booster)
  add({
    id: `booster/${p.id}`,
    cat: 'booster',
    part: p.id,
    name: p.name,
    spec: 'part-booster',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, booster: p.id }, k).nozzles[0].parent),
  });
// 武器：保留掛點縮放（遊戲中武器是縮小掛在手上／肩上的）
for (const p of PARTS.arm.filter((x) => x.type !== 'none'))
  add({
    id: `weapon/${p.id}`,
    cat: 'weapon',
    part: p.id,
    name: p.name,
    scaleNote: '手部掛點縮放',
    spec: 'weapon-arm',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, rarm: p.id }, k).arms.r.weapon, true),
  });
for (const p of PARTS.back.filter((x) => x.type !== 'none'))
  add({
    id: `back/${p.id}`,
    cat: 'back',
    part: p.id,
    name: p.name,
    scaleNote: '肩部掛點縮放',
    spec: 'weapon-back',
    build: (k) => partOf(mechWith({ ...NO_WEAPONS, rback: p.id }, k).arms.r.back, true),
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
const addVeh = (key, name, fn, palKey, scale, note, spec = 'vehicle') =>
  add({
    id: `vehicle/${key}`,
    cat: 'vehicle',
    name,
    note,
    pal: palKey,
    gameScale: scale,
    spec,
    build: (k) => wholeRig(fn(pal(k), 1), scale),
  });
addVeh('tank', ENEMY_TYPES.tank.name, buildVehicle, ENEMY_TYPES.tank.pal, ENEMY_TYPES.tank.scale, '敵人');
addVeh('heli', ENEMY_TYPES.heli.name, buildHeli, ENEMY_TYPES.heli.pal, ENEMY_TYPES.heli.scale, '敵人');
{
  const h = BOSS_DEFS.find((b) => b.kind === 'heli');
  if (h) addVeh('boss_helios', h.name, buildHeli, 'helios', h.scale, 'Boss', 'vehicle-boss');
}
addVeh('swarm', ENEMY_TYPES.swarm.name, buildDrone, ENEMY_TYPES.swarm.pal, ENEMY_TYPES.swarm.scale, '敵人');

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
addPlain('vehicle', 'transport_train', '運輸列車', '機車頭＋3 節車廂（遊戲中 3–5 節）', () =>
  buildTransport('train', 4, 7.5),
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
for (const [k, d] of Object.entries(PICKUP_DEFS))
  addPlain('small', 'pickup_' + k, '掉落物：' + d.name, '浮動旋轉的發光方塊', () => buildPickupMesh(d.color));
const proj = (kind) => {
  const m = buildProjectileMesh(kind, 0xffd080, 95);
  if (kind === 'missile') m.rotation.x = -Math.PI / 2; // 彈頭朝 −Z
  return m;
};
addPlain('small', 'proj_bullet', '子彈', '發光彈道（長度隨彈速 0.9–2.0 倍）', () => proj('bullet'), {
  measureFx: true,
});
addPlain('small', 'proj_missile', '飛彈', '彈體＋尾焰', () => proj('missile'), { measureFx: true });
addPlain('small', 'proj_shell', '砲彈／榴彈', '發光彈體', () => proj('shell'), { measureFx: true });

export const MODEL_CATALOG = entries;
