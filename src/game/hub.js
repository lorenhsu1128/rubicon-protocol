// Game：主線的機庫據點（docs/campaign-design.md 第 8 節）——戰區總覽圖、簡報、車庫、通訊紀錄；
// 模擬器與作戰紀錄在第 6 期
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SEG_TYPES, SORTIES, sortieBoss } from '../data/campaign.js';
import { ATTRS, ATTR_KEYS, weaponAttr } from '../data/attrs.js';
import { ACES, FOES, THEME_ACE, themeFoes } from '../data/foes.js';
import { asmStats, partById } from '../data/parts.js';
import {
  BRIEFINGS,
  CHAPTER_NAMES,
  ENDINGS,
  MEMORIES,
  RECALL_C2,
  REGIONS,
  SPEAKERS,
  briefClient,
  clientInfo,
  pickLines,
  speakerBadge,
} from '../data/story.js';
import { levelOf, pointsAt, spentPoints } from '../data/pilot.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

// 區段類型的圖示（簡報的路線；null＝還沒決定）
const SEG_ICON = {
  battle: 'M5 19L19 5 M9 5h10v10',
  elite: 'M12 3l2.6 5.6 6 .6-4.6 4 1.4 6-5.4-3.2-5.4 3.2 1.4-6-4.6-4 6-.6z',
  destroy: 'M12 3v4 M12 17v4 M3 12h4 M17 12h4 M12 8a4 4 0 1 0 .01 0',
  defend: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  escort: 'M3 15h12l3-4h3v4 M6 18a2 2 0 1 0 .01 0 M16 18a2 2 0 1 0 .01 0 M3 15V9h9v6',
  breakthrough: 'M4 12h12 M12 6l6 6-6 6 M4 6v12',
  supply: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8',
  intel: 'M5 4h10l4 4v12H5z M8 11h8 M8 15h6',
  boss: 'M4 18l2-10 4 4 2-7 2 7 4-4 2 10z',
};
const segIcon = (t) =>
  `<svg viewBox="0 0 24 24" class="brSI" aria-hidden="true"><path d="${SEG_ICON[t] || 'M9 9a3 3 0 1 1 4 2.8c-.8.4-1 1-1 2 M12 17v.5'}"/></svg>`;

// 武器零件的分類（手持或背部）
const sl0 = (id) => (partById('arm', id) && partById('arm', id).id === id ? 'arm' : 'back');
// 敵人說明的打法（intro 的「名稱：打法」或「名稱 — 打法」）
const tactic = (t) => {
  const s = String(t || '');
  const i = s.search(/：| — /);
  return i < 0 ? s : s.slice(i + (s[i] === '：' ? 1 : 3));
};
// 屬性的強弱晶片：res＝[實彈, 爆發, 能量] 的額外減傷（負的＝弱點）
const resChips = (res, laserK) =>
  ATTR_KEYS.map((k, i) => {
    const v = res ? res[i] : 0;
    if (v <= -0.08) return `<i class="brW" style="--c:${ATTRS[k].color}">弱 ${ATTRS[k].name}</i>`;
    if (v >= 0.12) return `<i class="brR" style="--c:${ATTRS[k].color}">抗 ${ATTRS[k].name}</i>`;
    return '';
  }).join('') +
  (laserK != null && Math.abs(laserK - 1) > 0.01
    ? `<i class="brR">雷射 ${Math.round(laserK * 100)}%</i>`
    : '');

Object.assign(Game.prototype, {
  // 簡報的情報：這次出擊會遇到的主題專屬敵人（依預排的主題與深度）、宿敵 AC、終點 Boss 的弱點與打法
  briefIntelHtml(sid, pre) {
    const so = SORTIES[sid];
    const foes = new Map(); // key → 第幾段起
    const aces = new Map();
    let boss = null;
    so.segs.forEach((sg, i) => {
      const t = i === 0 ? pre.type0 : null;
      const pool = t ? [t] : sg.pool;
      if (pool.length === 1 && pool[0] === 'boss') boss = sortieBoss(sg, 'boss');
      if (pool.includes('elite')) {
        // 依抉擇的宿敵（campSegAce 要有進行中的出擊，簡報時用存檔裡最近的抉擇）
        const a = sg.ace;
        let ace = typeof a === 'string' ? a : '';
        if (a && typeof a === 'object') {
          const pc = this.campPickCtx();
          const ck = Object.keys(a).find((k) => /^c\d$/.test(k) && typeof a[k] === 'object');
          ace = ck ? a[ck][pc[ck]] || '' : a[this.campLastPick(so.chapter)] || '';
        }
        ace = ace || THEME_ACE[sg.theme];
        if (ace && !aces.has(ace)) aces.set(ace, i);
      }
      if (pool.every((x) => x === 'supply')) return;
      for (const k of themeFoes(sg.theme, (pre.plan[i] && pre.plan[i].depth) || 0))
        if (!foes.has(k)) foes.set(k, i);
    });
    const row = (cls, name, sub, chips, tip) =>
      `<div class="brFoe ${cls}"><div class="brFN"><b>${escHtml(name)}</b><span class="dim">${escHtml(sub)}</span>${chips}</div><div class="brFT">${escHtml(tip)}</div></div>`;
    let h = '';
    if (boss)
      h += row(
        'boss',
        boss.name,
        '終點 Boss',
        resChips(boss.res),
        tactic(boss.intro) || '三個型態，第三型態有專屬招式',
      );
    for (const [k, i] of aces) {
      const A = ACES[k];
      let chips = '',
        sub = `宿敵 AC・第 ${i + 1} 段（精英）`;
      if (A.asm) {
        const st = asmStats(A.asm);
        const D = st.defs || { kin: 0, exp: 0, en: 0 };
        const lo = ATTR_KEYS.reduce((a, b) => (D[b] < D[a] ? b : a));
        const atk = [
          ...new Set(
            ['rarm', 'larm', 'rback', 'lback']
              .map((sl) => A.asm[sl])
              .filter(Boolean)
              .map((id) => partById(sl0(id), id))
              .filter((p) => p && p.type !== 'none')
              .map((p) => weaponAttr(p)),
          ),
        ];
        chips =
          `<i class="brW" style="--c:${ATTRS[lo].color}">防禦最弱 ${ATTRS[lo].name}</i>` +
          atk
            .map((k2) => `<i class="brA" style="--c:${ATTRS[k2].color}">攻擊 ${ATTRS[k2].name}</i>`)
            .join('');
      } else sub += '・每次組裝不同';
      h += row('ace', A.name, sub, chips, tactic(A.intro));
    }
    for (const [k, i] of foes) {
      const F = FOES[k];
      h += row(
        '',
        F.name,
        `${THEMES[F.theme].name}・第 ${i + 1} 段起${F.depth ? '（深層）' : ''}`,
        resChips(F.res, F.laserK),
        tactic(F.intro),
      );
    }
    return h ? `<div class="brIntelH">敵情</div>${h}` : '';
  },
  // 出擊的狀態：done 完成過、open 可以接、locked 前置還沒完成、hidden 陣營抉擇不符（總覽圖上不出現）
  hubSortieState(sid) {
    const st = this.campStory();
    const B = BRIEFINGS[sid];
    if (B && B.when && Object.keys(B.when).some((k) => st.choices[k] !== B.when[k])) return 'hidden';
    if (B && B.cycle && (st.cycle || 1) < B.cycle) return 'hidden'; // 周目限定的委託
    if (st.done[sid]) return 'done';
    // needs 全部完成、needsAny 其中一個完成（依抉擇的路線）
    const ok =
      !B || (B.needs.every((n) => st.done[n]) && (!B.needsAny || B.needsAny.some((n) => st.done[n])));
    return ok ? 'open' : 'locked';
  },
  // 上一周目（history 的最後一筆）的抉擇與結局：通訊的條件 prevC2／prevC4／prevEnd、紫色委託簡報的一句
  campPrev() {
    const h = this.campStory().history || [];
    const last = h[h.length - 1];
    const ch = (last && last.choices) || {};
    return { c2: ch.c2 || '', c4: ch.c4 || '', end: ch.c6 || '' };
  },
  campPrevCtx() {
    const p = this.campPrev();
    return { prevC2: p.c2, prevC4: p.c4, prevEnd: p.end };
  },
  // 真結局的條件：第 2 周目起的紫色委託（BRIEFINGS 的 cycle 2）全部完成過（哪一周目都算）
  campTruth() {
    const st = this.campStory();
    const ids = Object.keys(BRIEFINGS).filter((sid) => BRIEFINGS[sid].cycle === 2 && SORTIES[sid]);
    const dones = [st.done || {}, ...(st.history || []).map((h) => h.done || {})];
    const n = ids.filter((sid) => dones.some((d) => d[sid])).length;
    return { n, need: ids.length, ok: n >= ids.length };
  },
  // 回收的記憶片段數（第 3 周目的 ECHO 委託）
  campMemN() {
    return Object.keys(this.campStory().memories || {}).filter((k) => MEMORIES[k]).length;
  },
  // 作戰室的通訊條件
  hubCtx() {
    return {
      chapter: this.hubChapter(),
      cycle: this.campStory().cycle || 1,
      truth: this.campTruth().ok,
      ...this.campPickCtx(),
      ...this.campPrevCtx(),
    };
  },
  // 已開放的章節：有可以接（或完成過）的出擊的最大章節
  hubChapter() {
    let ch = 1;
    for (const sid in SORTIES)
      if (!['locked', 'hidden'].includes(this.hubSortieState(sid))) ch = Math.max(ch, SORTIES[sid].chapter);
    return ch;
  },
  openHub() {
    SFX.ui();
    this.camp = null;
    this.fromHub = false;
    if (this.storyHubCheck()) return; // 還沒看過的序章與章節開場（game/story.js）
    this.state = 'hub';
    this.showScreen('hub');
    this.renderHub();
    // 窗外的機體用伺服器預設組（或自己的模型組）：讀一次（有變動才解析，hub-holo.js 的 hubMechSync 會換上）
    if (!(this.net && this.net.role)) this.lmRefresh().catch(() => {});
    this.campComm('hub', this.hubCtx());
  },
  // 作戰室（docs/hub-ui.md）：指揮室場景與全像戰略桌在 hub-holo.js；這裡更新畫面上的介面
  renderHub() {
    const $ = (id) => document.getElementById(id);
    const st = this.campStory();
    const ch = this.hubChapter();
    const cyc = st.cycle || 1;
    $('hubChapter').textContent = (cyc > 1 ? `第 ${cyc} 周目　` : '') + (CHAPTER_NAMES[ch] || '');
    $('hubCoam').textContent = this.save.coam.toLocaleString();
    $('hubMods').innerHTML = this.campMods().length ? this.campModsHtml() : '';
    // 進行中的出擊：委託名＋區段進度格
    const ck = st.sortie;
    const so = ck && SORTIES[ck.sid];
    $('hubActive').style.display = so ? '' : 'none';
    if (so)
      $('hubActiveTxt').innerHTML =
        `<small>出擊進行中</small><b>${escHtml(so.name)}</b><span class="hubPips" title="區段 ${ck.seg + 1}／${so.segs.length} 的紀錄點">${so.segs
          .map((_, i) => `<i class="${i < ck.seg ? 'on' : i === ck.seg ? 'cur' : ''}"></i>`)
          .join('')}</span><span class="dim">區段 ${ck.seg + 1}／${so.segs.length}</span>`;
    // 圖示列的提示：ECHO 的紀錄、新的通訊、技能點
    const echoOn = cyc >= 3 || this.campMemN() > 0;
    this.hubEchoOff = !echoOn;
    $('btnHubEcho').style.display = echoOn ? '' : 'none';
    $('btnHubEcho').querySelector('.hdT').textContent = `ECHO 的紀錄（${this.campMemN()}／6）`;
    const newLog = Math.max(0, (st.log || []).length - (st.logSeen || 0));
    const P = this.save.pilot.pve;
    const pts = pointsAt(levelOf(P.xp)) - spentPoints(P.skills);
    const badge = (id, n) => {
      const e = $(id).querySelector('.hdN');
      e.textContent = n > 0 ? (n > 99 ? '99+' : n) : '';
      e.classList.toggle('on', n > 0);
    };
    badge('btnHubLog', newLog);
    badge('btnHubPilot', pts);
    // 場景裡的設施標籤（hub-holo.js）
    const nOpen = Object.keys(SORTIES).filter((sid) => this.hubSortieState(sid) === 'open').length;
    this.hubSpotsUi({
      pilot: pts > 0 ? { t: `技能點 ${pts}`, hot: true } : null,
      log: newLog > 0 ? { t: `新的通訊 ${newLog}`, hot: true } : null,
      echo: echoOn ? { t: `記憶片段 ${this.campMemN()}／6` } : null,
      record: { t: '重打完成過的委託' },
      garage: { t: '組裝與整備' },
    });
    $('hubCap').textContent = nOpen
      ? `戰略桌：點選委託查看簡報（⚑＝有陣營抉擇）　可以接的委託 ${nOpen}`
      : '戰略桌：這一章的委託都完成了';
    $('hubCap').classList.remove('warn');
    $('hubMap').classList.toggle('small', innerHeight < 540);
    this.hubHoloBuild();
  },
  // 只更新圖示列的數字（看過通訊紀錄之後）
  renderHubBadges() {
    const st = this.campStory();
    const e = document.querySelector('#btnHubLog .hdN');
    const n = Math.max(0, (st.log || []).length - (st.logSeen || 0));
    if (e) {
      e.textContent = n ? n : '';
      e.classList.toggle('on', n > 0);
    }
    const sp = document.querySelector('#hubSpots .hubSpot[data-spot="log"] small');
    if (sp && !n) sp.remove();
    if (this.hubSpotNew) this.hubSpotNew.log = 0;
  },
  // 簡報：委託方、內容、預定路線、報酬
  openBrief(sid) {
    SFX.ui();
    const $ = (id) => document.getElementById(id);
    const so = SORTIES[sid],
      B = BRIEFINGS[sid] || { lines: [], goal: '', client: 'castron' };
    const ch = this.campStory().choices || {};
    const cl = briefClient(B, ch),
      F = clientInfo(cl),
      spk = B.speaker || cl,
      S = SPEAKERS[spk];
    // 說話的人（委託方的代表）＋委託方
    const who = S && spk !== 'echo' ? `${S.name}　` : '';
    this.briefSid = sid;
    this.state = 'brief';
    this.showScreen('brief');
    $('brClient').innerHTML =
      `${speakerBadge(spk, 56)}<div><b style="color:${F.color}">${escHtml(who || F.name)}</b><span class="dim">${who ? escHtml(F.name) + '・' : ''}${escHtml(F.short)}・${escHtml(F.style)}</span></div>`;
    $('brTitle').textContent = so.name;
    // 路線與抉擇的說明（guide.js）
    $('brInfo').innerHTML = this.guideNodeInfo(sid)
      .slice(1)
      .map((t) => `<div>${escHtml(t)}</div>`)
      .join('');
    // 紫色委託：依上一周目的抉擇多一句（BRIEFINGS 的 prev）
    const pv = this.campPrev();
    const extra = Object.keys(B.prev || {})
      .map((k) => B.prev[k][pv[k]])
      .filter(Boolean);
    $('brLines').innerHTML = pickLines(B.lines, ch)
      .concat(extra)
      .map((l) => `<p>${escHtml(l)}</p>`)
      .join('');
    $('brGoal').textContent = '作戰目標：' + B.goal;
    // 路線：每個區段一個圖示（第一段的類型已經預排好；其他的固定類型照寫，會抽的是「?」），換主題時換底色
    const pre = this.hubPrePlan(sid);
    let th0 = null,
      band = 0;
    const route = so.segs
      .map((sg, i) => {
        const t = i === 0 ? pre.type0 : sg.pool.length === 1 ? sg.pool[0] : null;
        if (sg.theme !== th0) {
          if (th0) band++;
          th0 = sg.theme;
        }
        const nm = t ? SEG_TYPES[t].name : '？';
        const v =
          pre.plan[i] && pre.plan[i].variant && VARIANTS[sg.theme] && VARIANTS[sg.theme][pre.plan[i].variant];
        return `<span class="brSeg b${band % 2}${t === 'boss' ? ' boss' : ''}${i === 0 ? ' first' : ''}" title="${i + 1}. ${escHtml(THEMES[sg.theme].name)}${v ? '・' + escHtml(v.name) : ''}${sg.border ? '（交界）' : ''}・${escHtml(nm)}">${segIcon(t)}<small>${i + 1}</small></span>`;
      })
      .join('<i>›</i>');
    const themes = [...new Set(so.segs.map((sg) => THEMES[sg.theme].name))].join(' → ');
    const v0 =
      pre.plan[0] &&
      pre.plan[0].variant &&
      VARIANTS[so.segs[0].theme] &&
      VARIANTS[so.segs[0].theme][pre.plan[0].variant];
    $('brMapCap').innerHTML =
      `<b>第 1 段</b>　${escHtml(THEMES[so.segs[0].theme].name)}${v0 ? '・' + escHtml(v0.name) : ''}　<span>${escHtml(SEG_TYPES[pre.type0].name)}</span>`;
    $('brRouteH').textContent = `路線　${themes}　${so.segs.length} 個區段`;
    $('brIntel').innerHTML = this.briefIntelHtml(sid, pre);
    $('brRoute').innerHTML = route;
    $('brReward').textContent =
      `完成報酬 ${so.reward.toLocaleString()} COAM（另有區段報酬）　完成次數 ${this.campStory().done[sid] || 0}`;
    this.tfxBrief(cl === 'echo'); // 文字演出：系統日誌樣式逐字（點一下全部顯示）
    this.hubBriefShow(sid); // 背景：第一段地形的全像（hub-holo.js）
  },
  // 從簡報出擊：有別的出擊進行中時先確認
  briefGo(ok) {
    const st = this.campStory();
    const sid = this.briefSid;
    if (st.sortie && ok !== true)
      return this.uiConfirm('目前有進行中的出擊，開始新的出擊會放棄它的紀錄點。確定？', () =>
        this.briefGo(true),
      );
    st.sortie = null;
    SFX.ui();
    this.campBegin(sid);
  },
  // 車庫（從機庫進入時，左下的按鈕變成「返回機庫」）
  hubGarage() {
    SFX.ui();
    this.fromHub = true;
    this.openGarage();
  },
  // ---------- 結局與周目 ----------
  // 結局畫面（第 6 章完成、結果畫面按確定之後）：標題、台詞、進入下一周目（最多 3 周目）或回機庫
  // 多人時（房主與隊友都看）：周目是房主的，不能進下一周目，按鈕回大廳
  openEpilogue(key) {
    SFX.ui();
    const $ = (id) => document.getElementById(id);
    const E = ENDINGS[key] || ENDINGS.open;
    const st = this.campStory();
    const mp = !!(this.net && this.net.role);
    const cyc = (mp && this.campEndingCycle) || st.cycle || 1;
    this.campEndingCycle = null;
    this.commClear(); // 結果畫面時還在排隊的通訊不要蓋在結局上
    this.state = 'epilogue';
    this.showScreen('epilogue');
    $('epCycle').textContent = `第 ${cyc} 周目　完成`;
    $('epTitle').textContent = E.title;
    // 真結局：6 片記憶片段全部回收時多一段
    const coda = !!(E.full && this.campMemN() >= 6);
    const ps = (a) => a.map((l) => `<p>${escHtml(l)}</p>`).join('');
    // 回收程序（循環的真相）：第 2 周目多兩句
    const recall = E.recall ? E.recall.concat(cyc === 2 ? RECALL_C2 : []) : null;
    $('epLines').innerHTML =
      `<div class="epMain">${ps(E.lines)}</div>` +
      (recall ? `<div class="epRecall">${ps(recall)}</div>` : '') +
      (coda ? `<div class="epCoda">${ps(E.full)}</div>` : '');
    const seen = Object.keys(st.endings || {}).length;
    $('epSeen').textContent = `看過的結局：${seen}／${Object.keys(ENDINGS).length}`;
    $('btnEpNext').style.display = cyc < 3 && !mp ? '' : 'none';
    $('btnEpNext').textContent = `開始第 ${cyc + 1} 周目`;
    $('btnEpHub').textContent = mp ? '返回大廳' : '回到作戰室';
    this.tfxEpilogue(E.title, coda); // 文字演出：標題、逐字、真結局的結尾與片尾
  },
  // 結局畫面的「回到機庫」：多人時回大廳
  epilogueBack() {
    if (this.net && this.net.role) return this.mpBackToLobby();
    this.openHub();
  },
  mpBackToLobby() {
    this.clearMission();
    this.state = 'lobby';
    this.showScreen('lobby');
    if (this.net.role === 'host') this.net.syncLobby();
    this.renderLobby();
  },
  // 下一周目：委託與抉擇重來（這一周目的紀錄存進 history），戰術模組清空；結局與通訊紀錄保留
  campNextCycle() {
    const st = this.campStory();
    const cyc = st.cycle || 1;
    st.history = (st.history || []).concat([{ cycle: cyc, done: st.done, choices: st.choices }]);
    st.cycle = Math.min(3, cyc + 1);
    st.done = {};
    st.choices = {};
    st.sortie = null;
    st.mods = { chapter: 1, list: [] };
    st.mpMods = null;
    this.writeSave();
    this.openHub();
    this.tfx('cycle', `第 ${st.cycle} 周目`, `CYCLE ${st.cycle}`, { states: ['hub'] });
  },
  // ECHO 的紀錄：回收的記憶片段（第 3 周目的 ECHO 委託）與真結局的條件
  hubEcho(open) {
    const el = document.getElementById('hubEchoBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    SFX.ui();
    const st = this.campStory();
    const mem = st.memories || {};
    const T = this.campTruth();
    let h = `<div class="echoNote">真結局的條件：第 3 周目，並完成全部紫色委託（目前 ${T.n}／${T.need}${T.ok ? '，已達成' : ''}）。記憶片段 ${this.campMemN()}／6${this.campMemN() >= 6 ? '：真結局多一段結尾' : '：全部回收時，真結局多一段結尾'}。</div>`;
    for (const k of Object.keys(MEMORIES)) {
      const M = MEMORIES[k];
      const sid = Object.keys(SORTIES).find((s) => SORTIES[s].memory === +k);
      h += mem[k]
        ? `<div class="echoMem"><b>片段 ${k}「${escHtml(M.title)}」</b>${M.lines.map((l) => `<p>${escHtml(l)}</p>`).join('')}</div>`
        : `<div class="echoMem locked"><b>片段 ${k}　？？？</b><p class="dim">完成 ECHO 的委託「${escHtml(sid ? SORTIES[sid].name : '')}」回收（第 3 周目）</p></div>`;
    }
    document.getElementById('hubEchoList').innerHTML = h;
  },
  // 通訊紀錄：最近的在上面
  hubLog(open) {
    const el = document.getElementById('hubLogBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    const st = this.campStory();
    st.logSeen = (st.log || []).length; // 圖示列的「新的通訊」
    this.writeSave();
    this.renderHubBadges();
    const log = (st.log || []).slice().reverse();
    document.getElementById('hubLogList').innerHTML = log.length
      ? log
          .map((l) => {
            const S = SPEAKERS[l.sp] || SPEAKERS.echo;
            return `<div class="hubLogRow">${speakerBadge(l.sp, 30)}<div><b style="color:${S.color}">${escHtml(S.name)}</b><span>${escHtml(l.text)}</span></div></div>`;
          })
          .join('')
      : '<p class="dim">還沒有通訊紀錄。</p>';
  },
});
