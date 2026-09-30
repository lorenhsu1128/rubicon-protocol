// 非機甲敵人模型：地面載具、直升機、無人機
import { CB, OUTLINE_MAT, P, bakeAll, decal, gBox, gCyl, kitBolts, kitVents } from './geometry.js';
import { mechMats } from './materials.js';

export function buildVehicle(pal, scale = 1) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
  CB(legsG, 2.4, 1.0, 3.6, M.main2, 0, 1.0, 0, 0, 0, 0, 0.12);
  CB(legsG, 2.0, 0.4, 2.6, M.main, 0, 1.6, 0.2, 0, 0, 0, 0.08);
  for (let i = 0; i < 5; i++)
    P(legsG, gBox(0.22, 0.12, 0.06), i % 2 ? M.acc : M.joint, -0.9 + i * 0.45, 1.2, -1.84);
  for (const s of [-1, 1]) {
    CB(legsG, 0.8, 0.9, 4.0, M.joint, s * 1.6, 0.5, 0, 0, 0, 0, 0.12);
    for (let i = -2; i <= 2; i++)
      P(legsG, gCyl(0.34, 0.34, 0.9, 10), M.sub, s * 1.6, 0.45, i * 0.85, 0, 0, Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      P(legsG, gBox(0.9, 0.08, 0.16), M.rubber, s * 1.6, 0.06, -1.9 + i * 0.34);
      P(legsG, gBox(0.9, 0.08, 0.16), M.rubber, s * 1.6, 0.96, -1.9 + i * 0.34);
    }
    P(legsG, gBox(0.9, 0.08, 4.2), M.acc, s * 1.6, 1.03, 0);
    decal(legsG, 2, 0.6, 0.6, s * 2.01, 0.5, 0.6, 0, (s * Math.PI) / 2, 0);
  }
  decal(legsG, 1, 0.6, 0.6, 0, 1.1, -1.85, 0, Math.PI, 0);
  kitBolts(legsG, M, [
    [0.8, 1.5, -1.3, 0],
    [-0.8, 1.5, -1.3, 0],
  ]);
  torso.position.y = 1.8;
  CB(torso, 1.5, 0.9, 1.6, M.main, 0, 0.45, 0, 0, 0, 0, 0.1);
  P(torso, gBox(1.0, 0.06, 0.03), M.acc, 0, 0.55, -0.82);
  for (let i = 0; i < 2; i++)
    P(torso, gCyl(0.06, 0.06, 0.04, 8), red, -0.2 + i * 0.4, 0.35, -0.82, Math.PI / 2);
  const hand = new THREE.Group();
  hand.position.set(0, 0.45, -0.8);
  torso.add(hand);
  CB(hand, 0.4, 0.4, 2.4, M.gun, 0, 0, -1.2, 0, 0, 0, 0.05);
  CB(hand, 0.5, 0.5, 0.4, M.sub, 0, 0, -2.4, 0, 0, 0, 0.04);
  const back = new THREE.Group();
  back.position.set(0.7, 0.95, 0.2);
  torso.add(back);
  CB(back, 0.36, 0.3, 0.9, M.gun, 0, 0, 0, 0, 0, 0, 0.04);
  P(back, gCyl(0.06, 0.06, 0.9, 6), M.sub, 0, 0.05, -0.8, Math.PI / 2);
  P(torso, gCyl(0.02, 0.02, 1.2, 4), M.joint, -0.6, 1.4, 0.4);
  decal(torso, 3, 0.4, 0.4, 0.76, 0.45, 0.2, 0, Math.PI / 2, 0);
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  return {
    group: root,
    legsG,
    torso,
    head: torso,
    arms,
    legs: [],
    nozzles: [],
    hipY: 1.8,
    type: 'tank',
    cls: 'vehicle',
    vehicle: true,
    height: 3.0 * scale,
    coreH: 1.0,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
  };
}
export function buildHeli(pal, scale = 1) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  torso.position.y = 1.2;
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
  CB(torso, 1.6, 1.3, 2.6, M.main2, 0, 0.65, 0.4, 0, 0, 0, 0.14);
  CB(torso, 1.2, 1.0, 1.2, M.main, 0, 0.6, -1.4, 0, 0, 0, 0.12);
  const glass = new THREE.Mesh(gBox(0.9, 0.36, 0.1), M.lens);
  glass.position.set(0, 0.85, -2.02);
  torso.add(glass);
  P(torso, gBox(0.7, 0.08, 0.04), red, 0, 0.55, -2.03);
  CB(torso, 0.5, 0.5, 3.6, M.main2, 0, 0.95, 3.2, 0, 0, 0, 0.06);
  CB(torso, 0.1, 1.1, 0.9, M.main, 0, 1.7, 4.9, 0, 0, 0, 0.02);
  const tail = new THREE.Group();
  tail.position.set(0.35, 1.7, 5.0);
  torso.add(tail);
  for (let i = 0; i < 2; i++) P(tail, gBox(0.06, 1.2, 0.14), M.sub, 0, 0, 0, (i * Math.PI) / 2);
  for (const s of [-1, 1]) {
    CB(torso, 1.2, 0.2, 0.7, M.main, s * 1.4, 0.6, 0.2, 0, 0, 0, 0.04);
    CB(torso, 0.6, 0.6, 1.4, M.gun, s * 2.2, 0.45, 0.2, 0, 0, 0, 0.06);
    for (let i = 0; i < 4; i++)
      P(
        torso,
        gCyl(0.08, 0.08, 0.06, 8),
        red,
        s * 2.2 + (i % 2 ? 0.15 : -0.15),
        0.45 + (i < 2 ? 0.15 : -0.15),
        -0.52,
        Math.PI / 2,
      );
    CB(torso, 0.12, 0.12, 3.0, M.joint, s * 1.0, -0.35, 0.2, 0, 0, 0, 0.02);
    P(torso, gCyl(0.05, 0.05, 0.7, 6), M.joint, s * 1.0, 0.0, 0.2, 0, 0, 0.3 * s);
    decal(torso, 1, 0.5, 0.5, s * 0.81, 0.7, 0.6, 0, (s * Math.PI) / 2, 0);
  }
  const hand = new THREE.Group();
  hand.position.set(0, -0.05, -2.2);
  torso.add(hand);
  CB(hand, 0.4, 0.36, 0.7, M.gun, 0, 0, 0, 0, 0, 0, 0.04);
  for (let i = 0; i < 3; i++)
    P(
      hand,
      gCyl(0.05, 0.05, 0.9, 6),
      M.sub,
      Math.cos(i * 2.09) * 0.09,
      Math.sin(i * 2.09) * 0.09,
      -0.7,
      Math.PI / 2,
    );
  const back = new THREE.Group();
  back.position.set(0, 0.45, -0.5);
  torso.add(back);
  P(torso, gCyl(0.25, 0.3, 0.5, 8), M.joint, 0, 1.45, 0.4);
  CB(torso, 1.0, 0.3, 1.2, M.sub, 0, 1.35, 0.8, 0, 0, 0, 0.04);
  kitVents(torso, M, 0.7, 1.25, 1.0, 4, 0.3, 0, 0.07);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.72, 0.4);
  torso.add(rotor);
  for (let i = 0; i < 4; i++)
    P(
      rotor,
      gBox(0.28, 0.06, 4.4),
      M.sub,
      Math.cos((i * Math.PI) / 2) * 2.2,
      0,
      Math.sin((i * Math.PI) / 2) * 2.2,
      0,
      (-i * Math.PI) / 2 + Math.PI / 2,
    );
  P(rotor, gCyl(0.28, 0.28, 0.16, 8), M.joint, 0, 0, 0);
  bakeAll(root);
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  return {
    group: root,
    legsG,
    torso,
    head: torso,
    arms,
    legs: [],
    nozzles: [],
    rotor,
    tail,
    hipY: 1.2,
    type: 'heli',
    cls: 'heli',
    vehicle: true,
    height: 2.9 * scale,
    coreH: 1.3,
    mats: [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun],
    flashT: 0,
  };
}
export function buildDrone(pal, scale = 1) {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  torso.position.y = 0.6;
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.4 });
  CB(torso, 0.6, 0.5, 1.0, M.main, 0, 0, 0, 0, 0, 0, 0.08);
  CB(torso, 0.3, 0.3, 0.4, red, 0, 0, -0.65, 0, 0, 0, 0.03);
  for (let i = 0; i < 4; i++)
    P(
      torso,
      gBox(0.5, 0.06, 0.5),
      M.main2,
      Math.cos((i * Math.PI) / 2) * 0.45,
      Math.sin((i * Math.PI) / 2) * 0.35,
      0.3,
      0,
      0,
      (i * Math.PI) / 2 + Math.PI / 2,
    );
  const hand = new THREE.Group();
  hand.position.set(0, 0, -0.8);
  torso.add(hand);
  const back = new THREE.Group();
  torso.add(back);
  const fl = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.8, 8),
    new THREE.MeshBasicMaterial({
      color: pal.glow || 0xffb060,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  fl.position.set(0, 0, 0.9);
  fl.rotation.x = -Math.PI / 2;
  torso.add(fl);
  bakeAll(root);
  root.scale.setScalar(scale);
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  return {
    group: root,
    legsG,
    torso,
    head: torso,
    arms,
    legs: [],
    nozzles: [fl],
    hipY: 0.6,
    type: 'drone',
    cls: 'drone',
    vehicle: true,
    height: 1.1 * scale,
    coreH: 0.5,
    mats: [M.main, M.main2, M.acc],
    flashT: 0,
  };
}
