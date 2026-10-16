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
// 測試與除錯：cfg.aiBoth（或 g.rtsAiBoth）＝兩邊都是電腦，cfg.aiOpener（或 g.rtsAiOpener）指定開局，g.rtsAiOff＝不啟動；
// R.ai[i].ms／msMax 是決策的耗時，R.ai[i].log 是重要事件（進攻、撤退、開分礦…）。
import { RTS_DEFS, RTS_FACTIONS, RTS_GATHER, RTS_POP_MAX } from '../data/rts-units.js';
import { RTS_AI_DIFFS, RTS_AI_OPENERS, RTS_AI_ROLES } from '../data/rts-ai.js';
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
const isArmy = (e) => !e.bld && !defOf(e).worker && (defOf(e).range || 0) > 0;
// 戰力：Σ√(血量×dps)（盾牌 MT 的正面大盾算 1.6 倍）；比較時取平方（Lanchester 平方律）
const unitPow = (e) => {
  const D = defOf(e);
  if (!D.dps || e.bld) return 0;
  return Math.sqrt(Math.max(0, e.hp) * D.dps * (D.ai === 'shield' ? 1.6 : 1));
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
      const P = RTS_AI_DIFFS[diff] || RTS_AI_DIFFS.normal;
      const roles = RTS_AI_ROLES[T.faction] || RTS_AI_ROLES.castron;
      const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
      const ops = RTS_AI_OPENERS[T.faction] || RTS_AI_OPENERS.castron;
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
    this.rtsOrder(units, o, queue);
    A.ordMs += performance.now() - t0;
  },
  rtsAiClear() {
    if (this.rts) this.rts.ai = null;
  },
  rtsAiLog(A, s) {
    const t = this.rts ? this.rts.t : 0;
    A.log.push(`${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} ${s}`);
    if (A.log.length > 60) A.log.shift();
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
    this.rtsAiIntel(A, S);
    this.rtsAiEconomy(A, S);
    this.rtsAiMilitary(A, S);
    this.rtsAiScout(A, S);
  },
  // 自己的單位分類；派出去蓋的建築（pend）整理
  rtsAiScan(A) {
    const R = this.rts,
      ro = A.roles;
    const S = {
      all: [],
      workers: [],
      army: [],
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
      else if (isArmy(e)) S.army.push(e);
    }
    A.pend = A.pend.filter((p) => {
      const alive = !p.w.dead && p.w.orders.includes(p.o);
      if (alive && p.o.bid === undefined && this.rts.t - p.t > PEND_T) {
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
  rtsAiCan(A, cost, keep = true) {
    const o = cost.ore || 0,
      c = cost.coral || 0;
    return this.rtsAfford(A.team, {
      ore: o + (keep && o > 0 ? A.res.ore : 0),
      coral: c + (keep && c > 0 ? A.res.coral : 0),
      pop: cost.pop || 0,
    });
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
    const vis = this.rtsFogEnemies(A.team);
    A.vis = vis;
    A.visArmy = vis.filter(isArmy);
    for (const e of A.visArmy) A.seen.set(e.id, { t: R.t, pow: unitPow(e) });
    for (const [id, s] of A.seen) if (R.t - s.t > 90) A.seen.delete(id);
    A.known = this.rtsFogKnown(A.team).filter((k) => !k.gone);
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
    const facs = S.done[ro.factory] || 0;
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
      this.rtsAiBuild(A, S, ro.depot);
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
      const facOver = s.b === A.roles.factory && s.n > A.P.facMax;
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
      if (ok === false) this.rtsAiReserve(A, D.cost);
      else if (ok === null && (s.fail = (s.fail || 0) + 1) > 12) {
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
        if (this.rtsAiExpand(A, S, true) === false) this.rtsAiReserve(A, RTS_DEFS[ro.hq].cost);
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
      active < P.hqMax &&
      (R.t > P.expandT * A.op.expandK || (low && R.t > 600)) &&
      (S.workers.length >= sat * 0.8 || low) &&
      !A.threatArmy.length
    ) {
      if (this.rtsAiExpand(A, S) === false) this.rtsAiReserve(A, RTS_DEFS[ro.hq].cost);
    }
    // 兵工廠：上限依難度與主堡數；錢多時才蓋
    const facN = S.count[ro.factory] || 0;
    const facWant = Math.min(P.facMax + (T.ore > 1500 ? 1 : 0), 1 + S.hqs.length + (T.ore > 700 ? 1 : 0));
    const facBusy = A.pend.some((p) => p.def === ro.factory) || S.inprog.some((b) => b.rtsDef === ro.factory);
    if (facN < facWant && !facBusy && (facN === 0 || T.ore - A.res.ore > 320))
      this.rtsAiBuild(A, S, ro.factory);
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
    // 工地沒有人施工：派最近的工人續建
    for (const b of S.inprog) {
      if (b.bld.builders.size) continue;
      if (S.workers.some((w) => w.orders[0] && w.orders[0].k === 'build' && w.orders[0].bid === b.id))
        continue;
      if (this.rtsAiThreatAt(A, b.pos.x, b.pos.z, 25)) continue;
      const w = this.rtsAiPickWorker(A, S, b.pos);
      if (w) this.rtsAiOrd(A, [w], { k: 'build', def: b.rtsDef, x: b.pos.x, z: b.pos.z, bid: b.id });
    }
    // 修理：受損的建築（附近沒有敵方部隊時）
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
    const plan = this.world.rts;
    let best = null,
      bs = 1e9;
    this.rts.corals.forEach((v, i) => {
      if (v.amount <= 200 || (v.ext && !v.ext.dead)) return;
      if (A.pend.some((q) => q.def === A.roles.extractor && hyp(q.o.x, q.o.z, v.pos.x, v.pos.z) < 3)) return;
      const own = plan.corals[i] && plan.corals[i].owner === A.team;
      let d = 1e9;
      for (const h of S.hqs) d = Math.min(d, hyp(h.pos.x, h.pos.z, v.pos.x, v.pos.z));
      if (!own && d > 60) return;
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
  rtsAiBuild(A, S, def, at) {
    const D = RTS_DEFS[def];
    if (!D || !this.rtsAiCan(A, D.cost)) return false;
    let p = at || null;
    if (!p && D.on === 'coral') {
      const v = this.rtsAiVent(A, S);
      if (!v) return null;
      p = v.pos;
    }
    if (!p) p = this.rtsAiSpot(A, S, def);
    if (!p) return null;
    const w = this.rtsAiPickWorker(A, S, p);
    if (!w) return null;
    const o = { k: 'build', def, x: p.x, z: p.z, yaw: 0 };
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
  rtsAiSpot(A, S, def) {
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
    centers.push({ c: A.rally, R: 30 }); // 都滿了：坡道下
    const k = A.team + ':' + def;
    if (A.spotFail && A.spotFail[k] > this.rts.t) return null; // 剛剛找不到：過一下再找
    let best = null,
      bs = 1e9,
      tries = 0;
    centers.forEach(({ c, R: R0, plat }) => {
      if (best) return; // 前面的中心找到了就用（基地優先）
      for (let r = 8; r <= R0 && tries < 1500; r += 4) {
        const n = Math.max(8, Math.round((r * 6.283) / 6));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * 6.283 + r * 0.37;
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
          // 主基地：平台上（高度差不多）優先
          const gy = this.world.terrainHeight(x, z);
          const sc = s0 + (plat && Math.abs(gy - A.base.h) > 2 ? 25 : 0);
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
  rtsAiExpand(A, S, rebuild = false) {
    const R = this.rts,
      D = RTS_DEFS[A.roles.hq];
    if (!this.rtsAiCan(A, D.cost)) return false;
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
    const ok = this.rtsAiBuild(A, S, A.roles.hq, p);
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
    const atk = army.filter((e) => A.atk.has(e.id));
    const home = army.filter((e) => !A.atk.has(e.id));
    // 兵工廠的集結點：坡道口
    for (const b of S.blds)
      if (b.bld.progress >= 1 && b.rtsDef === A.roles.factory && !b.bld.rally)
        this.rtsSmart([b], A.rally.x, A.rally.z, null);
    // 基地被攻擊：回防（威脅大於留守的部隊時召回進攻中的部隊）
    const thPow = powOf(A.threatArmy);
    const threatened = A.threat.length > 0;
    if (threatened) {
      const tc = centroid(A.threat);
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
        if (A.atk.has(u.id)) continue;
        const o = u.orders[0];
        if (P.focus && tgt && hyp(u.pos.x, u.pos.z, tgt.pos.x, tgt.pos.z) < 40) {
          if (!(o && o.k === 'attack' && o.id === tgt.id)) hit.push(u);
        } else if (!o || (o.k === 'amove' && hyp(o.x, o.z, tc.x, tc.z) > 15) || o.k === 'move') go.push(u);
      }
      if (hit.length) this.rtsAiOrd(A, hit, { k: 'attack', id: tgt.id });
      if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: tc.x, z: tc.z });
      A.defT = R.t;
    } else if (home.length) {
      // 集結：沒有指令、或防守結束還在外面的回到坡道口
      const idle = home.filter((u) => !u.orders.length && hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) > 14);
      if (idle.length) this.rtsAiOrd(A, idle, { k: 'amove', x: A.rally.x, z: A.rally.z });
    }
    if (A.mode === 'attack') this.rtsAiAttackTick(A, S, atk, home);
    else if (!threatened || !A.threatArmy.length) this.rtsAiMaybeAttack(A, S, home);
  },
  // 生產部隊：每座兵工廠的佇列保持 1 項（依開局的比例；Coral 不夠時生產不用 Coral 的）
  rtsAiTrain(A, S) {
    const P = A.P,
      mix = A.si < A.steps.length ? A.op.mix : { ...A.op.mix, c_shield: Math.max(1, A.op.mix.c_shield || 0) };
    let n = S.army.length + Object.keys(S.queued).reduce((s, k) => s + (isArmyDef(k) ? S.queued[k] : 0), 0);
    for (const b of S.blds) {
      const qMax = this.rts.teams[A.team].ore > 800 ? 2 : 1; // 錢多時佇列放兩項（不中斷）
      if (b.bld.progress < 1 || b.rtsDef !== A.roles.factory || b.bld.queue.length >= qMax) continue;
      if (n >= this.rtsAiArmyCap(A)) return;
      // 比例最低的兵種
      const have = (id) => S.army.filter((e) => e.rtsDef === id).length + (S.queued[id] || 0);
      const opts = Object.keys(mix)
        .filter((id) => mix[id] > 0 && (RTS_DEFS[b.rtsDef].trains || []).includes(id))
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
    // 可以出動的：集結點附近的，加上沒有在交戰（攻擊指令）的留守部隊
    const ready = home.filter(
      (u) => hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) < 40 || !(u.orders[0] && u.orders[0].k === 'attack'),
    );
    const n = ready.length;
    let need = A.need;
    if (R.t > P.allInT) need = Math.min(need, P.allInN);
    let why = null;
    if (R.t >= A.attackT && n >= need) why = `部隊 ${n} 台`;
    else if (T.pop >= RTS_POP_MAX - 6 && n >= 4) why = '人口已滿';
    else if (R.t >= A.attackT && n >= Math.min(need, 5) && R.t - A.enemySeenT < 90) {
      // 對方的部隊（最近 90 秒看過的）明顯比較弱
      let ep = 0;
      for (const s of A.seen.values()) ep += s.pow;
      if (ep * ep * 2.5 < powOf(ready) ** 2) why = '偵查到對方兵力薄弱';
    }
    if (!why) return;
    A.mode = 'attack';
    A.atkStart = R.t;
    A.atkN = n;
    A.focus = null;
    for (const u of ready) A.atk.add(u.id);
    A.obj = this.rtsAiObjective(A, centroid(ready));
    A.waves++;
    if (A.firstAtk === null) A.firstAtk = R.t;
    this.rtsAiLog(A, `進攻 #${A.waves}：${why}${A.obj && A.obj.explore ? '（搜索）' : ''}`);
    this.rtsAiSendTo(A, ready, A.obj);
  },
  // 進攻目標：記得的敵方建築（離部隊最近、主堡優先一點）；不知道時依序搜索
  rtsAiObjective(A, from) {
    from = from || A.rally;
    let best = null,
      bs = 1e9;
    for (const k of A.known || []) {
      const D = RTS_DEFS[k.def] || {};
      const s = hyp(k.x, k.z, from.x, from.z) - (D.trains && D.trains.length ? 15 : 0);
      if (s < bs) ((bs = s), (best = k));
    }
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
    this.rtsAiOrd(A, units, { k: 'amove', x: p.x, z: p.z });
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
    // 戰力比較（視野內）：部隊附近的敵方部隊 vs 離那群敵人不遠的我方部隊
    const foes = A.visArmy.filter((e) => atk.some((u) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < NEAR_R));
    const fc = centroid(foes);
    const ours = fc ? atk.filter((e) => hyp(e.pos.x, e.pos.z, fc.x, fc.z) < NEAR_R + 15) : atk;
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
    // 目標：建築已經確認沒了、或搜索點到了 → 換下一個
    let obj = A.obj;
    if (obj && obj.id !== undefined && !(A.known || []).some((k) => k.id === obj.id)) obj = null;
    if (obj && obj.explore !== undefined) {
      if ((A.known || []).length) obj = null;
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
    const near = A.vis.filter((e) => live.some((u) => hyp(e.pos.x, e.pos.z, u.pos.x, u.pos.z) < 32));
    // 兵力壓倒性（戰力² 6 倍以上）時集火建築：不要一直和對方陸續生產出來的單位纏鬥
    // （附近沒有建築時不理會零星的單位，繼續往目標前進：攻擊移動沿路會自己迎擊）
    const crush = op * op > fp * fp * 6 && live.length >= 6;
    const pool = crush ? near.filter((e) => e.bld) : near;
    // 壓倒性而且附近有好幾座建築：分頭拆（最多三座，每台去離自己最近的那座）
    if (crush && P.focus && pool.length >= 2 && live.length >= 10) {
      const tb = pool
        .slice()
        .sort((a, b) => hyp(a.pos.x, a.pos.z, c.x, c.z) - hyp(b.pos.x, b.pos.z, c.x, c.z))
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
        if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: ap.x, z: ap.z });
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
    if (near2.length) this.rtsAiOrd(A, near2, { k: 'amove', x: bp.x, z: bp.z });
    if (go.length) this.rtsAiOrd(A, go, { k: 'amove', x: obj.ax, z: obj.az });
    this.rtsAiReinforce(A, home, obj);
  },
  // 增援：坡道口累積的部隊成群加入進攻
  rtsAiReinforce(A, home, obj) {
    const ready = home.filter((u) => !u.orders.length && hyp(u.pos.x, u.pos.z, A.rally.x, A.rally.z) < 20);
    if (ready.length >= (A.P.focus ? 3 : 4) && !A.threat.length) {
      for (const u of ready) A.atk.add(u.id);
      this.rtsAiOrd(A, ready, { k: 'amove', x: obj.ax, z: obj.az });
    }
  },
  // 集火的目標：會還手的部隊優先（血量低的、近的）；正面大盾的盾牌 MT 與建築其次（建築大、一定打得中）；
  // 工人最後（小、會跑，機槍打不太中）。打了一陣子血量沒有掉的（被擋住、打不到）暫時不選
  rtsAiFocusPick(A, c, list) {
    const R = this.rts;
    // 盾牌 MT 擋在前面（後面的打不到、一直換目標）：先打盾牌
    const shieldFirst = R.t < (A.shieldT || 0);
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
          ? 120 + e.hp / 100 + (D.trains && D.trains.length ? -15 : 0)
          : D.worker
            ? 200 + e.hp / 40
            : D.ai === 'shield'
              ? (shieldFirst ? 0 : 150) + e.hp / 40
              : (shieldFirst ? 150 : 0) + e.hp / 40);
      if (s < bs) ((bs = s), (best = e));
    }
    if (best && best.id !== A.focusId) {
      A.focusId = best.id;
      A.focusHp = best.hp;
      A.focusT = R.t;
    }
    return best;
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
    const pts = A.explore.slice(0, 3);
    if (!pts.length) return;
    this.rtsAiOrd(A, [u], { k: 'move', x: pts[0].x, z: pts[0].z });
    for (const p of pts.slice(1)) this.rtsAiOrd(A, [u], { k: 'move', x: p.x, z: p.z }, true);
    A.scout = { u, until: R.t + 120 };
    A.scouted = true;
    this.rtsAiLog(A, `派偵查（${defOf(u).name}）`);
  },
});

function isArmyDef(id) {
  const D = RTS_DEFS[id];
  return !!(D && D.kind === 'unit' && !D.worker && (D.range || 0) > 0);
}
