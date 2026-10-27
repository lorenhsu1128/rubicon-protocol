// Game：主線的機庫據點（docs/campaign-design.md 第 8 節）——戰區總覽圖、簡報、車庫、通訊紀錄；
// 模擬器與作戰紀錄在第 6 期
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SEG_TYPES, SORTIES } from '../data/campaign.js';
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
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
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
    const route = so.segs
      .map((sg, i) => {
        const t = sg.pool.length === 1 ? SEG_TYPES[sg.pool[0]].name : '？';
        return `<span class="brSeg${sg.pool[0] === 'boss' ? ' boss' : ''}">${i + 1}. ${escHtml(THEMES[sg.theme].name)}${sg.border ? '（交界）' : ''}・${escHtml(t)}</span>`;
      })
      .join('<i>›</i>');
    $('brRoute').innerHTML = route;
    $('brReward').textContent =
      `完成報酬 ${so.reward.toLocaleString()} COAM（另有區段報酬）　完成次數 ${this.campStory().done[sid] || 0}`;
    this.tfxBrief(cl === 'echo'); // 文字演出：系統日誌樣式逐字（點一下全部顯示）
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
