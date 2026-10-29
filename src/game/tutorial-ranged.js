// Game：遠程訓練課程的專用部分（docs/ranged-tutorial.md；課程資料在 data/tutorial-ranged.js）。
// 流程、面板、存檔、示範的虛擬輸入都和近戰訓練共用（game/tutorial.js），這裡是遠程才有的：
//   組裝（主武器或固定組合）、假人（真的敵人類型 ENEMY_TYPES，可以好幾台）、開始的位置（理想射程的練習拉開距離）、
//   每格（理想射程的圈、換鎖定目標）、事件的整理（tutREv）、示範腳本的指令、時機條、失敗的原因、假人的行為。
import { clamp } from '../core/math.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { FEEL } from '../data/feel.js';
import { partById } from '../data/parts.js';
import { RB } from '../data/ranged.js';
import { WP } from '../data/weak.js';
import { rbTags } from '../data/tutorial-ranged.js';
import { Game } from './game.js';

const FAN = [0, -0.42, 0.42, -0.84, 0.84]; // 好幾台假人：排成扇形（弧度）
const R_BARS = new Set(['qb', 'apex', 'land', 'ar', 'orbit', 'pqb', 'missile']);
const APEX_SPAN = 1.6; // 頂點射擊的時機條：最高點前後各 0.8 秒
const TELE = 0.9; // 點放的預警（遊戲秒；「!」在打到前 cueLead 秒）
const AIM_T = 1.7; // 長預備（打斷招式的練習）
const MSL_SPAN = 1.2; // 導彈的時機條：最後 1.2 秒

Object.assign(Game.prototype, {
  // 這一步的組裝：挑主武器的課＝右手主武器、左手空；否則照課程（或這一步）的固定組合
  tutRAsm(step) {
    const T = this.tut;
    const su = step.setup || {};
    const kit = step.kit || T.L.kit || {};
    const asm = {
      ...this.save.asm,
      rarm: 'w_none',
      larm: 'w_none',
      rback: 'bw_none',
      lback: 'bw_none',
      ...kit,
    };
    if (T.L.pick && T.wid) asm.rarm = T.wid;
    if (su.fcs) asm.fcs = su.fcs;
    return asm;
  },
  // 假人：真的敵人類型（弱點、預警招式綁在類型上），血量很多、火力很低，行為由 tutRAI 接手
  tutRSpawn(step) {
    const T = this.tut;
    const D = step.dummy || { type: 'mt', lv: 0 };
    const d = ENEMY_TYPES[D.type || 'mt'] || ENEMY_TYPES.mt;
    T.dummies = [];
    for (let i = 0; i < (D.n || 1); i++) {
      const e = this.spawnEnemy({
        name: `訓練目標（${d.name}）`,
        asm: { ...d.gen(), ...(D.asm || {}) },
        pal: d.pal,
        scale: d.scale,
        hpMul: D.hpMul || 3,
        dmgMul: 0.12,
        stabMul: 1,
        ai: d.ai,
        etype: D.type || 'mt',
        grunt: true,
        wantDist: d.wantDist,
        speedMul: 0.6,
        at: new THREE.Vector3(0, this.world.terrainHeight(0, -40), -40),
      });
      e.tutD = { ...D, ph: Math.random() * 6, i, tele: null, burst: 0, atkT: 1.4 };
      // 弱點的預備（時機型弱點）看感知狀態的 sn.mv：建立感知狀態（行為照舊由 tutRAI 接手）
      if (D.sense && e.senseInit) e.senseInit(false);
      T.dummies.push(e);
    }
    T.dummy = T.dummies[0];
    T.respT = 0;
  },
  // 開始的距離（公尺）：far＝理想射程外（不超過鎖定距離與場地）
  tutRDist(D) {
    if (D.far) {
      const p = this.player,
        ideal = this.tutWDef().ideal || 60;
      return Math.min(ideal * 1.35, (p ? this.lockReach(p) : 140) * 0.9, 175);
    }
    return D.dist || 40;
  },
  tutRReset() {
    const T = this.tut,
      p = this.player,
      W = this.world;
    const D = T.step.dummy || {};
    const d = this.tutRDist(D);
    const pz = D.far ? d * 0.45 : 0; // 拉開距離時玩家往後站（場地 ±lim）
    p.pos.set(0, W.terrainHeight(0, pz), pz);
    p.vel.set(0, 0, 0);
    p.meleeEnd();
    p.staggerT = 0;
    p.hp = p.maxHp;
    p.en = p.enMax;
    p.yaw = p.aimYaw = 0;
    p.qbT = p.abT = 0;
    p.rbOrbT = 0;
    for (const e of T.dummies || []) {
      if (e.dead) continue;
      const a = FAN[e.tutD.i % FAN.length];
      const x = Math.sin(a) * d,
        z = pz - Math.cos(a) * d;
      e.pos.set(x, W.terrainHeight(x, z), z);
      e.vel.set(0, 0, 0);
      e.yaw = e.aimYaw = Math.atan2(-(p.pos.x - x), -(p.pos.z - z));
      e.hp = e.maxHp;
      e.staggerT = 0;
      e.tutD.tele = null;
      e.tutD.burst = 0;
      e.tutD.atkT = 1.4;
      e.cueCancel();
      if (e.sn) e.sn.mv = null;
    }
    if (T.dummy && !T.dummy.dead) p.lock = T.dummy;
    T.lastLock = p.lock;
    T.lastMv = null;
  },
  // 每格：理想射程的圈、換鎖定目標、這一步的視角
  tutRTick() {
    const T = this.tut,
      p = this.player,
      e = T.dummy,
      ring = this.tutRing;
    const want = T.step.setup && T.step.setup.view;
    if (want && T.phase !== 'skip' && this.viewName() !== want) {
      if (T.viewPrev === undefined) T.viewPrev = this.viewName();
      this.setView(want, true);
    } else if (!want && T.viewPrev !== undefined) {
      this.setView(T.viewPrev, true);
      T.viewPrev = undefined;
    }
    const ideal = this.tutWDef().ideal;
    if (ring) {
      ring.visible = !!(T.step.ring === 'ideal' && ideal && e && !e.dead);
      if (ring.visible) {
        const inR = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) <= ideal;
        ring.position.set(e.pos.x, this.world.terrainHeight(e.pos.x, e.pos.z) + 0.08, e.pos.z);
        ring.scale.setScalar(ideal);
        ring.material.color.setHex(inR ? 0x7ee081 : 0x8a97a6);
      }
    }
    if (p.lock && T.lastLock && p.lock !== T.lastLock && !T.lastLock.dead && T.phase === 'try')
      this.tutGoal('lockSw', {});
    T.lastLock = p.lock;
  },
  // 事件的整理（tutEv 在判定之前呼叫）：加成的位元 → 標籤、射擊打中在不在理想射程內
  tutREv(k, o) {
    const T = this.tut;
    if (k === 'rb' || k === 'rbFire') {
      o.mask = o.tags;
      o.tags = rbTags(o.tags);
      if (k === 'rbFire' && o.tags.size) T.goodFire = T.clock;
    }
    if (k === 'crit') T.critT = T.clock;
    if (k === 'shot') {
      const d = (o.wid && partById('arm', o.wid)) || this.tutWDef();
      o.out = !!(d.ideal && o.dist > d.ideal);
      if (o.out && T.step.ring === 'ideal' && T.phase === 'try') {
        const k2 = Math.max(0.55, 1 - ((o.dist - d.ideal) / Math.max(1, d.range - d.ideal)) * 0.45);
        T.msg = `圈外打中：傷害約 <b>×${k2.toFixed(2)}</b>（離 ${Math.round(o.dist)} m，理想射程 ${d.ideal} m）`;
        T.msgT = 3;
      }
    }
  },
  // ---------- 示範腳本的遠程指令（回傳 true＝處理了）----------
  tutRScript(a, S, V, next) {
    const T = this.tut,
      p = this.player,
      e = T.dummy,
      w = p.weapons.rarm;
    const ready = () => w.cd <= 0 && !(w.reloadT > 0) && !(w.def.mag && w.mag <= 0);
    switch (a[0]) {
      case 'fire':
        S.hold = { k: 'fireR', t: a[1], async: false };
        next();
        return true;
      case 'tap':
        if (V.fireR || !ready()) return true;
        V.fireR = 1;
        next();
        return true;
      case 'lock':
        this.cycleLock();
        next();
        return true;
      case 'empty':
        if (w.reloadT > 0) {
          V.fireR = false;
          next();
        } else V.fireR = true;
        S.t = Math.min(S.t, 6); // 機槍的彈匣比較大：不算卡住
        return true;
      case 'arTap': {
        if (!(w.reloadT > 0)) {
          next(); // 已經裝填完了
          return true;
        }
        const pr = 1 - w.reloadT / (w.def.reload || 1);
        const go =
          a[1] === 'ok'
            ? pr >= FEEL.AR_A + 0.03 && pr <= FEEL.AR_B - 0.04
            : pr >= 0.08 && pr < FEEL.AR_A - 0.12;
        if (go && !V.fireR) {
          V.fireR = 1;
          next();
        }
        return true;
      }
      case 'approach': {
        if (!e || e.dead) return true;
        const ideal = this.tutWDef().ideal || 40;
        const dx = e.pos.x - p.pos.x,
          dz = e.pos.z - p.pos.z;
        if (Math.hypot(dx, dz) <= ideal * a[1]) next();
        else V.wish.set(dx, 0, dz).normalize();
        return true;
      }
      case 'lockShot': {
        // 把鎖定換到飛來的彈上（鎖定的候選裡彈排在敵人後面）
        if (p.lock && p.lock.isShot) {
          next();
          return true;
        }
        if (!this.shotTargets(p.team).length) return true;
        if ((S.lsT = (S.lsT || 0) - this.lastDt) <= 0) {
          S.lsT = 0.12;
          this.cycleLock();
        }
        return true;
      }
      case 'behind': {
        if (!e || e.dead) return true;
        const f = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
        const tp = new THREE.Vector3(p.pos.x - e.pos.x, 0, p.pos.z - e.pos.z);
        const dd = tp.length() || 1;
        tp.divideScalar(dd);
        if (tp.dot(f) < -0.8) {
          S.bhD = undefined;
          next();
          return true;
        }
        if (S.bhD === undefined) S.bhD = dd;
        const t = new THREE.Vector3(-tp.z, 0, tp.x);
        if (t.dot(f) > 0) t.negate(); // 往背後那一側繞
        V.wish.copy(t).addScaledVector(tp, clamp((S.bhD - dd) / S.bhD, -0.5, 0.5) * 2);
        S.t = Math.min(S.t, 7);
        return true;
      }
      case 'aimWeak': {
        // 追尾視角：把準星（畫面中央）移到弱點上（頭頂的感測器優先）
        if (p.wpAim) {
          next();
          return true;
        }
        const L = p.lock;
        if (!L || L.dead || !L.wpKeys || !L.wpKeys()) return true;
        const K = L.wpKeys();
        const k = K.includes('sen') ? 'sen' : K[0];
        const s = this.proj(L.wpPoints(k)[0]);
        if (!s.in) return true;
        this.fpYaw -= (s.x - innerWidth / 2) * 0.0012;
        this.fpPitch = clamp((this.fpPitch || 0) - (s.y - innerHeight / 2) * 0.0012, -1.2, 1.2);
        return true;
      }
      case 'orbit': {
        if (!e || e.dead) return true;
        const dx = e.pos.x - p.pos.x,
          dz = e.pos.z - p.pos.z,
          dd = Math.hypot(dx, dz) || 1;
        if (S.orbD === undefined) S.orbD = dd;
        // 橫向（逆時針）＋拉回開始的距離
        V.wish
          .set(-dz / dd, 0, dx / dd)
          .addScaledVector(
            new THREE.Vector3(dx / dd, 0, dz / dd),
            clamp((dd - S.orbD) / S.orbD, -0.5, 0.5) * 2,
          );
        if (p.rbOrbK() >= 1 && ready() && !V.fireR) V.fireR = 1;
        S.t = Math.min(S.t, 7);
        if ((S.orbT = (S.orbT || 0) + this.lastDt) >= a[1]) {
          S.orbT = 0;
          S.orbD = undefined;
          next();
        }
        return true;
      }
    }
    return false;
  },
  // 示範腳本的等待條件（近戰沒有的）
  tutRWait(c) {
    const T = this.tut,
      p = this.player,
      e = T.dummy,
      D = e && !e.dead ? e.tutD : null;
    if (c === 'apex') return !!p.rbApex();
    if (c === 'cue') return !!(D && D.tele && D.tele.cue);
    if (c === 'pqbDone') return p.pqbT > 0 || p.rbCtrT > 0;
    if (c === 'missile') {
      const m = this.tutRMissile();
      return !!(m && m.tt <= 0.3);
    }
    if (c === 'shell') return this.shotTargets(p.team).some((t) => t.proj && t.proj.age > 0.25);
    return false;
  },
  // 追著玩家、還沒被甩掉的導彈裡最快打到的：{ pr, tt 剩下的秒數 }
  tutRMissile() {
    const p = this.player;
    let best = null;
    for (const pr of this.projectiles || []) {
      if (pr.dead || pr.kind !== 'missile' || pr.target !== p || pr.dodged) continue;
      const tt = pr.pos.distanceTo(p.center()) / Math.max(1, pr.vel.length());
      if (!best || tt < best.tt) best = { pr, tt };
    }
    return best;
  },
  // ---------- 時機條（回傳 null＝不是遠程的時機條）----------
  tutRBar(kind) {
    if (!R_BARS.has(kind)) return null;
    const p = this.player,
      t = p.t;
    const o = { show: false, z0: 0, z1: 0, x: 0, lbl: '', on: false };
    if (kind === 'qb') {
      const dt = p.qbStartT === undefined ? 9 : t - p.qbStartT;
      if (dt <= 0.7) {
        Object.assign(o, { show: true, z0: 0, z1: RB.QB_T / 0.7, x: dt / 0.7 });
        o.on = dt <= RB.QB_T;
        o.lbl = o.on ? 'QB 中：現在開火' : '過了：下次 QB 後馬上開火';
      }
    } else if (kind === 'apex') {
      if (!p.grounded) {
        const x =
          p.vel.y > 0
            ? 0.5 - p.vel.y / (p.riseG || 30) / APEX_SPAN
            : 0.5 + (t - (p.rbApexT === undefined ? t : p.rbApexT)) / APEX_SPAN;
        const h = RB.APEX_T / APEX_SPAN;
        Object.assign(o, { show: true, z0: 0.5 - h, z1: 0.5 + h, x: clamp(x, 0, 1) });
        o.on = p.rbApex();
        o.lbl = o.on ? '最高點：現在開火' : x < 0.5 ? '往上衝：等一下' : '往下掉了';
      }
    } else if (kind === 'land') {
      if (!p.grounded) Object.assign(o, { show: true, z0: 0, z1: RB.LAND_T, x: 0, lbl: '在空中：等落地' });
      else if (p.rbLandT !== undefined && t - p.rbLandT <= 1) {
        const x = t - p.rbLandT;
        Object.assign(o, { show: true, z0: 0, z1: RB.LAND_T, x, on: x <= RB.LAND_T });
        o.lbl = o.on ? '落地了：現在開火' : '過了：下次落地馬上開火';
      }
    } else if (kind === 'ar') {
      const w = p.weapons.rarm,
        R = w.def.reload || 0;
      if (w.reloadT > 0 && R >= FEEL.AR_MIN) {
        const x = 1 - w.reloadT / R;
        Object.assign(o, { show: true, z0: FEEL.AR_A, z1: FEEL.AR_B, x });
        o.on = x >= FEEL.AR_A && x <= FEEL.AR_B;
        o.lbl = w.arTried ? '這次換彈已經按過了' : o.on ? '亮區：現在按開火' : '換彈中：等走進綠色';
      }
    } else if (kind === 'pqb') {
      const e = this.tut.dummy,
        D = e && !e.dead ? e.tutD : null;
      if (p.pqbT > 0 || p.rbCtrT > 0) {
        const left = p.rbCtrT > 0 ? p.rbCtrT : p.pqbT;
        Object.assign(o, { show: true, z0: 0, z1: 1, x: 1 - left / 1.5, on: true });
        o.lbl = p.rbCtrT > 0 ? 'COUNTER 中：繼續開火' : '完美迴避：現在開火';
      } else if (D && (D.tele || D.burst > 0) && D.atk === 'shot') {
        const span = TELE + 0.6,
          lead = e.cueLead(p);
        const x = D.tele ? (D.tele.T - D.tele.t) / span : (TELE + 0.55 - D.burst) / span;
        Object.assign(o, { show: true, z0: (TELE - lead) / span, z1: (TELE + 0.45) / span, x });
        o.on = x >= o.z0 && x <= o.z1;
        o.lbl = D.tele && !D.tele.cue ? '假人在預備：等「!」出現' : '「!」出現了：按 QB';
      }
    } else if (kind === 'missile') {
      if (p.pqbT > 0 || p.rbCtrT > 0) {
        Object.assign(o, {
          show: true,
          z0: 0,
          z1: 1,
          x: 1 - (p.rbCtrT > 0 ? p.rbCtrT : p.pqbT) / 1.5,
          on: true,
        });
        o.lbl = '甩掉了：現在開火＝COUNTER';
      } else {
        const m = this.tutRMissile();
        if (m && m.tt <= MSL_SPAN) {
          const x = 1 - m.tt / MSL_SPAN;
          Object.assign(o, { show: true, z0: 1 - WP.MSL_T / MSL_SPAN, z1: 1, x });
          o.on = m.tt <= WP.MSL_T;
          o.lbl = o.on ? '導彈貼近了：按 QB' : '導彈飛來：等它靠近';
        }
      }
    } else if (kind === 'orbit') {
      const k = p.rbOrbK();
      Object.assign(o, { show: true, z0: 0.97, z1: 1, x: k, on: k >= 1 });
      o.lbl = k >= 1 ? 'ORBIT：現在開火' : k > 0 ? '繞射累積中…' : '橫向移動：繞著目標跑';
    }
    return o;
  },
  // ---------- 失敗的原因 ----------
  tutRFeedback(k, o, say) {
    const T = this.tut,
      step = T.step,
      p = this.player;
    if (k === 'ar' && !o.ok && step.bar === 'ar' && T.prog[1] >= 1 && T.prog[0] < 2)
      return say('卡彈了：等時機條走進綠色再按 [fire]');
    const recent = (key, s) => T.log[key] !== undefined && T.clock - T.log[key] <= s;
    // 被打中：完美迴避的時機
    if (k === 'hurt' && (step.bar === 'pqb' || step.bar === 'missile') && !(p.pqbT > 0)) {
      if (T.fbT !== undefined && T.clock - T.fbT < 1.2) return;
      T.fbT = T.clock;
      if (step.bar === 'pqb')
        return say(
          recent('qb', 1.2)
            ? '太早閃了：「!」出現之前就按了。等「!」再按 [qb]'
            : '太晚了：被打到了。「!」一出現就按 [qb]',
        );
      return say(
        recent('qb', 1.5)
          ? '太早閃了：導彈會轉回來。等它貼近（時機條的綠色）再按 [qb]'
          : '太晚了：被導彈打中了',
      );
    }
    // 繞背：打中了但不是 CRITICAL
    if (k === 'shot' && step.id === 'back' && T.critT !== T.clock) {
      if (T.fbT !== undefined && T.clock - T.fbT < 1.6) return;
      T.fbT = T.clock;
      return say('打在正面不算：繞到它背後（推進器的菱形變亮）再開火');
    }
    if (k !== 'rbFire' || !step.bar) return;
    // 同一輪射擊（機槍、霰彈）只看第一發；剛打出加成之後的幾發不算
    if (T.goodFire !== undefined && T.clock - T.goodFire < 0.6) return;
    if (T.fbT !== undefined && T.clock - T.fbT < 1.2) return;
    T.fbT = T.clock;
    if (step.bar === 'qb' && !o.tags.has('qb'))
      return say(recent('qb', 1.2) ? '太晚了：QB 之後 0.35 秒內就要開火' : '先按 [qb]，再馬上開火');
    if (step.bar === 'apex' && !o.tags.has('apex')) {
      if (p.grounded) return say('要先跳起來，在空中開火');
      return say(p.vel.y > 0 ? '太早了：還在往上衝，等到最高點' : '太晚了：已經在往下掉');
    }
    if (step.bar === 'land' && !o.tags.has('land')) {
      if (!p.grounded) return say('在空中開火不算：等落地');
      return say('太晚了：落地後 0.5 秒內的第一輪才算');
    }
    if (step.bar === 'orbit' && !o.tags.has('orbit'))
      return say('環還沒滿：繞快一點，移動方向和目標保持垂直');
  },
  // ---------- 假人的行為（MechEntity.updateAI 開頭；回傳 true＝不跑一般 AI）----------
  tutRAI(e, dt) {
    const T = this.tut,
      D = e.tutD,
      p = this.player;
    const dx = p.pos.x - e.pos.x,
      dz = p.pos.z - e.pos.z,
      dist = Math.hypot(dx, dz) || 1;
    const lv = T.phase === 'demo' || T.phase === 'try' || T.phase === 'skip' ? D.lv : 0;
    const wish = new THREE.Vector3();
    const want = Math.atan2(-dx, -dz);
    if (D.turn) {
      // 轉身慢（繞背的練習）：每秒最多 turn 弧度
      let df = want - e.yaw;
      df = Math.atan2(Math.sin(df), Math.cos(df));
      e.yaw += clamp(df, -D.turn * dt, D.turn * dt);
      e.aimYaw = e.yaw;
    } else e.yaw = e.aimYaw = want;
    if (lv >= 2 && D.atk) this.tutRAttack(e, dt);
    // 等級 1：左右來回走動
    if (lv >= 1 && !(e.staggerT > 0)) {
      const s = Math.sin(T.clock * 0.5 + D.ph);
      wish.set((-dz / dist) * s, 0, (dx / dist) * s).multiplyScalar(0.6);
      if (Math.hypot(e.pos.x, e.pos.z) > 80) wish.set(-e.pos.x, 0, -e.pos.z).normalize();
    }
    e.move(dt, wish, false, false, false, null);
    if (D.turn) e.yaw = e.aimYaw; // move 的轉向不要蓋掉
    return true;
  },
  // 等級 2：出招（點放、長預備、導彈、榴彈），預警都看得到
  tutRAttack(e, dt) {
    const D = e.tutD,
      p = this.player;
    const refill = (s) => {
      const w = e.weapons[s];
      if (!w) return;
      w.cd = 0;
      w.reloadT = 0;
      if (w.def.mag) w.mag = Math.max(w.mag, w.def.mag);
      if (w.def.ammo) w.ammo = w.def.ammo;
    };
    if (D.burst > 0) {
      D.burst -= dt;
      const w = e.weapons.rarm;
      w.cd = Math.min(w.cd, 0.1);
      w.reloadT = 0;
      w.mag = Math.max(w.mag, 5);
      e.fire('rarm', p.center(), p);
      return;
    }
    if (D.tele) {
      // 被打斷（時機型弱點）或失衡：取消
      if (e.staggerT > 0 || (D.tele.k === 'aim' && e.sn && !e.sn.mv)) {
        D.tele = null;
        e.cueCancel();
        if (e.sn) e.sn.mv = null;
        D.atkT = 1.6;
        return;
      }
      D.tele.t -= dt;
      if (!D.tele.cue && D.tele.k === 'shot' && D.tele.t <= e.cueLead(p)) {
        D.tele.cue = true;
        this.tutCue(e);
      }
      if ((D.tele.fx -= dt) <= 0) {
        D.tele.fx = 0.18;
        this.fx.flash(e.center(), 1.1, 0xff4030, 0.1);
      }
      if (D.tele.t <= 0) {
        D.tele = null;
        if (e.sn) e.sn.mv = null;
        D.burst = 0.55;
      }
      return;
    }
    if (e.staggerT > 0 || (D.atkT -= dt) > 0) return;
    const ev = D.every || [2.4, 3.2];
    D.atkT = ev[0] + Math.random() * (ev[1] - ev[0]);
    if (D.atk === 'missile') {
      refill('rback');
      this.fx.flash(e.center(), 1.4, 0xff8040, 0.2);
      e.fire('rback', p.center(), p);
    } else if (D.atk === 'rocket') {
      refill('larm');
      this.fx.flash(e.center(), 1.4, 0xff8040, 0.2);
      e.fire('larm', p.center(), p);
    } else if (D.atk === 'shot') {
      D.tele = { k: 'shot', t: TELE, T: TELE, fx: 0 };
      // 「!」出現後按 QB＝完美迴避（MechEntity.atkCue；「!」由 tutCue 畫）
      e.atkCue(p, TELE, 0.55 + 1.2, { quiet: true });
      this.fx.warnLine(e.center(), p.center(), TELE, 0xff4030, 0.08);
    } else if (D.atk === 'aim') {
      // 長預備：整台露出弱點（sn.mv 的 wind），衝擊累積夠了被打斷（mech-weak.js 的 wpInterrupt）
      D.tele = { k: 'aim', t: AIM_T, T: AIM_T, fx: 0 };
      if (e.sn) e.sn.mv = { ph: 'wind', brk: 0 };
      this.fx.warnLine(e.center(), p.center(), AIM_T, 0xff4030, 0.08);
    }
  },
});
