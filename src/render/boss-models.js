// 新 Boss 與附屬部位的程式模型（鑽地蟲、多足要塞、空中要塞、砲兵指揮所；砲台、懸吊砲塔、引擎、護盾發生器、腳部關節）
// 介面和載具模型相同（vehicle: true，animateMech 只處理閃光與噴嘴），另外：
//   mounts：附屬部位掛載的節點（部位實體每格移到這個節點的世界位置）
//   body：多足要塞的機身群組（倒下時降低）、legNodes：多足要塞的 6 條腿
// 這些模型目前不接受 GLB（模型庫只預覽）。
import { CB, P, bakeAll, gBox, gCyl, gSph, kitVents } from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

const glow = (color, k = 1.6) =>
  new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: k, roughness: 0.4 });

// 共用的回傳結構
function rigOf(root, torso, M, o) {
  const hand = o.hand || new THREE.Group();
  const back = o.back || new THREE.Group();
  if (!hand.parent) torso.add(hand);
  if (!back.parent) torso.add(back);
  const arm = () => ({ hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() });
  return {
    group: root,
    legsG: o.legsG || new THREE.Group(),
    torso,
    head: torso,
    arms: { r: arm(), l: arm() },
    legs: [],
    nozzles: o.nozzles || [],
    hipY: 0,
    type: o.type,
    cls: o.cls || 'boss',
    vehicle: true,
    height: o.height,
    coreH: o.height * 0.5,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
    mounts: o.mounts || [],
    body: o.body || null,
    legNodes: o.legNodes || [],
    rotor: o.rotor || null,
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

// 鑽地蟲的頭（身體各節由 segments 另外建立，跟著頭的軌跡排列）：正面 −Z，原點在頭部底面
function buildWormHead(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.9;
  root.add(torso);
  P(torso, gCyl(1.9, 1.7, 4.2, 10), M.main, 0, 0, 0.4, Math.PI / 2);
  for (let i = 0; i < 4; i++) P(torso, gCyl(1.98, 1.98, 0.35, 10), M.main2, 0, 0, 2.2 - i * 1.2, Math.PI / 2);
  // 顎：三片往前張開
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    P(
      torso,
      gCyl(0.05, 0.55, 2.4, 5),
      M.sub,
      Math.cos(a) * 1.3,
      Math.sin(a) * 1.3,
      -2.6,
      -Math.PI / 2 + 0.0,
      0,
      0,
    );
    CB(torso, 0.5, 0.4, 1.4, M.acc, Math.cos(a) * 1.5, Math.sin(a) * 1.5, -1.6, 0, 0, a, 0.05);
  }
  // 感測器（弱點）
  P(torso, gSph(0.75, 10), glow(0xff7a20, 2.2), 0, 0, -1.75);
  P(torso, gCyl(1.1, 1.1, 0.2, 12), M.joint, 0, 0, -1.65, Math.PI / 2);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    P(
      torso,
      gCyl(0.08, 0.3, 0.9, 4),
      M.sub,
      Math.cos(a) * 1.8,
      Math.sin(a) * 1.8,
      0.6,
      0,
      0,
      a - Math.PI / 2,
    );
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -2.4);
  const back = new THREE.Group();
  back.position.set(0, 1.6, 0.6);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'worm', height: 3.8 * scale });
}
// 鑽地蟲的身體節（由大到小）
export function buildWormSegments(pal, n) {
  const M = mechMats(pal);
  const out = [];
  const geo = new THREE.CylinderGeometry(1, 1, 1.8, 10);
  geo.rotateX(Math.PI / 2);
  const ring = new THREE.CylinderGeometry(1.06, 1.06, 0.3, 10);
  ring.rotateX(Math.PI / 2);
  for (let i = 0; i < n; i++) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, i % 2 ? M.main : M.main3);
    const r = new THREE.Mesh(ring, M.main2);
    r.position.z = 0.8;
    g.add(m, r);
    const s = 1.8 * (1 - (i / n) * 0.55);
    g.scale.set(s, s, 1.25);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    out.push(g);
  }
  return { list: out, mats: [M.main, M.main2, M.main3] };
}

// 多足要塞：六條腿撐起扁平機身，機身底部是發光核心（弱點），腿的膝關節是附屬部位
function buildSpider(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Group();
  torso.position.y = 7.2;
  body.add(torso);
  P(torso, gCyl(4.6, 5.2, 1.6, 6), M.main, 0, 0, 0);
  P(torso, gCyl(3.4, 4.6, 1.0, 6), M.main2, 0, 1.3, 0);
  P(torso, gCyl(1.6, 2.2, 0.9, 6), M.main3, 0, 2.2, 0.6);
  CB(torso, 2.2, 0.9, 1.4, M.sub, 0, 0.6, -4.4, 0, 0, 0, 0.1);
  P(torso, gBox(1.6, 0.18, 0.08), glow(0xff3a2a, 1.4), 0, 0.7, -5.12);
  kitVents(torso, M, 2.4, 1.0, 2.2, 5, 0.4, 0.5, 0.1);
  // 底部核心（弱點）
  P(torso, gSph(1.5, 12), glow(0xff8a2a, 2.0), 0, -1.2, 0);
  P(torso, gCyl(2.2, 1.6, 0.6, 8), M.joint, 0, -0.9, 0);
  // 背上的導彈莢艙
  for (const s of [-1, 1]) CB(torso, 1.0, 0.8, 2.0, M.gun, s * 1.6, 1.9, 1.6, 0, 0, 0, 0.06);
  const back = new THREE.Group();
  back.position.set(0, 2.6, 1.6);
  // 底部機砲
  const hand = new THREE.Group();
  hand.position.set(0, -1.6, -2.6);
  CB(hand, 0.9, 0.7, 1.4, M.gun, 0, 0, 0, 0, 0, 0, 0.05);
  for (let i = 0; i < 3; i++) P(hand, gCyl(0.08, 0.08, 1.6, 6), M.sub, (i - 1) * 0.22, 0, -1.2, Math.PI / 2);
  torso.add(hand, back);
  // 腿：髖（繞 Y 擺動）→ 大腿往上外 → 膝（掛載點）→ 小腿往下到地面
  const legNodes = [],
    mounts = [];
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2;
    const hip = new THREE.Group();
    hip.position.set(Math.cos(a) * 4.2, 7.2, Math.sin(a) * 4.2);
    hip.rotation.y = -a;
    body.add(hip);
    const leg = new THREE.Group(); // 抬腿用（繞 Z）
    hip.add(leg);
    P(leg, gCyl(0.55, 0.7, 5.6, 6), M.main2, 2.5, 1.3, 0, 0, 0, -1.15);
    P(leg, gSph(0.8, 8), M.joint, 0, 0, 0);
    const knee = new THREE.Group();
    knee.position.set(5.0, 2.6, 0);
    leg.add(knee);
    P(knee, gCyl(0.45, 0.25, 10.2, 6), M.main, 1.5, -4.9, 0, 0, 0, 0.3);
    CB(knee, 0.9, 1.6, 0.9, M.sub, 0.6, -2.0, 0, 0, 0, 0.3, 0.08);
    P(knee, gCyl(0.15, 0.5, 0.8, 6), M.joint, 3.05, -9.8, 0);
    legNodes.push({ hip, leg, knee, a });
    mounts.push(knee);
  }
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'spider', height: 9 * scale, body, legNodes, mounts });
}

// 空中要塞：長型機身＋機翼，底部 4 個懸吊砲塔、翼端 2 具引擎（都是附屬部位）。原點在機身底面
function buildFortress(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 2.2;
  root.add(torso);
  CB(torso, 7, 4, 24, M.main, 0, 0, 0, 0, 0, 0, 0.6);
  CB(torso, 5, 2.4, 6, M.main2, 0, 0.6, -14, -0.25, 0, 0, 0.4);
  CB(torso, 4.4, 1.6, 10, M.main3, 0, 2.6, 2, 0, 0, 0, 0.3);
  CB(torso, 2.4, 1.4, 3, M.sub, 0, 3.9, 4, 0, 0, 0, 0.2);
  P(torso, gBox(3.4, 0.25, 0.1), glow(0xff3a2a, 1.4), 0, 0.9, -17.05);
  for (const s of [-1, 1]) {
    CB(torso, 18, 0.8, 7, M.main2, s * 11, -0.2, 6, 0, s * 0.12, 0, 0.2);
    CB(torso, 0.5, 4, 3.5, M.main, s * 2.6, 3.6, 10.5, 0, 0, s * 0.25, 0.1);
    kitVents(torso, M, s * 3.55, 0.6, -3, 6, 0.5, (s * Math.PI) / 2, 0.12);
    for (let i = 0; i < 5; i++)
      P(torso, gBox(0.6, 0.3, 0.3), glow(0xffc060, 1.2), s * 3.52, -0.8, -8 + i * 4);
  }
  // 底部彈艙（投彈）與機首砲
  const back = new THREE.Group();
  back.position.set(0, -2.4, 2);
  CB(torso, 3, 0.6, 6, M.sub, 0, -2.2, 2, 0, 0, 0, 0.1);
  const hand = new THREE.Group();
  hand.position.set(0, -1.2, -15);
  CB(hand, 1.2, 1.0, 2, M.gun, 0, 0, 0, 0, 0, 0, 0.08);
  torso.add(hand, back);
  const mounts = [];
  for (const [x, z] of [
    [-2.4, -8],
    [2.4, -8],
    [-2.4, 6],
    [2.4, 6],
  ]) {
    const m = new THREE.Group();
    m.position.set(x, -2.6, z);
    torso.add(m);
    mounts.push(m);
  }
  for (const s of [-1, 1]) {
    const m = new THREE.Group();
    m.position.set(s * 17, 0.2, 8);
    torso.add(m);
    mounts.push(m);
  }
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'fortress', height: 4.4 * scale, mounts });
}

// 砲兵指揮所：低矮的碉堡＋旋轉雷達，固定不動
function buildBunker(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  CB(torso, 11, 3.2, 11, M.main2, 0, 1.6, 0, 0, 0, 0, 0.8);
  CB(torso, 7.5, 1.8, 7.5, M.main, 0, 4.0, 0, 0, Math.PI / 4, 0, 0.4);
  for (const s of [-1, 1]) {
    CB(torso, 1.2, 2.6, 11.4, M.sub, s * 5.2, 1.3, 0, 0, 0, s * 0.25, 0.1);
    P(torso, gBox(2.6, 0.2, 0.08), glow(0xff3a2a, 1.2), s * 2.4, 2.6, -5.52);
  }
  kitVents(torso, M, 0, 2.2, 5.55, 6, 0.6, Math.PI, 0.12);
  P(torso, gCyl(0.25, 0.3, 3, 6), M.joint, 2.2, 6.2, 2.2);
  const rotor = new THREE.Group();
  rotor.position.set(2.2, 7.7, 2.2);
  torso.add(rotor);
  P(rotor, gCyl(1.6, 0.3, 0.6, 10), M.main3, 0, 0, 0, 0.5);
  P(rotor, gSph(0.25, 6), glow(0xff5a2a, 1.6), 0, 0.2, -0.6);
  // 近防機砲
  const hand = new THREE.Group();
  hand.position.set(-2.2, 5.6, -2.2);
  CB(hand, 1.0, 0.8, 1.0, M.gun, 0, 0, 0, 0, 0, 0, 0.06);
  P(hand, gCyl(0.1, 0.1, 1.8, 6), M.sub, 0, 0, -1.2, Math.PI / 2);
  const back = new THREE.Group();
  back.position.set(0, 5.4, 0);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'bunker', height: 5.5 * scale, rotor });
}

// ---------- 附屬部位 ----------
// 長程砲台：底座＋會轉的砲塔（torso 繞 Y 轉向目標），砲管仰角 35°
function buildCannon(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  P(legsG, gCyl(2.2, 2.6, 1.2, 8), M.main2, 0, 0.6, 0);
  P(legsG, gCyl(1.6, 1.6, 0.4, 8), M.joint, 0, 1.4, 0);
  const torso = new THREE.Group();
  torso.position.y = 1.6;
  root.add(torso);
  CB(torso, 2.6, 1.6, 3.2, M.main, 0, 0.9, 0.3, 0, 0, 0, 0.2);
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.2, -0.6);
  barrel.rotation.x = 0.6;
  torso.add(barrel);
  P(barrel, gCyl(0.32, 0.42, 6, 8), M.gun, 0, 0, -3, Math.PI / 2);
  P(barrel, gCyl(0.5, 0.5, 0.8, 8), M.sub, 0, 0, -5.8, Math.PI / 2);
  const back = new THREE.Group();
  back.position.set(0, 0, -6.4);
  barrel.add(back);
  P(torso, gBox(0.8, 0.12, 0.06), glow(0xff3a2a, 1.4), 0, 1.3, -1.32);
  finish(root, scale);
  return rigOf(root, torso, M, { back, legsG, type: 'cannon', height: 3.4 * scale });
}
// 懸吊砲塔（掛在空中要塞底部）：原點在頂部，往下吊；torso 轉向目標
function buildFTurret(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.9;
  root.add(torso);
  P(torso, gCyl(0.6, 0.8, 0.6, 8), M.joint, 0, 0.7, 0);
  P(torso, gSph(1.0, 10), M.main, 0, 0, 0);
  P(torso, gBox(0.9, 0.1, 0.06), glow(0xff3a2a, 1.4), 0, 0.1, -0.98);
  const hand = new THREE.Group();
  hand.position.set(0, -0.2, -1.9);
  torso.add(hand);
  for (const s of [-1, 1]) P(torso, gCyl(0.1, 0.1, 1.6, 6), M.gun, s * 0.25, -0.2, -1.2, Math.PI / 2);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'fturret', height: 1.9 * scale });
}
// 引擎：沿 Z 的大型短艙，後端發光噴口
function buildEngine(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.7;
  root.add(torso);
  P(torso, gCyl(1.7, 1.4, 6, 10), M.main3, 0, 0, 0, Math.PI / 2);
  P(torso, gCyl(1.8, 1.8, 0.4, 10), M.main2, 0, 0, -2.6, Math.PI / 2);
  for (let i = 0; i < 4; i++) P(torso, gBox(0.1, 3.0, 0.3), M.sub, 0, 0, -3.05, 0, 0, (i * Math.PI) / 4);
  P(torso, gCyl(1.2, 1.2, 0.2, 12), glow(0x7fd8ff, 2.0), 0, 0, 3.05, Math.PI / 2);
  const fl = new THREE.Mesh(
    new THREE.ConeGeometry(1.0, 3.2, 10),
    new THREE.MeshBasicMaterial({
      color: 0x8fe8ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  fl.position.set(0, 0, 4.6);
  fl.rotation.x = Math.PI / 2;
  torso.add(fl);
  finish(root, scale);
  return rigOf(root, torso, M, { type: 'engine', height: 3.4 * scale, nozzles: [fl] });
}
// 護盾發生器：細高的柱子，頂端是發光的晶體（旋轉）
function buildPylon(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  P(torso, gCyl(1.4, 1.8, 1.0, 6), M.main2, 0, 0.5, 0);
  P(torso, gCyl(0.5, 0.8, 5.5, 6), M.main, 0, 3.6, 0);
  for (const s of [-1, 1]) CB(torso, 0.3, 4, 0.6, M.sub, s * 0.75, 3.4, 0, 0, 0, s * 0.08, 0.04);
  const rotor = new THREE.Group();
  rotor.position.y = 7.2;
  torso.add(rotor);
  P(rotor, new THREE.OctahedronGeometry(0.9, 0), glow(0x60e0ff, 2.2), 0, 0, 0, 0, 0, 0, 1, 1.6, 1);
  P(rotor, gCyl(1.4, 1.4, 0.12, 12), M.joint, 0, -1.0, 0);
  const back = new THREE.Group();
  back.position.y = 7.2;
  torso.add(back);
  finish(root, scale);
  return rigOf(root, torso, M, { back, type: 'pylon', height: 8 * scale, rotor });
}
// 多足要塞的膝關節致動器（弱點）：裝甲球＋發光環
function buildJoint(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.1;
  root.add(torso);
  P(torso, gSph(1.15, 10), M.sub, 0, 0, 0);
  P(torso, gCyl(1.3, 1.3, 0.3, 12), glow(0xff8a2a, 1.8), 0, 0, 0, Math.PI / 2);
  for (const s of [-1, 1]) CB(torso, 0.4, 1.6, 1.6, M.acc, s * 0.95, 0, 0, 0, 0, 0, 0.08);
  finish(root, scale);
  return rigOf(root, torso, M, { type: 'joint', height: 2.2 * scale });
}

const BUILDERS = {
  worm: buildWormHead,
  spider: buildSpider,
  fortress: buildFortress,
  bunker: buildBunker,
  cannon: buildCannon,
  fturret: buildFTurret,
  engine: buildEngine,
  pylon: buildPylon,
  joint: buildJoint,
};
export const BOSS_MODEL_KEYS = Object.keys(BUILDERS);
export function buildBossModel(key, pal, scale = 1) {
  return (BUILDERS[key] || buildJoint)(pal, scale);
}
