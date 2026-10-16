// ---------- MechEntity 擴充：地圖專屬敵人 B1（第 1 章：荒野、沙丘、礦坑；data/foes-b1.js）----------
// 行為只在房主／單機執行（foeMove_b1／foeFire_b1／foeDefense_b1，由 mech-foe.js 分派）；顯示在 foeFx_b1（房主與客機都跑），
// 依同步的 bossVis 與 bx 驅動模型（render/foe-models-b1.js 的 x 開頭節點）。預警一律用會轉送給客機的 fx 或 'warn' 事件。
// bossVis：
//   harpoon 魚叉拖車：1 鉤頭發紅光（預警 0.8 秒）、2 鉤頭飛行中、3 鉤住（捲揚機轉、支腳撐地）
//   smoker 煙幕投射車：1 發射架抬起並發光（預警 1 秒）、2 剛發射（後座）
//   ridgesniper 沙脊狙擊機：1 瞄準中（藍色瞄準線＝bx 的瞄準點、鏡頭反光）、2 開火閃光、4 趴姿
//   twister 旋風產生機：1 預警（葉片打開、噴出環發光）、2 旋風存在（bx＝旋風位置）
//   blaster 坍方爆破手：1 裝炸藥中（射出臂抬起、天線閃燈）、2 剛引爆
//   lamp 礦燈哨兵：1 照到目標（燈變亮）、2 燈頭被打壞熄燈（8 秒）；bx＝探照方向 [方位, 俯仰]
// 狀態效果（entities/mech-status.js 的 addStatus）、場上機制（game/hazards2.js 的 addZone／addTempWall）。
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';
import { snLegIK } from '../render/foe-models-b1.js';
import { Projectile } from './projectile.js';

const B1 = new Set(['harpoon', 'smoker', 'ridgesniper', 'twister', 'blaster', 'lamp']);
const UP = new THREE.Vector3(0, 1, 0),
  DOWN = new THREE.Vector3(0, -1, 0);
const HOOK_WARN = 0.8, // 魚叉的預警
  HOOK_T = 2.2, // 鉤住的秒數（狀態效果上限 4 秒）
  HOOK_BREAK = 0.12; // 鉤住期間拖車受到最大 AP 這個比例的傷害，鋼索就斷
const SNIPE_AIM = 1.5, // 狙擊的瞄準時間
  SNIPE_LOCK = 0.25, // 開火前停止追蹤的時間
  SNIPE_DMG = 1100, // 一擊（火箭筒級，再乘 dmgMul）
  SN_PRONE_Y = 0.75, // 趴姿的機身高度（模型 xBody；站姿 1.5）
  SN_STAND_Y = 1.5,
  SNIPE_TOL_UP = 0.3, // 選位與開始瞄準的視線容差：砲口往上、左右各偏這麼多也要看得到
  SNIPE_TOL_SIDE = 0.35;
const TW_LIFE = 8, // 旋風壽命
  TW_R = 4, // 旋風的傷害半徑
  TW_SP = 4.5; // 旋風追蹤速度
const BL_WARN = 2, // 坍方的預警
  BL_R = 4.5; // 落石半徑
const LAMP_LEN = 40, // 探照距離
  LAMP_ANG = 0.28, // 光錐半角
  LAMP_OFF = 8; // 燈頭被打壞後熄燈的秒數
const r2 = (v) => +v.toFixed(2);

Object.assign(MechEntity.prototype, {
  // 移動與招式（mech-foe.js 的 foeMove 轉過來）；回傳 undefined＝不是 B1 的
  foeMove_b1(dt, d, dir, perp, wish, pl) {
    if (!B1.has(this.ai)) return undefined;
    const r = { hover: false, qb: false, ab: false, done: false };
    // 沒拿到攻擊權杖（壓制）時招式的計時放慢
    const k = this.sn && !this.sn.tok && !this.ace ? 0.6 : 1;
    if (this.ai === 'harpoon') this.harpoonTick_b1(dt, k, d, dir, perp, wish, pl, r);
    else if (this.ai === 'smoker') this.smokerTick_b1(dt, k, d, dir, perp, wish, pl, r);
    else if (this.ai === 'ridgesniper') this.sniperTick_b1(dt, k, d, dir, perp, wish, pl, r);
    else if (this.ai === 'twister') this.twisterTick_b1(dt, k, d, dir, perp, wish, pl, r);
    else if (this.ai === 'blaster') this.blasterTick_b1(dt, k, d, dir, perp, wish, pl, r);
    else if (this.ai === 'lamp') this.lampTick_b1(dt, d, dir, perp, wish, pl, r);
    return r;
  },
  // 一般武器（mech-foe.js 的 foeFire 轉過來）：true＝自己處理（不開一般武器）
  foeFire_b1() {
    if (!B1.has(this.ai)) return undefined;
    const s = this.aiState;
    switch (this.ai) {
      case 'harpoon':
        return !!s.hk && s.hk !== 'reload'; // 預警、飛行、鉤住時不開機槍
      case 'smoker':
        return s.sm === 'warn';
      case 'blaster':
        return !!s.bl;
      case 'lamp':
        return false;
    }
    return true; // 狙擊機、旋風產生機只有自己的招式
  },
  // 保持距離：遠了靠近、近了後退，其他時候橫移
  keepDist_b1(d, dir, perp, wish, want, side = 0.45) {
    if (d > want + 6) wish.copy(dir).multiplyScalar(0.85);
    else if (d < want - 8) wish.copy(dir).multiplyScalar(-0.7).addScaledVector(perp, 0.4);
    else wish.copy(perp).multiplyScalar(side);
  },
  losTo_b1(a, b) {
    return !this.game.world.losBlocked(a, b);
  },
  // 狙擊用：再以和射擊相同的細步射線（hitsWorld）檢查，否則 losBlocked（外框縮小、地形粗取樣）
  // 判定看得到、子彈卻打在沙丘稜線或貨櫃邊上，會一直在同一個位置打牆
  snipeLos_b1(a, b) {
    return this.losTo_b1(a, b) && this.game.losClear(a, b);
  },
  // 選位與開始瞄準用：砲口本身與往上、左右各偏一點都要看得到（只擦過稜線的位置不算，架好之後才不會一動就被擋住）
  snipeLosTol_b1(a, b) {
    const side = new THREE.Vector3(b.z - a.z, 0, a.x - b.x);
    if (side.lengthSq() > 1e-6) side.setLength(SNIPE_TOL_SIDE);
    const pts = [a, a.clone().add(side), a.clone().sub(side), a.clone().setY(a.y + SNIPE_TOL_UP)];
    return pts.every((p) => this.losTo_b1(p, b)) && pts.every((p) => this.game.losClear(p, b));
  },
  // 架好槍（趴姿、槍沒有後座、機身面向目標）時砲口在機體網格座標裡的位置：模型固定，第一次用到時量一次。
  // 視線檢查與開火的起點都用它，不用當下的砲口（站著走過來、還在趴下的途中、轉身中的砲口和架好時差了將近 1 m）
  snipeOff_b1() {
    if (this.rsOff) return this.rsOff;
    const m = this.model,
      mesh = this.mesh,
      hand = m.arms.r.hand;
    if (!m.xBody) return (this.rsOff = new THREE.Vector3(0, 1.3, -4.45));
    const by = m.xBody.position.y,
      gz = m.xGun.position.z,
      ty = m.torso.rotation.y;
    m.xBody.position.y = SN_PRONE_Y;
    m.xGun.position.z = 0;
    m.torso.rotation.y = 0;
    mesh.updateMatrixWorld(true);
    this.rsOff = mesh.worldToLocal(hand.getWorldPosition(new THREE.Vector3()));
    m.xBody.position.y = by;
    m.xGun.position.z = gz;
    m.torso.rotation.y = ty;
    mesh.updateMatrixWorld(true);
    return this.rsOff;
  },
  // 機體在 pos（腳底）架槍瞄準 aim 時的砲口（世界座標）；機身朝向和 setAim 一樣由機體位置指向目標
  snipeMz_b1(pos, aim) {
    const yaw = Math.atan2(-(aim.x - pos.x), -(aim.z - pos.z));
    return this.snipeOff_b1().clone().multiply(this.mesh.scale).applyAxisAngle(UP, yaw).add(pos);
  },

  // ---------- 魚叉拖車：idle → warn（鉤頭紅光、瞄準線）→ fly（鉤頭飛行，可被擊落）→ hook（拖過來）→ reload ----------
  harpoonTick_b1(dt, k, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.hk === undefined) {
      s.hk = null;
      s.hkT = rnd(2, 4);
    }
    if (!s.hk) {
      this.keepDist_b1(d, dir, perp, wish, s.want || 22);
      this.stuckJump(dt, r);
      s.hkT -= dt * k;
      // 射線被擋住：繞著靠近，找得到射線的位置
      if ((s.losT = (s.losT || 0) - dt) <= 0) {
        s.losT = 0.3;
        s.los = this.losTo_b1(this.muzzle('rarm'), pl.center());
      }
      if (!s.los) wish.copy(dir).multiplyScalar(0.6).addScaledVector(perp, 0.8);
      if (s.hkT <= 0 && d > 8 && d < 36 && this.canAct() && s.los) {
        s.hk = 'warn';
        s.hkT = HOOK_WARN;
        g.fx.warnLine(this.muzzle('rarm'), pl.center(), HOOK_WARN, 0xff3020, 0.05);
        SFX.play('charge', 0.7, 1.4, 0.05, 0.05, this.center());
      }
    } else if (s.hk === 'warn') {
      wish.set(0, 0, 0);
      s.hkT -= dt;
      if (!this.canAct()) this.harpoonEnd_b1(2);
      else if (s.hkT <= 0) {
        const mz = this.muzzle('rarm');
        const v = pl.center().addScaledVector(pl.vel, 0.25).sub(mz).normalize().multiplyScalar(44);
        const pj = new Projectile(g, {
          pos: mz.clone(),
          vel: v,
          kind: 'missile',
          attr: 'kin',
          dmg: 140 * this.dmgMul,
          impactV: 450 * this.dmgMul,
          team: this.team,
          owner: this,
          target: pl,
          turn: 1.2,
          color: 0xff5030,
          life: 1.2,
          shootable: 260, // A2：鉤頭飛行中可以被打掉
        });
        g.projectiles.push(pj);
        s.hkP = pj;
        s.hk = 'fly';
        s.hkT = 1.5;
        g.fx.muzzle(mz, v.clone().normalize(), 0xff6040, 1.6);
        SFX.shot('missile', undefined, mz);
      }
    } else if (s.hk === 'fly') {
      wish.set(0, 0, 0);
      s.hkT -= dt;
      const pj = s.hkP;
      if (pj && pj.dead) {
        s.hkMiss = +pj.pos.distanceTo(pl.center()).toFixed(1); // 鉤頭落點離目標的距離（測試用）
        const hit = !pl.dead && s.hkMiss < pl.radius + 1.8;
        if (hit) {
          pl.addStatus?.('hook', HOOK_T, { src: this.id, pull: 14, cable: true });
          s.hk = 'hook';
          s.hkT = HOOK_T;
          s.hkHp = this.hp;
          s.hkTgt = pl;
          s.hooked = (s.hooked || 0) + 1;
        } else this.harpoonEnd_b1(1.5);
      } else if (s.hkT <= 0) this.harpoonEnd_b1(1.5);
    } else if (s.hk === 'hook') {
      wish.set(0, 0, 0); // 撐地捲回
      s.hkT -= dt;
      const t = s.hkTgt;
      const broke = this.hp < s.hkHp - this.maxHp * HOOK_BREAK || !this.canAct();
      if (broke) {
        t.clearStatus?.('hook');
        const p = this.muzzle('rarm');
        g.fx.spark(p, 0xffd080);
        g.fx.flash(p, 1.4, 0xffc060, 0.15);
        g.popDamage(p, 'CABLE CUT', false, true, false, 0);
        SFX.play('clatter1', 0.9, 1, 0.05, 0.05, p);
        s.cut = (s.cut || 0) + 1;
        this.harpoonEnd_b1(3);
      } else if (s.hkT <= 0 || t.dead || (t.hasStatus && !t.hasStatus('hook'))) this.harpoonEnd_b1(1.5);
    } else if (s.hk === 'reload') {
      this.keepDist_b1(d, dir, perp, wish, s.want || 22);
      s.hkT -= dt;
      if (s.hkT <= 0) {
        s.hk = null;
        s.hkT = rnd(5, 7);
      }
    }
    this.bossVis = s.hk === 'warn' ? 1 : s.hk === 'fly' ? 2 : s.hk === 'hook' ? 3 : 0;
  },
  harpoonEnd_b1(t) {
    const s = this.aiState;
    s.hk = 'reload';
    s.hkT = t;
    s.hkP = null;
    s.hkTgt = null;
  },

  // ---------- 煙幕投射車：抬起發射架（預警 1 秒）→ 拋射煙幕彈（灰色落點圈）→ 落地生成煙幕 ----------
  smokerTick_b1(dt, k, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.sm === undefined) {
      s.sm = null;
      s.smT = rnd(3, 5);
    }
    if (s.sm === 'warn') {
      wish.set(0, 0, 0);
      s.smT -= dt;
      if (!this.canAct()) {
        s.sm = null;
        s.smT = 3;
      } else if (s.smT <= 0) {
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.6);
        if (lead.length() > 6) lead.setLength(6);
        this.smokeShot_b1(pl.pos.clone().add(lead), d);
        s.sm = 'cool';
        s.smT = 0.6;
      }
    } else {
      this.keepDist_b1(d, dir, perp, wish, s.want || 34, 0.4);
      this.stuckJump(dt, r);
      s.smT -= dt * (s.sm ? 1 : k);
      if (s.sm === 'cool' && s.smT <= 0) {
        s.sm = null;
        s.smT = rnd(9, 12);
      } else if (!s.sm && s.smT <= 0 && d < 62 && this.canAct()) {
        s.sm = 'warn';
        s.smT = 1;
        SFX.play('door', 0.6, 1.3, 0.05, 0.05, this.center());
      }
    }
    this.bossVis = s.sm === 'warn' ? 1 : s.sm === 'cool' ? 2 : 0;
  },
  smokeShot_b1(tp, d) {
    const g = this.game,
      w = g.world;
    const mz = this.muzzle('rarm');
    const land = tp.clone();
    land.y = w.groundAt(land.x, land.z, tp.y + 1.5);
    const T = clamp(1.2 + d / 40, 1.4, 2.4),
      G = 22;
    const v = land.clone().sub(mz).divideScalar(T);
    v.y = (land.y - mz.y + 0.5 * G * T * T) / T;
    g.projectiles.push(
      new Projectile(g, {
        pos: mz.clone(),
        vel: v,
        kind: 'grenade',
        attr: 'exp',
        dmg: 90 * this.dmgMul,
        impactV: 160 * this.dmgMul,
        team: this.team,
        owner: this,
        color: 0xb8bcc4,
        life: T + 1,
        splash: 2.5,
        gravity: G,
      }),
    );
    g.fx.muzzle(mz, v.clone().normalize(), 0xd0d4dc, 1.8);
    SFX.shot('grenade', undefined, mz);
    g.fx.warnCircle(land, 8, T, 0xd0d4dc);
    g.netEv({ t: 'warn', p: land.toArray().map(r2), R: 8, dl: T, c: 0xd0d4dc });
    const s = this.aiState;
    s.shots = (s.shots || 0) + 1;
    g.later(T, () => {
      g.fx.dust(land.clone(), 8, 26, 0xb8bcc2);
      g.addZone?.('smoke', land.clone(), 8, 10);
      s.smoked = (s.smoked || 0) + 1;
    });
  },

  // ---------- 沙脊狙擊機：找沙丘稜線趴下 → 藍色瞄準線 1.5 秒（被擋住就中斷）→ 一發高傷害（能量）----------
  sniperTick_b1(dt, k, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (!s.rsInit) {
      s.rsInit = true;
      s.rsT = rnd(2, 3.5);
      const p = this.ridge_b1(pl, 40);
      if (p) {
        // 剛生成：直接放到稜線上（生成點附近 40 m 內）
        this.pos.set(p.x, g.world.groundAt(p.x, p.z, p.y + 2), p.z);
        this.vel.set(0, 0, 0);
      }
    }
    let prone = false;
    if (s.rsGoal) {
      const to = s.rsGoal.clone().sub(this.pos).setY(0);
      if (to.length() > 2.5) wish.copy(to.normalize()).multiplyScalar(0.9);
      else s.rsGoal = null;
      this.stuckJump(dt, r);
    } else if (d < 16 && !s.aim) {
      // 被貼近：起身後退，換一條稜線
      wish.copy(dir).negate();
      if (Math.random() < dt * 1.2) r.qb = true;
      if (Math.random() < dt * 0.5) s.rsGoal = this.ridge_b1(pl, 35);
    } else {
      wish.set(0, 0, 0);
      prone = true;
    }
    // 砲口＝架好槍時的位置（開火的起點也是它，所以檢查看得到就打得到）
    const tc = pl.center();
    if (s.aim) {
      s.aimT -= dt;
      if (s.aimT > SNIPE_LOCK) s.aim.lerp(tc, Math.min(1, dt * 3.5));
      const mz = this.snipeMz_b1(this.pos, s.aim);
      // 視線被擋住超過 0.3 秒就中斷
      if (!this.snipeLos_b1(mz, tc)) s.blk = (s.blk || 0) + dt;
      else s.blk = 0;
      if (!this.canAct() || s.blk > 0.3) {
        s.aim = null;
        s.rsT = 2.5;
        s.broken = (s.broken || 0) + 1;
      } else if (s.aimT <= 0) {
        const h0 = s.hits || 0;
        this.snipeShot_b1(mz, s.aim);
        s.aim = null;
        s.rsT = rnd(4, 6);
        s.flashT = 0.3;
        // 換位置（沒打中＝射線被擋住或目標跑掉：一定換）
        if ((s.hits || 0) === h0 || Math.random() < 0.35) s.rsGoal = this.ridge_b1(pl, 30);
      }
    } else if (prone) {
      s.rsT -= dt * k;
      // 趴著看不到目標太久：換一條稜線
      if ((s.losT = (s.losT || 0) - dt) <= 0) {
        s.losT = 0.3;
        s.los = this.snipeLosTol_b1(this.snipeMz_b1(this.pos, tc), tc);
        s.noLos = s.los ? 0 : (s.noLos || 0) + 0.3;
        if (s.noLos > 2.5) {
          s.noLos = 0;
          s.rsGoal = this.ridge_b1(pl, 35);
        }
      }
      // 開始瞄準前再確認一次（上一次檢查最多是 0.3 秒前）
      if (s.rsT <= 0 && d < 120 && this.canAct() && s.los)
        s.los = this.snipeLosTol_b1(this.snipeMz_b1(this.pos, tc), tc);
      if (s.rsT <= 0 && d < 120 && this.canAct() && s.los) {
        s.aim = tc;
        s.aimT = SNIPE_AIM;
        s.blk = 0;
        SFX.play('charge', 0.8, 0.8, 0.05, 0.05, this.center());
      }
    }
    s.flashT = Math.max(0, (s.flashT || 0) - dt);
    // 瞄準中機身轉向瞄準點（感知系統看不到目標時 setAim 會改朝最後已知位置，砲口就和架槍的位置對不上）
    if (s.aim) this.setAim(s.aim);
    this.bx = s.aim ? [r2(s.aim.x), r2(s.aim.y), r2(s.aim.z)] : null;
    this.bossVis = (s.aim ? 1 : 0) | (s.flashT > 0 ? 2 : 0) | (prone || s.aim ? 4 : 0);
  },
  // 稜線：附近 rad 內的取樣點裡比周圍高最多、且離目標 35～95 m 的點
  ridge_b1(pl, rad) {
    const w = this.game.world,
      tc = pl.center();
    let best = null,
      bs = -1e9;
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2,
        rr = Math.sqrt(Math.random()) * rad;
      const x = this.pos.x + Math.cos(a) * rr,
        z = this.pos.z + Math.sin(a) * rr;
      if (!w.inZone(x, z, 4) || w.isVoid(x, z)) continue;
      const h = w.terrainHeight(x, z);
      if (w.groundAt(x, z, h + 3) > h + 0.6) continue; // 物件上不趴
      let m = 0;
      for (const [dx, dz] of [
        [7, 0],
        [-7, 0],
        [0, 7],
        [0, -7],
      ])
        m += w.terrainHeight(x + dx, z + dz) / 4;
      const dd = Math.hypot(x - pl.pos.x, z - pl.pos.z);
      const sc = h + 2.5 * (h - m) - (dd < 35 ? (35 - dd) * 0.6 : dd > 95 ? (dd - 95) * 0.4 : 0);
      // 看不到目標的稜線不選（只在比目前最好的還高分時才檢查視線）：用在這裡架好槍時的砲口＋容差，
      // 和開始瞄準、開火的判定相同
      if (sc > bs && !this.snipeLosTol_b1(this.snipeMz_b1(new THREE.Vector3(x, h, z), tc), tc)) continue;
      if (sc > bs) {
        bs = sc;
        best = new THREE.Vector3(x, h, z);
      }
    }
    return best;
  },
  snipeShot_b1(mz, aim) {
    const g = this.game,
      w = g.world;
    const dv = aim.clone().sub(mz).normalize();
    // 射線：沿路找第一個擋住的地形或障礙物
    let L = 160;
    for (let t = 2; t < L; t += 1.5)
      if (w.hitsWorld(mz.clone().addScaledVector(dv, t))) {
        L = t;
        break;
      }
    let hit = null,
      ht = L;
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead) continue;
      const c = t.center();
      const tt = c.clone().sub(mz).dot(dv);
      if (tt < 0 || tt > ht) continue;
      if (mz.clone().addScaledVector(dv, tt).distanceTo(c) < t.radius + 0.5) {
        hit = t;
        ht = tt;
      }
    }
    const end = mz.clone().addScaledVector(dv, ht);
    if (hit) {
      hit.takeDamage(SNIPE_DMG * this.dmgMul, 950 * this.dmgMul, this, end, dv, undefined, undefined, 'en');
      this.aiState.hits = (this.aiState.hits || 0) + 1;
    }
    g.fx.beam(mz, end, 0x60b8ff, 0.28);
    g.fx.flash(mz, 2.4, 0x9fd4ff, 0.15);
    g.fx.spark(end, 0x9fd4ff);
    SFX.play('laserBig', 1, 0.85, 0.05, 0.05, mz);
  },

  // ---------- 旋風產生機：預警 1.2 秒（葉片打開）→ 放出追蹤的沙塵旋風（8 秒）；捲進去持續受傷並被帶著走 ----------
  twisterTick_b1(dt, k, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    if (s.twT === undefined) {
      s.twT = rnd(2, 4);
      s.tw = null;
    }
    this.keepDist_b1(d, dir, perp, wish, s.want || 30, 0.25);
    if (s.tw) {
      const T = s.tw;
      T.age += dt;
      const to = pl.pos.clone().sub(T.p).setY(0);
      if (to.lengthSq() > 0.01) T.v.lerp(to.normalize().multiplyScalar(TW_SP), Math.min(1, dt * 0.8));
      T.p.addScaledVector(T.v, dt);
      T.p.x = clamp(T.p.x, -w.lim, w.lim);
      T.p.z = clamp(T.p.z, -w.lim, w.lim);
      T.p.y = w.terrainHeight(T.p.x, T.p.z);
      if (T.zone !== undefined && T.zone !== null) g.moveZone?.(T.zone, T.p.clone(), T.v.clone());
      T.dmgT -= dt;
      const tick = T.dmgT <= 0;
      if (tick) T.dmgT = 0.25;
      for (const t of g.hostilesOfEnt(this)) {
        if (t.dead) continue;
        const dx = T.p.x - t.pos.x,
          dz = T.p.z - t.pos.z,
          dh = Math.hypot(dx, dz);
        if (dh > TW_R || t.pos.y - T.p.y > 9) continue;
        if (tick) {
          t.takeDamage(45 * this.dmgMul, 90 * this.dmgMul, this, t.center(), UP, undefined, undefined, 'kin');
          T.hits = (T.hits || 0) + 1;
        }
      }
      if ((T.dustT = (T.dustT || 0) - dt) <= 0) {
        T.dustT = 0.35;
        g.fx.dust(T.p.clone(), 3, 4, 0xd8b680);
      }
      if (T.age >= TW_LIFE || !this.canAct()) this.twisterEnd_b1();
      this.bx = s.tw ? [r2(T.p.x), r2(T.p.y), r2(T.p.z)] : null;
    } else if (s.twW > 0) {
      // 預警：噴出環發光、底部揚起沙塵
      s.twW -= dt;
      if (Math.random() < dt * 6) g.fx.dust(this.pos.clone(), 2.5, 4, 0xd8b680);
      if (!this.canAct()) s.twW = 0;
      else if (s.twW <= 0) {
        const p = this.pos.clone().addScaledVector(dir, 4);
        p.y = w.terrainHeight(p.x, p.z);
        s.tw = { p, v: dir.clone().multiplyScalar(3), age: 0, dmgT: 0.3, hits: 0 };
        s.tw.zone = g.addZone?.('suction', p.clone(), 5, TW_LIFE, { to: p.clone(), pull: 9 });
        s.made = (s.made || 0) + 1;
        SFX.play('thrBurst', 1, 0.7, 0.05, 0.05, p);
      }
    } else {
      s.twT -= dt * k;
      if (s.twT <= 0 && d < 75 && this.canAct()) {
        s.twW = 1.2;
        SFX.play('engineHi', 0.7, 0.8, 0.05, 0.05, this.center());
        g.fx.ring(this.pos.clone().setY(this.pos.y + 0.3), 3, 0xffb050);
      }
    }
    this.bossVis = s.tw ? 2 : s.twW > 0 ? 1 : 0;
  },
  twisterEnd_b1() {
    const s = this.aiState,
      g = this.game;
    if (s.tw && s.tw.zone !== undefined && s.tw.zone !== null) g.removeZone?.(s.tw.zone);
    if (s.tw) g.fx.dust(s.tw.p.clone(), 4, 10, 0xd8b680);
    s.tw = null;
    s.twT = rnd(6, 9);
    this.bx = null;
  },

  // ---------- 坍方爆破手：射出炸藥到目標上方的岩頂（閃燈＋地上裂紋圈 2 秒）→ 落石（爆發）→ 岩塊留下當掩體 15 秒 ----------
  blasterTick_b1(dt, k, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.blT === undefined) s.blT = rnd(3, 5);
    if (s.bl) {
      wish.copy(perp).multiplyScalar(0.25);
      const B = s.bl;
      B.t -= dt;
      if ((B.fl -= dt) <= 0) {
        B.fl = Math.max(0.12, B.t * 0.2); // 越接近越快
        g.fx.flash(B.top, 1.3, 0xff4020, 0.12);
        SFX.play('ui2', 0.5, 1.6, 0.02, 0.05, B.p);
      }
      if (B.t <= 0) this.collapse_b1(B);
    } else {
      this.keepDist_b1(d, dir, perp, wish, s.want || 26);
      this.stuckJump(dt, r);
      s.blT -= dt * k;
      if (s.blT <= 0 && d < 46 && this.canAct()) {
        const w = g.world;
        const lead = pl.vel.clone().setY(0).multiplyScalar(0.8);
        if (lead.length() > 6) lead.setLength(6);
        const p = pl.pos.clone().add(lead);
        p.y = w.groundAt(p.x, p.z, pl.pos.y + 1.5);
        const R = w.theme.roof;
        const ty = R ? Math.max(p.y + 8, R.y - (R.bump || 8) * 0.6) : p.y + 26; // 沒有岩頂：從上空落下
        const top = new THREE.Vector3(p.x, ty, p.z);
        s.bl = { p, top, t: BL_WARN, fl: 0 };
        g.fx.warnLine(this.muzzle('rarm'), top, 0.5, 0xffa030, 0.05);
        g.fx.warnCircle(p, BL_R, BL_WARN, 0xffa020);
        g.netEv({ t: 'warn', p: p.toArray().map(r2), R: BL_R, dl: BL_WARN, c: 0xffa020 });
        SFX.play('pistol', 0.7, 0.7, 0.05, 0.05, this.center());
      }
    }
    if (s.blF > 0) s.blF -= dt;
    this.bossVis = s.bl ? 1 : s.blF > 0 ? 2 : 0;
  },
  collapse_b1(B) {
    const s = this.aiState,
      g = this.game;
    s.lastB = B;
    s.bl = null;
    s.blT = rnd(8, 10);
    s.blF = 0.5;
    g.fx.explosion(B.top, 3, 0xffa040);
    g.fx.streaks(B.top, 16, 0x8a7a66, 18, 0.9, 30, DOWN, 0.5);
    g.fx.dust(B.p.clone(), BL_R + 1, 20, 0xa89070);
    SFX.explode(true, B.p);
    g.rumbleAt?.(B.p, 0.8, 0.4, 220, 30);
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead) continue;
      if (Math.hypot(t.pos.x - B.p.x, t.pos.z - B.p.z) > BL_R + t.radius * 0.5 || t.pos.y > B.top.y) continue;
      t.takeDamage(
        650 * this.dmgMul,
        1100 * this.dmgMul,
        this,
        t.center(),
        DOWN,
        undefined,
        undefined,
        'exp',
      );
      s.hits = (s.hits || 0) + 1;
    }
    g.addTempWall?.(B.p.clone(), { kind: 'rock', w: 3.6, h: 2.6, d: 3, hp: 1200, life: 15 });
    s.falls = (s.falls || 0) + 1;
  },

  // ---------- 礦燈哨兵：探照燈來回掃描，照到的目標被暴露（spotted）；燈頭是弱點 ----------
  lampTick_b1(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (s.lmA === undefined) {
      s.lmA = Math.atan2(dir.x, dir.z);
      s.lmOff = 0;
      s.lmPh = Math.random() * 6;
    }
    const lp = this.lampPos_b1();
    // 看不到目標時繞著靠近（找照得到的位置）
    if ((s.losT = (s.losT || 0) - dt) <= 0) {
      s.losT = 0.3;
      s.los = this.losTo_b1(lp, pl.center());
    }
    if (s.los) this.keepDist_b1(d, dir, perp, wish, s.want || 30, 0.2);
    else wish.copy(dir).multiplyScalar(0.6).addScaledVector(perp, 0.8);
    wish.multiplyScalar(0.7);
    this.stuckJump(dt, r);
    let lit = false;
    if (s.lmOff > 0) {
      s.lmOff -= dt;
      if (s.zone !== undefined && s.zone !== null) {
        g.removeZone?.(s.zone);
        s.zone = null;
      }
    } else {
      // 方位：朝目標 ±0.8 rad 來回掃；俯仰：照向目標的高度
      s.lmPh += dt * 0.9;
      const base = Math.atan2(pl.pos.x - this.pos.x, pl.pos.z - this.pos.z);
      const want = base + Math.sin(s.lmPh) * 0.8;
      let da = want - s.lmA;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      s.lmA += clamp(da, -dt * 1.6, dt * 1.6);
      const pc = pl.center();
      s.lmP = clamp(Math.atan2(pc.y - lp.y, Math.max(4, d)), -0.6, 0.3);
      const dv = this.lampDir_b1();
      // 探照區（game/hazards2.js 的 spot）：照到的玩家套 'spotted'
      if (s.zone === undefined || s.zone === null)
        s.zone = g.addZone('spot', lp.clone(), LAMP_LEN, 9999, {
          dir: dv.clone(),
          ang: LAMP_ANG,
          len: LAMP_LEN,
          src: this,
        });
      else g.moveZone(s.zone, lp.clone(), dv.clone());
      // 照到的目標（spotted 由探照區套；這裡只記下來給燈頭變亮、警報聲與測試）
      for (const t of g.hostilesOfEnt(this)) {
        if (t.dead) continue;
        const v = t.center().sub(lp);
        const L = v.length();
        if (L > LAMP_LEN || L < 0.5 || v.divideScalar(L).dot(dv) < Math.cos(LAMP_ANG)) continue;
        if (!this.losTo_b1(lp, t.center())) continue;
        lit = true;
        if (!s.lit) {
          s.spotted = (s.spotted || 0) + 1;
          SFX.play('alarm', 0.5, 1.3, 0.05, 0.3, lp);
        }
      }
    }
    s.lit = lit;
    this.bx = [r2(s.lmA), r2(s.lmP || 0)];
    this.bossVis = s.lmOff > 0 ? 2 : lit ? 1 : 0;
  },
  // 探照燈的世界方向（bx 的方位與俯仰）
  lampDir_b1() {
    const a = this.bx ? this.bx[0] : this.aiState.lmA || 0,
      p = this.bx ? this.bx[1] : 0;
    return new THREE.Vector3(Math.sin(a) * Math.cos(p), Math.sin(p), Math.cos(a) * Math.cos(p));
  },
  lampPos_b1() {
    const v = new THREE.Vector3();
    if (this.model.xLamp) this.model.xLamp.getWorldPosition(v);
    else v.copy(this.center());
    return v;
  },

  // ---------- 受傷前的修正（mech-foe.js 的 foeDefense 轉過來）：礦燈哨兵的燈頭 ----------
  foeDefense_b1(dmg, impact, from, at, melee) {
    if (this.ai !== 'lamp') return undefined;
    const lp = this.lampPos_b1();
    const src = from && from.pos && from !== this ? from.center() : null;
    // 命中點靠近燈頭，或從上方（高 3 m 以上）的近戰
    const head = (at && at.distanceTo(lp) < 1.4) || (melee && src && src.y > lp.y - 0.5);
    if (!head) return [dmg, impact];
    const s = this.aiState,
      g = this.game;
    if (!(s.lmOff > 0)) {
      s.lmOff = LAMP_OFF;
      s.lmBreak = (s.lmBreak || 0) + 1;
      this.bossVis = 2;
      if (s.zone !== undefined && s.zone !== null) {
        g.removeZone?.(s.zone);
        s.zone = null;
      }
      g.fx.flash(lp, 1.8, 0xffe8a0, 0.2);
      g.fx.streaks(lp, 10, 0xfff0c0, 8, 0.4, 20);
      g.popDamage(lp, 'LAMP BREAK', false, true, false, 0);
      SFX.play('glass', 1, 1, 0.05, 0.05, lp);
    }
    return [dmg * 1.5, impact * 1.2];
  },

  // ---------- 顯示（房主與客機每格；mech-foe.js 的 foeFx 轉過來）----------
  foeFx_b1(dt) {
    if (!B1.has(this.ai)) return;
    const m = this.model,
      bv = this.dead ? 0 : this.bossVis || 0,
      t = this.t || 0;
    dt = dt || 0;
    const ease = (cur, to, sp = 6) => cur + (to - cur) * Math.min(1, dt * sp);
    if (this.dead && !this.remote) this.foeCleanup_b1();
    const W = m.xWarn;
    switch (this.ai) {
      case 'harpoon': {
        if (W) W.emissiveIntensity = bv === 1 ? 1.5 + 2.5 * Math.abs(Math.sin(t * 18)) : 0.3;
        if (m.xHook) m.xHook.visible = bv !== 2 && bv !== 3;
        if (m.xWinch) m.xWinch.rotation.x += dt * (bv === 3 ? 9 : bv === 2 ? -6 : 0);
        if (m.xJacks)
          m.xJacks.forEach(
            (j, i) => (j.rotation.z = ease(j.rotation.z, bv >= 1 ? (i ? -1 : 1) * 0.9 : 0, 4)),
          );
        if (m.xLauncher)
          m.xLauncher.position.z = ease(m.xLauncher.position.z, bv === 2 ? 0.35 : 0, bv === 2 ? 20 : 3);
        break;
      }
      case 'smoker': {
        if (W) W.emissiveIntensity = bv === 1 ? 0.8 + 2.2 * Math.abs(Math.sin(t * 10)) : 0.2;
        if (m.xRack) m.xRack.rotation.x = ease(m.xRack.rotation.x, bv ? 0.75 : 0.12, 5);
        if (m.xTubes) m.xTubes.position.z = ease(m.xTubes.position.z, bv === 2 ? 0.25 : 0, bv === 2 ? 25 : 4);
        if (m.xMast) m.xMast.rotation.y += dt * 2.2;
        break;
      }
      case 'ridgesniper':
        this.sniperFx_b1(dt, bv, ease);
        break;
      case 'twister': {
        if (W) W.emissiveIntensity = bv === 1 ? 1 + 2 * Math.abs(Math.sin(t * 12)) : bv === 2 ? 1.6 : 0.3;
        if (m.xRotor) m.xRotor.rotation.y += dt * (bv === 2 ? 22 : bv === 1 ? 14 : 2.5);
        if (m.xIntake) for (const f of m.xIntake) f.rotation.x += dt * (bv ? 16 : 3);
        if (m.xVanes) for (const v of m.xVanes) v.rotation.z = ease(v.rotation.z, bv ? 0.9 : 0, 4);
        this.vortexFx_b1(dt, bv === 2 && this.bx ? this.bx : null);
        break;
      }
      case 'blaster': {
        const blink = bv === 1 && Math.sin(t * 20) > 0;
        if (W) W.emissiveIntensity = blink ? 4 : bv === 2 ? 2 : 0.3;
        if (m.xArm) m.xArm.rotation.x = ease(m.xArm.rotation.x, bv === 1 ? 0.9 : 0, 4);
        if (m.xSpool) m.xSpool.rotation.x += dt * (bv === 1 ? 10 : 0);
        break;
      }
      case 'lamp': {
        const on = bv !== 2 && !this.dead;
        if (W) W.emissiveIntensity = on ? (bv === 1 ? 4 : 2.2) : 0.05;
        if (m.xCone) {
          m.xCone.visible = on;
          m.xCone.material.opacity = bv === 1 ? 0.22 : 0.12;
        }
        if (m.xLamp && this.bx) {
          m.xLamp.rotation.y = this.bx[0] + Math.PI - this.yaw;
          m.xLampP.rotation.x = this.bx[1];
        }
        if (m.xLegs) m.xLegs.forEach((L, i) => (L.rotation.z = Math.sin(t * 2 + i * 2.1) * 0.04));
        if (!on && Math.random() < dt * 4) this.game.fx.spark(this.lampPos_b1(), 0xffe0a0);
        break;
      }
    }
  },
  // 狙擊機：趴姿（機身壓低、四腳張開，腳掌貼地的兩段 IK）、槍口俯仰、瞄準線與鏡頭反光
  sniperFx_b1(dt, bv, ease) {
    const m = this.model;
    if (!m.xBody) return;
    const prone = !!(bv & 4);
    m.xBody.position.y = ease(m.xBody.position.y, prone ? SN_PRONE_Y : SN_STAND_Y, 3);
    const L1 = m.xL1,
      L2 = m.xL2,
      F = prone ? 1.75 : 1.2; // 腳掌離髖的水平距離
    for (const L of m.xLegs) snLegIK(L.hip, L.knee, m.xBody.position.y - 0.1, F, L1, L2);
    if (m.xWarn) m.xWarn.emissiveIntensity = bv & 1 ? 2 + 2 * Math.abs(Math.sin(this.t * 14)) : 0.4;
    if (m.xGlint) {
      m.xGlint.visible = !!(bv & 1);
      m.xGlint.scale.setScalar(1 + 0.6 * Math.abs(Math.sin(this.t * 9)));
    }
    if (m.xGun) m.xGun.position.z = ease(m.xGun.position.z, bv & 2 ? 0.4 : 0, bv & 2 ? 30 : 4);
    // 瞄準線（藍色、跟著瞄準點；房主與客機都依 bx 畫）
    const aim = bv & 1 && this.bx ? this.bx : null;
    let ln = this.b1Line;
    if (aim) {
      if (!ln) {
        ln = this.b1Line = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 1, 5, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x2a8cff,
            transparent: true,
            opacity: 0.8,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        ln.userData.helper = true;
        this.mesh.add(ln);
      }
      const a = this.muzzle('rarm'),
        b = new THREE.Vector3(aim[0], aim[1], aim[2]);
      this.placeWorld_b1(ln, a.clone().lerp(b, 0.5), b.clone().sub(a));
      ln.scale.set(1 + 0.5 * Math.abs(Math.sin(this.t * 20)), a.distanceTo(b), 1);
      ln.visible = true;
    } else if (ln) ln.visible = false;
  },
  // 子網格放在世界座標 p、朝向 dir（Y 軸），抵銷機體的位置與轉向
  placeWorld_b1(o, p, dir) {
    this.mesh.updateMatrixWorld();
    o.position.copy(this.mesh.worldToLocal(p.clone()));
    const q = new THREE.Quaternion();
    this.mesh.getWorldQuaternion(q);
    const qd = dir
      ? new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize())
      : new THREE.Quaternion();
    o.quaternion.copy(q.invert().multiply(qd));
    const s = this.mesh.scale.x || 1;
    o.scale.setScalar(1 / s);
  },
  // 旋風：疊起來的半透明漏斗，旋轉、上寬下窄（掛在機體網格底下，房主與客機依 bx 擺放）
  vortexFx_b1(dt, p) {
    let v = this.b1Vortex;
    if (!p) {
      if (v) v.visible = false;
      return;
    }
    if (!v) {
      v = this.b1Vortex = new THREE.Group();
      v.userData.helper = true;
      const mat = (o) =>
        new THREE.MeshBasicMaterial({
          color: 0xd8b07a,
          transparent: true,
          opacity: o,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
      v.userData.rings = [];
      for (let i = 0; i < 5; i++) {
        const r0 = 1 + i * 0.75,
          r1 = 1.6 + i * 0.75;
        const c = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 2.2, 14, 1, true), mat(0.34 - i * 0.04));
        c.position.y = 1.1 + i * 1.9;
        v.add(c);
        v.userData.rings.push(c);
      }
      // 捲起的碎石
      for (let i = 0; i < 8; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 0.25), mat(0.6));
        b.userData.a = Math.random() * 6;
        b.userData.h = 0.5 + Math.random() * 8;
        v.add(b);
        v.userData.rings.push(b);
      }
      this.mesh.add(v);
    }
    v.visible = true;
    this.placeWorld_b1(v, new THREE.Vector3(p[0], p[1], p[2]), null);
    const t = this.t || 0;
    v.userData.rings.forEach((c, i) => {
      if (c.geometry.type === 'BoxGeometry') {
        const a = c.userData.a + t * 5,
          rr = 0.8 + c.userData.h * 0.35;
        c.position.set(Math.cos(a) * rr, c.userData.h, Math.sin(a) * rr);
        c.rotation.set(a, a * 1.3, 0);
      } else {
        c.rotation.y += dt * (6 - i * 0.8);
        c.position.x = Math.sin(t * 2 + i) * 0.25 * i;
      }
    });
  },
  // 死亡時收掉場上機制（房主）
  foeCleanup_b1() {
    const s = this.aiState,
      g = this.game;
    if (this.ai === 'twister' && s.tw) this.twisterEnd_b1();
    if (this.ai === 'lamp' && s.zone !== undefined && s.zone !== null) {
      g.removeZone?.(s.zone);
      s.zone = null;
    }
    if (this.ai === 'harpoon' && s.hk === 'hook' && s.hkTgt) s.hkTgt.clearStatus?.('hook');
    if (this.ai === 'harpoon') s.hk = null;
    this.bx = null;
  },
});
