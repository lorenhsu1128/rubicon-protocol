// Game：場景環境、後處理與渲染風格、主渲染
import { BlobShadows } from '../fx/batch.js';
import { RTS_LAZY, rtsMergeNow } from '../render/rts-merge.js';
import { makeStudioEnv } from '../render/environment.js';
import { fineTick } from '../render/detail.js';
import { StylePipeline, manualShadows } from '../render/style/pipeline.js';
import { installStyleShader } from '../render/style/shader.js';
import { StyleStore } from '../render/style/store.js';
import { DS } from '../core/scale.js';
import { Game } from './game.js';

installStyleShader(); // 越早越好：之後建立的標準材質都會用風格著色器

// RTS 渲染設定（setRtsRender）
const RTS_HULL_DIST = 80; // 鏡頭離注視點這麼遠（m）以上不畫描邊外殼
const RTS_SSAO = 'depth'; // SSAO：半解析度、法線從深度重建（不重畫場景）
const RTS_IK = [70, 25, 1]; // 鏡頭距離 ≤ [0] 時注視點 [1] m 內跑 IK，拉遠時 [2] m 內（單位在畫面上很小，等於不跑；0 會被當成沒設定）
const RTS_SHADOW_N = 8; // 陰影貼圖每幾格才重畫（單位不投影，只剩地形與建築）；太陽跟著鏡頭移動時立刻重畫
const RTS_LIST = [];
const _rtsRay = new THREE.Vector3();

Object.assign(Game.prototype, {
  // ---------- environment map (procedural studio: sky gradient + light panels) ----------
  setupEnvironment() {
    try {
      const cube = makeStudioEnv();
      this.scene.environment = cube;
      this.envTex = cube;
    } catch (e) {
      console.warn('env failed', e);
    }
  },
  // ---------- 後處理與渲染風格（render/style/：材質著色、描線、Bloom、SSAO、調色）----------
  setupPost() {
    this.sunOff = new THREE.Vector3(40, 80, 30); // 太陽相對鏡頭注視點的位置（渲染風格可改方位與高度）
    this.styleP = StyleStore.current();
    this.applyRes();
    manualShadows(this.renderer); // 陰影貼圖每格只畫一次：loop 開頭設 needsUpdate（SSAO 的法線不再觸發）
    this.stylePipe = new StylePipeline(this.renderer, {
      scene: this.scene,
      camera: this.camera,
      sun: this.sun,
      hemi: this.hemi,
      sunOff: this.sunOff,
      sceneExp: () => (this.world && this.world.theme && this.world.theme.linExp) || 1, // 依場景的曝光補正
      fogPush: () => this.camExtra || 0, // 鏡頭拉遠時霧往外推，機體附近保持清楚
      chromaPush: () => (this.chromaK || 0) * 0.7, // 受到重擊時的色差（game/juice.js）
      wscale: () => (this.rts ? 1 : DS), // 機甲三倍高改版（Coral 戰爭到第 11 期之前照舊）
    });
    this.stylePipe.applyStructural(this.styleP);
  },
  // 渲染解析度（效能設定，不屬於風格）：裝置像素比上限 1.75 再乘上設定值
  applyRes() {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75) * StyleStore.data.res);
  },
  // 重新讀取選用的渲染風格（任務中不換：只在標題、車庫、出擊前呼叫）
  styleRefresh() {
    this.styleP = StyleStore.current();
    this.styleStructural(this.styleP);
  },
  // 色調映射、陰影種類改變時要重新編譯材質
  styleStructural(P) {
    const pipes = [this.stylePipe, this.garagePipe, this.hubPipe].filter(Boolean);
    let ch = false;
    for (const p of pipes) ch = p.applyStructural(P) || ch;
    if (!ch) return;
    for (const s of [this.scene, this.garageScene, this.hubScene])
      if (s)
        s.traverse((o) => {
          const m = o.material;
          if (m) for (const x of Array.isArray(m) ? m : [m]) x.needsUpdate = true;
        });
  },
  postResize(w, h) {
    if (this.stylePipe) this.stylePipe.setSize(w, h);
    if (this.garagePipe) this.garagePipe.setSize(w, h);
    if (this.hubPipe) this.hubPipe.setSize(w, h);
  },
  renderMain() {
    const lab = this.lab;
    const P = lab ? lab.P : this.cine ? this.cine.P : this.styleP; // 過場動畫：風格＋過場的調色（game/cine.js）
    const t = performance.now() / 1000;
    if (this.fx) this.fx.flush(); // 粒子批次：fx.update 之後才產生的粒子也寫進去（fx/batch.js）
    if (this.rtsR) this.rtsRenderTick();
    fineTick(this.camera, this.rtsR ? 0.6 : 1); // 小細節的距離分級（render/detail.js）
    if (this.world && this.world.weather)
      this.world.weather.update(this.camera, t, this.renderer.getPixelRatio());
    if (this.post.enabled && this.post.ok) this.stylePipe.render(P, t, lab && lab.cmp ? lab.cmpArg() : null);
    else this.stylePipe.renderPlain(P, t);
  },
  // 低特效（大量單位的模式用，例如 RTS）：o＝{ ssao: 'off'｜'half'｜'full', mblur: 布林 }，null＝恢復
  setLowFx(o) {
    if (this.stylePipe) this.stylePipe.setLowFx(o);
  },
  // ---------- RTS 渲染設定（大量單位：docs/rts-design.md 8.3）----------
  // on：低特效（SSAO 'depth'、沒有動態模糊）、單位不投影（建築 e.bld 與地形照常）改畫圓形假影子、
  // 鏡頭離注視點遠時不畫描邊外殼、IK 與 AI 分批的距離改以鏡頭注視點計算（lodFrom）、AI 分批一律開啟。
  // off：全部還原。每格由 renderMain 呼叫 rtsRenderTick
  setRtsRender(on) {
    if (!!on === !!this.rtsR) return;
    this.fx.setK(on ? 1 : DS);
    if (on) {
      this.rtsR = {
        aiBatch: this.aiBatch,
        ikDist: this.lodIkDist,
        low: this.stylePipe ? this.stylePipe.low : null,
        blobs: new BlobShadows(this.scene),
        hullOff: false,
        lodDone: false,
        shN: 0,
        sunAt: new THREE.Vector3(1e9, 0, 0),
      };
      this.aiBatch = true;
      this.setLowFx({ ssao: RTS_SSAO, mblur: false });
      // 場景每格的節點矩陣：RTS 單位的骨頭群組延到算繪骨架時才算（render/rts-merge.js 的 RTS_LAZY）
      const sc = this.scene,
        umw = sc.updateMatrixWorld;
      this.rtsR.scUmw = umw;
      if (this.fx) this.fx.lateFlush = true; // 粒子批次只在算繪前寫一次（fx/effects.js）
      sc.updateMatrixWorld = function (force) {
        RTS_LAZY.on = true;
        try {
          umw.call(this, force);
        } finally {
          RTS_LAZY.on = false;
        }
      };
      this.lodFrom = new THREE.Vector3();
      this.rtsRenderTick();
      return;
    }
    const R = this.rtsR;
    this.rtsR = null;
    this.aiBatch = R.aiBatch;
    this.lodIkDist = R.ikDist;
    if (R.scUmw) this.scene.updateMatrixWorld = R.scUmw;
    if (this.fx) this.fx.lateFlush = false;
    if (this.stylePipe) {
      this.stylePipe.setLowFx(R.low);
      this.stylePipe.hullOff = false;
    }
    R.blobs.dispose();
    this.lodFrom = null;
    // 陰影交回 lodTick（距離分級關掉時一律投影）
    for (const e of this.rtsUnits(RTS_LIST)) if (e.shLodOff) e.setShadowLod(true);
    RTS_LIST.length = 0;
  },
  // 場上的單位（不含建築、看不到的）；敵人、友軍、玩家（RTS 的單位也在這些清單裡）
  rtsUnits(out) {
    out.length = 0;
    const add = (L) => {
      if (L)
        for (const e of L)
          if (e && !e.dead && e.mesh && !e.bld && e._rtsMark !== out) ((e._rtsMark = out), out.push(e));
    };
    add(this.enemies);
    add(this.allies);
    add(this.players && this.players.length ? this.players : this.player ? [this.player] : null);
    for (const e of out) e._rtsMark = null;
    return out;
  },
  rtsRenderTick() {
    const R = this.rtsR,
      cam = this.camera,
      w = this.world;
    // 鏡頭注視點：RTS 鏡頭的焦點，沒有時取視線與地面（上一個注視點的高度）的交點
    const F = this.lodFrom;
    const C = this.rts && this.rts.cam;
    if (C && C.gy !== null && C.gy !== undefined) F.set(C.x, C.gy, C.z);
    else {
      cam.getWorldDirection(_rtsRay);
      const y0 = w ? w.terrainHeight(F.x, F.z) : 0;
      const k = _rtsRay.y < -0.05 ? (y0 - cam.position.y) / _rtsRay.y : 60;
      F.copy(cam.position).addScaledVector(_rtsRay, Math.min(k, 400));
    }
    // 拉遠時不畫描邊外殼（有遲滯）
    const d = cam.position.distanceTo(F);
    R.hullOff = d > (R.hullOff ? RTS_HULL_DIST * 0.92 : RTS_HULL_DIST);
    if (this.stylePipe) this.stylePipe.hullOff = R.hullOff;
    this.lodIkDist = d <= RTS_IK[0] ? RTS_IK[1] : RTS_IK[2];
    // 陰影貼圖：投影的只剩地形、建築（和少數碎片），太陽（跟著鏡頭）沒動時每 RTS_SHADOW_N 格才重畫
    const sm = this.renderer.shadowMap;
    if (sm.needsUpdate && this.sun) {
      const moved = R.sunAt.distanceToSquared(this.sun.position) > 0.25;
      // 英雄投影（真正的陰影）：畫面上的英雄移動了就每 2 格重畫
      if (moved || ++R.shN >= RTS_SHADOW_N || (R.shN >= 2 && this.rtsHeroShadowMoved())) {
        R.shN = 0;
        R.sunAt.copy(this.sun.position);
      } else sm.needsUpdate = false;
    }
    // RTS 的主迴圈沒有呼叫 lodTick 時在這裡補（IK 的距離分級）
    if (!R.lodDone && this.state !== 'title') this.lodTick();
    R.lodDone = false;
    // 單位不投影，腳下畫圓形假影子
    const list = this.rtsUnits(RTS_LIST);
    // 單位與建築的網格合併（render/rts-merge.js：建立時記下、第一次算繪前才合併，生產時加上去的零件一起併）
    for (const e of list) if (e.model && e.model.rtsPending) this.rtsMergeEnt(e);
    if (this.rts && this.rts.units)
      for (const e of this.rts.units) if (e && !e.dead && e.model && e.model.rtsPending) this.rtsMergeEnt(e);
    let j = 0;
    for (const e of list) {
      // 英雄（e.hero）照 lodTick 的距離規則投影真正的陰影，不畫假影子
      if (e.hero) continue;
      if (!e.decoy) e.setShadowLod(false);
      if (e.mesh.visible && !e.fogHid) list[j++] = e; // 戰爭迷霧裡看不到的（rts-fog.js 的 fogHid）不畫
    }
    list.length = j;
    R.blobs.update(list, (e) =>
      e.grounded || !w ? e.pos.y : Math.min(e.pos.y, w.groundAt(e.pos.x, e.pos.z, e.pos.y + 0.5)),
    );
    list.length = 0;
  },
  // 有投影的英雄（畫面內、迷霧外）從上次重畫陰影貼圖之後移動了 0.15 m 以上：記下位置、回傳 true
  rtsHeroShadowMoved() {
    const R = this.rts;
    if (!R || !R.teams) return false;
    let moved = false;
    for (const T of R.teams) {
      if (!T || !T.heroes) continue;
      for (const h of T.heroes) {
        const e = h && h.ent;
        if (!e || e.dead || !e.mesh || e.fogHid || e.shLodOff || e.lodVis === false) continue;
        const p = e._shAt || (e._shAt = new THREE.Vector3(1e9, 0, 0));
        if (p.distanceToSquared(e.pos) > 0.0225) {
          p.copy(e.pos);
          moved = true;
        }
      }
    }
    return moved;
  },
  // 合併一台：陰影的距離分級關著時先開回來（原本的網格恢復投影），合併後再關（合併出來的網格沿用設定、包住 unmerge／remerge）
  rtsMergeEnt(e) {
    const off = e.shLodOff && e.shRoot === e.mesh;
    if (off) e.setShadowLod(true);
    rtsMergeNow(e.model, e.sx ? { sx: e.sx } : null);
    if (off) e.setShadowLod(false);
  },
  setPost(on) {
    this.post.enabled = on;
    try {
      localStorage.setItem('rubicon_post', on ? '1' : '0');
    } catch (e) {}
  },
  wrapFx() {
    const g0 = this;
    this.fx.onMeleeStop = (p, s, r) => g0.meleeStopNear(p, s, r); // 客機的近戰頓格（juice.js）
    const origEmp = this.fx.empBeam;
    this.fx.empBeam = function (w, a, b, color) {
      if (g0.net && g0.net.role === 'host') {
        w._ebT = (w._ebT || 0) + (g0.lastDt || 0.016);
        if (w._ebT >= 0.05) {
          w._ebT = 0;
          g0.netEv({
            t: 'ebeam',
            o: w.slot,
            e: w.ownerId,
            a: [+a.x.toFixed(1), +a.y.toFixed(1), +a.z.toFixed(1)],
            b: [+b.x.toFixed(1), +b.y.toFixed(1), +b.z.toFixed(1)],
            c: color,
          });
        }
      }
      return origEmp.call(this, w, a, b, color);
    };
    const names = [
      'explosion',
      'spark',
      'muzzle',
      'beam',
      'chevrons',
      'dust',
      'slash',
      'meleeHit',
      'ring',
      'shockwave',
      'flash',
      'streaks',
      'warnLine',
      'warnRect',
      'pulseShell',
      'firePool',
      'flameCone',
      'pillarStrike',
    ];
    const fx = this.fx;
    const g = this;
    for (const n of names) {
      const orig = fx[n];
      fx[n] = function (...args) {
        if (g.net && g.net.role === 'host' && !fx._nested) {
          fx._nested = true;
          try {
            g.netEv({
              t: 'fx',
              n,
              a: args.map((v) =>
                v && v.isVector3
                  ? [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)]
                  : v instanceof Set
                    ? null
                    : v,
              ),
            });
            const r = orig.apply(fx, args);
            return r;
          } finally {
            fx._nested = false;
          }
        }
        return orig.apply(fx, args);
      };
    }
  },
});
