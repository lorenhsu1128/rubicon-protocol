// ---------- MechEntity 擴充：Boss 改版的共用規則（docs/boss-design.md 第 2 節、data/boss-tier.js）----------
// A 失衡越打越難、D 破綻窗口、I 打斷大招（每個型態一招，先蓄力）、K 破甲彈、L 風格評價對 Boss 的傷害加成。
// 判定只在房主／單機；客機靠快照的 bt（serTier）顯示打斷量表與破綻。刁鑽度＝opts.tier（部位跟著本體），
// 0＝不套用（靶場、實驗室、PvP），此時第三型態照舊由 boss3Tick 放專屬招式。
import { SFX } from '../audio/audio.js';
import { DS } from '../core/scale.js';
import { rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';
import { syRank } from '../data/style-meter.js';
import { D_FAKE_T, D_OPEN, I_CD, K_HIT, L_BONUS, aNeedK, aStagT, tierRow } from '../data/boss-tier.js';

// 第一、二型態的大招（第三型態＝mech-boss3.js 的 SPECIALS）：[名稱, fn(Boss, 目標)]；
// 種類鍵照 boss3Key()。各 Boss 的專屬內容（第 3～5 期）會換成自己的招式，這裡先用共用零件組成。
const BIG = {
  artillery: [
    ['集中砲擊', (b, pl) => b.b3Rain(pl, 6, 6, 0.2)],
    ['追蹤彈幕', (b, pl) => b.b3Rain(pl, 9, 10, 0.35)],
  ],
  worm: [
    ['噴砂吐息', (b, pl) => b.b3Fan(pl, 3, 0.25)],
    ['連續鑽出', (b, pl) => b.b3Erupt(pl, 3, 7)],
  ],
  JUGGERNAUT: [
    ['主砲蓄力', (b, pl) => b.b3Line(pl, 5, 4.5, 0.12)],
    ['齊射', (b, pl) => b.b3Volley(pl, 3, 0.3)],
  ],
  railgun: [
    ['貫穿砲擊', (b, pl) => b.b3Fan(pl, 1, 0)],
    ['連射', (b, pl) => b.b3Fan(pl, 3, 0.12)],
  ],
  heli: [
    ['投放空降兵', (b) => b.game.tierDrop(b, 2)],
    ['火箭齊射', (b, pl) => b.b3Volley(pl, 3, 0.25)],
  ],
  rampart: [
    ['引擎蓄力衝撞', (b) => b.b3Shock(24)],
    ['連續衝撞', (b) => b.b3Shocks(2, 0.8)],
  ],
  train: [
    ['雷射舷砲', (b, pl) => b.b3Fan(pl, 3, 0.2)],
    ['飛彈齊射', (b, pl) => b.b3Rain(pl, 8, 12, 0.25)],
  ],
  furnace: [
    ['熔渣連射', (b, pl) => b.b3Pools(pl, 3, 8)],
    ['火牆', (b) => b.b3Ring(30)],
  ],
  STRIDER: [
    ['雷射蓄力', (b, pl) => b.b3Fan(pl, 1, 0)],
    ['跳躍踩踏', (b) => b.b3Shock(26)],
  ],
  phantom: [
    ['鎖定干擾', (b) => b.b3Ring(26)],
    ['分身展開', (b) => b.game.spawnHolos(b, 2)],
  ],
  ibis: [
    ['雷射扇形', (b, pl) => b.b3Fan(pl, 4, 0.18)],
    ['直線突刺', (b, pl) => b.b3Line(pl, 6, 4, 0.08)],
  ],
  spider: [
    ['砲塔齊射', (b, pl) => b.b3Rain(pl, 7, 10, 0.25)],
    ['跳躍', (b) => b.b3Shock(26)],
  ],
  trinity: [
    ['三連射', (b, pl) => b.b3Volley(pl, 3, 0.25)],
    ['分離前的集結', (b) => b.b3Ring(30)],
  ],
  hunter: [
    ['EMP 充能', (b) => b.b3Ring(34)],
    ['牽引', (b, pl) => b.b3Mines(pl, 4, 8)],
  ],
  orbital: [
    ['追蹤光柱', (b, pl) => b.b3Pillars(pl, 3, 8)],
    ['格子砲擊', (b, pl) => b.b3Rain(pl, 10, 14, 0.15)],
  ],
  flagship: [
    ['護盾強化', (b) => b.b3Ring(30)],
    ['艦砲連射', (b, pl) => b.b3Line(pl, 5, 4.5, 0.15)],
  ],
  fortress: [
    ['轟炸', (b, pl) => b.b3Line(pl, 6, 4, 0.12)],
    ['飛彈雨', (b, pl) => b.b3Rain(pl, 9, 14, 0.2)],
  ],
  interceptor: [
    ['進場掃射', (b, pl) => b.b3Line(pl, 6, 4, 0.08)],
    ['音爆', (b) => b.b3Ring(32)],
  ],
  duo: [
    ['夾擊', (b, pl) => b.b3Volley(pl, 2, 0.3)],
    ['交叉火線', (b, pl) => b.b3Cross(pl)],
  ],
  funnel: [
    ['包圍', (b, pl) => b.b3Cage(pl, 4, 14)],
    ['全方位開火', (b) => b.b3Ring(34)],
  ],
  mirror: [
    ['照你的武器連射', (b, pl) => b.b3Volley(pl, 3, 0.3)],
    ['適應裝甲強化', (b) => b.b3Shock(22)],
  ],
  BALTEUS: [
    ['脈衝裝甲展開', (b) => b.b3Ring(28)],
    ['脈衝爆發', (b) => b.b3Shock(26)],
  ],
};
// 破綻：哪幾招有（刁鑽度 3～4 的 'two'、5～8 的 'one'）；各 Boss 的專屬內容（第 3～5 期）會覆寫
const OPEN_DEF = { two: ['p2', 'p3'], one: ['p3'] };

Object.assign(MechEntity.prototype, {
  // ---------- 刁鑽度 ----------
  bossTier() {
    if (this.isBoss) return this.opts.tier || 0;
    if (this.ai === 'part' || this.ai === 'holo') {
      const par = this.parentEnt && this.parentEnt();
      return par && par !== this && par.isBoss ? par.opts.tier || 0 : 0;
    }
    return 0;
  },
  // 判定在這一端（房主／單機）且有刁鑽度
  tierOn() {
    const g = this.game;
    return !this.remote && this.bossTier() > 0 && !g.range && !g.lab && !g.pvp && !g.cine;
  },
  tierBoss() {
    if (this.isBoss) return this;
    const par = this.parentEnt && this.parentEnt();
    return par && par.isBoss ? par : null;
  },
  tierState() {
    if (!this.bt)
      this.bt = { stagN: 0, ph: 0, cdI: I_CD[0], ch: null, openT: 0, fake: 0, halfT: 0, chain: 0 };
    return this.bt;
  },
  // ---------- A 失衡越打越難 ----------
  // 需要的 ACS 倍率（takeDamage 的過載判定）
  tierAcsK() {
    if (!this.isBoss || !this.tierOn()) return 1;
    return aNeedK(this.bossTier(), this.tierState().stagN);
  },
  // ACS 過載的失衡秒數；計入次數
  tierStagT(base) {
    if (!this.isBoss || !this.tierOn()) return base;
    const s = this.tierState();
    const t = aStagT(this.bossTier(), s.stagN, base);
    s.stagN++;
    return t;
  },
  // 換型態：重置（bosses.js 的 bossPhaseShift）
  tierPhaseReset() {
    if (!this.bt) return;
    this.bt.stagN = 0;
    this.bt.ch = null;
    this.bt.cdI = I_CD[0];
    this.bt.chain = 0;
  },
  // ---------- D 破綻 ----------
  // 本體受到的傷害倍率（bossDefense 最後乘上）：平時 dBase，破綻時 ×1.6
  tierDmgK() {
    if (!this.isBoss || !this.tierOn()) return 1;
    const s = this.tierState();
    if (this.boss2Open && this.boss2Open()) return D_OPEN; // 原本就有的弱點時機（同一格就算）
    return s.openT > 0 && !(s.fake > 0) ? D_OPEN : tierRow(this.bossTier()).dBase;
  },
  // 打開破綻（秒數沒給時照刁鑽度）；nat＝這隻原本就有的弱點時機（每格延長，不重複提示）
  bossOpen(sec, nat) {
    if (!this.isBoss || !this.tierOn()) return;
    const s = this.tierState(),
      g = this.game;
    const T = sec || tierRow(this.bossTier()).dOpenT;
    const was = s.openT > 0 && !(s.fake > 0);
    s.openT = Math.max(s.openT, T);
    s.fake = 0;
    if (was) return;
    if (!nat || !s.natShown) {
      g.popDamage(this.center().setY(this.center().y + 3 * DS), '破綻！', false, true, false, 0, this.id);
      g.fx.shockwave(this.center(), 7 * (this.scale || 1), 0xffd040, 0.45);
      SFX.play('bell', 0.6, 1.3, 0.02, 0.2, this.center());
      g.tierIntro('open', '破綻 — Boss 身上出現金色光環時傷害加倍，趁收招猛攻');
    }
    if (nat) s.natShown = true;
  },
  // 大招收招：依刁鑽度決定這一招有沒有破綻（刁鑽度 7～8 先來一次假收招）
  tierMoveEnd(id) {
    const s = this.tierState(),
      T = tierRow(this.bossTier()),
      g = this.game;
    s.chain++;
    let open = false;
    if (T.dWhich === 'all') open = true;
    else if (T.dWhich === 'two') open = (this.tierKit().open2 || OPEN_DEF.two).includes(id);
    else open = (this.tierKit().open1 || OPEN_DEF.one).includes(id) || s.chain >= 2;
    if (!open) return;
    s.chain = 0;
    if (T.dWhich === 'fake' && Math.random() < 0.5) {
      // 假收招：金色光環一閃，0.4 秒後接一招衝擊波，之後才是真的破綻
      s.openT = D_FAKE_T + 0.05;
      s.fake = D_FAKE_T + 0.05;
      g.fx.shockwave(this.center(), 6 * (this.scale || 1), 0xffd040, 0.3);
      g.later(D_FAKE_T, () => {
        if (this.dead) return;
        this.b3Shock(18);
        g.later(0.9, () => !this.dead && this.bossOpen());
      });
      return;
    }
    this.bossOpen();
  },
  // 這隻 Boss 的專屬內容（第 3～5 期的 BOSS_KIT；還沒有時是空的）
  tierKit() {
    const K = this.game.bossKit ? this.game.bossKit(this.boss3Key()) : null;
    return K || {};
  },
  // ---------- I 打斷大招 ----------
  // updateAI 每格（dt 已乘上節奏）：型態開頭等 I_CD[0] 秒，之後每 I_CD[1] 秒蓄力一次
  tierTick(dt, pl) {
    const s = this.tierState(),
      g = this.game,
      T = tierRow(this.bossTier());
    const ph = this.bossPhase();
    if (s.ph !== ph) {
      s.ph = ph;
      s.cdI = I_CD[0];
      s.ch = null;
    }
    if (s.openT > 0) s.openT -= dt;
    if (s.fake > 0) s.fake -= dt;
    if (s.halfT > 0) s.halfT -= dt;
    if (this.boss2Open && this.boss2Open()) this.bossOpen(0.25, true); // 原本就有的弱點時機＝破綻
    const ch = s.ch;
    if (ch) {
      if (this.staggerT > 0 || this.dead) {
        s.ch = null;
        return;
      }
      ch.t += dt;
      // 刁鑽度 3～4：蓄力時慢慢後退（飛行的升高）
      if (T.iTrick === 'retreat' && pl && this.ai !== 'part') {
        if (this.flying) this.pos.y += dt * 2 * DS;
        else {
          const aw = this.pos.clone().sub(pl.pos).setY(0);
          if (aw.lengthSq() > 0.01) this.vel.addScaledVector(aw.normalize(), 3 * DS * dt * 6);
        }
      }
      if (T.iTrick === 'guard' && (ch.gt = (ch.gt || 0) - dt) <= 0) {
        ch.gt = 0.35;
        const f = this.center().addScaledVector(ch.face, 4 * DS * (this.scale || 1));
        g.fx.ring(f, 3 * DS, 0x60c0ff);
      }
      if (ch.t >= ch.T) {
        // 放出（只斷一次＝大招減半）
        s.ch = null;
        if (ch.broke) s.halfT = 4;
        s.cdI = I_CD[1] * rnd(0.85, 1.15);
        g.flashMsg(`${this.name.split(' ')[0]}：${ch.name}！`, 0xff4030, 1.4);
        SFX.play('alarm', 0.5, 0.9, 0.02, 0.5, this.center());
        if (pl && !pl.dead) ch.fn(this, pl);
        g.later(1.6, () => !this.dead && this.tierMoveEnd(ch.id));
      }
      return;
    }
    if (!pl || this.staggerT > 0 || (this.noLock && this.opts.bossKind === 'trinity')) return;
    s.cdI -= dt;
    if (s.cdI > 0) return;
    const mv = this.tierMove(ph);
    if (!mv) return (s.cdI = I_CD[1]);
    const face = pl.pos.clone().sub(this.pos).setY(0);
    if (face.lengthSq() < 0.01) face.set(0, 0, -1);
    s.ch = {
      id: 'p' + ph,
      name: mv[0],
      fn: mv[1],
      t: 0,
      T: T.iCharge,
      need: T.iNeed * this.maxHp,
      dealt: 0,
      n: T.iTrick === 'double' ? 2 : 1,
      k: 1,
      broke: 0,
      face: face.normalize(),
    };
    g.flashMsg(`${this.name.split(' ')[0]} 蓄力中：${mv[0]} — 打斷它！`, 0xff8030, 1.8);
    g.fx.shockwave(this.center(), 8 * (this.scale || 1), 0xff6020, 0.6);
    SFX.play('alarm', 0.45, 0.7, 0.02, 0.3, this.center());
    g.tierIntro('charge', '打斷大招 — Boss 蓄力時（畫面上方的量表）集中火力打滿就能打斷，打斷後長時間失衡');
  },
  // 這個型態的大招：[名稱, fn]
  tierMove(ph) {
    const key = this.boss3Key();
    const kit = this.tierKit();
    if (kit.big && kit.big[ph - 1]) return kit.big[ph - 1];
    if (ph >= 3) {
      const S = this.boss3Spec && this.boss3Spec();
      return S ? [S.name, S.fn] : null;
    }
    const B = BIG[key];
    return B ? B[ph - 1] : null;
  },
  // 蓄力中受到的傷害（Boss 本體與部位，takeDamage 呼叫）：累積到要求就打斷
  tierGauge(real, from) {
    const b = this.tierBoss();
    if (!b || !b.bt || !b.bt.ch || !b.tierOn()) return;
    const ch = b.bt.ch;
    ch.dealt += real * (this.cpHitK || 1); // 反擊點：累積 ×2（第 2 期）
    if (ch.dealt < ch.need) return;
    const g = b.game;
    if (ch.k < ch.n) {
      // 刁鑽度 7～8：連續蓄力兩次，第一次斷了接著第二次
      ch.k++;
      ch.broke = 1;
      ch.t = 0;
      ch.dealt = 0;
      g.popDamage(b.center().setY(b.center().y + 3 * DS), '打斷 1／2', false, true, false, 0, b.id);
      g.fx.shockwave(b.center(), 8 * (b.scale || 1), 0x7fd8ff, 0.4);
      g.flashMsg(`${b.name.split(' ')[0]} 再次蓄力 — 還要再打斷一次！`, 0xff8030, 1.6);
      return;
    }
    b.tierInterrupt(from);
  },
  tierInterrupt(from) {
    const s = this.tierState(),
      g = this.game,
      T = tierRow(this.bossTier());
    s.ch = null;
    s.cdI = I_CD[1] * rnd(0.85, 1.15);
    // 長時間失衡：無視失衡後保護，也不算進 A 的次數
    this.stagGuardT = 0;
    this.acs = this.acsMax;
    this.staggerT = Math.max(this.staggerT, T.iStun);
    this.stagBy = from ? { id: from.id, cls: 'int' } : null;
    const c = this.center();
    g.popDamage(c.clone().setY(c.y + 3 * DS), '打斷！', false, true, false, 0, this.id);
    g.fx.shockwave(c, 14 * (this.scale || 1), 0x7fd8ff, 0.7);
    g.fx.flash(c, 5, 0xbfe8ff, 0.2);
    g.camShake = Math.max(g.camShake, 0.3);
    SFX.stagger(c);
    g.netEv({ t: 'stag', i: this.id });
    g.flashMsg(`打斷成功 — ${this.name.split(' ')[0]} 失衡`, 0x7fd8ff, 2);
    g.tierDropAmmo(this);
    if (from && from.syEvent) from.syEvent('interrupt');
    this.tierMoveEnd('int');
  },
  // 打斷的護盾（刁鑽度 5～6）：從蓄力開始時面向的那一側打進來的，傷害與量表 ×0.25
  tierGuardK(from, at) {
    const s = this.bt;
    if (!s || !s.ch || tierRow(this.bossTier()).iTrick !== 'guard') return 1;
    const src = from && from.pos && from !== this ? from.pos : at;
    if (!src) return 1;
    const to = src.clone().sub(this.pos).setY(0);
    if (to.lengthSq() < 0.01) return 1;
    if (to.normalize().dot(s.ch.face) < 0.5) return 1;
    if (at && Math.random() < 0.4) this.game.fx.spark(at, 0x80c8ff);
    return 0.25;
  },
  // 只斷一次的大招：傷害減半（b3Dm）
  tierHalfK() {
    return this.bt && this.bt.halfT > 0 ? 0.5 : 1;
  },
  // ---------- K 破甲彈（玩家機體）、L 風格評價的傷害加成 ----------
  // 打中 Boss 時的額外傷害與加成：回傳 [傷害倍率, 額外傷害]（takeDamage）
  tierHitMods(from) {
    if (!from || !from.pilotEnt || !from.pilotEnt() || !this.tierOn()) return [1, 0];
    let k = 1,
      extra = 0;
    // L：S 以上的風格評價
    const r = from.sy ? syRank(from.sy.pts) : -1;
    if (L_BONUS[r]) k += L_BONUS[r];
    // K：破甲充能滿了 → 這一發是破甲彈（只打 Boss 本體）
    if (this.isBoss && from.bk && from.bk.full) {
      from.bk.full = false;
      from.bk.n = 0;
      extra = K_HIT * this.maxHp;
      const g = this.game,
        c = this.center();
      g.popDamage(c.clone().setY(c.y + 3.5 * DS), '破甲！', false, true, false, 0, this.id);
      g.fx.shockwave(c, 10 * (this.scale || 1), 0xff70ff, 0.5);
      g.fx.flash(c, 4, 0xffa0ff, 0.15);
      SFX.stagger(c);
      if (!(this.stagGuardT > 0) && this.staggerT <= 0) {
        this.acs = this.acsMax;
        this.staggerT = 1.5;
        g.netEv({ t: 'stag', i: this.id });
      }
    }
    return [k, extra];
  },
  // 玩家擊破雜兵（Boss 戰中）：累積破甲充能
  bkAdd() {
    const g = this.game;
    const T = tierRow(g.tierFightTier());
    const b = this.bk || (this.bk = { n: 0, idle: 0, full: false });
    if (b.full) return;
    b.n++;
    b.idle = 0;
    if (b.n >= T.kNeed) {
      b.n = T.kNeed;
      b.full = true;
      if (this.isPlayer) {
        g.flashMsg('破甲充能完成 — 下一發打中 Boss 直接打出失衡', 0xff70ff, 2.2);
        SFX.play('bell', 0.7, 1.5, 0.02, 0.2);
      }
      g.tierIntro('bk', '破甲充能 — Boss 戰中擊破雜兵累積，滿了之後下一發打中 Boss 是破甲彈');
    }
  },
  bkTick(dt, tier) {
    const b = this.bk;
    if (!b || b.full || b.n <= 0) return;
    const T = tierRow(tier);
    if (!T.kDecay) return;
    b.idle += dt;
    if (b.idle > T.kDecay) b.n = Math.max(0, b.n - dt * 0.5);
  },
  // 0～1（HUD）
  bkFrac(tier) {
    const b = this.bk;
    if (!b) return this.bkC || 0;
    return b.full ? 1 : b.n / tierRow(tier).kNeed;
  },
  // ---------- 同步（serEnt 的 bt）：[蓄力 % (-1 沒有), 量表 %, 破綻 ×10, 旗標（1 假收招 2 護盾 4 第二次）] ----------
  serTier() {
    const s = this.bt;
    if (!s || !this.isBoss) return null;
    const ch = s.ch;
    if (!ch && !(s.openT > 0)) return null;
    const T = tierRow(this.bossTier());
    return [
      ch ? Math.round((ch.t / ch.T) * 100) : -1,
      ch ? Math.round(Math.min(1, ch.dealt / ch.need) * 100) : 0,
      Math.round(Math.max(0, s.openT) * 10),
      (s.fake > 0 ? 1 : 0) | (ch && T.iTrick === 'guard' ? 2 : 0) | (ch && ch.k > 1 ? 4 : 0),
    ];
  },
  // 顯示用的狀態（房主＝自己的 bt；客機＝快照）：{ chg, gauge, open, fake, guard, second, name }
  tierView() {
    if (!this.isBoss) return null;
    if (this.remote) {
      const v = this.btC;
      if (!v) return null;
      const mv = v[0] >= 0 && this.tierMove(this.bossPhase());
      return {
        chg: v[0] >= 0 ? v[0] / 100 : -1,
        gauge: v[1] / 100,
        open: v[2] / 10,
        fake: !!(v[3] & 1),
        guard: !!(v[3] & 2),
        second: !!(v[3] & 4),
        name: mv ? mv[0] : '',
      };
    }
    const s = this.bt;
    if (!s) return null;
    const ch = s.ch;
    return {
      chg: ch ? ch.t / ch.T : -1,
      gauge: ch ? Math.min(1, ch.dealt / ch.need) : 0,
      open: Math.max(0, s.openT),
      fake: s.fake > 0,
      guard: !!(ch && tierRow(this.bossTier()).iTrick === 'guard'),
      second: !!(ch && ch.k > 1),
      name: ch ? ch.name : '',
    };
  },
  // 破綻的金色光環（房主與客機各自畫，不轉送）
  tierFx(dt) {
    const v = this.tierView();
    if (!v || !(v.open > 0) || this.dead) return;
    this.btFxT = (this.btFxT || 0) - dt;
    if (this.btFxT > 0) return;
    this.btFxT = 0.3;
    const g = this.game;
    const fx = g.fx;
    const nest = fx._nested;
    fx._nested = true; // 不轉送給客機（各端自己畫）
    try {
      fx.ring(this.center(), 4 * (this.scale || 1) * DS, 0xffd040);
    } finally {
      fx._nested = nest;
    }
  },
});
