import { KIN_FALL_MIN } from '../data/attrs.js';
// ============================================================
//  PROJECTILES
// ============================================================
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { DS, MS } from '../core/scale.js';
import { buildProjectileMesh } from '../render/extra-models.js';
import { targetDist, targetSegT } from '../world/prop-hit.js';

const BEND_CONE = 0.25; // 彈道修正只修正這個角度（弧度）以內的偏差：差一點擦過的會修正，大幅閃避照樣打不中

export class Projectile {
  constructor(game, o) {
    Object.assign(this, { life: 3, splash: 0, gravity: 0, target: null, turn: 0, dead: false, trailT: 0 }, o);
    this.game = game;
    this.p0 = this.pos.clone(); // 發射點（實彈的距離衰減）
    const col = o.color || 0xffe0a0;
    // 發光的彈體用粒子批次（fx/batch.js），每顆子彈不再各自一個網格與材質
    this.mesh = buildProjectileMesh(o.kind, col, this.vel.length(), game.fx && game.fx.projPart);
    if (o.scale) this.mesh.scale.setScalar(o.scale); // 外觀的放大（誘導飛彈架的大型飛彈；客機以 proj 事件的 sc 照做）
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
        bd: this.bend ? +this.bend.toFixed(3) : undefined,
        sh: this.shootable || undefined, // 可以打掉的投射物：血量與判定半徑（game/hazards2.js）
        sr: this.shootable ? this.shotR : undefined,
        sc: this.scale || undefined,
      });
    }
    if (this.shootable) game.shotInit(this); // 代理目標（鎖定、子彈與爆炸打得到）
  }
  orient() {
    if (this.kind === 'crate') {
      this.mesh.rotation.x += 0.025; // 貨櫃：慢慢翻滾，不朝速度方向
      return;
    }
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
      const maxA = this.turn * dt * (d < 10 * (g.rts ? 1 : DS) ? 2.2 : this.age > 0.5 ? 1.4 : 1);
      if (ang > maxA) {
        const axis = cur.clone().cross(to).normalize();
        if (axis.lengthSq() > 0.5) cur.applyAxisAngle(axis, maxA);
      } else cur.copy(to);
      this.vel.copy(cur.multiplyScalar(sp));
    } else if (this.bend && this.target && !this.target.dead) {
      // 彈道修正（玩家的實彈，mech-entity.js 的 fire）：每秒最多轉 bend 弧度
      const to = this.target.center().sub(this.pos).normalize();
      const sp = this.vel.length();
      const cur = this.vel.clone().divideScalar(sp);
      const ang = cur.angleTo(to);
      if (ang > 1e-4 && ang < BEND_CONE) {
        const axis = cur.clone().cross(to).normalize();
        if (axis.lengthSq() > 0.5)
          this.vel.copy(cur.applyAxisAngle(axis, Math.min(ang, this.bend * dt)).multiplyScalar(sp));
      }
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
      g.destructibles(this.team),
    );
    const seg = this.pos.clone().sub(prev);
    let best = null,
      bestT = 2;
    const pad = 0.4 + (this.hitR || 0); // hitR：玩家實彈加大的判定（對物件不加：物件用命中形狀，world/prop-hit.js）
    for (const t of targets) {
      if (t.dead) continue;
      const tt = targetSegT(t, prev, seg, pad);
      if (tt >= 0 && tt < bestT) {
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
    // 臨時障礙物受傷、爆炸點燃油漬（game/hazards2.js）
    if (!direct || this.splash > 0) g.hz2Blast(this.pos, this.dmg, this.splash, this.attr);
    if (this.splash > 0 && g.rts && g.rtsProjBlast) g.rtsProjBlast(this); // Coral 戰爭：爆發攻擊炸散殘骸（rts.js）
    if (this.splash > 0) {
      g.fx.explosion(this.pos, this.splash * 0.9, 0xffa040, this.splash > 4 * (g.rts ? 1 : MS));
      SFX.explode(this.splash > 4 * (g.rts ? 1 : MS), this.pos);
      g.rumbleAt(
        this.pos,
        this.splash > 4 ? 0.9 : 0.5,
        0.4,
        this.splash > 4 ? 260 : 150,
        this.splash * 4 + 14,
      );
      const targets = (this.allTeams ? g.everyone(this.owner) : g.hostilesOf(this.team, this.owner)).concat(
        g.destructibles(this.team),
      );
      for (const t of targets) {
        if (t.dead) continue;
        const d = targetDist(t, this.pos); // 物件以外形最近點算距離
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
          else
            t.takeDamage(
              this.dmg * k,
              im,
              this.owner,
              this.pos,
              undefined,
              undefined,
              this.wid,
              this.attr || (this.wid ? undefined : 'exp'), // 沒有武器 id 的爆炸（迫擊砲、魚雷…）算爆發
            );
        }
      }
    } else if (direct) {
      const dir = this.vel.clone().normalize();
      if (direct.isProp) g.damageProp(direct, this.dmg, this.impactV, this.pos);
      else {
        // 實彈：超過理想射程遞減（data/attrs.js）
        let fk = 1;
        if (this.fall) {
          const dd = this.pos.distanceTo(this.p0);
          if (dd > this.fall[0])
            fk =
              1 -
              (1 - KIN_FALL_MIN) *
                Math.min(1, (dd - this.fall[0]) / Math.max(1, this.fall[1] - this.fall[0]));
        }
        direct.takeDamage(
          this.dmg * fk,
          this.impactV,
          this.owner,
          this.pos,
          dir,
          undefined,
          this.wid,
          this.attr,
        );
      }
      g.fx.spark(this.pos, this.color || 0xffe0a0, dir);
      SFX.hit(direct.isPlayer ? null : this.pos, direct);
      if (this.owner && this.owner.isPlayer && !direct.isPlayer) g.rumble(0.05, 0.25, 40);
    } else {
      g.fx.spark(this.pos, 0xfff0d0, this.vel.clone().normalize());
      SFX.hitWorld(this.pos);
    }
  }
}
