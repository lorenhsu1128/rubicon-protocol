// Game 多人擴充：客機端出擊、快照套用、事件、輸入
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { angLerp, clamp, lerp } from '../core/math.js';
import { isBossLevel } from '../data/enemies.js';
import { partById } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { Projectile } from '../entities/projectile.js';
import { applyEnt } from '../net/snapshot.js';
import { PALETTES } from '../render/materials.js';
import { mechFlash } from '../render/mech-model.js';
import { RemoteSets } from '../render/net-models.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ----- 客機：開始任務 -----
  startMissionClient(d) {
    this.clearMission();
    this.isClient = true;
    this.lastClientTick = 0; // 開局後第一次更新重新起算房主失聯（clientTick）
    this.hostPace = d.pace || 1;
    if (d.pvp) {
      this.pvp = true;
      this.pvpType = d.pvp.type;
      this.pvpRule = d.pvp.rule;
      this.pvpTarget = d.pvp.target;
      this.pvpTime = 360;
    }
    this.worldSeed = d.seed;
    this.worldTheme = d.theme;
    this.styleRefresh();
    this.world = new World(this.scene, d.theme, d.seed, d.level, d.feat, { variant: d.variant });
    const T = this.world.theme;
    this.world.applyLight(this);
    this.players = [];
    this.enemies = [];
    this.allies = [];
    this.waves = [];
    this.missionT = 0;
    this.bosses = [];
    this.boss = null;
    this.missionEarned = 0;
    this.vehicles = [];
    this.pickups = [];
    this.vehPlan = [];
    this.bountyPops = [];
    this.isBossLevel = !d.pvp && isBossLevel(d.level);
    this.levelName =
      T.name + (this.world.featureNames.length ? '・' + this.world.featureNames.join('／') : '');
    this.bossDef = { name: d.bossName || '' };
    this.mpStats = {};
    this.net.spawnReg = {};
    for (const rec of d.spawns || []) this.clientSpawn({ e: rec });
    if (this.spectator) {
      this.player = this.players[0] || null;
      this.spectateIdx = 0;
      this.specDetail = !!this.specDetail;
    }
    this.net.lastHostMsg = performance.now();
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.flashMsg(
      (this.isBossLevel ? '決戰任務 ' : '任務 ') + String(d.level).padStart(2, '0') + ' — ' + T.name,
      0xffb020,
      2.2,
    );
    document.getElementById('bossBar').style.display = this.isBossLevel ? 'block' : 'none';
    if (this.isBossLevel) document.getElementById('bossName').textContent = d.bossName || '';
  },
  clientSpawn(d) {
    const r = d.e;
    if (this.entById(r.i)) return;
    this.net.spawnReg[r.i] = r;
    const pal = PALETTES[r.pal] || PALETTES.enemy;
    const opts = {
      team: r.team,
      name: r.name,
      scale: r.scale,
      isBoss: r.isBoss,
      ai: r.ai,
      flying: r.flying,
      hoverH: r.hoverH,
      modelKind: r.modelKind,
      vehKey: r.vehKey,
      cargo: r.cargo,
      parent: r.parent,
      mount: r.mount,
      partKind: r.partKind,
      radius: r.radius,
      turnRate: r.turnRate,
      hpMul: r.hpMul,
      dmgMul: r.dmgMul,
      stabMul: r.stabMul,
      explodeOnDeath: r.explodeOnDeath,
      extraWeapons: r.extraWeapons,
      allyDur: r.allyDur,
      palKey: r.pal,
      wantDist: r.wantDist,
      speedMul: r.speedMul,
      bossKind: r.bossKind,
      flankAngle: r.flankAngle,
      pvpTeam: r.pvpTeam,
      pvpAi: !!r.pvpAi,
      slot: r.slot,
      ms: r.ms || null,
      pilot: r.pm || null,
    };
    // 玩家的模型組還沒下載好：先用伺服器預設組，下載完再換（mp-models.js）
    if (r.ms) RemoteSets.load(r.ms);
    const e = new MechEntity(this, r.asm, pal, opts);
    e.id = r.i;
    e.remote = true;
    e.slot = r.slot;
    e.pvpAi = !!r.pvpAi;
    if (r.pvpTeam !== undefined && r.pvpTeam !== null) e.pvpTeam = r.pvpTeam;
    e.kills = 0;
    e.deaths = 0;
    e.isPlayer = r.team === 'player' && r.slot === this.net.me;
    e.pos.set(r.p[0], r.p[1], r.p[2]);
    e.mesh.position.copy(e.pos);
    e.prevYaw = e.yaw;
    if (r.extraWeapons) {
      for (const k in r.extraWeapons) {
        const def = partById('arm', r.extraWeapons[k]);
        e.weapons[k] = {
          def,
          ammo: def.ammo || 0,
          mag: def.mag || 0,
          cd: 0,
          reloadT: 0,
          charge: 0,
          charging: false,
          side: k[0] === 'r' ? 1 : -1,
          slot: k,
        };
      }
    }
    if (r.team === 'player') {
      this.players.push(e);
      if (e.isPlayer) {
        this.player = e;
        this.renderWeaponHud(true);
      }
      if (this.spectator && !this.player) {
        this.player = e;
      }
    } else if (r.team === 'ally') this.allies.push(e);
    else {
      this.enemies.push(e);
      if (r.isBoss) {
        if (!this.bosses) this.bosses = []; // 房主在開局訊息之前就廣播了生成紀錄（第一場任務時還沒有 bosses）
        this.bosses.push(e);
        this.boss = e;
      }
    }
  },
  clientApplySnapshot(s) {
    const st = s.k / 30; // 以房主快照序號當時間軸（去除網路抖動）
    if (this.snapClock === undefined || Math.abs(this.snapClock - (st - 0.1)) > 0.5)
      this.snapClock = st - 0.1;
    this.snapLatest = st;
    for (const es of s.ents) {
      let e = this.entById(es.i);
      if (!e) continue;
      e.snaps = e.snaps || [];
      e.snaps.push({ t: st, p: es.p, y: es.y, a: es.a, v: es.v });
      if (e.snaps.length > 12) e.snaps.shift();
      e.snapCur = e.snaps[e.snaps.length - 1];
      applyEnt(e, es, this);
      if (!e.isPlayer || e.downed || e.dead) {
        if (e.snaps.length === 1) {
          e.pos.set(es.p[0], es.p[1], es.p[2]);
          e.yaw = es.y;
          e.aimYaw = es.a;
        }
      } else {
        // 自己的機體：權威修正
        // 與「該快照對應時刻」的本地預測位置比較（補償往返延遲），差值以平滑偏移套用，避免拉回上一秒
        const lat = this.net.lat[this.net.hostPeer] || 30;
        const tAt = performance.now() - lat - 40;
        let hp = null;
        if (e.hist && e.hist.length) {
          hp = e.hist[0];
          for (const h of e.hist) {
            if (h.t <= tAt) hp = h;
            else break;
          }
        }
        const ref = hp ? hp.p : e.pos;
        const ex = es.p[0] - ref.x,
          ey = es.p[1] - ref.y,
          ez = es.p[2] - ref.z;
        const err = Math.hypot(ex, ez);
        if (err > 8) {
          e.pos.set(es.p[0], es.p[1], es.p[2]);
          e.corr = null;
          if (e.hist) e.hist.length = 0;
        } else if (err > 0.2 || Math.abs(ey) > 0.5) {
          e.corr = e.corr || new THREE.Vector3();
          e.corr.set(ex, ey, ez);
        }
      }
    }
    if (s.veh) {
      for (const ve of s.veh) this.clientMapEvent({ t: 'veh', i: ve.i, k: ve.k, d: ve.d, s: ve.s, h: ve.h });
      for (const v of this.vehicles) {
        if (!v.dead && !s.veh.find((x) => x.i === v.id)) {
          /* 等 vehGone/vehDie 事件 */
        }
      }
    }
    const m = s.mis;
    this.missionT = m.mt;
    if (this.pvp) this.pvpTime = m.pvpTime;
    this.mpStats = m.stats || this.mpStats;
    this.clientAlive = m.alive;
    this.clientWaves = m.waves;
    this.clientBoss = m.boss;
    for (const ev of s.ev) this.clientEvent(ev);
  },
  clientEvent(e) {
    if (this.clientMapEvent(e)) return;
    if (this.supportEvent(e)) return;
    switch (e.t) {
      case 'ebeam':
        {
          const ent = this.entById(e.e);
          if (ent && ent.weapons[e.o]) {
            this.fx.empBeam(
              ent.weapons[e.o],
              new THREE.Vector3(e.a[0], e.a[1], e.a[2]),
              new THREE.Vector3(e.b[0], e.b[1], e.b[2]),
              e.c,
            );
            ent.weapons[e.o].beamHideT = 0.12;
          }
        }
        break;
      case 'fx':
        {
          const f = this.fx;
          const a = e.a.map((v) =>
            Array.isArray(v) && v.length === 3 && v.__v !== false ? new THREE.Vector3(v[0], v[1], v[2]) : v,
          );
          if (e.n === 'explosion' && a[0])
            this.rumbleAt(a[0], a[3] ? 0.9 : 0.5, 0.4, a[3] ? 260 : 150, (a[1] || 3) * 4 + 14);
          try {
            f[e.n].apply(f, a);
          } catch (x) {}
        }
        break;
      case 'sfx':
        SFX.play(e.k, e.v, e.r, 0.06, 0.03, e.p ? new THREE.Vector3(e.p[0], e.p[1], e.p[2]) : null);
        break;
      case 'proj':
        {
          const tgt = e.tg >= 0 ? this.entById(e.tg) : null;
          const p = new Projectile(this, {
            pos: new THREE.Vector3(e.p[0], e.p[1], e.p[2]),
            vel: new THREE.Vector3(e.v[0], e.v[1], e.v[2]),
            kind: e.k,
            dmg: 0,
            impactV: 0,
            team: e.tm,
            owner: null,
            color: e.c,
            life: e.l,
            splash: e.s || 0,
            gravity: e.g || 0,
            target: tgt,
            turn: e.tn || 0,
            visual: true,
            netId: e.i,
          });
          this.projectiles.push(p);
        }
        break;
      case 'pend':
        {
          const i = this.projectiles.findIndex((p) => p.netId === e.i);
          if (i >= 0) {
            this.scene.remove(this.projectiles[i].mesh);
            this.projectiles.splice(i, 1);
          }
        }
        break;
      case 'pop':
        {
          const tgt = this.entById(e.i);
          this.popDamage(
            new THREE.Vector3(e.p[0], e.p[1], e.p[2]),
            e.v,
            !!(tgt && tgt.isPlayer),
            e.s,
            e.m,
            e.c,
          );
          if (tgt && tgt.isPlayer) {
            this.camShake = Math.max(this.camShake, clamp(e.im / 1500, 0.06, 0.3));
            this.rumble(clamp(e.im / 700, 0.2, 1), clamp(e.im / 400, 0.3, 1), clamp(e.im / 4, 60, 260));
          }
          if (tgt) mechFlash(tgt.model, e.m ? 0xff7a30 : undefined, e.m ? 0.16 : 0.07);
        }
        break;
      case 'msg':
        this.flashMsg(e.txt, e.c, e.d || 1.6);
        break;
      case 'alert':
        this.flashAlert(e.txt);
        break;
      case 'bounty':
        this.save.coam += e.v;
        this.missionEarned = (this.missionEarned || 0) + e.v;
        this.save.kills++;
        this.writeSave();
        this.bountyPops.push({ txt: '+' + e.v.toLocaleString() + ' COAM', life: 2.2, y: 0 });
        break;
      case 'shock':
        this.shockFx(new THREE.Vector3(e.p[0], e.p[1], e.p[2]), e.R, e.sp, e.dl);
        break;
      case 'stag':
        {
          const t = this.entById(e.i);
          if (t && t.isPlayer) {
            this.flashAlert('ACS 過載 — 姿態崩潰');
            this.rumble(1, 1, 600);
          }
        }
        break;
      case 'shake':
        this.camShake = Math.max(this.camShake, e.v);
        break;
      case 'respawn':
        {
          const t = this.entById(e.i);
          if (t) {
            t.respawnAt(new THREE.Vector3(e.p[0], e.p[1], e.p[2]));
            t.snaps = [];
          }
        }
        break;
      case 'kills':
        this.save.kills = Math.max(this.save.kills, this.save.kills);
        break;
    }
  },
  clientTick(dt) {
    const n = this.net;
    if (this.spectator) {
      const alive = this.fp ? this.spectateList() : this.players.filter((x) => !x.dead);
      if (alive.length && this.specMode !== 'boss') {
        this.player = alive[this.spectateIdx % alive.length];
      }
    }
    // 本機卡住（開局建地圖與模型、編譯著色器）的時間不算房主失聯：這段期間房主的訊息還排在後面沒處理，
    // 卡住超過 1 秒（含開局後第一次更新）就重新起算
    const now = performance.now();
    if (!this.lastClientTick || now - this.lastClientTick > 1000)
      n.lastHostMsg = Math.max(n.lastHostMsg, now);
    this.lastClientTick = now;
    const p = this.player;
    if (!p) return;
    if (this.spectator) {
      if (performance.now() - n.lastHostMsg > 4000 && !n.migrating) n.hostLost();
    }
    // 房主失聯偵測
    if (!this.spectator && performance.now() - n.lastHostMsg > 3000 && !n.migrating) n.hostLost();
    // 本地輸入 → 送出 + 預測
    if (this.spectator) {
      /* 觀戰：不送輸入 */
    } else if (!p.dead && !p.downed) {
      const inp = this.buildLocalInput(dt);
      n.sendInput(inp);
    } else if (p.downed) {
      n.sendInput({ t: 'in', mv: [0, 0], aim: [p.pos.x, p.pos.y, p.pos.z - 10], b: 0, lock: -1 });
    }
    // 插值其他實體
    // 插值時鐘：以固定速率前進，緩慢校正到「最新快照 − 80 ms」，避免快照到達抖動造成一格一格
    if (this.snapClock !== undefined) {
      this.snapClock += dt;
      const target = (this.snapLatest || 0) - 0.08;
      const err = target - this.snapClock;
      if (Math.abs(err) > 0.4) this.snapClock = target;
      else this.snapClock += err * Math.min(1, dt * 2);
    }
    const rt = this.snapClock || 0;
    for (const e of [...this.players, ...this.enemies, ...this.allies]) {
      if (e.dead) continue;
      if (e.isPlayer && !e.downed && !this.spectator) {
        continue;
      }
      const S = e.snaps;
      if (S && S.length) {
        let a = null,
          b = null;
        for (let i = S.length - 1; i >= 0; i--) {
          if (S[i].t <= rt) {
            a = S[i];
            b = S[i + 1] || null;
            break;
          }
        }
        if (!a) {
          a = S[0];
          b = S[1] || null;
        }
        if (a && b && b.t > a.t) {
          const k = clamp((rt - a.t) / (b.t - a.t), 0, 1);
          e.pos.set(lerp(a.p[0], b.p[0], k), lerp(a.p[1], b.p[1], k), lerp(a.p[2], b.p[2], k));
          e.yaw = angLerp(a.y, b.y, k);
          e.aimYaw = angLerp(a.a, b.a, k);
          e.vel.set(b.v[0], b.v[1], b.v[2]);
        } else if (a) {
          const ex = clamp(rt - a.t, 0, 0.12);
          e.pos.set(a.p[0] + a.v[0] * ex, a.p[1] + a.v[1] * ex, a.p[2] + a.v[2] * ex);
          e.yaw = a.y;
          e.aimYaw = a.a;
          e.vel.set(a.v[0], a.v[1], a.v[2]);
        }
      } // 超出最新快照：以速度外推最多 120 ms
      e.remoteUpdate(dt);
    }
    if ((p.downed || p.dead) && !this.spectator) p.remoteUpdate(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.update(dt);
      if (pr.dead) this.projectiles.splice(i, 1);
    }
  },
  buildLocalInput(dt) {
    const p = this.player;
    if (!p) return { t: 'in', mv: [0, 0], aim: [0, 0, 0], b: 0, lock: -1 };
    this.applySmartAttack(p, dt); // 與 updatePlayer 相同的瞄準／移動計算，但不開火、不判定，只送輸入並做本地預測
    if (this.fp) {
      if (this.padAim && this.padAim.lengthSq() > 0.09) {
        this.fpYaw -= this.padAim.x * dt * 2.6 * (this.ctrl.sens || 1);
        this.fpPitch = clamp(this.fpPitch - this.padAim.z * dt * 1.8 * (this.ctrl.sens || 1), -1.1, 0.9);
      }
      const look = this.fpLookDir(this.fpYaw, this.fpPitch);
      this.mouseWorld.copy(this.fpEye(p)).addScaledVector(look, 40);
      this.autoLock(p);
      p.fpFace = true;
    } else {
      p.fpFace = false;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2((this.mouse.x / innerWidth) * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1),
        this.camera,
      );
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(p.pos.y + p.model.height * 0.5));
      ray.ray.intersectPlane(plane, this.mouseWorld) || this.mouseWorld.set(p.pos.x, p.pos.y, p.pos.z - 10);
      this.autoLock(p);
    }
    if (this.touchActive) {
      this.padActive = true;
      if (!p.lock) {
        const dir =
          this.touchMove && this.touchMove.lengthSq() > 0.02
            ? this.touchMove.clone().normalize()
            : new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
        this.mouseWorld.copy(p.center()).addScaledVector(dir, 20);
      }
    } else if (this.padAim && this.padAim.lengthSq() > 0.09) {
      this.mouseWorld.copy(p.center()).addScaledVector(this.padAim.clone().normalize(), 24);
      this.padAimT = 0.4;
    } else if (this.padAimT > 0) {
      this.padAimT -= dt;
    } else if (this.padActive && !p.lock) {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      this.mouseWorld.copy(p.center()).addScaledVector(fwd, 20);
    }
    if (this.ctrl.aim === 'auto' && !p.lock) {
      const fwd = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
      this.mouseWorld.copy(p.center()).addScaledVector(fwd, 20);
    }
    const aimR = this.reticlePoint(p);
    this.aimRet = aimR;
    let aimPos = this.mouseWorld.clone();
    if (p.lock) {
      const d = p.lock.pos.distanceTo(p.pos);
      if (d < p.stats.lockRange) {
        aimPos = p.lock.center().addScaledVector(p.lock.vel, clamp(d / 95, 0, 0.9));
      }
    }
    p.setAim(aimPos);
    let wish = new THREE.Vector3(
      (this.act('right') ? 1 : 0) - (this.act('left') ? 1 : 0),
      0,
      (this.act('down') ? 1 : 0) - (this.act('up') ? 1 : 0),
    );
    if (wish.lengthSq() > 0) wish.normalize();
    if (this.padMove && this.padMove.lengthSq() > 0.04) {
      wish.copy(this.padMove);
      if (wish.length() > 1) wish.normalize();
    }
    if (this.touchMove && this.touchMove.lengthSq() > 0.02) {
      wish.copy(this.touchMove);
      if (wish.length() > 1) wish.normalize();
    }
    if ((this.ctrl.moveRel === 'mech' || this.fp) && wish.lengthSq() > 0) {
      const yy = this.fp ? this.fpYaw : p.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yy), 0, -Math.cos(yy)),
        right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      wish = fwd.multiplyScalar(-wish.z).add(right.multiplyScalar(wish.x)).normalize();
    }
    const qbHeld = this.act('qb');
    const qbEdge = qbHeld && !this._qbPrev;
    this._qbPrev = qbHeld;
    if (!p.melee.active) p.move(dt, wish, this.act('jump'), qbEdge, this.act('ab'), p.lock);
    else p.remoteUpdate(dt); // 預測（近戰中由主機主導）
    this.separateMechs(dt, [p, ...this.enemies, ...this.allies, ...this.players.filter((x) => x !== p)]);
    if (p.corr) {
      const k = Math.min(1, dt * 6);
      const dx = p.corr.x * k,
        dy = p.corr.y * k,
        dz = p.corr.z * k;
      p.pos.x += dx;
      p.pos.y += dy;
      p.pos.z += dz;
      p.corr.x -= dx;
      p.corr.y -= dy;
      p.corr.z -= dz;
      if (p.corr.lengthSq() < 0.0004) p.corr = null;
      if (p.hist)
        for (const h of p.hist) {
          h.p.x += dx;
          h.p.y += dy;
          h.p.z += dz;
        }
    }
    p.hist = p.hist || [];
    p.hist.push({ t: performance.now(), p: p.pos.clone() });
    if (p.hist.length > 90) p.hist.shift();
    let b = 0;
    if (this.act('fireR')) b |= 1;
    if (this.act('fireL')) b |= 2;
    if (this.act('backL')) b |= 4;
    if (this.act('backR')) b |= 8;
    const jHeld = this.act('jump');
    if (jHeld) b |= 16;
    if (jHeld && !this._jPrev) this._jc = ((this._jc || 0) + 1) & 255; // 按下次數：短按不會在兩次輸入之間漏掉
    this._jPrev = jHeld;
    if (qbHeld) b |= 32;
    if (this.act('ab')) b |= 64;
    const cs = [this.save.asm.c1, this.save.asm.c2].map((id) => ((this.save.items[id] || 0) > 0 ? id : null));
    return {
      t: 'in',
      fp: this.fp ? 1 : 0,
      mv: [+wish.x.toFixed(3), +wish.z.toFixed(3)],
      aim: [+aimPos.x.toFixed(2), +aimPos.y.toFixed(2), +aimPos.z.toFixed(2)],
      aimR: [+aimR.x.toFixed(2), +aimR.y.toFixed(2), +aimR.z.toFixed(2)],
      b,
      jc: this._jc || 0,
      lock: p.lock ? p.lock.id : -1,
      kit: this.kitPressed ? 1 : 0,
      cs1: this.cs1Pressed ? 1 : 0,
      cs2: this.cs2Pressed ? 1 : 0,
      csIds: cs,
    };
  },
  clientEnd(d) {
    this.state = 'result';
    const $ = (id) => document.getElementById(id);
    // 駕駛員經驗與熟練度由房主計算，各自寫入自己的存檔
    this.pilotRenderResult(this.pilotGrant(d.pvp ? 'pvp' : 'pve', d.xpBySlot && d.xpBySlot[this.net.me]));
    if (d.pvp) {
      const bonus = (d.bonusBySlot && d.bonusBySlot[this.net.me]) || 0;
      this.save.coam += bonus;
      this.writeSave();
      $('rTitle').textContent = '對戰結束 — ' + d.label;
      $('rRank').textContent = (d.winners || []).includes(this.net.me) ? 'WIN' : 'LOSE';
      $('resultGrid').innerHTML =
        d.rows.map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`).join('') +
        `<span class="dim">本場獎勵</span><span>+${bonus.toLocaleString()}</span><span class="dim">COAM 結餘</span><span>${this.save.coam.toLocaleString()}</span>`;
      $('btnResultOk').textContent = '返回大廳';
      this.clearMission();
      this.showScreen('result');
      return;
    }
    $('rTitle').textContent = d.title;
    $('rRank').textContent = d.rank;
    if (d.success) {
      d.bonus = Math.round(d.bonus * (1 + (this.player ? this.player.pmv('coam') : 0))); // 自己的「報酬交涉」
      this.save.coam += d.bonus;
      this.writeSave();
    }
    $('resultGrid').innerHTML =
      d.rows.map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`).join('') +
      `<span class="dim">COAM 結餘</span><span>${this.save.coam.toLocaleString()}</span>`;
    $('btnResultOk').textContent = '返回大廳';
    this.showScreen('result');
  },
});
