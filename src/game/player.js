// Game：玩家機體操作與鎖定
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // 鎖定的有效距離：裝備的武器（不含近戰）最遠的射程，上限是火控的鎖定距離；只有近戰武器時用鎖定距離
  lockReach(p) {
    let r = 0;
    for (const k in p.weapons) {
      const d = p.weapons[k].def;
      if (d && d.range > 0 && d.type !== 'melee' && d.type !== 'shield' && d.type !== 'none')
        r = Math.max(r, d.range);
    }
    const base = r ? Math.min(p.stats.lockRange, r) : p.stats.lockRange;
    // 沙暴干擾機（data/foes.js）25 m 內：鎖定距離減半
    const jam = (this.enemies || []).some(
      (e) => !e.dead && e.opts && e.opts.vehKey === 'jammer' && e.pos.distanceTo(p.pos) < 25,
    );
    return jam ? base * 0.5 : base;
  },
  // 在畫面內（鏡頭前方、投影在視窗範圍裡）
  onScreen(e) {
    const v = e.center().project(this.camera);
    return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
  },
  // 可以鎖定的敵人（依鎖定順序）：有效距離內；
  // 第一人稱：畫面內、依離準星的角度；第三人稱：機甲面向的正面 180° 內（不論在不在畫面裡）由近到遠，背後的完全不鎖定
  lockCands(p) {
    const reach = this.lockReach(p);
    const out = [];
    if (this.fp) {
      const look = this.fpLookDir(this.fpYaw, this.fpPitch);
      const eye = this.fpEye(p);
      for (const e of this.hostilesOfEnt(p)) {
        if (e.dead || e.noLock) continue;
        const d = e.center().sub(eye);
        const dist = d.length();
        if (dist > reach || dist < 0.5 || !this.onScreen(e)) continue;
        out.push({ e, k: Math.acos(clamp(d.normalize().dot(look), -1, 1)) });
      }
    } else {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      for (const e of this.hostilesOfEnt(p)) {
        if (e.dead || e.noLock) continue;
        const dist = e.pos.distanceTo(p.pos);
        if (dist > reach) continue;
        const rel = e.pos.clone().sub(p.pos).setY(0);
        if (rel.lengthSq() > 0.01 && rel.normalize().dot(fwd) < 0) continue;
        out.push({ e, k: dist });
      }
    }
    return out.sort((a, b) => a.k - b.k).map((c) => c.e);
  },
  // 每格：目標被擊破、不能鎖定或移到攻擊距離外就解除，沒有目標時鎖定第一順位
  autoLock(p) {
    if (p.lock && (p.lock.dead || p.lock.noLock || p.lock.pos.distanceTo(p.pos) > this.lockReach(p) * 1.05))
      p.lock = null;
    if (!p.lock) p.lock = this.lockCands(p)[0] || null;
  },
  // 切換鍵：依 lockCands 的順序換下一個
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
    if (!p || p.dead) return;
    const list = this.lockCands(p);
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
      this.autoLock(p);
    } else {
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1),
        this.camera,
      );
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.pos.y + p.model.height * 0.5));
      ray.ray.intersectPlane(plane, this.mouseWorld) || this.mouseWorld.set(p.pos.x, p.pos.y, p.pos.z - 10);
      // lock-on
      this.autoLock(p);
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
