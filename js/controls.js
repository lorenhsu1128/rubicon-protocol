// 設定面板：用宣告式 schema 產生 UI。每個控制項都有 update(state)，狀態改變時只更新顯示，不重建（避免拖曳中斷）

import { el, getPath, clone, merge } from './util.js';
import * as Fonts from './fonts.js';
import { IN, OUT, HOLD } from './engine/effects.js';
import { createScene, Renderer } from './engine/render.js';
import { defaults, STYLE_PRESETS, GRADIENT_PRESETS, SIZE_PRESETS } from './presets.js';

const L = (zh, en) => ({ 'zh-TW': zh, en });

export const FX_LABELS = {
  in: {
    fade: L('淡入', 'Fade'), rise: L('浮現', 'Rise'), drop: L('落下', 'Drop'), converge: L('上下匯合', 'Converge'),
    slide: L('滑入', 'Slide'), tracking: L('字距收攏', 'Tracking in'), spread: L('從中央展開', 'Spread'), blurIn: L('模糊變清晰', 'Blur in'),
    pop: L('彈出', 'Pop'), shrinkIn: L('由大縮小', 'Shrink in'), spin: L('旋轉', 'Spin'), flip: L('翻轉', 'Flip'),
    bounce: L('落下彈跳', 'Bounce'), scatter: L('聚合', 'Assemble'), typewriter: L('打字機', 'Typewriter'), flicker: L('明滅', 'Flicker'),
    slam: L('重擊', 'Slam'), zoomIn: L('逼近', 'Zoom in'), emerge: L('從深處浮現', 'Emerge'), wipe: L('擦除', 'Wipe'),
    shutter: L('展開', 'Unfold'), glitch: L('故障', 'Glitch'), flash: L('閃光', 'Flash')
  },
  out: {
    none: L('不消失', 'Keep'), fade: L('淡出', 'Fade'), rise: L('向上消失', 'Float away'), sink: L('下沉', 'Sink'),
    diverge: L('上下分離', 'Diverge'), slide: L('滑出', 'Slide'), tracking: L('字距散開', 'Tracking out'), blurOut: L('逐漸模糊', 'Blur out'),
    growOut: L('膨脹消失', 'Grow out'), shrink: L('縮小消失', 'Shrink'), scatter: L('飛散', 'Scatter'), erase: L('逐字消除', 'Erase'),
    flicker: L('明滅', 'Flicker'), zoomThrough: L('逼近消失', 'Zoom through'), recede: L('遠去', 'Recede'), wipe: L('擦除', 'Wipe'),
    shutter: L('收起', 'Fold'), glitch: L('故障', 'Glitch')
  },
  hold: {
    none: L('無', 'None'), float: L('飄浮', 'Float'), wave: L('波浪', 'Wave'), pulse: L('心跳', 'Heartbeat'), shake: L('顫抖', 'Tremble'),
    glow: L('光暈明滅', 'Glow pulse'), flicker: L('忽明忽暗', 'Flicker'), blink: L('閃爍', 'Blink'), glitch: L('間歇故障', 'Glitch bursts')
  }
};

const OPT = {
  order: [
    { value: 'forward', label: L('從開頭', 'From start') }, { value: 'reverse', label: L('從結尾', 'From end') },
    { value: 'center', label: L('從中間', 'From center') }, { value: 'edges', label: L('從兩端', 'From edges') }, { value: 'random', label: L('隨機', 'Random') }
  ],
  ease: [
    { value: 'auto', label: L('自動', 'Auto') }, { value: 'out', label: L('減速', 'Ease out') }, { value: 'strong', label: L('強烈減速', 'Strong ease out') },
    { value: 'smooth', label: L('平滑', 'Smooth') }, { value: 'back', label: L('超出回彈', 'Back') }, { value: 'elastic', label: L('彈簧', 'Elastic') },
    { value: 'bounce', label: L('彈跳', 'Bounce') }, { value: 'linear', label: L('等速', 'Linear') }, { value: 'in', label: L('加速', 'Ease in') }
  ],
  dirs: {
    left: L('左', 'Left'), right: L('右', 'Right'), up: L('上', 'Up'), down: L('下', 'Down'),
    lr: L('左 → 右', 'Left → right'), rl: L('右 → 左', 'Right → left'), tb: L('上 → 下', 'Top → bottom'), bt: L('下 → 上', 'Bottom → top'),
    v: L('上下展開', 'Vertical'), h: L('左右展開', 'Horizontal')
  },
  reveal: [
    { value: 'char', label: L('逐字', 'Per character') }, { value: 'solo', label: L('中央逐字', 'One by one at center') },
    { value: 'spread', label: L('從中央向兩側展開', 'Spread from center') }, { value: 'line', label: L('逐行', 'Per line') },
    { value: 'sweep', label: L('流暢掃過', 'Smooth sweep') }, { value: 'all', label: L('整體同時', 'All at once') }, { value: 'scroll', label: L('捲動', 'Scroll') }
  ],
  subFx: [
    { value: 'same', label: L('與主文字相同', 'Same as main') }, { value: 'fade', label: L('淡入', 'Fade') }, { value: 'rise', label: L('浮現', 'Rise') },
    { value: 'blurIn', label: L('模糊變清晰', 'Blur in') }, { value: 'tracking', label: L('字距收攏', 'Tracking in') },
    { value: 'typewriter', label: L('打字機', 'Typewriter') }, { value: 'slide', label: L('滑入', 'Slide') }
  ],
  deco: [
    { value: 'none', label: L('無', 'None') }, { value: 'band', label: L('色帶', 'Band') }, { value: 'tape', label: L('警戒膠帶', 'Caution tape') },
    { value: 'box', label: L('方框', 'Box') }, { value: 'frame', label: L('標題框', 'Title frame') }, { value: 'lines', label: L('上下線', 'Lines') },
    { value: 'underline', label: L('底線', 'Underline') }, { value: 'sides', label: L('兩側線', 'Side lines') }, { value: 'bar', label: L('強調條', 'Accent bar') },
    { value: 'corners', label: L('角框', 'Corners') }
  ],
  decoAnim: [{ value: 'grow', label: L('伸展', 'Grow') }, { value: 'fade', label: L('淡入', 'Fade') }, { value: 'none', label: L('無', 'None') }],
  bg: [
    { value: 'none', label: L('無（透明）', 'None (clear)') }, { value: 'solid', label: L('純色', 'Solid') }, { value: 'vignette', label: L('暗角', 'Vignette') },
    { value: 'bottom', label: L('底部漸層', 'Bottom fade') }, { value: 'top', label: L('頂部漸層', 'Top fade') }
  ],
  writing: [{ value: 'h', label: L('橫排', 'Horizontal') }, { value: 'v', label: L('直排', 'Vertical') }],
  align: s => (s.writing === 'v'
    ? [{ value: 'left', label: L('上', 'Top') }, { value: 'center', label: L('中', 'Middle') }, { value: 'right', label: L('下', 'Bottom') }]
    : [{ value: 'left', label: L('左', 'Left') }, { value: 'center', label: L('中', 'Center') }, { value: 'right', label: L('右', 'Right') }]),
  subPos: s => (s.writing === 'v'
    ? [{ value: 'above', label: L('右側', 'Right') }, { value: 'below', label: L('左側', 'Left') }]
    : [{ value: 'above', label: L('上方', 'Above') }, { value: 'below', label: L('下方', 'Below') }]),
  fillType: [{ value: 'solid', label: L('純色', 'Solid') }, { value: 'gradient', label: L('漸層', 'Gradient') }],
  gradDir: [{ value: 'v', label: L('縱向（每行）', 'Vertical (per line)') }, { value: 'h', label: L('橫向（整體）', 'Horizontal (whole)') }, { value: 'd', label: L('斜向（整體）', 'Diagonal (whole)') }]
};

const FMT = {
  s: { d: 2, u: L('秒', 's') }, sSigned: { d: 2, u: L('秒', 's'), signed: true }, px: { d: 0, u: L('px', 'px') },
  pct: { d: 0, u: L('%', '%'), mul: 100 }, x: { d: 2, u: L('倍', '×') }, em: { d: 2, u: L('em', 'em') },
  cps: { d: 0, u: L('字/秒', 'chars/s') }, pxs: { d: 0, u: L('px/秒', 'px/s') }, chars: { d: 0, u: L('字', 'chars') }
};

const isTrailer = s => s.mode === 'trailer';
const notTrailer = s => s.mode !== 'trailer';
const inDef = s => IN[s.inFx] || IN.fade;
const outDef = s => OUT[s.outFx] || OUT.fade;
const decoIs = (...types) => s => types.includes(s.deco.type);
const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const weightOptions = id => (Fonts.get(id)?.weights || [400]).map(w => ({ value: w, label: L(`${w}（${WEIGHT_NAMES[w]}）`, `${w} (${WEIGHT_NAMES[w]})`) }));
const subFontOptions = () => [{ value: 'same', label: L('與主文字相同', 'Same as main') }, ...Fonts.list().map(f => ({ value: f.id, label: L(Fonts.label(f), Fonts.label(f)) }))];

export const SCHEMA = {
  text: [
    { type: 'textarea', bind: 'text', label: s => (isTrailer(s) ? L('正文', 'Body text') : L('主文字', 'Main text')), rows: s => (isTrailer(s) ? 8 : 2) },
    { type: 'note', when: isTrailer, text: L('換行會原樣保留。空一行（什麼都不寫的行）可以分頁。', 'Line breaks are kept. A blank line starts a new page.') },
    { type: 'text', bind: 'subText', when: notTrailer, label: L('副文字（可省略）', 'Sub text (optional)'), placeholder: L('例：BATTLE START ／ 放學後 16:30', 'e.g. BATTLE START / 4:30 PM') },
    { type: 'segment', bind: 'subPosition', when: notTrailer, label: L('副文字位置', 'Sub text position'), options: OPT.subPos },
    { type: 'segment', bind: 'writing', label: L('文字方向', 'Writing direction'), options: OPT.writing },
    { type: 'segment', bind: 'align', label: L('對齊', 'Alignment'), options: OPT.align },
    { type: 'range', bind: 'wrapChars', when: isTrailer, label: L('自動換行（每行最多字數，0 為不換行）', 'Auto wrap (max chars per line, 0 = off)'), min: 0, max: 60, step: 1, fmt: 'chars' },
    { type: 'toggle', bind: 'pageSplit', when: s => isTrailer(s) && s.reveal !== 'scroll', label: L('以空行分頁', 'Split pages at blank lines') },
    { type: 'toggle', bind: 'autoFit', label: L('超出範圍時自動縮小', 'Shrink automatically when overflowing') },
    { type: 'dynamicNote', key: 'autoFit' }
  ],
  font: [
    { type: 'fontPicker', bind: 'fontId', label: L('字型', 'Font') },
    { type: 'select', bind: 'weight', label: L('粗細', 'Weight'), options: s => weightOptions(s.fontId), numeric: true },
    { type: 'toggle', bind: 'italic', label: L('斜體', 'Italic') },
    { type: 'colors', items: [
      { bind: 'fill.color', label: s => (s.fill.type === 'gradient' ? L('漸層起點色', 'Gradient start') : L('文字顏色', 'Text color')) },
      { bind: 'fill.color2', label: L('漸層終點色', 'Gradient end'), when: s => s.fill.type === 'gradient' }
    ] },
    { type: 'note', text: L('漸層、描邊、陰影在「裝飾」分頁設定', 'Gradients, outlines and shadows are in the Style tab') },
    { type: 'range', bind: 'fontSize', label: L('字級', 'Font size'), min: 12, max: 400, step: 1, fmt: 'px' },
    { type: 'range', bind: 'letterSpacing', label: L('字距', 'Letter spacing'), min: -0.2, max: 1.2, step: 0.01, fmt: 'pct' },
    { type: 'range', bind: 'lineHeight', label: L('行距', 'Line height'), min: 0.9, max: 3.2, step: 0.05, fmt: 'x' },
    { type: 'heading', when: notTrailer, label: L('副文字', 'Sub text') },
    { type: 'select', bind: 'subFontId', when: notTrailer, label: L('副文字字型', 'Sub font'), options: subFontOptions },
    { type: 'select', bind: 'subWeight', when: notTrailer, label: L('副文字粗細', 'Sub weight'), options: s => weightOptions(s.subFontId === 'same' ? s.fontId : s.subFontId), numeric: true },
    { type: 'toggle', bind: 'subItalic', when: notTrailer, label: L('副文字斜體', 'Italic sub text') },
    { type: 'toggle', bind: 'subColorOn', when: notTrailer, label: L('副文字使用其他顏色', 'Different color for sub text') },
    { type: 'colors', when: s => notTrailer(s) && s.subColorOn, items: [{ bind: 'subColor', label: L('副文字顏色', 'Sub text color') }] },
    { type: 'range', bind: 'subSize', when: notTrailer, label: L('副文字大小（相對主文字）', 'Sub size (vs. main)'), min: 0.1, max: 0.9, step: 0.01, fmt: 'pct' },
    { type: 'range', bind: 'subLetterSpacing', when: notTrailer, label: L('副文字字距', 'Sub letter spacing'), min: -0.2, max: 1.5, step: 0.01, fmt: 'pct' },
    { type: 'range', bind: 'subGap', when: notTrailer, label: L('與主文字的間距', 'Gap from main text'), min: 0, max: 1.5, step: 0.01, fmt: 'em' }
  ],
  motion: [
    { type: 'section', when: isTrailer, label: L('顯示流程', 'Reveal flow'), children: [
      { type: 'chips', bind: 'reveal', options: OPT.reveal },
      { type: 'note', when: s => s.reveal === 'solo', text: L('逐字在畫面中央放大顯示，最後一次顯示全文', 'Each character flashes big at the center, then the whole text lands') },
      { type: 'note', when: s => s.reveal === 'spread', text: L('所有字先重疊在中央，再向兩側展開排好（直排為上下）', 'All characters stack at the center, then spread into place') },
      { type: 'range', bind: 'spreadHold', when: s => s.reveal === 'spread', label: L('重疊顯示時間', 'Time stacked'), min: 0, max: 3, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'spreadDur', when: s => s.reveal === 'spread', label: L('展開時間', 'Spread time'), min: 0.1, max: 3, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'cps', when: s => s.reveal === 'char' || s.reveal === 'solo', label: L('顯示速度', 'Speed'), min: 2, max: 40, step: 1, fmt: 'cps' },
      { type: 'range', bind: 'soloSize', when: s => s.reveal === 'solo', label: L('中央文字大小（相對圖像短邊）', 'Center letter size (vs. shorter side)'), min: 0.15, max: 0.9, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'soloPause', when: s => s.reveal === 'solo', label: L('顯示全文前的停頓', 'Pause before the whole text'), min: 0, max: 2, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'soloImpact', when: s => s.reveal === 'solo', label: L('全文出現時的衝擊感', 'Impact when the text lands'), min: 0, max: 2, step: 0.05, fmt: 'x' },
      { type: 'range', bind: 'glyphDur', when: s => !['scroll', 'solo', 'spread'].includes(s.reveal) && s.inFx !== 'typewriter', label: L('單字顯現時間', 'Fade time per character'), min: 0, max: 2, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'punctPause', when: s => s.reveal === 'char', label: L('標點處停頓', 'Pause at punctuation'), min: 0, max: 1.5, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'linePause', when: s => s.reveal === 'char', label: L('換行處停頓', 'Pause at line breaks'), min: 0, max: 2, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'lineInterval', when: s => s.reveal === 'line' || s.reveal === 'sweep', label: L('到下一行的時間', 'Time between lines'), min: 0.1, max: 4, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'sweepDur', when: s => s.reveal === 'sweep', label: L('每行掃過時間', 'Sweep time per line'), min: 0.2, max: 5, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'scrollSpeed', when: s => s.reveal === 'scroll', label: L('捲動速度', 'Scroll speed'), min: 10, max: 400, step: 5, fmt: 'pxs' },
      { type: 'toggle', bind: 'scrollFade', when: s => s.reveal === 'scroll', label: L('在畫面邊緣淡化', 'Fade near the edges') },
      { type: 'toggle', bind: 'cursor', when: s => s.reveal === 'char', label: L('顯示打字游標', 'Show a typing cursor') },
      { type: 'range', bind: 'pageGap', when: s => s.reveal !== 'scroll' && s.pageSplit, label: L('頁與頁之間的空白', 'Gap between pages'), min: 0, max: 3, step: 0.05, fmt: 's' }
    ] },
    { type: 'section', when: s => !(isTrailer(s) && ['solo', 'spread', 'scroll'].includes(s.reveal)), toggle: s => (isTrailer(s) ? null : 'inEnabled'),
      label: s => (isTrailer(s) ? L('單字顯現方式', 'How each character appears') : L('登場', 'Entrance')), children: [
        { type: 'effects', phase: 'in' },
        { type: 'select', bind: 'inDir', when: s => Boolean(inDef(s).dirs), label: L('方向', 'Direction'), options: s => (inDef(s).dirs || []).map(d => ({ value: d, label: OPT.dirs[d] })) },
        { type: 'range', bind: 'inDur', when: s => notTrailer(s) && !inDef(s).instant, label: L('時長', 'Duration'), min: 0.05, max: 4, step: 0.05, fmt: 's' },
        { type: 'range', bind: 'inStagger', when: s => notTrailer(s) && inDef(s).level === 'glyph', label: L('逐字延遲', 'Delay between characters'), min: 0, max: 0.6, step: 0.01, fmt: 's' },
        { type: 'select', bind: 'inOrder', when: s => notTrailer(s) && inDef(s).level === 'glyph', label: L('順序', 'Order'), options: OPT.order },
        { type: 'select', bind: 'inEase', when: s => !inDef(s).instant, label: L('緩動曲線', 'Easing'), options: OPT.ease },
        { type: 'range', bind: 'inPower', when: s => !['fade', 'typewriter'].includes(s.inFx), label: L('強度', 'Strength'), min: 0.2, max: 2.5, step: 0.05, fmt: 'x' }
      ] },
    { type: 'section', label: s => (isTrailer(s) && s.reveal !== 'scroll' ? L('顯示中（每頁）', 'Hold (each page)') : L('顯示中', 'Hold')), children: [
      { type: 'range', bind: 'hold', when: s => !(isTrailer(s) && s.reveal === 'scroll'), label: L('顯示時長', 'Hold time'), min: 0, max: 10, step: 0.1, fmt: 's' },
      { type: 'chips', bind: 'holdFx', options: Object.keys(FX_LABELS.hold).map(id => ({ value: id, label: FX_LABELS.hold[id] })) },
      { type: 'range', bind: 'holdPower', when: s => s.holdFx !== 'none', label: L('強度', 'Strength'), min: 0.2, max: 3, step: 0.05, fmt: 'x' },
      { type: 'dynamicNote', key: 'hold' }
    ] },
    { type: 'section', when: s => !(isTrailer(s) && s.reveal === 'scroll'), toggle: 'outEnabled', label: s => (isTrailer(s) ? L('退場（每頁）', 'Exit (each page)') : L('退場', 'Exit')), children: [
      { type: 'effects', phase: 'out' },
      { type: 'select', bind: 'outDir', when: s => Boolean(outDef(s).dirs), label: L('方向', 'Direction'), options: s => (outDef(s).dirs || []).map(d => ({ value: d, label: OPT.dirs[d] })) },
      { type: 'range', bind: 'outDur', when: s => !['none', 'erase'].includes(s.outFx), label: L('時長', 'Duration'), min: 0.05, max: 4, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'outStagger', when: s => outDef(s).level === 'glyph' && s.outFx !== 'none', label: L('逐字延遲', 'Delay between characters'), min: 0, max: 0.6, step: 0.01, fmt: 's' },
      { type: 'select', bind: 'outOrder', when: s => outDef(s).level === 'glyph' && s.outFx !== 'none', label: L('順序', 'Order'), options: OPT.order },
      { type: 'select', bind: 'outEase', when: s => !['none', 'erase'].includes(s.outFx), label: L('緩動曲線', 'Easing'), options: OPT.ease },
      { type: 'range', bind: 'outPower', when: s => !['none', 'fade', 'erase'].includes(s.outFx), label: L('強度', 'Strength'), min: 0.2, max: 2.5, step: 0.05, fmt: 'x' }
    ] },
    { type: 'section', label: L('時機', 'Timing'), children: [
      { type: 'select', bind: 'subFx', when: notTrailer, label: L('副文字登場方式', 'Sub text entrance'), options: OPT.subFx },
      { type: 'range', bind: 'subDelay', when: notTrailer, label: L('副文字登場（相對主文字登場完成）', 'Sub text timing (after main finishes)'), min: -2, max: 2, step: 0.05, fmt: 'sSigned' },
      { type: 'range', bind: 'startDelay', label: L('開始前空白', 'Blank before'), min: 0, max: 3, step: 0.05, fmt: 's' },
      { type: 'range', bind: 'endDelay', label: L('結束後空白', 'Blank after'), min: 0, max: 5, step: 0.05, fmt: 's' },
      { type: 'dynamicNote', key: 'duration' }
    ] }
  ],
  style: [
    { type: 'stylePresets', label: L('樣式預設', 'Style presets') },
    { type: 'section', label: L('文字填色', 'Fill'), children: [
      { type: 'segment', bind: 'fill.type', options: OPT.fillType },
      { type: 'colors', items: [
        { bind: 'fill.color', label: s => (s.fill.type === 'gradient' ? L('起點', 'Start') : L('顏色', 'Color')) },
        { bind: 'fill.color2', label: L('終點', 'End'), when: s => s.fill.type === 'gradient' },
        { bind: 'fill.color3', label: L('第三色（可留空）', '3rd color (optional)'), when: s => s.fill.type === 'gradient', optional: true }
      ] },
      { type: 'segment', bind: 'fill.dir', when: s => s.fill.type === 'gradient', label: L('漸層方向', 'Gradient direction'), options: OPT.gradDir },
      { type: 'gradientPresets', when: s => s.fill.type === 'gradient' },
      { type: 'range', bind: 'fillOpacity', label: L('填色不透明度', 'Fill opacity'), min: 0, max: 1, step: 0.01, fmt: 'pct' }
    ] },
    { type: 'section', label: L('描邊', 'Outline'), toggle: 'stroke.on', children: [
      { type: 'colors', items: [{ bind: 'stroke.color', label: L('顏色', 'Color') }] },
      { type: 'range', bind: 'stroke.width', label: L('粗細', 'Width'), min: 0.5, max: 30, step: 0.5, fmt: 'px' }
    ] },
    { type: 'section', label: L('外描邊', 'Outer outline'), toggle: 'stroke2.on', children: [
      { type: 'colors', items: [{ bind: 'stroke2.color', label: L('顏色', 'Color') }] },
      { type: 'range', bind: 'stroke2.width', label: L('粗細', 'Width'), min: 0.5, max: 40, step: 0.5, fmt: 'px' }
    ] },
    { type: 'section', label: L('陰影', 'Shadow'), toggle: 'shadow.on', children: [
      { type: 'colors', items: [{ bind: 'shadow.color', label: L('顏色', 'Color') }] },
      { type: 'range', bind: 'shadow.opacity', label: L('濃度', 'Opacity'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'shadow.blur', label: L('模糊', 'Blur'), min: 0, max: 80, step: 1, fmt: 'px' },
      { type: 'range', bind: 'shadow.x', label: L('水平偏移', 'Offset X'), min: -60, max: 60, step: 1, fmt: 'px' },
      { type: 'range', bind: 'shadow.y', label: L('垂直偏移', 'Offset Y'), min: -60, max: 60, step: 1, fmt: 'px' }
    ] },
    { type: 'section', label: L('外發光', 'Glow'), toggle: 'glow.on', children: [
      { type: 'colors', items: [{ bind: 'glow.color', label: L('顏色', 'Color') }] },
      { type: 'range', bind: 'glow.size', label: L('擴散', 'Size'), min: 2, max: 150, step: 1, fmt: 'px' },
      { type: 'range', bind: 'glow.strength', label: L('強度', 'Strength'), min: 0.2, max: 3, step: 0.05, fmt: 'x' }
    ] },
    { type: 'section', when: s => [s.inFx, s.holdFx, s.outFx].includes('glitch'), label: L('故障色', 'Glitch colors'), children: [
      { type: 'colors', items: [{ bind: 'glitchColor', label: L('顏色 1', 'Color 1') }, { bind: 'glitchColor2', label: L('顏色 2', 'Color 2') }] }
    ] },
    { type: 'section', when: notTrailer, label: L('副文字使用其他顏色', 'Different color for sub text'), toggle: 'subColorOn', children: [
      { type: 'colors', items: [{ bind: 'subColor', label: L('顏色', 'Color') }] }
    ] },
    { type: 'section', when: s => isTrailer(s) && s.cursor, label: L('游標', 'Cursor'), children: [
      { type: 'colors', items: [{ bind: 'cursorColor', label: L('顏色（留空 = 文字顏色）', 'Color (blank = text color)'), optional: true }] }
    ] }
  ],
  layout: [
    { type: 'section', label: L('裝飾', 'Decoration'), children: [
      { type: 'chips', bind: 'deco.type', options: OPT.deco },
      { type: 'colors', when: s => s.deco.type !== 'none', items: [
        { bind: 'deco.color', label: L('填色', 'Fill'), when: decoIs('band', 'box', 'frame') },
        { bind: 'deco.color2', label: s => (decoIs('box', 'frame')(s) ? L('框線', 'Border') : L('線條', 'Line')), when: decoIs('box', 'frame', 'lines', 'underline', 'sides', 'bar', 'corners') },
        { bind: 'deco.tapeColor', label: L('膠帶底色', 'Tape color'), when: decoIs('tape') },
        { bind: 'deco.tapeStripe', label: L('條紋', 'Stripes'), when: decoIs('tape') }
      ] },
      { type: 'range', bind: 'deco.opacity', when: decoIs('band', 'box', 'frame'), label: L('填色濃度', 'Fill opacity'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'deco.thickness', when: decoIs('box', 'frame', 'lines', 'underline', 'sides', 'bar', 'corners'), label: s => (decoIs('box', 'frame')(s) ? L('框線粗細（0 為無框線）', 'Border width (0 = none)') : L('線條粗細', 'Line width')), min: 0, max: 16, step: 0.5, fmt: 'px' },
      { type: 'toggle', bind: 'deco.outline', when: s => decoIs('frame', 'lines', 'underline', 'sides', 'bar', 'corners')(s) && (s.stroke.on || s.stroke2.on), label: L('線條也加上與文字相同的描邊', 'Outline the lines like the text') },
      { type: 'range', bind: 'deco.tapeSize', when: decoIs('tape'), label: L('膠帶寬度', 'Tape width'), min: 8, max: 120, step: 1, fmt: 'px' },
      { type: 'range', bind: 'deco.tapeSpeed', when: decoIs('tape'), label: L('膠帶流動速度（0 為靜止）', 'Tape speed (0 = still)'), min: 0, max: 400, step: 5, fmt: 'pxs' },
      { type: 'range', bind: 'deco.tapeBlink', when: decoIs('tape'), label: L('膠帶閃爍（0 為不閃爍）', 'Tape blink (0 = none)'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'deco.pad', when: s => s.deco.type !== 'none', label: L('與文字的間距', 'Padding'), min: 0, max: 2, step: 0.01, fmt: 'em' },
      { type: 'range', bind: 'deco.extend', when: decoIs('lines', 'underline', 'sides'), label: L('線條長度', 'Line length'), min: 0, max: 4, step: 0.05, fmt: 'em' },
      { type: 'range', bind: 'deco.extend', when: decoIs('frame'), label: L('框的延伸（到畫面邊緣為止）', 'Frame extension (stops at the edge)'), min: 0, max: 12, step: 0.1, fmt: 'em' },
      { type: 'range', bind: 'deco.soft', when: decoIs('band'), label: L('邊緣柔化', 'Edge softness'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'deco.sideFade', when: decoIs('band'), label: L('兩端淡化', 'End fade'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'range', bind: 'deco.radius', when: decoIs('box'), label: L('圓角', 'Corner radius'), min: 0, max: 1, step: 0.01, fmt: 'em' },
      { type: 'segment', bind: 'deco.anim', when: s => s.deco.type !== 'none', label: L('裝飾動畫', 'Decoration animation'), options: OPT.decoAnim },
      { type: 'range', bind: 'deco.dur', when: s => s.deco.type !== 'none' && s.deco.anim !== 'none', label: L('裝飾動畫時長', 'Decoration animation time'), min: 0.1, max: 2.5, step: 0.05, fmt: 's' }
    ] },
    { type: 'section', label: L('背景（整張圖）', 'Background (whole image)'), children: [
      { type: 'chips', bind: 'bg.type', options: OPT.bg },
      { type: 'colors', when: s => s.bg.type !== 'none', items: [{ bind: 'bg.color', label: L('顏色', 'Color') }] },
      { type: 'range', bind: 'bg.opacity', when: s => s.bg.type !== 'none', label: L('濃度', 'Opacity'), min: 0, max: 1, step: 0.01, fmt: 'pct' },
      { type: 'toggle', bind: 'bg.sync', when: s => s.bg.type !== 'none', label: L('隨文字登場・退場淡入淡出', 'Fade with the text') }
    ] },
    { type: 'section', label: L('圖像尺寸', 'Image size'), children: [{ type: 'size' }] },
    { type: 'section', label: L('位置', 'Position'), children: [
      { type: 'anchor', bind: 'anchor', label: L('基準位置', 'Anchor') },
      { type: 'range', bind: 'marginX', label: L('左右邊距', 'Side margin'), min: 0, max: 400, step: 1, fmt: 'px' },
      { type: 'range', bind: 'marginY', label: L('上下邊距', 'Top/bottom margin'), min: 0, max: 400, step: 1, fmt: 'px' },
      { type: 'range', bind: 'offsetX', label: L('水平微調', 'Nudge X'), min: -800, max: 800, step: 1, fmt: 'px' },
      { type: 'range', bind: 'offsetY', label: L('垂直微調', 'Nudge Y'), min: -800, max: 800, step: 1, fmt: 'px' }
    ] }
  ]
};

let uid = 0;
const nextId = p => `${p}-${++uid}`;

export class Panel {
  // host: { getState, set(path, value), patch(obj, label), lang(), str(), scene(), toast(msg), fontsChanged() }
  constructor(root, host) {
    this.root = root;
    this.host = host;
    this.tab = 'text';
    this.controls = [];
    this.previewer = null;
  }

  L(v) {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    return v[this.host.lang()] ?? v['zh-TW'];
  }
  val(v, s) { return typeof v === 'function' ? v(s) : v; }

  setTab(tab) { this.tab = tab; this.build(); }

  build() {
    this.stopPreview();
    this.root.replaceChildren();
    this.controls = [];
    for (const item of SCHEMA[this.tab]) this.root.append(this.make(item, this.controls));
    this.refresh();
  }

  refresh() {
    const s = this.host.getState();
    const walk = list => list.forEach(c => c.update(s));
    walk(this.controls);
  }

  make(item, sink) {
    const c = this[`ctl_${item.type}`](item);
    const ctl = {
      node: c.node,
      update: s => {
        const show = !item.when || item.when(s);
        c.node.hidden = !show;
        if (show && c.update) c.update(s);
      }
    };
    sink.push(ctl);
    return c.node;
  }

  field(label, control, opts = {}) {
    const id = control.id || (control.id = nextId('f'));
    const lab = el('label', { class: 'field-label', for: id });
    const node = el('div', { class: `field ${opts.cls || ''}` }, [opts.head ? el('div', { class: 'field-head' }, [lab, opts.head]) : lab, control]);
    return { node, lab };
  }

  /* ---------- 基本控制項 ---------- */

  ctl_textarea(item) {
    const ta = el('textarea', { class: 'text-input', spellcheck: 'false' });
    ta.addEventListener('input', () => this.host.set(item.bind, ta.value));
    const { node, lab } = this.field('', ta);
    return { node, update: s => { lab.textContent = this.L(this.val(item.label, s)); ta.rows = this.val(item.rows, s); if (document.activeElement !== ta) ta.value = getPath(s, item.bind) ?? ''; } };
  }

  ctl_text(item) {
    const input = el('input', { type: 'text', class: 'text-input', spellcheck: 'false' });
    input.addEventListener('input', () => this.host.set(item.bind, input.value));
    const { node, lab } = this.field('', input);
    return { node, update: s => { lab.textContent = this.L(item.label); input.placeholder = this.L(item.placeholder); if (document.activeElement !== input) input.value = getPath(s, item.bind) ?? ''; } };
  }

  ctl_note(item) {
    const node = el('p', { class: 'note' });
    return { node, update: () => { node.textContent = this.L(item.text); } };
  }

  ctl_heading(item) {
    const node = el('h3', { class: 'sub-heading' });
    return { node, update: () => { node.textContent = this.L(item.label); } };
  }

  ctl_dynamicNote(item) {
    const node = el('p', { class: 'note dynamic-note' });
    return {
      node,
      update: s => {
        const str = this.host.str().m;
        const scene = this.host.scene();
        let text = '';
        if (item.key === 'autoFit' && scene?.layout.fit && s.autoFit) text = str.autoFit(scene.layout.fit.from, scene.layout.fit.to);
        if (item.key === 'hold') {
          if (s.holdFx === 'glow' && !s.glow.on) text = str.glowNeeded;
          else if (s.holdFx !== 'none') text = str.holdSizeHint;
        }
        if (item.key === 'duration' && scene) text = str.duration(scene.timeline.duration, scene.layout.pages.length);
        node.textContent = text;
        node.hidden = !text;
      }
    };
  }

  ctl_toggle(item) {
    const input = el('input', { type: 'checkbox', class: 'switch-input' });
    const text = el('span');
    input.addEventListener('change', () => this.host.set(item.bind, input.checked));
    const node = el('label', { class: 'toggle' }, [el('span', { class: 'switch' }, [input, el('span', { class: 'switch-track', 'aria-hidden': 'true' })]), text]);
    return { node, update: s => { text.textContent = this.L(item.label); input.checked = Boolean(getPath(s, item.bind)); } };
  }

  ctl_range(item) {
    const f = FMT[item.fmt] || FMT.px;
    const mul = f.mul || 1;
    const range = el('input', { type: 'range', class: 'range-input', min: item.min, max: item.max, step: item.step });
    const num = el('input', { type: 'number', class: 'number-input', min: item.min * mul, max: item.max * mul, step: item.step * mul, inputmode: 'decimal' });
    const unit = el('span', { class: 'unit' });
    range.addEventListener('input', () => { const v = Number(range.value); num.value = fmtNum(v * mul, f); this.host.set(item.bind, v); });
    num.addEventListener('change', () => {
      let v = Number(num.value) / mul;
      if (!Number.isFinite(v)) return;
      // 數字欄可以輸入超出拉桿範圍的值（字級等），但不能是負的尺寸
      if (item.min >= 0) v = Math.max(0, v);
      this.host.set(item.bind, v);
    });
    const row = el('div', { class: 'range-row' }, [range, el('span', { class: 'num-wrap' }, [num, unit])]);
    const { node, lab } = this.field('', row);
    range.id = nextId('r');
    lab.setAttribute('for', range.id);
    return {
      node,
      update: s => {
        lab.textContent = this.L(this.val(item.label, s));
        unit.textContent = this.L(f.u);
        const v = Number(getPath(s, item.bind));
        if (document.activeElement !== range) range.value = v;
        if (document.activeElement !== num) num.value = fmtNum(v * mul, f);
      }
    };
  }

  ctl_select(item) {
    const sel = el('select', { class: 'select-input' });
    sel.addEventListener('change', () => this.host.set(item.bind, item.numeric ? Number(sel.value) : sel.value));
    const { node, lab } = this.field('', sel);
    let sig = '';
    return {
      node,
      update: s => {
        lab.textContent = this.L(this.val(item.label, s));
        const opts = this.val(item.options, s);
        const nsig = this.host.lang() + JSON.stringify(opts.map(o => o.value));
        if (nsig !== sig) {
          sig = nsig;
          sel.replaceChildren(...opts.map(o => el('option', { value: o.value, text: this.L(o.label) })));
        }
        const cur = getPath(s, item.bind);
        sel.value = String(cur);
        if (sel.value !== String(cur) && opts.length) {
          // 目前的值不在選項中（例：字型不支援這個粗細）→ 換成最接近的
          const pick = item.numeric ? opts.reduce((b, o) => (Math.abs(o.value - cur) < Math.abs(b.value - cur) ? o : b)).value : opts[0].value;
          sel.value = String(pick);
          queueMicrotask(() => this.host.set(item.bind, pick, { silent: true }));
        }
      }
    };
  }

  options(kind, item) {
    const node = el('div', { class: kind === 'chips' ? 'chip-group' : 'segment-group', role: 'group' });
    let sig = '';
    const update = s => {
      const opts = this.val(item.options, s);
      const nsig = this.host.lang() + opts.map(o => o.value).join();
      if (nsig !== sig) {
        sig = nsig;
        node.replaceChildren(...opts.map(o => {
          const b = el('button', { type: 'button', class: kind === 'chips' ? 'chip' : 'segment', 'data-value': o.value, text: this.L(o.label) });
          b.addEventListener('click', () => this.host.set(item.bind, o.value));
          return b;
        }));
      }
      const cur = String(getPath(s, item.bind));
      node.querySelectorAll('button').forEach(b => {
        const on = b.dataset.value === cur;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-pressed', on);
      });
    };
    return { node, update };
  }

  ctl_segment(item) {
    const o = this.options('segment', item);
    if (!item.label) return o;
    const lab = el('span', { class: 'field-label' });
    const node = el('div', { class: 'field' }, [lab, o.node]);
    return { node, update: s => { lab.textContent = this.L(this.val(item.label, s)); o.update(s); } };
  }

  ctl_chips(item) { return this.options('chips', item); }

  ctl_colors(item) {
    const node = el('div', { class: 'color-row' });
    const parts = item.items.map(ci => {
      const input = el('input', { type: 'color', class: 'color-input' });
      const lab = el('span', { class: 'color-label' });
      let clear = null;
      input.addEventListener('input', () => this.host.set(ci.bind, input.value));
      const kids = [input, lab];
      if (ci.optional) {
        clear = el('button', { type: 'button', class: 'color-clear', text: '×', title: 'clear' });
        clear.addEventListener('click', e => { e.preventDefault(); this.host.set(ci.bind, ''); });
        kids.push(clear);
      }
      const wrap = el('label', { class: 'color-field' }, kids);
      node.append(wrap);
      return { ci, input, lab, wrap, clear };
    });
    return {
      node,
      update: s => parts.forEach(p => {
        const show = !p.ci.when || p.ci.when(s);
        p.wrap.hidden = !show;
        if (!show) return;
        const v = getPath(s, p.ci.bind);
        p.lab.textContent = this.L(this.val(p.ci.label, s));
        p.input.value = v || '#ffffff';
        p.wrap.classList.toggle('is-empty', p.ci.optional && !v);
      })
    };
  }

  ctl_section(item) {
    const title = el('h3', { class: 'section-title' });
    const head = el('div', { class: 'section-head' }, [title]);
    const body = el('div', { class: 'section-body' });
    const node = el('section', { class: 'control-section' }, [head, body]);
    let sw = null, input = null;
    const children = [];
    item.children.forEach(ch => body.append(this.make(ch, children)));
    if (item.toggle) {
      input = el('input', { type: 'checkbox', class: 'switch-input' });
      sw = el('label', { class: 'switch' }, [input, el('span', { class: 'switch-track', 'aria-hidden': 'true' })]);
      input.addEventListener('change', () => { const b = this.val(item.toggle, this.host.getState()); if (b) this.host.set(b, input.checked); });
      head.append(sw);
    }
    return {
      node,
      update: s => {
        title.textContent = this.L(this.val(item.label, s));
        const bind = this.val(item.toggle, s);
        let on = true;
        if (sw) { sw.hidden = !bind; if (bind) { on = Boolean(getPath(s, bind)); input.checked = on; } }
        node.classList.toggle('is-off', !on);
        children.forEach(c => c.update(s));
      }
    };
  }

  /* ---------- 效果卡片（滑鼠移上去播小預覽） ---------- */

  ctl_effects(item) {
    const phase = item.phase;
    const defs = phase === 'in' ? IN : OUT;
    const node = el('div', { class: 'effect-grid' });
    const cards = Object.keys(defs).map(id => {
      const canvas = el('canvas', { class: 'effect-canvas', width: 132, height: 72, 'aria-hidden': 'true' });
      const name = el('span', { class: 'effect-name' });
      const card = el('button', { type: 'button', class: 'effect-card', 'data-fx': id }, [canvas, name]);
      card.addEventListener('click', () => {
        const patch = { [`${phase}Fx`]: id };
        const def = defs[id];
        const dirKey = `${phase}Dir`;
        if (def.dirs && !def.dirs.includes(this.host.getState()[dirKey])) patch[dirKey] = def.dirs[0];
        this.host.patch(patch);
      });
      card.addEventListener('pointerenter', () => this.startPreview(canvas, phase, id));
      card.addEventListener('pointerleave', () => this.stopPreview());
      card.addEventListener('focus', () => this.startPreview(canvas, phase, id));
      card.addEventListener('blur', () => this.stopPreview());
      return { id, card, canvas, name, drawn: false };
    });
    node.append(...cards.map(c => c.card));
    return {
      node,
      update: s => {
        const cur = s[`${phase}Fx`];
        cards.forEach(c => {
          c.name.textContent = this.L(FX_LABELS[phase][c.id]);
          c.card.classList.toggle('is-active', c.id === cur);
          c.card.setAttribute('aria-pressed', c.id === cur);
          if (!c.drawn) { c.drawn = true; this.drawStill(c.canvas, phase, c.id); }
        });
      }
    };
  }

  miniState(phase, id) {
    const s = defaults('message');
    merge(s, {
      width: 132, height: 72, text: '文字', subText: '', fontId: 'noto-sans-tc', weight: 900, fontSize: 32, letterSpacing: 0.05,
      marginX: 4, marginY: 4, stroke: { on: false }, shadow: { on: false }, glow: { on: false }, deco: { type: 'none' }, bg: { type: 'none' },
      fill: { type: 'solid', color: getComputedStyle(document.documentElement).getPropertyValue('--fx-ink').trim() || '#222' },
      inFx: 'fade', inDur: 0.6, inStagger: 0.1, outFx: 'fade', outDur: 0.6, outStagger: 0.1, hold: 0.5, startDelay: 0.15, endDelay: 0.35
    });
    if (phase === 'in') { s.inFx = id; s.outFx = 'none'; s.hold = 0.9; }
    else { s.outFx = id; s.inFx = 'fade'; s.inDur = 0.3; s.inStagger = 0; s.hold = 0.4; if (id === 'none') s.hold = 1.5; }
    const def = (phase === 'in' ? IN : OUT)[id];
    if (def?.dirs) s[`${phase}Dir`] = def.dirs[0];
    return s;
  }

  drawStill(canvas, phase, id) {
    Fonts.ensure('noto-sans-tc', 900, '文字').then(() => {
      const scene = createScene(this.miniState(phase, id));
      const r = new Renderer(canvas);
      r.render(scene, phase === 'in' ? scene.timeline.posterTime : scene.timeline.segments.find(x => x.type === 'hold')?.start ?? 0);
    });
  }

  startPreview(canvas, phase, id) {
    this.stopPreview();
    const scene = createScene(this.miniState(phase, id));
    const r = new Renderer(canvas);
    const t0 = performance.now();
    const tick = now => {
      const t = ((now - t0) / 1000) % scene.timeline.duration;
      r.render(scene, t);
      this.previewer = requestAnimationFrame(tick);
    };
    this.previewer = requestAnimationFrame(tick);
    this.previewCanvas = { canvas, phase, id };
  }

  stopPreview() {
    if (this.previewer) cancelAnimationFrame(this.previewer);
    this.previewer = null;
    if (this.previewCanvas) {
      const { canvas, phase, id } = this.previewCanvas;
      this.previewCanvas = null;
      this.drawStill(canvas, phase, id);
    }
  }

  /* ---------- 字型挑選器 ---------- */

  ctl_fontPicker(item) {
    const current = el('button', { type: 'button', class: 'font-current', 'aria-expanded': 'false' });
    const panel = el('div', { class: 'font-panel', hidden: true });
    const cats = el('div', { class: 'chip-group compact' });
    const listNode = el('div', { class: 'font-list', role: 'listbox' });
    const upload = el('input', { type: 'file', accept: '.ttf,.otf,.woff,.woff2', class: 'visually-hidden' });
    const uploadBtn = el('button', { type: 'button', class: 'mini-button' });
    const localInput = el('input', { type: 'text', class: 'text-input', spellcheck: 'false' });
    const localBtn = el('button', { type: 'button', class: 'mini-button' });
    const tools = el('div', { class: 'font-tools' }, [uploadBtn, upload, el('div', { class: 'local-font' }, [localInput, localBtn])]);
    panel.append(cats, listNode, tools);
    const { node, lab } = this.field('', el('div', { class: 'font-picker' }, [current, panel]));
    let cat = null;
    let pendingRemove = null;
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        observer.unobserve(e.target);
        const id = e.target.dataset.font;
        Fonts.preview(id, e.target.querySelector('.font-sample').textContent).then(() => e.target.classList.add('is-loaded'));
      });
    }, { root: listNode, rootMargin: '80px' }) : null;

    const sample = () => (this.host.lang() === 'en' ? 'Battle Start 戰鬥開始' : '戰鬥開始 Battle');
    const renderList = () => {
      const s = this.host.getState();
      const fonts = Fonts.list().filter(f => f.cat === cat);
      listNode.replaceChildren(...fonts.map(f => {
        const sampleNode = el('span', { class: 'font-sample', text: sample() });
        sampleNode.style.fontFamily = Fonts.familyStack(f.id);
        const card = el('div', { class: 'font-card', role: 'option', tabindex: '0', 'data-font': f.id, 'aria-selected': f.id === s[item.bind] }, [
          el('span', { class: 'font-name', text: Fonts.label(f) }), sampleNode
        ]);
        card.classList.toggle('is-active', f.id === s[item.bind]);
        const choose = () => { this.host.set(item.bind, f.id); close(); };
        card.addEventListener('click', choose);
        card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
        if (f.cat === 'user') {
          const rm = el('button', { type: 'button', class: 'font-remove', text: '×', 'aria-label': 'remove' });
          rm.addEventListener('click', async e => {
            e.stopPropagation();
            if (pendingRemove !== f.id) { pendingRemove = f.id; rm.classList.add('is-armed'); rm.textContent = this.host.lang() === 'en' ? 'Remove?' : '確定移除？'; return; }
            await Fonts.removeUserFont(f.id);
            this.host.toast(this.host.str().m.fontRemoved(Fonts.label(f)));
            if (this.host.getState().fontId === f.id) this.host.set('fontId', 'noto-sans-tc');
            this.host.fontsChanged();
            renderList();
          });
          card.append(rm);
        }
        if (observer) observer.observe(card); else Fonts.preview(f.id, sample());
        return card;
      }));
      if (!fonts.length) listNode.append(el('p', { class: 'note', text: this.host.lang() === 'en' ? 'No fonts yet. Add one below.' : '還沒有字型。可從下方加入。' }));
    };
    const renderCats = () => {
      cats.replaceChildren(...Fonts.CATEGORIES.map(c => {
        const b = el('button', { type: 'button', class: 'chip', text: this.L(c.label) });
        b.classList.toggle('is-active', c.id === cat);
        b.addEventListener('click', () => { cat = c.id; renderCats(); renderList(); });
        return b;
      }));
    };
    const open = () => {
      panel.hidden = false;
      current.setAttribute('aria-expanded', 'true');
      cat = Fonts.get(this.host.getState()[item.bind])?.cat || 'sans';
      renderCats();
      renderList();
    };
    const close = () => { panel.hidden = true; current.setAttribute('aria-expanded', 'false'); pendingRemove = null; };
    current.addEventListener('click', () => (panel.hidden ? open() : close()));
    uploadBtn.addEventListener('click', () => upload.click());
    upload.addEventListener('change', async () => {
      const file = upload.files[0];
      upload.value = '';
      if (!file) return;
      const m = this.host.str().m;
      try {
        const res = await Fonts.addFontFile(file);
        this.host.toast(res.duplicate ? m.fontDuplicate(res.font.label) : res.saved ? m.fontAdded(res.font.label) : m.fontSessionOnly(res.font.label));
        this.host.fontsChanged();
        this.host.set(item.bind, res.font.id);
        cat = 'user';
        renderCats(); renderList();
      } catch {
        this.host.toast(m.fontAddFailed);
      }
    });
    localBtn.addEventListener('click', async () => {
      const name = localInput.value.trim();
      if (!name) return;
      const m = this.host.str().m;
      const f = await Fonts.addLocalFont(name);
      if (!f) { this.host.toast(m.localMissing(name)); return; }
      this.host.toast(m.localAdded(name));
      localInput.value = '';
      this.host.fontsChanged();
      this.host.set(item.bind, f.id);
      cat = 'user';
      renderCats(); renderList();
    });
    return {
      node,
      update: s => {
        lab.textContent = this.L(item.label);
        const f = Fonts.get(s[item.bind]);
        current.replaceChildren(el('span', { class: 'font-current-name', text: Fonts.label(f) || s[item.bind] }), el('span', { class: 'chev', 'aria-hidden': 'true', text: '▾' }));
        current.style.fontFamily = Fonts.familyStack(s[item.bind]);
        const en = this.host.lang() === 'en';
        uploadBtn.textContent = en ? '+ Add your own font' : '＋ 加入自己的字型';
        localInput.placeholder = en ? 'Installed font name (e.g. Meiryo)' : '電腦已安裝的字型名稱（例：微軟正黑體）';
        localBtn.textContent = en ? 'Use' : '使用';
      }
    };
  }

  /* ---------- 樣式・漸層預設 ---------- */

  ctl_stylePresets(item) {
    const lab = el('h3', { class: 'section-title' });
    const group = el('div', { class: 'chip-group' });
    STYLE_PRESETS.forEach(p => {
      const b = el('button', { type: 'button', class: 'chip style-chip', 'data-preset': p.id });
      b.addEventListener('click', () => {
        this.host.patch(clone(p.patch));
        this.host.toast(this.host.str().m.styleApplied(this.L(p.label)));
      });
      group.append(b);
    });
    const node = el('section', { class: 'control-section' }, [el('div', { class: 'section-head' }, [lab]), group]);
    return { node, update: () => { lab.textContent = this.L(item.label); group.querySelectorAll('button').forEach((b, i) => { b.textContent = this.L(STYLE_PRESETS[i].label); }); } };
  }

  ctl_gradientPresets() {
    const node = el('div', { class: 'swatch-row' });
    GRADIENT_PRESETS.forEach(([a, b, c]) => {
      const btn = el('button', { type: 'button', class: 'swatch', 'aria-label': `${a} → ${b}` });
      btn.style.background = `linear-gradient(180deg, ${a}, ${b}${c ? `, ${c}` : ''})`;
      btn.addEventListener('click', () => this.host.patch({ fill: { type: 'gradient', color: a, color2: b, color3: c } }));
      node.append(btn);
    });
    return { node };
  }

  /* ---------- 九宮格位置 ---------- */

  ctl_anchor(item) {
    const grid = el('div', { class: 'anchor-grid', role: 'group' });
    const cells = [];
    for (const r of ['t', 'm', 'b']) for (const c of ['l', 'c', 'r']) {
      const key = r + c;
      const b = el('button', { type: 'button', class: 'anchor-cell', 'data-value': key, 'aria-label': key }, [el('span', { class: 'anchor-dot' })]);
      b.addEventListener('click', () => this.host.set(item.bind, key));
      grid.append(b);
      cells.push(b);
    }
    const lab = el('span', { class: 'field-label' });
    const node = el('div', { class: 'field' }, [lab, grid]);
    return { node, update: s => { lab.textContent = this.L(item.label); cells.forEach(b => b.classList.toggle('is-active', b.dataset.value === s[item.bind])); } };
  }

  /* ---------- 尺寸 ---------- */

  ctl_size() {
    const sel = el('select', { class: 'select-input' });
    const w = el('input', { type: 'number', class: 'number-input', min: 32, max: 3840, step: 1 });
    const h = el('input', { type: 'number', class: 'number-input', min: 32, max: 3840, step: 1 });
    const swap = el('button', { type: 'button', class: 'mini-button', text: '⇄', title: 'swap' });
    const row = el('div', { class: 'size-row' }, [w, el('span', { text: '×' }), h, el('span', { text: 'px' }), swap]);
    const node = el('div', { class: 'field' }, [sel, row]);
    const clampSize = v => Math.max(32, Math.min(3840, Math.round(Number(v) || 0)));
    sel.addEventListener('change', () => {
      const p = SIZE_PRESETS.find(x => x.id === sel.value);
      if (p) this.host.patch({ width: p.w, height: p.h });
    });
    w.addEventListener('change', () => this.host.patch({ width: clampSize(w.value) }));
    h.addEventListener('change', () => this.host.patch({ height: clampSize(h.value) }));
    swap.addEventListener('click', () => { const s = this.host.getState(); this.host.patch({ width: s.height, height: s.width }); });
    return {
      node,
      update: s => {
        const custom = this.host.lang() === 'en' ? 'Custom' : '自訂';
        sel.replaceChildren(...SIZE_PRESETS.map(p => el('option', { value: p.id, text: p.label })), el('option', { value: 'custom', text: custom }));
        const hit = SIZE_PRESETS.find(p => p.w === s.width && p.h === s.height);
        sel.value = hit ? hit.id : 'custom';
        if (document.activeElement !== w) w.value = s.width;
        if (document.activeElement !== h) h.value = s.height;
      }
    };
  }
}

const fmtNum = (v, f) => String(Number(v.toFixed(f.d)));
