// Game：過場動畫（開場、各章的開場／章末；劇本資料在 data/cine/）。遊戲內即時演算：
//  - 時間軸以配樂的 AudioContext 時間為準（換場景卡住時畫面跳過去，聲音不斷）
//  - 鏡頭（關鍵影格、跟拍、環繞、手持晃動、震動、變焦）、演員（遊戲的機甲實體，照劇本走位與開火，或交給 AI）、
//    模型演員（空降艙、Boss 模型、列車…照關鍵影格移動）、事件（音效、特效、字幕、字卡、閃白、慢動作）
//  - 場景：black（黑畫面）、space（render/cine-sets.js 的太空）、world（遊戲的地圖主題，換場景時重建）
//  - 畫面：渲染風格＋過場的調色與景深、遮幅（2.39:1）、字幕、文字演出的字卡、HUD 畫布上的光暈與疊加效果
// state 'cine'；長按 Esc／Enter／空白鍵／手把 A、B、Start（觸控長按畫面）略過。多人不播。
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { escHtml } from '../core/html.js';
import { CINES } from '../data/cine/index.js';
import { ACES, FOES } from '../data/foes.js';
import { AC_ROSTER, ENEMY_TYPES } from '../data/enemies.js';
import { SPEAKERS } from '../data/story.js';
import { MechEntity } from '../entities/mech-entity.js';
import { buildBossModel } from '../render/boss-models.js';
import { SPACE_SUN, buildCrashSite, buildPod, buildSpaceSet } from '../render/cine-sets.js';
import { PALETTES } from '../render/materials.js';
import { buildMech } from '../render/mech-model.js';
import { revealDom } from '../render/textfx.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const smooth = (x) => x * x * (3 - 2 * x);
const D2R = Math.PI / 180;
// 過場的調色（疊在玩家選的渲染風格上）：暗角、底片顆粒、色差、動態模糊、Bloom 下限
const CINE_GRADE = { vignette: 0.42, grain: 0.16, chroma: 0.18, mblur: true, mblurK: 0.18, mblurMech: 0.35 };
const SKIP_HOLD = 0.8; // 長按幾秒略過

Object.assign(Game.prototype, {
  // 設定「劇情動畫」：on（預設）／off（改用原本的文字畫面）；多人與文字演出關閉時不播
  cineAllowed() {
    return (this.ctrl.cine || 'on') !== 'off' && !(this.net && this.net.role);
  },
  // 故事畫面的鍵（p1、i1_2、o1_2）有沒有對應的過場動畫
  cineFor(key) {
    return CINES[key] ? key : null;
  },
  // 配樂：第一次播放時以 <script> 載入 lib/cine-music.js（約 4 MB，不內嵌在遊戲的 HTML 裡）
  cineMusicLoad() {
    if (window.RUBICON_MUSIC) return Promise.resolve(true);
    if (this.cineMusicP) return this.cineMusicP;
    this.cineMusicP = new Promise((res) => {
      const s = document.createElement('script');
      s.src = 'lib/cine-music.js';
      s.onload = () => res(!!window.RUBICON_MUSIC);
      s.onerror = () => {
        this.cineMusicP = null;
        res(false);
      };
      document.head.appendChild(s);
      setTimeout(() => res(!!window.RUBICON_MUSIC), 15000);
    });
    return this.cineMusicP;
  },
  // ---------- 播放 ----------
  // key：CINES 的鍵；done：播完或略過後呼叫；opt.ctx：給劇本產生器的資料（周目、抉擇）；opt.at：從第幾秒開始（測試）
  async cinePlay(key, done, opt = {}) {
    const make = CINES[key];
    if (!make) return done && done();
    SFX.init();
    if (SFX.ctx && SFX.ctx.state === 'suspended') SFX.ctx.resume();
    this.commClear && this.commClear();
    this.clearMission();
    const def = make({ cycle: 1, choices: {}, ...(opt.ctx || {}) });
    if (!def) return done && done();
    const c = (this.cine = {
      key,
      def,
      done,
      t: opt.at || 0,
      t0: 0,
      started: false,
      shot: -1,
      setKey: '',
      set: null,
      actors: new Map(),
      fired: new Set(),
      shake: 0,
      slow: 0,
      slowK: 1,
      flash: null,
      skipT: 0,
      hintT: 0,
      subT: 0,
      look: new THREE.Vector3(),
      music: [],
      musicOk: false,
      P: { ...this.styleP },
      cam0: { fov: this.camera.fov, near: this.camera.near, far: this.camera.far },
    });
    this.state = 'cine';
    this.showScreen('cineScr');
    this.cineUi(true);
    $('cineFade').style.background = '#000';
    $('cineFade').style.opacity = 1;
    $('cineLoad').classList.add('on');
    // 配樂與字型：最多等 4 秒（沒有配樂也照樣播）
    const load = this.cineMusicLoad().then(async (has) => {
      if (!has) return false;
      const names = [...new Set(def.music.map((m) => m.track))];
      await Promise.all(names.map((n) => SFX.musicDecode(n, window.RUBICON_MUSIC[n])));
      return true;
    });
    // 等太久（電腦慢、網路慢）就先開始播；配樂好了再從目前的時間接上
    load.then((has) => {
      if (has && this.cine === c && c.started && !c.musicOk) {
        c.musicOk = true;
        this.cineMusic(c.t);
      }
    });
    const ok = await Promise.race([
      load,
      new Promise((r) => setTimeout(() => r(false), this.cineTest ? 1500 : 6000)),
    ]);
    if (this.cine !== c) return; // 等待中被略過
    $('cineLoad').classList.remove('on');
    c.musicOk = ok;
    this.cineStartClock(c.t);
  },
  // 從第 t 秒開始：配樂依 ctx 時間排程
  cineStartClock(t) {
    const c = this.cine;
    SFX.musicStop(0.05);
    c.music = [];
    const ctx = SFX.ctx;
    c.clockAudio = !!(ctx && ctx.state === 'running' && !this.cineTest);
    c.t = t;
    c.real0 = performance.now() / 1000;
    c.tBase = t;
    if (ctx) c.t0 = ctx.currentTime - t;
    this.cineMusic(t);
    c.started = true;
    c.fired = new Set();
    c.shot = -1;
    this.cineStartReset(c);
  },
  // 配樂：從第 t 秒開始依 ctx 時間排程（c.t0＝第 0 秒的 ctx 時間）
  cineMusic(t) {
    const c = this.cine,
      ctx = SFX.ctx;
    if (ctx && c.musicOk)
      for (const m of c.def.music) {
        const at = c.t0 + m.at;
        const off = Math.max(0, t - m.at) + (m.off || 0);
        const h = SFX.musicPlay(m.track, at, off, m.vol == null ? 1 : m.vol, t > m.at ? 0.3 : m.fadeIn || 0);
        if (h && m.fadeOut) SFX.musicFadeAt(h, c.t0 + m.fadeOut[0], m.fadeOut[1]);
        if (h) c.music.push(h);
      }
  },
  cineStartReset(c) {
    // 跳時間：清掉字幕、機器文字與字卡
    c.subUntil = c.sysUntil = 0;
    $('cineSub').classList.remove('on');
    $('cineSys').innerHTML = '';
    if (this.textfx) this.textfx.clear((x) => x.opt && x.opt.cine);
  },
  // 測試用：全部的劇本產生一次（ctx：{ cycle, choices }），回傳 [{ k, n 鏡頭數, dur }]
  cineDefs(ctx) {
    return Object.keys(CINES).map((k) => {
      const d = CINES[k]({ cycle: 1, choices: {}, ...(ctx || {}) });
      return {
        k,
        n: d ? d.shots.length : 0,
        dur: d ? d.dur : 0,
        subs: d ? d.shots.reduce((a, s) => a + (s.ev || []).filter((e) => e.sub).length, 0) : 0,
      };
    });
  },
  // 測試用：跳到第 t 秒
  cineSeek(t) {
    if (!this.cine) return;
    this.cineStartClock(t);
  },
  cineEnd(skipped) {
    const c = this.cine;
    if (!c) return;
    this.cine = null;
    SFX.musicStop(skipped ? 0.25 : 1.2);
    SFX.loopSet('cine', 'engineLoop', 0);
    SFX.stopLoops();
    this.cineClearSet(c);
    this.textfx && this.textfx.clear((x) => x.opt && x.opt.cine);
    this.cineUi(false);
    const cam = this.camera;
    cam.fov = c.cam0.fov;
    cam.near = c.cam0.near;
    cam.far = c.cam0.far;
    cam.up.set(0, 1, 0);
    cam.updateProjectionMatrix();
    this.camExtra = 0;
    this.stylePipe.rebase();
    this.stylePipe.resetHistory();
    this.hctx.clearRect(0, 0, innerWidth, innerHeight);
    const cv = $('cineCv');
    if (cv) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    this.state = 'title';
    if (c.done) c.done(skipped);
  },
  cineUi(on) {
    const el = $('cineScr');
    if (!el) return;
    el.classList.toggle('on', on);
    $('cineSub').classList.remove('on');
    $('cineSys').innerHTML = '';
    $('cineSkip').classList.remove('on');
    if (!on) {
      $('cineFade').style.opacity = 0;
      $('cineLoad').classList.remove('on');
    }
  },
  // ---------- 場景 ----------
  cineClearSet(c) {
    for (const a of c.actors.values()) this.cineDropActor(a);
    c.actors.clear();
    if (c.set && c.set.space) c.set.space.dispose();
    if (c.set && c.set.extra) for (const o of c.set.extra) this.scene.remove(o);
    c.set = null;
    c.setKey = '';
    this.clearMission();
    this.world = null;
  },
  cineBuildSet(c, S) {
    const key = JSON.stringify(S);
    if (key === c.setKey && c.set) return;
    this.cineClearSet(c);
    c.setKey = key;
    const set = (c.set = { spec: S, anchor: new THREE.Vector3(), extra: [] });
    const cam = this.camera;
    if (S.k === 'space') {
      set.space = buildSpaceSet(this.scene);
      if (S.coral != null) set.space.pu.coral.value = S.coral;
      this.scene.background = new THREE.Color(0x000000);
      this.scene.fog = null;
      this.hemi.color.set(0x8090a0);
      this.hemi.groundColor.set(0x101418);
      this.hemi.intensity = 0.34;
      this.sun.color.set(0xfff4e6);
      this.sun.intensity = 1.6;
      cam.near = 1;
      cam.far = 9000;
      SFX.ambStop();
      SFX.setReverb(3.5, 0.18);
    } else if (S.k === 'world') {
      const w = (this.world = new World(this.scene, S.theme, S.seed || 7001, 3, null, {
        variant: S.variant || undefined,
        tod: S.tod || '',
        rail: !!S.rail,
        road: !!S.road,
        zone: 'full',
      }));
      this.worldTheme = S.theme;
      this.worldSeed = S.seed || 7001;
      w.applyLight(this);
      const L = S.light;
      if (L) {
        if (L.sky) this.scene.background = new THREE.Color(L.sky);
        if (L.fog && this.scene.fog) this.scene.fog.color.set(L.fog);
        if (L.near && this.scene.fog) this.scene.fog.near = L.near;
        if (L.far && this.scene.fog) this.scene.fog.far = L.far;
        if (L.sun) this.sun.color.set(L.sun);
        if (L.sunI != null) this.sun.intensity = L.sunI;
        if (L.hemi) this.hemi.color.set(L.hemi);
        if (L.hemiI != null) this.hemi.intensity = L.hemiI;
      }
      cam.near = 0.5;
      cam.far = S.far || 700;
      // 鐵路對齊：原點放在鐵路上、局部 +X 沿著鐵路
      if (S.align === 'rail' && w.corridor) {
        const p = w.corridorPoint(-w.trackS * 0.25, 0),
          d = w.corridorDir(-w.trackS * 0.25);
        set.anchor.copy(p);
        set.yaw = Math.atan2(-d.y, d.x); // d 是 XZ 平面的 Vector2（y＝z）
      } else {
        const a = this.cineSpot(w, S.anchor || [0, 0], S.clear || 22);
        set.anchor.set(a.x, w.terrainHeight(a.x, a.z), a.z);
      }
      this.audioScene();
      if (this.isClient !== false) this.isClient = false;
      this.cineStage();
    } else {
      this.scene.background = new THREE.Color(0x000000);
      this.scene.fog = null;
      SFX.ambStop();
    }
    cam.updateProjectionMatrix();
    this.stylePipe.rebase();
    this.stylePipe.resetHistory();
  },
  // 演員要用的任務狀態（和實驗室相同的最小集合）
  cineStage() {
    this.net.spawnReg = {};
    this.mpStats = { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } };
    this.enemies = [];
    this.allies = [];
    this.players = [];
    this.waves = [];
    this.bosses = [];
    this.boss = null;
    this.isBossLevel = false;
    this.missionT = 0;
    this.scaleHp = 1;
    this.scaleDmg = 1;
    this.bountyPops = [];
    this.player = null;
  },
  // 找一塊平坦、沒有障礙物的空地當這個場景的原點
  cineSpot(w, at, R) {
    const ok = (x, z) => {
      if (Math.abs(x) > w.lim - 6 || Math.abs(z) > w.lim - 6) return false;
      if (w.isVoid && w.isVoid(x, z)) return false;
      const h0 = w.terrainHeight(x, z);
      for (let a = 0; a < 8; a++) {
        const r = R * 0.8,
          px = x + Math.cos(a * 0.785) * r,
          pz = z + Math.sin(a * 0.785) * r;
        if (Math.abs(w.terrainHeight(px, pz) - h0) > 2.5) return false;
      }
      return !w.obstacles.some((o) =>
        o.kind === 'box'
          ? Math.abs(x - o.x) < o.w / 2 + R * 0.6 && Math.abs(z - o.z) < o.d / 2 + R * 0.6
          : Math.hypot(x - o.x, z - o.z) < (o.r || 2) + R * 0.6,
      );
    };
    // 找不到那麼大的空地時逐步縮小半徑
    const R0 = R;
    for (const k of [1, 0.75, 0.5, 0.3]) {
      R = R0 * k;
      for (let i = 0; i < 400; i++) {
        const r = i * 0.9,
          a = i * 2.4;
        const x = at[0] + Math.cos(a) * r,
          z = at[1] + Math.sin(a) * r;
        if (ok(x, z)) return { x, z };
      }
    }
    return { x: at[0], z: at[1] };
  },
  // ---------- 座標 ----------
  // 點的寫法：[x, y, z]（相對場景原點）、{ a: 演員, o: [x, y, z], loc: 依演員朝向, at: 'c'|'base'|'head' }、
  // { g: [x, z], h }（貼地，h＝離地高度）
  cinePt(p, out = new THREE.Vector3()) {
    const c = this.cine;
    const A = (c.set && c.set.anchor) || new THREE.Vector3();
    const yaw = (c.set && c.set.yaw) || 0;
    // 場景的局部座標（可能沿鐵路旋轉）→ 世界
    const rx = (x, z) => (yaw ? x * Math.cos(yaw) + z * Math.sin(yaw) : x),
      rz = (x, z) => (yaw ? -x * Math.sin(yaw) + z * Math.cos(yaw) : z);
    if (!p) return out.copy(A);
    if (Array.isArray(p)) return out.set(A.x + rx(p[0], p[2]), A.y + p[1], A.z + rz(p[0], p[2]));
    if (p.st) {
      // 軌道站的局部座標（太空場景）
      const st = c.set && c.set.space && c.set.space.station.group;
      out.set(p.st[0], p.st[1], p.st[2]);
      if (st) {
        st.updateMatrixWorld();
        out.applyMatrix4(st.matrixWorld);
      }
      return out;
    }
    if (p.g) {
      const x = A.x + rx(p.g[0], p.g[1]),
        z = A.z + rz(p.g[0], p.g[1]);
      return out.set(x, (this.world ? this.world.terrainHeight(x, z) : A.y) + (p.h || 0), z);
    }
    if (p.a) {
      const ac = c.actors.get(p.a);
      if (!ac) return out.copy(A);
      let base, ay;
      if (ac.e) {
        const e = ac.e;
        base = p.at === 'base' ? e.pos.clone() : e.center();
        if (p.at === 'head') base.y = e.pos.y + (e.model.height || 4) * 0.92 * (e.scale || 1);
        ay = e.yaw;
      } else {
        base = (ac.head || ac.obj).getWorldPosition(new THREE.Vector3());
        ay = ac.obj.rotation.y;
      }
      const o = p.o ? V(p.o) : new THREE.Vector3();
      o.applyAxisAngle(new THREE.Vector3(0, 1, 0), p.loc ? ay : yaw);
      return out.copy(base).add(o);
    }
    return out.copy(A);
  },
  // ---------- 每格 ----------
  cineTick(dt) {
    const c = this.cine;
    if (!c) return;
    this.cineInput();
    if (!this.cine) return;
    if (!c.started) {
      this.renderer.setClearColor(0x000000);
      this.renderer.clear();
      return;
    }
    // 時間：配樂的 AudioContext 時間（卡住後畫面直接跳過去）；測試時用實際時間×速度
    if (c.clockAudio && SFX.ctx && SFX.ctx.state === 'running') c.t = SFX.ctx.currentTime - c.t0;
    else c.t = c.tBase + (performance.now() / 1000 - c.real0) * (this.cineTest || 1); // 沒有配樂時：實際經過的時間（測試可加速）
    const t = c.t;
    const def = c.def;
    if (t >= def.dur) return this.cineEnd(false);
    // 目前的鏡頭
    let si = 0;
    for (let i = 0; i < def.shots.length; i++) if (def.shots[i].at <= t) si = i;
    if (si !== c.shot) this.cineEnterShot(si);
    const S = def.shots[si];
    const lt = t - S.at;
    // 事件
    const evs = S.ev || [];
    for (let i = 0; i < evs.length; i++) {
      const id = si + ':' + i;
      if (evs[i].t <= lt && !c.fired.has(id)) {
        c.fired.add(id);
        // 晚太多（卡住或跳過）的音效與特效不補播，字幕與動作照樣執行
        const late = lt - evs[i].t > 0.6 && (evs[i].sfx || evs[i].fx || evs[i].boom);
        if (!late) this.cineEvent(evs[i], S);
      }
    }
    // 慢動作只影響模擬（鏡頭與配樂照常）
    if (c.slow > 0) {
      c.slow -= dt;
      if (c.slow <= 0) c.slowK = 1;
    }
    const sdt = Math.min(dt, 0.05) * c.slowK;
    this.cineActors(sdt, t);
    this.cineSim(sdt);
    this.cineCamera(S, lt, dt);
    if (c.set && c.set.space) c.set.space.update(t, this.camera);
    this.cineOverlay(S, lt, dt);
    SFX.setListenerCam(this.camera);
    this.renderMain();
  },
  cineEnterShot(si) {
    const c = this.cine,
      S = c.def.shots[si];
    const prev = c.shot;
    c.shot = si;
    const key0 = c.setKey;
    this.cineBuildSet(c, S.set || { k: 'black' });
    // 場景剛建好（或時間跳過了前面的鏡頭）：同一個場景前面幾鏡的演員也要補上
    const shots = c.def.shots;
    const sk = JSON.stringify(S.set || { k: 'black' });
    if (c.setKey !== key0 || si !== prev + 1) {
      let j = si;
      while (j > 0 && JSON.stringify(shots[j - 1].set || { k: 'black' }) === sk) j--;
      const live = new Map();
      for (let k = j; k < si; k++) {
        for (const id of shots[k].drop || []) live.delete(id);
        for (const a of shots[k].actors || []) live.set(a.id, [a, shots[k].at]);
      }
      for (const id of S.drop || []) live.delete(id);
      for (const [id, [spec, at]] of live) if (!c.actors.has(id)) this.cineAddActor(spec, at);
    }
    // 演員：drop 的移除；新的加入（同一個場景、同 id 的沿用）
    for (const id of S.drop || []) {
      const a = c.actors.get(id);
      if (a) this.cineDropActor(a);
      c.actors.delete(id);
    }
    for (const spec of S.actors || []) if (!c.actors.has(spec.id)) this.cineAddActor(spec, S.at);
    c.P = { ...this.styleP, ...CINE_GRADE, ...(c.def.grade || {}), ...(S.grade || {}) };
    if (S.set && S.set.k === 'space') {
      Object.assign(c.P, { sky: 'theme', dust: 0, fogColorK: 0, hfog: 0, ssao: 0 });
      // 太陽方向可以每一鏡不同（S.sun）
      if (c.set.space) c.set.space.pu.sunDir.value.copy(S.sun ? V(S.sun).normalize() : SPACE_SUN);
    }
    if (!S.set || S.set.k === 'black') c.P.mblur = false;
    if (S.cam && S.cam.fog) this.camExtra = S.cam.fog;
    else this.camExtra = 0;
    c.cut = prev !== si;
    this.stylePipe.resetHistory();
  },
  // ---------- 演員 ----------
  cineAddActor(spec, shotAt) {
    const c = this.cine;
    const A = {
      id: spec.id,
      spec,
      t0: shotAt,
      si: 0,
      pup: { goal: null, aim: null, fire: {}, hover: false, ab: false },
    };
    const p0 = spec.p || (spec.keys && spec.keys[0].p) || [0, 0, 0];
    const parent = spec.parent === 'station' && c.set && c.set.space ? c.set.space.station.group : null;
    const pos = parent
      ? V(p0)
      : this.cinePt(p0.length === 2 ? { g: p0, h: spec.h || 0 } : p0, new THREE.Vector3());
    A.parent = parent;
    const fyaw = (c.set && c.set.yaw) || 0;
    if (
      spec.k === 'model' ||
      spec.k === 'pod' ||
      spec.k === 'crash' ||
      spec.k === 'worm' ||
      spec.k === 'train'
    ) {
      let obj;
      if (spec.k === 'pod') {
        A.pod = buildPod();
        obj = A.pod.group;
      } else if (spec.k === 'crash') {
        const cs = buildCrashSite();
        A.pod = cs.pod;
        obj = cs.group;
      } else if (spec.k === 'worm') {
        obj = new THREE.Group();
        const pal = PALETTES[spec.pal || 'boss'] || PALETTES.enemy;
        const head = buildBossModel('worm', pal, spec.scale || 1);
        A.head = head.group;
        A.segs = [];
        for (let i = 0; i < (spec.n || 9); i++) {
          const s = buildBossModel('joint', pal, (spec.scale || 1) * 1.5 * (1 - i * 0.035));
          A.segs.push(s.group);
          this.scene.add(s.group);
        }
        obj.add(A.head);
        A.trail = [];
      } else if (spec.k === 'train') {
        obj = new THREE.Group();
        const pal = PALETTES[spec.pal || 'boss'] || PALETTES.enemy;
        const keys = ['loco', 'car_aa', 'car_ms', 'car_lz', 'car_mine'];
        keys.forEach((k, i) => {
          const m = buildBossModel(k, pal, spec.scale || 1);
          m.group.position.z = i * 9.6 * (spec.scale || 1);
          obj.add(m.group);
        });
      } else {
        const m = spec.mech
          ? buildMech(spec.asm || this.save.asm, PALETTES[spec.pal] || PALETTES.player, spec.scale || 1, {
              source:
                spec.pal === 'player' && this.mechSource
                  ? this.mechSource({ team: 'player', slot: 0 })
                  : null,
            })
          : buildBossModel(spec.key, PALETTES[spec.pal || 'boss'] || PALETTES.enemy, spec.scale || 1);
        obj = m.group;
        A.rig = m;
      }
      obj.position.copy(pos);
      if (spec.yaw != null) obj.rotation.y = spec.yaw * D2R + fyaw;
      if (spec.rot) obj.rotation.set(spec.rot[0] * D2R, spec.rot[1] * D2R + fyaw, spec.rot[2] * D2R);
      A.fyaw = fyaw;
      (parent || this.scene).add(obj);
      A.obj = obj;
      c.actors.set(spec.id, A);
      return A;
    }
    // 機甲實體
    let asm, o;
    if (spec.k === 'hero') {
      asm = this.save.asm;
      o = { name: 'R-07', pal: 'player' };
    } else if (spec.k === 'ace') {
      const r = ACES[spec.key];
      asm = r.asm || this.foeRandomAsm();
      o = { name: r.name, pal: r.pal, ai: r.ai, wantDist: r.wantDist, speedMul: r.speedMul };
    } else if (spec.k === 'roster') {
      const r = AC_ROSTER[spec.key];
      asm = r.asm;
      o = { name: r.name, pal: r.pal, ai: r.ai, wantDist: r.wantDist, speedMul: r.speedMul };
    } else {
      const d = ENEMY_TYPES[spec.key] || FOES[spec.key];
      asm = d.gen();
      o = {
        name: d.name,
        pal: d.pal,
        scale: d.scale,
        ai: d.ai,
        flying: d.flying,
        hoverH: d.hoverH,
        modelKind: d.modelKind,
        vehKey: d.vehKey,
        radius: d.radius,
        turnRate: d.turnRate,
        wantDist: d.wantDist,
        speedMul: d.speedMul,
        etype: spec.key,
      };
    }
    const team = spec.team || (spec.k === 'hero' ? 'player' : 'enemy');
    const e = new MechEntity(this, asm, PALETTES[spec.pal || o.pal] || PALETTES.enemy, {
      ...o,
      team,
      palKey: spec.pal || o.pal,
      slot: spec.k === 'hero' ? 0 : undefined,
      hpMul: 60,
      allyDur: 1e9,
    });
    e.isPlayer = false;
    e.cine = true;
    e.ai = spec.ai ? o.ai || 'ac' : null;
    e.fpFace = !spec.ai;
    e.pos.copy(pos);
    if (e.flying) e.pos.y += e.hoverH || 6;
    e.yaw = e.aimYaw = (spec.yaw || 0) * D2R + fyaw;
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = e.yaw;
    A.e = e;
    if (team === 'player') {
      this.players.push(e);
      if (!this.player) this.player = e;
    } else if (team === 'ally') this.allies.push(e);
    else this.enemies.push(e);
    c.actors.set(spec.id, A);
    return A;
  },
  cineDropActor(A) {
    if (A.e) {
      A.e.cleanup && A.e.cleanup();
      this.scene.remove(A.e.mesh);
      for (const L of [this.enemies, this.allies, this.players]) {
        const i = L ? L.indexOf(A.e) : -1;
        if (i >= 0) L.splice(i, 1);
      }
      if (this.player === A.e) this.player = null;
    }
    if (A.obj && A.obj.parent) A.obj.parent.remove(A.obj);
    if (A.segs) for (const s of A.segs) this.scene.remove(s);
  },
  // 劇本的一步（演員的 s 陣列或事件的 a）
  cineDo(A, st) {
    const P = A.pup,
      e = A.e;
    if (st.go) P.goal = this.cinePt({ g: st.go, h: 0 });
    if (st.stop) P.goal = null;
    if (st.aim !== undefined) P.aim = st.aim;
    if (st.fire) {
      const slots = st.fire === 'all' ? ['rarm', 'larm', 'rback', 'lback'] : [].concat(st.fire);
      for (const s of slots) P.fire[s] = (A.lt || 0) + (st.dur || 0.6);
      if (st.at !== undefined) P.aim = st.at;
    }
    if (st.qb) P.qb = st.qb;
    if (st.ab !== undefined) P.ab = st.ab;
    if (st.hover !== undefined) P.hover = st.hover;
    if (st.jump) P.jumpT = 0.12;
    if (st.melee && e) e.startMeleeStage && e.weapons[st.melee] && this.cineMelee(A, st.melee);
    if (st.ai !== undefined && e) {
      e.ai = st.ai ? e.opts.ai || 'ac' : null;
      e.fpFace = !st.ai;
    }
    if (st.warp && e) {
      e.pos.copy(this.cinePt({ g: st.warp, h: 0 }));
      e.vel.set(0, 0, 0);
    }
    if (st.die && e && !e.dead) e.die(null);
    if (st.rise) A.rise = { t0: A.lt || 0, d: st.rise }; // 從蹲低／埋在坑裡站起來
    if (st.hide !== undefined) (A.e ? A.e.mesh : A.obj).visible = !st.hide;
  },
  cineMelee(A, slot) {
    const e = A.e,
      tgt = this.cineAimEnt(A.pup.aim);
    const tp = tgt ? tgt.center() : this.cinePt(A.pup.aim || null);
    try {
      e.startMeleeStage(slot, 0, tp, tgt);
    } catch (err) {
      /* 沒有近戰武器 */
    }
  },
  cineAimEnt(aim) {
    if (typeof aim !== 'string') return null;
    const a = this.cine.actors.get(aim);
    return a && a.e && !a.e.dead ? a.e : null;
  },
  cineAimPt(aim) {
    if (aim == null) return null;
    if (typeof aim === 'string') {
      const a = this.cine.actors.get(aim);
      if (!a) return null;
      return a.e ? a.e.center() : (a.head || a.obj).getWorldPosition(new THREE.Vector3());
    }
    return this.cinePt(aim);
  },
  cineActors(dt, t) {
    const c = this.cine;
    for (const A of c.actors.values()) {
      const lt = (A.lt = t - A.t0);
      const steps = A.spec.s || [];
      while (A.si < steps.length && steps[A.si].t <= lt) this.cineDo(A, steps[A.si++]);
      if (A.e) this.cinePuppet(A, dt, lt);
      else this.cineModel(A, lt, dt);
    }
  },
  cinePuppet(A, dt, lt) {
    const e = A.e,
      P = A.pup;
    if (e.dead) return;
    if (e.ai) return; // AI 的在 cineSim 裡跑
    const wish = new THREE.Vector3();
    if (P.goal) {
      wish.set(P.goal.x - e.pos.x, 0, P.goal.z - e.pos.z);
      const d = wish.length();
      if (d < 1.2) P.goal = null;
      else wish.multiplyScalar(1 / d);
    }
    let qb = false;
    if (P.qb) {
      const fy = (this.cine.set && this.cine.set.yaw) || 0;
      wish
        .set(P.qb[0], 0, P.qb[1])
        .normalize()
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), fy);
      qb = true;
      P.qb = null;
    }
    let hover = P.hover;
    if (P.jumpT > 0) {
      P.jumpT -= dt;
      hover = true;
    }
    const tgt = this.cineAimEnt(P.aim);
    const ap = this.cineAimPt(P.aim);
    if (ap) e.setAim(ap);
    else if (wish.lengthSq() > 0) e.aimYaw = Math.atan2(-wish.x, -wish.z);
    e.move(dt, wish, hover, qb, !!P.ab, tgt);
    // 站起來：一開始壓低、往前傾，慢慢回到原本的姿勢
    if (A.rise) {
      const k = 1 - smooth(clamp((lt - A.rise.t0) / A.rise.d, 0, 1));
      e.mesh.position.y -= k * 2.4 * (e.scale || 1);
      e.mesh.rotation.x += k * 0.5;
      if (k <= 0) A.rise = null;
    }
    for (const s in P.fire) {
      if (P.fire[s] < lt) {
        delete P.fire[s];
        continue;
      }
      const w = e.weapons[s];
      if (!w || !w.def) continue;
      if (w.mag !== undefined && w.def.mag < 99 && w.mag <= 0) w.mag = w.def.mag;
      if (w.ammo !== undefined && w.ammo < 10) w.ammo = w.def.ammo || 999;
      w.reloadT = 0;
      e.fire(s, ap || e.aimPoint(), tgt);
    }
  },
  // 模型演員：關鍵影格 k:[{ t, p, r, s }]（p 相對場景原點；r 角度）＋推力／熱罩
  cineModel(A, lt, dt) {
    const k = A.spec.keys;
    const obj = A.obj;
    if (k && k.length) {
      let i = 0;
      while (i < k.length - 1 && k[i + 1].t <= lt) i++;
      const a = k[i],
        b = k[Math.min(i + 1, k.length - 1)];
      const u = b === a ? 0 : clamp((lt - a.t) / (b.t - a.t), 0, 1);
      const e = b.lin ? u : smooth(u);
      if (a.p && b.p) {
        // 掛在軌道站上的：p 是軌道站的局部座標
        const pa = A.parent ? V(a.p) : this.cinePt(a.p),
          pb = A.parent ? V(b.p) : this.cinePt(b.p);
        const prev = obj.position.clone();
        obj.position.lerpVectors(pa, pb, e);
        // 鑽地蟲的頭：朝向移動方向
        if (A.head && prev.distanceToSquared(obj.position) > 1e-4) {
          const tgt = obj.position.clone().add(obj.position.clone().sub(prev).normalize());
          obj.lookAt(tgt);
          obj.rotateY(Math.PI); // 模型的正面是 -Z
        }
      }
      if (a.r && b.r)
        obj.rotation.set(
          lerp(a.r[0], b.r[0], e) * D2R,
          lerp(a.r[1], b.r[1], e) * D2R + (A.fyaw || 0),
          lerp(a.r[2], b.r[2], e) * D2R,
        );
      if (a.s != null && b.s != null) obj.scale.setScalar(lerp(a.s, b.s, e));
      if (A.pod) {
        const th = lerp(a.thrust || 0, b.thrust || 0, e),
          he = lerp(a.heat || 0, b.heat || 0, e);
        A.pod.setThrust(th, lt);
        A.pod.setHeat(he, lt);
      }
    }
    // 鑽地蟲：身體各節沿頭部的軌跡排列
    if (A.segs) {
      const hp = A.head.getWorldPosition(new THREE.Vector3());
      const tr = A.trail;
      if (!tr.length || tr[0].distanceTo(hp) > 0.6) tr.unshift(hp.clone());
      if (tr.length > 400) tr.length = 400;
      const gap = 2.1 * (A.spec.scale || 1);
      let acc = 0,
        j = 0;
      for (let n = 0; n < A.segs.length; n++) {
        const want = gap * (n + 1);
        while (j < tr.length - 1 && acc + tr[j].distanceTo(tr[j + 1]) < want) {
          acc += tr[j].distanceTo(tr[j + 1]);
          j++;
        }
        const p = tr[Math.min(j + 1, tr.length - 1)] || hp;
        const s = A.segs[n];
        s.position.copy(p);
        // 還沒長出軌跡時藏在頭的正下方（地底）
        if (tr.length < 2) s.position.set(hp.x, hp.y - want, hp.z);
        s.lookAt(n ? A.segs[n - 1].position : hp);
      }
    }
  },
  // 模擬：AI、子彈、特效（和實驗室相同，不計入存檔）
  cineSim(dt) {
    if (!this.world) {
      this.fx.update(dt);
      return;
    }
    this.missionT += dt;
    this.time += dt;
    for (const L of [this.players, this.allies, this.enemies])
      for (const e of L || []) if (!e.dead && e.ai) e.updateAI(dt);
    for (const e of [...(this.players || []), ...(this.allies || []), ...(this.enemies || [])])
      if (!e.dead && e.hp < e.maxHp * 0.5) e.hp = e.maxHp; // 演員不會被打倒（要倒下的用劇本的 die）
    this.separateMechs(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const q = this.projectiles[i];
      q.update(dt);
      if (q.dead) this.projectiles.splice(i, 1);
    }
    this.updateShocks(dt);
    this.updateSupport(dt);
    this.updateHazards(dt);
    this.fx.update(dt);
    if (this.popups) this.popups.length = 0;
  },
  // ---------- 鏡頭 ----------
  cineCamera(S, lt, dt) {
    const c = this.cine,
      cam = this.camera;
    const C = S.cam || { keys: [{ t: 0, p: [0, 5, 20], l: [0, 2, 0] }] };
    const keys = C.keys;
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= lt) i++;
    const a = keys[i],
      b = keys[Math.min(i + 1, keys.length - 1)];
    const u = b === a ? 0 : clamp((lt - a.t) / (b.t - a.t), 0, 1);
    const e =
      C.ease === 'lin' || b.lin
        ? u
        : C.ease === 'in'
          ? u * u
          : C.ease === 'out'
            ? 1 - (1 - u) * (1 - u)
            : smooth(u);
    const pa = this.cinePt(a.p),
      pb = this.cinePt(b.p),
      la = this.cinePt(a.l),
      lb = this.cinePt(b.l);
    const pos = pa.lerp(pb, e),
      look = la.lerp(lb, e);
    // 追焦：look 用平滑（演員移動時鏡頭不抖）
    if (c.cut || C.snap) c.look.copy(look);
    else c.look.lerp(look, Math.min(1, dt * (C.follow || 12)));
    // 手持晃動＋事件的震動
    const hand = C.hand == null ? 0.12 : C.hand;
    const tt = c.t;
    const off = new THREE.Vector3(
      Math.sin(tt * 1.3) * 0.6 + Math.sin(tt * 2.9 + 1) * 0.3,
      Math.sin(tt * 1.7 + 2) * 0.5 + Math.sin(tt * 3.7) * 0.2,
      0,
    ).multiplyScalar(hand * 0.25);
    c.shake = Math.max(0, c.shake - dt * 1.6);
    const sh = c.shake + (C.shake || 0) + (this.camShake || 0);
    this.camShake = Math.max(0, (this.camShake || 0) - dt * 2);
    if (sh > 0) {
      off.x += (Math.random() * 2 - 1) * sh * 0.5;
      off.y += (Math.random() * 2 - 1) * sh * 0.5;
    }
    cam.position.copy(pos);
    // 地圖：鏡頭不鑽進地裡，也不卡在建築物裡（在障礙物裡時升到它的頂上）
    if (this.world && !C.free) {
      const cp = cam.position;
      for (const o of this.world.obstacles) {
        if (o.box) {
          const b = o.box;
          if (cp.x > b.min.x - 0.6 && cp.x < b.max.x + 0.6 && cp.z > b.min.z - 0.6 && cp.z < b.max.z + 0.6)
            if (cp.y > b.min.y - 0.5 && cp.y < b.max.y + 0.8 && !o.deck) cp.y = b.max.y + 0.8;
        } else if (o.kind === 'circle' && Math.hypot(cp.x - o.x, cp.z - o.z) < (o.r || 1) + 0.6) {
          const top = o.top != null ? o.top : this.world.terrainHeight(o.x, o.z) + (o.h || 3);
          if (cp.y < top + 0.8) cp.y = top + 0.8;
        }
      }
      const gh = this.world.terrainHeight(cp.x, cp.z);
      if (cp.y < gh + 0.8) cp.y = gh + 0.8;
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(c.look);
    const roll = lerp(a.roll || 0, b.roll || 0, e) * D2R + (sh > 0 ? (Math.random() * 2 - 1) * sh * 0.01 : 0);
    if (roll) cam.rotateZ(roll);
    cam.translateX(off.x);
    cam.translateY(off.y);
    const fov = lerp(a.fov || C.fov || 40, b.fov || C.fov || 40, e);
    if (Math.abs(cam.fov - fov) > 0.01 || cam.aspect !== innerWidth / innerHeight) {
      cam.fov = fov;
      cam.aspect = innerWidth / innerHeight;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    if (c.cut) {
      this.stylePipe.resetHistory();
      c.cut = false;
    }
    // 景深：焦點＝注視點的距離（或指定）
    const P = c.P;
    if (C.dof) {
      P.dof = C.dof;
      P.dofF = C.focus || cam.position.distanceTo(c.look);
      P.dofR = C.range || Math.max(1.5, P.dofF * 0.12);
    } else P.dof = 0;
    // 太陽與陰影跟著注視點
    const focus = c.look;
    if (c.set && c.set.space) {
      this.sun.position.copy(focus).addScaledVector(c.set.space.pu.sunDir.value, 120);
      this.sun.target.position.copy(focus);
    } else {
      this.sun.position.copy(focus).add(this.sunOff);
      this.sun.target.position.copy(focus);
    }
    this.camTarget.copy(focus);
    if (this.world) {
      this.world.updateOcclusion(cam.position, focus, dt);
      for (const m of this.world.bWall || []) m.visible = false; // 作戰區域的警示光幕不顯示
    }
  },
  // ---------- 事件 ----------
  cineEvent(ev, S) {
    const c = this.cine;
    if (ev.a) {
      const A = c.actors.get(ev.a);
      if (A) this.cineDo(A, ev);
    }
    if (ev.sfx) {
      const pos = ev.at ? this.cinePt(ev.at) : null;
      SFX.play(
        ev.sfx,
        ev.vol == null ? 1 : ev.vol,
        ev.rate || 1,
        0.02,
        0,
        pos,
        pos ? null : 'ui',
        ev.delay || 0,
      );
    }
    if (ev.loop !== undefined) SFX.loopSet('cine', ev.loopKey || 'engineLoop', ev.loop, ev.rate || 1);
    if (ev.boom) {
      const p = this.cinePt(ev.boom);
      const big = !!ev.big;
      this.fx.explosion(p, ev.r || (big ? 3.4 : 2), ev.color || 0xffa040, big);
      if (ev.kill)
        this.fx.killBurst(
          p,
          ev.r ? ev.r / 3 : 1,
          big,
          this.world ? this.world.groundAt(p.x, p.z, p.y) : null,
        );
      SFX.explode(big ? 'huge' : true, ev.near ? null : p);
      c.shake = Math.max(c.shake, ev.shake == null ? (big ? 0.6 : 0.3) : ev.shake);
    }
    if (ev.fx) this.cineFx(ev);
    if (ev.shake) c.shake = Math.max(c.shake, ev.shake);
    if (ev.slow) {
      c.slowK = ev.slow;
      c.slow = ev.dur || 0.6;
    }
    if (ev.flash)
      c.flash = { color: ev.flash, t0: c.t, in: ev.in || 0.04, hold: ev.hold || 0.08, out: ev.out || 0.5 };
    if (ev.sub !== undefined) this.cineSub(ev.sub, ev.who, ev.dur || 3.2);
    if (ev.card) this.cineCard(ev);
    if (ev.sys) this.cineSys(ev.sys, ev.dur || 4, ev.cls);
    if (ev.call) ev.call(this, c);
  },
  cineFx(ev) {
    const fx = this.fx,
      p = this.cinePt(ev.at);
    const col = ev.color;
    switch (ev.fx) {
      case 'flash':
        fx.flash(p, ev.r || 3, col || 0xffe0b0, ev.life || 0.15);
        fx.flashLight && fx.flashLight(p, col || 0xffc080, ev.i || 6);
        break;
      case 'killBurst':
        fx.killBurst(p, ev.r || 1, !!ev.big, this.world ? this.world.groundAt(p.x, p.z, p.y) : null);
        break;
      case 'shockwave':
        fx.shockwave(p, ev.r || 8, col || 0xffd090, ev.life || 0.5);
        break;
      case 'beam':
        fx.beam(p, this.cinePt(ev.to), col || 0x9fe8ff, ev.w || 0.4);
        break;
      case 'dust':
        fx.dust(p, ev.r || 4, ev.n || 14, col || 0x9aa0a8);
        break;
      case 'smoke':
        fx.smoke(p, ev.r || 2, col || 0x4a4e56, ev.life || 2.5, ev.rise || 3);
        break;
      case 'streaks':
        fx.streaks(
          p,
          ev.n || 20,
          col || 0xffd080,
          ev.speed || 30,
          ev.life || 0.5,
          ev.grav == null ? 20 : ev.grav,
        );
        break;
      case 'pillar':
        fx.pillarStrike(p, ev.r || 4, col || 0x9fe8ff);
        break;
      case 'ring':
        fx.ring(p, ev.r || 6, col || 0xffffff);
        break;
      case 'warnLine':
        fx.warnLine(p, this.cinePt(ev.to), ev.life || 1.2, col || 0xff2020, ev.w || 0.08);
        break;
      case 'pulse':
        fx.pulseShell(p, ev.r || 20, ev.speed || 30, col || 0xff5070);
        break;
      case 'fire':
        fx.firePool(p, ev.r || 4, ev.life || 4, ev.kind || 0);
        break;
      case 'flame':
        fx.flameCone(p, this.cinePt(ev.to).sub(p).normalize(), ev.len || 12, ev.ang || 0.3, ev.n || 10);
        break;
      case 'muzzle':
        fx.muzzle(p, this.cinePt(ev.to).sub(p).normalize(), col || 0xffd080, ev.r || 2);
        break;
      default:
        break;
    }
  },
  // 字幕：說話者（有顏色）＋台詞；who 沒給＝旁白
  cineSub(text, who, dur) {
    const c = this.cine;
    const el = $('cineSub');
    if (!text) {
      el.classList.remove('on');
      return;
    }
    const S = who ? SPEAKERS[who] : null;
    const name = S
      ? who === 'echo'
        ? 'ECHO'
        : who === 'station'
          ? '軌道站'
          : S.name.replace(/（.*）/, '')
      : '';
    el.innerHTML = `${name ? `<b style="color:${S.color}">${escHtml(name)}</b>` : ''}<span>${escHtml(text)}</span>`;
    el.classList.toggle('radio', !!who && who !== 'narr');
    el.classList.add('on');
    if (who && who !== 'station') SFX.radio();
    else if (who === 'station') SFX.play('glitch', 0.3, 0.6, 0.02, 0.1, null, 'ui');
    c.subUntil = c.t + dur;
  },
  // 字卡（文字演出）：style＝card（黑底的電影字距）、logo、chapter、name（宿敵名牌，左下）、loc（地點，左上）
  cineCard(ev) {
    const cue = {
      card: 'cineCard',
      logo: 'cineLogo',
      chapter: 'cineChapter',
      name: 'cineName',
      loc: 'cineLoc',
    }[ev.style || 'card'];
    const ok = this.textfx && this.textfx.on;
    if (ok) {
      const it = this.textfx.show(cue, ev.card, ev.s == null ? '' : ev.s, {
        states: ['cine'],
        hold: ev.dur || 2.4,
        cine: true,
      });
      // 模板自己的時間軸可能比 dur 長：到時間就收掉（過場的時間為準）
      if (it)
        (this.cine.cards = this.cine.cards || []).push({ it, until: this.cine.t + (ev.dur || 2.4) + 0.8 });
    } else this.cineSub(ev.card + (ev.s ? '　' + ev.s : ''), null, ev.dur || 2.4);
  },
  // 機器文字（左下，系統日誌樣式逐字）
  cineSys(lines, dur, cls) {
    const el = $('cineSys');
    el.className = cls || '';
    el.innerHTML = lines.map((l) => `<p>${escHtml(l)}</p>`).join('');
    revealDom(el, 'briefEcho', { delay: 0.05, limit: Math.max(0.6, dur * 0.45) });
    this.cine.sysUntil = this.cine.t + dur;
  },
  // ---------- 畫面上的疊加：遮幅、淡入淡出、閃白、光暈、訊號波形、駕駛艙開機、突入的速度線 ----------
  cineOverlay(S, lt, dt) {
    const c = this.cine;
    const W = innerWidth,
      H = innerHeight;
    // 遮幅
    const lbA = S.lb === false ? 0 : c.def.lb || 2.39;
    const bar = lbA ? Math.max(0, (H - W / lbA) / 2) : 0;
    c.bar = lerp(c.bar == null ? bar : c.bar, bar, Math.min(1, dt * 4));
    $('cineBarT').style.height = $('cineBarB').style.height = c.bar.toFixed(1) + 'px';
    // 淡入淡出（鏡頭的 fi／fo）＋閃白
    let fade = 0;
    if (S.fi && lt < S.fi) fade = 1 - lt / S.fi;
    const left = (c.def.shots[c.shot + 1] ? c.def.shots[c.shot + 1].at : c.def.dur) - S.at - lt;
    if (S.fo && left < S.fo) fade = Math.max(fade, 1 - left / S.fo);
    let col = S.fc || '#000';
    if (S.fade != null) fade = Math.max(fade, S.fade);
    const F = c.flash;
    if (F) {
      const ft = c.t - F.t0;
      let k = 0;
      if (ft < F.in) k = ft / F.in;
      else if (ft < F.in + F.hold) k = 1;
      else if (ft < F.in + F.hold + F.out) k = 1 - (ft - F.in - F.hold) / F.out;
      else c.flash = null;
      if (k > fade) {
        fade = k;
        col = F.color;
      }
    }
    const fe = $('cineFade');
    fe.style.background = col;
    fe.style.opacity = fade.toFixed(3);
    // 字卡、字幕與機器文字的時間（以過場的時間為準）
    if (c.cards && c.cards.length && this.textfx) {
      const over = c.cards.filter((x) => c.t >= x.until).map((x) => x.it);
      if (over.length) {
        this.textfx.clear((x) => over.includes(x));
        c.cards = c.cards.filter((x) => c.t < x.until);
      }
    }
    if (c.subUntil && c.t >= c.subUntil) {
      c.subUntil = 0;
      $('cineSub').classList.remove('on');
    }
    if (c.sysUntil && c.t >= c.sysUntil) {
      c.sysUntil = 0;
      $('cineSys').classList.add('out');
    }
    // 疊加畫布（在淡入淡出的黑幕之上：駕駛艙開機、訊號波形在黑畫面上也看得到）
    const cv = $('cineCv');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const x = cv.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    this.hctx.clearRect(0, 0, W, H);
    if (c.set && c.set.space && fade < 0.95) {
      x.globalAlpha = 1 - fade;
      this.cineFlare(x, W, H);
      x.globalAlpha = 1;
    }
    if (S.ov === 'signal') this.cineSignal(x, W, H, lt);
    if (S.ov === 'boot') this.cineBoot(x, W, H, lt);
    if (S.ov === 'speed') this.cineSpeed(x, W, H, lt);
    if (S.ov === 'scan') this.cineScan(x, W, H, lt);
    // 略過的提示
    if (c.hintT > 0) c.hintT -= dt;
    $('cineSkip').classList.toggle('on', c.hintT > 0 || c.skipT > 0);
    $('cineSkipBar').style.width = ((c.skipT / SKIP_HOLD) * 100).toFixed(0) + '%';
  },
  // 太陽的鏡頭光暈（太空場景）
  cineFlare(x, W, H) {
    const cam = this.camera;
    const sd = this.cine.set.space.pu.sunDir.value;
    const p = cam.position.clone().addScaledVector(sd, 4000).project(cam);
    if (p.z > 1 || Math.abs(p.x) > 1.6 || Math.abs(p.y) > 1.6) return;
    const sx = (p.x * 0.5 + 0.5) * W,
      sy = (-p.y * 0.5 + 0.5) * H;
    const vis = clamp(1.4 - Math.hypot(p.x, p.y) * 0.6, 0, 1);
    x.save();
    x.globalCompositeOperation = 'lighter';
    const g = x.createRadialGradient(sx, sy, 0, sx, sy, H * 0.5);
    g.addColorStop(0, `rgba(220,240,255,${0.5 * vis})`);
    g.addColorStop(0.08, `rgba(150,200,255,${0.22 * vis})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    // 橫向的變形鏡頭光條
    const g2 = x.createLinearGradient(sx - W * 0.6, sy, sx + W * 0.6, sy);
    g2.addColorStop(0, 'rgba(80,140,255,0)');
    g2.addColorStop(0.5, `rgba(170,210,255,${0.35 * vis})`);
    g2.addColorStop(1, 'rgba(80,140,255,0)');
    x.fillStyle = g2;
    x.fillRect(sx - W * 0.6, sy - 1.5, W * 1.2, 3);
    // 光斑：沿著太陽 → 畫面中心的直線
    const cx = W / 2,
      cy = H / 2;
    for (const [k, r, a, col] of [
      [0.5, 26, 0.08, '120,180,255'],
      [0.9, 14, 0.12, '160,255,220'],
      [1.3, 46, 0.05, '255,200,140'],
      [1.7, 20, 0.08, '140,160,255'],
    ]) {
      const fx = sx + (cx - sx) * k,
        fy = sy + (cy - sy) * k;
      const gg = x.createRadialGradient(fx, fy, 0, fx, fy, r * (H / 720));
      gg.addColorStop(0, `rgba(${col},${a * vis})`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gg;
      x.fillRect(fx - r * 2, fy - r * 2, r * 4, r * 4);
    }
    x.restore();
  },
  // 訊號：黑畫面中央的波形（越來越亂）
  cineSignal(x, W, H, lt) {
    const cy = H * 0.66; // 字卡在畫面中央，波形在下方
    const amp = H * 0.05 * (0.4 + Math.min(1, lt / 6));
    x.save();
    x.strokeStyle = 'rgba(255,90,70,0.85)';
    x.lineWidth = 1.6;
    x.shadowColor = 'rgba(255,60,40,0.9)';
    x.shadowBlur = 12;
    x.beginPath();
    for (let i = 0; i <= 200; i++) {
      const u = i / 200;
      const px = W * 0.2 + u * W * 0.6;
      const env = Math.sin(u * Math.PI);
      const n =
        Math.sin(u * 40 + lt * 9) * 0.5 +
        Math.sin(u * 97 - lt * 13) * 0.3 +
        (Math.random() * 2 - 1) * 0.25 * Math.min(1, lt / 4);
      const burst = Math.sin(lt * 2.1) > 0.7 ? 1.6 : 1;
      const py = cy + n * amp * env * burst;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
    x.restore();
  },
  // 駕駛艙開機：紅色待機燈、HUD 一塊一塊亮起、掃描線
  cineBoot(x, W, H, lt) {
    x.save();
    const s = H / 720;
    // 紅色待機燈
    const blink = Math.sin(lt * 5) > 0 ? 1 : 0.35;
    x.fillStyle = `rgba(255,60,40,${0.9 * blink})`;
    x.shadowColor = '#ff3020';
    x.shadowBlur = 18;
    x.beginPath();
    x.arc(W * 0.5, H * 0.66, 4 * s, 0, 7);
    x.fill();
    x.shadowBlur = 0;
    const on = (t) => clamp((lt - t) / 0.25, 0, 1) * (Math.random() < 0.06 ? 0.3 : 1);
    const cyan = (a) => `rgba(120,220,255,${a})`;
    // 準星
    let a = on(1.0);
    if (a > 0) {
      x.strokeStyle = cyan(0.85 * a);
      x.lineWidth = 1.5 * s;
      x.beginPath();
      x.arc(W / 2, H / 2, 34 * s, 0.3, Math.PI - 0.3);
      x.moveTo(W / 2 + 34 * s * Math.cos(Math.PI + 0.3), H / 2 + 34 * s * Math.sin(Math.PI + 0.3));
      x.arc(W / 2, H / 2, 34 * s, Math.PI + 0.3, Math.PI * 2 - 0.3);
      x.stroke();
    }
    // AP／EN 條
    a = on(1.6);
    if (a > 0) {
      x.fillStyle = cyan(0.25 * a);
      x.fillRect(W * 0.3, H * 0.86, W * 0.4, 6 * s);
      x.fillStyle = cyan(0.85 * a);
      x.fillRect(W * 0.3, H * 0.86, W * 0.4 * clamp((lt - 1.6) / 1.2, 0, 1), 6 * s);
      x.font = `${12 * s}px "Share Tech Mono", monospace`;
      x.fillText('AP', W * 0.3, H * 0.85);
    }
    a = on(2.2);
    if (a > 0) {
      x.fillStyle = `rgba(255,190,80,${0.8 * a})`;
      x.fillRect(W * 0.3, H * 0.88, W * 0.4 * clamp((lt - 2.2) / 1.0, 0, 1), 3 * s);
    }
    // 雷達
    a = on(2.6);
    if (a > 0) {
      x.strokeStyle = cyan(0.5 * a);
      x.beginPath();
      x.arc(W * 0.12, H * 0.78, 60 * s, 0, 7);
      x.stroke();
      x.beginPath();
      x.moveTo(W * 0.12, H * 0.78);
      x.lineTo(W * 0.12 + Math.cos(lt * 3) * 60 * s, H * 0.78 + Math.sin(lt * 3) * 60 * s);
      x.stroke();
    }
    // 掃描線
    x.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
    x.restore();
  },
  // 大氣層突入：畫面中心往外的速度線＋邊緣的熱光
  cineSpeed(x, W, H, lt) {
    x.save();
    x.globalCompositeOperation = 'lighter';
    const cx = W / 2,
      cy = H * 0.45;
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = (0.25 + Math.random() * 0.5) * Math.max(W, H);
      const L = (0.06 + Math.random() * 0.2) * Math.max(W, H);
      x.strokeStyle = `rgba(255,${150 + Math.random() * 80},${90 + Math.random() * 60},${0.08 + Math.random() * 0.18})`;
      x.lineWidth = 1 + Math.random() * 2;
      x.beginPath();
      x.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      x.lineTo(cx + Math.cos(a) * (r0 + L), cy + Math.sin(a) * (r0 + L));
      x.stroke();
    }
    const g = x.createRadialGradient(cx, cy, Math.min(W, H) * 0.3, cx, cy, Math.max(W, H) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(255,90,30,${0.35 + Math.sin(lt * 20) * 0.05})`);
    x.fillStyle = g;
    x.fillRect(0, 0, W, H);
    x.restore();
  },
  // 監視器式的掃描線與雜訊（通訊、回憶）
  cineScan(x, W, H, lt) {
    x.save();
    x.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
    const y = ((lt * 0.4) % 1) * H;
    x.fillStyle = 'rgba(160,220,255,0.05)';
    x.fillRect(0, y, W, H * 0.06);
    x.restore();
  },
  // ---------- 輸入：長按略過 ----------
  cineInput() {
    const c = this.cine;
    // 長按的時間用實際經過的時間（低 FPS 時主迴圈的 dt 有上限）
    const now = performance.now() / 1000;
    const rdt = Math.min(0.5, now - (c.inT || now));
    c.inT = now;
    let hold = !!(this.keys.Escape || this.keys.Enter || this.keys.Space || this.cineTouch);
    const gps = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gps || []) {
      if (!gp) continue;
      if ([0, 1, 9].some((i) => gp.buttons[i] && gp.buttons[i].pressed)) hold = true;
    }
    if (hold) {
      c.skipT += rdt;
      c.hintT = 2;
      if (c.skipT >= SKIP_HOLD) {
        c.skipT = 0;
        this.keys.Escape = this.keys.Enter = this.keys.Space = false;
        this.cineTouch = false;
        SFX.ui('back');
        this.cineEnd(true);
      }
    } else c.skipT = Math.max(0, c.skipT - rdt * 3);
  },
  // 劇本用：軌道站艙口的燈換顏色、藏起一個演員（含鑽地蟲的身體）
  cineStationLamps(color) {
    const c = this.cine;
    if (c && c.set && c.set.space) c.set.space.station.lampMat.color.set(color);
  },
  cineHide(id) {
    const A = this.cine && this.cine.actors.get(id);
    if (!A) return;
    if (A.obj) A.obj.visible = false;
    if (A.e) A.e.mesh.visible = false;
    for (const s of A.segs || []) s.visible = false;
  },
  // 點一下畫面：顯示略過的提示（觸控長按＝略過）
  cinePointer(down) {
    if (!this.cine) return;
    this.cine.hintT = 2.5;
    this.cineTouch = !!down;
  },
});
