// Coral 戰爭（RTS）維爾威動態的模型（docs/rts-design.md 15.5，R4 B 包）：建築（橄欖綠的輕量桁架＋貨櫃模組＋起落架與
// 涵道風扇——每座建築看起來都「能飛走」）、空投展開中的貨櫃板、投放艙、空投運輸機的吊掛、物流無人機、臨時信標、
// 物流 MT 的貨架與吊鉤。建模函式都是純函式（不呼叫亂數、不碰遊戲狀態）。
// 建築的 rig 同 render/rts-models.js 的 buildRtsBuilding：{ group, body, scaf, torso, height, vehicle, cls,
//   progress, setProgress(p), aimAt(yaw, pitch) }；另外：
//   - 機動建築（定義有 pack）：setPack(p)（0＝展開好、1＝收好：起落架收起、4 具涵道風扇從貼著外牆轉到水平並開始轉、
//     正面的貨櫃板闔上）、gear、fans、rotors、shut；收好在飛時的噴焰由遊戲端畫（entities/mech-rts-veer.js）。
//   - 調度中心三階：tier2／tier3 與 setTier(1～3)（T2 貨櫃吊臂與堆疊的貨櫃、T3 衛星天線與天線桅）。
//   - 集貨站：setStock(k)（0～1：平台上 0～6 堆貨箱，stacks）。
//   - 飛彈防禦塔：turret（繞 Y）、gun（俯仰）、muzzle。投放信標：strobe（綠色頻閃燈）。軌道通訊站：dish（慢慢轉）。
// 合併（RTS 渲染設定，render/rts-merge.js）：本體的不透明材質整座併成一個網格；會動的節點都掛在 rig 上（當骨頭），
// 隱藏的骨頭矩陣歸零，所以 setStock／setPack／setProgress 不必重新合併；setTier 切換子群組的可見度要 unmerge／remerge。
// 會轉的東西（雷達、碟形天線、風扇的葉片、頻閃燈）是有 userData 的獨立網格（不合併），在 onBeforeRender 自己動。
// 黃黑警示條是固定的材質（起落架、吊鉤、貨櫃邊、旋翼尖端），不換隊伍色——陣營辨識靠它。
import { PALETTES } from './materials.js';
import { DETAIL, PK, hazard, mat, truss } from '../world/prop-models.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';
import { buildMech } from './mech-model.js';

export const VEER_LIME = 0x9be070;
const HOOK_UP = 0.55, // 物流 MT 的吊索長度（收起／放下）
  HOOK_DOWN = 2.1;
const glowMat = (c, k = 1.4) => mat(c, { emissive: c, emissiveIntensity: k, roughness: 0.4, metalness: 0 });

// 配色（同 rts-models.js 的 rtsPal；不 import rts-models.js 以免循環）
function palOf(team = 0) {
  const base = PALETTES.veerwell;
  const tc = RTS_TEAM_COLORS[team] !== undefined ? RTS_TEAM_COLORS[team] : RTS_TEAM_COLORS[0];
  return { ...base, main2: new THREE.Color(tc).multiplyScalar(0.42).getHex(), acc: tc, visor: tc, glow: tc };
}
// 建材：橄欖綠、淺橄欖、深綠底、隊伍色塗裝、鋼、黃黑警示（固定）、玻璃、隊伍色的燈
function mats(pal) {
  return {
    olive: mat(pal.main || 0x3a4a34, { roughness: 0.72, metalness: 0.32 }),
    olive2: mat(pal.main3 || 0x4c5e44, { roughness: 0.66, metalness: 0.35 }),
    dark: mat(pal.sub || 0x1a1e18, { roughness: 0.7, metalness: 0.45 }),
    team: mat(pal.main2, { roughness: 0.6, metalness: 0.35 }),
    steel: DETAIL.steel,
    gray: mat(0x7a8070, { roughness: 0.6, metalness: 0.45 }),
    deck: mat(0x2c3128, { roughness: 0.85, metalness: 0.25 }),
    yellow: DETAIL.yellow,
    black: DETAIL.black,
    glass: DETAIL.glass,
    lamp: DETAIL.lamp,
    glow: glowMat(pal.acc || VEER_LIME),
    coral: mat(0xff3d5a, { emissive: 0xff2244, emissiveIntensity: 1.6, roughness: 0.3, metalness: 0.1 }),
  };
}

// ---------- 會自己動的獨立網格（不合併；onBeforeRender 自己更新矩陣） ----------
// spin＝繞 Y 每秒弧度；blink＝頻閃（每秒次數，只用在加色材質）
function selfAnim(mesh, { spin = 0, blink = 0, op = 1 } = {}) {
  mesh.userData.rtsSpin = spin || blink; // 有 userData：網格合併略過（render/mesh-merge.js、rts-merge.js）
  mesh.userData.op = op;
  mesh.castShadow = false;
  mesh.onBeforeRender = () => {
    const t = performance.now() / 1000;
    if (spin && mesh.userData.on !== false) mesh.rotation.y = t * spin;
    if (blink) mesh.material.opacity = (t * blink) % 1 < 0.18 ? op : op * 0.08;
    mesh.updateMatrix();
    if (mesh.parent) mesh.matrixWorld.multiplyMatrices(mesh.parent.matrixWorld, mesh.matrix);
  };
  return mesh;
}
function addMat(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}
// 一組 PK 的零件合成一個獨立網格（第一種材質；用在會自己動的零件）
function oneMesh(fn, material) {
  const k = new PK();
  fn(k, material);
  const g = k.build(new THREE.Group(), false);
  const m = g.children[0];
  g.remove(m);
  m.material = material;
  return m;
}

// ---------- 共用的零件 ----------
// 碟形天線（半徑 1、凹面朝 +Y、有厚度的閉合輪廓，兩面都看得到）
let DISH = null;
function dishGeo() {
  if (DISH) return DISH;
  const P = [];
  for (let i = 0; i <= 6; i++) {
    const r = i / 6;
    P.push(new THREE.Vector2(Math.max(0.001, r), 0.32 * r * r + 0.06));
  }
  for (let i = 6; i >= 0; i--) {
    const r = i / 6;
    P.push(new THREE.Vector2(Math.max(0.001, r * 0.97), 0.3 * r * r - 0.04));
  }
  DISH = new THREE.LatheGeometry(P, 18);
  return DISH;
}
// 貨櫃（w×h×d，原點在底面中心）：外殼、肋條、門的一側、警示條
function container(k, M, w, h, d, x, y, z, ry = 0, col = null, stripe = true) {
  k.at(x, y, z, 0, ry, 0, () => {
    k.cb(col || M.olive, w, h, d, 0, h / 2, 0, 0, 0, 0, 0.06);
    const n = Math.max(2, Math.round(w / 0.9));
    for (let i = 1; i < n; i++) {
      const xx = -w / 2 + (w * i) / n;
      k.box(M.dark, 0.07, h * 0.86, d + 0.04, xx, h / 2, 0);
    }
    for (const s of [-1, 1]) k.box(M.steel, w + 0.04, 0.12, 0.12, 0, h / 2 + (s * h) / 2.1, (s * d) / 2);
    if (stripe) hazard(k, M.yellow, M.black, w * 0.7, 0.22, 0, h - 0.2, d / 2 + 0.03);
  });
}
// 平台（佔地 w×d、高 h；四角倒角）＋邊緣的警示條
function platform(k, M, w, d, h, y = 0) {
  k.cb(M.deck, w, h, d, 0, y + h / 2, 0, 0, 0, 0, Math.min(0.6, h * 0.4));
  for (const s of [-1, 1]) {
    hazard(
      k,
      M.yellow,
      M.black,
      w * 0.9,
      Math.min(0.3, h * 0.5),
      0,
      y + h * 0.5,
      (s * d) / 2 + 0.02,
      s < 0 ? Math.PI : 0,
    );
    hazard(
      k,
      M.yellow,
      M.black,
      d * 0.9,
      Math.min(0.3, h * 0.5),
      (s * w) / 2 + 0.02,
      y + h * 0.5,
      0,
      (s * Math.PI) / 2,
    );
  }
}
// 雷達（獨立網格、會轉）
function radar(M, r = 1.4) {
  const m = oneMesh((k, mm) => {
    k.cyl(mm, 0.12, 0.16, 0.6, 0, 0.3, 0, 0, 0, 0, 6);
    k.box(mm, r * 2, 0.5, 0.12, 0, 0.75, 0.15, -0.25, 0, 0);
    k.box(mm, 0.2, 0.2, 0.5, 0, 0.75, -0.15);
  }, M.gray);
  return selfAnim(m, { spin: 1.6 });
}

// ---------- 機動建築的底座：起落架＋4 具涵道風扇＋正面的貨櫃板 ----------
// w×d＝佔地，y0＝風扇鉸鏈的高度；回傳 { gear, fans, rotors, shut }（都掛在 body 上）
export function addPackRig(body, M, w, d, y0 = 1.6) {
  const gear = [],
    fans = [],
    rotors = [],
    shut = [];
  const r = Math.max(0.8, Math.min(2.1, Math.min(w, d) * 0.16));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      // 起落架（收起時往上縮）：支柱、斜撐、腳墊（黃黑）
      const k = new PK();
      k.cyl(M.steel, 0.16, 0.2, 1.1, 0, -0.45, 0, 0, 0, 0, 6);
      k.bar(M.yellow, [0, 0.0, 0], [sx * 0.5, -0.7, sz * 0.5], 0.14);
      k.cyl(M.black, 0.42, 0.48, 0.16, 0, -0.98, 0, 0, 0, 0, 8);
      hazard(k, M.yellow, M.black, 0.6, 0.18, 0, -0.25, 0.18);
      const g = k.build(new THREE.Group());
      g.position.set(sx * (w / 2 - 0.8), 1.05, sz * (d / 2 - 0.8));
      body.add(g);
      gear.push(g);
      // 涵道風扇：鉸鏈在外牆的角落；展開好時貼著外牆直立、收好時轉成水平往外伸
      const piv = new THREE.Group();
      piv.position.set(sx * (w / 2 + 0.05), y0, sz * (d / 2 - r - 0.3));
      const f = new PK();
      f.at(sx * r, 0, 0, 0, 0, 0, () => {
        f.geo(M.olive2, new THREE.TorusGeometry(r, 0.2, 5, 14), 0, 0, 0, Math.PI / 2, 0, 0);
        f.cyl(M.gray, r * 0.98, r * 0.98, 0.28, 0, 0, 0, 0, 0, 0, 14);
        f.cyl(M.dark, 0.32, 0.32, 0.5, 0, 0.05, 0, 0, 0, 0, 8);
        for (let i = 0; i < 4; i++) f.box(M.steel, r * 1.9, 0.06, 0.08, 0, -0.2, 0, 0, (i * Math.PI) / 4, 0);
        hazard(f, M.yellow, M.black, r * 1.2, 0.18, 0, 0.12, r + 0.18);
      });
      f.box(M.steel, 0.5, 0.35, 0.6, sx * 0.2, 0, 0);
      f.build(piv);
      // 葉片（收好時才顯示、自己轉）：葉尖是黃色
      const blades = oneMesh((kk, mm) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          kk.box(mm, r * 0.86, 0.04, 0.3, Math.cos(a) * r * 0.45, 0.12, -Math.sin(a) * r * 0.45, 0, a, 0.25);
        }
      }, M.yellow);
      blades.position.set(sx * r, 0, 0);
      blades.visible = false;
      selfAnim(blades, { spin: 22 * sx });
      piv.add(blades);
      body.add(piv);
      fans.push(piv);
      rotors.push(blades);
    }
  // 正面（+Z）的貨櫃板：收起時往上闔起（鉸鏈在下緣）
  for (const s of [-1, 1]) {
    const p = new THREE.Group();
    p.position.set((s * w) / 4, 0.9, d / 2 + 0.06);
    const k = new PK();
    k.cb(M.olive2, w / 2 - 0.3, 1.6, 0.12, 0, 0.8, 0, 0, 0, 0, 0.03);
    hazard(k, M.yellow, M.black, w / 2 - 0.6, 0.2, 0, 1.45, 0.07);
    k.build(p);
    p.rotation.x = 1.25; // 展開好時放平（當作斜坡）
    body.add(p);
    shut.push(p);
  }
  const set = (p) => {
    p = Math.max(0, Math.min(1, p));
    for (const g of gear) g.scale.y = 1 - 0.8 * p;
    fans.forEach((piv, i) => {
      const sx = i < 2 ? -1 : 1;
      piv.rotation.z = sx * (1 - p) * (Math.PI / 2);
    });
    for (const b of rotors) b.visible = p > 0.55;
    for (const s of shut) s.rotation.x = 1.25 * (1 - p);
  };
  set(0);
  return { gear, fans, rotors, shut, set };
}

// ---------- 建築的本體 ----------
// 調度中心（16×16、高 12）：降落平台（圓形甲板＋H 標）＋管制塔＋雷達＋側面的貨櫃
function hqBody(k, M) {
  platform(k, M, 15.6, 15.6, 1.0, 0.6);
  k.cyl(M.olive, 7.2, 7.4, 0.5, 0, 1.85, 1, 0, 0, 0, 16);
  k.cyl(M.deck, 6.9, 6.9, 0.08, 0, 2.12, 1, 0, 0, 0, 16);
  // H 標（黃色）
  for (const s of [-1, 1]) k.box(M.yellow, 0.7, 0.06, 5, s * 1.6, 2.18, 1);
  k.box(M.yellow, 2.6, 0.06, 0.7, 0, 2.18, 1);
  k.geo(M.yellow, new THREE.TorusGeometry(5.6, 0.12, 3, 32), 0, 2.17, 1, Math.PI / 2, 0, 0);
  // 管制塔（後方左側）
  k.cb(M.olive2, 4.2, 7, 3.8, -5, 5.1, -5.6, 0, 0, 0, 0.12);
  k.box(M.team, 4.3, 0.5, 3.9, -5, 5.4, -5.6);
  k.cb(M.olive, 5, 2, 4.6, -5, 9.6, -5.6, 0, 0, 0, 0.15);
  k.box(M.glass, 5.1, 0.9, 4.7, -5, 9.7, -5.6);
  k.box(M.dark, 5.4, 0.25, 5, -5, 10.75, -5.6);
  k.cyl(M.steel, 0.1, 0.12, 2.4, -6.5, 12, -6.6, 0, 0, 0, 6);
  k.box(M.glow, 0.3, 0.3, 0.3, -6.5, 13.2, -6.6);
  // 後方右側的貨櫃與燃料槽
  container(k, M, 5, 2.4, 2.4, 3.6, 1.6, -6.3, 0, M.olive2);
  container(k, M, 5, 2.4, 2.4, 3.6, 4.0, -6.3, 0, M.team, false);
  for (const s of [-1, 1]) k.cyl(M.gray, 0.9, 0.9, 3.2, s * 6.6, 3.2, -1.6 + s * 0.2, 0, 0, 0, 10);
  // 甲板邊的燈
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.box(M.glow, 0.3, 0.2, 0.3, Math.cos(a) * 7.2, 2.2, 1 + Math.sin(a) * 7.2);
  }
}
// 第二階（物流總站，高 14）：兩座貨櫃吊臂與堆疊的貨櫃
function hqTier2(k, M) {
  for (const s of [-1, 1]) {
    const x = s * 7.3;
    k.box(M.yellow, 0.4, 9, 0.4, x, 6.1, -4.5);
    k.box(M.yellow, 0.4, 9, 0.4, x, 6.1, 4.5);
    truss(k, M.yellow, 9.4, 0.8, x, 10.6, 0, Math.PI / 2, 0.16);
    k.cb(M.dark, 1.6, 1, 1.4, x, 10, 1.5, 0, 0, 0, 0.1);
    k.box(M.steel, 0.06, 2.4, 0.06, x, 8.4, 1.5);
    container(k, M, 2.4, 2.2, 5, x, 2.1, -2.2, Math.PI / 2, s < 0 ? M.team : M.olive2);
    container(k, M, 2.4, 2.2, 5, x, 4.3, -2.2, Math.PI / 2, M.olive, false);
  }
  k.cb(M.olive2, 4.4, 1.6, 4, -5, 12.2, -5.6, 0, 0, 0, 0.12);
  k.box(M.team, 4.5, 0.3, 4.1, -5, 12.6, -5.6);
}
// 第三階（軌道管制塔，高 17）：衛星天線與軌道管制的天線桅
function hqTier3(k, M) {
  k.cyl(M.steel, 0.2, 0.32, 5, -5, 15.5, -5.6, 0, 0, 0, 8);
  k.box(M.glow, 0.4, 0.4, 0.4, -5, 18.1, -5.6);
  for (const y of [14, 15.5, 17]) k.box(M.steel, 1.6, 0.08, 0.08, -5, y, -5.6);
  k.cyl(M.olive2, 0.6, 0.8, 1.6, 4.6, 6, -6.3, 0, 0, 0, 10);
  k.geo(M.gray, dishGeo(), 4.6, 7.2, -6.3, 0.75, 0.6, 0, 2.4, 2.4, 2.4);
  k.cyl(M.steel, 0.06, 0.06, 1.6, 4.6, 8.6, -5.6, -0.7, 0, 0, 6);
}
// 補給艙（7×7、高 5）：三個疊起來的居住艙
function depotBody(k, M) {
  platform(k, M, 6.8, 6.8, 0.5, 0.55);
  container(k, M, 6, 1.9, 2.6, 0, 1.05, -1.6, 0, M.olive);
  container(k, M, 6, 1.9, 2.6, 0, 1.05, 1.4, 0, M.olive2);
  container(k, M, 4.6, 1.7, 2.6, -0.5, 2.95, -0.1, 0, M.team, false);
  for (const s of [-1, 1]) k.cyl(M.dark, 0.35, 0.35, 0.5, s * 2.6, 3.3, -1.2, 0, 0, 0, 8);
  k.box(M.glow, 0.5, 0.25, 0.08, 1.8, 4.4, 1.2);
}
// 集貨站（10×8、高 6）：平台＋門型吊車（貨箱的堆疊由 setStock 顯示）
function yardBody(k, M) {
  platform(k, M, 9.8, 7.8, 0.6, 0.55);
  for (const s of [-1, 1]) {
    k.box(M.yellow, 0.35, 5, 0.35, s * 4.4, 3.6, -3.2);
    k.box(M.yellow, 0.35, 5, 0.35, s * 4.4, 3.6, 3.2);
    k.box(M.yellow, 0.3, 0.3, 6.6, s * 4.4, 6.0, 0);
  }
  truss(k, M.yellow, 9, 0.7, 0, 6.2, -0.6, 0, 0.14);
  k.cb(M.dark, 1.2, 0.8, 1.2, 1.2, 5.6, -0.6, 0, 0, 0, 0.08);
  k.box(M.steel, 0.05, 1.8, 0.05, 1.2, 4.3, -0.6);
  container(k, M, 3, 2, 2.4, -3, 1.15, 2.4, 0, M.team, false);
  k.box(M.glow, 0.4, 0.3, 0.4, -4.4, 6.3, -3.2);
}
// 集貨站的貨箱堆（6 堆，依庫存顯示）
function yardStacks(M) {
  const out = [];
  const POS = [
    [-2.2, -1.6],
    [0, -1.6],
    [2.2, -1.6],
    [-2.2, 0.6],
    [0, 0.6],
    [2.2, 0.6],
  ];
  POS.forEach(([x, z], i) => {
    const k = new PK();
    const ore = mat(0xe0b040, {
      emissive: 0x7a5410,
      emissiveIntensity: 0.6,
      roughness: 0.35,
      metalness: 0.7,
    });
    k.cb(i % 2 ? M.olive2 : M.olive, 1.8, 1.1, 1.8, 0, 0.55, 0, 0, 0, 0, 0.05);
    k.box(M.dark, 1.84, 0.1, 1.84, 0, 0.9, 0);
    k.cb(M.olive, 1.6, 0.9, 1.6, 0.05, 1.55, -0.05, 0, 0.12, 0, 0.05);
    k.geo(ore, new THREE.OctahedronGeometry(1, 0), 0, 2.1, 0, 0, 0.4, 0.2, 0.35, 0.3, 0.35);
    const g = k.build(new THREE.Group());
    g.position.set(x, 1.15, z);
    g.visible = false;
    out.push(g);
  });
  return out;
}
// Coral 抽取站（8×8、高 9）：湧出點上的鑽塔＋儲槽
function extractorBody(k, M) {
  platform(k, M, 7.8, 7.8, 0.5, 0);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) k.bar(M.olive2, [sx * 2.8, 0.5, sz * 2.8], [sx * 0.8, 8.2, sz * 0.8], 0.26);
  for (const y of [2.5, 4.7, 6.7]) {
    const r = 2.8 - ((y - 0.5) / 7.7) * 2;
    for (const s of [-1, 1]) {
      k.box(M.yellow, r * 2, 0.12, 0.12, 0, y, s * r);
      k.box(M.yellow, 0.12, 0.12, r * 2, s * r, y, 0);
    }
  }
  k.cb(M.team, 2.2, 1, 2.2, 0, 8.6, 0, 0, 0, 0, 0.1);
  k.cyl(M.dark, 0.4, 0.4, 8, 0, 4.5, 0, 0, 0, 0, 8);
  k.box(M.glow, 0.45, 0.45, 0.45, 0, 9.4, 0);
  for (const s of [-1, 1]) {
    k.cyl(M.olive, 1, 1, 2.6, s * 2.7, 1.8, 2.6, 0, 0, 0, 10);
    k.cyl(M.coral, 0.55, 0.55, 2, s * 2.7, 1.8, 3.2, 0, 0, 0, 6);
    k.pipe(M.steel, [s * 2.7, 3.1, 2.6], [0, 3.1, 0.4], 0.14);
  }
}
// 軌道調度所（14×12、高 10）：大型投放艙的發射架（傾斜的導軌與艙）＋接收環
function bayBody(k, M) {
  platform(k, M, 13.8, 11.8, 0.7, 0.55);
  // 發射架（後半）
  for (const s of [-1, 1]) {
    k.bar(M.yellow, [s * 1.8, 1.2, -4.6], [s * 1.8, 9.4, -1.2], 0.36);
    k.bar(M.steel, [s * 1.8, 1.2, 1], [s * 1.8, 6.4, -2.4], 0.24);
  }
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    k.box(M.steel, 3.9, 0.14, 0.14, 0, 1.6 + t * 7.4, -4.4 + t * 3);
  }
  // 艙（尖錐）
  k.at(0, 6.2, -2.9, -0.38, 0, 0, () => {
    k.cyl(M.olive2, 1.2, 1.5, 3.2, 0, 0, 0, 0, 0, 0, 10);
    k.cyl(M.team, 0.3, 1.2, 1.8, 0, 2.5, 0, 0, 0, 0, 10);
    k.cyl(M.dark, 1.55, 1.55, 0.3, 0, -1.7, 0, 0, 0, 0, 10);
    for (let i = 0; i < 4; i++)
      k.box(
        M.olive,
        0.12,
        1.4,
        0.8,
        Math.cos((i * Math.PI) / 2) * 1.5,
        -0.9,
        Math.sin((i * Math.PI) / 2) * 1.5,
        0,
        (-i * Math.PI) / 2,
        0,
      );
  });
  // 接收環（前半）：地面的大環＋燈
  k.geo(M.yellow, new THREE.TorusGeometry(3.4, 0.22, 4, 24), 0, 1.35, 2.8, Math.PI / 2, 0, 0);
  k.cyl(M.deck, 3.2, 3.2, 0.06, 0, 1.3, 2.8, 0, 0, 0, 20);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    k.box(M.glow, 0.3, 0.2, 0.3, Math.cos(a) * 3.4, 1.55, 2.8 + Math.sin(a) * 3.4);
  }
  // 側面的控制艙
  container(k, M, 4.4, 2.4, 2.4, 5.2, 1.25, -2.5, Math.PI / 2, M.team, false);
  k.box(M.glass, 0.08, 0.8, 3.2, 6.45, 2.8, -2.5);
}
// 機庫（16×14、高 9）：半圓拱頂、前方開口與跑道標線
function hangarBody(k, M) {
  platform(k, M, 15.8, 13.8, 0.5, 0.55);
  // 拱頂（沿 Z 的半圓柱，前方開口）
  k.geo(
    M.olive,
    new THREE.CylinderGeometry(1, 1, 1, 18, 1, true, -Math.PI / 2, Math.PI),
    0,
    1.05,
    -1,
    Math.PI / 2,
    0,
    0,
    6.6,
    10.5,
    7.4,
  );
  for (let i = 0; i < 4; i++) {
    const z = -6 + i * 3.4;
    k.geo(M.olive2, new THREE.TorusGeometry(6.65, 0.18, 4, 18, Math.PI), 0, 1.05, z, 0, 0, 0, 1, 1.12, 1);
  }
  k.box(M.dark, 12.6, 6.2, 0.2, 0, 4.1, -6.2);
  k.box(M.team, 13.2, 0.5, 0.4, 0, 7.6, 4.3);
  // 跑道標線（前方）
  for (let i = 0; i < 4; i++) k.box(M.yellow, 0.5, 0.05, 1.2, 0, 1.08, 1 + i * 1.5);
  hazard(k, M.yellow, M.black, 12, 0.3, 0, 1.25, 4.3);
  for (const s of [-1, 1]) k.box(M.glow, 0.4, 0.25, 0.4, s * 6.4, 7.2, 4.3);
}
// 工程研究室（12×10、高 9）：貨櫃組成的實驗室＋天線
function labBody(k, M) {
  platform(k, M, 11.8, 9.8, 0.5, 0.55);
  container(k, M, 6, 2.6, 3, -2.4, 1.05, -2.6, 0, M.olive);
  container(k, M, 6, 2.6, 3, -2.4, 1.05, 0.6, 0, M.olive2);
  container(k, M, 4, 2.6, 6.2, 3.6, 1.05, -1, 0, M.olive, false);
  container(k, M, 6, 2.4, 3, -1.4, 3.65, -1, 0, M.team, false);
  k.box(M.glass, 0.08, 1, 4.4, 5.64, 2.4, -1);
  // 天線
  k.cyl(M.steel, 0.1, 0.14, 3.2, 3.6, 5.2, -3, 0, 0, 0, 6);
  k.geo(M.gray, dishGeo(), 3.6, 6.7, -2.6, 0.9, 0, 0, 1.1, 1.1, 1.1);
  k.box(M.glow, 0.3, 0.3, 0.3, -4.2, 6.3, -1);
  for (const s of [-1, 1]) k.cyl(M.gray, 0.5, 0.5, 2, 4.8 * s, 1.6, 3.6, 0, 0, 0, 8);
}
// 投放信標（3×3、高 6）：三腳架＋天線（頂端的綠色頻閃燈另外建）
function beaconBody(k, M) {
  k.cyl(M.deck, 1.4, 1.5, 0.3, 0, 0.15, 0, 0, 0, 0, 6);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.bar(M.yellow, [Math.cos(a) * 1.3, 0.25, Math.sin(a) * 1.3], [0, 3.4, 0], 0.16);
  }
  k.cb(M.olive, 0.9, 1.1, 0.9, 0, 3.2, 0, 0, 0, 0, 0.08);
  k.box(M.team, 0.95, 0.25, 0.95, 0, 3.0, 0);
  k.cyl(M.steel, 0.07, 0.09, 2.2, 0, 4.8, 0, 0, 0, 0, 6);
  k.box(M.black, 0.4, 0.4, 0.4, 0, 2.2, 0);
}
// 飛彈防禦塔（5×5、高 8）：底座（發射器另外建：turret／gun）
function samBody(k, M) {
  platform(k, M, 4.8, 4.8, 0.5, 0.55);
  k.cyl(M.olive2, 1.4, 1.9, 3.4, 0, 2.75, 0, 0, 0, 0, 8);
  k.cyl(M.team, 1.5, 1.5, 0.4, 0, 3.6, 0, 0, 0, 0, 8);
  k.cyl(M.dark, 1.2, 1.3, 0.6, 0, 4.7, 0, 0, 0, 0, 10);
}
function samTurret(M) {
  const k = new PK();
  k.cyl(M.olive, 1.1, 1.2, 0.8, 0, 0.4, 0, 0, 0, 0, 10);
  k.box(M.steel, 0.4, 1.2, 0.5, 0, 1.2, 0.6);
  const tur = k.build(new THREE.Group());
  const gun = new THREE.Group();
  gun.position.set(0, 1.5, 0);
  const g = new PK();
  // 誘導飛彈架的發射器（兩組、各 2×2 管）
  for (const s of [-1, 1]) {
    g.cb(M.olive2, 1.2, 1.2, 2.6, s * 0.9, 0, 0, 0, 0, 0, 0.08);
    for (const a of [-1, 1])
      for (const b of [-1, 1])
        g.cyl(M.dark, 0.2, 0.2, 0.08, s * 0.9 + a * 0.3, b * 0.3, -1.32, Math.PI / 2, 0, 0, 8);
    hazard(g, M.yellow, M.black, 1.1, 0.2, s * 0.9, 0.5, 1.32);
  }
  g.build(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -1.5);
  gun.add(muzzle);
  tur.add(gun);
  return { tur, gun, muzzle };
}
// 物流倉庫（10×8、高 7）：開放式貨架與堆高機
function marketBody(k, M) {
  platform(k, M, 9.8, 7.8, 0.5, 0.55);
  for (const z of [-2.6, 0.2]) {
    for (const x of [-4.2, -1.4, 1.4, 4.2]) k.box(M.yellow, 0.2, 5, 0.2, x, 3.55, z);
    for (const y of [2.3, 4, 5.7]) k.box(M.steel, 8.6, 0.12, 1.6, 0, y, z + 0.0);
    for (const [x, y, c] of [
      [-3, 2.8, 0],
      [-0.4, 2.8, 1],
      [2.6, 2.8, 2],
      [-2.2, 4.5, 1],
      [1.5, 4.5, 0],
      [3.4, 6.2, 2],
    ])
      k.cb([M.olive, M.olive2, M.team][c], 1.4, 0.9, 1.2, x, y, z, 0, 0, 0, 0.05);
  }
  // 堆高機
  k.cb(M.yellow, 1.4, 1.1, 2.2, 2.8, 1.6, 2.6, 0, 0, 0, 0.1);
  k.box(M.dark, 0.12, 2.4, 0.12, 2.4, 2.2, 1.4);
  k.box(M.dark, 0.12, 2.4, 0.12, 3.2, 2.2, 1.4);
  k.box(M.steel, 1, 0.08, 1.2, 2.8, 1.2, 0.8);
  k.box(M.glow, 0.8, 0.5, 0.08, -3.6, 6.2, 3.9);
}
// 軌道通訊站（12×12、高 14）：塔座（大型碟形天線另外建）
function uplinkBody(k, M) {
  platform(k, M, 11.8, 11.8, 0.8, 0);
  k.cyl(M.olive2, 2.4, 3.4, 6, 0, 3.8, 0, 0, 0, 0, 8);
  k.cyl(M.team, 2.5, 2.5, 0.5, 0, 5.6, 0, 0, 0, 0, 8);
  k.cyl(M.dark, 1.8, 2.2, 1.2, 0, 7.4, 0, 0, 0, 0, 10);
  container(k, M, 4, 2.4, 2.4, -3.8, 0.8, 3.6, 0, M.olive, true);
  container(k, M, 4, 2.4, 2.4, 3.8, 0.8, 3.6, 0, M.team, false);
  for (const s of [-1, 1]) k.box(M.glow, 0.4, 0.3, 0.4, s * 5.6, 1.2, -5.6);
}
function uplinkDish(M) {
  return oneMesh((k, mm) => {
    k.box(mm, 1, 1.4, 1, 0, 0.7, 0);
    k.geo(mm, dishGeo(), 0, 2.6, 0, 0.8, 0, 0, 4.6, 4.6, 4.6);
    k.cyl(mm, 0.1, 0.1, 2.6, 0, 3.5, 0.95, 0.8, 0, 0, 6);
    k.box(mm, 0.5, 0.5, 0.5, 0, 4.45, 1.9, 0.8, 0, 0);
  }, M.gray);
}

const BODY = {
  v_hq: hqBody,
  v_hq2: hqBody,
  v_hq3: hqBody,
  v_depot: depotBody,
  v_yard: yardBody,
  v_extractor: extractorBody,
  v_bay: bayBody,
  v_hangar: hangarBody,
  v_lab: labBody,
  v_beacon: beaconBody,
  v_sam: samBody,
  v_market: marketBody,
  v_uplink: uplinkBody,
};
const HQ_IDS = new Set(['v_hq', 'v_hq2', 'v_hq3']);
export const isVeerBuilding = (id) => !!BODY[id];

// 空投展開中的地基（取代鷹架）：攤平的貨櫃底板＋四片依序立起的牆板（panels，依進度從平放翻到直立）
function foldShell(w, d, M) {
  const g = new THREE.Group();
  const k = new PK();
  k.cb(M.olive2, w, 0.35, d, 0, 0.18, 0, 0, 0, 0, 0.08);
  hazard(k, M.yellow, M.black, w * 0.85, 0.25, 0, 0.2, d / 2 + 0.02);
  hazard(k, M.yellow, M.black, w * 0.85, 0.25, 0, 0.2, -d / 2 - 0.02, Math.PI);
  k.build(g);
  const panels = [];
  const H = Math.min(3.2, Math.max(1.6, Math.min(w, d) * 0.3));
  const SIDES = [
    [0, d / 2, w, 0], // 前（+Z）
    [w / 2, 0, d, -Math.PI / 2], // 右
    [0, -d / 2, w, Math.PI], // 後
    [-w / 2, 0, d, Math.PI / 2], // 左
  ];
  for (const [x, z, L, ry] of SIDES) {
    const hinge = new THREE.Group();
    hinge.position.set(x, 0.35, z);
    hinge.rotation.y = ry;
    const p = new THREE.Group();
    const kk = new PK();
    kk.cb(M.olive, L - 0.2, H, 0.14, 0, H / 2, 0, 0, 0, 0, 0.03);
    const n = Math.max(2, Math.round(L / 1.2));
    for (let i = 1; i < n; i++) kk.box(M.dark, 0.06, H * 0.9, 0.2, -L / 2 + (L * i) / n, H / 2, 0);
    hazard(kk, M.yellow, M.black, L * 0.7, 0.24, 0, H - 0.25, 0.09);
    kk.build(p);
    hinge.add(p);
    g.add(hinge);
    panels.push(p);
  }
  return { g, panels };
}

export function buildVeerBuilding(id, pal) {
  const D = RTS_DEFS[id] || { foot: [8, 8], height: 8 };
  const M = mats(pal);
  const group = new THREE.Group();
  const body = new THREE.Group();
  const k = new PK();
  (BODY[id] || depotBody)(k, M);
  k.build(body);
  group.add(body);
  const [w, d] = D.foot;
  const shell = foldShell(w, d, M);
  const scaf = shell.g;
  scaf.visible = false;
  group.add(scaf);
  const rig = {
    group,
    body,
    scaf,
    torso: body,
    height: D.height,
    vehicle: true,
    cls: 'bld',
    veer: true,
    progress: 1,
    panels: shell.panels,
    pack: 0,
    // 展開進度（0～1）：本體往上長；牆板依序從平放翻起（每片佔 1/4 的進度），完成時地基板消失
    setProgress(p) {
      p = Math.max(0, Math.min(1, p));
      rig.progress = p;
      body.scale.y = 0.06 + 0.94 * p;
      scaf.visible = p < 1;
      shell.panels.forEach((q, i) => {
        const f = Math.max(0, Math.min(1, p * 4.4 - i));
        q.rotation.x = (1 - f) * (Math.PI / 2);
      });
    },
  };
  // 機動建築：起落架＋涵道風扇＋正面的貨櫃板
  if (D.pack) {
    const P = addPackRig(body, M, w, d, Math.min(2.2, D.height * 0.3));
    rig.gear = P.gear;
    rig.fans = P.fans;
    rig.rotors = P.rotors;
    rig.shut = P.shut;
    rig.setPack = (p) => {
      p = Math.max(0, Math.min(1, p));
      if (Math.abs(p - rig.pack) < 1e-4 && rig.packSet) return;
      rig.packSet = true;
      rig.pack = p;
      P.set(p);
    };
  }
  // 調度中心三階
  if (HQ_IDS.has(id)) {
    const mk = (fn) => {
      const kk = new PK();
      fn(kk, M);
      const grp = kk.build(new THREE.Group());
      body.add(grp);
      return grp;
    };
    rig.tier2 = mk(hqTier2);
    rig.tier3 = mk(hqTier3);
    const rd = radar(M, 1.5);
    rd.position.set(-5, 10.85, -5.6);
    body.add(rd);
    rig.radar = rd;
    rig.tier = 0;
    rig.setTier = (n) => {
      n = Math.max(1, Math.min(3, n | 0));
      if (rig.tier === n) return;
      const re = rig.merged && rig.unmerge;
      if (re) rig.unmerge();
      rig.tier = n;
      rig.tier2.visible = n >= 2;
      rig.tier3.visible = n >= 3;
      rd.position.y = n >= 2 ? 13.05 : 10.85;
      if (re) rig.remerge();
    };
    rig.setTier(D.tier || 1);
  }
  // 集貨站：貨箱堆
  if (id === 'v_yard') {
    rig.stacks = yardStacks(M);
    for (const s of rig.stacks) body.add(s);
    rig.stock = 0;
    rig.setStock = (f) => {
      f = Math.max(0, Math.min(1, f || 0));
      rig.stock = f;
      const n = f <= 0 ? 0 : Math.max(1, Math.ceil(f * rig.stacks.length - 1e-6));
      rig.stacks.forEach((s, i) => (s.visible = i < n));
    };
  }
  // 飛彈防禦塔的發射器
  if (id === 'v_sam') {
    const { tur, gun, muzzle } = samTurret(M);
    tur.position.set(0, 5, 0);
    body.add(tur);
    rig.turret = tur;
    rig.gun = gun;
    rig.muzzle = muzzle;
  }
  // 投放信標的頻閃燈
  if (id === 'v_beacon') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), addMat(VEER_LIME, 0.95));
    s.position.y = 6.0;
    selfAnim(s, { blink: 1.2, op: 0.95 });
    body.add(s);
    rig.strobe = s;
  }
  // 軌道通訊站的碟形天線
  if (id === 'v_uplink') {
    const dish = uplinkDish(M);
    dish.position.y = 8;
    selfAnim(dish, { spin: 0.12 });
    body.add(dish);
    rig.dish = dish;
  }
  rig.aimAt = (yaw, pitch = 0) => {
    if (rig.turret) rig.turret.rotation.y = yaw;
    if (rig.gun) rig.gun.rotation.x = Math.max(-0.1, Math.min(1.2, pitch));
  };
  return rig;
}

// ---------- 投放艙（原點在艙底；doors 依開啟程度轉、flame＝底部的減速噴焰） ----------
export function buildDropPod(pal) {
  const M = mats(pal);
  const g = new THREE.Group();
  const k = new PK();
  k.cyl(M.dark, 1.3, 1.5, 0.5, 0, 0.25, 0, 0, 0, 0, 10);
  k.cyl(M.team, 0.4, 1.0, 1.6, 0, 3.6, 0, 0, 0, 0, 10);
  k.cyl(M.black, 0.15, 0.4, 0.6, 0, 4.7, 0, 0, 0, 0, 8);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    k.prism(
      M.yellow,
      [
        [0, 0],
        [0.9, 0],
        [0, 2.2],
      ],
      0.1,
      Math.cos(a) * 1.3,
      0.4,
      Math.sin(a) * 1.3,
      0,
      -a,
      0,
    );
  }
  k.build(g);
  const doors = [];
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const hinge = new THREE.Group();
    hinge.position.set(Math.cos(a) * 1.05, 0.5, Math.sin(a) * 1.05);
    hinge.rotation.y = -a + Math.PI / 2;
    const kk = new PK();
    kk.cb(i ? M.olive : M.olive2, 1.8, 2.4, 0.16, 0, 1.2, 0, 0, 0, 0, 0.04);
    hazard(kk, M.yellow, M.black, 1.2, 0.18, 0, 2.1, 0.09);
    kk.build(hinge);
    g.add(hinge);
    doors.push(hinge);
  }
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.9, 3.2, 10), addMat(0xffb060, 0.75));
  flame.position.y = -1.6;
  flame.rotation.x = Math.PI;
  flame.castShadow = false;
  g.add(flame);
  return {
    group: g,
    doors,
    flame,
    // 艙門：0＝關、1＝全開（往外倒）
    setOpen(f) {
      for (const h of doors) h.rotation.x = Math.max(0, Math.min(1, f)) * 1.3;
    },
  };
}

// ---------- 空投運輸機的吊掛（運輸機模型的 torso 底下；rig.rtsCargo，放下時隱藏） ----------
export function addCarrierCargo(rig, defId) {
  if (!rig || rig.rtsCargo) return rig;
  const re = rig.merged && rig.unmerge;
  if (re) rig.unmerge();
  const t = rig.torso || rig.group;
  const D = defId && RTS_DEFS[defId];
  const s = D && D.foot ? Math.max(0.75, Math.min(1.5, Math.max(D.foot[0], D.foot[1]) / 10)) : 1;
  const M = mats(palOf(0));
  const k = new PK();
  // 吊架與四條吊索
  k.box(M.steel, 1.6, 0.25, 2.4, 0, -0.9, 0.1);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      k.bar(M.steel, [sx * 0.6, -0.9, sz * 1.0 + 0.1], [sx * 1.0 * s, -2.6, sz * 2.2 * s + 0.1], 0.05);
  container(k, M, 2.2 * s, 1.8 * s, 4.6 * s, 0, -2.6 - 1.8 * s, 0.1, Math.PI / 2, M.olive2, true);
  const g = k.build(new THREE.Group());
  const sc = 1 / ((rig.group && rig.group.scale.x) || 1);
  g.scale.setScalar(sc);
  t.add(g);
  rig.rtsCargo = g;
  if (re) rig.remerge();
  return rig;
}

// ---------- 物流無人機（集貨站 → 調度中心的小型四旋翼，帶一個貨箱；原點在機體中心） ----------
export function buildHaulDrone(pal) {
  const M = mats(pal);
  const k = new PK();
  k.cb(M.olive, 0.9, 0.35, 0.9, 0, 0, 0, 0, 0, 0, 0.06);
  for (const a of [0.785, 2.356, 3.927, 5.498]) {
    k.bar(M.dark, [0, 0, 0], [Math.cos(a) * 1.0, 0.1, Math.sin(a) * 1.0], 0.08);
    k.cyl(M.yellow, 0.45, 0.45, 0.04, Math.cos(a) * 1.0, 0.18, Math.sin(a) * 1.0, 0, 0, 0, 10);
  }
  k.cb(M.olive2, 0.8, 0.6, 0.8, 0, -0.7, 0, 0, 0, 0, 0.04);
  hazard(k, M.yellow, M.black, 0.6, 0.12, 0, -0.5, 0.42);
  k.box(M.glow, 0.15, 0.1, 0.15, 0, 0.22, 0);
  return k.build(new THREE.Group(), false);
}

// ---------- 臨時信標（偵察無人機降落變成的、沒有實體；原點在地面） ----------
export function buildTempBeacon(pal) {
  const M = mats(pal);
  const g = new THREE.Group();
  const k = new PK();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    k.bar(M.yellow, [Math.cos(a) * 0.8, 0, Math.sin(a) * 0.8], [0, 1.4, 0], 0.1);
  }
  k.cb(M.olive, 0.6, 0.5, 0.6, 0, 1.4, 0, 0, 0, 0, 0.05);
  k.cyl(M.steel, 0.04, 0.05, 1.2, 0, 2.2, 0, 0, 0, 0, 6);
  k.build(g, false);
  const s = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), addMat(VEER_LIME, 0.95));
  s.position.y = 2.9;
  g.add(s);
  g.userData.strobe = s;
  return g;
}

// ---------- 物流 MT 的貨架與吊鉤 ----------
// 背上的貨架（貨箱與綁帶）、吊臂與吊鉤（rig.rtsHook：採集時放下）、頭頂的信號燈、右手的絞盤（rig.rtsDrill：
// 採集、修理時轉）、攜帶礦石的貨箱（rig.rtsCrate）
export function addVeerWorkerKit(rig, pal, buildOreCrate) {
  const t = rig.torso || rig.group;
  const M = mats(pal);
  const kit = new THREE.Group();
  const k = new PK();
  // 貨架：框＋兩個小貨箱
  for (const s of [-1, 1]) k.box(M.steel, 0.08, 1.3, 0.08, s * 0.45, 1.75, 0.95);
  k.box(M.steel, 1.0, 0.08, 0.6, 0, 1.15, 0.75);
  k.box(M.steel, 1.0, 0.08, 0.08, 0, 2.4, 0.95);
  k.cb(M.olive2, 0.8, 0.45, 0.5, 0, 1.45, 0.75, 0, 0, 0, 0.03);
  k.cb(M.team, 0.7, 0.4, 0.45, 0, 1.9, 0.72, 0, 0.1, 0, 0.03);
  // 吊臂（黃黑）
  k.bar(M.yellow, [0.3, 2.4, 0.85], [0.3, 3.1, 0.2], 0.14);
  k.bar(M.yellow, [0.3, 3.1, 0.2], [0.3, 3.0, -0.9], 0.12);
  hazard(k, M.yellow, M.black, 0.8, 0.16, 0, 1.2, 1.06);
  k.build(kit);
  // 吊索（rtsCable：上端在吊臂尖，長度＝scale.y）與吊鉤（rtsHook：掛在吊索下端）；採集時放下
  const cable = new THREE.Group();
  cable.position.set(0.3, 2.95, -0.9);
  const ck = new PK();
  ck.box(M.steel, 0.04, 1, 0.04, 0, -0.5, 0);
  ck.build(cable);
  cable.scale.y = HOOK_UP;
  kit.add(cable);
  const hook = new THREE.Group();
  hook.position.set(0.3, 2.95 - HOOK_UP, -0.9);
  const hk = new PK();
  hk.cb(M.yellow, 0.22, 0.2, 0.22, 0, -0.05, 0, 0, 0, 0, 0.03);
  hk.geo(M.black, new THREE.TorusGeometry(0.12, 0.04, 4, 8, Math.PI * 1.5), 0, -0.26, 0, 0, Math.PI / 2, 0);
  hk.build(hook);
  kit.add(hook);
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8), glowMat(VEER_LIME, 2));
  beacon.position.set(-0.3, 2.5, 0.95);
  kit.add(beacon);
  t.add(kit);
  if (buildOreCrate) {
    const crate = buildOreCrate();
    crate.position.set(0, 0.9, 1.15);
    crate.scale.setScalar(0.75);
    crate.visible = false;
    t.add(crate);
    rig.rtsCrate = crate;
  }
  // 右手的絞盤
  const hand = rig.arms && rig.arms.r && rig.arms.r.hand;
  if (hand) {
    const dk = new PK();
    dk.cyl(M.dark, 0.18, 0.18, 0.36, 0, -0.35, 0, 0, 0, Math.PI / 2, 8);
    dk.box(M.yellow, 0.06, 0.4, 0.06, 0, -0.35, 0.16);
    const drum = dk.build(new THREE.Group());
    hand.add(drum);
    rig.rtsDrill = drum;
  }
  rig.rtsKit = kit;
  rig.rtsHook = hook;
  rig.rtsCable = cable;
  rig.rtsBeacon = beacon;
  // 吊鉤放下的程度（0＝收起、1＝放到地面附近）
  rig.setHook = (f) => {
    f = Math.max(0, Math.min(1, f));
    const L = HOOK_UP + (HOOK_DOWN - HOOK_UP) * f;
    cable.scale.y = L;
    hook.position.y = 2.95 - L;
  };
  return rig;
}

// ---------- 模型庫目錄 ----------
const P0 = () => palOf(0);
const bldNote = (id) => {
  const D = RTS_DEFS[id];
  return `Coral 戰爭（維爾威）；佔地 ${D.foot[0]} × ${D.foot[1]} m、高約 ${D.height} m，原點在底面中心、正面 +Z；隊伍色在塗裝帶，黃黑警示條固定`;
};
const withState = (id, f) => {
  const r = buildVeerBuilding(id, P0());
  if (r.setTier) r.setTier(RTS_DEFS[id].tier || 1);
  f(r);
  return r.group;
};
export const RTS_VEER_CATALOG = [
  ...[
    ['v_hq', '維爾威：調度中心', '；降落平台＋管制塔，可以收起搬家'],
    ['v_hq2', '維爾威：物流總站（調度中心 T2）', '；貨櫃吊臂與堆疊的貨櫃'],
    ['v_hq3', '維爾威：軌道管制塔（調度中心 T3）', '；衛星天線與天線桅'],
    ['v_depot', '維爾威：補給艙', '；疊起來的居住艙'],
    ['v_yard', '維爾威：集貨站', '；平台上依庫存疊 0～6 堆貨箱'],
    ['v_extractor', '維爾威：Coral 抽取站', '；蓋在 Coral 湧出點上（不能收起）'],
    ['v_bay', '維爾威：軌道調度所', '；投放艙的發射架與接收環'],
    ['v_hangar', '維爾威：機庫', '；半圓拱頂與跑道標線'],
    ['v_lab', '維爾威：工程研究室', '；貨櫃組成的實驗室'],
    ['v_beacon', '維爾威：投放信標', '；綠色頻閃燈'],
    ['v_sam', '維爾威：飛彈防禦塔', '；發射器朝目標轉動'],
    ['v_market', '維爾威：物流倉庫', '；開放式貨架與堆高機'],
    ['v_uplink', '維爾威：軌道通訊站', '；大型碟形天線慢慢轉'],
  ].map(([id, name, extra]) => ['prop', id, name, bldNote(id) + extra, () => withState(id, () => {})]),
  [
    'prop',
    'v_site',
    '維爾威：空投展開中的建築（機庫 45%）',
    'Coral 戰爭；空投的地基自己展開：貨櫃板依序立起、本體長高',
    () => withState('v_hangar', (r) => r.setProgress(0.45)),
  ],
  [
    'prop',
    'v_packed',
    '維爾威：收起的建築（軌道調度所）',
    'Coral 戰爭；起落架收起、涵道風扇轉成水平並轉動、正面的貨櫃板闔上',
    () => withState('v_bay', (r) => r.setPack(1)),
  ],
  [
    'prop',
    'v_yard_full',
    '維爾威：集貨站（庫存滿）',
    'Coral 戰爭；庫存 100%：6 堆貨箱',
    () => withState('v_yard', (r) => r.setStock(1)),
  ],
  [
    'small',
    'v_pod',
    '維爾威：投放艙',
    'Coral 戰爭；軌道調度所的單位從投放艙降下（艙門半開）；原點在艙底',
    () => {
      const p = buildDropPod(P0());
      p.setOpen(0.5);
      p.flame.visible = false;
      return p.group;
    },
  ],
  [
    'vehicle',
    'v_worker',
    '維爾威：物流 MT',
    'Coral 戰爭的工人；逆關節的輕量機甲＋背上的貨架與吊鉤、右手的絞盤',
    () => {
      const rig = buildMech(RTS_DEFS.v_worker.asm, P0(), 1);
      return addVeerWorkerKit(rig, P0()).group;
    },
  ],
  [
    'small',
    'v_haul',
    '維爾威：物流無人機',
    'Coral 戰爭；集貨站把礦石運到調度中心（只是特效）',
    () => buildHaulDrone(P0()),
  ],
  [
    'small',
    'v_tbeacon',
    '維爾威：臨時信標',
    'Coral 戰爭；偵察無人機降落變成的臨時投放信標',
    () => buildTempBeacon(P0()),
  ],
];
