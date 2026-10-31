// Game：水面與雲海（docs/water-design.md）。renderMain 每格呼叫 waterTick：接上目前地圖的水面、
// 收集推水的來源（機體的腳與身體、雨）、更新模擬與焦散、平面反射；高空軌道的雲海（粒子的煙霧）。
// 只有外觀：各端自己算（客機看到的機體位置一樣會推水），不轉送。設定「水面品質」ctrl.water（low／mid／high）。
import { WaterFx } from '../fx/water/index.js';
import { CloudSea } from '../fx/cloudsea.js';
import { emitPreset } from '../fx/presets.js';
import { SU } from '../render/style/shader.js';
import { DS } from '../core/scale.js';
import { Game } from './game.js';

const _p = new THREE.Vector3(),
  _d = new THREE.Vector3();

Object.assign(Game.prototype, {
  // 水面品質：沒設定時觸控裝置（手機、平板）用低、其他用中
  waterQ() {
    const q = this.ctrl && this.ctrl.water;
    if (q === 'low' || q === 'mid' || q === 'high') return q;
    return document.body.classList.contains('touchDev') ? 'low' : 'mid';
  },
  waterTick() {
    const w = this.world;
    if (!this.water) {
      this.water = new WaterFx(this.renderer, DS);
      this.fx.water = this.water; // 爆炸、下洗氣流（fx/effects.js）
    }
    const W = this.water;
    W.setQuality(this.waterQ());
    if (W.world !== w || (w && W.g !== (w.waterMesh && w.waterMesh.userData.water ? w.waterMesh : null)))
      W.attach(w);
    // 特效時鐘（暫停時不動）
    const ft = this.fx.time;
    const dt = Math.max(
      0,
      Math.min(0.1, this.waterT0 === undefined || ft < this.waterT0 ? 0 : ft - this.waterT0),
    );
    this.waterT0 = ft;
    this.cloudTick(dt);
    this.airCloudTick(dt); // 空域的雲（game/air.js）
    if (!W.g) {
      W.off();
      if (this.stylePipe) this.stylePipe.keepPrev = false;
      return;
    }
    if (W.simOn) this.waterSources(dt);
    const P = this.lab ? this.lab.P : this.cine ? this.cine.P : this.styleP;
    W.update(dt, {
      cam: this.camera,
      focus: this.waterFocus(),
      sun: this.sun,
      hemi: this.hemi,
      scene: this.scene,
      toon: !!(P && P.toon),
      pipe: this.post.enabled && this.post.ok ? this.stylePipe : null,
    });
    W.preRender(this.scene, this.camera);
  },
  // 模擬視窗的中心：玩家的機體；沒有時鏡頭的視線和水面的交點（最遠 120 m × 尺度）
  waterFocus() {
    const p = this.player;
    if (p && !p.dead && this.state !== 'editor' && !this.cine) return p.pos;
    const c = this.camera,
      L = this.water.level;
    c.getWorldDirection(_d);
    let t = _d.y < -0.05 ? (c.position.y - L) / -_d.y : 60 * DS;
    t = Math.min(Math.max(t, 0), 120 * DS);
    return _p.copy(c.position).addScaledVector(_d, t);
  },
  // 推水的來源：機體的腳與身體（球體）、雨
  waterSources(dt) {
    const W = this.water,
      L = W.level;
    const list = this.everyone();
    for (const e of list) {
      if (!e || e.dead || !e.model || !e.pos || !W.inWin(e.pos.x, e.pos.z, 20 * DS)) continue;
      if (e.model.group && !e.model.group.visible && !(e.bossVis & 1)) continue;
      const sc = e.scale || DS;
      const m = e.model;
      if (m.legs && m.legs.length && (m.type === 'biped' || m.type === 'reverse' || m.type === 'quad')) {
        if (e.pos.y > L + 3 * DS) continue;
        m.legs.forEach((Lg, i) => {
          Lg.foot.getWorldPosition(_p);
          W.sphere(e.id * 8 + i, _p.x, _p.y, _p.z, 0.5 * sc);
        });
        // 身體（深水時腰沒入水中）
        W.sphere(e.id * 8 + 7, e.pos.x, e.pos.y + 1.1 * sc, e.pos.z, 0.6 * sc);
      } else {
        const r = Math.min(4 * DS, (e.radius || 1.3 * DS) * 0.9);
        if (e.pos.y - r > L + 0.5 * DS) continue;
        W.sphere(e.id * 8, e.pos.x, e.pos.y, e.pos.z, r);
      }
    }
    // 雨：視窗裡隨機的小水滴
    const wt = this.world && this.world.weather;
    if (wt && wt.kind === 'rain' && dt > 0) {
      const n = Math.min(8, Math.floor(dt * 40 + Math.random()));
      const h = W.win.z * 0.45;
      for (let i = 0; i < n; i++) {
        const x = W.win.x + (Math.random() * 2 - 1) * h,
          z = W.win.y + (Math.random() * 2 - 1) * h;
        if (W.wet(x, z)) W.drop(x, z, 0.5 * DS, -0.012 * DS);
      }
    }
  },
  // 子彈、砲彈穿過水面（entities/projectile.js 每格）：水花＋推水
  waterCross(a, b, kind) {
    const W = this.water;
    if (!W || !W.g) return;
    const p = W.cross(a, b);
    if (!p) return;
    const big = kind === 'shell' || kind === 'grenade' || kind === 'missile' || kind === 'rocket';
    W.drop(p.x, p.z, (big ? 1.6 : 0.6) * DS, -(big ? 0.35 : 0.08) * DS);
    if (!this.fx.skip(p, 2))
      emitPreset(this.fx.g, 'g_water', p, { S: DS * (big ? 0.9 : 0.35), n: big ? 1 : 0.4 });
  },
  // 高空軌道的雲海：World.cloud（粒子的煙霧，fx/cloudsea.js）
  cloudTick(dt) {
    const c = this.world && this.world.cloud;
    if (!c) {
      if (this.cloudSea && this.cloudSea.warm) this.cloudSea.clear();
      return;
    }
    if (!this.cloudSea) this.cloudSea = new CloudSea(this.scene);
    if (this.cloudSea.world !== this.world) {
      this.cloudSea.clear();
      this.cloudSea.world = this.world;
    }
    this.cloudSea.update(dt, this.camera, c.level, c.color, DS);
  },
  // 地面或水面（下洗氣流貼著吹的高度）：有水而且水面比地面高時是水面
  waterSurf(x, z, gy) {
    const w = this.world,
      W = w && w.theme.water;
    if (!W || w.cloud) return gy;
    return Math.max(gy, W.level);
  },
  // 渲染完：別的場景（機甲庫、作戰室）用同一份著色器，不要套到水面的設定
  waterAfter() {
    SU.stWa.value.w = 0;
  },
});
