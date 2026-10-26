// ============================================================
//  WORLD — 隨機關卡生成
// ============================================================
import { RNG, clamp, lerp, makeNoise, makeRng, pick, rnd, rndi, withRng } from '../core/math.js';
import { DS, MS, WS } from '../core/scale.js';
import {
  JERSEY,
  SEMI,
  TWALL,
  buildJersey,
  buildSemiTruck,
  buildTWall,
  buildWarehouse,
  warehouseRidge,
} from './cover-models.js';
import { mergeStatic } from '../render/mesh-merge.js';
import {
  LANE_MARK,
  RAIL_STRIPS,
  RAIL_TIE,
  ROAD_STRIPS,
  box,
  ISO,
  buildContainerStack,
  buildDebris,
  buildDeck,
  buildGridPillar,
  buildLampPost,
  buildPillar,
  buildRock,
  buildTunnelPortal,
  buildDerrick,
  buildIceSheet,
  buildMiningRig,
  buildPipeline,
  derrickBase,
  floodW,
  buildPipeSupport,
  buildWreckArch,
  buildWreckHull,
  buildFloodlight,
  buildMtWreck,
  buildOreHopper,
  buildRockSpire,
  buildSandFence,
  buildSandstone,
  buildScrap,
  buildStorageTank,
  HOPPER,
  MT_WRECK,
  DOME_R,
  QUONSET,
  buildBeacon,
  buildIceChunk,
  buildIceShard,
  buildObsDome,
  buildQuonset,
  buildRadarDish,
  RADAR_S,
  buildThemeDeck,
  buildThemePillar,
  buildThemePlatform,
  buildThemeRamp,
  buildThemeTunnel,
  buildThemeWall,
  SAND_FENCE_H,
  MINING_RIG,
  PIPE,
  WRECK_ARCH,
  WRECK_HULL,
  propMats,
  corridorPiece,
  deckMats,
  mat,
  stripMesh,
} from './prop-models.js';
import { propShape, shapeContains, shapeSegT } from './prop-hit.js';
import { Weather } from './weather.js';
import { FAR_R, OOB_BUF, buildBackdrop, edgeDelta, planEdges } from './edges.js';
import { NavGrid } from './nav.js';
import { mergeRtsProps, rtsPropMesh } from './rts-props.js';
import { rtsReserveWater, rtsDuneShade } from './rts-map.js';
import { LANDMARKS } from './landmarks.js';
import { buildLandingZone, buildLiftPad, variantOf } from './variants.js';
import { DAM } from './themes/dam.js';
import { FLOODED } from './themes/flooded.js';
import { GRID086 } from './themes/grid086.js';
import { INSTITUTE } from './themes/institute.js';
import { ORBIT } from './themes/orbit.js';
import { SPACEPORT } from './themes/spaceport.js';
import { XYLEM } from './themes/xylem.js';

const _seg = new THREE.Vector3(); // propBlocks 的暫存
// 網格建造在 prop-models.js（純函式）；這裡只用亂數決定參數與位置，亂數呼叫順序不可改變
// 主題的公路／鐵路設定：{ p 出現機率, kinds 可出現的種類 }（noCorridor 時沒有）
export function corridorSpec(T) {
  if (T.noCorridor) return { p: 0, kinds: [] };
  return T.corridor || { p: 0.6, kinds: ['road', 'rail'] };
}
// 局部座標 (lx, lz) 繞 Y 轉 q×90° 後的位置（與 Object3D.rotation.y = q×π/2 一致）
const rotQ = (q, lx, lz) =>
  [
    [lx, lz],
    [lz, -lx],
    [-lx, -lz],
    [-lz, lx],
  ][q];
// 群組裡可透明的材質（鏡頭遮擋時半透明）
// 正方形高度圖（row-major，j × N + i）雙線性重新取樣成 N2 × N2：兩者都涵蓋整張地圖（自訂關卡的舊格子）
function resampleGrid(src, N2) {
  const N = Math.round(Math.sqrt(src.length));
  const out = new Float32Array(N2 * N2);
  const at = (i, j) => src[Math.min(N - 1, j) * N + Math.min(N - 1, i)];
  for (let j = 0; j < N2; j++)
    for (let i = 0; i < N2; i++) {
      const fx = (i * (N - 1)) / (N2 - 1),
        fz = (j * (N - 1)) / (N2 - 1);
      const x0 = Math.floor(fx),
        z0 = Math.floor(fz),
        u = fx - x0,
        v = fz - z0;
      out[j * N2 + i] = lerp(
        lerp(at(x0, z0), at(x0 + 1, z0), u),
        lerp(at(x0, z0 + 1), at(x0 + 1, z0 + 1), u),
        v,
      );
    }
  return out;
}
function fadeMatsOf(g) {
  const out = [];
  g.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m.transparent && !out.includes(m)) out.push(m);
  });
  return out;
}
// 場地：邊長預設 MAP_SIZE（主題可用 size 另訂）；k＝size／150（原本的場地 150 m），
// 場地內的位置範圍都乘上 k、物件數量乘上 (k／G)²（cnt）。機甲三倍高改版（core/scale.js）：場地與地形放大 G 倍，
// 地形的尺寸寫成「舊數字 * G」；物件照現實尺寸（docs/world-scale.md）
const G = WS;
const ARENA = 150,
  MAP_SIZE = 230 * G,
  CELL = 5; // 地形格子：舊尺度 2.5 m（機甲 3.2 m）；地形照舊的形狀放大，5 m 相對機甲反而更細
// 冰原的冰湖：冰面高度
const ICE_Y = -0.7 * G;
// 機體站得上去的高低差（方塊的頂面在腳底這麼高以內就踩上去，否則擋住）
const STEP_H = 0.6 * MS;
// 主題的高度（水面、岩頂、虛空）跟著地形放大，霧跟著視距放大（Coral 戰爭的地圖另外處理，不經過這裡）
function scaleTheme(T) {
  const o = { ...T };
  if (T.water) o.water = { ...T.water, level: T.water.level * G };
  if (T.roof) o.roof = { ...T.roof, y: T.roof.y * G, bump: (T.roof.bump || 8) * G };
  if (T.void) o.void = { ...T.void, y: T.void.y * G, fall: T.void.fall * G, ref: T.void.ref * G };
  o.fogNear = (T.fogNear || 60) * DS;
  o.fogFar = (T.fogFar || 190) * DS;
  return o;
}
export const THEMES = {
  snow: {
    name: '極地封鎖區',
    corridor: { p: 0.6, kinds: ['road', 'rail'] },
    ground: 0xbfc8d1,
    slope: 0x3a4048,
    rock: 0x2c3238,
    fog: 0xb3bfcb,
    sky: 0xb7c4d0,
    sun: 0xfff2dc,
    amb: 0x8fa0b4,
    container: 0x6b7d6a,
    container2: 0xd7a23c,
    hasRocks: true,
    weather: 'snow',
    iceLake: true, // 冰湖用獨立的亂數串
    props: 'snow',
  },
  industrial: {
    name: '貨運集散場',
    corridor: { p: 0.85, kinds: ['road', 'rail'] },
    ground: 0x5c626a,
    slope: 0x40454c,
    rock: 0x4a4f56,
    fog: 0x9aa3ad,
    sky: 0xa9b3bc,
    sun: 0xfff0d0,
    amb: 0x8894a2,
    container: 0xe0a020,
    container2: 0x2b4fb0,
    hasRocks: false,
  },
  grid: {
    name: '模擬訓練場',
    corridor: { p: 0.5, kinds: ['road'] },
    ground: 0x9ea6b3,
    slope: 0x7a828e,
    rock: 0x6f757f,
    fog: 0xc4cbd6,
    sky: 0xcdd4de,
    sun: 0xfff6ea,
    amb: 0xa8b0bc,
    container: 0xd2d6de,
    container2: 0xc8ccd4,
    hasRocks: false,
    flat: true,
    grid: true,
  },
  desert: {
    name: '礦坑遺跡',
    corridor: { p: 0.6, kinds: ['road', 'rail'] },
    ground: 0x9c8360,
    slope: 0x5a4636,
    rock: 0x5a4636,
    fog: 0xd8c7a8,
    sky: 0xe3d4b7,
    sun: 0xffe8c0,
    amb: 0xb8a48a,
    container: 0x7c8790,
    container2: 0xb8452a,
    hasRocks: true,
  },
  // 以下為 AC6 風格的主題（各自走新的生成路徑，上面四個主題的亂數順序不變）
  // terrain：地形輪廓（canyon 峽谷台地、dunes 沙丘）；weather：天氣粒子（只有外觀）；
  // props：專屬的物件組（buildThemeProps）與主題版的地形特徵；size：場地邊長（m，預設 MAP_SIZE）
  wasteland: {
    name: '荒涼工業荒野',
    corridor: { p: 0.7, kinds: ['rail', 'rail', 'road'] },
    ground: 0x8a6f52,
    slope: 0x5e4a3a,
    rock: 0x4e3e33,
    fog: 0xc9b394,
    sky: 0xd2bfa0,
    sun: 0xffe2b8,
    amb: 0xa48d72,
    container: 0x6f7a80,
    container2: 0xa8482c,
    hasRocks: true,
    terrain: 'canyon',
    weather: 'dust',
    props: 'wasteland',
  },
  dunes: {
    name: '沙丘地帶',
    corridor: { p: 0.4, kinds: ['road'] },
    ground: 0xc9a06a,
    slope: 0xa77c4c,
    rock: 0x7a5a3c,
    fog: 0xe6cfa6,
    sky: 0xeedcb8,
    sun: 0xfff0d0,
    amb: 0xd0b48a,
    container: 0x8c8f86,
    container2: 0xc05a30,
    hasRocks: false,
    terrain: 'dunes',
    weather: 'sand',
    props: 'dunes',
  },
  flooded: FLOODED,
  dam: DAM,
  spaceport: SPACEPORT,
  grid086: GRID086,
  xylem: XYLEM,
  orbit: ORBIT,
  institute: INSTITUTE,
};
// 線性色調映射（賽璐璐類渲染風格）時的曝光補正：線性不壓高光，白色的場景容易爆白、暗的場景補亮一點
// （render/style/pipeline.js 的 applyScene；ACES 等會壓高光的不套用）。變體可以用 theme.linExp 覆寫
const LIN_EXP = {
  snow: 0.7,
  grid: 0.86,
  dunes: 0.88,
  xylem: 0.82,
  orbit: 0.82,
  industrial: 0.94,
  spaceport: 0.9,
  flooded: 1.15,
  grid086: 1.2,
  institute: 1.15,
};
for (const k in LIN_EXP) THEMES[k].linExp = LIN_EXP[k];

// RTS 的沙丘地帶（plan.dunes，R6 之後的 C 包）：原本沙丘和地面同色、只有光影看得出起伏 →
// 丘間地面（沒有沙丘的地方）偏深的礫石色、沙丘本身是亮沙色（迎風面較亮、背風面較暗）、脊線最亮；陡坡照舊
function rtsDuneTint(P, T) {
  const shade = rtsDuneShade(P);
  if (!shade) return null;
  // 頂點色在線性空間（畫面上是 sRGB）：差距要大才看得出來
  const gravel = new THREE.Color(T.ground).lerp(new THREE.Color(0x4a3f35), 0.7),
    wind = new THREE.Color(T.ground).lerp(new THREE.Color(0xf2d6a0), 0.45),
    lee = new THREE.Color(T.ground).lerp(new THREE.Color(0x7a5232), 0.5),
    crest = new THREE.Color(0xfbe9bf),
    c = new THREE.Color();
  return (tmp, x, z, steep) => {
    const q = shade(x, z);
    // 丘間：平地換成礫石色（台地、山脊的陡坡照原本的），每面明暗不同（固定的雜湊，不用亂數）
    const flat = 1 - steep;
    const sp = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    const n = 0.92 + 0.16 * (sp - Math.floor(sp));
    c.copy(gravel).multiplyScalar(n);
    if (q.a <= 0) return void tmp.lerp(c, 0.9 * flat);
    tmp.lerp(c, 0.9 * flat * (1 - clamp(q.a / 0.2, 0, 1)));
    // 沙丘：迎風面亮、背風面暗、脊線最亮（坡腳 20% 高度內和礫石漸變）
    const k = clamp((q.a - 0.03) / 0.2, 0, 1);
    c.copy(q.lee ? lee : wind).lerp(crest, q.crest * 0.7);
    tmp.lerp(c, k);
  };
}

export class World {
  constructor(scene, theme, seed, level, feat, opt = {}) {
    this.scene = scene;
    this.forceRail = !!opt.rail; // 武裝列車的關卡：一定有鐵路（主題允許時）
    this.forceRoad = !!opt.road; // 主線的護送區段：一定有公路（主題允許時）
    this.opt = opt;
    // 自訂關卡（level/format.js）：opt.level＝{ blank 空白底圖, props 產生器物件 all／big／none, h 高度圖, water 水面,
    // removed 移除的產生器物件 [[x, z]] }；全部在原本的亂數呼叫之外套用，一般地圖與主線不受影響
    const LV = (this.lvl = opt.level || null);
    // 主題變體（world/variants.js）：覆寫主題欄位、改地形、加結構；沒有變體時完全照原本生成
    // RTS（opt.rts＝world/rts-map.js 的 planRtsMap 結果）：不用變體
    this.variant = opt.rts || (LV && LV.blank) ? null : variantOf(theme, opt.variant);
    this.variantKey = this.variant ? opt.variant : '';
    this.theme =
      this.variant && this.variant.theme ? { ...THEMES[theme], ...this.variant.theme } : THEMES[theme];
    if (!opt.rts) this.theme = scaleTheme(this.theme);
    if (LV && LV.water !== null && LV.water !== undefined) {
      const W0 = this.theme.water || { color: 0x37586a, opacity: 0.85, rough: 0.12 };
      this.theme = { ...this.theme, water: { ...W0, level: LV.water } };
    }
    this.tod = opt.tod || ''; // 時間（主線）：'' 或 day／dusk／night／dawn
    this.depth = opt.depth || 0; // 垂直下降的深度（主線）：越深越暗
    this.themeKey = theme;
    this.size = opt.rts ? opt.rts.size : this.theme.size || MAP_SIZE;
    this.k = this.size / ARENA;
    this.cells = Math.round(this.size / CELL);
    this.lim = 62 * this.k; // 作戰區域（電腦機體 collide 限制在 ±lim）
    this.limOut = this.lim + OOB_BUF; // 玩家可以超出作戰區域到這裡（警告並推回），collide 的 soft
    if (opt.rts) {
      // RTS：作戰區域＝整張圖（地圖邊緣是斷崖），不能出界
      this.rts = opt.rts;
      this.lim = this.limOut = this.size / 2;
    }
    this.setZone(opt.zone, opt.zoneAxis);
    this.trackS = (this.size / 2) * 0.86; // 公路／鐵路兩端隧道口
    this.level = level;
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.noise2 = makeNoise(seed * 7 + 3);
    this.rng = makeRng(seed * 13 + 7);
    this.obstacles = [];
    this.occluders = [];
    this.meshes = [];
    // 純裝飾的小物件（碎石、廢鐵…）：建好地圖後依材質合併成少數網格（自訂關卡不合併：編輯器要能逐一移除）
    this.decorG = new THREE.Group();
    this.decorG.userData.noFade = true;
    scene.add(this.decorG);
    this.meshes.push(this.decorG);
    this.h = new Float32Array((this.cells + 1) * (this.cells + 1));
    withRng(seed * 31 + 11, () => {
      if (opt.rts) return this.buildRts(); // RTS 的地圖：只有 plan 給的地形與障礙物（一般地圖不經過這裡）
      if (feat) {
        this.features = feat.map((f) => ({
          k: f.k,
          kind: f.kind,
          dir: f.dir ? new THREE.Vector2(f.dir[0], f.dir[1]) : undefined,
          perp: f.perp ? new THREE.Vector2(f.perp[0], f.perp[1]) : undefined,
          off: f.off,
          width: f.width,
          depth: f.depth,
          bridges: f.bridges,
          deckW: f.deckW,
          center: f.center,
          span: f.span,
          rampL: f.rampL,
          deckH: f.deckH,
          count: f.count,
          len: f.len,
          bend: f.bend,
        }));
        this.featureNames = this.features
          .filter((f) => f.k !== 'corridor')
          .map(
            (f) =>
              ({
                river_bridge: '河道與橋梁',
                overpass: '高架橋',
                bunkers: '掩體群',
                trench: '壕溝',
                platforms: '高台',
              })[f.k],
          );
        const cf = this.features.find((f) => f.k === 'corridor');
        if (cf) {
          this.corridor = {
            kind: cf.kind,
            dir: cf.dir,
            perp: cf.perp,
            off: cf.off,
            width: 10,
            len: cf.len,
            bend: cf.bend || null,
          };
          this.featureNames.push(cf.kind === 'road' ? '穿越公路' : '穿越鐵路');
        }
      } else if (LV && LV.blank) {
        this.features = [];
        this.featureNames = [];
      } else {
        this.planFeatures();
      }
      this.buildTerrain();
      if (!(LV && LV.blank)) this.buildFeatures();
      const ob0 = this.obstacles.length,
        me0 = this.meshes.length;
      if (!(LV && (LV.blank || LV.props === 'none'))) this.buildProps();
      // 以下只在主線（或選了變體）時有：接在原本的亂數呼叫之後，不影響一般地圖
      if (this.variant && this.variant.build) this.variant.build(this);
      if (opt.landmark) this.addLandmark(opt.landmark);
      if (opt.entry) this.addEntry(opt.entry);
      if (LV) this.levelGenItems(ob0, me0);
      else mergeStatic(this.decorG, new Set(), true);
    });
    // 邊界外的遠景地形與剪影物件（edges.js，獨立的亂數串，不影響上面的生成）
    withRng(seed * 97 + 41, () => {
      for (const o of buildBackdrop(this) || []) {
        o.userData.noFade = true; // 鏡頭遮擋不淡出（fadeMeshes）
        scene.add(o);
        this.meshes.push(o);
      }
    });
    this.buildBoundary();
    // 天氣粒子：只有外觀，各端各自用 Math.random（不影響地圖）
    const wk = opt.weather === 'none' ? null : opt.weather || this.theme.weather;
    this.weather = wk ? new Weather(scene, wk, this.theme) : null;
  }
  // RTS 的對稱地圖（world/rts-map.js）：高度圖整張取代；跳過地形特徵、公路／鐵路、變體、大型結構、一般物件、
  // 邊界處理的地形修改（planEdges 只給遠景用）；障礙物照 plan 建，最後建導航格 this.nav
  buildRts() {
    const P = this.opt.rts;
    // 主題的覆寫（rts-map.js 的 RTS_THEMES[].look：不畫岩頂、不疊加時間、地表的光線與顏色）
    if (P.themeOver) this.theme = { ...this.theme, ...P.themeOver };
    const T = this.theme,
      S = this.size / 2;
    this.features = [];
    this.featureNames = [];
    this.corridor = null;
    if (P.h.length === this.h.length) this.h = Float32Array.from(P.h);
    // 遠景：地圖外以邊緣（斷崖頂）的高度往外延伸，再加邊界的段落
    this.baseH = (x, z) => this.terrainHeight(clamp(x, -S, S), clamp(z, -S, S));
    this.edges = planEdges(this);
    this.rtsTint = rtsDuneTint(P, T); // 沙丘地帶：沙丘與丘間地面的顏色（其他 RTS 主題是 null）
    this.buildTerrainMesh();
    if (T.water) this.addWater(T.water);
    const rp = [];
    for (const o of P.obstacles) {
      const g = rtsPropMesh(o, T);
      if (!g) continue;
      g.rotation.y = o.yaw || 0;
      const ob = this.addSmall(
        g,
        o.x,
        o.y,
        o.z,
        o.kind === 'box' ? { w: o.w, h: o.h, d: o.d } : { r: o.r, h: o.h },
      );
      // 圓柱（煙囪、天線桿、岩柱）也記頂面高度：空中單位飛過上方時不碰撞（collide 看 top），
      // rtsFlyAlt 依它爬升（groundAt 只看方塊）
      if (ob.kind === 'circle' && o.h) ob.top = o.y + o.h;
      rp.push(ob);
    }
    // 裝飾（plan.decor：技研都市的 Coral 脈）：不碰撞，和障礙物一起合併（迷霧的著色器同樣隱藏沒探索過的）
    for (const o of P.decor || []) {
      const g = rtsPropMesh(o, T);
      if (!g) continue;
      g.position.set(o.x, o.y, o.z);
      g.rotation.y = o.yaw || 0;
      this.scene.add(g);
      this.meshes.push(g);
      rp.push({ group: g, x: o.x, z: o.z });
    }
    mergeRtsProps(this, rp); // 外觀依材質靜態合併（world/rts-props.js；迷霧的隱藏改在著色器）
    // 冰湖（plan.ice）：冰面（地形的一部分：不受迷霧影響）；兩個鏡像的湖共用一張貼圖
    let ice0 = null;
    for (const L of P.ice || []) {
      const m = ice0 ? ice0.clone() : (ice0 = buildIceSheet(1, 1, makeRng(((P.seed >>> 0) * 3 + 1) >>> 0)));
      m.scale.set(L.rx, 1, L.rz);
      m.position.set(L.x, L.y + 0.05, L.z);
      m.rotation.y = -L.rot;
      // 不設 noFade：rts-fog.js 把 world.meshes 裡 noFade 的網格當成遠景一直隱藏
      m.updateMatrix(); // 靜止的冰面：矩陣先算好（RTS 的場景更新會略過沒有標記的節點）
      m.matrixAutoUpdate = false;
      m.updateMatrixWorld(true);
      this.scene.add(m);
      this.meshes.push(m);
    }
    this.nav = new NavGrid(this, { cell: 2 });
    for (const m of P.mines || []) this.nav.reserve(m.pos.x, m.pos.z, 7);
    for (const c of P.corals || []) this.nav.reserve(c.pos.x, c.pos.z, 5);
    // R5 的水面主題（汙染水沒市街、多重水壩）：水深 > 0.3 m 的格子不能蓋建築（同 validate；空投、展開都看 buildable）
    if (P.waterY !== undefined && T.water) rtsReserveWater(this.nav, T.water.level);
    // 冰湖不能蓋建築：沿長軸放幾個圓
    for (const L of P.ice || []) {
      const n = Math.ceil(L.rx / L.rz) + 1;
      for (let k = 0; k < n; k++) {
        const f = n > 1 ? (k / (n - 1)) * 2 - 1 : 0;
        const e = L.rx - L.rz;
        this.nav.reserve(L.x + Math.cos(L.rot) * e * f, L.z + Math.sin(L.rot) * e * f, L.rz + 1);
      }
    }
  }
  hAt(i, j) {
    i = clamp(i, 0, this.cells);
    j = clamp(j, 0, this.cells);
    return this.h[j * (this.cells + 1) + i];
  }
  terrainHeight(x, z) {
    const fx = (x + this.size / 2) / CELL,
      fz = (z + this.size / 2) / CELL;
    const i = Math.floor(fx),
      j = Math.floor(fz),
      u = fx - i,
      v = fz - j;
    return lerp(
      lerp(this.hAt(i, j), this.hAt(i + 1, j), u),
      lerp(this.hAt(i, j + 1), this.hAt(i + 1, j + 1), u),
      v,
    );
  }
  buildTerrain() {
    const T = this.theme,
      n = this.noise,
      n2 = this.noise2;
    // 新主題的地形輪廓（canyon／dunes）取代原本的起伏＋台地＋土丘；自訂關卡的空白底圖是平地（有水面時高出水面）
    const blankH = T.water ? Math.max(0, T.water.level + 1.2 * G) : 0;
    const prof =
      this.lvl && this.lvl.blank
        ? () => blankH
        : T.planTerrain
          ? T.planTerrain(this)
          : T.terrain === 'canyon'
            ? this.planCanyon()
            : T.terrain === 'dunes'
              ? this.planDunes()
              : null;
    const plateaus = [];
    const cliffPts = [];
    if (!prof) {
      const pc = T.flat ? this.cnt(0, 1) : this.cnt(2, 4);
      for (let k = 0; k < pc; k++)
        plateaus.push({
          x: rnd(-45 * this.k, 45 * this.k),
          z: rnd(-45 * this.k, 45 * this.k),
          w: rnd(14, 30) * G,
          d: rnd(14, 30) * G,
          h: rnd(3, 7) * G,
          r: rnd(4, 8) * G,
        });
      for (let k = 0, nc = T.flat ? 0 : this.cnt(2, 4); k < nc; k++)
        cliffPts.push({
          x: rnd(-55 * this.k, 55 * this.k),
          z: rnd(-55 * this.k, 55 * this.k),
          r: rnd(9, 16) * G,
          h: rnd(6, 10) * G,
        });
    }
    const lake = T.iceLake && !(this.lvl && this.lvl.blank) ? this.planIceLake() : null;
    // 基本輪廓（地圖外的遠景地形也用它往外延伸，farHeight）
    this.baseH = (x, z) =>
      prof
        ? prof(x, z)
        : T.flat
          ? 0
          : (n((x / G) * 0.03, (z / G) * 0.03) * 1.2 + n2((x / G) * 0.1, (z / G) * 0.1) * 0.3) * G;
    this.edges = planEdges(this);
    const vt = this.variant && this.variant.terrain ? this.variant.terrain(this) : null;
    for (let j = 0; j <= this.cells; j++)
      for (let i = 0; i <= this.cells; i++) {
        const x = i * CELL - this.size / 2,
          z = j * CELL - this.size / 2;
        let h = this.baseH(x, z);
        for (const p of plateaus) {
          const dx = Math.max(Math.abs(x - p.x) - p.w / 2, 0),
            dz = Math.max(Math.abs(z - p.z) - p.d / 2, 0);
          const d = Math.sqrt(dx * dx + dz * dz);
          const t = clamp(1 - d / p.r, 0, 1);
          h += p.h * (t * t * (3 - 2 * t));
        }
        for (const c of cliffPts) {
          const d = Math.hypot(x - c.x, z - c.z);
          const t = clamp(1 - d / c.r, 0, 1);
          h += c.h * t * t;
        }
        if (lake) h = lake.apply(x, z, h);
        if (vt) h = vt(x, z, h);
        h += edgeDelta(this, x, z); // 邊界外：依段落隆起、下降或延伸（edges.js）
        h = this.featureHeight(x, z, h);
        this.h[j * (this.cells + 1) + i] = h;
      }
    // smooth a little
    const s = new Float32Array(this.h);
    for (let j = 1; j < this.cells; j++)
      for (let i = 1; i < this.cells; i++) {
        s[j * (this.cells + 1) + i] =
          (this.hAt(i, j) * 4 +
            this.hAt(i - 1, j) +
            this.hAt(i + 1, j) +
            this.hAt(i, j - 1) +
            this.hAt(i, j + 1)) /
          8;
      }
    this.h = s;
    // 自訂關卡：整張高度圖（存的是平滑後的最終值）
    const LH = this.lvl && this.lvl.h;
    if (LH && LH.length === this.h.length) this.h = Float32Array.from(LH);
    else if (LH && Math.sqrt(LH.length) % 1 === 0)
      this.h = resampleGrid(LH, Math.round(Math.sqrt(this.h.length))); // 舊格子（三倍高改版前的關卡）
    this.buildTerrainMesh();
    if (T.water) this.addWater(T.water);
    if (T.roof) this.addRoof(T.roof);
    if (lake) {
      const ice = buildIceSheet(lake.rx, lake.rz, lake.rng);
      ice.position.set(lake.x, lake.level + 0.05, lake.z);
      ice.rotation.y = lake.rot;
      ice.userData.noFade = true;
      this.scene.add(ice);
      this.meshes.push(ice);
    }
    if (T.grid) {
      const gh = new THREE.GridHelper(this.size * 3, (this.size * 3) / (2.5 * G), 0x6b7280, 0x8b93a0);
      gh.position.y = 0.04;
      gh.material.transparent = true;
      gh.material.opacity = 0.35;
      this.scene.add(gh);
      this.meshes.push(gh);
    }
  }
  // 地形網格（關卡編輯器的筆刷改了高度後重建：keepMesh 時沿用同一個網格，只換幾何）
  buildTerrainMesh(keepMesh) {
    const T = this.theme;
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.cells, this.cells);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k),
        z = pos.getZ(k);
      pos.setY(k, this.terrainHeight(x, z));
    }
    const ng = geo.toNonIndexed();
    ng.computeVertexNormals();
    const col = new Float32Array(ng.attributes.position.count * 3);
    const cg = new THREE.Color(T.ground),
      cs = new THREE.Color(T.slope),
      cr = new THREE.Color(T.rock),
      tmp = new THREE.Color();
    const nr = ng.attributes.normal,
      pp = ng.attributes.position;
    for (let f = 0; f < pp.count; f += 3) {
      const ny = (nr.getY(f) + nr.getY(f + 1) + nr.getY(f + 2)) / 3;
      const y = (pp.getY(f) + pp.getY(f + 1) + pp.getY(f + 2)) / 3;
      const steep = clamp((0.93 - ny) * 6, 0, 1);
      tmp.copy(cg).lerp(cs, steep);
      if (y > 9 * G) tmp.lerp(cr, clamp((y - 9 * G) / (6 * G), 0, 0.7));
      if (this.rtsTint)
        this.rtsTint(
          tmp,
          (pp.getX(f) + pp.getX(f + 1) + pp.getX(f + 2)) / 3,
          (pp.getZ(f) + pp.getZ(f + 1) + pp.getZ(f + 2)) / 3,
          steep,
        );
      tmp.offsetHSL(0, 0, keepMesh ? ((f * 0.618) % 1) * 0.04 - 0.02 : rnd(-0.02, 0.02));
      for (let q = 0; q < 3; q++) {
        col[(f + q) * 3] = tmp.r;
        col[(f + q) * 3 + 1] = tmp.g;
        col[(f + q) * 3 + 2] = tmp.b;
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (keepMesh && this.terrainMesh) {
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.geometry = ng;
      return;
    }
    const m = new THREE.Mesh(
      ng,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    m.receiveShadow = true;
    m.castShadow = true;
    this.scene.add(m);
    this.meshes.push(m);
    this.terrainMesh = m;
  }
  // 峽谷台地（荒野）：低緩的谷底＋數座陡峭的平頂台地與孤峰（邊緣以雜訊打亂）
  planCanyon() {
    const n = this.noise,
      n2 = this.noise2;
    const mesas = [];
    const add = (big) => {
      for (let t = 0; t < 12; t++) {
        const x = rnd(-50 * this.k, 50 * this.k),
          z = rnd(-50 * this.k, 50 * this.k);
        if (Math.hypot(x, z) < (big ? 26 : 18) * G) continue;
        if (mesas.some((m) => Math.hypot(m.x - x, m.z - z) < (big ? 26 : 14) * G)) continue;
        const m = {
          x,
          z,
          w: (big ? rnd(14, 24) : rnd(4, 7)) * G,
          d: (big ? rnd(12, 22) : rnd(4, 7)) * G,
          h: (big ? rnd(9, 14) : rnd(7, 11)) * G,
          r: (big ? rnd(2.8, 4.5) : rnd(1.8, 2.8)) * G,
        };
        const a = rnd(0, Math.PI);
        m.c = Math.cos(a);
        m.s = Math.sin(a);
        mesas.push(m);
        return;
      }
    };
    for (let k = this.cnt(3, 5); k > 0; k--) add(true);
    for (let k = this.cnt(3, 5); k > 0; k--) add(false);
    return (x0, z0) => {
      const x = x0 / G,
        z = z0 / G; // 雜訊照舊尺度取樣
      let h = (n(x * 0.022, z * 0.022) * 1.8 + n2(x * 0.09, z * 0.09) * 0.45) * G;
      for (const m of mesas) {
        const dx0 = x0 - m.x,
          dz0 = z0 - m.z;
        const lx = dx0 * m.c - dz0 * m.s,
          lz = dx0 * m.s + dz0 * m.c;
        const dx = Math.max(Math.abs(lx) - m.w / 2, 0),
          dz = Math.max(Math.abs(lz) - m.d / 2, 0);
        const d = Math.hypot(dx, dz) + (n2(x * 0.17 + 3, z * 0.17) - 0.5) * 3 * G;
        const t = clamp(1 - d / m.r, 0, 1);
        // 台地中段一道階梯：t 介於 0.45～0.6 時停在 55% 的高度
        const k = t < 0.45 ? (t / 0.45) * 0.55 : t < 0.6 ? 0.55 : 0.55 + ((t - 0.6) / 0.4) * 0.45;
        h = Math.max(h, m.h * k * (1 - 0.06 * n(x * 0.3, z * 0.3)));
      }
      return h;
    };
  }
  // 沙丘：兩組不對稱的沙丘波（迎風緩、背風陡），走向以雜訊扭曲，高度以低頻雜訊調變
  planDunes() {
    const n = this.noise,
      n2 = this.noise2;
    const a = rnd(0, Math.PI * 2),
      a2 = a + rnd(0.5, 0.9);
    const d1 = [Math.cos(a), Math.sin(a)],
      d2 = [Math.cos(a2), Math.sin(a2)];
    const lam1 = rnd(24, 32),
      lam2 = rnd(10, 14),
      amp1 = rnd(5, 7) * G,
      amp2 = rnd(0.6, 1.1) * G,
      ph = rnd(0, 1);
    const dune = (p) => {
      const f = p - Math.floor(p);
      const s = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
      return s * s * (3 - 2 * s);
    };
    return (x0, z0) => {
      const x = x0 / G,
        z = z0 / G; // 波長與雜訊照舊尺度取樣
      const warp = n(x * 0.018, z * 0.018) * 1.1;
      const am = amp1 * (0.35 + 0.65 * n2(x * 0.012 + 7, z * 0.012 - 3));
      let h = dune((x * d1[0] + z * d1[1]) / lam1 + warp + ph) * am;
      h += dune((x * d2[0] + z * d2[1]) / lam2 + warp * 0.6) * amp2;
      return h + (n(x * 0.01 + 5, z * 0.01) * 2.5 + n2(x * 0.07, z * 0.07) * 0.25 - 1.5) * G;
    };
  }
  // 冰湖（冰原）：以獨立的亂數串決定，不動原本的亂數順序；湖面壓平到 level，邊緣以雜訊打亂成自然湖岸
  planIceLake() {
    const rng = makeRng(this.seed * 53 + 19);
    const ang = rng() * Math.PI * 2,
      dist = (30 + rng() * 14) * G;
    const L = {
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      rx: (12 + rng() * 6) * G,
      rz: (9 + rng() * 5) * G,
      rot: rng() * Math.PI,
      level: ICE_Y,
      rng,
    };
    const c = Math.cos(L.rot),
      s = Math.sin(L.rot),
      n2 = this.noise2;
    L.apply = (x, z, h) => {
      const dx = x - L.x,
        dz = z - L.z;
      const lx = dx * c - dz * s,
        lz = dx * s + dz * c;
      const d = Math.hypot(lx / L.rx, lz / L.rz) + (n2((x / G) * 0.08, (z / G) * 0.08) - 0.5) * 0.24;
      const t = clamp((1.15 - d) / 0.35, 0, 1);
      return lerp(h, L.level, t * t * (3 - 2 * t));
    };
    return L;
  }
  // 地圖外（遠景地形）的高度：同樣的輪廓＋邊界處理＋地形特徵；地圖裡就是 terrainHeight
  farHeight(x, z) {
    const S = this.size / 2;
    if (Math.abs(x) <= S && Math.abs(z) <= S) return this.terrainHeight(x, z);
    return this.featureHeight(x, z, this.baseH(x, z) + edgeDelta(this, x, z));
  }
  onCorridor(x, z, margin = 2) {
    const c = this.corridor;
    if (!c) return false;
    return Math.abs(this.corridorU(x, z)) < c.width / 2 + margin;
  }
  // 通道中心線：沿 dir 的參數 s，橫向偏移 off＋bend(s)。bend＝[幅度, 0 弓形／1 S 形]，null＝直線
  corridorBend(s) {
    const b = this.corridor && this.corridor.bend;
    if (!b) return 0;
    const t = clamp(s / (this.corridor.len / 2 + 18), -1, 1);
    return b[1] ? b[0] * Math.sin(Math.PI * t) : b[0] * (1 - t * t);
  }
  corridorSlope(s) {
    const b = this.corridor && this.corridor.bend;
    const L = this.corridor ? this.corridor.len / 2 + 18 : 1;
    if (!b || Math.abs(s) > L) return 0;
    const t = s / L;
    return b[1] ? ((b[0] * Math.PI) / L) * Math.cos(Math.PI * t) : (-2 * b[0] * t) / L;
  }
  // (x, z) 離通道中心線的橫向距離（有正負，沿 perp）
  corridorU(x, z) {
    const c = this.corridor;
    return x * c.perp.x + z * c.perp.y - c.off - this.corridorBend(x * c.dir.x + z * c.dir.y);
  }
  corridorPoint(s, u = 0) {
    const c = this.corridor;
    const o = c.off + this.corridorBend(s) + u;
    const x = c.dir.x * s + c.perp.x * o,
      z = c.dir.y * s + c.perp.y * o;
    return new THREE.Vector3(x, this.terrainHeight(x, z), z);
  }
  // 參數 s 處的行進方向（單位向量，XZ）
  corridorDir(s) {
    const c = this.corridor,
      k = this.corridorSlope(s);
    return new THREE.Vector2(c.dir.x + c.perp.x * k, c.dir.y + c.perp.y * k).normalize();
  }
  slopeOK(x, z) {
    const s =
      Math.abs(this.terrainHeight(x + 2 * G, z) - this.terrainHeight(x - 2 * G, z)) +
      Math.abs(this.terrainHeight(x, z + 2 * G) - this.terrainHeight(x, z - 2 * G));
    return s < 1.6 * G;
  }
  buildProps() {
    const T = this.theme;
    if (T.grid) {
      // 模擬訓練場的方塊（虛擬空間，本來就是機甲的尺寸：跟著放大 G 倍；數量依面積多一些）
      const pm = mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 });
      for (let k = 0, n = this.cnt(34, 50); k < n; k++) {
        let x = rnd(-55 * this.k, 55 * this.k),
          z = rnd(-55 * this.k, 55 * this.k);
        if (
          Math.hypot(x, z) < 10 * G ||
          this.onCorridor(x, z, 3) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 9 * G)
        )
          continue;
        const w = rnd(3, 7) * G,
          d = rnd(3, 7) * G,
          h = (RNG() < 0.3 ? rnd(2.5, 4) : rnd(9, 18)) * G;
        const { mesh: g, mat: m2 } = buildGridPillar(w, h, d, pm);
        g.position.set(x, h / 2, z);
        this.scene.add(g);
        this.meshes.push(g);
        const ob = {
          kind: 'box',
          x,
          z,
          w,
          d,
          top: h,
          y: 0,
          group: g,
          mats: propMats(g) || [m2],
          box: new THREE.Box3(
            new THREE.Vector3(x - w / 2, 0, z - d / 2),
            new THREE.Vector3(x + w / 2, h, z + d / 2),
          ),
        };
        this.obstacles.push(ob);
        this.regProp('pillarBlock', ob, 4000, 0xc9cdd5);
        this.occluders.push(ob);
      }
      return;
    }
    // 新主題有自己的一套物件（不用舊主題的貨櫃、卡車、路燈、岩石、碎塊）
    if (T.buildProps) return T.buildProps(this);
    if (T.props) return this.buildThemeProps(T.props);
    this.buildYardProps();
  }
  // 貨運集散場與礦坑遺跡（現實尺寸，docs/world-scale.md）：貨櫃區（貨櫃堆排成格子、堆與堆之間 8–12 m 的通道，
  // 疊 1–5 層：疊 2＝半身掩體、疊 4 以上＝全身掩體）、倉庫（全身）、聯結車與護欄（雜物）、T 型牆（低掩體）、
  // 照明桿；hasRocks 的主題另有巨石（雜物）與岩塊（掩體）。貨櫃堆與倉庫各自一份材質（擋住鏡頭時各自淡出）
  buildYardProps() {
    const T = this.theme,
      ind = this.themeKey === 'industrial';
    const COLS = [T.container, T.container2, 0x8b8f94, 0x8a3a2a, 0x2b4fb0, 0x6b7d6a];
    const own = (c, o) => {
      const m = mat(c, o).clone();
      m.transparent = true;
      return m;
    };
    // 貨櫃區
    for (let b = this.cnt(ind ? 5 : 2, ind ? 7 : 3); b > 0; b--) {
      const nx = rndi(2, 4),
        nz = rndi(1, 3),
        rows = rndi(2, 4),
        lane = rnd(8, 12);
      const L = ISO.L40,
        D = rows * ISO.W + (rows - 1) * 0.3;
      const bw = nx * L + (nx - 1) * lane,
        bd = nz * D + (nz - 1) * lane;
      const spot = this.findSpot([-bw / 2, bw / 2, -bd / 2, bd / 2], 2.5, 40);
      if (!spot) continue;
      const base = spot.lo - 0.1;
      for (let i = 0; i < nx; i++)
        for (let j = 0; j < nz; j++) {
          const skip = RNG() < 0.12, // 空位（通道變寬）
            lv = rndi(1, ind ? 5 : 3);
          const tops = [];
          for (let r = 0; r < rows; r++) tops.push(clamp(lv + rndi(-1, 1), 1, 5));
          const cms = [];
          for (let n = 0; n < 3; n++) cms.push(own(pick(COLS), { roughness: 0.6 })); // 每堆 3 種顏色（合併成少數網格）
          if (skip) continue;
          const lx = -bw / 2 + L / 2 + i * (L + lane),
            lz = -bd / 2 + D / 2 + j * (D + lane);
          const [px, pz] = rotQ(spot.q, lx, lz);
          const st = buildContainerStack(L, rows, 5, cms, own(0x2a2d31, { roughness: 0.7 }), tops);
          st.group.position.y = base;
          const sp = { x: spot.x + px, z: spot.z + pz, q: spot.q, rotY: spot.rotY };
          const low = Math.max(...tops) <= 2 && tops.every((t) => t === tops[0]);
          const shapes = low
            ? [{ box: [-L / 2, L / 2, -D / 2, D / 2], y: base, top: base + st.h }]
            : tops.map((t, r) => {
                const z0 = -D / 2 + r * (ISO.W + 0.3);
                return { box: [-L / 2, L / 2, z0, z0 + ISO.W], y: base, top: base + t * ISO.H };
              });
          const obs = this.addBig(st.group, sp, shapes);
          // 疊 2 層以下的貨櫃堆打得壞（整堆一起）；更高的不會壞
          if (low) this.regProp('container', obs[0], 2600 * tops[0] * rows, cms[0].color.getHex());
        }
    }
    // 倉庫
    for (let k = this.cnt(ind ? 2 : 1, ind ? 4 : 2); k > 0; k--) {
      const w = rnd(30, 50),
        d = rnd(20, 30),
        h = rnd(10, 13);
      const spot = this.findSpot([-w / 2 - 1, w / 2 + 1, -d / 2 - 6, d / 2 + 6], 2, 40);
      if (!spot) continue;
      const y = spot.lo - 0.2;
      const g = buildWarehouse(w, d, h, pick([0x8a9096, 0x9a8a72, 0x6a7a8a, 0x8a6a5a]));
      g.position.y = y;
      this.addBig(g, spot, [{ box: [-w / 2, w / 2, -d / 2, d / 2], y, top: y + warehouseRidge(d, h) }]);
    }
    // 聯結車（雜物，打得壞）
    this.scatter(this.cnt(ind ? 5 : 2, ind ? 8 : 4), 6, (x, z, y) => {
      const rot = RNG() < 0.5;
      const cm = own(pick(COLS), { roughness: 0.6 });
      const g = buildSemiTruck(cm);
      if (rot) g.rotation.y = Math.PI / 2;
      const sh = rot ? { w: SEMI[2], h: SEMI[1], d: SEMI[0] } : { w: SEMI[0], h: SEMI[1], d: SEMI[2] };
      this.addSmall(g, x, y - 0.05, z, sh, 'truck', 1600, cm.color.getHex());
    });
    // T 型牆（低掩體，成排）
    this.scatter(this.cnt(ind ? 4 : 3, ind ? 7 : 5), 8, (x, z, y) => {
      const n = rndi(4, 10),
        rot = RNG() < 0.5,
        len = n * TWALL.w;
      const g = buildTWall(n);
      if (rot) g.rotation.y = Math.PI / 2;
      const sh = rot ? { w: TWALL.d, h: TWALL.h, d: len } : { w: len, h: TWALL.h, d: TWALL.d };
      this.addSmall(g, x, y - 0.05, z, sh, 'twall', 600 * n, 0x8c8a84);
    });
    // 紐澤西護欄（雜物，機甲跨得過去）
    this.scatter(this.cnt(5, 9), 5, (x, z, y) => {
      const n = rndi(2, 6),
        rot = RNG() < 0.5,
        len = n * JERSEY.l;
      const g = buildJersey(n);
      if (rot) g.rotation.y = Math.PI / 2;
      const sh = rot ? { w: JERSEY.d, h: JERSEY.h, d: len } : { w: len, h: JERSEY.h, d: JERSEY.d };
      this.addSmall(g, x, y - 0.02, z, sh, 'barrier', 300 * n, 0xc8c4bc);
    });
    // 照明桿（高 10–14 m；細柱不擋子彈的視線判定）
    const pm = mat(0x33373c);
    for (let k = 0, n = this.cnt(10, 16); k < n; k++) {
      const x = rnd(-55 * this.k, 55 * this.k),
        z = rnd(-55 * this.k, 55 * this.k);
      if (Math.hypot(x, z) < 8 * MS || this.onCorridor(x, z, 2) || !this.slopeOK(x, z)) continue;
      const h = rnd(10, 14);
      const m = buildLampPost(h, pm);
      m.position.set(x, this.terrainHeight(x, z) + h / 2 - 0.3, z);
      this.scene.add(m);
      this.meshes.push(m);
      const ob = { kind: 'circle', x, z, r: 0.4, group: m, mats: [], box: null, h };
      this.obstacles.push(ob);
      this.regProp('pillar', ob, 800, 0x33373c);
    }
    // 岩石：巨石（1–3 m，雜物）與岩塊（6–14 m，掩體）
    if (T.hasRocks) {
      const rm = mat(T.rock, { roughness: 1 });
      const rock = (x, z, r, big) => {
        const m = buildRock(r, rm.clone());
        const rmats = propMats(m) || [m.material];
        for (const mm of rmats) mm.transparent = true;
        m.scale.set(rnd(0.8, 1.5), rnd(0.5, 1.0), rnd(0.8, 1.5));
        m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
        m.position.set(x, this.terrainHeight(x, z) + r * 0.2, z);
        this.scene.add(m);
        this.meshes.push(m);
        const ob = {
          kind: 'circle',
          x,
          z,
          r: r * 1.05,
          group: m,
          mats: rmats,
          box: new THREE.Box3().setFromObject(m),
        };
        this.obstacles.push(ob);
        if (big) this.occluders.push(ob);
        this.regProp('rock', ob, big ? 9000 : 1500, T.rock);
      };
      for (let k = 0, n = this.cnt(8, 14); k < n; k++) {
        const x = rnd(-58 * this.k, 58 * this.k),
          z = rnd(-58 * this.k, 58 * this.k);
        if (Math.hypot(x, z) < 12 * MS || this.onCorridor(x, z, 6)) continue;
        rock(x, z, rnd(6, 14), true);
      }
      for (let k = 0, n = this.cnt(20, 30); k < n; k++) {
        const x = rnd(-58 * this.k, 58 * this.k),
          z = rnd(-58 * this.k, 58 * this.k);
        if (Math.hypot(x, z) < 6 * MS || this.onCorridor(x, z, 3)) continue;
        rock(x, z, rnd(1, 3), false);
      }
    }
    // 碎屑（純裝飾，合併）
    const dm = mat(0x55595e);
    for (let k = 0, n = Math.round(60 * this.kk); k < n; k++) {
      const x = rnd(-60 * this.k, 60 * this.k),
        z = rnd(-60 * this.k, 60 * this.k);
      const m = buildDebris(rnd(0.3, 1.2), rnd(0.2, 0.5), rnd(0.3, 1.2), dm);
      m.position.set(x, this.terrainHeight(x, z) + 0.1, z);
      m.rotation.y = rnd(0, 3);
      m.castShadow = false;
      this.addDecorMesh(m);
    }
  }

  // ---------- 主題機制：虛空、保留區、水面、岩頂、光照 ----------
  // 虛空（主題的 void：{ y：低於這個地形高度＝虛空, fall：機體低於這個高度時拉回, ref：虛空上方的參考地面 }）
  get voidY() {
    return this.theme.void ? this.theme.void.fall : undefined;
  }
  // 地形低於 void.y 且上方沒有橋面（平台）的地方
  isVoid(x, z) {
    if (!this.theme.void || this.terrainHeight(x, z) >= this.theme.void.y) return false;
    return !this.obstacles.some((o) => o.deck && Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2);
  }
  // 高度上限、飛行高度用的地面：虛空上方以 void.ref 為準
  groundRef(x, z, y) {
    const g = this.groundAt(x, z, y);
    return this.theme.void ? Math.max(g, this.theme.void.ref) : g;
  }
  // 最靠近中心、不是虛空也不在保留區的平地（出生點找不到時、墜落沒有紀錄時用）
  safePoint() {
    for (let r = 0; r < 60 * this.k; r += 3 * G)
      for (let a = 0; a < 12; a++) {
        const x = Math.cos(a * 0.5236) * r,
          z = Math.sin(a * 0.5236) * r;
        if (
          !this.isVoid(x, z) &&
          !this.isReserved(x, z, 2 * G) &&
          this.slopeOK(x, z) &&
          !this.offLimits(x, z)
        )
          return new THREE.Vector3(x, this.terrainHeight(x, z), z);
      }
    return new THREE.Vector3(0, this.terrainHeight(0, 0), 0);
  }
  // 從 (x, z) 往外找最近不是虛空的位置（不是虛空地圖時原樣回傳）
  nearSolid(x, z) {
    if (!this.isVoid(x, z)) return [x, z];
    for (let r = 3 * G; r < 80 * this.k; r += 3 * G)
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos(a * 0.3927) * r,
          pz = z + Math.sin(a * 0.3927) * r;
        if (Math.abs(px) < this.lim - 2 * G && Math.abs(pz) < this.lim - 2 * G && !this.isVoid(px, pz))
          return [px, pz];
      }
    const p = this.safePoint();
    return [p.x, p.z];
  }
  // 保留區：大型結構（壩體…）佔的範圍 [x0, x1, z0, z1]，地形特徵與物件都避開
  reserve(x0, x1, z0, z1) {
    (this.reserved = this.reserved || []).push([x0, x1, z0, z1]);
  }
  isReserved(x, z, m = 0) {
    if (!this.reserved) return false;
    return this.reserved.some((r) => x > r[0] - m && x < r[1] + m && z > r[2] - m && z < r[3] + m);
  }
  // 水面（只有外觀）：{ level, color, opacity, rough, wide }
  addWater(W) {
    const ext = (FAR_R + 40) * 2; // 一律延伸到遠景地形外（wide 的海面、雲海也是）
    const geo = new THREE.PlaneGeometry(ext, ext);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: W.color,
        roughness: W.rough !== undefined ? W.rough : 0.08,
        metalness: 0.35,
        transparent: true,
        opacity: W.opacity || 0.8,
        depthWrite: false,
      }),
    );
    m.position.y = W.level;
    m.renderOrder = 2;
    m.receiveShadow = true;
    this.scene.add(m);
    this.meshes.push(m);
    this.waterMesh = m;
  }
  // 冰原的冰面（冰湖：地形在冰面高度 −0.7 附近）
  onIce(x, z) {
    return this.themeKey === 'snow' && Math.abs(this.terrainHeight(x, z) - ICE_Y) < 0.25 * G;
  }
  // 水深（主題的水面以下多深；沒有水面時 0）
  waterDepth(x, z) {
    const W = this.theme.water;
    return W ? W.level - this.terrainHeight(x, z) : 0;
  }
  // 岩頂（地下）：朝下的平面，只從下方看得到（俯視的鏡頭看得穿），不擋陰影
  addRoof(R) {
    const geo = new THREE.PlaneGeometry((FAR_R + 40) * 2, (FAR_R + 40) * 2, 48, 48);
    geo.rotateX(Math.PI / 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++)
      pos.setY(i, -this.noise((pos.getX(i) / G) * 0.02 + 9, (pos.getZ(i) / G) * 0.02) * (R.bump || 8 * G));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: R.color, roughness: 1, flatShading: true }),
    );
    m.position.y = R.y;
    m.userData.noFade = true; // 岩頂：俯視鏡頭本來就看得穿
    this.scene.add(m);
    this.meshes.push(m);
  }
  // 把主題的天空、霧、光源套到遊戲場景（任務、客機開局、實驗室共用）
  applyLight(g) {
    const T = this.theme;
    g.scene.background = new THREE.Color(T.sky);
    g.scene.fog = new THREE.Fog(T.fog, T.fogNear || 60 * DS, T.fogFar || 190 * DS);
    g.sun.color.set(T.sun);
    g.sun.intensity = T.sunI !== undefined ? T.sunI : 1;
    g.hemi.color.set(T.sky);
    g.hemi.groundColor.set(T.amb);
    g.hemi.intensity = 0.48 * (T.hemiI !== undefined ? T.hemiI : 1);
    // 主線：時間與深度（有岩頂的地下不受時間影響）
    const TOD = {
      dusk: { sun: 0xffa060, sky: 0xc8805a, k: 0.45, si: 0.8, hi: 0.85, ff: 0.9 },
      night: { sun: 0x8090c8, sky: 0x141a28, k: 0.8, si: 0.3, hi: 0.5, ff: 0.75 },
      dawn: { sun: 0xffc8a0, sky: 0xd8a8a0, k: 0.35, si: 0.75, hi: 0.85, ff: 0.95 },
    }[T.roof || T.noTod ? '' : this.tod]; // noTod：本身就是夜間的變體
    const dk = clamp(this.depth * 0.18, 0, 0.6);
    if (TOD || dk) {
      const sky = new THREE.Color(T.sky),
        fog = new THREE.Color(T.fog);
      let si = g.sun.intensity,
        hi = g.hemi.intensity,
        ff = T.fogFar || 190 * DS;
      if (TOD) {
        sky.lerp(new THREE.Color(TOD.sky), TOD.k);
        fog.lerp(new THREE.Color(TOD.sky), TOD.k * 0.85);
        g.sun.color.lerp(new THREE.Color(TOD.sun), 0.7);
        si *= TOD.si;
        hi *= TOD.hi;
        ff *= TOD.ff;
      }
      if (dk) {
        sky.lerp(new THREE.Color(0x000000), dk);
        fog.lerp(new THREE.Color(0x000000), dk * 0.8);
        si *= 1 - dk;
        hi *= 1 - dk * 0.6;
        ff *= 1 - dk * 0.5;
      }
      g.scene.background = sky;
      g.scene.fog = new THREE.Fog(fog, Math.min(T.fogNear || 60 * DS, ff * 0.4), ff);
      g.sun.intensity = si;
      g.hemi.color.copy(sky);
      g.hemi.intensity = hi;
    }
  }
  // 多人開局訊息：客機以同樣的參數生成（主線的變體、地標、時間…）與地形特徵
  netOpt() {
    const o = this.opt || {};
    const out = {};
    for (const k of [
      'rail',
      'road',
      'variant',
      'landmark',
      'tod',
      'weather',
      'depth',
      'zone',
      'zoneAxis',
      'entry',
    ])
      if (o[k] !== undefined && o[k] !== null && o[k] !== '') out[k] = o[k];
    return out;
  }
  netFeat() {
    return this.features.map((f) => ({
      k: f.k,
      kind: f.kind,
      dir: f.dir ? [f.dir.x, f.dir.y] : 0,
      perp: f.perp ? [f.perp.x, f.perp.y] : 0,
      off: f.off,
      width: f.width,
      depth: f.depth,
      bridges: f.bridges,
      deckW: f.deckW,
      center: f.center,
      span: f.span,
      rampL: f.rampL,
      deckH: f.deckH,
      count: f.count,
      len: f.len,
      bend: f.bend,
    }));
  }
  // ---------- 作戰區域（主線可以是狹長、小型或分段開放的矩形；一般任務是 ±lim） ----------
  setZone(shape = 'full', axis = 0) {
    const L = this.lim;
    let z = [-L, L, -L, L];
    if (shape && typeof shape === 'object') {
      // 自訂關卡畫的矩形（限制在場地內）
      z = [
        clamp(shape.x0, -L, L - 20 * G),
        clamp(shape.x1, -L + 20 * G, L),
        clamp(shape.z0, -L, L - 20 * G),
        clamp(shape.z1, -L + 20 * G, L),
      ];
      shape = 'rect';
    } else if (shape === 'long') {
      const n = L * 0.42;
      z = axis ? [-L, L, -n, n] : [-n, n, -L, L];
    } else if (shape === 'arena') {
      const n = L * 0.55;
      z = [-n, n, -n, n];
    } else if (shape === 'staged') {
      // 先開出生點這一半，之後 expandZone 擴大到全區
      z = axis ? [-L, L, -L, L * 0.2] : [-L, L * 0.2, -L, L];
    }
    this.zoneShape = shape || 'full';
    this.zone = z;
    this.zoneGoal = null;
  }
  expandZone() {
    const L = this.lim;
    this.zoneGoal = [-L, L, -L, L];
  }
  // 分段開放：作戰區域慢慢擴大（每秒 90 m）
  tickZone(dt) {
    if (!this.zoneGoal) return;
    let done = true;
    for (let i = 0; i < 4; i++) {
      const d = this.zoneGoal[i] - this.zone[i];
      if (Math.abs(d) > 0.01) {
        done = false;
        this.zone[i] += Math.sign(d) * Math.min(Math.abs(d), 30 * DS * dt);
      }
    }
    if (done) this.zoneGoal = null;
  }
  inZone(x, z, m = 0) {
    const Z = this.zone;
    return x > Z[0] + m && x < Z[1] - m && z > Z[2] + m && z < Z[3] - m;
  }
  // 超出作戰區域的距離（場內為 0）
  zoneExcess(x, z) {
    const Z = this.zone;
    return Math.max(0, Z[0] - x, x - Z[1], Z[2] - z, z - Z[3]);
  }
  // 自訂關卡：產生器放的物件（buildProps 之後的障礙物，依群組）＝可以在編輯器裡移除的項目；
  // props 'big' 時拿掉小型的，removed 的位置（[x, z]，比對群組位置 1.5 m 內）拿掉
  levelGenItems(ob0, me0) {
    const byG = new Map();
    for (const ob of this.obstacles.slice(ob0)) {
      if (!ob.group) continue;
      if (!byG.has(ob.group)) byG.set(ob.group, []);
      byG.get(ob.group).push(ob);
    }
    this.genItems = [];
    for (const [g, obs] of byG) {
      const b = new THREE.Box3().setFromObject(g);
      const sz = b.getSize(new THREE.Vector3());
      const c = b.getCenter(new THREE.Vector3());
      this.genItems.push({
        g,
        obs,
        x: g.position.x,
        z: g.position.z,
        c,
        small: Math.max(sz.x, sz.z) < 7 && sz.y < 7,
      });
    }
    // 沒有障礙物的裝飾也列進來（純外觀，不碰撞）
    for (const m of this.meshes.slice(me0))
      if (!byG.has(m) && !m.userData.noFade && m !== this.terrainMesh && m.position)
        this.genItems.push({ g: m, obs: [], x: m.position.x, z: m.position.z, small: true, decor: true });
    const L = this.lvl;
    for (const it of this.genItems.slice()) {
      if (
        (L.props === 'big' && it.small) ||
        (L.removed || []).some((r) => Math.hypot(r[0] - it.x, r[1] - it.z) < 1.5)
      )
        this.removeGenItem(it);
    }
  }
  removeGenItem(it) {
    it.g.visible = false;
    it.removed = true;
    for (const ob of it.obs) {
      const i = this.obstacles.indexOf(ob);
      if (i >= 0) this.obstacles.splice(i, 1);
      const j = this.occluders.indexOf(ob);
      if (j >= 0) this.occluders.splice(j, 1);
      if (ob.prop) ob.prop.dead = true;
    }
  }
  restoreGenItem(it) {
    it.g.visible = true;
    it.removed = false;
    for (const ob of it.obs) {
      if (!this.obstacles.includes(ob)) this.obstacles.push(ob);
      if (ob.mats && ob.mats.length && !this.occluders.includes(ob)) this.occluders.push(ob);
      if (ob.prop) ob.prop.dead = false;
    }
  }
  // 變體不能放東西的地方（坑道網的岩壁…）
  offLimits(x, z) {
    return !!(this.variant && this.variant.offLimits && this.variant.offLimits(this, x, z));
  }
  // 地標（world/landmarks.js）：找一塊夠平的地方放大型物件。地標是機甲尺度的大型場景物件，
  // 三倍高改版以舊尺度的造型整體放大 G 倍（外框、碰撞形狀、埋深一起放大）
  addLandmark(key) {
    const L0 = (LANDMARKS[this.themeKey] || {})[key];
    if (!L0) return null;
    const G = this.theme.void ? 2 : WS; // 虛空地圖（洋上都市、高空軌道）的平台有限，地標放大 2 倍
    const L = {
      ...L0,
      bx: L0.bx.map((v) => v * G),
      range: L0.range * G,
      sink: (L0.sink || 0) * G,
      shapes: L0.shapes.map((sh) =>
        sh.box
          ? { ...sh, box: sh.box.map((v) => v * G), y: sh.y * G, top: sh.top * G }
          : { ...sh, c: sh.c.map((v) => v * G), r: sh.r * G, h: sh.h * G },
      ),
      build: () => {
        const o = new THREE.Group();
        const g = L0.build();
        g.scale.multiplyScalar(G);
        o.add(g);
        return o;
      },
    };
    // 只避開大型障礙物（找不到時放寬地面高低差，大型地標可以部分埋進地面）；佔到位置的小物件移除
    // 平台很密的地圖（Grid 086）找不到時，佔到位置的平台也移除
    let big = (o) => (o.kind === 'box' ? o.deck || o.w * o.d > 60 * G : o.r > 3 * G);
    const all = this.obstacles;
    let spot = null;
    // 再找不到（洋上都市的街區被高樓佔滿）時，佔到位置的大型物件也移除
    for (const level of [0, 1, 2]) {
      if (spot) break;
      if (level === 1) big = (o) => (o.kind === 'box' ? !o.deck && o.w * o.d > 60 * G : o.r > 3 * G);
      if (level === 2) big = () => false;
      this.obstacles = all.filter(big);
      for (const k of [1, 1.8, 3]) if (!spot) spot = this.findSpot(L.bx, L.range * k, 90);
    }
    this.obstacles = all;
    if (!spot) return null;
    const [x0, x1, z0, z1] = spot.aabb;
    const hit = (o) =>
      o.kind === 'box'
        ? o.x + o.w / 2 > x0 - 1 && o.x - o.w / 2 < x1 + 1 && o.z + o.d / 2 > z0 - 1 && o.z - o.d / 2 < z1 + 1
        : o.x + o.r > x0 - 1 && o.x - o.r < x1 + 1 && o.z + o.r > z0 - 1 && o.z - o.r < z1 + 1;
    const gone = new Set(all.filter((o) => !big(o) && hit(o)));
    for (const o of gone) if (o.group) this.scene.remove(o.group);
    this.obstacles = all.filter((o) => !gone.has(o));
    this.occluders = this.occluders.filter((o) => !gone.has(o));
    for (const p of this.props || []) if (gone.has(p.ob)) p.dead = true;
    const g = L.build();
    const y = spot.lo - (L.sink || 0);
    g.position.y = y;
    this.addBig(
      g,
      spot,
      L.shapes.map((sh) => (sh.box ? { ...sh, y: y + sh.y, top: y + sh.top } : { ...sh })),
    );
    this.landmark = { key, name: L.name, x: spot.x, z: spot.z };
    return this.landmark;
  }
  // 主線的入口結構（出生點）：lift 升降梯平台、lz 降落區標示；不碰撞
  addEntry(kind) {
    const g = kind === 'lift' ? buildLiftPad() : kind === 'lz' ? buildLandingZone() : null;
    if (!g) return;
    g.position.set(0, this.terrainHeight(0, 0), 0);
    this.scene.add(g);
    this.meshes.push(g);
  }

  // ---------- 新主題的物件 ----------
  // 數量依場地面積放大（舊尺度的 k²：三倍高改版的場地放大不增加數量，物件的密度由各主題另外決定）
  cnt(a, b) {
    return Math.round(rndi(a, b) * this.kk);
  }
  // 數量的面積倍率（舊尺度的 k²）
  get kk() {
    const k = this.k / G;
    return k * k;
  }
  // 散布：找 n 個位置（避開出生點、公路／鐵路、其他障礙物間距 gap；slope 時避開斜坡），各呼叫 place(x, z, y)
  scatter(n, gap, place, slope = true) {
    for (let k = 0; k < n; k++) {
      let x,
        z,
        tries = 0;
      do {
        x = rnd(-52 * this.k, 52 * this.k);
        z = rnd(-52 * this.k, 52 * this.k);
        tries++;
      } while (
        tries < 20 &&
        (Math.hypot(x, z) < 10 * MS ||
          this.onCorridor(x, z, 4) ||
          this.offLimits(x, z) ||
          this.isVoid(x, z) ||
          this.isReserved(x, z, 3) ||
          (slope && !this.slopeOK(x, z)) ||
          this.obstacles.some((o) =>
            o.kind === 'box'
              ? Math.abs(x - o.x) < o.w / 2 + gap / 2 && Math.abs(z - o.z) < o.d / 2 + gap / 2
              : Math.hypot(o.x - x, o.z - z) < gap + (o.r > 3 ? o.r : 0),
          ))
      );
      if (tries >= 20) continue;
      place(x, z, this.terrainHeight(x, z));
    }
  }
  // 放一個小型物件並登記成障礙物：shape 為 { w, h, d }（方盒，底面在 y）或 { r, h }（圓柱）；
  // kind 有值時可破壞（regProp）
  addSmall(g, x, y, z, shape, kind, hp, color) {
    g.position.set(x, y, z);
    this.scene.add(g);
    this.meshes.push(g);
    const mats = propMats(g) || fadeMatsOf(g);
    const ob = shape.r
      ? {
          kind: 'circle',
          x,
          z,
          r: shape.r,
          group: g,
          mats,
          box: new THREE.Box3().setFromObject(g),
          h: shape.h,
        }
      : {
          kind: 'box',
          x,
          z,
          w: shape.w,
          d: shape.d,
          top: y + shape.h,
          y,
          group: g,
          mats,
          box: new THREE.Box3(
            new THREE.Vector3(x - shape.w / 2, y, z - shape.d / 2),
            new THREE.Vector3(x + shape.w / 2, y + shape.h, z + shape.d / 2),
          ),
        };
    this.obstacles.push(ob);
    if (mats.length) this.occluders.push(ob);
    if (kind) this.regProp(kind, ob, hp, color);
    return ob;
  }
  // 純裝飾（不碰撞）：n 個 make() 的網格，避開虛空；sink：往下埋的深度
  addDecor(n, make, sink = 0) {
    for (let k = 0; k < n; k++) {
      const x = rnd(-60 * this.k, 60 * this.k),
        z = rnd(-60 * this.k, 60 * this.k);
      const m = make();
      if (this.isVoid(x, z)) continue;
      m.position.set(x, this.terrainHeight(x, z) - sink, z);
      m.rotation.y = rnd(0, 6.28);
      this.addDecorMesh(m);
    }
  }
  // 純裝飾加進場景：一般地圖放進裝飾群組（之後合併），自訂關卡照舊各自一個（編輯器可以移除）
  addDecorMesh(m) {
    if (this.lvl) {
      this.scene.add(m);
      this.meshes.push(m);
      return;
    }
    // box()／cyl() 的 BoxGeometry／CylinderGeometry 帶材質分組（單一材質用不到），mergeStatic 不合併有分組的幾何：
    // 這些幾何每次都是新建的，清掉分組
    m.traverse((o) => {
      if (o.isMesh && !Array.isArray(o.material) && o.geometry && o.geometry.groups.length)
        o.geometry.clearGroups();
    });
    this.decorG.add(m);
  }
  // 純裝飾的廢鐵（不碰撞）
  addScrap(n, color) {
    for (let k = 0; k < n; k++) {
      const x = rnd(-60 * this.k, 60 * this.k),
        z = rnd(-60 * this.k, 60 * this.k);
      const m = buildScrap(rnd(0.8, 2), rnd(0.4, 1), rnd(0.6, 1.6), color);
      m.position.set(x, this.terrainHeight(x, z), z);
      m.rotation.y = rnd(0, 6.28);
      this.addDecorMesh(m);
    }
  }
  buildThemeProps(kind) {
    const T = this.theme;
    if (kind === 'wasteland') {
      this.buildMachinery();
      // 現實尺寸：料斗 12 × 15 m（全身）、儲槽直徑 10–24 m（全身）、岩柱 15–35 m、照明塔 20–35 m
      this.scatter(this.cnt(7, 11), 16, (x, z, y) => {
        const color = pick([0xb08a3e, 0x8c8f86, 0xa0522d]);
        const g = buildOreHopper(color);
        if (RNG() < 0.5) g.rotation.y = Math.PI / 2;
        this.addSmall(g, x, y - 0.4, z, { w: HOPPER[0], h: HOPPER[1], d: HOPPER[2] }, 'hopper', 7000, color);
      });
      this.scatter(this.cnt(4, 7), 18, (x, z, y) => {
        const r = rnd(5, 12),
          h = rnd(10, 18),
          color = pick([0x8a5a3a, 0x9a8f7a, 0x6f7a80]);
        this.addSmall(buildStorageTank(r, h, color), x, y - 0.3, z, { r: r * 1.02, h }, 'tank', 9000, color);
      });
      this.scatter(
        this.cnt(10, 16),
        14,
        (x, z, y) => {
          const r = rnd(4, 9),
            h = rnd(15, 35);
          const g = buildRockSpire(r, h, T.rock);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(g, x, y - 1.5, z, { r, h }, 'spire', 12000, T.rock);
        },
        false,
      );
      this.scatter(this.cnt(5, 8), 10, (x, z, y) => {
        const h = rnd(20, 35);
        const g = buildFloodlight(h, 0x4a4540);
        g.rotation.y = rnd(0, 6.28);
        this.addSmall(g, x, y - 0.3, z, { r: floodW(h), h }, 'floodlight', 1500, 0x4a4540);
      });
      this.addScrap(Math.round(60 * this.kk), 0x5a4a3e);
    } else if (kind === 'dunes') {
      this.buildWrecks();
      // 現實尺寸：MT 殘骸（MT 放大 3 倍）約 12 m、風蝕砂岩 15–25 m、防風牆高 3 m（低掩體）長 20–40 m
      this.scatter(this.cnt(6, 9), 16, (x, z, y) => {
        const color = pick([0x6a6f66, 0x7d7466, 0x5c6470]);
        const g = buildMtWreck(color);
        g.rotation.y = rnd(0, 6.28);
        const s = Math.max(MT_WRECK[0], MT_WRECK[2]);
        this.addSmall(g, x, y - 1.8, z, { w: s, h: MT_WRECK[1], d: s }, 'mtwreck', 6000, color);
      });
      this.scatter(
        this.cnt(8, 13),
        16,
        (x, z, y) => {
          const r = rnd(6, 10),
            h = rnd(15, 25);
          const g = buildSandstone(r, h, T.rock);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(g, x, y - 1.2, z, { r: r * 0.6, h }, 'sandstone', 12000, T.rock);
        },
        false,
      );
      this.scatter(
        this.cnt(6, 10),
        12,
        (x, z) => {
          const len = rnd(20, 40),
            rot = RNG() < 0.5,
            color = 0x9a8a72;
          const ex = rot ? 0 : len / 2,
            ez = rot ? len / 2 : 0;
          const y = Math.min(
            this.terrainHeight(x - ex, z - ez),
            this.terrainHeight(x + ex, z + ez),
            this.terrainHeight(x, z),
          );
          const g = buildSandFence(len, color);
          if (rot) g.rotation.y = Math.PI / 2;
          const shape = { w: rot ? 0.5 : len, h: SAND_FENCE_H, d: rot ? len : 0.5 };
          this.addSmall(g, x, y - 0.3, z, shape, 'fence', 1500, color);
        },
        false,
      );
      this.addScrap(Math.round(50 * this.kk), 0x8a7458);
    } else if (kind === 'snow') {
      this.buildIceField();
      // 現實尺寸：拱屋 12 × 18 m（半身）、冰塊 2–5 m 與冰丘 7–12 m、雷達天線約 17 m、信號燈桿 10–15 m
      this.scatter(this.cnt(7, 11), 16, (x, z, y) => {
        const color = pick([0x8a949e, 0x6b7d6a, 0xb8763a]);
        const g = buildQuonset(color);
        const rot = RNG() < 0.5;
        if (rot) g.rotation.y = Math.PI / 2;
        const [qw, qh, qd] = QUONSET;
        this.addSmall(
          g,
          x,
          y - 0.4,
          z,
          { w: rot ? qd : qw, h: qh, d: rot ? qw : qd },
          'quonset',
          6000,
          color,
        );
      });
      this.scatter(
        this.cnt(14, 22),
        10,
        (x, z, y) => {
          const big = RNG() < 0.35,
            r = big ? rnd(7, 12) : rnd(2, 5);
          const g = buildIceChunk(r);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(
            g,
            x,
            y - r * 0.15,
            z,
            { r: r * 0.95, h: r * 1.4 },
            'ice',
            big ? 10000 : 3000,
            0xbfe0f0,
          );
        },
        false,
      );
      this.scatter(this.cnt(3, 5), 18, (x, z, y) => {
        const color = 0xd8dde2;
        const g = buildRadarDish(color);
        g.rotation.y = rnd(0, 6.28);
        this.addSmall(g, x, y - 0.3, z, { r: 1.6 * RADAR_S, h: 7 * RADAR_S }, 'radar', 5000, color);
      });
      this.scatter(this.cnt(6, 10), 8, (x, z, y) => {
        const h = rnd(10, 15);
        this.addSmall(buildBeacon(h), x, y - 0.2, z, { r: 0.6, h }, 'beacon', 1000, 0xc8322a);
      });
      for (let k = 0, n = Math.round(30 * this.kk); k < n; k++) {
        const x = rnd(-60 * this.k, 60 * this.k),
          z = rnd(-60 * this.k, 60 * this.k);
        const m = buildIceShard(rnd(0.6, 1.6), rnd(0.2, 0.5), rnd(0.5, 1.3));
        m.position.set(x, this.terrainHeight(x, z), z);
        m.rotation.y = rnd(0, 6.28);
        this.scene.add(m);
        this.meshes.push(m);
      }
    }
  }
  // 冰原：舊時代觀測圓頂（大型，不可破壞）
  buildIceField() {
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const R = DOME_R + 1.2;
      const spot = this.findSpot([-R, R, -R, R + 3], 3 * G, 40);
      if (!spot) continue;
      const g = buildObsDome(0xc8d0d8);
      g.position.y = spot.lo - 0.6;
      this.addBig(g, spot, [{ c: [0, 0], r: R, h: 7 + DOME_R }]);
    }
  }
  // ---------- 大型物件的擺放（新主題）----------
  // 找一個放得下的位置：局部外框 [x0, x1, z0, z1]、繞 Y 轉 q×90°；避開出生點、公路／鐵路、其他障礙物，
  // 地面高低差不超過 maxRange。回傳 { x, z, q, rotY, lo, avg, aabb } 或 null
  findSpot(bx, maxRange, tries = 24) {
    for (let t = 0; t < tries; t++) {
      const x = rnd(-46 * this.k, 46 * this.k),
        z = rnd(-46 * this.k, 46 * this.k),
        q = rndi(0, 3);
      const c = [
        [bx[0], bx[2]],
        [bx[1], bx[2]],
        [bx[0], bx[3]],
        [bx[1], bx[3]],
      ].map(([lx, lz]) => rotQ(q, lx, lz));
      const a = [
        x + Math.min(...c.map((p) => p[0])),
        x + Math.max(...c.map((p) => p[0])),
        z + Math.min(...c.map((p) => p[1])),
        z + Math.max(...c.map((p) => p[1])),
      ];
      if (Math.max(Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3])) > 56 * this.k) continue;
      const nx = clamp(0, a[0], a[1]),
        nz = clamp(0, a[2], a[3]);
      if (Math.hypot(nx, nz) < 16 * MS) continue;
      let ok = true,
        lo = 1e9,
        hi = -1e9,
        sum = 0,
        cnt = 0;
      for (let sx = a[0]; sx <= a[1] + 1e-6 && ok; sx += Math.max(1, (a[1] - a[0]) / 6))
        for (let sz = a[2]; sz <= a[3] + 1e-6; sz += Math.max(1, (a[3] - a[2]) / 6)) {
          if (
            this.onCorridor(sx, sz, 3) ||
            this.isVoid(sx, sz) ||
            this.isReserved(sx, sz, 3) ||
            this.offLimits(sx, sz)
          ) {
            ok = false;
            break;
          }
          const h = this.terrainHeight(sx, sz);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
          sum += h;
          cnt++;
        }
      if (!ok || hi - lo > maxRange) continue;
      if (
        this.obstacles.some((o) =>
          o.kind === 'box'
            ? o.x + o.w / 2 + 3 > a[0] &&
              o.x - o.w / 2 - 3 < a[1] &&
              o.z + o.d / 2 + 3 > a[2] &&
              o.z - o.d / 2 - 3 < a[3]
            : o.x + o.r + 3 > a[0] && o.x - o.r - 3 < a[1] && o.z + o.r + 3 > a[2] && o.z - o.r - 3 < a[3],
        )
      )
        continue;
      return { x, z, q, rotY: (q * Math.PI) / 2, lo, avg: sum / cnt, aabb: a };
    }
    return null;
  }
  // 把群組加進場景並登記成障礙物（box 為局部的碰撞箱 [x0, x1, z0, z1]、底、頂；circle 為局部圓心與半徑）
  addBig(g, spot, shapes, occlude = true) {
    g.position.set(spot.x, g.position.y, spot.z);
    g.rotation.y = spot.rotY;
    this.scene.add(g);
    this.meshes.push(g);
    const mats = propMats(g) || fadeMatsOf(g);
    const obs = [];
    for (const s of shapes) {
      if (s.box) {
        const c = [rotQ(spot.q, s.box[0], s.box[2]), rotQ(spot.q, s.box[1], s.box[3])];
        const x0 = spot.x + Math.min(c[0][0], c[1][0]),
          x1 = spot.x + Math.max(c[0][0], c[1][0]),
          z0 = spot.z + Math.min(c[0][1], c[1][1]),
          z1 = spot.z + Math.max(c[0][1], c[1][1]);
        obs.push({
          kind: 'box',
          x: (x0 + x1) / 2,
          z: (z0 + z1) / 2,
          w: x1 - x0,
          d: z1 - z0,
          top: s.top,
          y: s.y,
          group: g,
          mats,
          deck: !!s.deck,
          box: new THREE.Box3(new THREE.Vector3(x0, s.y, z0), new THREE.Vector3(x1, s.top, z1)),
        });
      } else {
        const [px, pz] = rotQ(spot.q, s.c[0], s.c[1]);
        obs.push({
          kind: 'circle',
          x: spot.x + px,
          z: spot.z + pz,
          r: s.r,
          group: g,
          mats,
          box: null,
          h: s.h,
        });
      }
    }
    for (const o of obs) this.obstacles.push(o);
    if (occlude) {
      // 鏡頭遮擋用整個物件的外框（第一個障礙物代表）
      const o = obs[0];
      o.box = o.box || new THREE.Box3().setFromObject(g);
      this.occluders.push(o);
    }
    return obs;
  }
  // 荒野（現實尺寸）：斗輪採掘機殘骸（地標，長約 140 m）、高架輸送管線（管底離地 12 m 以上，機甲從底下通過）、
  // 鑽井架（30–45 m）
  buildMachinery() {
    const R = MINING_RIG;
    const [bw, bh, bd] = R.body;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const spot = this.findSpot([-bw * 0.6, bw * 0.6, R.wheelZ - R.wheelR - 2, bd * 1.3], 4.5 * G, 40);
      if (!spot) continue;
      const g = buildMiningRig(pick([0xc8a040, 0xb07a38, 0x8c8f86]));
      g.position.y = spot.lo - 1.2;
      this.addBig(g, spot, [
        { box: [-bw / 2, bw / 2, -bd / 2, bd / 2], y: spot.lo - 1.2, top: spot.lo - 1.2 + bh },
        { c: [0, R.wheelZ], r: R.wheelR - 1.6, h: R.wheelY + R.wheelR },
      ]);
    }
    // 高架管線：試幾條軸向的直線，取沿線最高點最低的一條，管底在最高點上方 12 m（機甲 9.7 m 從底下通過）
    for (let k = this.cnt(1, 2); k > 0; k--) {
      let best = null;
      for (let t = 0; t < 6; t++) {
        const axis = rndi(0, 1),
          off = rnd(-40 * this.k, 40 * this.k);
        let maxH = -1e9;
        for (let s = -50 * this.k; s <= 50 * this.k; s += 3 * G) {
          const x = axis ? s : off,
            z = axis ? off : s;
          maxH = Math.max(maxH, this.terrainHeight(x, z));
        }
        if (this.obstacles.some((o) => o.pipeAxis === axis && Math.abs(o.pipeOff - off) < 20 * G)) continue;
        if (!best || maxH < best.maxH) best = { axis, off, maxH };
      }
      if (!best) continue;
      const len = Math.floor((99 * this.k) / PIPE.seg) * PIPE.seg,
        y0 = best.maxH + 12,
        color = 0xb89a5a;
      const g = buildPipeline(len, color);
      g.position.set(best.axis ? 0 : best.off, y0 + PIPE.r, best.axis ? best.off : 0);
      if (best.axis) g.rotation.y = Math.PI / 2;
      this.scene.add(g);
      this.meshes.push(g);
      const half = len / 2;
      const ob = {
        kind: 'box',
        x: best.axis ? 0 : best.off,
        z: best.axis ? best.off : 0,
        w: best.axis ? len : 1.8,
        d: best.axis ? 1.8 : len,
        top: y0 + PIPE.r * 2,
        y: y0,
        group: g,
        mats: [],
        deck: true,
        pipeAxis: best.axis,
        pipeOff: best.off,
        box: null,
      };
      this.obstacles.push(ob);
      for (let s = -half + PIPE.seg; s < half - 1; s += PIPE.seg * 2) {
        const x = best.axis ? s : best.off,
          z = best.axis ? best.off : s;
        if (this.onCorridor(x, z, 1.5) || Math.max(Math.abs(x), Math.abs(z)) > 56 * this.k) continue;
        const gy = this.terrainHeight(x, z);
        const sp = buildPipeSupport(y0 - gy + 0.3, 0x5a4a3a);
        sp.position.set(x, gy - 0.3, z);
        if (best.axis) sp.rotation.y = Math.PI / 2;
        this.decorSupport(sp);
        this.obstacles.push({ kind: 'circle', x, z, r: 1.1, group: sp, mats: [], box: null, h: y0 - gy });
      }
    }
    for (let k = this.cnt(2, 4); k > 0; k--) {
      const h = rnd(30, 45),
        B = derrickBase(h),
        color = 0x9a6a3a;
      const spot = this.findSpot([-B * 1.1, B * 1.1, -B * 1.1, B * 1.1], 1.5 * G);
      if (!spot) continue;
      const g = buildDerrick(h, color);
      g.position.y = spot.lo - 0.2;
      const [ob] = this.addBig(g, spot, [{ c: [0, 0], r: B, h }]);
      this.regProp('derrick', ob, 6000, color);
    }
  }
  // 不碰撞也不淡出的結構零件（管線支架）：照一般網格加進場景（地圖建好後和裝飾一起合併）
  decorSupport(m) {
    this.addDecorMesh(m);
  }
  // 沙丘：半埋的艦體殘骸與拱形殘骸
  buildWrecks() {
    const H = WRECK_HULL;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const spot = this.findSpot([-H.box[0] / 2, H.box[0] / 2, -H.box[1] / 2, H.box[1] / 2], 3.5 * G, 40);
      if (!spot) continue;
      const g = buildWreckHull(pick([0x7d7466, 0x6a6f74, 0x8a6e52]));
      g.position.y = spot.avg - H.sink;
      this.addBig(g, spot, [
        {
          box: [-H.box[0] / 2, H.box[0] / 2, -H.box[1] / 2, H.box[1] / 2],
          y: spot.lo - 3,
          top: spot.avg + H.box[2],
        },
      ]);
    }
    const A = WRECK_ARCH;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const ex = A.feet[0] + A.feet[1];
      const spot = this.findSpot([-ex, ex, -A.feet[1], A.feet[1]], 3 * G, 40);
      if (!spot) continue;
      const g = buildWreckArch(pick([0x6f675c, 0x847a6a]));
      g.position.y = spot.avg;
      this.addBig(g, spot, [
        { c: [-A.feet[0], 0], r: A.feet[1], h: 12 },
        { c: [A.feet[0], 0], r: A.feet[1], h: 12 },
      ]);
    }
  }

  // ---------- 地形特徵：橋梁／高架／掩體／壕溝 ----------
  planFeatures() {
    withRng(this.seed * 17 + 5, () => this.planFeatures0());
  }
  planFeatures0() {
    this.features = [];
    this.featureNames = [];
    const kinds = this.theme.featureKinds || ['river_bridge', 'overpass', 'bunkers', 'trench', 'platforms'];
    const n = Math.min(kinds.length, this.theme.flat ? rndi(1, 3) : rndi(2, 4));
    const chosen = [];
    while (chosen.length < n) {
      const k = pick(kinds);
      if (!chosen.includes(k)) chosen.push(k);
    }
    // 穿越的公路／鐵路：主題的 corridor（{ p 出現機率, kinds 可出現的種類 }）；方向斜向或沿 X／Z，偏離中心，一半有緩彎
    const CO = corridorSpec(this.theme);
    const force = this.forceRail && CO.kinds.includes('rail');
    const forceR = !force && this.forceRoad && CO.kinds.includes('road');
    if (force || forceR || (CO.kinds.length && RNG() < CO.p)) {
      const kind = force ? 'rail' : forceR ? 'road' : pick(CO.kinds);
      const a = pick([Math.PI / 4, -Math.PI / 4, 0, Math.PI / 2]);
      const d = new THREE.Vector2(Math.cos(a), Math.sin(a));
      const bend = RNG() < 0.5 ? [rnd(8, 14) * this.k * (RNG() < 0.5 ? 1 : -1), RNG() < 0.5 ? 1 : 0] : null;
      // 公路與鐵路照現實的寬度（不跟著地形放大）
      this.corridor = {
        kind,
        dir: d,
        perp: new THREE.Vector2(-d.y, d.x),
        off: rnd(-22 * this.k, 22 * this.k),
        width: 10,
        len: this.size * 0.75,
        bend,
      };
      this.featureNames.push(this.corridor.kind === 'road' ? '穿越公路' : '穿越鐵路');
    }
    for (const k of chosen) {
      const ang = RNG() < 0.5 ? 0 : Math.PI / 2;
      const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang)),
        perp = new THREE.Vector2(-dir.y, dir.x);
      const off = rnd(-25 * this.k, 25 * this.k);
      if (k === 'river_bridge') {
        this.features.push({
          k,
          dir,
          perp,
          off,
          width: rnd(13, 18) * G,
          depth: rnd(4.5, 6.5) * G,
          bridges: [rnd(-38 * this.k, -8 * G), rnd(8 * G, 38 * this.k)],
          deckW: 9 * G,
        });
        this.featureNames.push('河道與橋梁');
      } else if (k === 'overpass') {
        this.features.push({
          k,
          dir,
          perp,
          off,
          center: rnd(-15 * this.k, 15 * this.k),
          span: rnd(34, 46) * G,
          rampL: 18 * G,
          deckH: 7.5 * G,
          deckW: 10 * G,
        });
        this.featureNames.push('高架橋');
      } else if (k === 'bunkers') {
        this.features.push({ k, count: this.cnt(3, 5) });
        this.featureNames.push('掩體群');
      } else if (k === 'trench') {
        this.features.push({
          k,
          dir,
          perp,
          off: rnd(-30 * this.k, 30 * this.k),
          width: rnd(6, 9) * G,
          depth: rnd(2.5, 3.5) * G,
          len: rnd(50 * this.k, 90 * this.k),
        });
        this.featureNames.push('壕溝');
      } else {
        this.features.push({ k, count: this.cnt(2, 4) });
        this.featureNames.push('高台');
      }
    }
    if (this.corridor)
      this.features.push({
        k: 'corridor',
        dir: this.corridor.dir,
        perp: this.corridor.perp,
        off: this.corridor.off,
        width: 10,
        len: this.corridor.len,
        kind: this.corridor.kind,
        bend: this.corridor.bend,
      });
  }
  featureHeight(x, z, h) {
    for (const f of this.features) {
      if (f.k === 'river_bridge') {
        const u = x * f.perp.x + z * f.perp.y - f.off;
        const t = clamp(1 - (Math.abs(u) - f.width / 2 + 2 * G) / (3 * G), 0, 1);
        h -= f.depth * t * t * (3 - 2 * t);
      } else if (f.k === 'overpass') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y - f.center;
        const lat = clamp(1 - (Math.abs(u) - f.deckW / 2) / (2.5 * G), 0, 1);
        const half = f.span / 2;
        if (lat > 0 && Math.abs(v) > half && Math.abs(v) < half + f.rampL) {
          const t = 1 - (Math.abs(v) - half) / f.rampL;
          h = lerp(h, Math.max(h, f.deckH * t + h * (1 - t)), lat);
        }
      } else if (f.k === 'trench') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y;
        if (Math.abs(v) < f.len / 2) {
          const t = clamp(1 - (Math.abs(u) - f.width / 2 + 1.5 * G) / (2 * G), 0, 1);
          h -= f.depth * t;
        }
      }
    }
    if (this.corridor) {
      const c = this.corridor;
      const u = this.corridorU(x, z);
      const inside = clamp(1 - (Math.abs(u) - c.width / 2) / (3.5 * G), 0, 1); // 路肩的整地（地形的起伏放大了，過渡帶跟著加寬）
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (inside > 0 && edge < (this.size / 2) * 0.88) {
        const t = inside * inside * (3 - 2 * inside);
        h = lerp(h, 0.25, t);
      }
    }
    return h;
  }
  addDeck(x, z, w, d, y, thick, rotY, mats) {
    // elevated slab you can stand on AND walk under（新主題用主題版的外觀，碰撞相同）
    const fs = this.theme.props;
    const {
      group: g,
      dm,
      rm,
    } = fs
      ? { group: buildThemeDeck(fs, w, d, thick, rotY), dm: null, rm: null }
      : buildDeck(w, d, thick, rotY, mats || deckMats());
    g.position.set(x, y, z);
    this.scene.add(g);
    this.meshes.push(g);
    const ob = {
      kind: 'box',
      x,
      z,
      w,
      d,
      top: y,
      y: y - thick,
      group: g,
      mats: propMats(g) || (dm ? [dm, rm] : fadeMatsOf(g)),
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - thick, z - d / 2),
        new THREE.Vector3(x + w / 2, y + 0.9, z + d / 2),
      ),
      deck: true,
    };
    this.obstacles.push(ob);
    this.occluders.push(ob);
    return ob;
  }
  addPillar(x, z, r, y0, y1, m) {
    const h = y1 - y0;
    const c = this.theme.props
      ? buildThemePillar(this.theme.props, r, h)
      : buildPillar(r, h, m || deckMats().pillar);
    c.position.set(x, y0 + h / 2, z);
    this.scene.add(c);
    this.meshes.push(c);
    this.obstacles.push({ kind: 'circle', x, z, r: r * 1.1, group: c, mats: [], box: null, top: y1 });
  }
  regProp(kind, ob, hp, color) {
    this.props = this.props || [];
    const id = this.props.length;
    const c = ob.box
      ? ob.box.getCenter(new THREE.Vector3())
      : new THREE.Vector3(ob.x, this.terrainHeight(ob.x, ob.z) + (ob.h || 3) / 2, ob.z);
    const r = ob.box ? ob.box.getSize(new THREE.Vector3()).length() * 0.5 : ob.r + 0.5;
    const p = {
      id: 800000 + id,
      idx: id,
      kind,
      ob,
      hp,
      maxHp: hp,
      color,
      dead: false,
      team: 'prop',
      isProp: true,
      radius: Math.max(1.2, r * 0.85),
      name:
        {
          container: '貨櫃',
          rock: '岩石',
          pillar: '柱子',
          truck: '卡車',
          pillarBlock: '高柱',
          derrick: '鑽井架',
          hopper: '礦石料斗',
          tank: '儲槽',
          spire: '岩柱',
          floodlight: '照明塔',
          mtwreck: 'MT 殘骸',
          sandstone: '砂岩',
          fence: '防風牆',
          quonset: '拱屋',
          ice: '冰塊',
          radar: '雷達天線',
          beacon: '信號燈桿',
          lamppost: '照明柱',
          rockpile: '落石堆',
          twall: '防爆牆',
          barrier: '護欄',
          pine: '針葉樹',
        }[kind] || (this.theme.propNames || {})[kind],
      pos: c,
      center: () => c.clone(),
      flashT: 0,
      shape: propShape(this, ob), // 命中形狀＝碰撞障礙物（world/prop-hit.js）；radius 只剩粗略的用途
    };
    ob.prop = p;
    this.props.push(p);
    return p;
  }
  destroyProp(p, fx) {
    if (p.dead) return;
    p.dead = true;
    const i = this.obstacles.indexOf(p.ob);
    if (i >= 0) this.obstacles.splice(i, 1);
    const j = this.occluders.indexOf(p.ob);
    if (j >= 0) this.occluders.splice(j, 1);
    if (p.ob.group) {
      p.ob.group.visible = false;
    }
    if (fx) fx.shatterProp(p, this);
  }
  buildCorridor() {
    const c = this.corridor;
    if (!c) return;
    const half = c.len / 2 + 18;
    const L = [];
    const pts = (u) => {
      const out = [];
      for (let s = -half; s <= half; s += 2)
        out.push(this.corridorPoint(s, u).add(new THREE.Vector3(0, 0.06, 0)));
      return out;
    };
    const road = c.kind === 'road';
    for (const [u0, u1, color, rough, y] of road ? ROAD_STRIPS : RAIL_STRIPS) {
      const m = stripMesh(pts(u0), pts(u1), color, rough, y);
      this.scene.add(m);
      this.meshes.push(m);
    }
    // 公路中線標線／鐵路枕木：一個 InstancedMesh（地圖放大後數量很多）
    const P = road ? LANE_MARK : RAIL_TIE;
    const piece = corridorPiece(P);
    const n = Math.ceil((2 * half) / P.step);
    const im = new THREE.InstancedMesh(piece.geometry, piece.material, n);
    const o3 = new THREE.Object3D();
    let i = 0;
    for (let s = -half; s < half && i < n; s += P.step, i++) {
      const p = this.corridorPoint(s),
        t = this.corridorDir(s);
      o3.position.set(p.x, p.y + P.y, p.z);
      o3.rotation.set(0, Math.atan2(t.x, t.y), 0);
      o3.updateMatrix();
      im.setMatrixAt(i, o3.matrix);
    }
    im.count = i;
    im.receiveShadow = true;
    im.userData.noFade = true; // 貼在地面上，不擋鏡頭
    this.scene.add(im);
    this.meshes.push(im);
    // 隧道口：地圖兩端各一座（拱門＋門柱＋黑洞＋山體）
    for (const sgn of [-1, 1]) {
      const s = sgn * ((this.size / 2) * 0.86);
      const p = this.corridorPoint(s),
        t = this.corridorDir(s);
      const x = p.x,
        z = p.z,
        y = p.y;
      const g = this.theme.props ? buildThemeTunnel(this.theme.props) : buildTunnelPortal(this.theme.rock);
      g.position.set(x, y - 0.1, z);
      g.rotation.y = Math.atan2(t.x, t.y) + (sgn > 0 ? Math.PI : 0);
      this.scene.add(g);
      this.meshes.push(g);
    }
    this.corridorHalf = half;
  }
  buildFeatures() {
    this.buildCorridor();
    if (this.theme.buildStructures) this.theme.buildStructures(this);
    const T = this.theme;
    const mats = deckMats();
    for (const f of this.features) {
      if (f.k === 'river_bridge') {
        for (let bpos of f.bridges) {
          {
            let tries = 0;
            while (tries++ < 12) {
              const cx0 = f.perp.x * f.off + f.dir.x * bpos,
                cz0 = f.perp.y * f.off + f.dir.y * bpos;
              let clear = true;
              for (const q of [-1, -0.5, 0, 0.5, 1])
                if (
                  this.onCorridor(
                    cx0 + f.dir.x * q * (f.deckW / 2 + 2 * G),
                    cz0 + f.dir.y * q * (f.deckW / 2 + 2 * G),
                    9 * G,
                  )
                )
                  clear = false;
              if (clear) break;
              bpos += (bpos < 0 ? -1 : 1) * 6 * G;
              if (Math.abs(bpos) > 52 * this.k) {
                bpos = NaN;
                break;
              }
            }
            if (isNaN(bpos)) continue;
          } // 橋梁避開公路／鐵路走廊
          const cx = f.perp.x * f.off + f.dir.x * bpos,
            cz = f.perp.y * f.off + f.dir.y * bpos;
          const rot = Math.abs(f.perp.x) > 0.5;
          const span = f.width + 8 * G;
          const deckY =
            Math.max(
              this.terrainHeight(cx + f.perp.x * (span / 2), cz + f.perp.y * (span / 2)),
              this.terrainHeight(cx - f.perp.x * (span / 2), cz - f.perp.y * (span / 2)),
            ) +
            0.3 * G;
          this.addDeck(cx, cz, rot ? span : f.deckW, rot ? f.deckW : span, deckY, 0.7 * G, !rot, mats);
          for (const s of [-1, 1])
            for (const q of [-1, 1]) {
              const px = cx + f.perp.x * s * f.width * 0.28 + f.dir.x * q * f.deckW * 0.35,
                pz = cz + f.perp.y * s * f.width * 0.28 + f.dir.y * q * f.deckW * 0.35;
              if (this.onCorridor(px, pz, 1)) continue;
              this.addPillar(px, pz, 0.6 * G, deckY - f.depth - 1.5 * G, deckY - 0.7 * G, mats.pillar);
            }
        }
      } else if (f.k === 'overpass') {
        const cx = f.perp.x * f.off + f.dir.x * f.center,
          cz = f.perp.y * f.off + f.dir.y * f.center;
        const rot = Math.abs(f.dir.x) > 0.5;
        const deckY = f.deckH + this.terrainHeight(cx, cz) * 0;
        const base = this.terrainHeight(cx, cz);
        const dy = Math.max(deckY, base + 5 * G, 7.2 * G);
        this.addDeck(cx, cz, rot ? f.span : f.deckW, rot ? f.deckW : f.span, dy, 0.8 * G, !rot, mats);
        const np = Math.floor(f.span / (12 * G));
        for (let i = 0; i <= np; i++) {
          const v = -f.span / 2 + 4 * G + (i * (f.span - 8 * G)) / np;
          for (const s of [-1, 1]) {
            const px = cx + f.dir.x * v + f.perp.x * s * f.deckW * 0.32,
              pz = cz + f.dir.y * v + f.perp.y * s * f.deckW * 0.32;
            if (this.onCorridor(px, pz, 1.5)) continue;
            this.addPillar(px, pz, 0.55 * G, this.terrainHeight(px, pz) - 0.5 * G, dy - 0.8 * G, mats.pillar);
          }
        }
      } else if (f.k === 'bunkers') {
        for (let i = 0; i < f.count; i++) {
          let x = rnd(-48 * this.k, 48 * this.k),
            z = rnd(-48 * this.k, 48 * this.k);
          const w = rnd(9, 14) * G,
            d = rnd(9, 14) * G;
          {
            let tr = 0;
            while (
              tr++ < 10 &&
              (Math.hypot(x, z) < 10 * G ||
                this.onCorridor(x, z, Math.max(w, d) * 0.72 + 2) ||
                this.isVoid(x, z) ||
                this.isReserved(x, z, Math.max(w, d) * 0.72) ||
                !this.slopeOK(x, z))
            ) {
              x = rnd(-48 * this.k, 48 * this.k);
              z = rnd(-48 * this.k, 48 * this.k);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const h = rnd(5, 6.5) * G;
          this.addDeck(x, z, w, d, y0 + h, 0.8 * G, false, mats);
          for (const sx of [-1, 1])
            for (const sz of [-1, 1])
              this.addPillar(
                x + sx * (w / 2 - G),
                z + sz * (d / 2 - G),
                0.5 * G,
                y0 - 0.5 * G,
                y0 + h - 0.8 * G,
                mats.pillar,
              );
          // one side wall for cover
          const side = RNG() < 0.5;
          const wm = mats.pillar.clone();
          wm.transparent = true;
          const ww = side ? w - 2 * G : 0.8 * G,
            wd = side ? 0.8 * G : d - 2 * G;
          const wx = x + (side ? 0 : (w / 2 - 0.4 * G) * (RNG() < 0.5 ? 1 : -1)),
            wz = z + (side ? (d / 2 - 0.4 * G) * (RNG() < 0.5 ? 1 : -1) : 0);
          const wh = h - 0.8 * G;
          let wall;
          if (T.props) {
            wall = buildThemeWall(T.props, ww, wh, wd);
            wall.position.set(wx, y0 + wh / 2, wz);
          } else wall = box(ww, wh, wd, wm, wx, y0 + wh / 2, wz);
          this.scene.add(wall);
          this.meshes.push(wall);
          const bb = new THREE.Box3().setFromObject(wall);
          this.obstacles.push({
            kind: 'box',
            x: wall.position.x,
            z: wall.position.z,
            w: bb.max.x - bb.min.x,
            d: bb.max.z - bb.min.z,
            top: bb.max.y,
            y: bb.min.y,
            group: wall,
            mats: T.props ? propMats(wall) || fadeMatsOf(wall) : [wm],
            box: bb,
          });
          this.occluders.push(this.obstacles[this.obstacles.length - 1]);
        }
      } else if (f.k === 'platforms') {
        const pm = mat(0x7a7f88, { roughness: 0.8 });
        for (let i = 0; i < f.count; i++) {
          let x = rnd(-45 * this.k, 45 * this.k),
            z = rnd(-45 * this.k, 45 * this.k);
          const w = rnd(10, 18) * G,
            d = rnd(10, 18) * G,
            h = rnd(4, 7) * G;
          {
            let tr = 0;
            while (
              tr++ < 10 &&
              (Math.hypot(x, z) < 12 * G ||
                this.onCorridor(x, z, Math.max(w, d) * 0.72 + 8 * G) ||
                this.isVoid(x, z) ||
                this.isReserved(x, z, Math.max(w, d) * 0.72 + 4 * G))
            ) {
              x = rnd(-45 * this.k, 45 * this.k);
              z = rnd(-45 * this.k, 45 * this.k);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const m2 = pm.clone();
          m2.transparent = true;
          const sk = 0.5 * G; // 埋進地面
          let g;
          if (T.props) {
            g = buildThemePlatform(T.props, w, h, d);
            g.position.set(x, y0 - sk, z);
          } else g = box(w, h, d, m2, x, y0 + h / 2 - sk, z);
          this.scene.add(g);
          this.meshes.push(g);
          const ob = {
            kind: 'box',
            x,
            z,
            w,
            d,
            top: y0 + h - sk,
            y: y0 - sk,
            group: g,
            mats: T.props ? propMats(g) || fadeMatsOf(g) : [m2],
            box: new THREE.Box3(
              new THREE.Vector3(x - w / 2, y0 - sk, z - d / 2),
              new THREE.Vector3(x + w / 2, y0 + h - sk, z + d / 2),
            ),
          };
          this.obstacles.push(ob);
          this.occluders.push(ob);
          // ramp: a tilted slab up to the platform (walkable via terrain-like ground function)
          const side = pick([
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]);
          const rl = h * 2.2;
          const rx = x + side[0] * (w / 2 + rl / 2),
            rz = z + side[1] * (d / 2 + rl / 2);
          const rw = side[0] ? rl : 6 * G,
            rd = side[1] ? rl : 6 * G;
          const rg = T.props ? buildThemeRamp(T.props, rw, rd) : box(rw, 0.4 * G, rd, pm, 0, 0, 0);
          rg.position.set(rx, y0 + h / 2 - 0.7 * G, rz);
          rg.rotation.z = side[0] ? -side[0] * Math.atan2(h - sk, rl) : 0;
          rg.rotation.x = side[1] ? side[1] * Math.atan2(h - sk, rl) : 0;
          this.scene.add(rg);
          this.meshes.push(rg);
          this.ramps = this.ramps || [];
          this.ramps.push({ x: rx, z: rz, w: rw, d: rd, side, y0: y0 - sk, y1: y0 + h - sk, len: rl });
        }
      }
    }
  }
  // 坡道高度；y 有值時，懸空的坡道（lift：多層地圖從平台接到上一層）只對站在坡面附近的機體算數
  rampHeight(x, z, y) {
    if (!this.ramps) return -1e9;
    let best = -1e9;
    for (const r of this.ramps) {
      if (Math.abs(x - r.x) > r.w / 2 || Math.abs(z - r.z) > r.d / 2) continue;
      const along = r.side[0] ? (r.x - x) * r.side[0] : (r.z - z) * r.side[1];
      const t = clamp((along + r.len / 2) / r.len, 0, 1);
      const h = lerp(r.y0, r.y1, t);
      if (r.lift && y !== undefined && y < h - 1.2 * MS) continue;
      best = Math.max(best, h);
    }
    return best;
  }
  ceiling(x, z, y, h) {
    let c = 1e9;
    for (const o of this.obstacles) {
      if (o.kind !== 'box' || !o.deck) continue;
      if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2 && y < o.y - 0.2 * MS && y + h > o.y)
        c = Math.min(c, o.y);
    }
    return c;
  }
  // ground height incl. box tops for an entity at (x,z) currently at height y
  groundAt(x, z, y) {
    let g = Math.max(this.terrainHeight(x, z), this.rampHeight(x, z, y));
    for (const o of this.obstacles) {
      if (o.kind !== 'box') continue;
      if (
        Math.abs(x - o.x) < o.w / 2 + 0.3 * MS &&
        Math.abs(z - o.z) < o.d / 2 + 0.3 * MS &&
        y >= o.top - STEP_H &&
        o.top > g
      )
        g = o.top;
    }
    return g;
  }
  // horizontal collision push-out; returns [x,z]
  // soft：玩家機體可以超出作戰區域到 limOut（MechEntity.oobPush 推回）
  collide(x, z, y, r, soft = false) {
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
        if (y >= o.top - STEP_H) continue;
        if (o.deck && y + 3.2 * MS < o.y) continue; // 從甲板底下通過（舊尺度的機甲身高 3.2 m）
        if (o.deck && y < o.y - 0.2 * MS) continue;
        const hw = o.w / 2 + r,
          hd = o.d / 2 + r;
        const dx = x - o.x,
          dz = z - o.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
          const px = hw - Math.abs(dx),
            pz = hd - Math.abs(dz);
          if (px < pz) x = o.x + Math.sign(dx || 1) * hw;
          else z = o.z + Math.sign(dz || 1) * hd;
        }
      } else {
        if (o.top !== undefined && y >= o.top - STEP_H) continue;
        const dx = x - o.x,
          dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const rr = o.r + r;
        if (d < rr) {
          const k = d < 1e-3 ? 1 : rr / d;
          x = o.x + dx * k;
          z = o.z + dz * k;
        }
      }
    }
    // 場地邊界：電腦機體限制在作戰區域（一般任務 ±lim）、玩家可以再往外 OOB_BUF（±limOut）
    const Z = this.zone,
      b = soft ? OOB_BUF : 0;
    x = clamp(x, Math.max(Z[0] - b, -this.limOut), Math.min(Z[1] + b, this.limOut));
    z = clamp(z, Math.max(Z[2] - b, -this.limOut), Math.min(Z[3] + b, this.limOut));
    return [x, z];
  }
  // 線段 a → b 碰到還在的可破壞物件（命中形狀加寬 pad）：點取樣的視線（rayClear／losClear）補上細的柱子與薄牆
  propBlocks(a, b, pad = 0) {
    return !!this.propFirst(a, _seg.subVectors(b, a), pad);
  }
  // 線段 a → a+v 第一個碰到的可破壞物件：[物件, t（0～1）]，沒有時 null（光束停在物件上）
  propFirst(a, v, pad = 0) {
    if (!this.props) return null;
    let best = null,
      bt = 2;
    for (const p of this.props) {
      if (p.dead || !p.shape) continue;
      const t = shapeSegT(p.shape, a, v, pad);
      if (t >= 0 && t < bt) {
        best = p;
        bt = t;
      }
    }
    return best ? [best, bt] : null;
  }
  // projectile vs world
  hitsWorld(p) {
    // 地圖外用遠景地形的高度（山脊、斷崖）
    const S = this.size / 2;
    const th =
      Math.abs(p.x) > S || Math.abs(p.z) > S ? this.farHeight(p.x, p.z) : this.terrainHeight(p.x, p.z);
    if (p.y < th || p.y < this.rampHeight(p.x, p.z, p.y)) return true;
    for (const o of this.obstacles) {
      if (o.prop && o.prop.shape && !o.prop.dead) {
        // 可破壞物件：和子彈、光束相同的命中形狀（world/prop-hit.js；細的柱子也算）
        if (shapeContains(o.prop.shape, p)) return true;
      } else if (o.kind === 'box') {
        if (Math.abs(p.x - o.x) < o.w / 2 && Math.abs(p.z - o.z) < o.d / 2 && p.y < o.top && p.y > o.y)
          return true;
      } else if (
        o.r > 1 &&
        Math.hypot(p.x - o.x, p.z - o.z) < o.r * 0.9 &&
        p.y < this.terrainHeight(o.x, o.z) + o.r * 2
      )
        return true;
    }
    return false;
  }
  // near：在這一點附近找（增援波次的進入地點，找不到時範圍慢慢放大）；minD：離 minDistFrom 至少幾公尺
  spawnPoint(minDistFrom, others, near = null, minD = 28 * DS) {
    const Z = this.zone,
      R = 50 * this.k,
      M = 4 * MS;
    for (let t = 0; t < (near ? 60 : 40); t++) {
      let x, z;
      if (near) {
        const r = (6 + t * 0.6) * DS;
        x = clamp(near.x + rnd(-r, r), Z[0] + M, Z[1] - M);
        z = clamp(near.z + rnd(-r, r), Z[2] + M, Z[3] - M);
      } else {
        x = rnd(Math.max(-R, Z[0] + M), Math.min(R, Z[1] - M));
        z = rnd(Math.max(-R, Z[2] + M), Math.min(R, Z[3] - M));
      }
      if (this.onCorridor(x, z, 2 * MS) || this.offLimits(x, z)) continue;
      if (!this.slopeOK(x, z)) continue;
      if (this.isVoid(x, z) || this.isReserved(x, z, 3 * MS)) continue;
      if (Math.hypot(x - minDistFrom.x, z - minDistFrom.z) < minD) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < 6 * MS)) continue;
      if (
        this.obstacles.some((o) =>
          o.kind === 'box'
            ? Math.abs(x - o.x) < o.w / 2 + 1.5 * MS && Math.abs(z - o.z) < o.d / 2 + 1.5 * MS
            : Math.hypot(x - o.x, z - o.z) < o.r + 1.5 * MS,
        )
      )
        continue;
      return { x, z };
    }
    const sp = this.safePoint();
    return { x: sp.x, z: sp.z };
  }
  // 換天候（自訂關卡的觸發器；只有外觀）
  setWeather(wk) {
    if (this.weather) this.weather.dispose();
    this.weather = wk && wk !== 'none' ? new Weather(this.scene, wk, this.theme) : null;
  }
  // 水面高度（關卡編輯器）：沒有水面時建立
  setWaterLevel(y) {
    const W0 = this.theme.water || { color: 0x37586a, opacity: 0.85, rough: 0.12 };
    this.theme = { ...this.theme, water: { ...W0, level: y } };
    if (this.waterMesh) this.waterMesh.position.y = y;
    else this.addWater(this.theme.water);
  }
  dispose() {
    if (this.weather) this.weather.dispose();
    if (this._fading) for (const f of this._fading.values()) f.m.dispose();
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
  }
  // 作戰區域邊界的警示光幕：機體靠近 ±lim 時在邊界上浮現（跟著機體在邊界上的投影位置，兩個方向各一片）
  buildBoundary() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(255,90,30,0.18)';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = 'rgba(255,120,30,0.95)';
    c.lineWidth = 9;
    for (let k = -128; k < 256; k += 32) {
      c.beginPath();
      c.moveTo(k, 128);
      c.lineTo(k + 128, 0);
      c.stroke();
    }
    // 中央濃、四周淡出
    c.globalCompositeOperation = 'destination-in';
    const g = c.createRadialGradient(64, 64, 8, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    this.bWall = [0, 1].map(() => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(46 * DS, 24 * DS),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      m.visible = false;
      m.renderOrder = 3;
      this.scene.add(m);
      this.meshes.push(m);
      return m;
    });
  }
  updateBoundary(p) {
    if (!this.bWall || !p) return;
    const Z = this.zone;
    for (let k = 0; k < 2; k++) {
      const m = this.bWall[k];
      const v = k ? p.z : p.x,
        o = k ? p.x : p.z;
      const lo = Z[k * 2],
        hi = Z[k * 2 + 1];
      const edge = v - lo < hi - v ? lo : hi;
      const t = clamp(1 - Math.min(v - lo, hi - v) / (22 * DS), 0, 1);
      const op = t * t * (3 - 2 * t) * 0.85;
      m.visible = op > 0.01;
      if (!m.visible) continue;
      m.material.opacity = op;
      const a = clamp(o, Z[(1 - k) * 2] - OOB_BUF, Z[(1 - k) * 2 + 1] + OOB_BUF);
      const x = k ? a : edge,
        z = k ? edge : a;
      m.position.set(x, Math.max(this.terrainHeight(x, z), p.y - 6 * DS) + 10 * DS, z);
      m.rotation.y = k ? 0 : Math.PI / 2;
    }
  }
  // fade objects between camera and player
  // 鏡頭和機體之間的物件淡出；pts＝機體上要看得到的點（頭、中心、腳，沒給時只用 playerPos）。
  // 回傳有沒有物件擋住（給機體的透視輪廓用）
  updateOcclusion(camPos, playerPos, dt, pts) {
    this.updateBoundary(playerPos);
    const rays = (pts || [playerPos]).map((p) => ({
      ray: new THREE.Ray(camPos.clone(), p.clone().sub(camPos).normalize()),
      dist: camPos.distanceTo(p),
    }));
    const tmp = new THREE.Vector3();
    let any = false;
    for (const o of this.occluders) {
      if (!o.box) continue;
      let hit = false;
      for (const R of rays) {
        const r = R.ray.intersectBox(o.box, tmp);
        if (r && r.distanceTo(camPos) < R.dist - MS) {
          hit = true;
          break;
        }
      }
      if (hit) any = true;
      const target = hit ? 0.15 : 1;
      for (const m of o.mats) {
        m.opacity = lerp(m.opacity, target, Math.min(1, dt * 10));
        m.depthWrite = m.opacity > 0.9;
      }
    }
    return any;
  }
  // 沒有登記成 occluders 的網格（大型結構、地標、起重機、支柱…）擋住機體時，各自換成可以淡出的材質副本，
  // 不再擋住、淡回不透明後還原原本的材質。射線每 3 格打一次；地形、水面、岩頂、遠景、半透明與 InstancedMesh 略過。
  // 回傳有沒有網格擋住
  fadeMeshes(camPos, pts, dt) {
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    const last = this.meshes[this.meshes.length - 1];
    const key = this.meshes.length + ':' + (last ? last.id : 0);
    if (!this._occCands || this._occN !== key) {
      this._occN = key; // 之後加進來的網格（地標等）也算
      this._occCands = this.meshes.filter(
        (m) => m !== this.terrainMesh && m !== this.waterMesh && !m.userData.noFade,
      );
    }
    this._fadeN = (this._fadeN || 0) + 1;
    if (!this._fadeHit || this._fadeN % 3 === 0) {
      const hit = new Set();
      const dir = new THREE.Vector3();
      const floor = Math.min(...pts.map((p) => p.y)) - 0.1 * MS; // 比腳底低的命中是地面上的東西（道路、貼花），不淡出
      for (const p of pts) {
        dir.copy(p).sub(camPos);
        const dist = dir.length();
        rc.set(camPos, dir.normalize());
        rc.far = dist - 0.8 * MS;
        for (const h of rc.intersectObjects(this._occCands, true)) {
          const o = h.object;
          if (!o.isMesh || o.isInstancedMesh || !o.visible || h.point.y < floor) continue;
          const f = this._fading && this._fading.get(o);
          const m = o.material;
          if (!f && (!m || Array.isArray(m) || m.transparent)) continue; // 已經是半透明（含 occluders 的淡出材質）
          hit.add(o);
        }
      }
      this._fadeHit = hit;
    }
    const act = this._fading || (this._fading = new Map());
    for (const o of this._fadeHit)
      if (!act.has(o)) {
        const m = o.material.clone();
        m.transparent = true;
        act.set(o, { orig: o.material, m });
        o.material = m;
      }
    for (const [o, f] of act) {
      const on = this._fadeHit.has(o);
      f.m.opacity = lerp(f.m.opacity, on ? 0.18 : 1, Math.min(1, dt * 10));
      f.m.depthWrite = f.m.opacity > 0.9;
      if (!on && f.m.opacity > 0.98) {
        o.material = f.orig;
        f.m.dispose();
        act.delete(o);
      }
    }
    return this._fadeHit.size > 0;
  }
  // 線段 a→b 是否被地形擋住（鏡頭用；取樣檢查）
  terrainBlocks(a, b, n = 16) {
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t,
        y = a.y + (b.y - a.y) * t,
        z = a.z + (b.z - a.z) * t;
      if (this.terrainHeight(x, z) > y - 0.3 * MS) return true;
    }
    return false;
  }
  // 視線（敵人 AI 的感知，game/ai-director.js）：地形＋障礙物（方塊以外框、圓柱以垂直圓柱）擋住 a→b 時為 true；
  // 方塊略縮 0.85 倍，邊角擦過不算擋住；細的柱子（半徑 1 m 以下）不擋
  losBlocked(a, b) {
    if (this.terrainBlocks(a, b, 12)) return true;
    if (this.losHook && this.losHook(a, b)) return true; // 煙霧（game/hazards2.js 的區域效果）
    const dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x),
      minZ = Math.min(a.z, b.z),
      maxZ = Math.max(a.z, b.z);
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
        const hw = (o.w / 2) * 0.85,
          hd = (o.d / 2) * 0.85;
        if (o.x + hw < minX || o.x - hw > maxX || o.z + hd < minZ || o.z - hd > maxZ) continue;
        // 線段與外框的 slab 測試
        let t0 = 0,
          t1 = 1;
        const lo = [o.x - hw, o.y === undefined ? -1e9 : o.y, o.z - hd],
          hi = [o.x + hw, o.top, o.z + hd],
          p = [a.x, a.y, a.z],
          v = [dx, dy, dz];
        let hit = true;
        for (let k = 0; k < 3 && hit; k++) {
          if (Math.abs(v[k]) < 1e-6) {
            if (p[k] < lo[k] || p[k] > hi[k]) hit = false;
          } else {
            let ta = (lo[k] - p[k]) / v[k],
              tb = (hi[k] - p[k]) / v[k];
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) hit = false;
          }
        }
        if (hit) return true;
      } else if (o.r > 1) {
        if (o.x + o.r < minX || o.x - o.r > maxX || o.z + o.r < minZ || o.z - o.r > maxZ) continue;
        const L2 = dx * dx + dz * dz;
        const t = L2 > 1e-6 ? clamp(((o.x - a.x) * dx + (o.z - a.z) * dz) / L2, 0, 1) : 0;
        const cx = a.x + dx * t - o.x,
          cz = a.z + dz * t - o.z;
        if (cx * cx + cz * cz > o.r * o.r * 0.8) continue;
        const top = o.top !== undefined ? o.top : this.terrainHeight(o.x, o.z) + o.r * 2;
        if (a.y + dy * t < top) return true;
      }
    }
    return false;
  }
}
