// 建置：每個頁面打包成 dist/ 下的單一 HTML（CSS／JS／音效／模型全部內嵌，可直接開啟或由伺服器提供）
//   src/index.html          → dist/rubicon-protocol.html（遊戲）
//   src/library/index.html  → dist/model-library.html（模型庫）
// 用法：node scripts/build.js [--dev] [--watch]
//   --dev    不壓縮、附 inline source map，方便在瀏覽器除錯
//   --watch  監看 src/ 變更自動重建（隱含 --dev）
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const PAGES = [
  { name: '遊戲', dir: SRC, out: 'rubicon-protocol.html' },
  { name: '模型庫', dir: path.join(SRC, 'library'), out: 'model-library.html' },
];
// 頁面模板中的 <link rel="stylesheet" href="./x.css"> 與 <script type="module" src="./x.js"> 會被替換成內嵌內容
const CSS_TAG = /<link rel="stylesheet" href="\.\/([\w-]+\.css)"\s*\/?>/;
const JS_TAG = /<script type="module" src="\.\/([\w-]+\.js)"><\/script>/;

function readTemplate(page) {
  const html = fs.readFileSync(path.join(page.dir, 'index.html'), 'utf8');
  const css = html.match(CSS_TAG),
    js = html.match(JS_TAG);
  if (!css || !js) throw new Error(`${page.dir}/index.html 缺少 styles 或 module script 標籤`);
  return { html, css: path.join(page.dir, css[1]), entry: path.join(page.dir, js[1]) };
}

async function writeHtml(page, js) {
  const t = readTemplate(page);
  const css = await esbuild.transform(fs.readFileSync(t.css, 'utf8'), {
    loader: 'css',
    minify: !dev,
    charset: 'utf8',
  });
  let html = t.html.replace(CSS_TAG, () => `<style>\n${css.code}</style>`); // 用函式避免 $ 被當成替換樣式
  html = html.replace(JS_TAG, () => `<script>\n${js}</script>`);
  fs.mkdirSync(DIST, { recursive: true });
  const out = path.join(DIST, page.out);
  fs.writeFileSync(out, html);
  console.log(
    `[build] ${path.relative(ROOT, out)}  ${(html.length / 1024).toFixed(0)} KB${dev ? '（dev）' : ''}`,
  );
}

const options = (page) => ({
  entryPoints: [readTemplate(page).entry],
  bundle: true,
  format: 'iife', // 一般 <script>：file:// 直接開啟也能執行
  target: 'es2020',
  charset: 'utf8', // 保留中文與全形空白，不轉成 \u 跳脫
  loader: { '.mp3': 'base64', '.glb': 'binary' },
  minify: !dev,
  sourcemap: dev ? 'inline' : false,
  write: false,
  logLevel: 'warning',
  plugins: [
    {
      name: 'inline-html',
      setup(build) {
        build.onEnd(async (r) => {
          if (r.errors.length) return;
          try {
            await writeHtml(page, r.outputFiles[0].text);
          } catch (e) {
            console.error('[build] ' + e.message);
          }
        });
      },
    },
  ],
});

async function main() {
  if (!watch) {
    for (const page of PAGES) {
      const r = await esbuild.build(options(page));
      if (r.errors.length) process.exit(1);
    }
    return;
  }
  for (const page of PAGES) {
    const ctx = await esbuild.context(options(page));
    await ctx.watch();
    // esbuild 只監看 JS 相依；HTML／CSS 另外監看
    const t = readTemplate(page);
    for (const f of [path.join(page.dir, 'index.html'), t.css])
      fs.watch(f, () => ctx.rebuild().catch(() => {}));
  }
  console.log('[build] 監看 src/ 中，Ctrl+C 結束');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
