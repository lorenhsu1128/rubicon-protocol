// Game：過關條件——每個回合（自由出擊的任務、主線的每個區段、自訂關卡的每一段、模擬戰）開始時，
// 畫面中央上方顯示「過關條件／失敗條件」卡片幾秒，之後左上的任務資訊一直顯示一行過關條件。
// 房主、單機與客機各自依手上的資料產生（客機：主線用快照的 campC.view、自訂關卡用收到的關卡），不用同步。
import { escHtml } from '../core/html.js';
import { SEG_TYPES } from '../data/campaign.js';
import { Game } from './game.js';

const GOAL_DELAY = 2.6; // 開場橫幅退場之後才出現（自訂關卡的開場觸發器也已經設好目標文字）
const GOAL_SHOW = 6; // 卡片顯示的秒數

const hasEv = (L, k) => L.triggers.some((t) => t.ev.k === k);
const hasAct = (L, k) => L.triggers.some((t) => t.act.some((a) => a.k === k));

Object.assign(Game.prototype, {
  // 回合開始時呼叫：等一下再算條件並顯示卡片
  goalIntro() {
    this.goalCur = null;
    this.goalT = -GOAL_DELAY;
    const el = document.getElementById('goalCard');
    if (el) el.classList.remove('on');
  },
  // 過關條件：{ sub 這一回合, win [過關], lose [失敗] }；PvP、靶場、實驗室沒有
  goalSpec() {
    if (this.pvp || this.range || this.lab) return null;
    const mp = (this.players || []).length > 1;
    const down = mp ? '全員被擊破' : '機體被擊破';
    const bossNames = () => {
      const n = (this.bosses || []).filter((b) => !b.dead && b.ai !== 'part').map((b) => b.name);
      if (!n.length && this.bossDef && this.bossDef.name) n.push(this.bossDef.name);
      return [...new Set(n)].join('、');
    };
    // 自訂關卡
    if (this.lv && this.lv.L) {
      const L = this.lv.L,
        st = this.lv.st || {};
      const win = [],
        lose = [];
      const cv = L.units.some((u) => u.kind === 'convoy');
      // 觸發器設定的目標文字放第一行（例如先清除守衛、出口才開）
      if (st.obj) win.push(st.obj);
      else if (hasAct(L, 'win') || hasAct(L, 'next')) win.push('達成關卡的目標');
      if (L.marks.some((m) => m.k === 'exit') && !hasEv(L, 'exit'))
        win.push(Object.keys(st.exits || {}).length ? '走進出口（站進光環）' : '出口開啟後走進出口');
      if (cv && !hasEv(L, 'convoy') && !hasAct(L, 'win')) win.push('護送車輛抵達終點');
      if (!hasAct(L, 'win') && !hasAct(L, 'next') && !L.marks.some((m) => m.k === 'exit') && !cv)
        win.push('擊破所有敵軍');
      if (!win.length) win.push('達成關卡的目標');
      if (L.marks.some((m) => m.k === 'defend') && !hasEv(L, 'defend')) lose.push('防衛目標被摧毀');
      if (cv && !hasEv(L, 'gdead') && !hasAct(L, 'lose')) lose.push('護送車輛全毀');
      if (hasAct(L, 'timer')) lose.push('倒數歸零');
      if (hasAct(L, 'lose')) lose.push('關卡指定的失敗條件');
      lose.push(down);
      return { sub: this.levelName, win, lose };
    }
    // 主線的區段（房主／單機用 campView，客機用快照的同一份）
    const v = this.camp ? this.campView() : this.campC && this.campC.view;
    if (v) {
      const type = v.type || 'battle',
        T = SEG_TYPES[type] || SEG_TYPES.battle;
      const last = v.seg + 1 >= v.n;
      const exit = last ? '' : '，再走進出口前往下一段';
      const win = [],
        lose = [];
      if (type === 'battle') win.push('擊破所有敵軍（含增援）' + exit);
      else if (type === 'elite') win.push('擊破敵對 AC' + exit);
      else if (type === 'destroy') win.push('摧毀所有目標設施與敵軍' + exit);
      else if (type === 'defend') {
        win.push('守住防衛目標，擊破所有敵軍' + exit);
        lose.push('防衛目標被摧毀');
      } else if (type === 'escort') {
        win.push('護送車隊沿公路抵達終點' + exit);
        lose.push('車隊全毀');
      } else if (type === 'breakthrough') win.push('突破敵陣，走進出口（不必全滅敵軍）');
      else if (type === 'supply') win.push('（可選）使用補給台，之後走進出口出發');
      else if (type === 'intel') win.push('站在資料終端下載情報，並擊破所有敵軍' + exit);
      else if (type === 'boss') {
        const n = bossNames();
        win.push(`擊破 ${n || 'Boss'}` + (last ? '' : exit));
      } else win.push(T.goal + exit);
      if (this.camp && this.camp.heat && this.camp.heat.timed) lose.push('出擊超過 25 分鐘（危險條款）');
      lose.push(down);
      return { sub: `區段 ${v.seg + 1}／${v.n}【${T.name}】${v.name || ''}`, win, lose };
    }
    // 模擬戰
    if (this.sim) {
      const n = this.sim.kind === 'instructor' || this.sim.kind === 'ace' || this.sim.kind === 'boss';
      return {
        sub: this.levelName,
        win: [n ? `擊破 ${bossNames() || '目標'}` : '擊破所有敵軍'],
        lose: [down],
      };
    }
    // 自由出擊
    if (this.isBossLevel) {
      const n = bossNames();
      return { sub: this.levelName, win: [`擊破 ${n || 'Boss'}`], lose: [down] };
    }
    const win = ['擊破所有敵軍（增援分成數波）'];
    const opt = (this.caches || []).length ? '（可選）打開地圖上的補給箱，清除後有撤離時間回收' : '';
    return { sub: this.levelName, win, lose: [down], opt };
  },
  // 每格（hud.js）：計時、出現與收起卡片
  goalTick(dt) {
    if (this.goalT === undefined || this.goalT === null) return;
    if (this.state !== 'play') return;
    this.goalT += dt;
    let el = document.getElementById('goalCard');
    if (this.goalT >= 0 && !this.goalCur) {
      this.goalCur = this.goalSpec();
      if (!this.goalCur) {
        this.goalT = null;
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = 'goalCard';
        document.getElementById('hudWrap').appendChild(el);
      }
      const g = this.goalCur;
      el.innerHTML =
        `<div class="gcH">過關條件</div><div class="gcSub">${escHtml(g.sub || '')}</div>` +
        `<ul class="gcWin">${g.win.map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>` +
        (g.opt ? `<div class="gcOpt">${escHtml(g.opt)}</div>` : '') +
        `<div class="gcH2">失敗條件</div><ul class="gcLose">${g.lose.map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
      el.classList.add('on');
    }
    if (el && this.goalT > GOAL_SHOW && el.classList.contains('on')) el.classList.remove('on');
  },
  // 左上任務資訊裡一直顯示的過關條件
  goalHudHtml() {
    const g = this.goalCur;
    if (!g) return '';
    return `<div class="goalLine"><span>過關</span>${escHtml(g.win.join('／'))}</div>`;
  },
  // 離開任務時清掉
  goalClear() {
    this.goalCur = null;
    this.goalT = null;
    const el = document.getElementById('goalCard');
    if (el) el.classList.remove('on');
  },
});
