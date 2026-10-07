// Game：地面衝擊波（Boss 與重型機體的踏地攻擊：沿地面擴散，只打貼地的機體，跳起或懸浮就能躲開）
// 與地面爆炸對空中目標的減傷。傷害只在房主／單機計算，客機收到 'shock' 事件只顯示特效與警告
import { clamp } from '../core/math.js';
import { Game } from './game.js';

const SHOCK_H = 1.2; // 離地低於這個高度算貼地，會被衝擊波打到

Object.assign(Game.prototype, {
  // 地面爆炸（爆炸點離地 1.5 m 內）對空中機體的傷害倍率：離地 1 m 起遞減，3 m 剩一半，4 m 以上 25%
  groundBlastK(t, p) {
    if (!t || t.isProp || t.flying || t.grounded !== false || !t.pos) return 1;
    const w = this.world;
    if (p.y - w.groundAt(p.x, p.z, p.y + 0.5) > 1.5) return 1;
    const alt = t.pos.y - w.groundAt(t.pos.x, t.pos.z, t.pos.y);
    return clamp(1 - (alt - 1) / 4, 0.25, 1);
  },
  // 發出衝擊波。o：{ R 半徑, sp 擴散速度 m/s, dl 預警秒數, dmg, im 衝擊 }
  shockStart(src, o) {
    const p = src.pos.clone();
    if (!this.shocks) this.shocks = [];
    this.shocks.push({ p, owner: src, ...o, t: 0, hit: new Set(), tried: new Set() });
    this.shockFx(p, o.R, o.sp, o.dl);
    this.netEv({
      t: 'shock',
      p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)],
      R: o.R,
      sp: o.sp,
      dl: o.dl,
    });
  },
  // 特效與警告（客機收到事件時也呼叫）
  shockFx(p, R, sp, dl) {
    const w = this.world;
    this.fx.groundWave(p, R, sp, dl, (x, z) => w.terrainHeight(x, z));
    const me = this.player;
    if (me && !me.dead && me.pos.distanceTo(p) < R + 8) this.flashAlert('地面衝擊波 — 跳躍迴避！');
  },
  updateShocks(dt) {
    if (!this.shocks || !this.shocks.length) return;
    const w = this.world;
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.t += dt;
      const el = s.t - s.dl;
      const r = Math.max(0, el) * s.sp;
      for (const t of this.hostilesOfEnt(s.owner)) {
        if (t.dead || t.isProp || t.flying || !t.pos || s.hit.has(t)) continue;
        const d = Math.hypot(t.pos.x - s.p.x, t.pos.z - s.p.z);
        if (d - t.radius > s.R) continue;
        // 電腦 AI：波前快到時依技巧機率起跳
        if (t.ai && !s.tried.has(t)) {
          const eta = (d - t.radius - r) / s.sp + Math.max(0, -el);
          if (eta < 0.45) {
            s.tried.add(t);
            if (Math.random() < clamp(0.45 * (t.aiSkill || 1), 0, 0.9)) t.aiJumpT = 0.7;
          }
        }
        if (el < 0) continue;
        // 這一格波前掃過的範圍
        if (d - t.radius > r || d + t.radius < r - s.sp * dt * 1.5) continue;
        if (t.pos.y - w.groundAt(t.pos.x, t.pos.z, t.pos.y) > SHOCK_H) continue;
        s.hit.add(t);
        const k = 1 - (0.4 * d) / s.R;
        const dir = new THREE.Vector3(t.pos.x - s.p.x, 0, t.pos.z - s.p.z);
        if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
        t.takeDamage(s.dmg * k, s.im * k, s.owner, t.center(), dir.normalize());
      }
      if (r > s.R + 2) this.shocks.splice(i, 1);
    }
  },
});
