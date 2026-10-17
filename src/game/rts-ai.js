// Coral 戰爭（RTS）的電腦對手（mixin）：rtsAiInit（開局）、rtsAiTick（rtsSim 每格）、rtsAiClear（離開）。
// 只透過核心 API 操作（rtsAfford、rtsQueue、rtsOrder、rtsSmart、rtsUnitsOf、rtsFindSpot、world.nav 的查詢），
// 不直接改單位與資源；找敵人只用戰爭迷霧（rtsFogEnemies＝看得到的、rtsFogKnown＝記得的建築），
// 開局只知道地圖上的出生點候選（plan.bases，相當於魔獸3 地圖公開的出生點），要派偵查才知道對方實際的位置。
// 瘋狂難度的 cfg.diff 由 rts-fog.js 判斷成不受迷霧限制，收入倍率 T.income 由核心的 rtsDeposit／抽取站套用。
// 資料（開局建造順序、難度參數）在 data/rts-ai.js。
//
// 每個電腦隊伍一份狀態 R.ai[i]（A），每 A.P.dt 秒決策一次（rtsAiThink），各層：
// - 經濟（rtsAiEconomy）：工人生產到每座有主堡的礦脈約 5 人、閒置工人分配到人少的礦脈、被打的工人拉走（附近沒有部隊時）、
//   人口快滿時蓋補給庫、抽取站、開分礦（在礦脈旁蓋新的主堡）、多蓋兵工廠、沒有工人繼續施工的工地派人續建、修理受損建築。
// - 建造順序（rtsAiOpener）：開局的步驟依人口觸發，資源先保留。
// - 軍事（rtsAiMilitary）：部隊集結在自家坡道口；部隊到門檻（難度、時間）或偵查到對方弱時進攻（攻擊移動到記得的敵方建築，
//   不知道時依序搜索出生點與礦脈）；基地被攻擊時回防（召回）；打不過時撤退；集火同一個目標；困難以上撤回受傷單位。
// - 偵查（rtsAiScout）：scoutT 時派一個工人（之後是部隊）走對方的出生點候選。
// - （R3 F 包，docs 14.6、14.17）艾瑟立克：導管（rtsAiGrid：要電的建築只蓋在有電的地方、找不到時先蓋導管節點、
//   生產建築的備援、停擺時重蓋節點最優先）、融合（rtsAiFuse）、結晶護壁（取代民兵）、單位技能（投影、過載、浮游砲、吞噬）；
//   兩個陣營共用：兵種相剋的權重（看過的敵方護甲）、打導管節點（rtsPowerDeps 加權）、對城甲弱的陣營先打部隊與分礦。
// 測試與除錯：cfg.aiBoth（或 g.rtsAiBoth）＝兩邊都是電腦，cfg.aiOpener（或 g.rtsAiOpener）指定開局，g.rtsAiOff＝不啟動；
// R.ai[i].ms／msMax 是決策的耗時，R.ai[i].log 是重要事件（進攻、撤退、開分礦…）。
import { RTS_ABILS, RTS_DEFS, RTS_FACTIONS, RTS_GATHER, RTS_POP_MAX } from '../data/rts-units.js';
import {
  RTS_AI_ABILS,
  RTS_AI_CAST,
  RTS_AI_DIFFS,
  RTS_AI_ITEMS,
  RTS_AI_ITEMS_FAC,
  RTS_AI_OPENERS,
  RTS_AI_RES_UNIT,
  RTS_AI_ROLES,
} from '../data/rts-ai.js';
import { RTS_FUSE } from '../data/rts-aetheric.js';
import { RTS_RESEARCH, RTS_TYPE_K } from '../data/rts-combat.js';
import { RTS_HERO_DEFS, RTS_HIRE, RTS_SKILLS, RTS_TAVERN, skillLv } from '../data/rts-heroes.js';
import { RTS_ITEMS } from '../data/rts-items.js';
import { Game } from './game.js';

const MINE_R = 32; // 礦脈離主堡這麼近算這座主堡的礦
const THREAT_R = 42; // 敵人離自己的建築這麼近算威脅
const NEAR_R = 45; // 戰力比較的範圍
const BLD_PAD = 4; // 蓋建築時四周留的通道（m）
const PEND_T = 50; // 派出去蓋的工人這麼久還沒放下地基就取消

const hyp = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
// 點到線段的距離
const segD = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax,
    dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
};
const defOf = (e) => RTS_DEFS[e.rtsDef] || {};
// 戰鬥單位（含英雄；自己的部隊 S.army 不含英雄，英雄另外在 S.heroes）
const isArmy = (e) => !e.bld && !defOf(e).worker && (defOf(e).range || 0) > 0;
// 戰力：Σ√(血量×dps)（盾牌 MT 的正面大盾算 1.6 倍；英雄的 dps 含成長與道具的傷害倍率）；比較時取平方（Lanchester 平方律）
const unitPow = (e) => {
  const D = defOf(e);
  if (!D.dps || e.bld) return 0;
  const k = D.ai === 'shield' ? 1.6 : e.hero ? (e.dmgMul || 1) * 1.2 : 1;
  return Math.sqrt(Math.max(0, e.hp) * D.dps * k);
};
// 定義的戰力（還沒看到的野怪營地用：營地的編成是地圖公開的資訊）
const defPow = (id) => {
  const D = RTS_DEFS[id] || {};
  return Math.sqrt((D.hp || 0) * (D.dps || 0));
};
const powOf = (list) => list.reduce((s, e) => s + unitPow(e), 0);
const centroid = (list) => {
  let x = 0,
    z = 0;
  for (const e of list) ((x += e.pos.x), (z += e.pos.z));
  return list.length ? { x: x / list.length, z: z / list.length } : null;
};

Object.assign(Game.prototype, {
  // ---------- 開局 ----------
  rtsAiInit() {
    const R = this.rts;
    if (!R) return;
    R.ai = [];
    if (this.rtsAiOff) return;
    const cfg = R.cfg || {};
    if (cfg.aiBoth || this.rtsAiBoth) {
      cfg.aiBoth = true;
      for (const T of R.teams) if (!T.neutral) T.ai = true;
    }
    const plan = this.world.rts;
    const diffs = cfg.diffs || this.rtsAiDiffs || null; // 兩邊都是電腦時可以各自指定難度
    for (const T of R.teams) {
      if (!T.ai || T.neutral) continue;
      const diff = (diffs && diffs[T.id]) || cfg.diff || 'normal';
      const fac = RTS_AI_ROLES[T.faction] && RTS_AI_OPENERS[T.faction] ? T.faction : 'castron';
      const P = RTS_AI_DIFFS[diff] || RTS_AI_DIFFS.normal;
      const roles = RTS_AI_ROLES[fac];
      const F = RTS_FACTIONS[fac];
      const ops = RTS_AI_OPENERS[fac];
      const want = cfg.aiOpener || this.rtsAiOpener;
      const pickId = Array.isArray(want) ? want[T.id] : want;
      const op = ops.find((o) => o.id === pickId) || ops[Math.floor(Math.random() * ops.length) % ops.length];
      const base = plan.bases.find((b) => b.owner === T.id) || plan.bases[T.id];
      if (P.income !== 1) T.income = P.income;
      if (P.cheat && this.rtsFogRevealAll) this.rtsFogRevealAll(T.id, true);
      // 開局步驟：同一種建築第 n 次出現＝要有 n 座（主堡開局就有一座）
      const cnt = {};
      const steps = op.steps.map((s) => {
        cnt[s.b] = (cnt[s.b] || 0) + 1;
        return { ...s, n: cnt[s.b] + (s.b === roles.hq ? 1 : 0) };
      });
      const A = {
        team: T.id,
        diff,
        P,
        op,
        roles,
        fac, // 陣營（R3）
        grid: !!F.grid, // 導管網（艾瑟立克）
        militia: !!F.militia, // 主堡能動員民兵（卡斯特隆）
        worker: F.worker,
        base,
        steps,
        si: 0, // 下一個開局步驟
        t: (P.dt * R.ai.length) / 2, // 兩個電腦錯開
        pend: [], // 派出去蓋、還沒放下地基的建築 { def, w, o, t }
        res: { ore: 0, coral: 0 }, // 這一次決策保留的資源
        mode: 'home', // home 集結／防守、attack 進攻
        need: Math.max(3, Math.round(P.need0 * op.armyK)),
        attackT: P.attackT * op.attackK,
        waves: 0,
        atk: new Set(), // 進攻中的部隊（id）
        obj: null, // 進攻目標 { x, z, id?, explore? }
        focus: null,
        explore: [],
        visited: new Set(),
        seen: new Map(), // 看到過的敵方部隊 id → { t, pow }
        enemySeenT: -1e9, // 最後看到敵方建築的時間
        scout: null,
        scouted: false,
        flee: new Map(), // 拉走的工人 id → 結束時間
        repairs: new Map(), // 建築 id → 工人
        rally: null,
        cool: 0, // 撤退之後這段時間不進攻
        ms: 0, // 決策的耗時（毫秒，指數平均；不含 rtsOrder 裡的流場計算）
        msMax: 0,
        ordMs: 0, // 這一次決策花在 rtsOrder 的時間
        ordMax: 0,
        n: 0,
        log: [],
        firstAtk: null,
        // ---- R2 第二輪（F 包） ----
        heroIds: (op.heroes || [op.hero]).filter((id) => RTS_HERO_DEFS[id]),
        tavernWant: P.tavern > 0 && Math.random() < P.tavern, // 這一局要不要雇酒館英雄
        tav: null, // 去酒館雇用 { hero, u, t0 }
        hj: new Map(), // 英雄的工作：英雄 id → { k: 'retreat'|'shop'|'pick', t0 }
        creep: null, // 打野 { camp, units: Set, t0, ph }
        campDone: new Set(), // 知道已經清除的營地
        campFail: new Map(), // 打不下來的營地 → 再試的時間
        defEp: 0, // 基地被攻擊的次數（30 秒內的算同一次）
        lastThT: -1e9,
        thDir: null, // 最近一次威脅的方向（從主堡看）
        enemyAir: -1e9, // 最後看到敵方空中單位的時間
        atkKinds: { kin: 0, pierce: 0, exp: 0, en: 0 }, // 看過的敵方部隊的攻擊類型
        walled: new Set(), // 已經蓋過城牆的防禦塔
        upgWant: false, // 要升級主堡（主堡不排工人）
        resI: 0,
        casts: 0, // 施放技能的次數（測試）
        heroT: {},
        tierT: {}, // 升到各階的時間
        // ---- R3（F 包） ----
        armSeen: new Map(), // 看過的敵方單位 id → { t, arm, pop }（兵種相剋的權重，最近 3 分鐘）
        fuseN: 0, // 下了幾組融合（測試）
        fuseT: 0,
        nodeLog: [], // 為了什麼蓋導管節點（除錯）
        aegisN: 0,
        foeGrid: false, // 對方有導管網（看過導管節點或汲取塔）
        // 對方的陣營（開局時公開的資訊：選單、開局訊息、結果畫面都看得到）
        foeFac: (R.teams.find((q) => !q.neutral && q.id !== T.id) || {}).faction || fac,
      };
      A.rally = this.rtsAiRallyPoint(A);
      A.explore = this.rtsAiExploreList(A);
      R.ai.push(A);
      this.rtsAiLog(A, `開局：${op.name}（${diff}）`);
    }
  },
  // 下指令（記下花在核心 rtsOrder 的時間：大群體第一次走向新的目標時要算流場）
  rtsAiOrd(A, units, o, queue) {
    const t0 = performance.now();
    const r = this.rtsOrder(units, o, queue);
    A.ordMs += performance.now() - t0;
    return r;
  },
  rtsAiClear() {
    if (this.rts) this.rts.ai = null;
  },
  rtsAiLog(A, s) {
    const t = this.rts ? this.rts.t : 0;
    A.log.push(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} ${s}`);
    if (A.log.length > 200) A.log.shift();
  },
  // 集結點：自家坡道下往外 8 m（可以走的格子）
  rtsAiRallyPoint(A) {
    const nav = this.world.nav,
      rp = A.base.ramp;
    const L = hyp(rp.bottom.x, rp.bottom.z, rp.top.x, rp.top.z) || 1;
    const x = rp.bottom.x + ((rp.bottom.x - rp.top.x) / L) * 8,
      z = rp.bottom.z + ((rp.bottom.z - rp.top.z) / L) * 8;
    const c = nav.nearestCell(x, z, 1, -1, 10);
    return c >= 0 ? nav.center(c) : { x, z };
  },
  // 搜索的順序：對方的出生點候選、它們附近的礦脈、其他礦脈與 Coral（由近到遠）
  rtsAiExploreList(A) {
    const plan = this.world.rts,
      R = this.rts;
    const others = plan.bases.filter((b) => b.owner !== A.team).map((b) => b.pos);
    const pts = others.map((p) => ({ x: p.x, z: p.z, base: true }));
    const rest = [...R.mines, ...R.corals]
      .map((m) => m.pos)
      .filter((p) => hyp(p.x, p.z, A.base.pos.x, A.base.pos.z) > 50);
    const dOther = (p) => Math.min(...others.map((o) => hyp(p.x, p.z, o.x, o.z)));
    rest.sort((a, b) => dOther(a) - dOther(b));
    for (const p of rest) pts.push({ x: p.x, z: p.z });
    return pts;
  },

  // ---------- 每格 ----------
  rtsAiTick(dt) {
    const R = this.rts;
    if (!R || !R.ai || R.over) return;
    for (const A of R.ai) {
      A.t -= dt;
      if (A.t > 0) continue;
      A.t += A.P.dt;
      if (A.t < 0) A.t = A.P.dt;
      if (!R.teams[A.team].alive && !R.units.some((e) => !e.dead && e.rtsTeam === A.team)) continue;
      const t0 = performance.now();
      A.ordMs = 0;
      this.rtsAiThink(A);
      const ms = performance.now() - t0 - A.ordMs;
      A.ordMax = Math.max(A.ordMax, A.ordMs);
      A.ms += (ms - A.ms) * 0.1;
      A.msMax = Math.max(A.msMax, ms);
      A.n++;
    }
  },
  rtsAiThink(A) {
    const S = this.rtsAiScan(A);
    A.res.ore = A.res.coral = 0;
    for (const p of A.pend)
      if (p.o.bid === undefined) {
        const c = RTS_DEFS[p.def].cost;
        A.res.ore += c.ore || 0;
        A.res.coral += c.coral || 0;
      }
    if (A.ultKeepT > this.rts.t) A.res.coral += A.ultKeep; // 終極技的 Coral
    // 上一次決策一定要保留的（升級、英雄、重工廠…）：這一次先保留（rtsAiKeep 再保留時用掉，不重複）
    A.keepC = A.keepN || {};
    A.keepN = {};
    for (const k in A.keepC) {
      A.res.ore += A.keepC[k].ore;
      A.res.coral += A.keepC[k].coral;
    }
    // 各層依序；A.pmax＝各層最長的耗時（毫秒，含 rtsOrder：除錯用）
    const ph = [
      'Intel',
      'HeroQueue', // 英雄的生產與復活（最優先的資源）
      'Economy',
      'Grid', // 導管：停擺時重蓋節點、生產建築的備援（艾瑟立克；補給之後、部隊之前）
      'Tech',
      'Military',
      'Fuse', // 融合（艾瑟立克）
      'Creep',
      'Heroes',
      'UnitAbils',
      'Scout',
    ];
    if (!A.pmax) A.pmax = {};
    if (!A.psum) A.psum = {};
    for (const k of ph) {
      const t0 = performance.now();
      this['rtsAi' + k](A, S);
      const ms = performance.now() - t0;
      if (ms > (A.pmax[k] || 0)) A.pmax[k] = ms;
      A.psum[k] = (A.psum[k] || 0) + ms; // 各層累計（除錯：哪一層花時間）
    }
  },
  // 自己的單位分類；派出去蓋的建築（pend）整理
  rtsAiScan(A) {
    const R = this.rts,
      ro = A.roles;
    const S = {
      all: [],
      workers: [],
      army: [],
      heroes: [], // 活著的英雄（實體）
      blds: [],
      hqs: [], // 蓋好的主堡（回收點）
      count: {}, // 建築數（含工地與派出去蓋的）
      done: {}, // 蓋好的建築數
      inprog: [], // 工地
      queued: {}, // 生產佇列裡的單位數
      mines: [], // 有主堡的礦脈（還有量）
      capSoon: 0, // 工地與派出去蓋的補給建築會給的人口
    };
    for (const e of R.units) {
      if (e.dead || e.rtsTeam !== A.team) continue;
      S.all.push(e);
      const D = defOf(e);
      if (e.bld) {
        S.blds.push(e);
        S.count[e.rtsDef] = (S.count[e.rtsDef] || 0) + 1;
        if (e.bld.progress >= 1) {
          S.done[e.rtsDef] = (S.done[e.rtsDef] || 0) + 1;
          if (D.dropoff) S.hqs.push(e);
        } else {
          S.inprog.push(e);
          S.capSoon += D.popCap || 0;
        }
        for (const q of e.bld.queue) S.queued[q.id] = (S.queued[q.id] || 0) + 1;
      } else if (D.worker) S.workers.push(e);
      else if (e.rtsIllus || e.rtsTemp)
        continue; // 幻象、孵化的臨時實驗體：不指揮（到期就消失）
      else if (e.hero) S.heroes.push(e);
      else if (isArmy(e)) S.army.push(e);
    }
    A.pend = A.pend.filter((p) => {
      const alive = !p.w.dead && p.w.orders.includes(p.o);
      if (alive && p.o.bid === undefined && this.rts.t - p.t > PEND_T) {
        this.rtsAiLog(A, `派去蓋${RTS_DEFS[p.def].name}的工人逾時`);
        this.rtsSetOrders(p.w, []);
        return false;
      }
      return alive && p.o.bid === undefined;
    });
    for (const p of A.pend) {
      S.count[p.def] = (S.count[p.def] || 0) + 1;
      S.capSoon += RTS_DEFS[p.def].popCap || 0;
    }
    for (const m of R.mines) {
      if (m.amount <= 0) continue;
      if (S.hqs.some((h) => hyp(h.pos.x, h.pos.z, m.pos.x, m.pos.z) < MINE_R)) S.mines.push(m);
    }
    S.hq = ro.hq;
    return S;
  },
  // 可以負擔（含這次決策保留的資源）
  // （保留的資源只算這個項目用得到的那一種：不用 Coral 的部隊不會被等 Coral 的建築卡住）
  // keep：true＝算保留的資源、false＝不算、'fresh'＝只算這一次決策新保留的（上一次留下來的保留項目之間不互相擋：
  // 依決策的順序，前面的項目優先）
  rtsAiCan(A, cost, keep = true) {
    const o = cost.ore || 0,
      c = cost.coral || 0;
    let ro = A.res.ore,
      rc = A.res.coral;
    if (keep === 'fresh')
      for (const k in A.keepC || {}) {
        ro -= A.keepC[k].ore;
        rc -= A.keepC[k].coral;
      }
    return this.rtsAfford(A.team, {
      ore: o + (keep && o > 0 ? Math.max(0, ro) : 0),
      coral: c + (keep && c > 0 ? Math.max(0, rc) : 0),
      pop: cost.pop || 0,
    });
  },
  // 一定要保留的（升級主堡、重工廠、英雄）：Coral 還不夠也保留兩種資源（用到 Coral 的生產讓路）
  // key：上一次決策保留的項目（A.keepC[key]）在這一次一開始就算進保留（經濟層比科技層先花錢）；
  // 輪到那個項目時先 rtsAiClaim 拿回來再檢查付不付得起，付不起再 rtsAiKeep
  rtsAiKeep(A, cost, key) {
    A.res.ore += cost.ore || 0;
    A.res.coral += cost.coral || 0;
    if (key) A.keepN[key] = { ore: cost.ore || 0, coral: cost.coral || 0 };
  },
  rtsAiClaim(A, key) {
    const c = A.keepC && A.keepC[key];
    if (!c) return;
    A.res.ore -= c.ore;
    A.res.coral -= c.coral;
    delete A.keepC[key];
  },
  // 建造保留中的項目（先拿回保留、付不起再保留）
  rtsAiBuildKept(A, S, def, key, keepIfPoor = true) {
    this.rtsAiClaim(A, key);
    const ok = this.rtsAiBuild(A, S, def, null, 0, 'fresh');
    if (ok) this.rtsAiLog(A, `蓋${RTS_DEFS[def].name}`);
    if (ok === false && keepIfPoor) this.rtsAiKeep(A, RTS_DEFS[def].cost, key);
    return ok;
  },
  // 保留資源：Coral 還不夠的項目不保留礦石（等 Coral 的期間礦石照常花在部隊上）
  rtsAiReserve(A, cost) {
    const T = this.rts.teams[A.team];
    if ((cost.coral || 0) > T.coral - A.res.coral) return;
    A.res.ore += cost.ore || 0;
    A.res.coral += cost.coral || 0;
  },

  // ---------- 情報（只用迷霧看得到的） ----------
  rtsAiIntel(A, S) {
    const R = this.rts;
    const visN = (A.visN = this.rtsFogEnemies(A.team, true)); // 含野怪（打野、技能）
    const vis = visN.filter((e) => !R.teams[e.rtsTeam] || !R.teams[e.rtsTeam].neutral);
    A.vis = vis;
    A.visArmy = vis.filter(isArmy);
    for (const e of A.visArmy) {
      if (!A.seen.has(e.id)) {
        const D = defOf(e);
        if (D.atk && A.atkKinds[D.atk] !== undefined) A.atkKinds[D.atk]++;
      }
      A.seen.set(e.id, { t: R.t, pow: unitPow(e) });
      if (e.flying) A.enemyAir = R.t;
      // 兵種相剋的權重（docs 14.6）：看過的敵方部隊的護甲類型（人口加權，英雄算 5）
      const D = defOf(e);
      A.armSeen.set(e.id, { t: R.t, arm: e.hero ? 'hero' : D.arm || 'med', pop: e.hero ? 5 : D.pop || 1 });
    }
    if (R.t > (A.armPruneT || 0)) {
      A.armPruneT = R.t + 10;
      for (const [id, s] of A.armSeen) if (R.t - s.t > 180) A.armSeen.delete(id);
      A.counterK = null;
    }
    for (const [id, s] of A.seen) {
      // 90 秒沒看到的忘掉；看著它被擊破的（最後看到之後 3 秒內死掉）也拿掉
      const e = R.t - s.t > 90 ? null : this.rtsEnt(id);
      if (!e || (e.dead && R.t - s.t < 3)) A.seen.delete(id);
    }
    const kn = this.rtsFogKnown(A.team);
    A.known = kn.filter((k) => !k.gone);
    // 對方有導管網（看過導管節點、汲取塔、研究中樞）：進攻時打節點
    if (!A.foeGrid) A.foeGrid = A.known.some((k) => (RTS_DEFS[k.def] || {}).conduit);
    // 確認摧毀的敵方建築（進攻有沒有進展）
    if (!A.bldGone) A.bldGone = new Set();
    for (const k of kn)
      if (k.gone && !A.bldGone.has(k.id)) {
        A.bldGone.add(k.id);
        A.progT = R.t;
      }
    if (vis.some((e) => e.bld)) A.enemySeenT = R.t;
    // 威脅：離自己的建築（或工人）很近的敵方單位
    const th = [];
    for (const e of vis) {
      if (e.bld) continue;
      let near = false;
      for (const b of S.blds)
        if (hyp(e.pos.x, e.pos.z, b.pos.x, b.pos.z) < THREAT_R + Math.max(b.bld.w, b.bld.d) / 2) {
          near = true;
          break;
        }
      if (near) th.push(e);
    }
    A.threat = th;
    A.threatArmy = th.filter(isArmy);
  },

  // ---------- 經濟 ----------
  rtsAiEconomy(A, S) {
    const R = this.rts,
      T = R.teams[A.team],
      P = A.P,
      ro = A.roles;
    const opening = A.si < A.steps.length;
    // 1. 人口快滿：蓋補給庫（開局期間只有快卡住時）
    const facs = (S.done[ro.factory] || 0) + (ro.factory2 ? S.done[ro.factory2] || 0 : 0);
    const rate = 2 + 2 * facs + S.hqs.length;
    const free = T.cap + S.capSoon - T.pop;
    const depBusy =
      S.inprog.filter((b) => b.rtsDef === ro.depot).length + A.pend.filter((p) => p.def === ro.depot).length;
    if (
      T.cap + S.capSoon < RTS_POP_MAX &&
      free < (opening ? 1 : rate * 1.5 + 2) &&
      depBusy < 1 + (facs >= 2 ? 1 : 0) + (T.ore > 600 ? 1 : 0) &&
      S.hqs.length
    )
      this.rtsAiBuild(A, S, ro.depot, null, 0, free >= 3); // 快卡人口：不管保留的資源
    // 2. 開局的步驟
    if (opening) this.rtsAiOpener(A, S);
    // 3. 工人
    const need = 5 * Math.max(1, S.mines.length) + 2;
    const cap = (A.wkCap = Math.min(opening ? A.op.wk0 : P.wkMax, P.wkMax, need));
    let wk = S.workers.length + (S.queued[A.worker] || 0);
    const wc = RTS_DEFS[A.worker].cost;
    for (const h of S.hqs) {
      if (wk >= cap) break;
      if (h.bld.queue.length >= 1) continue;
      if (A.upgWant && h === A.upgHq) continue; // 要升級的主堡不排工人（佇列要空）
      if (!this.rtsAiCan(A, { ...wc, pop: RTS_DEFS[A.worker].pop })) break;
      if (this.rtsQueue(h, A.worker)) wk++;
      if (!h.bld.rally) {
        const m = S.mines.find((q) => hyp(q.pos.x, q.pos.z, h.pos.x, h.pos.z) < MINE_R);
        if (m) this.rtsSmart([h], m.pos.x, m.pos.z, m);
      }
    }
    // 4. 開局之後：分礦、抽取站、兵工廠、主堡重建
    if (!opening || !S.hqs.length) this.rtsAiMacro(A, S);
    // 5. 工人：閒置的去採礦、礦脈之間平衡、被打的拉走、續建、修理
    this.rtsAiWorkers(A, S);
  },
  // 開局步驟：人口到了就蓋（保留資源）；已經有那麼多座就跳過
  rtsAiOpener(A, S) {
    const T = this.rts.teams[A.team];
    while (A.si < A.steps.length) {
      const s = A.steps[A.si];
      const D = RTS_DEFS[s.b];
      const facOver = (s.b === A.roles.factory || s.b === A.roles.factory2) && s.n > A.P.facMax;
      const hqOver = s.b === A.roles.hq && s.n > A.P.hqMax;
      if ((S.count[s.b] || 0) >= s.n || facOver || hqOver || !D) {
        A.si++;
        continue;
      }
      // 人口到了才蓋；工人已經補滿、也沒有在生產時（人口不會再長）提前蓋
      const stalled =
        S.workers.length >= A.wkCap && !S.blds.some((b) => b.bld.progress >= 1 && b.bld.queue.length);
      if (T.pop < s.pop && !stalled) return;
      const ok = s.b === A.roles.hq ? this.rtsAiExpand(A, S) : this.rtsAiBuild(A, S, s.b);
      // 錢不夠：保留資源，下次再試；找不到位置或工人：試幾次之後跳過這一步
      // （要電的建築在等導管節點時不算失敗：節點要 22 秒才長好）
      // （艾瑟立克的 Coral 是瓶頸：礦石夠時連 Coral 一起保留，不然雷射步兵一直把 Coral 花掉、分礦開不出來）
      if (ok === false) {
        if (A.grid && T.ore >= (D.cost.ore || 0)) this.rtsAiKeep(A, D.cost);
        else this.rtsAiReserve(A, D.cost);
      } else if (ok === null && A.needNodeT !== this.rts.t && (s.fail = (s.fail || 0) + 1) > 12) {
        this.rtsAiLog(A, `略過開局步驟：${D.name}`);
        A.si++;
      }
      if ((S.count[s.b] || 0) >= s.n) A.si++;
      if (A.si >= A.steps.length) this.rtsAiLog(A, '開局完成');
      return;
    }
  },
  rtsAiMacro(A, S) {
    const R = this.rts,
      T = R.teams[A.team],
      P = A.P,
      ro = A.roles;
    const hqN = S.count[ro.hq] || 0;
    // 主堡全毀：有工人就重建（最優先）
    if (!S.hqs.length) {
      if (!hqN && S.workers.length) {
        this.rtsAiClaim(A, 'exp');
        if (this.rtsAiExpand(A, S, true, 'fresh') === false) this.rtsAiKeep(A, RTS_DEFS[ro.hq].cost, 'exp');
      }
      return;
    }
    // 抽取站：主堡附近的 Coral 湧出點
    const v = this.rtsAiVent(A, S);
    if (v && R.t > 100 && this.rtsAiCan(A, RTS_DEFS[ro.extractor].cost))
      this.rtsAiBuild(A, S, ro.extractor, v.pos);
    // 分礦：時間到、工人接近飽和或主礦快採完
    const sat = 5 * S.mines.length;
    const low = S.mines.reduce((s, m) => s + m.amount, 0) < 3000 * Math.max(1, S.hqs.length);
    const busy = A.pend.some((p) => p.def === ro.hq) || S.inprog.some((b) => b.rtsDef === ro.hq);
    // 主堡上限只算還有礦可以採的（採完的礦旁邊的主堡不算：後期換到新的礦脈）
    const active = S.hqs.filter((h) =>
      S.mines.some((m) => m.amount > 1500 && hyp(h.pos.x, h.pos.z, m.pos.x, m.pos.z) < MINE_R),
    ).length;
    if (
      !busy &&
      !A.upgWant && // 要升級主堡時先升級（兩個一起保留的話 Coral 要存到 270，兩個都卡住）
      !A.techWant && // T2 之後先蓋重工廠與研究所（Coral 只有抽取站的收入，分礦的 120 Coral 會讓它們晚好幾分鐘）
      active < P.hqMax &&
      (active < 2 || R.t > 600) && // 第三座主堡（後期換到新的礦脈、收入多一份）：10 分鐘以後
      (R.t > P.expandT * A.op.expandK || (low && R.t > 600)) &&
      (S.workers.length >= sat * 0.8 || low || (A.grid && T.ore > 700)) &&
      !A.threatArmy.length
    ) {
      // 分礦和升級主堡一樣保留資源（以前用 rtsAiReserve，Coral 不夠時不保留礦石：部隊一直把礦石花掉，
      // 很多局整場只有一座主堡、7 個工人，後期兩邊都養不起部隊而僵持）
      this.rtsAiClaim(A, 'exp');
      // （其他保留中的項目照算：升級主堡比分礦優先）
      if (this.rtsAiExpand(A, S, false, true) === false) this.rtsAiKeep(A, RTS_DEFS[ro.hq].cost, 'exp');
    }
    // 兵工廠：上限依難度與主堡數；錢多時才蓋（艾瑟立克：兵器廠與培養槽合計，依兵種比例挑一種）
    const facN = (S.count[ro.factory] || 0) + (ro.factory2 ? S.count[ro.factory2] || 0 : 0);
    // 存款一直很多（生產跟不上收入）時多蓋（以前後期常常存著 1000 以上的礦石、部隊卻不多，兩邊僵持）
    const facWant = Math.min(
      P.facMax + (T.ore > 900 ? 1 : 0) + (T.ore > 1600 ? 1 : 0) + (A.grid && T.ore > 3000 ? 2 : 0),
      1 + S.hqs.length + (T.ore > 700 ? 1 : 0) + (A.grid && T.ore > 3000 ? 2 : 0),
    );
    const isFac = (id) => id === ro.factory || (ro.factory2 && id === ro.factory2);
    const facBusy = A.pend.some((p) => isFac(p.def)) || S.inprog.some((b) => isFac(b.rtsDef));
    if (facN < facWant && !facBusy && (facN === 0 || T.ore - A.res.ore > 320))
      this.rtsAiBuild(A, S, this.rtsAiFacPick(A, S));
  },
  // 要多蓋哪一種生產建築（兩種時：目前兵種比例的權重 ÷（座數＋1）大的那種）
  rtsAiFacPick(A, S) {
    const ro = A.roles;
    if (!ro.factory2) return ro.factory;
    const mix = this.rtsAiMix(A);
    const w = (b) => {
      const tr = RTS_DEFS[b].trains || [];
      let n = 0;
      for (const id in mix) if (tr.includes(id)) n += mix[id];
      return n / ((S.count[b] || 0) + 1);
    };
    return w(ro.factory2) > w(ro.factory) ? ro.factory2 : ro.factory;
  },
  // 工人的分配
  rtsAiWorkers(A, S) {
    const R = this.rts;
    const mineOf = (w) => {
      const o = w.orders[0];
      return o && o.k === 'gather' ? o.mine : null;
    };
    const load = new Map();
    for (const m of S.mines) load.set(m.id, 0);
    for (const w of S.workers) {
      const id = mineOf(w);
      if (id && load.has(id)) load.set(id, load.get(id) + 1);
    }
    const bestMine = (w) => {
      let best = null,
        bs = 1e9;
      for (const m of S.mines) {
        const n = load.get(m.id);
        const s = hyp(w.pos.x, w.pos.z, m.pos.x, m.pos.z) + (n >= RTS_GATHER.sat ? 200 + n * 20 : n * 3);
        if (s < bs) ((bs = s), (best = m));
      }
      return best;
    };
    // 被打的工人：附近的部隊打不過時往主堡的另一側躲，之後回去採
    for (const w of S.workers) {
      const ft = A.flee.get(w.id);
      if (ft !== undefined) {
        if (R.t > ft) A.flee.delete(w.id);
        continue;
      }
      const rt = w.rt;
      if (!rt || !rt.hurtBy || rt.hurtBy.dead || R.t - rt.hurtT > 1.5 || w === (A.scout && A.scout.u))
        continue;
      if (!isArmy(rt.hurtBy)) continue;
      const foes = A.visArmy.filter((e) => hyp(e.pos.x, e.pos.z, w.pos.x, w.pos.z) < 30);
      const mine = S.army.filter((e) => hyp(e.pos.x, e.pos.z, w.pos.x, w.pos.z) < 40);
      if (powOf(mine) > powOf(foes) * 1.1) continue; // 部隊在附近：交給部隊
      const h =
        S.hqs.find((q) => hyp(q.pos.x, q.pos.z, w.pos.x, w.pos.z) < 60) ||
        S.blds.find((q) => q.bld.progress >= 1);
      if (!h) continue;
      const src = rt.hurtBy.pos;
      const L = hyp(h.pos.x, h.pos.z, src.x, src.z) || 1;
      const r = Math.max(h.bld.w, h.bld.d) / 2 + 5;
      const nav = this.world.nav;
      const c = nav.nearestCell(
        h.pos.x + ((h.pos.x - src.x) / L) * r,
        h.pos.z + ((h.pos.z - src.z) / L) * r,
        0,
        -1,
        8,
      );
      if (c < 0) continue;
      const p = nav.center(c);
      const back = mineOf(w);
      this.rtsAiOrd(A, [w], { k: 'move', x: p.x, z: p.z });
      if (back) this.rtsAiOrd(A, [w], { k: 'gather', mine: back }, true);
      A.flee.set(w.id, R.t + 6);
    }
    // 閒置的工人
    for (const w of S.workers) {
      if (w.orders.length || A.flee.has(w.id) || (A.scout && A.scout.u === w)) continue;
      const m = bestMine(w);
      if (!m) continue;
      this.rtsAiOrd(A, [w], { k: 'gather', mine: m.id });
      load.set(m.id, load.get(m.id) + 1);
    }
    // 平衡：人太多的礦脈換一個到人少的（每次最多一個）
    if (S.mines.length > 1) {
      let over = null,
        under = null;
      for (const m of S.mines) {
        const n = load.get(m.id);
        if (n > RTS_GATHER.sat + 1 && (!over || n > load.get(over.id))) over = m;
        if (n < RTS_GATHER.sat - 1 && (!under || n < load.get(under.id))) under = m;
      }
      if (over && under) {
        const w = S.workers.find((q) => mineOf(q) === over.id && !(q.carry && q.carry.n));
        if (w) this.rtsAiOrd(A, [w], { k: 'gather', mine: under.id });
      }
    }
    // 工地沒有人施工：派最近的工人續建（自己長的建築不必）
    for (const b of S.inprog) {
      if (b.bld.builders.size || defOf(b).selfBuild) continue;
      if (S.workers.some((w) => w.orders[0] && w.orders[0].k === 'build' && w.orders[0].bid === b.id))
        continue;
      if (this.rtsAiThreatAt(A, b.pos.x, b.pos.z, 25)) continue;
      const w = this.rtsAiPickWorker(A, S, b.pos);
      if (w) this.rtsAiOrd(A, [w], { k: 'build', def: b.rtsDef, x: b.pos.x, z: b.pos.z, bid: b.id });
    }
    // 修理：受損的建築（附近沒有敵方部隊時；工人不能修理的陣營略過：艾瑟立克的建築在導管裡自己回血）
    if ((RTS_DEFS[A.worker] || {}).noRepair) return;
    for (const [id, w] of A.repairs)
      if (w.dead || !w.orders[0] || w.orders[0].k !== 'repair' || w.orders[0].id !== id) A.repairs.delete(id);
    for (const b of S.blds) {
      if (b.bld.progress < 1 || b.hp > b.maxHp * 0.72 || A.repairs.has(b.id)) continue;
      if (A.P.repair === 'hq' && !defOf(b).dropoff) continue;
      if (this.rtsAiThreatAt(A, b.pos.x, b.pos.z, 28)) continue;
      if (R.teams[A.team].ore < 60) break;
      const w = this.rtsAiPickWorker(A, S, b.pos);
      if (!w) break;
      this.rtsAiOrd(A, [w], { k: 'repair', id: b.id });
      A.repairs.set(b.id, w);
    }
  },
  // 可以蓋抽取站的 Coral 湧出點：自己的（地圖的 owner）或離自己的主堡 60 m 內、沒有抽取站、附近沒有敵人
  rtsAiVent(A, S) {
    const plan = this.world.rts,
      T = this.rts.teams[A.team];
    let best = null,
      bs = 1e9;
    this.rts.corals.forEach((v, i) => {
      if (v.amount <= 200 || (v.ext && !v.ext.dead)) return;
      if (A.pend.some((q) => q.def === A.roles.extractor && hyp(q.o.x, q.o.z, v.pos.x, v.pos.z) < 3)) return;
      // 自己的、或 3 分鐘以後自己這一側外圍的（Coral 只有一座抽取站時，升級、英雄、研究都卡在 Coral 上）
      // （艾瑟立克：Coral 是瓶頸，汲取塔又是導管的根（前進基地）——2 分鐘就去拿自己這一側的）
      const own =
        plan.corals[i] &&
        (plan.corals[i].owner === A.team ||
          (plan.corals[i].near === A.team && this.rts.t > (A.grid ? 120 : 180)));
      let d = 1e9;
      for (const h of S.hqs) d = Math.min(d, hyp(h.pos.x, h.pos.z, v.pos.x, v.pos.z));
      // 艾瑟立克、礦石用不完（Coral 卡住）：對方那一側沒人用的湧出點也去拿（不在對方的出生點旁、附近沒有記得的敵方建築）
      const far =
        A.grid &&
        T.ore > 1000 &&
        this.rts.t > 600 &&
        plan.corals[i] &&
        plan.corals[i].owner === null &&
        !plan.bases.some((b) => b.owner !== A.team && hyp(b.pos.x, b.pos.z, v.pos.x, v.pos.z) < 70) &&
        !(A.known || []).some((k) => hyp(k.x, k.z, v.pos.x, v.pos.z) < 45);
      if (!own && !far && d > 60) return;
      if (this.rtsAiThreatAt(A, v.pos.x, v.pos.z, 35)) return;
      if (d < bs) ((bs = d), (best = v));
    });
    return best;
  },
  // 附近有沒有看得到的敵方部隊
  rtsAiThreatAt(A, x, z, r) {
    return A.visArmy.some((e) => hyp(e.pos.x, e.pos.z, x, z) < r);
  },
  // 派工：在採礦、沒有帶礦石、最近的工人（不是偵查的、不在躲）
  rtsAiPickWorker(A, S, p) {
    let best = null,
      bs = 1e9;
    for (const w of S.workers) {
      if (A.flee.has(w.id) || (A.scout && A.scout.u === w)) continue;
      const o = w.orders[0];
      if (o && o.k !== 'gather') continue;
      const s = hyp(w.pos.x, w.pos.z, p.x, p.z) + (w.carry && w.carry.n ? 15 : 0);
      if (s < bs) ((bs = s), (best = w));
    }
    return best;
  },
  // 蓋一座建築（at＝指定位置，例如 Coral 湧出點）；回傳是否派出去了。錢不夠時不派（呼叫端決定要不要保留）
  // keep：rtsAiCan 的保留模式（true；false＝快卡人口的補給庫；'fresh'＝保留中的項目）
  rtsAiBuild(A, S, def, at, yaw = 0, keep = true) {
    const D = RTS_DEFS[def];
    if (!D || this.rtsReqWhy(A.team, D)) return null;
    if (!this.rtsAiCan(A, D.cost, keep)) return false;
    let p = at || null;
    if (!p && D.on === 'coral') {
      const v = this.rtsAiVent(A, S);
      if (!v) return null;
      p = v.pos;
    }
    if (!p && A.grid && def === A.roles.node) p = this.rtsAiNodeSpot(A, S, null);
    if (!p) p = this.rtsAiSpot(A, S, def);
    if (!p) {
      // 要電的建築找不到有電的位置：先找一個不看導管的位置，之後在它旁邊蓋一座導管節點（rtsAiGrid）
      if (A.grid && D.needPower) {
        A.needNodeT = this.rts.t;
        const q = this.rtsAiSpot(A, S, def, true);
        A.wantSpot = q ? { x: q.x, z: q.z, w: D.foot[0], d: D.foot[1], def } : null;
      }
      return null;
    }
    const w = this.rtsAiPickWorker(A, S, p);
    if (!w) return null;
    const o = { k: 'build', def, x: p.x, z: p.z, yaw };
    this.rtsAiOrd(A, [w], o);
    const got = w.orders[0];
    if (!got || got.k !== 'build') return false;
    A.pend.push({ def, w, o: got, t: this.rts.t });
    this.rtsAiReserve(A, D.cost);
    S.count[def] = (S.count[def] || 0) + 1;
    S.capSoon += D.popCap || 0;
    return true;
  },
  // 蓋建築的位置：主基地平台上優先（平台滿了往外、再到分礦旁），四周留通道、不擋主堡與礦脈之間的路、離坡道遠一點
  // noPower＝不看導管（艾瑟立克：找不到有電的位置時，先決定位置、再在旁邊蓋導管節點）
  rtsAiSpot(A, S, def, noPower = false) {
    const nav = this.world.nav,
      D = RTS_DEFS[def];
    const [w, d] = D.foot;
    const cell = nav.cell,
      Sz = this.world.size / 2;
    const snap = (v, s) => Math.round((v - s / 2 + Sz) / cell) * cell - Sz + s / 2;
    const rp = A.base.ramp;
    const lanes = [];
    for (const h of S.hqs)
      for (const m of this.rts.mines)
        if (m.amount > 0 && hyp(h.pos.x, h.pos.z, m.pos.x, m.pos.z) < MINE_R) lanes.push([h.pos, m.pos]);
    const half = Math.max(w, d) / 2;
    const homeHq = S.hqs.some((h) => hyp(h.pos.x, h.pos.z, A.base.pos.x, A.base.pos.z) < A.base.r + 10);
    // 搜尋的中心：主基地（有主堡時）、其他主堡
    const centers = [];
    if (homeHq || !S.hqs.length) centers.push({ c: A.base.pos, R: A.base.r + 26, plat: true });
    for (const h of S.hqs)
      if (hyp(h.pos.x, h.pos.z, A.base.pos.x, A.base.pos.z) > A.base.r + 10)
        centers.push({ c: h.pos, R: 34 });
    // 艾瑟立克：要電的建築只能在有電的範圍裡（導管節點的範圍也是搜尋的中心）
    const pw = A.grid && D.needPower && !noPower;
    const fields = pw ? this.rtsPowerFields(A.team).filter((f) => f.on) : null;
    if (pw)
      for (const f of fields)
        if (!f.root && hyp(f.x, f.z, A.base.pos.x, A.base.pos.z) > A.base.r + 10)
          centers.push({ c: { x: f.x, z: f.z }, R: f.r + 6 });
    if (!pw && !noPower) centers.push({ c: A.rally, R: 40 }); // 都滿了：坡道下
    const k = A.team + ':' + def + (noPower ? ':np' : '');
    if (A.spotFail && A.spotFail[k] > this.rts.t) return null; // 剛剛找不到：過一下再找
    const spin = Math.atan2(A.base.pos.z, A.base.pos.x);
    let best = null,
      bs = 1e9,
      tries = 0;
    centers.forEach(({ c, R: R0, plat }) => {
      if (best) return; // 前面的中心找到了就用（基地優先）
      tries = 0; // 每個中心各自的上限（以前整體 1500 次：主基地滿了的時候後面的中心幾乎沒有試，重工廠這類大建築一直蓋不了）
      for (let r = 8; r <= R0 && tries < 900; r += 4) {
        const n = Math.max(8, Math.round((r * 6.283) / 6));
        for (let i = 0; i < n; i++) {
          // 角度從主基地的方位起算：兩邊的出生點點對稱，所以兩隊找到的位置也點對稱（以前用絕對角度，
          // 兩隊的建築擺法不同：docs 13.18 的隊伍偏差）
          const a = (i / n) * 6.283 + r * 0.37 + spin;
          const x = snap(c.x + Math.cos(a) * r, w),
            z = snap(c.z + Math.sin(a) * r, d);
          tries++;
          const s0 = r;
          if (s0 >= bs) continue;
          if (hyp(x, z, rp.top.x, rp.top.z) < 12 + half || hyp(x, z, rp.bottom.x, rp.bottom.z) < 10 + half)
            continue;
          let blocked = false;
          for (const [h, m] of lanes)
            if (segD(x, z, h.x, h.z, m.x, m.z) < half + 5) {
              blocked = true;
              break;
            }
          if (blocked) continue;
          if (!nav.buildable(x, z, w, d) || !nav.buildable(x, z, w + BLD_PAD, d + BLD_PAD)) continue;
          // 導管：中心要在有電的範圍裡；只被一座節點覆蓋的扣分（備援：那座節點被拆就停擺）
          let pk = 0;
          if (pw) {
            let n = 0,
              root = false;
            for (const f of fields)
              if (hyp(f.x, f.z, x, z) <= f.r) {
                n++;
                if (f.root) root = true;
              }
            if (!n) continue;
            if (!root && n < 2) pk = 8;
          }
          // 主基地：平台上（高度差不多）優先
          const gy = this.world.terrainHeight(x, z);
          const sc = s0 + pk + (plat && Math.abs(gy - A.base.h) > 2 ? 25 : 0);
          if (sc < bs) ((bs = sc), (best = { x, z }));
        }
      }
    });
    if (!best) {
      if (!A.spotFail) A.spotFail = {};
      A.spotFail[k] = this.rts.t + 8;
    }
    return best;
  },
  // 開分礦（或主堡全毀時重建）：自己這一側最近的礦脈（沒有主堡、附近沒有記得的敵方建築）旁
  rtsAiExpand(A, S, rebuild = false, keep = true) {
    const R = this.rts,
      D = RTS_DEFS[A.roles.hq];
    if (!this.rtsAiCan(A, D.cost, keep)) return false;
    if (R.t < (A.expT || 0)) return null; // 上一次派出去的工人沒蓋成：等一下再試
    const plan = this.world.rts;
    const own = S.blds.filter((b) => defOf(b).dropoff);
    let best = null,
      bs = 1e9;
    R.mines.forEach((m, i) => {
      if (m.amount < 2500) return;
      if (own.some((h) => hyp(h.pos.x, h.pos.z, m.pos.x, m.pos.z) < MINE_R + 6)) return;
      if ((A.known || []).some((k) => hyp(k.x, k.z, m.pos.x, m.pos.z) < 45)) return;
      if (this.rtsAiThreatAt(A, m.pos.x, m.pos.z, 40)) return;
      const pm = plan.mines[i] || {};
      // 出生點候選（別人的主礦）不去
      if (pm.kind === 'main' && pm.owner !== A.team && !rebuild) return;
      const s =
        hyp(m.pos.x, m.pos.z, A.base.pos.x, A.base.pos.z) +
        (pm.owner === A.team ? 0 : pm.near === A.team ? 30 : 90) +
        (pm.kind === 'main' && pm.owner === A.team ? -50 : 0);
      if (s < bs) ((bs = s), (best = m));
    });
    if (!best) return null;
    const p = this.rtsFindSpot(A.roles.hq, best.pos, best.pos, 26);
    if (!p || !this.world.nav.buildable(p.x, p.z, D.foot[0], D.foot[1])) return null;
    const ok = this.rtsAiBuild(A, S, A.roles.hq, p, 0, keep);
    if (!ok) return ok;
    A.expT = R.t + 25;
    this.rtsAiLog(A, rebuild ? '重建主堡' : '開分礦');
    return true;
  },

  // ---------- 軍事 ----------
  rtsAiMilitary(A, S) {
    const R = this.rts,
      P = A.P;
    this.rtsAiTrain(A, S);
    const army = S.army.filter((e) => e !== (A.scout && A.scout.u));
    for (const id of A.atk) {
      const e = this.rtsEnt(id);
      if (!e || e.dead) A.atk.delete(id);
    }
    const cu = A.creep ? A.creep.units : null;
    const hu = A.har ? A.har.ids : null;
    const atk = army.filter((e) => A.atk.has(e.id));
    // 留守：不含融合中的（集合、引導）與騷擾中的
    const home = army.filter(
      (e) => !A.atk.has(e.id) && !(cu && cu.has(e.id)) && !(hu && hu.has(e.id)) && !e.rtsFusing,
    );
    S.home = home;
    S.atk = atk;
    this.rtsAiHarass(A, S, home);
    // 生產建築的集結點：坡道口
    for (const b of S.blds)
      if (b.bld.progress >= 1 && !b.bld.rally && isProducer(b))
        this.rtsSmart([b], A.rally.x, A.rally.z, null);
    // 基地被攻擊：回防（威脅大於留守的部隊時召回進攻中的部隊）
    const thPow = powOf(A.threatArmy);
    const threatened = A.threat.length > 0;
    if (threatened) {
      const tc = centroid(A.threat);
      // 被攻擊的次數（30 秒內算同一次）與方向（防禦塔蓋在那一側）
      if (A.threatArmy.length && R.t - A.lastThT > 30) {
        A.defEp++;
        const hq = S.hqs[0];
        if (hq) A.thDir = { x: tc.x - hq.pos.x, z: tc.z - hq.pos.z };
      }
      if (A.threatArmy.length) A.lastThT = R.t;
      this.rtsAiMilitia(A, S, home, tc, thPow);
      let defenders = home;
      if (A.mode === 'attack' && P.recall && A.threatArmy.length && thPow > powOf(home) * 0.9) {
        const ac = centroid(atk);
        if (!ac || hyp(ac.x, ac.z, tc.x, tc.z) > 60) {
          defenders = army;
          this.rtsAiEndAttack(A, '回防');
        }
      }
      let tgt = A.dfocus && this.rtsEnt(A.dfocus);
      if (!tgt || tgt.dead || !A.threat.includes(tgt) || this.rtsAiFocusStale(A, tgt))
        tgt = this.rtsAiFocusPick(A, tc, A.threat);
      A.dfocus = tgt ? tgt.id : null;
      const go = [],
        hit = [];
      for (const u of defenders) {
        if (A.atk.has(u.id) || this.rtsAiWalled(A, u)) continue;
        const o = u.orders[0];
        if (P.focus && tgt && hyp(u.pos.x, u.pos.z, tgt.pos.x, tgt.pos.z) < 40) {
          if (!(o && o.k === 'attack' && o.id === tgt.id)) hit.push(u);
        } else if (!o || (o.k === 'amove' && hyp(o.x, o.z, tc.x, tc.z) > 15) || o.k === 'move') go.push(u);
      }
      if (hit.length) this.rtsAiOrd(A, hit, { k: 'attack', id: tgt.id });
      if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: tc.x, z: tc.z });
      A.defT = R.t;
    } else if (home.length) {
      if (A.milOn) this.rtsAiMilitia(A, S, home, null, 0);
      // 集結：沒有指令、或防守結束還在外面的回到坡道口
      const idle = home.filter(
        (u) =>
          !u.orders.length && hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) > 14 && !this.rtsAiWalled(A, u),
      );
      if (idle.length) this.rtsAiOrd(A, idle, { k: 'amove', x: A.rally.x, z: A.rally.z });
    }
    if (A.mode === 'attack') this.rtsAiAttackTick(A, S, atk, home);
    else if ((!threatened || !A.threatArmy.length) && !A.creep && !A.har) this.rtsAiMaybeAttack(A, S, home);
  },
  // 生產部隊：每座生產建築的佇列保持 1 項（依開局的比例：T1＝mix、T2＝mix2、T3＝mix3；Coral 不夠時生產不用 Coral 的）
  rtsAiTrain(A, S) {
    const mix = this.rtsAiMix(A);
    let n = S.army.length + Object.keys(S.queued).reduce((s, k) => s + (isArmyDef(k) ? S.queued[k] : 0), 0);
    // （融合掉的實驗體：嵌合體算 3 隻、原型體算 6 隻，兵種比例才不會一直補實驗體）
    const fusedEq = { a_blob: { a_chimera: 3, a_proto: 6 } };
    const have = (id) => {
      let n = S.queued[id] || 0;
      const fe = fusedEq[id];
      for (const e of S.army) n += e.rtsDef === id ? 1 : fe && fe[e.rtsDef] ? fe[e.rtsDef] : 0;
      return n;
    };
    for (const b of S.blds) {
      const qMax = this.rts.teams[A.team].ore > 800 ? 2 : 1; // 錢多時佇列放兩項（不中斷）
      if (b.bld.progress < 1 || !isProducer(b) || b.bld.queue.length >= qMax) continue;
      if (n >= this.rtsAiArmyCap(A)) return;
      // 比例最低的兵種（這座建築能生產、需求滿足的）
      const tr = RTS_DEFS[b.rtsDef].trains || [];
      const opts = Object.keys(mix)
        .filter((id) => mix[id] > 0 && tr.includes(id) && !this.rtsReqWhy(A.team, RTS_DEFS[id]))
        .sort((a, c) => have(a) / mix[a] - have(c) / mix[c]);
      for (const id of opts) {
        const U = RTS_DEFS[id];
        if (!this.rtsAiCan(A, { ...U.cost, pop: U.pop })) continue;
        if (this.rtsQueue(b, id)) {
          S.queued[id] = (S.queued[id] || 0) + 1;
          n++;
        }
        break;
      }
    }
  },
  // 兵種比例：依層級；看到對方的空中單位時加重對空（MT 地空都打、裝甲車有對空的加特林）
  // （R3）兩個陣營都乘兵種相剋的權重（rtsAiCounterK：看過的敵方護甲）；艾瑟立克的對空是雷射步兵、浮游砲機
  rtsAiMix(A) {
    const tier = this.rtsTier(A.team),
      op = A.op,
      cas = A.fac === 'castron';
    let mix =
      tier >= 3 && op.mix3
        ? op.mix3
        : tier >= 2 && op.mix2
          ? op.mix2
          : A.si < A.steps.length || !cas
            ? op.mix
            : { ...op.mix, c_shield: Math.max(1, op.mix.c_shield || 0) };
    mix = { ...mix };
    if (this.rts.t - A.enemyAir < 120) {
      if (cas) {
        mix.c_mt = (mix.c_mt || 0) + 1;
        if (tier >= 2) mix.c_tank = (mix.c_tank || 0) + 1;
      } else {
        mix.a_laser = (mix.a_laser || 0) + 1;
        if (tier >= 3) mix.a_bit = (mix.a_bit || 0) + 0.5;
      }
    }
    // 艾瑟立克：礦石多、Coral 不夠（Coral 是瓶頸）時多生產實驗體（Coral 佔得最少：50／10）
    if (!cas && this.rtsHasBld(A.team, 'a_lab')) {
      const T = this.rts.teams[A.team];
      if (T.ore > 600 && T.coral < 80) mix.a_blob = (mix.a_blob || 0) + (T.ore > 2000 ? 6 : 2);
    }
    const K = this.rtsAiCounterK(A);
    for (const id in mix) {
      const D = RTS_DEFS[id];
      if (D && D.atk && K[D.atk] !== undefined) mix[id] *= K[D.atk];
    }
    return mix;
  },
  // 部隊上限：難度的 armyMax；allInT 之後 ×1.6、資源存很多時 +8（後期打破僵局）
  rtsAiArmyCap(A) {
    const P = A.P,
      R = this.rts;
    return Math.round(P.armyMax * (R.t > P.allInT ? 1.6 : 1) + (R.teams[A.team].ore > 2000 ? 8 : 0));
  },
  // 該不該進攻：時間與部隊門檻，或偵查到對方弱
  rtsAiMaybeAttack(A, S, home) {
    const R = this.rts,
      P = A.P,
      T = R.teams[A.team];
    if (R.t < A.cool) return;
    // 可以出動的：集結點附近的，加上沒有在交戰（攻擊指令）的留守部隊（融合中的不算）
    const ready = home.filter(
      (u) =>
        !u.rtsFusing &&
        (hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) < 40 || !(u.orders[0] && u.orders[0].k === 'attack')),
    );
    const n = ready.length;
    let need = A.need;
    // allInT 之後門檻降低（打破僵局），但不低於部隊上限的 35%（一次 5 台陸續送上去只是送給對方的防禦塔與英雄）
    if (R.t > P.allInT) need = Math.min(need, Math.max(P.allInN, Math.round(this.rtsAiArmyCap(A) * 0.35)));
    let why = null;
    if (R.t >= A.attackT && n >= need) why = `部隊 ${n} 台`;
    else if (T.pop >= RTS_POP_MAX - 6 && n >= 4) why = '人口已滿';
    else if (A.resumeT && R.t - A.resumeT < 20 && n >= 3) why = '清完路上的營地，繼續進攻';
    else if (R.t >= A.attackT && T.ore - A.res.ore > 1500 && n >= need * 0.6) why = '存款很多';
    else if (
      R.t >= A.attackT * 0.8 &&
      n >= 4 &&
      R.t - A.lastThT > 4 &&
      R.t - A.lastThT < 30 &&
      A.defEp > 0 &&
      this.rtsAiSeenPow(A) ** 2 * 1.3 < (powOf(ready) + powOf(S.heroes)) ** 2
    )
      why = '反擊（擋下對方的進攻）'; // 剛擋下進攻、對方的部隊損失慘重：趁對方重整之前打回去
    else if (R.t >= A.attackT && n >= Math.min(need, 5) && R.t - A.enemySeenT < 90) {
      // 對方的部隊（最近 90 秒看過的）明顯比較弱
      let ep = 0;
      for (const s of A.seen.values()) ep += s.pow;
      if (ep * ep * 2.5 < powOf(ready) ** 2) why = '偵查到對方兵力薄弱';
    }
    if (!why) return;
    // 艾瑟立克：出發前先把集結中的實驗體融合（引導約 4 秒；融合中的不跟著出發，下一次決策再出發）
    if (A.grid && R.t > (A.preFuseT || 0) && this.rtsAiFuse(A, S, true) > 0) {
      A.preFuseT = R.t + 40;
      return;
    }
    // 路上有野怪營地：先帶著這支部隊（和英雄）把它清掉再進攻（打不過的營地就照樣進攻）
    const obj0 = this.rtsAiObjective(A, centroid(ready));
    if (obj0 && R.t > (A.blockT || 0)) {
      A.blockT = R.t + 20; // 找路徑（A*）不要每次決策都做
      const camp = this.rtsAiBlockingCamp(A, centroid(ready), this.rtsAiWalk(obj0.x, obj0.z));
      if (camp && powOf(ready) + powOf(S.heroes) > this.rtsAiCampPow(A, camp) * 1.8) {
        // 部隊出發了：算第一次進攻的時間（只是先清掉路上的營地）
        if (A.firstAtk === null) A.firstAtk = R.t;
        this.rtsAiCreepStart(A, S, camp, ready, `出發進攻（${why}），先清除路上的營地`, 'attack');
        return;
      }
    }
    A.mode = 'attack';
    A.atkStart = R.t;
    A.atkK0 = R.stats[A.team].killed;
    A.atkL0 = R.stats[A.team].lost;
    A.atkN = n;
    A.focus = null;
    for (const u of ready) A.atk.add(u.id);
    A.obj = this.rtsAiObjective(A, centroid(ready));
    A.waves++;
    if (A.firstAtk === null) A.firstAtk = R.t;
    this.rtsAiLog(A, `進攻 #${A.waves}：${why}${A.obj && A.obj.explore ? '（搜索）' : ''}`);
    this.rtsAiSendTo(A, ready, A.obj);
    // 英雄一起出發（之後由 rtsAiHeroes 跟在部隊的中後方）
    const hs = S.heroes.filter((h) => !A.hj.has(h.id) && !h.rtsPiloted);
    if (hs.length && A.obj && A.obj.ax !== undefined) this.rtsAiSendRoute(A, hs, A.obj);
  },
  // 最近 90 秒看過、還活著（就我們所知）的敵方部隊的戰力
  rtsAiSeenPow(A) {
    let ep = 0;
    for (const s of A.seen.values()) ep += s.pow;
    return ep;
  },
  // 進攻目標：記得的敵方建築（離部隊最近、主堡優先一點）；不知道時依序搜索
  rtsAiObjective(A, from) {
    from = from || A.rally;
    let best = null,
      bs = 1e9;
    // （R3）導管節點與汲取塔依會讓幾座建築停擺加權（每座 25，最多 100）；
    // 拆建築弱的陣營（艾瑟立克：能量對城甲 ×0.5）在有共振砲之前先打分礦（不在對方出生點的主堡）
    const weak = this.rtsAiWeakSiege(A);
    const mainOf = (k) =>
      this.world.rts.bases.some((b) => b.owner !== A.team && hyp(k.x, k.z, b.pos.x, b.pos.z) < b.r + 25);
    for (const k of A.known || []) {
      const D = RTS_DEFS[k.def] || {};
      let s = hyp(k.x, k.z, from.x, from.z) - (D.trains && D.trains.length ? 15 : 0);
      if (D.conduit) s -= Math.min(100, 25 * this.rtsAiDeps(A, k));
      if (weak) s += mainOf(k) ? 60 : D.dropoff ? -40 : 0;
      if (s < bs) ((bs = s), (best = k));
    }
    // 對方的出生點候選（地圖公開的）還沒去過、附近也不記得任何建築：主基地多半在那裡（高台上，從台下看不到；
    // 以前只記得分礦與外圍的建築時一直打外圍，主基地一直沒被發現，後期拖很久）
    let bi = -1;
    A.explore.forEach((p, i) => {
      if (!p.base || A.visited.has(i)) return;
      if ((A.known || []).some((k) => hyp(k.x, k.z, p.x, p.z) < 35)) return;
      const s = hyp(p.x, p.z, from.x, from.z) - 40;
      if (s < bs) ((bs = s), (bi = i), (best = null));
    });
    if (bi >= 0) return { x: A.explore[bi].x, z: A.explore[bi].z, explore: bi, base: true, r: 0 };
    if (best)
      return { x: best.x, z: best.z, id: best.id, r: Math.max(...(RTS_DEFS[best.def].foot || [8])) / 2 };
    const left = A.explore.filter((p, i) => !A.visited.has(i));
    if (!left.length) A.visited.clear();
    const i = A.explore.findIndex((p, j) => !A.visited.has(j));
    if (i < 0) return null;
    const p = A.explore[i];
    return { x: p.x, z: p.z, explore: i, r: 0 };
  },
  // 下攻擊移動：建築＝它旁邊、和它同一個高度（不在斷崖下：低處看不到高處、打不到）、離部隊近的可以走的位置
  rtsAiSendTo(A, units, obj) {
    if (!obj || !units.length) return;
    const p = obj.r ? this.rtsAiApproach(obj.x, obj.z, obj.r, centroid(units)) : this.rtsAiWalk(obj.x, obj.z);
    obj.ax = p.x;
    obj.az = p.z;
    this.rtsAiSendRoute(A, units, obj);
  },
  // 進攻的攻擊移動：nc＝不主動去打待在營地裡的野怪（mech-rts.js 的 rtsScan；營地出動或被打時照樣還手）。
  // 以前攻擊移動經過營地就會和野怪打起來，常常整支部隊在半路被營地消耗掉
  rtsAiSendRoute(A, units, obj) {
    this.rtsAiOrd(A, units, { k: 'amove', x: obj.ax, z: obj.az, nc: true });
  },
  rtsAiWalk(x, z) {
    const nav = this.world.nav;
    const q = nav.nearestCell(x, z, 1, -1, 12);
    return q >= 0 ? nav.center(q) : { x, z };
  },
  // 建築（中心 x, z、半徑 r）旁邊、和它同一個高度、離 from 近的可以走的位置
  rtsAiApproach(x, z, r, from) {
    const nav = this.world.nav,
      w = this.world;
    const by = w.terrainHeight(x, z);
    let bs = 1e9,
      bx = x,
      bz = z;
    for (const rr of [r + 6, r + 11])
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * 6.283;
        const px = x + Math.cos(a) * rr,
          pz = z + Math.sin(a) * rr;
        const q = nav.cellOf(px, pz);
        if (q < 0 || !nav.walkable(q, 1)) continue;
        if (Math.abs(w.terrainHeight(px, pz) - by) > 2.5) continue;
        const s = hyp(px, pz, from.x, from.z) + rr;
        if (s < bs) ((bs = s), (bx = px), (bz = pz));
      }
    return this.rtsAiWalk(bx, bz);
  },
  rtsAiEndAttack(A, why) {
    A.mode = 'home';
    A.atk.clear();
    A.obj = null;
    A.focus = null;
    this.rtsAiLog(A, `結束進攻：${why}`);
  },
  // 進攻中：目標換新、集火、撤退、撤回受傷單位、增援
  rtsAiAttackTick(A, S, atk, home) {
    const R = this.rts,
      P = A.P;
    if (!atk.length || atk.length < Math.max(1, Math.round(A.atkN * 0.2))) {
      // 打光了：下一次門檻提高
      for (const u of atk) this.rtsAiOrd(A, [u], { k: 'move', x: A.rally.x, z: A.rally.z });
      A.need = Math.min(Math.round(P.armyMax * 0.7), A.need + P.grow);
      A.cool = R.t + 15;
      this.rtsAiEndAttack(A, `部隊損失（剩 ${atk.length}）`);
      return;
    }
    const c = centroid(atk);
    // 膠著：3.5 分鐘沒有拆掉任何建築、而且交換比不好（擊破 < 損失 × 1.2）：撤回集結，下一次帶更多部隊
    const st = R.stats[A.team];
    if (R.t - Math.max(A.atkStart, A.progT || 0) > 210) {
      const k = st.killed - (A.atkK0 || 0),
        l = st.lost - (A.atkL0 || 0);
      if (k < l * 1.2) {
        this.rtsAiOrd(A, atk, { k: 'move', x: A.rally.x, z: A.rally.z });
        A.need = Math.min(
          Math.round(this.rtsAiArmyCap(A) * 0.9),
          Math.max(A.need, Math.round(atk.length * 1.3)),
        );
        A.cool = R.t + 20;
        this.rtsAiEndAttack(A, `膠著（擊破 ${k}、損失 ${l}）`);
        return;
      }
      A.progT = R.t; // 交換比還好：再打一陣子
      A.atkK0 = st.killed;
      A.atkL0 = st.lost;
    }
    // 戰力比較（視野內）：部隊附近的敵方部隊 vs 離那群敵人不遠的我方部隊
    const foes = A.visArmy.filter((e) => atk.some((u) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < NEAR_R));
    const fc = centroid(foes);
    // 我方：離那群敵人 70 m 內的（部隊拉成一長列時，先接觸的少數不代表整支部隊：以前前鋒一碰到就整支撤退）
    const ours = fc ? atk.filter((e) => hyp(e.pos.x, e.pos.z, fc.x, fc.z) < 70) : atk;
    const fp = powOf(foes),
      op = powOf(ours);
    const allIn = R.t > P.allInT;
    if (P.retreat > 0 && !allIn && foes.length >= 2 && fp * fp > op * op * P.retreat) {
      this.rtsAiOrd(A, atk, { k: 'move', x: A.rally.x, z: A.rally.z });
      A.need = Math.min(Math.round(P.armyMax * 0.7), A.need + P.grow);
      A.cool = R.t + 25;
      this.rtsAiEndAttack(A, `撤退（戰力 ${op.toFixed(0)} 對 ${fp.toFixed(0)}）`);
      return;
    }
    // 撤回受傷的單位（困難以上）
    if (P.pull && foes.length) {
      for (const u of atk)
        if (u.hp < u.maxHp * 0.3 && foes.some((e) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < 30)) {
          A.atk.delete(u.id);
          this.rtsAiOrd(A, [u], { k: 'move', x: A.rally.x, z: A.rally.z });
        }
    }
    const live = atk.filter((u) => A.atk.has(u.id));
    // 路上被野怪營地纏住（營地出動了）：整支部隊先把那個營地清掉（在營地集火；邊走邊打的話野怪回營就回滿血）
    if (R.t > (A.campChkT || 0)) {
      A.campChkT = R.t + 2;
      const eng = (A.visN || []).find(
        (e) =>
          e.creep &&
          (R.camps || []).some(
            (q) => q.id === e.creep && q.st === 'fight' && !q.cleared && !A.campDone.has(q.id),
          ) &&
          live.some((u) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < 30),
      );
      const camp = eng && (R.camps || []).find((q) => q.id === eng.creep);
      if (camp && !A.creep && powOf(live) + powOf(S.heroes) > this.rtsAiCampPow(A, camp) * 1.5) {
        this.rtsAiEndAttack(A, '路上遇到野怪營地');
        this.rtsAiCreepStart(A, S, camp, live, '清除路上的營地', 'attack');
        return;
      }
    }
    // 目標：建築已經確認沒了、或搜索點到了 → 換下一個
    let obj = A.obj;
    if (obj && obj.id !== undefined && !(A.known || []).some((k) => k.id === obj.id)) obj = null;
    if (obj && obj.explore !== undefined) {
      if ((A.known || []).length && !obj.base) obj = null;
      else if (hyp(c.x, c.z, obj.x, obj.z) < 22) {
        A.visited.add(obj.explore);
        obj = null;
      }
    }
    if (!obj) {
      obj = A.obj = this.rtsAiObjective(A, c);
      A.focus = null;
      if (!obj) return;
      this.rtsAiSendTo(A, live, obj);
    }
    // 集火：部隊附近看得到的敵人裡最好打的（打了一陣子血量沒有掉的換別的）
    // （出動中的野怪也算：路上被營地纏住時集火打掉，不然各打各的、野怪回營又回滿血）
    const camps = R.camps || [];
    const near = (A.visN || A.vis).filter(
      (e) =>
        !e.rtsInv &&
        (!e.creep || camps.some((q) => q.id === e.creep && q.st !== 'idle')) &&
        live.some((u) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < 32),
    );
    // 兵力壓倒性（戰力² 6 倍以上）時集火建築：不要一直和對方陸續生產出來的單位纏鬥
    // （附近沒有建築時不理會零星的單位，繼續往目標前進：攻擊移動沿路會自己迎擊）
    const crush = op * op > fp * fp * 4 && live.length >= 6;
    const pool = crush ? near.filter((e) => e.bld) : near;
    // 壓倒性而且附近有好幾座建築：分頭拆（最多三座，每台去離自己最近的那座）
    if (crush && P.focus && pool.length >= 2 && live.length >= 10) {
      // （R3）第一組先拆會讓建築停擺的導管節點
      const dep = (b) => this.rtsAiDepsOf(A, b);
      const tb = pool
        .slice()
        .sort(
          (a, b) =>
            hyp(a.pos.x, a.pos.z, c.x, c.z) - 30 * dep(a) - (hyp(b.pos.x, b.pos.z, c.x, c.z) - 30 * dep(b)),
        )
        .slice(0, 3);
      if (!A.apps) A.apps = new Map();
      const grp = new Map();
      for (const u of live) {
        let bb = tb[0],
          bd = 1e9;
        for (const b of tb) {
          const d = hyp(u.pos.x, u.pos.z, b.pos.x, b.pos.z);
          if (d < bd) ((bd = d), (bb = b));
        }
        if (!grp.has(bb)) grp.set(bb, []);
        grp.get(bb).push(u);
      }
      for (const [b, us] of grp) {
        let ap = A.apps.get(b.id);
        if (!ap)
          A.apps.set(b.id, (ap = this.rtsAiApproach(b.pos.x, b.pos.z, Math.max(b.bld.w, b.bld.d) / 2, c)));
        const o = (u) => u.orders[0];
        const go = us.filter(
          (u) => !(o(u) && o(u).k === 'amove' && Math.abs(o(u).x - ap.x) < 1 && Math.abs(o(u).z - ap.z) < 1),
        );
        if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: ap.x, z: ap.z, nc: true });
      }
      A.focus = null;
      this.rtsAiReinforce(A, home, obj);
      return;
    }
    let tgt = null;
    if (P.focus && pool.length) {
      const f = A.focus && this.rtsEnt(A.focus);
      tgt = f && !f.dead && pool.includes(f) && !this.rtsAiFocusStale(A, f) ? f : null;
      if (!tgt) tgt = this.rtsAiFocusPick(A, centroid(live), pool);
      A.focus = tgt ? tgt.id : null;
    }
    // 盾牌 MT 擋住（正面打不進去）：部隊分兩半從左右兩側繞過去打（盾只擋正面 ±70°）
    if (R.t < (A.flankT || 0)) return this.rtsAiReinforce(A, home, obj);
    if (tgt && defOf(tgt).ai === 'shield' && R.t < (A.shieldT || 0) && live.length >= 6) {
      const cc = centroid(live);
      const L = hyp(tgt.pos.x, tgt.pos.z, cc.x, cc.z) || 1;
      const dx = (tgt.pos.x - cc.x) / L,
        dz = (tgt.pos.z - cc.z) / L;
      const sides = [[], []];
      for (const u of live) sides[(u.pos.x - cc.x) * -dz + (u.pos.z - cc.z) * dx > 0 ? 0 : 1].push(u);
      [1, -1].forEach((sg, i) => {
        if (!sides[i].length) return;
        const p = this.rtsAiWalk(tgt.pos.x - dz * sg * 20 - dx * 4, tgt.pos.z + dx * sg * 20 - dz * 4);
        this.rtsAiOrd(A, sides[i], { k: 'move', x: p.x, z: p.z });
        this.rtsAiOrd(A, sides[i], { k: 'attack', id: tgt.id }, true);
      });
      A.flankT = R.t + 14;
      A.shieldT = 0;
      this.rtsAiLog(A, '盾牌擋住：分兩側包抄');
      return this.rtsAiReinforce(A, home, obj);
    }
    const hit = [],
      go = [],
      near2 = [];
    // 集火建築：走到它旁邊同一個高度的位置（攻擊移動，到了自己開火）；直接下攻擊的話從斷崖下打不到又不會繞上去
    let bp = null;
    if (tgt && tgt.bld) {
      if (!A.bApp || A.bApp.id !== tgt.id)
        A.bApp = {
          id: tgt.id,
          ...this.rtsAiApproach(tgt.pos.x, tgt.pos.z, Math.max(tgt.bld.w, tgt.bld.d) / 2, c),
        };
      bp = A.bApp;
    }
    for (const u of live) {
      if (this.rtsAiWalled(A, u)) continue; // 盾牆中（附近有敵人）
      const o = u.orders[0];
      if (tgt && hyp(u.pos.x, u.pos.z, tgt.pos.x, tgt.pos.z) < 42) {
        if (bp) {
          if (!(o && o.k === 'amove' && Math.abs(o.x - bp.x) < 1 && Math.abs(o.z - bp.z) < 1)) near2.push(u);
        } else if (!(o && o.k === 'attack' && o.id === tgt.id)) hit.push(u);
        continue;
      }
      // 打的目標看不到了、或沒有指令：回到攻擊移動
      const lost =
        o &&
        o.k === 'attack' &&
        (!this.rtsVisible(A.team, this.rtsEnt(o.id)) || (A.focusBan && A.focusBan.get(o.id) > R.t));
      const stray = crush && o && o.k === 'attack' && !(this.rtsEnt(o.id) || {}).bld;
      if (!o || lost || stray || o.k === 'move') go.push(u);
    }
    if (hit.length) this.rtsAiOrd(A, hit, { k: 'attack', id: tgt.id });
    if (near2.length) this.rtsAiOrd(A, near2, { k: 'amove', x: bp.x, z: bp.z, nc: true });
    if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: obj.ax, z: obj.az, nc: true });
    this.rtsAiReinforce(A, home, obj);
  },
  // 增援：坡道口累積的部隊成群加入進攻
  rtsAiReinforce(A, home, obj) {
    const ready = home.filter((u) => !u.orders.length && hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) < 20);
    if (ready.length >= (A.P.focus ? 3 : 4) && !A.threat.length) {
      for (const u of ready) A.atk.add(u.id);
      this.rtsAiSendRoute(A, ready, obj);
    }
  },
  // 集火的目標：會還手的部隊優先（血量低的、近的）；正面大盾的盾牌 MT 與建築其次（建築大、一定打得中）；
  // 工人最後（小、會跑，機槍打不太中）。打了一陣子血量沒有掉的（被擋住、打不到）暫時不選
  rtsAiFocusPick(A, c, list) {
    const R = this.rts;
    // 拆建築弱的（艾瑟立克在有共振砲之前）：部隊與工人優先、建築最後
    const weak = this.rtsAiWeakSiege(A);
    // 盾牌 MT 擋在前面（後面的打不到、一直換目標）：先打盾牌
    const shieldFirst = R.t < (A.shieldT || 0);
    // 被自己標定的目標（困難以上集火：受到的傷害較高）
    const marks = A.P.markFocus && R.hfx && R.hfx.marks ? R.hfx.marks : null;
    let best = null,
      bs = 1e9;
    for (const e of list) {
      if (e.dead || !this.rtsVisible(A.team, e)) continue;
      const ban = A.focusBan && A.focusBan.get(e.id);
      if (ban && ban > R.t) continue;
      const D = defOf(e);
      const s =
        hyp(e.pos.x, e.pos.z, c.x, c.z) * 0.6 +
        (e.bld
          ? (weak ? 220 : 120) +
            e.hp / 100 +
            (D.trains && D.trains.length ? -15 : 0) -
            (D.conduit ? Math.min(60, 20 * this.rtsAiDepsOf(A, e)) : 0)
          : D.worker
            ? (weak ? 110 : 200) + e.hp / 40
            : D.ai === 'shield'
              ? (shieldFirst ? 0 : 150) + e.hp / 40
              : (shieldFirst ? 150 : 0) + e.hp / 40) -
        (marks && marks.some((m) => m.t === e && m.team === A.team && m.until > R.t) ? 300 : 0);
      if (s < bs) ((bs = s), (best = e));
    }
    if (best && best.id !== A.focusId) {
      A.focusId = best.id;
      A.focusHp = best.hp;
      A.focusT = R.t;
    }
    return best;
  },
  // 技能可以動用多少保留中的 Coral：一般 60；艾瑟立克派出去蓋的建築要 Coral 時 0（工人走到工地時 Coral 不夠就蓋不成）
  rtsAiDip(A) {
    if (!A.grid) return 60;
    for (const p of A.pend) if ((RTS_DEFS[p.def].cost.coral || 0) > 0) return 0;
    return 30;
  },
  // 拆建築弱（主力是能量：對城甲 ×0.5）而且還沒有攻城的兵種（共振砲）：先打部隊、工人與分礦（docs 14.6）
  rtsAiWeakSiege(A) {
    const R = this.rts;
    // （15 分鐘以後一律照常：拖到後期時拆建築才分得出勝負）
    if (A.fac !== 'aetheric' || A.foeGrid || R.t > 900) return false;
    if (A.wsT === R.t) return A.ws;
    A.wsT = R.t;
    return (A.ws = !R.units.some((e) => !e.dead && e.rtsTeam === A.team && e.rtsDef === 'a_reson'));
  },
  // 集火的目標打了 7 秒血量掉不到 4%：換別的（12 秒內不選）
  rtsAiFocusStale(A, e) {
    const R = this.rts;
    if (A.focusId !== e.id) {
      A.focusId = e.id;
      A.focusHp = e.hp;
      A.focusT = R.t;
      return false;
    }
    if (e.hp < A.focusHp - e.maxHp * 0.04) {
      A.focusHp = e.hp;
      A.focusT = R.t;
      return false;
    }
    if (R.t - A.focusT < 7) return false;
    if (!A.focusBan) A.focusBan = new Map();
    A.focusBan.set(e.id, R.t + 12);
    // 短時間內換了兩次：大概是被盾牌擋住，接下來 30 秒先打盾牌
    if (R.t - (A.banT || -99) < 25) A.shieldT = R.t + 30;
    A.banT = R.t;
    A.focusId = null;
    return true;
  },

  // ================= R2 第二輪（F 包）：科技、英雄、技能、道具、打野、酒館 =================

  // ---------- 科技：研究所、主堡升級、重工廠、停機坪、補給商店、研究、防禦塔與城牆 ----------
  rtsAiTech(A, S) {
    const R = this.rts,
      T = R.teams[A.team],
      P = A.P,
      ro = A.roles;
    if (!S.hqs.length || A.si < A.steps.length) {
      A.upgWant = false;
      return;
    }
    const tier = this.rtsTier(A.team);
    if (!A.tierT[tier]) A.tierT[tier] = R.t;
    const has = (id) => (S.count[id] || 0) > 0;
    const done = (id) => (S.done[id] || 0) > 0;
    // 需求的建築（艾瑟立克：研究院要兵器廠、深層研究院要培養槽＋研究所、研究所要兵器廠；速攻開局沒有兵器廠）
    const reqBld = (id) => {
      const r = id && RTS_DEFS[id] && RTS_DEFS[id].req;
      const list = r ? (Array.isArray(r) ? r : r.blds || []) : [];
      return list.find((b) => !done(b) && !(b === ro.hq && S.hqs.length)) || null;
    };
    const buildReq = (id, key) => {
      const b = reqBld(id);
      if (b && !has(b)) this.rtsAiBuildKept(A, S, b, key);
      return !!b;
    };
    const facDone = A.grid
      ? !reqBld(ro.works) && (done(ro.factory) || (ro.factory2 && done(ro.factory2)))
      : done(ro.factory);
    const wantT2 = P.t2T < 1e8 && R.t >= P.t2T && (T.pop >= A.op.tech.t2 || R.t >= P.t2T + 90);
    const wantT3 = P.t3T < 1e8 && R.t >= P.t3T && (T.pop >= A.op.tech.t3 || R.t >= P.t3T + 90);
    // 0. 補給商店：有英雄之後（便宜、又是英雄回血的修復套件的來源：排在升級的存錢之前）
    if (ro.market && P.items !== 'none' && !has(ro.market) && S.heroes.length && R.t > 200)
      this.rtsAiBuildKept(A, S, ro.market, 'market');
    // 1. 主堡升級（升級中、主堡的佇列要空：不排工人）
    A.upgWant = false;
    const upg = S.hqs.some((h) => h.bld.queue.some((q) => q.upg));
    // 升級前 150 秒開始存 Coral（Coral 只有抽取站的收入，不先存的話會一直被盾牌 MT、商店、研究所花掉，升級晚好幾分鐘）
    const nextT = tier === 1 ? P.t2T : tier === 2 ? P.t3T : 1e9;
    const U0 = RTS_DEFS[tier === 1 ? ro.hq2 : ro.hq3];
    // （需求還沒滿足時不存：T3 要先有重工廠與研究所，存了反而讓它們蓋不起來）
    // 升級的需求建築（艾瑟立克的研究院要兵器廠：速攻開局沒有）在升級前 120 秒開始蓋
    // （只有艾瑟立克：卡斯特隆照 R2 的順序，需求的重工廠與研究所由下面的步驟蓋）
    if (A.grid && !upg && U0 && nextT < 1e8 && R.t >= nextT - 120 && this.rtsReqWhy(A.team, U0))
      buildReq(tier === 1 ? ro.hq2 : ro.hq3, 'reqb');
    if (!upg && U0 && nextT < 1e8 && R.t >= nextT - 150 && R.t < nextT && !this.rtsReqWhy(A.team, U0)) {
      const U = U0;
      this.rtsAiClaim(A, 'upgc');
      this.rtsAiKeep(A, { coral: Math.min(U.cost.coral || 0, Math.max(0, T.coral)) }, 'upgc');
    }
    if (!upg && !A.threatArmy.length) {
      const to = tier === 1 && wantT2 ? ro.hq2 : tier === 2 && wantT3 ? ro.hq3 : null;
      // 升級的需求建築還沒有：先蓋（卡斯特隆的需求開局就有）
      if (A.grid && to && this.rtsReqWhy(A.team, RTS_DEFS[to])) buildReq(to, 'reqb');
      if (to && !this.rtsReqWhy(A.team, RTS_DEFS[to])) {
        // 要升級的主堡：本來的那一階、離主基地最近的
        const from = to === ro.hq2 ? ro.hq : ro.hq2;
        let hq = null,
          bd = 1e9;
        for (const h of S.hqs) {
          if (h.rtsDef !== from) continue;
          const d = hyp(h.pos.x, h.pos.z, A.base.pos.x, A.base.pos.z);
          if (d < bd) ((bd = d), (hq = h));
        }
        if (hq) {
          A.upgWant = true;
          A.upgHq = hq;
          const U = RTS_DEFS[to];
          this.rtsAiClaim(A, 'upg');
          if (!hq.bld.queue.length && this.rtsAiCan(A, U.cost, 'fresh')) {
            if (this.rtsUpgrade(hq, to)) this.rtsAiLog(A, `升級主堡：${U.name}`);
          } else this.rtsAiKeep(A, U.cost, 'upg');
        }
      }
    }
    // 2. 工程研究所：研究、T3 的需求（T2 之前錢夠時先蓋；排在升級之後：升級優先拿資源）
    if (ro.works && !has(ro.works) && (R.t > P.t2T - 90 || tier >= 2)) {
      if (facDone) this.rtsAiBuildKept(A, S, ro.works, 'works', tier >= 2);
      else if (tier >= 2) buildReq(ro.works, 'reqw');
    }
    A.techWant = tier >= 2 && ((ro.heavy && !has(ro.heavy)) || (ro.works && !has(ro.works)));
    // 3. 重工廠（T2）、停機坪（T3，比例裡有直升機時）
    const mix = this.rtsAiMix(A);
    if (ro.heavy && tier >= 2 && !has(ro.heavy)) {
      this.rtsAiBuildKept(A, S, ro.heavy, 'heavy');
    }
    const padUnits = ro.pad ? RTS_DEFS[ro.pad].trains || [] : [];
    if (ro.pad && tier >= 3 && padUnits.some((id) => mix[id]) && !has(ro.pad)) {
      this.rtsAiBuildKept(A, S, ro.pad, 'pad');
    }
    // 第二座重工廠：錢多時（困難以上）
    if (ro.heavy && tier >= 2 && P.facMax >= 3 && (S.count[ro.heavy] || 0) === 1 && T.ore - A.res.ore > 900)
      this.rtsAiBuild(A, S, ro.heavy);
    // 5. 研究
    this.rtsAiResearch(A, S);
    // 6. 防禦塔（基地被攻擊兩次以後；對方有空中單位時蓋防空砲塔）與城牆
    this.rtsAiTowers(A, S);
  },
  // 研究：依開局的 research 順序（難度的 resMax 限制級數；兵種比例裡沒有的兵種的專屬研究略過）；
  // 看到對方以穿甲為主時複合裝甲優先
  rtsAiResearch(A, S) {
    const P = A.P,
      ro = A.roles;
    if (!ro.works) return;
    const works = S.blds.find((b) => b.rtsDef === ro.works && b.bld.progress >= 1 && !b.bld.queue.length);
    if (!works) return;
    const mixAll = { ...A.op.mix, ...(A.op.mix2 || {}), ...(A.op.mix3 || {}) };
    const need = RTS_AI_RES_UNIT[A.fac] || {};
    const want = [];
    const cnt = {};
    for (const id of A.op.research || []) {
      cnt[id] = (cnt[id] || 0) + 1;
      want.push({ id, lv: cnt[id] });
    }
    const k = A.atkKinds;
    if (A.fac === 'castron' && k.pierce > 4 && k.pierce > k.kin)
      want.sort((a, b) => (b.id === 'r_arm') - (a.id === 'r_arm'));
    for (const w of want) {
      if (need[w.id] && !mixAll[need[w.id]]) continue;
      if (P.resMax && (P.resMax[w.id] || this.rtsAiResMax(A, w.id)) < w.lv) continue;
      if (this.rtsResLv(A.team, w.id) >= w.lv) continue;
      const inf = this.rtsResearchInfo(A.team, w.id, works);
      if (!inf || !inf.next) continue;
      if (inf.why === '研究中') continue;
      if (inf.why && inf.why !== '礦石不足' && inf.why !== 'Coral 不足') continue; // 層級不夠：先做後面的
      if (!this.rtsAiCan(A, inf.next.cost)) return; // 錢不夠：等（不保留，部隊優先）
      if (this.rtsResearch(works, w.id)) this.rtsAiLog(A, `研究：${RTS_RESEARCH[w.id].name} ${w.lv}`);
      return;
    }
  },
  // 難度的研究上限（resMax 用卡斯特隆的 id 寫）換到其他陣營：攻擊類（r_kin）＝開局研究順序裡的第一項、
  // 裝甲類（r_arm）＝艾瑟立克的生體裝甲；其他沒列的不研究
  rtsAiResMax(A, id) {
    const P = A.P;
    if (!P.resMax || A.fac === 'castron') return 0;
    const first = (A.op.research || [])[0];
    if (id === first) return P.resMax.r_kin || 0;
    if (id === 'r_bio') return P.resMax.r_arm || 0;
    return 0;
  },
  // 防禦塔：基地被攻擊兩次之後，在威脅的方向（沒有時朝坡道）蓋；對方有空中單位時蓋防空砲塔；城牆擋在塔的前面
  rtsAiTowers(A, S) {
    const R = this.rts,
      P = A.P,
      ro = A.roles;
    if (!ro.tower || A.defEp < 2 || A.threatArmy.length) return;
    const n = (S.count[ro.tower] || 0) + (S.count[ro.flak] || 0);
    const max = Math.min(A.op.towers || 0, P.towerMax || 0) + (R.t - A.enemyAir < 180 ? 1 : 0);
    const busy = A.pend.some((p) => p.def === ro.tower || p.def === ro.flak);
    if (n < max && !busy) {
      const air = R.t - A.enemyAir < 180 && ro.flak && (S.count[ro.flak] || 0) < 1 + n / 3;
      const def = air && !this.rtsReqWhy(A.team, RTS_DEFS[ro.flak]) ? ro.flak : ro.tower;
      const p = this.rtsAiTowerSpot(A, S, def);
      if (p && this.rtsAiBuild(A, S, def, p)) this.rtsAiLog(A, `蓋防禦塔：${RTS_DEFS[def].name}`);
    }
    // 城牆：每座蓋好的起重機砲台前方兩段（不擋坡道與主堡到礦脈的路）
    if (!P.walls || !ro.wall) return;
    for (const t of S.blds) {
      if (t.rtsDef !== ro.tower || A.walled.has(t.id) || t.bld.progress < 1) continue;
      A.walled.add(t.id);
      const hq = S.hqs[0];
      const d = A.thDir || { x: A.base.ramp.top.x - hq.pos.x, z: A.base.ramp.top.z - hq.pos.z };
      const L = Math.hypot(d.x, d.z) || 1;
      const dx = d.x / L,
        dz = d.z / L;
      const yaw = Math.abs(dx) > Math.abs(dz) ? Math.PI / 2 : 0; // 牆的長邊和威脅的方向垂直
      const [fw, fd] = yaw ? [2, 4] : [4, 2];
      for (const sg of [-1, 1]) {
        const x = t.pos.x + dx * 5.5 - dz * sg * 2.2,
          z = t.pos.z + dz * 5.5 + dx * sg * 2.2;
        if (!this.world.nav.buildable(x, z, fw + 1, fd + 1)) continue;
        if (this.rtsAiBlocksPath(A, S, x, z, 4)) continue;
        this.rtsAiBuild(A, S, ro.wall, { x, z }, yaw);
      }
    }
  },
  // 位置會不會擋住坡道或主堡與礦脈之間的路
  rtsAiBlocksPath(A, S, x, z, r) {
    const rp = A.base.ramp;
    if (segD(x, z, rp.top.x, rp.top.z, rp.bottom.x, rp.bottom.z) < r + 6) return true;
    for (const h of S.hqs)
      for (const m of this.rts.mines)
        if (
          m.amount > 0 &&
          hyp(h.pos.x, h.pos.z, m.pos.x, m.pos.z) < MINE_R &&
          segD(x, z, h.pos.x, h.pos.z, m.pos.x, m.pos.z) < r + 5
        )
          return true;
    return false;
  },
  // 防禦塔的位置：主堡往威脅（或坡道）的方向 12～26 m、和其他防禦塔隔開
  rtsAiTowerSpot(A, S, def) {
    const hq =
      S.hqs.find((h) => hyp(h.pos.x, h.pos.z, A.base.pos.x, A.base.pos.z) < A.base.r + 10) || S.hqs[0];
    if (!hq) return null;
    const nav = this.world.nav,
      D = RTS_DEFS[def];
    const d = A.thDir || { x: A.base.ramp.top.x - hq.pos.x, z: A.base.ramp.top.z - hq.pos.z };
    const a0 = Math.atan2(d.z, d.x);
    const towers = S.blds.filter((b) => defOf(b).range);
    for (let r = 13; r <= 28; r += 3)
      for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9]) {
        const x = hq.pos.x + Math.cos(a0 + da) * r,
          z = hq.pos.z + Math.sin(a0 + da) * r;
        if (!nav.buildable(x, z, D.foot[0] + 3, D.foot[1] + 3)) continue;
        if (A.grid && this.rtsPowerWhy(A.team, def, x, z)) continue; // 雷射網要在導管範圍內
        if (Math.abs(this.world.terrainHeight(x, z) - A.base.h) > 3) continue;
        if (this.rtsAiBlocksPath(A, S, x, z, D.foot[0] / 2)) continue;
        if (towers.some((b) => hyp(b.pos.x, b.pos.z, x, z) < 9)) continue;
        return { x, z };
      }
    return null;
  },
  // 民兵：基地被打、威脅比留守的部隊強很多而且打到主堡附近時動員工人；威脅消失時解除
  rtsAiMilitia(A, S, home, tc, thPow) {
    const R = this.rts,
      P = A.P;
    if (!A.militia) return this.rtsAiAegis(A, S, home, tc, thPow); // 沒有民兵的陣營（艾瑟立克）：結晶護壁
    if (!P.militia || typeof this.rtsMilitia !== 'function') return;
    const hq = S.hqs[0];
    if (!hq) return;
    if (!tc) {
      if (A.milOn && !A.threatArmy.length && R.t - A.milOn > 8) {
        const t0 = performance.now();
        for (const h of S.hqs) if (this.rtsDemob) this.rtsDemob(h);
        A.ordMs += performance.now() - t0;
        A.milOn = 0;
        this.rtsAiLog(A, '解除動員');
      }
      return;
    }
    if (A.milOn || R.t - (A.milT || -1e9) < 90) return;
    const mine = powOf(home) + powOf(S.heroes);
    if (thPow * thPow < mine * mine * 2.2 + 400 || A.threatArmy.length < 4) return;
    const h = S.hqs.find((q) => hyp(q.pos.x, q.pos.z, tc.x, tc.z) < 40);
    if (!h) return;
    const t0 = performance.now();
    const ok = this.rtsMilitia(h);
    A.ordMs += performance.now() - t0; // 換外觀（工人換成民兵的模型）是核心的工作，不算進決策
    if (ok) {
      A.milOn = R.t;
      A.milT = R.t;
      this.rtsAiLog(A, '動員民兵');
    }
  },

  // ---------- 英雄：生產、復活、酒館 ----------
  rtsAiHeroQueue(A, S) {
    const R = this.rts,
      P = A.P,
      T = R.teams[A.team];
    if (!T.heroes || typeof this.rtsHeroQueue !== 'function') return;
    const hq = S.hqs.find((h) => !h.bld.queue.some((q) => q.upg)) || null;
    // 復活（陣亡的英雄；礦石不夠時保留，優先於部隊）
    for (const rec of T.heroes) {
      const st = this.rtsHeroState(A.team, rec.def);
      if (st !== 'dead' || !hq) continue;
      const c = this.rtsHeroReviveCost(A.team, rec.def).cost;
      this.rtsAiClaim(A, 'rv' + rec.def);
      if (this.rtsAiCan(A, c, 'fresh') && hq.bld.queue.length < 2) {
        if (this.rtsHeroQueue(hq, rec.def)) this.rtsAiLog(A, `復活英雄：${RTS_HERO_DEFS[rec.def].name}`);
      } else this.rtsAiKeep(A, c, 'rv' + rec.def);
    }
    const n = this.rtsHeroCount(A.team);
    const tier = this.rtsTier(A.team);
    // 第 1 個英雄：時間到就生產（免費，只花人口）
    if (n === 0) {
      if (R.t < P.hero1T || !hq) return;
      const id = A.heroIds.find((h) => !this.rtsHeroQueueWhy(A.team, h));
      if (id && hq.bld.queue.length < 2 && this.rtsHeroQueue(hq, id)) {
        A.heroT[1] = R.t;
        this.rtsAiLog(A, `英雄：${RTS_HERO_DEFS[id].name}`);
      }
      return;
    }
    // 第 2、3 個：升階之後（難度的上限）；有時去酒館雇用
    if (n >= Math.min(P.heroMax, tier) || A.upgWant) return;
    if (A.tavernWant && this.rtsAiTavern(A, S)) return;
    const id = A.heroIds.find((h) => !this.rtsHeroWhy(A.team, h));
    if (!id || !hq) return;
    const c = this.rtsHeroCost(A.team);
    this.rtsAiClaim(A, 'hero');
    if (!this.rtsAiCan(A, c, 'fresh')) return this.rtsAiKeep(A, c, 'hero');
    if (hq.bld.queue.length < 2 && this.rtsHeroQueue(hq, id)) {
      A.heroT[n + 1] = R.t;
      this.rtsAiLog(A, `英雄：${RTS_HERO_DEFS[id].name}`);
    }
  },
  // 酒館：派一個單位（英雄優先）到酒館旁，到了就雇用；90 秒沒雇到就放棄（之後在主堡生產）
  rtsAiTavern(A, S) {
    const R = this.rts;
    const tavRec = (R.neutrals || []).find((q) => q.kind === 'tavern');
    const tav = tavRec && tavRec.ent;
    if (!tav || typeof this.rtsHire !== 'function') return (A.tavernWant = false);
    if (!A.tav) {
      const free = RTS_TAVERN.filter((h) => this.rtsHireOwner(h) < 0);
      if (!free.length) return (A.tavernWant = false);
      A.tav = { hero: free[Math.floor(Math.random() * free.length)], t0: R.t, u: null };
    }
    const job = A.tav;
    if (R.t - job.t0 > 90 || this.rtsHireOwner(job.hero) >= 0) {
      this.rtsAiLog(A, '放棄雇用酒館英雄');
      A.tav = null;
      A.tavernWant = false;
      return false;
    }
    const why = this.rtsHireWhy(A.team, tav, job.hero);
    if (!why) {
      const t0 = performance.now();
      const e = this.rtsHire(A.team, tav, job.hero); // 生成英雄（建模型）是核心的工作，不算進決策
      A.ordMs += performance.now() - t0;
      if (e) {
        this.rtsAiLog(A, `雇用酒館英雄：${RTS_HERO_DEFS[job.hero].name}`);
        A.heroT[this.rtsHeroCount(A.team)] = R.t;
        if (job.u && !job.u.dead) this.rtsAiOrd(A, [job.u], { k: 'move', x: A.rally.x, z: A.rally.z });
        this.rtsAiOrd(A, [e], { k: 'move', x: A.rally.x, z: A.rally.z });
      }
      A.tav = null;
      A.tavernWant = false;
      return true;
    }
    if (why === '礦石不足' || why === 'Coral 不足') {
      this.rtsAiKeep(A, RTS_HIRE.cost, 'tav');
      if (!job.u) return true; // 錢夠了才派人
    }
    // 跑腿的：活著、沒有工作的英雄，或留守的部隊一台
    if (!job.u || job.u.dead) {
      job.u =
        S.heroes.find((h) => !A.hj.has(h.id) && !(A.creep && A.creep.units.has(h.id))) ||
        (S.home || []).find((u) => !u.orders.length) ||
        null;
      if (!job.u) return true;
      const r = RTS_HIRE.r + Math.max(tav.bld.w, tav.bld.d) / 2 - 4;
      const p = this.rtsAiApproach(tav.pos.x, tav.pos.z, r - 6, job.u.pos);
      job.p = p;
      this.rtsAiOrd(A, [job.u], { k: 'move', x: p.x, z: p.z });
      if (job.u.hero) A.hj.set(job.u.id, { k: 'tavern', t0: R.t });
    } else if (!job.u.orders.length && job.p && hyp(job.u.pos.x, job.u.pos.z, job.p.x, job.p.z) > 4)
      this.rtsAiOrd(A, [job.u], { k: 'move', x: job.p.x, z: job.p.z });
    return true;
  },

  // ---------- 英雄：學技能、跟隨、撤退、道具、技能 ----------
  rtsAiHeroes(A, S) {
    const R = this.rts,
      P = A.P;
    if (!S.heroes.length) return;
    const home = S.hqs[0] || S.blds[0];
    for (const h of S.heroes) {
      const rec = h.hero;
      if (!rec || h.rtsPiloted) continue;
      // 學技能：終極技優先，其餘 Z → X → C 輪流（級數最低的）
      for (let k = 0; k < 4 && rec.pts > 0; k++) {
        let slot = -1;
        if (!this.rtsHeroLearnWhy(rec, 3)) slot = 3;
        else
          for (const i of [0, 1, 2])
            if (!this.rtsHeroLearnWhy(rec, i) && (slot < 0 || rec.sk[i] < rec.sk[slot])) slot = i;
        if (slot < 0 || !this.rtsHeroLearn(rec, slot)) break;
      }
      if (h.hs && (h.hs.chan || h.hs.dash || h.hs.leap || h.hs.burrow)) continue;
      const o = h.orders[0];
      if (o && (o.k === 'ability' || o.k === 'pickup' || o.k === 'shop')) continue; // 走去施放、撿、買的路上
      let job = A.hj.get(h.id);
      if (job && job.k === 'tavern' && !(A.tav && A.tav.u === h)) (A.hj.delete(h.id), (job = null));
      if (job && job.k === 'tavern') continue;
      const hpK = h.hp / h.maxHp;
      const kitSlot = rec.inv.findIndex((s) => s && s.id === 'i_kit');
      const hurtAgo = R.t - ((h.rt && h.rt.hurtT) || -1e9);
      // 撤退：血量低（普通以上）；有回城信標就用
      if (!job && P.heroRetreat && hpK < P.heroRetreat && hurtAgo < 3 && home) {
        job = { k: 'retreat', t0: R.t };
        A.hj.set(h.id, job);
        if (A.creep && A.creep.units.has(h.id)) this.rtsAiCreepEnd(A, '英雄撤退', 90);
        const bi = rec.inv.findIndex((s) => s && s.id === 'i_beacon');
        if (bi >= 0 && hyp(h.pos.x, h.pos.z, home.pos.x, home.pos.z) > 50 && !this.rtsItemWhy(h, bi))
          this.rtsItemUse(h, bi);
        else if (!this.rtsAiShop(A, S, h, true))
          this.rtsAiOrd(A, [h], { k: 'move', x: home.pos.x + 2, z: home.pos.z + 2 });
        this.rtsAiLog(A, `英雄撤退：${h.name || rec.def}`);
        continue;
      }
      // 修復套件：血量 < 45%、2.5 秒沒被打
      if (
        kitSlot >= 0 &&
        hpK < 0.45 &&
        hurtAgo > 2.5 &&
        !(h.hs && h.hs.kitT > R.t) &&
        !this.rtsItemWhy(h, kitSlot)
      )
        this.rtsItemUse(h, kitSlot);
      if (job && job.k === 'retreat') {
        const atHome = home && hyp(h.pos.x, h.pos.z, home.pos.x, home.pos.z) < 30;
        this.rtsAiShop(A, S, h, true); // 撤退時直接去商店買修復套件（不必先回到主堡）
        const kitting = h.hs && h.hs.kitT > R.t;
        // 回滿一些、或在家而且沒有修復套件可以用（英雄不會自己回血：等也沒用）就歸隊
        const stuck = atHome && !kitting && kitSlot < 0 && hurtAgo > 6 && R.t - job.t0 > 12;
        if (hpK > 0.65 || stuck || R.t - job.t0 > 60) {
          A.hj.delete(h.id);
          job = null;
        } else continue;
      }
      // 撿地上的道具：30 m 內、附近沒有在打
      if (
        rec.inv.indexOf(null) >= 0 &&
        R.items &&
        R.items.length &&
        !this.rtsAiThreatAt(A, h.pos.x, h.pos.z, 22)
      ) {
        let it = null,
          bd = 30;
        for (const q of R.items) {
          const d = hyp(q.x, q.z, h.pos.x, h.pos.z);
          if (d < bd && this.rtsFogState(A.team, q.x, q.z) === 2) ((bd = d), (it = q));
        }
        if (it) {
          const back = o && (o.k === 'amove' || o.k === 'move') ? { k: o.k, x: o.x, z: o.z } : null;
          this.rtsAiOrd(A, [h], { k: 'pickup', uid: it.uid });
          if (back) this.rtsAiOrd(A, [h], back, true);
          continue;
        }
      }
      // 施放技能
      if (this.rtsAiCast(A, S, h)) continue;
      // 打野中：由 rtsAiCreep 指揮；出發時不在隊伍裡（撤退中、在買東西）的英雄回復之後追上去
      if (A.creep && A.creep.units.has(h.id)) continue;
      if (A.creep && hpK > 0.5 && !A.threatArmy.length) {
        A.creep.units.add(h.id);
        const p =
          A.creep.ph === 'stage' ? A.creep.stage : this.rtsAiWalk(A.creep.camp.pos.x, A.creep.camp.pos.z);
        this.rtsAiOrd(A, [h], { k: A.creep.ph === 'stage' ? 'move' : 'amove', x: p.x, z: p.z });
        continue;
      }
      // 基地被攻擊：回防
      if (A.threatArmy.length) {
        const tc = centroid(A.threat);
        if (!o || (o.k === 'amove' && hyp(o.x, o.z, tc.x, tc.z) > 15) || o.k === 'move')
          this.rtsAiOrd(A, [h], { k: 'amove', x: tc.x, z: tc.z });
        continue;
      }
      // 血量低又沒有修復套件：先去買（買不到就留在家，不跟著出擊送掉）
      if (hpK < 0.4 && kitSlot < 0 && P.items !== 'none') {
        if (!this.rtsAiShop(A, S, h, true) && home && hyp(h.pos.x, h.pos.z, home.pos.x, home.pos.z) > 25)
          this.rtsAiOrd(A, [h], { k: 'move', x: home.pos.x + 2, z: home.pos.z + 2 });
        continue;
      }
      // 進攻中：跟在部隊的中後方（離部隊重心 ≤ 10 m）
      const atk = (S.atk || []).filter((u) => A.atk.has(u.id));
      if (A.mode === 'attack' && atk.length) {
        const c = centroid(atk);
        const L = hyp(c.x, c.z, A.rally.x, A.rally.z) || 1;
        const bx = c.x + ((A.rally.x - c.x) / L) * 5,
          bz = c.z + ((A.rally.z - c.z) / L) * 5;
        const fighting = o && o.k === 'attack' && hyp(h.pos.x, h.pos.z, c.x, c.z) < 25;
        if (!fighting && (hyp(h.pos.x, h.pos.z, c.x, c.z) > 10 || !o)) {
          if (!(o && o.k === 'amove' && hyp(o.x, o.z, bx, bz) < 4))
            this.rtsAiOrd(A, [h], { k: 'amove', x: bx, z: bz });
        }
        continue;
      }
      // 在家：買道具、回集結點
      if (home && hyp(h.pos.x, h.pos.z, home.pos.x, home.pos.z) < 60 && this.rtsAiShop(A, S, h)) continue;
      if (!o && hyp(h.pos.x, h.pos.z, A.rally.x, A.rally.z) > 12)
        this.rtsAiOrd(A, [h], { k: 'amove', x: A.rally.x, z: A.rally.z });
    }
    for (const id of A.hj.keys()) if (!S.heroes.some((h) => h.id === id)) A.hj.delete(id);
  },
  // 買道具（補給商店或 50 m 內的中立商店）：修復套件（背包沒有、普通以上）、永久道具（困難以上，依 RTS_AI_ITEMS）
  // far：商店在遠處也去（撤退、回血的時候）
  rtsAiShop(A, S, h, far = false) {
    const R = this.rts,
      P = A.P,
      T = R.teams[A.team];
    if (P.items === 'none' || typeof this.rtsBuyWhyAt !== 'function') return false;
    if (R.t < (A.shopT || 0)) return false;
    const rec = h.hero;
    if (rec.inv.indexOf(null) < 0) return false;
    const owned = (id) => rec.inv.some((s) => s && s.id === id);
    let item = null;
    // 修復套件便宜又是英雄唯一的回血方式：不管保留的資源
    if (!owned('i_kit') && T.ore > RTS_ITEMS.i_kit.cost.ore + 10) item = 'i_kit';
    else if (P.items === 'all')
      for (const id of RTS_AI_ITEMS_FAC[A.fac] || RTS_AI_ITEMS) {
        if (owned(id)) continue;
        const c = RTS_ITEMS[id].cost;
        if (T.ore - A.res.ore > c.ore + 250 && T.coral - A.res.coral > (c.coral || 0) + 40) item = id;
        break;
      }
    if (!item) return false;
    // 商店：自己的補給商店（層級夠的），或附近的中立商店
    let shop = null,
      bd = 1e9;
    for (const b of S.blds)
      if (b.rtsDef === A.roles.market && b.bld.progress >= 1 && this.rtsBuyList(b, A.team).includes(item)) {
        const d = hyp(b.pos.x, b.pos.z, h.pos.x, h.pos.z);
        if (d < bd) ((bd = d), (shop = b));
      }
    for (const q of R.neutrals || []) {
      if (q.kind !== 'shop' || !q.ent) continue;
      const d = hyp(q.ent.pos.x, q.ent.pos.z, h.pos.x, h.pos.z);
      if (
        d < Math.min(bd, far ? 90 : 50) &&
        !(this.rtsShopWhy && /缺貨|沒有/.test(this.rtsShopWhy(A.team, q.ent, item) || ''))
      )
        ((bd = d), (shop = q.ent));
    }
    if (!shop) return false;
    A.shopT = R.t + 8;
    const why = this.rtsBuyWhyAt(h, shop, item);
    if (!why) {
      if (this.rtsBuy(h, shop, item)) this.rtsAiLog(A, `買道具：${RTS_ITEMS[item].name}`);
      return true;
    }
    if (/m 內/.test(why)) {
      this.rtsAiOrd(A, [h], { k: 'shop', id: shop.id, item });
      return true;
    }
    return false;
  },
  // 施放英雄的技能（一次一個）：困難以上照 RTS_AI_CAST；簡單只用 Z、隨機時機。回傳 true＝下了指令
  rtsAiCast(A, S, h) {
    const R = this.rts,
      P = A.P,
      rec = h.hero,
      D = RTS_HERO_DEFS[rec.def];
    if (!D || R.t < (A.castT && A.castT[h.id])) return false;
    const foes = this.rtsAiFoesNear(A, h.pos, 75);
    if (!foes.length) return false;
    for (let slot = 0; slot < 4; slot++) {
      if (P.cast === 'z' && (slot > 0 || Math.random() > 0.3)) break;
      const id = D.skills[slot],
        Sk = RTS_SKILLS[id];
      if (!Sk || Sk.kind === 'aura' || Sk.kind === 'passive' || !rec.sk[slot]) continue;
      const why = this.rtsSkillWhy(h, slot);
      if (why === 'Coral 不足' && slot === 3 && (rec.cd[slot] || 0) <= R.t) {
        // 終極技的 Coral 不夠：用到 Coral 的生產讓路
        const Pl = skillLv(id, rec.sk[slot]);
        A.ultKeep = Pl.coral || 0;
        A.ultKeepT = R.t + 20;
        continue;
      }
      if (why) continue;
      // 保留中的 Coral（升級主堡、英雄、終極技）最多動用 60（技能是交戰中的關鍵，但不能一直拖慢升級）
      const cc = (skillLv(id, rec.sk[slot]) || {}).coral || 0;
      if (slot < 3 && cc && R.teams[A.team].coral - cc < A.res.coral - this.rtsAiDip(A)) continue;
      const tgt = this.rtsAiCastTarget(A, S, h, id, Sk, foes);
      if (!tgt) continue;
      const o = h.orders[0];
      const back = o && (o.k === 'amove' || o.k === 'move') ? { k: 'amove', x: o.x, z: o.z } : null;
      const ord = { k: 'ability', ab: id };
      if (tgt.ent) ord.id = tgt.ent.id;
      else if (tgt.x !== undefined) ((ord.x = tgt.x), (ord.z = tgt.z));
      this.rtsAiOrd(A, [h], ord);
      if (back) this.rtsAiOrd(A, [h], back, true);
      if (!A.castT) A.castT = {};
      A.castT[h.id] = R.t + 1.5;
      A.casts++;
      A.castLog = A.castLog || {};
      A.castLog[id] = (A.castLog[id] || 0) + 1;
      return true;
    }
    return false;
  },
  // 技能的目標（RTS_AI_CAST 的條件，沒有列的用通用規則）：{ ent } 或 { x, z } 或 {}（自己）；null＝不放
  rtsAiCastTarget(A, S, h, id, Sk, foes) {
    const R = this.rts;
    const C = RTS_AI_CAST[id] || null;
    const range = (Sk.range || 20) + 8;
    const units = foes.filter((e) => !e.bld);
    const inR = (e, r) => hyp(e.pos.x, e.pos.z, h.pos.x, h.pos.z) < r;
    const k = C
      ? C.k
      : Sk.kind === 'unit'
        ? Sk.tgt === 'ally'
          ? 'ally'
          : 'strong'
        : Sk.kind === 'point'
          ? 'cluster'
          : 'self';
    if (k === 'cluster' || k === 'line') {
      const n = C ? C.n : 3,
        r = C ? C.r : 8;
      const near = C && C.near ? C.near : Sk.line ? 60 : range;
      const cl = this.rtsAiCluster(
        units.filter((e) => inR(e, near)),
        r,
      );
      if (cl && cl.n >= n) return { x: cl.x, z: cl.z };
      if (C && C.bld) {
        const b = foes.find((e) => e.bld && inR(e, near) && !e.rtsInv);
        if (b) return { x: b.pos.x, z: b.pos.z };
      }
      return null;
    }
    if (k === 'mark' || k === 'strong') {
      let best = null,
        bs = -1;
      for (const e of units) {
        if (!inR(e, range)) continue;
        const s = (e.hero ? 1e5 : 0) + e.hp;
        if (s > bs) ((bs = s), (best = e));
      }
      return best ? { ent: best } : null;
    }
    if (k === 'ally') {
      const hpK = C ? C.hp : 0.5;
      const bio = (C && C.bio) || Sk.bio;
      const list = [
        ...(bio ? [] : S.heroes),
        ...S.army.filter((u) => (!C || !C.units || C.units.includes(u.rtsDef)) && (!bio || defOf(u).bio)),
      ];
      // 生體技能（催化）：引導中的融合宿主優先（立刻完成融合）
      if (bio) {
        const host = list.find((u) => {
          const f = u.rtsFusing && this.rtsFuseOf && this.rtsFuseOf(u.rtsFusing);
          return f && f.st === 'chan' && f.host === u && inR(u, range);
        });
        if (host) return { ent: host };
      }
      let best = null,
        bs = 1e9;
      for (const u of list) {
        if (u.hp > u.maxHp * hpK || !inR(u, range)) continue;
        if (!units.some((e) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < 35)) continue; // 交戰中的
        const s = (u.hero ? 0 : 1) * 1000 + u.hp / u.maxHp;
        if (s < bs) ((bs = s), (best = u));
      }
      return best ? { ent: best } : null;
    }
    if (k === 'blobs') {
      // 群體融合：範圍內己方的實驗體（不含幻象、臨時的、融合中的）≥ n
      let n = 0;
      for (const u of S.army)
        if (u.rtsDef === 'a_blob' && !u.rtsFusing && hyp(u.pos.x, u.pos.z, h.pos.x, h.pos.z) < C.r) n++;
      return n >= C.n ? {} : null;
    }
    if (k === 'army') {
      // 虛像軍團：交戰中（附近有敵方單位）、範圍內己方單位 ≥ n
      if (!units.some((e) => inR(e, C.r + 15))) return null;
      let n = 0;
      for (const u of S.army) if (hyp(u.pos.x, u.pos.z, h.pos.x, h.pos.z) < C.r) n++;
      return n >= C.n ? {} : null;
    }
    if (k === 'self') {
      const hpK = C && C.hp !== undefined ? C.hp : 1.01;
      const n = C ? C.n : 3,
        r = C ? C.r : Sk.aiR || 14;
      if (h.hp > h.maxHp * hpK) return null;
      return units.filter((e) => inR(e, r)).length >= n ? {} : null;
    }
    if (k === 'ranged') {
      const e = units.find(
        (u) =>
          inR(u, range) && ((C.defs || []).includes(u.rtsDef) || (u.hero && u.hp < u.maxHp * (C.hp || 0.3))),
      );
      return e ? { ent: e } : null;
    }
    if (k === 'armor') {
      let best = null,
        bs = 1e9;
      for (const u of units) {
        if (!inR(u, range) || defOf(u).arm !== C.arm) continue;
        const d = hyp(u.pos.x, u.pos.z, h.pos.x, h.pos.z);
        if (d < bs) ((bs = d), (best = u));
      }
      // 沒有重甲：交戰中的英雄或最近的敵人也打
      if (!best) best = units.find((u) => u.hero && inR(u, range)) || null;
      return best ? { ent: best } : null;
    }
    if (k === 'fan') {
      // 前方扇形（面向最近的敵人的那一側）：r 內、在面向 ±45° 的敵人 ≥ n
      const fx = -Math.sin(h.yaw),
        fz = -Math.cos(h.yaw);
      let n = 0;
      for (const u of units) {
        const dx = u.pos.x - h.pos.x,
          dz = u.pos.z - h.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < C.r && (dx * fx + dz * fz) / (d || 1) > 0.7) n++;
      }
      return n >= C.n ? {} : null;
    }
    void R;
    return null;
  },
  // 範圍 r 內最多的一群（以每台為中心數一次）：{ x, z, n }
  rtsAiCluster(list, r) {
    let best = null;
    for (const a of list) {
      let n = 0,
        x = 0,
        z = 0;
      for (const b of list)
        if (hyp(a.pos.x, a.pos.z, b.pos.x, b.pos.z) < r) {
          n++;
          x += b.pos.x;
          z += b.pos.z;
        }
      if (!best || n > best.n) best = { n, x: x / n, z: z / n };
    }
    return best;
  },
  // 附近看得到的敵人（含野怪：打野時的技能也要放）
  rtsAiFoesNear(A, p, r) {
    const out = [];
    for (const e of A.visN || A.vis) if (!e.rtsInv && hyp(e.pos.x, e.pos.z, p.x, p.z) < r) out.push(e);
    return out;
  },
  // 單位技能：盾牆（交戰中）、投擲貨櫃、火箭齊射（敵人聚集）
  rtsAiUnitAbils(A, S) {
    const R = this.rts;
    if (!S.army.length || !(A.visN || A.vis).length) return;
    const wallOk = this.rtsResLv(A.team, 'r_wall') > 0;
    for (const u of S.army) {
      const D = defOf(u);
      const abil = D.abil || [];
      if (!abil.length || u.rtsFusing) continue;
      if (A.grid) {
        this.rtsAiAethAbil(A, S, u, D, abil);
        continue;
      }
      if (wallOk && abil.includes('ab_wall')) {
        const near = this.rtsAiFoesNear(A, u.pos, RTS_AI_ABILS.ab_wall.r).filter((e) => !e.bld && isArmy(e));
        const o = u.orders[0];
        if (
          !u.rtsWall &&
          near.length &&
          (!o || o.k === 'attack' || o.k === 'amove') &&
          R.t > (u._aiWallT || 0)
        ) {
          this.rtsAiOrd(A, [u], { k: 'ability', ab: 'ab_wall' });
          u._aiWallT = R.t + 3;
        } else if (
          u.rtsWall &&
          !this.rtsAiFoesNear(A, u.pos, 32).some((e) => !e.bld) &&
          R.t > (u._aiWallT || 0)
        ) {
          this.rtsAiOrd(A, [u], { k: 'ability', ab: 'ab_wall' }); // 收起
          u._aiWallT = R.t + 3;
        }
        continue;
      }
      for (const ab of ['ab_crate', 'ab_rockets']) {
        if (!abil.includes(ab) || (u.rtsAbWhy && u.rtsAbWhy(ab))) continue;
        const Ab = RTS_AI_ABILS[ab];
        const foes = this.rtsAiFoesNear(A, u.pos, (ab === 'ab_crate' ? 24 : 30) + 4).filter((e) => !e.bld);
        if (foes.length < Ab.n) continue;
        const cl = this.rtsAiCluster(foes, Ab.r);
        if (!cl || cl.n < Ab.n) continue;
        const o = u.orders[0];
        const back = o && (o.k === 'amove' || o.k === 'move') ? { k: 'amove', x: o.x, z: o.z } : null;
        this.rtsAiOrd(A, [u], { k: 'ability', ab, x: cl.x, z: cl.z });
        if (back) this.rtsAiOrd(A, [u], back, true);
        A.casts++;
        break;
      }
    }
  },
  // 艾瑟立克的單位技能（docs 14.6）：投影＝交戰中、對自己部隊裡血量最高的；過載＝射程內 2 台以上；
  // 浮游砲＝敵方英雄或血量最高的；吞噬＝原型體血量 < 50% 而且 6 m 內有實驗體；纏附是自動施放（B 包）、融合由 rtsAiFuse
  rtsAiAethAbil(A, S, u, D, abil) {
    const R = this.rts;
    if (R.t < (u._aiAbT || 0)) return;
    const o = u.orders[0];
    const cast = (ab, tgt) => {
      const back = o && (o.k === 'amove' || o.k === 'move') ? { k: 'amove', x: o.x, z: o.z } : null;
      const ord = { k: 'ability', ab };
      if (tgt) ord.id = tgt.id;
      this.rtsAiOrd(A, [u], ord);
      if (back) this.rtsAiOrd(A, [u], back, true);
      u._aiAbT = R.t + 2;
      A.casts++;
      A.abLog = A.abLog || {};
      A.abLog[ab] = (A.abLog[ab] || 0) + 1;
      return true;
    };
    const T = R.teams[A.team];
    for (const ab of abil) {
      const C = RTS_AI_ABILS[ab];
      if (!C || (u.rtsAbWhy && u.rtsAbWhy(ab))) continue;
      const cc = (RTS_ABILS[ab] || {}).coral || 0;
      if (cc && T.coral - cc < A.res.coral - this.rtsAiDip(A)) continue; // 不動用保留中的 Coral
      if (ab === 'ab_decoy') {
        if (!this.rtsAiFoesNear(A, u.pos, C.r).some((e) => !e.bld && isArmy(e))) continue;
        let best = null;
        for (const q of S.army)
          if (!q.rtsFusing && hyp(q.pos.x, q.pos.z, u.pos.x, u.pos.z) < C.r && (!best || q.hp > best.hp))
            best = q;
        if (best && cast(ab, best)) return;
      } else if (ab === 'ab_overcharge') {
        const n = this.rtsAiFoesNear(A, u.pos, (D.range || 30) + 2).filter((e) => !e.bld).length;
        if (n >= C.n && cast(ab, null)) return;
      } else if (ab === 'ab_bits') {
        let best = null,
          bs = -1;
        for (const e of this.rtsAiFoesNear(A, u.pos, C.r)) {
          if (e.bld) continue;
          const sc = (e.hero ? 1e5 : 0) + e.hp;
          if (sc > bs) ((bs = sc), (best = e));
        }
        if (best && cast(ab, best)) return;
      } else if (ab === 'ab_devour') {
        if (u.hp >= u.maxHp * C.hp) continue;
        let best = null,
          bd = C.r;
        for (const e of R.units) {
          if (e.dead || e.rtsTeam !== A.team || e.rtsDef !== 'a_blob' || e.rtsIllus || e.rtsFusing) continue;
          const d = hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z);
          if (d < bd) ((bd = d), (best = e));
        }
        if (best && cast(ab, best)) return;
      }
    }
  },
  // 盾牆中的盾牌 MT（附近還有敵人）：不要下移動指令（會自動放下盾牆）
  rtsAiWalled(A, u) {
    return !!(u.rtsWall && this.rtsAiFoesNear(A, u.pos, 30).some((e) => !e.bld));
  },

  // ---------- 打野 ----------
  // 基地沒有威脅、英雄 ≥ creepLv 級、留守部隊 ≥ 4 台時，挑己方這一側、等級最低、沒清的營地（戰力 × 1.4 > 營地）；
  // 英雄血量 < 35% 撤回；清完撿道具；英雄 5 級後只打守著分礦的營地。營地的位置與編成是地圖公開的資訊，
  // 清除與否要看得到才知道（或自己清的）
  rtsAiCreep(A, S) {
    const R = this.rts,
      P = A.P;
    if (!R.camps || !R.camps.length) return;
    // 知道清除了的營地
    for (const c of R.camps)
      if (
        c.cleared &&
        !A.campDone.has(c.id) &&
        (c.clearedBy === A.team || this.rtsFogState(A.team, c.pos.x, c.pos.z) === 2)
      )
        A.campDone.add(c.id);
    if (A.creep) return this.rtsAiCreepTick(A, S);
    if (A.mode !== 'home' || A.threat.length || R.t < P.creepT || A.tav) return;
    const hero = S.heroes.filter((h) => !A.hj.has(h.id)).sort((a, b) => b.hero.lv - a.hero.lv)[0];
    if (!hero || hero.hero.lv < P.creepLv || hero.hp < hero.maxHp * 0.6) return;
    const party = (S.home || []).filter((u) => !(A.scout && A.scout.u === u) && !u.rtsWall);
    if (party.length < 4) return;
    // 快要進攻了：第一次進攻之前 40 秒起不出發（第一次進攻的時間優先；之後在兩波進攻之間打野）、
    // 或部隊接近門檻
    if (A.firstAtk === null && R.t >= A.attackT - 40) return;
    if (R.t >= A.attackT - 20 && party.length >= A.need * 0.75) return;
    // 對方的出生點（猜的：不是自己的出生點候選）
    const foeBase = this.world.rts.bases.filter((b) => b.owner !== A.team).map((b) => b.pos);
    const myPow = powOf(party) + powOf(S.heroes.filter((h) => !A.hj.has(h.id)));
    let best = null,
      bs = 1e9;
    for (const c of R.camps) {
      if (c.off || A.campDone.has(c.id) || (A.campFail.get(c.id) || 0) > R.t) continue;
      if (c.tier > P.creepTier) continue;
      if (hero.hero.lv >= 5 && !(c.guards && c.guards.type === 'mine')) continue;
      const dMe = hyp(c.pos.x, c.pos.z, A.base.pos.x, A.base.pos.z);
      const dFoe = Math.min(...foeBase.map((p) => hyp(c.pos.x, c.pos.z, p.x, p.z)));
      const mine = dMe <= dFoe;
      if (!mine && !P.creepFar) continue;
      if (dFoe < 70) continue; // 對方的家門口不去
      const cp = this.rtsAiCampPow(A, c);
      if (myPow <= cp * 2) continue; // 野怪的單台比同等級的部隊強、打輸會整隊損失：要明顯比較強才去
      const s = c.tier * 1000 + dMe + (mine ? 0 : 150);
      if (s < bs) ((bs = s), (best = c));
    }
    if (!best) return;
    this.rtsAiCreepStart(A, S, best, party, '打野');
  },
  // 出發去打一個營地：先在營地外（往部隊的方向 24 m）集合，到齊了再一起打進去（陸續抵達的話會被各個擊破）
  rtsAiCreepStart(A, S, camp, party, why, next = null) {
    const R = this.rts;
    const heroes = S.heroes.filter((h) => !A.hj.has(h.id));
    const all = [...party, ...heroes];
    const units = new Set(all.map((e) => e.id));
    const from = centroid(all) || A.rally;
    const L = hyp(camp.pos.x, camp.pos.z, from.x, from.z) || 1;
    const stage = this.rtsAiWalk(
      camp.pos.x + ((from.x - camp.pos.x) / L) * Math.min(24, L),
      camp.pos.z + ((from.z - camp.pos.z) / L) * Math.min(24, L),
    );
    A.creep = { camp, units, t0: R.t, ph: 'stage', stage, lootT: 0, fightT: 0, next };
    this.rtsAiOrd(A, all, { k: 'move', x: stage.x, z: stage.z });
    this.rtsAiLog(A, `${why}：營地 ${camp.id}（tier ${camp.tier}）`);
  },
  // 進攻的路上（導航格的路徑 20 m 內）有還在的野怪營地：回傳最近的一個（攻擊移動經過營地會被纏住：
  // 野怪追一段就回營、回營時回滿血，部隊一邊走一邊打只會被慢慢消耗）
  rtsAiBlockingCamp(A, from, to) {
    const live = (this.rts.camps || []).filter(
      (c) => !c.cleared && !c.off && !A.campDone.has(c.id) && !((A.campFail.get(c.id) || 0) > this.rts.t),
    );
    if (!live.length || !from || !to) return null;
    const path = this.world.nav.findPath(from, to, 1);
    const pts = [{ x: from.x, z: from.z }, ...path];
    let best = null,
      bs = 1e9;
    for (const c of live) {
      if (hyp(c.pos.x, c.pos.z, to.x, to.z) < 30) continue;
      let along = 0;
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1],
          q = pts[i];
        // 野怪的出動半徑（12／12／16 m）＋野怪站的範圍：再遠的話攻擊移動（nc）會直接走過去
        if (segD(c.pos.x, c.pos.z, p.x, p.z, q.x, q.z) < (c.tier >= 3 ? 20 : 16)) {
          if (along + hyp(p.x, p.z, c.pos.x, c.pos.z) < bs)
            ((bs = along + hyp(p.x, p.z, c.pos.x, c.pos.z)), (best = c));
          break;
        }
        along += hyp(p.x, p.z, q.x, q.z);
      }
    }
    return best;
  },
  // 營地的戰力：看得到的野怪用實際血量，其他用編成的定義
  rtsAiCampPow(A, c) {
    const vis = (A.visN || []).filter((e) => e.creep === c.id);
    if (vis.length) return powOf(vis);
    return (c.set || []).reduce((s, id) => s + defPow(id), 0);
  },
  rtsAiCreepEnd(A, why, fail = 0) {
    const R = this.rts,
      C = A.creep;
    if (!C) return;
    if (fail) A.campFail.set(C.camp.id, R.t + fail);
    const back = [];
    for (const id of C.units) {
      const e = this.rtsEnt(id);
      if (e && !e.dead && !A.hj.has(id)) back.push(e);
    }
    A.creep = null;
    if (C.next === 'attack' && why === '完成') {
      A.blockT = 0; // 接著進攻（留在原地，下一次決策出發）
      A.resumeT = R.t;
    } else if (back.length) this.rtsAiOrd(A, back, { k: 'amove', x: A.rally.x, z: A.rally.z });
    this.rtsAiLog(A, `打野結束：${why}`);
  },
  rtsAiCreepTick(A, S) {
    const R = this.rts,
      C = A.creep,
      c = C.camp;
    const units = [];
    for (const id of C.units) {
      const e = this.rtsEnt(id);
      if (e && !e.dead && !A.hj.has(id)) units.push(e);
      else C.units.delete(id);
    }
    const heroes = units.filter((e) => e.hero);
    if (A.threatArmy.length) return this.rtsAiCreepEnd(A, '回防');
    if ((!heroes.length && !C.next) || units.length < 2) return this.rtsAiCreepEnd(A, '人手不足', 60);
    if (R.t - C.t0 > 150) return this.rtsAiCreepEnd(A, '逾時', 120);
    if (heroes.some((h) => h.hp < h.maxHp * 0.35)) {
      for (const h of heroes)
        if (h.hp < h.maxHp * 0.35) {
          A.hj.set(h.id, { k: 'retreat', t0: R.t });
          const home = S.hqs[0];
          if (home) this.rtsAiOrd(A, [h], { k: 'move', x: home.pos.x + 2, z: home.pos.z + 2 });
        }
      return this.rtsAiCreepEnd(A, '英雄受傷撤回', 90);
    }
    const creeps = (A.visN || []).filter((e) => e.creep === c.id && !e.dead);
    if (C.ph === 'stage') {
      const at = units.filter((u) => hyp(u.pos.x, u.pos.z, C.stage.x, C.stage.z) < 14).length;
      if (
        at >= units.length * 0.8 ||
        R.t - C.t0 > 30 ||
        creeps.some((e) => e.creep && R.camps.find((q) => q.id === e.creep && q.st === 'fight'))
      ) {
        C.ph = 'fight';
        C.fightT = R.t;
        const p = this.rtsAiWalk(c.pos.x, c.pos.z);
        this.rtsAiOrd(A, units, { k: 'amove', x: p.x, z: p.z });
      } else {
        const lag = units.filter((u) => !u.orders.length && hyp(u.pos.x, u.pos.z, C.stage.x, C.stage.z) > 10);
        if (lag.length) this.rtsAiOrd(A, lag, { k: 'move', x: C.stage.x, z: C.stage.z });
        return;
      }
    }
    if (C.ph === 'fight') {
      if (A.campDone.has(c.id)) {
        C.ph = 'loot';
        C.lootT = R.t;
        this.rtsAiLog(A, `營地清除：${c.id}`);
      } else {
        const pc = c.pos;
        const near = units.filter((u) => hyp(u.pos.x, u.pos.z, pc.x, pc.z) < 40);
        if (creeps.length && near.length && R.t - C.fightT > 5) {
          const cp = powOf(creeps),
            mp = powOf(near);
          if (cp * cp > mp * mp * 2 && near.length >= units.length * 0.7)
            return this.rtsAiCreepEnd(A, `打不過（${mp.toFixed(0)} 對 ${cp.toFixed(0)}）`, 180);
        }
        // 集火：血量最低的野怪
        let tgt = null;
        if (A.P.focus && creeps.length) {
          tgt = creeps.reduce((a, b) => (a.hp <= b.hp ? a : b));
        }
        const hit = [],
          go = [];
        for (const u of units) {
          const o = u.orders[0];
          if (o && (o.k === 'ability' || o.k === 'pickup')) continue;
          if (tgt && hyp(u.pos.x, u.pos.z, tgt.pos.x, tgt.pos.z) < 40) {
            if (!(o && o.k === 'attack' && o.id === tgt.id)) hit.push(u);
          } else if (!o || o.k === 'move') go.push(u);
        }
        if (hit.length) this.rtsAiOrd(A, hit, { k: 'attack', id: tgt.id });
        if (go.length) {
          const p = this.rtsAiWalk(pc.x, pc.z);
          this.rtsAiOrd(A, go, { k: 'amove', x: p.x, z: p.z });
        }
        // 營地看得到、一台野怪都沒有（別人清的）
        if (!creeps.length && near.length && this.rtsFogState(A.team, pc.x, pc.z) === 2 && R.t - C.t0 > 8)
          A.campDone.add(c.id);
      }
    }
    if (C.ph === 'loot') {
      // 撿道具：營地 30 m 內的（英雄背包有空）
      const h = heroes.find((q) => q.hero.inv.indexOf(null) >= 0);
      const it = h && (R.items || []).find((q) => hyp(q.x, q.z, c.pos.x, c.pos.z) < 30);
      if (it && R.t - C.lootT < 15) {
        const o = h.orders[0];
        if (!(o && o.k === 'pickup' && o.uid === it.uid)) this.rtsAiOrd(A, [h], { k: 'pickup', uid: it.uid });
        return;
      }
      this.rtsAiCreepEnd(A, '完成');
    }
  },

  // 從 a 走到 b 的直線經過（25 m 內）還在的野怪營地時，加一個繞過去的點（營地往旁邊 40 m、可以走的格子）
  rtsAiDetour(A, a, b) {
    const out = [];
    const dx = b.x - a.x,
      dz = b.z - a.z;
    const L = Math.hypot(dx, dz) || 1;
    for (const c of this.rts.camps || []) {
      if (c.cleared || c.off || A.campDone.has(c.id)) continue;
      if (segD(c.pos.x, c.pos.z, a.x, a.z, b.x, b.z) > 25) continue;
      const side = (c.pos.x - a.x) * -dz + (c.pos.z - a.z) * dx > 0 ? -1 : 1; // 營地在左邊就往右繞
      const p = this.rtsAiWalk(c.pos.x + (-dz / L) * 40 * side, c.pos.z + (dx / L) * 40 * side);
      out.push(p);
    }
    // 依沿路的順序
    out.sort((p, q) => (p.x - a.x) * dx + (p.z - a.z) * dz - ((q.x - a.x) * dx + (q.z - a.z) * dz));
    return out;
  },
  // ================= R3（F 包）：艾瑟立克的導管、融合、結晶護壁；跨陣營 =================

  // ---------- 導管（docs 14.6） ----------
  // 每次決策：①有建築停擺 → 朝它重蓋導管節點（最優先，保留資源）；②要電的建築找不到有電的位置（rtsAiBuild 記下
  // needNodeT）→ 在有電範圍的外緣蓋一座；③備援：生產建築與研究所要被 2 個以上的供電源覆蓋（或在根的範圍裡）
  rtsAiGrid(A, S) {
    if (!A.grid || !S.hqs.length) return;
    const R = this.rts,
      T = R.teams[A.team],
      ro = A.roles,
      ND = RTS_DEFS[ro.node];
    const busy =
      A.pend.filter((p) => p.def === ro.node).length + S.inprog.filter((b) => b.rtsDef === ro.node).length;
    this.rtsAiClaim(A, 'node');
    // ① 停擺：離主基地最近的那座
    let off = null,
      bd = 1e9;
    A.offN = 0;
    for (const b of S.blds)
      if (b.bld.off) {
        A.offN++;
        const d = hyp(b.pos.x, b.pos.z, A.base.pos.x, A.base.pos.z);
        if (d < bd) ((bd = d), (off = b));
      }
    if (off) {
      if (busy >= 2 || this.rtsAiThreatAt(A, off.pos.x, off.pos.z, 30)) return;
      const p = this.rtsAiNodeSpot(A, S, off.pos);
      if (!p) return;
      const ok = this.rtsAiBuild(A, S, ro.node, p, 0, 'fresh');
      if (ok) this.rtsAiNodeLog(A, `重蓋導管節點（${RTS_DEFS[off.rtsDef].name} 停擺）`);
      else if (ok === false) this.rtsAiKeep(A, ND.cost, 'node');
      return;
    }
    if (busy) return;
    // ② 要電的建築沒有位置
    if (R.t - (A.needNodeT || -1e9) < 6) {
      const ws = A.wantSpot;
      const p = ws ? this.rtsAiNodeSpot(A, S, ws, false, ws) : this.rtsAiNodeSpot(A, S, null);
      if (p && this.rtsAiBuild(A, S, ro.node, p, 0, true))
        this.rtsAiNodeLog(A, ws ? `導管節點（給${RTS_DEFS[ws.def].name}）` : '擴大導管範圍');
      A.needNodeT = -1e9;
      return;
    }
    // ③ 備援（開局之後、錢夠時；20 秒一次）
    if (A.si < A.steps.length || R.t < (A.redT || 0) || T.ore - A.res.ore < 160) return;
    A.redT = R.t + 20;
    const fields = this.rtsPowerFields(A.team).filter((f) => f.on);
    for (const b of S.blds) {
      if (b.bld.progress < 1 || !defOf(b).needPower) continue;
      if (!isProducer(b) && b.rtsDef !== ro.works) continue;
      let n = 0,
        root = false;
      for (const f of fields)
        if (hyp(f.x, f.z, b.pos.x, b.pos.z) <= f.r) {
          n++;
          if (f.root) root = true;
        }
      if (root || n >= 2) continue;
      const p = this.rtsAiNodeSpot(A, S, b.pos, true);
      if (p && this.rtsAiBuild(A, S, ro.node, p))
        this.rtsAiNodeLog(A, `備援導管節點（${RTS_DEFS[b.rtsDef].name}）`);
      return;
    }
  },
  rtsAiNodeLog(A, s) {
    A.nodeLog.push(s);
    if (A.nodeLog.length > 20) A.nodeLog.shift();
    this.rtsAiLog(A, s);
  },
  // 導管節點的位置（要在有電的供電源 link 內）：tgt＝要供電的點（停擺或備援的建築：節點的範圍要涵蓋它；
  // alt＝不要和現在覆蓋它的那座太近，被拆的時候才不會一起斷）；沒有 tgt＝往外擴大有電的範圍（離現有的供電源遠、
  // 離主基地近、在主基地的平台上）。規則同 rtsAiSpot：四周留通道、不擋坡道與主堡到礦脈的路、角度從主基地的方位起算
  // avoid＝{ x, z, w, d }：預定的建築位置（節點不要佔到它）
  rtsAiNodeSpot(A, S, tgt, alt = false, avoid = null) {
    const nav = this.world.nav,
      ro = A.roles,
      D = RTS_DEFS[ro.node];
    const [w, d] = D.foot;
    const cell = nav.cell,
      Sz = this.world.size / 2;
    const snap = (v, s) => Math.round((v - s / 2 + Sz) / cell) * cell - Sz + s / 2;
    const fields = this.rtsPowerFields(A.team).filter((f) => f.on);
    if (!fields.length) return null;
    const rp = A.base.ramp;
    const spin = Math.atan2(A.base.pos.z, A.base.pos.x);
    const reach = (D.conduit.r || 18) - 3; // 節點的範圍要涵蓋 tgt（留一點餘裕）
    const cov = tgt ? fields.filter((f) => hyp(f.x, f.z, tgt.x, tgt.z) <= f.r) : [];
    let best = null,
      bs = 1e9;
    const tryAt = (x, z) => {
      x = snap(x, w);
      z = snap(z, d);
      if (!nav.buildable(x, z, w + 3, d + 3)) return;
      if (
        avoid &&
        Math.abs(x - avoid.x) < (avoid.w + w) / 2 + 3 &&
        Math.abs(z - avoid.z) < (avoid.d + d) / 2 + 3
      )
        return;
      if (this.rtsPowerWhy(A.team, ro.node, x, z)) return; // 要接得上
      if (hyp(x, z, rp.top.x, rp.top.z) < 10 || hyp(x, z, rp.bottom.x, rp.bottom.z) < 8) return;
      if (this.rtsAiBlocksPath(A, S, x, z, 2.5)) return;
      let dn = 1e9;
      for (const f of fields) dn = Math.min(dn, hyp(f.x, f.z, x, z));
      const dh = Math.abs(this.world.terrainHeight(x, z) - A.base.h);
      let sc;
      if (tgt) {
        const dt = hyp(x, z, tgt.x, tgt.z);
        // 涵蓋得到 tgt 的優先；涵蓋不到時（鏈斷得遠）往 tgt 的方向接
        sc = dt <= reach ? dt * 0.3 : 40 + dt;
        if (alt) for (const f of cov) if (hyp(f.x, f.z, x, z) < 10) sc += 20;
        if (dn < 6) sc += 10;
      } else {
        // 往外擴：離現有的供電源遠、在主基地平台的外圍（中間留給大建築）
        const db = hyp(x, z, A.base.pos.x, A.base.pos.z);
        sc =
          -Math.min(dn, 26) * 1.2 -
          Math.min(db, A.base.r) * 0.5 +
          (db > A.base.r + 6 ? 25 : 0) +
          (dh > 2 ? 30 : 0);
      }
      if (sc < bs) ((bs = sc), (best = { x, z }));
    };
    if (tgt)
      for (let r = 4; r <= 16; r += 3)
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * 6.283 + spin + r * 0.37;
          tryAt(tgt.x + Math.cos(a) * r, tgt.z + Math.sin(a) * r);
        }
    if (!best)
      for (const f of fields)
        for (let r = 12; r <= 30; r += 6)
          for (let i = 0; i < 12; i++) {
            const a = (i / 12) * 6.283 + spin + r * 0.37;
            tryAt(f.x + Math.cos(a) * r, f.z + Math.sin(a) * r);
          }
    return best;
  },

  // ---------- 融合（docs 14.6） ----------
  // T2＋培養槽之後，家裡閒置的實驗體超過 fuse.keep 隻時每 3 隻融合一組（Coral 不夠時不融合、先生產）；
  // T3＋原型體協定而且 fuse.proto：2 隻閒置的嵌合體＋Coral 夠就融合原型體。pre＝進攻出發前（不留實驗體）。回傳下了幾組
  rtsAiFuse(A, S, pre = false) {
    if (!A.grid || !A.op.fuse) return 0;
    const R = this.rts,
      T = R.teams[A.team];
    if (!pre && R.t < (A.fuseT || 0)) return 0;
    const at = (u) =>
      !A.atk.has(u.id) &&
      !(A.creep && A.creep.units.has(u.id)) &&
      !(A.har && A.har.ids.has(u.id)) &&
      !u.rtsFusing &&
      (hyp(u.pos.x, u.pos.z, A.base.pos.x, A.base.pos.z) < 50 ||
        hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) < 25) &&
      (!u.orders.length || u.orders[0].k === 'amove' || u.orders[0].k === 'move');
    let free = T.coral - Math.max(0, A.res.coral);
    let n = 0;
    const go = (recipe, list, keep) => {
      const F = RTS_FUSE[recipe];
      if (this.rtsFuseWhy(A.team, recipe)) return;
      const k = Math.min(Math.floor((list.length - keep) / F.n), Math.floor(free / F.coral));
      if (k <= 0) return;
      // 集結點附近的先融合（離得近、集合快）
      list.sort(
        (a, b) => hyp(a.pos.x, a.pos.z, A.rally.x, A.rally.z) - hyp(b.pos.x, b.pos.z, A.rally.x, A.rally.z),
      );
      const g = this.rtsAiOrd(A, list.slice(0, k * F.n), { k: 'fuse', recipe }) || 0;
      if (g > 0) {
        n += g;
        free -= g * F.coral;
        A.fuseN += g;
        this.rtsAiLog(A, `${F.name} ×${g}`);
      }
    };
    go(
      'fu_chimera',
      S.army.filter((u) => u.rtsDef === 'a_blob' && at(u)),
      pre ? 0 : A.op.fuse.keep,
    );
    if (A.op.fuse.proto)
      go(
        'fu_proto',
        S.army.filter((u) => u.rtsDef === 'a_chimera' && at(u)),
        0,
      );
    A.fuseT = R.t + 3;
    return n;
  },

  // ---------- 結晶護壁（取代民兵；docs 14.6） ----------
  // 基地的威脅戰力² > 留守² × 1.5、而且有建築的血量 < 60%：離它近（34 m 內）的研究中樞施放
  rtsAiAegis(A, S, home, tc, thPow) {
    if (!tc) return;
    const mine = powOf(home) + powOf(S.heroes);
    if (thPow * thPow <= mine * mine * 1.5) return;
    let hurt = null;
    for (const b of S.blds)
      if (b.bld.progress >= 1 && b.hp < b.maxHp * 0.6 && hyp(b.pos.x, b.pos.z, tc.x, tc.z) < 50) {
        hurt = b;
        break;
      }
    if (!hurt) return;
    const hq = S.hqs.find(
      (h) => hyp(h.pos.x, h.pos.z, hurt.pos.x, hurt.pos.z) < 34 && !this.rtsFactionAegisWhy(h),
    );
    if (hq && this.rtsAiOrd(A, [hq], { k: 'ability', ab: 'ab_aegis' })) {
      A.aegisN++;
      this.rtsAiLog(A, '結晶護壁');
    }
  },

  // ---------- 兵種相剋的權重（兩個陣營；docs 14.6） ----------
  // 最近 3 分鐘看過的敵方單位的護甲（人口加權）：每種攻擊類型的平均相剋倍率（0.6～1.6）
  // （鏡像對戰不加權：兩邊同樣的兵種，加權只會改變 R2 已經調好的卡斯特隆鏡像）
  rtsAiCounterK(A) {
    if (A.counterK) return A.counterK;
    const R = this.rts;
    if (A.foeFac === A.fac) {
      A.counterK = {};
      for (const atk in RTS_TYPE_K) A.counterK[atk] = 1;
      return A.counterK;
    }
    const out = {};
    let tot = 0;
    const arms = {};
    for (const s of A.armSeen.values()) {
      arms[s.arm] = (arms[s.arm] || 0) + s.pop;
      tot += s.pop;
    }
    // 記得的敵方建築（城甲）也算一點：後期對方的部隊打光了、剩下要拆建築時，攻城的兵種（爆發）變多
    const nb = (A.known || []).length;
    if (nb && R.t > 900) {
      const w = nb * (tot < 12 ? 1.5 : 0.5);
      arms.fort = (arms.fort || 0) + w;
      tot += w;
    }
    for (const atk in RTS_TYPE_K) {
      if (tot < 6) {
        out[atk] = 1;
        continue;
      }
      let k = 0;
      for (const arm in arms)
        k += (RTS_TYPE_K[atk][arm] === undefined ? 1 : RTS_TYPE_K[atk][arm]) * arms[arm];
      out[atk] = Math.max(0.6, Math.min(1.6, k / tot));
    }
    return (A.counterK = out);
  },

  // ---------- 騷擾導管節點（困難以上，對方是艾瑟立克；docs 14.6） ----------
  rtsAiHarass(A, S, home) {
    const R = this.rts;
    if (A.har) {
      const us = [...A.har.ids].map((id) => this.rtsEnt(id)).filter((e) => e && !e.dead);
      const alive = (A.known || []).some((k) => k.id === A.har.id);
      if (!us.length || !alive || R.t - A.har.t0 > 75 || A.threatArmy.length) {
        if (us.length) this.rtsAiOrd(A, us, { k: 'amove', x: A.rally.x, z: A.rally.z });
        this.rtsAiLog(A, `騷擾結束（${alive ? '撤回' : '節點已拆'}）`);
        A.har = null;
        A.harT = R.t + 90;
      }
      return;
    }
    if (!A.P.harass || !A.foeGrid || A.mode !== 'home' || A.creep || R.t < (A.harT || 0)) return;
    if (home.length < Math.max(6, A.need * 0.5)) return;
    const hqs = (A.known || []).filter((k) => (RTS_DEFS[k.def] || {}).dropoff);
    let best = null,
      bd = 1e9;
    for (const k of A.known || []) {
      const D = RTS_DEFS[k.def] || {};
      if (!D.conduit || D.conduit.root) continue;
      if (hqs.some((h) => hyp(h.x, h.z, k.x, k.z) < 40)) continue; // 主堡旁的不算外圍
      const d = hyp(k.x, k.z, A.rally.x, A.rally.z);
      if (d < bd) ((bd = d), (best = k));
    }
    if (!best) return;
    const us = home
      .filter((u) => !u.rtsFusing && !defOf(u).melee)
      .sort((a, b) => (defOf(b).speed || 0) - (defOf(a).speed || 0))
      .slice(0, 4);
    if (us.length < 4) return;
    const p = this.rtsAiApproach(best.x, best.z, 2, centroid(us));
    A.har = { ids: new Set(us.map((u) => u.id)), id: best.id, t0: R.t };
    this.rtsAiOrd(A, us, { k: 'amove', x: p.x, z: p.z, nc: true });
    this.rtsAiOrd(A, us, { k: 'attack', id: best.id }, true);
    this.rtsAiLog(A, `騷擾導管節點：${best.id}`);
  },
  // 看得到的敵方建築（實體）→ 記得的紀錄的 rtsAiDeps
  rtsAiDepsOf(A, e) {
    if (!defOf(e).conduit) return 0;
    const k = (A.known || []).find((q) => q.id === e.id);
    return k ? this.rtsAiDeps(A, k) : 0;
  },
  // 拆掉這座（記得的）敵方建築會讓幾座建築停擺（只用記得的建築計算，不讀對方的導管網；結果快取到記得的建築有變化）
  rtsAiDeps(A, k) {
    const D = RTS_DEFS[k.def] || {};
    if (!D.conduit || !this.rtsPowerDeps) return 0;
    const key = (A.known || []).length + ':' + (A.bldGone ? A.bldGone.size : 0);
    if (A.depsKey !== key) {
      A.depsKey = key;
      A.deps = new Map();
    }
    if (!A.deps.has(k.id)) A.deps.set(k.id, this.rtsPowerDeps(k, A.known || []));
    return A.deps.get(k.id);
  },

  // ---------- 偵查 ----------
  rtsAiScout(A, S) {
    const R = this.rts;
    const known = (A.known || []).length > 0;
    if (A.scout) {
      const u = A.scout.u;
      const done = u.dead || known || !u.orders.length || R.t > A.scout.until;
      if (done) {
        if (!u.dead) {
          if (defOf(u).worker) this.rtsSetOrders(u, []);
          else this.rtsAiOrd(A, [u], { k: 'move', x: A.rally.x, z: A.rally.z });
        }
        this.rtsAiLog(A, known ? '偵查到對方基地' : u.dead ? '偵查兵被擊破' : '偵查結束');
        A.scout = null;
        A.scoutAgain = R.t + (u.dead ? 90 : 60); // 沒找到：之後再派
      }
      return;
    }
    if (known || R.t < A.P.scoutT || (A.scouted && R.t < (A.scoutAgain || 0))) return;
    if (A.mode === 'attack') return;
    // 偵查兵：有部隊時用部隊（集結中的），否則用工人
    let u = S.army.find((e) => !A.atk.has(e.id) && !e.orders.length);
    if (!u) u = this.rtsAiPickWorker(A, S, A.base.pos);
    if (!u) return;
    // 守著礦脈的野怪營地旁的點不去（出生點候選照去）
    const live = (this.rts.camps || []).filter((c) => !c.cleared && !c.off && !A.campDone.has(c.id));
    const pts0 = A.explore
      .filter((p) => p.base || !live.some((c) => hyp(c.pos.x, c.pos.z, p.x, p.z) < 28))
      .slice(0, 3);
    if (!pts0.length) return;
    // 繞開還在的野怪營地（以前偵查兵常常在路上被野怪打掉）
    const pts = [];
    let from = u.pos;
    for (const p of pts0) {
      for (const w of this.rtsAiDetour(A, from, p)) pts.push(w);
      pts.push(p);
      from = p;
    }
    this.rtsAiOrd(A, [u], { k: 'move', x: pts[0].x, z: pts[0].z });
    for (const p of pts.slice(1)) this.rtsAiOrd(A, [u], { k: 'move', x: p.x, z: p.z }, true);
    A.scout = { u, until: R.t + 120 };
    A.scouted = true;
    this.rtsAiLog(A, `派偵查（${defOf(u).name}）`);
  },
});

// 生產部隊的建築（兵工廠、重工廠、停機坪；主堡只生產工人與英雄）
function isProducer(b) {
  const D = RTS_DEFS[b.rtsDef];
  return !!(D && D.trains && D.trains.some(isArmyDef));
}
function isArmyDef(id) {
  const D = RTS_DEFS[id];
  return !!(D && D.kind === 'unit' && !D.worker && (D.range || 0) > 0);
}
