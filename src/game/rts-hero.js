// Coral 戰爭（RTS）的英雄與道具（mixin；docs/rts-design.md 13.4、13.5、13.14；C 包）。
// - 英雄紀錄 T.heroes[i]＝{ def, lv, xp, pts, sk: [4], cd: [4]（可以再放的局內時間）, auto: [4], inv: [6]（{ id, ch, cd }｜null）,
//   ent, st 'alive'｜'dead', deadT, src 'hq'｜'tavern', stack（RUST 的成長層數） }；實體 e.hero＝紀錄。
// - 核心（rts.js）呼叫的掛勾：rtsHeroInit／rtsHeroTick／rtsHeroClear、rtsHeroSpawned(e, q)、rtsXpOnKill(e, from)、
//   rtsHeroDied(e)、rtsHeroWhy／rtsHeroCost／rtsHeroReviveCost。
// - 給 E（HUD、輸入、親自駕駛）、D（中立）、F（電腦）的 API 見 docs 13.14（艾瑟立克 14.13、維爾威 15.13）。
// - 維爾威（R4）：特快專送的運輸機（rtsHeroExpress／rtsHeroExpressTick，用 A 包 rts-veer.js 的 rtsBoard／rtsDisembark）、
//   無人機中隊的跟隨（rtsHeroLeadTick）、專屬道具（熱焰彈、推進背包、攜帶式信標、運費帳簿）、物流倉庫收起時不能買。
// - 技能的施放與實體端的狀態（衝刺、跳躍、潛地、引導）在 entities/mech-rts-hero.js；這裡是持續的效果：
//   光環、地面區域（煙幕、腐蝕、吸引、緩速）、持續傷害、標定的揭露、臨時牆的導航佔用、道具、商店、酒館。
// - 傷害一律經過核心的 rtsHit／rtsSplash（rtsHeroDmg／rtsHeroSplash 先乘施放者的 dmgMul）；數值用 rtsBuff 與數值層。
import { Game } from './game.js';
import { RTS_DEFS, RTS_HERO_COST, RTS_HERO_MAX, RTS_NEUTRAL } from '../data/rts-units.js';
import {
  RTS_FACTION_HEROES,
  RTS_HERO_DEFS,
  RTS_HERO_LV_MAX,
  RTS_HERO_LVUP_HEAL,
  RTS_HERO_XP,
  RTS_HIRE,
  RTS_INV,
  RTS_REVIVE,
  RTS_SKILLS,
  RTS_TAVERN,
  RTS_XP_CREEP_K,
  RTS_XP_HERO,
  RTS_XP_PILOT,
  RTS_XP_R,
  RTS_XP_UNIT,
  skillLv,
  skillLvReq,
  skillMax,
} from '../data/rts-heroes.js';
import {
  RTS_FAC_SHOP,
  RTS_ITEMS,
  RTS_SHOP,
  RTS_SHOP_CARD,
  RTS_SHOP_ITEMS,
  shopCard,
} from '../data/rts-items.js';
import { buildItemCrate } from '../render/rts-neutral-models.js';

const ME = 0;
const TICK = 0.5; // 光環、區域、持續效果的間隔
const PICK_R = 2; // 走到幾公尺內自動撿道具
const PASS_R = 6; // 交給別的英雄的距離
const WRECK_T = 30; // 殘骸（RUST 的拾荒）保留秒數
const MUL = ['dmg', 'rof', 'speed', 'taken', 'imp', 'hpK', 'splash', 'skill'];
const _v = new THREE.Vector3();

// 補給商店的貨架卡片（rts-units.js 的 c_market 留空給 C／E）
if (RTS_DEFS.c_market && !(RTS_DEFS.c_market.card || []).length) RTS_DEFS.c_market.card = RTS_SHOP_CARD;
if (RTS_DEFS.c_market) RTS_DEFS.c_market.shopItems = RTS_FAC_SHOP.castron;
// 陣營商店（shopFac，例如艾瑟立克的樣本保管庫 a_vault、維爾威的物流倉庫 v_market）：貨架 shopItems 與卡片（12 格依序、
// 2／3 階帶層級需求）
for (const id in RTS_DEFS) {
  const D = RTS_DEFS[id];
  if (!D || D.kind !== 'bld' || !D.shop || !D.shopFac || !RTS_FAC_SHOP[D.shopFac]) continue;
  D.shopItems = RTS_FAC_SHOP[D.shopFac];
  if (!(D.card || []).length) D.card = shopCard(D.shopItems, true);
}

// 合併數值層的部分欄位（倍率相乘、其他相加）
function addMods(o, m) {
  if (!m) return o;
  for (const k in m) {
    if (k === 'r') continue;
    if (MUL.includes(k)) o[k] = (o[k] === undefined ? 1 : o[k]) * m[k];
    else o[k] = (o[k] || 0) + m[k];
  }
  return o;
}
const sameMods = (a, b) => {
  const ka = Object.keys(a || {}),
    kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (Math.abs((a[k] || 0) - ((b || {})[k] || 0)) > 1e-6) return false;
  return true;
};
// 光環的數值層（記下名字只有回血、守住家園只有護甲；其他照技能的參數）
const HOLD_NEAR = RTS_SKILLS.sk_hold.lv[0].near; // 守住家園：己方建築幾公尺內的單位
const auraMods = (id, P) =>
  id === 'sk_names' ? { regen: P.regen } : id === 'sk_hold' ? { armor: P.armor } : P;
const isTavernBld = (e) => e && e.bld && (e.rtsDef === 'n_tavern' || (RTS_DEFS[e.rtsDef] || {}).tavernBld);
const isShopBld = (e) =>
  e && e.bld && !e.dead && (e.rtsDef === 'n_shop' || !!(RTS_DEFS[e.rtsDef] || {}).shop);

Object.assign(Game.prototype, {
  // ================= 開局、每格、清理 =================
  rtsHeroInit() {
    const R = this.rts;
    if (!R) return;
    R.items = R.items || [];
    R.itemSeq = 0;
    R.tavernBy = {}; // 酒館英雄 → 雇用的隊伍
    R.hfx = {
      zones: [],
      dots: [],
      marks: [],
      walls: [],
      wrecks: [],
      temps: [],
      nl: new Set(),
      shields: new Set(), // 稜鏡屏障（e.rtsShield）的實體
      summit: {},
      express: [], // 特快專送（COURIER）的運輸機
      mends: [], // 修復光束（MENDER）：{ src, t, per, n, brk }
      domes: [], // 避難護盾（HAVEN）：{ id, host, team, r, n, n0, until, gone }
      tick: 0,
      pick: 0,
      zoneSeq: 0,
    };
    for (const T of R.teams) if (!T.heroes) T.heroes = [];
    // 命中的掛勾：之後生成的實體在 rtsHook 之後再包一層（英雄的被動、障壁、道具中斷）；開局已經有的也包
    const base = Game.prototype.rtsHook;
    this.rtsHook = function (e) {
      base.call(this, e);
      this.rtsHeroWrap(e);
    };
    for (const e of R.units) this.rtsHeroWrap(e);
  },
  rtsHeroClear() {
    const R = this.rts;
    delete this.rtsHook;
    if (!R) return;
    for (const it of R.items || []) if (it.mesh && it.mesh.parent) it.mesh.parent.remove(it.mesh);
    R.items = [];
    if (R.hfx) for (const e of R.hfx.nl) e.noLock = false;
    R.hfx = null;
  },
  rtsHeroTick(dt) {
    const R = this.rts;
    if (!R || !R.hfx) return;
    const F = R.hfx;
    // 每格：英雄的隱形、穩定器、親自駕駛的經驗、臨時傭兵
    for (const T of R.teams)
      for (const h of T.heroes || []) {
        const e = h.ent;
        if (!e || e.dead || h.st !== 'alive') continue;
        const H = e.hs || (e.hs = {});
        // 親自駕駛中（rtsHeroAI 不跑）：突進、跳躍（推進背包）、衝刺照樣推進
        if (e.rtsPiloted) {
          if (H.blitz) e.rtsHeroBlitzStep(dt);
          else if (H.leap) e.rtsHeroLeapStep(dt);
          else if (H.dash) e.rtsHeroDashStep(dt);
        }
        this.rtsHeroPhase(h, e, H);
        const st = H.stealth > R.t || !!H.burrow;
        if (st) {
          e.noLock = true;
          F.nl.add(e);
        }
        const a = H.burrow ? 0 : st ? (e.rtsTeam === (R.me !== undefined ? R.me : ME) ? 0.35 : 0.12) : 1;
        if (a !== (H.alpha === undefined ? 1 : H.alpha)) {
          H.alpha = a;
          if (e.applyCloak) e.applyCloak(a);
          e.mesh.visible = !H.burrow;
        }
        // 修復套件到期（數值層的 buff 每 0.5 秒才清，這裡準時停）
        if (H.kitT && R.t >= H.kitT) {
          H.kitT = 0;
          this.rtsBuffDel(e, 'i_kit');
        }
        // ACS 穩定器：抵消失衡與暈眩（每 20 秒一次）
        if (e.staggerT > 0 && this.rtsHeroHas(h, 'i_stab') && !(h.stabT > R.t)) {
          e.staggerT = 0;
          h.stabT = R.t + RTS_ITEMS.i_stab.stab;
          this.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 3, 0x9fe8ff);
        }
      }
    // 熱焰彈（維爾威的道具）：不能被鎖定
    for (const T of R.teams)
      for (const h of T.heroes || []) {
        const e = h.ent;
        if (e && !e.dead && e.hs && e.hs.flareT > R.t && !e.noLock) {
          e.noLock = true;
          F.nl.add(e);
        }
      }
    // 特快專送的運輸機（每格駕駛）
    if (F.express.length) this.rtsHeroExpressTick(dt);
    // 吸引區（每格拉動）
    for (const z of F.zones) if (z.pull && z.until > R.t) this.rtsHeroPull(z, dt);
    // 臨時傭兵到期
    for (let i = F.temps.length - 1; i >= 0; i--) {
      const q = F.temps[i];
      if (q.e.dead) F.temps.splice(i, 1);
      else if (R.t >= q.until) {
        q.e.rtsQuiet = true;
        q.e.die(null);
        F.temps.splice(i, 1);
      }
    }
    // 自動撿道具（0.25 秒一次）
    F.pick -= dt;
    if (F.pick <= 0) {
      F.pick = 0.25;
      this.rtsItemAutoPick();
    }
    F.tick -= dt;
    if (F.tick > 0) return;
    F.tick = TICK;
    this.rtsHeroAuras();
    this.rtsHeroZones();
    this.rtsHeroDots();
    this.rtsHeroMarks();
    this.rtsHeroWalls();
    this.rtsHeroSummit();
    this.rtsHeroNoLock();
    this.rtsHeroPassiveTick();
    this.rtsHeroShields();
    this.rtsHeroLeadTick();
    this.rtsHeroMends();
    this.rtsHeroDomes();
  },
  // VEIL 的相位迷彩（被動）：idle 秒沒有開火（打中敵人）、沒有施放技能就隱形；開火或施放現形（hs.actT＝最後一次）
  rtsHeroPhase(h, e, H) {
    const D = RTS_HERO_DEFS[h.def];
    const i = D ? D.skills.indexOf('sk_phase') : -1;
    if (i < 0 || !h.sk[i]) return;
    const R = this.rts;
    if (H.actT === undefined) H.actT = R.t;
    const P = skillLv('sk_phase', h.sk[i]);
    if (R.t - H.actT >= P.idle && !(H.stealth > R.t + 0.2)) {
      if (!(H.stealth > R.t) && this.rtsFxOk(e.pos)) this.fx.flash(e.center(), 2, 0xcfe8ff, 0.2);
      H.stealth = R.t + 0.3; // 每格延長，開火或施放時歸零
      H.phase = true;
    }
  },
  // 稜鏡屏障：到期或吸收完就消失；有的每 0.5 秒閃一下
  rtsHeroShields() {
    const R = this.rts,
      F = R.hfx;
    for (const e of [...F.shields]) {
      const S = e.rtsShield;
      if (e.dead || !S || S.t <= R.t || S.n <= 0) {
        if (!e.dead && S) e.rtsShield = null;
        F.shields.delete(e);
        continue;
      }
      if (this.rtsFxOk(e.pos))
        this.fx.ring(e.pos.clone().setY(e.pos.y + 0.4), (e.radius || 1.2) + 1, 0x8fe8ff);
    }
  },
  // 稜鏡屏障（PRISM；所有實體都可以有）：n＝還能吸收的傷害、sec 秒
  rtsShieldAdd(e, n, sec) {
    if (!e || e.dead || !this.rts || !this.rts.hfx) return;
    e.rtsShield = { n, t: this.rts.t + sec };
    this.rts.hfx.shields.add(e);
    if (this.rtsFxOk(e.pos)) this.fx.flash(e.center(), 2.6, 0x8fe8ff, 0.3);
  },

  // ================= 聖域（docs 16.4）：修復光束、避難護盾、陣亡的回饋、殘骸價值 =================
  // 修復光束（MENDER）：每 0.5 秒回復一次，目標離開 brk m 或任一方陣亡就中斷
  rtsHeroMendAdd(src, t, P) {
    const F = this.rts.hfx;
    F.mends = F.mends.filter((m) => m.t !== t || m.src !== src);
    const n = Math.max(1, Math.round(P.t / TICK));
    const per = (P.heal * (t.bld ? P.bldK : 1)) / n;
    F.mends.push({ src, t, per, n, brk: P.brk });
    if (this.rtsFxOk(t.pos)) {
      this.fx.beam(src.center(), t.center(), 0x80ffb0, 0.12);
      this.fx.flash(t.center(), 2, 0x80ffb0, 0.2);
    }
  },
  rtsHeroMends() {
    const F = this.rts.hfx;
    for (let i = F.mends.length - 1; i >= 0; i--) {
      const m = F.mends[i];
      const d = m.t && m.src ? m.src.rtsDistTo(m.t) : 1e9;
      if (!m.src || m.src.dead || !m.t || m.t.dead || m.n <= 0 || d > m.brk) {
        if (m.n > 0 && m.src && !m.src.dead && m.src.rtsTeam === ME && d > m.brk)
          this.rtsSay('修復光束中斷了');
        F.mends.splice(i, 1);
        continue;
      }
      m.n--;
      m.t.hp = Math.min(m.t.maxHp, m.t.hp + m.per);
      m.healed = (m.healed || 0) + m.per;
      if (this.rtsFxOk(m.t.pos)) this.fx.beam(m.src.center(), m.t.center(), 0x80ffb0, 0.07);
    }
  },
  // 避難護盾（HAVEN）：跟著 host 的半徑 r 圓頂，外面打進來的傷害由它吸收（上限 n）
  rtsHeroDomeAdd(host, team, r, n, sec) {
    const R = this.rts,
      F = R.hfx;
    for (const d of F.domes) if (d.host === host) d.gone = true; // 同一個目標取代舊的
    F.domes = F.domes.filter((d) => !d.gone);
    const d = { id: ++F.zoneSeq, host, team, r, n, n0: n, until: R.t + sec, gone: false };
    F.domes.push(d);
    this.rtsHeroDomeFx(d, sec, 0xf0d8a0);
    return d;
  },
  // 圓頂的外觀：半透明的半球，跟著 host；破掉或到期時淡出
  rtsHeroDomeFx(d, sec, color) {
    const geo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 3;
    m.userData.helper = true;
    const g = this;
    let fade = 1;
    this.fx.add(m, sec + 0.6, (q, k, dt) => {
      const h = d.host;
      if (h && !h.dead) m.position.set(h.pos.x, g.world.terrainHeight(h.pos.x, h.pos.z) - 0.3, h.pos.z);
      else if (d.x !== undefined) m.position.set(d.x, g.world.terrainHeight(d.x, d.z) - 0.3, d.z);
      const end = d.gone || !g.rts || g.rts.t >= d.until || (h && h.dead);
      if (end) fade = Math.max(0, fade - (dt || 0.016) * 3);
      m.scale.setScalar(d.r * (0.7 + 0.3 * Math.min(1, k * sec * 4)));
      const hit = d.flashT && g.rts && g.rts.t - d.flashT < 0.15 ? 0.16 : 0;
      mat.opacity = (0.14 + hit + 0.04 * Math.sin(k * sec * 6)) * fade;
      m.visible = fade > 0.01 && !(h && h.fogHid);
    });
  },
  rtsHeroDomes() {
    const R = this.rts,
      F = R.hfx;
    for (let i = F.domes.length - 1; i >= 0; i--) {
      const d = F.domes[i];
      if (d.gone || d.until <= R.t || d.n <= 0 || (d.host && d.host.dead)) {
        d.gone = true;
        F.domes.splice(i, 1);
      }
    }
  },
  // 圓頂吸收：目標在圓頂裡、攻擊者在圓頂外（沒有攻擊者也算外面）；以相剋與護甲之後的實際傷害計算
  rtsHeroDomeAbsorb(e, dmg, from, wid, attr) {
    const R = this.rts;
    for (const d of R.hfx.domes) {
      if (d.gone || d.team !== e.rtsTeam || d.n <= 0 || d.until <= R.t) continue;
      const h = d.host;
      if (!h || h.dead) continue;
      if (Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) > d.r) continue;
      if (from && from.pos && Math.hypot(from.pos.x - h.pos.x, from.pos.z - h.pos.z) <= d.r) continue;
      const k = Math.max(0.05, this.rtsDmgK(e._rtsAtk || this.rtsAtkOf(from, wid, attr), e) || 1);
      const a = Math.min(d.n, dmg * k);
      d.n -= a;
      d.flashT = R.t;
      if (d.n <= 0) {
        d.gone = true;
        if (this.rtsFxOk(h.pos)) this.fx.shockwave(h.center(), d.r, 0xf0d8a0);
      }
      dmg -= a / k;
      if (!(dmg > 1e-6)) return 0;
    }
    return dmg;
  },
  // 己方一般單位陣亡（rtsXpOnKill）：記下名字的礦石、聚落名冊的零件（各取最好的一個，不疊加）；SALVOR 擊破的零件
  rtsHeroSancDeath(dead, from) {
    const R = this.rts;
    const D = RTS_DEFS[dead.rtsDef] || {};
    let ore = 0,
      parts = 0;
    for (const h of this.rtsHeroRecs(dead.rtsTeam)) {
      const e = h.ent;
      if (!e || e.dead || h.st !== 'alive' || e === dead || e.rtsAboard) continue;
      const d = Math.hypot(e.pos.x - dead.pos.x, e.pos.z - dead.pos.z);
      const i = RTS_HERO_DEFS[h.def].skills.indexOf('sk_names');
      const P = i >= 0 && skillLv('sk_names', h.sk[i]);
      if (P && d <= RTS_SKILLS.sk_names.r) ore = Math.max(ore, ((D.cost && D.cost.ore) || 0) * P.ore);
      if (this.rtsHeroHas(h, 'i_logbook') && d <= RTS_ITEMS.i_logbook.r)
        parts = Math.max(parts, RTS_ITEMS.i_logbook.parts);
    }
    const T = R.teams[dead.rtsTeam];
    ore = Math.floor(ore + 1e-9);
    if (ore > 0) {
      this.rtsGrant(dead.rtsTeam, ore, 0);
      T.names = (T.names || 0) + ore; // 統計（測試與 HUD）
    }
    if (parts > 0 && this.rtsPartsAdd) T.logbook = (T.logbook || 0) + this.rtsPartsAdd(dead.rtsTeam, parts);
    // 拾荒本能：SALVOR 擊破敵方單位 +零件
    if (
      from &&
      from.hero &&
      from.rtsTeam !== undefined &&
      from.rtsTeam !== dead.rtsTeam &&
      this.rtsPartsAdd
    ) {
      const P = this.rtsHeroPassive(from, 'sk_scrounge');
      if (P) {
        const n = this.rtsPartsAdd(from.rtsTeam, P.parts);
        const F = R.teams[from.rtsTeam];
        F.scrounge = (F.scrounge || 0) + n;
      }
    }
  },
  // 英雄學了的被動技能的這一級參數（沒有＝null）
  rtsHeroPassive(e, id) {
    const rec = e && e.hero,
      D = rec && RTS_HERO_DEFS[rec.def];
    const i = D ? D.skills.indexOf(id) : -1;
    return (i >= 0 && rec.sk[i] && skillLv(id, rec.sk[i])) || null;
  },
  // A 的掛勾（rtsWreckValue）：殘骸價值的倍率＝拾荒本能（SALVOR 擊破的敵方單位）× 聚落名冊（附近的英雄帶著）
  rtsHeroWreckK(e, from) {
    if (!this.rts || !e || e.bld) return 1;
    let k = 1;
    if (from && from.hero && from.rtsTeam !== e.rtsTeam) {
      const P = this.rtsHeroPassive(from, 'sk_scrounge');
      if (P) k *= 1 + P.k;
    }
    if (!e.hero)
      for (const h of this.rtsHeroRecs(e.rtsTeam)) {
        const q = h.ent;
        if (!q || q.dead || h.st !== 'alive' || q.rtsAboard || !this.rtsHeroHas(h, 'i_logbook')) continue;
        if (Math.hypot(q.pos.x - e.pos.x, q.pos.z - e.pos.z) > RTS_ITEMS.i_logbook.r) continue;
        k *= RTS_ITEMS.i_logbook.wreckK;
        break;
      }
    return k;
  },

  // ================= 紀錄與查詢 =================
  rtsHeroRecs(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return (T && T.heroes) || [];
  },
  rtsHeroRec(teamId, heroId) {
    return this.rtsHeroRecs(teamId).find((h) => h.def === heroId) || null;
  },
  // 這隊活著的英雄實體
  rtsHeroEnts(teamId) {
    return this.rtsHeroRecs(teamId)
      .filter((h) => h.st === 'alive' && h.ent && !h.ent.dead)
      .map((h) => h.ent);
  },
  rtsHeroNewRec(heroId, src = 'hq') {
    return {
      def: heroId,
      lv: 1,
      xp: 0,
      pts: 1,
      sk: [0, 0, 0, 0],
      cd: [0, 0, 0, 0],
      auto: [false, false, false, false],
      inv: new Array(RTS_INV).fill(null),
      ent: null,
      st: 'none',
      deadT: 0,
      src,
      stack: 0,
    };
  },
  // 英雄的狀態（E 的卡片、F 的判斷）：'none' 還沒有、'queued' 生產中、'alive'、'dead'、'reviving' 復活中、
  // 'taken' 酒館英雄被別隊雇走
  rtsHeroState(teamId, heroId) {
    const R = this.rts;
    if (!R) return 'none';
    const rec = this.rtsHeroRec(teamId, heroId);
    const q = this.rtsHeroQueued(teamId, heroId);
    if (rec) {
      if (rec.st === 'alive' && rec.ent && !rec.ent.dead) return 'alive';
      return q ? 'reviving' : 'dead';
    }
    if (q) return 'queued';
    const own = this.rtsHireOwner(heroId);
    if (own >= 0 && own !== teamId) return 'taken';
    return 'none';
  },
  // 生產佇列裡的英雄（revive 依參數）
  rtsHeroQueued(teamId, heroId) {
    for (const e of this.rts.units)
      if (!e.dead && e.bld && e.rtsTeam === teamId)
        for (const q of e.bld.queue) if (q.id === heroId) return q;
    return null;
  },
  rtsHeroCount(teamId) {
    let n = this.rtsHeroRecs(teamId).length;
    for (const e of this.rts.units)
      if (!e.dead && e.bld && e.rtsTeam === teamId)
        for (const q of e.bld.queue)
          if (RTS_DEFS[q.id] && RTS_DEFS[q.id].hero && !q.revive && !this.rtsHeroRec(teamId, q.id)) n++;
    return n;
  },
  // 新取得一位英雄的條件（核心的 rtsReqWhy 會呼叫）：同一位一個、最多 3 位、第 n 位要 Tn；酒館英雄只能在酒館雇用
  rtsHeroWhy(teamId, heroId) {
    const why = this.rtsHeroWhyCore(teamId, heroId);
    if (why) return why;
    const D = RTS_HERO_DEFS[heroId];
    if (D.tavern) return '只能在酒館雇用';
    return '';
  },
  rtsHeroWhyCore(teamId, heroId) {
    const R = this.rts,
      T = R && R.teams[teamId],
      D = RTS_HERO_DEFS[heroId];
    if (!T || !D) return '不是英雄';
    if (!D.tavern && D.faction !== T.faction) return '不是這個陣營的英雄';
    if (this.rtsHeroRec(teamId, heroId) || this.rtsHeroQueued(teamId, heroId)) return '已經有這位英雄';
    if (D.tavern && this.rtsHireOwner(heroId) >= 0 && this.rtsHireOwner(heroId) !== teamId)
      return '已經被其他隊伍雇用';
    const n = this.rtsHeroCount(teamId);
    if (n >= RTS_HERO_MAX) return `英雄最多 ${RTS_HERO_MAX} 位`;
    if (this.rtsTier(teamId) < n + 1) return `需要 ${this.rtsTierName(teamId, n + 1)}（T${n + 1}）`;
    return '';
  },
  // 價格：第 1 位免費（只花人口），之後 425／100
  rtsHeroCost(teamId) {
    return this.rtsHeroCount(teamId) === 0 ? { ore: 0, coral: 0 } : { ...RTS_HERO_COST };
  },
  // 主堡復活：礦石 120＋35×等級、時間 10＋5×等級
  rtsHeroReviveCost(teamId, heroId) {
    const rec = this.rtsHeroRec(teamId, heroId);
    const lv = rec ? rec.lv : 1;
    return {
      cost: { ore: RTS_REVIVE.ore0 + RTS_REVIVE.oreLv * lv, coral: 0 },
      time: RTS_REVIVE.t0 + RTS_REVIVE.tLv * lv,
    };
  },
  // 主堡的英雄卡片（E：act { k: 'hero', id }）：還沒有＝生產、陣亡＝復活
  rtsHeroQueue(hq, heroId) {
    if (!hq || hq.dead) return false;
    const st = this.rtsHeroState(hq.rtsTeam, heroId);
    const me = hq.rtsTeam === ME;
    if (st === 'alive') return (me && this.rtsSay('這位英雄還活著'), false);
    if (st === 'queued' || st === 'reviving') return (me && this.rtsSay('已經在佇列裡'), false);
    return this.rtsQueue(hq, heroId, { revive: st === 'dead' });
  },
  // 英雄卡片的不能用原因（E）
  rtsHeroQueueWhy(teamId, heroId) {
    const st = this.rtsHeroState(teamId, heroId);
    if (st === 'alive') return '已經在場上';
    if (st === 'queued' || st === 'reviving') return '已經在佇列裡';
    if (st === 'dead') {
      const c = this.rtsHeroReviveCost(teamId, heroId).cost;
      return this.rts.teams[teamId].ore < c.ore ? '礦石不足' : '';
    }
    return this.rtsHeroWhy(teamId, heroId);
  },

  // ================= 生產完成、陣亡 =================
  rtsHeroSpawned(e, q = {}) {
    const R = this.rts,
      T = R.teams[e.rtsTeam];
    if (!T) return;
    let rec = this.rtsHeroRec(e.rtsTeam, e.rtsDef);
    if (!rec) {
      rec = this.rtsHeroNewRec(e.rtsDef, q.src || 'hq');
      T.heroes.push(rec);
    } else if (rec.ent && !rec.ent.dead && rec.ent !== e) {
      // 已經在場上（重複的復活）：撤掉這一台
      e.rtsQuiet = true;
      e.die(null);
      return;
    }
    const D = RTS_HERO_DEFS[e.rtsDef];
    if (D && D.tavern) R.tavernBy[e.rtsDef] = e.rtsTeam;
    rec.ent = e;
    rec.st = 'alive';
    e.hero = rec;
    e.hs = {};
    e.rtsCd = e.rtsCd || {};
    for (let i = 0; i < 4; i++) if (D) e.rtsCd[D.skills[i]] = rec.cd[i];
    this.rtsHeroApply(e);
    e.hp = e.maxHp * (q.hpK || 1);
    if (q.revive && this.rtsEvent && e.rtsTeam === ME) this.rtsEvent(e.pos.x, e.pos.z, '英雄復活：' + e.name);
  },
  rtsHeroDied(e) {
    const R = this.rts,
      rec = e.hero;
    if (!rec || !R) return;
    rec.st = 'dead';
    rec.deadT = R.t;
    rec.ent = null;
    if (e.hs) {
      if (e.applyCloak && e.hs.alpha !== undefined && e.hs.alpha !== 1) e.applyCloak(1);
      e.hs = {};
    }
    if (R.hfx) R.hfx.nl.delete(e);
    if (this.rtsEvent && e.rtsTeam === ME) this.rtsEvent(e.pos.x, e.pos.z, '英雄陣亡：' + e.name);
    if (R.pilot && R.pilot.e === e && this.rtsPilotExit) this.rtsPilotExit('dead');
  },
  // 數值層：英雄成長＋被動技能（hero）、永久道具（item）
  rtsHeroApply(e) {
    const rec = e.hero,
      D = RTS_HERO_DEFS[e.rtsDef];
    if (!rec || !D || !e.rtsMods) return;
    const n = rec.lv - 1,
      G = D.grow || {};
    const o = { hp: (G.hp || 0) * n, armor: (G.armor || 0) * n, dmg: (D.dps + (G.dps || 0) * n) / D.dps };
    D.skills.forEach((id, i) => {
      const S = RTS_SKILLS[id];
      const P = skillLv(id, rec.sk[i]);
      if (!P || S.kind !== 'passive') return;
      if (id === 'sk_evade') o.taken = (o.taken || 1) * P.taken;
      if (id === 'sk_eye') o.sight = (o.sight || 0) + P.sight;
      if (id === 'sk_longms') o.range = (o.range || 0) + P.range;
      if (id === 'sk_regen') o.regen = (o.regen || 0) + P.regen;
      if (id === 'sk_slip') o.speed = (o.speed || 1) * P.speed; // 滑流的穿甲減傷在 rtsHeroOnHurt
      if (id === 'sk_salvage') o.dmg *= 1 + P.per * Math.min(rec.stack || 0, P.max);
    });
    e.rtsMods.hero = o;
    const it = {};
    const seen = new Set();
    for (const s of rec.inv) {
      const I = s && RTS_ITEMS[s.id];
      if (!I || I.kind !== 'perm' || !I.mods || seen.has(s.id)) continue;
      seen.add(s.id); // 同名不疊加
      addMods(it, I.mods);
    }
    e.rtsMods.item = it;
    this.rtsModsApply(e);
  },

  // ================= 經驗與等級 =================
  // 擊破：擊破者那一隊、活著、離死亡位置 40 m 內的英雄平分（野怪依各英雄等級的倍率、親自駕駛 +15%）
  rtsXpOnKill(dead, from) {
    const R = this.rts;
    if (!R || !dead) return;
    const F = R.hfx;
    if (F && !dead.bld) {
      F.wrecks.push({ x: dead.pos.x, z: dead.pos.z, t: R.t });
      if (F.wrecks.length > 80) F.wrecks.shift();
    }
    // 聖域：記下名字（MENDER）、聚落名冊（己方一般單位陣亡）、拾荒本能（SALVOR 擊破）
    if (!dead.bld && !dead.hero && !dead.rtsIllus && !dead.rtsTemp) this.rtsHeroSancDeath(dead, from);
    if (!from || from.rtsTeam === undefined || from.rtsTeam === dead.rtsTeam) return;
    // RUST 的回收再利用：擊破時永久傷害 +1%
    if (from.hero && !from.dead) {
      const i = RTS_HERO_DEFS[from.rtsDef] ? RTS_HERO_DEFS[from.rtsDef].skills.indexOf('sk_salvage') : -1;
      const P = i >= 0 && skillLv('sk_salvage', from.hero.sk[i]);
      if (P && (from.hero.stack || 0) < P.max) {
        from.hero.stack = (from.hero.stack || 0) + 1;
        this.rtsHeroApply(from);
      }
    }
    const D = RTS_DEFS[dead.rtsDef] || {};
    // 運費帳簿（維爾威）：英雄擊破單位時隊伍得到它礦石成本的 15%（幻象、臨時單位不算）
    if (from.hero && !dead.bld && !dead.rtsIllus && !dead.rtsTemp && this.rtsHeroHas(from.hero, 'i_ledger')) {
      const n = Math.round(((D.cost && D.cost.ore) || 0) * RTS_ITEMS.i_ledger.ledger);
      if (n > 0) {
        this.rtsGrant(from.rtsTeam, n, 0);
        const T = R.teams[from.rtsTeam];
        T.ledger = (T.ledger || 0) + n; // 統計（測試與 HUD）
      }
    }
    const base = dead.hero
      ? RTS_XP_HERO[dead.hero.lv] || 0
      : dead.bld
        ? 0
        : RTS_XP_UNIT[Math.min(6, D.lv || 0)] || 0;
    if (!base) return;
    const creep = !!D.creep || (dead.creep !== undefined && dead.creep !== null && dead.creep !== false);
    const near = this.rtsHeroRecs(from.rtsTeam).filter(
      (h) =>
        h.st === 'alive' &&
        h.ent &&
        !h.ent.dead &&
        Math.hypot(h.ent.pos.x - dead.pos.x, h.ent.pos.z - dead.pos.z) <= RTS_XP_R,
    );
    if (!near.length) return;
    const each = base / near.length;
    for (const h of near) {
      let k = creep ? RTS_XP_CREEP_K[h.lv] || 0 : 1;
      if (h.ent.rtsPiloted) k *= RTS_XP_PILOT;
      if (k > 0) this.rtsHeroAddXp(h, each * k);
    }
  },
  // 加經驗（升級：技能點、成長、回復 25% 血量、事件）
  rtsHeroAddXp(rec, n) {
    if (!rec || rec.lv >= RTS_HERO_LV_MAX) return 0;
    rec.xp = Math.min(RTS_HERO_XP[RTS_HERO_LV_MAX - 1], rec.xp + n);
    let up = 0;
    while (rec.lv < RTS_HERO_LV_MAX && rec.xp >= RTS_HERO_XP[rec.lv]) {
      rec.lv++;
      rec.pts++;
      up++;
    }
    const e = rec.ent;
    if (up && e && !e.dead) {
      this.rtsHeroApply(e);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * RTS_HERO_LVUP_HEAL * up);
      const p = e.pos.clone();
      p.y += 0.4;
      this.fx.ring(p, 3.2, 0xffe070);
      this.fx.flash(e.center(), 2.4, 0xffe070, 0.25);
      if (this.rtsEvent && e.rtsTeam === ME) this.rtsEvent(e.pos.x, e.pos.z, `${e.name} 升到 ${rec.lv} 級`);
    }
    return up;
  },
  // 經驗條（E）：{ lv, xp, from（這一級的起點）, to（下一級；10 級時 null） }
  rtsHeroXpBar(rec) {
    const lv = rec.lv;
    return { lv, xp: rec.xp, from: RTS_HERO_XP[lv - 1], to: lv >= RTS_HERO_LV_MAX ? null : RTS_HERO_XP[lv] };
  },

  // ================= 技能：學習、資訊、施放 =================
  rtsHeroLearnWhy(e, slot) {
    const rec = e && (e.hero || e);
    const D = rec && RTS_HERO_DEFS[rec.def];
    if (!D || slot < 0 || slot > 3) return '沒有這個技能';
    const n = rec.sk[slot];
    if (n >= skillMax(slot)) return '已經學滿';
    if (rec.pts <= 0) return '沒有技能點';
    const need = skillLvReq(slot, n + 1);
    if (rec.lv < need) return `需要英雄 ${need} 級`;
    return '';
  },
  rtsHeroLearn(e, slot) {
    const rec = e && (e.hero || e);
    if (!rec || this.rtsHeroLearnWhy(rec, slot)) return false;
    rec.sk[slot]++;
    rec.pts--;
    if (rec.ent && !rec.ent.dead) this.rtsHeroApply(rec.ent);
    return true;
  },
  // 技能的資訊（E 的指令卡）：{ id, name, kind, slot, lv, max, coral, cd（剩下的秒）, cdMax, range, desc, passive, auto,
  //   canAuto, learn（能不能學下一級）, why（不能施放的原因） }
  rtsSkillInfo(e, slot) {
    const rec = e && e.hero,
      D = rec && RTS_HERO_DEFS[rec.def];
    if (!D) return null;
    const id = D.skills[slot],
      S = RTS_SKILLS[id];
    const n = rec.sk[slot];
    const P = skillLv(id, Math.max(1, n));
    const R = this.rts;
    return {
      id,
      name: S.name,
      kind: S.kind,
      slot,
      lv: n,
      max: skillMax(slot),
      coral: P && P.coral ? Math.ceil(P.coral * this.rtsHeroCoralK(rec)) : 0,
      cd: Math.max(0, (rec.cd[slot] || 0) - R.t),
      cdMax: (P && P.cd) || 0,
      range: S.range || 0,
      desc: S.desc,
      passive: S.kind === 'aura' || S.kind === 'passive',
      auto: !!(rec.auto[slot] || (e.rtsAuto && e.rtsAuto[id])),
      canAuto: !!S.auto,
      learn: !this.rtsHeroLearnWhy(rec, slot),
      why: this.rtsSkillWhy(e, slot),
    };
  },
  rtsHeroCoralK(rec) {
    return this.rtsHeroHas(rec, 'i_coralcore') ? RTS_ITEMS.i_coralcore.coralK : 1;
  },
  // 不能施放的原因（'' ＝可以）；不檢查距離
  rtsSkillWhy(e, slot) {
    const R = this.rts,
      rec = e && e.hero;
    const D = rec && RTS_HERO_DEFS[rec.def];
    if (!R || !D || e.dead) return '不能施放';
    const id = D.skills[slot],
      S = RTS_SKILLS[id];
    if (!S) return '沒有這個技能';
    if (S.kind === 'aura' || S.kind === 'passive') return '被動技能';
    if (!rec.sk[slot]) return '還沒學';
    if ((rec.cd[slot] || 0) > R.t + 1e-6) return '冷卻中';
    if (e.rtsAboard) return '搭乘中';
    if (e.hs && (e.hs.dash || e.hs.leap || e.hs.burrow || e.hs.blitz)) return '施放中';
    if (e.rtsJamT > R.t) return '受到干擾';
    if (S.any && e.rtsPiloted) return '親自駕駛中不能施放';
    const P = skillLv(id, rec.sk[slot]);
    const c = Math.ceil((P.coral || 0) * this.rtsHeroCoralK(rec));
    if (R.teams[e.rtsTeam].coral + 1e-6 < c) return 'Coral 不足';
    return '';
  },
  // 施放（距離由呼叫端處理：指揮時 rtsHeroAI 先走過去；親自駕駛時 E 直接呼叫）。
  // tgt：unit 技能＝實體、point＝{ x, z }（或實體）、self＝不用。回傳 true＝放出去了（扣 Coral、進冷卻）
  rtsSkillCast(e, slot, tgt = null) {
    if (this.rtsSkillWhy(e, slot)) return false;
    const rec = e.hero,
      D = RTS_HERO_DEFS[rec.def],
      id = D.skills[slot],
      S = RTS_SKILLS[id];
    const P = skillLv(id, rec.sk[slot]);
    if (S.kind === 'unit') {
      if (!tgt || !tgt.pos || tgt.dead) return false;
      const ally = S.tgt === 'ally';
      if (ally ? tgt.rtsTeam !== e.rtsTeam || (tgt.bld && !S.bld) : tgt.rtsTeam === e.rtsTeam || tgt.rtsInv)
        return false;
      if (S.ground && (tgt.bld || tgt.flying)) {
        if (e.rtsTeam === ME) this.rtsSay('不能對建築與空中單位施放');
        return false; // 磁吸：只能拉地面單位
      }
      if (S.bio && !(RTS_DEFS[tgt.rtsDef] || {}).bio) return false; // 催化：只對生體單位
    }
    if (S.kind === 'point') {
      if (!tgt) {
        // 沒給目標（親自駕駛）：面向的前方（機體的前方是 (−sin(yaw), −cos(yaw))）
        const r = Math.min(S.range || 20, 20);
        tgt = { x: e.pos.x - Math.sin(e.yaw) * r, z: e.pos.z - Math.cos(e.yaw) * r };
      } else if (tgt.pos) tgt = { x: tgt.pos.x, z: tgt.pos.z };
    }
    if (!e.rtsSkillDo(id, P, tgt)) return false;
    const R = this.rts;
    if (e.hs) {
      e.hs.actT = R.t; // 相位迷彩：施放就現形
      if (e.hs.phase) e.hs.stealth = 0;
    }
    R.teams[e.rtsTeam].coral -= Math.ceil((P.coral || 0) * this.rtsHeroCoralK(rec));
    rec.cd[slot] = R.t + (P.cd || 0);
    e.rtsCd = e.rtsCd || {};
    e.rtsCd[id] = rec.cd[slot];
    return true;
  },
  // 指揮時下技能指令（E 的指令卡）：只給會這個技能的英雄
  rtsSkillOrder(e, slot, x, z, id, queue = false) {
    const D = e && e.hero && RTS_HERO_DEFS[e.hero.def];
    if (!D) return false;
    const o = { k: 'ability', ab: D.skills[slot] };
    if (id !== undefined && id !== null) o.id = id;
    else if (x !== undefined && x !== null) ((o.x = x), (o.z = z));
    this.rtsOrder([e], o, queue);
    return true;
  },
  // 切換自動施放（E：右鍵點技能格）
  rtsSkillAuto(e, slot, on) {
    const rec = e && e.hero,
      D = rec && RTS_HERO_DEFS[rec.def];
    if (!D || !RTS_SKILLS[D.skills[slot]].auto) return false;
    rec.auto[slot] = on === undefined ? !rec.auto[slot] : !!on;
    return true;
  },

  // ================= 傷害、暈眩、範圍查詢（技能共用） =================
  rtsHeroDmg(src, t, dmg, atk = 'hero', impact = 0) {
    if (!t || t.dead) return 0;
    this._hSkill = true;
    const k = this.rtsHeroSkillK(src);
    const r = this.rtsHit(t, dmg * k, impact * k, src, atk);
    this._hSkill = false;
    return r;
  },
  rtsHeroSplash(src, x, z, r, dmg, atk = 'exp', impact = 0, team) {
    this._hSkill = true;
    const k = this.rtsHeroSkillK(src);
    const n = this.rtsSplash(
      x,
      z,
      r,
      dmg * k,
      impact * k,
      src,
      atk,
      team !== undefined ? team : src && src.rtsTeam,
    );
    this._hSkill = false;
    return n;
  },
  // 技能傷害的倍率：施放者的 dmgMul × 數值層的 skill（聚焦透鏡）
  rtsHeroSkillK(src) {
    if (!src) return 1;
    return (src.dmgMul || 1) * ((src.rtsM && src.rtsM.skill) || 1);
  },
  // 暈眩（失衡）：建築不受影響；英雄的 ACS 穩定器抵消
  rtsStun(t, sec) {
    if (!t || t.dead || t.bld || t.rtsInv) return false;
    const R = this.rts;
    if (t.hero && this.rtsHeroHas(t.hero, 'i_stab') && !(t.hero.stabT > R.t)) {
      t.hero.stabT = R.t + RTS_ITEMS.i_stab.stab;
      this.fx.ring(t.pos.clone(), 3, 0x9fe8ff);
      return false;
    }
    t.staggerT = Math.max(t.staggerT || 0, sec);
    return true;
  },
  // 範圍內敵對的實體（含中立；不含打不壞的）；units＝只要單位
  rtsHeroFoes(team, x, z, r, units = false) {
    const out = [];
    for (const t of this.rtsNear(x, z, r + 10)) {
      if (!t || t.dead || t.rtsInv || t.rtsTeam === team || t.rtsTeam === undefined) continue;
      if (units && t.bld) continue;
      const d =
        Math.hypot(t.pos.x - x, t.pos.z - z) - (t.bld ? Math.max(t.bld.w, t.bld.d) / 2 : t.radius || 1);
      if (d <= r) out.push(t);
    }
    return out;
  },
  rtsHeroAllies(team, x, z, r, bld = false) {
    const out = [];
    for (const t of this.rtsNear(x, z, r + 2)) {
      if (!t || t.dead || t.rtsTeam !== team || (!bld && t.bld)) continue;
      if (Math.hypot(t.pos.x - x, t.pos.z - z) <= r) out.push(t);
    }
    return out;
  },
  rtsBuffDel(e, src) {
    if (!e || !e.rtsMods) return;
    const L = e.rtsMods.buff;
    const n = L.length;
    e.rtsMods.buff = L.filter((b) => b.src !== src);
    if (e.rtsMods.buff.length !== n) this.rtsModsApply(e);
  },
  // 臨時牆：addTempWall＋導航佔用（消失時 rtsHeroWalls 解除）
  rtsHeroWall(x, z, o) {
    if (!this.addTempWall) return -1;
    const pos = new THREE.Vector3(x, this.world.terrainHeight(x, z), z);
    const id = this.addTempWall(pos, o);
    if (id < 0) return id;
    const odd = Math.round((o.yaw || 0) / (Math.PI / 2)) % 2 !== 0;
    const W = odd ? o.d : o.w,
      D = odd ? o.w : o.d;
    if (this.world.nav) this.world.nav.block(x, z, W, D, 0, true);
    this.rts.hfx.walls.push({ id, x, z, W, D });
    return id;
  },
  rtsHeroWalls() {
    const F = this.rts.hfx;
    for (let i = F.walls.length - 1; i >= 0; i--) {
      const w = F.walls[i];
      if ((this.tWalls || []).some((q) => q.i === w.id && !q.dead)) continue;
      if (this.world.nav) this.world.nav.block(w.x, w.z, w.W, w.D, 0, false);
      F.walls.splice(i, 1);
    }
  },

  // ================= 地面區域（煙幕、腐蝕、吸引、緩速） =================
  // z：{ x, z, r, t（秒）, src, team, dps, atk, foe（給敵人的數值層）, ally（給友軍的）, smoke（友軍不能被鎖定）,
  //   rangeK（敵人的射程倍率）, pull（m/s 往中心）, acid（MARSH 的兩棲回復）, fx: 'smoke'｜'acid'｜'fire'｜null }
  rtsHeroZone(z) {
    const R = this.rts,
      F = R.hfx;
    z.id = ++F.zoneSeq;
    z.until = R.t + z.t;
    F.zones.push(z);
    const p = new THREE.Vector3(z.x, this.world.terrainHeight(z.x, z.z), z.z);
    if (z.fx === 'smoke' && this.addZone) this.addZone('smoke', p, z.r, z.t, { src: z.src, team: 'none' });
    else if (z.fx === 'acid' || z.fx === 'fire') this.fx.firePool(p, z.r, z.t, z.fx === 'acid' ? 1 : 0);
    else if (z.fx === 'pull') this.fx.ring(p.setY(p.y + 0.3), z.r, 0x60c0ff);
    return z.id;
  },
  rtsHeroZones() {
    const R = this.rts,
      F = R.hfx;
    for (let i = F.zones.length - 1; i >= 0; i--) {
      const z = F.zones[i];
      if (z.until <= R.t) {
        F.zones.splice(i, 1);
        continue;
      }
      const src = z.src;
      if (z.fx === 'pull' && Math.random() < 0.5)
        this.fx.ring(
          new THREE.Vector3(z.x, this.world.terrainHeight(z.x, z.z) + 0.3, z.z),
          z.r * 0.6,
          0x60c0ff,
        );
      if (z.dps || z.foe || z.rangeK)
        for (const t of this.rtsHeroFoes(z.team, z.x, z.z, z.r, true)) {
          if (z.dps) this.rtsHeroDmg(src && !src.dead ? src : null, t, z.dps * TICK, z.atk || 'en');
          const b = { ...(z.foe || {}) };
          if (z.rangeK) {
            const D = RTS_DEFS[t.rtsDef] || {};
            b.range = (b.range || 0) - (D.range || 0) * (1 - z.rangeK);
          }
          if (Object.keys(b).length) this.rtsBuff(t, { src: 'z' + z.id, ...b }, TICK + 0.15);
        }
      if (z.ally || z.smoke)
        for (const t of this.rtsHeroAllies(z.team, z.x, z.z, z.r, !!z.bld)) {
          if (z.ally) this.rtsBuff(t, { src: 'z' + z.id, ...z.ally }, TICK + 0.15);
          if (z.smoke) {
            t.hSmokeT = R.t + TICK + 0.15;
            t.noLock = true;
            F.nl.add(t);
          }
        }
    }
  },
  // 吸引區：每格把敵方單位往中心拉（浪尖：拉到的目標受到的傷害增加）
  rtsHeroPull(z, dt) {
    const w = this.world;
    for (const t of this.rtsHeroFoes(z.team, z.x, z.z, z.r, true)) {
      if (t.flying || t.noPush) continue;
      const dx = z.x - t.pos.x,
        dz = z.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.5) continue;
      const s = Math.min(d - 1.2, z.pull * dt);
      this.rtsHeroShift(t, t.pos.x + (dx / d) * s, t.pos.z + (dz / d) * s);
      if (z.src && !z.src.dead) this.rtsHeroTide(z.src, t);
    }
    void w;
  },
  // 直接移動一個單位（擊退、拉動）：碰撞、貼地、空間索引
  rtsHeroShift(t, x, z) {
    const w = this.world;
    const L = w.lim + 10;
    x = Math.max(-L, Math.min(L, x));
    z = Math.max(-L, Math.min(L, z));
    [x, z] = w.collide(x, z, t.pos.y + 0.5, t.radius || 1);
    t.pos.x = x;
    t.pos.z = z;
    if (!t.flying) t.pos.y = w.groundAt(x, z, t.pos.y + 2);
    t.mesh.position.copy(t.pos);
    if (this.rts) this.rts.hash.update(t, x, z);
    if (t.rt) t.rt.nav = null;
  },
  // UNDERTOW 的浪尖（被動）：擊退或拉動的目標受到的傷害增加
  rtsHeroTide(src, t) {
    const rec = src.hero,
      D = rec && RTS_HERO_DEFS[rec.def];
    const i = D ? D.skills.indexOf('sk_tide') : -1;
    const P = i >= 0 && skillLv('sk_tide', rec.sk[i]);
    if (P) this.rtsBuff(t, { src: 'sk_tide', taken: P.taken }, P.t);
  },

  // ================= 持續傷害、標定、制高點、隱形與煙幕的 noLock =================
  rtsHeroDots() {
    const R = this.rts,
      F = R.hfx;
    for (let i = F.dots.length - 1; i >= 0; i--) {
      const d = F.dots[i];
      if (d.until <= R.t || !d.t || d.t.dead) {
        F.dots.splice(i, 1);
        continue;
      }
      this.rtsHeroDmg(d.src && !d.src.dead ? d.src : null, d.t, d.dps * TICK, d.atk || 'en');
      if (d.src && !d.src.dead && this.rtsFxOk(d.t.pos))
        this.fx.beam(d.src.center(), d.t.center(), 0xa0ff60, 0.06);
    }
  },
  rtsHeroMarks() {
    const R = this.rts,
      F = R.hfx;
    for (let i = F.marks.length - 1; i >= 0; i--) {
      const m = F.marks[i];
      if (m.until <= R.t || !m.t || m.t.dead) {
        F.marks.splice(i, 1);
        continue;
      }
      if (this.rtsFogReveal) this.rtsFogReveal(m.team, m.t.pos.x, m.t.pos.z, 8, TICK + 0.3);
      if (m.team === ME) this.fx.ring(m.t.pos.clone().setY(m.t.pos.y + 0.2), 2.2, 0xff4040);
    }
  },
  // SPIRE 的制高點：全隊在高台上的單位射程 +8
  rtsHeroSummit() {
    const R = this.rts,
      F = R.hfx,
      w = this.world;
    for (const k in F.summit) {
      const s = F.summit[k];
      if (s.until <= R.t) {
        delete F.summit[k];
        continue;
      }
      for (const e of R.units) {
        if (e.dead || e.bld || e.rtsTeam !== s.team) continue;
        const h = w.terrainHeight(e.pos.x, e.pos.z);
        let lo = h;
        for (let a = 0; a < 4; a++)
          lo = Math.min(
            lo,
            w.terrainHeight(e.pos.x + Math.cos(a * 1.57) * 14, e.pos.z + Math.sin(a * 1.57) * 14),
          );
        if (h - lo > 3) this.rtsBuff(e, { src: 'sk_summit', range: s.range }, TICK + 0.15);
      }
    }
  },
  // 由這裡設成 noLock 的（隱形、煙幕）：效果結束時還原
  rtsHeroNoLock() {
    const R = this.rts,
      F = R.hfx;
    for (const e of [...F.nl]) {
      const H = e.hs || {};
      const keep = !e.dead && (H.stealth > R.t || H.burrow || e.hSmokeT > R.t || H.flareT > R.t);
      if (!keep) {
        if (!e.dead) e.noLock = false;
        F.nl.delete(e);
      }
    }
  },
  // 被動：MARSH 的兩棲（在水裡或自己的腐蝕區回復）
  rtsHeroPassiveTick() {
    const R = this.rts,
      w = this.world;
    for (const T of R.teams)
      for (const h of T.heroes || []) {
        const e = h.ent;
        if (!e || e.dead || h.st !== 'alive') continue;
        const D = RTS_HERO_DEFS[h.def];
        const i = D.skills.indexOf('sk_amphib');
        const P = i >= 0 && skillLv('sk_amphib', h.sk[i]);
        if (!P) continue;
        const wet =
          (w.waterDepth && w.waterDepth(e.pos.x, e.pos.z) >= 0.3) ||
          R.hfx.zones.some(
            (z) => z.acid && z.team === e.rtsTeam && Math.hypot(z.x - e.pos.x, z.z - e.pos.z) < z.r,
          );
        if (wet) e.hp = Math.min(e.maxHp, e.hp + P.regen * TICK);
      }
  },

  // ================= 光環（每 0.5 秒） =================
  rtsHeroAuras() {
    const R = this.rts;
    const src = [[], [], []];
    for (const T of R.teams)
      for (const h of T.heroes || []) {
        const e = h.ent;
        if (!e || e.dead || h.st !== 'alive' || e.rtsAboard) continue; // 運輸機上的英雄沒有光環
        const D = RTS_HERO_DEFS[h.def];
        D.skills.forEach((id, i) => {
          const S = RTS_SKILLS[id];
          if (S.kind !== 'aura' || !h.sk[i]) return;
          src[T.id].push({
            key: id,
            lv: h.sk[i],
            x: e.pos.x,
            z: e.pos.z,
            r: S.r,
            m: auraMods(id, skillLv(id, h.sk[i])),
          });
        });
        if (this.rtsHeroHas(h, 'i_antenna')) {
          const A = RTS_ITEMS.i_antenna.aura;
          src[T.id].push({ key: 'i_antenna', lv: 1, x: e.pos.x, z: e.pos.z, r: A.r, m: A });
        }
      }
    for (const e of R.units) {
      if (e.dead || e.bld || !e.rtsMods) continue;
      const S = src[e.rtsTeam] || [];
      let best = null;
      if (S.length) {
        const D = RTS_DEFS[e.rtsDef] || {};
        for (const a of S) {
          if (Math.hypot(a.x - e.pos.x, a.z - e.pos.z) > a.r) continue;
          if (a.key === 'sk_link' && !((D.range || 0) >= 30)) continue;
          if (a.key === 'sk_reso' && !(D.atk === 'en' || D.atkEn)) continue; // 共振場：能量攻擊的友軍
          if (a.key === 'sk_symb' && !D.bio) continue; // 共生：生體單位
          if (a.key === 'sk_air' && !e.flying) continue; // 空域管制：己方空中單位
          if (a.key === 'sk_hold' && !this.rtsHeroNearBld(e, HOLD_NEAR)) continue; // 守住家園：己方建築附近的單位
          best = best || {};
          if (!best[a.key] || best[a.key].lv < a.lv) best[a.key] = a;
        }
      }
      const o = {};
      if (best)
        for (const k in best) {
          const m = best[k].m;
          // 時間就是錢：射速只給維爾威的單位
          if (k === 'sk_tempo' && (RTS_DEFS[e.rtsDef] || {}).faction !== 'veerwell')
            addMods(o, { speed: m.speed });
          else addMods(o, m);
        }
      if (!sameMods(o, e.rtsMods.aura)) {
        e.rtsMods.aura = o;
        this.rtsModsApply(e);
      }
    }
    this.rtsHeroBldAuras(src);
  },
  // 守住家園（HAVEN）：光環範圍內的己方建築護甲（建築只吃這一種光環；有來源或身上還有時才走）
  rtsHeroBldAuras(src) {
    const R = this.rts;
    const has = src.map((L) => L.some((a) => a.key === 'sk_hold'));
    for (const e of R.units) {
      if (e.dead || !e.bld || !e.rtsMods) continue;
      const cur = e.rtsMods.aura;
      if (!has[e.rtsTeam] && !(cur && Object.keys(cur).length)) continue;
      let best = null;
      if (has[e.rtsTeam])
        for (const a of src[e.rtsTeam]) {
          if (a.key !== 'sk_hold') continue;
          const r = Math.max(e.bld.w, e.bld.d) / 2;
          if (Math.hypot(a.x - e.pos.x, a.z - e.pos.z) - r > a.r) continue;
          if (!best || best.lv < a.lv) best = a;
        }
      const o = best ? { armor: best.m.armor } : {};
      if (!sameMods(o, cur)) {
        e.rtsMods.aura = o;
        this.rtsModsApply(e);
      }
    }
  },
  // 單位的 r m 內（建築從佔地邊緣算）有己方蓋好的建築
  rtsHeroNearBld(e, r) {
    for (const b of this.rtsNear(e.pos.x, e.pos.z, r + 12)) {
      if (!b || b.dead || !b.bld || b.rtsTeam !== e.rtsTeam || b.bld.progress < 1) continue;
      if (Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z) - Math.max(b.bld.w, b.bld.d) / 2 <= r) return true;
    }
    return false;
  },

  // ================= 命中的掛勾（rtsHook 之後包一層） =================
  rtsHeroWrap(e) {
    if (!e || e.hWrapped) return;
    e.hWrapped = true;
    const td = e.takeDamage;
    const g = this;
    e.takeDamage = function (dmg, impact, from, at, dir, melee, wid, attr) {
      if (this.dead || this.rtsInv || !g.rts || !g.rts.hfx)
        return td.call(this, dmg, impact, from, at, dir, melee, wid, attr);
      if (from && from.hero && !from.dead && from !== this && from.rtsTeam !== this.rtsTeam)
        dmg = g.rtsHeroOnHit(from, this, dmg);
      if (this.hero) dmg = g.rtsHeroOnHurt(this, dmg, from, this._rtsAtk || g.rtsAtkOf(from, wid, attr));
      if (this.rtsShield && dmg > 0) dmg = g.rtsShieldAbsorb(this, dmg, from, wid, attr);
      if (dmg > 0 && g.rts.hfx.domes.length) dmg = g.rtsHeroDomeAbsorb(this, dmg, from, wid, attr);
      if (!(dmg > 0)) return;
      return td.call(this, dmg, impact, from, at, dir, melee, wid, attr);
    };
  },
  // 稜鏡屏障吸收：以相剋與護甲之後的實際傷害計算（回傳剩下的原始傷害）
  rtsShieldAbsorb(e, dmg, from, wid, attr) {
    const R = this.rts,
      S = e.rtsShield;
    if (!S || S.t <= R.t || S.n <= 0) {
      e.rtsShield = null;
      return dmg;
    }
    const k = Math.max(0.05, this.rtsDmgK(e._rtsAtk || this.rtsAtkOf(from, wid, attr), e) || 1);
    const a = Math.min(S.n, dmg * k);
    S.n -= a;
    if (S.n <= 0) e.rtsShield = null;
    if (Math.random() < 0.3 && this.rtsFxOk(e.pos)) this.fx.spark(e.center(), 0x8fe8ff);
    return dmg - a / k;
  },
  // 英雄打中別人：WHITEOUT 的冷彈（隱形中的第一擊）、SPIRE 的高點射擊、PILEDRIVER 的破甲；開火就現形
  rtsHeroOnHit(h, t, dmg) {
    const R = this.rts,
      rec = h.hero,
      H = h.hs || {};
    const D = RTS_HERO_DEFS[rec.def];
    const lvOf = (id) => {
      const i = D.skills.indexOf(id);
      return i >= 0 ? skillLv(id, rec.sk[i]) : null;
    };
    if (H.stealth > R.t) {
      const P = lvOf('sk_ambushfire');
      if (P) dmg *= P.k;
      H.stealth = 0; // 現形
    }
    H.actT = R.t; // 相位迷彩：開火就現形、重新計時
    if (H.high && H.high.until > R.t && h.pos.y - t.pos.y >= 4) dmg *= H.high.k;
    if (!this._hSkill) {
      const P = lvOf('sk_break');
      if (P && !t.bld) {
        const b = (t.rtsMods && t.rtsMods.buff.find((x) => x.src === 'sk_break')) || null;
        if (!b || b.armor > P.armor || b.t - R.t < P.t - 0.5)
          this.rtsBuff(t, { src: 'sk_break', armor: P.armor }, P.t);
      }
    }
    return dmg;
  },
  // 英雄被打：潛地中無敵、緊急障壁吸收、修復套件與回城信標中斷
  rtsHeroOnHurt(e, dmg, from, atk) {
    const R = this.rts,
      H = e.hs || {};
    if (H.burrow) return 0;
    // VECTOR 的滑流：受到的穿甲傷害減少
    if (atk === 'pierce') {
      const D = RTS_HERO_DEFS[e.hero.def];
      const i = D ? D.skills.indexOf('sk_slip') : -1;
      const P = i >= 0 && skillLv('sk_slip', e.hero.sk[i]);
      if (P) dmg *= P.pierce;
    }
    if (H.shield && H.shield.until > R.t && H.shield.hp > 0) {
      const a = Math.min(H.shield.hp, dmg);
      H.shield.hp -= a;
      dmg -= a;
      if (Math.random() < 0.3) this.fx.spark(e.center(), 0x9fe8ff);
    }
    if (dmg > 0 && from && from.rtsTeam !== e.rtsTeam) {
      if (H.kitT > R.t) {
        H.kitT = 0;
        this.rtsBuffDel(e, 'i_kit');
      }
      if (H.chan) {
        H.chan = null;
        if (e.rtsTeam === ME) this.rtsSay('回城信標被打斷');
      }
    }
    return dmg;
  },

  // ================= 道具 =================
  rtsHeroHas(rec, id) {
    return !!(rec && rec.inv && rec.inv.some((s) => s && s.id === id));
  },
  // 給英雄一個道具（背包第一個空格）：回傳格子編號，滿了回傳 -1
  rtsItemGive(e, item, ch) {
    const rec = e && (e.hero || e);
    const I = RTS_ITEMS[item];
    if (!rec || !rec.inv || !I) return -1;
    const i = rec.inv.indexOf(null);
    if (i < 0) return -1;
    rec.inv[i] = { id: item, ch: ch !== undefined ? ch : I.charges || 0, cd: 0 };
    if (rec.ent && !rec.ent.dead) this.rtsHeroApply(rec.ent);
    return i;
  },
  rtsItemTake(rec, slot) {
    const s = rec.inv[slot];
    rec.inv[slot] = null;
    if (rec.ent && !rec.ent.dead) this.rtsHeroApply(rec.ent);
    return s;
  },
  rtsItemWhy(e, slot) {
    const R = this.rts,
      rec = e && e.hero;
    const s = rec && rec.inv[slot];
    if (!s) return '沒有道具';
    const I = RTS_ITEMS[s.id];
    if (I.kind !== 'use') return '永久道具';
    if (e.dead) return '英雄陣亡';
    if (s.cd > R.t) return '冷卻中';
    if (e.rtsAboard) return '搭乘中';
    if (e.hs && (e.hs.chan || e.hs.dash || e.hs.leap || e.hs.burrow || e.hs.blitz)) return '施放中';
    return '';
  },
  // 使用（tgt：point 類的地點 { x, z }；沒給時用英雄的位置）
  rtsItemUse(e, slot, tgt = null) {
    if (this.rtsItemWhy(e, slot)) return false;
    const R = this.rts,
      rec = e.hero,
      s = rec.inv[slot],
      I = RTS_ITEMS[s.id];
    const H = e.hs || (e.hs = {});
    const team = e.rtsTeam;
    const at = tgt && tgt.pos ? tgt.pos : tgt || e.pos;
    switch (s.id) {
      case 'i_kit':
        this.rtsBuff(e, { src: 'i_kit', regen: I.heal / I.t }, I.t);
        H.kitT = R.t + I.t;
        this.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 2.5, 0x60ff90);
        break;
      case 'i_scout': {
        const d = Math.hypot(at.x - e.pos.x, at.z - e.pos.z);
        if (d > I.range) return false;
        if (this.rtsFogReveal) this.rtsFogReveal(team, at.x, at.z, I.r, I.t);
        this.fx.ring(
          new THREE.Vector3(at.x, this.world.terrainHeight(at.x, at.z) + 0.4, at.z),
          I.r,
          0x80d0ff,
        );
        break;
      }
      case 'i_smoke':
        this.rtsHeroZone({
          x: e.pos.x,
          z: e.pos.z,
          r: I.r,
          t: I.t,
          src: e,
          team,
          ally: { taken: I.taken },
          smoke: true,
          fx: 'smoke',
        });
        break;
      case 'i_beacon':
        if (!this.rtsHeroHome(e)) return (team === ME && this.rtsSay('沒有可以回去的主堡'), false);
        H.chan = { kind: 'beacon', until: R.t + I.t };
        e.orders = [];
        this.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), 3, 0x80c0ff);
        break;
      case 'i_barrier':
        H.shield = { hp: I.absorb, until: R.t + I.t };
        this.fx.flash(e.center(), 3, 0x9fe8ff, 0.3);
        break;
      case 'i_contract':
        if (!this.rtsItemContract(e, I)) return false;
        break;
      // ===== 艾瑟立克的專屬道具（docs 14.4） =====
      case 'i_stim': {
        this.rtsBuff(e, { src: 'i_stim', speed: I.speed, rof: I.rof }, I.t);
        if (this.rtsFxOk(e.pos)) this.fx.flash(e.center(), 2.4, 0xa0ff80, 0.25);
        this.later(I.t, () => {
          if (this.rts && !e.dead) e.hp = Math.max(1, e.hp - e.maxHp * I.cost2);
        });
        break;
      }
      case 'i_sample':
        if (!this.rtsHeroTemp(e, 'a_blob', I.n, I.t).length) return false;
        break;
      case 'i_relay': {
        const d = Math.hypot(at.x - e.pos.x, at.z - e.pos.z);
        if (d > I.range + 0.5 || !this.rtsPowerAddTemp) {
          if (team === ME) this.rtsSay(`要在 ${I.range} m 內`);
          return false;
        }
        this.rtsPowerAddTemp(team, at.x, at.z, I.r, I.t);
        const p = new THREE.Vector3(at.x, this.world.terrainHeight(at.x, at.z) + 0.4, at.z);
        this.fx.ring(p, I.r, 0x8fd8ff);
        this.fx.beam(e.center(), p, 0x8fd8ff, 0.1);
        break;
      }
      // ===== 維爾威的專屬道具（docs 15.4） =====
      case 'i_flare':
        H.flareT = R.t + I.t;
        e.noLock = true;
        R.hfx.nl.add(e);
        if (this.rtsFxOk(e.pos)) {
          this.fx.streaks(e.center(), 12, 0xffd080, 10, 0.6, 6);
          this.fx.flash(e.center(), 2.4, 0xffd080, 0.2);
        }
        break;
      case 'i_jetpack': {
        const p = tgt
          ? at
          : { x: e.pos.x - Math.sin(e.yaw) * I.range, z: e.pos.z - Math.cos(e.yaw) * I.range };
        if (Math.hypot(p.x - e.pos.x, p.z - e.pos.z) > I.range + 0.5) {
          if (team === ME) this.rtsSay(`要在 ${I.range} m 內`);
          return false;
        }
        e.rtsHeroLeapTo(p, I.range);
        break;
      }
      case 'i_beacon2': {
        const d = Math.hypot(at.x - e.pos.x, at.z - e.pos.z);
        if (d > I.range + 0.5 || !this.rtsBeaconAddTemp) {
          if (team === ME) this.rtsSay(`要在 ${I.range} m 內`);
          return false;
        }
        this.rtsBeaconAddTemp(team, at.x, at.z, I.t, I.r);
        const p = new THREE.Vector3(at.x, this.world.terrainHeight(at.x, at.z) + 0.4, at.z);
        this.fx.ring(p, I.r, 0x9be070);
        this.fx.beam(e.center(), p, 0x9be070, 0.1);
        break;
      }
      // ===== 聖域的專屬道具（docs 16.4） =====
      case 'i_magnet': {
        let best = null;
        for (const w of this.rtsWreckAt ? this.rtsWreckAt(e.pos.x, e.pos.z, I.r, { team }) : [])
          if (!best || w.ore > best.ore) best = w;
        if (!best) return (team === ME && this.rtsSay('附近沒有殘骸'), false);
        const c = this.rtsWreckTake(best, Infinity);
        const got = {
          ore: Math.floor(c.ore * I.k + 1e-9),
          coral: Math.floor(c.coral * I.k + 1e-9),
          parts: Math.floor(c.parts * I.k + 1e-9),
        };
        this.rtsSalvageDeposit(team, got);
        H.magnetGot = got; // 測試與 HUD 用
        if (this.rtsFxOk(e.pos)) {
          const p = new THREE.Vector3(best.x, this.world.terrainHeight(best.x, best.z) + 0.6, best.z);
          this.fx.beam(p, e.center(), 0xc8a060, 0.12);
          this.fx.dust(p, 2, 8, 0x8a7a60);
        }
        break;
      }
      case 'i_bandage':
        for (const u of [e, ...this.rtsHeroAllies(team, e.pos.x, e.pos.z, I.r)]) {
          if (u !== e && (u.rtsAboard || u.rtsIllus)) continue;
          this.rtsBuff(u, { src: 'i_bandage', regen: I.heal / I.t }, I.t);
        }
        if (this.rtsFxOk(e.pos)) this.fx.ring(e.pos.clone().setY(e.pos.y + 0.3), I.r, 0xf0e0b0);
        break;
      default:
        return false;
    }
    s.cd = R.t + (I.cd || 0);
    if (I.charges) {
      s.ch--;
      if (s.ch <= 0) this.rtsItemTake(rec, slot);
    }
    return true;
  },
  // ================= 維爾威：特快專送（COURIER 的終極技）、無人機中隊的跟隨 =================
  // 特快專送：英雄上方生成一台空投運輸機（v_carrier，血量 P.hp、不跑單位 AI：rts-veer.js 的 rtsDriven），P.delay 秒內
  // 下降到低空（地面武器打得到）→ 載走英雄與 P.R m 內己方的地面單位（最多 P.max 人口，A 的 rtsBoard；ship.rtsCargoMax）→
  // 爬升、以 P.speed m/s 直線飛到 (x, z) → 下降 P.land 秒（低空）→ 全部卸下（rtsDisembark）、P.t 秒傷害 ×P.dmg →
  // 爬升後安靜地移除。運輸機被擊落時 A 的 rtsVeerOnDeath → rtsCargoCrash（乘員彈出、各受最大血量 50%）。
  // 紀錄 R.hfx.express＝[{ ship, hero, x, z, st 'pick'|'fly'|'land'|'leave', t0, P, n（卸下的台數）, pop }]；回傳 true＝放出去了
  rtsHeroExpress(e, P, x, z) {
    const R = this.rts;
    const ship = this.rtsSpawn(e.rtsTeam, 'v_carrier', e.pos.x, e.pos.z, e.yaw);
    if (!ship) return false;
    R.stats[e.rtsTeam].made--; // 不是生產的單位
    ship.rtsDriven = true;
    ship.noPush = true;
    ship.rtsCargoMax = P.max;
    ship.rtsExpress = true;
    if (ship.rtsBase) {
      ship.rtsBase.hp = P.hp;
      this.rtsModsApply(ship);
      ship.hp = ship.maxHp;
    }
    const rec = { ship, hero: e, x, z, st: 'pick', t0: R.t, P, n: 0, pop: 0, alt: P.alt };
    R.hfx.express.push(rec);
    this.rtsHeroShipAt(rec, e.pos.x, e.pos.z, P.alt);
    if (this.rtsFxOk(e.pos)) this.fx.warnCircle(e.pos.clone(), P.R, P.delay, 0x9be070);
    return true;
  },
  // 運輸機放到 (x, z)、離地 alt（直接設定位置；朝向前進方向）
  rtsHeroShipAt(rec, x, z, alt, dx = 0, dz = 0) {
    const s = rec.ship,
      w = this.world;
    rec.alt = alt;
    s.hoverH = alt;
    s.pos.set(x, w.groundAt(x, z, 1e4) + alt, z);
    if (dx || dz) s.yaw = s.aimYaw = Math.atan2(-dx, -dz);
    s.mesh.position.copy(s.pos);
    s.mesh.rotation.y = s.yaw;
    if (this.rts) this.rts.hash.update(s, x, z);
  },
  rtsHeroExpressTick(dt) {
    const R = this.rts,
      F = R.hfx;
    for (let i = F.express.length - 1; i >= 0; i--) {
      const q = F.express[i],
        s = q.ship,
        P = q.P;
      if (s.dead) {
        F.express.splice(i, 1);
        continue;
      }
      const tt = R.t - q.t0;
      if (q.st === 'pick') {
        // 下降到英雄上方（低空），時間到載走
        const h = q.hero;
        const px = h && !h.dead && !h.rtsAboard ? h.pos.x : s.pos.x,
          pz = h && !h.dead && !h.rtsAboard ? h.pos.z : s.pos.z;
        s.rtsLow = true;
        this.rtsHeroShipAt(q, px, pz, P.alt + (4 - P.alt) * Math.min(1, tt / P.delay));
        if (tt >= P.delay) {
          this.rtsHeroExpressBoard(q);
          q.st = q.pop > 0 ? 'fly' : 'leave';
          q.t0 = R.t;
          s.rtsLow = false;
        }
      } else if (q.st === 'fly') {
        const dx = q.x - s.pos.x,
          dz = q.z - s.pos.z;
        const d = Math.hypot(dx, dz);
        const alt = Math.min(P.alt, q.alt + 6 * dt); // 爬升
        const step = P.speed * dt;
        if (d <= step) {
          this.rtsHeroShipAt(q, q.x, q.z, alt, dx, dz);
          q.st = 'land';
          s.rtsLow = true;
          q.t0 = R.t;
          q.alt0 = alt;
        } else this.rtsHeroShipAt(q, s.pos.x + (dx / d) * step, s.pos.z + (dz / d) * step, alt, dx, dz);
        if (s.vel) s.vel.set((dx / (d || 1)) * P.speed, 0, (dz / (d || 1)) * P.speed);
      } else if (q.st === 'land') {
        s.rtsLow = true;
        if (s.vel) s.vel.set(0, 0, 0);
        const k = Math.min(1, tt / P.land);
        this.rtsHeroShipAt(q, q.x, q.z, q.alt0 + (3 - q.alt0) * k);
        if (k >= 1) {
          this.rtsHeroExpressUnload(q);
          q.st = 'leave';
          q.t0 = R.t;
        }
      } else if (q.st === 'leave') {
        s.rtsLow = false;
        this.rtsHeroShipAt(q, s.pos.x, s.pos.z, q.alt + 8 * dt);
        if (tt >= 1.5) {
          F.express.splice(i, 1);
          s.rtsQuiet = true;
          s.die(null);
        }
      }
    }
  },
  // 登機：英雄＋P.R m 內己方的地面單位（依距離，滿了就略過大的）
  rtsHeroExpressBoard(q) {
    const s = q.ship,
      P = q.P,
      h = q.hero;
    const list = [];
    if (h && !h.dead && !h.rtsAboard) list.push(h);
    const cx = h && !h.dead ? h.pos.x : s.pos.x,
      cz = h && !h.dead ? h.pos.z : s.pos.z;
    const near = this.rtsHeroAllies(s.rtsTeam, cx, cz, P.R)
      .filter((u) => u !== h && u !== s && !u.flying && !u.rtsAboard && !u.rtsDriven && !u.rtsPiloted)
      .sort((a, b) => Math.hypot(a.pos.x - cx, a.pos.z - cz) - Math.hypot(b.pos.x - cx, b.pos.z - cz));
    list.push(...near);
    for (const u of list) {
      if (this.rtsBoardWhy(u, s)) continue;
      if (this.rtsBoard(u, s)) q.pop += this.rtsCargoPop(u);
    }
    q.ids = (s.cargo || []).slice();
    if (s.rtsTeam === ME && q.pop && this.rtsEvent) this.rtsEvent(q.x, q.z, '特快專送：前往目的地');
  },
  // 卸下：圍成一圈放下、落地後 P.t 秒傷害 ×P.dmg
  rtsHeroExpressUnload(q) {
    const s = q.ship,
      P = q.P;
    const list = this.rtsCargoOf(s);
    let k = 0;
    for (const u of list) {
      const a = (k / Math.max(1, list.length)) * Math.PI * 2;
      const r = k ? 2.5 + Math.floor(k / 8) * 2.5 : 0;
      k++;
      if (!this.rtsDisembark(u, q.x + Math.cos(a) * r, q.z + Math.sin(a) * r)) continue;
      this.rtsBuff(u, { src: 'sk_express', dmg: P.dmg }, P.t);
      q.n++;
    }
    if (this.rtsFxOk(s.pos)) {
      this.fx.dust(new THREE.Vector3(q.x, this.world.terrainHeight(q.x, q.z), q.z), 6, 14);
      this.fx.ring(new THREE.Vector3(q.x, this.world.terrainHeight(q.x, q.z) + 0.3, q.z), 6, 0x9be070);
    }
  },
  // 無人機中隊：跟著 VECTOR（e.rtsLead）攻擊它的目標；沒有目標時跟在身邊（每 0.5 秒）
  rtsHeroLeadTick() {
    const F = this.rts.hfx;
    for (const q of F.temps) {
      const u = q.e,
        L = u.rtsLead;
      if (!L || u.dead) continue;
      if (L.dead || L.rtsAboard) continue;
      const t = L.rt && L.rt.engage;
      const o = u.orders[0];
      if (t && !t.dead) {
        if (!o || o.k !== 'attack' || o.id !== t.id) u.orders = [{ k: 'attack', id: t.id }];
      } else if (Math.hypot(u.pos.x - L.pos.x, u.pos.z - L.pos.z) > 10) {
        const a = (u.id % 8) * 0.785;
        u.orders = [{ k: 'amove', x: L.pos.x + Math.cos(a) * 4, z: L.pos.z + Math.sin(a) * 4 }];
      } else if (o && o.k === 'attack') u.orders = [];
    }
  },
  // 臨時的單位（CURATOR 的孵化、實驗體樣本）：英雄身邊 n 台 defId，sec 秒後安靜地移除；不佔人口、擊破不給經驗
  // （rtsQuiet）、不算生產。回傳實體的陣列
  rtsHeroTemp(e, defId, n, sec) {
    const R = this.rts,
      nav = this.world.nav;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (e.yaw || 0) + (i / Math.max(1, n)) * Math.PI * 2 + 0.5;
      let x = e.pos.x + Math.cos(a) * 3.2,
        z = e.pos.z + Math.sin(a) * 3.2;
      if (nav) {
        const c = nav.nearestCell(x, z, 0, -1, 8);
        if (c >= 0) ({ x, z } = nav.center(c));
      }
      const u = this.rtsSpawn(e.rtsTeam, defId, x, z, e.yaw);
      if (!u) continue;
      R.stats[e.rtsTeam].made--;
      u.rtsQuiet = true;
      u.rtsNoPop = true;
      u.rtsTemp = R.t + sec;
      R.hfx.temps.push({ e: u, until: R.t + sec });
      if (this.rtsFxOk(u.pos)) this.fx.flash(u.center(), 1.6, 0xa0ff80, 0.2);
      out.push(u);
    }
    this.rtsRecount();
    return out;
  },
  // 幻象的掛勾（A 的 rtsIllusion 建好之後呼叫）：英雄的幻象（VEIL 的全像分身）套回英雄等級的成長數值。
  // 不建立英雄紀錄（e.hero 沒有）、沒有技能、不能撿道具、不能親自駕駛
  rtsHeroIllusionInit(e, src) {
    if (!e || !src || !src.hero || !e.rtsMods) return;
    const rec = src.hero,
      D = RTS_HERO_DEFS[src.rtsDef];
    if (!D) return;
    const n = rec.lv - 1,
      G = D.grow || {};
    e.rtsMods.hero = {
      hp: (G.hp || 0) * n,
      armor: (G.armor || 0) * n,
      dmg: (D.dps + (G.dps || 0) * n) / D.dps,
    };
    this.rtsModsApply(e);
    e.hp = e.maxHp;
    e.rtsIllusHero = rec.def;
  },
  // 最近的己方主堡（回城信標）
  rtsHeroHome(e) {
    let best = null,
      bd = 1e9;
    for (const b of this.rts.units) {
      if (
        b.dead ||
        !b.bld ||
        b.rtsTeam !== e.rtsTeam ||
        b.bld.progress < 1 ||
        !(RTS_DEFS[b.rtsDef] || {}).heroes
      )
        continue;
      const d = Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z);
      if (d < bd) ((bd = d), (best = b));
    }
    return best;
  },
  // 回城信標引導完成（mech-rts-hero.js 呼叫）
  rtsItemBeaconDone(e) {
    const hq = this.rtsHeroHome(e);
    if (!hq) return false;
    const p = this.rtsHeroSpot(hq, e.rtNavSize || 1);
    this.fx.flash(e.center(), 3, 0x80c0ff, 0.3);
    this.rtsHeroShift(e, p.x, p.z);
    e.orders = [];
    if (e.rt) e.rt.home = null;
    this.fx.flash(e.center(), 3, 0x80c0ff, 0.3);
    return true;
  },
  // 建築旁邊可以站的位置
  rtsHeroSpot(b, size = 1) {
    const nav = this.world.nav;
    const r = (b.bld ? Math.max(b.bld.w, b.bld.d) / 2 : 3) + 3;
    let x = b.pos.x + Math.sin(b.yaw || 0) * r,
      z = b.pos.z + Math.cos(b.yaw || 0) * r;
    if (nav) {
      const c = nav.nearestCell(x, z, size, -1, 12);
      if (c >= 0) ({ x, z } = nav.center(c));
    }
    return { x, z };
  },
  // 傭兵合約：這張地圖的傭兵（D 包的 rtsMercContract(隊伍, x, z) → 實體；沒有時用 MT）60 秒
  rtsItemContract(e, I) {
    const R = this.rts;
    const a = Math.random() * Math.PI * 2;
    const x = e.pos.x + Math.cos(a) * 4,
      z = e.pos.z + Math.sin(a) * 4;
    let u = null;
    if (this.rtsMercContract) u = this.rtsMercContract(e.rtsTeam, x, z);
    if (!u) u = this.rtsSpawn(e.rtsTeam, 'c_mt', x, z, e.yaw);
    if (!u) return false;
    R.hfx.temps.push({ e: u, until: R.t + I.t });
    u.rtsTemp = R.t + I.t;
    this.fx.flash(u.center(), 3, 0xffd070, 0.3);
    return true;
  },
  // 丟在腳下
  rtsItemDrop(e, slot) {
    const rec = e && e.hero;
    if (!rec || !rec.inv[slot] || e.dead) return false;
    const s = this.rtsItemTake(rec, slot);
    // 腳下前方可以走到的格子（不要掉進建築裡）
    let x = e.pos.x - Math.sin(e.yaw) * 2.6,
      z = e.pos.z - Math.cos(e.yaw) * 2.6;
    const nav = this.world.nav;
    if (nav) {
      const c = nav.nearestCell(x, z, e.rtNavSize || 0, -1, 8);
      if (c >= 0) ({ x, z } = nav.center(c));
    }
    const it = this.rtsItemSpawn(s.id, x, z, s.ch);
    if (it) it.noPick = e; // 丟下的英雄不會馬上撿回來（離開後才會）
    return true;
  },
  // 交給 6 m 內的另一位己方英雄
  rtsItemPass(e, slot, to) {
    const rec = e && e.hero;
    if (!rec || !rec.inv[slot] || !to || !to.hero || to === e || to.dead || e.dead) return false;
    if (to.rtsTeam !== e.rtsTeam) return false;
    if (Math.hypot(to.pos.x - e.pos.x, to.pos.z - e.pos.z) > PASS_R) {
      if (e.rtsTeam === ME) this.rtsSay('距離太遠（6 m 內）');
      return false;
    }
    if (to.hero.inv.indexOf(null) < 0) {
      if (e.rtsTeam === ME) this.rtsSay('對方的背包滿了');
      return false;
    }
    const s = this.rtsItemTake(rec, slot);
    this.rtsItemGive(to, s.id, s.ch);
    return true;
  },
  // 背包格的資訊（E）：{ id, name, short, kind, ch, cd（剩下的秒）, desc, why }
  rtsItemInfo(e, slot) {
    const s = e && e.hero && e.hero.inv[slot];
    if (!s) return null;
    const I = RTS_ITEMS[s.id];
    return {
      id: s.id,
      name: I.name,
      short: I.short,
      kind: I.kind,
      ch: s.ch,
      cd: Math.max(0, s.cd - this.rts.t),
      desc: I.desc,
      target: I.target || null,
      why: this.rtsItemWhy(e, slot),
    };
  },
  // 地上的道具：{ uid, item, ch, x, z, mesh }
  rtsItemSpawn(item, x, z, ch) {
    const R = this.rts,
      I = RTS_ITEMS[item];
    if (!R || !I) return null;
    const y = this.world.groundAt(x, z, this.world.terrainHeight(x, z) + 2);
    const mesh = buildItemCrate(I.tier);
    mesh.userData.rtsItem = true;
    mesh.position.set(x, y, z);
    R.g.add(mesh);
    const it = { uid: ++R.itemSeq, item, ch: ch !== undefined ? ch : I.charges || 0, x, z, mesh };
    R.items.push(it);
    return it;
  },
  rtsItemRemove(it) {
    const R = this.rts;
    const i = R.items.indexOf(it);
    if (i >= 0) R.items.splice(i, 1);
    if (it.mesh && it.mesh.parent) it.mesh.parent.remove(it.mesh);
  },
  rtsItemById(uid) {
    return (this.rts && this.rts.items.find((it) => it.uid === uid)) || null;
  },
  // 撿起（距離由呼叫端處理）
  rtsItemPickup(e, it) {
    if (!e || !e.hero || !it || e.dead) return false;
    if (this.rtsItemGive(e, it.item, it.ch) < 0) {
      if (e.rtsTeam === ME && !it.fullSaid) {
        it.fullSaid = true;
        this.rtsSay('背包滿了');
      }
      return false;
    }
    this.rtsItemRemove(it);
    return true;
  },
  rtsItemAutoPick() {
    const R = this.rts;
    if (!R.items.length) return;
    for (const it of R.items.slice()) {
      if (
        it.noPick &&
        (it.noPick.dead || Math.hypot(it.noPick.pos.x - it.x, it.noPick.pos.z - it.z) > PICK_R + 1)
      )
        it.noPick = null;
      if (it.mesh) it.mesh.rotation.y += 0.25;
      for (const T of R.teams)
        for (const h of T.heroes || []) {
          const e = h.ent;
          if (!e || e.dead || e === it.noPick) continue;
          if (Math.hypot(e.pos.x - it.x, e.pos.z - it.z) <= PICK_R && this.rtsItemPickup(e, it)) break;
        }
    }
  },

  // ================= 商店（中立商店的庫存在 D 包：rtsShopWhy／rtsShopTake／rtsNeutralRec） =================
  // 這間商店賣的道具（補給商店依主堡層級、中立商店全部）
  rtsBuyList(shop, teamId) {
    if (!isShopBld(shop)) return [];
    if (shop.rtsTeam === RTS_NEUTRAL) return RTS_SHOP_ITEMS.slice();
    const tier = this.rtsTier(teamId !== undefined ? teamId : shop.rtsTeam);
    const list = (RTS_DEFS[shop.rtsDef] || {}).shopItems || RTS_SHOP_ITEMS; // 陣營的貨架（14.4）
    return list.filter((id) => RTS_ITEMS[id] && RTS_ITEMS[id].tier <= tier);
  },
  // 到商店的距離（外形）
  rtsBuyDist(e, shop) {
    return Math.max(
      0,
      Math.hypot(e.pos.x - shop.pos.x, e.pos.z - shop.pos.z) - Math.max(shop.bld.w, shop.bld.d) / 2,
    );
  },
  // 英雄可以用的商店：己方蓋好的補給商店（停擺的不算：導管斷電、電磁脈衝）、中立商店
  rtsBuyShopOk(shop, teamId) {
    return (
      isShopBld(shop) &&
      shop.bld.progress >= 1 &&
      (shop.rtsTeam === teamId || shop.rtsTeam === RTS_NEUTRAL) &&
      !this.rtsBuyOff(shop)
    );
  },
  // 商店停擺（艾瑟立克的保管庫沒有導管供電，或被電磁脈衝打中）
  rtsBuyOff(shop) {
    if (shop && shop.bld && shop.bld.packed) return true; // 維爾威的物流倉庫收起中
    return !!(this.rtsBldOff && shop && shop.bld && this.rtsBldOff(shop));
  },
  // 停擺的原因（HUD 的提示）
  rtsBuyOffWhy(shop) {
    if (shop && shop.bld && shop.bld.packed) return '商店停擺（倉庫收起中）';
    return '商店停擺（沒有導管供電）';
  },
  // 英雄 r（12）m 內最近的商店（沒有＝null）
  rtsBuyShopNear(e, r = RTS_SHOP.r) {
    if (!e || !this.rts) return null;
    let best = null,
      bd = r;
    for (const s of this.rts.units) {
      if (!this.rtsBuyShopOk(s, e.rtsTeam)) continue;
      const d = this.rtsBuyDist(e, s);
      if (d <= bd) ((bd = d), (best = s));
    }
    return best;
  },
  // 選商店本身時的買主：12 m 內最近的己方英雄
  rtsBuyer(shop, teamId) {
    if (!shop) return null;
    const team = teamId !== undefined ? teamId : shop.rtsTeam;
    let best = null,
      bd = RTS_SHOP.r;
    for (const e of this.rtsHeroEnts(team)) {
      const d = this.rtsBuyDist(e, shop);
      if (d <= bd) ((bd = d), (best = e));
    }
    return best;
  },
  // 不能買的原因（'' ＝可以）
  rtsBuyWhyAt(hero, shop, item) {
    const R = this.rts,
      I = RTS_ITEMS[item];
    if (!R || !I || I.drop) return '這個道具不能購買';
    if (!hero || !hero.hero || hero.dead) return '附近沒有英雄';
    if (shop && this.rtsBuyOff(shop)) return this.rtsBuyOffWhy(shop);
    if (!shop || !this.rtsBuyShopOk(shop, hero.rtsTeam)) return '附近沒有商店';
    if (this.rtsBuyDist(hero, shop) > RTS_SHOP.r + 0.5) return `英雄要在商店 ${RTS_SHOP.r} m 內`;
    if (!this.rtsBuyList(shop, hero.rtsTeam).includes(item))
      return `需要 ${this.rtsTierName(hero.rtsTeam, I.tier)}（T${I.tier}）`;
    if (hero.hero.inv.indexOf(null) < 0) return '背包滿了';
    // 中立商店的庫存（D 包）
    if (shop.rtsTeam === RTS_NEUTRAL && this.rtsShopWhy) {
      const w = this.rtsShopWhy(hero.rtsTeam, shop, item, hero);
      if (w) return w;
    }
    const T = R.teams[hero.rtsTeam];
    if (T.ore < (I.cost.ore || 0)) return '礦石不足';
    if (T.coral < (I.cost.coral || 0)) return 'Coral 不足';
    return '';
  },
  rtsBuy(hero, shop, item) {
    const why = this.rtsBuyWhyAt(hero, shop, item);
    if (why) {
      if (hero && hero.rtsTeam === ME) this.rtsSay(why);
      return false;
    }
    const I = RTS_ITEMS[item];
    if (!this.rtsPay(hero.rtsTeam, I.cost)) return false;
    if (shop.rtsTeam === RTS_NEUTRAL && this.rtsShopTake && !this.rtsShopTake(shop, item)) {
      this.rtsRefund(hero.rtsTeam, I.cost, 1);
      return false;
    }
    this.rtsItemGive(hero, item);
    return true;
  },
  // 指令卡的 buy（E）：選的是英雄＝向附近的商店買（不在附近時走過去買）；選的是商店＝買給附近的英雄
  rtsBuyAct(ent, item) {
    if (!ent || ent.dead) return false;
    if (ent.hero) {
      const shop = this.rtsBuyShopNear(ent);
      if (shop) return this.rtsBuy(ent, shop, item);
      const why = this.rtsBuyWhy(ent, item);
      if (/停擺/.test(why)) return (ent.rtsTeam === ME && this.rtsSay(why), false); // 附近的商店停擺：不走去別家
      const far = this.rtsBuyShopNear(ent, 1e9);
      if (!far) return (ent.rtsTeam === ME && this.rtsSay('沒有商店'), false);
      this.rtsOrder([ent], { k: 'shop', id: far.id, item });
      return true;
    }
    if (isShopBld(ent))
      return this.rtsBuy(this.rtsBuyer(ent, ent.rtsTeam === RTS_NEUTRAL ? ME : ent.rtsTeam), ent, item);
    return false;
  },
  // 卡片灰掉的原因（E）：ent＝選的英雄或商店
  rtsBuyWhy(ent, item, teamId = ME) {
    if (!ent) return '';
    if (ent.hero) {
      const shop = this.rtsBuyShopNear(ent);
      if (shop) return this.rtsBuyWhyAt(ent, shop, item);
      const off = this.rts.units.find(
        (s) =>
          isShopBld(s) &&
          s.rtsTeam === ent.rtsTeam &&
          this.rtsBuyOff(s) &&
          this.rtsBuyDist(ent, s) <= RTS_SHOP.r,
      );
      return off ? this.rtsBuyOffWhy(off) : '附近沒有商店';
    }
    const buyer = this.rtsBuyer(ent, ent.rtsTeam === RTS_NEUTRAL ? teamId : ent.rtsTeam);
    return buyer ? this.rtsBuyWhyAt(buyer, ent, item) : '附近沒有英雄';
  },
  // 英雄卡片 R「商店」的子選單（附近有商店時）：該商店賣的道具（act { k: 'buy', item }）
  rtsHeroShopCard(e) {
    const shop = this.rtsBuyShopNear(e);
    if (!shop) return [];
    return shopCard(this.rtsBuyList(shop, e.rtsTeam), false);
  },
  // 賣出（任何商店 12 m 內）：退一半（消耗品依剩下的次數）
  rtsItemSell(e, slot) {
    const rec = e && e.hero;
    const s = rec && rec.inv[slot];
    if (!s || e.dead) return false;
    const shop = this.rtsBuyShopNear(e);
    if (!shop) return (e.rtsTeam === ME && this.rtsSay('附近沒有商店'), false);
    const I = RTS_ITEMS[s.id];
    this.rtsItemTake(rec, slot);
    const k = RTS_SHOP.sellK * (I.charges ? Math.max(0, s.ch) / I.charges : 1);
    this.rtsGrant(e.rtsTeam, Math.floor((I.cost.ore || 0) * k), Math.floor((I.cost.coral || 0) * k));
    return true;
  },

  // ================= 酒館（D 放建築與「全場唯一」的紀錄：rtsTavernWhy／rtsTavernTake／rtsTavernOwner） =================
  // 雇走這位酒館英雄的隊伍（沒有＝−1）
  rtsHireOwner(heroId) {
    if (this.rtsTavernOwner) {
      const o = this.rtsTavernOwner(heroId);
      if (o >= 0) return o;
    }
    const t = this.rts && this.rts.tavernBy ? this.rts.tavernBy[heroId] : undefined;
    return t === undefined ? -1 : t;
  },
  // 己方單位在酒館 14 m 內
  rtsHireNear(teamId, tavern) {
    if (!tavern || tavern.dead) return false;
    const r = RTS_HIRE.r + Math.max(tavern.bld ? tavern.bld.w : 0, tavern.bld ? tavern.bld.d : 0) / 2;
    for (const e of this.rtsNear(tavern.pos.x, tavern.pos.z, r + 2))
      if (
        !e.dead &&
        !e.bld &&
        e.rtsTeam === teamId &&
        Math.hypot(e.pos.x - tavern.pos.x, e.pos.z - tavern.pos.z) <= r
      )
        return true;
    return false;
  },
  rtsHireWhy(teamId, tavern, heroId) {
    const R = this.rts,
      D = RTS_HERO_DEFS[heroId];
    if (!R || !D || !D.tavern) return '酒館沒有這位英雄';
    if (!tavern || tavern.dead) return '沒有酒館';
    const own = this.rtsHireOwner(heroId);
    if (own === teamId) return '已經雇用了';
    if (own >= 0) return '已經被對手雇走了';
    if (this.rtsTavernWhy) {
      const w = this.rtsTavernWhy(teamId, tavern, heroId);
      if (w) return w;
    } else if (!this.rtsHireNear(teamId, tavern)) return `需要己方單位在酒館 ${RTS_HIRE.r} m 內`;
    const why = this.rtsHeroWhyCore(teamId, heroId);
    if (why) return why;
    const T = R.teams[teamId];
    if (T.ore < RTS_HIRE.cost.ore) return '礦石不足';
    if (T.coral < RTS_HIRE.cost.coral) return 'Coral 不足';
    return '';
  },
  // 雇用：立刻出現在酒館旁、從 1 級開始；全場唯一（陣亡後仍屬於雇用的隊伍）
  rtsHire(teamId, tavern, heroId) {
    const why = this.rtsHireWhy(teamId, tavern, heroId);
    if (why) {
      if (teamId === ME) this.rtsSay(why);
      return null;
    }
    if (!this.rtsPay(teamId, RTS_HIRE.cost)) return null;
    const R = this.rts;
    R.tavernBy[heroId] = teamId;
    if (this.rtsTavernTake) this.rtsTavernTake(tavern, heroId, teamId);
    const rec = this.rtsHeroNewRec(heroId, 'tavern');
    R.teams[teamId].heroes.push(rec);
    const e = this.rtsHeroSpawnAt(teamId, heroId, tavern, {});
    if (e) this.rtsRecount();
    if (e && teamId === ME && this.rtsEvent) this.rtsEvent(e.pos.x, e.pos.z, '雇用英雄：' + e.name);
    return e;
  },
  // 酒館的立刻復活：費用 ×1.5、只回半血
  rtsHeroReviveAtWhy(teamId, tavern, heroId) {
    const rec = this.rtsHeroRec(teamId, heroId);
    if (!rec || rec.st !== 'dead') return '這位英雄沒有陣亡';
    if (this.rtsHeroQueued(teamId, heroId)) return '主堡正在復活';
    if (!tavern || tavern.dead) return '沒有酒館';
    if (!this.rtsHireNear(teamId, tavern)) return `需要己方單位在酒館 ${RTS_HIRE.r} m 內`;
    const c = this.rtsHeroReviveCost(teamId, heroId).cost;
    if (this.rts.teams[teamId].ore < Math.ceil(c.ore * RTS_REVIVE.tavernK)) return '礦石不足';
    return '';
  },
  rtsHeroReviveAt(teamId, tavern, heroId) {
    const why = this.rtsHeroReviveAtWhy(teamId, tavern, heroId);
    if (why) {
      if (teamId === ME) this.rtsSay(why);
      return null;
    }
    const c = this.rtsHeroReviveCost(teamId, heroId).cost;
    this.rtsPay(teamId, { ore: Math.ceil(c.ore * RTS_REVIVE.tavernK), coral: 0 });
    const e = this.rtsHeroSpawnAt(teamId, heroId, tavern, { revive: true, hpK: RTS_REVIVE.tavernHp });
    if (e) this.rtsRecount();
    return e;
  },
  rtsHeroSpawnAt(teamId, heroId, near, q) {
    const D = RTS_HERO_DEFS[heroId];
    const p = this.rtsHeroSpot(near, D.size || 1);
    const e = this.rtsSpawn(teamId, heroId, p.x, p.z, near.yaw || 0);
    if (!e) return null;
    this.rtsHeroSpawned(e, { id: heroId, ...q });
    return e;
  },
  // 酒館的卡片（D／E）：Q W E R A S D F＝8 位英雄（act { k: 'hire', hero }），Z X C＝這隊陣亡的英雄立刻復活
  // （act { k: 'hire', revive: 英雄 id }）
  rtsHireCard(teamId = ME) {
    const keys = ['Q', 'W', 'E', 'R', 'A', 'S', 'D', 'F'];
    const card = RTS_TAVERN.map((id, i) => {
      const D = RTS_HERO_DEFS[id];
      return {
        at: [Math.floor(i / 4), i % 4],
        key: keys[i],
        name: D.name,
        tip: `${D.role}：${D.desc}（礦石 ${RTS_HIRE.cost.ore}、Coral ${RTS_HIRE.cost.coral}）`,
        act: { k: 'hire', hero: id },
      };
    });
    const dead = this.rts ? this.rtsHeroRecs(teamId).filter((h) => h.st === 'dead') : [];
    dead.slice(0, 3).forEach((h, i) => {
      const c = this.rtsHeroReviveCost(teamId, h.def).cost;
      card.push({
        at: [2, i],
        key: ['Z', 'X', 'C'][i],
        name: '復活 ' + RTS_HERO_DEFS[h.def].name,
        tip: `立刻復活（半血；礦石 ${Math.ceil(c.ore * RTS_REVIVE.tavernK)}）`,
        act: { k: 'hire', revive: h.def },
      });
    });
    return card;
  },
  // 酒館卡片的動作（E 的 rtsCardAct 轉過來）
  rtsHireAct(teamId, tavern, act) {
    if (!act) return false;
    if (act.revive) return !!this.rtsHeroReviveAt(teamId, tavern, act.revive);
    if (act.hero) return !!this.rtsHire(teamId, tavern, act.hero);
    return false;
  },
  rtsHireIsTavern(e) {
    return !!isTavernBld(e);
  },
  rtsBuyIsShop(e) {
    return !!isShopBld(e);
  },
  // 陣營的英雄（主堡的英雄子選單）
  rtsHeroFaction(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return (T && RTS_FACTION_HEROES[T.faction]) || [];
  },
});
