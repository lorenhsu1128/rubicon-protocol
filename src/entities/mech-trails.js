// ============================================================
//  MechEntity 擴充：動作的特效（機甲動作改版第四期，docs/mech-animation.md）
//  - 刀光：近戰武器的刀尖移動得快時，刀根到刀尖拉一條帶子（fx/trail.js）
//  - 地面的推進氣流帶：滑行、QB、滑停時兩腳下方各一條貼地的白色帶子
//  - 腳印與揚塵：QB 結束的滑停、急煞車、重落地時在腳下留下腳印、噴一團塵土
//  只有外觀：房主與客機各自依模型的動作狀態（rig.an）計算，不轉送
// ============================================================
import { MechEntity } from './mech-entity.js';

const _a = new THREE.Vector3(),
  _b = new THREE.Vector3(),
  _f = new THREE.Vector3(),
  _r = new THREE.Vector3();
const SLOT = { r: 'rarm', l: 'larm' };
const PRINTS = new Set(); // 場上的腳印（上限 PRINT_MAX；fx.clear 之後不在場景裡的拿掉）
const PRINT_MAX = 80;
const BLADE_V = 9; // 刀尖速度（舊尺度 m/s × 機體倍率）超過這個才畫刀光

Object.assign(MechEntity.prototype, {
  // move／remoteUpdate 在動作與 IK 之後呼叫
  trailsTick(dt) {
    const g = this.game,
      m = this.model;
    if (!g || !g.fx || !g.fx.ribbons || !m || m.vehicle || !m.arms || this.dead || !(dt > 0)) return;
    if (this.mesh && !this.mesh.visible) return;
    const R = g.fx.ribbons,
      k = this.scale || 1;
    // ----- 刀光 -----
    const bt = this.bladeT || (this.bladeT = {});
    for (const s of ['l', 'r']) {
      const w = this.weapons && this.weapons[SLOT[s]];
      const a = m.arms[s];
      if (!w || w.dropped || !w.def || !w.def.combo || !a || !a.bladeTip) continue;
      a.bladeRef.updateWorldMatrix(true, false);
      _b.copy(a.bladeTip).applyMatrix4(a.bladeRef.matrixWorld);
      _a.copy(a.bladeBase).applyMatrix4(a.bladeRef.matrixWorld);
      const prev = bt[s] || (bt[s] = new THREE.Vector3().copy(_b));
      const sp = prev.distanceTo(_b) / dt;
      prev.copy(_b);
      const key = this.id + 'b' + s;
      if (sp > BLADE_V * k)
        R.push(key, _a, _b, {
          color: w.def.color || 0xbfe8ff,
          opacity: 0.75,
          life: 0.18,
          max: 14,
          additive: true,
          edge: 0.15,
        });
      else if (sp < BLADE_V * 0.4 * k) R.cut(key);
    }
    // ----- 地面的推進氣流帶 -----
    const an = m.an;
    if (!an || !m.legs || !m.legs.length) return;
    const legged = m.type === 'biped' || m.type === 'reverse';
    const hv = Math.hypot(this.vel.x, this.vel.z);
    const on =
      this.grounded && legged && hv > 6 * (this.dk || 1) && (an.gW > 0.5 || an.qW > 0.3 || an.skid > 0.05);
    const gy = this.pos.y + 0.05 * k;
    _r.set(this.vel.z, 0, -this.vel.x);
    if (_r.lengthSq() > 1e-6) _r.normalize();
    m.legs.forEach((L, i) => {
      const key = this.id + 'g' + i;
      if (!on) return R.cut(key);
      L.foot.getWorldPosition(_f);
      const hw = 0.28 * k;
      _a.set(_f.x + _r.x * hw, gy, _f.z + _r.z * hw);
      _b.set(_f.x - _r.x * hw, gy, _f.z - _r.z * hw);
      R.push(key, _a, _b, {
        color: 0xe8f0f6,
        opacity: an.skid > 0.05 ? 0.5 : 0.32,
        life: 0.9,
        max: 40,
        additive: false,
      });
    });
    // ----- 腳印與揚塵：滑停開始、急煞車開始、重落地 -----
    const skid0 = an.skid > 0.3 && !(this.fxSkid > 0.3);
    this.fxSkid = an.skid;
    const brake0 = an.bW > 0.5 && !(this.fxBrake > 0.5);
    this.fxBrake = an.bW;
    const land0 =
      this.grounded && this.landT !== undefined && this.landT <= dt + 1e-4 && (this.landV || 0) > 10;
    if (legged && this.grounded && (skid0 || brake0 || land0)) {
      for (const L of m.legs) {
        L.foot.getWorldPosition(_f);
        _f.y = gy;
        g.fx.dust(_f.clone(), land0 ? 1.3 : 0.9, land0 ? 7 : 5);
        this.footPrint(_f);
      }
    }
  },
  // 腳印：貼地的暗色橢圓，6 秒後淡出
  footPrint(p) {
    const g = this.game;
    for (const d of PRINTS) if (!d.parent) PRINTS.delete(d);
    if (PRINTS.size >= PRINT_MAX || g.fx.skip(p, 1)) return;
    const k = this.scale || 1;
    const d = new THREE.Mesh(
      g.fx.discGeo,
      new THREE.MeshBasicMaterial({
        color: 0x14120f,
        transparent: true,
        opacity: 0.32,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    d.position.copy(p);
    d.rotation.order = 'YXZ';
    d.rotation.y = this.yaw + (this.model.legsG ? this.model.legsG.rotation.y : 0);
    d.rotation.x = -Math.PI / 2;
    d.scale.set(0.25 * k, 0.45 * k, 1);
    d.userData.noFade = true;
    PRINTS.add(d);
    g.fx.add(d, 6, (e, t) => {
      e.mesh.material.opacity = 0.32 * (t < 0.6 ? 1 : (1 - t) / 0.4);
    });
  },
});
