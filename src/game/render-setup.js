// Game：場景環境、後處理（Bloom／SSAO）與主渲染
import { makeStudioEnv } from '../render/environment.js';
import { Game } from './game.js';

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
  // ---------- post-processing: bloom + SSAO ----------
  setupPost() {
    if (!this.post.ok) return;
    const w = innerWidth,
      h = innerHeight;
    const mk = (scene, cam, ssao) => {
      const c = new THREE.EffectComposer(this.renderer);
      c.addPass(new THREE.RenderPass(scene, cam));
      let s = null;
      if (ssao) {
        s = new THREE.SSAOPass(scene, cam, w, h);
        s.kernelRadius = 1.6;
        s.minDistance = 0.0004;
        s.maxDistance = 0.012;
        s.output = THREE.SSAOPass.OUTPUT.Default;
        c.addPass(s);
      }
      const b = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0.45, 0.4, 0.9);
      c.addPass(b);
      c.addPass(new THREE.ShaderPass(THREE.GammaCorrectionShader));
      return { c, s, b };
    };
    this.postMain = mk(this.scene, this.camera, true);
  },
  postResize(w, h) {
    if (!this.postMain) return;
    this.postMain.c.setSize(w, h);
    if (this.postMain.s) this.postMain.s.setSize(w, h);
    this.postMain.b.setSize(w, h);
    if (this.postGarage) {
      this.postGarage.c.setSize(w, h);
      this.postGarage.b.setSize(w, h);
    }
  },
  renderMain() {
    if (this.post.enabled && this.postMain) {
      this.postMain.c.render();
    } else this.renderer.render(this.scene, this.camera);
  },
  setPost(on) {
    this.post.enabled = on;
    try {
      localStorage.setItem('rubicon_post', on ? '1' : '0');
    } catch (e) {}
  },
  wrapFx() {
    const g0 = this;
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
