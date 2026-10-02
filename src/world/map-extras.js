// ============================================================
//  MAP EXTRAS — 穿越公路／鐵路的運輸車輛、可破壞散置物件、掉落物
// ============================================================
import { SFX } from '../audio/audio.js';
import { pick, rnd, rndi } from '../core/math.js';
import { buildPickupMesh, buildTransport } from '../render/extra-models.js';

const BLACK = new THREE.Color(0);

export const PICKUP_DEFS = {
  repair: { name: '修補包', color: 0x7ee081 },
  cs_bomber: { name: 'AIRSTRIKE 空襲 +1', color: 0x5cc8ff },
  cs_ally: { name: 'ALLY-AC 友軍 +1', color: 0xffb060 },
};
let VEH_ID = 1,
  PICK_ID = 1;

// ---------- 車輛（貨車／列車）：沿走廊直線行駛，可被擊破，撞擊機體 ----------
export class Vehicle {
  constructor(game, kind, dirSign, id) {
    this.game = game;
    this.kind = kind;
    this.id = id || VEH_ID++;
    this.dirSign = dirSign;
    const w = game.world;
    this.s = -dirSign * (w.corridorHalf + 14);
    this.speed = kind === 'train' ? 24 : 18;
    this.hp = 600;
    this.maxHp = 600;
    this.dead = false;
    this.team = 'vehicle';
    this.isVehicle = true;
    this.name = kind === 'train' ? '運輸列車' : '運輸貨車';
    this.radius = 2.6;
    this.hitCd = {};
    this.flashT = 0;
    this.cars = kind === 'train' ? rndi(3, 5) + 1 : 1;
    this.carLen = kind === 'train' ? 7.5 : 8;
    this.build();
    this.parts = [];
    for (let i = 0; i < this.cars; i++) {
      const self = this,
        idx = i;
      this.parts.push({
        isVehiclePart: true,
        id: 900000 + this.id * 10 + i,
        parent: self,
        radius: 2.8,
        team: 'vehicle',
        get dead() {
          return self.dead;
        },
        center() {
          return self.carPos(idx).add(new THREE.Vector3(0, 1.6, 0));
        },
        takeDamage(d, im, from, at) {
          self.takeDamage(d, im, from, at);
        },
      });
    }
  }
  build() {
    const g = buildTransport(this.kind, this.cars, this.carLen);
    this.mesh = g;
    this.game.scene.add(g);
    this.mats = [];
    // 會受擊閃光的材質（GLB 可能有多重材質與描邊）
    g.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m.emissive && !this.mats.includes(m)) this.mats.push(m);
    });
    this.update(0);
  }
  carPos(i) {
    const w = this.game.world;
    const s = this.s - this.dirSign * i * this.carLen;
    return w.corridorPoint(s);
  }
  center() {
    return this.carPos(0).add(new THREE.Vector3(0, 1.6, 0));
  }
  update(dt) {
    if (this.dead) return;
    const w = this.game.world;
    this.s += this.dirSign * this.speed * dt;
    const p = w.corridorPoint(this.s);
    this.mesh.position.set(p.x, p.y - 0.02, p.z);
    const c = w.corridor;
    this.mesh.rotation.y = Math.atan2(c.dir.x, c.dir.y) + (this.dirSign > 0 ? 0 : Math.PI);
    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) for (const m of this.mats) m.emissive.copy(m.userData.emis0 || BLACK);
    }
    if (Math.abs(this.s) > w.corridorHalf + 14 + this.cars * this.carLen) this.gone = true;
  }
  takeDamage(dmg, impact, from, at) {
    if (this.dead) return;
    this.hp -= Math.round(dmg);
    this.flashT = 0.06;
    for (const m of this.mats) {
      m.emissive.setRGB(0.8, 0.8, 0.8);
    }
    const g = this.game;
    g.popDamage(at || this.center(), Math.round(dmg), false, false, false, 0, -1, impact);
    if (this.hp <= 0) this.die();
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    const g = this.game;
    const c = this.center();
    g.fx.explosion(c, 5, 0xffa040, true);
    SFX.explode(true, c);
    g.rumbleAt(c, 0.8, 0.5, 300, 40);
    g.netEv({ t: 'vehDie', i: this.id }); // 殘骸：每節車廂碎裂，留在原地、不擋路
    for (let i = 0; i < this.cars; i++) {
      const cp = this.carPos(i);
      setTimeout(() => {
        if (g.fx) g.fx.explosion(cp.clone().add(new THREE.Vector3(0, 1.5, 0)), 3, 0xff7030, false);
      }, i * 120);
      const pkt = this.kind === 'truck' || Math.random() < 0.6;
      if (pkt && g.net.role !== 'client') {
        const kinds = ['repair', 'repair', 'cs_bomber', 'cs_ally'];
        const n = this.kind === 'truck' ? rndi(1, 2) : 1;
        for (let k = 0; k < n; k++)
          g.spawnPickup(pick(kinds), cp.clone().add(new THREE.Vector3(rnd(-3, 3), 0.6, rnd(-3, 3))));
      }
    }
    g.fx.shatterVehicle(this);
    this.mesh.visible = false;
  }
  cleanup() {
    this.game.scene.remove(this.mesh);
  }
}
// ---------- 掉落物 ----------
export class Pickup {
  constructor(game, kind, pos, id) {
    this.game = game;
    this.kind = kind;
    this.id = id || PICK_ID++;
    this.pos = pos.clone();
    this.life = 40;
    this.dead = false;
    const g = buildPickupMesh(PICKUP_DEFS[kind].color, kind);
    g.position.copy(this.pos);
    game.scene.add(g);
    this.mesh = g;
    this.t = 0;
  }
  update(dt) {
    this.t += dt;
    this.life -= dt;
    this.mesh.position.y = this.pos.y + 0.4 + Math.sin(this.t * 3) * 0.2;
    this.mesh.rotation.y += dt * 1.5;
    if (this.life < 5) this.mesh.visible = Math.floor(this.t * 8) % 2 === 0;
    if (this.life <= 0) this.remove();
  }
  remove() {
    if (this.dead) return;
    this.dead = true;
    this.game.scene.remove(this.mesh);
  }
}
