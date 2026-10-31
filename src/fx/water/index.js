// ============================================================
//  水面系統（docs/water-design.md）：參考 jeantimex/threejs-water（MIT）改寫成遊戲用的版本。
//  World.addWater 建的水面網格（fx/water/surface.js）＋這裡的模擬（sim.js）、焦散（caustics.js）、反射（reflect.js）。
//  品質（設定「水面品質」ctrl.water）：
//    low  沒有模擬與焦散；反射只有天空、霧與太陽
//    mid  模擬 256 格、焦散、螢幕空間反射（上一格的畫面與深度，StylePipeline 的 keepPrev）
//    high 模擬 512 格、焦散、平面反射（半解析度再畫一次場景）
//  模擬的範圍是跟著鏡頭的方形視窗（WIN 公尺 × 尺度）。只有外觀：判定（waterDepth、水流）不變，
//  推水的來源（機體、子彈、爆炸、雨、下洗氣流、水流）各端自己依自己的狀態算，不轉送。
// ============================================================
import { DROPS, SPHERES, WaterSim, simFormat } from './sim.js';
import { Caustics, causTex, refractK } from './caustics.js';
import { PlanarRefl } from './reflect.js';
import { rebakeWater } from './surface.js';
import { SU } from '../../render/style/shader.js';

const Q = {
  low: null,
  mid: { res: 256, caus: 256, grid: 200, refl: 1 },
  high: { res: 512, caus: 512, grid: 320, refl: 2 },
};
const WIN = 100; // 模擬視窗的邊長（× 尺度）
const STEP = 1 / 60;
const SPEED = 4.5; // 波速（m/s × 尺度）
const DAMP = 0.45; // 速度每秒剩下的比例
const SK = 0.1; // 球體推水的強度（每步沉在水裡的長度差 × SK）

const _v = new THREE.Vector3(),
  _c = new THREE.Color();

export class WaterFx {
  constructor(R, scale = 1) {
    this.R = R;
    this.k = scale;
    this.q = 'mid';
    this.fmt = simFormat(R);
    this.sim = null;
    this.caus = null;
    this.refl = null;
    this.g = null; // 目前的水面群組（World.waterMesh）
    this.world = null;
    this.drops = [];
    this.sph = new Map(); // key → { a: 上一次推過水的 [x,y,z,r], b: 這一格的, seen }
    this.acc = 0;
    this.win = new THREE.Vector4(0, 0, WIN * scale, 0);
    this.cx = null;
    this.cz = null;
    this.time = 0;
    this.r0k = new THREE.Vector2();
    this.under = false;
  }
  // 目前實際的品質（裝置不支援浮點貼圖時降成 low）
  get quality() {
    return Q[this.q] && this.fmt ? this.q : 'low';
  }
  get simOn() {
    return !!(this.sim && this.g);
  }
  setQuality(q) {
    if (q === this.q) return;
    this.q = q;
    this.rebuild();
  }
  rebuild() {
    for (const x of [this.sim, this.caus, this.refl]) if (x) x.dispose();
    this.sim = this.caus = this.refl = null;
    this.cx = this.cz = null;
    this.sph.clear();
    this.drops.length = 0;
    const C = Q[this.quality];
    const d = this.g && this.g.userData.water;
    if (!C || !d) return;
    this.sim = new WaterSim(this.R, C.res, this.fmt);
    this.sim.setTerrain(d.ter);
    this.caus = new Caustics(this.R, C.caus, C.grid);
    if (C.refl === 2) this.refl = new PlanarRefl();
  }
  // 換地圖：world.waterMesh（沒有水面時 null）
  attach(world) {
    this.world = world;
    const g = world && world.waterMesh && world.waterMesh.userData.water ? world.waterMesh : null;
    if (g === this.g) return;
    this.g = g;
    if (g && g.userData.water.ter.flat) rebakeWater(g, world);
    this.rebuild();
  }
  // 地形改了（關卡編輯器）
  terrainChanged() {
    if (!this.g || !this.world) return;
    rebakeWater(this.g, this.world);
    if (this.sim) this.sim.setTerrain(this.g.userData.water.ter);
  }
  get level() {
    return this.g ? this.g.position.y : -1e9;
  }
  // 在模擬視窗裡（含邊界）
  inWin(x, z, m = 0) {
    const h = this.win.z / 2 + m;
    return this.simOn && Math.abs(x - this.win.x) < h && Math.abs(z - this.win.y) < h;
  }
  // 水滴：(x, z) 半徑 r（公尺）、高度 s（負＝往下壓，公尺）
  drop(x, z, r, s) {
    if (!this.inWin(x, z, r) || this.drops.length > 96) return;
    this.drops.push([x, z, r, s]);
  }
  // 球體：每格對同一個 key 呼叫（機體的腳、身體）；離開水面附近的不必呼叫
  sphere(key, x, y, z, r) {
    if (!this.inWin(x, z, r)) return;
    let s = this.sph.get(key);
    if (!s) this.sph.set(key, (s = { a: [x, y, z, r], b: [x, y, z, r], seen: true }));
    s.seen = true;
    // 很小的移動（待機的晃動、IK 的微調）不推水：離上次推過的位置 0.12 m × 尺度以上才算
    const m = 0.12 * this.k;
    if ((x - s.a[0]) ** 2 + (y - s.a[1]) ** 2 + (z - s.a[2]) ** 2 < m * m) {
      s.b[0] = s.a[0];
      s.b[1] = s.a[1];
      s.b[2] = s.a[2];
      return;
    }
    s.b[0] = x;
    s.b[1] = y;
    s.b[2] = z;
    s.b[3] = r;
  }
  // 爆炸：靠近水面的才推水（r：爆炸的半徑，公尺）
  blast(p, r) {
    if (!this.simOn) return;
    const L = this.level;
    const dy = Math.abs(p.y - L);
    if (dy > r * 1.5 || !this.wet(p.x, p.z)) return;
    const k = 1 - dy / (r * 1.5);
    this.drop(p.x, p.z, r * 0.9, -Math.min(2.5 * this.k, r * 0.35) * k);
  }
  // (x, z) 有水（水位高於地形）
  wet(x, z) {
    const w = this.world;
    return !!(w && w.theme.water && w.waterDepth(x, z) > 0.15 * this.k);
  }
  // 線段 a → b 穿過水面：回傳穿過的點（不然 null）
  cross(a, b) {
    if (!this.g) return null;
    const L = this.level;
    if (!(a.y > L && b.y <= L)) return null;
    const t = (a.y - L) / (a.y - b.y);
    _v.lerpVectors(a, b, t);
    return this.wet(_v.x, _v.z) ? _v : null;
  }
  // 每格（算繪前）：env＝{ cam, focus（視窗中心的目標點）, sun（DirectionalLight）, hemi, scene, toon, pipe }
  update(dt, env) {
    const g = this.g;
    if (!g) return;
    const d = g.userData.water,
      U = d.U,
      k = this.k;
    if (this.world && this.world.waterDirty) {
      this.world.waterDirty = false;
      this.terrainChanged();
    }
    const L = g.position.y;
    this.time += dt;
    U.uLevel.value = L;
    U.uTime.value = this.time % 1000;
    // 光線與天空
    const sun = env.sun;
    if (sun) {
      U.uSun.value.subVectors(sun.position, sun.target.position).normalize();
      U.uSunC.value.copy(sun.color).multiplyScalar(sun.intensity);
    }
    if (env.hemi) U.uAmb.value.copy(env.hemi.color).multiplyScalar(env.hemi.intensity * 0.55);
    const s = env.scene;
    if (s && s.fog) U.uSkyLo.value.copy(s.fog.color);
    if (s && s.background && s.background.isColor) U.uSkyHi.value.copy(s.background);
    else U.uSkyHi.value.copy(U.uSkyLo.value);
    U.uToon.value.set(env.toon ? 1 : 0, 3, 0, 0);
    // 鏡頭在水面下（第一人稱沉到水裡）
    const cp = env.cam.position;
    this.under = cp.y < L + 0.2 * k && this.wet(cp.x, cp.z);
    // ---- 模擬 ----
    const sim = this.sim;
    d.near.visible = !!sim;
    U.win.value.set(this.win.x, this.win.y, sim ? this.win.z : 0, sim ? 1 : 0);
    U.uRefl.value = 0;
    if (!sim) {
      this.styleUniforms(env, 0);
      return;
    }
    const cell = this.win.z / sim.res;
    // 視窗跟著目標點（對齊格子）
    const f = env.focus || cp;
    const nx = Math.round(f.x / cell) * cell,
      nz = Math.round(f.z / cell) * cell;
    let sx = 0,
      sz = 0;
    if (this.cx === null) sim.reset();
    else {
      sx = Math.round((nx - this.cx) / cell);
      sz = Math.round((nz - this.cz) / cell);
      if (Math.abs(sx) >= sim.res || Math.abs(sz) >= sim.res) {
        sim.reset();
        sx = sz = 0;
      }
    }
    this.cx = nx;
    this.cz = nz;
    this.win.set(nx, nz, WIN * k, L);
    sim.win.copy(this.win);
    U.win.value.set(nx, nz, this.win.z, 1);
    // 步數（固定步長，跟著特效時鐘：暫停時不動）
    this.acc = Math.min(this.acc + dt, STEP * 4);
    const steps = Math.floor(this.acc / STEP);
    this.acc -= steps * STEP;
    if (steps > 0) {
      // 擾動：水滴＋球體（上一次推過的位置 → 這一格的位置）
      const sph = [];
      for (const [key, o] of this.sph) {
        if (!o.seen) {
          this.sph.delete(key);
          continue;
        }
        o.seen = false;
        if (o.a[0] !== o.b[0] || o.a[1] !== o.b[1] || o.a[2] !== o.b[2]) sph.push([o.a.slice(), o.b.slice()]);
        o.a[0] = o.b[0];
        o.a[1] = o.b[1];
        o.a[2] = o.b[2];
        o.a[3] = o.b[3];
      }
      // 第一步帶視窗的移動
      const c2 = (SPEED * k * STEP) / cell;
      const k2 = Math.min(0.45, c2 * c2);
      const damp = Math.pow(DAMP, STEP);
      for (let i = 0; i < steps; i++) {
        sim.step(k2, damp, i ? 0 : sx, i ? 0 : sz);
        if (!i) {
          const np = Math.max(Math.ceil(this.drops.length / DROPS), Math.ceil(sph.length / SPHERES));
          for (let j = 0; j < np; j++)
            sim.disturb(
              this.drops.slice(j * DROPS, (j + 1) * DROPS),
              sph.slice(j * SPHERES, (j + 1) * SPHERES),
              SK,
            );
          this.drops.length = 0;
        }
      }
      sim.normals();
    }
    U.tSim.value = sim.tex;
    // 焦散
    if (this.caus) {
      this.caus.render(sim.tex, this.win, U.uSun.value, L, d.ter, U);
      refractK(U.uSun.value, this.r0k);
    }
    // 反射
    const C = Q[this.quality];
    const P = env.pipe;
    if (C.refl === 1 && P && P.prev) {
      P.keepPrev = true;
      U.uRefl.value = 1;
      U.tPrevC.value = P.prev.color;
      U.tPrevD.value = P.prev.depth;
      U.uPrevVP.value.copy(P.prevVP);
      U.uCamNF.value.set(env.cam.near, env.cam.far);
    } else if (P) P.keepPrev = C.refl === 1;
    this.styleUniforms(env, this.caus ? 1 : 0);
  }
  // 平面反射（品質 high）：在場景算繪之前
  preRender(scene, cam) {
    const d = this.g && this.g.userData.water;
    if (!this.refl || !d || !d.far.visible) return;
    const ok = this.refl.render(this.R, scene, cam, this.level, [this.g]);
    d.U.uRefl.value = ok ? 2 : 0;
    d.U.tRefl.value = this.refl.tex;
    d.U.uRM.value.copy(this.refl.M);
  }
  // 地形與物件的著色器（render/style/shader.js）：水位、濕的岸邊、焦散
  styleUniforms(env, caus) {
    const k = this.k;
    SU.stWa.value.set(this.level, caus ? 1 : 0, 1.2 * k, 1);
    SU.stWb.value.set(this.win.x, this.win.y, this.win.z, caus ? 1.6 : 0);
    SU.stWc.value.set(this.r0k.x, this.r0k.y, 0, 0);
    if (caus && this.caus) SU.stCau.value = this.caus.tex;
    if (caus) SU.stCauT.value = causTex();
    // 細的花紋：一張 12 m × 尺度；色階風格時花紋硬一點（著色器裡依 stA.x）
    SU.stWd.value.set(this.time % 1000, 1 / (12 * k), caus ? 0.55 : 0, 0);
  }
  // 水下的霧（StylePipeline 的 sceneTweak）
  fogTweak(s) {
    if (!this.under || !s.fog || !this.g) return;
    const U = this.g.userData.water.U;
    _c.copy(U.uDeep.value).multiplyScalar(0.6).add(U.uAmb.value.clone().multiplyScalar(0.25));
    s.fog.color.copy(_c);
    s.fog.near = 0;
    s.fog.far = Math.max(8, 40 / Math.max(0.2, U.uAbs.value)) * this.k * 0.4;
    if (s.background && s.background.isColor) s.background.copy(_c);
  }
  // 沒有水面時：清掉著色器的水面設定
  off() {
    SU.stWa.value.set(-1e9, 0, 0, 0);
    this.under = false;
  }
  dispose() {
    this.g = null;
    this.rebuild();
  }
}
