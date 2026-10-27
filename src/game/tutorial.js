// Game：近戰訓練課程（作戰室的模擬艙，docs/melee-tutorial.md；課程資料在 data/tutorial.js）。
// this.tut 存在時是教學（state 照舊 'play'，主迴圈呼叫 tutTick）。一課＝幾個練習（step），每個練習：
//   intro（說明）→ demo（示範：玩家的機體照腳本的虛擬輸入動作、放慢）→ try（換你做，事件達成目標就過關）→ ok → 下一個
// 判定看遊戲裡實際發生的事（MechEntity 的 tutE：出招、打中、跳躍取消、QB 接回、彈刀…），不看按了什麼鍵。
// 示範的虛擬輸入：this.tutVirt＝{ 動作名稱: true, wish: 世界座標的移動方向 }（input.js 的 act、player.js 的 wish 改讀它）。
// 冒煙測試設 g.tutAuto＝true：try 也照示範腳本自動操作（驗證每一步都過得了）。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { DS } from '../core/scale.js';
import {
  EXEC_HOLD,
  LINK_SHOT_AT,
  QUEUE_AT,
  RESUME_T,
  SHIELD_BASH_T,
  meleeMove,
  meleeNext,
} from '../data/melee.js';
import { FIST_DEF, partById } from '../data/parts.js';
import {
  EXAM_KINDS,
  EXAM_STARS,
  LESSONS,
  TUT_LV,
  TUT_PRIZES,
  TUT_PRIZE_COAM,
  TUT_WEAPONS,
  lessonById,
  meleeTags,
  tagName,
} from '../data/tutorial.js';
import { MechEntity } from '../entities/mech-entity.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const TELE = 0.9; // 假人出招前的預警（遊戲秒）
const LUNGE_MAX = 28; // 突進追擊的練習：假人最遠放多遠（舊尺度 m）
const SWAP2 = (w) => (w === 'w_claw' ? 'w_blade' : 'w_claw'); // 左右手交替：左手的第二把近戰武器
const wName = (id) => (id === 'w_none' ? '空手（拳擊）' : (partById('arm', id) || {}).name || id);
const DIRS = { f: '上', s: '左右', b: '下' };

Object.assign(Game.prototype, {
  // ---------- 存檔 ----------
  tutSave() {
    const st = this.campStory();
    if (!st.tut || typeof st.tut !== 'object') st.tut = {};
    const T = st.tut;
    if (!T.les || typeof T.les !== 'object') T.les = {};
    return T;
  },
  tutDone(lid) {
    const r = this.tutSave().les[lid];
    return !!(r && r.w && r.w.length);
  },
  tutOpenLesson(lid) {
    const i = LESSONS.findIndex((L) => L.id === lid);
    return i <= 0 || this.tutDone(LESSONS[i - 1].id);
  },
  // ---------- 模擬器畫面的「近戰訓練課程」 ----------
  tutMenuHtml() {
    let h = '<h3>近戰訓練課程</h3><div class="tutList">';
    LESSONS.forEach((L, i) => {
      const r = this.tutSave().les[L.id];
      const open = this.tutOpenLesson(L.id);
      const done = r && r.w && r.w.length;
      const ws = done
        ? r.w.map((w) => `<i class="tutW">${escHtml(wName(w).replace(/^[A-Z0-9-]+ /, ''))}</i>`).join('')
        : '';
      const star = L.final && r && r.stars ? ' ' + '★'.repeat(r.stars) : '';
      h += `<button class="simItem tutItem${done ? ' done' : ''}" data-tut="${L.id}" ${open ? '' : 'disabled'}>
        <b>第 ${i + 1} 課　${escHtml(L.n)}${done ? ' ✓' : ''}${star}</b>
        <span class="dim">${open ? escHtml(L.d) : '完成上一課後開放'}</span>${ws ? `<span class="tutWs">${ws}</span>` : ''}</button>`;
    });
    return h + '</div>';
  },
  // 選了一課：選武器、開始
  tutPick(lid) {
    SFX.ui();
    const L = lessonById(lid);
    if (!L) return;
    const el = document.getElementById('simList');
    const i = LESSONS.indexOf(L);
    const last = this.tutLastW || 'w_blade';
    const r = this.tutSave().les[lid];
    let h = `<h3>第 ${i + 1} 課　${escHtml(L.n)}</h3><p class="dim">${escHtml(L.d)}</p><ol class="tutSteps">`;
    for (const s of L.steps)
      h += `<li>${escHtml(s.t)}${s.opt ? '<span class="dim">（選修）</span>' : ''}</li>`;
    h += '</ol><h3>選擇近戰武器</h3><div class="tutWeps">';
    for (const w of TUT_WEAPONS) {
      const did = r && r.w && r.w.includes(w);
      h += `<button class="tutWep${w === last ? ' sel' : ''}" data-w="${w}">${escHtml(wName(w))}${did ? ' ✓' : ''}</button>`;
    }
    h +=
      '</div><p class="dim">教學中可以用所有近戰武器（不必先買）；左手是霰彈槍。不會被擊破、沒有時間限制。</p>';
    if (L.coam && !(r && r.w && r.w.length)) h += `<p>第一次完成：COAM +${L.coam.toLocaleString()}</p>`;
    if (L.final) h += '<p>結業：從三把近戰武器裡挑一把免費拿走。</p>';
    h += `<div class="row"><button class="primary" id="btnTutGo">開始</button><button id="btnTutBack">返回</button></div>`;
    el.innerHTML = h;
    let sel = last;
    for (const b of el.querySelectorAll('.tutWep'))
      b.onclick = () => {
        SFX.ui();
        sel = b.dataset.w;
        for (const x of el.querySelectorAll('.tutWep')) x.classList.toggle('sel', x === b);
      };
    document.getElementById('btnTutGo').onclick = () => this.tutStart(lid, sel);
    document.getElementById('btnTutBack').onclick = () => this.openSim();
  },
  // ---------- 開始／結束 ----------
  tutStart(lid, wid) {
    const L = lessonById(lid);
    if (!L) return;
    SFX.ui();
    this.tutLastW = wid;
    this.clearMission();
    this.camp = null;
    this.sim = null;
    this.tut = { L, lid, wid, li: -1, clock: 0, log: {}, t0: 0, asmKey: '' };
    const seed = 86; // 固定的空白訓練場
    this.worldSeed = seed;
    this.worldTheme = 'grid';
    this.styleRefresh();
    this.world = new World(this.scene, 'grid', seed, 2, null, {
      zone: 'arena',
      level: { blank: true, props: 'none', h: null, water: null, removed: [] },
    });
    this.isClient = false;
    this.net.spawnReg = {};
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    this.mpStats = { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } };
    this.enemies = [];
    this.waves = [];
    this.wavePend = null;
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.bossDef = null;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.vehPlan = [];
    this.waveAlerted = false;
    this.isBossLevel = false;
    this.scaleHp = 1;
    this.scaleDmg = 1;
    document.getElementById('bossBar').style.display = 'none';
    this.levelName = `近戰訓練　第 ${LESSONS.indexOf(L) + 1} 課`;
    this.tutRingMake();
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.viewReset();
    document.getElementById('tutPanel').style.display = '';
    this.tutStep(0);
    this.commSay(
      'instructor',
      LESSONS.indexOf(L)
        ? `第 ${LESSONS.indexOf(L) + 1} 課，${L.n}。開始。`
        : '歡迎來到模擬艙。我們從最基本的開始。',
    );
  },
  tutExit(toSim = true) {
    if (!this.tut) return;
    SFX.ui();
    this.tut = null;
    this.clearMission();
    this.commClear();
    this.state = 'sim'; // 玩家的機體清掉了：不能停在 'play'（主迴圈會讀空的 player）
    if (toSim) this.openSim();
  },
  // clearMission 呼叫：模型與畫面
  tutClear() {
    this.tutVirt = null;
    this.tutDevRelease();
    if (this.tutRing) {
      this.scene.remove(this.tutRing);
      this.tutRing = null;
    }
    const p = document.getElementById('tutPanel');
    if (p) p.style.display = 'none';
    const d = document.getElementById('tutDoneCard');
    if (d) d.classList.remove('on');
  },
  tutRingMake() {
    const g = new THREE.RingGeometry(0.94, 1, 48);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      color: 0x7ee081,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.tutRing = new THREE.Mesh(g, m);
    this.tutRing.renderOrder = 3;
    this.scene.add(this.tutRing);
  },
  // ---------- 練習 ----------
  tutCur() {
    return this.tut && this.tut.L.steps[this.tut.li];
  },
  // 這一步的組裝：右手＝選的武器、左手霰彈槍（左右手交替時第二把近戰）、盾擊時肩上脈衝盾
  tutAsm(step) {
    const T = this.tut;
    const su = step.setup || {};
    return {
      ...this.save.asm,
      rarm: T.wid,
      larm: su.swap ? SWAP2(T.wid) : 'w_sg',
      rback: su.shield ? 'bw_sh' : 'bw_none',
      lback: 'bw_none',
    };
  },
  tutStep(i) {
    const T = this.tut;
    this.tutDevRelease();
    T.li = i;
    const step = T.L.steps[i];
    if (!step) return this.tutLessonDone();
    T.step = step;
    T.prog = (step.goal || []).map(() => 0);
    T.reps = 0;
    T.failN = 0;
    T.msg = '';
    T.msgT = 0;
    T.okT = 0;
    T.resetIn = 0;
    T.scr = null;
    T.phase = 'intro';
    T.introT = 0.9;
    T.log = {};
    T.lastMv = null;
    T.quiz = null;
    T.exam = null;
    T.noEnFill = !!(step.setup && step.setup.en);
    // 這把武器（或裝置）沒有這一步：說明後跳過
    const sk = step.skip ? step.skip(this.tutWDef(), this) : '';
    T.skipTxt = sk || '';
    if (sk) T.phase = 'skip';
    // 組裝不同時重建玩家的機體
    const asm = this.tutAsm(step);
    const key = JSON.stringify(asm);
    if (key !== T.asmKey || !this.player) {
      T.asmKey = key;
      this.tutSpawnPlayer(asm);
    }
    this.tutSpawnDummy(step);
    this.tutReset();
    if (step.goal && step.goal[0] && step.goal[0].quiz) this.tutQuizNew();
    if (step.goal && step.goal[0] && step.goal[0].exam) T.exam = { t: step.goal[0].exam, kinds: new Set() };
    if (step.say && !sk) this.commSay('instructor', step.say);
    this.tutPanelRender(true);
  },
  tutWDef() {
    return this.player ? this.player.weapons.rarm.def : FIST_DEF;
  },
  tutSpawnPlayer(asm) {
    if (this.player) {
      this.player.cleanup();
      this.player = null;
    }
    this.player = new MechEntity(this, asm, this.myPal(), {
      team: 'player',
      name: 'RAVEN',
      palKey: this.myPalKey(),
      slot: 0,
      pilot: this.pilotLocalMods('pve'),
    });
    this.players = [this.player];
    this.renderWeaponHud(true);
  },
  tutSpawnDummy(step) {
    const T = this.tut;
    for (const e of this.enemies) if (!e.dead) e.cleanup();
    this.enemies = [];
    const D = step.dummy || { lv: 0 };
    const duel = !!D.duel;
    const e = this.spawnEnemy({
      name: duel ? '教官 INSTRUCTOR' : `訓練假人（${TUT_LV[D.lv].n}）`,
      asm: {
        ...this.save.asm,
        head: 'h_std',
        core: 'c_std',
        arms: 'a_std',
        legs: 'l_bp',
        rarm: 'w_blade',
        larm: 'w_rifle',
        rback: 'bw_none',
        lback: 'bw_none',
      },
      pal: duel ? 'duelist' : D.lv >= 3 ? 'rust' : 'mt',
      scale: 1,
      hpMul: duel ? 2.4 : 3,
      dmgMul: 0.12,
      stabMul: D.stab || 1,
      ai: 'ac',
      wantDist: 10,
      speedMul: D.lv >= 2 ? 0.8 : 0.55,
      at: new THREE.Vector3(0, this.world.terrainHeight(0, 0), -20 * DS),
    });
    e.tutD = { ...D, ph: Math.random() * 6, cd: 1.5, atkT: 1.5, tele: null, burst: 0, idleT: 0 };
    T.dummy = e;
    T.respT = 0;
  },
  // 兩台放回開始位置：玩家在原點、假人在正前方（畫面上方＝−Z）
  tutReset() {
    const T = this.tut,
      p = this.player,
      e = T.dummy,
      W = this.world;
    const D = T.step.dummy || {};
    p.pos.set(0, W.terrainHeight(0, 0), 0);
    p.vel.set(0, 0, 0);
    p.meleeEnd();
    p.meleeResume = null;
    p.staggerT = 0;
    p.hp = p.maxHp;
    p.en = T.noEnFill ? p.enMax * T.step.setup.en : p.enMax;
    p.yaw = p.aimYaw = 0;
    p.qbT = p.abT = 0;
    if (e && !e.dead) {
      const d = this.tutDummyDist(D);
      e.pos.set(0, W.terrainHeight(0, -d), -d);
      e.vel.set(0, 0, 0);
      e.meleeEnd();
      e.yaw = e.aimYaw = Math.PI; // 面向玩家（+Z）
      e.hp = e.maxHp;
      e.hitStunT = 0;
      e.comboHits = 0;
      e.stagGuardT = 0;
      e.staggerT = D.stag ? 6 : 0;
      e.tutD.tele = null;
      e.tutD.burst = 0;
      e.tutD.atkT = 1.2;
      p.lock = e;
    }
    T.lastMv = null;
  },
  // 假人的開始距離（公尺）：dist（舊尺度）；lunge＝依武器第一招的突進算（突進距離的 lunge 倍，突進追擊的練習：
  // 每把武器都要真的拉長突進才搆得到，最遠 LUNGE_MAX，霰彈槍還打得到）
  tutDummyDist(D) {
    if (D.lunge) {
      const s0 = meleeMove(this.tutWDef(), 0);
      return clamp(s0.reach * this.player.scale + s0.dash * D.lunge, 14 * DS, LUNGE_MAX * DS);
    }
    return (D.dist || 12) * DS;
  },
  // ---------- 每格 ----------
  tutTick(dt) {
    const T = this.tut,
      p = this.player;
    if (!T || !p) return;
    T.clock += dt;
    const step = T.step;
    // 玩家不會被擊破；EN、彈藥補滿
    p.hp = Math.max(p.hp, p.maxHp * 0.5);
    if (!T.noEnFill && !p.melee.active) p.en = Math.max(p.en, p.enMax * 0.8);
    if ((T.ammoT = (T.ammoT || 0) - dt) <= 0) {
      T.ammoT = 1;
      for (const s of ['rarm', 'larm']) {
        const w = p.weapons[s];
        if (w && w.def.ammo > 0) w.ammo = w.def.ammo;
      }
    }
    // 假人被擊破：1.5 秒後重生
    const e = T.dummy;
    if (!e || e.dead) {
      T.respT += dt;
      if (T.respT > 1.5 && T.phase !== 'done') {
        this.tutSpawnDummy(step);
        if (step.reset) this.tutReset();
        else this.tutPlaceDummy();
      }
    } else if (!p.lock || p.lock.dead) p.lock = e;
    if (e && !e.dead && this.tutRing) {
      const st = meleeMove(this.tutWDef(), 0);
      const R = st.reach * p.scale + st.dash * 0.45;
      const dist = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
      const inR = dist <= R || e.staggerT > 0;
      this.tutRing.visible = true;
      this.tutRing.position.set(e.pos.x, this.world.terrainHeight(e.pos.x, e.pos.z) + 0.08, e.pos.z);
      this.tutRing.scale.setScalar(R); // 圈裡＝近戰打得到
      this.tutRing.material.color.setHex(e.tutD.tele ? 0xff5040 : inR ? 0x7ee081 : 0x8a97a6);
      T.inR = dist <= R;
      if (T.inR && T.phase === 'try') this.tutGoal('near', {});
    } else if (this.tutRing) this.tutRing.visible = false;
    if (T.msgT > 0) T.msgT -= dt;
    if (T.resetIn > 0 && (T.resetIn -= dt) <= 0) {
      if (T.phase === 'try' && !p.melee.active) this.tutReset();
      else if (T.phase === 'try') T.resetIn = 0.1;
    }
    // 階段
    if (T.phase === 'intro') {
      T.introT -= dt;
      if (T.introT <= 0)
        this.tutBegin(step.demo && !(T.seenDemo && T.seenDemo[step.id]) && !this.tutNoDemo ? 'demo' : 'try');
    } else if (T.phase === 'demo' || (T.phase === 'try' && this.tutAuto)) {
      this.tutScriptTick(dt);
    } else if (T.phase === 'ok') {
      T.okT -= dt;
      if (T.okT <= 0) this.tutStep(T.li + 1);
    } else if (T.phase === 'skip' && this.tutAuto) {
      this.tutSkip();
    }
    if (T.exam && T.phase === 'try') {
      T.exam.t -= dt;
      if (T.exam.t <= 0) this.tutExamEnd();
    }
    if ((T.uiT = (T.uiT || 0) - dt) <= 0) {
      T.uiT = 0.2;
      this.tutPanelRender();
    }
    this.tutBarTick();
  },
  // 遊戲速度（主迴圈的 dt 倍率）：示範 0.5 倍；練習依進度（speeds）
  tutSpeed() {
    const T = this.tut;
    if (!T || this.state !== 'play') return 1;
    if (T.phase === 'demo') return 0.5;
    const sp = T.step && T.step.speeds;
    if (!sp || T.phase !== 'try' || this.tutAuto) return 1;
    return sp[Math.min(Math.floor(T.reps / 2), sp.length - 1)]; // 每一段速度成功 2 次才加快
  },
  tutBegin(ph) {
    const T = this.tut;
    this.tutDevRelease();
    T.phase = ph;
    this.tutReset();
    this.tutVirt = null;
    if (ph === 'demo') {
      T.seenDemo = T.seenDemo || {};
      T.seenDemo[T.step.id] = 1;
      T.scr = { list: T.step.demo, i: 0, t: 0 };
    } else if (this.tutAuto) {
      T.scr = { list: T.step.auto || T.step.demo, i: 0, t: 0 };
    }
    this.tutPanelRender(true);
  },
  tutDemoAgain() {
    const T = this.tut;
    if (!T || !T.step || !T.step.demo || T.phase === 'ok') return;
    SFX.ui();
    if (this.state === 'pause') this.resume();
    this.tutBegin('demo');
  },
  tutSkip() {
    const T = this.tut;
    if (!T) return;
    SFX.ui();
    if (this.state === 'pause') this.resume();
    this.tutVirt = null;
    T.skipped = (T.skipped || 0) + (T.step.opt || T.skipTxt ? 0 : 1); // 選修與「這把武器沒有」不算跳過
    this.tutStep(T.li + 1);
  },
  // ---------- 示範腳本 ----------
  // 每格：照腳本算出這一格的輸入 V（{ 動作: 1 按下／2 還按著／true 按住, wish: 世界座標的移動方向 }）。
  // 示範與一般的自動操作直接當虛擬輸入（tutVirt，input.js 的 act 讀它）；冒煙測試的 tutAutoDev（'kb'｜'pad'｜'touch'）
  // 改成寫進那個裝置真正的輸入（按鍵、手把的按鈕與搖桿、觸控的按鈕與搖桿），按鍵對應、觸控攻擊鍵的自動切換、
  // QB 長按變突擊推進都照實際的流程跑
  tutScriptTick(dt) {
    const T = this.tut,
      S = T.scr;
    if (!S) return;
    const dev = this.tutDevOn();
    const V = (S.v = S.v || { wish: new THREE.Vector3() });
    this.tutVirt = dev ? null : V;
    this.tutScriptStep(dt, V);
    if (dev && this.tut && this.tut.scr === S) this.tutDevApply(V);
  },
  tutDevOn() {
    const T = this.tut;
    return !!(this.tutAutoDev && this.tutAuto && T && T.phase === 'try');
  },
  // 觸控：攻擊鍵在近戰距離內才是近戰（applySmartAttack）；還是射擊時腳本的近戰要等一下
  tutTouchWait() {
    return this.tutDevOn() && this.tutAutoDev === 'touch' && this.smartMode !== 'melee';
  },
  // 裝置模式：V → 裝置的輸入（移動方向換回畫面／機體的軸，照 player.js 的換算反過來）
  tutDevApply(V) {
    const dev = this.tutAutoDev,
      d = this.down;
    const [x, z] = V.wish.lengthSq() > 0.01 ? this.tutAxes(V.wish.clone().normalize()) : [0, 0];
    const on = (k) => !!V[k];
    if (dev === 'kb') {
      const K = this.keymap,
        t = 0.38; // 八方向
      d[K.right] = x > t;
      d[K.left] = x < -t;
      d[K.down] = z > t;
      d[K.up] = z < -t;
      for (const k of ['fireR', 'fireL', 'jump', 'ab']) d[K[k]] = on(k);
      d[K.qb] = V.qb === 1; // 鍵盤的 QB 按下一次（player.js 用掉就清掉）
      this.padActive = false;
      this.touchActive = false;
    } else if (dev === 'pad') {
      this.padMove = new THREE.Vector3(x, 0, z);
      const P = this.padmap;
      for (const k of ['fireR', 'fireL', 'qb', 'jump', 'ab']) d[P[k]] = on(k);
      this.padActive = true;
      this.touchActive = false;
    } else if (dev === 'touch') {
      this.touchActive = true;
      this.touchMove.set(x, 0, z);
      d['Touch_attack'] = on('fireR') || on('fireL'); // 觸控只有一顆攻擊鍵
      d['Touch_jump'] = on('jump');
      d['Touch_qbHold'] = on('ab'); // 按住 QB 鍵 0.4 秒＝突擊推進
      if (V.qb === 1) this.qbPulse = 2; // 點一下 QB 鍵
    }
  },
  // 裝置模式的輸入全部放開（換練習、過關、離開）
  tutDevRelease() {
    if (!this.tutAutoDev) return;
    const d = this.down;
    for (const k of ['up', 'down', 'left', 'right', 'fireR', 'fireL', 'qb', 'jump', 'ab']) {
      d[this.keymap[k]] = false;
      d[this.padmap[k]] = false;
    }
    for (const k of ['Touch_attack', 'Touch_jump', 'Touch_qbHold', 'Touch_ab']) d[k] = false;
    if (this.padMove) this.padMove.set(0, 0, 0);
    if (this.touchMove) this.touchMove.set(0, 0, 0);
  },
  tutScriptStep(dt, V) {
    const T = this.tut,
      S = T.scr,
      p = this.player,
      e = T.dummy;
    // 前一格按下的鍵放開（press＝一格）
    for (const k of ['fireR', 'fireL', 'qb'])
      if (V[k] === 1) V[k] = 2;
      else if (V[k] === 2) V[k] = false;
    V.wish.set(0, 0, 0);
    if (S.hold) {
      S.hold.t -= dt;
      V[S.hold.k] = true;
      if (S.hold.w) V.wish.copy(this.tutDirVec(S.hold.w));
      if (S.hold.t <= 0) {
        V[S.hold.k] = false;
        S.hold = null;
      } else if (!S.hold.async) return;
    }
    const a = S.list[S.i];
    if (!a) return;
    const next = () => {
      S.i++;
      S.t = 0;
    };
    S.t += dt;
    if (S.t > 8) return next(); // 卡住的條件：跳過
    const m = p.melee,
      st = m.active ? meleeMove(p.weapons[m.slot].def, m.stage) : null;
    switch (a[0]) {
      case 'near': {
        if (!e || e.dead) return;
        const s0 = meleeMove(this.tutWDef(), 0);
        const R = (s0.reach * p.scale + s0.dash * 0.45) * a[1];
        const dx = e.pos.x - p.pos.x,
          dz = e.pos.z - p.pos.z;
        if (Math.hypot(dx, dz) <= R) return next();
        V.wish.set(dx, 0, dz).normalize();
        return;
      }
      case 'dir':
        S.hold = { k: '_', t: a[2], w: a[1] };
        return next();
      case 'press': {
        let dir = a[1];
        if (dir === 'quiz') dir = T.quiz ? T.quiz.seq[T.quiz.i] : '';
        const slot = a[2] || 'rarm';
        const k = slot === 'larm' ? 'fireL' : 'fireR';
        if (V[k]) return; // 上一次按下還沒放開：等一格（否則不算按下）
        if (!m.active && p.weapons[slot].cd > 0) return; // 收招後武器還在冷卻：等冷卻完再按（否則這一下被吃掉）
        if (!m.active && this.tutTouchWait()) return; // 觸控：攻擊鍵變成「斬擊」才按
        V[k] = 1;
        if (dir) V.wish.copy(this.tutKeyVec(dir));
        S.lastDir = dir;
        return next();
      }
      case 'chain': {
        if (!m.active) return next();
        const d = p.weapons[m.slot].def;
        if (meleeNext(d, m.stage, a[1]) < 0 && meleeNext(d, m.stage, '') < 0) return next();
        if (m.queued >= 0) return; // 已經排好下一招
        if (m.t > st.dur * QUEUE_AT + 0.02 && !V.fireR) {
          V.fireR = 1;
          if (a[1]) V.wish.copy(this.tutKeyVec(a[1]));
        }
        return;
      }
      case 'wait': {
        const c = a[1];
        if (typeof c === 'number') {
          if (S.t >= c) next();
          return;
        }
        const D = e && !e.dead ? e.tutD : null;
        const tl = D && D.tele;
        const ok = {
          queue: m.active && m.t > st.dur * QUEUE_AT + 0.02,
          half: m.active && m.hitAny && m.t > st.dur * 0.56,
          hit: m.active && m.hitAny,
          idle: !m.active,
          air: !p.grounded,
          ground: p.grounded && !m.active,
          stag: e && !e.dead && e.staggerT > 0,
          tele: !!tl,
          parry: tl && tl.k === 'melee' && tl.t <= meleeMove(this.tutWDef(), 0).dur * 0.45,
          pqb: tl && tl.k === 'melee' && tl.t <= 0.04,
          shield: p.shieldHitT > 0,
          counter: false,
        }[c];
        // 綜合練習：揮刀＝彈刀、開槍＝等盾擋下後盾擊
        if (c === 'counter') {
          if (!tl && !(D && D.burst > 0) && S.t > 0.1 && !(p.shieldHitT > 0)) return next();
          if (tl && tl.k === 'melee' && tl.t <= meleeMove(this.tutWDef(), 0).dur * 0.45) {
            V.fireR = 1;
            return next();
          }
          if (p.shieldHitT > 0) {
            V.fireR = 1;
            return next();
          }
          return;
        }
        if (ok) next();
        return;
      }
      case 'shot':
        if (V.fireL) return;
        V.fireL = 1;
        return next();
      case 'qb':
        if (V.qb) return;
        V.qb = 1;
        V.wish.copy(this.tutDirVec(a[1] || 's'));
        return next();
      case 'jump':
        S.hold = { k: 'jump', t: a[1], w: 'f', async: true };
        return next();
      case 'ab': {
        // 按住突擊推進 a[1] 秒後往下（之後的 press 在推進中，推進再多按 0.35 秒）；
        // 觸控按住 QB 鍵 0.4 秒才推進，之後的 press 還要等攻擊鍵變成斬擊，所以按久一點
        const tw = this.tutDevOn() && this.tutAutoDev === 'touch' ? 0.4 : 0;
        if (!S.abOn) {
          S.abOn = true;
          S.hold = { k: 'ab', t: a[1] + 0.35 + tw * 4, w: 'f', async: true };
        }
        if (S.t >= a[1] + tw) {
          S.abOn = false;
          next();
        }
        return;
      }
      case 'hold':
        if (this.tutTouchWait()) return;
        S.hold = { k: 'fireR', t: a[1], async: false };
        return next();
      case 'shootStag':
        if (e && !e.dead && e.staggerT > 0) return next();
        if (p.weapons.larm.cd <= 0 && p.weapons.larm.reloadT <= 0 && !V.fireL) V.fireL = 1;
        return;
      case 'end':
        if (T.phase === 'demo') {
          this.tutVirt = null;
          T.scr = null;
          this.tutBegin('try');
        } else {
          // 自動操作：重來
          S.i = 0;
          S.t = 0;
          this.tutResetSoft();
        }
        return;
      default:
        return next();
    }
  },
  // 自動操作的一輪結束：假人有走開時拉回來
  tutResetSoft() {
    const T = this.tut;
    if (T.step.reset) this.tutReset();
  },
  // 方向派生的按鍵（f＝上、b＝下、s＝右）→ 這個按鍵在世界座標的移動方向（player.js 的換算）
  tutKeyVec(dir) {
    const x = dir === 's' ? 1 : 0,
      z = dir === 'f' ? -1 : dir === 'b' ? 1 : 0;
    if (this.ctrl.moveRel === 'mech' || this.camAim()) {
      const yy = this.camAim() ? this.fpYaw : this.player.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yy), 0, -Math.cos(yy));
      return fwd.multiplyScalar(-z).add(new THREE.Vector3(-fwd.z * x, 0, fwd.x * x));
    }
    return new THREE.Vector3(x, 0, z);
  },
  // 方向（相對假人）→ 世界座標的移動方向（QB、跳躍的移動）
  tutDirVec(dir) {
    const p = this.player,
      e = this.tut.dummy;
    const v = new THREE.Vector3(0, 0, -1);
    if (e && !e.dead) v.set(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z);
    if (v.lengthSq() < 1e-4) v.set(0, 0, -1);
    v.normalize();
    if (dir === 'b') v.negate();
    else if (dir === 's') v.set(-v.z, 0, v.x);
    return v;
  },
  // ---------- 判定 ----------
  // MechEntity 的 tutE 呼叫（只有玩家的機體；假人被打出失衡、玩家受傷由 takeDamage 呼叫）
  tutEv(k, o = {}) {
    const T = this.tut;
    if (!T || !this.player) return;
    T.log[k] = T.clock;
    const d = this.tutWDef();
    if (k === 'mv') {
      const md = this.player.weapons[o.slot || 'rarm'].def;
      o.tags = meleeTags(md).get(o.stage) || new Set();
      o.prev = !o.fresh && T.lastMv ? T.lastMv : null;
      // 太晚按：上一招之後接得下去（不是路線的最後一招），卻在收招後才按、從第一招重來
      o.late =
        o.fresh &&
        T.lastMv &&
        T.lastMvT !== undefined &&
        T.clock - T.lastMvT < 1.4 &&
        !['cEnd', 'fEnd', 'sEnd', 'bEnd', 'airEnd', 'dash', 'exec', 'bash'].some((t) => T.lastMv.has(t));
      T.lastMv = o.tags;
      T.lastMvT = T.clock;
      if (o.st && o.st.id === 'bash') T.log.bashMv = T.clock;
    }
    if (k === 'hit') {
      const md = this.player.weapons[this.player.melee.slot].def;
      o.tags = meleeTags(md).get(o.stage) || new Set();
      if (o.tgt && o.tgt.hitStunT > 0) this.tutGoal('stun', o);
      if (o.tags.has('bash')) this.tutGoal('counter', o);
    }
    if (k === 'parry' || k === 'pqb') this.tutGoal('counter', o);
    if (T.phase !== 'try') return;
    this.tutGoal(k, o);
    this.tutFeedback(k, o, d);
  },
  tutGoal(k, o) {
    const T = this.tut,
      step = T.step;
    if (!step || T.phase !== 'try') return;
    if (T.exam && k !== 'near') return this.tutExamEv(k, o);
    if (T.quiz) return this.tutQuizEv(k, o);
    let any = false;
    (step.goal || []).forEach((G, i) => {
      if (G.ev !== k || T.prog[i] >= G.n) return;
      if (G.tag && !(o.tags && o.tags.has(G.tag))) return;
      if (G.test && !G.test(o, T, this)) return;
      T.prog[i]++;
      any = true;
    });
    if (!any) return;
    T.reps++;
    SFX.play('uiOk', 0.5, 1.2, 0.02, 0.02, null, 'ui');
    const done = (step.goal || []).every((G, i) => T.prog[i] >= G.n);
    if (done) this.tutPass();
    else {
      T.msg = '<b class="ok">很好！</b>' + (this.tutSpeed() < 1 ? '　繼續（速度會慢慢加快）' : '　再一次');
      T.msgT = 1.6;
      if (step.reset) this.tutResetLater();
    }
    this.tutPanelRender(true);
  },
  // 成功後 0.9 遊戲秒把兩台放回開始位置（遊戲時間：放慢與冒煙測試的固定 dt 都一致；出招中等收招）
  tutResetLater() {
    this.tut.resetIn = 0.9;
  },
  tutPass() {
    const T = this.tut;
    this.tutDevRelease();
    T.phase = 'ok';
    T.okT = 1.4;
    this.tutVirt = null;
    T.scr = null;
    SFX.play('bell', 0.7, 1, 0.02, 0.02, null, 'ui');
    this.flashMsg('過關 — ' + T.step.t, 0x7ee081, 1.3, { k: 'good', m: '過關', s: T.step.t });
    this.tutPanelRender(true);
  },
  // 失敗的原因：說清楚錯在哪；同一步失敗 3 次後提示更具體、5 次後放慢
  tutFeedback(k, o, d) {
    const T = this.tut,
      step = T.step;
    const say = (msg) => {
      T.failN++;
      const h = step.hints || [];
      let s = `<b class="ng">${msg}</b>`;
      if (T.failN >= 3 && h[1]) s += '<br>' + this.tutText(h[1]);
      if (T.failN === 5) s += '<br><span class="dim">要不要再看一次示範？（暫停選單或面板的「示範」）</span>';
      T.msg = s;
      T.msgT = 3.2;
      if (T.failN % 3 === 0 && step.speeds && T.reps > 0)
        T.reps = Math.max(0, (Math.floor(T.reps / 2) - 1) * 2); // 失敗 3 次放慢一級
      this.tutPanelRender(true);
    };
    const wantDir = step.dir;
    if (k === 'early' && step.bar === 'queue') return say('太早按了：這一刀剛開始揮，晚一點點再按');
    if (k === 'mv' && o.late && step.bar === 'queue')
      return say('太晚了：上一刀收招後才按，從第一刀重來了。這一刀揮出去就按下一下');
    if (k === 'whiff' && !T.inR && !(T.dummy && T.dummy.staggerT > 0))
      return say('揮空了：先靠近，等假人腳下的圈變綠再出刀');
    if (k === 'qbEarly' && step.bar === 'resume') return say('QB 太早：這一刀要揮過一半才能取消');
    if (
      k === 'mv' &&
      o.fresh &&
      wantDir &&
      !o.tags.has(wantDir) &&
      !o.tags.has('air') &&
      !o.tags.has('dash') &&
      !o.tags.has('bash') &&
      // 觸控的滑動：點下去先出中立的第一招，滑完才改成派生（MechEntity.meleeSwipeDir），中立的先不算錯
      !(this.vpadWanted() && !['f', 's', 'b'].some((x) => o.tags.has(x)))
    )
      return say(`方向不對：按 [melee] 的那一下要按著「${DIRS[wantDir]}」（看箭頭）`);
    if (k === 'hurt' && o.melee && (step.bar === 'parry' || step.bar === 'pqb')) {
      const pr = T.log.press !== undefined && T.clock - T.log.press < 1.2;
      const qb = T.log.qb !== undefined && T.clock - T.log.qb < 1.2;
      if (step.bar === 'parry')
        return say(
          pr
            ? '太早了：你的刀先揮完了。晚一點，等時機條進到綠色'
            : '太晚了：被砍到了。紅光一閃就準備，時機條變綠就出刀',
        );
      return say(
        qb
          ? '太早閃了：無敵時間結束後才被打到。再晚一點按 [qb]'
          : '太晚了：被打到了。刀揮下來的那一刻按 [qb]',
      );
    }
    if (k === 'press' && step.bar === 'bash' && !o.queue && T.log.shieldHit !== undefined) {
      const ago = T.clock - T.log.shieldHit;
      if (ago > SHIELD_BASH_T && ago < 1.6) return say('盾擊太晚了：盾擋下的 0.5 秒內按 [melee]');
    }
  },
  // 小測驗：依序打出指定的方向起手
  tutQuizNew() {
    const T = this.tut,
      d = this.tutWDef();
    const pool = ['f', 'b'];
    if (d.start && d.start.s !== undefined) pool.push('s');
    const seq = [];
    for (let i = 0; i < T.step.goal[0].quiz; i++) {
      let x;
      do x = pool[Math.floor(Math.random() * pool.length)];
      while (seq.length && x === seq[seq.length - 1]);
      seq.push(x);
    }
    T.quiz = { seq, i: 0, want: null };
  },
  tutQuizEv(k, o) {
    const T = this.tut,
      Q = T.quiz;
    if (k === 'mv' && o.fresh) Q.want = o.tags.has(Q.seq[Q.i]) ? o.stage : -1;
    if (k === 'mv' && o.fresh && Q.want < 0 && !o.tags.has('air') && !o.tags.has('dash'))
      return this.tutFeedback('mv', o, null) || this.tutQuizWrong();
    if (k === 'hit' && Q.want === o.stage) {
      Q.i++;
      Q.want = null;
      T.prog[0] = Q.i;
      T.reps++;
      SFX.play('uiOk', 0.5, 1.2, 0.02, 0.02, null, 'ui');
      if (Q.i >= Q.seq.length) this.tutPass();
      this.tutPanelRender(true);
    }
  },
  tutQuizWrong() {
    const T = this.tut;
    T.failN++;
    T.msg = `<b class="ng">方向不對：這一題是「${DIRS[T.quiz.seq[T.quiz.i]]}」</b>`;
    T.msgT = 2.4;
    this.tutPanelRender(true);
  },
  // 結業考核：收集技巧的種類
  tutExamEv(k, o) {
    const X = this.tut.exam;
    const add = (t) => {
      if (X.kinds.has(t)) return;
      X.kinds.add(t);
      const nm = (EXAM_KINDS.find((q) => q[0] === t) || [t, t])[1];
      this.flashMsg(`技巧：${nm}（${X.kinds.size}）`, 0x7fc8ff, 1.1);
      SFX.play('uiOk', 0.55, 1.3, 0.02, 0.02, null, 'ui');
      this.tutPanelRender(true);
    };
    if (k === 'hit') {
      for (const t of ['cEnd', 'f', 's', 'b', 'airEnd', 'dash', 'bash']) if (o.tags.has(t)) add(t);
      if (o.lunge) add('lunge');
    }
    if (['jc', 'resume', 'link', 'exec', 'parry', 'pqb'].includes(k)) add(k);
  },
  tutExamEnd() {
    const T = this.tut,
      n = T.exam.kinds.size;
    const stars = EXAM_STARS.filter((s) => n >= s).length;
    T.stars = Math.max(T.stars || 0, stars);
    if (stars > 0) {
      T.prog[0] = n;
      this.tutPass();
      this.commSay('instructor', ['及格。', '不錯，很全面。', '漂亮。挑不出毛病。'][stars - 1]);
    } else {
      T.msg = `<b class="ng">時間到：${n} 種技巧，還差 ${EXAM_STARS[0] - n} 種。</b>　再來一次`;
      T.msgT = 4;
      T.exam = { t: T.step.goal[0].exam, kinds: new Set() };
      this.tutReset();
      this.tutPanelRender(true);
    }
  },
  // ---------- 假人的行為（MechEntity.updateAI 開頭；回傳 true＝不跑一般 AI）----------
  tutAI(e, dt) {
    const T = this.tut,
      D = e.tutD,
      p = this.player;
    if (!T || !p) return true;
    const dx = p.pos.x - e.pos.x,
      dz = p.pos.z - e.pos.z,
      dist = Math.hypot(dx, dz) || 1;
    const wish = new THREE.Vector3();
    let qb = false;
    const lv = T.phase === 'demo' || T.phase === 'try' || T.phase === 'skip' ? D.lv : 0;
    const armor = !!(D.tele || D.swing > 0); // 出招中不會被硬直打斷（才練得到彈刀）
    if (armor) e.hitStunT = 0;
    const busy = e.staggerT > 0 || e.hitStunT > 0 || (e.melee.active && !armor);
    if (!e.melee.active) e.yaw = e.aimYaw = Math.atan2(-dx, -dz);
    if (D.cd > 0) D.cd -= dt;
    const pm = p.melee.active;
    D.idleT = pm ? 0 : D.idleT + dt;
    if (D.swing > 0) D.swing -= dt;
    const blade = meleeMove(e.weapons.rarm.def, 0);
    const atkR = blade.reach * e.scale * 0.9 + 1.2 * DS;
    // 預警中：站著、時間到出手
    if (D.tele) {
      if (e.staggerT > 0) D.tele = null;
      else {
        D.tele.t -= dt;
        if (D.tele.k === 'melee' && dist > atkR * 0.85) wish.set(dx, 0, dz).normalize().multiplyScalar(0.6); // 貼近一點
        if (D.tele.t <= 0) {
          const k = D.tele.k;
          D.tele = null;
          D.cd = 0.6;
          if (k === 'melee') {
            e.weapons.rarm.cd = 0;
            e.en = e.enMax;
            e.fire('rarm', p.center(), p);
            D.swing = blade.dur + 0.1;
          } else D.burst = 0.55;
        }
      }
    }
    if (D.burst > 0) {
      D.burst -= dt;
      e.weapons.larm.cd = Math.min(e.weapons.larm.cd, 0.1);
      e.weapons.larm.reloadT = 0;
      e.weapons.larm.mag = Math.max(e.weapons.larm.mag, 5);
      e.fire('larm', p.center(), p);
    }
    if (!busy && !D.tele && !(D.burst > 0) && !(D.swing > 0)) {
      // 等級 1：走動（左右來回）
      if (lv >= 1) {
        const s = Math.sin(T.clock * 0.6 + D.ph);
        wish.set((-dz / dist) * s, 0, (dx / dist) * s).multiplyScalar(0.5);
        if (dist > Math.max(22 * DS, this.tutDummyDist(D) * 1.05))
          // 離太遠時走回來（突進的練習照開始的距離）
          wish.add(new THREE.Vector3(dx, 0, dz).normalize().multiplyScalar(0.5));
        if (dist < 6 * DS && lv < 4) wish.add(new THREE.Vector3(-dx, 0, -dz).normalize().multiplyScalar(0.3));
      }
      // 等級 2：靠近時偶爾 QB 拉開
      if (lv >= 2 && dist < 12 * DS && D.cd <= 0 && !pm && Math.random() < dt * 0.9) {
        wish.set(-dx, 0, -dz).normalize();
        wish.add(new THREE.Vector3(-dz, 0, dx).normalize().multiplyScalar(Math.random() < 0.5 ? 0.7 : -0.7));
        qb = true;
        D.cd = 2.6;
      }
      // 等級 3：你停手時反擊
      const recentHit = T.log.hit !== undefined && T.clock - T.log.hit < 2.5;
      if (lv === 3 && D.cd <= 0 && recentHit && D.idleT > 0.35 && dist < atkR * 1.6) {
        this.tutTele(
          e,
          D.atk === 'shot' ? 'shot' : D.atk === 'mix' && Math.random() < 0.35 ? 'shot' : 'melee',
        );
      }
      // 等級 4：主動出招
      if (lv >= 4) {
        D.atkT -= dt;
        const k =
          D.next || (D.next = D.atk === 'mix' ? (Math.random() < 0.5 ? 'melee' : 'shot') : D.atk || 'melee');
        const want = k === 'melee' ? atkR : 16 * DS;
        if (dist > want) wish.set(dx, 0, dz).normalize().multiplyScalar(0.8);
        if (D.atkT <= 0 && dist <= want * 1.15) {
          this.tutTele(e, k);
          D.next = null;
          const ev = D.every || [2.4, 3.2];
          D.atkT = ev[0] + Math.random() * (ev[1] - ev[0]);
        }
      }
      // 不要離場地中央太遠
      const hx = e.pos.x,
        hz = e.pos.z;
      if (Math.hypot(hx, hz) > 34 * DS) wish.set(-hx, 0, -hz).normalize();
    }
    if (busy && !armor) wish.set(0, 0, 0);
    e.move(dt, wish, false, qb, false, null);
    return true;
  },
  // 預警：紅光（揮刀）或紅線（開槍）
  tutTele(e, k) {
    const D = e.tutD;
    D.tele = { k, t: TELE, T: TELE };
    D.cd = 99;
    const c = e.center();
    this.fx.flash(c, 2.2, 0xff4030, 0.25);
    this.fx.ring(c, 3 * DS, 0xff4030);
    if (k === 'shot') this.fx.warnLine(e.center(), this.player.center(), TELE, 0xff4030, 0.08);
    SFX.play('alarm', 0.35, k === 'shot' ? 1.4 : 1.1, 0.02, 0.02, null, 'ui');
    if (this.popDamage)
      this.popDamage(c.clone().add(new THREE.Vector3(0, 2.5 * DS, 0)), '!', false, true, false, 0, e.id);
  },
  // AP 歸零：玩家一律不會被擊破；假人照練習的設定（kill＝可以擊破）
  tutSaveEnt(e) {
    if (e === this.player) {
      e.hp = e.maxHp;
      return true;
    }
    if (e.tutD && e.tutD.kill) return false;
    e.hp = e.maxHp;
    return true;
  },
  tutKilled(e) {
    const T = this.tut;
    if (!T || e !== T.dummy) return;
    T.respT = 0;
    if (T.phase === 'try') this.tutGoal('kill', {});
  },
  tutPlaceDummy() {
    const T = this.tut,
      e = T.dummy,
      p = this.player;
    const d = this.tutDummyDist(T.step.dummy || {});
    const to = new THREE.Vector3(0, 0, -1);
    e.pos.set(p.pos.x + to.x * d, 0, p.pos.z + to.z * d);
    const r = Math.hypot(e.pos.x, e.pos.z);
    if (r > 30 * DS) e.pos.multiplyScalar((30 * DS) / r);
    e.pos.y = this.world.terrainHeight(e.pos.x, e.pos.z);
    e.yaw = e.aimYaw = Math.PI;
    p.lock = e;
  },
  // ---------- 一課完成 ----------
  tutLessonDone() {
    const T = this.tut,
      L = T.L;
    T.phase = 'done';
    this.tutVirt = null;
    const S = this.tutSave();
    const r = (S.les[L.id] = S.les[L.id] || { w: [] });
    const first = !r.w.length;
    if (!r.w.includes(T.wid)) r.w.push(T.wid);
    if (T.stars) r.stars = Math.max(r.stars || 0, T.stars);
    let reward = '';
    if (first && L.coam) {
      this.save.coam += L.coam;
      reward = `COAM +${L.coam.toLocaleString()}`;
    }
    this.writeSave();
    const i = LESSONS.indexOf(L);
    const $ = (id) => document.getElementById(id);
    this.state = 'tutdone';
    let h = `<h2>第 ${i + 1} 課　${escHtml(L.n)}　完成</h2><p>武器：${escHtml(wName(T.wid))}</p>`;
    if (L.final && T.stars) h += `<p class="tutStars">${'★'.repeat(T.stars)}${'☆'.repeat(3 - T.stars)}</p>`;
    if (reward) h += `<p>獎勵：${reward}</p>`;
    if (T.skipped) h += `<p class="dim">跳過了 ${T.skipped} 個練習，之後可以再回來練。</p>`;
    // 結業：選一把近戰武器
    if (L.final && !S.prize) {
      const cand = TUT_PRIZES.filter((w) => !this.save.owned.includes(w));
      if (cand.length) {
        h += '<h3>結業獎勵：選一把近戰武器</h3><div class="tutWeps">';
        for (const w of cand) h += `<button class="tutPrize" data-w="${w}">${escHtml(wName(w))}</button>`;
        h += '</div>';
      } else {
        S.prize = 'coam';
        this.save.coam += TUT_PRIZE_COAM;
        this.writeSave();
        h += `<p>結業獎勵：三把近戰武器你都有了，改給 COAM +${TUT_PRIZE_COAM.toLocaleString()}</p>`;
      }
    }
    const nx = LESSONS[i + 1];
    h += '<div class="row">';
    if (nx) h += `<button class="primary" id="btnTutNext">下一課：${escHtml(nx.n)}</button>`;
    h += '<button id="btnTutAgain">換武器再練</button><button id="btnTutQuit">返回模擬器</button></div>';
    const card = $('tutDoneCard');
    card.innerHTML = `<div class="panel">${h}</div>`;
    this.showScreen('tutDoneCard');
    for (const b of card.querySelectorAll('.tutPrize'))
      b.onclick = () => {
        SFX.ui();
        if (!this.save.owned.includes(b.dataset.w)) this.save.owned.push(b.dataset.w);
        S.prize = b.dataset.w;
        this.writeSave();
        for (const x of card.querySelectorAll('.tutPrize')) x.disabled = true;
        b.classList.add('sel');
        b.textContent += '　✓ 已加入機甲庫';
      };
    if (nx) $('btnTutNext').onclick = () => this.tutStart(nx.id, T.wid);
    $('btnTutAgain').onclick = () => {
      this.tutExit(false);
      this.openSim();
      this.tutPick(L.id);
    };
    $('btnTutQuit').onclick = () => this.tutExit();
    this.commSay('instructor', L.final ? '結業。你已經是能用刀的傭兵了。' : '這一課完成。');
    if (this.pointerLocked && document.exitPointerLock) document.exitPointerLock();
  },
  // ---------- 畫面 ----------
  // 按鍵的標示（依裝置）
  tutKey(act) {
    const touch = this.vpadWanted(),
      pad = !touch && this.padActive;
    // 方向派生的方向就是按鍵本身的方向（上＝前、下＝後、左右＝側），和目標在哪裡無關
    const dirTxt = { f: '上', s: '左或右', b: '下' };
    if (dirTxt[act])
      return `<kbd class="dir">${touch ? '搖桿往' + dirTxt[act] : pad ? '左搖桿往' + dirTxt[act] : escHtml(this.tutDirKeys(act))}</kbd>`;
    if (act === 'move') {
      if (touch) return '<kbd>左下的搖桿</kbd>';
      if (pad) return '<kbd>左搖桿</kbd>';
      const K = this.keymap;
      return `<kbd>${['up', 'left', 'down', 'right'].map((k) => escHtml(this.keyLabel(K[k]))).join(' ')}</kbd>`;
    }
    if (touch) {
      const t = {
        melee: '攻擊鍵',
        melee2: '攻擊鍵',
        shot: '攻擊鍵',
        qb: 'QB 鍵',
        jump: '跳躍鍵',
        ab: 'QB 鍵（按住）',
      };
      return `<kbd>${t[act] || act}</kbd>`;
    }
    const name =
      { melee: 'fireR', melee2: 'fireL', shot: 'fireL', qb: 'qb', jump: 'jump', ab: 'ab' }[act] || act;
    const lbl = pad ? this.padLabel(this.padmap[name]) : this.keyLabel(this.keymap[name]);
    return `<kbd>${escHtml(lbl)}</kbd>`;
  },
  // 世界座標的方向 → 畫面（或機體）的軸 [右, 下]（player.js 的移動換算反過來）
  tutAxes(w) {
    const p = this.player;
    if (this.ctrl.moveRel === 'mech' || this.camAim()) {
      const yy = this.camAim() ? this.fpYaw : p.yaw;
      const fwd = new THREE.Vector3(-Math.sin(yy), 0, -Math.cos(yy));
      return [w.dot(new THREE.Vector3(-fwd.z, 0, fwd.x)), -w.dot(fwd)];
    }
    return [w.x, w.z];
  },
  // 鍵盤：方向派生要按的移動鍵（f＝上、b＝下、s＝左或右）
  tutDirKeys(dir) {
    const K = this.keymap,
      L = (k) => this.keyLabel(K[k]);
    return dir === 'f' ? L('up') : dir === 'b' ? L('down') : `${L('left')} 或 ${L('right')}`;
  },
  tutText(s) {
    const d = this.tutWDef();
    return s
      .replace(/\[(melee2|melee|shot|qb|jump|ab|move|f|s|b)\]/g, (m, k) => this.tutKey(k))
      .replace(/\{w\}/g, escHtml(wName(this.tut.wid)))
      .replace(/\{(\w+)\}/g, (m, t) => `<b class="mv">${escHtml(tagName(d, t) || t)}</b>`);
  },
  tutPanelRender(force) {
    const T = this.tut,
      el = document.getElementById('tutPanel');
    if (!T || !el || !T.step) return;
    const step = T.step,
      L = T.L,
      i = LESSONS.indexOf(L);
    const key = [
      T.li,
      T.phase,
      T.prog.join(),
      T.msg,
      T.msgT > 0,
      T.quiz && T.quiz.i,
      T.exam && T.exam.kinds.size,
      Math.ceil(T.exam ? T.exam.t : 0),
      this.tutSpeed(),
      this.padActive,
      this.vpadWanted(),
    ].join('|');
    if (!force && key === T.panelKey) return;
    T.panelKey = key;
    const dots = L.steps.map((s, j) => `<i class="${j < T.li ? 'd' : j === T.li ? 'c' : ''}"></i>`).join('');
    let h = `<div class="tpHead"><span>第 ${i + 1} 課　${escHtml(L.n)}</span><span class="tpDots">${dots}</span></div>`;
    h += `<div class="tpTitle">${T.li + 1}. ${escHtml(step.t)}${step.opt ? '<small>選修</small>' : ''}</div>`;
    if (T.phase === 'skip') {
      h += `<div class="tpText">${escHtml(T.skipTxt)}</div><div class="tpBtns"><button data-a="skip" class="primary">下一步</button></div>`;
      el.innerHTML = h;
      return;
    }
    h += `<div class="tpText">${this.tutText(step.text)}</div>`;
    if (step.tip) h += `<div class="tpTip">${escHtml(step.tip)}</div>`;
    if (step.touch && this.vpadWanted()) h += `<div class="tpDev">${escHtml(step.touch)}</div>`;
    if (T.phase === 'demo') h += '<div class="tpDemo">▶ 示範中（0.5 倍速）——看清楚按鍵的順序</div>';
    else if (T.phase === 'ok') h += '<div class="tpOk">✓ 過關</div>';
    else {
      const g = step.goal || [];
      if (T.quiz) {
        const Q = T.quiz;
        h += `<div class="tpQuiz">${Q.seq.map((x, j) => `<b class="${j < Q.i ? 'd' : j === Q.i ? 'c' : ''}">${DIRS[x]}</b>`).join(' → ')}</div>`;
      } else if (T.exam) {
        h += `<div class="tpProg">剩下 <b>${Math.max(0, Math.ceil(T.exam.t))}</b> 秒　技巧 <b>${T.exam.kinds.size}</b> 種（${EXAM_STARS.join('／')} 種＝★／★★／★★★）</div>`;
        h += `<div class="tpKinds">${EXAM_KINDS.map(([k, n]) => `<i class="${T.exam.kinds.has(k) ? 'd' : ''}">${n}</i>`).join('')}</div>`;
      } else
        h += `<div class="tpProg">${g.map((G, j) => `${escHtml(G.lbl || '')} <b>${T.prog[j]}／${G.n}</b>`).join('　')}${this.tutSpeed() < 1 ? `<span class="tpSpd">${this.tutSpeed()}× 慢速</span>` : ''}</div>`;
    }
    if (T.msgT > 0 && T.msg) h += `<div class="tpMsg">${T.msg}</div>`;
    else if (T.phase === 'try' && T.failN === 0 && step.hints && step.hints[0])
      h += `<div class="tpHint">${this.tutText(step.hints[0])}</div>`;
    h +=
      '<div id="tutBar"><div class="tbTrack"><i class="tbZone"></i><i class="tbMark"></i></div><span class="tbLbl"></span></div>';
    h += `<div class="tpBtns">${step.demo ? '<button data-a="demo">示範</button>' : ''}<button data-a="skip">${step.opt ? '跳過（選修）' : '跳過'}</button></div>`;
    el.innerHTML = h;
  },
  // 時機條：每格更新位置
  tutBarTick() {
    const T = this.tut,
      bar = document.getElementById('tutBar');
    if (!T || !bar) return;
    const p = this.player,
      m = p.melee,
      kind = T.step && T.step.bar;
    let show = false,
      z0 = 0,
      z1 = 0,
      x = 0,
      lbl = '',
      on = false;
    const st = m.active ? meleeMove(p.weapons[m.slot].def, m.stage) : null;
    const e = T.dummy && !T.dummy.dead ? T.dummy : null;
    const tl = e && e.tutD.tele;
    if (T.phase === 'try' || T.phase === 'demo') {
      const A = p.meleeA() || { buf: QUEUE_AT, grace: 0 };
      const G = p.meleeGrace;
      if (kind === 'queue' && ((st && !st.exec) || (!m.active && G))) {
        // 時機條＝這一招＋收招後的寬限：先行輸入（A.buf）到寬限結束都可以按；按了就記住
        show = true;
        const dur = st ? st.dur : G.dur,
          a = dur / (dur + A.grace);
        z0 = A.buf * a;
        z1 = 1;
        x = st ? (m.t / dur) * a : a + (1 - a) * (1 - G.t / G.T);
        on = true;
        const q = st && m.queued >= 0 ? meleeMove(p.weapons[m.qSlot || m.slot].def, m.queued) : null;
        lbl = q ? `記住了：接「${q.name}」` : st ? '現在按就記住下一招' : '收招了：快按，還接得上';
      } else if (kind === 'link' && st && !st.exec) {
        show = true;
        z0 = LINK_SHOT_AT;
        z1 = 1;
        x = m.t / st.dur;
        on = x >= z0 && m.hitAny;
        lbl = m.hitAny ? '這一刀打中了：綠色時按射擊' : '先打中';
      } else if (kind === 'resume' && p.meleeResume) {
        show = true;
        z0 = 0;
        z1 = 1;
        x = 1 - p.meleeResume.t / RESUME_T;
        on = true;
        lbl = '接回的時間：現在按近戰';
      } else if (kind === 'resume' && st && m.hitAny) {
        show = true;
        z0 = 0.5;
        z1 = 1;
        x = m.t / st.dur;
        on = x > 0.5;
        lbl = '過了一半：按 QB 取消';
      } else if ((kind === 'parry' || kind === 'pqb') && tl && tl.k === 'melee') {
        show = true;
        const span = TELE + 0.2;
        const dur = meleeMove(this.tutWDef(), 0).dur;
        if (kind === 'parry') {
          z0 = (TELE - dur * 0.8) / span;
          z1 = (TELE - dur * 0.15) / span;
        } else {
          z0 = (TELE - 0.1) / span;
          z1 = (TELE + 0.02) / span;
        }
        x = (tl.T - tl.t) / span;
        on = x >= z0 && x <= z1;
        lbl = kind === 'parry' ? '綠色時按近戰（彈刀）' : '綠色時按 QB（完美迴避）';
      } else if (kind === 'bash' && p.shieldHitT > 0) {
        show = true;
        z0 = 0;
        z1 = 1;
        x = 1 - p.shieldHitT / SHIELD_BASH_T;
        on = true;
        lbl = '盾擋下了：現在按近戰';
      } else if (kind === 'exec' && (p.mHoldR || 0) > 0) {
        show = true;
        z0 = 1;
        z1 = 1;
        x = clamp(p.mHoldR / EXEC_HOLD, 0, 1);
        on = x >= 1;
        lbl = e && e.staggerT > 0 ? '按住不放…' : '假人沒有失衡：先打出失衡';
      }
    }
    bar.style.visibility = show ? 'visible' : 'hidden';
    if (!show) return;
    const zone = bar.querySelector('.tbZone'),
      mk = bar.querySelector('.tbMark');
    zone.style.left = clamp(z0, 0, 1) * 100 + '%';
    zone.style.width = clamp(z1 - z0, 0, 1) * 100 + '%';
    mk.style.left = clamp(x, 0, 1) * 100 + '%';
    bar.classList.toggle('on', on);
    bar.querySelector('.tbLbl').textContent = lbl;
  },
  // 畫在 HUD 畫布上：方向箭頭、預警
  tutHud(c) {
    const T = this.tut;
    if (!T || !T.step || (T.phase !== 'try' && T.phase !== 'demo')) return;
    const p = this.player,
      e = T.dummy;
    if (!e || e.dead) return;
    let dir = T.step.dir;
    if (T.quiz) dir = T.quiz.seq[T.quiz.i];
    if (!dir) return;
    // 畫面上的方向＝按鍵的方向（上＝前、下＝後、右＋淡淡的左＝側）
    const a = this.proj(p.center());
    if (!a.in) return;
    const ux = dir === 's' ? 1 : 0,
      uy = dir === 'f' ? -1 : dir === 'b' ? 1 : 0;
    const len = 70;
    const x0 = a.x + ux * 30,
      y0 = a.y + uy * 30,
      x1 = a.x + ux * (30 + len),
      y1 = a.y + uy * (30 + len);
    c.save();
    c.strokeStyle = 'rgba(255,208,96,0.9)';
    c.fillStyle = 'rgba(255,208,96,0.9)';
    c.lineWidth = 6;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1 - ux * 12, y1 - uy * 12);
    c.stroke();
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - ux * 20 - uy * 12, y1 - uy * 20 + ux * 12);
    c.lineTo(x1 - ux * 20 + uy * 12, y1 - uy * 20 - ux * 12);
    c.closePath();
    c.fill();
    if (dir === 's') {
      // 側：另一邊也畫
      c.globalAlpha = 0.45;
      c.beginPath();
      c.moveTo(a.x - ux * 30, a.y - uy * 30);
      c.lineTo(a.x - ux * (30 + len) + ux * 12, a.y - uy * (30 + len) + uy * 12);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.font = 'bold 14px "Noto Sans TC", sans-serif';
    c.textAlign = 'center';
    c.fillText(DIRS[dir], x1 + ux * 16, y1 + uy * 16 + 5);
    c.restore();
  },
  // 作戰室：第一次進來時教官建議先上第 1 課（只一次）
  tutHubIntro() {
    const S = this.tutSave();
    if (S.intro || this.tutDone('L1') || (this.net && this.net.role)) return;
    S.intro = 1;
    this.writeSave();
    setTimeout(() => {
      if (this.state !== 'hub') return;
      this.commSay('instructor', '新來的？模擬艙開了近戰訓練課程。出擊前先上第 1 課，不會花你太多時間。');
    }, 2600);
  },
});
