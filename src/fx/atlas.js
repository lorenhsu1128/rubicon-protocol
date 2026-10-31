// ============================================================
//  粒子特效的圖集（docs/vfx-design.md）：2048×1024、8×4 格（每格 256 px）× R／G／B 三個通道＝96 格，
//  格號＝通道 × 32 ＋ 格子（列 × 8 ＋ 行），灰階值＝粒子的透明度。
//  0～71：Kenney Particle Pack（CC0，src/assets/fx/atlas.png，scripts/fx-atlas.js 產生），建置成 dist/lib/fx-assets.js；
//  72 以後：程式產生的形狀（T1）。素材載入前或載不到時，整張由程式產生（同樣的格號，形狀近似）。
//  遊戲與模型庫共用一張貼圖（FXA.tex，所有粒子系統的 uniform 指向它，載入後只換圖片）。
// ============================================================
import ATLAS from '../assets/fx/atlas.json';

const CELLS_X = 8,
  CELLS_Y = 4;
// 程式產生的格（72 以後）
export const SOFT = 72, // 柔邊圓點（高斯）
  HARD = 73, // 硬邊圓點
  RING = 74, // 細環
  PUFF = 75, // 柔和的雜訊煙團
  LINE = 76, // 直線（上下兩端漸細）：火花、曳光、光束
  SHARD = 77, // 尖角碎片（火星）
  CORE = 78, // 很亮的小核心＋柔和外圈（爆炸、閃光）
  BEAM = 79; // 直線（兩端不漸細）：光束
// 名稱 → 格號（Kenney 的檔名去掉 .png，例如 smoke_03）
export const FXC = {
  ...ATLAS,
  soft: SOFT,
  hard: HARD,
  ring: RING,
  puff: PUFF,
  line: LINE,
  shard: SHARD,
  core: CORE,
  beam: BEAM,
};
// 一組裡挑一個（煙、火焰…）
const range = (pre, a, b) => {
  const r = [];
  for (let i = a; i <= b; i++) r.push(FXC[pre + '_' + String(i).padStart(2, '0')]);
  return r;
};
export const FXG = {
  smoke: range('smoke', 2, 9), // smoke_01 是點點狀、smoke_10 是甜甜圈形，不當一般的煙
  fire: [FXC.fire_01, FXC.fire_02],
  flame: range('flame', 1, 6),
  tongue: [FXC.flame_05, FXC.flame_06],
  light: range('light', 1, 3),
  circle: range('circle', 1, 5),
  spark: range('spark', 1, 7),
  zap: range('spark', 1, 5), // 電擊（spark_01～05 是電弧）
  star: [FXC.star_01, FXC.star_02, FXC.star_04, FXC.star_06, FXC.star_07, FXC.star_08, FXC.star_09],
  trace: range('trace', 1, 7),
  magic: range('magic', 1, 5),
  muzzle: range('muzzle', 1, 5),
  scorch: range('scorch', 1, 3),
  dirt: range('dirt', 1, 3),
  twirl: range('twirl', 1, 3),
  slash: range('slash', 1, 4),
};
export const pickCell = (g) => g[Math.floor(Math.random() * g.length)];

export const FXA = { tex: null, ready: false, failed: false, p: null };
if (/[?&]test\b/.test(location.search)) window.__FXA = FXA; // 冒煙測試等圖集載入完

// ---- 程式產生（T1） ----
// 每格的灰階形狀：f(x, y) → 0～1，x／y 是格子裡 -1～1 的座標（y 往上）
function hash(i, j, s) {
  const h = Math.sin(i * 127.1 + j * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, s) {
  const i = Math.floor(x),
    j = Math.floor(y),
    fx = x - i,
    fy = y - j;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = hash(i, j, s),
    b = hash(i + 1, j, s),
    c = hash(i, j + 1, s),
    d = hash(i + 1, j + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) =>
  vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 3) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 7) * 0.15;
const sstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const SHAPES = {
  soft: (x, y) => Math.exp(-(x * x + y * y) * 4.5) * sstep(1, 0.85, Math.hypot(x, y)),
  hard: (x, y) => sstep(0.82, 0.74, Math.hypot(x, y)),
  ring: (x, y) => {
    const r = Math.hypot(x, y);
    return Math.exp(-((r - 0.82) ** 2) / 0.004);
  },
  puff: (x, y, s) => {
    const r = Math.hypot(x, y);
    const n = fbm(x * 2.2 + 5, y * 2.2 + 5, s);
    return sstep(0.95, 0.35, r + (n - 0.5) * 0.55) * (0.55 + 0.45 * n);
  },
  line: (x, y) => Math.exp(-(x * x) / 0.02) * sstep(1, 0.55, Math.abs(y)),
  beam: (x, y) =>
    Math.min(1, Math.exp(-(x * x) / 0.012) + 0.35 * Math.exp(-(x * x) / 0.15)) * sstep(1, 0.92, Math.abs(y)),
  shard: (x, y) => sstep(0.06, 0, Math.abs(x) - (1 - Math.abs(y)) * 0.28) * sstep(1, 0.8, Math.abs(y)),
  core: (x, y) => {
    const r = Math.hypot(x, y);
    return Math.min(1, Math.exp(-r * r * 30) + 0.55 * Math.exp(-r * r * 4)) * sstep(1, 0.85, r);
  },
  // Kenney 沒載到時的近似形狀（依名稱的前綴）
  smoke: (x, y, s) => SHAPES.puff(x, y, s) * 0.85,
  fire: (x, y, s) => SHAPES.puff(x * 1.1, y * 1.1, s),
  flame: (x, y, s) => {
    const w = 0.45 * sstep(1, -0.6, y) * sstep(-1, -0.55, y);
    return (
      sstep(w, w * 0.4, Math.abs(x + (fbm(0, y * 3, s) - 0.5) * 0.3)) * (0.7 + 0.3 * fbm(x * 4, y * 4, s))
    );
  },
  light: (x, y) => SHAPES.soft(x, y),
  flare: (x, y) => SHAPES.core(x, y),
  circle: (x, y) => SHAPES.ring(x, y),
  spark: (x, y) => Math.max(SHAPES.line(x, y), SHAPES.line(y, x)) * sstep(1, 0.3, Math.hypot(x, y)),
  star: (x, y) => Math.max(SHAPES.core(x, y), Math.max(SHAPES.line(x, y), SHAPES.line(y, x)) * 0.8),
  trace: (x, y) => SHAPES.line(x * 1.6, y),
  magic: (x, y) => Math.max(SHAPES.ring(x, y), SHAPES.core(x, y) * 0.6),
  muzzle: (x, y, s) => SHAPES.flame(x, y, s),
  scorch: (x, y, s) => sstep(0.9, 0.4, Math.hypot(x, y) + (fbm(x * 3, y * 3, s) - 0.5) * 0.8),
  dirt: (x, y, s) => (fbm(x * 6, y * 6, s) > 0.62 ? 1 : 0) * sstep(1, 0.5, Math.hypot(x, y)),
  twirl: (x, y) => {
    const r = Math.hypot(x, y),
      a = Math.atan2(y, x);
    return Math.exp(-((r - 0.7) ** 2) / 0.01) * sstep(-Math.PI, Math.PI, a);
  },
  slash: (x, y) => {
    const r = Math.hypot(x, y + 0.6);
    return Math.exp(-((r - 1.1) ** 2) / 0.006) * sstep(0.9, 0.2, Math.abs(x)) * (y > -0.6 ? 1 : 0);
  },
  scratch: (x, y) => SHAPES.line(x - y * 0.3, y),
};
const SLOT_SHAPE = {
  [SOFT]: 'soft',
  [HARD]: 'hard',
  [RING]: 'ring',
  [PUFF]: 'puff',
  [LINE]: 'line',
  [SHARD]: 'shard',
  [CORE]: 'core',
  [BEAM]: 'beam',
};
for (const [n, i] of Object.entries(ATLAS)) SLOT_SHAPE[i] = n.replace(/_\d+$/, '');

// 把一格畫進 ImageData（W×H、格子 C px）的某個通道
function paintCell(img, W, C, slot, shape) {
  const f = SHAPES[shape];
  if (!f) return;
  const ch = Math.floor(slot / 32),
    cell = slot % 32;
  const cx = (cell % CELLS_X) * C,
    cy = Math.floor(cell / CELLS_X) * C;
  const pad = Math.max(2, Math.round(C * 0.025)),
    in_ = C - pad * 2;
  const d = img.data;
  for (let yy = 0; yy < in_; yy++)
    for (let xx = 0; xx < in_; xx++) {
      const x = ((xx + 0.5) / in_) * 2 - 1,
        y = 1 - ((yy + 0.5) / in_) * 2;
      const v = Math.max(0, Math.min(1, f(x, y, slot)));
      d[((cy + pad + yy) * W + cx + pad + xx) * 4 + ch] = Math.round(v * 255);
    }
}
// 整張程式產生（kenney＝false）或只補 72 以後的格（kenney＝true，畫在已經放好的 Kenney 圖上）
function buildCanvas(kenneyImg) {
  // 程式產生的備用版小一點（每格 64 px），啟動時不卡；Kenney 的是原尺寸
  const W = kenneyImg ? 2048 : 512,
    H = W / 2,
    C = W / CELLS_X;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const x = cv.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, W, H);
  if (kenneyImg) x.drawImage(kenneyImg, 0, 0, W, H);
  const img = x.getImageData(0, 0, W, H);
  for (const [slot, shape] of Object.entries(SLOT_SHAPE))
    if (!kenneyImg || +slot >= 72) paintCell(img, W, C, +slot, shape);
  x.putImageData(img, 0, 0);
  return cv;
}

// 貼圖（第一次呼叫時以程式產生的版本建立，之後 loadFxAssets 換成 Kenney 的）
export function fxAtlasTex() {
  if (FXA.tex) return FXA.tex;
  const t = new THREE.CanvasTexture(buildCanvas(null));
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  FXA.tex = t;
  loadFxAssets(); // 背景載入 Kenney 的圖集，好了就換圖片
  return t;
}

// 載入 lib/fx-assets.js（window.RUBICON_FX＝{ 'atlas.png': base64 }）；只做一次，回傳 Promise<boolean>
export function loadFxAssets() {
  if (FXA.p) return FXA.p;
  FXA.p = (async () => {
    try {
      if (!window.RUBICON_FX) {
        const ok = await new Promise((res) => {
          const s = document.createElement('script');
          s.src = 'lib/fx-assets.js';
          s.onload = () => res(!!window.RUBICON_FX);
          s.onerror = () => res(false);
          document.head.appendChild(s);
        });
        if (!ok) throw new Error('沒有 lib/fx-assets.js');
      }
      const img = new Image();
      img.src = 'data:image/png;base64,' + window.RUBICON_FX['atlas.png'];
      await img.decode();
      const tex = fxAtlasTex();
      tex.image = buildCanvas(img);
      tex.needsUpdate = true;
      window.RUBICON_FX = null;
      FXA.ready = true;
    } catch (e) {
      console.warn('粒子貼圖載入失敗，改用程式產生的：', e && e.message);
      FXA.failed = true;
    }
    return FXA.ready;
  })();
  return FXA.p;
}
