// Coral 戰爭（RTS）的英雄：MechEntity 擴充（docs/rts-design.md 13.4、13.14；C 包）。
// - rtsHeroAI(dt)：mech-rts.js 的 rtsUnitAI 開頭轉過來（e.hero 時）。施法中（衝刺、跳躍、潛地、回城信標的引導）、
//   技能指令（ability：走到射程內再放）、撿道具（pickup）、走到商店買（shop）、不落要塞的定身、自動施放由這裡接手；
//   回傳 undefined＝照一般單位處理（移動、攻擊移動、待命時自動迎擊）。
// - rtsSkillDo(id, P, tgt)：技能的效果（Game.rtsSkillCast 檢查、扣 Coral、進冷卻之後呼叫）。傷害一律經過
//   Game.rtsHeroDmg／rtsHeroSplash（→ 核心的 rtsHit／rtsSplash，乘施放者的 dmgMul）；數值用 rtsBuff。
// - 實體端的暫存 e.hs：dash（衝刺）、leap（跳躍）、burrow（潛地）、chan（引導）、root（定身到的局內時間）、
//   stealth（隱形到的時間）、high（高點射擊）、shield（緊急障壁）、kitT（修復套件）、alpha（目前的透明度）
import { MechEntity } from './mech-entity.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { RTS_HERO_DEFS, RTS_SKILLS } from '../data/rts-heroes.js';

const ZERO = new THREE.Vector3();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AUTO_DT = 0.5; // 自動施放的檢查間隔

Object.assign(MechEntity.prototype, {
  // ---------- 每格 ----------
  rtsHeroAI(dt) {
    const g = this.game,
      R = g.rts;
    if (!R || this.dead || !this.hero) return undefined;
    const H = this.hs || (this.hs = {});
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    if (H.dash) return this.rtsHeroDashStep(dt);
    if (H.leap) return this.rtsHeroLeapStep(dt);
    if (H.burrow) return this.rtsHeroBurrowStep(dt);
    if (this.staggerT > 0 || R.over) return undefined;
    if (H.chan) {
      this.rtsHeroPrep(dt);
      if (R.t >= H.chan.until) {
        H.chan = null;
        g.rtsItemBeaconDone(this);
      } else if (Math.random() < dt * 4) g.fx.spark(this.center(), 0x80c0ff);
      return this.rtsHeroFinish(dt);
    }
    const o = this.orders[0];
    if (o && (o.k === 'ability' || o.k === 'pickup' || o.k === 'shop')) {
      this.rtsHeroPrep(dt);
      if (o !== rt.cur) {
        if (this.rtsLeaveOrder) this.rtsLeaveOrder(rt.cur);
        rt.cur = o;
        rt.nav = null;
        rt.engage = null;
      }
      let done = true;
      if (o.k === 'ability') done = this.rtsHeroAbilityOrder(o, dt);
      else if (o.k === 'pickup') done = this.rtsHeroPickupOrder(o, dt);
      else done = this.rtsHeroShopOrder(o, dt);
      if (done && this.orders[0] === o) this.orders.shift();
      return this.rtsHeroFinish(dt);
    }
    // 不落要塞：定身（像守住一樣只打射程內的）
    if (H.root > R.t) {
      this.rtsHeroPrep(dt);
      if (o && o.k !== 'hold' && o.k !== 'attack') this.orders.length = 0;
      if (o && o.k === 'attack') {
        const t = g.rtsEnt(o.id);
        if (!t || t.dead) this.orders.shift();
        else this.rtsFight(t, dt, D, false);
      } else this.rtsHold(dt, D);
      return this.rtsHeroFinish(dt);
    }
    // 自動施放（勾選的技能；預設全關）
    H.autoT = (H.autoT || 0) - dt;
    if (H.autoT <= 0) {
      H.autoT = AUTO_DT;
      this.rtsHeroAutoCast();
    }
    return undefined;
  },
  // 和 rtsUnitAI 開頭相同的每格準備
  rtsHeroPrep(dt) {
    const rt = this.rt;
    rt.wish.set(0, 0, 0);
    rt.face = null;
    rt.fireT -= dt;
    rt.scanT -= dt;
  },
  // 和 rtsUnitAI 結尾相同：朝向＋move
  rtsHeroFinish(dt) {
    const rt = this.rt;
    if (rt.face) this.setAim(rt.face);
    else if (rt.wish.lengthSq() > 0.01) {
      const c = this.pos;
      this.setAim(V(c.x + rt.wish.x * 10, c.y + this.model.height * 0.5, c.z + rt.wish.z * 10));
    }
    this.move(dt, rt.wish, false, false, false, null);
    return true;
  },
  rtsHeroSlot(ab) {
    const D = RTS_HERO_DEFS[this.rtsDef];
    return D ? D.skills.indexOf(ab) : -1;
  },
  // 技能指令：走到射程內再施放；不會這個技能、不能施放（冷卻、Coral 不足）就放棄
  rtsHeroAbilityOrder(o, dt) {
    const g = this.game;
    const slot = this.rtsHeroSlot(o.ab);
    if (slot < 0) return true;
    const S = RTS_SKILLS[o.ab];
    const why = g.rtsSkillWhy(this, slot);
    if (why) {
      if (this.rtsTeam === 0 && why !== '被動技能') g.rtsSay(why);
      return true;
    }
    let tgt = null,
      d = 0;
    if (S.kind === 'unit') {
      tgt = g.rtsEnt(o.id);
      if (!tgt || tgt.dead) return true;
      d = this.rtsDistTo(tgt);
    } else if (S.kind === 'point') {
      tgt = { x: o.x, z: o.z };
      if (o.x === undefined) {
        const t = g.rtsEnt(o.id);
        if (!t) return true;
        tgt = { x: t.pos.x, z: t.pos.z };
      }
      d = Math.hypot(tgt.x - this.pos.x, tgt.z - this.pos.z);
      // 直線類（飽和砲擊）：任何距離都可以，朝那個方向
      if (S.line) d = 0;
    }
    const range = S.range || 0;
    if (S.kind !== 'self' && d > range) {
      const p = tgt.pos || tgt;
      this.rtsGo(p.x, p.z, Math.max(1, range * 0.85), dt, null, false);
      return false;
    }
    if (tgt && tgt.pos) this.rt.face = this.rt.faceV.copy(tgt.center ? tgt.center() : tgt.pos);
    if (!g.rtsSkillCast(this, slot, tgt) && this.rtsTeam === 0) g.rtsSay('不能施放');
    return true;
  },
  rtsHeroPickupOrder(o, dt) {
    const g = this.game;
    const it = g.rtsItemById(o.uid);
    if (!it) return true;
    if (Math.hypot(it.x - this.pos.x, it.z - this.pos.z) <= 2.2) {
      g.rtsItemPickup(this, it);
      return true;
    }
    // 到了（或 rtsGo 走不到放棄）：撿得到就撿，否則取消
    if (!this.rtsGo(it.x, it.z, 1.2, dt, null, false)) return false;
    if (Math.hypot(it.x - this.pos.x, it.z - this.pos.z) <= 2.6) g.rtsItemPickup(this, it);
    return true;
  },
  rtsHeroShopOrder(o, dt) {
    const g = this.game;
    const shop = g.rtsEnt(o.id);
    if (!shop || shop.dead || !g.rtsBuyShopOk(shop, this.rtsTeam)) return true;
    if (g.rtsBuyDist(this, shop) <= 10) {
      if (o.item) g.rtsBuy(this, shop, o.item);
      return true;
    }
    if (!this.rtsGo(shop.pos.x, shop.pos.z, 8, dt, null, false)) return false;
    if (o.item) g.rtsBuy(this, shop, o.item); // 到了（或走不到）：買得到就買
    return true;
  },
  // 自動施放：勾選的技能（rec.auto 或 HUD 的 e.rtsAuto）在條件符合時放
  rtsHeroAutoCast() {
    const g = this.game,
      rec = this.hero,
      D = RTS_HERO_DEFS[this.rtsDef];
    if (!D) return;
    for (let i = 0; i < 4; i++) {
      const id = D.skills[i];
      if (!(rec.auto[i] || (this.rtsAuto && this.rtsAuto[id]))) continue;
      if (g.rtsSkillWhy(this, i)) continue;
      const S = RTS_SKILLS[id];
      const tgt = this.rtsHeroAutoTarget(S);
      if (tgt === null) continue;
      if (g.rtsSkillCast(this, i, tgt || null)) return;
    }
  },
  // 自動施放的目標：undefined＝不用目標（自己）、null＝現在不放
  rtsHeroAutoTarget(S) {
    const g = this.game,
      team = this.rtsTeam;
    if (S.kind === 'unit' && S.tgt === 'ally') {
      // 血量 < 50% 的友軍（英雄優先）
      let best = null,
        bs = 0.5;
      for (const a of g.rtsHeroAllies(team, this.pos.x, this.pos.z, S.range)) {
        const k = a.hp / a.maxHp - (a.hero ? 0.2 : 0);
        if (k < bs) ((bs = k), (best = a));
      }
      return best || null;
    }
    const r = S.kind === 'unit' ? S.range : S.aiR || S.range || 12;
    const foes = g.rtsHeroFoes(team, this.pos.x, this.pos.z, r).filter((t) => !t.noLock);
    if (!foes.length) return null;
    const eng = this.rt.engage && foes.includes(this.rt.engage) ? this.rt.engage : null;
    let t = eng;
    if (!t) {
      let bd = 1e9;
      for (const f of foes) {
        const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) + (f.bld ? 30 : 0);
        if (d < bd) ((bd = d), (t = f));
      }
    }
    if (S.kind === 'unit') return t.bld ? null : t;
    if (S.kind === 'point') return { x: t.pos.x, z: t.pos.z };
    return undefined;
  },

  // ---------- 施法中的移動 ----------
  // 衝刺：往目標高速移動，碰到時 onHit
  rtsHeroDashStep(dt) {
    const g = this.game,
      H = this.hs,
      d = H.dash;
    const t = d.tgt;
    d.t += dt;
    if (!t || t.dead || d.t > d.max) {
      H.dash = null;
      return this.rtsHeroFinishJump(dt);
    }
    const dx = t.pos.x - this.pos.x,
      dz = t.pos.z - this.pos.z;
    const L = Math.hypot(dx, dz);
    const reach = (t.radius || 1) + (this.radius || 1.5) + 0.6;
    if (L <= reach) {
      H.dash = null;
      d.onHit(t);
      return this.rtsHeroFinishJump(dt);
    }
    const s = Math.min(L - reach * 0.8, d.sp * dt);
    g.rtsHeroShift(this, this.pos.x + (dx / L) * s, this.pos.z + (dz / L) * s);
    this.yaw = this.aimYaw = Math.atan2(-dx, -dz);
    this.mesh.rotation.y = this.yaw;
    if (Math.random() < 0.6) g.fx.boostFlame(this.center(), V(-dx / L, 0, -dz / L), 0xffa040);
    return true;
  },
  // 跳躍（SPIRE 的攀升）：拋物線，可以上高台
  rtsHeroLeapStep(dt) {
    const g = this.game,
      w = g.world,
      H = this.hs,
      L = H.leap;
    L.t += dt;
    const k = Math.min(1, L.t / L.T);
    const x = L.x0 + (L.x1 - L.x0) * k,
      z = L.z0 + (L.z1 - L.z0) * k;
    this.pos.set(x, L.y0 + (L.y1 - L.y0) * k + L.h * 4 * k * (1 - k), z);
    this.mesh.position.copy(this.pos);
    if (g.rts) g.rts.hash.update(this, x, z);
    if (k >= 1) {
      H.leap = null;
      this.pos.y = w.groundAt(x, z, this.pos.y + 1);
      g.fx.dust(this.pos.clone(), 3, 10);
      return this.rtsHeroFinishJump(dt);
    }
    return true;
  },
  // 潛地（SIROCCO 的沙中突襲）：隱藏、不能被攻擊，時間到從目標腳下鑽出
  rtsHeroBurrowStep(dt) {
    const g = this.game,
      R = g.rts,
      H = this.hs,
      b = H.burrow;
    if (R.t < b.until) {
      if (b.tgt && !b.tgt.dead) ((b.x = b.tgt.pos.x), (b.z = b.tgt.pos.z));
      return true;
    }
    H.burrow = null;
    this.mesh.visible = true;
    g.rtsHeroShift(this, b.x + 1.2, b.z + 1.2);
    const p = V(b.x, g.world.terrainHeight(b.x, b.z), b.z);
    g.fx.explosion(p.clone().setY(p.y + 0.5), b.P.R, 0xd8b070);
    g.fx.dust(p, b.P.R, 14, 0xc8a870);
    g.rtsHeroSplash(this, b.x, b.z, b.P.R, b.P.dmg, 'exp', 600);
    for (const t of g.rtsHeroFoes(this.rtsTeam, b.x, b.z, b.P.R, true)) g.rtsStun(t, b.P.stun);
    return this.rtsHeroFinishJump(dt);
  },
  rtsHeroFinishJump(dt) {
    if (this.vel) this.vel.set(0, 0, 0);
    this.rt.nav = null;
    this.move(dt, ZERO, false, false, false, null);
    return true;
  },

  // ---------- 技能的效果 ----------
  // 回傳 true＝放出去了
  rtsSkillDo(id, P, tgt) {
    const fn = SKILL_FX[id];
    if (!fn) return false;
    return fn(this, this.game, P, tgt) !== false;
  },
  // 面向的方向（有交戰目標時朝目標）
  rtsHeroFwd() {
    const t = this.rt && this.rt.engage;
    if (t && !t.dead) {
      const dx = t.pos.x - this.pos.x,
        dz = t.pos.z - this.pos.z;
      const L = Math.hypot(dx, dz);
      if (L > 0.5) return { x: dx / L, z: dz / L };
    }
    return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; // 機體的前方是 (−sin, −cos)
  },
});

// ---------- 共用的效果零件 ----------
const gy = (g, x, z) => g.world.terrainHeight(x, z);
const P3 = (g, x, z, dy = 0) => V(x, gy(g, x, z) + dy, z);
// 飛彈雨：(x, z) 半徑 R 內 dur 秒落下 n 發，每發小範圍 dmg
function missileRain(e, g, x, z, R, n, dmg, dur, delay = 0.3) {
  g.fx.warnCircle(P3(g, x, z, 0.1), R, delay + dur);
  for (let i = 0; i < n; i++)
    g.later(delay + (i * dur) / n, () => {
      if (!g.rts) return;
      const a = Math.random() * Math.PI * 2,
        r = Math.sqrt(Math.random()) * R;
      const px = x + Math.cos(a) * r,
        pz = z + Math.sin(a) * r;
      const p = P3(g, px, pz, 0.6);
      if (g.rtsFxOk(p)) {
        g.fx.beam(p.clone().setY(p.y + 22), p, 0xffb060, 0.08);
        g.fx.explosion(p, 2.6, 0xffa040);
      }
      g.rtsHeroSplash(e, px, pz, 3, dmg, 'exp', 120, e.rtsTeam);
    });
}
// 地面衝擊波（特效＋範圍傷害）
function quake(e, g, x, z, R, dmg, stun = 0) {
  const p = P3(g, x, z, 0.2);
  g.fx.groundWave(p, R, 26, 0.05, (a, b) => gy(g, a, b));
  g.fx.dust(p, R * 0.6, 10);
  g.rtsHeroSplash(e, x, z, R, dmg, 'exp', 400, e.rtsTeam);
  if (stun) for (const t of g.rtsHeroFoes(e.rtsTeam, x, z, R, true)) g.rtsStun(t, stun);
}
// 90° 一格的朝向（牆的長邊垂直於 dir）
const wallYaw = (dx, dz) => (Math.abs(dx) > Math.abs(dz) ? Math.PI / 2 : 0);
// 隱形
function stealth(e, g, sec) {
  e.hs.stealth = g.rts.t + sec;
  e.noLock = true;
  g.rts.hfx.nl.add(e);
  g.fx.flash(e.center(), 2.5, 0xcfe8ff, 0.25);
}

// 技能 id → (e, g, P（這一級的數值）, tgt) => false＝沒放出去
const SKILL_FX = {
  // ===== BASTION =====
  sk_plate(e, g, P, t) {
    g.rtsBuff(t, { src: 'sk_plate', armor: P.armor }, P.t);
    g.fx.ring(t.pos.clone().setY(t.pos.y + 0.3), 2.6, 0x9fd0ff);
    g.fx.flash(t.center(), 2, 0x9fd0ff, 0.2);
  },
  sk_bulwark(e, g, P, p) {
    const dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    const yaw = wallYaw(dx, dz);
    // 長邊方向（yaw 0＝沿 X）
    const ax = yaw ? 0 : 1,
      az = yaw ? 1 : 0;
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      const o = (i - (P.n - 1) / 2) * 6.2;
      const id = g.rtsHeroWall(p.x + ax * o, p.z + az * o, {
        kind: 'rock',
        w: 6,
        h: 3,
        d: 1.5,
        yaw,
        hp: P.hp,
        life: P.t,
      });
      if (id >= 0) n++;
    }
    return n > 0;
  },
  sk_fortress(e, g, P) {
    const R = g.rts;
    e.hs.root = R.t + P.t;
    e.orders.length = 0;
    g.rtsBuff(e, { src: 'sk_fortress', taken: P.taken, range: P.range, speed: 0 }, P.t);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 4, 0xffd070);
    const n = Math.floor(P.t / P.every);
    for (let i = 0; i < n; i++)
      g.later(0.4 + i * P.every, () => {
        if (!g.rts || e.dead) return;
        quake(e, g, e.pos.x, e.pos.z, P.R, P.dmg);
      });
  },
  // ===== RAIN =====
  sk_rain(e, g, P, p) {
    missileRain(e, g, p.x, p.z, P.R, P.n, P.dmg, 3);
  },
  sk_mark(e, g, P, t) {
    g.rtsBuff(t, { src: 'sk_mark', taken: P.taken }, P.t);
    const F = g.rts.hfx;
    F.marks = F.marks.filter((m) => !(m.t === t && m.team === e.rtsTeam));
    F.marks.push({ t, team: e.rtsTeam, until: g.rts.t + P.t });
    if (g.rtsFogReveal) g.rtsFogReveal(e.rtsTeam, t.pos.x, t.pos.z, 8, 0.8);
    g.fx.beam(e.center(), t.center(), 0xff4040, 0.05);
  },
  sk_barrage(e, g, P, p) {
    let dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    dx /= L;
    dz /= L;
    const x0 = e.pos.x + dx * 4,
      z0 = e.pos.z + dz * 4;
    const x1 = x0 + dx * P.len,
      z1 = z0 + dz * P.len;
    g.fx.warnLine(P3(g, x0, z0, 0.3), P3(g, x1, z1, 0.3), P.warn + P.dur, 0xff3020, 0.25);
    const n = Math.round(P.dur / P.gap);
    for (let i = 0; i < n; i++)
      g.later(P.warn + i * P.gap, () => {
        if (!g.rts) return;
        const k = (i + 0.5) / n;
        const x = x0 + (x1 - x0) * k + (Math.random() - 0.5) * 2,
          z = z0 + (z1 - z0) * k + (Math.random() - 0.5) * 2;
        const q = P3(g, x, z, 0.6);
        if (g.rtsFxOk(q)) {
          g.fx.beam(q.clone().setY(q.y + 26), q, 0xffa040, 0.1);
          g.fx.explosion(q, P.R, 0xff8030);
        }
        g.rtsHeroSplash(e, x, z, P.R, P.dmg, 'exp', 300, e.rtsTeam);
      });
    g.later(P.warn + P.dur, () => {
      if (g.rts) missileRain(e, g, x1, z1, 8, P.end, 40, 2.5, 0.2);
    });
  },
  // ===== PILEDRIVER =====
  sk_rush(e, g, P, t) {
    e.hs.dash = {
      tgt: t,
      t: 0,
      max: 1.4,
      sp: 34,
      onHit: (q) => {
        g.rtsHeroDmg(e, q, P.dmg, 'kin', 800);
        g.rtsStun(q, P.stun);
        g.fx.meleeHit(q.center(), 0xffc060, true, V(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)));
      },
    };
    e.orders.length = 0;
  },
  sk_pile(e, g, P, t) {
    g.rtsHeroDmg(e, t, P.dmg, 'pierce', 1200);
    g.rtsStun(t, 1.2);
    g.fx.meleeHit(t.center(), 0xffe080, true, V(t.pos.x - e.pos.x, 0, t.pos.z - e.pos.z).normalize());
    g.fx.shockwave(t.center(), 3, 0xffd090);
  },
  sk_quake(e, g, P) {
    const f = e.rtsHeroFwd();
    const x0 = e.pos.x,
      z0 = e.pos.z;
    for (let i = 0; i < P.n; i++)
      g.later(i * 0.35, () => {
        if (!g.rts) return;
        const d = P.step * (i + 1);
        quake(e, g, x0 + f.x * d, z0 + f.z * d, P.R, P.dmg, P.stun);
        g.fx.explosion(P3(g, x0 + f.x * d, z0 + f.z * d, 0.5), 3, 0xff9040);
      });
    g.rtsBuff(e, { src: 'sk_quake', speed: P.speed }, P.t);
  },
  // ===== RUST =====
  sk_scav(e, g, P) {
    const R = g.rts,
      F = R.hfx;
    const near = F.wrecks
      .filter((w) => R.t - w.t <= 30 && Math.hypot(w.x - e.pos.x, w.z - e.pos.z) <= RTS_SKILLS.sk_scav.r)
      .sort((a, b) => Math.hypot(a.x - e.pos.x, a.z - e.pos.z) - Math.hypot(b.x - e.pos.x, b.z - e.pos.z))
      .slice(0, P.max);
    if (!near.length) {
      if (e.rtsTeam === 0) g.rtsSay('附近沒有殘骸');
      return false;
    }
    for (const w of near) {
      F.wrecks.splice(F.wrecks.indexOf(w), 1);
      e.hp = Math.min(e.maxHp, e.hp + 80);
      g.rtsGrant(e.rtsTeam, 10, 0);
      g.fx.beam(P3(g, w.x, w.z, 0.5), e.center(), 0xd0a060, 0.08);
    }
  },
  sk_junk(e, g, P, p) {
    g.fx.warnCircle(P3(g, p.x, p.z, 0.1), P.R, 0.8);
    g.later(0.8, () => {
      if (!g.rts) return;
      g.fx.explosion(P3(g, p.x, p.z, 0.6), P.R * 0.8, 0xc0a080);
      g.fx.dust(P3(g, p.x, p.z), P.R, 10, 0x8a7a60);
      g.rtsHeroSplash(e, p.x, p.z, P.R, P.dmg, 'kin', 400, e.rtsTeam);
    });
  },
  sk_storm(e, g, P) {
    g.rtsBuff(e, { src: 'sk_storm', armor: P.armor }, P.t);
    for (let i = 0; i < P.t; i++)
      g.later(0.5 + i, () => {
        if (!g.rts || e.dead) return;
        g.fx.groundWave(P3(g, e.pos.x, e.pos.z, 0.2), P.R, 30, 0, (a, b) => gy(g, a, b), 0xc0a070);
        g.fx.streaks(e.center(), 10, 0xc0a070, 18, 0.5);
        g.rtsHeroSplash(e, e.pos.x, e.pos.z, P.R, P.dmg, 'kin', 100, e.rtsTeam);
      });
  },
  // ===== SIROCCO =====
  sk_sand(e, g, P, p) {
    g.rtsHeroZone({
      x: p.x,
      z: p.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      ally: { taken: P.taken },
      smoke: true,
      fx: 'smoke',
    });
  },
  sk_ambush(e, g, P, t) {
    e.hs.burrow = { tgt: t, until: g.rts.t + P.hide, P, x: t.pos.x, z: t.pos.z };
    e.orders.length = 0;
    e.noLock = true;
    g.rts.hfx.nl.add(e);
    g.fx.dust(e.pos.clone(), 3, 12, 0xc8a870);
    e.mesh.visible = false;
    e.hs.alpha = 0;
  },
  sk_dome(e, g, P) {
    g.rtsHeroZone({
      x: e.pos.x,
      z: e.pos.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      ally: { taken: P.taken },
      rangeK: P.rangeK,
      smoke: true,
      fx: 'smoke',
    });
  },
  // ===== WHITEOUT =====
  sk_white(e, g, P) {
    stealth(e, g, P.t);
  },
  sk_snipe(e, g, P, t) {
    const a = e.muzzle ? e.muzzle('rarm') : e.center();
    g.fx.beam(a, t.center(), 0xbfe8ff, 0.12);
    g.fx.flash(t.center(), 1.6, 0xbfe8ff, 0.15);
    g.rtsHeroDmg(e, t, P.dmg, 'pierce', 500);
  },
  sk_freeze(e, g, P, p) {
    g.rtsHeroZone({
      x: p.x,
      z: p.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      foe: { speed: P.speed },
      fx: null,
    });
    g.fx.ring(P3(g, p.x, p.z, 0.3), P.R, 0xbfe8ff);
    g.fx.shockwave(P3(g, p.x, p.z, 0.5), P.R, 0xbfe8ff);
    for (let i = 0; i < P.walls; i++) {
      const a = (i / P.walls) * Math.PI * 2 + 0.4;
      const x = p.x + Math.cos(a) * (P.R * 0.7),
        z = p.z + Math.sin(a) * (P.R * 0.7);
      g.rtsHeroWall(x, z, {
        kind: 'ice',
        w: 6,
        h: 3.5,
        d: 1.4,
        yaw: wallYaw(Math.cos(a), Math.sin(a)),
        hp: P.hp,
        life: 14,
      });
    }
  },
  // ===== SPECIMEN =====
  sk_overload(e, g, P) {
    g.rtsBuff(e, { src: 'sk_overload', rof: P.rof }, P.t);
    g.fx.flash(e.center(), 2.5, 0xff60a0, 0.3);
    g.later(P.t, () => {
      if (g.rts && !e.dead) e.staggerT = Math.max(e.staggerT || 0, P.stun);
    });
  },
  sk_parasite(e, g, P, t) {
    const F = g.rts.hfx;
    F.dots = F.dots.filter((d) => !(d.t === t && d.src === e));
    F.dots.push({ t, src: e, dps: P.dps, until: g.rts.t + P.t, atk: 'en' });
    g.rtsBuff(t, { src: 'sk_parasite', speed: P.speed }, P.t);
    g.fx.beam(e.center(), t.center(), 0xa0ff60, 0.1);
  },
  sk_fuse(e, g, P) {
    const list = g
      .rtsHeroAllies(e.rtsTeam, e.pos.x, e.pos.z, P.r)
      .filter((u) => u !== e && !u.hero && !(RTS_DEFS[u.rtsDef] || {}).worker)
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z),
      )
      .slice(0, P.n);
    if (!list.length) {
      if (e.rtsTeam === 0) g.rtsSay('附近沒有可以吸收的單位');
      return false;
    }
    for (const u of list) {
      g.fx.beam(u.center(), e.center(), 0xff60a0, 0.12);
      u.rtsQuiet = true;
      u.die(null);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * P.heal);
    }
    g.rtsBuff(e, { src: 'sk_fuse', dmg: P.dmg }, P.t);
    g.fx.flash(e.center(), 3, 0xff60a0, 0.3);
  },
  // ===== SPIRE =====
  sk_climb(e, g, P, p) {
    const S = RTS_SKILLS.sk_climb;
    let dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    const L = Math.hypot(dx, dz);
    if (L > S.range) ((dx *= S.range / L), (dz *= S.range / L));
    const x1 = e.pos.x + dx,
      z1 = e.pos.z + dz;
    const w = g.world;
    const [cx, cz] = w.collide(x1, z1, w.terrainHeight(x1, z1) + 0.5, e.radius || 1.5);
    e.hs.leap = {
      t: 0,
      T: 0.8,
      x0: e.pos.x,
      z0: e.pos.z,
      y0: e.pos.y,
      x1: cx,
      z1: cz,
      y1: w.groundAt(cx, cz, w.terrainHeight(cx, cz) + 2),
      h: 7,
    };
    e.orders.length = 0;
    g.fx.dust(e.pos.clone(), 2.5, 8);
  },
  sk_high(e, g, P) {
    e.hs.high = { until: g.rts.t + P.t, k: P.k };
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 2.5, 0xffe070);
  },
  sk_summit(e, g, P) {
    const F = g.rts.hfx;
    F.summit[e.rtsTeam] = { team: e.rtsTeam, until: g.rts.t + P.t, range: P.range };
    g.fx.flash(e.center(), 3, 0xffe070, 0.3);
  },
  // ===== COUNTDOWN =====
  sk_homing(e, g, P, t) {
    for (let i = 0; i < P.n; i++)
      g.later(i * 0.15, () => {
        if (!g.rts || e.dead || t.dead) return;
        const a = e.center().add(V(0, 1.2, 0));
        g.fx.beam(a, t.center(), 0xffa040, 0.06);
        g.later(0.35, () => {
          if (!g.rts || t.dead) return;
          g.fx.explosion(t.center(), 1.8, 0xffa040);
          g.rtsHeroDmg(e, t, P.dmg, 'exp', 120);
        });
      });
  },
  sk_burner(e, g, P) {
    const n = Math.round(P.t / 0.5);
    for (let i = 0; i < n; i++)
      g.later(i * 0.5, () => {
        if (!g.rts || e.dead) return;
        const f = e.rtsHeroFwd();
        g.fx.flameCone(e.center(), V(f.x, 0, f.z), P.len, 0.5, 8);
        for (const t of g.rtsHeroFoes(e.rtsTeam, e.pos.x, e.pos.z, P.len, true)) {
          const dx = t.pos.x - e.pos.x,
            dz = t.pos.z - e.pos.z;
          const L = Math.hypot(dx, dz) || 1;
          if ((dx * f.x + dz * f.z) / L < Math.cos(0.55)) continue;
          g.rtsHeroDmg(e, t, P.dps * 0.5, 'exp', 60);
        }
      });
  },
  sk_launch(e, g, P, p) {
    g.fx.warnCircle(P3(g, p.x, p.z, 0.1), P.R, P.delay);
    if (g.rtsFogReveal) g.rtsFogReveal(e.rtsTeam, p.x, p.z, P.R, P.delay + 1);
    g.later(P.delay, () => {
      if (!g.rts) return;
      const q = P3(g, p.x, p.z, 1);
      g.fx.beam(q.clone().setY(q.y + 60), q, 0xffe0a0, 0.6);
      g.fx.explosion(q, P.R * 0.7, 0xffa040, true);
      g.fx.shockwave(q, P.R, 0xffc080);
      g.rtsHeroSplash(e, p.x, p.z, P.R, P.dmg, 'exp', 1200, e.rtsTeam);
    });
  },
  // ===== UNDERTOW =====
  sk_shove(e, g, P, t) {
    e.hs.dash = {
      tgt: t,
      t: 0,
      max: 1,
      sp: 30,
      onHit: (q) => {
        g.rtsHeroDmg(e, q, P.dmg, 'kin', 700);
        if (!q.bld && !q.noPush) {
          const dx = q.pos.x - e.pos.x,
            dz = q.pos.z - e.pos.z;
          const L = Math.hypot(dx, dz) || 1;
          g.rtsHeroShift(q, q.pos.x + (dx / L) * P.kb, q.pos.z + (dz / L) * P.kb);
          g.rtsHeroTide(e, q);
        }
        g.fx.meleeHit(q.center(), 0x60c0ff, true, V(-Math.sin(e.yaw), 0, -Math.cos(e.yaw)));
      },
    };
    e.orders.length = 0;
  },
  sk_vortex(e, g, P, p) {
    g.rtsHeroZone({ x: p.x, z: p.z, r: P.R, t: P.t, src: e, team: e.rtsTeam, pull: P.pull, fx: 'pull' });
  },
  sk_undertow(e, g, P) {
    const foes = g.rtsHeroFoes(e.rtsTeam, e.pos.x, e.pos.z, P.R, true);
    g.fx.shockwave(e.center(), P.R, 0x60c0ff);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), P.R, 0x60c0ff);
    for (const t of foes) {
      if (!t.noPush && !t.flying) {
        const a = Math.atan2(t.pos.z - e.pos.z, t.pos.x - e.pos.x);
        g.rtsHeroShift(t, e.pos.x + Math.cos(a) * 3, e.pos.z + Math.sin(a) * 3);
        g.rtsHeroTide(e, t);
      }
      g.rtsStun(t, P.stun);
      g.rtsHeroDmg(e, t, P.dmg, 'kin', 300);
    }
  },
  // ===== MARSH =====
  sk_lurk(e, g, P) {
    stealth(e, g, P.t);
  },
  sk_acid(e, g, P, p) {
    g.rtsHeroZone({
      x: p.x,
      z: p.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      dps: P.dps,
      atk: 'en',
      foe: { armor: P.armor },
      acid: true,
      fx: 'acid',
    });
  },
  sk_swamp(e, g, P) {
    g.rtsHeroZone({
      x: e.pos.x,
      z: e.pos.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      dps: P.dps,
      atk: 'en',
      foe: { speed: P.speed },
      acid: true,
      fx: 'acid',
    });
  },
};
