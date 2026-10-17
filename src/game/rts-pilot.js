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
// R3 艾瑟立克（docs 14.15）：幻象不能親自駕駛；友軍技能的目標＝範圍內血量比例最低的合格友軍（只給生體單位的技能挑
//   bio，引導中的融合宿主優先）；管家的補給＝陣營的 node（導管節點，rtsAutoSpot 已經看 rtsPowerWhy）、
//   工人不能修理的陣營（定義的 noRepair）不派修理。
// R4 維爾威（docs 15.15）：沒有建造工人的陣營（airdrop）管家的補給艙改用空投（rtsDropOrder，地點用 rtsAutoSpot、不行時
//   在主基地附近找 rtsDropWhy＝'' 的地方；空投中的也算「在蓋」）；親自駕駛＋新部隊跟隨時，英雄在投放範圍內
//   （信標、調度中心、有軌道通訊站時任何探索過的地方）就把軌道調度所的集結點移到英雄身邊，投放艙直接降在英雄旁
//   （離開時還原集結點）；在運輸機上的英雄不能親自駕駛。
// R5 聖域（docs 16.15）：自動採集對有拾荒的陣營另外派閒置工人拆回收點 45 m 內看過的殘骸（最多工人的 1/4、至少 2 台；
//   20 m 內看得到敵人的不去；價值 ÷（距離＋20）挑）；閒置的回收拖車開到殘骸多的地方展開（rtsButlerHaul），附近拆完了收起
//   換地方；親自駕駛時 HUD 標出英雄 25 m 內的殘骸（rts-hud.js 的 rtsHudPilotWrecks）。
import { Game } from './game.js';
import { RTS_DEFS, RTS_FACTIONS, RTS_GATHER, RTS_POP_MAX } from '../data/rts-units.js';
import { RTS_SKILLS } from '../data/rts-heroes.js';
import { RTS_SANC } from '../data/rts-sancta.js';

const RTS_ME = 0;
const HOLD_EXIT = 0.6; // 長按 F 幾秒離開
const BUTLER_DT = 1; // 自動管家的間隔（秒）
const IDLE_T = 3; // 工人閒置幾秒才派去採礦
const MINE_R = 32; // 自動採集只選己方主堡多遠內的礦脈
const DEFEND_R = 42; // 敵人進入己方建築多遠內算基地被攻擊
const DEFEND_POOL = 70; // 回防的部隊：離被攻擊的建築多遠內的閒置部隊
const DEPOT_LEFT = 6; // 人口剩幾格時蓋補給庫
const PREF_KEY = 'rubicon_rts';
const SALV_R = 45; // 管家的拾荒：回收點多遠內的殘骸
const SALV_SAFE = 20; // 殘骸這麼近有看得到的敵人時不去
const HAUL_R = 50; // 回收拖車：多遠內找殘骸堆
const HAUL_MIN = 60; // 展開的門檻：10 m 內合計的礦石
const HAUL_IDLE = 8; // 展開後附近沒有殘骸幾秒就換地方
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
    if (R && e && !e.dead && e.rtsIllus && e.rtsTeam === RTS_ME) return '幻象不能親自駕駛';
    if (!R || R.over || !e || e.dead || !e.hero || e.rtsTeam !== RTS_ME || e.bld) return '';
    if (e.rtsAboard) return '在運輸機上不能親自駕駛';
    const H = e.hs; // C 包：施放中（衝刺、跳躍、潛地、引導）
    if (H && (H.dash || H.leap || H.burrow || H.chan || H.blitz)) return '施放技能中';
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
    this.rtsButlerRallyBack();
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
      tgt = S.tgt === 'ally' ? this.rtsPilotAlly(e, S) : aim && aim.ent;
      if (!tgt) return (this.rtsMsg('先鎖定目標', 0xff8a8a), false);
      const d =
        Math.hypot(tgt.pos.x - e.pos.x, tgt.pos.z - e.pos.z) -
        (tgt.bld ? Math.max(tgt.bld.w || 0, tgt.bld.d || 0) / 2 : 0);
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
  // 友軍技能的目標：範圍內（含英雄自己）血量比例最低的合格友軍（技能有 bld 時含蓋好的己方建築）；生體技能（S.bio）只挑 bio 單位，引導中的融合宿主優先
  //   （CURATOR 的催化會立刻完成融合）；都沒有時是英雄自己（C 包會判斷能不能施放）
  rtsPilotAlly(e, S) {
    const R = this.rts;
    const bio = !!(S.bio || S.tgt2 === 'bio');
    const range = (S.range || 0) + 1;
    let best = bio ? null : e,
      bs = bio ? 1e9 : e.hp / Math.max(1, e.maxHp) + 0.001;
    for (const u of R.units) {
      if (u === e || u.dead || u.rtsTeam !== RTS_ME || u.rtsIllus) continue;
      // 建築：技能定義的 bld（MENDER 的修復光束，R5）才挑蓋好的己方建築，距離從佔地邊緣算
      if (u.bld && (!S.bld || u.bld.progress < 1 || u.rtsInv)) continue;
      const D = RTS_DEFS[u.rtsDef] || {};
      if (bio && !D.bio) continue;
      const half = u.bld ? Math.max(u.bld.w || 0, u.bld.d || 0) / 2 : 0;
      if (range > 1 && Math.hypot(u.pos.x - e.pos.x, u.pos.z - e.pos.z) - half > range) continue;
      const chan = u.rtsFusing && u.orders[0] && u.orders[0].k === 'fuse';
      const sc = u.hp / Math.max(1, u.maxHp) - (chan ? 2 : 0);
      if (sc < bs) ((bs = sc), (best = u));
    }
    return best || e;
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
    // 聖域（R5）：英雄附近的殘骸
    if (this.rtsHudPilotWrecks && R.wrecks) this.rtsHudPilotWrecks(this.hctx);
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
    if (k === 'gather' && this.rtsSalvageTeam && this.rts && this.rtsSalvageTeam(RTS_ME))
      return '自動採集與拾荒';
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
    if (B.gather && R.salvage && this.rtsSalvageTeam && this.rtsSalvageTeam(RTS_ME)) this.rtsButlerHaul(step);
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
    const salv = this.rtsButlerSalvPlan(drops);
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || !(RTS_DEFS[e.rtsDef] || {}).worker) continue;
      if ((e._bIdle || 0) < IDLE_T || e.orders.length) continue;
      // 聖域：拾荒工還沒滿時先拆殘骸
      if (salv && salv.left > 0 && (RTS_DEFS[e.rtsDef] || {}).salvager) {
        const w = this.rtsButlerSalvPick(e, salv);
        if (w && this.rtsOrder && this.rtsOrder([e], { k: 'salvage', wid: w.id })) {
          salv.left--;
          e._bIdle = 0;
          continue;
        }
      }
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
  // 聖域的拾荒計畫：{ list（回收點 45 m 內看過、有價值、附近沒有敵人的殘骸）, left（還能再派幾台拾荒工） }；不是聖域＝null
  rtsButlerSalvPlan(drops) {
    const R = this.rts;
    if (!R.salvage || !this.rtsWreckAt || !this.rtsSalvageTeam || !this.rtsSalvageTeam(RTS_ME)) return null;
    const seen = new Set();
    const list = [];
    for (const b of drops)
      for (const w of this.rtsWreckAt(b.pos.x, b.pos.z, SALV_R, { team: RTS_ME })) {
        if (seen.has(w) || !(w.ore > 0)) continue;
        seen.add(w);
        list.push(w);
      }
    if (!list.length) return { list, left: 0, pend: new Map() };
    const foes =
      typeof this.rtsFogEnemies === 'function'
        ? this.rtsFogEnemies(RTS_ME).filter((f) => !f.dead && !f.bld && !f.rtsInv)
        : [];
    const safe = list.filter((w) => !foes.some((f) => Math.hypot(f.pos.x - w.x, f.pos.z - w.z) < SALV_SAFE));
    let workers = 0,
      busy = 0;
    const pend = new Map();
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || !(RTS_DEFS[e.rtsDef] || {}).worker) continue;
      workers++;
      const o = e.orders[0];
      if (o && o.k === 'salvage') {
        busy++;
        const w = this.rtsWreckById && this.rtsWreckById(o.wid);
        if (w && !(w.takers && w.takers.has(e.id))) pend.set(w, (pend.get(w) || 0) + 1); // 走過去中的也算
      }
    }
    const max = Math.max(2, Math.ceil(workers / 4));
    return { list: safe, left: Math.max(0, max - busy), pend };
  },
  // 給這個工人挑殘骸：價值 ÷（距離＋20），還沒飽和的（地圖殘骸 2 人、其他 3 人）
  rtsButlerSalvPick(e, plan) {
    let best = null,
      bs = -1;
    for (const w of plan.list) {
      if (w.gone || !(w.ore > 0)) continue;
      const sat = w.map ? RTS_SANC.wreck.map.sat : RTS_SANC.salvage.sat;
      const n = (w.takers ? w.takers.size : 0) + (plan.pend.get(w) || 0);
      if (n >= sat) continue;
      const sc = w.ore / (Math.hypot(w.x - e.pos.x, w.z - e.pos.z) + 20);
      if (sc > bs) ((bs = sc), (best = w));
    }
    if (best) plan.pend.set(best, (plan.pend.get(best) || 0) + 1); // 同一次分派裡先算進去（走到了 takers 才會加）
    return best;
  },
  // 回收拖車：閒置、收起的開到 50 m 內殘骸最多的地方（10 m 內合計 ≥ 60 礦石）展開；展開後附近沒有殘骸 8 秒就收起換地方
  rtsButlerHaul(step) {
    const R = this.rts;
    if (!this.rtsWreckAt || !this.rtsOrder) return 0;
    const H = RTS_SANC.hauler;
    const foes =
      typeof this.rtsFogEnemies === 'function'
        ? this.rtsFogEnemies(RTS_ME).filter((f) => !f.dead && !f.bld && !f.rtsInv)
        : [];
    let n = 0;
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || e.rtsAboard || e.rtsPiloted) continue;
      if (!(RTS_DEFS[e.rtsDef] || {}).hauler) continue;
      const o = e.orders[0];
      if (o && !(e._bHaul && o.k === 'move')) continue; // 玩家下了別的指令
      if (e.rtsHaulOn) {
        e._bHaul = null;
        const near = this.rtsWreckAt(e.pos.x, e.pos.z, H.r, { team: RTS_ME }).some((w) => w.ore > 0);
        e._bHaulIdle = near ? 0 : (e._bHaulIdle || 0) + step;
        if (e._bHaulIdle < HAUL_IDLE) continue;
      }
      // 找殘骸堆：每個殘骸當中心，10 m 內合計的礦石
      let best = null,
        bs = HAUL_MIN - 1;
      for (const w of this.rtsWreckAt(e.pos.x, e.pos.z, HAUL_R, { team: RTS_ME })) {
        if (!(w.ore > 0)) continue;
        if (foes.some((f) => Math.hypot(f.pos.x - w.x, f.pos.z - w.z) < SALV_SAFE + 5)) continue;
        let sum = 0;
        for (const q of this.rtsWreckAt(w.x, w.z, H.r - 2, { team: RTS_ME })) sum += q.ore;
        const sc = sum - Math.hypot(w.x - e.pos.x, w.z - e.pos.z) * 0.5;
        if (sc > bs) ((bs = sc), (best = w));
      }
      if (!best) continue;
      const d = Math.hypot(best.x - e.pos.x, best.z - e.pos.z);
      if (d > 5) {
        if (e.rtsHaulOn && e._bHaulIdle < HAUL_IDLE) continue;
        // 移動指令會自動收起（B 包）
        if (!o) {
          this.rtsOrder([e], { k: 'move', x: best.x, z: best.z });
          e._bHaul = { x: best.x, z: best.z };
          n++;
        }
      } else if (!e.rtsHaulOn && !o && !(e._bHaulCastT > R.t)) {
        // 到了：展開（ab_haul 是切換，冷卻 2 秒；4 秒內不重複下）
        this.rtsOrder([e], { k: 'ability', ab: 'ab_haul' });
        e._bHaulCastT = R.t + 4;
        e._bHaul = null;
        e._bHaulIdle = 0;
        n++;
      }
    }
    return n;
  },
  // 補給庫：人口剩 6 以內、上限 < 150、沒有補給庫在蓋時，派一個工人在主堡附近蓋
  rtsButlerDepot(T) {
    const R = this.rts,
      B = R.butler;
    if ((T.cap || 0) >= RTS_POP_MAX || (T.cap || 0) - (T.pop || 0) > DEPOT_LEFT) return;
    if (B._depotT && R.t < B._depotT) return;
    const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
    // 補給：陣營的 node（艾瑟立克的導管節點），否則給人口、不是主堡的建築
    const depot =
      (F.node && RTS_DEFS[F.node] && F.node) ||
      (F.blds || []).find((id) => {
        const D = RTS_DEFS[id];
        return D && D.popCap && !D.dropoff && !D.heroes;
      });
    if (!depot) return;
    // 已經在蓋（工地，或工人正要去蓋，或空投中）
    for (const e of R.units) {
      if (e.dead || e.rtsTeam !== RTS_ME) continue;
      if (e.bld && e.rtsDef === depot && e.bld.progress < 1) return;
      if (!e.bld && e.orders.some((o) => o.k === 'build' && o.def === depot)) return;
    }
    if ((R.drops || []).some((d) => d.team === RTS_ME && d.def === depot && d.st !== 'back')) return;
    const D = RTS_DEFS[depot];
    if (this.rtsAfford && !this.rtsAfford(RTS_ME, D.cost)) return;
    // 維爾威：空投（不派工人）
    if (F.airdrop) return this.rtsButlerDrop(depot);
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
    if (R.pilot && this.rtsHudPilotNote)
      this.rtsHudPilotNote('管家：蓋' + ((RTS_DEFS[depot] || {}).name || '補給庫'), 0xffd070, 'depot');
  },
  // 空投陣營的補給艙：rtsAutoSpot 的位置（rtsDropWhy 不行時在主基地 50 m 內找可以投放的地方）→ rtsDropOrder
  rtsButlerDrop(defId) {
    const R = this.rts,
      B = R.butler;
    if (!this.rtsDropOrder || !this.rtsDropWhy) return null;
    const L = this.rtsDropLift ? this.rtsDropLift(RTS_ME) : null;
    if (L && L.n >= L.max) return null; // 運輸機都在任務中：下一秒再試
    let spot = this.rtsAutoSpot ? this.rtsAutoSpot(RTS_ME, defId) : null;
    if (spot && this.rtsDropWhy(RTS_ME, defId, spot.x, spot.z, 0)) spot = null;
    if (!spot) {
      const hq = R.units.find(
        (e) => !e.dead && e.bld && e.rtsTeam === RTS_ME && (RTS_DEFS[e.rtsDef] || {}).heroes && !e.bld.packed,
      );
      if (!hq) return null;
      for (let r = 14; r <= 50 && !spot; r += 4)
        for (let a = 0; a < 16; a++) {
          const x = hq.pos.x + Math.cos((a / 16) * Math.PI * 2) * r,
            z = hq.pos.z + Math.sin((a / 16) * Math.PI * 2) * r;
          if (!this.rtsDropWhy(RTS_ME, defId, x, z, 0)) {
            spot = { x, z };
            break;
          }
        }
    }
    if (!spot) return null;
    const rec = this.rtsDropOrder(RTS_ME, defId, spot.x, spot.z, 0, { quiet: true });
    if (!rec) return null;
    B._depotT = R.t + 8;
    if (R.pilot && this.rtsHudPilotNote)
      this.rtsHudPilotNote('管家：空投' + ((RTS_DEFS[defId] || {}).name || '補給艙'), 0xffd070, 'depot');
    return rec;
  },
  // 親自駕駛＋跟隨（維爾威）：英雄在投放範圍內時，軌道調度所的集結點移到英雄身邊（投放艙直接降在旁邊）
  rtsButlerRally(h) {
    const R = this.rts;
    if (!this.rtsVeerTeam || !this.rtsVeerTeam(RTS_ME) || !this.rtsBeaconAt) return 0;
    const inRange =
      !!this.rtsBeaconAt(RTS_ME, h.pos.x, h.pos.z) ||
      (this.rtsHasOrbit &&
        this.rtsHasOrbit(RTS_ME) &&
        (!this.rtsFogState || this.rtsFogState(RTS_ME, h.pos.x, h.pos.z) >= 1));
    let n = 0;
    for (const b of R.units) {
      if (b.dead || !b.bld || b.rtsTeam !== RTS_ME || b.bld.progress < 1) continue;
      const D = RTS_DEFS[b.rtsDef] || {};
      if (!(D.trains || []).some((id) => (RTS_DEFS[id] || {}).dropIn)) continue;
      if (inRange) {
        if (!b._bRally) b._bRally = { r: b.bld.rally ? { ...b.bld.rally } : null };
        b.bld.rally = { x: h.pos.x, z: h.pos.z };
        n++;
      } else if (b._bRally) {
        b.bld.rally = b._bRally.r;
        b._bRally = null;
      }
    }
    return n;
  },
  // 離開親自駕駛：還原管家改過的集結點
  rtsButlerRallyBack() {
    const R = this.rts;
    if (!R) return;
    for (const b of R.units)
      if (b._bRally) {
        if (b.bld) b.bld.rally = b._bRally.r;
        b._bRally = null;
      }
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
    // 修理：受損 < 70%、礦石 > 100、被攻擊中（最近受傷）；工人不能修理的陣營（艾瑟立克：建築在導管裡自己回血）不派
    if ((T.ore || 0) <= 100 || this.rtsButlerNoRepair(T)) return;
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
            !(RTS_DEFS[w.rtsDef] || {}).noRepair &&
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
  // 這個陣營的工人不能修理（定義的 noRepair）
  rtsButlerNoRepair(T) {
    const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
    const W = RTS_DEFS[F.worker];
    return !!(W && W.noRepair);
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
    this.rtsButlerRally(h); // 維爾威：投放艙降在英雄旁
    const go = R.units.filter(
      (u) =>
        u._bFollow && combat(u) && !u.orders.length && Math.hypot(u.pos.x - h.pos.x, u.pos.z - h.pos.z) > 14,
    );
    if (go.length && this.rtsOrder) this.rtsOrder(go, { k: 'amove', x: h.pos.x, z: h.pos.z });
  },
});
