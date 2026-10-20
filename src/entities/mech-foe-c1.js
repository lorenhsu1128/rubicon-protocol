// ---------- MechEntity 擴充：地圖專屬敵人擴充（C1 組，data/foes-c1.js）----------
// 冰原：cryo 冷凍噴霧機（噴嘴結霜白光預警 → 錐形冷凍霧：損傷＋'slow'）、icemortar 冰錐迫擊砲（白圈預警的拋射冰錐 →
// 落點傷害＋臨時冰牆 addTempWall）。
// 地下技研都市：holoproj 全像投影器（投出 3 個 holofake 假敵人：可以鎖定、搶走鎖定、打一下就消失、不給賞金；
// 本體被擊破全部消失）、parasite 寄生纏附體（蹲低預警 → 撲擊 → 'latch' 纏附：跟著目標的機體、不能鎖定，
// 被甩掉時彈開並硬直）。
// Grid 086：anchor 重力錨（紫圈預警 → 重力圈 addZone 'gravity'）、zipline 滑索突擊兵（纜索閃光預警 → 從上層平台
// 沿纜索滑到目標背後，落地 0.8 秒破綻（受傷 ×1.3）→ 近距離霰彈；之後再爬回平台）。
// 行為只在房主／單機（foeMove_c1、foeFire_c1、foeDefense_c1）；顯示 foeFx_c1 在房主與客機每格依 bossVis 驅動模型。
// bossVis：cryo 1 預警 2 噴霧；icemortar 1 預警 2 後座；holoproj 1 預警 2 投影；parasite 1 蹲伏 2 纏附 4 硬直；
// anchor 1 預警 2 力場；zipline 1 纜索預警 2 滑行 4 破綻。
// 狀態效果（entities/mech-status.js 的 addStatus）與場上機制（game/hazards2.js 的 addZone、addTempWall）。
import { SFX } from '../audio/audio.js';
import { lerp, rnd } from '../core/math.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { MechEntity } from './mech-entity.js';
import { Projectile } from './projectile.js';

const C1_AI = new Set(['cryo', 'icemortar', 'holoproj', 'holofake', 'parasite', 'anchor', 'zipline']);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
// 數值（dm＝敵人的火力倍率另外乘）
const CRYO = { warn: 0.8, t: 1.4, len: 14, w: 7, dmg: 45, im: 150, tick: 0.25, cd: [5.5, 7] };
const MORTAR = { warn: 0.6, T: 1.5, R: 4, dmg: 480, im: 820, G: 30, cd: [5.5, 7] };
const WALL = { kind: 'ice', w: 6, h: 3.2, d: 1.2, hp: 900, life: 20 };
const WALL_BACK = 1.8; // 冰牆離落點（往砲台側）
const HOLO = { warn: 0.7, n: 3, life: 30, cd: 14 };
const PARA = { crouch: 0.7, leap: 0.45, range: 7.5, dps: 120, bite: 150, biteIm: 350, cd: 3, stun: 1.6 };
const ANCHOR = { warn: 1.2, R: 14, life: 8, cd: [12, 14] };
const ZIP = { warn: 0.9, speed: 26, vuln: 0.8, vulnK: 1.3, again: [10, 13] };
const BITE = { kb: 4 };
const CYAN = 0x60fff0,
  FROST = 0xcff4ff,
  PURPLE = 0xb060ff,
  ZIPC = 0xffd040;

// 預警圈（客機以 warn 事件顯示）
function warnAt(g, p, R, dl, c) {
  g.fx.warnCircle(p, R, dl, c);
  g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R, dl, c });
}

Object.assign(MechEntity.prototype, {
  // aiSpecialMove 轉過來（mech-foe.js 的 foeMove）：回傳 undefined＝不是 C1 的敵人
  foeMove_c1(dt, d, dir, perp, wish, pl) {
    if (!C1_AI.has(this.ai)) return undefined;
    const r = { hover: false, qb: false, ab: false, done: false };
    switch (this.ai) {
      case 'cryo':
        return this.cryoAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'icemortar':
        return this.mortarAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'holoproj':
        return this.holoAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'holofake':
        return this.fakeAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'parasite':
        return this.parasiteAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'anchor':
        return this.anchorAI_c1(dt, d, dir, perp, wish, pl, r);
      case 'zipline':
        return this.zipAI_c1(dt, d, dir, perp, wish, pl, r);
    }
    return undefined;
  },
  // aiSpecialFire 轉過來：true＝自己處理（略過一般武器迴圈）、false＝照常開火、undefined＝不是 C1 的敵人
  foeFire_c1(dt, d) {
    switch (this.ai) {
      case 'cryo':
      case 'holoproj':
      case 'holofake':
      case 'parasite':
        return true;
      case 'icemortar':
        return d > 20; // 近身時才用機槍
      case 'anchor':
        return !!(this.bossVis & 1);
      case 'zipline':
        return !!(this.bossVis & 7) || d > 22; // 滑索中、破綻中不開火；霰彈只在近距離
    }
    return undefined;
  },
  // specialDefense 先呼叫（mech-foe.js 的 foeDefense）：回傳 [傷害, 衝擊] 或 undefined
  foeDefense_c1(dmg, impact) {
    if (this.ai === 'holofake') {
      this.fakeVanish_c1(); // 假的：打一下就消失（不算擊破、沒有賞金）
      return [0, 0];
    }
    if (this.ai === 'zipline' && this.aiState.vulnT > 0) return [dmg * ZIP.vulnK, impact * ZIP.vulnK];
    return undefined;
  },
  // 動作被自己接管（纏附、撲擊、滑索）時：不跑 move，自己擺模型
  c1Pose_c1(dt, yaw) {
    this.t += dt;
    if (yaw !== undefined) this.yaw = this.aimYaw = yaw;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = this.yaw;
    this.specialFx(dt);
  },

  // ---------- 冷凍噴霧機：保持 6～14 m；噴嘴結霜（預警 0.8 秒、地上的長方形）→ 冷凍霧 1.4 秒（方向固定）----------
  cryoAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.cy === undefined) {
      s.cy = 0;
      s.cyT = rnd(2, 3.5);
    }
    s.cyT -= dt;
    if (s.cy === 0) {
      if (d > 13) wish.copy(dir).addScaledVector(perp, 0.25).normalize();
      else if (d < 6) wish.copy(dir).negate().addScaledVector(perp, 0.5).normalize();
      else wish.copy(perp).multiplyScalar(0.5);
      if (s.cyT <= 0 && d < CRYO.len - 1 && d > 2.5 && this.canAct()) {
        s.cy = 1;
        s.cyT = CRYO.warn;
        s.cyDir = pl.pos.clone().sub(this.pos).setY(0).normalize();
        const c = this.pos.clone().addScaledVector(s.cyDir, CRYO.len / 2);
        c.y = g.world.terrainHeight(c.x, c.z);
        g.fx.warnRect(c, Math.atan2(s.cyDir.x, s.cyDir.z), CRYO.w, CRYO.len, CRYO.warn + CRYO.t, 0x9fe8ff);
        g.fx.flash(this.muzzle('rarm'), 1.4, FROST, CRYO.warn);
        SFX.play('charge', 0.7, 1.5, 0.05, 0.05, this.center());
      }
    } else {
      wish.set(0, 0, 0);
      this.setAim(this.center().addScaledVector(s.cyDir, 10)); // 噴嘴固定在預警的方向
      if (s.cy === 1 && s.cyT <= 0) {
        s.cy = 2;
        s.cyT = CRYO.t;
        s.tick = 0;
        s.fxT = 0;
        SFX.play('thrBurst', 0.9, 0.7, 0.05, 0.05, this.center());
      } else if (s.cy === 2) {
        if ((s.fxT -= dt) <= 0) {
          s.fxT = 0.1;
          g.fx.streaks(this.muzzle('rarm'), 10, 0xaee8ff, 16, 0.5, 2, s.cyDir.clone(), 0.35);
        }
        if ((s.tick -= dt) <= 0) {
          s.tick = CRYO.tick;
          this.cryoHit_c1(s.cyDir);
        }
        if (s.cyT <= 0) {
          s.cy = 0;
          s.cyT = rnd(CRYO.cd[0], CRYO.cd[1]);
        }
      }
    }
    this.bossVis = s.cy;
    this.stuckJump(dt, r);
    return r;
  },
  // 噴霧範圍（前方 len、寬 w 的長方形，高度 5 m 以下）裡的目標：損傷＋變慢（QB 更耗能）
  cryoHit_c1(dv) {
    const g = this.game,
      dm = this.dmgMul;
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead) continue;
      const rx = t.pos.x - this.pos.x,
        rz = t.pos.z - this.pos.z;
      const u = rx * dv.x + rz * dv.z,
        v = Math.abs(-rx * dv.z + rz * dv.x);
      if (u < 0.5 || u > CRYO.len + 0.5 || v > CRYO.w / 2 + t.radius * 0.5 || t.pos.y - this.pos.y > 5)
        continue;
      t.takeDamage(CRYO.dmg * dm, CRYO.im * dm, this, t.center(), dv.clone(), undefined, undefined, 'en');
      t.addStatus?.('slow', 4, { k: 0.6, qb: 1.5 });
      t.c1SlowHit = (t.c1SlowHit || 0) + 1; // 測試用：被噴到的次數
    }
  },

  // ---------- 冰錐迫擊砲：保持 30～50 m；架砲預警 0.6 秒 → 拋射冰錐（落點白圈 1.5 秒）→ 落點傷害＋冰牆 ----------
  mortarAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState;
    if (s.mm === undefined) {
      s.mm = 0;
      s.mmT = rnd(2, 3.5);
      s.recT = 0;
    }
    s.mmT -= dt;
    s.recT = Math.max(0, s.recT - dt);
    if (s.mm === 0) {
      if (d < 24) wish.copy(dir).negate().addScaledVector(perp, 0.4).normalize();
      else if (d > 55) wish.copy(dir);
      else wish.copy(perp).multiplyScalar(0.3);
      if (s.mmT <= 0 && d > 14 && d < 75 && this.canAct()) {
        s.mm = 1;
        s.mmT = MORTAR.warn;
        SFX.play('charge', 0.6, 0.8, 0.05, 0.05, this.center());
      }
    } else {
      wish.set(0, 0, 0);
      if (s.mmT <= 0) {
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.6);
        if (lead.length() > 6) lead.setLength(6);
        this.iceShot_c1(pl.pos.clone().add(lead));
        s.mm = 0;
        s.recT = 0.45;
        s.mmT = rnd(MORTAR.cd[0], MORTAR.cd[1]);
      }
    }
    this.bossVis = s.mm === 1 ? 1 : s.recT > 0 ? 2 : 0;
    this.stuckJump(dt, r);
    return r;
  },
  iceShot_c1(tp) {
    const g = this.game,
      w = g.world,
      dm = this.dmgMul;
    const mz = this.muzzle('rarm');
    const land = tp.clone();
    land.y = w.groundAt(land.x, land.z, tp.y + 1.5);
    const T = MORTAR.T,
      G = MORTAR.G;
    const v = land.clone().sub(mz).divideScalar(T);
    v.y = (land.y - mz.y + 0.5 * G * T * T) / T;
    g.projectiles.push(
      new Projectile(g, {
        pos: mz.clone(),
        vel: v,
        kind: 'grenade',
        attr: 'kin',
        dmg: MORTAR.dmg * dm,
        impactV: MORTAR.im * dm,
        team: this.team,
        owner: this,
        color: FROST,
        life: T + 1.2,
        splash: MORTAR.R,
        gravity: G,
      }),
    );
    g.fx.muzzle(mz, V(0, 1, 0), FROST, 2);
    g.fx.dust(mz.clone(), 1.2, 6, 0xf0f8ff);
    SFX.shot('grenade', undefined, mz);
    warnAt(g, land, MORTAR.R, T, 0xffffff);
    this.c1Shots = (this.c1Shots || 0) + 1; // 測試用
    // 落地：冰牆（面向砲台、落點往砲台側 1.8 m，不把站在落點的機體卡在牆裡；可以當掩體、打得碎）
    const to = land.clone().sub(this.pos).setY(0);
    const yaw = to.lengthSq() > 0.01 ? Math.atan2(to.x, to.z) : 0;
    const wp = land.clone();
    if (to.lengthSq() > 0.01) wp.addScaledVector(to.normalize(), -WALL_BACK);
    wp.y = w.groundAt(wp.x, wp.z, land.y + 1.5);
    g.later(T, () => {
      g.fx.explosion(land.clone().setY(land.y + 0.8), 2.2, FROST);
      g.fx.dust(land.clone(), 3, 12, 0xe8f4ff);
      SFX.play('glass', 0.9, 0.8, 0.05, 0.05, land);
    });
    // 冰錐落地爆炸之後才長出冰牆（同時出現的話冰錐會先撞上牆、爆炸被牆擋住）
    g.later(T + 0.15, () => {
      g.c1Walls = (g.c1Walls || 0) + 1; // 測試用：冰牆的生成次數
      g.addTempWall(wp, { ...WALL, yaw });
    });
  },

  // ---------- 全像投影器：保持 30 m；投影頭張開預警 0.7 秒 → 投出假敵人（最多 3 台，14 秒一次）----------
  holoAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.hp === undefined) {
      s.hp = 0;
      s.hpT = rnd(1.5, 2.5);
    }
    s.hpT -= dt;
    if (s.hp === 0) {
      if (d > 36) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
      else if (d < 22) wish.copy(dir).negate().addScaledVector(perp, 0.5).normalize();
      else wish.copy(perp).multiplyScalar(0.5);
      const n = this.fakesOf_c1().length;
      if (s.hpT <= 0 && n < HOLO.n && d < 60 && this.canAct()) {
        s.hp = 1;
        s.hpT = HOLO.warn;
        g.fx.flash(this.muzzle('rarm'), 1.6, CYAN, HOLO.warn);
        SFX.play('glitch', 0.8, 0.8, 0.05, 0.05, this.center());
      }
    } else {
      wish.set(0, 0, 0);
      if (s.hp === 1 && s.hpT <= 0) {
        s.hp = 2;
        s.hpT = 0.7;
        this.projectFakes_c1(pl, HOLO.n - this.fakesOf_c1().length);
      } else if (s.hp === 2 && s.hpT <= 0) {
        s.hp = 0;
        s.hpT = HOLO.cd;
      }
    }
    this.bossVis = s.hp;
    this.stuckJump(dt, r);
    return r;
  },
  fakesOf_c1() {
    return this.game.enemies.filter((e) => !e.dead && e.ai === 'holofake' && e.opts.parent === this.id);
  },
  // 假敵人：看起來和一般的 MT 一樣，出現在目標與投影器之間的兩側（比投影器近，自動鎖定會先選到）
  projectFakes_c1(pl, n) {
    const g = this.game,
      w = g.world;
    const T = ENEMY_TYPES.mt;
    const out = [];
    const base = Math.atan2(this.pos.z - pl.pos.z, this.pos.x - pl.pos.x);
    for (let i = 0; i < n; i++) {
      const a = base + (i - (n - 1) / 2) * 0.7 + rnd(-0.15, 0.15);
      const R = Math.min(rnd(12, 17), Math.max(8, pl.pos.distanceTo(this.pos) * 0.7));
      const [x, z] = w.collide(pl.pos.x + Math.cos(a) * R, pl.pos.z + Math.sin(a) * R, pl.pos.y, 1.2);
      const at = V(x, w.groundAt(x, z, pl.pos.y + 2), z);
      const e = g.spawnEnemy({
        name: T.name,
        asm: T.gen(),
        pal: T.pal,
        scale: T.scale,
        hpMul: 0.02,
        dmgMul: 0.01,
        stabMul: 1,
        ai: 'holofake',
        grunt: true,
        parent: this.id,
        wantDist: 16,
        speedMul: 1.1,
        at,
      });
      e.kits = 0;
      e.decoy = true; // 假敵人：不算進殘存敵軍、波次門檻、HUD 的敵數與清除判定
      // 不參與感知與攻擊權杖（ai-director 看 sn.on）
      if (e.senseInit) {
        e.senseInit(false);
        e.sn.on = false;
        e.sn.st = 2;
      }
      g.fx.flash(e.center(), 2.4, CYAN, 0.3);
      g.fx.beam(this.muzzle('rarm'), e.center(), CYAN, 0.05);
      out.push(e);
    }
    // 搶走本機玩家對投影器的鎖定（遠端玩家的鎖定在各自的客機，靠距離較近讓自動鎖定先選到）
    const me = g.player;
    if (me && !me.dead && out.length && (!me.lock || me.lock === this)) {
      out.sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos));
      me.lock = out[0];
    }
    if (out.length) g.alertAll('全像投影：出現的敵機有假的——打一下就會消失');
    return out;
  },
  // 假敵人：繞著目標移動、偶爾開槍的閃光（沒有傷害）；投影器不在了、超過時間就消失
  fakeAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState;
    const par = this.parentEnt();
    s.life = (s.life || 0) + dt;
    if (!par || par.dead || s.life > HOLO.life) {
      this.fakeVanish_c1();
      r.done = true;
      return r;
    }
    if (d > s.want + 4) wish.copy(dir).addScaledVector(perp, 0.4).normalize();
    else if (d < s.want - 5) wish.copy(dir).negate().addScaledVector(perp, 0.5).normalize();
    else wish.copy(perp);
    s.flT = (s.flT === undefined ? rnd(0.5, 1.2) : s.flT) - dt;
    if (s.flT <= 0 && d < 45) {
      s.flT = rnd(0.6, 1.3);
      const mz = this.muzzle('rarm');
      this.game.fx.muzzle(mz, pl.center().sub(mz).normalize(), 0x9ffff0, 1);
      SFX.play('mg', 0.35, 1.3, 0.05, 0.05, mz);
    }
    return r;
  },
  fakeVanish_c1() {
    if (this.dead) return;
    const g = this.game,
      c = this.center();
    g.fx.streaks(c, 16, CYAN, 7, 0.5, 0, null, 1);
    g.fx.flash(c, 2, CYAN, 0.2);
    SFX.play('glitch', 0.7, 1.4, 0.05, 0.03, c);
    this.depart();
  },

  // ---------- 寄生纏附體：接近 → 蹲伏 0.7 秒（紅線預警）→ 撲擊 → 纏附 4 秒 → 被甩掉時彈開＋硬直 ----------
  parasiteAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (!s.pz) {
      s.pz = 'chase';
      s.cdT = rnd(0.5, 1.5);
    }
    s.cdT -= dt;
    this.noPush = s.pz === 'latch' || s.pz === 'leap';
    if (s.pz === 'chase') {
      this.noLock = false;
      if (this.staggerT > 0) this.bossVis = 4;
      else this.bossVis = 0;
      wish
        .copy(dir)
        .addScaledVector(perp, 0.45 * Math.sin(this.t * 3))
        .normalize();
      if (d < 3) wish.copy(perp);
      const busy = g.enemies.some(
        (e) =>
          e !== this && !e.dead && e.ai === 'parasite' && e.aiState.tgt === pl && e.aiState.pz === 'latch',
      );
      if (s.cdT <= 0 && d < PARA.range && d > 2 && !busy && this.canAct()) {
        s.pz = 'crouch';
        s.pzT = PARA.crouch;
        g.fx.warnLine(this.center(), pl.center(), PARA.crouch, 0xff3a30);
        SFX.play('charge', 0.5, 2.2, 0.05, 0.05, this.center());
      }
    } else if (s.pz === 'crouch') {
      wish.set(0, 0, 0);
      this.bossVis = 1;
      if ((s.pzT -= dt) <= 0) {
        // 撲擊：往目標 0.25 秒後的位置跳
        const to = pl.center().addScaledVector(pl.vel, 0.25);
        s.pz = 'leap';
        s.pzT = 0;
        s.l0 = this.pos.clone();
        s.l1 = V(to.x, to.y - this.model.height * 0.4, to.z);
        s.tgt = pl;
        SFX.play('punch1', 0.6, 1.6, 0.05, 0.05, this.center());
      }
    } else if (s.pz === 'leap') {
      s.pzT += dt / PARA.leap;
      const k = Math.min(1, s.pzT);
      this.pos.lerpVectors(s.l0, s.l1, k);
      this.pos.y += Math.sin(Math.PI * k) * 1.6;
      const yaw = Math.atan2(-(s.l1.x - s.l0.x), -(s.l1.z - s.l0.z));
      const t = s.tgt;
      if (t && !t.dead && !(t.iFrames > 0) && this.center().distanceTo(t.center()) < t.radius + 1.3) {
        this.latchOn_c1(t);
      } else if (k >= 1) {
        // 撲空：落地露出破綻
        s.pz = 'chase';
        s.cdT = PARA.cd;
        this.pos.y = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
        this.vel.set(0, 0, 0);
        this.staggerT = Math.max(this.staggerT, 0.6);
        g.fx.dust(this.pos.clone(), 1.5, 6, 0x9a8a80);
      }
      this.bossVis = 0;
      r.done = true;
      this.c1Pose_c1(dt, yaw);
      return r;
    } else if (s.pz === 'latch') {
      const t = s.tgt;
      s.latchT += dt;
      // 甩掉的判定：狀態效果 'latch' 被 QB／近戰解除或時間到（傷害由狀態效果每秒扣）
      const gone = !t || t.dead || (s.latchT > 0.15 && !t.hasStatus('latch'));
      if (gone) {
        this.shakeOff_c1(t);
        return r;
      }
      const f = fwdOf(t.yaw),
        rt = V(-f.z, 0, f.x);
      this.pos
        .copy(t.pos)
        .addScaledVector(f, -t.radius * 0.55)
        .addScaledVector(rt, 0.3);
      this.pos.y += t.model.height * 0.42;
      this.vel.copy(t.vel);
      this.bossVis = 2;
      this.noLock = true;
      r.done = true;
      this.c1Pose_c1(dt, t.yaw);
      return r;
    }
    this.stuckJump(dt, r);
    return r;
  },
  latchOn_c1(t) {
    const s = this.aiState,
      g = this.game,
      dm = this.dmgMul;
    s.pz = 'latch';
    s.latchT = 0;
    s.dpsT = 0.5;
    s.tgt = t;
    t.takeDamage(PARA.bite * dm, PARA.biteIm * dm, this, t.center(), fwdOf(this.yaw), BITE);
    t.addStatus?.('latch', 4, { dps: PARA.dps * dm, src: this.id });
    g.fx.meleeHit(t.center(), 0xff3a30, false, fwdOf(this.yaw));
    SFX.play('crunch1', 0.9, 1.2, 0.05, 0.05, t.center());
    if (t === g.player || t.isPlayer) g.flashAlert('寄生纏附體纏上了機體 — QB 兩次或近戰甩掉');
    this.c1Latched = (this.c1Latched || 0) + 1; // 測試用
  },
  shakeOff_c1(t) {
    const s = this.aiState,
      g = this.game;
    s.pz = 'chase';
    s.cdT = PARA.cd + 1;
    s.tgt = null;
    this.noLock = false;
    this.noPush = false;
    const f = t ? fwdOf(t.yaw) : fwdOf(this.yaw);
    this.vel.set(-f.x * 8, 6, -f.z * 8);
    this.staggerT = Math.max(this.staggerT, PARA.stun);
    this.bossVis = 4;
    g.fx.spark(this.center(), 0xff6040);
    g.fx.dust(this.pos.clone(), 1.5, 6, 0x9a8a80);
    SFX.play('thud1', 0.8, 1.3, 0.05, 0.05, this.center());
    this.c1Shaken = (this.c1Shaken || 0) + 1; // 測試用
  },

  // ---------- 重力錨：保持 26 m 用機槍；錨樁預警 1.2 秒（紫圈）→ 打進目標腳下展開重力圈 8 秒 ----------
  anchorAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.an === undefined) {
      s.an = 0;
      s.anT = rnd(3, 5);
      s.fieldT = 0;
    }
    s.anT -= dt;
    s.fieldT = Math.max(0, s.fieldT - dt);
    if (s.an === 0) {
      if (d > s.want + 6) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
      else if (d < s.want - 8) wish.copy(dir).negate();
      else wish.copy(perp).multiplyScalar(0.35);
      if (s.anT <= 0 && d < 45 && this.canAct()) {
        s.an = 1;
        s.anT = ANCHOR.warn;
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.5);
        if (lead.length() > 5) lead.setLength(5);
        const p = pl.pos.clone().add(lead);
        p.y = g.world.groundAt(p.x, p.z, pl.pos.y + 1);
        s.at = p;
        warnAt(g, p, ANCHOR.R, ANCHOR.warn, PURPLE);
        g.fx.warnLine(this.muzzle('rarm'), p.clone().setY(p.y + 0.5), ANCHOR.warn, PURPLE);
        SFX.play('charge', 0.8, 0.6, 0.05, 0.05, this.center());
      }
    } else {
      wish.set(0, 0, 0);
      if (s.anT <= 0) {
        const p = s.at;
        g.fx.beam(this.muzzle('rarm'), p.clone().setY(p.y + 0.3), PURPLE, 0.14);
        g.fx.shockwave(p.clone().setY(p.y + 0.3), ANCHOR.R, PURPLE, 0.6);
        g.fx.ring(p.clone().setY(p.y + 0.2), ANCHOR.R, PURPLE);
        SFX.play('heavy', 1, 0.7, 0.05, 0.05, p);
        g.c1Zones = (g.c1Zones || 0) + 1; // 測試用
        g.addZone?.('gravity', p.clone(), ANCHOR.R, ANCHOR.life);
        s.an = 0;
        s.fieldT = ANCHOR.life;
        s.anT = rnd(ANCHOR.cd[0], ANCHOR.cd[1]);
      }
    }
    this.bossVis = s.an === 1 ? 1 : s.fieldT > 0 ? 2 : 0;
    this.stuckJump(dt, r);
    return r;
  },

  // ---------- 滑索突擊兵：平台上待機 → 纜索閃光預警 0.9 秒 → 滑到目標背後 → 0.8 秒破綻 → 近距離霰彈 → 爬回平台 ----------
  zipAI_c1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    if (!s.zp) {
      const high = this.pos.y - w.terrainHeight(this.pos.x, this.pos.z) > 3;
      s.zp = high ? 'perch' : 'fight';
      s.zT = rnd(1.5, 3);
      s.vulnT = 0;
    }
    s.zT -= dt;
    s.vulnT = Math.max(0, s.vulnT - dt);
    if (s.zp === 'perch') {
      wish.set(0, 0, 0);
      if (s.zT <= 0 && d < 55 && this.canAct()) this.zipStart_c1(this.zipBehind_c1(pl), true);
    } else if (s.zp === 'fight') {
      if (d > s.want + 2) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
      else wish.copy(perp);
      if (d > 12 && Math.random() < dt * 0.8) r.qb = true;
      if (s.zT <= 0 && this.canAct()) {
        const deck = this.zipDeck_c1(pl);
        if (deck) this.zipStart_c1(deck, false);
        else if (d > 10) this.zipStart_c1(this.zipBehind_c1(pl), true);
        else s.zT = 2;
      }
      this.stuckJump(dt, r);
    } else if (s.zp === 'warn') {
      wish.set(0, 0, 0);
      if (s.zT <= 0) {
        s.zp = 'zip';
        s.zk = 0;
        s.spT = 0;
        SFX.play('boostUp', 0.8, 1.5, 0.05, 0.05, this.center());
      }
    } else if (s.zp === 'zip') {
      s.zk += (dt * ZIP.speed) / Math.max(1, s.z0.distanceTo(s.z1));
      const k = Math.min(1, s.zk);
      this.pos.lerpVectors(s.z0, s.z1, k);
      this.pos.y -= Math.sin(Math.PI * k) * Math.min(1.5, s.z0.distanceTo(s.z1) * 0.04); // 纜索的垂度
      if ((s.spT -= dt) <= 0) {
        s.spT = 0.12;
        g.fx.spark(this.center().setY(this.pos.y + this.model.height + 0.3), 0xffe080);
      }
      const yaw = Math.atan2(-(s.z1.x - s.z0.x), -(s.z1.z - s.z0.z));
      if (k >= 1) {
        this.vel.set(0, 0, 0);
        if (s.down) {
          s.zp = 'vuln';
          s.vulnT = ZIP.vuln;
          s.zT = ZIP.vuln;
          g.fx.dust(this.pos.clone(), 3, 10, 0x9aa0a8);
          SFX.play('thud2', 1, 1, 0.05, 0.05, this.center());
        } else {
          s.zp = 'perch';
          s.zT = rnd(2.5, 4);
        }
      }
      this.bossVis = 2;
      r.done = true;
      this.c1Pose_c1(dt, k >= 1 ? this.aimYaw : yaw);
      return r;
    } else if (s.zp === 'vuln') {
      wish.set(0, 0, 0);
      if (s.zT <= 0) {
        s.zp = 'fight';
        s.zT = rnd(ZIP.again[0], ZIP.again[1]);
      }
    }
    this.bossVis = s.zp === 'warn' ? 1 : s.zp === 'vuln' ? 4 : 0;
    return r;
  },
  // 目標背後 5 m 的落點（擋住時改側面）
  zipBehind_c1(pl) {
    const w = this.game.world;
    const f = fwdOf(pl.yaw);
    for (const a of [0, 0.9, -0.9, 1.6, -1.6]) {
      const dv = f.clone().applyAxisAngle(V(0, 1, 0), a);
      const x0 = pl.pos.x - dv.x * 5,
        z0 = pl.pos.z - dv.z * 5;
      const [x, z] = w.collide(x0, z0, pl.pos.y, 1);
      if (Math.hypot(x - x0, z - z0) > 1.5 || (w.isVoid && w.isVoid(x, z))) continue;
      return V(x, w.groundAt(x, z, pl.pos.y + 1.5), z);
    }
    return V(pl.pos.x, pl.pos.y, pl.pos.z).addScaledVector(f, -2.5);
  },
  // 附近（35 m 內、目標 40 m 內）高 4 m 以上的平台頂
  zipDeck_c1(pl) {
    const w = this.game.world;
    let best = null;
    for (const o of w.obstacles) {
      if (o.kind !== 'box' || !o.deck || !(o.top > w.terrainHeight(o.x, o.z) + 4)) continue;
      if (!w.inZone(o.x, o.z, 3)) continue;
      const dd = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
      const dp = Math.hypot(o.x - pl.pos.x, o.z - pl.pos.z);
      if (dd > 35 || dp > 40 || dp < 8) continue;
      if (!best || dd < best.dd) best = { o, dd };
    }
    if (!best) return null;
    const o = best.o;
    return V(o.x + rnd(-o.w * 0.25, o.w * 0.25), o.top, o.z + rnd(-o.d * 0.25, o.d * 0.25));
  },
  // 射出纜索：預警（纜索的線一直畫到滑完、鉤爪的閃光、聲音）
  zipStart_c1(dest, down) {
    const s = this.aiState,
      g = this.game;
    s.zp = 'warn';
    s.zT = ZIP.warn;
    s.z0 = this.pos.clone();
    s.z1 = dest;
    s.down = down;
    const dur = s.z0.distanceTo(dest) / ZIP.speed;
    const hook = this.pos.clone().setY(this.pos.y + this.model.height + 0.3);
    g.fx.warnLine(hook, dest.clone().setY(dest.y + 1.2), ZIP.warn + dur + 0.1, ZIPC, 0.08);
    g.fx.flash(hook, 1.6, 0xffe080, 0.3);
    g.fx.flash(dest.clone().setY(dest.y + 1), 1.2, 0xffe080, ZIP.warn);
    SFX.play('clatter1', 0.9, 1.6, 0.05, 0.05, this.center());
    if (down) this.c1Zips = (this.c1Zips || 0) + 1; // 測試用
  },

  // ---------- 顯示（房主與客機每格，specialFx 呼叫）----------
  foeFx_c1(dt) {
    if (!C1_AI.has(this.ai)) return;
    const m = this.model,
      g = this.game;
    const vis = this.dead ? 0 : this.bossVis || 0;
    const k = Math.min(1, dt * 8);
    const t = this.t;
    const glowTo = (mat, v) => {
      if (mat) mat.emissiveIntensity = lerp(mat.emissiveIntensity, v, k);
    };
    switch (this.ai) {
      case 'cryo': {
        glowTo(m.cGlow, vis & 1 ? 3.2 : vis & 2 ? 2.4 : 0.3);
        if (m.cRing) m.cRing.rotation.z += dt * (vis & 2 ? 25 : vis & 1 ? 8 : 1);
        if (m.cFan) m.cFan.rotation.z += dt * 9;
        for (const f of m.cFlaps || []) f.rotation.x = lerp(f.rotation.x, vis ? -0.9 : 0, k);
        if (m.cArm) m.cArm.rotation.x = vis & 2 ? Math.sin(t * 45) * 0.03 : lerp(m.cArm.rotation.x, 0, k);
        if (vis && Math.random() < dt * 14) g.fx.smoke(this.muzzle('rarm'), 0.6, 0xeaf6ff, 0.6, 0.5);
        break;
      }
      case 'icemortar': {
        glowTo(m.cGlow, vis & 1 ? 3 : 0.4);
        if (m.cDrum) m.cDrum.rotation.x += dt * (vis & 1 ? 6 : 0.4);
        for (const st of m.cStabs || []) st.rotation.x = lerp(st.rotation.x, vis ? 0.55 : 0, k);
        if (m.cSlide)
          m.cSlide.position.y = vis & 2 ? -0.4 : lerp(m.cSlide.position.y, 0, Math.min(1, dt * 4));
        if (vis & 1 && Math.random() < dt * 10) g.fx.smoke(this.muzzle('rarm'), 0.5, 0xeaf6ff, 0.5, 1);
        break;
      }
      case 'holoproj': {
        glowTo(m.cGlow, vis ? 3.2 : 0.6 + 0.3 * Math.sin(t * 3));
        if (m.cRing) m.cRing.rotation.y += dt * (vis ? 9 : 0.8);
        for (const p of m.cPetals || []) p.rotation.x = lerp(p.rotation.x, vis ? -0.9 : 0, k);
        if (m.cHead) m.cHead.position.y = 2.75 + Math.sin(t * 1.6) * 0.04;
        if (m.cCone) {
          m.cCone.visible = !!(vis & 2);
          m.cCone.material.opacity = 0.12 + 0.08 * Math.sin(t * 30);
        }
        break;
      }
      case 'holofake':
        this.fakeFx_c1();
        break;
      case 'parasite': {
        glowTo(m.cGlow, vis & 1 ? 3.5 : vis & 2 ? 1.6 + Math.sin(t * 10) : 0.8);
        if (m.cBody) {
          m.cBody.position.y = lerp(m.cBody.position.y, vis & 1 ? -0.28 : 0, k);
          m.cBody.rotation.z = vis & 4 ? Math.sin(t * 25) * 0.15 : lerp(m.cBody.rotation.z, 0, k);
        }
        for (const [i, j] of (m.cJaws || []).entries())
          j.rotation.y = lerp(j.rotation.y, (i ? -1 : 1) * (vis & 3 ? 0.6 : 0.1 * Math.sin(t * 4)), k);
        const mv = Math.hypot(this.vel.x, this.vel.z) > 1;
        for (const L of m.cLegs || []) {
          const sd = L.userData.side;
          if (vis & 2) L.rotation.z = lerp(L.rotation.z, sd * 0.9, k);
          else L.rotation.z = lerp(L.rotation.z, mv ? sd * Math.sin(t * 18 + L.userData.ph) * 0.3 : 0, k);
          L.rotation.y = mv && !(vis & 2) ? Math.sin(t * 18 + L.userData.ph + 1.2) * 0.35 : 0;
        }
        if (m.cSpine) m.cSpine.scale.y = vis & 2 ? 1 + Math.sin(t * 12) * 0.12 : 1;
        this.noLock = !!(vis & 2);
        break;
      }
      case 'anchor': {
        glowTo(m.cGlow, vis & 1 ? 3.6 : vis & 2 ? 2.2 + Math.sin(t * 8) * 0.6 : 0.8);
        const [g1, g2] = m.cGyro || [];
        const sp = vis & 2 ? 8 : vis & 1 ? 4 : 1;
        if (g1) g1.rotation.y += dt * sp;
        if (g2) g2.rotation.x += dt * sp * 1.3;
        for (const c of m.cClamps || []) c.position.y = lerp(c.position.y, vis ? 0.12 : 0.35, k);
        if (m.cSpike) m.cSpike.position.z = lerp(m.cSpike.position.z, vis & 1 ? -1.75 : -1.25, k);
        break;
      }
      case 'zipline': {
        glowTo(m.cGlow, vis & 1 ? (Math.sin(t * 30) > 0 ? 4 : 1) : vis & 2 ? 2.5 : 0.6);
        if (m.cReel) m.cReel.rotation.x += dt * (vis & 2 ? 40 : vis & 1 ? 6 : 0);
        if (m.cHook) m.cHook.rotation.x = lerp(m.cHook.rotation.x, vis & 3 ? 2.7 : 0, k);
        if (m.cLegs) m.cLegs.rotation.x = lerp(m.cLegs.rotation.x, vis & 2 ? 0.55 : 0, k);
        if (vis & 4 && Math.random() < dt * 12) g.fx.smoke(this.center(), 0.8, 0xc8c8c8, 0.6, 1.5);
        break;
      }
    }
  },
  // 假敵人的樣子：半透明、閃爍、掃描線上下移動、偶爾錯位（房主與客機各自）
  fakeFx_c1() {
    if (!this.c1Scan) {
      this.mesh.traverse((o) => (o.castShadow = false));
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(1.25, 1.25, 0.06, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: CYAN,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      ring.userData.helper = true;
      this.mesh.add(ring);
      this.c1Scan = ring;
      this.c1Sy = this.mesh.scale.y;
      this.applyCloak(0.5);
      for (const mt of this.cloakMats || [])
        if (mt.emissive) {
          mt.emissive.setHex(0x1a7a80);
          mt.emissiveIntensity = 0.8;
        }
    }
    const h = this.model.height / (this.c1Sy || 1);
    this.c1Scan.position.y = ((this.t * 1.2) % 1) * h;
    this.c1Scan.visible = !this.dead;
    const glitch = Math.random() < 0.05;
    this.applyCloak(glitch ? 0.12 : 0.42 + 0.12 * Math.sin(this.t * 9));
    if (glitch) this.mesh.position.x += rnd(-0.25, 0.25);
    this.mesh.scale.y = this.c1Sy * (glitch ? 1.06 : 1);
  },
});
