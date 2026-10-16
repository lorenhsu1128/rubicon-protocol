// Coral 戰爭（RTS）的指令發佈（mixin）：rtsOrder(units, order, queue)、智慧指令 rtsSmart(units, x, z, target, queue)、
// 尋路的排隊服務（rtsPathReq／rtsPathService）。指令格式見 docs/rts-design.md 12.3，執行在 entities/mech-rts.js。
// - 多個單位移動到同一點（move／amove／patrol）：同一種尺寸 3 台以上時共用一個流場（world.nav.flowField，以目標格快取），
//   終點散開成陣形（o.sx／o.sz：從中心往外的格點，近的單位分到近的位置）；少數單位各自用 A* 路徑。
// - A* 路徑不在下指令時算：rtsPathReq 排進佇列，rtsPathService 每格最多算 PATH_PER_FRAME 條（或 PATH_MS 毫秒），
//   120 個不同目標的指令分散到幾格。
// - 建造只派一個工人（最近的）；採集、修理派全部的工人，戰鬥單位改成走過去。
import { Game } from './game.js';
import { RTS_DEFS, RTS_GATHER } from '../data/rts-units.js';

const PATH_PER_FRAME = 16;
const PATH_MS = 3;
const FLOW_MIN = 3; // 幾台以上共用流場

Object.assign(Game.prototype, {
  // 指令：units 是實體陣列（建築會被略過，集結點另外處理）；queue＝Shift 排隊
  rtsOrder(units, order, queue = false) {
    const R = this.rts;
    if (!R || !order) return;
    const list = (units || []).filter((e) => e && !e.dead && !e.bld && e.rtsDef);
    if (!list.length) return;
    const k = order.k;
    if (k === 'stop') {
      for (const e of list) this.rtsSetOrders(e, []);
      return;
    }
    if (k === 'hold') {
      for (const e of list) this.rtsSetOrders(e, queue ? [...e.orders, { k: 'hold' }] : [{ k: 'hold' }]);
      return;
    }
    const give = (e, o) => {
      if (queue && e.orders.length) e.orders.push(o);
      else this.rtsSetOrders(e, [o]);
    };
    if (k === 'build') {
      // 建造：只派最近的一個工人
      const ws = list.filter((e) => RTS_DEFS[e.rtsDef].worker);
      if (!ws.length) return;
      let w = ws[0],
        bd = 1e9;
      for (const e of ws) {
        const d = Math.hypot(e.pos.x - order.x, e.pos.z - order.z);
        if (d < bd) ((bd = d), (w = e));
      }
      give(w, { ...order });
      return;
    }
    if (k === 'gather' || k === 'repair') {
      for (const e of list) {
        if (RTS_DEFS[e.rtsDef].worker) give(e, { ...order });
        else {
          // 戰鬥單位：走過去
          const t = k === 'gather' ? this.rtsMine(order.mine) : this.rtsEnt(order.id);
          if (t) give(e, { k: 'move', x: t.pos.x, z: t.pos.z });
        }
      }
      return;
    }
    if (k === 'attack') {
      for (const e of list) give(e, { ...order });
      return;
    }
    if (k === 'move' || k === 'amove' || k === 'patrol') {
      const nav = this.world.nav;
      // 依導航尺寸分組：同一組共用流場與陣形
      const by = new Map();
      for (const e of list) {
        const s = RTS_DEFS[e.rtsDef].size || 0;
        if (!by.has(s)) by.set(s, []);
        by.get(s).push(e);
      }
      const slots = this.rtsFormation(order.x, order.z, list);
      for (const [size, grp] of by) {
        const flow = grp.length >= FLOW_MIN && nav ? nav.flowField(order.x, order.z, size) : null;
        for (const e of grp) {
          const s = slots.get(e);
          const o = { ...order, flow };
          if (s && k !== 'patrol') {
            o.sx = s.x;
            o.sz = s.z;
          }
          if (k === 'patrol' && o.x0 === undefined) {
            o.x0 = e.pos.x;
            o.z0 = e.pos.z;
          }
          give(e, o);
        }
      }
      return;
    }
    for (const e of list) give(e, { ...order });
  },
  // 換掉一個單位的全部指令（離開目前指令的清理在 mech-rts.js 的 rtsLeaveOrder，由下一格偵測）
  rtsSetOrders(e, orders) {
    e.orders = orders;
  },
  // 陣形：從中心往外的格點（間距依單位大小），只放在可以走的格子；近的單位分到近的位置。回傳 Map(實體 → {x, z})
  rtsFormation(x, z, units) {
    const out = new Map();
    const n = units.length;
    if (n <= 1) {
      if (n) out.set(units[0], { x, z });
      return out;
    }
    const nav = this.world.nav;
    let sp = 0;
    for (const e of units) sp = Math.max(sp, (e.radius || 1.2) * 2 + 0.8);
    const size = Math.max(...units.map((e) => RTS_DEFS[e.rtsDef].size || 0));
    const pts = [];
    for (let ring = 0; pts.length < n && ring < 12; ring++) {
      if (ring === 0) {
        pts.push({ x, z });
        continue;
      }
      // 方形環：邊長 2×ring 格
      for (let i = -ring; i <= ring; i++)
        for (let j = -ring; j <= ring; j++) {
          if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
          const px = x + i * sp,
            pz = z + j * sp;
          if (nav && !nav.walkableAt(px, pz, size)) continue;
          pts.push({ x: px, z: pz });
        }
    }
    // 由近到遠分配：每個位置給還沒分到、離它最近的單位（單位從平均位置看過去的方向相同時，大致保持相對位置）
    let cx = 0,
      cz = 0;
    for (const e of units) ((cx += e.pos.x), (cz += e.pos.z));
    cx /= n;
    cz /= n;
    const left = new Set(units);
    for (const p of pts) {
      if (!left.size) break;
      let best = null,
        bd = 1e9;
      for (const e of left) {
        // 單位相對於群體中心的位置，對應到相對於目標的位置
        const d = Math.hypot(e.pos.x - cx - (p.x - x), e.pos.z - cz - (p.z - z));
        if (d < bd) ((bd = d), (best = e));
      }
      out.set(best, p);
      left.delete(best);
    }
    for (const e of left) out.set(e, { x, z });
    return out;
  },
  // 智慧指令（右鍵）：敵人＝攻擊；礦脈＝工人採集；受損的己方建築＝工人修理（蓋到一半＝續建）；
  // 只選了建築＝設集結點；其他＝移動
  rtsSmart(units, x, z, target, queue = false) {
    const R = this.rts;
    if (!R) return;
    const sel = (units || []).filter((e) => e && !e.dead);
    const blds = sel.filter((e) => e.bld);
    const mob = sel.filter((e) => !e.bld && e.rtsDef);
    // 礦脈：沒有點到東西時看地上有沒有礦脈
    let mine = target && !this.rtsIsEntity(target) ? target : null;
    if (!target) mine = this.rtsMineAt(x, z, RTS_GATHER.mineR + 1.5);
    const ent = this.rtsIsEntity(target) ? target : null;
    if (!mob.length) {
      // 集結點（點礦脈＝之後生產的工人自動採集）
      for (const b of blds)
        b.bld.rally =
          ent && ent !== b
            ? { x: ent.pos.x, z: ent.pos.z, id: ent.id }
            : mine
              ? { x: mine.pos.x, z: mine.pos.z, mine: mine.id }
              : { x, z };
      return;
    }
    const team = mob[0].rtsTeam;
    if (ent && ent.rtsTeam !== undefined && ent.rtsTeam !== team)
      return this.rtsOrder(mob, { k: 'attack', id: ent.id }, queue);
    const workers = mob.filter((e) => RTS_DEFS[e.rtsDef].worker),
      others = mob.filter((e) => !RTS_DEFS[e.rtsDef].worker);
    if (mine && mine.kind === 'mine' && mine.amount > 0) {
      if (workers.length) this.rtsOrder(workers, { k: 'gather', mine: mine.id }, queue);
      if (others.length) this.rtsOrder(others, { k: 'move', x, z }, queue);
      return;
    }
    if (ent && ent.bld && ent.rtsTeam === team && workers.length) {
      if (ent.bld.progress < 1) {
        for (const w of workers)
          this.rtsOrder([w], { k: 'build', def: ent.rtsDef, x: ent.pos.x, z: ent.pos.z, bid: ent.id }, queue);
        if (others.length) this.rtsOrder(others, { k: 'move', x, z }, queue);
        return;
      }
      if (ent.hp < ent.maxHp) {
        this.rtsOrder(workers, { k: 'repair', id: ent.id }, queue);
        if (others.length) this.rtsOrder(others, { k: 'move', x, z }, queue);
        return;
      }
    }
    this.rtsOrder(mob, { k: 'move', x, z }, queue);
  },
  rtsIsEntity(o) {
    return !!(o && o.rtsDef !== undefined && o.pos && o.maxHp !== undefined);
  },
  // ---------- 尋路的排隊服務 ----------
  rtsPathReq(e, N) {
    const R = this.rts;
    if (!R || N.pend) return;
    N.pend = true;
    R.pathQ.push({ e, N });
  },
  rtsPathService() {
    const R = this.rts,
      nav = this.world && this.world.nav;
    if (!R || !nav || !R.pathQ.length) return 0;
    const t0 = performance.now();
    // 時間上限：冒煙測試設 g.rtsPathMs＝Infinity，只看條數（依實際耗時截斷的話，負載高時同一個種子的結果不同）
    const lim = this.rtsPathMs !== undefined ? this.rtsPathMs : PATH_MS;
    let n = 0;
    while (R.pathQ.length && n < PATH_PER_FRAME) {
      const { e, N } = R.pathQ.shift();
      if (e.dead || e.rt.nav !== N) continue; // 已經換了目標
      N.pend = false;
      N.path = nav.findPath(e.pos, { x: N.x, z: N.z }, RTS_DEFS[e.rtsDef].size || 0);
      if (!N.path.length) N.path = [{ x: N.x, z: N.z }];
      N.pi = 0;
      n++;
      if (performance.now() - t0 > lim) break;
    }
    R.pathN = (R.pathN || 0) + n;
    return n;
  },
});
