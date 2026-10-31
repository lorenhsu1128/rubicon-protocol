// MechEntity 擴充：機甲特效（docs/vfx-design.md 第 6 期，機戰傭兵 6 風：俐落、短促）。
// mvfxTick 由每格的 thrusterFx 呼叫（房主、單機、客機看別人的機體都跑），全部從快照已有的狀態推算：
// QB（qbT）、突擊推進（boost 而且不是 QB）、懸浮（hover）、著地、垂直速度、EN、失衡、AP、EMP 封鎖、近戰的段、開火（recoil）。
// 各端自己產生、不轉送：一律直接寫顯示卡粒子或特效預設（emitPreset），不呼叫會轉送給客機的 fx 方法（dust、flash、spark…）。
//   包 1 推進器：姿勢控制的噴口 mvJets（腳、肩、腰、胸前，依加速度與動作的推力）、突擊推進的音爆環與氣流線、EN 用完的噴口
//   包 2 地面互動：依地面材質（Game.surfAt）的腳步、滑行、落地；重落地的衝擊環與裂痕
//   包 3 射擊與近戰：槍管發熱、出刀的推進器噴發、迴旋斬的旋風、打樁機的排氣
//   包 4 狀態：失衡的過載放電、EMP 封鎖的電弧、低 AP 的煙／火花／火
//   包 5 殘影：只給玩家自己（設定 ctrl.ghost），QB、突擊推進、衝刺斬
// 設定 ctrl.mechFx：'full'（預設）／'simple'（只留推進器與狀態）。
import { clamp } from '../core/math.js';
import { meleeMove } from '../data/melee.js';
import { emitPreset } from '../fx/presets.js';
import { dmgOn } from '../render/foe-damage.js';
import { MechEntity } from './mech-entity.js';

const _p = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _v = new THREE.Vector3(),
  _c = new THREE.Vector3(),
  _e = new THREE.Vector3(),
  _e2 = new THREE.Vector3(),
  _f = new THREE.Vector3(),
  _r = new THREE.Vector3();
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
    this.mvJets(dt, V, qb, flameCol, k, legged);
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
  // 姿勢控制的噴口（戰鬥機式的噴流，fx/jet.js）：每格依機體的加速度、轉向、垂直速度與動作算出每個噴口的推力
  // （往哪個方向加速，反方向的噴口就噴；越猛越長越亮），推力往上升得快、往下降得慢。
  //   腳（每隻腳）：起跳、空中跳、懸浮與爬升、落地前的減速、空中的水平加速、QB 與出刀的一次噴
  //   肩（左右）：橫向加速（往外噴）、轉向（一邊往前一邊往後）
  //   腰（左右）：橫向加速
  //   胸前（左右）：往前的減速、煞車、往後 QB
  // 背包的主噴口（fx/thruster.js 的 stream）照舊，推力另外加上往前的加速度（mech-entity.js 的 thrusterFx 讀 V.aF）。
  mvJets(dt, V, qb, col, k, legged) {
    const g = this.game,
      T = g.fx.thruster,
      m = this.model;
    const dk = this.dk || 1;
    // 加速度（平滑；瞬移、重生的跳動略過）
    if (!V.pv)
      ((V.pv = this.vel.clone()), (V.acc = new THREE.Vector3()), (V.I = {}), (V.D = {}), (V.yaw = this.yaw));
    _v.copy(this.vel).sub(V.pv).divideScalar(dt);
    if (_v.lengthSq() > (400 * dk) ** 2) _v.set(0, 0, 0);
    V.acc.lerp(_v, Math.min(1, dt * 14));
    V.pv.copy(this.vel);
    let dy = this.yaw - V.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    V.yaw = this.yaw;
    V.yr = (V.yr || 0) + (clamp(dy / dt / 4, -1, 1) - (V.yr || 0)) * Math.min(1, dt * 10); // ＋＝往左轉
    const fwd = _f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)),
      rt = _r.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const A = 45 * dk; // 推力滿格的加速度
    const aF = V.acc.dot(fwd) / A,
      aR = V.acc.dot(rt) / A,
      aY = V.acc.y / A;
    V.aF = aF;
    // 一次噴（起跳、空中跳、QB、出刀）：mvMelee 也會設定 V.jet
    if (legged) {
      if (V.g && !this.grounded && this.vel.y > 2 * dk) V.jet = { t: 0.18, d: DOWN.clone() };
      else if (!this.grounded && this.vel.y - V.vy > 4 * dk && !V.g) {
        _d.set(-this.vel.x, 0, -this.vel.z);
        const h = _d.length();
        _d.multiplyScalar(h > 0.1 ? 0.6 / h : 0)
          .add(DOWN)
          .normalize();
        V.jet = { t: 0.16, d: _d.clone() };
      }
      if (qb && !V.qb) {
        _d.set(-this.vel.x, 0, -this.vel.z);
        if (_d.lengthSq() < 1e-4) _d.copy(fwd).negate();
        _d.normalize().addScaledVector(DOWN, 0.25).normalize();
        V.jet = { t: 0.16, d: _d.clone() };
      }
    }
    V.g = this.grounded;
    V.vy = this.vel.y;
    if (T.cull && T.cull(this.pos)) return;
    const air = !this.grounded;
    const brake = (m.an && m.an.bW) || 0;
    // 一個噴口：key、位置 p、這一格想要的排氣向量 E（方向＝噴的方向、長度＝推力 0～1）、長度倍率 L、寬度 W
    const jet = (key, p, E, L, W, seed) => {
      const t = Math.min(1, E.length());
      let I = V.I[key] || 0;
      I += (t - I) * Math.min(1, dt * (t > I ? 30 : 7));
      V.I[key] = I;
      const D = V.D[key] || (V.D[key] = DOWN.clone());
      if (t > 0.02) D.lerp(_e.copy(E).divideScalar(t || 1), Math.min(1, dt * 20)).normalize();
      if (I < 0.05) return;
      T.jets.add(
        p,
        D,
        (0.35 + L * I) * k * (0.92 + Math.random() * 0.16),
        W * (0.7 + 0.3 * I) * k,
        0.3 + 0.7 * I,
        col,
        seed,
      );
    };
    const E = _e2;
    // ---- 腳 ----
    if (legged) {
      let vert = 0;
      if (this.hover && air) vert = this.vel.y > 1 * dk ? 0.9 : 0.6;
      if (air) vert = Math.max(vert, aY * 0.9);
      // 落地前的減速：往下掉得快、離地面近
      if (air && this.vel.y < -4 * dk && g.world) {
        const h = this.pos.y - g.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
        if (h < 14 * dk)
          vert = Math.max(vert, clamp(-this.vel.y / (22 * dk), 0, 1) * (1 - h / (14 * dk)) * 0.9);
      }
      const spike = V.jet && V.jet.t > 0;
      if (spike) V.jet.t -= dt;
      this.model.legs.forEach((L, i) => {
        L.foot.getWorldPosition(_p);
        _p.addScaledVector(DOWN, 0.12 * k).addScaledVector(fwd, -0.12 * k);
        E.copy(DOWN).multiplyScalar(vert);
        if (air) E.addScaledVector(fwd, -aF * 0.5).addScaledVector(rt, -aR * 0.5);
        if (spike) E.add(V.jet.d);
        jet('f' + i, _p, E, 2.6, 0.13, i * 3.1 + this.id);
      });
      // 懸浮貼近地面：把地面的沙塵吹開（旋翼的下洗氣流）
      if (this.hover && air && Math.random() < dt * 6) {
        const gy = g.world
          ? g.waterSurf(this.pos.x, this.pos.z, g.world.groundAt(this.pos.x, this.pos.z, this.pos.y))
          : this.pos.y;
        const h = this.pos.y - gy;
        if (h < 9 * dk && h > -0.5) g.fx.downwash(this.pos.x, gy, this.pos.z, k * 0.6, 1 - h / (9 * dk));
      }
    }
    // ---- 肩、胸前（有手臂的機體） ----
    if (m.arms && m.arms.l && m.arms.r && m.arms.l.mount) {
      const yr = V.yr || 0;
      for (const [s0, a] of [
        [-1, m.arms.l],
        [1, m.arms.r],
      ]) {
        a.mount.getWorldPosition(_p);
        const s = Math.sign(_v.copy(_p).sub(this.pos).dot(rt)) || s0; // 實際在哪一側（模型的左右定義不同時也對）
        _c.copy(_p);
        // 肩：肩甲外側後方
        _p.addScaledVector(rt, s * 0.32 * k).addScaledVector(fwd, -0.18 * k).y += 0.12 * k;
        const lat = Math.max(0, -aR * s); // 往另一側加速時，這一側往外噴
        E.copy(rt).multiplyScalar(s * lat * 1.1);
        E.addScaledVector(fwd, -s * yr * 0.8); // 往左轉：右肩往後噴、左肩往前噴
        if (E.lengthSq() > 1e-4) E.addScaledVector(DOWN, 0.12 * E.length());
        jet('s' + s, _p, E, 2, 0.11, s * 5.3 + this.id);
        // 胸前：肩的內下方往前
        _c.addScaledVector(rt, -s * 0.12 * k).addScaledVector(fwd, 0.36 * k).y -= 0.45 * k;
        const dec = Math.max(0, -aF) * 1.1 + brake * 0.7;
        E.copy(fwd)
          .addScaledVector(rt, s * 0.35)
          .addScaledVector(DOWN, 0.25)
          .normalize()
          .multiplyScalar(dec);
        jet('c' + s, _c, E, 1.9, 0.1, s * 7.7 + this.id);
      }
    }
    // ---- 腰（左右） ----
    if (legged) {
      this.model.legs.forEach((L, i) => {
        if (i > 1) return;
        L.thigh.getWorldPosition(_p);
        const s = Math.sign(_v.copy(_p).sub(this.pos).dot(rt)) || (i ? 1 : -1);
        _p.addScaledVector(rt, s * 0.3 * k).y += 0.1 * k;
        const lat = Math.max(0, -aR * s);
        E.copy(rt).multiplyScalar(s * lat * 0.9);
        jet('h' + i, _p, E, 1.7, 0.1, i * 2.3 + this.id + 11);
      });
    }
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
