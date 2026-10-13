// Game：主線的序章與章節的開場／章末（全畫面，劇本 docs/story-script.md）、作戰室的「章節回顧」。
// 看過的記在 save.story.storySeen（p<周目>＝序章、i<周目>_<章>＝開場、o<周目>_<章>＝章末），多人不播
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SORTIES } from '../data/campaign.js';
import { CHAPTER_NAMES, CHAPTER_TEXT, PROLOGUE, pickLines } from '../data/story.js';
import { Game } from './game.js';

const NUM = ['', '一', '二', '三', '四', '五', '六'];

Object.assign(Game.prototype, {
  // 自動播放：多人不播；冒煙測試（?test）設 storyTest 才播
  storyAuto() {
    return !(this.net && this.net.role) && (!window.__game || this.storyTest);
  },
  storySeen() {
    const st = this.campStory();
    return st.storySeen || (st.storySeen = {});
  },
  // 一則畫面的內容：k＝鍵，回傳 { title, sub, lines }（沒有內容時 null）
  storyItem(k) {
    const m = /^([pio])(\d)(?:_(\d))?$/.exec(k);
    if (!m) return null;
    const cyc = +m[2],
      ch = +m[3];
    if (m[1] === 'p') {
      const P = PROLOGUE[cyc];
      return P && { title: P.title, sub: cyc > 1 ? `第 ${cyc} 周目` : 'PROLOGUE', lines: P.lines };
    }
    const T = CHAPTER_TEXT[ch];
    const lines = T && (m[1] === 'i' ? T.intro : T.outro);
    if (!lines) return null;
    const name = (CHAPTER_NAMES[ch] || '').replace(/^第 \d 章\s*/, '');
    return {
      title: m[1] === 'i' ? `第${NUM[ch]}章　${name}` : `第${NUM[ch]}章　完`,
      sub: (cyc > 1 ? `第 ${cyc} 周目　` : '') + (m[1] === 'i' ? `CHAPTER ${ch}` : 'CHAPTER END'),
      lines: pickLines(lines, this.storyChoicesOf(cyc)),
    };
  },
  // 那一周目的抉擇（這一周目＝存檔裡的；以前的周目＝history）
  storyChoicesOf(cyc) {
    const st = this.campStory();
    if (cyc === (st.cycle || 1)) return st.choices || {};
    const h = (st.history || []).find((x) => x.cycle === cyc);
    return (h && h.choices) || {};
  },
  // 作戰室：還沒看過的序章與目前章節的開場（回傳 true＝正在播放，作戰室等播完再顯示）
  storyHubCheck() {
    if (!this.storyAuto()) return false;
    const st = this.campStory();
    const cyc = st.cycle || 1;
    const seen = this.storySeen();
    const q = [];
    // 序章：這一周目還沒完成任何出擊時（舊存檔進行到一半不補播）
    const any = Object.keys(st.done || {}).some((s) => SORTIES[s] && st.done[s]);
    if (!seen['p' + cyc] && !any) q.push('p' + cyc);
    const k = `i${cyc}_${this.hubChapter()}`;
    if (!seen[k]) q.push(k);
    if (!q.length) return false;
    this.storyPlay(q, () => this.openHub());
    return true;
  },
  // 結果畫面之後：整章完成時的章末（之後回作戰室，下一章的開場由 storyHubCheck 接著播）
  storyChapterEnd(ch) {
    const cyc = this.campStory().cycle || 1;
    const k = `o${cyc}_${ch}`;
    if (!this.storyAuto() || this.storySeen()[k] || !this.storyItem(k)) return this.openHub();
    this.storyPlay([k], () => this.openHub());
  },
  // 依序播放（每則按「繼續」換下一則），全部播完呼叫 done
  storyPlay(keys, done) {
    this.storyQ = keys.filter((k) => this.storyItem(k));
    this.storyDone = done;
    this.storyNext();
  },
  storyNext() {
    const k = (this.storyQ || []).shift();
    if (!k) {
      const f = this.storyDone;
      this.storyDone = null;
      return f && f();
    }
    const it = this.storyItem(k);
    this.storySeen()[k] = 1;
    this.writeSave();
    SFX.ui();
    this.commClear();
    const $ = (id) => document.getElementById(id);
    this.state = 'story';
    this.showScreen('storyScr');
    $('stSub').textContent = it.sub;
    $('stTitle').textContent = it.title;
    // 角色的台詞（「名字：「…」」）用不同的顏色
    $('stLines').innerHTML = it.lines
      .map((l) => `<p${/^[^「」]{1,16}：「/.test(l) ? ' class="say"' : ''}>${escHtml(l)}</p>`)
      .join('');
    const end = this.tfxStory(it.title);
    this.storyTypeEnd = end ? performance.now() + end * 1000 : 0;
  },
  // 「繼續」：逐字還沒完時先全部顯示
  storyContinue() {
    if (this.storyTypeEnd > performance.now()) {
      this.storyTypeEnd = 0;
      return this.tfxSkip();
    }
    this.storyNext();
  },
  // 作戰室的「章節回顧」：看過的序章、開場、章末
  hubStory(open) {
    const el = document.getElementById('hubStoryBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    SFX.ui();
    const seen = this.storySeen();
    const order = (k) => {
      const m = /^([pio])(\d)(?:_(\d))?$/.exec(k);
      return +m[2] * 100 + (+m[3] || 0) * 10 + (m[1] === 'p' ? 0 : m[1] === 'i' ? 1 : 2);
    };
    const keys = Object.keys(seen)
      .filter((k) => this.storyItem(k))
      .sort((a, b) => order(a) - order(b));
    const list = document.getElementById('hubStoryList');
    list.innerHTML = keys.length
      ? keys
          .map((k) => {
            const it = this.storyItem(k);
            return `<button class="storyItem" data-k="${k}"><b>${escHtml(it.title)}</b><span class="dim">${escHtml(it.sub)}</span></button>`;
          })
          .join('')
      : '<p class="dim">還沒有看過的章節。</p>';
    for (const b of list.querySelectorAll('.storyItem'))
      b.onclick = () => {
        this.hubStory(false);
        this.storyPlay([b.dataset.k], () => this.openHub());
      };
  },
});
