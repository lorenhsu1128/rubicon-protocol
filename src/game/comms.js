// Game：主線的通訊（data/story.js 的 COMMS）——依事件與條件挑一則，台詞依序顯示在右下角（不暫停遊戲），
// 播過的寫進存檔的通訊紀錄。也用在失敗畫面與機庫。
import { COMMS, SPEAKERS, speakerBadge } from '../data/story.js';
import { escHtml } from '../core/html.js';
import { Game } from './game.js';

const COND = ['sid', 'seg', 'type', 'theme', 'chapter', 'fails', 'killedBy', 'cycle', 'ace', 'pick'];
const keyOf = (e) => e.event + '|' + e.lines[0][1];

Object.assign(Game.prototype, {
  // 找出符合的通訊：條件全部成立；once 的播過就跳過；條件越多越優先（同分隨機）
  commPick(event, ctx = {}) {
    const st = this.save.story || {};
    const seen = new Set(st.seen || []);
    const ok = (e) => {
      if (e.event !== event) return false;
      if (e.once && seen.has(keyOf(e))) return false;
      for (const k of COND) {
        if (e[k] === undefined) continue;
        const v = ctx[k];
        if (k === 'fails') {
          if (!(v >= e.fails)) return false;
        } else if (k === 'killedBy') {
          if (!v || !String(v).includes(e.killedBy)) return false;
        } else if (v !== e[k]) return false;
      }
      return true;
    };
    const cand = COMMS.filter(ok);
    if (!cand.length) return null;
    const score = (e) => COND.filter((k) => e[k] !== undefined).length + (e.once ? 0.5 : 0);
    const best = Math.max(...cand.map(score));
    const top = cand.filter((e) => score(e) === best);
    return top[Math.floor(Math.random() * top.length)];
  },
  // 觸發事件：挑一則、記錄、排進右下角的播放佇列（show＝false 時只記錄並回傳，失敗畫面自己顯示）
  campComm(event, ctx = {}, show = true) {
    const e = this.commPick(event, ctx);
    if (!e) return null;
    const st = this.save.story || (this.save.story = {});
    st.seen = st.seen || [];
    const k = keyOf(e);
    if (!st.seen.includes(k)) st.seen.push(k);
    st.log = st.log || [];
    for (const [sp, text] of e.lines) st.log.push({ sp, text, sid: ctx.sid || '', t: Date.now() });
    if (st.log.length > 200) st.log = st.log.slice(-200);
    this.writeSave();
    if (show) {
      this.commQ = (this.commQ || []).concat(e.lines);
      if (!this.commBusy) this.commNext();
    }
    return e;
  },
  // 播放下一句：顯示時間依台詞長度
  commNext() {
    const el = document.getElementById('comm');
    if (!el) return;
    const q = this.commQ || [];
    const ln = q.shift();
    if (!ln) {
      this.commBusy = false;
      el.classList.remove('on');
      return;
    }
    this.commBusy = true;
    const [sp, text] = ln;
    const S = SPEAKERS[sp] || SPEAKERS.echo;
    el.innerHTML = `${speakerBadge(sp)}<div><b style="color:${S.color}">${escHtml(S.name)}</b><span>${escHtml(text)}</span></div>`;
    el.classList.add('on');
    clearTimeout(this.commTo);
    this.commTo = setTimeout(() => this.commNext(), (1.8 + text.length * 0.09) * 1000);
  },
  // 即時的一句（增援預告等）：插到最前面立刻顯示，不寫進通訊紀錄
  commSay(sp, text) {
    this.commQ = [[sp, text]].concat(this.commQ || []);
    this.commNext();
  },
  commClear() {
    clearTimeout(this.commTo);
    this.commQ = [];
    this.commBusy = false;
    const el = document.getElementById('comm');
    if (el) el.classList.remove('on');
  },
});
