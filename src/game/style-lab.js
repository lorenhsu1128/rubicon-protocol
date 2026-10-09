// Game：渲染風格實驗室（標題的「渲染風格」）：兩隊機甲不停交戰的模擬戰場＋風格參數即時調整。
// 不寫存檔、不給經驗；可以觀看（全部由電腦操作，四種鏡頭）或自己操作一台。風格只在這裡調，
// 「套用到遊戲」後下次出擊／進車庫才生效（任務中不換）。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp, rnd } from '../core/math.js';
import { AC_ROSTER, ENEMY_TYPES } from '../data/enemies.js';
import { partById } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { animateMech, buildMech } from '../render/mech-model.js';
import { IK, IK_ITEMS, setIK } from '../render/mech-ik.js';
import { STYLE_GROUPS, STYLE_ITEMS, normalizeStyle } from '../render/style/params.js';
import { StyleStore } from '../render/style/store.js';
import { THEMES, World } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const ROSTER = Object.keys(AC_ROSTER);
const CAMS = [
  ['cinema', '電影（自動環繞、切換目標）'],
  ['follow', '跟隨（機體後方）'],
  ['free', '自由（拖曳旋轉、右鍵平移、滾輪縮放、WASD 移動）'],
  ['show', '展示台（單台機甲慢慢轉）'],
];
const STRUCT = new Set(['toneMap', 'shadowType']); // 改了要重新編譯材質

Object.assign(Game.prototype, {
  // ---------- 進入／離開 ----------
  async openLab() {
    if (this.net && this.net.role) return;
    SFX.init();
    this.clearMission();
    const d = StyleStore.data;
    const P = StyleStore.current();
    this.lab = {
      P,
      orig: { ...P },
      src: { ...d.sel },
      dirty: false,
      mode: 'watch',
      cam: 'cinema',
      tgt: null,
      tgtT: 0,
      speed: 1,
      paused: false,
      cmpSel: '',
      cmp: null,
      split: 0.5,
      theme: 'desert',
      seed: 20250,
      teams: 3,
      extras: true,
      free: { yaw: 0.6, pitch: 0.5, dist: 34, pivot: new THREE.Vector3() },
      cin: { a: 0, r: 15, h: 5 },
      look: new THREE.Vector3(),
      showA: 0,
      show: null,
      t: 0,
      refillT: 0,
      hold: false,
      panel: true,
      fpsT: 0,
      frames: 0,
      cmpArg: () => ({ P: this.lab.cmp, split: this.lab.split }),
    };
    try {
      await this.lmRefresh();
    } catch (e) {}
    this.labBuildUi();
    this.labStart();
    if (StyleStore.serverOn)
      StyleStore.fetchServer()
        .then(() => this.lab && this.labRenderChoices())
        .catch(() => {});
  },
  exitLab() {
    if (!this.lab) return;
    if (this.lab.dirty && !confirm('調整過的參數還沒存成預設或套用到遊戲，確定要離開嗎？')) return;
    this.labClearWorld();
    this.lab = null;
    this.renderer.info.autoReset = true;
    $('labPanel').hidden = true;
    $('labBar').hidden = true;
    document.body.classList.remove('lab', 'labWatch');
    $('btnAbort').textContent = '放棄任務';
    this.styleRefresh();
    this.state = 'title';
    this.showScreen('title');
  },
  labClearWorld() {
    const L = this.lab;
    if (L && L.show) {
      this.scene.remove(L.show.rig.group);
      L.show = null;
    }
    this.clearMission();
  },
  // 建立戰場與兩隊機甲（換戰區、換地形、改隊伍規模時重來）
  labStart() {
    const L = this.lab;
    this.labClearWorld();
    this.styleStructural(L.P);
    this.stylePipe.rebase();
    this.world = new World(this.scene, L.theme, L.seed, 3);
    const T = this.world.theme;
    this.worldSeed = L.seed;
    this.worldTheme = L.theme;
    this.scene.background = new THREE.Color(T.sky);
    this.scene.fog = new THREE.Fog(T.fog, 60, 190);
    this.sun.color.set(T.sun);
    this.hemi.color.set(T.sky);
    this.hemi.groundColor.set(T.amb);
    this.isClient = false;
    this.net.spawnReg = {};
    this.mpStats = {};
    this.enemies = [];
    this.allies = [];
    this.waves = [];
    this.bosses = [];
    this.boss = null;
    this.isBossLevel = false;
    this.missionT = 0;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.scaleHp = 1;
    this.scaleDmg = 1;
    this.levelName = '渲染風格實驗室・' + T.name;
    this.player = new MechEntity(this, this.save.asm, PALETTES.player, {
      team: 'player',
      name: 'RAVEN',
      palKey: 'player',
      slot: 0,
      hpMul: 1.6,
    });
    this.player.labSpec = { side: 'blue', kind: 'player' };
    this.labPlace(this.player, 'blue');
    this.players = [this.player];
    const n = L.teams;
    for (let i = 0; i < n - 1; i++)
      this.labSpawn({ side: 'blue', kind: 'roster', key: ROSTER[i % ROSTER.length] });
    for (let i = 0; i < n; i++)
      this.labSpawn({ side: 'red', kind: 'roster', key: ROSTER[(5 + i) % ROSTER.length] });
    if (L.extras) {
      for (const k of ['tank', 'heli', 'mt', 'mt']) this.labSpawn({ side: 'red', kind: 'type', key: k });
      this.labSpawn({ side: 'blue', kind: 'type', key: 'tank' });
    }
    // 展示台：玩家的機體，放在藍隊後方
    const sp = this.labSpot(-46, 0, []);
    const rig = buildMech(this.save.asm, PALETTES.player, 1, {
      source: this.mechSource ? this.mechSource({ team: 'player', slot: 0 }) : null,
    });
    rig.group.position.set(sp.x, this.world.terrainHeight(sp.x, sp.z), sp.z);
    this.scene.add(rig.group);
    L.show = { rig, pos: rig.group.position.clone() };
    this.state = 'play';
    this.showScreen('');
    this.labSetMode(L.mode, true);
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(-30, 25, 30);
    L.tgt = null;
    L.free.pivot.set(0, this.world.terrainHeight(0, 0), 0);
    this.stylePipe.resetHistory();
    this.renderWeaponHud(true);
  },
  // 找一個沒有障礙物、坡度可以站的位置
  labSpot(cx, cz, others) {
    const w = this.world;
    for (let t = 0; t < 60; t++) {
      const r = t < 5 ? 0 : 2 + t * 0.4;
      const x = cx + rnd(-r, r),
        z = cz + rnd(-r, r);
      if (w.onCorridor(x, z, 2) || !w.slopeOK(x, z)) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < 5)) continue;
      if (
        w.obstacles.some((o) =>
          o.kind === 'box'
            ? Math.abs(x - o.x) < o.w / 2 + 2 && Math.abs(z - o.z) < o.d / 2 + 2
            : Math.hypot(x - o.x, z - o.z) < o.r + 2,
        )
      )
        continue;
      return { x, z };
    }
    return { x: cx, z: cz };
  },
  labMechs() {
    return [...(this.players || []), ...this.allies, ...this.enemies];
  },
  labPlace(e, side) {
    const blue = side === 'blue';
    const others = this.labMechs()
      .filter((x) => x !== e && !x.dead)
      .map((x) => x.pos);
    const sp = this.labSpot((blue ? -24 : 24) + rnd(-5, 5), rnd(-16, 16), others);
    const y = this.world.terrainHeight(sp.x, sp.z) + (e.flying ? e.hoverH || 6 : 0);
    const p = new THREE.Vector3(sp.x, y, sp.z);
    if (e === this.player && e.dead) e.respawnAt(p);
    e.pos.copy(p);
    e.yaw = e.aimYaw = Math.atan2(-((blue ? 30 : -30) - sp.x), -(0 - sp.z));
    e.mesh.position.copy(e.pos);
  },
  labSpawn(spec) {
    const blue = spec.side === 'blue';
    let asm, o;
    if (spec.kind === 'roster') {
      const r = AC_ROSTER[spec.key];
      asm = r.asm;
      o = {
        name: r.name,
        pal: r.pal,
        ai: r.ai,
        wantDist: r.wantDist,
        speedMul: r.speedMul,
        turnRate: r.turnRate,
        hpMul: r.hpMul * 1.6,
        dmgMul: r.dmgMul * 0.7,
        stabMul: r.stabMul,
      };
    } else {
      const d = ENEMY_TYPES[spec.key];
      asm = d.gen();
      o = {
        name: d.name,
        pal: d.pal,
        scale: d.scale,
        hpMul: d.hpMul * 1.5,
        dmgMul: d.dmgMul * 0.7,
        stabMul: d.stabMul,
        ai: d.ai,
        flying: d.flying,
        hoverH: d.hoverH,
        modelKind: d.modelKind,
        radius: d.radius,
        turnRate: d.turnRate,
        wantDist: d.wantDist,
        speedMul: d.speedMul,
        extraWeapons: d.extraWeapons,
      };
    }
    o.team = blue ? 'ally' : 'enemy';
    o.palKey = o.pal;
    if (blue) o.allyDur = 1e9;
    const e = new MechEntity(this, asm, PALETTES[o.pal] || PALETTES.enemy, o);
    if (o.extraWeapons) {
      for (const k in o.extraWeapons) {
        const def = partById('arm', o.extraWeapons[k]);
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
    e.labSpec = spec;
    this.labPlace(e, spec.side);
    this.registerSpawn(e);
    (blue ? this.allies : this.enemies).push(e);
    return e;
  },
  // 觀看：玩家的機體也由電腦操作；操作：和一般任務相同（第三／第一人稱、HUD）
  labSetMode(mode, quiet) {
    const L = this.lab;
    L.mode = mode;
    const p = this.player;
    if (p) {
      p.ai = mode === 'watch' ? 'ac' : null;
      p.isPlayer = mode === 'ctrl';
      if (mode === 'ctrl') p.lock = null;
    }
    if (mode === 'watch' && this.fp) this.setFp(false);
    document.body.classList.toggle('labWatch', mode === 'watch');
    $('hudWrap').style.display = mode === 'ctrl' ? 'block' : 'none';
    this.stylePipe.resetHistory();
    if (!quiet) this.flashMsg(mode === 'ctrl' ? '操作模式 — 你駕駛藍隊的 RAVEN' : '觀看模式', 0x5cc8ff, 1.4);
    this.labHud();
  },
  // ---------- 每格 ----------
  labTick(dt) {
    const L = this.lab;
    const now = performance.now();
    this.renderer.info.reset();
    L.frames++;
    L.fpsT += (now - (L.lastNow || now)) / 1000;
    L.lastNow = now;
    const step = L.paused ? 0 : dt * L.speed;
    if (step > 0) {
      this.missionT += step;
      this.time += step;
      L.t += step;
      const p = this.player;
      if (L.mode === 'ctrl') {
        if (!p.dead && !p.downed) this.updatePlayer(step);
        else p.move(step, new THREE.Vector3(), false, false, false, null);
      } else if (!p.dead) p.updateAI(step);
      for (const e of this.enemies) if (!e.dead) e.updateAI(step);
      for (const a of this.allies) if (!a.dead) a.updateAI(step);
      this.separateMechs(step);
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const q = this.projectiles[i];
        q.update(step);
        if (q.dead) this.projectiles.splice(i, 1);
      }
      this.updateShocks(step);
      this.updateSupport(step);
      this.updateHazards(step);
      this.fx.update(step);
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const q = this.popups[i];
        q.life -= step;
        q.pos.y += step * 2.5;
        if (q.life <= 0) this.popups.splice(i, 1);
      }
      this.labRespawn(step);
      L.refillT -= step;
      if (L.refillT <= 0) {
        L.refillT = 1;
        for (const e of this.labMechs()) {
          if (e.dead) continue;
          for (const k in e.weapons) {
            const w = e.weapons[k];
            if (w.def && w.def.ammo && w.ammo < w.def.ammo * 0.3) w.ammo = w.def.ammo;
          }
          e.kits = e.kitsMax;
        }
      }
    }
    if (L.show) {
      L.show.rig.group.rotation.y = 0;
      animateMech(L.show.rig, dt, {
        pose: 'garage',
        moving: false,
        grounded: true,
        hover: false,
        boost: false,
        aimPitch: 0,
        t: now / 1000,
      });
    }
    if (L.mode === 'ctrl') this.updateCamera(dt);
    else this.labCamera(dt);
    SFX.setListener(L.mode === 'ctrl' && this.player ? this.player.center() : this.camera.position);
    if (L.mode === 'ctrl') this.updateLoops();
    else {
      SFX.loopSet('thrust', 'thrustLoop', 0);
      SFX.loopSet('engine', 'engineHi', 0);
    }
    this.renderMain();
    if (L.mode === 'ctrl') this.drawHud(dt);
    else this.hctx.clearRect(0, 0, innerWidth, innerHeight);
    if (L.shot) {
      L.shot = false;
      this.canvas.toBlob((b) => {
        if (!b) return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = 'rubicon-style-' + Date.now() + '.png';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      });
    }
    if (L.fpsT > 0.5) {
      const fps = L.frames / L.fpsT;
      const inf = this.renderer.info.render;
      $('labStat').textContent =
        `${Math.round(fps)} FPS・${(1000 / fps).toFixed(1)} ms・繪製 ${inf.calls}・${Math.round(inf.triangles / 1000)}k 三角形・解析度 ${Math.round(this.renderer.getPixelRatio() * 100)}%`;
      L.frames = 0;
      L.fpsT = 0;
    }
  },
  labRespawn(dt) {
    for (const e of this.labMechs()) {
      if (!e.dead) {
        e.labDeadT = 0;
        continue;
      }
      e.labDeadT = (e.labDeadT || 0) + dt;
      if (e.labDeadT < 4) continue;
      e.labDeadT = 0;
      if (e === this.player) {
        this.labPlace(e, 'blue');
        if (this.lab.mode === 'watch') e.isPlayer = false;
        continue;
      }
      const list = e.team === 'enemy' ? this.enemies : this.allies;
      const i = list.indexOf(e);
      if (i >= 0) list.splice(i, 1);
      e.cleanup();
      this.labSpawn(e.labSpec);
    }
  },
  // ---------- 觀看模式的鏡頭 ----------
  labPickTarget(alive, avoid) {
    // 優先挑附近有敵人、正在近戰或推進中的機甲
    let best = null,
      bs = -1;
    for (const e of alive) {
      if (e === avoid || e.opts.modelKind) continue;
      let s = Math.random() * 2;
      for (const h of this.hostilesOfEnt(e)) if (!h.dead && h.pos.distanceTo(e.pos) < 35) s += 1;
      if (e.melee.active) s += 3;
      if (e.boost) s += 1;
      if (s > bs) {
        bs = s;
        best = e;
      }
    }
    return best || alive[0] || null;
  },
  labCycle(dir) {
    const L = this.lab;
    const alive = this.labMechs().filter((e) => !e.dead);
    if (!alive.length) return;
    const i = alive.indexOf(L.tgt);
    L.tgt = alive[(i + dir + alive.length) % alive.length];
    L.tgtT = 0;
    this.stylePipe.resetHistory();
    this.labHud();
  },
  labCamera(dt) {
    const L = this.lab,
      cam = this.camera,
      w = this.world;
    const alive = this.labMechs().filter((e) => !e.dead);
    L.tgtT += dt;
    if (!L.tgt || L.tgt.dead || (L.cam === 'cinema' && L.tgtT > 9)) {
      const old = L.tgt;
      L.tgt = this.labPickTarget(alive, old);
      L.tgtT = 0;
      L.cin.a = Math.random() * Math.PI * 2;
      L.cin.r = rnd(11, 19);
      L.cin.h = rnd(2.5, 8);
      L.snap = true;
      this.labHud();
    }
    const pos = new THREE.Vector3(),
      look = new THREE.Vector3();
    let focus;
    if (L.cam === 'show' && L.show) {
      L.showA += dt * 0.3;
      const c = L.show.pos,
        h = L.show.rig.height || 4;
      const r = h * 2.3;
      pos.set(c.x + Math.cos(L.showA) * r, c.y + h * 0.75, c.z + Math.sin(L.showA) * r);
      look.set(c.x, c.y + h * 0.5, c.z);
      focus = c;
    } else if (L.cam === 'free') {
      const F = L.free;
      const k = this.keys,
        sp = dt * F.dist * 0.9;
      const fx = -Math.sin(F.yaw),
        fz = -Math.cos(F.yaw);
      if (k.KeyW) F.pivot.add(new THREE.Vector3(fx, 0, fz).multiplyScalar(sp));
      if (k.KeyS) F.pivot.add(new THREE.Vector3(-fx, 0, -fz).multiplyScalar(sp));
      if (k.KeyA) F.pivot.add(new THREE.Vector3(fz, 0, -fx).multiplyScalar(sp));
      if (k.KeyD) F.pivot.add(new THREE.Vector3(-fz, 0, fx).multiplyScalar(sp));
      F.pivot.y = w.terrainHeight(F.pivot.x, F.pivot.z) + 1.5;
      const cp = Math.cos(F.pitch);
      pos.set(
        F.pivot.x + Math.sin(F.yaw) * cp * F.dist,
        F.pivot.y + Math.sin(F.pitch) * F.dist,
        F.pivot.z + Math.cos(F.yaw) * cp * F.dist,
      );
      look.copy(F.pivot);
      focus = F.pivot;
      L.snap = true;
    } else if (L.tgt) {
      const e = L.tgt,
        c = e.center();
      focus = e.pos;
      if (L.cam === 'follow') {
        const y = e.yaw;
        pos.set(
          e.pos.x + Math.sin(y) * 9 * e.scale,
          c.y + 3.2 * e.scale,
          e.pos.z + Math.cos(y) * 9 * e.scale,
        );
        look.set(c.x - Math.sin(y) * 6, c.y + 0.6, c.z - Math.cos(y) * 6);
      } else {
        L.cin.a += dt * 0.16;
        pos.set(c.x + Math.cos(L.cin.a) * L.cin.r, c.y + L.cin.h, c.z + Math.sin(L.cin.a) * L.cin.r);
        look.copy(c);
      }
    } else {
      focus = new THREE.Vector3();
      pos.set(-30, 25, 30);
    }
    pos.y = Math.max(pos.y, w.terrainHeight(pos.x, pos.z) + 1.2);
    if (L.snap) {
      cam.position.copy(pos);
      L.look.copy(look);
      if (L.cam !== 'free') this.stylePipe.resetHistory();
      L.snap = false;
    } else {
      const k = Math.min(1, dt * (L.cam === 'follow' ? 5 : 3));
      cam.position.lerp(pos, k);
      L.look.lerp(look, k);
    }
    cam.lookAt(L.look);
    this.camTarget.copy(focus);
    this.sun.position.copy(focus).add(this.sunOff);
    this.sun.target.position.copy(focus);
    const sc = this.sun.shadow.camera;
    if (sc.right !== 70) {
      sc.left = sc.bottom = -70;
      sc.right = sc.top = 70;
      sc.updateProjectionMatrix();
    }
    w.updateOcclusion(cam.position, L.look, dt);
    this.rangeRing.visible = false;
    this.camFocus = L.tgt;
  },
  // 自由鏡頭的滑鼠操作（只在觀看模式、游標不在面板上時）
  labPointer(type, e) {
    const L = this.lab;
    if (!L) return false;
    if (type !== 'up' && e.target && e.target.closest && e.target.closest('#labPanel, #labBar')) return true;
    if (L.mode !== 'watch') return false;
    if (type === 'down' && L.cam !== 'free') {
      L.cam = 'free';
      const c = this.camera.position,
        t = L.look;
      const d = c.clone().sub(t);
      L.free.dist = clamp(d.length(), 4, 160);
      L.free.yaw = Math.atan2(d.x, d.z);
      L.free.pitch = clamp(Math.asin(d.y / L.free.dist), 0.05, 1.45);
      L.free.pivot.copy(t);
      this.labHud();
    }
    if (type === 'down') L.drag = { x: e.clientX, y: e.clientY, b: e.button };
    else if (type === 'up') L.drag = null;
    else if (type === 'move' && L.drag) {
      const dx = e.clientX - L.drag.x,
        dy = e.clientY - L.drag.y;
      const F = L.free;
      if (L.drag.b === 0) {
        F.yaw -= dx * 0.006;
        F.pitch = clamp(F.pitch + dy * 0.005, 0.05, 1.45);
      } else {
        const k = F.dist * 0.0016;
        const fx = -Math.sin(F.yaw),
          fz = -Math.cos(F.yaw);
        F.pivot.x += (-fz * dx + fx * dy) * k * -1;
        F.pivot.z += (fx * dx + fz * dy) * k * -1;
      }
      L.drag.x = e.clientX;
      L.drag.y = e.clientY;
    } else if (type === 'wheel' && L.cam === 'free') {
      L.free.dist = clamp(L.free.dist * (e.deltaY > 0 ? 1.12 : 0.89), 4, 160);
    }
    return true;
  },
  labKey(e) {
    const L = this.lab;
    if (!L) return false;
    if (e.target && e.target.closest && e.target.closest('#labPanel input, #labPanel select, #labBar select'))
      return e.code !== 'Escape';
    if (e.code === 'KeyH') {
      L.panel = !L.panel;
      $('labPanel').classList.toggle('mini', !L.panel);
      return true;
    }
    if (L.mode !== 'watch') return false;
    if (e.code === 'KeyI') {
      this.labIkToggle('on', !IK.on);
      return true;
    }
    if (e.code === 'Space') {
      L.hold = true;
      this.labHud();
      e.preventDefault();
      return true;
    }
    if (e.code === 'KeyP') {
      L.paused = !L.paused;
      this.labHud();
      return true;
    }
    if (e.code === 'BracketLeft' || e.code === 'BracketRight') {
      this.labCycle(e.code === 'BracketLeft' ? -1 : 1);
      return true;
    }
    return false;
  },
  labKeyUp(e) {
    const L = this.lab;
    if (L && e.code === 'Space' && L.hold) {
      L.hold = false;
      this.labHud();
    }
  },
  // ---------- 介面 ----------
  labBuildUi() {
    document.body.classList.add('lab');
    $('btnAbort').textContent = '離開實驗室';
    this.renderer.info.autoReset = false;
    const P = $('labPanel');
    P.hidden = false;
    P.classList.toggle('mini', false);
    const groups = STYLE_GROUPS.map(
      (g, gi) =>
        `<details class="lgrp" ${gi < 3 ? 'open' : ''}><summary>${escHtml(g.name)}</summary>${g.items
          .map((it) => this.labItemHtml(it))
          .join('')}</details>`,
    ).join('');
    P.innerHTML = `
      <div class="lhead"><b>渲染風格實驗室</b><button id="labMini" title="收合／展開面板（H）">▤</button></div>
      <div class="lbody">
        <div class="lrow"><span>風格</span><select id="labStyle"></select></div>
        <div class="lrow"><span>機體金屬</span><label><input type="checkbox" id="labMetal" /> 機甲、武器、載具改成金屬</label></div>
        <div class="lnote" id="labSrc"></div>
        <details class="lgrp" id="labIk"><summary>動作 IK</summary>
          <div class="lrow"><span>全部</span><label title="I 鍵切換"><input type="checkbox" id="ik_on" /> 啟用 IK（I 鍵切換，比較前後）</label></div>
          ${IK_ITEMS.map(
            ([k, name, tip]) =>
              `<div class="lrow ikrow"><label title="${escHtml(tip)}"><input type="checkbox" id="ik_${k}" /> ${escHtml(name)}</label></div>`,
          ).join('')}
          <div class="lnote">開關會記住，也套用到一般任務。手臂瞄準與壓低骨盆會移動子彈發射點（多人以房主的設定為準）。</div>
        </details>
        ${groups}
        <div class="lacts">
          <button class="primary" id="labApply" title="寫入設定，下次出擊、進車庫時使用">套用到遊戲</button>
          <button id="labReset" title="回到載入時的參數">還原</button>
        </div>
        <div class="lrow"><span>名稱</span><input id="labName" maxlength="40" placeholder="我的風格" /></div>
        <div class="lacts">
          <button id="labSaveNew">存成我的預設</button>
          <button id="labSave" title="覆寫目前載入的「我的預設」">更新這個預設</button>
          <button id="labDel">刪除</button>
        </div>
        <div class="lacts">
          <button id="labExport">匯出 JSON</button>
          <button id="labImport">匯入 JSON</button>
          <input type="file" id="labFile" accept=".json,application/json" hidden />
        </div>
        <div class="lacts" id="labSrvActs">
          <button id="labUpload" title="分享到這台伺服器，區網內的玩家都能選用">上傳到伺服器</button>
          <button id="labSrvDel" title="從伺服器刪除目前載入的分享風格">從伺服器刪除</button>
          <button id="labSrvReload">重新整理伺服器清單</button>
        </div>
        <div class="lnote" id="labMsg"></div>
      </div>`;
    const B = $('labBar');
    B.hidden = false;
    const themes = Object.keys(THEMES)
      .map((k) => `<option value="${k}">${escHtml(THEMES[k].name)}</option>`)
      .join('');
    B.innerHTML = `
      <span class="lseg"><button id="labWatch">觀看</button><button id="labCtrl">操作</button></span>
      <span class="lseg">鏡頭 <select id="labCam">${CAMS.map((c) => `<option value="${c[0]}">${c[1].split('（')[0]}</option>`).join('')}</select>
        <button id="labPrev" title="上一台（[）">◀</button><span id="labTgt" class="dim"></span><button id="labNext" title="下一台（]）">▶</button></span>
      <span class="lseg"><button id="labPause" title="暫停（P）">⏸</button>
        <select id="labSpeed"><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1" selected>1×</option></select></span>
      <span class="lseg">比較 <select id="labCmp"></select>
        <input type="range" id="labSplit" min="0.05" max="0.95" step="0.01" value="0.5" title="分割線位置" /></span>
      <span class="lseg">戰區 <select id="labTheme">${themes}</select>
        <button id="labSeed" title="同一戰區換一個地形">換地形</button>
        <select id="labTeams"><option value="1">1 對 1</option><option value="2">2 對 2</option><option value="3">3 對 3</option><option value="4">4 對 4</option></select>
        <label title="加入裝甲車、直升機與 MT"><input type="checkbox" id="labExtras" /> 載具與雜兵</label></span>
      <span class="lseg">解析度 <select id="labRes"></select></span>
      <span class="lseg"><button id="labShot" title="下載這一格的 PNG">截圖</button><button id="labExit">離開</button></span>
      <span id="labStat" class="dim"></span>
      <span id="labHelp" class="dim"></span>`;
    this.labRenderChoices();
    this.labSyncUi();
    this.labBindUi();
  },
  labItemHtml(it) {
    const id = 'lp_' + it.k;
    let ctl;
    if (it.t === 'sel')
      ctl = `<select id="${id}">${it.opts.map((o) => `<option value="${o[0]}">${escHtml(o[1])}</option>`).join('')}</select>`;
    else if (it.t === 'bool') ctl = `<input type="checkbox" id="${id}" />`;
    else if (it.t === 'color') ctl = `<input type="color" id="${id}" />`;
    else
      ctl = `<input type="range" id="${id}" min="${it.min}" max="${it.max}" step="${it.t === 'int' ? 1 : it.step}" /><span class="lval" id="${id}_v"></span>`;
    return `<div class="lrow lp" data-k="${it.k}"><span>${escHtml(it.label)}</span><span class="lctl">${ctl}</span></div>`;
  },
  labRenderChoices() {
    const L = this.lab;
    const ch = StyleStore.choices();
    const lbl = { builtin: '內建', mine: '我的', server: '伺服器' };
    const opt = (c) =>
      `<option value="${c.k}:${escHtml(c.id)}">${lbl[c.k]}・${escHtml(c.name)}${c.author ? '（' + escHtml(c.author) + '）' : ''}</option>`;
    $('labStyle').innerHTML = ch.map(opt).join('');
    $('labStyle').value = L.src.k + ':' + L.src.id;
    $('labCmp').innerHTML =
      '<option value="">關</option><option value="orig">載入時的參數</option>' + ch.map(opt).join('');
    $('labCmp').value = L.cmpSel;
    const rs = StyleStore.data.res;
    $('labRes').innerHTML = [1, 0.85, 0.7, 0.6, 0.5]
      .map((r) => `<option value="${r}">${Math.round(r * 100)}%</option>`)
      .join('');
    $('labRes').value = String(rs);
  },
  // 參數 → 控制項
  labSyncUi() {
    const L = this.lab,
      P = L.P;
    for (const k in STYLE_ITEMS) {
      const it = STYLE_ITEMS[k];
      const el = $('lp_' + k);
      if (!el) continue;
      if (it.t === 'bool') el.checked = !!P[k];
      else el.value = String(P[k]);
      if (it.t === 'num' || it.t === 'int') $('lp_' + k + '_v').textContent = this.labFmt(it, P[k]);
    }
    $('labMetal').checked = !!P.metal;
    this.labIkSync();
    this.labVisibility();
    const name = StyleStore.nameOf(L.src.k, L.src.id) || '（已刪除）';
    $('labSrc').textContent = `載入自：${name}${L.dirty ? '（已修改）' : ''}`;
    $('labName').value = L.src.k === 'mine' ? name : $('labName').value;
    $('labSave').disabled = L.src.k !== 'mine';
    $('labDel').disabled = L.src.k !== 'mine';
    const srv = StyleStore.serverOn;
    $('labSrvActs').style.display = srv ? '' : 'none';
    $('labSrvDel').disabled = L.src.k !== 'server';
  },
  labIkSync() {
    $('ik_on').checked = IK.on;
    for (const [k] of IK_ITEMS) {
      const el = $('ik_' + k);
      el.checked = IK[k];
      el.disabled = !IK.on;
    }
  },
  labIkToggle(k, v) {
    setIK(k, v);
    this.labIkSync();
    if (k === 'on') this.flashMsg(v ? 'IK：開' : 'IK：關', 0x5cc8ff, 1);
  },
  labFmt(it, v) {
    if (it.t === 'int') return String(v);
    const s = it.step >= 1 ? 0 : it.step >= 0.1 ? 1 : 2;
    return Number(v).toFixed(s);
  },
  labVisibility() {
    const P = this.lab.P;
    for (const row of document.querySelectorAll('#labPanel .lp')) {
      const it = STYLE_ITEMS[row.dataset.k];
      row.style.display = !it.when || it.when(P) ? '' : 'none';
    }
  },
  labSetParam(k, v) {
    const L = this.lab;
    L.P[k] = v;
    L.P = normalizeStyle(L.P);
    L.dirty = true;
    if (STRUCT.has(k)) this.styleStructural(L.P);
    const it = STYLE_ITEMS[k];
    if (it && (it.t === 'num' || it.t === 'int')) $('lp_' + k + '_v').textContent = this.labFmt(it, L.P[k]);
    this.labVisibility();
    $('labSrc').textContent = `載入自：${StyleStore.nameOf(L.src.k, L.src.id) || '（已刪除）'}（已修改）`;
  },
  labLoad(k, id) {
    const L = this.lab;
    const P = StyleStore.paramsOf(k, id);
    if (!P) return;
    P.metal = L.P.metal;
    L.P = P;
    L.orig = { ...P };
    L.src = { k, id };
    L.dirty = false;
    this.styleStructural(P);
    this.labSyncUi();
    this.labMsg('');
  },
  labMsg(t, err) {
    const m = $('labMsg');
    m.textContent = t;
    m.style.color = err ? 'var(--danger)' : '';
  },
  labCmpParams(sel) {
    const L = this.lab;
    if (!sel) return null;
    if (sel === 'orig') return { ...L.orig };
    const [k, ...rest] = sel.split(':');
    const P = StyleStore.paramsOf(k, rest.join(':'));
    if (P) P.metal = L.P.metal;
    return P;
  },
  labHud() {
    const L = this.lab;
    if (!L || !$('labWatch')) return;
    $('labWatch').classList.toggle('on', L.mode === 'watch');
    $('labCtrl').classList.toggle('on', L.mode === 'ctrl');
    $('labCam').value = L.cam;
    $('labCam').disabled = L.mode !== 'watch';
    $('labPause').textContent = L.paused ? '▶' : '⏸';
    $('labTgt').textContent = L.tgt ? ' ' + L.tgt.name + ' ' : ' — ';
    $('labHelp').textContent =
      L.mode === 'watch'
        ? L.hold
          ? '顯示載入時的參數（放開空白鍵回到目前）'
          : '空白鍵：按住看載入時的參數・I 開關 IK・P 暫停・[ ] 切換目標・H 收合面板・拖曳畫面＝自由鏡頭'
        : '操作模式：和任務相同的按鍵（Esc 暫停選單可離開）・H 收合面板';
  },
  labBindUi() {
    const L = () => this.lab;
    for (const k in STYLE_ITEMS) {
      const it = STYLE_ITEMS[k];
      const el = $('lp_' + k);
      if (!el) continue;
      const ev = it.t === 'num' || it.t === 'int' || it.t === 'color' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        let v;
        if (it.t === 'bool') v = el.checked;
        else if (it.t === 'color') v = el.value;
        else if (it.t === 'sel') v = typeof it.opts[0][0] === 'number' ? Number(el.value) : el.value;
        else v = Number(el.value);
        this.labSetParam(k, v);
      });
    }
    $('labMetal').onchange = (e) => this.labSetParam('metal', e.target.checked);
    $('ik_on').onchange = (e) => this.labIkToggle('on', e.target.checked);
    for (const [k] of IK_ITEMS) $('ik_' + k).onchange = (e) => this.labIkToggle(k, e.target.checked);
    $('labMini').onclick = () => {
      L().panel = !L().panel;
      $('labPanel').classList.toggle('mini', !L().panel);
    };
    $('labStyle').onchange = (e) => {
      const lab = L();
      if (lab.dirty && !confirm('目前的修改還沒儲存，要改載入另一個風格嗎？')) {
        e.target.value = lab.src.k + ':' + lab.src.id;
        return;
      }
      const [k, ...rest] = e.target.value.split(':');
      this.labLoad(k, rest.join(':'));
    };
    $('labApply').onclick = () => {
      const lab = L();
      // 有修改時先存成「我的預設」，遊戲才有東西可選
      if (lab.dirty) {
        const name = ($('labName').value || '').trim() || '我的風格';
        const m = StyleStore.saveMine(name, lab.P, lab.src.k === 'mine' ? lab.src.id : null);
        lab.src = { k: 'mine', id: m.id };
        lab.dirty = false;
        lab.orig = { ...lab.P };
        this.labRenderChoices();
      }
      StyleStore.select(lab.src.k, lab.src.id);
      StyleStore.setMetal(lab.P.metal);
      this.labSyncUi();
      this.labMsg(
        `已套用「${StyleStore.nameOf(lab.src.k, lab.src.id)}」${lab.P.metal ? '＋機體金屬' : ''}：下次出擊或進車庫時使用`,
      );
    };
    $('labReset').onclick = () => {
      const lab = L();
      lab.P = { ...lab.orig };
      lab.dirty = false;
      this.styleStructural(lab.P);
      this.labSyncUi();
    };
    $('labSaveNew').onclick = () => {
      const lab = L();
      const name = ($('labName').value || '').trim() || '我的風格';
      const m = StyleStore.saveMine(name, lab.P);
      lab.src = { k: 'mine', id: m.id };
      lab.dirty = false;
      lab.orig = { ...lab.P };
      this.labRenderChoices();
      this.labSyncUi();
      this.labMsg(`已存成「${name}」`);
    };
    $('labSave').onclick = () => {
      const lab = L();
      if (lab.src.k !== 'mine') return;
      const name = ($('labName').value || '').trim() || StyleStore.nameOf('mine', lab.src.id);
      StyleStore.saveMine(name, lab.P, lab.src.id);
      lab.dirty = false;
      lab.orig = { ...lab.P };
      this.labRenderChoices();
      this.labSyncUi();
      this.labMsg(`已更新「${name}」`);
    };
    $('labDel').onclick = () => {
      const lab = L();
      if (lab.src.k !== 'mine' || !confirm(`刪除「${StyleStore.nameOf('mine', lab.src.id)}」？`)) return;
      StyleStore.removeMine(lab.src.id);
      lab.src = { k: 'builtin', id: 'real' };
      lab.dirty = true;
      this.labRenderChoices();
      this.labSyncUi();
    };
    $('labExport').onclick = () => {
      const lab = L();
      const name = ($('labName').value || '').trim() || StyleStore.nameOf(lab.src.k, lab.src.id) || '風格';
      const blob = new Blob([StyleStore.exportJson(name, lab.P)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name.replace(/[\\/:*?"<>|]/g, '_') + '.rubicon-style.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    $('labImport').onclick = () => $('labFile').click();
    $('labFile').onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const o = StyleStore.parseJson(await f.text());
        const lab = L();
        o.params.metal = lab.P.metal;
        lab.P = o.params;
        lab.dirty = true;
        $('labName').value = o.name;
        this.styleStructural(lab.P);
        this.labSyncUi();
        this.labMsg(`已匯入「${o.name}」（還沒儲存）`);
      } catch (err) {
        this.labMsg('匯入失敗：' + err.message, true);
      }
    };
    $('labUpload').onclick = async () => {
      const lab = L();
      const name =
        ($('labName').value || '').trim() || StyleStore.nameOf(lab.src.k, lab.src.id) || '我的風格';
      const author = (localStorage.getItem('rubicon_nick') || '').slice(0, 24);
      const same = lab.src.k === 'server' && StyleStore.nameOf('server', lab.src.id) === name;
      try {
        this.labMsg('上傳中…');
        const id = await StyleStore.upload(name, author, lab.P, same ? lab.src.id : null);
        lab.src = { k: 'server', id };
        lab.dirty = false;
        lab.orig = { ...lab.P };
        this.labRenderChoices();
        this.labSyncUi();
        this.labMsg(`已上傳「${name}」：區網內的玩家可以在設定或這裡選用`);
      } catch (err) {
        this.labMsg('上傳失敗：' + err.message, true);
      }
    };
    $('labSrvDel').onclick = async () => {
      const lab = L();
      if (
        lab.src.k !== 'server' ||
        !confirm(`從伺服器刪除「${StyleStore.nameOf('server', lab.src.id)}」？其他玩家也會看不到。`)
      )
        return;
      try {
        await StyleStore.removeServer(lab.src.id);
        lab.src = { k: 'builtin', id: 'real' };
        lab.dirty = true;
        this.labRenderChoices();
        this.labSyncUi();
        this.labMsg('已從伺服器刪除');
      } catch (err) {
        this.labMsg('刪除失敗：' + err.message, true);
      }
    };
    $('labSrvReload').onclick = async () => {
      try {
        await StyleStore.fetchServer();
        this.labRenderChoices();
        this.labSyncUi();
        this.labMsg('已更新伺服器清單');
      } catch (err) {
        this.labMsg('讀取失敗：' + err.message, true);
      }
    };
    // 下方工具列
    $('labWatch').onclick = () => this.labSetMode('watch');
    $('labCtrl').onclick = () => this.labSetMode('ctrl');
    $('labCam').onchange = (e) => {
      L().cam = e.target.value;
      L().snap = true;
      if (L().cam === 'free') {
        const t = L().look.clone();
        L().free.pivot.copy(t);
      }
      this.labHud();
    };
    $('labPrev').onclick = () => this.labCycle(-1);
    $('labNext').onclick = () => this.labCycle(1);
    $('labPause').onclick = () => {
      L().paused = !L().paused;
      this.labHud();
    };
    $('labSpeed').onchange = (e) => (L().speed = Number(e.target.value) || 1);
    $('labCmp').onchange = (e) => {
      L().cmpSel = e.target.value;
      L().cmp = this.labCmpParams(e.target.value);
      $('labSplit').style.display = L().cmp ? '' : 'none';
    };
    $('labSplit').style.display = 'none';
    $('labSplit').oninput = (e) => (L().split = Number(e.target.value));
    $('labTheme').value = L().theme;
    $('labTheme').onchange = (e) => {
      L().theme = e.target.value;
      this.labStart();
    };
    $('labSeed').onclick = () => {
      L().seed = Math.floor(Math.random() * 1e6);
      this.labStart();
    };
    $('labTeams').value = String(L().teams);
    $('labTeams').onchange = (e) => {
      L().teams = Number(e.target.value) || 3;
      this.labStart();
    };
    $('labExtras').checked = L().extras;
    $('labExtras').onchange = (e) => {
      L().extras = e.target.checked;
      this.labStart();
    };
    $('labRes').onchange = (e) => {
      StyleStore.setRes(Number(e.target.value) || 1);
      this.applyRes();
      this.resize();
    };
    $('labShot').onclick = () => (L().shot = true);
    $('labExit').onclick = () => this.exitLab();
    this.labHud();
  },
});
