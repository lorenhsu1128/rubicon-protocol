// Game：文字演出（render/textfx.js 用文字動畫 APNG 產生器的模板播放）
//  - 戰鬥的橫幅（作戰開始、區段、WARNING、型態、狂暴、敵對 AC、最終波、清除、擊破、任務完成）
//  - 中央訊息依種類換樣式（flashMsg 的 o.k；沒給時依顏色判斷）
//  - 主線的敘事：章名卡、轉場標題與說明、簡報、抉擇、記憶片段、結局、片尾、下一周目
//  - 結果畫面的標題與評價
// 設定「文字演出」（ctrl.tfx）：full 完整／simple 簡化（較低解析度、沒有光暈與模糊）／off 關閉（原本的畫面）
import { TextFx, preloadFonts, revealDom, revealFinish } from '../render/textfx.js';
import { SORTIES } from '../data/campaign.js';
import { FACTIONS, REGIONS, SPEAKERS } from '../data/story.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
// 任務中的項目：暫停、設定、靶場設定時凍結
const PLAY = { states: ['play', 'modpick'], freeze: ['pause', 'settings', 'rangecfg'] };
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
const NUM = ['', '一', '二', '三', '四', '五', '六'];

// flashMsg 沒指定種類時：依顏色
function kindOf(color) {
  const r = (color >> 16) & 255,
    g = (color >> 8) & 255,
    b = color & 255;
  if (r > 200 && g < 140 && b < 140) return 'warn';
  if (g > 200 && r < 160) return 'good';
  if (r > 230 && g > 180 && b < 110 && g >= 190) return 'good'; // 金色
  if (b > 200 && r < 160) return 'sys';
  return 'info';
}

Object.assign(Game.prototype, {
  tfxInit() {
    const cv = document.createElement('canvas');
    cv.id = 'tfx';
    $('ui').prepend(cv);
    this.textfx = new TextFx(cv);
    this.textfx.mode = this.ctrl.tfx || 'full';
    if (this.textfx.on) preloadFonts();
    // 點一下：跳過逐字與片尾
    for (const id of ['brief', 'epilogue', 'campTrans'])
      $(id).addEventListener('pointerdown', () => this.tfxSkip());
  },
  tfxSetMode(m) {
    this.ctrl.tfx = m;
    if (!this.textfx) return;
    const was = this.textfx.on;
    this.textfx.mode = m;
    if (!this.textfx.on) {
      this.textfx.clear();
      for (const el of [...this.textfx.hosts.keys()]) this.textfx.unhost(el);
      for (const el of document.querySelectorAll('.tq')) revealFinish(el);
    } else if (!was) preloadFonts();
  },
  // 每格（主迴圈開頭，用實際經過的時間）
  // 每格（主迴圈開頭）：用實際經過的時間（不受頓格、遊戲速度與低 FPS 的上限影響）
  tfxTick() {
    if (!this.textfx) this.tfxInit();
    const now = performance.now();
    const dt = Math.min(0.25, (now - (this.tfxLast || now)) / 1000);
    this.tfxLast = now;
    this.textfx.tick(dt, this.state);
  },
  // 播一個演出；回傳 false＝關閉（呼叫端改用原本的畫面）
  tfx(cue, main, sub, opt) {
    if (!this.textfx || !this.textfx.on) return false;
    return !!this.textfx.show(cue, main, sub, opt || PLAY);
  },
  // 中央訊息與任務中的橫幅（hud.js 的 flashMsg 轉過來）。o：{ k 種類, m 主字, s 副字 }
  tfxMsg(txt, color, dur, o) {
    if (!this.textfx || !this.textfx.on) return false;
    const k = (o && o.k) || kindOf(color);
    let main = (o && o.m) || txt,
      sub = o && o.s != null ? o.s : null;
    // 「主 — 副」拆成主字與副字
    if (sub == null && !(o && o.m)) {
      const i = txt.indexOf(' — ');
      if (i > 0) {
        main = txt.slice(0, i);
        sub = txt.slice(i + 3);
      } else sub = k === 'sys' ? 'SYSTEM' : k === 'echo' ? 'ECHO' : '';
    }
    // 中央訊息：登場＋顯示＋退場塞進給的秒數
    const fit = ['info', 'good', 'warn', 'sys', 'echo'].includes(k) ? Math.max(0.8, dur) : undefined;
    this.textfx.show(k, main, sub, { ...PLAY, fit });
    return true;
  },
  tfxSkip() {
    for (const el of document.querySelectorAll('.tq')) revealFinish(el);
    if (this.textfx) this.textfx.clear((x) => x.cue === 'credits' || x.cue === 'chapter');
  },
  // ---------- 結果畫面：標題與評價 ----------
  tfxResult() {
    if (!this.textfx || this.state !== 'result') return;
    const t = $('rTitle'),
      r = $('rRank');
    const title = t.textContent;
    const cue = /失敗|放棄|敗北/.test(title) ? 'resFail' : /勝利/.test(title) ? 'resWin' : 'resClear';
    const sub = cue === 'resFail' ? (/放棄/.test(title) ? 'ABORTED' : 'MISSION FAILED') : null;
    this.textfx.host(t, cue, title, sub);
    const rank = r.textContent.trim();
    if (/^[SABCD]$/.test(rank) && r.style.color === '')
      this.textfx.host(r, rank === 'S' ? 'rankS' : rank === 'D' ? 'rankD' : 'rankA', rank, '');
    else this.textfx.unhost(r);
  },
  // ---------- 主線 ----------
  // 轉場畫面：標題與下一段的說明；整章第一次出擊時先播章名卡
  tfxTrans(tr, first) {
    if (!this.textfx || !this.textfx.on) return;
    this.textfx.host($('ctTitle'), 'transTitle', tr.title, '');
    revealDom($('ctNext'), 'trans', { delay: 0.5, limit: 2.5 });
    const so = this.campSortie && this.campSortie();
    if (first === true && so && this.camp && this.camp.seg === 0 && !this.camp.replay) {
      const st = this.campStory();
      const ch = so.chapter || 1;
      const any = Object.keys(st.done || {}).some((k) => SORTIES[k] && SORTIES[k].chapter === ch);
      if (!any) {
        const R = REGIONS.find((g) => g.chapter === ch);
        this.textfx.show('chapter', `第${NUM[ch]}章　${R ? R.name : ''}`, `CHAPTER ${ROMAN[ch]}`, {
          states: ['camptrans'],
        });
      }
    }
  },
  // 簡報：系統日誌樣式逐字（ECHO 的私人委託是綠字＋故障）
  tfxBrief(echo) {
    if (!this.textfx || !this.textfx.on) return;
    revealDom($('brLines'), echo ? 'briefEcho' : 'brief', { delay: 0.2, limit: 7 });
  },
  // 結局：標題、電影感的逐字；真結局的結尾（幽魂樣式）播完接片尾
  tfxEpilogue(title, coda) {
    if (!this.textfx || !this.textfx.on) return;
    this.textfx.host($('epTitle'), 'epTitle', title, null);
    const main = $('epLines').querySelector('.epMain'),
      cd = $('epLines').querySelector('.epCoda');
    let end = revealDom(main, 'ending', { delay: 1.2, limit: 22 });
    if (cd) end = revealDom(cd, 'coda', { delay: end + 1.2, limit: 14 });
    clearTimeout(this.tfxCreditsTo);
    if (coda)
      this.tfxCreditsTo = setTimeout(
        () => {
          if (this.state === 'epilogue') this.tfxCredits();
        },
        (end + 2.5) * 1000,
      );
  },
  tfxCredits() {
    const fac = Object.values(FACTIONS)
      .map((f) => f.name)
      .join('\n');
    const rivals = Object.values(SPEAKERS)
      .filter((s) => /宿敵/.test(s.note || ''))
      .map((s) => s.name);
    const rows = [];
    for (let i = 0; i < rivals.length; i += 3) rows.push(rivals.slice(i, i + 3).join('　'));
    const text = [
      'RUBICON PROTOCOL',
      '',
      'OPERATOR',
      SPEAKERS.echo.name,
      '',
      'CLIENTS',
      fac,
      '',
      'RIVALS',
      rows.join('\n'),
      '',
      '──循環在這裡結束。',
      '',
      'Thank you for playing!',
    ].join('\n');
    this.textfx.show('credits', text, '', { states: ['epilogue'] });
  },
});
