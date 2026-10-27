import { ATTRS, ATTR_KEYS, LINK_K, directOf, isLaserWeapon, weaponAttr } from '../data/attrs.js';
// ============================================================
//  MECH ENTITY
// ============================================================
import { SFX } from '../audio/audio.js';
import { DS, MB, MS } from '../core/scale.js';
import { angLerp, clamp, lerp, rnd } from '../core/math.js';
import {
  AIR_DECAY,
  FIST_DEF,
  GRAVITY,
  JUMP_EN,
  STAG_GUARD,
  STAG_GUARD_CAP,
  STAG_GUARD_K,
  PVE_IMP_K,
  PVE_ACS_DELAY,
  FOE_STAG_T,
  asmStats,
  jumpSpec,
  partById,
  usesAmmo,
} from '../data/parts.js';
import { assistSpread, fcsAssist, leadOf, rtsWeaponDef, trackRate, weaponById } from '../data/parts.js';
import { BOSS_STAG_GUARD } from '../data/enemies.js';
import {
  DIVE_V,
  EXEC_ACE_K,
  EXEC_HEAL,
  EXEC_HOLD,
  EXEC_R,
  LINK_SHOT_AT,
  PARRY_STUN,
  PARRY_STUN_BOSS,
  PARRY_T,
  PQB_BUFF,
  PQB_IMP,
  PQB_LUNGE,
  PQB_SLOW,
  PQB_WIN,
  CUE_MELEE,
  SHIELD_BASH_T,
  LINK_SHOT_K,
  LINK_SHOT_R,
  LUNGE_K,
  QB_RESUME_MAX,
  QUEUE_AT,
  RESUME_T,
  STUN_ACE,
  SIDE_ANG,
  SWAP_MAX,
  comboDecay,
  meleeAssist,
  meleeIdx,
  meleeMove,
  meleeNext,
  meleeStun,
} from '../data/melee.js';
import {
  CHARGE_AI,
  HOLDER_IDLE_FIRE,
  NOISE_QB,
  SEEK_AI,
  SUPPORT_AI,
  SUP_FIRE,
  SUP_SPECIAL_DT,
  SUP_SPREAD,
} from '../data/ai.js';
import { applyPilotStats, pilotWeaponDef } from '../data/pilot.js';
import { MeleeAnim } from '../render/melee-anim.js';
import { animateMech, buildMech, mechFlash } from '../render/mech-model.js';
import { applyIK, ikMeasure, ikOn, ikRestore } from '../render/mech-ik.js';
import { fireClass } from '../render/mech-fire.js';
import { mergeRig } from '../render/mesh-merge.js';
import { mergeRtsRig } from '../render/rts-merge.js';
import { nozzleFrom, nozzleWorld } from '../fx/thruster.js';
import { measureBlades } from '../fx/trail.js';
import { buildDrone, buildHeli, buildVehicle } from '../render/vehicle-models.js';
import { buildBossModel } from '../render/boss-models.js';
import { Projectile } from './projectile.js';
import { PROP_PAD, targetDist, targetNear } from '../world/prop-hit.js';

const RAW_FOE = { raw: true }; // RTS 渲染設定時地圖專屬敵人的模型不先合併（render/foe-merge.js）
let MECH_ID = 0;
const _rwM = new THREE.Matrix4(),
  _nzM = new THREE.Matrix4(); // thrusterFx 的暫存

// 射擊動作的武器槽位：[武器槽, 動作的鍵, 肩上武器]
const ANIM_SLOTS = [
  ['rarm', 'r', false],
  ['larm', 'l', false],
  ['rback', 'br', true],
  ['lback', 'bl', true],
];
// 跳躍規格的高度與速度乘 k（Coral 戰爭照舊尺度）
function scaleJump(J, k) {
  return {
    ...J,
    v: J.v * k,
    g: J.g * k,
    height: J.height * k,
    airH: J.airH * k,
    airG: J.airG * k,
    maxH: J.maxH * k,
  };
}
const NO_KEY = { k: '', side: 0 };

export class MechEntity {
  constructor(game, asm, pal, opts = {}) {
    this.game = game;
    this.id = MECH_ID++;
    this.asm = asm;
    this.pal = pal;
    this.pm = opts.pilot || null; // 駕駛員技能加成（computePilotMods 的結果），敵人與友軍為 null
    this.stats = applyPilotStats(asmStats(asm), this.pm);
    this.opts = opts;
    this.res = opts.res || null; // 弱點：[實彈, 爆發, 能量] 的額外減傷
    this.laserK = opts.laserK || 1; // 雷射類武器打它的傷害倍率（地圖專屬敵人的 laserK，例如 0.3）
    this.palKey = opts.palKey || null;
    this.slot = opts.slot;
    this.downed = false;
    this.downT = 0;
    this.team = opts.team || 'enemy';
    this.isPlayer = this.team === 'player';
    // 機甲三倍高改版：所有實體放大 MS 倍（Coral 戰爭照舊尺度：scale 1、dk 1）
    this.scale = (opts.scale || 1) * (game && game.rts ? 1 : MS);
    this.isBoss = !!opts.isBoss;
    this.name = opts.name || 'AC';
    this.model =
      opts.modelKind === 'vehicle'
        ? buildVehicle(pal, this.scale)
        : opts.modelKind === 'heli'
          ? buildHeli(pal, this.scale, this.isBoss ? 'boss_helios' : opts.vehKey || 'heli')
          : opts.modelKind === 'drone'
            ? buildDrone(pal, this.scale, opts.vehKey || 'swarm')
            : opts.modelKind === 'boss' || opts.modelKind === 'part'
              ? buildBossModel(opts.vehKey, pal, this.scale, game && game.rtsR ? RAW_FOE : undefined) // 新 Boss 與附屬部位（render/boss-models.js；RTS 渲染設定時地圖專屬敵人改用單一材質合併）
              : opts.buildModel
                ? opts.buildModel(pal, this.scale) // 呼叫端給的模型（RTS 的建築，render/rts-models.js）
                : this.buildRig();
    if (opts.modelKind) this.mergeModel(this.model);
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
    this.etype = opts.etype || null; // ENEMY_TYPES 的鍵（攻擊權杖的權重與招式，data/ai.js）
    this.ace = !!opts.ace; // 敵對 AC：一律主攻、不會跟丟目標
    this.sq = opts.sq || 0; // 編隊編號（無線電）
    this.themeFoe = !!opts.themeFoe;
    this.pvpAi = !!opts.pvpAi;
    this.pvpTeam = opts.pvpTeam !== undefined ? opts.pvpTeam : opts.team === 'enemy' ? -1 : 0;
    this.dk = game && game.rts ? 1 : DS; // 距離與尺寸的倍率（Coral 戰爭照舊尺度；程式裡的數字照舊尺度寫再乘它）
    this.stats = this.dkStats(this.stats);
    this.hoverH = (opts.hoverH || 7) * this.dk;
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
    this.recoil = { l: 0, r: 0, bl: 0, br: 0 };
    this.swing = { l: 0, r: 0 };
    this.melee = {
      active: false,
      stage: 0,
      t: 0,
      queued: -1, // 排入的下一招（段號；−1＝沒有）
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
      want: (opts.wantDist || 22) * (game && game.rts ? 1 : DS),
      fireT: 0,
      pattern: 0,
      patT: 0,
      phase: 1,
      stuck: 0,
    };
    this.specialInit(); // 特殊敵人的附加模型與狀態（mech-special.js）
  }
  // 整台機體的前後傾（leanX 正值＝往前加速）：機甲與載具的正面都是 −Z，前傾是負的 x 旋轉；
  // 人形機甲幅度減小（上身的前傾在 animateMech）；坦克相反：加速時車頭微微抬起、煞車時往前點頭
  // 動作層（animateMech）要的移動資訊：水平速度÷機體速度、垂直速度、這次更新之間的轉向、落地速度、重量（0 輕～1 重）
  animExtra() {
    const y0 = this.animYaw0 === undefined ? this.yaw : this.animYaw0;
    this.animYaw0 = this.yaw;
    const dyaw = ((((this.yaw - y0 + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    if (this.animHeavy === undefined)
      this.animHeavy = clamp((((this.stats && this.stats.weight) || 26000) - 18000) / 24000, 0, 1);
    return {
      vr: Math.hypot(this.vel.x, this.vel.z) / Math.max(1, this.stats.speed),
      vy: this.vel.y / this.dk, // 動作層照舊尺度的 m/s
      dyaw,
      landV: this.landV || 14,
      aj: this.remote ? undefined : this.airJumps, // 空中跳的次數（減少＝空中跳，動作的翻轉）
      heavy: this.animHeavy,
      hits: this.takeHits(),
      knockF: this.knockF,
      knockX: this.knockX,
      persona: this.animPersonaOf(),
      ...this.animWeapons(),
    };
  }
  // 射擊動作要的武器狀態：各槽位的動作種類（render/mech-fire.js）、蓄力進度、換彈（0→1→0）
  takeHits() {
    const h = this.animHits;
    this.animHits = null;
    return h;
  }
  animWeapons() {
    const wk = {},
      ch = { l: 0, r: 0 },
      rl = { l: 0, r: 0 };
    for (const [slot, k, back] of ANIM_SLOTS) {
      const w = this.weapons[slot];
      if (!w || w.dropped || !w.def) continue;
      wk[k] = fireClass(w.def, back);
      if (back) continue;
      if (w.def.chargeT > 0 && w.charge > 0) ch[k] = clamp(w.charge / w.def.chargeT, 0, 1);
      if (w.reloadT > 0 && w.def.reload > 0)
        rl[k] = Math.sin(Math.PI * clamp(1 - w.reloadT / w.def.reload, 0, 1));
    }
    return { wk, ch, rl };
  }
  // 擊破時先跪倒崩落的機體：人形（二足、逆關節）的機甲，不是 Coral 戰爭、過場動畫
  canCollapse() {
    const m = this.model;
    return !!(
      m &&
      !m.vehicle &&
      !this.isProp &&
      !this.opts.modelKind &&
      (m.type === 'biped' || m.type === 'reverse') &&
      m.legs &&
      m.legs.length &&
      !this.game.rts &&
      !this.cine
    );
  }
  // 受擊的動作（animateMech 的 st.hits）：d＝打過來的方向（世界，攻擊者 → 自己），k＝強度；也記下失衡的倒向
  hitAnim(d, k) {
    if (!d || !this.model || this.model.vehicle) return;
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    const lx = d.x * c - d.z * s,
      lz = d.x * s + d.z * c,
      l = Math.hypot(lx, lz);
    if (l < 1e-4) return;
    const h = this.animHits || (this.animHits = []);
    h.push({ x: lx / l, z: lz / l, k });
    if (h.length > 4) h.shift();
    this.knockF = lz / l;
    this.knockX = lx / l;
  }
  // 個性（電腦的機體，依名稱固定）：前傾、待機的晃動、轉頭
  animPersonaOf() {
    if (this.animPersona !== undefined) return this.animPersona;
    if (this.isPlayer || !this.name || this.team === 'player') return (this.animPersona = null);
    let h = 2166136261;
    for (const ch of this.name) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    const r = (n) => ((h >>> (n * 8)) & 255) / 255;
    return (this.animPersona = { lean: -0.1 + 0.16 * r(0), sway: 0.5 + r(1), look: 0.5 + 1.1 * r(2) });
  }
  leanTilt() {
    const l = this.leanX || 0;
    if (this.model.cls === 'vehicle') return l * 0.5;
    return this.model.vehicle ? -l : -l * 0.35;
  }
  // 機甲模型：模型組由遊戲決定（伺服器模式依玩家／敵人選伺服器預設組或玩家上傳的模型組，見 game/local-lib.js）
  // noMerge：先不合併網格（swapModel 要先拿掉已丟出的武器）
  buildRig(noMerge) {
    const g = this.game;
    this.modelSrc = g.mechSource ? g.mechSource(this.opts) : null;
    const rig = buildMech(this.asm, this.pal, this.scale / MB, { source: this.modelSrc }); // 機甲的建模尺寸已經是新尺度
    return noMerge ? rig : this.mergeModel(rig);
  }
  // 網格依材質合併（render/mesh-merge.js，降低 draw call）：只在遊戲實體做，模型庫、機甲庫的展示台不合併。
  // 動作 IK 要量腳底的網格，所以機甲先量好（ikMeasure）再合併。opts.noMerge 時不合併
  mergeModel(rig) {
    if (this.opts.noMerge) return rig;
    if (!rig.vehicle && rig.legs) ikMeasure(rig);
    if (!rig.vehicle) measureBlades(rig); // 刀光用的刀尖（entities/mech-trails.js）
    if (!rig.vehicle) measureBlades(rig); // 刀光用的刀尖（entities/mech-trails.js）
    // RTS 渲染設定：整台併成一個網格＋描邊外殼（render/rts-merge.js）
    return this.game && this.game.rtsR ? mergeRtsRig(rig) : mergeRig(rig);
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
    this.model = this.buildRig(true);
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
    this.mergeModel(this.model); // 拿掉丟出的武器之後才合併
    g.scene.add(this.mesh);
  }
  // Coral 戰爭照舊尺度：組裝數值裡放大過的火控距離與跳躍換回（零件表是放大過的；其他移動數值由 speedMul 等換算）
  dkStats(st) {
    if (this.dk === DS) return st;
    return { ...st, lockRange: (st.lockRange * this.dk) / DS, jump: (st.jump * this.dk) / DS };
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
      if (this.dk === 1) def = rtsWeaponDef(def); // Coral 戰爭照舊尺度
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
  // 近戰訓練的判定事件（game/tutorial.js 的 tutEv）：只有教學中的玩家機體
  tutE(k, o) {
    const g = this.game;
    if (g.tut && this === g.player) g.tutEv(k, o);
  }
  // 玩家操作的機體（單機與多人的玩家，不含友軍、敵人與 PvP 電腦）：失衡後保護只給它們
  pilotEnt() {
    return this.team === 'player' && typeof this.slot === 'number' && !this.pvpAi;
  }
  // 超出作戰區域（±lim）：往場內推回；最外到 limOut（collide 的 soft）。oob＝超出的距離
  oobPush(w, dt) {
    let ex = 0;
    const Z = w.zone;
    for (const a of ['x', 'z']) {
      const p = this.pos[a],
        lo = Z[a === 'x' ? 0 : 2],
        hi = Z[a === 'x' ? 1 : 3];
      const e = p > hi ? p - hi : p < lo ? lo - p : 0;
      if (e <= 0) continue;
      ex = Math.max(ex, e);
      // 往外的速度上限越外面越低，超出 4 m 後只能往內；另外一直往內加速（放開按鍵也會慢慢回到場內）
      const sg = p > hi ? 1 : -1;
      const v = Math.min(this.vel[a] * sg, 16 * (1 - e / 4)) - (16 + e * 3) * dt;
      this.vel[a] = sg * v;
    }
    this.oob = ex;
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
    return !this.dead && !this.downed && this.staggerT <= 0 && !(this.hitStunT > 0);
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
    if (d.type === 'melee' && this.pilotEnt()) this.cueArmSet('p'); // 提示中按近戰＝彈刀（meleeClash）
    if (this.melee.active && d.type !== 'melee') {
      // 近戰 → 射擊（docs/melee-combo-design.md 第 1 期）：玩家的近戰打中過、過了 LINK_SHOT_AT 時，
      // 另一隻手或肩上的射擊武器可以中斷近戰立刻開火；目標在附近時這一發是零距離射擊（傷害加成）
      const m = this.melee,
        cur = meleeMove(this.weapons[m.slot].def, m.stage);
      if (!(this.pilotEnt() && m.hitAny && cur && slot !== m.slot && m.t > cur.dur * LINK_SHOT_AT))
        return false;
      if (w.cd > 0 || w.reloadT > 0 || (usesAmmo(d) && w.mag <= 0)) return false;
      const near = m.target && !m.target.dead && m.target.pos.distanceTo(this.pos) < LINK_SHOT_R * this.dk;
      this.meleeEnd();
      this.tutE('link', { near });
      if (!near) return this.fire(slot, targetPos, targetEnt);
      const k0 = this.dmgMul;
      this.dmgMul *= LINK_SHOT_K;
      try {
        return this.fire(slot, targetPos, targetEnt || m.target);
      } finally {
        this.dmgMul = k0;
      }
    }
    // 收招的冷卻：寬限中的近戰不受它擋（接下一招）
    const graceOk =
      d.type === 'melee' && !this.melee.active && this.meleeGrace && this.meleeGrace.slot === slot;
    if ((w.cd > 0 && !graceOk) || w.reloadT > 0) return false;
    if (usesAmmo(d) && w.mag <= 0) {
      if (w.ammo <= 0) {
        if (slot.endsWith('arm') && !w.dropped) this.dropWeapon(slot);
        return false;
      }
      w.reloadT = d.reload;
      return false;
    }
    const muzzle = this.muzzle(slot);
    const from = this.center();
    if (this.pilotEnt()) g.aiFireNoise(this, d.type); // 開火的聲音（敵人起疑，game/ai-director.js）
    const SP = this.isPlayer ? null : muzzle;
    // 火控的距離輔助：依距離決定預判準度與集彈（data/parts.js 的 fcsAssist）
    const tgtOk = targetEnt && !targetEnt.dead && targetEnt.center;
    const distT = (tgtOk ? targetEnt.center() : targetPos).distanceTo(muzzle);
    const assist = this.fcsAssist(distT);
    if (tgtOk && (d.type === 'bullet' || d.type === 'shotgun' || d.type === 'shell'))
      targetPos = this.leadPoint(targetEnt, d.speed, muzzle); // 依彈速算攔截點
    else if (tgtOk && (d.type === 'laser' || d.type === 'empbeam')) targetPos = targetEnt.center(); // 即時命中：不預判
    // 高度優勢：射手比目標高 → 擴散縮小；比目標低 → 擴散放大（每 3 m 高度差 ±7%，上限 ±45%）
    let hmul = 1;
    if (targetEnt && !targetEnt.dead) {
      const dy = this.center().y - targetEnt.center().y;
      hmul = clamp(1 - (dy / this.dk) * 0.07, 0.55, 1.45);
    }
    this.heightMul = hmul;
    const steady = (this.hoverMode === 1 ? 0.5 : 1) * (this.buffT > 0 ? 0.6 : 1); // 懸浮（定高）時瞄準穩定；指揮官 MT 強化
    // 持續射擊的時間（機槍越打越準、加特林的轉速）：間隔太久就重新起算
    const gap = this.t - (w.lastShot === undefined ? -99 : w.lastShot);
    w.streak = gap > Math.max(0.3, d.rof * 1.6) ? 0 : (w.streak || 0) + gap;
    w.lastShot = this.t;
    const conv = d.conv ? 1.15 - 0.7 * clamp(w.streak / d.conv, 0, 1) : 1;
    // 霰彈：理想射程以內越近越集中
    const near = d.near ? clamp(distT / (d.ideal || 14 * this.dk), 0.45, 1) : 1;
    const spread =
      (d.spread || 0) *
        (slot.endsWith('arm') ? 1.3 - this.stats.parts.arms.aim * 0.6 : 0.55) *
        hmul *
        steady *
        (this.supK || 1) * // 壓制射擊（沒拿到攻擊權杖）的擴散
        assistSpread(assist) *
        conv *
        near +
      (hmul > 1 ? 0.015 * (hmul - 1) * 4 : 0);
    // 彈道方向：從實際槍口指向瞄準點（不是從機體中心），手部與肩部武器落點都對準準星
    const dir = targetPos.clone().sub(muzzle).normalize();
    // 玩家操作的機體用武器的數值；電腦（敵人、友軍）乘 npcK，武器調強時敵人的威脅不跟著變
    const pilot = this.pilotEnt();
    const dk = pilot ? 1 : d.npcK || 1;
    const dmg = d.dmg * this.dmgMul * dk,
      imp = d.impact * this.dmgMul;
    // 彈道修正與命中判定（只給玩家操作的機體）：子彈差一點擦過時往鎖定的目標偏轉，判定半徑加大
    const aimX =
      pilot && tgtOk && (d.bend || d.hitR)
        ? { target: targetEnt, bend: (d.bend || 0) * (0.5 + assist), hitR: d.hitR || 0 }
        : null;
    const shoot = (dirv, kind, extra) => {
      if (g.range && this === g.player) g.rangeShot(d.id); // 靶場的命中率
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
              fall: d.ideal ? [d.ideal, d.range] : null, // 實彈的距離衰減（projectile.js）
            },
            aimX || {},
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
        g.fx.casing(muzzle.clone().addScaledVector(dir, -1.2 * this.dk), w.side, dir);
        SFX.shot('bullet', d.id, SP);
        w.cd = d.rof * (d.spin ? 2.5 - 1.5 * clamp(w.streak / d.spin, 0, 1) : 1); // 加特林：轉速慢慢提升
        this.recoil[w.side > 0 ? 'r' : 'l'] = 0.35;
        if (slot.endsWith('back')) this.recoil[w.side > 0 ? 'br' : 'bl'] = 0.35; // 肩上武器的轉管
        if (this.isPlayer) {
          g.rumble(
            d.id === 'w_mg' || d.id === 'bw_gat' ? 0.15 : 0.25,
            0.5,
            d.id === 'w_mg' || d.id === 'bw_gat' ? 40 : 70,
          );
          // 武器的鏡頭後座：機槍細碎、步槍明顯一點
          g.camShake = Math.max(g.camShake, d.id === 'w_mg' || d.id === 'bw_gat' ? 0.012 : 0.03);
        }
        break;
      case 'shotgun':
        if (d.enShot && !this.useEn(d.enShot * (1 - this.pmv('enWpn')))) return false; // 能量霰彈：每發耗 EN
        for (let i = 0; i < d.pellets; i++) shoot(jitter(dir), 'bullet');
        g.fx.muzzle(muzzle, dir, 0xffa050, 1.8);
        g.fx.casing(muzzle.clone().addScaledVector(dir, -1 * this.dk), w.side, dir);
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
            // 依榴彈自身飛行時間預判（追蹤的速度、火控的預判準度）
            const V = this.trackVel(targetEnt),
              k = this.leadK(distT);
            let tt0 =
              Math.min(d.range, Math.max(8 * this.dk, targetEnt.center().sub(muzzle).setY(0).length())) /
              d.speed;
            tp = targetEnt.center().addScaledVector(V, tt0 * k);
            tt0 = Math.min(d.range, Math.max(8 * this.dk, tp.clone().sub(muzzle).setY(0).length())) / d.speed;
            tp = targetEnt.center().addScaledVector(V, tt0 * k);
          }
          const hd = tp.clone().sub(muzzle);
          hd.y = 0;
          const dist = Math.min(d.range, Math.max(8 * this.dk, hd.length()));
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
          this.recoil[w.side > 0 ? 'r' : 'l'] = 1;
          if (slot.endsWith('back')) this.recoil[w.side > 0 ? 'br' : 'bl'] = 1;
          if (this.isPlayer) {
            g.camShake = Math.max(g.camShake, 0.12);
            g.rumble(0.8, 0.4, 180);
          }
        }
        break;
      case 'missile':
        {
          const n = this.missileN(d, targetEnt); // 多連導彈：鎖定時間不夠時發射數量較少
          this.lkT0 = this.t; // 發射後重新鎖定
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
          if (stop < d.range) g.tempWallHitAt(muzzle.clone().addScaledVector(bdir, stop), dmg * dtb); // 臨時障礙物
          stop = g.beamStop(this, muzzle, bdir, stop, dmg * dtb, 0, d.id, true); // 護盾擋住光束
          // 可破壞物件：光束停在第一個物件的命中形狀上（world/prop-hit.js）
          const pf = g.world.propFirst(muzzle, bdir.clone().multiplyScalar(stop), PROP_PAD);
          if (pf) {
            stop *= pf[1];
            const pt = muzzle.clone().addScaledVector(bdir, stop);
            g.damageProp(pf[0], dmg * dtb, imp * dtb, pt);
            if (Math.random() < dtb * 4) g.fx.spark(pt, d.color, bdir);
          }
          const targets = g.hostilesOf(this.team, this).concat(g.destructibles(this.team));
          for (const t of targets) {
            if (t.dead || t.shape) continue;
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
          const ldmg = charged ? d.chargeDmg * this.dmgMul * dk : dmg;
          const limp = charged ? imp * 2.2 : imp;
          w.charge = 0;
          w.charging = false;
          // 雷射：從槍口射向瞄準點的直線，貫穿彈道上所有敵人；只有地形／障礙物能阻斷
          const bdir = targetPos.clone().sub(muzzle).normalize();
          const targets = g.hostilesOfEnt(this).concat(g.destructibles(this.team));
          let stop = d.range;
          for (let s2 = 1; s2 < stop; s2 += 1) {
            const p = muzzle.clone().addScaledVector(bdir, s2);
            if (p.y < g.world.terrainHeight(p.x, p.z) - 0.2 || g.world.hitsWorld(p)) {
              stop = s2;
              break;
            }
          }
          if (stop < d.range) g.tempWallHitAt(muzzle.clone().addScaledVector(bdir, stop), ldmg); // 臨時障礙物
          stop = g.beamStop(this, muzzle, bdir, stop, ldmg, limp, d.id); // 護盾、盾牌擋住雷射
          const hits = [];
          // 可破壞物件：雷射停在第一個物件的命中形狀上（world/prop-hit.js，不是外接球）
          const pf = g.world.propFirst(muzzle, bdir.clone().multiplyScalar(stop), PROP_PAD);
          if (pf) {
            stop *= pf[1];
            hits.push({ t: pf[0], proj: stop });
          }
          for (const t of targets) {
            if (t.dead || t.shape) continue;
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
            SFX.hit(h.t.isPlayer ? null : pt, h.t);
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
          if (g.range && this === g.player) g.rangeShot(d.id);
          w.cd = d.rof * (charged ? 1.6 : 1);
          this.recoil[w.side > 0 ? 'r' : 'l'] = charged ? 1 : 0.4;
          if (this.isPlayer) g.rumble(charged ? 0.9 : 0.1, charged ? 0.6 : 0.6, charged ? 260 : 70);
          this.useEn((charged ? 250 : 60) * (1 - this.pmv('enWpn')));
        }
        break;
      case 'melee':
        {
          const m = this.melee;
          // 敵人對玩家的近戰：先預備 CUE_MELEE 秒並提示（meleeCueTick 時間到再出手）
          if (m.cue) return true;
          if (
            !this.pilotEnt() &&
            !m.active &&
            !g.pvp &&
            !this.rtsDef &&
            !(this.cueUntil > this.t) &&
            targetEnt &&
            targetEnt.pilotEnt &&
            targetEnt.pilotEnt()
          ) {
            m.cue = { slot, t: CUE_MELEE, te: targetEnt, fx: 0 };
            this.atkCue(targetEnt, CUE_MELEE, (meleeMove(d, 0) || { dur: 0.4 }).dur + 0.15);
            return true;
          }
          if (m.active && m.slot === slot) {
            // 排入下一招：依按下這一格的方向（方向派生，data/melee.js）
            const cur = meleeMove(d, m.stage);
            const A = this.meleeA();
            if (cur && m.t > cur.dur * (A ? A.buf : QUEUE_AT)) {
              // 方向派生只給玩家操作的機體（電腦追著目標跑時不該變成「前＋近戰」）；玩家可以先行輸入（A.buf）
              const k = A ? this.meleeDirKey(m.dir).k : '';
              const nx = meleeNext(d, m.stage, k);
              if (nx >= 0) {
                m.queued = nx;
                m.qDir = k; // 按下時沒推方向：觸控之後的滑動還能改成派生（meleeSwipeDir）
              }
              this.tutE('press', { queue: true });
            } else this.tutE('early', { st: cur });
            return true;
          }
          if (m.active) {
            // 左右手交替：一隻手的近戰過了一半，另一隻手的近戰武器接它的第一招（玩家；次數有上限）
            const cur = meleeMove(this.weapons[m.slot].def, m.stage);
            if (this.pilotEnt() && cur && !cur.exec && m.t > cur.dur * 0.5 && (m.swapN || 0) < SWAP_MAX) {
              m.queued = this.meleeStartIdx(d, slot);
              m.qSlot = slot;
              this.tutE('press', { queue: true });
              return true;
            }
            return false;
          }
          // 收招後的寬限（玩家）：上一招收招後 grace 秒內按近戰＝接下一招，不從第一招重來
          const G = this.meleeGrace;
          if (G && G.slot === slot && this.pilotEnt()) {
            this.meleeGrace = null;
            const nx = meleeNext(d, G.stage, this.meleeDirKey().k);
            if (nx >= 0 && this.useEn(d.enCost * (0.6 + this.pmv('mChain')))) {
              this.tutE('press', { queue: true });
              this.startMeleeStage(slot, nx, targetPos, targetEnt || G.target, false);
              return true;
            }
            if (w.cd > 0) return false;
          }
          if (!this.useEn(d.enCost)) return false;
          this.tutE('press', {});
          // QB 取消後接回連段（meleeResume）、突擊推進中的衝刺斬、空中的空中連段、方向派生的起手
          const R = this.meleeResume;
          if (R && R.slot === slot && R.next >= 0 && this.pilotEnt()) {
            this.meleeResume = null;
            this.startMeleeStage(slot, R.next, targetPos, targetEnt || R.target, false);
            this.melee.qbN = R.n;
            this.tutE('resume', {});
          } else this.meleeGo(slot, this.meleeStartIdx(d, slot), targetPos, targetEnt);
        }
        break;
    }
    if (usesAmmo(d)) {
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
      // 合併過的網格先還原（武器的網格回到武器節點底下），拆下之後剩下的再合併（render/mesh-merge.js）
      if (this.model.unmerge) this.model.unmerge();
      wm.updateMatrixWorld(true);
      const piece = new THREE.Group();
      wm.matrixWorld.decompose(piece.position, piece.quaternion, piece.scale);
      for (const c of [...wm.children]) {
        wm.remove(c);
        piece.add(c);
      }
      if (this.model.remerge) this.model.remerge();
      this.xrayFor = null; // 透視輪廓重新掛（game/camera.js 的 camXray）
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
            const gy = g.world.terrainHeight(piece.position.x, piece.position.z) + 0.25 * this.dk;
            if (piece.position.y < gy) {
              piece.position.y = gy;
              if (Math.abs(v.y) < 3 * this.dk) rest = true;
              else {
                v.y *= -0.35;
                v.x *= 0.5;
                v.z *= 0.5;
                av.multiplyScalar(0.4);
                g.fx.dust(piece.position.clone(), 0.8, 4);
              }
            }
          }
          if (t > 0.85) piece.position.y -= dt * 0.6 * this.dk;
        },
      });
    }
    this.weapons[slot] = {
      def: this.dk === 1 ? rtsWeaponDef(FIST_DEF) : pilotWeaponDef(FIST_DEF, this.pm),
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
  // 方向派生的方向（玩家）：這一格按著的方向鍵本身（data/melee.js 的 meleeKeyDir；player.js／mp-host.js 設定 inKey）
  meleeDirKey() {
    return (this.pilotEnt() && this.inKey) || NO_KEY;
  }
  // 起手招（玩家）：突擊推進中＝衝刺斬（dashMove）、空中＝空中連段（airMoves）、方向派生的起手（start）；其他＝第 1 招
  // k＝起手的方向（沒給時看這一格的方向）
  meleeStartIdx(d, slot, kOv) {
    if (!this.pilotEnt() || !d.combo) return 0;
    const pick = (ref) => meleeIdx(d, ref);
    if (this.shield && this.shieldHitT > 0 && pick('bash') >= 0) {
      this.shieldHitT = 0;
      return pick('bash');
    }
    if (this.abT > 0 && d.dashMove !== undefined && pick(d.dashMove) >= 0) return pick(d.dashMove);
    if (!this.grounded && d.airMoves !== undefined && pick(d.airMoves) >= 0) return pick(d.airMoves);
    const k = kOv !== undefined ? kOv : this.meleeDirKey().k;
    if (k && d.start && d.start[k] !== undefined && pick(d.start[k]) >= 0) return pick(d.start[k]);
    return 0;
  }
  // 出起手招（記下中立起手：觸控之後的滑動還能改成方向起手，meleeSwipeDir）
  meleeGo(slot, si, targetPos, targetEnt, k = '') {
    this.startMeleeStage(slot, si, targetPos, targetEnt);
    const m = this.melee;
    m.sDir = si === 0 && !k && this.grounded && !(this.abT > 0) ? '' : 'x';
    m.sT = this.t;
    m.sStage = si;
  }
  // 觸控在攻擊鍵上的滑動（inKey.sw，按下攻擊之後才滑完）：排好的下一招還沒出手前改成派生；
  // 中立起手的第一招還沒打中前改成方向起手（start）
  meleeSwipeDir() {
    const m = this.melee,
      K = this.inKey;
    if (!m.active || !K || !K.sw || !K.k || !this.meleeA()) return;
    const d = this.weapons[m.slot].def;
    if (m.queued >= 0 && m.qDir === '' && !m.qSlot) {
      const nx = meleeNext(d, m.stage, K.k);
      if (nx >= 0) {
        m.queued = nx;
        m.qDir = K.k;
      }
    } else if (m.sDir === '' && m.stage === m.sStage && !m.hitAny && d.start) {
      const i = d.start[K.k] !== undefined ? meleeIdx(d, d.start[K.k]) : -1;
      if (i >= 0 && i !== m.stage) {
        m.sDir = K.k;
        const tg = m.target && !m.target.dead ? m.target : null;
        this.startMeleeStage(
          m.slot,
          i,
          tg ? tg.center() : this.center().add(m.dir.clone().multiplyScalar(10)),
          tg,
        );
      }
    }
  }
  // 玩家機體的輸入寬容（data/melee.js 的 MELEE_ASSIST；mAssist＝'easy'｜'std'，由 player.js／mp-host.js 設定）；電腦是 null
  meleeA() {
    return this.pilotEnt() ? meleeAssist(this.mAssist) : null;
  }
  // 中斷近戰（取消、硬直）
  meleeEnd() {
    this.meleeGrace = null;
    const m = this.melee;
    m.cue = null;
    if (m.exec && m.exec.tg) m.exec.tg.execBy = null;
    m.exec = null;
    m.active = false;
    m.queued = -1;
    m.qSlot = null;
    this.swing = { l: 0, r: 0 };
  }
  // ---------- 防禦反擊（docs/melee-combo-design.md 第 4 期、「反擊的提示與放寬」）----------
  // 出招前的提示（敵人）：T＝提示到出手的秒數、post＝出手後還算的秒數（揮刀、子彈飛行）；這段時間內玩家按近戰／QB
  // 就記下這個敵人（cueArmSet），它這一擊打過來時彈刀／完美迴避。o.quiet＝只記狀態（近戰訓練的假人自己畫預警）
  atkCue(tgt, T, post, o = {}) {
    this.cueN = (this.cueN || 0) + 1;
    this.cueTgt = tgt ? tgt.id : -1;
    this.cueUntil = this.t + T + post;
    if (o.quiet) return;
    const g = this.game,
      c = this.center();
    g.fx.flash(c, (2.2 * (this.scale || 1)) / g.fx.k, 0xff4030, 0.25);
    g.fx.ring(c, 3 * (this.scale || 1), 0xff4030);
    if (g.popDamage)
      g.popDamage(c.clone().add(new THREE.Vector3(0, 2.5 * this.dk, 0)), '!', false, true, false, 0, this.id);
    SFX.play('alarm', 0.4, 1.15, 0.02, 0.02, c);
  }
  // 出招前的預備中（HUD 的大「!」；快照的 aw 位元 32 給客機）
  cueingNow() {
    const mv = this.sn && this.sn.mv;
    return !!(
      (this.melee && this.melee.cue) ||
      (mv && mv.ph === 'wind' && this.cueUntil > this.t) ||
      (this.tutD && this.tutD.tele)
    );
  }
  // 敵人近戰的預備（move 每格）：停下來面向目標、紅光閃爍；硬直中暫停，失衡或目標不見就取消；時間到出手
  meleeCueTick(dt, wish) {
    const m = this.melee,
      C = m.cue,
      te = C.te;
    if (this.staggerT > 0 || !te || te.dead) {
      m.cue = null;
      return wish;
    }
    if (this.hitStunT > 0) {
      this.cueUntil += dt; // 被打中的硬直期間不算時間
      return new THREE.Vector3();
    }
    this.aimYaw = Math.atan2(-(te.pos.x - this.pos.x), -(te.pos.z - this.pos.z));
    if ((C.fx -= dt) <= 0) {
      C.fx = 0.14;
      const g = this.game;
      g.fx.flash(this.center(), (1.3 * (this.scale || 1)) / g.fx.k, 0xff4030, 0.1);
    }
    if ((C.t -= dt) <= 0) {
      m.cue = null;
      this.fire(C.slot, te.center(), te);
    }
    return wish.clone().multiplyScalar(0.3);
  }
  // 玩家按近戰（k 'p'）或 QB（'q'）：記下現在對自己提示中的敵人（那一次的提示 cueN）
  cueArmSet(k) {
    const g = this.game;
    if (!g.hostilesOfEnt) return;
    const A = this.cueArm || (this.cueArm = { p: new Map(), q: new Map() });
    for (const e of g.hostilesOfEnt(this))
      if (e.cueN && e.cueTgt === this.id && e.t <= e.cueUntil) A[k].set(e.id, e.cueN);
  }
  // 這個敵人的這一擊是不是提示中、玩家按過了
  cueArmed(k, from) {
    const A = this.cueArm;
    const n = A && from ? A[k].get(from.id) : undefined;
    if (n === undefined) return false;
    if (from.cueN !== n || from.t > from.cueUntil) {
      A[k].delete(from.id);
      return false;
    }
    return true;
  }
  // 彈刀：敵人的近戰打過來時，提示中按過近戰（cueArmed），或自己的近戰出招中（整招）且面向攻擊者（±90°）＝彈開
  meleeClash(from) {
    const m = this.melee;
    if (!this.pilotEnt() || from.team === this.team || !from.melee) return false;
    const armed = this.cueArmed('p', from);
    const st = m.active ? meleeMove(this.weapons[m.slot].def, m.stage) : null;
    if (st && st.exec) return false;
    const to = from.pos.clone().sub(this.pos).setY(0);
    if (to.lengthSq() < 1e-4) to.set(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
    to.normalize();
    if (!armed) {
      if (!st) return false;
      const f = m.dir || new THREE.Vector3(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
      if (to.dot(f) < 0) return false;
    } else this.cueArm.p.delete(from.id); // 一次提示彈一次
    const g = this.game;
    if (from.melee.active) from.meleeEnd();
    from.hitStunT = Math.max(from.hitStunT || 0, from.isBoss ? PARRY_STUN_BOSS : PARRY_STUN);
    from.vel.addScaledVector(to, 10 * this.dk);
    this.vel.addScaledVector(to, -6 * this.dk);
    this.parryT = PARRY_T;
    const c = this.center().lerp(from.center(), 0.5);
    g.fx.flash(c, 1.6, 0xfff0c0, 0.12);
    g.fx.streaks(c, 16, 0xffe0a0, 22, 0.3, 22);
    g.fx.shockwave(c, 4, 0xffd070, 0.3);
    g.fx.hitStop = Math.max(g.fx.hitStop, 0.12);
    SFX.play('shield', 1, 0.8, 0.05, 0.03, this.isPlayer ? null : c);
    g.popDamage(c, '彈刀', false, true, false, 0, from.id);
    this.tutE('parry', {});
    if (this.isPlayer) {
      g.camShake = Math.max(g.camShake, 0.2);
      g.rumble(0.9, 0.7, 200);
    }
    return true;
  }
  // 完美 QB 的迴避（takeDamage）：提示中按過 QB 的那個敵人的這一擊（cueArmed），或 QB 開始後 PQB_WIN 秒內（PvP 除外）
  pqbDodge(from) {
    if (!from || from.team === this.team || !this.pilotEnt()) return false;
    if (this.cueArmed('q', from)) return true;
    return !this.game.pvp && this.t - (this.qbStartT === undefined ? -9 : this.qbStartT) <= PQB_WIN;
  }
  // 完美 QB：躲掉敵人的攻擊 → 接下來的第一下近戰加強；單人時畫面短暫變慢（force＝pqbDodge 已經判定過）
  pqbCheck(from, force) {
    if (!this.pilotEnt() || !from || from.team === this.team || this.pqbCD > 0) return;
    if (!force && !(this.t - (this.qbStartT === undefined ? -9 : this.qbStartT) <= PQB_WIN)) return;
    const g = this.game;
    this.pqbT = PQB_BUFF;
    this.pqbCD = 0.6;
    if (!g.net) g.fx.hitStop = Math.max(g.fx.hitStop, PQB_SLOW);
    this.tutE('pqb', {});
    if (this.isPlayer) g.pqbFx(this);
    else if (this.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: this.slot, k: 'pqb', i: this.id });
  }
  // ---------- 處決（docs/melee-combo-design.md 第 3 期）----------
  // 近戰鍵按住的時間（玩家：player.js、房主處理客機：mp-host.js）；按住 EXEC_HOLD 秒、附近有失衡的敵人＝處決
  meleeHeld(slot, held, dt, allow) {
    const k = slot === 'rarm' ? 'mHoldR' : 'mHoldL';
    if (!held) return void (this[k] = 0);
    const t0 = this[k] || 0;
    this[k] = t0 + dt;
    if (!allow || t0 >= EXEC_HOLD || this[k] < EXEC_HOLD || !this.pilotEnt() || !this.canAct()) return;
    const d = this.weapons[slot] && this.weapons[slot].def;
    if (!d || d.type !== 'melee' || meleeIdx(d, d.exec) < 0) return;
    if (this.melee.active && meleeMove(this.weapons[this.melee.slot].def, this.melee.stage).exec) return;
    const tg = this.execTarget(d);
    if (tg) this.startExec(slot, tg);
  }
  // 可以處決的目標：失衡中、在近戰距離＋EXEC_R 內；Boss、部位、目標物、物件不行；鎖定的優先，其他取最近
  execTarget(d) {
    const st = meleeMove(d, meleeIdx(d, d.exec));
    const R = st.reach * this.scale + EXEC_R * this.dk;
    const ok = (t) =>
      t &&
      !t.dead &&
      t.staggerT > 0 &&
      !t.isBoss &&
      !t.isProp &&
      !t.decoy &&
      !['part', 'objective', 'convoy', 'holo', 'bld'].includes(t.ai) &&
      Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) < R && // 水平距離（斜坡上的高低差不算）
      Math.abs(t.pos.y - this.pos.y) < R;
    if (ok(this.lock)) return this.lock;
    if (ok(this.melee.target)) return this.melee.target;
    let best = null,
      bd = 1e9;
    for (const t of this.game.hostilesOfEnt(this)) {
      if (!ok(t)) continue;
      const dd = t.pos.distanceTo(this.pos);
      if (dd < bd) ((bd = dd), (best = t));
    }
    return best;
  }
  startExec(slot, tg) {
    const g = this.game,
      d = this.weapons[slot].def,
      idx = meleeIdx(d, d.exec),
      st = meleeMove(d, idx);
    this.meleeEnd();
    this.meleeResume = null;
    // 對位：處決方站到目標的正面、面向它
    const dir = this.pos.clone().sub(tg.pos).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(-Math.sin(tg.yaw), 0, -Math.cos(tg.yaw));
    dir.normalize();
    const p = tg.pos.clone().addScaledVector(dir, st.reach * this.scale * 0.55);
    p.y = g.world.groundAt(p.x, p.z, tg.pos.y + 4 * this.dk);
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    tg.vel.set(0, 0, 0);
    tg.yaw = tg.aimYaw = Math.atan2(-dir.x, -dir.z); // 目標面向處決方
    this.startMeleeStage(slot, idx, tg.center(), tg);
    this.melee.exec = { tg, hit: 0 };
    this.iFrames = Math.max(this.iFrames, st.dur + 0.2);
    tg.staggerT = Math.max(tg.staggerT, st.dur + 0.4);
    tg.execBy = this.id;
    this.tutE('exec', {});
    g.fx.hitStop = Math.max(g.fx.hitStop, 0.08);
    if (this.isPlayer) g.flashMsg('處決 — ' + st.name.replace(/^處決・/, ''), 0xffd040, 1.2);
    SFX.stagger(this.isPlayer ? null : this.center());
  }
  // 處決的每一下（updateMelee）：最後一下＝一般敵人擊破、AC 與精英 EXEC_ACE_K 的 AP；回復 AP、EN 全滿、掉彈藥箱
  execHit(st, d, last) {
    const g = this.game,
      m = this.melee,
      tg = m.exec && m.exec.tg;
    if (!tg || tg.dead) return;
    const hp = tg.center().lerp(this.center(), 0.3);
    const ace = tg.ace || tg.ai === 'ac' || tg.isElite;
    const dmg = last ? (ace ? tg.maxHp * EXEC_ACE_K : tg.hp + tg.maxHp) : tg.maxHp * 0.04;
    tg.takeDamage(
      dmg,
      0,
      this,
      hp,
      m.dir.clone(),
      { kb: 0, lift: 0, exec: true, finisher: last },
      d.id,
      'none',
    );
    g.fx.meleeHit(hp, d.color, last, m.dir);
    mechFlash(tg.model, d.color, 0.2);
    g.fx.hitStop = Math.max(g.fx.hitStop, last ? 0.16 : 0.07);
    if (this.isPlayer) {
      g.camShake = Math.max(g.camShake, last ? 0.34 : 0.16);
      g.rumble(last ? 1 : 0.6, last ? 0.9 : 0.4, last ? 360 : 120);
    }
    SFX.meleeHit(last, this.isPlayer ? null : hp);
    if (!last) return;
    this.tutE('execKill', { kill: tg.dead });
    if (!tg.dead) tg.staggerT = Math.max(tg.staggerT, 0.6);
    this.hp = Math.min(this.maxHp, this.hp + this.maxHp * EXEC_HEAL);
    this.en = this.enMax;
    if (g.spawnPickup && g.world && !g.pvp && !g.lab) {
      const [x, z] = g.world.nearSolid ? g.world.nearSolid(tg.pos.x, tg.pos.z) : [tg.pos.x, tg.pos.z];
      g.spawnPickup('ammo', new THREE.Vector3(x, g.world.groundAt(x, z, tg.pos.y + 1) + 0.6, z));
    }
  }
  // fresh＝新的連段（連段裡的接招、QB 接回時 false：保留取消與換手的次數）
  startMeleeStage(slot, stage, targetPos, targetEnt, fresh = true) {
    const m = this.melee,
      d = this.weapons[slot].def,
      st = meleeMove(d, stage);
    const g = this.game;
    m.active = true;
    m.slot = slot;
    m.stage = stage;
    m.t = 0;
    if (fresh) ((m.qbN = 0), (m.swapN = 0));
    // 提示過的敵人近戰：連段的後面幾招也算在同一次提示裡（按過 QB 的照樣迴避）
    if (!this.pilotEnt() && this.cueUntil >= this.t)
      this.cueUntil = Math.max(this.cueUntil, this.t + st.dur + 0.15);
    m.hitAny = false;
    m.exec = null;
    m.qSlot = null;
    if (this.sts) this.statusMelee(); // 近戰割開捕獲網、纏附（mech-status.js）
    m.queued = -1;
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
    // 側滑的招式（side）：往目標的左／右繞過去（依按下的方向），出招中不再轉向目標
    m.noTrack = false;
    if (st.side) {
      const sd = this.meleeDirKey().side || (stage % 2 ? -1 : 1);
      const a = SIDE_ANG * sd;
      const ca = Math.cos(a),
        sa = Math.sin(a);
      // 右邊＝(−z, x)：dir·cos + 右·sin
      m.dir.set(m.dir.x * ca - m.dir.z * sa, 0, m.dir.z * ca + m.dir.x * sa).normalize();
      m.noTrack = true;
    }
    this.aimYaw = Math.atan2(-m.dir.x, -m.dir.z);
    // 突進追擊（射擊 → 近戰的連接）：對失衡中的目標，突進距離放寬到 LUNGE_K 倍，從遠處一口氣貼上去
    m.lungeK = 1;
    if (this.pilotEnt() && m.target && !m.target.dead && m.target.staggerT > 0 && st.dash > 0) {
      const need = m.target.pos.distanceTo(this.pos) - st.reach * this.scale;
      m.lungeK = clamp(need / st.dash, 1, LUNGE_K);
    }
    // 完美 QB 之後的第一下：衝擊 ×PQB_IMP、突進距離 ×PQB_LUNGE
    m.impK = 1;
    if (fresh && this.pqbT > 0 && !st.exec) {
      this.pqbT = 0;
      m.impK = PQB_IMP;
      if (m.target && !m.target.dead) m.lungeK = Math.max(m.lungeK, PQB_LUNGE);
    }
    // 衝刺斬：傷害與衝擊依出招時的速度
    m.spdK = 1;
    if (st.dashSlash) {
      const v = Math.hypot(this.vel.x, this.vel.z);
      m.spdK = clamp(1 + (v / (this.stats.speed * this.speedMul * 2.2)) * 0.35, 1, 1.35);
    }
    this.tutE('mv', { slot, stage, st, fresh, lunge: m.lungeK > 1.3, pqb: m.impK > 1 });
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
      st = meleeMove(d, m.stage);
    m.t += dt;
    // 處決：兩台都不動，照招式的 hits 打出每一下（execHit），結束後回到一般狀態
    if (st.exec) {
      const ex = m.exec,
        tg = ex && ex.tg;
      this.vel.x = this.vel.z = 0;
      if (tg && !tg.dead) {
        tg.vel.x = tg.vel.z = 0;
        tg.staggerT = Math.max(tg.staggerT, 0.3);
      }
      const hits = st.hits || [0.8];
      while (ex && ex.hit < hits.length && m.t / st.dur >= hits[ex.hit]) {
        ex.hit++;
        this.execHit(st, d, ex.hit === hits.length);
      }
      if (m.t >= st.dur) {
        this.meleeEnd();
        this.weapons[m.slot].cd = 0.4;
      }
      return;
    }
    // tracking toward target during wind-up
    if (m.target && !m.target.dead && m.t < st.dur * 0.5 && !m.noTrack) {
      const to = m.target.pos.clone().sub(this.pos);
      to.y = 0;
      if (to.length() > 1 * this.dk) m.dir.lerp(to.normalize(), Math.min(1, dt * 8)).normalize();
      this.aimYaw = Math.atan2(-m.dir.x, -m.dir.z);
    }
    const ph = m.t / st.dur;
    const burst = d.id === 'w_fist' ? 0.3 : 0.6;
    let dashSpd = ph < burst ? (st.dash * (m.lungeK || 1)) / (st.dur * burst) : 0; // 拳擊：前 30% 瞬間衝刺；其他近戰前 60%
    // 突進追擊：貼上目標就停（不穿過去）
    if (m.lungeK > 1 && m.target && !m.target.dead) {
      const dd = Math.hypot(m.target.pos.x - this.pos.x, m.target.pos.z - this.pos.z);
      if (dd < st.reach * this.scale * 0.7) dashSpd = 0;
    }
    this.vel.x = m.dir.x * dashSpd;
    this.vel.z = m.dir.z * dashSpd;
    if (st.slam && ph < 0.4) this.vel.y = Math.max(this.vel.y, 3 * this.dk);
    // 空中招式：出招期間滯空、高度往目標靠；下劈（dive）後半往下砸
    if (st.air && !this.grounded) {
      if (st.dive && ph > 0.35) this.vel.y = Math.min(this.vel.y, -DIVE_V * this.dk);
      else {
        const ty = m.target && !m.target.dead ? m.target.pos.y - this.pos.y : 0;
        this.vel.y = clamp(ty * 3, -8, 8) * this.dk;
      }
    }
    if (Math.random() < dt * 30) g.fx.boostFlame(this.center(), m.dir.clone().negate(), d.color);
    // hit window
    if (ph > 0.1 && ph < 0.85) {
      const targets = g.hostilesOfEnt(this).concat(g.destructibles(this.team));
      const c = this.center();
      g.tempWallMelee(
        c,
        st.reach * this.scale + 1.0,
        st.dmg * this.dmgMul * this.stats.parts.arms.melee,
        m.hit,
      ); // 臨時障礙物
      for (const t of targets) {
        if (t.dead || m.hit.has(t.id)) continue;
        // 物件以外形上最近的點算距離與方向（world/prop-hit.js）；其他以球
        const near = targetNear(t, c);
        const to = near.clone().sub(c);
        if (to.lengthSq() < 1e-4) to.copy(t.center()).sub(c); // 機體中心在物件裡面
        const dist = targetDist(t, c);
        if (dist > st.reach * this.scale + 1.0) continue;
        const ang = st.spin ? 0 : Math.abs(Math.atan2(to.x, to.z) - Math.atan2(m.dir.x, m.dir.z));
        const a2 = st.spin ? 0 : Math.min(ang, Math.PI * 2 - ang);
        if (a2 > THREE.MathUtils.degToRad(st.arc) / 2) continue;
        m.hit.add(t.id);
        const hp = t.shape ? near : t.center().lerp(c, 0.3);
        const mk = m.spdK || 1; // 衝刺斬的速度加成
        if (t.isProp) {
          g.damageProp(t, st.dmg * mk * this.dmgMul * this.stats.parts.arms.melee, st.impact, hp);
          g.fx.meleeHit(hp, d.color, m.dir.clone(), !!st.finisher);
          continue;
        }
        m.hitAny = true;
        t.takeDamage(
          st.dmg * mk * this.dmgMul * this.stats.parts.arms.melee,
          st.impact * mk * (m.impK || 1) * this.dmgMul,
          this,
          hp,
          m.dir.clone(),
          {
            kb: st.kb,
            lift: st.lift,
            down: st.dive ? DIVE_V * this.dk : 0,
            finisher: !!st.finisher,
            stagBonus: st.stagBonus,
            stun: meleeStun(st, ''),
          },
          d.id,
        );
        g.fx.meleeHit(hp, d.color, !!st.finisher, m.dir);
        mechFlash(t.model, d.color, 0.16);
        this.tutE('hit', {
          stage: m.stage,
          st,
          tgt: t,
          air: !t.grounded,
          lunge: m.lungeK > 1.3,
          pqb: m.impK > 1,
        });
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
      if (!m.hitAny) this.tutE('whiff', { st });
      // 接下一招（換手時用另一隻手的武器與它的 EN 消耗）
      const ns = m.qSlot || m.slot,
        nd = this.weapons[ns].def;
      if (m.queued >= 0 && this.useEn(nd.enCost * (0.6 + this.pmv('mChain')))) {
        const swap = ns !== m.slot;
        const n0 = m.swapN || 0;
        this.startMeleeStage(
          ns,
          m.queued,
          this.center().add(m.dir.clone().multiplyScalar(10)),
          m.target,
          false,
        );
        if (swap) {
          m.swapN = n0 + 1;
          this.tutE('swap', {});
        }
      } else {
        // 收招後的寬限（玩家）：這一招之後還接得下去時，grace 秒內按近戰＝接下一招
        const A = this.meleeA(),
          md = this.weapons[m.slot].def;
        if (A && !st.exec && ['', 'f', 's', 'b'].some((k) => meleeNext(md, m.stage, k) >= 0))
          this.meleeGrace = {
            slot: m.slot,
            stage: m.stage,
            t: A.grace,
            target: m.target,
            T: A.grace,
            dur: st.dur,
          };
        m.active = false;
        m.stage = 0;
        this.swing = { l: 0, r: 0 };
        this.weapons[m.slot].cd = st.finisher ? 0.6 : 0.3;
      }
    }
  }
  // 虛空（洋上都市、高空）：AI 不走進虛空；掉下去扣 10% AP（只在房主／單機）、1.5 秒無敵，拉回最後站穩的位置
  voidCheck(w, px, pz) {
    if (
      this.ai &&
      !this.flying &&
      w.isVoid(this.pos.x, this.pos.z) &&
      !w.isVoid(px, pz) &&
      this.pos.y - w.terrainHeight(px, pz) < 3 * this.dk
    ) {
      this.pos.x = px;
      this.pos.z = pz;
      this.vel.x = this.vel.z = 0;
      this.aiState.stuck += 0.05;
    }
    if (this.grounded && !w.isVoid(this.pos.x, this.pos.z)) {
      if (!this.safePos) this.safePos = new THREE.Vector3();
      this.safePos.copy(this.pos);
    }
    if (this.flying || this.pos.y >= w.voidY) return;
    // 還沒站穩過（例：運輸機投放在海上）：移到最近的實地，不拉回地圖中心
    let p = this.safePos;
    if (!p) {
      const [x, z] = w.nearSolid(this.pos.x, this.pos.z);
      p = new THREE.Vector3(x, w.terrainHeight(x, z), z);
    }
    this.pos.set(p.x, w.groundAt(p.x, p.z, p.y + 1), p.z);
    this.vel.set(0, 0, 0);
    this.iFrames = Math.max(this.iFrames, 1.5);
    const g = this.game;
    if (!g.isClient && !this.dead) this.hp = Math.max(1, this.hp - this.maxHp * 0.1);
    if (this.isPlayer) g.flashAlert('墜落 — AP −10%，返回平台');
    g.fx.ring(this.pos.clone().setY(this.pos.y + 0.1), 4, 0x80c8ff);
  }
  // attr＝攻擊屬性（data/attrs.js：kin／exp／en／none）；沒給時依 wid（武器 id）推算，都沒有時算實彈
  // ---------- 命中（火控、手臂的射擊適性） ----------
  fcsAssist(dist) {
    return fcsAssist(this.stats.parts.fcs, (dist * DS) / this.dk); // 距離帶是新尺度（Coral 戰爭換算）
  }
  // 預判準度：玩家照火控；電腦另外乘技巧（Boss 稍準、一般敵人保持原本的命中）
  leadK(dist) {
    let k = leadOf(this.fcsAssist(dist));
    if (!this.pilotEnt()) k *= (this.isBoss ? 1.05 : 0.85) * clamp(this.aiSkill || 1, 0.5, 1.25);
    return k;
  }
  // 追蹤的目標速度：手臂的射擊適性越高，目標換方向時跟得越快（QB 能甩開低適性的預判）
  trackVel(t) {
    const now = this.t;
    if (this.trkId !== t.id || !this.trkV) {
      this.trkId = t.id;
      this.trkV = t.vel.clone();
      this.trkT = now;
      return this.trkV;
    }
    const dt = Math.min(1, Math.max(0, now - this.trkT));
    this.trkT = now;
    this.trkV.lerp(t.vel, 1 - Math.exp(-trackRate(this.stats.parts.arms.aim) * dt));
    return this.trkV;
  }
  // 攔截點：目標中心＋追蹤速度 × 飛行時間 × 預判準度
  leadPoint(t, speed, muzzle) {
    const c = t.center();
    if (!speed) return c;
    const V = this.trackVel(t);
    let tt = c.distanceTo(muzzle) / speed;
    for (let i = 0; i < 2; i++) tt = c.clone().addScaledVector(V, tt).distanceTo(muzzle) / speed;
    return c.addScaledVector(V, tt * this.leadK(c.distanceTo(muzzle)));
  }
  // 鎖定時間：每格以目前的目標更新（玩家在 move、電腦在 updateAI）
  lockAge(t) {
    if (!t) {
      this.lkId = null;
      return 0;
    }
    if (this.lkId !== t.id) {
      this.lkId = t.id;
      this.lkT0 = this.t;
    }
    return this.t - this.lkT0;
  }
  // 多連導彈的發射數：火控的 lockSpeed 決定鎖滿全部需要的時間（1／lockSpeed 秒）；沒有目標時全部發射
  missileN(d, t) {
    const n = d.count || 1;
    if (!t || t.dead || n <= 1) return n;
    const full = 1 / ((this.stats.parts.fcs && this.stats.parts.fcs.lockSpeed) || 1);
    return clamp(Math.ceil((n * this.lockAge(t)) / full), 1, n);
  }
  takeDamage(dmg, impact, from, at, dir, melee, wid, attr) {
    if (this.dead) return;
    if (from && from.name) this.lastHitBy = from.name; // 主線失敗時的通訊用
    // 彈刀：玩家的近戰在有效期間、面向攻擊者時，敵人的近戰被彈開（出招時的短暫無敵也算）
    if (melee && !melee.exec && from && this.meleeClash(from)) return;
    // 完美 QB：提示中按了 QB、或 QB 剛開始時被打到＝迴避（不受傷）
    if (this.pqbDodge(from)) {
      this.pqbCheck(from, true);
      return;
    }
    if (this.iFrames > 0) {
      this.pqbCheck(from); // 完美 QB：QB 的無敵剛開始時躲掉了敵人的攻擊（docs/melee-combo-design.md 第 4 期）
      return;
    }
    if (this.sn) this.senseHit(from, dmg); // 仇恨與交戰（mech-sense.js）
    this.tutE('hurt', { melee: !!melee, shield: this.shield > 0 }); // 近戰訓練（game/tutorial.js）
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
    // 護盾產生器的護盾、盾牌 MT 的正面（mech-special.js）：null＝完全擋下
    const sd = this.specialDefense(dmg, impact, from, at, melee, wid);
    if (!sd) return;
    [dmg, impact] = sd;
    const W = weaponById(wid);
    const cls = melee ? 'melee' : W ? W.type : null; // 武器種類（失衡連攜用）
    if (this.markT > 0) dmg *= 1.3; // 被軌道標定衛星標定（mech-foe.js）
    if (this.laserK !== 1 && isLaserWeapon(W)) dmg *= this.laserK; // 雷射類的傷害倍率（laserK）
    if (this.sn && this.sn.vuln > 0) dmg *= 1.25; // 招式後的破綻（過熱，mech-moves.js）
    if (melee) {
      this.comboHits = (this.comboHits || 0) + 1;
      this.comboT = 1.2;
      if (!melee.exec) dmg *= comboDecay(this.comboHits); // 同一個目標連續被打：傷害遞減（data/melee.js）；處決不算
      if (melee.stagBonus && this.staggerT > 0) dmg *= melee.stagBonus;
      // 被打的硬直（電腦的機體；Boss、部位、目標物沒有，敵對 AC 很短）
      if (melee.stun > 0 && !this.pilotEnt() && !this.isBoss && this.ai !== 'part' && !this.isProp) {
        const kind = this.ace || this.ai === 'ac' || this.isElite ? 'ace' : '';
        const s = kind === 'ace' ? Math.min(melee.stun, STUN_ACE) : melee.stun;
        this.hitStunT = Math.max(this.hitStunT || 0, s);
      }
      if (dir) {
        const kb = melee.kb * (this.isBoss ? 0.2 : 1);
        this.vel.x += dir.x * kb;
        this.vel.z += dir.z * kb;
      }
      if (melee.lift && !this.isBoss && this.stats.parts.legs.type !== 'tank') {
        this.vel.y = Math.max(this.vel.y, melee.lift);
        this.grounded = false;
      }
      if (melee.down && !this.isBoss && !this.grounded) this.vel.y = Math.min(this.vel.y, -melee.down); // 下劈：砸回地面
      const parried = !!(from && from.parryT > 0 && !this.isBoss);
      if (parried) from.parryT = 0;
      if (
        (this.comboHits >= 3 || melee.finisher || parried) &&
        this.staggerT <= 0 &&
        !this.isBoss &&
        !(this.stagGuardT > 0)
      ) {
        this.acs = this.acsMax;
        this.staggerT = melee.finisher ? 2.2 : 1.6;
        this.stagBy = from ? { id: from.id, cls } : null;
        this.knockSide = Math.random() < 0.5 ? -1 : 1;
        if (from && from.tutE) from.tutE('stag', { tgt: this, melee: true });
        this.game.fx.ring(this.center(), 4, 0xff6040);
        SFX.stagger(this.isPlayer ? null : this.center());
        this.game.fbBreak(this, from);
      }
      dir = null;
    }
    mechFlash(this.model);
    this.hitAnim(
      dir || (from && from.pos ? this.pos.clone().sub(from.pos) : null),
      clamp(impact / 600, 0.15, 1.6),
    );
    if (dir) {
      const kb = clamp(impact / 900, 0.05, 1.2) * (this.isBoss ? 0.15 : 1);
      this.vel.x += dir.x * kb * 6;
      this.vel.z += dir.z * kb * 6;
    }
    if (this.isPlayer) {
      if (impact >= 500) this.game.screenHit(clamp(impact / 1500, 0.25, 1)); // 重擊：閃光與色差
      this.game.camShake = Math.max(this.game.camShake, clamp(impact / 1500, 0.06, 0.3));
      this.game.rumble(clamp(impact / 700, 0.2, 1), clamp(impact / 400, 0.3, 1), clamp(impact / 4, 60, 260));
    } else if (impact >= 500) {
      this.game.camShake = Math.max(this.game.camShake, 0.12);
      this.game.fx.hitStop = 0.05;
    }
    let mul = 1;
    const A = attr || (wid && ATTRS[wid] ? wid : W ? weaponAttr(W) : 'kin');
    // 直擊補正（依武器）＋攻擊者的「破甲射擊」＋自己的「不屈」；處決的傷害是固定的，不套用
    if (this.staggerT > 0 && !(melee && melee.exec)) {
      mul = directOf(W) + (from && from.pmv ? from.pmv('stagDmg') : 0) + this.pmv('stagTaken');
      // 失衡連攜：打出失衡的人改用不同種類的武器打 → 直擊補正再 ×LINK_K
      const sb = this.stagBy;
      if (sb && from && from.id === sb.id && cls && cls !== sb.cls) {
        mul *= LINK_K;
        if (!sb.shown && from.team === 'player') {
          sb.shown = true;
          this.game.popDamage(
            this.center().setY(this.center().y + 2 * this.dk),
            '連攜',
            false,
            true,
            false,
            0,
            this.id,
          );
          this.game.fx.shockwave(this.center(), 3.5, 0x7fd8ff, 0.25);
        }
      }
    }
    mul *= 1 - this.defCut(A);
    if (A === 'en' && W && from && from.stats && from.stats.enAdapt) mul *= from.stats.enAdapt; // 能量武器適性
    const g = this.game;
    if (this.shield) {
      if (g.pilotCreditShield) g.pilotCreditShield(this, dmg * mul * this.shield);
      mul *= 1 - this.shield;
      if (from && from.team !== this.team) {
        this.shieldHitT = SHIELD_BASH_T; // 盾擊的時機（meleeStartIdx）
        this.tutE('shieldHit', {});
      }
    }
    const real = Math.round(dmg * mul);
    if (g.range) g.rangeHit(this, from, real, real / Math.max(0.05, 1 - this.defCut(A)), impact, wid, A); // 靶場的量測
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
    // 戰術模組「能量虹吸」：命中回復 EN（近戰多）
    if (from && from !== this && from.pm && real > 0 && from.pmv('hitEn') > 0)
      from.en = Math.min(from.enMax, from.en + from.enMax * from.pmv('hitEn') * (melee ? 0.15 : 0.004));
    // 戰術模組「緊急障壁」：AP 低於 30% 時無敵並回復
    const ls = this.pmv('lastStand');
    if (ls > 0 && this.hp > 0 && this.hp < this.maxHp * 0.3 && !(this.lastStandT > 0)) {
      this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.15 * ls);
      this.iFrames = Math.max(this.iFrames, 3);
      this.lastStandT = 60 / ls;
      g.fx.shockwave(this.center(), 6, 0x7ee081, 0.5);
      if (this.isPlayer) g.flashMsg('緊急障壁展開', 0x7ee081, 1.6);
    }
    this.dmgTaken += real;
    if (mp && g.mpStats) {
      const eff = Math.min(real, hpBefore); // 不計入超過剩餘 AP 的溢出傷害
      if (from && from.team === 'player' && from.slot !== undefined && g.mpStats[from.slot])
        g.mpStats[from.slot].dmg += eff;
      if (this.team === 'player' && this.slot !== undefined && g.mpStats[this.slot])
        g.mpStats[this.slot].taken += eff;
    }
    if (this.staggerT <= 0) {
      // 高處優勢：攻擊者比自己高 12 m 以上時衝擊 +25%
      const high =
        from && from !== this && from.center && from.center().y - this.center().y > 4 * this.dk ? 1.25 : 1;
      const guard = this.stagGuardT > 0; // 失衡後保護：累積變少、不會再次過載
      const pve = this.pilotEnt() && !this.game.pvp; // PvE 的玩家：衝擊較小、ACS 較快開始回復
      this.acs +=
        impact * (this.shield ? 0.6 : 1) * high * (guard ? STAG_GUARD_K : 1) * (pve ? PVE_IMP_K : 1);
      if (guard) this.acs = Math.min(this.acs, this.acsMax * STAG_GUARD_CAP);
      this.acsDecayDelay = pve ? PVE_ACS_DELAY : 1.2;
      if (this.acs >= this.acsMax) {
        this.acs = this.acsMax;
        // 玩家機體一律 1.4 秒（房主端的遠端玩家 isPlayer 為 false，不能用它判斷）。
        // Coral 戰爭（RTS）的單位兩隊一樣 2 秒：team 字串是沿用的 'player'／'enemy'，以前隊伍 1 的單位
        // 失衡 2.6 秒、隊伍 0 只有 1.4 秒，電腦對電腦時隊伍 0 的勝率明顯偏高（docs 13.18）
        this.staggerT =
          (this.isBoss
            ? 1.5
            : this.rtsTeam !== undefined
              ? 2.0
              : this.team === 'player'
                ? 1.4
                : this.team === 'enemy'
                  ? FOE_STAG_T
                  : 2.0) *
          (1 - this.pmv('stagT'));
        this.stagBy = from ? { id: from.id, cls } : null;
        if (from && from.tutE) from.tutE('stag', { tgt: this, melee: !!melee }); // 近戰訓練：ACS 過載也算打出失衡
        this.game.fx.ring(this.center(), 4, 0xffb020);
        // 打出敵人的失衡：短暫頓格（文字提示是命中位置的 BREAK，juice.js）
        if (this.team === 'enemy' && from && from.isPlayer) {
          this.game.fx.hitStop = Math.max(this.game.fx.hitStop, 0.07);
          this.game.fx.shockwave(this.center(), 4, 0xffb020, 0.3);
        }
        this.game.fbBreak(this, from);
        SFX.stagger(this.isPlayer ? null : this.center());
        if (this.isPlayer) {
          this.game.flashAlert('ACS 過載 — 姿態崩潰');
          this.game.rumble(1.0, 1.0, 600);
        }
        this.game.netEv({ t: 'stag', i: this.id });
        if (this.game.range) this.game.rangeStag(this, from);
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
    if (this.hp <= 0 && g.range && g.rangeSave(this)) return; // 靶場：目標 AP 無限、自己不會被擊破
    if (this.hp <= 0 && g.tut && g.tutSaveEnt(this)) return; // 近戰訓練：自己不會被擊破、假人照練習的設定
    if (this.hp <= 0) {
      if (mp && this.team === 'player' && !this.downed && !g.pvp) {
        this.enterDowned();
        return;
      }
      this.die(from);
    }
  }
  // 對某種屬性的減傷：機體的三種防禦＋敵人的弱點（res）
  defCut(A) {
    if (A === 'none') return 0;
    const D = this.stats.defs;
    const base = D ? D[A] || 0 : this.stats.def || 0;
    const r = this.res ? this.res[ATTR_KEYS.indexOf(A)] || 0 : 0;
    return clamp(base + r, -0.3, 0.6);
  }
  die(from) {
    if (this.dead) return;
    this.dead = true;
    if (this.sts || this.stsV) this.statusClearAll(true);
    const g = this.game;
    const c = this.center();
    this.specialDie(from);
    if (this.explodeOnDeath) {
      const E = this.explodeOnDeath;
      g.explodeAt(c, E.dmg, E.impact, E.splash * this.dk, this, true);
    }
    SFX.explode(this.isBoss ? 'huge' : true, this.isPlayer ? null : c);
    SFX.wreck(this.isPlayer ? null : c);
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
    // 人形機甲先跪倒崩落（fx.collapse）再碎裂；其他直接碎裂
    const brk = () => {
      g.fx.shatter(this, g.world);
      if (!this.isProp)
        g.fx.killBurst(c, (this.scale || 1) / g.fx.k, !!this.isBoss, g.world.groundAt(c.x, c.z, c.y));
      this.mesh.visible = false;
    };
    if (this.canCollapse()) {
      g.fx.explosion(c, (1.6 * (this.scale || 1)) / g.fx.k, 0xff8030);
      g.fx.collapse(this, brk);
    } else brk();
    g.camShake = Math.max(g.camShake, this.isBoss ? 0.5 : 0.2);
    // 最後一個 Boss 擊破：慢動作與橫幅
    if (
      this.isBoss &&
      this.team === 'enemy' &&
      !g.pvp &&
      (g.bosses || []).every((b) => b.dead || b === this)
    ) {
      g.fx.hitStop = Math.max(g.fx.hitStop, 0.5);
      g.showBanner('TARGET DESTROYED', `${this.name} 擊破`, '#ffb020', 3, {
        k: 'kill',
        m: '擊破',
        s: this.name,
      });
      g.netEv({ t: 'bossDown', n: this.name });
    }
    // 自己擊破敵人：頓格與衝擊環（擊破的回饋）
    if (this.team === 'enemy' && from && from.isPlayer && !g.pvp) {
      g.fx.hitStop = Math.max(g.fx.hitStop, this.isBoss ? 0.18 : 0.045);
      g.fx.shockwave(c, this.isBoss ? 10 : 5, 0xffa040, this.isBoss ? 0.6 : 0.35);
      g.fx.flash(c, this.isBoss ? 4 : 2, 0xffc080, 0.12);
    }
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
    this.statusClearAll(true);
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
    this.specialCleanup();
    this.statusVisClear();
  }

  // 涉水：站在 0.6 m 以上的水裡移動變慢（兩棲的 MARSH 反而變快）
  waterK() {
    const w = this.game.world;
    if (this.flying || !w.theme.water) return 1;
    if (this.pos.y - w.terrainHeight(this.pos.x, this.pos.z) > 0.6 * this.dk) return 1;
    if (w.waterDepth(this.pos.x, this.pos.z) < 0.6 * this.dk) return 1;
    return this.opts.amphib ? 1.1 : 0.85;
  }
  // ---------- physics ----------
  move(dt, wish, wantHover, wantQB, wantAB, targetEnt) {
    const g = this.game,
      w = g.world,
      P = this.stats.parts;
    // AI 分批（Game.aiStep）：updateAI 收到的是累積的 dt，移動仍用這一格的 dt；
    // 記下移動輸入，之後只移動的格子（aiCoast）沿用
    if (this.aiFrame) {
      dt = this.aiFrame;
      this.aiLast = { wish: wish.clone(), hover: wantHover, ab: wantAB, tgt: targetEnt };
    }
    if (this.buffT > 0) this.buffT -= dt;
    if (this.sts) this.statusTick(dt); // 狀態效果（entities/mech-status.js）：倒數、黏附炸彈、纏附、吸取 EN
    // 玩家（含房主端的遠端玩家）：鎖定時間依目前鎖定的目標（導彈的鎖定，missileN）
    if (this.team === 'player' && this.slot !== undefined && 'lock' in this)
      this.lockAge(this.lock && !this.lock.dead ? this.lock : null);
    // 自訂關卡的「守住」：原地轉向、開火，不移動
    if (this.edHold && !this.remote) {
      wish = new THREE.Vector3();
      wantQB = false;
      wantAB = false;
    }
    this.meleeSwipeDir(); // 觸控的滑動派生
    if (this.melee.cue) wish = this.meleeCueTick(dt, wish); // 敵人近戰的預備（提示）
    const spd =
      this.stats.speed *
      this.speedMul *
      (this.buffT > 0 ? 1.15 : 1) *
      this.waterK() *
      (this.sts ? this.stsSpeedK() : 1); // 指揮官 MT 強化、水中、狀態效果
    this.t += dt;
    // AI 閃避衝擊波時按住跳躍（Game.updateShocks 設定）
    if (this.aiJumpT > 0) {
      this.aiJumpT -= dt;
      if (!wantHover) wantHover = true;
    }
    // 電磁狩獵機的 EMP：一段時間內不能 QB、突擊推進、跳躍與懸浮
    if (this.empLockT > 0) {
      this.empLockT -= dt;
      wantQB = false;
      wantAB = false;
      wantHover = false;
    }
    // 不能跳躍與懸浮（狀態效果 nojump／net）
    if (this.sts && this.stsNoJump()) wantHover = false;
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
    if (this.stagGuardT > 0) this.stagGuardT -= dt;
    // 被近戰打中的硬直（只有房主／單機的電腦機體，takeDamage 設定）：不移動、不出招
    if (this.hitStunT > 0) {
      this.hitStunT -= dt;
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
        if (this.pilotEnt()) this.stagGuardT = STAG_GUARD;
        else if (this.isBoss) this.stagGuardT = BOSS_STAG_GUARD; // Boss：失衡後保護（不能一直壓著打）
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
    // 近戰的取消（docs/melee-combo-design.md 第 1 期）：上挑打中後按跳躍＝往目標追上去（接空中連段）；
    // QB 取消（過了一半）；玩家打中過時記下接回點，RESUME_T 秒內再按近戰從下一招接回
    const jumpEdge = !!wantHover && !this.mJumpPrev;
    this.mJumpPrev = !!wantHover;
    if (this.meleeResume && (this.meleeResume.t -= dt) <= 0) this.meleeResume = null;
    if (this.meleeGrace && (this.meleeGrace.t -= dt) <= 0) this.meleeGrace = null;
    for (const k of ['parryT', 'pqbT', 'pqbCD', 'shieldHitT']) if (this[k] > 0) this[k] -= dt;
    if (this.melee.active) {
      const m = this.melee,
        md = this.weapons[m.slot].def,
        mst = meleeMove(md, m.stage);
      const pilot = this.pilotEnt();
      if (pilot && jumpEdge && mst && mst.launch && m.hitAny && m.t > mst.dur * 0.35) {
        const tg = m.target && !m.target.dead ? m.target : null;
        this.meleeEnd();
        this.tutE('jc', {});
        if (tg) {
          const to = tg.pos.clone().sub(this.pos).setY(0);
          if (to.lengthSq() > 1e-4) to.normalize().multiplyScalar(spd * 1.1);
          this.vel.x = to.x;
          this.vel.z = to.z;
        }
      } else if (wantQB && !(mst && mst.exec) && (!mst || m.t > mst.dur * 0.5)) {
        if (pilot && m.hitAny && (m.qbN || 0) < QB_RESUME_MAX)
          this.meleeResume = {
            slot: m.slot,
            next: meleeNext(md, m.stage, ''),
            t: RESUME_T,
            n: (m.qbN || 0) + 1,
            target: m.target,
          };
        this.tutE('qbc', { resume: !!this.meleeResume });
        this.meleeEnd();
      } else {
        if (wantQB && pilot) this.tutE('qbEarly', {});
        wish = new THREE.Vector3();
        wantHover = false;
        wantAB = false;
      }
    } else {
      if (this.acsDecayDelay > 0) this.acsDecayDelay -= dt;
      else
        this.acs = Math.max(
          0,
          this.acs - this.acsMax * 0.45 * (1 + this.pmv('acsDec')) * (this.corrodeT > 0 ? 0.3 : 1) * dt, // 腐蝕區裡回復得慢
        );
      if (this.corrodeT > 0) this.corrodeT -= dt;
      if (this.markT > 0) this.markT -= dt;
    }
    if (this.iFrames > 0) this.iFrames -= dt;
    if (this.lastStandT > 0) this.lastStandT -= dt;
    if (this.enDelay > 0) this.enDelay -= dt;
    else
      this.en = Math.min(
        this.enMax,
        this.en + P.generator.recharge * dt * (this.grounded ? 1.6 + this.pmv('gnd') : 1),
      );
    // quick boost
    // 被鉤住、黏住、纏住時沒有方向也能 QB（原地甩動掙脫）；緩速時 QB 耗能增加
    const qbAny = wish.lengthSq() > 0.1 || (this.sts && this.stsQbEscape());
    if (wantQB && this.qbT <= 0 && qbAny && this.useEn(P.booster.qbCost * (this.sts ? this.stsQbK() : 1))) {
      this.qbT = 0.16;
      this.qbStartT = this.t; // 完美 QB 的判定（pqbDodge）
      if (this.pilotEnt()) this.cueArmSet('q'); // 提示中按 QB＝完美迴避
      this.tutE('qb', {});
      if (wish.lengthSq() > 0.1) this.qbDir.copy(wish).normalize();
      else this.qbDir.set(0, 0, 0);
      if (this.sts) this.statusQB(); // 掙脫（mech-status.js）
      if (this.pilotEnt()) g.aiNoise(this, NOISE_QB); // 敵人聽得到（game/ai-director.js）
      SFX.qb(this.isPlayer ? null : this.center());
      if (this.isPlayer) g.rumble(0.1, 0.35, 80);
      g.fx.chevrons(this.pos.clone(), this.qbDir.clone().negate(), 0xffffff);
      if (this.grounded) g.fx.dust(this.pos.clone(), (2.2 * this.scale) / g.fx.k, 7);
      this.iFrames = 0.14 + this.pmv('qbIF');
      if (this.pmv('qbRam') > 0) {
        this.ramT = 0.35;
        this.ramHit = new Set();
      }
    }
    // 戰術模組「衝撞推進」：QB 撞上敵人（房主／單機）
    if (this.ramT > 0) {
      this.ramT -= dt;
      if (!(g.net && g.net.role === 'client')) {
        const k = this.pmv('qbRam');
        for (const h of g.hostilesOfEnt(this)) {
          if (
            h.dead ||
            this.ramHit.has(h) ||
            Math.hypot(h.pos.x - this.pos.x, h.pos.z - this.pos.z) >
              this.radius + (h.radius || 1.5 * this.dk) + 1.2 * this.dk ||
            Math.abs(h.pos.y - this.pos.y) > 4 * this.dk
          )
            continue;
          this.ramHit.add(h);
          const dir = h.pos.clone().sub(this.pos).setY(0).normalize();
          h.takeDamage(600 * k, 1100 * k, this, h.center(), dir);
          g.fx.meleeHit(h.center(), 0xffd090);
          g.fx.hitStop = Math.max(g.fx.hitStop, 0.06);
        }
      }
    }
    // assault boost
    if (wantAB && targetEnt && this.en > 5) {
      if (this.abT <= 0) SFX.ab(this.isPlayer ? null : this.center());
      this.abT = 0.1;
      this.en -= P.booster.qbCost * 1.4 * dt;
      this.enDelay = 0.3;
      if (Math.random() < dt * 30)
        g.fx.boostFlame(
          this.center().add(
            new THREE.Vector3(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)).multiplyScalar(this.scale),
          ),
          this.vel.clone().normalize().negate(),
          0x9ff0ff,
        );
    }
    let target = new THREE.Vector3();
    if (this.qbT > 0) {
      this.qbT -= dt;
      target.copy(this.qbDir).multiplyScalar((P.booster.qb * this.dk) / DS);
      this.boost = true;
    } else if (this.abT > 0 && targetEnt) {
      this.abT -= dt;
      const d = targetEnt.pos.clone().sub(this.pos);
      d.y = 0;
      if (d.length() > 6 * this.dk) {
        target.copy(d.normalize()).multiplyScalar(spd * 2.2);
      }
      this.boost = true;
    } else {
      // 起跳後一小段時間維持地面的速度與轉向（跳躍要輕快）；Coral 戰爭的空中單位一直在空中，照定義的速度（R5）
      target
        .copy(wish)
        .multiplyScalar(spd * (this.grounded || this.jumpT > 0 || (this.flying && this.rtsDef) ? 1 : 0.85));
      this.boost = false;
    }
    // 電磁牽引：往牽引源拉（48 m/s；自己往反方向移動或 QB 可以抵銷）
    if (this.pullT > 0) {
      this.pullT -= dt;
      const src = this.pullSrc;
      if (src && !src.dead) {
        const to = src.pos.clone().sub(this.pos).setY(0);
        if (to.length() > 6 * this.dk) target.addScaledVector(to.normalize(), 16 * this.dk);
      }
    }
    // 狀態效果：鉤住時往鉤點拉、不能跳躍時空中往下拉
    if (this.sts) this.statusPull(target, dt);
    // 閘門砲台的開閘水流（game/support.js）：貼地時往下游推（48 m/s；客機的自身預測也一樣算）
    if (
      g.flows &&
      g.flows.length &&
      !this.flying &&
      !this.noPush &&
      this.pos.y - w.terrainHeight(this.pos.x, this.pos.z) < 3 * this.dk
    ) {
      const f = g.flowAt(this);
      if (f) {
        target.x += f.dx * 16 * this.dk;
        target.z += f.dz * 16 * this.dk;
      }
    }
    if (g.zones && g.zones.length) g.zonePull(this, target); // 吸引區域（game/hazards2.js）
    const acc = this.qbT > 0 ? 60 : this.grounded || this.jumpT > 0 ? 18 : 9;
    if (!this.melee.active) {
      this.vel.x = lerp(this.vel.x, target.x, Math.min(1, acc * dt));
      this.vel.z = lerp(this.vel.z, target.z, Math.min(1, acc * dt));
    } else this.updateMelee(dt);
    // vertical（高度上限與飛行高度：虛空上方以平台高度為準）
    const ground = w.groundRef(this.pos.x, this.pos.z, this.pos.y);
    let altCap = false;
    {
      const MAXALT = 22 * this.dk;
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
      const ty = ground + this.hoverH + Math.sin(this.t * 2) * 0.6 * this.dk;
      this.vel.y = lerp(this.vel.y, (ty - this.pos.y) * 3, 0.2);
      this.grounded = false;
      this.hover = true;
    } else {
      this.jumpMove(dt, wish, wantHover, spd, altCap);
      if (!this.hoverMode) {
        // 跳躍上升中用該腳部自己的重力（決定到頂時間），過了最高點一律用 GRAVITY
        this.vel.y -= (this.vel.y > 0 && this.riseG ? this.riseG : (GRAVITY * this.dk) / DS) * dt;
        if (this.vel.y < -36 * this.dk) this.vel.y = -36 * this.dk;
      }
    }
    if (this.pilotEnt()) this.oobPush(w, dt);
    // integrate
    const px0 = this.pos.x,
      pz0 = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y += this.vel.y * dt;
    {
      const ce = w.ceiling(this.pos.x, this.pos.z, this.pos.y, this.model.height);
      if (ce < 1e8) {
        this.pos.y = Math.min(this.pos.y, ce - this.model.height - 0.05 * this.dk);
        if (this.vel.y > 0) this.vel.y = 0;
      }
    }
    const g2 = w.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= g2) {
      if (!this.grounded && this.vel.y < -6 * this.dk)
        ((this.landT = 0), (this.landV = -this.vel.y / this.dk)); // landV：動作用（舊尺度的 m/s）
      if (!this.grounded && this.vel.y < -12 * this.dk) {
        g.fx.dust(this.pos.clone().setY(g2 + 0.05), (2.6 * this.scale) / g.fx.k, 9);
        SFX.land(this.isPlayer ? null : this.center(), clamp((-this.vel.y / this.dk - 12) / 18, 0, 1));
        if (this.isPlayer) {
          g.camShake = Math.max(g.camShake, 0.06);
          g.rumble(0.35, 0.2, 110);
        }
      }
      this.pos.y = g2;
      this.vel.y = Math.max(0, this.vel.y);
      this.grounded = true;
    } else if (this.pos.y > g2 + 0.15 * this.dk) this.grounded = false;
    const [nx, nz] = w.collide(this.pos.x, this.pos.z, this.pos.y, this.radius * 0.8, this.pilotEnt());
    this.aiState.stuck =
      Math.abs(nx - this.pos.x) + Math.abs(nz - this.pos.z) > 0.05 * this.dk ? this.aiState.stuck + dt : 0;
    this.pos.x = nx;
    this.pos.z = nz;
    // slope climb: if terrain rises steeply push up
    const tg = w.terrainHeight(this.pos.x, this.pos.z);
    if (this.pos.y < tg) {
      this.pos.y = tg;
    }
    if (w.voidY !== undefined) this.voidCheck(w, px0, pz0);
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
      this.leanX =
        this.model.cls === 'vehicle'
          ? clamp((af * 0.012) / this.dk, -0.25, 0.25) // 坦克只看加減速（等速時不傾斜）
          : clamp((af * 0.012 + vf * 0.004) / this.dk, -0.35, 0.35) + (this.qbT > 0 ? 0.18 : 0); // 加速前傾、減速後仰、QB 更前傾
      this.leanZ = clamp((-ar * 0.01) / this.dk, -0.28, 0.28); // 側向加速 → 向內側傾
      if (this.flying) {
        this.leanX *= 0.6;
      }
    }
    // yaw
    this.moving = Math.hypot(this.vel.x, this.vel.z) > 1.5 * this.dk;
    {
      const firing = this.recoil.l + this.recoil.r > 0.05 || this.melee.active;
      const faceAim = this.lock || firing || !this.moving || this.ai || this.fpFace; // 人形：有目標時整台機體面向目標，側移用側步
      this.faceAimNow = !!faceAim; // 手臂瞄準（armAimPoint）：自由移動時照機體正面持槍
      const targetYaw = faceAim ? this.aimYaw : Math.atan2(-this.vel.x, -this.vel.z);
      this.yaw = angLerp(this.yaw, targetYaw, Math.min(1, dt * (this.yawRate || (faceAim ? 10 : 14))));
    }
    ikRestore(this.model); // IK 改過的關節回到動作層的結果（animateMech 從那裡平滑）
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.order = 'YXZ';
    this.mesh.rotation.y = this.yaw;
    if (this.staggerT <= 0 && !this.downed) {
      this.mesh.rotation.x = lerp(this.mesh.rotation.x, this.leanTilt(), Math.min(1, dt * 8));
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
    // 飛行載具移動時微微前傾；坦克的砲塔不另外傾斜（車身已隨加減速俯仰）；人形機甲的上身俯仰由 animateMech 處理
    if (this.model.vehicle && this.model.cls !== 'vehicle')
      this.model.torso.rotation.x = lerp(
        this.model.torso.rotation.x,
        this.qbT > 0 ? -0.3 : this.moving ? -0.14 : 0,
        0.25,
      );
    this.recoil.l = Math.max(0, this.recoil.l - dt * 8);
    this.recoil.r = Math.max(0, this.recoil.r - dt * 8);
    this.recoil.bl = Math.max(0, (this.recoil.bl || 0) - dt * 8);
    this.recoil.br = Math.max(0, (this.recoil.br || 0) - dt * 8);
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
      // RTS 渲染設定：畫面外的單位（Game.lodTick 的 lodVis）動作每 4 格、鏡頭拉遠時每 2 格才更新一次（累積的 dt）；
      // 沒更新的格子骨頭只跟著整台移動（render/rts-merge.js 的 rtsPosed）
      let adt = dt;
      const ak = g.rtsR && !this.isPlayer ? (this.lodVis === false ? 4 : g.rtsR.hullOff ? 2 : 1) : 1;
      if (ak > 1) {
        this.animAcc = (this.animAcc || 0) + dt;
        this.animN = ((this.animN === undefined ? this.id || 0 : this.animN) + 1) % ak;
        adt = this.animN ? 0 : this.animAcc;
        if (adt) this.animAcc = 0;
      } else if (this.animAcc) {
        adt += this.animAcc;
        this.animAcc = 0;
      }
      if (g.rtsR) this.mesh.rtsPosed = adt > 0;
      if (adt)
        animateMech(this.model, adt, {
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
                  st2 = meleeMove(d, this.melee.stage);
                return {
                  kind: st2.spin ? 'spin' : st2.thrust ? 'thrust' : st2.slam ? 'slam' : 'slash',
                  ph: clamp(this.melee.t / st2.dur, 0, 1),
                  mirror: !!st2.mirror,
                  side: this.melee.slot === 'rarm' ? 1 : -1,
                  clip: MeleeAnim.clipFor(d, this.melee.stage),
                };
              })()
            : null,
          turn: this.turnS,
          landT: this.landT,
          aimRel:
            ((((this.aimYaw - this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI,
          leanZ: this.leanZ || 0,
          leanX: this.leanX || 0,
          ...this.animExtra(),
        });
      if (adt && !this.model.vehicle) applyIK(this.model, this.ikCtx(adt));
      if (adt) this.trailsTick(adt);
      if (adt) this.trailsTick(adt);
    }
    // ---- 推進器光暈與噴焰粒子、側噴嘴 ----
    // RTS 渲染設定：畫面外的單位不更新推進器（光暈與噴焰）
    if (!(g.rtsR && this.lodVis === false && !this.isPlayer)) {
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
            0.3 * this.scale,
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
          this.pos
            .clone()
            .add(new THREE.Vector3(rnd(-0.6, 0.6), 0.2, rnd(-0.6, 0.6)).multiplyScalar(this.scale)),
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
          this.center().add(
            new THREE.Vector3(rnd(-0.5, 0.5), 0.5, rnd(-0.5, 0.5)).multiplyScalar(this.scale),
          ),
          1.2 * this.scale,
        );
      }
    }
    if (this.staggerT > 0 && Math.random() < dt * 20)
      g.fx.spark(
        this.center().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(this.scale)),
        0xffb020,
      );
    this.specialFx(dt);
    if (this.sts || this.stsV) this.statusFx(dt);
  }
  // 跳躍與懸浮（同一個鍵分段）：地面按下＝跳躍；空中按下＝空中跳（還有次數時，向上的 QB，高度依次遞減）；
  // 按住到最高點接懸浮（定高）；懸浮中放開後馬上再按住＝爬升（耗能加倍）。沒有空中跳時空中按住直接懸浮。
  // 戰車能跳不能懸浮。
  // want：按住（AI 傳 2 表示要爬升）。jumpExt（房主處理客機輸入）時按下由 jumpPressQ 給，不從按住推算
  jumpMove(dt, wish, want, spd, altCap) {
    const g = this.game,
      P = this.stats.parts,
      J = this.dk === DS ? jumpSpec(P.legs) : scaleJump(jumpSpec(P.legs), this.dk / DS); // Coral 戰爭照舊尺度
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
        g.fx.dust(this.pos.clone(), (2.4 * this.scale) / g.fx.k, 8);
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
      this.vel.y = lerp(this.vel.y, (climb ? 7 : -0.5) * this.dk, Math.min(1, dt * (climb ? 5 : 6)));
      this.en = Math.max(0, this.en - (climb ? J.climb : J.hover) * (1 - this.pmv('hover')) * dt);
      this.enDelay = 0.5;
    }
    this.hover = this.hoverMode > 0;
  }
  // 推進器：噴口光暈（加色球體，隨推力縮放）＋噴焰。機甲的噴焰是粒子特效（沿噴口連接點的 −Y 噴出），
  // 載具（直升機、無人機）維持原本的尾焰
  thrusterFx(dt, glareCol, flameCol, jitter) {
    const g = this.game;
    if (!this.glare) this.glare = this.model.nozzles.map(() => g.fx.glareMesh(glareCol, this)); // this：戰爭迷霧裡看不到時不畫
    const thr = this.boost ? 1.0 : this.hover ? 0.7 : !this.grounded ? 0.45 : this.moving ? 0.28 : 0.06;
    this.thrS = lerp(this.thrS || 0, thr, Math.min(1, dt * 10));
    const wp = new THREE.Vector3(),
      dir = new THREE.Vector3();
    const veh = this.model.vehicle;
    // RTS 單位的骨頭群組（render/rts-merge.js）：噴口＝現在的根 × 上次算繪時相對根的矩陣，不往上更新一整串
    const rel = this.mesh.rtsRel;
    let rw = null;
    if (rel) {
      this.mesh.updateMatrix();
      rw = _rwM.copy(this.mesh.matrix);
      if (this.mesh.parent) rw.premultiply(this.mesh.parent.matrixWorld);
    }
    const cache = rw ? this.model.nzW || (this.model.nzW = []) : null;
    this.model.nzW = cache;
    this.model.nozzles.forEach((n, i) => {
      if (rw && rel(n, _nzM)) nozzleFrom(_nzM.premultiply(rw), wp, dir);
      else nozzleWorld(n, wp, dir);
      if (cache) {
        const c = cache[i] || (cache[i] = { p: new THREE.Vector3(), d: new THREE.Vector3() });
        c.p.copy(wp);
        c.d.copy(dir);
      }
      if (veh) dir.set(0, -1, 0);
      const m = this.glare[i];
      m.position.copy(wp).addScaledVector(dir, 0.35 * this.scale);
      const ck = this.cine ? 0.45 : 1; // 過場動畫的近拍：推進器的光暈小一點（game/cine.js）
      m.scale.setScalar(
        (0.25 + this.thrS * 1.3) * this.scale * ck * (jitter ? 0.9 + Math.random() * 0.2 : 1),
      );
      m.material.opacity = (0.15 + this.thrS * 0.55) * (this.cine ? 0.75 : 1);
    });
    if (!veh) {
      if (this.fogHid) return; // 戰爭迷霧裡看不到（game/rts-fog.js）：不噴（噴焰粒子沒有擁有者，不會跟著隱藏）
      this.model.nzFresh = true; // 噴口的世界矩陣剛算過（fx/thruster.js 的 nozzleWorld 不用再往上更新）
      g.fx.thruster.stream(this.model, this.thrS, flameCol, this.scale, dt, this.vel);
      this.model.nzFresh = false;
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
    // 滑行（animateMech 的 m.an.glide）：不踏步，相位停住、沒有腳步聲
    if (this.model.an && this.model.an.glide) {
      this.gaitLockOK = false;
      return;
    }
    this.gaitPh = ((this.gaitPh || 0) + rate * dt) % (Math.PI * 200);
    // 腳步聲：每半個步伐（腳落地）一次
    const sk = Math.floor(this.gaitPh / Math.PI);
    if (sk !== this.stepK) {
      this.stepK = sk;
      if (this.grounded && this.moving && this.game && this.game.mechStep) this.game.mechStep(this);
    }
  }
  // 手臂瞄準的點：機體沒有面向準星（自由移動時機體轉向移動方向）時改成機體正面，否則持槍的手會橫過胸前去瞄側面；
  // 偏差 0.35～0.7 rad 之間平滑切換（開火、鎖定時機體轉回準星，手臂也跟著回去）。
  // 本機的機體只在 move 判定不面向準星（faceAimNow）時才這樣（電腦機體轉身時手臂照樣先轉去瞄準）；客機看別人時只看偏差
  armAimPoint(aim) {
    if (this.faceAimNow && !this.remote) return aim;
    const rel =
      ((((this.aimYaw - this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
    const k = clamp((Math.abs(rel) - 0.35) / 0.35, 0, 1);
    if (k <= 0) return aim;
    const c = this.center(),
      d = Math.max(8 * this.dk, aim.distanceTo(c));
    const fwd = c.add(new THREE.Vector3(-Math.sin(this.yaw) * d, 0, -Math.cos(this.yaw) * d));
    return aim.clone().lerp(fwd, k);
  }
  ikCtx(dt) {
    const g = this.game;
    const aim = this.aimPoint();
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
      aim,
      armAim: this.armAimPoint(aim),
      guns: { l: kind('larm'), r: kind('rarm') },
      backs: { l: kind('lback') === 'gun', r: kind('rback') === 'gun' },
      recoil: this.recoil,
      gait: this.gaitPh,
      stride: this.gaitAmp !== undefined,
      lockOK: this.gaitLockOK,
      glide: !!(this.model.an && this.model.an.gW > 0.5), // 滑行：兩腳都踩在地面上
      near: !g.camera || g.camera.position.distanceToSquared(this.pos) < 160 * 160 * this.dk * this.dk,
      off: !!this.lodIk, // 距離分級（Game.lodTick）：離鏡頭遠或在畫面外時 IK 淡出後略過
    };
  }

  // ---------- 距離分級（Game.lodTick）----------
  // AI 分批時不跑 updateAI 的格子：沿用上次的移動輸入（QB 不重複），移動與動作照常每格
  aiCoast(dt) {
    const c = this.aiLast;
    if (!c) return this.move(dt, new THREE.Vector3(), false, false, false, null);
    const t = c.tgt && !c.tgt.dead ? c.tgt : null;
    this.move(dt, c.wish.clone(), c.hover, false, c.ab && !!t, t);
  }
  // 能不能分批：一般的敵人與友軍（Boss、部位、目標物、主題專屬敵人、自訂關卡的單位、靶場、離場中、近戰中的照常每格）
  aiBatchable() {
    return !(
      this.isBoss ||
      this.opts.parent ||
      this.opts.partKind ||
      this.themeFoe ||
      this.edu ||
      this.rangeB ||
      this.guardOf ||
      this.decoy ||
      this.departing ||
      this.remote ||
      this.melee.active ||
      this.ai === 'objective' ||
      this.ai === 'convoy'
    );
  }
  // 陰影的距離分級：不記網格參照（模型會換、網格合併會整組換掉）。關掉時把投影中的網格設成不投影並做記號
  // （lodNoShadow），開回來時只還原有記號的。網格合併的 unmerge／remerge（丟武器、碎裂、裝甲板脫落）前先開回來，
  // remerge 後再關，合併出來的新網格才會沿用原本的設定；換了模型（swapModel）就當作重新開始
  setShadowLod(on) {
    if (this.shRoot !== this.mesh) {
      this.shRoot = this.mesh;
      this.shLodOff = false;
    }
    if (on === !this.shLodOff) return;
    if (!on) {
      this.shHook(this.model);
      if (this.model.dmg) this.shHook(this.model.dmg);
      this.mesh.traverse((o) => {
        if (o.castShadow) {
          o.castShadow = false;
          o.lodNoShadow = true;
        }
      });
      this.shLodOff = true;
    } else {
      this.shRestore();
      this.shLodOff = false;
    }
  }
  // 有記號的網格恢復投影（unmerge 拿回來的原本網格也帶著記號）
  shRestore() {
    this.mesh.traverse((o) => {
      if (o.lodNoShadow) {
        o.castShadow = true;
        o.lodNoShadow = false;
      }
    });
  }
  // 包住 rig（或 rig.dmg）的 unmerge／remerge：拆合網格的期間陰影照原本的設定
  shHook(r) {
    if (!r || r.shHooked || (!r.unmerge && !r.remerge)) return;
    r.shHooked = true;
    for (const k of ['unmerge', 'remerge']) {
      const fn = r[k];
      if (!fn) continue;
      r[k] = (...a) => {
        const was = this.shLodOff && this.shRoot === this.mesh;
        if (was) this.setShadowLod(true);
        const ret = fn(...a);
        if (was) {
          this.shRestore();
          if (k === 'remerge') this.setShadowLod(false);
        }
        return ret;
      };
    }
  }

  // ---------- AI ----------
  updateAI(dt) {
    const g = this.game,
      s = this.aiState,
      K = g.rts ? 1 : DS; // 距離的倍率（下面的數字照舊尺度）
    if (this.dead) return;
    if (this.rtsDef && g.rts) return this.rtsUnitAI(dt); // Coral 戰爭的單位與建築（entities/mech-rts.js）
    if (this.rangeB && g.range && g.rangeAI(this, dt)) return; // 靶場的目標：靜止／橫移（game/range.js）
    if (this.tutD && g.tut && g.tutAI(this, dt)) return; // 近戰訓練的假人（game/tutorial.js）
    dt *= this.bossTempo(); // Boss 與部位：型態越後面、狂暴時節奏越快（mech-boss.js）
    if ((this.ai === 'objective' || this.ai === 'convoy') && this.objectiveAI(dt)) return; // 主線的目標物（mech-objective.js）
    // 據點的守衛：還沒出動時守在原地（game/outposts.js）
    if (this.edu && g.lv && g.lvAI(this, dt)) return; // 自訂關卡的單位行為（game/level-play.js）
    if (this.guardOf && g.guardIdle(this)) {
      this.move(dt, new THREE.Vector3(), false, false, false, null);
      return;
    }
    let pl = null;
    const sense = this.senseOn(); // 一般敵人：感知、警戒、仇恨（mech-sense.js）
    if (sense) {
      if (this.senseTick(dt)) return; // 待機、起疑、搜索：自己移動
      pl = this.sn.tgt;
    } else {
      // pick nearest hostile
      let bd = 1e9;
      for (const h of g.hostilesOfEnt(this)) {
        if (h.dead || h.noLock) continue; // 迷彩中、分離中、在隧道裡的 Boss 不當目標
        const dd = h.pos.distanceToSquared(this.pos);
        if (dd < bd) {
          bd = dd;
          pl = h;
        }
      }
    }
    this.lockAge(pl); // 導彈的鎖定時間
    if (this.isBoss && pl) this.boss3Tick(dt, pl); // 第三型態的專屬招式（mech-boss3.js）
    if (this.team === 'ally') {
      this.allyT -= dt;
      if (this.allyT <= 0) {
        this.departing = true;
      }
      if (this.departing) {
        this.flying = true;
        this.pos.y += dt * 18 * K;
        this.mesh.position.copy(this.pos);
        this.thrS = 1;
        g.fx.thruster.stream(this.model, 1, 0x9fffc8, this.scale, dt, this.vel);
        if (Math.random() < dt * 40) g.fx.boostFlame(this.center(), new THREE.Vector3(0, -1, 0), 0x9fffc8);
        if (this.pos.y > 60 * K) {
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
    const leadT = clamp(d / (95 * K), 0, 0.9);
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
      s.want = (this.opts.wantDist || 22) * K * rnd(0.75, 1.25);
    }
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(s.strafe);
    // 攻擊權杖（game/ai-director.js）：沒拿到的壓制＝退到外圈、少量且散的射擊、特殊攻擊放慢；自己看不到目標時找射線
    const sn = sense ? this.sn : null;
    const sup = !!sn && !sn.tok && !this.ace;
    const blind = !!sn && sn.blind > 1.2;
    if (sup && !this.themeFoe) s.want = Math.max(s.want, sn.ring);
    if (blind && sn.kn) this.setAim(sn.kn.clone().setY(aimPos.y)); // 看不到：朝最後已知位置
    // 主題專屬敵人的計時也管移動（爬柱子、繞圈），不放慢
    const sdt = sup && !SUPPORT_AI.has(this.ai) && !this.themeFoe ? dt * SUP_SPECIAL_DT : dt;
    // 指揮官 MT 被擊破後的混亂：亂走、不開火
    if (this.confuseT > 0) {
      this.confuseT -= dt;
      if (!s.wander || Math.random() < dt * 1.5)
        s.wander = new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize();
      this.move(dt, s.wander.clone().multiplyScalar(0.6), false, false, false, null);
      return;
    }
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
    let handled = false;
    if (blind && SEEK_AI.has(this.ai)) {
      hover = this.seekLos(wish, dt);
      handled = true;
    } else if (sup && CHARGE_AI.has(this.ai)) {
      this.supOrbit(wish, d, dir, perp);
      handled = true;
    }
    const sm = handled ? null : this.aiSpecialMove(sdt, d, dir, perp, wish, pl);
    if (handled) {
      /* 找射線／壓制的外圈 */
    } else if (sm) {
      ({ hover, qb, ab } = sm);
      if (sm.done) return;
    } else if (this.ai === 'turret' || this.ai === 'mt_gren') {
      /* stationary */
    } else if (this.ai === 'sniper') {
      // 保持 165 m 以上；太近就 QB 拉開；有射線遮擋時橫移
      if (d < s.want - 8 * K) {
        wish.copy(dir).negate();
        if (Math.random() < dt * 2.5) qb = true;
      } else if (d > s.want + 10 * K) wish.copy(dir);
      else wish.copy(perp).multiplyScalar(0.6);
      wish.normalize();
      if (s.stuck > 0.4) {
        s.strafe *= -1;
        s.stuck = 0;
      }
    } else if (this.ai === 'flank') {
      // 四台包圍：各自佔據玩家周圍固定方位（緩慢公轉），到位後小幅橫移並射擊
      const ang = (this.opts.flankAngle || 0) + g.time * 0.25;
      const want = (this.opts.wantDist || 9) * K;
      const goal = new THREE.Vector3(pl.pos.x + Math.cos(ang) * want, 0, pl.pos.z + Math.sin(ang) * want);
      const to = goal.clone().sub(this.pos);
      to.y = 0;
      const gd = to.length();
      if (gd > 2.5 * K) {
        wish.copy(to.normalize());
        if (gd > 18 * K && Math.random() < dt * 0.8) qb = true;
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
        if (d > 16 * K && Math.random() < dt * 1.2) ab = true;
        else if (d > 8 * K && Math.random() < dt * 0.8) {
          qb = true;
        }
      }
      if (this.ai === 'kamikaze' && d < 3.5 * K + this.radius) {
        this.die(pl);
        return;
      }
    } else if (this.ai === 'rain') {
      if (d < s.want - 4 * K) wish.copy(dir).negate().add(perp.clone().multiplyScalar(0.5));
      else wish.copy(perp);
      wish.normalize();
      s.qbT -= dt;
      if (
        s.qbT <= 0 &&
        g.projectiles.some((p) => p.team !== this.team && p.pos.distanceToSquared(this.center()) < 80 * K * K)
      ) {
        qb = true;
        s.qbT = rnd(1.5, 3);
      }
    } else if (this.ai === 'bastion') {
      if (d > s.want + 8 * K) wish.copy(dir);
      else if (d < s.want - 10 * K) wish.copy(dir).negate();
      wish.multiplyScalar(0.8);
    } else if (this.ai === 'duelist') {
      if (d > s.want + 2 * K) wish.copy(dir).add(perp.clone().multiplyScalar(0.4));
      else wish.copy(perp);
      wish.normalize();
      s.qbT -= dt;
      const threat = g.projectiles.some(
        (p) => p.team !== this.team && p.pos.distanceToSquared(this.center()) < 120 * K * K,
      );
      if (s.qbT <= 0 && ((threat && Math.random() < dt * 7) || Math.random() < dt * 0.5)) {
        qb = true;
        s.qbT = rnd(0.7, 1.4);
        wish.copy(perp).normalize();
      }
      if (d > 18 * K && Math.random() < dt * 0.9) ab = true;
    } else if (this.ai === 'strider') {
      // 尋找 135 m 內最近的高台／橋面頂，走上去佔高度
      if (!s.perch || s.perchT <= 0) {
        s.perchT = 6;
        let best = null,
          bd2 = 1e9;
        for (const o of g.world.obstacles) {
          if (o.kind !== 'box') continue;
          const dd = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
          if (dd < 45 * K && o.top > g.world.terrainHeight(o.x, o.z) + 2.5 * K && dd < bd2) {
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
        if (this.pos.y < s.perch.top - 0.5 * K) {
          if (dd > 2 * K) {
            wish.copy(to.normalize());
            if (dd < 8 * K) hover = 2; // 跳起後爬升到台頂
          } else hover = 2;
        } else {
          wish.copy(perp).multiplyScalar(0.3);
        }
      } else {
        if (d > s.want + 6 * K) wish.copy(dir);
        else wish.copy(perp).multiplyScalar(0.5);
      }
    } else if (this.ai === 'heli') {
      // 繞著目標盤旋
      wish.copy(perp).multiplyScalar(1.0);
      if (d > s.want + 5 * K) wish.add(dir.clone().multiplyScalar(0.9));
      else if (d < s.want - 5 * K) wish.sub(dir.clone().multiplyScalar(0.9));
      wish.normalize();
      this.flying = true;
    } else if (this.ai === 'swarm') {
      // 直線俯衝，接觸即爆
      wish.copy(dir);
      this.flying = true;
      const gnd = g.world.terrainHeight(this.pos.x, this.pos.z);
      this.hoverH = d > 14 * K ? 6 * K : clamp(pl.center().y - gnd, 0.6 * K, 8 * K);
      if (pl.center().distanceTo(this.center()) < this.radius + pl.radius + 0.6 * K) {
        this.die(pl);
        return;
      }
    } else if (this.ai === 'drone') {
      wish.copy(perp).multiplyScalar(0.9);
      if (d > s.want + 4 * K) wish.add(dir.clone().multiplyScalar(0.8));
      else if (d < s.want - 6 * K) wish.sub(dir.clone().multiplyScalar(0.8));
      wish.normalize();
    } else {
      if (d > s.want + 6 * K) wish.copy(dir).add(perp.clone().multiplyScalar(0.35));
      else if (d < s.want - 6 * K) wish.copy(dir).negate().add(perp.clone().multiplyScalar(0.5));
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
        g.projectiles.some((p) => p.team === 'player' && p.pos.distanceToSquared(this.center()) < 64 * K * K);
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
      if (this.ai === 'ac' && d > 40 * K && Math.random() < dt * 0.5) ab = true;
    }
    const mvr = sn ? this.movesTick(dt, d, dir, pl, wish) : null; // 主攻的預警招式（mech-moves.js）
    if (mvr && mvr.ab) ab = true;
    if (!sup) this.aiShock(dt, d, wish);
    // boss patterns
    if (this.isBoss && this.opts.bossKind === 'heli') this.heliBossAI(dt, d, dir, perp, wish, pl);
    else if (this.isBoss && !this.opts.bossKind) {
      if (this.bossAI(dt, d, dir, perp, wish, pl)) ab = true;
    } else {
      // firing
      s.fireT -= dt;
      if (this.ai === 'kamikaze' || this.ai === 'swarm') {
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      // 特殊敵人自己處理開火（迫擊砲、布雷、修理、護盾、運輸機）
      if (this.aiSpecialFire(sdt, d, aimPos, pl)) {
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      if (mvr && mvr.skip) {
        // 招式自己開火
        this.move(dt, wish, hover, qb, ab, ab ? pl : null);
        return;
      }
      // 壓制與看不到時的開火限制
      const hasMv = !!sn && !!this.movesOf();
      const fk = !sn ? 1 : sup ? SUP_FIRE : hasMv ? HOLDER_IDLE_FIRE : 1;
      const allow = (type) => {
        if (!sn) return true;
        const ind = type === 'missile' || type === 'grenade';
        if (blind) return ind && !sup;
        if (sup && (ind || type === 'melee')) return false;
        return !(hasMv && ind);
      };
      this.supK = sup ? SUP_SPREAD : 1;
      if (this.ai === 'sniper' && blind) {
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      if (this.ai === 'sniper') {
        // 蓄力雷射：先 0.8 s 紅色瞄準線，再射
        const w = this.weapons.rarm;
        if (w.def.type === 'laser') {
          if (!w.charging && w.cd <= 0 && d < w.def.range + 5 * K && Math.random() < dt * 1.2) {
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
          if (!allow(w.def.type)) continue;
          if (
            w.def.type === 'missile' &&
            w.cd <= 0 &&
            w.reloadT <= 0 &&
            d < w.def.range &&
            Math.random() < dt * 1.5 * fk
          ) {
            if (this.fire(slot, aimPos, pl)) {
              w.mag = 0;
              w.reloadT = 4.0;
              g.flashAlert('RAIN 導彈齊射！');
            }
          } else if (
            w.def.type !== 'missile' &&
            w.def.type !== 'none' &&
            w.def.type !== 'shield' &&
            d < w.def.range &&
            Math.random() < dt * 1.0
          )
            this.fire(slot, w.def.type === 'laser' ? pl.center() : aimPos, pl);
        }
        for (const slot of ['rarm', 'larm']) {
          const w = this.weapons[slot];
          if (w.def.type !== 'none' && allow(w.def.type) && d < w.def.range && Math.random() < dt * 5 * fk)
            this.fire(slot, aimPos, pl);
        }
        this.move(dt, wish, hover, qb, ab, null);
        return;
      }
      for (const slot of ['rarm', 'larm', 'rback', 'lback']) {
        const w = this.weapons[slot];
        if (w.def.type === 'none' || w.def.type === 'shield' || !allow(w.def.type)) continue;
        const inR = d < w.def.range * (this.isBoss ? 1.2 : 1) + 2 * K;
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
          if (Math.random() < dt * 2.2 * fk) this.fire(slot, pl.center(), pl);
          continue;
        }
        if (this.ai === 'heli' && w.def.type === 'shell') {
          if (Math.random() < dt * 0.45 * fk) this.fire(slot, aimPos, pl);
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
          } else if (d < w.def.range + 4 * K && w.cd <= 0 && Math.random() < dt * 2.5)
            this.fire(slot, aimPos, pl);
          continue;
        }
        if (
          Math.random() <
          dt *
            (w.def.type === 'missile' ? 0.5 : w.def.type === 'bullet' ? 9 : 1.8) *
            (this.ai === 'mt' ? 0.6 : 1) *
            fk *
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
    const stomp = this.ai === 'stomper'; // 重踏機甲：小範圍、短冷卻
    if ((!boss && this.ai !== 'bastion' && !stomp) || this.flying) return;
    if (s.shockT === undefined) s.shockT = rnd(4, 8);
    if (s.stompT > 0) {
      s.stompT -= dt;
      wish.set(0, 0, 0);
      return;
    }
    s.shockT -= dt;
    const R = boss ? 30 : stomp ? 12 : 20;
    if (s.shockT > 0 || !this.grounded || d > R * 0.8 * this.dk || !this.canAct() || this.melee.active)
      return;
    s.shockT = (boss ? rnd(7, 11) : stomp ? rnd(5, 8) : rnd(10, 15)) * (s.phase >= 2 ? 0.7 : 1);
    const dl = boss ? 0.9 : stomp ? 0.7 : 0.8;
    s.stompT = dl;
    this.game.shockStart(this, {
      R,
      sp: boss ? 24 : stomp ? 16 : 20,
      dl,
      dmg: (boss ? 650 : stomp ? 360 : 380) * this.dmgMul,
      im: (boss ? 1300 : stomp ? 900 : 800) * this.dmgMul,
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
      this.hoverH = 6 * this.dk;
      g.flashMsg('HELIOS 左引擎受損 — 高度下降', 0xff8040, 2.2);
      g.fx.explosion(this.center().add(new THREE.Vector3(-4 * this.dk, 0, 0)), 5, 0xff7030, true);
      this.speedMul *= 0.85;
    }
    if (hp < 0.33 && s.phase === 2) {
      s.phase = 3;
      this.hoverH = 2.5 * this.dk;
      g.flashMsg('HELIOS 雙引擎失效 — 迫降！', 0xff4040, 2.5);
      g.fx.explosion(this.center().add(new THREE.Vector3(4 * this.dk, 0, 0)), 5, 0xff7030, true);
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
  // 一般大型 Boss（JUGGERNAUT、STRIDER、BALTEUS）：依裝備的武器排出攻擊模式輪替（沒有對應武器的模式不排，不會空窗）
  // 0 機槍／霰彈、1 導彈／榴彈／火箭、2 機槍＋導彈齊射、3 突進（突擊推進衝向目標，近身時近戰／霰彈、撞擊）、
  // 4 雷射（第一型態：紅線預警後的蓄力射擊；第二型態：橫掃）。回傳 true 表示這一格要突擊推進
  bossAI(dt, d, dir, perp, wish, pl) {
    const s = this.aiState,
      g = this.game;
    const aimPos = pl.center().addScaledVector(pl.vel, 0.35);
    const ph = this.bossPhase();
    if (ph > (s.phase || 1)) {
      // 第二型態加快移動；第三型態再快一點（換型態的演出與增援在 bosses.js 的 bossPhaseTick）
      this.speedMul *= s.phase === 1 && ph >= 2 ? 1.35 : 1.15;
      s.phase = ph;
    }
    const W = ['rarm', 'larm', 'rback', 'lback']
      .map((k) => this.weapons[k])
      .filter((w) => w.def.type !== 'none');
    if (!s.pats) {
      const has = (...t) => W.some((w) => t.includes(w.def.type));
      s.pats = [];
      if (has('bullet', 'shotgun')) s.pats.push(0);
      if (has('missile', 'grenade', 'shell')) s.pats.push(1);
      if (has('bullet') && has('missile')) s.pats.push(2);
      s.pats.push(3);
      if (has('laser')) s.pats.push(4);
      s.pi = -1;
    }
    s.patT -= dt;
    if (s.patT <= 0) {
      s.pi = (s.pi + 1) % s.pats.length;
      s.pattern = s.pats[s.pi];
      s.patT = rnd(2.2, 3.6);
      if (s.pattern === 3) {
        s.patT = 1.8;
        s.rushT = 1.3;
        s.rammed = false;
      }
      if (s.pattern === 4) {
        s.patT = s.phase >= 2 ? 2.6 : 2.4;
        s.sweepA = this.aimYaw - 0.9;
      }
    }
    const inR = (w) => d < w.def.range * 1.2 + 2 * this.dk;
    let rush = false;
    if (s.pattern === 3 && s.rushT > 0) {
      // 突進：衝向目標，撞上時造成傷害並撞開
      s.rushT -= dt;
      wish.copy(dir);
      rush = d > 7 * this.dk;
      if (!s.rammed && d < this.radius + pl.radius + 1.5 * this.dk && this.canAct()) {
        s.rammed = true;
        pl.takeDamage(500 * this.dmgMul, 1100 * this.dmgMul, this, pl.center(), dir.clone());
        pl.vel.addScaledVector(dir, 14 * this.dk);
        g.camShake = Math.max(g.camShake, 0.25);
      }
    }
    if (s.pattern === 4 && s.phase === 2) s.sweepA += dt * 0.9; // 橫掃速度與雷射數量無關
    for (const w of W) {
      const slot = w.slot,
        ty = w.def.type;
      switch (s.pattern) {
        case 0:
          if ((ty === 'bullet' || ty === 'shotgun') && inR(w)) this.fire(slot, aimPos, pl);
          break;
        case 1:
          if ((ty === 'missile' || ty === 'grenade' || ty === 'shell') && inR(w)) this.fire(slot, aimPos, pl);
          break;
        case 2:
          if ((ty === 'bullet' || ty === 'missile') && inR(w)) this.fire(slot, aimPos, pl);
          break;
        case 3:
          if (ty === 'melee' && d < 14 * this.dk) this.fire(slot, aimPos, pl);
          else if (ty === 'shotgun' && d < 20 * this.dk) this.fire(slot, aimPos, pl);
          break;
        case 4:
          if (ty === 'laser') {
            if (s.phase === 2) {
              const tp = this.center().add(
                new THREE.Vector3(-Math.sin(s.sweepA), 0, -Math.cos(s.sweepA)).multiplyScalar(60 * this.dk),
              );
              tp.y = pl.center().y;
              this.aimYaw = s.sweepA;
              this.fire(slot, tp, pl);
            } else if (inR(w)) {
              // 第一型態：紅線預警後蓄力射擊（沒有蓄力的雷射直接連射）
              if (w.def.chargeT > 0) {
                if (!w.charging && w.cd <= 0 && this.canAct()) {
                  w.charging = true;
                  w.charge = 0;
                  g.fx.warnLine(this.muzzle(slot), pl.center(), w.def.chargeT, 0xff2020, 0.05);
                }
                if (w.charging) {
                  w.charge += dt;
                  if (w.charge >= w.def.chargeT) this.fire(slot, pl.center(), pl);
                }
              } else if (Math.random() < dt * 1.6) this.fire(slot, pl.center(), pl);
            }
          } else if (ty === 'bullet' && inR(w)) this.fire(slot, aimPos, pl);
          break;
      }
    }
    return rush;
  }
}
