// Coral 戰爭（RTS）R5 聖域互助同盟的陣營機制（mixin，docs/rts-design.md 16.2；A 包）：
// - 殘骸（rtsWreck*）：場上有聖域的隊伍時（R.salvage），任何隊伍死掉的單位與建築（含野怪、傭兵）留下殘骸紀錄
//   （不是實體、沒有 Object3D；外觀是 B 包的 InstancedMesh 批次，經由 this.rtsSancWreckFx(w, 'add'｜'set'｜'del'｜'seen')）。
//   價值只算定義的成本；4 m 內的單位殘骸合併（合計 ≤ 400 礦石）；動態殘骸最多 140 個（先移除價值最低的）；
//   查詢用 8 m 的格子雜湊（R.wreckGrid）。地圖殘骸（plan 裡模型屬於主題 wrecks 清單的障礙物）開局登記成 map 的殘骸：
//   不會過期、拆完只剩價值歸零（外觀與碰撞不變）。迷霧：殘骸只對看過它的隊伍存在（rtsWreckFog 在 rts-fog.js 的
//   每 0.2 秒迴圈），看不到的時候被拆完或過期的留下殘影（R.wreckGone），重新看到那一格才移除。
// - 拾荒（rtsSalvage*）：指令 { k: 'salvage', wid }（mech-rts.js 轉給 rtsSalvageStep）；工人走到殘骸邊緣、每 3 秒拆
//   12 礦石（研究 15／18），零件與 Coral 依比例，帶回最近的回收點（聚落中心、回收站、展開的回收拖車 e.rtsHaulOn）；
//   拾荒的礦石維持費只套一半（rtsDeposit 的 { salvage: true }）；拆完找 16 m 內下一個，沒有就回去採礦。
// - 零件（rtsParts*）：T.parts，上限 200（研究零件倉儲 300）；定義的費用可以有 parts（rtsAfford／rtsPay／rtsRefund）。
// - 臨時改裝（rtsRefit*）：改裝站（聚落中心、改裝工坊 12 m、展開的回收拖車 8 m、帶拼裝工具箱的英雄 10 m）附近，
//   扣零件＋礦石、引導 2 秒（rtsRefitHold：mech-rts.js 的 rtsAbTick 讓它不動），效果寫進數值層的 item 層。
// - 避難警報（rtsShelter*）：聚落中心 40 m 內的工人躲進最近的避難建築（沿用 rts-veer.js 搭乘的做法：從場景、空間索引、
//   敵對名單、選取拿掉；e.rtsAboard＝'sh'＋建築 id（字串：實體 id 可能是 0）、e.rtsShelter＝建築），有工人躲著的建築每人 dps 4 開火；45 秒或解除時出來、
//   回原本的工作；建築被拆時彈出、各受最大血量 50%。
// - 拆除（rtsScrap*）：3 秒後建築消失、留下價值 50% 的殘骸，佇列全額退還。
// - 地雷（rtsLandMine*；注意 R.mines／rtsMine(id) 是礦脈）：R.lmines，啟動後敵方的地面或低空單位 2 m 內引爆。
// - 潛航的迷霧（rtsSubSeen）：e.rtsSub（B 包設定）的實體只有 6 m 內有敵方實體或被照明、揭露時才看得到。
// - 診療所、互助網：每 0.5 秒 rtsBuff（src 'clinic'／'mutual'）。
// 各包的掛勾（沒有時略過）：this.rtsSancWreckFx(w, kind)、this.rtsSancMineFx(m, kind)、u.rtsSancNearDeath(e)、
// e.rtsSancRefitFx(rf, prev)、this.rtsHudSanc(teamId)、this.rtsHeroWreckK(e, from)（C：殘骸價值的倍率）。
import { SFX } from '../audio/audio.js';
import { RTS_REFITS, RTS_SANC } from '../data/rts-sancta.js';
import { RTS_DEFS, RTS_FACTIONS } from '../data/rts-units.js';
import { RTS_THEMES } from '../world/rts-map.js';
import { Game } from './game.js';

const ME = 0;
const S = RTS_SANC;
const W = S.wreck;
const hyp = Math.hypot;
const REACH_BLD = 3.2; // 同 mech-rts.js：離建築外形這麼近可以繳交
const NEUTRAL = 2;
const sizeOf = (ore) => (ore < W.sizes[0] ? 0 : ore < W.sizes[1] ? 1 : 2);
// 建築的邊緣距離（佔地矩形）；單位用中心距離
function edgeDist(b, x, z) {
  if (b.bld) {
    const dx = Math.max(0, Math.abs(x - b.pos.x) - b.bld.w / 2),
      dz = Math.max(0, Math.abs(z - b.pos.z) - b.bld.d / 2);
    return hyp(dx, dz);
  }
  return hyp(x - b.pos.x, z - b.pos.z);
}

Object.assign(Game.prototype, {
  // ================= 共用 =================
  // 這一隊的陣營有拾荒（聖域）
  rtsSalvageTeam(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return !!(T && RTS_FACTIONS[T.faction] && RTS_FACTIONS[T.faction].salvage);
  },
  // 開局（rts.js 的 rtsStart：建好兩邊的主堡、中立之後）
  rtsSalvageInit() {
    const R = this.rts;
    if (!R) return;
    R.salvage = R.teams.some(
      (T) => T && !T.neutral && RTS_FACTIONS[T.faction] && RTS_FACTIONS[T.faction].salvage,
    );
    R.wrecks = [];
    R.wreckN = 0;
    R.wreckMap = new Map();
    R.wreckGrid = new Map();
    R.wreckGone = []; // 殘影：已經不在、還有隊伍記得的殘骸（ghost＝哪些隊伍還記得，位元）
    R.lmines = [];
    R.lmineN = 0;
    R.sancT = 0;
    R.wreckT = 0;
    R.wreckMs = 0; // 效能：最近一次產生殘骸的耗時（ms）
    R.wreckFogMs = 0; // 迷霧的「看過」一輪的耗時
    for (const T of R.teams) if (T) T.parts = T.parts || 0;
    if (R.salvage) this.rtsWreckMapInit();
  },
  rtsPartsHud(teamId) {
    if (this.rtsHudSanc) this.rtsHudSanc(teamId);
  },

  // ================= 零件 =================
  rtsPartsCap(teamId) {
    return this.rtsResLv(teamId, 'r_stock') ? S.parts.capRes : S.parts.cap;
  },
  // 加零件（上限之外的丟掉，滿了提示一次）；回傳實際加的
  rtsPartsAdd(teamId, n) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T || !(n > 0)) return 0;
    const cap = this.rtsPartsCap(teamId);
    const v = Math.max(0, Math.min(n, cap - (T.parts || 0)));
    T.parts = (T.parts || 0) + v;
    if (v < n && !T.partsFull) {
      T.partsFull = true;
      if (teamId === ME) this.rtsSay(`零件已滿（上限 ${cap}）`, 0xffd070);
    } else if (T.parts < cap - 20) T.partsFull = false;
    this.rtsPartsHud(teamId);
    return v;
  },

  // ================= 殘骸 =================
  rtsWreckKey(x, z) {
    const h = this.world.size / 2;
    return Math.floor((x + h) / W.grid) * 4096 + Math.floor((z + h) / W.grid);
  },
  rtsWreckGridAdd(w) {
    const R = this.rts;
    const k = (w.gk = this.rtsWreckKey(w.x, w.z));
    let s = R.wreckGrid.get(k);
    if (!s) R.wreckGrid.set(k, (s = []));
    s.push(w);
  },
  rtsWreckGridDel(w) {
    const s = this.rts.wreckGrid.get(w.gk);
    if (!s) return;
    const i = s.indexOf(w);
    if (i >= 0) s.splice(i, 1);
  },
  rtsWreckById(id) {
    return (this.rts && this.rts.wreckMap && this.rts.wreckMap.get(id)) || null;
  },
  // 拾荒效率的研究：保留時間 +60 秒／級（場上聖域隊伍的最高級數）
  rtsWreckLifeAdd() {
    const R = this.rts;
    let lv = 0;
    for (const T of R.teams)
      if (T && !T.neutral && this.rtsSalvageTeam(T.id)) lv = Math.max(lv, this.rtsResLv(T.id, 'r_salv'));
    return lv * W.resLife;
  },
  // 實體的殘骸價值（null＝不產生）；scrap＝自己拆除
  rtsWreckValue(e, from, scrap = false) {
    const D = RTS_DEFS[e.rtsMilFrom || e.rtsDef];
    if (!D) return null;
    let ore = 0,
      coral = 0,
      parts = 0;
    if (e.bld) {
      // 升級過的主堡加上升級費（沿 from 往回加）
      let o = 0,
        c = 0;
      for (let id = D.id, n = 0; id && RTS_DEFS[id] && n < 8; id = RTS_DEFS[id].from, n++) {
        o += (RTS_DEFS[id].cost && RTS_DEFS[id].cost.ore) || 0;
        c += (RTS_DEFS[id].cost && RTS_DEFS[id].cost.coral) || 0;
      }
      const tier = Math.max(1, Math.min(3, D.tier || 1));
      if (scrap) {
        ore = o * W.scrapOre;
        parts = W.scrapParts[0] + W.scrapParts[1] * tier;
      } else {
        ore = o * W.bldOre;
        coral = c * W.bldCoral;
        parts = W.bldParts[tier - 1];
      }
    } else if (D.creep || D.merc) {
      const lv = D.lv || 1;
      ore = W.creepOre[0] + W.creepOre[1] * lv;
      parts = W.partsLv * lv;
    } else {
      ore = ((D.cost && D.cost.ore) || 0) * W.unitOre;
      coral = ((D.cost && D.cost.coral) || 0) * W.unitCoral;
      parts = W.partsLv * (D.lv || 1);
    }
    // C 包：SALVOR 的拾荒本能、聚落名冊（擊破者或附近的英雄讓殘骸價值變高）
    const k = !scrap && this.rtsHeroWreckK ? this.rtsHeroWreckK(e, from) || 1 : 1;
    ore = Math.floor(ore * k + 1e-9);
    coral = Math.floor(coral * k + 1e-9);
    parts = Math.floor(parts * k + 1e-9);
    if (ore < W.minOre) return null;
    return { ore, coral, parts, bld: !!e.bld, size: e.bld ? 3 : sizeOf(ore) };
  },
  // 死亡時產生殘骸（rts.js 的 rtsOnDeath → rtsSalvageOnDeath）
  rtsWreckAdd(e, from, o = {}) {
    const R = this.rts;
    if (!R || !R.salvage || !e) return null;
    if (
      !o.scrap &&
      (e.rtsQuiet || e.rtsIllus || e.rtsTemp || e.hero || e.rtsInv || e.rtsDriven || e.rtsAboard)
    )
      return null;
    const D = RTS_DEFS[e.rtsDef];
    if (!D || D.carrier || D.hero) return null;
    const t0 = performance.now();
    const v = this.rtsWreckValue(e, from, !!o.scrap);
    if (!v) return null;
    const x = e.pos.x,
      z = e.pos.z;
    const rec = this.rtsWreckPut(x, z, {
      ...v,
      team: e.rtsTeam,
      def: e.rtsMilFrom || e.rtsDef,
      rise: o.scrap ? 0.3 : e.bld ? W.bldRise : W.rise,
    });
    R.wreckMs = performance.now() - t0;
    return rec;
  },
  // 放一個殘骸（合併、上限、看得到的隊伍）；v＝{ ore, coral, parts, size?, bld?, team?, def?, life?, rise? }
  rtsWreckPut(x, z, v) {
    const R = this.rts,
      w0 = this.world;
    const life = (v.life || (v.bld ? W.bldLife : W.life)) + this.rtsWreckLifeAdd();
    const lim = w0.lim !== undefined ? w0.lim : w0.size / 2;
    x = Math.max(-lim, Math.min(lim, x));
    z = Math.max(-lim, Math.min(lim, z));
    const item = { team: v.team === undefined ? -1 : v.team, def: v.def || null, t0: R.t };
    // 合併：4 m 內的單位殘骸、合計 ≤ 400 礦石
    if (!v.bld) {
      let best = null,
        bd = W.mergeR;
      for (const w of this.rtsWreckAt(x, z, W.mergeR, { map: false, all: true })) {
        if (w.bld || w.map || w.ore + v.ore > W.mergeMax) continue;
        const d = hyp(w.x - x, w.z - z);
        if (d <= bd) ((bd = d), (best = w));
      }
      if (best) {
        best.ore += v.ore;
        best.coral += v.coral || 0;
        best.parts += v.parts || 0;
        best.ore0 += v.ore;
        best.size = sizeOf(best.ore);
        best.r = W.radius[best.size];
        best.end = Math.max(best.end, R.t + life);
        best.team = item.team;
        best.def = item.def;
        best.t0 = R.t;
        best.list.push(item);
        this.rtsWreckSeeNow(best);
        if (this.rtsSancWreckFx) this.rtsSancWreckFx(best, 'set');
        return best;
      }
    }
    const size = v.size !== undefined ? v.size : v.bld ? 3 : sizeOf(v.ore);
    const w = {
      id: 'w' + R.wreckN++,
      wreck: true,
      x,
      z,
      y: w0.terrainHeight(x, z),
      r: v.r || W.radius[size],
      ore: v.ore,
      coral: v.coral || 0,
      parts: v.parts || 0,
      ore0: v.ore,
      size,
      bld: !!v.bld,
      map: !!v.map,
      ob: v.ob || null,
      def: item.def,
      team: item.team,
      t0: R.t,
      life,
      end: v.map ? Infinity : R.t + life,
      rise: R.t + (v.rise || 0),
      takers: new Set(),
      seen: 0,
      known: {},
      list: [item],
      gone: false,
      ghost: 0,
      fx: null,
    };
    R.wrecks.push(w);
    R.wreckMap.set(w.id, w);
    this.rtsWreckGridAdd(w);
    // 上限（地圖殘骸另計）：先移除價值最低的
    if (!w.map) {
      let n = 0;
      for (const q of R.wrecks) if (!q.map) n++;
      while (n > W.max) {
        let low = null;
        for (const q of R.wrecks) if (!q.map && q !== w && (!low || q.ore < low.ore)) low = q;
        if (!low) break;
        this.rtsWreckRemove(low);
        n--;
      }
    }
    this.rtsWreckSeeNow(w);
    if (this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'add');
    return w;
  },
  // 產生或合併的當下，看得到那一格的隊伍立刻記下
  rtsWreckSeeNow(w) {
    const R = this.rts;
    for (const T of R.teams) {
      if (!T || T.neutral) continue;
      if (this.rtsFogState(T.id, w.x, w.z) === 2) {
        w.seen |= 1 << T.id;
        w.known[T.id] = { ore: w.ore, size: w.size };
      }
    }
  },
  // 除錯：直接放一個殘骸（B、C、E 測試用）
  rtsWreckSpawn(x, z, o = {}) {
    const R = this.rts;
    if (!R) return null;
    if (!R.wrecks) this.rtsSalvageInit();
    const ore = o.ore !== undefined ? o.ore : 60;
    return this.rtsWreckPut(x, z, {
      ore,
      coral: o.coral || 0,
      parts: o.parts !== undefined ? o.parts : 4,
      size: o.size,
      bld: o.size === 3 || !!o.bld,
      team: o.team,
      def: o.def,
      life: o.life,
    });
  },
  // 移除（拆完、過期、上限）：看過它、現在看不到那一格的隊伍留下殘影
  rtsWreckRemove(w) {
    const R = this.rts;
    if (!w || w.gone) return;
    w.gone = true;
    const i = R.wrecks.indexOf(w);
    if (i >= 0) R.wrecks.splice(i, 1);
    R.wreckMap.delete(w.id);
    this.rtsWreckGridDel(w);
    w.takers.clear();
    let ghost = 0;
    for (const T of R.teams) {
      if (!T || T.neutral || !(w.seen & (1 << T.id))) continue;
      if (this.rtsFogState(T.id, w.x, w.z) !== 2) ghost |= 1 << T.id;
    }
    w.ghost = ghost;
    if (ghost) R.wreckGone.push(w);
    if (!(ghost & (1 << ME)) && this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'del');
  },
  // 範圍內的殘骸（中心距離 − 殘骸半徑 ≤ r），由近到遠。
  // o.team＝只算這一隊看過的（地圖殘骸是公開資訊，一律算）、o.own＝只算原本是這一隊的、o.t＝幾秒內產生的、
  // o.map＝false 不含地圖殘骸、o.all＝含價值歸零的地圖殘骸
  rtsWreckAt(x, z, r, o = {}) {
    const R = this.rts;
    if (!R || !R.wreckGrid) return [];
    const out = [];
    const h = this.world.size / 2,
      reach = r + 4;
    const gx0 = Math.floor((x - reach + h) / W.grid),
      gx1 = Math.floor((x + reach + h) / W.grid),
      gz0 = Math.floor((z - reach + h) / W.grid),
      gz1 = Math.floor((z + reach + h) / W.grid);
    for (let gx = gx0; gx <= gx1; gx++)
      for (let gz = gz0; gz <= gz1; gz++) {
        const s = R.wreckGrid.get(gx * 4096 + gz);
        if (!s) continue;
        for (const w of s) {
          if (w.gone || (!o.all && w.ore <= 0)) continue;
          if (o.map === false && w.map) continue;
          if (o.team !== undefined && !w.map && !(w.seen & (1 << o.team))) continue;
          if (o.own !== undefined && w.team !== o.own) continue;
          if (o.t !== undefined && R.t - w.t0 > o.t) continue;
          const d = hyp(w.x - x, w.z - z) - (w.map ? 0 : w.r);
          if (d > r) continue;
          w._d = d;
          out.push(w);
        }
      }
    out.sort((a, b) => a._d - b._d);
    return out;
  },
  // 拿走殘骸的價值（拾荒、吸附、重組、英雄技能）：最多 maxOre 礦石，零件與 Coral 依比例（無條件進位）；
  // 回傳 { ore, coral, parts }。拆完時移除（地圖殘骸只歸零）
  rtsWreckTake(w, maxOre) {
    if (!w || w.gone || !(w.ore > 0)) return { ore: 0, coral: 0, parts: 0 };
    const take = Math.min(maxOre, w.ore);
    const k = take / w.ore;
    const parts = Math.min(w.parts, Math.ceil(w.parts * k - 1e-9));
    const coral = Math.min(w.coral, Math.ceil(w.coral * k - 1e-9));
    w.ore -= take;
    w.parts -= parts;
    w.coral -= coral;
    if (w.ore <= 1e-6) {
      w.ore = 0;
      if (w.map) {
        w.parts = 0;
        w.coral = 0;
        if (this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'set');
      } else this.rtsWreckRemove(w);
    } else {
      w.size = w.bld || w.map ? w.size : sizeOf(w.ore);
      if (this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'set');
    }
    return { ore: take, coral, parts };
  },
  // 地圖殘骸：plan 裡模型屬於主題 wrecks 清單的障礙物（不改 plan、不用亂數）
  rtsWreckMapInit() {
    const R = this.rts,
      plan = this.world && this.world.rts;
    if (!plan) return 0;
    const TH = RTS_THEMES[R.cfg.theme] || RTS_THEMES[plan.theme] || {};
    const models = new Set((TH.wrecks || []).map((s) => s.model));
    let n = 0;
    for (const o of plan.obstacles || []) {
      if (!models.has(o.model)) continue;
      const r = o.kind === 'box' ? Math.max(o.w || 2, o.d || 2) / 2 : o.r || 2;
      this.rtsWreckPut(o.x, o.z, {
        ore: W.map.ore,
        coral: 0,
        parts: W.map.parts,
        size: 3,
        map: true,
        r,
        ob: o,
        team: -1,
        def: null,
      });
      n++;
    }
    return n;
  },
  // 電腦 AI：看過、還沒確認消失的殘骸（地圖殘骸一律列出；價值是最後看到的）
  rtsWreckKnown(teamId) {
    const R = this.rts;
    if (!R || !R.wrecks) return [];
    const out = [];
    const bit = 1 << teamId;
    for (const w of R.wrecks) {
      if (!w.map && !(w.seen & bit)) continue;
      if (w.map && w.ore <= 0) continue;
      const k = w.known[teamId] || { ore: w.ore, size: w.size };
      out.push({
        id: w.id,
        x: w.x,
        z: w.z,
        ore: w.map ? w.ore : k.ore,
        size: k.size,
        map: w.map,
        team: w.team,
        gone: false,
      });
    }
    for (const w of R.wreckGone)
      if (w.ghost & bit) {
        const k = w.known[teamId] || { ore: 0, size: w.size };
        out.push({
          id: w.id,
          x: w.x,
          z: w.z,
          ore: k.ore,
          size: k.size,
          map: w.map,
          team: w.team,
          gone: true,
        });
      }
    return out;
  },
  // 迷霧（rts-fog.js 的 rtsFogUpdate 每 0.2 秒）：看得到的殘骸設 seen、記下價值；殘影重新看到時移除
  rtsWreckFog(F) {
    const R = this.rts;
    if (!R || !R.wrecks) return;
    const t0 = performance.now();
    const me = F.me;
    for (const w of R.wrecks) {
      const c = this.rtsFogCell(F, w.x, w.z);
      for (const T of F.teams) {
        if (R.teams[T.id] && R.teams[T.id].neutral) continue;
        if (!(T.cheat || (c >= 0 && T.vis[c]))) continue;
        const bit = 1 << T.id;
        const k = w.known[T.id] || (w.known[T.id] = { ore: 0, size: 0 });
        k.ore = w.ore;
        k.size = w.size;
        if (!(w.seen & bit)) {
          w.seen |= bit;
          if (T.id === me && this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'seen');
        }
      }
    }
    if (R.wreckGone.length) {
      for (const w of R.wreckGone) {
        const c = this.rtsFogCell(F, w.x, w.z);
        for (const T of F.teams) {
          const bit = 1 << T.id;
          if (!(w.ghost & bit)) continue;
          if (T.cheat || (c >= 0 && T.vis[c])) {
            w.ghost &= ~bit;
            if (T.id === me && this.rtsSancWreckFx) this.rtsSancWreckFx(w, 'del');
          }
        }
      }
      R.wreckGone = R.wreckGone.filter((w) => w.ghost);
    }
    R.wreckFogMs = performance.now() - t0;
  },
  // 過期（每 0.25 秒）
  rtsWreckTick(dt) {
    const R = this.rts;
    R.wreckT -= dt;
    if (R.wreckT > 0) return;
    R.wreckT = 0.25;
    for (let i = R.wrecks.length - 1; i >= 0; i--) {
      const w = R.wrecks[i];
      if (!w.map && R.t >= w.end) this.rtsWreckRemove(w);
    }
  },
  // 效能基準（scripts/rts-bench.js 的 --wrecks=N；一般任務、沒有 this.rts）：在 (cx, cz) 附近放 n 個殘骸紀錄，
  // 交給 B 包的外觀（rtsSancWreckFx 'add' 與 'seen'）；回傳紀錄
  rtsWreckBench(n, cx = 0, cz = 0) {
    const list = (this.rtsBenchWrecks = []);
    let s = 12345;
    const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2,
        r = 4 + Math.sqrt(rnd()) * 36;
      const x = cx + Math.cos(a) * r,
        z = cz + Math.sin(a) * r;
      const ore = 20 + Math.floor(rnd() * 300);
      const size = i % 12 === 0 ? 3 : sizeOf(ore);
      const w = {
        id: 'wb' + i,
        wreck: true,
        x,
        z,
        y: this.world.terrainHeight(x, z),
        r: W.radius[size],
        ore,
        coral: 0,
        parts: 4,
        ore0: ore,
        size,
        bld: size === 3,
        map: false,
        team: i & 1,
        def: null,
        t0: 0,
        life: 1e9,
        end: Infinity,
        rise: 0,
        takers: new Set(),
        seen: 7,
        known: {},
        list: [],
        gone: false,
        ghost: 0,
        fx: null,
      };
      list.push(w);
      if (this.rtsSancWreckFx) {
        this.rtsSancWreckFx(w, 'add');
        this.rtsSancWreckFx(w, 'seen');
      }
    }
    return list;
  },

  // ================= 拾荒 =================
  // 每趟的量（工人；回收拖車另外是 RTS_SANC.hauler）
  rtsSalvageTrip(teamId, hauler = false) {
    const lv = this.rtsResLv(teamId, 'r_salv');
    const P = hauler ? S.hauler : S.salvage;
    return lv ? P.tripRes[Math.min(lv, P.tripRes.length) - 1] : P.trip;
  },
  // 回收點（rts.js 的 rtsDropoff：蓋好的聚落中心、回收站、展開的回收拖車）
  rtsSalvageDropoff(teamId, x, z) {
    return this.rtsDropoff(teamId, x, z);
  },
  // 入帳：礦石的維持費只套一半、Coral 照常、零件加到 T.parts（上限）
  rtsSalvageDeposit(teamId, c) {
    const R = this.rts;
    if (!c) return;
    const ore = c.ore !== undefined ? c.ore : c.n || 0;
    if (ore > 0) this.rtsDeposit(teamId, 'ore', ore, { salvage: true });
    if (c.coral > 0) this.rtsDeposit(teamId, 'coral', c.coral);
    if (c.parts > 0) this.rtsPartsAdd(teamId, c.parts);
    const st = R.stats[teamId];
    if (st) {
      st.salvOre = (st.salvOre || 0) + ore;
      st.salvCoral = (st.salvCoral || 0) + (c.coral || 0);
      st.salvParts = (st.salvParts || 0) + (c.parts || 0);
    }
    this.rtsPartsHud(teamId);
  },
  // 下一個殘骸：(x, z) 16 m 內、這一隊看過的、還沒滿的，離 e 最近
  rtsSalvageNext(e, x, z) {
    const list = this.rtsWreckAt(x, z, S.salvage.next, { team: e.rtsTeam });
    let best = null,
      bd = 1e9;
    for (const w of list) {
      const sat = w.map ? W.map.sat : S.salvage.sat;
      const full = w.takers.size >= sat && !w.takers.has(e.id);
      const d = hyp(w.x - e.pos.x, w.z - e.pos.z) + (full ? 30 : 0);
      if (d < bd) ((bd = d), (best = w));
    }
    return best;
  },
  rtsSalvageLeave(e) {
    const rt = e.rt;
    if (rt && rt.salvW) {
      rt.salvW.takers.delete(e.id);
      rt.salvW = null;
    }
  },
  // 指令 { k: 'salvage', wid }（mech-rts.js 轉來）：走到殘骸邊緣 → 拆 3 秒 → 帶回回收點 → 下一趟。回傳 true＝指令完成
  rtsSalvageStep(e, o, dt) {
    const R = this.rts,
      rt = e.rt;
    const D = RTS_DEFS[e.rtsDef] || {};
    if (!R || !R.wrecks || !D.salvager || !D.worker) return true;
    let w = this.rtsWreckById(o.wid);
    if (w && w.gone) w = null;
    const P = S.salvage;
    if (!rt.sp) rt.sp = e.carry && e.carry.n ? 'back' : 'to';
    if (w) {
      o.lx = w.x;
      o.lz = w.z;
    }
    if (rt.sp !== 'back' && (!w || w.ore <= 0)) {
      if (rt.salvW) this.rtsSalvageLeave(e);
      const n = this.rtsSalvageNext(
        e,
        o.lx !== undefined ? o.lx : e.pos.x,
        o.lz !== undefined ? o.lz : e.pos.z,
      );
      if (n) {
        o.wid = n.id;
        w = n;
        rt.nav = null;
        rt.sp = 'to';
        rt.sAng = undefined;
      } else if (e.carry && e.carry.n) rt.sp = 'back';
      else {
        // 沒有殘骸了：回原本的礦脈
        const m = rt.lastMine !== undefined ? this.rtsMine(rt.lastMine) : null;
        if (m && m.amount > 0 && e.orders.length <= 1) e.orders.push({ k: 'gather', mine: m.id });
        return true;
      }
    }
    if (rt.sp === 'to') {
      const d = hyp(w.x - e.pos.x, w.z - e.pos.z) - w.r;
      if (d > P.reach) {
        if (rt.sAng === undefined || rt.sW !== w.id) {
          rt.sW = w.id;
          rt.sAng = Math.atan2(e.pos.z - w.z, e.pos.x - w.x) + ((e.id % 5) - 2) * 0.4;
        }
        const r = w.r + 1;
        e.rtsGo(w.x + Math.cos(rt.sAng) * r, w.z + Math.sin(rt.sAng) * r, 1, dt, null);
        if (d > P.reach + 0.5) return false;
      }
      rt.face = rt.faceV.set(w.x, e.pos.y + 0.6, w.z);
      const sat = w.map ? W.map.sat : P.sat;
      for (const id of w.takers) {
        const u = this.rtsEnt(id);
        if (!u || u.dead || !u.rt || u.rt.salvW !== w) w.takers.delete(id);
      }
      if (w.takers.size >= sat && !w.takers.has(e.id)) {
        rt.sWait = (rt.sWait || 0) + dt;
        if (rt.sWait > 3) {
          rt.sWait = 0;
          const n = this.rtsSalvageNext(e, w.x, w.z);
          if (n && n !== w) {
            o.wid = n.id;
            rt.nav = null;
            rt.sAng = undefined;
          }
        }
        return false;
      }
      rt.sWait = 0;
      w.takers.add(e.id);
      rt.salvW = w;
      rt.sp = 'work';
      rt.sT = 0;
      return false;
    }
    if (rt.sp === 'work') {
      if (!w || w.ore <= 0 || rt.salvW !== w) {
        this.rtsSalvageLeave(e);
        rt.sp = 'to';
        return false;
      }
      rt.face = rt.faceV.set(w.x, e.pos.y + 0.6, w.z);
      rt.sT += dt;
      if (e.model.rtsDrill) e.model.rtsDrill.rotation.y += dt * 20;
      if (Math.random() < dt * 3) {
        const p = new THREE.Vector3(w.x + (e.pos.x - w.x) * 0.4, w.y + 0.8, w.z + (e.pos.z - w.z) * 0.4);
        if (this.rtsFxOk(p)) this.fx.spark(p, 0xffb070);
      }
      if (rt.sT >= P.time) {
        const got = this.rtsWreckTake(w, this.rtsSalvageTrip(e.rtsTeam));
        e.carry = { kind: 'salv', n: got.ore, ore: got.ore, coral: got.coral, parts: got.parts };
        this.rtsSalvageLeave(e);
        if (e.model.rtsDrill) e.model.rtsDrill.rotation.y = 0;
        rt.sp = 'back';
        rt.nav = null;
      }
      return false;
    }
    // 帶回最近的回收點
    const b = this.rtsSalvageDropoff(e.rtsTeam, e.pos.x, e.pos.z);
    if (!b) return false;
    if (e.rtsDistTo(b) > REACH_BLD) {
      e.rtsGoBld(b, dt);
      return false;
    }
    rt.sdT = (rt.sdT || 0) + dt;
    if (rt.sdT < 0.5) return false;
    rt.sdT = 0;
    if (e.carry && e.carry.n) {
      if (e.carry.kind === 'salv') this.rtsSalvageDeposit(e.rtsTeam, e.carry);
      else {
        this.rtsDeposit(e.rtsTeam, e.carry.kind, e.carry.n);
        R.stats[e.rtsTeam].ore += e.carry.n;
      }
    }
    e.carry = null;
    rt.sp = 'to';
    rt.sAng = undefined;
    rt.nav = null;
    return false;
  },
  // 指令的發佈（rts-orders.js）：會拾荒的工人拆殘骸、其他的走過去；回傳派出的台數
  rtsSalvageOrder(units, w, queue = false) {
    if (!w) return 0;
    let n = 0;
    for (const e of units) {
      const D = RTS_DEFS[e.rtsDef] || {};
      const o = D.salvager && D.worker ? { k: 'salvage', wid: w.id } : { k: 'move', x: w.x, z: w.z };
      if (o.k === 'salvage') n++;
      if (queue && e.orders.length) e.orders.push(o);
      else this.rtsSetOrders(e, [o]);
    }
    return n;
  },

  // ================= 臨時改裝 =================
  // 這台單位能不能裝 rf（不看位置與費用）
  rtsRefitOk(e, rf) {
    const D = RTS_DEFS[e.rtsDef] || {};
    const F = RTS_REFITS[rf];
    if (!F) return false;
    if (D.refitOk) return D.refitOk.includes(rf);
    const atk = !!(D.range && (D.dps || D.slotDps));
    const ground = !D.flying;
    if (F.ok === 'atk') return atk;
    if (F.ok === 'ground') return ground;
    if (F.ok === 'atkGround') return atk && ground && D.aa !== 'both' && D.aa !== 'air';
    return true;
  },
  // 改裝站：蓋好的聚落中心與改裝工坊（refitSt）、展開的回收拖車、帶拼裝工具箱的英雄；回傳 [{ e, r, tool }]
  rtsRefitStations(teamId) {
    const R = this.rts,
      out = [];
    for (const u of R.units) {
      if (u.dead || u.rtsTeam !== teamId || u.rtsAboard) continue;
      const D = RTS_DEFS[u.rtsDef] || {};
      if (u.bld) {
        if (D.refitSt && u.bld.progress >= 1 && !u.bld.packed) out.push({ e: u, r: D.refitSt });
      } else if (D.hauler && u.rtsHaulOn) out.push({ e: u, r: D.refitSt || S.hauler.refitR });
      else if (u.hero && this.rtsHeroHas && this.rtsHeroHas(u.hero, 'i_toolbox'))
        out.push({ e: u, r: S.refit.heroR, tool: true });
    }
    return out;
  },
  // 單位在哪個改裝站的範圍內（最近的；null＝不在）；距離：建築從佔地邊緣算
  rtsRefitNear(e, st) {
    let best = null,
      bd = 1e9;
    for (const s of st || this.rtsRefitStations(e.rtsTeam)) {
      if (s.e === e) continue;
      const d = edgeDist(s.e, e.pos.x, e.pos.z) - s.r;
      if (d <= 0 && d < bd) ((bd = d), (best = s));
    }
    return best;
  },
  // 費用：零件 × 0.75（零件倉儲）× 0.75（拼裝工具箱的英雄 10 m 內），無條件進位
  rtsRefitCost(teamId, rf, e = null, st = null) {
    const F = RTS_REFITS[rf];
    if (!F) return null;
    let k = 1;
    if (this.rtsResLv(teamId, 'r_stock')) k *= S.refit.resK;
    if (e)
      for (const s of st || this.rtsRefitStations(teamId))
        if (s.tool && hyp(s.e.pos.x - e.pos.x, s.e.pos.z - e.pos.z) <= s.r) {
          k *= S.refit.resK;
          break;
        }
    return { parts: Math.ceil(F.cost.parts * k - 1e-9), ore: F.cost.ore };
  },
  // 不能改裝的原因（''＝可以）；o.noRange＝不看位置、o.noCost＝不看費用
  rtsRefitWhy(e, rf, o = {}) {
    const R = this.rts;
    const F = RTS_REFITS[rf];
    if (!R || !F) return '沒有這個改裝';
    if (!e || e.dead) return '沒有選取單位';
    if (!this.rtsSalvageTeam(e.rtsTeam)) return '這個陣營不能改裝';
    const D = RTS_DEFS[e.rtsDef] || {};
    if (e.bld) return '建築不能改裝';
    if (e.hero || D.hero) return '英雄不能改裝';
    if (D.worker) return '工人不能改裝';
    if (e.rtsIllus || e.rtsTemp) return '臨時單位不能改裝';
    if (e.rtsAboard) return '搭乘中不能改裝';
    if (e.rtsRefitTo) return '改裝中';
    if (!this.rtsRefitOk(e, rf)) return '這個單位不能裝';
    if (e.rtsRefit === rf) return '已經裝了';
    if (F.tier > 1 && this.rtsTier(e.rtsTeam) < F.tier)
      return `需要 ${this.rtsTierName(e.rtsTeam, F.tier)}（T${F.tier}）`;
    const st = o.st || this.rtsRefitStations(e.rtsTeam);
    if (!o.noRange && !this.rtsRefitNear(e, st)) return '要在改裝工坊 12 m 內';
    if (!o.noCost) {
      const c = this.rtsRefitCost(e.rtsTeam, rf, e, st);
      const T = R.teams[e.rtsTeam];
      if ((T.parts || 0) < c.parts) return '零件不足';
      if (T.ore < c.ore) return '礦石不足';
    }
    return '';
  },
  // 改裝選取中的單位（卡片 { k: 'refit', rf }）：在範圍內的依距離扣款、引導 2 秒；回傳開始改裝的台數
  rtsRefit(units, rf) {
    const R = this.rts;
    if (!R || !RTS_REFITS[rf]) return 0;
    const list = (units || []).filter((e) => e && !e.dead && !e.bld && e.rtsDef);
    if (!list.length) return 0;
    const team = list[0].rtsTeam;
    const me = team === ME;
    const st = this.rtsRefitStations(team);
    // 依離改裝站的距離排序
    const dist = (e) => {
      let d = 1e9;
      for (const s of st) if (s.e !== e) d = Math.min(d, edgeDist(s.e, e.pos.x, e.pos.z) - s.r);
      return d;
    };
    list.sort((a, b) => dist(a) - dist(b));
    let n = 0,
      far = 0,
      lack = '',
      other = '';
    for (const e of list) {
      if (e.rtsTeam !== team) continue;
      const why = this.rtsRefitWhy(e, rf, { st });
      if (why === '要在改裝工坊 12 m 內') {
        far++;
        continue;
      }
      if (why === '零件不足' || why === '礦石不足') {
        lack = why;
        break;
      }
      if (why) {
        other = other || why;
        continue;
      }
      const c = this.rtsRefitCost(team, rf, e, st);
      const T = R.teams[team];
      T.parts -= c.parts;
      T.ore -= c.ore;
      e.rtsRefitTo = rf;
      e.rtsRefitT = R.t + S.refit.time;
      this.rtsSetOrders(e, []);
      n++;
    }
    if (me) {
      if (lack) this.rtsSay(`${lack}：改了 ${n} 台`);
      else if (!n && far) this.rtsSay('要在改裝工坊 12 m 內');
      else if (!n && other) this.rtsSay(other);
      else if (n)
        this.rtsSay(
          `改裝：${RTS_REFITS[rf].name}（${n} 台）${far ? `；${far} 台不在改裝站附近` : ''}`,
          0xffd070,
        );
    }
    if (n) this.rtsPartsHud(team);
    return n;
  },
  // 引導中（mech-rts.js 的 rtsAbTick：這一格不動也不開火）
  rtsRefitHold(e) {
    const R = this.rts;
    return !!(R && e.rtsRefitTo && R.t < e.rtsRefitT);
  },
  // 改裝完成：數值層 item、對空支架的旗標、B 的外加零件
  rtsRefitApply(e, rf) {
    const R = this.rts;
    const F = RTS_REFITS[rf];
    if (!F || e.dead) return;
    const prev = e.rtsRefit || null;
    e.rtsRefit = rf;
    e.rtsRefitTo = null;
    e.rtsRefitT = 0;
    if (!e.rtsMods) return;
    e.rtsMods.item = { ...(F.mods || {}) };
    e.rtsAa = F.aa ? 'both' : null;
    e.rtsAaK = F.aa ? F.aaK : 1;
    this.rtsModsApply(e);
    if (R.stats[e.rtsTeam]) R.stats[e.rtsTeam].refits = (R.stats[e.rtsTeam].refits || 0) + 1;
    if (e.rtsSancRefitFx) e.rtsSancRefitFx(rf, prev);
    if (this.rtsFxOk(e.center())) {
      this.fx.flash(e.center(), 1.4, 0xffc070, 0.15);
      this.fx.ring(e.pos.clone().setY(e.pos.y + 0.2), 2, 0xffc070);
    }
    this.rtsPartsHud(e.rtsTeam);
  },
  rtsRefitTick() {
    const R = this.rts;
    for (const e of R.units)
      if (!e.dead && e.rtsRefitTo && R.t >= e.rtsRefitT) this.rtsRefitApply(e, e.rtsRefitTo);
  },
  // 自爆裝藥：陣亡時 4 m 80 爆發＋暈眩 0.5 秒（只打敵人）
  rtsRefitBomb(e) {
    const F = RTS_REFITS.rf_bomb.bomb;
    const x = e.pos.x,
      z = e.pos.z;
    const R = this.rts;
    const hit = [];
    for (const t of this.rtsNear(x, z, F.r + 6)) {
      if (!t || t.dead || t.rtsInv || t.rtsTeam === e.rtsTeam || t.rtsAboard) continue;
      if (t.flying && !(this.rtsLowAir && this.rtsLowAir(t))) continue;
      const d = t.shape ? edgeDist(t, x, z) : Math.max(0, hyp(t.pos.x - x, t.pos.z - z) - (t.radius || 1));
      if (d <= F.r) hit.push(t);
    }
    this.rtsSplash(x, z, F.r, F.dmg, 160, e, 'exp', e.rtsTeam);
    if (this.rtsStun) for (const t of hit) if (!t.dead && !t.bld) this.rtsStun(t, F.stun);
    const p = new THREE.Vector3(x, e.pos.y + 1, z);
    if (this.rtsFxOk(p)) this.fx.explosion(p, F.r, 0xff9040, true);
    SFX.explode(true, p);
    void R;
  },

  // ================= 避難警報 =================
  rtsShelterCap(b) {
    const D = RTS_DEFS[b.rtsDef] || {};
    if (!b.bld || b.dead || b.bld.progress < 1 || b.bld.packed) return 0;
    return D.shelter || 0;
  },
  rtsShelterWhy(hq) {
    const R = this.rts;
    if (!R || !hq || hq.dead || !hq.bld) return '沒有聚落中心';
    const D = RTS_DEFS[hq.rtsDef] || {};
    if (!(D.abil || []).includes('ab_shelter')) return '這座建築不能施放';
    if (hq.bld.progress < 1) return '建築還沒蓋好';
    const cd = hq.rtsCd && hq.rtsCd.ab_shelter;
    if (cd > R.t) return `冷卻中（${Math.ceil(cd - R.t)} 秒）`;
    return '';
  },
  // 施放：40 m 內的工人各自跑向最近、還有空位的避難建築；回傳派出的工人數
  rtsShelter(hq) {
    const R = this.rts;
    const why = this.rtsShelterWhy(hq);
    if (why) {
      if (hq && hq.rtsTeam === ME) this.rtsSay(`避難警報：${why}`);
      return 0;
    }
    const team = hq.rtsTeam;
    const blds = R.units.filter((b) => !b.dead && b.bld && b.rtsTeam === team && this.rtsShelterCap(b) > 0);
    const used = new Map();
    for (const b of blds) used.set(b, (b.bld.shel ? b.bld.shel.length : 0) + (b.bld.shelRes || 0));
    const end = R.t + S.shelter.t;
    let n = 0;
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== team || e.rtsAboard) continue;
      const D = RTS_DEFS[e.rtsDef] || {};
      if (!D.worker || e.rtsPiloted) continue;
      if (edgeDist(hq, e.pos.x, e.pos.z) > S.shelter.r) continue;
      if (e.orders[0] && e.orders[0].k === 'shelter') continue;
      let best = null,
        bd = 1e9;
      for (const b of blds) {
        if (used.get(b) >= this.rtsShelterCap(b)) continue;
        const d = edgeDist(b, e.pos.x, e.pos.z);
        if (d < bd) ((bd = d), (best = b));
      }
      if (!best) break;
      used.set(best, used.get(best) + 1);
      best.bld.shelRes = (best.bld.shelRes || 0) + 1;
      e.rtsShelPrev = e.orders.filter((o) => o && o.k !== 'shelter').map((o) => ({ ...o }));
      if (!e.rtsShelPrev.length && e.rt && e.rt.lastMine !== undefined)
        e.rtsShelPrev = [{ k: 'gather', mine: e.rt.lastMine }];
      this.rtsSetOrders(e, [{ k: 'shelter', id: best.id, end }]);
      n++;
    }
    if (!hq.rtsCd) hq.rtsCd = {};
    hq.rtsCd.ab_shelter = R.t + S.shelter.cd;
    if (team === ME)
      this.rtsSay(n ? `避難警報：${n} 台工人避難` : '避難警報：附近沒有工人', n ? 0xffd070 : undefined);
    this.rtsPartsHud(team);
    return n;
  },
  // 指令 { k: 'shelter', id, end }（mech-rts.js 轉來）：走到建築旁邊就躲進去
  rtsShelterStep(e, o, dt) {
    const b = this.rtsEnt(o.id);
    const R = this.rts;
    const done = () => {
      if (b && b.bld && b.bld.shelRes > 0 && !o.res0) {
        b.bld.shelRes--;
        o.res0 = true;
      }
    };
    if (!b || b.dead || !b.bld || (o.end !== undefined && R.t >= o.end)) {
      done();
      if (e.rtsShelPrev) {
        e.orders = [...e.rtsShelPrev, ...e.orders.slice(1)];
        e.rtsShelPrev = null;
        return false;
      }
      return true;
    }
    if (e.rtsDistTo(b) > REACH_BLD) {
      e.rtsGoBld(b, dt);
      return false;
    }
    done();
    if ((b.bld.shel ? b.bld.shel.length : 0) >= this.rtsShelterCap(b)) return true;
    this.rtsShelterIn(e, b, o.end);
    return true;
  },
  // 躲進建築（同 rts-veer.js 的 rtsBoard：從場景、空間索引、敵對名單、選取拿掉）
  rtsShelterIn(e, b, end) {
    const R = this.rts;
    if (e.rtsLeaveOrder) e.rtsLeaveOrder(null);
    this.rtsSalvageLeave(e);
    e.orders = [];
    if (e.rt) {
      e.rt.cur = undefined;
      e.rt.nav = null;
      e.rt.home = null;
      e.rt.engage = null;
    }
    e.rtsAboard = 'sh' + b.id; // 字串（建築的 id 可能是 0；rts-veer.js 的運輸機用數字 id）
    e.rtsShelter = b;
    e.rtsShelT = end !== undefined ? end : R.t + S.shelter.t;
    (b.bld.shel || (b.bld.shel = [])).push(e.id);
    e.vel.set(0, 0, 0);
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    R.hash.remove(e);
    for (const L of [this.enemies, this.allies, ...R.hostile]) {
      const i = L.indexOf(e);
      if (i >= 0) L.splice(i, 1);
    }
    const si = R.sel.indexOf(e);
    if (si >= 0) R.sel.splice(si, 1);
    this.rtsPartsHud(e.rtsTeam);
  },
  // 出來：在建築邊緣找可以走的格子；hurtK＝受到最大血量的比例（建築被拆）
  rtsShelterOut(e, hurtK = 0) {
    const R = this.rts,
      w = this.world;
    if (!e || !e.rtsShelter) return false;
    const b = e.rtsShelter;
    if (b && b.bld && b.bld.shel) {
      const i = b.bld.shel.indexOf(e.id);
      if (i >= 0) b.bld.shel.splice(i, 1);
    }
    const bx = b ? b.pos.x : e.pos.x,
      bz = b ? b.pos.z : e.pos.z;
    const rr = b && b.bld ? Math.max(b.bld.w, b.bld.d) / 2 + 2 : 2;
    const a = (e.id * 2.39996) % (Math.PI * 2);
    let x = bx + Math.cos(a) * rr,
      z = bz + Math.sin(a) * rr;
    const D = RTS_DEFS[e.rtsDef] || {};
    const c = w.nav.nearestCell(x, z, D.size || 0, -1, 12);
    if (c >= 0) ({ x, z } = w.nav.center(c));
    e.rtsAboard = null;
    e.rtsShelter = null;
    e.rtsShelT = 0;
    e.pos.set(x, w.groundAt(x, z, w.terrainHeight(x, z) + 2), z);
    e.vel.set(0, 0, 0);
    e.mesh.position.copy(e.pos);
    this.scene.add(e.mesh);
    R.hash.insert(e, x, z);
    (e.rtsTeam === ME ? this.allies : this.enemies).push(e);
    e.orders = (e.rtsShelPrev || []).filter((o) => o && o.k !== 'shelter');
    e.rtsShelPrev = null;
    if (e.rt) {
      e.rt.cur = undefined;
      e.rt.nav = null;
      e.rt.home = null;
    }
    if (hurtK > 0) this.rtsHit(e, e.maxHp * hurtK, 0, null, 'none');
    this.rtsPartsHud(e.rtsTeam);
    return true;
  },
  // 解除避難（S；瞭望塔與避難屋的 D＝只放出這一座的）：回傳出來的工人數
  rtsUnshelter(b) {
    const R = this.rts;
    if (!R || !b || !b.bld) return 0;
    const D = RTS_DEFS[b.rtsDef] || {};
    const all = (D.abil || []).includes('ab_shelter');
    let n = 0;
    for (const u of R.units.slice()) {
      if (u.dead || u.rtsTeam !== b.rtsTeam) continue;
      if (u.rtsShelter && (all || u.rtsShelter === b)) n += this.rtsShelterOut(u, 0) ? 1 : 0;
      else if (!u.bld && u.orders[0] && u.orders[0].k === 'shelter' && (all || u.orders[0].id === b.id)) {
        // 還在跑過去的：回原本的工作
        const o = u.orders[0];
        const t = this.rtsEnt(o.id);
        if (t && t.bld && t.bld.shelRes > 0 && !o.res0) t.bld.shelRes--;
        u.orders = u.rtsShelPrev || [];
        u.rtsShelPrev = null;
      }
    }
    if (b.rtsTeam === ME && n) this.rtsSay(`解除避難：${n} 台工人回去工作`, 0x9fd0ff);
    return n;
  },
  // 每格：到期出來、有工人躲著的建築開火
  rtsShelterTick(dt) {
    const R = this.rts;
    for (const e of R.units) {
      if (e.dead) continue;
      if (e.rtsShelter && R.t >= e.rtsShelT) this.rtsShelterOut(e, 0);
      else if (e.bld && e.bld.shel && e.bld.shel.length && e.bld.progress >= 1) this.rtsShelterFire(e, dt);
    }
  },
  // 躲著的工人每人 dps 4、射程 22（瞭望塔用自己的射程），實彈、地空都打；聚落中心最多 40
  rtsShelterFire(b, dt) {
    const D = RTS_DEFS[b.rtsDef] || {};
    const n = b.bld.shel.length;
    b.rtsShelCd = (b.rtsShelCd || 0) - dt;
    if (b.rtsShelCd > 0) return;
    const range = D.range ? this.rtsBldRange(b) || D.range : S.shelter.range;
    const gun = { aa: 'both', range };
    const t = b.rtsTowerScan ? b.rtsTowerScan(gun, range) : null;
    if (!t) {
      b.rtsShelCd = 0.25;
      return;
    }
    b.rtsShelCd = S.shelter.rof;
    const dps = Math.min(S.shelter.dpsMax, S.shelter.dps * n);
    const dmg = dps * S.shelter.rof * (b.dmgMul || 1);
    const top = b.pos.y + (D.height || 6) * 0.6;
    const from = new THREE.Vector3(b.pos.x, top, b.pos.z);
    const c = t.center();
    const dir = c.clone().sub(from).setY(0).normalize();
    from.addScaledVector(dir, Math.min(b.bld.w, b.bld.d) / 2 - 0.3);
    if (this.rtsFxOk(from) || this.rtsFxOk(c)) this.fx.beam(from, c, 0xffe0a0, 0.04);
    SFX.shot('rifle', undefined, from);
    this.rtsHit(t, dmg, 20, b, 'kin');
    b.rtsShelShots = (b.rtsShelShots || 0) + 1;
  },

  // ================= 拆除 =================
  rtsScrapWhy(b) {
    const R = this.rts;
    if (!R || !b || b.dead || !b.bld) return '沒有選取建築';
    if (!this.rtsSalvageTeam(b.rtsTeam)) return '這個陣營不能拆除';
    if (b.rtsInv) return '不能拆除';
    if (b.bld.progress < 1) return '還沒蓋好（用取消）';
    if (b.bld.scrapT) return '拆除中';
    return '';
  },
  rtsScrapBld(b) {
    const why = this.rtsScrapWhy(b);
    if (why) {
      if (b && b.rtsTeam === ME) this.rtsSay(why);
      return false;
    }
    b.bld.scrapT = this.rts.t + S.scrap.t;
    if (b.rtsTeam === ME && this.rtsEvent)
      this.rtsEvent(b.pos.x, b.pos.z, '拆除：' + (RTS_DEFS[b.rtsDef] || {}).name);
    return true;
  },
  // 拆除完成：躲著的工人出來（不受傷）、佇列全額退還（rtsOnDeath 的 rtsQuiet）、留下 50% 的殘骸
  rtsScrapNow(b) {
    const R = this.rts;
    if (b.bld.shel && b.bld.shel.length)
      for (const id of b.bld.shel.slice()) {
        const u = this.rtsEnt(id);
        if (u) this.rtsShelterOut(u, 0);
      }
    this.rtsWreckAdd(b, null, { scrap: true });
    const p = new THREE.Vector3(b.pos.x, b.pos.y + 1, b.pos.z);
    if (this.rtsFxOk(p)) this.fx.dust(p, Math.max(b.bld.w, b.bld.d) * 0.5, 10, 0x8a8070);
    SFX.wreck(p);
    b.rtsQuiet = true;
    b.die(null);
    this.rtsRecount();
  },
  rtsScrapTick() {
    const R = this.rts;
    for (const b of R.units) if (!b.dead && b.bld && b.bld.scrapT && R.t >= b.bld.scrapT) this.rtsScrapNow(b);
  },

  // ================= 地雷（R.lmines；R.mines 是礦脈） =================
  // 放一顆地雷：o＝{ owner（實體）, dmg, arm（秒）, life（秒，沒有＝不會過期）, r, noCap（不算布雷無人機的上限：英雄的布雷區）}
  rtsLandMineAdd(teamId, x, z, o = {}) {
    const R = this.rts;
    if (!R) return null;
    if (!R.lmines) this.rtsSalvageInit();
    const M = S.mine;
    const res = this.rtsResLv(teamId, 'r_mines');
    const owner = o.owner || null;
    // 每台布雷無人機最多 6 顆（研究 9），超過時最舊的消失；一隊最多 40 顆
    if (owner && !o.noCap) {
      const per = res ? M.perRes : M.per;
      const mine = R.lmines.filter((m) => m.owner === owner.id && !m.free);
      while (mine.length >= per) this.rtsLandMineRemove(mine.shift(), 'del');
    }
    const team = R.lmines.filter((m) => m.team === teamId);
    while (team.length >= M.teamMax) this.rtsLandMineRemove(team.shift(), 'del');
    const m = {
      id: 'lm' + R.lmineN++,
      team: teamId,
      x,
      z,
      y: this.world.terrainHeight(x, z),
      owner: owner ? owner.id : null,
      free: !!o.noCap,
      dmg: o.dmg !== undefined ? o.dmg : res ? M.dmgRes : M.dmg,
      r: o.r || M.r,
      armT: R.t + (o.arm !== undefined ? o.arm : res ? M.armRes : M.arm),
      t0: R.t,
      end: o.life ? R.t + o.life : Infinity,
      vis: 1 << teamId,
      seen: 1 << teamId,
      fx: null,
    };
    R.lmines.push(m);
    if (this.rtsSancMineFx) this.rtsSancMineFx(m, 'add');
    return m;
  },
  rtsLandMineRemove(m, kind = 'del') {
    const R = this.rts;
    const i = R.lmines.indexOf(m);
    if (i < 0) return;
    R.lmines.splice(i, 1);
    m.dead = true;
    if (this.rtsSancMineFx) this.rtsSancMineFx(m, kind);
  },
  // 自己的地雷（電腦 AI 只能看自己的）
  rtsLandMinesOf(teamId) {
    const R = this.rts;
    return R && R.lmines ? R.lmines.filter((m) => m.team === teamId) : [];
  },
  // 這一隊目前看得到的敵方地雷
  rtsLandMinesSeen(teamId) {
    const R = this.rts;
    const bit = 1 << teamId;
    return R && R.lmines ? R.lmines.filter((m) => m.team !== teamId && m.vis & bit) : [];
  },
  // 每格：啟動後敵方的地面或低空單位 2 m 內引爆（空中單位不觸發）；過期
  rtsLandMineTick() {
    const R = this.rts;
    if (!R.lmines.length) return;
    const M = S.mine;
    for (let i = R.lmines.length - 1; i >= 0; i--) {
      const m = R.lmines[i];
      if (!m) continue;
      if (R.t >= m.end) {
        this.rtsLandMineRemove(m, 'del');
        continue;
      }
      if (R.t < m.armT) continue;
      let hit = false;
      for (const u of this.rtsNear(m.x, m.z, M.trig + 3)) {
        if (!u || u.dead || u.bld || u.rtsTeam === m.team || u.rtsAboard || u.rtsInv) continue;
        if (u.flying && !(this.rtsLowAir && this.rtsLowAir(u))) continue;
        if (u.pos.y - m.y > M.lowY + (this.rtsLowAir && this.rtsLowAir(u) ? 3 : 0)) continue;
        if (hyp(u.pos.x - m.x, u.pos.z - m.z) - (u.radius || 1) * 0.5 <= M.trig) {
          hit = true;
          break;
        }
      }
      if (hit) this.rtsLandMineBoom(m);
    }
  },
  rtsLandMineBoom(m) {
    const owner = m.owner !== null ? this.rtsEnt(m.owner) : null;
    this.rtsSplash(m.x, m.z, m.r, m.dmg, S.mine.imp, owner && !owner.dead ? owner : null, 'exp', m.team);
    const p = new THREE.Vector3(m.x, m.y + 0.5, m.z);
    if (this.rtsFxOk(p) && !this.rtsSancMineFx) this.fx.explosion(p, m.r, 0xffa040, true);
    SFX.explode(false, p);
    this.rtsLandMineRemove(m, 'boom');
  },
  // 迷霧（rts-fog.js 的 rtsFogUpdate 每 0.2 秒）：敵方 6 m 內有單位、或被照明／揭露時看得到
  rtsLandMineFog(F) {
    const R = this.rts;
    if (!R || !R.lmines || !R.lmines.length) return;
    const see = S.mine.see;
    for (const m of R.lmines) {
      const prev = m.vis;
      let vis = 1 << m.team;
      for (const T of F.teams) {
        if (T.id === m.team || (R.teams[T.id] && R.teams[T.id].neutral)) continue;
        let ok = T.cheat;
        if (!ok)
          for (const u of this.rtsNear(m.x, m.z, see + 3))
            if (!u.dead && u.rtsTeam === T.id && !u.rtsAboard && hyp(u.pos.x - m.x, u.pos.z - m.z) <= see) {
              ok = true;
              break;
            }
        if (!ok)
          for (const rv of F.reveals) if (rv.team === T.id && hyp(rv.x - m.x, rv.z - m.z) <= rv.r) ok = true;
        if (ok) vis |= 1 << T.id;
      }
      m.vis = vis;
      m.seen |= vis;
      if ((prev ^ vis) & (1 << F.me) && this.rtsSancMineFx) this.rtsSancMineFx(m, 'seen');
    }
  },

  // ================= 潛航的迷霧 =================
  // e.rtsSub（B 包：潛航中）的實體：T 的實體在 6 m 內、或照明／揭露蓋到時才看得到
  rtsSubSeen(F, T, e) {
    const see = S.sub.see;
    for (const u of this.rtsNear(e.pos.x, e.pos.z, see + 4))
      if (
        !u.dead &&
        u.rtsTeam === T.id &&
        !u.rtsAboard &&
        hyp(u.pos.x - e.pos.x, u.pos.z - e.pos.z) <= see + (u.radius || 0)
      )
        return true;
    for (const rv of F.reveals)
      if (rv.team === T.id && hyp(rv.x - e.pos.x, rv.z - e.pos.z) <= rv.r) return true;
    return false;
  },

  // ================= 診療所、互助網（每 0.5 秒） =================
  rtsSalvageAuraTick() {
    const R = this.rts;
    for (const T of R.teams) {
      if (!T || T.neutral || !this.rtsSalvageTeam(T.id)) continue;
      const clinics = [];
      const mine = [];
      for (const e of R.units) {
        if (e.dead || e.rtsTeam !== T.id || e.rtsAboard) continue;
        if (e.bld) {
          if ((RTS_DEFS[e.rtsDef] || {}).clinic && e.bld.progress >= 1) clinics.push(e);
        } else mine.push(e);
      }
      const regen = this.rtsResLv(T.id, 'r_mend') ? S.clinic.regenRes : S.clinic.regen;
      const mutual = this.rtsResLv(T.id, 'r_mutual') > 0;
      for (const e of mine) {
        if (clinics.length) {
          for (const c of clinics)
            if (edgeDist(c, e.pos.x, e.pos.z) <= S.clinic.r) {
              this.rtsBuff(e, { src: 'clinic', regen }, S.auraDt + 0.1);
              break;
            }
        }
        if (mutual && !e.hero && !e.rtsIllus) {
          let n = 0;
          for (const u of this.rtsNear(e.pos.x, e.pos.z, S.mutual.r + 2))
            if (
              u !== e &&
              !u.dead &&
              !u.bld &&
              u.rtsTeam === T.id &&
              !u.rtsAboard &&
              hyp(u.pos.x - e.pos.x, u.pos.z - e.pos.z) <= S.mutual.r
            )
              n++;
          if (n >= S.mutual.n)
            this.rtsBuff(e, { src: 'mutual', armor: S.mutual.armor, dmg: S.mutual.dmg }, S.auraDt + 0.1);
        }
      }
    }
  },

  // ================= 每格與死亡（rts.js 呼叫） =================
  rtsSalvageTick(dt) {
    const R = this.rts;
    if (!R || !R.wrecks) return;
    if (!R.salvage && !R.lmines.length) return;
    this.rtsWreckTick(dt);
    this.rtsLandMineTick(dt);
    this.rtsShelterTick(dt);
    this.rtsRefitTick(dt);
    this.rtsScrapTick(dt);
    R.sancT -= dt;
    if (R.sancT <= 0) {
      R.sancT = S.auraDt;
      this.rtsSalvageAuraTick();
    }
  },
  // rtsOnDeath（rtsVeerOnDeath 之後）：自爆裝藥、避難的工人彈出、撿零件的掛勾、殘骸
  rtsSalvageOnDeath(e, from) {
    const R = this.rts;
    if (!R || !R.wrecks) return;
    if (e.rtsRefit === 'rf_bomb' && !e.rtsQuiet) this.rtsRefitBomb(e);
    if (e.bld && e.bld.shel && e.bld.shel.length)
      for (const id of e.bld.shel.slice()) {
        const u = this.rtsEnt(id);
        if (u) this.rtsShelterOut(u, e.rtsQuiet ? 0 : S.shelter.eject);
      }
    if (!R.salvage) return;
    if (!e.bld && !e.rtsQuiet && !e.rtsIllus)
      for (const u of this.rtsNear(e.pos.x, e.pos.z, S.scav.r + 2).slice())
        if (
          u !== e &&
          !u.dead &&
          !u.bld &&
          u.rtsSancNearDeath &&
          hyp(u.pos.x - e.pos.x, u.pos.z - e.pos.z) <= S.scav.r
        )
          u.rtsSancNearDeath(e);
    this.rtsWreckAdd(e, from);
  },
});
