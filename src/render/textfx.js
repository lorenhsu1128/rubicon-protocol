// 文字演出：直接使用子專案「文字動畫 APNG 產生器」（rubicon_apng_gen）的模板與動畫引擎
//  - CUES：遊戲裡的時機 → 產生器的模板（模式＋模板 id，和產生器畫面上的模板按鈕相同）＋遊戲用的修改
//  - TextFx：在全螢幕的疊加畫布（橫幅、中央訊息、全畫面）或 DOM 元素裡的畫布播放
//  - revealDom：多行的 DOM 文字（簡報、結局、轉場說明）照預告模板的參數逐字出現（保留版面與捲動）
// 引擎每個字各自畫、有模糊與光暈，所以「顯示中」沒有動作時重複使用畫好的畫面

import { applyTemplate, findTemplate, STYLE_PRESETS } from '../../rubicon_apng_gen/js/presets.js';
import { createScene, envelope, Renderer } from '../../rubicon_apng_gen/js/engine/render.js';
import { clearMeasureCache } from '../../rubicon_apng_gen/js/engine/layout.js';
import * as Fonts from '../../rubicon_apng_gen/js/fonts.js';
import { merge } from '../../rubicon_apng_gen/js/util.js';

const preset = (id) => (STYLE_PRESETS.find((p) => p.id === id) || {}).patch || {};

// slot：banner（上方橫幅，排隊）／msg（中央訊息，新的取代舊的）／full（全畫面，排隊）
// hd：畫布高度對應的模板像素（越大字越小）；size：再乘的字級
export const CUES = {
  // ---- 提案 1：戰鬥演出 ----
  start: { mode: 'message', tpl: 'battle', slot: 'banner', hd: 330 },
  seg: { mode: 'caption', tpl: 'cinema', slot: 'banner', hd: 300, patch: { anchor: 'mc', align: 'center' } },
  warning: { mode: 'message', tpl: 'emergency', slot: 'banner', hd: 330 },
  phase: { mode: 'message', tpl: 'evaBerserk', slot: 'banner', hd: 400 },
  enrage: { mode: 'message', tpl: 'evaLimit', slot: 'banner', hd: 330, patch: { loop: 'once' } },
  ace: { mode: 'message', tpl: 'incident', slot: 'banner', hd: 330 },
  lastwave: { mode: 'message', tpl: 'evaAngel', slot: 'banner', hd: 330 },
  clear: { mode: 'message', tpl: 'battleEnd', slot: 'banner', hd: 330, patch: preset('silver') },
  kill: { mode: 'message', tpl: 'victory', slot: 'banner', hd: 360, patch: { loop: 'once' } },
  done: { mode: 'message', tpl: 'missionClear', slot: 'banner', hd: 360 },
  // ---- 提案 2：中央訊息的種類 ----
  info: { mode: 'message', tpl: 'simple', slot: 'msg', hd: 260 },
  good: {
    mode: 'message',
    tpl: 'coc7Regular',
    slot: 'msg',
    hd: 300,
    patch: { ...preset('gold'), loop: 'once' },
  },
  warn: { mode: 'message', tpl: 'incident', slot: 'msg', hd: 300 },
  sys: { mode: 'message', tpl: 'newMessage', slot: 'msg', hd: 230, patch: { loop: 'once' } },
  echo: {
    mode: 'message',
    tpl: 'coc7San',
    slot: 'msg',
    hd: 300,
    patch: { fontId: 'noto-sans-tc', weight: 700, subFontId: 'share-tech-mono', loop: 'once' },
  },
  // ---- 提案 3：主線的敘事 ----
  choice: { mode: 'message', tpl: 'evaMagi', slot: 'banner', hd: 300, patch: { loop: 'once' } },
  // 回憶：背景改成全畫面的暗色（原本的暗角蓋在結果畫面上看不清楚）
  memory: {
    mode: 'message',
    tpl: 'flashback',
    slot: 'full',
    hd: 720,
    patch: { bg: { type: 'solid', color: '#120c06', opacity: 0.82, sync: true } },
  },
  chapter: {
    mode: 'message',
    tpl: 'chapter',
    slot: 'full',
    hd: 720,
    patch: { bg: { type: 'solid', color: '#000000', opacity: 0.9, sync: true } },
  },
  cycle: {
    mode: 'message',
    tpl: 'timeSkip',
    slot: 'full',
    hd: 720,
    patch: { bg: { type: 'solid', color: '#000000', opacity: 0.72, sync: true } },
  },
  credits: {
    mode: 'trailer',
    tpl: 'credits',
    slot: 'full',
    hd: 720,
    patch: { bg: { type: 'solid', color: '#000000', opacity: 0.9, sync: false } },
  },
  // ---- DOM 裡的標題（播完停在完成的畫面）----
  transTitle: { mode: 'caption', tpl: 'cinema', hd: 200, patch: { anchor: 'mc', align: 'center' } },
  resClear: { mode: 'message', tpl: 'missionClear', hd: 260 },
  resWin: { mode: 'message', tpl: 'victory', hd: 260, patch: { loop: 'once' } },
  resFail: { mode: 'message', tpl: 'defeat', hd: 260 },
  rankS: { mode: 'message', tpl: 'coc7Critical', hd: 240, patch: { loop: 'once' } },
  rankA: { mode: 'message', tpl: 'coc7Regular', hd: 240, patch: { loop: 'once' } },
  rankD: { mode: 'message', tpl: 'coc7Failure', hd: 240, patch: { loop: 'once' } },
  epTitle: { mode: 'message', tpl: 'epilogue', hd: 300 },
};

// 預告模板（DOM 逐字）：簡報、ECHO 的簡報、轉場說明、結局、真結局的結尾
export const REVEALS = {
  brief: {
    tpl: 'syslog',
    patch: { fill: { color: '#f5fbff' }, glow: { color: '#18b4ff' }, cursorColor: '#7fd8ff' },
  },
  briefEcho: { tpl: 'syslog', glitch: true },
  trans: { tpl: 'typewriter', patch: { fontId: 'share-tech-mono', cps: 30 } },
  ending: { tpl: 'cinematic' },
  coda: { tpl: 'sweep', patch: preset('ghost') },
  // 通訊框：只用打字機的逐字，字型與顏色維持通訊框原本的
  comm: { tpl: 'typewriter', patch: { cps: 26, fontId: 'noto-sans-tc', fill: { color: '#e6edf3' } } },
};

// 遊戲用的設計：模板＋修改；文字由呼叫端給（沒給副字時用模板的副字）
export function cueState(id, main, sub) {
  const c = CUES[id];
  const tpl = findTemplate(c.mode, c.tpl);
  const s = applyTemplate(c.mode, tpl);
  if (c.patch) merge(s, c.patch);
  s.text = main;
  s.subText = sub == null ? s.subText : sub;
  return s;
}
export function revealState(id) {
  const r = REVEALS[id];
  const s = applyTemplate('trailer', findTemplate('trailer', r.tpl));
  if (r.patch) merge(s, r.patch);
  return s;
}

// 畫布尺寸改變時，模板的像素參數一起縮放
function scaleState(s, K) {
  const m = (o, k) => o && typeof o[k] === 'number' && (o[k] *= K);
  for (const k of ['fontSize', 'marginX', 'marginY', 'offsetX', 'offsetY', 'scrollSpeed']) m(s, k);
  m(s.stroke, 'width');
  m(s.stroke2, 'width');
  for (const k of ['blur', 'x', 'y']) m(s.shadow, k);
  m(s.glow, 'size');
  for (const k of ['thickness', 'tapeSize', 'tapeSpeed']) m(s.deco, k);
}

// 簡化：不畫光暈、陰影不模糊、模糊類的動畫換成淡入淡出、顯示中不動（解析度另外降低）
const SIMPLE_IN = { blurIn: 'fade', emerge: 'rise' };
const SIMPLE_OUT = { blurOut: 'fade' };
function simplify(s) {
  s.glow.on = false;
  s.shadow.blur = Math.min(s.shadow.blur, 4);
  s.inFx = SIMPLE_IN[s.inFx] || s.inFx;
  s.outFx = SIMPLE_OUT[s.outFx] || s.outFx;
  if (s.holdFx === 'glow' || s.holdFx === 'glitch') s.holdFx = 'none';
}

// 字型：模板用的字型（含後備）下載好再排版；最多等 0.7 秒，之後先用系統字型
const FONT_WAIT = 700;
function fontsFor(s) {
  const jobs = [Fonts.ensure(s.fontId, s.weight, s.text || ' ')];
  if (s.subText && s.mode !== 'trailer')
    jobs.push(Fonts.ensure(s.subFontId === 'same' ? s.fontId : s.subFontId, s.subWeight, s.subText));
  return Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, FONT_WAIT))]).then(() =>
    clearMeasureCache(),
  );
}
// 開場時先下載各模板的字型（只載入用得到的字元切片）
export function preloadFonts() {
  const seen = new Set();
  const all = Object.keys(CUES).map((k) => cueState(k, '作戰開始區段清除擊破抉擇第周目章任務完成失敗'));
  for (const k of Object.keys(REVEALS)) all.push(revealState(k));
  for (const s of all)
    for (const [id, w] of [
      [s.fontId, s.weight],
      [s.subFontId === 'same' ? s.fontId : s.subFontId, s.subWeight],
    ]) {
      const key = id + '|' + w;
      if (seen.has(key)) continue;
      seen.add(key);
      Fonts.ensure(id, w, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789／—').catch(() => {});
    }
}
export const fontStack = (id) => Fonts.familyStack(id);

// 疊加畫布上各區的位置（CSS 像素）
function slotRect(slot, W, H, banner) {
  if (slot === 'banner') {
    const h = Math.round(H * (H < 540 ? 0.34 : 0.3));
    return { x: 0, y: Math.round(H * 0.22 - h / 2), w: W, h };
  }
  if (slot === 'msg') {
    const h = Math.round(H * (H < 540 ? 0.17 : 0.14));
    return { x: 0, y: Math.round(H * (banner ? 0.68 : 0.3) - h / 2), w: W, h };
  }
  return { x: 0, y: 0, w: W, h: H };
}

export class TextFx {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.items = []; // 疊加畫布上的
    this.hosts = new Map(); // DOM 元素 → 項目
    this.pool = {}; // 各區共用的描繪器
    this.mode = 'full';
    this.W = 0;
    this.H = 0;
  }
  get on() {
    return this.mode !== 'off';
  }
  quality() {
    return (this.mode === 'simple' ? 0.6 : 1) * Math.min(devicePixelRatio || 1, 1.5);
  }
  // 建立一個項目：opt { states（只在這些遊戲狀態播放）, hold（顯示秒數）, fit（整體秒數上限，中央訊息用）, host }
  make(cue, main, sub, opt = {}) {
    const s = cueState(cue, String(main), sub == null ? null : String(sub));
    if (opt.hold != null) s.hold = opt.hold;
    if (opt.noExit) s.outEnabled = false;
    if (opt.patch) merge(s, opt.patch);
    if (this.mode === 'simple') simplify(s);
    // 中央訊息：登場＋顯示＋退場塞進給的秒數
    if (opt.fit) {
      const io = (s.inEnabled ? s.inDur : 0) + (s.outEnabled ? s.outDur : 0);
      const k = Math.min(1, (opt.fit * 0.6) / Math.max(0.01, io));
      s.inDur *= k;
      s.outDur *= k;
      s.inStagger *= k;
      s.hold = Math.max(0.3, opt.fit - io * k - 0.1);
      s.startDelay = 0;
      s.endDelay = 0;
    }
    const it = { cue, s, t: 0, scene: null, ready: false, wait: 0, slot: CUES[cue].slot, opt, key: '' };
    fontsFor(s).then(() => (it.ready = true));
    return it;
  }
  show(cue, main, sub, opt = {}) {
    if (!this.on) return null;
    const it = this.make(cue, main, sub, opt);
    const same = this.items.filter((x) => x.slot === it.slot);
    if (it.slot === 'msg') this.items = this.items.filter((x) => x.slot !== 'msg');
    else {
      // 排隊：正在播的那個直接進入退場；最多排 3 個
      const cur = same[0];
      if (cur) cur.cut = true;
      if (same.length >= 3) this.items.splice(this.items.indexOf(same[same.length - 1]), 1);
    }
    this.items.push(it);
    return it;
  }
  // DOM 元素裡的標題：元素的文字保留（變透明），畫布疊在上面
  host(el, cue, main, sub, opt = {}) {
    if (!el) return null;
    this.unhost(el);
    if (!this.on) return null;
    const it = this.make(cue, main, sub, { noExit: true, ...opt });
    let cv = el.querySelector(':scope > canvas.tfxC');
    if (!cv) {
      cv = document.createElement('canvas');
      cv.className = 'tfxC';
      el.appendChild(cv);
    }
    el.classList.add('tfxHost');
    it.el = el;
    it.cv = cv;
    it.renderer = new Renderer(cv);
    this.hosts.set(el, it);
    return it;
  }
  unhost(el) {
    const it = this.hosts.get(el);
    if (!it) return;
    this.hosts.delete(el);
    el.classList.remove('tfxHost');
    if (it.cv) it.cv.remove();
  }
  clear(pred = () => true) {
    this.items = this.items.filter((x) => !pred(x));
  }
  // 設計尺寸 → 實際畫布：依畫布高度縮放模板的像素參數
  build(it, w, h) {
    const q = this.quality();
    const Wp = Math.max(8, Math.round(w * q)),
      Hp = Math.max(8, Math.round(h * q));
    const s = JSON.parse(JSON.stringify(it.s));
    s.width = Wp;
    s.height = Hp;
    scaleState(s, (Hp / CUES[it.cue].hd) * (CUES[it.cue].size || 1));
    it.scene = createScene(s);
    it.key = Wp + 'x' + Hp;
    it.dur = it.scene.timeline.duration;
    it.drawnHold = false;
  }
  // 顯示中沒有動作（不閃、不晃、沒有膠帶、沒有游標）時，畫一次就重複使用
  staticAt(it, t) {
    const s = it.scene.state;
    if (s.holdFx !== 'none' || s.deco.type === 'tape' || s.mode === 'trailer') return false;
    const pt = it.scene.timeline.pageTimes[0];
    return t >= pt.holdStart + 0.05 && t < pt.holdEnd;
  }
  frame(it, renderer, dt) {
    if (!it.ready) {
      it.wait += dt;
      return false;
    }
    // 後面有排隊的：顯示 0.4 秒後直接退場
    if (it.cut && it.scene) {
      const pt = it.scene.timeline.pageTimes[0];
      if (it.t >= pt.holdStart + 0.4) {
        it.t = Math.max(it.t, pt.holdEnd);
        it.cut = false;
      }
    }
    it.t += dt;
    const end = it.dur != null && it.t >= it.dur;
    if (end && !it.s.outEnabled) it.t = it.dur - 0.001; // 沒有退場：停在完成的畫面
    if (this.staticAt(it, it.t) && it.drawnHold && renderer.last === it) return true;
    if (end && !it.s.outEnabled && it.drawnEnd && renderer.last === it) return true;
    renderer.render(it.scene, Math.min(it.t, it.dur - 0.001));
    renderer.last = it;
    if (this.staticAt(it, it.t)) it.drawnHold = true;
    if (end) it.drawnEnd = true;
    return true;
  }
  // 任務中的橫幅與訊息：模板沒有底色的（框線、兩側線、沒有裝飾）在亮的地圖上看不清楚，
  // 墊一條兩端淡出的暗色帶（跟著文字淡入淡出）
  backdrop(it, r, dpr) {
    const d = it.scene.state.deco;
    if ((d.type === 'band' || d.type === 'box') && d.opacity > 0.3) return;
    const a = 0.42 * envelope(it.scene, Math.min(it.t, it.dur - 0.001));
    if (a <= 0.01) return;
    // 色帶畫在自己的小畫布（兩端淡出要用 destination-out，不能直接在疊加畫布上做）
    const w = Math.round(r.w * dpr),
      h = Math.round(r.h * 0.76 * dpr);
    this.bd = this.bd || {};
    const key = w + 'x' + h;
    let b = this.bd[key];
    if (!b) {
      if (Object.keys(this.bd).length > 6) this.bd = {};
      b = this.bd[key] = document.createElement('canvas');
      b.width = w;
      b.height = h;
      const g = b.getContext('2d');
      const gv = g.createLinearGradient(0, 0, 0, h);
      gv.addColorStop(0, 'rgba(0,0,0,0)');
      gv.addColorStop(0.25, 'rgba(0,0,0,1)');
      gv.addColorStop(0.75, 'rgba(0,0,0,1)');
      gv.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gv;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'destination-out';
      const gu = g.createLinearGradient(0, 0, w, 0);
      gu.addColorStop(0, 'rgba(0,0,0,1)');
      gu.addColorStop(0.22, 'rgba(0,0,0,0)');
      gu.addColorStop(0.78, 'rgba(0,0,0,0)');
      gu.addColorStop(1, 'rgba(0,0,0,1)');
      g.fillStyle = gu;
      g.fillRect(0, 0, w, h);
    }
    const c = this.ctx;
    c.save();
    c.globalAlpha = a;
    c.drawImage(b, r.x * dpr, (r.y + r.h * 0.12) * dpr);
    c.restore();
  }
  // 每格：states 是目前的遊戲狀態；任務中的項目在暫停時凍結
  tick(dt, state) {
    const dpr = devicePixelRatio || 1;
    const W = innerWidth,
      H = innerHeight;
    if (this.cv.width !== Math.round(W * dpr) || this.cv.height !== Math.round(H * dpr)) {
      this.cv.width = Math.round(W * dpr);
      this.cv.height = Math.round(H * dpr);
    }
    const c = this.ctx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.cv.width, this.cv.height);
    // 不在指定狀態：任務中的凍結，其他的移除
    this.items = this.items.filter((it) => {
      const st = it.opt.states;
      return !st || st.includes(state) || (it.opt.freeze && it.opt.freeze.includes(state));
    });
    const busy = {};
    const banner = this.items.some(
      (x) => x.slot === 'banner' && x.scene && (!x.opt.states || x.opt.states.includes(state)),
    );
    for (const it of this.items.slice()) {
      const st = it.opt.states;
      if (st && !st.includes(state)) continue;
      if (busy[it.slot] && it.slot !== 'msg') continue; // 排隊中
      busy[it.slot] = true;
      const r = slotRect(it.slot, W, H, banner);
      const key = Math.round(r.w * this.quality()) + 'x' + Math.round(r.h * this.quality());
      if (it.ready && (!it.scene || it.key !== key)) this.build(it, r.w, r.h);
      const R = (this.pool[it.slot] = this.pool[it.slot] || new Renderer(document.createElement('canvas')));
      if (!this.frame(it, R, dt)) continue;
      if (it.t >= it.dur) {
        this.items.splice(this.items.indexOf(it), 1);
        if (it.opt.onEnd) it.opt.onEnd();
        continue;
      }
      if (it.slot !== 'full') this.backdrop(it, r, dpr);
      c.drawImage(R.canvas, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr);
    }
    // DOM 裡的標題
    for (const [el, it] of this.hosts) {
      if (!el.isConnected) {
        this.hosts.delete(el);
        continue;
      }
      if (!el.offsetParent) continue;
      const w = el.clientWidth,
        h = el.clientHeight;
      if (!w || !h) continue;
      const key = Math.round(w * this.quality()) + 'x' + Math.round(h * this.quality());
      if (it.ready && (!it.scene || it.key !== key)) this.build(it, w, h);
      this.frame(it, it.renderer, dt);
    }
  }
}

// ---------- DOM 逐字（預告模板的參數：速度、標點與換行停頓、登場效果、字型、顏色、光暈、游標）----------
const CSS_FX = { typewriter: 'tqType', blurIn: 'tqBlur', emerge: 'tqBlur', rise: 'tqRise', fade: 'tqFade' };
const PUNCT = new Set('、。，．,.！？!?…‥：；');
// 回傳整段播完的秒數；el 的每個區塊元素（p）是一行。opt.limit：最多花幾秒（太長時加快）
export function revealDom(el, id, opt = {}) {
  const s = revealState(id);
  const R = REVEALS[id];
  el.classList.remove('tqDone');
  el.classList.add('tq');
  el.classList.toggle('tqGlitch', !!R.glitch);
  el.style.fontFamily = Fonts.familyStack(s.fontId);
  const fill = s.fill.type === 'gradient' ? s.fill.color2 : s.fill.color;
  el.style.setProperty('--tq-c', fill);
  el.style.setProperty('--tq-op', s.fillOpacity);
  el.style.setProperty('--tq-glow', s.glow.on ? s.glow.color : 'transparent');
  el.style.setProperty('--tq-cur', s.cursorColor || fill);
  const rows = [...el.children].filter((c) => c.textContent.trim());
  const total = rows.reduce((a, r) => a + r.textContent.length, 0);
  let cps = s.cps;
  if (opt.limit && total / cps > opt.limit) cps = total / opt.limit;
  const k = s.cps / cps;
  const anim = CSS_FX[s.inFx] || 'tqFade';
  const dur = s.inFx === 'typewriter' ? 0.01 : s.glyphDur;
  let t = opt.delay || 0,
    end = t;
  rows.forEach((row, li) => {
    const text = row.textContent;
    row.textContent = '';
    const chars = [...text];
    chars.forEach((ch, ci) => {
      const sp = document.createElement('span');
      sp.className = 'tqc';
      sp.textContent = ch;
      let d;
      if (s.reveal === 'sweep')
        d = (opt.delay || 0) + li * s.lineInterval * k + (ci / chars.length) * s.sweepDur * k;
      else if (s.reveal === 'line') d = (opt.delay || 0) + li * s.lineInterval * k;
      else {
        d = t;
        t += 1 / cps;
        if (PUNCT.has(ch)) t += s.punctPause * k;
      }
      sp.style.animation = `${anim} ${dur}s ${d.toFixed(3)}s both`;
      row.appendChild(sp);
      end = Math.max(end, d + dur);
    });
    t += s.linePause * k;
  });
  // 游標：打完之後在最後一行閃爍
  if (s.cursor && rows.length) {
    const cur = document.createElement('i');
    cur.className = 'tqCur';
    cur.style.animationDelay = `${end.toFixed(2)}s`;
    rows[rows.length - 1].appendChild(cur);
  }
  return end;
}
// 跳過：全部直接顯示
export function revealFinish(el) {
  if (el && el.classList.contains('tq')) el.classList.add('tqDone');
}
