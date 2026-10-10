// 新 Boss 與附屬部位的程式模型（鑽地蟲、多足要塞、空中要塞、砲兵指揮所；砲台、懸吊砲塔、引擎、護盾發生器、腳部關節）
// 介面和載具模型相同（vehicle: true，animateMech 只處理閃光與噴嘴），另外：
//   mounts：附屬部位掛載的節點（部位實體每格移到這個節點的世界位置）
//   body：多足要塞的機身群組（倒下時降低）、legNodes：多足要塞的 6 條腿
// 這些模型目前不接受 GLB（模型庫只預覽）。
import { CB, P, bakeAll, gBox, gCyl, gSph, kitVents } from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';
import { FOE_BUILDERS } from './foe-models.js';

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
    ...(o.extra || {}), // 各 Boss 自己會動的節點（mech-boss2.js 的 boss2Fx 使用）
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

// ---------- 第三批 Boss ----------
// 履帶底座（推土要塞、熔爐、電磁砲台共用）：左右兩條履帶＋輪
function crawler(g, M, w, l, h = 1.6) {
  for (const s of [-1, 1]) {
    CB(g, 1.4, h, l, M.joint, s * (w / 2 - 0.7), h / 2, 0, 0, 0, 0, 0.12);
    CB(g, 1.46, 0.2, l + 0.1, M.main2, s * (w / 2 - 0.7), h - 0.05, 0, 0, 0, 0, 0.04);
    const n = Math.max(3, Math.round(l / 2.2));
    for (let i = 0; i < n; i++)
      P(
        g,
        gCyl(h * 0.36, h * 0.36, 1.5, 10),
        M.acc,
        s * (w / 2 - 0.7),
        h * 0.42,
        -l / 2 + 1 + (i * (l - 2)) / (n - 1),
        0,
        0,
        Math.PI / 2,
      );
  }
}
// 超長程電磁砲台：履帶底座＋旋轉砲塔，兩條長導軌夾著線圈；散熱片（fins）在發射後打開。原點在地面
function buildRailgun(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  crawler(legsG, M, 8, 9, 1.6);
  CB(legsG, 6, 1.2, 8, M.main2, 0, 2.1, 0, 0, 0, 0, 0.2);
  const torso = new THREE.Group();
  torso.position.y = 2.7;
  root.add(torso);
  CB(torso, 5, 2.4, 6, M.main, 0, 1.2, 0.6, 0, 0, 0, 0.3);
  CB(torso, 3.4, 1.2, 4, M.main3, 0, 2.8, 1.2, 0, 0, 0, 0.2);
  P(torso, gBox(2.8, 0.2, 0.1), glow(0xff3a2a, 1.4), 0, 2.2, -2.45);
  const barrel = new THREE.Group();
  barrel.position.set(0, 1.6, -2.2);
  torso.add(barrel);
  for (const s of [-1, 1]) {
    CB(barrel, 0.5, 0.9, 13, M.gun, s * 0.65, 0, -6.5, 0, 0, 0, 0.08);
    P(barrel, gBox(0.08, 0.5, 12), glow(0x7fd8ff, 1.2), s * 0.36, 0, -6.8);
  }
  for (let i = 0; i < 6; i++) P(barrel, gCyl(1.05, 1.05, 0.35, 12), M.sub, 0, 0, -1.5 - i * 2, Math.PI / 2);
  CB(barrel, 2.2, 1.6, 2.4, M.main2, 0, 0, -0.6, 0, 0, 0, 0.12);
  const back = new THREE.Group(); // 砲口
  back.position.set(0, 0, -13.2);
  barrel.add(back);
  // 散熱片：左右各 3 片，打開時往外翻
  const fins = [];
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const f = new THREE.Group();
      f.position.set(s * 2.5, 1.0 + i * 0.7, 1.6);
      torso.add(f);
      CB(f, 0.12, 0.55, 3.4, M.sub, s * 0.06, 0, 0, 0, 0, 0, 0.02);
      P(f, gBox(0.04, 0.3, 3.0), glow(0xff8a2a, 1.6), s * 0.14, 0, 0);
      f.userData.side = s;
      fins.push(f);
    }
  // 近防機砲
  const hand = new THREE.Group();
  hand.position.set(1.8, 3.6, -1.2);
  torso.add(hand);
  CB(hand, 0.8, 0.6, 0.8, M.gun, 0, 0, 0.3, 0, 0, 0, 0.05);
  P(hand, gCyl(0.08, 0.08, 1.2, 6), M.sub, 0, 0, -0.4, Math.PI / 2);
  finish(root, scale);
  return rigOf(root, torso, M, {
    hand,
    back,
    legsG,
    type: 'railgun',
    height: 6 * scale,
    extra: { barrel, fins },
  });
}
// 浮游砲：尖錐形的小型無人砲台，尾端三片翼，前端發光砲口
function buildBit(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 0.7;
  root.add(torso);
  P(torso, gCyl(0.02, 0.42, 1.8, 6), M.main, 0, 0, -0.2, -Math.PI / 2);
  P(torso, gCyl(0.42, 0.3, 0.5, 6), M.main2, 0, 0, 0.9, Math.PI / 2);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    CB(torso, 0.06, 0.7, 0.6, M.acc, Math.cos(a) * 0.4, Math.sin(a) * 0.4, 0.8, 0, 0, a + Math.PI / 2, 0.02);
  }
  P(torso, gSph(0.16, 8), glow(0xffd070, 2.2), 0, 0, -1.1);
  P(torso, gCyl(0.22, 0.22, 0.1, 10), glow(0x60d0ff, 1.6), 0, 0, 1.18, Math.PI / 2);
  const hand = new THREE.Group();
  hand.position.set(0, 0, -1.2);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'bit', height: 1.4 * scale });
}
// 武裝列車：機車頭（正面 −Z）與車廂（car_aa 防空、car_ms 飛彈、car_lz 雷射舷砲、car_mine 布雷）。原點在軌道面
function trainBase(g, M, len) {
  CB(g, 3.0, 0.5, len, M.joint, 0, 0.75, 0, 0, 0, 0, 0.06);
  for (const z of [-len / 2 + 1.4, len / 2 - 1.4])
    for (const s of [-1, 1]) P(g, gCyl(0.5, 0.5, 0.3, 12), M.acc, s * 1.15, 0.5, z, 0, 0, Math.PI / 2);
}
function buildLoco(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  trainBase(torso, M, 9);
  CB(torso, 3.2, 2.6, 6.4, M.main, 0, 2.3, 0.8, 0, 0, 0, 0.3);
  CB(torso, 3.0, 1.6, 2.6, M.main3, 0, 3.0, 3.0, 0, 0, 0, 0.2); // 駕駛室
  P(torso, gBox(2.6, 0.4, 0.06), glow(0xffc060, 1.2), 0, 3.3, 1.67);
  CB(torso, 3.4, 1.4, 1.2, M.sub, 0, 1.2, -4.6, -0.5, 0, 0, 0.1); // 排障器
  for (const s of [-1, 1])
    P(torso, gCyl(0.22, 0.22, 0.1, 10), glow(0xfff0c0, 2.4), s * 1.0, 2.6, -2.45, Math.PI / 2);
  P(torso, gCyl(0.35, 0.45, 1.4, 8), M.sub, 0, 4.0, -1.2); // 煙囪
  kitVents(torso, M, 1.62, 3.0, -0.4, 5, 0.5, Math.PI / 2, 0.12);
  kitVents(torso, M, -1.62, 3.0, -0.4, 5, 0.5, Math.PI / 2, 0.12);
  const boiler = glow(0xff6a20, 0.4); // 衝撞後過熱時變亮
  P(torso, gBox(0.08, 1.2, 4.6), boiler, 1.62, 2.1, 0.8);
  P(torso, gBox(0.08, 1.2, 4.6), boiler, -1.62, 2.1, 0.8);
  const hand = new THREE.Group();
  hand.position.set(0, 3.9, -2.4);
  torso.add(hand);
  CB(hand, 0.8, 0.5, 1.0, M.gun, 0, 0, 0.3, 0, 0, 0, 0.05);
  P(hand, gCyl(0.07, 0.07, 1.4, 6), M.sub, 0, 0, -0.5, Math.PI / 2);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'loco', height: 4.6 * scale, extra: { boiler } });
}
function buildCar(kind) {
  return (pal, scale) => {
    const M = mechMats(pal);
    const root = new THREE.Group();
    const legsG = new THREE.Group();
    root.add(legsG);
    trainBase(legsG, M, 8.6);
    CB(legsG, 3.1, 1.0, 8.2, M.main2, 0, 1.5, 0, 0, 0, 0, 0.1);
    const torso = new THREE.Group();
    torso.position.y = 2.0;
    root.add(torso);
    const hand = new THREE.Group(),
      back = new THREE.Group();
    torso.add(hand, back);
    const extra = {};
    if (kind === 'car_aa') {
      // 雙聯防空砲塔（torso 轉向目標）
      P(torso, gCyl(1.3, 1.5, 0.6, 10), M.main, 0, 0.3, 0);
      CB(torso, 1.8, 1.0, 1.8, M.main3, 0, 1.0, 0, 0, 0, 0, 0.1);
      for (const s of [-1, 1])
        P(torso, gCyl(0.1, 0.12, 2.4, 6), M.gun, s * 0.4, 1.4, -1.4, Math.PI / 2 - 0.5);
      hand.position.set(0, 2.0, -2.4);
      back.position.set(0, 2.0, -2.4);
    } else if (kind === 'car_ms') {
      // 飛彈發射箱
      CB(torso, 2.4, 1.4, 4.6, M.main, 0, 0.7, 0, 0, 0, 0, 0.12);
      for (let i = 0; i < 4; i++)
        for (let j = 0; j < 2; j++)
          P(torso, gCyl(0.22, 0.22, 0.1, 8), M.sub, -0.75 + i * 0.5, 1.42, -1 + j * 2);
      back.position.set(0, 1.6, 0);
    } else if (kind === 'car_lz') {
      // 兩側的雷射舷砲（大鏡片）
      CB(torso, 2.6, 1.8, 6, M.main, 0, 0.9, 0, 0, 0, 0, 0.15);
      const lens = glow(0xff4a8a, 1.2);
      for (const s of [-1, 1])
        for (const z of [-1.6, 1.6]) {
          P(torso, gCyl(0.55, 0.55, 0.3, 12), M.joint, s * 1.35, 1.0, z, 0, 0, Math.PI / 2);
          P(torso, gCyl(0.4, 0.4, 0.06, 12), lens, s * 1.52, 1.0, z, 0, 0, Math.PI / 2);
        }
      hand.position.set(0, 1.0, 0);
      extra.lens = lens;
    } else {
      // 布雷：漏斗＋尾端的投放槽
      P(torso, gCyl(1.4, 0.6, 1.8, 8), M.main, 0, 0.9, 0.8);
      CB(torso, 1.2, 0.6, 1.4, M.sub, 0, 0.1, 3.6, 0.3, 0, 0, 0.06);
      for (let i = 0; i < 3; i++) P(torso, gCyl(0.3, 0.3, 0.2, 10), M.acc, 0, 1.9, -1.6 + i * 0.5);
      back.position.set(0, 0, 4.2);
    }
    P(torso, gBox(1.6, 0.12, 0.06), glow(0xff3a2a, 1.4), 0, 0.2, -4.2);
    finish(root, scale);
    return rigOf(root, torso, M, { hand, back, legsG, type: kind, height: 4 * scale, extra });
  };
}
// 熔爐清掃機：寬大的履帶車，正面是熔爐口（左右兩片顎門 jaws，打開時露出發光的熔爐），頂上煙囪
function buildFurnace(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  crawler(torso, M, 9, 10, 1.8);
  CB(torso, 7.4, 3.2, 9, M.main, 0, 3.4, 0.4, 0, 0, 0, 0.4);
  CB(torso, 5.2, 1.4, 5.5, M.main2, 0, 5.6, 1.4, 0, 0, 0, 0.25);
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.6, 0.75, 3, 8), M.sub, s * 1.8, 7.4, 2.8);
    P(torso, gCyl(0.66, 0.66, 0.3, 8), M.acc, s * 1.8, 8.9, 2.8);
    for (let i = 0; i < 5; i++)
      P(torso, gBox(0.5, 0.5, 0.12), M.acc, s * 3.72, 2.4 + i * 0.6, -1.6, 0, 0, 0.6); // 警示條紋
  }
  // 熔爐（內部發光）
  const core = glow(0xff6a10, 1.0);
  P(torso, gSph(1.6, 12), core, 0, 3.2, -4.0);
  P(torso, gCyl(2.0, 2.0, 0.6, 14), M.joint, 0, 3.2, -4.3, Math.PI / 2);
  const jaws = [];
  for (const s of [-1, 1]) {
    const j = new THREE.Group();
    j.position.set(s * 2.4, 3.2, -4.6);
    torso.add(j);
    CB(j, 2.5, 3.4, 0.6, M.main3, -s * 1.2, 0, 0, 0, 0, 0, 0.12);
    for (let i = 0; i < 3; i++) P(j, gBox(0.3, 0.5, 0.5), M.sub, -s * 2.3, -1.2 + i * 1.2, -0.3);
    j.userData.side = s;
    jaws.push(j);
  }
  const back = new THREE.Group(); // 熔渣投射口
  back.position.set(0, 3.4, -5.4);
  const hand = new THREE.Group();
  hand.position.set(0, 3.0, -5.2);
  torso.add(back, hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, type: 'furnace', height: 7 * scale, extra: { jaws, core } });
}
// 衛星砲導引塔：六角底座＋高塔，塔頂旋轉的導引鏡（rotor），冷卻時鏡面變暗
function buildTower(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  P(torso, gCyl(4.2, 5.0, 1.6, 6), M.main2, 0, 0.8, 0);
  P(torso, gCyl(3.0, 3.6, 1.0, 6), M.main, 0, 2.1, 0);
  P(torso, gCyl(1.2, 1.8, 11, 6), M.main, 0, 7.6, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    CB(torso, 0.6, 9, 1.0, M.sub, Math.cos(a) * 1.7, 6.5, Math.sin(a) * 1.7, 0, -a, 0, 0.06);
  }
  for (let i = 0; i < 4; i++) P(torso, gCyl(1.9, 1.9, 0.25, 8), M.acc, 0, 4 + i * 2.4, 0);
  const rotor = new THREE.Group();
  rotor.position.y = 13.6;
  torso.add(rotor);
  const lens = glow(0x9fe8ff, 2.0);
  P(rotor, gCyl(3.2, 0.8, 1.0, 12), M.main3, 0, 0, 0);
  P(rotor, gCyl(2.4, 2.4, 0.1, 16), lens, 0, 0.52, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    CB(rotor, 0.3, 2.2, 0.3, M.sub, Math.cos(a) * 2.6, 1.0, Math.sin(a) * 2.6, 0, 0, 0, 0.04);
  }
  const back = new THREE.Group();
  back.position.y = 14.6;
  const hand = new THREE.Group();
  hand.position.set(0, 4.4, -3.0);
  torso.add(back, hand);
  CB(torso, 1.0, 0.8, 1.2, M.gun, 0, 4.4, -2.8, 0, 0, 0, 0.06);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, rotor, type: 'tower', height: 15 * scale, extra: { lens } });
}
// 高速突擊機：三角翼戰機（正面 −Z），雙垂尾、尾端兩具發光噴口
function buildJet(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.4;
  root.add(torso);
  CB(torso, 1.8, 1.4, 12, M.main, 0, 0, 0, 0, 0, 0, 0.3);
  P(torso, gCyl(0.05, 0.9, 3.4, 8), M.main3, 0, 0, -7.6, -Math.PI / 2);
  CB(torso, 1.0, 0.6, 2.6, M.sub, 0, 0.8, -3.4, 0, 0, 0, 0.2); // 座艙
  P(torso, gBox(0.8, 0.1, 2.0), glow(0xffa040, 0.8), 0, 1.12, -3.4);
  for (const s of [-1, 1]) {
    CB(torso, 6, 0.25, 5, M.main2, s * 3.6, -0.1, 1.8, 0, s * 0.45, 0, 0.06);
    CB(torso, 0.2, 2.2, 2.2, M.main2, s * 0.8, 1.4, 4.8, 0, 0, s * 0.3, 0.04);
    P(torso, gBox(1.4, 0.06, 0.4), glow(0xff4030, 1.2), s * 5.8, 0.05, 3.0);
  }
  const nozzles = [];
  for (const s of [-1, 1]) {
    P(torso, gCyl(0.55, 0.6, 1.0, 10), M.joint, s * 0.5, 0, 6.2, Math.PI / 2);
    const fl = new THREE.Mesh(
      new THREE.ConeGeometry(0.45, 2.6, 10),
      new THREE.MeshBasicMaterial({
        color: 0xffb060,
        transparent: true,
        opacity: 0.7,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    fl.position.set(s * 0.5, 0, 7.8);
    fl.rotation.x = Math.PI / 2;
    torso.add(fl);
    nozzles.push(fl);
  }
  const hand = new THREE.Group();
  hand.position.set(0.6, -0.4, -6.4);
  const back = new THREE.Group();
  back.position.set(0, -0.8, 0);
  torso.add(hand, back);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, back, nozzles, type: 'jet', height: 2.8 * scale });
}
// 衝撞推土要塞：正面大鏟刀、兩側絞碎滾筒（grinders，會轉）、背面散熱口（vents，衝撞失敗後打開）
function buildDozer(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  root.add(torso);
  crawler(torso, M, 9, 11, 2.0);
  CB(torso, 7.2, 3.4, 9.6, M.main, 0, 3.6, 0.6, 0, 0, 0, 0.4);
  CB(torso, 4.6, 1.8, 4.2, M.main3, 0, 6.1, 1.6, 0, 0, 0, 0.25);
  P(torso, gBox(3.6, 0.3, 0.08), glow(0xff3a2a, 1.4), 0, 6.4, -0.52);
  // 鏟刀
  CB(torso, 10.4, 3.8, 0.8, M.sub, 0, 2.2, -6.2, -0.25, 0, 0, 0.12);
  for (let i = 0; i < 7; i++) P(torso, gBox(0.5, 0.8, 0.6), M.acc, -4.5 + i * 1.5, 0.5, -6.6);
  for (const s of [-1, 1]) CB(torso, 0.6, 1.0, 3.6, M.joint, s * 3.2, 2.2, -4.4, 0, 0, 0, 0.06);
  // 絞碎滾筒
  const grinders = [];
  for (const s of [-1, 1]) {
    const gr = new THREE.Group();
    gr.position.set(s * 5.0, 2.4, -0.4);
    torso.add(gr);
    P(gr, gCyl(1.0, 1.0, 6, 10), M.gun, 0, 0, 0, Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(gr, gBox(0.3, 0.4, 6.2), M.acc, Math.cos(a) * 1.05, Math.sin(a) * 1.05, 0, 0, 0, a);
    }
    grinders.push(gr);
  }
  // 背面散熱口：兩片蓋板，打開時往上掀，露出發光的散熱器
  const heat = glow(0xff7a20, 0.3);
  P(torso, gBox(5.4, 2.0, 0.1), heat, 0, 3.8, 5.45);
  const vents = [];
  for (const s of [-1, 1]) {
    const v = new THREE.Group();
    v.position.set(s * 1.4, 4.9, 5.5);
    torso.add(v);
    CB(v, 2.7, 2.2, 0.3, M.main2, 0, -1.1, 0, 0, 0, 0, 0.06);
    vents.push(v);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 6.4, -1.0);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'dozer', height: 7 * scale, extra: { grinders, vents, heat } });
}
// 脈衝刃翼：細長機身＋四片刃翼（wings，會張開），胸口的珊瑚色核心在充能時變亮
function buildIbis(pal, scale) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = 1.6;
  root.add(torso);
  CB(torso, 1.2, 1.6, 3.6, M.main, 0, 0, 0, 0, 0, 0, 0.3);
  P(torso, gCyl(0.05, 0.6, 2.2, 6), M.main3, 0, 0.1, -2.7, -Math.PI / 2);
  CB(torso, 0.8, 0.5, 1.4, M.sub, 0, 0.9, -0.6, 0, 0, 0, 0.12);
  const core = glow(0xff5070, 1.4);
  P(torso, gSph(0.42, 10), core, 0, 0, -1.6);
  P(torso, gCyl(0.3, 0.1, 1.6, 6), M.joint, 0, -0.2, 2.4, Math.PI / 2);
  const wings = [];
  for (const [sx, sy] of [
    [-1, 1],
    [1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const w = new THREE.Group();
    w.position.set(sx * 0.6, sy * 0.3, 0.6);
    torso.add(w);
    CB(w, 4.2, 0.12, 1.1, M.main2, sx * 2.2, 0, 0.2, 0, sx * 0.35, sy * 0.25, 0.03);
    P(w, gBox(3.8, 0.05, 0.16), glow(0xff6080, 1.6), sx * 2.2, 0, -0.38, 0, sx * 0.35, sy * 0.25);
    w.userData.sx = sx;
    w.userData.sy = sy;
    wings.push(w);
  }
  const hand = new THREE.Group();
  hand.position.set(0, 0, -2.0);
  torso.add(hand);
  finish(root, scale);
  return rigOf(root, torso, M, { hand, type: 'ibis', height: 3.2 * scale, extra: { wings, core } });
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
  railgun: buildRailgun,
  bit: buildBit,
  loco: buildLoco,
  car_aa: buildCar('car_aa'),
  car_ms: buildCar('car_ms'),
  car_lz: buildCar('car_lz'),
  car_mine: buildCar('car_mine'),
  furnace: buildFurnace,
  tower: buildTower,
  jet: buildJet,
  dozer: buildDozer,
  ibis: buildIbis,
  ...FOE_BUILDERS, // 主題專屬敵人（foe-models.js）
};
export const BOSS_MODEL_KEYS = Object.keys(BUILDERS);
export function buildBossModel(key, pal, scale = 1) {
  return (BUILDERS[key] || buildJoint)(pal, scale);
}
