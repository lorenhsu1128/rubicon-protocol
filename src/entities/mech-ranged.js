// MechEntity 擴充：遠程射擊改版第 1 期「邊閃邊打」（docs/ranged-design.md、data/ranged.js）。
// rbTick（move 每格）記下落地、最高點與繞射；rbShot（fire 開火時）算這一發的加成；
// rbHit（投射物／雷射打中時）顯示提示與命中音。判定在房主／單機，客機的自身預測也跑 rbTick（HUD 的繞射）。
import * as THREE from 'three';
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { GRAVITY } from '../data/parts.js';
import { RB, RB_APEX, RB_CTR, RB_LAND, RB_ORBIT, RB_QB, rbLabel } from '../data/ranged.js';
import { MechEntity } from './mech-entity.js';

Object.assign(MechEntity.prototype, {
  rbTick(dt) {
    const t = this.t;
    if (!this.grounded) {
      if (this.rbAir0 === undefined) this.rbAir0 = t;
      if ((this.rbVy || 0) > 0 && this.vel.y <= 0) this.rbApexT = t; // 過了最高點
      this.rbVy = this.vel.y;
    } else {
      if (this.rbAir0 !== undefined && t - this.rbAir0 >= RB.LAND_AIR) this.rbLandT = t;
      this.rbAir0 = undefined;
      this.rbVy = 0;
    }
    // 繞射：有鎖定目標，水平移動的方向和目標方向接近垂直
    const L = this.lock;
    let on = false;
    if (L && !L.dead && L.pos) {
      const vx = this.vel.x,
        vz = this.vel.z,
        sp = Math.hypot(vx, vz);
      const dx = L.pos.x - this.pos.x,
        dz = L.pos.z - this.pos.z,
        dd = Math.hypot(dx, dz);
      if (sp > RB.ORBIT_V * this.dk && dd > 1e-3) on = Math.abs(vx * dz - vz * dx) / (sp * dd) > RB.ORBIT_SIN;
    }
    const o = this.rbOrbT || 0;
    this.rbOrbT = on ? Math.min(RB.ORBIT_T, o + dt) : Math.max(0, o - dt * RB.ORBIT_DECAY);
    if (this.rbCtrT > 0) this.rbCtrT -= dt;
  },
  rbOrbK() {
    return clamp((this.rbOrbT || 0) / RB.ORBIT_T, 0, 1);
  },
  // 最高點的前後 APEX_T 秒（上升中以剩下的速度推算到頂的時間；爬升懸浮不算）
  rbApex() {
    if (this.grounded || this.hoverMode === 2) return false;
    if (this.vel.y > 0) return this.vel.y / (this.riseG || GRAVITY) <= RB.APEX_T;
    return this.rbApexT !== undefined && this.t - this.rbApexT <= RB.APEX_T;
  },
  // 這一發的加成：{ dmg, imp, spread, bend, hitR, tags }
  rbShot() {
    const t = this.t,
      o = { dmg: 1, imp: 1, spread: 1, bend: 1, hitR: 0, tags: 0 };
    if (this.qbStartT !== undefined && t - this.qbStartT <= RB.QB_T) {
      o.imp *= RB.QB_IMP;
      o.tags |= RB_QB;
    }
    // 完美 QB 的加成還沒被近戰用掉 → 轉成射擊的反擊時間（剩下的秒數）
    if (this.pqbT > 0 && !(this.rbCtrT > 0)) {
      this.rbCtrT = this.pqbT;
      this.pqbT = 0;
      this.rbCtrStart();
    }
    if (this.rbCtrT > 0) {
      o.dmg *= RB.CTR_DMG;
      o.imp *= RB.CTR_IMP;
      o.bend *= RB.CTR_BEND;
      o.hitR += RB.CTR_HITR * this.dk;
      o.tags |= RB_CTR;
    }
    if (this.rbApex()) {
      o.spread *= RB.APEX_SPREAD;
      o.imp *= RB.APEX_IMP;
      o.tags |= RB_APEX;
    }
    if (this.rbLandT !== undefined && t - this.rbLandT <= RB.LAND_T) {
      o.imp *= RB.LAND_IMP;
      o.tags |= RB_LAND;
      this.rbLandT = undefined; // 只有第一輪
    }
    const ok = this.rbOrbK();
    if (ok > 0) {
      o.spread *= 1 - (1 - RB.ORBIT_SPREAD) * ok;
      o.hitR += RB.ORBIT_HITR * this.dk * ok;
      if (ok >= 1) o.tags |= RB_ORBIT;
    }
    o.imp = Math.min(RB.IMP_MAX, o.imp);
    return o;
  },
  // 反擊開始：畫面稍微變慢（單人）、回饋只給本人
  rbCtrStart() {
    const g = this.game;
    if (!(g.net && g.net.role)) g.rbSlowT = Math.max(g.rbSlowT || 0, RB.CTR_SLOW);
    if (this.isPlayer) g.rbCtrFx(this, this.rbCtrT);
    else if (this.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: this.slot, k: 'ctr', i: this.id, d: +this.rbCtrT.toFixed(2) });
  },
  // 有加成的一發打中：提示文字（同樣的組合 0.5 秒內不重複）與命中音
  rbHit(target, tags) {
    if (!tags || !target || target.dead === undefined) return;
    const g = this.game;
    if (tags !== this.rbTagLast || this.t - (this.rbTagT || -9) > 0.5) {
      this.rbTagLast = tags;
      this.rbTagT = this.t;
      const c = target.center ? target.center() : target.pos.clone();
      g.popDamage(
        c.add(new THREE.Vector3(0, 2.6 * this.dk, 0)),
        rbLabel(tags),
        false,
        true,
        false,
        0,
        target.id,
      );
    }
    if (this.isPlayer) SFX.rangedBonus(tags);
    else if (this.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: this.slot, k: 'rb', b: tags });
  },
});
