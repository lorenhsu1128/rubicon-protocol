// Game：特殊一般敵人的場上物件與判定（實體行為在 entities/mech-special.js）
// 迫擊砲彈（落點預警圈）、地雷、護盾產生器與盾牌 MT 擋子彈／雷射、運輸機投放。
// 傷害只在房主／單機計算；客機收到 'warn'（預警圈）、'mine'／'mineX'（地雷出現／消失）事件只做顯示。
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Projectile } from '../entities/projectile.js';
import { Game } from './game.js';

const MORTAR_G = 26; // 迫擊砲彈重力（和榴彈相同）
const MINE_TRIG = 2.2; // 地雷觸發的水平距離
const MINE_ALT = 1.5; // 離地高於這個高度不會觸發（跳過去）
const AIR_TRIG = 3; // 空中地雷的觸發距離（3D）

Object.assign(Game.prototype, {
  // flashMsg／flashAlert 本身就會轉送給客機
  msgAll(txt, c) {
    this.flashMsg(txt, c, 1.8);
  },
  alertAll(txt) {
    this.flashAlert(txt);
  },
  // 罩住 e 的友方護盾產生器（e 在護盾裡）
  domeCovering(e) {
    if (!this.enemies) return null;
    const c = e.center();
    for (const g of [...this.enemies, ...this.allies]) {
      if (g.team === e.team && g.domeUp() && g.insideDome(c)) return g;
    }
    return null;
  },
  // 投射物被護盾或盾牌擋下 → true（已處理命中）；也負責射爆路徑上的地雷
  projBlock(p, prev) {
    if (this.mines && this.mines.length) this.mineShot(p, prev);
    const team = p.team;
    for (const e of [...this.enemies, ...this.allies]) {
      if (e.dead || e.team === team || (p.owner && !this.isHostile(p.owner, e))) continue;
      if (e.domeUp()) {
        // 從外面穿進球面
        const R = e.domeRadius();
        if (prev.distanceTo(e.pos) >= R && e.insideDome(p.pos)) {
          const q = this.sphereEntry(prev, p.pos, e.pos, R) || p.pos.clone();
          p.pos.copy(q);
          e.domeAbsorb(p.dmg, q);
          p.dead = true;
          this.scene.remove(p.mesh);
          if (p.netId) this.netEv({ t: 'pend', i: p.netId });
          if (p.splash > 0) {
            this.fx.explosion(q, p.splash * 0.6, 0x80d0ff, false);
            SFX.explode(false, q);
          }
          return true;
        }
      } else if (e.ai === 'shield' && e.guardUp()) {
        const hit = this.shieldHit(e, prev, p.pos);
        if (hit) {
          p.pos.copy(hit);
          p.impact(e);
          return true;
        }
      }
    }
    return false;
  },
  // 線段 a→b 從外面進入球（中心 c、半徑 R）的交點
  sphereEntry(a, b, c, R) {
    const d = b.clone().sub(a);
    const L = d.length();
    if (L < 1e-6) return null;
    d.divideScalar(L);
    const m = a.clone().sub(c);
    const bq = m.dot(d),
      cq = m.lengthSq() - R * R;
    const disc = bq * bq - cq;
    if (disc < 0) return null;
    const t = -bq - Math.sqrt(disc);
    if (t < 0 || t > L) return null;
    return a.clone().addScaledVector(d, t);
  },
  // 盾牌 MT 的盾面（機體前方 1.25 m 的直立平面）：線段 a→b 從正面穿過時回傳交點
  shieldHit(e, a, b) {
    const fwd = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
    const c = e.pos.clone().addScaledVector(fwd, 1.25 * e.scale);
    c.y += e.model.height * 0.5;
    const s0 = a.clone().sub(c).dot(fwd),
      s1 = b.clone().sub(c).dot(fwd);
    if (!(s0 > 0 && s1 <= 0)) return null;
    const q = a.clone().lerp(b, s0 / (s0 - s1));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const off = q.clone().sub(c);
    if (Math.abs(off.dot(right)) > 1.1 * e.scale || Math.abs(off.y) > 1.4 * e.scale) return null;
    return q;
  },
  // 雷射／電磁槍：光束被護盾或盾牌擋住時回傳縮短的距離（並讓護盾吸收、盾牌 MT 受到減免後的傷害）
  beamStop(owner, from, dir, stop, dmg, imp, wid, noHit) {
    let best = stop,
      hitEnt = null,
      kind = null;
    const far = from.clone().addScaledVector(dir, stop);
    for (const e of [...this.enemies, ...this.allies]) {
      if (e.dead || !this.isHostile(owner, e)) continue;
      if (e.domeUp() && !e.insideDome(from)) {
        const q = this.sphereEntry(from, far, e.pos, e.domeRadius());
        if (q) {
          const t = q.distanceTo(from);
          if (t < best) {
            best = t;
            hitEnt = e;
            kind = 'dome';
          }
        }
      } else if (e.ai === 'shield' && e.guardUp()) {
        const q = this.shieldHit(e, from, far);
        if (q) {
          const t = q.distanceTo(from);
          if (t < best) {
            best = t;
            hitEnt = e;
            kind = 'shield';
          }
        }
      }
    }
    if (hitEnt) {
      const q = from.clone().addScaledVector(dir, best);
      if (kind === 'dome') hitEnt.domeAbsorb(dmg, q);
      else if (!noHit) hitEnt.takeDamage(dmg, imp, owner, q, dir.clone(), undefined, wid);
      else this.fx.spark(q, 0xffd080);
    }
    return best;
  },
  // 迫擊砲：高拋到 tp 的地面，飛行期間地面顯示預警圈
  mortarShot(src, tp, o) {
    const w = this.world;
    const mz = src.muzzle('rback');
    const land = tp.clone();
    land.y = w.groundAt(land.x, land.z, tp.y + 1.5);
    const T = clamp(1.5 + mz.distanceTo(land) / 60, 1.6, 2.8);
    const v = land.clone().sub(mz).divideScalar(T);
    v.y = (land.y - mz.y + 0.5 * MORTAR_G * T * T) / T;
    this.projectiles.push(
      new Projectile(this, {
        pos: mz.clone(),
        vel: v,
        kind: 'grenade',
        dmg: o.dmg,
        impactV: o.im,
        team: src.team,
        owner: src,
        color: 0xff8040,
        life: T + 1.2,
        splash: o.R,
        gravity: MORTAR_G,
        wid: 'bw_gr',
      }),
    );
    this.fx.muzzle(mz, new THREE.Vector3(0, 1, 0), 0xff8040, 2.2);
    this.fx.smoke(mz.clone(), 1.2, 0x9a9ea6, 0.9, 3);
    SFX.shot('grenade', undefined, mz);
    this.fx.warnCircle(land, o.R, T);
    this.netEv({ t: 'warn', p: land.toArray().map((x) => +x.toFixed(2)), R: o.R, dl: T });
  },
  // ----- 地雷 -----
  minesOf(src) {
    return (this.mines || []).filter((m) => m.owner === src).length;
  },
  layMine(src, p, o) {
    if (!this.mines) this.mines = [];
    if (!o.air) p.y = this.world.groundAt(p.x, p.z, p.y + 1.5);
    this.mineSeq = (this.mineSeq || 0) + 1;
    const m = { i: this.mineSeq, p, owner: src, team: src.team, arm: 0.8, life: 30, trig: -1, t: 0, ...o };
    m.mesh = this.mineMesh(p, o.air);
    this.mines.push(m);
    if (!o.quiet) {
      this.fx.beam(src.center(), p.clone().setY(p.y + 0.2), 0xff4030, 0.05);
      this.fx.dust(p.clone(), 1.2, 5);
      SFX.play('ui2', 0.5, 1.6, 0.05, 0.05, p);
    }
    this.netEv({
      t: 'mine',
      i: m.i,
      p: p.toArray().map((x) => +x.toFixed(2)),
      o: { dmg: o.dmg, im: o.im, R: o.R, air: o.air ? 1 : 0 },
    });
  },
  mineMesh(p, air) {
    const grp = new THREE.Group();
    if (air) {
      // 空中地雷：懸浮的發光球＋外圈
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(0.35, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, blending: THREE.AdditiveBlending }),
      );
      const shell = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.6, 0),
        new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.5, metalness: 0.6, wireframe: true }),
      );
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(AIR_TRIG, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0xff3020,
          transparent: true,
          opacity: 0.12,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      grp.add(core, shell, halo);
      grp.position.copy(p);
      grp.userData.light = core;
      grp.userData.halo = halo;
      this.scene.add(grp);
      return grp;
    }
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.55, 0.22, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a3e38, roughness: 0.7, metalness: 0.4 }),
    );
    body.position.y = 0.11;
    const light = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0xff2a20, transparent: true, blending: THREE.AdditiveBlending }),
    );
    light.position.y = 0.26;
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(MINE_TRIG - 0.1, MINE_TRIG, 28),
      new THREE.MeshBasicMaterial({
        color: 0xff3020,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.06;
    grp.add(body, light, halo);
    grp.position.copy(p);
    grp.userData.light = light;
    grp.userData.halo = halo;
    this.scene.add(grp);
    return grp;
  },
  // 擁有者（砲兵陣地）被擊破：它布下的地雷全部失效
  removeMinesOf(owner) {
    for (let k = (this.mines || []).length - 1; k >= 0; k--)
      if (this.mines[k].owner === owner) this.removeMine(k, false);
  },
  removeMine(k, boom) {
    const m = this.mines[k];
    this.mines.splice(k, 1);
    this.scene.remove(m.mesh);
    if (boom) {
      const p = m.p.clone().setY(m.p.y + 0.3);
      this.blastTeam(p, m.dmg, m.im, m.R, m.team, m.owner);
    }
    this.netEv({ t: 'mineX', i: m.i, b: boom ? 1 : 0 });
  },
  // 只傷害 team 的敵人的爆炸（地雷：不會炸到自己人；擁有者已被擊破也照樣）
  blastTeam(p, dmg, impact, splash, team, owner) {
    this.fx.explosion(p, splash * 0.9, 0xffa040, splash > 4);
    SFX.explode(splash > 4, p);
    const src = owner && !owner.dead ? owner : null;
    const targets = (src ? this.hostilesOfEnt(src) : this.hostilesOf(team, null)).concat(
      this.destructibles(),
    );
    for (const t of targets) {
      if (!t || t.dead) continue;
      const d = t.center().distanceTo(p) - t.radius;
      if (d >= splash) continue;
      const k = clamp(1 - (d / splash) * 0.5, 0.4, 1) * this.groundBlastK(t, p);
      if (t.isProp) this.damageProp(t, dmg * k, impact * k, p);
      else t.takeDamage(dmg * k, impact * k, owner, p, t.center().sub(p).normalize());
    }
  },
  // 子彈路徑經過未觸發的地雷 → 引爆
  mineShot(p, prev) {
    const seg = p.pos.clone().sub(prev);
    const L2 = seg.lengthSq();
    for (const m of this.mines) {
      if (m.trig >= 0 || m.vis || m.team === p.team) continue;
      const c = m.air ? m.p.clone() : m.p.clone().setY(m.p.y + 0.2);
      const t = L2 > 1e-6 ? clamp(c.clone().sub(prev).dot(seg) / L2, 0, 1) : 0;
      if (prev.clone().addScaledVector(seg, t).distanceToSquared(c) < 0.9 * 0.9) m.trig = 0.05;
    }
  },
  // 每格：地雷（房主判定觸發；客機只閃燈）
  updateSupport(dt) {
    if (!this.mines || !this.mines.length) return;
    const host = !(this.net && this.net.role === 'client');
    const w = this.world;
    for (let k = this.mines.length - 1; k >= 0; k--) {
      const m = this.mines[k];
      m.t += dt;
      const L = m.mesh.userData.light;
      const fast = m.trig >= 0;
      L.material.opacity = Math.sin(m.t * (fast ? 40 : 6)) > 0 ? 1 : 0.15;
      m.mesh.userData.halo.material.opacity = fast ? 0.6 : 0.18 + 0.08 * Math.sin(m.t * 3);
      if (!host || m.vis) continue;
      m.life -= dt;
      m.arm -= dt;
      if (m.trig >= 0) {
        m.trig -= dt;
        if (m.trig <= 0) this.removeMine(k, true);
        continue;
      }
      if (m.life <= 0) {
        this.removeMine(k, false);
        continue;
      }
      if (m.arm > 0) continue;
      const src = m.owner && !m.owner.dead ? m.owner : null;
      for (const t of src ? this.hostilesOfEnt(src) : this.hostilesOf(m.team, null)) {
        if (m.air) {
          if (!t || t.dead || t.isProp || !t.pos || t.center().distanceTo(m.p) > AIR_TRIG + t.radius * 0.5)
            continue;
          m.trig = 0.15;
          SFX.play('ui2', 0.9, 2.2, 0, 0, m.p);
          break;
        }
        if (!t || t.dead || t.flying || t.isProp || !t.pos) continue;
        if (Math.hypot(t.pos.x - m.p.x, t.pos.z - m.p.z) > MINE_TRIG + t.radius * 0.4) continue;
        if (t.pos.y - w.groundAt(t.pos.x, t.pos.z, t.pos.y) > MINE_ALT) continue;
        m.trig = 0.3;
        SFX.play('ui2', 0.9, 2.2, 0, 0, m.p);
        break;
      }
    }
  },
  // 運輸機投放：在機身下方生成載貨（從空中落下）
  dropCargo(ship) {
    const list = (ship.opts && ship.opts.cargo) || ['mt', 'mt'];
    const sh = this.scaleHp || 1,
      sd = this.scaleDmg || 1;
    list.forEach((t, i) => {
      const a = (i / list.length) * Math.PI * 2;
      const at = ship.pos.clone().add(new THREE.Vector3(Math.cos(a) * 3, -2, Math.sin(a) * 3));
      this.spawnType(t, sh, sd, at, 1);
    });
    this.fx.smoke(ship.pos.clone().setY(ship.pos.y - 2), 2, 0x9a9ea6, 1, 2);
    SFX.play('door', 0.9, 0.8, 0.05, 0.03, ship.pos);
    this.alertAll(`運輸機投放 — 敵機 ×${list.length}`);
  },
  // 客機：顯示用事件
  supportEvent(e) {
    switch (e.t) {
      case 'warn':
        this.fx.warnCircle(new THREE.Vector3(e.p[0], e.p[1], e.p[2]), e.R, e.dl, e.c);
        return true;
      case 'mine': {
        if (!this.mines) this.mines = [];
        const p = new THREE.Vector3(e.p[0], e.p[1], e.p[2]);
        const m = { i: e.i, p, vis: true, team: 'enemy', trig: -1, t: 0, arm: 0, life: 30, ...e.o };
        m.mesh = this.mineMesh(p, e.o && e.o.air);
        this.mines.push(m);
        return true;
      }
      case 'mineX': {
        const k = (this.mines || []).findIndex((m) => m.i === e.i);
        if (k < 0) return true;
        const m = this.mines[k];
        this.mines.splice(k, 1);
        this.scene.remove(m.mesh);
        if (e.b) {
          const p = m.p.clone().setY(m.p.y + 0.3);
          this.fx.explosion(p, m.R * 0.9, 0xffa040, m.R > 4);
          SFX.explode(m.R > 4, p);
        }
        return true;
      }
    }
    return false;
  },
  // 房主遷移：客機上的地雷改由自己判定
  promoteSupport() {
    for (const m of this.mines || []) {
      m.vis = false;
      m.owner = null;
      m.arm = 0;
      m.life = Math.min(m.life, 20);
    }
    this.mineSeq = Math.max(this.mineSeq || 0, ...(this.mines || []).map((m) => m.i), 0);
  },
  clearSupport() {
    for (const m of this.mines || []) this.scene.remove(m.mesh);
    this.mines = [];
  },
});
