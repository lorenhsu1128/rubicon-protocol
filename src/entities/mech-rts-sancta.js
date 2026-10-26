// Coral 戰爭（RTS）聖域互助同盟的兵種行為（MechEntity 擴充，docs/rts-design.md 16.2、16.3、16.12；R5 B 包），
// 以及殘骸、地雷、圓頂的外觀（Game 的 rtsSancWreckFx／rtsSancMineFx／rtsSancDome*，game/rts-sancta.js 呼叫）。
// mech-rts.js 的分派：rtsAbInit 結尾 rtsSancInit(D)、rtsAbTick 裡 rtsSancTick(dt, D)（true＝這一格不動也不開火）、
// rtsAbCast 認不得的技能 rtsSancAb(ab, o)（true＝施放了，費用與冷卻由 rtsAbCast 扣）；rts.js 的 rtsSpawn 在網格合併之前
// 呼叫 rtsSancModel(D)（回收拖車的吊臂、巨像的外加零件、6 種改裝零件）；rtsHook 的 takeDamage 呼叫 rtsSancDefense。
// - 回收拖車（ab_haul）：展開 2 秒（不能移動）→ 移動回收點（e.rtsHaulOn）＋8 m 改裝站＋每 5 秒自己拆 10 m 內的一個殘骸；
//   收到移動指令自動收起（1 秒）。
// - 拾荒 MT：12 m 內有單位陣亡時撿零件（e.rtsScavN，最多 5 層：每層傷害 +5%、最大血量 +25；數值層的 buff 'scav'）。
// - 鉚釘機（ab_pin，自動預設開）：目標 2.5 秒不能移動（buff 'pin' 的速度 ×0.01，還能轉向、開火；英雄 1.5 秒，ACS 穩定器抵消）。
// - 修理無人機：每 0.5 秒選 10 m 內血量比例最低的己方單位（建築 50%），每秒修 8 AP（野戰修理 12）；同一個目標最多 2 台；
//   專心修理（ab_focus）＝跟著指定的對象直到滿血或換指令。
// - 布雷無人機（ab_mine）：A 的 rtsLandMineAdd；自動施放（預設關）＝閒置時在身邊 10 m 內補到上限。
// - 潛航砲艇：水深 0.6 m 以上、2 秒沒開火（研究 1 秒）時潛航（e.rtsSub：迷霧由 A 的 rtsSubSeen 處理；自己的隊伍看到半透明），
//   水裡速度 ×1.3（研究 ×1.5）；開火浮出；浮在水面上（模型不沉到水底）。
// - 拾荒外殼機：外殼吃掉每次傷害的 70%（400，研究 600）；吸附殘骸（ab_absorb，自動）外殼 +200（研究 ×1.5）。
// - 護盾產生器（ab_dome）：展開 1.5 秒 → 半徑 10 m 的圓頂（Game 的 rtsSancDomeAdd，C 包的避難護盾也可以用同一套），
//   外面打進來的傷害全額由圓頂吸收（800，研究 1200）；5 秒沒被打每秒回 20；打破後 15 秒（研究 10）重新展開；移動時收起。
// - 拼裝巨像（ab_rebuild，自動）：吸 12 m 內的殘骸（每個最多 100 礦石），每 1 礦石回 4 AP，一次最多 600。
// 只在單機（RTS 沒有多人）；技能的時間以局內時間 R.t 計。
import { MechEntity } from './mech-entity.js';
import { Game } from '../game/game.js';
import { SFX } from '../audio/audio.js';
import { asmStats } from '../data/parts.js';
import { RTS_DEFS, RTS_TEAM_COLORS } from '../data/rts-units.js';
import { RTS_SANC } from '../data/rts-sancta.js';
import { buildBossModel } from '../render/boss-models.js';
import { buildDrone, buildVehicle } from '../render/vehicle-models.js';
import { buildProjectileMesh } from '../render/extra-models.js';
import { rtsPal } from '../render/rts-models.js';
import {
  SANC_LAMP,
  SANC_RUST,
  addColossusKit,
  addHaulerKit,
  addRefitKits,
  buildMineBatch,
  buildWreckBatch,
} from '../render/rts-sancta-models.js';

const ME = 0;
const S = RTS_SANC;
const W = S.wreck;
const HAUL_PACK = 1; // 回收拖車收起的秒數
const DOME_PACK = 0.5;
const PIN = { t: 2.5, hero: 1.5, speed: 0.01, scan: 0.3 };
const REPAIR = { r: 10, rate: 8, rateRes: 12, bld: 0.5, max: 2, scan: 0.5, follow: 5 };
const MINE_AUTO = { r: 10, scan: 0.5 };
const REBUILD = { r: 12, per: 100, k: 4, max: 600, at: 0.6 };
const ABSORB = { r: 10, at: 0.6 };
const WRECK_CAP = 160; // 每種大小的實例上限（動態殘骸 140＋殘影與沉下去中的）
const WRECK_RISE = 0.6; // 冒出來的動畫秒數
const WRECK_DEL = 0.7; // 拆完時沉下去的秒數
const MINE_CAP = 120;
const TORPEDO_V = 26; // 魚雷的速度（m／秒，同主線的 torpedoShot）
const _m4 = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _p = new THREE.Vector3(),
  _s = new THREE.Vector3(),
  _Y = new THREE.Vector3(0, 1, 0),
  _c = new THREE.Color(),
  _c2 = new THREE.Color();
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);
const PROTO_MOVE = MechEntity.prototype.move;
const DUMMY_MAT = new THREE.MeshStandardMaterial(); // rtsSancModel：拿掉動作會改的材質參照時的替身
const hyp = Math.hypot;
const now = (g) => (g.rts ? g.rts.t : performance.now() / 1000);

// 潛航砲艇的移動：照常跑物理，之後模型浮在水面上（不沉到水底；潛航中照樣在水下）
function boatMove(dt, wish, wantHover, wantQB, wantAB, tgt) {
  const r = PROTO_MOVE.call(this, dt, wish, wantHover, wantQB, wantAB, tgt);
  const W0 = this.game.world && this.game.world.theme && this.game.world.theme.water;
  if (W0 && !this.dead) {
    const lv = W0.level - (this.rtsSub ? 1.4 : 0.55);
    if (this.mesh.position.y < lv) this.mesh.position.y = lv;
  }
  return r;
}

Object.assign(MechEntity.prototype, {
  // ---------- 模型（rts.js 的 rtsSpawn 在網格合併之前呼叫；效能基準的 rtsSancReskin 也是） ----------
  rtsSancModel(D) {
    if (!D || D.faction !== 'sancta' || D.kind !== 'unit' || D.hero) return;
    const rig = this.model;
    if (!rig || rig.rtsSancKit) return;
    rig.rtsSancKit = true;
    // 一般任務的動作會改的發光材質（鉚釘機的槍口、面罩：rig.extra 的材質）在 RTS 沒有那些動作，拿掉參照讓它們照樣併進
    // 單一材質（否則每台多 2 個 draw call）；無人機半透明的加色噴焰錐 RTS 的鏡頭看不清楚，不畫（同維爾威的 slimNozzles）
    // （換成不在任何網格上的替身：一般任務的行為端照樣可以改它，不會出錯）
    for (const o of [rig, rig.extra])
      if (o) for (const k of Object.keys(o)) if (o[k] && o[k].isMaterial && k !== 'mats') o[k] = DUMMY_MAT;
    for (const n of rig.nozzles || [])
      if (n.isMesh && n.material && n.material.transparent) n.visible = false;
    rig.group.traverse((q) => {
      if (
        q.isMesh &&
        q.material &&
        q.material.isMeshBasicMaterial &&
        q.material.transparent &&
        !q.userData.rtsSpin
      )
        if (q.material.blending === THREE.AdditiveBlending) q.visible = false;
    });
    if (D.hauler) addHaulerKit(rig, this.pal);
    if (D.id === 's_colossus') addColossusKit(rig, this.pal);
    // 改裝的零件：工人不能改裝；可以裝的才建（refitOk 沒寫＝全部，A 的 rtsRefitWhy 決定能不能裝）
    if (!D.worker) addRefitKits(rig, this.pal, D.refitOk || null);
  },
  // 換成 RTS 定義的外觀（效能基準 scripts/rts-bench.js 的 --faction=sancta：一般任務的實體換上聖域兵種真正的模型；
  // 行為照原本的 AI）。team＝隊伍色（0 藍、1 紅）
  rtsSancReskin(defId, team = 0) {
    const D = RTS_DEFS[defId];
    const g = this.game;
    if (!D || D.kind !== 'unit' || this.dead) return false;
    const pal = rtsPal(D.palBase || D.faction, team);
    g.scene.remove(this.mesh);
    if (this.glare) {
      this.glare.forEach((m) => g.scene.remove(m));
      this.glare = null;
    }
    this.pal = pal;
    this.asm = { ...D.asm };
    this.stats = this.dkStats(asmStats(this.asm));
    this.initWeapons();
    this.scale = D.scale || 1;
    this.radius = D.radius || this.radius;
    this.opts = { ...this.opts, modelKind: D.modelKind, vehKey: D.vehKey };
    const raw = g.rtsR ? { raw: true } : undefined;
    this.model =
      D.modelKind === 'boss'
        ? buildBossModel(D.vehKey, pal, this.scale, raw)
        : D.modelKind === 'drone'
          ? buildDrone(pal, this.scale, D.vehKey || 'swarm')
          : D.modelKind === 'vehicle'
            ? buildVehicle(pal, this.scale)
            : this.buildRig(true);
    this.rtsSancModel(D);
    // 一般任務的 AI 有些會自己變多或隱藏（潛航砲艇的潛航、拾荒外殼機吸附物件）：效能基準照一般的 MT 開火
    if (['gunboat', 'junk', 'dome', 'repair', 'minelayer'].includes(this.ai)) this.ai = 'mt';
    this.mergeModel(this.model);
    const old = this.mesh;
    this.mesh = this.model.group;
    this.mesh.position.copy(old.position);
    this.mesh.rotation.copy(old.rotation);
    g.scene.add(this.mesh);
    return true;
  },
  // 定義換了（第一次 rtsUnitAI）：狀態與實例覆寫
  rtsSancInit(D) {
    if (!D || D.faction !== 'sancta' || D.kind !== 'unit' || D.hero) {
      this.rtsSanc = null;
      return;
    }
    const s = this.rtsSanc || (this.rtsSanc = {});
    // 沒經過 rtsSpawn 的掛勾（合併前）時補上零件（已經合併的不補：改裝只是看不到零件）
    if (this.model && !this.model.rtsSancKit && (this.model.rtsPending || !this.model.merged))
      this.rtsSancModel(D);
    if (D.shell && s.shell === undefined) {
      s.shellMax = this.rtsSancShellMax();
      s.shell = s.shellMax;
    }
    if (D.hauler && !s.haul) s.haul = { st: 'up', t: 0, salvT: 0 };
    if (D.dome && !s.dome) s.dome = { st: 'up', t: 0, rec: null };
    if (D.repairer && !s.rep) s.rep = { scanT: 0, tgt: null, focus: null, fxT: 0 };
    if (D.amphib) this.opts.amphib = true; // 涉水不減速（MechEntity.waterK）
    if (D.sub && !s.sub) {
      s.sub = { lastFire: -99, cd: {}, a: 1 };
      if (!Object.prototype.hasOwnProperty.call(this, 'move')) this.move = boatMove;
    }
  },
  rtsSancShellMax() {
    const g = this.game;
    const lv = g.rtsResLv ? g.rtsResLv(this.rtsTeam, 'r_hull') : 0;
    return lv ? S.shell.maxRes : S.shell.max;
  },

  // ---------- 每格（rtsAbTick；true＝這一格不動也不開火） ----------
  rtsSancTick(dt, D) {
    const s = this.rtsSanc;
    if (!s || !this.game.rts) return false;
    if (s.haul && this.rtsSancHaulTick(dt)) return true;
    if (s.dome && this.rtsSancDomeTick(dt)) return true;
    if (s.rep) this.rtsSancRepairTick(dt, D);
    if (s.sub) this.rtsSancSubTick(dt, D);
    if (s.shell !== undefined) this.rtsSancShellTick(dt, D);
    const ab = D.abil || [];
    const R = this.game.rts;
    if (!(s.scanT > R.t)) {
      s.scanT = R.t + PIN.scan;
      if (ab.includes('ab_pin') && this.rtsAuto.ab_pin && !this.rtsAbWhy('ab_pin')) {
        const o0 = this.orders[0];
        const t =
          (this.rt && this.rt.engage) ||
          (o0 && o0.k === 'attack' && o0.id !== undefined ? this.game.rtsEnt(o0.id) : null);
        if (this.rtsSancPinOk(t) && this.rtsDistTo(t) <= (RTS_DEFS[this.rtsDef].range || 24) + 0.5)
          this.rtsAbCast('ab_pin', { id: t.id, x: t.pos.x, z: t.pos.z });
      }
      if (ab.includes('ab_mine') && this.rtsAuto.ab_mine && !this.orders.length && this.rtsAbReady('ab_mine'))
        this.rtsSancMineAuto();
      if (
        ab.includes('ab_absorb') &&
        this.rtsAuto.ab_absorb &&
        s.shell < s.shellMax * ABSORB.at &&
        this.rtsAbReady('ab_absorb')
      )
        this.rtsAbCast('ab_absorb');
      if (
        ab.includes('ab_rebuild') &&
        this.rtsAuto.ab_rebuild &&
        this.hp < this.maxHp * REBUILD.at &&
        this.rtsAbReady('ab_rebuild')
      )
        this.rtsAbCast('ab_rebuild');
    }
    return false;
  },

  // ---------- 技能（rtsAbCast 轉來；true＝施放了） ----------
  rtsSancAb(ab, o = {}) {
    const g = this.game,
      R = g.rts;
    if (!R || this.dead) return false;
    const s = this.rtsSanc || (this.rtsSanc = {});
    switch (ab) {
      case 'ab_haul': {
        const H = s.haul;
        if (!H) return false;
        if (H.st === 'up' || H.st === 'packing') this.rtsSancHaulSet('deploying');
        else this.rtsSancHaulSet('packing');
        return true;
      }
      case 'ab_dome': {
        const Dm = s.dome;
        if (!Dm) return false;
        if (Dm.st === 'up' || Dm.st === 'packing') this.rtsSancDomeSet('deploying');
        else this.rtsSancDomeSet('packing');
        return true;
      }
      case 'ab_pin': {
        const t = o.id !== undefined ? g.rtsEnt(o.id) : null;
        if (!this.rtsSancPinOk(t)) return false;
        this.rtsSancPin(t);
        return true;
      }
      case 'ab_focus': {
        const t = o.id !== undefined ? g.rtsEnt(o.id) : null;
        if (!t || t.dead || t.rtsTeam !== this.rtsTeam || t === this || !s.rep) return false;
        s.rep.focus = t.id;
        s.rep.tgt = t.id;
        return true;
      }
      case 'ab_mine': {
        if (o.x === undefined) return false;
        g.rtsLandMineAdd(this.rtsTeam, o.x, o.z, { owner: this });
        const p = new THREE.Vector3(o.x, g.world.terrainHeight(o.x, o.z) + 0.2, o.z);
        if (g.rtsFxOk(p) && this.rtsSancSeen()) {
          g.fx.beam(this.center(), p, 0xff8a60, 0.08);
          g.fx.dust(p, 1, 4, 0x8a7a60);
        }
        return true;
      }
      case 'ab_absorb':
        return this.rtsSancAbsorb();
      case 'ab_rebuild':
        return this.rtsSancRebuild();
    }
    return false;
  },
  // 玩家看得到這個實體（自己的隊伍，或迷霧外）：特效只畫給看得到的
  rtsSancSeen() {
    return this.rtsTeam === ME || !this.fogHid;
  },

  // ---------- 回收拖車 ----------
  rtsSancHaulSet(st) {
    const H = this.rtsSanc.haul;
    H.st = st;
    H.t = st === 'deploying' ? S.hauler.deploy : st === 'packing' ? HAUL_PACK : 0;
    if (st !== 'on') this.rtsHaulOn = false;
    this.noPush = st !== 'up';
  },
  rtsSancHaulTick(dt) {
    const g = this.game,
      R = g.rts,
      H = this.rtsSanc.haul,
      rig = this.model;
    if (H.st === 'deploying' || H.st === 'packing') {
      H.t -= dt;
      const dep = H.st === 'deploying';
      const f = dep ? 1 - Math.max(0, H.t) / S.hauler.deploy : Math.max(0, H.t) / HAUL_PACK;
      if (rig.setHaul) rig.setHaul(f);
      if (H.t <= 0) {
        this.rtsSancHaulSet(dep ? 'on' : 'up');
        if (dep) {
          this.rtsHaulOn = true;
          H.salvT = R.t + S.hauler.time;
          const p = this.pos.clone();
          if (g.rtsFxOk(p) && this.rtsSancSeen()) g.fx.dust(p, 2.5, 8, 0x8a7a60);
        }
      }
      return true;
    }
    if (H.st !== 'on') return false;
    if (this.rtsSancDeployedOrders('ab_haul')) return true;
    // 自己拾荒：每 5 秒拆 10 m 內的一個殘骸（這一隊看過的）
    if (R.t >= H.salvT) {
      H.salvT = R.t + S.hauler.time;
      const w = g.rtsWreckAt
        ? g.rtsWreckAt(this.pos.x, this.pos.z, S.hauler.r, { team: this.rtsTeam })[0]
        : null;
      if (w) {
        const c = g.rtsWreckTake(w, g.rtsSalvageTrip(this.rtsTeam, true));
        if (c.ore > 0 || c.parts > 0) {
          g.rtsSalvageDeposit(this.rtsTeam, c);
          H.got = (H.got || 0) + c.ore;
          const p = new THREE.Vector3(w.x, (w.y || 0) + 0.6, w.z);
          if (g.rtsFxOk(p) && this.rtsSancSeen()) {
            g.fx.beam(this.center(), p, 0xffc890, 0.25);
            for (let i = 0; i < 3; i++) g.fx.spark(p, 0xffb070);
          }
        }
      }
    }
    return true;
  },
  // 展開中的指令：同一個技能＝收起；守住、停止＝丟掉；其他會移動的指令＝先收起（指令留著，收好了再執行）
  rtsSancDeployedOrders(ab) {
    const o = this.orders[0];
    if (!o) return false;
    if (o.k === 'ability' && o.ab === ab) {
      this.orders.shift();
      this.rtsAbCast(ab);
      return true;
    }
    if (o.k === 'hold' || o.k === 'stop') {
      this.orders.shift();
      return false;
    }
    if (
      o.k === 'ability' &&
      o.ab &&
      RTS_DEFS[this.rtsDef] &&
      (RTS_DEFS[this.rtsDef].abil || []).includes(o.ab)
    )
      return false;
    if (ab === 'ab_haul') this.rtsSancHaulSet('packing');
    else this.rtsSancDomeSet('packing');
    return true;
  },

  // ---------- 鉚釘機：釘住 ----------
  rtsSancPinOk(t) {
    const g = this.game;
    if (!t || t.dead || t.bld || t.rtsInv || t.rtsTeam === undefined || t.rtsTeam === this.rtsTeam)
      return false;
    if (t.rtsAboard || t.noLock) return false;
    if (t.flying && !(g.rtsLowAir && g.rtsLowAir(t))) return false;
    const R = g.rts;
    return !(t.rtsPinT > R.t + 0.5);
  },
  rtsSancPin(t) {
    const g = this.game,
      R = g.rts;
    const c = t.center();
    if (g.rtsFxOk(c) && (this.rtsSancSeen() || !t.fogHid)) {
      g.fx.beam(this.center(), c, 0xff9a60, 0.12);
      g.fx.flash(c, 1.2, 0xffb070, 0.12);
      for (let i = 0; i < 4; i++) g.fx.spark(c, 0xffc080);
    }
    // 英雄的 ACS 穩定器抵消（同 rtsStun）
    if (t.hero && g.rtsHeroHas && g.rtsHeroHas(t.hero, 'i_stab') && !(t.hero.stabT > R.t)) {
      t.hero.stabT = R.t + 20;
      if (g.rtsFxOk(c)) g.fx.ring(t.pos.clone(), 3, 0x9fe8ff);
      return;
    }
    const sec = t.hero ? PIN.hero : PIN.t;
    g.rtsBuff(t, { src: 'pin', speed: PIN.speed }, sec);
    t.rtsPinT = R.t + sec;
    if (t.vel) t.vel.set(0, t.vel.y, 0);
    if (g.rtsFxOk(c) && (this.rtsSancSeen() || !t.fogHid))
      g.fx.ring(t.pos.clone().setY(t.pos.y + 0.2), 1.6, SANC_RUST);
    SFX.shot('rifle', undefined, c);
  },

  // ---------- 修理無人機 ----------
  rtsSancRepairRate() {
    const g = this.game;
    return g.rtsResLv && g.rtsResLv(this.rtsTeam, 'r_mend') ? REPAIR.rateRes : REPAIR.rate;
  },
  rtsSancRepairOk(t) {
    return (
      t &&
      !t.dead &&
      t !== this &&
      t.rtsTeam === this.rtsTeam &&
      !t.rtsAboard &&
      !t.rtsIllus &&
      t.hp < t.maxHp &&
      !(t.bld && t.bld.progress < 1)
    );
  },
  rtsSancRepairTick(dt, D) {
    const g = this.game,
      R = g.rts,
      P = this.rtsSanc.rep;
    // 專心修理：跟著對象，直到它滿血、死掉或換了指令
    if (P.focus !== null) {
      const f = g.rtsEnt(P.focus);
      if (!f || f.dead || f.hp >= f.maxHp || this.orders.length) P.focus = null;
      else {
        P.tgt = f.id;
        if (hyp(f.pos.x - this.pos.x, f.pos.z - this.pos.z) > REPAIR.follow + (f.bld ? f.radius : 0))
          this.rtsGo(f.pos.x, f.pos.z, REPAIR.follow, dt, null, false);
      }
    }
    // 每 0.5 秒選 10 m 內血量比例最低的（同一個目標最多 2 台）
    if (P.focus === null && !(P.scanT > R.t)) {
      P.scanT = R.t + REPAIR.scan;
      let best = null,
        bs = 1;
      const list = g.rtsNear(this.pos.x, this.pos.z, REPAIR.r + 10);
      for (const t of list) {
        if (!this.rtsSancRepairOk(t) || this.rtsDistTo(t) > REPAIR.r) continue;
        const k = t.hp / t.maxHp;
        if (k >= bs) continue;
        if (P.tgt !== t.id) {
          let n = 0;
          for (const u of list)
            if (u !== this && u.rtsSanc && u.rtsSanc.rep && u.rtsSanc.rep.tgt === t.id && !u.dead) n++;
          if (n >= REPAIR.max) continue;
        }
        bs = k;
        best = t;
      }
      P.tgt = best ? best.id : null;
    }
    const t = P.tgt !== null ? g.rtsEnt(P.tgt) : null;
    if (!this.rtsSancRepairOk(t)) {
      if (P.focus === null) P.tgt = null;
      return;
    }
    if (this.rtsDistTo(t) > REPAIR.r) return;
    const rate = this.rtsSancRepairRate() * (t.bld ? REPAIR.bld : 1);
    t.hp = Math.min(t.maxHp, t.hp + rate * dt);
    P.healed = (P.healed || 0) + rate * dt;
    if (R.t >= P.fxT) {
      P.fxT = R.t + 0.2;
      const c = t.center();
      if (g.rtsFxOk(c) && this.rtsSancSeen()) g.fx.beam(this.center(), c, 0x9fffc8, 0.12);
    }
    void D;
  },

  // ---------- 布雷無人機：自動布雷（閒置時在身邊 10 m 內補到上限） ----------
  rtsSancMineAuto() {
    const g = this.game,
      R = g.rts;
    const per = g.rtsResLv(this.rtsTeam, 'r_mines') ? S.mine.perRes : S.mine.per;
    const mine = (R.lmines || []).filter((m) => m.owner === this.id && !m.free);
    if (mine.length >= per) return;
    const s = this.rtsSanc;
    const c = s.mineC || (s.mineC = { x: this.pos.x, z: this.pos.z });
    // 布雷的中心：第一次閒置的位置（被移動指令帶走時換新的）
    if (hyp(c.x - this.pos.x, c.z - this.pos.z) > MINE_AUTO.r * 1.5) {
      c.x = this.pos.x;
      c.z = this.pos.z;
    }
    for (let k = 0; k < 12; k++) {
      const n = mine.length + k;
      const a = n * 2.39996,
        r = 3 + (n % 4) * 2;
      const x = c.x + Math.cos(a) * r,
        z = c.z + Math.sin(a) * r;
      if (mine.some((m) => hyp(m.x - x, m.z - z) < 2.5)) continue;
      if (g.world.nav && g.world.nav.walkable && !g.world.nav.walkable(g.world.nav.cellOf(x, z), 0)) continue;
      this.rtsAbCast('ab_mine', { x, z });
      return;
    }
  },

  // ---------- 潛航砲艇 ----------
  rtsSancSubTick(dt, D) {
    const g = this.game,
      R = g.rts,
      w = g.world,
      sb = this.rtsSanc.sub;
    let fired = false;
    for (const sl of D.slots || ['rarm']) {
      const wp = this.weapons[sl];
      if (!wp) continue;
      const prev = sb.cd[sl];
      if (prev !== undefined && wp.cd > prev + 0.05) fired = true;
      sb.cd[sl] = wp.cd;
    }
    if (fired) sb.lastFire = R.t;
    const res = g.rtsResLv(this.rtsTeam, 'r_dive');
    const deep = !!(w.theme && w.theme.water) && w.waterDepth(this.pos.x, this.pos.z) >= S.sub.depth;
    const want = deep && !this.dead && R.t - sb.lastFire >= (res ? S.sub.idleRes : S.sub.idle);
    if (want !== !!this.rtsSub) {
      this.rtsSub = want;
      if (want) g.rtsBuff(this, { src: 'sub', speed: res ? S.sub.speedRes : S.sub.speed }, 1e7);
      else this.rtsAbUnbuff('sub');
      this.bossVis = want ? (this.bossVis || 0) | 1 : (this.bossVis || 0) & ~1; // 魚雷管的蓋子（foeAnimD1）
      if (g.rtsFxOk(this.pos) && this.rtsSancSeen()) g.fx.dust(this.pos.clone(), 2.2, 6, 0xa8c0c8);
    }
    // 自己的隊伍看到半透明（合併之後才改材質）
    const a = this.rtsSub && this.rtsTeam === ME ? 0.4 : 1;
    if (a !== sb.a && this.model.rtsMerged && this.applyCloak) {
      sb.a = a;
      this.applyCloak(a);
    }
    // 航跡（水面；只畫給看得到的）
    if (deep && this.vel && hyp(this.vel.x, this.vel.z) > 2 && R.t >= (sb.wakeT || 0)) {
      sb.wakeT = R.t + 0.25;
      const p = new THREE.Vector3(this.pos.x, w.theme.water.level + 0.05, this.pos.z);
      if (g.rtsFxOk(p) && (this.rtsTeam === ME || !this.fogHid)) g.fx.dust(p, 0.9, 2, 0xd8eef0);
    }
  },

  // ---------- 拾荒外殼機 ----------
  rtsSancShellTick() {
    const s = this.rtsSanc;
    const mx = this.rtsSancShellMax();
    if (mx !== s.shellMax) {
      s.shell = (s.shell * mx) / Math.max(1, s.shellMax);
      s.shellMax = mx;
    }
    const sh = this.model && this.model.shell;
    if (!sh) return;
    const k = Math.max(0, Math.min(1, s.shell / s.shellMax));
    if (Math.abs(k - (s.shellK === undefined ? -1 : s.shellK)) > 0.02) {
      s.shellK = k;
      sh.visible = k > 0.02;
      sh.scale.setScalar(0.45 + 0.55 * k);
      this.bossVis = Math.round(k * 15); // 一般任務的外殼顯示同樣讀 bossVis
    }
  },
  rtsSancAbsorb() {
    const g = this.game,
      s = this.rtsSanc;
    if (!s || s.shell === undefined || !g.rtsWreckAt) return false;
    const w = g.rtsWreckAt(this.pos.x, this.pos.z, ABSORB.r, { team: this.rtsTeam })[0];
    if (!w) return false;
    const res = g.rtsResLv(this.rtsTeam, 'r_hull') ? S.shell.takeRes : 1;
    const c = g.rtsWreckTake(w, S.shell.take * res);
    if (!(c.ore > 0)) return false;
    s.shell = Math.min(s.shellMax, s.shell + S.shell.gain * res);
    this.rtsSancSuck(w);
    return true;
  },
  // 吸殘骸的外觀：從殘骸飛過來的碎片
  rtsSancSuck(w) {
    const g = this.game;
    const p = new THREE.Vector3(w.x, (w.y || 0) + 0.5, w.z);
    if (!g.rtsFxOk(p) || !this.rtsSancSeen()) return;
    g.fx.dust(p, 2, 6, 0x8a6a50);
    g.fx.beam(p, this.center(), 0xffa070, 0.2);
    for (let i = 0; i < 4; i++) g.fx.spark(this.center(), 0xffb080);
  },

  // ---------- 拼裝巨像：廢鐵重組 ----------
  rtsSancRebuild() {
    const g = this.game;
    if (!g.rtsWreckAt) return false;
    let healed = 0;
    for (const w of g.rtsWreckAt(this.pos.x, this.pos.z, REBUILD.r, { team: this.rtsTeam })) {
      const need = Math.min(REBUILD.max - healed, this.maxHp - this.hp - healed) / REBUILD.k;
      if (need <= 0.5) break;
      const c = g.rtsWreckTake(w, Math.min(REBUILD.per, Math.ceil(need)));
      if (!(c.ore > 0)) continue;
      healed += c.ore * REBUILD.k;
      this.rtsSancSuck(w);
    }
    if (healed <= 0) return false;
    healed = Math.min(REBUILD.max, healed);
    this.hp = Math.min(this.maxHp, this.hp + healed);
    this.rtsSanc.rebuilt = (this.rtsSanc.rebuilt || 0) + healed;
    return true;
  },

  // ---------- 護盾產生器 ----------
  rtsSancDomeSet(st) {
    const g = this.game,
      Dm = this.rtsSanc.dome;
    Dm.st = st;
    Dm.t = st === 'deploying' ? S.dome.deploy : st === 'packing' ? DOME_PACK : 0;
    this.noPush = st !== 'up';
    if (st !== 'on' && Dm.rec) {
      g.rtsSancDomeDel(Dm.rec);
      Dm.rec = null;
    }
    if (st === 'on') {
      const res = g.rtsResLv(this.rtsTeam, 'r_canopy');
      Dm.rec = g.rtsSancDomeAdd(
        this.rtsTeam,
        this.pos.x,
        this.pos.z,
        S.dome.r,
        res ? S.dome.hpRes : S.dome.hp,
        {
          follow: this,
          src: this,
          regen: S.dome.regen,
          calm: S.dome.calm,
          recharge: res ? S.dome.rechargeRes : S.dome.recharge,
        },
      );
    }
  },
  rtsSancDomeTick(dt) {
    const Dm = this.rtsSanc.dome;
    if (Dm.st === 'deploying' || Dm.st === 'packing') {
      Dm.t -= dt;
      if (Dm.t <= 0) this.rtsSancDomeSet(Dm.st === 'deploying' ? 'on' : 'up');
      return true;
    }
    if (Dm.st !== 'on') return false;
    if (this.rtsSancDeployedOrders('ab_dome')) return true;
    if (Dm.rec) this.game.rtsSancDomeRegen(Dm.rec, dt);
    return true;
  },

  // 潛航砲艇的魚雷（mech-rts.js 的 rtsFire 在開火之後呼叫）：剛射出的火箭彈改成主線的魚雷彈體（kind 'torpedo'），
  // 傷害、範圍、攻擊類型照原本的；貼著水面（或地面、目標的高度）直線前進，到目標的位置還沒打中就在那裡爆炸
  rtsSancTorpedo(n0, t) {
    const g = this.game,
      P = g.projectiles,
      w = g.world;
    const wl = w.theme && w.theme.water ? w.theme.water.level : -1e9;
    for (let i = n0; i < P.length; i++) {
      const p = P[i];
      if (p.owner !== this || p.dead || p.kind === 'torpedo') continue;
      const y = Math.max(wl, w.terrainHeight(p.pos.x, p.pos.z), t.pos.y) + 0.8;
      const vx = t.pos.x - p.pos.x,
        vz = t.pos.z - p.pos.z;
      const L = Math.hypot(vx, vz);
      if (L < 0.5) continue;
      const sp = TORPEDO_V;
      g.scene.remove(p.mesh);
      p.kind = 'torpedo';
      p.pos.set(p.pos.x, y, p.pos.z);
      p.p0.copy(p.pos);
      p.vel.set((vx / L) * sp, 0, (vz / L) * sp);
      p.gravity = 0;
      p.target = null;
      p.turn = 0;
      p.bend = 0;
      p.life = L / sp + 0.15;
      p.mesh = buildProjectileMesh('torpedo', 0x9aff40, sp, g.fx && g.fx.projPart);
      p.mesh.position.copy(p.pos);
      g.scene.add(p.mesh);
      p.orient();
      if (g.rtsFxOk(p.pos)) g.fx.dust(p.pos.clone(), 1.2, 4, 0xb8dcf0);
    }
  },

  // ---------- 受傷（rts.js 的 rtsHook：相剋與護甲之後；回傳新的傷害） ----------
  rtsSancDefense(dmg, from, atk) {
    const g = this.game,
      R = g.rts;
    if (R && R.sancDomes && R.sancDomes.length && atk !== 'none') {
      dmg = g.rtsSancDomeAbsorb(this, dmg, from);
      if (dmg <= 0) return 0;
    }
    const s = this.rtsSanc;
    if (s && s.shell > 0) {
      const a = Math.min(s.shell, dmg * S.shell.absorb);
      s.shell -= a;
      dmg -= a;
      if (s.shell <= 0) {
        s.shell = 0;
        const c = this.center();
        if (g.rtsFxOk(c) && this.rtsSancSeen()) g.fx.explosion(c, 2.4, 0xc07040);
      }
    }
    return dmg;
  },

  // ---------- 拾荒 MT：撿零件（A 的 rtsSalvageOnDeath：12 m 內有單位死掉） ----------
  rtsSancNearDeath(e) {
    const g = this.game,
      D = RTS_DEFS[this.rtsDef];
    if (!D || !D.scav || this.dead || !e || e === this || e.bld || e.rtsIllus) return;
    if (hyp(e.pos.x - this.pos.x, e.pos.z - this.pos.z) > S.scav.r) return;
    const n = Math.min(S.scav.max, (this.rtsScavN || 0) + 1);
    if (n === this.rtsScavN) return;
    this.rtsScavN = n;
    g.rtsBuff(this, { src: 'scav', dmg: 1 + S.scav.dmg * n, hp: S.scav.hp * n }, 1e9);
    const c = this.center();
    if (g.rtsFxOk(c) && this.rtsSancSeen()) {
      g.fx.beam(e.center ? e.center() : c, c, 0xffb070, 0.15);
      g.fx.flash(c, 1, 0xffd090, 0.12);
    }
  },

  // ---------- 改裝的外加零件（A 的 rtsRefitApply 呼叫；零件已經建好、只切 visible） ----------
  rtsSancRefitFx(rf, prev) {
    const t0 = performance.now();
    const kits = this.model && this.model.rtsRefitKits;
    if (kits) {
      if (prev && kits[prev]) kits[prev].visible = false;
      if (rf && kits[rf]) kits[rf].visible = true;
    }
    const g = this.game;
    const c = this.center();
    if (g.rtsFxOk && g.rtsFxOk(c) && this.rtsSancSeen()) {
      g.fx.flash(c, 1.4, 0xffd090, 0.15);
      for (let i = 0; i < 5; i++) g.fx.spark(c, 0xffc080);
    }
    if (g.rts) g.rts.refitFxMs = performance.now() - t0;
  },
});

// ================= Game：殘骸、地雷、圓頂的外觀與判定 =================
Object.assign(Game.prototype, {
  // ---------- 殘骸（4 個 InstancedMesh；A 的 rtsWreck* 呼叫） ----------
  // 批次：掛在 fx 上（fx.add，每格的 fn 跑動畫；clearMission 的 fx.clear 會把它拿掉，之後重建）
  rtsSancWB() {
    let B = this._sancWB;
    if (B && B.group.parent === this.scene && B.R === (this.rts || null)) return B;
    if (B && B.group.parent) B.group.parent.remove(B.group);
    const bt = buildWreckBatch(WRECK_CAP);
    B = this._sancWB = {
      ...bt,
      R: this.rts || null,
      used: [
        new Uint8Array(WRECK_CAP),
        new Uint8Array(WRECK_CAP),
        new Uint8Array(WRECK_CAP),
        new Uint8Array(WRECK_CAP),
      ],
      top: [0, 0, 0, 0],
      live: new Set(),
      anim: new Set(),
      slowT: 0,
      dirty: [false, false, false, false],
      cdirty: [false, false, false, false],
    };
    this.fx.add(B.group, 1e9, (e, f, dt) => this.rtsSancWreckTick(dt || 0));
    return B;
  },
  rtsSancWreckFx(w, kind) {
    if (!w || w.map) return; // 地圖殘骸本身就是障礙物的模型（拆完外觀不變）
    const B = this.rtsSancWB();
    const t = now(this);
    const F = w.fx || (w.fx = { s: -1, i: -1, gone: false, delT: 0 });
    if (kind === 'del') {
      if (F.s < 0) return;
      F.gone = true;
      F.delT = t;
      B.anim.add(w);
    } else {
      if (F.gone) return;
      B.live.add(w);
      if (kind === 'add' && t < w.rise + WRECK_RISE) B.anim.add(w);
    }
    this.rtsSancWreckPlace(w, t);
  },
  // 放實例：大小、位置（冒出來、沉下去）、顏色；玩家沒看過的縮成 0
  rtsSancWreckPlace(w, t) {
    const B = this._sancWB;
    if (!B) return;
    const F = w.fx;
    const kn = w.known && w.known[ME];
    const size = Math.max(0, Math.min(3, kn && w.gone ? kn.size : w.size));
    if (F.s !== size) {
      if (F.s >= 0) this.rtsSancWreckFree(F);
      const used = B.used[size];
      let i = 0;
      while (i < B.cap && used[i]) i++;
      if (i >= B.cap) return; // 滿了：不畫
      used[i] = 1;
      F.s = size;
      F.i = i;
      if (i + 1 > B.top[size]) B.top[size] = i + 1;
      const m = B.meshes[size];
      m.count = B.top[size];
      m.visible = true;
      // 顏色：原本的隊伍色 30%＋鏽色
      const tc = RTS_TEAM_COLORS[w.team] !== undefined ? RTS_TEAM_COLORS[w.team] : 0x8a8070;
      _c.setHex(0xd2b49a).lerp(_c2.setHex(tc), 0.3);
      m.setColorAt(i, _c);
      B.cdirty[size] = true;
    }
    const m = B.meshes[size];
    const seen = !!(w.seen & (1 << ME));
    let sc = 0,
      dy = 0;
    if (seen) {
      const ore = w.gone && kn ? kn.ore : w.ore;
      sc = 0.4 + 0.6 * Math.max(0, Math.min(1, ore / Math.max(1, w.ore0 || ore || 1)));
      const h = [0.6, 0.9, 1.3, 2.2][size];
      if (w.rise > t) sc = 0;
      else if (t < w.rise + WRECK_RISE) {
        const f = (t - w.rise) / WRECK_RISE;
        dy = -(1 - f) * h;
        sc *= 0.5 + 0.5 * f;
      }
      if (F.gone) {
        const f = Math.min(1, (t - F.delT) / WRECK_DEL);
        dy -= f * h * 1.2;
        if (f >= 1) sc = 0;
      } else if (w.end !== undefined && w.end !== Infinity && t > w.end - W.sink)
        dy -= Math.min(1, (t - (w.end - W.sink)) / W.sink) * h * 1.1;
    }
    if (sc <= 0) m.setMatrixAt(F.i, ZERO_M);
    else {
      const id = typeof w.id === 'string' ? w.id.length * 7 + w.id.charCodeAt(w.id.length - 1) : 0;
      _q.setFromAxisAngle(_Y, (w.x * 13.7 + w.z * 7.3 + id) % 6.283 || 0);
      _p.set(w.x, (w.y || 0) + dy, w.z);
      _s.set(sc, sc, sc);
      _m4.compose(_p, _q, _s);
      m.setMatrixAt(F.i, _m4);
    }
    B.dirty[size] = true;
    F.sc = sc;
  },
  rtsSancWreckFree(F) {
    const B = this._sancWB;
    if (!B || F.s < 0) return;
    const s = F.s,
      m = B.meshes[s];
    m.setMatrixAt(F.i, ZERO_M);
    B.used[s][F.i] = 0;
    while (B.top[s] > 0 && !B.used[s][B.top[s] - 1]) B.top[s]--;
    m.count = B.top[s];
    m.visible = m.count > 0;
    B.dirty[s] = true;
    F.s = -1;
    F.i = -1;
  },
  // 每格（fx 的 fn；冒煙測試直接呼叫）：冒出來、拆完沉下去的動畫每格；壽命最後 30 秒沉下去每 0.25 秒
  rtsSancWreckTick(dt) {
    const B = this._sancWB;
    if (!B) return;
    const t = now(this);
    for (const w of B.anim) {
      const F = w.fx;
      if (!F || F.s < 0) {
        B.anim.delete(w);
        continue;
      }
      this.rtsSancWreckPlace(w, t);
      if (F.gone && t - F.delT >= WRECK_DEL) {
        this.rtsSancWreckFree(F);
        B.anim.delete(w);
        B.live.delete(w);
      } else if (!F.gone && t >= w.rise + WRECK_RISE) B.anim.delete(w);
    }
    B.slowT -= dt;
    if (B.slowT <= 0) {
      B.slowT = 0.25;
      for (const w of B.live) {
        const F = w.fx;
        if (!F || F.s < 0) {
          B.live.delete(w);
          continue;
        }
        if (!F.gone && w.end !== Infinity && t > w.end - W.sink) this.rtsSancWreckPlace(w, t);
      }
    }
    for (let s = 0; s < 4; s++) {
      if (B.dirty[s]) B.meshes[s].instanceMatrix.needsUpdate = true;
      if (B.cdirty[s] && B.meshes[s].instanceColor) B.meshes[s].instanceColor.needsUpdate = true;
      B.dirty[s] = B.cdirty[s] = false;
    }
  },
  // 殘骸的 draw call 數（冒煙測試、效能量測）：顯示中而且有實例的 InstancedMesh
  rtsSancWreckCalls() {
    const B = this._sancWB;
    if (!B) return 0;
    this.rtsSancWreckTick(0);
    return B.meshes.filter((m) => m.visible && m.count > 0 && m.parent).length;
  },

  // ---------- 地雷（一個 InstancedMesh；A 的 rtsLandMine* 呼叫） ----------
  rtsSancMB() {
    let B = this._sancMB;
    if (B && B.mesh.parent === this.scene && B.R === (this.rts || null)) return B;
    if (B && B.mesh.parent) B.mesh.parent.remove(B.mesh);
    const mesh = buildMineBatch(MINE_CAP);
    B = this._sancMB = {
      mesh,
      R: this.rts || null,
      used: new Uint8Array(MINE_CAP),
      top: 0,
      live: new Set(),
      t: 0,
    };
    this.fx.add(mesh, 1e9, (e, f, dt) => this.rtsSancMineTick(dt || 0));
    return B;
  },
  rtsSancMineFx(m, kind) {
    if (!m) return;
    const B = this.rtsSancMB();
    const F = m.fx || (m.fx = { i: -1 });
    if (kind === 'boom') {
      const p = new THREE.Vector3(m.x, (m.y || 0) + 0.5, m.z);
      if (this.rtsFxOk(p)) {
        this.fx.explosion(p, m.r || 3, 0xffa040, true);
        this.fx.dust(p, m.r || 3, 8, 0x8a7a60);
      }
    }
    if (kind === 'boom' || kind === 'del') {
      if (F.i >= 0) {
        B.mesh.setMatrixAt(F.i, ZERO_M);
        B.used[F.i] = 0;
        while (B.top > 0 && !B.used[B.top - 1]) B.top--;
        B.mesh.count = B.top;
        B.mesh.visible = B.top > 0;
        B.mesh.instanceMatrix.needsUpdate = true;
      }
      F.i = -1;
      B.live.delete(m);
      return;
    }
    if (F.i < 0) {
      let i = 0;
      while (i < MINE_CAP && B.used[i]) i++;
      if (i >= MINE_CAP) return;
      B.used[i] = 1;
      F.i = i;
      if (i + 1 > B.top) B.top = i + 1;
      B.mesh.count = B.top;
      B.mesh.visible = true;
      B.live.add(m);
    }
    this.rtsSancMinePlace(m);
  },
  // 自己的地雷一律畫；敵方的只畫看得到的（m.vis）；還沒啟動的暗一點
  rtsSancMinePlace(m) {
    const B = this._sancMB;
    const F = m.fx;
    if (!B || !F || F.i < 0) return;
    const show = m.team === ME || !!(m.vis & (1 << ME));
    if (!show) B.mesh.setMatrixAt(F.i, ZERO_M);
    else {
      _q.setFromAxisAngle(_Y, (m.x * 3.1 + m.z) % 6.283 || 0);
      _p.set(m.x, m.y || 0, m.z);
      _s.set(1, 1, 1);
      _m4.compose(_p, _q, _s);
      B.mesh.setMatrixAt(F.i, _m4);
    }
    const armed = !(this.rts && this.rts.t < m.armT);
    _c.setScalar(armed ? 1 : 0.55);
    if (m.team !== ME) _c.multiply(_c2.setHex(0xffd0c0));
    B.mesh.setColorAt(F.i, _c);
    F.armed = armed;
    F.show = show;
    B.mesh.instanceMatrix.needsUpdate = true;
    if (B.mesh.instanceColor) B.mesh.instanceColor.needsUpdate = true;
  },
  rtsSancMineTick(dt) {
    const B = this._sancMB;
    if (!B) return;
    B.t -= dt;
    if (B.t > 0) return;
    B.t = 0.25;
    const R = this.rts;
    for (const m of B.live) {
      if (m.dead) {
        B.live.delete(m);
        continue;
      }
      const armed = !(R && R.t < m.armT);
      if (m.fx && m.fx.armed !== armed) this.rtsSancMinePlace(m);
    }
  },

  // ---------- 圓頂（護盾產生器；C 包的避難護盾、最後的避難所也可以用） ----------
  // rec＝{ team, x, z, r, hp, max, follow（實體：跟著它）, end（局內時間，到了消失）, src, regen, calm, recharge, ... }
  rtsSancDomeAdd(team, x, z, r, hp, o = {}) {
    const R = this.rts;
    if (!R) return null;
    const L = R.sancDomes || (R.sancDomes = []);
    const rec = {
      id: 'dm' + (R.sancDomeN = (R.sancDomeN || 0) + 1),
      team,
      x,
      z,
      r,
      hp,
      max: hp,
      follow: o.follow || null,
      end: o.end || Infinity,
      src: o.src || null,
      regen: o.regen || 0,
      calm: o.calm || 5,
      recharge: o.recharge || 0,
      calmT: R.t,
      reT: 0,
      hitT: -9,
      absorbed: 0,
      dead: false,
    };
    L.push(rec);
    this.rtsSancDomeLook(rec);
    return rec;
  },
  rtsSancDomeDel(rec) {
    const R = this.rts;
    if (!rec || rec.dead) return;
    rec.dead = true;
    if (R && R.sancDomes) {
      const i = R.sancDomes.indexOf(rec);
      if (i >= 0) R.sancDomes.splice(i, 1);
    }
  },
  rtsSancDomeAt(rec) {
    const f = rec.follow;
    if (f && !f.dead) {
      rec.x = f.pos.x;
      rec.z = f.pos.z;
    }
    return rec;
  },
  // 5 秒沒被打每秒回 regen；打破後 recharge 秒重新展開（滿的）
  rtsSancDomeRegen(rec, dt) {
    const R = this.rts;
    if (!rec || rec.dead) return;
    if (rec.reT) {
      if (R.t >= rec.reT) {
        rec.reT = 0;
        rec.hp = rec.max;
        rec.calmT = R.t;
      }
      return;
    }
    if (rec.regen && rec.hp < rec.max && R.t - rec.calmT >= rec.calm)
      rec.hp = Math.min(rec.max, rec.hp + rec.regen * dt);
  },
  // 外面打進來的傷害由圓頂吸收：目標在圓頂裡、攻擊者在圓頂外（同主線 domeAbsorb 的規則）；回傳剩下的傷害
  rtsSancDomeAbsorb(t, dmg, from) {
    const R = this.rts;
    if (!from || !from.pos || !R.sancDomes) return dmg;
    for (let i = R.sancDomes.length - 1; i >= 0; i--) {
      const rec = R.sancDomes[i];
      if (rec.end <= R.t || (rec.follow && rec.follow.dead)) {
        this.rtsSancDomeDel(rec);
        continue;
      }
      if (rec.team !== t.rtsTeam || rec.reT || rec.hp <= 0) continue;
      this.rtsSancDomeAt(rec);
      const din = hyp(t.pos.x - rec.x, t.pos.z - rec.z);
      if (din > rec.r) continue;
      if (hyp(from.pos.x - rec.x, from.pos.z - rec.z) <= rec.r) continue;
      rec.calmT = R.t;
      rec.hitT = R.t;
      const a = Math.min(rec.hp, dmg);
      rec.hp -= a;
      rec.absorbed += a;
      dmg -= a;
      if (rec.hp <= 0) {
        rec.hp = 0;
        if (rec.recharge) rec.reT = R.t + rec.recharge;
        else this.rtsSancDomeDel(rec);
        const p = new THREE.Vector3(rec.x, this.world.terrainHeight(rec.x, rec.z) + 2, rec.z);
        if (this.rtsFxOk(p)) {
          this.fx.flash(p, rec.r * 0.8, 0x9fd8ff, 0.25);
          this.fx.ring(p, rec.r, 0x9fd8ff);
        }
      }
      if (dmg <= 0) return 0;
    }
    return dmg;
  },
  // 外觀：半透明的球（同主線 specialFx 的護盾），跟著實體；被打時亮一下、快破時變淡；看不到的敵方不畫
  rtsSancDomeLook(rec) {
    const fx = this.fx;
    const mat0 = new THREE.MeshBasicMaterial({
      color: rec.team === ME ? 0x8fd8ff : 0xffa080,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(fx.sphereGeo, mat0);
    mesh.castShadow = false;
    mesh.userData.sancDome = rec.id;
    rec.mesh = mesh;
    const g = this;
    fx.add(mesh, 1e9, (e) => {
      if (rec.dead || !g.rts) {
        e.life = 0;
        mesh.visible = false;
        return;
      }
      g.rtsSancDomeAt(rec);
      const T = g.rts.t;
      const y = g.world.terrainHeight(rec.x, rec.z);
      const r0 = (fx.sphereGeo.parameters && fx.sphereGeo.parameters.radius) || 1;
      mesh.position.set(rec.x, y, rec.z);
      mesh.scale.set(rec.r / r0, (rec.r * 0.75) / r0, rec.r / r0);
      const f = rec.follow;
      const seen =
        rec.team === ME || (f ? !f.fogHid : g.rtsFogState ? g.rtsFogState(ME, rec.x, rec.z) === 2 : true);
      mesh.visible = seen && !rec.reT && rec.hp > 0;
      const hit = Math.max(0, 1 - (T - rec.hitT) / 0.25);
      mat0.opacity = 0.1 + 0.1 * (rec.hp / rec.max) + 0.25 * hit;
    });
  },
});

void SANC_LAMP;
