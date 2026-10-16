// Coral 戰爭（RTS）的 HUD（mixin）：上方資源列、左下小地圖、中下選取面板、右下指令卡（3×4）、訊息、血條與框選框。
// DOM 在 index.html 的 #rtsHud（rtsHudInit 填內容）；樣式在 styles.css 的 RTS 區塊。指令卡與面板都是 button（手把規則）。
// 定義讀 data/rts-units.js（rtsUiDef）；核心沒有提供的 API 一律以 typeof 判斷。
import { Game } from './game.js';
import { clamp } from '../core/math.js';
import { escHtml } from '../core/html.js';
import { CARD_KEYS, RTS_QUEUE_MAX, rtsDef, upkeepOf } from '../data/rts-units.js';

const RTS_ME = 0;
const KEYS = CARD_KEYS.flat();
const MINI_N = 160; // 小地圖底圖的解析度
const ALERT_GAP = 12; // 同一種警示的最短間隔（秒）
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
};

Object.assign(Game.prototype, {
  // ---------- 定義 ----------
  // 實體或定義 id → 定義（data/rts-units.js；核心提供 rtsDefGet 時用它）
  rtsUiDef(e) {
    const id = typeof e === 'string' ? e : e && (e.rtsDef || (e.bld && e.bld.def));
    if (!id) return null;
    return rtsDef(id);
  },
  rtsUiName(e) {
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
        <span class="rtsGap"></span>
        <span class="rtsRes ore" title="礦石"><i></i><b id="rtsOre">0</b></span>
        <span class="rtsRes coral" title="Coral"><i></i><b id="rtsCoral">0</b></span>
        <span class="rtsRes pop" title="人口／上限"><i></i><b id="rtsPop">0/0</b></span>
        <span id="rtsUpkeep" title="維持費：人口越多，礦石收入越少">無維持費</span>
      </div>
      <div id="rtsMsg"></div>
      <div id="rtsModeHint"></div>
      <div id="rtsBottom">
        <div id="rtsMini"><canvas id="rtsMiniCv"></canvas></div>
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
      b.innerHTML = `<b></b><em>${KEYS[i]}</em><small></small>`;
      b.onclick = (e) => this.rtsCardPress(i, e.shiftKey, true);
      b.onmouseenter = () => this.rtsTipShow(i);
      b.onmouseleave = () => this.rtsTipHide();
      card.appendChild(b);
    }
    document.getElementById('rtsMenuBtn').onclick = () => {
      if (typeof this.rtsPause === 'function') this.rtsPause();
    };
    // 小地圖：左鍵點／拖曳移動鏡頭，右鍵下指令（目標模式時當作目標點）
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
  },
  rtsMsg(txt, color = 0xffb020, dur = 1.6) {
    const m = document.getElementById('rtsMsg');
    if (!m) return this.flashMsg(txt, color, dur);
    m.textContent = txt;
    m.style.color = '#' + color.toString(16).padStart(6, '0');
    m.classList.add('on');
    clearTimeout(this._rtsMt);
    this._rtsMt = setTimeout(() => m.classList.remove('on'), dur * 1000);
  },
  // 事件（空白鍵跳過去）：核心也可以呼叫（例如生產完成、英雄升級）
  rtsEvent(x, z, txt, color = 0xffb020) {
    const R = this.rts;
    if (!R || !R.ui) return;
    R.ui.events.push({ x, z, t: R.t || 0, txt });
    if (R.ui.events.length > 16) R.ui.events.shift();
    if (txt) this.rtsMsg(txt, color, 2.2);
  },

  // ---------- 每格 ----------
  rtsHudTick(dt) {
    const R = this.rts;
    if (!R || !R.ui) return;
    if (this._rtsHudAt === this.lastT) return; // 同一格只跑一次（核心另外呼叫時）
    this._rtsHudAt = this.lastT;
    this.rtsHudShow(this.state === 'rts' || (this.state === 'pause' && !!this.rts));
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
    this.rtsDrawOverlay();
    this._rtsT = (this._rtsT || 0) + dt;
    this._rtsMiniT = (this._rtsMiniT || 0) + dt;
    if (this._rtsMiniT > 0.2) {
      this._rtsMiniT = 0;
      this.rtsMiniDraw();
    } else this.rtsMiniCam();
    if (this._rtsT > 0.1 || this.rtsHudDirty) {
      this._rtsT = 0;
      this.rtsHudDirty = false;
      this.rtsResDraw();
      this.rtsCardDraw();
      this.rtsPanelDraw();
      this.rtsAlertScan();
      const hint = document.getElementById('rtsModeHint');
      const m = R.ui.mode;
      const txt = m
        ? m.k === 'build'
          ? '放置 ' + this.rtsUiName(m.def) + '：左鍵放置、Shift 連續放、右鍵或 Esc 取消'
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
    const u = upkeepOf(T.pop || 0);
    const up = [u.name, ['', 'lo', 'hi'][u.lv] || 'hi'];
    const el = document.getElementById('rtsUpkeep');
    if (el.textContent !== up[0]) {
      el.textContent = up[0];
      el.className = up[1];
    }
    const s = Math.floor(R.t || 0);
    set('rtsClock', Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
  },

  // ---------- 指令卡 ----------
  // 目前選取的指令卡：12 格，每格 null 或 { c（定義的卡片）, cmd, label, key, alt, tip, cost, time, pop, dis（不能用的原因）, act(shift) }
  // 卡片定義在 data/rts-units.js 的 card／menus（at＝[列, 行]、act＝{ k: order｜train｜build｜menu｜back｜rally｜cancel }）
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
    if (!G.length) return cells;
    const e = G[0],
      D = this.rtsUiDef(e) || {};
    let list = D.card || [];
    if (ui.menu && D.menus && D.menus[ui.menu]) list = D.menus[ui.menu];
    else ui.menu = null;
    const building = !!(e.bld && e.bld.progress < 1);
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
      const a = c.act || {};
      const ref =
        a.k === 'train' || a.k === 'build'
          ? this.rtsUiDef(a.id) || {}
          : a.k === 'upgrade'
            ? this.rtsUiDef(a.to) || {}
            : null;
      const it = {
        c,
        cmd: a.k === 'order' ? a.o : a.k + (a.id ? ':' + a.id : a.menu ? ':' + a.menu : ''),
        label: c.name || (ref && ref.name) || a.k,
        key: c.key,
        alt: c.alt,
        tip: (ref && ref.desc) || c.tip || '',
        cost: ref && ref.cost,
        time: ref && ref.time,
        pop: ref && ref.pop,
        dis: ref ? this.rtsWhyNot(ref, a.k === 'train') : '',
        act: (shift) => this.rtsCardAct(c, G, shift),
      };
      if (a.k === 'cancel' && !building && !(e.bld && e.bld.queue && e.bld.queue.length))
        it.dis = '佇列是空的';
      if (a.k === 'upgrade' && !it.dis && e.bld && e.bld.queue.length) it.dis = '佇列要是空的才能升級';
      if (a.k === 'research' && this.rtsResearchInfo) {
        const inf = this.rtsResearchInfo(RTS_ME, a.id, e);
        if (inf) {
          it.cost = inf.next ? inf.next.cost : null;
          it.time = inf.next ? inf.next.time : 0;
          it.label = c.name + (inf.max > 1 ? ` ${Math.min(inf.lv + 1, inf.max)}` : '');
          it.dis = inf.why;
        }
      }
      if (c.req && !it.dis && this.rtsReqWhy) it.dis = this.rtsReqWhy(RTS_ME, c);
      put(c.at[0] * 4 + c.at[1], it);
    }
    return cells;
  },
  // 執行卡片
  rtsCardAct(c, G, shift) {
    const ui = this.rts.ui,
      a = c.act || {};
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
  // 不能生產／建造的原因（'' 表示可以）
  rtsWhyNot(D, unit) {
    const R = this.rts;
    const T = R.teams[RTS_ME];
    void R;
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
    if (typeof this.rtsQueue === 'function') this.rtsQueue(best, id);
    this.rtsHudDirty = true;
  },
  rtsInstant(o, shift) {
    const units = this.rtsActiveGroup().filter((e) => this.rtsOwn(e) && !e.bld);
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
    const sig = items.map((it) => (it ? it.cmd + '|' + it.label + '|' + (it.dis || '') : '-')).join(',');
    const ui = this.rts.ui;
    const modeK = ui.mode ? ui.mode.order || ui.mode.def : '';
    if (sig + modeK === this._rtsCardSig) return;
    this._rtsCardSig = sig + modeK;
    this._rtsCardItems = items;
    const btns = document.querySelectorAll('#rtsCard .rtsCmd');
    items.forEach((it, i) => {
      const b = btns[i];
      b.classList.toggle('empty', !it);
      b.classList.toggle('dis', !!(it && it.dis));
      b.classList.toggle(
        'on',
        !!(it && ui.mode && (ui.mode.order === it.cmd || 'build:' + ui.mode.def === it.cmd)),
      );
      b.disabled = !it;
      b.querySelector('b').textContent = it ? it.label : '';
      b.querySelector('em').textContent = it ? it.key || KEYS[i] : KEYS[i];
      const c = it && it.cost;
      b.querySelector('small').textContent = c
        ? [c.ore ? c.ore : '', c.coral ? '◆' + c.coral : ''].filter(Boolean).join(' ')
        : '';
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
    ]
      .filter(Boolean)
      .join('　');
    tip.innerHTML =
      `<b>${escHtml(it.label)}</b> <kbd>${escHtml(it.key || KEYS[i])}</kbd>` +
      (it.alt && it.alt !== 'Escape' ? ` <kbd>${escHtml(it.alt)}</kbd>` : '') +
      (cost ? `<div class="cost">${escHtml(cost)}</div>` : '') +
      (it.tip ? `<div>${escHtml(it.tip)}</div>` : '') +
      (it.dis ? `<div class="why">${escHtml(it.dis)}</div>` : '');
    tip.classList.add('on');
  },
  rtsTipHide() {
    this._rtsTipSlot = undefined;
    const tip = document.getElementById('rtsTip');
    if (tip) tip.classList.remove('on');
  },

  // ---------- 選取面板 ----------
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
      if (D.dps) rows.push('火力 每秒 ' + D.dps + (D.range ? '、射程 ' + D.range + ' m' : ''));
      else if (!e.bld && !D.worker) {
        const ws = Object.values(e.weapons || {})
          .map((w) => w && w.def && w.def.name)
          .filter((n) => n && n[0] !== '(');
        if (ws.length) rows.push('武器 ' + ws.slice(0, 2).join('、'));
      }
      if (e.bld) {
        if (D.popCap) rows.push('人口上限 +' + D.popCap);
        if (D.coralRate) rows.push('Coral 每秒 +' + D.coralRate);
      } else if (e.stats && e.stats.def !== undefined)
        rows.push('減傷 ' + Math.round(e.stats.def * 100) + '%');
      if (e.carry && e.carry.n)
        rows.push('攜帶 ' + (e.carry.kind === 'coral' ? 'Coral ' : '礦石 ') + e.carry.n);
      const ord = e.orders && e.orders[0];
      if (own && ord) rows.push('指令：' + (ORDER_NAME[ord.k] || ord.k));
      let q = '';
      if (e.bld && e.bld.progress < 1) {
        q = `<div class="rtsProg"><label>建造中 ${Math.floor(e.bld.progress * 100)}%</label><i style="width:${Math.round(e.bld.progress * 100)}%"></i></div>`;
      } else if (own && e.bld && e.bld.queue && e.bld.queue.length) {
        const first = e.bld.queue[0];
        const U = this.rtsUiDef(first.id) || {};
        const p = this.rtsQueueProg(first, U);
        q =
          `<div class="rtsQueue">` +
          e.bld.queue
            .map(
              (it, i) =>
                `<button type="button" class="rtsQ" data-q="${i}" title="取消生產">${escHtml(this.rtsAbbr(this.rtsUiName(it.id)))}</button>`,
            )
            .join('') +
          `</div><div class="rtsProg"><label>${escHtml(this.rtsUiName(first.id))}</label><i style="width:${Math.round(p * 100)}%"></i></div>`;
      }
      sig = 's' + e.id + '|' + hp + '|' + rows.join() + '|' + q;
      html =
        `<div class="rtsOne"><div class="rtsPic ${own ? 'own' : 'foe'}">${escHtml(this.rtsAbbr(this.rtsUiName(e)))}</div>` +
        `<div class="rtsInfo"><b>${escHtml(this.rtsUiName(e))}</b>` +
        `<div class="rtsHpBar"><i style="width:${pct * 100}%;background:${this.rtsHpCol(pct)}"></i><span>${hp} / ${Math.round(e.maxHp)}</span></div>` +
        rows.map((r) => `<div>${escHtml(r)}</div>`).join('') +
        `</div>${q ? `<div class="rtsProd">${q}</div>` : ''}</div>`;
    } else {
      const act = this.rtsActiveGroup();
      sig = 'm' + sel.map((e) => e.id + ':' + Math.round((e.hp / e.maxHp) * 20)).join() + '|' + ui.sub;
      html =
        '<div class="rtsMulti">' +
        sel
          .map((e, i) => {
            const pct = clamp(e.hp / e.maxHp, 0, 1);
            return `<button type="button" class="rtsU${act.includes(e) ? ' act' : ''}" data-i="${i}" title="${escHtml(this.rtsUiName(e))}">${escHtml(this.rtsAbbr(this.rtsUiName(e)))}<i style="width:${pct * 100}%;background:${this.rtsHpCol(pct)}"></i></button>`;
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
  },
  // 生產進度（0～1）：佇列項目的 t 是已經過的時間；有 p（進度）時直接用
  rtsQueueProg(it, U) {
    if (it.p !== undefined) return clamp(it.p, 0, 1);
    const T = U.time || 1;
    return clamp((it.t || 0) / T, 0, 1);
  },
  rtsAbbr(name) {
    const s = String(name || '?').replace(/^[A-Z0-9-]+\s+/, '');
    return s.length > 3 ? s.slice(0, 2) : s;
  },
  rtsHpCol(p) {
    return p > 0.6 ? '#4cff7a' : p > 0.3 ? '#ffd23a' : '#ff4a3a';
  },

  // ---------- 警示（基地遭受攻擊） ----------
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
      const k = e.bld ? 'bld' : 'unit';
      if (t - ui.alertT[k] < ALERT_GAP) continue;
      this.rtsScreen(e, s);
      const onScreen = s.in && s.x > 0 && s.x < innerWidth && s.y > 0 && s.y < innerHeight;
      ui.alertT[k] = t;
      if (onScreen && k === 'unit') continue;
      this.rtsEvent(e.pos.x, e.pos.z, e.bld ? '基地遭受攻擊' : '部隊遭受攻擊', 0xff6a5a);
      ui.ping = { x: e.pos.x, z: e.pos.z, t: 0 };
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
      if (!sel && !hurt && !bldUp) continue;
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
    for (const e of R.units || []) {
      if (e.dead || !this.rtsSeen(e)) continue;
      const own = e.rtsTeam === RTS_ME;
      const sel = R.sel.includes(e);
      g.fillStyle = sel ? '#ffffff' : own ? '#4cff7a' : e.rtsTeam === undefined ? '#ffd23a' : '#ff4a3a';
      if (e.bld) {
        const s = Math.max(3 * dpr, this.rtsRadius(e) * 1.4 * k);
        g.fillRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
      } else {
        const s = 2.2 * dpr;
        g.fillRect(X(e.pos.x) - s / 2, Z(e.pos.z) - s / 2, s, s);
      }
    }
    // 警示的閃爍圈
    const ping = R.ui.ping;
    if (ping && ping.t < 3) {
      ping.t += 0.2;
      g.strokeStyle = 'rgba(255,80,60,' + (1 - ping.t / 3) + ')';
      g.lineWidth = 2 * dpr;
      g.beginPath();
      g.arc(X(ping.x), Z(ping.z), (6 + (ping.t % 1) * 10) * dpr, 0, Math.PI * 2);
      g.stroke();
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
