// Game：主線的機庫據點（docs/campaign-design.md 第 8 節）——戰區總覽圖、簡報、車庫、通訊紀錄；
// 模擬器與作戰紀錄在第 6 期
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SEG_TYPES, SORTIES } from '../data/campaign.js';
import { BRIEFINGS, CHAPTER_NAMES, FACTIONS, REGIONS, SPEAKERS, speakerBadge } from '../data/story.js';
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // 出擊的狀態：done 完成過、open 可以接、locked 前置還沒完成、hidden 陣營抉擇不符（總覽圖上不出現）
  hubSortieState(sid) {
    const st = this.campStory();
    const B = BRIEFINGS[sid];
    if (B && B.when && Object.keys(B.when).some((k) => st.choices[k] !== B.when[k])) return 'hidden';
    if (st.done[sid]) return 'done';
    return !B || B.needs.every((n) => st.done[n]) ? 'open' : 'locked';
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
    this.campComm('hub', { chapter: this.hubChapter() });
  },
  renderHub() {
    const $ = (id) => document.getElementById(id);
    const st = this.campStory();
    const ch = this.hubChapter();
    $('hubChapter').textContent = CHAPTER_NAMES[ch] || '';
    $('hubCoam').textContent = this.save.coam.toLocaleString();
    $('hubMods').innerHTML = this.campModsHtml();
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
      svg += `<text x="${R.x}" y="${R.y - 10.5}" text-anchor="middle" font-size="3" fill="${open ? '#a8bccc' : '#3a4a58'}">${escHtml(R.name)}</text>`;
      if (!open)
        svg += `<text x="${R.x}" y="${R.y + 1}" text-anchor="middle" font-size="2.4" fill="#3a4a58">第 ${R.chapter} 章開放</text>`;
      svg += '</g>';
    }
    for (const sid in SORTIES) {
      const B = BRIEFINGS[sid];
      if (!B) continue;
      const s = this.hubSortieState(sid);
      if (s === 'hidden') continue;
      const col = s === 'done' ? '#7ee081' : s === 'open' ? '#ffb020' : '#3a4a58';
      svg += `<g class="hubNode ${s}" data-sid="${sid}"><circle cx="${B.node.x}" cy="${B.node.y}" r="2.6" fill="#0c1218" stroke="${col}" stroke-width="0.7"/>`;
      svg += `<text x="${B.node.x}" y="${B.node.y + 1}" text-anchor="middle" font-size="2.6" fill="${col}">${s === 'done' ? '✓' : s === 'open' ? '!' : '×'}</text>`;
      svg += `<text x="${B.node.x}" y="${B.node.y + 5.6}" text-anchor="middle" font-size="2.2" fill="${col}">${escHtml(SORTIES[sid].name.split(' — ')[1] || SORTIES[sid].name)}</text></g>`;
    }
    svg += '</svg>';
    $('hubMap').innerHTML = svg;
    for (const n of $('hubMap').querySelectorAll('.hubNode')) {
      n.onclick = () => {
        const sid = n.dataset.sid;
        if (this.hubSortieState(sid) === 'locked') return this.flashMsg('前置委託尚未完成', 0xff8a8a, 1.2);
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
    const F = FACTIONS[B.client];
    this.briefSid = sid;
    this.state = 'brief';
    this.showScreen('brief');
    $('brClient').innerHTML =
      `${speakerBadge(B.client, 56)}<div><b style="color:${F.color}">${escHtml(F.name)}</b><span class="dim">${escHtml(F.short)}・${escHtml(F.style)}</span></div>`;
    $('brTitle').textContent = so.name;
    $('brLines').innerHTML = B.lines.map((l) => `<p>${escHtml(l)}</p>`).join('');
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
