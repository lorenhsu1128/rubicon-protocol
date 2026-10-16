// Coral 戰爭（RTS）的中立（mixin；docs/rts-design.md 13.6、13.15；D 包）：野怪營地（生成、出動／回營的狀態、掉寶）、
// 中立建築（酒館、中立商店、傭兵營）與它們的庫存、傭兵的雇用。中立隊伍是 R.teams[2]（RTS_NEUTRAL）。
// - 營地照地圖產生器的 plan.camps（成對、點對稱）：編成、具名 AC、掉寶都用 makeRng(seed × 41 ＋ 成對編號)，
//   所以兩邊對稱的營地一模一樣（不用 Math.random）。野怪的行為在 entities/mech-rts-creep.js。
// - 中立建築以 rtsSpawnBld(2, …) 建立（定義 inv: true：打不壞、noLock）；R.neutrals＝{ kind, ent, near, stock, hired }。
// - 給其他包的 API：C（rtsBuy／rtsHire）用 rtsShopWhy／rtsShopTake、rtsTavernWhy／rtsTavernTake；E（HUD）用
//   rtsNeutralRec、rtsShopStock、rtsMercStock、rtsMercWhy、rtsMercHire；F（電腦打野）讀 R.camps。
import { makeRng } from '../core/math.js';
import { RTS_DEFS, RTS_NEUTRAL, RTS_UNIT_CARD } from '../data/rts-units.js';
import {
  RTS_CAMPS,
  RTS_CAMP_ACES,
  RTS_CAMP_LOOT,
  RTS_CREEP,
  RTS_CREEP_DEFS,
  RTS_MERCS,
  RTS_MERC_DEFS,
  RTS_MERC_RULE,
  RTS_TAVERN_R,
  neutralShopItems,
} from '../data/rts-neutral.js';
import { RTS_ITEMS, RTS_LOOT, RTS_SHOP } from '../data/rts-items.js';
import { buildCampMarker, buildItemCrate } from '../render/rts-neutral-models.js';
import { Game } from './game.js';

const ME = 0;
// 掉寶表還沒有內容時（C 包的 RTS_ITEMS 是空的）的備用：docs 13.5 的道具 id
const LOOT_FALLBACK = [
  ['i_kit', 'i_scout', 'i_smoke', 'i_beacon'],
  ['i_barrier', 'i_fcs', 'i_plate', 'i_boost', 'i_cooler', 'i_repair', 'i_contract'],
  ['i_scope', 'i_antenna', 'i_stab', 'i_coralcore'],
];
// 傭兵照一般單位的指令（卡片是 R1 的 UNIT_CARD；data 檔不能 import rts-units.js，所以在這裡補）
for (const id in RTS_MERC_DEFS) if (RTS_DEFS[id] && !RTS_DEFS[id].card) RTS_DEFS[id].card = RTS_UNIT_CARD;

// 點到建築外形（軸對齊的佔地）的水平距離
const bldDist = (p, b) =>
  Math.hypot(
    Math.max(0, Math.abs(p.x - b.pos.x) - (b.bld ? b.bld.w : 0) / 2),
    Math.max(0, Math.abs(p.z - b.pos.z) - (b.bld ? b.bld.d : 0) / 2),
  );

Object.assign(Game.prototype, {
  // ---------- 開局 ----------
  rtsNeutralInit() {
    const R = this.rts,
      w = this.world,
      plan = w && w.rts;
    if (!R || !plan) return;
    R.camps = [];
    R.neutrals = [];
    R.lootN = 0;
    // g.rtsNeutralOff（測試與除錯）：整個中立都不放（營地、酒館、商店、傭兵營；R1 的 testRtsCore 在地圖正中央交戰）
    if (this.rtsNeutralOff) return;
    const theme = RTS_CAMPS[R.cfg.theme] ? R.cfg.theme : 'wasteland';
    (plan.camps || []).forEach((c, i) => {
      const camp = this.rtsCampSetup(c, i, theme);
      R.camps.push(camp);
      // 營地四周不能蓋建築；地面的標示（只是外觀）
      w.nav.reserve(camp.pos.x, camp.pos.z, 8);
      const mk = buildCampMarker(camp.tier);
      mk.position.set(camp.pos.x, camp.pos.y - 0.05, camp.pos.z);
      mk.userData.helper = true;
      R.g.add(mk);
      camp.marker = mk;
      // g.rtsCampsOff（測試與除錯）：營地照樣記錄，但不生成野怪（R1 的測試與電腦對手的測試用，F 包的打野之前）
      if (this.rtsCampsOff) {
        camp.off = camp.cleared = true;
        camp.st = 'done';
      } else this.rtsCampSpawn(camp);
    });
    for (const q of plan.neutrals || []) {
      const def = 'n_' + q.kind;
      if (!RTS_DEFS[def]) continue;
      const ent = this.rtsSpawnBld(RTS_NEUTRAL, def, q.pos.x, q.pos.z, q.yaw || 0, 1);
      const rec = {
        kind: q.kind,
        ent,
        id: ent.id,
        near: q.near === undefined ? -1 : q.near,
        stock: {},
        hired: {},
      };
      ent.rtsNeutral = rec;
      if (q.kind === 'shop')
        for (const it of this.rtsShopList()) {
          const t = (RTS_ITEMS[it] && RTS_ITEMS[it].tier) || 1;
          const max = RTS_SHOP.stock[t - 1] || 1;
          rec.stock[it] = { n: max, max, wait: RTS_SHOP.restock[t - 1] || 60, t: 0 };
        }
      if (q.kind === 'merc')
        for (const id of RTS_MERCS[theme] || [])
          rec.stock[id] = {
            n: RTS_MERC_RULE.stock,
            max: RTS_MERC_RULE.stock,
            wait: RTS_MERC_RULE.restock,
            t: 0,
          };
      R.neutrals.push(rec);
    }
  },
  // 營地的紀錄：編成、具名 AC、掉寶都由成對編號的亂數決定（兩邊相同）
  rtsCampSetup(c, i, theme) {
    const R = this.rts;
    const pair = i >> 1; // plan.camps 依 (A 側, B 側) 成對排列
    const rng = makeRng(((R.cfg.seed >>> 0) * 41 + pair + 1) >>> 0);
    rng();
    const tier = Math.max(1, Math.min(3, c.tier || 1));
    const sets = RTS_CAMPS[theme][tier - 1];
    const setI = Math.floor(rng() * sets.length);
    const aces = Object.keys(RTS_CAMP_ACES);
    const ace = 'cr_ac_' + aces[Math.floor(rng() * aces.length)];
    const set = sets[setI].map((id) => (id === '@ac' ? ace : id));
    // 掉寶
    const L = RTS_CAMP_LOOT[tier - 1];
    const roll = rng(),
      pickR = rng();
    const list =
      (RTS_LOOT[L.item - 1] && RTS_LOOT[L.item - 1].length
        ? RTS_LOOT[L.item - 1]
        : LOOT_FALLBACK[L.item - 1]) || [];
    const loot =
      roll < L.p
        ? { item: list[Math.floor(pickR * list.length)] || null, ore: L.ore || 0, coral: L.coral || 0 }
        : { item: null, ore: (L.alt && L.alt.ore) || 0, coral: (L.alt && L.alt.coral) || 0 };
    const y = this.world.terrainHeight(c.pos.x, c.pos.z);
    return {
      id: 'k' + i,
      idx: i,
      pair,
      near: c.near,
      pos: { x: c.pos.x, y, z: c.pos.z },
      tier,
      guards: c.guards || { type: 'item' },
      set,
      setI,
      loot,
      ents: new Set(),
      cleared: false,
      spawned: false,
      st: 'idle', // idle 待機、fight 出動、return 回營、done 清除
      tgt: null,
      hitT: 0,
      seenT: 0,
      idleT: 0,
      chkT: 0,
      aggro: RTS_CREEP.aggro[tier - 1],
    };
  },
  // 生成營地的野怪：圍著營地中心排一圈，面朝外（方位角從營地中心的方向算，兩邊對稱）
  rtsCampSpawn(camp) {
    const R = this.rts,
      nav = this.world.nav;
    if (!R || camp.spawned) return 0;
    camp.spawned = true;
    const n = camp.set.length;
    const a0 = Math.atan2(camp.pos.z, camp.pos.x);
    const r = n >= 4 ? 4.5 : 3.6;
    camp.set.forEach((id, j) => {
      const D = RTS_DEFS[id];
      if (!D) return;
      const a = a0 + (j / n) * Math.PI * 2;
      let x = camp.pos.x + Math.cos(a) * r,
        z = camp.pos.z + Math.sin(a) * r;
      const cell = nav.nearestCell(x, z, D.size || 0, -1, 8);
      if (cell >= 0) ({ x, z } = nav.center(cell));
      const e = this.rtsSpawn(RTS_NEUTRAL, id, x, z, -a - Math.PI / 2); // 前方 (−sin, −cos)＝(cos a, sin a)：朝外
      if (!e) return;
      e.creep = camp.id;
      e.rtsCamp = camp;
      e.rtsHome = { x, z, a };
      // mech-rts.js（B）的 rtsUnitAI 會轉給 rtsCreepAI；在實體上也掛一份，順序不影響
      e.rtsUnitAI = e.rtsCreepAI;
      camp.ents.add(e);
    });
    return camp.ents.size;
  },
  // 生成全部營地（開局已經生成；效能基準 scripts/rts-bench.js 的 --camps 也呼叫）：回傳野怪的數量。
  // 不在 RTS 時（效能基準的一般任務）：在地圖外圈放 8 個營地（小／中／大輪流，原型用 spawnType），待在原地不動
  rtsCampSpawnAll() {
    const R = this.rts;
    if (R) {
      let n = 0;
      for (const c of R.camps) {
        if (!c.cleared || c.off) {
          c.off = c.cleared = false;
          c.st = 'idle';
          this.rtsCampSpawn(c);
        }
        for (const e of c.ents) if (!e.dead) n++;
      }
      return n;
    }
    const w = this.world;
    if (!w || !this.spawnType) return 0;
    const L = w.lim;
    const Z = new THREE.Vector3();
    let n = 0;
    for (let c = 0; c < 8; c++) {
      const tier = (c % 3) + 1;
      const sets = RTS_CAMPS.wasteland[tier - 1];
      const set = sets[c % sets.length].map((id) =>
        id === '@ac' ? 'cr_ac_' + Object.keys(RTS_CAMP_ACES)[0] : id,
      );
      const a = (c / 8) * Math.PI * 2 + 0.2;
      const cx = Math.cos(a) * L * 0.8,
        cz = Math.sin(a) * L * 0.8;
      set.forEach((id, j) => {
        const D = RTS_CREEP_DEFS[id];
        if (!D || !D.etype) return;
        const b = a + (j / set.length) * Math.PI * 2;
        const [qx, qz] = w.collide(cx + Math.cos(b) * 4, cz + Math.sin(b) * 4, 50, 1.8);
        const e = this.spawnType(
          D.etype,
          this.scaleHp * 25,
          this.scaleDmg,
          new THREE.Vector3(qx, w.groundAt(qx, qz, 99), qz),
          1,
        );
        if (!e) return;
        e.updateAI = function (dt) {
          this.move(dt, Z, false, false, false, null);
        };
        n++;
      });
    }
    return n;
  },

  // ---------- 每格 ----------
  rtsNeutralTick(dt) {
    const R = this.rts;
    if (!R) return;
    for (const c of R.camps) if (!c.cleared) this.rtsCampTick(c, dt);
    // 庫存補貨（商店：依階 60／90／120 秒、傭兵營：60 秒；兩隊共用）
    for (const q of R.neutrals)
      for (const k in q.stock) {
        const s = q.stock[k];
        if (s.n >= s.max) {
          s.t = 0;
          continue;
        }
        s.t += dt;
        if (s.t >= s.wait) {
          s.t = 0;
          s.n++;
        }
      }
  },
  // 營地的狀態：待機 → 有敵人進入出動半徑或有野怪被打＝整營出動 → 有野怪離營地中心超過追擊上限、
  // RTS_CREEP.giveUp 秒沒有打到敵人、或 3 秒沒有目標＝回營（回滿血）→ 全部回到位置＝待機
  rtsCampTick(c, dt) {
    const R = this.rts;
    let alive = 0,
      home = 0,
      far = false;
    for (const e of c.ents) {
      if (e.dead) continue;
      alive++;
      const h = e.rtsHome || c.pos;
      if (Math.hypot(e.pos.x - h.x, e.pos.z - h.z) < 2.5) home++;
      if (Math.hypot(e.pos.x - c.pos.x, e.pos.z - c.pos.z) > RTS_CREEP.leash) far = true;
    }
    if (!alive) return;
    if (c.st === 'idle') {
      c.chkT -= dt;
      if (c.chkT > 0) return;
      c.chkT = 0.25;
      let trig = null;
      for (const e of c.ents) {
        if (e.dead || !e.rt) continue;
        if (e.rt.hurtBy && e.rt.hurtT > c.idleT && R.t - e.rt.hurtT < 2 && !e.rt.hurtBy.dead) {
          trig = e.rt.hurtBy;
          break;
        }
        const list = this.rtsNear(e.pos.x, e.pos.z, c.aggro + 4);
        for (const t of list)
          if (
            !t.bld &&
            !t.rtsInv &&
            e.rtsHostileOk(t) &&
            Math.hypot(t.pos.x - e.pos.x, t.pos.z - e.pos.z) <= c.aggro
          ) {
            trig = t;
            break;
          }
        if (trig) break;
      }
      if (trig) {
        c.st = 'fight';
        c.tgt = trig;
        c.hitT = c.seenT = R.t;
      }
    } else if (c.st === 'fight') {
      if (far || R.t - c.hitT > RTS_CREEP.giveUp || R.t - c.seenT > 3) {
        c.st = 'return';
        c.tgt = null;
        for (const e of c.ents)
          if (e.rt) {
            e.rt.hurtBy = null;
            e.rt.engage = null;
            e.rt.nav = null;
          }
      }
    } else if (c.st === 'return') {
      let full = true;
      for (const e of c.ents)
        if (!e.dead) {
          e.hp = Math.min(e.maxHp, e.hp + (e.maxHp / RTS_CREEP.healT) * dt);
          if (e.hp < e.maxHp) full = false;
        }
      // 全部回到位置、血量回滿才回到待機（回滿之前被打也不出動）
      if (home >= alive && full) {
        c.st = 'idle';
        c.idleT = R.t;
        c.chkT = 0.5;
      }
    }
  },

  // ---------- 掉寶（rts.js 的 rtsOnDeath 呼叫） ----------
  // 整營全滅：最後一台的位置掉道具（C 包的 rtsItemSpawn）＋資源給擊破者的隊伍（不套維持費）
  rtsLootOnKill(e, from) {
    const R = this.rts;
    if (!R || !e.creep || !e.rtsCamp) return;
    const c = e.rtsCamp;
    c.ents.delete(e);
    if (c.cleared || [...c.ents].some((u) => !u.dead)) return;
    c.cleared = true;
    c.st = 'done';
    const team = from && from.rtsTeam !== undefined && from.rtsTeam !== RTS_NEUTRAL ? from.rtsTeam : -1;
    c.clearedBy = team;
    c.clearT = R.t;
    const x = e.pos.x,
      z = e.pos.z;
    if (c.loot.item) c.drop = this.rtsLootDrop(c.loot.item, x, z, c.tier);
    if (team >= 0 && (c.loot.ore || c.loot.coral)) this.rtsGrant(team, c.loot.ore, c.loot.coral);
    if (c.marker) c.marker.scale.setScalar(0.7); // 清除後的營地標示縮小
    if (team === (R.me !== undefined ? R.me : ME)) {
      const txt = `營地清除${c.loot.ore ? '：礦石 +' + c.loot.ore : ''}${c.loot.coral ? '、Coral +' + c.loot.coral : ''}`;
      if (this.rtsEvent) this.rtsEvent(x, z, '營地清除');
      this.rtsSay(txt, 0xffd870);
    }
  },
  // 地上的道具：C 包的 rtsItemSpawn（R.items）；還沒有時自己放一個道具箱（同樣的格式 { uid, item, x, z, mesh }）
  rtsLootDrop(item, x, z, tier = 1) {
    const R = this.rts;
    if (this.rtsItemSpawn) return this.rtsItemSpawn(item, x, z);
    const mesh = buildItemCrate((RTS_ITEMS[item] && RTS_ITEMS[item].tier) || tier);
    mesh.position.set(x, this.world.terrainHeight(x, z), z);
    R.g.add(mesh);
    const rec = { uid: 'L' + R.lootN++, item, x, z, mesh };
    R.items.push(rec);
    return rec;
  },

  // ---------- 中立建築 ----------
  rtsNeutralClear() {
    const R = this.rts;
    if (!R) return;
    for (const c of R.camps || []) {
      c.ents.clear();
      c.tgt = null;
    }
    // 建築、野怪是一般的實體（rtsClear／clearMission 清掉），標示在 R.g 裡
  },
  // 中立建築的紀錄：實體、實體 id 或紀錄本身
  rtsNeutralRec(x) {
    const R = this.rts;
    if (!R || x === null || x === undefined) return null;
    if (x.ent && x.kind) return x;
    if (x.rtsNeutral) return x.rtsNeutral;
    return R.neutrals.find((q) => q.id === x) || null;
  },
  // 定義（測試與 HUD 用：data 的 RTS_DEFS）
  rtsNeutralDef(id) {
    return RTS_DEFS[id] || null;
  },
  rtsNeutralOf(kind) {
    return this.rts ? this.rts.neutrals.filter((q) => q.kind === kind) : [];
  },
  // 隊伍離中立建築最近的單位（不含建築；hero＝只看英雄）→ { e, d }
  rtsNeutralNear(teamId, rec, hero = false) {
    rec = this.rtsNeutralRec(rec);
    const R = this.rts;
    let best = null,
      bd = 1e9;
    if (!rec) return { e: null, d: bd };
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== teamId || (hero && !e.hero)) continue;
      const d = bldDist(e.pos, rec.ent);
      if (d < bd) ((bd = d), (best = e));
    }
    return { e: best, d: bd };
  },
  // 中立商店的貨架（全部可購買的道具）
  rtsShopList() {
    return neutralShopItems();
  },
  // 庫存（HUD）：[{ item, n, max, eta（補下一個的秒數） }]
  rtsShopStock(shop) {
    const rec = this.rtsNeutralRec(shop);
    if (!rec) return [];
    return Object.keys(rec.stock).map((item) => {
      const s = rec.stock[item];
      return { item, n: s.n, max: s.max, eta: s.n >= s.max ? 0 : Math.max(0, s.wait - s.t) };
    });
  },
  // 能不能在這家商店買（'' 或原因）：中立商店看庫存與英雄的距離（hero 沒給時找 12 m 內的己方英雄）、費用；
  // 補給商店（c_market）看主堡的層級。C 包的 rtsBuy 與 E 包的卡片都先問它
  rtsShopWhy(teamId, shop, item, hero = null) {
    const I = RTS_ITEMS[item];
    if (!I || I.drop) return '這個道具不能購買';
    const rec = this.rtsNeutralRec(shop);
    const r = RTS_SHOP.r || 12;
    if (rec) {
      if (rec.kind !== 'shop') return '這裡不是商店';
      const s = rec.stock[item];
      if (!s) return '這裡沒有賣';
      if (s.n <= 0) return `缺貨（約 ${Math.ceil(s.wait - s.t)} 秒後補貨）`;
      if (hero) {
        if (hero.dead || bldDist(hero.pos, rec.ent) > r) return `英雄要在商店 ${r} m 內`;
      } else if (this.rtsNeutralNear(teamId, rec, true).d > r) return '附近沒有英雄';
    } else if (shop && shop.rtsDef && (I.tier || 1) > this.rtsTier(teamId))
      return `需要 ${this.rtsTierName ? this.rtsTierName(teamId, I.tier) : 'T' + I.tier}`;
    if (!this.rtsAfford(teamId, I.cost))
      return this.rts.teams[teamId].ore < (I.cost.ore || 0) ? '礦石不足' : 'Coral 不足';
    return '';
  },
  // 扣中立商店的庫存（C 包的 rtsBuy 付款成功後呼叫；不是中立商店時直接回傳 true）
  rtsShopTake(shop, item) {
    const rec = this.rtsNeutralRec(shop);
    if (!rec) return true;
    const s = rec.stock[item];
    if (!s || s.n <= 0) return false;
    s.n--;
    return true;
  },
  // 酒館（C 包的 rtsHire 先問它，雇用成功後呼叫 rtsTavernTake）：己方單位在 14 m 內、全場唯一
  rtsTavernWhy(teamId, tav, heroId) {
    const rec = this.rtsNeutralRec(tav) || this.rtsNeutralOf('tavern')[0];
    if (!rec || rec.kind !== 'tavern') return '找不到酒館';
    const own = this.rtsTavernOwner(heroId);
    if (own === teamId) return '已經雇用了';
    if (own >= 0) return '已經被對手雇走了';
    if (this.rtsNeutralNear(teamId, rec).d > RTS_TAVERN_R) return `需要己方單位在酒館 ${RTS_TAVERN_R} m 內`;
    return '';
  },
  rtsTavernTake(tav, heroId, teamId) {
    const rec = this.rtsNeutralRec(tav) || this.rtsNeutralOf('tavern')[0];
    if (rec) rec.hired[heroId] = teamId;
  },
  // 雇走這位酒館英雄的隊伍（沒有＝−1；陣亡後仍屬於雇用的隊伍）
  rtsTavernOwner(heroId) {
    for (const q of this.rtsNeutralOf('tavern')) if (q.hired[heroId] !== undefined) return q.hired[heroId];
    return -1;
  },
  // 傭兵營
  rtsMercStock(merc) {
    return this.rtsShopStock(merc);
  },
  rtsMercWhy(teamId, merc, id) {
    const rec = this.rtsNeutralRec(merc);
    const D = RTS_DEFS[id];
    if (!rec || rec.kind !== 'merc') return '這裡不是傭兵營';
    const s = rec.stock[id];
    if (!s || !D) return '這裡沒有這種傭兵';
    if (s.n <= 0) return `沒有傭兵了（約 ${Math.ceil(s.wait - s.t)} 秒後補充）`;
    if (this.rtsNeutralNear(teamId, rec).d > RTS_MERC_RULE.r)
      return `需要己方單位在傭兵營 ${RTS_MERC_RULE.r} m 內`;
    const T = this.rts.teams[teamId];
    if (T.pop + (D.pop || 0) > T.cap) return '人口不足';
    if (!this.rtsAfford(teamId, D.cost)) return T.ore < (D.cost.ore || 0) ? '礦石不足' : 'Coral 不足';
    return '';
  },
  // 傭兵合約（C 包的道具 i_contract）：在 (x, z) 旁召喚一台這張地圖的傭兵（不扣庫存與費用；時限由 C 包管理）
  rtsMercContract(teamId, x, z) {
    const R = this.rts;
    if (!R) return null;
    const list = (RTS_MERCS[R.cfg.theme] || RTS_MERCS.wasteland).filter((id) => RTS_DEFS[id]);
    if (!list.length) return null;
    const id = list[Math.floor(Math.random() * list.length)];
    const nav = this.world.nav;
    const cell = nav.nearestCell(x, z, RTS_DEFS[id].size || 0, -1, 10);
    if (cell >= 0) ({ x, z } = nav.center(cell));
    const e = this.rtsSpawn(teamId, id, x, z, 0);
    if (e) e.rtsMerc = true;
    return e;
  },
  // 雇用：扣款、扣庫存，立刻出現在傭兵營的正面（屬於雇用的隊伍、照一般單位的指令）；回傳實體或 null
  rtsMercHire(teamId, merc, id) {
    const why = this.rtsMercWhy(teamId, merc, id);
    if (why) {
      if (teamId === (this.rts.me !== undefined ? this.rts.me : ME)) this.rtsSay(why);
      return null;
    }
    const rec = this.rtsNeutralRec(merc);
    const D = RTS_DEFS[id];
    if (!this.rtsPay(teamId, { ore: D.cost.ore || 0, coral: D.cost.coral || 0 })) return null;
    rec.stock[id].n--;
    const b = rec.ent;
    const yaw = b.yaw || 0;
    const k = (Math.round(yaw / (Math.PI / 2)) & 1) === 1;
    const half = (k ? b.bld.w : b.bld.d) / 2 + 3;
    let x = b.pos.x + Math.sin(yaw) * half,
      z = b.pos.z + Math.cos(yaw) * half;
    const nav = this.world.nav;
    const cell = nav.nearestCell(x, z, D.size || 0, -1, 10);
    if (cell >= 0) ({ x, z } = nav.center(cell));
    const e = this.rtsSpawn(teamId, id, x, z, yaw);
    if (!e) return null;
    e.rtsMerc = true;
    this.rtsRecount();
    if (teamId === (this.rts.me !== undefined ? this.rts.me : ME)) {
      if (this.rtsEvent) this.rtsEvent(x, z, '');
      this.rtsSay('雇用：' + D.name.replace('（傭兵）', ''), 0x9fe8a0);
    }
    return e;
  },
});
