// ---------- MechEntity 擴充：各 Boss 最終型態的專屬招式（第 14.2 期）----------
// Boss 進入第三型態（AP 35% 以下）後，依種類定期放出一招專屬的連段（都有預警：紅圈、紅線、地面衝擊波）。
// 只在房主／單機執行（updateAI 呼叫）；用的都是已經會同步給客機的機制：迫擊砲彈、地面衝擊波、能量環、
// 光束（beamAttack）、燃燒地面、地雷、範圍爆炸（blastTeam）與鏡像的特效。
import { SFX } from '../audio/audio.js';
import { DS, MS } from '../core/scale.js';
import { rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 種類（bossKind，沒有的用名稱開頭）→ { cd 冷卻秒數, name 招式名稱, fn(Boss, 目標) }
const SPECIALS = {
  JUGGERNAUT: { cd: 12, name: '砲擊連段', fn: (b, pl) => (b.b3Shock(26), b.b3Rain(pl, 6, 10, 0.5)) },
  mirror: { cd: 10, name: '適應過載', fn: (b, pl) => (b.b3Volley(pl, 3, 0.35), b.b3Mines(pl, 5, 9)) },
  flagship: { cd: 11, name: '艦砲齊射', fn: (b, pl) => b.b3Line(pl, 8, 4.5, 0.12) },
  interceptor: { cd: 12, name: '空雷封鎖', fn: (b, pl) => b.b3Mines(pl, 8, 10, true) },
  STRIDER: { cd: 9, name: '十字雷射', fn: (b, pl) => b.b3Cross(pl) },
  railgun: { cd: 12, name: '散射砲', fn: (b, pl) => b.b3Fan(pl, 5, 0.22) },
  worm: { cd: 10, name: '地表崩塌', fn: (b, pl) => b.b3Erupt(pl, 5, 9) },
  funnel: { cd: 12, name: '光束牢籠', fn: (b, pl) => b.b3Cage(pl, 6, 16) },
  heli: { cd: 11, name: '地毯轟炸', fn: (b, pl) => b.b3Line(pl, 9, 4, 0.1) },
  furnace: { cd: 12, name: '火海', fn: (b, pl) => (b.b3Pools(pl, 5, 9), b.b3Ring(36)) },
  artillery: { cd: 10, name: '飽和砲擊', fn: (b, pl) => b.b3Rain(pl, 12, 18, 0.25) },
  rampart: { cd: 10, name: '碎石雨', fn: (b, pl) => (b.b3Shock(22), b.b3Rain(pl, 6, 12, 0.4)) },
  duo: { cd: 13, name: '連攜齊射', fn: (b, pl) => b.b3Volley(pl, 4, 0.3) },
  phantom: { cd: 14, name: '分身突襲', fn: (b) => (b.game.spawnHolos(b, 2), b.b3Ring(28)) },
  spider: { cd: 11, name: '震地', fn: (b, pl) => (b.b3Shocks(3, 0.8), b.b3Mines(pl, 4, 8)) },
  orbital: { cd: 9, name: '雙重光柱', fn: (b, pl) => b.b3Pillars(pl, 6, 12) },
  BALTEUS: {
    cd: 10,
    name: '導彈牆',
    fn: (b, pl) => (b.b3Volley(pl, 4, 0.25, ['rback', 'lback']), b.b3Ring(32)),
  },
  trinity: { cd: 12, name: '三重衝擊', fn: (b) => b.b3Shocks(3, 0.7) },
  hunter: { cd: 12, name: '電磁風暴', fn: (b, pl) => (b.b3Ring(40), b.b3Mines(pl, 6, 10)) },
  train: { cd: 10, name: '全車廂砲擊', fn: (b, pl) => b.b3Rain(pl, 10, 16, 0.2) },
  fortress: { cd: 11, name: '全彈發射', fn: (b, pl) => (b.b3Rain(pl, 10, 14, 0.2), b.b3Fan(pl, 3, 0.3)) },
  ibis: { cd: 9, name: '雙環', fn: (b) => (b.b3Ring(44), b.game.later(0.7, () => !b.dead && b.b3Ring(44))) },
};

Object.assign(MechEntity.prototype, {
  boss3Key() {
    if (this.opts.bossKind) return this.opts.bossKind;
    const n = String(this.name || '');
    return Object.keys(SPECIALS).find((k) => /^[A-Z]/.test(k) && n.startsWith(k)) || null;
  },
  // 這隻 Boss 的最終型態專屬招式（Boss 改版的打斷大招也用它當第三型態的大招，mech-boss-tier.js）
  boss3Spec() {
    return SPECIALS[this.boss3Key()] || null;
  },
  // 第三型態的專屬招式（updateAI 每格；dt 已乘上節奏）。有刁鑽度時改由 tierTick 蓄力後放出
  boss3Tick(dt, pl) {
    if (!this.isBoss || !pl || this.bossPhase() < 3) return;
    const S = SPECIALS[this.boss3Key()];
    if (!S) return;
    const s = this.aiState;
    if (s.b3T === undefined) s.b3T = 3; // 進入第三型態後 3 秒放第一次
    s.b3T -= dt;
    if (s.b3T > 0 || this.staggerT > 0 || (this.noLock && this.opts.bossKind === 'trinity')) return;
    s.b3T = S.cd * rnd(0.85, 1.15);
    const g = this.game;
    g.flashMsg(`${this.name.split(' ')[0]}：${S.name}！`, 0xff4030, 1.4);
    SFX.play('alarm', 0.5, 0.9, 0.02, 0.5, this.center());
    S.fn(this, pl);
  },
  // ----- 招式的零件 -----
  b3Dm() {
    return this.dmgMul * (this.tierHalfK ? this.tierHalfK() : 1); // 只打斷一次的大招：減半
  },
  // 迫擊砲雨：目標附近 R 公尺內 n 發（gap 秒間隔），每發有落點預警
  b3Rain(pl, n, R, gap) {
    const g = this.game,
      dm = this.b3Dm();
    for (let i = 0; i < n; i++)
      g.later(i * gap, () => {
        if (this.dead || pl.dead) return;
        const a = Math.random() * Math.PI * 2,
          r = (i === 0 ? rnd(0, 2) : rnd(2, R)) * DS;
        const lead = pl.vel
          .clone()
          .setY(0)
          .multiplyScalar(this.tierFlag && this.tierFlag('lead') ? 0 : 0.4);
        const tp = pl.pos
          .clone()
          .add(lead)
          .add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
        g.mortarShot(this, tp, { dmg: 420 * dm, im: 700 * dm, R: 5 * MS });
      });
  },
  // 直線砲擊：從自己往目標方向（穿過目標）一路落下 n 發
  b3Line(pl, n, step, gap) {
    const g = this.game,
      dm = this.b3Dm();
    const d = pl.pos.clone().sub(this.pos).setY(0);
    if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
    d.normalize();
    const start = pl.pos.clone().addScaledVector(d, -step * DS * (n / 2));
    for (let i = 0; i < n; i++)
      g.later(i * gap, () => {
        if (this.dead) return;
        g.mortarShot(this, start.clone().addScaledVector(d, i * step * DS), {
          dmg: 400 * dm,
          im: 700 * dm,
          R: 4.5 * MS,
        });
      });
  },
  // 地面衝擊波（以自己為中心）
  b3Shock(R) {
    const g = this.game,
      dm = this.b3Dm();
    const gy = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1 * MS);
    g.shockStart(this, {
      at: V(this.pos.x, gy, this.pos.z),
      R,
      sp: 22,
      dl: 0.9,
      dmg: 360 * dm,
      im: 1000 * dm,
    });
  },
  // 連續的衝擊波
  b3Shocks(n, gap) {
    for (let i = 0; i < n; i++) this.game.later(i * gap, () => !this.dead && this.b3Shock(18 + i * 6));
  },
  // 目標周圍依序噴發（小範圍衝擊波，有預警）
  b3Erupt(pl, n, R) {
    const g = this.game,
      dm = this.b3Dm();
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++)
      g.later(i * 0.35, () => {
        if (this.dead || pl.dead) return;
        const a = a0 + (i / n) * Math.PI * 2;
        const x = pl.pos.x + Math.cos(a) * R * 0.6 * DS,
          z = pl.pos.z + Math.sin(a) * R * 0.6 * DS;
        const gy = g.world.groundAt(x, z, pl.pos.y + 1 * MS);
        g.shockStart(this, { at: V(x, gy, z), R: 7, sp: 12, dl: 0.8, dmg: 300 * dm, im: 900 * dm });
      });
  },
  // 能量環（QB 的無敵時間能穿過）
  b3Ring(R) {
    const dm = this.b3Dm();
    this.game.pulseRing(this, { R, sp: 22, band: 1.8, dmg: 360 * dm, im: 800 * dm });
  },
  // 地雷：目標周圍 n 顆（air＝空中地雷）
  b3Mines(pl, n, R, air = false) {
    if (this.tierFlag && this.tierFlag('mines')) return; // Boss 改版：布雷的部位壞了
    const g = this.game,
      dm = this.b3Dm();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3),
        r = rnd(R * 0.5, R) * DS;
      const p = pl.pos.clone().add(V(Math.cos(a) * r, air ? rnd(2, 7) * MS : 0, Math.sin(a) * r));
      g.layMine(this, p, { dmg: 380 * dm, im: 600 * dm, R: 4 * MS, life: air ? 8 : 14, air, quiet: i > 0 });
    }
  },
  // 燃燒地面：目標周圍
  b3Pools(pl, n, R) {
    const g = this.game,
      dm = this.b3Dm();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const p = pl.pos.clone().add(V(Math.cos(a) * R * 0.7, 0, Math.sin(a) * R * 0.7).multiplyScalar(DS));
      g.mortarShot(this, p, { dmg: 300 * dm, im: 500 * dm, R: 4 * MS });
      g.later(1.8, () => g.addPool(this, p, 4.5, 7, 120 * dm));
    }
  },
  // 武器連射：每個武器槽連開 n 次（gap 秒間隔）
  b3Volley(pl, n, gap, slots = ['rarm', 'larm', 'rback', 'lback']) {
    const g = this.game;
    for (let i = 0; i < n; i++)
      g.later(i * gap, () => {
        if (this.dead || pl.dead || !this.canAct()) return;
        for (const k of slots) {
          const w = this.weapons[k];
          if (!w || !w.def || w.def.type === 'none') continue;
          w.cd = 0;
          if (w.mag <= 0) w.mag = Math.max(1, Math.min(w.def.mag || 1, w.ammo || 1));
          this.fire(k, pl.center().addScaledVector(pl.vel, 0.3), pl);
        }
      });
  },
  // 光束：from → 方向 dir，預警 dl 秒後發射
  b3Beam(from, dir, dl, o = {}) {
    const g = this.game,
      dm = this.b3Dm();
    const range = o.range || 80;
    g.fx.warnLine(from, from.clone().addScaledVector(dir, range * DS), dl, 0xff3050, 0.1);
    g.later(dl, () => {
      if (this.dead) return;
      g.beamAttack(this, from, dir, {
        range,
        dmg: (o.dmg || 520) * dm,
        im: (o.im || 900) * dm,
        w: 0.9,
        color: 0xff4060,
        width: 0.35,
      });
      SFX.play('laserBig', 0.8, 0.9, 0.05, 0.05, from);
    });
  },
  // 十字雷射：穿過目標的兩道互相垂直的光束
  b3Cross(pl) {
    const c = pl.center();
    const a = Math.random() * Math.PI;
    for (const ang of [a, a + Math.PI / 2]) {
      const d = V(Math.cos(ang), 0, Math.sin(ang));
      this.b3Beam(c.clone().addScaledVector(d, -45 * DS), d, 1.0, { range: 90 });
    }
  },
  // 扇形散射：朝目標 n 道（間隔 step 弧度）
  b3Fan(pl, n, step) {
    const from = this.center();
    const d0 = pl.center().sub(from);
    const yaw = Math.atan2(d0.x, d0.z);
    const L = Math.hypot(d0.x, d0.z) || 1;
    const pitch = Math.atan2(d0.y, L);
    for (let i = 0; i < n; i++) {
      const y = yaw + (i - (n - 1) / 2) * step;
      const d = V(Math.sin(y) * Math.cos(pitch), Math.sin(pitch), Math.cos(y) * Math.cos(pitch));
      this.b3Beam(from.clone(), d, 1.1, { range: 120, dmg: 600 });
    }
  },
  // 光束牢籠：目標周圍 n 個點同時往中心照（預警後發射）
  b3Cage(pl, n, R) {
    const c = pl.center();
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const from = c.clone().add(V(Math.cos(a) * R * DS, 4 * MS, Math.sin(a) * R * DS));
      const d = c.clone().sub(from).normalize();
      this.b3Beam(from, d, 1.2, { range: R * 2.2, dmg: 420 });
    }
  },
  // 光柱：目標周圍 n 處，預警圈後落下
  b3Pillars(pl, n, R) {
    const g = this.game,
      dm = this.b3Dm();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        r = i === 0 ? 0 : rnd(3, R) * DS;
      const p = pl.pos.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
      p.y = g.world.groundAt(p.x, p.z, p.y + 1.5 * MS);
      const dl = 1.3 + i * 0.15;
      g.fx.warnCircle(p, 3.5 * MS, dl);
      g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R: 3.5 * MS, dl });
      g.later(dl, () => {
        if (this.dead) return;
        g.fx.pillarStrike(p, 3.5 * MS);
        g.blastTeam(p.clone().setY(p.y + 1 * MS), 520 * dm, 900 * dm, 3.8 * MS, this.team, this);
      });
    }
  },
});
