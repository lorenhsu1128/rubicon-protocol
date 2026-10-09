// ---------- MechEntity 擴充：第三批 Boss ----------
// 電磁砲台 railgun、浮游砲指揮機 funnel（部位 bit）、武裝列車 train（部位 car_*）、熔爐清掃機 furnace、
// 光學迷彩電戰機 phantom（分身 holo）、複製 AC（bossKind mirror，ai 'ac'）、衛星砲導引塔 orbital、
// 三機合體 trinity（分離後的 sub）、高速突擊機 interceptor、衝撞推土要塞 rampart、脈衝刃翼 ibis。
// 由 mech-boss.js 的掛勾呼叫（bossMove／partAI／bossDefense／bossFire／bossFx 等）。行為只在房主／單機執行；
// 客機靠快照的 bossVis（各 Boss 的顯示旗標）與 bx（數值陣列：瞄準點、光柱位置…）顯示。
import { SFX } from '../audio/audio.js';
import { clamp, lerp, rnd } from '../core/math.js';
import { partById } from '../data/parts.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { MechEntity } from './mech-entity.js';

// 場地依主題縮放（World.k、World.lim）；鐵路兩端隧道口的位置（World.trackS）
const TRACK = (e) => e.game.world.trackS;
const LIM = (e) => e.game.world.lim;
const KS = (e) => e.game.world.k;
const CAR_SP = 9.6; // 車廂間距
const CARS = ['car_aa', 'car_ms', 'car_lz', 'car_mine'];
const PILLAR_R = 3.4; // 衛星砲光柱半徑
// 適應裝甲的傷害類型：0 實彈、1 能量、2 爆炸、3 近戰
const DMG_CAT = {
  bullet: 0,
  shotgun: 0,
  laser: 1,
  empbeam: 1,
  shell: 2,
  grenade: 2,
  missile: 2,
  emp: 2,
  melee: 3,
};
const CAT_NAME = ['實彈', '能量', '爆炸', '近戰'];
const CAT_COL = [0xffa040, 0x60e0ff, 0xff4030, 0xc070ff];

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const fwdOf = (yaw) => V(-Math.sin(yaw), 0, -Math.cos(yaw));
const yawOf = (v) => Math.atan2(-v.x, -v.z);
const altOf = (g, t) => t.pos.y - g.world.groundAt(t.pos.x, t.pos.z, t.pos.y);
// 方位（−Z 為北）
const COMPASS = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
const compass = (v) => COMPASS[(Math.round(Math.atan2(v.x, -v.z) / (Math.PI / 4)) + 8) % 8];

Object.assign(MechEntity.prototype, {
  // 建構時（房主與客機）
  boss2Init() {
    const k = this.opts.partKind;
    if (['train', 'interceptor'].includes(this.ai) || k === 'bit' || CARS.includes(k)) this.noPush = true;
    if (this.ai === 'railgun') this.turnRate = 2.2;
    if (this.ai === 'furnace' || this.ai === 'rampart') this.yawRate = 1.1;
    if (this.ai === 'holo') this.mesh.traverse((o) => (o.castShadow = false)); // 分身沒有影子
  },
  // ---------- 移動（mech-boss.js 的 bossMove 轉過來）：回傳 r，或 null 表示走一般 AC 的移動 ----------
  boss2Move(dt, d, dir, perp, wish, pl, r) {
    switch (this.ai) {
      case 'railgun':
        this.railgunAI(dt, d, wish, pl);
        return r;
      case 'funnel':
        this.funnelAI(dt, d, dir, perp, wish);
        return r;
      case 'train':
        this.trainAI(dt, pl);
        r.done = true;
        return r;
      case 'furnace':
        this.furnaceAI(dt, d, dir, perp, wish, pl);
        return r;
      case 'phantom':
        this.phantomAI(dt);
        return null;
      case 'holo':
        this.holoAI();
        return null;
      case 'orbital':
        this.orbitalAI(dt, wish, pl);
        return r;
      case 'trinity':
        return this.trinityAI(dt, d, dir, perp, wish, pl, r);
      case 'interceptor':
        this.interceptorAI(dt, pl);
        r.done = true;
        return r;
      case 'rampart':
        this.rampartAI(dt, d, dir, perp, wish, pl, r);
        return r;
      case 'ibis':
        this.ibisAI(dt, d, dir, perp, wish, pl, r);
        return r;
    }
    return null;
  },
  // 開火：自己處理時回傳 true（一般武器迴圈略過）
  boss2Fire(dt, d, aimPos, pl) {
    const s = this.aiState;
    const auto = (slot, range, rate) => {
      const w = this.weapons[slot];
      if (!w || w.def.type === 'none' || d > range || !this.canAct()) return;
      if (Math.random() < dt * rate) this.fire(slot, aimPos, pl);
      if (w.mag <= 0 && w.reloadT <= 0 && w.ammo > 0) w.reloadT = w.def.reload;
    };
    switch (this.ai) {
      case 'railgun':
      case 'orbital':
        auto('rarm', 22, 7); // 近防機砲
        return true;
      case 'train':
        if (!(this.bossVis & 1)) auto('rarm', 42, 5);
        return true;
      case 'funnel':
        auto('rarm', 70, 4);
        auto('larm', 60, 0.8);
        return true;
      case 'phantom':
      case 'holo': {
        // 迷彩中偶爾狙擊一發（開火會現形）；現形時全武器
        if (this.bossVis & 1) {
          s.snipeT = (s.snipeT === undefined ? rnd(1.5, 3) : s.snipeT) - dt;
          if (s.snipeT <= 0 && d < 60 && this.canAct()) {
            s.snipeT = rnd(2.2, 3.2);
            if (this.fire('rarm', aimPos, pl)) s.selfRev = Math.max(s.selfRev || 0, 1.0);
          }
        } else {
          auto('rarm', 60, 1.5);
          auto('larm', 55, 6);
          auto('rback', 70, 0.5);
        }
        return true;
      }
      case 'furnace':
      case 'rampart':
      case 'ibis':
      case 'interceptor':
        return true;
      case 'trinity':
        return !!s.split;
    }
    return false;
  },
  // ---------- 電磁砲台：瞄準線鎖定（擋住射線就中斷）→ 貫穿砲擊 → 散熱片打開（弱點）----------
  railgunAI(dt, d, wish, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const p2 = this.phase2();
    wish.set(0, 0, 0);
    if (!s.rg) {
      s.rg = 'idle';
      s.rgT = rnd(2, 3.5);
    }
    if (!s.tp) s.tp = pl.center();
    const mz = this.muzzle('rback');
    // 瞄準點慢慢跟上目標（橫移能讓砲擊落後）
    const want = pl.center().addScaledVector(pl.vel, 0.15);
    s.tp.lerp(want, Math.min(1, dt * (s.rg === 'aim' ? 2.0 : 4)));
    this.aimYaw = yawOf(s.tp.clone().sub(this.pos));
    this.bx = null;
    if (s.rg === 'idle') {
      s.rgT -= dt;
      if (s.rgT <= 0 && this.canAct() && d < 170) {
        s.rg = 'aim';
        s.charge = 0;
        s.lost = 0;
        s.chargeMax = s.burst ? 1.0 : p2 ? 2.0 : 2.6;
        SFX.play('charge', 1, 0.6, 0.05, 0.05, this.center());
        if (!s.burst) g.alertAll('電磁砲鎖定 — 躲到掩體後面擋住射線！');
      }
    } else if (s.rg === 'aim') {
      if (!this.canAct()) {
        s.rg = 'idle';
        s.rgT = 1.5;
        s.burst = false;
      } else {
        if (g.losClear(mz, s.tp)) {
          s.charge += dt;
          s.lost = Math.max(0, s.lost - dt);
        } else if ((s.lost += dt) > 0.45) {
          s.rg = 'idle';
          s.rgT = 1.4;
          s.burst = false;
          g.msgAll('電磁砲失去目標 — 充能中斷', 0x7ee081);
        }
        this.bx = [1, ...s.tp.toArray().map((x) => +x.toFixed(2)), +(s.charge / s.chargeMax).toFixed(2)];
        if (s.charge >= s.chargeMax) {
          const dirv = s.tp.clone().sub(mz).normalize();
          g.beamAttack(this, mz, dirv, {
            range: 180,
            dmg: 3600 * dm,
            im: 2600 * dm,
            w: 1.0,
            color: 0x9fe8ff,
            width: 0.9,
          });
          g.fx.shockwave(mz.clone(), 7, 0x9fe8ff, 0.4);
          g.fx.flash(mz.clone(), 4, 0xffffff, 0.15);
          SFX.play('laserBig', 1, 0.5, 0.05, 0.05, mz);
          g.camShake = Math.max(g.camShake, 0.3);
          this.bx = null;
          if (p2 && !s.burst) {
            s.burst = true;
            s.charge = 0;
            s.chargeMax = 1.0;
          } else {
            s.burst = false;
            s.rg = 'vent';
            s.rgT = 3.5;
            if (!s.ventSaid) {
              s.ventSaid = true;
              g.alertAll('散熱片展開 — 現在攻擊！');
            }
          }
        }
      }
    } else {
      s.rgT -= dt;
      if (s.rgT <= 0) {
        s.rg = 'idle';
        s.rgT = rnd(1.5, 2.5);
      }
    }
    this.bossVis = s.rg === 'vent' ? 1 : 0;
  },
  // ---------- 浮游砲指揮機：展開浮游砲包圍目標 → 依序從各方位開火 → 回收充能（本體防禦下降）----------
  funnelAI(dt, d, dir, perp, wish) {
    const g = this.game,
      s = this.aiState;
    const p2 = this.phase2();
    this.flying = true;
    this.hoverH = 6 + Math.sin(this.t * 0.7) * 2;
    if (d > s.want + 6) wish.copy(dir).multiplyScalar(0.8);
    else if (d < s.want - 6) wish.copy(dir).multiplyScalar(-1);
    else wish.copy(perp).multiplyScalar(0.7);
    if (!s.fm) {
      s.fm = 'wait';
      s.fmT = 2;
    }
    const bits = this.partsOf('bit');
    if (s.fm === 'wait') {
      s.fmT -= dt;
      if (s.fmT <= 0 && this.canAct()) {
        const n = p2 ? 8 : 6;
        for (let i = bits.length; i < n; i++) g.spawnPart(this, 'bit', { at: this.center() });
        this.partsOf('bit').forEach((b, i, all) => {
          b.aiState.slot = i;
          b.aiState.n = all.length;
        });
        s.fm = 'place';
        s.fmT = 1.6;
        s.a0 = Math.random() * Math.PI * 2;
        g.alertAll('浮游砲展開 — 保持移動！');
      }
    } else if (s.fm === 'place') {
      s.fmT -= dt;
      if (s.fmT <= 0) {
        s.fm = 'attack';
        s.shotI = 0;
        s.shotT = 0;
        s.rounds = bits.length * 2;
      }
    } else if (s.fm === 'attack') {
      s.shotT -= dt;
      if (s.shotT <= 0 && s.shotI < s.rounds && bits.length) {
        const b = bits[s.shotI % bits.length];
        b.aiState.tele = p2 ? 0.38 : 0.5;
        s.shotI++;
        s.shotT = p2 ? 0.3 : 0.45;
      }
      if ((s.shotI >= s.rounds || !bits.length) && !bits.some((b) => b.aiState.tele > 0)) {
        s.fm = 'recall';
        s.fmT = 6;
        g.msgAll('浮游砲回收充能 — 攻擊本體！', 0x7ee081);
      }
    } else {
      s.fmT -= dt;
      if (s.fmT <= 0) {
        s.fm = 'wait';
        s.fmT = 0.5;
      }
    }
    this.bossVis = s.fm === 'recall' ? 1 : 0;
  },
  // ---------- 武裝列車：沿鐵路在兩端隧道之間來回；衝撞、車廂各自攻擊 ----------
  trainAI(dt, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const c = g.world.corridor;
    this.flying = true;
    if (!c) {
      this.bossTick(dt);
      return;
    }
    const p2 = this.phase2();
    if (s.st === undefined) {
      // 生成時（bosses2.js 設好 ts／td）或房主遷移後（從位置與速度推回軌道參數）
      if (s.ts === undefined) {
        s.ts = this.pos.x * c.dir.x + this.pos.z * c.dir.y;
        s.td = this.vel.x * c.dir.x + this.vel.z * c.dir.y < -0.1 ? -1 : 1;
      }
      s.spd = 0;
      s.st = 'run';
      s.ramCd = 6;
      s.hitCd = new Map();
    }
    const lost = CARS.length - this.partsOf().filter((e) => CARS.includes(e.opts.partKind)).length;
    const cruise = (p2 ? 17 : 13) * (1 - 0.08 * lost);
    const sMax = TRACK(this) + CARS.length * CAR_SP + 8,
      sMin = -TRACK(this) - 8;
    let target = cruise,
      accel = 10;
    s.ramCd -= dt;
    switch (s.st) {
      case 'run': {
        // 軌道前方 55 m 內有貼地的目標 → 衝撞預警
        if (s.ramCd <= 0 && this.canAct() && Math.abs(s.ts) < TRACK(this)) {
          for (const h of g.hostilesOfEnt(this)) {
            if (h.dead || !h.pos || altOf(g, h) > 3) continue;
            const lat = g.world.corridorU(h.pos.x, h.pos.z);
            const a = h.pos.x * c.dir.x + h.pos.z * c.dir.y - s.ts;
            if (Math.abs(lat) < 5 && a * s.td > 0 && Math.abs(a) < 55) {
              s.st = 'warn';
              s.stT = 1.2;
              s.ramCd = p2 ? 7 : 10;
              const mid = g.world.corridorPoint(s.ts + s.td * 30);
              const td = g.world.corridorDir(s.ts + s.td * 30);
              g.fx.warnRect(mid, Math.atan2(-td.x * s.td, -td.y * s.td), 6, 56, 1.2);
              SFX.play('heavy', 1, 0.5, 0.05, 0.05, this.center());
              g.alertAll('武裝列車全速衝撞 — 離開軌道！');
              break;
            }
          }
        }
        break;
      }
      case 'warn':
        target = cruise * 0.6;
        if ((s.stT -= dt) <= 0) {
          s.st = 'ram';
          s.stT = 2.4;
        }
        break;
      case 'ram':
        target = 34;
        accel = 26;
        if ((s.stT -= dt) <= 0) {
          s.st = 'hot';
          s.stT = 3.5;
          g.msgAll('鍋爐過熱 — 列車減速！', 0x7ee081);
        }
        break;
      case 'hot':
        target = 4;
        accel = 14;
        if ((s.stT -= dt) <= 0) s.st = 'run';
        break;
      case 'pause':
        target = 0;
        accel = 40;
        if ((s.stT -= dt) <= 0) s.st = 'run';
        break;
    }
    s.spd = s.spd + clamp(target - s.spd, -accel * dt, accel * dt);
    s.ts += s.td * s.spd * dt;
    if (s.ts > sMax || s.ts < sMin) {
      s.ts = clamp(s.ts, sMin, sMax);
      s.td = -s.td;
      s.st = 'pause';
      s.stT = 2.5;
      s.spd = 0;
    }
    this.pos.copy(g.world.corridorPoint(s.ts));
    const tdir = g.world.corridorDir(s.ts);
    this.yaw = this.aimYaw = Math.atan2(-tdir.x, -tdir.y); // 機車頭固定朝 +dir（往回開時由後方推）
    // 碰撞：機車頭與各節車廂範圍內、貼近軌道的目標
    if (s.spd > 3) {
      for (const h of g.hostilesOfEnt(this)) {
        if (h.dead || !h.pos || altOf(g, h) > 4.5) continue;
        if ((s.hitCd.get(h) || 0) > g.time) continue;
        const lat = g.world.corridorU(h.pos.x, h.pos.z);
        if (Math.abs(lat) > 2.6 + h.radius * 0.5) continue;
        const a = h.pos.x * c.dir.x + h.pos.z * c.dir.y;
        let hit = false;
        for (let k = 0; k <= CARS.length && !hit; k++) hit = Math.abs(a - (s.ts - k * CAR_SP)) < 4.7;
        if (!hit) continue;
        s.hitCd.set(h, g.time + 1.2);
        const k = clamp(s.spd / 34, 0.35, 1);
        const push = V(c.perp.x, 0, c.perp.y).multiplyScalar(Math.sign(lat || 1));
        h.takeDamage((s.st === 'ram' ? 1100 : 450) * dm * k, 1500 * dm * k, this, h.center(), push);
        h.vel.addScaledVector(push, 14).add(V(tdir.x * s.td, 0, tdir.y * s.td).multiplyScalar(s.spd * 0.5));
        h.vel.y = Math.max(h.vel.y, 8);
        h.grounded = false;
        g.camShake = Math.max(g.camShake, 0.25);
      }
    }
    this.bossVis = (Math.abs(s.ts) > TRACK(this) + 1 ? 1 : 0) | (s.st === 'hot' ? 2 : 0);
    this.bx = [s.st === 'ram' || s.st === 'warn' ? 1 : 0];
    this.bossTick(dt);
    this.vel.set(tdir.x * s.td * s.spd, 0, tdir.y * s.td * s.spd);
  },
  // 列車車廂：位置由機車頭決定，各自攻擊
  carAI(dt, d, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const k = this.opts.partKind;
    const par = this.parentEnt();
    const c = g.world.corridor;
    this.flying = true;
    if (!par || par.dead || !c) {
      this.bossTick(dt);
      return;
    }
    const ps = par.aiState;
    const ts = (ps.ts !== undefined ? ps.ts : 0) - (CARS.indexOf(k) + 1) * CAR_SP;
    this.pos.copy(g.world.corridorPoint(ts));
    const tdir = g.world.corridorDir(ts);
    this.yaw = Math.atan2(-tdir.x, -tdir.y);
    const hidden = Math.abs(ts) > TRACK(this) + 1;
    this.bossVis = hidden ? 1 : 0;
    const p2 = par.phase2 && par.phase2();
    const live = !hidden && this.canAct() && par.canAct();
    this.aimYaw = yawOf(pl.pos.clone().sub(this.pos));
    if (k === 'car_aa') {
      // 防空：只打離地 4 m 以上的目標（機槍＋高射砲彈幕）
      const air = g
        .hostilesOfEnt(this)
        .filter((h) => !h.dead && h.pos && altOf(g, h) > 4 && h.pos.distanceTo(this.pos) < 60);
      const t = air[0];
      if (t && live) {
        this.aimYaw = yawOf(t.pos.clone().sub(this.pos));
        const ap = t.center().addScaledVector(t.vel, 0.25);
        if (Math.random() < dt * 9) this.fire('rarm', ap, t);
        const w = this.weapons.rarm;
        if (w.mag <= 0 && w.reloadT <= 0 && w.ammo > 0) w.reloadT = w.def.reload;
        s.flakT = (s.flakT || 0) - dt;
        if (s.flakT <= 0) {
          s.flakT = p2 ? 1.1 : 1.6;
          const p = t.center().add(V(rnd(-3, 3), rnd(-2, 2), rnd(-3, 3)));
          g.blastTeam(p, 200 * dm, 350 * dm, 3.5, this.team, this);
        }
      }
    } else if (k === 'car_ms') {
      s.msT = (s.msT === undefined ? rnd(3, 5) : s.msT) - dt;
      if (s.msT <= 0 && live && d < 80) {
        s.msT = p2 ? 5 : 7;
        this.fire('rback', pl.center(), pl);
      }
    } else if (k === 'car_lz') {
      // 雷射舷砲：目標在車廂側面時，預警 0.9 秒後橫向射擊
      s.lzT = (s.lzT === undefined ? rnd(2, 4) : s.lzT) - dt;
      if (s.tele > 0) {
        s.tele -= dt;
        if (s.tele <= 0 && live) {
          g.beamAttack(this, s.lzFrom, s.lzDir, {
            range: 75,
            dmg: 700 * dm,
            im: 1000 * dm,
            w: 1.0,
            color: 0xff4a8a,
            width: 0.5,
          });
          SFX.play('laserBig', 0.8, 0.8, 0.05, 0.05, s.lzFrom);
        }
      } else if (s.lzT <= 0 && live) {
        const rel = pl.pos.clone().sub(this.pos);
        const along = rel.x * c.dir.x + rel.z * c.dir.y,
          lat = rel.x * c.perp.x + rel.z * c.perp.y;
        if (Math.abs(along) < 18 && Math.abs(lat) < 50 * KS(this) && Math.abs(lat) > 3 && altOf(g, pl) < 6) {
          s.lzT = p2 ? 4.5 : 6;
          s.tele = 0.9;
          const side = V(c.perp.x, 0, c.perp.y).multiplyScalar(Math.sign(lat));
          s.lzFrom = this.center().addScaledVector(side, 1.7);
          s.lzDir = pl.center().sub(s.lzFrom).normalize();
          g.fx.warnLine(s.lzFrom, s.lzFrom.clone().addScaledVector(s.lzDir, 70), 0.9, 0xff3070, 0.1);
        }
      }
      if (this.model.lens) this.model.lens.emissiveIntensity = s.tele > 0 ? 3.5 : 1.2;
    } else if (k === 'car_mine') {
      s.mnT = (s.mnT === undefined ? 2 : s.mnT) - dt;
      if (s.mnT <= 0 && live && (ps.spd || 0) > 4 && g.minesOf(this) < 8) {
        s.mnT = 2.2;
        g.layMine(this, this.muzzle('rback'), { dmg: 420 * dm, im: 650 * dm, R: 4.5, life: 25 });
      }
    }
    const rel = this.aimYaw - this.yaw;
    if (k === 'car_aa')
      this.model.torso.rotation.y = lerp(
        this.model.torso.rotation.y,
        Math.atan2(Math.sin(rel), Math.cos(rel)),
        0.2,
      );
    this.bossTick(dt);
    this.vel.copy(par.vel);
  },
  // ---------- 熔爐清掃機：熔渣（留下燃燒的地面）、火牆、近身火焰、對空熱浪；熔爐口打開時是弱點 ----------
  furnaceAI(dt, d, dir, perp, wish, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const p2 = this.phase2();
    if (s.mouthT > 0) s.mouthT -= dt;
    if (!s.act) {
      if (d > s.want + 4) wish.copy(dir).multiplyScalar(0.7);
      else if (d < s.want - 4) wish.copy(dir).multiplyScalar(-0.4);
      else wish.copy(perp).multiplyScalar(0.2);
      s.fcT = (s.fcT === undefined ? 3 : s.fcT) - dt;
      if (s.fcT <= 0 && this.canAct()) {
        s.fcT = p2 ? rnd(3, 4) : rnd(4, 5.5);
        const alt = altOf(g, pl);
        s.act = alt > 5 && d < 34 ? 'heat' : d < 13 ? 'flame' : Math.random() < 0.6 ? 'slag' : 'wall';
        s.actT = 0;
        s.done = false;
        if (s.act !== 'heat') {
          s.mouthT = s.act === 'flame' ? 2.8 : 2.4;
          SFX.play('charge', 0.9, 0.5, 0.05, 0.05, this.center());
          if (!s.mouthSaid) {
            s.mouthSaid = true;
            g.alertAll('熔爐口打開 — 弱點暴露！');
          }
        }
      }
    } else {
      wish.set(0, 0, 0);
      s.actT += dt;
      if (!this.canAct()) s.act = null;
    }
    const mz = this.muzzle('rback');
    switch (s.act) {
      case 'slag':
        if (!s.done && s.actT > 1.2) {
          s.done = true;
          const n = p2 ? 7 : 5;
          const lead = pl.vel.clone().setY(0).multiplyScalar(0.6);
          if (lead.length() > 6) lead.setLength(6);
          for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2,
              rr = i ? rnd(3, 9) : 0;
            const tp = pl.pos
              .clone()
              .add(lead)
              .add(V(Math.cos(a) * rr, 0, Math.sin(a) * rr));
            g.slagShot(this, tp, {
              dmg: 300 * dm,
              im: 500 * dm,
              R: 3.5,
              poolR: 4.2,
              life: p2 ? 14 : 10,
              dps: 180 * dm,
            });
          }
        }
        if (s.actT > 2.2) s.act = null;
        break;
      case 'wall':
        if (!s.done && s.actT > 0.6) {
          s.done = true;
          // 火牆：穿過目標、垂直於本體 → 目標的方向，把場地分開
          const side = V(-dir.z, 0, dir.x);
          const c0 = pl.pos.clone();
          const pts = [];
          for (let i = -3; i <= 3; i++) {
            const p = c0.clone().addScaledVector(side, i * 4.6);
            p.y = g.world.groundAt(p.x, p.z, p.y + 2);
            pts.push(p);
          }
          g.fx.warnLine(
            pts[0].clone().setY(pts[0].y + 0.3),
            pts[6].clone().setY(pts[6].y + 0.3),
            0.9,
            0xff6a20,
            0.25,
          );
          g.later(0.9, () => {
            if (this.dead) return;
            pts.forEach((p, i) => g.later(i * 0.08, () => g.addPool(this, p, 2.8, p2 ? 10 : 8, 200 * dm)));
          });
          g.fx.flameCone(mz, dir.clone().setY(0.3).normalize(), 10, 0.3, 14);
        }
        if (s.actT > 1.6) s.act = null;
        break;
      case 'flame':
        if (s.actT > 0.7) {
          const f = fwdOf(this.yaw);
          s.flT = (s.flT || 0) - dt;
          if (s.flT <= 0) {
            s.flT = 0.07;
            g.fx.flameCone(mz, f.clone().setY(-0.05).normalize(), 8, 0.45, 5);
          }
          s.tickT = (s.tickT || 0) - dt;
          if (s.tickT <= 0) {
            s.tickT = 0.2;
            for (const t of g.hostilesOfEnt(this)) {
              if (t.dead || !t.pos || altOf(g, t) > 5) continue;
              const rel = t.pos.clone().sub(this.pos).setY(0);
              const dd = rel.length();
              if (dd > 15 + t.radius || dd < 0.1) continue;
              if (rel.divideScalar(dd).dot(f) < Math.cos(0.56)) continue;
              t.takeDamage(56 * dm, 90 * dm, this, t.center(), f.clone());
            }
          }
        }
        if (s.actT > 2.7) s.act = null;
        break;
      case 'heat':
        if (!s.done) {
          s.done = true;
          const p = pl.pos.clone();
          p.y = g.world.groundAt(p.x, p.z, p.y);
          g.fx.warnCircle(p, 9, 1.0, 0xff8a30);
          g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R: 9, dl: 1.0, c: 0xff8a30 });
          g.alertAll('熱浪上升 — 離開橘色圈！');
          g.later(1.0, () => {
            if (this.dead) return;
            g.fx.flameCone(p.clone().setY(p.y + 0.5), V(0, 1, 0), 14, 0.35, 24);
            g.fx.shockwave(p.clone().setY(p.y + 0.3), 10, 0xff8a30, 0.5);
            for (const t of g.hostilesOfEnt(this)) {
              if (t.dead || !t.pos || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > 9 + t.radius) continue;
              if (altOf(g, t) < 3) continue;
              t.takeDamage(500 * dm, 900 * dm, this, t.center(), V(0, -1, 0));
              t.vel.y = Math.min(t.vel.y, -18);
            }
          });
        }
        if (s.actT > 1.2) s.act = null;
        break;
    }
    this.bossVis = s.mouthT > 0 ? 1 : 0;
  },
  // ---------- 光學迷彩電戰機：迷彩（打不到鎖定）、全息分身、週期性現形齊射 ----------
  phantomAI(dt) {
    const g = this.game,
      s = this.aiState;
    if (!s.init) {
      s.init = true;
      s.holoT = 0.5;
      s.cycT = rnd(7, 9);
      s.reveal = 0;
      s.selfRev = 0;
    }
    s.holoT -= dt;
    if (s.holoT <= 0) {
      s.holoT = 16;
      const n = this.partsOf('holo').length;
      if (n < 3) {
        g.spawnHolos(this, 3 - n);
        g.alertAll('MIRAGE 展開全息分身 — 只有本體有影子');
      }
    }
    s.cycT -= dt;
    if (s.cycT <= 0) {
      s.cycT = this.phase2() ? rnd(6, 8) : rnd(8, 10);
      s.reveal = 2.6;
      g.alertAll('MIRAGE 現形齊射！');
    }
    if (s.reveal > 0) s.reveal -= dt;
    if (s.selfRev > 0) s.selfRev -= dt;
    // 硬直（EMP、ACS 過載）：分身全部消失、本體現形 3 秒
    if (this.staggerT > 0) {
      if (!s.stagSeen) {
        s.stagSeen = true;
        const hs = this.partsOf('holo');
        for (const h of hs) h.partBreak();
        if (hs.length) g.msgAll('全息分身消失！', 0x7ee081);
        s.selfRev = Math.max(s.selfRev, 3);
      }
    } else s.stagSeen = false;
    const cloaked = s.reveal <= 0 && s.selfRev <= 0;
    this.bossVis = cloaked ? 1 : 0;
  },
  holoAI() {
    const par = this.parentEnt();
    if (!par || par.dead) {
      this.partBreak();
      return;
    }
    const s = this.aiState;
    const cloaked = !(par.aiState.reveal > 0) && !(s.selfRev > 0);
    if (s.selfRev > 0) s.selfRev -= this.game.lastDt || 0.016;
    this.bossVis = cloaked ? 1 : 0;
  },
  // ---------- 衛星砲導引塔：追蹤光柱（越追越快、轉彎有上限）、格子砲擊；之後導引鏡冷卻 ----------
  orbitalAI(dt, wish, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const p2 = this.phase2();
    wish.set(0, 0, 0);
    if (!s.om) {
      s.om = 'idle';
      s.omT = 2.5;
      s.n = 0;
    }
    this.bx = null;
    if (s.om === 'idle') {
      if ((s.omT -= dt) <= 0 && this.canAct()) {
        if (p2 && s.n % 2 === 1) this.orbitalGrid(pl);
        else {
          s.om = 'track';
          s.omT = p2 ? 8 : 7;
          s.el = 0;
          s.tick = 0;
          const a = Math.random() * Math.PI * 2;
          s.pp = V(pl.pos.x + Math.cos(a) * 20, 0, pl.pos.z + Math.sin(a) * 20);
          s.pv = V(pl.pos.x - s.pp.x, 0, pl.pos.z - s.pp.z).setLength(5);
          SFX.play('charge', 1, 0.4, 0.05, 0.05, this.center());
          g.alertAll('衛星砲照射 — 光柱追蹤中，QB 急轉甩開！');
        }
        s.n++;
      }
    } else if (s.om === 'track') {
      s.el += dt;
      const sp = lerp(5, p2 ? 20 : 17, clamp(s.el / 4, 0, 1));
      const want = V(pl.pos.x - s.pp.x, 0, pl.pos.z - s.pp.z);
      const cur = s.pv.clone().normalize();
      if (want.lengthSq() > 0.01) {
        want.normalize();
        const da = Math.atan2(cur.x * want.z - cur.z * want.x, cur.dot(want));
        const turn = (p2 ? 1.9 : 1.5) * dt;
        cur.applyAxisAngle(V(0, 1, 0), -clamp(da, -turn, turn));
      }
      s.pv.copy(cur).multiplyScalar(sp);
      s.pp.addScaledVector(s.pv, dt);
      s.pp.x = clamp(s.pp.x, -LIM(this), LIM(this));
      s.pp.z = clamp(s.pp.z, -LIM(this), LIM(this));
      if ((s.tick -= dt) <= 0) {
        s.tick = 0.2;
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead || !t.pos || Math.hypot(t.pos.x - s.pp.x, t.pos.z - s.pp.z) > PILLAR_R + t.radius * 0.5)
            continue;
          t.takeDamage(150 * dm, 240 * dm, this, t.center(), V(0, -1, 0));
        }
      }
      this.bx = [1, +s.pp.x.toFixed(2), +s.pp.z.toFixed(2)];
      if ((s.omT -= dt) <= 0) {
        s.om = 'cool';
        s.omT = 4.5;
        g.msgAll('導引鏡冷卻中 — 現在攻擊！', 0x7ee081);
      }
    } else if (s.om === 'grid') {
      if ((s.omT -= dt) <= 0) {
        s.om = 'cool';
        s.omT = 4.5;
        g.msgAll('導引鏡冷卻中 — 現在攻擊！', 0x7ee081);
      }
    } else if ((s.omT -= dt) <= 0) {
      s.om = 'idle';
      s.omT = rnd(1.5, 2.5);
    }
    this.bossVis = s.om === 'cool' ? 1 : s.om === 'track' || s.om === 'grid' ? 2 : 0;
  },
  // 格子砲擊：以目標為中心 5×5 格（每格 7 m），四波；每波只留一條安全的直行，下一波往旁邊移一格
  orbitalGrid(pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    s.om = 'grid';
    s.omT = 4 * 1.5 + 1.6;
    const C = 7;
    const cx = clamp(pl.pos.x, -48 * KS(this), 48 * KS(this)),
      cz = clamp(pl.pos.z, -48 * KS(this), 48 * KS(this));
    let lane = Math.floor(Math.random() * 5);
    g.alertAll('衛星砲格子砲擊 — 待在沒有預警的直行！');
    for (let w = 0; w < 4; w++) {
      const safe = lane;
      g.later(w * 1.5, () => {
        if (this.dead) return;
        const cells = [];
        for (let i = 0; i < 5; i++) {
          if (i === safe) continue;
          for (let j = 0; j < 5; j++) {
            const x = cx + (i - 2) * C,
              z = cz + (j - 2) * C;
            const p = V(x, g.world.groundAt(x, z, 99), z);
            cells.push(p);
            g.fx.warnRect(p, 0, C - 0.4, C - 0.4, 1.2, 0x60c8ff);
          }
        }
        g.later(1.2, () => {
          if (this.dead) return;
          SFX.play('laserBig', 0.9, 0.6, 0.05, 0.05, V(cx, cells[0].y, cz));
          for (const p of cells) g.fx.pillarStrike(p, 2.4);
          for (const t of g.hostilesOfEnt(this)) {
            if (t.dead || !t.pos) continue;
            if (!cells.some((p) => Math.abs(t.pos.x - p.x) < C / 2 && Math.abs(t.pos.z - p.z) < C / 2))
              continue;
            t.takeDamage(520 * dm, 900 * dm, this, t.center(), V(0, -1, 0));
          }
          g.camShake = Math.max(g.camShake, 0.2);
        });
      });
      lane = clamp(lane + (Math.random() < 0.5 ? -1 : 1), 0, 4);
      if (lane === safe) lane = safe === 0 ? 1 : safe - 1;
    }
  },
  // ---------- 三機合體：血量降到門檻時分離成三台（本體藏起來），30 秒內全滅才算擊破，否則重新合體並回復 ----------
  trinityAI(dt, d, dir, perp, wish, pl, r) {
    const g = this.game,
      s = this.aiState;
    if (s.nextSplit === undefined) s.nextSplit = this.maxHp * 0.62;
    const subs = this.partsOf('sub');
    if (subs.length && !s.split) {
      // 房主遷移後：從場上的分離機體還原狀態
      s.split = true;
      s.splitT = 10;
      s.merge = 0;
    }
    if (!s.split) {
      this.bossVis = 0;
      if (this.hp < s.nextSplit && s.nextSplit > 0 && this.canAct()) {
        g.trinitySplit(this);
        s.split = true;
        s.splitT = 30;
        s.merge = 0;
        s.say = 30;
        r.done = true;
        this.bossTick(dt);
        return r;
      }
      if (d > s.want + 4) wish.copy(dir).multiplyScalar(0.8);
      else if (d < s.want - 6) wish.copy(dir).multiplyScalar(-0.5);
      else wish.copy(perp).multiplyScalar(0.4);
      return r;
    }
    r.done = true;
    this.bossVis = 1;
    this.flying = true;
    const gy = g.world.terrainHeight(this.pos.x, this.pos.z);
    if (!subs.length) {
      // 三台全滅 → 擊破
      this.bossVis = 0;
      s.split = false;
      this.pos.y = gy;
      this.hp = 0;
      this.die(s.lastKiller || null);
      return r;
    }
    this.hp = Math.max(
      1,
      subs.reduce((a, e) => a + Math.max(0, e.hp), 0),
    );
    if (s.merge > 0) {
      s.merge -= dt;
      for (const e of subs) {
        e.pos.lerp(s.mp, Math.min(1, dt * 2.5));
        e.vel.set(0, 0, 0);
        e.mesh.position.copy(e.pos);
      }
      if (s.merge <= 0) {
        const sum = subs.reduce((a, e) => a + Math.max(0, e.hp), 0);
        for (const e of subs) e.depart();
        this.pos.copy(s.mp);
        this.pos.y = g.world.groundAt(s.mp.x, s.mp.z, s.mp.y + 2);
        this.hp = Math.min(this.maxHp, sum + this.maxHp * 0.25);
        this.flying = false;
        s.split = false;
        s.nextSplit = this.hp - this.maxHp * 0.3;
        if (s.nextSplit < this.maxHp * 0.12) s.nextSplit = -1;
        this.bossVis = 0;
        this.iFrames = 0.5;
        g.fx.explosion(this.center(), 6, 0xff7040, true);
        g.fx.ring(this.center(), 10, 0xff7040);
        g.msgAll('CERBERUS 重新合體 — AP 回復！', 0xff4d4d);
      }
    } else {
      s.splitT -= dt;
      if (s.splitT <= s.say - 10 && s.splitT > 0) {
        s.say -= 10;
        g.msgAll(`CERBERUS 合體倒數 ${Math.ceil(s.splitT)} 秒`, 0xffb020);
      }
      if (s.splitT <= 0) {
        s.merge = 2.2;
        const c = V();
        for (const e of subs) c.add(e.pos);
        s.mp = c.divideScalar(subs.length);
        g.alertAll('CERBERUS 開始合體 — 合體中無防備！');
      }
    }
    if (s.merge <= 0) this.pos.y = gy - 40; // 分離中：本體藏在地下（不擋子彈）
    this.bossTick(dt);
    return r;
  },
  // ---------- 高速突擊機：場外盤旋 → 警示線 → 高速掃射通過（音爆）→ 掉頭減速（輸出時機）；EMP 打中失速 ----------
  interceptorAI(dt, pl) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const p2 = this.phase2();
    this.flying = true;
    if (!s.vm) {
      s.vm = 'loiter';
      s.vmT = rnd(3, 5);
      s.v = V(45, 0, 0);
      s.alt = 26;
    }
    const gy = g.world.terrainHeight(this.pos.x, this.pos.z);
    const rr = V(this.pos.x, 0, this.pos.z);
    const dist = rr.length() || 1;
    let want = s.v.clone(),
      k = 1.5;
    if (this.staggerT > 0 && ['line', 'run', 'turn'].includes(s.vm)) {
      s.vm = 'stall';
      s.vmT = 4;
      s.v.multiplyScalar(0.3);
      g.msgAll('VIPER 失速 — 集中攻擊！', 0x7ee081);
    }
    switch (s.vm) {
      case 'loiter': {
        const tan = V(-rr.z, 0, rr.x).divideScalar(dist);
        want = tan
          .multiplyScalar(45)
          .addScaledVector(rr.clone().divideScalar(dist), (LIM(this) + 16 - dist) * 1.5);
        s.alt = 26;
        if ((s.vmT -= dt) <= 0 && this.canAct()) {
          s.vm = 'line';
          s.vmT = 1.4;
          s.runDir = pl.pos.clone().addScaledVector(pl.vel, 1.2).sub(this.pos).setY(0).normalize();
          s.runO = this.pos.clone(); // 航線起點：之後一直貼著這條線飛（和警示線一致）
          s.v.copy(s.runDir).multiplyScalar(Math.max(30, s.v.length()));
          const c = pl.pos.clone();
          c.y = g.world.groundAt(c.x, c.z, c.y);
          g.fx.warnRect(c, yawOf(s.runDir), 8, 120, 1.6);
          SFX.play('missile', 1, 0.5, 0.05, 0.05, this.center());
          g.alertAll(`VIPER 從${compass(this.pos.clone().sub(pl.pos))}方進場 — 往側邊閃開！`);
        }
        break;
      }
      case 'line':
        want = s.runDir.clone().multiplyScalar(40);
        s.alt = 9;
        k = 3;
        if ((s.vmT -= dt) <= 0) {
          s.vm = 'run';
          s.vmT = 3.2;
          s.boomed = new Set();
          s.v.copy(s.runDir).multiplyScalar(40);
        }
        break;
      case 'run': {
        want = s.runDir.clone().multiplyScalar(p2 ? 82 : 72);
        s.alt = 7;
        k = 4;
        // 掃射：沿航線打地面；目標就在前方航線上時直接瞄準
        let aim = this.pos.clone().addScaledVector(s.runDir, 22);
        aim.y = g.world.groundAt(aim.x, aim.z, 99) + 0.8;
        aim.add(V(rnd(-2, 2), 0, rnd(-2, 2)));
        const rel = pl.center().sub(this.pos);
        const ahead = rel.dot(s.runDir);
        if (ahead > 5 && ahead < 40 && rel.clone().addScaledVector(s.runDir, -ahead).setY(0).length() < 8)
          aim = pl.center().add(V(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-1.5, 1.5)));
        if ((s.gunT = (s.gunT || 0) - dt) <= 0) {
          s.gunT = 0.06;
          this.fire('rarm', aim, null);
          const w = this.weapons.rarm;
          if (w.mag <= 0 && w.reloadT <= 0) {
            w.mag = w.def.mag;
            w.ammo = Math.max(w.ammo, w.def.mag);
          }
        }
        if ((s.rkT = (s.rkT || 0) - dt) <= 0) {
          s.rkT = 0.35;
          this.weapons.larm.mag = Math.max(1, this.weapons.larm.mag);
          this.weapons.larm.ammo = Math.max(1, this.weapons.larm.ammo);
          this.fire('larm', aim, null);
        }
        // 音爆：從身邊 9 m 內掠過的目標
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead || !t.pos || s.boomed.has(t) || t.center().distanceTo(this.center()) > 9) continue;
          s.boomed.add(t);
          t.takeDamage(260 * dm, 650 * dm, this, t.center(), t.center().sub(this.center()).normalize());
          g.fx.shockwave(this.center(), 10, 0xffffff, 0.35);
          SFX.explode(true, this.center());
          g.camShake = Math.max(g.camShake, 0.3);
        }
        if (p2 && (s.mineT = (s.mineT || 0) - dt) <= 0) {
          s.mineT = 0.3;
          const p = this.pos.clone();
          p.y = gy + rnd(2, 6);
          g.layMine(this, p, { dmg: 380 * dm, im: 600 * dm, R: 4, life: 7, air: true, quiet: true });
        }
        const past = this.pos.clone().sub(pl.pos).setY(0).dot(s.runDir);
        const leaving =
          (Math.abs(this.pos.x) > LIM(this) + 4 || Math.abs(this.pos.z) > LIM(this) + 4) &&
          this.pos.x * s.runDir.x + this.pos.z * s.runDir.z > 0;
        if (past > 50 || leaving || (s.vmT -= dt) <= 0) {
          s.vm = 'turn';
          s.vmT = 2.6;
        }
        break;
      }
      case 'turn':
        want = rr.clone().divideScalar(-dist).multiplyScalar(22);
        s.alt = 11;
        k = 1.8;
        if ((s.vmT -= dt) <= 0) {
          s.vm = 'climb';
          s.vmT = 2.0;
        }
        break;
      case 'climb':
        want = rr.clone().divideScalar(dist).multiplyScalar(45);
        s.alt = 26;
        if ((s.vmT -= dt) <= 0) {
          s.vm = 'loiter';
          s.vmT = p2 ? rnd(2, 3.5) : rnd(3, 5);
        }
        break;
      case 'stall':
        want = s.v.clone().setLength(8);
        s.alt = 3;
        k = 2;
        if (this.staggerT <= 0 && (s.vmT -= dt) <= 0) {
          s.vm = 'climb';
          s.vmT = 2.5;
        }
        if (Math.random() < dt * 10) g.fx.smoke(this.center(), 1.4, 0x3a3e44, 1, 2);
        break;
    }
    const prevYaw = this.yaw;
    const onLine = (s.vm === 'line' || s.vm === 'run') && s.runO;
    if (onLine) {
      // 進場與掃射：方向固定在航線上，只改速度，位置貼回航線
      const sp = lerp(s.v.length(), want.length(), Math.min(1, dt * k));
      s.v.copy(s.runDir).multiplyScalar(sp);
      this.pos.addScaledVector(s.v, dt);
      const side = V(-s.runDir.z, 0, s.runDir.x);
      this.pos.addScaledVector(side, -this.pos.clone().sub(s.runO).dot(side));
    } else {
      s.v.lerp(want, Math.min(1, dt * k));
      this.pos.addScaledVector(s.v, dt);
    }
    this.pos.x = clamp(this.pos.x, -LIM(this) - 33, LIM(this) + 33);
    this.pos.z = clamp(this.pos.z, -LIM(this) - 33, LIM(this) + 33);
    this.pos.y = lerp(this.pos.y, gy + s.alt, Math.min(1, dt * (onLine ? 4 : 2.5)));
    if (s.v.lengthSq() > 1) this.yaw = this.aimYaw = yawOf(s.v);
    const yr = Math.atan2(Math.sin(this.yaw - prevYaw), Math.cos(this.yaw - prevYaw)) / Math.max(dt, 1e-3);
    this.leanZ = lerp(this.leanZ || 0, clamp(-yr * 0.5, -0.9, 0.9), Math.min(1, dt * 4));
    this.bossVis = s.vm === 'stall' ? 1 : s.vm === 'turn' ? 2 : 0;
    this.bossTick(dt);
    this.mesh.rotation.z = this.leanZ;
    this.vel.copy(s.v);
  },
  // ---------- 衝撞推土要塞：預警線 → 直線衝撞（撞碎物件、撞飛目標）→ 撞上高台或邊界時硬直、背後散熱口打開 ----------
  rampartAI(dt, d, dir, perp, wish, pl, r) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul,
      w = g.world;
    const p2 = this.phase2();
    if (!s.rm) {
      s.rm = 'walk';
      s.rmT = rnd(5, 7);
    }
    const f = fwdOf(this.yaw),
      rt = V(-f.z, 0, f.x);
    // 兩側的絞碎滾筒
    if ((s.grT = (s.grT || 0) - dt) <= 0) {
      s.grT = 0.25;
      for (const t of g.hostilesOfEnt(this)) {
        if (t.dead || !t.pos || altOf(g, t) > 3) continue;
        const rel = t.pos.clone().sub(this.pos);
        const ff = rel.dot(f),
          ll = rel.dot(rt);
        if (Math.abs(ff) < 4 && Math.abs(ll) > 3 && Math.abs(ll) < 6.5)
          t.takeDamage(90 * dm, 200 * dm, this, t.center(), rt.clone().multiplyScalar(Math.sign(ll)));
      }
    }
    this.bossVis = 0;
    switch (s.rm) {
      case 'walk':
        if (d > s.want) wish.copy(dir).multiplyScalar(0.7);
        else wish.copy(perp).multiplyScalar(0.3);
        if ((s.rmT -= dt) <= 0 && this.canAct() && d < 70) this.rampartAim(dir);
        break;
      case 'aim':
        wish.set(0, 0, 0);
        this.aimYaw = yawOf(s.cdir);
        if ((s.rmT -= dt) <= 0) {
          s.rm = 'charge';
          s.dist = 0;
          s.v = 0;
          s.hitSet = new Set();
        }
        break;
      case 'charge': {
        r.done = true;
        this.bossVis = 2;
        s.v = Math.min(s.v + 60 * dt, p2 ? 40 : 34);
        const step = s.cdir.clone().multiplyScalar(s.v * dt);
        const nx = this.pos.x + step.x,
          nz = this.pos.z + step.z;
        let crash = Math.abs(nx) > LIM(this) - 4 || Math.abs(nz) > LIM(this) - 4;
        if (!crash) {
          // 前方的可破壞物件直接撞碎
          const front = V(nx, this.pos.y, nz).addScaledVector(s.cdir, 4.5);
          let broke = false;
          for (const p of g.destructibles()) {
            if (!p.isProp || p.dead || !p.center) continue;
            if (p.center().setY(front.y).distanceTo(front) < 5 + (p.radius || 1)) {
              g.damageProp(p, 1e5, 2000, p.center());
              broke = true;
            }
          }
          const [cx, cz] = w.collide(nx, nz, this.pos.y, this.radius * 0.8);
          if (Math.hypot(cx - nx, cz - nz) > 0.25 && !broke) crash = true;
        }
        // 撞飛路線上的目標
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead || !t.pos || s.hitSet.has(t) || altOf(g, t) > 5) continue;
          const rel = t.pos.clone().sub(this.pos);
          const ff = rel.dot(s.cdir),
            ll = rel.dot(V(-s.cdir.z, 0, s.cdir.x));
          if (ff < -2 || ff > 6.5 || Math.abs(ll) > 5 + t.radius * 0.5) continue;
          s.hitSet.add(t);
          t.takeDamage(800 * dm, 1700 * dm, this, t.center(), s.cdir.clone());
          t.vel
            .addScaledVector(s.cdir, 20)
            .addScaledVector(V(-s.cdir.z, 0, s.cdir.x), Math.sign(ll || 1) * 10);
          t.vel.y = Math.max(t.vel.y, 10);
          t.grounded = false;
          g.camShake = Math.max(g.camShake, 0.3);
        }
        if (crash) {
          s.rm = 'stun';
          s.rmT = 5;
          this.acs = this.acsMax;
          this.staggerT = 5;
          const fp = this.center().addScaledVector(s.cdir, 6);
          g.fx.explosion(fp, 5, 0xffa040, true);
          g.fx.dust(this.pos.clone(), 7, 22, 0xb09070);
          g.camShake = Math.max(g.camShake, 0.45);
          g.msgAll('BEHEMOTH 撞擊 — 背後散熱口打開！', 0x7ee081);
          g.netEv({ t: 'stag', i: this.id });
        } else {
          this.pos.x = nx;
          this.pos.z = nz;
          this.pos.y = w.groundAt(nx, nz, this.pos.y + 1.5);
          s.dist += step.length();
          if (Math.random() < dt * 20) g.fx.dust(this.pos.clone(), 2.5, 4, 0xb09070);
          if (s.dist > 75) {
            if (p2 && !s.second) {
              s.second = true;
              this.rampartAim(dir, 1.0);
            } else {
              s.rm = 'recover';
              s.rmT = 1.4;
            }
          }
        }
        this.yaw = this.aimYaw = yawOf(s.cdir);
        this.bossTick(dt);
        this.vel.copy(s.cdir).multiplyScalar(crash ? 0 : s.v);
        break;
      }
      case 'stun':
        wish.set(0, 0, 0);
        this.bossVis = 1;
        if ((s.rmT -= dt) <= 0) {
          s.rm = 'walk';
          s.rmT = p2 ? rnd(4, 6) : rnd(6, 8);
          s.second = false;
        }
        break;
      default:
        wish.set(0, 0, 0);
        if ((s.rmT -= dt) <= 0) {
          s.rm = 'walk';
          s.rmT = p2 ? rnd(4, 6) : rnd(6, 8);
          s.second = false;
        }
    }
  },
  // 衝撞預警：鎖定方向，地面標出衝撞路線（到第一個擋住的地方，最長 75 m）
  rampartAim(cdir, tele = 1.5) {
    const g = this.game,
      s = this.aiState,
      w = g.world;
    s.rm = 'aim';
    s.rmT = tele;
    s.cdir = cdir.clone().setY(0).normalize();
    let L = 4;
    for (; L < 75 * KS(this); L += 2) {
      const x = this.pos.x + s.cdir.x * L,
        z = this.pos.z + s.cdir.z * L;
      if (Math.abs(x) > LIM(this) - 4 || Math.abs(z) > LIM(this) - 4) break;
      const [cx, cz] = w.collide(x, z, this.pos.y, this.radius * 0.8);
      if (Math.hypot(cx - x, cz - z) > 0.5) break;
    }
    const c = this.pos.clone().addScaledVector(s.cdir, L / 2);
    c.y = w.groundAt(c.x, c.z, this.pos.y + 1);
    g.fx.warnRect(c, yawOf(s.cdir), 9, L, tele);
    SFX.play('heavy', 1, 0.6, 0.05, 0.05, this.center());
    g.alertAll('BEHEMOTH 衝撞 — 離開警示線！');
  },
  // ---------- 脈衝刃翼：擴散能量環（只能用 QB 穿過）、雷射扇形、直線突刺 ----------
  ibisAI(dt, d, dir, perp, wish, pl, r) {
    const g = this.game,
      s = this.aiState,
      dm = this.dmgMul;
    const p2 = this.phase2();
    this.flying = true;
    if (s.overT > 0) s.overT -= dt;
    if (!s.pa) {
      if (d > s.want + 4) wish.copy(dir).add(perp.clone().multiplyScalar(0.5)).normalize();
      else if (d < s.want - 5) wish.copy(dir).multiplyScalar(-1);
      else wish.copy(perp);
      s.qbT = (s.qbT || 0) - dt;
      const threat = g.projectiles.some(
        (q) => q.team !== this.team && q.pos.distanceToSquared(this.center()) < 120,
      );
      if (s.qbT <= 0 && threat && Math.random() < dt * 5) {
        r.qb = true;
        s.qbT = rnd(0.8, 1.6);
        wish.copy(perp).normalize();
      }
      s.cdT = (s.cdT === undefined ? 2.5 : s.cdT) - dt;
      if (s.cdT <= 0 && this.canAct() && !(s.overT > 0)) {
        s.cdT = p2 ? rnd(2.5, 3.5) : rnd(3.5, 4.5);
        const x = Math.random();
        s.pa = x < 0.45 ? 'pulse' : x < 0.75 || d < 12 ? 'lasers' : 'dash';
        s.paT = 0;
        s.done = false;
        if (s.pa === 'pulse') {
          SFX.play('charge', 1, 0.9, 0.05, 0.05, this.center());
          if (!s.pulseSaid) {
            s.pulseSaid = true;
            g.alertAll('脈衝環充能 — 碰到的瞬間 QB 穿過去！');
          }
        }
      }
    } else {
      wish.set(0, 0, 0);
      s.paT += dt;
      if (!this.canAct() && s.pa !== 'dashing') s.pa = null;
    }
    switch (s.pa) {
      case 'pulse':
        if (!s.done && s.paT > 1.0) {
          s.done = true;
          const n = p2 ? 3 : 1;
          for (let i = 0; i < n; i++)
            g.later(i * 0.55, () => {
              if (!this.dead) g.pulseRing(this, { R: 48, sp: 24, band: 1.8, dmg: 420 * dm, im: 900 * dm });
            });
          s.overT = 2.5 + 0.55 * (n - 1);
        }
        if (s.paT > 1.2) s.pa = null;
        break;
      case 'lasers':
        if (!s.done) {
          s.done = true;
          const from = this.center();
          const base = pl.center().sub(from).normalize();
          s.fan = [];
          for (let i = -2; i <= 2; i++) {
            const v = base.clone().applyAxisAngle(V(0, 1, 0), (i * 12 * Math.PI) / 180);
            s.fan.push(v);
            g.fx.warnLine(from, from.clone().addScaledVector(v, 60), 0.8, 0xff3050, 0.08);
          }
          s.fanFrom = from;
        }
        if (s.fan && s.paT > 0.8) {
          for (const v of s.fan)
            g.beamAttack(this, s.fanFrom, v, {
              range: 60,
              dmg: 380 * dm,
              im: 500 * dm,
              w: 0.7,
              color: 0xff5070,
              width: 0.22,
            });
          SFX.play('laserBig', 0.8, 1.1, 0.05, 0.05, s.fanFrom);
          s.fan = null;
          s.pa = null;
        }
        break;
      case 'dash':
        if (!s.done) {
          s.done = true;
          const from = this.center();
          s.dDir = pl.center().sub(from);
          s.dLen = s.dDir.length() + 22;
          s.dDir.normalize();
          g.fx.warnLine(from, from.clone().addScaledVector(s.dDir, s.dLen), 0.6, 0xff5070, 0.3);
        }
        if (s.paT > 0.6) {
          s.pa = 'dashing';
          s.dGone = 0;
          s.hitSet = new Set();
        }
        break;
      case 'dashing': {
        r.done = true;
        const step = 85 * dt;
        this.pos.addScaledVector(s.dDir, step);
        const gy = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
        if (this.pos.y < gy + 0.5) this.pos.y = gy + 0.5;
        this.pos.x = clamp(this.pos.x, -LIM(this), LIM(this));
        this.pos.z = clamp(this.pos.z, -LIM(this), LIM(this));
        s.dGone += step;
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead || !t.pos || s.hitSet.has(t) || t.center().distanceTo(this.center()) > 3.2 + t.radius)
            continue;
          s.hitSet.add(t);
          t.takeDamage(600 * dm, 1200 * dm, this, t.center(), s.dDir.clone());
        }
        if (Math.random() < dt * 40)
          g.fx.streaks(this.center(), 2, 0xff6080, 6, 0.3, 0, s.dDir.clone().negate());
        this.yaw = this.aimYaw = yawOf(s.dDir);
        this.bossTick(dt);
        this.vel.copy(s.dDir).multiplyScalar(85);
        if (s.dGone >= s.dLen) {
          s.pa = null;
          s.overT = 0.7;
          this.hoverH = clamp(this.pos.y - gy, 3, 10);
        }
        break;
      }
    }
    if (!s.pa || s.pa === 'pulse') this.hoverH = lerp(this.hoverH, 6, Math.min(1, dt));
    this.bossVis = (s.overT > 0 ? 1 : 0) | (s.pa === 'pulse' ? 2 : 0) | (s.pa === 'dashing' ? 4 : 0);
  },
  // ---------- 附屬部位（mech-boss.js 的 partAI 先問這裡）：回傳 true 表示已處理 ----------
  part2AI(dt, d, pl) {
    const k = this.opts.partKind;
    if (k === 'bit') {
      this.bitAI(dt, pl);
      return true;
    }
    if (CARS.includes(k)) {
      this.carAI(dt, d, pl);
      return true;
    }
    return false;
  },
  // 浮游砲：飛到包圍目標的位置，輪到自己時預警後開火；被 EMP（硬直）打中就墜毀
  bitAI(dt, pl) {
    const g = this.game,
      s = this.aiState;
    const par = this.parentEnt();
    if (!par || par.dead) {
      this.partBreak();
      return;
    }
    if (this.staggerT > 0) {
      g.fx.explosion(this.center(), 1.6, 0xffd070, false);
      this.die(null);
      return;
    }
    this.flying = true;
    const ps = par.aiState;
    const n = Math.max(1, s.n || 6),
      i = s.slot || 0;
    let goal;
    if (ps.fm === 'place' || ps.fm === 'attack') {
      const a = (ps.a0 || 0) + (i * Math.PI * 2) / n + g.time * 0.35;
      const R = 12 + (i % 2) * 3;
      goal = pl.pos.clone().add(V(Math.cos(a) * R, 4 + (i % 3) * 2.2, Math.sin(a) * R));
    } else {
      const a = this.t * 1.5 + (i * Math.PI * 2) / n;
      goal = par.center().add(V(Math.cos(a) * 3.5, 0.8 * Math.sin(this.t * 2 + i), Math.sin(a) * 3.5));
    }
    const to = goal.sub(this.pos);
    const L = to.length();
    if (L > 0.01) this.pos.addScaledVector(to, Math.min(L, 28 * dt) / L);
    this.yaw = this.aimYaw = yawOf(pl.pos.clone().sub(this.pos));
    this.bx = null;
    if (s.tele > 0) {
      if (!s.aim) s.aim = pl.center().addScaledVector(pl.vel, 0.25);
      s.tele -= dt;
      this.bx = [1, ...s.aim.toArray().map((x) => +x.toFixed(2))];
      if (s.tele <= 0) {
        const from = this.center();
        g.beamAttack(this, from, s.aim.clone().sub(from).normalize(), {
          range: 60,
          dmg: 260 * this.dmgMul,
          im: 380 * this.dmgMul,
          w: 0.5,
          color: 0xffd070,
          width: 0.14,
          pierce: false,
        });
        SFX.play('laser', 0.5, 1.3, 0.05, 0.05, from);
        s.aim = null;
        this.bx = null;
      }
    }
    this.bossTick(dt);
  },
  // ---------- 受傷前的修正（bossDefense 呼叫）：回傳倍率；null＝完全擋下；undefined＝不是這裡的 Boss ----------
  boss2Defense(dmg, impact, from, at, wid, melee) {
    const g = this.game,
      s = this.aiState;
    const hint = (txt) => {
      if (from && from.isPlayer && !s.hinted) {
        s.hinted = true;
        g.flashAlert(txt);
      }
    };
    const k = this.opts.partKind;
    if (k === 'bit') return 1;
    if (CARS.includes(k)) return this.inTunnel() ? null : 1;
    if (k === 'sub') {
      const par = this.parentEnt();
      return par && par.aiState.merge > 0 ? 1.8 : 1;
    }
    if (k === 'holo') return 1;
    if (this.opts.bossKind === 'mirror') return this.mirrorDefense(dmg, wid, melee);
    switch (this.ai) {
      case 'railgun':
        if (this.bossVis & 1) return 1.7;
        hint('砲台裝甲過厚 — 發射後散熱片打開時才是弱點');
        return 0.3;
      case 'funnel':
        return this.bossVis & 1 ? 1.5 : 0.7;
      case 'train':
        if (this.inTunnel()) return null;
        if (this.bossVis & 2) return 1.5;
        hint('機車頭裝甲很厚 — 衝撞後鍋爐過熱時最脆弱');
        return 0.6;
      case 'furnace':
        if (this.bossVis & 1) return 1.8;
        hint('熔爐口關閉時裝甲很厚 — 等它打開');
        return 0.45;
      case 'phantom':
        s.selfRev = Math.max(s.selfRev || 0, 1.5);
        return 1;
      case 'orbital':
        if (this.bossVis & 1) return 1.7;
        hint('導引塔有力場保護 — 等光柱結束、導引鏡冷卻');
        return 0.35;
      case 'trinity':
        return this.bossVis & 1 ? null : 1;
      case 'interceptor': {
        const vm = s.vm;
        return vm === 'stall' ? 1.6 : vm === 'turn' ? 1.35 : vm === 'loiter' || vm === 'climb' ? 0.6 : 0.85;
      }
      case 'rampart': {
        const src = from && from.pos && from !== this ? from.pos : at;
        let fd = 0;
        if (src) {
          const rel = src.clone().sub(this.pos).setY(0);
          if (rel.lengthSq() > 0.01) fd = rel.normalize().dot(fwdOf(this.yaw));
        }
        if (this.bossVis & 1) return fd < -0.3 ? 2.4 : fd > 0.5 ? 0.8 : 1.4;
        if (fd > 0.5) hint('正面裝甲極厚 — 繞到背後，或誘它撞上高台');
        return fd > 0.5 ? 0.3 : fd < -0.5 ? 1.2 : 0.75;
      }
      case 'ibis':
        return this.bossVis & 1 ? 1.6 : this.bossVis & 4 ? 0.6 : 0.9;
    }
    return undefined;
  },
  // 武裝列車（機車頭／車廂）是否在隧道裡：房主用軌道參數判斷（剛生成、還沒更新時也正確），客機看 bossVis
  inTunnel() {
    const par = this.ai === 'train' ? this : this.parentEnt();
    const ts = par && par.aiState.ts;
    if (ts === undefined || this.remote) return !!(this.bossVis & 1);
    const k = CARS.indexOf(this.opts.partKind) + 1;
    return Math.abs(ts - k * CAR_SP) > TRACK(this) + 1;
  },
  // 複製 AC 的適應裝甲：最近常受到的傷害類型抗性提高（最多 70%）
  mirrorDefense(dmg, wid, melee) {
    const s = this.aiState;
    let cat = 2;
    if (melee) cat = 3;
    else if (wid) {
      const ty = (partById(wid.startsWith('bw_') ? 'back' : 'arm', wid) || {}).type;
      cat = DMG_CAT[ty] !== undefined ? DMG_CAT[ty] : 2;
    }
    if (!s.ad) s.ad = [0, 0, 0, 0];
    const k = 1 - this.mirrorRes(cat);
    s.ad[cat] += dmg;
    return k;
  },
  mirrorRes(cat) {
    const s = this.aiState;
    if (!s.ad) return 0;
    const sum = s.ad[0] + s.ad[1] + s.ad[2] + s.ad[3];
    if (sum < this.maxHp * 0.04) return 0;
    return 0.7 * clamp((s.ad[cat] / sum) * 1.25 - 0.15, 0, 1) * clamp(sum / (this.maxHp * 0.12), 0, 1);
  },
  boss2Die(from) {
    const g = this.game;
    const k = this.opts.partKind;
    if (k === 'sub') {
      const par = this.parentEnt();
      if (par && from) par.aiState.lastKiller = from;
    }
    if (this.ai === 'holo' && !this.gone) {
      // 分身被打中：小型電磁脈衝
      const c = this.center();
      const par = this.parentEnt();
      const dm = par ? par.dmgMul : this.dmgMul;
      g.fx.shockwave(c, 6, 0x60fff0, 0.4);
      g.fx.flash(c, 3, 0xbffff8, 0.2);
      for (const t of g.hostilesOfEnt(this)) {
        if (t.dead || !t.pos || t.center().distanceTo(c) > 6 + t.radius) continue;
        t.takeDamage(150 * dm, 300 * dm, this, t.center(), t.center().sub(c).normalize());
        t.empLockT = Math.max(t.empLockT || 0, 1.2);
      }
    }
  },
  // ---------- 顯示（房主與客機每格）----------
  boss2Fx(dt) {
    const g = this.game,
      m = this.model;
    const vis = this.bossVis || 0;
    // 迷彩（本體與分身）：半透明，本體的影子照常；迷彩中不能鎖定（分身可以，用來干擾）
    if (this.ai === 'phantom' || this.ai === 'holo') {
      const want = this.dead ? 1 : vis & 1 ? 0.06 : 1;
      this.cloakA = lerp(this.cloakA === undefined ? 1 : this.cloakA, want, Math.min(1, dt * 6));
      this.applyCloak(this.cloakA);
      this.noLock = this.ai === 'phantom' && !!(vis & 1);
      if (vis & 1 && Math.random() < dt * 3)
        g.fx.spark(
          this.center().add(V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(this.scale)),
          0x60fff0,
        );
    }
    if (this.ai === 'trinity') {
      this.noLock = !!(vis & 1);
      this.mesh.visible = !this.dead && !(vis & 1);
    }
    if (CARS.includes(this.opts.partKind) || this.ai === 'train') {
      this.mesh.visible = !this.dead && !(vis & 1);
      this.noLock = !!(vis & 1);
      if (m.boiler) m.boiler.emissiveIntensity = vis & 2 ? 2.6 + Math.sin(this.t * 12) * 0.6 : 0.4;
      if (vis & 2 && Math.random() < dt * 12)
        g.fx.smoke(this.center().setY(this.pos.y + 4.4), 1.4, 0xd0d0d0, 1, 4);
    }
    if (this.opts.bossKind === 'mirror') this.mirrorFx(dt);
    if (m.fins) {
      const open = vis & 1 ? 1 : 0;
      this.finO = lerp(this.finO || 0, open, Math.min(1, dt * 5));
      for (const f of m.fins) f.rotation.z = f.userData.side * this.finO * 0.9;
      if (m.barrel)
        m.barrel.rotation.x = lerp(m.barrel.rotation.x, clamp(this.aimPitch || 0, -0.25, 0.5), 0.15);
      if (open && Math.random() < dt * 14)
        g.fx.smoke(this.center().setY(this.pos.y + 5), 1.2, 0xc8c8c8, 1, 3);
    }
    if (m.jaws) {
      this.jawO = lerp(this.jawO || 0, vis & 1 ? 1 : 0, Math.min(1, dt * 6));
      for (const j of m.jaws) j.rotation.y = j.userData.side * this.jawO * 1.1;
      if (m.core) m.core.emissiveIntensity = 1 + this.jawO * 2.5;
    }
    if (m.grinders) {
      for (const gr of m.grinders) gr.rotation.z += dt * (vis & 2 ? 14 : 4);
      this.ventO = lerp(this.ventO || 0, vis & 1 ? 1 : 0, Math.min(1, dt * 5));
      for (const v of m.vents) v.rotation.x = -this.ventO * 1.2;
      if (m.heat) m.heat.emissiveIntensity = 0.3 + this.ventO * 3;
    }
    if (m.wings) {
      const spread = vis & 2 ? 1 : vis & 4 ? -0.6 : 0.3;
      this.wingO = lerp(this.wingO || 0, spread, Math.min(1, dt * 6));
      for (const w of m.wings) w.rotation.z = w.userData.sy * this.wingO * 0.5;
      if (m.core) m.core.emissiveIntensity = vis & 2 ? 4 : vis & 1 ? 0.4 : 1.4;
      if (vis & 1 && Math.random() < dt * 10) g.fx.smoke(this.center(), 0.8, 0x806068, 0.8, 2);
    }
    if (m.lens && this.ai === 'orbital') {
      m.lens.emissiveIntensity = vis & 1 ? 0.25 : vis & 2 ? 3.2 : 1.6;
      if (m.rotor) m.rotor.rotation.y += dt * (vis & 2 ? 3 : 0.6);
    }
    // 瞄準線（電磁砲、浮游砲）與光柱（衛星砲）
    const bx = this.dead ? null : this.bx;
    const line = bx && bx[0] === 1 && (this.ai === 'railgun' || this.opts.partKind === 'bit');
    if (line) {
      const sx = this.sx || (this.sx = {});
      if (!sx.aimLine) {
        sx.aimLine = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 1, 6, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0xff2020,
            transparent: true,
            opacity: 0.7,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        sx.aimLine.renderOrder = 4;
        g.scene.add(sx.aimLine);
      }
      const a = this.ai === 'railgun' ? this.muzzle('rback') : this.center();
      const b = V(bx[1], bx[2], bx[3]);
      const frac = this.ai === 'railgun' ? bx[4] || 0 : 0.5;
      const L = sx.aimLine;
      L.visible = true;
      L.position.copy(a).lerp(b, 0.5);
      const wdt = this.ai === 'railgun' ? 0.05 + frac * 0.12 : 0.05;
      L.scale.set(wdt, a.distanceTo(b), wdt);
      L.lookAt(b);
      L.rotateX(Math.PI / 2);
      L.material.color.set(frac > 0.8 ? 0xffffff : this.ai === 'railgun' ? 0xff2020 : 0xffd070);
      L.material.opacity = frac > 0.8 ? 0.5 + 0.5 * Math.abs(Math.sin(this.t * 30)) : 0.6;
      if (this.ai === 'railgun' && Math.random() < dt * 20) g.fx.streaks(a, 1, 0x9fe8ff, 4, 0.2, 0);
    } else if (this.sx && this.sx.aimLine) this.sx.aimLine.visible = false;
    if (this.ai === 'orbital') {
      const sx = this.sx || (this.sx = {});
      const on = bx && bx[0] === 1;
      if (on && !sx.pillar) {
        const grp = new THREE.Group();
        const mk = (r, h, c, o) =>
          new THREE.Mesh(
            new THREE.CylinderGeometry(r, r, h, 16, 1, true),
            new THREE.MeshBasicMaterial({
              color: c,
              transparent: true,
              opacity: o,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
        const outer = mk(PILLAR_R, 90, 0x60c8ff, 0.35),
          inner = mk(PILLAR_R * 0.35, 90, 0xffffff, 0.8);
        outer.position.y = inner.position.y = 45;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(PILLAR_R * 0.9, PILLAR_R * 1.15, 32),
          new THREE.MeshBasicMaterial({
            color: 0x9fe8ff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.15;
        grp.add(outer, inner, ring);
        grp.renderOrder = 4;
        g.scene.add(grp);
        sx.pillar = grp;
        sx.pillarOuter = outer;
      }
      if (sx.pillar) {
        sx.pillar.visible = !!on;
        if (on) {
          const x = bx[1],
            z = bx[2];
          sx.pillar.position.set(x, g.world.terrainHeight(x, z), z);
          sx.pillarOuter.scale.x = sx.pillarOuter.scale.z = 1 + 0.08 * Math.sin(this.t * 25);
          if (Math.random() < dt * 25)
            g.fx.streaks(
              sx.pillar.position.clone().setY(sx.pillar.position.y + 0.3),
              2,
              0x9fe8ff,
              10,
              0.3,
              20,
            );
          if (Math.random() < dt * 4) g.fx.smoke(sx.pillar.position.clone(), 1.6, 0x4a5058, 1, 2);
        }
      }
    }
  },
  // 迷彩：所有材質的透明度（描邊外殼在半透明時隱藏）
  applyCloak(a) {
    if (!this.cloakMats) {
      this.cloakMats = [];
      this.cloakOutlines = [];
      this.mesh.traverse((o) => {
        if (!o.isMesh) return;
        if (o.material === OUTLINE_MAT) {
          this.cloakOutlines.push(o);
          return;
        }
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const mt of ms) {
          if (this.cloakMats.includes(mt)) continue;
          mt.userData.cloakO = mt.opacity;
          mt.userData.cloakT = mt.transparent;
          mt.transparent = true;
          this.cloakMats.push(mt);
        }
      });
    }
    for (const mt of this.cloakMats) {
      mt.opacity = (mt.userData.cloakO === undefined ? 1 : mt.userData.cloakO) * a;
      mt.depthWrite = a > 0.6;
    }
    for (const o of this.cloakOutlines) o.visible = a > 0.6;
  },
  // 複製 AC：依目前最高的抗性類型發光（房主同時更新累積傷害的衰減）
  mirrorFx(dt) {
    const g = this.game,
      s = this.aiState;
    if (!this.remote) {
      if (s.ad) for (let i = 0; i < 4; i++) s.ad[i] *= Math.exp(-dt / 14);
      let best = 0,
        br = 0;
      for (let i = 0; i < 4; i++) {
        const r = this.mirrorRes(i);
        if (r > br) {
          br = r;
          best = i;
        }
      }
      if (!s.said) s.said = [0, 0, 0, 0];
      if (br > 0.4 && !s.said[best]) {
        s.said[best] = 1;
        g.msgAll(`DOPPEL 適應裝甲：對${CAT_NAME[best]}的抗性提高 — 換武器！`, 0xffb020);
      }
      if (br < 0.2) s.said[best] = 0;
      this.bossVis = br > 0.15 ? best + 1 + (Math.min(7, Math.round(br * 10)) << 3) : 0;
    }
    const vis = this.bossVis || 0;
    const cat = (vis & 7) - 1,
      lvl = vis >> 3;
    if (!this.tintMats) {
      this.tintMats = [];
      this.mesh.traverse((o) => {
        if (
          o.isMesh &&
          o.material !== OUTLINE_MAT &&
          o.material.emissive &&
          !this.tintMats.includes(o.material)
        )
          this.tintMats.push(o.material);
      });
      this.tintBase = this.tintMats.map((mt) => [mt.emissive.getHex(), mt.emissiveIntensity]);
    }
    const col = cat >= 0 ? CAT_COL[cat] : 0;
    this.tintMats.forEach((mt, i) => {
      if (cat < 0) {
        mt.emissive.setHex(this.tintBase[i][0]);
        mt.emissiveIntensity = this.tintBase[i][1];
      } else {
        mt.emissive.setHex(col);
        mt.emissiveIntensity = 0.08 * lvl * (0.85 + 0.15 * Math.sin(this.t * 5));
      }
    });
  },
  boss2Cleanup() {
    const g = this.game;
    if (!this.sx) return;
    for (const k of ['aimLine', 'pillar']) {
      if (this.sx[k]) {
        g.scene.remove(this.sx[k]);
        this.sx[k] = null;
      }
    }
  },
});
