// Coral 戰爭（RTS）的 HUD（mixin）：上方資源列（層級、維持費、管家）、英雄頭像列、左下小地圖（營地、中立建築、英雄、警示、
// 信號、閒置工人／部隊）、中下選取面板（攻擊／護甲類型、研究等級、英雄的技能與背包）、右下指令卡（3×4：技能的冷卻扇形、
// 自動施放、級數）、訊息與警示、血條與框選框。親自駕駛時（rts-pilot.js）只留資源列、小地圖、英雄頭像列與右上角的小字警示。
// DOM 在 index.html 的 #rtsHud（rtsHudInit 填內容）；樣式在 styles.css 的 RTS 區塊。指令卡與面板都是 button（手把規則）。
// 定義讀 data/rts-units.js（rtsUiDef）；核心、英雄（C 包）、中立（D 包）沒有提供的 API 一律以 typeof 判斷。
import { Game } from './game.js';
import { clamp } from '../core/math.js';
import { escHtml } from '../core/html.js';
import { SFX } from '../audio/audio.js';
import {
  CARD_KEYS,
  RTS_ABILS,
  RTS_DEFS,
  RTS_FACTIONS,
  RTS_NEUTRAL,
  RTS_POP_MAX,
  RTS_QUEUE_MAX,
  RTS_TEAM_COLORS,
  RTS_UPKEEP,
  rtsDef,
  upkeepOf,
} from '../data/rts-units.js';
import {
  RTS_ATK_NAME,
  RTS_ARM_NAME,
  RTS_ARMS,
  RTS_ATKS,
  RTS_RESEARCH,
  RTS_TYPE_K,
} from '../data/rts-combat.js';
import { RTS_HERO_XP, RTS_REVIVE, RTS_SKILLS, skillLvReq, skillMax } from '../data/rts-heroes.js';
import { RTS_ITEMS, RTS_SHOP, RTS_SHOP_CARD } from '../data/rts-items.js';

const RTS_ME = 0;
const KEYS = CARD_KEYS.flat();
const MINI_N = 160; // 小地圖底圖的解析度
const ALERT_GAP = 12; // 同一種警示的最短間隔（秒）
const PING_T = 3; // 小地圖的擴散圈（秒）
const DBL_MS = 350; // 頭像、F1～F3 連按兩下的間隔
const ORDER_NAME = {
  move: '移動',
  amove: '攻擊移動',
  attack: '攻擊',
  hold: '守住',
  stop: '停止',
  patrol: '巡邏',
  gather: '採集',
  build: '建造',
  repair: '修理',
  ability: '技能',
  pickup: '撿道具',
  shop: '前往商店',
};
const MINI_MODES = ['敵我', '隊伍', '地形'];
const NEU_ICON = { tavern: '酒', shop: '商', merc: '傭' };
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const pctTxt = (k) => Math.round(k * 100) + '%';

Object.assign(Game.prototype, {
  // ---------- 定義 ----------
  // 實體或定義 id → 定義（data/rts-units.js；核心提供 rtsDefGet 時用它）
  rtsUiDef(e) {
    const id = typeof e === 'string' ? e : e && (e.rtsDef || (e.bld && e.bld.def));
    if (!id) return null;
    return rtsDef(id);
  },
  rtsUiName(e) {
    if (typeof e === 'string' && RTS_RESEARCH[e]) return RTS_RESEARCH[e].name;
    const D = this.rtsUiDef(e);
    return (D && D.name) || (e && e.name) || '?';
  },

  // ---------- DOM ----------
  rtsHudInit() {
    const root = document.getElementById('rtsHud');
    if (!root || root.dataset.init) return;
    root.dataset.init = '1';
    root.innerHTML = `
      <div id="rtsTop">
        <button id="rtsMenuBtn" type="button" title="選單（Esc）">選單</button>
        <span id="rtsClock">0:00</span>
        <span id="rtsTier" title="科技層級（主堡的階）">T1</span>
        <span class="rtsGap"></span>
        <span class="rtsRes ore" title="礦石"><i></i><b id="rtsOre">0</b></span>
        <span class="rtsRes coral" title="Coral"><i></i><b id="rtsCoral">0</b></span>
        <span class="rtsRes pop" title="人口／上限"><i></i><b id="rtsPop">0/0</b></span>
        <span id="rtsUpkeep" title="維持費：人口越多，礦石收入越少">無維持費</span>
        <button id="rtsButlerBtn" type="button" title="自動管家（親自駕駛時一律啟動）">管家</button>
      </div>
      <div id="rtsButlerPanel" hidden></div>
      <div id="rtsHeroes"></div>
      <div id="rtsNote"></div>
      <div id="rtsMsg"></div>
      <div id="rtsModeHint"></div>
      <div id="rtsBottom">
        <div id="rtsMini"><canvas id="rtsMiniCv"></canvas>
          <div id="rtsMiniBtns">
            <button type="button" id="rtsIdleW" title="閒置工人（F8；Ctrl＋F8 或 Shift＋點＝全部）">工 0</button>
            <button type="button" id="rtsIdleA" title="閒置部隊（F9）">兵 0</button>
            <button type="button" id="rtsMiniMode" title="小地圖：敵我配色／隊伍色／只顯示地形">敵我</button>
          </div>
        </div>
        <div id="rtsPanel"></div>
        <div id="rtsCard"></div>
      </div>
      <div id="rtsTip"></div>`;
    const card = document.getElementById('rtsCard');
    for (let i = 0; i < 12; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rtsCmd empty';
      b.dataset.slot = i;
      b.innerHTML = `<i class="cdf"></i><b></b><em>${KEYS[i]}</em><small></small><u></u>`;
      b.onclick = (e) => this.rtsCardPress(i, e.shiftKey, true);
      b.addEventListener('pointerdown', (e) => {
        if (e.button === 2) {
          e.preventDefault();
          this.rtsCardAuto(i);
        }
      });
      b.onmouseenter = () => this.rtsTipShow(i);
      b.onmouseleave = () => this.rtsTipHide();
      card.appendChild(b);
    }
    document.getElementById('rtsMenuBtn').onclick = () => {
      if (this.rts && this.rts.pilot && this.state === 'play') {
        this.state = 'pause';
        this.showScreen('pause');
      } else if (typeof this.rtsPause === 'function') this.rtsPause();
    };
    document.getElementById('rtsButlerBtn').onclick = () => {
      const p = document.getElementById('rtsButlerPanel');
      p.hidden = !p.hidden;
      this.rtsButlerDraw(true);
    };
    document.getElementById('rtsIdleW').onclick = (e) =>
      this.rtsIdleSelect('worker', e.shiftKey || e.ctrlKey);
    document.getElementById('rtsIdleA').onclick = () => this.rtsIdleSelect('army', true);
    document.getElementById('rtsMiniMode').onclick = () => {
      const ui = this.rts && this.rts.ui;
      if (!ui) return;
      ui.miniMode = ((ui.miniMode || 0) + 1) % MINI_MODES.length;
      document.getElementById('rtsMiniMode').textContent = MINI_MODES[ui.miniMode];
      this.rtsMiniDraw();
    };
    // 小地圖：左鍵點／拖曳移動鏡頭，右鍵下指令（目標模式時當作目標點），Alt＋左鍵＝信號
    const cv = document.getElementById('rtsMiniCv');
    const at = (e) => {
      const r = cv.getBoundingClientRect();
      const S = this.world.size / 2;
      return {
        x: ((e.clientX - r.left) / r.width) * 2 * S - S,
        z: ((e.clientY - r.top) / r.height) * 2 * S - S,
      };
    };
    cv.addEventListener('pointerdown', (e) => {
      if (!this.rtsActive()) return;
      e.preventDefault();
      const p = at(e);
      const ui = this.rts.ui;
      if (e.button === 2) {
        if (ui.mode && ui.mode.k === 'build') return this.rtsCancelMode();
        if (ui.mode) return this.rtsModeAt(p.x, p.z, null, e.shiftKey);
        return this.rtsRightAt(p.x, p.z, null, e.shiftKey);
      }
      if (e.button !== 0) return;
      if (e.altKey) return this.rtsSignal(p.x, p.z);
      if (ui.mode && ui.mode.k === 'target') return this.rtsModeAt(p.x, p.z, null, e.shiftKey);
      cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
      this.rtsMiniDrag = true;
      this.rtsCamJump(p.x, p.z);
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.rtsMiniDrag && this.rts) {
        const p = at(e);
        this.rtsCamJump(p.x, p.z);
      }
    });
    const up = () => (this.rtsMiniDrag = false);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  },
  rtsHudShow(on) {
    const root = document.getElementById('rtsHud');
    if (!root) return;
    if (on && !root.dataset.init) this.rtsHudInit();
    if (root.hidden === !on) return;
    root.hidden = !on;
    document.body.classList.toggle('rtsOn', !!on);
    if (!on) this.rtsTipHide();
  },
  rtsHudHide() {
    this.rtsHudShow(false);
    this.rtsMiniBase = null;
    const root = document.getElementById('rtsHud');
    if (root) root.classList.remove('pilot');
    document.body.classList.remove('rtsPilot');
    const bp = document.getElementById('rtsButlerPanel');
    if (bp) bp.hidden = true;
    const n = document.getElementById('rtsNote');
    if (n) n.innerHTML = '';
  },
  rtsMsg(txt, color = 0xffb020, dur = 1.6) {
    const m = document.getElementById('rtsMsg');
    if (!m) return this.flashMsg(txt, color, dur);
    m.textContent = txt;
    m.style.color = hex(color);
    m.classList.add('on');
    clearTimeout(this._rtsMt);
    this._rtsMt = setTimeout(() => m.classList.remove('on'), dur * 1000);
  },
  // 事件（空白鍵跳過去）：核心也可以呼叫（例如生產完成、英雄升級）；親自駕駛時改成右上角的小字＋音效＋小地圖的紅圈
  rtsEvent(x, z, txt, color = 0xffb020) {
    const R = this.rts;
    if (!R || !R.ui) return;
    R.ui.events.push({ x, z, t: R.t || 0, txt });
    if (R.ui.events.length > 16) R.ui.events.shift();
    if (!txt) return;
    if (R.pilot) {
      this.rtsHudPilotNote(txt, color, txt);
      this.rtsPing(x, z, '#ff6a5a');
    } else this.rtsMsg(txt, color, 2.2);
  },
  // 親自駕駛時的小字警示（右上角，4 秒，最多 4 行；key 相同的 ALERT_GAP 秒內不重複）
  rtsHudPilotNote(txt, color = 0xffb020, key = txt) {
    const R = this.rts;
    if (!R || !R.ui) return;
    const ui = R.ui;
    if (!ui.noteT) ui.noteT = {};
    const t = R.t || 0;
    if (ui.noteT[key] !== undefined && t - ui.noteT[key] < 3) return;
    ui.noteT[key] = t;
    const box = document.getElementById('rtsNote');
    if (!box) return;
    const d = document.createElement('div');
    d.textContent = txt;
    d.style.color = hex(color);
    box.appendChild(d);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => d.remove(), 4000);
    try {
      SFX.radio();
    } catch (err) {
      void err;
    }
  },
  // 小地圖的擴散圈（警示、信號）
  rtsPing(x, z, col = '#ff503c') {
    const ui = this.rts && this.rts.ui;
    if (!ui) return;
    if (!ui.pings) ui.pings = [];
    ui.pings.push({ x, z, t: 0, col });
    if (ui.pings.length > 8) ui.pings.shift();
    ui.ping = ui.pings[ui.pings.length - 1];
  },
  // Alt＋點小地圖：信號（小地圖與地面的擴散圈＋音效）
  rtsSignal(x, z) {
    this.rtsPing(x, z, '#5cf0ff');
    if (this.rtsMark) this.rtsMark(x, z, 'signal');
    try {
      SFX.alert();
    } catch (err) {
      void err;
    }
    this.rtsMiniDraw();
  },

  // ---------- 每格 ----------
  rtsHudTick(dt) {
    const R = this.rts;
    if (!R || !R.ui) return;
    if (this._rtsHudAt === this.lastT) return; // 同一格只跑一次（核心另外呼叫時）
    this._rtsHudAt = this.lastT;
    const pilot = !!R.pilot;
    this.rtsHudShow(
      this.state === 'rts' || (this.state === 'pause' && !!this.rts) || (pilot && this.state === 'play'),
    );
    // 清掉死掉的選取與編隊
    if (R.sel.some((e) => e.dead)) {
      R.sel = R.sel.filter((e) => !e.dead);
      this.rtsHudDirty = true;
    }
    // 敵人走進迷霧：取消選取
    if (R.sel.length === 1 && !this.rtsSeen(R.sel[0])) {
      R.sel = [];
      this.rtsHudDirty = true;
    }
    if (!pilot) this.rtsDrawOverlay(); // 親自駕駛時 HUD 畫布是動作 HUD（drawHud）
    this._rtsT = (this._rtsT || 0) + dt;
    this._rtsMiniT = (this._rtsMiniT || 0) + dt;
    if (this._rtsMiniT > 0.2 || !this._rtsMiniImg) {
      this._rtsMiniT = 0;
      this.rtsMiniDraw();
    } else this.rtsMiniCam();
    if (this._rtsT > 0.1 || this.rtsHudDirty) {
      this._rtsT = 0;
      this.rtsHudDirty = false;
      this.rtsResDraw();
      this.rtsHeroesDraw();
      this.rtsIdleDraw();
      if (!pilot) {
        this.rtsCardDraw();
        this.rtsPanelDraw();
      }
      this.rtsButlerDraw();
      this.rtsAlertScan();
      const hint = document.getElementById('rtsModeHint');
      const m = R.ui.mode;
      const txt =
        m && !pilot
          ? m.k === 'build'
            ? '放置 ' +
              this.rtsUiName(m.def) +
              '：左鍵放置、Shift 連續放' +
              (m.D && m.D.wall ? '（Shift＋拖曳蓋一排）' : '') +
              '、右鍵或 Esc 取消'
            : m.label + '：左鍵選擇目標、右鍵或 Esc 取消'
          : '';
      if (hint.textContent !== txt) {
        hint.textContent = txt;
        hint.classList.toggle('on', !!txt);
      }
    }
  },

  // ---------- 資源列 ----------
  rtsResDraw() {
    const R = this.rts;
    const T = R.teams && R.teams[RTS_ME];
    if (!T) return;
    const set = (id, v) => {
      const el = document.getElementById(id);
      if (el && el.textContent !== v) el.textContent = v;
    };
    set('rtsOre', String(Math.floor(T.ore || 0)));
    set('rtsCoral', String(Math.floor(T.coral || 0)));
    set('rtsPop', (T.pop || 0) + '/' + (T.cap || 0));
    const tier = typeof this.rtsTier === 'function' ? this.rtsTier(RTS_ME) : (T.tech && T.tech.tier) || 1;
    set('rtsTier', 'T' + tier);
    // 維持費：進入下一級前 6 人口時變黃
    const pop = T.pop || 0;
    const u = upkeepOf(pop);
    const next = RTS_UPKEEP[u.lv];
    const near = u.lv < RTS_UPKEEP.length - 1 && next && pop > next.max - 6;
    const cls = (['', 'lo', 'hi'][u.lv] || 'hi') + (near ? ' near' : '');
    const el = document.getElementById('rtsUpkeep');
    if (el.textContent !== u.name || el.className !== cls) {
      el.textContent = u.name;
      el.className = cls;
      el.title =
        `維持費：礦石收入 ${pctTxt(u.k)}（人口 ${u.lv ? RTS_UPKEEP[u.lv - 1].max + 1 : 0}～${u.max}）` +
        (near ? `；再 ${next.max - pop + 1} 人口進入下一級` : '');
    }
    const s = Math.floor(R.t || 0);
    set('rtsClock', Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
    const bb = document.getElementById('rtsButlerBtn');
    if (bb) bb.classList.toggle('on', !!(R.butler && (R.butler.on || R.pilot)));
  },
  // 管家的設定面板（資源列的「管家」按鈕）
  rtsButlerDraw(force) {
    const R = this.rts,
      B = R && R.butler;
    const p = document.getElementById('rtsButlerPanel');
    if (!p || !B || (p.hidden && !force)) return;
    const keys = ['gather', 'loop', 'depot', 'defend', 'follow'];
    const sig = [B.on, !!R.pilot, ...keys.map((k) => B[k])].join();
    if (!force && sig === this._rtsButSig) return;
    this._rtsButSig = sig;
    const row = (k, name, on) =>
      `<button type="button" class="rtsTg${on ? ' on' : ''}" data-k="${k}">${on ? '■' : '□'} ${escHtml(name)}</button>`;
    p.innerHTML =
      `<b>自動管家</b>` +
      row('on', R.pilot ? '指揮時也啟用（親自駕駛中一律啟動）' : '指揮時啟用', !!B.on) +
      keys.map((k) => row(k, this.rtsButlerName ? this.rtsButlerName(k) : k, !!B[k])).join('') +
      `<small>循環生產另外在每棟建築的指令卡 X 開關</small>` +
      `<button type="button" class="rtsTgClose">關閉</button>`;
    for (const b of p.querySelectorAll('.rtsTg'))
      b.onclick = () => {
        if (this.rtsButlerSet) this.rtsButlerSet(b.dataset.k);
        else B[b.dataset.k] = !B[b.dataset.k];
        this.rtsButlerDraw(true);
      };
    p.querySelector('.rtsTgClose').onclick = () => (p.hidden = true);
  },

  // ---------- 英雄頭像列 ----------
  rtsHudHeroRecs() {
    const T = this.rts && this.rts.teams[RTS_ME];
    return ((T && T.heroes) || []).filter(Boolean).slice(0, 3);
  },
  // 復活中的剩餘秒數（主堡佇列的 revive 項目）；沒有在復活＝-1
  rtsHudReviveLeft(rec) {
    const R = this.rts;
    for (const b of R.units) {
      if (b.dead || !b.bld || b.rtsTeam !== RTS_ME) continue;
      const i = b.bld.queue.findIndex((q) => q.revive && q.id === rec.def);
      if (i < 0) continue;
      const q = b.bld.queue[i];
      const tm = q.time !== undefined ? q.time : (RTS_DEFS[q.id] || {}).time || 0;
      let left = tm - (q.t || 0);
      for (let j = 0; j < i; j++) {
        const p = b.bld.queue[j];
        left += (p.time !== undefined ? p.time : (RTS_DEFS[p.id] || {}).time || 0) - (p.t || 0);
      }
      return Math.max(0, left);
    }
    return -1;
  },
  rtsHeroesDraw() {
    const box = document.getElementById('rtsHeroes');
    if (!box) return;
    const R = this.rts;
    const recs = this.rtsHudHeroRecs();
    const t = R.t || 0;
    const items = recs.map((rec, i) => {
      const e = rec.ent;
      const D = RTS_DEFS[rec.def] || {};
      const dead = !e || e.dead || rec.st === 'dead' || rec.st === 'revive';
      const lv = rec.lv || 1;
      const x0 = RTS_HERO_XP[lv - 1] || 0,
        x1 = RTS_HERO_XP[lv];
      const xp = x1 ? clamp(((rec.xp || 0) - x0) / (x1 - x0), 0, 1) : 1;
      const hp = dead ? 0 : clamp(e.hp / e.maxHp, 0, 1);
      // 被攻擊時閃紅
      if (!dead) {
        if (rec._hudHp !== undefined && e.hp < rec._hudHp - 0.5) rec._hudHitT = t;
        rec._hudHp = e.hp;
      } else rec._hudHp = undefined;
      const hit = rec._hudHitT !== undefined && t - rec._hudHitT < 0.6;
      const rv = dead ? this.rtsHudReviveLeft(rec) : -1;
      const sub = dead ? (rv >= 0 ? '復活 ' + Math.ceil(rv) + 's' : '陣亡') : '';
      const piloted = !!(R.pilot && R.pilot.e === e);
      return { rec, i, D, dead, lv, xp, hp, hit, sub, piloted, low: !dead && hp < 0.15, pts: rec.pts || 0 };
    });
    const sig = items
      .map(
        (h) =>
          `${h.rec.def}|${h.lv}|${Math.round(h.xp * 40)}|${Math.round(h.hp * 40)}|${h.dead}|${h.sub}|${h.pts}|${h.hit}|${h.piloted}|${h.low}`,
      )
      .join(',');
    if (sig === this._rtsHeroSig) return;
    this._rtsHeroSig = sig;
    box.innerHTML = items
      .map(
        (h) =>
          `<button type="button" class="rtsHero${h.dead ? ' dead' : ''}${h.hit ? ' hit' : ''}${h.low ? ' low' : ''}${h.piloted ? ' piloted' : ''}" data-i="${h.i}" title="${escHtml((h.D.name || '') + (h.D.role ? '（' + h.D.role + '）' : ''))}　F${h.i + 1}">` +
          `<em>F${h.i + 1}</em><b>${escHtml(this.rtsAbbr(h.D.name || '?', 8))}</b><span class="lv">Lv${h.lv}</span>` +
          (h.pts ? '<span class="pts">＋</span>' : '') +
          `<i class="hp" style="width:${h.hp * 100}%"></i><i class="xp" style="width:${h.xp * 100}%"></i>` +
          (h.sub ? `<small>${escHtml(h.sub)}</small>` : '') +
          `</button>`,
      )
      .join('');
    for (const b of box.querySelectorAll('.rtsHero')) {
      const i = +b.dataset.i;
      b.onclick = () => this.rtsHudHeroKey(i);
      b.addEventListener('dragover', (ev) => ev.preventDefault());
      b.addEventListener('drop', (ev) => {
        ev.preventDefault();
        this.rtsHudItemDrop(i);
      });
    }
  },
  // F1～F3、點頭像：選取（連按兩下鏡頭跳過去）；親自駕駛中＝換開另一位英雄
  rtsHudHeroKey(i) {
    const R = this.rts;
    if (!R) return false;
    if (R.pilot) return this.rtsPilotSwitch ? this.rtsPilotSwitch(i) : false;
    const rec = this.rtsHudHeroRecs()[i];
    if (!rec) return false;
    const e = rec.ent;
    if (!e || e.dead) {
      const rv = this.rtsHudReviveLeft(rec);
      this.rtsMsg(
        (RTS_DEFS[rec.def] || {}).name +
          (rv >= 0 ? ` 復活中（${Math.ceil(rv)} 秒）` : ' 已陣亡 — 在主堡復活'),
        0xff8a8a,
      );
      return true;
    }
    const now = performance.now();
    const dbl = this._rtsHeroK && this._rtsHeroK.i === i && now - this._rtsHeroK.t < DBL_MS;
    this._rtsHeroK = { i, t: now };
    this.rtsSetSel([e]);
    if (dbl) this.rtsCamJump(e.pos.x, e.pos.z);
    return true;
  },

  // ---------- 閒置工人／部隊 ----------
  rtsIdleList(kind) {
    const R = this.rts;
    return R.units.filter((e) => {
      if (e.dead || e.bld || e.rtsTeam !== RTS_ME || e.rtsPiloted || e.hero) return false;
      const D = RTS_DEFS[e.rtsDef] || {};
      if (kind === 'worker') return !!D.worker && !e.rtsMilFrom && !e.orders.length;
      return !D.worker && D.kind === 'unit' && !e.orders.length;
    });
  },
  rtsIdleDraw() {
    const w = this.rtsIdleList('worker').length,
      a = this.rtsIdleList('army').length;
    const bw = document.getElementById('rtsIdleW'),
      ba = document.getElementById('rtsIdleA');
    if (!bw) return;
    const tw = '工 ' + w,
      ta = '兵 ' + a;
    if (bw.textContent !== tw) bw.textContent = tw;
    if (ba.textContent !== ta) ba.textContent = ta;
    bw.classList.toggle('on', w > 0);
    ba.classList.toggle('on', a > 0);
  },
  // F8：依序選一個閒置工人並把鏡頭移過去（all＝全部選取）；F9：全部的閒置部隊
  rtsIdleSelect(kind, all) {
    const R = this.rts;
    if (!R || !R.ui) return 0;
    const L = this.rtsIdleList(kind);
    if (!L.length) {
      this.rtsMsg(kind === 'worker' ? '沒有閒置的工人' : '沒有閒置的部隊', 0xbfd0e0, 1.2);
      return 0;
    }
    if (all) {
      this.rtsSetSel(L);
      if (kind === 'army') {
        let cx = 0,
          cz = 0;
        for (const u of L) ((cx += u.pos.x), (cz += u.pos.z));
        this.rtsCamJump(cx / L.length, cz / L.length);
      }
      return L.length;
    }
    const ui = R.ui;
    ui.idleI = ((ui.idleI === undefined ? -1 : ui.idleI) + 1) % L.length;
    const e = L[ui.idleI];
    this.rtsSetSel([e]);
    this.rtsCamJump(e.pos.x, e.pos.z);
    return 1;
  },

  // ---------- 指令卡 ----------
  // 目前選取的指令卡：12 格，每格 null 或 { c（定義的卡片）, cmd, label, key, alt, tip, cost, time, pop, dis（不能用的原因）,
  //   ab（技能：{ cd 剩餘秒, cdMax, auto, autoable, lv, max }）, on（開關中）, act(shift) }
  // 卡片定義在 data/rts-units.js（英雄在 data/rts-heroes.js）的 card／menus
  rtsCardItems() {
    const R = this.rts,
      ui = R.ui;
    const cells = new Array(12).fill(null);
    const G = this.rtsActiveGroup().filter((e) => this.rtsOwn(e));
    const put = (slot, it) => {
      if (slot >= 0 && slot < 12 && !cells[slot]) cells[slot] = it;
    };
    if (ui.mode)
      put(11, {
        cmd: 'cancelmode',
        label: '取消',
        key: 'V',
        alt: 'Escape',
        tip: '取消（右鍵／Esc）',
        act: () => this.rtsCancelMode(),
      });
    if (!G.length) {
      // 中立建築（酒館、商店、傭兵營；D 包的卡片）：選中時也顯示（雇用、購買）
      const n = R.sel[0];
      if (n && n.rtsTeam === RTS_NEUTRAL && n.bld && (this.rtsUiDef(n) || {}).card)
        return this.rtsCardFill(cells, [n], put);
      return cells;
    }
    return this.rtsCardFill(cells, G, put);
  },
  rtsCardFill(cells, G, put) {
    const ui = this.rts.ui;
    const e = G[0],
      D = this.rtsUiDef(e) || {};
    let list = D.card && D.card.length ? D.card : D.shop ? RTS_SHOP_CARD : [];
    // 酒館：C 包的卡片（含陣亡英雄的立刻復活）
    if (
      typeof this.rtsHireIsTavern === 'function' &&
      typeof this.rtsHireCard === 'function' &&
      this.rtsHireIsTavern(e)
    )
      list = this.rtsHireCard(RTS_ME);
    if (ui.menu === 'shop' && e.hero) list = this.rtsHudShopCard(e);
    else if (ui.menu && D.menus && D.menus[ui.menu]) list = D.menus[ui.menu];
    else ui.menu = null;
    const building = !!(e.bld && e.bld.progress < 1 && e.rtsTeam === RTS_ME);
    if (building)
      list = [
        {
          at: [2, 3],
          key: 'V',
          alt: 'Escape',
          name: '取消建造',
          tip: '取消建造（退還資源）',
          act: { k: 'cancel' },
        },
      ];
    for (const c of list) {
      const it = this.rtsCardItem(c, G);
      if (it) put(c.at[0] * 4 + c.at[1], it);
    }
    return cells;
  },
  rtsCardItem(c, G) {
    const R = this.rts,
      T = R.teams[RTS_ME];
    const e = G[0];
    const a = c.act || {};
    const ref =
      a.k === 'train' || a.k === 'build' || a.k === 'hero'
        ? this.rtsUiDef(a.id) || {}
        : a.k === 'upgrade'
          ? this.rtsUiDef(a.to) || {}
          : null;
    const it = {
      c,
      cmd:
        a.k === 'order'
          ? a.o
          : a.k +
            (a.id ? ':' + a.id : a.menu ? ':' + a.menu : a.ab ? ':' + a.ab : a.item ? ':' + a.item : ''),
      label: c.name || (ref && ref.name) || a.k,
      key: c.key,
      alt: c.alt,
      tip: (ref && ref.desc) || c.tip || '',
      cost: ref && ref.cost,
      time: ref && ref.time,
      pop: ref && ref.pop,
      dis: ref && a.k !== 'hero' ? this.rtsWhyNot(ref, a.k === 'train') : '',
      ref,
      act: (shift) => this.rtsCardAct(c, G, shift),
    };
    if (a.k === 'cancel' && !(e.bld && e.bld.progress < 1) && !(e.bld && e.bld.queue && e.bld.queue.length))
      it.dis = '佇列是空的';
    if (a.k === 'upgrade' && !it.dis && e.bld && e.bld.queue.length) it.dis = '佇列要是空的才能升級';
    if (a.k === 'research' && this.rtsResearchInfo) {
      const inf = this.rtsResearchInfo(RTS_ME, a.id, e);
      if (inf) {
        it.cost = inf.next ? inf.next.cost : null;
        it.time = inf.next ? inf.next.time : 0;
        it.label = c.name + (inf.max > 1 ? ` ${Math.min(inf.lv + 1, inf.max)}` : '');
        it.lvTxt = inf.max > 1 ? `${inf.lv}／${inf.max} 級` : inf.lv ? '已完成' : '';
        it.dis = inf.why;
        if (RTS_RESEARCH[a.id] && RTS_RESEARCH[a.id].desc) it.tip = RTS_RESEARCH[a.id].desc;
      }
    }
    switch (a.k) {
      case 'ability':
        this.rtsCardAbility(it, a, G);
        break;
      case 'learn':
        this.rtsCardLearn(it, a, e);
        break;
      case 'pilot': {
        const ok = this.rtsPilotCan ? this.rtsPilotCan(e) : '';
        it.dis = ok === 'ok' ? '' : ok || '不能親自駕駛';
        break;
      }
      case 'shop': {
        const s = this.rtsHudNearShop(e);
        it.dis = s ? '' : '附近沒有商店（12 m 內）';
        break;
      }
      case 'buy':
        this.rtsCardBuy(it, a, e);
        break;
      case 'hire':
        this.rtsCardHire(it, a, e);
        break;
      case 'hero':
        this.rtsCardHero(it, a, e);
        break;
      case 'loop':
        it.on = G.some((b) => b.bld && b.bld.loop);
        it.label = c.name || '循環生產';
        it.lvTxt = it.on ? '開' : '關';
        if (!G.some((b) => b.bld && b.bld.lastId) && !it.on) it.tip = (c.tip || '') + '（先生產一次）';
        break;
    }
    if (c.req && !it.dis && this.rtsReqWhy && e.rtsTeam === RTS_ME && a.k !== 'buy')
      it.dis = this.rtsReqWhy(RTS_ME, c);
    void T;
    return it;
  },
  // 技能格：一般單位（RTS_ABILS，冷卻記在 e.rtsCd[ab]＝到期的局內時間）或英雄（RTS_SKILLS，rec.sk／rec.cd）
  rtsCardAbility(it, a, G) {
    const R = this.rts,
      T = R.teams[RTS_ME];
    const e = G[0];
    if (a.hero || e.hero) {
      const slot = a.slot !== undefined ? a.slot : ((RTS_DEFS[e.rtsDef] || {}).skills || []).indexOf(a.ab);
      const s = this.rtsHudSkillInfo(e, slot);
      if (!s) return;
      it.ab = { cd: s.cd, cdMax: s.cdMax, auto: s.auto, autoable: s.autoable, lv: s.lv, max: s.max };
      it.cost = s.coral ? { coral: s.coral } : null;
      it.dis = s.why;
      it.tip = s.S.desc + (s.S.range ? `（射程 ${s.S.range} m）` : '');
      it.lvTxt = `${s.lv}／${s.max} 級`;
      return;
    }
    const A = RTS_ABILS[a.ab];
    if (!A) return;
    const can = G.filter((u) => ((RTS_DEFS[u.rtsDef] || {}).abil || []).includes(a.ab));
    const L = can.length ? can : G;
    let cd = 1e9;
    for (const u of L) cd = Math.min(cd, u.rtsCd && u.rtsCd[a.ab] > R.t ? u.rtsCd[a.ab] - R.t : 0);
    if (cd === 1e9) cd = 0;
    it.ab = {
      cd,
      cdMax: A.cd || 1,
      auto: L.some((u) => u.rtsAuto && u.rtsAuto[a.ab]),
      autoable: !!A.auto,
    };
    it.cost = A.coral ? { coral: A.coral } : null;
    it.tip = A.desc + (A.range ? `（射程 ${A.range} m）` : '') + (A.auto ? '；右鍵切換自動施放' : '');
    if (!it.dis && A.coral && (T.coral || 0) < A.coral) it.dis = 'Coral 不足';
    if (!it.dis && cd > 0 && A.target !== 'self') it.dis = '冷卻中';
  },
  // 英雄的技能資訊：{ id, S, lv, max, coral, cd（剩餘秒）, cdMax, auto, autoable, why }
  rtsHudSkillInfo(e, slot) {
    const R = this.rts;
    const rec = e && e.hero;
    const D = RTS_DEFS[e && e.rtsDef] || {};
    const id = (D.skills || [])[slot];
    const S = id && RTS_SKILLS[id];
    if (!rec || !S) return null;
    const passive = S.kind === 'aura' || S.kind === 'passive';
    if (typeof this.rtsSkillInfo === 'function') {
      // C 包：{ id, lv, max, coral, cd, cdMax, passive, auto, canAuto, why }
      const I = this.rtsSkillInfo(e, slot);
      if (I) {
        let why = I.why || '';
        if (I.passive && I.lv) why = S.kind === 'aura' ? '光環：自動生效' : '被動：自動生效';
        else if (!I.lv) why = '尚未學習（D 學習技能）';
        return {
          id: I.id,
          S,
          lv: I.lv,
          max: I.max,
          coral: I.coral,
          cd: I.cd,
          cdMax: I.cdMax || 1,
          auto: !!I.auto,
          autoable: !!I.canAuto && !I.passive,
          why,
        };
      }
    }
    const lv = (rec.sk && rec.sk[slot]) || 0;
    const max = skillMax(slot);
    const L = S.lv[Math.max(0, Math.min(lv, S.lv.length) - 1)] || {};
    const coral =
      typeof this.rtsSkillCost === 'function'
        ? this.rtsSkillCost(e, id, lv)
        : lv
          ? L.coral || 0
          : (S.lv[0] || {}).coral || 0;
    const cd =
      typeof this.rtsSkillCdLeft === 'function'
        ? this.rtsSkillCdLeft(e, slot)
        : Math.max(0, ((rec.cd && rec.cd[slot]) || 0) - (R.t || 0));
    const cdMax = L.cd || (S.lv[0] || {}).cd || 1;
    let why = '';
    if (!lv) why = '尚未學習（D 學習技能）';
    else if (passive) why = S.kind === 'aura' ? '光環：自動生效' : '被動：自動生效';
    else if (cd > 0) why = '冷卻中';
    else if (coral && (R.teams[e.rtsTeam].coral || 0) < coral) why = 'Coral 不足';
    return {
      id,
      S,
      lv,
      max,
      coral,
      cd,
      cdMax,
      auto: !!((rec.auto && rec.auto[slot]) || (e.rtsAuto && e.rtsAuto[id])),
      autoable: !!S.auto && !passive,
      why,
    };
  },
  rtsHudSkillWhy(e, slot) {
    const s = this.rtsHudSkillInfo(e, slot);
    return s ? s.why : '沒有這個技能';
  },
  rtsCardLearn(it, a, e) {
    const rec = e.hero;
    if (!rec) return;
    const slot = a.slot;
    const cur = (rec.sk && rec.sk[slot]) || 0;
    const max = skillMax(slot);
    const need = skillLvReq(slot, cur + 1);
    it.lvTxt = `${cur}／${max} 級`;
    it.ab = { cd: 0, cdMax: 1, lv: cur, max };
    if (typeof this.rtsHeroLearnWhy === 'function') it.dis = this.rtsHeroLearnWhy(e, slot) || '';
    else if (cur >= max) it.dis = '已學滿';
    else if (!(rec.pts > 0)) it.dis = '沒有技能點';
    else if ((rec.lv || 1) < need) it.dis = `需要英雄 ${need} 級`;
  },
  // 英雄附近 12 m 的商店（己方的補給商店或中立商店）
  rtsHudNearShop(hero) {
    if (!hero) return null;
    if (typeof this.rtsBuyShopNear === 'function') return this.rtsBuyShopNear(hero);
    const R = this.rts;
    let best = null,
      bd = (RTS_SHOP.r || 12) + 0.01;
    for (const b of R.units) {
      if (b.dead || !b.bld) continue;
      const D = RTS_DEFS[b.rtsDef] || {};
      const shop = (D.shop && b.rtsTeam === hero.rtsTeam && b.bld.progress >= 1) || /shop/.test(b.rtsDef);
      if (!shop) continue;
      const d =
        Math.hypot(b.pos.x - hero.pos.x, b.pos.z - hero.pos.z) - Math.max(b.bld.w || 0, b.bld.d || 0) / 2;
      if (d < bd) ((bd = d), (best = b));
    }
    return best;
  },
  // 英雄的商店子選單（C 包的 rtsHeroShopCard 優先）；V 返回
  rtsHudShopCard(hero) {
    let list = typeof this.rtsHeroShopCard === 'function' ? this.rtsHeroShopCard(hero) : null;
    if (!list || !list.length) {
      const s = this.rtsHudNearShop(hero);
      const D = s ? RTS_DEFS[s.rtsDef] || {} : {};
      list = D.card && D.card.length ? D.card : RTS_SHOP_CARD;
    }
    list = list.filter((c) => !(c.at[0] === 2 && c.at[1] === 3));
    return [
      ...list,
      { at: [2, 3], key: 'V', alt: 'Escape', name: '返回', tip: '回上一層', act: { k: 'back' } },
    ];
  },
  // 買給誰、在哪買：選英雄（商店子選單）＝這位英雄＋附近的商店；選商店＝商店＋12 m 內最近的己方英雄
  rtsHudBuyCtx(e) {
    const R = this.rts;
    if (e && e.hero) return { hero: e, shop: this.rtsHudNearShop(e) };
    let hero = null,
      bd = (RTS_SHOP.r || 12) + Math.max((e && e.bld && e.bld.w) || 0, (e && e.bld && e.bld.d) || 0) / 2;
    for (const h of R.units) {
      if (h.dead || !h.hero || h.rtsTeam !== RTS_ME) continue;
      const d = Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z);
      if (d < bd) ((bd = d), (hero = h));
    }
    return { hero, shop: e };
  },
  rtsCardBuy(it, a, e) {
    const I = RTS_ITEMS[a.item];
    if (!I) return;
    const { hero, shop } = this.rtsHudBuyCtx(e);
    it.cost = I.cost;
    it.tip = I.desc;
    it.label = I.name;
    // 中立商店的庫存（D 包）
    if (shop && typeof this.rtsShopStock === 'function' && shop.rtsTeam !== RTS_ME) {
      const st = this.rtsShopStock(shop).find((q) => q.item === a.item);
      if (st) it.lvTxt = `庫存 ${st.n}／${st.max}`;
    }
    if (typeof this.rtsBuyWhy === 'function') it.dis = this.rtsBuyWhy(e, a.item, RTS_ME) || '';
    else {
      const own = shop && shop.rtsTeam === RTS_ME;
      const T = this.rts.teams[RTS_ME];
      if (!hero) it.dis = '附近沒有英雄';
      else if (!shop) it.dis = '附近沒有商店';
      else if (own && it.c.req && this.rtsReqWhy) it.dis = this.rtsReqWhy(RTS_ME, it.c);
      if (!it.dis && hero && (hero.hero.inv || []).filter(Boolean).length >= 6) it.dis = '背包已滿';
      if (!it.dis && (T.ore || 0) < (I.cost.ore || 0)) it.dis = '礦石不足';
      if (!it.dis && (T.coral || 0) < (I.cost.coral || 0)) it.dis = 'Coral 不足';
    }
  },
  rtsCardHire(it, a, e) {
    const rv = this.rtsHudReviveId(a);
    const id = a.hero || a.merc || rv;
    const D = RTS_DEFS[id] || {};
    it.label = it.c.name || D.name || id;
    it.tip = it.c.tip || D.desc || '';
    if (a.revive) {
      // 酒館的立刻復活（C 包）
      if (!rv) it.dis = '沒有陣亡的英雄';
      else if (typeof this.rtsHeroReviveAtWhy === 'function')
        it.dis = this.rtsHeroReviveAtWhy(RTS_ME, e, rv) || '';
      if (rv && typeof this.rtsHeroReviveCost === 'function') {
        const c = (this.rtsHeroReviveCost(RTS_ME, rv) || {}).cost;
        if (c) it.cost = { ore: Math.ceil((c.ore || 0) * RTS_REVIVE.tavernK) };
      }
    } else if (a.hero) {
      if (typeof this.rtsHireWhy === 'function') it.dis = this.rtsHireWhy(RTS_ME, e, a.hero) || '';
      it.cost = typeof this.rtsHireCost === 'function' ? this.rtsHireCost(RTS_ME, a.hero) : it.cost || null;
    } else {
      if (typeof this.rtsMercWhy === 'function') it.dis = this.rtsMercWhy(RTS_ME, e, a.merc) || '';
      it.cost = D.cost || null;
      if (typeof this.rtsMercStock === 'function') {
        const st = this.rtsMercStock(e).find((q) => q.item === a.merc);
        if (st) it.lvTxt = `剩 ${st.n}／${st.max}`;
      }
    }
  },
  // 酒館的復活卡（C 包的 rtsHireCard）：act.revive 是英雄 id
  rtsHudReviveId(a) {
    return typeof a.revive === 'string' ? a.revive : '';
  },
  // 主堡的英雄子選單：還沒有＝生產（費用依第幾位）、陣亡＝復活、在場上或復活中＝灰掉
  rtsCardHero(it, a, e) {
    const R = this.rts,
      T = R.teams[RTS_ME];
    const rec = (T.heroes || []).find((h) => h && h.def === a.id);
    const D = RTS_DEFS[a.id] || {};
    it.label = D.name || it.label;
    if (rec) {
      const alive = rec.ent && !rec.ent.dead && rec.st !== 'dead' && rec.st !== 'revive';
      if (alive) {
        it.dis = '已在場上';
        it.lvTxt = 'Lv' + (rec.lv || 1);
        return;
      }
      const rv = this.rtsHudReviveLeft(rec);
      const rc = typeof this.rtsHeroReviveCost === 'function' ? this.rtsHeroReviveCost(RTS_ME, a.id) : null;
      it.label = '復活 ' + (D.name || '');
      it.cost = (rc && rc.cost) || { ore: 155 };
      it.time = (rc && rc.time) || 15;
      it.pop = 0;
      it.revive = true;
      it.lvTxt = 'Lv' + (rec.lv || 1);
      if (rv >= 0) it.dis = '復活中';
      else if ((T.ore || 0) < (it.cost.ore || 0)) it.dis = '礦石不足';
      else if ((T.coral || 0) < (it.cost.coral || 0)) it.dis = 'Coral 不足';
      return;
    }
    it.cost = typeof this.rtsHeroPrice === 'function' ? this.rtsHeroPrice(RTS_ME, a.id) : D.cost;
    it.time = D.time;
    it.pop = D.pop;
    it.dis = this.rtsReqWhy ? this.rtsReqWhy(RTS_ME, D) : '';
    if (!it.dis) it.dis = this.rtsWhyNot({ cost: it.cost, pop: D.pop }, true);
    void e;
  },
  // 執行卡片
  rtsCardAct(c, G, shift) {
    const ui = this.rts.ui,
      a = c.act || {};
    const e = G[0];
    switch (a.k) {
      case 'order':
        if (a.target) return this.rtsSetMode({ k: 'target', order: a.o, target: a.target, label: c.name });
        return this.rtsInstant(a.o, shift);
      case 'train':
        return this.rtsTrain(G, a.id);
      case 'upgrade': {
        const b = G.find((x) => x.bld && (this.rtsUiDef(x) || {}).upTo === a.to);
        if (b && this.rtsUpgrade) this.rtsUpgrade(b, a.to);
        this.rtsHudDirty = true;
        return;
      }
      case 'research': {
        const b = G.find((x) => x.bld && !(x.bld.progress < 1));
        if (b && this.rtsResearch) this.rtsResearch(b, a.id);
        this.rtsHudDirty = true;
        return;
      }
      case 'militia':
      case 'demob': {
        const b = G.find((x) => x.bld && !(x.bld.progress < 1));
        if (b && a.k === 'militia' && this.rtsMilitia) this.rtsMilitia(b);
        else if (b && a.k === 'demob' && this.rtsDemob) this.rtsDemob(b);
        this.rtsHudDirty = true;
        return;
      }
      case 'ability':
        return this.rtsCardAbilityAct(a, G, shift);
      case 'learn':
        if (e && e.hero && typeof this.rtsHeroLearn === 'function') this.rtsHeroLearn(e, a.slot);
        this.rtsHudDirty = true;
        return;
      case 'pilot':
        if (e && this.rtsPilotEnter) this.rtsPilotEnter(e);
        return;
      case 'shop':
        ui.menu = 'shop';
        this.rtsHudDirty = true;
        return;
      case 'buy': {
        const { hero, shop } = this.rtsHudBuyCtx(e);
        if (typeof this.rtsBuyAct === 'function') this.rtsBuyAct(e, a.item);
        else if (hero && shop && typeof this.rtsBuy === 'function') this.rtsBuy(hero, shop, a.item);
        this.rtsHudDirty = true;
        return;
      }
      case 'hire': {
        const b = G.find((x) => x.bld) || e;
        const rv = this.rtsHudReviveId(a);
        if (a.revive && rv && typeof this.rtsHireAct === 'function')
          this.rtsHireAct(RTS_ME, b, { revive: rv });
        else if (a.hero && typeof this.rtsHire === 'function') this.rtsHire(RTS_ME, b, a.hero);
        else if (a.merc && typeof this.rtsMercHire === 'function') this.rtsMercHire(RTS_ME, b, a.merc);
        this.rtsHudDirty = true;
        return;
      }
      case 'hero': {
        const T = this.rts.teams[RTS_ME];
        const rec = (T.heroes || []).find((h) => h && h.def === a.id);
        const dead = !!(rec && (!rec.ent || rec.ent.dead || rec.st === 'dead'));
        const b = G.find((x) => x.bld && !(x.bld.progress < 1));
        if (b && typeof this.rtsQueue === 'function') this.rtsQueue(b, a.id, { revive: dead });
        this.rtsHudDirty = true;
        return;
      }
      case 'loop': {
        const on = !G.some((b) => b.bld && b.bld.loop);
        for (const b of G) if (b.bld) b.bld.loop = on;
        this.rtsMsg('循環生產：' + (on ? '開' : '關'), 0x7ee081, 1.2);
        this.rtsHudDirty = true;
        return;
      }
      case 'build':
        return this.rtsSetMode({ k: 'build', def: a.id, D: this.rtsUiDef(a.id) });
      case 'menu':
        ui.menu = a.menu;
        this.rtsHudDirty = true;
        return;
      case 'back':
        ui.menu = null;
        this.rtsHudDirty = true;
        return;
      case 'rally':
        return this.rtsSetMode({ k: 'target', order: 'rally', target: 'any', label: c.name });
      case 'cancel': {
        // 建造中＝取消建造；否則取消佇列的最後一項
        const b = G.find((x) => x.bld && (x.bld.progress < 1 || x.bld.queue.length));
        if (b && typeof this.rtsCancel === 'function')
          this.rtsCancel(b, b.bld.progress < 1 ? -1 : b.bld.queue.length - 1);
        this.rtsHudDirty = true;
        return;
      }
    }
  },
  // 技能：自己施放＝立刻下指令；地點／單位＝進入目標模式
  rtsCardAbilityAct(a, G, shift) {
    const units = G.filter((u) => this.rtsOwn(u) && !u.bld);
    if (!units.length) return;
    if (!a.target || a.target === 'self') {
      if (typeof this.rtsOrder === 'function') this.rtsOrder(units, { k: 'ability', ab: a.ab }, shift);
      this.rtsHudDirty = true;
      return;
    }
    const name = (RTS_SKILLS[a.ab] || RTS_ABILS[a.ab] || {}).name || '技能';
    this.rtsSetMode({ k: 'target', order: 'ability', ab: a.ab, target: a.target, label: name });
  },
  // 右鍵點技能格：切換自動施放（可以自動施放的技能才行；記在 e.rtsAuto[技能 id]）
  rtsCardAuto(slot) {
    if (!this.rtsActive()) return false;
    const it = this.rtsCardItems()[slot];
    if (!it || !it.ab || !it.ab.autoable) return false;
    const ab = it.c.act.ab;
    const G = this.rtsActiveGroup().filter((e) => this.rtsOwn(e));
    const on = !it.ab.auto;
    for (const u of G) {
      // 英雄：C 包的 rtsSkillAuto（rec.auto[slot]）
      const slot = u.hero ? ((RTS_DEFS[u.rtsDef] || {}).skills || []).indexOf(ab) : -1;
      if (slot >= 0 && typeof this.rtsSkillAuto === 'function') {
        this.rtsSkillAuto(u, slot, on);
        continue;
      }
      if (!u.rtsAuto) u.rtsAuto = {};
      u.rtsAuto[ab] = on;
    }
    this.rtsMsg(it.label + '：自動施放' + (on ? '開' : '關'), 0xffd070, 1.2);
    this.rtsHudDirty = true;
    return true;
  },
  // 不能生產／建造的原因（'' 表示可以）
  rtsWhyNot(D, unit) {
    const R = this.rts;
    const T = R.teams[RTS_ME];
    const why = this.rtsReqWhy ? this.rtsReqWhy(RTS_ME, D) : '';
    if (why) return why;
    if (D.cost) {
      if (D.cost.ore && (T.ore || 0) < D.cost.ore) return '礦石不足';
      if (D.cost.coral && (T.coral || 0) < D.cost.coral) return 'Coral 不足';
    }
    if (unit && D.pop && T.cap !== undefined && (T.pop || 0) + D.pop > T.cap) return '人口不足';
    return '';
  },
  rtsTrain(G, id) {
    // 交給佇列最短的建築
    let best = null;
    for (const b of G)
      if (b.bld && !(b.bld.progress < 1) && (!best || b.bld.queue.length < best.bld.queue.length)) best = b;
    if (!best) return;
    if (best.bld.queue.length >= RTS_QUEUE_MAX) return this.rtsMsg('生產佇列已滿', 0xff8a8a);
    if (typeof this.rtsQueue === 'function' && this.rtsQueue(best, id) !== false) best.bld.lastId = id;
    this.rtsHudDirty = true;
  },
  rtsInstant(o, shift) {
    const units = this.rtsActiveGroup().filter(
      (e) => this.rtsOwn(e) && (!e.bld || (this.rtsUiDef(e) || {}).range),
    );
    if (units.length && typeof this.rtsOrder === 'function') this.rtsOrder(units, { k: o }, shift);
  },
  // 按下第 slot 格（鍵盤或滑鼠）；回傳是否有作用
  rtsCardPress(slot, shift, click) {
    if (!this.rtsActive()) return false;
    const it = this.rtsCardItems()[slot];
    if (!it) return false;
    const b = document.querySelector(`#rtsCard .rtsCmd[data-slot="${slot}"]`);
    if (b && !click) {
      b.classList.add('press');
      setTimeout(() => b.classList.remove('press'), 120);
    }
    if (it.dis) {
      this.rtsMsg(it.dis, 0xff8a8a);
      return true;
    }
    it.act(shift);
    this.rtsHudDirty = true;
    return true;
  },
  // 鍵盤：字母（Q…）→ 卡片的 key，再找 alt
  rtsCardKey(L, shift) {
    const items = this.rtsCardItems();
    let i = items.findIndex((it) => it && it.key === L);
    if (i < 0) i = items.findIndex((it) => it && it.alt === L);
    return i >= 0 ? this.rtsCardPress(i, shift) : false;
  },
  rtsCardDraw() {
    const items = this.rtsCardItems();
    const sig = items
      .map((it) =>
        it
          ? it.cmd +
            '|' +
            it.label +
            '|' +
            (it.dis || '') +
            '|' +
            (it.ab ? Math.ceil(it.ab.cd * 4) + (it.ab.auto ? 'a' : '') + (it.ab.lv || 0) : '') +
            (it.on ? 'on' : '')
          : '-',
      )
      .join(',');
    const ui = this.rts.ui;
    const modeK = ui.mode ? ui.mode.order || ui.mode.def : '';
    if (sig + modeK === this._rtsCardSig) return;
    this._rtsCardSig = sig + modeK;
    this._rtsCardItems = items;
    const btns = document.querySelectorAll('#rtsCard .rtsCmd');
    items.forEach((it, i) => {
      const b = btns[i];
      b.classList.toggle('empty', !it);
      b.classList.toggle('dis', !!(it && it.dis && !(it.ab && it.ab.cd > 0 && it.dis === '冷卻中')));
      b.classList.toggle('cool', !!(it && it.ab && it.ab.cd > 0));
      b.classList.toggle('auto', !!(it && it.ab && it.ab.auto));
      b.classList.toggle(
        'on',
        !!(
          it &&
          ((ui.mode &&
            (ui.mode.order === it.cmd ||
              'build:' + ui.mode.def === it.cmd ||
              'ability:' + ui.mode.ab === it.cmd)) ||
            it.on)
        ),
      );
      b.disabled = !it;
      b.querySelector('b').textContent = it ? it.label : '';
      b.querySelector('em').textContent = it ? it.key || KEYS[i] : KEYS[i];
      const c = it && it.cost;
      b.querySelector('small').textContent = c
        ? [c.ore ? c.ore : '', c.coral ? '◆' + c.coral : ''].filter(Boolean).join(' ')
        : '';
      // 冷卻扇形（剩餘的比例）與秒數、技能的級數點
      const f = b.querySelector('.cdf');
      const ab = it && it.ab;
      if (ab && ab.cd > 0) {
        const k = clamp(ab.cd / (ab.cdMax || 1), 0, 1);
        f.style.background = `conic-gradient(rgba(0,0,0,0.66) ${Math.round(k * 360)}deg, transparent 0)`;
        f.textContent = ab.cd >= 1 ? String(Math.ceil(ab.cd)) : '';
      } else {
        f.style.background = '';
        f.textContent = '';
      }
      const u = b.querySelector('u');
      u.textContent =
        ab && ab.max ? '●'.repeat(ab.lv || 0) + '○'.repeat(Math.max(0, ab.max - (ab.lv || 0))) : '';
      b.title = '';
    });
    if (this._rtsTipSlot !== undefined) this.rtsTipShow(this._rtsTipSlot);
  },
  rtsTipShow(i) {
    this._rtsTipSlot = i;
    const it = (this._rtsCardItems || [])[i];
    const tip = document.getElementById('rtsTip');
    if (!it) return this.rtsTipHide();
    const c = it.cost || {};
    const cost = [
      c.ore ? '礦石 ' + c.ore : '',
      c.coral ? 'Coral ' + c.coral : '',
      it.time ? it.time + ' 秒' : '',
      it.pop ? '人口 ' + it.pop : '',
      it.ab && it.ab.cdMax > 1 ? '冷卻 ' + it.ab.cdMax + ' 秒' : '',
    ]
      .filter(Boolean)
      .join('　');
    const ref = it.ref;
    const type =
      ref && ref.atk && ref.kind === 'unit'
        ? `攻擊 ${RTS_ATK_NAME[ref.atk] || ref.atk}／護甲 ${RTS_ARM_NAME[ref.arm] || ref.arm || '—'} ${ref.armor || 0}`
        : ref && ref.kind === 'bld' && ref.armor !== undefined
          ? `護甲 ${RTS_ARM_NAME[ref.arm || 'fort']} ${ref.armor}`
          : '';
    const why = it.dis ? (/^需要/.test(it.dis) ? it.dis : it.dis) : '';
    tip.innerHTML =
      `<b>${escHtml(it.label)}</b> <kbd>${escHtml(it.key || KEYS[i])}</kbd>` +
      (it.alt && it.alt !== 'Escape' ? ` <kbd>${escHtml(it.alt)}</kbd>` : '') +
      (it.lvTxt ? ` <span class="lvt">${escHtml(it.lvTxt)}</span>` : '') +
      (cost ? `<div class="cost">${escHtml(cost)}</div>` : '') +
      (type ? `<div class="type">${escHtml(type)}</div>` : '') +
      (it.tip ? `<div>${escHtml(it.tip)}</div>` : '') +
      (it.ab && it.ab.autoable
        ? `<div class="auto">右鍵：自動施放（${it.ab.auto ? '開' : '關'}）</div>`
        : '') +
      (why ? `<div class="why">${escHtml(why)}</div>` : '');
    tip.classList.add('on');
  },
  rtsTipHide() {
    this._rtsTipSlot = undefined;
    const tip = document.getElementById('rtsTip');
    if (tip) tip.classList.remove('on');
  },

  // ---------- 選取面板 ----------
  // 攻擊／護甲類型的相剋說明（滑鼠停留）
  rtsTypeTip(atk, arm) {
    const out = [];
    if (atk && RTS_TYPE_K[atk]) {
      const row = RTS_TYPE_K[atk];
      const s = RTS_ARMS.filter((a) => row[a] !== 1).map((a) => `${RTS_ARM_NAME[a]} ${pctTxt(row[a])}`);
      out.push(`${RTS_ATK_NAME[atk]}：對 ${s.join('、') || '各種護甲 100%'}`);
    }
    if (arm) {
      const s = RTS_ATKS.filter((k) => RTS_TYPE_K[k][arm] !== 1).map(
        (k) => `${RTS_ATK_NAME[k]} ${pctTxt(RTS_TYPE_K[k][arm])}`,
      );
      out.push(`${RTS_ARM_NAME[arm]}：受到 ${s.join('、') || '各種攻擊 100%'}`);
    }
    return out.join('\n');
  },
  // 影響這個單位的研究（已研究的級數）：「實彈 2、裝甲 1」
  rtsResTxt(e) {
    const R = this.rts,
      T = R.teams[e.rtsTeam];
    const res = (T && T.tech && T.tech.res) || {};
    const D = RTS_DEFS[e.rtsDef] || {};
    const out = [];
    for (const id in res) {
      const n = res[id];
      const Rr = RTS_RESEARCH[id];
      if (!n || !Rr) continue;
      let hit = false;
      try {
        hit = Rr.mods ? !!Rr.mods(D, n) : false;
      } catch (err) {
        hit = false;
      }
      if (hit) out.push(Rr.name.slice(0, 2) + (Rr.lv && Rr.lv.length > 1 ? ' ' + n : ''));
    }
    return out.join('、');
  },
  rtsQName(it) {
    if (it.res || RTS_RESEARCH[it.id]) {
      const Rr = RTS_RESEARCH[it.id];
      return (Rr ? Rr.name : it.id) + (Rr && Rr.lv && Rr.lv.length > 1 && it.lv ? ' ' + it.lv + ' 級' : '');
    }
    return (it.revive ? '復活 ' : '') + this.rtsUiName(it.id);
  },
  rtsPanelDraw() {
    const R = this.rts,
      ui = R.ui;
    const el = document.getElementById('rtsPanel');
    const sel = R.sel.filter((e) => !e.dead);
    let sig, html;
    if (!sel.length && ui.focus) {
      const m = ui.focus;
      const coral = (R.corals || []).includes(m);
      sig = 'f' + (m.id || '') + '|' + Math.floor(m.amount || 0);
      html = `<div class="rtsOne"><div class="rtsPic ${coral ? 'coral' : 'ore'}">${coral ? 'C' : '礦'}</div><div class="rtsInfo"><b>${coral ? 'Coral 湧出點' : '礦脈'}</b><div>剩餘 ${Math.floor(m.amount || 0)}</div>${m.ext ? '<div>已有抽取站</div>' : ''}</div></div>`;
    } else if (!sel.length) {
      sig = 'none';
      html = '<div class="rtsEmpty">左鍵點選或拖曳框選單位</div>';
    } else if (sel.length === 1) {
      const e = sel[0];
      const D = this.rtsUiDef(e) || {};
      const own = this.rtsOwn(e);
      const hp = Math.max(0, Math.ceil(e.hp));
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      const rows = [];
      const rec = e.hero || null;
      if (rec)
        rows.push(
          `Lv ${rec.lv || 1}　經驗 ${Math.floor(rec.xp || 0)}${RTS_HERO_XP[rec.lv || 1] ? '／' + RTS_HERO_XP[rec.lv || 1] : ''}` +
            (rec.pts ? `　技能點 ${rec.pts}` : ''),
        );
      if (D.dps)
        rows.push(
          '火力 每秒 ' + D.dps + (D.range ? '、射程 ' + (D.range + (e.rtsRangeAdd || 0)) + ' m' : ''),
        );
      else if (!e.bld && !D.worker) {
        const ws = Object.values(e.weapons || {})
          .map((w) => w && w.def && w.def.name)
          .filter((n) => n && n[0] !== '(');
        if (ws.length) rows.push('武器 ' + ws.slice(0, 2).join('、'));
      }
      if (e.bld) {
        if (D.popCap) rows.push('人口上限 +' + D.popCap);
        if (D.coralRate) rows.push('Coral 每秒 +' + D.coralRate);
      }
      // 攻擊類型／護甲類型 護甲值（滑鼠停留說明相剋）
      const atk = D.atk || (D.dps || D.range ? 'kin' : null);
      const arm = e.rtsArm || D.arm;
      const armor = Math.round((e.rtsArmor !== undefined ? e.rtsArmor : D.armor || 0) * 10) / 10;
      let typeRow = '';
      if (arm)
        typeRow = `<div class="rtsType" title="${escHtml(this.rtsTypeTip(atk, arm))}">${atk ? '攻擊 ' + escHtml(RTS_ATK_NAME[atk] || atk) + '／' : ''}護甲 ${escHtml(RTS_ARM_NAME[arm] || arm)} ${armor}</div>`;
      const rt = this.rtsResTxt(e);
      if (rt && !e.bld) rows.push('研究 ' + rt);
      if (e.carry && e.carry.n)
        rows.push('攜帶 ' + (e.carry.kind === 'coral' ? 'Coral ' : '礦石 ') + e.carry.n);
      const ord = e.orders && e.orders[0];
      if (own && ord) rows.push('指令：' + (ORDER_NAME[ord.k] || ord.k));
      if (e.rtsPiloted) rows.push('親自駕駛中');
      let q = '';
      if (e.bld && e.bld.progress < 1) {
        q = `<div class="rtsProg"><label>建造中 ${Math.floor(e.bld.progress * 100)}%</label><i style="width:${Math.round(e.bld.progress * 100)}%"></i></div>`;
      } else if (own && e.bld && e.bld.queue && e.bld.queue.length) {
        const first = e.bld.queue[0];
        const U = this.rtsUiDef(first.id) || {};
        const p = this.rtsQueueProg(first, U);
        const lab = (first.upg ? '升級：' : first.res ? '研究：' : '') + this.rtsQName(first);
        q =
          `<div class="rtsQueue">` +
          e.bld.queue
            .map(
              (it, i) =>
                `<button type="button" class="rtsQ" data-q="${i}" title="取消：${escHtml(this.rtsQName(it))}">${escHtml(this.rtsAbbr(this.rtsQName(it)))}</button>`,
            )
            .join('') +
          `</div><div class="rtsProg${first.upg || first.res ? ' tech' : ''}"><label>${escHtml(lab)} ${Math.floor(p * 100)}%</label><i style="width:${Math.round(p * 100)}%"></i></div>`;
      }
      // 英雄：技能列（4 格，級數點）與背包 2×3
      let hx = '';
      if (rec) {
        const sk = [0, 1, 2, 3]
          .map((s) => {
            const inf = this.rtsHudSkillInfo(e, s);
            if (!inf) return '';
            const dots = '●'.repeat(inf.lv) + '○'.repeat(Math.max(0, inf.max - inf.lv));
            const cdk = inf.cd > 0 ? clamp(inf.cd / inf.cdMax, 0, 1) : 0;
            return `<span class="rtsSk${inf.lv ? '' : ' off'}" title="${escHtml(inf.S.name + '：' + inf.S.desc)}" style="${cdk ? `background:conic-gradient(rgba(0,0,0,.6) ${Math.round(cdk * 360)}deg,transparent 0)` : ''}">${escHtml(this.rtsAbbr(inf.S.name, 2))}<u>${dots}</u></span>`;
          })
          .join('');
        const inv = rec.inv || [];
        const cells = [];
        for (let s = 0; s < 6; s++) {
          const it = inv[s];
          const id = it && (typeof it === 'string' ? it : it.id || it.item);
          const I = id && RTS_ITEMS[id];
          const ch =
            it && typeof it === 'object' && I && I.charges ? (it.ch !== undefined ? it.ch : it.charges) : '';
          const icd = it && typeof it === 'object' && it.cd > (R.t || 0) ? it.cd - R.t : 0;
          cells.push(
            I
              ? `<button type="button" class="rtsInv" draggable="${own}" data-s="${s}" title="${escHtml(I.name + '：' + I.desc + '\n點＝使用（Alt＋' + (s + 1) + '）、右鍵＝丟下或賣出、拖曳到頭像＝交給別的英雄')}">${escHtml(I.short || I.name.slice(0, 1))}${ch !== '' ? `<sub>${ch}</sub>` : ''}${icd ? `<i class="icd">${Math.ceil(icd)}</i>` : ''}</button>`
              : `<span class="rtsInv empty"></span>`,
          );
        }
        hx = `<div class="rtsHeroX"><div class="rtsSks">${sk}</div><div class="rtsInvs">${cells.join('')}</div></div>`;
      }
      const invSig = rec
        ? (rec.inv || [])
            .map((x) =>
              x
                ? typeof x === 'string'
                  ? x
                  : (x.id || x.item) +
                    ':' +
                    (x.ch !== undefined ? x.ch : x.charges) +
                    ':' +
                    (x.cd > R.t ? Math.ceil(x.cd - R.t) : 0)
                : '-',
            )
            .join() +
          '|' +
          (rec.sk || []).join() +
          '|' +
          [0, 1, 2, 3].map((s) => Math.ceil((this.rtsHudSkillInfo(e, s) || { cd: 0 }).cd)).join()
        : '';
      sig = 's' + e.id + '|' + hp + '|' + rows.join() + '|' + q + '|' + typeRow + '|' + invSig;
      html =
        `<div class="rtsOne"><div class="rtsPic ${own ? 'own' : e.rtsTeam === RTS_NEUTRAL ? 'neu' : 'foe'}">${escHtml(this.rtsAbbr(this.rtsUiName(e)))}</div>` +
        `<div class="rtsInfo"><b>${escHtml(this.rtsUiName(e))}</b>` +
        `<div class="rtsHpBar"><i style="width:${pct * 100}%;background:${this.rtsHpCol(pct)}"></i><span>${hp} / ${Math.round(e.maxHp)}</span></div>` +
        typeRow +
        rows.map((r) => `<div>${escHtml(r)}</div>`).join('') +
        `</div>${hx}${q ? `<div class="rtsProd">${q}</div>` : ''}</div>`;
    } else {
      const act = this.rtsActiveGroup();
      sig = 'm' + sel.map((e) => e.id + ':' + Math.round((e.hp / e.maxHp) * 20)).join() + '|' + ui.sub;
      html =
        '<div class="rtsMulti">' +
        sel
          .map((e, i) => {
            const pct = clamp(e.hp / e.maxHp, 0, 1);
            return `<button type="button" class="rtsU${act.includes(e) ? ' act' : ''}${e.hero ? ' hero' : ''}" data-i="${i}" title="${escHtml(this.rtsUiName(e))}">${escHtml(this.rtsAbbr(this.rtsUiName(e)))}<i style="width:${pct * 100}%;background:${this.rtsHpCol(pct)}"></i></button>`;
          })
          .join('') +
        '</div>';
    }
    if (sig === this._rtsPanelSig) return;
    this._rtsPanelSig = sig;
    el.innerHTML = html;
    for (const b of el.querySelectorAll('.rtsU'))
      b.onclick = (ev) => {
        const e = sel[+b.dataset.i];
        if (!e) return;
        if (ev.shiftKey) this.rtsToggleSel(e);
        else if (ev.ctrlKey) this.rtsSetSel(sel.filter((u) => u.rtsDef === e.rtsDef));
        else this.rtsSetSel([e]);
      };
    for (const b of el.querySelectorAll('.rtsQ'))
      b.onclick = () => {
        if (typeof this.rtsCancel === 'function') this.rtsCancel(sel[0], +b.dataset.q);
        this.rtsHudDirty = true;
      };
    for (const b of el.querySelectorAll('.rtsInv:not(.empty)')) {
      const s = +b.dataset.s;
      b.onclick = () => this.rtsHudItemUse(sel[0], s);
      b.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 2) return;
        ev.preventDefault();
        this.rtsHudItemDropOrSell(sel[0], s);
      });
      b.addEventListener('dragstart', (ev) => {
        this._rtsDragItem = { e: sel[0], s };
        try {
          ev.dataTransfer.setData('text/plain', String(s));
        } catch (err) {
          void err;
        }
      });
      b.addEventListener('dragend', () => setTimeout(() => (this._rtsDragItem = null), 0));
    }
  },
  // 背包：使用（地點目標的道具進入目標模式）、丟下或賣出、交給別的英雄
  rtsHudItemUse(e, s) {
    if (!e || !e.hero || !this.rtsOwn(e)) return false;
    const it = (e.hero.inv || [])[s];
    const id = it && (typeof it === 'string' ? it : it.id || it.item);
    const I = id && RTS_ITEMS[id];
    if (!I) return false;
    if (I.kind === 'perm') return (this.rtsMsg(I.name + '：永久道具（自動生效）', 0xbfd0e0), false);
    const why = typeof this.rtsItemWhy === 'function' ? this.rtsItemWhy(e, s) : '';
    if (why) return (this.rtsMsg(why, 0xff8a8a), false);
    if (I.target === 'point' || I.target === 'unit') {
      this.rtsSetMode({ k: 'target', order: 'item', slot: s, hero: e, target: I.target, label: I.name });
      return true;
    }
    if (typeof this.rtsItemUse === 'function') this.rtsItemUse(e, s, null);
    this.rtsHudDirty = true;
    return true;
  },
  rtsHudItemDropOrSell(e, s) {
    if (!e || !e.hero || !this.rtsOwn(e)) return false;
    const shop = this.rtsHudNearShop(e);
    if (shop && typeof this.rtsItemSell === 'function') this.rtsItemSell(e, s, shop);
    else if (typeof this.rtsItemDrop === 'function') this.rtsItemDrop(e, s);
    this.rtsHudDirty = true;
    return true;
  },
  rtsHudItemDrop(i) {
    const d = this._rtsDragItem;
    this._rtsDragItem = null;
    if (!d || !d.e || !d.e.hero) return false;
    const rec = this.rtsHudHeroRecs()[i];
    const to = rec && rec.ent;
    if (!to || to === d.e || to.dead) return false;
    if (Math.hypot(to.pos.x - d.e.pos.x, to.pos.z - d.e.pos.z) > 6)
      return (this.rtsMsg('要在 6 m 內才能交給別的英雄', 0xff8a8a), false);
    if (typeof this.rtsItemPass === 'function') this.rtsItemPass(d.e, d.s, to);
    this.rtsHudDirty = true;
    return true;
  },
  // 生產進度（0～1）：佇列項目的 t 是已經過的時間；有 p（進度）時直接用；研究、升級、復活用項目的 time
  rtsQueueProg(it, U) {
    if (it.p !== undefined) return clamp(it.p, 0, 1);
    const T = it.time || U.time || 1;
    return clamp((it.t || 0) / T, 0, 1);
  },
  rtsAbbr(name, n = 3) {
    const s = String(name || '?').replace(/^[A-Z0-9-]+\s+/, '');
    if (/^[A-Z0-9-]+$/.test(s)) return s.slice(0, Math.max(n, 4));
    return s.length > n ? s.slice(0, 2) : s;
  },
  rtsHpCol(p) {
    return p > 0.6 ? '#4cff7a' : p > 0.3 ? '#ffd23a' : '#ff4a3a';
  },

  // ---------- 警示 ----------
  // 同種 ALERT_GAP 秒內不重複；和最近 2 秒內同樣文字的事件（別包發的）也不重複
  rtsHudAlert(key, txt, x, z, color = 0xffb020, gap = ALERT_GAP) {
    const R = this.rts,
      ui = R.ui;
    const t = R.t || 0;
    if (!ui.alertT) ui.alertT = { bld: -99, unit: -99 };
    if (ui.alertT[key] !== undefined && t - ui.alertT[key] < gap) return false;
    ui.alertT[key] = t;
    if (ui.events.some((ev) => ev.txt === txt && t - ev.t < 2)) return false;
    this.rtsEvent(x, z, txt, color);
    return true;
  },
  rtsAlertScan() {
    const R = this.rts,
      ui = R.ui;
    const t = R.t || 0;
    if (!ui.alertT) ui.alertT = { bld: -99, unit: -99 };
    const s = {};
    for (const e of R.units || []) {
      if (!this.rtsOwn(e)) continue;
      const prev = e._rtsHp;
      e._rtsHp = e.hp;
      if (prev === undefined || e.hp >= prev - 0.5) continue;
      if (e.bld && e.bld.progress < 1 && e.hp > prev) continue;
      if (e.bld) e._bHurtT = t; // 自動管家的修理
      const k = e.bld ? 'bld' : 'unit';
      if (t - ui.alertT[k] < ALERT_GAP) continue;
      this.rtsScreen(e, s);
      const onScreen = !R.pilot && s.in && s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight;
      ui.alertT[k] = t;
      if (onScreen && k === 'unit') continue;
      this.rtsEvent(e.pos.x, e.pos.z, e.bld ? '基地遭受攻擊' : '部隊遭受攻擊', 0xff6a5a);
      this.rtsPing(e.pos.x, e.pos.z);
      if (R.pilot && e.bld)
        try {
          SFX.alert();
        } catch (err) {
          void err;
        }
    }
    const T = R.teams[RTS_ME];
    // 英雄升級、陣亡、復活完成
    for (const rec of this.rtsHudHeroRecs()) {
      const name = (RTS_DEFS[rec.def] || {}).name || '英雄';
      const e = rec.ent;
      const at = e ? e.pos : { x: R.cam ? R.cam.x : 0, z: R.cam ? R.cam.z : 0 };
      const alive = !!(e && !e.dead && rec.st !== 'dead' && rec.st !== 'revive');
      if (rec._hudLv !== undefined && (rec.lv || 1) > rec._hudLv)
        this.rtsHudAlert('lv' + rec.def, `英雄升級：${name} Lv${rec.lv}`, at.x, at.z, 0x7ee081, 1);
      rec._hudLv = rec.lv || 1;
      if (rec._hudAlive !== undefined && rec._hudAlive !== alive)
        this.rtsHudAlert(
          (alive ? 'rv' : 'dd') + rec.def,
          alive ? `英雄復活：${name}` : `英雄陣亡：${name}`,
          at.x,
          at.z,
          alive ? 0x7ee081 : 0xff6a5a,
          1,
        );
      rec._hudAlive = alive;
    }
    // 人口將滿：剩 4 以內、沒有補給庫在蓋
    if (T && (T.cap || 0) < RTS_POP_MAX && (T.cap || 0) - (T.pop || 0) <= 4 && (T.cap || 0) > 0) {
      const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
      const building = R.units.some(
        (b) =>
          !b.dead &&
          b.rtsTeam === RTS_ME &&
          ((b.bld && b.bld.progress < 1 && (RTS_DEFS[b.rtsDef] || {}).popCap) ||
            (!b.bld && b.orders && b.orders.some((o) => o.k === 'build' && (RTS_DEFS[o.def] || {}).popCap))),
      );
      const hq = R.units.find(
        (b) => !b.dead && b.bld && b.rtsTeam === RTS_ME && (RTS_DEFS[b.rtsDef] || {}).dropoff,
      );
      if (!building && hq) this.rtsHudAlert('pop', '人口將滿 — 蓋補給庫', hq.pos.x, hq.pos.z, 0xffd070, 30);
      void F;
    }
    // 維持費等級改變
    const u = upkeepOf((T && T.pop) || 0);
    if (ui._upk !== undefined && ui._upk !== u.lv) {
      const hq = R.units.find((b) => !b.dead && b.bld && b.rtsTeam === RTS_ME);
      this.rtsHudAlert(
        'upk',
        `維持費：${u.name}（礦石收入 ${pctTxt(u.k)}）`,
        hq ? hq.pos.x : 0,
        hq ? hq.pos.z : 0,
        0xffd070,
        3,
      );
    }
    ui._upk = u.lv;
    // 營地清除
    for (const c of R.camps || []) {
      if (c.cleared && !c._hudCl) {
        c._hudCl = true;
        if (c._hudSeen) this.rtsHudAlert('camp' + c.id, '營地清除', c.pos.x, c.pos.z, 0x7ee081, 1);
      }
      c._hudSeen = true;
    }
    // 第一次看到敵方英雄
    if (typeof this.rtsFogEnemies === 'function') {
      if (!ui.seenHero) ui.seenHero = new Set();
      for (const f of this.rtsFogEnemies(RTS_ME)) {
        if (!f.hero || f.dead || ui.seenHero.has(f.rtsDef + ':' + f.rtsTeam)) continue;
        ui.seenHero.add(f.rtsDef + ':' + f.rtsTeam);
        this.rtsHudAlert(
          'eh' + f.rtsDef,
          '發現敵方英雄：' + this.rtsUiName(f),
          f.pos.x,
          f.pos.z,
          0xff8a5a,
          1,
        );
      }
    }
  },

  // ---------- 畫面上的疊加：血條、框選框 ----------
  rtsDrawOverlay() {
    const c = this.hctx,
      R = this.rts,
      ui = R.ui;
    if (!c) return;
    c.clearRect(0, 0, innerWidth, innerHeight);
    const s = {};
    for (const e of R.units || []) {
      if (e.dead) continue;
      const sel = R.sel.includes(e);
      const hurt = e.hp < e.maxHp - 0.5;
      const bldUp = e.bld && e.bld.progress < 1;
      if (!sel && !hurt && !bldUp && !e.hero) continue;
      if (!this.rtsSeen(e)) continue;
      this.rtsScreen(e, s);
      if (!s.in || s.x < -40 || s.y < -40 || s.x > innerWidth + 40 || s.y > innerHeight + 40) continue;
      const ppm = this.rtsPxPerM(e.pos);
      const w = clamp(this.rtsRadius(e) * ppm * 1.6, 18, e.bld ? 110 : 54);
      const top = s.y - clamp((e.bld ? 2.5 : (e.height || 3) * 0.75) * ppm, 10, 120);
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.fillRect(s.x - w / 2 - 1, top - 1, w + 2, 5);
      c.fillStyle = this.rtsOwn(e) ? this.rtsHpCol(pct) : pct > 0.3 ? '#ff6a4a' : '#ff2a2a';
      c.fillRect(s.x - w / 2, top, w * pct, 3);
      if (bldUp) {
        c.fillStyle = 'rgba(0,0,0,0.65)';
        c.fillRect(s.x - w / 2 - 1, top + 5, w + 2, 4);
        c.fillStyle = '#5cc8ff';
        c.fillRect(s.x - w / 2, top + 6, w * clamp(e.bld.progress, 0, 1), 2);
      }
      if (e.hero) {
        // 英雄：名稱與等級
        c.font = 'bold 11px Chakra Petch, sans-serif';
        c.textAlign = 'center';
        c.fillStyle = this.rtsOwn(e) ? '#bff7c8' : '#ffb0a0';
        c.fillText(`${this.rtsUiName(e)} Lv${(e.hero && e.hero.lv) || 1}`, s.x, top - 4);
      }
    }
    const d = ui.drag;
    if (d && d.moved) {
      const x = Math.min(d.x0, d.x1),
        y = Math.min(d.y0, d.y1),
        w = Math.abs(d.x1 - d.x0),
        h = Math.abs(d.y1 - d.y0);
      c.fillStyle = 'rgba(76,255,122,0.08)';
      c.fillRect(x, y, w, h);
      c.strokeStyle = 'rgba(76,255,122,0.9)';
      c.lineWidth = 1;
      c.strokeRect(x + 0.5, y + 0.5, w, h);
    }
  },

  // ---------- 小地圖 ----------
  // 底圖：導航格的高度著色（主題的地面色，不能通行的地方變暗）
  rtsMiniBuild() {
    const w = this.world,
      nav = w.nav;
    const cv = document.createElement('canvas');
    cv.width = cv.height = MINI_N;
    const g = cv.getContext('2d');
    const img = g.createImageData(MINI_N, MINI_N);
    const S = w.size / 2;
    const base = new THREE.Color(w.theme && w.theme.ground !== undefined ? w.theme.ground : 0x8a6f52);
    let lo = 1e9,
      hi = -1e9;
    const hs = new Float32Array(MINI_N * MINI_N);
    for (let j = 0; j < MINI_N; j++)
      for (let i = 0; i < MINI_N; i++) {
        const x = -S + ((i + 0.5) / MINI_N) * 2 * S,
          z = -S + ((j + 0.5) / MINI_N) * 2 * S;
        const h = w.terrainHeight(x, z);
        hs[j * MINI_N + i] = h;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    const wl = w.theme && w.theme.water ? w.theme.water.level : null;
    for (let j = 0; j < MINI_N; j++)
      for (let i = 0; i < MINI_N; i++) {
        const x = -S + ((i + 0.5) / MINI_N) * 2 * S,
          z = -S + ((j + 0.5) / MINI_N) * 2 * S;
        const h = hs[j * MINI_N + i];
        const hk = hi > lo ? (h - lo) / (hi - lo) : 0.5;
        // 簡單的光影：和左上的高度差
        const hl = hs[Math.max(0, j - 1) * MINI_N + Math.max(0, i - 1)];
        let k = 0.55 + hk * 0.6 + clamp((h - hl) * 0.08, -0.25, 0.25);
        let r = base.r * k,
          gg = base.g * k,
          b = base.b * k;
        if (nav && !nav.walkableAt(x, z)) ((r *= 0.45), (gg *= 0.45), (b *= 0.45));
        if (wl !== null && h < wl) ((r = 0.12), (gg = 0.28), (b = 0.42));
        const o = (j * MINI_N + i) * 4;
        img.data[o] = clamp(r * 255, 0, 255);
        img.data[o + 1] = clamp(gg * 255, 0, 255);
        img.data[o + 2] = clamp(b * 255, 0, 255);
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return { cv, world: w };
  },
  rtsMiniDraw() {
    const cv = document.getElementById('rtsMiniCv');
    if (!cv || !this.world) return;
    const R = this.rts;
    const ui = R.ui;
    const dpr = devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    if (cv.width !== W) cv.width = cv.height = W;
    if (!this.rtsMiniBase || this.rtsMiniBase.world !== this.world) this.rtsMiniBase = this.rtsMiniBuild();
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.drawImage(this.rtsMiniBase.cv, 0, 0, W, W);
    const S = this.world.size / 2;
    const k = W / (2 * S);
    const X = (x) => (x + S) * k,
      Z = (z) => (z + S) * k;
    // 戰爭迷霧：0 未探索＝黑、1 探索過＝暗
    const FG = typeof this.rtsFogGrid === 'function' ? this.rtsFogGrid(RTS_ME) : null;
    if (FG && !FG.cheat) {
      // 迷霧格 → 小畫布（每格一個像素），格子涵蓋 −FG.S～−FG.S＋W×cell
      let fc = this._rtsFogCv;
      if (!fc || fc.width !== FG.W) {
        fc = this._rtsFogCv = document.createElement('canvas');
        fc.width = fc.height = FG.W;
        this._rtsFogImg = fc.getContext('2d').createImageData(FG.W, FG.W);
      }
      const im = this._rtsFogImg,
        D = im.data;
      for (let i = 0, n = FG.W * FG.W; i < n; i++) D[i * 4 + 3] = FG.vis[i] ? 0 : FG.exp[i] ? 115 : 235;
      fc.getContext('2d').putImageData(im, 0, 0);
      const span = FG.W * FG.cell;
      g.drawImage(fc, (-FG.S + S) * k, (-FG.S + S) * k, span * k, span * k);
    }
    const mode = (ui && ui.miniMode) || 0; // 0 敵我配色、1 隊伍色、2 只顯示地形
    const fog = typeof this.rtsFogState === 'function';
    const seenAt = (x, z) => !fog || this.rtsFogState(RTS_ME, x, z) > 0;
    for (const m of R.mines || []) {
      if (!m.pos || (m.amount !== undefined && m.amount <= 0) || !seenAt(m.pos.x, m.pos.z)) continue;
      g.fillStyle = '#ffd23a';
      g.fillRect(X(m.pos.x) - 2.5 * dpr, Z(m.pos.z) - 2.5 * dpr, 5 * dpr, 5 * dpr);
    }
    for (const m of R.corals || []) {
      if (!m.pos || !seenAt(m.pos.x, m.pos.z)) continue;
      g.fillStyle = '#3af0d8';
      g.beginPath();
      g.arc(X(m.pos.x), Z(m.pos.z), 2.8 * dpr, 0, Math.PI * 2);
      g.fill();
    }
    // 野怪營地（地圖公開的資訊）：黃色點、大小依 tier，清除後變灰
    for (const c of R.camps || []) {
      if (!c || !c.pos) continue;
      const r = (2 + (c.tier || 1) * 1.1) * dpr;
      g.fillStyle = c.cleared ? 'rgba(150,150,150,0.75)' : '#ffd23a';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = dpr;
      g.beginPath();
      g.arc(X(c.pos.x), Z(c.pos.z), r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    // 中立建築的圖示（酒館、商店、傭兵營）
    g.font = `bold ${Math.round(8 * dpr)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const n of R.neutrals || []) {
      const e = n && (n.ent || n);
      if (!e || !e.pos) continue;
      const kind = n.kind || String(e.rtsDef || '').replace(/^n_/, '');
      const s = 9 * dpr;
      g.fillStyle = 'rgba(30,26,8,0.85)';
      g.fillRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
      g.strokeStyle = '#ffd23a';
      g.lineWidth = dpr;
      g.strokeRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
      g.fillStyle = '#ffe680';
      g.fillText(NEU_ICON[kind] || '中', X(e.pos.x), Z(e.pos.z) + 0.5 * dpr);
    }
    if (mode !== 2) {
      const heroes = [];
      for (const e of R.units || []) {
        if (e.dead || !this.rtsSeen(e)) continue;
        if (e.rtsTeam === RTS_NEUTRAL && e.bld && (R.neutrals || []).some((n) => (n.ent || n) === e))
          continue;
        const own = e.rtsTeam === RTS_ME;
        const sel = R.sel.includes(e);
        const col =
          mode === 1
            ? hex(RTS_TEAM_COLORS[e.rtsTeam] !== undefined ? RTS_TEAM_COLORS[e.rtsTeam] : 0xffd23a)
            : own
              ? '#4cff7a'
              : e.rtsTeam === undefined || e.rtsTeam === RTS_NEUTRAL
                ? '#ffd23a'
                : '#ff4a3a';
        g.fillStyle = sel ? '#ffffff' : col;
        if (e.hero) {
          heroes.push([e, sel ? '#ffffff' : col]);
          continue;
        }
        if (e.bld) {
          const s = Math.max(3 * dpr, this.rtsRadius(e) * 1.4 * k);
          g.fillRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
        } else {
          const s = 2.2 * dpr;
          g.fillRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
        }
      }
      // 英雄：大一號的菱形（畫在最上面）
      for (const [e, col] of heroes) {
        const x = X(e.pos.x),
          z = Z(e.pos.z),
          r = 4.5 * dpr;
        g.fillStyle = col;
        g.strokeStyle = 'rgba(0,0,0,0.85)';
        g.lineWidth = dpr;
        g.beginPath();
        g.moveTo(x, z - r);
        g.lineTo(x + r, z);
        g.lineTo(x, z + r);
        g.lineTo(x - r, z);
        g.closePath();
        g.fill();
        g.stroke();
      }
    }
    // 警示與信號的擴散圈（3 秒）
    const pings = (ui && ui.pings) || [];
    for (let i = pings.length - 1; i >= 0; i--) {
      const p = pings[i];
      p.t += 0.2;
      if (p.t >= PING_T) {
        pings.splice(i, 1);
        continue;
      }
      const a = 1 - p.t / PING_T;
      g.strokeStyle = p.col;
      g.globalAlpha = a;
      g.lineWidth = 2 * dpr;
      for (const off of [0, 0.5]) {
        g.beginPath();
        g.arc(X(p.x), Z(p.z), (5 + ((p.t + off) % 1) * 12) * dpr, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    this._rtsMiniImg = g.getImageData(0, 0, W, W);
    this.rtsMiniCam(true);
  },
  // 鏡頭範圍的梯形（畫面四角投到地面）；每格只重畫這一層
  rtsMiniCam(fresh) {
    const cv = document.getElementById('rtsMiniCv');
    if (!cv || !this._rtsMiniImg || !this.world) return;
    const g = cv.getContext('2d');
    if (!fresh) g.putImageData(this._rtsMiniImg, 0, 0);
    const W = cv.width,
      S = this.world.size / 2,
      k = W / (2 * S);
    const C = this.rts.cam;
    if (this.rts.pilot) {
      // 親自駕駛：畫英雄的位置與面向
      const e = this.rts.pilot.e;
      const x = (e.pos.x + S) * k,
        z = (e.pos.z + S) * k;
      const dpr = devicePixelRatio || 1;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 1.5 * dpr;
      g.beginPath();
      g.arc(x, z, 7 * dpr, 0, Math.PI * 2);
      g.moveTo(x, z);
      g.lineTo(x - Math.sin(e.yaw) * 14 * dpr, z - Math.cos(e.yaw) * 14 * dpr);
      g.stroke();
      return;
    }
    const corners = [
      [0, 0],
      [innerWidth, 0],
      [innerWidth, innerHeight],
      [0, innerHeight],
    ];
    const v = new THREE.Vector3();
    const cam = this.camera;
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.5 * (devicePixelRatio || 1);
    g.beginPath();
    corners.forEach(([sx, sy], i) => {
      // 和注視點高度的水平面求交（快，而且不受遠方地形影響）
      v.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(cam);
      const d = v.sub(cam.position).normalize();
      let t = d.y < -1e-3 ? (C.gy - cam.position.y) / d.y : 4 * S;
      t = Math.min(t, 4 * S);
      const x = cam.position.x + d.x * t,
        z = cam.position.z + d.z * t;
      const px = (x + S) * k,
        pz = (z + S) * k;
      if (i === 0) g.moveTo(px, pz);
      else g.lineTo(px, pz);
    });
    g.closePath();
    g.stroke();
  },
});
