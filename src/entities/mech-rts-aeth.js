// Coral 戰爭（RTS）艾瑟立克研究機構的兵種行為（MechEntity 擴充，docs/rts-design.md 14.3、14.12；R3 B 包）。
// mech-rts.js 的分派：rtsAbInit 結尾 rtsAethInit(D)、rtsAbTick 開頭 rtsAethTick(dt, D)（回傳 true＝這一格不動也不開火）、
// rtsAbCast 認不得的技能 rtsAethAb(ab, o)（true＝施放了，費用與冷卻由 rtsAbCast 扣）、rtsFire 的近戰 rtsAethMelee、
// 防禦塔 rtsTowerAI 的雷射網 rtsAethTower；game/rts.js 的 rtsSpawn 在建模之後（合併之前）呼叫 rtsAethModel(D)。
// - 近戰（定義的 melee { r, rof, splash }）：不用武器槽，每 rof 秒以 rtsHit 打 dps × rof × dmgMul，splash 內的其他敵人 50%。
// - 技能：纏附（撲上 0.4 秒→黏在目標身上：每秒 16 'none'、目標速度 ×0.7、射速 ×0.8，最長 8 秒；研究寄生孵化＝目標死亡時
//   出現一隻實驗體）、投影（rtsIllusion 的幻象 3／5 個）、過載（5 秒射速 +60%→硬直 2 秒）、浮游砲展開（8 秒、每秒 3×8 能量）、
//   吞噬（吃掉己方的實驗體：回復 600、10 秒傷害 +20%）；被動的共鳴光環（原型體：15 m 內的生體單位每秒回 3）。
// - 雷射網（a_fence）：曳光＋rtsHit（能量），開火時警報（20 秒一次：rtsFogReveal 攻擊者的位置 6 秒＋玩家的事件）。
// - 外觀：融合的引導（rtsAethFuseFx）、實驗體類的咬（foeAnim_d2 的動作旗標：rtsD2 OR 進 foeBits_d2）、全像投影器與
//   寄生纏附體的模型動作（它們的 ai 是 'rts'，mech-foe-c1.js 的 foeFx_c1 不會跑；specialFx 的實例覆寫）、青色的推進器。
// 只在房主／單機（RTS 沒有多人）；全部的時間以局內時間 R.t 計。
import { MechEntity } from './mech-entity.js';
import { SFX } from '../audio/audio.js';
import { targetDist } from '../world/prop-hit.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { asmStats } from '../data/parts.js';
import { buildBossModel } from '../render/boss-models.js';
import { buildDrone } from '../render/vehicle-models.js';
import { rtsPal } from '../render/rts-models.js';
import { FB_D2 } from '../render/foe-models.js';
import { CORAL_CYAN, addProtoKit } from '../render/rts-aeth-models.js';

const LATCH = { leap: 0.4, dps: 16, max: 8, speed: 0.7, rof: 0.8, tick: 0.5 };
const DECOY = { n: [3, 5], sec: [15, 25], r: 3.2 };
const OC = { t: 5, rof: 1.6, stag: 2 };
const BITS = { t: 8, dmg: 8, n: 3 };
const DEVOUR = { hp: 600, dmg: 1.2, t: 10 };
const ALARM = { cd: 20, r: 20, t: 6 };
const _v = new THREE.Vector3(),
  _w = new THREE.Vector3();
const lerp = (a, b, k) => a + (b - a) * k;

// 實例覆寫（rtsAethInit 設定）：原本的方法照常跑，再加上艾瑟立克的部分
function aethSpecialFx(dt) {
  MechEntity.prototype.specialFx.call(this, dt);
  if (this.rtsAeth && this.lodVis !== false && !this.dead) this.rtsAethAnim(dt);
}
function aethBits() {
  return (MechEntity.prototype.foeBits_d2.call(this) | (this.rtsD2 || 0)) >>> 0;
}
function aethThruster(dt, a, b, j) {
  return MechEntity.prototype.thrusterFx.call(this, dt, CORAL_CYAN, 0x8fe8ff, j);
}

Object.assign(MechEntity.prototype, {
  // 換成 RTS 定義的外觀（效能基準 scripts/rts-bench.js 的 --faction：一般任務的實體換上艾瑟立克兵種真正的模型；
  // 行為照原本的 AI）。team＝隊伍色（0 藍、1 紅）
  rtsAethReskin(defId, team = 0) {
    const D = RTS_DEFS[defId];
    const g = this.game;
    if (!D || D.kind !== 'unit' || this.dead) return false;
    const pal = rtsPal(D.palBase || D.faction, team);
    g.scene.remove(this.mesh);
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    this.pal = pal;
    this.asm = { ...D.asm };
    this.stats = this.dkStats(asmStats(this.asm));
    this.initWeapons();
    this.scale = D.scale || 1;
    this.radius = D.radius || this.radius;
    this.opts = { ...this.opts, modelKind: D.modelKind, vehKey: D.vehKey };
    const raw = g.rtsR ? { raw: true } : undefined;
    this.model =
      D.modelKind === 'boss'
        ? buildBossModel(D.vehKey, pal, this.scale, raw)
        : D.modelKind === 'drone'
          ? buildDrone(pal, this.scale, D.vehKey || 'swarm')
          : this.buildRig(true);
    if (D.id === 'a_proto') addProtoKit(this.model);
    this.mergeModel(this.model);
    const old = this.mesh;
    this.mesh = this.model.group;
    this.mesh.position.copy(old.position);
    this.mesh.rotation.copy(old.rotation);
    g.scene.add(this.mesh);
    if (D.faction === 'aetheric' && !D.bio) this.thrusterFx = aethThruster;
    return true;
  },
  // 建模之後、網格合併之前（rts.js 的 rtsSpawn）：原型體的外加零件
  rtsAethModel(D) {
    if (D && D.id === 'a_proto' && this.model) addProtoKit(this.model);
  },
  // 定義換了（第一次 rtsUnitAI）：狀態與外觀的覆寫
  rtsAethInit(D) {
    // 近戰的野怪（技研都市的實驗體類，D 包）：只要近戰的計時與咬的動作
    if (D && D.creep && D.melee) {
      this.rtsAeth = this.rtsAeth || { mNext: 0, atkT: 0, castT: 0 };
      if (this.model && this.model.anim_d2 && !Object.prototype.hasOwnProperty.call(this, 'foeBits_d2'))
        this.foeBits_d2 = aethBits;
      return;
    }
    if (!D || D.faction !== 'aetheric' || D.kind !== 'unit' || D.hero) {
      this.rtsAeth = null;
      return;
    }
    this.rtsAeth = this.rtsAeth || { mNext: 0, atkT: 0, castT: 0 };
    if (D.id === 'a_proto' && this.model && !this.model.rtsProtoKit) addProtoKit(this.model);
    if (!Object.prototype.hasOwnProperty.call(this, 'specialFx')) this.specialFx = aethSpecialFx;
    if (this.model && this.model.anim_d2 && !Object.prototype.hasOwnProperty.call(this, 'foeBits_d2'))
      this.foeBits_d2 = aethBits;
    if (!D.bio && !Object.prototype.hasOwnProperty.call(this, 'thrusterFx')) this.thrusterFx = aethThruster;
    if (this.model && this.model.torso && this.rtsAeth.ty === undefined)
      this.rtsAeth.ty = this.model.torso.position.y;
  },

  // ---------- 每格 ----------
  // 回傳 true＝這一格不動也不開火（撲上、纏附中）
  rtsAethTick(dt, D) {
    const A = this.rtsAeth;
    if (!A) return false;
    const g = this.game,
      R = g.rts;
    if (A.atkT > 0) A.atkT -= dt;
    // 模型的動作旗標（實驗體類的咬：foeAnim_d2）
    const e = this.rt && this.rt.engage;
    A.warn = !!(D.melee && e && !e.dead && this.rtsDistTo(e) < D.melee.r + 2.5);
    this.rtsD2 = (A.atkT > 0 ? FB_D2.atk : 0) | (A.warn || A.fuseT > R.t || A.castT > R.t ? FB_D2.warn : 0);
    if (A.leap) return this.rtsAethLeap(dt);
    if (A.latch) return this.rtsAethLatch(dt);
    // 過載結束：硬直
    if (A.ocEnd && R.t >= A.ocEnd) {
      A.ocEnd = 0;
      this.staggerT = Math.max(this.staggerT, OC.stag);
      if (g.rtsFxOk(this.center())) {
        g.fx.flash(this.center(), 2, 0xff8060, 0.25);
        for (let i = 0; i < 6; i++) g.fx.spark(this.center(), 0xffb080);
      }
      SFX.play('overload', 0.5, 0.8, 0.05, 0.05, this.center());
    }
    if (A.bits) this.rtsAethBitsTick();
    // 共鳴光環（原型體）：15 m 內己方的生體單位每秒回復 3
    if (D.aura && !(A.auraT > R.t)) {
      A.auraT = R.t + 0.5;
      for (const a of g.rtsNear(this.pos.x, this.pos.z, D.aura.r + 2)) {
        if (a.dead || a.bld || a.rtsTeam !== this.rtsTeam || !a.rtsMods) continue;
        const AD = RTS_DEFS[a.rtsDef];
        if (D.aura.bio && !(AD && AD.bio)) continue;
        if (Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) > D.aura.r) continue;
        g.rtsBuff(a, { src: 'reso', regen: D.aura.regen }, 0.6);
      }
    }
    // 自動纏附：交戰中的目標或 8 m 內最近的地面敵人
    if (
      this.rtsAuto &&
      this.rtsAuto.ab_latch &&
      (D.abil || []).includes('ab_latch') &&
      !(A.scanT > R.t) &&
      this.rtsAbReady('ab_latch')
    ) {
      A.scanT = R.t + 0.3;
      const t = this.rtsAethLatchTarget(e);
      if (t) this.rtsAbCast('ab_latch', { id: t.id, x: t.pos.x, z: t.pos.z });
    }
    return false;
  },

  // ---------- 技能（rtsAbCast 轉來；true＝施放了） ----------
  rtsAethAb(ab, o = {}) {
    const g = this.game,
      R = g.rts;
    if (!R || this.dead) return false;
    const tgt = o.id !== undefined ? g.rtsEnt(o.id) : null;
    switch (ab) {
      case 'ab_latch': {
        const t = tgt && this.rtsAethLatchOk(tgt) ? tgt : this.rtsAethLatchTarget(null, o);
        if (!t) {
          if (this.rtsTeam === 0 && g.rtsSay && o.id !== undefined)
            g.rtsSay('纏附：目標不能纏（建築、空中或已經被纏住）');
          return false;
        }
        return this.rtsAethLatchStart(t);
      }
      case 'ab_decoy':
        return this.rtsAethDecoy(tgt);
      case 'ab_overcharge': {
        const A = this.rtsAeth || (this.rtsAeth = { mNext: 0, atkT: 0, castT: 0 });
        g.rtsBuff(this, { src: 'oc', rof: OC.rof }, OC.t);
        A.ocEnd = R.t + OC.t;
        if (g.rtsFxOk(this.center())) {
          g.fx.flash(this.center(), 2.4, CORAL_CYAN, 0.3);
          g.fx.ring(this.pos.clone().setY(this.pos.y + 0.3), 3, CORAL_CYAN);
        }
        SFX.play('charge', 0.5, 1.3, 0.05, 0.05, this.center());
        return true;
      }
      case 'ab_bits': {
        if (!tgt || tgt.dead || !this.rtsHostileOk(tgt)) return false;
        const A = this.rtsAeth || (this.rtsAeth = { mNext: 0, atkT: 0, castT: 0 });
        A.bits = { id: tgt.id, end: R.t + BITS.t, next: R.t, i: 0, a0: (this.id % 7) * 0.9 };
        SFX.play('charge', 0.4, 1.6, 0.05, 0.05, this.center());
        return true;
      }
      case 'ab_devour': {
        if (!tgt || tgt.dead || tgt.rtsDef !== 'a_blob' || tgt.rtsTeam !== this.rtsTeam || tgt.rtsIllus) {
          if (this.rtsTeam === 0 && g.rtsSay) g.rtsSay('吞噬：目標要是己方的實驗體');
          return false;
        }
        if (Math.hypot(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z) > 6 + this.radius + tgt.radius)
          return false;
        const c = tgt.center();
        tgt.rtsQuiet = true;
        tgt.die(null);
        this.hp = Math.min(this.maxHp, this.hp + DEVOUR.hp);
        g.rtsBuff(this, { src: 'devour', dmg: DEVOUR.dmg }, DEVOUR.t);
        if (this.rtsAeth) this.rtsAeth.atkT = 0.4;
        if (g.rtsFxOk(c)) {
          g.fx.flash(c, 2.4, 0xff4a3a, 0.3);
          g.fx.beam(c, this.center(), 0xff6050, 0.25);
          g.fx.flash(this.center(), 3, CORAL_CYAN, 0.35);
        }
        SFX.play('slam', 0.5, 0.7, 0.05, 0.05, c);
        if (g.rtsRecount) g.rtsRecount();
        return true;
      }
    }
    return false;
  },

  // ---------- 纏附 ----------
  rtsAethLatchOk(t) {
    const g = this.game;
    if (!t || t.dead || t.bld || t.flying || t.rtsInv || !this.rtsHostileOk(t)) return false;
    if (
      t.rtsLatchBy &&
      t.rtsLatchBy !== this &&
      !t.rtsLatchBy.dead &&
      t.rtsLatchBy.rtsAeth &&
      t.rtsLatchBy.rtsAeth.latch
    )
      return false;
    // 英雄的 ACS 穩定器抵消（C 包的道具；冷卻中照樣抵消）
    if (t.hero && g.rtsHeroHas && g.rtsHeroHas(t.hero, 'i_stab')) return false;
    return true;
  },
  // 8 m 內可以纏的：優先交戰中的目標，其次最近的
  rtsAethLatchTarget(pref, at) {
    const r = 8;
    if (pref && this.rtsAethLatchOk(pref) && this.rtsDistTo(pref) <= r) return pref;
    let best = null,
      bd = 1e9;
    const x = at && at.x !== undefined ? at.x : this.pos.x,
      z = at && at.z !== undefined ? at.z : this.pos.z;
    for (const t of this.game.rtsNear(x, z, r + 4)) {
      if (!this.rtsAethLatchOk(t)) continue;
      const d = this.rtsDistTo(t);
      if (d <= r && d < bd) ((bd = d), (best = t));
    }
    return best;
  },
  rtsAethLatchStart(t) {
    const g = this.game,
      R = g.rts,
      A = this.rtsAeth || (this.rtsAeth = { mNext: 0, atkT: 0, castT: 0 });
    A.leap = { t: 0, x0: this.pos.x, z0: this.pos.z, ent: t };
    t.rtsLatchBy = this;
    this.noPush = true;
    A.castT = R.t + 0.6;
    SFX.play('swing', 0.5, 1.4, 0.05, 0.05, this.center());
    return true;
  },
  // 撲上（0.4 秒）：水平直線、模型（torso）畫一段拋物線
  rtsAethLeap(dt) {
    const g = this.game,
      A = this.rtsAeth,
      L = A.leap;
    const t = L.ent;
    if (!t || t.dead || t.bld) return this.rtsAethLatchEnd(false);
    L.t += dt;
    const f = Math.min(1, L.t / LATCH.leap);
    const p = this.rtsAethLatchSpot(t);
    this.pos.x = lerp(L.x0, p.x, f);
    this.pos.z = lerp(L.z0, p.z, f);
    this.vel.set(0, 0, 0);
    this.rtsAethFace(t);
    this.rtsAethLift(Math.sin(f * Math.PI) * 2.2 + f * this.rtsAethLatchH(t));
    if (f >= 1) {
      A.leap = null;
      A.latch = { ent: t, end: g.rts.t + LATCH.max, next: g.rts.t, x: t.pos.x, z: t.pos.z };
      A.atkT = 0.3;
      if (g.rtsFxOk(this.center())) g.fx.flash(t.center(), 1.4, 0xff5040, 0.2);
      SFX.play('slam', 0.4, 1.3, 0.05, 0.05, t.center());
    }
    return true;
  },
  // 黏在目標的背後（目標的中心往後 0.4×半徑），模型抬到目標身上
  rtsAethLatchSpot(t) {
    const k = (t.radius || 1) * 0.4;
    return { x: t.pos.x + Math.sin(t.yaw) * k, z: t.pos.z + Math.cos(t.yaw) * k };
  },
  rtsAethLatchH(t) {
    return Math.max(0.6, ((t.model && t.model.height) || 3) * (t.scale || 1) * 0.45);
  },
  rtsAethFace(t) {
    const dx = t.pos.x - this.pos.x,
      dz = t.pos.z - this.pos.z;
    if (dx * dx + dz * dz > 1e-4) this.yaw = this.aimYaw = Math.atan2(-dx, -dz);
    else this.yaw = this.aimYaw = t.yaw;
  },
  // 模型的上下位移（torso；合併後是骨頭，所以照樣動）
  rtsAethLift(h) {
    const tor = this.model && this.model.torso,
      A = this.rtsAeth;
    if (!tor || !A || A.ty === undefined) return;
    tor.position.y = A.ty + h / (this.mesh.scale.x || 1); // 世界的高度換成模型座標
  },
  // 纏附中：每 0.5 秒 8 傷害（'none'）、目標緩速與降射速；8 秒、目標死亡、目標變成不能纏（被移走等）時結束
  rtsAethLatch() {
    const g = this.game,
      R = g.rts,
      A = this.rtsAeth,
      L = A.latch;
    const t = L.ent;
    if (!t || t.dead) {
      // 研究「寄生孵化」：目標死亡時在原地出現一隻實驗體（人口不夠時不出現；幻象、建築不算）
      if (t && t.dead && !t.rtsIllus && g.rtsResLv(this.rtsTeam, 'r_brood')) this.rtsAethBrood(L.x, L.z);
      return this.rtsAethLatchEnd(true);
    }
    L.x = t.pos.x;
    L.z = t.pos.z;
    if (R.t >= L.end || t.flying || !this.rtsHostileOk(t)) return this.rtsAethLatchEnd(true);
    const p = this.rtsAethLatchSpot(t);
    this.pos.x = p.x;
    this.pos.z = p.z;
    this.vel.set(0, 0, 0);
    this.rtsAethFace(t);
    this.rtsAethLift(this.rtsAethLatchH(t));
    while (L.next <= R.t) {
      L.next += LATCH.tick;
      g.rtsBuff(t, { src: 'latch', speed: LATCH.speed, rof: LATCH.rof }, LATCH.tick + 0.15);
      g.rtsHit(t, LATCH.dps * LATCH.tick * this.dmgMul, 0, this, 'none');
      A.atkT = 0.2;
      if (g.rtsFxOk(this.center()) && Math.random() < 0.5) g.fx.spark(t.center(), 0xff5040);
      if (t.dead) break;
    }
    return true;
  },
  rtsAethLatchEnd(fell) {
    const A = this.rtsAeth;
    const t = A.leap ? A.leap.ent : A.latch ? A.latch.ent : null;
    if (t && t.rtsLatchBy === this) t.rtsLatchBy = null;
    A.leap = null;
    A.latch = null;
    this.noPush = false;
    this.rtsAethLift(0);
    if (fell && this.rt) this.rt.engage = null;
    return false;
  },
  rtsAethBrood(x, z) {
    const g = this.game,
      R = g.rts,
      T = R.teams[this.rtsTeam];
    const D = RTS_DEFS.a_blob;
    if (!T || !D) return null;
    g.rtsRecount();
    if (T.pop + (D.pop || 1) > T.cap) return null;
    const e = g.rtsSpawn(this.rtsTeam, 'a_blob', x, z, this.yaw);
    if (!e) return null;
    R.stats[this.rtsTeam].made--; // 孵化不算生產
    e.rtsBrood = true;
    g.rtsRecount();
    if (g.rtsFxOk(e.center())) {
      g.fx.flash(e.center(), 1.8, 0xff4a3a, 0.3);
      g.fx.ring(e.pos.clone().setY(e.pos.y + 0.2), 2, 0xff4a3a);
    }
    return e;
  },

  // ---------- 投影 ----------
  rtsAethDecoy(t) {
    const g = this.game,
      R = g.rts;
    if (!t || t.dead || t.bld || t.rtsTeam !== this.rtsTeam || !g.rtsIllusion) return false;
    const up = g.rtsResLv(this.rtsTeam, 'r_holo') ? 1 : 0;
    const n = DECOY.n[up],
      sec = DECOY.sec[up];
    // 幻象跟著目標的指令（交戰中＝打同一個目標）
    const o0 = t.orders && t.orders[0];
    const eng = t.rt && t.rt.engage && !t.rt.engage.dead ? t.rt.engage : null;
    const ord = eng
      ? { k: 'attack', id: eng.id }
      : o0 && ['move', 'amove', 'attack', 'patrol', 'hold'].includes(o0.k)
        ? { ...o0, flow: null, sx: undefined, sz: undefined }
        : null;
    const made = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (this.id % 5);
      const x = t.pos.x + Math.cos(a) * DECOY.r,
        z = t.pos.z + Math.sin(a) * DECOY.r;
      const e = g.rtsIllusion(t, x, z, { sec, dmg: 0, hp: 1 });
      if (!e) continue;
      made.push(e);
      if (ord && g.rtsSetOrders) g.rtsSetOrders(e, [{ ...ord }]);
      if (g.rtsFxOk(e.center())) {
        g.fx.beam(this.center().add(_v.set(0, 1.2, 0)), e.center(), 0x60fff0, 0.08);
        g.fx.flash(e.center(), 1.4, 0x60fff0, 0.25);
      }
    }
    if (!made.length) return false;
    if (this.rtsAeth) this.rtsAeth.castT = R.t + 1.2;
    SFX.play('glitch', 0.5, 1.1, 0.05, 0.05, this.center());
    return true;
  },

  // ---------- 浮游砲展開 ----------
  rtsAethBitsTick() {
    const g = this.game,
      R = g.rts,
      B = this.rtsAeth.bits;
    const t = g.rtsEnt(B.id);
    if (!t || t.dead || R.t >= B.end || !this.rtsHostileOk(t)) {
      this.rtsAeth.bits = null;
      return;
    }
    const gap = 1 / BITS.n;
    while (B.next <= R.t) {
      B.next += gap;
      const a = B.a0 + (B.i % BITS.n) * ((Math.PI * 2) / BITS.n) + R.t * 1.4;
      B.i++;
      const c = t.center();
      const r = (t.radius || 1) + 3;
      _w.set(c.x + Math.cos(a) * r, c.y + 2.6, c.z + Math.sin(a) * r);
      if (g.rtsFxOk(c)) {
        g.fx.beam(_w.clone(), c, CORAL_CYAN, 0.07);
        g.fx.flash(_w.clone(), 0.5, CORAL_CYAN, 0.1);
      }
      g.rtsHit(t, BITS.dmg * this.dmgMul, 0, this, 'en');
      if (t.dead) break;
    }
  },

  // ---------- 近戰（rtsFire 在轉向完成後轉來） ----------
  rtsAethMelee(t, dt, D) {
    const g = this.game,
      R = g.rts,
      M = D.melee,
      A = this.rtsAeth || (this.rtsAeth = { mNext: 0, atkT: 0, castT: 0 });
    if (!R || !t || t.dead) return;
    if (this.rtsDistTo(t) > M.r + 0.3) return; // rtsFight 在快到射程時也會呼叫（邊走邊打）：近戰要真的搆得到
    if (R.t < A.mNext) return;
    const gap = M.rof * (this.rtsRofK || 1);
    const late = Math.min(gap, Math.max(0, R.t - A.mNext));
    A.mNext = R.t + gap - (A.mNext > 0 ? late : 0);
    const dmg = (D.dps || 0) * M.rof * this.dmgMul;
    const atk = D.atk || 'kin';
    g.rtsHit(t, dmg, 0, this, atk);
    A.hits = (A.hits || 0) + 1;
    if (M.splash > 0) {
      for (const u of g.rtsNear(t.pos.x, t.pos.z, M.splash + 6).slice()) {
        if (u === t || u.dead || u.flying || !this.rtsHostileOk(u)) continue;
        const d = u.shape
          ? targetDist(u, t.pos)
          : Math.max(0, Math.hypot(u.pos.x - t.pos.x, u.pos.z - t.pos.z) - (u.radius || 1));
        if (d <= M.splash) g.rtsHit(u, dmg * 0.5, 0, this, atk);
      }
    }
    A.atkT = 0.28;
    const c = t.center();
    if (g.rtsFxOk(c)) {
      const en = atk === 'en';
      const col = en ? CORAL_CYAN : 0xff5040;
      g.fx.spark(c, col);
      g.fx.spark(c, col);
      if (M.splash > 0) {
        g.fx.flash(c, M.splash * 0.5, col, 0.12);
        g.fx.ring(t.pos.clone().setY(t.pos.y + 0.25), M.splash, col);
      }
      SFX.play(en ? 'charge' : 'slam', 0.25, en ? 1.8 : 1.5, 0.08, 0.06, c);
    }
  },

  // ---------- 雷射網（rtsTowerAI 轉來；true＝處理了） ----------
  rtsAethTower(t, gun, dmg, top) {
    if (this.rtsDef !== 'a_fence') return false;
    const g = this.game,
      R = g.rts;
    const c = t.center();
    const from = this.model.muzzle
      ? this.model.muzzle.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(this.pos.x, top, this.pos.z);
    if (g.rtsFxOk(from) || g.rtsFxOk(c)) {
      g.fx.beam(from, c, CORAL_CYAN, 0.09);
      g.fx.flash(c, 0.6, CORAL_CYAN, 0.08);
    }
    SFX.shot('laser', undefined, from);
    g.rtsHit(t, dmg, 0, this, gun.atk || 'en');
    // 警報：揭露攻擊者的位置（20 秒一次）
    if (!(this.rtsAlarmT > R.t)) {
      this.rtsAlarmT = R.t + ALARM.cd;
      this.rtsAlarms = (this.rtsAlarms || 0) + 1;
      if (g.rtsFogReveal) g.rtsFogReveal(this.rtsTeam, t.pos.x, t.pos.z, ALARM.r, ALARM.t);
      if (this.rtsTeam === 0) {
        if (g.rtsEvent) g.rtsEvent(t.pos.x, t.pos.z, '雷射網警報：發現入侵者', 0xff6a5a);
        else if (g.rtsSay) g.rtsSay('雷射網警報：發現入侵者');
      }
      if (g.rtsFxOk(this.pos)) g.fx.ring(this.pos.clone().setY(this.pos.y + 0.4), 6, 0xff5040);
      SFX.play('bell', 0.35, 1.2, 0.05, 0.3, this.center());
    }
    return true;
  },

  // ---------- 融合的引導外觀（rts-grid.js 的 rtsFuseTick：開始引導時） ----------
  rtsAethFuseFx(F, sec) {
    const g = this.game,
      R = g.rts;
    const A = this.rtsAeth || (this.rtsAeth = { mNext: 0, atkT: 0, castT: 0 });
    A.fuseT = R.t + sec;
    const big = F && F.to === 'a_proto';
    const r = (this.radius || 1) + (big ? 1.4 : 0.8);
    const base = this.pos.clone();
    // 包住宿主的發光繭（加色、慢慢收緊、脈動），結束時閃光
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.55, r, big ? 5 : 3, 14, 1, true),
      new THREE.MeshBasicMaterial({
        color: CORAL_CYAN,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    m.position.set(base.x, base.y + (big ? 2.5 : 1.5), base.z);
    g.fx.add(m, sec, (e, t) => {
      e.mesh.position.set(this.pos.x, this.pos.y + (big ? 2.5 : 1.5), this.pos.z);
      e.mesh.rotation.y += 0.05;
      const k = 1 - 0.35 * t;
      e.mesh.scale.set(k, 1 + 0.15 * Math.sin(t * 30), k);
      e.mesh.material.opacity = (0.1 + 0.12 * Math.abs(Math.sin(t * 18))) * (t > 0.92 ? (1 - t) / 0.08 : 1);
      if (t >= 1 || this.dead) {
        e.mesh.geometry.dispose();
        e.mesh.material.dispose();
      }
    });
    if (g.rtsFxOk(base)) {
      g.fx.ring(base.clone().setY(base.y + 0.3), r + 1.5, CORAL_CYAN);
      g.fx.flash(this.center(), r, CORAL_CYAN, 0.3);
    }
    SFX.play('charge', 0.5, big ? 0.7 : 0.9, 0.05, 0.05, this.center());
  },

  // ---------- 模型的動作（specialFx 的實例覆寫，每格） ----------
  // 全像投影器、寄生纏附體（ai 是 'rts'，mech-foe-c1.js 的動作不會跑）
  rtsAethAnim(dt) {
    const m = this.model,
      A = this.rtsAeth,
      R = this.game.rts;
    if (!m || !R) return;
    const t = this.t,
      k = Math.min(1, dt * 8);
    if (m.type === 'holoproj') {
      const cast = A.castT > R.t;
      if (m.cRing) m.cRing.rotation.y += dt * (cast ? 9 : 0.8);
      for (const p of m.cPetals || []) p.rotation.x = lerp(p.rotation.x, cast ? -0.9 : 0, k);
      if (m.cHead) m.cHead.position.y = 2.75 + Math.sin(t * 1.6) * 0.04;
      if (m.cCone) m.cCone.visible = !!cast;
      if (m.cGlow) m.cGlow.emissiveIntensity = lerp(m.cGlow.emissiveIntensity, cast ? 3.2 : 0.8, k);
    } else if (m.type === 'parasite') {
      const latched = !!A.latch,
        leap = !!A.leap,
        bite = A.atkT > 0;
      if (m.cGlow)
        m.cGlow.emissiveIntensity = lerp(m.cGlow.emissiveIntensity, latched ? 3 : leap ? 2.4 : 0.8, k);
      if (m.cBody) m.cBody.rotation.z = latched ? Math.sin(t * 25) * 0.12 : lerp(m.cBody.rotation.z, 0, k);
      for (const [i, j] of (m.cJaws || []).entries())
        j.rotation.y = lerp(j.rotation.y, (i ? -1 : 1) * (bite || leap ? 0.6 : 0.1 * Math.sin(t * 4)), k);
      const mv = Math.hypot(this.vel.x, this.vel.z) > 1;
      for (const L of m.cLegs || []) {
        const sd = (L.userData && L.userData.side) || 1,
          ph = (L.userData && L.userData.ph) || 0;
        if (latched || leap) L.rotation.z = lerp(L.rotation.z, sd * 0.9, k);
        else L.rotation.z = lerp(L.rotation.z, mv ? sd * Math.sin(t * 18 + ph) * 0.3 : 0, k);
        L.rotation.y = mv && !latched ? Math.sin(t * 18 + ph + 1.2) * 0.35 : 0;
      }
      if (m.cSpine) m.cSpine.scale.y = latched ? 1 + Math.sin(t * 12) * 0.12 : 1;
    }
  },
});
