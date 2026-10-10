// 主題專屬敵人的程式模型（docs/campaign-design.md 第 6 節；第 1 章：荒野、礦坑）
// 介面同 boss-models.js（vehicle: true；animateMech 只處理閃光與噴嘴）；原點在地面（飛行的在機體中心下方），正面 −Z。
// 會動的節點放在 extra（entities/mech-foe.js 使用）。
import { CB, P, bakeAll, gBox, gCyl, gSph } from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

function rig(root, torso, M, o) {
  const hand = o.hand || new THREE.Group();
  const back = new THREE.Group();
  if (!hand.parent) torso.add(hand);
  torso.add(back);
  const arm = () => ({ hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() });
  return {
    group: root,
    legsG: new THREE.Group(),
    torso,
    head: torso,
    arms: { r: arm(), l: arm() },
    legs: [],
    nozzles: [],
    hipY: 0,
    type: o.type,
    cls: 'foe',
    vehicle: true,
    height: o.height,
    coreH: o.height * 0.5,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
    mounts: [],
    body: null,
    legNodes: [],
    rotor: null,
    ...(o.extra || {}),
  };
}
function finish(root, scale) {
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  tagStyle(root);
}

// 炸藥礦車：四輪礦車＋炸藥桶＋發光的引信（高約 1.7 m）
function buildCart(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 1.8, 0.9, 2.6, M.main, 0, 0.95, 0, 0, 0, 0, 0.06);
  CB(torso, 2.0, 0.15, 2.8, M.joint, 0, 1.45, 0, 0, 0, 0, 0.03);
  for (const [x, z] of [
    [-0.85, -0.9],
    [0.85, -0.9],
    [-0.85, 0.9],
    [0.85, 0.9],
  ])
    P(torso, gCyl(0.38, 0.38, 0.22, 10), M.gun, x, 0.38, z, 0, 0, Math.PI / 2);
  for (const [x, z] of [
    [-0.45, -0.55],
    [0.45, -0.55],
    [0, 0.5],
  ])
    P(torso, gCyl(0.38, 0.38, 0.75, 10), M.acc, x, 1.75, z);
  const fuse = new THREE.Group();
  fuse.position.set(0, 2.25, 0);
  torso.add(fuse);
  P(fuse, gSph(0.16, 8), glow(0xff5a20, 2.2), 0, 0, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 1.2, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'cart', height: 2.2 * scale, extra: { fuse } });
}
// 結晶寄生無人機：發光的結晶核心＋繞著轉的碎片（飛行，高約 1.4 m）
function buildCrystalDrone(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.7;
  root.add(torso);
  const cry = new THREE.MeshStandardMaterial({
    color: 0x7fe0ff,
    emissive: 0x3aa8ff,
    emissiveIntensity: 1.3,
    roughness: 0.2,
    flatShading: true,
  });
  P(torso, new THREE.OctahedronGeometry(0.55, 0), cry, 0, 0, 0, 0, 0, 0, 1, 1.5, 1);
  CB(torso, 0.9, 0.18, 0.9, M.main, 0, -0.55, 0, 0, Math.PI / 4, 0, 0.04);
  const shards = new THREE.Group();
  torso.add(shards);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.5, 5), cry);
    m.position.set(Math.cos(a) * 0.9, (i % 2) * 0.3 - 0.15, Math.sin(a) * 0.9);
    m.rotation.set(0.4, a, 0.3);
    shards.add(m);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crystal', height: 1.4 * scale, extra: { shards } });
}
// 鑽頭採礦機：履帶底盤＋機身＋前方的大鑽頭（drill 會轉）（高約 3 m）
function buildDriller(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const s of [-1, 1]) {
    CB(torso, 0.8, 0.9, 3.2, M.joint, s * 1.1, 0.45, 0.2, 0, 0, 0, 0.08);
    for (let i = 0; i < 3; i++)
      P(torso, gCyl(0.32, 0.32, 0.85, 8), M.acc, s * 1.1, 0.38, -0.8 + i * 1.0, 0, 0, Math.PI / 2);
  }
  CB(torso, 2.2, 1.4, 2.6, M.main, 0, 1.55, 0.4, 0, 0, 0, 0.12);
  CB(torso, 1.2, 0.7, 1.0, M.main3, 0, 2.6, 0.9, 0, 0, 0, 0.08);
  P(torso, gBox(0.8, 0.12, 0.05), glow(0xffb020, 1.2), 0, 2.7, 0.38);
  const drill = new THREE.Group();
  drill.position.set(0, 1.5, -1.2);
  torso.add(drill);
  P(drill, gCyl(0.05, 0.75, 2.0, 10), M.gun, 0, 0, -1.0, -Math.PI / 2);
  for (let i = 0; i < 4; i++)
    P(drill, gBox(0.08, 1.6, 0.2), M.acc, 0, 0, -0.8, -Math.PI / 2, (i * Math.PI) / 2, 0.35);
  P(torso, gCyl(0.6, 0.6, 0.6, 10), M.sub, 0, 1.5, -0.95, Math.PI / 2);
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'driller', height: 3 * scale, extra: { drill } });
}
// 廢鐵合成體：低矮的履帶身體＋堆成一團的廢鐵外殼（shell 依外殼量縮放）＋兩隻粗手臂（高約 4.5 m）
function buildJunk(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const s of [-1, 1]) CB(torso, 1.0, 1.0, 3.4, M.joint, s * 1.5, 0.5, 0, 0, 0, 0, 0.1);
  CB(torso, 2.6, 1.8, 2.6, M.main, 0, 1.9, 0, 0, 0, 0, 0.15);
  P(torso, gBox(1.0, 0.25, 0.05), glow(0xff5a20, 1.6), 0, 2.4, -1.32);
  for (const s of [-1, 1]) {
    CB(torso, 0.7, 2.4, 0.7, M.main2, s * 1.9, 1.7, -0.3, 0.3, 0, s * 0.2, 0.08);
    CB(torso, 1.0, 0.9, 1.0, M.gun, s * 2.1, 0.55, -0.8, 0, 0, 0, 0.08);
  }
  const shell = new THREE.Group();
  shell.position.set(0, 2.2, 0.2);
  torso.add(shell);
  const scrap = [M.sub, M.main3, M.acc, M.main2];
  for (let i = 0; i < 14; i++) {
    const a = i * 2.39996;
    const r = 1.2 + (i % 3) * 0.25;
    const y = ((i % 5) - 2) * 0.45;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, y + 0.6, Math.sin(a) * r * 0.9);
    g.rotation.set(i * 0.7, a, i * 0.3);
    shell.add(g);
    CB(g, 0.9 + (i % 4) * 0.25, 0.5 + (i % 3) * 0.2, 0.6, scrap[i % 4], 0, 0, 0, 0, 0, 0, 0.04);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 2.2, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'junk', height: 4.5 * scale, extra: { shell } });
}

export const FOE_BUILDERS = {
  cart: buildCart,
  crystal_drone: buildCrystalDrone,
  driller: buildDriller,
  junk: buildJunk,
};
// 模型庫登記：[key, 名稱, 備註]
export const FOE_CATALOG = [
  ['cart', '炸藥礦車', '礦坑專屬；衝向目標自爆（敵我不分）'],
  ['crystal_drone', '結晶寄生無人機', '礦坑深層專屬；擊破時碎裂四射'],
  ['driller', '鑽頭採礦機', '礦坑專屬；近戰鑽頭，衝擊大'],
  ['junk', '廢鐵合成體', '荒野專屬；吸附可破壞物件長出外殼'],
];
