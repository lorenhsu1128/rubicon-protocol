// ============================================================
//  GAME
// ============================================================
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Effects } from '../fx/effects.js';
import { animateMech } from '../render/mech-model.js';
import { targetDist } from '../world/prop-hit.js';

// 距離分級（lodTick）與 AI 分批（aiStep）的門檻
const LOD_IK_DIST = 60; // 離鏡頭這麼遠（m）以上不跑 IK
const LOD_SHADOW_DIST = 90; // 離鏡頭這麼遠（m）以上不投影（陰影貼圖的範圍是鏡頭注視點 ±70 m）
const AI_BATCH_MIN = 64; // 場上的敵人＋友軍達到這個數量才分批更新 AI
const AI_BATCH_NEAR = 45; // 離玩家這麼近（m）的照常每格更新
const LOD_LIST = [];
const _lodM = new THREE.Matrix4(),
  _lodF = new THREE.Frustum(),
  _lodS = new THREE.Sphere();

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
    this.sun.shadow.normalBias = 0.04; // 沿法線推開：GLB 的平滑法線低面數模型不會自己遮自己出現條紋
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
    this.initSaves();
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
    this.levelsInit(); // 自訂關卡的選單（levels.js）
    this.edInit(); // 關卡編輯器（editor.js）
    this.rtsInit(); // Coral 戰爭（rts.js）
    // 冒煙測試用：網址帶 ?test 時把遊戲實例放在 window.__game（檢查各機甲用的模型組）
    if (/[?&]test\b/.test(location.search)) {
      window.__game = this;
      window.__sfx = SFX; // 冒煙測試檢查混音與回饋音
    }
    const sp = new URLSearchParams(location.search).get('spectate');
    if (sp && window.RUBICON_SERVER) {
      setTimeout(() => {
        SFX.init();
        this.openMP();
        this.mpSpectate(sp);
      }, 600);
    }
    this.showScreen('title');
    requestAnimationFrame(() => this.loop());
  }
  updateLoops() {
    const now = performance.now();
    this.audioTick(Math.min(0.1, (now - (this.audioT || now)) / 1000)); // 環境音、低 AP 心跳（game/feedback.js）
    this.audioT = now;
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
      if (a.noPush) continue; // Boss 的附屬部位、鑽地蟲
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.noPush) continue;
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
        if (t.stagGuardT > 0 && t.staggerT <= 0) {
          this.fx.ring(t.center(), 3, 0x6fb8ff);
          this.popDamage(t.center(), '抵抗', t.isPlayer, false, false, 0, t.id, 0);
          continue;
        }
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
    // Coral 戰爭：依隊伍編號（含中立的第 3 隊）；rts.js 每格重建（呼叫端不要修改這個陣列）
    if (this.rts && e.rtsTeam !== undefined && this.rts.hostile) return this.rts.hostile[e.rtsTeam] || [];
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
    if (this.rts && a.rtsTeam !== undefined && b.rtsTeam !== undefined) return a.rtsTeam !== b.rtsTeam;
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
    this.hz2Blast(p, dmg, splash, 'exp'); // 臨時障礙物、油漬（hazards2.js）
    const targets = (all ? this.everyone(owner) : this.hostilesOfEnt(owner)).concat(
      this.destructibles(owner && owner.team),
    );
    for (const t of targets) {
      if (!t || t.dead) continue;
      const d = targetDist(t, p); // 物件以外形最近點算距離
      if (d < splash) {
        let k = clamp(1 - (d / splash) * 0.5, 0.4, 1) * this.groundBlastK(t, p);
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
        else t.takeDamage(dmg * k, im, owner, p, t.center().sub(p).normalize(), undefined, undefined, 'exp');
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
    if (id !== '' && this.hudC) {
      // 換到選單畫面：重設 HUD 畫布（清掉任務 HUD 的殘影與繪圖狀態）
      const w = this.hudC.width;
      this.hudC.width = 0;
      this.hudC.width = w;
      this.hctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }
    if (this.updateVpad) this.updateVpad();
    if (this.commPlace) this.commPlace();
    // 結果畫面的標題與評價（文字演出；內容在 showScreen 前後設定，所以等這段程式跑完）
    if (id === 'result' && this.tfxResult) Promise.resolve().then(() => this.tfxResult());
    if (id === 'title' && this.renderContinue) this.renderContinue();
    // 主線（單人）才有「保存並回作戰室」
    const susp = !!(this.camp && !this.campMp() && !this.sim && !this.lab);
    for (const b of document.querySelectorAll('.campSusp')) b.style.display = susp ? '' : 'none';
    for (const b of document.querySelectorAll('.rangeOnly')) b.style.display = this.range ? '' : 'none';
    // 自訂關卡的試玩：暫停選單的「放棄任務」＝回編輯器
    if (id === 'pause' && !this.lab)
      document.getElementById('btnAbort').textContent = this.rts
        ? '放棄（回 Coral 戰爭選單）'
        : this.lv && this.lv.test
          ? '回編輯器'
          : '放棄任務';
  }
  // ---------- loop ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    this.renderer.shadowMap.needsUpdate = true; // 陰影貼圖每格只畫一次（render/style/pipeline.js 的 manualShadows）
    this.fx.view = null; // 粒子的畫面外判斷只在任務中（lodTick 設定）
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    this.lastDt = dt;
    this.tfxTick(); // 文字演出（game/textfx.js）
    this.pollGamepad(dt);
    if (this.camp && this.camp.wait) this.campWaitTick(); // 主線多人：轉場中等待隊友（不靠會被節流的計時器）
    if ((this.frames & 15) === 0) this.updateVpad();
    // 一般任務的節奏設定（ctrl.pace）；Coral 戰爭（含親自駕駛時 state 'play'）一律原速，不拖慢整個模擬
    if ((this.state === 'play' || this.state === 'ending') && !this.rts) {
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
    this.fpMenuUnlock(); // 選單打開時放開滑鼠鎖定（first-person.js）
    if (this.state === 'cine') {
      this.cineTick(dt); // 過場動畫（game/cine.js）
      return;
    }
    if (this.state === 'editor') {
      this.edTick(dt); // 關卡編輯器（editor.js）
      return;
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
      this.state === 'saves' ||
      this.state === 'result' ||
      this.state === 'mp' ||
      this.state === 'lobby' ||
      this.state === 'camptrans' ||
      this.state === 'hub' ||
      this.state === 'brief' ||
      this.state === 'sim' ||
      this.state === 'record' ||
      this.state === 'epilogue' ||
      this.state === 'story' ||
      this.state === 'cinelib' ||
      this.state === 'campfail' ||
      this.state === 'rangemenu' ||
      this.state === 'levels' ||
      this.state === 'rtsmenu' ||
      this.state === 'rtsend' ||
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
    if (this.state === 'modpick' && !this.world) {
      this.renderer.setClearColor(0x0c1016);
      this.renderer.clear();
      return;
    }
    if (
      this.state === 'pause' ||
      this.state === 'settings' ||
      this.state === 'modpick' ||
      this.state === 'rangecfg'
    ) {
      this.renderMain();
      return;
    }
    // Coral 戰爭（RTS）：rts.js 的 rtsTick 接手更新與算繪（沒有玩家的機甲）
    if (this.state === 'rts' || (this.state === 'play' && this.rts)) {
      // 親自駕駛（rts-pilot.js）時 state 是 'play'（一般任務的輸入），更新仍由 rtsTick 接手
      if (this.rts) this.rtsTick(dt);
      else this.renderMain();
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
      this.lodTick(); // 距離分級：遠處與畫面外的 IK、陰影、粒子
      this.clientTick(dt);
      this.updateMapExtras(dt);
      this.updateSupport(dt);
      if (this.lv) this.lvVisTick(dt);
      if (!this.player) {
        this.renderMain();
        return;
      }
      this.fx.update(dt);
      this.tickPopups(dt);
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
        if (this.camp)
          this.campDead(true); // 主線：回到紀錄點
        else if (this.lv) {
          this.state = 'play';
          this.lvEnd(false, '全員倒下');
        } else setTimeout(() => this.endMission(false, false), 2500);
      }
    }
    this.updateMapExtras(dt);
    this.aiDirectorTick(dt); // 敵人 AI：攻擊權杖、節奏導演（ai-director.js）
    this.lodTick(); // 距離分級：遠處與畫面外的 IK、陰影、粒子
    const batch = this.aiBatchOn();
    for (const e of this.enemies) {
      if (!e.dead) this.aiStep(e, dt, batch);
    }
    this.separateMechs(dt);
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      if (!a.dead) this.aiStep(a, dt, batch);
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
    this.updateShocks(dt);
    this.updateSupport(dt);
    this.updateHazards(dt);
    this.fx.update(dt);
    this.tickPopups(dt);
    // waves
    const alive = this.enemies.filter((e) => !e.dead && !e.guardOf && !e.decoy).length; // 據點的守衛、全像的假敵人不算
    this.cacheTick(dt);
    if (this.lv) {
      this.lvTick(dt); // 自訂關卡：觸發器、機能物件、勝敗（game/level-play.js）
    } else if (!this.isBossLevel && (this.waves.length || this.wavePend)) {
      this.waveTick(dt); // 一般戰鬥：剩下少數時派出下一波（game/waves.js）
    } else if (alive === 0 && this.waves.length) {
      const w = this.waves.shift();
      this.flashAlert('敵方增援抵達');
      for (const t of w) this.spawnType(t, this.scaleHp, this.scaleDmg);
    } else if (this.isBossLevel && this.bosses && this.bosses.some((b) => !b.dead)) {
      this.bossPhaseTick(dt); // Boss 的三個型態、換型態的增援、狂暴（bosses.js）
    } else if (
      !this.pvp &&
      !this.range &&
      alive === 0 &&
      !this.waves.length &&
      this.playersAlive().length &&
      this.state === 'play'
    ) {
      if (this.camp) {
        if (!this.camp.cleared) this.campCleared(); // 主線：開出口，最後一段才結束
      } else if (this.sim) {
        this.state = 'ending';
        this.flashMsg('模擬目標全滅', 0x7ee081, 2);
        setTimeout(() => this.sim && this.simEnd(true), 1500);
      } else if (!this.extractStart()) {
        // 自由出擊：還有補給箱時先給撤離時間（game/outposts.js）
        this.state = 'ending';
        this.flashMsg('任務完成', 0x7ee081, 2, { k: 'done', m: '任務完成' });
        setTimeout(() => this.endMission(true, false), 1800);
      }
    }
    if (this.camp) {
      this.campTick(dt);
      if (!this.player) return; // 走進出口：已經轉場
    }
    if (this.range) this.rangeTick(dt); // 靶場（range.js）
    this.updateCamera(dt);
    SFX.setListener((this.camFocus || this.player).center());
    this.updateLoops();
    this.renderMain();
    this.drawHud(dt);
  }
  // ---------- 距離分級（LOD）----------
  // 每格依上一格的鏡頭決定各機體的 IK 與陰影：離鏡頭遠（lodIkDist）或在畫面外的不跑 IK（權重淡出後略過，
  // render/mech-ik.js），離鏡頭更遠（lodShadowDist）的不投影；有遲滯，不會在門檻附近來回切換。
  // this.lod＝false 時全部關掉（量測與比較用）。自己的機體一律照常
  lodTick() {
    const cam = this.camera;
    const list = LOD_LIST;
    list.length = 0;
    for (const e of this.enemies) list.push(e);
    for (const e of this.allies) list.push(e);
    if (this.players) for (const e of this.players) list.push(e);
    const off = this.lod === false;
    const ikD = this.lodIkDist || LOD_IK_DIST,
      shD = this.lodShadowDist || LOD_SHADOW_DIST;
    if (!off) {
      cam.updateMatrixWorld();
      _lodM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      _lodF.setFromProjectionMatrix(_lodM);
    }
    this.fx.view = off ? null : _lodF; // 粒子很多時略過畫面外的小粒子、遠處的減量（fx/effects.js 的 skip／far）
    this.fx.viewPos.copy(cam.position);
    const cp = this.lodFrom || cam.position; // RTS 渲染設定：以鏡頭注視點計算（鏡頭很高）
    const rr = this.rtsR;
    if (rr) rr.lodDone = true;
    for (const e of list) {
      if (!e || e.dead || !e.mesh) continue;
      if (off || e === this.player || e === this.camFocus) {
        e.lodIk = false;
        e.lodVis = true;
        if (e.shLodOff && !(rr && !e.bld && !e.hero)) e.setShadowLod(true);
        continue;
      }
      const d = Math.sqrt(cp.distanceToSquared(e.pos));
      const h = (e.model && e.model.height ? e.model.height : 4) * (e.scale || 1);
      _lodS.center.set(e.pos.x, e.pos.y + h * 0.5, e.pos.z);
      _lodS.radius = h * 0.75 + 3; // 留一點邊：進入畫面前先淡入
      const vis = _lodF.intersectsSphere(_lodS);
      e.lodVis = vis; // 在畫面內（RTS 的單位在畫面外時降低動作與推進器的更新，MechEntity.move）
      e.lodIk = !vis || d > (e.lodIk ? ikD * 0.92 : ikD);
      // 全像的假敵人自己關掉陰影，不碰；RTS 渲染設定的單位不投影（render-setup.js 的 rtsRenderTick），建築與英雄照常
      if (!e.decoy && !(rr && !e.bld && !e.hero)) e.setShadowLod(d < (e.shLodOff ? shD * 0.92 : shD));
    }
    list.length = 0;
  }
  // ---------- AI 分批 ----------
  // this.aiBatch：true＝一律、false＝不分批、其他（預設）＝場上的敵人＋友軍達到 AI_BATCH_MIN 才分批，
  // 所以一般任務照原本每格更新。只在房主／單機（客機不跑 AI）
  aiBatchOn() {
    if (this.aiBatch === true || this.aiBatch === false) return this.aiBatch;
    return this.enemies.length + this.allies.length >= AI_BATCH_MIN;
  }
  // 幾格更新一次 AI：離任何玩家 AI_BATCH_NEAR 以內＝每格；交戰中＝2 格；待機、起疑、搜索＝4 格
  aiBatchK(e) {
    if (!e.aiBatchable()) return 1;
    const pls = this.players && this.players.length ? this.players : [this.player];
    let dm = this.lodFrom ? this.lodFrom.distanceToSquared(e.pos) : Infinity; // RTS：鏡頭注視點附近照常每格
    for (const p of pls) if (p && !p.dead) dm = Math.min(dm, p.pos.distanceToSquared(e.pos));
    if (dm < AI_BATCH_NEAR * AI_BATCH_NEAR) return 1;
    return e.sn && e.sn.st !== 2 ? 4 : 2;
  }
  // 一台機體這一格的 AI：分批時跳過的格子只移動（aiCoast），輪到的格子以累積的 dt 呼叫 updateAI
  // （移動仍用這一格的 dt：MechEntity.move 的 aiFrame）。測試直接呼叫 updateAI 的不經過這裡
  aiStep(e, dt, batch) {
    if (!batch) {
      e.aiLast = null; // 之後再分批時不沿用很久以前的移動輸入
      if (!e.aiAcc) return e.updateAI(dt);
      // 剛關掉分批：把累積的時間補給 AI
      const acc = e.aiAcc + dt;
      e.aiAcc = 0;
      e.aiFrame = dt;
      try {
        e.updateAI(acc);
      } finally {
        e.aiFrame = 0;
      }
      return;
    }
    const k = this.aiBatchK(e);
    if (e.aiN === undefined) e.aiN = (e.id || 0) % 4; // 錯開各台的更新格，負載平均
    e.aiN++;
    const acc = (e.aiAcc || 0) + dt;
    if (k > 1 && e.aiN % k !== 0 && e.aiLast) {
      e.aiAcc = acc;
      e.aiCoast(dt);
      return;
    }
    e.aiAcc = 0;
    e.aiFrame = dt;
    try {
      e.updateAI(acc);
    } finally {
      e.aiFrame = 0;
    }
  }
}
