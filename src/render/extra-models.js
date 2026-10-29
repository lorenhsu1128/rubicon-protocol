// 非機甲的小型模型（純函式，不使用亂數、不加入場景）：運輸貨車／列車、掉落物、轟炸機、彈體
// 遊戲的本地模型庫可以用 GLB 取代（model-provider.js）：每節車廂、掉落物本體、轟炸機、彈體各自一個槽位
import { CB, P, bakeAll, fine, gBox, gCyl, gPod, mergeGeos } from './geometry.js';
import { D } from './detail.js';
import { vExhaust, vLamp, vLight, vMirror, vRailWheel, vWheel } from './vehicle-kit.js';
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
function bogie(n, T, z, wheels) {
  const M = { joint: T.dark, rubber: T.tire, gun: T.metal, lens: T.glass, sub: T.dark };
  P(n, D.box(2.2, 0.3, 2.0, 0.03), T.dark, 0, 0.66, z);
  for (const dz of [-0.62, 0.62]) {
    // 車軸＋有輪緣的鋼輪（會轉）＋軸箱
    P(n, D.cyl(0.08, 0.08, 2.6, 8), T.metal, 0, 0.45, z + dz, 0, 0, HP);
    for (const s of [-1, 1]) {
      wheels.push({ o: vRailWheel(n, M, s * 1.28, 0.45, z + dz, 0.42, 0.18), r: 0.45 });
      P(n, D.box(0.24, 0.26, 0.34, 0.03), T.dark, s * 1.48, 0.47, z + dz);
    }
  }
  // 側架（台車的框）＋彈簧
  for (const s of [-1, 1]) {
    P(
      n,
      D.extrude(
        [
          [-1.1, 0.4],
          [1.1, 0.4],
          [1.0, 0.75],
          [0.4, 0.85],
          [-0.4, 0.85],
          [-1.0, 0.75],
        ],
        0.16,
        0.03,
      ),
      T.dark,
      s * 1.5,
      0,
      z,
      0,
      HP,
      0,
    );
    P(n, D.box(0.2, 0.3, 0.5, 0.03), T.metal, s * 1.36, 0.86, z);
    fine(() => {
      const pts = [];
      for (let i = 0; i <= 24; i++) {
        const a = (i / 24) * Math.PI * 8;
        pts.push([s * 1.5 + Math.cos(a) * 0.1, 0.7 + i * 0.012, Math.sin(a) * 0.1]);
      }
      for (const dz of [-0.2, 0.2])
        P(
          n,
          D.sweep(
            pts.map((p) => [p[0], p[1], p[2] + z + dz]),
            D.ring(0.025, 5),
          ),
          T.metal,
        );
    });
  }
}
function buildTruck(n, T, wheels) {
  const M = { joint: T.dark, rubber: T.tire, gun: T.metal, lens: T.glass, sub: T.dark, main3: T.dark };
  // 底盤：兩根大樑＋橫樑、保險桿、油箱（剖面旋轉）、踏板
  for (const x of [-0.55, 0.55]) P(n, D.box(0.2, 0.3, 8.7, 0.02), T.dark, x, 0.68, 0.35);
  P(n, D.box(2.6, 0.14, 0.14, 0.02), T.dark, 0, 0.55, -3.98); // 後方的防鑽撞桿
  for (const x of [-1.0, 1.0]) P(n, gBox(0.1, 0.32, 0.1), T.dark, x, 0.7, -3.98);
  for (const z of [-3.6, -1.6, 0.4, 2.4]) P(n, gBox(1.1, 0.16, 0.14), T.dark, 0, 0.68, z);
  P(n, D.box(3.0, 0.32, 0.24, 0.05), T.dark, 0, 0.75, 4.8);
  P(
    n,
    D.lathe(
      [
        [0, -0.5],
        [0.3, -0.48],
        [0.32, -0.42],
        [0.32, 0.42],
        [0.3, 0.48],
        [0, 0.5],
      ],
      16,
    ),
    T.metal,
    1.1,
    0.68,
    1.35,
    0,
    0,
    HP,
  );
  fine(() => {
    for (const z of [1.15, 1.55]) P(n, D.cyl(0.33, 0.33, 0.04, 16), T.dark, 1.1, 0.68, z, HP);
  });
  // 車輪：前 1 軸、後 2 軸（雙輪），會轉（rig.wheels）
  for (const z of [-2.6, -0.5, 3.2])
    for (const s of [-1, 1]) {
      const w = vWheel(n, M, s * 1.32, 0.6, z, 0.6, 0.42, { lugs: 14, depth: 0.04 });
      if (w) wheels.push({ o: w, r: 0.6 });
      if (z < 0) {
        const w2 = vWheel(n, M, s * 0.88, 0.6, z, 0.6, 0.4, { lugs: 14, depth: 0.04 });
        if (w2) wheels.push({ o: w2, r: 0.6 });
      }
    }
  // 擋泥板（板金＋後輪的橡膠擋泥片）
  for (const s of [-1, 1]) {
    P(n, D.box(0.6, 0.06, 2.9, 0.02), T.dark, s * 1.32, 1.26, -1.55);
    P(n, D.box(0.6, 0.06, 1.5, 0.02), T.white, s * 1.32, 1.3, 3.2);
    P(n, gBox(0.56, 0.5, 0.02), T.tire, s * 1.32, 0.85, -3.25);
  }
  // 貨櫃：箱體、波紋側板（外凸的肋）、頂框、角柱、後門（門閂）
  P(n, D.box(2.96, 2.4, 7.0, 0.05), T.blue, 0, 2.05, -0.5);
  for (const s of [-1, 1]) {
    for (let i = 0; i < 12; i++)
      P(n, D.box(0.05, 2.12, 0.28, 0.015), T.blue, s * 1.49, 2.05, -3.75 + i * 0.59);
    P(n, D.box(0.1, 0.12, 7.0, 0.02), T.dark, s * 1.48, 3.22, -0.5);
    P(n, D.box(0.1, 0.12, 7.0, 0.02), T.dark, s * 1.48, 0.9, -0.5);
    for (const z of [-3.95, 2.95]) P(n, D.box(0.14, 2.4, 0.14, 0.02), T.dark, s * 1.42, 2.05, z);
  }
  P(n, gBox(0.03, 2.2, 0.02), T.dark, 0, 2.05, -4.02);
  fine(() => {
    for (const x of [-1.1, -0.4, 0.4, 1.1]) {
      P(n, D.cyl(0.03, 0.03, 2.2, 6), T.metal, x, 2.05, -4.04);
      for (const y of [1.1, 3.0]) P(n, gBox(0.12, 0.06, 0.05), T.metal, x, y, -4.05);
      P(n, gBox(0.04, 0.3, 0.06), T.metal, x + 0.06, 1.6, -4.08);
    }
    for (const s of [-1, 1]) {
      vLamp(n, M, T.red, s * 1.2, 1.05, -4.06, 0.18, 0.12, Math.PI);
      for (const y of [1.2, 2.0, 2.8]) P(n, gBox(0.06, 0.16, 0.04), T.dark, s * 1.35, y, -4.04);
    }
  });
  // 駕駛室：側面輪廓擠出（前面斜的擋風）、擋風玻璃、側窗、車頂導流罩
  const cab = [
    [2.4, 0.72],
    [4.85, 0.72],
    [4.85, 1.55],
    [4.48, 2.45],
    [2.4, 2.5],
  ];
  P(n, D.extrude(cab, 2.84, 0.08), T.white, 0, 0, 0, 0, -HP, 0);
  P(n, D.box(2.5, 0.03, 0.95, 0.01), T.glass, 0, 2.03, 4.75, 1.18, 0, 0);
  for (const s of [-1, 1]) {
    P(n, D.box(0.03, 0.62, 1.15, 0.01), T.glass, s * 1.43, 1.95, 3.85);
    P(n, D.box(0.03, 0.08, 1.9, 0.01), T.dark, s * 1.44, 1.42, 3.6); // 腰線
  }
  P(
    n,
    D.extrude(
      [
        [2.6, 2.5],
        [4.2, 2.5],
        [3.9, 2.9],
        [2.6, 3.0],
      ],
      2.6,
      0.06,
    ),
    T.white,
    0,
    0,
    0,
    0,
    -HP,
    0,
  );
  // 正面：水箱護罩、頭燈、方向燈、保險桿上的霧燈
  P(n, D.box(1.6, 0.6, 0.06, 0.02), T.dark, 0, 1.25, 4.88);
  for (const s of [-1, 1]) {
    vLamp(n, M, T.light, s * 1.08, 1.05, 4.9, 0.42, 0.2);
    vLamp(n, M, T.yellow, s * 1.33, 1.05, 4.9, 0.1, 0.18);
    vMirror(n, M, s * 1.45, 2.05, 4.3, s, 0.32);
  }
  fine(() => {
    for (let i = 0; i < 6; i++) P(n, gBox(1.5, 0.03, 0.04), T.metal, 0, 1.02 + i * 0.09, 4.91);
    // 車門的縫與把手、上車的踏階
    for (const s of [-1, 1]) {
      P(n, gBox(0.02, 1.5, 0.02), T.dark, s * 1.43, 1.5, 3.1);
      P(n, gBox(0.03, 0.04, 0.2), T.metal, s * 1.44, 1.62, 3.3);
      for (const y of [0.55, 0.85]) P(n, D.box(0.3, 0.04, 0.4, 0.01), T.metal, s * 1.3, y, 3.4);
    }
  });
  // 排氣管（駕駛室後的直立管）、空氣濾清器
  vExhaust(n, M, 1.25, 1.0, 2.25, 2.1, 0.08);
  P(n, D.cyl(0.18, 0.18, 0.6, 14, 0.02), T.metal, -1.25, 1.6, 2.25);
}
function buildLoco(n, T, wheels) {
  // 底架、緩衝樑與緩衝器、台車
  CB(n, 3.4, 0.4, 7.2, T.yellow, 0, 0.7, 0, 0, 0, 0, 0.05);
  for (const s of [-1, 1]) {
    P(n, gBox(3.2, 0.45, 0.18), T.dark, 0, 0.85, s * 3.68);
    for (const x of [-1, 1]) P(n, gCyl(0.14, 0.14, 0.3, 8), T.metal, x, 0.85, s * 3.85, HP);
    bogie(n, T, s * 2.4, wheels);
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
  locoDetail(n, T);
}
// 機車頭的細節：側門的輪廓、百葉的框、車頂的散熱風扇與喇叭、前後的頭燈與號碼板、踏階、聯結器、駕駛室的窗框
function locoDetail(n, T) {
  const M = { joint: T.dark, rubber: T.tire, gun: T.metal, lens: T.glass, sub: T.dark };
  for (const s of [-1, 1]) {
    // 側門（三扇）與百葉的框
    for (const z of [-2.6, -0.4, 1.0]) {
      P(n, D.box(0.04, 1.5, 0.9, 0.01), T.red, s * 1.62, 2.3, z);
      fine(() => {
        P(n, gBox(0.02, 0.06, 0.06), T.metal, s * 1.65, 2.3, z + 0.32);
        for (const y of [1.6, 3.0]) P(n, gBox(0.02, 0.05, 0.12), T.dark, s * 1.65, y, z - 0.42);
      });
    }
    P(n, D.box(0.05, 0.95, 2.4, 0.02), T.dark, s * 1.61, 3.1, -1.5);
    // 角落的踏階與扶手
    for (const z of [-3.45, 3.45]) {
      P(n, D.box(0.5, 0.05, 0.3, 0.01), T.metal, s * 1.45, 0.45, z);
      fine(() => {
        P(n, gBox(0.5, 0.05, 0.3), T.metal, s * 1.45, 0.15, z);
        P(
          n,
          D.sweep(
            [
              [s * 1.7, 0.5, z],
              [s * 1.72, 1.6, z],
            ],
            D.ring(0.025, 5),
          ),
          T.metal,
        );
      });
    }
  }
  // 車頂：兩個散熱風扇（網罩）、喇叭、天線
  for (const z of [-1.8, -0.4]) {
    P(n, D.cyl(0.62, 0.66, 0.2, 20, 0.03), T.dark, 0, 3.9, z);
    fine(() => {
      for (let i = 0; i < 4; i++) P(n, gBox(1.2, 0.02, 0.03), T.metal, 0, 4.01, z, 0, (i * Math.PI) / 4);
    });
  }
  fine(() => {
    for (const x of [-0.3, 0, 0.3])
      P(
        n,
        D.lathe(
          [
            [0, 0],
            [0.06, 0],
            [0.04, 0.18],
            [0.09, 0.3],
            [0, 0.3],
          ],
          8,
        ),
        T.metal,
        x,
        5.0,
        2.0,
        HP,
      );
    P(n, D.cyl(0.01, 0.01, 0.8, 4), T.metal, 0.9, 5.3, 1.2);
  });
  // 前後的頭燈（雙燈）、號碼板、聯結器
  for (const sz of [-1, 1]) {
    const z = sz * 3.57,
      ry = sz > 0 ? 0 : Math.PI;
    for (const x of [-0.25, 0.25])
      vLight(n, M, T.light, x, 3.35, z * 0.985, 0.1, sz > 0 ? Math.PI : 0, false);
    P(n, D.box(0.8, 0.22, 0.04, 0.01), T.white, 0, 3.0, z);
    vLamp(n, M, T.red, 1.2, 1.35, sz * 3.6, 0.12, 0.12, ry);
    P(n, D.box(0.36, 0.3, 0.5, 0.04), T.dark, 0, 0.85, sz * 3.95);
    fine(() => P(n, D.cyl(0.08, 0.1, 0.15, 10), T.metal, 0, 0.85, sz * 4.25, HP));
  }
  // 駕駛室的窗框
  fine(() => {
    for (const x of [-0.95, 0, 0.95]) P(n, gBox(0.06, 0.5, 0.06), T.dark, x, 4.45, 3.03);
  });
}
function buildCar(n, T, i, wheels) {
  const cm = i % 2 ? T.carA : T.carB;
  P(n, gBox(3.4, 0.3, 7.2), T.dark, 0, 0.55, 0);
  for (const s of [-1, 1]) {
    bogie(n, T, s * 2.4, wheels);
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
  const wheels = [];
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
      if (i === 0) buildLoco(n, T, wheels);
      else buildCar(n, T, i, wheels);
    } else buildTruck(n, T, wheels);
  }
  bakeAll(g, { tint: { ao: 0.85, grime: 0.32, gh: 1.1 }, cache: 'transport:' + kind });
  g.wheels = wheels; // 依行駛距離轉動（world/map-extras.js 的 Vehicle）
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
  // 引擎的進氣口（唇口）與排氣錐、翼下的掛架與炸彈、座艙的框、面板縫、天線
  for (const s of [-1, 1])
    for (const x of [3.5, 7]) {
      const z = (x - 3.5) * 0.25;
      P(
        b,
        D.lathe(
          [
            [0.55, 0],
            [0.74, 0.05],
            [0.7, 0.16],
            [0.6, 0.2],
          ],
          20,
        ),
        dk,
        s * x,
        -0.6,
        -1.0 + z,
        -HP,
        0,
        0,
      );
      P(
        b,
        D.lathe(
          [
            [0.42, 0],
            [0.32, 0.35],
            [0.1, 0.6],
            [0, 0.62],
          ],
          16,
        ),
        dk,
        s * x,
        -0.6,
        2.25 + z,
        HP,
        0,
        0,
      );
      fine(() => P(b, D.cyl(0.5, 0.5, 0.04, 16), dk, s * x, -0.6, -0.9 + z, HP));
    }
  for (const s of [-1, 1]) {
    P(b, D.box(0.3, 0.3, 1.6, 0.04), dk, s * 5.2, -0.45, 0.9);
    for (const k of [-1, 1])
      P(
        b,
        D.lathe(
          [
            [0, -0.9],
            [0.16, -0.75],
            [0.2, -0.5],
            [0.2, 0.5],
            [0.14, 0.7],
            [0, 0.8],
          ],
          12,
        ),
        mm,
        s * 5.2 + k * 0.22,
        -0.8,
        0.9,
        HP,
        0,
        0,
      );
  }
  fine(() => {
    for (const z of [-5.0, -4.3]) P(b, gBox(1.25, 0.05, 0.05), dk, 0, 1.12 - (z + 5) * 0.1, z);
    for (const z of [-2.0, 0.5, 3.0]) P(b, D.cyl(0.8, 0.8, 0.02, 16), dk, 0, 0.7, z, HP);
    for (const s of [-1, 1])
      for (const x of [2.0, 5.5, 9.0]) P(b, gBox(0.03, 0.02, 1.6), dk, s * x, 0.22, 1.2 + x * 0.12);
    P(b, D.box(0.06, 0.5, 0.4, 0.01), dk, 0, 1.45, -1.5);
    P(b, D.cyl(0.01, 0.01, 1.2, 4), dk, 0, -1.3, -2.0, 0.6);
  });
  bakeAll(b, { tint: { ao: 0.7, grime: 0, gh: 1 }, cache: 'bomber' });
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
