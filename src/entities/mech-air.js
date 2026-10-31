// MechEntity 擴充：空域的飛行（docs/air-combat-design.md）。高推力機甲：沒有重力、推力撐住，不會失速（減速到底＝懸停）。
// move() 在 this.air 時改呼叫 airMove（計時、近戰的取消照 move 前段），姿勢與動作照 poseTail（airOrient 換掉地面的傾斜）。
//   方向：機首轉向 airAim（玩家＝鏡頭的方向；Game 每格設定），轉向速度依速度，急轉彎（跳躍鍵按住）×2、掉速、耗 EN
//   推力：airIn.thr 前＝推進、後＝減速（到底懸停）、沒按＝巡航；airIn.side＝橫移
//   機動（QB 鍵＋方向）：左右＝側滾翻（瞬間側移、短暫無敵）、前＝前滾翻（爆發加速）、後＝後空翻（翻一圈、機首轉 180°）；
//     機動的時機剛好＝甩掉導彈（mech-weak.js 的 missileDodge）＋完美迴避（pqbDodge），所以不另做熱焰彈
//   撞到地形或海面：依速度受傷並彈開；高度上限 AIR_CEIL
// 只在單機（空域只有單人）；數值是公尺與秒（已經是新尺度的公尺，不再乘 DS）。
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { AIR } from '../data/air.js';
import { START_ASM, asmStats } from '../data/parts.js';
import { MechEntity } from './mech-entity.js';

let REF_SPD = 0; // 起始機體的速度（airSpeedK 的基準）
const _f = new THREE.Vector3(),
  _r = new THREE.Vector3(),
  _a = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _qx = new THREE.Quaternion(),
  _qr = new THREE.Quaternion(),
  _X = new THREE.Vector3(1, 0, 0),
  _Y = new THREE.Vector3(0, 1, 0),
  _Z = new THREE.Vector3(0, 0, 1);

// 方向（yaw、俯仰）→ 單位向量（機體的正面是 −Z）
function dirOf(yaw, pit, out) {
  const c = Math.cos(pit);
  return out.set(-Math.sin(yaw) * c, Math.sin(pit), -Math.cos(yaw) * c);
}

Object.assign(MechEntity.prototype, {
  // 進入空域：沿目前的朝向巡航
  airInit(alt) {
    this.air = true;
    this.airV = AIR.CRUISE * 0.8;
    this.airPit = 0;
    this.airRoll = 0;
    this.airYawV = 0;
    this.airImp = new THREE.Vector3();
    this.airRev = null;
    this.airIn = { thr: 0, side: 0 };
    this.airCrashCD = 0;
    this.pos.y = alt;
    this.vel.copy(dirOf(this.yaw, 0, _f)).multiplyScalar(this.airV);
    this.grounded = false;
    this.hover = true;
    this.jumpT = 0;
    this.hoverMode = 0;
  },
  // 機首的方向（HUD 的機首標記）
  airDirNow() {
    return dirOf(this.yaw, this.airPit || 0, new THREE.Vector3());
  },
  // 動作層要的翻轉（animExtra 的 flipGo，取一次就清掉）
  airFlipTake() {
    const f = this.airFlip;
    if (f) this.airFlip = null;
    return f || null;
  },
  // 機體的速度倍率（輕量機快、重量機慢）
  airSpeedK() {
    if (this.airSk === undefined) {
      if (!REF_SPD) REF_SPD = asmStats(START_ASM).speed || 1;
      this.airSk = clamp((this.stats.speed || REF_SPD) / REF_SPD, 0.85, 1.18); // 以起始的機體為 1
    }
    return this.airSk;
  },
  airMove(dt, wish, wantG, wantQB, wantAB, targetEnt) {
    const g = this.game,
      w = g.world,
      P = this.stats.parts;
    const In = this.airIn || { thr: 0, side: 0 };
    const sk = this.airSpeedK();
    const down = this.downed || this.staggerT > 0 || this.hitStunT > 0;
    let thr = down ? 0 : In.thr,
      side = down ? 0 : In.side;
    if (this.edHold) thr = side = 0;
    // EN 回復（推進、急轉彎時停）照 move 前段；這裡只扣
    const useEn = (k) => {
      const c = this.enMax * k * dt;
      if (this.en < c) return false;
      this.en -= c;
      this.enDelay = 0.35;
      return true;
    };
    // ---- 機動（QB 鍵＋方向）----
    if (wantQB && !down && this.qbT <= 0 && !this.airRev && this.useEn(P.booster.qbCost)) {
      const ax = Math.abs(side),
        az = Math.abs(thr);
      const kind = ax > 0.4 && ax >= az ? 's' : thr < -0.4 ? 'b' : 'f';
      dirOf(this.yaw, 0, _f);
      _r.set(-_f.z, 0, _f.x); // 右
      this.qbT = 0.16;
      this.qbStartT = this.t; // 甩掉導彈、完美迴避（mech-weak.js、pqbDodge）
      if (this.pilotEnt()) this.cueArmSet('q');
      this.iFrames = kind === 'b' ? 0.32 : 0.26;
      if (kind === 's') {
        const sg = Math.sign(side);
        this.airImp.addScaledVector(_r, sg * AIR.ROLL_IMP);
        this.qbDir.copy(_r).multiplyScalar(sg);
        this.airFlip = { f: 0, s: sg, T: AIR.FLIP_T };
      } else if (kind === 'f') {
        this.airV = Math.min(AIR.AB * sk, this.airV + AIR.FWD_IMP);
        this.qbDir.copy(dirOf(this.yaw, this.airPit, _a));
        this.airFlip = { f: 1, s: 0, T: AIR.FLIP_T };
      } else {
        // 後空翻：翻一圈、機首轉 180°（像殷麥曼迴旋）；玩家的鏡頭一起轉過去
        this.airRev = { t: 0, y0: this.yaw, p0: this.airPit, y1: this.yaw + Math.PI, p1: -this.airPit * 0.5 };
        this.airV = Math.min(this.airV, 40);
        this.qbDir.copy(dirOf(this.yaw, this.airPit, _a)).negate();
        this.airFlip = { f: -1, s: 0, T: AIR.REV_T };
        if (this.isPlayer && g.airRevCam) g.airRevCam();
      }
      this.tutE('qb', {});
      SFX.qb(this.isPlayer ? null : this.center());
      if (this.isPlayer) g.rumble(0.12, 0.4, 90);
    }
    if (this.qbT > 0) this.qbT -= dt;
    // ---- 目標的速度 ----
    let vT =
      (thr > 0.3
        ? AIR.BOOST
        : thr < -0.3
          ? lerp(AIR.CRUISE, AIR.HOVER, clamp((-thr - 0.3) / 0.6, 0, 1))
          : AIR.CRUISE) * sk;
    if (thr > 0.3 && !useEn(AIR.EN_BOOST)) vT = AIR.CRUISE * sk;
    let abTo = null;
    if (wantAB && !down && this.en > 5 && useEn(AIR.EN_AB)) {
      if (this.abT <= 0) SFX.ab(this.isPlayer ? null : this.center());
      this.abT = 0.1;
      vT = AIR.AB * sk;
      if (targetEnt && !targetEnt.dead) abTo = targetEnt.center().sub(this.center());
    } else if (this.abT > 0) this.abT -= dt;
    const gTurn = !!wantG && !down && this.airV > 25 && useEn(AIR.EN_G);
    this.airG = gTurn;
    // ---- 方向 ----
    let yawT = this.yaw,
      pitT = this.airPit;
    const aim = abTo || this.airAim;
    if (aim && aim.lengthSq() > 1e-6) {
      yawT = Math.atan2(-aim.x, -aim.z);
      pitT = clamp(Math.atan2(aim.y, Math.hypot(aim.x, aim.z)), -AIR.PITCH_MAX, AIR.PITCH_MAX);
    }
    const yaw0 = this.yaw;
    if (this.airRev) {
      const R = this.airRev;
      R.t += dt / AIR.REV_T;
      const e = Math.min(1, R.t),
        s = e * e * (3 - 2 * e);
      this.yaw = R.y0 + (R.y1 - R.y0) * s;
      this.airPit = lerp(R.p0, R.p1, s);
      if (R.t >= 1) this.airRev = null;
    } else if (!down) {
      // 轉向速度：懸停時原地轉身最快，中速其次，高速變慢
      const v = this.airV;
      let rate =
        v < 25 ? lerp(AIR.TURN_HOVER, AIR.TURN, v / 25) : AIR.TURN * (1 - 0.35 * clamp((v - 70) / 80, 0, 1));
      if (gTurn) rate *= AIR.GTURN;
      if (this.melee.active) rate *= 0.4;
      const dy = ((((yawT - this.yaw + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI,
        dp = pitT - this.airPit;
      const L = Math.hypot(dy, dp),
        step = rate * dt;
      const k = L > step ? step / L : 1;
      this.yaw += dy * k;
      this.airPit += dp * k;
    }
    this.airYawV = lerp(
      this.airYawV,
      (((((this.yaw - yaw0 + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) - Math.PI) /
        Math.max(dt, 1e-3),
      Math.min(1, dt * 8),
    );
    this.aimYaw = this.aimYaw === undefined ? this.yaw : this.aimYaw;
    // ---- 速度 ----
    if (gTurn) vT = Math.min(vT, Math.max(45 * sk, this.airV - AIR.GDRAG * dt * 4));
    const acc = vT > this.airV ? AIR.ACC : AIR.DEC;
    this.airV += clamp(vT - this.airV, -acc * dt, acc * dt);
    if (gTurn) this.airV = Math.max(40 * sk, this.airV - AIR.GDRAG * dt);
    dirOf(this.yaw, this.airPit, _f);
    _r.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw)).negate(); // 右（水平）
    const imp = this.airImp;
    imp.multiplyScalar(Math.exp(-dt * 5));
    this.boost = this.airV > AIR.CRUISE * sk + 8 || this.abT > 0 || this.qbT > 0;
    if (this.melee.active) this.updateMelee(dt);
    else {
      const tv = _a
        .copy(_f)
        .multiplyScalar(this.airV)
        .addScaledVector(_r, side * AIR.SIDE)
        .add(imp);
      // 低速（懸停）時照輸入慢慢停下；高速時速度一直沿機首（推力很大）
      this.vel.lerp(tv, Math.min(1, dt * (this.airV < 25 ? 3 : 7)));
    }
    if (this.pilotEnt()) this.oobPush(w, dt);
    // ---- 積分與地面 ----
    this.pos.addScaledVector(this.vel, dt);
    if (this.pos.y > AIR.CEIL) {
      this.pos.y = AIR.CEIL;
      if (this.vel.y > 0) this.vel.y = 0;
      if (this.airPit > 0) this.airPit *= 0.9;
      if (this.isPlayer && !(this.altWarnT > 0)) {
        this.altWarnT = 1.5;
        g.flashAlert('已達飛行高度上限');
      }
    }
    if (this.altWarnT > 0) this.altWarnT -= dt;
    this.airFloorTick(dt, w);
    this.grounded = false;
    this.hover = true;
    this.jumpT = 0;
  },
  // 地面或海面（比較高的那個）
  airFloor(x, z) {
    const w = this.game.world;
    const W = w.theme.water;
    return Math.max(w.terrainHeight(x, z), W ? W.level : -1e9);
  },
  // 撞到地形或海面：依速度受傷並彈開（不直接擊破）；慢慢貼近時只是擋住
  airFloorTick(dt, w) {
    const g = this.game;
    if (this.airCrashCD > 0) this.airCrashCD -= dt;
    const fl = this.airFloor(this.pos.x, this.pos.z),
      pad = 1.2 * this.scale;
    this.airLow = this.pos.y - fl; // HUD 的低空警告
    if (this.pos.y >= fl + pad) return;
    const into = Math.max(-this.vel.y, 0),
      v = this.vel.length();
    this.pos.y = fl + pad;
    if ((into > 12 || v > 45) && this.airCrashCD <= 0) {
      this.airCrashCD = 1.2;
      const k = clamp(v / AIR.AB, 0.25, 1);
      if (!(g.net && g.net.role === 'client'))
        this.takeDamage(
          this.maxHp * 0.14 * k,
          300,
          null,
          this.center(),
          new THREE.Vector3(0, 1, 0),
          null,
          null,
          'none',
        );
      this.airPit = Math.max(this.airPit, 0.45);
      this.airV *= 0.55;
      this.vel.y = Math.abs(this.vel.y) * 0.5 + 12;
      const W = w.theme.water;
      const wet = W && W.level >= w.terrainHeight(this.pos.x, this.pos.z);
      if (wet && g.water && g.water.g) g.water.drop(this.pos.x, this.pos.z, 4 * this.scale, -1.2);
      g.fx.dust(this.pos.clone(), 3.5 * this.scale, 12);
      SFX.land(this.isPlayer ? null : this.center(), 1);
      if (this.isPlayer) {
        g.fpPitch = Math.max(g.fpPitch, 0.3); // 機首跟著鏡頭：彈開時鏡頭也抬起來
        g.camShake = Math.max(g.camShake, 0.35);
        g.rumble(0.8, 0.6, 220);
        g.flashAlert(wet ? '墜海！機體受損' : '撞地！機體受損');
      }
    } else if (this.vel.y < 0) this.vel.y = 0;
  },
  // 姿勢（poseTail 呼叫，取代地面的傾斜）：一律是機甲站立微蹲的姿勢（不是前傾的超人姿勢；使用者 2026-10-31 定案），
  // 速度快時只微微前傾、爬升俯衝時稍微跟著仰俯，轉彎與橫移時繞前後軸往內側傾
  airOrient(dt) {
    const v = this.airV || 0;
    const T = clamp((v - 20) / 60, 0, 1);
    this.airTilt = lerp(this.airTilt || 0, T, Math.min(1, dt * 4));
    let x = -0.16 * this.airTilt + clamp(this.airPit * 0.22, -0.3, 0.3);
    x += -clamp((this.leanX || 0) * 0.35, -0.2, 0.2);
    if (this.staggerT > 0 || this.downed) x += Math.sin(this.t * 9) * 0.12;
    const side = (this.airIn && this.airIn.side) || 0;
    const rollT = clamp(
      this.airYawV * 0.45 - side * 0.22 + (this.airG ? Math.sign(this.airYawV) * 0.2 : 0),
      -0.65,
      0.65,
    );
    this.airRoll = lerp(this.airRoll || 0, rollT, Math.min(1, dt * 5));
    _q.setFromAxisAngle(_Y, this.yaw);
    _qx.setFromAxisAngle(_X, x);
    _qr.setFromAxisAngle(_Z, this.airRoll);
    this.mesh.quaternion.copy(_q).multiply(_qx).multiply(_qr);
  },
  // 空域結束（離開任務、clearMission）
  airOff() {
    this.air = false;
    this.airAim = null;
    this.mesh.rotation.set(0, this.yaw, 0, 'YXZ');
  },
});
