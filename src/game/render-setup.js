// Game：場景環境、後處理（Bloom／SSAO）與主渲染
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ---------- environment map (procedural studio: sky gradient + light panels) ----------
  setupEnvironment() {
    try {
      // procedural studio cubemap: gradient sky, dark floor, bright light panels for metal speculars
      const S = 128;
      const faces = []; // order: +x,-x,+y,-y,+z,-z
      const dirs = [
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ];
      for (let f = 0; f < 6; f++) {
        const c = document.createElement('canvas');
        c.width = c.height = S;
        const x = c.getContext('2d');
        const img = x.createImageData(S, S);
        const d = img.data;
        for (let j = 0; j < S; j++)
          for (let i = 0; i < S; i++) {
            const u = ((i + 0.5) / S) * 2 - 1,
              v = ((j + 0.5) / S) * 2 - 1;
            let dir;
            switch (f) {
              case 0:
                dir = [1, -v, -u];
                break;
              case 1:
                dir = [-1, -v, u];
                break;
              case 2:
                dir = [u, 1, v];
                break;
              case 3:
                dir = [u, -1, -v];
                break;
              case 4:
                dir = [u, -v, 1];
                break;
              default:
                dir = [-u, -v, -1];
            }
            const L = Math.hypot(...dir);
            const nx = dir[0] / L,
              ny = dir[1] / L,
              nz = dir[2] / L;
            let r, g, b;
            if (ny > 0) {
              const t = Math.min(1, ny * 1.4);
              r = 0.55 + 0.25 * t;
              g = 0.6 + 0.28 * t;
              b = 0.68 + 0.32 * t;
            } else {
              const t = Math.min(1, -ny * 3);
              r = 0.5 - 0.24 * t;
              g = 0.52 - 0.26 * t;
              b = 0.55 - 0.3 * t;
            }
            // light panels
            const panel = (px, py, pz, size, ir, ig, ib) => {
              const dot = nx * px + ny * py + nz * pz;
              if (dot > size) {
                const k = (dot - size) / (1 - size);
                r += ir * k;
                g += ig * k;
                b += ib * k;
              }
            };
            panel(-0.55, 0.7, 0.45, 0.93, 1.6, 1.5, 1.3);
            panel(0.7, 0.5, -0.5, 0.95, 0.9, 1.0, 1.3);
            panel(0.0, -0.25, 0.97, 0.985, 0.6, 0.55, 0.45);
            const k = (j * S + i) * 4;
            d[k] = Math.min(255, r * 255);
            d[k + 1] = Math.min(255, g * 255);
            d[k + 2] = Math.min(255, b * 255);
            d[k + 3] = 255;
          }
        x.putImageData(img, 0, 0);
        faces.push(c);
      }
      const cube = new THREE.CubeTexture(faces);
      cube.needsUpdate = true;
      cube.encoding = THREE.sRGBEncoding;
      cube.mapping = THREE.CubeReflectionMapping;
      cube.generateMipmaps = true;
      cube.minFilter = THREE.LinearMipmapLinearFilter;
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
