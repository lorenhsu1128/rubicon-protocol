// Coral 戰爭（RTS）R4 維爾威的陣營機制（mixin，docs/rts-design.md 15.2；A 包）：
// - 空投建造（rtsDrop*）：沒有建造工人；rtsDropOrder 扣款、佔一台運輸機 → 下一格從最近的己方調度中心／機庫起飛一台
//   空投運輸機實體（v_carrier，rtsDropTick 直接駕駛：不跑單位 AI）→ 到達後下降 2.5 秒（低空：地面武器打得到）→
//   放下地基（rtsSpawnBld progress 0、selfBuild 自己展開）→ 飛回起飛點後安靜移除。放下之前被擊落退 50%、
//   起飛後取消退 75%（起飛前全額）。同時空投數＝T1 2／T2 3／T3 4（研究增派運輸機 +1），飛回中的也算。
// - 投放艙（rtsPod*、rtsDropPoint）：定義 dropIn 的單位生產完成時（rts.js 的 rtsTrained 轉來）不從門口出來，
//   改成 4 秒（研究強襲投放艙 2.5 秒、軌道投放 +2 秒）後落在投放點：集結點在信標內＝集結點、有軌道通訊站＝任何探索過
//   且離記得的敵方建築 20 m 以上的集結點、否則建築正面。投放艙只是特效（R.pods），落地時才生成單位；人口照算。
// - 投放信標（rtsBeacon*）：v_beacon（14 m）、展開好的調度中心（20 m）、臨時信標（rtsBeaconAddTemp，沒有實體）。
// - 機動建築（rtsPack*）：定義 pack 的建築收起（bld.packed 1）→ 收好（2：從 world.obstacles 與 nav.block 拿掉、flying、
//   低空、視野 ×0.6、生產與研究暫停、人口照給）→ 飛到展開點 → 落地、先登記碰撞與導航格並推開單位 → 展開（3：受到的
//   傷害 ×1.25）→ 恢復（0）。只剩收起的建築 90 秒後每 10 秒對其他隊伍揭露位置。
// - 集貨站（rtsHaul*）：交到集貨站的礦石進庫存（上限 300／研究 500），每 15 秒（研究 8 秒）運到調度中心入帳（3 秒後，
//   套維持費）；被拆或收起時庫存損失。
// - 物流交易（rtsTrade）：調度中心；買 Coral 100 → 30（T2 起 35）、賣 Coral 30 → 60 礦石（套維持費）；共用冷卻 15 秒。
// - 運輸機的載運（rtsBoard／rtsDisembark）：登機的單位從場景、空間索引、敵對名單、選取中拿掉（實體保留，位置跟著運輸機），
//   卸載時放回；運輸機被擊落時乘員在墜毀點彈出、各受最大血量 50% 的傷害。單位的指令 'board'、運輸機的指令 'unload'
//   由 mech-rts.js 的指令分派轉到 rtsBoardStep／rtsUnloadStep。
// - 低空（rtsLowAir）：定義 lowAir（衝撞無人機）、e.rtsLow（下降中的空投運輸機與卸載中的運輸機、B 的長程推進）、
//   收好在飛的建築；地面與對空的武器都打得到、範圍傷害也算。
// - 緊急補給（rtsVeerSupply）：調度中心的技能 ab_supply（rts-grid.js 的 rtsBldAbility 轉來）。
// 各包的掛勾（沒有時略過）：b.model.setPack(p)、b.model.setStock(k)、b.rtsVeerPackMove(dt)、ship.rtsVeerCarrierMove、
// this.rtsVeerPodFx(pod, 'fall'｜'land')、this.rtsVeerHaulFx(yard, hq, 秒)、this.rtsHudDrop(teamId)。
import { SFX } from '../audio/audio.js';
import { RTS_VEER } from '../data/rts-veerwell.js';
import { RTS_ABILS, RTS_DEFS, RTS_FACTIONS } from '../data/rts-units.js';
import { propShape } from '../world/prop-hit.js';
import { Game } from './game.js';

const ME = 0;
const V = RTS_VEER;
const hyp = Math.hypot;
const DIRS = 16;
const qYaw = (yaw) => Math.round((yaw || 0) / (Math.PI / 2)) & 3;
const footOf = (D, q) => (q & 1 ? [D.foot[1], D.foot[0]] : [D.foot[0], D.foot[1]]);

Object.assign(Game.prototype, {
  // ================= 共用 =================
  // 這一隊用空投（陣營的 airdrop）
  rtsVeerTeam(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return !!(T && RTS_FACTIONS[T.faction] && RTS_FACTIONS[T.faction].airdrop);
  },
  // 低空（docs 15.2）：地面與對空的武器都打得到、範圍傷害也算；移動照空中單位
  rtsLowAir(e) {
    if (!e || e.dead) return false;
    if (e.rtsLow) return true;
    if (e.bld) return e.bld.packed === 2;
    const D = RTS_DEFS[e.rtsDef];
    return !!(D && D.lowAir);
  },
  // 受到的傷害的額外倍率（rts.js 的 rtsDmgK）：展開中的建築 ×1.25、研究熱焰彈後維爾威的空中單位受到的穿甲 −20%
  rtsVeerTakenK(atk, t) {
    if (t.bld) {
      const B = t.bld;
      if (B.packed === 3 || (B.progress < 1 && this.rtsVeerTeam(t.rtsTeam))) return V.unpackTaken;
      return 1;
    }
    if (atk === 'pierce' && t.flying && this.rtsResLv(t.rtsTeam, 'r_flare')) {
      const D = RTS_DEFS[t.rtsDef];
      if (D && D.faction === 'veerwell') return 0.8;
    }
    return 1;
  },
  // 建築的佔地（依 yaw）
  rtsVeerFoot(defId, yaw) {
    return footOf(RTS_DEFS[defId], qYaw(yaw));
  },
  // 記得的敵方建築（不含中立、還沒確認消失的）離 (x, z) 的佔地邊緣距離最小值
  rtsKnownDist(teamId, x, z, half = 0) {
    let best = 1e9;
    for (const r of this.rtsFogKnown ? this.rtsFogKnown(teamId) : []) {
      if (r.gone) continue;
      const D = RTS_DEFS[r.def];
      const h = D && D.foot ? Math.max(D.foot[0], D.foot[1]) / 2 : 3;
      best = Math.min(best, hyp(r.x - x, r.z - z) - h - half);
    }
    return best;
  },
  // 投放（空投、搬家的展開）的地點限制 1～3＋湧出點（docs 15.2）：''＝可以；out.x／out.z＝實際的位置（湧出點吸附）
  rtsDropSiteWhy(teamId, defId, x, z, yaw = 0, out = null) {
    const R = this.rts,
      D = RTS_DEFS[defId],
      nav = this.world.nav;
    if (!R || !D || D.kind !== 'bld') return '不是建築';
    const [fw, fd] = footOf(D, qYaw(yaw));
    if (this.rtsFogState) {
      for (const [u, v] of [
        [0, 0],
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ])
        if (this.rtsFogState(teamId, x + (u * fw) / 2, z + (v * fd) / 2) < 1) return '要投放在探索過的地方';
    }
    if (D.on === 'coral') {
      const vent = R.corals.find((c) => hyp(c.pos.x - x, c.pos.z - z) < 6);
      if (!vent) return '要蓋在 Coral 湧出點上';
      if (vent.ext && !vent.ext.dead) return '這個湧出點已經有抽取站';
      x = vent.pos.x;
      z = vent.pos.z;
    } else if (!nav.buildable(x, z, fw, fd)) return '這裡不能蓋';
    const half = Math.max(fw, fd) / 2;
    if (this.rtsKnownDist(teamId, x, z, half) < V.noDropR) return '離敵方建築太近';
    // 看得到的敵方防禦塔：射程＋6
    for (const e of this.rtsFogEnemies ? this.rtsFogEnemies(teamId) : []) {
      if (!e.bld || e.dead) continue;
      const TD = RTS_DEFS[e.rtsDef];
      if (!TD || !TD.range) continue;
      const d = hyp(e.pos.x - x, e.pos.z - z) - Math.max(e.bld.w, e.bld.d) / 2 - half;
      if (d < TD.range + V.towerPad) return '離敵方建築太近';
    }
    if (out) {
      out.x = x;
      out.z = z;
    }
    return '';
  },

  // ================= 空投建造 =================
  // 同時空投數：{ n 使用中（含飛回中的）, max }
  rtsDropLift(teamId) {
    const R = this.rts;
    if (!R) return { n: 0, max: 0 };
    const tier = this.rtsTier(teamId);
    const max =
      V.lift[Math.max(0, Math.min(V.lift.length - 1, tier - 1))] +
      (this.rtsResLv(teamId, 'r_lift') ? V.liftRes : 0);
    let n = 0;
    for (const d of R.drops) if (d.team === teamId) n++;
    return { n, max };
  },
  // 空投運輸機的起飛點：最近的、展開好的己方調度中心或機庫
  rtsDropOrigin(teamId, x, z) {
    let best = null,
      bd = 1e18;
    for (const e of this.rts.units) {
      if (e.dead || !e.bld || e.rtsTeam !== teamId || e.bld.progress < 1 || e.bld.packed) continue;
      const D = RTS_DEFS[e.rtsDef];
      if (!D || !(D.heroes || e.rtsDef === 'v_hangar')) continue;
      const d = hyp(e.pos.x - x, e.pos.z - z);
      if (d < bd) ((bd = d), (best = e));
    }
    return best;
  },
  // 不能空投的原因（''＝可以；建造預覽與電腦都用）
  rtsDropWhy(teamId, defId, x, z, yaw = 0) {
    const R = this.rts,
      D = RTS_DEFS[defId];
    const T = R && R.teams[teamId];
    if (!T || !D || D.kind !== 'bld') return '不是建築';
    if (D.faction && D.faction !== T.faction) return '不是這個陣營的建築';
    if (!this.rtsVeerTeam(teamId)) return '這個陣營不用空投';
    const why = this.rtsReqWhy(teamId, D);
    if (why) return why;
    if (D.beacon) {
      let n = 0;
      for (const e of R.units) if (!e.dead && e.rtsTeam === teamId && e.rtsDef === defId) n++;
      for (const d of R.drops) if (d.team === teamId && d.def === defId && d.st !== 'back') n++;
      if (n >= V.beacon.max) return `投放信標最多 ${V.beacon.max} 座`;
    }
    const site = this.rtsDropSiteWhy(teamId, defId, x, z, yaw);
    if (site) return site;
    const L = this.rtsDropLift(teamId);
    if (L.n >= L.max) return `運輸機都在任務中（${L.n}／${L.max}）`;
    if (!this.rtsDropOrigin(teamId, x, z)) return '沒有可以起飛的調度中心或機庫';
    if ((D.cost.ore || 0) > T.ore + 1e-6) return '礦石不足';
    if ((D.cost.coral || 0) > T.coral + 1e-6) return 'Coral 不足';
    return '';
  },
  // 空投：扣款、佔一台運輸機（下一格起飛）；回傳空投的紀錄或 null。o.via＝航點 { x, z }（電腦繞開防空，F 包）
  rtsDropOrder(teamId, defId, x, z, yaw = 0, o = {}) {
    const R = this.rts;
    if (!R) return null;
    const why = this.rtsDropWhy(teamId, defId, x, z, yaw);
    if (why) {
      if (teamId === ME && !o.quiet) this.rtsSay(why);
      return null;
    }
    const out = {};
    this.rtsDropSiteWhy(teamId, defId, x, z, yaw, out);
    const D = RTS_DEFS[defId];
    if (!this.rtsPay(teamId, D.cost)) return null;
    const rec = {
      id: ++R.dropN,
      team: teamId,
      def: defId,
      x: out.x !== undefined ? out.x : x,
      z: out.z !== undefined ? out.z : z,
      yaw: (qYaw(yaw) * Math.PI) / 2,
      st: 'wait',
      ship: null,
      cost: { ore: D.cost.ore || 0, coral: D.cost.coral || 0 },
      t0: R.t,
      via: o.via || null,
    };
    R.drops.push(rec);
    if (teamId === ME && this.rtsEvent) this.rtsEvent(rec.x, rec.z, '');
    if (this.rtsHudDrop) this.rtsHudDrop(teamId);
    return rec;
  },
  rtsDropOf(id) {
    return (this.rts && this.rts.drops.find((d) => d.id === id)) || null;
  },
  // 取消空投：起飛前全額退還；起飛後（還沒放下）運輸機折返、退 75%
  rtsDropCancel(idOrRec) {
    const R = this.rts;
    const rec = typeof idOrRec === 'object' ? idOrRec : this.rtsDropOf(idOrRec);
    if (!R || !rec || rec.st === 'back') return false;
    if (rec.st === 'wait') {
      this.rtsRefund(rec.team, rec.cost, 1);
      R.drops.splice(R.drops.indexOf(rec), 1);
    } else {
      this.rtsRefund(rec.team, rec.cost, V.ship.cancel);
      this.rtsDropBack(rec);
    }
    if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
    return true;
  },
  rtsDropBack(rec) {
    rec.st = 'back';
    const s = this.rtsEnt(rec.ship);
    if (s) s.rtsLow = false;
  },
  // 除錯用（B、C、E 的測試）：直接放地基（不派運輸機、不扣款、不檢查），地基自己展開
  rtsDropNow(teamId, defId, x, z, yaw = 0) {
    const R = this.rts,
      D = RTS_DEFS[defId];
    if (!R || !D || D.kind !== 'bld') return null;
    if (D.on === 'coral') {
      const v = R.corals.find((c) => hyp(c.pos.x - x, c.pos.z - z) < 6);
      if (v) ((x = v.pos.x), (z = v.pos.z));
    }
    const b = this.rtsSpawnBld(teamId, defId, x, z, yaw, 0);
    this.rtsPushOut(b);
    return b;
  },
  // 建築落地：佔地上的地面單位推到最近可以走的格子
  rtsPushOut(b) {
    const R = this.rts,
      nav = this.world.nav;
    if (!b || !b.bld) return;
    const hw = b.bld.w / 2,
      hd = b.bld.d / 2;
    for (const e of this.rtsNear(b.pos.x, b.pos.z, Math.max(hw, hd) + 4).slice()) {
      if (!e || e.dead || e.bld || e.flying || e.rtsAboard) continue;
      const r = e.radius || 1;
      if (Math.abs(e.pos.x - b.pos.x) > hw + r || Math.abs(e.pos.z - b.pos.z) > hd + r) continue;
      const D = RTS_DEFS[e.rtsDef] || {};
      const c = nav.nearestCell(e.pos.x, e.pos.z, D.size || 0, -1, 12);
      if (c < 0) continue;
      const p = nav.center(c);
      e.pos.x = p.x;
      e.pos.z = p.z;
      e.pos.y = this.world.groundAt(p.x, p.z, this.world.terrainHeight(p.x, p.z) + 2);
      e.mesh.position.copy(e.pos);
      if (e.rt) e.rt.nav = null;
      R.hash.update(e, e.pos.x, e.pos.z);
    }
  },
  // 空投運輸機的飛行（B 包的 ship.rtsVeerCarrierMove 優先）：直線、依前方的地形與建築爬升；回傳 true＝到達
  rtsDropFly(ship, x, z, alt, dt) {
    if (ship.rtsVeerCarrierMove) return ship.rtsVeerCarrierMove(dt, x, z, alt);
    const w = this.world;
    const dx = x - ship.pos.x,
      dz = z - ship.pos.z;
    const d = hyp(dx, dz);
    const ux = d > 1e-3 ? dx / d : 0,
      uz = d > 1e-3 ? dz / d : 0;
    let want = w.terrainHeight(ship.pos.x, ship.pos.z) + alt;
    for (const s of [0, 4, 8, 14]) {
      const L = w.groundAt(ship.pos.x + ux * s, ship.pos.z + uz * s, 1e4);
      if (L + 3 > want) want = L + 3;
    }
    ship.hoverH = Math.max(2, want - w.groundRef(ship.pos.x, ship.pos.z, ship.pos.y));
    const k = d < 1.2 ? 0 : Math.min(1, 0.25 + d / 12);
    const wish = ship.rt.wish.set(ux * k, 0, uz * k);
    if (d > 2) ship.setAim(ship.rt.faceV.set(x, ship.pos.y, z));
    ship.move(dt, wish, false, false, false, null);
    return d < 1.5;
  },
  // 每格：空投的狀態機（rts.js 的 rtsSim → rtsVeerTick）
  rtsDropTick(dt) {
    const R = this.rts;
    for (let i = R.drops.length - 1; i >= 0; i--) {
      const rec = R.drops[i];
      if (rec.st === 'wait') {
        const o = this.rtsDropOrigin(rec.team, rec.x, rec.z);
        if (!o) {
          // 起飛點在下單的同一格被拆了：全額退還
          this.rtsRefund(rec.team, rec.cost, 1);
          R.drops.splice(i, 1);
          if (rec.team === ME) this.rtsSay('空投取消：沒有可以起飛的調度中心或機庫');
          continue;
        }
        const ship = this.rtsSpawn(
          rec.team,
          'v_carrier',
          o.pos.x,
          o.pos.z,
          Math.atan2(-(rec.x - o.pos.x), -(rec.z - o.pos.z)),
        );
        if (!ship) continue;
        R.stats[rec.team].made--; // 不是生產的單位
        ship.rtsDriven = true; // rts.js 的 rtsSim 不跑它的單位 AI（這裡駕駛）
        ship.rtsDrop = rec.id;
        ship.hoverH = V.ship.alt;
        if (ship.rtsAbInit) ship.rtsAbInit(RTS_DEFS.v_carrier); // B 包的 rtsVeerInit（吊掛的貨櫃）在這裡呼叫
        rec.ship = ship.id;
        rec.ox = o.pos.x;
        rec.oz = o.pos.z;
        rec.st = 'fly';
        rec.tf = R.t;
        if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
        continue;
      }
      const ship = this.rtsEnt(rec.ship);
      if (!ship || ship.dead) {
        R.drops.splice(i, 1);
        continue;
      }
      if (rec.st === 'fly') {
        // 航點（電腦繞開防空）
        if (rec.via && !rec.viaOk) {
          if (this.rtsDropFly(ship, rec.via.x, rec.via.z, V.ship.alt, dt)) rec.viaOk = true;
          continue;
        }
        if (this.rtsDropFly(ship, rec.x, rec.z, V.ship.alt, dt)) {
          rec.st = 'land';
          rec.tl = R.t;
          ship.rtsLow = true;
          if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
        }
      } else if (rec.st === 'land') {
        const k = Math.min(1, (R.t - rec.tl) / V.ship.land);
        const alt = V.ship.alt + (V.ship.landAlt - V.ship.alt) * k;
        this.rtsDropFly(ship, rec.x, rec.z, alt, dt);
        if (!ship.rtsVeerCarrierMove) ship.hoverH = alt;
        if (k >= 1) {
          const b = this.rtsDropPlace(rec);
          ship.rtsLow = false;
          if (b) {
            R.stats[rec.team].drops++;
            rec.bld = b.id;
            if (ship.rtsVeerCargoDrop) ship.rtsVeerCargoDrop(b); // B 包：吊掛的貨櫃離開
            rec.st = 'back';
          } else {
            this.rtsRefund(rec.team, rec.cost, V.ship.cancel);
            if (rec.team === ME) this.rtsSay('空投失敗：地點被擋住了（退還 75%）');
            rec.st = 'back';
          }
          if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
        }
      } else if (rec.st === 'back') {
        if (this.rtsDropFly(ship, rec.ox, rec.oz, V.ship.alt, dt)) {
          R.drops.splice(i, 1);
          ship.rtsDrop = null;
          ship.rtsQuiet = true;
          ship.die(null);
          if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
        }
      }
    }
  },
  // 放下地基：地點被擋住時在 12 m 內找最近的可蓋點（找不到回傳 null）
  rtsDropPlace(rec) {
    const R = this.rts,
      D = RTS_DEFS[rec.def],
      nav = this.world.nav;
    let x = rec.x,
      z = rec.z;
    if (D.on === 'coral') {
      const v = R.corals.find((c) => hyp(c.pos.x - x, c.pos.z - z) < 6);
      if (!v || (v.ext && !v.ext.dead)) return null;
    } else {
      const [fw, fd] = footOf(D, qYaw(rec.yaw));
      const p = this.rtsVeerFindSpot(x, z, fw, fd, V.findR);
      if (!p) return null;
      x = p.x;
      z = p.z;
    }
    const b = this.rtsSpawnBld(rec.team, rec.def, x, z, rec.yaw, 0);
    this.rtsPushOut(b);
    if (rec.team === ME && this.rtsEvent) this.rtsEvent(x, z, '空投：' + D.name);
    SFX.play('door', 0.5, 0.8, 0.05, 0.03, b.center());
    void nav;
    return b;
  },
  // (x, z) 起 maxR 內最近的可蓋點（佔地 fw×fd）
  rtsVeerFindSpot(x, z, fw, fd, maxR) {
    const nav = this.world.nav;
    if (nav.buildable(x, z, fw, fd)) return { x, z };
    for (let r = 2; r <= maxR; r += 2)
      for (let a = 0; a < DIRS; a++) {
        const px = x + Math.cos((a / DIRS) * Math.PI * 2) * r,
          pz = z + Math.sin((a / DIRS) * Math.PI * 2) * r;
        if (nav.buildable(px, pz, fw, fd)) return { x: px, z: pz };
      }
    return null;
  },

  // ================= 投放艙與信標 =================
  // 一隊的投放範圍：[{ x, z, r, e?（實體）, temp? }]（投放信標、展開好的調度中心、臨時信標）
  rtsBeacons(teamId) {
    const R = this.rts;
    const out = [];
    if (!R) return out;
    for (const e of R.units) {
      if (e.dead || !e.bld || e.rtsTeam !== teamId || e.bld.progress < 1 || e.bld.packed) continue;
      const D = RTS_DEFS[e.rtsDef];
      if (!D) continue;
      if (D.beacon) out.push({ x: e.pos.x, z: e.pos.z, r: D.beacon.r, e });
      else if (D.heroes && D.faction === 'veerwell') out.push({ x: e.pos.x, z: e.pos.z, r: V.beacon.hqR, e });
    }
    const T = R.teams[teamId];
    for (const b of (T && T.bcn) || []) if (b.t > R.t) out.push(b); // 到期的在 rtsVeerTick 每秒清掉
    return out;
  },
  rtsBeaconAt(teamId, x, z) {
    for (const b of this.rtsBeacons(teamId)) if (hyp(b.x - x, b.z - z) <= b.r) return b;
    return null;
  },
  // 臨時信標（沒有實體、不算上限；C 包的強襲空投艙、攜帶式信標，B 包的偵察無人機）；回傳信標物件
  rtsBeaconAddTemp(teamId, x, z, sec, r = V.beacon.r) {
    const R = this.rts;
    const T = R && R.teams[teamId];
    if (!T) return null;
    const b = { x, z, r, t: R.t + sec, temp: true };
    (T.bcn || (T.bcn = [])).push(b);
    return b;
  },
  // 有軌道通訊站（蓋好的）
  rtsHasOrbit(teamId) {
    for (const e of this.rts.units) {
      if (e.dead || !e.bld || e.rtsTeam !== teamId || e.bld.progress < 1) continue;
      const D = RTS_DEFS[e.rtsDef];
      if (D && D.orbit) return true;
    }
    return false;
  },
  // 投放點：{ x, z, via 'beacon'｜'orbit'｜'bld' }
  rtsDropPoint(b) {
    const B = b.bld,
      t = b.rtsTeam;
    const rl = B.rally;
    if (rl) {
      if (this.rtsBeaconAt(t, rl.x, rl.z)) return { x: rl.x, z: rl.z, via: 'beacon' };
      if (
        this.rtsHasOrbit(t) &&
        (!this.rtsFogState || this.rtsFogState(t, rl.x, rl.z) >= 1) &&
        this.rtsKnownDist(t, rl.x, rl.z) >= V.beacon.orbitPad
      )
        return { x: rl.x, z: rl.z, via: 'orbit' };
    }
    // 建築正面（有集結點時朝集結點那一側）
    const a = rl ? Math.atan2(rl.z - b.pos.z, rl.x - b.pos.x) : Math.atan2(Math.cos(b.yaw), Math.sin(b.yaw));
    const r = Math.max(B.w, B.d) / 2 + 6;
    return { x: b.pos.x + Math.cos(a) * r, z: b.pos.z + Math.sin(a) * r, via: 'bld' };
  },
  // 生產完成（rts.js 的 rtsTrained 轉來）：投放艙
  rtsDropUnit(b, id, q) {
    const R = this.rts,
      D = RTS_DEFS[id],
      nav = this.world.nav;
    const P = this.rtsDropPoint(b);
    let { x, z } = P;
    const c = nav.nearestCell(x, z, D.size || 0, -1, Math.ceil(V.pod.r / nav.cell));
    if (c >= 0) ({ x, z } = nav.center(c));
    const delay =
      (this.rtsResLv(b.rtsTeam, 'r_pod') ? V.pod.tRes : V.pod.t) + (P.via === 'orbit' ? V.pod.orbit : 0);
    const pod = {
      id: ++R.podN,
      team: b.rtsTeam,
      def: id,
      x,
      z,
      t: R.t + delay,
      t0: R.t,
      q,
      via: P.via,
      b: b.id,
      rally: b.bld.rally ? { ...b.bld.rally } : null,
      pop: q && q.pop !== undefined ? q.pop : D.pop || 0,
    };
    R.pods.push(pod);
    R.stats[b.rtsTeam].pods++;
    if (this.rtsVeerPodFx) this.rtsVeerPodFx(pod, 'fall');
    else if (pod.team === ME || !this.rtsFogState || this.rtsFogState(ME, x, z) === 2) {
      const y = this.world.terrainHeight(x, z);
      this.fx.warnCircle(new THREE.Vector3(x, y + 0.15, z), 3, delay, pod.team === ME ? 0x7ee081 : 0xff3020);
    }
    return pod;
  },
  // 隊伍看得到的投放艙（自己的全部；別人的＝那一格目前可見；電腦對手用）
  rtsPodsSeen(teamId) {
    const R = this.rts;
    if (!R) return [];
    return R.pods.filter(
      (p) => p.team === teamId || !this.rtsFogState || this.rtsFogState(teamId, p.x, p.z) === 2,
    );
  },
  rtsPodTick() {
    const R = this.rts;
    for (let i = R.pods.length - 1; i >= 0; i--) {
      const p = R.pods[i];
      if (R.t < p.t) continue;
      R.pods.splice(i, 1);
      this.rtsPodLand(p);
    }
  },
  rtsPodLand(p) {
    const R = this.rts,
      D = RTS_DEFS[p.def];
    const b = this.rtsEnt(p.b);
    const yaw = p.rally ? Math.atan2(-(p.rally.x - p.x), -(p.rally.z - p.z)) : 0;
    const u = this.rtsSpawn(p.team, p.def, p.x, p.z, yaw);
    if (!u) return null;
    u.staggerT = Math.max(u.staggerT || 0, V.pod.open); // 0.5 秒展開，不能動
    // 強襲投放艙：落點 4 m 內的敵方地面單位 60 爆發＋暈眩
    if (this.rtsResLv(p.team, 'r_pod')) {
      for (const t of this.rtsNear(p.x, p.z, V.pod.splash + 4).slice()) {
        if (!t || t.dead || t.bld || t.rtsInv || t.rtsTeam === p.team || t.rtsTeam === undefined) continue;
        if (t.flying && !this.rtsLowAir(t)) continue;
        if (hyp(t.pos.x - p.x, t.pos.z - p.z) - (t.radius || 1) > V.pod.splash) continue;
        this.rtsHit(t, V.pod.dmg, 80, u, 'exp');
        if (this.rtsStun) this.rtsStun(t, V.pod.stun);
        else t.staggerT = Math.max(t.staggerT || 0, V.pod.stun);
      }
    }
    if (this.rtsVeerPodFx) this.rtsVeerPodFx(p, 'land');
    else if (this.rtsFxOk(u.pos)) {
      this.fx.explosion(u.center(), 2.2, 0xffc070);
      this.fx.dust(u.pos.clone(), 3, 8);
    }
    if (D.hero && this.rtsHeroSpawned) this.rtsHeroSpawned(u, p.q || { id: p.def });
    this.rtsRallyUnit(b, u, D, p.rally);
    if (p.team === ME && this.rtsEvent) this.rtsEvent(p.x, p.z, '');
    return u;
  },

  // ================= 機動建築 =================
  rtsPackK(teamId) {
    return this.rtsResLv(teamId, 'r_fold') ? 0.5 : 1;
  },
  // 不能收起的原因（''＝可以）
  rtsPackWhy(b) {
    const R = this.rts;
    if (!R || !b || b.dead || !b.bld) return '沒有建築';
    const D = RTS_DEFS[b.rtsDef];
    if (!D || !D.pack) return '這座建築不能收起';
    const B = b.bld;
    if (B.progress < 1) return '建築還沒蓋好';
    if (B.packed === 1 || B.packed === 2) return '已經收起';
    if (B.packed === 3) return '展開中';
    if (B.queue.some((q) => q.upg)) return '升級中，不能收起';
    if (B.unpackT !== undefined && R.t < B.unpackT + V.repack)
      return `展開後 ${Math.ceil(B.unpackT + V.repack - R.t)} 秒才能再收起`;
    return '';
  },
  rtsPack(b) {
    const why = this.rtsPackWhy(b);
    if (why) {
      if (b && b.rtsTeam === ME) this.rtsSay(why);
      return false;
    }
    const R = this.rts,
      B = b.bld,
      D = RTS_DEFS[b.rtsDef];
    B.packed = 1;
    B.packT = 0;
    B.packDur = D.pack.t * this.rtsPackK(b.rtsTeam);
    B.unpackTo = null;
    b.orders = [];
    if (D.haul) this.rtsHaulLose(b); // 集貨站：庫存全部損失
    R.stats[b.rtsTeam].packs++;
    if (b.model.setPack) b.model.setPack(0);
    return true;
  },
  // 不能展開到 (x, z) 的原因
  rtsUnpackWhy(b, x, z, yaw) {
    if (!b || b.dead || !b.bld) return '沒有建築';
    if (b.bld.packed !== 2 && b.bld.packed !== 1) return '還沒收起';
    return this.rtsDropSiteWhy(b.rtsTeam, b.rtsDef, x, z, yaw === undefined ? b.yaw : yaw);
  },
  // 展開：飛到 (x, z) 落地展開
  rtsUnpack(b, x, z, yaw) {
    const why = this.rtsUnpackWhy(b, x, z, yaw);
    if (why) {
      if (b && b.rtsTeam === ME) this.rtsSay(why);
      return false;
    }
    b.bld.unpackTo = { x, z, yaw: yaw === undefined ? b.yaw : yaw };
    b.orders = [];
    return true;
  },
  // 收好：拿掉碰撞與導航格、變成低空的飛行物
  rtsPackRelease(b) {
    const w = this.world,
      B = b.bld;
    if (b.rtsOb) {
      const i = w.obstacles.indexOf(b.rtsOb);
      if (i >= 0) w.obstacles.splice(i, 1);
      w.nav.block(b.pos.x, b.pos.z, B.w, B.d, 0, false);
      b.rtsOb = null;
    }
    b.shape = null;
    b.flying = true;
    b.hoverH = V.packAlt;
    B.packed = 2;
    const sight = (b.rtsBase && b.rtsBase.sight) || 0;
    this.rtsBuff(b, { src: 'pack', sight: -sight * (1 - V.packSight) }, 1e7);
    if (b.model.setPack) b.model.setPack(1);
  },
  // 落地：登記碰撞與導航格、推開單位、開始展開（地點被擋住時 12 m 內找；找不到＝不落地）
  rtsPackLand(b) {
    const w = this.world,
      B = b.bld,
      D = RTS_DEFS[b.rtsDef];
    const to = B.unpackTo;
    const q = qYaw(to.yaw);
    const [fw, fd] = footOf(D, q);
    const p = this.rtsVeerFindSpot(to.x, to.z, fw, fd, V.findR);
    B.unpackTo = null;
    if (!p) {
      if (b.rtsTeam === ME) this.rtsSay('展開的地點被擋住了');
      return false;
    }
    const th = (a, c) => w.terrainHeight(a, c);
    const gy = Math.min(
      th(p.x, p.z),
      th(p.x - fw / 2, p.z - fd / 2),
      th(p.x + fw / 2, p.z - fd / 2),
      th(p.x - fw / 2, p.z + fd / 2),
      th(p.x + fw / 2, p.z + fd / 2),
    );
    b.yaw = b.aimYaw = (q * Math.PI) / 2;
    b.pos.set(p.x, gy, p.z);
    b.vel.set(0, 0, 0);
    b.mesh.position.copy(b.pos);
    b.mesh.rotation.y = b.yaw;
    B.w = fw;
    B.d = fd;
    const ob = { kind: 'box', x: p.x, z: p.z, w: fw, d: fd, y: gy - 0.5, top: gy + D.height, rtsBld: b };
    w.obstacles.push(ob);
    b.rtsOb = ob;
    b.shape = propShape(w, ob);
    w.nav.block(p.x, p.z, fw, fd, 0, true);
    b.flying = false;
    this.rts.hash.update(b, p.x, p.z);
    this.rtsPushOut(b);
    if (b.rtsAbUnbuff) b.rtsAbUnbuff('pack');
    B.packed = 3;
    B.packT = 0;
    B.packDur = D.pack.ut * this.rtsPackK(b.rtsTeam);
    if (b.model.setPack) b.model.setPack(1);
    return true;
  },
  // 收好的建築的飛行（B 包的 b.rtsVeerPackMove 優先）：直線、高度＝地面＋5 m
  rtsPackFly(b, dt) {
    const w = this.world,
      B = b.bld,
      D = RTS_DEFS[b.rtsDef];
    const o = b.orders[0];
    const to = B.unpackTo || (o && o.k === 'move' ? o : null);
    const lim = w.lim - 4;
    if (to) {
      const tx = Math.max(-lim, Math.min(lim, to.x)),
        tz = Math.max(-lim, Math.min(lim, to.z));
      const dx = tx - b.pos.x,
        dz = tz - b.pos.z;
      const d = hyp(dx, dz);
      const sp = D.pack.speed * (this.rtsResLv(b.rtsTeam, 'r_fold') ? 1.3 : 1) * dt;
      if (d <= sp) {
        b.pos.x = tx;
        b.pos.z = tz;
        if (!B.unpackTo && o) b.orders.shift();
      } else {
        b.pos.x += (dx / d) * sp;
        b.pos.z += (dz / d) * sp;
      }
    }
    let gy = w.groundAt(b.pos.x, b.pos.z, 1e4) + V.packAlt;
    // 圓柱障礙物（煙囪、天線桿：world.js 的 buildRts 記了 top）：從上方飛過
    const pad = Math.max(B.w || 0, B.d || 0) / 2 + 1;
    for (const ob of w.obstacles)
      if (ob.kind === 'circle' && ob.top !== undefined && ob.top + 2 > gy)
        if (hyp(ob.x - b.pos.x, ob.z - b.pos.z) < ob.r + pad) gy = ob.top + 2;
    b.pos.y += (gy - b.pos.y) * Math.min(1, dt * 2);
    b.mesh.position.copy(b.pos);
  },
  // 每格（rts.js 的 rtsBuildings 對 packed 的建築呼叫）：收起／展開的進度、收好的移動
  rtsPackStep(b, dt) {
    const R = this.rts,
      B = b.bld;
    if (B.packed === 1) {
      B.packT += dt;
      const p = Math.min(1, B.packT / Math.max(0.01, B.packDur));
      if (b.model.setPack) b.model.setPack(p);
      if (p >= 1) this.rtsPackRelease(b);
      return;
    }
    if (B.packed === 2) {
      if (b.rtsVeerPackMove) b.rtsVeerPackMove(dt);
      else this.rtsPackFly(b, dt);
      R.hash.update(b, b.pos.x, b.pos.z);
      const to = B.unpackTo;
      if (to && hyp(to.x - b.pos.x, to.z - b.pos.z) < 0.6) this.rtsPackLand(b);
      return;
    }
    if (B.packed === 3) {
      B.packT += dt;
      const p = Math.max(0, 1 - B.packT / Math.max(0.01, B.packDur));
      if (b.model.setPack) b.model.setPack(p);
      if (p <= 0) {
        B.packed = 0;
        B.unpackT = R.t;
        if (b.rtsTeam === ME && this.rtsEvent)
          this.rtsEvent(b.pos.x, b.pos.z, '展開完成：' + RTS_DEFS[b.rtsDef].name);
      }
    }
  },

  // ================= 集貨站 =================
  rtsHaulCap(teamId) {
    return this.rtsResLv(teamId, 'r_haul') ? V.haul.capRes : V.haul.cap;
  },
  // 工人交貨（mech-rts.js 的 rtsGather）：集貨站＝進庫存（回傳 true）；其他＝false（照舊立刻入帳）
  rtsHaulDeposit(b, carry) {
    if (!b || !b.bld || !carry || !carry.n) return false;
    const D = RTS_DEFS[b.rtsDef];
    if (!D || !D.haul) return false;
    const B = b.bld;
    const cap = this.rtsHaulCap(b.rtsTeam);
    B.stock = Math.min(cap, (B.stock || 0) + carry.n);
    if (b.model.setStock) b.model.setStock(B.stock / cap);
    return true;
  },
  rtsHaulLose(b) {
    if (!b || !b.bld) return;
    b.bld.stock = 0;
    if (b.model && b.model.setStock) b.model.setStock(0);
  },
  // 每格：集貨站的運送計時、物流無人機到達時入帳
  rtsHaulTick(dt) {
    const R = this.rts;
    for (const b of R.units) {
      if (b.dead || !b.bld || b.bld.progress < 1 || b.bld.packed) continue;
      const D = RTS_DEFS[b.rtsDef];
      if (!D || !D.haul) continue;
      const B = b.bld;
      B.haulT = (B.haulT || 0) + dt;
      const per = this.rtsResLv(b.rtsTeam, 'r_haul') ? V.haul.tRes : V.haul.t;
      if (B.haulT < per) continue;
      B.haulT = 0;
      if (!(B.stock > 0)) continue;
      // 最近的、展開好的調度中心（沒有時庫存不運走）
      let hq = null,
        bd = 1e18;
      for (const e of R.units) {
        if (e.dead || !e.bld || e.rtsTeam !== b.rtsTeam || e.bld.progress < 1 || e.bld.packed) continue;
        const HD = RTS_DEFS[e.rtsDef];
        if (!HD || !HD.heroes || !HD.dropoff) continue;
        const d = hyp(e.pos.x - b.pos.x, e.pos.z - b.pos.z);
        if (d < bd) ((bd = d), (hq = e));
      }
      if (!hq) continue;
      R.hauls.push({ team: b.rtsTeam, n: B.stock, t: R.t + V.haul.fly, from: b.id, to: hq.id });
      if (this.rtsVeerHaulFx) this.rtsVeerHaulFx(b, hq, V.haul.fly);
      B.stock = 0;
      if (b.model.setStock) b.model.setStock(0);
    }
    for (let i = R.hauls.length - 1; i >= 0; i--) {
      const h = R.hauls[i];
      if (R.t < h.t) continue;
      R.hauls.splice(i, 1);
      this.rtsDeposit(h.team, 'ore', h.n);
    }
  },
  // 集貨站的資訊（HUD）：{ stock, cap, next（下一次運走的倒數秒） }
  rtsHaulInfo(b) {
    if (!b || !b.bld) return null;
    const per = this.rtsResLv(b.rtsTeam, 'r_haul') ? V.haul.tRes : V.haul.t;
    return {
      stock: b.bld.stock || 0,
      cap: this.rtsHaulCap(b.rtsTeam),
      next: Math.max(0, per - (b.bld.haulT || 0)),
    };
  },

  // ================= 物流交易 =================
  rtsTradeHq(teamId) {
    for (const e of this.rts.units) {
      if (e.dead || !e.bld || e.rtsTeam !== teamId || e.bld.progress < 1 || e.bld.packed) continue;
      const D = RTS_DEFS[e.rtsDef];
      if (D && D.tradeHq) return e;
    }
    return null;
  },
  rtsTradeRate(teamId, dir) {
    if (dir === 'sell') return V.trade.sell;
    return this.rtsTier(teamId) >= 2 ? V.trade.buy2 : V.trade.buy;
  },
  rtsTradeWhy(teamId, dir) {
    const R = this.rts;
    const T = R && R.teams[teamId];
    if (!T) return '沒有隊伍';
    if (!this.rtsTradeHq(teamId)) return '需要展開好的調度中心';
    if (T.tradeT > R.t) return `冷卻中（${Math.ceil(T.tradeT - R.t)} 秒）`;
    const [give] = this.rtsTradeRate(teamId, dir);
    if (dir === 'sell') {
      if (T.coral < give - 1e-6) return 'Coral 不足';
    } else if (T.ore < give - 1e-6) return '礦石不足';
    return '';
  },
  // dir 'buy'（礦石 → Coral）｜'sell'（Coral → 礦石，套維持費）
  rtsTrade(teamId, dir) {
    const R = this.rts;
    const why = this.rtsTradeWhy(teamId, dir);
    if (why) {
      if (teamId === ME) this.rtsSay('物流交易：' + why);
      return false;
    }
    const T = R.teams[teamId];
    const [give, get] = this.rtsTradeRate(teamId, dir);
    let got = get;
    if (dir === 'sell') {
      T.coral -= give;
      got = this.rtsDeposit(teamId, 'ore', get);
    } else {
      T.ore -= give;
      T.coral += get;
    }
    T.tradeT = R.t + V.trade.cd;
    R.stats[teamId].trades++;
    if (teamId === ME)
      this.rtsSay(
        dir === 'sell'
          ? `物流交易：Coral ${give} → 礦石 ${Math.round(got)}`
          : `物流交易：礦石 ${give} → Coral ${get}`,
        0x9be070,
      );
    return true;
  },

  // ================= 運輸機的載運 =================
  rtsCargoPop(e) {
    if (e.hero) return 5;
    const D = RTS_DEFS[e.rtsDef] || {};
    return D.worker ? 1 : D.pop || 0;
  },
  rtsCargoMax(ship) {
    return ship.rtsCargoMax || (RTS_DEFS[ship.rtsDef] || {}).cargo || V.cargo;
  },
  rtsCargoUsed(ship) {
    let n = 0;
    for (const id of ship.cargo || []) {
      const e = this.rtsEnt(id);
      if (e && !e.dead) n += this.rtsCargoPop(e);
    }
    return n;
  },
  // 乘員（實體陣列；HUD）
  rtsCargoOf(ship) {
    return (ship && ship.cargo ? ship.cargo : []).map((id) => this.rtsEnt(id)).filter((e) => e && !e.dead);
  },
  rtsBoardWhy(e, ship) {
    if (!e || e.dead || !ship || ship.dead) return '沒有運輸機';
    if (e.rtsTeam !== ship.rtsTeam) return '不是己方的運輸機';
    if (!((RTS_DEFS[ship.rtsDef] || {}).cargo || ship.rtsCargoMax)) return '不是運輸機';
    if (e === ship || e.bld || e.flying || e.rtsAboard) return '不能登機';
    if (e.rtsPiloted) return '親自駕駛中不能登機';
    if (this.rtsCargoUsed(ship) + this.rtsCargoPop(e) > this.rtsCargoMax(ship))
      return `運輸機滿了（${this.rtsCargoUsed(ship)}／${this.rtsCargoMax(ship)}）`;
    return '';
  },
  // 登機（距離不檢查；單位的指令 'board' 走到 4 m 內才呼叫）
  rtsBoard(e, ship) {
    const R = this.rts;
    const why = this.rtsBoardWhy(e, ship);
    if (why) return false;
    if (e.rtsLeaveOrder) e.rtsLeaveOrder(null);
    e.orders = [];
    if (e.rt) {
      e.rt.cur = undefined;
      e.rt.nav = null;
      e.rt.home = null;
      e.rt.engage = null;
    }
    e.rtsAboard = ship.id;
    (ship.cargo || (ship.cargo = [])).push(e.id);
    e.vel.set(0, 0, 0);
    if (e.mesh.parent) e.mesh.parent.remove(e.mesh);
    R.hash.remove(e);
    for (const L of [this.enemies, this.allies, ...R.hostile]) {
      const i = L.indexOf(e);
      if (i >= 0) L.splice(i, 1);
    }
    const si = R.sel.indexOf(e);
    if (si >= 0) R.sel.splice(si, 1);
    if (ship.rtsVeerBoarded) ship.rtsVeerBoarded(e);
    return true;
  },
  // 下機：放在 (x, z) 附近最近可以走的格子（允許和主基地不連通的高台）
  rtsDisembark(e, x, z) {
    const R = this.rts,
      w = this.world;
    if (!e || !e.rtsAboard) return false;
    const ship = this.rtsEnt(e.rtsAboard);
    if (ship && ship.cargo) {
      const i = ship.cargo.indexOf(e.id);
      if (i >= 0) ship.cargo.splice(i, 1);
    }
    e.rtsAboard = null;
    const D = RTS_DEFS[e.rtsDef] || {};
    const c = w.nav.nearestCell(x, z, D.size || 0, -1, 10);
    if (c >= 0) ({ x, z } = w.nav.center(c));
    e.pos.set(x, w.groundAt(x, z, w.terrainHeight(x, z) + 2), z);
    e.vel.set(0, 0, 0);
    e.mesh.position.copy(e.pos);
    this.scene.add(e.mesh);
    R.hash.insert(e, x, z);
    (e.rtsTeam === ME ? this.allies : this.enemies).push(e);
    e.orders = [];
    if (e.rt) {
      e.rt.cur = undefined;
      e.rt.nav = null;
      e.rt.home = null;
    }
    return true;
  },
  // 運輸機被擊落：乘員在墜毀點彈出、各受最大血量 50% 的傷害
  rtsCargoCrash(ship) {
    const list = this.rtsCargoOf(ship);
    let k = 0;
    for (const e of list) {
      const a = (k++ / Math.max(1, list.length)) * Math.PI * 2;
      this.rtsDisembark(e, ship.pos.x + Math.cos(a) * 2, ship.pos.z + Math.sin(a) * 2);
      this.rtsHit(e, e.maxHp * V.cargoCrash, 0, null, 'none');
    }
    ship.cargo = [];
  },
  // 單位的指令 { k: 'board', id: 運輸機 }（mech-rts.js 轉來）：走到 4 m 內登機；回傳 true＝指令結束
  rtsBoardStep(e, o, dt) {
    const ship = this.rtsEnt(o.id);
    if (!ship || ship.dead) return true;
    const why = this.rtsBoardWhy(e, ship);
    if (why) {
      if (e.rtsTeam === ME) this.rtsSay(why);
      return true;
    }
    const d = hyp(ship.pos.x - e.pos.x, ship.pos.z - e.pos.z);
    if (d <= V.boardR) return (this.rtsBoard(e, ship), true);
    e.rtsGo(ship.pos.x, ship.pos.z, V.boardR - 1, dt, null);
    return false;
  },
  // 運輸機的指令 { k: 'unload', x, z }（mech-rts.js 轉來）：飛到那裡、下降 2 秒（低空）、每 0.3 秒放下一台
  rtsUnloadStep(ship, o, dt) {
    const R = this.rts;
    if (!ship.cargo || !ship.cargo.length) return this.rtsUnloadEnd(ship);
    if (!o.st) {
      if (ship.rtsGo(o.x, o.z, 1.5, dt, null)) {
        o.st = 'down';
        o.t0 = R.t;
      }
      return false;
    }
    ship.rtsLow = true;
    ship.rt.flyT = R.t + 0.3; // 不讓 rtsFlyAlt 把高度拉回去
    const D = RTS_DEFS[ship.rtsDef] || {};
    if (o.st === 'down') {
      const k = Math.min(1, (R.t - o.t0) / V.unloadT);
      ship.hoverH = (D.hoverH || 9) + (2.5 - (D.hoverH || 9)) * k;
      if (k >= 1) {
        o.st = 'drop';
        o.nt = R.t;
        o.n = 0;
      }
      return false;
    }
    while (ship.cargo.length && R.t >= o.nt) {
      const e = this.rtsEnt(ship.cargo[0]);
      if (!e || e.dead) {
        ship.cargo.shift();
        continue;
      }
      const a = (o.n++ * 2.4) % (Math.PI * 2);
      const r = o.n > 1 ? 2.5 : 0;
      this.rtsDisembark(e, ship.pos.x + Math.cos(a) * r, ship.pos.z + Math.sin(a) * r);
      o.nt += V.unloadGap;
    }
    if (!ship.cargo.length) return this.rtsUnloadEnd(ship);
    return false;
  },
  rtsUnloadEnd(ship) {
    ship.rtsLow = false;
    if (ship.rt) ship.rt.flyT = 0;
    const D = RTS_DEFS[ship.rtsDef] || {};
    if (D.hoverH) ship.hoverH = D.hoverH;
    return true;
  },

  // ================= 緊急補給（調度中心的 ab_supply） =================
  rtsVeerSupplyWhy(hq, x, z) {
    const R = this.rts;
    if (!R || !hq || hq.dead || !hq.bld) return '沒有調度中心';
    const D = RTS_DEFS[hq.rtsDef];
    if (!D || !(D.abil || []).includes('ab_supply')) return '這座建築不能施放';
    if (hq.bld.progress < 1) return '建築還沒蓋好';
    if (hq.bld.packed) return '收起中不能施放';
    const cd = hq.rtsCd && hq.rtsCd.ab_supply;
    if (cd > R.t) return `冷卻中（${Math.ceil(cd - R.t)} 秒）`;
    if ((R.teams[hq.rtsTeam].coral || 0) < (RTS_ABILS.ab_supply.coral || 0)) return 'Coral 不足';
    if (x === undefined || z === undefined) return '要指定地點';
    if (this.rtsFogState && this.rtsFogState(hq.rtsTeam, x, z) < 1) return '要在探索過的地方';
    let near = false;
    for (const e of R.units) {
      if (e.dead || !e.bld || e.rtsTeam !== hq.rtsTeam) continue;
      if (hyp(e.pos.x - x, e.pos.z - z) - Math.max(e.bld.w, e.bld.d) / 2 <= V.supply.near) {
        near = true;
        break;
      }
    }
    if (!near) return `要在己方建築 ${V.supply.near} m 內`;
    return '';
  },
  rtsVeerSupply(hq, x, z) {
    const R = this.rts;
    const why = this.rtsVeerSupplyWhy(hq, x, z);
    if (why) {
      if (hq && hq.rtsTeam === ME) this.rtsSay('緊急補給：' + why);
      return false;
    }
    const team = hq.rtsTeam;
    R.teams[team].coral -= RTS_ABILS.ab_supply.coral || 0;
    (hq.rtsCd || (hq.rtsCd = {})).ab_supply = R.t + (RTS_ABILS.ab_supply.cd || 0);
    const y = this.world.terrainHeight(x, z);
    if (team === ME || !this.rtsFogState || this.rtsFogState(ME, x, z) === 2)
      this.fx.warnCircle(new THREE.Vector3(x, y + 0.15, z), V.supply.r, V.supply.delay, 0x9be070);
    R.vtasks.push({
      t: R.t + V.supply.delay,
      fn: () => {
        for (const e of this.rtsNear(x, z, V.supply.r + 10).slice()) {
          if (!e || e.dead || e.rtsTeam !== team || e.rtsInv) continue;
          if (e.bld) {
            if (hyp(e.pos.x - x, e.pos.z - z) - Math.max(e.bld.w, e.bld.d) / 2 > V.supply.r) continue;
            e.hp = Math.min(e.maxHp, e.hp + e.maxHp * V.supply.bld);
          } else {
            if (hyp(e.pos.x - x, e.pos.z - z) > V.supply.r) continue;
            this.rtsBuff(e, { src: 'supply', regen: V.supply.regen }, V.supply.t);
          }
        }
        if (this.rtsFxOk({ x, z })) {
          this.fx.explosion(new THREE.Vector3(x, y + 1, z), 2, 0x9be070);
          this.fx.ring(new THREE.Vector3(x, y + 0.2, z), V.supply.r, 0x9be070);
        }
      },
    });
    return true;
  },

  // ================= 每格（rts.js 的 rtsSim） =================
  rtsVeerTick(dt) {
    const R = this.rts;
    if (!R) return;
    this.rtsDropTick(dt);
    this.rtsPodTick(dt);
    this.rtsHaulTick(dt);
    // 運輸機的乘員跟著運輸機；卸載中斷時恢復高度
    for (const e of R.units) {
      if (e.dead || e.bld) continue;
      if (e.cargo && e.cargo.length)
        for (const id of e.cargo) {
          const u = this.rtsEnt(id);
          if (u) u.pos.copy(e.pos);
        }
      if (
        e.rtsLow &&
        !e.rtsDrop &&
        (RTS_DEFS[e.rtsDef] || {}).cargo &&
        !(e.orders[0] && e.orders[0].k === 'unload')
      )
        this.rtsUnloadEnd(e);
    }
    // 延遲事件（緊急補給）
    for (let i = R.vtasks.length - 1; i >= 0; i--)
      if (R.t >= R.vtasks[i].t) {
        const k = R.vtasks.splice(i, 1)[0];
        k.fn();
      }
    // 每秒：臨時信標到期、只剩收起的建築的揭露、空中單位人口的最大值
    R.veerT -= dt;
    if (R.veerT > 0) return;
    R.veerT = 1;
    for (const T of R.teams) {
      if (!T || T.neutral) continue;
      if (T.bcn && T.bcn.length) T.bcn = T.bcn.filter((b) => b.t > R.t);
      let any = 0,
        packed = 0,
        air = 0;
      for (const e of R.units) {
        if (e.dead || e.rtsTeam !== T.id) continue;
        if (e.bld) {
          any++;
          if (e.bld.packed) packed++;
        } else if (e.flying || this.rtsLowAir(e)) air += (RTS_DEFS[e.rtsDef] || {}).pop || 0;
      }
      R.stats[T.id].airMax = Math.max(R.stats[T.id].airMax || 0, air);
      if (any && packed === any) T.allPackT = (T.allPackT || 0) + 1;
      else T.allPackT = 0;
      if (T.allPackT >= V.revealPacked && !(T.revealT > R.t) && this.rtsFogReveal) {
        T.revealT = R.t + V.revealEvery;
        for (const O of R.teams)
          if (O && !O.neutral && O.id !== T.id)
            for (const e of R.units)
              if (!e.dead && e.bld && e.rtsTeam === T.id)
                this.rtsFogReveal(O.id, e.pos.x, e.pos.z, 10, V.revealEvery + 0.5);
      }
    }
  },
  // 死亡（rts.js 的 rtsOnDeath 呼叫）：空投運輸機被擊落、運輸機墜毀、信標被摧毀
  rtsVeerOnDeath(e) {
    const R = this.rts;
    if (!R) return;
    if (e.rtsDrop) {
      const rec = this.rtsDropOf(e.rtsDrop);
      if (rec) {
        R.drops.splice(R.drops.indexOf(rec), 1);
        if (rec.st === 'fly' || rec.st === 'land') {
          this.rtsRefund(rec.team, rec.cost, V.ship.refund);
          R.stats[rec.team].dropLost++;
          if (rec.team === ME) {
            this.rtsSay('空投失敗：運輸機被擊落（退還 50%）');
            if (this.rtsEvent) this.rtsEvent(e.pos.x, e.pos.z, '空投失敗：運輸機被擊落');
          }
        }
        if (this.rtsHudDrop) this.rtsHudDrop(rec.team);
      }
    }
    if (e.cargo && e.cargo.length) this.rtsCargoCrash(e);
    if (e.bld) {
      const D = RTS_DEFS[e.rtsDef];
      if (D && D.beacon && e.rtsTeam === ME && !e.rtsQuiet && this.rtsEvent)
        this.rtsEvent(e.pos.x, e.pos.z, '信標被摧毀');
      if (D && D.haul) this.rtsHaulLose(e);
    }
  },
});
