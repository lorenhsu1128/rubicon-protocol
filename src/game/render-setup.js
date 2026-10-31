// Game：場景環境、後處理與渲染風格、主渲染
import { makeStudioEnv } from '../render/environment.js';
import { fineTick } from '../render/detail.js';
import { StylePipeline, manualShadows } from '../render/style/pipeline.js';
import { installStyleShader } from '../render/style/shader.js';
import { StyleStore } from '../render/style/store.js';
import { DS } from '../core/scale.js';
import { Game } from './game.js';

installStyleShader(); // 越早越好：之後建立的標準材質都會用風格著色器

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
      wscale: () => DS, // 機甲三倍高改版
      sceneTweak: (s) => this.water && this.water.fogTweak(s), // 水面下的霧（fx/water/index.js）
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
    if (this.bfVis) this.bfVis(this.lastDt || 0.016); // Boss 改版的場地效果（boss-field.js）
    fineTick(this.camera, 1); // 小細節的距離分級（render/detail.js）
    if (this.world && this.world.weather)
      this.world.weather.update(this.camera, t, this.renderer.getPixelRatio());
    this.fxAmbientTick(); // 地圖的持續特效（game/fx-ambient.js）
    this.waterTick(); // 水面與雲海（game/water.js）：模擬、焦散、平面反射
    if (this.post.enabled && this.post.ok) this.stylePipe.render(P, t, lab && lab.cmp ? lab.cmpArg() : null);
    else this.stylePipe.renderPlain(P, t);
    this.waterAfter();
  },
  // 低特效（大量單位的場面用）：o＝{ ssao: 'off'｜'half'｜'full', mblur: 布林 }，null＝恢復
  setLowFx(o) {
    if (this.stylePipe) this.stylePipe.setLowFx(o);
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
      'gather',
      'arc',
      'star',
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
