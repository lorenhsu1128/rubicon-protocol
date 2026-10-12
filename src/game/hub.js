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
  REGIONS,
  SPEAKERS,
  clientInfo,
  speakerBadge,
} from '../data/story.js';
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
    this.state = 'hub';
    this.showScreen('hub');
    this.renderHub();
    this.campComm('hub', this.hubCtx());
  },
  renderHub() {
    const $ = (id) => document.getElementById(id);
    const st = this.campStory();
    const ch = this.hubChapter();
    const cyc = st.cycle || 1;
    $('hubChapter').textContent = (cyc > 1 ? `第 ${cyc} 周目　` : '') + (CHAPTER_NAMES[ch] || '');
    $('hubCoam').textContent = this.save.coam.toLocaleString();
    $('hubMods').innerHTML = this.campModsHtml();
    // ECHO 的紀錄：第 3 周目起（或回收過記憶片段）
    $('btnHubEcho').style.display = cyc >= 3 || this.campMemN() ? '' : 'none';
    $('btnHubEcho').textContent = `ECHO 的紀錄（${this.campMemN()}／6）`;
    // 進行中的出擊
    const ck = st.sortie;
    const so = ck && SORTIES[ck.sid];
    $('hubActive').style.display = so ? '' : 'none';
    if (so)
      $('hubActiveTxt').textContent =
        `出擊進行中：${so.name}　區段 ${ck.seg + 1}／${so.segs.length} 的紀錄點`;
    // 總覽圖：區域（依章節開放）＋出擊節點
    let svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet">';
    svg += '<rect x="0" y="0" width="100" height="100" fill="#0b1117"/>';
    for (let i = 0; i <= 10; i++)
      svg += `<path d="M${i * 10} 0V100M0 ${i * 10}H100" stroke="#16212b" stroke-width="0.2"/>`;
    for (let i = 1; i < REGIONS.length; i++) {
      const a = REGIONS[i - 1],
        b = REGIONS[i];
      svg += `<path d="M${a.x} ${a.y}L${b.x} ${b.y}" stroke="#2a3946" stroke-width="0.5" stroke-dasharray="1.2 1"/>`;
    }
    for (const R of REGIONS) {
      const open = R.chapter <= ch;
      svg += `<g class="hubRegion${open ? '' : ' locked'}"><circle cx="${R.x}" cy="${R.y}" r="9" fill="${open ? '#1a2a36' : '#10171e'}" stroke="${open ? '#3d5a70' : '#1c2630'}" stroke-width="0.4"/>`;
      // 區域名稱（lx, ly 避開節點），還沒開放的在名稱下方寫第幾章開放
      const lx = R.lx !== undefined ? R.lx : R.x,
        ly = R.ly !== undefined ? R.ly : R.y - 10.5;
      svg += `<text class="rl" x="${lx}" y="${ly}" text-anchor="middle" font-size="3" fill="${open ? '#a8bccc' : '#3a4a58'}">${escHtml(R.name)}</text>`;
      if (!open)
        svg += `<text class="rl" x="${lx}" y="${ly + 2.4}" text-anchor="middle" font-size="2" fill="#3a4a58">第 ${R.chapter} 章開放</text>`;
      svg += '</g>';
    }
    for (const sid in SORTIES) {
      const B = BRIEFINGS[sid];
      if (!B) continue;
      const s = this.hubSortieState(sid);
      if (s === 'hidden') continue;
      // 周目限定的是紫色，第 3 周目的 ECHO 委託是金色
      const col =
        s === 'done'
          ? '#7ee081'
          : s !== 'open'
            ? '#3a4a58'
            : B.client === 'echo'
              ? '#ffd060'
              : B.cycle
                ? '#c090ff'
                : '#ffb020';
      const tip = this.guideNodeInfo(sid);
      const chs = SORTIES[sid].segs.some((sg) => sg.choice);
      svg += `<g class="hubNode ${s}" data-sid="${sid}"><title>${escHtml(tip.join('\n'))}</title><circle cx="${B.node.x}" cy="${B.node.y}" r="2.6" fill="#0c1218" stroke="${col}" stroke-width="0.7"/>`;
      svg += `<text x="${B.node.x}" y="${B.node.y + 1}" text-anchor="middle" font-size="2.6" fill="${col}">${s === 'done' ? '✓' : s === 'open' ? '!' : '×'}</text>`;
      svg += `<text class="nl" x="${B.node.x}" y="${B.node.y + 5.6}" text-anchor="middle" font-size="2.2" fill="${col}">${escHtml(SORTIES[sid].name.split(' — ')[1] || SORTIES[sid].name)}</text>`;
      if (chs)
        svg += `<text x="${B.node.x + 3.2}" y="${B.node.y - 2}" font-size="2.6" fill="#ff8a50">⚑</text>`; // 有陣營抉擇
      svg += '</g>';
    }
    svg += '</svg>';
    $('hubMap').innerHTML = svg;
    // 地圖顯示得很小（手機橫式）：只留可以接的委託名稱並放大（styles.css 的 #hubMap.small）
    $('hubMap').classList.toggle('small', $('hubMap').clientHeight < 420);
    $('hubCap').textContent = '戰區總覽圖：點選委託查看簡報（⚑＝有陣營抉擇）';
    $('hubCap').classList.remove('warn');
    for (const n of $('hubMap').querySelectorAll('.hubNode')) {
      n.onclick = () => {
        const sid = n.dataset.sid;
        if (this.hubSortieState(sid) === 'locked') {
          // 鎖住的委託：在總覽圖上方寫出開放條件
          SFX.ui('err');
          $('hubCap').textContent = this.guideNodeInfo(sid).join('　');
          $('hubCap').classList.add('warn');
          return;
        }
        this.openBrief(sid);
      };
    }
  },
  // 簡報：委託方、內容、預定路線、報酬
  openBrief(sid) {
    SFX.ui();
    const $ = (id) => document.getElementById(id);
    const so = SORTIES[sid],
      B = BRIEFINGS[sid] || { lines: [], goal: '', client: 'castron' };
    const F = clientInfo(B.client);
    this.briefSid = sid;
    this.state = 'brief';
    this.showScreen('brief');
    $('brClient').innerHTML =
      `${speakerBadge(B.client, 56)}<div><b style="color:${F.color}">${escHtml(F.name)}</b><span class="dim">${escHtml(F.short)}・${escHtml(F.style)}</span></div>`;
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
    $('brLines').innerHTML = B.lines
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
    this.tfxBrief(B.client === 'echo'); // 文字演出：系統日誌樣式逐字（點一下全部顯示）
  },
  // 從簡報出擊：有別的出擊進行中時先確認
  briefGo() {
    const st = this.campStory();
    const sid = this.briefSid;
    if (st.sortie && !confirm('目前有進行中的出擊，開始新的出擊會放棄它的紀錄點。確定？')) return;
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
    $('epLines').innerHTML =
      `<div class="epMain">${ps(E.lines)}</div>` + (coda ? `<div class="epCoda">${ps(E.full)}</div>` : '');
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
    const log = (this.campStory().log || []).slice().reverse();
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
