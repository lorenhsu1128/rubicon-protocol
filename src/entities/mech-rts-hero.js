// Coral 戰爭（RTS）的英雄：MechEntity 擴充（docs/rts-design.md 13.4、13.14；C 包）。
// - rtsHeroAI(dt)：mech-rts.js 的 rtsUnitAI 開頭轉過來（e.hero 時）。施法中（衝刺、跳躍、潛地、回城信標的引導）、
//   技能指令（ability：走到射程內再放）、撿道具（pickup）、走到商店買（shop）、不落要塞的定身、自動施放由這裡接手；
//   回傳 undefined＝照一般單位處理（移動、攻擊移動、待命時自動迎擊）。
// - rtsSkillDo(id, P, tgt)：技能的效果（Game.rtsSkillCast 檢查、扣 Coral、進冷卻之後呼叫）。傷害一律經過
//   Game.rtsHeroDmg／rtsHeroSplash（→ 核心的 rtsHit／rtsSplash，乘施放者的 dmgMul）；數值用 rtsBuff。
// - 實體端的暫存 e.hs：dash（衝刺）、leap（跳躍）、burrow（潛地）、chan（引導）、root（定身到的局內時間）、
//   stealth（隱形到的時間）、high（高點射擊）、shield（緊急障壁）、kitT（修復套件）、alpha（目前的透明度）、
//   blitz（COURIER 的急件突進：往地點直線衝刺）、flareT（熱焰彈：不能被鎖定到的時間）、
//   聖域（docs 16.4）：reviveN（重新站起來的台數）、golemN（臨時巨像用掉的殘骸）、mailN（廢鐵外殼吸的殘骸）、
//   mineN（布雷區放下的地雷）、triageN（緊急處置的台數）、refuge（最後的避難所的區域 id）
import { MechEntity } from './mech-entity.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { RTS_HERO_DEFS, RTS_SKILLS } from '../data/rts-heroes.js';
import { buildBomberMesh } from '../render/extra-models.js';
import { SFX } from '../audio/audio.js';

const ZERO = new THREE.Vector3();
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const AUTO_DT = 0.5; // 自動施放的檢查間隔
// 緊急處置不清掉的「速度 0」：施放者自己的定身（不落要塞、最後的避難所）
const SELF_ROOT = new Set(['sk_fortress', 'sk_refuge']);
// 技能的音效（R6 D 包，docs 17.2 #8）：既有的 SFX_DATA 依技能的種類對應 [音效, 音量, 速度]；Game.rtsSkillCast 成功之後
// rtsSfxSkill 播放（只對看得到的位置或自己的英雄）。爆發＝explode／boom 系、能量＝laser 系、治療與護盾＝dome／shield、
// 牆＝rock／glass、實彈＝punch／rifle／crunch、飛彈＝missile、隱形與幻象＝glitch、召喚與空投＝thrBurst、增益＝boostUp／charge
const SFX_EXP = ['explode2', 0.6, 1],
  SFX_LASER = ['laser2', 0.55, 1],
  SFX_HEAL = ['dome1', 0.5, 1.1],
  SFX_SHIELD = ['shield', 0.55, 1],
  SFX_BUFF = ['charge', 0.5, 1.1],
  SFX_DASH = ['boostUp', 0.6, 1],
  SFX_HIDE = ['glitch', 0.5, 1],
  SFX_DROP = ['thrBurst', 0.6, 0.9],
  SFX_PULL = ['dome2', 0.55, 0.8],
  SFX_ACID = ['splash', 0.55, 0.8];
const RTS_SKILL_SFX = {
  sk_plate: ['plate1', 0.6, 1],
  sk_bulwark: ['rock1', 0.65, 0.9],
  sk_fortress: ['heavy', 0.65, 0.8],
  sk_rain: ['missile', 0.6, 1],
  sk_mark: ['bong', 0.5, 1.2],
  sk_barrage: ['boom1', 0.6, 1],
  sk_rush: SFX_DASH,
  sk_pile: ['punch2', 0.7, 0.9],
  sk_quake: ['explode3', 0.65, 0.8],
  sk_scav: ['clatter1', 0.55, 1],
  sk_junk: ['crunch1', 0.6, 1],
  sk_storm: ['clatter2', 0.6, 0.9],
  sk_sand: ['thud1', 0.55, 0.8],
  sk_ambush: ['rock2', 0.6, 0.9],
  sk_dome: ['thud2', 0.55, 0.8],
  sk_white: SFX_HIDE,
  sk_snipe: ['rifle2', 0.7, 0.8],
  sk_freeze: ['glass', 0.6, 0.8],
  sk_overload: ['overload', 0.55, 1.1],
  sk_parasite: ['crunch2', 0.55, 1.1],
  sk_fuse: SFX_HEAL,
  sk_climb: SFX_DASH,
  sk_high: SFX_BUFF,
  sk_summit: SFX_BUFF,
  sk_homing: ['missile', 0.6, 1.1],
  sk_burner: SFX_DROP,
  sk_launch: ['alarm', 0.45, 1],
  sk_shove: ['punch1', 0.7, 0.9],
  sk_vortex: SFX_PULL,
  sk_undertow: ['splash', 0.6, 0.7],
  sk_lurk: SFX_HIDE,
  sk_acid: SFX_ACID,
  sk_swamp: SFX_ACID,
  sk_refract: SFX_LASER,
  sk_prism: SFX_SHIELD,
  sk_skylight: ['laserBig', 0.55, 1],
  sk_hatch: ['crunch3', 0.55, 1.1],
  sk_catalyze: SFX_HEAL,
  sk_massfuse: ['crunch3', 0.6, 0.9],
  sk_mirror: SFX_HIDE,
  sk_emp: ['overload', 0.6, 0.8],
  sk_legion: SFX_HIDE,
  sk_blitz: SFX_DASH,
  sk_drop: ['door', 0.55, 1],
  sk_express: ['engineHi', 0.5, 1],
  sk_pod: SFX_DROP,
  sk_reinforce: SFX_DROP,
  sk_carpet: ['alarm', 0.45, 1.1],
  sk_flak: ['boom2', 0.6, 1],
  sk_jam: SFX_HIDE,
  sk_squadron: ['engineHi', 0.5, 1.2],
  sk_mend: SFX_BUFF,
  sk_triage: SFX_HEAL,
  sk_lazarus: ['clatter1', 0.6, 0.8],
  sk_magnet: SFX_PULL,
  sk_scrapmail: ['plate2', 0.6, 0.9],
  sk_golem: ['heavy', 0.65, 0.7],
  sk_minefield: ['clatter2', 0.55, 1.1],
  sk_haven: SFX_SHIELD,
  sk_refuge: SFX_HEAL,
};
const SFX_ATK = { exp: SFX_EXP, en: SFX_LASER, hero: SFX_BUFF }; // 表裡沒有的：依技能的攻擊類型

Object.assign(MechEntity.prototype, {
  // 技能的音效（Game.rtsSkillCast 成功之後）：自己隊伍的英雄一律播，其他的只在玩家看得到施放者或目標點時播；
  // 位置＝地點技能的目標點（其他＝施放者），距離衰減照 SFX.play
  rtsSfxSkill(id, tgt) {
    const g = this.game;
    const S = RTS_SKILLS[id] || {};
    const k = RTS_SKILL_SFX[id] || SFX_ATK[S.atk] || SFX_BUFF;
    const p = tgt && tgt.x !== undefined && !tgt.pos ? V(tgt.x, this.pos.y + 1, tgt.z) : this.center();
    const seen = (x, z) => !g.rtsFogState || g.rtsFogState(0, x, z) === 2;
    if (this.rtsTeam !== 0 && !seen(this.pos.x, this.pos.z) && !seen(p.x, p.z)) return false;
    SFX.play(k[0], k[1], k[2], 0.05, 0.05, p);
    return k[0];
  },
  // 技能的投放艙外觀（強襲空投艙、緊急增援；B 包的 Game.rtsVeerPodFx）：sec 秒後著地、預警圈半徑 r。
  // 沒有 rtsVeerPodFx 時回傳 null（呼叫端改用原本的預警圈）
  rtsHeroPod(g, x, z, sec, r) {
    const R = g.rts;
    if (!R || !g.rtsVeerPodFx) return null;
    R.hPodN = (R.hPodN || 0) + 1;
    const pod = { id: 900 + R.hPodN, team: this.rtsTeam, x, z, t: R.t + sec, t0: R.t, r, hero: true };
    g.rtsVeerPodFx(pod, 'fall');
    (R.hPods || (R.hPods = [])).push(pod);
    if (R.hPods.length > 24) R.hPods.shift();
    return pod;
  },
  // ---------- 每格 ----------
  rtsHeroAI(dt) {
    const g = this.game,
      R = g.rts;
    if (!R || this.dead || !this.hero) return undefined;
    const H = this.hs || (this.hs = {});
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    if (H.dash) return this.rtsHeroDashStep(dt);
    if (H.blitz) return this.rtsHeroBlitzStep(dt);
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
      // 直線類（飽和砲擊）：任何距離都可以，朝那個方向；any（特快專送）：任何探索過的地方
      if (S.line || S.any) d = 0;
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
        if (S.bio && !(RTS_DEFS[a.rtsDef] || {}).bio) continue; // 催化：只對生體單位
        if (a.rtsIllus) continue;
        const k = a.hp / a.maxHp - (a.hero ? 0.2 : 0);
        if (k < bs) ((bs = k), (best = a));
      }
      return best || null;
    }
    const r = S.kind === 'unit' ? S.range : S.aiR || S.range || 12;
    let foes = g.rtsHeroFoes(team, this.pos.x, this.pos.z, r).filter((t) => !t.noLock);
    // 空爆彈幕（air）：只對空中與低空的敵人
    if (S.air) foes = foes.filter((t) => !t.bld && (t.flying || (g.rtsLowAir && g.rtsLowAir(t))));
    // 磁吸（ground）：只對地面單位
    if (S.ground) foes = foes.filter((t) => !t.bld && !t.flying);
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
  // 急件突進（COURIER）：b.T 秒從 (x0, z0) 直線衝到 (x1, z1)，掃過的線段 w m 內的敵方單位各受一次傷害
  rtsHeroBlitzStep(dt) {
    const g = this.game,
      w = g.world,
      H = this.hs,
      b = H.blitz;
    b.t += dt;
    const k = Math.min(1, b.t / b.T);
    const px = this.pos.x,
      pz = this.pos.z;
    const x = b.x0 + (b.x1 - b.x0) * k,
      z = b.z0 + (b.z1 - b.z0) * k;
    this.pos.set(x, w.groundAt(x, z, this.pos.y + 2.5), z);
    this.mesh.position.copy(this.pos);
    if (g.rts) g.rts.hash.update(this, x, z);
    // 這一格掃過的線段 (px, pz)→(x, z)
    const sx = x - px,
      sz = z - pz,
      sl = Math.hypot(sx, sz);
    for (const t of g.rtsHeroFoes(this.rtsTeam, (px + x) / 2, (pz + z) / 2, sl / 2 + b.P.w + 1, true)) {
      if (b.hit.has(t.id) || t.dead) continue;
      if (t.flying && !(g.rtsLowAir && g.rtsLowAir(t))) continue;
      const u =
        sl > 1e-4 ? Math.max(0, Math.min(1, ((t.pos.x - px) * sx + (t.pos.z - pz) * sz) / (sl * sl))) : 0;
      const off = Math.hypot(t.pos.x - (px + sx * u), t.pos.z - (pz + sz * u)) - (t.radius || 1);
      if (off > b.P.w) continue;
      b.hit.add(t.id);
      g.rtsHeroDmg(this, t, b.P.dmg, 'kin', 500);
      if (g.rtsFxOk(t.pos)) g.fx.meleeHit(t.center(), 0x9be070, true, V(b.dx, 0, b.dz));
    }
    if (Math.random() < 0.7 && g.rtsFxOk(this.pos))
      g.fx.boostFlame(this.center(), V(-b.dx, 0, -b.dz), 0x9be070);
    if (k >= 1) {
      H.blitz = null;
      return this.rtsHeroFinishJump(dt);
    }
    return true;
  },
  // 拋物線跳到 p（最遠 range m；可以上高台）：SPIRE 的攀升、推進背包（維爾威的道具）共用
  rtsHeroLeapTo(p, range, T = 0.8, h = 7) {
    const g = this.game,
      w = g.world;
    let dx = p.x - this.pos.x,
      dz = p.z - this.pos.z;
    const L = Math.hypot(dx, dz);
    if (L > range) ((dx *= range / L), (dz *= range / L));
    const x1 = this.pos.x + dx,
      z1 = this.pos.z + dz;
    const [cx, cz] = w.collide(x1, z1, w.terrainHeight(x1, z1) + 0.5, this.radius || 1.5);
    (this.hs || (this.hs = {})).leap = {
      t: 0,
      T,
      x0: this.pos.x,
      z0: this.pos.z,
      y0: this.pos.y,
      x1: cx,
      z1: cz,
      y1: w.groundAt(cx, cz, w.terrainHeight(cx, cz) + 2),
      h,
    };
    this.orders.length = 0;
    if (g.rtsFxOk(this.pos)) g.fx.dust(this.pos.clone(), 2.5, 8);
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
    e.rtsHeroLeapTo(p, RTS_SKILLS.sk_climb.range);
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
  // ===== PRISM（艾瑟立克，docs 14.4） =====
  // 折射光束：朝 p 的方向 40 m、寬 3 m 的直線，預警後一次打中線上的每個敵人（建築 ×0.5）
  sk_refract(e, g, P, p) {
    let dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    let L = Math.hypot(dx, dz);
    if (L < 0.5) {
      const f = e.rtsHeroFwd();
      ((dx = f.x), (dz = f.z), (L = 1));
    }
    dx /= L;
    dz /= L;
    const x0 = e.pos.x + dx * 1.5,
      z0 = e.pos.z + dz * 1.5;
    const x1 = x0 + dx * P.len,
      z1 = z0 + dz * P.len;
    e.yaw = e.aimYaw = Math.atan2(-dx, -dz);
    g.fx.warnLine(P3(g, x0, z0, 0.4), P3(g, x1, z1, 0.4), P.warn, 0x8fd8ff, 0.12);
    g.later(P.warn, () => {
      if (!g.rts || e.dead) return;
      const a = e.center(),
        b = P3(g, x1, z1, 1.4);
      if (g.rtsFxOk(a) || g.rtsFxOk(b)) {
        g.fx.beam(a, b, 0xbfeaff, 0.22);
        g.fx.beam(a, b, 0x3a90e0, 0.55);
        g.fx.flash(b, 1.6, 0x8fd8ff, 0.15);
      }
      const mx = (x0 + x1) / 2,
        mz = (z0 + z1) / 2;
      for (const t of g.rtsHeroFoes(e.rtsTeam, mx, mz, P.len / 2 + 2)) {
        const k = Math.max(0, Math.min(P.len, (t.pos.x - x0) * dx + (t.pos.z - z0) * dz));
        const off = Math.hypot(t.pos.x - (x0 + dx * k), t.pos.z - (z0 + dz * k));
        const rad = t.bld ? Math.max(t.bld.w, t.bld.d) / 2 : t.radius || 1;
        if (off - rad > P.w / 2) continue;
        g.rtsHeroDmg(e, t, P.dmg * (t.bld ? P.bldK : 1), 'en', 300);
        if (g.rtsFxOk(t.pos)) g.fx.spark(t.center(), 0x8fd8ff);
      }
    });
  },
  sk_prism(e, g, P, t) {
    g.rtsShieldAdd(t, P.n, P.t);
    g.fx.beam(e.center(), t.center(), 0x8fe8ff, 0.08);
  },
  // 天光陣列：半徑 R 內 4 秒 n 道光柱（前 n−1 道隨機、每道 r m），最後一道在中心（r2 m、dmg2）
  sk_skylight(e, g, P, p) {
    const x = p.x,
      z = p.z;
    g.fx.warnCircle(P3(g, x, z, 0.1), P.R, P.dur + 0.2, 0x8fd8ff);
    if (g.rtsFogReveal) g.rtsFogReveal(e.rtsTeam, x, z, P.R, P.dur + 1);
    for (let i = 0; i < P.n; i++) {
      const last = i === P.n - 1;
      const T = last ? P.dur : 0.6 + (i * (P.dur - 1)) / Math.max(1, P.n - 1);
      g.later(T, () => {
        if (!g.rts) return;
        let px = x,
          pz = z;
        if (!last) {
          const a = Math.random() * Math.PI * 2,
            r = Math.sqrt(Math.random()) * P.R * 0.8;
          px += Math.cos(a) * r;
          pz += Math.sin(a) * r;
        }
        const q = P3(g, px, pz, 0);
        if (g.rtsFxOk(q)) g.fx.pillarStrike(q, last ? P.r2 * 0.6 : P.r * 0.8, last ? 0xffffff : 0x9fe8ff);
        g.rtsHeroSplash(
          e,
          px,
          pz,
          last ? P.r2 : P.r,
          last ? P.dmg2 : P.dmg,
          'en',
          last ? 900 : 300,
          e.rtsTeam,
        );
      });
    }
  },
  // ===== CURATOR =====
  sk_hatch(e, g, P) {
    if (!g.rtsHeroTemp(e, 'a_blob', P.n, P.t).length) return false;
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 3.5, 0xa0ff80);
  },
  sk_catalyze(e, g, P, t) {
    t.hp = Math.min(t.maxHp, t.hp + t.maxHp * P.heal);
    g.rtsBuff(t, { src: 'sk_catalyze', speed: P.speed }, P.t);
    g.fx.beam(e.center(), t.center(), 0xa0ff80, 0.1);
    g.fx.flash(t.center(), 2.2, 0xa0ff80, 0.25);
    // 引導中的融合：立刻完成
    if (g.rtsFuseFinish && g.rts.fuses && g.rts.fuses.some((f) => f.host === t && f.st === 'chan'))
      g.rtsFuseFinish(t);
  },
  // 群體融合：18 m 內己方的實驗體每 3 隻立刻融合成嵌合體（免費、沒有引導）；剩下的回滿血；生體單位 12 秒受到的傷害 ×0.7
  sk_massfuse(e, g, P) {
    const R = g.rts;
    const near = g.rtsHeroAllies(e.rtsTeam, e.pos.x, e.pos.z, P.R);
    const blobs = near
      .filter((u) => u.rtsDef === 'a_blob' && !u.rtsIllus && !u.rtsTemp && !u.rtsFusing)
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z),
      );
    if (!blobs.length && !near.some((u) => u.rtsDef === 'a_blob')) {
      if (e.rtsTeam === 0) g.rtsSay('附近沒有實驗體');
      return false;
    }
    const made = [];
    const n = Math.floor(blobs.length / 3);
    for (let i = 0; i < n; i++) {
      const grp = blobs.slice(i * 3, i * 3 + 3);
      for (const b of grp) g.fx.beam(b.center(), e.center(), 0xa0ff80, 0.1);
      const c = g.rtsFuseMake && g.rtsFuseMake(e.rtsTeam, 'fu_chimera', grp, { free: true });
      if (c) made.push(c);
    }
    for (const u of near) if (!u.dead && u.rtsDef === 'a_blob') u.hp = u.maxHp; // 剩下的回滿血
    for (const u of [...g.rtsHeroAllies(e.rtsTeam, e.pos.x, e.pos.z, P.R), ...made])
      if (!u.dead && (RTS_DEFS[u.rtsDef] || {}).bio)
        g.rtsBuff(u, { src: 'sk_massfuse', taken: P.taken }, P.t);
    g.fx.shockwave(e.center(), P.R, 0xa0ff80);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), P.R, 0xa0ff80);
    e.hs.massN = made.length; // 測試與 HUD 用
    void R;
  },
  // ===== VEIL =====
  sk_mirror(e, g, P) {
    if (!g.rtsIllusion) return false;
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      const a = (e.yaw || 0) + Math.PI / 2 + (i / P.n) * Math.PI * 2;
      const u = g.rtsIllusion(e, e.pos.x + Math.cos(a) * 3, e.pos.z + Math.sin(a) * 3, {
        sec: P.t,
        dmg: P.dmg,
        taken: P.taken,
      });
      if (u) {
        n++;
        if (e.orders.length) u.orders = e.orders.map((o) => ({ ...o }));
      }
    }
    g.fx.flash(e.center(), 2.6, 0xcfe8ff, 0.25);
    return n > 0;
  },
  sk_emp(e, g, P, p) {
    const R = g.rts;
    const q = P3(g, p.x, p.z, 0.6);
    g.fx.shockwave(q, P.R, 0x80c0ff);
    g.fx.ring(P3(g, p.x, p.z, 0.3), P.R, 0x80c0ff);
    g.fx.flash(q, P.R * 0.6, 0xcfe8ff, 0.2);
    g.fx.beam(e.center(), q, 0x80c0ff, 0.08);
    const foes = g.rtsHeroFoes(e.rtsTeam, p.x, p.z, P.R);
    g.rtsHeroSplash(e, p.x, p.z, P.R, P.dmg, 'en', 400, e.rtsTeam);
    for (const t of foes) {
      if (t.dead) continue;
      if (t.bld)
        t.bld.empT = Math.max(t.bld.empT || 0, R.t + P.bld); // 生產與研究暫停（A 的 rtsBuildings 判斷）
      else g.rtsStun(t, P.stun);
      if (g.rtsFxOk(t.pos)) g.fx.spark(t.center(), 0x80c0ff);
    }
  },
  // 虛像軍團：20 m 內每台己方一般單位旁邊一個幻象
  sk_legion(e, g, P) {
    if (!g.rtsIllusion) return false;
    const list = g
      .rtsHeroAllies(e.rtsTeam, e.pos.x, e.pos.z, P.R)
      .filter(
        (u) => !u.hero && !u.rtsIllus && !u.rtsTemp && !(RTS_DEFS[u.rtsDef] || {}).worker && !u.rtsFusing,
      )
      .sort(
        (a, b) =>
          Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z),
      )
      .slice(0, P.max);
    if (!list.length) {
      if (e.rtsTeam === 0) g.rtsSay('附近沒有己方的單位');
      return false;
    }
    let n = 0;
    for (const u of list) {
      const a = Math.random() * Math.PI * 2;
      const c = g.rtsIllusion(u, u.pos.x + Math.cos(a) * 2.5, u.pos.z + Math.sin(a) * 2.5, {
        sec: P.t,
        dmg: P.dmg,
        taken: P.taken,
      });
      if (c) {
        n++;
        if (u.orders.length) c.orders = u.orders.map((o) => ({ ...o }));
      }
    }
    g.fx.shockwave(e.center(), P.R, 0xcfe8ff);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), P.R, 0xcfe8ff);
    e.hs.legionN = n;
    return n > 0;
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
  // ===== COURIER（維爾威，docs 15.4） =====
  // 急件突進：衝到 25 m 內的地點（0.4 秒）；途中碰到建築、障礙物、陡坡就停在前面
  sk_blitz(e, g, P, p) {
    const w = g.world,
      S = RTS_SKILLS.sk_blitz;
    let dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    let L = Math.hypot(dx, dz);
    if (L < 1) {
      const f = e.rtsHeroFwd();
      ((dx = f.x), (dz = f.z), (L = S.range));
      dx *= L;
      dz *= L;
    }
    const ux = dx / L,
      uz = dz / L;
    const len = Math.min(L, S.range);
    const r = e.radius || 1.5;
    let x = e.pos.x,
      z = e.pos.z,
      h = w.terrainHeight(x, z);
    for (let s = 0.5; s <= len + 1e-6; s += 0.5) {
      const nx = e.pos.x + ux * s,
        nz = e.pos.z + uz * s;
      const nh = w.terrainHeight(nx, nz);
      if (nh - h > 2.5) break; // 斷崖往上
      const [cx, cz] = w.collide(nx, nz, w.groundAt(nx, nz, nh + 2) + 0.5, r);
      if (Math.hypot(cx - nx, cz - nz) > 0.05) break; // 建築、障礙物
      ((x = nx), (z = nz), (h = nh));
    }
    const nav = w.nav;
    if (nav) {
      const c = nav.nearestCell(x, z, e.rtNavSize || 1, -1, 4);
      if (c >= 0) {
        const q = nav.center(c);
        if (Math.hypot(q.x - x, q.z - z) < 4) ((x = q.x), (z = q.z));
      }
    }
    if (Math.hypot(x - e.pos.x, z - e.pos.z) < 1) {
      if (e.rtsTeam === 0) g.rtsSay('前方被擋住了');
      return false;
    }
    e.hs.blitz = { x0: e.pos.x, z0: e.pos.z, x1: x, z1: z, dx: ux, dz: uz, t: 0, T: P.t, P, hit: new Set() };
    e.yaw = e.aimYaw = Math.atan2(-ux, -uz);
    e.mesh.rotation.y = e.yaw;
    e.orders.length = 0;
    if (g.rtsFxOk(e.pos)) g.fx.flash(e.center(), 2.2, 0x9be070, 0.15);
  },
  // 補給投放：1.5 秒後補給箱落地，8 m 內的己方單位 5 秒共回復 heal
  sk_drop(e, g, P, p) {
    const team = e.rtsTeam;
    g.fx.warnCircle(P3(g, p.x, p.z, 0.1), P.R, P.delay, 0x9be070);
    g.later(P.delay, () => {
      if (!g.rts) return;
      const q = P3(g, p.x, p.z, 0.8);
      if (g.rtsFxOk(q)) {
        g.fx.beam(q.clone().setY(q.y + 30), q, 0x9be070, 0.18);
        g.fx.explosion(q, 1.6, 0x9be070);
        g.fx.ring(P3(g, p.x, p.z, 0.25), P.R, 0x9be070);
      }
      for (const u of g.rtsHeroAllies(team, p.x, p.z, P.R)) {
        if (u.rtsAboard) continue;
        g.rtsBuff(u, { src: 'sk_drop', regen: P.heal / P.t }, P.t);
      }
    });
  },
  // 特快專送：運輸機的駕駛在 Game.rtsHeroExpressTick（rts-hero.js）
  sk_express(e, g, P, p) {
    if (!g.rtsBoard) return false;
    if (g.rtsFogState && g.rtsFogState(e.rtsTeam, p.x, p.z) < 1) {
      if (e.rtsTeam === 0) g.rtsSay('要送到探索過的地方');
      return false;
    }
    return g.rtsHeroExpress(e, P, p.x, p.z);
  },
  // ===== SKYHOOK =====
  // 強襲空投艙：預警後落地，範圍爆發＋暈眩，原地留下臨時投放信標
  sk_pod(e, g, P, p) {
    const team = e.rtsTeam;
    // 外觀：一般投放艙的落下與預警圈（B 包的 rtsVeerPodFx：迷霧裡看不到的不畫；R6 D 包）
    const pod = e.rtsHeroPod(g, p.x, p.z, P.warn, P.R);
    if (!pod) g.fx.warnCircle(P3(g, p.x, p.z, 0.1), P.R, P.warn, 0x9be070);
    g.later(P.warn, () => {
      if (!g.rts) return;
      if (pod) g.rtsVeerPodFx(pod, 'land');
      const q = P3(g, p.x, p.z, 0.6);
      if (g.rtsFxOk(q) && (!pod || g.rtsVeerSeen(team, p.x, p.z))) {
        if (!pod) g.fx.beam(q.clone().setY(q.y + 40), q, 0xd8ffb0, 0.35);
        g.fx.explosion(q, P.R * 0.8, 0xffb060);
        g.fx.dust(P3(g, p.x, p.z), P.R, 12);
        g.fx.shockwave(q, P.R, 0x9be070);
      }
      // 範圍內（外形算進去）的敵人一律全額；空中單位不受影響（低空的算）
      for (const t of g.rtsHeroFoes(team, p.x, p.z, P.R)) {
        if (t.flying && !(g.rtsLowAir && g.rtsLowAir(t))) continue;
        g.rtsHeroDmg(e, t, P.dmg, 'exp', 600);
        if (!t.bld) g.rtsStun(t, P.stun);
      }
      if (g.rtsBeaconAddTemp) g.rtsBeaconAddTemp(team, p.x, p.z, P.bcn);
    });
  },
  // 緊急增援：2 秒後身邊落下空降 MT（臨時單位）
  sk_reinforce(e, g, P) {
    // 落點同 rtsHeroTemp 的排法；外觀＝一般投放艙（rtsVeerPodFx，R6 D 包）
    const pods = [];
    for (let i = 0; i < P.n; i++) {
      const a = (e.yaw || 0) + (i / Math.max(1, P.n)) * Math.PI * 2 + 0.5;
      const x = e.pos.x + Math.cos(a) * 3.2,
        z = e.pos.z + Math.sin(a) * 3.2;
      const pod = e.rtsHeroPod(g, x, z, P.delay, 1.6);
      if (pod) pods.push(pod);
      else g.fx.warnCircle(P3(g, x, z, 0.1), 1.6, P.delay, 0x9be070);
    }
    g.later(P.delay, () => {
      if (!g.rts) return;
      for (const pod of pods) g.rtsVeerPodFx(pod, 'land');
      const list = g.rtsHeroTemp(e, 'v_mt', P.n, P.t);
      for (const u of list)
        if (g.rtsFxOk(u.pos) && (!pods.length || g.rtsVeerSeen(e.rtsTeam, u.pos.x, u.pos.z))) {
          if (!pods.length) g.fx.beam(u.center().setY(u.pos.y + 30), u.center(), 0xd8ffb0, 0.25);
          g.fx.dust(u.pos.clone(), 2.5, 8);
        }
      e.hs.reinN = list.length; // 測試與 HUD 用
    });
  },
  // 地毯轟炸：朝 p 的方向 60 m，預警後轟炸機（特效）沿線每 5 m 投一枚（地面的範圍傷害：空中單位不受影響）
  sk_carpet(e, g, P, p) {
    let dx = p.x - e.pos.x,
      dz = p.z - e.pos.z;
    let L = Math.hypot(dx, dz);
    if (L < 0.5) {
      const f = e.rtsHeroFwd();
      ((dx = f.x), (dz = f.z), (L = 1));
    }
    dx /= L;
    dz /= L;
    const team = e.rtsTeam;
    const x0 = e.pos.x + dx * 4,
      z0 = e.pos.z + dz * 4;
    const x1 = x0 + dx * P.len,
      z1 = z0 + dz * P.len;
    g.fx.warnLine(P3(g, x0, z0, 0.3), P3(g, x1, z1, 0.3), P.warn + 1, 0xff3020, 0.3);
    if (g.rtsFogReveal) g.rtsFogReveal(team, (x0 + x1) / 2, (z0 + z1) / 2, P.len / 2 + 4, P.warn + 3);
    const gap = 0.12; // 投彈的間隔（秒）
    const sp = P.len / P.n / gap; // 轟炸機的速度
    // 轟炸機：從線的起點前 40 m 進場，投完再飛 40 m
    if (g.rtsFxOk({ x: (x0 + x1) / 2, z: (z0 + z1) / 2 })) {
      const T0 = P.warn - 40 / sp,
        dur = (P.len + 80) / sp;
      const alt = gy(g, (x0 + x1) / 2, (z0 + z1) / 2) + 26;
      g.later(Math.max(0, T0), () => {
        if (!g.rts) return;
        const bm = buildBomberMesh();
        bm.scale.setScalar(0.8);
        g.fx.add(bm, dur, (q, t) => {
          const d = -40 + (P.len + 80) * t;
          bm.position.set(x0 + dx * d, alt, z0 + dz * d);
          bm.rotation.y = Math.atan2(dx, dz) + Math.PI; // 機頭（−Z）朝飛行方向
        });
      });
    }
    for (let i = 0; i < P.n; i++)
      g.later(P.warn + i * gap, () => {
        if (!g.rts) return;
        const d = (i + 0.5) * (P.len / P.n);
        const x = x0 + dx * d,
          z = z0 + dz * d;
        const q = P3(g, x, z, 0.6);
        if (g.rtsFxOk(q)) {
          g.fx.explosion(q, P.R * 0.7, 0xff9040);
          g.fx.dust(P3(g, x, z), P.R * 0.6, 6);
        }
        g.rtsHeroSplash(e, x, z, P.R, P.dmg, 'exp', 300, team);
      });
  },
  // ===== VECTOR =====
  // 空爆彈幕：0.5 秒後空爆，空中與低空單位 100%、地面單位 gK
  sk_flak(e, g, P, p) {
    const team = e.rtsTeam;
    g.fx.warnCircle(P3(g, p.x, p.z, 0.1), P.R, P.delay, 0xffd060);
    if (g.rtsFxOk(e.pos)) g.fx.beam(e.center(), P3(g, p.x, p.z, 8), 0xffd060, 0.06);
    g.later(P.delay, () => {
      if (!g.rts) return;
      const q = P3(g, p.x, p.z, 8);
      if (g.rtsFxOk(q)) {
        g.fx.flash(q, P.R * 0.8, 0xffe0a0, 0.15);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          const o = V(Math.cos(a) * P.R * 0.5, (i % 3) - 1, Math.sin(a) * P.R * 0.5);
          g.fx.explosion(q.clone().add(o), 1.6, 0xffc060);
        }
        g.fx.streaks(q, 14, 0xffe0a0, 16, 0.4, 10);
      }
      for (const t of g.rtsHeroFoes(team, p.x, p.z, P.R, true)) {
        const air = t.flying || (g.rtsLowAir && g.rtsLowAir(t));
        g.rtsHeroDmg(e, t, P.dmg * (air ? 1 : P.gK), 'pierce', 200);
      }
    });
  },
  // 干擾吊艙：單位射程 −40%、不能施放技能；建築的生產與研究暫停（同電磁脈衝的 bld.empT）
  sk_jam(e, g, P, t) {
    const R = g.rts;
    if (g.rtsFxOk(t.pos)) {
      g.fx.beam(e.center(), t.center(), 0xc080ff, 0.08);
      g.fx.flash(t.center(), 2.2, 0xc080ff, 0.2);
    }
    if (t.bld) {
      t.bld.empT = Math.max(t.bld.empT || 0, R.t + P.bld);
      return;
    }
    const D = RTS_DEFS[t.rtsDef] || {};
    g.rtsBuff(t, { src: 'sk_jam', range: -(D.range || 0) * (1 - P.rangeK) }, P.t);
    t.rtsJamT = Math.max(t.rtsJamT || 0, R.t + P.t);
    // 單位的技能（B 包的 rtsAbWhy 看 rtsCd）：干擾的期間當成冷卻中；英雄的技能由 Game.rtsSkillWhy 看 rtsJamT
    if (!t.hero) {
      const cd = t.rtsCd || (t.rtsCd = {});
      for (const ab of D.abil || []) cd[ab] = Math.max(cd[ab] || 0, R.t + P.t);
    }
  },
  // 無人機中隊：身邊 8 台偵察無人機（臨時單位），跟著 VECTOR 攻擊它的目標（Game.rtsHeroLeadTick）
  sk_squadron(e, g, P) {
    const list = g.rtsHeroTemp(e, 'v_drone', P.n, P.t);
    if (!list.length) return false;
    for (const u of list) {
      u.rtsLead = e;
      u.orders = [];
    }
    e.hs.squadN = list.length;
    if (g.rtsFxOk(e.pos)) g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 5, 0x9be070);
  },
  // ===== MENDER（聖域，docs 16.4） =====
  // 修復光束：4 秒共回復 heal（建築 bldK），目標離開 brk m 中斷（Game.rtsHeroMends 每 0.5 秒）
  sk_mend(e, g, P, t) {
    if (t.bld && t.bld.progress < 1) return false;
    g.rtsHeroMendAdd(e, t, P);
  },
  // 緊急處置：半徑 R 的己方單位立刻回復最大血量的 heal，解除暈眩、緩速、纏附、釘住
  sk_triage(e, g, P, p) {
    const list = g.rtsHeroAllies(e.rtsTeam, p.x, p.z, P.R).filter((u) => !u.rtsAboard && !u.rtsIllus);
    for (const u of list) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * P.heal);
      u.staggerT = 0;
      if (u.rtsMods) {
        const L = u.rtsMods.buff;
        const keep = L.filter((b) => !(b.speed !== undefined && b.speed < 1 && !SELF_ROOT.has(b.src)));
        if (keep.length !== L.length) {
          u.rtsMods.buff = keep;
          g.rtsModsApply(u);
        }
      }
      if (u.clearStatus) for (const k of ['latch', 'slow', 'net', 'hook']) u.clearStatus(k);
      u.rtsPinT = 0; // 釘住（B 包的 ab_pin 用 rtsBuff speed 0 時上面就清掉了）
      if (g.rtsFxOk(u.pos)) g.fx.flash(u.center(), 1.6, 0x80ffb0, 0.2);
    }
    const q = P3(g, p.x, p.z, 0.3);
    if (g.rtsFxOk(q)) {
      g.fx.ring(q, P.R, 0x80ffb0);
      g.fx.beam(e.center(), q, 0x80ffb0, 0.08);
    }
    e.hs.triageN = list.length;
  },
  // 重新站起來：R m 內 t 秒內陣亡的己方一般單位（殘骸紀錄 list 的 { team, def, t0 }）在殘骸上重新組起來
  sk_lazarus(e, g, P) {
    const R = g.rts,
      team = e.rtsTeam,
      T = R.teams[team];
    if (!g.rtsWreckAt) return false;
    const cand = [];
    for (const w of g.rtsWreckAt(e.pos.x, e.pos.z, P.R, { map: false, all: true }))
      for (const it of w.list || []) {
        const D = RTS_DEFS[it.def];
        if (it.team !== team || !D || D.kind === 'bld' || D.hero || D.carrier || R.t - it.t0 > P.t) continue;
        cand.push({ w, it, D });
      }
    const used = new Set();
    let n = 0;
    for (const c of cand) {
      if (n >= P.max) break;
      g.rtsRecount();
      if (T.pop + (c.D.pop || 0) > T.cap) continue; // 人口不夠的不起來
      const a = Math.random() * Math.PI * 2;
      let x = c.w.x + Math.cos(a) * 0.8,
        z = c.w.z + Math.sin(a) * 0.8;
      const nav = g.world.nav;
      if (nav) {
        const k = nav.nearestCell(x, z, c.D.size || 0, -1, 8);
        if (k >= 0) ({ x, z } = nav.center(k));
      }
      const u = g.rtsSpawn(team, c.it.def, x, z, e.yaw);
      if (!u) continue;
      R.stats[team].made--;
      R.stats[team].revived = (R.stats[team].revived || 0) + 1;
      u.hp = u.maxHp * P.hp;
      used.add(c.w);
      n++;
      if (g.rtsFxOk(u.pos)) {
        g.fx.beam(e.center(), u.center(), 0x80ffb0, 0.1);
        g.fx.flash(u.center(), 2, 0x80ffb0, 0.3);
        g.fx.dust(u.pos.clone(), 2, 8, 0x8a7a60);
      }
    }
    g.rtsRecount();
    if (!n) {
      if (team === 0) g.rtsSay(cand.length ? '人口不足' : '附近沒有可以重新站起來的殘骸');
      return false;
    }
    for (const w of used) g.rtsWreckRemove(w);
    g.fx.shockwave(e.center(), P.R, 0x80ffb0);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), P.R, 0x80ffb0);
    e.hs.reviveN = n;
  },
  // ===== SALVOR =====
  // 磁吸：把敵方地面單位拉到身邊 d m＋暈眩
  sk_magnet(e, g, P, t) {
    if (t.bld || t.flying) return false;
    const dx = t.pos.x - e.pos.x,
      dz = t.pos.z - e.pos.z;
    const L = Math.hypot(dx, dz) || 1;
    const d = Math.min(L, P.d);
    if (g.rtsFxOk(t.pos) || g.rtsFxOk(e.pos)) {
      g.fx.beam(e.center(), t.center(), 0xc8a060, 0.14);
      g.fx.spark(t.center(), 0xffd090);
    }
    if (!t.noPush) g.rtsHeroShift(t, e.pos.x + (dx / L) * d, e.pos.z + (dz / L) * d);
    g.rtsStun(t, P.stun);
    if (g.rtsFxOk(t.pos)) g.fx.dust(t.pos.clone(), 1.8, 6, 0x8a7a60);
  },
  // 廢鐵外殼：吸 R m 內的殘骸 n 個（每個最多 take 礦石），每個 shield 吸收＋隊伍 parts 零件
  sk_scrapmail(e, g, P) {
    const list = g.rtsWreckAt ? g.rtsWreckAt(e.pos.x, e.pos.z, P.R, { team: e.rtsTeam }).slice(0, P.n) : [];
    if (!list.length) {
      if (e.rtsTeam === 0) g.rtsSay('附近沒有殘骸');
      return false;
    }
    let n = 0;
    for (const w of list) {
      const c = g.rtsWreckTake(w, P.take);
      if (!(c.ore > 0)) continue;
      n++;
      if (g.rtsFxOk(e.pos)) g.fx.beam(P3(g, w.x, w.z, 0.5), e.center(), 0xc8a060, 0.1);
    }
    if (!n) return false;
    g.rtsShieldAdd(e, n * P.shield, P.t);
    if (g.rtsPartsAdd) g.rtsPartsAdd(e.rtsTeam, n * P.parts);
    if (g.rtsFxOk(e.pos)) g.fx.ring(e.pos.clone().setY(e.pos.y + 0.4), (e.radius || 1.5) + 1.2, 0xc8a060);
    e.hs.mailN = n;
  },
  // 臨時巨像：用掉 R m 內的殘骸（min～max 個）拼出一台拼裝巨像（臨時單位），每個殘骸最大血量 +per
  sk_golem(e, g, P) {
    const list = g.rtsWreckAt
      ? g.rtsWreckAt(e.pos.x, e.pos.z, P.R, { team: e.rtsTeam, map: false }).slice(0, P.max)
      : [];
    if (list.length < P.min) {
      if (e.rtsTeam === 0) g.rtsSay(`附近的殘骸不夠（要 ${P.min} 個）`);
      return false;
    }
    const u = g.rtsHeroTemp(e, 's_colossus', 1, P.t)[0];
    if (!u) return false;
    const k = 1 + Math.min(1, list.length * P.per);
    g.rtsBuff(u, { src: 'sk_golem', hpK: k }, P.t + 5);
    u.hp = u.maxHp;
    for (const w of list) {
      if (g.rtsFxOk(u.pos)) g.fx.beam(P3(g, w.x, w.z, 0.5), u.center(), 0xc8a060, 0.14);
      g.rtsWreckRemove(w);
    }
    if (g.rtsFxOk(u.pos)) {
      g.fx.dust(u.pos.clone(), 4, 14, 0x8a7a60);
      g.fx.shockwave(u.center(), 5, 0xc8a060);
    }
    e.hs.golemN = list.length;
  },
  // ===== HAVEN =====
  // 布雷區：半徑 R 立刻布下 n 顆地雷（A 的 rtsLandMineAdd，noCap、life 秒）
  sk_minefield(e, g, P, p) {
    if (!g.rtsLandMineAdd) return false;
    const w = g.world,
      lim = w.lim !== undefined ? w.lim : w.size / 2;
    let n = 0;
    for (let i = 0; i < P.n; i++) {
      const a = i * 2.39996 + 0.3,
        r = P.R * 0.8 * Math.sqrt((i + 0.5) / P.n);
      const x = Math.max(-lim, Math.min(lim, p.x + Math.cos(a) * r)),
        z = Math.max(-lim, Math.min(lim, p.z + Math.sin(a) * r));
      if (g.rtsLandMineAdd(e.rtsTeam, x, z, { owner: e, noCap: true, life: P.life, dmg: P.dmg })) n++;
      if (g.rtsFxOk(e.pos) && i < 4) g.fx.beam(e.center(), P3(g, x, z, 0.3), 0xf0d8a0, 0.05);
    }
    if (g.rtsFxOk(e.pos)) g.fx.ring(P3(g, p.x, p.z, 0.25), P.R, 0xf0d8a0);
    e.hs.mineN = n;
    return n > 0;
  },
  // 避難護盾：目標身上半徑 R 的圓頂 t 秒，吸收外面打進來的傷害（上限 cap，研究圓頂強化 ×res）
  sk_haven(e, g, P, t) {
    if (t.bld) return false;
    const res = g.rtsResLv && g.rtsResLv(e.rtsTeam, 'r_canopy') ? P.res : 1;
    g.rtsHeroDomeAdd(t, e.rtsTeam, P.R, P.cap * res, P.t);
    if (g.rtsFxOk(t.pos)) g.fx.beam(e.center(), t.center(), 0xf0d8a0, 0.08);
  },
  // 最後的避難所：t 秒的大圓頂（HAVEN 不能移動）：己方單位與建築受到的傷害 ×taken、敵方單位速度 ×speed
  sk_refuge(e, g, P) {
    const R = g.rts;
    e.hs.root = R.t + P.t;
    e.orders.length = 0;
    g.rtsBuff(e, { src: 'sk_refuge', speed: 0 }, P.t);
    e.hs.refuge = g.rtsHeroZone({
      x: e.pos.x,
      z: e.pos.z,
      r: P.R,
      t: P.t,
      src: e,
      team: e.rtsTeam,
      ally: { taken: P.taken },
      bld: true,
      foe: { speed: P.speed },
      fx: null,
    });
    g.rtsHeroDomeFx({ host: e, r: P.R, until: R.t + P.t, gone: false }, P.t, 0xffe0a0);
    g.fx.shockwave(e.center(), P.R, 0xffe0a0);
    g.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), P.R, 0xffe0a0);
  },
};
