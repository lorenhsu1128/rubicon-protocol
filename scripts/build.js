// 建置：src/ → dist/rubicon-protocol.html（單一檔案，CSS／JS／音效全部內嵌，可直接開啟或由伺服器提供）
// 用法：node scripts/build.js [--dev] [--watch]
//   --dev    不壓縮、附 inline source map，方便在瀏覽器除錯
//   --watch  監看 src/ 變更自動重建（隱含 --dev）
'use strict';
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const OUT = path.join(ROOT, 'dist', 'rubicon-protocol.html');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

const CSS_TAG = /<link rel="stylesheet" href="\.\/styles\.css"\s*\/?>/;
const JS_TAG = /<script type="module" src="\.\/main\.js"><\/script>/;

function inject(html, tag, content) {
  if (!tag.test(html)) throw new Error(`src/index.html 找不到 ${tag}`);
  return html.replace(tag, () => content); // 用函式避免 $ 被當成替換樣式
}

async function writeHtml(js) {
  const css = await esbuild.transform(fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8'), {
    loader: 'css',
    minify: !dev,
    charset: 'utf8',
  });
  let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
  html = inject(html, CSS_TAG, `<style>\n${css.code}</style>`);
  html = inject(html, JS_TAG, `<script>\n${js}</script>`);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html);
  console.log(
    `[build] ${path.relative(ROOT, OUT)}  ${(html.length / 1024).toFixed(0)} KB${dev ? '（dev）' : ''}`,
  );
}

const options = {
  entryPoints: [path.join(SRC, 'main.js')],
  bundle: true,
  format: 'iife', // 一般 <script>：file:// 直接開啟也能執行
  target: 'es2020',
  charset: 'utf8', // 保留中文與全形空白，不轉成 \u 跳脫
  loader: { '.mp3': 'base64' },
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
            await writeHtml(r.outputFiles[0].text);
          } catch (e) {
            console.error('[build] ' + e.message);
          }
        });
      },
    },
  ],
};

async function main() {
  if (!watch) {
    const r = await esbuild.build(options);
    if (r.errors.length) process.exit(1);
    return;
  }
  const ctx = await esbuild.context(options);
  await ctx.watch();
  // esbuild 只監看 JS 相依；HTML／CSS 另外監看
  for (const f of ['index.html', 'styles.css'])
    fs.watch(path.join(SRC, f), () => ctx.rebuild().catch(() => {}));
  console.log('[build] 監看 src/ 中，Ctrl+C 結束');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
