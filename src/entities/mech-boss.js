// ---------- MechEntity 擴充：新 Boss 與附屬部位 ----------
// 鑽地蟲 worm、多足要塞 spider、空中要塞 fortress、護盾指揮艦 flagship、砲兵陣地 artillery、電磁狩獵機 hunter；
// 附屬部位 ai 'part'（partKind：joint 腳部關節、fturret 懸吊砲塔、engine 引擎、pylon 護盾發生器、cannon 長程砲台）。
// 部位是獨立的敵方實體（血量、鎖定、擊破、同步都和一般敵人相同），opts.parent＝Boss 的 id；
// 有 opts.mount 的掛在 Boss 模型的 mounts[mount] 節點上，每格（房主與客機）跟著移動。
// 行為只在房主／單機執行；客機靠快照的 sx（bossVis：鑽地蟲在地下、多足要塞斷腿與倒下；linkId：牽引／護盾連線）顯示。
// 第三批 Boss（電磁砲台、浮游砲、武裝列車…）在 mech-boss2.js，這裡的掛勾轉過去（boss2*）。
import { SFX } from '../audio/audio.js';
import { clamp, lerp, rnd } from '../core/math.js';
import { animateMech } from '../render/mech-model.js';
import { buildWormSegments } from '../render/boss-models.js';
import { MechEntity } from './mech-entity.js';

const BOSS_AI = new Set(['worm', 'spider', 'fortress', 'flagship', 'artillery', 'hunter']);
const WORM_SEGS = 16;
const ARENA = 60; // 場地邊界（world.collide 限制在 ±62）

Object.assign(MechEntity.prototype, {
  bossInit() {
    this.boss2Init();
    if (this.ai === 'part' || this.ai === 'worm') this.noPush = true; // 不參與機體互推
    if (this.ai === 'part' && this.opts.partKind === 'pylon') {
      this.linkKind = 2; // 護盾連線（發生器 → 指揮艦）
    }
  },
  // Boss 的附屬部位（還活著的）
  partsOf(kind) {
    return this.game.enemies.filter(
      (e) => !e.dead && e.opts.parent === this.id && (!kind || e.opts.partKind === kind),
    );
  },
  parentEnt() {
    const id = this.opts.parent;
    return id === undefined || id === null ? null : this.game.entById(id);
  },
  // 掛載的部位：移到 Boss 模型節點的世界位置（中心對齊節點）
  partFollow() {
    if (this.opts.mount === undefined || this.opts.mount === null) return;
    const par = this.parentEnt();
    const node = par && par.model.mounts && par.model.mounts[this.opts.mount];
    if (!node) return;
    par.mesh.updateMatrixWorld(true);
    node.getWorldPosition(this.pos);
    this.pos.y -= this.model.height * 0.5;
    this.yaw = par.yaw;
  },
  // 不用 move() 的實體（部位、鑽地蟲）每格要做的事：計時器、ACS 回復、模型位置與閃光
  bossTick(dt) {
    this.t += dt;
    for (const k in this.weapons) {
      const w = this.weapons[k];
      if (w.cd > 0) w.cd -= dt;
      if (w.reloadT > 0) {
        w.reloadT -= dt;
        if (w.reloadT <= 0) w.mag = Math.min(w.def.mag, w.ammo);
      }
    }
    if (this.iFrames > 0) this.iFrames -= dt;
    if (this.staggerT > 0) {
      this.staggerT -= dt;
      if (this.staggerT <= 0) this.acs = 0;
    } else if (this.acsDecayDelay > 0) this.acsDecayDelay -= dt;
    else this.acs = Math.max(0, this.acs - this.acsMax * 0.45 * dt);
    this.recoil.l = Math.max(0, this.recoil.l - dt * 8);
    this.recoil.r = Math.max(0, this.recoil.r - dt * 8);
    this.vel.set(0, 0, 0);
    this.grounded = false;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw;
    animateMech(this.model, dt, { t: this.t, leanX: 0, leanZ: 0 });
    this.specialFx(dt);
  },
  // ---------- 移動（mech-special.js 的 aiSpecialMove 轉過來）----------
  bossMove(dt, d, dir, perp, wish, pl) {
    const r = { hover: false, qb: false, ab: false, done: false };
    if (this.ai !== 'part' && !BOSS_AI.has(this.ai)) return this.boss2Move(dt, d, dir, perp, wish, pl, r);
    switch (this.ai) {
      case 'part':
        this.partAI(dt, d, pl);
        r.done = true;
        break;
      case 'worm':
        this.wormAI(dt, d, dir, pl);
        r.done = true;
        break;
      case 'spider':
        this.spiderAI(dt, d, dir, perp, wish);
        break;
      case 'fortress':
        this.fortressAI(dt, d, dir, perp, wish, pl);
        break;
      case 'flagship':
        this.flagshipAI(dt, d, dir, perp, wish);
        break;
      case 'artillery':
        this.artilleryAI(dt, pl);
        break;
      case 'hunter':
        this.hunterAI(dt, d, dir, perp, wish, pl, r);
        break;
    }
    return r;
  },
  // 開火：一般武器迴圈照常（回傳 false），部位與鑽地蟲在自己的 AI 裡處理；第三批 Boss 見 boss2Fire
  bossFire(dt, d, aimPos, pl) {
    return this.boss2Fire(dt, d, aimPos, pl);
  },
  phase2() {
    return this.hp < this.maxHp * 0.5;
  },
  // ---------- 附屬部位 ----------
  partAI(dt, d, pl) {
    if (this.part2AI(dt, d, pl)) return; // 浮游砲、列車車廂
    const g = this.game,
      s = this.aiState;
    const k = this.opts.partKind;
    this.partFollow();
    const par = this.parentEnt();
    const p2 = par && par.phase2 && par.phase2();
    const aimPos = pl.center().addScaledVector(pl.vel, clamp(d / 95, 0, 0.6));
    if (k === 'fturret') {
      const w = this.weapons.rarm;
      if (this.canAct() && d < 75 && Math.random() < dt * (p2 ? 5 : 3.5)) this.fire('rarm', aimPos, pl);
      if (w.mag <= 0 && w.reloadT <= 0 && w.ammo > 0) w.reloadT = w.def.reload;
    } else if (k === 'cannon') {
      // 三發一組的砲擊（落點有預警圈）
      s.salT = (s.salT === undefined ? rnd(2, 5) : s.salT) - dt;
      if (s.salT <= 0 && this.canAct() && d < 95) {
        s.salT = p2 ? rnd(3.5, 5) : rnd(5, 7);
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.5);
        if (lead.length() > 6) lead.setLength(6);
        const c = pl.pos.clone().add(lead);
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2,
            rr = i ? rnd(3, 6) : rnd(0, 1.5);
          const tp = c.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr));
          g.mortarShot(this, tp, { dmg: 480 * this.dmgMul, im: 700 * this.dmgMul, R: 5 });
        }
      }
    } else if (k === 'pylon') {
      this.linkId = par && !par.dead ? par.id : -1;
    }
    // 砲塔轉向目標
    if (k === 'cannon' || k === 'fturret') {
      const rel = this.aimYaw - this.yaw;
      this.model.torso.rotation.y = lerp(
        this.model.torso.rotation.y,
        Math.atan2(Math.sin(rel), Math.cos(rel)),
        0.2,
      );
    }
    if (this.model.rotor) this.model.rotor.rotation.y += dt * 1.5;
    this.bossTick(dt);
  },
  // Boss 被擊破時，剩下的部位一起毀壞（不給賞金）
  partBreak() {
    if (this.dead) return;
    const g = this.game;
    g.fx.explosion(this.center(), 3, 0xffa040, true);
    this.depart();
  },
  // ---------- 鑽地蟲：地下移動（無敵）→ 預警圈 → 鑽出（範圍傷害＋衝擊波）→ 停在空中（弱點暴露）→ 鑽回地下 ----------
  wormAI(dt, d, dir, pl) {
    const g = this.game,
      w = g.world,
      s = this.aiState;
    const dm = this.dmgMul;
    const p2 = this.phase2();
    this.flying = true;
    if (!s.wm) {
      s.wm = 'burrow';
      s.wmT = rnd(2.5, 4);
      this.pos.y = w.terrainHeight(this.pos.x, this.pos.z) - 7;
    }
    const gy = w.terrainHeight(this.pos.x, this.pos.z);
    const v = this.vel0 || (this.vel0 = new THREE.Vector3());
    const gp = () => this.pos.clone().setY(gy);
    let ty = gy - 7;
    switch (s.wm) {
      case 'burrow': {
        this.iFrames = Math.max(this.iFrames, 0.15);
        const to = pl.pos.clone().sub(this.pos).setY(0);
        const dd = to.length();
        const sp = p2 ? 22 : 17;
        if (dd > 0.1) to.divideScalar(dd);
        // 第二型態：從玩家身邊掠過，沿路連續噴發
        if (p2 && s.sweep) {
          v.lerp(s.sweep, Math.min(1, dt * 3));
          s.sweepT -= dt;
          s.erupT = (s.erupT || 0) - dt;
          if (s.erupT <= 0) {
            s.erupT = 0.4;
            g.shockStart(this, { R: 6, sp: 12, dl: 0.35, dmg: 170 * dm, im: 500 * dm, at: gp() });
          }
          if (s.sweepT <= 0) s.sweep = null;
        } else {
          v.x = lerp(v.x, to.x * sp, Math.min(1, dt * 2));
          v.z = lerp(v.z, to.z * sp, Math.min(1, dt * 2));
          if (p2 && !s.sweep && dd < 25 && Math.random() < dt * 0.4) {
            s.sweep = to.clone().multiplyScalar(26);
            s.sweepT = 2.2;
            g.alertAll('鑽地蟲地下衝刺 — 沿路噴發！');
          }
        }
        s.wmT -= dt;
        if ((dd < 4 || s.wmT <= 0) && !s.sweep) {
          s.wm = 'warn';
          s.wmT = 1.0;
          v.set(0, 0, 0);
          g.fx.warnCircle(gp(), 7, 1.0);
          g.netEv({
            t: 'warn',
            p: gp()
              .toArray()
              .map((x) => +x.toFixed(2)),
            R: 7,
            dl: 1.0,
          });
          SFX.play('heavy', 0.9, 0.6, 0.05, 0.05, gp());
        }
        if (Math.random() < dt * 14) g.fx.dust(gp(), 1.6, 3);
        break;
      }
      case 'warn':
        this.iFrames = Math.max(this.iFrames, 0.15);
        s.wmT -= dt;
        if (Math.random() < dt * 30)
          g.fx.dust(gp().add(new THREE.Vector3(rnd(-4, 4), 0, rnd(-4, 4))), 1.4, 2);
        if (s.wmT <= 0) {
          s.wm = 'rise';
          s.wmT = 0.7;
          this.pos.y = gy - 3;
          // 鑽出：正上方 7 m 內大傷害並往上掀，外圍衝擊波
          for (const t of g.hostilesOfEnt(this)) {
            if (t.dead || t.isProp || !t.pos) continue;
            if (Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) > 7 + t.radius * 0.5) continue;
            if (t.pos.y - gy > 5) continue;
            t.takeDamage(560 * dm, 1200 * dm, this, t.center(), new THREE.Vector3(0, 1, 0));
            if (!t.flying) {
              t.vel.y = Math.max(t.vel.y, 16);
              t.grounded = false;
            }
          }
          g.shockStart(this, { R: 18, sp: 22, dl: 0, dmg: 220 * dm, im: 600 * dm, at: gp() });
          g.fx.explosion(gp().setY(gy + 1), 6, 0xc8a070, true);
          g.fx.dust(gp(), 6, 22, 0xb09070);
          g.camShake = Math.max(g.camShake, 0.3);
        }
        break;
      case 'rise':
        ty = gy + 12;
        s.wmT -= dt;
        if (s.wmT <= 0) {
          s.wm = 'up';
          s.wmT = p2 ? 3.5 : 4.5;
        }
        break;
      case 'up': {
        ty = gy + 11 + Math.sin(this.t * 1.6);
        // 硬直（ACS／EMP）時停留時間不減：暴露更久
        if (this.staggerT <= 0) s.wmT -= dt;
        const aimPos = pl.center().addScaledVector(pl.vel, 0.3);
        if (this.canAct()) {
          if (Math.random() < dt * 6) this.fire('rarm', aimPos, pl);
          if (Math.random() < dt * 0.7) this.fire('rback', aimPos, pl);
          const wr = this.weapons.rarm;
          if (wr.mag <= 0 && wr.reloadT <= 0 && wr.ammo > 0) wr.reloadT = wr.def.reload;
        }
        v.x = lerp(v.x, Math.sin(this.t * 0.9) * 2, 0.05);
        v.z = lerp(v.z, Math.cos(this.t * 0.7) * 2, 0.05);
        if (s.wmT <= 0) {
          s.wm = 'dive';
          s.wmT = 2.5;
          s.hitGround = false;
          v.copy(dir).multiplyScalar(14);
        }
        break;
      }
      case 'dive':
        ty = gy - 7;
        s.wmT -= dt;
        if (!s.hitGround && this.pos.y < gy + 1) {
          s.hitGround = true;
          g.shockStart(this, { R: 14, sp: 18, dl: 0, dmg: 240 * dm, im: 700 * dm, at: gp() });
          g.fx.dust(gp(), 5, 18, 0xb09070);
        }
        if (this.pos.y < gy - 5 || s.wmT <= 0) {
          s.wm = 'burrow';
          s.wmT = rnd(3, 5);
        }
        break;
    }
    // 垂直：鑽出最快、潛入其次
    const vk = s.wm === 'rise' ? 7 : s.wm === 'dive' ? 2.2 : 3;
    v.y = (ty - this.pos.y) * vk;
    if (s.wm === 'dive') v.y = Math.min(v.y, -6);
    this.pos.addScaledVector(v, dt);
    this.pos.x = clamp(this.pos.x, -ARENA, ARENA);
    this.pos.z = clamp(this.pos.z, -ARENA, ARENA);
    const hs = Math.hypot(v.x, v.z);
    if (s.wm === 'up') {
      const a = Math.atan2(-(pl.pos.x - this.pos.x), -(pl.pos.z - this.pos.z));
      this.yaw = a;
      this.aimYaw = a;
    } else if (hs > 1) this.yaw = Math.atan2(-v.x, -v.z);
    this.bossVis = s.wm === 'burrow' || s.wm === 'warn' ? 1 : 0;
    this.bossTick(dt);
    this.vel.copy(v); // 快照與瞄準預判用
    // 頭部俯仰跟著移動方向
    const pitch = s.wm === 'up' ? 0.25 : Math.atan2(v.y, Math.max(hs, 1));
    this.mesh.rotation.x = lerp(this.mesh.rotation.x, clamp(pitch, -1.2, 1.3), 0.15);
  },
  // ---------- 多足要塞：腳部關節全在時機身裝甲很厚；斷三條腿倒下、核心暴露；定期躍起砸地 ----------
  spiderAI(dt, d, dir, perp, wish) {
    const g = this.game,
      s = this.aiState;
    const joints = this.partsOf('joint');
    let mask = 0;
    for (let i = 0; i < 6; i++) if (!joints.some((j) => j.opts.mount === i)) mask |= 1 << i;
    const broken = joints.length < 6 ? 6 - joints.length : 0;
    if (s.base === undefined) s.base = this.speedMul;
    this.speedMul = s.base * (1 - broken * 0.12);
    if (broken >= 3 && !s.collapsed) {
      s.collapsed = true;
      this.acs = this.acsMax;
      this.staggerT = 7;
      g.msgAll('多足要塞失去平衡 — 核心暴露！', 0xffb020);
      g.fx.dust(this.pos.clone(), 8, 24, 0xb09070);
      g.camShake = Math.max(g.camShake, 0.35);
    }
    this.bossVis = mask | (s.collapsed && this.staggerT > 0 ? 64 : 0);
    // 移動：保持中距離
    if (d > s.want + 6) wish.copy(dir).multiplyScalar(0.8);
    else if (d < s.want - 8) wish.copy(dir).multiplyScalar(-0.6);
    else wish.copy(perp).multiplyScalar(0.4);
    // 躍起砸地
    s.slamT = (s.slamT === undefined ? rnd(6, 9) : s.slamT) - dt;
    if (s.slamT <= 0 && this.grounded && broken < 3 && d < 32 && this.canAct()) {
      s.slamT = this.phase2() ? rnd(8, 10) : rnd(11, 14);
      s.slamAir = true;
      s.wasAir = false;
      this.vel.y = 20;
      this.grounded = false;
      g.alertAll('多足要塞躍起 — 準備跳躍閃避落地衝擊波！');
    }
    if (s.slamAir) {
      if (!this.grounded) s.wasAir = true;
      else if (s.wasAir) {
        s.slamAir = false;
        g.shockStart(this, { R: 26, sp: 22, dl: 0.2, dmg: 420 * this.dmgMul, im: 1000 * this.dmgMul });
        g.fx.dust(this.pos.clone(), 7, 20, 0xb09070);
        g.camShake = Math.max(g.camShake, 0.4);
      }
    }
  },
  // ---------- 空中要塞：引擎還在時機身幾乎打不動；投放運輸機與無人機、投彈 ----------
  fortressAI(dt, d, dir, perp, wish, pl) {
    const g = this.game,
      s = this.aiState;
    this.flying = true;
    const engines = this.partsOf('engine').length;
    if (!engines && !s.down) {
      s.down = true;
      this.hoverH = 10;
      this.speedMul *= 0.7;
      g.msgAll('引擎全毀 — 空中要塞高度下降！', 0xffb020);
    }
    // 繞著目標慢慢盤旋
    wish.copy(perp).multiplyScalar(0.8);
    if (d > 28) wish.add(dir.clone().multiplyScalar(0.7));
    else if (d < 12) wish.sub(dir.clone().multiplyScalar(0.7));
    wish.normalize();
    const alive = g.enemies.filter((e) => !e.dead).length;
    s.dropT = (s.dropT === undefined ? 12 : s.dropT) - dt;
    if (s.dropT <= 0) {
      s.dropT = this.phase2() ? 22 : 28;
      if (alive < 14 && !g.enemies.some((e) => !e.dead && e.ai === 'dropship')) {
        g.spawnType('dropship', g.scaleHp || 1, g.scaleDmg || 1, this.pos.clone().setY(this.pos.y - 3), 1);
        g.alertAll('空中要塞放出運輸機');
      }
    }
    s.swT = (s.swT === undefined ? 20 : s.swT) - dt;
    if (s.swT <= 0) {
      s.swT = 24;
      if (alive < 14)
        g.spawnType('swarm', g.scaleHp || 1, g.scaleDmg || 1, this.pos.clone().setY(this.pos.y - 3), 3);
    }
    // 投彈：沿機身前進方向一排落點
    s.bombT = (s.bombT === undefined ? 8 : s.bombT) - dt;
    if (s.bombT <= 0 && d < 35 && this.canAct()) {
      s.bombT = this.phase2() ? 10 : 14;
      s.bombN = 6;
      s.bombI = 0;
      const f = this.vel.clone().setY(0);
      s.bombDir = f.lengthSq() > 1 ? f.normalize() : perp.clone();
      s.bombAt = pl.pos.clone();
      g.alertAll('空中要塞投彈！');
    }
    if (s.bombN > 0) {
      s.bombI -= dt;
      if (s.bombI <= 0) {
        s.bombI = 0.22;
        const k = 6 - s.bombN - 2.5;
        g.mortarShot(this, s.bombAt.clone().addScaledVector(s.bombDir, k * 5), {
          dmg: 420 * this.dmgMul,
          im: 700 * this.dmgMul,
          R: 5,
        });
        s.bombN--;
      }
    }
  },
  // ---------- 護盾指揮艦：發生器還在時本體無敵（護盾也罩住附近友軍）；發生器全毀 25 秒後重建；呼叫運輸機、強化友軍 ----------
  flagshipAI(dt, d, dir, perp, wish) {
    const g = this.game,
      s = this.aiState;
    if (!s.anchor) s.anchor = this.pos.clone();
    const pylons = this.partsOf('pylon').length;
    this.domeR = 15;
    this.domeInf = true;
    this.domeFrac = pylons ? 1 : 0;
    if (!pylons) {
      if (!s.rebuildT) {
        s.rebuildT = 25;
        g.msgAll('護盾發生器全毀 — 指揮艦護盾解除（25 秒後重建）', 0x7ee081);
      }
      s.rebuildT -= dt;
      if (s.rebuildT <= 0) {
        s.rebuildT = 0;
        g.spawnPylons(this);
        g.alertAll('護盾發生器重建完成');
      }
    } else s.rebuildT = 0;
    // 待在原地附近，面向目標橫移
    const home = s.anchor.clone().sub(this.pos).setY(0);
    if (home.length() > 8) wish.copy(home.normalize()).multiplyScalar(0.8);
    else wish.copy(perp).multiplyScalar(0.3);
    if (d < 12) wish.addScaledVector(dir, -1);
    // 強化附近友軍、呼叫運輸機
    for (const f of this.friendsOf())
      if (f !== this && !f.dead && f.ai !== 'part' && f.pos.distanceTo(this.pos) < 40) f.buffT = 0.3;
    s.dropT = (s.dropT === undefined ? 15 : s.dropT) - dt;
    if (s.dropT <= 0) {
      s.dropT = this.phase2() ? 24 : 32;
      if (
        g.enemies.filter((e) => !e.dead).length < 14 &&
        !g.enemies.some((e) => !e.dead && e.ai === 'dropship')
      ) {
        g.spawnType('dropship', g.scaleHp || 1, g.scaleDmg || 1);
        g.alertAll('指揮艦呼叫運輸機');
      }
    }
  },
  // ---------- 砲兵陣地：指揮所不動；砲台還在時裝甲很厚；定期砲擊彈幕、補布雷無人機 ----------
  artilleryAI(dt, pl) {
    const g = this.game,
      s = this.aiState;
    const cannons = this.partsOf('cannon').length;
    if (!cannons && !s.open) {
      s.open = true;
      g.msgAll('砲台全滅 — 指揮所裝甲解除！', 0x7ee081);
    }
    s.barT = (s.barT === undefined ? 12 : s.barT) - dt;
    if (s.barT <= 0 && this.canAct()) {
      s.barT = this.phase2() ? 14 : 20;
      s.barN = 8;
      s.barI = 0;
      s.barAt = pl.pos.clone();
      g.alertAll('砲擊彈幕來襲 — 注意地面預警圈！');
    }
    if (s.barN > 0) {
      s.barI -= dt;
      if (s.barI <= 0) {
        s.barI = 0.18;
        s.barN--;
        const a = Math.random() * Math.PI * 2,
          rr = rnd(0, 18);
        g.mortarShot(this, s.barAt.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), {
          dmg: 420 * this.dmgMul,
          im: 650 * this.dmgMul,
          R: 5,
        });
      }
    }
    s.mlT = (s.mlT === undefined ? 18 : s.mlT) - dt;
    if (s.mlT <= 0) {
      s.mlT = 25;
      if (g.enemies.filter((e) => !e.dead && e.ai === 'minelayer').length < 2)
        g.spawnType('minelayer', g.scaleHp || 1, g.scaleDmg || 1, this.center().setY(this.pos.y + 8), 1);
    }
    if (this.model.rotor) this.model.rotor.rotation.y += dt * 1.2;
  },
  // ---------- 電磁狩獵機：大範圍 EMP（封鎖 QB 與懸浮）、電磁牽引後近戰 ----------
  hunterAI(dt, d, dir, perp, wish, pl, r) {
    const g = this.game,
      s = this.aiState;
    const p2 = this.phase2();
    this.linkId = -1;
    // EMP 充能中：停下，藍色預警圈
    if (s.empC > 0) {
      s.empC -= dt;
      wish.set(0, 0, 0);
      if (s.empC <= 0) g.hunterEmp(this, 20);
      return;
    }
    s.empT = (s.empT === undefined ? rnd(5, 7) : s.empT) - dt;
    if (s.empT <= 0 && d < 24 && this.grounded && this.canAct() && !this.melee.active) {
      s.empT = p2 ? rnd(7, 9) : rnd(10, 13);
      s.empC = 1.3;
      const p = this.pos.clone();
      g.fx.warnCircle(p, 20, 1.3, 0x40a0ff);
      g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R: 20, dl: 1.3, c: 0x40a0ff });
      SFX.play('charge', 1, 0.8, 0.05, 0.05, this.center());
      g.alertAll('電磁脈衝充能 — 拉開距離或跳高！');
      return;
    }
    // 牽引
    if (s.pull > 0) {
      s.pull -= dt;
      if (pl.dead || d < 7 || !this.canAct()) s.pull = 0;
      else {
        this.linkId = pl.id;
        this.linkKind = 1;
        pl.pullT = 0.15;
        pl.pullSrc = this;
      }
      wish.copy(dir).multiplyScalar(0.4);
      return;
    }
    s.pullCd = (s.pullCd === undefined ? rnd(5, 7) : s.pullCd) - dt;
    if (s.pullCd <= 0 && d > 10 && d < 40 && this.canAct()) {
      s.pullCd = p2 ? rnd(6, 8) : rnd(9, 12);
      s.pull = 2.0;
      SFX.play('laser2', 0.8, 0.5, 0.05, 0.05, this.center());
      g.alertAll('電磁牽引 — 往反方向移動或 QB 掙脫！');
      return;
    }
    // 貼身追擊
    if (d > 9) wish.copy(dir).add(perp.clone().multiplyScalar(0.3)).normalize();
    else wish.copy(perp).multiplyScalar(0.6);
    s.qbT -= dt;
    const threat = g.projectiles.some(
      (q) => q.team !== this.team && q.pos.distanceToSquared(this.center()) < 140,
    );
    if (s.qbT <= 0 && threat && Math.random() < dt * 5) {
      r.qb = true;
      s.qbT = rnd(0.8, 1.6);
      wish.copy(perp).normalize();
    }
    if (d > 28 && Math.random() < dt * 0.8) r.ab = true;
  },
  // ---------- 受傷前的修正（specialDefense 先呼叫）：回傳 [傷害, 衝擊]，null＝擋下 ----------
  bossDefense(dmg, impact, from, at, wid, melee) {
    const g = this.game,
      s = this.aiState;
    let k = 1;
    const hint = (txt) => {
      if (from && from.isPlayer && !s.hinted) {
        s.hinted = true;
        g.flashAlert(txt);
      }
    };
    const k2 = this.boss2Defense(dmg, impact, from, at, wid, melee);
    if (k2 === null) return null;
    if (k2 !== undefined) k = k2;
    switch (this.ai) {
      case 'worm':
        if (this.bossVis & 1) return null;
        k = 1.3; // 頭部感測器
        break;
      case 'spider': {
        const broken = 6 - this.partsOf('joint').length;
        k = s.collapsed ? (this.staggerT > 0 ? 1.4 : 1) : 0.2 + broken * 0.15;
        if (!s.collapsed) hint('機身裝甲過厚 — 先破壞腳部關節');
        break;
      }
      case 'fortress':
        if (this.partsOf('engine').length) {
          k = 0.15;
          hint('機身裝甲過厚 — 先破壞翼端的引擎');
        }
        break;
      case 'artillery':
        if (this.partsOf('cannon').length) {
          k = 0.12;
          hint('指揮所裝甲過厚 — 先摧毀四座砲台');
        }
        break;
      case 'flagship':
        this.domeFrac = this.partsOf('pylon').length ? 1 : 0; // 發生器剛被拆光的同一格也立刻解除
        if (this.domeFrac) {
          if (at) g.fx.spark(at, 0x80e0ff);
          hint('護盾無法穿透 — 先拆除護盾發生器');
          return null;
        }
        break;
    }
    if (k < 1 && at && Math.random() < 0.5) g.fx.spark(at, 0xffd080);
    return [dmg * k, impact * k];
  },
  bossDie(from) {
    const g = this.game;
    this.boss2Die(from);
    if (!this.isBoss) return;
    for (const p of this.partsOf()) p.partBreak();
    g.removeMinesOf(this);
  },
  // ---------- 顯示（房主與客機）：部位跟隨、鑽地蟲身體、多足要塞的腿 ----------
  bossFx(dt) {
    if (this.ai === 'part' && this.remote) this.partFollow();
    if (this.ai === 'worm') this.wormFx();
    if (this.model.legNodes && this.model.legNodes.length) this.spiderFx(dt);
    this.boss2Fx(dt);
  },
  // 身體各節沿著頭部走過的軌跡排列（入地的部分被地形擋住）
  wormFx() {
    const g = this.game;
    if (this.dead) {
      g.wormBurst(this);
      return;
    }
    if (!this.wormSegs) {
      const seg = buildWormSegments(this.pal, WORM_SEGS);
      this.wormSegs = seg.list;
      for (const m of seg.list) g.scene.add(m);
      this.wormPath = [];
      for (let i = 0; i < WORM_SEGS * 4; i++)
        this.wormPath.push(this.pos.clone().add(new THREE.Vector3(0, -i * 0.6, 0)));
    }
    const path = this.wormPath;
    if (path[0].distanceTo(this.pos) > 0.5) {
      path.unshift(this.pos.clone());
      if (path.length > WORM_SEGS * 6) path.length = WORM_SEGS * 6;
    }
    // 沿軌跡每 2.4 m 放一節
    const gap = 2.4;
    let acc = 0,
      j = 0;
    const head = this.center();
    let prev = head;
    for (let i = 0; i < path.length && j < WORM_SEGS; i++) {
      const p = path[i].clone();
      p.y += this.model.height * 0.5;
      acc += p.distanceTo(prev);
      if (acc >= gap * (j + 1)) {
        const m = this.wormSegs[j];
        m.position.copy(p);
        m.lookAt(prev);
        m.visible = true;
        j++;
      }
      prev = p;
    }
    for (; j < WORM_SEGS; j++) this.wormSegs[j].visible = false;
  },
  // 多足要塞的腿：三腳步態擺動；斷掉的腿隱藏；倒下時機身降低並往斷腿那側傾
  spiderFx(dt) {
    const m = this.model;
    const mask = this.bossVis || 0;
    const moving = this.vel ? Math.hypot(this.vel.x, this.vel.z) > 0.8 : false;
    this.gaitT = (this.gaitT || 0) + dt * (moving ? 3.2 : 0.8);
    let tx = 0,
      tz = 0;
    m.legNodes.forEach((L, i) => {
      const broken = (mask >> i) & 1;
      if (broken && L.leg.visible) {
        L.leg.visible = false;
        this.game.fx.explosion(
          this.pos.clone().add(new THREE.Vector3(Math.cos(L.a) * 7, 4, Math.sin(L.a) * 7)),
          3,
          0xffa040,
          true,
        );
      }
      if (broken) {
        tx += Math.cos(L.a);
        tz += Math.sin(L.a);
        return;
      }
      const ph = this.gaitT + (i % 2) * Math.PI;
      L.hip.rotation.y = -L.a + Math.sin(ph) * (moving ? 0.22 : 0.05);
      L.leg.rotation.z = Math.max(0, Math.cos(ph)) * (moving ? 0.18 : 0.03);
    });
    const down = mask & 64 ? -3.5 : 0;
    m.body.position.y = lerp(m.body.position.y, down, Math.min(1, dt * 3));
    // 往斷腿那側傾斜（機體座標：腿的角度 a 在 XZ 平面）
    const n = Math.hypot(tx, tz);
    const tiltX = n ? (tz / n) * 0.12 : 0,
      tiltZ = n ? (-tx / n) * 0.12 : 0;
    m.body.rotation.x = lerp(m.body.rotation.x, tiltX, Math.min(1, dt * 2));
    m.body.rotation.z = lerp(m.body.rotation.z, tiltZ, Math.min(1, dt * 2));
  },
  bossCleanup() {
    this.boss2Cleanup();
    if (this.wormSegs) {
      for (const m of this.wormSegs) this.game.scene.remove(m);
      this.wormSegs = null;
    }
  },
});
