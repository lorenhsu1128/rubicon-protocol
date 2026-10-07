// ============================================================
//  MECH ENTITY
// ============================================================
import { SFX } from '../audio/audio.js';
import { angLerp, clamp, lerp, rnd } from '../core/math.js';
import { AIR_DECAY, FIST_DEF, GRAVITY, JUMP_EN, asmStats, jumpSpec, partById } from '../data/parts.js';
import { applyPilotStats, pilotWeaponDef } from '../data/pilot.js';
import { animateMech, buildMech, mechFlash } from '../render/mech-model.js';
import { applyIK, ikOn, ikRestore } from '../render/mech-ik.js';
import { nozzleWorld } from '../fx/thruster.js';
import { buildDrone, buildHeli, buildVehicle } from '../render/vehicle-models.js';
import { Projectile } from './projectile.js';

let MECH_ID = 0;
export class MechEntity {
  constructor(game, asm, pal, opts = {}) {
    this.game = game;
    this.id = MECH_ID++;
    this.asm = asm;
    this.pal = pal;
    this.pm = opts.pilot || null; // 駕駛員技能加成（computePilotMods 的結果），敵人與友軍為 null
    this.stats = applyPilotStats(asmStats(asm), this.pm);
    this.opts = opts;
    this.palKey = opts.palKey || null;
    this.slot = opts.slot;
    this.downed = false;
    this.downT = 0;
    this.team = opts.team || 'enemy';
    this.isPlayer = this.team === 'player';
    this.scale = opts.scale || 1;
    this.isBoss = !!opts.isBoss;
    this.name = opts.name || 'AC';
    this.model =
      opts.modelKind === 'vehicle'
        ? buildVehicle(pal, this.scale)
        : opts.modelKind === 'heli'
          ? buildHeli(pal, this.scale, this.isBoss ? 'boss_helios' : 'heli')
          : opts.modelKind === 'drone'
            ? buildDrone(pal, this.scale)
            : this.buildRig();
    this.mesh = this.model.group;
    game.scene.add(this.mesh);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.aimYaw = 0;
    this.aimPitch = 0;
    this.maxHp = Math.round(this.stats.ap * (opts.hpMul || 1));
    this.hp = this.maxHp;
    this.dmgMul = opts.dmgMul || 1;
    this.enMax = this.stats.enCap;
    this.en = this.enMax;
    this.enDelay = 0;
    this.acsMax = this.stats.stab * (opts.stabMul || 1);
    this.acs = 0;
    this.staggerT = 0;
    this.acsDecayDelay = 0;
    this.radius = (opts.radius || 1.3) * this.scale;
    this.aiSkill = opts.aiSkill || 1;
    this.pvpAi = !!opts.pvpAi;
    this.pvpTeam = opts.pvpTeam !== undefined ? opts.pvpTeam : opts.team === 'enemy' ? -1 : 0;
    this.hoverH = opts.hoverH || 7;
    this.turnRate = opts.turnRate || 14;
    this.explodeOnDeath = opts.explodeOnDeath || null;
    this.grounded = true;
    this.hover = false;
    this.boost = false;
    this.qbT = 0;
    this.qbDir = new THREE.Vector3();
    this.abT = 0;
    this.dead = false;
    this.flying = !!opts.flying;
    this.t = Math.random() * 10;
    this.moving = false;
    this.speedMul = opts.speedMul || 1;
    this.kitsMax = 3 + this.pmv('kits');
    this.kits = this.kitsMax;
    this.kitHeal = 0.4 + this.pmv('kitHeal');
    this.dmgTaken = 0;
    this.smokeT = 0;
    this.iFrames = 0;
    this.weapons = {};
    this.initWeapons();
    this.allyT = opts.allyDur || 0;
    this.departing = false;
    this.recoil = { l: 0, r: 0 };
    this.swing = { l: 0, r: 0 };
    this.melee = {
      active: false,
      stage: 0,
      t: 0,
      queued: false,
      hit: new Set(),
      dir: new THREE.Vector3(0, 0, -1),
      target: null,
    };
    this.comboHits = 0;
    this.comboT = 0;
    this.lock = null;
    this.ai = opts.ai || null;
    this.aiState = {
      strafe: Math.random() < 0.5 ? 1 : -1,
      timer: 0,
      qbT: 0,
      jumpT: 0,
      want: opts.wantDist || 22,
      fireT: 0,
      pattern: 0,
      patT: 0,
      phase: 1,
      stuck: 0,
    };
  }
  // 機甲模型：模型組由遊戲決定（伺服器模式依玩家／敵人選伺服器預設組或玩家上傳的模型組，見 game/local-lib.js）
  buildRig() {
    const g = this.game;
    this.modelSrc = g.mechSource ? g.mechSource(this.opts) : null;
    return buildMech(this.asm, this.pal, this.scale, { source: this.modelSrc });
  }
  // 換成新的模型（客機下載完玩家的模型組後）：保留位置、可見度與已丟出的武器，只換外觀
  swapModel() {
    if (this.opts.modelKind) return;
    const g = this.game;
    const old = this.mesh;
    const vis = old.visible;
    g.scene.remove(old);
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    this.model = this.buildRig();
    this.mesh = this.model.group;
    this.mesh.position.copy(old.position);
    this.mesh.rotation.copy(old.rotation);
    this.mesh.visible = vis;
    for (const k of ['rarm', 'larm']) {
      const w = this.weapons[k];
      if (w && w.dropped) {
        const wm = this.model.arms[w.side > 0 ? 'r' : 'l'].weapon;
        for (const c of [...wm.children]) wm.remove(c);
      }
    }
    g.scene.add(this.mesh);
  }
  // 駕駛員加成值（沒有時為 0）
  pmv(k) {
    return (this.pm && this.pm[k]) || 0;
  }
  // 依組裝建立武器狀態；武器定義套用駕駛員技能與熟練度（複製的副本，不動共用資料）
  initWeapons() {
    for (const s of ['rarm', 'larm', 'rback', 'lback']) {
      let def = partById(s.endsWith('arm') ? 'arm' : 'back', this.asm[s]);
      const fist = s.endsWith('arm') && def.type === 'none' && !this.model.vehicle;
      if (fist) def = FIST_DEF; // 空手 → 拳擊
      def = pilotWeaponDef(def, this.pm);
      this.weapons[s] = {
        def,
        ammo: def.ammo || 0,
        mag: def.mag || 0,
        cd: 0,
        reloadT: 0,
        charge: 0,
        charging: false,
        side: s[0] === 'r' ? 1 : -1,
        slot: s,
        dropped: fist,
        ownerId: this.id,
      };
    }
    this.shield =
      this.weapons.rback.def.type === 'shield' || this.weapons.lback.def.type === 'shield'
        ? Math.max(this.weapons.rback.def.absorb || 0, this.weapons.lback.def.absorb || 0)
        : 0;
  }
  center() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.model.height * 0.5, this.pos.z);
  }
  muzzle(slot) {
    const w = this.weapons[slot];
    const m = slot.endsWith('arm')
      ? this.model.arms[w.side > 0 ? 'r' : 'l'].hand
      : this.model.arms[w.side > 0 ? 'r' : 'l'].back;
    const v = new THREE.Vector3();
    m.getWorldPosition(v);
    return v;
  }
  aimDirTo(target) {
    const from = this.center();
    const to = target.clone();
    return to.sub(from).normalize();
  }
  canAct() {
    return !this.dead && !this.downed && this.staggerT <= 0;
  }
  useEn(v) {
    if (this.en < v) return false;
    this.en -= v;
    this.enDelay = this.stats.parts.generator.delay;
    return true;
  }

  fire(slot, targetPos, targetEnt) {
    const w = this.weapons[slot],
      d = w.def,
      g = this.game;
    if (d.type === 'none' || d.type === 'shield') return false;
    if (!this.canAct()) return false;
    if (this.melee.active && d.type !== 'melee') return false;
    if (w.cd > 0 || w.reloadT > 0) return false;
    if (d.mag < 99 && w.mag <= 0) {
      if (w.ammo <= 0) {
        if (slot.endsWith('arm') && !w.dropped) this.dropWeapon(slot);
        return false;
      }
      w.reloadT = d.reload;
      return false;
    }
    const muzzle = this.muzzle(slot);
    const from = this.center();
    const SP = this.isPlayer ? null : muzzle;
    // 高度優勢：射手比目標高 → 擴散縮小；比目標低 → 擴散放大（每 1m 高度差 ±7%，上限 ±45%）
    let hmul = 1;
    if (targetEnt && !targetEnt.dead) {
      const dy = this.center().y - targetEnt.center().y;
      hmul = clamp(1 - dy * 0.07, 0.55, 1.45);
    }
    this.heightMul = hmul;
    const steady = this.hoverMode === 1 ? 0.5 : 1; // 懸浮（定高）時瞄準穩定
    const spread =
      (d.spread || 0) *
        (slot.endsWith('arm') ? 1.3 - this.stats.parts.arms.aim * 0.6 : 0.55) *
        hmul *
        steady +
      (hmul > 1 ? 0.015 * (hmul - 1) * 4 : 0);
    // 彈道方向：從實際槍口指向瞄準點（不是從機體中心），手部與肩部武器落點都對準準星
    const dir = targetPos.clone().sub(muzzle).normalize();
    const dmg = d.dmg * this.dmgMul,
      imp = d.impact * this.dmgMul;
    const shoot = (dirv, kind, extra) => {
      g.projectiles.push(
        new Projectile(
          g,
          Object.assign(
            {
              pos: muzzle.clone(),
              vel: dirv.clone().multiplyScalar(d.speed),
              kind,
              dmg,
              impactV: imp,
              team: this.team,
              owner: this,
              color: d.color,
              life: d.range / d.speed + 0.3,
              wid: d.id,
            },
            extra || {},
          ),
        ),
      );
    };
    const jitter = (v) => {
      const r = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(spread);
      return v.clone().add(r).normalize();
    };
    switch (d.type) {
      case 'bullet':
        shoot(jitter(dir), 'bullet');
        g.fx.muzzle(muzzle, dir, d.color || 0xffd080, slot.endsWith('back') ? 1.1 : 0.9);
        g.fx.casing(muzzle.clone().addScaledVector(dir, -1.2), w.side, dir);
        SFX.shot('bullet', d.id, SP);
        w.cd = d.rof;
        this.recoil[w.side > 0 ? 'r' : 'l'] = 0.35;
        if (this.isPlayer)
          g.rumble(
            d.id === 'w_mg' || d.id === 'bw_gat' ? 0.15 : 0.25,
            0.5,
            d.id === 'w_mg' || d.id === 'bw_gat' ? 40 : 70,
          );
        break;
      case 'shotgun':
        for (let i = 0; i < d.pellets; i++) shoot(jitter(dir), 'bullet');
        g.fx.muzzle(muzzle, dir, 0xffa050, 1.8);
        g.fx.casing(muzzle.clone().addScaledVector(dir, -1), w.side, dir);
        SFX.shot('shotgun', undefined, SP);
        w.cd = d.rof;
        this.recoil[w.side > 0 ? 'r' : 'l'] = 0.9;
        if (this.isPlayer) {
          g.camShake = Math.max(g.camShake, 0.08);
          g.rumble(0.7, 0.4, 120);
        }
        break;
      case 'shell':
        shoot(jitter(dir), 'shell', { splash: d.splash });
        g.fx.muzzle(muzzle, dir, 0xff8040, 2.4);
        g.fx.smoke(muzzle.clone().addScaledVector(dir, -1.5), 1.2, 0x9a9ea6, 0.8, 2);
        SFX.shot('shell', undefined, SP);
        w.cd = d.rof;
        this.vel.addScaledVector(dir, -5);
        this.recoil[w.side > 0 ? 'r' : 'l'] = 1.2;
        if (this.isPlayer) {
          g.camShake = Math.max(g.camShake, 0.14);
          g.rumble(1.0, 0.5, 200);
        }
        break;
      case 'grenade':
        {
          let tp = targetPos.clone();
          if (targetEnt && !targetEnt.dead) {
            let tt0 =
              Math.min(d.range, Math.max(8, targetEnt.center().sub(muzzle).setY(0).length())) / d.speed;
            tp = targetEnt.center().addScaledVector(targetEnt.vel, tt0);
            tt0 = Math.min(d.range, Math.max(8, tp.clone().sub(muzzle).setY(0).length())) / d.speed;
            tp = targetEnt.center().addScaledVector(targetEnt.vel, tt0);
          } // 依榴彈自身飛行時間預判
          const hd = tp.clone().sub(muzzle);
          hd.y = 0;
          const dist = Math.min(d.range, Math.max(8, hd.length()));
          hd.normalize();
          const tt = dist / d.speed;
          const v = hd.multiplyScalar(d.speed);
          v.y = 13 * tt + (tp.y - muzzle.y) / tt;
          g.projectiles.push(
            new Projectile(g, {
              pos: muzzle.clone(),
              vel: v,
              kind: 'grenade',
              dmg,
              impactV: imp,
              team: this.team,
              owner: this,
              color: d.color,
              life: tt + 1.5,
              splash: d.splash,
              gravity: 26,
              wid: d.id,
            }),
          );
          g.fx.muzzle(muzzle, dir, 0xff8040, 2.4);
          SFX.shot('grenade', undefined, SP);
          w.cd = d.rof;
          if (this.isPlayer) {
            g.camShake = Math.max(g.camShake, 0.12);
            g.rumble(0.8, 0.4, 180);
          }
        }
        break;
      case 'missile':
        {
          const n = d.count;
          for (let i = 0; i < n; i++) {
            const up = new THREE.Vector3(rnd(-0.6, 0.6), 1.2, rnd(-0.6, 0.6)).normalize();
            const v = up.multiplyScalar(d.speed);
            g.projectiles.push(
              new Projectile(g, {
                pos: muzzle.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 0.3, rnd(-0.3, 0.3))),
                vel: v,
                kind: 'missile',
                dmg,
                impactV: imp,
                team: this.team,
                owner: this,
                color: 0xffb3b3,
                life: d.range / d.speed + 1.5,
                target: targetEnt,
                turn: (d.turn * 1.4 * (this.stats.parts.fcs.id === 'f_near' ? 1.5 : 1)) / hmul,
                splash: d.splash,
                wid: d.id,
              }),
            );
          }
          g.fx.flash(muzzle, 1.2, 0xffc0a0, 0.12);
          for (let i = 0; i < 3; i++)
            g.fx.smoke(
              muzzle.clone().add(new THREE.Vector3(rnd(-0.4, 0.4), 0.2, rnd(-0.4, 0.4))),
              0.8,
              0xc0c4ca,
              0.8,
              2.5,
            );
          SFX.shot('missile', undefined, SP);
          w.cd = d.rof;
          if (this.isPlayer) g.rumble(0.2, 0.7, 160);
        }
        break;
      case 'emp':
        {
          if (w.cd > 0) return false;
          g.empPulse(this, d.radius, d.stun, d.color, d.id);
          w.cd = d.rof;
          this.recoil.l = this.recoil.r = 0.5;
        }
        break;
      case 'empbeam':
        {
          const dtb = g.lastDt || 0.016;
          if (this.empLock) {
            if (this.en >= this.enMax - 1) {
              this.empLock = false;
              if (this.isPlayer) g.flashMsg('電磁槍冷卻完成', 0x80c8ff, 1);
            } else return false;
          }
          if (!this.useEn(d.enPerSec * dtb)) {
            this.en = 0;
            this.empLock = true;
            w.firing = false;
            if (this.isPlayer) {
              g.flashAlert('電磁槍過載 — EN 回滿前無法發射');
              SFX.play('overload', 0.8, 1.0);
            }
            return false;
          }
          w.firing = true;
          w.firingT = 0.1;
          const bdir = targetPos.clone().sub(muzzle).normalize();
          let stop = d.range;
          for (let s2 = 1; s2 < stop; s2 += 1) {
            const p = muzzle.clone().addScaledVector(bdir, s2);
            if (p.y < g.world.terrainHeight(p.x, p.z) - 0.2 || g.world.hitsWorld(p)) {
              stop = s2;
              break;
            }
          }
          const targets = g.hostilesOf(this.team, this).concat(g.destructibles());
          for (const t of targets) {
            if (t.dead) continue;
            const c = t.center();
            const ap = c.clone().sub(muzzle);
            const proj = ap.dot(bdir);
            if (proj < 0 || proj > stop) continue;
            const perp = ap.clone().sub(bdir.clone().multiplyScalar(proj)).length();
            if (perp < t.radius + 0.8) {
              const pt = muzzle.clone().addScaledVector(bdir, proj);
              if (t.isProp) g.damageProp(t, dmg * dtb, imp * dtb, pt);
              else {
                t.empTickT = (t.empTickT || 0) + dtb;
                if (t.empTickT >= 0.2) {
                  t.takeDamage(dmg * 0.2, imp * 0.2, this, pt, bdir.clone(), undefined, d.id);
                  t.empTickT = 0;
                }
              }
              if (Math.random() < dtb * 4) g.fx.spark(pt, d.color, bdir);
            }
          }
          const end = muzzle.clone().addScaledVector(bdir, stop);
          g.fx.empBeam(w, muzzle, end, d.color);
          if (!w.sndT || w.sndT <= 0) {
            SFX.play('laser2', 0.35, 0.6, 0.1, 0.05, SP);
            w.sndT = 0.12;
          }
          w.sndT -= dtb;
          this.recoil[w.side > 0 ? 'r' : 'l'] = 0.25;
          w.cd = 0;
        }
        break;
      case 'laser':
        {
          const charged = w.charge >= d.chargeT && d.chargeT > 0;
          const ldmg = charged ? d.chargeDmg * this.dmgMul : dmg;
          const limp = charged ? imp * 2.2 : imp;
          w.charge = 0;
          w.charging = false;
          // 雷射：從槍口射向瞄準點的直線，貫穿彈道上所有敵人；只有地形／障礙物能阻斷
          const bdir = targetPos.clone().sub(muzzle).normalize();
          const targets = g.hostilesOfEnt(this).concat(g.destructibles());
          let stop = d.range;
          for (let s2 = 1; s2 < stop; s2 += 1) {
            const p = muzzle.clone().addScaledVector(bdir, s2);
            if (p.y < g.world.terrainHeight(p.x, p.z) - 0.2 || g.world.hitsWorld(p)) {
              stop = s2;
              break;
            }
          }
          const hits = [];
          for (const t of targets) {
            if (t.dead) continue;
            const c = t.center();
            const ap = c.clone().sub(muzzle);
            const proj = ap.dot(bdir);
            if (proj < 0 || proj > stop) continue;
            const perp = ap.clone().sub(bdir.clone().multiplyScalar(proj)).length();
            if (perp < t.radius + 0.6 + (charged ? 0.6 : 0)) hits.push({ t, proj });
          }
          hits.sort((a, b) => a.proj - b.proj);
          let n = 0;
          for (const h of hits) {
            const pt = muzzle.clone().addScaledVector(bdir, h.proj);
            const fall = Math.max(0.55, 1 - n * 0.15);
            if (h.t.isProp) g.damageProp(h.t, ldmg * fall, limp * fall, pt);
            else h.t.takeDamage(ldmg * fall, limp * fall, this, pt, bdir.clone(), undefined, d.id);
            g.fx.spark(pt, d.color, bdir);
            SFX.hit(h.t.isPlayer ? null : pt);
            n++;
          }
          const end = muzzle.clone().addScaledVector(bdir, stop);
          if (stop < d.range && !hits.length) g.fx.spark(end, 0xffffff);
          g.fx.beam(muzzle, end, d.color, charged ? 0.4 : 0.13);
          if (charged) {
            g.fx.shockwave(
              hits.length ? muzzle.clone().addScaledVector(bdir, hits[0].proj) : end,
              3,
              d.color,
              0.4,
            );
            if (this.isPlayer) g.camShake = Math.max(g.camShake, 0.14);
          }
          SFX.shot(charged ? 'laserCharged' : 'laser', d.id, SP);
          w.cd = d.rof * (charged ? 1.6 : 1);
          this.recoil[w.side > 0 ? 'r' : 'l'] = charged ? 1 : 0.4;
          if (this.isPlayer) g.rumble(charged ? 0.9 : 0.1, charged ? 0.6 : 0.6, charged ? 260 : 70);
          this.useEn((charged ? 250 : 60) * (1 - this.pmv('enWpn')));
        }
        break;
      case 'melee':
        {
          const m = this.melee;
          if (m.active && m.slot === slot) {
            if (m.stage < d.combo.length - 1 && m.t > d.combo[m.stage].dur * 0.35) m.queued = true;
            return true;
          }
          if (m.active) return false;
          if (!this.useEn(d.enCost)) return false;
          this.startMeleeStage(slot, 0, targetPos, targetEnt);
        }
        break;
    }
    if (d.mag < 99) {
      w.mag--;
      w.ammo--;
      if (w.mag <= 0 && w.ammo > 0) w.reloadT = d.reload;
    }
    return true;
  }
  // 彈藥耗盡：把手上的槍丟出去（變成會掉落彈跳的碎片），該手改為拳擊
  dropWeapon(slot) {
    const w = this.weapons[slot];
    const arm = this.model.arms[w.side > 0 ? 'r' : 'l'];
    const wm = arm.weapon;
    const g = this.game;
    if (wm && wm.children.length) {
      wm.updateMatrixWorld(true);
      const piece = new THREE.Group();
      wm.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      for (const c of [...wm.children]) {
        wm.remove(c);
        piece.add(c);
      }
      g.scene.add(piece);
      const fwd = new THREE.Vector3(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
      const v = fwd
        .multiplyScalar(-4)
        .add(new THREE.Vector3(rnd(-1.5, 1.5) + w.side * 3, rnd(4, 6), rnd(-1, 1)));
      const av = new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
      let rest = false;
      g.fx.list.push({
        mesh: piece,
        life: 8,
        max: 8,
        fn: (e, t, dt) => {
          if (!rest) {
            v.y -= 34 * dt;
            piece.position.addScaledVector(v, dt);
            piece.rotation.x += av.x * dt;
            piece.rotation.y += av.y * dt;
            piece.rotation.z += av.z * dt;
            const gy = g.world.terrainHeight(piece.position.x, piece.position.z) + 0.25;
            if (piece.position.y < gy) {
              piece.position.y = gy;
              if (Math.abs(v.y) < 3) rest = true;
              else {
                v.y *= -0.35;
                v.x *= 0.5;
                v.z *= 0.5;
                av.multiplyScalar(0.4);
                g.fx.dust(piece.position.clone(), 0.8, 4);
              }
            }
          }
          if (t > 0.85) piece.position.y -= dt * 0.6;
        },
      });
    }
    this.weapons[slot] = {
      def: pilotWeaponDef(FIST_DEF, this.pm),
      ammo: 999,
      mag: 99,
      cd: 0.4,
      reloadT: 0,
      charge: 0,
      charging: false,
      side: w.side,
      slot,
      dropped: true,
      ownerId: this.id,
    };
    if (this.isPlayer) {
      g.flashMsg(
        (w.side > 0 ? '右手' : '左手') + ' 彈藥耗盡 — 丟棄 ' + w.def.name.split(' ')[0] + '，切換拳擊',
        0xffb020,
        2,
      );
      g.renderWeaponHud(true);
    }
    SFX.play('hit3', 0.6, 0.7, 0.05, 0.03, this.isPlayer ? null : this.center());
  }
  startMeleeStage(slot, stage, targetPos, targetEnt) {
    const m = this.melee,
      d = this.weapons[slot].def,
      st = d.combo[stage];
    const g = this.game;
    m.active = true;
    m.slot = slot;
    m.stage = stage;
    m.t = 0;
    m.queued = false;
    m.hit = new Set();
    m.target = targetEnt || null;
    m.window = 0;
    let dir = targetPos.clone().sub(this.center());
    dir.y = 0;
    if (m.target && !m.target.dead) {
      dir = m.target.pos.clone().sub(this.pos);
      dir.y = 0;
    }
    if (dir.lengthSq() < 0.01) dir.set(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    m.dir = dir.normalize();
    this.aimYaw = Math.atan2(-m.dir.x, -m.dir.z);
    const yaw = this.aimYaw;
    const c = this.center();
    c.y -= 0.3;
    if (st.spin) {
      g.fx.slash(c, yaw, 360, st.reach * 0.95 * this.scale, d.color, false, 0.1, st.dur * 0.9, true);
    } else if (st.thrust) {
      g.fx.chevrons(this.pos.clone(), m.dir, d.color);
      g.fx.slash(
        c.clone().addScaledVector(m.dir, st.reach * 0.4),
        yaw,
        st.arc,
        st.reach * 0.7 * this.scale,
        d.color,
        stage % 2 === 1,
        0.9,
        st.dur * 0.8,
      );
    } else if (st.slam) {
      g.fx.slash(
        c.clone().add(new THREE.Vector3(0, 1.2, 0)),
        yaw,
        st.arc,
        st.reach * 0.95 * this.scale,
        d.color,
        false,
        1.35,
        st.dur * 0.8,
      );
    } else g.fx.slash(c, yaw, st.arc, st.reach * 0.95 * this.scale, d.color, !!st.mirror, 0.35, st.dur * 0.8);
    if (this.grounded) g.fx.dust(this.pos.clone(), 1.6, 6);
    SFX.shot('blade', undefined, this.isPlayer ? null : this.center());
    if (this.isPlayer) g.rumble(0.3, 0.5, 90);
    this.recoil[stage % 2 ? 'l' : 'r'] = 0;
    this.swing = { l: st.mirror ? 1 : -0.3, r: st.mirror ? -0.3 : 1 };
    if (st.spin) this.swing = { l: 1, r: 1 };
  }
  updateMelee(dt) {
    const m = this.melee;
    if (!m.active) return;
    const g = this.game,
      d = this.weapons[m.slot].def,
      st = d.combo[m.stage];
    m.t += dt;
    // tracking toward target during wind-up
    if (m.target && !m.target.dead && m.t < st.dur * 0.5) {
      const to = m.target.pos.clone().sub(this.pos);
      to.y = 0;
      if (to.length() > 1) m.dir.lerp(to.normalize(), Math.min(1, dt * 8)).normalize();
      this.aimYaw = Math.atan2(-m.dir.x, -m.dir.z);
    }
    const ph = m.t / st.dur;
    const burst = d.id === 'w_fist' ? 0.3 : 0.6;
    const dashSpd = ph < burst ? st.dash / (st.dur * burst) : 0; // 拳擊：前 30% 瞬間衝刺；其他近戰前 60%
    this.vel.x = m.dir.x * dashSpd;
    this.vel.z = m.dir.z * dashSpd;
    if (st.slam && ph < 0.4) this.vel.y = Math.max(this.vel.y, 3);
    if (Math.random() < dt * 30) g.fx.boostFlame(this.center(), m.dir.clone().negate(), d.color);
    // hit window
    if (ph > 0.1 && ph < 0.85) {
      const targets = g.hostilesOfEnt(this).concat(g.destructibles());
      const c = this.center();
      for (const t of targets) {
        if (t.dead || m.hit.has(t.id)) continue;
        const to = t.center().sub(c);
        const dist = to.length() - t.radius;
        if (dist > st.reach * this.scale + 1.0) continue;
        const ang = st.spin ? 0 : Math.abs(Math.atan2(to.x, to.z) - Math.atan2(m.dir.x, m.dir.z));
        const a2 = st.spin ? 0 : Math.min(ang, Math.PI * 2 - ang);
        if (a2 > THREE.MathUtils.degToRad(st.arc) / 2) continue;
        m.hit.add(t.id);
        const hp = t.center().lerp(c, 0.3);
        if (t.isProp) {
          g.damageProp(t, st.dmg * this.dmgMul * this.stats.parts.arms.melee, st.impact, hp);
          g.fx.meleeHit(hp, d.color, m.dir.clone(), !!st.finisher);
          continue;
        }
        t.takeDamage(
          st.dmg * this.dmgMul * this.stats.parts.arms.melee,
          st.impact * this.dmgMul,
          this,
          hp,
          m.dir.clone(),
          { kb: st.kb, lift: st.lift, finisher: !!st.finisher, stagBonus: st.stagBonus },
          d.id,
        );
        g.fx.meleeHit(hp, d.color, !!st.finisher, m.dir);
        mechFlash(t.model, d.color, 0.16);
        g.fx.hitStop = st.finisher ? 0.11 : 0.06;
        if (this.isPlayer) {
          g.camShake = Math.max(g.camShake, st.finisher ? 0.26 : 0.14);
          g.meleeHitFlash = 0.12;
          g.rumble(st.finisher ? 1.0 : 0.7, st.finisher ? 0.8 : 0.3, st.finisher ? 280 : 130);
        }
        if (t.isPlayer) g.rumble(1.0, 0.6, st.finisher ? 320 : 160);
        SFX.meleeHit(!!st.finisher, this.isPlayer || t.isPlayer ? null : hp);
      }
    }
    if (m.t >= st.dur) {
      if (m.queued && m.stage < d.combo.length - 1 && this.useEn(d.enCost * (0.6 + this.pmv('mChain')))) {
        this.startMeleeStage(
          m.slot,
          m.stage + 1,
          this.center().add(m.dir.clone().multiplyScalar(10)),
          m.target,
        );
      } else {
        m.active = false;
        m.stage = 0;
        this.swing = { l: 0, r: 0 };
        this.weapons[m.slot].cd = st.finisher ? 0.6 : 0.3;
      }
    }
  }
  takeDamage(dmg, impact, from, at, dir, melee, wid) {
    if (this.dead) return;
    if (this.iFrames > 0) return;
    // DUELIST 格擋：未在連段中、未硬直、面向攻擊者時 55% 擋下近戰第 1 段並反擊
    if (
      melee &&
      this.ai === 'duelist' &&
      !this.melee.active &&
      this.staggerT <= 0 &&
      from &&
      Math.random() < 0.55
    ) {
      const to = from.pos.clone().sub(this.pos);
      to.y = 0;
      const fwd = new THREE.Vector3(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
      if (to.normalize().dot(fwd) > 0.2) {
        this.game.fx.flash(at || this.center(), 1.2, 0xd070ff, 0.15);
        this.game.fx.streaks(at || this.center(), 10, 0xe0a0ff, 18, 0.3, 20);
        this.game.fx.shockwave(this.center(), 3, 0xd070ff, 0.3);
        SFX.play('shield', 0.9, 1.2, 0.05, 0.03, this.center());
        this.game.popDamage(at || this.center(), 'PARRY', false, false, false, 0);
        this.aiState.counterT = 0.15;
        return;
      }
    }
    if (melee) {
      this.comboHits = (this.comboHits || 0) + 1;
      this.comboT = 1.2;
      if (melee.stagBonus && this.staggerT > 0) dmg *= melee.stagBonus;
      if (dir) {
        const kb = melee.kb * (this.isBoss ? 0.2 : 1);
        this.vel.x += dir.x * kb;
        this.vel.z += dir.z * kb;
      }
      if (melee.lift && !this.isBoss && this.stats.parts.legs.type !== 'tank') {
        this.vel.y = Math.max(this.vel.y, melee.lift);
        this.grounded = false;
      }
      if ((this.comboHits >= 3 || melee.finisher) && this.staggerT <= 0 && !this.isBoss) {
        this.acs = this.acsMax;
        this.staggerT = melee.finisher ? 2.2 : 1.6;
        this.knockSide = Math.random() < 0.5 ? -1 : 1;
        this.game.fx.ring(this.center(), 4, 0xff6040);
        SFX.stagger(this.isPlayer ? null : this.center());
        if (this.team === 'enemy') this.game.flashMsg('失衡！', 0xff6a2a, 0.7);
      }
      dir = null;
    }
    mechFlash(this.model);
    if (dir) {
      const kb = clamp(impact / 900, 0.05, 1.2) * (this.isBoss ? 0.15 : 1);
      this.vel.x += dir.x * kb * 6;
      this.vel.z += dir.z * kb * 6;
    }
    if (this.isPlayer) {
      this.game.camShake = Math.max(this.game.camShake, clamp(impact / 1500, 0.06, 0.3));
      this.game.rumble(clamp(impact / 700, 0.2, 1), clamp(impact / 400, 0.3, 1), clamp(impact / 4, 60, 260));
    } else if (impact >= 500) {
      this.game.camShake = Math.max(this.game.camShake, 0.12);
      this.game.fx.hitStop = 0.05;
    }
    let mul = 1;
    if (this.staggerT > 0) mul = 1.5 + this.pmv('stagDmg');
    mul *= 1 - this.stats.def;
    const g = this.game;
    if (this.shield) {
      if (g.pilotCreditShield) g.pilotCreditShield(this, dmg * mul * this.shield);
      mul *= 1 - this.shield;
    }
    const real = Math.round(dmg * mul);
    const mp = g.net && g.net.role;
    if (mp && this.team === 'player' && this.downed) {
      if (this.downHp === undefined) this.downHp = this.maxHp * (0.3 + this.pmv('downHp'));
      if (g.pilotCreditHit) g.pilotCreditHit(from, this, wid, Math.min(real, Math.max(0, this.downHp)));
      this.downHp -= real;
      this.dmgTaken += real;
      g.popDamage(at || this.center(), real, this.isPlayer, false, !!melee, 0, this.id, impact);
      if (this.downHp <= 0) this.die(from);
      return;
    }
    const hpBefore = Math.max(0, this.hp);
    if (g.pilotCreditHit) g.pilotCreditHit(from, this, wid, Math.min(real, hpBefore));
    this.hp -= real;
    this.dmgTaken += real;
    if (mp && g.mpStats) {
      const eff = Math.min(real, hpBefore); // 不計入超過剩餘 AP 的溢出傷害
      if (from && from.team === 'player' && from.slot !== undefined && g.mpStats[from.slot])
        g.mpStats[from.slot].dmg += eff;
      if (this.team === 'player' && this.slot !== undefined && g.mpStats[this.slot])
        g.mpStats[this.slot].taken += eff;
    }
    if (this.staggerT <= 0) {
      // 高處優勢：攻擊者比自己高 4 m 以上時衝擊 +25%
      const high = from && from !== this && from.center && from.center().y - this.center().y > 4 ? 1.25 : 1;
      this.acs += impact * (this.shield ? 0.6 : 1) * high;
      this.acsDecayDelay = 1.2;
      if (this.acs >= this.acsMax) {
        this.acs = this.acsMax;
        // 玩家機體一律 1.4 秒（房主端的遠端玩家 isPlayer 為 false，不能用它判斷）
        this.staggerT = (this.isBoss ? 1.5 : this.team === 'player' ? 1.4 : 2.0) * (1 - this.pmv('stagT'));
        this.game.fx.ring(this.center(), 4, 0xffb020);
        SFX.stagger(this.isPlayer ? null : this.center());
        if (this.isPlayer) {
          this.game.flashAlert('ACS 過載 — 姿態崩潰');
          this.game.rumble(1.0, 1.0, 600);
        }
        this.game.netEv({ t: 'stag', i: this.id });
      }
    }
    this.game.popDamage(
      at || this.center(),
      real,
      this.isPlayer,
      this.staggerT > 0,
      !!melee,
      melee ? this.comboHits : 0,
      this.id,
      impact,
    );
    if (this.hp <= 0) {
      if (mp && this.team === 'player' && !this.downed && !g.pvp) {
        this.enterDowned();
        return;
      }
      this.die(from);
    }
  }
  die(from) {
    if (this.dead) return;
    this.dead = true;
    const g = this.game;
    const c = this.center();
    if (this.explodeOnDeath) {
      const E = this.explodeOnDeath;
      g.explodeAt(c, E.dmg, E.impact, E.splash, this, true);
    }
    SFX.explode(true, this.isPlayer ? null : c);
    g.rumbleAt(
      c,
      this.isBoss ? 1.0 : 0.8,
      this.isBoss ? 1.0 : 0.5,
      this.isBoss ? 900 : 350,
      this.isBoss ? 80 : 35,
    );
    if (this.isPlayer) g.rumble(1.0, 1.0, 800);
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    g.fx.shatter(this, g.world);
    this.mesh.visible = false;
    g.camShake = Math.max(g.camShake, this.isBoss ? 0.5 : 0.2);
    if (g.pvp && g.onPvpDeath) {
      g.onPvpDeath(this, from);
    } else if (this.team === 'enemy') {
      g.onEnemyKilled(this, from);
    } else if (this.team === 'player') {
      if (g.net && g.net.role) {
        g.flashMsg(`${this.name} 已被擊破`, 0xff4d4d, 2.5);
        if (this.isPlayer) g.flashMsg('AC 已被擊破 — 旁觀模式（Tab 切換隊友）', 0xff4d4d, 3);
      } else if (this.isPlayer) g.onPlayerDead();
    } else g.flashAlert('友軍 AC 已被擊破');
  }
  respawnAt(pos) {
    const g = this.game;
    try {
      g.scene.remove(this.mesh);
    } catch (e) {}
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    this.model = this.buildRig();
    this.mesh = this.model.group;
    g.scene.add(this.mesh);
    this.dead = false;
    this.downed = false;
    this.hp = this.maxHp;
    this.en = this.enMax;
    this.acs = 0;
    this.staggerT = 0;
    this.iFrames = 3 + this.pmv('spawnIF');
    this.melee.active = false;
    this.swing = { l: 0, r: 0 };
    this.vel.set(0, 0, 0);
    this.pos.copy(pos);
    this.mesh.position.copy(pos);
    this.mesh.visible = true;
    this.lock = null;
    this.kits = this.kitsMax;
    this.comboHits = 0;
    this.initWeapons();
    g.fx.ring(this.center(), 6, 0x7ee081);
    SFX.play('door', 0.7, 1.2, 0.05, 0.03, this.isPlayer ? null : this.center());
    if (this.isPlayer) g.renderWeaponHud(true);
  }
  cleanup() {
    for (const k in this.weapons) {
      const w = this.weapons[k];
      if (w.beamMesh) {
        this.game.scene.remove(w.beamMesh);
        w.beamMesh = null;
      }
    }
    this.game.scene.remove(this.mesh);
    if (this.glare) {
      this.glare.forEach((m) => this.game.scene.remove(m));
      this.glare = null;
    }
  }

  // ---------- physics ----------
  move(dt, wish, wantHover, wantQB, wantAB, targetEnt) {
    const g = this.game,
      w = g.world,
      P = this.stats.parts;
    const spd = this.stats.speed * this.speedMul;
    this.t += dt;
    // AI 閃避衝擊波時按住跳躍（Game.updateShocks 設定）
    if (this.aiJumpT > 0) {
      this.aiJumpT -= dt;
      if (!wantHover) wantHover = true;
    }
    // timers
    for (const k in this.weapons) {
      const ww = this.weapons[k];
      if (ww.cd > 0) ww.cd -= dt;
      if (ww.firingT !== undefined) {
        ww.firingT -= dt;
        if (ww.firingT <= 0) ww.firing = false;
      }
      if (ww.beamMesh) {
        ww.beamHideT -= dt;
        if (ww.beamHideT <= 0) ww.beamMesh.visible = false;
      }
      if (ww.reloadT > 0) {
        ww.reloadT -= dt;
        if (ww.reloadT <= 0) {
          ww.mag = Math.min(ww.def.mag, ww.ammo);
        }
      }
    }
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.comboHits = 0;
    }
    if (this.downed) {
      wish = new THREE.Vector3();
      wantHover = false;
      wantQB = false;
      wantAB = false;
      if (this.melee.active) {
        this.melee.active = false;
        this.swing = { l: 0, r: 0 };
      }
    }
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) {
        this.acs = 0;
        this.comboHits = 0;
      }
      wish = new THREE.Vector3();
      wantHover = false;
      wantQB = false;
      wantAB = false;
      if (this.melee.active) {
        this.melee.active = false;
        this.swing = { l: 0, r: 0 };
      }
    }
    if (this.melee.active) {
      if (wantQB && this.melee.t > this.weapons[this.melee.slot].def.combo[this.melee.stage].dur * 0.5) {
        this.melee.active = false;
        this.swing = { l: 0, r: 0 };
      } else {
        wish = new THREE.Vector3();
        wantHover = false;
        wantAB = false;
      }
    } else {
      if (this.acsDecayDelay > 0) this.acsDecayDelay -= dt;
      else this.acs = Math.max(0, this.acs - this.acsMax * 0.45 * (1 + this.pmv('acsDec')) * dt);
    }
    if (this.iFrames > 0) this.iFrames -= dt;
    if (this.enDelay > 0) this.enDelay -= dt;
    else
      this.en = Math.min(
        this.enMax,
        this.en + P.generator.recharge * dt * (this.grounded ? 1.6 + this.pmv('gnd') : 1),
      );
    // quick boost
    if (wantQB && this.qbT <= 0 && wish.lengthSq() > 0.1 && this.useEn(P.booster.qbCost)) {
      this.qbT = 0.16;
      this.qbDir.copy(wish).normalize();
      SFX.qb(this.isPlayer ? null : this.center());
      if (this.isPlayer) g.rumble(0.1, 0.35, 80);
      g.fx.chevrons(this.pos.clone(), this.qbDir.clone().negate(), 0xffffff);
      if (this.grounded) g.fx.dust(this.pos.clone(), 2.2, 7);
      this.iFrames = 0.14 + this.pmv('qbIF');
    }
    // assault boost
    if (wantAB && targetEnt && this.en > 5) {
      if (this.abT <= 0) SFX.ab(this.isPlayer ? null : this.center());
      this.abT = 0.1;
      this.en -= P.booster.qbCost * 1.4 * dt;
      this.enDelay = 0.3;
      if (Math.random() < dt * 30)
        g.fx.boostFlame(
          this.center().add(new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5))),
          this.vel.clone().normalize().negate(),
          0x9ff0ff,
        );
    }
    let target = new THREE.Vector3();
    if (this.qbT > 0) {
      this.qbT -= dt;
      target.copy(this.qbDir).multiplyScalar(P.booster.qb);
      this.boost = true;
    } else if (this.abT > 0 && targetEnt) {
      this.abT -= dt;
      const d = targetEnt.pos.clone().sub(this.pos);
      d.y = 0;
      if (d.length() > 6) {
        target.copy(d.normalize()).multiplyScalar(spd * 2.2);
      }
      this.boost = true;
    } else {
      // 起跳後一小段時間維持地面的速度與轉向（跳躍要輕快）
      target.copy(wish).multiplyScalar(spd * (this.grounded || this.jumpT > 0 ? 1 : 0.85));
      this.boost = false;
    }
    const acc = this.qbT > 0 ? 60 : this.grounded || this.jumpT > 0 ? 18 : 9;
    if (!this.melee.active) {
      this.vel.x = lerp(this.vel.x, target.x, Math.min(1, acc * dt));
      this.vel.z = lerp(this.vel.z, target.z, Math.min(1, acc * dt));
    } else this.updateMelee(dt);
    // vertical
    const ground = w.groundAt(this.pos.x, this.pos.z, this.pos.y);
    let altCap = false;
    {
      const MAXALT = 22;
      const alt = this.pos.y - ground;
      if (!this.flying && alt > MAXALT) {
        if (this.vel.y > 0) this.vel.y = Math.min(this.vel.y, 0);
        altCap = true;
        if (this.isPlayer && !this.altWarnT) {
          this.altWarnT = 1.5;
          g.flashAlert('已達飛行高度上限');
        }
      }
      if (this.altWarnT > 0) this.altWarnT -= dt;
    }
    if (this.flying) {
      const ty = ground + this.hoverH + Math.sin(this.t * 2) * 0.6;
      this.vel.y = lerp(this.vel.y, (ty - this.pos.y) * 3, 0.2);
      this.grounded = false;
      this.hover = true;
    } else {
      this.jumpMove(dt, wish, wantHover, spd, altCap);
      if (!this.hoverMode) {
        // 跳躍上升中用該腳部自己的重力（決定到頂時間），過了最高點一律用 GRAVITY
        this.vel.y -= (this.vel.y > 0 && this.riseG ? this.riseG : GRAVITY) * dt;
        if (this.vel.y < -36) this.vel.y = -36;
      }
    }
    // integrate
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    {
      const ce = w.ceiling(this.pos.x, this.pos.z, this.pos.y, this.model.height);
      if (ce < 1e8) {
        this.pos.y = Math.min(this.pos.y, ce - this.model.height - 0.05);
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }
    const g2 = w.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g2) {
      if (!this.grounded && this.vel.y < -6) this.landT = 0;
      if (!this.grounded && this.vel.y < -12) {
        g.fx.dust(this.pos.clone().setY(g2 + 0.05), 2.6 * this.scale, 9);
        SFX.land(this.isPlayer ? null : this.center());
        if (this.isPlayer) {
          g.camShake = Math.max(g.camShake, 0.06);
          g.rumble(0.35, 0.2, 110);
        }
      }
      this.pos.y = g2;
      this.vel.y = Math.max(0, this.vel.y);
      this.grounded = true;
    } else if (this.pos.y > g2 + 0.15) this.grounded = false;
    const [nx, nz] = w.collide(this.pos.x, this.pos.z, this.pos.y, this.radius * 0.8);
    this.aiState.stuck =
      Math.abs(nx - this.pos.x) + Math.abs(nz - this.pos.z) > 0.05 ? this.aiState.stuck + dt : 0;
    this.pos.x = nx;
    this.pos.z = nz;
    // slope climb: if terrain rises steeply push up
    const tg = w.terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y < tg) {
      this.pos.y = tg;
    }
    // ---- 機體動態：依加速度前傾／後仰／側傾（機體座標系） ----
    if (!this.prevVel) this.prevVel = this.vel.clone();
    const accW = this.vel
      .clone()
      .sub(this.prevVel)
      .multiplyScalar(1 / Math.max(dt, 1e-3));
    this.prevVel.copy(this.vel);
    if (!this.accS) this.accS = new THREE.Vector3();
    this.accS.lerp(accW, Math.min(1, dt * 6));
    {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
        right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const af = this.accS.dot(fwd),
        ar = this.accS.dot(right);
      const vf = this.vel.dot(fwd);
      this.leanX = clamp(af * 0.012 + vf * 0.004, -0.35, 0.35) + (this.qbT > 0 ? 0.18 : 0); // 加速前傾、減速後仰、QB 更前傾
      this.leanZ = clamp(-ar * 0.01, -0.28, 0.28); // 側向加速 → 向內側傾
      if (this.flying) {
        this.leanX *= 0.6;
      }
    }
    // yaw
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 1.5;
    {
      const firing = this.recoil.l + this.recoil.r > 0.05 || this.melee.active;
      const faceAim = this.lock || firing || !this.moving || this.ai || this.fpFace; // 人形：有目標時整台機體面向目標，側移用側步
      const targetYaw = faceAim ? this.aimYaw : Math.atan2(-this.vel.x, -this.vel.z);
      this.yaw = angLerp(this.yaw, targetYaw, Math.min(1, dt * (faceAim ? 10 : 14)));
    }
    ikRestore(this.model); // IK 改過的關節回到動作層的結果（animateMech 從那裡平滑）
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw;
    if (this.staggerT <= 0 && !this.downed) {
      this.mesh.rotation.x = lerp(this.mesh.rotation.x, this.leanX || 0, Math.min(1, dt * 8));
      this.mesh.rotation.z = lerp(this.mesh.rotation.z, this.leanZ || 0, Math.min(1, dt * 8));
    }
    {
      // 人形：上半身與下半身同向；只有載具砲塔（vehicle）獨立旋轉
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
    }
    // stagger tilt
    this.model.torso.rotation.z = lerp(
      this.model.torso.rotation.z,
      this.staggerT > 0 ? Math.sin(this.t * 30) * 0.08 : 0,
      0.3,
    );
    this.model.torso.rotation.x = lerp(
      this.model.torso.rotation.x,
      this.qbT > 0 ? 0.3 : this.moving ? 0.14 : 0,
      0.25,
    );
    this.recoil.l = Math.max(0, this.recoil.l - dt * 8);
    this.recoil.r = Math.max(0, this.recoil.r - dt * 8);
    {
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
        right = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const spd = Math.max(1, this.stats.speed);
      const strafe = clamp(this.vel.dot(right) / spd, -1, 1);
      const turn = clamp(
        (((this.yaw - (this.prevYaw === undefined ? this.yaw : this.prevYaw) + Math.PI) % (Math.PI * 2)) -
          Math.PI) /
          Math.max(dt, 1e-3) /
          6,
        -1,
        1,
      );
      this.prevYaw = this.yaw;
      this.turnS = lerp(this.turnS || 0, turn, Math.min(1, dt * 8));
      this.landT = this.landT === undefined ? 9 : this.landT + dt;
      const fwdV = clamp(this.vel.dot(fwd) / spd, -1, 1);
      this.ikGait(dt);
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
        gait: this.gaitPh,
        amp: this.gaitAmp,
        melee: this.melee.active
          ? (() => {
              const d = this.weapons[this.melee.slot].def,
                st2 = d.combo[this.melee.stage];
              return {
                kind: st2.spin ? 'spin' : st2.thrust ? 'thrust' : st2.slam ? 'slam' : 'slash',
                ph: clamp(this.melee.t / st2.dur, 0, 1),
                mirror: !!st2.mirror,
                side: this.melee.slot === 'rarm' ? 1 : -1,
              };
            })()
          : null,
        turn: this.turnS,
        landT: this.landT,
        aimRel:
          ((((this.aimYaw - this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI,
        leanZ: this.leanZ || 0,
        leanX: this.leanX || 0,
      });
      if (!this.model.vehicle) applyIK(this.model, this.ikCtx(dt));
    }
    // ---- 推進器光暈與噴焰粒子、側噴嘴 ----
    {
      this.thrusterFx(dt, this.isPlayer ? 0x9fe8ff : 0xffb070, this.isPlayer ? 0x8fe8ff : 0xffb060, true);
      // 側移／急減速時的肩腰側噴嘴
      const ar = this.leanZ || 0,
        af = this.leanX || 0;
      if (Math.abs(ar) > 0.08 && Math.random() < dt * 35) {
        const side = ar > 0 ? -1 : 1;
        const p = this.pos
          .clone()
          .add(
            new THREE.Vector3(
              -Math.sin(this.yaw + Math.PI / 2) * side * 0.9 * this.scale,
              this.model.hipY * this.scale * 1.05,
              -Math.cos(this.yaw + Math.PI / 2) * side * 0.9 * this.scale,
            ),
          );
        g.fx.boostFlame(
          p,
          new THREE.Vector3(
            -Math.sin(this.yaw + Math.PI / 2) * side,
            0.1,
            -Math.cos(this.yaw + Math.PI / 2) * side,
          ),
          this.isPlayer ? 0x9fe8ff : 0xffb070,
        );
      }
      if (af < -0.12 && Math.random() < dt * 30) {
        const p = this.center().add(
          new THREE.Vector3(
            -Math.sin(this.yaw) * 0.7 * this.scale,
            0.3,
            -Math.cos(this.yaw) * 0.7 * this.scale,
          ),
        );
        g.fx.boostFlame(
          p,
          new THREE.Vector3(-Math.sin(this.yaw), 0.1, -Math.cos(this.yaw)),
          this.isPlayer ? 0x9fe8ff : 0xffb070,
        );
      }
      // 地面高速推進的塵土尾跡
      if (
        this.grounded &&
        (this.boost || Math.hypot(this.vel.x, this.vel.z) > this.stats.speed * 0.8) &&
        Math.random() < dt * 18
      )
        g.fx.smoke(
          this.pos.clone().add(new THREE.Vector3(rnd(-0.6, 0.6), 0.2, rnd(-0.6, 0.6))),
          0.9 * this.scale,
          0x9a9ea6,
          0.7,
          1.2,
        );
    }
    // smoke when damaged
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
    if (this.staggerT > 0 && Math.random() < dt * 20)
      g.fx.spark(this.center().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))), 0xffb020);
  }
  // 跳躍與懸浮（同一個鍵分段）：地面按下＝跳躍；空中按下＝空中跳（還有次數時，向上的 QB，高度依次遞減）；
  // 按住到最高點接懸浮（定高）；懸浮中放開後馬上再按住＝爬升（耗能加倍）。沒有空中跳時空中按住直接懸浮。
  // 戰車能跳不能懸浮。
  // want：按住（AI 傳 2 表示要爬升）。jumpExt（房主處理客機輸入）時按下由 jumpPressQ 給，不從按住推算
  jumpMove(dt, wish, want, spd, altCap) {
    const g = this.game,
      P = this.stats.parts,
      J = jumpSpec(P.legs);
    const held = !!want;
    const press = this.jumpExt ? !!this.jumpPressQ : held && !this.jumpPrev;
    this.jumpPressQ = false;
    this.jumpPrev = held;
    if (this.jumpT > 0) this.jumpT -= dt;
    if (this.hoverEndT > 0) this.hoverEndT -= dt;
    if (!held) this.jumpHold = false;
    if (this.grounded || this.vel.y <= 0) this.riseG = 0;
    if (this.grounded) {
      this.airJumps = J.air;
      this.hoverMode = 0;
    }
    if (press) {
      if (this.grounded) {
        const k = this.en >= JUMP_EN ? 1 : 0.7; // 能量不足時跳得比較低
        this.en = Math.max(0, this.en - JUMP_EN);
        this.enDelay = Math.max(this.enDelay, 0.25);
        this.vel.y = J.v * k;
        this.riseG = J.g;
        this.grounded = false;
        this.jumpT = 0.6;
        this.jumpHold = true;
        g.fx.dust(this.pos.clone(), 2.4 * this.scale, 8);
        SFX.jump(this.isPlayer ? null : this.center());
      } else if (J.canHover && (this.hoverMode || this.hoverEndT > 0)) {
        this.hoverMode = 2;
      } else if (this.airJumps > 0 && this.en >= P.booster.qbCost * 0.7) {
        this.en -= P.booster.qbCost * 0.7;
        this.enDelay = P.generator.delay;
        const f = AIR_DECAY[Math.min(J.air - this.airJumps, AIR_DECAY.length - 1)];
        this.airJumps--;
        const v = Math.sqrt(2 * J.airG * J.airH * f);
        if (this.vel.y < v) {
          this.vel.y = v;
          this.riseG = J.airG;
        }
        if (wish.lengthSq() > 0.1) {
          const h = wish
            .clone()
            .setY(0)
            .normalize()
            .multiplyScalar(spd * 1.35);
          this.vel.x = h.x;
          this.vel.z = h.z;
        }
        this.iFrames = Math.max(this.iFrames, 0.1);
        this.jumpT = 0.45;
        this.jumpHold = true;
        this.hoverMode = 0;
        g.fx.chevrons(this.pos.clone(), new THREE.Vector3(0, -1, 0), 0xffffff);
        SFX.qb(this.isPlayer ? null : this.center());
        if (this.isPlayer) g.rumble(0.1, 0.3, 70);
      } else if (held && J.canHover) this.hoverMode = 1;
    }
    if (this.hoverMode && !held) {
      this.hoverMode = 0;
      this.hoverEndT = 0.25;
    }
    if (!this.hoverMode && held && this.jumpHold && !this.grounded && this.vel.y <= 0) this.hoverMode = 1;
    if (want === 2 && !this.grounded) this.hoverMode = 2;
    if (!J.canHover) this.hoverMode = 0;
    if (this.hoverMode === 2 && (altCap || this.en <= 2)) this.hoverMode = 1;
    if (this.hoverMode === 1 && this.en <= 2 && !J.freeHover) this.hoverMode = 0;
    if (this.hoverMode) {
      this.riseG = 0;
      const climb = this.hoverMode === 2;
      this.vel.y = lerp(this.vel.y, climb ? 7 : -0.5, Math.min(1, dt * (climb ? 5 : 6)));
      this.en = Math.max(0, this.en - (climb ? J.climb : J.hover) * (1 - this.pmv('hover')) * dt);
      this.enDelay = 0.5;
    }
    this.hover = this.hoverMode > 0;
  }
  // 推進器：噴口光暈（加色球體，隨推力縮放）＋噴焰。機甲的噴焰是粒子特效（沿噴口連接點的 −Y 噴出），
  // 載具（直升機、無人機）維持原本的尾焰
  thrusterFx(dt, glareCol, flameCol, jitter) {
    const g = this.game;
    if (!this.glare) this.glare = this.model.nozzles.map(() => g.fx.glareMesh(glareCol));
    const thr = this.boost ? 1.0 : this.hover ? 0.7 : !this.grounded ? 0.45 : this.moving ? 0.28 : 0.06;
    this.thrS = lerp(this.thrS || 0, thr, Math.min(1, dt * 10));
    const wp = new THREE.Vector3(),
      dir = new THREE.Vector3();
    const veh = this.model.vehicle;
    this.model.nozzles.forEach((n, i) => {
      nozzleWorld(n, wp, dir);
      if (veh) dir.set(0, -1, 0);
      const m = this.glare[i];
      m.position.copy(wp).addScaledVector(dir, 0.35 * this.scale);
      m.scale.setScalar((0.25 + this.thrS * 1.3) * this.scale * (jitter ? 0.9 + Math.random() * 0.2 : 1));
      m.material.opacity = 0.15 + this.thrS * 0.55;
    });
    if (!veh) {
      g.fx.thruster.stream(this.model, this.thrS, flameCol, this.scale, dt, this.vel);
      return;
    }
    if (
      (this.boost || this.hover || (!this.grounded && this.moving)) &&
      Math.random() < dt * (this.boost ? 50 : 22)
    )
      for (const n of this.model.nozzles) {
        n.getWorldPosition(wp);
        g.fx.boostFlame(
          wp,
          new THREE.Vector3(this.vel.x, this.vel.y, this.vel.z)
            .multiplyScalar(-0.03)
            .add(new THREE.Vector3(0, -0.6, 0))
            .normalize(),
          flameCol,
        );
      }
  }
  setAim(targetPos) {
    const c = this.center();
    const dx = targetPos.x - c.x,
      dz = targetPos.z - c.z,
      dy = targetPos.y - c.y;
    this.aimYaw = Math.atan2(-dx, -dz);
    this.aimPitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.aimDist = Math.hypot(dx, dy, dz);
  }
  // ---------- IK（render/mech-ik.js）----------
  // 瞄準點：機體中心沿 aimYaw／aimPitch 的方向；距離用 setAim 記下的（客機上其他機甲沒有，改用鎖定目標或 40 m）
  aimPoint() {
    const c = this.center();
    const lk = this.lock && !this.lock.dead ? this.lock : null;
    const d = this.aimDist || (lk ? Math.max(5, lk.center().distanceTo(c)) : 40);
    const cp = Math.cos(this.aimPitch);
    return c.add(
      new THREE.Vector3(
        -Math.sin(this.aimYaw) * cp,
        Math.sin(this.aimPitch),
        -Math.cos(this.aimYaw) * cp,
      ).multiplyScalar(d),
    );
  }
  // 步伐相位：開「步伐依移動距離」時依實際速度推進（一個循環的距離依腳長與擺幅），否則固定步頻 11 rad/s。
  // 速度太快、步頻到上限時（必然滑步）不做腳步鎖定
  ikGait(dt) {
    let rate = 11;
    this.gaitLockOK = false;
    this.gaitAmp = undefined;
    if (ikOn('stride') && this.grounded && this.moving) {
      // 擺幅依實際速度（10 m/s 擺滿），一個循環的距離＝4 × 腳長 × sin(0.6 × 擺幅)
      const v = Math.hypot(this.vel.x, this.vel.z);
      const fa = clamp(v / (10 * this.scale), 0.35, 1);
      const cyc = Math.max(0.6, 6.5 * Math.sin(0.6 * fa)) * this.scale;
      const r = (Math.PI * 2 * v) / cyc;
      rate = Math.min(20, r);
      this.gaitAmp = fa;
      this.gaitLockOK = r <= 20 && !this.boost && this.qbT <= 0;
    }
    this.gaitPh = ((this.gaitPh || 0) + rate * dt) % (Math.PI * 200);
  }
  ikCtx(dt) {
    const g = this.game;
    const kind = (s) => {
      const w = this.weapons[s];
      if (!w || w.dropped) return 'none';
      const t = w.def.type;
      return t === 'none' || t === 'shield' ? 'none' : t === 'melee' ? 'melee' : 'gun';
    };
    const mt = this.melee.active && this.melee.target && !this.melee.target.dead ? this.melee.target : null;
    return {
      dt,
      world: g.world,
      pos: this.pos,
      scale: this.scale,
      grounded: this.grounded,
      moving: this.moving,
      boost: this.boost || this.qbT > 0,
      knock: this.staggerT > 0 || this.downed,
      melee: this.melee.active,
      meleePt: mt ? mt.center() : null,
      aim: this.aimPoint(),
      guns: { l: kind('larm'), r: kind('rarm') },
      backs: { l: kind('lback') === 'gun', r: kind('rback') === 'gun' },
      recoil: this.recoil,
      gait: this.gaitPh,
      stride: this.gaitAmp !== undefined,
      lockOK: this.gaitLockOK,
      near: !g.camera || g.camera.position.distanceToSquared(this.pos) < 160 * 160,
    };
  }

  // ---------- AI ----------
  updateAI(dt) {
    const g = this.game,
      s = this.aiState;
    if (this.dead) return;
    // pick nearest hostile
    let pl = null,
      bd = 1e9;
    for (const h of g.hostilesOfEnt(this)) {
      if (h.dead) continue;
      const dd = h.pos.distanceToSquared(this.pos);
      if (dd < bd) {
        bd = dd;
        pl = h;
      }
    }
    if (this.team === 'ally') {
      this.allyT -= dt;
      if (this.allyT <= 0) {
        this.departing = true;
      }
      if (this.departing) {
        this.flying = true;
        this.pos.y += dt * 18;
        this.mesh.position.copy(this.pos);
        this.thrS = 1;
        g.fx.thruster.stream(this.model, 1, 0x9fffc8, this.scale, dt, this.vel);
        if (Math.random() < dt * 40) g.fx.boostFlame(this.center(), new THREE.Vector3(0, -1, 0), 0x9fffc8);
        if (this.pos.y > 60) {
          this.dead = true;
          this.mesh.visible = false;
        }
        return;
      }
    }
    if (!pl) {
      this.move(dt, new THREE.Vector3(), false, false, false, null);
      return;
    }
    const to = pl.pos.clone().sub(this.pos);
    to.y = 0;
    const d = to.length();
    const dir = d > 0.01 ? to.clone().normalize() : new THREE.Vector3(0, 0, 1);
    const leadT = clamp(d / 95, 0, 0.9);
    const aimPos = pl
      .center()
      .addScaledVector(pl.vel, leadT * (this.isBoss ? 0.9 : 0.7) * Math.min(1.3, this.aiSkill));
    this.setAim(aimPos);
    let wish = new THREE.Vector3();
    let hover = false,
      qb = false,
      ab = false;
    s.timer -= dt;
    if (s.timer <= 0) {
      s.timer = rnd(1.2, 2.8);
      s.strafe = Math.random() < 0.5 ? 1 : -1;
      s.want = (this.opts.wantDist || 22) * rnd(0.75, 1.25);
    }
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(s.strafe);
    // 反擊：格擋後立即出刀
    if (s.counterT > 0) {
      s.counterT -= dt;
      if (s.counterT <= 0) {
        for (const slot of ['rarm', 'larm'])
          if (this.weapons[slot].def.type === 'melee') {
            this.fire(slot, aimPos, pl);
            break;
          }
      }
    }
    if (this.ai === 'turret' || this.ai === 'mt_gren') {
      /* stationary */
    } else if (this.ai === 'sniper') {
      // 保持 55 m 以上；太近就 QB 拉開；有射線遮擋時橫移
      if (d < s.want - 8) {
        wish.copy(dir).negate();
        if (Math.random() < dt * 2.5) qb = true;
      } else if (d > s.want + 10) wish.copy(dir);
      else wish.copy(perp).multiplyScalar(0.6);
      wish.normalize();
      if (s.stuck > 0.4) {
        s.strafe *= -1;
        s.stuck = 0;
      }
    } else if (this.ai === 'flank') {
      // 四台包圍：各自佔據玩家周圍固定方位（緩慢公轉），到位後小幅橫移並射擊
      const ang = (this.opts.flankAngle || 0) + g.time * 0.25;
      const want = this.opts.wantDist || 9;
      const goal = new THREE.Vector3(pl.pos.x + Math.cos(ang) * want, 0, pl.pos.z + Math.sin(ang) * want);
      const to = goal.clone().sub(this.pos);
      to.y = 0;
      const gd = to.length();
      if (gd > 2.5) {
        wish.copy(to.normalize());
        if (gd > 18 && Math.random() < dt * 0.8) qb = true;
      } else wish.copy(perp).multiplyScalar(0.35);
      if (s.stuck > 0.4) {
        s.stuck = 0;
        s.jumpT = 0.5;
        s.climb = true;
      }
      s.jumpT -= dt;
      if (s.jumpT > 0) hover = s.climb ? 2 : true;
    } else if (this.ai === 'rusher' || this.ai === 'kamikaze') {
      wish.copy(dir);
      if (this.ai === 'rusher') {
        if (s.stuck > 0.4) {
          s.stuck = 0;
          s.jumpT = 0.5;
          s.climb = true;
        }
        s.jumpT -= dt;
        if (s.jumpT > 0) hover = s.climb ? 2 : true;
        if (d > 16 && Math.random() < dt * 1.2) ab = true;
        else if (d > 8 && Math.random() < dt * 0.8) {
          qb = true;
        }
      }
      if (this.ai === 'kamikaze' && d < 3.5 + this.radius) {
        this.die(pl);
        return;
      }
    } else if (this.ai === 'rain') {
      if (d < s.want - 4) wish.copy(dir).negate().add(perp.clone().multiplyScalar(0.5));
      else wish.copy(perp);
      wish.normalize();
      s.qbT -= dt;
      if (
        s.qbT <= 0 &&
        g.projectiles.some((p) => p.team !== this.team && p.pos.distanceToSquared(this.center()) < 80)
      ) {
        qb = true;
        s.qbT = rnd(1.5, 3);
      }
    } else if (this.ai === 'bastion') {
      if (d > s.want + 8) wish.copy(dir);
      else if (d < s.want - 10) wish.copy(dir).negate();
      wish.multiplyScalar(0.8);
    } else if (this.ai === 'duelist') {
      if (d > s.want + 2) wish.copy(dir).add(perp.clone().multiplyScalar(0.4));
      else wish.copy(perp);
      wish.normalize();
      s.qbT -= dt;
      const threat = g.projectiles.some(
        (p) => p.team !== this.team && p.pos.distanceToSquared(this.center()) < 120,
      );
      if (s.qbT <= 0 && ((threat && Math.random() < dt * 7) || Math.random() < dt * 0.5)) {
        qb = true;
        s.qbT = rnd(0.7, 1.4);
        wish.copy(perp).normalize();
      }
      if (d > 18 && Math.random() < dt * 0.9) ab = true;
    } else if (this.ai === 'strider') {
      // 尋找 40 m 內最近的高台／橋面頂，走上去佔高度
      if (!s.perch || s.perchT <= 0) {
        s.perchT = 6;
        let best = null,
          bd2 = 1e9;
        for (const o of g.world.obstacles) {
          if (o.kind !== 'box') continue;
          const dd = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
          if (dd < 45 && o.top > g.world.terrainHeight(o.x, o.z) + 2.5 && dd < bd2) {
            bd2 = dd;
            best = o;
          }
        }
        s.perch = best;
      }
      s.perchT -= dt;
      if (s.perch) {
        const to = new THREE.Vector3(s.perch.x - this.pos.x, 0, s.perch.z - this.pos.z);
        const dd = to.length();
        if (this.pos.y < s.perch.top - 0.5) {
          if (dd > 2) {
            wish.copy(to.normalize());
            if (dd < 8) hover = 2; // 跳起後爬升到台頂
          } else hover = 2;
        } else {
          wish.copy(perp).multiplyScalar(0.3);
        }
      } else {
        if (d > s.want + 6) wish.copy(dir);
        else wish.copy(perp).multiplyScalar(0.5);
      }
    } else if (this.ai === 'heli') {
      // 繞著目標盤旋
      wish.copy(perp).multiplyScalar(1.0);
      if (d > s.want + 5) wish.add(dir.clone().multiplyScalar(0.9));
      else if (d < s.want - 5) wish.sub(dir.clone().multiplyScalar(0.9));
      wish.normalize();
      this.flying = true;
    } else if (this.ai === 'swarm') {
      // 直線俯衝，接觸即爆
      wish.copy(dir);
      this.flying = true;
      const gnd = g.world.terrainHeight(this.pos.x, this.pos.z);
      this.hoverH = d > 14 ? 6 : clamp(pl.center().y - gnd, 0.6, 8);
      if (pl.center().distanceTo(this.center()) < this.radius + pl.radius + 0.6) {
        this.die(pl);
        return;
      }
    } else if (this.ai === 'drone') {
      wish.copy(perp).multiplyScalar(0.9);
      if (d > s.want + 4) wish.add(dir.clone().multiplyScalar(0.8));
      else if (d < s.want - 6) wish.sub(dir.clone().multiplyScalar(0.8));
      wish.normalize();
    } else {
      if (d > s.want + 6) wish.copy(dir).add(perp.clone().multiplyScalar(0.35));
      else if (d < s.want - 6) wish.copy(dir).negate().add(perp.clone().multiplyScalar(0.5));
      else wish.copy(perp);
      wish.normalize();
      if (s.stuck > 0.4) {
        s.strafe *= -1;
        s.stuck = 0;
        s.jumpT = 0.6;
        s.climb = true;
        wish.copy(dir);
      }
      s.jumpT -= dt;
      if (s.jumpT > 0) hover = s.climb ? 2 : true;
      else if (this.ai === 'ac' && Math.random() < dt * 0.25 && this.grounded) {
        s.jumpT = rnd(0.4, 1.0);
        s.climb = false;
      }
      // dodge: quick boost occasionally / when player fires
      s.qbT -= dt;
      const threat =
        (this.team === 'enemy' && g.playerFiredAt > 0) ||
        g.projectiles.some((p) => p.team === 'player' && p.pos.distanceToSquared(this.center()) < 64);
      if (
        this.ai !== 'mt' &&
        s.qbT <= 0 &&
        ((threat && Math.random() < dt * 3.5 * this.aiSkill) || Math.random() < dt * 0.3) &&
        this.team !== 'ally'
      ) {
        qb = true;
        s.qbT = rnd(1.2, 2.6);
        wish
          .copy(perp)
          .add(dir.clone().multiplyScalar(rnd(-0.4, 0.4)))
          .normalize();
      }
      if (this.ai === 'ac' && d > 40 && Math.random() < dt * 0.5) ab = true;
    }
    this.aiShock(dt, d, wish);
    // boss patterns
    if (this.isBoss && this.opts.bossKind === 'heli') this.heliBossAI(dt, d, dir, perp, wish, pl);
    else if (this.isBoss && !this.opts.bossKind) this.bossAI(dt, d, dir, perp, wish, pl);
    else {
      // firing
      s.fireT -= dt;
      if (this.ai === 'kamikaze' || this.ai === 'swarm') {
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      if (this.ai === 'sniper') {
        // 蓄力雷射：先 0.8 s 紅色瞄準線，再射
        const w = this.weapons.rarm;
        if (w.def.type === 'laser') {
          if (!w.charging && w.cd <= 0 && d < w.def.range + 5 && Math.random() < dt * 1.2) {
            w.charging = true;
            w.charge = 0;
            s.aimLine = 0.8;
          }
          if (w.charging) {
            w.charge += dt;
            const mz = this.muzzle('rarm');
            g.fx.beam(mz, aimPos, 0xff2020, 0.03);
            if (w.charge >= w.def.chargeT) {
              this.fire('rarm', aimPos, pl);
            }
          }
        }
        const w2 = this.weapons.larm;
        if (w2.def.type !== 'none' && d < w2.def.range && Math.random() < dt * 1.5)
          this.fire('larm', aimPos, pl);
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      if (this.ai === 'rain') {
        for (const slot of ['rback', 'lback']) {
          const w = this.weapons[slot];
          if (
            w.def.type === 'missile' &&
            w.cd <= 0 &&
            w.reloadT <= 0 &&
            d < w.def.range &&
            Math.random() < dt * 1.5
          ) {
            if (this.fire(slot, aimPos, pl)) {
              w.mag = 0;
              w.reloadT = 4.0;
              g.flashAlert('RAIN 導彈齊射！');
            }
          }
        }
        for (const slot of ['rarm', 'larm']) {
          const w = this.weapons[slot];
          if (w.def.type !== 'none' && d < w.def.range && Math.random() < dt * 5) this.fire(slot, aimPos, pl);
        }
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      for (const slot of ['rarm', 'larm', 'rback', 'lback']) {
        const w = this.weapons[slot];
        if (w.def.type === 'none' || w.def.type === 'shield') continue;
        const inR = d < w.def.range * (this.isBoss ? 1.2 : 1) + 2;
        if (!inR) continue;
        if (w.def.type === 'emp') {
          if (w.cd <= 0 && d < w.def.radius * 0.75 && Math.random() < dt * 1.5) this.fire(slot, aimPos, pl);
          continue;
        }
        if (w.def.type === 'empbeam') {
          if (!this.empLock && this.en > this.enMax * 0.3) this.fire(slot, pl.center(), pl);
          continue;
        }
        if (w.def.type === 'laser' && w.def.chargeT === 0) {
          if (Math.random() < dt * 2.2) this.fire(slot, pl.center(), pl);
          continue;
        }
        if (this.ai === 'heli' && w.def.type === 'shell') {
          if (Math.random() < dt * 0.45) this.fire(slot, aimPos, pl);
          continue;
        }
        if (this.ai === 'mt_gren') {
          if (w.def.type === 'grenade' && Math.random() < dt * 0.8) this.fire(slot, aimPos, pl);
          continue;
        }
        if (w.def.type === 'laser' && w.def.chargeT > 0 && this.ai === 'ac') {
          if (!w.charging && Math.random() < dt * 0.5 && w.cd <= 0) {
            w.charging = true;
            w.charge = 0;
          }
          if (w.charging) {
            w.charge += dt;
            if (w.charge >= w.def.chargeT) {
              this.fire(slot, aimPos, pl);
            }
            continue;
          }
        }
        if (w.def.type === 'melee') {
          if (this.melee.active) {
            if (Math.random() < dt * 12) this.fire(slot, aimPos, pl);
          } else if (d < w.def.range + 4 && w.cd <= 0 && Math.random() < dt * 2.5)
            this.fire(slot, aimPos, pl);
          continue;
        }
        if (
          Math.random() <
          dt *
            (w.def.type === 'missile' ? 0.5 : w.def.type === 'bullet' ? 9 : 1.8) *
            (this.ai === 'mt' ? 0.6 : 1) *
            this.aiSkill
        )
          this.fire(slot, aimPos, pl);
      }
    }
    this.move(dt, wish, hover, qb, ab, ab ? pl : null);
    if (this.ai === 'drone' || this.ai === 'heli') this.flying = true;
  }
  // Boss（地面型）與重型 AC（bastion）的踏地衝擊波：目標在範圍內且自己貼地時才用，預警期間停下
  aiShock(dt, d, wish) {
    const s = this.aiState;
    const boss = this.isBoss && !this.opts.bossKind;
    if ((!boss && this.ai !== 'bastion') || this.flying) return;
    if (s.shockT === undefined) s.shockT = rnd(4, 8);
    if (s.stompT > 0) {
      s.stompT -= dt;
      wish.set(0, 0, 0);
      return;
    }
    s.shockT -= dt;
    const R = boss ? 30 : 20;
    if (s.shockT > 0 || !this.grounded || d > R * 0.8 || !this.canAct() || this.melee.active) return;
    s.shockT = (boss ? rnd(7, 11) : rnd(10, 15)) * (s.phase === 2 ? 0.7 : 1);
    const dl = boss ? 0.9 : 0.8;
    s.stompT = dl;
    this.game.shockStart(this, {
      R,
      sp: boss ? 24 : 20,
      dl,
      dmg: (boss ? 650 : 380) * this.dmgMul,
      im: (boss ? 1300 : 800) * this.dmgMul,
    });
  }
  heliBossAI(dt, d, dir, perp, wish, pl) {
    const s = this.aiState,
      g = this.game;
    const aimPos = pl.center().addScaledVector(pl.vel, 0.4);
    const hp = this.hp / this.maxHp;
    // 三階段：兩側引擎依序被打爆 → 高度下降 → 最後迫降並週期性硬直
    if (hp < 0.66 && s.phase === 1) {
      s.phase = 2;
      this.hoverH = 6;
      g.flashMsg('HELIOS 左引擎受損 — 高度下降', 0xff8040, 2.2);
      g.fx.explosion(this.center().add(new THREE.Vector3(-4, 0, 0)), 5, 0xff7030, true);
      this.speedMul *= 0.85;
    }
    if (hp < 0.33 && s.phase === 2) {
      s.phase = 3;
      this.hoverH = 2.5;
      g.flashMsg('HELIOS 雙引擎失效 — 迫降！', 0xff4040, 2.5);
      g.fx.explosion(this.center().add(new THREE.Vector3(4, 0, 0)), 5, 0xff7030, true);
      this.speedMul *= 0.7;
      s.landT = 0;
    }
    if (s.phase === 3) {
      s.landT = (s.landT || 0) + dt;
      if (s.landT > 8) {
        s.landT = 0;
        this.acs = this.acsMax;
        this.staggerT = 3;
        g.flashAlert('HELIOS 系統過載');
      }
    }
    s.patT -= dt;
    if (s.patT <= 0) {
      s.pattern = (s.pattern + 1) % 3;
      s.patT = rnd(2.5, 4);
    }
    for (const slot of ['rarm', 'larm', 'rback', 'lback']) {
      const w = this.weapons[slot];
      if (!w || w.def.type === 'none') continue;
      if (s.pattern === 0 && w.def.type === 'bullet') this.fire(slot, aimPos, pl);
      if (s.pattern === 1 && w.def.type === 'missile') this.fire(slot, aimPos, pl);
      if (s.pattern === 2 && (w.def.type === 'shell' || w.def.type === 'bullet') && Math.random() < dt * 3)
        this.fire(slot, aimPos, pl);
    }
    this.flying = true;
  }
  bossAI(dt, d, dir, perp, wish, pl) {
    const s = this.aiState,
      g = this.game;
    const aimPos = pl.center().addScaledVector(pl.vel, 0.35);
    if (this.hp < this.maxHp * 0.5 && s.phase === 1) {
      s.phase = 2;
      this.speedMul *= 1.35;
      g.flashMsg('第二型態', 0xff4040);
      g.fx.ring(this.center(), 16, 0xff3020);
      this.iFrames = 0.5;
    }
    s.patT -= dt;
    if (s.patT <= 0) {
      s.pattern = (s.pattern + 1) % (s.phase === 2 ? 5 : 4);
      s.patT = rnd(2.2, 3.6);
      if (s.pattern === 3) {
        s.patT = 1.4;
        this.abT = 1.2;
      }
      if (s.pattern === 4) {
        s.patT = 2.6;
        s.sweepA = this.aimYaw - 0.9;
      }
    }
    for (const slot of ['rarm', 'larm', 'rback', 'lback']) {
      const w = this.weapons[slot];
      if (w.def.type === 'none') continue;
      switch (s.pattern) {
        case 0:
          if (w.def.type === 'bullet' || w.def.type === 'shotgun') this.fire(slot, aimPos, pl);
          break;
        case 1:
          if (w.def.type === 'missile' || w.def.type === 'grenade' || w.def.type === 'shell')
            this.fire(slot, aimPos, pl);
          break;
        case 2:
          if (w.def.type === 'bullet' || w.def.type === 'missile') this.fire(slot, aimPos, pl);
          break;
        case 3:
          if (w.def.type === 'melee' && d < 14) this.fire(slot, aimPos, pl);
          else if (w.def.type === 'shotgun' && d < 20) this.fire(slot, aimPos, pl);
          break;
        case 4:
          if (w.def.type === 'laser') {
            s.sweepA += dt * 0.9;
            const tp = this.center().add(
              new THREE.Vector3(-Math.sin(s.sweepA), 0, -Math.cos(s.sweepA)).multiplyScalar(60),
            );
            tp.y = pl.center().y;
            this.aimYaw = s.sweepA;
            this.fire(slot, tp, pl);
          } else if (w.def.type === 'bullet') this.fire(slot, aimPos, pl);
          break;
      }
    }
  }
}
