// Game：玩家機體操作與鎖定
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  cycleLock() {
    if (this.spectator) {
      const L = this.fp ? this.spectateList() : this.players.filter((x) => !x.dead);
      this.spectateIdx = (this.spectateIdx + 1) % Math.max(1, L.length);
      return;
    }
    if (this.player && this.player.dead && this.players && this.players.length > 1) {
      this.spectateIdx = (this.spectateIdx + 1) % this.players.length;
      return;
    }
    const p = this.player;
    const list = this.hostilesOfEnt(p)
      .filter((e) => !e.dead && !e.noLock && e.pos.distanceTo(p.pos) < p.stats.lockRange * 1.3)
      .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos));
    if (!list.length) {
      p.lock = null;
      return;
    }
    const i = list.indexOf(p.lock);
    p.lock = list[(i + 1) % list.length];
    p.lockT = 0;
    SFX.ui();
  },

  // ---------- player control ----------
  updatePlayer(dt) {
    const p = this.player,
      k = this.keys;
    this.applySmartAttack(p, dt);
    if (p.dead) {
      p.move(dt, new THREE.Vector3(), false, false, false, null);
      return;
    }
    // mouse → world at player's height
    if (this.fp) {
      if (this.padAim && this.padAim.lengthSq() > 0.09) {
        this.fpYaw -= this.padAim.x * dt * 2.6 * (this.ctrl.sens || 1);
        this.fpPitch = clamp(this.fpPitch - this.padAim.z * dt * 1.8 * (this.ctrl.sens || 1), -1.1, 0.9);
      }
      const look = this.fpLookDir(this.fpYaw, this.fpPitch);
      this.mouseWorld.copy(this.fpEye(p)).addScaledVector(look, 40);
      if (p.lock && (p.lock.dead || p.lock.noLock || p.lock.pos.distanceTo(p.pos) > p.stats.lockRange * 1.4))
        p.lock = null;
      this.fpPickLock(p, false);
    } else {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1),
        this.camera,
      );
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.pos.y + p.model.height * 0.5));
      ray.ray.intersectPlane(plane, this.mouseWorld) || this.mouseWorld.set(p.pos.x, p.pos.y, p.pos.z - 10);
      // lock-on
      if (p.lock && (p.lock.dead || p.lock.noLock || p.lock.pos.distanceTo(p.pos) > p.stats.lockRange * 1.4))
        p.lock = null;
      if (!p.lock) {
        let best = null,
          bd = 1e9;
        for (const e of this.hostilesOfEnt(p)) {
          if (e.dead || e.noLock) continue;
          const d = e.pos.distanceTo(p.pos);
          if (d < p.stats.lockRange && d < bd) {
            bd = d;
            best = e;
          }
        }
        p.lock = best;
      }
    }
    if (this.touchActive) {
      this.padActive = true;
      if (!p.lock) {
        const dir =
          this.touchMove && this.touchMove.lengthSq() > 0.02
            ? this.touchMove.clone().normalize()
            : new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        this.mouseWorld.copy(p.center()).addScaledVector(dir, 20);
      }
    } // 觸控：全自動瞄準（鎖定目標，否則移動方向）
    else if (this.padAim && this.padAim.lengthSq() > 0.09) {
      this.mouseWorld.copy(p.center()).addScaledVector(this.padAim.clone().normalize(), 24);
      this.padAimT = 0.4;
    } // 右搖桿瞄準
    else if (this.padAimT > 0) {
      this.padAimT -= dt;
    } else if (this.padActive && !this.mouseMovedT && !p.lock) {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      this.mouseWorld.copy(p.center()).addScaledVector(fwd, 20);
    }
    if (this.ctrl.aim === 'auto' && !p.lock) {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      this.mouseWorld.copy(p.center()).addScaledVector(fwd, 20);
    } // 自動瞄準：無鎖定時朝機體前方
    let aimPos0 = this.mouseWorld.clone();
    let aimEnt0 = null;
    if (p.lock) {
      const d = p.lock.pos.distanceTo(p.pos);
      const inRange = d < p.stats.lockRange;
      if (inRange) {
        // aim toward lock but let mouse steer slightly
        const lead = clamp(d / 95, 0, 0.9);
        aimPos0 = p.lock.center().addScaledVector(p.lock.vel, lead);
        aimEnt0 = p.lock;
      }
    }
    p.setAim(aimPos0);
    // movement (world axes; camera has fixed yaw)
    let wish = new THREE.Vector3(
      (this.act('right') ? 1 : 0) - (this.act('left') ? 1 : 0),
      0,
      (this.act('down') ? 1 : 0) - (this.act('up') ? 1 : 0),
    );
    if (wish.lengthSq() > 0) wish.normalize();
    if (this.padMove && this.padMove.lengthSq() > 0.04) {
      wish.copy(this.padMove);
      if (wish.length() > 1) wish.normalize();
    }
    if (this.touchMove && this.touchMove.lengthSq() > 0.02) {
      wish.copy(this.touchMove);
      if (wish.length() > 1) wish.normalize();
    }
    if ((this.ctrl.moveRel === 'mech' || this.fp) && wish.lengthSq() > 0) {
      const yy = this.fp ? this.fpYaw : p.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yy), 0, -Math.cos(yy)),
        right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      wish = fwd.multiplyScalar(-wish.z).add(right.multiplyScalar(wish.x)).normalize();
    } // 機體相對方向
    const qb = this.act('qb');
    if (qb) {
      this.down[this.keymap.qb] = false;
    }
    if (this.fp) {
      p.fpFace = true;
      p.aimYaw = this.fpYaw;
      p.aimPitch = this.fpPitch;
    } else p.fpFace = false;
    p.move(dt, wish, this.act('jump'), qb, this.act('ab'), p.lock);
    // weapons
    const aimR = this.reticlePoint(p);
    this.aimRet = aimR;
    const fireSlot = (slot, held) => {
      const w = p.weapons[slot];
      const isBeam = w.def.type === 'laser' || w.def.type === 'empbeam';
      let aimPos = aimPos0,
        aimEnt = aimEnt0;
      if (isBeam) {
        if (this.fp) {
          aimPos = aimR;
          aimEnt = null;
        } else if (p.lock && !p.lock.dead && p.lock.pos.distanceTo(p.pos) < p.stats.lockRange) {
          aimPos = p.lock.center();
          aimEnt = p.lock;
        } else {
          aimPos = aimR;
          aimEnt = null;
        }
      }
      if (w.def.type === 'laser' && w.def.chargeT > 0 && held && !w.charging && w.cd <= 0) SFX.charge(null);
      if (
        !this.ctrl.holdFire &&
        w.def.type !== 'melee' &&
        w.def.type !== 'empbeam' &&
        !(w.def.type === 'laser' && w.def.chargeT > 0)
      ) {
        const key = 'press_' + slot;
        if (held && !this[key]) {
          this[key] = true;
          if (p.fire(slot, aimPos, aimEnt)) this.playerFiredAt = 0.3;
        }
        if (!held) this[key] = false;
        return;
      }
      if (w.def.type === 'melee') {
        const key = 'press_' + slot;
        if (held && !this[key]) {
          this[key] = true;
          if (p.fire(slot, aimPos, aimEnt)) this.playerFiredAt = 0.3;
        }
        if (!held) this[key] = false;
        return;
      }
      if (w.def.type === 'laser' && w.def.chargeT > 0) {
        if (held) {
          if (w.cd <= 0) {
            w.charging = true;
            w.charge += dt;
            if (w.charge >= w.def.chargeT + 0.05) {
              /* hold at full */ w.charge = w.def.chargeT + 0.05;
            }
          }
        } else if (w.charging) {
          p.fire(slot, aimPos, aimEnt);
          this.playerFiredAt = 0.3;
        }
        return;
      }
      if (held) {
        if (p.fire(slot, aimPos, aimEnt)) this.playerFiredAt = 0.3;
      }
    };
    fireSlot('rarm', this.act('fireR'));
    fireSlot('larm', this.act('fireL'));
    fireSlot('lback', this.act('backL'));
    fireSlot('rback', this.act('backR'));
    if (this.playerFiredAt > 0) this.playerFiredAt -= dt;
  },
});
