// Coral 戰爭（RTS）的單位行為（MechEntity 擴充）：updateAI 開頭攔截有 rtsDef 的實體（建築不在這裡動）。
// 指令佇列 e.orders（第一個是目前的指令，格式見 docs/rts-design.md 12.3；game/rts-orders.js 發佈）：
//   move 移動（不理會敵人）、amove 攻擊移動（沿路迎擊）、attack 攻擊指定目標、hold 守住（只打射程內）、
//   patrol 巡邏（兩點來回、遇敵交戰）、gather 採集循環、build 建造、repair 修理；沒有指令＝待命（自動迎擊視野內的敵人，
//   追太遠就回到原位）。
// 移動：world.nav 的流場（同一個指令的群體共用，o.flow）或 A* 路徑（Game.rtsPathReq 排隊、每格最多算幾條）；
// 最後一段直接走向自己在陣形裡的位置（o.sx／o.sz）。卡住時重新找路。單位之間的推擠在 rts.js 的 rtsSeparate（SpatialHash）。
// 戰鬥沿用 MechEntity 的武器與 fire（不經過攻擊權杖）：射程用定義的 range、射速用定義的 rof（控制子彈數量），彈藥不會用完。
// R2（docs 13.3、13.13）：兵種的技能（rtsAb*：盾牆、投擲貨櫃、貨櫃掩體、照明彈、踏地、架設、火箭齊射；指令 ability）、
// 最短射程、對空（aa／slotAa）、空中單位直線飛行、防禦塔（rtsTowerAI）、民兵的外觀（rtsMorph）；
// 野怪（D 包 rtsCreepAI）與英雄（C 包 rtsHeroAI）在 rtsUnitAI 開頭轉過去。
import { MechEntity } from './mech-entity.js';
import { clamp } from '../core/math.js';
import { targetNear } from '../world/prop-hit.js';
import { Projectile } from './projectile.js';
import { SFX } from '../audio/audio.js';
import { asmStats } from '../data/parts.js';
import { RTS_ABILS, RTS_DEFS, RTS_GATHER } from '../data/rts-units.js';
import { addWorkerKit, buildArtyLegs, buildCoverCrates } from '../render/rts-models.js';

const SCAN_DT = 0.35; // 找目標的間隔（秒）
const STUCK_T = 1.4; // 這麼久沒有前進就重新找路
const REACH_BLD = 3.2; // 離建築外形這麼近可以繳交、施工、修理
const _v = new THREE.Vector3(),
  _aim = new THREE.Vector3(),
  _dir = { x: 0, z: 0 };
const ZERO = new THREE.Vector3();
const SLOTS0 = ['rarm'];
const ROCKET_T = 0.95; // 火箭齊射：每發的飛行時間（預警線 1 秒後落地）
const ROCKET_G = 40;
const WALL_DOT = -0.34; // 盾牆的正面範圍（cos 110°）
const CRATE_DOT = 0.42; // 叉架 MT 舉著的貨櫃（約 ±65°）
const _f = new THREE.Vector3();
const LOS_PAD = 1; // rtsObBlocked：障礙物在水平方向加寬（槍口偏移＋擴散）
// 盾牌 MT 的盾牆、叉架 MT 的貨櫃盾（rtsAbInit 換成實體自己的 specialDefense）：遠程攻擊從正面來時減傷，
// 其他照原本的（盾牌 MT 平常的正面大盾在 mech-special.js）
function rtsSpecialDefense(dmg, impact, from, at, melee, wid) {
  const src = from && from.pos && from !== this ? from.pos : at;
  if (src && !melee && this.staggerT <= 0) {
    _f.set(src.x - this.pos.x, 0, src.z - this.pos.z);
    if (_f.lengthSq() > 0.01) {
      _f.normalize();
      const dot = -Math.sin(this.yaw) * _f.x - Math.cos(this.yaw) * _f.z;
      if (this.rtsWall && dot > WALL_DOT) {
        if (at && this.game.rtsFxOk && this.game.rtsFxOk(at)) this.game.fx.spark(at, 0xffd080);
        return [dmg * 0.12, impact * 0.4];
      }
      if (this.rtsCrateT !== undefined && this.bossVis & 1 && dot > CRATE_DOT)
        return MechEntity.prototype.specialDefense.call(this, dmg * 0.5, impact * 0.6, from, at, melee, wid);
    }
  }
  return MechEntity.prototype.specialDefense.call(this, dmg, impact, from, at, melee, wid);
}

Object.assign(MechEntity.prototype, {
  // ---------- 每格 ----------
  rtsUnitAI(dt) {
    const g = this.game,
      R = g.rts;
    if (this.dead || !R) return true;
    if (this.bld) return true; // 建築：生產、建造進度在 rts.js
    // 別包的單位：野怪（D 包）、英雄（C 包：施法中、走向道具或商店時接手，undefined＝照一般單位處理）
    if (this.creep && this.rtsCreepAI) return this.rtsCreepAI(dt);
    if (this.hero && this.rtsHeroAI) {
      const r = this.rtsHeroAI(dt);
      if (r !== undefined) return r;
    }
    const T0 = performance.now();
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    rt.wish.set(0, 0, 0);
    rt.face = null;
    rt.fireT -= dt;
    rt.scanT -= dt;
    if (this.rtsAbI !== this.rtsDef) this.rtsAbInit(D);
    if (this.staggerT > 0 || R.over) {
      this.move(dt, ZERO, false, false, false, null);
      return true;
    }
    // 技能的計時（架設、貨櫃、盾牆的掩護、自動踏地）；架設／收起中不動、不開火
    if (this.rtsAbTick(dt, D)) {
      R.logicMs = (R.logicMs || 0) + performance.now() - T0;
      this.move(dt, ZERO, false, false, false, null);
      return true;
    }
    let o = this.orders[0];
    // 指令剛換：清掉移動與交戰的暫存
    if (o !== rt.cur) {
      this.rtsLeaveOrder(rt.cur);
      rt.cur = o;
      rt.nav = null;
      rt.engage = null;
      rt.home = null;
      rt.gp = null;
    }
    if (!o) {
      // 盾牆、架設好的自走砲：待命時不離開原地（只打射程內）
      if (this.rtsWall || this.deployed) this.rtsHold(dt, D);
      else this.rtsIdle(dt, D);
    } else {
      let done = false;
      switch (o.k) {
        case 'move':
          done = this.rtsMoveTo(o, dt);
          break;
        case 'amove':
          done = this.rtsAttackMove(o, dt, D);
          break;
        case 'patrol':
          this.rtsPatrol(o, dt, D);
          break;
        case 'attack':
          done = this.rtsAttackOrder(o, dt, D);
          break;
        case 'hold':
          this.rtsHold(dt, D);
          break;
        case 'stop':
          done = true;
          break;
        case 'gather':
          done = this.rtsGather(o, dt, D);
          break;
        case 'build':
          done = this.rtsBuild(o, dt, D);
          break;
        case 'repair':
          done = this.rtsRepair(o, dt, D);
          break;
        case 'ability':
          done = this.rtsAbOrder(o, dt, D);
          break;
        case 'fuse':
        case 'fuseTo':
          // 融合（R3 A 包：rts.js 的 rtsFuseStep；宿主原地等、材料走向宿主）
          done = g.rtsFuseStep ? g.rtsFuseStep(this, o, dt) : true;
          break;
        case 'board':
          // 登機（R4 A 包：rts-veer.js 的 rtsBoardStep；走到運輸機 4 m 內）
          done = g.rtsBoardStep ? g.rtsBoardStep(this, o, dt) : true;
          break;
        case 'unload':
          // 運輸機卸載（R4 A 包：rts-veer.js 的 rtsUnloadStep；飛過去、下降、逐台放下）
          done = g.rtsUnloadStep ? g.rtsUnloadStep(this, o, dt) : true;
          break;
        default:
          done = true;
      }
      if (done && this.orders[0] === o) this.orders.shift();
    }
    // 朝向：交戰中看目標、移動中看前方
    if (rt.face) this.setAim(rt.face);
    else if (rt.wish.lengthSq() > 0.01) {
      const c = this.pos;
      _aim.set(c.x + rt.wish.x * 10, c.y + this.model.height * 0.5, c.z + rt.wish.z * 10);
      this.setAim(_aim);
    }
    if (this.flying && D.hoverH) this.rtsFlyAlt(D, rt);
    R.logicMs = (R.logicMs || 0) + performance.now() - T0; // 指令與索敵的耗時（不含 move 的物理與動作）
    this.move(dt, rt.wish, false, false, false, null);
    if (this.carryVis !== !!(this.carry && this.carry.n)) {
      this.carryVis = !!(this.carry && this.carry.n);
      if (this.model.rtsCrate) this.model.rtsCrate.visible = this.carryVis;
    }
    return true;
  },
  // 離開一個指令：歸還礦脈的採集位置、從建築的施工名單移除
  rtsLeaveOrder(o) {
    if (!this.rt) return; // 建築
    if (this.rt.mineSlot) {
      this.rt.mineSlot.miners.delete(this);
      this.rt.mineSlot = null;
    }
    if (this.rt.buildOn) {
      if (this.rt.buildOn.bld) this.rt.buildOn.bld.builders.delete(this);
      this.rt.buildOn = null;
    }
    if (this.model.rtsDrill) this.model.rtsDrill.rotation.y = 0;
    void o;
  },

  // ---------- 移動 ----------
  // 走向 (x, z)：到達（距離 < arrive）時回傳 true。o（指令）有 flow 時沿流場、否則 A* 路徑（排隊計算）
  rtsGo(x, z, arrive, dt, o, slow = true) {
    const g = this.game,
      nav = g.world.nav,
      rt = this.rt;
    const px = this.pos.x,
      pz = this.pos.z;
    const dx = x - px,
      dz = z - pz;
    const d = Math.hypot(dx, dz);
    if (d < arrive) {
      rt.nav = null;
      return true;
    }
    // 要移動：盾牆放下、架設好的自走砲先收起（收起 2 秒，rtsAbTick 期間不動）
    if (this.rtsWall) this.rtsAbWall(false);
    if (this.rtsSiege && this.rtsSiege.st !== 'up') {
      if (this.rtsSiege.st === 'down') this.rtsAbSiege(false);
      return false;
    }
    // 空中單位：直線飛過去（不用導航格；高度由 move 依地形維持）；目標點限制在 lim − 4 內（R4 B 包：不飛出邊緣的斷崖外）
    if (this.flying) {
      rt.nav = null;
      const lim = g.world.lim - 4;
      const fx = Math.max(-lim, Math.min(lim, x)) - px,
        fz = Math.max(-lim, Math.min(lim, z)) - pz;
      const fd = Math.hypot(fx, fz);
      if (fd < arrive) return true;
      const k = slow ? Math.min(1, 0.35 + fd / 4) : 1;
      rt.wish.set((fx / fd) * k, 0, (fz / fd) * k);
      return false;
    }
    let N = rt.nav;
    // 目標只移動一點（追擊移動中的敵人）：沿用路徑，只換終點
    if (N && !N.flow && (Math.abs(N.x - x) > 0.05 || Math.abs(N.z - z) > 0.05)) {
      if (Math.hypot(N.x - x, N.z - z) < Math.max(0.6, d * 0.25)) {
        N.x = x;
        N.z = z;
        if (N.path && N.path.length) N.path[N.path.length - 1] = { x, z };
      }
    }
    if (!N || Math.abs(N.x - x) > 0.6 || Math.abs(N.z - z) > 0.6) {
      N = rt.nav = { x, z, path: null, pi: 0, pend: false, flow: null, best: d, bestT: 0, stuck: 0 };
      const F = o && o.flow;
      if (F && F.size === (RTS_DEFS[this.rtsDef].size || 0) && Math.hypot(F.tx - x, F.tz - z) < 12)
        N.flow = F;
      else if (nav.lineClear(px, pz, x, z, this.rtNavSize)) N.path = [{ x, z }];
      else g.rtsPathReq(this, N);
    }
    // 卡住：一段時間沒有比最近的距離更接近就重新找路（幾次之後放棄：已經夠近就算到達）
    N.bestT += dt;
    if (d < N.best - 0.5) {
      N.best = d;
      N.bestT = 0;
    } else if (N.bestT > STUCK_T) {
      N.bestT = 0;
      N.best = d;
      N.stuck++;
      if (N.stuck >= 3 && d < arrive + 6) {
        rt.nav = null;
        return true;
      }
      if (N.stuck >= 6) {
        rt.nav = null;
        return true; // 到不了：放棄（呼叫端當作到達）
      }
      N.flow = null;
      N.path = null;
      g.rtsPathReq(this, N);
    }
    let dir = null;
    if (N.flow) {
      // 流場：快到中心時改成直接走向自己的位置
      if (N.flow.dist(px, pz) < 10 && nav.lineClear(px, pz, x, z, this.rtNavSize)) dir = null;
      else dir = N.flow.dir(px, pz, _dir);
    } else if (N.path) {
      let wp = N.path[N.pi];
      while (wp && N.pi < N.path.length - 1 && Math.hypot(wp.x - px, wp.z - pz) < 1.6) wp = N.path[++N.pi];
      if (wp) {
        const wx = wp.x - px,
          wz = wp.z - pz,
          L = Math.hypot(wx, wz) || 1;
        _dir.x = wx / L;
        _dir.z = wz / L;
        dir = _dir;
      }
    } else if (N.pend) {
      // 路徑還在排隊：近的直接走過去，遠的先原地等
      if (d < 8) dir = null;
      else return false;
    }
    if (!dir) {
      _dir.x = dx / d;
      _dir.z = dz / d;
      dir = _dir;
    }
    const k = slow ? Math.min(1, 0.35 + d / 4) : 1;
    this.rt.wish.set(dir.x * k, 0, dir.z * k);
    return false;
  },
  // 空中單位的高度：move 依腳下的地面（含建築頂）維持 hoverH；前方 10 m 內有比飛行高度高的建築時先爬升到它上方 3 m，
  // 才不會被建築擋住（每 0.25 秒看一次）
  rtsFlyAlt(D, rt) {
    const R = this.game.rts,
      w = this.game.world;
    if (rt.flyT > R.t) return;
    rt.flyT = R.t + 0.25;
    const px = this.pos.x,
      pz = this.pos.z;
    let L = Math.hypot(rt.wish.x, rt.wish.z);
    const dx = L > 0.05 ? rt.wish.x / L : 0,
      dz = L > 0.05 ? rt.wish.z / L : 0;
    const here = w.groundAt(px, pz, this.pos.y);
    let want = w.terrainHeight(px, pz) + D.hoverH;
    for (const s of [0, 3, 6, 10]) {
      L = w.groundAt(px + dx * s, pz + dz * s, 1e4);
      if (L + 3 > want) want = L + 3;
    }
    // 圓柱障礙物（RTS 地圖的煙囪、天線桿…，world.js 的 buildRts 記了 top）：前方 10 m 的航線旁有比飛行高度高的就爬升
    const pad = this.radius + 1;
    for (const o of w.obstacles) {
      if (o.kind !== 'circle' || o.top === undefined || o.top + 3 <= want) continue;
      const ox = o.x - px,
        oz = o.z - pz;
      const t = clamp(ox * dx + oz * dz, 0, 10);
      if (Math.hypot(ox - dx * t, oz - dz * t) < o.r + pad) want = o.top + 3;
    }
    this.hoverH = Math.max(2, want - here);
  },
  // 走到建築旁邊：外形上離自己最近的點往外 1.2 m
  rtsGoBld(b, dt) {
    targetNear(b, this.pos, _v);
    const L = Math.hypot(this.pos.x - _v.x, this.pos.z - _v.z) || 1;
    return this.rtsGo(
      _v.x + ((this.pos.x - _v.x) / L) * 1.2,
      _v.z + ((this.pos.z - _v.z) / L) * 1.2,
      1,
      dt,
      null,
    );
  },
  // 指令的目的地：陣形裡自己的位置（沒有時是指令的點）
  rtsDest(o) {
    return o.sx !== undefined ? [o.sx, o.sz] : [o.x, o.z];
  },
  rtsMoveTo(o, dt) {
    const [x, z] = this.rtsDest(o);
    return this.rtsGo(x, z, 1.2, dt, o);
  },

  // ---------- 戰鬥 ----------
  // 射程＝定義的 range＋數值層（研究、英雄光環、道具；rts.js 的 rtsModsApply 寫 rtsRangeAdd）
  rtsRange(D) {
    return D.range ? D.range + (this.rtsRangeAdd || 0) : 0;
  },
  // 到目標的距離（建築用外形最近點）
  rtsDistTo(t) {
    if (t.shape) {
      targetNear(t, this.pos, _v);
      return Math.hypot(_v.x - this.pos.x, _v.z - this.pos.z);
    }
    return Math.max(0, Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z) - (t.radius || 1));
  },
  rtsHostileOk(t) {
    return t && !t.dead && t.rtsTeam !== undefined && t.rtsTeam !== this.rtsTeam && !t.noLock;
  },
  // 視野（或 r）內最近的敵人：單位優先於建築；工人沒有武器時不找
  rtsScan(r, D) {
    if (!this.rtsRange(D)) return null;
    const g = this.game;
    const list = g.rtsNear(this.pos.x, this.pos.z, r + 10);
    let best = null,
      bs = 1e9;
    const nc = this.rt && this.rt.nc && this.orders[0] && this.orders[0].k === 'amove';
    const vAir = D.faction === 'veerwell' && D.slotAa && Object.values(D.slotAa).includes('air');
    for (const t of list) {
      if (!this.rtsHostileOk(t) || !this.rtsAbCanHit(D, t)) continue;
      if (nc && t.creep && this.rtsCreepCalm(t)) continue;
      const d = this.rtsDistTo(t);
      if (d > r || (D.minRange && d < D.minRange)) continue;
      let s = d + (t.bld ? 25 : 0) + (t.rtsDef && RTS_DEFS[t.rtsDef] && RTS_DEFS[t.rtsDef].worker ? 6 : 0);
      if (vAir && t.flying) s -= 12; // 維爾威的誘導飛彈架（對空的槽比較強）：空中目標優先（R4 B 包）
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  },
  // 對目標交戰：射程內停下開火，否則（chase）追過去；回傳 'fire'｜'chase'｜'out'
  rtsFight(t, dt, D, chase) {
    const range = this.rtsRange(D);
    const d = this.rtsDistTo(t);
    if (!this.rtsAbCanHit(D, t)) return 'out';
    // 最短射程（迫擊砲、自走砲）內不開火：能動的往後退
    if (D.minRange && d < D.minRange) {
      if (!chase || this.rtsWall || this.deployed || (this.rtsSiege && this.rtsSiege.st !== 'up'))
        return 'out';
      const L = Math.hypot(this.pos.x - t.pos.x, this.pos.z - t.pos.z) || 1;
      this.rtsGo(
        this.pos.x + ((this.pos.x - t.pos.x) / L) * 8,
        this.pos.z + ((this.pos.z - t.pos.z) / L) * 8,
        0.5,
        dt,
        null,
        false,
      );
      return 'chase';
    }
    if (d <= range && !this.rtsLosBlocked(t)) {
      // 自走砲：攻擊指令（指定目標、攻擊移動）時自動架設
      if (this.rtsSiege && this.rtsSiege.st === 'up') {
        const k = this.orders[0] && this.orders[0].k;
        if (k === 'attack' || k === 'amove' || k === 'patrol') this.rtsAbSiege(true);
      }
      this.rtsFire(t, D);
      return 'fire';
    }
    if (!chase) return 'out';
    // 追：建築走到外形最近點，單位走到它的位置（被地形擋住時走到旁邊）
    const blocked = d <= range;
    if (t.shape) {
      targetNear(t, this.pos, _v);
      this.rtsGo(_v.x, _v.z, blocked ? 3 : range * 0.7, dt, null, false);
    } else this.rtsGo(t.pos.x, t.pos.z, blocked ? 4 : range * 0.8, dt, null, false);
    if (d < range + 6 && !blocked && !this.rtsLosBlocked(t)) this.rtsFire(t, D); // 快到了：邊走邊打（射線要通）
    return 'chase';
  },
  // 射線被擋住：射程內也要再靠近（繞過去），否則子彈一直打在擋住的東西上。0.5 秒檢查一次。
  // - 地形：高低差大時斷崖的邊緣（rts-ai.js 的電腦對手進攻高台上的基地時發現的）
  // - 障礙物：建築（含打不壞的中立建築：酒館、商店、傭兵營）、岩石、礦脈；目標自己的佔地不算。
  //   形狀同子彈的 World.hitsWorld（半徑 1 m 以下的圓柱不擋），水平方向再加寬 LOS_PAD：槍口在機體側面、子彈有擴散，
  //   只從邊角擦過的射線實際上會打在建築上。自己或目標貼著它站（端點在加寬的範圍裡）時不加寬，否則貼牆的會一直判定被擋
  rtsLosBlocked(t) {
    const rt = this.rt,
      now = this.game.rts ? this.game.rts.t : 0;
    if (rt.losTgt === t && now < rt.losT) return rt.losBad;
    if (t.shape) {
      targetNear(t, this.center(), _aim);
      _aim.y = Math.min(t.shape.y1 - 0.5, Math.max(t.shape.y0 + 1, _aim.y));
    } else _aim.copy(t.center());
    rt.losTgt = t;
    rt.losT = now + 0.5;
    const w = this.game.world,
      a = this.center();
    rt.losBad =
      (Math.abs((t.pos.y || 0) - this.pos.y) >= 2 && w.terrainBlocks(a, _aim, 12)) ||
      this.rtsObBlocked(a, _aim, t);
    return rt.losBad;
  },
  rtsObBlocked(a, b, t) {
    const w = this.game.world,
      dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z,
      minX = Math.min(a.x, b.x),
      maxX = Math.max(a.x, b.x),
      minZ = Math.min(a.z, b.z),
      maxZ = Math.max(a.z, b.z),
      L2 = dx * dx + dz * dz;
    for (const o of w.obstacles) {
      if (o === t.rtsOb || (o.rtsBld && (o.rtsBld === t || o.rtsBld.dead))) continue;
      if (o.prop && (o.prop.dead || o.prop === t)) continue;
      if (o.kind === 'box') {
        let hw = o.w / 2 + LOS_PAD,
          hd = o.d / 2 + LOS_PAD;
        if (
          (Math.abs(a.x - o.x) < hw && Math.abs(a.z - o.z) < hd) ||
          (Math.abs(b.x - o.x) < hw && Math.abs(b.z - o.z) < hd)
        ) {
          hw -= LOS_PAD;
          hd -= LOS_PAD;
        }
        if (o.x + hw < minX || o.x - hw > maxX || o.z + hd < minZ || o.z - hd > maxZ) continue;
        // 線段與外框的 slab 測試
        let t0 = 0,
          t1 = 1,
          hit = true;
        const lo0 = o.x - hw,
          hi0 = o.x + hw,
          lo1 = o.y === undefined ? -1e9 : o.y,
          hi1 = o.top,
          lo2 = o.z - hd,
          hi2 = o.z + hd;
        for (let k = 0; k < 3 && hit; k++) {
          const p = k === 0 ? a.x : k === 1 ? a.y : a.z,
            v = k === 0 ? dx : k === 1 ? dy : dz,
            lo = k === 0 ? lo0 : k === 1 ? lo1 : lo2,
            hi = k === 0 ? hi0 : k === 1 ? hi1 : hi2;
          if (Math.abs(v) < 1e-6) {
            if (p < lo || p > hi) hit = false;
          } else {
            let ta = (lo - p) / v,
              tb = (hi - p) / v;
            if (ta > tb) [ta, tb] = [tb, ta];
            if (ta > t0) t0 = ta;
            if (tb < t1) t1 = tb;
            if (t0 > t1) hit = false;
          }
        }
        if (hit) return true;
      } else if (o.r > 1) {
        let r = o.r * 0.9 + LOS_PAD;
        if (Math.hypot(a.x - o.x, a.z - o.z) < r || Math.hypot(b.x - o.x, b.z - o.z) < r) r -= LOS_PAD;
        if (o.x + r < minX || o.x - r > maxX || o.z + r < minZ || o.z - r > maxZ) continue;
        // 水平面上離圓心最近的點，那裡的高度低於圓柱頂（同 hitsWorld：地面＋2r）
        const s = L2 > 1e-6 ? Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2)) : 0;
        const px = a.x + dx * s - o.x,
          pz = a.z + dz * s - o.z;
        if (px * px + pz * pz < r * r && a.y + dy * s < w.terrainHeight(o.x, o.z) + o.r * 2) return true;
      }
    }
    return false;
  },
  rtsFire(t, D) {
    const rt = this.rt;
    // 瞄準點：單位的中心、建築外形上離自己最近的點（半高）
    if (t.shape) {
      targetNear(t, this.center(), _aim);
      _aim.y = Math.min(t.shape.y1 - 0.5, Math.max(t.shape.y0 + 1, _aim.y));
    } else _aim.copy(t.center());
    rt.face = rt.faceV.copy(_aim);
    // 轉向完成才開火
    let dy = Math.abs(this.aimYaw - this.yaw) % (Math.PI * 2);
    if (dy > Math.PI) dy = Math.PI * 2 - dy;
    if (dy > 0.5) return;
    if (this.rtsSiege && !this.deployed) return; // 自走砲：只有架設好才能開火
    if (D.melee) return this.rtsAethMelee ? this.rtsAethMelee(t, this.game.rts.dt || 0.05, D) : undefined; // 近戰（R3 B 包）
    const n0 = this.game.projectiles.length;
    // 只用定義的 slots 開火（預設 rarm）；各槽的傷害倍率 rtsSlotK（rts.js 依 dps 換算）、對空設定 slotAa／aa、
    // 開火間隔乘數值層的 rtsRofK
    const dm = this.dmgMul;
    for (const s of D.slots || SLOTS0) {
      const w = this.weapons[s];
      const wd = w && w.def;
      if (!wd || wd.type === 'none' || wd.type === 'shield' || wd.type === 'melee' || w.dropped) continue;
      const aa = (D.slotAa && D.slotAa[s]) || D.aa || 'ground';
      if (
        aa !== 'both' &&
        (aa === 'air') !== !!t.flying &&
        !(t.flying && this.game.rtsLowAir && this.game.rtsLowAir(t))
      )
        continue;
      if (wd.ammo && w.ammo < wd.ammo * 0.5) w.ammo = wd.ammo; // RTS：彈藥不會用完
      if (wd.mag) w.mag = wd.mag; // 也不換彈匣（rts.js 的 dps 換算只看兩發的間隔）
      if (w.cd > 0 || w.reloadT > 0) continue;
      // 開火間隔＝定義的 rof 與武器的 rof 取慢的（同 rts.js 的換算）× 數值層；上一發晚了多少（cd 已經是負的）
      // 從下一發扣回，平均射速才不受每格的時間間隔影響
      const gap = Math.max(D.rof || 0, wd.rof || 0.1) * (this.rtsRofK || 1);
      const late = Math.max(-gap, Math.min(0, w.cd));
      this.dmgMul = dm * ((this.rtsSlotK && this.rtsSlotK[s]) || 1);
      const ok = this.fire(s, _aim, t);
      this.dmgMul = dm;
      if (ok) {
        w.cd = gap + late;
        w.reloadT = 0;
      }
    }
    if (D.splash) this.rtsAbLob(n0, D);
  },
  // 範圍攻擊的單位（迫擊砲、自走砲）：剛射出的榴彈改成定義的範圍（＋研究），射程超過武器本身的（自走砲 72 m）
  // 重算拋物線，落在瞄準點
  rtsAbLob(n0, D) {
    const P = this.game.projectiles;
    for (let i = n0; i < P.length; i++) {
      const p = P[i];
      if (p.owner !== this || !(p.splash > 0)) continue;
      p.splash = D.splash * (this.rtsSplashK || 1);
      if (p.kind !== 'grenade') continue;
      const tx = _aim.x - p.pos.x,
        tz = _aim.z - p.pos.z;
      const L = Math.hypot(tx, tz);
      const v = Math.hypot(p.vel.x, p.vel.z);
      if (L < 1 || !(v > 0) || L <= v * (p.life - 1.5) + 0.5) continue;
      const tt = L / v;
      const ty = _aim.y - p.pos.y;
      p.vel.set((tx / L) * v, 0.5 * (p.gravity || 26) * tt + ty / tt, (tz / L) * v);
      p.life = tt + 1.5;
    }
  },
  // 被打：待命或攻擊移動中的單位回擊（記下攻擊者，下一次找目標時優先）
  rtsHurtBy(from) {
    if (!from || from.rtsTeam === undefined || from.rtsTeam === this.rtsTeam || !this.rt) return;
    this.rt.hurtBy = from;
    this.rt.hurtT = this.game.rts ? this.game.rts.t : 0;
  },
  // 野怪的營地在待機（沒有出動、沒有在回營）
  rtsCreepCalm(t) {
    const camps = this.game.rts && this.game.rts.camps;
    if (!camps) return false;
    for (const c of camps) if (c.id === t.creep) return c.st === 'idle'; // 回營中的照打（不然它們回到營地就回滿血）
    return false;
  },
  rtsPickTarget(r, D) {
    const rt = this.rt;
    const R = this.game.rts;
    if (
      rt.hurtBy &&
      this.rtsHostileOk(rt.hurtBy) &&
      R.t - rt.hurtT < 4 &&
      this.rtsDistTo(rt.hurtBy) < r * 1.4
    )
      return rt.hurtBy;
    return this.rtsScan(r, D);
  },

  // ---------- 各指令 ----------
  // 待命：自動迎擊視野內的敵人；追離原位太遠就回去
  rtsIdle(dt, D) {
    const rt = this.rt;
    if (!rt.home) rt.home = { x: this.pos.x, z: this.pos.z };
    if (!this.rtsRange(D)) {
      // 工人：被打時往主堡方向躲一下（只是不呆站著）；平常不動
      return;
    }
    if (rt.engage && !this.rtsHostileOk(rt.engage)) rt.engage = null;
    if (!rt.engage && rt.scanT <= 0) {
      rt.scanT = SCAN_DT;
      rt.engage = this.rtsPickTarget(D.sight, D);
    }
    if (rt.engage) {
      const away = Math.hypot(this.pos.x - rt.home.x, this.pos.z - rt.home.z);
      if (away > D.sight + 12)
        rt.engage = null; // 追太遠：放棄、回到原位
      else {
        this.rtsFight(rt.engage, dt, D, true);
        return;
      }
    }
    this.rtsGo(rt.home.x, rt.home.z, 1.5, dt, null);
  },
  rtsHold(dt, D) {
    const rt = this.rt;
    if (!this.rtsRange(D)) return;
    if (rt.engage && (!this.rtsHostileOk(rt.engage) || this.rtsDistTo(rt.engage) > this.rtsRange(D)))
      rt.engage = null;
    if (!rt.engage && rt.scanT <= 0) {
      rt.scanT = SCAN_DT;
      rt.engage = this.rtsPickTarget(this.rtsRange(D), D);
    }
    if (rt.engage) this.rtsFight(rt.engage, dt, D, false);
  },
  rtsAttackMove(o, dt, D) {
    const rt = this.rt;
    rt.nc = !!o.nc; // 電腦對手的進攻（F 包）：不主動去打待在營地裡的野怪（被打或營地出動了才打）
    if (this.rtsRange(D)) {
      if (rt.engage && !this.rtsHostileOk(rt.engage)) {
        rt.engage = null;
        rt.nav = null;
      }
      if (!rt.engage && rt.scanT <= 0) {
        rt.scanT = SCAN_DT;
        rt.engage = this.rtsPickTarget(D.sight, D);
        if (rt.engage) rt.nav = null;
      }
      if (rt.engage) {
        // 追出視野太遠就放下，繼續前進
        if (this.rtsDistTo(rt.engage) > D.sight + 8) {
          rt.engage = null;
          rt.nav = null;
        } else {
          this.rtsFight(rt.engage, dt, D, true);
          return false;
        }
      }
    }
    const [x, z] = this.rtsDest(o);
    return this.rtsGo(x, z, 1.5, dt, o);
  },
  rtsPatrol(o, dt, D) {
    if (o.leg === undefined) o.leg = 0;
    const tx = o.leg ? o.x0 : o.x,
      tz = o.leg ? o.z0 : o.z;
    const leg = { x: tx, z: tz, flow: o.leg ? null : o.flow };
    if (this.rtsAttackMove(leg, dt, D)) {
      o.leg = o.leg ? 0 : 1;
      o.flow = null; // 回程不用流場（流場的目標是去程的點）
      this.rt.nav = null;
    }
  },
  rtsAttackOrder(o, dt, D) {
    const g = this.game;
    const t = g.rtsEnt(o.id);
    if (!t || t.dead) return true;
    if (!this.rtsRange(D)) return true; // 工人不能攻擊
    if (!this.rtsAbCanHit(D, t)) return true; // 打不到（地面武器對空中單位）
    this.rtsFight(t, dt, D, true);
    return false;
  },

  // ---------- 採集 ----------
  // 走到礦脈 → 採 RTS_GATHER.time 秒 → 帶 trip 礦石回最近的主堡 → 繳交 → 回去；採完換最近的礦脈；
  // 一座礦脈同時最多 sat 個工人在採，其他的在旁邊排隊（等太久就換別的礦脈）
  rtsGather(o, dt, D) {
    const g = this.game,
      R = g.rts,
      rt = this.rt;
    if (!D.worker) {
      // 戰鬥單位右鍵礦脈＝走過去
      const m = g.rtsMine(o.mine);
      return !m || this.rtsGo(m.pos.x, m.pos.z, 6, dt, null);
    }
    let m = g.rtsMine(o.mine);
    const trip = D.trip || RTS_GATHER.trip; // 每趟的量（艾瑟立克的研究作業機 8）
    if (!rt.gp) rt.gp = this.carry && this.carry.n >= trip ? 'back' : 'to';
    if (rt.gp !== 'back' && (!m || m.amount <= 0 || m.kind !== 'mine')) {
      // 礦脈採完（或不是礦脈）：換最近還有量的
      const n = g.rtsNearestMine(this.pos.x, this.pos.z, this.rtsTeam, m);
      if (!n) {
        if (this.carry && this.carry.n) rt.gp = 'back';
        else return true;
      } else {
        o.mine = n.id;
        m = n;
        rt.nav = null;
      }
    }
    this.rt.lastMine = o.mine;
    const reach = RTS_GATHER.mineR + RTS_GATHER.reach;
    if (rt.gp === 'to') {
      const d = Math.hypot(m.pos.x - this.pos.x, m.pos.z - this.pos.z);
      if (d > reach) {
        // 走到礦脈邊緣（從自己這一側接近，各個工人錯開一點角度）
        if (rt.gAng === undefined || rt.gMine !== m) {
          rt.gMine = m;
          rt.gAng = Math.atan2(this.pos.z - m.pos.z, this.pos.x - m.pos.x) + ((this.id % 5) - 2) * 0.32;
        }
        const r = RTS_GATHER.mineR + 1.2;
        this.rtsGo(m.pos.x + Math.cos(rt.gAng) * r, m.pos.z + Math.sin(rt.gAng) * r, 1.2, dt, null);
        if (d > reach + 0.5) return false;
      }
      _aim.set(m.pos.x, this.pos.y + 1, m.pos.z);
      rt.face = rt.faceV.copy(_aim);
      if (m.miners.size >= RTS_GATHER.sat && !m.miners.has(this)) {
        // 排隊；等太久找別的礦脈
        rt.waitT = (rt.waitT || 0) + dt;
        if (rt.waitT > 3) {
          rt.waitT = 0;
          const n = g.rtsNearestMine(this.pos.x, this.pos.z, this.rtsTeam, m, true);
          if (n && Math.hypot(n.pos.x - this.pos.x, n.pos.z - this.pos.z) < 70) {
            o.mine = n.id;
            rt.nav = null;
          }
        }
        return false;
      }
      rt.waitT = 0;
      m.miners.add(this);
      rt.mineSlot = m;
      rt.gp = 'mine';
      rt.gT = 0;
      return false;
    }
    if (rt.gp === 'mine') {
      _aim.set(m.pos.x, this.pos.y + 1, m.pos.z);
      rt.face = rt.faceV.copy(_aim);
      rt.gT += dt;
      if (this.model.rtsDrill) this.model.rtsDrill.rotation.y += dt * 25;
      if (Math.random() < dt * 4) {
        const k = RTS_GATHER.mineR / Math.max(1, Math.hypot(this.pos.x - m.pos.x, this.pos.z - m.pos.z));
        _v.set(m.pos.x + (this.pos.x - m.pos.x) * k, this.pos.y + 1.2, m.pos.z + (this.pos.z - m.pos.z) * k);
        if (g.rtsFxOk(_v)) g.fx.spark(_v.clone(), 0xffd070);
      }
      if (rt.gT >= RTS_GATHER.time) {
        const n = Math.min(trip, Math.floor(m.amount));
        m.amount -= n;
        g.rtsMineChanged(m);
        this.carry = { kind: 'ore', n };
        m.miners.delete(this);
        rt.mineSlot = null;
        if (this.model.rtsDrill) this.model.rtsDrill.rotation.y = 0;
        rt.gp = 'back';
        rt.nav = null;
      }
      return false;
    }
    // 帶回最近的回收點
    const b = g.rtsDropoff(this.rtsTeam, this.pos.x, this.pos.z);
    if (!b) return false; // 沒有主堡：等
    const d = this.rtsDistTo(b);
    if (d > REACH_BLD) {
      this.rtsGoBld(b, dt);
      return false;
    }
    // 卸貨（RTS_GATHER.drop 秒）
    rt.dT = (rt.dT || 0) + dt;
    if (rt.dT < RTS_GATHER.drop) return false;
    rt.dT = 0;
    if (this.carry && this.carry.n) {
      // 維爾威的集貨站（R4 A 包）：放進庫存、延遲入帳；其他回收點立刻入帳
      if (!(g.rtsHaulDeposit && g.rtsHaulDeposit(b, this.carry)))
        g.rtsDeposit(this.rtsTeam, this.carry.kind, this.carry.n);
      R.stats[this.rtsTeam].ore += this.carry.n;
    }
    this.carry = null;
    rt.gp = 'to';
    rt.gAng = undefined;
    rt.nav = null;
    return false;
  },

  // ---------- 建造 ----------
  // o＝{ k: 'build', def, x, z, yaw, bid? }：走到工地 → rtsPlace（扣資源、建立地基）→ 施工到完成；
  // bid（已經有地基）＝續建。完成後回去採集剛才的礦脈
  rtsBuild(o, dt, D) {
    const g = this.game,
      rt = this.rt;
    if (!D.worker) return true;
    const B = RTS_DEFS[o.def];
    if (!B) return true;
    let b = o.bid !== undefined ? g.rtsEnt(o.bid) : null;
    if (o.bid !== undefined && (!b || b.dead)) return true;
    if (b && (b.bld.progress >= 1 || B.selfBuild)) return this.rtsAfterBuild();
    if (!b) {
      const r = Math.max(B.foot[0], B.foot[1]) / 2 + 2.5;
      const d = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
      if (d > r) {
        this.rtsGo(o.x, o.z, r - 0.5, dt, null);
        return false;
      }
      b = g.rtsPlace(this.rtsTeam, o.def, o.x, o.z, o.yaw || 0, this);
      if (!b) return true; // 不能蓋（資源不足、被擋住）：rtsPlace 已經提示
      o.bid = b.id;
      // 自己長的建築（艾瑟立克，R3）：放下地基就回去採集
      if (B.selfBuild) {
        b.bld.builders.delete(this);
        return this.rtsAfterBuild();
      }
    }
    // 施工：在建築旁邊（外形 REACH_BLD 內）
    const d = this.rtsDistTo(b);
    if (d > REACH_BLD) {
      if (rt.buildOn) {
        b.bld.builders.delete(this);
        rt.buildOn = null;
      }
      this.rtsGoBld(b, dt);
      return false;
    }
    b.bld.builders.add(this);
    rt.buildOn = b;
    targetNear(b, this.center(), _aim);
    rt.face = rt.faceV.copy(_aim);
    if (this.model.rtsDrill) this.model.rtsDrill.rotation.y += dt * 18;
    if (Math.random() < dt * 3 && g.rtsFxOk(_aim)) g.fx.spark(_aim.clone(), 0x9fd0ff);
    return false;
  },
  // 建好之後：回去採集（之前採過的礦脈），否則待命
  rtsAfterBuild() {
    const m = this.rt.lastMine !== undefined ? this.game.rtsMine(this.rt.lastMine) : null;
    if (m && m.amount > 0 && this.orders.length <= 1) this.orders.push({ k: 'gather', mine: m.id });
    return true;
  },
  // 修理：花礦石補血（data/rts-units.js 的 RTS_REPAIR）
  rtsRepair(o, dt, D) {
    const g = this.game,
      rt = this.rt;
    if (!D.worker) return true;
    const b = g.rtsEnt(o.id);
    if (!b || b.dead || !b.bld || b.rtsTeam !== this.rtsTeam) return true;
    if (b.bld.progress < 1) {
      // 還沒蓋好：改成續建
      this.orders[0] = { k: 'build', def: b.rtsDef, x: b.pos.x, z: b.pos.z, bid: b.id };
      return false;
    }
    if (b.hp >= b.maxHp) return true;
    const d = this.rtsDistTo(b);
    if (d > REACH_BLD) {
      this.rtsGoBld(b, dt);
      return false;
    }
    targetNear(b, this.center(), _aim);
    rt.face = rt.faceV.copy(_aim);
    if (!g.rtsRepairStep(b, this, dt)) return true; // 資源不足
    if (this.model.rtsDrill) this.model.rtsDrill.rotation.y += dt * 18;
    if (Math.random() < dt * 3 && g.rtsFxOk(_aim)) g.fx.spark(_aim.clone(), 0x9fffc8);
    return false;
  },

  // ---------- 技能（docs 13.3；資料 RTS_ABILS，指令 { k: 'ability', ab, x, z, id }） ----------
  // 冷卻：e.rtsCd[ab]＝冷卻結束的局內時間；自動施放：e.rtsAuto[ab]（auto 的技能預設開啟）；Coral 從隊伍扣。
  // 技能傷害一律經過 rtsHit／rtsSplash（乘 e.dmgMul），或投射物（施放者的攻擊類型就是技能的類型時）。
  // 定義換了（第一次、民兵動員）時初始化：盾牆／貨櫃盾的減傷、自走砲的駐鋤
  rtsAbInit(D) {
    this.rtsAbI = this.rtsDef;
    if (!this.rtsCd) this.rtsCd = {};
    if (!this.rtsAuto) this.rtsAuto = {};
    const abil = D.abil || [];
    for (const ab of abil)
      if (RTS_ABILS[ab] && RTS_ABILS[ab].auto && this.rtsAuto[ab] === undefined) this.rtsAuto[ab] = true;
    if (abil.includes('ab_wall') || abil.includes('ab_crate')) this.specialDefense = rtsSpecialDefense;
    if (abil.includes('ab_crate') && this.rtsCrateT === undefined) {
      this.rtsCrateT = 0;
      this.bossVis = 1; // 舉著貨櫃（模型的 crate：mech-foe.js 的 foeFx 依 bossVis 位元 1 顯示）
    }
    if (abil.includes('ab_siege') && !this.rtsSiege) {
      this.rtsSiege = { st: 'up', t: 0 };
      this.deployed = false;
      const legs = buildArtyLegs(this.pal);
      legs.userData.k = 1 / (this.mesh.scale.x || 1);
      legs.scale.setScalar(legs.userData.k);
      legs.visible = false;
      this.mesh.add(legs);
      (this.sx || (this.sx = {})).rtsLegs = legs; // sx 參照到的節點在 RTS 合併時當骨頭（render/rts-merge.js）
    }
    if (this.rtsAethInit) this.rtsAethInit(D); // 艾瑟立克（R3 B 包：entities/mech-rts-aeth.js）
    if (this.rtsVeerInit) this.rtsVeerInit(D); // 維爾威（R4 B 包：entities/mech-rts-veer.js）
  },
  // 每格：回傳 true＝這一格不動也不開火（架設／收起中）
  rtsAbTick(dt, D) {
    const R = this.game.rts;
    // 艾瑟立克（R3 B 包）：引導、撲上、纏附中接手（回傳 true＝這一格不動也不開火）
    if (this.rtsAethTick && this.rtsAethTick(dt, D)) return true;
    // 維爾威（R4 B 包）：推進跳躍、衝撞、卸載、搭乘中接手
    if (this.rtsVeerTick && this.rtsVeerTick(dt, D)) return true;
    // 叉架 MT：丟出貨櫃 20 秒後舉回新的貨櫃
    if (this.rtsCrateT !== undefined && !(this.bossVis & 1) && R.t >= this.rtsCrateT) this.bossVis |= 1;
    // 盾牆：每 0.5 秒掩護身後的友軍
    if (this.rtsWall && !(this.rtsWallT > R.t)) {
      this.rtsWallT = R.t + 0.5;
      this.rtsAbWallCover();
    }
    // 自動踏地
    if (
      this.rtsAuto.ab_stomp &&
      (D.abil || []).includes('ab_stomp') &&
      this.rtsAbReady('ab_stomp') &&
      !(this.rtsStompT > R.t)
    ) {
      this.rtsStompT = R.t + 0.3;
      if (this.rtsAbStompWant()) this.rtsAbCast('ab_stomp');
    }
    // 自走砲：架設 3 秒、收起 2 秒（駐鋤放下／收起）
    const S = this.rtsSiege;
    if (!S) return false;
    const legs = this.sx && this.sx.rtsLegs;
    if (S.st === 'deploying' || S.st === 'packing') {
      S.t -= dt;
      const f = S.st === 'deploying' ? 1 - Math.max(0, S.t) / 3 : Math.max(0, S.t) / 2;
      if (legs) {
        legs.visible = true;
        legs.scale.set(legs.userData.k, legs.userData.k * Math.max(0.05, f), legs.userData.k);
      }
      if (S.t <= 0) {
        S.st = S.st === 'deploying' ? 'down' : 'up';
        this.deployed = S.st === 'down';
        this.noPush = this.deployed;
        if (legs) legs.visible = this.deployed;
        if (this.deployed) this.game.rtsBuff(this, { src: 'siege', sight: 6 }, 1e7);
      }
      return true;
    }
    return false;
  },
  rtsAbReady(ab) {
    const R = this.game.rts;
    return !(this.rtsCd && R && this.rtsCd[ab] > R.t);
  },
  // 不能施放的原因（''＝可以）：研究、冷卻、Coral（HUD 也可以用）
  rtsAbWhy(ab) {
    const g = this.game,
      R = g.rts,
      A = RTS_ABILS[ab];
    if (!A || !R) return '沒有這個技能';
    if (A.req && g.rtsReqWhy) {
      const w = g.rtsReqWhy(this.rtsTeam, A);
      if (w) return w;
    }
    if (!this.rtsAbReady(ab)) return `冷卻中（${Math.ceil(this.rtsCd[ab] - R.t)} 秒）`;
    if ((A.coral || 0) > (R.teams[this.rtsTeam].coral || 0)) return 'Coral 不足';
    return '';
  },
  // 指令 { k: 'ability' }：自己施放的立刻施放；有地點的走到射程內再施放。回傳 true＝指令完成
  rtsAbOrder(o, dt, D) {
    const g = this.game,
      rt = this.rt;
    const A = RTS_ABILS[o.ab];
    if (!A || !(D.abil || []).includes(o.ab)) return true;
    const why = this.rtsAbWhy(o.ab);
    if (why) {
      if (this.rtsTeam === 0 && g.rtsSay) g.rtsSay(`${A.name}：${why}`);
      return true;
    }
    if (A.target === 'self') {
      this.rtsAbCast(o.ab, o);
      return true;
    }
    let x = o.x,
      z = o.z;
    if (o.id !== undefined) {
      const t = g.rtsEnt(o.id);
      if (!t || t.dead) return true;
      x = t.pos.x;
      z = t.pos.z;
    }
    if (x === undefined || z === undefined) return true;
    const d = Math.hypot(x - this.pos.x, z - this.pos.z);
    if (d > (A.range || 0)) {
      this.rtsGo(x, z, Math.max(1, (A.range || 0) - 1), dt, null, false);
      return false;
    }
    rt.face = rt.faceV.set(x, this.pos.y + 1, z);
    this.rtsAbCast(o.ab, { x, z, id: o.id });
    return true;
  },
  // 施放（費用與冷卻在這裡扣；自動施放也走這裡）
  rtsAbCast(ab, o = {}) {
    const g = this.game,
      R = g.rts,
      A = RTS_ABILS[ab];
    if (!A || !R) return;
    if (ab === 'ab_wall') this.rtsAbWall(!this.rtsWall);
    else if (ab === 'ab_siege') {
      const S = this.rtsSiege;
      if (!S) return;
      this.rtsAbSiege(S.st === 'up' || S.st === 'packing');
    } else if (ab === 'ab_stomp') this.rtsAbStomp();
    else if (ab === 'ab_crate') this.rtsAbCrate(o.x, o.z);
    else if (ab === 'ab_cover') this.rtsAbCover(o.x, o.z);
    else if (ab === 'ab_flare') this.rtsAbFlare(o.x, o.z);
    else if (ab === 'ab_rockets') this.rtsAbRockets(o.x, o.z);
    // 艾瑟立克的技能（R3 B 包的 rtsAethAb：true＝施放了，費用與冷卻在這裡扣）
    // 維爾威的技能（R4 B 包的 rtsVeerAb，同上）
    else if (!(this.rtsAethAb && this.rtsAethAb(ab, o)) && !(this.rtsVeerAb && this.rtsVeerAb(ab, o))) return;
    R.teams[this.rtsTeam].coral -= A.coral || 0;
    this.rtsCd[ab] = R.t + (A.cd || 0);
  },
  // 拿掉一筆 buff（盾牆、架設；rts.js 的 rtsBuff 只會加）
  rtsAbUnbuff(src) {
    const M = this.rtsMods;
    if (!M || !M.buff) return;
    const n = M.buff.length;
    M.buff = M.buff.filter((b) => b.src !== src);
    if (M.buff.length !== n) this.game.rtsModsApply(this);
  },
  // 盾牆：不能移動（rtsGo 時自動放下）；正面 ±110°、傷害 ×0.12（rtsSpecialDefense）；大盾放寬
  rtsAbWall(on) {
    on = !!on;
    if (!!this.rtsWall === on) return;
    this.rtsWall = on;
    this.noPush = on;
    const p = this.sx && this.sx.plate;
    if (p) {
      if (p.userData.sx === undefined) p.userData.sx = p.scale.x;
      p.scale.x = p.userData.sx * (on ? 1.7 : 1);
    }
    if (on) {
      const g = this.game;
      if (g.rtsFxOk(this.center())) g.fx.flash(this.center(), 2.2, 0xffb020, 0.2);
      SFX.play('shield', 0.6, 0.8, 0.05, 0.03, this.center());
    }
  },
  // 身後 6 m 內的友軍：受到的傷害 −30%（0.6 秒的 buff，盾牆每 0.5 秒更新）
  rtsAbWallCover() {
    const g = this.game;
    const fx = -Math.sin(this.yaw),
      fz = -Math.cos(this.yaw);
    for (const a of g.rtsNear(this.pos.x, this.pos.z, 8).slice()) {
      if (a === this || a.dead || a.bld || a.rtsTeam !== this.rtsTeam || !a.rtsMods) continue;
      const dx = a.pos.x - this.pos.x,
        dz = a.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) > 6 || dx * fx + dz * fz > -0.5) continue;
      g.rtsBuff(a, { src: 'wall', taken: 0.7 }, 0.6);
    }
  },
  // 自走砲：on＝開始架設（3 秒）、false＝開始收起（2 秒）
  rtsAbSiege(on) {
    const S = this.rtsSiege;
    if (!S) return;
    if (on && (S.st === 'up' || S.st === 'packing')) {
      S.st = 'deploying';
      S.t = 3;
    } else if (!on && (S.st === 'down' || S.st === 'deploying')) {
      S.st = 'packing';
      S.t = 2;
      this.deployed = false;
      this.noPush = false;
      this.rtsAbUnbuff('siege');
    } else return;
    SFX.play('door', 0.5, on ? 0.7 : 0.9, 0.05, 0.03, this.center());
  },
  // 自動踏地：8 m 內有兩台以上的地面敵人，或正在交戰的目標在 8 m 內
  rtsAbStompWant() {
    const g = this.game;
    let n = 0;
    for (const t of g.rtsNear(this.pos.x, this.pos.z, 12)) {
      if (!this.rtsHostileOk(t) || t.bld || t.flying) continue;
      if (this.rtsDistTo(t) <= 8) n++;
    }
    const e = this.rt.engage;
    return n >= 2 || (n >= 1 && !!e && !e.bld && this.rtsHostileOk(e) && this.rtsDistTo(e) <= 8);
  },
  // 踏地：半徑 9 m 的地面衝擊波，60 爆發＋失衡（研究重踏強化後 1.5 秒）；空中單位不受影響
  rtsAbStomp() {
    const g = this.game,
      w = g.world;
    const R0 = 9;
    const c = this.pos.clone();
    g.fx.groundWave(c, R0, 45, 0.05, (x, z) => w.terrainHeight(x, z), 0xffb060);
    g.fx.dust(c.clone().setY(c.y + 0.1), 4, 12, 0xb0a080);
    SFX.play('slam', 0.8, 0.8, 0.05, 0.03, c);
    const stun = g.rtsResLv(this.rtsTeam, 'r_stomp') ? 1.5 : 0.6;
    for (const t of g.rtsNear(c.x, c.z, R0 + 10).slice()) {
      if (!t || t.dead || t.rtsInv || t.rtsTeam === undefined || t.rtsTeam === this.rtsTeam || t.flying)
        continue;
      if (this.rtsDistTo(t) > R0) continue;
      if (!t.bld && t.pos.y - w.terrainHeight(t.pos.x, t.pos.z) > 2) continue;
      // 失衡直接設定（衝擊給 0：takeDamage 先處理衝擊，同一下就會吃到失衡的直擊補正）
      g.rtsHit(t, 60 * this.dmgMul, 0, this, 'exp');
      if (!t.bld && !t.dead) t.staggerT = Math.max(t.staggerT, stun);
    }
  },
  // 從 from 拋一個貨櫃到 land（T 秒落地）：o＝{ dmg, im, splash, R（預警圈）, warn, color }
  rtsAbThrow(from, land, T, o = {}) {
    const g = this.game;
    const G = 22;
    const v = land.clone().sub(from).divideScalar(T);
    v.y = (land.y + 1 - from.y + 0.5 * G * T * T) / T;
    g.projectiles.push(
      new Projectile(g, {
        pos: from.clone(),
        vel: v,
        kind: 'crate',
        dmg: o.dmg || 0,
        impactV: o.im || 0,
        team: this.team,
        owner: this,
        color: o.color || 0x8a6438,
        life: T + 1.5,
        splash: o.splash || 0,
        gravity: G,
      }),
    );
    SFX.shot('grenade', undefined, from);
    if (o.warn) g.fx.warnCircle(land, o.R || o.splash || 3, T);
  },
  // 地面上的點（物件頂面也算）
  rtsAbGround(x, z) {
    const w = this.game.world;
    return new THREE.Vector3(x, w.groundAt(x, z, w.terrainHeight(x, z) + 2), z);
  },
  // 投擲貨櫃：預警圈 1 秒後落地，範圍 4 m 90 爆發＋衝擊 300；之後 20 秒沒有貨櫃盾
  rtsAbCrate(x, z) {
    const g = this.game;
    const land = this.rtsAbGround(x, z);
    const R0 = 4 * (this.rtsSplashK || 1);
    this.bossVis &= ~1;
    this.rtsCrateT = g.rts.t + 20;
    // 貨櫃本身只是外觀（叉架 MT 的攻擊類型是實彈）：落地時以 rtsSplash 算爆發傷害
    this.rtsAbThrow(this.muzzle('rarm'), land, 1, { R: R0, warn: true });
    const team = this.rtsTeam;
    g.later(1, () => {
      if (!g.rts) return;
      g.fx.explosion(land, R0 * 0.8, 0xffa040, false);
      g.fx.dust(land.clone(), R0, 10, 0x9a8a78);
      SFX.explode(false, land);
      g.rtsSplash(land.x, land.z, R0, 90 * this.dmgMul, 300 * this.dmgMul, this, 'exp', team);
    });
  },
  // 貨櫃掩體：放下 8×2.6 m 的臨時牆（血量 800、30 秒；game/hazards2.js 的 addTempWall），同時擋住導航格
  rtsAbCover(x, z) {
    const g = this.game,
      w = g.world;
    const dx = x - this.pos.x,
      dz = z - this.pos.z;
    const yaw = Math.abs(dz) >= Math.abs(dx) ? 0 : Math.PI / 2; // 牆面向叉架 MT
    const W = 8,
      Dp = 2.6,
      H = 3;
    const id = g.addTempWall(new THREE.Vector3(x, 0, z), {
      kind: 'rock',
      w: W,
      h: H,
      d: Dp,
      yaw,
      hp: 800,
      life: 30,
    });
    if (id < 0) return;
    const wall = (g.tWalls || []).find((q) => q.i === id);
    if (wall && wall.grp) {
      // 外觀換成疊放的貨櫃
      while (wall.grp.children.length) wall.grp.remove(wall.grp.children[0]);
      wall.grp.add(buildCoverCrates(W, H, Dp, this.pal));
      const mats = [];
      wall.grp.traverse((q) => {
        if (q.material && !mats.includes(q.material)) mats.push(q.material);
      });
      if (wall.ob) wall.ob.mats = mats;
    }
    const fw = yaw ? Dp : W,
      fd = yaw ? W : Dp;
    if (w.nav) w.nav.block(x, z, fw, fd, 0, true);
    // 牆被打碎或時間到：解除導航格
    const poll = () => {
      const q = (g.tWalls || []).find((r) => r.i === id);
      if (q && !q.dead && g.world === w) g.later(0.5, poll);
      else if (w.nav) w.nav.block(x, z, fw, fd, 0, false);
    };
    g.later(0.5, poll);
  },
  // 照明彈：照亮半徑 18 m 10 秒（戰爭迷霧的 rtsFogReveal）；慢慢落下的發光彈
  rtsAbFlare(x, z) {
    const g = this.game;
    const p = this.rtsAbGround(x, z);
    if (g.rtsFogReveal) g.rtsFogReveal(this.rtsTeam, x, z, 18, 10);
    const mz = this.muzzle('rback');
    g.fx.muzzle(mz, new THREE.Vector3(0, 1, 0), 0xfff0b0, 1.6);
    SFX.shot('grenade', undefined, mz);
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 10, 8),
      new THREE.MeshBasicMaterial({
        color: 0xfff4c0,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    m.position.set(x, p.y + 16, z);
    g.fx.add(m, 10, (e, t) => {
      e.mesh.position.y = p.y + 16 - t * 10;
      e.mesh.material.opacity = 0.95 * (t > 0.85 ? (1 - t) / 0.15 : 1);
      e.mesh.scale.setScalar(1 + 0.25 * Math.sin(t * 60));
    });
    if (this.rtsTeam === 0) g.fx.ring(p.clone().setY(p.y + 0.3), 18, 0xfff0a0);
  },
  // 火箭齊射：預警線 1 秒後沿 24 m 的直線（以目標點為中心、沿直升機 → 目標的方向）落下 8 發，每發 45 穿甲
  // （投射物的 owner 是直升機，攻擊類型＝它的 pierce）
  rtsAbRockets(x, z) {
    const g = this.game;
    let dx = x - this.pos.x,
      dz = z - this.pos.z;
    const L = Math.hypot(dx, dz);
    if (L < 0.5) {
      dx = -Math.sin(this.yaw);
      dz = -Math.cos(this.yaw);
    } else {
      dx /= L;
      dz /= L;
    }
    const A = this.rtsAbGround(x - dx * 12, z - dz * 12),
      B = this.rtsAbGround(x + dx * 12, z + dz * 12);
    g.fx.warnLine(A.clone().setY(A.y + 0.3), B.clone().setY(B.y + 0.3), 1, 0xff6020, 0.14);
    for (let i = 0; i < 8; i++)
      g.later(0.05 + i * 0.07, () => {
        if (!g.rts || this.dead) return;
        // 拋物線（ROCKET_T 秒、重力 ROCKET_G）：最後幾公尺才陡降，不會先打中航線下的單位
        const p = this.rtsAbGround(A.x + ((B.x - A.x) * i) / 7, A.z + ((B.z - A.z) * i) / 7);
        const from = this.center();
        from.y -= 0.6;
        const T = ROCKET_T;
        const v = p.clone().sub(from).divideScalar(T);
        v.y = (p.y - from.y + 0.5 * ROCKET_G * T * T) / T;
        g.projectiles.push(
          new Projectile(g, {
            pos: from,
            vel: v,
            kind: 'shell',
            dmg: 45 * this.dmgMul,
            impactV: 120 * this.dmgMul,
            team: this.team,
            owner: this,
            color: 0xffb060,
            life: T + 0.5,
            splash: 2.5,
            gravity: ROCKET_G,
          }),
        );
        if (g.rtsFxOk(from)) g.fx.muzzle(from, v.clone().normalize(), 0xffb060, 1.2);
        if (i % 2 === 0) SFX.shot('missile', undefined, from);
      });
  },
  // 這個單位（或防禦塔的武器設定）打得到 t 嗎：aa（'both'｜'air'，沒有＝只打地面）＋各槽的 slotAa
  rtsAbCanHit(D, t) {
    if (!D || !t) return false;
    // 低空（R4：衝撞無人機、下降中的運輸機、收起的建築…）地面與對空的武器都打得到
    const g = this.game;
    if (t.flying && g.rtsLowAir && g.rtsLowAir(t)) return !!(D.aa || D.slotAa || D.range || D.dps);
    const fly = !!t.flying;
    const ok = (aa) => aa === 'both' || (aa === 'air') === fly;
    if (ok(D.aa || 'ground')) return true;
    if (D.slotAa) for (const s in D.slotAa) if (ok(D.slotAa[s])) return true;
    return false;
  },

  // ---------- 民兵（rts.js 的 rtsMilitia／rtsDemobUnit 在換定義之前呼叫）：只換外觀與武器 ----------
  rtsMorph(defId) {
    const D = RTS_DEFS[defId];
    if (!D || !D.asm || this.dead || (this.opts && this.opts.modelKind)) return;
    this.asm = { ...D.asm };
    this.stats = asmStats(this.asm);
    this.initWeapons();
    this.swapModel();
    if (D.worker) addWorkerKit(this.model, this.pal);
    this.carryVis = false;
    const g = this.game;
    if (g.rtsFxOk && g.rtsFxOk(this.center())) {
      const col = D.worker ? 0x9fd0ff : 0xffd070;
      g.fx.flash(this.center(), 1.6, col, 0.18);
      g.fx.ring(this.pos.clone().setY(this.pos.y + 0.2), 2, col);
    }
  },

  // ---------- 防禦塔（rts.js 的 rtsBuildings 對蓋好、rtsBldRange > 0 的建築每格呼叫） ----------
  // 起重機砲台：拋物線的貨櫃（爆發、範圍、不打空中；預警圈只在打玩家的單位時顯示）；防空砲塔：只打空中的高速砲彈；
  // 研究要塞化後的主堡（fortGun）：實彈的曳光射擊。指令 attack（b.orders[0]）優先，否則自己找（單位優先、工人最後）
  rtsTowerAI(dt) {
    const g = this.game,
      D = RTS_DEFS[this.rtsDef];
    if (!D || this.dead) return;
    if (this.rtsVeerTower && this.rtsVeerTower(dt)) return; // 維爾威的飛彈防禦塔（R4 B 包：對空與對地的射程不同）
    const gun = D.range ? D : D.fortGun;
    if (!gun) return;
    const range = g.rtsBldRange(this);
    const st = this.rtw || (this.rtw = { cd: 0.3, scanT: 0, tgt: null });
    st.cd -= dt;
    st.scanT -= dt;
    const ok = (t) => {
      if (!this.rtsHostileOk(t) || !this.rtsAbCanHit(gun, t)) return false;
      const d = this.rtsTowerDist(t);
      return d <= range && !(gun.minRange && d < gun.minRange);
    };
    let t = null;
    const o = this.orders && this.orders[0];
    if (o && o.k === 'attack') {
      const a = g.rtsEnt(o.id);
      if (!a || a.dead) this.orders.length = 0;
      else if (ok(a)) t = a;
    }
    if (!t) {
      if (st.tgt && !ok(st.tgt)) st.tgt = null;
      if (!st.tgt && st.scanT <= 0) {
        st.scanT = SCAN_DT;
        st.tgt = this.rtsTowerScan(gun, range);
      }
      t = st.tgt;
    }
    if (!t) return;
    const c = t.center();
    const top = this.pos.y + (this.model.height || 6) * 0.75;
    const yawW = Math.atan2(-(c.x - this.pos.x), -(c.z - this.pos.z));
    const pitch = Math.atan2(c.y - top, Math.hypot(c.x - this.pos.x, c.z - this.pos.z));
    if (this.model.aimAt) this.model.aimAt(yawW - this.yaw, pitch);
    if (st.cd > 0) return;
    st.cd = (gun.rof || 1) * (this.rtsRofK || 1);
    st.shots = (st.shots || 0) + 1;
    const dmg = (gun.dps || 0) * (gun.rof || 1) * this.dmgMul;
    if (this.rtsAethTower && this.rtsAethTower(t, gun, dmg, top)) return; // 艾瑟立克的雷射網（R3 B 包）
    if (gun.aa === 'air') {
      // 防空砲塔：高速砲彈（範圍 2 m；攻擊類型＝定義的 pierce）
      const from = this.model.muzzle
        ? this.model.muzzle.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(this.pos.x, top, this.pos.z);
      const d = from.distanceTo(c);
      const v = c
        .clone()
        .addScaledVector(t.vel || ZERO, d / 80)
        .sub(from)
        .normalize()
        .multiplyScalar(80);
      g.projectiles.push(
        new Projectile(g, {
          pos: from,
          vel: v,
          kind: 'shell',
          dmg,
          impactV: 120,
          team: this.team,
          owner: this,
          color: 0x60e0ff,
          life: d / 80 + 0.3,
          splash: 2,
        }),
      );
      if (g.rtsFxOk(from)) g.fx.muzzle(from, v.clone().normalize(), 0x60e0ff, 1.6);
      SFX.shot('cannon', undefined, from);
    } else if (gun.splash) {
      // 起重機砲台：從吊鉤拋出貨櫃（單位預判 1.2 秒的移動；攻擊類型＝定義的 exp）
      const from = this.model.hook
        ? this.model.hook.getWorldPosition(new THREE.Vector3())
        : new THREE.Vector3(this.pos.x, top, this.pos.z);
      const T = 1.2;
      const vx = t.bld || !t.vel ? 0 : t.vel.x * T * 0.6,
        vz = t.bld || !t.vel ? 0 : t.vel.z * T * 0.6;
      let lx = t.pos.x + vx,
        lz = t.pos.z + vz;
      if (t.shape) {
        targetNear(t, this.pos, _v);
        lx = _v.x;
        lz = _v.z;
      }
      const land = this.rtsAbGround(lx, lz);
      const R0 = (gun.splash || 3) * (this.rtsSplashK || 1);
      this.rtsAbThrow(from, land, T, { dmg, im: 220, splash: R0, R: R0, warn: t.rtsTeam === 0 });
    } else {
      // 主堡的砲座（要塞化）：曳光＋直接命中
      const from = new THREE.Vector3(this.pos.x, top, this.pos.z);
      const dir = c.clone().sub(from).setY(0).normalize();
      from.addScaledVector(dir, Math.min(this.bld.w, this.bld.d) / 2 - 0.5);
      if (g.rtsFxOk(from) || g.rtsFxOk(c)) g.fx.beam(from, c, 0xffd080, 0.05);
      SFX.shot('rifle', undefined, from);
      g.rtsHit(t, dmg, 30, this, gun.atk || 'kin');
    }
  },
  // 防禦塔到目標的距離（從建築的邊緣算）
  rtsTowerDist(t) {
    return Math.max(0, this.rtsDistTo(t) - (this.bld ? Math.min(this.bld.w, this.bld.d) / 2 : 0));
  },
  rtsTowerScan(gun, range) {
    const g = this.game;
    let best = null,
      bs = 1e9;
    for (const t of g.rtsNear(this.pos.x, this.pos.z, range + 14)) {
      if (!this.rtsHostileOk(t) || !this.rtsAbCanHit(gun, t)) continue;
      const d = this.rtsTowerDist(t);
      if (d > range || (gun.minRange && d < gun.minRange)) continue;
      const s = d + (t.bld ? 40 : 0) + (t.rtsDef && RTS_DEFS[t.rtsDef] && RTS_DEFS[t.rtsDef].worker ? 12 : 0);
      if (s < bs) {
        bs = s;
        best = t;
      }
    }
    return best;
  },

  // ---------- 死亡（die() 的 RTS 版：單位碎裂、建築倒塌；不經過 onEnemyKilled／onPlayerDead） ----------
  rtsDie(from) {
    const g = this.game;
    if (this.sts || this.stsV) this.statusClearAll(true);
    this.rtsLeaveOrder(null);
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    if (g.rtsOnDeath) g.rtsOnDeath(this, from);
  },
});
