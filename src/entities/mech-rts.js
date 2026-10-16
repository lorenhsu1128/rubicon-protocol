// Coral 戰爭（RTS）的單位行為（MechEntity 擴充）：updateAI 開頭攔截有 rtsDef 的實體（建築不在這裡動）。
// 指令佇列 e.orders（第一個是目前的指令，格式見 docs/rts-design.md 12.3；game/rts-orders.js 發佈）：
//   move 移動（不理會敵人）、amove 攻擊移動（沿路迎擊）、attack 攻擊指定目標、hold 守住（只打射程內）、
//   patrol 巡邏（兩點來回、遇敵交戰）、gather 採集循環、build 建造、repair 修理；沒有指令＝待命（自動迎擊視野內的敵人，
//   追太遠就回到原位）。
// 移動：world.nav 的流場（同一個指令的群體共用，o.flow）或 A* 路徑（Game.rtsPathReq 排隊、每格最多算幾條）；
// 最後一段直接走向自己在陣形裡的位置（o.sx／o.sz）。卡住時重新找路。單位之間的推擠在 rts.js 的 rtsSeparate（SpatialHash）。
// 戰鬥沿用 MechEntity 的武器與 fire（不經過攻擊權杖）：射程用定義的 range、射速用定義的 rof（控制子彈數量），彈藥不會用完。
import { MechEntity } from './mech-entity.js';
import { targetNear } from '../world/prop-hit.js';
import { RTS_DEFS, RTS_GATHER } from '../data/rts-units.js';

const SCAN_DT = 0.35; // 找目標的間隔（秒）
const STUCK_T = 1.4; // 這麼久沒有前進就重新找路
const REACH_BLD = 3.2; // 離建築外形這麼近可以繳交、施工、修理
const _v = new THREE.Vector3(),
  _aim = new THREE.Vector3(),
  _dir = { x: 0, z: 0 };
const ZERO = new THREE.Vector3();
const SLOTS0 = ['rarm'];

Object.assign(MechEntity.prototype, {
  // ---------- 每格 ----------
  rtsUnitAI(dt) {
    const g = this.game,
      R = g.rts;
    if (this.dead || !R) return true;
    if (this.bld) return true; // 建築：生產、建造進度在 rts.js
    const T0 = performance.now();
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    rt.wish.set(0, 0, 0);
    rt.face = null;
    rt.fireT -= dt;
    rt.scanT -= dt;
    if (this.staggerT > 0 || R.over) {
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
    if (!o) this.rtsIdle(dt, D);
    else {
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
    for (const t of list) {
      if (!this.rtsHostileOk(t)) continue;
      const d = this.rtsDistTo(t);
      if (d > r) continue;
      const s = d + (t.bld ? 25 : 0) + (t.rtsDef && RTS_DEFS[t.rtsDef] && RTS_DEFS[t.rtsDef].worker ? 6 : 0);
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
    if (d <= range && !this.rtsTerrainBlocked(t)) {
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
    if (d < range + 6 && !blocked) this.rtsFire(t, D); // 快到了：邊走邊打
    return 'chase';
  },
  // 高低差大時，地形（斷崖的邊緣）擋在自己和目標之間：射程內也要再靠近（從坡道上去），否則子彈一直打在斷崖上。
  // 0.5 秒檢查一次（rts-ai.js 的電腦對手進攻高台上的基地時發現的）
  rtsTerrainBlocked(t) {
    if (Math.abs((t.pos.y || 0) - this.pos.y) < 2) return false;
    const rt = this.rt,
      now = this.game.rts ? this.game.rts.t : 0;
    if (rt.losTgt === t && now < rt.losT) return rt.losBad;
    if (t.shape) {
      targetNear(t, this.center(), _aim);
      _aim.y = Math.min(t.shape.y1 - 0.5, Math.max(t.shape.y0 + 1, _aim.y));
    } else _aim.copy(t.center());
    rt.losTgt = t;
    rt.losT = now + 0.5;
    rt.losBad = this.game.world.terrainBlocks(this.center(), _aim, 12);
    return rt.losBad;
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
    // 只用定義的 slots 開火（預設 rarm）；各槽的傷害倍率 rtsSlotK（rts.js 依 dps 換算）、對空設定 slotAa／aa、
    // 開火間隔乘數值層的 rtsRofK
    const dm = this.dmgMul;
    for (const s of D.slots || SLOTS0) {
      const w = this.weapons[s];
      const wd = w && w.def;
      if (!wd || wd.type === 'none' || wd.type === 'shield' || wd.type === 'melee' || w.dropped) continue;
      const aa = (D.slotAa && D.slotAa[s]) || D.aa || 'ground';
      if (aa !== 'both' && (aa === 'air') !== !!t.flying) continue;
      if (wd.ammo && w.ammo < wd.ammo * 0.5) w.ammo = wd.ammo; // RTS：彈藥不會用完
      if (w.cd > 0 || w.reloadT > 0) continue;
      this.dmgMul = dm * ((this.rtsSlotK && this.rtsSlotK[s]) || 1);
      const ok = this.fire(s, _aim, t);
      this.dmgMul = dm;
      if (ok) w.cd = Math.max(w.cd, D.rof || 0) * (this.rtsRofK || 1);
    }
  },
  // 被打：待命或攻擊移動中的單位回擊（記下攻擊者，下一次找目標時優先）
  rtsHurtBy(from) {
    if (!from || from.rtsTeam === undefined || from.rtsTeam === this.rtsTeam || !this.rt) return;
    this.rt.hurtBy = from;
    this.rt.hurtT = this.game.rts ? this.game.rts.t : 0;
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
    if (!rt.gp) rt.gp = this.carry && this.carry.n >= RTS_GATHER.trip ? 'back' : 'to';
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
        const n = Math.min(RTS_GATHER.trip, Math.floor(m.amount));
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
    if (b && b.bld.progress >= 1) return this.rtsAfterBuild();
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
