// Game：過場動畫劇場（標題的「過場動畫」）：依周目與抉擇列出所有過場動畫（序章、各章的開場／章末、抉擇演出），
// 播放時有控制列（暫停、上一鏡／下一鏡、±5 秒、時間軸拖曳、結束），方便檢視內容。不寫存檔、不看「劇情動畫」設定。
// 抉擇的選前演出原本在目前的戰場上播（live），劇場改在那個抉擇的地圖上擺主角與出口（cineStandIn）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { CHOICES } from '../data/campaign.js';
import { CINES } from '../data/cine/index.js';
import { FACTIONS } from '../data/story.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const NUM = ['', '一', '二', '三', '四', '五', '六'];
// 選前演出代替戰場的地圖（抉擇區段的主題；高空軌道是懸空的平台，擺不好主角，改用荒野）
const STAND = { c2: 'dam', c4: 'spaceport', c6: 'wasteland' };
const fmt = (t) => {
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`;
};

Object.assign(Game.prototype, {
  openCineLib() {
    SFX.ui();
    this.state = 'cinelib';
    this.showScreen('cineLib');
    this.cineLibInit();
    this.cineLibList();
  },
  // 選單（周目、三個抉擇）與鍵盤：第一次開啟時建立
  cineLibInit() {
    if (this.clib) return;
    const L = (this.clib = { cycle: 1, choices: {}, auto: false });
    let html = `<label>周目 <select id="clCycle">${[1, 2, 3]
      .map((c) => `<option value="${c}">第 ${c} 周目</option>`)
      .join('')}</select></label>`;
    for (const id of Object.keys(CHOICES)) {
      L.choices[id] = CHOICES[id].opts[0].key;
      html += `<label>${escHtml(CHOICES[id].name.split('：')[0])} <select data-ch="${id}">${CHOICES[id].opts
        .map((o) => `<option value="${o.key}">${escHtml(o.name)}</option>`)
        .join('')}</select></label>`;
    }
    html += '<label><input type="checkbox" id="clAuto" /> 連續播放</label>';
    $('clOpts').innerHTML = html;
    $('clCycle').onchange = (e) => {
      L.cycle = +e.target.value;
      this.cineLibList();
    };
    for (const sel of $('clOpts').querySelectorAll('select[data-ch]'))
      sel.onchange = (e) => {
        L.choices[sel.dataset.ch] = e.target.value;
        this.cineLibList();
      };
    $('clAuto').onchange = (e) => (L.auto = e.target.checked);
    $('btnClBack').onclick = () => {
      SFX.ui('back');
      this.state = 'title';
      this.showScreen('title');
    };
    // 控制列
    $('clPrev').onclick = () => this.cineLibShot(-1);
    $('clNext').onclick = () => this.cineLibShot(1);
    $('clBack5').onclick = () => this.cine && this.cineLibSeek(this.cine.t - 5);
    $('clFwd5').onclick = () => this.cine && this.cineLibSeek(this.cine.t + 5);
    $('clPause').onclick = () => this.cineLibPause();
    $('clStop').onclick = () => this.cine && this.cineEnd(true);
    $('clBar').oninput = (e) => this.cine && this.cineLibSeek(+e.target.value);
    // 控制列上的操作不算「長按畫面略過」
    $('cineCtl').addEventListener('pointerdown', (e) => e.stopPropagation());
    addEventListener('keydown', (e) => {
      const c = this.cine;
      if (!c || !c.lib || e.repeat) return;
      if (e.code === 'Space' || e.code === 'KeyP') this.cineLibPause();
      else if (e.code === 'ArrowLeft') this.cineLibShot(e.shiftKey ? -1 : 0, e.shiftKey ? 0 : -5);
      else if (e.code === 'ArrowRight') this.cineLibShot(e.shiftKey ? 1 : 0, e.shiftKey ? 0 : 5);
      else if (e.code === 'PageUp' || e.code === 'BracketLeft') this.cineLibShot(-1);
      else if (e.code === 'PageDown' || e.code === 'BracketRight') this.cineLibShot(1);
      else if (e.code === 'KeyH') $('cineCtl').classList.toggle('hide');
      else return;
      e.preventDefault();
    });
  },
  // 目前周目與抉擇的清單：[{ k, ctx, title, sub, stand }]
  cineLibItems() {
    const L = this.clib;
    const cyc = L.cycle;
    const choices = { ...L.choices };
    const out = [];
    const story = (k, group) => {
      const it = this.storyItem(k);
      if (CINES[k])
        out.push({ k, group, ctx: { cycle: cyc, choices }, title: it ? it.title : k, sub: it && it.sub });
    };
    // 抉擇演出的選項（和 campChoiceCine 相同的格式；c6 的第三個選項從那個周目起才有）
    const opts = (id) =>
      CHOICES[id].opts
        .filter((o) => !o.cycle || cyc >= o.cycle)
        .map((q) => {
          const F = FACTIONS[q.faction] || {};
          return {
            name: q.name,
            sub: F.name || '',
            color: F.color || '#ffffff',
            hex: parseInt((F.color || '#ffffff').slice(1), 16),
          };
        });
    const choice = (id) => {
      const CH = CHOICES[id];
      if (CINES[`x_${id}_pre`])
        out.push({
          k: `x_${id}_pre`,
          group: '抉擇演出',
          ctx: { cycle: cyc, choices, opts: opts(id) },
          title: `${CH.name}　選前`,
          sub: '原本在目前的戰場上播；劇場改用代替的地圖',
          stand: STAND[id],
        });
      for (const o of CH.opts)
        if (CINES[`x_${id}_${o.key}`])
          out.push({
            k: `x_${id}_${o.key}`,
            group: '抉擇演出',
            ctx: { cycle: cyc, choices: { ...choices, [id]: o.key } },
            title: `${CH.name}　選後：${o.name}`,
            sub: o.cycle ? `第 ${o.cycle} 周目起` : '',
          });
    };
    story('p' + cyc, '序章');
    for (let ch = 1; ch <= 6; ch++) {
      const g = `第${NUM[ch]}章`;
      story(`i${cyc}_${ch}`, g);
      if (ch === 2 || ch === 4 || ch === 6) {
        const n = out.length;
        choice('c' + ch);
        for (let i = n; i < out.length; i++) out[i].group = g;
      }
      story(`o${cyc}_${ch}`, g);
    }
    return out;
  },
  cineLibList() {
    const items = (this.clibItems = this.cineLibItems());
    let html = '',
      grp = '';
    items.forEach((it, i) => {
      const def = CINES[it.k](it.ctx);
      it.dur = def ? def.dur : 0;
      it.n = def ? def.shots.length : 0;
      if (it.group !== grp) {
        grp = it.group;
        html += `<h3>${escHtml(grp)}</h3>`;
      }
      html += `<button class="clItem" data-i="${i}"><b>${escHtml(it.title)}</b><span class="dim">${escHtml(
        it.sub || '',
      )}</span><i>${it.n} 鏡　${fmt(it.dur)}　<code>${it.k}</code></i></button>`;
    });
    const el = $('clList');
    el.innerHTML = html;
    for (const b of el.querySelectorAll('.clItem')) b.onclick = () => this.cineLibPlay(+b.dataset.i);
    const last = this.clibLast != null && el.querySelector(`.clItem[data-i="${this.clibLast}"]`);
    if (last) last.scrollIntoView({ block: 'center' });
  },
  cineLibPlay(i) {
    const it = this.clibItems[i];
    if (!it) return this.openCineLib();
    this.clibLast = i;
    SFX.ui();
    this.cinePlay(
      it.k,
      (skipped) => {
        if (!skipped && this.clib.auto && i + 1 < this.clibItems.length) return this.cineLibPlay(i + 1);
        this.openCineLib();
      },
      { ctx: it.ctx, lib: true, stand: it.stand },
    );
  },
  // 播放開始時：控制列的標題
  cineLibUi(c) {
    if (!c.lib) return;
    $('cineScr').classList.add('lib');
    $('cineCtl').classList.add('on');
    const it = this.clibItems && this.clibItems[this.clibLast];
    $('clTitle').textContent = it ? it.title : c.key;
    const bar = $('clBar');
    bar.max = c.def.dur;
    bar.value = 0;
    $('clPause').textContent = '❚❚';
    c.ctlT = -1;
  },
  // 每格（cineTick）：時間、鏡頭編號、時間軸（拖曳中不改）
  cineLibTick(c) {
    if (Math.abs(c.t - c.ctlT) < 0.1 && !c.paused) return;
    c.ctlT = c.t;
    const n = c.def.shots.length;
    $('clTime').textContent = `鏡頭 ${c.shot + 1}／${n}　${fmt(Math.max(0, c.t))}／${fmt(c.def.dur)}`;
    const bar = $('clBar');
    if (document.activeElement !== bar) bar.value = c.t;
  },
  cineLibSeek(t) {
    const c = this.cine;
    if (!c || !c.started) return;
    this.cineSeek(Math.max(0, Math.min(c.def.dur - 0.05, t)));
    if (c.paused) SFX.musicStop(0.05);
  },
  // d＝跳幾個鏡頭（0＝只依 dt 秒），從目前這一鏡的開頭算；上一鏡在這一鏡開始 1 秒內按時跳到前一鏡
  cineLibShot(d, dt = 0) {
    const c = this.cine;
    if (!c || !c.started) return;
    if (!d) return this.cineLibSeek(c.t + dt);
    const sh = c.def.shots;
    let si = Math.max(0, c.shot);
    if (d < 0 && c.t - sh[si].at > 1) d = 0;
    si = Math.max(0, Math.min(sh.length - 1, si + d));
    this.cineLibSeek(sh[si].at + 0.01);
  },
  cineLibPause() {
    const c = this.cine;
    if (!c || !c.started) return;
    c.paused = !c.paused;
    $('clPause').textContent = c.paused ? '▶' : '❚❚';
    if (c.paused) {
      SFX.musicStop(0.1);
      c.music = [];
    } else this.cineStartClock(c.t);
  },
  // 選前演出的代替戰場：主角站在原點面向 −Z，出口在前方排開（和戰場上的出口一樣的光環）
  cineStandIn(c, set) {
    const A = this.cineAddActor({ id: 'player', k: 'hero', p: [0, 0], yaw: 0 }, 0);
    if (A && A.e) A.e.fpFace = false;
    const opts = (c.def.shots[0] && c.def.shots[0].opts) || [];
    const n = opts.length;
    set.exits = opts.map((o, i) => {
      const pos = this.cinePt({ g: [(i - (n - 1) / 2) * 16, -34] });
      const g = this.campRing(pos, o.color || '#ffffff', o.name, o.sub, 5);
      set.extra.push(g);
      return { pos };
    });
  },
});
