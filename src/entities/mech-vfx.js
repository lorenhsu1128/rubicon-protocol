// MechEntity 擴充：機甲特效（docs/vfx-design.md 第 6 期，機戰傭兵 6 風：俐落、短促）。
// mvfxTick 由每格的 thrusterFx 呼叫（房主、單機、客機看別人的機體都跑），全部從快照已有的狀態推算：
// QB（qbT）、突擊推進（boost 而且不是 QB）、懸浮（hover）、著地、垂直速度、EN、失衡、AP、EMP 封鎖、近戰的段、開火（recoil）。
// 各端自己產生、不轉送：一律直接寫顯示卡粒子或特效預設（emitPreset），不呼叫會轉送給客機的 fx 方法（dust、flash、spark…）。
//   包 1 推進器：腳的噴口（起跳、空中跳、懸浮與爬升、QB 往反方向）、突擊推進的音爆環與氣流線、EN 用完的噴口
//   包 2 地面互動：依地面材質（Game.surfAt）的腳步、滑行、落地；重落地的衝擊環與裂痕
//   包 3 射擊與近戰：槍管發熱、出刀的推進器噴發、迴旋斬的旋風、打樁機的排氣
//   包 4 狀態：失衡的過載放電、EMP 封鎖的電弧、低 AP 的煙／火花／火
//   包 5 殘影：只給玩家自己（設定 ctrl.ghost），QB、突擊推進、衝刺斬
// 設定 ctrl.mechFx：'full'（預設）／'simple'（只留推進器與狀態）。
import { meleeMove } from '../data/melee.js';
import { emitPreset } from '../fx/presets.js';
import { dmgOn } from '../render/foe-damage.js';
import { MechEntity } from './mech-entity.js';

const _p = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _c = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const NEAR = 110; // 地面互動、槍管發熱：離鏡頭多遠以內才產生（公尺 × 尺度）
const GHOST_QB = 0.05, // 殘影的間隔（秒）
  GHOST_AB = 0.09,
  GHOST_DASH = 0.06;
const HEAT_ON = 14; // 槍管發熱：連續開火幾發以上開始冒煙（每秒散掉 HEAT_COOL）
const HEAT_COOL = 5;

Object.assign(MechEntity.prototype, {
  mvfxTick(dt, flameCol) {
    const g = this.game,
      fx = g && g.fx,
      m = this.model;
    if (!fx || !fx.g || !m || m.vehicle || this.dead || !(dt > 0) || !m.group || !m.group.visible) return;
    const V = this.mv || (this.mv = { g: true, vy: 0, qb: false, ab: false, stag: false, heat: {}, mk: '' });
    const full = g.ctrl.mechFx !== 'simple';
    const k = this.scale || 1;
    const legged = (m.type === 'biped' || m.type === 'reverse') && m.legs && m.legs.length;
    const qb = this.qbT > 0,
      ab = !!this.boost && !qb;
    const camD = g.camera ? g.camera.position.distanceTo(this.pos) : 0;
    const near = camD < NEAR * (fx.k || 1);
    // ---------- 包 1：推進器 ----------
    if (legged) this.mvFeet(dt, V, qb, flameCol, k);
    if (ab && !V.ab) emitPreset(fx.g, 'abRing', this.center(), { S: k, color: flameCol });
    if (ab && Math.random() < dt * 16) {
      // 氣流線：跟著機體移動的一部分（看起來往後流）
      _v.copy(this.vel).multiplyScalar(0.3);
      emitPreset(fx.g, 'abFlow', this.center(), { S: k, vel: _v });
    }
    if (this.en < (this.enMax || 1) * 0.03 && m.nozzles && Math.random() < dt * 7) {
      for (const n of m.nozzles) {
        n.getWorldPosition(_p);
        emitPreset(fx.g, 'enOut', _p, { S: k });
      }
    }
    // ---------- 包 2：地面互動（滑行的腳底；腳步與落地在 mechStep／trailsTick） ----------
    if (full && near && legged && this.grounded && m.an && (m.an.gW > 0.5 || qb) && Math.random() < dt * 14) {
      const L = m.legs[Math.floor(Math.random() * m.legs.length)];
      L.foot.getWorldPosition(_p);
      _p.y = this.pos.y + 0.05 * k;
      this.mvSurf(_p, 0.35, 0.8);
    }
    // ---------- 包 3：射擊與近戰 ----------
    if (full) {
      if (near) this.mvHeat(dt, V, k);
      this.mvMelee(dt, V, k, flameCol);
    }
    // ---------- 包 4：狀態 ----------
    this.mvStatus(dt, V, k);
    // ---------- 包 5：殘影（只給玩家自己） ----------
    if (this === g.player && g.ctrl.ghost !== 'off' && fx.ghosts) {
      const st =
        this.melee && this.melee.active && meleeMove(this.weapons[this.melee.slot].def, this.melee.stage);
      const every = qb ? GHOST_QB : ab ? GHOST_AB : st && st.dashSlash ? GHOST_DASH : 0;
      if (every && (V.ghT = (V.ghT || 0) - dt) <= 0) {
        V.ghT = every;
        fx.ghosts.snap(m.group, flameCol);
      }
    }
    V.qb = qb;
    V.ab = ab;
  },
  // 腳的噴口：腳踝往下、稍微往後的一點；噴射的方向依動作（雙足、逆關節）
  mvFeet(dt, V, qb, col, k) {
    const g = this.game,
      T = g.fx.thruster;
    const dk = this.dk || 1;
    // 起跳：著地 → 離地而且往上；空中跳：空中一格往上的速度增加 4 m/s 以上
    if (V.g && !this.grounded && this.vel.y > 2 * dk) V.jet = { t: 0.15, d: DOWN.clone() };
    else if (!this.grounded && this.vel.y - V.vy > 4 * dk && !V.g) {
      _d.set(-this.vel.x, 0, -this.vel.z);
      const h = _d.length();
      _d.multiplyScalar(h > 0.1 ? 0.6 / h : 0)
        .add(DOWN)
        .normalize();
      V.jet = { t: 0.12, d: _d.clone() };
    }
    // QB：往 QB 方向的反方向（水平、稍微往下）噴一下
    if (qb && !V.qb) {
      _d.set(-this.vel.x, 0, -this.vel.z);
      if (_d.lengthSq() < 1e-4) _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      _d.normalize().addScaledVector(DOWN, 0.25).normalize();
      V.jet = { t: 0.14, d: _d.clone() };
    }
    V.g = this.grounded;
    V.vy = this.vel.y;
    // 噴流的長度與強度（× 機體的尺度）：起跳、QB、出刀的一次噴（V.jet）＞爬升＞懸浮
    let len = 0,
      kk = 0,
      dir = DOWN;
    if (V.jet && V.jet.t > 0) {
      V.jet.t -= dt;
      len = 2.4;
      kk = 1;
      dir = V.jet.d;
    } else if (this.hover && !this.grounded) {
      const climb = this.vel.y > 1 * dk;
      len = climb ? 2 : 1.3;
      kk = climb ? 0.9 : 0.6;
      // 懸浮貼近地面：把地面的沙塵吹開（旋翼的下洗氣流）
      if (Math.random() < dt * 6) {
        const gy = g.world ? g.world.groundAt(this.pos.x, this.pos.z, this.pos.y) : this.pos.y;
        const h = this.pos.y - gy;
        if (h < 9 * dk && h > -0.5) g.fx.downwash(this.pos.x, gy, this.pos.z, k * 0.6, 1 - h / (9 * dk));
      }
    }
    if (!kk || (T.cull && T.cull(this.pos))) return;
    // 戰鬥機式的細長噴流（fx/jet.js）：腳踝往下、稍微往後的一點
    const back = _c.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); // 機體正面是 −Z：往後＝(sin, cos)
    this.model.legs.forEach((L, i) => {
      L.foot.getWorldPosition(_p);
      _p.addScaledVector(DOWN, 0.12 * k).addScaledVector(back, 0.12 * k);
      T.jets.add(_p, dir, len * k * (0.92 + Math.random() * 0.16), 0.075 * k, kk, col, i * 3.1 + this.id);
    });
  },
  // 腳步（mechStep 每半個步伐呼叫）：其中一隻腳的地面互動，近處才產生
  mvStep() {
    const g = this.game,
      m = this.model;
    if (!m || !m.legs || !m.legs.length || this.dead || !m.group || !m.group.visible) return;
    if (g.camera.position.distanceTo(this.pos) > NEAR * 0.6 * (g.fx.k || 1)) return;
    const L = m.legs[(this.mvStepI = ((this.mvStepI || 0) + 1) % m.legs.length)];
    L.foot.getWorldPosition(_p);
    _p.y = this.pos.y + 0.05 * (this.scale || 1);
    const run = Math.hypot(this.vel.x, this.vel.z) > (this.stats ? this.stats.speed * 0.5 : 5);
    this.mvSurf(_p, run ? 0.6 : 0.35, run ? 0.6 : 0.45);
  },
  // 重落地：貼地的衝擊環與地面的裂痕
  mvLandRing() {
    _p.copy(this.pos);
    _p.y += 0.08 * (this.scale || 1);
    emitPreset(this.game.fx.g, 'landRing', _p, { S: this.scale || 1 });
  },
  // 地面互動：依地面材質的預設（n：數量倍率、s：大小倍率）
  mvSurf(p, n, s) {
    const g = this.game;
    const surf = g.surfAt ? g.surfAt(p.x, p.z, p.y) : 'conc';
    emitPreset(g.fx.g, 'g_' + surf, p, { S: (this.scale || 1) * s, n });
  },
  // 槍管發熱：開火（recoil 增加）累積，機槍與加特林連射超過門檻時槍口冒白煙
  mvHeat(dt, V, k) {
    const R = this.recoil;
    if (!R || !this.weapons) return;
    for (const [rk, slot] of [
      ['l', 'larm'],
      ['r', 'rarm'],
      ['bl', 'lback'],
      ['br', 'rback'],
    ]) {
      const w = this.weapons[slot];
      if (!w || !w.def || w.dropped) continue;
      const mg =
        (w.def.type === 'bullet' && w.def.rof < 0.06) || w.def.id === 'bw_gat' || /gat|w_mg/.test(w.def.id);
      if (!mg) continue;
      const r = R[rk] || 0,
        r0 = V['r' + rk] || 0;
      V['r' + rk] = r;
      let h = V.heat[slot] || 0;
      if (r > r0 + 0.05) h += 1;
      h = Math.max(0, h - HEAT_COOL * dt);
      V.heat[slot] = h;
      if (h > HEAT_ON && Math.random() < dt * Math.min(12, (h - HEAT_ON) * 1.5)) {
        const mz = this.muzzle(slot);
        if (mz) emitPreset(this.game.fx.g, 'heat', mz, { S: k });
      }
    }
  },
  // 近戰：新的一段開始時推進器噴發（衝刺斬更強）、迴旋斬的旋風、打樁機的排氣
  mvMelee(dt, V, k, col) {
    const M = this.melee;
    const g = this.game;
    const key = M && M.active ? M.slot + ':' + M.stage : '';
    const w = M && M.active && this.weapons[M.slot];
    const st = w && meleeMove(w.def, M.stage);
    if (key && key !== V.mk && st) {
      g.fx.thruster.burst(this.model, col, k * (st.dashSlash ? 1 : 0.6), this.vel);
      // 腳的噴口往後噴一下（往前突進）
      _d.set(Math.sin(this.aimYaw), 0, Math.cos(this.aimYaw)).addScaledVector(DOWN, 0.2).normalize();
      V.jet = { t: st.dashSlash ? 0.16 : 0.08, d: _d.clone() };
      V.pile = w.def.id === 'w_pile' ? 1 : 0;
    }
    V.mk = key;
    if (!st) return;
    if (st.spin && this.grounded && Math.random() < dt * 22) {
      _p.copy(this.pos);
      _p.y += 0.2 * k;
      emitPreset(g.fx.g, 'spinWind', _p, { S: k });
    }
    // 打樁機：一段的後半排出蒸氣（一次）
    if (V.pile === 1 && st.dur && M.t > st.dur * 0.45) {
      V.pile = 2;
      const a = this.model.arms && this.model.arms[w.side > 0 ? 'r' : 'l'];
      if (a && a.hand) {
        a.hand.getWorldPosition(_p);
        emitPreset(g.fx.g, 'pile', _p, { S: k });
      }
    }
  },
  // 狀態：失衡、EMP 封鎖、低 AP（沒有分段受損的機體：AC、玩家）
  mvStatus(dt, V, k) {
    const g = this.game,
      G = g.fx.g;
    const body = () =>
      this.center().add(
        _v.set(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).multiplyScalar(1.6 * k),
      );
    const stag = this.staggerT > 0;
    if (stag && !V.stag) emitPreset(G, 'overload', this.center(), { S: k });
    V.stag = stag;
    if (stag && Math.random() < dt * 7) emitPreset(G, 'zapSmall', body(), { S: k });
    if (stag && Math.random() < dt * 3) emitPreset(G, 'dmgSmoke', body(), { S: k, color: 0x6a6e76 });
    if (this.empLockT > 0 && Math.random() < dt * 6)
      emitPreset(G, 'zapSmall', body(), { S: k * 0.8, color: 0x80c8ff });
    if (dmgOn(this) || !(this.maxHp > 0)) return;
    const hr = this.hp / this.maxHp;
    if (hr < 0.5 && Math.random() < dt * (hr < 0.15 ? 5 : hr < 0.25 ? 4 : 2.5))
      emitPreset(G, 'dmgSmoke', body(), {
        S: k,
        color: hr < 0.15 ? 0x2c2a28 : hr < 0.25 ? 0x4a4c50 : 0x7a7e84,
      });
    if (hr < 0.25 && Math.random() < dt * 2.5) {
      const p = body();
      emitPreset(G, 'dmgSpark', p, { S: k });
      if (Math.random() < 0.5) emitPreset(G, 'zapSmall', p, { S: k * 0.7 });
    }
    if (hr < 0.15 && Math.random() < dt * 14) emitPreset(G, 'dmgFire', body(), { S: k });
  },
});
