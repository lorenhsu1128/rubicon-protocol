// Coral 戰爭（RTS）的野怪行為（MechEntity 擴充；docs/rts-design.md 13.6、13.15；D 包）。
// e.creep＝營地 id、e.rtsCamp＝營地紀錄（game/rts-neutral.js 的 R.camps）、e.rtsHome＝自己在營地裡的位置。
// 營地的狀態（camp.st：'idle' 待機、'fight' 出動、'return' 回營、'done' 清除）由 Game.rtsNeutralTick 決定，這裡照著做：
//   待機：站在自己的位置，偶爾轉頭；出動：打營地的目標（或打自己的攻擊者），追擊不超過營地中心 RTS_CREEP.leash；
//   回營：走回自己的位置、不理會攻擊（照樣受傷），RTS_CREEP.healT 秒回滿。不會重生。
// mech-rts.js（B）的 rtsUnitAI 開頭轉過來（if (this.creep) return this.rtsCreepAI(dt)）；生成時另外在實體上掛一份，
// 所以兩邊的順序不影響。移動與開火沿用 mech-rts.js 的 rtsGo／rtsFight／rtsScan。
// R6 D 包（docs 17.2 #10）：6 種野怪的特殊行為（只在營地的野怪；傭兵是另一組定義、不帶），沿用既有機制、
// 數值在 lv 公式之內（不額外加強）。參數表 CREEP_CX（定義的 cx 可以覆寫）；g.rtsCreepFxOff＝全部關掉（測試比較用）。
// 預警與特效只給看得到的（玩家隊伍的迷霧，rtsCreepSeen）：
//   lurk 雪中潛伏 MT：營地待機時埋在雪裡（e.rtsSub：迷霧的潛航規則＝敵方 6 m 內才看得到、不能被鎖定；bossVis 1 蹲下），
//        敵方 16 m 內、被打中或營地出動時現身；回營、回到位置後重新埋下
//   smoke 煙幕投射車：營地出動時在營地中心放 10 m 煙幕 8 秒（每次出動一次；外觀是 C 包的 rtsHeroZone 的 smoke）：
//        煙裡的野怪不能被鎖定，但正在打中敵人的（1.5 秒內）現形（同隱形的「開火現形」；不讓營地變難）
//   acid 汙染噴射 MT：交戰中每 10 秒，預警 1 秒（bossVis 1）後在目標腳下 6 m 腐蝕區 6 秒（每秒 15、護甲 −2；rtsHeroZone）
//   flame 推進器試車台：取代一般開火：預警 1.5 秒（bossVis 1、地面的長方形）→ 噴火 2.5 秒（bossVis 2、前方錐形、
//        方向固定在預警時）→ 休息 1 秒；噴火的每秒傷害＝定義的 dps × 循環 ÷ 噴火時間（平均和一般開火相同）
//   gravity 重力錨：交戰中每 12 秒，預警 1 秒後在目標處 8 m 重力場 5 秒（'nojump'：長程推進、空降 MT 的跳躍停用）
//   alarm 保全雷射網：被打或敵方進入 14 m 時「警報」：同營地立刻出動（不等出動半徑）
//   cart 炸藥礦車（R6 之後的 D 包，docs 18.4）：取代一般的近戰：營地出動時全速衝向目標（攻擊者＞最近的敵方地面單位；
//        建築也可以，但 rtsScan 單位優先；空中的追不到、換最近的地面單位），外緣 arm m 內停下點火：閃紅燈＋嗶聲、
//        地面預警圈（只畫玩家看得到的）fuse 秒 → rtsSplash 爆發（中心 dmg、半徑 r），自己死亡（擊破算給攻擊者／目標：
//        經驗與掉寶照一般野怪）；點火後硬直、營地回營都不中斷。被打死（還沒爆）時小爆炸 dDmg／dR。
import { MechEntity } from './mech-entity.js';
import { SFX } from '../audio/audio.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { RTS_CREEP } from '../data/rts-neutral.js';

const ZERO = new THREE.Vector3();
const _aim = new THREE.Vector3();
const ME = 0;
const ALARM_RING = 14; // 警報的紅圈（m）
const CREEP_CX = {
  cr_lurker: { kind: 'lurk', r: 16 },
  cr_smoker: { kind: 'smoke', r: 10, t: 8 },
  cr_sprayer: { kind: 'acid', every: 10, first: 3, warn: 1, r: 6, t: 6, dps: 15, armor: -2 },
  cr_testrig: { kind: 'flame', warn: 1.5, fire: 2.5, rest: 1, len: 14, w: 3.5 },
  cr_anchor: { kind: 'gravity', every: 12, first: 4, warn: 1, r: 8, t: 5 },
  cr_laserpost: { kind: 'alarm', r: 14 },
  // 數值（lv 2 的野怪：一般開火 16 dps、血量 750）：自爆 200 爆發／4.5 m（中心 100% → 邊緣 40%）≈ 一般開火 12 秒的輸出（自爆後就沒了）；
  // 中心（護甲前）：英雄（hero 甲 ×0.5）−100、工人（none ×1.25）−250、MT（med ×0.75）−150、建築（fort ×1.5）−300
  cr_cart: { kind: 'cart', arm: 2.2, fuse: 1.2, r: 4.5, dmg: 200, imp: 260, dR: 3, dDmg: 60, dImp: 120 },
};

Object.assign(MechEntity.prototype, {
  rtsCreepAI(dt) {
    const g = this.game,
      R = g.rts;
    if (this.dead || !R) return true;
    // 炸藥礦車點火中：硬直、回營都不中斷
    if (this.rtc && this.rtc.ph === 1 && this.rtc.cart && !R.over) return this.rtsCreepCartFuse(dt);
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    const camp = this.rtsCamp;
    rt.wish.set(0, 0, 0);
    rt.face = null;
    rt.fireT -= dt;
    rt.scanT -= dt;
    if (this.staggerT > 0 || R.over || !camp) {
      this.move(dt, ZERO, false, false, false, null);
      return true;
    }
    const home = this.rtsHome || camp.pos;
    const cx = g.rtsCreepFxOff ? null : this.rtsCreepCx(D);
    if (cx) this.rtsCreepPre(dt, cx, camp, home);
    if (R.creepGrav && R.creepGrav.length) this.rtsCreepGravTick(dt);
    if (R.creepSmoke && (R.creepSmoke.length || this.rtcSmoke)) this.rtsCreepSmokeTick();
    const st = camp.st;
    if (st === 'fight') this.rtsCreepFight(dt, D, camp, home, cx);
    else if (st === 'return') {
      rt.engage = null;
      this.rtsGo(home.x, home.z, 1, dt, null);
    } else {
      // 待機：回到自己的位置；站著時偶爾轉頭
      rt.engage = null;
      if (Math.hypot(this.pos.x - home.x, this.pos.z - home.z) > RTS_CREEP.home)
        this.rtsGo(home.x, home.z, 1, dt, null);
      else {
        rt.lookT = (rt.lookT || 0) - dt;
        if (rt.lookT <= 0) {
          rt.lookT = 3 + Math.random() * 5;
          rt.lookA = (home.a || 0) + (Math.random() - 0.5) * 2.4;
        }
        if (rt.lookA !== undefined) {
          _aim.set(
            this.pos.x + Math.cos(rt.lookA) * 10,
            this.pos.y + this.model.height * 0.5,
            this.pos.z + Math.sin(rt.lookA) * 10,
          );
          rt.face = rt.faceV.copy(_aim);
        }
      }
    }
    if (rt.face) this.setAim(rt.face);
    else if (rt.wish.lengthSq() > 0.01) {
      _aim.set(
        this.pos.x + rt.wish.x * 10,
        this.pos.y + this.model.height * 0.5,
        this.pos.z + rt.wish.z * 10,
      );
      this.setAim(_aim);
    }
    this.move(dt, rt.wish, false, false, false, null);
    return true;
  },
  // 出動：目標＝自己的攻擊者（最近 4 秒）＞視野內最近的敵人＞營地共用的目標；目標跑出追擊範圍就放掉
  rtsCreepFight(dt, D, camp, home, cx) {
    const rt = this.rt,
      R = this.game.rts;
    const inLeash = (t) =>
      Math.hypot(t.pos.x - camp.pos.x, t.pos.z - camp.pos.z) < RTS_CREEP.leash + this.rtsRange(D) * 0.6;
    if (rt.engage && (!this.rtsHostileOk(rt.engage) || rt.engage.rtsInv || !inLeash(rt.engage)))
      rt.engage = null;
    if (rt.scanT <= 0) {
      rt.scanT = 0.35;
      let t = null;
      if (rt.hurtBy && R.t - rt.hurtT < 4 && this.rtsHostileOk(rt.hurtBy) && inLeash(rt.hurtBy))
        t = rt.hurtBy;
      if (!t && !rt.engage) {
        const s = this.rtsScan(D.sight, D);
        if (s && !s.rtsInv && inLeash(s)) t = s;
      }
      if (!t && !rt.engage && camp.tgt && this.rtsHostileOk(camp.tgt) && inLeash(camp.tgt)) t = camp.tgt;
      if (t && t !== rt.engage) {
        rt.engage = t;
        rt.tgtHp = t.hp;
      }
    }
    const t = rt.engage;
    if (!t) {
      this.rtsGo(home.x, home.z, 1, dt, null);
      return;
    }
    camp.tgt = t;
    camp.seenT = R.t;
    if (cx && cx.kind === 'flame') this.rtsCreepFlame(t, dt, D, cx);
    else if (cx && cx.kind === 'cart') this.rtsCreepCart(t, dt, D, cx);
    else this.rtsFight(t, dt, D, true);
    if (cx && (cx.kind === 'acid' || cx.kind === 'gravity')) this.rtsCreepCast(t, dt, cx);
    // 打到敵人（目標的血量變少）：營地的放棄計時重來
    if (t.hp < (rt.tgtHp === undefined ? t.hp : rt.tgtHp) - 0.01) camp.hitT = rt.shotT = R.t;
    rt.tgtHp = t.hp;
  },

  // ---------- R6：野怪的特殊行為（docs 17.2 #10） ----------
  // 這台的參數（只有營地的野怪；定義的 cx 覆寫表的）
  rtsCreepCx(D) {
    if (this._rtcx !== undefined) return this._rtcx;
    const base = CREEP_CX[this.rtsDef];
    this._rtcx = base || (D && D.cx) ? { ...(base || {}), ...((D && D.cx) || {}) } : null;
    if (this._rtcx && this._rtcx.kind === 'cart') this.rtsCreepCartArm();
    return this._rtcx;
  },
  // 玩家（隊伍 0）看得到 (x, z) 而且在鏡頭附近：預警與特效只畫這種
  rtsCreepSeen(x, z) {
    const g = this.game;
    if (g.rtsFogState && g.rtsFogState(ME, x, z) !== 2) return false;
    return !g.rtsFxOk || g.rtsFxOk({ x, z });
  },
  // 敵方（非中立）的單位在 r 內（建築、中立建築、登機中的不算）
  rtsCreepNear(r) {
    for (const t of this.game.rtsNear(this.pos.x, this.pos.z, r + 3))
      if (
        t &&
        !t.dead &&
        !t.bld &&
        !t.rtsInv &&
        !t.rtsAboard &&
        t.rtsTeam !== undefined &&
        t.rtsTeam !== this.rtsTeam &&
        Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) <= r + (t.radius || 1) * 0.5
      )
        return t;
    return null;
  },
  // 每格（狀態分支之前）：潛伏、煙幕、警報
  rtsCreepPre(dt, cx, camp, home) {
    const g = this.game,
      R = g.rts;
    const s = this.rtc || (this.rtc = { chk: 0, last: camp.st, smoked: false, upT: -99 });
    s.chk -= dt;
    const hurt = !!(this.rt.hurtBy && R.t - (this.rt.hurtT || -99) < 1);
    if (cx.kind === 'lurk') {
      if (s.buried === undefined) {
        this.rtsCreepBury(true);
        s.chk = 0.25;
        return;
      }
      if (s.chk > 0 && !hurt) return;
      s.chk = 0.25;
      if (s.buried) {
        if (hurt || camp.st !== 'idle' || this.rtsCreepNear(cx.r)) this.rtsCreepBury(false);
      } else if (
        camp.st === 'idle' &&
        R.t - s.upT > 4 &&
        Math.hypot(this.pos.x - home.x, this.pos.z - home.z) < 2.5 &&
        !this.rtsCreepNear(cx.r)
      )
        this.rtsCreepBury(true);
    } else if (cx.kind === 'smoke') {
      // 出動的那一刻（每次出動一次）
      if (camp.st === 'fight' && s.last !== 'fight' && !s.smoked && R.hfx && g.rtsHeroZone) {
        s.smoked = true;
        s.smokeT = R.t;
        const seen = this.rtsCreepSeen(camp.pos.x, camp.pos.z);
        if (seen)
          g.rtsHeroZone({
            x: camp.pos.x,
            z: camp.pos.z,
            r: cx.r,
            t: cx.t,
            src: this,
            team: this.rtsTeam,
            fx: 'smoke',
          });
        R.creepSmoke = R.creepSmoke || [];
        R.creepSmoke.push({ x: camp.pos.x, z: camp.pos.z, r: cx.r, end: R.t + cx.t });
        if (seen) {
          g.fx.streaks(this.center(), 10, 0xb8b8b0, 14, 0.5, 10, new THREE.Vector3(0, 1, 0), 0.6);
          SFX.play('thud1', 0.5, 0.9, 0.05, 0.05, this.center());
        }
      }
      if (camp.st === 'idle') s.smoked = false;
    } else if (cx.kind === 'alarm' && camp.st === 'idle') {
      let t = hurt && !this.rt.hurtBy.dead ? this.rt.hurtBy : null;
      if (!t && s.chk <= 0) {
        s.chk = 0.2;
        t = this.rtsCreepNear(cx.r);
      }
      if (t) this.rtsCreepAlarm(camp, t);
    }
    s.last = camp.st;
  },
  // 煙幕（R.creepSmoke）：裡面、1.5 秒內沒有打中敵人的野怪不能被鎖定（自己的旗標 rtcSmoke，離開或到期時還原）
  rtsCreepSmokeTick() {
    const R = this.game.rts,
      L = R.creepSmoke;
    for (let i = L.length - 1; i >= 0; i--) if (R.t >= L[i].end) L.splice(i, 1);
    let hide = false;
    if (!this.dead && !(R.t - (this.rt.shotT || -99) < 1.5))
      for (const q of L)
        if (Math.hypot(this.pos.x - q.x, this.pos.z - q.z) <= q.r) {
          hide = true;
          break;
        }
    if (hide === !!this.rtcSmoke) return;
    this.rtcSmoke = hide;
    this.noLock = hide; // 迷霧看不到時 rts-fog.js 下一格會再設回 true
  },
  // 雪中潛伏 MT：埋下／現身
  rtsCreepBury(on) {
    const g = this.game,
      s = this.rtc;
    s.buried = on;
    this.rtsSub = on; // 迷霧：潛航的規則（rts-fog.js 的 rtsFogSees → rtsSubSeen）
    this.bossVis = on ? (this.bossVis || 0) | 1 : (this.bossVis || 0) & ~1; // 模型蹲下（foe-models.js 的 lurker）
    if (!on) s.upT = g.rts.t;
    if (this.rtsCreepSeen(this.pos.x, this.pos.z)) {
      g.fx.dust(this.pos.clone(), on ? 3 : 4, on ? 8 : 14, 0xf0f4f8);
      if (!on) SFX.play('debris', 0.45, 1.1, 0.05, 0.05, this.center());
    }
  },
  // 保全雷射網的警報：同營地立刻出動
  rtsCreepAlarm(camp, t) {
    const g = this.game,
      R = g.rts;
    camp.st = 'fight';
    camp.tgt = t;
    camp.hitT = camp.seenT = R.t;
    camp.alarmT = R.t;
    if (this.rtsCreepSeen(this.pos.x, this.pos.z)) {
      const c = this.center();
      g.fx.flash(c, 3, 0xff3a30, 0.3);
      g.fx.ring(this.pos.clone().setY(this.pos.y + 0.3), ALARM_RING, 0xff3a30);
      SFX.play('alarm', 0.55, 1, 0.02, 0.5, c);
    }
  },
  // 交戰中定期施放：腐蝕區（acid）、重力場（gravity）；預警 cx.warn 秒（地點固定在預警時目標的位置）
  rtsCreepCast(t, dt, cx) {
    const g = this.game,
      R = g.rts,
      s = this.rtc || (this.rtc = { chk: 0 });
    if (s.cT === undefined) s.cT = cx.first || cx.every;
    s.cT -= dt;
    if (!s.at && s.cT <= cx.warn) {
      if (!t || t.dead || t.flying) {
        s.cT = cx.warn + 0.5; // 目標不在地面：稍後再試
        return;
      }
      const w = g.world;
      s.at = { x: t.pos.x, z: t.pos.z, y: w.groundAt(t.pos.x, t.pos.z, t.pos.y + 1) };
      s.seen = this.rtsCreepSeen(s.at.x, s.at.z);
      if (cx.kind === 'acid') this.bossVis = (this.bossVis || 0) | 1; // 噴嘴臂抬起（foe-models.js 的 sprayer）
      if (s.seen)
        g.fx.warnCircle(
          new THREE.Vector3(s.at.x, s.at.y, s.at.z),
          cx.r,
          cx.warn,
          cx.kind === 'acid' ? 0x9aff40 : 0xb070ff,
        );
    }
    if (s.at && s.cT <= 0) {
      const at = s.at;
      s.at = null;
      s.cT = cx.every;
      s.casts = (s.casts || 0) + 1;
      if (cx.kind === 'acid') {
        this.bossVis = (this.bossVis || 0) & ~1;
        if (R.hfx && g.rtsHeroZone)
          g.rtsHeroZone({
            x: at.x,
            z: at.z,
            r: cx.r,
            t: cx.t,
            src: this,
            team: this.rtsTeam,
            dps: cx.dps,
            atk: 'exp',
            foe: { armor: cx.armor },
            fx: s.seen ? 'acid' : null,
          });
        if (s.seen) {
          const mz = this.muzzle('rarm');
          const to = new THREE.Vector3(at.x, at.y, at.z);
          g.fx.streaks(mz, 12, 0x9aff40, 18, 0.5, 14, to.sub(mz).normalize(), 0.35);
          SFX.play('splash', 0.5, 0.8, 0.05, 0.05, mz);
        }
      } else {
        (R.creepGrav || (R.creepGrav = [])).push({
          x: at.x,
          z: at.z,
          y: at.y,
          r: cx.r,
          end: R.t + cx.t,
          src: this,
          own: this,
          team: this.rtsTeam,
          tick: 0,
          fxT: 0,
        });
        if (s.seen) SFX.play('dome2', 0.5, 0.7, 0.05, 0.05, new THREE.Vector3(at.x, at.y, at.z));
      }
    }
  },
  // 重力場（R.creepGrav）：每 0.2 秒對範圍內的敵方單位套 'nojump'；放的那台負責（它死了由別的野怪接手）
  rtsCreepGravTick(dt) {
    const g = this.game,
      R = g.rts,
      L = R.creepGrav;
    if (!L || !L.length) return;
    for (let i = L.length - 1; i >= 0; i--) {
      const q = L[i];
      if (q.own !== this && q.own && !q.own.dead) continue;
      q.own = this;
      if (R.t >= q.end) {
        L.splice(i, 1);
        continue;
      }
      q.tick -= dt;
      if (q.tick <= 0) {
        q.tick = 0.2;
        for (const u of g.rtsNear(q.x, q.z, q.r + 3))
          if (
            u &&
            !u.dead &&
            !u.bld &&
            !u.rtsAboard &&
            u.rtsTeam !== q.team &&
            u.addStatus &&
            Math.hypot(u.pos.x - q.x, u.pos.z - q.z) <= q.r + (u.radius || 1) * 0.3
          )
            u.addStatus('nojump', 0.5, { src: q.src.id });
      }
      q.fxT -= dt;
      if (q.fxT <= 0) {
        q.fxT = 0.6;
        if (this.rtsCreepSeen(q.x, q.z)) {
          const p = new THREE.Vector3(q.x, q.y + 0.25, q.z);
          g.fx.ring(p, q.r, 0xb070ff);
          g.fx.ring(p.clone().setY(q.y + 2.5), q.r * 0.6, 0x9a60ff);
        }
      }
    }
  },
  // 推進器試車台：預警 → 噴火（錐形）→ 休息；取代一般開火（試車台不移動，只轉向）
  rtsCreepFlame(t, dt, D, cx) {
    const g = this.game,
      rt = this.rt;
    const s = this.rtc || (this.rtc = { chk: 0 });
    if (s.ph === undefined) ((s.ph = 0), (s.pt = 0));
    s.pt -= dt;
    if (s.ph === 0) {
      rt.face = rt.faceV.copy(t.center());
      let dy = Math.abs(this.aimYaw - this.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy = Math.PI * 2 - dy;
      if (s.pt <= 0 && dy < 0.35 && this.rtsDistTo(t) <= cx.len - 1 && this.staggerT <= 0) {
        const L = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) || 1;
        s.dir = [(t.pos.x - this.pos.x) / L, (t.pos.z - this.pos.z) / L];
        s.ph = 1;
        s.pt = cx.warn;
        s.seen = this.rtsCreepSeen(this.pos.x, this.pos.z);
        if (s.seen) {
          const [fx, fz] = s.dir;
          const c = new THREE.Vector3(
            this.pos.x + fx * (cx.len / 2 + 1),
            0,
            this.pos.z + fz * (cx.len / 2 + 1),
          );
          c.y = g.world.terrainHeight(c.x, c.z);
          g.fx.warnRect(c, Math.atan2(fx, fz), cx.w * 2, cx.len, cx.warn, 0xff8a30);
        }
      }
    } else {
      const [ax, az] = s.dir;
      rt.face = rt.faceV.set(this.pos.x + ax * 10, this.pos.y + 2, this.pos.z + az * 10);
      if (s.ph === 1 && s.pt <= 0) {
        s.ph = 2;
        s.pt = cx.fire;
        s.tick = 0;
        s.fxT = 0;
        s.fires = (s.fires || 0) + 1;
        if (s.seen) SFX.play('overload', 0.6, 0.6, 0.05, 0.05, this.center());
      } else if (s.ph === 2) {
        s.fxT -= dt;
        if (s.fxT <= 0 && s.seen) {
          s.fxT = 0.15;
          g.fx.flameCone(this.muzzle('rarm'), new THREE.Vector3(ax, 0, az), cx.len * 0.55, 0.22, 7);
        }
        s.tick -= dt;
        while (s.tick <= 0) {
          s.tick += 0.25;
          // 平均的每秒傷害和一般開火相同：噴火時 dps × 循環 ÷ 噴火時間
          const per = (((D.dps || 0) * (cx.warn + cx.fire + cx.rest)) / cx.fire) * 0.25 * (this.dmgMul || 1);
          for (const u of g.rtsNear(this.pos.x, this.pos.z, cx.len + 4)) {
            if (!u || u.dead || u.rtsInv || u.rtsTeam === this.rtsTeam || u.rtsTeam === undefined) continue;
            if (u.rtsAboard || (u.flying && !(g.rtsLowAir && g.rtsLowAir(u)))) continue;
            const rx = u.pos.x - this.pos.x,
              rz = u.pos.z - this.pos.z;
            const pad = u.bld ? Math.max(u.bld.w, u.bld.d) / 2 : u.radius || 1;
            const along = rx * ax + rz * az,
              side = Math.abs(-rx * az + rz * ax);
            if (along < -pad || along > cx.len + pad) continue;
            if (side > cx.w * (0.35 + (0.65 * Math.max(0, along)) / cx.len) + pad) continue;
            g.rtsHit(u, per, 40, this, 'exp');
          }
        }
        if (s.pt <= 0) {
          s.ph = 0;
          s.pt = cx.rest;
        }
      }
    }
    this.bossVis = ((this.bossVis || 0) & ~3) | s.ph; // 模型：1 預警、2 噴火（foe-models.js 的 testrig）
  },

  // ---------- 炸藥礦車（docs 18.4） ----------
  // 實例的 die 包一層：還沒爆就被打死時小爆炸（測試的清場 rtsQuiet、局結束、g.rtsCreepFxOff 時不爆）
  rtsCreepCartArm() {
    if (this._rtcDie) return;
    this._rtcDie = true;
    const d0 = this.die;
    this.die = function (from) {
      const g = this.game;
      if (!this.dead && !this.rtsQuiet && g.rts && !g.rts.over && !g.rtsCreepFxOff) this.rtsCreepBoom(false);
      return d0.call(this, from);
    };
  },
  // 衝鋒：全速衝向目標，外緣 arm m 內停下點火
  rtsCreepCart(t, dt, D, cx) {
    const g = this.game,
      R = g.rts,
      rt = this.rt;
    const s = this.rtc || (this.rtc = { chk: 0 });
    s.cart = true;
    // 空中的追不到：換視野內最近的地面單位（rtsScan 只找打得到的），沒有就停著
    if (t.flying && !(g.rtsLowAir && g.rtsLowAir(t))) {
      const u = this.rtsScan(D.sight, D);
      if (!u || (u.flying && !(g.rtsLowAir && g.rtsLowAir(u)))) return;
      rt.engage = t = u;
      rt.tgtHp = u.hp;
    }
    rt.face = rt.faceV.copy(t.center());
    if (this.rtsDistTo(t) <= cx.arm && this.staggerT <= 0) {
      const x = this.pos.x,
        z = this.pos.z,
        y = g.world.groundAt(x, z, this.pos.y + 1);
      s.ph = 1;
      s.pt = cx.fuse;
      s.fxT = 0;
      s.tgt = t;
      s.fuses = (s.fuses || 0) + 1;
      s.fuseT = R.t;
      s.seen = this.rtsCreepSeen(x, z);
      rt.nav = null;
      if (s.seen) g.fx.warnCircle(new THREE.Vector3(x, y, z), cx.r, cx.fuse, 0xff3020);
      return;
    }
    this.rtsGo(t.pos.x, t.pos.z, 0.3, dt, null, false);
  },
  // 點火中（rtsCreepAI 開頭）：不動、每 0.2 秒閃紅燈＋嗶聲（越來越急），時間到就爆
  rtsCreepCartFuse(dt) {
    const g = this.game,
      s = this.rtc,
      cx = this._rtcx;
    this.rt.wish.set(0, 0, 0);
    s.pt -= dt;
    s.fxT -= dt;
    if (s.fxT <= 0) {
      const k = 1 - Math.max(0, s.pt) / cx.fuse;
      s.fxT = 0.22 - 0.1 * k;
      if (s.seen) {
        const c = this.center();
        g.fx.flash(c, 1.3, 0xff2020, 0.1);
        SFX.play('bell', 0.35, 1.6 + 0.8 * k, 0, 0, c);
      }
    }
    if (s.pt <= 0) {
      this.rtsCreepBoom(true);
      return true;
    }
    this.move(dt, ZERO, false, false, false, null);
    return true;
  },
  // 爆炸：full＝自爆（之後自己死亡），否則是被打死時的小爆炸。紀錄在 this.rtcBoom（測試）
  rtsCreepBoom(full) {
    const g = this.game,
      R = g.rts,
      s = this.rtc || (this.rtc = { chk: 0 }),
      cx = this._rtcx;
    if (!R || !cx || s.boomed) return;
    s.boomed = true;
    s.ph = 2;
    const x = this.pos.x,
      z = this.pos.z;
    const r = full ? cx.r : cx.dR;
    const dmg = (full ? cx.dmg : cx.dDmg) * (this.dmgMul || 1);
    const n = g.rtsSplash(x, z, r, dmg, full ? cx.imp : cx.dImp, this, 'exp'); // 爆發：也炸散殘骸（rtsWreckBlast）
    this.rtcBoom = { full, n, t: R.t, x, z };
    if (this.rtsCreepSeen(x, z)) {
      const c = this.center();
      g.fx.explosion(c, r * (full ? 0.9 : 0.7), 0xffa040, full);
      g.fx.dust(new THREE.Vector3(x, g.world.terrainHeight(x, z) + 0.3, z), r, full ? 14 : 8, 0x8a7a60);
      SFX.explode(full, c);
    }
    if (!full) return;
    // 自己死亡：擊破算給最近 4 秒的攻擊者，否則是點火時的目標（經驗與營地的掉寶照一般野怪）
    const h = this.rt.hurtBy;
    const credit =
      h && h.rtsTeam !== undefined && h.rtsTeam !== this.rtsTeam && R.t - (this.rt.hurtT || -99) < 4
        ? h
        : s.tgt || h || null;
    this.die(credit);
  },
});
