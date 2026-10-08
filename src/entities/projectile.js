// ============================================================
//  PROJECTILES
// ============================================================
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { buildProjectileMesh } from '../render/extra-models.js';

export class Projectile {
  constructor(game, o) {
    Object.assign(this, { life: 3, splash: 0, gravity: 0, target: null, turn: 0, dead: false, trailT: 0 }, o);
    this.game = game;
    const col = o.color || 0xffe0a0;
    this.mesh = buildProjectileMesh(o.kind, col, this.vel.length());
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
      if (this.kind === 'missile' && !this.mesh.userData.glb) this.mesh.rotateX(Math.PI / 2);
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
    // 護盾產生器的護盾、盾牌 MT 的盾（game/support.js）；路徑經過地雷時引爆
    if (g.projBlock(this, prev)) return;
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
          let k = clamp(1 - (d / this.splash) * 0.5, 0.4, 1) * g.groundBlastK(t, this.pos);
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
          else t.takeDamage(this.dmg * k, im, this.owner, this.pos, undefined, undefined, this.wid);
        }
      }
    } else if (direct) {
      const dir = this.vel.clone().normalize();
      if (direct.isProp) g.damageProp(direct, this.dmg, this.impactV, this.pos);
      else direct.takeDamage(this.dmg, this.impactV, this.owner, this.pos, dir, undefined, this.wid);
      g.fx.spark(this.pos, this.color || 0xffe0a0, dir);
      SFX.hit(direct.isPlayer ? null : this.pos);
      if (this.owner && this.owner.isPlayer && !direct.isPlayer) g.rumble(0.05, 0.25, 40);
    } else {
      g.fx.spark(this.pos, 0xfff0d0, this.vel.clone().normalize());
    }
  }
}
