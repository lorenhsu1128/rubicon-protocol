// ---------- Game 整合 ----------
import { SFX } from '../audio/audio.js';
import { rnd } from '../core/math.js';
import { PICKUP_DEFS, Pickup, Vehicle } from '../world/map-extras.js';
import { Game } from './game.js';

const BLACK = new THREE.Color(0);

Object.assign(Game.prototype, {
  mapExtrasInit() {
    this.vehicles = [];
    this.pickups = [];
    this.vehPlan = [];
  },
  planVehicles() {
    this.vehicles = [];
    this.pickups = [];
    this.vehPlan = [];
    if (!this.world.corridor) return;
    let t = rnd(12, 30);
    for (let i = 0; i < 3; i++) {
      this.vehPlan.push(t);
      t += rnd(35, 70);
    }
  },
  destructibles() {
    const out = [];
    if (this.world && this.world.props) for (const p of this.world.props) if (!p.dead) out.push(p);
    for (const v of this.vehicles) if (!v.dead) for (const pt of v.parts) out.push(pt);
    return out;
  },
  damageProp(p, dmg, impact, at) {
    if (p.dead) return;
    p.hp -= Math.round(dmg);
    p.flashT = 0.06;
    if (p.ob.mats)
      for (const m of p.ob.mats) {
        if (m.emissive) m.emissive.setRGB(0.6, 0.6, 0.6);
      }
    setTimeout(() => {
      if (p.ob.mats)
        for (const m of p.ob.mats) {
          if (m.emissive) m.emissive.copy(m.userData.emis0 || BLACK); // GLB 材質還原原本的自發光
        }
    }, 70);
    this.popDamage(at || p.center(), Math.round(dmg), false, false, false, 0, -1, impact);
    this.netEv({ t: 'propHp', i: p.idx, h: p.hp });
    if (p.hp <= 0) {
      this.world.destroyProp(p, this.fx);
      this.netEv({ t: 'propDie', i: p.idx });
      this.rumbleAt(p.center(), 0.5, 0.3, 160, 30);
    }
  },
  spawnPickup(kind, pos, id) {
    const pk = new Pickup(this, kind, pos, id);
    this.pickups.push(pk);
    if (this.net.role === 'host')
      this.netEv({
        t: 'pk',
        i: pk.id,
        k: kind,
        p: [+pos.x.toFixed(2), +pos.y.toFixed(2), +pos.z.toFixed(2)],
      });
    return pk;
  },
  collectPickup(pk, ent) {
    pk.remove();
    const d = PICKUP_DEFS[pk.kind];
    if (pk.kind === 'repair') {
      ent.hp = Math.min(ent.maxHp, ent.hp + Math.round(ent.maxHp * 0.4));
      this.fx.ring(ent.center(), 5, 0x7ee081);
    } else {
      if (ent.isPlayer) {
        this.save.items[pk.kind] = (this.save.items[pk.kind] || 0) + 1;
        this.writeSave();
        this.renderWeaponHud(true);
      }
    }
    SFX.kit();
    this.flashMsg(`${ent.name} 取得 ${d.name}`, d.color, 1.5);
    if (this.net.role === 'host') {
      this.netEv({ t: 'pkr', i: pk.id });
      if (!ent.isPlayer && ent.slot !== undefined) this.netEv({ t: 'pkGot', slot: ent.slot, k: pk.kind });
    }
  },
  updateMapExtras(dt) {
    const isHost = !(this.net && this.net.role === 'client');
    if (isHost && this.vehPlan.length && this.missionT >= this.vehPlan[0]) {
      this.vehPlan.shift();
      const kind = this.world.corridor.kind === 'rail' ? 'train' : 'truck';
      const v = new Vehicle(this, kind, Math.random() < 0.5 ? 1 : -1);
      this.vehicles.push(v);
      this.flashAlert((kind === 'train' ? '運輸列車' : '運輸貨車') + ' 從隧道駛出 — 擊破可獲得補給');
    }
    for (const v of this.vehicles) {
      if (v.dead) continue;
      v.update(dt);
      if (isHost) {
        // 撞擊機體：100 傷害＋大擊退（每台每 1.5 秒一次）
        for (const e of [...(this.players || []), ...this.enemies, ...this.allies]) {
          if (!e || e.dead) continue;
          const t = this.time;
          if (v.hitCd[e.id] && t - v.hitCd[e.id] < 1.5) continue;
          for (let i = 0; i < v.cars; i++) {
            const cp = v.carPos(i);
            if (Math.hypot(e.pos.x - cp.x, e.pos.z - cp.z) < 3.2 + e.radius && Math.abs(e.pos.y - cp.y) < 4) {
              v.hitCd[e.id] = t;
              const c = this.world.corridor;
              const td = this.world.corridorDir(v.s);
              const dir = new THREE.Vector3(td.x * v.dirSign, 0.3, td.y * v.dirSign);
              const side = new THREE.Vector3(c.perp.x, 0, c.perp.y).multiplyScalar(
                (e.pos.x - cp.x) * c.perp.x + (e.pos.z - cp.z) * c.perp.y > 0 ? 1 : -1,
              );
              e.takeDamage(100, 600, null, e.center(), dir);
              e.vel.add(dir.multiplyScalar(18).add(side.multiplyScalar(14)));
              e.iFrames = Math.max(e.iFrames, 0.3);
              break;
            }
          }
        }
      }
      if (v.gone) {
        v.dead = true;
        v.cleanup();
        this.netEv({ t: 'vehGone', i: v.id });
      }
    }
    this.vehicles = this.vehicles.filter((v) => !v.dead || (v.mesh.visible === false && !v.gone));
    for (const pk of this.pickups) {
      if (pk.dead) continue;
      pk.update(dt);
      if (isHost) {
        for (const e of this.players || []) {
          if (!e || e.dead || e.downed) continue;
          if (e.pos.distanceTo(pk.pos) < 2.4) {
            this.collectPickup(pk, e);
            break;
          }
        }
      }
    }
    this.pickups = this.pickups.filter((p) => !p.dead);
  },
  // 客機：從快照／事件同步車輛與物件
  clientMapEvent(e) {
    switch (e.t) {
      case 'veh': {
        let v = this.vehicles.find((x) => x.id === e.i);
        if (!v && this.world.corridor) {
          v = new Vehicle(this, e.k, e.d, e.i);
          this.vehicles.push(v);
        }
        if (v && !v.dead) {
          v.s = e.s;
          v.hp = e.h;
          v.update(0);
        }
        return true;
      }
      case 'vehDie': {
        const v = this.vehicles.find((x) => x.id === e.i);
        if (v && !v.dead) {
          v.dead = true;
          const c = v.center();
          this.fx.explosion(c, 5, 0xffa040, true);
          SFX.explode(true, c);
          this.rumbleAt(c, 0.8, 0.5, 300, 40);
          this.fx.shatterVehicle(v);
          v.mesh.visible = false;
        }
        return true;
      }
      case 'vehGone': {
        const v = this.vehicles.find((x) => x.id === e.i);
        if (v) {
          v.dead = true;
          v.cleanup();
        }
        return true;
      }
      case 'propHp': {
        const p = this.world.props && this.world.props[e.i];
        if (p) {
          p.hp = e.h;
          if (p.ob.mats)
            for (const m of p.ob.mats) {
              if (m.emissive) m.emissive.setRGB(0.6, 0.6, 0.6);
            }
          setTimeout(() => {
            if (p.ob.mats)
              for (const m of p.ob.mats) {
                if (m.emissive) m.emissive.copy(m.userData.emis0 || BLACK);
              }
          }, 70);
        }
        return true;
      }
      case 'propDie': {
        const p = this.world.props && this.world.props[e.i];
        if (p && !p.dead) {
          this.world.destroyProp(p, this.fx);
        }
        return true;
      }
      case 'pk': {
        if (!this.pickups.find((p) => p.id === e.i))
          this.pickups.push(new Pickup(this, e.k, new THREE.Vector3(e.p[0], e.p[1], e.p[2]), e.i));
        return true;
      }
      case 'pkr': {
        const p = this.pickups.find((p) => p.id === e.i);
        if (p) p.remove();
        return true;
      }
      case 'pkGot': {
        if (e.slot === this.net.me && e.k !== 'repair') {
          this.save.items[e.k] = (this.save.items[e.k] || 0) + 1;
          this.writeSave();
          this.renderWeaponHud(true);
        }
        return true;
      }
    }
    return false;
  },
  serVehicles() {
    return this.vehicles
      .filter((v) => !v.dead)
      .map((v) => ({ i: v.id, k: v.kind, d: v.dirSign, s: +v.s.toFixed(2), h: v.hp }));
  },
});
