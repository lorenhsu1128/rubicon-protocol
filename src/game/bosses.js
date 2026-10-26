// Game：新 Boss 的生成、附屬部位、電磁狩獵機的 EMP、鑽地蟲擊破（行為在 entities/mech-boss.js）
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import {
  BOSS_ENRAGE_DMG,
  BOSS_ENRAGE_T,
  BOSS_PHASE_ADDS,
  BOSS_STAG_GUARD,
  PART_DEFS,
} from '../data/enemies.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // BOSS_DEFS 裡 kind 為新 Boss 的：生成本體與附屬部位
  spawnBossKind(bd, sh, sd) {
    this.scaleHp = sh; // 部位與增援用（startMission 之後才會設定）
    this.scaleDmg = sd;
    // 複製 AC：用玩家（多人時隨機一位）的組裝
    let asm = bd.asm;
    if (bd.kind === 'mirror') {
      const ps = (this.players && this.players.length ? this.players : [this.player]).filter(Boolean);
      const src = ps[Math.floor(Math.random() * ps.length)];
      if (src && src.asm) asm = { ...src.asm };
    }
    const b = this.spawnEnemy({
      name: bd.name,
      asm,
      pal: bd.pal || 'boss',
      scale: bd.scale,
      hpMul: bd.hpMul * sh,
      dmgMul: bd.dmgMul * sd,
      stabMul: bd.stabMul,
      ai: bd.ai,
      wantDist: bd.wantDist,
      speedMul: bd.speedMul,
      modelKind: bd.modelKind,
      vehKey: bd.vehKey,
      radius: bd.radius,
      flying: bd.flying,
      hoverH: bd.hoverH,
      isBoss: true,
      bossKind: bd.kind,
    });
    b.kits = 0;
    const ring = (n, R, fn) => {
      const a0 = Math.random() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2;
        const [x, z] = this.world.nearSolid(
          clamp(b.pos.x + Math.cos(a) * R, -this.world.lim + 4, this.world.lim - 4),
          clamp(b.pos.z + Math.sin(a) * R, -this.world.lim + 4, this.world.lim - 4),
        );
        fn(new THREE.Vector3(x, this.world.groundAt(x, z, 999), z), i);
      }
    };
    switch (bd.kind) {
      case 'spider':
        for (let i = 0; i < 6; i++) this.spawnPart(b, 'joint', { mount: i });
        break;
      case 'fortress':
        for (let i = 0; i < 4; i++) this.spawnPart(b, 'fturret', { mount: i });
        for (let i = 4; i < 6; i++) this.spawnPart(b, 'engine', { mount: i });
        break;
      case 'flagship':
        this.spawnPylons(b);
        break;
      case 'artillery': {
        // 指揮所固定在原地；四座砲台圍一圈，周圍布滿地雷（不會過期）
        ring(4, 24, (p) => this.spawnPart(b, 'cannon', { at: p }));
        const mine = { dmg: 400 * b.dmgMul, im: 650 * b.dmgMul, R: 4.5, life: 1e9, arm: 0, quiet: true };
        ring(14, 11, (p) => this.layMine(b, p.add(new THREE.Vector3(rnd(-2, 2), 0, rnd(-2, 2))), mine));
        ring(18, 31, (p) => this.layMine(b, p.add(new THREE.Vector3(rnd(-4, 4), 0, rnd(-4, 4))), mine));
        break;
      }
      default:
        this.spawnBoss2(bd, b); // 第三批 Boss（bosses2.js）
    }
    if (bd.intro) this.flashAlert(bd.intro);
    return b;
  },
  // 附屬部位：o.mount＝掛在 Boss 模型的節點（跟著動）；o.at＝固定位置
  spawnPart(boss, kind, o) {
    const P = PART_DEFS[kind];
    const sh = this.scaleHp || 1,
      sd = this.scaleDmg || 1;
    return this.spawnEnemy({
      name: P.name,
      asm: P.asm,
      pal: boss.palKey || 'boss',
      scale: 1,
      hpMul: P.hpMul * sh,
      dmgMul: P.dmgMul * sd,
      stabMul: P.stabMul,
      ai: 'part',
      partKind: kind,
      modelKind: 'part',
      vehKey: kind,
      radius: P.radius,
      flying: true,
      hoverH: 0,
      wantDist: 40,
      parent: boss.id,
      mount: o.mount !== undefined ? o.mount : null,
      at: o.at || boss.center(),
    });
  },
  // 護盾指揮艦的四座發生器（開場與重建）
  spawnPylons(b) {
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i / 4) * Math.PI * 2;
      const [x, z] = this.world.nearSolid(
        clamp(b.pos.x + Math.cos(a) * 22, -this.world.lim + 4, this.world.lim - 4),
        clamp(b.pos.z + Math.sin(a) * 22, -this.world.lim + 4, this.world.lim - 4),
      );
      this.spawnPart(b, 'pylon', { at: new THREE.Vector3(x, this.world.groundAt(x, z, 999), z) });
    }
  },
  // 電磁狩獵機的 EMP：半徑 R 內、離地 5 m 以下的敵人受傷並封鎖 QB／懸浮 3 秒
  hunterEmp(src, R) {
    const c = src.pos.clone();
    const w = this.world;
    this.fx.shockwave(c.clone().setY(c.y + 1), R, 0x60a8ff, 0.5);
    this.fx.flash(src.center(), 6, 0xbfe0ff, 0.25);
    for (let i = 0; i < 16; i++) this.fx.streaks(src.center(), 2, 0x80c8ff, R * 0.9, 0.35, R * 1.5);
    SFX.play('overload', 1, 0.8, 0.05, 0.05, c);
    SFX.play('laserBig', 0.7, 0.5, 0.05, 0.05, c);
    for (const t of this.hostilesOfEnt(src)) {
      if (t.dead || t.isProp || !t.pos) continue;
      if (Math.hypot(t.pos.x - c.x, t.pos.z - c.z) > R + t.radius) continue;
      if (t.pos.y - w.groundAt(t.pos.x, t.pos.z, t.pos.y) > 5) continue;
      t.takeDamage(
        300 * src.dmgMul,
        500 * src.dmgMul,
        src,
        t.center(),
        t.center().sub(c).setY(0).normalize(),
        undefined,
        undefined,
        'en',
      );
      t.empLockT = 3;
      this.fx.ring(t.center(), 3, 0x80c8ff);
      if (t.isPlayer) this.rumble(1, 1, 400);
    }
    this.alertAll('電磁封鎖 — QB 與懸浮暫時無法使用');
  },
  // 鑽地蟲擊破：身體各節依序爆開（房主與客機都會呼叫）
  wormBurst(e) {
    const segs = e.wormSegs;
    e.wormSegs = null;
    if (!segs) return;
    segs.forEach((m, i) => {
      setTimeout(() => {
        if (m.visible) this.fx.explosion(m.position.clone(), 3, 0xffa040, i % 3 === 0);
        this.scene.remove(m);
      }, i * 70);
    });
  },
  // ---------- 三個型態與狂暴（第 14 期，房主／單機每格）----------
  // 換型態：短暫無敵、解除失衡、地面衝擊波、空降一批雜兵（不派 AC）；開打 BOSS_ENRAGE_T 秒後狂暴
  bossPhaseTick(dt) {
    if (!this.bosses || !this.bosses.length || this.pvp || this.lab) return;
    const live = this.bosses.filter((b) => !b.dead);
    if (!live.length) return;
    this.bossFightT = (this.bossFightT || 0) + dt;
    if (!this.bossEnraged && this.bossFightT >= BOSS_ENRAGE_T) {
      this.bossEnraged = true;
      for (const b of live) {
        b.enraged = true;
        b.dmgMul *= BOSS_ENRAGE_DMG;
      }
      this.flashMsg('Boss 狂暴化 — 火力與速度上升', 0xff3020, 3, { k: 'enrage', m: '狂暴化', s: 'ENRAGE' });
      for (const b of live) this.fx.shockwave(b.center(), 22, 0xff2010, 0.8);
    }
    // 雙 AC：一台倒下時另一台狂暴（回復 25%、火力 ×1.3、節奏加快）
    if (this.bosses.length > 1 && live.length === 1 && !live[0].duoRage) {
      const b = live[0];
      b.duoRage = true;
      b.enraged = true;
      b.dmgMul *= BOSS_ENRAGE_DMG;
      b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.25);
      this.fx.shockwave(b.center(), 18, 0xff2010, 0.7);
      this.flashMsg(`${b.name.split(' ')[0]} 狂暴化 — 僚機被擊破`, 0xff3020, 2.5, {
        k: 'enrage',
        m: `${b.name.split(' ')[0]} 狂暴化`,
        s: '僚機被擊破',
      });
    }
    for (const b of live) {
      const ph = b.bossPhase();
      if (b.phDone === undefined) b.phDone = b.forceP2 ? 2 : 1; // 一開始就是第二型態（危險條款）不演出
      if (ph <= b.phDone) continue;
      b.phDone = ph;
      this.bossPhaseShift(b, ph);
    }
  },
  bossPhaseShift(b, ph) {
    b.iFrames = Math.max(b.iFrames || 0, 1.5);
    b.staggerT = 0;
    b.acs = 0;
    b.stagGuardT = BOSS_STAG_GUARD;
    const c = b.center();
    this.fx.shockwave(c, 20, 0xff3020, 0.7);
    this.fx.flash(c, 5, 0xff6040, 0.25);
    this.camShake = Math.max(this.camShake, 0.3);
    if (!b.flying && b.ai !== 'part') {
      const gy = this.world.groundAt(b.pos.x, b.pos.z, b.pos.y + 1);
      this.shockStart(b, {
        at: new THREE.Vector3(b.pos.x, gy, b.pos.z),
        R: 26,
        sp: 22,
        dl: 1.0,
        dmg: 380 * b.dmgMul,
        im: 1100 * b.dmgMul,
      });
    }
    // 增援：每個型態一次（雙 AC 的 Boss 也只派一次），多人時每多一人加一台
    this.bossAdds = this.bossAdds || {};
    if (this.bossAdds[ph]) return;
    this.bossAdds[ph] = true;
    const list = (BOSS_PHASE_ADDS[ph - 2] || []).slice();
    const np = this.playersAlive ? this.playersAlive().length : 1;
    for (let i = 1; i < np; i++) list.push('mt');
    this.waveAt = { pos: b.pos.clone(), drop: true };
    for (const t of list) this.spawnType(t, this.scaleHp, this.scaleDmg);
    this.waveAt = null;
    this.flashAlert(`第 ${ph} 型態 — 敵方增援空降`);
  },
});
