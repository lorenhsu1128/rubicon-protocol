// ---------- MechEntity 擴充：客機端呈現、倒地 ----------
import { SFX } from '../audio/audio.js';
import { angLerp, clamp, lerp, rnd } from '../core/math.js';
import { animateMech } from '../render/mech-model.js';
import { MechEntity } from './mech-entity.js';

Object.assign(MechEntity.prototype, {
  remoteUpdate(dt) {
    const g = this.game;
    this.t += dt;
    if (this.staggerT > 0) this.staggerT = Math.max(0, this.staggerT - dt);
    for (const k in this.weapons) {
      const w = this.weapons[k];
      if (w.cd > 0) w.cd -= dt;
    }
    this.recoil.l = Math.max(0, this.recoil.l - dt * 8);
    this.recoil.r = Math.max(0, this.recoil.r - dt * 8);
    if (this.melee.active) this.melee.t += dt;
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 1.5;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw;
    if (this.staggerT <= 0 && !this.downed) {
      this.mesh.rotation.x = lerp(this.mesh.rotation.x, this.leanX || 0, Math.min(1, dt * 8));
      this.mesh.rotation.z = lerp(this.mesh.rotation.z, this.leanZ || 0, Math.min(1, dt * 8));
    }
    if (this.model.vehicle) {
      const rel =
        ((((this.aimYaw - this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
      this.torsoYawS = angLerp(
        this.torsoYawS === undefined ? rel : this.torsoYawS,
        rel,
        Math.min(1, dt * this.turnRate),
      );
      this.model.torso.rotation.y = this.torsoYawS;
    } else this.model.torso.rotation.y = this.model.torsoTwist || 0;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const spd = Math.max(1, this.stats.speed);
    const strafe = clamp(this.vel.dot(right) / spd, -1, 1);
    const fwdV = clamp(this.vel.dot(fwd) / spd, -1, 1);
    this.landT = this.landT === undefined ? 9 : this.landT + dt;
    const ml = this.melee.active
      ? (() => {
          const d = this.weapons[this.melee.slot].def,
            st2 = d.combo && d.combo[this.melee.stage];
          if (!st2) return null;
          return {
            kind: st2.spin ? 'spin' : st2.thrust ? 'thrust' : st2.slam ? 'slam' : 'slash',
            ph: clamp(this.melee.t / st2.dur, 0, 1),
            mirror: !!st2.mirror,
            side: this.melee.slot === 'rarm' ? 1 : -1,
          };
        })()
      : null;
    animateMech(this.model, dt, {
      moving: this.moving,
      grounded: this.grounded,
      hover: this.hover,
      boost: this.boost,
      qb: this.qbT > 0,
      aimPitch: this.aimPitch,
      t: this.t,
      recoil: this.recoil,
      swing: this.swing,
      knock: this.staggerT > 0 || this.downed ? 1 : 0,
      knockSide: this.knockSide || 1,
      strafe,
      fwd: fwdV,
      melee: ml,
      turn: 0,
      landT: this.landT,
      aimRel: 0,
      leanZ: this.leanZ || 0,
      leanX: this.leanX || 0,
    });
    // 光暈與噴焰
    this.thrusterFx(
      dt,
      this.isPlayer ? 0x9fe8ff : this.team === 'player' || this.team === 'ally' ? 0x9fffc8 : 0xffb070,
      this.isPlayer ? 0x8fe8ff : 0xffb060,
      false,
    );
    if (this.hp < this.maxHp * 0.35) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.25;
        g.fx.smoke(
          this.center().add(new THREE.Vector3(rnd(-0.5, 0.5), 0.5, rnd(-0.5, 0.5))),
          1.2 * this.scale,
        );
      }
    }
  },
  dieVisual() {
    if (this.dead) return;
    this.dead = true;
    const g = this.game;
    const c = this.center();
    SFX.explode(true, this.isPlayer ? null : c);
    g.rumbleAt(
      c,
      this.isBoss ? 1.0 : 0.8,
      this.isBoss ? 1.0 : 0.5,
      this.isBoss ? 900 : 350,
      this.isBoss ? 80 : 35,
    );
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    g.fx.shatter(this, g.world);
    this.mesh.visible = false;
    g.camShake = Math.max(g.camShake, this.isBoss ? 0.5 : 0.2);
    if (this.isPlayer) {
      g.flashMsg('AC 已被擊破 — 旁觀模式（Tab 切換隊友）', 0xff4d4d, 3);
    }
  },
  enterDowned() {
    this.downed = true;
    this.downT = 30;
    this.downHp = undefined; // 每次倒地重新計算耐久（takeDamage 依 maxHp 與駕駛員技能初始化）
    this.hp = 0;
    this.acs = 0;
    this.staggerT = 0;
    this.melee.active = false;
    this.knockSide = Math.random() < 0.5 ? -1 : 1;
    const g = this.game;
    g.fx.ring(this.center(), 5, 0xff4040);
    SFX.stagger(this.isPlayer ? null : this.center());
    g.flashMsg(`${this.name} 倒地！30 秒內可救援`, 0xff4d4d, 2.5);
    g.netEv({ t: 'msg', txt: `${this.name} 倒地！30 秒內可救援`, c: 0xff4d4d });
  },
});
