// Game 多人擴充：房主端同步、救援、掉線與房主遷移
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { CONSUMABLES, START_ASM } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { serEnt } from '../net/snapshot.js';
import { PLAYER_PALS } from '../net/transports.js';
import { PALETTES } from '../render/materials.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ----- 房主：多人版出擊 -----
  mpSpawnPlayers() {
    const n = this.net;
    this.players = [];
    const online = n.players.filter((p) => p.online);
    online.forEach((pl, i) => {
      const a = (Math.PI * 2 * i) / Math.max(1, online.length);
      const x = Math.cos(a) * 4,
        z = Math.sin(a) * 4;
      const e = new MechEntity(this, pl.asm || START_ASM, PALETTES[PLAYER_PALS[pl.color]], {
        team: 'player',
        name: pl.nick,
        palKey: PLAYER_PALS[pl.color],
        slot: pl.slot,
        ms: pl.ms || null,
        pilot: this.pilotModsForPlayer(pl, 'pve'),
      });
      e.slot = pl.slot;
      e.isPlayer = pl.slot === n.me;
      e.pos.set(x, this.world.terrainHeight(x, z), z);
      e.mesh.position.copy(e.pos);
      this.players.push(e);
      this.registerSpawn(e);
      if (e.isPlayer) this.player = e;
    });
  },
  registerSpawn(e) {
    const o = e.opts || {};
    const rec = {
      i: e.id,
      asm: e.asm,
      pal: o.palKey || e.palKey || 'enemy',
      scale: e.scale,
      name: e.name,
      team: e.team,
      isBoss: !!e.isBoss,
      ai: e.ai || null,
      flying: !!e.flying,
      hoverH: e.hoverH,
      modelKind: o.modelKind || null,
      vehKey: o.vehKey || null,
      cargo: o.cargo || null,
      parent: o.parent !== undefined ? o.parent : null, // Boss 的附屬部位
      mount: o.mount !== undefined ? o.mount : null,
      partKind: o.partKind || null,
      radius: o.radius || null,
      turnRate: e.turnRate,
      hpMul: o.hpMul || 1,
      dmgMul: o.dmgMul || 1,
      stabMul: o.stabMul || 1,
      explodeOnDeath: o.explodeOnDeath || null,
      extraWeapons: o.extraWeapons || null,
      allyDur: e.allyT || 0,
      slot: e.slot !== undefined ? e.slot : -1,
      wantDist: o.wantDist || 22,
      speedMul: o.speedMul || 1,
      bossKind: o.bossKind || null,
      flankAngle: o.flankAngle || 0,
      pvpTeam: e.pvpTeam,
      pvpAi: !!e.pvpAi,
      pm: e.pm || null, // 駕駛員加成：客機的 HUD 上限與自身移動預測需要
      ms: o.ms || null, // 玩家機甲的模型組（伺服器上的內容雜湊）
      p: [e.pos.x, e.pos.y, e.pos.z],
    };
    this.net.spawnReg[e.id] = rec;
    if (this.net.role === 'host') this.net.tr.broadcast({ t: 'spawn', e: rec });
  },
  playersAlive() {
    return (this.players && this.players.length ? this.players : [this.player]).filter((p) => p && !p.dead);
  },
  entById(id) {
    if (this.player && this.player.id === id) return this.player;
    return (
      (this.players || []).find((e) => e.id === id) ||
      this.enemies.find((e) => e.id === id) ||
      this.allies.find((e) => e.id === id) ||
      null
    );
  },
  // ----- 房主每幀 -----
  hostTick(dt) {
    const n = this.net; // 套用遠端輸入
    for (const e of this.players) {
      if (e.isPlayer) continue;
      const pl = n.playerBySlot(e.slot);
      if (!pl || !pl.online) {
        if (!e.aiControlled) {
          e.aiControlled = true;
          e.ai = 'ac';
          e.jumpExt = false;
        }
        continue;
      }
      const inp = n.inputs[e.slot];
      if (!inp || e.dead || e.downed) {
        e.move(dt, new THREE.Vector3(), false, false, false, null);
        continue;
      }
      const wish = new THREE.Vector3(inp.mv[0], 0, inp.mv[1]);
      const aimPos = new THREE.Vector3(inp.aim[0], inp.aim[1], inp.aim[2]);
      const lockEnt = inp.lock >= 0 ? this.entById(inp.lock) : null;
      if (lockEnt && !lockEnt.dead && this.isHostile(e, lockEnt)) e.lock = lockEnt;
      else if (inp.lock < 0) e.lock = null;
      const b = inp.b;
      let ap0 = aimPos,
        ae0 = null;
      if (e.lock && !e.lock.dead && e.lock.pos.distanceTo(e.pos) < e.stats.lockRange) {
        const d = e.lock.pos.distanceTo(e.pos);
        ap0 = e.lock.center().addScaledVector(e.lock.vel, clamp(d / 95, 0, 0.9));
        ae0 = e.lock;
      }
      e.setAim(ap0);
      e.fpFace = !!inp.fp;
      const qb = !!(b & 32) && !e._qbHeld;
      e._qbHeld = !!(b & 32);
      // 跳躍的按下以次數判斷（客機每次按下加 1），不從按住狀態推算
      e.jumpExt = true;
      if (e._jc !== undefined && inp.jc !== e._jc) e.jumpPressQ = true;
      e._jc = inp.jc;
      e.move(dt, wish, !!(b & 16), qb, !!(b & 64), e.lock);
      const aimRv = inp.aimR ? new THREE.Vector3(inp.aimR[0], inp.aimR[1], inp.aimR[2]) : null;
      const fs = (slot, held, edgeKey) => {
        const w = e.weapons[slot];
        const isBeam = w.def.type === 'laser' || w.def.type === 'empbeam';
        let ap = ap0,
          ae = ae0;
        if (isBeam) {
          if (inp.fp && aimRv) {
            ap = aimRv;
            ae = null;
          } else if (e.lock && !e.lock.dead && e.lock.pos.distanceTo(e.pos) < e.stats.lockRange) {
            ap = e.lock.center();
            ae = e.lock;
          } else if (aimRv) {
            ap = aimRv;
            ae = null;
          }
        }
        if (w.def.type === 'melee') {
          if (held && !e[edgeKey]) e.fire(slot, ap, ae);
          e[edgeKey] = held;
          return;
        }
        if (w.def.type === 'laser' && w.def.chargeT > 0) {
          if (held) {
            if (w.cd <= 0) {
              w.charging = true;
              w.charge = Math.min(w.charge + dt, w.def.chargeT + 0.05);
            }
          } else if (w.charging) e.fire(slot, ap, ae);
          return;
        }
        if (held) e.fire(slot, ap, ae);
      };
      fs('rarm', !!(b & 1), '_fr');
      fs('larm', !!(b & 2), '_fl');
      fs('lback', !!(b & 4), '_bl');
      fs('rback', !!(b & 8), '_br');
      if (inp.kit && !e._kit) {
        if (!this.tryRevive(e, dt)) this.useKitFor(e);
      }
      e._kit = !!inp.kit;
      if (inp.cs1 && !e._c1) this.useConsumableFor(e, 'c1', inp.csIds && inp.csIds[0]);
      e._c1 = !!inp.cs1;
      if (inp.cs2 && !e._c2) this.useConsumableFor(e, 'c2', inp.csIds && inp.csIds[1]);
      e._c2 = !!inp.cs2;
    }
    for (const e of this.players) {
      if (e.aiControlled && !e.dead && !e.isPlayer) e.updateAI(dt);
      if (e.downed) {
        e.downT -= dt;
        if (e.downT <= 0) e.die(null);
      }
    }
    // 快照 30 Hz
    this.snapAcc += dt;
    if (this.snapAcc >= 1 / 30) {
      this.snapAcc = 0;
      const ents = [];
      for (const e of [...this.players, ...this.enemies, ...this.allies]) ents.push(serEnt(e));
      const snap = {
        t: 's',
        k: ++n.tick,
        ents,
        veh: this.serVehicles(),
        mis: {
          alive: this.enemies.filter((e) => !e.dead).length,
          waves: this.waves.length,
          mt: +this.missionT.toFixed(1),
          level: this.save.level,
          boss:
            this.bosses && this.bosses.length
              ? [
                  this.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0),
                  this.bosses.reduce((a, b) => a + b.maxHp, 0),
                  this.bossDef.name,
                ]
              : 0,
          earned: this.missionEarned || 0,
          seed: this.worldSeed,
          theme: this.worldTheme,
          variant: this.world.variantKey,
          feat: this.world.features.map((f) => ({
            k: f.k,
            kind: f.kind,
            dir: f.dir ? [f.dir.x, f.dir.y] : 0,
            perp: f.perp ? [f.perp.x, f.perp.y] : 0,
            off: f.off,
            width: f.width,
            depth: f.depth,
            bridges: f.bridges,
            deckW: f.deckW,
            center: f.center,
            span: f.span,
            rampL: f.rampL,
            deckH: f.deckH,
            count: f.count,
            len: f.len,
            bend: f.bend,
          })),
          bossLevel: this.isBossLevel,
          stats: this.mpStats,
          pvpTime: this.pvp ? +this.pvpTime.toFixed(1) : 0,
          scaleHp: this.scaleHp,
          scaleDmg: this.scaleDmg,
          waveList: this.waves,
        },
        ev: this.netEvents,
      };
      this.netEvents = [];
      n.tr.broadcast(snap);
      n.lastSnap = snap;
    }
  },
  netEv(e) {
    if (this.net && this.net.role === 'host') this.netEvents.push(e);
  },
  useKitFor(p) {
    if (p.kits <= 0 || p.hp >= p.maxHp || p.dead || p.downed) return;
    p.kits--;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * p.kitHeal));
    p.en = Math.min(p.enMax, p.en + p.enMax * p.pmv('kitEn'));
    this.fx.ring(p.center(), 5, 0x7ee081);
    SFX.kit();
  },
  useConsumableFor(p, slot, id) {
    if (!id || p.dead || p.downed) return;
    const def = CONSUMABLES.find((c) => c.id === id);
    if (!def) return;
    const saveP = this.player;
    this.player = p;
    if (id === 'cs_bomber') {
      if (!this.bomberActive) this.callBomber();
    } else if (id === 'cs_ally') {
      if (this.allies.filter((a) => !a.dead).length < 2) this.callAlly(def);
    }
    this.player = saveP;
  },
  // ----- 救援 -----
  tryRevive(rescuer, dt) {
    if (rescuer.dead || rescuer.downed) return false;
    const t = this.players.find(
      (p) => p !== rescuer && p.downed && !p.dead && p.pos.distanceTo(rescuer.pos) < 5,
    );
    if (!t) return false;
    {
      t.downed = false;
      t.hp = Math.round(t.maxHp * (0.4 + rescuer.pmv('reviveHp')));
      t.acs = 0;
      t.staggerT = 0;
      t.iFrames = 2;
      this.fx.ring(t.center(), 6, 0x7ee081);
      SFX.kit();
      this.flashMsg(`${rescuer.name} 救起了 ${t.name}`, 0x7ee081, 2);
      this.netEv({ t: 'msg', txt: `${rescuer.name} 救起了 ${t.name}`, c: 0x7ee081 });
      if (this.mpStats && this.mpStats[rescuer.slot]) this.mpStats[rescuer.slot].rev++;
      this.pilotCreditRevive(rescuer);
      return true;
    }
  },
  // ----- 房主／客機共用：玩家離線 -----
  playerWentOffline(pl) {
    const e = this.players.find((x) => x.slot === pl.slot);
    if (e && !e.dead) {
      e.aiControlled = true;
      e.ai = 'ac';
      e.name = pl.nick + ' (AI)';
      this.flashMsg(`${pl.nick} 離線，機體由 AI 接管`, 0xffb020, 2.5);
      this.netEv({ t: 'msg', txt: `${pl.nick} 離線，機體由 AI 接管`, c: 0xffb020 });
    }
  },
  hostRejoinInMission(pl) {
    const e = this.players.find((x) => x.slot === pl.slot);
    this.net.sendMissionState(pl.peerId, true);
    if (e) {
      e.aiControlled = false;
      e.ai = null;
      e.name = pl.nick;
    }
  },
  // ----- 主機遷移（客機升格） -----
  promoteToHost(oldHostSlot) {
    const n = this.net; // 已有的實體與最後快照即為權威狀態
    for (const e of [...this.players, ...this.enemies, ...this.allies]) {
      e.remote = false;
      e.aiState = e.aiState || {};
      if (e.team === 'enemy' || e.team === 'ally') {
        e.aiState = {
          strafe: 1,
          timer: 0,
          qbT: 0,
          jumpT: 0,
          want: e.opts.wantDist || 22,
          fireT: 0,
          pattern: 0,
          patT: 0,
          phase: e.aiState.phase || 1,
          stuck: 0,
        };
      }
    }
    const old = this.players.find((p) => p.slot === oldHostSlot);
    if (old && !old.dead) {
      old.aiControlled = true;
      old.ai = 'ac';
      old.name = old.name + ' (AI)';
    }
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    this.shocks = [];
    this.promoteSupport();
    this.clearHazards(); // 延遲中的攻擊與燃燒地面只在舊房主上，交接後放棄
    const s = this.net.snap;
    if (s) {
      this.waves = s.mis.waveList || [];
      this.missionT = s.mis.mt;
      this.scaleHp = s.mis.scaleHp;
      this.scaleDmg = s.mis.scaleDmg;
      this.mpStats = s.mis.stats || this.mpStats;
      this.missionEarned = s.mis.earned;
    }
    this.bosses = this.enemies.filter((e) => e.isBoss);
    this.boss = this.bosses[0] || null;
    this.isClient = false;
    this.vehPlan = [];
    this.flashMsg('你已成為房主', 0xffb020, 2);
  },
});
