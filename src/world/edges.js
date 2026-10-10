// 地圖邊界外的景觀：取代原本四周一樣高的圍坡，讓場地融入場景，不像被框在碗裡。
// - 邊界依角度分成 5～8 段，每段一種處理（山脊、階梯開採面、丘陵、平地延伸、斷崖、水面、貨櫃牆、全像牆、
//   巨型隔牆…），段與段之間平滑過渡；公路／鐵路的隧道口與水壩兩端固定是山脊（隧道要鑽進山裡、壩體要靠在山上）。
// - 地圖外再加一圈遠景地形（到 FAR_R）與剪影物件（不碰撞、不投影），地形照主題原本的輪廓往外延伸。
// - 作戰區域（±lim）與出界緩衝帶（±limOut）裡不改地形。全部用自己的亂數串，不動關卡生成的亂數順序。
import { clamp, lerp, makeRng } from '../core/math.js';
import {
  box,
  buildContainer,
  buildDerrick,
  buildFloodlight,
  buildGridPillar,
  buildIceShard,
  buildMiningRig,
  buildObsDome,
  buildOreHopper,
  buildPipeSegment,
  buildQuonset,
  buildRadarDish,
  buildRockSpire,
  buildSandFence,
  buildSandstone,
  buildScrap,
  buildStorageTank,
  buildWreckArch,
  buildWreckHull,
  mat,
} from './prop-models.js';
import { buildControlHouse, buildPylon } from './themes/dam.js';
import { buildRuinTower, buildSunkBus } from './themes/flooded.js';
import { buildChimney, buildPipeStack, buildShack } from './themes/grid086.js';
import { buildCavePillar, buildCoralCrystal, buildLab } from './themes/institute.js';
import { buildCommMast, buildDockModule, buildRadiator, buildSolarArray } from './themes/orbit.js';
import {
  buildAntennaMast,
  buildBlastWall,
  buildControlTower,
  buildFuelSphere,
  buildHangar,
  buildLaunchTower,
} from './themes/spaceport.js';
import { buildAATurret, buildGlassTower } from './themes/xylem.js';

export const FAR_R = 440; // 遠景地形的外緣（m，離地圖中心）
export const OOB_BUF = 14; // 出界緩衝帶：作戰區域外還能走多遠（world.limOut＝lim＋這個）
const BW = 0.12; // 段與段之間的過渡寬度（rad）
const sm = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
// 角度差（−π～π）
const angD = (a, b) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

// 各種處理的高度增量：d＝離邊界起點的距離（m），a＝沿邊界的座標（m），P＝這段的參數，n／n2＝雜訊（0～1）
const SHAPE = {
  ridge: (d, a, P, n, n2) =>
    P.H * sm(d / P.W) * (0.6 + 0.8 * n(a * 0.022 + P.o, 1.7)) +
    P.H * 0.35 * sm(d / (P.W * 0.7)) * (n2(a * 0.07 + P.o, d * 0.07) - 0.4),
  // 階梯狀的開採面（礦坑）：四層平台
  terrace: (d, a, P, n) => {
    const q = sm(d / P.W) * (0.75 + 0.4 * n(a * 0.02 + P.o, 2.3)) * 4;
    const f = q - Math.floor(q);
    return (P.H * (Math.floor(q) + sm((f - 0.65) / 0.35))) / 4;
  },
  hills: (d, a, P, n) => P.H * sm(d / P.W) * (0.3 + 0.7 * n(a * 0.03 + P.o, d * 0.03 + 4)),
  drop: (d, a, P, n) => -P.D * sm((d - 1) / P.W) * (0.8 + 0.4 * n(a * 0.03 + P.o, 6.1)),
  water: (d, a, P) => -P.D * sm(d / P.W),
};
const RAISED = ['ridge', 'terrace', 'hills'];

// 各主題的邊界設定：kinds＝可出現的處理與權重；H／D／W＝隆起高度、下降深度、寬度範圍；
// range＝遠方山脈的高度（0＝沒有）；none＝不改地形、沒有遠景地形（虛空地圖：本來就是深淵）；props＝剪影物件
const STYLES = {
  snow: { kinds: { ridge: 3, hills: 2, open: 2, drop: 1 }, H: [14, 30], D: [10, 18], range: 70 },
  industrial: {
    kinds: { wall: 3, open: 2, hills: 1 },
    H: [5, 10],
    range: 25,
    tunnel: { H: [12, 16], hw: 0.12 },
  },
  grid: { kinds: { holo: 3, open: 2 }, H: [0, 0], range: 0, flat: true },
  desert: { kinds: { terrace: 3, open: 1, drop: 1 }, H: [16, 28], D: [12, 20], range: 55 },
  wasteland: { kinds: { ridge: 2, mesa: 2, open: 2, drop: 1 }, H: [12, 24], D: [14, 24], range: 45 },
  dunes: { kinds: { open: 3, hills: 2 }, H: [7, 15], range: 25 },
  flooded: { kinds: { open: 3, water: 2 }, D: [3, 6], range: 0 },
  dam: { kinds: { hills: 2, open: 2, drop: 1, ridge: 1 }, H: [12, 22], D: [8, 14], range: 80 },
  spaceport: {
    kinds: { wall: 2, open: 3, drop: 1 },
    D: [10, 18],
    range: 30,
    tunnel: { H: [12, 16], hw: 0.11 },
  },
  grid086: {
    kinds: { drop: 3, wall: 2, open: 1 },
    D: [40, 70],
    dropW: [6, 12],
    range: 0,
    tunnel: { H: [12, 16], hw: 0.11 },
  },
  institute: { kinds: { ridge: 3, drop: 2, open: 2 }, H: [20, 30], D: [16, 30], range: 0 },
  xylem: { none: true },
  orbit: { none: true },
};

function pickW(r, kinds) {
  let sum = 0;
  for (const k in kinds) sum += kinds[k];
  let t = r() * sum;
  for (const k in kinds) if ((t -= kinds[k]) <= 0) return k;
  return Object.keys(kinds)[0];
}

// 規劃邊界：w.edges＝{ S, e0, arcs, forced, range, none }
export function planEdges(w) {
  const ST = STYLES[w.themeKey] || STYLES.industrial;
  const r = makeRng(w.seed * 61 + 29);
  const R = (a, b) => a + (b - a) * r();
  const S = w.size / 2;
  const E = {
    S,
    e0: w.lim + OOB_BUF - 2,
    arcs: [],
    forced: [],
    range: ST.range || 0,
    none: !!ST.none,
    st: ST,
  };
  if (E.none) return E;
  // 分段：n 段，大小隨機（每段至少約 25°）
  const n = 5 + Math.floor(r() * 4);
  const base = r() * Math.PI * 2;
  const cuts = [];
  for (let i = 0; i < n; i++) cuts.push(base + ((i + (r() - 0.5) * 0.55) * Math.PI * 2) / n);
  const kinds = [];
  for (let i = 0; i < n; i++) {
    let k = pickW(r, ST.kinds);
    for (let t = 0; t < 6 && i > 0 && k === kinds[i - 1]; t++) k = pickW(r, ST.kinds);
    kinds.push(k);
  }
  if (kinds.length > 1 && kinds[n - 1] === kinds[0]) {
    for (let t = 0; t < 6 && (kinds[n - 1] === kinds[0] || kinds[n - 1] === kinds[n - 2]); t++)
      kinds[n - 1] = pickW(r, ST.kinds);
  }
  for (let i = 0; i < n; i++) {
    const a0 = cuts[i],
      a1 = cuts[(i + 1) % n] + (i === n - 1 ? Math.PI * 2 : 0);
    const H = ST.H ? R(ST.H[0], ST.H[1]) : 0;
    E.arcs.push({
      kind: kinds[i],
      c: (a0 + a1) / 2,
      hw: (a1 - a0) / 2,
      H,
      D: ST.D ? R(ST.D[0], ST.D[1]) : 0,
      W: kinds[i] === 'drop' && ST.dropW ? R(ST.dropW[0], ST.dropW[1]) : R(26, 55),
      o: R(0, 100),
    });
  }
  // 不要圍成一圈：隆起的段落最多佔邊界的 62%，超過時把最大的隆起段改成開放的（平地、斷崖、水面…）
  const open = Object.keys(ST.kinds).filter((k) => !RAISED.includes(k));
  for (let t = 0; t < n && open.length; t++) {
    const up = E.arcs.filter((A) => RAISED.includes(A.kind));
    if (up.reduce((s, A) => s + A.hw, 0) / Math.PI <= 0.62) break;
    const A = up.reduce((a, b) => (b.hw > a.hw ? b : a));
    A.kind = open[Math.floor(r() * open.length)];
    if (A.kind === 'drop' && ST.dropW) A.W = R(ST.dropW[0], ST.dropW[1]);
  }
  // 固定是山脊的地方：公路／鐵路兩端的隧道口、水壩兩端
  const ridgeAt = (x, z, H, start, hw) =>
    E.forced.push({ kind: 'ridge', c: Math.atan2(z, x), hw, H, W: 16, o: R(0, 100), start });
  if (w.corridor) {
    for (const sgn of [-1, 1]) {
      const p = w.corridorPoint(sgn * w.trackS);
      const TN = ST.tunnel || { H: [16, 22], hw: 0.15 };
      ridgeAt(p.x, p.z, R(TN.H[0], TN.H[1]), w.trackS + 2, TN.hw);
    }
  }
  // 水壩：上游方向的段落是水庫（往外延伸成湖面）
  if (w.dam)
    for (const A of E.arcs)
      if (Math.sin(A.c) * w.dam.up > 0.45) {
        A.kind = 'water';
        A.D = 3;
      }
  if (w.dam) for (const sx of [-1, 1]) ridgeAt(sx * S, w.dam.zc, 26, E.e0, 0.24);
  return E;
}

// 邊界外的高度增量（作戰區域與緩衝帶裡為 0）
export function edgeDelta(w, x, z) {
  const E = w.edges;
  if (!E || E.none) return 0;
  const e = Math.max(Math.abs(x), Math.abs(z));
  const n = w.noise,
    n2 = w.noise2;
  const th = Math.atan2(z, x),
    a = th * E.S;
  let h = 0;
  const d = e - E.e0;
  if (d > 0) {
    let sum = 0,
      ws = 0;
    for (const A of E.arcs) {
      const wt = 1 - sm((Math.abs(angD(th, A.c)) - A.hw + BW) / (2 * BW));
      if (wt <= 0) continue;
      const f = SHAPE[A.kind];
      sum += wt * (f ? f(d, a, A, n, n2) : 0);
      ws += wt;
    }
    h = ws ? sum / ws : 0;
    if (E.range) {
      // 遠方山脈：以圓形距離計算（不會圍成方框），依方向時有時無，起點遠近也隨方向變化
      const rr = Math.hypot(x, z) - E.S - 90 - 50 * n(a * 0.01 + 3, 1.3);
      let amp = sm((n(a * 0.006 + 11, 0.5) - 0.3) / 0.4);
      if (w.dam) amp *= 1 - sm(((z * w.dam.up) / Math.hypot(x, z) - 0.1) / 0.5); // 水庫往上游延伸到天邊
      h += E.range * amp * sm(rr / 120) * (0.6 + 0.4 * n2(x * 0.01, z * 0.01));
    }
  }
  for (const F of E.forced) {
    const df = e - F.start;
    if (df <= 0) continue;
    const wt = 1 - sm((Math.abs(angD(th, F.c)) - F.hw + BW * 0.6) / (BW * 1.2));
    if (wt > 0) h = lerp(h, Math.max(h, SHAPE.ridge(df, a, F, n, n2)), wt);
  }
  return h;
}

// ---------- 遠景地形：地圖外一圈方環（與地圖重疊 5 m，壓在地圖下方，邊上的頂點與地圖相同）----------
function buildFarTerrain(w) {
  const S = w.size / 2,
    T = w.theme;
  const pos = new Set();
  for (let v = 0; v <= S - 5; v += 5) pos.add(v);
  pos.add(S);
  for (let v = S + 5; v <= S + 80; v += 5) pos.add(v);
  for (let v = S + 90; v <= S + 160; v += 10) pos.add(v);
  for (let v = S + 180; v < FAR_R; v += 20) pos.add(v);
  pos.add(FAR_R);
  const pv = [...pos].sort((a, b) => a - b);
  const C = [
    ...pv
      .slice(1)
      .map((v) => -v)
      .reverse(),
    ...pv,
  ];
  const N = C.length;
  const H = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const x = C[i],
        z = C[j];
      const e = Math.max(Math.abs(x), Math.abs(z));
      H[j * N + i] = e < S - 0.01 ? w.terrainHeight(x, z) - 1.5 : w.farHeight(x, z);
    }
  const P = [],
    col = [];
  const cg = new THREE.Color(T.ground),
    cs = new THREE.Color(T.slope),
    cr = new THREE.Color(T.rock),
    tmp = new THREE.Color();
  const va = new THREE.Vector3(),
    vb = new THREE.Vector3(),
    vc = new THREE.Vector3(),
    nn = new THREE.Vector3(),
    tv = new THREE.Vector3();
  const tri = (i0, j0, i1, j1, i2, j2) => {
    va.set(C[i0], H[j0 * N + i0], C[j0]);
    vb.set(C[i1], H[j1 * N + i1], C[j1]);
    vc.set(C[i2], H[j2 * N + i2], C[j2]);
    nn.subVectors(vb, va).cross(tv.subVectors(vc, va)).normalize();
    const y = (va.y + vb.y + vc.y) / 3;
    tmp.copy(cg).lerp(cs, clamp((0.93 - nn.y) * 6, 0, 1));
    if (y > 9) tmp.lerp(cr, clamp((y - 9) / 6, 0, 0.7));
    tmp.offsetHSL(0, 0, (w.noise2(va.x * 0.37, va.z * 0.37) - 0.5) * 0.04);
    for (const v of [va, vb, vc]) {
      P.push(v.x, v.y, v.z);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  };
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      // 完全在地圖裡面（地圖蓋得住）的格子略過
      if (
        Math.max(Math.abs(C[i]), Math.abs(C[i + 1])) < S - 4 &&
        Math.max(Math.abs(C[j]), Math.abs(C[j + 1])) < S - 4
      )
        continue;
      tri(i, j, i, j + 1, i + 1, j);
      tri(i + 1, j, i, j + 1, i + 1, j + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const m = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.95,
      metalness: 0.02,
      polygonOffset: true,
      polygonOffsetFactor: 2,
      polygonOffsetUnits: 2,
    }),
  );
  m.receiveShadow = true;
  m.userData.farTerrain = true;
  return m;
}

// ---------- 剪影物件 ----------
// 全像牆的貼圖（模擬訓練場）：格線＋上下淡出
let HOLO_TEX = null;
function holoTex() {
  if (HOLO_TEX) return HOLO_TEX;
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(120,220,255,0)');
  g.addColorStop(0.55, 'rgba(120,220,255,0.35)');
  g.addColorStop(1, 'rgba(120,220,255,0.7)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 128);
  c.fillStyle = 'rgba(200,245,255,0.9)';
  for (let y = 0; y < 128; y += 16) c.fillRect(0, y, 64, 1);
  for (let x = 0; x < 64; x += 16) c.fillRect(x, 0, 1, 128);
  HOLO_TEX = new THREE.CanvasTexture(cv);
  HOLO_TEX.wrapS = THREE.RepeatWrapping;
  return HOLO_TEX;
}
function holoPanel(len, h) {
  const t = holoTex().clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(1, Math.round(len / 4)), 1);
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(len, h),
    new THREE.MeshBasicMaterial({
      map: t,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  m.position.y = h / 2;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
function warehouse(r, wd, h, dp) {
  const g = new THREE.Group();
  const wall = mat(r() < 0.5 ? 0x6a7078 : 0x7a6a5a, { roughness: 0.9 });
  g.add(box(wd, h, dp, wall, 0, h / 2, 0));
  g.add(box(wd + 1, 0.8, dp + 1, mat(0x4a5058, { roughness: 0.8 }), 0, h + 0.4, 0));
  for (let i = -1; i <= 1; i++)
    g.add(box(5, h * 0.55, 0.3, mat(0x3a3f45), (i * wd) / 3.2, (h * 0.55) / 2, dp / 2 + 0.1));
  return g;
}
function gantryCrane(h, span) {
  const g = new THREE.Group();
  const y = mat(0xd8a020, { roughness: 0.6 });
  for (const sx of [-1, 1]) {
    g.add(box(1.2, h, 1.2, y, (sx * span) / 2, h / 2, -3));
    g.add(box(1.2, h, 1.2, y, (sx * span) / 2, h / 2, 3));
  }
  g.add(box(span + 4, 1.6, 7.5, y, 0, h + 0.8, 0));
  g.add(box(4, 3, 4, mat(0x3a3f45), span * 0.2, h - 1.5, 0));
  return g;
}
function bulkhead(r, wd, h) {
  const g = new THREE.Group();
  const m = mat(0x3c3834, { roughness: 0.95 });
  g.add(box(wd, h, 6, m, 0, h / 2, 0));
  const t = mat(0xd8a020, { roughness: 0.7 });
  for (let y = 6; y < h; y += r() < 0.5 ? 8 : 11) g.add(box(wd + 0.4, 0.6, 6.4, t, 0, y, 0));
  g.add(box(wd * 0.3, 2, 6.6, mat(0x1a1816), wd * (r() - 0.5) * 0.4, h * 0.3, 0));
  return g;
}
function island(wd, dp, color) {
  return box(wd, 40, dp, mat(color, { roughness: 0.8 }), 0, -20, 0);
}

// 各主題的剪影物件：每段依處理種類呼叫 per(c, A)，全部之後呼叫 all(c)
const PROPS = {
  snow: {
    per(c, A) {
      if (A.kind === 'open')
        c.spread(A, 3, 18, 70, (p) =>
          c.put(
            c.pick([
              () => buildRadarDish(0x8a949c),
              () => buildObsDome(0xd8dde2),
              () => buildQuonset(0x6b7d6a),
            ])(),
            p,
          ),
        );
      else if (A.kind === 'drop')
        c.spread(A, 2, 30, 60, (p) => c.put(buildIceShard(8, 3, 6), p, { sink: 1 }));
      else
        c.spread(A, 4, 6, 40, (p) => {
          const g = buildIceShard(c.R(2, 4), c.R(4, 9), c.R(2, 4));
          g.rotation.z = c.R(-0.3, 0.3);
          c.put(g, p, { sink: 1, face: false });
        });
    },
    all(c) {
      c.ring(4, 60, 160, (p) => c.put(buildPylon(c.R(18, 26)), p));
    },
  },
  industrial: {
    per(c, A) {
      if (A.kind === 'wall') {
        const cm = [mat(0xe0a020), mat(0x2b4fb0), mat(0x8a3a2a), mat(0x6b7d6a)];
        const fm = mat(0x3a3f45);
        c.line(A, c.R(4, 7), 7.6, 0.3, (p) => {
          const g = new THREE.Group();
          const lv = 1 + Math.floor(c.r() * 3);
          for (let k = 0; k < lv; k++) {
            const ct = buildContainer(7.4, 2.7, 2.9, false, c.pick(cm), fm);
            ct.position.y = k * 2.75;
            g.add(ct);
          }
          c.put(g, p, { along: true });
        });
        c.spread(A, 2, 16, 40, (p) => c.put(gantryCrane(c.R(16, 22), c.R(20, 28)), p, { along: true }));
      } else if (A.kind === 'hills') c.spread(A, 3, 8, 30, (p) => c.put(buildScrap(6, 3, 5, 0x5a5048), p));
      else
        c.spread(A, 3, 14, 70, (p) =>
          c.put(
            c.pick([
              () => warehouse(c.r, c.R(26, 40), c.R(10, 15), c.R(18, 26)),
              () => buildStorageTank(c.R(5, 8), c.R(10, 16), 0xa8adb2),
              () => buildFloodlight(c.R(14, 20), 0x6a7078),
            ])(),
            p,
          ),
        );
    },
    all(c) {
      c.ring(10, 70, 160, (p) => c.put(warehouse(c.r, c.R(40, 60), c.R(14, 22), c.R(26, 36)), p));
    },
  },
  grid: {
    per(c, A) {
      if (A.kind === 'holo')
        c.line(A, 3, 13, 0.35, (p) => c.put(holoPanel(12, c.R(10, 18)), p, { along: true }));
      else {
        const bm = mat(0xc8ccd4, { roughness: 0.6 });
        c.spread(A, 4, 20, 140, (p) => {
          const h = c.R(8, 30);
          c.put(buildGridPillar(c.R(5, 12), h, c.R(5, 12), bm).mesh, p);
        });
      }
    },
  },
  desert: {
    per(c, A) {
      if (A.kind === 'terrace')
        c.spread(A, 2, 30, 60, (p) =>
          c.put(c.pick([() => buildDerrick(c.R(14, 20), 0x7c8790), () => buildOreHopper(0xb8452a)])(), p),
        );
      else if (A.kind === 'open')
        c.spread(A, 3, 15, 70, (p) =>
          c.put(
            c.pick([
              () => buildMiningRig(0xb8a040),
              () => buildStorageTank(c.R(4, 6), c.R(8, 12), 0x8c8f86),
              () => buildRockSpire(c.R(3, 6), c.R(10, 22), 0x5a4636),
            ])(),
            p,
          ),
        );
      else c.line(A, 1, 30, 0.4, (p) => c.put(buildFloodlight(12, 0x7c8790), p));
    },
  },
  wasteland: {
    per(c, A) {
      if (A.kind === 'mesa')
        c.spread(A, 3, 18, 90, (p) =>
          c.put(buildSandstone(c.R(9, 16), c.R(16, 34), 0x4e3e33), p, { sink: 1 }),
        );
      else if (A.kind === 'ridge')
        c.spread(A, 3, 10, 40, (p) =>
          c.put(buildRockSpire(c.R(3, 6), c.R(12, 24), 0x4e3e33), p, { sink: 1 }),
        );
      else if (A.kind === 'open') {
        c.spread(A, 2, 14, 60, (p) =>
          c.put(c.pick([() => buildDerrick(c.R(16, 22), 0x6f7a80), () => buildWreckHull(0x6f6a62)])(), p, {
            sink: 1.5,
          }),
        );
        c.line(A, c.R(14, 30), 9, 0.15, (p) => c.put(buildPipeSegment(0x8a6a50), p, { along: true }));
      }
    },
  },
  dunes: {
    per(c, A) {
      if (A.kind === 'open')
        c.spread(A, 3, 12, 80, (p) =>
          c.put(
            c.pick([
              () => buildWreckArch(0x8c8f86),
              () => buildSandstone(c.R(4, 9), c.R(6, 14), 0x7a5a3c),
              () => buildWreckHull(0x8c8f86),
            ])(),
            p,
            { sink: 2.5 },
          ),
        );
      else
        c.line(A, c.R(4, 12), 14, 0.45, (p) =>
          c.put(buildSandFence(12, 0x8e7656), p, { along: true, sink: 0.6 }),
        );
    },
  },
  flooded: {
    per(c, A) {
      const n = A.kind === 'open' ? 6 : 2;
      c.spread(A, n, 6, 100, (p) => {
        const g = buildRuinTower(c.R(12, 18), c.R(18, 48), c.R(12, 18), c.r() < 0.6, Math.floor(c.r() * 1e6));
        if (A.kind === 'water') g.rotation.z = c.R(-0.12, 0.12);
        c.put(g, p, { sink: A.kind === 'water' ? 6 : 1 });
      });
      if (A.kind === 'open') c.spread(A, 2, 4, 20, (p) => c.put(buildSunkBus(0x8a6a40), p, { sink: 1 }));
    },
  },
  dam: {
    per(c, A) {
      if (A.kind === 'open' || A.kind === 'hills')
        c.spread(A, 1, 14, 40, (p) => c.put(buildControlHouse(0x8a8c86), p));
    },
    all(c) {
      // 高壓電塔沿一條線往遠方走
      const th = c.R(0, Math.PI * 2);
      for (let d = 16; d < 220; d += 42) c.put(buildPylon(c.R(22, 28)), c.at(th + c.R(-0.04, 0.04), d));
    },
  },
  spaceport: {
    per(c, A) {
      if (A.kind === 'wall') {
        c.line(A, c.R(3, 5), 8.6, 0.25, (p) => c.put(buildBlastWall(), p, { along: true }));
        c.spread(A, 2, 10, 30, (p) => c.put(buildAntennaMast(c.R(12, 20)), p));
      } else if (A.kind === 'open')
        c.spread(A, 2, 20, 80, (p) =>
          c.put(
            c.pick([
              () => buildHangar(0x8a9096),
              () => buildFuelSphere(c.R(5, 8)),
              () => buildControlTower(),
            ])(),
            p,
          ),
        );
    },
    all(c) {
      const A = c.openArc();
      if (A) c.put(buildLaunchTower(), c.at(A.c, c.R(90, 140)));
    },
  },
  grid086: {
    per(c, A) {
      if (A.kind === 'wall')
        c.line(A, c.R(6, 12), 26, 0.3, (p) =>
          c.put(bulkhead(c.r, c.R(18, 26), c.R(28, 60)), p, { along: true }),
        );
      else if (A.kind === 'open')
        c.spread(A, 4, 10, 60, (p) =>
          c.put(
            c.pick([
              () => buildChimney(c.R(2, 3.5), c.R(20, 34)),
              () => buildPipeStack(c.R(8, 14)),
              () => buildShack(0x6a6058),
            ])(),
            p,
          ),
        );
      else
        c.spread(A, 3, 30, 140, (p) => {
          const h = c.R(70, 120);
          const g = box(c.R(8, 16), h, c.R(8, 16), mat(0x3c3834, { roughness: 0.95 }), 0, 0, 0);
          g.position.y = -h / 2 + c.R(-10, 25);
          const gg = new THREE.Group();
          gg.add(g);
          c.put(gg, p, { y: 0 });
        });
    },
  },
  institute: {
    per(c, A) {
      if (A.kind === 'open')
        c.spread(A, 3, 10, 60, (p) => {
          if (c.r() < 0.5) c.put(buildLab(c.R(14, 22), c.R(10, 18), c.R(12, 18), Math.floor(c.r() * 1e6)), p);
          else c.put(buildCavePillar(c.R(4, 7), Math.max(10, 38 - p.y)), p, { sink: 0.5 });
        });
      else c.spread(A, 3, 4, 30, (p) => c.put(buildCoralCrystal(c.R(1.5, 3)), p, { sink: 0.3 }));
    },
  },
  xylem: {
    all(c) {
      // 遠方的人工島與高樓
      c.ring(9, 40, 200, (p) => {
        const g = new THREE.Group();
        const wd = c.R(30, 50),
          dp = c.R(30, 50);
        g.add(island(wd, dp, 0x8a9298));
        for (let k = 0; k < 3; k++) {
          const t = buildGlassTower(c.R(10, 14), c.R(20, 60), c.R(10, 14), Math.floor(c.r() * 1e6));
          t.position.set(c.R(-wd / 3, wd / 3), 0, c.R(-dp / 3, dp / 3));
          g.add(t);
        }
        if (c.r() < 0.5) {
          const aa = buildAATurret();
          aa.position.set(wd / 2 - 3, 0, 0);
          g.add(aa);
        }
        c.put(g, p, { y: 0.5 });
      });
    },
  },
  orbit: {
    all(c) {
      // 漂浮的太陽能板、散熱片與對接艙；幾座遠方的平台
      c.ring(14, 30, 220, (p) => {
        const g = c.pick([
          () => buildSolarArray(),
          () => buildRadiator(c.R(6, 10)),
          () => buildDockModule(0xb8bcc0),
        ])();
        g.scale.setScalar(c.R(2, 4));
        g.rotation.set(c.R(-0.5, 0.5), c.R(0, 6.3), c.R(-0.5, 0.5));
        c.put(g, p, { y: c.R(-12, 26), face: false });
      });
      c.ring(4, 60, 200, (p) => {
        const g = new THREE.Group();
        g.add(island(c.R(24, 36), c.R(24, 36), 0xc8ccd0));
        g.add(buildCommMast(c.R(14, 22)));
        c.put(g, p, { y: 0.5 });
      });
    },
  },
};

// 遠景地形與剪影物件（World 建好地形與物件後呼叫）
export function buildBackdrop(w) {
  const E = w.edges;
  if (!E) return;
  const out = [];
  if (!E.none) out.push(buildFarTerrain(w));
  const r = makeRng(w.seed * 83 + 17);
  const c = {
    r,
    R: (a, b) => a + (b - a) * r(),
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    // 方環上的位置：角度 th、離邊界起點 d（m）
    at(th, d) {
      const cs = Math.cos(th),
        sn = Math.sin(th);
      const k = (E.e0 + d) / Math.max(Math.abs(cs), Math.abs(sn));
      const x = cs * k,
        z = sn * k;
      return { x, z, y: w.farHeight(x, z), th };
    },
    // along：長邊沿著邊界；face：正面朝場地中心；sink：往下埋；y：指定高度
    put(obj, p, o = {}) {
      obj.position.set(p.x, o.y !== undefined ? o.y : p.y - (o.sink || 0), p.z);
      if (o.along) obj.rotation.y = Math.abs(p.x) > Math.abs(p.z) ? Math.PI / 2 : 0;
      else if (o.face !== false) obj.rotation.y = Math.atan2(-p.x, -p.z) + c.R(-0.4, 0.4);
      obj.traverse((m) => {
        m.castShadow = false;
        m.receiveShadow = false;
      });
      out.push(obj);
    },
    // 這段裡隨機散布 n 個（離起點 d0～d1）
    spread(A, n, d0, d1, fn) {
      const k = Math.max(1, Math.round((n * A.hw) / 0.5));
      for (let i = 0; i < k; i++) fn(c.at(A.c + (r() * 2 - 1) * A.hw * 0.85, c.R(d0, d1)));
    },
    // 沿著邊界排一列（固定離起點 d），間距 step，gap＝留空的機率
    line(A, d, step, gap, fn) {
      const k = (E.e0 + d) * 1.15;
      for (let a = A.c - A.hw + BW; a <= A.c + A.hw - BW; a += step / k) if (r() > gap) fn(c.at(a, d));
    },
    // 整圈隨機散布 n 個
    ring(n, d0, d1, fn) {
      for (let i = 0; i < n; i++) fn(c.at(r() * Math.PI * 2, c.R(d0, d1)));
    },
    openArc: () => E.arcs.find((A) => A.kind === 'open') || E.arcs[0] || null,
  };
  const PS = PROPS[w.themeKey];
  if (PS) {
    if (PS.per) for (const A of E.arcs) PS.per(c, A);
    if (PS.all) PS.all(c);
  }
  return out;
}
