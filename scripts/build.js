// 建置：每個頁面打包成 dist/ 下的單一 HTML（CSS／JS／音效／模型全部內嵌，可直接開啟或由伺服器提供）
//   src/index.html          → dist/rubicon-protocol.html（遊戲）
//   src/library/index.html  → dist/model-library.html（模型庫）
// 外部程式庫（three.js r128、PeerJS）不內嵌：頁面模板裡的 <script src="lib/<套件>/<路徑>"> 由 node_modules
// 複製到 dist/lib/ 同樣的路徑；另外產生 dist/lib/draco/draco-decoder.js（Draco 解碼器，見 render/glb.js）
// 與 draco-encoder.js（Draco 編碼器，見 library/editor-opt.js）
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

const LIB = path.join(DIST, 'lib');
const NODE_MODULES = path.join(ROOT, 'node_modules');
// 頁面引用的程式庫：lib/<套件>/<路徑> → node_modules/<套件>/<路徑>
const LIB_TAG = /<script src="lib\/([^"]+)"><\/script>/g;
function copyLibs(html) {
  for (const m of html.matchAll(LIB_TAG)) {
    const from = path.join(NODE_MODULES, m[1]);
    if (!fs.existsSync(from)) throw new Error(`找不到 ${path.relative(ROOT, from)}（請先執行 npm install）`);
    const to = path.join(LIB, m[1]);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
// Draco 解碼器：直接開檔（file://）時瀏覽器不讓網頁用 fetch 讀本地的 wasm，所以把 wasm 包裝程式與 wasm（base64）
// 寫成一般的 JS 檔，用 <script> 載入（第一次遇到 Draco 壓縮的 GLB 才載入）
function writeDraco() {
  const dir = path.join(NODE_MODULES, 'three/examples/js/libs/draco/gltf');
  const wrapper = fs.readFileSync(path.join(dir, 'draco_wasm_wrapper.js'), 'utf8');
  const wasm = fs.readFileSync(path.join(dir, 'draco_decoder.wasm')).toString('base64');
  const out = path.join(LIB, 'draco', 'draco-decoder.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(
    out,
    '// three.js r128 的 Draco 解碼器（examples/js/libs/draco/gltf），由 scripts/build.js 產生\n' +
      `window.RUBICON_DRACO = { wrapper: ${JSON.stringify(wrapper)}, wasm: ${JSON.stringify(wasm)} };\n`,
  );
  // Draco 編碼器（純 JS，定義全域 DracoEncoderModule）：模型庫的 GLB 編輯器輸出 Draco 壓縮時才以 <script> 載入
  fs.copyFileSync(path.join(dir, 'draco_encoder.js'), path.join(LIB, 'draco', 'draco-encoder.js'));
}

const PAGES = [
  { name: '遊戲', dir: SRC, out: 'rubicon-protocol.html' },
  { name: '模型庫', dir: path.join(SRC, 'library'), out: 'model-library.html' },
];
// src/assets/models/ 下的 GLB 會自動內嵌：import BUILTIN_MODELS from 'virtual:models' 取得 { '槽位 id': Uint8Array }
const MODELS_DIR = path.join(SRC, 'assets', 'models');
function listModels(dir = MODELS_DIR, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listModels(p, out);
    else if (/\.glb$/i.test(e.name)) out.push(p);
  }
  return out;
}
const modelsPlugin = {
  name: 'models-index',
  setup(build) {
    build.onResolve({ filter: /^virtual:models$/ }, () => ({ path: 'models-index', namespace: 'models' }));
    build.onLoad({ filter: /.*/, namespace: 'models' }, () => {
      const files = listModels();
      const imports = files.map((f, i) => `import m${i} from ${JSON.stringify(f)};`);
      const map = files.map((f, i) => {
        const id = path
          .relative(MODELS_DIR, f)
          .split(path.sep)
          .join('/')
          .replace(/\.glb$/i, '');
        return `${JSON.stringify(id)}: m${i}`;
      });
      return {
        contents: imports.join('\n') + `\nexport default { ${map.join(', ')} };\n`,
        resolveDir: SRC,
        loader: 'js',
        watchDirs: fs.existsSync(MODELS_DIR) ? [MODELS_DIR] : [],
        watchFiles: files,
      };
    });
    // 關節設定 src/assets/models/joints.json（沒有則為空物件）：import JOINTS from 'virtual:joints'
    build.onResolve({ filter: /^virtual:joints$/ }, () => ({ path: 'joints', namespace: 'joints' }));
    build.onLoad({ filter: /.*/, namespace: 'joints' }, () => {
      const f = path.join(MODELS_DIR, 'joints.json');
      const has = fs.existsSync(f);
      return {
        contents: has ? fs.readFileSync(f, 'utf8') : '{}',
        loader: 'json',
        watchFiles: has ? [f] : [],
        watchDirs: fs.existsSync(MODELS_DIR) ? [MODELS_DIR] : [],
      };
    });
  },
};

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
  copyLibs(t.html);
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
    modelsPlugin,
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

// 文字動畫 APNG 產生器（子專案 rubicon_apng_gen/，自己的 git 版本庫）：純靜態網站，原樣複製到 dist/apng/，
// 伺服器在 /apng/ 提供。子專案不存在時（只 clone 主專案）保留 dist/apng/ 現有的檔案
const APNG_SRC = path.join(ROOT, 'rubicon_apng_gen');
const APNG_OUT = path.join(DIST, 'apng');
function copyApng() {
  if (!fs.existsSync(path.join(APNG_SRC, 'index.html'))) return;
  fs.rmSync(APNG_OUT, { recursive: true, force: true });
  fs.mkdirSync(APNG_OUT, { recursive: true });
  fs.copyFileSync(path.join(APNG_SRC, 'index.html'), path.join(APNG_OUT, 'index.html'));
  for (const d of ['css', 'js'])
    fs.cpSync(path.join(APNG_SRC, d), path.join(APNG_OUT, d), { recursive: true });
}

async function main() {
  if (!watch) fs.rmSync(LIB, { recursive: true, force: true }); // 重新複製，移除不再使用的程式庫
  writeDraco();
  copyApng();
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
