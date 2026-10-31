// 粒子特效的圖集（docs/vfx-design.md）：把 Kenney Particle Pack（CC0）挑出來的灰階貼圖縮成 256 px 的格子，
// 打包成一張 2048×1024 的 RGB 圖（8×4 格 × R／G／B 三個通道＝96 格），輸出 src/assets/fx/atlas.png 與 atlas.json（名稱 → 格號）。
//   node scripts/fx-atlas.js --src=<kenney_particle_pack 資料夾>
// 格號＝通道 × 32 ＋ 格子（列 × 8 ＋ 行）；著色器以格號取通道與位置（fx/gpu.js）。
// 原圖是白色＋透明度，這裡以透明度當灰階值（黑底上畫白色）。只需要在換貼圖時執行一次（用 Edge／Chrome 的畫布縮圖與輸出 PNG）。
/* global document, Image -- page.evaluate 的回呼在瀏覽器端執行 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'src', 'assets', 'fx');
const SRC = (process.argv.find((a) => a.startsWith('--src=')) || '').slice(6);
// 用到的貼圖（照這個順序排格號；名稱＝檔名去掉 .png）
const NAMES = [
  ...['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((n) => 'smoke_' + n),
  'fire_01',
  'fire_02',
  ...['01', '02', '03', '04', '05', '06'].map((n) => 'flame_' + n),
  'flare_01',
  'light_01',
  'light_02',
  'light_03',
  ...['01', '02', '03', '04', '05'].map((n) => 'circle_' + n),
  ...['01', '02', '03', '04', '05', '06', '07'].map((n) => 'spark_' + n),
  ...['01', '02', '04', '06', '07', '08', '09'].map((n) => 'star_' + n),
  ...['01', '02', '03', '04', '05', '06', '07'].map((n) => 'trace_' + n),
  ...['01', '02', '03', '04', '05'].map((n) => 'magic_' + n),
  ...['01', '02', '03', '04', '05'].map((n) => 'muzzle_' + n),
  'scorch_01',
  'scorch_02',
  'scorch_03',
  'dirt_01',
  'dirt_02',
  'dirt_03',
  'twirl_01',
  'twirl_02',
  'twirl_03',
  ...['01', '02', '03', '04'].map((n) => 'slash_' + n),
  'scratch_01',
];
const EXE = [
  process.env.BENCH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && fs.existsSync(p));

(async () => {
  if (!SRC || !fs.existsSync(SRC)) throw new Error('要用 --src= 指定 Kenney Particle Pack 的資料夾');
  const imgs = NAMES.map((n) => {
    const f = path.join(SRC, n + '.png');
    if (!fs.existsSync(f)) throw new Error('找不到 ' + f);
    return 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
  });
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  try {
    const p = await b.newPage();
    const png = await p.evaluate(async (imgs) => {
      const CELL = 256,
        PAD = 6,
        W = 2048,
        H = 1024;
      const out = document.createElement('canvas');
      out.width = W;
      out.height = H;
      const o = out.getContext('2d');
      const od = o.createImageData(W, H);
      for (let i = 3; i < od.data.length; i += 4) od.data[i] = 255;
      const c = document.createElement('canvas');
      c.width = c.height = CELL;
      const x = c.getContext('2d');
      for (let i = 0; i < imgs.length; i++) {
        const im = new Image();
        im.src = imgs[i];
        await im.decode();
        x.clearRect(0, 0, CELL, CELL);
        x.drawImage(im, PAD, PAD, CELL - PAD * 2, CELL - PAD * 2);
        const d = x.getImageData(0, 0, CELL, CELL).data;
        const ch = Math.floor(i / 32),
          cell = i % 32,
          cx = (cell % 8) * CELL,
          cy = Math.floor(cell / 8) * CELL;
        for (let yy = 0; yy < CELL; yy++)
          for (let xx = 0; xx < CELL; xx++) {
            const s = (yy * CELL + xx) * 4;
            // 白色＋透明度：灰階值＝亮度 × 透明度
            const v = Math.round(((d[s] + d[s + 1] + d[s + 2]) / 765) * d[s + 3]);
            od.data[((cy + yy) * W + cx + xx) * 4 + ch] = v;
          }
      }
      o.putImageData(od, 0, 0);
      return out.toDataURL('image/png');
    }, imgs);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'atlas.png'), Buffer.from(png.split(',')[1], 'base64'));
    const map = {};
    NAMES.forEach((n, i) => (map[n] = i));
    fs.writeFileSync(path.join(OUT, 'atlas.json'), JSON.stringify(map, null, 1) + '\n');
    console.log('atlas.png', fs.statSync(path.join(OUT, 'atlas.png')).size, 'bytes,', NAMES.length, 'cells');
  } finally {
    await b.close();
  }
})();
