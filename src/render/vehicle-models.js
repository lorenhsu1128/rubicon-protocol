// 非機甲敵人模型：地面載具、直升機、無人機
// 會動的部位拆成區塊（槽位 vehicle/<key>/<區塊>，原點＝旋轉中心），可以各自換成 GLB：
//   戰車 hull 車身（地面中心）／turret 砲塔含砲管（砲塔旋轉中心）
//   直升機 body 機身（機身傾斜中心）／rotor 主旋翼（旋翼軸心）／tail 尾旋翼（尾旋翼軸心）
//   無人機整塊（vehicle/<key>，機身中心）
import { CB, OUTLINE_MAT, P, bakeAll, decal, fine, gBox, gCyl, gPod, gSph, kitBolts } from './geometry.js';
import { D } from './detail.js';
import { PB, beam, plate, rod, side, slats, top, track } from './foe-models.js';
import { matsOf } from './glb.js';
import { mechMats } from './materials.js';
import { providedModel } from './model-provider.js';
import { tagStyle } from './style/shader.js';
import { vAntenna, vExhaust, vHatch, vJerry, vLamp, vLight, vRotorDisc, vTrack } from './vehicle-kit.js';

const HP2 = Math.PI / 2;
// 載具的頂點色烘焙（render/detail.js）：遮蔽與貼地的髒污比預設強一點
const VEH_TINT = { ao: 0.85, grime: 0.32, gh: 1.1 };
export const VEHICLE_PIECES = {
  tank: ['hull', 'turret'],
  heli: ['body', 'rotor', 'tail'],
};
export const VEHICLE_PIECE_NAMES = {
  hull: '車身',
  turret: '砲塔（含砲管）',
  body: '機身',
  rotor: '主旋翼',
  tail: '尾旋翼',
};
export const VEHICLE_PIECE_ORIGIN = {
  hull: '地面中心（車身底面中心）',
  turret: '砲塔旋轉中心（砲塔底面中心，離地 1.8 m）',
  body: '機身傾斜中心（離地 1.2 m）',
  rotor: '主旋翼軸心',
  tail: '尾旋翼軸心',
  drone: '機身中心（離地 0.6 m）',
};
// 區塊有 GLB 時：清掉這些節點上的程式網格（keep 除外），把 GLB 掛在第一個節點上
function swapPiece(slot, pal, nodes, mats, keep = []) {
  const obj = providedModel(slot, pal, true);
  if (!obj) return null;
  for (const n of nodes) {
    n.userData.prims = null;
    for (const c of [...n.children]) if (c.isMesh && !keep.includes(c)) n.remove(c);
  }
  nodes[0].add(obj);
  mats.push(...matsOf(obj));
  return obj;
}

export function buildVehicle(pal, scale = 1, key = 'tank') {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const hull = new THREE.Group(); // 車身（懸吊：依加減速前後傾與起伏，rig.susp）；履帶與車輪留在 legsG
  legsG.add(hull);
  const torso = new THREE.Group();
  root.add(torso);
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
  // ===== 車身：上下兩道斜板的楔形車體＋引擎甲板 =====
  side(
    hull,
    M.main2,
    [
      [-2.0, 0.95],
      [-1.6, 0.5],
      [1.75, 0.5],
      [1.95, 0.85],
      [1.9, 1.5],
      [1.3, 1.62],
      [-0.9, 1.62],
    ],
    2.4,
    0,
    0.08,
  );
  // 砲塔座圈、引擎甲板的格柵、後面的排氣柵
  P(hull, gCyl(0.88, 0.92, 0.18, 12), M.main, 0, 1.71, 0.1);
  CB(hull, 1.8, 0.1, 0.9, M.main, 0, 1.64, 1.35, 0, 0, 0, 0.03);
  for (let i = 0; i < 5; i++) P(hull, gBox(1.5, 0.04, 0.07), M.joint, 0, 1.7, 1.03 + i * 0.16);
  slats(hull, M.joint, 0, 1.38, 1.94, 1.6, 4, 0.12);
  // 正面：頭燈、拖鉤、備用履帶片
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xfff2d0,
    emissive: 0xffd890,
    emissiveIntensity: 0.9,
  });
  for (const s of [-1, 1]) {
    vLight(hull, M, lamp, s * 0.85, 1.16, -1.8, 0.1);
    // 拖鉤：底座＋鉤環
    P(hull, gBox(0.18, 0.18, 0.2), M.joint, s * 0.6, 0.64, -1.8);
    fine(() => P(hull, D.cyl(0.07, 0.07, 0.05, 10), M.gun, s * 0.6, 0.64, -1.93, HP2));
  }
  for (let i = 0; i < 4; i++) P(hull, gBox(0.32, 0.05, 0.2), M.rubber, -0.5 + i * 0.34, 1.48, -1.17, -0.55);
  decal(hull, 1, 0.5, 0.5, 0.75, 1.19, -1.626, 1.02, Math.PI, 0);
  // ===== 履帶：負重輪、驅動輪、側裙、擋泥板、收納箱 =====
  const wheels = [],
    treads = [],
    skirts = [];
  for (const s of [-1, 1]) {
    const T = vTrack(legsG, M, s * 1.6, 0, 4.1, 1.0, 0.8, 5);
    wheels.push(...T.wheels);
    treads.push(T.mat.map);
    // 側裙（獨立的群組：AP 低時脫落，rig.dmg.plates）
    const sk = new THREE.Group();
    hull.add(sk);
    skirts.push(sk);
    side(
      sk,
      M.main3,
      [
        [-2.12, 1.0],
        [-1.95, 0.62],
        [1.95, 0.62],
        [2.08, 0.78],
        [2.08, 1.1],
        [-2.0, 1.1],
      ],
      0.07,
      s * 2.04,
      0.02,
    );
    // 側裙的接縫與螺栓
    fine(() => {
      for (let i = 0; i < 7; i++) {
        const z = -1.8 + i * 0.6;
        P(sk, gBox(0.02, 0.44, 0.035), M.joint, s * 2.085, 0.86, z);
        for (const y of [0.7, 1.02])
          P(sk, gCyl(0.025, 0.025, 0.02, 6), M.joint, s * 2.09, y, z + 0.06, 0, 0, HP2);
      }
    });
    top(
      hull,
      M.main2,
      [
        [s * 1.18, -2.0],
        [s * 2.07, -2.0],
        [s * 2.07, 2.05],
        [s * 1.18, 2.05],
      ],
      0.05,
      1.12,
    );
    P(hull, gBox(0.06, 0.06, 3.9), M.acc, s * 2.08, 1.05, 0);
    CB(hull, 0.6, 0.28, 0.9, M.sub, s * 1.62, 1.28, 1.2, 0, 0, 0, 0.04);
    decal(hull, 2, 0.6, 0.3, s * 2.085, 0.86, 0.9, 0, (s * Math.PI) / 2, 0);
  }
  kitBolts(hull, M, [
    [0.8, 1.5, -1.3, 0],
    [-0.8, 1.5, -1.3, 0],
  ]);
  // ===== 砲塔：前窄後寬的楔形＋防盾＋附加裝甲＋車長塔 =====
  torso.position.y = 1.8;
  P(
    torso,
    gPod([
      [-0.95, 1.1, 0.05, 0.62, 0.18, 0.08],
      [-0.6, 1.55, 0, 0.85, 0.18, 0.08],
      [0.55, 1.6, 0, 0.85, 0.14, 0.06],
      [0.95, 1.4, 0.04, 0.78, 0.12, 0.06],
    ]),
    M.main,
  );
  CB(torso, 0.62, 0.48, 0.3, M.main2, 0, 0.45, -0.98, 0, 0, 0, 0.06);
  CB(torso, 1.2, 0.5, 0.5, M.main2, 0, 0.5, 1.1, 0, 0, 0, 0.05);
  P(torso, gBox(1.0, 0.06, 0.03), M.acc, 0, 0.55, 1.36);
  for (const s of [-1, 1]) {
    side(
      torso,
      M.main2,
      [
        [-0.75, 0.15],
        [0.5, 0.15],
        [0.6, 0.7],
        [-0.45, 0.72],
      ],
      0.08,
      s * 0.83,
      0.02,
    );
    // 煙幕彈發射器
    for (let i = 0; i < 3; i++)
      P(torso, gCyl(0.05, 0.05, 0.22, 6), M.joint, s * (0.6 - i * 0.1), 0.78, -0.62, -0.6, 0, -s * 0.3);
    // 紅色感測燈
    P(torso, gCyl(0.06, 0.06, 0.04, 8), red, s * 0.42, 0.35, -0.96, Math.PI / 2);
  }
  decal(torso, 3, 0.4, 0.4, 0.88, 0.42, -0.1, 0, Math.PI / 2, 0);
  // 車長塔＋觀測窗、砲手瞄準鏡
  P(torso, gCyl(0.24, 0.27, 0.18, 8), M.sub, -0.35, 0.93, 0.2);
  P(torso, gCyl(0.21, 0.21, 0.04, 8), M.joint, -0.35, 1.04, 0.2);
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (i - 1) * 0.7;
    P(
      torso,
      gBox(0.1, 0.06, 0.04),
      M.lens,
      -0.35 + Math.cos(a) * 0.25,
      0.95,
      0.2 + Math.sin(a) * 0.25,
      0,
      -a + Math.PI / 2,
    );
  }
  CB(torso, 0.3, 0.25, 0.32, M.sub, 0.45, 0.92, -0.4, 0, 0, 0, 0.03);
  P(torso, gBox(0.2, 0.12, 0.04), M.lens, 0.45, 0.94, -0.57);
  P(torso, gCyl(0.05, 0.05, 0.08, 6), M.joint, -0.6, 0.86, 0.4);
  P(torso, gCyl(0.02, 0.02, 1.2, 4), M.joint, -0.6, 1.4, 0.4);
  // 砲管：套筒＋砲身（前細）＋抽煙器＋砲口制退器
  const hand = new THREE.Group();
  hand.position.set(0, 0.45, -0.8);
  torso.add(hand);
  P(hand, gCyl(0.2, 0.2, 0.55, 10), M.gun, 0, 0, -0.35, Math.PI / 2);
  P(hand, gCyl(0.12, 0.15, 2.0, 10), M.gun, 0, 0, -1.3, -Math.PI / 2);
  P(hand, gCyl(0.18, 0.18, 0.4, 10), M.sub, 0, 0, -1.35, Math.PI / 2);
  CB(hand, 0.42, 0.3, 0.45, M.sub, 0, 0, -2.4, 0, 0, 0, 0.04);
  for (const z of [-2.32, -2.5]) P(hand, gBox(0.46, 0.08, 0.1), M.joint, 0, 0, z);
  // 砲塔頂的飛彈發射器（back）
  const back = new THREE.Group();
  back.position.set(0.7, 0.95, 0.2);
  torso.add(back);
  CB(back, 0.36, 0.3, 0.9, M.gun, 0, 0, 0, 0, 0, 0, 0.04);
  for (const x of [-0.08, 0.08]) P(back, gCyl(0.06, 0.06, 0.04, 8), M.joint, x, -0.05, -0.45, Math.PI / 2);
  P(back, gCyl(0.06, 0.06, 0.9, 6), M.sub, 0, 0.05, -0.8, Math.PI / 2);
  P(back, gBox(0.1, 0.1, 0.3), M.joint, 0, -0.18, 0.2);
  const tankDmg = tankDetail(hull, torso, M, red, lamp);
  tankDmg.plates.push(skirts[0]);
  const mats = [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun];
  swapPiece(`vehicle/${key}/hull`, pal, [legsG, hull, ...wheels.map((w) => w.o)], mats);
  swapPiece(`vehicle/${key}/turret`, pal, [torso, hand, back], mats);
  bakeAll(root, { tint: VEH_TINT, cache: 'veh:' + key });
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  tagStyle(root);
  const rig = {
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
    wheels,
    treads,
    susp: hull,
    dmg: tankDmg,
    vehicle: true,
    height: 3.0 * scale,
    coreH: 1.0,
    mats,
    flashT: 0,
  };
  // 脫落零件前還原合併的網格（MechEntity.mergeModel 的 mergeRig）
  tankDmg.unmerge = () => rig.unmerge && rig.unmerge();
  tankDmg.remerge = () => rig.remerge && rig.remerge();
  return rig;
}
export function buildHeli(pal, scale = 1, key = 'heli') {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  torso.position.y = 1.2;
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.2 });
  // ===== 機身：機首到機艙的放樣＋往後收細的尾桁 =====
  P(
    torso,
    gPod([
      [-2.15, 0.5, 0.25, 0.7, 0.12, 0.12],
      [-1.65, 1.1, 0.0, 1.0, 0.28, 0.22],
      [-0.6, 1.5, -0.05, 1.3, 0.35, 0.28],
      [0.9, 1.6, 0.0, 1.35, 0.35, 0.28],
      [1.7, 1.1, 0.4, 1.25, 0.25, 0.15],
    ]),
    M.main2,
  );
  P(
    torso,
    gPod([
      [1.6, 0.6, 0.65, 1.25, 0.12, 0.12],
      [5.0, 0.3, 0.82, 1.08, 0.06, 0.06],
    ]),
    M.main2,
  );
  // 縱列座艙的玻璃與框
  P(
    torso,
    gPod([
      [-1.65, 0.6, 0.85, 1.05, 0.1, 0],
      [-1.2, 0.95, 0.95, 1.4, 0.3, 0],
      [-0.35, 0.95, 1.1, 1.55, 0.3, 0],
      [0.15, 0.7, 1.2, 1.48, 0.2, 0],
    ]),
    M.lens,
  );
  beam(torso, M.joint, [0, 1.05, -1.65], [0, 1.42, -1.2], 0.05, 0.05, 0.01);
  beam(torso, M.joint, [0, 1.42, -1.2], [0, 1.56, -0.35], 0.05, 0.05, 0.01);
  for (const [z, y, w] of [
    [-1.2, 1.41, 0.62],
    [-0.35, 1.56, 0.62],
  ])
    P(torso, gBox(w, 0.05, 0.05), M.joint, 0, y, z);
  // 機首的感測器與紅色標示燈、機砲座
  P(torso, gSph(0.13, 8), M.lens, 0, 0.32, -2.12);
  P(torso, gBox(0.3, 0.06, 0.04), red, 0, 0.55, -2.15);
  P(torso, gCyl(0.22, 0.22, 0.15, 8), M.joint, 0, 0.14, -2.0);
  // 引擎莢艙：進氣口＋排氣口、旋翼軸與斜盤
  for (const s of [-1, 1]) {
    P(
      torso,
      gPod([
        [-0.1, 0.42, 1.25, 1.62, 0.1, 0.06],
        [1.3, 0.45, 1.25, 1.62, 0.1, 0.06],
        [1.6, 0.32, 1.3, 1.58, 0.06, 0.04],
      ]),
      M.main,
      s * 0.42,
      0,
      0,
    );
    P(torso, gCyl(0.17, 0.17, 0.06, 8), M.joint, s * 0.42, 1.44, -0.12, Math.PI / 2);
    P(torso, gCyl(0.12, 0.15, 0.2, 8), M.gun, s * 0.44, 1.44, 1.7, Math.PI / 2);
    slats(torso, M.joint, s * 0.64, 1.52, 0.6, 0.6, 2, 0.1, Math.PI / 2);
    decal(torso, 1, 0.5, 0.5, s * 0.805, 0.6, 0.6, 0, (s * Math.PI) / 2, 0);
  }
  P(torso, gCyl(0.22, 0.28, 0.4, 8), M.joint, 0, 1.5, 0.4);
  P(torso, gCyl(0.3, 0.3, 0.05, 10), M.sub, 0, 1.62, 0.4);
  // 尾翼：垂直尾翼、水平安定面、尾旋翼的齒輪箱
  side(
    torso,
    M.main,
    [
      [4.55, 1.0],
      [5.15, 1.0],
      [5.35, 2.25],
      [5.0, 2.25],
    ],
    0.1,
    0,
    0.02,
  );
  top(
    torso,
    M.main,
    [
      [-0.8, 4.2],
      [0.8, 4.2],
      [0.7, 4.55],
      [-0.7, 4.55],
    ],
    0.05,
    0.95,
  );
  P(torso, gCyl(0.1, 0.1, 0.3, 6), M.joint, 0.2, 1.7, 5.0, 0, 0, Math.PI / 2);
  const tail = new THREE.Group();
  tail.position.set(0.35, 1.7, 5.0);
  torso.add(tail);
  P(tail, gCyl(0.09, 0.09, 0.14, 6), M.joint, 0, 0, 0, 0, 0, Math.PI / 2);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    P(tail, gBox(0.03, 0.55, 0.12), M.sub, 0, Math.cos(a) * 0.32, Math.sin(a) * 0.32, a);
  }
  // ===== 短翼與火箭莢艙、起落橇 =====
  for (const s of [-1, 1]) {
    top(
      torso,
      M.main,
      [
        [s * 0.7, -0.15],
        [s * 2.0, 0.0],
        [s * 2.0, 0.45],
        [s * 0.7, 0.6],
      ],
      0.14,
      0.62,
    );
    P(torso, gBox(0.12, 0.16, 0.5), M.joint, s * 2.2, 0.66, 0.2);
    P(torso, gCyl(0.3, 0.3, 1.3, 10), M.gun, s * 2.2, 0.42, 0.25, Math.PI / 2);
    P(torso, gCyl(0.22, 0.3, 0.15, 10), M.joint, s * 2.2, 0.42, 0.97, Math.PI / 2);
    P(torso, gCyl(0.31, 0.31, 0.06, 10), M.joint, s * 2.2, 0.42, -0.42, Math.PI / 2);
    for (let i = 0; i < 4; i++)
      P(
        torso,
        gCyl(0.08, 0.08, 0.06, 8),
        red,
        s * 2.2 + (i % 2 ? 0.15 : -0.15),
        0.42 + (i < 2 ? 0.15 : -0.15),
        -0.44,
        Math.PI / 2,
      );
    // 起落橇：前端往上翹的滑管＋兩支彎的支柱
    P(
      torso,
      D.sweep(
        [
          [s * 1.0, -0.36, 1.7],
          [s * 1.0, -0.36, -1.2],
          [s * 1.0, -0.3, -1.45],
          [s * 1.0, -0.16, -1.6],
        ],
        D.ring(0.06, 8),
      ),
      M.joint,
    );
    for (const z of [-0.6, 1.0])
      P(
        torso,
        D.sweep(
          [
            [s * 0.6, 0.08, z],
            [s * 0.9, -0.1, z],
            [s * 1.0, -0.36, z],
          ],
          D.ring(0.05, 8),
        ),
        M.joint,
      );
  }
  // 機砲：球形砲塔＋三管機砲
  const hand = new THREE.Group();
  hand.position.set(0, -0.05, -2.2);
  torso.add(hand);
  P(hand, gSph(0.22, 8), M.gun, 0, 0, 0);
  P(hand, gCyl(0.13, 0.13, 0.35, 8), M.gun, 0, 0, -0.3, Math.PI / 2);
  for (let i = 0; i < 3; i++)
    P(
      hand,
      gCyl(0.05, 0.05, 0.9, 6),
      M.sub,
      Math.cos(i * 2.09) * 0.07,
      Math.sin(i * 2.09) * 0.07,
      -0.7,
      Math.PI / 2,
    );
  P(hand, gCyl(0.14, 0.14, 0.04, 8), M.joint, 0, 0, -1.1, Math.PI / 2);
  const back = new THREE.Group();
  back.position.set(0, 0.45, -0.5);
  torso.add(back);
  // ===== 主旋翼：旋翼轂＋槳夾＋四片葉片 =====
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.72, 0.4);
  torso.add(rotor);
  P(rotor, gCyl(0.28, 0.28, 0.16, 8), M.joint, 0, 0, 0);
  P(rotor, gCyl(0.12, 0.16, 0.18, 8), M.joint, 0, 0.16, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    // 葉片（根部寬、往外收窄、有扭轉）＋槳夾
    P(rotor, D.blade(4.4, 0.34, 0.24, 0.055, 0.22), M.sub, 0, 0, 0, 0, a, 0);
    CB(rotor, 0.4, 0.12, 0.2, M.joint, c * 0.38, 0, -s * 0.38, 0, a, 0, 0.02);
  }
  heliDetail(torso, rotor, M, red);
  // 旋翼的轉動圓盤（半透明）
  const disc = vRotorDisc(4.45);
  disc.position.y = 0.02;
  rotor.add(disc);
  const mats = [M.main, M.main2, M.main3, M.sub, M.acc, M.joint, M.gun];
  swapPiece(`vehicle/${key}/body`, pal, [torso, hand, back], mats);
  swapPiece(`vehicle/${key}/rotor`, pal, [rotor], mats);
  swapPiece(`vehicle/${key}/tail`, pal, [tail], mats);
  bakeAll(root, { tint: VEH_TINT, cache: 'veh:' + key });
  root.scale.setScalar(scale);
  root.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  tagStyle(root);
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
    dmg: {
      smoke: [
        [0, 1.6, 1.2],
        [0.4, 1.5, 1.7],
      ],
    },
    hipY: 1.2,
    type: 'heli',
    cls: 'heli',
    vehicle: true,
    height: 2.9 * scale,
    coreH: 1.3,
    mats,
    flashT: 0,
  };
}
// 無人機的尾翼（區域 X＝往外、Y＝沿機身往後）
const DRONE_FIN = [
  [0.12, -0.08],
  [0.42, 0.12],
  [0.48, 0.36],
  [0.12, 0.36],
];
// 無人機：切角的機身＋前方的感測器＋X 字尾翼＋尾部噴口；key 決定掛載（swarm 機槍、minelayer 佈雷筒、repair 修理臂）
export function buildDrone(pal, scale = 1, key = 'swarm') {
  const M = mechMats(pal);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const torso = new THREE.Group();
  root.add(torso);
  torso.position.y = 0.6;
  const red = new THREE.MeshStandardMaterial({ color: 0xff3a2a, emissive: 0xff2a1a, emissiveIntensity: 1.4 });
  P(
    torso,
    gPod([
      [-0.6, 0.36, -0.16, 0.16, 0.08, 0.08],
      [-0.4, 0.6, -0.25, 0.25, 0.15, 0.15],
      [0.3, 0.62, -0.25, 0.25, 0.15, 0.15],
      [0.55, 0.4, -0.18, 0.18, 0.1, 0.1],
    ]),
    M.main,
  );
  // 側面的裝甲板、背上的天線
  for (const s of [-1, 1])
    side(
      torso,
      M.main2,
      [
        [-0.35, -0.12],
        [0.35, -0.12],
        [0.42, 0.1],
        [-0.25, 0.14],
      ],
      0.04,
      s * 0.31,
      0,
    );
  rod(torso, M.joint, [0.08, 0.24, 0.1], [0.1, 0.5, 0.25], 0.012, 4);
  // 感測器：外框＋紅色的眼
  P(torso, gCyl(0.17, 0.2, 0.16, 6), M.joint, 0, 0, -0.66, Math.PI / 2);
  P(torso, gCyl(0.12, 0.12, 0.05, 6), red, 0, 0, -0.75, Math.PI / 2);
  // X 字尾翼與噴口（無人機數量多：尾翼不倒角）
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    PB(torso, plate(DRONE_FIN, 0.035, 0), M.main2, [0, 0, 0.1], [Math.cos(a), Math.sin(a), 0], [0, 0, 1]);
  }
  P(torso, gCyl(0.14, 0.2, 0.18, 8), M.joint, 0, 0, 0.6, Math.PI / 2);
  if (key === 'minelayer') {
    // 腹部的佈雷筒＋警示條
    P(torso, gCyl(0.16, 0.16, 0.55, 8), M.acc, 0, -0.3, 0.05, Math.PI / 2);
    for (const z of [-0.12, 0.22]) P(torso, gCyl(0.17, 0.17, 0.04, 8), M.joint, 0, -0.3, z, Math.PI / 2);
    P(torso, gCyl(0.1, 0.1, 0.06, 8), red, 0, -0.3, 0.34, Math.PI / 2);
  } else if (key === 'repair') {
    // 兩隻修理臂＋腹部的修理光束發射器
    for (const s of [-1, 1]) {
      beam(torso, M.joint, [s * 0.22, -0.18, -0.2], [s * 0.3, -0.3, -0.55], 0.05, 0.05, 0.01);
      beam(torso, M.sub, [s * 0.3, -0.3, -0.55], [s * 0.18, -0.32, -0.72], 0.04, 0.04, 0.01);
    }
    P(torso, gCyl(0.14, 0.08, 0.08, 8), M.acc, 0, -0.27, -0.1);
  } else {
    // 腹部的雙管機槍
    CB(torso, 0.24, 0.12, 0.3, M.joint, 0, -0.24, -0.25, 0, 0, 0, 0.02);
    for (const s of [-1, 1]) P(torso, gCyl(0.025, 0.025, 0.4, 5), M.sub, s * 0.06, -0.26, -0.55, Math.PI / 2);
  }
  droneDetail(torso, M);
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
  const mats = [M.main, M.main2, M.acc, M.sub, M.joint];
  swapPiece(`vehicle/${key}`, pal, [torso], mats, [fl]); // 尾焰維持程式特效
  bakeAll(root, { tint: VEH_TINT, cache: 'drone:' + key });
  root.scale.setScalar(scale);
  const arms = {
    r: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
    l: { hand, back, sh: new THREE.Group(), up: new THREE.Group(), fore: new THREE.Group() },
  };
  tagStyle(root);
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
    mats,
    flashT: 0,
  };
}

// ---------- 精細零件（三倍高改版：載具跟著機甲放大 3 倍，近看的細節）----------
// 戰車：正面與砲塔的反應裝甲、側裙的接縫、艙蓋與把手、潛望鏡、同軸機槍、遙控武器站、天線、
// 砲塔尾部的置物架與收納箱、拖曳鋼索、排氣、尾燈、油桶、擋泥板
function tankDetail(hull, tur, M, red, lamp) {
  const era = M.main3;
  // 上斜板的反應裝甲（兩排、沿斜板擺放）
  for (const t of [0.16, 0.36])
    for (const x of [-0.54, -0.18, 0.18, 0.54])
      CB(hull, 0.32, 0.07, 0.24, era, x, 0.95 + 0.67 * t + 0.035, -2.0 + 1.1 * t - 0.02, -0.54, 0, 0, 0.015);
  // 駕駛艙蓋與潛望鏡
  vHatch(hull, M, 0.55, 1.62, -0.72, 0.22);
  fine(() => {
    for (const x of [0.3, 0.55, 0.8]) P(hull, D.box(0.12, 0.07, 0.06, 0.01), M.lens, x, 1.66, -0.96);
  });
  // 拖曳鋼索（甲板邊緣下垂）＋鋼索夾
  for (const s of [-1, 1])
    fine(() => {
      P(hull, D.cable([s * 1.12, 1.67, -1.4], [s * 1.12, 1.67, 1.5], 0.025, 0.03, 8), M.rubber);
      for (const z of [-1.2, 0, 1.2]) P(hull, gBox(0.08, 0.05, 0.06), M.joint, s * 1.12, 1.68, z);
    });
  // 後方：排氣格柵、尾燈、拖鉤、油桶、排氣管、擋泥板
  const back = new THREE.Group(); // 後方的收納箱（AP 低時脫落）
  hull.add(back);
  for (const s of [-1, 1]) {
    CB(hull, 0.55, 0.26, 0.12, M.joint, s * 0.72, 1.3, 2.0, 0, 0, 0, 0.02);
    fine(() => {
      for (let i = 0; i < 3; i++) P(hull, gBox(0.5, 0.03, 0.02), M.gun, s * 0.72, 1.22 + i * 0.08, 2.07);
    });
    vLamp(hull, M, red, s * 1.45, 1.42, 2.08, 0.12, 0.07, Math.PI);
    P(hull, gBox(0.14, 0.18, 0.2), M.joint, s * 0.55, 0.62, 2.0);
    for (const k of [0, 1]) vJerry(back, M, M.acc, s * (1.42 + k * 0.24), 1.12, 1.84, HP2);
    vExhaust(hull, M, s * 0.95, 1.55, 1.75, 0.35, 0.06);
    P(hull, gBox(0.85, 0.36, 0.03), M.rubber, s * 1.6, 0.8, 2.12);
  }
  vBoxTank(back, M);
  // 履帶前的擋泥板（橡膠）
  for (const s of [-1, 1]) P(hull, gBox(0.85, 0.32, 0.03), M.rubber, s * 1.6, 0.82, -2.12);
  // 砲塔：正面兩側的反應裝甲
  for (const s of [-1, 1])
    for (let i = 0; i < 2; i++)
      CB(
        tur,
        0.28,
        0.2,
        0.16,
        era,
        s * (0.5 + i * 0.22),
        0.36 + i * 0.03,
        -0.86 + i * 0.12,
        0,
        s * 0.42,
        0,
        0.012,
      );
  // 同軸機槍
  P(tur, D.box(0.1, 0.1, 0.3, 0.015), M.joint, 0.28, 0.42, -1.05);
  fine(() => P(tur, D.cyl(0.025, 0.03, 0.5, 8), M.gun, 0.28, 0.42, -1.4, HP2));
  // 車長塔上的遙控武器站：基座＋槍身＋彈藥箱＋光學鏡
  CB(tur, 0.2, 0.15, 0.3, M.sub, -0.35, 1.17, 0.12, 0, 0, 0, 0.02);
  fine(() => {
    P(tur, D.cyl(0.025, 0.03, 0.65, 8), M.gun, -0.35, 1.2, -0.3, HP2);
    P(tur, D.box(0.12, 0.1, 0.16, 0.01), M.acc, -0.22, 1.16, 0.15);
    P(tur, gBox(0.12, 0.08, 0.06), M.lens, -0.24, 1.2, -0.02);
  });
  // 潛望鏡與雷射警告接收器
  fine(() => {
    for (const x of [0.12, 0.3]) P(tur, D.box(0.1, 0.08, 0.06, 0.01), M.lens, x, 0.9, -0.62);
    for (const [x, z] of [
      [-0.82, -0.7],
      [0.82, -0.7],
      [-0.7, 1.3],
      [0.7, 1.3],
    ])
      P(tur, D.cyl(0.06, 0.07, 0.06, 10), M.joint, x, 0.82, z);
    // 吊環
    for (const [x, z] of [
      [-0.6, -0.4],
      [0.6, -0.4],
      [-0.55, 0.9],
      [0.55, 0.9],
    ])
      P(tur, D.cyl(0.05, 0.05, 0.02, 8), M.joint, x, 0.86, z, HP2);
  });
  // 天線（兩根）
  for (const x of [-0.5, 0.5]) vAntenna(tur, M, x, 0.77, 1.3, 2.2);
  // 砲塔尾部的置物架（欄杆）與收納袋
  fine(() => {
    for (const s of [-1, 1])
      P(
        tur,
        D.sweep(
          [
            [s * 0.66, 0.6, 0.9],
            [s * 0.66, 0.78, 0.95],
            [s * 0.66, 0.78, 1.45],
            [s * 0.66, 0.6, 1.5],
          ],
          D.ring(0.02, 5),
        ),
        M.joint,
      );
    P(
      tur,
      D.sweep(
        [
          [-0.66, 0.78, 1.45],
          [0.66, 0.78, 1.45],
        ],
        D.ring(0.02, 5),
      ),
      M.joint,
    );
  });
  for (const s of [-1, 1]) CB(tur, 0.22, 0.3, 0.42, M.sub, s * 0.76, 0.5, 1.12, 0, 0, 0, 0.03);
  for (const x of [-0.3, 0.3]) P(tur, D.box(0.42, 0.2, 0.3, 0.06), M.acc, x, 0.85, 1.18);
  // 裝填手的艙蓋
  vHatch(tur, M, 0.3, 0.9, 0.3, 0.2);
  // 受損：冒煙點（引擎甲板、砲塔後）、脫落的零件（呼叫端再加側裙）
  return {
    smoke: [
      [0, 1.75, 1.3],
      [0.5, 1.9, 0.9],
    ],
    plates: [back],
  };
}
// 車尾的大收納箱
function vBoxTank(n, M) {
  P(n, D.box(1.1, 0.34, 0.32, 0.04), M.sub, 0, 1.45, 1.95);
  fine(() => {
    P(n, gBox(1.12, 0.03, 0.33), M.joint, 0, 1.55, 1.95);
    for (const x of [-0.35, 0.35]) P(n, gBox(0.06, 0.1, 0.02), M.joint, x, 1.48, 2.12);
  });
}
// 直升機：機鼻的光電球與剪線器、座艙側的踏板與把手、艙門的輪廓、排氣抑制器、熱焰彈發射器、天線、
// 航行燈、旋翼葉尖與變距桿、火箭莢艙的管口
function heliDetail(tor, rotor, M, red) {
  fine(() => heliFine(tor, rotor, M, red));
  // 機鼻上方的光電球
  P(tor, gCyl(0.1, 0.12, 0.1, 8), M.joint, 0, 0.7, -1.95);
  P(tor, gSph(0.12, 10), M.sub, 0, 0.84, -1.95);
  P(tor, gBox(0.1, 0.07, 0.03), M.lens, 0, 0.85, -2.07);
  // 剪線器（機鼻上下）
  PB(tor, gBox(0.03, 0.04, 0.4), M.joint, [0, 1.12, -1.75], [1, 0, 0], [0, 0.6, 0.8]);
  PB(tor, gBox(0.03, 0.04, 0.35), M.joint, [0, -0.08, -1.9], [1, 0, 0], [0, -0.6, 0.8]);
  for (const s of [-1, 1]) {
    // 座艙下的踏板與把手
    P(tor, gBox(0.14, 0.03, 0.1), M.joint, s * 0.78, 0.25, -1.0);
    rod(tor, M.joint, [s * 0.77, 0.75, -0.5], [s * 0.77, 0.95, -0.5], 0.015, 4);
    // 艙門的輪廓
    for (const [y, h] of [
      [0.12, 0.02],
      [1.0, 0.02],
    ])
      P(tor, gBox(0.02, h, 0.85), M.joint, s * 0.77, y, 0.2);
    for (const z of [-0.22, 0.62]) P(tor, gBox(0.02, 0.9, 0.02), M.joint, s * 0.77, 0.56, z);
    // 排氣抑制器（往外彎的排氣管）
    P(tor, gCyl(0.14, 0.12, 0.45, 8), M.gun, s * 0.62, 1.5, 1.95, Math.PI / 2, 0, s * 0.5);
    P(tor, gCyl(0.1, 0.1, 0.03, 8), M.joint, s * 0.74, 1.56, 2.18, Math.PI / 2, 0, s * 0.5);
    // 熱焰彈發射器（尾桁兩側）
    CB(tor, 0.06, 0.16, 0.3, M.sub, s * 0.31, 0.92, 2.05, 0, 0, 0, 0.01);
    for (let i = 0; i < 3; i++)
      P(
        tor,
        gCyl(0.025, 0.025, 0.02, 6),
        M.joint,
        s * 0.345,
        0.88 + (i % 2) * 0.08,
        1.95 + i * 0.09,
        0,
        0,
        Math.PI / 2,
      );
    // 航行燈（短翼尖：左紅右綠）
    P(tor, gSph(0.05, 6), s < 0 ? red : M.lens, s * 2.02, 0.7, 0.05);
    // 火箭莢艙的管口
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(
        tor,
        gCyl(0.05, 0.05, 0.03, 6),
        M.gun,
        s * 2.2 + Math.cos(a) * 0.2,
        0.42 + Math.sin(a) * 0.2,
        -0.45,
        Math.PI / 2,
      );
    }
  }
  // 尾桁頂的刀形天線、機腹的鞭狀天線、尾翼頂的閃光燈
  P(tor, gBox(0.02, 0.28, 0.22), M.joint, 0, 1.36, 2.6);
  P(tor, gCyl(0.01, 0.01, 0.6, 4), M.joint, 0, -0.32, 0.9, 0.5, 0, 0);
  P(tor, gSph(0.06, 6), red, 0, 2.3, 5.2);
  // 機身的面板接縫（座艙後到引擎下）
  for (const s of [-1, 1])
    for (const z of [0.95, 1.4]) P(tor, gBox(0.02, 0.9, 0.02), M.joint, s * 0.66, 0.6, z);
  // 旋翼：葉尖配重與變距桿
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const c = Math.cos(a),
      s = Math.sin(a);
    CB(rotor, 0.22, 0.06, 0.28, M.acc, c * 4.25, 0, -s * 4.25, 0, a, 0, 0.01);
    rod(rotor, M.joint, [c * 0.16, -0.12, -s * 0.16], [c * 0.3, 0.02, -s * 0.3], 0.02, 4);
  }
}
// 直升機的小細節：鉚釘列、面板接縫、皮託管、空速管、側門的把手、HF 天線線
function heliFine(tor, rotor, M, red) {
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++)
      P(tor, D.cyl(0.018, 0.018, 0.012, 6), M.joint, s * 0.8, 0.95, -0.9 + i * 0.22, 0, 0, HP2);
    P(tor, D.cyl(0.012, 0.012, 0.45, 6), M.joint, s * 0.25, 0.42, -2.25, HP2);
  }
  P(tor, D.cable([0, 1.85, 0.2], [0, 1.25, 4.6], 0.008, 0.05, 6), M.joint);
}
// 無人機：背上的面板與 GPS 天線罩、兩側的進氣口、感測器的萬向環、機腹的天線
function droneDetail(tor, M) {
  // 機身的面板縫、尾部噴口的導流片、感測器的護框
  fine(() => {
    for (const z of [-0.3, 0.15]) P(tor, D.cyl(0.255, 0.255, 0.012, 12), M.joint, 0, 0, z, HP2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      P(tor, gBox(0.015, 0.1, 0.14), M.sub, Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.66, 0, 0, a);
    }
    for (const s of [-1, 1]) P(tor, gBox(0.02, 0.2, 0.02), M.joint, s * 0.18, 0, -0.68);
  });
  CB(tor, 0.26, 0.03, 0.36, M.main3, 0, 0.255, -0.05, 0, 0, 0, 0.01);
  P(tor, gSph(0.06, 8), M.sub, 0, 0.27, 0.28);
  for (const s of [-1, 1]) {
    CB(tor, 0.08, 0.1, 0.24, M.joint, s * 0.28, 0.06, -0.18, 0, 0, 0, 0.01);
    P(tor, gBox(0.02, 0.07, 0.18), M.gun, s * 0.32, 0.06, -0.18);
  }
  P(tor, gCyl(0.21, 0.21, 0.03, 10), M.acc, 0, 0, -0.58, Math.PI / 2);
  P(tor, gCyl(0.008, 0.008, 0.3, 4), M.joint, -0.08, -0.32, 0.15);
}
