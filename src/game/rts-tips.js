// Coral 戰爭（docs/rts-design.md 17.6）的第一次玩的提示卡與 RTS 設定（mixin，E 包）：
// - 開局卡：每個陣營第一次玩時開局暫停（state 'pause'＋#rtsTipCard 畫面，背景照常算繪）顯示陣營的特色與「怎麼開始」；
//   「開始」、Esc、手把 B（pad-ui 的 padUiBack：暫停時＝resume）都會關閉。
// - 情境提示（#rtsHint，右上角的小卡片，不暫停，8 秒後收起，每種一輩子一次）：rtsTipsTick 每 0.5 秒檢查（HUD 每格呼叫）。
// - 看過的提示存在 localStorage rubicon_rts_tips（id 陣列）。電腦對電腦（aiBoth）與冒煙測試（?test 且沒有 g.rtsTipsTest）不顯示。
// - RTS 設定（rubicon_rts 的 set；設定畫面的「Coral 戰爭」區塊 #rtsSetBox，rtsSetRender）：畫面邊緣捲動與速度、方向鍵的速度、
//   鏡頭旋轉靈敏度、血條、提示的開關與重設、自動管家的預設（rubicon_rts 的 butler，和 rts-pilot.js 共用）。
import { escHtml } from '../core/html.js';
import { RTS_DEFS, RTS_FACTIONS, RTS_POP_MAX } from '../data/rts-units.js';
import { Game } from './game.js';

const ME = 0;
const TIPS_KEY = 'rubicon_rts_tips';
const PREF_KEY = 'rubicon_rts';
const HINT_T = 8; // 情境提示顯示的秒數
const SET_DEF = { edge: true, edgeSp: 1, keySp: 1, rotK: 1, bars: 'hurt', tips: true };
const BUTLER_KEYS = ['gather', 'loop', 'depot', 'defend', 'follow'];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const BARS = [
  ['all', '全部'],
  ['hurt', '受傷或選取的（預設）'],
  ['sel', '只有選取的'],
];
// 情境提示：[id, 標題, 內容]
const HINTS = {
  idle: ['閒置的工人', '小地圖旁的「工」按鈕或 F8 選到沒事做的工人，右鍵礦脈繼續採集。'],
  popcap: ['人口快滿了', '蓋提供人口的建築（{pop}）；人口滿了就不能開始生產。'],
  hero: ['可以生產英雄了', '選主堡，指令卡的「英雄」：第 1 位免費（只花人口），英雄會升級、學技能、用道具。'],
  skill: ['英雄有技能點', '選英雄（F1～F3），在指令卡學技能；技能格右鍵切換自動施放。'],
  camp: ['野怪營地', '中立的野怪守著營地：打下來有經驗、資源與道具。標記的圈數是強度（1～3）。'],
  upgrade: ['主堡可以升級了', '選主堡，指令卡的升級：開放新的建築、兵種、研究與下一位英雄。'],
  attacked: ['遭受攻擊', '按空白鍵跳到最近的事件；小地圖上的紅圈是被打的地方。'],
  power: ['建築斷電停擺', '要電的建築離開導管範圍就停擺（生產與研究暫停）；資源列的「停擺」按鈕會跳過去。'],
  dropLost: ['空投被擊落', '運輸機沿途會被防空打下來：空投的落點避開敵方的防空，或先清掉防空砲。'],
  wreck: ['看到殘骸了', '選互助作業機右鍵殘骸拾荒：拿回礦石、Coral 與零件（敵我的殘骸都可以）。'],
  pilot: ['親自駕駛', 'WASD 移動、滑鼠瞄準開火、Z X C V 技能；長按 F 回到指揮。駕駛中自動管家照常運作。'],
};
const loadJson = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch (e) {
    return d;
  }
};
const saveJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};

Object.assign(Game.prototype, {
  // ---------- 設定 ----------
  rtsSetGet() {
    if (!this._rtsSet) this._rtsSet = { ...SET_DEF, ...(loadJson(PREF_KEY, {}).set || {}) };
    return this._rtsSet;
  },
  rtsSetSave(patch) {
    const S = this.rtsSetGet();
    Object.assign(S, patch || {});
    const P = loadJson(PREF_KEY, {});
    P.set = { ...S };
    saveJson(PREF_KEY, P);
    this.rtsHudDirty = true;
  },
  // 自動管家的預設（rubicon_rts 的 butler；局內同時改 R.butler）
  rtsSetButler(k, v) {
    const P = loadJson(PREF_KEY, {});
    const B = (P.butler = { ...(P.butler || {}) });
    B[k] = !!v;
    saveJson(PREF_KEY, P);
    const RB = this.rts && this.rts.butler;
    if (RB) {
      RB[k] = !!v;
      this.rtsHudDirty = true;
    }
  },
  // 設定畫面的「Coral 戰爭」區塊（settings.js 的 renderSettings 呼叫）
  rtsSetRender() {
    const box = document.getElementById('rtsSetBox');
    if (!box) return;
    const S = this.rtsSetGet();
    const B = { on: false, gather: true, loop: true, depot: true, defend: true, follow: true };
    Object.assign(B, (this.rts && this.rts.butler) || loadJson(PREF_KEY, {}).butler || {});
    const sel = (id, v, list) =>
      `<select id="${id}">${list.map(([k, n]) => `<option value="${k}"${String(k) === String(v) ? ' selected' : ''}>${escHtml(n)}</option>`).join('')}</select>`;
    const sp = SPEEDS.map((k) => [k, '×' + k]);
    const seen = this.rtsTipsSeen().length;
    box.innerHTML = `
      <div class="krow"><span>畫面邊緣捲動</span><span class="rtsSetPair"><label><input type="checkbox" id="rtsSetEdge" ${S.edge ? 'checked' : ''} /> 開啟</label>${sel('rtsSetEdgeSp', S.edgeSp, sp)}</span></div>
      <div class="krow"><span>方向鍵捲動速度</span>${sel('rtsSetKeySp', S.keySp, sp)}</div>
      <div class="krow"><span>鏡頭旋轉靈敏度</span>${sel('rtsSetRotK', S.rotK, sp)}</div>
      <div class="krow"><span>血條</span>${sel('rtsSetBars', S.bars, BARS)}</div>
      <div class="krow"><span>第一次玩的提示</span><span class="rtsSetPair"><label><input type="checkbox" id="rtsSetTips" ${S.tips ? 'checked' : ''} /> 顯示</label><button type="button" id="rtsSetTipsReset" title="清掉看過的提示（${seen} 個），下次重新顯示">重設提示</button></span></div>
      <div class="krow"><span>自動管家（預設）</span><span class="rtsSetButler">
        <label><input type="checkbox" data-bk="on" ${B.on ? 'checked' : ''} /> 指揮時也啟動</label>
        ${BUTLER_KEYS.map((k) => `<label><input type="checkbox" data-bk="${k}" ${B[k] !== false ? 'checked' : ''} /> ${escHtml(this.rtsButlerName ? this.rtsButlerName(k) : k)}</label>`).join('')}
      </span></div>
      <p class="dim" style="font-size: 11px">局內暫停時也能改，立即生效。</p>`;
    const $ = (id) => document.getElementById(id);
    $('rtsSetEdge').onchange = (e) => this.rtsSetSave({ edge: e.target.checked });
    $('rtsSetEdgeSp').onchange = (e) => this.rtsSetSave({ edgeSp: +e.target.value || 1 });
    $('rtsSetKeySp').onchange = (e) => this.rtsSetSave({ keySp: +e.target.value || 1 });
    $('rtsSetRotK').onchange = (e) => this.rtsSetSave({ rotK: +e.target.value || 1 });
    $('rtsSetBars').onchange = (e) => this.rtsSetSave({ bars: e.target.value });
    $('rtsSetTips').onchange = (e) => {
      this.rtsSetSave({ tips: e.target.checked });
      if (!e.target.checked) this.rtsTipsHide();
    };
    $('rtsSetTipsReset').onclick = () => {
      this.rtsTipsReset();
      this.rtsSetRender();
    };
    for (const c of box.querySelectorAll('[data-bk]'))
      c.onchange = () => this.rtsSetButler(c.dataset.bk, c.checked);
  },

  // ---------- 提示 ----------
  rtsTipsSeen() {
    const a = loadJson(TIPS_KEY, []);
    return Array.isArray(a) ? a : [];
  },
  rtsTipsMark(id) {
    const a = this.rtsTipsSeen();
    if (!a.includes(id)) {
      a.push(id);
      saveJson(TIPS_KEY, a);
    }
  },
  rtsTipsReset() {
    saveJson(TIPS_KEY, []);
    this.rtsTipsHide();
  },
  // 這一局要不要顯示提示
  rtsTipsOn() {
    const R = this.rts;
    if (!R || !R.cfg || R.cfg.aiBoth || !this.rtsSetGet().tips) return false;
    if (/[?&]test\b/.test(location.search) && !this.rtsTipsTest) return false;
    return true;
  },
  // 開局：HUD 第一次更新時（rtsTipsTick）呼叫；這個陣營第一次玩時暫停並顯示開局卡
  rtsTipsStart() {
    const R = this.rts;
    if (!R || R.tips) return;
    R.tips = { q: [], t: 0, cur: null, hideAt: 0 };
    if (!this.rtsTipsOn()) return;
    const fac = R.teams[ME].faction;
    const id = 'open_' + fac;
    if (this.rtsTipsSeen().includes(id) || this.state !== 'rts') return;
    this.rtsTipsMark(id);
    this.rtsTipsCard(fac);
  },
  rtsTipsCard(fac) {
    const el = document.getElementById('rtsTipCard');
    const F = RTS_FACTIONS[fac];
    if (!el || !F) return;
    el.innerHTML = `
      <div class="panel rtsTipPanel">
        <h2>${escHtml(F.name)} <small class="dim">${escHtml(F.style || '')}</small></h2>
        <ul>${(F.traits || []).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>
        <h3>怎麼開始</h3>
        <p>${escHtml(this.rtsMenuHowto ? this.rtsMenuHowto(fac) : '')}</p>
        <p class="dim">拆光對方所有的建築就獲勝。說明頁在 Coral 戰爭選單的「說明」。</p>
        <div class="row">
          <button type="button" class="primary" id="rtsTipGo">開始</button>
          <button type="button" id="rtsTipOff" title="之後不再顯示 Coral 戰爭的提示（設定裡可以重新開啟）">不再顯示提示</button>
        </div>
      </div>`;
    this.state = 'pause';
    this.showScreen('rtsTipCard');
    document.getElementById('rtsTipGo').onclick = () => this.resume();
    document.getElementById('rtsTipOff').onclick = () => {
      this.rtsSetSave({ tips: false });
      this.resume();
    };
  },
  // 情境提示：排隊、一次一張
  rtsTipsNote(id) {
    const R = this.rts;
    if (!R || !HINTS[id] || !this.rtsTipsOn()) return false;
    if (!R.tips) this.rtsTipsStart();
    const S = R.tips;
    if (S.cur === id || S.q.includes(id) || this.rtsTipsSeen().includes(id)) return false;
    this.rtsTipsMark(id);
    S.q.push(id);
    if (!S.cur) this.rtsTipsNext();
    return true;
  },
  rtsTipsNext() {
    const S = this.rts && this.rts.tips;
    const el = document.getElementById('rtsHint');
    if (!S || !el) return;
    const id = S.q.shift();
    S.cur = id || null;
    if (!id) {
      el.classList.remove('on');
      return;
    }
    const [title, body0] = HINTS[id];
    let body = body0;
    if (id === 'popcap') {
      const F = RTS_FACTIONS[this.rts.teams[ME].faction] || {};
      const b = (F.blds || []).find((k) => RTS_DEFS[k] && RTS_DEFS[k].popCap && !RTS_DEFS[k].heroes);
      body = body.replace('{pop}', b ? RTS_DEFS[b].name : '補給庫');
    }
    el.innerHTML = `<b>${escHtml(title)}</b><div>${escHtml(body)}</div><button type="button" class="rtsHintX" title="關閉">關閉</button>`;
    el.dataset.id = id;
    el.classList.add('on');
    el.querySelector('button').onclick = () => this.rtsTipsNext();
    S.hideAt = performance.now() + HINT_T * 1000;
  },
  rtsTipsHide() {
    const el = document.getElementById('rtsHint');
    if (el) el.classList.remove('on');
    const S = this.rts && this.rts.tips;
    if (S) {
      S.q = [];
      S.cur = null;
    }
    const c = document.getElementById('rtsTipCard');
    if (c && c.classList.contains('on') && this.state === 'pause' && this.rts) this.resume();
  },
  // HUD 每格呼叫（rtsHudTick）：開局卡、收起提示、每 0.5 秒檢查情境
  rtsTipsTick(dt) {
    const R = this.rts;
    if (!R) return;
    if (!R.tips) this.rtsTipsStart();
    const S = R.tips;
    if (!S) return;
    if (S.cur && performance.now() > S.hideAt) this.rtsTipsNext();
    S.t += dt;
    if (S.t < 0.5) return;
    S.t = 0;
    if (!this.rtsTipsOn()) return;
    const T = R.teams[ME];
    if (!T) return;
    const F = RTS_FACTIONS[T.faction] || {};
    const chk = (id, ok) => {
      if (!this.rtsTipsSeen().includes(id) && ok()) this.rtsTipsNote(id);
    };
    chk('pilot', () => !!R.pilot);
    if (R.pilot) return;
    chk('idle', () => (R.t || 0) > 30 && this.rtsIdleList && this.rtsIdleList('worker').length > 0);
    chk('popcap', () => T.cap > 0 && T.cap < RTS_POP_MAX && (T.pop || 0) >= T.cap - 2);
    chk(
      'hero',
      () =>
        !(T.heroes || []).length &&
        typeof this.rtsHeroWhy === 'function' &&
        (F.heroes || []).some((h) => !this.rtsHeroWhy(ME, h)) &&
        R.units.some(
          (e) =>
            !e.dead &&
            e.bld &&
            e.rtsTeam === ME &&
            !(e.bld.progress < 1) &&
            e.bld.def &&
            RTS_DEFS[e.bld.def] &&
            RTS_DEFS[e.bld.def].heroes,
        ),
    );
    chk('skill', () => (T.heroes || []).some((h) => h && h.pts > 0 && h.ent && !h.ent.dead));
    chk(
      'camp',
      () =>
        typeof this.rtsFogState === 'function' &&
        (R.camps || []).some((c) => c.pos && !c.cleared && this.rtsFogState(ME, c.pos.x, c.pos.z) === 2),
    );
    chk('upgrade', () =>
      R.units.some((e) => {
        if (e.dead || !e.bld || e.rtsTeam !== ME || e.bld.progress < 1) return false;
        const D = RTS_DEFS[e.bld.def] || {};
        const to = D.upTo && RTS_DEFS[D.upTo];
        if (!to || !this.rtsReqWhy || this.rtsReqWhy(ME, to)) return false;
        const c = to.cost || {};
        return (T.ore || 0) >= (c.ore || 0) && (T.coral || 0) >= (c.coral || 0);
      }),
    );
    if (T.faction === 'aetheric') chk('power', () => !!(this.rtsHudOffList && this.rtsHudOffList().length));
    if (T.faction === 'veerwell')
      chk('dropLost', () => !!(R.stats && R.stats[ME] && R.stats[ME].dropLost > 0));
    if (T.faction === 'sancta') chk('wreck', () => !!(this.rtsHudWrecks && this.rtsHudWrecks().length));
  },
});
