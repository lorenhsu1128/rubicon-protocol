// Coral 戰爭（RTS）維爾威動態的兵種行為（MechEntity 擴充，docs/rts-design.md 15.2、15.3、15.12；R4 B 包），
// 以及投放艙、物流無人機的外觀（Game 的 rtsVeerPodFx／rtsVeerHaulFx，game/rts-veer.js 呼叫）。
// mech-rts.js 的分派：rtsAbInit 結尾 rtsVeerInit(D)、rtsAbTick 開頭 rtsVeerTick(dt, D)（true＝這一格不動也不開火）、
// rtsAbCast 認不得的技能 rtsVeerAb(ab, o)（true＝施放了，費用與冷卻由 rtsAbCast 扣）、rtsTowerAI 開頭 rtsVeerTower(dt)。
// game/rts-veer.js 的掛勾：空投運輸機的飛行 rtsVeerCarrierMove、放下地基 rtsVeerCargoDrop、登機 rtsVeerBoarded、
// 收好的建築的飛行 rtsVeerPackMove。
// - 長程推進（宇宙用 MT）：1.5 秒的拋物線（期間是低空：flying＋rtsLow，地面與對空的武器都打得到），落點＝最近的可以走的格子
//   （可以是和主基地不連通的高台），落地 3 m 40 爆發；研究長程推進後 40 m、冷卻 12。
// - 衝撞（衝撞無人機，自動施放預設開）：預警線 0.6 秒 → 沿線衝 18 m，第一個碰到的 90 實彈＋擊退 6 m＋暈眩 0.5 秒（建築 ×0.5、
//   不擊退）；撞到障礙物停下。
// - 機動迴避（攻擊直升機）：3 秒受到的傷害 ×0.5、速度 ×1.4。臨時信標（偵察無人機）：降落變成 40 秒的臨時投放信標（消耗）。
// - 高速突擊機：不能停在空中——移動的方向有轉向速度上限（實例覆寫的 move），沒有移動指令時繞圈；交戰（實例覆寫的 rtsFight）
//   ＝直衝目標、機頭朝著目標的錐形內才開火，衝過頭再繞回來（實際 dps 約定義的 70%）。掃射：預警線 1 秒後沿 30 m 直線
//   10 發各 40 實彈（範圍 2 m），之後 2 秒速度 ×0.6；研究後燃器後冷卻 11。
// - 飛彈防禦塔（v_sam）：空中與低空的目標優先（射程 38、dps 26），其次地面（groundRange 30、groundDps 10）；穿甲飛彈的外觀是
//   粒子批次的彈體，飛行時間後以 rtsHit 命中（不會打偏）。
// 只在房主／單機（RTS 沒有多人）；技能的時間以局內時間 R.t 計。
import { MechEntity } from './mech-entity.js';
import { Game } from '../game/game.js';
import { SFX } from '../audio/audio.js';
import { asmStats } from '../data/parts.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { RTS_VEER } from '../data/rts-veerwell.js';
import { buildBossModel } from '../render/boss-models.js';
import { buildDrone, buildHeli } from '../render/vehicle-models.js';
import { rtsPal } from '../render/rts-models.js';
import {
  VEER_LIME,
  addCarrierCargo,
  buildDropPod,
  buildHaulDrone,
  buildTempBeacon,
} from '../render/rts-veer-models.js';

const JUMP = { t: 1.5, r: [30, 40], cd: [20, 12], h: 6, splash: 3, dmg: 40 };
const RAM = { warn: 0.6, len: 18, speed: 42, dmg: 90, kb: 6, stun: 0.5, bld: 0.5, scan: 0.3 };
const EVADE = { t: 3, taken: 0.5, speed: 1.4 };
const STRAFE = { warn: 1, len: 30, n: 10, dmg: 40, r: 2, gap: 0.08, slow: 0.6, slowT: 2, cd: [16, 11] };
const JET = { turn: 2.6, cone: 1.0, idle: 0.75, burst: 1.9 }; // 轉向（弧度／秒）、開火的錐形（弧度）、沒有指令時的速度、
// 通過目標上空時的傷害倍率（開火的時間約 37%，所以平均約定義的 70%：docs 15.3）
const RELAY = { t: 40 };
const SAM_V = 70; // 飛彈的速度（外觀與飛行時間）
const POD_FALL = 1.1; // 投放艙落下的最後幾秒才看得到
const POD_STAY = 3; // 落地後幾秒縮小消失
const ZERO = new THREE.Vector3();
const _w = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _Z = new THREE.Vector3(0, 0, 1);
const PROTO_MOVE = MechEntity.prototype.move;

// ---------- 實例覆寫（rtsVeerInit 設定） ----------
// 移動：推進跳躍與衝撞中位置由技能決定（照常跑一次物理與動作，之後改回技能的位置）；突擊機的方向有轉向上限
function veerMove(dt, wish, wantHover, wantQB, wantAB, tgt) {
  if (this.dead) return; // 臨時信標：施放的那一格無人機就移除了
  const V = this.rtsVeer;
  if (!V || !this.game.rts) return PROTO_MOVE.call(this, dt, wish, wantHover, wantQB, wantAB, tgt);
  if (V.jump || (V.ram && V.ram.st === 'dash')) {
    PROTO_MOVE.call(this, dt, ZERO, false, false, false, null);
    if (V.at) {
      this.pos.copy(V.at);
      this.vel.copy(V.vel || ZERO);
      this.mesh.position.copy(this.pos);
      this.grounded = false;
    }
    return;
  }
  if (V.jet) {
    const r = PROTO_MOVE.call(
      this,
      dt,
      this.rtsVeerJetWish(wish, this.aiFrame || dt),
      false,
      false,
      false,
      null,
    );
    // 機頭一律朝著飛行的方向（不轉向目標）
    this.yaw = this.aimYaw = Math.atan2(-V.jet.hx, -V.jet.hz);
    this.mesh.rotation.y = this.yaw;
    return r;
  }
  return PROTO_MOVE.call(this, dt, wish, wantHover, wantQB, wantAB, tgt);
}
// AI 分批：技能進行中、突擊機每格都跑
function veerBatchable() {
  const V = this.rtsVeer;
  if (V && (V.jump || V.ram || V.strafe || V.jet)) return false;
  return MechEntity.prototype.aiBatchable.call(this);
}
// 施放：研究改變的冷卻（長程推進 20 → 12、掃射 16 → 11）在 rtsAbCast 扣完之後改
function veerAbCast(ab, o) {
  const r = MechEntity.prototype.rtsAbCast.call(this, ab, o);
  const V = this.rtsVeer,
    R = this.game.rts;
  if (V && V.cdFix && R) {
    if (V.cdFix.ab === ab && this.rtsCd) this.rtsCd[ab] = R.t + V.cdFix.cd;
    V.cdFix = null;
  }
  return r;
}
// 突擊機的交戰：直衝目標，機頭朝著目標（錐形內）才開火
function jetFight(t, dt, D, chase) {
  const range = this.rtsRange(D);
  if (!this.rtsAbCanHit(D, t)) return 'out';
  const d = this.rtsDistTo(t);
  if (!chase && d > range) return 'out';
  const V = this.rtsVeer,
    J = V && V.jet;
  const dx = t.pos.x - this.pos.x,
    dz = t.pos.z - this.pos.z;
  const L = Math.hypot(dx, dz) || 1;
  this.rt.wish.set(dx / L, 0, dz / L);
  if (J && d <= range && (J.hx * dx + J.hz * dz) / L > Math.cos(JET.cone) && !this.rtsLosBlocked(t)) {
    const dm = this.dmgMul;
    this.dmgMul = dm * JET.burst;
    this.rtsFire(t, D);
    this.dmgMul = dm;
    this.rt.face = null; // 機頭不轉向目標
    J.fireT = (J.fireT || 0) + (this.game.rts.dt || 0);
  }
  return d <= range ? 'fire' : 'chase';
}

// RTS 的鏡頭看不到的加色噴焰錐（偵察無人機、宇宙用 MT、突擊機的 nozzles 是半透明的獨立網格，每個多一個 draw call）：
// 不畫（推進器的光暈是 thrusterFx 另外畫的，照常）
function slimNozzles(rig) {
  for (const n of (rig && rig.nozzles) || [])
    if (n.isMesh && n.material && n.material.transparent) n.visible = false;
}

Object.assign(MechEntity.prototype, {
  // 換成 RTS 定義的外觀（效能基準 scripts/rts-bench.js 的 --faction：一般任務的實體換上維爾威兵種真正的模型；
  // 行為照原本的 AI）。team＝隊伍色（0 藍、1 紅）
  rtsVeerReskin(defId, team = 0) {
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
          : D.modelKind === 'heli'
            ? buildHeli(pal, this.scale, D.vehKey || 'heli')
            : this.buildRig(true);
    if (D.cargo || D.carrier) addCarrierCargo(this.model, null);
    if (this.model.rtsCargo && !D.carrier) this.model.rtsCargo.visible = false;
    slimNozzles(this.model);
    // 一般任務的運輸機 AI 會投放增援（spawnEnemy），效能基準的編成不能自己變多：改成直升機的 AI
    if (D.cargo && this.ai === 'dropship') this.ai = 'heli';
    this.mergeModel(this.model);
    const old = this.mesh;
    this.mesh = this.model.group;
    this.mesh.position.copy(old.position);
    this.mesh.rotation.copy(old.rotation);
    g.scene.add(this.mesh);
    return true;
  },
  // 定義換了（第一次 rtsUnitAI、空投運輸機生成時 A 直接呼叫 rtsAbInit）：狀態與實例覆寫
  rtsVeerInit(D) {
    if (!D || D.faction !== 'veerwell' || D.kind !== 'unit' || D.hero) {
      this.rtsVeer = null;
      return;
    }
    const V = this.rtsVeer || (this.rtsVeer = {});
    if (!V.slim) {
      V.slim = true;
      slimNozzles(this.model);
    }
    if (!Object.prototype.hasOwnProperty.call(this, 'move')) this.move = veerMove;
    if (!Object.prototype.hasOwnProperty.call(this, 'aiBatchable')) this.aiBatchable = veerBatchable;
    if (!Object.prototype.hasOwnProperty.call(this, 'rtsAbCast')) this.rtsAbCast = veerAbCast;
    const g = this.game;
    if (D.carrier && this.model && !this.model.rtsCargo) {
      const rec = g.rtsDropOf && this.rtsDrop ? g.rtsDropOf(this.rtsDrop) : null;
      addCarrierCargo(this.model, rec ? rec.def : null);
    }
    if (D.cargo && this.model && !this.model.rtsCargo) {
      addCarrierCargo(this.model, null);
      this.model.rtsCargo.visible = false;
    }
    if (D.id === 'v_jet' && !V.jet) {
      V.jet = { hx: -Math.sin(this.yaw), hz: -Math.cos(this.yaw), fireT: 0 };
      if (!Object.prototype.hasOwnProperty.call(this, 'rtsFight')) this.rtsFight = jetFight;
    }
  },

  // ---------- 每格（rtsAbTick 開頭；true＝這一格不動也不開火） ----------
  rtsVeerTick(dt, D) {
    const V = this.rtsVeer;
    if (!V) return false;
    const g = this.game,
      R = g.rts;
    // 物流 MT：採集、修理時吊鉤放下
    if (D.worker && this.model.setHook) {
      const o = this.orders[0];
      const want = (this.rt.gp === 'mine' && o && o.k === 'gather') || (o && o.k === 'repair') ? 1 : 0;
      V.hook = (V.hook || 0) + (want - (V.hook || 0)) * Math.min(1, dt * 4);
      if (Math.abs(V.hookSet - V.hook) > 0.01 || V.hookSet === undefined) {
        V.hookSet = V.hook;
        this.model.setHook(V.hook);
      }
    }
    // 運輸機：載著單位時顯示吊掛的貨櫃
    if (D.cargo && this.model.rtsCargo) {
      const on = !!(this.cargo && this.cargo.length);
      if (this.model.rtsCargo.visible !== on) this.model.rtsCargo.visible = on;
    }
    if (V.jump) return this.rtsVeerJumpTick();
    if (V.ram) return this.rtsVeerRamTick();
    if (V.strafe && R.t > V.strafe.end) V.strafe = null;
    // 長程推進的指令：研究後的射程（40 m）以內直接跳（rtsAbOrder 只會走到定義的 30 m）
    const o = this.orders[0];
    if (o && o.k === 'ability' && o.ab === 'ab_vjump' && o.x !== undefined) {
      const r = this.rtsVeerJumpR();
      if (Math.hypot(o.x - this.pos.x, o.z - this.pos.z) <= r && !this.rtsAbWhy('ab_vjump')) {
        this.orders.shift();
        this.rtsAbCast('ab_vjump', { x: o.x, z: o.z });
        if (V.jump) return true;
      }
    }
    // 自動衝撞：交戰中的目標或 18 m 內最近的
    if (
      this.rtsAuto &&
      this.rtsAuto.ab_ram &&
      (D.abil || []).includes('ab_ram') &&
      !(V.scanT > R.t) &&
      this.rtsAbReady('ab_ram')
    ) {
      V.scanT = R.t + RAM.scan;
      const t = this.rtsVeerRamTarget(this.rt && this.rt.engage);
      if (t) this.rtsAbCast('ab_ram', { id: t.id, x: t.pos.x, z: t.pos.z });
      if (this.rtsVeer.ram) return true;
    }
    return false;
  },

  // ---------- 技能（rtsAbCast 轉來；true＝施放了） ----------
  rtsVeerAb(ab, o = {}) {
    const g = this.game,
      R = g.rts;
    if (!R || this.dead) return false;
    const V = this.rtsVeer || (this.rtsVeer = {});
    switch (ab) {
      case 'ab_relay': {
        // 降落並變成臨時投放信標（無人機消耗）
        if (!g.rtsBeaconAddTemp) return false;
        const x = this.pos.x,
          z = this.pos.z;
        g.rtsBeaconAddTemp(this.rtsTeam, x, z, RELAY.t);
        g.rtsVeerTempBeaconFx(this.rtsTeam, x, z, RELAY.t);
        if (g.rtsFxOk(this.center())) g.fx.flash(this.center(), 1.6, VEER_LIME, 0.25);
        SFX.play('door', 0.4, 1.4, 0.05, 0.03, this.center());
        this.rtsQuiet = true;
        this.die(null);
        if (g.rtsRecount) g.rtsRecount();
        return true;
      }
      case 'ab_vjump':
        return this.rtsVeerJumpStart(o.x, o.z);
      case 'ab_evade': {
        g.rtsBuff(this, { src: 'evade', taken: EVADE.taken, speed: EVADE.speed }, EVADE.t);
        V.evadeT = R.t + EVADE.t;
        const c = this.center();
        if (g.rtsFxOk(c)) {
          g.fx.flash(c, 2.2, 0xfff0c0, 0.2);
          for (let i = 0; i < 6; i++) g.fx.spark(c, 0xffd080);
        }
        SFX.play('boost', 0.4, 1.2, 0.05, 0.03, c);
        return true;
      }
      case 'ab_ram': {
        const tgt = o.id !== undefined ? g.rtsEnt(o.id) : null;
        const t = tgt && this.rtsVeerRamOk(tgt) ? tgt : this.rtsVeerRamTarget(null);
        if (!t) {
          if (this.rtsTeam === 0 && g.rtsSay && o.id !== undefined)
            g.rtsSay('衝撞：目標要是 18 m 內的地面或低空單位');
          return false;
        }
        return this.rtsVeerRamStart(t);
      }
      case 'ab_strafe':
        return this.rtsVeerStrafe(o.x, o.z);
    }
    return false;
  },

  // ---------- 長程推進 ----------
  rtsVeerJumpR() {
    return JUMP.r[this.game.rtsResLv(this.rtsTeam, 'r_jump') ? 1 : 0];
  },
  rtsVeerJumpStart(x, z) {
    const g = this.game,
      R = g.rts,
      w = g.world,
      V = this.rtsVeer;
    if (x === undefined || z === undefined) return false;
    // 射程外的點：拉回射程內
    const r = this.rtsVeerJumpR();
    let dx = x - this.pos.x,
      dz = z - this.pos.z;
    const L = Math.hypot(dx, dz);
    if (L > r) {
      x = this.pos.x + (dx / L) * r;
      z = this.pos.z + (dz / L) * r;
    }
    // 落點：最近的可以走的格子（可以是不連通的高台）
    const D = RTS_DEFS[this.rtsDef] || {};
    const c = w.nav ? w.nav.nearestCell(x, z, D.size || 0, -1, 8) : -1;
    if (c >= 0) ({ x, z } = w.nav.center(c));
    const y1 = w.groundAt(x, z, w.terrainHeight(x, z) + 2);
    const y0 = this.pos.y;
    dx = x - this.pos.x;
    dz = z - this.pos.z;
    V.jump = {
      t0: R.t,
      x0: this.pos.x,
      y0,
      z0: this.pos.z,
      x1: x,
      y1,
      z1: z,
      h: JUMP.h + Math.max(0, y1 - y0) * 0.6,
    };
    V.at = this.pos.clone();
    V.vel = new THREE.Vector3();
    this.flying = true; // 低空：地面與對空的武器都打得到（rts-veer.js 的 rtsLowAir 看 rtsLow）
    this.rtsLow = true;
    this.noPush = true;
    if (Math.hypot(dx, dz) > 0.5) this.yaw = this.aimYaw = Math.atan2(-dx, -dz);
    if (g.rtsResLv(this.rtsTeam, 'r_jump')) V.cdFix = { ab: 'ab_vjump', cd: JUMP.cd[1] };
    const p = this.pos.clone();
    if (g.rtsFxOk(p)) {
      g.fx.dust(p, 2.5, 8);
      g.fx.flash(this.center(), 1.8, 0xffc080, 0.2);
    }
    SFX.play('boost', 0.5, 0.9, 0.05, 0.03, p);
    return true;
  },
  rtsVeerJumpTick() {
    const g = this.game,
      R = g.rts,
      V = this.rtsVeer,
      J = V.jump;
    const f = Math.min(1, (R.t - J.t0) / JUMP.t);
    const y = J.y0 + (J.y1 - J.y0) * f + J.h * 4 * f * (1 - f);
    const px = V.at.x,
      py = V.at.y,
      pz = V.at.z;
    V.at.set(J.x0 + (J.x1 - J.x0) * f, y, J.z0 + (J.z1 - J.z0) * f);
    const dt = Math.max(1e-3, R.dt || 0.05);
    V.vel.set((V.at.x - px) / dt, (V.at.y - py) / dt, (V.at.z - pz) / dt);
    this.pos.copy(V.at);
    this.mesh.position.copy(this.pos);
    if (g.rtsFxOk(this.pos) && Math.random() < 0.5)
      g.fx.boostFlame(this.pos.clone(), new THREE.Vector3(0, -1, 0), 0xffb060);
    if (f < 1) return true;
    // 落地：落點 3 m 40 爆發
    V.jump = null;
    V.at = null;
    this.flying = false;
    this.rtsLow = false;
    this.noPush = false;
    this.vel.set(0, 0, 0);
    this.grounded = true;
    this.pos.y = J.y1;
    this.mesh.position.copy(this.pos);
    if (this.rt) {
      this.rt.nav = null;
      this.rt.home = { x: J.x1, z: J.z1 };
    }
    V.jumps = (V.jumps || 0) + 1;
    g.rtsSplash(J.x1, J.z1, JUMP.splash, JUMP.dmg * this.dmgMul, 80, this, 'exp');
    const p = this.pos.clone();
    if (g.rtsFxOk(p)) {
      g.fx.dust(p.clone().setY(p.y + 0.1), JUMP.splash, 10, 0xa09880);
      g.fx.ring(p.clone().setY(p.y + 0.2), JUMP.splash, 0xffc080);
    }
    SFX.play('slam', 0.5, 1.1, 0.05, 0.03, p);
    return false;
  },

  // ---------- 衝撞 ----------
  rtsVeerRamOk(t) {
    if (!t || t.dead || t.rtsInv || !this.rtsHostileOk(t)) return false;
    if (t.flying && !(this.game.rtsLowAir && this.game.rtsLowAir(t))) return false;
    return this.rtsDistTo(t) <= RAM.len;
  },
  rtsVeerRamTarget(pref) {
    if (pref && !pref.bld && this.rtsVeerRamOk(pref)) return pref;
    let best = null,
      bd = 1e9;
    for (const t of this.game.rtsNear(this.pos.x, this.pos.z, RAM.len + 6)) {
      if (t.bld || !this.rtsVeerRamOk(t)) continue;
      const d = this.rtsDistTo(t);
      if (d < bd) ((bd = d), (best = t));
    }
    return best;
  },
  rtsVeerRamStart(t) {
    const g = this.game,
      R = g.rts,
      V = this.rtsVeer;
    let dx = t.pos.x - this.pos.x,
      dz = t.pos.z - this.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const lim = g.world.lim - 4;
    const ex = Math.max(-lim, Math.min(lim, this.pos.x + dx * RAM.len)),
      ez = Math.max(-lim, Math.min(lim, this.pos.z + dz * RAM.len));
    V.ram = {
      st: 'warn',
      t0: R.t,
      x0: this.pos.x,
      z0: this.pos.z,
      dx,
      dz,
      ex,
      ez,
      len: Math.hypot(ex - this.pos.x, ez - this.pos.z),
      id: t.id,
    };
    this.yaw = this.aimYaw = Math.atan2(-dx, -dz);
    const y = this.pos.y;
    const a = new THREE.Vector3(this.pos.x, y, this.pos.z),
      b = new THREE.Vector3(ex, g.world.terrainHeight(ex, ez) + 1, ez);
    if (this.rtsTeam === 0 || !g.rtsFogState || g.rtsFogState(0, this.pos.x, this.pos.z) === 2)
      g.fx.warnLine(a, b, RAM.warn, this.rtsTeam === 0 ? 0xffd040 : 0xff3020, 0.1);
    SFX.play('charge', 0.4, 1.5, 0.05, 0.03, a);
    return true;
  },
  rtsVeerRamTick() {
    const g = this.game,
      R = g.rts,
      w = g.world,
      V = this.rtsVeer,
      M = V.ram;
    if (M.st === 'warn') {
      if (R.t - M.t0 < RAM.warn) return true;
      M.st = 'dash';
      M.t1 = R.t;
      M.s = 0;
      V.at = this.pos.clone();
      V.vel = new THREE.Vector3(M.dx * RAM.speed, 0, M.dz * RAM.speed);
      this.noPush = true;
      SFX.play('boost', 0.5, 1.3, 0.05, 0.03, this.center());
    }
    const s = Math.min(M.len, (R.t - M.t1) * RAM.speed);
    let done = s >= M.len;
    // 沿線前進，檢查每一段（一格可能前進 2 m 以上）
    const step = 0.8;
    let hit = null;
    for (let q = M.s; q <= s + 1e-6 && !hit; q += step) {
      const qq = Math.min(q, s);
      const x = M.x0 + M.dx * qq,
        z = M.z0 + M.dz * qq;
      const [cx, cz] = w.collide(x, z, this.pos.y, this.radius * 0.6);
      if (Math.hypot(cx - x, cz - z) > 0.3) {
        done = true;
        M.s = Math.max(0, qq - step);
        break;
      }
      for (const t of g.rtsNear(x, z, 6)) {
        if (t === this) continue;
        if (t.bld ? !this.rtsHostileOk(t) : !this.rtsVeerRamOk2(t)) continue;
        const d = t.shape
          ? Math.max(0, this.rtsDistAt(t, x, z))
          : Math.hypot(t.pos.x - x, t.pos.z - z) - (t.radius || 1) - this.radius;
        if (d <= 0.2) {
          hit = t;
          M.s = qq;
          break;
        }
      }
      if (!hit) M.s = qq;
    }
    const x = M.x0 + M.dx * M.s,
      z = M.z0 + M.dz * M.s;
    V.at.set(x, this.pos.y, z);
    this.pos.x = x;
    this.pos.z = z;
    this.mesh.position.copy(this.pos);
    if (g.rtsFxOk(this.pos) && Math.random() < 0.6)
      g.fx.boostFlame(this.center(), new THREE.Vector3(-M.dx, 0, -M.dz), 0xffc070);
    if (hit) {
      this.rtsVeerRamHit(hit, M);
      done = true;
    }
    if (!done) return true;
    V.ram = null;
    V.at = null;
    this.noPush = false;
    this.vel.set(M.dx * 4, 0, M.dz * 4);
    if (this.rt) this.rt.nav = null;
    return false;
  },
  // 衝撞也打得到建築（rtsVeerRamOk 只給單位用，這裡同時判斷低空）
  rtsVeerRamOk2(t) {
    if (!t || t.dead || t.rtsInv || !this.rtsHostileOk(t)) return false;
    return !(t.flying && !(this.game.rtsLowAir && this.game.rtsLowAir(t)));
  },
  rtsDistAt(t, x, z) {
    const px = this.pos.x,
      pz = this.pos.z;
    this.pos.x = x;
    this.pos.z = z;
    const d = this.rtsDistTo(t);
    this.pos.x = px;
    this.pos.z = pz;
    return d - this.radius;
  },
  rtsVeerRamHit(t, M) {
    const g = this.game;
    const V = this.rtsVeer;
    V.rams = (V.rams || 0) + 1;
    if (t.bld) g.rtsHit(t, RAM.dmg * RAM.bld * this.dmgMul, 0, this, 'kin');
    else {
      g.rtsHit(t, RAM.dmg * this.dmgMul, 0, this, 'kin');
      if (!t.dead) {
        const nx = t.pos.x + M.dx * RAM.kb,
          nz = t.pos.z + M.dz * RAM.kb;
        if (g.rtsHeroShift) g.rtsHeroShift(t, nx, nz);
        else {
          t.pos.x = nx;
          t.pos.z = nz;
          t.mesh.position.copy(t.pos);
        }
        if (g.rtsStun) g.rtsStun(t, RAM.stun);
        else t.staggerT = Math.max(t.staggerT || 0, RAM.stun);
      }
    }
    const c = t.center ? t.center() : this.center();
    if (g.rtsFxOk(c)) {
      g.fx.explosion(c, 1.6, 0xffc070);
      for (let i = 0; i < 5; i++) g.fx.spark(c, 0xffd080);
    }
    SFX.play('slam', 0.6, 1.2, 0.05, 0.03, c);
  },

  // ---------- 高速突擊機 ----------
  // 移動輸入 → 轉向有上限的方向（速度固定；沒有指令時繞圈）；地圖邊緣往內轉
  rtsVeerJetWish(wish, dt) {
    const V = this.rtsVeer,
      J = V.jet,
      g = this.game,
      R = g.rts;
    let tx, tz, k;
    const S = V.strafe;
    const L = Math.hypot(wish.x, wish.z);
    if (S && R && R.t < S.end) {
      // 掃射：預警中飛向起點、掃射中沿線
      const gx = R.t < S.t1 ? S.ax : S.bx,
        gz = R.t < S.t1 ? S.az : S.bz;
      const dx = gx - this.pos.x,
        dz = gz - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2) {
        tx = dx / d;
        tz = dz / d;
      } else {
        tx = S.dx;
        tz = S.dz;
      }
      k = 1;
    } else if (L > 0.05) {
      tx = wish.x / L;
      tz = wish.z / L;
      k = 1;
    } else {
      // 繞圈：目標方向比目前的往左偏
      tx = J.hx * Math.cos(0.9) - J.hz * Math.sin(0.9);
      tz = J.hx * Math.sin(0.9) + J.hz * Math.cos(0.9);
      k = JET.idle;
    }
    const lim = g.world.lim - 8;
    if (Math.abs(this.pos.x) > lim || Math.abs(this.pos.z) > lim) {
      const d = Math.hypot(this.pos.x, this.pos.z) || 1;
      if (J.hx * this.pos.x + J.hz * this.pos.z > 0) {
        tx = -this.pos.x / d;
        tz = -this.pos.z / d;
      }
    }
    // 轉向：每秒最多 JET.turn 弧度
    const cr = J.hx * tz - J.hz * tx,
      dt0 = J.hx * tx + J.hz * tz;
    const a = Math.atan2(cr, dt0);
    const m = JET.turn * dt;
    const r = Math.max(-m, Math.min(m, a));
    const c = Math.cos(r),
      s = Math.sin(r);
    const nx = J.hx * c - J.hz * s,
      nz = J.hx * s + J.hz * c;
    const n = Math.hypot(nx, nz) || 1;
    J.hx = nx / n;
    J.hz = nz / n;
    return _w.set(J.hx * k, 0, J.hz * k);
  },
  // 掃射：以地點為中心、沿突擊機 → 地點的方向 30 m；預警線 1 秒後 10 發
  rtsVeerStrafe(x, z) {
    const g = this.game,
      R = g.rts,
      w = g.world,
      V = this.rtsVeer;
    if (x === undefined || z === undefined) return false;
    let dx = x - this.pos.x,
      dz = z - this.pos.z;
    const L = Math.hypot(dx, dz);
    if (L < 1) {
      dx = V.jet ? V.jet.hx : -Math.sin(this.yaw);
      dz = V.jet ? V.jet.hz : -Math.cos(this.yaw);
    } else {
      dx /= L;
      dz /= L;
    }
    const h = STRAFE.len / 2;
    const S = {
      ax: x - dx * h,
      az: z - dz * h,
      bx: x + dx * h,
      bz: z + dz * h,
      dx,
      dz,
      t1: R.t + STRAFE.warn,
      end: R.t + STRAFE.warn + STRAFE.n * STRAFE.gap + 0.3,
      hits: 0,
    };
    V.strafe = S;
    if (g.rtsResLv(this.rtsTeam, 'r_burn')) V.cdFix = { ab: 'ab_strafe', cd: STRAFE.cd[1] };
    const A = new THREE.Vector3(S.ax, w.terrainHeight(S.ax, S.az) + 0.4, S.az),
      B = new THREE.Vector3(S.bx, w.terrainHeight(S.bx, S.bz) + 0.4, S.bz);
    if (this.rtsTeam === 0 || !g.rtsFogState || g.rtsFogState(0, x, z) === 2)
      g.fx.warnLine(A, B, STRAFE.warn, this.rtsTeam === 0 ? 0xffd040 : 0xff3020, 0.16);
    const team = this.rtsTeam;
    for (let i = 0; i < STRAFE.n; i++)
      g.later(STRAFE.warn + i * STRAFE.gap, () => {
        if (!g.rts || this.dead) return;
        const f = i / (STRAFE.n - 1);
        const px = S.ax + (S.bx - S.ax) * f,
          pz = S.az + (S.bz - S.az) * f;
        const p = new THREE.Vector3(px, w.terrainHeight(px, pz) + 0.3, pz);
        S.hits += g.rtsSplash(px, pz, STRAFE.r, STRAFE.dmg * this.dmgMul, 60, this, 'kin', team);
        if (g.rtsFxOk(p)) {
          g.fx.beam(this.center(), p, 0xffd080, 0.07);
          g.fx.dust(p, 1.4, 4, 0xa09880);
          g.fx.flash(p, 1.2, 0xffc070, 0.1);
        }
        if (i % 2 === 0) SFX.shot('mg', undefined, p);
        if (i === STRAFE.n - 1) g.rtsBuff(this, { src: 'strafe', speed: STRAFE.slow }, STRAFE.slowT);
      });
    SFX.play('charge', 0.4, 1.3, 0.05, 0.03, this.center());
    return true;
  },

  // ---------- 飛彈防禦塔（rtsTowerAI 開頭；true＝處理了） ----------
  rtsVeerTower(dt) {
    const D = RTS_DEFS[this.rtsDef];
    if (!D || !D.groundDps || this.dead) return false;
    const g = this.game;
    if (this.bld && (this.bld.packed || this.bld.progress < 1)) return true;
    const add = this.rtsRangeAdd || 0;
    const rAir = D.range + add,
      rGnd = (D.groundRange || D.range) + add;
    const st = this.rtw || (this.rtw = { cd: 0.3, scanT: 0, tgt: null });
    st.cd -= dt;
    st.scanT -= dt;
    const air = (t) => !!t.flying;
    const ok = (t) => {
      if (!this.rtsHostileOk(t)) return false;
      const d = this.rtsTowerDist(t);
      return d <= (air(t) ? rAir : rGnd);
    };
    let t = null;
    const o = this.orders && this.orders[0];
    if (o && o.k === 'attack') {
      const a = g.rtsEnt(o.id);
      if (!a || a.dead) this.orders.length = 0;
      else if (ok(a)) t = a;
    }
    if (!t) {
      if (st.tgt && !ok(st.tgt)) st.tgt = null;
      // 有地面目標時每次掃描都看看有沒有空中的（空中優先）
      if ((!st.tgt || !air(st.tgt)) && st.scanT <= 0) {
        st.scanT = 0.35;
        let best = null,
          bs = 1e9;
        for (const q of g.rtsNear(this.pos.x, this.pos.z, rAir + 14)) {
          if (!ok(q)) continue;
          const s =
            this.rtsTowerDist(q) +
            (air(q) ? 0 : 60) +
            (q.bld ? 40 : 0) +
            (q.rtsDef && RTS_DEFS[q.rtsDef] && RTS_DEFS[q.rtsDef].worker ? 12 : 0) -
            this.rtsTowerHotK(q); // 打己方建築的單位優先（R6 D 包）
          if (s < bs) ((bs = s), (best = q));
        }
        if (best) st.tgt = best;
      }
      t = st.tgt;
    }
    if (!t) return true;
    const c = t.center();
    const top = this.pos.y + 6.5;
    const yawW = Math.atan2(-(c.x - this.pos.x), -(c.z - this.pos.z));
    const pitch = Math.atan2(c.y - top, Math.hypot(c.x - this.pos.x, c.z - this.pos.z));
    if (this.model.aimAt) this.model.aimAt(yawW - this.yaw, pitch);
    if (st.cd > 0) return true;
    const rof = D.rof || 1.4;
    st.cd = rof * (this.rtsRofK || 1) + Math.max(-rof, Math.min(0, st.cd));
    st.shots = (st.shots || 0) + 1;
    const dmg = (air(t) ? D.dps : D.groundDps) * rof * this.dmgMul;
    const from = this.model.muzzle
      ? this.model.muzzle.getWorldPosition(new THREE.Vector3())
      : new THREE.Vector3(this.pos.x, top, this.pos.z);
    const T = Math.max(0.15, from.distanceTo(c) / SAM_V);
    const id = t.id,
      atk = D.atk || 'pierce';
    g.later(T, () => {
      const q = g.rtsEnt(id);
      if (!g.rts || !q || q.dead) return;
      g.rtsHit(q, dmg, 40, this.dead ? null : this, atk);
      if (g.rtsFxOk(q.center())) g.fx.flash(q.center(), 1.2, 0xffc070, 0.12);
    });
    if (g.rtsFxOk(from) || g.rtsFxOk(c)) g.rtsVeerMissileFx(from, t, T);
    SFX.shot('missile', undefined, from);
    return true;
  },

  // ---------- 空投運輸機、運輸機、收起的建築（game/rts-veer.js 的掛勾） ----------
  // 空投運輸機的飛行：直線、依前方的地形與建築爬升（下降中不爬升）、吊掛的貨櫃跟著加減速擺動；回傳 true＝到達
  rtsVeerCarrierMove(dt, x, z, alt) {
    const w = this.game.world;
    const dx = x - this.pos.x,
      dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    const ux = d > 1e-3 ? dx / d : 0,
      uz = d > 1e-3 ? dz / d : 0;
    let want = w.terrainHeight(this.pos.x, this.pos.z) + alt;
    if (alt >= RTS_VEER.ship.alt - 0.01 && d > 3)
      for (const s of [0, 4, 8, 14]) {
        const L = w.groundAt(this.pos.x + ux * s, this.pos.z + uz * s, 1e4);
        if (L + 3 > want) want = L + 3;
      }
    this.hoverH = Math.max(2, want - w.groundRef(this.pos.x, this.pos.z, this.pos.y));
    const k = d < 1.2 ? 0 : Math.min(1, 0.25 + d / 12);
    const wish = this.rt.wish.set(ux * k, 0, uz * k);
    if (d > 2) this.setAim(this.rt.faceV.set(x, this.pos.y, z));
    this.move(dt, wish, false, false, false, null);
    const cg = this.model && this.model.rtsCargo;
    if (cg && cg.visible) {
      const fw = this.vel.x * -Math.sin(this.yaw) + this.vel.z * -Math.cos(this.yaw);
      cg.rotation.x = Math.max(-0.25, Math.min(0.25, fw * 0.012));
    }
    return d < 1.5;
  },
  // 放下地基的那一格：吊掛的貨櫃離開
  rtsVeerCargoDrop(b) {
    const g = this.game;
    if (this.model && this.model.rtsCargo) this.model.rtsCargo.visible = false;
    const p = b && b.pos ? b.pos.clone() : this.pos.clone();
    if (g.rtsFxOk(p)) {
      g.fx.dust(p.clone().setY(p.y + 0.2), 4, 10, 0xa09880);
      g.fx.flash(p.clone().setY(p.y + 1), 2, VEER_LIME, 0.2);
    }
    SFX.play('door', 0.5, 0.8, 0.05, 0.03, p);
  },
  // 有單位登機
  rtsVeerBoarded(e) {
    const g = this.game;
    if (this.model && this.model.rtsCargo) this.model.rtsCargo.visible = true;
    const p = e && e.pos ? e.pos.clone() : this.pos.clone();
    if (g.rtsFxOk(p) && this.rtsTeam === 0) g.fx.ring(p.setY(p.y + 0.2), 2, VEER_LIME);
    SFX.play('door', 0.35, 1.3, 0.05, 0.03, this.center());
  },
  // 收好的建築的飛行（A 的 rtsPackFly：直線、高度＝地面＋5 m）＋底部的噴焰
  rtsVeerPackMove(dt) {
    const g = this.game;
    if (g.rtsPackFly) g.rtsPackFly(this, dt);
    this.rtsVeerPackFx(dt);
  },
  rtsVeerPackFx(dt) {
    const g = this.game,
      m = this.model;
    if (!m || !m.fans || this.fogHid || !g.rtsFxOk(this.pos) || this.mesh.visible === false) return;
    if (Math.random() > dt * 18) return;
    for (const f of m.fans) {
      f.getWorldPosition(_v);
      g.fx.boostFlame(_v.clone(), new THREE.Vector3(0, -1, 0), 0xffd8a0);
    }
  },
});

// ================= Game：投放艙、物流無人機、臨時信標、飛彈的外觀 =================
// 模板依隊伍色快取，實例 clone（共用幾何與材質；移除時不釋放）
const TPL = new Map();
function tpl(kind, team, build) {
  const k = kind + team;
  if (!TPL.has(k)) TPL.set(k, build(rtsPal('veerwell', team)));
  return TPL.get(k);
}
function clonePod(team) {
  const T = tpl('pod', team, buildDropPod);
  const group = T.group.clone(true);
  // clone 之後的艙門與噴焰（依名稱以外的順序對應：子節點的索引）
  const iDoor = T.doors.map((d) => T.group.children.indexOf(d));
  const doors = iDoor.map((i) => group.children[i]);
  const flame = group.children[T.group.children.indexOf(T.flame)];
  return {
    group,
    doors,
    flame,
    setOpen(f) {
      for (const h of doors) h.rotation.x = Math.max(0, Math.min(1, f)) * 1.3;
    },
  };
}

Object.assign(Game.prototype, {
  // 這一格看得到嗎（自己的隊伍一律看得到；別人的＝目前看得到那一格）
  rtsVeerSeen(team, x, z) {
    return team === 0 || !this.rtsFogState || this.rtsFogState(0, x, z) === 2;
  },
  // 投放艙：'fall'＝開始（預警圈＋最後 1.1 秒從天上落下），'land'＝著地（艙門打開、3 秒後縮小消失）
  rtsVeerPodFx(pod, ph) {
    const R = this.rts,
      w = this.world;
    if (!R) return;
    const y = w.groundAt(pod.x, pod.z, w.terrainHeight(pod.x, pod.z) + 2);
    if (ph === 'fall') {
      const delay = Math.max(0.1, pod.t - R.t);
      if (this.rtsVeerSeen(pod.team, pod.x, pod.z))
        this.fx.warnCircle(
          new THREE.Vector3(pod.x, y + 0.15, pod.z),
          pod.r || 3, // 英雄技能的投放艙（強襲空投艙、緊急增援）帶自己的範圍（R6 D 包）
          delay,
          pod.team === 0 ? 0x7ee081 : 0xff3020,
        );
      const P = clonePod(pod.team === 0 ? 0 : pod.team);
      P.group.position.set(pod.x, y + 60, pod.z);
      P.group.rotation.y = (pod.id || 0) * 1.7;
      P.group.visible = false;
      (R.g || this.scene).add(P.group);
      const V = (pod.vis = { P, y, land: 0 });
      this.fx.task(delay + POD_STAY + 6, (e) => {
        if (!this.rts || this.rts !== R) return void (e.life = 0);
        const seen = this.rtsVeerSeen(pod.team, pod.x, pod.z);
        if (!V.land) {
          const left = pod.t - R.t;
          const f = Math.max(0, Math.min(1, left / POD_FALL));
          P.group.position.y = y + 60 * f * f;
          P.group.visible = seen && left < POD_FALL;
          P.flame.visible = true;
          P.flame.scale.setScalar(0.7 + 0.5 * f);
          if (left < -1) V.land = R.t; // 沒有收到著地（生成失敗）：照樣收掉
          if (P.group.visible && this.rtsFxOk(P.group.position) && Math.random() < 0.5)
            this.fx.smoke(P.group.position.clone().setY(P.group.position.y + 4), 0.8, 0x8a8a8a, 0.6, 1);
        } else {
          const t = R.t - V.land;
          P.group.position.y = y;
          P.flame.visible = false;
          P.setOpen(Math.min(1, t / 0.5));
          const sc = t > POD_STAY ? Math.max(0, 1 - (t - POD_STAY) / 0.5) : 1;
          P.group.scale.setScalar(Math.max(0.01, sc));
          P.group.visible = seen;
          if (sc <= 0) {
            if (P.group.parent) P.group.parent.remove(P.group);
            e.life = 0;
          }
        }
      });
      return;
    }
    // 著地
    const V = pod.vis;
    if (V) V.land = R.t;
    if (this.rtsVeerSeen(pod.team, pod.x, pod.z) && this.rtsFxOk({ x: pod.x, z: pod.z })) {
      const p = new THREE.Vector3(pod.x, y + 1, pod.z);
      this.fx.explosion(p, 2.4, 0xffc070);
      this.fx.dust(p.clone().setY(y + 0.1), 3.5, 10, 0xa09880);
      this.fx.ring(
        p.clone().setY(y + 0.2),
        this.rtsResLv(pod.team, 'r_pod') ? RTS_VEER.pod.splash : 2.5,
        0xffc070,
      );
    }
    if (this.rtsVeerSeen(pod.team, pod.x, pod.z))
      SFX.play('thud2', 0.6, 0.8, 0.05, 0.03, new THREE.Vector3(pod.x, y, pod.z)); // 'slam' 不在 SFX_DATA 裡
  },
  // 物流無人機：集貨站 → 調度中心（sec 秒，弧線）
  rtsVeerHaulFx(yard, hq, sec) {
    const R = this.rts,
      w = this.world;
    if (!R || !yard || !hq) return;
    const team = yard.rtsTeam;
    const T = tpl('haul', team === 0 ? 0 : team, buildHaulDrone);
    const m = T.clone(true);
    const a = yard.pos.clone(),
      b = hq.pos.clone();
    const t0 = R.t;
    (R.g || this.scene).add(m);
    this.fx.task(sec + 6, (e) => {
      if (!this.rts || this.rts !== R) {
        if (m.parent) m.parent.remove(m);
        return void (e.life = 0);
      }
      const f = Math.min(1, (R.t - t0) / Math.max(0.1, sec));
      const x = a.x + (b.x - a.x) * f,
        z = a.z + (b.z - a.z) * f;
      m.position.set(x, w.terrainHeight(x, z) + 6 + 6 * Math.sin(f * Math.PI), z);
      m.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
      m.visible = this.rtsVeerSeen(team, x, z);
      if (f >= 1) {
        if (m.parent) m.parent.remove(m);
        e.life = 0;
      }
    });
  },
  // 臨時信標的外觀（偵察無人機的臨時信標；C 的技能與道具只有信標本身、沒有外觀）
  rtsVeerTempBeaconFx(team, x, z, sec) {
    const R = this.rts,
      w = this.world;
    if (!R) return;
    const T = tpl('tbcn', team === 0 ? 0 : team, buildTempBeacon);
    const m = T.clone(true);
    const s = m.children.find((c) => c.geometry && c.geometry.type === 'SphereGeometry');
    if (s) s.material = s.material.clone();
    m.position.set(x, w.groundAt(x, z, w.terrainHeight(x, z) + 2), z);
    (R.g || this.scene).add(m);
    const end = R.t + sec;
    this.fx.task(sec + 30, (e) => {
      if (!this.rts || this.rts !== R || R.t >= end) {
        if (m.parent) m.parent.remove(m);
        return void (e.life = 0);
      }
      m.visible = this.rtsVeerSeen(team, x, z);
      if (s) s.material.opacity = (R.t * 1.2) % 1 < 0.18 ? 0.95 : 0.1;
    });
  },
  // 飛彈防禦塔的飛彈：粒子批次的彈體從發射口飛到目標（T 秒），沿途冒煙
  rtsVeerMissileFx(from, t, T) {
    const fx = this.fx;
    const m = fx.P('ba', 0xffd8a0, 1);
    m.position.copy(from);
    const a = from.clone();
    fx.add(m, T, (e, f) => {
      const c = t.dead ? null : t.center();
      if (c) _v.copy(c);
      else _v.copy(e.mesh.position);
      const p = a.clone().lerp(_v, f);
      p.y += Math.sin(f * Math.PI) * 2;
      const d = p.clone().sub(e.mesh.position);
      e.mesh.position.copy(p);
      const L = d.length();
      if (L > 1e-4) e.mesh.quaternion.setFromUnitVectors(_Z, d.divideScalar(L));
      e.mesh.scale.set(0.18, 0.18, 1.1);
      if (Math.random() < 0.35) fx.smoke(p.clone(), 0.35, 0x9a9a9a, 0.5, 0.5);
    });
  },
});
