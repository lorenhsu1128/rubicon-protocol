// 主題專屬敵人的程式模型（docs/campaign-design.md 第 6 節；第 1 章：荒野、沙丘、礦坑；第 2 章：集散場、水壩、水沒市街）
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

// 沙中伏擊者：從沙裡鑽出的鑽頭頭部＋一圈鉗爪（高約 2.6 m；在地下時整個隱藏）
function buildBurrower(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  P(torso, gCyl(1.1, 1.3, 1.6, 10), M.main, 0, 0.8, 0);
  for (let i = 0; i < 3; i++)
    P(torso, gCyl(1.15 - i * 0.12, 1.15 - i * 0.12, 0.2, 10), M.main2, 0, 0.3 + i * 0.5, 0);
  const head = new THREE.Group();
  head.position.set(0, 1.6, 0);
  torso.add(head);
  P(head, gCyl(0.1, 1.0, 1.2, 10), M.gun, 0, 0.6, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P(
      head,
      gBox(0.25, 1.1, 0.3),
      M.acc,
      Math.cos(a) * 0.95,
      0.3,
      Math.sin(a) * 0.95,
      Math.sin(a) * 0.5,
      0,
      -Math.cos(a) * 0.5,
    );
  }
  P(torso, gBox(0.9, 0.18, 0.05), glow(0xffd060, 1.4), 0, 1.2, -1.2);
  const hand = new THREE.Group();
  hand.position.set(0, 1.4, -1.1);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'burrower', height: 2.6 * scale, extra: { head } });
}
// 沙暴干擾機：機身＋旋轉的干擾天線（飛行，高約 1.6 m）
function buildJammer(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.8;
  root.add(torso);
  CB(torso, 1.1, 0.5, 1.4, M.main, 0, 0, 0, 0, 0, 0, 0.08);
  for (const s of [-1, 1]) CB(torso, 0.9, 0.08, 0.6, M.main2, s * 0.85, 0.05, 0, 0, 0, s * 0.15, 0.03);
  const dish = new THREE.Group();
  dish.position.set(0, 0.45, 0);
  torso.add(dish);
  P(dish, gCyl(0.06, 0.06, 0.6, 6), M.joint, 0, 0.3, 0);
  for (let i = 0; i < 3; i++)
    P(dish, gBox(1.2, 0.05, 0.12), M.acc, 0, 0.55 + i * 0.1, 0, 0, (i * Math.PI) / 3, 0);
  P(dish, gSph(0.12, 8), glow(0xffa030, 2), 0, 0.85, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.8);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'jammer', height: 1.6 * scale, extra: { dish } });
}

// 起重機砲台：格子塔＋旋轉的吊臂，吊臂前端吊著貨櫃（crate：吊著時顯示；高約 13 m，不移動）
function buildCrane(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 3.4, 1.0, 3.4, M.joint, 0, 0.5, 0, 0, 0, 0, 0.08);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) P(torso, gBox(0.24, 9.2, 0.24), M.main, sx * 0.7, 5.4, sz * 0.7);
  for (let y = 1.8; y < 10; y += 1.6)
    for (const s of [-1, 1]) {
      P(torso, gBox(1.6, 0.14, 0.14), M.main, 0, y, s * 0.7);
      P(torso, gBox(0.14, 0.14, 1.6), M.main, s * 0.7, y, 0);
    }
  CB(torso, 2.0, 1.4, 2.4, M.main2, 0, 10.6, 0.4, 0, 0, 0, 0.08);
  P(torso, gBox(1.3, 0.55, 0.05), glow(0xffd060, 1.2), 0, 10.8, -0.82);
  P(torso, gBox(0.8, 0.8, 9.4), M.main, 0, 11.7, -4.8);
  P(torso, gBox(0.7, 0.6, 4), M.main, 0, 11.7, 2.6);
  CB(torso, 1.6, 1.4, 1.4, M.sub, 0, 11.2, 4.2, 0, 0, 0, 0.06);
  P(torso, gBox(0.3, 2.4, 0.3), M.main, 0, 13.2, 0);
  P(torso, gBox(0.6, 0.5, 0.9), M.joint, 0, 11.1, -8.9);
  const crate = new THREE.Group();
  crate.position.set(0, 0, -8.9);
  torso.add(crate);
  P(crate, gBox(0.06, 3.4, 0.06), M.joint, 0, 9.2, 0);
  CB(crate, 4.6, 2.3, 2.4, M.acc, 0, 6.4, 0, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) P(crate, gBox(0.2, 2.4, 2.5), M.joint, s * 2.2, 6.4, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 6.4, -8.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crane', height: 13 * scale, extra: { crate } });
}
// 叉架 MT：堆高機的車身與護頂架，前方的貨叉舉著貨櫃當盾牌（crate：舉著時顯示；高約 3.4 m）
function buildForklift(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 2.0, 1.2, 3.0, M.main, 0, 1.1, 0.3, 0, 0, 0, 0.08);
  CB(torso, 1.9, 0.8, 1.0, M.sub, 0, 1.9, 1.4, 0, 0, 0, 0.06);
  for (const [x, z] of [
    [-0.85, -0.2],
    [0.85, -0.2],
    [-0.85, 0.9],
    [0.85, 0.9],
  ])
    P(torso, gBox(0.1, 1.6, 0.1), M.joint, x, 2.5, z);
  CB(torso, 1.9, 0.12, 1.4, M.main2, 0, 3.3, 0.35, 0, 0, 0, 0.02);
  P(torso, gBox(0.8, 0.25, 0.05), glow(0xffb040, 1.4), 0, 2.2, -0.24);
  for (const [x, z] of [
    [-1.05, -0.7],
    [1.05, -0.7],
    [-1.05, 1.2],
    [1.05, 1.2],
  ])
    P(torso, gCyl(0.45, 0.45, 0.35, 10), M.gun, x, 0.45, z, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) {
    P(torso, gBox(0.15, 3.4, 0.15), M.joint, s * 0.6, 1.9, -1.3);
    P(torso, gBox(0.2, 0.1, 1.6), M.gun, s * 0.5, 0.55, -2.1);
  }
  const crate = new THREE.Group();
  crate.position.set(0, 0, -2.3);
  torso.add(crate);
  CB(crate, 3.0, 2.4, 1.5, M.acc, 0, 1.85, 0, 0, 0, 0, 0.04);
  for (const s of [-1, 1]) P(crate, gBox(0.2, 2.5, 1.56), M.joint, s * 1.4, 1.85, 0);
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -1.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'forklift', height: 3.4 * scale, extra: { crate } });
}

// 閘門砲台：裝在閘門上的方形砲塔＋雙砲管＋開閘的捲揚輪（高約 3.2 m，不移動）
function buildGateTurret(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 3.2, 0.8, 3.2, M.joint, 0, 0.4, 0, 0, 0, 0, 0.06);
  CB(torso, 2.6, 1.6, 2.8, M.main, 0, 1.6, 0, 0, 0, 0, 0.12);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.18, 0.22, 2.6, 8), M.gun, s * 0.55, 1.9, -2.2, Math.PI / 2);
    P(torso, gBox(0.3, 1.6, 0.3), M.acc, s * 1.45, 1.6, 0.6);
  }
  const wheel = new THREE.Group();
  wheel.position.set(0, 2.9, 0.6);
  torso.add(wheel);
  P(wheel, gCyl(0.8, 0.8, 0.12, 12), M.main2, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 3; i++) P(wheel, gBox(1.5, 0.1, 0.1), M.main2, 0, 0, 0, 0, 0, (i * Math.PI) / 3);
  P(torso, gBox(1.2, 0.25, 0.05), glow(0x60c8ff, 1.6), 0, 2.0, -1.42);
  const hand = new THREE.Group();
  hand.position.set(0, 1.9, -3.4);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'gate_turret', height: 3.2 * scale, extra: { wheel } });
}
// 壩頂巡邏砲車：六輪裝甲車＋長砲管的砲塔（高約 2.6 m）
function buildPatrolCart(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 2.2, 1.0, 4.0, M.main, 0, 1.1, 0, 0, 0, 0, 0.1);
  for (const z of [-1.4, 0, 1.4])
    for (const s of [-1, 1])
      P(torso, gCyl(0.45, 0.45, 0.35, 10), M.gun, s * 1.15, 0.45, z, 0, 0, Math.PI / 2);
  CB(torso, 1.5, 0.7, 1.7, M.main2, 0, 1.95, 0.3, 0, 0, 0, 0.08);
  P(torso, gCyl(0.12, 0.15, 2.8, 8), M.gun, 0, 2.0, -1.6, Math.PI / 2);
  P(torso, gBox(0.7, 0.2, 0.05), glow(0xffb040, 1.4), 0, 1.4, -2.02);
  const hand = new THREE.Group();
  hand.position.set(0, 2.0, -3.0);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'patrol_cart', height: 2.6 * scale });
}

// 潛航砲艇：低矮的艇身、尖艏、小砲塔與潛望鏡、艏部魚雷管（高約 1.8 m；潛航時隱藏）
function buildGunboat(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 2.4, 0.9, 4.4, M.main, 0, 0.6, 0.4, 0, 0, 0, 0.12);
  CB(torso, 1.4, 0.7, 1.6, M.main, 0, 0.6, -2.4, 0, Math.PI / 4, 0, 0.08);
  CB(torso, 1.3, 0.6, 1.6, M.main2, 0, 1.3, 0.6, 0, 0, 0, 0.08);
  P(torso, gCyl(0.1, 0.1, 1.2, 6), M.joint, 0.3, 2.0, 0.9);
  for (const s of [-1, 1]) P(torso, gCyl(0.16, 0.16, 1.2, 8), M.gun, s * 0.5, 0.6, -2.6, Math.PI / 2);
  P(torso, gBox(0.8, 0.18, 0.05), glow(0x9aff40, 1.4), 0, 1.35, -0.22);
  const hand = new THREE.Group();
  hand.position.set(0, 0.6, -3.2);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'gunboat', height: 1.8 * scale });
}
// 汙染噴射 MT：履帶底盤＋背上的汙染液槽＋前方的噴嘴臂（高約 3.2 m）
function buildSprayer(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const s of [-1, 1]) CB(torso, 0.8, 0.9, 3.0, M.joint, s * 1.05, 0.45, 0, 0, 0, 0, 0.08);
  CB(torso, 1.8, 1.0, 2.4, M.main, 0, 1.3, 0.1, 0, 0, 0, 0.1);
  P(torso, gCyl(0.75, 0.75, 2.2, 12), M.acc, 0, 2.4, 0.6, Math.PI / 2);
  for (const z of [-0.2, 1.4]) P(torso, gCyl(0.8, 0.8, 0.15, 12), M.main2, 0, 2.4, z, Math.PI / 2);
  P(torso, gBox(0.3, 0.3, 1.8), M.gun, 0.5, 1.8, -1.4);
  P(torso, gCyl(0.12, 0.25, 0.5, 8), M.gun, 0.5, 1.8, -2.5, Math.PI / 2);
  P(torso, gSph(0.25, 8), glow(0x9aff40, 1.8), 0, 3.2, 0.6);
  const hand = new THREE.Group();
  hand.position.set(0.5, 1.8, -2.8);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'sprayer', height: 3.2 * scale });
}

// 雪中潛伏 MT：伏低的四腳機身＋雪地偽裝布＋雙管機砲（高約 2.2 m；埋在雪裡時隱藏）
function buildLurker(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      P(torso, gBox(0.35, 1.2, 0.35), M.joint, sx * 1.1, 0.6, sz * 1.0, sz * 0.4, 0, sx * 0.3);
  CB(torso, 2.0, 0.9, 2.6, M.main, 0, 1.4, 0, 0, 0, 0, 0.12);
  CB(torso, 2.4, 0.15, 2.9, M.main3, 0, 1.92, 0.1, 0.05, 0, 0, 0.04);
  for (const s of [-1, 1]) P(torso, gCyl(0.1, 0.12, 1.4, 8), M.gun, s * 0.35, 1.5, -1.8, Math.PI / 2);
  P(torso, gBox(0.6, 0.15, 0.05), glow(0xff6040, 1.4), 0, 1.55, -1.32);
  const hand = new THREE.Group();
  hand.position.set(0, 1.5, -2.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'lurker', height: 2.2 * scale });
}
// 冰面滑行砲車：雪橇板＋後方的推進風扇＋機砲塔（高約 2.4 m）
function buildSkater(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const s of [-1, 1]) CB(torso, 0.3, 0.2, 4.2, M.joint, s * 1.0, 0.15, 0, 0, 0, 0, 0.04);
  CB(torso, 1.9, 0.8, 3.2, M.main, 0, 0.75, 0.1, 0, 0, 0, 0.12);
  const fan = new THREE.Group();
  fan.position.set(0, 1.5, 1.7);
  torso.add(fan);
  P(fan, gCyl(0.9, 0.9, 0.3, 14), M.main2, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 4; i++) P(fan, gBox(1.6, 0.18, 0.06), M.sub, 0, 0, 0, 0, 0, (i * Math.PI) / 4);
  CB(torso, 1.0, 0.6, 1.0, M.main2, 0, 1.5, -0.5, 0, 0, 0, 0.06);
  P(torso, gCyl(0.1, 0.12, 1.4, 8), M.gun, 0, 1.55, -1.5, Math.PI / 2);
  P(torso, gBox(0.6, 0.15, 0.05), glow(0xffa060, 1.4), 0, 1.0, -1.52);
  const hand = new THREE.Group();
  hand.position.set(0, 1.55, -2.3);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'skater', height: 2.4 * scale, extra: { fan } });
}

// 實驗體：發光的肉塊＋四隻爪腳（小型高約 1.3 m；融合實驗體 big 高約 3.6 m、更多瘤與爪）
function buildBlob(pal, scale, big = false) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  const k = big ? 2.6 : 1;
  P(torso, gSph(0.7 * k, 10), M.main, 0, 0.75 * k, 0);
  for (let i = 0; i < (big ? 7 : 3); i++) {
    const a = i * 2.39996;
    P(
      torso,
      gSph((0.25 + (i % 3) * 0.08) * k, 8),
      M.main3,
      Math.cos(a) * 0.5 * k,
      (0.9 + (i % 2) * 0.3) * k,
      Math.sin(a) * 0.5 * k,
    );
  }
  for (let i = 0; i < (big ? 6 : 4); i++) {
    const a = (i / (big ? 6 : 4)) * Math.PI * 2 + 0.4;
    P(
      torso,
      gBox(0.14 * k, 0.9 * k, 0.14 * k),
      M.joint,
      Math.cos(a) * 0.7 * k,
      0.35 * k,
      Math.sin(a) * 0.7 * k,
      Math.sin(a) * 0.6,
      0,
      -Math.cos(a) * 0.6,
    );
  }
  P(torso, gSph(0.18 * k, 8), glow(0xff3a30, 2.2), 0, 0.85 * k, -0.62 * k);
  const hand = new THREE.Group();
  hand.position.set(0, 0.8 * k, -0.8 * k);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: big ? 'chimera' : 'blob', height: (big ? 3.6 : 1.3) * scale });
}
// 保全雷射網：柵欄柱＋往前伸出 16 m 的雷射柵欄（bar，紅色發光；柱子轉動時跟著掃）
function buildLaserPost(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 1.6, 0.6, 1.6, M.joint, 0, 0.3, 0, 0, 0, 0, 0.06);
  CB(torso, 0.8, 3.6, 0.8, M.main2, 0, 2.2, 0, 0, 0, 0, 0.06);
  P(torso, gBox(1.1, 0.3, 1.1), M.main, 0, 4.1, 0);
  for (const y of [1.2, 2.2, 3.2]) P(torso, gBox(0.3, 0.2, 0.3), glow(0xff3a30, 2), 0, y, -0.45);
  const bar = new THREE.Group();
  torso.add(bar);
  const lm = new THREE.MeshBasicMaterial({ color: 0xff3a30, transparent: true, opacity: 0.75 });
  for (const y of [1.2, 2.2, 3.2]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 16), lm);
    m.position.set(0, y, -8.4);
    bar.add(m);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 2.2, -0.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'laserpost', height: 4.3 * scale, extra: { bar } });
}

// 構造體爬行機：扁平的身體＋六隻多關節腳（高約 1.6 m）
function buildCrawler(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 1.6, 0.6, 2.2, M.main, 0, 1.0, 0, 0, 0, 0, 0.1);
  for (const z of [-0.8, 0, 0.8])
    for (const s of [-1, 1]) {
      P(torso, gBox(1.1, 0.14, 0.14), M.joint, s * 1.2, 1.15, z, 0, 0, s * -0.4);
      P(torso, gBox(0.14, 1.2, 0.14), M.joint, s * 1.75, 0.6, z, 0, 0, s * 0.25);
    }
  P(torso, gCyl(0.08, 0.1, 1.0, 8), M.gun, 0, 1.1, -1.4, Math.PI / 2);
  for (const s of [-1, 1]) P(torso, gSph(0.12, 8), glow(0xffa040, 1.8), s * 0.35, 1.2, -1.12);
  const hand = new THREE.Group();
  hand.position.set(0, 1.1, -1.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'crawler', height: 1.6 * scale });
}
// 平台底部砲塔：頂部的吊掛座＋倒吊的砲塔與雙管（原點在底部；吊在平台底面，高約 2 m）
function buildUnderTurret(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 2.2, 0.3, 2.2, M.joint, 0, 2.0, 0, 0, 0, 0, 0.04);
  P(torso, gCyl(0.25, 0.25, 0.6, 8), M.main2, 0, 1.6, 0);
  P(torso, gSph(0.9, 12), M.main, 0, 0.9, 0);
  for (const s of [-1, 1]) P(torso, gCyl(0.08, 0.1, 1.3, 8), M.gun, s * 0.25, 0.7, -0.95, Math.PI / 2 + 0.3);
  P(torso, gSph(0.15, 8), glow(0xffa040, 2), 0, 0.6, -0.8);
  const hand = new THREE.Group();
  hand.position.set(0, 0.5, -1.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'underturret', height: 2 * scale });
}
// 推進器試車台：台座＋大型噴口（朝 −Z）＋控制台（高約 4 m，不移動）
function buildTestRig(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 3.6, 1.2, 4, M.joint, 0, 0.6, 0.4, 0, 0, 0, 0.08);
  P(torso, gCyl(1.0, 1.6, 3.2, 14), M.gun, 0, 2.4, -0.8, Math.PI / 2);
  P(torso, gCyl(1.1, 1.1, 0.2, 14), glow(0xff8a30, 1.2), 0, 2.4, -2.45, Math.PI / 2);
  CB(torso, 1.6, 2.2, 1.4, M.main, 0, 2.2, 1.9, 0, 0, 0, 0.08);
  P(torso, gBox(1.2, 0.5, 0.05), glow(0x60c0ff, 1.4), 0, 2.8, 1.18);
  const hand = new THREE.Group();
  hand.position.set(0, 2.4, -2.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'testrig', height: 4 * scale });
}
// 舊式宇宙用 MT：圓胖的機身、背上的姿勢控制推進器、短腳（高約 3 m）
function buildSpaceMt(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  for (const s of [-1, 1]) {
    CB(torso, 0.6, 1.2, 0.7, M.joint, s * 0.6, 0.6, 0, 0, 0, 0, 0.06);
    CB(torso, 0.8, 0.3, 1.1, M.main2, s * 0.6, 0.15, -0.1, 0, 0, 0, 0.04);
  }
  P(torso, gSph(1.1, 12), M.main, 0, 1.9, 0);
  P(torso, gBox(1.0, 0.5, 0.1), glow(0x60c0ff, 1.4), 0, 2.1, -1.0);
  for (const s of [-1, 1]) P(torso, gCyl(0.25, 0.3, 0.8, 8), M.main2, s * 0.8, 2.1, 0.9, 0.4);
  P(torso, gCyl(0.08, 0.1, 1.2, 8), M.gun, 0.9, 1.7, -0.8, Math.PI / 2);
  const hand = new THREE.Group();
  hand.position.set(0.9, 1.7, -1.5);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'spacemt', height: 3 * scale });
}

// 衝撞無人機：前端是撞角的流線形機體＋兩側的推進器（飛行，高約 1.2 m）
function buildRammer(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.6;
  root.add(torso);
  P(torso, gCyl(0.1, 0.6, 2.2, 10), M.main, 0, 0, -0.4, -Math.PI / 2);
  P(torso, gCyl(0.6, 0.5, 0.8, 10), M.main2, 0, 0, 1.0, Math.PI / 2);
  for (const s of [-1, 1]) P(torso, gCyl(0.25, 0.3, 0.9, 8), M.joint, s * 0.8, 0, 0.8, Math.PI / 2);
  P(torso, gSph(0.15, 8), glow(0x60e0ff, 2), 0, 0.3, -0.2);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -1.6);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'rammer', height: 1.2 * scale });
}
// 艦載防空砲：圓形砲座＋朝上的四連裝砲管（高約 3.4 m，不移動）
function buildFlak(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  P(torso, gCyl(1.8, 2.0, 0.8, 14), M.joint, 0, 0.4, 0);
  CB(torso, 2.2, 1.4, 2.2, M.main, 0, 1.5, 0, 0, 0, 0, 0.12);
  for (const sx of [-1, 1])
    for (const sy of [0, 1])
      P(torso, gCyl(0.12, 0.14, 2.4, 8), M.gun, sx * 0.45, 2.1 + sy * 0.4, -1.0, Math.PI / 2 - 0.6);
  P(torso, gBox(1.0, 0.25, 0.05), glow(0x60e0ff, 1.4), 0, 1.7, -1.12);
  const hand = new THREE.Group();
  hand.position.set(0, 2.9, -1.9);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'flak', height: 3.4 * scale });
}

// 真空作業機：箱形機身＋兩隻作業臂＋四個姿勢控制噴嘴（飛行，高約 1.8 m）
function buildVacuum(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  root.add(torso);
  CB(torso, 1.4, 1.0, 1.4, M.main, 0, 0, 0, 0, 0, 0, 0.1);
  for (const s of [-1, 1]) {
    P(torso, gBox(0.2, 0.2, 1.2), M.joint, s * 0.7, -0.2, -0.8);
    P(torso, gBox(0.3, 0.3, 0.3), M.main2, s * 0.7, -0.2, -1.45);
  }
  for (const [x, z] of [
    [-0.8, -0.8],
    [0.8, -0.8],
    [-0.8, 0.8],
    [0.8, 0.8],
  ])
    P(torso, gCyl(0.15, 0.2, 0.3, 8), M.sub, x, 0.4, z);
  P(torso, gBox(0.8, 0.2, 0.05), glow(0x9fe8ff, 1.6), 0, 0.15, -0.72);
  const hand = new THREE.Group();
  hand.position.set(0.7, -0.2, -1.7);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'vacuum', height: 1.8 * scale });
}
// 軌道標定衛星：圓筒本體＋兩片太陽能板＋往下的標定透鏡（飛行，高約 1.6 m）
function buildMarker(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.8;
  root.add(torso);
  P(torso, gCyl(0.5, 0.5, 1.4, 12), M.main, 0, 0, 0);
  for (const s of [-1, 1]) CB(torso, 2.2, 0.05, 0.9, M.acc, s * 1.7, 0, 0, 0, 0, 0, 0.01);
  P(torso, gSph(0.3, 10), glow(0xff5050, 2.2), 0, -0.8, 0);
  const hand = new THREE.Group();
  hand.position.set(0, -0.9, 0);
  torso.add(hand);
  finish(root, scale);
  return rig(root, torso, M, { hand, type: 'marker', height: 1.6 * scale });
}

export const FOE_BUILDERS = {
  vacuum: buildVacuum,
  marker: buildMarker,
  rammer: buildRammer,
  flak: buildFlak,
  crawler: buildCrawler,
  underturret: buildUnderTurret,
  testrig: buildTestRig,
  spacemt: buildSpaceMt,
  blob: (pal, scale) => buildBlob(pal, scale),
  chimera: (pal, scale) => buildBlob(pal, scale, true),
  laserpost: buildLaserPost,
  lurker: buildLurker,
  skater: buildSkater,
  gunboat: buildGunboat,
  sprayer: buildSprayer,
  gate_turret: buildGateTurret,
  patrol_cart: buildPatrolCart,
  crane: buildCrane,
  forklift: buildForklift,
  burrower: buildBurrower,
  jammer: buildJammer,
  cart: buildCart,
  crystal_drone: buildCrystalDrone,
  driller: buildDriller,
  junk: buildJunk,
};
// 模型庫登記：[key, 名稱, 備註]
export const FOE_CATALOG = [
  ['vacuum', '真空作業機', '高空軌道專屬；全程懸浮、忽高忽低'],
  ['marker', '軌道標定衛星', '高空軌道專屬；標定目標，被標定時受傷變重'],
  ['rammer', '衝撞無人機', '洋上都市專屬；高速撞擊，把機體往甲板邊緣推'],
  ['flak', '艦載防空砲', '洋上都市專屬；專打空中的目標'],
  ['crawler', '構造體爬行機', 'Grid 086 專屬；沿柱子爬上平台'],
  ['underturret', '平台底部砲塔', 'Grid 086 專屬；吊在上層平台的底面往下射'],
  ['testrig', '推進器試車台', '舊宇宙港專屬；噴口定期噴火橫掃'],
  ['spacemt', '舊式宇宙用 MT', '舊宇宙港專屬；低重力設計，跳得高、滯空久'],
  ['blob', '實驗體', '技研都市專屬；成群撲咬，三隻以上聚集會融合'],
  ['chimera', '融合實驗體', '技研都市專屬；實驗體融合而成的大型個體'],
  ['laserpost', '保全雷射網', '技研都市專屬；旋轉的雷射柵欄，碰到會觸發警報叫增援'],
  ['lurker', '雪中潛伏 MT', '冰原專屬；埋在雪裡隱藏，靠近才現身'],
  ['skater', '冰面滑行砲車', '冰原專屬；高速繞圈掃射，冰面上更快'],
  ['gunboat', '潛航砲艇', '水沒市街專屬；潛在水下打不到，浮出水面發射魚雷'],
  ['sprayer', '汙染噴射 MT', '水沒市街專屬；噴出汙染液留下腐蝕區'],
  ['gate_turret', '閘門砲台', '水壩專屬；裝在閘門上，開閘的水流把機體往下游推'],
  ['patrol_cart', '壩頂巡邏砲車', '水壩專屬；佔住壩頂等高處砲擊'],
  ['crane', '起重機砲台', '集散場專屬；不移動，吊起貨櫃往預警圈砸下'],
  ['forklift', '叉架 MT', '集散場專屬；舉著貨櫃當盾牌，靠近時丟出'],
  ['burrower', '沙中伏擊者', '沙丘專屬；在沙下移動，從腳下鑽出攻擊'],
  ['jammer', '沙暴干擾機', '沙丘專屬；附近的鎖定距離縮短'],
  ['cart', '炸藥礦車', '礦坑專屬；衝向目標自爆（敵我不分）'],
  ['crystal_drone', '結晶寄生無人機', '礦坑深層專屬；擊破時碎裂四射'],
  ['driller', '鑽頭採礦機', '礦坑專屬；近戰鑽頭，衝擊大'],
  ['junk', '廢鐵合成體', '荒野專屬；吸附可破壞物件長出外殼'],
];
