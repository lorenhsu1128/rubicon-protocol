// 模型目錄：遊戲中每個 3D 模型的「模型槽」。模型庫用它逐一顯示，之後換成 GLB 時也以槽位 id 對應檔案：
//   src/assets/models/<槽位 id>.glb（例如 head/h_std.glb、weapon/w_rifle.glb、mech/ac_longshot.glb）
// build(palKey) 一律回傳原始比例的模型與遊戲中的縮放：
//   { obj 加進場景的根物件（單位矩陣）, scaleNode 承載遊戲縮放的節點, scale 遊戲縮放（Vector3）, rig 可給 animateMech 驅動的機體 }
import { withRng } from '../core/math.js';
import { AC_ROSTER, BOSS_DEFS, DUO_BOSS, ENEMY_TYPES } from '../data/enemies.js';
import { PARTS, START_ASM } from '../data/parts.js';
import { PALETTES } from './materials.js';
import { buildMech } from './mech-model.js';
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

export const MODEL_CATALOG = entries;
// 之後其他模組（地圖物件等）可再註冊
export function registerModels(list, cats = []) {
  for (const c of cats) if (!CATEGORIES.some((x) => x.id === c.id)) CATEGORIES.push(c);
  for (const e of list) add(e);
}
