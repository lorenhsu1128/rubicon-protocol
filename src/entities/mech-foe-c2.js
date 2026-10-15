// ---------- MechEntity 擴充：地圖專屬敵人擴充（C2 組，data/foes-c2.js）----------
// fueler 燃料洩漏車：繞到目標附近灑燃料（g.addZone 'fuel'，幾秒後點火成燃燒地面），擊破時原地大範圍燃燒。
// missilerack 誘導飛彈架：預警線後發射慢速的大型追蹤飛彈（可以擊落：Projectile 的 shootable；撞上障礙物就爆炸）。
// netter 拋網無人機：預警線 0.8 秒 → 射出捕獲網，打中套 'net'（A1 的狀態效果：減速、不能跳）。
// boomer 迴旋刃無人機：預警後丟出迴旋刃，飛到預判點再飛回來（去程、回程各判定一次）；刃的位置以 bx 同步給客機。
// mirror 反射鏡衛星：雷射只有 30%（laserK）；蓄力後射出聚光的能量光束（beamAttack）。
// focus 聚光鏡陣列：預警後的追蹤光束（g.addZone 'beam'）照越久越痛，視線被擋住就斷開。
// 狀態（bossVis）：1＝預警、2＝攻擊中（聚光鏡陣列 2～10＝光束強度）；行為只在房主／單機，顯示（foeFx_c2）房主與客機都跑。
// 共用的 g.addZone（燃料、光束：game/hazards2.js）、addStatus（entities/mech-status.js）、shootable（投射物）。
import { SFX } from '../audio/audio.js';
import { clamp, lerp, rnd } from '../core/math.js';
import { FOE_AI_C2 } from '../data/foes-c2.js';
import { buildBoomerBlade } from '../render/foe-models-c2.js';
import { MechEntity } from './mech-entity.js';
import { Projectile } from './projectile.js';

const C2 = new Set(FOE_AI_C2);
// 數值（dmgMul 之前）
const FUEL = {
  R: 7,
  life: 10,
  ignite: 2.5,
  dps: 70,
  cd: [7, 9],
  warn: 0.8,
  burstR: 9,
  burstLife: 9,
  burstDps: 90,
};
const RACK = { warn: 1.2, cd: [7, 8.5], sp: 16, turn: 1.0, life: 9, dmg: 900, im: 1300, R: 5, hp: 240 };
const NET = { warn: 0.8, cd: [6, 7.5], sp: 38, dmg: 120, im: 300, life: 1.6, sec: 3, hitR: 1.4 };
const BLADE = { warn: 0.7, cd: [5, 6], sp: 30, back: 26, dmg: 300, im: 650, hitR: 1.1, over: 6, maxT: 4.5 };
const MIRROR = { warn: 1.0, cd: [4, 5.5], dmg: 170, im: 220, range: 70 };
const FOCUS = { warn: 1.2, cd: [5, 7], life: 6, dps0: 60, dps1: 320, ramp: 4, brk: 3.5, range: 80 };
const NET_COL = 0xe0f8ff,
  BLADE_COL = 0x60e0ff,
  BEAM_Y = new THREE.Color(0xfff080),
  BEAM_R = new THREE.Color(0xff3020);
const _c = new THREE.Color();

Object.assign(MechEntity.prototype, {
  // mech-foe.js 的 foeMove 轉過來：回傳 undefined＝不是這一組的
  foeMove_c2(dt, d, dir, perp, wish, pl) {
    if (!C2.has(this.ai)) return undefined;
    const r = { hover: false, qb: false, ab: false, done: false };
    const s = this.aiState;
    if (!s.c2) s.c2 = { ph: 0, t: 0 };
    switch (this.ai) {
      case 'fueler':
        this.fuelerAI_c2(dt, d, dir, perp, wish, pl, s.c2);
        this.stuckJump(dt, r);
        break;
      case 'missilerack':
        this.rackAI_c2(dt, d, wish, pl, s.c2);
        break;
      case 'netter':
        this.netterAI_c2(dt, d, dir, perp, wish, pl, s.c2);
        break;
      case 'boomer':
        this.boomerAI_c2(dt, d, dir, perp, wish, pl, s.c2);
        break;
      case 'mirror':
        this.mirrorAI_c2(dt, d, dir, perp, wish, pl, s.c2);
        break;
      case 'focus':
        this.focusAI_c2(dt, d, wish, pl, s.c2);
        break;
    }
    return r;
  },
  // mech-foe.js 的 foeFire 轉過來：true＝自己處理（不用一般武器）、false＝照常開火、undefined＝不是這一組的
  foeFire_c2() {
    if (!C2.has(this.ai)) return undefined;
    return this.ai !== 'fueler'; // 燃料洩漏車的車頂機槍照常開火
  },
  // 繞著目標的移動（無人機、衛星）：橫移＋保持距離
  orbit_c2(d, dir, perp, wish, k = 1) {
    wish
      .copy(perp)
      .addScaledVector(dir, clamp((d - this.aiState.want) / 8, -1, 1))
      .normalize()
      .multiplyScalar(k);
  },
  // ---------- 燃料洩漏車 ----------
  fuelerAI_c2(dt, d, dir, perp, wish, pl, c) {
    const g = this.game;
    const want = this.aiState.want;
    if (d > want + 4) wish.copy(dir);
    else
      wish
        .copy(perp)
        .multiplyScalar(0.85)
        .addScaledVector(dir, clamp((d - want) / 6, -0.6, 0.6));
    if (c.t === 0) c.t = rnd(3, 5);
    c.t -= dt;
    c.spray = Math.max(0, (c.spray || 0) - dt);
    const near = d < 18;
    this.bossVis = c.spray > 0 ? 2 : near && c.t < FUEL.warn ? 1 : 0;
    if (c.t > 0 || !near || !this.canAct()) {
      if (c.t <= 0) c.t = 0.5; // 太遠：等靠近再灑
      return;
    }
    c.t = rnd(...FUEL.cd);
    c.spray = 1;
    c.n = (c.n || 0) + 1;
    const lead = pl.vel.clone().setY(0).multiplyScalar(0.5);
    if (lead.length() > 4) lead.setLength(4);
    const at = pl.pos.clone().add(lead);
    at.y = g.world.groundAt(at.x, at.z, at.y + 1.5);
    const nz = this.pos.clone().setY(this.pos.y + 1.0);
    g.fx.streaks(nz, 16, 0x8a5a20, 11, 0.6, 12, at.clone().sub(nz).normalize(), 0.6);
    SFX.play('door', 0.6, 1.4, 0.05, 0.05, this.center());
    const dps = FUEL.dps * this.dmgMul;
    // 油漬（game/hazards2.js）：FUEL.ignite 秒後變成燃燒地面，被爆發攻擊打到提早點燃
    g.addZone('fuel', at, FUEL.R, FUEL.life, {
      ignite: FUEL.ignite,
      burn: FUEL.life - FUEL.ignite,
      dps,
      src: this,
      team: this.team,
    });
  },
  // ---------- 誘導飛彈架 ----------
  rackAI_c2(dt, d, wish, pl, c) {
    const g = this.game;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (!c.placed) this.rackPlace_c2(c);
    if (c.t === 0 && c.ph === 0) c.t = rnd(2.5, 4);
    c.t -= dt;
    if (c.ph === 0) {
      if (c.t <= 0 && d < 90 && this.canAct()) {
        c.ph = 1;
        c.t = RACK.warn;
        g.fx.warnLine(this.muzzle('rarm'), pl.center(), RACK.warn, 0xff7030, 0.09);
        SFX.play('ui2', 0.8, 0.7, 0.05, 0.05, this.center());
      }
    } else if (c.ph === 1) {
      if (c.t <= 0) {
        if (this.canAct()) this.rackLaunch_c2(pl);
        c.ph = 2;
        c.t = 3; // 重新裝填（筒口的彈頭不見）
      }
    } else if (c.t <= 0) {
      c.ph = 0;
      c.t = rnd(...RACK.cd) - 3;
    }
    this.bossVis = c.ph;
  },
  // 第一次：發射筒旁邊有可破壞物件（飛彈一出筒就會撞上）時，往旁邊挪到空曠的地方
  rackPlace_c2(c) {
    c.placed = true;
    const g = this.game,
      w = g.world;
    const clear = (x, z) => {
      if ((w.isVoid && w.isVoid(x, z)) || !w.inZone(x, z, 4)) return false;
      const y = w.groundAt(x, z, this.pos.y + 3);
      if (Math.abs(y - this.pos.y) > 1.5 || w.hitsWorld(new THREE.Vector3(x, y + 4, z))) return false;
      return !g
        .destructibles()
        .some((q) => q.center && Math.hypot(q.pos.x - x, q.pos.z - z) < (q.radius || 1) + 4.5);
    };
    if (clear(this.pos.x, this.pos.z)) return;
    for (let r = 4; r <= 16; r += 3)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const x = this.pos.x + Math.cos(a) * r,
          z = this.pos.z + Math.sin(a) * r;
        if (!clear(x, z)) continue;
        this.pos.set(x, w.groundAt(x, z, this.pos.y + 3), z);
        this.vel.set(0, 0, 0);
        return;
      }
  },
  rackLaunch_c2(pl) {
    const g = this.game;
    const mz = this.muzzle('rarm');
    // 先往上拋一點，之後追蹤（慢速、轉彎有上限：QB 橫移或繞到障礙物後面可以甩掉）
    const v = pl.center().sub(mz).normalize();
    v.y += 0.45;
    v.normalize().multiplyScalar(RACK.sp);
    const p = new Projectile(g, {
      pos: mz.clone(),
      vel: v,
      kind: 'missile',
      target: pl,
      turn: RACK.turn,
      attr: 'exp',
      dmg: RACK.dmg * this.dmgMul,
      impactV: RACK.im * this.dmgMul,
      team: this.team,
      owner: this,
      color: 0xff7030,
      life: RACK.life,
      splash: RACK.R,
      shootable: RACK.hp, // 可以擊落（共用的投射物處理）
      popDmg: 0,
      scale: 2.4, // 大型飛彈（客機也一樣大）
    });
    g.projectiles.push(p);
    this.aiState.c2.shot = p;
    this.aiState.c2.n = (this.aiState.c2.n || 0) + 1;
    g.fx.muzzle(mz, v.clone().normalize(), 0xff9040, 2.6);
    g.fx.smoke(mz.clone(), 1.6, 0x8a8f96, 1.2, 1.5);
    SFX.shot('missile', undefined, mz);
  },
  // ---------- 拋網無人機 ----------
  netterAI_c2(dt, d, dir, perp, wish, pl, c) {
    const g = this.game;
    this.flying = true;
    if (c.t === 0 && c.ph === 0) c.t = rnd(2, 4);
    c.t -= dt;
    if (c.ph === 0) {
      this.orbit_c2(d, dir, perp, wish);
      if (c.t <= 0 && d < 30 && this.canAct() && g.losClear(this.center(), pl.center())) {
        c.ph = 1;
        c.t = NET.warn;
        const lead = pl.vel.clone().multiplyScalar(0.25);
        if (lead.length() > 3) lead.setLength(3);
        c.aim = pl.center().add(lead);
        const mz = this.muzzle('rarm');
        const end = c.aim.clone().add(c.aim.clone().sub(mz).setLength(8));
        g.fx.warnLine(mz, end, NET.warn, NET_COL, 0.07);
        SFX.play('ui2', 0.6, 1.3, 0.05, 0.05, this.center());
      }
    } else if (c.ph === 1) {
      wish.set(0, 0, 0); // 預警中停在空中
      if (c.t <= 0) {
        if (this.canAct()) this.netShot_c2(c);
        c.ph = 2;
        c.t = 0.5;
      }
    } else {
      this.orbit_c2(d, dir, perp, wish, 0.4);
      if (c.t <= 0) {
        c.ph = 0;
        c.t = rnd(...NET.cd);
      }
    }
    // 網落下的時候：打中（或擦過）敵人就套上「網」
    const n = c.net;
    if (n && n.dead) {
      c.net = null;
      let hit = null;
      for (const t of g.hostilesOfEnt(this))
        if (!t.dead && !t.isProp && t.center().distanceTo(n.pos) < t.radius + NET.hitR) hit = t;
      if (hit) {
        hit.addStatus?.('net', NET.sec, { src: this.id });
        c.hits = (c.hits || 0) + 1;
        g.fx.ring(hit.center(), 2.4, NET_COL);
        g.fx.streaks(hit.center(), 12, NET_COL, 6, 0.4, 4);
      }
    }
    this.bossVis = c.ph === 1 ? 1 : c.ph === 2 ? 2 : 0;
  },
  netShot_c2(c) {
    const g = this.game;
    const mz = this.muzzle('rarm');
    const v = c.aim.clone().sub(mz).normalize().multiplyScalar(NET.sp);
    const p = new Projectile(g, {
      pos: mz.clone(),
      vel: v,
      kind: 'net',
      attr: 'kin',
      dmg: NET.dmg * this.dmgMul,
      impactV: NET.im * this.dmgMul,
      team: this.team,
      owner: this,
      color: NET_COL,
      life: NET.life,
      splash: 0,
      scale: 2.2, // 張開的網（客機也一樣大）
    });
    g.projectiles.push(p);
    c.net = p;
    c.n = (c.n || 0) + 1;
    g.fx.muzzle(mz, v.clone().normalize(), NET_COL, 1.6);
    SFX.shot('grenade', undefined, mz);
  },
  // ---------- 迴旋刃無人機 ----------
  boomerAI_c2(dt, d, dir, perp, wish, pl, c) {
    const g = this.game;
    this.flying = true;
    if (c.t === 0 && c.ph === 0) c.t = rnd(2, 3.5);
    c.t -= dt;
    if (c.ph === 0) {
      this.orbit_c2(d, dir, perp, wish);
      if (c.t <= 0 && d < 28 && this.canAct() && g.losClear(this.center(), pl.center())) {
        c.ph = 1;
        c.t = BLADE.warn;
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.5);
        if (lead.length() > 5) lead.setLength(5);
        const mz = this.muzzle('rarm');
        const aim = pl.center().add(lead);
        c.aimP = aim;
        c.to = aim.clone().add(aim.clone().sub(mz).setLength(BLADE.over));
        g.fx.warnLine(mz, c.to, BLADE.warn, BLADE_COL, 0.08);
        SFX.play('ui2', 0.7, 1.6, 0.05, 0.05, this.center());
      }
    } else if (c.ph === 1) {
      wish.set(0, 0, 0);
      if (c.t <= 0) {
        if (this.canAct()) {
          c.ph = 2;
          c.bp = this.muzzle('rarm');
          c.back = false;
          c.wp = c.aimP; // 回程先沿原路經過預判點，再飛回本體
          c.ft = 0;
          c.hitOut = new Set();
          c.hitBack = new Set();
          c.n = (c.n || 0) + 1;
          SFX.play('swing', 0.9, 0.8, 0.05, 0.05, c.bp);
        } else {
          c.ph = 0;
          c.t = 1;
        }
      }
    } else {
      // 刃在飛：本體慢慢橫移，等它回來
      this.orbit_c2(d, dir, perp, wish, 0.5);
      this.bladeTick_c2(dt, c);
    }
    this.bossVis = c.ph === 1 ? 1 : c.ph === 2 ? 2 : 0;
    this.bx = c.ph === 2 && c.bp ? c.bp.toArray().map((x) => +x.toFixed(2)) : null;
  },
  bladeTick_c2(dt, c) {
    const g = this.game;
    c.ft += dt;
    const goal = c.back ? c.wp || this.center() : c.to;
    const to = goal.clone().sub(c.bp);
    const L = to.length();
    const step = (c.back ? BLADE.back : BLADE.sp) * dt;
    const vdir = L > 1e-4 ? to.divideScalar(L) : new THREE.Vector3(0, 0, -1);
    if (L <= step) c.bp.copy(goal);
    else c.bp.addScaledVector(vdir, step);
    // 地形擋住時直接折返
    if (!c.back && g.world.hitsWorld(c.bp)) {
      c.back = true;
      c.wp = null;
      g.fx.spark(c.bp.clone(), 0xffffff, vdir.clone().negate());
    }
    const hitSet = c.back ? c.hitBack : c.hitOut;
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead || t.isProp || hitSet.has(t)) continue;
      if (t.center().distanceTo(c.bp) > t.radius + BLADE.hitR) continue;
      hitSet.add(t);
      c.hits = (c.hits || 0) + 1;
      t.takeDamage(
        BLADE.dmg * this.dmgMul,
        BLADE.im * this.dmgMul,
        this,
        c.bp.clone(),
        vdir.clone(),
        undefined,
        undefined,
        'kin',
      );
      g.fx.meleeHit(c.bp.clone(), BLADE_COL, false, vdir.clone());
    }
    if (!c.back && L <= step + 0.5) c.back = true;
    else if (c.back && c.wp && L <= step + 0.5) c.wp = null;
    else if (c.back && !c.wp && c.bp.distanceTo(this.center()) < 1.2) {
      c.ph = 0;
      c.t = rnd(...BLADE.cd);
    }
    if (c.ft > BLADE.maxT) {
      c.ph = 0;
      c.t = rnd(...BLADE.cd);
    }
  },
  // ---------- 反射鏡衛星 ----------
  mirrorAI_c2(dt, d, dir, perp, wish, pl, c) {
    const g = this.game;
    this.flying = true;
    if (c.t === 0 && c.ph === 0) c.t = rnd(2, 3.5);
    c.t -= dt;
    if (c.ph === 0) {
      wish.copy(perp).multiplyScalar(0.6);
      if (d < this.aiState.want - 6) wish.addScaledVector(dir, -0.6);
      else if (d > this.aiState.want + 10) wish.addScaledVector(dir, 0.7);
      if (c.t <= 0 && d < 55 && this.canAct() && g.losClear(this.center(), pl.center())) {
        c.ph = 1;
        c.t = MIRROR.warn;
        c.aim = pl.center();
        g.fx.warnLine(this.muzzle('rarm'), c.aim, MIRROR.warn, 0xfff080, 0.07);
        SFX.play('charge', 0.6, 1.4, 0.05, 0.05, this.center());
      }
    } else if (c.ph === 1) {
      wish.set(0, 0, 0);
      // 蓄力的前 0.8 秒瞄準點慢慢跟上目標，之後鎖住
      if (c.t > 0.2) c.aim.lerp(pl.center(), Math.min(1, dt * 2.5));
      if (c.t <= 0) {
        if (this.canAct()) {
          const mz = this.muzzle('rarm');
          g.beamAttack(this, mz, c.aim.clone().sub(mz).normalize(), {
            range: MIRROR.range,
            dmg: MIRROR.dmg * this.dmgMul,
            im: MIRROR.im * this.dmgMul,
            w: 0.7,
            color: 0xfff0a0,
            width: 0.14,
            pierce: false,
          });
          c.n = (c.n || 0) + 1;
        }
        c.ph = 2;
        c.t = 0.4;
      }
    } else if (c.t <= 0) {
      c.ph = 0;
      c.t = rnd(...MIRROR.cd);
    }
    this.bossVis = c.ph;
  },
  // ---------- 聚光鏡陣列 ----------
  focusAI_c2(dt, d, wish, pl, c) {
    const g = this.game;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (c.t === 0 && c.ph === 0) c.t = rnd(3, 5);
    c.t -= dt;
    const mz = this.muzzle('rarm');
    if (c.ph === 0) {
      this.bx = null;
      if (c.t <= 0 && d < 70 && this.canAct() && g.losClear(mz, pl.center())) {
        c.ph = 1;
        c.t = FOCUS.warn;
        c.tgt = pl;
        g.fx.warnLine(mz, pl.center(), FOCUS.warn, 0xfff080, 0.09);
        SFX.play('charge', 0.8, 0.8, 0.05, 0.05, this.center());
      }
    } else if (c.ph === 1) {
      if (c.t <= 0) {
        c.ph = 2;
        c.bt = 0;
        c.tick = 0;
        c.n = (c.n || 0) + 1;
        const t = c.tgt;
        // 追蹤光束（game/hazards2.js）：從槍口（每格 moveZone）追著目標，照越久越痛；傷害的來源是自己
        c.zone = g.addZone('beam', mz, 0.9, FOCUS.life, {
          from: mz,
          src: this,
          target: t,
          dps0: FOCUS.dps0 * this.dmgMul,
          dps1: FOCUS.dps1 * this.dmgMul,
          ramp: FOCUS.ramp,
          team: this.team,
        });
        SFX.play('laserBig', 0.7, 0.9, 0.05, 0.05, mz);
      }
    } else if (c.ph === 2) {
      const t = c.tgt;
      c.bt += dt;
      const k = Math.min(1, c.bt / FOCUS.ramp);
      const tc = t && !t.dead ? t.center() : null;
      // 掩體斷開：視線被擋住、目標倒下或跑出射程
      if (!tc || !this.canAct() || mz.distanceTo(tc) > FOCUS.range || !g.losClear(mz, tc)) {
        this.focusStop_c2(c, FOCUS.brk);
        c.broke = (c.broke || 0) + 1;
        if (tc) g.fx.spark(tc, 0xfff080);
      } else {
        g.moveZone(c.zone, mz); // 光束的起點跟著槍口（傷害與追蹤在 game/hazards2.js）
        this.bx = tc.toArray().map((x) => +x.toFixed(2));
        if (c.bt >= FOCUS.life) this.focusStop_c2(c, rnd(...FOCUS.cd));
      }
      this.bossVis = c.ph === 2 ? 2 + Math.round(k * 8) : 0;
      return;
    } else if (c.t <= 0) {
      c.ph = 0;
      c.t = 0.1;
    }
    this.bossVis = c.ph === 1 ? 1 : 0;
  },
  focusStop_c2(c, cd) {
    if (c.zone !== null && c.zone !== undefined) this.game.removeZone?.(c.zone);
    c.zone = null;
    c.ph = 3;
    c.t = cd;
    this.bx = null;
  },

  // ---------- 顯示（房主與客機每格；死亡時也會呼叫一次）----------
  foeFx_c2(dt = 0) {
    if (!C2.has(this.ai)) return;
    const m = this.model,
      g = this.game,
      v = this.bossVis || 0;
    if (this.dead) {
      this.bladeHide_c2();
      // 燃料洩漏車：擊破時原地大範圍燃燒（只在房主；離場不算）
      if (this.ai === 'fueler' && !this.remote && !this.gone && !this.c2Burst) {
        this.c2Burst = true;
        g.addPool(this, this.pos.clone(), FUEL.burstR, FUEL.burstLife, FUEL.burstDps * this.dmgMul);
        g.msgAll('燃料引燃 — 離開火場', 0xffa030);
      }
      if (this.ai === 'focus' && !this.remote && this.aiState.c2) this.focusStop_c2(this.aiState.c2, 99);
      return;
    }
    const t = this.t || 0;
    const warn = v === 1,
      atk = v >= 2;
    switch (this.ai) {
      case 'fueler':
        if (m.beacon) m.beacon.rotation.y += dt * 6;
        if (m.boom) m.boom.rotation.x = lerp(m.boom.rotation.x, warn || atk ? 0.55 : 0, Math.min(1, dt * 6));
        if (m.noz) m.noz.emissiveIntensity = atk ? 3 : warn ? 1.2 + Math.abs(Math.sin(t * 14)) * 1.6 : 0.15;
        if (m.drip) m.drip.visible = Math.sin(t * 2.3) > 0.2;
        if (atk && Math.random() < dt * 25) g.fx.dust(this.pos.clone(), 1.2, 2, 0x5a3a18);
        break;
      case 'missilerack': {
        if (m.radar) m.radar.rotation.y += dt * 1.6;
        const el = warn ? 0.7 : 0.28;
        if (m.rack) {
          m.rack.rotation.x = lerp(m.rack.rotation.x, el, Math.min(1, dt * 3));
          // 發射的後座：裝填中一開始往後推
          m.rack.position.z = lerp(m.rack.position.z, 0.2 + (v === 2 ? 0.25 : 0), Math.min(1, dt * 8));
        }
        if (m.ring) m.ring.emissiveIntensity = warn ? 1 + Math.abs(Math.sin(t * 12)) * 2.5 : 0.2;
        if (m.tips) for (const q of m.tips) q.visible = v !== 2;
        break;
      }
      case 'netter':
        if (m.rotors) for (const q of m.rotors) q.rotation.y += dt * 40;
        if (m.petals)
          for (const q of m.petals) q.rotation.x = lerp(q.rotation.x, warn ? -0.9 : 0, Math.min(1, dt * 10));
        if (m.ring) m.ring.emissiveIntensity = warn ? 1.5 + Math.abs(Math.sin(t * 16)) * 2 : atk ? 2.5 : 0.3;
        if (m.launcher)
          m.launcher.position.z = lerp(m.launcher.position.z, atk ? 0.1 : -0.15, Math.min(1, dt * 10));
        break;
      case 'boomer': {
        if (m.rotors) for (const q of m.rotors) q.rotation.y += dt * 40;
        if (m.blade) {
          m.blade.visible = !atk;
          m.blade.rotation.y += dt * (warn ? 22 : 1.5);
        }
        if (m.bladeGlow) m.bladeGlow.emissiveIntensity = warn ? 3 : 1.4;
        if (atk && this.bx) this.bladeShow_c2(dt);
        else this.bladeHide_c2();
        break;
      }
      case 'mirror': {
        if (m.ringG) m.ringG.rotation.z += dt * (warn ? 2.5 : 0.3);
        const tilt = warn ? 0.55 : atk ? 0.3 : 0.12;
        if (m.petals) for (const q of m.petals) q.rotation.x = lerp(q.rotation.x, -tilt, Math.min(1, dt * 6));
        if (m.core) m.core.emissiveIntensity = warn ? 1.5 + Math.abs(Math.sin(t * 15)) * 2.5 : atk ? 4 : 0.6;
        if (m.mirror) m.mirror.emissiveIntensity = 0.3 + 0.25 * Math.max(0, Math.sin(t * 1.7));
        break;
      }
      case 'focus': {
        const k = atk ? (v - 2) / 8 : 0;
        if (m.gimbal) {
          let pitch = 0.5;
          if (this.bx) {
            const gp = new THREE.Vector3();
            m.gimbal.getWorldPosition(gp);
            pitch = Math.atan2(this.bx[1] - gp.y, Math.hypot(this.bx[0] - gp.x, this.bx[2] - gp.z));
          } else if (warn) pitch = 0.15;
          m.gimbal.rotation.x = lerp(m.gimbal.rotation.x, clamp(pitch, -0.5, 1.2), Math.min(1, dt * 4));
        }
        if (m.lens) {
          _c.copy(BEAM_Y).lerp(BEAM_R, k);
          m.lens.color.copy(_c);
          m.lens.emissive.copy(_c);
          m.lens.emissiveIntensity = atk ? 2 + 3 * k : warn ? 1 + Math.abs(Math.sin(t * 12)) * 2 : 0.5;
        }
        if (m.petals)
          for (let i = 0; i < m.petals.length; i++)
            m.petals[i].rotation.y = Math.sin(t * 0.8 + i) * (atk || warn ? 0.01 : 0.06);
        if (m.mirror)
          m.mirror.emissiveIntensity = 0.3 + (atk ? 0.6 * k : 0.15 * Math.max(0, Math.sin(t * 1.3)));
        break;
      }
    }
  },
  // 飛出去的迴旋刃（場景裡的網格；房主照 bx 的位置、客機往快照的位置追）＋殘影
  bladeShow_c2(dt) {
    const g = this.game;
    if (!this.c2Blade) {
      this.c2Blade = buildBoomerBlade();
      this.c2Blade.scale.setScalar(1.2);
      g.scene.add(this.c2Blade);
      this.c2Blade.position.fromArray(this.bx);
      this.c2Ghost = 0;
    }
    const b = this.c2Blade;
    const p = new THREE.Vector3().fromArray(this.bx);
    if (this.remote) b.position.lerp(p, Math.min(1, dt * 18));
    else b.position.copy(p);
    b.rotation.y += dt * 28;
    b.visible = true;
    this.c2Ghost -= dt;
    if (this.c2Ghost <= 0 && g.fx && g.fx.add) {
      this.c2Ghost = 0.035;
      const gm = new THREE.Mesh(GHOST_GEO(), g.fx.addM(BLADE_COL, 0.45));
      gm.position.copy(b.position);
      gm.rotation.set(-Math.PI / 2, 0, 0);
      g.fx.add(gm, 0.25, (e, k) => {
        e.mesh.material.opacity = 0.45 * (1 - k);
        e.mesh.scale.setScalar(1 + k * 0.4);
      });
    }
  },
  bladeHide_c2() {
    if (!this.c2Blade) return;
    this.game.scene.remove(this.c2Blade);
    this.c2Blade = null;
  },
});

// 殘影用的扁平圓環
let _ghost = null;
function GHOST_GEO() {
  return _ghost || (_ghost = new THREE.RingGeometry(0.7, 1.25, 16));
}
