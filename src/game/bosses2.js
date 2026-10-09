// Game：第三批 Boss 的生成與場上判定（行為在 entities/mech-boss2.js）
// 延遲事件（later）、燃燒的地面（熔渣）、擴散的能量環（脈衝刃翼）、光束攻擊（電磁砲、浮游砲、舷砲、雷射扇形）、
// 光學迷彩電戰機的分身、三機合體的分離。傷害只在房主／單機計算；特效經由 fx 鏡像（render-setup.js）轉送給客機。
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { asmStats } from '../data/parts.js';
import { Game } from './game.js';

const CAR_SP = 9.6;
const CARS = ['car_aa', 'car_ms', 'car_lz', 'car_mine'];
// 三機合體分離後的三台：AP 依比例分配
const TRINITY_SUBS = [
  {
    name: 'CERBERUS-α',
    share: 0.4,
    ai: 'rusher',
    scale: 1.35,
    speedMul: 1.25,
    wantDist: 6,
    asm: {
      head: 'h_lt',
      core: 'c_lt',
      arms: 'a_ml',
      legs: 'l_rj',
      booster: 'b_hi',
      generator: 'g_fast',
      fcs: 'f_near',
      rarm: 'w_saber',
      larm: 'w_sg',
      rback: 'bw_none',
      lback: 'bw_none',
    },
  },
  {
    name: 'CERBERUS-β',
    share: 0.35,
    ai: 'sniper',
    scale: 1.3,
    speedMul: 1,
    wantDist: 42,
    asm: {
      head: 'h_scan',
      core: 'c_std',
      arms: 'a_std',
      legs: 'l_bp2',
      booster: 'b_std',
      generator: 'g_hi',
      fcs: 'f_far',
      rarm: 'w_lc',
      larm: 'w_rifle',
      rback: 'bw_none',
      lback: 'bw_none',
    },
  },
  { name: 'CERBERUS-γ', share: 0.25, repair: true },
];

Object.assign(Game.prototype, {
  // spawnBossKind 生成本體後的設定（第三批 Boss）
  spawnBoss2(bd, b) {
    const w = this.world;
    switch (bd.kind) {
      case 'railgun': {
        // 放在離玩家最遠的角落附近
        let best = null,
          bd2 = -1;
        for (const [x, z] of [
          [-46 * w.k, -46 * w.k],
          [46 * w.k, -46 * w.k],
          [-46 * w.k, 46 * w.k],
          [46 * w.k, 46 * w.k],
        ]) {
          if (w.onCorridor(x, z, 4)) continue;
          const dd = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
          if (dd > bd2) {
            bd2 = dd;
            best = [x, z];
          }
        }
        if (best) {
          const [x, z] = w.collide(best[0], best[1], 0, 5);
          b.pos.set(x, w.terrainHeight(x, z), z);
          b.mesh.position.copy(b.pos);
        }
        break;
      }
      case 'train': {
        const c = w.corridor;
        if (!c) break;
        const s0 = -w.trackS - 8;
        b.pos.copy(w.corridorPoint(s0));
        b.mesh.position.copy(b.pos);
        b.aiState.ts = s0;
        b.aiState.td = 1;
        CARS.forEach((k, i) => this.spawnPart(b, k, { at: w.corridorPoint(s0 - (i + 1) * CAR_SP) }));
        break;
      }
      case 'orbital': {
        const [x, z] = w.collide(
          clamp(b.pos.x, -40 * w.k, 40 * w.k),
          clamp(b.pos.z, -40 * w.k, 40 * w.k),
          0,
          5,
        );
        b.pos.set(x, w.terrainHeight(x, z), z);
        b.mesh.position.copy(b.pos);
        break;
      }
    }
  },
  // ----- 延遲事件（房主／單機）-----
  later(sec, fn) {
    if (!this.hzLater) this.hzLater = [];
    this.hzLater.push({ t: sec, fn });
  },
  // 射線 a→b 沒有被地形或障礙物擋住
  losClear(a, b) {
    const w = this.world;
    const d = a.distanceTo(b);
    if (d < 2) return true;
    const dir = b.clone().sub(a).divideScalar(d);
    const p = new THREE.Vector3();
    for (let s = 2; s < d - 1.5; s += 1) {
      p.copy(a).addScaledVector(dir, s);
      if (w.hitsWorld(p)) return false;
    }
    return true;
  },
  // 光束攻擊：from 沿 dir，地形／障礙物與護盾會擋住；o：{ range, dmg, im, w 判定半徑, color, width, pierce }
  beamAttack(owner, from, dir, o) {
    const w = this.world;
    let stop = o.range;
    const p = new THREE.Vector3();
    for (let s = 1; s < stop; s += 1) {
      p.copy(from).addScaledVector(dir, s);
      if (w.hitsWorld(p)) {
        stop = s;
        break;
      }
    }
    stop = this.beamStop(owner, from, dir, stop, o.dmg, o.im);
    const hits = [];
    for (const t of this.hostilesOfEnt(owner).concat(this.destructibles())) {
      if (!t || t.dead) continue;
      const ap = t.center().sub(from);
      const proj = ap.dot(dir);
      if (proj < 0 || proj > stop) continue;
      if (ap.clone().addScaledVector(dir, -proj).length() < t.radius + (o.w || 0.6)) hits.push({ t, proj });
    }
    hits.sort((a, b) => a.proj - b.proj);
    for (const h of o.pierce === false ? hits.slice(0, 1) : hits) {
      const pt = from.clone().addScaledVector(dir, h.proj);
      if (h.t.isProp) this.damageProp(h.t, o.dmg, o.im, pt);
      else h.t.takeDamage(o.dmg, o.im, owner, pt, dir.clone());
      this.fx.spark(pt, o.color, dir);
      if (o.pierce === false) stop = h.proj;
    }
    const end = from.clone().addScaledVector(dir, stop);
    this.fx.beam(from, end, o.color, o.width || 0.15);
    if (stop < o.range && !hits.length) this.fx.spark(end, 0xffffff);
    return stop;
  },
  // ----- 燃燒的地面：站在裡面（離地 1.2 m 以下）每 0.25 秒受傷 -----
  addPool(owner, p, R, life, dps) {
    if (!this.hzPools) this.hzPools = [];
    const q = p.clone();
    q.y = this.world.groundAt(q.x, q.z, q.y + 2);
    this.hzPools.push({ p: q, R, life, dps, owner, tick: 0 });
    this.fx.firePool(q, R, life);
  },
  // 熔渣：高拋到落點（預警圈），落地爆炸並留下燃燒的地面
  slagShot(src, tp, o) {
    const land = tp.clone();
    land.y = this.world.groundAt(land.x, land.z, tp.y + 1.5);
    this.mortarShot(src, land, { dmg: o.dmg, im: o.im, R: o.R });
    const mz = src.muzzle('rback');
    const T = clamp(1.5 + mz.distanceTo(land) / 60, 1.6, 2.8);
    this.later(T, () => this.addPool(src, land, o.poolR, o.life, o.dps));
  },
  // ----- 擴散的能量環：波面掃過的目標受傷（QB 的無敵時間可以穿過）-----
  pulseRing(src, o) {
    if (!this.hzRings) this.hzRings = [];
    const c = src.center();
    this.hzRings.push({ ...o, c, r: 0, owner: src, hit: new Set() });
    this.fx.pulseShell(c, o.R, o.sp, 0xff5070);
    SFX.play('laserBig', 0.8, 1.4, 0.05, 0.05, c);
  },
  updateHazards(dt) {
    if (this.hzLater && this.hzLater.length) {
      const due = [];
      for (let i = this.hzLater.length - 1; i >= 0; i--) {
        const e = this.hzLater[i];
        e.t -= dt;
        if (e.t <= 0) {
          this.hzLater.splice(i, 1);
          due.push(e);
        }
      }
      for (const e of due.reverse()) e.fn();
    }
    const w = this.world;
    if (this.hzPools && this.hzPools.length) {
      for (let i = this.hzPools.length - 1; i >= 0; i--) {
        const P = this.hzPools[i];
        P.life -= dt;
        if (P.life <= 0) {
          this.hzPools.splice(i, 1);
          continue;
        }
        P.tick -= dt;
        if (P.tick > 0) continue;
        P.tick = 0.25;
        const src = P.owner && !P.owner.dead ? P.owner : null;
        for (const t of src ? this.hostilesOfEnt(src) : this.hostilesOf('enemy', null)) {
          if (!t || t.dead || t.isProp || !t.pos) continue;
          if (Math.hypot(t.pos.x - P.p.x, t.pos.z - P.p.z) > P.R + t.radius * 0.4) continue;
          if (t.pos.y - w.groundAt(t.pos.x, t.pos.z, t.pos.y) > 1.2) continue;
          t.takeDamage(P.dps * 0.25, 40, P.owner, t.center(), null);
        }
      }
    }
    if (this.hzRings && this.hzRings.length) {
      for (let i = this.hzRings.length - 1; i >= 0; i--) {
        const R = this.hzRings[i];
        R.r += R.sp * dt;
        if (R.r > R.R) {
          this.hzRings.splice(i, 1);
          continue;
        }
        const src = R.owner && !R.owner.dead ? R.owner : null;
        for (const t of src ? this.hostilesOfEnt(src) : this.hostilesOf('enemy', null)) {
          if (!t || t.dead || t.isProp || !t.pos || R.hit.has(t)) continue;
          const dd = t.center().distanceTo(R.c);
          if (Math.abs(dd - R.r) > R.band / 2 + t.radius * 0.6) continue;
          R.hit.add(t);
          t.takeDamage(R.dmg, R.im, R.owner, t.center(), t.center().sub(R.c).normalize());
        }
      }
    }
  },
  clearHazards() {
    this.hzLater = [];
    this.hzPools = [];
    this.hzRings = [];
  },
  // ----- 光學迷彩電戰機的分身（同樣的機體，很脆弱；打中會引爆小型電磁脈衝）-----
  spawnHolos(boss, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const at = boss.pos.clone().add(new THREE.Vector3(Math.cos(a) * 6, 0, Math.sin(a) * 6));
      const [x, z] = this.world.collide(at.x, at.z, at.y, 2);
      at.set(x, this.world.groundAt(x, z, at.y + 2), z);
      const h = this.spawnEnemy({
        name: boss.name,
        asm: boss.asm,
        pal: boss.palKey || 'phantom',
        scale: boss.scale,
        hpMul: 0.02,
        dmgMul: boss.dmgMul * 0.12,
        stabMul: 1,
        ai: 'holo',
        partKind: 'holo',
        parent: boss.id,
        wantDist: 18,
        speedMul: 1.3,
        at,
      });
      h.kits = 0;
      this.fx.flash(h.center(), 3, 0x60fff0, 0.25);
    }
  },
  // ----- 三機合體：分離成三台（AP 依比例分配，本體藏起來）-----
  trinitySplit(boss) {
    const total = Math.max(1, boss.hp);
    const rep = ENEMY_TYPES.repair;
    boss.aiState.lastKiller = null;
    for (const D of TRINITY_SUBS) {
      const a = Math.random() * Math.PI * 2;
      const at = boss.pos.clone().add(new THREE.Vector3(Math.cos(a) * 5, D.repair ? 5 : 0, Math.sin(a) * 5));
      const [x, z] = this.world.collide(at.x, at.z, at.y, 2);
      at.set(x, Math.max(at.y, this.world.groundAt(x, z, at.y + 2)), z);
      const asm = D.repair ? rep.gen() : D.asm;
      const hp = total * D.share;
      const e = this.spawnEnemy({
        name: D.name,
        asm,
        pal: D.repair ? rep.pal : boss.palKey || 'trinity',
        scale: D.repair ? 1.1 : D.scale,
        hpMul: hp / Math.max(1, asmStats(asm).ap),
        dmgMul: boss.dmgMul * 1.1,
        stabMul: 1.6,
        ai: D.repair ? 'repair' : D.ai,
        flying: !!D.repair,
        hoverH: D.repair ? rep.hoverH : undefined,
        modelKind: D.repair ? rep.modelKind : undefined,
        vehKey: D.repair ? rep.vehKey : undefined,
        radius: D.repair ? rep.radius : undefined,
        wantDist: D.repair ? rep.wantDist : D.wantDist,
        speedMul: D.repair ? rep.speedMul : D.speedMul,
        partKind: 'sub',
        parent: boss.id,
        at,
      });
      e.kits = 0;
      this.fx.ring(e.center(), 5, 0xff7040);
    }
    this.fx.explosion(boss.center(), 6, 0xff7040, true);
    this.camShake = Math.max(this.camShake, 0.35);
    this.alertAll('CERBERUS 分離 — 30 秒內全部擊破，否則重新合體！');
  },
});
