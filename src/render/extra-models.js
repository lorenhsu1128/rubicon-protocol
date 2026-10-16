// 非機甲的小型模型（純函式，不使用亂數、不加入場景）：運輸貨車／列車、掉落物、轟炸機、彈體
// 遊戲的本地模型庫可以用 GLB 取代（model-provider.js）：每節車廂、掉落物本體、轟炸機、彈體各自一個槽位
import { CB, P, bakeAll, gBox, gCyl, gPod, mergeGeos } from './geometry.js';
import { rod, side, slats, top } from './foe-models.js';
import { providedModel } from './model-provider.js';
import { tagStyle } from './style/shader.js';

const HP = Math.PI / 2;
// 運輸車輛的材質：每次建立各自一份（受擊閃光只改這一台）；燈的自發光記在 emis0，閃光後還原
function transportMats() {
  const M = (c, o) =>
    new THREE.MeshStandardMaterial(
      Object.assign({ color: c, roughness: 0.6, metalness: 0.3, flatShading: true }, o || {}),
    );
  const light = M(0xfff0c0, { emissive: 0xffe0a0, emissiveIntensity: 0.8 });
  light.userData.emis0 = light.emissive.clone();
  return {
    blue: M(0x2b4a8a),
    white: M(0xe6e6e6),
    glass: M(0x30a0ff, { transparent: true, opacity: 0.6, metalness: 0.6, roughness: 0.2 }),
    dark: M(0x2a2d31),
    tire: M(0x1c1e20, { roughness: 0.9, metalness: 0.05 }),
    metal: M(0x8a8f96, { metalness: 0.6, roughness: 0.45 }),
    red: M(0x7a2a2a),
    yellow: M(0xd8c060),
    carA: M(0x4a5a3a),
    carB: M(0x3a4a6a),
    light,
  };
}
// 列車的台車：框架＋兩軸的車輪＋彈簧
function bogie(n, T, z) {
  P(n, gBox(2.7, 0.32, 2.2), T.dark, 0, 0.62, z);
  for (const dz of [-0.62, 0.62])
    for (const s of [-1, 1]) P(n, gCyl(0.45, 0.45, 0.22, 8), T.tire, s * 1.4, 0.45, z + dz, 0, 0, HP);
  for (const s of [-1, 1]) P(n, gBox(0.2, 0.3, 0.5), T.metal, s * 1.36, 0.82, z);
}
function buildTruck(n, T) {
  // 底盤、保險桿、車輪與擋泥板、油箱
  CB(n, 3.0, 0.25, 7.4, T.dark, 0, 0.55, 0, 0, 0, 0, 0.04);
  P(n, gBox(3.0, 0.3, 0.2), T.dark, 0, 0.75, 4.78);
  for (const z of [-2.6, -0.5, 3.2])
    for (const s of [-1, 1]) {
      P(n, gCyl(0.6, 0.6, 0.5, 12), T.tire, s * 1.45, 0.6, z, 0, 0, HP);
      P(n, gCyl(0.32, 0.32, 0.54, 8), T.metal, s * 1.45, 0.6, z, 0, 0, HP);
    }
  for (const s of [-1, 1]) {
    P(n, gBox(0.56, 0.06, 2.9), T.dark, s * 1.45, 1.25, -1.55);
    P(n, gBox(0.56, 0.06, 1.4), T.dark, s * 1.45, 1.25, 3.2);
  }
  P(n, gCyl(0.3, 0.3, 1.0, 10), T.metal, 1.15, 0.62, 1.35, HP);
  // 貨櫃：浪板的肋、頂部的框、後門的鎖桿
  CB(n, 3.0, 2.4, 7.0, T.blue, 0, 1.8, -0.5, 0, 0, 0, 0.06);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 7; i++) P(n, gBox(0.06, 2.2, 0.14), T.blue, s * 1.52, 1.8, -3.5 + i * 1.0);
    P(n, gBox(0.08, 0.1, 7.0), T.dark, s * 1.5, 2.98, -0.5);
  }
  P(n, gBox(0.04, 2.2, 0.04), T.dark, 0, 1.8, -4.02);
  for (const x of [-1.1, -0.4, 0.4, 1.1]) P(n, gBox(0.05, 2.2, 0.05), T.metal, x, 1.8, -4.04);
  // 駕駛室：前面斜的擋風玻璃、側窗、水箱護罩、頭燈、後照鏡、排氣管
  side(
    n,
    T.white,
    [
      [2.4, 0.7],
      [4.85, 0.7],
      [4.85, 1.55],
      [4.45, 2.4],
      [2.4, 2.45],
    ],
    2.9,
    0,
    0.06,
  );
  P(n, gBox(2.5, 0.8, 0.04), T.glass, 0, 1.99, 4.676, -0.51);
  for (const s of [-1, 1]) {
    P(n, gBox(0.04, 0.5, 1.0), T.glass, s * 1.46, 1.95, 3.5);
    P(n, gBox(0.4, 0.18, 0.05), T.light, s * 1.05, 1.0, 4.87);
    rod(n, T.dark, [s * 1.45, 2.0, 4.3], [s * 1.72, 2.0, 4.1], 0.03, 4);
    P(n, gBox(0.06, 0.32, 0.16), T.dark, s * 1.74, 2.0, 4.08);
  }
  slats(n, T.dark, 0, 1.4, 4.87, 1.5, 4, 0.09);
  P(n, gCyl(0.08, 0.08, 1.2, 6), T.metal, 1.3, 2.3, 2.3);
}
function buildLoco(n, T) {
  // 底架、緩衝樑與緩衝器、台車
  CB(n, 3.4, 0.4, 7.2, T.yellow, 0, 0.7, 0, 0, 0, 0, 0.05);
  for (const s of [-1, 1]) {
    P(n, gBox(3.2, 0.45, 0.18), T.dark, 0, 0.85, s * 3.68);
    for (const x of [-1, 1]) P(n, gCyl(0.14, 0.14, 0.3, 8), T.metal, x, 0.85, s * 3.85, HP);
    bogie(n, T, s * 2.4);
  }
  // 車體：前端往下收的引擎罩＋駕駛室＋煙囪
  side(
    n,
    T.red,
    [
      [-3.5, 0.9],
      [3.5, 0.9],
      [3.5, 2.9],
      [3.15, 3.6],
      [2.7, 3.8],
      [-3.5, 3.8],
    ],
    3.2,
    0,
    0.1,
  );
  P(
    n,
    gPod([
      [0.6, 2.6, 3.6, 5.0, 0.25, 0],
      [2.75, 2.6, 3.6, 5.0, 0.3, 0],
      [3.0, 2.2, 3.6, 4.8, 0.3, 0],
    ]),
    T.dark,
  );
  P(n, gBox(1.9, 0.5, 0.04), T.glass, 0, 4.45, 3.01);
  P(n, gCyl(0.3, 0.38, 1.2, 8), T.dark, 0, 4.4, -2.2);
  P(n, gCyl(0.36, 0.36, 0.1, 8), T.metal, 0, 5.0, -2.2);
  // 側面：散熱百葉、黃色飾條、扶手、側窗、頭燈
  for (const s of [-1, 1]) {
    slats(n, T.dark, s * 1.62, 3.4, -1.5, 2.2, 5, 0.16, HP);
    P(n, gBox(0.04, 0.22, 6.9), T.yellow, s * 1.61, 1.35, 0);
    rod(n, T.metal, [s * 1.72, 2.05, -3.3], [s * 1.72, 2.05, 2.9], 0.03, 4);
    for (const z of [-3.0, 0, 2.7]) rod(n, T.metal, [s * 1.6, 2.05, z], [s * 1.72, 2.05, z], 0.025, 4);
    P(n, gBox(0.04, 0.45, 1.1), T.glass, s * 1.31, 4.45, 1.9);
    P(n, gCyl(0.08, 0.08, 0.06, 8), T.light, s * 1.0, 2.6, 3.53, HP);
  }
  P(n, gCyl(0.18, 0.18, 0.08, 8), T.light, 0, 3.3, 3.42, HP + 0.5);
}
function buildCar(n, T, i) {
  const cm = i % 2 ? T.carA : T.carB;
  P(n, gBox(3.4, 0.3, 7.2), T.dark, 0, 0.55, 0);
  for (const s of [-1, 1]) {
    bogie(n, T, s * 2.4);
    P(n, gBox(0.3, 0.25, 0.4), T.dark, 0, 0.8, s * 3.7);
  }
  // 車廂：浪板的肋、中間的拉門與門軌、梯子
  CB(n, 3.2, 3.0, 7.0, cm, 0, 2.1, 0, 0, 0, 0, 0.06);
  for (const s of [-1, 1]) {
    for (const z of [-3.0, -2.2, -1.4, 1.4, 2.2, 3.0]) P(n, gBox(0.06, 2.8, 0.14), cm, s * 1.62, 2.1, z);
    P(n, gBox(0.06, 2.5, 1.9), cm, s * 1.63, 2.0, 0);
    P(n, gBox(0.1, 0.1, 3.8), T.dark, s * 1.66, 3.35, 0);
    P(n, gBox(0.08, 0.5, 0.06), T.metal, s * 1.68, 2.0, 0.8);
  }
  for (const x of [1.25, 1.55]) rod(n, T.metal, [x, 0.8, 3.53], [x, 3.4, 3.53], 0.025, 4);
  for (let k = 0; k < 5; k++) P(n, gBox(0.32, 0.04, 0.04), T.metal, 1.4, 1.0 + k * 0.55, 3.53);
  // 屋頂：微拱
  P(
    n,
    gPod([
      [-3.6, 3.4, 3.55, 3.85, 0.28, 0],
      [3.6, 3.4, 3.55, 3.85, 0.28, 0],
    ]),
    T.metal,
  );
}

// 運輸車輛每一節的槽位：列車第一節是機車頭、其餘是車廂；貨車每節相同
export const transportSlot = (kind, i) =>
  kind === 'train' ? `vehicle/transport_train/${i === 0 ? 'loco' : 'car'}` : 'vehicle/transport_truck';

// 沿公路／鐵路行駛的運輸車輛；cars 節車廂沿 −Z 排列，車頭朝 +Z
// first：從第幾節開始建立（模型庫單獨顯示車廂用），第一節放在原點
export function buildTransport(kind, cars, carLen, first = 0) {
  const g = new THREE.Group();
  const T = transportMats();
  for (let i = first; i < cars; i++) {
    const zc = -(i - first) * carLen;
    // GLB：原點為這一節的地面中心；每個實例各自一份材質（受擊閃光）
    const glb = providedModel(transportSlot(kind, i), null, true);
    if (glb) {
      glb.position.z = zc;
      g.add(glb);
      continue;
    }
    const n = new THREE.Group();
    n.position.z = zc;
    g.add(n);
    if (kind === 'train') {
      if (i === 0) buildLoco(n, T);
      else buildCar(n, T, i);
    } else buildTruck(n, T);
  }
  bakeAll(g);
  return tagStyle(g);
}

// 掉落物：發光方塊＋金屬框＋地面光環。kind：掉落物種類（GLB 槽位 small/pickup_<kind>，只取代方塊，光環維持程式特效）
// ring：false 時只建立方塊（模型庫用，作為 GLB 的參考）
export function buildPickupMesh(color, kind, ring = true) {
  const g = new THREE.Group();
  const glb = kind ? providedModel('small/pickup_' + kind) : null;
  if (glb) g.add(glb);
  else {
    const b = new THREE.Group();
    g.add(b);
    const m = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.8,
      roughness: 0.4,
    });
    const fm = new THREE.MeshStandardMaterial({
      color: 0x2a2d33,
      roughness: 0.5,
      metalness: 0.7,
      flatShading: true,
    });
    P(b, gBox(0.86, 0.86, 0.86), m);
    // 十二條邊的框
    for (const a of [-1, 1])
      for (const c of [-1, 1]) {
        P(b, gBox(0.1, 1.0, 0.1), fm, a * 0.45, 0, c * 0.45);
        P(b, gBox(0.8, 0.1, 0.1), fm, 0, a * 0.45, c * 0.45);
        P(b, gBox(0.1, 0.1, 0.8), fm, a * 0.45, c * 0.45, 0);
      }
    bakeAll(b);
  }
  if (!ring) return g;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.55;
  g.add(halo);
  return g;
}

// 據點的補給箱：原點在底面中心；color 是獎勵種類的顏色（發光條與光柱，glow 材質）
export function buildCacheMesh(color, beam = true) {
  const g = new THREE.Group();
  const glb = providedModel('small/cache');
  if (glb) g.add(glb);
  else {
    const b = new THREE.Group();
    g.add(b);
    const body = new THREE.MeshStandardMaterial({
      color: 0x4a5560,
      roughness: 0.6,
      metalness: 0.4,
      flatShading: true,
    });
    const frame = new THREE.MeshStandardMaterial({
      color: 0x2a3036,
      roughness: 0.5,
      metalness: 0.6,
      flatShading: true,
    });
    const glow = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1,
      roughness: 0.4,
    });
    // 箱體與蓋子
    CB(b, 1.8, 1.0, 1.2, body, 0, 0.55, 0, 0, 0, 0, 0.06);
    CB(b, 1.9, 0.2, 1.3, body, 0, 1.15, 0, 0, 0, 0, 0.05);
    P(b, gBox(1.82, 0.12, 1.22), glow, 0, 0.75, 0);
    P(b, gBox(0.5, 0.08, 0.5), glow, 0, 1.28, 0);
    // 四角的護框、底下的滑橇、扣鎖、提把、鉸鏈
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) P(b, gBox(0.14, 1.0, 0.14), frame, sx * 0.87, 0.55, sz * 0.57);
      P(b, gBox(0.16, 0.22, 0.06), frame, sx * 0.5, 1.0, -0.63);
      P(b, gBox(0.06, 0.08, 0.5), frame, sx * 0.93, 0.5, 0);
      P(b, gCyl(0.05, 0.05, 0.25, 6), frame, sx * 0.5, 1.06, 0.65, 0, 0, HP);
      P(b, gBox(1.9, 0.1, 0.16), frame, 0, 0.05, sx * 0.45);
    }
    bakeAll(b);
  }
  if (!beam) return g;
  const bm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  bm.position.y = 15;
  g.add(bm);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.0, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.08;
  g.add(halo);
  return g;
}

// 空襲轟炸機：機身沿 Z 軸、機頭朝 −Z
export function buildBomberMesh() {
  const bm = new THREE.Group();
  const glb = providedModel('vehicle/bomber');
  if (glb) return bm.add(glb);
  const mm = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.6,
    metalness: 0.5,
    flatShading: true,
  });
  const dk = new THREE.MeshStandardMaterial({
    color: 0x24272c,
    roughness: 0.5,
    metalness: 0.6,
    flatShading: true,
  });
  const gl = new THREE.MeshStandardMaterial({
    color: 0x223040,
    roughness: 0.15,
    metalness: 0.9,
    flatShading: true,
  });
  const b = new THREE.Group();
  bm.add(b);
  // 機身：尖機頭、往後收的尾部
  P(
    b,
    gPod([
      [-7.0, 0.5, -0.25, 0.25, 0.12, 0.12],
      [-5.8, 1.7, -0.75, 0.65, 0.4, 0.35],
      [-3.0, 2.2, -0.8, 0.8, 0.5, 0.4],
      [4.0, 2.2, -0.8, 0.8, 0.5, 0.4],
      [7.0, 0.9, -0.25, 0.55, 0.2, 0.15],
    ]),
    mm,
  );
  // 座艙玻璃、彈艙門的線
  P(
    b,
    gPod([
      [-5.9, 0.6, 0.4, 0.7, 0.12, 0],
      [-5.0, 1.1, 0.5, 1.0, 0.3, 0],
      [-4.0, 1.0, 0.6, 0.95, 0.25, 0],
    ]),
    gl,
  );
  for (const x of [-0.35, 0.35]) P(b, gBox(0.05, 0.04, 4.0), dk, x, -0.8, 0.5);
  // 主翼（後掠）、引擎莢艙與掛架
  for (const s of [-1, 1]) {
    top(
      b,
      mm,
      [
        [s * 0.9, -1.0],
        [s * 12, 1.6],
        [s * 12, 2.8],
        [s * 0.9, 3.0],
      ],
      0.4,
      0,
      0.06,
    );
    for (const x of [3.5, 7]) {
      P(b, gCyl(0.7, 0.7, 3, 10), mm, s * x, -0.6, 0.5 + (x - 3.5) * 0.25, HP);
      P(b, gCyl(0.72, 0.72, 0.15, 10), dk, s * x, -0.6, -0.95 + (x - 3.5) * 0.25, HP);
      P(b, gCyl(0.5, 0.6, 0.3, 10), dk, s * x, -0.6, 2.1 + (x - 3.5) * 0.25, HP);
      P(b, gBox(0.2, 0.5, 1.6), mm, s * x, -0.15, 0.8 + (x - 3.5) * 0.25);
    }
  }
  // 尾翼：水平安定面＋垂直尾翼
  top(
    b,
    mm,
    [
      [-0.6, 4.8],
      [0.6, 4.8],
      [4, 6.4],
      [4, 7.2],
      [-4, 7.2],
      [-4, 6.4],
    ],
    0.3,
    0.6,
    0.04,
  );
  side(
    b,
    mm,
    [
      [4.6, 0.6],
      [7.3, 0.6],
      [7.5, 2.7],
      [6.4, 2.7],
    ],
    0.3,
    0,
    0.04,
  );
  bakeAll(b);
  return tagStyle(bm);
}

// ---------- 彈體（子彈、飛彈、砲彈／榴彈）----------
// 飛彈與魚雷的彈體＋十字尾翼合成一個幾何（同一個網格，不增加繪製次數）
const withFins = (body, y, span, h) => {
  const at = (yy) => new THREE.Matrix4().makeTranslation(0, yy, 0);
  return mergeGeos([
    { geo: body, mm: new THREE.Matrix4() },
    { geo: gBox(span, h, 0.02), mm: at(y) },
    { geo: gBox(0.02, h, span), mm: at(y) },
  ]);
};
export const ProjGeo = new THREE.BoxGeometry(0.16, 0.16, 0.9),
  MissileGeo = withFins(new THREE.ConeGeometry(0.18, 0.8, 6), -0.3, 0.42, 0.2),
  ShellGeo = new THREE.SphereGeometry(0.28, 6, 5);
const TorpedoGeo = withFins(new THREE.CylinderGeometry(0.2, 0.22, 1.8, 8), -0.75, 0.7, 0.26);
const glow = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
// 彈體 GLB：命名為 glow 的材質改成武器的彈色（同一個顏色共用材質）
const PROJ_SLOT = {
  bullet: 'proj_bullet',
  missile: 'proj_missile',
  shell: 'proj_shell',
  grenade: 'proj_shell',
};
const projPals = new Map();
const projPal = (col) => {
  if (!projPals.has(col)) projPals.set(col, { glow: col });
  return projPals.get(col);
};
const bulletLen = (speed) => Math.min(2.0, Math.max(0.9, speed * 0.009));
// GLB 彈體：外層群組由 Projectile.orient 以 lookAt 讓 +Z 朝飛行方向，所以 GLB（正面 −Z）轉 180°；
// 子彈依彈速沿前後拉長（GLB 以 0.9 倍長度製作）；飛彈尾端保留程式的尾焰
function glbProjectile(kind, col, speed) {
  const slot = PROJ_SLOT[kind];
  const inner = slot ? providedModel('small/' + slot, projPal(col)) : null;
  if (!inner) return null;
  const mesh = new THREE.Group();
  inner.rotation.y = Math.PI;
  if (kind === 'bullet') inner.scale.z = bulletLen(speed) / 0.9;
  mesh.add(inner);
  if (kind === 'missile') {
    const box = new THREE.Box3().setFromObject(inner);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), glow(0xffb060, 0.9));
    fl.position.z = box.isEmpty() ? -0.5 : box.min.z;
    mesh.add(fl);
  }
  mesh.userData.glb = true;
  return mesh;
}
// 子彈的拖曳長度依速度決定（speed：彈速 m/s）
// part(geo, color, opacity, parent)：遊戲傳入時，發光的部分改用粒子批次（fx/batch.js 的 attached 代理，
// Effects.projPart），不建立自己的網格與材質；沒傳時（模型庫）照原本建網格
export function buildProjectileMesh(kind, color, speed, part = null) {
  const col = color || 0xffe0a0;
  const g = glbProjectile(kind, col, speed);
  if (g) return g;
  const mesh = new THREE.Group();
  const gm = (geo, c, op) => {
    if (part) return part(geo, c, op, mesh);
    const m = new THREE.Mesh(geo, glow(c, op));
    mesh.add(m);
    return m;
  };
  if (kind === 'bullet') {
    const L = bulletLen(speed);
    const core = gm(ProjGeo, 0xfff2c8, 0.95);
    core.scale.set(0.4, 0.4, L);
    const halo = gm(ProjGeo, col, 0.5);
    halo.scale.set(1.3, 1.3, L * 1.1);
  } else if (kind === 'missile') {
    const body = new THREE.Mesh(
      MissileGeo,
      new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.6, roughness: 0.4 }),
    );
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), glow(0xffb060, 0.9));
    fl.position.y = -0.5;
    mesh.add(body);
    mesh.add(fl);
  } else if (kind === 'torpedo') {
    // 潛航砲艇的魚雷：沿水面直線前進（長軸沿 Z）
    const body = new THREE.Mesh(
      TorpedoGeo,
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, metalness: 0.6, roughness: 0.4 }),
    );
    body.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 5), glow(col, 0.9));
    tail.position.z = -1;
    mesh.add(body);
    mesh.add(tail);
  } else if (kind === 'crate') {
    // 起重機砲台／叉架 MT 丟出的貨櫃（長軸沿 X，飛行中不轉向）
    const cm = new THREE.MeshStandardMaterial({
      color: col,
      roughness: 0.7,
      metalness: 0.3,
      flatShading: true,
    });
    const fm = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.6, metalness: 0.5 });
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 2.3), cm));
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.3, 2.4), fm);
      f.position.x = s * 2.1;
      mesh.add(f);
    }
  } else {
    const geo = kind === 'shell' || kind === 'grenade' ? ShellGeo : ProjGeo;
    gm(geo, col, 0.95);
    gm(geo, col, 0.4).scale.setScalar(2.2);
  }
  return mesh;
}
