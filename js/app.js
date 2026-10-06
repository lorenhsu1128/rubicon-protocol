// 應用程式本體：狀態、儲存、模板、預覽、輸出

import { el, clone, merge, setPath, getPath, formatBytes, download, clamp } from './util.js';
import * as Fonts from './fonts.js';
import { STR } from './i18n.js';
import { Panel, FX_LABELS } from './controls.js';
import { createScene, Renderer } from './engine/render.js';
import { clearMeasureCache } from './engine/layout.js';
import { defaults, TEMPLATES, MESSAGE_GROUPS, findTemplate, applyTemplate } from './presets.js';
import * as X from './exporter.js';

const STORE_KEY = 'tam.v1';
const MODES = ['message', 'trailer', 'caption'];
const BATCH_MAX = 30;
const SIZE_LIMIT = 5 * 1024 * 1024;
const $ = id => document.getElementById(id);

/* ---------- 儲存 ---------- */

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(app.store)); } catch { /* 容量滿或被封鎖：只在這次有效 */ }
  }, 300);
}

function firstTemplate(mode) { return TEMPLATES[mode][0]; }

function initialStore() {
  const raw = loadStore();
  const store = {
    mode: MODES.includes(raw.mode) ? raw.mode : 'message',
    lang: 'zh-TW',
    theme: raw.theme || '',
    tab: raw.tab || 'text',
    previewBg: raw.previewBg && raw.previewBg !== 'image' ? raw.previewBg : 'checker',
    export: merge({ fps: 24, colorMode: 'palette', poster: true, trim: false, batchFormat: 'apng' }, raw.export || {}),
    texts: raw.texts || {},
    fileNames: raw.fileNames || {},
    states: {}
  };
  for (const m of MODES) {
    const tpl = firstTemplate(m);
    const base = applyTemplate(m, tpl);
    store.states[m] = raw.states?.[m] ? merge(base, raw.states[m]) : base;
    store.states[m].mode = m;
  }
  return store;
}

/* ---------- 全域狀態 ---------- */

const app = {
  store: initialStore(),
  scene: null,
  t: 0,
  playing: true,
  last: 0,
  busy: false,
  signal: null,
  resultUrl: null,
  rebuildPending: false,
  fontToken: 0
};
const state = () => app.store.states[app.store.mode];
const str = () => STR[app.store.lang];
const Lx = v => (typeof v === 'string' ? v : v?.[app.store.lang] ?? v?.['zh-TW'] ?? '');

const renderer = new Renderer($('previewCanvas'));

/* ---------- 設定面板 ---------- */

const panel = new Panel($('settingsBody'), {
  getState: state,
  set: (path, value, opts = {}) => setValue(path, value, opts),
  patch: obj => { merge(state(), clone(obj)); changed(); },
  lang: () => app.store.lang,
  str,
  scene: () => app.scene,
  toast: msg => toast(msg),
  fontsChanged: () => panel.build()
});

function setValue(path, value, opts = {}) {
  const s = state();
  if (getPath(s, path) === value) return;
  setPath(s, path, value);
  if (path === 'text' || path === 'subText') rememberText();
  if (path === 'outEnabled' && value === false && s.loop === 'infinite' && !opts.silent) {
    toast(str().m.exitOffLoop, { label: str().m.exitOffLoopAction, run: () => { state().loop = 'once'; syncExportUI(); save(); toast(str().m.loopSetOnce); } });
  }
  changed();
}

// 訊息・預告：文字依模板記憶
function rememberText() {
  const s = state();
  if (s.mode === 'caption' || !s.template) return;
  const box = (app.store.texts[s.mode] ??= {});
  box[s.template] = { text: s.text, subText: s.subText };
}

function changed() {
  save();
  scheduleRebuild();
}

/* ---------- 場景重建 ---------- */

function scheduleRebuild() {
  if (app.rebuildPending) return;
  app.rebuildPending = true;
  requestAnimationFrame(rebuild);
}

async function rebuild() {
  app.rebuildPending = false;
  const s = state();
  const token = ++app.fontToken;
  const subFont = s.subFontId === 'same' ? s.fontId : s.subFontId;
  const status = $('fontStatus');
  const slow = setTimeout(() => { if (token === app.fontToken) { status.textContent = str().m.loadingFont; status.hidden = false; } }, 150);
  let ok = true;
  try {
    const jobs = [Fonts.ensure(s.fontId, s.weight, s.text || ' ')];
    if (s.mode !== 'trailer' && s.subText) jobs.push(Fonts.ensure(subFont, s.subWeight, s.subText));
    ok = (await Promise.all(jobs)).every(Boolean);
  } catch { ok = false; }
  clearTimeout(slow);
  if (token !== app.fontToken) return; // 之後又有新的變更
  status.hidden = ok;
  if (!ok) status.textContent = str().m.fontFailed;
  clearMeasureCache();
  app.scene = createScene(s);
  app.t = Math.min(app.t, app.scene.timeline.duration);
  panel.refresh();
  syncTransport();
  syncExportUI();
  draw();
}

/* ---------- 預覽 ---------- */

function draw() {
  if (!app.scene) return;
  renderer.render(app.scene, app.t);
  const d = app.scene.timeline.duration;
  $('timeLabel').textContent = str().timeLabel(app.t, d);
  const p = d ? app.t / d : 0;
  $('scrub').value = p;
  $('playhead').style.left = `${p * 100}%`;
}

function tick(now) {
  const dt = app.last ? (now - app.last) / 1000 : 0;
  app.last = now;
  if (app.playing && app.scene && !app.busy) {
    const d = app.scene.timeline.duration;
    app.t += Math.min(dt, 0.1);
    if (app.t >= d) {
      if ($('loopPreview').checked) app.t %= d;
      else { app.t = d; setPlaying(false); }
    }
    draw();
  }
  requestAnimationFrame(tick);
}

function setPlaying(on) {
  app.playing = on;
  const b = $('playBtn');
  b.textContent = on ? str().pause : str().play;
  b.setAttribute('aria-pressed', on);
  if (on && app.scene && app.t >= app.scene.timeline.duration) app.t = 0;
}

function syncTransport() {
  const s = state();
  const scroll = s.mode === 'trailer' && s.reveal === 'scroll';
  const ei = $('entryInput'), xi = $('exitInput');
  ei.checked = s.inEnabled; xi.checked = s.outEnabled;
  ei.disabled = scroll; xi.disabled = scroll;
  $('entryToggle').title = scroll ? str().scrollNoEntry : str().entryTitle;
  $('exitToggle').title = scroll ? str().scrollNoExit : str().exitTitle;
  $('entryToggle').classList.toggle('is-disabled', scroll);
  $('exitToggle').classList.toggle('is-disabled', scroll);
  const segs = $('timelineSegments');
  const tl = app.scene.timeline;
  segs.replaceChildren(...tl.segments.filter(x => x.end > x.start).map(x => {
    const n = el('span', { class: `seg seg-${x.type}` });
    n.style.left = `${(x.start / tl.duration) * 100}%`;
    n.style.width = `${((x.end - x.start) / tl.duration) * 100}%`;
    return n;
  }));
  const fps = app.store.export.fps;
  $('infoLine').textContent = str().info(s.width, s.height, tl.duration, fps, X.frameCount(app.scene, fps));
}

/* ---------- 模式・模板 ---------- */

function setMode(mode) {
  if (!MODES.includes(mode)) return;
  app.store.mode = mode;
  app.t = 0;
  setPlaying(true);
  save();
  renderModeTabs();
  renderTemplates();
  panel.build();
  scheduleRebuild();
}

function renderModeTabs() {
  document.querySelectorAll('.mode-tab').forEach(b => {
    const on = b.dataset.mode === app.store.mode;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on);
    const [name, desc] = str().modes[b.dataset.mode];
    b.querySelector('.mode-name').textContent = name;
    b.querySelector('.mode-desc').textContent = desc;
  });
}

function useTemplate(tpl) {
  const mode = app.store.mode;
  const cur = state();
  const next = applyTemplate(mode, tpl, { width: cur.width, height: cur.height });
  if (mode === 'caption') { next.text = cur.text; next.subText = cur.subText; }
  else {
    const saved = app.store.texts[mode]?.[tpl.id];
    if (saved) { next.text = saved.text; next.subText = saved.subText; }
  }
  app.store.states[mode] = next;
  delete app.store.fileNames[mode];
  app.t = 0;
  setPlaying(true);
  renderTemplates();
  panel.refresh();
  changed();
  toast(str().m.templateApplied(Lx(tpl.label)));
}

function renderTemplates() {
  const s = state();
  const mode = s.mode;
  $('templateHint').textContent = str().templatesHint(mode);
  const groupsNode = $('templateGroups');
  const systemsNode = $('templateSystems');
  const strip = $('templateStrip');
  const cur = findTemplate(mode, s.template);
  let list = TEMPLATES[mode];
  if (mode === 'message') {
    const gid = cur?.group || 'combat';
    const group = MESSAGE_GROUPS.find(g => g.id === gid);
    groupsNode.hidden = false;
    groupsNode.replaceChildren(...MESSAGE_GROUPS.map(g => {
      const b = el('button', { type: 'button', class: `segment${g.id === gid ? ' is-active' : ''}`, text: Lx(g.label) });
      b.addEventListener('click', () => { if (g.id !== gid) useTemplate(TEMPLATES.message.find(t => t.group === g.id)); });
      return b;
    }));
    list = list.filter(t => t.group === gid);
    if (group.systems) {
      const sid = cur?.system || group.systems[0].id;
      systemsNode.hidden = false;
      systemsNode.replaceChildren(...group.systems.map(sys => {
        const b = el('button', { type: 'button', class: `chip${sys.id === sid ? ' is-active' : ''}`, text: Lx(sys.label) });
        b.addEventListener('click', () => { if (sys.id !== sid) useTemplate(list.find(t => t.system === sys.id)); });
        return b;
      }));
      list = list.filter(t => t.system === sid);
    } else systemsNode.hidden = true;
  } else {
    groupsNode.hidden = true;
    systemsNode.hidden = true;
  }
  strip.replaceChildren(...list.map(t => {
    const b = el('button', { type: 'button', class: `template-chip${t.id === s.template ? ' is-active' : ''}`, text: Lx(t.label) });
    b.addEventListener('click', () => useTemplate(t));
    return b;
  }));
}

let resetArmed = 0;
function onReset() {
  const btn = $('resetBtn');
  if (!resetArmed) {
    btn.textContent = str().resetConfirm;
    btn.classList.add('is-armed');
    resetArmed = setTimeout(() => { resetArmed = 0; btn.textContent = str().reset; btn.classList.remove('is-armed'); }, 4000);
    return;
  }
  clearTimeout(resetArmed);
  resetArmed = 0;
  btn.textContent = str().reset;
  btn.classList.remove('is-armed');
  const mode = app.store.mode;
  app.store.states[mode] = applyTemplate(mode, firstTemplate(mode));
  delete app.store.texts[mode];
  delete app.store.fileNames[mode];
  app.t = 0;
  renderTemplates();
  panel.build();
  changed();
  toast(str().m.resetDone);
}

/* ---------- 輸出設定 ---------- */

function autoFileName(text, subText) {
  const s = state();
  const t = str();
  const first = (text ?? s.text).split('\n').find(l => l.trim()) || 'text';
  let base = first.trim().slice(0, 24);
  if (s.mode !== 'trailer' && s.mode === 'caption' && (subText ?? s.subText)) base += `_${(subText ?? s.subText).trim().slice(0, 16)}`;
  const fx = s.mode === 'trailer' && s.reveal === 'scroll' ? '' : Lx(FX_LABELS.in[s.inFx]);
  let name = fx && s.inEnabled ? `${base}_${fx}` : base;
  if (!s.inEnabled) name += `_${t.fileNoEntry}`;
  if (!s.outEnabled || s.outFx === 'none') name += `_${t.fileNoExit}`;
  if (s.loop === 'infinite') name += `_${t.fileLoop}`;
  return sanitize(name);
}
const sanitize = n => n.replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim() || 'text';
const currentFileName = () => app.store.fileNames[app.store.mode] || autoFileName();

function syncExportUI() {
  const s = state();
  const ex = app.store.export;
  $('fpsSelect').value = String(ex.fps);
  $('loopSelect').value = s.loop;
  $('loopCountWrap').hidden = s.loop !== 'count';
  $('loopCountInput').value = s.loopCount || 3;
  $('colorSelect').value = ex.colorMode;
  $('posterInput').checked = ex.poster;
  $('trimInput').checked = ex.trim;
  $('batchFormat').value = ex.batchFormat;
  const manual = Boolean(app.store.fileNames[s.mode]);
  const fi = $('fileNameInput');
  if (document.activeElement !== fi) fi.value = currentFileName();
  $('fileAutoBadge').hidden = manual;
  $('fileAutoBtn').hidden = !manual;
  updateBatchHint();
}

function bindExportUI() {
  const ex = () => app.store.export;
  $('fpsSelect').addEventListener('change', e => { ex().fps = Number(e.target.value); save(); syncTransport(); });
  $('loopSelect').addEventListener('change', e => { state().loop = e.target.value; if (e.target.value === 'count' && !state().loopCount) state().loopCount = 3; save(); syncExportUI(); });
  $('loopCountInput').addEventListener('change', e => { state().loopCount = Math.max(1, Math.min(999, Number(e.target.value) || 1)); save(); });
  $('colorSelect').addEventListener('change', e => { ex().colorMode = e.target.value; save(); });
  $('posterInput').addEventListener('change', e => { ex().poster = e.target.checked; save(); });
  $('trimInput').addEventListener('change', e => { ex().trim = e.target.checked; save(); });
  $('batchFormat').addEventListener('change', e => { ex().batchFormat = e.target.value; save(); });
  $('fileNameInput').addEventListener('input', e => {
    app.store.fileNames[app.store.mode] = e.target.value;
    $('fileAutoBadge').hidden = true;
    $('fileAutoBtn').hidden = false;
    save();
  });
  $('fileAutoBtn').addEventListener('click', () => { delete app.store.fileNames[app.store.mode]; save(); syncExportUI(); });
  $('batchInput').addEventListener('input', updateBatchHint);
  $('exportApngBtn').addEventListener('click', () => runExport('apng'));
  $('exportWebpBtn').addEventListener('click', () => runExport('webp'));
  $('exportPngBtn').addEventListener('click', () => runExport('png'));
  $('exportZipBtn').addEventListener('click', () => runExport('zip'));
  $('batchBtn').addEventListener('click', () => runExport('batch'));
  $('cancelBtn').addEventListener('click', () => { if (app.signal) app.signal.cancelled = true; });
  $('clearResultBtn').addEventListener('click', clearResult);
}

function batchLines() {
  return $('batchInput').value.split('\n').map(l => l.trim()).filter(Boolean);
}
function updateBatchHint() {
  const mode = app.store.mode;
  $('batchInput').placeholder = mode === 'trailer' ? str().batchPlaceholderTrailer : str().batchPlaceholder;
  $('batchHint').textContent = str().batchHint(batchLines().length, BATCH_MAX, mode);
}

/* ---------- 輸出 ---------- */

function setStatus(text) { $('status').textContent = text; }
function setProgress(p) {
  $('progress').hidden = p == null;
  if (p != null) $('progressBar').style.width = `${Math.round(clamp(p) * 100)}%`;
}

function clearResult() {
  if (app.resultUrl) URL.revokeObjectURL(app.resultUrl);
  app.resultUrl = null;
  $('result').hidden = true;
  $('resultImg').removeAttribute('src');
}

function showResult(blob, name, meta, note, isImage = true) {
  clearResult();
  app.resultUrl = URL.createObjectURL(blob);
  $('result').hidden = false;
  const img = $('resultImg');
  img.parentElement.hidden = !isImage;
  if (isImage) img.src = app.resultUrl;
  $('resultMeta').textContent = meta;
  $('resultNote').hidden = !note;
  $('resultNote').textContent = note || '';
  const a = $('downloadLink');
  a.href = app.resultUrl;
  a.download = name;
}

const loopText = s => (s.loop === 'infinite' ? str().m.loopInfinite : s.loop === 'count' ? str().m.loopCount(s.loopCount || 3) : str().m.loopOnce);

async function runExport(kind) {
  if (app.busy) return;
  const m = str().m;
  const s = state();
  if (kind !== 'batch' && !s.text.trim()) { setStatus(m.emptyText); return; }
  if ((kind === 'apng' || kind === 'zip' || kind === 'png' || kind === 'batch') && !X.canCompress()) { setStatus(m.unsupported); return; }
  if ((kind === 'webp' || (kind === 'batch' && app.store.export.batchFormat === 'webp')) && !X.canEncodeWebP()) { setStatus(m.webpUnsupported); return; }
  await rebuildNow();
  const scene = app.scene;
  const ex = app.store.export;
  const opts = {
    fps: ex.fps, loop: s.loop, loopCount: s.loopCount || 3, palette: ex.colorMode === 'palette', poster: ex.poster, trim: ex.trim,
    signal: { cancelled: false },
    onProgress: (stage, i, n) => {
      const label = stage === 'analyze' ? m.analyzing(i, n) : stage === 'zip' ? m.zipping(i, n) : kind === 'webp' ? m.encodingWebp(i, n) : m.encoding(i, n);
      if (kind !== 'batch') setStatus(label);
      setProgress(stage === 'analyze' ? (i / n) * 0.3 : 0.3 + (i / n) * 0.7);
    }
  };
  app.busy = true;
  app.signal = opts.signal;
  $('cancelBtn').hidden = false;
  document.body.classList.add('is-exporting');
  setProgress(0);
  const name = sanitize(currentFileName());
  try {
    if (kind === 'png') {
      const t = app.playing ? scene.timeline.posterTime : app.t;
      const r = await X.exportStill(scene, t, ex.trim);
      showResult(r.blob, `${name}.png`, `${formatBytes(r.blob.size)} · ${r.width} × ${r.height}`);
      setStatus(m.stillDone);
    } else if (kind === 'zip') {
      const r = await X.exportSequence(scene, opts, name);
      showResult(r.blob, `${name}.zip`, `${formatBytes(r.blob.size)} · ${r.width} × ${r.height} · ${r.frames}`, '', false);
      setStatus(m.zipDone);
    } else if (kind === 'batch') {
      await runBatch(opts);
    } else {
      const r = await X.exportAnimation(scene, kind, opts);
      const colors = kind === 'webp' ? m.colorsWebp : r.palette ? m.colorsPalette(r.lossless) : m.colorsFull;
      const over = r.blob.size > SIZE_LIMIT;
      showResult(r.blob, `${name}.${kind === 'webp' ? 'webp' : 'png'}`, m.resultMeta(formatBytes(r.blob.size), r.width, r.height, r.frames, r.stored, colors, loopText(s)), over ? m.overLimit(formatBytes(r.blob.size)) : m.withinLimit);
      setStatus(kind === 'webp' ? m.webpDone : m.done);
    }
  } catch (e) {
    if (e instanceof X.Cancelled) setStatus(m.cancelled);
    else if (e.message === 'too-many-frames') setStatus(m.tooManyFrames(e.frames, X.MAX_FRAMES));
    else if (e.message === 'webp-unsupported') setStatus(m.webpUnsupported);
    else { console.error(e); setStatus(m.failed); }
  } finally {
    app.busy = false;
    app.signal = null;
    $('cancelBtn').hidden = true;
    document.body.classList.remove('is-exporting');
    setProgress(null);
  }
}

async function rebuildNow() {
  if (app.rebuildPending || !app.scene) { app.rebuildPending = false; await rebuild(); }
}

async function runBatch(opts) {
  const m = str().m;
  const s = state();
  const lines = batchLines();
  if (!lines.length) { setStatus(m.batchEmpty); return; }
  if (lines.length > BATCH_MAX) { setStatus(m.batchTooMany(BATCH_MAX)); return; }
  const format = app.store.export.batchFormat;
  const zip = new X.ZipWriter();
  const over = [];
  let total = 0;
  for (let i = 0; i < lines.length; i++) {
    let text = lines[i], subText = s.subText;
    if (s.mode !== 'trailer' && text.includes('|')) [text, subText] = text.split('|').map(x => x.trim());
    setStatus(m.batchProgress(i + 1, lines.length, text));
    await Fonts.ensure(s.fontId, s.weight, text);
    if (subText && s.mode !== 'trailer') await Fonts.ensure(s.subFontId === 'same' ? s.fontId : s.subFontId, s.subWeight, subText);
    clearMeasureCache();
    const scene = createScene(s, undefined, { text, subText });
    const r = await X.exportAnimation(scene, format, {
      ...opts,
      onProgress: (stage, k, n) => setProgress((i + (stage === 'analyze' ? (k / n) * 0.3 : 0.3 + (k / n) * 0.7)) / lines.length)
    });
    const fname = `${autoFileName(text, subText)}.${format === 'webp' ? 'webp' : 'png'}`;
    if (r.blob.size > SIZE_LIMIT) over.push(fname);
    total += r.blob.size;
    await zip.add(fname, r.blob);
  }
  const blob = zip.finish();
  const modeName = str().modes[s.mode][0];
  showResult(blob, `${sanitize(modeName)}_${lines.length}.zip`, `${lines.length} · ${format.toUpperCase()} · ${formatBytes(total)}`, over.length ? m.batchOver(over.join(', ')) : m.batchWithin, false);
  setStatus(m.batchDone(lines.length));
}

/* ---------- 提示 ---------- */

function toast(msg, action) {
  const host = $('toastHost');
  const node = el('div', { class: 'toast' }, [el('span', { text: msg })]);
  if (action) {
    const b = el('button', { type: 'button', class: 'link-button', text: action.label });
    b.addEventListener('click', () => { action.run(); node.remove(); });
    node.append(b);
  }
  host.append(node);
  while (host.children.length > 3) host.firstChild.remove();
  setTimeout(() => node.classList.add('is-leaving'), action ? 7000 : 3200);
  setTimeout(() => node.remove(), action ? 7600 : 3800);
}

/* ---------- 主題・介面文字 ---------- */

function applyTheme() {
  const t = app.store.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.dataset.theme = t;
  $('themeBtn').title = t === 'dark' ? str().themeDark : str().themeLight;
  $('themeBtn').setAttribute('aria-label', $('themeBtn').title);
  // 效果卡片的字色跟著主題
  if (panel.tab) panel.build();
}
function toggleTheme() {
  const cur = document.documentElement.dataset.theme;
  app.store.theme = cur === 'dark' ? 'light' : 'dark';
  save();
  applyTheme();
}

function applyLang() {
  const t = str();
  document.documentElement.lang = app.store.lang;
  document.title = t.title;
  document.querySelectorAll('[data-i18n]').forEach(n => { n.textContent = getPath(t, n.dataset.i18n); });
  document.querySelectorAll('.settings-tab').forEach(b => { b.textContent = t.tabs[b.dataset.tab]; });
  document.querySelectorAll('#previewBgGroup [data-bg]').forEach(b => { b.textContent = t.previewBgs[b.dataset.bg]; });
  document.querySelector('#previewBgGroup [data-bg="image"]').title = t.previewBgImage;
  $('restartBtn').title = t.restart;
  $('restartBtn').setAttribute('aria-label', t.restart);
  $('resetBtn').textContent = t.reset;
  const ls = $('loopSelect').options;
  ls[0].textContent = t.loopOptions.once; ls[1].textContent = t.loopOptions.infinite; ls[2].textContent = t.loopOptions.count;
  const cs = $('colorSelect').options;
  cs[0].textContent = t.colorOptions.palette; cs[1].textContent = t.colorOptions.full;
  setPlaying(app.playing);
  renderModeTabs();
  renderTemplates();
  if (app.scene) { syncTransport(); syncExportUI(); draw(); }
  panel.build();
}

function setTab(tab) {
  app.store.tab = tab;
  save();
  document.querySelectorAll('.settings-tab').forEach(b => {
    const on = b.dataset.tab === tab;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', on);
  });
  panel.setTab(tab);
}

function setPreviewBg(bg) {
  const stage = $('previewStage');
  if (bg === 'image') { $('previewBgFile').click(); return; }
  stage.dataset.bg = bg;
  stage.style.backgroundImage = '';
  app.store.previewBg = bg;
  save();
  document.querySelectorAll('#previewBgGroup [data-bg]').forEach(b => b.classList.toggle('is-active', b.dataset.bg === bg));
}

/* ---------- 啟動 ---------- */

function bindUI() {
  document.querySelectorAll('.mode-tab').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  document.querySelectorAll('.settings-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('settingsTabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const tabs = [...document.querySelectorAll('.settings-tab')];
    const i = tabs.findIndex(b => b.dataset.tab === app.store.tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.dataset.tab);
    next.focus();
  });
  $('resetBtn').addEventListener('click', onReset);
  $('playBtn').addEventListener('click', () => setPlaying(!app.playing));
  $('restartBtn').addEventListener('click', () => { app.t = 0; setPlaying(true); draw(); });
  $('loopPreview').addEventListener('change', () => { if ($('loopPreview').checked && !app.playing) setPlaying(true); });
  $('entryInput').addEventListener('change', e => setValue('inEnabled', e.target.checked));
  $('exitInput').addEventListener('change', e => setValue('outEnabled', e.target.checked));
  const scrub = $('scrub');
  scrub.addEventListener('input', () => {
    if (!app.scene) return;
    setPlaying(false);
    app.t = Number(scrub.value) * app.scene.timeline.duration;
    draw();
  });
  document.querySelectorAll('#previewBgGroup [data-bg]').forEach(b => b.addEventListener('click', () => setPreviewBg(b.dataset.bg)));
  $('previewBgFile').addEventListener('change', e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const stage = $('previewStage');
    stage.dataset.bg = 'image';
    stage.style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
    document.querySelectorAll('#previewBgGroup [data-bg]').forEach(b => b.classList.toggle('is-active', b.dataset.bg === 'image'));
  });
  $('themeBtn').addEventListener('click', toggleTheme);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!app.store.theme) applyTheme(); });
  bindExportUI();
}

async function init() {
  bindUI();
  await Fonts.restoreUserFonts();
  // 儲存的使用者字型已不存在時，退回預設字型
  for (const m of MODES) {
    const s = app.store.states[m];
    if (!Fonts.get(s.fontId)) s.fontId = 'noto-sans-tc';
    if (s.subFontId !== 'same' && !Fonts.get(s.subFontId)) s.subFontId = 'same';
  }
  applyTheme();
  setPreviewBg(app.store.previewBg);
  applyLang();
  setTab(app.store.tab);
  await rebuild();
  requestAnimationFrame(tick);
}

init();
