// ============================================================
//  WORLD — 隨機關卡生成
// ============================================================
import { RNG, clamp, lerp, makeNoise, makeRng, pick, rnd, rndi, withRng } from '../core/math.js';
import {
  LANE_MARK,
  RAIL_STRIPS,
  RAIL_TIE,
  ROAD_STRIPS,
  box,
  buildContainer,
  buildDebris,
  buildDeck,
  buildGridPillar,
  buildLampPost,
  buildParkedTruck,
  buildPillar,
  buildRock,
  buildTunnelPortal,
  buildDerrick,
  buildIceSheet,
  buildMiningRig,
  buildPipeSegment,
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
import { Weather } from './weather.js';

// 網格建造在 prop-models.js（純函式）；這裡只用亂數決定參數與位置，亂數呼叫順序不可改變
// 局部座標 (lx, lz) 繞 Y 轉 q×90° 後的位置（與 Object3D.rotation.y = q×π/2 一致）
const rotQ = (q, lx, lz) =>
  [
    [lx, lz],
    [lz, -lx],
    [-lx, -lz],
    [-lz, lx],
  ][q];
// 群組裡可透明的材質（鏡頭遮擋時半透明）
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
// 場地內的位置範圍都乘上 k、物件數量乘上 k²（cnt）
const ARENA = 150,
  MAP_SIZE = 230,
  CELL = 2.5;
export const THEMES = {
  snow: {
    name: '極地封鎖區',
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
};

export class World {
  constructor(scene, theme, seed, level, feat, opt = {}) {
    this.scene = scene;
    this.theme = THEMES[theme];
    this.themeKey = theme;
    this.size = this.theme.size || MAP_SIZE;
    this.k = this.size / ARENA;
    this.cells = Math.round(this.size / CELL);
    this.lim = 62 * this.k; // 可活動範圍（collide 限制在 ±lim）
    this.trackS = (this.size / 2) * 0.86; // 公路／鐵路兩端隧道口
    this.level = level;
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.noise2 = makeNoise(seed * 7 + 3);
    this.rng = makeRng(seed * 13 + 7);
    this.obstacles = [];
    this.occluders = [];
    this.meshes = [];
    this.h = new Float32Array((this.cells + 1) * (this.cells + 1));
    withRng(seed * 31 + 11, () => {
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
          this.corridor = { kind: cf.kind, dir: cf.dir, perp: cf.perp, off: cf.off, width: 10, len: cf.len };
          this.featureNames.push(cf.kind === 'road' ? '穿越公路' : '穿越鐵路');
        }
      } else {
        this.planFeatures();
        if (opt.rail && this.corridor && this.corridor.kind !== 'rail') {
          // Boss 關（武裝列車）：穿越的通道改成鐵路
          this.corridor.kind = 'rail';
          const cf = this.features.find((f) => f.k === 'corridor');
          if (cf) cf.kind = 'rail';
          const i = this.featureNames.indexOf('穿越公路');
          if (i >= 0) this.featureNames[i] = '穿越鐵路';
        }
      }
      this.buildTerrain();
      this.buildFeatures();
      this.buildProps();
    });
    // 天氣粒子：只有外觀，各端各自用 Math.random（不影響地圖）
    this.weather = this.theme.weather ? new Weather(scene, this.theme.weather, this.theme) : null;
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
    // 新主題的地形輪廓（canyon／dunes）取代原本的起伏＋台地＋土丘
    const prof = T.terrain === 'canyon' ? this.planCanyon() : T.terrain === 'dunes' ? this.planDunes() : null;
    const plateaus = [];
    const cliffPts = [];
    if (!prof) {
      const pc = T.flat ? this.cnt(0, 1) : this.cnt(2, 4);
      for (let k = 0; k < pc; k++)
        plateaus.push({
          x: rnd(-45 * this.k, 45 * this.k),
          z: rnd(-45 * this.k, 45 * this.k),
          w: rnd(14, 30),
          d: rnd(14, 30),
          h: rnd(3, 7),
          r: rnd(4, 8),
        });
      for (let k = 0, nc = T.flat ? 0 : this.cnt(2, 4); k < nc; k++)
        cliffPts.push({
          x: rnd(-55 * this.k, 55 * this.k),
          z: rnd(-55 * this.k, 55 * this.k),
          r: rnd(9, 16),
          h: rnd(6, 10),
        });
    }
    const lake = T.iceLake ? this.planIceLake() : null;
    for (let j = 0; j <= this.cells; j++)
      for (let i = 0; i <= this.cells; i++) {
        const x = i * CELL - this.size / 2,
          z = j * CELL - this.size / 2;
        let h = prof ? prof(x, z) : T.flat ? 0 : n(x * 0.03, z * 0.03) * 1.2 + n2(x * 0.1, z * 0.1) * 0.3;
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
        const edge = Math.max(Math.abs(x), Math.abs(z)) / (this.size / 2);
        const et = clamp((edge - 0.78) / 0.22, 0, 1);
        h += et * et * 16 + n(x * 0.2, z * 0.2) * et * 4; // enclosing cliffs
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
    // geometry
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
      if (y > 9) tmp.lerp(cr, clamp((y - 9) / 6, 0, 0.7));
      tmp.offsetHSL(0, 0, rnd(-0.02, 0.02));
      for (let q = 0; q < 3; q++) {
        col[(f + q) * 3] = tmp.r;
        col[(f + q) * 3 + 1] = tmp.g;
        col[(f + q) * 3 + 2] = tmp.b;
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
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
    if (lake) {
      const ice = buildIceSheet(lake.rx, lake.rz, lake.rng);
      ice.position.set(lake.x, lake.level + 0.05, lake.z);
      ice.rotation.y = lake.rot;
      this.scene.add(ice);
      this.meshes.push(ice);
    }
    if (T.grid) {
      const gh = new THREE.GridHelper(this.size, this.size / 2.5, 0x6b7280, 0x8b93a0);
      gh.position.y = 0.04;
      gh.material.transparent = true;
      gh.material.opacity = 0.35;
      this.scene.add(gh);
      this.meshes.push(gh);
    }
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
        if (Math.hypot(x, z) < (big ? 26 : 18)) continue;
        if (mesas.some((m) => Math.hypot(m.x - x, m.z - z) < (big ? 26 : 14))) continue;
        const m = {
          x,
          z,
          w: big ? rnd(14, 24) : rnd(4, 7),
          d: big ? rnd(12, 22) : rnd(4, 7),
          h: big ? rnd(9, 14) : rnd(7, 11),
          r: big ? rnd(2.8, 4.5) : rnd(1.8, 2.8),
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
    return (x, z) => {
      let h = n(x * 0.022, z * 0.022) * 1.8 + n2(x * 0.09, z * 0.09) * 0.45;
      for (const m of mesas) {
        const dx0 = x - m.x,
          dz0 = z - m.z;
        const lx = dx0 * m.c - dz0 * m.s,
          lz = dx0 * m.s + dz0 * m.c;
        const dx = Math.max(Math.abs(lx) - m.w / 2, 0),
          dz = Math.max(Math.abs(lz) - m.d / 2, 0);
        const d = Math.hypot(dx, dz) + (n2(x * 0.17 + 3, z * 0.17) - 0.5) * 3;
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
      amp1 = rnd(5, 7),
      amp2 = rnd(0.6, 1.1),
      ph = rnd(0, 1);
    const dune = (p) => {
      const f = p - Math.floor(p);
      const s = f < 0.72 ? f / 0.72 : (1 - f) / 0.28;
      return s * s * (3 - 2 * s);
    };
    return (x, z) => {
      const warp = n(x * 0.018, z * 0.018) * 1.1;
      const am = amp1 * (0.35 + 0.65 * n2(x * 0.012 + 7, z * 0.012 - 3));
      let h = dune((x * d1[0] + z * d1[1]) / lam1 + warp + ph) * am;
      h += dune((x * d2[0] + z * d2[1]) / lam2 + warp * 0.6) * amp2;
      return h + n(x * 0.01 + 5, z * 0.01) * 2.5 + n2(x * 0.07, z * 0.07) * 0.25 - 1.5;
    };
  }
  // 冰湖（冰原）：以獨立的亂數串決定，不動原本的亂數順序；湖面壓平到 level，邊緣以雜訊打亂成自然湖岸
  planIceLake() {
    const rng = makeRng(this.seed * 53 + 19);
    const ang = rng() * Math.PI * 2,
      dist = 30 + rng() * 14;
    const L = {
      x: Math.cos(ang) * dist,
      z: Math.sin(ang) * dist,
      rx: 12 + rng() * 6,
      rz: 9 + rng() * 5,
      rot: rng() * Math.PI,
      level: -0.7,
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
      const d = Math.hypot(lx / L.rx, lz / L.rz) + (n2(x * 0.08, z * 0.08) - 0.5) * 0.24;
      const t = clamp((1.15 - d) / 0.35, 0, 1);
      return lerp(h, L.level, t * t * (3 - 2 * t));
    };
    return L;
  }
  onCorridor(x, z, margin = 2) {
    const c = this.corridor;
    if (!c) return false;
    const u = x * c.perp.x + z * c.perp.y - c.off;
    return Math.abs(u) < c.width / 2 + margin;
  }
  corridorPoint(s) {
    const c = this.corridor;
    const x = c.dir.x * s + c.perp.x * c.off,
      z = c.dir.y * s + c.perp.y * c.off;
    return new THREE.Vector3(x, this.terrainHeight(x, z), z);
  }
  slopeOK(x, z) {
    const s =
      Math.abs(this.terrainHeight(x + 2, z) - this.terrainHeight(x - 2, z)) +
      Math.abs(this.terrainHeight(x, z + 2) - this.terrainHeight(x, z - 2));
    return s < 1.6;
  }
  buildProps() {
    const T = this.theme;
    if (T.grid) {
      // tall pillar blocks like the reference arena
      const pm = mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 });
      for (let k = 0, n = this.cnt(14, 22); k < n; k++) {
        let x = rnd(-55 * this.k, 55 * this.k),
          z = rnd(-55 * this.k, 55 * this.k);
        if (
          Math.hypot(x, z) < 10 ||
          this.onCorridor(x, z, 3) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 9)
        )
          continue;
        const w = rnd(3, 7),
          d = rnd(3, 7),
          h = RNG() < 0.3 ? rnd(2.5, 4) : rnd(9, 18);
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
    if (T.props) return this.buildThemeProps(T.props);
    const cMat = [mat(T.container), mat(T.container2), mat(0x8b8f94)],
      frame = mat(0x2a2d31);
    const count = this.themeKey === 'industrial' ? this.cnt(26, 36) : this.cnt(14, 22);
    for (let k = 0; k < count; k++) {
      let x,
        z,
        tries = 0;
      do {
        x = rnd(-52 * this.k, 52 * this.k);
        z = rnd(-52 * this.k, 52 * this.k);
        tries++;
      } while (
        tries < 20 &&
        (Math.hypot(x, z) < 10 ||
          this.onCorridor(x, z, 4) ||
          !this.slopeOK(x, z) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 7))
      );
      if (tries >= 20) continue;
      const rot = RNG() < 0.5 ? 0 : Math.PI / 2;
      const long = rnd(6, 9),
        short = rnd(2.6, 3.2),
        h = rnd(2.6, 3.0);
      const w = rot ? short : long,
        d = rot ? long : short;
      const y = this.terrainHeight(x, z);
      const cm = pick(cMat).clone();
      cm.transparent = true;
      const fm = frame.clone();
      fm.transparent = true;
      const g = buildContainer(w, h, d, rot, cm, fm);
      g.position.set(x, y - 0.15, z);
      this.scene.add(g);
      this.meshes.push(g);
      const ob = {
        kind: 'box',
        x,
        z,
        w,
        d,
        top: y - 0.15 + h,
        y: y - 0.15,
        group: g,
        mats: propMats(g) || [cm, fm],
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y - 0.2, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2),
        ),
      };
      this.obstacles.push(ob);
      this.occluders.push(ob);
      this.regProp('container', ob, 3000, cm.color.getHex());
      // stacked container sometimes
      if (RNG() < 0.25) {
        const g2 = g.clone();
        g2.position.y += h;
        const cloneMat = (m) => {
          const c = m.clone();
          c.transparent = true;
          return c;
        };
        g2.traverse((o) => {
          if (o.isMesh)
            o.material = Array.isArray(o.material) ? o.material.map(cloneMat) : cloneMat(o.material);
        });
        this.scene.add(g2);
        this.meshes.push(g2);
        const mats2 = [];
        g2.traverse((o) => {
          if (o.isMesh) mats2.push(...(Array.isArray(o.material) ? o.material : [o.material]));
        });
        const ob2 = {
          kind: 'box',
          x,
          z,
          w,
          d,
          top: ob.top + h,
          y: ob.top,
          group: g2,
          mats: mats2,
          box: new THREE.Box3(
            new THREE.Vector3(x - w / 2, ob.top, z - d / 2),
            new THREE.Vector3(x + w / 2, ob.top + h, z + d / 2),
          ),
        };
        this.obstacles.push(ob2);
        this.occluders.push(ob2);
        this.regProp('container', ob2, 3000, cm.color.getHex());
      }
    }
    if (T.hasRocks) {
      const rm = mat(T.rock, { roughness: 1 });
      for (let k = 0, n = this.cnt(10, 18); k < n; k++) {
        let x = rnd(-58 * this.k, 58 * this.k),
          z = rnd(-58 * this.k, 58 * this.k);
        if (Math.hypot(x, z) < 12 || this.onCorridor(x, z, 4)) continue;
        const r = rnd(1.8, 4.2);
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
        this.occluders.push(ob);
        this.regProp('rock', ob, 5000, T.rock);
      }
    }
    // pillars / lamp posts
    const pm = mat(0x33373c);
    for (let k = 0, n = this.cnt(6, 12); k < n; k++) {
      const x = rnd(-55 * this.k, 55 * this.k),
        z = rnd(-55 * this.k, 55 * this.k);
      if (Math.hypot(x, z) < 8 || this.onCorridor(x, z, 2) || !this.slopeOK(x, z)) continue;
      const h = rnd(5, 9);
      const m = buildLampPost(h, pm);
      m.position.set(x, this.terrainHeight(x, z) + h / 2 - 0.3, z);
      this.scene.add(m);
      this.meshes.push(m);
      {
        const ob = { kind: 'circle', x, z, r: 0.6, group: m, mats: [], box: null, h };
        this.obstacles.push(ob);
        this.regProp('pillar', ob, 1000, 0x33373c);
      }
    }
    // scattered debris (visual only)
    const dm = mat(0x55595e);
    for (let k = 0, n = Math.round(40 * this.k * this.k); k < n; k++) {
      const x = rnd(-60 * this.k, 60 * this.k),
        z = rnd(-60 * this.k, 60 * this.k);
      const m = buildDebris(rnd(0.3, 1.2), rnd(0.2, 0.5), rnd(0.3, 1.2), dm);
      m.position.set(x, this.terrainHeight(x, z) + 0.1, z);
      m.rotation.y = rnd(0, 3);
      m.castShadow = false;
      this.scene.add(m);
      this.meshes.push(m);
    }
    // vehicles (industrial): trucks
    if (this.themeKey !== 'snow') {
      for (let k = 0, n = this.cnt(3, 6); k < n; k++) {
        const x = rnd(-50 * this.k, 50 * this.k),
          z = rnd(-50 * this.k, 50 * this.k);
        if (Math.hypot(x, z) < 12 || this.onCorridor(x, z, 4) || !this.slopeOK(x, z)) continue;
        const cm = mat(k % 2 ? 0x2b4fb0 : 0xd8d8d8).clone();
        cm.transparent = true;
        const g = buildParkedTruck(cm);
        g.rotation.y = rnd(0, 6.28);
        g.position.set(x, this.terrainHeight(x, z) - 0.1, z);
        this.scene.add(g);
        this.meshes.push(g);
        const ob = {
          kind: 'circle',
          x,
          z,
          r: 3.6,
          group: g,
          mats: propMats(g) || [cm],
          box: new THREE.Box3().setFromObject(g),
        };
        this.obstacles.push(ob);
        this.occluders.push(ob);
        this.regProp('truck', ob, 1600, cm.color.getHex());
      }
    }
  }

  // ---------- 新主題的物件 ----------
  // 數量依場地面積放大（k²）
  cnt(a, b) {
    return Math.round(rndi(a, b) * this.k * this.k);
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
        (Math.hypot(x, z) < 10 ||
          this.onCorridor(x, z, 4) ||
          (slope && !this.slopeOK(x, z)) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < gap))
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
  // 純裝飾的廢鐵（不碰撞）
  addScrap(n, color) {
    for (let k = 0; k < n; k++) {
      const x = rnd(-60 * this.k, 60 * this.k),
        z = rnd(-60 * this.k, 60 * this.k);
      const m = buildScrap(rnd(0.8, 2), rnd(0.4, 1), rnd(0.6, 1.6), color);
      m.position.set(x, this.terrainHeight(x, z), z);
      m.rotation.y = rnd(0, 6.28);
      this.scene.add(m);
      this.meshes.push(m);
    }
  }
  buildThemeProps(kind) {
    const T = this.theme;
    if (kind === 'wasteland') {
      this.buildMachinery();
      this.scatter(this.cnt(5, 8), 9, (x, z, y) => {
        const color = pick([0xb08a3e, 0x8c8f86, 0xa0522d]);
        const g = buildOreHopper(color);
        if (RNG() < 0.5) g.rotation.y = Math.PI / 2;
        this.addSmall(g, x, y - 0.2, z, { w: HOPPER[0], h: HOPPER[1], d: HOPPER[2] }, 'hopper', 3000, color);
      });
      this.scatter(this.cnt(3, 5), 9, (x, z, y) => {
        const r = rnd(2.2, 3.4),
          h = rnd(4.5, 7.5),
          color = pick([0x8a5a3a, 0x9a8f7a, 0x6f7a80]);
        this.addSmall(buildStorageTank(r, h, color), x, y - 0.2, z, { r: r * 1.02, h }, 'tank', 2600, color);
      });
      this.scatter(
        this.cnt(8, 13),
        7,
        (x, z, y) => {
          const r = rnd(1.6, 2.8),
            h = rnd(5, 10);
          const g = buildRockSpire(r, h, T.rock);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(g, x, y - 0.5, z, { r, h }, 'spire', 5000, T.rock);
        },
        false,
      );
      this.scatter(this.cnt(4, 7), 6, (x, z, y) => {
        const h = rnd(8, 11);
        const g = buildFloodlight(h, 0x4a4540);
        g.rotation.y = rnd(0, 6.28);
        this.addSmall(g, x, y - 0.3, z, { r: 0.6, h }, 'floodlight', 1000, 0x4a4540);
      });
      this.addScrap(Math.round(40 * this.k * this.k), 0x5a4a3e);
    } else if (kind === 'dunes') {
      this.buildWrecks();
      this.scatter(this.cnt(5, 8), 8, (x, z, y) => {
        const color = pick([0x6a6f66, 0x7d7466, 0x5c6470]);
        const g = buildMtWreck(color);
        g.rotation.y = rnd(0, 6.28);
        const s = Math.max(MT_WRECK[0], MT_WRECK[2]);
        this.addSmall(g, x, y - 0.6, z, { w: s, h: MT_WRECK[1], d: s }, 'mtwreck', 2400, color);
      });
      this.scatter(
        this.cnt(6, 10),
        9,
        (x, z, y) => {
          const r = rnd(2.2, 3.6),
            h = rnd(5, 8);
          const g = buildSandstone(r, h, T.rock);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(g, x, y - 0.4, z, { r: r * 0.6, h }, 'sandstone', 5000, T.rock);
        },
        false,
      );
      this.scatter(
        this.cnt(4, 7),
        10,
        (x, z) => {
          const len = rnd(8, 16),
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
      this.addScrap(Math.round(30 * this.k * this.k), 0x8a7458);
    } else if (kind === 'snow') {
      this.buildIceField();
      this.scatter(this.cnt(6, 9), 9, (x, z, y) => {
        const color = pick([0x8a949e, 0x6b7d6a, 0xb8763a]);
        const g = buildQuonset(color);
        const rot = RNG() < 0.5;
        if (rot) g.rotation.y = Math.PI / 2;
        const [qw, qh, qd] = QUONSET;
        this.addSmall(
          g,
          x,
          y - 0.2,
          z,
          { w: rot ? qd : qw, h: qh, d: rot ? qw : qd },
          'quonset',
          3000,
          color,
        );
      });
      this.scatter(
        this.cnt(9, 14),
        7,
        (x, z, y) => {
          const r = rnd(1.6, 3);
          const g = buildIceChunk(r);
          g.rotation.y = rnd(0, 6.28);
          this.addSmall(g, x, y - 0.3, z, { r: r * 0.95, h: r * 1.4 }, 'ice', 4000, 0xbfe0f0);
        },
        false,
      );
      this.scatter(this.cnt(3, 5), 10, (x, z, y) => {
        const color = 0xd8dde2;
        const g = buildRadarDish(color);
        g.rotation.y = rnd(0, 6.28);
        this.addSmall(g, x, y - 0.2, z, { r: 1.6, h: 7 }, 'radar', 2200, color);
      });
      this.scatter(this.cnt(5, 8), 6, (x, z, y) => {
        const h = rnd(7, 9.5);
        this.addSmall(buildBeacon(h), x, y - 0.2, z, { r: 0.6, h }, 'beacon', 1000, 0xc8322a);
      });
      for (let k = 0, n = Math.round(30 * this.k * this.k); k < n; k++) {
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
      const R = DOME_R + 0.6;
      const spot = this.findSpot([-R, R, -R, R + 1], 3);
      if (!spot) continue;
      const g = buildObsDome(0xc8d0d8);
      g.position.y = spot.lo - 0.3;
      this.addBig(g, spot, [{ c: [0, 0], r: R, h: 3.5 + DOME_R }]);
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
      if (Math.hypot(nx, nz) < 16) continue;
      let ok = true,
        lo = 1e9,
        hi = -1e9,
        sum = 0,
        cnt = 0;
      for (let sx = a[0]; sx <= a[1] + 1e-6 && ok; sx += Math.max(1, (a[1] - a[0]) / 6))
        for (let sz = a[2]; sz <= a[3] + 1e-6; sz += Math.max(1, (a[3] - a[2]) / 6)) {
          if (this.onCorridor(sx, sz, 3)) {
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
  // 荒野：斗輪採掘機殘骸、高架輸送管線、鑽井架
  buildMachinery() {
    const R = MINING_RIG;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const spot = this.findSpot([-4.8, 4.8, -20.5, 13.5], 4.5, 40);
      if (!spot) continue;
      const g = buildMiningRig(pick([0xc8a040, 0xb07a38, 0x8c8f86]));
      g.position.y = spot.lo - 0.3;
      const [bw, bh, bd] = R.body;
      this.addBig(g, spot, [
        { box: [-bw / 2, bw / 2, -bd / 2, bd / 2], y: spot.lo - 0.3, top: spot.lo - 0.3 + bh },
        { c: [0, R.wheelZ], r: R.wheelR - 0.4, h: R.wheelY + R.wheelR },
      ]);
    }
    // 高架管線：試幾條軸向的直線，取沿線最高點最低的一條，管底在最高點上方 6 m
    for (let k = this.cnt(1, 2); k > 0; k--) {
      let best = null;
      for (let t = 0; t < 6; t++) {
        const axis = rndi(0, 1),
          off = rnd(-40 * this.k, 40 * this.k);
        let maxH = -1e9;
        for (let s = -50 * this.k; s <= 50 * this.k; s += 3) {
          const x = axis ? s : off,
            z = axis ? off : s;
          maxH = Math.max(maxH, this.terrainHeight(x, z));
        }
        if (this.obstacles.some((o) => o.pipeAxis === axis && Math.abs(o.pipeOff - off) < 20)) continue;
        if (!best || maxH < best.maxH) best = { axis, off, maxH };
      }
      if (!best) continue;
      const len = Math.floor((99 * this.k) / PIPE.seg) * PIPE.seg,
        y0 = best.maxH + 6,
        color = 0xb89a5a;
      const g = new THREE.Group();
      for (let i = 0; i < len / PIPE.seg; i++) {
        const seg = buildPipeSegment(color);
        seg.position.z = -len / 2 + PIPE.seg * (i + 0.5);
        g.add(seg);
      }
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
        this.scene.add(sp);
        this.meshes.push(sp);
        this.obstacles.push({ kind: 'circle', x, z, r: 1.1, group: sp, mats: [], box: null, h: y0 - gy });
      }
    }
    for (let k = this.cnt(2, 4); k > 0; k--) {
      const spot = this.findSpot([-2.3, 2.3, -2.3, 2.3], 1.5);
      if (!spot) continue;
      const h = rnd(14, 20),
        color = 0x9a6a3a;
      const g = buildDerrick(h, color);
      g.position.y = spot.lo - 0.2;
      const [ob] = this.addBig(g, spot, [{ c: [0, 0], r: 2.3, h }]);
      this.regProp('derrick', ob, 2500, color);
    }
  }
  // 沙丘：半埋的艦體殘骸與拱形殘骸
  buildWrecks() {
    const H = WRECK_HULL;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const spot = this.findSpot([-H.box[0] / 2, H.box[0] / 2, -H.box[1] / 2, H.box[1] / 2], 3.5);
      if (!spot) continue;
      const g = buildWreckHull(pick([0x7d7466, 0x6a6f74, 0x8a6e52]));
      g.position.y = spot.avg - H.sink;
      this.addBig(g, spot, [
        {
          box: [-H.box[0] / 2, H.box[0] / 2, -H.box[1] / 2, H.box[1] / 2],
          y: spot.lo - 1,
          top: spot.avg + H.box[2],
        },
      ]);
    }
    const A = WRECK_ARCH;
    for (let k = this.cnt(1, 2); k > 0; k--) {
      const ex = A.feet[0] + A.feet[1];
      const spot = this.findSpot([-ex, ex, -A.feet[1], A.feet[1]], 3);
      if (!spot) continue;
      const g = buildWreckArch(pick([0x6f675c, 0x847a6a]));
      g.position.y = spot.avg;
      this.addBig(g, spot, [
        { c: [-A.feet[0], 0], r: A.feet[1], h: 4 },
        { c: [A.feet[0], 0], r: A.feet[1], h: 4 },
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
    const kinds = ['river_bridge', 'overpass', 'bunkers', 'trench', 'platforms'];
    const n = this.theme.flat ? rndi(1, 3) : rndi(2, 4);
    const chosen = [];
    while (chosen.length < n) {
      const k = pick(kinds);
      if (!chosen.includes(k)) chosen.push(k);
    }
    {
      const diag = RNG() < 0.5 ? 1 : -1;
      const d = new THREE.Vector2(1, diag).normalize();
      this.corridor = {
        kind: RNG() < 0.5 ? 'road' : 'rail',
        dir: d,
        perp: new THREE.Vector2(-d.y, d.x),
        off: rnd(-6, 6),
        width: 10,
        len: this.size * 0.75,
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
          width: rnd(13, 18),
          depth: rnd(4.5, 6.5),
          bridges: [rnd(-38 * this.k, -8), rnd(8, 38 * this.k)],
          deckW: 9,
        });
        this.featureNames.push('河道與橋梁');
      } else if (k === 'overpass') {
        this.features.push({
          k,
          dir,
          perp,
          off,
          center: rnd(-15 * this.k, 15 * this.k),
          span: rnd(34, 46),
          rampL: 18,
          deckH: 7.5,
          deckW: 10,
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
          width: rnd(6, 9),
          depth: rnd(2.5, 3.5),
          len: rnd(50 * this.k, 90 * this.k),
        });
        this.featureNames.push('壕溝');
      } else {
        this.features.push({ k, count: this.cnt(2, 4) });
        this.featureNames.push('高台');
      }
    }
    this.features.push({
      k: 'corridor',
      dir: this.corridor.dir,
      perp: this.corridor.perp,
      off: this.corridor.off,
      width: 10,
      len: this.corridor.len,
      kind: this.corridor.kind,
    });
  }
  featureHeight(x, z, h) {
    for (const f of this.features) {
      if (f.k === 'river_bridge') {
        const u = x * f.perp.x + z * f.perp.y - f.off;
        const t = clamp(1 - (Math.abs(u) - f.width / 2 + 2) / 3, 0, 1);
        h -= f.depth * t * t * (3 - 2 * t);
      } else if (f.k === 'overpass') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y - f.center;
        const lat = clamp(1 - (Math.abs(u) - f.deckW / 2) / 2.5, 0, 1);
        const half = f.span / 2;
        if (lat > 0 && Math.abs(v) > half && Math.abs(v) < half + f.rampL) {
          const t = 1 - (Math.abs(v) - half) / f.rampL;
          h = lerp(h, Math.max(h, f.deckH * t + h * (1 - t)), lat);
        }
      } else if (f.k === 'trench') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y;
        if (Math.abs(v) < f.len / 2) {
          const t = clamp(1 - (Math.abs(u) - f.width / 2 + 1.5) / 2, 0, 1);
          h -= f.depth * t;
        }
      }
    }
    if (this.corridor) {
      const c = this.corridor;
      const u = x * c.perp.x + z * c.perp.y - c.off;
      const v = x * c.dir.x + z * c.dir.y;
      const inside = clamp(1 - (Math.abs(u) - c.width / 2) / 3.5, 0, 1);
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
      : buildDeck(w, d, thick, rotY, mats);
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
    const c = this.theme.props ? buildThemePillar(this.theme.props, r, h) : buildPillar(r, h, m);
    c.position.set(x, y0 + h / 2, z);
    this.scene.add(c);
    this.meshes.push(c);
    this.obstacles.push({ kind: 'circle', x, z, r: r * 1.1, group: c, mats: [], box: null });
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
      name: {
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
      }[kind],
      pos: c,
      center: () => c.clone(),
      flashT: 0,
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
      for (let s = -half; s <= half; s += 2) {
        const x = c.dir.x * s + c.perp.x * (c.off + u),
          z = c.dir.y * s + c.perp.y * (c.off + u);
        out.push(new THREE.Vector3(x, this.terrainHeight(x, z) + 0.06, z));
      }
      return out;
    };
    const road = c.kind === 'road';
    for (const [u0, u1, color, rough, y] of road ? ROAD_STRIPS : RAIL_STRIPS) {
      const m = stripMesh(pts(u0), pts(u1), color, rough, y);
      this.scene.add(m);
      this.meshes.push(m);
    }
    const P = road ? LANE_MARK : RAIL_TIE; // 公路中線標線／鐵路枕木
    for (let s = -half; s < half; s += P.step) {
      const x = c.dir.x * s + c.perp.x * c.off,
        z = c.dir.y * s + c.perp.y * c.off;
      const m = corridorPiece(P);
      m.position.set(x, this.terrainHeight(x, z) + P.y, z);
      m.rotation.y = Math.atan2(c.dir.x, c.dir.y);
      this.scene.add(m);
      this.meshes.push(m);
    }
    // 隧道口：地圖兩端各一座（拱門＋門柱＋黑洞＋山體）
    for (const sgn of [-1, 1]) {
      const s = sgn * ((this.size / 2) * 0.86);
      const x = c.dir.x * s + c.perp.x * c.off,
        z = c.dir.y * s + c.perp.y * c.off;
      const y = this.terrainHeight(x, z);
      const g = this.theme.props ? buildThemeTunnel(this.theme.props) : buildTunnelPortal(this.theme.rock);
      g.position.set(x, y - 0.1, z);
      g.rotation.y = Math.atan2(c.dir.x, c.dir.y) + (sgn > 0 ? Math.PI : 0);
      this.scene.add(g);
      this.meshes.push(g);
    }
    this.corridorHalf = half;
  }
  buildFeatures() {
    this.buildCorridor();
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
                    cx0 + f.dir.x * q * (f.deckW / 2 + 2),
                    cz0 + f.dir.y * q * (f.deckW / 2 + 2),
                    9,
                  )
                )
                  clear = false;
              if (clear) break;
              bpos += (bpos < 0 ? -1 : 1) * 6;
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
          const span = f.width + 8;
          const deckY =
            Math.max(
              this.terrainHeight(cx + f.perp.x * (span / 2), cz + f.perp.y * (span / 2)),
              this.terrainHeight(cx - f.perp.x * (span / 2), cz - f.perp.y * (span / 2)),
            ) + 0.3;
          this.addDeck(cx, cz, rot ? span : f.deckW, rot ? f.deckW : span, deckY, 0.7, !rot, mats);
          for (const s of [-1, 1])
            for (const q of [-1, 1]) {
              const px = cx + f.perp.x * s * f.width * 0.28 + f.dir.x * q * f.deckW * 0.35,
                pz = cz + f.perp.y * s * f.width * 0.28 + f.dir.y * q * f.deckW * 0.35;
              if (this.onCorridor(px, pz, 1)) continue;
              this.addPillar(px, pz, 0.6, deckY - f.depth - 1.5, deckY - 0.7, mats.pillar);
            }
        }
      } else if (f.k === 'overpass') {
        const cx = f.perp.x * f.off + f.dir.x * f.center,
          cz = f.perp.y * f.off + f.dir.y * f.center;
        const rot = Math.abs(f.dir.x) > 0.5;
        const deckY = f.deckH + this.terrainHeight(cx, cz) * 0;
        const base = this.terrainHeight(cx, cz);
        const dy = Math.max(deckY, base + 5, 7.2);
        this.addDeck(cx, cz, rot ? f.span : f.deckW, rot ? f.deckW : f.span, dy, 0.8, !rot, mats);
        const np = Math.floor(f.span / 12);
        for (let i = 0; i <= np; i++) {
          const v = -f.span / 2 + 4 + (i * (f.span - 8)) / np;
          for (const s of [-1, 1]) {
            const px = cx + f.dir.x * v + f.perp.x * s * f.deckW * 0.32,
              pz = cz + f.dir.y * v + f.perp.y * s * f.deckW * 0.32;
            if (this.onCorridor(px, pz, 1.5)) continue;
            this.addPillar(px, pz, 0.55, this.terrainHeight(px, pz) - 0.5, dy - 0.8, mats.pillar);
          }
        }
      } else if (f.k === 'bunkers') {
        for (let i = 0; i < f.count; i++) {
          let x = rnd(-48 * this.k, 48 * this.k),
            z = rnd(-48 * this.k, 48 * this.k);
          const w = rnd(9, 14),
            d = rnd(9, 14);
          {
            let tr = 0;
            while (
              tr++ < 10 &&
              (Math.hypot(x, z) < 10 ||
                this.onCorridor(x, z, Math.max(w, d) * 0.72 + 2) ||
                !this.slopeOK(x, z))
            ) {
              x = rnd(-48 * this.k, 48 * this.k);
              z = rnd(-48 * this.k, 48 * this.k);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const h = rnd(5, 6.5);
          this.addDeck(x, z, w, d, y0 + h, 0.8, false, mats);
          for (const sx of [-1, 1])
            for (const sz of [-1, 1])
              this.addPillar(
                x + sx * (w / 2 - 1),
                z + sz * (d / 2 - 1),
                0.5,
                y0 - 0.5,
                y0 + h - 0.8,
                mats.pillar,
              );
          // one side wall for cover
          const side = RNG() < 0.5;
          const wm = mats.pillar.clone();
          wm.transparent = true;
          const ww = side ? w - 2 : 0.8,
            wd = side ? 0.8 : d - 2;
          const wx = x + (side ? 0 : (w / 2 - 0.4) * (RNG() < 0.5 ? 1 : -1)),
            wz = z + (side ? (d / 2 - 0.4) * (RNG() < 0.5 ? 1 : -1) : 0);
          let wall;
          if (T.props) {
            wall = buildThemeWall(T.props, ww, h - 0.8, wd);
            wall.position.set(wx, y0 + (h - 0.8) / 2, wz);
          } else wall = box(ww, h - 0.8, wd, wm, wx, y0 + (h - 0.8) / 2, wz);
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
          const w = rnd(10, 18),
            d = rnd(10, 18),
            h = rnd(4, 7);
          {
            let tr = 0;
            while (tr++ < 10 && (Math.hypot(x, z) < 12 || this.onCorridor(x, z, Math.max(w, d) * 0.72 + 8))) {
              x = rnd(-45 * this.k, 45 * this.k);
              z = rnd(-45 * this.k, 45 * this.k);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const m2 = pm.clone();
          m2.transparent = true;
          let g;
          if (T.props) {
            g = buildThemePlatform(T.props, w, h, d);
            g.position.set(x, y0 - 0.5, z);
          } else g = box(w, h, d, m2, x, y0 + h / 2 - 0.5, z);
          this.scene.add(g);
          this.meshes.push(g);
          const ob = {
            kind: 'box',
            x,
            z,
            w,
            d,
            top: y0 + h - 0.5,
            y: y0 - 0.5,
            group: g,
            mats: T.props ? propMats(g) || fadeMatsOf(g) : [m2],
            box: new THREE.Box3(
              new THREE.Vector3(x - w / 2, y0 - 0.5, z - d / 2),
              new THREE.Vector3(x + w / 2, y0 + h - 0.5, z + d / 2),
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
          const rw = side[0] ? rl : 6,
            rd = side[1] ? rl : 6;
          const rg = T.props ? buildThemeRamp(T.props, rw, rd) : box(rw, 0.4, rd, pm, 0, 0, 0);
          rg.position.set(rx, y0 + h / 2 - 0.7, rz);
          rg.rotation.z = side[0] ? -side[0] * Math.atan2(h - 0.5, rl) : 0;
          rg.rotation.x = side[1] ? side[1] * Math.atan2(h - 0.5, rl) : 0;
          this.scene.add(rg);
          this.meshes.push(rg);
          this.ramps = this.ramps || [];
          this.ramps.push({ x: rx, z: rz, w: rw, d: rd, side, y0: y0 - 0.5, y1: y0 + h - 0.5, len: rl });
        }
      }
    }
  }
  rampHeight(x, z) {
    if (!this.ramps) return -1e9;
    let best = -1e9;
    for (const r of this.ramps) {
      if (Math.abs(x - r.x) > r.w / 2 || Math.abs(z - r.z) > r.d / 2) continue;
      const along = r.side[0] ? (r.x - x) * r.side[0] : (r.z - z) * r.side[1];
      const t = clamp((along + r.len / 2) / r.len, 0, 1);
      best = Math.max(best, lerp(r.y0, r.y1, t));
    }
    return best;
  }
  ceiling(x, z, y, h) {
    let c = 1e9;
    for (const o of this.obstacles) {
      if (o.kind !== 'box' || !o.deck) continue;
      if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2 && y < o.y - 0.2 && y + h > o.y)
        c = Math.min(c, o.y);
    }
    return c;
  }
  // ground height incl. box tops for an entity at (x,z) currently at height y
  groundAt(x, z, y) {
    let g = Math.max(this.terrainHeight(x, z), this.rampHeight(x, z));
    for (const o of this.obstacles) {
      if (o.kind !== 'box') continue;
      if (
        Math.abs(x - o.x) < o.w / 2 + 0.3 &&
        Math.abs(z - o.z) < o.d / 2 + 0.3 &&
        y >= o.top - 0.6 &&
        o.top > g
      )
        g = o.top;
    }
    return g;
  }
  // horizontal collision push-out; returns [x,z]
  collide(x, z, y, r) {
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
        if (y >= o.top - 0.6) continue;
        if (o.deck && y + 3.2 < o.y) continue;
        if (o.deck && y < o.y - 0.2) continue;
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
    // arena bounds + steep walls: keep inside lim（62 × k）
    const lim = this.lim;
    x = clamp(x, -lim, lim);
    z = clamp(z, -lim, lim);
    return [x, z];
  }
  // projectile vs world
  hitsWorld(p) {
    if (p.y < this.terrainHeight(p.x, p.z) || p.y < this.rampHeight(p.x, p.z)) return true;
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
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
  spawnPoint(minDistFrom, others) {
    for (let t = 0; t < 40; t++) {
      const x = rnd(-50 * this.k, 50 * this.k),
        z = rnd(-50 * this.k, 50 * this.k);
      if (this.onCorridor(x, z, 2)) continue;
      if (!this.slopeOK(x, z)) continue;
      if (Math.hypot(x - minDistFrom.x, z - minDistFrom.z) < 28) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
      if (
        this.obstacles.some((o) =>
          o.kind === 'box'
            ? Math.abs(x - o.x) < o.w / 2 + 1.5 && Math.abs(z - o.z) < o.d / 2 + 1.5
            : Math.hypot(x - o.x, z - o.z) < o.r + 1.5,
        )
      )
        continue;
      return { x, z };
    }
    return { x: rnd(-40 * this.k, 40 * this.k), z: rnd(-40 * this.k, 40 * this.k) };
  }
  dispose() {
    if (this.weather) this.weather.dispose();
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
  }
  // fade objects between camera and player
  updateOcclusion(camPos, playerPos, dt) {
    const ray = new THREE.Ray(camPos.clone(), playerPos.clone().sub(camPos).normalize());
    const dist = camPos.distanceTo(playerPos);
    for (const o of this.occluders) {
      if (!o.box) continue;
      let hit = false;
      const r = ray.intersectBox(o.box, new THREE.Vector3());
      if (r && r.distanceTo(camPos) < dist - 1) hit = true;
      const target = hit ? 0.22 : 1;
      for (const m of o.mats) {
        m.opacity = lerp(m.opacity, target, Math.min(1, dt * 10));
        m.depthWrite = m.opacity > 0.9;
      }
    }
  }
}
