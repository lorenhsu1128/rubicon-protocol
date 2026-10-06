// ============================================================
//  GAME
// ============================================================
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Effects } from '../fx/effects.js';
import { animateMech } from '../render/mech-model.js';

export class Game {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.hudC = document.getElementById('hud');
    this.hctx = this.hudC.getContext('2d');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.68;
    this.scene = new THREE.Scene();
    this.post = {
      enabled: (() => {
        try {
          return localStorage.getItem('rubicon_post') !== '0';
        } catch (e) {
          return true;
        }
      })(),
      ok: !!(THREE.EffectComposer && THREE.UnrealBloomPass && THREE.SSAOPass && THREE.GammaCorrectionShader),
    };
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    this.camTarget = new THREE.Vector3();
    this.camShake = 0;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 0.48);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 250;
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.setupEnvironment();
    this.setupPost();
    this.fx = new Effects(this.scene);
    this.wrapFx();
    this.projSeq = 0;
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.985, 1, 96),
      new THREE.MeshBasicMaterial({
        color: 0x223040,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);
    this.projectiles = [];
    this.enemies = [];
    this.allies = [];
    this.player = null;
    this.world = null;
    this.popups = [];
    this.state = 'title';
    this.bountyPops = [];
    this.missionEarned = 0;
    this.keys = {};
    this.mouse = { x: 0, y: 0, l: false, r: false };
    this.mouseWorld = new THREE.Vector3();
    this.playerFiredAt = 0;
    this.save = this.loadSave() || this.newSave();
    this.time = 0;
    this.lastT = performance.now();
    this.fpsT = 0;
    this.frames = 0;
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.garageScene = null;
    this.setupGarageScene();
    this.netInit();
    this.mapExtrasInit();
    this.fpInit();
    this.lmInit();
    this.mpModelsInit();
    // 冒煙測試用：網址帶 ?test 時把遊戲實例放在 window.__game（檢查各機甲用的模型組）
    if (/[?&]test\b/.test(location.search)) window.__game = this;
    const sp = new URLSearchParams(location.search).get('spectate');
    if (sp && window.RUBICON_SERVER) {
      setTimeout(() => {
        SFX.init();
        this.openMP();
        this.mpSpectate(sp);
      }, 600);
    }
    this.showScreen('title');
    document.getElementById('btnContinue').disabled = !this.loadSave();
    requestAnimationFrame(() => this.loop());
  }
  updateLoops() {
    const p = this.player;
    if (!p || p.dead || p.downed) {
      SFX.loopSet('thrust', 'thrustLoop', 0);
      SFX.loopSet('engine', 'engineHi', 0);
      return;
    }
    const thr = p.abT > 0 ? 0 : p.boost ? 0.9 : p.hover ? 0.75 : !p.grounded ? 0.45 : p.moving ? 0.25 : 0;
    SFX.loopSet('thrust', 'thrustLoop', thr * 0.6, p.boost ? 1.25 : 1.0);
    SFX.loopSet('engine', 'engineHi', p.abT > 0 ? 0.9 : 0, 1.1);
  }
  // 機體之間的碰撞分離（無傷害）：兩兩相互推開；第一人稱時本地玩家與敵人保持更大距離
  separateMechs(dt, list) {
    const L = (list || [...(this.players || []), ...this.enemies, ...this.allies]).filter(
      (e) => e && !e.dead,
    );
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (Math.abs(a.pos.y - b.pos.y) > Math.max(3, a.radius + b.radius)) continue;
        const dx = b.pos.x - a.pos.x,
          dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        const extra = (a.isPlayer && this.fp) || (b.isPlayer && this.fp) ? 1.8 : 0.2;
        const min = a.radius + b.radius + extra;
        if (d >= min || (d > 1e-6 && d >= min)) continue;
        if (d < 1e-4) {
          d = 1e-4;
        }
        const nx = dx / d,
          nz = dz / d;
        const push = min - d;
        const wa = a.isBoss ? 0.1 : a.model && a.model.vehicle ? 0.4 : 1,
          wb = b.isBoss ? 0.1 : b.model && b.model.vehicle ? 0.4 : 1;
        const sum = wa + wb || 1;
        a.pos.x -= nx * push * (wa / sum);
        a.pos.z -= nz * push * (wa / sum);
        b.pos.x += nx * push * (wb / sum);
        b.pos.z += nz * push * (wb / sum);
        const va = a.vel.x * nx + a.vel.z * nz,
          vb = b.vel.x * nx + b.vel.z * nz;
        if (va > 0) {
          a.vel.x -= nx * va * 0.8;
          a.vel.z -= nz * va * 0.8;
        }
        if (vb < 0) {
          b.vel.x -= nx * vb * 0.8;
          b.vel.z -= nz * vb * 0.8;
        }
        a.mesh.position.copy(a.pos);
        b.mesh.position.copy(b.pos);
      }
    }
  }
  // 電磁脈衝：以射手為中心的環形控場，敵人硬直
  empPulse(src, radius, stun, color, wid) {
    const c = src.center();
    this.fx.shockwave(c, radius, color || 0x80c8ff, 0.9);
    this.fx.ring(c.clone().setY(this.world.terrainHeight(c.x, c.z) + 0.2), radius * 0.6, color || 0x80c8ff);
    this.fx.flash(c, 2.5, 0xbfe8ff, 0.25);
    for (let i = 0; i < 14; i++) this.fx.streaks(c, 3, 0x9fe0ff, radius * 0.9, 0.35, radius * 2);
    SFX.play('overload', 0.9, 1.3, 0.05, 0.05, src.isPlayer ? null : c);
    SFX.play('laserBig', 0.6, 0.6, 0.05, 0.05, src.isPlayer ? null : c);
    if (src.isPlayer) {
      this.camShake = Math.max(this.camShake, 0.2);
      this.rumble(0.7, 0.9, 300);
    }
    let n = 0;
    for (const t of this.hostilesOfEnt(src)) {
      if (t.dead || t.isProp) continue;
      const d = t.center().distanceTo(c) - t.radius;
      if (d < radius && Math.abs(t.center().y - c.y) < 9) {
        const s = stun * (t.isBoss ? 0.4 : 1);
        t.staggerT = Math.max(t.staggerT, s);
        t.acs = t.acsMax;
        t.comboHits = 0;
        if (t.melee && t.melee.active) {
          t.melee.active = false;
          t.swing = { l: 0, r: 0 };
        }
        t.vel.multiplyScalar(0.2);
        this.fx.ring(t.center(), 3, 0x80c8ff);
        this.fx.flash(t.center(), 1.2, 0xbfe8ff, 0.2);
        this.popDamage(t.center(), 'EMP', t.isPlayer, true, false, 0, t.id, 0);
        this.pilotCreditStun(src, t, wid);
        this.netEv({ t: 'stag', i: t.id });
        if (t.isPlayer) {
          this.flashAlert('遭到電磁脈衝 — 系統停擺');
          this.rumble(1, 1, 500);
        }
        n++;
      }
    }
    if (src.isPlayer) this.flashMsg(n ? `電磁脈衝 — ${n} 台敵機硬直` : '電磁脈衝 — 未命中', 0x80c8ff, 1.4);
  }
  // 準星所指的世界點：沿鏡頭射線步進，碰到地形／障礙物就停；沒碰到就取 120 m 處。光束武器一律以此為瞄準點
  reticlePoint(p) {
    let origin, dir;
    if (this.fp) {
      origin = this.fpEye(p);
      dir = this.fpLookDir(this.fpYaw, this.fpPitch);
    } else {
      const ray = new THREE.Raycaster();
      let mx = this.mouse.x,
        my = this.mouse.y;
      if (this.padActive || this.touchActive) {
        const s = this.proj(this.mouseWorld);
        mx = s.x;
        my = s.y;
      }
      ray.setFromCamera(
        new THREE.Vector2((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1),
        this.camera,
      );
      origin = ray.ray.origin.clone();
      dir = ray.ray.direction.clone();
    }
    const w = this.world;
    let prev = origin.clone();
    for (let s = 1; s <= 140; s += 1) {
      const q = origin.clone().addScaledVector(dir, s);
      if (!this.fp && s < 20) {
        prev = q;
        continue;
      }
      if (q.y < w.terrainHeight(q.x, q.z) || w.hitsWorld(q)) {
        return prev;
      }
      prev = q;
    }
    return prev;
  }
  hostilesOf(team, ent) {
    if (ent) return this.hostilesOfEnt(ent);
    return team === 'enemy' ? [...this.playersAlive(), ...this.allies] : this.enemies;
  }
  // 以實體為準的敵對名單（PVP：不同隊的玩家也是敵人）
  hostilesOfEnt(e) {
    if (!e) return this.enemies;
    if (this.pvp) {
      const all = [...(this.players || []), ...this.enemies];
      return all.filter((q) => q !== e && !q.dead && this.isHostile(e, q));
    } // PVP：依 pvpTeam 判定（含補位電腦 AC）
    if (e.team === 'enemy') return [...this.playersAlive(), ...this.allies];
    if (e.team === 'ally') return this.enemies;
    return [...this.enemies];
  }
  isHostile(a, b) {
    if (!a || !b || a === b) return false;
    if (this.pvp) {
      const ta = this.pvpTeamOf(a),
        tb = this.pvpTeamOf(b);
      return ta !== tb;
    }
    if (a.team === 'enemy') return b.team !== 'enemy';
    if (b.team === 'enemy') return true;
    return false;
  }
  everyone(except) {
    return [
      ...(this.players && this.players.length ? this.players : [this.player]),
      ...this.allies,
      ...this.enemies,
    ].filter((e) => e && e !== except);
  }
  // 敵我不分的爆炸（自爆型、無人機、轟炸機）
  explodeAt(p, dmg, impact, splash, owner, all = true) {
    this.fx.explosion(p, splash * 0.9, 0xffa040, splash > 4);
    SFX.explode(splash > 4, p);
    const targets = (all ? this.everyone(owner) : this.hostilesOfEnt(owner)).concat(this.destructibles());
    for (const t of targets) {
      if (!t || t.dead) continue;
      const d = t.center().distanceTo(p) - t.radius;
      if (d < splash) {
        let k = clamp(1 - (d / splash) * 0.5, 0.4, 1);
        let im = impact * k;
        if (
          t.team === 'player' &&
          owner &&
          owner.team === 'player' &&
          t !== owner &&
          !this.isHostile(owner, t)
        ) {
          k *= 0.3;
          im = 0;
        }
        if (t.isProp) this.damageProp(t, dmg * k, im, p);
        else t.takeDamage(dmg * k, im, owner, p, t.center().sub(p).normalize());
      }
    }
    if (this.player && this.player.center().distanceTo(p) < splash + 6)
      this.camShake = Math.max(this.camShake, 0.25);
    this.rumbleAt(p, 0.9, 0.6, 320, splash + 25);
  }
  resize() {
    const w = innerWidth,
      h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.postResize(w, h);
    this.hudC.width = w * devicePixelRatio;
    this.hudC.height = h * devicePixelRatio;
    this.hudC.style.width = w + 'px';
    this.hudC.style.height = h + 'px';
    this.hctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  showScreen(id) {
    for (const s of document.querySelectorAll('#ui .screen')) s.classList.toggle('on', s.id === id);
    document.getElementById('hudWrap').style.display = id === '' ? 'block' : 'none';
    if (this.updateVpad) this.updateVpad();
  }
  // ---------- loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.lastDt = dt;
    this.pollGamepad(dt);
    if ((this.frames & 15) === 0) this.updateVpad();
    if (this.state === 'play' || this.state === 'ending') {
      const pace = this.net && this.net.role === 'client' ? this.hostPace || 1 : this.ctrl.pace || 1;
      dt *= pace;
      this.lastDt = dt;
    }
    if (this.fx.hitStop > 0) {
      this.fx.hitStop -= dt;
      dt *= 0.25;
    }
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT > 0.5) {
      document.getElementById('fps').textContent = 'FPS:' + Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
    if (this.state === 'garage') {
      if (this.garageMech) {
        this.garageMech.group.rotation.y += dt * 0.5;
        animateMech(this.garageMech, dt, {
          pose: 'garage',
          moving: false,
          grounded: true,
          hover: false,
          boost: false,
          aimPitch: 0,
          t: now / 1000,
        });
      }
      const w = innerWidth,
        h = innerHeight;
      this.garageCam.aspect = w / h;
      this.garageCam.updateProjectionMatrix();
      if (this.post.enabled && this.garagePipe) this.garagePipe.render(this.styleP, now / 1000);
      else this.renderer.render(this.garageScene, this.garageCam);
      this.hctx.clearRect(0, 0, w, h);
      return;
    }
    if (
      this.state === 'title' ||
      this.state === 'result' ||
      this.state === 'mp' ||
      this.state === 'lobby' ||
      (this.state === 'settings' && this.settingsFrom !== 'pause')
    ) {
      if (this.world) {
        this.renderMain();
      } else {
        this.renderer.setClearColor(0x0c1016);
        this.renderer.clear();
      }
      this.hctx.clearRect(0, 0, innerWidth, innerHeight);
      return;
    }
    if (this.state === 'pause' || this.state === 'settings') {
      this.renderMain();
      return;
    }
    // play
    if (this.lab) {
      this.labTick(dt); // 渲染風格實驗室的模擬戰鬥（game/style-lab.js）
      return;
    }
    if (this.freezeT > 0) {
      this.freezeT -= dt;
      if (this.pvp && !(this.net && this.net.role === 'client')) this.pvpTick(dt);
      this.renderMain();
      this.drawHud(0);
      return;
    }
    if (this.net && this.net.role === 'client') {
      this.time += dt;
      this.missionT += dt;
      this.clientTick(dt);
      this.updateMapExtras(dt);
      if (!this.player) {
        this.renderMain();
        return;
      }
      this.fx.update(dt);
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const q = this.popups[i];
        q.life -= dt;
        q.pos.y += dt * 2.5;
        if (q.life <= 0) this.popups.splice(i, 1);
      }
      if (this.csCd) for (const k in this.csCd) if (this.csCd[k] > 0) this.csCd[k] -= dt;
      this.updateCamera(dt);
      SFX.setListener((this.camFocus || this.player).center());
      this.updateLoops();
      this.renderMain();
      if (this.spectator) this.drawSpectateHud(dt);
      else this.drawHud(dt);
      return;
    }
    this.missionT += dt;
    this.time += dt;
    if (!this.player.dead && !this.player.downed) this.updatePlayer(dt);
    else this.player.move(dt, new THREE.Vector3(), false, false, false, null);
    if (this.pvp) this.pvpTick(dt);
    if (this.net && this.net.role === 'host') {
      this.hostTick(dt);
      if (!this.pvp && this.players.every((p) => p.dead || p.downed) && this.state === 'play') {
        this.state = 'ending';
        this.flashMsg('全員倒下 — 任務失敗', 0xff4d4d, 2.5);
        setTimeout(() => this.endMission(false, false), 2500);
      }
    }
    this.updateMapExtras(dt);
    for (const e of this.enemies) {
      if (!e.dead) e.updateAI(dt);
    }
    this.separateMechs(dt);
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      if (!a.dead) a.updateAI(dt);
      else {
        a.cleanup();
        this.allies.splice(i, 1);
      }
    }
    if (this.csCd) for (const k in this.csCd) if (this.csCd[k] > 0) this.csCd[k] -= dt;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);
      if (p.dead) this.projectiles.splice(i, 1);
    }
    this.fx.update(dt);
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const q = this.popups[i];
      q.life -= dt;
      q.pos.y += dt * 2.5;
      if (q.life <= 0) this.popups.splice(i, 1);
    }
    // waves
    const alive = this.enemies.filter((e) => !e.dead).length;
    if (alive === 0 && this.waves.length) {
      const w = this.waves.shift();
      this.flashAlert('敵方增援抵達');
      for (const t of w) this.spawnType(t, this.scaleHp, this.scaleDmg);
    } else if (
      this.isBossLevel &&
      this.bosses &&
      this.bosses.some((b) => !b.dead) &&
      this.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0) <
        this.bosses.reduce((a, b) => a + b.maxHp, 0) * 0.5 &&
      this.waves.length &&
      !this.waveAlerted
    ) {
      this.waveAlerted = true;
      const w = this.waves.shift();
      this.flashAlert('敵方增援抵達');
      for (const t of w) this.spawnType(t, this.scaleHp, this.scaleDmg);
    } else if (
      !this.pvp &&
      alive === 0 &&
      !this.waves.length &&
      this.playersAlive().length &&
      this.state === 'play'
    ) {
      this.state = 'ending';
      this.flashMsg('任務完成', 0x7ee081, 2);
      setTimeout(() => this.endMission(true, false), 1800);
    }
    this.updateCamera(dt);
    SFX.setListener((this.camFocus || this.player).center());
    this.updateLoops();
    this.renderMain();
    this.drawHud(dt);
  }
}
