// Coral 戰爭（RTS）的指令發佈（mixin）：rtsOrder(units, order, queue)、智慧指令 rtsSmart(units, x, z, target, queue)、
// 尋路的排隊服務（rtsPathReq／rtsPathService）。指令格式見 docs/rts-design.md 12.3，執行在 entities/mech-rts.js。
// - 多個單位移動到同一點（move／amove／patrol）：同一種尺寸 3 台以上時共用一個流場（world.nav.flowField，以目標格快取），
//   終點散開成陣形（o.sx／o.sz：從中心往外的格點，近的單位分到近的位置）；少數單位各自用 A* 路徑。
// - A* 路徑不在下指令時算：rtsPathReq 排進佇列，rtsPathService 每格最多算 PATH_PER_FRAME 條（或 PATH_MS 毫秒），
//   120 個不同目標的指令分散到幾格。
// - 建造只派一個工人（最近的）；採集、修理派全部的工人，戰鬥單位改成走過去。
// - R2（docs 13.1）：ability（技能：自己施放的給全部會的單位，有目標的給最近、沒在冷卻的一台）、pickup／shop（只給英雄）；
//   防禦塔（有 range 的建築）可以接 attack／stop（B 包的 rtsTowerAI 讀 b.orders[0]）；親自駕駛中的英雄不接指令。
// - R3（docs 14.2）：fuse（融合：選取中的材料分組，rts-grid.js 的 rtsFuseIssue；回傳組數）、建築的技能（結晶護壁：
//   選取中有這個技能的建築 rtsBldAbility）；不能修理的工人（定義的 noRepair）右鍵受損的建築＝走過去。
// - R4（docs 15.2、15.3；rts-veer.js）：沒有建造工人的陣營（airdrop）的 build＝空投 rtsDropOrder（不派工人）；
//   drop（空投）、pack（收起）、unpack（展開到地點）、trade（物流交易）、load（運輸機載運：指定的單位走過來登機）、
//   unload（運輸機卸載）、board（單位登機）；收好的建築接受 move；建築的地點技能（緊急補給）只由一座施放。
// - R5（docs 16.2；rts-sancta.js）：salvage（拾荒：{ wid } 或地點；會拾荒的工人拆、其他的走過去）、gather 帶 wid＝拾荒、
//   refit（改裝：rtsRefit，回傳台數）、scrap（拆除選取中的建築，回傳座數）；rtsSmart 右鍵殘骸（target 是殘骸紀錄，
//   或沒有點到東西時地上有這一隊看過的殘骸）＝拾荒（優先於礦脈）。
import { Game } from './game.js';
import { RTS_ABILS, RTS_DEFS, RTS_GATHER } from '../data/rts-units.js';

const PATH_PER_FRAME = 16;
const PATH_MS = 3;
const FLOW_MIN = 3; // 幾台以上共用流場

Object.assign(Game.prototype, {
  // 指令：units 是實體陣列（建築會被略過，集結點另外處理）；queue＝Shift 排隊
  rtsOrder(units, order, queue = false) {
    const R = this.rts;
    if (!R || !order) return;
    const k = order.k;
    const team0 = (units || []).find((e) => e && !e.dead && e.rtsTeam !== undefined);
    const team = order.team !== undefined ? order.team : team0 ? team0.rtsTeam : undefined;
    if (k === 'ability') {
      // 融合類的技能＝融合指令；建築的技能（結晶護壁、緊急補給）由 rts-grid.js 的 rtsBldAbility 施放
      const A = RTS_ABILS[order.ab];
      if (A && A.fuse) return this.rtsOrder(units, { k: 'fuse', recipe: A.fuse }, queue);
      // 維爾威的載運／卸載＝指令（docs 15.3）
      if (A && A.order === 'load') return this.rtsOrder(units, { k: 'load', id: order.id }, queue);
      if (A && A.order === 'unload')
        return this.rtsOrder(units, { k: 'unload', x: order.x, z: order.z }, queue);
      let nb = 0;
      const pt = A && A.target === 'point';
      for (const b of units || [])
        if (b && !b.dead && b.bld && ((RTS_DEFS[b.rtsDef] || {}).abil || []).includes(order.ab)) {
          if (pt && nb) break; // 地點技能只由一座施放
          nb += this.rtsBldAbility && this.rtsBldAbility(b, order.ab, order) ? 1 : 0;
        }
      if (A && A.bld) return nb;
    }
    // ---------- 維爾威（rts-veer.js） ----------
    if ((k === 'build' && team !== undefined && this.rtsVeerTeam && this.rtsVeerTeam(team)) || k === 'drop') {
      // 空投：不派工人（管家、電腦對手照舊下 build 也會轉過來）
      if (team === undefined || !this.rtsDropOrder) return null;
      return this.rtsDropOrder(team, order.def || order.id, order.x, order.z, order.yaw || 0, order);
    }
    if (k === 'pack') {
      let n = 0;
      for (const b of units || [])
        if (b && !b.dead && b.bld && !b.bld.packed && this.rtsPack && this.rtsPack(b)) n++;
      return n;
    }
    if (k === 'unpack') {
      let n = 0;
      for (const b of units || [])
        if (
          b &&
          !b.dead &&
          b.bld &&
          b.bld.packed &&
          this.rtsUnpack &&
          this.rtsUnpack(b, order.x, order.z, order.yaw)
        )
          n++;
      return n;
    }
    if (k === 'trade') return team !== undefined && this.rtsTrade ? this.rtsTrade(team, order.dir) : false;
    // ---------- 聖域（rts-sancta.js） ----------
    if (k === 'scrap') {
      let n = 0;
      for (const b of units || []) if (b && !b.dead && b.bld && this.rtsScrapBld && this.rtsScrapBld(b)) n++;
      return n;
    }
    if (k === 'refit') return this.rtsRefit ? this.rtsRefit(units, order.rf) : 0;
    if (k === 'salvage' || (k === 'gather' && order.wid !== undefined)) {
      const mob = (units || []).filter(
        (e) => e && !e.dead && !e.bld && e.rtsDef && !e.rtsPiloted && !e.rtsAboard && !e.rtsDriven,
      );
      let w = order.wid !== undefined && this.rtsWreckById ? this.rtsWreckById(order.wid) : null;
      if (!w && order.x !== undefined && this.rtsWreckAt && team !== undefined)
        w = this.rtsWreckAt(order.x, order.z, 3, { team })[0] || null;
      return w && this.rtsSalvageOrder ? this.rtsSalvageOrder(mob, w, queue) : 0;
    }
    if (k === 'move' || k === 'amove') {
      // 收好的建築：飛過去（取消展開的地點）
      for (const b of units || [])
        if (b && !b.dead && b.bld && b.bld.packed === 2) {
          b.bld.unpackTo = null;
          b.orders = [{ k: 'move', x: order.x, z: order.z }];
        }
    }
    if (k === 'attack' || k === 'stop') {
      // 防禦塔：指定目標／停止
      for (const b of units || [])
        if (b && !b.dead && b.bld && RTS_DEFS[b.rtsDef] && RTS_DEFS[b.rtsDef].range)
          b.orders = k === 'attack' ? [{ ...order }] : [];
    }
    // 不接指令：親自駕駛中的英雄、運輸機上的乘員、空投運輸機（rts-veer.js 駕駛）
    const list = (units || []).filter(
      (e) => e && !e.dead && !e.bld && e.rtsDef && !e.rtsPiloted && !e.rtsAboard && !e.rtsDriven,
    );
    if (!list.length) return;
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
    if (k === 'fuse') return this.rtsFuseIssue ? this.rtsFuseIssue(list, order.recipe) : 0;
    if (k === 'load') {
      // 運輸機（選取中的第一台有空位的）＋指定的己方單位走過來登機
      const t = this.rtsEnt(order.id);
      const ship = list.find((e) => RTS_DEFS[e.rtsDef].cargo);
      if (!t || !ship || t === ship) return 0;
      const why = this.rtsBoardWhy ? this.rtsBoardWhy(t, ship) : '';
      if (why) return (t.rtsTeam === 0 && this.rtsSay(why), 0);
      this.rtsSetOrders(t, [{ k: 'board', id: ship.id }]);
      return 1;
    }
    if (k === 'board') {
      const ship = this.rtsEnt(order.id);
      if (!ship) return 0;
      let n = 0;
      for (const e of list) if (e !== ship && !e.flying) (give(e, { k: 'board', id: ship.id }), n++);
      return n;
    }
    if (k === 'unload') {
      let n = 0;
      for (const e of list)
        if (RTS_DEFS[e.rtsDef].cargo && e.cargo && e.cargo.length)
          (give(e, { k: 'unload', x: order.x, z: order.z }), n++);
      return n;
    }
    if (k === 'gather' || k === 'repair') {
      for (const e of list) {
        const D = RTS_DEFS[e.rtsDef];
        if (D.worker && !(k === 'repair' && D.noRepair)) give(e, { ...order });
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
    if (k === 'ability') {
      // 會這個技能的：單位定義的 abil，或英雄定義的 skills（施放的檢查在 C 包）
      const can = list.filter((e) =>
        [...(RTS_DEFS[e.rtsDef].abil || []), ...(RTS_DEFS[e.rtsDef].skills || [])].includes(order.ab),
      );
      if (!can.length) return;
      const A = RTS_ABILS[order.ab];
      const self = A ? A.target === 'self' : order.x === undefined && order.id === undefined;
      if (self) {
        for (const e of can) give(e, { ...order });
        return;
      }
      // 有目標：沒在冷卻、離目標最近的一台
      const t = R.t;
      const tx = order.x !== undefined ? order.x : (this.rtsEnt(order.id) || { pos: { x: 0 } }).pos.x;
      const tz = order.z !== undefined ? order.z : (this.rtsEnt(order.id) || { pos: { z: 0 } }).pos.z;
      let best = null,
        bd = 1e9;
      for (const e of can) {
        const cd = e.rtsCd && e.rtsCd[order.ab] > t ? 1e5 : 0;
        const d = Math.hypot(e.pos.x - tx, e.pos.z - tz) + cd;
        if (d < bd) ((bd = d), (best = e));
      }
      give(best, { ...order });
      return;
    }
    if (k === 'pickup' || k === 'shop') {
      // 英雄撿道具、走到商店買（C 包）
      for (const e of list) if (e.hero) give(e, { ...order });
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
        // 空中單位直線飛、不用流場（R4 B 包：只算地面單位的台數）
        const flow =
          grp.filter((e) => !e.flying).length >= FLOW_MIN && nav
            ? nav.flowField(order.x, order.z, size)
            : null;
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
    // 殘骸（聖域，docs 16.2）：會拾荒的工人拆（點到殘骸紀錄，或沒有點到東西時地上有這一隊看過的殘骸）
    const salv = mob.filter((e) => RTS_DEFS[e.rtsDef].salvager && RTS_DEFS[e.rtsDef].worker);
    if (salv.length && mob[0].rtsTeam !== undefined) {
      let w = target && target.wreck ? target : null;
      if (!w && !target && this.rtsWreckAt)
        w = this.rtsWreckAt(x, z, 1.5, { team: mob[0].rtsTeam })[0] || null;
      if (w && !w.gone && w.ore > 0) return this.rtsSalvageOrder(mob, w, queue);
    }
    if (mob.length && target && target.wreck)
      return this.rtsOrder(mob, { k: 'move', x: target.x, z: target.z }, queue);
    // 礦脈：沒有點到東西時看地上有沒有礦脈
    if (target && target.wreck) target = null; // 只選了建築：殘骸當作地面（集結點）
    let mine = target && !this.rtsIsEntity(target) ? target : null;
    if (!target) mine = this.rtsMineAt(x, z, RTS_GATHER.mineR + 1.5);
    const ent = this.rtsIsEntity(target) ? target : null;
    if (!mob.length) {
      // 收好的建築（維爾威）：右鍵地面＝飛過去
      const packed = blds.filter((b) => b.bld.packed === 2);
      if (packed.length) this.rtsOrder(packed, { k: 'move', x, z }, queue);
      // 集結點（點礦脈＝之後生產的工人自動採集）
      for (const b of blds)
        if (!b.bld.packed)
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
    // 己方的運輸機（維爾威）：地面單位走過去登機
    if (ent && ent.rtsTeam === team && !ent.bld && RTS_DEFS[ent.rtsDef] && RTS_DEFS[ent.rtsDef].cargo) {
      const ground = mob.filter((e) => e !== ent && !e.flying);
      if (ground.length) return this.rtsOrder(ground, { k: 'board', id: ent.id }, queue);
    }
    const workers = mob.filter((e) => RTS_DEFS[e.rtsDef].worker),
      others = mob.filter((e) => !RTS_DEFS[e.rtsDef].worker);
    if (mine && mine.kind === 'mine' && mine.amount > 0) {
      if (workers.length) this.rtsOrder(workers, { k: 'gather', mine: mine.id }, queue);
      if (others.length) this.rtsOrder(others, { k: 'move', x, z }, queue);
      return;
    }
    // 自己長的建築不需要工人續建、不能修理的工人（艾瑟立克）不修理：走過去
    const builders = workers.filter((e) => !RTS_DEFS[e.rtsDef].noRepair);
    const selfB = ent && ent.bld && RTS_DEFS[ent.rtsDef] && RTS_DEFS[ent.rtsDef].selfBuild;
    if (ent && ent.bld && ent.rtsTeam === team && workers.length && !selfB && builders.length) {
      if (ent.bld.progress < 1) {
        for (const w of workers)
          this.rtsOrder([w], { k: 'build', def: ent.rtsDef, x: ent.pos.x, z: ent.pos.z, bid: ent.id }, queue);
        if (others.length) this.rtsOrder(others, { k: 'move', x, z }, queue);
        return;
      }
      if (ent.hp < ent.maxHp) {
        this.rtsOrder(builders, { k: 'repair', id: ent.id }, queue);
        const rest = mob.filter((e) => !builders.includes(e));
        if (rest.length) this.rtsOrder(rest, { k: 'move', x, z }, queue);
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
