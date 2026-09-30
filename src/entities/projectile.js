// ============================================================
//  PROJECTILES
// ============================================================
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';

const ProjGeo = new THREE.BoxGeometry(0.16, 0.16, 0.9),
  MissileGeo = new THREE.ConeGeometry(0.18, 0.8, 6),
  ShellGeo = new THREE.SphereGeometry(0.28, 6, 5);
export class Projectile {
  constructor(game, o) {
    Object.assign(this, { life: 3, splash: 0, gravity: 0, target: null, turn: 0, dead: false, trailT: 0 }, o);
    this.game = game;
    const geo =
      o.kind === 'missile' ? MissileGeo : o.kind === 'shell' || o.kind === 'grenade' ? ShellGeo : ProjGeo;
    const col = o.color || 0xffe0a0;
    if (o.kind === 'bullet') {
      this.mesh = new THREE.Group();
      const L = clamp(this.vel.length() * 0.009, 0.9, 2.0);
      const core = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xfff2c8,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      core.scale.set(0.4, 0.4, L);
      const halo = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.scale.set(1.3, 1.3, L * 1.1);
      this.mesh.add(core);
      this.mesh.add(halo);
    } else if (o.kind === 'missile') {
      this.mesh = new THREE.Group();
      const body = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.6, roughness: 0.4 }),
      );
      const fl = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 6, 5),
        new THREE.MeshBasicMaterial({
          color: 0xffb060,
          transparent: true,
          opacity: 0.9,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      fl.position.y = -0.5;
      this.mesh.add(body);
      this.mesh.add(fl);
    } else {
      this.mesh = new THREE.Group();
      const b = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const h = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: col,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      h.scale.setScalar(2.2);
      this.mesh.add(b);
      this.mesh.add(h);
    }
    this.mesh.position.copy(this.pos);
    game.scene.add(this.mesh);
    this.orient();
    if (game.net && game.net.role === 'host' && !this.visual) {
      this.netId = ++game.projSeq;
      game.netEv({
        t: 'proj',
        i: this.netId,
        p: [+this.pos.x.toFixed(2), +this.pos.y.toFixed(2), +this.pos.z.toFixed(2)],
        v: [+this.vel.x.toFixed(2), +this.vel.y.toFixed(2), +this.vel.z.toFixed(2)],
        k: this.kind,
        tm: this.team,
        c: col,
        l: +this.life.toFixed(2),
        s: this.splash,
        g: this.gravity,
        tg: this.target ? this.target.id : -1,
        tn: this.turn,
      });
    }
  }
  orient() {
    const v = this.vel;
    if (v.lengthSq() > 0.01) {
      this.mesh.lookAt(this.pos.x + v.x, this.pos.y + v.y, this.pos.z + v.z);
      if (this.kind === 'missile') this.mesh.rotateX(Math.PI / 2);
    }
  }
  update(dt) {
    const g = this.game;
    this.age = (this.age || 0) + dt;
    if (this.kind === 'missile' && this.target && !this.target.dead) {
      const tc = this.target.center();
      const d0 = tc.distanceTo(this.pos);
      const tt = clamp(d0 / Math.max(1, this.vel.length()), 0, 1.2);
      const to = tc.addScaledVector(this.target.vel, tt * 0.8).sub(this.pos);
      const d = to.length();
      to.normalize();
      const sp = this.vel.length();
      const cur = this.vel.clone().normalize();
      const ang = cur.angleTo(to);
      const maxA = this.turn * dt * (d < 10 ? 2.2 : this.age > 0.5 ? 1.4 : 1);
      if (ang > maxA) {
        const axis = cur.clone().cross(to).normalize();
        if (axis.lengthSq() > 0.5) cur.applyAxisAngle(axis, maxA);
      } else cur.copy(to);
      this.vel.copy(cur.multiplyScalar(sp));
    }
    if (this.gravity) this.vel.y -= this.gravity * dt;
    const prev = this.pos.clone();
    this.pos.addScaledVector(this.vel, dt);
    this.life -= dt;
    this.mesh.position.copy(this.pos);
    this.orient();
    if (this.visual) {
      if (this.life <= 0) {
        this.dead = true;
        g.scene.remove(this.mesh);
      }
      if (this.kind === 'missile' || this.kind === 'shell' || this.kind === 'grenade') {
        this.trailT += dt;
        if (this.trailT > 0.045) {
          this.trailT = 0;
          g.fx.smoke(this.pos.clone(), this.kind === 'missile' ? 0.45 : 0.7, 0x8a8f96, 0.7, 1.2);
          if (this.kind !== 'grenade')
            g.fx.boostFlame(this.pos.clone(), this.vel.clone().normalize().negate(), 0xffb060);
        }
      }
      return;
    }
    if (this.kind === 'missile' || this.kind === 'shell' || this.kind === 'grenade') {
      this.trailT += dt;
      if (this.trailT > 0.045) {
        this.trailT = 0;
        g.fx.smoke(this.pos.clone(), this.kind === 'missile' ? 0.45 : 0.7, 0x8a8f96, 0.7, 1.2);
        if (this.kind !== 'grenade')
          g.fx.boostFlame(this.pos.clone(), this.vel.clone().normalize().negate(), 0xffb060);
      }
    }
    // swept hits: closest point on segment prev→pos to target sphere
    const targets = (this.allTeams ? g.everyone(this.owner) : g.hostilesOf(this.team, this.owner)).concat(
      g.destructibles(),
    );
    const seg = this.pos.clone().sub(prev);
    const segL2 = seg.lengthSq();
    let best = null,
      bestT = 2;
    for (const t of targets) {
      if (t.dead) continue;
      const c = t.center();
      const r = t.radius + 0.4;
      let tt = segL2 > 1e-6 ? clamp(c.clone().sub(prev).dot(seg) / segL2, 0, 1) : 0;
      const cp = prev.clone().addScaledVector(seg, tt);
      if (cp.distanceToSquared(c) < r * r && tt < bestT) {
        best = t;
        bestT = tt;
      }
    }
    if (best) {
      this.pos.copy(prev).addScaledVector(seg, bestT);
      this.impact(best);
      return;
    }
    const mid = prev.clone().addScaledVector(seg, 0.5);
    if (g.world.hitsWorld(this.pos) || g.world.hitsWorld(mid) || this.life <= 0) {
      this.impact(null);
    }
  }
  impact(direct) {
    const g = this.game;
    this.dead = true;
    g.scene.remove(this.mesh);
    if (this.netId) g.netEv({ t: 'pend', i: this.netId });
    if (this.splash > 0) {
      g.fx.explosion(this.pos, this.splash * 0.9, 0xffa040, this.splash > 4);
      SFX.explode(this.splash > 4, this.pos);
      g.rumbleAt(
        this.pos,
        this.splash > 4 ? 0.9 : 0.5,
        0.4,
        this.splash > 4 ? 260 : 150,
        this.splash * 4 + 14,
      );
      const targets = (this.allTeams ? g.everyone(this.owner) : g.hostilesOf(this.team, this.owner)).concat(
        g.destructibles(),
      );
      for (const t of targets) {
        if (t.dead) continue;
        const d = t.center().distanceTo(this.pos) - t.radius;
        if (d < this.splash) {
          let k = clamp(1 - (d / this.splash) * 0.5, 0.4, 1);
          let im = this.impactV * k;
          if (
            t.team === 'player' &&
            this.owner &&
            this.owner.team === 'player' &&
            t !== this.owner &&
            !g.isHostile(this.owner, t)
          ) {
            k *= 0.3;
            im = 0;
          }
          if (t.isProp) g.damageProp(t, this.dmg * k, im, this.pos);
          else t.takeDamage(this.dmg * k, im, this.owner, this.pos);
        }
      }
    } else if (direct) {
      const dir = this.vel.clone().normalize();
      if (direct.isProp) g.damageProp(direct, this.dmg, this.impactV, this.pos);
      else direct.takeDamage(this.dmg, this.impactV, this.owner, this.pos, dir);
      g.fx.spark(this.pos, this.color || 0xffe0a0, dir);
      SFX.hit(direct.isPlayer ? null : this.pos);
      if (this.owner && this.owner.isPlayer && !direct.isPlayer) g.rumble(0.05, 0.25, 40);
    } else {
      g.fx.spark(this.pos, 0xfff0d0, this.vel.clone().normalize());
    }
  }
}
