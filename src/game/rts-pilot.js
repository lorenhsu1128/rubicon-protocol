// Coral 戰爭（RTS）的親自駕駛與自動管家（mixin；docs/rts-design.md 13.8、13.16）。
// 親自駕駛：選一位己方英雄按 F → 這位英雄變成 this.player，用一般任務的動作操作（updatePlayer、updateCamera、drawHud）；
//   state 在駕駛中是 'play'（一般任務的滑鼠、指標鎖定、視角、鎖定、暫停都看 'play'），game.js 的 loop 在 this.rts 存在時
//   照樣交給 rtsTick；rtsTick 在 R.pilot 時呼叫 rtsPilotView（動作鏡頭＋動作 HUD＋RTS 小面板），rtsSim 在單位迴圈前呼叫
//   rtsPilotStep（updatePlayer），單位迴圈略過 e.rtsPiloted。
//   離開：長按 F 0.6 秒（短按照常是突擊推進）、暫停選單的「回到指揮」、英雄陣亡、局結束、rtsClear（rtsPilotExit(why)）。
//   鍵位：Z X C V＝英雄的 4 個技能（目標＝鎖定的敵人或準星指的地點）、1～6＝道具、F1～F3＝換開另一位英雄、B＝切換視角
//   （V 給技能用）；修復套件鍵停用（英雄用道具回復）。
// 自動管家（R.butler，rtsButlerTick 每 1 秒）：gather 閒置工人回去採礦、loop 建築的循環生產、depot 人口快滿時蓋補給庫、
//   defend 基地被攻擊時閒置部隊回防與工人修理、follow 新生產的戰鬥單位跟著親自駕駛的英雄。
//   親自駕駛時一律啟動；指揮時由資源列的「管家」按鈕開啟（R.butler.on）；設定記在 localStorage rubicon_rts 的 butler。
// C 包（英雄、技能、道具）的 API 一律以 typeof／?.() 判斷（還沒實作時略過）。
import { Game } from './game.js';
import { RTS_DEFS, RTS_FACTIONS, RTS_GATHER, RTS_POP_MAX } from '../data/rts-units.js';
import { RTS_SKILLS } from '../data/rts-heroes.js';

const RTS_ME = 0;
const HOLD_EXIT = 0.6; // 長按 F 幾秒離開
const BUTLER_DT = 1; // 自動管家的間隔（秒）
const IDLE_T = 3; // 工人閒置幾秒才派去採礦
const MINE_R = 32; // 自動採集只選己方主堡多遠內的礦脈
const DEFEND_R = 42; // 敵人進入己方建築多遠內算基地被攻擊
const DEFEND_POOL = 70; // 回防的部隊：離被攻擊的建築多遠內的閒置部隊
const DEPOT_LEFT = 6; // 人口剩幾格時蓋補給庫
const PREF_KEY = 'rubicon_rts';
const NO_ALLIES = [];
const BUTLER_KEYS = ['gather', 'loop', 'depot', 'defend', 'follow'];
const BUTLER_NAME = {
  gather: '自動採集',
  loop: '循環生產',
  depot: '自動蓋補給庫',
  defend: '基地防衛',
  follow: '新部隊跟隨英雄',
};

Object.assign(Game.prototype, {
  // ---------- 親自駕駛 ----------
  // 可以親自駕駛的英雄（己方、活著、不是建築）
  rtsPilotCan(e) {
    const R = this.rts;
    if (!R || R.over || !e || e.dead || !e.hero || e.rtsTeam !== RTS_ME || e.bld) return '';
    const H = e.hs; // C 包：施放中（衝刺、跳躍、潛地、引導）
    if (H && (H.dash || H.leap || H.burrow || H.chan)) return '施放技能中';
    return 'ok';
  },
  rtsPilotEnter(e) {
    const R = this.rts;
    if (!R || R.pilot) return false;
    const ok = this.rtsPilotCan(e);
    if (ok !== 'ok') {
      if (ok) this.rtsMsg(ok, 0xff8a8a);
      return false;
    }
    const t0 = performance.now();
    this.rtsPilotBind();
    const ui = R.ui;
    if (ui) {
      if (ui.mode && this.rtsSetMode) this.rtsSetMode(null);
      ui.menu = null;
      ui.drag = null;
      ui.rot = null;
    }
    R.pilot = {
      e,
      t0: R.t,
      cam: { ...(R.cam || {}) },
      prevSel: (R.sel || []).slice(),
      hold: 0,
      fov: this.camera.fov,
      ms: 0,
    };
    if (this.rtsSetOrders) this.rtsSetOrders(e, []);
    else e.orders = [];
    if (e.rt) e.rt.cur = undefined;
    this.player = e;
    e.isPlayer = true;
    e.slot = 0;
    e.rtsPiloted = true;
    e.lock = null;
    e.lockT = 0;
    this.fpYaw = e.yaw;
    this.fpPitch = 0;
    this.camUser = 1;
    this.chaseUser = 1;
    this.camFocus = e;
    if (this.mouseWorld)
      this.mouseWorld.set(e.pos.x - Math.sin(e.yaw) * 10, e.pos.y, e.pos.z - Math.cos(e.yaw) * 10);
    // 一般任務的輸入狀態（按著的鍵、滑鼠）清掉，避免進入時就在開火
    for (const k in this.down) this.down[k] = false;
    this.state = 'play';
    this.showScreen('');
    document.body.classList.add('rtsPilot');
    const hud = document.getElementById('rtsHud');
    if (hud) hud.classList.add('pilot');
    this.rtsPilotBtn(true);
    if (this.viewReset) this.viewReset();
    this.rtsHudDirty = true;
    this.rtsMsg(`親自駕駛：${e.name || this.rtsUiName(e)}（長按 F 回到指揮）`, 0x7ee081, 2.4);
    R.pilot.ms = performance.now() - t0;
    return true;
  },
  // 離開：why＝'key'（長按 F）、'menu'（暫停選單）、'dead'、'end'（局結束）、'switch'（換英雄）、'clear'（rtsClear）
  rtsPilotExit(why) {
    const R = this.rts;
    const P = R && R.pilot;
    if (!P) return false;
    const t0 = performance.now();
    const e = P.e;
    R.pilot = null;
    if (this.player === e) this.player = null;
    if (e) {
      e.isPlayer = false;
      e.rtsPiloted = false;
      delete e.slot;
      e.lock = null;
      e.fpFace = false;
    }
    for (const k in this.down) this.down[k] = false;
    // 視角還原：俯視、放開滑鼠鎖定、鏡頭的視角
    if (this.setView) this.setView('top', true);
    if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (err) {
        void err;
      }
    }
    if (this.fpShow) this.fpShow();
    this.camera.fov = P.fov;
    this.camera.updateProjectionMatrix();
    this.camFocus = null;
    document.body.classList.remove('rtsPilot', 'chaseView');
    const hud = document.getElementById('rtsHud');
    if (hud) hud.classList.remove('pilot');
    this.rtsPilotBtn(false);
    if (why === 'clear') return true;
    // 回到指揮：鏡頭回到進入前的設定、注視點移到英雄的位置，選取＝這位英雄
    const C = (R.cam = { ...P.cam });
    const at = e ? e.pos : { x: C.x, z: C.z };
    C.gy = null;
    if (this.rtsCamJump) this.rtsCamJump(at.x, at.z);
    R.sel = e && !e.dead ? [e] : [];
    if (R.ui) {
      R.ui.sub = 0;
      R.ui.menu = null;
      R.ui.focus = null;
    }
    if (this.state === 'play' || this.state === 'pause' || this.state === 'settings') {
      this.state = 'rts';
      this.showScreen('');
    }
    this.rtsHudDirty = true;
    if (why === 'dead') this.rtsMsg('英雄陣亡 — 回到指揮', 0xff6a5a, 2.4);
    else if (why !== 'switch' && why !== 'end') this.rtsMsg('回到指揮', 0x7ee081, 1.4);
    this.rtsPilotLastExitMs = performance.now() - t0;
    return true;
  },
  // 暫停選單的「回到指揮」按鈕（只在親自駕駛時顯示）
  rtsPilotBtn(on) {
    let b = document.getElementById('btnRtsCmd');
    if (!b) {
      const res = document.getElementById('btnResume');
      if (!res) return;
      b = document.createElement('button');
      b.id = 'btnRtsCmd';
      b.type = 'button';
      b.textContent = '回到指揮';
      b.onclick = () => this.rts && this.rts.pilot && this.rtsPilotExit('menu');
      res.insertAdjacentElement('afterend', b);
    }
    b.style.display = on ? '' : 'none';
  },
  // 鍵盤（捕獲階段，只在親自駕駛中、state 'play'）：技能、道具、換英雄、視角
  rtsPilotBind() {
    if (this._rtsPilotBound) return;
    this._rtsPilotBound = true;
    addEventListener(
      'keydown',
      (e) => {
        const R = this.rts;
        if (!R || !R.pilot || this.state !== 'play') return;
        const code = e.code;
        const stop = () => {
          e.preventDefault();
          e.stopImmediatePropagation();
        };
        const sk = { KeyZ: 0, KeyX: 1, KeyC: 2, KeyV: 3 }[code];
        if (sk !== undefined && !e.ctrlKey && !e.metaKey) {
          stop();
          if (!e.repeat) this.rtsPilotSkill(sk);
          return;
        }
        const d = /^Digit([1-6])$/.exec(code);
        if (d && !e.ctrlKey && !e.metaKey) {
          stop();
          if (!e.repeat) this.rtsPilotItem(+d[1] - 1);
          return;
        }
        const f = /^F([1-3])$/.exec(code);
        if (f) {
          stop();
          if (!e.repeat) this.rtsPilotSwitch(+f[1] - 1);
          return;
        }
        if (code === 'KeyB') {
          stop();
          if (!e.repeat && this.cycleView) this.cycleView();
          return;
        }
        // 修復套件：英雄沒有（用道具回復）
        if (this.keymap && code === this.keymap.kit) stop();
      },
      true,
    );
  },
  // 技能與道具的目標：鎖定的敵人，否則準星指的地面點
  rtsPilotTarget() {
    const p = this.player;
    if (!p) return null;
    if (p.lock && !p.lock.dead) return { id: p.lock.id, x: p.lock.pos.x, z: p.lock.pos.z, ent: p.lock };
    const a = this.aimRet || this.mouseWorld;
    if (a) return { x: a.x, z: a.z };
    return { x: p.pos.x - Math.sin(p.yaw) * 10, z: p.pos.z - Math.cos(p.yaw) * 10 };
  },
  rtsPilotSkill(slot) {
    const R = this.rts,
      e = R && R.pilot && R.pilot.e;
    if (!e || !e.hero) return false;
    const rec = e.hero;
    const D = RTS_DEFS[e.rtsDef] || {};
    const id = (D.skills || [])[slot];
    const S = id && RTS_SKILLS[id];
    if (!S) return (this.rtsMsg('沒有這個技能', 0xff8a8a), false);
    const lv = (rec.sk && rec.sk[slot]) || 0;
    if (!lv) return (this.rtsMsg('尚未學習：' + S.name, 0xff8a8a), false);
    if (S.kind === 'passive' || S.kind === 'aura')
      return (this.rtsMsg(S.name + '是被動技能', 0xffd070), false);
    const why = this.rtsHudSkillWhy ? this.rtsHudSkillWhy(e, slot) : '';
    if (why) return (this.rtsMsg(why, 0xff8a8a), false);
    // 目標：unit＝鎖定的敵人（友軍技能＝英雄自己）、point＝鎖定的敵人或準星指的地點（超出射程時拉回射程邊緣）、self＝不用
    const aim = this.rtsPilotTarget();
    let tgt = null;
    if (S.kind === 'unit') {
      tgt = S.tgt === 'ally' ? e : aim && aim.ent;
      if (!tgt) return (this.rtsMsg('先鎖定目標', 0xff8a8a), false);
      const d = Math.hypot(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z);
      if (S.range && d > S.range + 1) return (this.rtsMsg(`太遠（射程 ${S.range} m）`, 0xff8a8a), false);
    } else if (S.kind === 'point' && aim) {
      let dx = aim.x - e.pos.x,
        dz = aim.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      if (S.range && d > S.range) ((dx *= S.range / d), (dz *= S.range / d));
      tgt = { x: e.pos.x + dx, z: e.pos.z + dz };
    }
    // C 包：立刻施放（rtsSkillCast(英雄, slot, 目標)；距離由這裡處理）
    let ok = false;
    if (typeof this.rtsSkillCast === 'function') ok = this.rtsSkillCast(e, slot, tgt);
    if (!ok) this.rtsMsg('不能施放：' + S.name, 0xff8a8a);
    return !!ok;
  },
  rtsPilotItem(slot) {
    const R = this.rts,
      e = R && R.pilot && R.pilot.e;
    if (!e || !e.hero) return false;
    const inv = e.hero.inv || [];
    if (!inv[slot]) return (this.rtsMsg('道具欄 ' + (slot + 1) + ' 是空的', 0xff8a8a), false);
    if (typeof this.rtsItemUse !== 'function') return false;
    const tgt = this.rtsPilotTarget();
    return this.rtsItemUse(e, slot, tgt ? { x: tgt.x, z: tgt.z, id: tgt.id } : null) !== false;
  },
  // F1～F3：換開另一位英雄
  rtsPilotSwitch(i) {
    const R = this.rts;
    const rec = (R.teams[RTS_ME].heroes || [])[i];
    const e = rec && rec.ent;
    if (!e || e.dead) return (this.rtsMsg('這位英雄不在場上', 0xff8a8a), false);
    if (R.pilot && R.pilot.e === e) return false;
    const cam = R.pilot ? R.pilot.cam : null;
    this.rtsPilotExit('switch');
    const ok = this.rtsPilotEnter(e);
    if (ok && cam) R.pilot.cam = cam;
    return ok;
  },
  // rtsSim 每格（單位迴圈之前）：長按 F 離開、英雄的操作（一般任務的 updatePlayer）
  rtsPilotStep(dt) {
    const R = this.rts,
      P = R && R.pilot;
    if (!P) return;
    const e = P.e;
    if (!e || e.dead) return this.rtsPilotExit('dead');
    if (R.over) return this.rtsPilotExit('end');
    if (this.player !== e) this.player = e;
    // 長按 F（突擊推進的鍵）：0.6 秒離開
    const k = this.keymap && this.keymap.ab;
    if (k && this.down[k] && this.state === 'play') {
      P.hold += dt;
      if (P.hold >= HOLD_EXIT) {
        this.down[k] = false;
        this.keys[k] = false;
        P.hold = 0;
        return this.rtsPilotExit('key');
      }
    } else P.hold = 0;
    // 英雄不接 RTS 指令
    if (e.orders && e.orders.length) e.orders.length = 0;
    if (this.state === 'play') this.updatePlayer(dt);
    else e.move(dt, new THREE.Vector3(), false, false, false, null);
    // 彈藥無限（同 RTS 指揮時）
    for (const s in e.weapons) {
      const w = e.weapons[s],
        wd = w && w.def;
      if (wd && wd.ammo && w.ammo < wd.ammo * 0.5) w.ammo = wd.ammo;
    }
  },
  // rtsTick（R.pilot 時取代 rtsCamUpdate）：動作鏡頭、動作 HUD、RTS 的小面板
  rtsPilotView(dt) {
    const R = this.rts,
      P = R && R.pilot;
    if (!P) return this.rtsCamUpdate && this.rtsCamUpdate(dt);
    // 暫停選單的「繼續」（input.js 的 resume）會把 state 改成 'rts'：親自駕駛中改回 'play'
    if (this.state === 'rts') this.state = 'play';
    const e = P.e;
    // RTS 鏡頭的注視點跟著英雄（render-setup.js 以它當 lodFrom：IK、AI 分批的距離）
    if (R.cam) {
      R.cam.x = e.pos.x;
      R.cam.z = e.pos.z;
      R.cam.gy = e.pos.y;
    }
    this.updateCamera(dt);
    // 動作 HUD：友軍的名牌（一般任務的支援機，名稱＋剩餘秒數）不畫，RTS 的己方單位很多
    const al = this.allies;
    this.allies = NO_ALLIES;
    try {
      this.drawHud(dt);
    } finally {
      this.allies = al;
    }
    if (this.rtsHudTick) this.rtsHudTick(dt);
    // 長按 F 的進度
    if (P.hold > 0.08) {
      const c = this.hctx,
        x = innerWidth / 2,
        y = innerHeight * 0.62;
      const k = Math.min(1, P.hold / HOLD_EXIT);
      c.save();
      c.lineWidth = 5;
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.beginPath();
      c.arc(x, y, 22, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = '#7ee081';
      c.beginPath();
      c.arc(x, y, 22, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
      c.stroke();
      c.font = 'bold 13px Chakra Petch, sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#e8f0ff';
      c.fillText('回到指揮', x, y + 42);
      c.restore();
    }
  },

  // ---------- 自動管家 ----------
  rtsButlerPrefs() {
    try {
      const P = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
      return P.butler || null;
    } catch (err) {
      return null;
    }
  },
  rtsButlerSave() {
    const B = this.rts && this.rts.butler;
    if (!B) return;
    try {
      const P = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {};
      P.butler = { on: !!B.on };
      for (const k of BUTLER_KEYS) P.butler[k] = !!B[k];
      localStorage.setItem(PREF_KEY, JSON.stringify(P));
    } catch (err) {
      void err;
    }
  },
  rtsButlerSet(k, v) {
    const B = this.rts && this.rts.butler;
    if (!B) return;
    B[k] = v === undefined ? !B[k] : !!v;
    this.rtsButlerSave();
    this.rtsHudDirty = true;
  },
  rtsButlerName(k) {
    return BUTLER_NAME[k] || k;
  },
  rtsButlerActive() {
    const R = this.rts;
    return !!(R && R.butler && (R.butler.on || R.pilot));
  },
  rtsButlerTick(dt) {
    const R = this.rts;
    if (!R || !R.butler || R.over) return;
    const B = R.butler;
    if (!B._init) {
      B._init = true;
      const P = this.rtsButlerPrefs();
      if (P) for (const k of ['on', ...BUTLER_KEYS]) if (P[k] !== undefined) B[k] = !!P[k];
      if (B.on === undefined) B.on = false;
      B._t = 0;
    }
    B._t += dt;
    if (B._t < BUTLER_DT) return;
    const step = B._t;
    B._t = 0;
    const T = R.teams[RTS_ME];
    if (!T || !T.alive) return;
    this.rtsButlerScan(step);
    if (B.loop) this.rtsButlerLoop(T);
    if (!this.rtsButlerActive()) return;
    if (B.gather) this.rtsButlerGather(step);
    if (B.depot) this.rtsButlerDepot(T);
    if (B.defend) this.rtsButlerDefend(T);
    if (B.follow && R.pilot) this.rtsButlerFollow();
  },
  // 每次：記下工人採的礦脈、建築最後生產的單位、新出現的單位（生產完成的提示、跟隨英雄）
  rtsButlerScan(step) {
    const R = this.rts,
      B = R.butler;
    const fresh = [];
    for (const e of R.units) {
      if (e.dead || e.rtsTeam !== RTS_ME) continue;
      if (e.bld) {
        const q = e.bld.queue && e.bld.queue[0];
        if (q && !q.res && !q.upg && !q.revive && RTS_DEFS[q.id] && !RTS_DEFS[q.id].hero) e.bld.lastId = q.id;
        continue;
      }
      const D = RTS_DEFS[e.rtsDef] || {};
      const o = e.orders && e.orders[0];
      if (D.worker) {
        if (o && o.k === 'gather') e._bMine = o.mine;
        e._bIdle = !e.orders.length && !e.rtsMilFrom ? (e._bIdle || 0) + step : 0;
      }
      if (!e._bSeen) {
        e._bSeen = true;
        if (B._seen0) fresh.push(e);
      }
    }
    B._seen0 = true;
    B._fresh = fresh;
    // 親自駕駛時：生產完成的提示（右上角的小字）
    if (R.pilot && fresh.length && this.rtsHudPilotNote) {
      const n = fresh.filter((e) => !e.hero);
      if (n.length)
        this.rtsHudPilotNote(
          '生產完成：' + this.rtsUiName(n[0]) + (n.length > 1 ? ` 等 ${n.length} 台` : ''),
          0x7ee081,
          'prod',
        );
    }
  },
  // 循環生產：佇列空了、付得起、人口夠時再排一次最後生產的單位
  rtsButlerLoop(T) {
    const R = this.rts;
    for (const b of R.units) {
      if (b.dead || !b.bld || b.rtsTeam !== RTS_ME || !b.bld.loop || b.bld.progress < 1) continue;
      if (b.bld.queue.length || !b.bld.lastId) continue;
      const D = RTS_DEFS[b.bld.lastId];
      if (!D) continue;
      if ((T.pop || 0) + (D.pop || 0) > (T.cap || 0)) continue; // 人口滿時暫停、不扣款
      if (this.rtsAfford && !this.rtsAfford(RTS_ME, D.cost)) continue;
      if (this.rtsQueue) this.rtsQueue(b, b.bld.lastId);
    }
  },
  // 自動採集：閒置超過 3 秒的工人分到最近、沒飽和、己方主堡 32 m 內的礦脈（建造或修理完成的回到原本的礦脈）
  rtsButlerGather() {
    const R = this.rts;
    const drops = R.units.filter(
      (b) =>
        !b.dead && b.bld && b.rtsTeam === RTS_ME && b.bld.progress >= 1 && (RTS_DEFS[b.rtsDef] || {}).dropoff,
    );
    if (!drops.length) return;
    const near = (m) => drops.some((b) => Math.hypot(b.pos.x - m.pos.x, b.pos.z - m.pos.z) <= MINE_R);
    const sat = RTS_GATHER.sat || 5;
    const ok = (m) => m && m.amount > 0 && near(m) && m.miners.size < sat;
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || !(RTS_DEFS[e.rtsDef] || {}).worker) continue;
      if ((e._bIdle || 0) < IDLE_T || e.orders.length) continue;
      let m = e._bMine !== undefined && this.rtsMine ? this.rtsMine(e._bMine) : null;
      if (!ok(m)) {
        m = null;
        let bd = 1e9;
        for (const q of R.mines) {
          if (!ok(q)) continue;
          const d = Math.hypot(q.pos.x - e.pos.x, q.pos.z - e.pos.z);
          if (d < bd) ((bd = d), (m = q));
        }
      }
      if (!m || !this.rtsOrder) continue;
      this.rtsOrder([e], { k: 'gather', mine: m.id });
      e._bIdle = 0;
    }
  },
  // 補給庫：人口剩 6 以內、上限 < 150、沒有補給庫在蓋時，派一個工人在主堡附近蓋
  rtsButlerDepot(T) {
    const R = this.rts,
      B = R.butler;
    if ((T.cap || 0) >= RTS_POP_MAX || (T.cap || 0) - (T.pop || 0) > DEPOT_LEFT) return;
    if (B._depotT && R.t < B._depotT) return;
    const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
    const depot = (F.blds || []).find((id) => {
      const D = RTS_DEFS[id];
      return D && D.popCap && !D.dropoff && !D.heroes;
    });
    if (!depot) return;
    // 已經在蓋（工地，或工人正要去蓋）
    for (const e of R.units) {
      if (e.dead || e.rtsTeam !== RTS_ME) continue;
      if (e.bld && e.rtsDef === depot && e.bld.progress < 1) return;
      if (!e.bld && e.orders.some((o) => o.k === 'build' && o.def === depot)) return;
    }
    const D = RTS_DEFS[depot];
    if (this.rtsAfford && !this.rtsAfford(RTS_ME, D.cost)) return;
    const spot = this.rtsAutoSpot ? this.rtsAutoSpot(RTS_ME, depot) : null;
    if (!spot) return;
    // 工人：沒帶著礦、離工地最近的（閒置的優先）
    let w = null,
      bs = 1e9;
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || !(RTS_DEFS[e.rtsDef] || {}).worker || e.rtsMilFrom)
        continue;
      const o = e.orders[0];
      if (o && o.k !== 'gather') continue;
      const s =
        Math.hypot(e.pos.x - spot.x, e.pos.z - spot.z) + (e.carry && e.carry.n ? 30 : 0) + (o ? 10 : 0);
      if (s < bs) ((bs = s), (w = e));
    }
    if (!w || !this.rtsOrder) return;
    const back = w.orders[0] && w.orders[0].k === 'gather' ? w.orders[0].mine : w._bMine;
    this.rtsOrder([w], { k: 'build', def: depot, x: spot.x, z: spot.z, yaw: 0 });
    if (back !== undefined) this.rtsOrder([w], { k: 'gather', mine: back }, true);
    B._depotT = R.t + 8;
    if (R.pilot && this.rtsHudPilotNote) this.rtsHudPilotNote('管家：蓋補給庫', 0xffd070, 'depot');
  },
  // 基地防衛：敵人進入己方建築 42 m 內 → 附近閒置的戰鬥單位攻擊移動過去（威脅消失後回原位）；被攻擊的建築派 2 個工人修理
  rtsButlerDefend(T) {
    const R = this.rts;
    const foes =
      typeof this.rtsFogEnemies === 'function'
        ? this.rtsFogEnemies(RTS_ME)
        : R.units.filter((e) => !e.dead && e.rtsTeam !== RTS_ME);
    const blds = R.units.filter((b) => !b.dead && b.bld && b.rtsTeam === RTS_ME);
    let threat = null,
      at = null;
    for (const f of foes) {
      if (f.dead || f.bld || f.rtsInv) continue;
      for (const b of blds) {
        const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
        if (d < DEFEND_R + Math.max(b.bld.w || 0, b.bld.d || 0) / 2) {
          threat = f;
          at = b;
          break;
        }
      }
      if (threat) break;
    }
    const combat = (e) => {
      const D = RTS_DEFS[e.rtsDef] || {};
      return (
        !e.dead &&
        !e.bld &&
        e.rtsTeam === RTS_ME &&
        !D.worker &&
        !e.hero &&
        !e.rtsPiloted &&
        D.kind === 'unit'
      );
    };
    if (threat) {
      const go = R.units.filter(
        (e) =>
          combat(e) && !e.orders.length && Math.hypot(e.pos.x - at.pos.x, e.pos.z - at.pos.z) < DEFEND_POOL,
      );
      for (const u of go) if (!u._bHome) u._bHome = { x: u.pos.x, z: u.pos.z };
      if (go.length && this.rtsOrder) this.rtsOrder(go, { k: 'amove', x: threat.pos.x, z: threat.pos.z });
    } else {
      // 威脅消失：回原位
      const back = R.units.filter((e) => combat(e) && e._bHome && !e.orders.length);
      for (const u of back) {
        if (this.rtsOrder) this.rtsOrder([u], { k: 'move', x: u._bHome.x, z: u._bHome.z });
        u._bHome = null;
      }
    }
    // 修理：受損 < 70%、礦石 > 100、被攻擊中（最近受傷）
    if ((T.ore || 0) <= 100) return;
    for (const b of blds) {
      if (b.bld.progress < 1 || b.hp >= b.maxHp * 0.7) continue;
      if (!threat && !(b._bHurtT && R.t - b._bHurtT < 10)) continue;
      const fixing = R.units.filter(
        (w) =>
          !w.dead &&
          w.rtsTeam === RTS_ME &&
          w.orders[0] &&
          w.orders[0].k === 'repair' &&
          w.orders[0].id === b.id,
      ).length;
      if (fixing >= 2) continue;
      const ws = R.units
        .filter(
          (w) =>
            !w.dead &&
            !w.bld &&
            w.rtsTeam === RTS_ME &&
            (RTS_DEFS[w.rtsDef] || {}).worker &&
            !w.rtsMilFrom &&
            (!w.orders[0] || w.orders[0].k === 'gather'),
        )
        .sort(
          (a, c) =>
            Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z) -
            Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z),
        )
        .slice(0, 2 - fixing);
      for (const w of ws) {
        const back = w.orders[0] && w.orders[0].k === 'gather' ? w.orders[0].mine : w._bMine;
        if (!this.rtsOrder) break;
        this.rtsOrder([w], { k: 'repair', id: b.id });
        if (back !== undefined) this.rtsOrder([w], { k: 'gather', mine: back }, true);
      }
    }
  },
  // 跟隨：新生產的戰鬥單位攻擊移動到親自駕駛的英雄身邊；離太遠的跟上
  rtsButlerFollow() {
    const R = this.rts,
      B = R.butler,
      h = R.pilot.e;
    const combat = (e) => {
      const D = RTS_DEFS[e.rtsDef] || {};
      return !e.dead && !e.bld && e.rtsTeam === RTS_ME && !D.worker && !e.hero && D.kind === 'unit';
    };
    for (const u of B._fresh || []) if (combat(u)) u._bFollow = true;
    const go = R.units.filter(
      (u) =>
        u._bFollow && combat(u) && !u.orders.length && Math.hypot(u.pos.x - h.pos.x, u.pos.z - h.pos.z) > 14,
    );
    if (go.length && this.rtsOrder) this.rtsOrder(go, { k: 'amove', x: h.pos.x, z: h.pos.z });
  },
});
