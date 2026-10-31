// ---------- MechEntity 擴充：一般敵人的預警招式（拿到攻擊權杖＝主攻時才放；data/ai.js 的 MOVES）----------
// 每個招式分三段：準備（預警：槍口閃光、瞄準線、落點圈、路線）→ 出手 → 收招（不開火，部分招式有破綻＝受傷 ×1.25）。
// 準備中被打出失衡就中斷。預警都用會轉送給客機的 fx（warnLine、warnRect、flash、spark；落點圈另送 warn 事件），
// 所以多人不用改協定。只在房主／單機執行。
import { SFX } from '../audio/audio.js';
import { usesAmmo } from '../data/parts.js';
import { clamp, rnd } from '../core/math.js';
import { MOVES } from '../data/ai.js';
import { CUE_POST } from '../data/melee.js';
import { DS, MS } from '../core/scale.js';
import { MechEntity } from './mech-entity.js';

const SLOTS = ['rarm', 'larm', 'rback', 'lback'];
// 每個招式用的武器類型
const NEED = {
  burst: ['bullet'],
  aimShot: ['shell'],
  volley: ['missile'],
  charge: ['laser'],
  sweep: ['bullet'],
  dash: ['shotgun', 'bullet'],
  lob: ['grenade'],
  beep: null,
  strafeRun: ['bullet'],
};

Object.assign(MechEntity.prototype, {
  movesOf() {
    return MOVES[this.etype] || null;
  },
  // 第一個可用（類型符合、還有彈藥）的武器槽
  moveSlot(types) {
    for (const s of SLOTS) {
      const w = this.weapons[s];
      if (!w || w.dropped || !types.includes(w.def.type)) continue;
      if (usesAmmo(w.def) && w.ammo <= 0 && w.mag <= 0) continue;
      return s;
    }
    return null;
  },
  // 每格（updateAI 決定移動之後）：回傳 { skip：略過一般開火, ab, k：移動倍率 }；沒有招式時回傳 null
  movesTick(dt, d, dir, pl, wish) {
    const sn = this.sn,
      g = this.game;
    const list = this.movesOf();
    if (!list || !sn) return null;
    const r = { skip: false, ab: false };
    // 失衡、失去權杖（收招以外）時中斷
    if (sn.mv && (this.staggerT > 0 || (!sn.tok && sn.mv.ph !== 'rec'))) {
      if (sn.mv.ph === 'wind') this.cueCancel();
      sn.mv = null;
      sn.mvCd = rnd(1.2, 2);
    }
    if (!sn.mv) {
      sn.mvCd -= dt;
      if (!sn.tok || sn.mvCd > 0 || !sn.los || !this.canAct() || this.staggerT > 0) return null;
      // 依序挑下一個能放的招式
      for (let i = 0; i < list.length; i++) {
        const k = list[(sn.mvI + i) % list.length];
        const slot = NEED[k] ? this.moveSlot(NEED[k]) : 'none';
        if (!slot) continue;
        if (k === 'beep' && d > 18 * DS) continue;
        if (k === 'dash' && d < 8 * DS) continue;
        const w = slot !== 'none' && this.weapons[slot];
        if (w && (k === 'aimShot' || k === 'charge' || k === 'lob' || k === 'volley') && d > w.def.range)
          continue;
        sn.mvI = (sn.mvI + i + 1) % list.length;
        sn.mv = { k, slot, ph: 'wind', t: 0, fxT: 0 };
        this.moveStart(sn.mv, pl);
        // 出招前的提示（data/melee.js 的 CUE_POST）：打到前 cueLead 秒出「!」，之後按 QB＝完美迴避
        const cp = CUE_POST[k];
        if (cp)
          this.atkCue(pl, k === 'charge' && this.ai === 'strider' ? 1.1 : cp[0], cp[1], {
            travel: this.cueTravel(k, slot, pl),
          });
        break;
      }
      if (!sn.mv) return null;
    }
    const mv = sn.mv;
    mv.t += dt;
    mv.fxT -= dt;
    r.skip = true;
    const f = this['mv_' + mv.k];
    f.call(this, mv, dt, d, dir, pl, wish, r);
    if (mv.ph === 'end') {
      sn.mv = null;
      sn.mvCd = mv.cd !== undefined ? mv.cd : rnd(1.2, 2.2);
    }
    return r;
  },
  // 出手到打到目標的估計秒數（「!」對著打到的時間）：子彈＝距離／彈速、雷射 0、衝刺與自爆＝衝過去的時間、
  // 直升機掃射＝飛到目標前方的時間
  cueTravel(k, slot, pl) {
    const d = this.pos.distanceTo(pl.pos);
    const ab = Math.max(1, this.stats.speed * (this.speedMul || 1) * 2.2);
    if (k === 'dash') return Math.max(0, d - 10 * DS) / ab + 0.15;
    if (k === 'beep') return Math.max(0, d - 4 * this.dk) / ab + 0.15;
    if (k === 'strafeRun') return Math.max(0, d - 12 * DS) / ab + 0.15;
    const w = slot !== 'none' && this.weapons[slot];
    if (!w || w.def.type === 'laser' || !w.def.speed) return 0;
    return Math.min(d, w.def.range || d) / w.def.speed;
  },
  moveStart(mv, pl) {
    const g = this.game;
    if (mv.k === 'lob') {
      // 落點：目標腳下＋一點預判（最多 18 m）
      const lead = pl.vel.clone().setY(0).multiplyScalar(0.6);
      if (lead.length() > 6 * DS) lead.setLength(6 * DS);
      mv.p = pl.pos.clone().add(lead);
      mv.p.y = g.world.groundAt(mv.p.x, mv.p.z, mv.p.y + 2 * MS);
      g.fx.warnCircle(mv.p, 5 * MS, 1.9, 0xff7020);
      g.netEv({ t: 'warn', p: mv.p.toArray().map((x) => +x.toFixed(2)), R: 5 * MS, dl: 1.9, c: 0xff7020 });
    } else if (mv.k === 'strafeRun') {
      const a = this.pos.clone().setY(0),
        b = pl.pos.clone().setY(0);
      const dir = b.clone().sub(a);
      if (dir.lengthSq() < 1) dir.set(0, 0, 1);
      dir.normalize();
      mv.dir = dir;
      mv.end = b.clone().addScaledVector(dir, 22 * DS);
      const L = a.distanceTo(mv.end);
      const c = a.clone().lerp(mv.end, 0.5);
      c.y = g.world.terrainHeight(c.x, c.z);
      g.fx.warnRect(c, Math.atan2(-dir.x, -dir.z), 5 * MS, L, 1.1, 0xff4020);
    } else if (mv.k === 'charge') SFX.play('charge', 0.5, 1.2, 0, 0, this.center());
    else if (mv.k === 'sweep') mv.side = Math.random() < 0.5 ? 1 : -1;
    else if (mv.k === 'dash') {
      const a = this.pos.clone(),
        b = pl.pos.clone();
      a.y += 0.4 * MS;
      b.y += 0.4 * MS;
      g.fx.warnLine(a, b, 0.55, 0xff6020, 0.14);
    }
  },
  // 槍口的閃光（準備中）
  mvGlow(mv, slot, color, every = 0.15, r = 0.45) {
    if (mv.fxT > 0) return;
    mv.fxT = every;
    this.game.fx.flash(this.muzzle(slot), (r * (this.scale || 1)) / this.game.fx.k, color, 0.1);
  },
  // 瞄準線（準備中，跟著目標）
  mvLine(mv, slot, to, color, every = 0.2, w = 0.04) {
    if (mv.fxT > 0) return;
    mv.fxT = every;
    this.game.fx.warnLine(this.muzzle(slot), to, every + 0.04, color, w);
  },
  // 點放：槍口閃光 → 短連射 → 停頓
  mv_burst(mv, dt, d, dir, pl, wish, r) {
    wish.multiplyScalar(0.4);
    if (mv.ph === 'wind') {
      this.mvGlow(mv, mv.slot, 0xffd060);
      if (mv.t > 0.45) Object.assign(mv, { ph: 'act', t: 0 });
    } else if (mv.ph === 'act') {
      this.fire(mv.slot, pl.center(), pl);
      if (mv.t > 0.75) Object.assign(mv, { ph: 'rec', t: 0 });
    } else if (mv.t > 1.0) mv.ph = 'end';
  },
  // 架砲：紅色瞄準線 → 單發高衝擊
  mv_aimShot(mv, dt, d, dir, pl, wish, r) {
    wish.multiplyScalar(0.3);
    if (mv.ph === 'wind') {
      this.mvLine(mv, mv.slot, pl.center(), 0xff3020);
      if (mv.t > 0.7) {
        this.fire(mv.slot, pl.center(), pl);
        Object.assign(mv, { ph: 'rec', t: 0 });
      }
    } else if (mv.t > 0.8) mv.ph = 'end';
  },
  // 導彈齊射：橘色鎖定線 → 齊射
  mv_volley(mv, dt, d, dir, pl, wish, r) {
    if (mv.ph === 'wind') {
      this.mvLine(mv, mv.slot, pl.center(), 0xffa020, 0.3, 0.03);
      if (mv.t > 0.9) {
        this.lkT0 = this.t - 10; // 準備期間就是鎖定時間：一次射滿
        this.fire(mv.slot, pl.center(), pl);
        Object.assign(mv, { ph: 'rec', t: 0 });
      }
    } else if (mv.t > 1.0) mv.ph = 'end';
  },
  // 雷射蓄力：細瞄準線跟著目標，發射前 0.2 秒鎖住位置
  mv_charge(mv, dt, d, dir, pl, wish, r) {
    const T = this.ai === 'strider' ? 1.1 : 0.8;
    if (mv.ph === 'wind') {
      wish.multiplyScalar(0.3);
      if (mv.t < T - 0.2) mv.lock = pl.center();
      this.mvLine(mv, mv.slot, mv.lock, mv.t < T - 0.2 ? 0xff2040 : 0xffffff, 0.12, 0.03);
      mv.gT = (mv.gT || 0) - dt;
      if (mv.gT <= 0) {
        mv.gT = 0.2;
        this.game.fx.flash(this.muzzle(mv.slot), (0.5 * (this.scale || 1)) / this.game.fx.k, 0xff4060, 0.12);
        // 蓄力：粒子往槍口吸進去（fx.gather，docs/vfx-design.md）
        this.game.fx.gather(
          this.muzzle(mv.slot),
          (2.2 * (this.scale || 1)) / this.game.fx.k,
          0xff4060,
          0.2,
          7,
        );
      }
      if (mv.t > T) {
        const w = this.weapons[mv.slot];
        w.cd = 0;
        this.fire(mv.slot, mv.lock, null);
        Object.assign(mv, { ph: 'rec', t: 0 });
      }
    } else if (mv.t > 0.9) mv.ph = 'end';
  },
  // 掃射：停下架好（兩條預警線標出範圍）→ 由一側掃到另一側 → 過熱（破綻）
  mv_sweep(mv, dt, d, dir, pl, wish, r) {
    wish.set(0, 0, 0);
    const A = 0.45;
    const aimAt = (a) => {
      const c = this.center();
      const v = pl.center().sub(c);
      v.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
      return c.add(v);
    };
    if (mv.ph === 'wind') {
      if (mv.fxT <= 0) {
        mv.fxT = 0.3;
        const m = this.muzzle(mv.slot);
        this.game.fx.warnLine(m, aimAt(-A * mv.side), 0.34, 0xff3020, 0.04);
        this.game.fx.warnLine(m, aimAt(A * mv.side), 0.34, 0xff3020, 0.04);
      }
      if (mv.t > 0.8) Object.assign(mv, { ph: 'act', t: 0 });
    } else if (mv.ph === 'act') {
      const k = clamp(mv.t / 1.8, 0, 1);
      const p = aimAt((-A + 2 * A * k) * mv.side);
      this.setAim(p);
      this.fire(mv.slot, p, null);
      if (mv.t > 1.8) {
        Object.assign(mv, { ph: 'rec', t: 0 });
        this.sn.vuln = 2;
      }
    } else {
      if (mv.fxT <= 0) {
        mv.fxT = 0.35;
        this.game.fx.spark(this.muzzle(mv.slot), 0xffa040);
      }
      if (mv.t > 2.0) mv.ph = 'end';
    }
  },
  // 衝刺：路線預警 → 突擊推進衝過去，近身時霰彈
  mv_dash(mv, dt, d, dir, pl, wish, r) {
    if (mv.ph === 'wind') {
      wish.set(0, 0, 0);
      if (mv.t > 0.55) Object.assign(mv, { ph: 'act', t: 0 });
    } else if (mv.ph === 'act') {
      wish.copy(dir);
      r.ab = true;
      if (d < 10 * DS) {
        this.fire(mv.slot, pl.center(), pl);
        if (mv.t > 0.25) Object.assign(mv, { ph: 'rec', t: 0 });
      }
      if (mv.t > 1.2) Object.assign(mv, { ph: 'rec', t: 0 });
    } else {
      if (d < 10 * DS) this.fire(mv.slot, pl.center(), pl);
      if (mv.t > 1.0) mv.ph = 'end';
    }
  },
  // 榴彈：落點圈 → 拋射（飛行時間落在圈填滿的時候）
  mv_lob(mv, dt, d, dir, pl, wish, r) {
    wish.set(0, 0, 0);
    if (mv.ph === 'wind') {
      this.setAim(mv.p);
      if (mv.t > 0.55) {
        this.weapons[mv.slot].cd = 0;
        this.fire(mv.slot, mv.p, null);
        Object.assign(mv, { ph: 'rec', t: 0 });
      }
    } else if (mv.t > 1.4) mv.ph = 'end';
  },
  // 自爆：閃紅燈、嗶嗶聲（停一下）→ 加速衝過去
  mv_beep(mv, dt, d, dir, pl, wish, r) {
    if (mv.ph === 'wind') {
      wish.multiplyScalar(0.25);
      if (mv.fxT <= 0) {
        mv.fxT = 0.18;
        this.game.fx.flash(this.center(), (1.1 * (this.scale || 1)) / this.game.fx.k, 0xff2020, 0.1);
        SFX.play('bell', 0.35, 1.9, 0, 0, this.center());
      }
      if (mv.t > 0.75) Object.assign(mv, { ph: 'act', t: 0 });
    } else {
      wish.copy(dir);
      r.ab = true;
      if (mv.t > 3) mv.ph = 'end';
    }
  },
  // 直升機掃射：地面的長方形航線預警 → 沿航線飛過去掃射
  mv_strafeRun(mv, dt, d, dir, pl, wish, r) {
    if (mv.ph === 'wind') {
      wish.multiplyScalar(0.2);
      if (mv.t > 1.1) Object.assign(mv, { ph: 'act', t: 0 });
    } else if (mv.ph === 'act') {
      wish.copy(mv.dir);
      r.ab = true;
      const ahead = this.center().addScaledVector(mv.dir, 12 * DS);
      ahead.y = this.game.world.terrainHeight(ahead.x, ahead.z) + 0.8 * MS;
      this.fire(mv.slot, ahead, null);
      const rem = mv.end.clone().sub(this.pos).setY(0);
      if (rem.dot(mv.dir) < 0 || mv.t > 2.4) Object.assign(mv, { ph: 'rec', t: 0 });
    } else if (mv.t > 1.0) mv.ph = 'end';
  },
});
