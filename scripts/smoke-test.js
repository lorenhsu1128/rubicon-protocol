// 冒煙測試：以 headless Edge/Chrome 開啟建置後的遊戲，收集頁面例外與 console 錯誤。
//   1. 直接開檔（file://）：標題畫面
//   2. 本機多分頁（?lan=local）：單機出擊、多人建房／加入／出擊、房主遷移
//   3. 區網伺服器（server.js，WebSocket 中繼）：/health、多人建房／加入／出擊
// 用法：node scripts/smoke-test.js [html 路徑] [--no-server]
//   指定 html 路徑時只跑 1、2（例如拿舊版單檔 HTML 當基準比對）；截圖存到 test-results/
// 預設分段平行（scripts/smoke-jobs.js）：SMOKE_JOBS＝段數（1＝單一程序依序跑），耗時記在
// test-results/smoke-times.json；SMOKE_ONLY 可以一起用
'use strict';
/* global window, document, localStorage, location, getComputedStyle, scrollTo, indexedDB, THREE -- page.evaluate 的回呼在瀏覽器端執行 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const htmlArg = args.find((a) => !a.startsWith('--'));
const HTML = path.resolve(htmlArg || path.join(ROOT, 'dist/rubicon-protocol.html'));
const WITH_SERVER = !htmlArg && !args.includes('--no-server');
const LIBRARY = path.join(path.dirname(HTML), 'model-library.html');
const SHOT_DIR = path.join(ROOT, 'test-results');
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// SMOKE_ONLY=testLevels,testMpLevels（逗號分隔）：只跑這幾項（開發時用；server＝區網伺服器的部分）
const ONLY = process.env.SMOKE_ONLY ? process.env.SMOKE_ONLY.split(',') : null;
// 分段平行（scripts/smoke-jobs.js）：子程序以 SMOKE_CHILD＝段號、SMOKE_UNITS＝要跑的步驟、
// SMOKE_WORK＝自己的暫存資料夾（跨測試的中間檔、伺服器模型組）、SMOKE_RESULT＝結果 JSON 執行
const CHILD = process.env.SMOKE_CHILD || '';
// 跨測試共用的中間檔（模型庫範本 GLB）與伺服器的資料夾；單一程序時照舊放 test-results/
const WORK_DIR = process.env.SMOKE_WORK ? path.resolve(process.env.SMOKE_WORK) : SHOT_DIR;
const failures = []; // { test, label }
const errors = [];
let checks = 0;
let CUR = ''; // 目前執行的步驟（失敗清單標示所屬測試）
function check(ok, label) {
  checks++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) failures.push({ test: CUR, label });
}

// 提供單一 HTML 的靜態伺服器（BroadcastChannel 需要同源，不能用 file://）
function serveHtml() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const u = req.url.split('?')[0];
      // /lib/… 提供同資料夾 lib/ 裡的程式庫（three.js、PeerJS、Draco 解碼器）
      if (u.startsWith('/lib/')) {
        const f = path.join(path.dirname(HTML), decodeURIComponent(u));
        if (!fs.existsSync(f)) {
          resp.writeHead(404);
          return resp.end('not found');
        }
        resp.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
        return resp.end(fs.readFileSync(f));
      }
      // /model-library.html 提供同資料夾的模型庫，其他路徑一律回遊戲頁
      const lib = u === '/model-library.html';
      resp.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      resp.end(fs.readFileSync(lib ? LIBRARY : HTML));
    });
    srv.listen(0, '127.0.0.1', () => res(srv));
  });
}

// 伺服器模型組的資料夾（測試用，每次重來；分段平行時在各段自己的暫存資料夾）
const SERVER_MODELS = path.join(WORK_DIR, 'server-models');
async function startGameServer() {
  fs.rmSync(SERVER_MODELS, { recursive: true, force: true });
  // port 0：由系統挑空的 port，test-server-preload.js 把實際的 port 印出來
  const proc = spawn(process.execPath, ['-r', './scripts/test-server-preload.js', 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      TEST_GAME_PORT: 0,
      TEST_CONTROL_PORT: 0,
      RUBICON_MODELS_DIR: SERVER_MODELS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    const m = log.match(/\[test-port\] 80 (\d+)/);
    if (m) {
      const url = `http://127.0.0.1:${m[1]}/`;
      try {
        const r = await fetch(url + 'health');
        if (r.ok) return { proc, url, health: await r.text() };
      } catch (e) {}
    }
    if (proc.exitCode !== null) break;
    await wait(200);
  }
  proc.kill();
  throw new Error('區網伺服器沒有啟動：\n' + log);
}

// 重新載入到帶 # 的網址：先離開再完整載入（只改 # 再 reload 時，頁面處理 hashchange 會暫時清掉 #，
// 負載高時 reload 可能剛好拿到沒有 # 的網址）
async function reopen(page, url) {
  await page.goto('about:blank');
  await page.goto(url);
}

// 程式庫一律從頁面旁的 lib/ 載入：任何頁面向 CDN 要求程式庫都算錯誤
const CDN = /cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com/;
function watch(page, name) {
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('request', (r) => {
    if (CDN.test(r.url())) errors.push(`[${name}] 向 CDN 要求程式庫：${r.url()}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (url.endsWith('/favicon.ico')) return; // 瀏覽器自動要求，伺服器本來就沒有提供
    errors.push(`[${name}] console.error: ${m.text()}${url ? ' @ ' + url : ''}`);
  });
}

// GLB 編輯器（網址帶 ?test 時 window.__glbEditor）：物件投影到畫面的座標、從某點拖曳、畫面上看得到的標籤
const screenOf = (page, expr) =>
  page.evaluate((expr) => {
    const ed = window.__glbEditor;
    const o = new Function('ed', 'return ' + expr)(ed);
    const v = o.getWorldPosition(new THREE.Vector3()).project(ed.camera);
    const r = ed.canvas.getBoundingClientRect();
    return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
  }, expr);
async function dragFrom(page, [x, y], dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 3 });
  await page.mouse.move(x + dx, y + dy, { steps: 3 });
  await page.mouse.up();
  await wait(400);
}
const visibleLabels = (page) =>
  page.$$eval('#edLabels .lbl', (l) => l.filter((x) => x.style.display !== 'none').map((x) => x.textContent));
const visible = (page, id) =>
  page.evaluate((id) => {
    const el = document.getElementById(id);
    return !!el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
  }, id);

async function waitVisible(page, id, ms = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await visible(page, id)) return true;
    await wait(200);
  }
  return false;
}

// 明確推進遊戲時間（不靠實際經過的時間）：停住頁面自己的主迴圈（requestAnimationFrame 換成空函式，等已經排定的
// 那一格跑完才回傳），之後由 window.__pump(秒, 停止條件) 以固定 dt 逐格呼叫 g.loop()（每格前把 lastT 往前推 dt，
// 所以 loop 算出的 dt 固定；照常更新與算繪，截圖拍得到）。回傳推進的秒數，停止條件一直沒成立時回傳 -1。
// 負載高時實際時間換算的遊戲時間不固定，要檢查遊戲邏輯的結果時用它（同 testMpBosses 推進房主的主迴圈）
async function freezeLoop(page) {
  await page.evaluate(
    () =>
      new Promise((res) => {
        window.__pump = (sec, until, dt = 1 / 60) => {
          const g = window.__game;
          let t = 0;
          for (; t < sec - 1e-6; t += dt) {
            if (until && until()) return t;
            g.lastT = performance.now() - dt * 1000;
            g.loop();
          }
          return !until || until() ? t : -1;
        };
        if (window.__rafOrig) return res();
        const raf = (window.__rafOrig = window.requestAnimationFrame.bind(window));
        window.requestAnimationFrame = () => 0;
        raf(() => raf(() => res()));
      }),
  );
}
// 頁面的 Math.random 換成可以重設種子的亂數（mulberry32）：遊戲的 rnd／pick（core/math.js 的 RNG）在模組載入時就拿走了
// Math.random，所以要在 page.goto 之前裝（addInitScript）；之後 window.__reseed(種子) 重設。主迴圈停住、地圖種子固定之後，
// 剩下的變數是 AI 與招式裡的亂數（移動、冷卻、目標點），重設種子後每次結果相同
async function seededRandom(page) {
  await page.addInitScript(() => {
    let a = 1;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__reseed = (s) => (a = s >>> 0);
  });
}
// 恢復頁面自己的主迴圈
async function thawLoop(page) {
  await page.evaluate(() => {
    const raf = window.__rafOrig;
    if (!raf) return;
    window.__rafOrig = null;
    window.requestAnimationFrame = raf;
    const g = window.__game;
    g.lastT = performance.now();
    raf(() => g.loop());
  });
}

// 標題「選擇存檔」→ 存檔畫面的槽位開新的傭兵生涯（槽位已有存檔時先刪除）→ 車庫
async function newCareer(page, slot = 1) {
  await page.click('#btnSaves');
  await waitVisible(page, 'saves');
  const card = `#saveSlots [data-slot="${slot}"]`;
  if (await page.$(`${card} [data-act="del"]`)) {
    await page.click(`${card} [data-act="del"]`);
    await page.click(`${card} [data-act="yes"]`);
  }
  await page.click(`${card} [data-act="new"]`);
}

async function playFor(page, ms) {
  // 往前走、射擊，讓遊戲邏輯與渲染實際跑起來
  await page.mouse.move(640, 360);
  await page.keyboard.down('w');
  for (let t = 0; t < ms; t += 500) {
    await page.mouse.down();
    await wait(250);
    await page.mouse.up();
    await wait(250);
  }
  await page.keyboard.up('w');
}

async function setNick(page, nick) {
  await page.fill('#mpNick', nick);
  await page.dispatchEvent('#mpNick', 'change');
}

const newPage = async (browser, name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  watch(page, name);
  return { ctx, page };
};

async function testFile(browser) {
  console.log('直接開啟 HTML 檔（file://）');
  const { ctx, page } = await newPage(browser, 'file');
  await page.goto('file:///' + HTML.replace(/\\/g, '/'));
  check(await waitVisible(page, 'title'), '標題畫面顯示');
  check(!(await page.isVisible('#btnApng')), '直接開檔時不顯示「文字動畫」（需要從伺服器開啟）');
  // 全螢幕：按鈕進入、文字改成「離開全螢幕」，再按一次離開
  // （fullscreenElement 先變、fullscreenchange 稍後才改按鈕文字，所以兩者一起等）
  const fsWait = (on) =>
    page
      .waitForFunction(
        (on) =>
          !!document.fullscreenElement === on &&
          document.getElementById('btnFullscreen').textContent === (on ? '離開全螢幕' : '全螢幕'),
        on,
        { timeout: 5000 },
      )
      .then(
        () => true,
        () => false,
      );
  await page.click('#btnFullscreen');
  check(await fsWait(true), '標題畫面「全螢幕」按鈕進入全螢幕');
  await page.click('#btnFullscreen');
  check(await fsWait(false), '再按一次離開全螢幕');
  // 本地模型庫：直接開檔時，遊戲也讀得到同樣直接開檔的模型庫存的資料
  if (fs.existsSync(LIBRARY)) {
    const lib = await ctx.newPage();
    watch(lib, 'file-lib');
    await lib.goto('file:///' + LIBRARY.replace(/\\/g, '/'));
    await wait(1200);
    await injectLibrary(lib, [], { 'arms/a_std/l_upper': { elbow: { p: [0, -0.9, 0], r: [0, 0, 0] } } });
    await lib.close();
    await page.click('#btnSettings');
    await page.check('#lmOn');
    await wait(1500);
    const t = (await page.textContent('#lmBox')) || '';
    check(t.includes('關節設定 1 個') && !t.includes('讀不到'), '直接開檔時讀得到模型庫（file://）的暫存');
  }
  await ctx.close();
}

// 貼圖繪製（dist/paint/，子專案 rubicon_paint）：直接開檔的模型庫 → 「繪製貼圖」→ 畫一筆 → 存回模型庫
// → 槽位換成新 GLB（保留原始檔、根節點不變）→ 重新開啟接著上次的圖層
async function testPaint(browser) {
  console.log('貼圖繪製：模型庫開啟 → 畫 → 存回 → 再開接著畫');
  const PAINT = path.join(path.dirname(HTML), 'paint', 'index.html');
  if (!fs.existsSync(LIBRARY) || !fs.existsSync(PAINT)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'paint-lib');
  // 標題畫面的「貼圖繪製」（直接開檔也能用）
  const game = await ctx.newPage();
  watch(game, 'paint-title');
  await game.goto('file:///' + HTML.replace(/\\/g, '/'));
  await waitVisible(game, 'title');
  const [tool] = await Promise.all([game.waitForEvent('popup'), game.click('#btnPaint')]);
  watch(tool, 'paint-tool');
  check(
    await tool
      .waitForFunction(() => window.__rp && !!document.getElementById('btnDemo'), null, { timeout: 15000 })
      .then(
        () => true,
        () => false,
      ),
    '標題畫面「貼圖繪製」按鈕開啟 Rubicon Paint（直接開檔）',
  );
  check(await tool.isHidden('#libGroup'), '不是從模型庫開啟時不顯示「存回模型庫」');
  await tool.close();
  // 標題「模型庫」開新分頁 →「回遊戲」關掉模型庫分頁，遊戲仍在標題
  const [lib] = await Promise.all([game.waitForEvent('popup'), game.click('#btnLibrary')]);
  watch(lib, 'library-back');
  await lib.waitForSelector('.cell');
  await Promise.all([lib.waitForEvent('close', { timeout: 5000 }).catch(() => {}), lib.click('#btnBack')]);
  check(lib.isClosed() && (await visible(game, 'title')), '模型庫「回遊戲」關掉模型庫分頁、回到遊戲標題');
  await game.close();

  const SLOT = 'arms/a_std/r_fore';
  await page.goto('file:///' + LIBRARY.split(path.sep).join('/') + '?test#' + SLOT);
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(1200);
  check(await page.isDisabled('#insPaint'), '程式模型（沒有 GLB）時「繪製貼圖」停用');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
  const fp = path.join(SHOT_DIR, 'paint-fore.glb');
  await dl.saveAs(fp);
  await page.setInputFiles('#insFile', fp);
  await wait(1500);
  check(!(await page.isDisabled('#insPaint')), '有 GLB 後可以「繪製貼圖」');
  const readRec = () =>
    page.evaluate(
      (slot) =>
        new Promise((resolve) => {
          const r = indexedDB.open('rubicon-model-library');
          r.onsuccess = () => {
            const q = r.result.transaction('models').objectStore('models').get(['default', slot]);
            q.onsuccess = () => {
              const v = q.result;
              r.result.close();
              if (!v) return resolve(null);
              const roots = (buf) => {
                const dv = new DataView(buf);
                const j = JSON.parse(
                  new TextDecoder().decode(new Uint8Array(buf, 20, dv.getUint32(12, true))),
                );
                return j.scenes[j.scene || 0].nodes.map((i) => j.nodes[i].name || '');
              };
              resolve({ name: v.name, size: v.size, orig: v.orig && v.orig.size, roots: roots(v.buf) });
            };
          };
        }),
      SLOT,
    );
  const before = await readRec();
  const open = async () => {
    const [p] = await Promise.all([page.waitForEvent('popup'), page.click('#insPaint')]);
    watch(p, 'paint');
    const ok = await p
      .waitForFunction(
        () => window.__rp && window.__rp.LIB.link && window.__rp.painter.sets.length > 0,
        null,
        {
          timeout: 20000,
        },
      )
      .then(
        () => true,
        () => false,
      );
    await wait(800);
    return { p, ok };
  };
  let { p, ok } = await open();
  check(ok, '檢視窗「繪製貼圖」在 Rubicon Paint 開啟槽位的 GLB');
  check(
    ((await p.textContent('#libLabel')) || '').includes('預設'),
    `繪圖視窗標示模型庫的槽位與模型組（${await p.textContent('#libLabel')}）`,
  );
  // 在 3D 畫面中央畫一筆
  const box = await p.locator('#view3d').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await p.mouse.move(cx - 40, cy - 30);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(cx - 40 + i * 7, cy - 30 + i * 5);
  await p.mouse.up();
  await wait(500);
  const undo = await p.evaluate(() => window.__rp.painter.undoStack.length);
  check(undo > 0, `在模型上畫了一筆（復原紀錄 ${undo}）`);
  const layers = await p.evaluate(() => window.__rp.painter.sets.map((s) => s.layers.length));
  await p.click('#btnLibSave');
  check(
    await p
      .waitForFunction(() => /已存回模型庫/.test(document.getElementById('status').textContent), null, {
        timeout: 20000,
      })
      .then(
        () => true,
        () => false,
      ),
    `「存回模型庫」完成（${await p.textContent('#status')}）`,
  );
  await wait(500);
  const after = await readRec();
  check(
    !!after && after.size !== before.size && after.orig === before.size,
    `模型庫的槽位換成畫好的 GLB，繪製前的檔案留作原始檔（${before.size} → ${after && after.size}，原始檔 ${after && after.orig}）`,
  );
  check(
    !!after && JSON.stringify(after.roots) === JSON.stringify(before.roots),
    `存回的 GLB 根節點維持原樣（${before.roots.join('、')} → ${after && after.roots.join('、')}）`,
  );
  await p.screenshot({ path: path.join(SHOT_DIR, 'paint-linked.png') });
  // 繪圖視窗把圖層寫進自己的 IndexedDB 之後才關（電腦忙的時候寫入比較慢）
  await p
    .waitForFunction(
      () =>
        new Promise((res) => {
          const rq = indexedDB.open('rubicon-paint', 1);
          rq.onerror = () => res(false);
          rq.onsuccess = () => {
            const db = rq.result;
            try {
              const q = db.transaction('autosave', 'readonly').objectStore('autosave').getAllKeys();
              q.onsuccess = () => {
                db.close();
                res(q.result.some((k) => String(k).startsWith('lib:')));
              };
              q.onerror = () => {
                db.close();
                res(false);
              };
            } catch (e) {
              db.close();
              res(false);
            }
          };
        }),
      null,
      { timeout: 15000 },
    )
    .catch(() => {});
  await p.close();
  ({ p, ok } = await open());
  check(ok, '再次從模型庫開啟');
  check(
    /接著上次的圖層/.test(await p.textContent('#status')) &&
      JSON.stringify(await p.evaluate(() => window.__rp.painter.sets.map((s) => s.layers.length))) ===
        JSON.stringify(layers),
    `模型庫的檔案沒變時接著上次的圖層畫（${await p.textContent('#status')}）`,
  );
  // 模型庫切到別的模型組後，存回會被拒絕（避免存錯組）
  // （檢視窗蓋住了上方的選單，直接操作元素）
  await page.evaluate(() => {
    document.querySelector('#setMenu').open = true;
    document.getElementById('setName').value = '繪製測試';
    document.getElementById('setNew').click();
  });
  await wait(800);
  await p.click('#btnLibSave');
  check(
    await p
      .waitForFunction(() => /另一個模型組/.test(document.getElementById('status').textContent), null, {
        timeout: 15000,
      })
      .then(
        () => true,
        () => false,
      ),
    `模型庫換了模型組時拒絕存回（${await p.textContent('#status')}）`,
  );
  await ctx.close();
}

// 渲染風格實驗室（直接開檔）：開啟 → 模擬戰鬥 → 切換風格、金屬、左右比較 → 調滑桿 → 操作模式
// → 存成我的預設並套用 → 離開（存檔沒變）→ 設定畫面顯示 → 出擊時用該風格
// 每個內建渲染風格 × 每個地圖主題：截圖（test-results/style-<風格>-<主題>.png）並量亮度，過曝或過暗就失敗。
// 新增或修改內建風格時要逐張看這些截圖
// part／parts：只量第 part 組（主題依序平均分成 parts 組；分段平行時各組可以分到不同段）
async function testStyleThemes(browser, part = 1, parts = 1) {
  console.log(`渲染風格：每個內建風格在每個地圖主題的亮度（第 ${part}／${parts} 組主題）`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  watch(page, 'style-themes');
  await seededRandom(page);
  await page.goto('file:///' + HTML.replace(/\\/g, '/') + '?test');
  await waitVisible(page, 'title');
  await page.click('#btnStyleLab');
  await waitVisible(page, 'labPanel', 15000);
  // 固定的地形種子與鏡頭、暫停模擬，每次量到的畫面相同。換戰區之前就先暫停：以前戰區建好之後才暫停，
  // 中間兩隊已經打了幾格（依實際時間），停在畫面上的爆炸、雷射與砲口閃光讓過曝的比例在 0～40% 之間跳動；
  // 機體的位置（labPlace）也用亂數，換戰區前重設種子
  await page.selectOption('#labCam', 'free');
  await page.evaluate(() => {
    const L = window.__game.lab;
    L.seed = 4242;
    L.paused = true;
  });
  const allThemes = await page.$$eval('#labTheme option', (os) => os.map((o) => o.value));
  const per = Math.ceil(allThemes.length / parts);
  const themes = allThemes.slice((part - 1) * per, part * per);
  const styles = await page.$$eval('#labStyle option', (os) =>
    os.map((o) => o.value).filter((v) => v.startsWith('builtin:')),
  );
  // 畫面左側（避開右邊的面板與下方的工具列）縮成 96×64 量亮度
  const measure = async () => {
    const b64 = (await page.screenshot({ clip: { x: 0, y: 0, width: 900, height: 620 } })).toString('base64');
    return page.evaluate(async (b64) => {
      const img = new window.Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = document.createElement('canvas');
      cv.width = 96;
      cv.height = 64;
      const c = cv.getContext('2d');
      c.drawImage(img, 0, 0, 96, 64);
      const d = c.getImageData(0, 0, 96, 64).data;
      let sum = 0,
        hi = 0,
        lo = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        sum += y;
        if (y > 0.96) hi++;
        if (y < 0.04) lo++;
      }
      return { mean: sum / n, hi: hi / n, lo: lo / n };
    }, b64);
  };
  const bad = [];
  const rows = [];
  for (const th of themes) {
    // 換戰區（同 #labTheme 的 onchange；第一組的主題可能就是實驗室開啟時的戰區，選單的值沒變時不會重建）
    await page.evaluate((th) => {
      const g = window.__game;
      window.__reseed(4242);
      document.getElementById('labTheme').value = th;
      g.lab.theme = th;
      g.labStart();
    }, th);
    await page.waitForFunction((th) => window.__game.worldTheme === th && window.__game.world, th, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      const L = window.__game.lab;
      L.paused = true;
      L.cam = 'free';
      Object.assign(L.free, { yaw: 0.6, pitch: 0.42, dist: 38 });
    });
    await wait(1500);
    const row = [];
    for (const st of styles) {
      await page.selectOption('#labStyle', st);
      await wait(1200);
      const m = await measure();
      const id = st.slice(8);
      await page.screenshot({
        path: path.join(SHOT_DIR, `style-${id}-${th}.png`),
        clip: { x: 0, y: 0, width: 900, height: 620 },
      });
      row.push(`${id} ${m.mean.toFixed(2)}`);
      if (m.mean > 0.82 || m.hi > 0.25 || m.mean < 0.08 || m.lo > 0.45)
        bad.push(
          `${id}@${th}（平均 ${m.mean.toFixed(2)}、過曝 ${Math.round(m.hi * 100)}%、死黑 ${Math.round(m.lo * 100)}%）`,
        );
    }
    rows.push(`${th}：${row.join('、')}`);
  }
  console.log('    ' + rows.join('\n    '));
  check(
    bad.length === 0,
    `${styles.length} 個內建風格 × ${themes.length} 個主題（${themes.join('、')}）的畫面亮度都在範圍內` +
      (bad.length ? '：' + bad.join('；') : ''),
  );
  await ctx.close();
}

async function testHangar(browser) {
  console.log('機甲庫的格納庫：場景、部位鏡頭、拖曳繞看、全像預覽、掃描換裝、依場合換場景');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'hangar');
  await page.goto('file:///' + HTML.replace(/\\/g, '/') + '?test');
  await waitVisible(page, 'title');
  // 外部素材（lib/hangar-assets.js）載入完再開始，否則中途會換成細緻的場景
  await page.waitForFunction(() => window.__HA && (window.__HA.ready || window.__HA.failed), null, {
    timeout: 90000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.hangarFx = 'full';
    for (const id of ['h_lt', 'h_hv', 'l_rj', 'l_hv', 'w_mg', 'w_sg', 'b_eff'])
      if (!g.save.owned.includes(id)) g.save.owned.push(id);
    g.openGarage();
  });
  await freezeLoop(page);
  const st = await page.evaluate(() => {
    const g = window.__game,
      hg = g.hg;
    window.__pump(0.5);
    let inScene = false;
    g.garageScene.traverse((o) => (inScene = inScene || o === g.garageMech.group));
    return {
      kind: hg.H.kind,
      workers: hg.H.workers.length,
      cranes: hg.H.cranes.length,
      inScene,
      rot: g.garageMech.group.rotation.y,
      rich: hg.H.rich,
      chars: hg.H.workers.filter((w) => w.rich).length,
      bg: (hg.bgMechs || []).length,
    };
  });
  check(
    st.kind === 'base' && st.workers >= 3 && st.cranes >= 1 && st.inScene,
    `自由出擊＝基地格納庫（技師 ${st.workers} 人、吊車 ${st.cranes} 台），機體站在整備架上`,
  );
  check(
    st.rich && st.chars === st.workers && st.bg === 2,
    `外部素材的細緻場景（CC0 道具與 PBR 貼圖、骨架動畫的技師 ${st.chars} 人、背景整備位的機體 ${st.bg} 台）`,
  );
  // 部位的鏡頭：點左側的部位
  const tg = async (label) => {
    await page.click(`#slots .slot:has-text("${label}")`);
    return page.evaluate(() => {
      window.__pump(2);
      const C = window.__game.hg.cam;
      return { y: C.tgt.y, yaw: C.yaw, dist: C.dist };
    });
  };
  const head = await tg('頭部'),
    legs = await tg('腳部'),
    bst = await tg('推進器');
  check(
    head.y > 2.5 && legs.y < 1.5 && Math.abs(bst.yaw) > 2,
    `選部位時鏡頭轉過去（頭 ${head.y.toFixed(1)} m、腳 ${legs.y.toFixed(1)} m、推進器從背後 ${bst.yaw.toFixed(2)} rad）`,
  );
  // 拖曳繞看，停手後回到部位的鏡頭
  const box = await page.locator('#garageMid').boundingBox();
  const cx = box.x + box.width / 2,
    cy = box.y + box.height * 0.6;
  const y0 = await page.evaluate(() => window.__game.hg.goal.yaw);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 200, cy, { steps: 5 });
  await page.mouse.up();
  const drag = await page.evaluate((y0) => {
    const hg = window.__game.hg;
    const d = hg.goal.yaw - y0;
    window.__pump(5);
    return { d, back: Math.abs(hg.goal.yaw - y0) < 0.05 };
  }, y0);
  check(drag.d > 1 && drag.back, `拖曳繞看（${drag.d.toFixed(2)} rad），停手 4 秒後回到部位的鏡頭`);
  // 全像預覽：滑鼠停在沒裝備的腳部上
  await tg('腳部');
  await page.hover('#partList .part[data-pid="l_hv"]');
  const holo = await page.evaluate(() => {
    const g = window.__game;
    window.__pump(0.4);
    const P = g.hg.prev;
    let n = 0;
    if (P && P.m)
      P.m.group.traverse((o) => {
        if (o.isMesh && o.material.isShaderMaterial && o.visible) {
          for (let p = o; p; p = p.parent) if (!p.visible) return;
          n++;
        }
      });
    return { n, faded: P ? P.keep.length : 0 };
  });
  check(holo.n > 0 && holo.faded > 0, `滑鼠停在零件上：全像預覽換上的區塊（${holo.n} 個網格），原本的變淡`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'hangar-holo.png') });
  await page.mouse.move(cx, cy);
  const cleared = await page.evaluate(() => {
    window.__pump(0.1);
    return !window.__game.hg.prev;
  });
  check(cleared, '滑鼠離開：全像消失');
  // 換上零件（簡短）：只有變了的區塊播掃描，結束後舊的機體移除、材質還原
  const sw = await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.hangarFx = 'short';
    g.garageSlot = 'head';
    g.renderGarage();
    window.__pump(2);
    g.save.asm.head = g.save.asm.head === 'h_lt' ? 'h_hv' : 'h_lt';
    g.renderGarage();
    const S = g.hg.swap;
    if (!S) return { ok: false };
    window.__pump(0.3);
    const mid = S.pNew.constant > S.y0 && S.pNew.constant < S.y1;
    let clipped = 0;
    g.garageMech.group.traverse((o) => o.isMesh && o.material.clippingPlanes && clipped++);
    return { ok: true, mid, clipped };
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'hangar-swap.png') });
  const sw2 = await page.evaluate(() => {
    const g = window.__game;
    window.__pump(1.5);
    let left = 0;
    g.garageMech.group.traverse(
      (o) => o.isMesh && o.material.clippingPlanes && o.material.clippingPlanes.length && left++,
    );
    g.ctrl.hangarFx = 'full';
    return { done: !g.hg.swap, left };
  });
  check(
    sw.ok && sw.mid && sw.clipped > 0 && sw2.done && sw2.left === 0,
    `換上頭部（簡短）：掃描換裝（剪裁的網格 ${sw.clipped} 個），結束後材質還原、舊的機體移除`,
  );
  // 換上零件（完整）：依部位的實體換裝，零件移開、送回原位，結束後機械臂收回、吊車放開
  const rig = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (const [slot, a, b] of [
      ['head', 'h_lt', 'h_hv'],
      ['rarm', 'w_mg', 'w_sg'],
      ['legs', 'l_rj', 'l_hv'],
      ['booster', 'b_eff', 'b_std'],
    ]) {
      g.garageSlot = slot;
      g.renderGarage();
      window.__pump(2.5);
      g.save.asm[slot] = g.save.asm[slot] === a ? b : a;
      g.renderGarage();
      const S = g.hg.swap;
      if (!S || !S.rig) {
        out.push({ slot, kind: 'none' });
        continue;
      }
      const it = S.items.find((i) => !i.isNew);
      const w0 = it.o.getWorldPosition(new THREE.Vector3());
      window.__pump(0.85);
      const w1 = it.o.getWorldPosition(new THREE.Vector3());
      const moved = w1.distanceTo(w0);
      const busy = S.crane ? S.crane.c.busy : true;
      const robot = S.robots.length ? S.robots[0].r.g.visible && S.robots[0].r.g.position.y > -0.5 : true;
      const hatch = S.kind === 'crane' || S.hatches.some((h) => h.k > 0.9);
      window.__pump(1.5);
      const nw = S.items.filter((i) => i.isNew);
      const back = nw.every((i) => i.o.visible && i.o.position.distanceTo(i.p0) < 1e-6);
      const H = g.hg.H;
      const clean =
        !g.hg.swap &&
        H.robots.every((r) => !r.g.visible) &&
        !H.cranes[0].busy &&
        !H.root.children.some((c) =>
          c.children.some((m) => m.material && m.material.color && m.material.color.getHex() === 0x030405),
        ) &&
        g.garageMech.group.position.y === 0;
      out.push({ slot, kind: S.kind, moved: +moved.toFixed(2), busy, robot, hatch, back, clean });
    }
    return out;
  });
  const rigOk = rig.every(
    (r) => r.kind !== 'none' && r.moved > 1 && r.busy && r.robot && r.hatch && r.back && r.clean,
  );
  check(
    rigOk && rig.map((r) => r.kind).join() === 'crane,robot,lift,rear',
    `完整的實體換裝：頭＝吊車、手持武器＝機械臂、腳＝地板升降口、推進器＝後方軌道（${rig.map((r) => r.slot + ' ' + r.kind + ' ' + r.moved + ' m').join('、')}），結束後收回` +
      (rigOk ? '' : ' ' + JSON.stringify(rig)),
  );
  // 換裝中點一下畫面：略過
  const skip = await page.evaluate(() => {
    const g = window.__game;
    g.garageSlot = 'head';
    g.save.asm.head = g.save.asm.head === 'h_lt' ? 'h_hv' : 'h_lt';
    g.renderGarage();
    window.__pump(0.5);
    return !!(g.hg.swap && g.hg.swap.rig);
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'hangar-rig.png') });
  await page.mouse.click(cx, cy);
  const skipped = await page.evaluate(() => !window.__game.hg.swap);
  check(skip && skipped, '換裝中點一下畫面：直接完成');
  // 關閉演出：直接換
  const off = await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.hangarFx = 'off';
    g.save.asm.head = g.save.asm.head === 'h_lt' ? 'h_hv' : 'h_lt';
    g.renderGarage();
    const r = !g.hg.swap;
    g.ctrl.hangarFx = 'full';
    return r;
  });
  check(off, '整備演出關閉時直接換上');
  // 依場合換場景（運輸艦、野戰、多人）
  const kinds = [];
  for (const [k, setup] of [
    ['ship', 'g.fromHub = true'],
    ['field', 'g.fromHub = false; g.hangarKind = () => "field"'],
    ['multi', 'g.hangarKind = () => "multi"'],
  ]) {
    const r = await page.evaluate(
      ([setup]) => {
        const g = window.__game;
        new Function('g', setup)(g);
        g.hangarEnsure();
        g.garageSlot = 'core';
        window.__pump(2.5);
        return g.hg.H.kind;
      },
      [setup],
    );
    kinds.push(r);
    await page.screenshot({ path: path.join(SHOT_DIR, `hangar-${k}.png`) });
  }
  check(
    kinds.join() === 'ship,field,multi',
    `作戰室＝運輸艦、轉場整備＝野戰、多人＝多個整備位（${kinds.join('、')}）`,
  );
  // 野戰帳篷沒有吊車：頭部改用機械臂
  const fieldHead = await page.evaluate(() => {
    const g = window.__game;
    g.hangarKind = () => 'field';
    g.hangarEnsure();
    g.garageSlot = 'head';
    g.renderGarage();
    window.__pump(2.5);
    g.save.asm.head = g.save.asm.head === 'h_lt' ? 'h_hv' : 'h_lt';
    g.renderGarage();
    const k = g.hg.swap && g.hg.swap.kind;
    window.__pump(2.5);
    return { k, done: !g.hg.swap };
  });
  check(
    fieldHead.k === 'robot' && fieldHead.done,
    `野戰帳篷（沒有吊車）換頭部：改用機械臂（${fieldHead.k}）`,
  );
  // 受損與維修：上一次出擊的損傷 → 區塊變黑冒煙 → 無人機電焊修好
  const dmg = await page.evaluate(() => {
    const g = window.__game;
    g.hangarKind = () => 'base';
    g.hgLastDmg = 0.6;
    g.openGarage();
    window.__pump(0.5);
    const D = g.hg.dmg;
    const n = D ? D.spots.length : 0;
    const dark = D ? D.spots.filter((s) => s.keep && s.keep.length).length : 0;
    window.__pump(2.0);
    const flying = g.hg.H.drones.some((d) => d.job);
    window.__pump(8);
    const left = g.hg.dmg ? g.hg.dmg.spots.filter((s) => !s.done).length : 0;
    const parked = g.hg.H.drones.every((d) => d.g.position.distanceTo(d.park) < 0.2);
    return { n, dark, flying, left, parked };
  });
  check(
    dmg.n >= 4 && dmg.dark === dmg.n && dmg.flying && dmg.left === 0 && dmg.parked,
    `進機甲庫時依上一次出擊的損傷顯示受損（${dmg.n} 處），維修無人機電焊修好後回到塔頂`,
  );
  // 轉場整備式：受損留著，修理後才派無人機；補給車開來卸貨再開走
  const rep2 = await page.evaluate(() => {
    const g = window.__game;
    g.hangarDamage(0.5, false);
    window.__pump(3);
    const still = g.hg.dmg && g.hg.dmg.spots.every((s) => !s.done);
    g.hangarRepairStart();
    window.__pump(9);
    const fixed = !g.hg.dmg;
    const n0 = g.hg.H.cars.length;
    g.hangarSupply('ammo');
    const n1 = g.hg.H.cars.length;
    window.__pump(8);
    return { still, fixed, cart: n1 === n0 + 1 && g.hg.H.cars.length === n0 };
  });
  check(rep2.still && rep2.fixed && rep2.cart, '不自動修的受損等修理才派無人機；補給車開來卸貨後離開');
  // 出擊演出：基地＝升降台、運輸艦＝彈射、野戰＝起飛；播完才出擊、點一下略過
  const launch = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (const k of ['base', 'ship', 'field']) {
      g.hangarKind = () => k;
      g.hangarEnsure();
      g.renderGarage();
      window.__pump(0.5);
      let done = 0;
      g.hangarLaunch(() => done++);
      window.__pump(1.8);
      const p = g.garageMech.group.position;
      const moved = Math.hypot(p.y, p.z);
      const early = done;
      window.__pump(2);
      out.push({
        k,
        kind: g.hg.launch ? 'busy' : 'ok',
        moved: +moved.toFixed(1),
        early,
        done,
        back: p.length() === 0,
      });
    }
    g.hangarKind = () => 'base';
    g.hangarEnsure();
    g.renderGarage();
    window.__skip = 0;
    g.hangarLaunch(() => window.__skip++);
    window.__pump(0.3);
    return out;
  });
  await page.mouse.click(cx, cy);
  const skipL = await page.evaluate(() => window.__skip === 1 && !window.__game.hg.launch);
  check(
    launch.every((r) => r.kind === 'ok' && r.moved > 1 && r.early === 0 && r.done === 1 && r.back) && skipL,
    `出擊演出播完才出擊（${launch.map((r) => r.k + ' ' + r.moved + ' m').join('、')}），點一下略過` +
      (skipL ? '' : '（略過失敗）'),
  );
  // 多人：隊友的機體站在旁邊的整備架上
  const mates = await page.evaluate(() => {
    const g = window.__game;
    g.hangarKind = () => 'multi';
    g.hgMatesTest = [
      { slot: 1, asm: g.save.asm, color: 1 },
      { slot: 2, asm: g.save.asm, color: 2 },
    ];
    g.hangarEnsure();
    g.renderGarage();
    window.__pump(1.2);
    const M = g.hg.mates || [];
    let inScene = 0;
    for (const m of M) g.garageScene.traverse((o) => o === m.group && inScene++);
    return { n: M.length, inScene, xs: M.map((m) => m.group.position.x) };
  });
  check(
    mates.n === 2 && mates.inScene === 2,
    `多人：隊友的機體站在旁邊的整備架上（x＝${mates.xs.join('、')}）`,
  );
  await ctx.close();
}

async function testLabDemo(browser) {
  console.log(
    '實驗室的動作展示：清掉兩隊、28 段依序播放（移動、機動、射擊、近戰、受擊、擊破）、換段落、回到觀看重建戰場',
  );
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  watch(page, 'lab-demo');
  page.on('dialog', (d) => d.accept());
  await page.goto('file:///' + HTML.replace(/\\/g, '/') + '?test');
  await waitVisible(page, 'title');
  await page.click('#btnStyleLab');
  check(await waitVisible(page, 'labPanel', 15000), '開啟實驗室');
  await wait(1500);
  await page.click('#labDemoBtn');
  await wait(500);
  await freezeLoop(page);
  const st = await page.evaluate(() => {
    const g = window.__game;
    return {
      mode: g.lab.mode,
      n: g.enemies.length + g.allies.length,
      panel: !document.getElementById('labDemo').hidden,
      segs: document.querySelectorAll('#labDemoList button').length,
      cap: document.querySelector('#labDemoCap b').textContent,
    };
  });
  check(st.mode === 'demo' && st.n === 0 && st.panel, `動作展示：兩隊清掉、左側段落清單（${st.segs} 段）`);
  check(st.segs >= 20 && /待機/.test(st.cap), `從第 1 段開始（${st.cap}）`);
  // 每一段都跑一下：機體照腳本動作、沒有錯誤
  const r = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      D = g.lab.demo;
    const out = {
      glide: 0,
      legYaw: 0,
      fired: 0,
      melee: 0,
      hit: 0,
      stag: 0,
      collapse: false,
      dummyDead: false,
    };
    const segs = document.querySelectorAll('#labDemoList button').length;
    for (let i = 0; i < segs; i++) {
      g.labDemoGo(i);
      const name = document.querySelector('#labDemoCap b').textContent;
      const p0 = g.projectiles.length;
      for (let k = 0; k < 150; k++) {
        window.__pump(1 / 60);
        const an = p.model.an || {};
        if (/滑行/.test(name)) out.glide = Math.max(out.glide, an.gW || 0);
        if (/側移/.test(name)) out.legYaw = Math.max(out.legYaw, Math.abs(p.model.legsG.rotation.y));
        if (/射擊/.test(name))
          out.fired = Math.max(out.fired, g.projectiles.length - p0 + (p.recoil.r > 0.05 ? 1 : 0));
        if (/近戰/.test(name) && p.melee.active) out.melee++;
        if (/受擊/.test(name) && Math.abs(p.model.torso.rotation.x) > 0.08) out.hit++;
        if (/失衡/.test(name) && p.staggerT > 0) out.stag++;
        if (/擊破/.test(name) && D.dummy && D.dummy.dead) {
          out.dummyDead = true;
          if (D.dummy.mesh.visible) out.collapse = true;
        }
      }
    }
    return out;
  });
  check(r.glide > 0.8, `滑行段落進入滑行（權重 ${r.glide.toFixed(2)}）`);
  check(r.legYaw > 0.5, `側移段落下半身朝移動方向（${r.legYaw.toFixed(2)} rad）`);
  check(r.fired > 0, '射擊段落開火');
  check(r.melee > 10, '近戰段落打出連段');
  check(r.hit > 0 && r.stag > 0, '受擊與失衡段落');
  check(r.dummyDead && r.collapse, '擊破段落：假人先跪倒再碎裂');
  await page.evaluate(() => {
    const g = window.__game;
    g.labDemoGo(3);
    window.__pump(1.4);
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'lab-demo.png') });
  // 換段落的按鈕
  await page.click('#ldNext');
  const nx = await page.evaluate(() => window.__game.lab.demo.i);
  check(nx === 4, `下一段按鈕（第 ${nx + 1} 段）`);
  // 回到觀看：重新建立兩隊、收起展示的面板
  await page.click('#labWatch');
  await wait(500);
  const back = await page.evaluate(() => {
    const g = window.__game;
    return { mode: g.lab.mode, n: g.enemies.length, panel: !document.getElementById('labDemo').hidden };
  });
  check(back.mode === 'watch' && back.n >= 3 && !back.panel, `回到觀看：重新建立戰場（紅隊 ${back.n} 台）`);
  await ctx.close();
}

async function testStyleLab(browser) {
  console.log('渲染風格實驗室：模擬戰鬥 → 切換與調整 → 存成預設 → 套用到遊戲');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'style-lab');
  page.on('dialog', (d) => d.accept());
  await page.goto('file:///' + HTML.replace(/\\/g, '/') + '?test');
  await waitVisible(page, 'title');
  await newCareer(page);
  await waitVisible(page, 'garage');
  await page.click('#btnToTitle');
  await waitVisible(page, 'title');
  const save0 = await page.evaluate(() =>
    localStorage.getItem('rubicon_save_' + (localStorage.getItem('rubicon_save_cur') || 1)),
  );
  await page.click('#btnStyleLab');
  check(await waitVisible(page, 'labPanel', 15000), '標題「渲染風格」開啟實驗室面板');
  await wait(2500);
  const st = await page.evaluate(() => {
    const g = window.__game;
    return { lab: !!g.lab, allies: g.allies.length, enemies: g.enemies.length, state: g.state };
  });
  check(
    st.lab && st.state === 'play' && st.allies >= 2 && st.enemies >= 3,
    `模擬戰鬥：藍隊友軍 ${st.allies} 台、紅隊 ${st.enemies} 台`,
  );
  check(!(await visible(page, 'hudWrap')), '觀看模式不顯示 HUD');
  await page.selectOption('#labStyle', 'builtin:gundam');
  await page.check('#labMetal');
  await wait(1500);
  const P = await page.evaluate(() => window.__game.lab.P);
  check(P.toon === 1 && P.ink > 0 && P.metal === true, '切換到 Gundam 動畫風格＋機體金屬（色階光照、描線）');
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-gundam.png') });
  await page.selectOption('#labCmp', 'builtin:real');
  await wait(1500);
  check(await page.evaluate(() => !!window.__game.lab.cmp), '左右分割比較（左：寫實）');
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-compare.png') });
  await page.selectOption('#labCmp', '');
  await page.selectOption('#labCam', 'show');
  await page.evaluate(() => {
    const el = document.getElementById('lp_rim');
    el.value = '1.5';
    el.dispatchEvent(new Event('input'));
  });
  const lab1 = await page.evaluate(() => ({ rim: window.__game.lab.P.rim, dirty: window.__game.lab.dirty }));
  check(lab1.rim === 1.5 && lab1.dirty, '拖曳滑桿即時改參數（邊緣光 1.5，標示已修改）');
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-show.png') });
  await page.selectOption('#labStyle', 'builtin:ghibli').catch(() => {});
  await wait(300);
  check(
    await page.evaluate(() => window.__game.lab.P.sky === 'cloud' && window.__game.lab.P.water > 0),
    '切換到吉卜力風格（積雲天空、水彩地形）',
  );
  await page.selectOption('#labStyle', 'builtin:sandland');
  await wait(300);
  check(
    await page.evaluate(() => {
      const P = window.__game.lab.P;
      return P.toon === 1 && P.shadowType === 'hard' && P.ink === 1 && P.inkOuter > 2;
    }),
    '切換到鳥山明 SAND LAND 風格（賽璐璐、硬邊陰影、粗外輪廓）',
  );
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-sandland.png') });
  await page.selectOption('#labStyle', 'builtin:ac6');
  await page.selectOption('#labCam', 'cinema');
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-ac6.png') });
  // 動作 IK：手臂瞄準讓槍管對準瞄準點；關掉後權重淡出到 0；開關記在 rubicon_ik
  await page.click('#labIk summary');
  const ikState = () =>
    page.evaluate(() => {
      const g = window.__game;
      const out = { mechs: 0, err: [], w: 0 };
      const V = () => new THREE.Vector3(),
        q = new THREE.Quaternion();
      for (const e of g.labMechs()) {
        if (e.dead || e.opts.modelKind || !e.model.ik) continue;
        out.mechs++;
        for (const k of ['l', 'r']) {
          out.w = Math.max(out.w, e.model.ik.w.arm[k], e.model.ik.w.feet);
          const w = e.weapons[k + 'arm'];
          if (!w || w.dropped || w.def.type === 'melee' || e.melee.active || e.boost || e.staggerT > 0)
            continue;
          const a = e.model.arms[k].aim || e.model.arms[k].weapon; // 槍管（有持握角度時是 aim）
          const H = a.getWorldPosition(V());
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(a.getWorldQuaternion(q));
          out.err.push(f.angleTo(e.aimPoint().sub(H)));
        }
      }
      out.avg = out.err.length ? out.err.reduce((s, v) => s + v, 0) / out.err.length : 9;
      return out;
    });
  const ik1 = await ikState();
  check(
    ik1.mechs >= 3 && ik1.avg < 0.15,
    `動作 IK：${ik1.mechs} 台機甲套用，槍管對準瞄準點（平均誤差 ${ik1.avg.toFixed(3)} rad）`,
  );
  await page.uncheck('#ik_on');
  // 權重依遊戲時間淡出（每格 dt 上限 0.05 s，SwiftShader 幀率低時要多等）
  let ik2 = await ikState();
  for (let i = 0; i < 16 && ik2.w >= 0.01; i++) {
    await wait(500);
    ik2 = await ikState();
  }
  const ikSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('rubicon_ik')));
  check(
    ik2.w < 0.01 && ik2.avg > ik1.avg && ikSaved.on === false && (await page.isDisabled('#ik_arms')),
    `關掉 IK：權重淡出到 0、槍管回到動作層（平均誤差 ${ik2.avg.toFixed(3)} rad）、開關記住`,
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-ik-off.png') });
  await page.check('#ik_on');
  await page.uncheck('#ik_feet');
  check(
    await page.evaluate(() => {
      const o = JSON.parse(localStorage.getItem('rubicon_ik'));
      return o.on === true && o.feet === false && o.arms === true;
    }),
    '單項開關（關掉腳部貼地）',
  );
  await page.check('#ik_feet');
  // 跳躍與懸浮、地面衝擊波：以固定 dt 同步模擬輸入序列（不受 SwiftShader 幀率影響）
  const jumpRes = await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      pl = g.player;
    const foe = g.enemies.find((e) => !e.dead && !e.flying);
    const ai0 = pl.ai,
      foe0 = foe.pos.clone();
    pl.ai = null; // 不讓 AI 自己閃衝擊波
    const dt = 1 / 60,
      x0 = pl.pos.x,
      z0 = pl.pos.z;
    const hgt = () => pl.pos.y - w.groundAt(pl.pos.x, pl.pos.z, pl.pos.y + 0.1);
    const reset = () => {
      pl.pos.set(x0, w.groundAt(x0, z0, 99), z0);
      pl.vel.set(0, 0, 0);
      Object.assign(pl, { en: pl.enMax, hp: pl.maxHp, acs: 0, staggerT: 0, iFrames: 0, jumpPrev: false });
      for (let i = 0; i < 30; i++) pl.move(dt, new THREE.Vector3(), false, false, false, null);
    };
    const run = (seq, each) => {
      reset();
      let maxH = 0,
        t = 0;
      const marks = [];
      for (const [dur, held] of seq) {
        for (let k = 0; k < Math.round(dur / dt); k++, t += dt) {
          pl.move(dt, new THREE.Vector3(), held, false, false, null);
          if (each) each(t);
          maxH = Math.max(maxH, hgt());
        }
        marks.push({ h: hgt(), m: pl.hoverMode || 0 });
      }
      return { maxH, marks };
    };
    const tap = run([
      [0.05, true],
      [1.5, false],
    ]);
    const hold = run([
      [0.6, true],
      [1.0, true],
    ]);
    const climb = run([
      [0.7, true],
      [0.08, false],
      [0.8, true],
    ]);
    const dbl = run([
      [0.05, true],
      [0.3, false],
      [0.05, true],
      [1.5, false],
    ]);
    const shock = (jumpAt) => {
      g.shocks = [];
      let hp0 = 0;
      run([[2.5, false]], (t) => {
        if (t === 0) {
          foe.pos.set(pl.pos.x + 12, pl.pos.y, pl.pos.z);
          hp0 = pl.hp;
          g.shockStart(foe, { R: 30, sp: 24, dl: 0.9, dmg: 650, im: 1300 });
        }
        if (jumpAt !== null && Math.abs(t - jumpAt) < dt / 2) pl.jumpPressQ = pl.jumpExt = true;
        else pl.jumpExt = false;
        g.updateShocks(dt);
      });
      return hp0 - pl.hp;
    };
    const hitGround = shock(null),
      hitJump = shock(1.2);
    pl.ai = ai0;
    foe.pos.copy(foe0);
    g.shocks = [];
    return {
      type: pl.model.type,
      tap: tap.maxH,
      tapEnd: tap.marks[1].h,
      hover:
        hold.marks[0].m === 1 && Math.abs(hold.marks[1].h - hold.marks[0].h) < 1 && hold.marks[1].h > 1.5,
      hoverH: hold.marks[1].h,
      climb: climb.marks[2].m === 2 ? climb.marks[2].h - climb.marks[0].h : -1,
      dbl: dbl.maxH,
      hitGround,
      hitJump,
    };
  });
  check(
    jumpRes.type === 'tank' ||
      (jumpRes.tap > 2 &&
        jumpRes.tapEnd < 0.05 &&
        jumpRes.hover &&
        jumpRes.climb > 2 &&
        jumpRes.dbl > jumpRes.tap + 1.5 &&
        jumpRes.hitGround > 0 &&
        jumpRes.hitJump === 0),
    `跳躍與懸浮（${jumpRes.type}）：短按跳 ${jumpRes.tap.toFixed(1)} m 後落地、按住在最高點定高懸浮（${jumpRes.hoverH.toFixed(1)} m）、` +
      `放開再按住爬升 ${jumpRes.climb.toFixed(1)} m、二段跳 ${jumpRes.dbl.toFixed(1)} m、` +
      `衝擊波貼地受傷 ${Math.round(jumpRes.hitGround)}／起跳躲開 ${Math.round(jumpRes.hitJump)}`,
  );
  // 特殊一般敵人（entities/mech-special.js、game/support.js）：暫時把地形與障礙物的判定攤平、其他機體移到角落，
  // 以固定 dt 同步模擬，結束後還原
  const foeRes = await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      pl = g.player;
    const saved = {
      th: w.terrainHeight,
      rh: w.rampHeight,
      obs: w.obstacles,
      props: (w.props || []).map((p) => p.dead),
      pl: { pos: pl.pos.clone(), hp: pl.hp, maxHp: pl.maxHp, acsMax: pl.acsMax, ai: pl.ai, yaw: pl.yaw },
      others: [...g.enemies, ...g.allies].map((e) => [e, e.pos.clone()]),
    };
    const n0 = g.enemies.length;
    w.terrainHeight = () => 0;
    w.rampHeight = () => -99;
    w.obstacles = [];
    for (const p of w.props || []) p.dead = true;
    saved.others.forEach(([e], i) => e.pos.set(i % 2 ? 60 : -60, 0, e.team === 'enemy' ? -62 : 62));
    pl.ai = null;
    const dt = 1 / 60;
    const mine = [];
    const reset = () => {
      for (const e of g.enemies.splice(n0)) e.cleanup();
      for (const q of g.projectiles) g.scene.remove(q.mesh);
      g.projectiles.length = 0;
      g.shocks = [];
      g.clearSupport();
      Object.assign(pl, {
        hp: 1e6,
        maxHp: 1e6,
        acs: 0,
        acsMax: 1e9,
        staggerT: 0,
        iFrames: 0,
        dead: false,
        yaw: 0,
      });
      pl.pos.set(0, 0, 30);
      pl.vel.set(0, 0, 0);
    };
    const spawn = (k, dx, dz) => {
      const e = g.spawnType(k, 1, 1);
      e.pos.set(dx, e.flying ? e.hoverH : 0, 30 + dz);
      e.yaw = e.aimYaw = Math.atan2(dx, -dz);
      mine.push(e);
      return e;
    };
    const step = (sec, wish, hold) => {
      for (let i = 0; i < Math.round(sec / dt); i++) {
        g.time += dt;
        pl.move(dt, wish ? wish.clone() : new THREE.Vector3(), !!hold, false, false, null);
        for (const e of g.enemies.slice(n0)) if (!e.dead) e.updateAI(dt);
        for (let k = g.projectiles.length - 1; k >= 0; k--) {
          g.projectiles[k].update(dt);
          if (g.projectiles[k].dead) g.projectiles.splice(k, 1);
        }
        g.updateShocks(dt);
        g.updateSupport(dt);
      }
    };
    const lost = () => 1e6 - pl.hp;
    const r = {};
    // 盾牌 MT：正面／背面／高處
    reset();
    const sh = spawn('mt_shield', 0, -14);
    const fwd = new THREE.Vector3(-Math.sin(sh.yaw), 0, -Math.cos(sh.yaw));
    const hit = (off, melee) => {
      Object.assign(sh, { hp: sh.maxHp, staggerT: 0, acs: 0, guardBreakT: 0 });
      const src = sh.pos.clone().add(off);
      const dir = sh.center().sub(src).normalize();
      sh.takeDamage(
        100,
        50,
        { pos: src, center: () => src.clone(), team: 'player' },
        sh.center().addScaledVector(dir, -1.3),
        dir,
        melee,
      );
      return sh.maxHp - sh.hp;
    };
    r.shield = [
      hit(fwd.clone().multiplyScalar(14)),
      hit(fwd.clone().multiplyScalar(-14)),
      hit(fwd.clone().multiplyScalar(6).setY(9)),
    ];
    hit(fwd.clone().multiplyScalar(3), { kb: 0 });
    r.guardBreak = sh.guardBreakT > 0;
    // 迫擊砲：站著不動會被打中、直線移動躲得掉
    reset();
    spawn('mt_mortar', 0, -45);
    step(8);
    r.mortarStill = lost();
    // 一發瞄準腳下的砲彈：站著會中、看到預警圈後直線走開就躲得掉
    const shell = (move) => {
      reset();
      const mo = spawn('mt_mortar', 0, -45);
      mo.updateAI = function () {};
      g.mortarShot(mo, pl.pos.clone(), { dmg: 500, im: 500, R: 5.5 });
      step(3, move ? new THREE.Vector3(1, 0, 0) : null);
      return lost();
    };
    r.mortarShell = [shell(false), shell(true)];
    // 地雷：懸浮飛過不觸發、走過去觸發
    reset();
    g.layMine({ center: () => pl.pos.clone().setY(8), team: 'enemy' }, new THREE.Vector3(0, 0, 24), {
      dmg: 460,
      im: 700,
      R: 4.5,
    });
    g.mines[0].owner = null;
    step(1);
    step(0.5, null, true);
    step(1.6, new THREE.Vector3(0, 0, -1), true);
    r.mineOver = [lost(), g.mines.length];
    step(4.5, new THREE.Vector3(0, 0, 1));
    r.mineWalk = [lost(), g.mines.length];
    // 布雷無人機會撒雷
    reset();
    spawn('minelayer', 0, -18);
    step(6);
    r.laid = g.mines.length + (lost() > 0 ? 1 : 0);
    // 修理無人機
    reset();
    const hurt = spawn('mt', 6, -25);
    hurt.updateAI = function () {};
    hurt.hp = hurt.maxHp * 0.4;
    const h0 = hurt.hp;
    spawn('repair', 0, -30);
    step(4);
    r.heal = hurt.hp - h0;
    // 護盾產生器：外面打不進、進到裡面打得到
    reset();
    const gen = spawn('mt_dome', 0, -30);
    gen.updateAI(dt);
    gen.updateAI = function () {
      this.move(dt, new THREE.Vector3(), false, false, false, null);
    };
    const tgt = spawn('mt', 3, -28);
    tgt.updateAI = function () {};
    const shoot = (n) => {
      const a = tgt.hp;
      for (let i = 0; i < n; i++) {
        Object.assign(pl.weapons.rarm, { cd: 0, reloadT: 0, mag: 99 });
        pl.fire('rarm', tgt.center(), tgt);
        step(0.08);
      }
      step(0.6);
      return a - tgt.hp;
    };
    const d0 = gen.domeHp;
    r.domeOut = [shoot(12), d0 - gen.domeHp];
    pl.pos.set(gen.pos.x + 2, 0, gen.pos.z + 5);
    r.domeIn = shoot(8);
    // 運輸機：投放 3 台後飛走
    reset();
    const ds = spawn('dropship', 0, -70);
    const n1 = g.enemies.length;
    for (let t = 0; t < 25 && !ds.gone; t += 0.5) step(0.5);
    r.drop = [g.enemies.length - n1, !!ds.gone];
    // 指揮官：強化周圍、擊破後混亂
    reset();
    const cmd = spawn('mt_cmd', 0, -32);
    const mt = spawn('mt', 6, -26);
    step(0.1);
    r.buff = mt.buffT > 0;
    cmd.takeDamage(1e7, 0, pl, cmd.center());
    r.confuse = mt.confuseT > 0;
    // 還原
    reset();
    w.terrainHeight = saved.th;
    w.rampHeight = saved.rh;
    w.obstacles = saved.obs;
    (w.props || []).forEach((p, i) => (p.dead = saved.props[i]));
    for (const [e, p] of saved.others) e.pos.copy(p);
    Object.assign(pl, saved.pl);
    pl.pos.copy(saved.pl.pos);
    pl.vel.set(0, 0, 0);
    g.introSeen = null;
    return r;
  });
  check(
    foeRes.shield[0] < foeRes.shield[1] * 0.3 &&
      foeRes.shield[2] > foeRes.shield[1] * 0.9 &&
      foeRes.guardBreak &&
      foeRes.mortarStill > 0 &&
      foeRes.mortarShell[0] > 0 &&
      foeRes.mortarShell[1] === 0 &&
      foeRes.mineOver[0] === 0 &&
      foeRes.mineOver[1] === 1 &&
      foeRes.mineWalk[0] > 0 &&
      foeRes.mineWalk[1] === 0 &&
      foeRes.laid > 0 &&
      foeRes.heal > 0 &&
      foeRes.domeOut[0] === 0 &&
      foeRes.domeOut[1] > 0 &&
      foeRes.domeIn > 0 &&
      foeRes.drop[0] === 3 &&
      foeRes.drop[1] &&
      foeRes.buff &&
      foeRes.confuse,
    `特殊敵人：盾牌正面 ${Math.round(foeRes.shield[0])}／背面 ${Math.round(foeRes.shield[1])}／高處 ${Math.round(foeRes.shield[2])}、近戰破盾、` +
      `迫擊砲 ${Math.round(foeRes.mortarStill)}（單發站著 ${Math.round(foeRes.mortarShell[0])}／走開 ${Math.round(foeRes.mortarShell[1])}）、地雷飛過 ${foeRes.mineOver[0]}／走過 ${Math.round(foeRes.mineWalk[0])}、` +
      `修理 +${Math.round(foeRes.heal)}、護盾外 ${Math.round(foeRes.domeOut[0])}（吸收 ${Math.round(foeRes.domeOut[1])}）／內 ${Math.round(foeRes.domeIn)}、` +
      `運輸機投放 ${foeRes.drop[0]} 台後離場、指揮官強化與混亂`,
  );
  await page.click('#labCtrl');
  await wait(800);
  check(
    (await visible(page, 'hudWrap')) && (await page.evaluate(() => window.__game.player.isPlayer)),
    '操作模式：顯示 HUD、自己駕駛藍隊機體',
  );
  await playFor(page, 1500);
  await page.click('#labWatch');
  await page.selectOption('#labStyle', 'builtin:gundam');
  await page.fill('#labName', '測試風格');
  await page.click('#labSaveNew');
  await page.click('#labApply');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('rubicon_style')));
  check(
    stored.sel.k === 'mine' &&
      stored.mine.some((m) => m.name === '測試風格' && m.params.toon === 1) &&
      stored.metal,
    '存成「我的預設」並套用到遊戲（記住機體金屬）',
  );
  await page.click('#labExit');
  check(await waitVisible(page, 'title'), '離開實驗室回到標題');
  check(
    (await page.evaluate(() =>
      localStorage.getItem('rubicon_save_' + (localStorage.getItem('rubicon_save_cur') || 1)),
    )) === save0,
    '模擬戰鬥不改存檔（擊破不入帳）',
  );
  await page.click('#btnSettings');
  await waitVisible(page, 'settings');
  check(
    ((await page.$eval('#styleSel', (s) => s.selectedOptions[0].textContent)) || '').includes('測試風格'),
    '設定畫面的「畫面風格」顯示套用的風格',
  );
  // 設定畫面的動作 IK：和實驗室共用開關
  const ikBoxN = await page.$$eval('#ikBox input[data-ik]', (els) => els.length);
  await page.uncheck('#ikBox input[data-ik="arms"]');
  await page.uncheck('#ikBox input[data-ik="on"]');
  const ikSet1 = await page.evaluate(() => ({
    o: JSON.parse(localStorage.getItem('rubicon_ik')),
    dis: document.querySelector('#ikBox input[data-ik="feet"]').disabled,
  }));
  check(
    ikBoxN === 13 && ikSet1.o.arms === false && ikSet1.o.on === false && ikSet1.dis,
    `設定畫面的動作 IK 開關（總開關＋${ikBoxN - 1} 項，關掉總開關時單項停用）`,
  );
  await page.check('#ikBox input[data-ik="on"]');
  await page.check('#ikBox input[data-ik="arms"]');
  await page.click('#btnSettingsBack');
  await newCareer(page);
  await waitVisible(page, 'garage');
  await page.click('#btnSortie');
  check(await waitVisible(page, 'hudWrap', 15000), '出擊');
  await playFor(page, 1500);
  check(
    await page.evaluate(() => window.__game.styleP.toon === 1 && window.__game.styleP.metal === true),
    '出擊時使用套用的風格（色階光照＋機體金屬）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-mission.png') });
  await ctx.close();
}

// 存檔槽：舊版單一存檔搬進存檔 1 → 三槽獨立 → 匯出 → 匯入（空槽、覆蓋確認、錯誤檔案）→ 刪除 → 從標題選任一槽繼續
async function testSaves(browser, base) {
  console.log('存檔槽：舊存檔遷移 → 三槽獨立 → 匯出／匯入 → 刪除 → 繼續');
  const { ctx, page } = await newPage(browser, 'saves');
  await page.goto(base);
  await waitVisible(page, 'title');
  // 模擬舊版：只有 rubicon_save，沒有 rubicon_save_cur
  await page.evaluate(() => {
    for (const k of ['rubicon_save_cur', 'rubicon_save_1', 'rubicon_save_2', 'rubicon_save_3'])
      localStorage.removeItem(k);
    localStorage.setItem(
      'rubicon_save',
      JSON.stringify({ coam: 123456, owned: ['h_std'], asm: { head: 'h_std' }, level: 5, kills: 42 }),
    );
  });
  await page.reload();
  await waitVisible(page, 'title');
  const ls = (k) => page.evaluate((k) => localStorage.getItem(k), k);
  const lvl = async (i) => {
    const v = await ls('rubicon_save_' + i);
    return v ? JSON.parse(v).level : 0;
  };
  check(
    (await lvl(1)) === 5 && !!(await ls('rubicon_save')) && (await ls('rubicon_save_cur')) === '1',
    '舊版存檔搬進存檔 1（舊鍵保留）',
  );
  check(
    (await page.textContent('#btnContinue')).includes('存檔 1') && !(await page.isDisabled('#btnContinue')),
    '標題「繼續存檔」顯示目前的槽位（存檔 1）',
  );
  await page.click('#btnSaves');
  check(await waitVisible(page, 'saves'), '「選擇存檔」開啟存檔畫面');
  const card = (i) => `#saveSlots [data-slot="${i}"]`;
  const text1 = (await page.textContent(card(1))) || '';
  check(
    text1.includes('任務 05') && text1.includes('123,456') && text1.includes('擊破 42'),
    `存檔 1 顯示摘要（${text1.replace(/\s+/g, ' ').trim().slice(0, 60)}）`,
  );
  check(
    !!(await page.$(`${card(2)} [data-act="new"]`)) && !!(await page.$(`${card(3)} [data-act="new"]`)),
    '存檔 2、3 是空的（新的傭兵生涯）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'saves.png') });
  // 存檔 2 開新生涯 → 回標題：目前槽位是 2，存檔 1 不受影響
  await page.click(`${card(2)} [data-act="new"]`);
  check(await waitVisible(page, 'garage'), '存檔 2 開新的傭兵生涯進入車庫');
  await page.click('#btnToTitle');
  await waitVisible(page, 'title');
  check(
    (await ls('rubicon_save_cur')) === '2' &&
      (await lvl(2)) === 1 &&
      (await lvl(1)) === 5 &&
      (await page.textContent('#btnContinue')).includes('存檔 2'),
    '三槽獨立：目前是存檔 2（任務 01），存檔 1 仍是任務 05',
  );
  // 匯出存檔 1
  await page.click('#btnSaves');
  await waitVisible(page, 'saves');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`${card(1)} [data-act="exp"]`)]);
  const exported = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  check(
    /^rubicon-save-1-\d{8}\.json$/.test(dl.suggestedFilename()) &&
      exported.format === 'rubicon-save' &&
      exported.save.level === 5,
    `匯出存檔 1（${dl.suggestedFilename()}）`,
  );
  const file = {
    name: 'save.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(exported)),
  };
  const importTo = async (i, f) => {
    const [fc] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.click(`${card(i)} [data-act="imp"]`),
    ]);
    await fc.setFiles(f);
    await wait(400);
  };
  // 匯入到空的存檔 3：直接寫入
  await importTo(3, file);
  check((await lvl(3)) === 5 && (await page.textContent(card(3))).includes('任務 05'), '匯入到空的存檔 3');
  // 匯入到有存檔的存檔 2：先確認，取消不變，確定才覆蓋
  await importTo(2, file);
  check(!!(await page.$(`${card(2)} [data-act="yes"]`)), '匯入到有存檔的槽位要先確認');
  await page.click(`${card(2)} [data-act="no"]`);
  check((await lvl(2)) === 1, '取消覆蓋時存檔 2 不變');
  await importTo(2, file);
  await page.click(`${card(2)} [data-act="yes"]`);
  check((await lvl(2)) === 5, '確定後存檔 2 被匯入的存檔覆蓋');
  // 錯誤的檔案
  await importTo(1, { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  check(
    (await page.textContent('#savesMsg')).includes('不是') && (await lvl(1)) === 5,
    '匯入不是存檔的檔案時提示錯誤、存檔不變',
  );
  // 刪除存檔 3（取消再確定）
  await page.click(`${card(3)} [data-act="del"]`);
  await page.click(`${card(3)} [data-act="no"]`);
  check((await lvl(3)) === 5, '取消刪除時存檔 3 還在');
  await page.click(`${card(3)} [data-act="del"]`);
  await page.click(`${card(3)} [data-act="yes"]`);
  check(
    !(await ls('rubicon_save_3')) && !!(await page.$(`${card(3)} [data-act="new"]`)),
    '刪除存檔 3 後變成空槽',
  );
  // 刪除目前的存檔 2：改用最近玩過的存檔 1
  await page.click(`${card(2)} [data-act="del"]`);
  await page.click(`${card(2)} [data-act="yes"]`);
  check((await ls('rubicon_save_cur')) === '1', '刪除目前的槽位後改用另一個有存檔的槽位（存檔 1）');
  // 從存檔畫面繼續存檔 1 → 車庫用的是存檔 1
  await page.click(`${card(1)} [data-act="cont"]`);
  check(await waitVisible(page, 'garage'), '存檔畫面「繼續」進入車庫');
  check(
    await page.evaluate(() => window.__game.save.level === 5 && window.__game.saveSlot === 1),
    '繼續的是存檔 1',
  );
  // 重新整理後「繼續存檔」接上次的槽位
  await page.reload();
  await waitVisible(page, 'title');
  await page.click('#btnContinue');
  await waitVisible(page, 'garage');
  check(await page.evaluate(() => window.__game.save.level === 5), '重新整理後「繼續存檔」接存檔 1');
  await ctx.close();
}

async function testSolo(browser, base) {
  console.log('單機：標題 → 車庫 → 出擊');
  const { ctx, page } = await newPage(browser, 'solo');
  await page.goto(base);
  check(await waitVisible(page, 'title'), '標題畫面顯示');
  await wait(1000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'title.png') });
  await newCareer(page);
  check(await waitVisible(page, 'garage'), '車庫畫面顯示');
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'garage.png') });
  await page.click('#btnSortie');
  check(await waitVisible(page, 'hudWrap', 15000), '出擊後 HUD 顯示');
  await playFor(page, 6000);
  const hp = await page.textContent('#hpTxt');
  check(/\d/.test(hp || ''), `HP 顯示數值（${(hp || '').trim()}）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'solo.png') });
  await page.keyboard.press('Escape');
  await wait(500);
  check(await visible(page, 'pause'), '暫停選單顯示');
  if (await page.$('#rPilot')) {
    await page.click('#btnAbort');
    check(await waitVisible(page, 'result'), '放棄任務後顯示結果畫面');
    const rp = (await page.textContent('#rPilot')) || '';
    check(rp.includes('駕駛員經驗'), `結果畫面顯示駕駛員經驗（${rp.trim().slice(0, 30)}…）`);
  }
  await ctx.close();
}

// 各地圖的特殊機制：水壩的閘門與坡道、Grid 086 的懸空坡道、洋上都市的虛空墜落、高空軌道沒有通道、地下的光照
async function mapMechanics(page, key) {
  if (key === 'dam') {
    const r = await page.evaluate(() => {
      const w = window.__game.world,
        D = w.dam,
        gt = D.gates[0];
      const sx = gt.x + gt.gw / 2 + 4;
      return {
        gates: D.gates.length,
        ramps: (w.ramps || []).filter((q) => q.y1 === 14).length,
        top: w.groundAt(sx, D.zc, 20),
        under: w.groundAt(gt.x, D.zc, 0),
      };
    });
    check(
      r.gates >= 2 && r.ramps >= 1 && Math.abs(r.top - 14) < 0.5 && r.under < 4,
      `水壩：閘門 ${r.gates} 座（下方地面 ${r.under.toFixed(1)}）、坡道 ${r.ramps} 座、壩頂 ${r.top.toFixed(1)} m`,
    );
  } else if (key === 'grid086') {
    const r = await page.evaluate(() => {
      const w = window.__game.world;
      const lift = (w.ramps || []).find((q) => q.lift);
      const decks = w.obstacles.filter((o) => o.deck);
      return {
        l1: decks.filter((o) => Math.abs(o.top - 11) < 0.1).length,
        l2: decks.filter((o) => Math.abs(o.top - 21) < 0.1).length,
        lift: !!lift,
        low: lift ? w.groundAt(lift.x, lift.z, 0.5) : 0,
        mid: lift ? w.groundAt(lift.x, lift.z, 16) : 0,
      };
    });
    check(
      r.l1 > 4 && r.l2 > 0 && r.lift && r.low < 12 && r.mid > 14,
      `Grid 086：第一層 ${r.l1}、第二層 ${r.l2} 塊平台；懸空坡道下方 ${r.low.toFixed(1)}、坡面上 ${r.mid.toFixed(1)}`,
    );
  } else if (key === 'xylem') {
    const r0 = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        p = g.player;
      for (let x = -80; x <= 80; x += 4)
        for (let z = -80; z <= 80; z += 4)
          if (
            Math.hypot(x - p.pos.x, z - p.pos.z) < 60 &&
            // 周圍 8 m 都是虛空（貼著街區邊緣或高樓時會被推回街區上）
            [
              [0, 0],
              [8, 0],
              [-8, 0],
              [0, 8],
              [0, -8],
            ].every(([dx, dz]) => w.isVoid(x + dx, z + dz))
          ) {
            p.pos.set(x, 0.6, z);
            p.vel.set(0, 0, 0);
            return { hp0: p.hp };
          }
      return null;
    });
    // headless 的幀率低（遊戲時間比真實時間慢）：等到被拉回（扣 AP）為止，最多 10 秒
    for (let t = 0; t < 50 && r0; t++) {
      await wait(200);
      // 被拉回＝扣 AP 而且站回實地（敵機的子彈也會扣 AP，所以兩個都要看）
      const st = await page.evaluate(() => {
        const g = window.__game;
        return { hp: g.player.hp, solid: !g.world.isVoid(g.player.pos.x, g.player.pos.z) };
      });
      if (st.hp < r0.hp0 && st.solid) break;
    }
    await wait(300);
    const r = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        p = g.player;
      return {
        y: p.pos.y,
        hp: p.hp,
        solid: !w.isVoid(p.pos.x, p.pos.z),
        // 掉進虛空、已經低於拉回高度還沒被拉回的（正在往下掉的不算）
        aiInVoid: g.enemies.filter(
          (e) => !e.dead && !e.flying && w.isVoid(e.pos.x, e.pos.z) && e.pos.y < w.voidY - 1,
        ).length,
      };
    });
    check(
      !!r0 && r.y > -2 && r.solid && r.hp < r0.hp0,
      `洋上都市：掉進海裡被拉回平台（y ${r.y.toFixed(1)}、AP ${r0 && r0.hp0} → ${r.hp}）`,
    );
    check(r.aiInVoid === 0, `洋上都市：沒有敵機掉在虛空裡（${r.aiInVoid}）`);
    const pv = await page.evaluate(() => {
      const g = window.__game,
        w = g.world;
      const pts = [0, 1, 2, 3].map((i) => g.pvpSpawnPoint(i, 4));
      return pts.filter((p) => w.isVoid(p.x, p.z)).length;
    });
    check(pv === 0, `洋上都市：PvP 出生點不在虛空（${pv} 個在虛空）`);
  } else if (key === 'orbit') {
    const r = await page.evaluate(() => ({ corridor: !!window.__game.world.corridor }));
    check(!r.corridor, '高空軌道：沒有公路／鐵路');
  } else if (key === 'institute') {
    const r = await page.evaluate(() => ({ sun: window.__game.sun.intensity }));
    check(r.sun < 0.6, `地下技研都市：光照較暗（太陽 ${r.sun.toFixed(2)}）`);
  }
}

// 地圖選擇與新主題：車庫選地圖 → 出擊用那張地圖（專屬物件、放大的場地、天氣）→ 放棄；記住選擇
async function testMaps(browser, base) {
  console.log('地圖：車庫選地圖 → 新主題出擊');
  const { ctx, page } = await newPage(browser, 'maps');
  await page.goto(base);
  await waitVisible(page, 'title');
  await newCareer(page);
  await waitVisible(page, 'garage');
  const opts = await page.$$eval('#gMapSel option', (os) => os.map((o) => o.value));
  check(
    opts[0] === '' && opts.includes('wasteland') && opts.includes('dunes'),
    `車庫的地圖選單（${opts.length} 項，含隨機）`,
  );
  const OLD = ['container', 'truck', 'rock', 'pillar'];
  for (const [key, want] of [
    ['wasteland', ['hopper', 'spire']],
    ['dunes', ['mtwreck', 'sandstone']],
    ['flooded', ['car', 'ruinwall']],
    ['dam', ['control', 'transformer']],
    ['spaceport', ['fuelsphere', 'blastwall']],
    ['grid086', ['shack', 'scrapheap']],
    ['xylem', ['aaturret', 'planter']],
    ['orbit', ['solar', 'radiator']],
    ['institute', ['coraltank', 'crystal']],
    ['snow', ['quonset', 'ice']],
  ]) {
    await page.selectOption('#gMapSel', key);
    await page.evaluate(() => localStorage.setItem('rubicon_variant', 'base')); // 標準變體（隨機的變體物件組不同）
    await page.click('#btnSortie');
    check(await waitVisible(page, 'hudWrap', 20000), `${key} 出擊`);
    await playFor(page, 1500);
    const info = await page.evaluate(() => {
      const g = window.__game,
        w = g.world;
      return {
        theme: g.worldTheme,
        size: w.size,
        lim: w.lim,
        kinds: [...new Set((w.props || []).map((p) => p.kind))],
        weather: !w.theme.weather || !!(w.weather && w.weather.points),
      };
    });
    check(
      info.theme === key && info.size === 230 && info.lim > 62 && info.weather,
      `${key}：場地 ${info.size} m（活動範圍 ±${info.lim.toFixed(0)}）、天氣粒子`,
    );
    // 地圖物件的外部素材（render/world-assets.js）：換成 GLB 的物件，外框（碰撞、命中形狀）和程式模型相同
    const WANT_ASSET = {
      wasteland: ['rock_spire'],
      dunes: ['sandstone'],
      snow: ['ice_chunk', 'radar_dish', 'obs_dome'],
      grid086: ['barrels'],
    }[key];
    if (WANT_ASSET) {
      const as = await page.evaluate(async () => {
        const g = window.__game;
        const seen = {};
        g.scene.traverse((o) => {
          const s = o.userData.asset;
          if (s) seen[s] = (seen[s] || 0) + 1;
        });
        // 同樣的參數各建一次程式模型與外部素材的版本（同樣旋轉），比較量到的外框
        const P = window.__worldProps;
        const WA = window.__WA;
        let diff = 0;
        for (const make of [
          () => P.buildRadarDish(0x8a9098),
          () => P.buildRockSpire(2.2, 8, 0x7a6a5a),
          () => P.buildRock(3, new THREE.MeshStandardMaterial({ color: 0x7a6a5a })),
        ]) {
          const box = (on) => {
            WA.ready = on;
            const o = make();
            WA.ready = true;
            o.rotation.set(0.3, 1.1, 0.2);
            o.updateMatrixWorld(true);
            return [new THREE.Box3().setFromObject(o), !!o.userData.asset];
          };
          const [a, pa] = box(false),
            [b, pb] = box(true);
          if (pa || !pb) diff = 99;
          diff = Math.max(diff, a.min.distanceTo(b.min), a.max.distanceTo(b.max));
        }
        return { ready: WA.ready, seen, diff };
      });
      check(
        as.ready && WANT_ASSET.every((s) => as.seen[s] > 0) && as.diff < 1e-3,
        `${key}：地圖物件換成外部素材（${Object.entries(as.seen)
          .map(([k, v]) => `${k}×${v}`)
          .join('、')}），外框和程式模型相同（差 ${as.diff.toFixed(4)} m）`,
      );
    }
    await mapMechanics(page, key);
    // 邊界（world/edges.js）：分段處理至少兩種、不是整圈隆起、有遠景地形；虛空地圖不改地形
    const eg = await page.evaluate(() => {
      const w = window.__game.world,
        E = w.edges;
      const far = w.meshes.some((m) => m.userData.farTerrain);
      if (E.none) return { none: true, far };
      let up = 0,
        flat = 0;
      const N = 72;
      for (let i = 0; i < N; i++) {
        const th = (i / N) * Math.PI * 2,
          c = Math.cos(th),
          s = Math.sin(th);
        const k = (E.e0 + 30) / Math.max(Math.abs(c), Math.abs(s));
        const x = c * k,
          z = s * k;
        const d = w.farHeight(x, z) - w.featureHeight(x, z, w.baseH(x, z));
        if (d > 4) up++;
        else if (d < 1.5) flat++;
      }
      return { kinds: new Set(E.arcs.map((a) => a.kind)).size, up, flat, N, far };
    });
    check(
      eg.none ? !eg.far : eg.kinds >= 2 && eg.flat >= 4 && eg.up < eg.N * 0.8 && eg.far,
      eg.none
        ? `${key}：邊界是虛空（不改地形、沒有遠景地形）`
        : `${key}：邊界分段 ${eg.kinds} 種處理、隆起 ${eg.up}／平地或往下 ${eg.flat}（共 ${eg.N} 個方向）、有遠景地形`,
    );
    check(
      want.every((k) => info.kinds.includes(k)) && !info.kinds.some((k) => OLD.includes(k)),
      `${key}：專屬物件（${info.kinds.join('、')}），沒有舊地圖的貨櫃／卡車／岩石／路燈`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, `map-${key}.png`) });
    await page.keyboard.press('Escape');
    await wait(400);
    await page.click('#btnAbort');
    await waitVisible(page, 'result');
    await page.click('#btnResultOk');
    await waitVisible(page, 'garage');
  }
  check(
    (await page.$eval('#gMapSel', (s) => s.value)) === 'snow' &&
      (await page.evaluate(() => localStorage.getItem('rubicon_map'))) === 'snow',
    '車庫記住選的地圖',
  );
  await page.selectOption('#gMapSel', '');
  await ctx.close();
}

// 模型庫：所有模型槽都能建立並量測尺寸、檢視窗資訊與尺寸標線、動作預覽、窄螢幕
async function testLibrary(browser, base) {
  console.log('模型庫：格狀檢視 → 量測 → 檢視窗 → 動作預覽');
  if (!fs.existsSync(LIBRARY)) return check(false, '找不到 dist/model-library.html');
  const { ctx, page } = await newPage(browser, 'library');
  await page.goto(base + 'model-library.html');
  await page.waitForSelector('.cell');
  const total = await page.$$eval('.cell', (x) => x.length);
  check(total >= 150, `列出所有模型槽（${total} 格）`);
  const cols = await page.$eval('#grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  check(cols === 3, `電腦版一行三格（${cols}）`);
  // 捲動到底讓每一格都建立模型
  for (let i = 0, still = 0; i < 120 && still < 3; i++) {
    await page.mouse.wheel(0, 700);
    await wait(250);
    // 捲到底後再多停幾次（格數變多時不會漏掉最後幾格）
    const atEnd = await page.evaluate(
      () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2,
    );
    still = atEnd ? still + 1 : 0;
  }
  await wait(3000);
  const sizes = await page.$$eval('.cell .sz', (x) => x.map((e) => e.textContent));
  const bad = sizes.filter((t) => !/\d+\.\d\d × \d+\.\d\d × \d+\.\d\d m/.test(t)).length;
  check(bad === 0, `每格都標示公尺尺寸（未完成 ${bad} 格）`);
  // 地圖物件的內建素材（lib/world-assets.js）：有登記的槽位顯示「內建素材」，開關切回程式模型
  const ASSET_IDS = ['prop/rock', 'prop/ice_chunk', 'prop/radar_dish', 'prop/barrels'];
  // 格子捲到畫面內才建立模型，逐一捲過去再讀標籤
  const badges = async () => {
    const out = [];
    for (const id of ASSET_IDS) {
      await page.$eval(`.cell[data-id="${id}"]`, (c) => c.scrollIntoView({ block: 'center' }));
      await page
        .waitForFunction(
          (id) => document.querySelector(`.cell[data-id="${id}"] .loading`).style.display === 'none',
          id,
          { timeout: 10000 },
        )
        .catch(() => {});
      out.push(await page.$eval(`.cell[data-id="${id}"] .badge`, (b) => b.textContent));
    }
    return out;
  };
  await page.$eval('.cell[data-id="prop/rock"]', (c) => c.scrollIntoView({ block: 'center' }));
  await page.waitForFunction(
    (id) => /內建素材/.test(document.querySelector(`.cell[data-id="${id}"] .badge`).textContent),
    'prop/rock',
    { timeout: 20000 },
  );
  const bOn = await badges();
  await page.uncheck('#libAssets');
  await wait(1500);
  const bOff = await badges();
  await page.check('#libAssets');
  await wait(1500);
  const bBack = await badges();
  check(
    bOn.every((t) => t === '內建素材') &&
      bOff.every((t) => t === '程式模型') &&
      bBack.every((t) => t === '內建素材'),
    `地圖物件顯示內建素材、開關切回程式模型（${bOn.join('／')} → ${bOff.join('／')}）`,
  );
  await page.evaluate(() => scrollTo(0, 0));
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'library.png') });
  // 每行 7 格（精簡顯示、只轉游標停留的格子）→ 重新整理後保留 → 改回 3 格
  await page.selectOption('#gridCols', '7');
  await wait(1200);
  const g7 = await page.evaluate(() => ({
    cols: getComputedStyle(document.getElementById('grid')).gridTemplateColumns.split(' ').length,
    dense: document.getElementById('grid').classList.contains('dense'),
    spin: document.getElementById('gridSpin').checked,
  }));
  check(
    g7.cols === 7 && g7.dense && !g7.spin,
    `每行改成 7 格：精簡顯示、只轉游標停留的格子（${g7.cols} 格）`,
  );
  await page.hover('.cell:nth-child(3)');
  await wait(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'library-7cols.png') });
  await page.reload();
  await page.waitForSelector('.cell');
  check(
    (await page.$eval('#grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 7 &&
      (await page.$eval('#gridCols', (s) => s.value)) === '7',
    '重新整理後保留每行格數',
  );
  await page.check('#gridSpin');
  await page.selectOption('#gridCols', '5');
  await wait(500);
  check(
    (await page.$eval('#grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length)) === 5,
    '每行改成 5 格',
  );
  await page.selectOption('#gridCols', '3');
  await wait(800);
  check(await page.$eval('#gridSpin', (c) => c.checked), '改回 3 格時預設全部旋轉');
  await page.click('.cell[data-id="mech/boss_juggernaut"]');
  check(
    await page.waitForSelector('#inspect:not([hidden])', { timeout: 10000 }).then(
      () => true,
      () => false,
    ),
    '點擊格子開啟檢視窗',
  );
  await wait(2500);
  const info = (await page.textContent('#insInfo')) || '';
  check(info.includes('原始尺寸') && info.includes('×2.6'), 'Boss 同時顯示遊戲尺寸與原始尺寸（×2.6）');
  const lbls = await page.$$eval('#insLabels .lbl', (x) => x.map((e) => e.textContent));
  check(
    lbls.some((t) => t.startsWith('高 ')) && lbls.some((t) => t.includes('1.8 m')),
    '檢視窗顯示尺寸標線、刻度與人形',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'library-inspect.png') });
  await page.click('#insAnims button[data-a="walk"]');
  await wait(1000);
  await page.keyboard.press('Escape');
  check(await page.isHidden('#inspect'), 'Esc 關閉檢視窗');
  await page.setViewportSize({ width: 420, height: 800 });
  await wait(800);
  const cols2 = await page.$eval('#grid', (g) => getComputedStyle(g).gridTemplateColumns.split(' ').length);
  check(cols2 === 1, `窄螢幕改為一行一格（${cols2}）`);
  await ctx.close();
}

// 模型庫 GLB 流程：區塊範本 GLB 匯出 → 載入同一槽位 → 規格檢查全部通過 → 並排對照 → 組合預覽 →
// 左側武器暫用右側 → 錯放偵測 → 移除 → 完整機甲改用區塊組合
// 視圖、姿勢與參考圖（組裝調整頁、檢視窗、GLB 編輯器）＋組裝調整頁直接調整區塊模型
async function testRefTools(browser, base) {
  console.log(
    '參考圖與正交視圖：A pose → 正視 → 參考圖校正 → 調整區塊模型 → 檢視窗／GLB 編輯器全身參考 → 匯出帶參考圖',
  );
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'ref-tools');
  page.on('dialog', (d) => d.accept());
  const SLOT = 'arms/a_std/r_fore';
  // 先給右前臂一個 GLB（範本）：組裝調整頁的「模型」只能調整有自己 GLB 的區塊
  await page.goto(base + 'model-library.html?test#' + SLOT);
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(1200);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
  const fp = path.join(SHOT_DIR, 'ref-fore.glb');
  await dl.saveAs(fp);
  await page.setInputFiles('#insFile', fp);
  await wait(1500);
  // 檢視窗：組合預覽 → A pose → 正視
  await page.click('#insModes [data-m="compose"]');
  await wait(2000);
  check(await visible(page, 'insRef'), '檢視窗的組合預覽顯示「視圖、姿勢與參考圖」');
  await page.click('#insRef [data-pose="a"]');
  await page.click('#insRef [data-v="front"]');
  await wait(1000);
  check(
    await page.evaluate(() => {
      const ins = document.getElementById('insRef');
      return !!ins && document.querySelector('#insRef [data-v="front"]').classList.contains('sel');
    }),
    '檢視窗切到正視（正交鏡頭）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'ref-inspect-front.png') });
  // 組裝調整頁
  await page.goto(base + 'model-library.html?test=ws#workshop');
  await page.waitForFunction(() => window.__workshop && window.__workshop.rig, null, { timeout: 15000 });
  await wait(800);
  await page.click('#wsRef [data-pose="a"]');
  await wait(400);
  const armZ = await page.evaluate(() =>
    Object.values(window.__workshop.rig.arms).map((a) => Math.round((a.up.rotation.z * 180) / Math.PI)),
  );
  check(
    armZ.every((z) => Math.abs(z) === 40),
    `A pose：手臂張開 40°（${armZ.join('、')}）`,
  );
  const img = path.join(SHOT_DIR, 'library.png');
  const [fc] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#wsRef [data-load="front"]'),
  ]);
  await fc.setFiles(img);
  await page.waitForSelector('#refCal:not([hidden])', { timeout: 10000 });
  await page.fill('#refCalH', '5');
  await page.click('#refCalOk');
  await wait(1200);
  const rs = await page.evaluate(() => {
    const w = window.__workshop;
    const g = w.ref.planes;
    return {
      cam: w.camera.type,
      planes: g ? g.children.length : 0,
      vis: g ? g.children.some((h) => h.visible) : false,
      h: w.ref.targetH(),
    };
  });
  check(
    rs.cam === 'OrthographicCamera' && rs.planes === 1 && rs.vis && rs.h === 5,
    `載入正面圖並校正（目標身高 ${rs.h} m）後切到正視、顯示參考圖`,
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'ref-workshop-front.png') });
  await page.click('#wsRef [data-v="persp"]');
  // 調整模型：選右前臂 → 模型 → 縮放 120% → 復原
  await page.evaluate((slot) => window.__workshop.edit.select({ slot }), SLOT);
  await page.click('#wsToolbar [data-edit="1"]');
  await wait(300);
  const scaleOf = () =>
    page.evaluate((slot) => {
      const s = new THREE.Vector3();
      window.__workshop.edit.originOf(slot).decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
      return Math.round(s.x * 1000) / 1000;
    }, SLOT);
  const s0 = await scaleOf();
  await page.fill('#wsDetail [data-mk="s"]', '120');
  await page.click('#wsDetail [data-act="mapply"]');
  await wait(800);
  const s1 = await scaleOf();
  check(Math.abs(s1 / s0 - 1.2) < 0.01, `組裝調整頁「模型」縮放 120% 寫回 GLB 的原點節點（×${s0} → ×${s1}）`);
  await page.click('#wsUndo');
  await wait(800);
  check(Math.abs((await scaleOf()) - s0) < 0.001, '復原模型縮放');
  await page.screenshot({ path: path.join(SHOT_DIR, 'ref-workshop-model.png') });
  // GLB 編輯器：全身參考
  await page.goto(base + 'model-library.html?test=ed#editor=' + SLOT);
  await page.waitForFunction(() => window.__glbEditor && window.__glbEditor.ctx.rig, null, {
    timeout: 15000,
  });
  await wait(800);
  const ed = await page.evaluate((slot) => {
    const e = window.__glbEditor;
    return {
      vis: e.ctx.group.visible,
      hidden: e.ctx.rig.pieces[slot] && !e.ctx.rig.pieces[slot].visible,
      n: Object.keys(e.ctx.rig.pieces).length,
    };
  }, SLOT);
  check(ed.vis && ed.hidden && ed.n > 10, `GLB 編輯器顯示整台機甲的其他區塊（${ed.n} 塊，編輯中的區塊隱藏）`);
  await page.click('#edRef [data-v="front"]');
  await wait(1000);
  check(
    await page.evaluate(() => window.__glbEditor.camera.type === 'OrthographicCamera'),
    'GLB 編輯器切到正視',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'ref-editor-front.png') });
  // 匯出模型組帶參考圖 → 匯入成新的模型組後參考圖還在
  await page.goto(base + 'model-library.html?test=set');
  await page.waitForSelector('.cell');
  await page.evaluate(() => (document.querySelector('#setMenu').open = true));
  const [d2] = await Promise.all([page.waitForEvent('download'), page.click('#setExport')]);
  const sp = path.join(SHOT_DIR, 'ref-set.rubicon-set');
  await d2.saveAs(sp);
  const buf = fs.readFileSync(sp);
  check(
    buf.includes('refs.json') && buf.includes('refs/front.png'),
    '匯出的模型組檔包含參考圖（refs.json、refs/front.png）',
  );
  await page.setInputFiles('#setImportFile', sp);
  await wait(1500);
  await page.goto(base + 'model-library.html?test=ws2#workshop');
  await page.waitForFunction(() => window.__workshop && window.__workshop.rig, null, { timeout: 15000 });
  await wait(800);
  check(
    await page.evaluate(() => {
      const w = window.__workshop;
      return w.store.cur !== 'default' && !!(w.ref.rec && w.ref.rec.views.front);
    }),
    '匯入的模型組帶回參考圖',
  );
  await ctx.close();
}

async function testMotion(browser, base) {
  console.log(
    '動作編輯：近戰招式的關鍵影格（武器的連段、新增關鍵影格、改關節、原始與彈簧、左手鏡像、新片段、存到瀏覽器、匯出、單人遊戲使用）',
  );
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'motion');
  page.on('dialog', (d) => d.accept());
  await page.goto(base + 'model-library.html?test#motion');
  await page.waitForFunction(() => window.__motion && window.__motion.rig, null, { timeout: 30000 });
  check(await page.evaluate(() => !document.getElementById('motion').hidden), '網址 #motion 開啟動作編輯頁');
  await page.selectOption('#moWpn', 'w_blade');
  await wait(800);
  check((await page.$$eval('#moStages .moStage', (a) => a.length)) === 3, '脈衝刀列出 3 段招式');
  const r = await page.evaluate(() => {
    const m = window.__motion;
    m.stage = 0;
    m.selectStage();
    const n0 = m.clip().keys.length;
    m.ph = 0.5;
    document.getElementById('moAddKey').click();
    const key = m.key();
    const inp = document.querySelector('#moJoints input[type="number"][data-j="upR"][data-n="0"]');
    inp.value = 120;
    inp.dispatchEvent(new Event('input'));
    return { n0, n: m.clip().keys.length, t: key.t, up: key.p.upR[0], custom: !!m.data.clips[m.clipId()] };
  });
  check(r.n === r.n0 + 1 && r.t === 0.5, `在目前時間新增關鍵影格（${r.n0} → ${r.n} 個）`);
  check(r.up === 120 && r.custom, '改關節的值：預設片段複製成覆寫');
  const raw = await page.evaluate(() => {
    const m = window.__motion;
    document.getElementById('moSpring').click();
    m.ph = 0.5;
    m.pose();
    return m.rig.arms.r.up.rotation.x;
  });
  check(Math.abs(raw - (120 * Math.PI) / 180) < 1e-3, '原始模式：右上臂照關鍵影格（120°）');
  const spr = await page.evaluate(() => {
    const m = window.__motion;
    document.getElementById('moSpring').click();
    m.ph = 0.5;
    m.simT = -1;
    m.pose();
    return m.rig.arms.r.up.rotation.x;
  });
  check(
    Math.abs(spr - raw) < 0.6 && Math.abs(spr - raw) > 1e-4,
    '彈簧模式：遊戲中的樣子（跟著片段、有慣性）',
  );
  const mir = await page.evaluate(async () => {
    const m = window.__motion;
    document.getElementById('moSpring').click();
    const lh = document.getElementById('moLeftHand');
    lh.click();
    await new Promise((res) => setTimeout(res, 1500));
    m.ph = 0.5;
    m.pose();
    const v = m.rig.arms.l.up.rotation.x;
    lh.click();
    document.getElementById('moSpring').click();
    await new Promise((res) => setTimeout(res, 1500));
    return v;
  });
  check(Math.abs(mir - (120 * Math.PI) / 180) < 1e-3, '左手武器：左右鏡像（左上臂 120°）');
  const nw = await page.evaluate(() => {
    const m = window.__motion;
    m.stage = 2;
    m.selectStage();
    document.getElementById('moName').value = '測試突刺';
    document.getElementById('moNew').click();
    return { id: m.clipId(), name: m.clip().name, map: m.data.map.w_blade };
  });
  check(nw.name === '測試突刺' && nw.map && nw.map[2] === nw.id, '複製成新片段並套用到第 3 段');
  await page.click('#moSave');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('rubicon_melee_anim') || 'null'));
  check(
    !!saved && saved.clips.slash && saved.clips.slash.keys.length === r.n && saved.clips[nw.id],
    '存到瀏覽器（rubicon_melee_anim）',
  );
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#moExport')]);
  const fp = path.join(SHOT_DIR, 'motion-melee.json');
  await dl.saveAs(fp);
  const ex = JSON.parse(fs.readFileSync(fp, 'utf8'));
  check(ex.v === 1 && !!ex.clips.slash && ex.map.w_blade[2] === nw.id, '匯出 melee.json');
  await page.evaluate(() => {
    const m = window.__motion;
    m.stage = 0;
    m.selectStage();
    m.ph = 0.5;
    m.pose();
    m.renderTime();
  });
  await wait(400);
  await page.screenshot({ path: path.join(SHOT_DIR, 'motion.png') });
  // 遊戲（同一個瀏覽器環境）：單人出擊時近戰用瀏覽器的版本（右上臂舉到 120° 附近）
  const g = await ctx.newPage();
  watch(g, 'motion-game');
  await g.goto(base + '?test');
  await waitVisible(g, 'title');
  await g.evaluate(async () => {
    const G = window.__game;
    await G.lmRefresh();
    G.save.level = 1;
    G.startMission();
  });
  await freezeLoop(g);
  const up = await g.evaluate(() => {
    const G = window.__game,
      pl = G.player;
    G.enemies.length = 0;
    G.waves = [];
    G.wavePend = null;
    pl.asm.rarm = 'w_blade';
    pl.swapModel();
    pl.initWeapons();
    window.__pump(0.5);
    pl.startMeleeStage('rarm', 0, pl.pos.clone().add(new THREE.Vector3(0, 2, -10)), null);
    window.__pump(pl.weapons.rarm.def.combo[0].dur * 0.5 + 0.02);
    return pl.model.arms.r.up.rotation.x;
  });
  check(up > 1.75, `單人遊戲的近戰用瀏覽器裡的動作（右上臂 ${((up * 180) / Math.PI).toFixed(0)}°）`);
  await ctx.close();
}

async function testLibraryGlb(browser, base) {
  console.log('模型庫 GLB：區塊範本匯出 → 載入 → 規格檢查 → 組合預覽 → 移除');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'library-glb');
  const badCount = () =>
    page.$$eval('#insChecks li', (ls) =>
      ls.filter((l) => /warn|error/.test(l.className)).map((l) => l.textContent),
    );
  const info = async () => (await page.textContent('#insInfo')) || '';
  const openSlot = async (id) => {
    await page.goto(base + 'model-library.html#' + id);
    await page.waitForSelector('#inspect:not([hidden])');
    await wait(1500);
  };
  const template = async (name) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
    const fp = path.join(WORK_DIR, name);
    await dl.saveAs(fp);
    return fp;
  };
  const load = async (fp) => {
    await page.setInputFiles('#insFile', fp);
    await wait(3000);
  };
  // 區塊：右前臂
  await openSlot('arms/a_std/r_fore');
  const fore = await template('a_std_r_fore_template.glb');
  check(fs.statSync(fore).size > 1000, `下載區塊範本 GLB（${Math.round(fs.statSync(fore).size / 1024)} KB）`);
  await load(fore);
  check((await info()).includes('GLB（瀏覽器暫存）'), '載入後來源顯示為 GLB');
  const bad = await badCount();
  check(bad.length === 0, `範本 GLB 規格檢查全部通過${bad.length ? '：' + bad.join('；') : ''}`);
  check((await info()).includes('手肘轉軸'), '檢視窗標示此區塊的原點（手肘轉軸）');
  const lb = await page.$$eval('#insLabels .lbl', (x) => x.map((e) => e.textContent));
  check(
    lb.includes('原點') && lb.includes('+Z 正面') && lb.includes('手腕'),
    '檢視窗顯示原點、三軸與連接點（手腕）',
  );
  await page.click('#insModes button[data-m="side"]');
  await wait(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'library-glb-side.png') });
  await page.click('#insModes button[data-m="compose"]');
  await wait(2500);
  check(
    await page.$eval('#insModes button[data-m="compose"]', (b) => b.classList.contains('sel')),
    '組合預覽可以開啟',
  );
  check((await info()).includes('1 個區塊用 GLB'), '組合預覽裝上此區塊的 GLB');
  await page.click('#insAnims button[data-a="walk"]');
  await wait(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'library-glb-compose.png') });
  // 武器：右手載入後，左手沒有自己的 GLB 時暫用右側
  await openSlot('weapon/w_rifle/r');
  const rifle = await template('w_rifle_r_template.glb');
  await load(rifle);
  const badW = await badCount();
  check(badW.length === 0, `武器範本 GLB 規格檢查全部通過${badW.length ? '：' + badW.join('；') : ''}`);
  // 載具區塊：直升機主旋翼（原點在旋翼軸心）
  await openSlot('vehicle/heli/rotor');
  const rotor = await template('heli_rotor_template.glb');
  await load(rotor);
  const badR = await badCount();
  check(badR.length === 0, `載具區塊範本 GLB 規格檢查全部通過${badR.length ? '：' + badR.join('；') : ''}`);
  check((await info()).includes('旋翼軸心'), '載具區塊標示原點（主旋翼軸心）');
  await openSlot('weapon/w_rifle/l');
  check((await info()).includes('暫用右側'), '左手武器沒有 GLB 時暫用右側');
  // 錯放：步槍放進頭部槽位應該報尺寸錯誤，移除後改回程式模型
  await openSlot('head/h_std');
  await load(rifle);
  const wrong = await page.$$eval('#insChecks li.error', (ls) => ls.map((l) => l.textContent));
  check(
    wrong.some((t) => t.includes('尺寸')),
    '錯放的 GLB 會報尺寸錯誤',
  );
  await page.click('#insRemove');
  await wait(1500);
  check((await info()).includes('程式模型'), '移除後改回程式模型');
  // 完整機甲：不接受整台 GLB，改用區塊組合
  await openSlot('mech/player');
  check(await page.$eval('#insLoad', (b) => b.disabled), '完整機甲不接受整台 GLB');
  check((await info()).includes('2 個區塊用 GLB'), '完整機甲以區塊組合顯示（含 2 個 GLB 區塊）');
  check((await info()).includes('最低點（遊戲中離地）貼地'), '完整機甲照遊戲擺放：原點貼地、腳底在地面上');
  await page.keyboard.press('Escape');
  await wait(3000);
  const badge = await page.$eval('.cell[data-id="mech/player"] .badge', (b) => b.textContent);
  check(/GLB 2/.test(badge), `格子標示區塊組合（${badge}）`);
  await ctx.close();
}

// 模型庫關節設定：修改連接點 → 瀏覽器保存 → 匯出 joints.json → 組合預覽 → 重設
// Draco 壓縮的 GLB（例如 glb-shrink 的輸出）：封鎖 CDN，確認解碼器從頁面旁的 lib/ 載入
async function makeDracoGlb(page) {
  const ex = path.join(ROOT, 'node_modules/three/examples/js');
  await page.addScriptTag({ path: path.join(ex, 'libs/draco/draco_encoder.js') });
  await page.addScriptTag({ path: path.join(ex, 'exporters/DRACOExporter.js') });
  return page.evaluate(() => {
    // 手的大小的方塊，只壓縮位置；再包成含 KHR_draco_mesh_compression 的 GLB
    const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
    geo.translate(0, -0.15, 0);
    const draco = new THREE.DRACOExporter().parse(new THREE.Mesh(geo), {
      exportNormals: false,
      exportUvs: false,
      exportColor: false,
    });
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const pad = (n) => (n + 3) & ~3;
    const json = {
      asset: { version: '2.0' },
      extensionsUsed: ['KHR_draco_mesh_compression'],
      extensionsRequired: ['KHR_draco_mesh_compression'],
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      materials: [{ name: 'acc' }],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              material: 0,
              extensions: { KHR_draco_mesh_compression: { bufferView: 0, attributes: { POSITION: 0 } } },
            },
          ],
        },
      ],
      accessors: [
        {
          componentType: 5126,
          count: geo.attributes.position.count,
          type: 'VEC3',
          min: bb.min.toArray(),
          max: bb.max.toArray(),
        },
      ],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: draco.byteLength }],
      buffers: [{ byteLength: pad(draco.byteLength) }],
    };
    let js = new TextEncoder().encode(JSON.stringify(json));
    const jl = pad(js.length),
      bl = pad(draco.byteLength);
    const out = new Uint8Array(12 + 8 + jl + 8 + bl);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, out.length, true);
    dv.setUint32(12, jl, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.fill(0x20, 20, 20 + jl);
    out.set(js, 20);
    dv.setUint32(20 + jl, bl, true);
    dv.setUint32(24 + jl, 0x004e4942, true);
    out.set(new Uint8Array(draco.buffer, draco.byteOffset, draco.byteLength), 28 + jl);
    return [...out];
  });
}
// url：模型庫的網址（伺服器或 file://）
async function testDraco(browser, url, tag) {
  console.log(`Draco 壓縮的 GLB（${tag}）：封鎖 CDN，解碼器從 lib/ 載入`);
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(CDN, (r) => r.abort());
  const page = await ctx.newPage();
  watch(page, 'draco-' + tag);
  await page.goto(url + '#arms/a_std/r_hand');
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(1200);
  const fp = path.join(SHOT_DIR, 'draco-hand.glb');
  fs.writeFileSync(fp, Buffer.from(await makeDracoGlb(page)));
  await page.setInputFiles('#insFile', fp);
  await wait(3000);
  const info = (await page.textContent('#insInfo')) || '';
  check(
    info.includes('GLB（瀏覽器暫存）') && !info.includes('解析失敗'),
    `模型庫讀得到 Draco 壓縮的 GLB（${(info.match(/來源[^遊]*/) || [''])[0]}）`,
  );
  check(info.includes('三角面12'), '解碼後的網格正確（12 個三角面）');
  await page.screenshot({ path: path.join(SHOT_DIR, `draco-${tag}.png`) });
  await ctx.close();
}

async function testLibraryJoints(browser, base) {
  console.log('模型庫關節設定：修改 → 保存 → 匯出 → 重設');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'library-joints');
  const elbowY = '.jrow[data-n="elbow"] input[data-k="p"][data-i="1"]';
  const open = async (id) => {
    await page.goto(base + 'model-library.html#' + id);
    await page.waitForSelector('#inspect:not([hidden])');
    await page.waitForSelector(elbowY);
    await wait(800);
  };
  await open('arms/a_std/r_upper');
  const def = await page.$eval(elbowY, (i) => i.value);
  check(def === '-0.59', `手肘預設位置 Y＝${def}（glTF 座標）`);
  await page.fill(elbowY, '-1.4');
  await wait(900);
  check(
    ((await page.textContent('.jrow[data-n="elbow"] .jsrc')) || '').includes('已修改'),
    '修改連接點後標示為瀏覽器暫存',
  );
  await page.click('.jrow[data-n="elbow"] [data-act="sel"]');
  await page.click('#insModes button[data-m="compose"]');
  await wait(2000);
  check((await page.$eval(elbowY, (i) => i.value)) === '-1.4', '組合預覽套用修改後的手肘位置');
  await page.screenshot({ path: path.join(SHOT_DIR, 'library-joints.png') });
  await open('arms/a_std/r_upper');
  check((await page.$eval(elbowY, (i) => i.value)) === '-1.4', '重新整理後修改仍保留');
  check(((await page.textContent('#count')) || '').includes('關節修改 1 個'), '上方顯示關節修改數量');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insJointsExport')]);
  const fp = path.join(SHOT_DIR, 'joints.json');
  await dl.saveAs(fp);
  const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const e = j['arms/a_std/r_upper'] && j['arms/a_std/r_upper'].elbow;
  check(!!e && e.p[1] === -1.4, `匯出的 joints.json 含修改（${JSON.stringify(e)}）`);
  await page.click('.jrow[data-n="elbow"] [data-act="reset"]');
  await wait(500);
  check((await page.$eval(elbowY, (i) => i.value)) === '-0.59', '重設後回到預設值');
  await ctx.close();
}

// 模型庫組裝調整：頁籤開啟 → 換零件 → 從現有機甲載入 → 預組儲存／載入／匯出／匯入 → 動作暫停與時間軸
async function testWorkshop(browser, base) {
  console.log('模型庫組裝調整：頁籤 → 零件 → 預組 → 動作時間軸');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'workshop');
  const tree = async () => (await page.textContent('#wsTree')) || '';
  await page.goto(base + 'model-library.html?test');
  await page.waitForSelector('.cell');
  await page.click('#tabs button[data-c="workshop"]');
  check(
    await page.waitForSelector('#workshop:not([hidden])', { timeout: 10000 }).then(
      () => true,
      () => false,
    ),
    '「組裝調整」頁籤開啟全螢幕頁面',
  );
  await page.waitForSelector('#wsTree .wsConn');
  await wait(1500);
  const t0 = await tree();
  check(
    t0.includes('手肘') && t0.includes('腰（核心座）') && t0.includes('左噴口'),
    '右側列出組裝層級與連接點',
  );
  check(((await page.textContent('#wsInfo')) || '').includes('連接點 21 個'), '玩家初始機有 21 個連接點');
  check(
    ((await page.textContent('#wsChecks')) || '').includes('沒有明顯的縫隙'),
    `玩家初始機沒有穿幫提示（${(await page.textContent('#wsChecks')) || ''}）`,
  );
  // 高度尺：刻度、目前身高（全是程式模型時等於標準身高）、顯示開關
  const ruler = async () => page.$$eval('#wsRuler .lbl', (l) => l.map((x) => x.textContent));
  let rl = await ruler();
  check(
    rl.some((t) => t === '1.0 m') && rl.some((t) => /^身高 [\d.]+ m（＝標準）$/.test(t)),
    `高度尺顯示刻度與身高（${rl.filter((t) => t.includes('身高')).join('、')}）`,
  );
  await page.click('#wsToolbar input[data-st="ruler"]');
  await wait(300);
  check(!(await visible(page, 'wsRuler')), '關閉高度尺');
  await page.click('#wsToolbar input[data-st="ruler"]');
  await wait(300);
  await page.selectOption('#wsParts select[data-k="arms"]', 'a_lt');
  await wait(1500);
  check((await tree()).includes('arms/a_lt/r_upper'), '換手臂零件後重新組裝');
  // 從現有機甲載入（四足）
  const quad = await page.$$eval('#wsFrom option', (os) =>
    os.map((o) => o.value).find((v) => v.includes('strider')),
  );
  await page.selectOption('#wsFrom', quad);
  await wait(2000);
  check(/legs\/l_qd\/body/.test(await tree()), `從現有機甲載入（${quad}）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'workshop.png') });
  // 預組
  await page.fill('#wsPresetName', '測試預組');
  await page.click('#wsSavePreset');
  await wait(500);
  await page.selectOption('#wsParts select[data-k="legs"]', 'l_bp');
  await wait(1500);
  await page.reload();
  await page.waitForSelector('#workshop:not([hidden])');
  await page.waitForSelector('#wsTree .wsConn');
  check(
    await page.$eval('#wsPresets', (s) => [...s.options].some((o) => o.value === '測試預組')),
    '重新整理後預組仍保留',
  );
  await page.selectOption('#wsPresets', '測試預組');
  await page.click('#wsLoadPreset');
  await wait(2000);
  check(/legs\/l_qd\/body/.test(await tree()), '載入預組還原零件');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#wsExport')]);
  const fp = path.join(SHOT_DIR, 'presets.json');
  await dl.saveAs(fp);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  check(
    data.presets.some((p) => p.name === '測試預組' && p.asm.legs === 'l_qd'),
    '匯出預組檔',
  );
  data.presets.push({ name: '匯入測試', asm: { ...data.presets[0].asm, head: 'h_hv', legs: '不存在' } });
  fs.writeFileSync(fp, JSON.stringify(data));
  await page.setInputFiles('#wsImportFile', fp);
  await wait(800);
  await page.selectOption('#wsPresets', '匯入測試');
  await page.click('#wsLoadPreset');
  await wait(2000);
  const tr = await tree();
  check(tr.includes('head/h_hv') && tr.includes('legs/l_bp/pelvis'), '匯入預組（不存在的零件改回預設）');
  // 動作：播放 → 暫停 → 拖曳時間軸
  await page.click('#wsAnims button[data-a="walk"]');
  await wait(800);
  await page.click('#wsPlay');
  await page.$eval('#wsTime', (r) => {
    r.value = '1.25';
    r.dispatchEvent(new Event('input'));
  });
  await wait(300);
  check((await page.textContent('#wsTimeText')) === '1.25 s', '暫停後可拖曳時間軸停在任一幀');
  // 選取與編輯：清單選連接點 → 輸入數值 → 重設；點畫面選區塊
  const elbow = '#wsTree .wsConn[data-slot="arms/a_std/r_upper"][data-n="elbow"]';
  await page.click(elbow);
  await wait(300);
  check(
    ((await page.textContent('#wsDetail')) || '').includes('所有使用「AR-011 MELANDER」手臂的機甲'),
    '選取連接點後顯示影響範圍',
  );
  await page.fill('#wsDetail input[data-k="p"][data-i="1"]', '-1.3');
  await wait(900);
  check(
    ((await page.textContent(elbow + ' .cv')) || '').includes('-1.300') &&
      (await page.$eval(elbow, (r) => r.classList.contains('mod'))),
    '輸入數值後連接點移動並標示已修改',
  );
  await wait(1000);
  const warn = (await page.textContent('#wsChecks')) || '';
  check(warn.includes('右前臂 ↔ 右上臂（含肩甲）（手肘）：縫隙'), '手肘移開後提示縫隙');
  for (const k of ['hide', 'check']) await page.click('#wsToolbar input[data-st="' + k + '"]');
  await wait(500);
  check(((await page.textContent('#wsChecks')) || '').includes('已關閉'), '穿幫提示可以關閉');
  await page.screenshot({ path: path.join(SHOT_DIR, 'workshop-hide.png') });
  for (const k of ['hide', 'check']) await page.click('#wsToolbar input[data-st="' + k + '"]');
  await page.screenshot({ path: path.join(SHOT_DIR, 'workshop-edit.png') });
  await page.click('#wsDetail [data-act="reset"]');
  await wait(500);
  check(((await page.textContent(elbow + ' .cv')) || '').includes('-0.590'), '重設後回到預設值');
  const gl = await page.$('#wsGl');
  const box = await gl.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.45);
  await wait(500);
  check(
    await page.$eval('#wsDetail', (d) => !!d.querySelector('.wsDh') && d.textContent.includes('接在')),
    '點畫面上的區塊即選取該區塊',
  );
  // 對稱編輯、復原／重做、方向鍵微調、複製到另一側、步進設定
  const lElbow = '#wsTree .wsConn[data-slot="arms/a_std/l_upper"][data-n="elbow"]';
  const cv = async (sel) => ((await page.textContent(sel + ' .cv')) || '').trim();
  const blur = () => page.click('#wsRight h3');
  await page.click(elbow);
  await page.check('#wsSym');
  await page.fill('#wsDetail input[data-k="p"][data-i="1"]', '-1.2');
  await wait(900);
  check(
    (await cv(elbow)).startsWith('0.000, -1.200') && (await cv(lElbow)).startsWith('0.000, -1.200'),
    `對稱編輯同時修改另一側（${await cv(lElbow)}）`,
  );
  await blur();
  await page.keyboard.press('Control+z');
  await wait(600);
  check(
    (await cv(elbow)).includes('-0.590') && (await cv(lElbow)).includes('-0.590'),
    'Ctrl+Z 復原（兩側一起）',
  );
  await page.keyboard.press('Control+y');
  await wait(600);
  check((await cv(lElbow)).includes('-1.200'), 'Ctrl+Y 重做');
  await page.keyboard.press('ArrowUp');
  await wait(400);
  await page.keyboard.press('Shift+ArrowUp');
  await wait(600);
  check((await cv(elbow)).includes('-1.090'), `方向鍵微調 1 cm＋Shift 10 cm（${await cv(elbow)}）`);
  await page.uncheck('#wsSym');
  await blur();
  await page.keyboard.press('ArrowRight');
  await wait(600);
  check(
    (await cv(elbow)).startsWith('0.010') && (await cv(lElbow)).startsWith('0.000'),
    '關閉對稱時只改這一側',
  );
  await page.click('#wsCopy');
  await wait(600);
  check((await cv(lElbow)).startsWith('-0.010, -1.090'), `複製到另一側（${await cv(lElbow)}）`);
  await page.click('.wsSteps summary');
  await page.fill('.wsSteps input[data-st="move"]', '5');
  await page.press('.wsSteps input[data-st="move"]', 'Enter');
  await blur();
  await page.keyboard.press('ArrowDown');
  await wait(600);
  check((await cv(elbow)).includes('-1.140'), '步進可以自己改（5 cm）');
  // 以核心為根：清單從核心開始；選襠部拖曳＝整組腿相對核心移動（拖曳中核心不動，放開後改的是腰的連接點）
  check(await page.$eval('#wsTree .wsNode', (n) => n.dataset.slot.startsWith('core/')), '組裝層級以核心為根');
  await page.click('#wsAnims button[data-a="rest"]'); // 拉直靜止姿勢：核心沒有俯仰，位移等於腰的反向
  await page.click('#wsTree .wsNode[data-slot="legs/l_bp/pelvis"]');
  await wait(300);
  check(((await page.textContent('#wsDetail')) || '').includes('以核心為準'), '選襠部時說明以核心為準');
  const WAIST = '#wsTree .wsConn[data-slot="legs/l_bp/pelvis"][data-n="waist"]';
  const w0 = await cv(WAIST);
  const gap = await page.evaluate(() => {
    const e = window.__workshop.edit;
    const m = e.mark({ slot: 'legs/l_bp/pelvis', name: 'waist' });
    window.__workshop.rig.group.updateMatrixWorld(true);
    const p = new THREE.Vector3().setFromMatrixPosition(e.proxy.matrixWorld);
    return p.distanceTo(new THREE.Vector3().setFromMatrixPosition(m.node.matrixWorld));
  });
  check(gap < 0.01, `選襠部時三軸標示在腰的連接點上（距離 ${gap.toFixed(3)}）`);
  const held = await page.evaluate(() => {
    const e = window.__workshop.edit;
    const rig = window.__workshop.rig;
    rig.group.updateMatrixWorld(true);
    const at = () => new THREE.Vector3().setFromMatrixPosition(rig.torso.matrixWorld);
    const c0 = at();
    e.dragging = true;
    e.anchor = rig.torso.matrixWorld.clone();
    e.proxy.position.y += 0.1; // 腿往上 10 cm
    e.fromProxy();
    const c1 = at();
    e.dragging = false;
    e.anchor = null;
    e.commitDrag();
    return c0.distanceTo(c1);
  });
  await wait(800);
  const w1 = await cv(WAIST);
  check(
    held < 1e-4 && Math.abs(parseFloat(w1.split(',')[1]) - parseFloat(w0.split(',')[1]) + 0.1) < 2e-3,
    `拖曳襠部時核心不動，放開後腰的連接點下移 10 cm（${w0} → ${w1}）`,
  );
  await page.click('#wsRight h3');
  await page.keyboard.press('Control+z');
  await wait(600);
  check((await cv(WAIST)) === w0, '復原襠部的拖曳');
  await page.click('#wsBack');
  check(await page.isHidden('#workshop'), '回模型庫');
  await ctx.close();
}

// GLB 編輯器：檢視窗開啟 → 載入範本 → 旋轉／縮放 → 對齊程式模型 → 原點 → 復原 → 節點刪除 → 存到槽位 → 鏡像存到另一側 → 還原原始檔
async function testEditor(browser, base) {
  console.log('模型庫 GLB 編輯：載入 → 朝向／尺寸／原點 → 存檔 → 鏡像');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'editor');
  const stats = async () => ((await page.textContent('#edStats')) || '').replace(/\s+/g, ' ');
  const bad = () =>
    page.$$eval('#edChecks li', (ls) =>
      ls.filter((l) => /warn|error/.test(l.className)).map((l) => l.textContent),
    );
  await page.goto(base + 'model-library.html?test#arms/a_std/r_fore');
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(1500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
  const fp = path.join(SHOT_DIR, 'editor-fore.glb');
  await dl.saveAs(fp);
  await page.click('#insEdit');
  check(
    await page.waitForSelector('#editor:not([hidden])', { timeout: 10000 }).then(
      () => true,
      () => false,
    ),
    '檢視窗的「在 GLB 編輯器開啟」開啟編輯頁',
  );
  check((await page.$eval('#edSlot', (s) => s.value)) === 'arms/a_std/r_fore', '編輯頁帶入目前的槽位');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  check((await stats()).includes('100%／100%／100%'), '載入範本：尺寸與程式模型相同');
  // 讀旋轉前的尺寸（前臂的程式模型改過造型，不寫死數字）
  const dims0 = (await stats()).match(/([\d.]+) × ([\d.]+) × ([\d.]+)/) || [];
  await page.click('#edRot button[data-ax="y"][data-deg="90"]');
  await wait(300);
  check(
    dims0.length === 4 && (await stats()).includes(`${dims0[3]} × ${dims0[2]} × ${dims0[1]}`),
    `Y +90° 旋轉後寬深對調（${await stats()}）`,
  );
  await page.click('#edRot button[data-ax="y"][data-deg="-90"]');
  await page.fill('#edScaleK', '3');
  await page.click('#edScaleGo');
  await wait(600);
  check((await stats()).includes('300%／300%／300%'), '等比放大 3 倍');
  check(
    (await bad()).some((t) => t.includes('尺寸')),
    '放大後規格檢查提示尺寸不符',
  );
  await page.click('#edFit');
  await wait(600);
  check((await stats()).includes('100%／100%／100%'), '對齊程式模型（外框整體符合）');
  check((await bad()).length === 0, `對齊後規格檢查全部通過${(await bad()).join('；')}`);
  await page.click('#edOrigin button[data-o="bottom"]');
  await wait(400);
  check((await stats()).includes('Y0.00 ～ 0.91'), `原點設在底面中心（${await stats()}）`);
  await page.keyboard.press('Control+z');
  await wait(400);
  check((await stats()).includes('Y-0.66 ～ 0.25'), `Ctrl+Z 復原原點修改（${await stats()}）`);
  const tris = async () => parseInt(((await page.textContent('#edTris')) || '').replace(/,/g, ''), 10);
  const t0 = await tris();
  await page.click('#edTree .edNode:last-child [data-act="del"]');
  await wait(400);
  const t1 = await tris();
  check(t1 < t0, `刪除節點後三角面減少（${t0} → ${t1}）`);
  await page.keyboard.press('Control+z');
  await wait(400);
  check((await tris()) === t0, '復原刪除');
  // 組合：加入另一個 GLB 成新節點 → 移動 → 復原；合併節點
  const blur = () => page.click('#edLeft h3');
  await page.setInputFiles('#edAddFile', fp);
  await wait(1200);
  check((await tris()) === t0 * 2, `加入 GLB 成新節點（三角面 ${await tris()}）`);
  await page.fill('#edDetail input[data-k="p"][data-i="0"]', '1');
  await page.press('#edDetail input[data-k="p"][data-i="0"]', 'Tab');
  await wait(500);
  check(
    /尺寸（寬×高×深） ?1\.\d\d/.test(await stats()),
    `移動加入的節點後外框變寬（${(await stats()).slice(0, 30)}）`,
  );
  await blur();
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await wait(500);
  check((await tris()) === t0, '復原加入的節點');
  await page.keyboard.press('Control+y');
  await page.keyboard.press('Control+y');
  await wait(500);
  const nodes = () => page.$$eval('#edTree .edNode', (r) => r.length);
  const n0 = await nodes();
  await page.click('#edTree .edNode[data-i="0"]');
  await page.click('#edMergeNode');
  await wait(800);
  check(
    (await tris()) === t0 * 2 && (await nodes()) < n0,
    `合併成一個節點（節點 ${n0} → ${await nodes()}，三角面不變）`,
  );
  await blur();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await wait(600);
  check((await tris()) === t0, '復原合併與加入');
  // 拖曳原點：顯示程式模型原點 → 把手往下拖 → 放開套用 → 復原
  check((await visibleLabels(page)).includes('程式模型原點：手肘轉軸'), '顯示程式模型的原點位置（手肘轉軸）');
  const yRange = async () => ((await stats()).match(/外框範圍 Y ?(-?[\d.]+)/) || [])[1];
  const y0 = await yRange();
  await page.click('#edOriginDrag');
  await wait(300);
  await dragFrom(page, await screenOf(page, 'ed.oh'), 0, 80);
  const y1 = await yRange();
  check(y1 !== y0, `拖曳原點後放開套用（外框底部 ${y0} → ${y1} m）`);
  await page.keyboard.press('Escape');
  await blur();
  await page.keyboard.press('Control+z');
  await wait(400);
  check((await yRange()) === y0, '復原拖曳原點');
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor.png') });
  const toastHas = (txt) =>
    page
      .waitForFunction(
        (t) => [...document.querySelectorAll('.toast')].some((x) => x.textContent.includes(t)),
        txt,
        {
          timeout: 10000,
        },
      )
      .then(
        () => true,
        () => false,
      );
  await page.click('#edSave');
  const savedR = await toastHas('右前臂');
  await page.click('#edSaveMirror');
  check(savedR && (await toastHas('左前臂')), '存到槽位並鏡像存到另一側');
  // 鏡像的左前臂：在檢視窗規格檢查全部通過
  await page.goto(base + 'model-library.html#arms/a_std/l_fore');
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(2000);
  const insInfo = (await page.textContent('#insInfo')) || '';
  const insBad = await page.$$eval('#insChecks li', (ls) =>
    ls.filter((l) => /warn|error/.test(l.className)).map((l) => l.textContent),
  );
  check(
    insInfo.includes('（編輯）') && insBad.length === 0,
    `鏡像的左前臂載入檢視窗、規格檢查通過${insBad.join('；')}`,
  );
  // 存過的槽位保留原始檔：重新開啟編輯器 → 載入槽位的 GLB → 還原原始檔
  await reopen(page, base + 'model-library.html#editor=arms/a_std/r_fore');
  await page.waitForSelector('#editor:not([hidden])');
  await wait(1500);
  check(
    ((await page.textContent('#edSrc')) || '').includes('瀏覽器暫存'),
    '網址 #editor=槽位 開啟並載入槽位的 GLB',
  );
  check(!(await page.$eval('#edRevert', (b) => b.disabled)), '存過的槽位可以還原原始檔');
  page.once('dialog', (d) => d.accept());
  await page.click('#edRevert');
  await wait(1200);
  check(((await page.textContent('#edSrc')) || '').includes('原始檔'), '還原原始檔');
  await page.click('#edBack');
  check(await page.isHidden('#editor'), '回模型庫');
  await ctx.close();
}

// GLB 編輯的拆分：整台機甲範本（展示姿勢）→ 只勾選左手臂與左腿 → 姿勢對照 → 範圍框裁切（框外移除）→ 調小範圍框重拆
// → 平面切割補面 → 框選排除與復原 → 只存勾選的區塊
async function testEditorSplit(browser, base) {
  console.log('模型庫 GLB 編輯：拆分整台機甲 → 勾選區塊 → 範圍框裁切 → 切割補面 → 框選 → 存檔');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'editor-split');
  page.on('dialog', (d) => d.accept());
  const pieces = async () => ((await page.textContent('#edPieces')) || '').replace(/\s+/g, ' ');
  const count = async (name) => {
    const t = await page.textContent(`.edPc:has-text("${name}")`);
    return parseInt((t.match(/([\d,]+)\s*$/) || ['', '0'])[1].replace(/,/g, ''), 10);
  };
  const lastToast = async () => (await page.$$eval('.toast', (t) => t.map((x) => x.textContent))).pop() || '';
  await page.goto(base + 'model-library.html#mech/player');
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(1500);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
  const fp = path.join(SHOT_DIR, 'editor-mech.glb');
  await dl.saveAs(fp);
  await reopen(page, base + 'model-library.html?test#editor');
  await page.waitForSelector('#editor:not([hidden])');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  const mats = async () => ((await page.textContent('#edMats')) || '').match(/共 (\d+) 個材質/)[1];
  const m0 = +(await mats());
  await page.click('#edMergeMats');
  await wait(800);
  const m1 = +(await mats());
  check(m1 < m0, `合併相同的材質（${m0} → ${m1}）`);
  await page.click('#edSplitOn');
  await wait(800);
  check(
    (await pieces()).includes('右前臂') && (await pieces()).includes('左腳掌'),
    '拆分模式列出零件組合的所有區塊',
  );
  await page.click('#edPieces [data-all="0"]');
  const picked = ['左上臂', '左前臂', '左手', '左大腿', '左小腿'];
  for (const n of picked) await page.click(`.edPc:has-text("${n}") input`);
  // 範本是展示姿勢：手肘彎曲約 69°、上臂前舉約 20°
  await page.$eval('input[data-q="elbow"]', (r) => {
    r.value = '69';
    r.dispatchEvent(new Event('input'));
  });
  await page.click('.edPc:has-text("左上臂") .nm');
  await page.fill('#edPose input[data-k="0"]', '20');
  await page.press('#edPose input[data-k="0"]', 'Enter');
  await wait(300);
  check(
    ((await page.textContent('#edBoxEdit')) || '').includes('左上臂（含肩甲）的範圍框'),
    '選取區塊顯示它的範圍框尺寸',
  );
  // 拖曳範圍框底面的控制點：只有高度與位移改變；復原
  const boxVals = () => page.$$eval('#edBoxEdit input', (i) => i.map((x) => +x.value));
  const bv0 = await boxVals();
  await dragFrom(
    page,
    await screenOf(page, 'ed.split.hg.children.find((h) => h.userData.h.k === 1 && h.userData.h.sgn < 0)'),
    0,
    50,
  );
  const bv1 = await boxVals();
  check(
    bv1[1] > bv0[1] && bv1[0] === bv0[0] && bv1[2] === bv0[2],
    `拖曳控制點拉長範圍框（高 ${bv0[1]} → ${bv1[1]} m）`,
  );
  await page.click('#edSplitRight h3');
  await page.keyboard.press('Control+z');
  await wait(300);
  check((await boxVals()).join() === bv0.join(), '復原範圍框的拖曳');
  // 點範圍框選取區塊
  await page.click('.edPc:has-text("左手") .nm');
  // 點框的上半部（框中央可能被移動 GLB 的箭頭擋住）
  const fc = await screenOf(
    page,
    '(() => { const v = ed.split.list.find((x) => x.slot === "arms/a_std/l_upper").vis; const o = new THREE.Object3D(); o.position.set(0, 0.35, 0); v.add(o); v.updateMatrixWorld(true); return o; })()',
  );
  await page.mouse.click(fc[0], fc[1]);
  await wait(300);
  check(((await page.textContent('#edBoxEdit')) || '').includes('左上臂'), '點畫面上的範圍框即選取該區塊');
  check((await visibleLabels(page)).includes('手肘'), '顯示選中區塊的關節位置（手肘）');
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-split-boxes.png') });
  // 拖曳關節點（左膝）：小腿的範圍框不動；復原；再拖一次留到存檔
  const KNEE = 'ed.split.jointMarks.find((j) => j.key === "legs/l_bp/l_thigh|knee").mk';
  const shinBox = () =>
    page.evaluate(() => {
      const v = window.__glbEditor.split.list.find((x) => x.slot === 'legs/l_bp/l_shin').vis;
      return v.getWorldPosition(new THREE.Vector3()).toArray();
    });
  const sb0 = await shinBox();
  await dragFrom(page, await screenOf(page, KNEE), 0, -25);
  const sb1 = await shinBox();
  const jinfo = async () => ((await page.textContent('#edJointInfo')) || '').trim();
  check(
    (await jinfo()).includes('已移動') && sb0.every((v, k) => Math.abs(v - sb1[k]) < 1e-4),
    `拖曳關節點：小腿的範圍框不動（${await jinfo()}）`,
  );
  await page.click('#edSplitRight h3');
  await page.keyboard.press('Control+z');
  await wait(300);
  check((await jinfo()) === '', '復原關節點的拖曳');
  await dragFrom(page, await screenOf(page, KNEE), 0, -25);
  await page.click('#edSpStart');
  await wait(2500);
  const t1 = await lastToast();
  check(/框外 [\d,]+ 面已移除/.test(t1), `範圍框裁切：框外的模型移除（${t1}）`);
  check(
    !!(await page.$('#edSplitRight .edWarn')) ||
      ((await page.textContent('#edSplitRight')) || '').includes('長度與程式模型相近'),
    '拆分後顯示長度偏差檢查',
  );
  const p1 = await pieces();
  check(!p1.includes('右前臂') && !p1.includes('頭'), '拆分後只列出勾選的區塊');
  const hand1 = await count('左手');
  check((await count('左前臂')) > 0 && hand1 > 0, `勾選的區塊都拆出模型（左手 ${hand1} 面）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-split.png') });
  // 調小左手的範圍框後重拆：左手的面變少
  await page.click('#edSpBack');
  await wait(500);
  await page.click('.edPc:has-text("左手") .nm');
  for (const i of [0, 1, 2]) {
    await page.fill(`#edBoxEdit input[data-k="s"][data-i="${i}"]`, '0.1');
    await page.press(`#edBoxEdit input[data-k="s"][data-i="${i}"]`, 'Tab');
  }
  await page.click('#edSpStart');
  await wait(2500);
  const hand2 = await count('左手');
  check(hand2 < hand1, `範圍框可以調整（左手 ${hand1} → ${hand2} 面）`);
  // 平面切割：左大腿 → 左小腿（膝）
  const knee = await page.$$eval('#edCutConn option', (os) =>
    os.map((o) => [o.value, o.textContent]).find((o) => o[1].includes('左大腿') && o[1].includes('膝')),
  );
  await page.selectOption('#edCutConn', knee[0]);
  await page.click('#edCutPlace');
  await wait(300);
  await page.click('#edCutGo');
  await wait(1500);
  const t2 = await lastToast();
  check(/切開 [\d,]+ 個三角形，補面 [\d,]+/.test(t2) || t2.includes('範圍內沒有'), `平面切割（${t2}）`);
  // 框選改成排除 → 復原
  await page.check('#edSpDrop');
  await page.click('#edSpBox');
  const gl = await page.$('#edGl');
  const bb = await gl.boundingBox();
  await page.mouse.move(bb.x + 5, bb.y + 60);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width - 5, bb.y + bb.height - 5, { steps: 4 });
  await page.mouse.up();
  await wait(800);
  check(!(await pieces()).includes('排除 0'), `框選排除三角形（${(await pieces()).slice(-30)}）`);
  await page.click('#edSpBox');
  await page.uncheck('#edSpDrop');
  await page.click('#edSpUndo');
  await wait(800);
  check((await pieces()).includes('排除 0'), '復原框選');
  check(!(await page.isChecked('#edSpOpt')), '存檔時減面預設不勾選（選用）');
  await page.click('#edSpSave');
  const saving = await page
    .waitForFunction(
      () => (document.getElementById('edSpSaving').textContent || '').includes('存檔中'),
      null,
      {
        timeout: 5000,
      },
    )
    .then(
      () => true,
      () => false,
    );
  check(saving && (await page.isDisabled('#edSpSave')), '存檔中顯示進度並停用存檔按鈕');
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('已存 5 個區塊')),
      null,
      { timeout: 30000 },
    )
    .catch(() => {});
  check(
    await page.evaluate(() => {
      const j = window.__glbEditor.store.joints;
      return !!(j['legs/l_bp/l_thigh'] && j['legs/l_bp/l_thigh'].knee && j['legs/l_bp/l_shin'].ankle);
    }),
    '拖曳過的關節點存進關節設定（膝與小腿的腳踝）',
  );
  await reopen(page, base + 'model-library.html#mech/player');
  await page.waitForSelector('#inspect:not([hidden])');
  const n5 = await page
    .waitForFunction(
      () => (document.getElementById('insInfo').textContent || '').includes('5 個區塊用 GLB'),
      null,
      { timeout: 20000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(n5, '只存勾選的 5 個區塊，其他區塊維持程式模型');
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-split-mech.png') });
  await testWorkshopKeep(page, base);
  await ctx.close();
}

// 組裝調整的「只動關節」（用拆分存下的 GLB 區塊）：移動手肘時前臂不動、原點寫回 GLB、重建後一致、復原；腿部自動貼地與離地微調
async function testWorkshopKeep(page, base) {
  await page.goto(base + 'model-library.html?test');
  await page.waitForSelector('.cell');
  await page.click('#tabs button[data-c="workshop"]');
  await page.waitForSelector('#wsTree .wsConn');
  await wait(2000);
  const ELBOW = '#wsTree .wsConn[data-slot="arms/a_std/l_upper"][data-n="elbow"]';
  const foreAt = () =>
    page.evaluate(() =>
      new THREE.Box3()
        .setFromObject(window.__workshop.rig.pieces['arms/a_std/l_fore'])
        .getCenter(new THREE.Vector3())
        .toArray(),
    );
  const near = (a, b, tol = 0.005) => a.every((v, k) => Math.abs(v - b[k]) < tol);
  const hasOrigin = () =>
    page.evaluate(() => {
      const src = window.__workshop.store.source('arms/a_std/l_fore');
      const len = new DataView(src.buf).getUint32(12, true);
      return new TextDecoder().decode(new Uint8Array(src.buf, 20, len)).includes('rubicon_origin');
    });
  await page.click(ELBOW);
  await wait(300);
  check(((await page.textContent('#wsDetail')) || '').includes('只動關節'), '關節點預設「只動關節」');
  const f0 = await foreAt();
  const y0 = +(await page.inputValue('#wsDetail input[data-k="p"][data-i="1"]'));
  await page.fill('#wsDetail input[data-k="p"][data-i="1"]', String(+(y0 + 0.1).toFixed(3)));
  await wait(1200);
  const f1 = await foreAt();
  check(
    near(f0, f1) && (await hasOrigin()),
    `移動手肘時前臂不動，原點寫回前臂的 GLB（${f0.map((v) => v.toFixed(3))} → ${f1.map((v) => v.toFixed(3))}）`,
  );
  check(
    await page.evaluate(() => !!(window.__workshop.store.joints['arms/a_std/l_fore'] || {}).wrist),
    '前臂自己的手腕連接點一起調整',
  );
  await page.evaluate(() => window.__workshop.rebuild(false));
  await wait(1500);
  check(near(f0, await foreAt()), '重新組裝後前臂仍在原位（GLB 原點與連接點一致）');
  await page.click('#wsRight h3');
  await page.keyboard.press('Control+z');
  await wait(1200);
  check(
    near(f0, await foreAt()) &&
      (await page.evaluate(() => !(window.__workshop.store.joints['arms/a_std/l_fore'] || {}).wrist)),
    '復原只動關節（連接點與原點一起還原）',
  );
  // 腿部有 GLB：自動貼地；離地微調
  await page.click('#wsTree .wsNode[data-slot="legs/l_bp/pelvis"]');
  await wait(300);
  check(((await page.textContent('#wsDetail')) || '').includes('自動貼地'), '腿部根區塊顯示自動貼地');
  const lift0 = await page.evaluate(() => window.__workshop.rig.lift.position.y);
  await page.fill('#wsGroundFine', '5');
  await page.press('#wsGroundFine', 'Enter');
  await wait(600);
  const lift1 = await page.evaluate(() => window.__workshop.rig.lift.position.y);
  check(
    Math.abs(lift1 - lift0 - 0.05) < 1e-3,
    `離地微調 5 cm（${lift0.toFixed(3)} → ${lift1.toFixed(3)} m）`,
  );
  await page.click('#wsDetail [data-act="greset"]');
  await wait(600);
  check(
    Math.abs((await page.evaluate(() => window.__workshop.rig.lift.position.y)) - lift0) < 1e-3,
    '重設離地微調',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'workshop-keep.png') });
}

// GLB 編輯的材質：AI 風格模型（一個材質、一張多色貼圖）→ 依顏色分群 → 套用色槽 → 框選改色槽 → 復原 → 存檔
async function testEditorMaterials(browser, base) {
  console.log('模型庫 GLB 編輯：材質（分群、框選色槽、灰階貼圖、存檔）');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'editor-mat');
  await page.goto(base + 'model-library.html#editor');
  await page.waitForSelector('#editor:not([hidden])');
  const bytes = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const cols = [
      [200, 60, 50],
      [70, 160, 80],
      [60, 90, 190],
      [128, 128, 128],
    ];
    for (let q = 0; q < 4; q++)
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const k = 0.8 + 0.2 * Math.sin(x * 0.7 + y * 0.3);
          g.fillStyle = `rgb(${(cols[q][0] * k) | 0},${(cols[q][1] * k) | 0},${(cols[q][2] * k) | 0})`;
          g.fillRect((q % 2) * 32 + x, Math.floor(q / 2) * 32 + y, 1, 1);
        }
    const tex = new THREE.CanvasTexture(c);
    tex.flipY = false;
    const geo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
    const uv = geo.attributes.uv;
    for (let f = 0; f < 6; f++) {
      const q = f < 2 ? 0 : f < 4 ? 1 : 2;
      for (let i = f * 4; i < f * 4 + 4; i++)
        uv.setXY(
          i,
          (q % 2) * 0.5 + uv.getX(i) * 0.45 + 0.02,
          Math.floor(q / 2) * 0.5 + uv.getY(i) * 0.45 + 0.02,
        );
    }
    geo.translate(0, 0.25, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, name: 'Material_0' }));
    const res = await new Promise((r) => new THREE.GLTFExporter().parse(mesh, r, { binary: true }));
    return [...new Uint8Array(res)];
  });
  const fp = path.join(SHOT_DIR, 'editor-ai.glb');
  fs.writeFileSync(fp, Buffer.from(bytes));
  await page.selectOption('#edSlot', 'head/h_std');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  const tinted = async () =>
    (await page.$$eval('#edChecks li', (l) => l.map((x) => x.textContent))).find((t) =>
      t.includes('換色的材質'),
    ) || '';
  const matCount = async () => ((await page.textContent('#edMats')) || '').match(/共 (\d+) 個材質/)[1];
  check((await matCount()) === '1', 'AI 風格模型：一個材質');
  await page.fill('#edClusterK', '3');
  await page.click('#edCluster');
  await wait(800);
  check((await page.$$('#edClusters .edCl')).length === 3, '依顏色分成 3 群');
  await page.click('#edClApply');
  await wait(800);
  const t1 = await tinted();
  check(
    t1.includes('main') && t1.includes('sub') && t1.includes('main2'),
    `套用分群：三群各成一個色槽材質（${t1}）`,
  );
  await page.selectOption('#edPreview', 'player');
  await page.selectOption('#edMatSlot', 'acc');
  await page.click('#edMatBox');
  const bb = await (await page.$('#edGl')).boundingBox();
  await page.mouse.move(bb.x + 5, bb.y + 60);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width - 5, bb.y + bb.height - 5, { steps: 4 });
  await page.mouse.up();
  await wait(600);
  check((await tinted()).includes('acc'), '框選的三角形改成強調色（acc）');
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-mat.png') });
  await page.click('#edMatBox');
  await page.click('#edLeft h3');
  await page.keyboard.press('Control+z');
  await wait(600);
  check(!(await tinted()).includes('acc') && (await matCount()) === '3', '復原框選');
  await page.click('#edSave');
  // 等存檔真的寫完（整套測試一起跑時，烘焙＋寫入 IndexedDB 可能超過 1.5 秒）再重新開啟
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('已存到')),
      null,
      {
        timeout: 20000,
      },
    )
    .catch(() => {});
  await wait(300);
  await reopen(page, base + 'model-library.html#head/h_std');
  await page.waitForSelector('#inspect:not([hidden])');
  // 規格檢查要等 GLB 讀完才出現（電腦慢時超過 2 秒）
  await page
    .waitForFunction(
      () => [...document.querySelectorAll('#insChecks li')].some((x) => x.textContent.includes('換色的材質')),
      null,
      { timeout: 30000 }, // 整套測試一起跑時電腦很忙，讀 GLB 可能超過 15 秒
    )
    .catch(() => {});
  const ins = (await page.$$eval('#insChecks li', (l) => l.map((x) => x.textContent))).find((t) =>
    t.includes('換色的材質'),
  );
  check(!!ins && ins.includes('main') && ins.includes('main2'), `存檔後檢視窗：依配色換色（${ins}）`);
  await ctx.close();
}

// GLB 編輯的貼圖：列出、下載（目前／原檔／UV／zip）、替換（共用／只換這個材質／單一通道）、復原、灰階換原圖、加入貼圖、存檔讀回
async function testEditorTextures(browser, base) {
  console.log('模型庫 GLB 編輯：貼圖（匯出、UV、zip、替換、通道、加入）');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'editor-tex');
  await page.goto(base + 'model-library.html?test#editor');
  await page.waitForSelector('#editor:not([hidden])');
  // 兩個材質共用一張顏色貼圖（Material_0 另有粗糙度／金屬感貼圖），第三個材質沒有貼圖
  const bytes = await page.evaluate(async () => {
    const tex = (w, draw) => {
      const c = document.createElement('canvas');
      c.width = c.height = w;
      draw(c.getContext('2d'));
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;
      return t;
    };
    const col = tex(64, (g) => {
      ['#c83c32', '#46a050', '#3c5abe', '#808080'].forEach((f, q) => {
        g.fillStyle = f;
        g.fillRect((q % 2) * 32, Math.floor(q / 2) * 32, 32, 32);
      });
    });
    const orm = tex(32, (g) => {
      g.fillStyle = 'rgb(255,128,64)';
      g.fillRect(0, 0, 32, 32);
    });
    const root = new THREE.Group();
    const mk = (mat, x) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
      m.position.set(x, 0.15, 0);
      root.add(m);
    };
    mk(
      new THREE.MeshStandardMaterial({ name: 'Material_0', map: col, roughnessMap: orm, metalnessMap: orm }),
      -0.4,
    );
    mk(new THREE.MeshStandardMaterial({ name: 'Material_1', map: col }), 0);
    mk(new THREE.MeshStandardMaterial({ name: 'plain', color: 0xff0000 }), 0.4);
    const res = await new Promise((r) => new THREE.GLTFExporter().parse(root, r, { binary: true }));
    return [...new Uint8Array(res)];
  });
  const fp = path.join(SHOT_DIR, 'editor-tex.glb');
  fs.writeFileSync(fp, Buffer.from(bytes));
  const png = async (name, w, h, fill) => {
    const b64 = await page.evaluate(
      ([w, h, fill]) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = fill;
        g.fillRect(0, 0, w, h);
        return c.toDataURL('image/png').split(',')[1];
      },
      [w, h, fill],
    );
    const f = path.join(SHOT_DIR, name);
    fs.writeFileSync(f, Buffer.from(b64, 'base64'));
    return f;
  };
  const red = await png('tex-red.png', 32, 32, '#ff0000');
  const blue = await png('tex-blue.png', 32, 32, '#2040ff');
  const gray = await png('tex-gray.png', 16, 16, 'rgb(200,200,200)');
  await page.selectOption('#edSlot', 'head/h_std');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  const info = () =>
    page.evaluate(() =>
      window.__glbEditor.mat.list().map(({ m }) => ({
        name: m.name,
        map: m.map ? m.map.image.width : 0,
        rm: m.roughnessMap ? m.roughnessMap.image.width : 0,
        same: m.roughnessMap === m.metalnessMap,
        ao: !!m.aoMap,
        color: m.color.getHexString(),
      })),
    );
  const of = async (name) => (await info()).find((x) => x.name === name) || {};
  // 某個材質的貼圖在 (2, 2) 的像素
  const pixel = (name, key) =>
    page.evaluate(
      ([name, key]) => {
        const m = window.__glbEditor.mat
          .list()
          .map((e) => e.m)
          .find((x) => x.name === name);
        const img = m[key].image;
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return [...g.getImageData(2, 2, 1, 1).data];
      },
      [name, key],
    );
  const matEl = async (name) => {
    for (const e of await page.$$('#edMats .edMat'))
      if (((await e.$eval('.nm', (x) => x.textContent)) || '').startsWith(name)) return e;
    return null;
  };
  const openMat = async (name) => {
    const e = await matEl(name);
    if (!(await e.evaluate((x) => x.open))) await (await e.$('summary')).click();
    return matEl(name);
  };
  const rowSel = async (name, i) => (await (await matEl(name)).$$('.edTex select[data-ta="rep"]'))[i];
  const choose = async (sel, value, file) => {
    await sel.selectOption(value);
    await page.setInputFiles('#edTexFile', file);
    await wait(800);
  };
  const undo = async () => {
    await page.click('#edLeft h3');
    await page.keyboard.press('Control+z');
    await wait(600);
  };
  const dl = async (fn) => {
    const [d] = await Promise.all([page.waitForEvent('download'), fn()]);
    return { name: d.suggestedFilename(), buf: fs.readFileSync(await d.path()) };
  };
  const isPng = (b) => b.slice(0, 4).toString('hex') === '89504e47';

  const m0 = await openMat('Material_0');
  const rows = await m0.$$('.edTex');
  const txt = await m0.textContent();
  check(rows.length === 2, `材質的貼圖列：顏色＋粗糙度／金屬感（${rows.length} 列）`);
  check(txt.includes('2 個材質共用') && txt.includes('粗糙度／金屬感'), '顯示共用與種類');
  const cur = await dl(() => rows[0].$eval('[data-ta="dl"]', (b) => b.click()));
  check(isPng(cur.buf) && /_color\.png$/.test(cur.name), `下載目前的貼圖（${cur.name}）`);
  const orig = await dl(() => rows[0].$eval('[data-ta="orig"]', (b) => b.click()));
  check(orig.buf.length > 0 && /\.(png|jpg|webp)$/.test(orig.name), `下載原始檔（${orig.name}）`);
  const uv = await dl(() => rows[0].$eval('[data-ta="uv"]', (b) => b.click()));
  check(isPng(uv.buf) && /_uv\.png$/.test(uv.name), `下載 UV 線框（${uv.name}）`);
  const zip = await dl(() => page.click('#edTexZip'));
  const zs = zip.buf.toString('utf8');
  check(
    zip.buf.slice(0, 2).toString() === 'PK' &&
      zs.includes('貼圖/') &&
      zs.includes('原始檔/') &&
      zs.includes('UV/') &&
      /\.zip$/.test(zip.name),
    `下載全部貼圖 zip（${zip.name}，${zip.buf.length} bytes）`,
  );

  // 換圖：共用的兩個材質一起換 → 復原 → 只換這個材質
  await choose(await rowSel('Material_0', 0), 'all', red);
  check(
    (await of('Material_0')).map === 32 && (await of('Material_1')).map === 32,
    '替換貼圖：共用的材質一起換',
  );
  const px = await pixel('Material_1', 'map');
  check(px[0] > 240 && px[1] < 20, `換上的圖片內容正確（${px.slice(0, 3)}）`);
  await undo();
  check((await of('Material_0')).map === 64 && (await of('Material_1')).map === 64, '復原替換');
  await page.selectOption('#edTexScope', 'mat');
  await choose(await rowSel('Material_0', 0), 'all', red);
  check(
    (await of('Material_0')).map === 32 && (await of('Material_1')).map === 64,
    '只換這個材質：另一個材質維持原圖',
  );
  // 只換粗糙度（G 通道），金屬感（B）保留
  await choose(await rowSel('Material_0', 1), 'g', gray);
  const orm = await pixel('Material_0', 'roughnessMap');
  const o0 = await of('Material_0');
  check(
    Math.abs(orm[1] - 200) <= 2 && Math.abs(orm[2] - 64) <= 2 && o0.rm === 32 && o0.same,
    `只換粗糙度通道（G=${orm[1]}、B=${orm[2]}，尺寸 ${o0.rm}）`,
  );

  // 色槽材質（灰階）：換原圖後灰階圖重算
  await page.selectOption('#edTexScope', 'tex');
  const m1 = await openMat('Material_1');
  await (await m1.$('select[data-act="slot"]')).selectOption('main');
  await wait(800);
  const mainEl = await openMat('main');
  check(((await mainEl.textContent()) || '').includes('灰階（由原圖產生）'), '色槽材質：灰階貼圖列');
  await choose((await mainEl.$$('.edTex select[data-ta="rep"]'))[0], 'src', blue);
  const g1 = await pixel('main', 'map');
  check(
    g1[0] === g1[1] && g1[1] === g1[2] && (await of('main')).map === 32,
    `換原圖：灰階圖依新圖重算（${g1.slice(0, 3)}）`,
  );

  // 沒有貼圖的材質：加入顏色與 AO 貼圖
  const plain = await openMat('plain');
  await choose(await plain.$('select[data-ta="add"]'), 'map', blue);
  await choose(await (await matEl('plain')).$('select[data-ta="add"]'), 'aoMap', gray);
  const p1 = await of('plain');
  const uv2 = await page.evaluate(() =>
    window.__glbEditor.mat.meshes().some((o) => o.material.name === 'plain' && !!o.geometry.attributes.uv2),
  );
  check(
    p1.map === 32 && p1.color === 'ffffff' && p1.ao && uv2,
    '加入顏色（材質顏色改白）與 AO 貼圖（補 uv2）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-tex.png') });

  // 存到槽位後讀回：換過的貼圖、加入的貼圖都在
  await page.click('#edSave');
  await wait(1500);
  await page.click('#edFromSlot');
  await wait(1500);
  const back = await info();
  const b0 = back.find((x) => x.name === 'Material_0') || {};
  const bp = back.find((x) => x.name === 'plain') || {};
  check(b0.map === 32 && b0.rm === 32 && bp.map === 32 && bp.ao, '存檔後讀回：替換與加入的貼圖都保留');
  await ctx.close();
}

// GLB 編輯的刪除多邊形：矩形（只選看得到的 vs 穿透）、刪除與復原、套索、筆刷與擦除、點選相連、對稱、小碎塊、反選、擴展到相連、存檔讀回、拆分模式停用
async function testEditorFaces(browser, base) {
  console.log('模型庫 GLB 編輯：刪除多邊形（矩形、套索、筆刷、相連、對稱、小碎塊）');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'editor-del');
  await page.goto(base + 'model-library.html?test#editor');
  await page.waitForSelector('#editor:not([hidden])');
  const bytes = await page.evaluate(async () => {
    const root = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ name: 'main' });
    const add = (name, geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.position.set(x, y, z);
      root.add(m);
    };
    add('body', new THREE.BoxGeometry(0.4, 0.6, 0.3, 6, 8, 4), 0, 0.35, 0);
    add('base', new THREE.BoxGeometry(1, 0.05, 1, 6, 1, 6), 0, 0.025, 0);
    add('junk', new THREE.BoxGeometry(0.05, 0.05, 0.05), 0.45, 1.0, 0);
    add('earL', new THREE.BoxGeometry(0.06, 0.1, 0.06), -0.27, 0.6, 0);
    add('earR', new THREE.BoxGeometry(0.06, 0.1, 0.06), 0.27, 0.6, 0);
    const res = await new Promise((r) => new THREE.GLTFExporter().parse(root, r, { binary: true }));
    return [...new Uint8Array(res)];
  });
  const fp = path.join(SHOT_DIR, 'editor-del.glb');
  fs.writeFileSync(fp, Buffer.from(bytes));
  await page.selectOption('#edSlot', 'head/h_std');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  const stat = () =>
    page.evaluate(() => {
      const ed = window.__glbEditor;
      const ms = ed.mat.meshes();
      const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
      const by = {};
      for (const o of ms) by[o.name] = tri(o.geometry);
      return {
        tris: ms.reduce((n, o) => n + tri(o.geometry), 0),
        verts: ms.reduce((n, o) => n + o.geometry.attributes.position.count, 0),
        sel: ed.faces.count(),
        by,
      };
    });
  // 節點的區域座標 → 畫面座標
  const at = (name, local = [0, 0, 0]) =>
    page.evaluate(
      ([name, local]) => {
        const ed = window.__glbEditor;
        const o = ed.content.getObjectByName(name);
        ed.scene.updateMatrixWorld(true);
        const v = o.localToWorld(new THREE.Vector3(...local)).project(ed.camera);
        const r = ed.canvas.getBoundingClientRect();
        return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
      },
      [name, local],
    );
  const drag = async (pts, mod) => {
    if (mod) await page.keyboard.down(mod);
    await page.mouse.move(...pts[0]);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(...p, { steps: 3 });
    await page.mouse.up();
    if (mod) await page.keyboard.up(mod);
    await wait(400);
  };
  const shape = async (s) => page.click(`#edFaceShape button[data-s="${s}"]`);
  const esc = async () => {
    await page.click('#edFaceClear');
    await wait(200);
  };
  const s0 = await stat();
  await page.click('#edFaceOn');
  check(await visible(page, 'edFacePanel'), '進入選取多邊形模式');
  // 矩形框住整個 body：只選看得到的 < 穿透
  const corners = [];
  for (const x of [-0.2, 0.2])
    for (const y of [-0.3, 0.3]) for (const z of [-0.15, 0.15]) corners.push(await at('body', [x, y, z]));
  const xs = corners.map((c) => c[0]),
    ys = corners.map((c) => c[1]);
  const rect = [
    [Math.min(...xs) - 4, Math.min(...ys) - 4],
    [Math.max(...xs) + 4, Math.max(...ys) + 4],
  ];
  await shape('rect');
  await drag(rect);
  const vis = (await stat()).sel;
  await page.selectOption('#edFaceDepth', 'all');
  await drag(rect);
  const all = (await stat()).sel;
  check(vis > 0 && vis < all && all >= s0.by.body, `矩形：只選看得到的 ${vis} 面 < 穿透 ${all} 面`);
  await page.selectOption('#edFaceDepth', 'visible');
  await drag(rect);
  await page.click('#edLeft h3');
  await page.keyboard.press('Delete');
  await wait(500);
  const s1 = await stat();
  check(
    s1.tris === s0.tris - vis && s1.verts < s0.verts && s1.sel === 0,
    `刪除選取的面（${s0.tris} → ${s1.tris} 面，頂點 ${s0.verts} → ${s1.verts}）`,
  );
  await page.keyboard.press('Control+z');
  await wait(500);
  check((await stat()).tris === s0.tris, '復原刪除');
  // 套索：body 中心周圍的八邊形
  const c = await at('body');
  await shape('lasso');
  const oct = [...Array(8)].map((_, i) => [
    c[0] + 40 * Math.cos((i * Math.PI) / 4),
    c[1] + 40 * Math.sin((i * Math.PI) / 4),
  ]);
  await drag([...oct, oct[0]]);
  const lasso = (await stat()).sel;
  check(lasso > 0 && lasso < vis, `套索選取（${lasso} 面）`);
  // 筆刷：刷過 body 中心，按住 Ctrl 再刷一次擦除
  await esc();
  await shape('brush');
  const line = [
    [c[0] - 50, c[1]],
    [c[0] + 50, c[1]],
  ];
  await drag(line);
  const b1 = (await stat()).sel;
  await page.fill('#edBrushR', '12');
  await drag(line, 'Control');
  const b2 = (await stat()).sel;
  check(b1 > 0 && b2 < b1, `筆刷選取 ${b1} 面，Ctrl 擦除後 ${b2} 面`);
  // 點選相連：底座整塊
  await esc();
  await shape('pick');
  await page.mouse.click(...(await at('base', [0.45, 0.025, 0.45])));
  await wait(400);
  check((await stat()).sel === s0.by.base, `點選相連：整個底座（${(await stat()).sel} / ${s0.by.base} 面）`);
  // 對稱：點左耳，右耳一起選
  await esc();
  await page.check('#edFaceSym');
  await page.mouse.click(...(await at('earL')));
  await wait(400);
  check((await stat()).sel === s0.by.earL + s0.by.earR, `對稱選取：左右耳（${(await stat()).sel} 面）`);
  // 對稱＋矩形穿透框住左耳：右耳的三角形依鏡像一起選（不經過相連擴展）
  const ec = [];
  for (const x of [-0.03, 0.03])
    for (const y of [-0.05, 0.05]) for (const z of [-0.03, 0.03]) ec.push(await at('earL', [x, y, z]));
  await page.click('#edFaceClear');
  await shape('rect');
  await page.selectOption('#edFaceDepth', 'all');
  await drag([
    [Math.min(...ec.map((q) => q[0])) - 2, Math.min(...ec.map((q) => q[1])) - 2],
    [Math.max(...ec.map((q) => q[0])) + 2, Math.max(...ec.map((q) => q[1])) + 2],
  ]);
  const symR = await page.evaluate(() =>
    Object.fromEntries(
      [...window.__glbEditor.faces.sel].map(([o, s]) => [o.name, s.f.reduce((x, y) => x + y, 0)]),
    ),
  );
  check(
    symR.earL === s0.by.earL && symR.earR === s0.by.earR,
    `對稱＋矩形：左耳 ${symR.earL}、右耳 ${symR.earR} 面`,
  );
  await page.selectOption('#edFaceDepth', 'visible');
  await page.uncheck('#edFaceSym');
  // 小碎塊：少於 20 面（漂浮的小方塊、兩個耳朵）
  await page.fill('#edFaceSmallN', '20');
  await page.fill('#edFaceSmallA', '0');
  await page.click('#edFaceSmall');
  await wait(400);
  const small = (await stat()).sel;
  check(small === s0.by.junk + s0.by.earL + s0.by.earR, `選取小碎塊（${small} 面）`);
  await page.click('#edFaceInv');
  check((await stat()).sel === s0.tris - small, '反選');
  // 擴展到相連：筆刷點一下底座角落 → 整個底座
  await esc();
  await shape('brush');
  const corner = await at('base', [0.45, 0.025, 0.45]);
  await drag([corner, [corner[0] + 3, corner[1]]]);
  const dab = (await stat()).sel;
  await page.click('#edFaceGrow');
  check(
    dab > 0 && dab < s0.by.base && (await stat()).sel === s0.by.base,
    `擴展到相連（${dab} → ${(await stat()).sel} 面）`,
  );
  // 整個網格刪掉：小方塊
  await esc();
  await shape('pick');
  await page.mouse.click(...(await at('junk')));
  await wait(300);
  await page.click('#edFaceDel');
  await wait(500);
  const s2 = await stat();
  check(s2.tris === s0.tris - s0.by.junk && !('junk' in s2.by), '刪除整個網格（當成刪除節點）');
  await page.screenshot({ path: path.join(SHOT_DIR, 'editor-del.png') });
  await page.click('#edSave');
  await wait(1500);
  await page.click('#edFromSlot');
  await wait(1500);
  check((await stat()).tris === s2.tris, `存檔後讀回（${(await stat()).tris} 面）`);
  // 拆分模式中停用
  await page.click('#edFaceOn');
  await page.click('#edSplitOn');
  await wait(500);
  check(
    (await page.$eval('#edFaceOn', (b) => b.disabled)) && !(await visible(page, 'edFacePanel')),
    '拆分模式中停用刪除多邊形',
  );
  await ctx.close();
}

// GLB 編輯的最佳化與輸出：高面數模型（不透明＋半透明貼圖）→ 減到預算 → 復原 → 重做 → WebP／PNG＋Draco 下載與存檔 → 檢視窗讀取
async function testEditorOptimize(browser, base) {
  console.log('模型庫 GLB 編輯：最佳化（減面、WebP／PNG、Draco）');
  if (!fs.existsSync(LIBRARY)) return;
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'editor-opt');
  await page.goto(base + 'model-library.html#editor');
  await page.waitForSelector('#editor:not([hidden])');
  const bytes = await page.evaluate(async () => {
    const mk = (alpha) => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      for (let i = 0; i < 64; i++) {
        g.fillStyle = `hsla(${i * 37},70%,50%,${alpha ? 0.5 : 1})`;
        g.fillRect((i % 8) * 64, Math.floor(i / 8) * 64, 64, 64);
      }
      const t = new THREE.CanvasTexture(c);
      t.flipY = false;
      return t;
    };
    const root = new THREE.Group();
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 160, 80),
      new THREE.MeshStandardMaterial({ map: mk(false), name: 'body' }),
    );
    sphere.position.y = 0.4;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshStandardMaterial({ map: mk(true), transparent: true, name: 'glass' }),
    );
    box.position.y = 0.9;
    root.add(sphere, box);
    const res = await new Promise((r) => new THREE.GLTFExporter().parse(root, r, { binary: true }));
    return [...new Uint8Array(res)];
  });
  const fp = path.join(SHOT_DIR, 'editor-hi.glb');
  fs.writeFileSync(fp, Buffer.from(bytes));
  await page.selectOption('#edSlot', 'head/h_std');
  await page.setInputFiles('#edFile', fp);
  await wait(1500);
  const tris = async () => parseInt(((await page.textContent('#edTris')) || '').replace(/,/g, ''), 10);
  const t0 = await tris();
  await page.click('#edOptBudget');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('減面：')),
  );
  const t1 = await tris();
  check(t0 > 20000 && t1 <= 4000 && t1 > 2000, `減到預算（${t0} → ${t1} 面，預算 4000）`);
  await page.click('#edLeft h3');
  await page.keyboard.press('Control+z');
  await wait(400);
  check((await tris()) === t0, '復原減面');
  await page.keyboard.press('Control+y');
  await wait(400);
  await page.check('#edWebp');
  await page.check('#edDraco');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click('#edDownload'),
  ]);
  const out = path.join(SHOT_DIR, 'editor-opt.glb');
  await dl.saveAs(out);
  const buf = fs.readFileSync(out);
  const json = JSON.parse(buf.slice(20, 20 + buf.readUInt32LE(12)).toString());
  // 依材質找圖片（節點順序隨載入時機而變，不能假設圖片的順序）
  const mimeOf = (name) => {
    const m = json.materials.find((x) => x.name === name);
    const t = json.textures[m.pbrMetallicRoughness.baseColorTexture.index];
    const src =
      t.extensions && t.extensions.EXT_texture_webp ? t.extensions.EXT_texture_webp.source : t.source;
    return json.images[src].mimeType;
  };
  check(
    mimeOf('body') === 'image/webp' &&
      mimeOf('glass') === 'image/png' &&
      (json.extensionsUsed || []).includes('KHR_draco_mesh_compression'),
    `輸出：不透明貼圖 WebP、半透明 PNG、Draco 壓縮（${Math.round(bytes.length / 1024)} KB → ${Math.round(buf.length / 1024)} KB；${json.images.map((i) => i.mimeType).join()}；${(json.extensionsUsed || []).join()}）`,
  );
  await page.click('#edSave');
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('已存到')),
  );
  await reopen(page, base + 'model-library.html#head/h_std');
  const opened = await page.waitForSelector('#inspect:not([hidden])').then(
    () => true,
    () => false,
  );
  if (!opened) {
    await page.screenshot({ path: path.join(SHOT_DIR, 'editor-opt-fail.png') });
    console.log(
      '    頁面狀態：' +
        JSON.stringify(
          await page.evaluate(() => ({
            url: location.href,
            cells: document.querySelectorAll('.cell').length,
            notice: !!document.getElementById('dbNotice'),
            cur: (document.getElementById('setCur') || {}).textContent,
            count: document.getElementById('count').textContent,
          })),
        ),
    );
  }
  check(opened, '存檔後重新整理，網址直接開啟檢視窗');
  await wait(2500);
  const info = (await page.textContent('#insInfo')) || '';
  check(
    info.includes('GLB（瀏覽器暫存）') && info.includes('貼圖2 張') && !info.includes('解析失敗'),
    '檢視窗讀取 WebP＋Draco 的 GLB',
  );
  // 把設定改回預設，避免影響其他測試（設定存在 localStorage）
  await page.evaluate(() => localStorage.removeItem('rubicon_glb_export'));
  await ctx.close();
}

// 駕駛員：舊存檔遷移、配點、T2 鎖定、車庫顯示加成、預設組
const editSave = (page, fn) =>
  page.evaluate((src) => {
    const s = JSON.parse(
      localStorage.getItem('rubicon_save_' + (localStorage.getItem('rubicon_save_cur') || 1)),
    );
    new Function('s', src)(s);
    localStorage.setItem(
      'rubicon_save_' + (localStorage.getItem('rubicon_save_cur') || 1),
      JSON.stringify(s),
    );
  }, fn);
// 本地模型庫：在模型庫頁面（已開啟過，資料庫是第 4 版）直接寫入 IndexedDB（GLB 與關節設定）；
// 機甲區塊與武器寫進模型組 set（預設 default），其他分類寫成共用；遊戲單人模式讀取並套用
async function injectLibrary(page, glbs, joints, set = 'default') {
  await page.evaluate(
    ({ glbs, joints, set }) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('rubicon-model-library');
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const d = r.result;
          const t = d.transaction(['models', 'setJoints'], 'readwrite');
          const scoped = (id) => /^(head|core|arms|legs|booster|weapon|back)\//.test(id);
          for (const g of glbs) {
            const buf = new Uint8Array(g.bytes).buffer;
            t.objectStore('models').put({
              set: scoped(g.id) ? set : '',
              id: g.id,
              name: g.name,
              size: buf.byteLength,
              buf,
              t: g.t || Date.now(),
            });
          }
          for (const [slot, conns] of Object.entries(joints || {}))
            t.objectStore('setJoints').put({ set, slot, conns });
          t.oncomplete = () => {
            d.close();
            res();
          };
          t.onerror = () => rej(t.error);
        };
      }),
    { glbs, joints, set },
  );
}
const lmOverlay = (page) =>
  page.evaluate(() => {
    const el = document.getElementById('lmLoad');
    return el && el.classList.contains('on') ? el.textContent.replace(/s+/g, ' ').trim() : '';
  });

async function testLocalModels(browser, base) {
  console.log('本地模型庫：模型庫的瀏覽器暫存 → 遊戲單人模式讀取');
  const fore = path.join(WORK_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(WORK_DIR, 'w_rifle_r_template.glb');
  if (!fs.existsSync(fore) || !fs.existsSync(rifle)) return check(false, '找不到模型庫測試產生的範本 GLB');
  const { ctx, page } = await newPage(browser, 'local-models');
  await page.goto(base);
  check(await waitVisible(page, 'title'), '標題畫面顯示');
  await page.click('#btnLmReload');
  // 結果在讀完伺服器預設組之後才出現（不是固定時間），等到它出現
  await page
    .waitForFunction(() => /沒有開啟/.test(document.getElementById('lmLoad').textContent), null, {
      timeout: 15000,
    })
    .catch(() => {});
  check((await lmOverlay(page)).includes('沒有開啟'), '總開關沒開時，重新載入提示到設定開啟');
  await page.click('#lmLoad');
  // 在模型庫頁面寫入：右前臂、步槍（右）、壞檔（頭），以及右上臂的手肘連接點
  const lib = await ctx.newPage();
  watch(lib, 'local-models-lib');
  await lib.goto(base + 'model-library.html');
  await wait(1500);
  // 明顯的測試方塊（材質 acc 依配色換色）：裝在左手
  const cube = await lib.evaluate(
    () =>
      new Promise((res) => {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.7, 0.7),
          new THREE.MeshStandardMaterial({ name: 'acc', color: 0xffffff }),
        );
        m.position.y = -0.2;
        new THREE.GLTFExporter().parse(m, (b) => res([...new Uint8Array(b)]), { binary: true });
      }),
  );
  // 地圖物件：和代表尺寸一樣大的方塊（原點在底面中心、材質 main 換成物件顏色），遊戲依隨機尺寸縮放
  const sizedBox = (w, h, d) =>
    lib.evaluate(
      ([w, h, d]) =>
        new Promise((res) => {
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshStandardMaterial({ name: 'main', color: 0xff00ff }),
          );
          m.position.y = h / 2;
          new THREE.GLTFExporter().parse(m, (b) => res([...new Uint8Array(b)]), { binary: true });
        }),
      [w, h, d],
    );
  await injectLibrary(
    lib,
    [
      { id: 'prop/container', name: 'container.glb', bytes: await sizedBox(7.5, 2.8, 2.9) },
      { id: 'prop/debris', name: 'debris.glb', bytes: await sizedBox(0.75, 0.35, 0.75) },
      { id: 'prop/lamp_post', name: 'lamp.glb', bytes: await sizedBox(1, 7, 1) },
      { id: 'prop/grid_pillar', name: 'grid.glb', bytes: await sizedBox(5, 13, 5) }, // 方格主題只有高柱
      { id: 'prop/road', name: 'road.glb', bytes: cube },
      { id: 'arms/a_std/r_fore', name: 'fore.glb', bytes: [...fs.readFileSync(fore)] },
      { id: 'weapon/w_rifle/r', name: 'rifle.glb', bytes: [...fs.readFileSync(rifle)] },
      { id: 'head/h_std', name: 'broken.glb', bytes: [1, 2, 3, 4, 5, 6, 7, 8] },
      { id: 'arms/a_std/l_hand', name: 'cube.glb', bytes: cube },
      // 載具區塊、列車車廂、掉落物、彈體、轟炸機；整台戰車的舊槽位不會用到（列為失敗）
      { id: 'vehicle/tank/turret', name: 'turret.glb', bytes: cube },
      { id: 'vehicle/transport_train/car', name: 'car.glb', bytes: cube },
      { id: 'small/pickup_repair', name: 'pickup.glb', bytes: cube },
      { id: 'small/proj_bullet', name: 'bullet.glb', bytes: cube },
      { id: 'vehicle/bomber', name: 'bomber.glb', bytes: cube },
      { id: 'vehicle/tank', name: 'old-tank.glb', bytes: cube },
    ],
    { 'arms/a_std/r_upper': { elbow: { p: [0, -0.9, 0.05], r: [0, 0, 0] } } },
  );
  // 模型庫：完整載具／列車以區塊組合預覽
  for (const id of ['vehicle/tank', 'vehicle/transport_train']) {
    await reopen(lib, base + 'model-library.html#' + id);
    await lib.waitForSelector('#inspect:not([hidden])');
    await wait(1800);
    const t = (await lib.textContent('#insInfo')) || '';
    check(t.includes('1 個區塊用 GLB'), `模型庫：${id} 以區塊組合預覽（GLB 1 塊）`);
    await lib.screenshot({ path: path.join(SHOT_DIR, `local-models-${id.split('/')[1]}.png`) });
  }
  await lib.close();
  // 設定畫面：開啟總開關 → 讀取
  await page.click('#btnSettings');
  check(await waitVisible(page, 'settings'), '設定畫面顯示');
  check(!(await page.isChecked('#lmOn')), '本地模型庫預設關閉');
  await page.check('#lmOn');
  await wait(2500);
  const box = (await page.textContent('#lmBox')) || '';
  check(
    box.includes('套用 GLB 12 個') && box.includes('失敗 3 個'),
    `讀取結果：${(box.match(/狀態：([^重]*)/) || ['', ''])[1]}`,
  );
  check(box.includes('關節設定 1 個'), '讀到模型庫的關節設定');
  check(box.includes('head/h_std'), '列出載入失敗的槽位');
  check(box.includes('由各區塊組成'), '整台載具的舊槽位提示改放到各區塊');
  await page.screenshot({ path: path.join(SHOT_DIR, 'local-models-settings.png') });
  // 分類開關：關掉武器後只剩 1 個
  await page.uncheck('#lmBox [data-g="weapon"]');
  await wait(800);
  check(
    ((await page.textContent('#lmBox')) || '').includes('套用 GLB 11 個'),
    '關閉武器分類後不套用武器 GLB',
  );
  await page.check('#lmBox [data-g="weapon"]');
  await wait(800);
  await page.click('#btnSettingsBack');
  await waitVisible(page, 'title');
  // 標題畫面的重新載入：顯示進度與結果
  await page.click('#btnLmReload');
  await wait(400);
  const ov = await lmOverlay(page);
  check(ov.includes('套用 GLB 12 個'), `重新載入本地模型顯示結果（${ov.slice(0, 60)}）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'local-models-reload.png') });
  await page.click('#lmLoad');
  // 車庫與出擊
  await newCareer(page);
  check(await waitVisible(page, 'garage'), '車庫畫面顯示');
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'local-models-garage.png') });
  const note = (await page.textContent('#gLocal')) || '';
  check(note.includes('3 個區塊使用 GLB'), `車庫的機甲換上本地 GLB（${note.trim()}）`);
  await page.selectOption('#gMapSel', 'industrial'); // 有貨櫃、路燈、碎塊的舊主題
  await page.click('#btnSortie');
  check(await waitVisible(page, 'hudWrap', 15000), '出擊後 HUD 顯示');
  await playFor(page, 3000);
  await page.keyboard.press('Digit1'); // 空襲：轟炸機
  await playFor(page, 2500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'local-models-solo.png') });
  await page.keyboard.press('Escape');
  await wait(400);
  // 暫停 → 設定：確認遊戲中真的用到了 GLB
  await page.click('#btnSettingsP');
  await waitVisible(page, 'settings');
  await page.click('.lmUsed summary');
  const used = async (id) =>
    page.$eval(
      `.lmUsed [data-slot="${id}"]`,
      (e) => +((e.textContent.match(/已使用 (\d+) 次/) || [])[1] || 0),
    );
  const nb = await used('small/proj_bullet');
  check(nb > 0, `子彈換成 GLB（${nb} 發）`);
  const nf = await used('arms/a_std/r_fore');
  check(nf > 0, `機甲區塊換成 GLB（右前臂 ${nf} 次）`);
  const nm = await used('vehicle/bomber');
  check(nm > 0, `空襲轟炸機換成 GLB（${nm} 次）`);
  // 戰區指定貨運集散場：有碎塊、路燈桿、貨櫃
  const props = {};
  for (const id of ['debris', 'lamp_post', 'container', 'grid_pillar']) props[id] = await used('prop/' + id);
  check(
    Object.values(props).some((n) => n > 0),
    `地圖物件換成 GLB（${Object.entries(props)
      .map(([k, n]) => k + ' ' + n)
      .join('、')}）`,
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'local-models-used.png') });
  await page.click('#btnSettingsBack');
  await wait(400);
  await page.click('#btnAbort');
  check(await waitVisible(page, 'result'), '放棄任務後回到結果畫面');
  await page.click('#btnResultOk');
  check(await waitVisible(page, 'garage'), '回到車庫');
  // 多人：同一個瀏覽器（設定相同），進房間後車庫改回程式模型
  const mp = await ctx.newPage();
  watch(mp, 'local-models-mp');
  await mp.goto(base + '?lan=local');
  await mp.click('#btnMP');
  await setNick(mp, 'LOCAL');
  await mp.click('#btnMPHost');
  check(await waitVisible(mp, 'lobby'), '多人：房主進入大廳');
  await mp.click('#btnLobbyGarage');
  check(await waitVisible(mp, 'garage'), '多人：大廳進車庫');
  await wait(1200);
  const mpNote = (await visible(mp, 'gLocal')) ? (await mp.textContent('#gLocal')) || '' : '';
  check(!mpNote.includes('本地'), `多人時不套用本地模型（${mpNote || '程式模型'}）`); // 內建的玩家預設機甲照常顯示
  await ctx.close();
}

// 模型組：舊版資料庫（第 3 版）遷移成「預設」、新增／切換／複製／改名／刪除、匯出匯入、組裝調整記住零件組合、遊戲選模型組
async function testModelSets(browser, base) {
  console.log('模型組：遷移、切換、複製、匯出匯入、遊戲選模型組');
  const fore = path.join(WORK_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(WORK_DIR, 'w_rifle_r_template.glb');
  if (!fs.existsSync(fore) || !fs.existsSync(rifle)) return check(false, '找不到模型庫測試產生的範本 GLB');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'model-sets');
  page.on('dialog', (d) => d.accept());
  // 遊戲頁讀取資料庫時不會建立它；在同來源寫入第 3 版（glb／joints）的舊資料，連線保持開著（模擬舊版模型庫分頁）
  const old = await ctx.newPage();
  watch(old, 'model-sets-old');
  await old.goto(base);
  await waitVisible(old, 'title');
  await old.evaluate(
    ({ fore, rifle }) =>
      new Promise((res, rej) => {
        const r = indexedDB.open('rubicon-model-library', 3);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('glb', { keyPath: 'id' });
          d.createObjectStore('joints', { keyPath: 'slot' });
          d.createObjectStore('presets', { keyPath: 'name' });
        };
        r.onerror = () => rej(r.error);
        r.onsuccess = () => {
          const d = r.result;
          const t = d.transaction(['glb', 'joints'], 'readwrite');
          const put = (id, bytes) => {
            const buf = new Uint8Array(bytes).buffer;
            t.objectStore('glb').put({
              id,
              name: id.split('/').pop() + '.glb',
              size: buf.byteLength,
              buf,
              t: 1,
            });
          };
          put('arms/a_std/r_fore', fore);
          put('prop/debris', rifle);
          t.objectStore('joints').put({
            slot: 'arms/a_std/r_upper',
            conns: { elbow: { p: [0, -0.9, 0.05], r: [0, 0, 0] } },
          });
          t.oncomplete = () => {
            window.__oldDb = d;
            res();
          };
          t.onerror = () => rej(t.error);
        };
      }),
    { fore: [...fs.readFileSync(fore)], rifle: [...fs.readFileSync(rifle)] },
  );
  // 舊連線佔住時升級會等待：顯示提示，關閉後自動繼續
  await page.goto(base + 'model-library.html?test');
  check(
    await page.waitForSelector('#dbNotice', { timeout: 8000 }).then(
      () => true,
      () => false,
    ),
    '其他舊版分頁佔住資料庫時，提示關閉那些分頁',
  );
  await old.evaluate(() => window.__oldDb.close());
  await page.waitForSelector('.cell');
  check(!(await page.$('#dbNotice')), '舊連線關閉後自動繼續載入、收回提示');
  await old.close();
  await wait(800);
  const st = () =>
    page.evaluate(() => {
      const s = window.__workshop.store;
      return {
        cur: s.curSet().name,
        sets: s.setList().map((x) => x.name),
        local: [...s.local.keys()].sort(),
        joints: s.jointCount(),
        recs: [...s.recs.values()].map((r) => r.set + ':' + r.id).sort(),
      };
    });
  let s = await st();
  check(
    s.cur === '預設' &&
      s.sets.length === 1 &&
      s.local.join() === 'arms/a_std/r_fore,prop/debris' &&
      s.joints === 1 &&
      s.recs.join() === ':prop/debris,default:arms/a_std/r_fore',
    `舊版資料遷移成「預設」模型組（機甲區塊進模型組、地圖物件共用、關節 ${s.joints} 個）`,
  );
  check(((await page.textContent('#setCur')) || '').trim() === '預設', '上方顯示目前的模型組');
  // 在「預設」開一次組裝調整頁：模型組記下零件組合（沒有記錄的模型組切換時沿用目前的組合）
  await page.click('#tabs [data-c="workshop"]');
  await page.waitForSelector('#workshop:not([hidden])');
  await wait(1000);
  await page.click('#wsBack');
  check(
    (await page.evaluate(() => window.__workshop.store.curSet().asm.head)) === 'h_std',
    '模型組記住組裝調整頁的零件組合',
  );
  // 新增空白模型組
  await page.click('#setMenu summary');
  await page.fill('#setName', '測試B');
  await page.click('#setNew');
  await wait(400);
  s = await st();
  check(
    s.cur === '測試B' && s.local.join() === 'prop/debris' && s.joints === 0,
    '新增空白模型組：沒有機甲 GLB 與關節，地圖物件仍共用',
  );
  const kindOf = (id) => page.evaluate((id) => window.__workshop.store.source(id).kind, id);
  check((await kindOf('arms/a_std/r_fore')) === 'proc', '新模型組的右前臂是程式模型');
  // 在測試B 存 GLB 與關節（和編輯器、組裝調整頁一樣經過 store）
  await page.evaluate(
    async (bytes) => {
      const s = window.__workshop.store;
      await s.putBuf('weapon/w_rifle/r', 'rifle.glb', new Uint8Array(bytes).buffer);
      await s.putBuf('arms/a_std/l_hand', 'hand.glb', new Uint8Array(bytes).buffer);
      await s.setJoint('arms/a_std/l_upper', 'elbow', { p: [0, -0.8, 0], r: [0, 0, 0] });
    },
    [...fs.readFileSync(rifle)],
  );
  // 組裝調整頁：模型組記住零件組合
  await page.click('#tabs [data-c="workshop"]');
  await page.waitForSelector('#workshop:not([hidden])');
  await wait(1200);
  await page.evaluate(() => {
    const w = window.__workshop;
    w.asm.head = 'h_hv';
    return w.rebuild();
  });
  await wait(600);
  check(
    ((await page.textContent('#wsInfo')) || '').includes('模型組「測試B」'),
    '組裝調整頁顯示目前的模型組',
  );
  await page.click('#wsBack');
  await wait(300);
  // 切回預設
  await page.click('#setMenu summary');
  await page.click('#setList button:has-text("預設")');
  await wait(600);
  s = await st();
  check(
    s.cur === '預設' && s.local.join() === 'arms/a_std/r_fore,prop/debris' && s.joints === 1,
    '切回「預設」：右前臂 GLB 與關節設定回來',
  );
  check(
    (await page.evaluate(() => window.__workshop.asm.head)) !== 'h_hv',
    '切換模型組後組裝調整改用它的零件組合',
  );
  await page.click('#setList button:has-text("測試B")');
  await wait(600);
  check(
    (await page.evaluate(() => window.__workshop.asm.head)) === 'h_hv' &&
      (await kindOf('arms/a_std/r_fore')) === 'proc',
    '切到「測試B」：零件組合（重型頭）與槽位跟著換',
  );
  // 複製目前、改名
  await page.fill('#setName', '');
  await page.click('#setDup');
  await wait(400);
  s = await st();
  check(
    s.cur === '測試B 複本' &&
      s.local.join() === 'arms/a_std/l_hand,prop/debris,weapon/w_rifle/r' &&
      s.joints === 1,
    '複製目前模型組：GLB 與關節設定一起複製',
  );
  await page.fill('#setName', '測試C');
  await page.click('#setRename');
  await wait(300);
  check((await st()).cur === '測試C', '改名');
  // 匯出 → 刪除 → 匯入
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#setExport')]);
  const file = path.join(SHOT_DIR, d.suggestedFilename());
  await d.saveAs(file);
  const zb = fs.readFileSync(file);
  check(
    /測試C\.rubicon-set$/.test(file) &&
      zb.slice(0, 2).toString() === 'PK' &&
      zb.includes('manifest.json') &&
      zb.includes('models/weapon/w_rifle/r.glb'),
    `匯出模型組檔（${path.basename(file)}，${zb.length} bytes）`,
  );
  await page.click('#setDel');
  await wait(400);
  s = await st();
  check(!s.sets.includes('測試C') && s.sets.length === 2, `刪除模型組（剩 ${s.sets.join('、')}）`);
  await page.setInputFiles('#setImportFile', file);
  await wait(800);
  s = await st();
  check(
    s.cur === '測試C' &&
      s.local.join() === 'arms/a_std/l_hand,prop/debris,weapon/w_rifle/r' &&
      s.joints === 1 &&
      (await page.evaluate(() => window.__workshop.store.curSet().asm.head)) === 'h_hv',
    '匯入模型組檔：GLB、關節設定、零件組合都還原',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'model-sets-menu.png') });
  // 重新整理後仍是同一個模型組
  await page.reload();
  await page.waitForSelector('.cell');
  await wait(500);
  s = await st();
  check(s.cur === '測試C' && s.sets.length === 3 && s.joints === 1, '重新整理後保留模型組與目前的選擇');
  // 遊戲：設定選模型組
  const game = await ctx.newPage();
  watch(game, 'model-sets-game');
  await game.goto(base);
  await waitVisible(game, 'title');
  await game.click('#btnSettings');
  await waitVisible(game, 'settings');
  await game.check('#lmOn');
  // 讀完模型庫才重畫設定（選單也是那時才有），等到狀態不是「尚未讀取」
  await game
    .waitForFunction(() => /套用 GLB/.test(document.getElementById('lmBox').textContent), null, {
      timeout: 15000,
    })
    .catch(() => {});
  const box = async () => (await game.textContent('#lmBox')) || '';
  let t = await box();
  check(
    t.includes('套用 GLB 2 個') && t.includes('關節設定 1 個'),
    `遊戲預設讀「預設」模型組（${(t.match(/狀態：([^重]*)/) || ['', ''])[1].trim()}）`,
  );
  const opts = await game.$$eval('#lmSet option', (os) => os.map((o) => o.textContent));
  check(opts.join() === '預設,測試B,測試C', `模型組選單列出模型庫的模型組（${opts.join('、')}）`);
  const val = await game.$eval(
    '#lmSet',
    (sel) => [...sel.options].find((o) => o.textContent === '測試C').value,
  );
  await game.selectOption('#lmSet', val);
  await game
    .waitForFunction(() => /套用 GLB 3 個/.test(document.getElementById('lmBox').textContent), null, {
      timeout: 15000,
    })
    .catch(() => {});
  t = await box();
  await game.click('.lmUsed summary');
  const used = await game.$$eval('.lmUsed [data-slot]', (els) => els.map((e) => e.dataset.slot).sort());
  check(
    t.includes('套用 GLB 3 個') && used.join() === 'arms/a_std/l_hand,prop/debris,weapon/w_rifle/r',
    `切換到「測試C」後套用該組的 GLB（${used.join('、')}）`,
  );
  await game.screenshot({ path: path.join(SHOT_DIR, 'model-sets-game.png') });
  await game.reload();
  await waitVisible(game, 'title');
  check(
    (await game.evaluate(() => JSON.parse(localStorage.getItem('rubicon_localmodels')).set)) === val,
    '遊戲記住選擇的模型組',
  );
  await testMechPack(page, game, base);
  await ctx.close();
}

// 機體包：組裝調整頁的預組跟著模型組 → 匯出這台機甲（含 GLB）→ 匯入成新模型組 → 合併到另一組 → 車庫選機甲
async function testMechPack(page, game, base) {
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  const lib = () =>
    page.evaluate(() => {
      const w = window.__workshop,
        s = w.store;
      return {
        cur: s.curSet().name,
        sets: s.setList().map((x) => x.name),
        local: [...s.local.keys()].filter((k) => !k.startsWith('prop/')).sort(),
        joints: Object.keys(s.joints).sort(),
        mechs: s.mechsOf().map((m) => m.name),
        head: w.asm.head,
      };
    });
  await page.click('#tabs [data-c="workshop"]');
  await page.waitForSelector('#workshop:not([hidden])');
  await wait(1200);
  let s = await lib();
  check(s.cur === '測試C' && s.head === 'h_hv', '組裝調整頁用目前模型組（測試C）的零件組合');
  await page.fill('#wsPresetName', '機體X');
  await page.click('#wsSavePreset');
  await wait(400);
  s = await lib();
  check(s.mechs.includes('機體X'), '預組存進目前模型組的機甲清單');
  check(
    !(await page.evaluate(() => window.__workshop.store.mechsOf('default').some((m) => m.name === '機體X'))),
    '其他模型組的機甲清單不受影響',
  );
  // 匯出這台機甲：這台用到的槽位裡有 GLB 的都帶上（不含參考圖）
  const expect = await page.evaluate(() => {
    const w = window.__workshop;
    return w.mechSlots().filter((id) => w.store.local.has(id));
  });
  const [d] = await Promise.all([page.waitForEvent('download'), page.click('#wsMechExport')]);
  const file = path.join(SHOT_DIR, 'mech-' + d.suggestedFilename());
  await d.saveAs(file);
  const zb = fs.readFileSync(file);
  check(
    /機體X\.rubicon-set$/.test(d.suggestedFilename()) &&
      expect.length >= 2 &&
      expect.every((id) => zb.includes(`models/${id}.glb`)) &&
      zb.includes('"mech"') &&
      !zb.includes('refs.json'),
    `匯出這台機甲（GLB ${expect.join('、')}，不含參考圖）`,
  );
  // 匯入：建立新模型組
  await page.selectOption('#wsMechMode', 'new');
  await page.setInputFiles('#wsMechFile', file);
  await wait(1500);
  s = await lib();
  check(
    s.cur === '機體X' &&
      expect.every((id) => s.local.includes(id)) &&
      s.joints.includes('arms/a_std/l_upper') &&
      s.mechs.join() === '機體X' &&
      s.head === 'h_hv',
    `匯入機甲建立新模型組「${s.cur}」（GLB、關節設定、零件組合、機甲清單）`,
  );
  // 匯入：合併到「預設」（有右前臂 GLB 與右手肘關節，這台機甲沒有 → 改回程式模型、移除關節設定）
  await page.click('#wsBack');
  await page.click('#setMenu summary');
  await page.click('#setList button:has-text("預設")');
  await wait(600);
  await page.click('#tabs [data-c="workshop"]');
  await page.waitForSelector('#workshop:not([hidden])');
  await wait(1000);
  await page.selectOption('#wsMechMode', 'merge');
  dialogs.length = 0;
  await page.setInputFiles('#wsMechFile', file);
  await wait(1500);
  s = await lib();
  check(
    dialogs.some((m) => m.includes('arms/a_std/r_fore') && m.includes('arms/a_std/r_upper')),
    '合併前列出會改掉的槽位',
  );
  check(
    s.cur === '預設' &&
      expect.every((id) => s.local.includes(id)) &&
      !s.local.includes('arms/a_std/r_fore') &&
      s.joints.join() === 'arms/a_std/l_upper' &&
      s.mechs.includes('機體X') &&
      s.head === 'h_hv',
    `合併到目前模型組（GLB ${s.local.join('、')}；關節 ${s.joints.join('、')}）`,
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'mech-pack.png') });
  await page.click('#wsBack');
  // 車庫：從模型組的機甲清單換上
  await game.goto(base + '?test');
  await waitVisible(game, 'title');
  await newCareer(game);
  await waitVisible(game, 'garage');
  await game.waitForSelector('#gMechSel', { timeout: 8000 });
  const opt = await game.$$eval('#gMechSel optgroup', (gs) =>
    gs.map((g) => g.label + ':' + [...g.querySelectorAll('option')].map((o) => o.textContent).join('/')),
  );
  check(
    opt.some((o) => o.startsWith('機體X:機體X')) &&
      opt.some((o) => o.startsWith('預設:') && o.includes('機體X')),
    `車庫列出各模型組的機甲（${opt.join('、')}）`,
  );
  const pickX = () =>
    game.$eval('#gMechSel', (sel) => {
      const o = [...sel.querySelectorAll('optgroup')]
        .find((g) => g.label === '機體X')
        .querySelector('option');
      sel.value = o.value;
      sel.dispatchEvent(new Event('change'));
    });
  await pickX();
  await wait(300);
  check(
    (await game.evaluate(() => window.__game.save.asm.head)) !== 'h_hv',
    '缺少零件時不換上（重型頭還沒擁有）',
  );
  await game.evaluate(() => window.__game.save.owned.push('h_hv'));
  await pickX();
  await wait(1500);
  const g = await game.evaluate(() => ({
    head: window.__game.save.asm.head,
    set: JSON.parse(localStorage.getItem('rubicon_localmodels')).set,
    note: document.getElementById('gLocal').textContent,
  }));
  const xid = await page.evaluate(() => window.__workshop.store.setList().find((x) => x.name === '機體X').id);
  check(
    g.head === 'h_hv' && g.set === xid && /GLB/.test(g.note),
    `車庫選機甲：換上零件組合並改用它的模型組（${g.note}）`,
  );
  await game.screenshot({ path: path.join(SHOT_DIR, 'garage-mechs.png') });
}

// 伺服器模型組：模型庫的伺服器預設組（整組發佈、直接編輯）→ 單人（敵人用伺服器組、自己用本地模型組）
// → 多人（兩個瀏覽器各自上傳模型組，房主與客機看到對方的機甲用對方的模型組，敵人用伺服器組）
async function testServerModels(browser, url) {
  console.log('伺服器模型組：伺服器預設組 → 單人套用 → 多人各自上傳模型組');
  const fore = path.join(WORK_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(WORK_DIR, 'w_rifle_r_template.glb');
  if (!fs.existsSync(fore) || !fs.existsSync(rifle)) return check(false, '找不到模型庫測試產生的範本 GLB');
  const foreB = [...fs.readFileSync(fore)],
    rifleB = [...fs.readFileSync(rifle)];
  const manifest = () =>
    JSON.parse(fs.readFileSync(path.join(SERVER_MODELS, 'default', 'manifest.json'), 'utf8'));
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const lib = await ctxA.newPage();
  watch(lib, 'srv-lib');
  lib.on('dialog', (d) => d.accept());
  await lib.goto(url + 'models?test');
  await lib.waitForSelector('.cell');
  await wait(800);
  const mkBox = (page, w, h, d, name) =>
    page.evaluate(
      ([w, h, d, name]) =>
        new Promise((res) => {
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshStandardMaterial({ name, color: 0xff00ff }),
          );
          m.position.y = h / 2;
          new THREE.GLTFExporter().parse(m, (b) => res([...new Uint8Array(b)]), { binary: true });
        }),
      [w, h, d, name],
    );
  const cube = await mkBox(lib, 0.7, 0.7, 0.7, 'acc');
  const debris = await mkBox(lib, 0.75, 0.35, 0.75, 'main');
  await lib.click('#setMenu summary');
  const names = await lib.$$eval('#setList button b', (bs) => bs.map((b) => b.textContent));
  check(names[0] === '伺服器預設組', `從伺服器開啟時模型組選單多「伺服器預設組」（${names.join('、')}）`);
  // 整組發佈：本地模型組「發佈測試」（右前臂＋手肘關節）→ 伺服器預設組
  await lib.evaluate(async (fore) => {
    const s = window.__workshop.store;
    const set = await s.createSet('發佈測試', {
      recs: [{ id: 'arms/a_std/r_fore', name: 'fore.glb', buf: new Uint8Array(fore).buffer }],
      joints: { 'arms/a_std/r_upper': { elbow: { p: [0, -0.9, 0.05], r: [0, 0, 0] } } },
    });
    await s.useSet(set.id);
  }, foreB);
  await lib.reload();
  await lib.waitForSelector('.cell');
  await lib.click('#setMenu summary');
  check(await lib.isVisible('#setPublish'), '本地模型組可以「發佈到伺服器預設組」');
  await lib.click('#setPublish');
  await lib.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('已發佈到伺服器預設組')),
  );
  let m = manifest();
  check(
    Object.keys(m.models).join() === 'arms/a_std/r_fore' &&
      m.joints['arms/a_std/r_upper'] &&
      fs.existsSync(path.join(SERVER_MODELS, 'default', 'glb', 'arms', 'a_std', 'r_fore.glb')),
    '整組發佈：伺服器的資料夾寫入 GLB 與關節設定',
  );
  // 直接編輯伺服器預設組：切換後存檔（和 GLB 編輯器、拖曳替換同一條路徑）一律寫到伺服器
  await lib.click('#setList button.srv');
  await lib.waitForFunction(() => window.__workshop.store.isServer());
  await wait(300);
  await lib.evaluate(
    async ({ cube, debris }) => {
      const s = window.__workshop.store;
      await s.putBuf('prop/debris', 'debris.glb', new Uint8Array(debris).buffer);
      await s.putBuf('vehicle/tank/turret', 'turret.glb', new Uint8Array(cube).buffer);
      await s.setJoint('arms/a_std/r_upper', 'wrist_test', { p: [0, 0, 0], r: [0, 0, 0] });
      await s.setJoint('arms/a_std/r_upper', 'wrist_test', null);
    },
    { cube, debris },
  );
  m = manifest();
  check(
    Object.keys(m.models).sort().join() === 'arms/a_std/r_fore,prop/debris,vehicle/tank/turret' &&
      Object.keys(m.joints['arms/a_std/r_upper']).join() === 'elbow',
    `選伺服器預設組時存檔直接寫到伺服器（GLB ${Object.keys(m.models).length} 個、關節設定、刪除）`,
  );
  // 重新讀取伺服器：選單與格子更新（伺服器預設組 3 個 GLB）
  await lib.click('#setSrvReload');
  await lib.waitForFunction(() =>
    [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('已重新讀取伺服器預設組')),
  );
  const srvRow = (await lib.textContent('#setList button.srv')) || '';
  check(srvRow.includes('GLB 3'), `「重新讀取伺服器」後選單顯示伺服器預設組的內容（${srvRow.trim()}）`);
  await lib.screenshot({ path: path.join(SHOT_DIR, 'server-models-library.png') });
  // 重新整理：仍在伺服器預設組，檢視窗標示來源
  await reopen(lib, url + 'models?test#prop/debris');
  await lib.waitForSelector('#inspect:not([hidden])');
  await wait(1500);
  const info = (await lib.textContent('#insInfo')) || '';
  check(info.includes('GLB（伺服器預設組）'), '重新整理後仍是伺服器預設組，檢視窗標示「伺服器預設組」');
  // 玩家 A 的本地模型組（多人時上傳）
  const idA = await lib.evaluate(
    async ({ rifle, cube }) => {
      const s = window.__workshop.store;
      const set = await s.createSet('玩家A', {
        recs: [
          { id: 'weapon/w_rifle/r', name: 'rifle.glb', buf: new Uint8Array(rifle).buffer },
          { id: 'arms/a_std/l_hand', name: 'hand.glb', buf: new Uint8Array(cube).buffer },
        ],
        joints: { 'arms/a_std/l_upper': { elbow: { p: [0, -0.8, 0], r: [0, 0, 0] } } },
      });
      return set.id;
    },
    { rifle: rifleB, cube },
  );
  await lib.close();

  // ---- 單人：敵人與地圖物件用伺服器預設組，自己的機甲用本地模型組 ----
  const game = await ctxA.newPage();
  watch(game, 'srv-solo');
  await game.goto(url + '?test');
  await waitVisible(game, 'title');
  await game.click('#btnSettings');
  await waitVisible(game, 'settings');
  await wait(1500);
  let t = (await game.textContent('#lmBox')) || '';
  check(
    t.includes('伺服器預設組') && t.includes('GLB 3 個'),
    `設定畫面顯示伺服器預設組（${(t.match(/伺服器預設組([^重]*)/) || ['', ''])[1].trim()}）`,
  );
  await game.$eval('#lmBox', (e) => e.scrollIntoView({ block: 'center' }));
  await game.screenshot({ path: path.join(SHOT_DIR, 'server-models-settings.png') });
  await game.click('#btnSettingsBack');
  await waitVisible(game, 'title');
  await newCareer(game);
  check(await waitVisible(game, 'garage'), '車庫畫面顯示');
  await wait(1500);
  t = (await game.textContent('#gLocal')) || '';
  check(t.includes('伺服器預設組：此機'), `沒選本地模型組時，車庫的機甲用伺服器預設組（${t.trim()}）`);
  await game.waitForSelector('#gModelSetSel');
  await game.selectOption('#gModelSetSel', idA);
  await wait(2000);
  t = (await game.textContent('#gLocal')) || '';
  check(t.includes('本地模型組「玩家A」'), `車庫選本地模型組後換成它（${t.trim()}）`);
  await game.screenshot({ path: path.join(SHOT_DIR, 'server-models-garage.png') });
  await game.click('#btnSortie');
  check(await waitVisible(game, 'hudWrap', 15000), '單人出擊');
  await playFor(game, 3000);
  const solo = await game.evaluate(() => {
    const g = window.__game;
    // 第 1 關的編成是隨機的，前半可能全是載具／直升機／無人機（有 modelKind），這時補一台 MT 再檢查
    if (!g.enemies.some((e) => !e.opts.modelKind)) g.spawnType('mt', 1, 1);
    return {
      me: g.player.modelSrc && g.player.modelSrc.id,
      enemies: g.enemies.filter((e) => !e.opts.modelKind).map((e) => e.modelSrc && e.modelSrc.id),
      srvGlb: g.enemies.some((e) => Object.values(e.model.pieces || {}).some((o) => o.userData.localGlb)),
    };
  });
  check(
    String(solo.me).startsWith('local:') && solo.enemies.length && solo.enemies.every((x) => x === '@server'),
    `單人：自己的機甲用本地模型組、敵人用伺服器預設組（敵人 ${solo.enemies.length} 台${solo.srvGlb ? '，有區塊換成 GLB' : ''}）`,
  );
  await game.screenshot({ path: path.join(SHOT_DIR, 'server-models-solo.png') });
  await game.keyboard.press('Escape');
  await wait(400);
  await game.click('#btnAbort');
  await waitVisible(game, 'result');
  await game.close();

  // ---- 多人：另一個瀏覽器（玩家 B）有自己的模型組 ----
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const libB = await ctxB.newPage();
  watch(libB, 'srv-libB');
  await libB.goto(url + 'models?test');
  await libB.waitForSelector('.cell');
  const cubeB = await mkBox(libB, 0.9, 0.9, 0.9, 'main');
  const idB = await libB.evaluate(async (cube) => {
    const s = window.__workshop.store;
    const set = await s.createSet('玩家B', {
      recs: [{ id: 'head/h_std', name: 'head.glb', buf: new Uint8Array(cube).buffer }],
    });
    return set.id;
  }, cubeB);
  await libB.close();
  const host = await ctxA.newPage();
  const cli = await ctxB.newPage();
  watch(host, 'srv-mp-host');
  watch(cli, 'srv-mp-client');
  await host.goto(url + '?test');
  await cli.goto(url + '?test');
  await host.click('#btnMP');
  await setNick(host, 'HOSTA');
  await host.click('#btnMPHost');
  check(await waitVisible(host, 'lobby'), '多人：房主進入大廳');
  await host.check('#mpAuto');
  await host.dispatchEvent('#mpAuto', 'change');
  const tagOk = (page, name) =>
    page
      .waitForFunction(
        (name) =>
          [...document.querySelectorAll('#lobbySlots .mtag')].some(
            (e) => e.textContent.includes(name) && e.textContent.includes('✓'),
          ),
        name,
        { timeout: 20000 },
      )
      .then(
        () => true,
        () => false,
      );
  check(await tagOk(host, '玩家A'), '房主的模型組「玩家A」上傳完成（大廳顯示 ✓）');
  await cli.click('#btnMP');
  await setNick(cli, 'CLIB');
  await wait(1000);
  await cli.click('#btnMPList');
  await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
  await cli.click('#mpRooms .part');
  check(await waitVisible(cli, 'lobby', 15000), '多人：客機進入大廳');
  await cli.waitForSelector(`#lobbyModelsSel option[value="${idB}"]`, { state: 'attached', timeout: 10000 });
  await cli.selectOption('#lobbyModelsSel', idB);
  check(await tagOk(host, '玩家B'), '客機選「玩家B」後上傳，房主大廳顯示並下載完成');
  check(await tagOk(cli, '玩家A'), '客機也下載房主的模型組');
  const ups = fs.readdirSync(path.join(SERVER_MODELS, 'uploads')).filter((f) => f.endsWith('.rubicon-set'));
  check(ups.length === 2, `伺服器存了 2 個玩家上傳的模型組（${ups.length}）`);
  await host.screenshot({ path: path.join(SHOT_DIR, 'server-models-lobby-host.png') });
  await cli.screenshot({ path: path.join(SHOT_DIR, 'server-models-lobby-client.png') });
  await cli.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbySortie');
  check(await waitVisible(host, 'hudWrap', 20000), '多人：房主出擊');
  check(await waitVisible(cli, 'hudWrap', 20000), '多人：客機出擊');
  await Promise.all([playFor(host, 3000), playFor(cli, 3000)]);
  const view = (page) =>
    page.evaluate(() => {
      const g = window.__game;
      const out = {};
      for (const e of g.players) out[e.name] = e.modelSrc ? e.modelSrc.name : null;
      out.names = g.players.map((e) => e.name + ':' + e.slot + ':' + (e.opts.ms || '').slice(0, 6));
      out.enemies = g.enemies
        .filter((e) => !e.opts.modelKind)
        .every((e) => e.modelSrc && e.modelSrc.id === '@server');
      out.headGlb = g.players.some(
        (e) => e.model.pieces['head/h_std'] && e.model.pieces['head/h_std'].userData.localGlb,
      );
      return out;
    });
  const hv = await view(host);
  check(
    hv.HOSTA === '玩家A' && hv.CLIB === '玩家B' && hv.enemies && hv.headGlb,
    `房主：自己用「${hv.HOSTA}」、客機的機甲用「${hv.CLIB}」（頭換成 GLB）、敵人用伺服器預設組`,
  );
  let cv = await view(cli);
  for (let i = 0; i < 20 && !(cv.HOSTA === '玩家A' && cv.CLIB === '玩家B'); i++) {
    await wait(500);
    cv = await view(cli);
  }
  check(
    cv.HOSTA === '玩家A' && cv.CLIB === '玩家B' && cv.enemies,
    `客機：房主的機甲用「${cv.HOSTA}」、自己用「${cv.CLIB}」、敵人用伺服器預設組（${JSON.stringify(cv)}）`,
  );
  await host.screenshot({ path: path.join(SHOT_DIR, 'server-models-mp-host.png') });
  await cli.screenshot({ path: path.join(SHOT_DIR, 'server-models-mp-client.png') });
  await ctxA.close();
  await ctxB.close();
}

async function continueToPilot(page) {
  await page.reload();
  await waitVisible(page, 'title');
  await page.click('#btnContinue');
  await waitVisible(page, 'garage');
  await page.click('#btnPilot');
  return waitVisible(page, 'pilot');
}
const ptsLeft = async (page) => Number(await page.textContent('#pPtsLeft'));
async function testPilot(browser, base) {
  console.log('駕駛員：舊存檔遷移 → 配點 → 車庫數值 → 預設組');
  const { ctx, page } = await newPage(browser, 'pilot');
  await page.goto(base);
  await waitVisible(page, 'title');
  if (!(await page.$('#btnPilot'))) {
    console.log('  （此版本沒有駕駛員系統，略過）');
    return ctx.close();
  }
  await newCareer(page);
  await waitVisible(page, 'garage');
  await editSave(page, 'delete s.pilot; s.level = 4; s.missionsDone = 3;'); // 模擬舊版存檔
  check(await continueToPilot(page), '舊存檔（沒有 pilot）可開啟駕駛員畫面');
  check((await page.textContent('#pLevel')).includes('Lv 1'), '舊存檔駕駛員從 Lv1 開始');
  check((await ptsLeft(page)) === 0, 'Lv1 沒有技能點');
  await editSave(page, 's.pilot.pve.xp = 5000;'); // Lv7 → 6 點
  await continueToPilot(page);
  const before = await ptsLeft(page);
  check(before === 6, `經驗 5000 時有 6 點（${before}）`);
  check(await page.isDisabled('.pNode[data-skill="g_mag"] .pInc'), 'T2 技能在前段未投點時鎖定');
  await page.click('.pNode[data-skill="a_ap"] .pInc');
  check((await ptsLeft(page)) === before - 1, '投點後剩餘點數減少');
  await page.click('.pNode[data-skill="a_ap"] .pInc');
  await page.click('.pNode[data-skill="a_ap"] .pInc');
  check(!(await page.isDisabled('.pNode[data-skill="a_def"] .pInc')), '前段投滿 3 點後 T2 解鎖');
  await page.fill('#pPresets .pPreset:first-child .pName', '<b>測試</b>');
  await page.click('#pPresets .pPreset:first-child .pSave');
  check(!(await page.isDisabled('#pPresets .pPreset:first-child .pLoad')), '預設組儲存後可載入');
  await page.click('#pMode_pvp');
  check((await page.textContent('#pLevel')).includes('PvP'), '可切換到 PvP 駕駛員');
  check((await ptsLeft(page)) === 0, 'PvP 駕駛員的經驗與配點獨立');
  await page.click('#pMode_pve');
  await wait(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'pilot.png') });
  await page.click('#btnPilotBack');
  check(await waitVisible(page, 'garage'), '返回機甲庫');
  check((await page.textContent('#stats')).includes('(+'), '車庫規格顯示技能加成');
  await page.screenshot({ path: path.join(SHOT_DIR, 'garage-pilot.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.click('#btnPilot');
  await wait(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'pilot-narrow.png') });
  await ctx.close();
}

// 房主建房 → 客機加入 → 雙方準備 → 出擊；migrate 為 true 時再測房主離線後的遷移
// 新 Boss（game/bosses.js、entities/mech-boss.js）：以 Boss 關的等級開出每一種，以固定 dt 同步模擬檢查機制
async function testBosses(browser, base) {
  console.log('新 Boss：護盾指揮艦、鑽地蟲、砲兵陣地、多足要塞、電磁狩獵機、空中要塞');
  const { ctx, page } = await newPage(browser, 'boss');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const run = (L, key) =>
    page.evaluate(
      ([L, key]) => {
        const g = window.__game;
        g.save.level = L;
        g.startMission();
        g.state = 'boss-test'; // 停住主迴圈，由這裡推進
        const pl = g.player;
        Object.assign(pl, { hp: 1e7, maxHp: 1e7, acsMax: 1e9 });
        const boss = g.boss;
        const dt = 1 / 60;
        const step = (sec, each) => {
          for (let i = 0; i < Math.round(sec / dt); i++) {
            g.time += dt;
            pl.move(dt, new THREE.Vector3(), false, false, false, null);
            for (const e of g.enemies) if (!e.dead) e.updateAI(dt);
            g.separateMechs(dt);
            for (let k = g.projectiles.length - 1; k >= 0; k--) {
              g.projectiles[k].update(dt);
              if (g.projectiles[k].dead) g.projectiles.splice(k, 1);
            }
            g.updateShocks(dt);
            g.updateSupport(dt);
            g.updateHazards(dt);
            if (each) each();
          }
        };
        const hit = () => {
          const h = boss.hp;
          boss.iFrames = 0;
          boss.takeDamage(1000, 0, pl, boss.center());
          return Math.round(h - boss.hp);
        };
        const kill = (list) => list.forEach((e) => e.takeDamage(1e9, 0, pl, e.center()));
        const place = (dist) => {
          const x = boss.pos.x + (boss.pos.x > 0 ? -dist : dist);
          pl.pos.set(x, g.world.groundAt(x, boss.pos.z, 99), boss.pos.z);
        };
        const r = {
          name: boss.name,
          parts: boss
            .partsOf()
            .map((e) => e.opts.partKind)
            .join(','),
        };
        if (key === 'aegis') {
          r.a = hit();
          kill(boss.partsOf('pylon'));
          step(0.3);
          r.b = hit();
          step(25.5);
          r.rebuilt = boss.partsOf('pylon').length;
        } else if (key === 'worm') {
          place(10);
          const seen = new Set();
          r.a = r.b = null;
          step(28, () => {
            seen.add(boss.aiState.wm);
            if (boss.aiState.wm === 'burrow' && r.a === null) r.a = hit();
            if (boss.aiState.wm === 'up' && r.b === null) r.b = hit();
          });
          r.states = seen.size;
          r.segs = boss.wormSegs ? boss.wormSegs.length : 0;
        } else if (key === 'bastille') {
          r.mines = g.mines.length;
          r.a = hit();
          place(30);
          step(14);
          r.lost = 1e7 - pl.hp;
          kill(boss.partsOf('cannon'));
          step(0.2);
          r.b = hit();
        } else if (key === 'arachne') {
          step(0.2);
          r.follow = boss.partsOf('joint').every((e) => e.pos.y - boss.pos.y > 3);
          r.a = hit();
          kill(boss.partsOf('joint').slice(0, 3));
          step(0.3);
          r.collapsed = !!boss.aiState.collapsed && boss.staggerT > 0;
          r.b = hit();
        } else if (key === 'nullifier') {
          place(12);
          boss.aiState.empT = 0;
          let emp = 0;
          step(4, () => (emp += pl.empLockT > 0 ? 1 : 0));
          r.emp = emp;
          place(30);
          boss.aiState.pullCd = 0;
          boss.aiState.empT = 99;
          let pull = 0;
          step(1, () => (pull += pl.pullT > 0 ? 1 : 0));
          r.pull = pull;
        } else if (key === 'leviathan') {
          step(1);
          r.alt = boss.pos.y - g.world.terrainHeight(boss.pos.x, boss.pos.z);
          r.a = hit();
          kill(boss.partsOf('engine'));
          step(9); // 降到 10 m 要一段時間（地形起伏時更久）
          r.altDown = boss.pos.y - g.world.terrainHeight(boss.pos.x, boss.pos.z);
          r.b = hit();
        }
        // 擊破：部位與地雷一起消失
        kill(boss.partsOf('pylon'));
        boss.bossVis = 0;
        boss.iFrames = 0;
        boss.takeDamage(1e10, 0, pl, boss.center());
        step(0.2);
        r.dead = boss.dead;
        r.left = boss.partsOf().length + (g.mines || []).filter((m) => m.owner === boss).length;
        g.clearMission();
        g.state = 'title';
        return r;
      },
      [L, key],
    );
  let r = await run(6, 'aegis');
  check(
    r.a === 0 && r.b > 0 && r.rebuilt === 4 && r.dead && r.left === 0,
    `${r.name}：發生器在時打不動（${r.a}）、拆光後 ${r.b}、25 秒後重建 ${r.rebuilt} 座、擊破後部位消失`,
  );
  r = await run(12, 'worm');
  check(
    r.a === 0 && r.b > 0 && r.states === 5 && r.segs > 0 && r.dead,
    `${r.name}：地下打不到（${r.a}）、鑽出後 ${r.b}、五個狀態循環、身體 ${r.segs} 節`,
  );
  r = await run(18, 'bastille');
  check(
    r.mines >= 20 && r.a < r.b * 0.2 && r.lost > 0 && r.dead && r.left === 0,
    `${r.name}：地雷 ${r.mines} 顆、砲台在時 ${r.a}／全毀後 ${r.b}、砲擊命中、擊破後部位與地雷消失`,
  );
  r = await run(24, 'arachne');
  check(
    r.follow && r.a < r.b * 0.3 && r.collapsed && r.dead && r.left === 0,
    `${r.name}：關節掛在膝上、腳全在時 ${r.a}／斷三條倒下後 ${r.b}`,
  );
  r = await run(30, 'nullifier');
  check(r.emp > 0 && r.pull > 0 && r.dead, `${r.name}：EMP 封鎖 QB 與懸浮、電磁牽引`);
  r = await run(33, 'leviathan');
  check(
    r.alt > 18 && r.a < r.b * 0.2 && r.altDown < r.alt - 5 && r.dead && r.left === 0,
    `${r.name}：高度 ${r.alt.toFixed(0)} m、引擎在時 ${r.a}／全毀後 ${r.b}、高度降到 ${r.altDown.toFixed(0)} m`,
  );
  await ctx.close();
}

// 鎖定（player.js 的 lockCands／autoLock／cycleLock）：攻擊距離內；第三人稱機甲正面 180° 內（含畫面外的側面）由近到遠，
// 背後的不鎖定；第一人稱畫面內依離準星的角度；目標移到攻擊距離外就改鎖其他近的
async function testLockOn(browser, base) {
  console.log('鎖定：機甲正面 180° 由近到遠、背後不鎖定、第一人稱依準星角度、超出攻擊距離重新鎖定');
  const { ctx, page } = await newPage(browser, 'lock');
  // 地圖種子與敵人編成固定（以前每次隨機：大約 40 次有 1 次中央是台地等地形特徵，敵人放在台地下方 15 m，
  // 3D 距離的順序變了、第一人稱的準星也看不到它們）
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.__reseed(4270);
    g.save.level = 1;
    g.startMission();
    g.state = 'lock-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const y0 = g.world.terrainHeight(0, 0);
    pl.pos.set(0, y0, 0); // 地面上（中央可能有高架橋）
    pl.yaw = pl.aimYaw = 0; // 面向 −Z
    const reach = g.lockReach(pl);
    // 五台：前方近、前方遠、前方偏右、背後最近、正側面（畫面外）；其他敵人移走
    for (const e of g.enemies) e.pos.set(200, -50, 200);
    const es = g.enemies.slice(0, 5);
    while (es.length < 5) es.push(g.spawnEnemy({ name: 'T', asm: pl.asm, pal: 'enemy', ai: 'mt' }));
    // 和玩家同一高度（地形起伏、貨櫃與掩體頂都不影響距離的順序與是否在畫面內；同 testChase）
    const put = (e, x, z) => {
      e.pos.set(x, y0, z);
      e.mesh.position.copy(e.pos);
    };
    put(es[0], 0, -8);
    put(es[1], 0, -14); // 比偏右那台遠，但仍在畫面內
    put(es[2], 6, -10);
    put(es[3], 0, 6); // 背後
    put(es[4], 30, -1); // 正側面，在第三人稱畫面外
    const cam = () => {
      for (let i = 0; i < 40; i++) g.updateCamera(1 / 60);
      g.camera.updateMatrixWorld(true);
    };
    cam();
    pl.lock = null;
    g.autoLock(pl);
    const first = pl.lock === es[0];
    const order = [];
    for (let i = 0; i < 5; i++) {
      g.cycleLock();
      order.push(es.indexOf(pl.lock));
    }
    const behind = !order.includes(3);
    // 鎖定中的目標移到攻擊距離外 → 改鎖其他近的
    pl.lock = es[0];
    put(es[0], 0, -(reach + 15));
    g.autoLock(pl);
    const side = !g.onScreen(es[4]);
    const relock = pl.lock && pl.lock !== es[0] && pl.lock !== es[3];
    // 第一人稱：依離準星的角度（準星對著偏右那台）
    put(es[0], 0, -8);
    g.setFp(true);
    g.fpYaw = Math.atan2(-6, 10);
    g.fpPitch = 0;
    cam();
    pl.lock = null;
    g.autoLock(pl);
    const fp = pl.lock === es[2];
    g.setFp(false);
    g.clearMission();
    g.state = 'title';
    return { first, order: order.join(','), behind, side, relock, fp };
  });
  check(
    r.first && r.order === '2,1,4,0,2' && r.behind && r.side,
    `第三人稱：鎖定機甲前方最近的、正面 180° 內由近到遠（含畫面外的側面，${r.order}）、背後的不鎖定`,
  );
  check(r.relock, '目標移到攻擊距離外時改鎖其他近的敵人');
  check(r.fp, '第一人稱：鎖定離準星最近的');
  await ctx.close();
}

// 追尾視角（機戰傭兵6）：鏡頭在機體後方、速度偏移、鎖定框、目標輔助與甩動換目標、撞牆拉近、三段切換、觸控
async function testChase(browser, base) {
  console.log('追尾視角：鏡頭在後方、速度偏移、鎖定框、目標輔助、撞牆拉近、V 三段切換、平板與手機');
  const { ctx, page } = await newPage(browser, 'chase');
  // 地圖種子固定（以前每次隨機：偶爾機體正後方是台地等地形特徵，鏡頭被地形拉近到 2.2 m、往上推，
  // 位置、速度偏移、撞牆拉近的檢查都失敗）
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.__reseed(4348);
    g.save.level = 1;
    g.startMission();
    g.state = 'chase-test';
    g.waves = [];
    g.wavePend = [];
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const y0 = g.world.terrainHeight(0, 0);
    pl.pos.set(0, y0, 0);
    pl.yaw = pl.aimYaw = 0;
    pl.vel.set(0, 0, 0);
    // 把附近的障礙物移開，避免鏡頭被擋
    g.world.obstacles = g.world.obstacles.filter((o) => Math.hypot(o.x, o.z) > 45);
    for (const e of g.enemies) e.pos.set(200, -50, 200);
    const W = window.innerWidth,
      H = window.innerHeight;
    const cam = (n = 40) => {
      for (let i = 0; i < n; i++) g.updateCamera(1 / 60);
      g.camera.updateMatrixWorld(true);
    };
    g.setView('chase', true);
    g.fpYaw = 0;
    g.fpPitch = 0;
    cam(60);
    const h = pl.model.height;
    const cp = g.camera.position.clone();
    const s0 = g.proj(pl.center());
    const behind = cp.z > 4 && Math.abs(cp.x) < 0.5 && cp.y > y0 + h * 0.9;
    const below = s0.y > H / 2 + 10 && Math.abs(s0.x - W / 2) < 6;
    // 速度偏移：往右移動 → 機體往畫面右邊；往上 → 往上；往前衝 → 變遠
    pl.vel.set(20, 0, 0);
    cam(40);
    const sR = g.proj(pl.center());
    pl.vel.set(0, 12, 0);
    cam(40);
    const sU = g.proj(pl.center());
    pl.vel.set(0, 0, -30);
    cam(40);
    const dF = g.camera.position.distanceTo(pl.center());
    pl.vel.set(0, 0, 0);
    cam(80);
    const d0 = g.camera.position.distanceTo(pl.center());
    const s1 = g.proj(pl.center());
    // 鎖定框：正前方、偏一點、偏很多（畫面內但在框外）
    const es = g.enemies.slice(0, 3);
    while (es.length < 3) es.push(g.spawnEnemy({ name: 'T', asm: pl.asm, pal: 'enemy', ai: 'mt' }));
    // 和玩家同一高度（地形起伏不影響是否在框裡）
    const put = (e, x, z) => {
      e.pos.set(x, y0, z);
      e.mesh.position.copy(e.pos);
    };
    put(es[0], 0, -30);
    put(es[1], 4, -30);
    put(es[2], 25, -30);
    const onScr2 = g.onScreen(es[2]);
    pl.lock = null;
    g.autoLock(pl);
    const first = pl.lock === es[0];
    const order = [];
    for (let i = 0; i < 3; i++) {
      g.cycleLock();
      order.push(es.indexOf(pl.lock));
    }
    const boxOnly = !order.includes(2);
    // 轉向偏很多的那台：鎖定的離開框一段時間後換過去
    pl.lock = es[0];
    g.fpYaw = Math.atan2(-25, 30);
    cam(30);
    g.autoLock(pl);
    const kept = pl.lock === es[0];
    g.lockLostT = performance.now() - 1000;
    g.autoLock(pl);
    const switched = pl.lock === es[2];
    // 目標輔助：鏡頭轉向鎖定的目標
    pl.lock = es[0];
    g.assist = true;
    cam(90);
    const sa = g.proj(es[0].center());
    const assistAim = Math.hypot(sa.x - W / 2, sa.y - H / 2) < 40;
    // 輔助中往右甩：換到右邊的目標
    g.flickT = 0;
    g.camTurn(160, 0, 0.002);
    const flick = pl.lock === es[1];
    g.assist = false;
    // 機體面向準星：沒有鎖定時，跑幾格玩家更新
    for (const e of es) put(e, 200, 200);
    pl.lock = null;
    g.fpYaw = 0.9;
    g.fpPitch = 0;
    for (let i = 0; i < 30; i++) {
      g.updatePlayer(1 / 60);
      g.updateCamera(1 / 60);
    }
    const face = Math.abs(Math.atan2(Math.sin(pl.yaw - 0.9), Math.cos(pl.yaw - 0.9))) < 0.2;
    // 撞牆拉近：機體正後方放一道牆
    pl.pos.set(0, y0, 0);
    pl.vel.set(0, 0, 0);
    g.fpYaw = 0;
    const wall = { kind: 'box', x: 0, z: 4, w: 12, d: 1, top: y0 + 40, y: y0 - 2 };
    g.world.obstacles.push(wall);
    cam(30);
    const dWall = g.chDist;
    g.world.obstacles.splice(g.world.obstacles.indexOf(wall), 1);
    cam(150);
    const dFree = g.chDist;
    // V：俯視 → 追尾 → 第一人稱 → 俯視
    g.setView('top', true);
    const seq = [];
    for (let i = 0; i < 3; i++) {
      g.cycleView();
      seq.push(g.viewName());
    }
    // 預設視角
    const v0 = g.ctrl.view;
    g.ctrl.view = 'chase';
    g.viewReset();
    const def = g.chase && !g.fp;
    g.ctrl.view = v0;
    g.viewReset();
    const back = !g.chase && !g.fp;
    g.clearMission();
    g.state = 'title';
    return {
      behind,
      below,
      s0: [Math.round(s0.x), Math.round(s0.y)],
      sR: Math.round(sR.x - s1.x),
      sU: Math.round(s1.y - sU.y),
      dF: +(dF - d0).toFixed(2),
      back0: Math.hypot(s1.x - s0.x, s1.y - s0.y) < 4,
      onScr2,
      first,
      order: order.join(','),
      boxOnly,
      kept,
      switched,
      assistAim,
      flick,
      face,
      dWall: +dWall.toFixed(2),
      dFree: +dFree.toFixed(2),
      seq: seq.join(','),
      def,
      back,
    };
  });
  check(r.behind && r.below, `鏡頭在機體後上方、機體在畫面中央偏下（${r.s0}）`);
  check(
    r.sR > 40 && r.sU > 20 && r.dF > 1 && r.back0,
    `速度偏移：往右 → 畫面右移 ${r.sR}px、往上 → 上移 ${r.sU}px、往前衝 → 遠 ${r.dF} m，停下回到原位`,
  );
  check(r.first && r.boxOnly && r.onScr2, `鎖定框：先鎖正前方的、框外的（畫面內）不鎖定（${r.order}）`);
  check(r.kept && r.switched, '鎖定的目標離開框一段時間後換成框裡的');
  check(r.assistAim && r.flick, '目標輔助：鏡頭轉向目標、甩動換到右邊的目標');
  check(r.face, '機體面向準星的方向');
  check(r.dWall < 4 && r.dFree > 7.5, `撞牆拉近：後方有牆 ${r.dWall} m、沒有時回到 ${r.dFree} m`);
  check(r.seq === 'chase,fp,top' && r.def && r.back, `V 依序切換（${r.seq}）、預設視角可以是追尾`);
  // 畫面截圖：電腦、平板、手機（觸控時目標輔助自動開啟）
  const shot = async (pg, name, touch) => {
    const o = await pg.evaluate((touch) => {
      const g = window.__game;
      g.save.level = 2;
      g.startMission();
      const pl = g.player;
      pl.hp = pl.maxHp = 1e7;
      if (touch) g.touchActive = true;
      g.setView('chase', true);
      g.fpYaw = pl.yaw;
      const e = g.enemies[0];
      const fwd = new THREE.Vector3(-Math.sin(pl.yaw), 0, -Math.cos(pl.yaw));
      const q = pl.pos.clone().addScaledVector(fwd, 30);
      e.pos.set(q.x, g.world.terrainHeight(q.x, q.z), q.z);
      pl.lock = e;
      return { assist: g.assistOn(), btn: !!document.querySelector('#vpad [data-a="view"]') };
    }, touch);
    await wait(1500);
    await pg.screenshot({ path: path.join(SHOT_DIR, name) });
    await pg.evaluate(() => {
      const g = window.__game;
      g.clearMission();
      g.state = 'title';
      g.showScreen('title');
    });
    return o;
  };
  await shot(page, 'chase-desktop.png', false);
  await ctx.close();
  for (const [w, h, tag] of [
    [1180, 820, 'tablet'],
    [844, 390, 'phone'],
  ]) {
    const c2 = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    watch(pg, 'chase-' + tag);
    await pg.goto(base + '?test');
    await waitVisible(pg, 'title');
    const o = await shot(pg, `chase-${tag}.png`, true);
    check(
      o.assist && o.btn,
      `${tag === 'tablet' ? '平板' : '手機'}：追尾視角可用（觸控自動目標輔助、視角按鈕）`,
    );
    await c2.close();
  }
}

// 手把操作選單：模擬手把（navigator.getGamepads），十字鍵移動焦點、A 決定、B 返回、LB／RB 分頁、左右改下拉選單、
// 模組三選一、確認視窗、暫停；各選單畫面都有可以操作的元素
async function testPadUi(browser, base) {
  console.log('手把操作選單：焦點移動、A／B、分頁、下拉選單、模組三選一、確認視窗、暫停、各畫面');
  const { ctx, page } = await newPage(browser, 'padui');
  await ctx.addInitScript(() => {
    const mk = () => ({ pressed: false, value: 0 });
    window.__pad = {
      id: 'test pad',
      index: 0,
      connected: true,
      mapping: 'standard',
      buttons: Array.from({ length: 17 }, mk),
      axes: [0, 0, 0, 0],
    };
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      value: () => [window.__pad],
      configurable: true,
    });
  });
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 按下到遊戲讀到兩次再放開（畫面更新慢時也不會漏掉）
  const frames = async (n) => {
    const n0 = await page.evaluate(() => window.__game.puN || 0);
    await page.waitForFunction((t) => (window.__game.puN || 0) >= t, n0 + n, { timeout: 20000 });
  };
  const press = async (i) => {
    await page.evaluate((i) => (window.__pad.buttons[i].pressed = true), i);
    await frames(2);
    await page.evaluate((i) => (window.__pad.buttons[i].pressed = false), i);
    await frames(2);
  };
  const foc = () =>
    page.evaluate(() => {
      const e = document.querySelector('.padFocus');
      return e ? e.id || e.textContent.trim().slice(0, 16) : null;
    });
  const focusId = (id) =>
    page.evaluate((id) => window.__game.padUiFocus(document.getElementById(id), true), id);
  // 標題：按一下就出現焦點，往下移動
  await press(13);
  const f0 = await foc();
  await press(13);
  const f1 = await foc();
  const hint = await page.evaluate(() => document.getElementById('padHint').classList.contains('on'));
  check(!!f0 && !!f1 && f0 !== f1 && hint, `標題：十字鍵移動焦點（${f0} → ${f1}）、顯示手把說明`);
  // A：開設定；在下拉選單上按右改值；B 關閉
  await focusId('btnSettings');
  await press(0);
  const st1 = await page.evaluate(() => window.__game.state);
  const v0 = await page.evaluate(() => document.getElementById('ctrlView').value);
  await focusId('ctrlView');
  await press(15);
  const v1 = await page.evaluate(() => [document.getElementById('ctrlView').value, window.__game.ctrl.view]);
  await press(14);
  await press(1);
  const st2 = await page.evaluate(() => window.__game.state);
  check(
    st1 === 'settings' && v1[0] !== v0 && v1[1] === v1[0] && st2 === 'title',
    `A 開啟設定、左右改下拉選單（${v0} → ${v1[0]}）、B 返回標題`,
  );
  // 關卡選單：RB 換分頁
  await page.evaluate(() => window.__game.openLevels());
  await waitVisible(page, 'levels');
  await press(13);
  const t0 = await page.evaluate(() => window.__game.lvTab);
  await press(5);
  const t1 = await page.evaluate(() => window.__game.lvTab);
  await press(1);
  const st3 = await page.evaluate(() => window.__game.state);
  check(t0 !== t1 && st3 === 'title', `RB 切換分頁（${t0} → ${t1}）、B 回標題`);
  // 機甲庫：LB／RB 換部位
  await page.evaluate(() => window.__game.openGarage());
  await waitVisible(page, 'garage');
  await press(13);
  const g0 = await page.evaluate(() => window.__game.garageSlot);
  await press(5);
  const g1 = await page.evaluate(() => window.__game.garageSlot);
  check(g0 !== g1, `機甲庫：RB 換部位（${g0} → ${g1}）`);
  // 模組三選一：焦點在第一張卡、往右換、A 選擇
  await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1s1');
    g.camp.types[0] = 'battle';
    g.campEnterSeg();
    g.campOpenPick('castron');
  });
  await frames(3); // 開了新視窗：焦點自動移到第一張卡片
  const fi = () =>
    page.evaluate(() => {
      const e = document.querySelector('.padFocus');
      return e && (e.dataset.i || '#' + (e.id || e.className || e.textContent.slice(0, 10)));
    });
  const m0 = await fi();
  await press(15);
  const m1 = await fi();
  await page.screenshot({ path: path.join(SHOT_DIR, 'pad-modpick.png') });
  const n0 = await page.evaluate(() => window.__game.campMods().length);
  await press(0);
  const mk = await page.evaluate(() => ({
    on: document.getElementById('modPick').classList.contains('on'),
    st: window.__game.state,
    n: window.__game.campMods().length,
  }));
  check(
    m0 === '0' && m1 === '1' && !mk.on && mk.st === 'play' && mk.n === n0 + 1,
    `模組三選一：焦點在第一張（${m0}）、往右換（${m1}）、A 選擇並回到戰鬥`,
  );
  // 暫停：Start 暫停、B 繼續
  await press(9);
  const p1 = await page.evaluate(() => window.__game.state);
  await press(13);
  const pf = await foc();
  await press(1);
  const p2 = await page.evaluate(() => window.__game.state);
  check(p1 === 'pause' && !!pf && p2 === 'play', `暫停選單：Start 暫停、焦點（${pf}）、B 繼續`);
  // 確認視窗：A 確定、B 取消
  await page.evaluate(() => {
    const g = window.__game;
    g.state = 'pause';
    g.showScreen('pause');
    window.__ok = 0;
    g.uiConfirm('測試', () => (window.__ok = 1));
  });
  await frames(3);
  await press(0);
  const ok1 = await page.evaluate(() => [window.__ok, !!window.__game.uiModalOn]);
  await page.evaluate(() => {
    window.__ok = 0;
    window.__game.uiConfirm('測試', () => (window.__ok = 1));
  });
  await frames(3);
  await press(1);
  const ok2 = await page.evaluate(() => [window.__ok, !!window.__game.uiModalOn, window.__game.state]);
  check(
    ok1[0] === 1 && !ok1[1] && ok2[0] === 0 && !ok2[1] && ok2[2] === 'pause',
    '確認視窗：A 確定、B 取消（不關掉底下的暫停選單）',
  );
  // 放棄紀錄點改用確認視窗（手把按得到）
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.campStory().sortie = g.campStory().sortie || { sid: 'c1s1', seg: 0 };
    g.openHub();
    g.campDrop();
  });
  const drop = await page.evaluate(() => !!window.__game.uiModalOn && !!window.__game.campStory().sortie);
  await frames(3);
  await press(0);
  const drop2 = await page.evaluate(() => !window.__game.uiModalOn && !window.__game.campStory().sortie);
  check(drop && drop2, '作戰室：放棄紀錄點的確認視窗用手把確定');
  // 各選單畫面都有可以操作的元素、有預設焦點
  const scr = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    const t = (name, open) => {
      try {
        open();
      } catch (e) {
        out.push(name + '!' + e.message);
        return;
      }
      const C = g.padUiCands();
      const d = g.padUiDefault(C);
      out.push(name + ':' + C.length + (d ? '' : '?'));
    };
    const go = (st, id) => () => {
      g.state = st;
      g.showScreen(id);
    };
    t('title', go('title', 'title'));
    t('saves', () => g.openSaves());
    t('garage', () => g.openGarage());
    t('pilot', () => g.openPilot());
    t('hub', () => g.openHub());
    t('brief', () => g.openBrief('c1s1'));
    t('sim', () => g.openSim());
    t('record', () => g.openRecord());
    t('range', () => g.openRangeMenu());
    t('settings', () => g.openSettings('title'));
    t('mp', () => g.openMP());
    t('levels', () => g.openLevels());
    t('rtsMenu', () => g.rtsMenuOpen());
    t('rtsHelp', () => (g.rtsMenuOpen(), g.rtsMenuHelp(true)));
    t('result', go('result', 'result'));
    t('campTrans', go('camptrans', 'campTrans'));
    t('campFail', go('campfail', 'campFail'));
    t('epilogue', () => g.openEpilogue('open'));
    t('pause', go('pause', 'pause'));
    g.state = 'title';
    g.showScreen('title');
    return out;
  });
  const bad = scr.filter((s) => /!|\?|:0$/.test(s));
  check(!bad.length, `各畫面都能用手把操作（${scr.join('、')}）`);
  // 改用滑鼠時焦點框消失
  await page.mouse.move(200, 200);
  await page.mouse.move(260, 240);
  await wait(200);
  check(!(await foc()), '移動滑鼠時拿掉手把的焦點框');
  await ctx.close();
}

// 第三人稱鏡頭的遮擋：地形擋住時鏡頭往上轉、物件淡出、還是被擋住時顯示機體的透視輪廓
async function testCamOcclusion(browser, base) {
  console.log('鏡頭遮擋：地形抬高鏡頭、物件淡出、透視輪廓');
  const { ctx, page } = await newPage(browser, 'camocc');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    localStorage.setItem('rubicon_map', 'industrial'); // 集散場的起重機沒有登記成遮擋物
    localStorage.setItem('rubicon_variant', 'base');
    const g = window.__game;
    g.save.level = 1;
    g.startMission();
    g.state = 'cam-test';
    const w = g.world,
      pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const dt = 1 / 60;
    const xray = () => {
      let op = 0;
      pl.mesh.traverse((o) => {
        if (o.userData.xray) op = o.material.visible ? o.material.opacity : 0;
      });
      return op;
    };
    const put = (x, z) => {
      pl.pos.set(x, w.groundAt(x, z, 99), z);
      pl.vel.set(0, 0, 0);
      pl.mesh.position.copy(pl.pos);
      g.camTarget.set(x, pl.pos.y + 1.5, z);
      g.camera.position.copy(g.camTarget).add(new THREE.Vector3(0, 30, 17.5));
      g.camPitch = 0;
      g.camDistK = 1;
    };
    const run = (n) => {
      for (let i = 0; i < n; i++) g.updateCamera(dt);
    };
    const base = Math.atan2(30, 17.5);
    const out = {};
    const L = w.lim * 0.9;
    // 地形：在機體南邊（鏡頭那一側）暫時立一道 20 m 高的地形牆
    // 找一塊周圍沒有障礙物與大型網格的平地（隨機地圖上，測試用的方塊才不會放到別的物件上）
    const clear = (cx, cz) => {
      if (w.obstacles.some((o) => Math.abs(o.x - cx) < 10 && o.z > cz - 8 && o.z < cz + 14)) return false;
      if (
        w.obstacles.some(
          (o) =>
            o.box &&
            o.box.max.x > cx - 8 &&
            o.box.min.x < cx + 8 &&
            o.box.max.z > cz - 6 &&
            o.box.min.z < cz + 12,
        )
      )
        return false;
      const h0 = w.terrainHeight(cx, cz);
      for (let dx = -8; dx <= 8; dx += 4)
        for (let dz = -6; dz <= 12; dz += 3)
          if (w.isVoid(cx + dx, cz + dz) || Math.abs(w.terrainHeight(cx + dx, cz + dz) - h0) > 2.5)
            return false;
      return true;
    };
    let sp0 = null;
    for (let x = -L; x <= L && !sp0; x += 6)
      for (let z = -L; z <= L - 14 && !sp0; z += 6) if (clear(x, z)) sp0 = { x, z };
    out.clearSpot = !!sp0;
    if (!sp0) sp0 = w.safePoint();
    put(sp0.x, sp0.z);
    const th0 = w.terrainHeight.bind(w);
    const wallZ = [sp0.z + 3, sp0.z + 9],
      y0 = pl.pos.y;
    w.terrainHeight = (x, z) => (z > wallZ[0] && z < wallZ[1] ? y0 + 20 : th0(x, z));
    run(180);
    out.spot = true;
    out.pitch = g.camPitch - base;
    out.clear = !w.terrainBlocks(g.camera.position, g.camTarget);
    out.pitchMax = g.camPitch;
    // 牆高到轉到上限也擋住：鏡頭拉近
    w.terrainHeight = (x, z) => (z > wallZ[0] && z < wallZ[1] ? y0 + 120 : th0(x, z));
    run(180);
    out.distK = g.camDistK;
    w.terrainHeight = th0;
    run(240);
    // 鎖定很遠的敵人：鏡頭只拉到上限（預設 1.8 倍），霧跟著往外推
    const far = g.enemies.find((e) => !e.dead) || g.spawnType('mt', 1, 1);
    far.pos.set(sp0.x + 140, w.groundAt(sp0.x + 140, sp0.z, 99), sp0.z);
    pl.lock = far;
    run(240);
    out.zoom = +g.camZoom.toFixed(2);
    out.extra = +g.camExtra.toFixed(1);
    g.stylePipe.applyScene(g.styleP, 0);
    out.fogPush = g.scene.fog ? +(g.scene.fog.near - g.stylePipe.base.near * g.styleP.fogK).toFixed(1) : -1;
    pl.lock = null;
    // 滾輪拉近／拉遠（上限是設定）
    g.state = 'play';
    window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100 }));
    window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100 }));
    out.userIn = +(g.camUser || 1).toFixed(2);
    for (let i = 0; i < 20; i++) window.dispatchEvent(new window.WheelEvent('wheel', { deltaY: 100 }));
    out.userOut = +(g.camUser || 1).toFixed(2);
    g.state = 'cam-test';
    g.camUser = 1;
    run(240);
    // 物件：機體放在大型物件的北邊（鏡頭在南邊 +Z）
    // 登記成遮擋物的物件：在機體南邊放一個 10 m 高的方塊（addSmall 會登記成 occluder）
    const g0 = new THREE.Group();
    const bx = new THREE.Mesh(
      new THREE.BoxGeometry(6, 14, 3),
      new THREE.MeshStandardMaterial({ color: 0x888888, transparent: true }),
    );
    bx.position.y = 7;
    g0.add(bx);
    const ob = w.addSmall(g0, sp0.x, w.terrainHeight(sp0.x, sp0.z), sp0.z + 3.5, { w: 6, h: 14, d: 3 });
    out.ob = !!ob;
    if (ob) {
      put(sp0.x, sp0.z);
      run(120);
      out.fade = +ob.mats[0].opacity.toFixed(2);
      out.xray = +xray().toFixed(2);
    }
    // 空曠的地方：剛才那塊平地（先拿掉測試的方塊）
    w.occluders.splice(w.occluders.indexOf(ob), 1);
    w.obstacles.splice(w.obstacles.indexOf(ob), 1);
    g.scene.remove(g0);
    w.meshes.splice(w.meshes.indexOf(g0), 1);
    const open = [sp0.x, sp0.z];
    // 沒有登記成遮擋物的網格（大型結構等）：在空曠處的南邊放一個只加進 meshes 的方塊
    const um = new THREE.Mesh(
      new THREE.BoxGeometry(6, 14, 3),
      new THREE.MeshStandardMaterial({ color: 0x8a6a4a }),
    );
    um.position.set(open[0], w.terrainHeight(open[0], open[1]) + 7, open[1] + 3.5);
    g.scene.add(um);
    um.updateMatrixWorld(); // 測試不經過繪製，自己更新世界矩陣
    w.meshes.push(um);
    const mesh = [um, open[0], open[1]];
    window.__camOpen = open;
    out.mesh = !!mesh;
    if (mesh) {
      const orig = mesh[0].material;
      put(mesh[1], mesh[2]);
      run(60);
      out.meshFade = mesh[0].material !== orig && mesh[0].material.opacity < 0.4;
      out.meshDbg = JSON.stringify({
        hit: w._fadeHit ? w._fadeHit.size : -1,
        cam: g.camera.position.toArray().map((v) => +v.toFixed(1)),
        um: um.position.toArray().map((v) => +v.toFixed(1)),
        pl: pl.pos.toArray().map((v) => +v.toFixed(1)),
        fp: !!g.fp,
        zoom: +g.camZoom.toFixed(2),
        k: +(g.camDistK || 1).toFixed(2),
        pitch: +(g.camPitch || 0).toFixed(2),
      });
      out.meshXray = +xray().toFixed(2);
      um.visible = false;
      run(120);
      out.meshBack = mesh[0].material === orig;
    }
    put(open[0], open[1]);
    run(240);
    out.back = +(g.camPitch - base).toFixed(3);
    out.xray2 = +xray().toFixed(2);
    return out;
  });
  check(
    r.spot && r.pitch > 0.05,
    `地形擋住時鏡頭往上轉（+${(r.pitch || 0).toFixed(2)} rad；緊貼的高牆看不到時交給透視輪廓）`,
  );
  check(
    r.pitchMax <= 1.32 && r.distK < 0.9,
    `地形擋住時鏡頭最多轉到約 75°（${r.pitchMax.toFixed(2)} rad），還是擋住就拉近（${r.distK.toFixed(2)}）`,
  );
  check(
    r.zoom <= 1.81 && r.extra > 10 && Math.abs(r.fogPush - r.extra) < 0.6,
    `鎖定 140 m 外的敵人：鏡頭只拉到 ${r.zoom} 倍、霧往外推 ${r.fogPush} m（鏡頭遠出 ${r.extra} m）`,
  );
  check(r.userIn < 1 && r.userOut === 1.8, `滾輪調整鏡頭距離（拉近 ${r.userIn}、拉遠到上限 ${r.userOut}）`);
  check(r.clearSpot, '找到測試用的平地');
  check(
    r.ob && r.fade < 0.4 && r.xray > 0.3,
    `機體在大型物件後面：物件淡出（${r.fade}）、顯示透視輪廓（${r.xray}）`,
  );
  check(
    r.mesh && r.meshFade && r.meshXray > 0.3 && r.meshBack,
    `沒有登記的大型結構擋住時也會淡出（${r.meshFade}）、顯示輪廓（${r.meshXray}），離開後還原材質（${r.meshBack}）` +
      (r.meshFade ? '' : r.meshDbg),
  );
  check(
    Math.abs(r.back) < 0.02 && r.xray2 < 0.05,
    `回到空曠的地方：鏡頭轉回原本的角度（${r.back}）、輪廓消失（${r.xray2}）`,
  );
  // 截圖：機體在方塊後面（透視輪廓）
  await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      pl = g.player;
    for (const e of g.enemies) e.takeDamage(1e9, 0, null, e.center());
    g.waves = [];
    g.wavePend = null;
    const [ox, oz] = window.__camOpen;
    const sp = { x: ox, z: oz };
    pl.pos.set(sp.x, w.groundAt(sp.x, sp.z, 99), sp.z);
    g.camPitch = 0;
    const gr = new THREE.Group();
    const bx = new THREE.Mesh(
      new THREE.BoxGeometry(8, 9, 3),
      new THREE.MeshStandardMaterial({ color: 0x777777 }),
    );
    bx.position.set(sp.x + 1.5, w.groundAt(sp.x, sp.z + 4.5, 99) + 4.5, sp.z + 4.5);
    g.scene.add(bx);
    w.meshes.push(bx);
    g.state = 'play';
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'cam-occlusion.png') });
  await ctx.close();
}

// 作戰區域邊界：玩家超出 ±lim 時警告並推回（最遠到 limOut），電腦機體停在 ±lim
async function testBoundary(browser, base) {
  console.log('作戰區域邊界：警告、推回、電腦機體不出界');
  const { ctx, page } = await newPage(browser, 'bound');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 1;
    g.startMission();
    g.state = 'bound-test';
    const w = g.world,
      pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const dt = 1 / 60;
    const x0 = w.lim + 8;
    pl.pos.set(x0, w.groundAt(x0, 0, 99) + 0.1, 0);
    pl.vel.set(0, 0, 0);
    g.drawHud(dt);
    const warn = document.getElementById('oob').classList.contains('on');
    // 一直往外推（按著往外走）：不會超過 limOut，最後被推回
    let maxX = 0;
    for (let i = 0; i < 240; i++) {
      pl.move(dt, new THREE.Vector3(1, 0, 0), false, false, false, null);
      maxX = Math.max(maxX, pl.pos.x);
    }
    const held = pl.pos.x;
    for (let i = 0; i < 240; i++) pl.move(dt, new THREE.Vector3(), false, false, false, null);
    const back = pl.pos.x;
    g.drawHud(dt);
    const off = !document.getElementById('oob').classList.contains('on');
    // 電腦機體：停在 ±lim
    const e = g.enemies.find((x) => !x.dead && !x.isBoss && x.move);
    e.pos.set(w.lim + 6, w.groundAt(w.lim, 5, 99), 5);
    e.move(dt, new THREE.Vector3(1, 0, 0), false, false, false, null);
    const ai = e.pos.x <= w.lim + 1e-6;
    g.clearMission();
    g.state = 'title';
    return { warn, maxX, held, back, off, ai, lim: w.lim, out: w.limOut };
  });
  check(r.warn, '超出作戰區域時顯示警告');
  check(
    r.maxX <= r.out + 1e-6 && r.held < r.lim + 8 && r.back <= r.lim + 0.5 && r.off,
    `按著往外走也被推回（最遠 ${r.maxX.toFixed(1)}／上限 ${r.out.toFixed(0)}、按住時 ${r.held.toFixed(1)}、放開後 ${r.back.toFixed(1)}，作戰區域 ±${r.lim.toFixed(0)}）、回到場內警告消失`,
  );
  check(r.ai, '電腦機體停在作戰區域邊界');
  await ctx.close();
}

// 主線任務模式第 1 期（game/campaign.js）：區段鏈、地圖上的出口、轉場、轉場整備、紀錄點、狀態延續、失敗重試、結束
async function testCampaign(browser, base) {
  console.log('主線出擊：區段、出口、轉場、整備、紀錄點、失敗重試、完成');
  const { ctx, page } = await newPage(browser, 'camp');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true)); // 戰術模組直接選第一個（testModules 另外測）
  await page.evaluate(() => window.__game.openGarage());
  await waitVisible(page, 'garage');
  check(
    await page.evaluate(
      () =>
        getComputedStyle(document.getElementById('btnCamp')).display !== 'none' &&
        getComputedStyle(document.getElementById('btnSortie')).display !== 'none' &&
        document.getElementById('gCtx').textContent === '自由出擊',
    ),
    '機甲庫（自由出擊）：有「自由出擊」與「前往作戰室」按鈕，標示自由出擊',
  );
  // 機庫 → 總覽圖 → 簡報 → 出擊
  await page.click('#btnCamp');
  check(await waitVisible(page, 'hub'), '進入主線機庫');
  const nodes = await page.$$eval('.hubNode', (l) => l.map((n) => n.dataset.sid + ':' + n.classList[1]));
  check(
    nodes.includes('c1s1:open') && nodes.includes('c1s2:locked'),
    '總覽圖：第 1 個委託可以接、第 2 個要先完成前一個（' + nodes.join('、') + '）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-hub.png') });
  await page.click('.hubNode[data-sid="c1s2"]');
  check(!(await visible(page, 'brief')), '鎖住的委託不能開簡報');
  await page.click('.hubNode[data-sid="c1s1"]');
  check(await waitVisible(page, 'brief'), '點委託開啟簡報');
  const br = await page.evaluate(() => ({
    t: document.getElementById('brTitle').textContent,
    lines: document.querySelectorAll('#brLines p').length,
    route: document.querySelectorAll('#brRoute .brSeg').length,
  }));
  check(br.t.includes('礦坑突破') && br.lines >= 2 && br.route === 5, '簡報：委託方、內容與 5 段預定路線');
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-brief.png') });
  await page.click('#btnBriefGo');
  check(await waitVisible(page, 'campTrans'), '開始出擊：顯示空降轉場');
  await page.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await page.click('#btnCampGo');
  // 清除目前區段：敵人全滅、沒有增援
  const clear = () =>
    page.evaluate(() => {
      const g = window.__game;
      g.waves = [];
      g.wavePend = null; // 已預告、還沒出現的增援也取消
      for (const e of g.enemies)
        if (!e.dead) {
          if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
          e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
        }
    });
  const s0 = await page.evaluate(() => {
    const g = window.__game;
    return {
      st: g.state,
      theme: g.world.theme.key || g.worldTheme,
      seg: g.camp.seg,
      ck: g.save.story.sortie.seg,
    };
  });
  check(
    s0.st === 'play' && s0.theme === 'wasteland' && s0.seg === 0 && s0.ck === 0,
    `進入區段 1（${s0.theme}），紀錄點已存`,
  );
  // 通訊：出擊開始時右下角播放，並寫進通訊紀錄
  check(
    await page
      .waitForFunction(() => document.getElementById('comm').classList.contains('on'), null, {
        timeout: 5000,
      })
      .then(
        () => true,
        () => false,
      ),
    '出擊開始的通訊顯示在右下角',
  );
  check(
    await page.evaluate(() => (window.__game.save.story.log || []).some((l) => l.sp === 'echo')),
    '通訊寫進存檔的通訊紀錄',
  );
  await page.evaluate(() => (window.__game.player.hp = window.__game.player.maxHp * 0.5));
  await clear();
  await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
    timeout: 8000,
  });
  const ex = await page.evaluate(() => {
    const g = window.__game;
    return g.camp.exits.map((e) => ({ r: e.reward, mode: e.mode, x: e.pos.x, z: e.pos.z, lim: g.world.lim }));
  });
  check(
    ex.length >= 2 &&
      new Set(ex.map((e) => e.r)).size === ex.length &&
      ex.every((e) => e.mode === 'relay' && Math.max(Math.abs(e.x), Math.abs(e.z)) < e.lim),
    `區段清除後出現 ${ex.length} 個出口（獎勵各不同：${ex.map((e) => e.r).join('、')}，接力型、在作戰區域內）`,
  );
  // 截圖：玩家走到兩個出口之間、面向第一個出口
  await page.evaluate(() => {
    const g = window.__game,
      e = g.camp.exits[0];
    const p = g.player.pos;
    const L = Math.hypot(e.pos.x, e.pos.z) || 1;
    const dx = e.pos.x - (e.pos.x / L) * 14,
      dz = e.pos.z - (e.pos.z / L) * 14;
    p.set(dx, g.world.terrainHeight(dx, dz), dz);
    g.player.yaw = g.player.aimYaw = Math.atan2(-(e.pos.x - dx), -(e.pos.z - dz));
  });
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-exits.png') });
  // 走進第一個出口（等待中一直放回出口上：被敵人或推回作戰區域推開時不會失敗）
  const left0 = await page
    .waitForFunction(
      () => {
        const g = window.__game;
        if (g.state === 'camptrans') return true;
        const e = g.camp && g.camp.exits[0];
        if (e) {
          g.player.pos.set(e.pos.x, e.pos.y, e.pos.z);
          g.player.vel.set(0, 0, 0);
        }
        return false;
      },
      null,
      { timeout: 20000, polling: 200 },
    )
    .then(
      () => true,
      () => false,
    );
  check(left0 && (await waitVisible(page, 'campTrans', 5000)), '站進出口：出發並顯示轉場');
  const s1 = await page.evaluate(() => {
    const g = window.__game;
    return { seg: g.camp.seg, ck: g.save.story.sortie.seg, pend: g.camp.pending, hp: g.camp.carry.hp };
  });
  check(
    s1.seg === 1 && s1.ck === 1 && s1.pend === ex[0].r && Math.abs(s1.hp - 0.5) < 0.05,
    `紀錄點＝轉場起點（區段 ${s1.seg + 1}、出口獎勵 ${s1.pend}、AP ${Math.round(s1.hp * 100)}%）`,
  );
  // 進車庫整備：修理後繼續作戰
  await page.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-trans.png') });
  await page.click('#btnCampGarage');
  await waitVisible(page, 'garage');
  await wait(500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-garage.png') });
  const gUi = await page.evaluate(() => {
    const d = (id) => getComputedStyle(document.getElementById(id)).display;
    return {
      camp: d('gCamp'),
      sortie: d('btnSortie'),
      rep: document.getElementById('btnCampRepair').disabled,
    };
  });
  check(
    gUi.camp !== 'none' && gUi.sortie === 'none' && !gUi.rep,
    '轉場整備：車庫顯示整備面板（可修理），一般出擊按鈕隱藏',
  );
  const coam0 = await page.evaluate(() => window.__game.save.coam);
  await page.click('#btnCampRepair');
  const rep = await page.evaluate(() => ({ hp: window.__game.camp.carry.hp, coam: window.__game.save.coam }));
  check(rep.hp === 1 && rep.coam < coam0, `修理 AP（花費 ${(coam0 - rep.coam).toLocaleString()} COAM）`);
  await page.click('#btnCampGo2');
  const s2 = await page.evaluate(() => {
    const g = window.__game;
    return { st: g.state, seg: g.camp.seg, hp: g.player.hp / g.player.maxHp };
  });
  check(s2.st === 'play' && s2.seg === 1 && s2.hp > 0.99, '整備後進入區段 2，AP 已修好');
  // 陣亡 → 失敗畫面 → 從紀錄點繼續
  await page.evaluate(() => {
    const g = window.__game;
    g.player.takeDamage(1e9, 0, null, g.player.center(), new THREE.Vector3(0, 0, 1));
  });
  check(await waitVisible(page, 'campFail', 8000), 'AC 被擊破：回到失敗畫面');
  check(
    await page.evaluate(() => document.querySelectorAll('#cfComm .cLine').length > 0),
    '失敗畫面顯示管制官的通訊',
  );
  await page.click('#btnCampRetry');
  await page.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await page.click('#btnCampGo');
  const s3 = await page.evaluate(() => {
    const g = window.__game;
    return { st: g.state, seg: g.camp.seg, fails: g.camp.fails, alive: !g.player.dead };
  });
  check(s3.st === 'play' && s3.seg === 1 && s3.fails === 1 && s3.alive, '從紀錄點繼續：回到區段 2 的起點');
  // 暫停選單的「保存並回作戰室」：紀錄點留著，作戰室「繼續出擊」接回同一段
  await page.evaluate(() => {
    const g = window.__game;
    g.state = 'pause';
    g.showScreen('pause');
  });
  check(await visible(page, 'btnSuspend'), '暫停選單有「保存並回作戰室」');
  await page.click('#btnSuspend');
  await waitVisible(page, 'hub');
  const sp = await page.evaluate(() => {
    const g = window.__game;
    return { camp: !!g.camp, ck: g.save.story.sortie && g.save.story.sortie.seg, hud: !!g.player };
  });
  check(
    !sp.camp && sp.ck === 1 && (await visible(page, 'hubActive')),
    `保存並回作戰室：紀錄點保留（區段 ${sp.ck + 1}）、作戰室顯示進行中的出擊`,
  );
  await page.click('#btnHubResume');
  await page.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await page.click('#btnCampGo');
  const s3b = await page.evaluate(() => ({ st: window.__game.state, seg: window.__game.camp.seg }));
  check(s3b.st === 'play' && s3b.seg === 1, '作戰室「繼續出擊」：接回區段 2 的起點');
  // 第 4 段（礦場外圍）往礦坑深處：垂直下降型出口（在場內）
  await page.evaluate(() => {
    const g = window.__game;
    g.camp.seg = 3;
    g.camp.types[3] = 'battle';
    g.campEnterSeg();
  });
  await clear();
  await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
    timeout: 8000,
  });
  const down = await page.evaluate(() => window.__game.camp.exits.every((e) => e.mode === 'down'));
  check(down, '礦場外圍 → 礦坑深處的出口是垂直下降型');
  // 重新整理：從標題的「主線」進機庫，顯示進行中的出擊（紀錄點存在存檔裡）
  await page.reload();
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  await page.click('#btnStory');
  await waitVisible(page, 'hub');
  check(await visible(page, 'hubActive'), '重新整理後機庫顯示進行中的出擊（紀錄點存在存檔裡）');
  await page.click('#btnHubLog');
  check(
    await page.evaluate(() => document.querySelectorAll('#hubLogList .hubLogRow').length > 0),
    '機庫的通訊紀錄列出播過的通訊',
  );
  await page.click('#btnHubLogClose');
  // 最後一段：Boss 擊破 → 出擊完成
  await page.evaluate(() => {
    const g = window.__game;
    g.campRestore();
    g.camp.seg = 4;
    g.campCheckpoint();
    g.campEnterSeg();
  });
  const boss = await page.evaluate(() => ({ boss: !!window.__game.boss, theme: window.__game.worldTheme }));
  check(boss.boss && boss.theme === 'desert', '最後一段是礦坑的 Boss 區段');
  await clear();
  check(await waitVisible(page, 'result', 10000), 'Boss 擊破：出擊完成並顯示結果');
  const fin = await page.evaluate(() => ({
    t: document.getElementById('rTitle').textContent,
    done: window.__game.save.story.done.c1s1,
    ck: window.__game.save.story.sortie,
    camp: window.__game.camp,
  }));
  check(
    fin.t === '主線出擊 完成' && fin.done === 1 && !fin.ck && !fin.camp,
    '結果：完成紀錄寫入存檔、紀錄點清除',
  );
  await page.click('#btnResultOk');
  check(await waitVisible(page, 'hub'), '結果畫面「返回作戰室」');
  const nodes2 = await page.$$eval('.hubNode', (l) => l.map((n) => n.dataset.sid + ':' + n.classList[1]));
  check(
    nodes2.includes('c1s1:done') && nodes2.includes('c1s2:open'),
    '完成後第 2 個委託開放（' + nodes2.join('、') + '）',
  );
  // 機甲庫：從作戰室進入時只有「返回作戰室」，沒有自由出擊與前往作戰室（避免按錯）
  await page.click('#btnHubGarage');
  await waitVisible(page, 'garage');
  const hg = await page.evaluate(() => {
    const vis = (id) => getComputedStyle(document.getElementById(id)).display !== 'none';
    return {
      back: document.getElementById('btnToTitle').textContent,
      sortie: vis('btnSortie'),
      camp: vis('btnCamp'),
      map: vis('gMap'),
      ctx: document.getElementById('gCtx').textContent,
      card: document.getElementById('mcTitle').textContent,
    };
  });
  check(
    hg.back === '返回作戰室' &&
      !hg.sortie &&
      !hg.camp &&
      !hg.map &&
      hg.ctx === '主線整備' &&
      hg.card === '主線整備',
    '從作戰室進機甲庫：只有「返回作戰室」、沒有自由出擊與地圖選單、標示主線整備（' +
      JSON.stringify(hg) +
      '）',
  );
  await page.click('#btnToTitle');
  check(await waitVisible(page, 'hub'), '機甲庫返回作戰室');
  // 駕駛員：從作戰室開的返回按鈕是「返回作戰室」
  await page.click('#btnHubPilot');
  await waitVisible(page, 'pilot');
  check(
    (await page.textContent('#btnPilotBack')) === '返回作戰室',
    '從作戰室開駕駛員：返回按鈕是「返回作戰室」',
  );
  await page.click('#btnPilotBack');
  await waitVisible(page, 'hub');
  // 作戰室的「回標題」
  await page.click('#btnHubBack');
  check(await waitVisible(page, 'title'), '作戰室「回標題」回到標題畫面');
  await ctx.close();
}

// 主線第 2 期：區段類型、主題變體、地標、入口結構、時間與深度、作戰區域形狀、排程不重複、自由出擊的變體選單
async function testCampaign2(browser, base) {
  console.log('主線區段類型與地圖多樣化：破壞、防衛、護送、突破、補給、情報、精英、變體、地標、作戰區域');
  const { ctx, page } = await newPage(browser, 'camp2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 排程：同一次出擊的「變體＋地標」不重複，最後一段 Boss 用限定的開闊變體
  const plan = await page.evaluate(() => {
    const g = window.__game;
    g.campBegin();
    const c = g.camp;
    const keys = [];
    c.plan.forEach((p, i) => {
      const th = g.campSortie().segs[i].theme;
      if (p.variant) keys.push(th + '|' + p.variant);
      if (p.landmark) keys.push(th + '|' + p.landmark);
    });
    return {
      dup: keys.length !== new Set(keys).size,
      boss: c.plan[4].variant,
      border: c.plan[3].variant,
      depth: c.plan.map((p) => p.depth),
    };
  });
  check(
    !plan.dup && ['openpit', 'shaft'].includes(plan.boss) && plan.border === 'outskirts',
    '排程：變體與地標不重複、交界區段是礦場外圍、Boss 區段用開闊變體（' + plan.boss + '）',
  );
  check(plan.depth[4] === 1 && plan.depth[3] === 0, '深度：礦坑往下一段 +1（' + plan.depth.join(',') + '）');
  // 進入指定類型的區段（直接設定，不經過轉場）
  const enter = (type, seg = 1, extra = {}) =>
    page.evaluate(
      ([type, seg, extra]) => {
        const g = window.__game,
          c = g.camp;
        c.seg = seg;
        c.types[seg] = type;
        Object.assign(c.plan[seg], extra);
        g.campEnterSeg();
        g.player.hp = g.player.maxHp = 1e7;
        return {
          st: g.state,
          type: c.ss.type,
          enemies: g.enemies.filter((e) => !e.dead).length,
          allies: g.allies.length,
          exits: c.exits.length,
          zone: g.world.zone.slice(),
          lim: g.world.lim,
        };
      },
      [type, seg, extra],
    );
  const killAll = () =>
    page.evaluate(() => {
      const g = window.__game;
      g.waves = [];
      g.wavePend = null; // 已預告、還沒出現的增援也取消
      for (const e of g.enemies)
        if (!e.dead) {
          if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
          e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
        }
    });
  // 等出口出現（等待中持續清掉運輸機投放的增援；kill＝false 時不動敵人）
  const exitsUp = (ms = 8000, kill = true) =>
    page
      .waitForFunction(
        (kill) => {
          const g = window.__game;
          if (kill && g.camp && !g.camp.exits.length) {
            g.waves = [];
            g.wavePend = null; // 已預告、還沒出現的增援也取消
            for (const e of g.enemies)
              if (!e.dead) {
                if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
                e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
              }
          }
          return g.camp && g.camp.exits.length >= 2;
        },
        kill,
        { timeout: ms, polling: 300 },
      )
      .then(
        () => true,
        () => false,
      );
  // 破壞
  const d = await enter('destroy', 1, { zone: 'full' });
  const tg = await page.evaluate(() => window.__game.camp.ss.targets.map((e) => e.ai + ':' + e.team));
  check(
    d.st === 'play' && tg.length >= 3 && tg.every((t) => t === 'objective:enemy'),
    '破壞：' + tg.length + ' 個目標設施（不動、可擊破）＋護衛',
  );
  await killAll();
  check(await exitsUp(), '破壞：目標與敵軍全滅後開出口');
  const exT = await page.evaluate(() => window.__game.camp.exits.map((e) => e.type));
  check(
    exT.every((t) => ['supply', 'escort', 'breakthrough', 'elite'].includes(t)),
    '出口預告下一段的類型（' + exT.join('、') + '）',
  );
  // 補給：站上補給台回復
  await enter('supply', 2);
  const sup = await page.evaluate(() => {
    const g = window.__game,
      ss = g.camp.ss;
    g.player.hp = g.player.maxHp * 0.3;
    const h0 = g.player.hp;
    for (let i = 0; i < 40 && !ss.pad.used; i++) {
      g.player.pos.set(ss.pad.pos.x, ss.pad.pos.y, ss.pad.pos.z);
      g.campTick(0.05);
    }
    return { used: ss.pad.used, up: g.player.hp > h0 };
  });
  check(sup.used && sup.up, '補給：站上補給台回復 AP、彈藥與修復套件');
  check(await exitsUp(), '補給：沒有敵人，直接開出口');
  // 情報：敵人全滅後還要下載完才算清除
  await enter('intel', 1, { zone: 'full' });
  await killAll();
  await wait(800);
  const in0 = await page.evaluate(() => ({
    cleared: window.__game.camp.cleared,
    ex: window.__game.camp.exits.length,
  }));
  await page.evaluate(() => {
    const g = window.__game,
      it = g.camp.ss.intel;
    for (let i = 0; i < 100 && !it.done; i++) {
      g.player.pos.set(it.pos.x, it.pos.y, it.pos.z);
      g.campTick(0.05);
    }
  });
  check(!in0.cleared && !in0.ex && (await exitsUp()), '情報：敵人全滅後還要下載情報才開出口');
  // 防衛：防衛目標被毀 → 失敗
  const df = await enter('defend', 1);
  check(df.allies === 1 && df.enemies > 0, '防衛：友方防衛目標＋來襲敵軍');
  await page.evaluate(() => {
    const g = window.__game,
      t = g.camp.ss.defend;
    t.takeDamage(1e9, 0, g.enemies[0], t.center(), new THREE.Vector3(0, 0, 1));
  });
  check(await waitVisible(page, 'campFail', 10000), '防衛目標被摧毀：任務失敗、回到失敗畫面');
  await page.evaluate(() => window.__game.campRestore());
  // 護送：一定有公路、三台車；全部抵達後清除
  const es = await enter('escort', 2, { variant: 'junction' });
  const cv = await page.evaluate(() => {
    const g = window.__game;
    return { road: g.world.corridor && g.world.corridor.kind, n: g.camp.ss.convoy.length };
  });
  check(cv.road === 'road' && cv.n === 3 && es.allies === 3, '護送：地圖一定有公路，三台護送車輛');
  const moved = await page.evaluate(async () => {
    const g = window.__game,
      a = g.camp.ss.convoy[0];
    const p0 = a.pos.clone();
    await new Promise((r) => setTimeout(r, 2000));
    return a.pos.distanceTo(p0);
  });
  check(moved > 0.5, '護送：車隊沿公路前進（' + moved.toFixed(1) + ' m）');
  await page.evaluate(() => {
    const g = window.__game;
    for (const a of g.camp.ss.convoy) {
      const P = a.opts.path;
      const q = P[P.length - 1];
      a.pos.set(q.x, q.y, q.z);
      a.pathI = P.length;
    }
  });
  check(await exitsUp(10000, false), '護送：車隊全部抵達後清除並開出口');
  // 突破：一開始就有出口，不必全滅
  const br = await enter('breakthrough', 2);
  check(br.exits >= 2 && br.enemies > 0, '突破：一開始就開出口，敵人還在');
  // 精英：具名 AC＋血條；小型戰場
  const el = await enter('elite', 3);
  const elb = await page.evaluate(() => ({
    n: window.__game.bosses.length,
    bar: getComputedStyle(document.getElementById('bossBar')).display,
  }));
  check(elb.n === 1 && elb.bar !== 'none', '精英：具名 AC 與血條');
  check(
    el.zone[1] - el.zone[0] < el.lim * 1.2,
    '精英：小型戰場（作戰區域 ' + Math.round(el.zone[1] - el.zone[0]) + ' m）',
  );
  // 作戰區域：狹長（超出被推回）、分段開放（擊破一半後擴大）
  const lg = await enter('battle', 1, { zone: 'long', zoneAxis: 0 });
  check(lg.zone[1] - lg.zone[0] < lg.lim && lg.zone[3] - lg.zone[2] > lg.lim * 1.9, '狹長地帶的作戰區域');
  const oob = await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      p = g.player;
    g.state = 'zone-test';
    // 找一條邊界外 8 m 到邊界內 6 m 之間沒有障礙物的路線
    const ex = w.zone[1];
    let zz = 0;
    for (let z = -60; z <= 60; z += 3) {
      const blocked = w.obstacles.some((o) =>
        o.kind === 'box'
          ? o.x + o.w / 2 > ex - 6 && o.x - o.w / 2 < ex + 8 && Math.abs(o.z - z) < o.d / 2 + 3
          : Math.abs(o.x - ex) < o.r + 8 && Math.abs(o.z - z) < o.r + 3,
      );
      if (!blocked) {
        zz = z;
        break;
      }
    }
    p.pos.set(ex + 6, w.groundAt(ex + 6, zz, 99) + 0.1, zz);
    p.vel.set(0, 0, 0);
    for (let i = 0; i < 240; i++) p.move(1 / 60, new THREE.Vector3(), false, false, false, null);
    g.state = 'play';
    return { x: p.pos.x, edge: w.zone[1] };
  });
  check(oob.x <= oob.edge + 0.5, '狹長地帶：超出作戰區域被推回');
  await enter('battle', 1, { zone: 'staged', zoneAxis: 1 });
  const stg = await page.evaluate(() => {
    const g = window.__game,
      w = g.world;
    g.state = 'zone-test';
    const z0 = w.zone[3];
    const al = g.enemies.filter((e) => !e.dead);
    for (const e of al.slice(0, Math.ceil(al.length / 2) + 1)) {
      if (e.ai === 'burrow') e.bossVis = 0;
      e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    }
    for (let i = 0; i < 200; i++) g.campTick(0.05);
    g.state = 'play';
    return { z0, z1: w.zone[3], lim: w.lim };
  });
  check(
    stg.z0 < stg.lim * 0.5 && stg.z1 > stg.lim - 1,
    '分段開放：擊破一半後作戰區域擴大（' + Math.round(stg.z0) + ' → ' + Math.round(stg.z1) + '）',
  );
  // 主題變體與地標：每種都能生成；坑道網有岩頂、生成點不在岩壁上；夜間變暗
  const vs = await page.evaluate(() => {
    const g = window.__game;
    g.campClearExits();
    g.camp = null;
    g.clearMission();
    g.state = 'variant-test';
    const out = [];
    let W = null;
    for (const [th, v] of [
      ['wasteland', 'factory'],
      ['wasteland', 'pipeline'],
      ['wasteland', 'slag'],
      ['wasteland', 'junction'],
      ['desert', 'openpit'],
      ['desert', 'tunnels'],
      ['desert', 'shaft'],
      ['desert', 'vein'],
      ['desert', 'outskirts'],
    ]) {
      if (g.world) g.world.dispose();
      g.world = null;
      if (!W) {
        g.save.level = 1;
        g.startMission();
        W = g.world.constructor;
        g.clearMission();
        g.state = 'variant-test';
      }
      const lmk = th === 'wasteland' ? 'radar' : 'crystal';
      const w = new W(g.scene, th, 1234 + out.length, 3, null, {
        variant: v,
        landmark: lmk,
        entry: 'lift',
        tod: 'night',
      });
      g.world = w;
      const sp = w.spawnPoint(new THREE.Vector3(), []);
      out.push({
        v,
        key: w.variantKey,
        lm: !!w.landmark,
        roof: !!w.theme.roof,
        off: w.offLimits(sp.x, sp.z),
      });
    }
    const w0 = new W(g.scene, 'wasteland', 77, 3, null, { tod: 'night' });
    g.world.dispose();
    g.world = w0;
    w0.applyLight(g);
    const night = g.sun.intensity;
    g.world.dispose();
    g.world = null;
    g.state = 'title';
    return { out, night };
  });
  check(
    vs.out.every((o) => o.key === o.v),
    '主題變體都能生成（' + vs.out.map((o) => o.v).join('、') + '）',
  );
  check(
    vs.out.filter((o) => o.lm).length >= 7,
    '地標放得下（' + vs.out.filter((o) => o.lm).length + '／' + vs.out.length + '）',
  );
  const tun = vs.out.find((o) => o.v === 'tunnels');
  check(tun.roof && !tun.off, '坑道網：有岩頂、生成點不在岩壁上');
  check(vs.night < 0.5, '夜間的光線變暗（太陽強度 ' + vs.night.toFixed(2) + '）');
  // 自由出擊：車庫選的主題變體（截圖：廢工廠群、坑道網）
  for (const [th, v, tod] of [
    ['wasteland', 'factory', 'dusk'],
    ['desert', 'tunnels', ''],
  ]) {
    await page.evaluate(
      ([th, v, tod]) => {
        const g = window.__game;
        localStorage.setItem('rubicon_map', th);
        localStorage.setItem('rubicon_variant', v);
        g.save.level = 1;
        g.startMission();
        g.world.tod = tod;
        g.world.applyLight(g);
      },
      [th, v, tod],
    );
    await wait(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, 'variant-' + v + '.png') });
  }
  const fv = await page.evaluate(() => window.__game.world.variantKey);
  check(fv === 'tunnels', '自由出擊：車庫選的主題變體套用到出擊');
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    localStorage.setItem('rubicon_map', 'industrial');
    localStorage.setItem('rubicon_variant', 'base');
    g.openGarage();
  });
  await waitVisible(page, 'garage');
  await page.selectOption('#gMapSel', 'desert');
  const opts = await page.$$eval('#gVarSel option', (l) => l.map((o) => o.textContent));
  check(
    opts.includes('坑道網') && opts.includes('標準') && !opts.includes('礦場外圍'),
    '車庫的變體選單（' + opts.join('、') + '）',
  );
  await page.selectOption('#gMapSel', 'industrial');
  await ctx.close();
}

// 主線第 6 期：第 1 章內容（荒野、礦坑的專屬敵人、專屬 AC 與通訊）、模擬器與教官考核、作戰紀錄與危險條款
async function testChapter1(browser, base) {
  console.log('第 1 章：專屬敵人與 AC、模擬器、教官考核、作戰紀錄與危險條款');
  const { ctx, page } = await newPage(browser, 'ch1');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 區段的編成混進主題專屬敵人；礦坑深層才有結晶無人機
  const mix = await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1s2');
    const names = new Set();
    for (let i = 0; i < 6; i++) {
      g.camp.seg = 3;
      g.camp.types[3] = 'battle';
      g.camp.plan[3].depth = 2;
      g.campEnterSeg();
      for (const e of g.enemies) names.add(e.name);
      g.waves.flat().forEach((t) => names.add(t));
    }
    return [...names];
  });
  check(
    mix.some((n) => ['鑽頭採礦機', '炸藥礦車', '結晶寄生無人機', 'drill', 'cart', 'crystal'].includes(n)),
    '礦坑的區段混進專屬敵人（' + mix.slice(0, 8).join('、') + '）',
  );
  // 各專屬敵人的行為
  const fx = await page.evaluate(() => {
    const g = window.__game;
    g.camp.types[3] = 'supply';
    g.campEnterSeg(); // 沒有敵人的區段
    g.state = 'foe-test';
    const p = g.player;
    p.hp = p.maxHp = 1e6;
    const at = (x, z) => new THREE.Vector3(x, g.world.terrainHeight(x, z), z);
    const out = {};
    // 鑽頭採礦機：貼身鑽擊
    const dr = g.spawnType('drill', 1, 1, at(2, 0));
    const h0 = p.hp;
    for (let i = 0; i < 120; i++) {
      g.time += 1 / 60;
      dr.updateAI(1 / 60);
    }
    out.drill = h0 - p.hp;
    out.drillVel = Number.isFinite(p.vel.x + p.vel.y + p.vel.z); // 近戰命中的擊退不能是 NaN
    dr.takeDamage(1e9, 0, p, dr.center(), new THREE.Vector3(0, 0, 1));
    // 廢鐵合成體：外殼吸收傷害
    const jk = g.spawnType('junk', 1, 1, at(-20, 0));
    jk.updateAI(1 / 60);
    const j0 = jk.hp;
    jk.takeDamage(1000, 0, p, jk.center(), new THREE.Vector3(0, 0, 1));
    out.junk = { hurt: j0 - jk.hp, shell: jk.shell, max: jk.shellMax };
    jk.takeDamage(1e9, 0, p, jk.center(), new THREE.Vector3(0, 0, 1));
    // 拾荒 MT：同伴被擊破時撿零件強化
    const s1 = g.spawnType('scav', 1, 1, at(30, 0), 2);
    const sc = g.enemies.filter((e) => !e.dead && e.opts.foe === 'scav');
    const m0 = sc[1].maxHp;
    sc[0].takeDamage(1e9, 0, p, sc[0].center(), new THREE.Vector3(0, 0, 1));
    out.scav = { n: sc[1].scavN || 0, up: sc[1].maxHp > m0 };
    void s1;
    g.state = 'play';
    return out;
  });
  check(
    fx.drill > 0 && fx.drillVel,
    '鑽頭採礦機：貼身鑽擊造成傷害（' + Math.round(fx.drill) + '），擊退正常',
  );
  check(
    fx.junk.hurt <= 250 && fx.junk.shell < fx.junk.max,
    '廢鐵合成體：外殼吸收大部分傷害（1000 → ' + Math.round(fx.junk.hurt) + '）',
  );
  check(fx.scav.n === 1 && fx.scav.up, '拾荒 MT：同伴被擊破時撿零件強化');
  // 沙丘：沙中伏擊者（地下打不到、鑽出攻擊）、沙暴干擾機（鎖定距離減半）
  const du = await page.evaluate(() => {
    const g = window.__game;
    g.camp.types[3] = 'supply';
    g.campEnterSeg();
    g.state = 'foe-test';
    const p = g.player;
    p.hp = p.maxHp = 1e6;
    const at = (x, z) => new THREE.Vector3(x, g.world.terrainHeight(x, z), z);
    const out = {};
    const bw = g.spawnType('burrow', 1, 1, at(12, 0));
    bw.updateAI(1 / 60);
    const h0 = bw.hp;
    bw.takeDamage(5000, 0, p, bw.center(), new THREE.Vector3(0, 0, 1));
    out.under = { inv: bw.hp === h0, hidden: !bw.mesh.visible, noLock: bw.noLock };
    const p0 = p.hp;
    let rose = false;
    for (let i = 0; i < 900 && !rose; i++) {
      g.time += 1 / 60;
      bw.updateAI(1 / 60);
      if (bw.aiState.bw === 'up') rose = true;
    }
    out.rose = rose;
    out.hit = p0 - p.hp;
    out.visible = bw.mesh.visible;
    bw.takeDamage(1e9, 0, p, bw.center(), new THREE.Vector3(0, 0, 1));
    out.killed = bw.dead;
    const r0 = g.lockReach(p);
    const jm = g.spawnType('jammer', 1, 1, at(8, 8));
    const r1 = g.lockReach(p);
    jm.takeDamage(1e9, 0, p, jm.center(), new THREE.Vector3(0, 0, 1));
    out.jam = [r0, r1];
    g.state = 'play';
    return out;
  });
  check(du.under.inv && du.under.hidden && du.under.noLock, '沙中伏擊者：在沙下時看不到、打不到、不能鎖定');
  check(
    du.rose && du.hit > 0 && du.visible && du.killed,
    '沙中伏擊者：從腳下鑽出攻擊（' + Math.round(du.hit) + '），露出後打得到',
  );
  check(
    du.jam[1] < du.jam[0] * 0.6,
    '沙暴干擾機：附近的鎖定距離減半（' + du.jam.map(Math.round).join(' → ') + ' m）',
  );
  const dv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['bridge', 'turbine', 'colossus', 'array', 'gate', 'scorpion'];
    ['ridges', 'flats', 'wrecks', 'storm', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'dunes', 500 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push((g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
    });
    return out;
  });
  check(
    dv.slice(0, 4).every((s, i) => s.startsWith(['ridges', 'flats', 'wrecks', 'storm'][i])) &&
      dv.filter((s) => s.endsWith(':1')).length >= 5,
    '沙丘的 4 種變體與地標（' + dv.join('、') + '）',
  );
  // 精英區段：荒野是 RUST（劇情通訊）、礦坑是 PROSPECTOR
  const el = await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    g.campBegin('c1s1');
    const r = [];
    for (const [seg, th] of [
      [1, 'dunes'],
      [2, 'wasteland'],
      [3, 'desert'],
    ]) {
      g.camp.seg = seg;
      g.camp.types[seg] = 'elite';
      g.campEnterSeg();
      r.push(g.bosses[0].name + ':' + th);
    }
    const log = (g.save.story.log || []).map((l) => l.sp);
    return { r, rust: log.includes('rust'), pro: log.includes('prospector'), sir: log.includes('sirocco') };
  });
  check(
    el.r[0].startsWith('SIROCCO') &&
      el.r[1].startsWith('RUST') &&
      el.r[2].startsWith('PROSPECTOR') &&
      el.rust &&
      el.pro &&
      el.sir,
    '精英區段：沙丘是 SIROCCO、荒野是 RUST、礦坑是 PROSPECTOR，各自有通訊（' + el.r.join('、') + '）',
  );
  // 模擬器：列出遇過的敵人與宿敵；模擬戰清除後回機庫
  await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    g.openHub();
  });
  await waitVisible(page, 'hub');
  await page.click('#btnHubSim');
  check(await waitVisible(page, 'simMenu'), '機庫的模擬器');
  const items = await page.$$eval('.simItem', (l) => l.map((b) => b.dataset.k + ':' + b.dataset.key));
  check(
    items.includes('ace:rust') &&
      items.includes('ace:prospector') &&
      items.some((i) => i.startsWith('foe:drill')),
    '模擬器列出遇過的專屬敵人與宿敵（' + items.length + ' 項）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-sim.png') });
  await page.click('.simItem[data-k="foe"][data-key="drill"]');
  const sim = await page.evaluate(() => ({
    st: window.__game.state,
    theme: window.__game.worldTheme,
    n: window.__game.enemies.length,
  }));
  check(sim.st === 'play' && sim.theme === 'grid' && sim.n >= 2, '模擬戰：在模擬訓練場重現遇過的敵人');
  // 等待期間持續清掉增援與場上的敵人（之後才生成的、第一次沒打死的也算）
  const simClear = await page
    .waitForFunction(
      () => {
        const g = window.__game;
        if (g.state === 'result') return true;
        g.waves = [];
        g.wavePend = null; // 已預告、還沒出現的增援也取消
        for (const e of g.enemies)
          if (!e.dead) {
            if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
            e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
          }
        return false;
      },
      null,
      { timeout: 12000, polling: 250 },
    )
    .then(() => true)
    .catch(() => false);
  check(simClear && (await waitVisible(page, 'result', 3000)), '模擬戰清除後顯示結果');
  await page.click('#btnResultOk');
  check(await waitVisible(page, 'hub'), '模擬戰結果返回機庫');
  // 教官考核：通過解鎖零件
  const ins = await page.evaluate(async () => {
    const g = window.__game;
    const had = g.save.owned.includes('w_saber');
    g.simStart('instructor', 'instructor');
    g.waves = [];
    g.wavePend = null; // 已預告、還沒出現的增援也取消
    for (const e of g.enemies) e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    await new Promise((r) => setTimeout(r, 2500));
    return { had, now: g.save.owned.includes('w_saber'), passed: !!g.save.story.instructor };
  });
  check(!ins.had && ins.now && ins.passed, '教官考核通過：解鎖 LS-70 光束大劍');
  // 作戰紀錄：重打完成過的委託＋危險條款（敵人強化、補給中斷），模組從零開始
  await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done.c1s1 = 1;
    g.campSetMods([{ id: 'c_power', lv: 2 }]);
    g.openHub();
  });
  await waitVisible(page, 'hub');
  await page.click('#btnHubRecord');
  check(await waitVisible(page, 'record'), '機庫的作戰紀錄');
  await page.check('#recHeat input[data-h="shield"]');
  await page.check('#recHeat input[data-h="nosupply"]');
  await page.click('#btnRecGo');
  const rec = await page.evaluate(() => {
    const g = window.__game,
      c = g.camp;
    return {
      replay: c.replay,
      heat: Object.keys(c.heat).sort().join(','),
      mods: g.campMods().length,
      kept: g.save.story.mods.list.length,
    };
  });
  check(
    rec.replay && rec.heat === 'nosupply,shield' && rec.mods === 0 && rec.kept === 1,
    '作戰紀錄：重打帶著危險條款、模組從零開始（這一章持有的保留）',
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.camp.types[0] = 'battle';
    g.campEnterSeg();
  });
  const sh = await page.evaluate(() => window.__game.scaleHp);
  check(sh > 1.3, '危險條款「敵人強化」：敵人 AP 倍率提高（×' + sh.toFixed(2) + '）');
  await ctx.close();
}

// 主線第 2 章：集散場（起重機砲台、叉架 MT、STEVEDORE）、水壩（閘門砲台、壩頂巡邏砲車、SLUICE）、
// 水沒市街（潛航砲艇、汙染噴射 MT、MARSH）的專屬敵人、變體與地標；第 2 章的出擊、陣營抉擇出口與總覽圖的分歧
async function testChapter2(browser, base) {
  console.log('第 2 章：集散場、水壩、水沒市街的專屬敵人與 AC、變體與地標、出擊、陣營抉擇');
  const { ctx, page } = await newPage(browser, 'ch2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 集散場的專屬敵人：起重機砲台丟貨櫃、叉架 MT 的貨櫃盾與投擲
  const ind = await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1s1');
    g.campSortie().segs[0].theme = 'industrial';
    g.camp.plan[0] = { ...g.camp.plan[0], variant: 'railyard', landmark: '' };
    g.camp.types[0] = 'supply';
    g.campEnterSeg(); // 沒有敵人的區段（平坦的調度場，拿掉障礙物，貨櫃的拋物線不會被擋住）
    g.world.obstacles.length = 0;
    g.world.props = [];
    let nCrate = 0;
    const cs0 = g.crateShot;
    g.crateShot = function (...a) {
      nCrate++;
      return cs0.apply(this, a);
    };
    g.state = 'foe-test';
    const p = g.player;
    p.hp = p.maxHp = 1e6;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, g.world.terrainHeight(x, z), z);
    };
    const step = (ents, n, stop) => {
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0; // 主迴圈沒有在跑，玩家的無敵時間不會減少
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
        g.projectiles = g.projectiles.filter((q) => !q.dead);
        if (stop && stop()) return i;
      }
      return n;
    };
    const out = {};
    // 起重機砲台
    const cr = g.spawnType('crane', 1, 1, at(0, -28));
    const h0 = p.hp;
    let crate = false;
    step([cr], 700, () => {
      if (g.projectiles.some((q) => q.kind === 'crate')) crate = true;
      return crate && p.hp < h0;
    });
    out.crane = {
      crate,
      hit: h0 - p.hp,
      moved: cr.pos.distanceTo(at(0, -28)),
      d: cr.pos.distanceTo(p.pos),
      st: cr.aiState.crT,
      ld: cr.aiState.loaded,
      n: g.projectiles.length,
    };
    step([cr], 600, () => !cr.aiState.loaded); // 丟出之後
    step([cr], 600, () => cr.aiState.loaded);
    out.crane.reload = !!(cr.bossVis & 1) || cr.aiState.loaded;
    cr.takeDamage(1e9, 0, p, cr.center(), new THREE.Vector3(0, 0, 1));
    // 叉架 MT：面向玩家時正面的傷害大減；近戰打掉貨櫃
    const fk = g.spawnType('forklift', 1, 1, at(0, -30), 1);
    fk.updateAI(1 / 60);
    const face = () => {
      const d = p.pos.clone().sub(fk.pos);
      fk.yaw = Math.atan2(-d.x, -d.z);
    };
    face();
    fk.hp = fk.maxHp = 1e6;
    const f0 = fk.hp;
    fk.takeDamage(1000, 0, p, fk.center(), new THREE.Vector3(0, 0, 1));
    out.front = f0 - fk.hp;
    fk.yaw += Math.PI;
    const f1 = fk.hp;
    fk.takeDamage(1000, 0, p, fk.center(), new THREE.Vector3(0, 0, 1));
    out.back = f1 - fk.hp;
    face();
    fk.takeDamage(100, 0, p, fk.center(), new THREE.Vector3(0, 0, 1), true);
    out.broke = !fk.aiState.hold && !(fk.bossVis & 1);
    fk.takeDamage(1e9, 0, p, fk.center(), new THREE.Vector3(0, 0, 1));
    // 叉架 MT：靠近之後丟出貨櫃
    const fk2 = g.spawnType('forklift', 1, 1, at(0, -14), 1);
    nCrate = 0;
    g.projectiles = [];
    step([fk2], 700, () => !fk2.aiState.hold);
    out.thrown = !fk2.aiState.hold && nCrate > 0;
    out.fk2 = {
      hold: fk2.aiState.hold,
      thT: fk2.aiState.thT,
      d: fk2.pos.distanceTo(p.pos),
      n: g.projectiles.map((q) => q.kind).join(','),
      st: g.state,
      ca: fk2.canAct(),
      dead: fk2.dead,
    };
    fk2.takeDamage(1e9, 0, p, fk2.center(), new THREE.Vector3(0, 0, 1));
    g.crateShot = cs0;
    g.state = 'play';
    return out;
  });
  check(
    ind.crane.crate && ind.crane.hit > 0 && ind.crane.moved < 0.5,
    '起重機砲台：不移動，把貨櫃砸到目標腳下（' +
      Math.round(ind.crane.hit) +
      '，' +
      JSON.stringify(ind.crane) +
      '）',
  );
  check(ind.crane.reload, '起重機砲台：丟出後重新吊起貨櫃');
  check(
    ind.front < ind.back * 0.3,
    '叉架 MT：貨櫃盾擋下正面的傷害（正面 ' + Math.round(ind.front) + '、背面 ' + Math.round(ind.back) + '）',
  );
  check(ind.broke, '叉架 MT：近戰打掉貨櫃');
  check(ind.thrown, '叉架 MT：靠近之後丟出貨櫃（' + JSON.stringify(ind.fk2) + '）');
  // 集散場的 4 種變體與 6 個地標
  const iv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['gantry', 'tower', 'stack', 'tanker', 'silos', 'airship'];
    ['stacks', 'warehouse', 'railyard', 'docks', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'industrial', 700 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      const w = g.world;
      const n = (k) => (w.props || []).filter((q) => q.kind === k).length;
      out.push(
        (w.variantKey || '-') +
          ':' +
          (w.landmark ? 1 : 0) +
          ':' +
          ({
            stacks: n('stack'),
            warehouse: w.obstacles.length,
            railyard: n('boxcar'),
            docks: w.waterMesh ? 1 : 0,
          }[v] || 0),
      );
    });
    return out;
  });
  check(
    iv
      .slice(0, 4)
      .every((s, i) => s.startsWith(['stacks', 'warehouse', 'railyard', 'docks'][i]) && !s.endsWith(':0')) &&
      iv.filter((s) => s.split(':')[1] === '1').length >= 5,
    '集散場的 4 種變體與地標（' + iv.join('、') + '）',
  );
  // 變體的畫面（截圖確認外觀）與精英區段的 STEVEDORE
  const st = await page.evaluate(() => {
    const g = window.__game;
    g.campSortie().segs[1].theme = 'industrial';
    g.camp.seg = 1;
    g.camp.plan[1] = {
      ...g.camp.plan[1],
      variant: 'stacks',
      landmark: 'gantry',
      tod: '',
      weather: '',
      zone: 'full',
    };
    g.camp.types[1] = 'elite';
    g.campEnterSeg();
    const log = (g.save.story.log || []).map((l) => l.sp);
    return { name: g.bosses[0] && g.bosses[0].name, comm: log.includes('stevedore'), theme: g.worldTheme };
  });
  check(
    st.name === 'STEVEDORE' && st.comm && st.theme === 'industrial',
    '精英區段：集散場是 STEVEDORE，有通訊（' + st.name + '）',
  );
  for (const v of ['stacks', 'warehouse', 'railyard', 'docks']) {
    await page.evaluate((v) => {
      const g = window.__game;
      g.camp.plan[1] = { ...g.camp.plan[1], variant: v, landmark: '' };
      g.camp.types[1] = 'supply';
      g.campEnterSeg();
    }, v);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch2-industrial-' + v + '.png') });
  }
  // 水壩：閘門砲台站上閘門、開閘的水流把機體往下游推；巡邏砲車在壩頂
  const dm = await page.evaluate(() => {
    const g = window.__game;
    g.campSortie().segs[1].theme = 'dam';
    g.camp.plan[1] = { ...g.camp.plan[1], variant: '', landmark: '' };
    g.camp.types[1] = 'supply';
    g.campEnterSeg();
    g.state = 'foe-test';
    const w = g.world,
      D = w.dam,
      p = g.player;
    p.hp = p.maxHp = 1e6;
    const out = { gates: D.gates.length };
    const gg = g.spawnType('gategun', 1, 1);
    gg.updateAI(1 / 60);
    const q = gg.aiState.gate;
    out.onGate = !!q && Math.abs(gg.pos.z - D.zc) < 1 && gg.pos.y > 10;
    // 玩家站在閘門下游的水道裡（拿掉壩體以外的障礙物，推動的距離不會被物件擋住）
    w.obstacles = w.obstacles.filter((o) => Math.abs(o.z - D.zc) < 8);
    const dn = -D.up;
    const z0 = D.zc + dn * 14;
    p.pos.set(q.x, w.terrainHeight(q.x, z0), z0);
    p.vel.set(0, 0, 0);
    const h0 = p.hp;
    let warned = false;
    for (let i = 0; i < 900 && !(g.flows || []).length; i++) {
      g.time += 1 / 60;
      gg.updateAI(1 / 60);
      if (gg.bossVis & 1) warned = true;
    }
    out.warned = warned;
    out.flow = (g.flows || []).length;
    const u0 = (p.pos.z - D.zc) * dn;
    for (let i = 0; i < 90; i++) {
      g.time += 1 / 60;
      p.move(1 / 60, new THREE.Vector3(), false, false, false, null);
      g.updateSupport(1 / 60);
    }
    out.pushed = (p.pos.z - D.zc) * dn - u0;
    out.hurt = h0 - p.hp;
    gg.takeDamage(1e9, 0, p, gg.center(), new THREE.Vector3(0, 0, 1));
    const pc = g.spawnType('patrol', 1, 1);
    out.perch = pc.pos.y - w.terrainHeight(pc.pos.x, pc.pos.z);
    pc.takeDamage(1e9, 0, p, pc.center(), new THREE.Vector3(0, 0, 1));
    g.state = 'play';
    return out;
  });
  check(dm.onGate, '閘門砲台：站上水壩的閘門（' + dm.gates + ' 座閘門）');
  check(dm.warned && dm.flow > 0, '閘門砲台：預警後開閘');
  check(
    dm.pushed > 3 && dm.hurt > 0,
    '開閘的水流把機體往下游推（' + dm.pushed.toFixed(1) + ' m）並造成傷害（' + Math.round(dm.hurt) + '）',
  );
  check(dm.perch > 5, '壩頂巡邏砲車：生成在高處（離地 ' + dm.perch.toFixed(1) + ' m）');
  const dv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['runner', 'radial', 'intake', 'gauge', 'barge', 'aqueduct'];
    ['gorge', 'weirs', 'plant', 'storm', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'dam', 800 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push((g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
    });
    return out;
  });
  check(
    dv.slice(0, 4).every((s, i) => s.startsWith(['gorge', 'weirs', 'plant', 'storm'][i])) &&
      dv.filter((s) => s.endsWith(':1')).length >= 5,
    '水壩的 4 種變體與地標（' + dv.join('、') + '）',
  );
  const sl = await page.evaluate(() => {
    const g = window.__game;
    g.camp.types[1] = 'elite';
    g.campEnterSeg();
    const log = (g.save.story.log || []).map((l) => l.sp);
    return { name: g.bosses[0] && g.bosses[0].name, comm: log.includes('sluice') };
  });
  check(sl.name === 'SLUICE' && sl.comm, '精英區段：水壩是 SLUICE，有通訊');
  for (const v of ['gorge', 'weirs', 'plant', 'storm']) {
    await page.evaluate((v) => {
      const g = window.__game;
      g.camp.plan[1] = { ...g.camp.plan[1], variant: v, landmark: '' };
      g.camp.types[1] = 'supply';
      g.campEnterSeg();
    }, v);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch2-dam-' + v + '.png') });
  }
  // 水沒市街：潛航砲艇、汙染噴射 MT、涉水變慢、MARSH 的潛行
  const fl = await page.evaluate(() => {
    const g = window.__game;
    g.campSortie().segs[1].theme = 'flooded';
    g.camp.plan[1] = { ...g.camp.plan[1], variant: 'canal', landmark: '' };
    g.camp.types[1] = 'supply';
    g.campEnterSeg();
    g.state = 'foe-test';
    const w = g.world,
      p = g.player;
    p.hp = p.maxHp = 1e6;
    const out = {};
    // 玩家附近找一個水深 0.6 m 以上的地方
    const wetAt = (r0, r1) => {
      for (let r = r0; r < r1; r += 2)
        for (let a = 0; a < 6.28; a += 0.2) {
          const x = p.pos.x + Math.cos(a) * r,
            z = p.pos.z + Math.sin(a) * r;
          if (w.waterDepth(x, z) > 0.8 && w.inZone(x, z, 4))
            return new THREE.Vector3(x, w.terrainHeight(x, z), z);
        }
      return null;
    };
    const step = (ents, n, stop) => {
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0; // 主迴圈沒有在跑，玩家的無敵時間不會減少
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
        g.projectiles = g.projectiles.filter((q) => !q.dead);
        g.updateHazards(1 / 60);
        if (stop && stop()) return i;
      }
      return n;
    };
    const wp = wetAt(16, 40);
    out.water = !!wp;
    const gb = g.spawnType('gunboat', 1, 1, wp);
    gb.updateAI(1 / 60);
    const b0 = gb.hp;
    gb.takeDamage(5000, 0, p, gb.center(), new THREE.Vector3(0, 0, 1));
    out.under = { inv: gb.hp === b0, hidden: !gb.mesh.visible, noLock: gb.noLock };
    let torp = false;
    step([gb], 900, () => {
      if (g.projectiles.some((q) => q.kind === 'torpedo')) torp = true;
      return torp;
    });
    out.torp = torp;
    out.up = gb.aiState.gb === 'up' && gb.mesh.visible;
    gb.takeDamage(1e9, 0, p, gb.center(), new THREE.Vector3(0, 0, 1));
    out.killed = gb.dead;
    // 汙染噴射 MT：腐蝕區（損傷＋ACS 回復變慢）
    const sp = g.spawnType('sprayer', 1, 1, new THREE.Vector3(p.pos.x + 12, p.pos.y, p.pos.z));
    const h0 = p.hp;
    let acid = false;
    step([sp], 600, () => {
      if ((g.hzPools || []).some((q) => q.acid)) acid = true;
      return acid && p.corrodeT > 0;
    });
    out.acid = acid;
    out.corrode = p.corrodeT > 0;
    out.acidHurt = h0 - p.hp;
    sp.takeDamage(1e9, 0, p, sp.center(), new THREE.Vector3(0, 0, 1));
    // 涉水：站在水裡變慢
    const wq = wetAt(2, 40);
    p.pos.copy(wq);
    out.wade = p.waterK();
    // MARSH：在水裡離目標遠時潛行
    g.campSortie().segs[1].theme = 'flooded';
    g.camp.types[1] = 'elite';
    g.state = 'play';
    g.campEnterSeg();
    const m = g.bosses[0];
    out.marsh = m && m.name;
    const log = (g.save.story.log || []).map((l) => l.sp);
    out.comm = log.includes('marsh');
    const p2 = g.player;
    const far = (() => {
      for (let r = 30; r < 80; r += 3)
        for (let a = 0; a < 6.28; a += 0.25) {
          const x = p2.pos.x + Math.cos(a) * r,
            z = p2.pos.z + Math.sin(a) * r;
          if (g.world.waterDepth(x, z) > 0.8 && g.world.inZone(x, z, 4))
            return new THREE.Vector3(x, g.world.terrainHeight(x, z), z);
        }
      return null;
    })();
    if (m && far) {
      g.state = 'foe-test';
      m.pos.copy(far);
      m.vel.set(0, 0, 0);
      m.updateAI(1 / 60);
      m.specialFx(1 / 60);
      out.sub = { vis: m.bossVis, noLock: m.noLock, hidden: !m.mesh.visible, k: m.waterK() };
      g.state = 'play';
    }
    return out;
  });
  check(fl.water, '水道變體：玩家附近有深水');
  check(fl.under.inv && fl.under.hidden && fl.under.noLock, '潛航砲艇：潛航時看不到、打不到、不能鎖定');
  check(fl.torp && fl.up && fl.killed, '潛航砲艇：浮出水面發射魚雷，浮出後打得到');
  check(
    fl.acid && fl.corrode && fl.acidHurt > 0,
    '汙染噴射 MT：腐蝕區造成損傷並讓 ACS 回復變慢（' + Math.round(fl.acidHurt) + '）',
  );
  check(fl.wade < 1, '涉水：站在水裡移動變慢（×' + fl.wade + '）');
  check(fl.marsh === 'MARSH' && fl.comm, '精英區段：水沒市街是 MARSH，有通訊');
  check(
    fl.sub && fl.sub.vis === 2 && fl.sub.noLock && fl.sub.hidden && fl.sub.k > 1,
    'MARSH：在水裡離目標遠時潛行（不能鎖定），水中不減速（×' + (fl.sub && fl.sub.k) + '）',
  );
  const fv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['leaning', 'ferris', 'bell', 'stadium', 'billboard', 'tram'];
    ['highway', 'canal', 'suburb', 'toxic', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'flooded', 900 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push((g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
    });
    return out;
  });
  check(
    fv.slice(0, 4).every((s, i) => s.startsWith(['highway', 'canal', 'suburb', 'toxic'][i])) &&
      fv.filter((s) => s.endsWith(':1')).length >= 5,
    '水沒市街的 4 種變體與地標（' + fv.join('、') + '）',
  );
  for (const v of ['highway', 'canal', 'suburb', 'toxic']) {
    await page.evaluate((v) => {
      const g = window.__game;
      g.camp.plan[1] = { ...g.camp.plan[1], variant: v, landmark: '' };
      g.camp.types[1] = 'supply';
      g.campEnterSeg();
    }, v);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch2-flooded-' + v + '.png') });
  }
  // 第 2 章的出擊：各自的 Boss 與主題
  const bs = await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    const out = [];
    for (const sid of ['c2s1', 'c2s2', 'c2s3a', 'c2s3b']) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(
        sid + ':' + n + ':' + g.worldTheme + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0],
      );
      g.campEnd(false, true);
    }
    return out;
  });
  check(
    bs.join(',') ===
      'c2s1:6:dam:HALBERD,c2s2:6:flooded:HELIOS,c2s3a:6:industrial:BEHEMOTH,c2s3b:6:industrial:IRON',
    '第 2 章的 4 個出擊（各 6 段）與終點 Boss（' + bs.join('、') + '）',
  );
  // 總覽圖：第 1 章完成後開放第 2 章；依抉擇的出擊在抉擇前不出現
  await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done = { c1s1: 1, c1s2: 1 };
    g.save.story.choices = {};
    g.openHub();
  });
  await waitVisible(page, 'hub');
  const hub0 = await page.evaluate(() => ({
    nodes: [...document.querySelectorAll('#hubMap .hubNode')].map(
      (n) => n.dataset.sid + ':' + n.classList[1],
    ),
    ch: window.__game.hubChapter(),
  }));
  check(
    hub0.ch === 2 &&
      hub0.nodes.includes('c2s1:open') &&
      hub0.nodes.includes('c2s2:locked') &&
      !hub0.nodes.some((n) => n.startsWith('c2s3')),
    '總覽圖：第 2 章開放，依抉擇的出擊在抉擇前不出現（' + hub0.nodes.join('、') + '）',
  );
  // 陣營抉擇：抉擇區段清除後出現互斥的抉擇出口與通訊
  await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done.c2s1 = 1;
    g.campBegin('c2s2');
    g.camp.seg = 3;
    g.camp.types[3] = 'battle';
    g.camp.plan[3] = { ...g.camp.plan[3], variant: '', landmark: '' };
    g.campEnterSeg();
  });
  await page.waitForFunction(
    () => {
      const g = window.__game;
      g.waves = [];
      g.wavePend = null; // 已預告、還沒出現的增援也取消
      for (const e of g.enemies)
        if (!e.dead) {
          e.bossVis = 0;
          e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
        }
      return g.camp && g.camp.exits.length >= 2;
    },
    null,
    { timeout: 30000, polling: 300 },
  );
  const ch = await page.evaluate(() => {
    const g = window.__game;
    const log = (g.save.story.log || []).map((l) => l.sp);
    return { ex: g.camp.exits.map((e) => e.choice + ':' + e.reward), aet: log.includes('aetheric') };
  });
  check(
    ch.ex.length === 2 &&
      ch.ex.includes('castron:mod_castron') &&
      ch.ex.includes('aetheric:mod_aetheric') &&
      ch.aet,
    '抉擇區段：清除後出現兩個抉擇出口與雙方的通訊（' + ch.ex.join('、') + '）',
  );
  await page.evaluate(() => {
    const g = window.__game,
      e = g.camp.exits.find((q) => q.choice === 'aetheric');
    const p = g.player;
    p.pos.set(p.pos.x, p.pos.y, p.pos.z);
    const L = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) || 1;
    const dx = e.pos.x - ((e.pos.x - p.pos.x) / L) * 12,
      dz = e.pos.z - ((e.pos.z - p.pos.z) / L) * 12;
    p.pos.set(dx, g.world.terrainHeight(dx, dz), dz);
    p.yaw = p.aimYaw = Math.atan2(-(e.pos.x - dx), -(e.pos.z - dz));
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, 'ch2-choice.png') });
  // 站進出口（殘留的開閘水流之類會把機體推走，所以等待中一直放回出口上）
  const left = await page
    .waitForFunction(
      () => {
        const g = window.__game;
        if (g.state === 'camptrans') return true;
        const e = g.camp && g.camp.exits.find((q) => q.choice === 'aetheric');
        if (e) {
          g.flows = [];
          g.player.pos.set(e.pos.x, e.pos.y, e.pos.z);
          g.player.vel.set(0, 0, 0);
        }
        return false;
      },
      null,
      { timeout: 20000, polling: 200 },
    )
    .then(
      () => true,
      () => false,
    );
  check(left && (await waitVisible(page, 'campTrans', 5000)), '走進抉擇出口：出發');
  const pk = await page.evaluate(() => {
    const g = window.__game;
    return {
      key: g.camp.choice && g.camp.choice.key,
      ck: g.save.story.sortie.choice && g.save.story.sortie.choice.key,
      saved: g.save.story.choices.c2 || '',
    };
  });
  check(
    pk.key === 'aetheric' && pk.ck === 'aetheric' && !pk.saved,
    '抉擇記在出擊與紀錄點（出擊完成前不寫進存檔）',
  );
  // 出擊完成：抉擇寫進存檔，總覽圖開放對應的出擊
  const fin = await page.evaluate(() => {
    const g = window.__game;
    g.campEnterSeg();
    g.campEnd(true);
    const log = (g.save.story.log || []).map((l) => l.text);
    return {
      c2: g.save.story.choices.c2,
      a: g.hubSortieState('c2s3a'),
      b: g.hubSortieState('c2s3b'),
      comm: log.some((t) => t.includes('電力接進來了')),
    };
  });
  check(
    fin.c2 === 'aetheric' && fin.a === 'hidden' && fin.b === 'open' && fin.comm,
    '出擊完成：抉擇寫進存檔，開放「' + fin.b + '」的路線、另一條不出現，通訊依抉擇',
  );
  const done = await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done.c2s3b = 1;
    return g.campChapterCheck(2);
  });
  check(done, '依抉擇的路線完成就算整章完成（另一條不用打）');
  await ctx.close();
}

// 主線第 3 章：冰原（雪中潛伏 MT、冰面滑行砲車、WHITEOUT）、地下技研都市（實驗體、保全雷射網、SPECIMEN）的
// 專屬敵人、變體與地標；第 3 章的出擊、跨主題下降、宿敵依抉擇再登場
async function testChapter3(browser, base) {
  console.log('第 3 章：冰原、地下技研都市的專屬敵人與 AC、變體與地標、出擊、宿敵再登場');
  const { ctx, page } = await newPage(browser, 'ch3');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 進入指定主題的沒有敵人的區段（第 1 段），測試時主迴圈不跑 AI
  const enter = (theme, variant) =>
    page.evaluate(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
        g.state = 'foe-test';
        g.player.hp = g.player.maxHp = 1e6;
      },
      [theme, variant],
    );
  await enter('snow', 'icefield');
  const sn = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, w.terrainHeight(x, z), z);
    };
    const step = (ents, n, stop) => {
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0;
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
        g.projectiles = g.projectiles.filter((q) => !q.dead);
        if (stop && stop()) return i;
      }
      return n;
    };
    const out = {};
    // 雪中潛伏 MT：遠的時候隱藏、靠近現身
    const lk = g.spawnType('lurker', 1, 1, at(0, -40), 1);
    step([lk], 2);
    out.hide = { vis: lk.mesh.visible, noLock: lk.noLock };
    lk.pos.copy(at(0, -10));
    step([lk], 2);
    out.rise = { vis: lk.mesh.visible, noLock: lk.noLock, st: lk.aiState.lk };
    lk.takeDamage(1e9, 0, p, lk.center(), new THREE.Vector3(0, 0, 1));
    // 被打中也會現身
    const lk2 = g.spawnType('lurker', 1, 1, at(0, -40), 1);
    step([lk2], 2);
    lk2.takeDamage(10, 0, p, lk2.center(), new THREE.Vector3(0, 0, 1));
    step([lk2], 2);
    out.hitRise = lk2.aiState.lk === 'up' && !lk2.noLock;
    lk2.takeDamage(1e9, 0, p, lk2.center(), new THREE.Vector3(0, 0, 1));
    // 冰面滑行砲車：繞著目標轉，冰面上更快（繞圈的測試生成在冰面外，冰上會打滑）
    let sa = 0;
    while (sa < 6.28 && w.onIce(p.pos.x + Math.cos(sa) * 24, p.pos.z + Math.sin(sa) * 24)) sa += 0.3;
    const sk = g.spawnType('skater', 1, 1, at(Math.cos(sa) * 24, Math.sin(sa) * 24));
    const a0 = Math.atan2(sk.pos.z - p.pos.z, sk.pos.x - p.pos.x);
    // 繞圈的路上有障礙物時撞到就反向（卡住才換方向），1 秒多的角度就會很小（和負載無關，約一成的地圖）：
    // 繞圈這段先拿掉地圖的障礙物與可破壞物件，只測繞圈本身（同 testFoesC2 的誘導飛彈）
    const ob = w.obstacles,
      pr = w.props;
    w.obstacles = [];
    w.props = [];
    step([sk], 70);
    w.obstacles = ob;
    w.props = pr;
    const a1 = Math.atan2(sk.pos.z - p.pos.z, sk.pos.x - p.pos.x);
    let da = Math.abs(a1 - a0);
    if (da > Math.PI) da = Math.PI * 2 - da;
    out.orbit = {
      da,
      d: sk.pos.distanceTo(p.pos),
      v: sk.vel.length(),
      sp: sk.stats.speed,
      k: sk.speedMul,
      st: sk.staggerT,
      ai: sk.ai,
      dead: sk.dead,
    };
    const L = w.iceBig;
    // 放在冰湖中央（每格放回去，不受推擠與硬直影響），取冰面上的最大倍率
    let kMax = 0;
    for (let i = 0; i < 30; i++) {
      sk.pos.set(L.x, w.terrainHeight(L.x, L.z), L.z);
      sk.staggerT = 0;
      step([sk], 1);
      if (sk.aiState.sp0) kMax = Math.max(kMax, sk.speedMul / sk.aiState.sp0);
    }
    out.ice = {
      on: w.onIce(L.x, L.z),
      k: kMax,
      dead: sk.dead,
      th: w.terrainHeight(L.x, L.z),
      sp0: sk.aiState.sp0,
      m: sk.speedMul,
      y: sk.pos.y,
    };
    sk.takeDamage(1e9, 0, p, sk.center(), new THREE.Vector3(0, 0, 1));
    return out;
  });
  check(!sn.hide.vis && sn.hide.noLock, '雪中潛伏 MT：遠的時候埋在雪裡（看不到、不能鎖定）');
  check(sn.rise.vis && !sn.rise.noLock && sn.rise.st === 'up', '雪中潛伏 MT：靠近 16 m 內現身');
  check(sn.hitRise, '雪中潛伏 MT：被打中也會現身');
  check(
    sn.orbit.da > 0.35 && sn.orbit.d > 12 && sn.orbit.d < 40,
    '冰面滑行砲車：繞著目標轉（' +
      sn.orbit.da.toFixed(2) +
      ' rad、' +
      sn.orbit.d.toFixed(1) +
      ' m，' +
      JSON.stringify(sn.orbit) +
      '）',
  );
  check(
    sn.ice.on && sn.ice.k > 1.3,
    '冰面滑行砲車：冰面上更快（×' + sn.ice.k.toFixed(2) + '，' + JSON.stringify(sn.ice) + '）',
  );
  // WHITEOUT：精英區段的專屬 AC，沒開火時隱藏、開火後現身
  const wo = await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    g.state = 'foe-test';
    const e = g.bosses[0],
      p = g.player;
    p.hp = p.maxHp = 1e6;
    const log = (g.save.story.log || []).map((l) => l.sp);
    const out = { name: e && e.name, comm: log.includes('whiteout') };
    const far = p.pos.clone().add(new THREE.Vector3(0, 0, -50));
    far.y = g.world.terrainHeight(far.x, far.z);
    e.pos.copy(far);
    e.recoil.r = e.recoil.l = 0;
    e.updateAI(1 / 60);
    e.specialFx(1 / 60);
    out.hidden = { vis: e.mesh.visible, noLock: e.noLock };
    e.recoil.r = 0.5;
    e.updateAI(1 / 60);
    e.specialFx(1 / 60);
    out.shown = { vis: e.mesh.visible, noLock: e.noLock };
    g.state = 'play';
    return out;
  });
  check(wo.name === 'WHITEOUT' && wo.comm, '精英區段：冰原是 WHITEOUT，有通訊');
  check(!wo.hidden.vis && wo.hidden.noLock, 'WHITEOUT：沒開火時隱藏、鎖定不到');
  check(wo.shown.vis && !wo.shown.noLock, 'WHITEOUT：開火後現身');
  const sv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['icebreaker', 'radome', 'plane', 'pipebridge', 'capsule', 'giant'];
    ['blizzard', 'crevasse', 'outpost', 'icefield', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'snow', 1000 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      const w = g.world;
      const n = (k) => (w.props || []).filter((q) => q.kind === k).length;
      out.push(
        (w.variantKey || '-') +
          ':' +
          (w.landmark ? 1 : 0) +
          ':' +
          ({
            blizzard: 1,
            crevasse: w.terrainHeight(0, 0) > -3 ? 1 : 0,
            outpost: n('snowwall'),
            icefield: w.iceBig ? 1 : 0,
          }[v] || 0),
      );
    });
    return out;
  });
  check(
    sv
      .slice(0, 4)
      .every(
        (s, i) => s.startsWith(['blizzard', 'crevasse', 'outpost', 'icefield'][i]) && !s.endsWith(':0'),
      ) && sv.filter((s) => s.split(':')[1] === '1').length >= 5,
    '冰原的 4 種變體與地標（' + sv.join('、') + '）',
  );
  for (const v of ['blizzard', 'crevasse', 'outpost', 'icefield']) {
    await enter('snow', v);
    await page.evaluate(() => (window.__game.state = 'play'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch3-snow-' + v + '.png') });
  }
  // 地下技研都市：實驗體融合、保全雷射網的警報、SPECIMEN 的過載與硬直
  await enter('institute', 'tanks');
  const ins = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, w.terrainHeight(x, z), z);
    };
    const step = (ents, n, stop) => {
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0;
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        if (stop && stop()) return i;
      }
      return n;
    };
    const out = {};
    // 實驗體：四隻聚在一起 → 融合成一隻大型個體
    g.spawnType('blob', 1, 1, at(0, -30), 4);
    const bl = g.enemies.filter((e) => !e.dead && e.opts.vehKey === 'blob');
    for (const [i, e] of bl.entries()) e.pos.copy(at(i * 1.2, -30));
    out.blobs = bl.length;
    // 每格把牠們擺回同一處（不受追擊時分散的影響），等編號最小的那隻判定融合
    step(bl, 300, () => {
      for (const [i, e] of bl.entries()) if (!e.dead) e.pos.copy(at(i * 1.2, -30));
      return g.enemies.some((e) => !e.dead && e.opts.vehKey === 'chimera');
    });
    const ch = g.enemies.find((e) => !e.dead && e.opts.vehKey === 'chimera');
    out.merged = { chimera: !!ch, left: bl.filter((e) => !e.dead).length, gone: bl.every((e) => e.dead) };
    // 融合實驗體：貼身啃咬
    if (ch) {
      ch.pos.copy(at(0, -3));
      const h0 = p.hp;
      step([ch], 200, () => p.hp < h0);
      out.bite = h0 - p.hp;
      out.vel = Number.isFinite(p.vel.x + p.vel.y + p.vel.z);
      ch.takeDamage(1e9, 0, p, ch.center(), new THREE.Vector3(0, 0, 1));
    }
    // 保全雷射網：柵欄掃過玩家時受傷並叫增援
    const lp = g.spawnType('laserpost', 1, 1, at(0, -8), 1);
    const n0 = g.enemies.filter((e) => !e.dead).length;
    const h1 = p.hp;
    step([lp], 900, () => p.hp < h1 && g.enemies.filter((e) => !e.dead).length > n0);
    out.laser = { hurt: h1 - p.hp, extra: g.enemies.filter((e) => !e.dead).length - n0 };
    for (const e of g.enemies) if (!e.dead) e.takeDamage(1e9, 0, p, e.center(), new THREE.Vector3(0, 0, 1));
    return out;
  });
  check(
    ins.blobs === 4 && ins.merged.chimera && ins.merged.gone,
    '實驗體：聚在一起融合成大型個體（' + ins.blobs + ' 隻 → 1）',
  );
  check(ins.bite > 0 && ins.vel, '融合實驗體：貼身啃咬（' + Math.round(ins.bite || 0) + '），擊退正常');
  check(
    ins.laser.hurt > 0 && ins.laser.extra >= 2,
    '保全雷射網：柵欄掃過時受傷並觸發警報叫增援（+' + ins.laser.extra + ' 台）',
  );
  const sp = await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    g.state = 'foe-test';
    const e = g.bosses[0],
      p = g.player;
    p.hp = p.maxHp = 1e6; // 測試中被打倒的話 AI 就沒有目標
    const log = (g.save.story.log || []).map((l) => l.sp);
    const out = { name: e && e.name, comm: log.includes('specimen') };
    const sp0 = e.speedMul;
    let ov = false,
      k = 0;
    for (let i = 0; i < 60 * 14 && !ov; i++) {
      g.time += 1 / 60;
      p.iFrames = 0;
      e.updateAI(1 / 60);
      if (e.bossVis & 4) {
        ov = true;
        k = e.speedMul / sp0;
      }
    }
    out.ov = {
      ov,
      k,
      ovT: e.aiState.ovT,
      ai: e.ai,
      st: e.staggerT,
      dead: e.dead,
      conf: e.confuseT,
      hp: e.hp,
      d: e.pos.distanceTo(p.pos),
      pnl: p.noLock,
      pd: p.dead,
    };
    let st = false;
    for (let i = 0; i < 60 * 6 && !st; i++) {
      g.time += 1 / 60;
      e.updateAI(1 / 60);
      if (e.staggerT > 0 && e.aiState.tired > 0) st = true;
    }
    const h0 = e.hp;
    e.iFrames = 0; // QB／空中跳的無敵時間
    e.takeDamage(1000, 0, p, e.center(), new THREE.Vector3(0, 0, 1));
    out.tired = {
      st,
      dmg: h0 - e.hp,
      ovT: e.aiState.ovT,
      ov: e.aiState.ov,
      tired: e.aiState.tired,
      sT: e.staggerT,
    };
    g.state = 'play';
    return out;
  });
  check(sp.name === 'SPECIMEN' && sp.comm, '精英區段：技研都市是 SPECIMEN，有通訊');
  check(
    sp.ov.ov && sp.ov.k > 1.4,
    'SPECIMEN：定期過載（速度 ×' + sp.ov.k.toFixed(2) + '，' + JSON.stringify(sp.ov) + '）',
  );
  check(
    sp.tired.st && sp.tired.dmg > 1200,
    'SPECIMEN：過載結束後硬直、受傷變重（1000 → ' +
      Math.round(sp.tired.dmg) +
      '，' +
      JSON.stringify(sp.tired) +
      '）',
  );
  const iv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['reactor', 'spire', 'lift', 'cage', 'tube', 'monument'];
    ['core', 'cavern', 'tanks', 'entrance', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'institute', 1100 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push((g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
    });
    return out;
  });
  check(
    iv.slice(0, 4).every((s, i) => s.startsWith(['core', 'cavern', 'tanks', 'entrance'][i])) &&
      iv.filter((s) => s.endsWith(':1')).length >= 5,
    '地下技研都市的 4 種變體與地標（' + iv.join('、') + '）',
  );
  for (const v of ['core', 'cavern', 'tanks', 'entrance']) {
    await enter('institute', v);
    await page.evaluate(() => (window.__game.state = 'play'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch3-institute-' + v + '.png') });
  }
  // 第 3 章的出擊：終點 Boss、冰原 → 技研都市的轉場（交界接力、之後下降）
  const c3 = await page.evaluate(() => {
    const g = window.__game;
    if (g.camp) g.campEnd(false, true);
    g.state = 'play';
    const out = [];
    for (const sid of ['c3s1', 'c3s2', 'c3s3']) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(sid + ':' + g.worldTheme + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0]);
      g.campEnd(false, true);
    }
    return out;
  });
  // c3s2：區段 3 → 4（交界）接力、4 → 5 下降（補給區段沒有敵人，清除後馬上出現出口）
  const modes = [];
  for (const seg of [2, 3]) {
    await page.evaluate((seg) => {
      const g = window.__game;
      if (!g.camp || g.camp.sid !== 'c3s2') {
        if (g.camp) g.campEnd(false, true);
        g.campBegin('c3s2');
      }
      g.camp.seg = seg;
      g.camp.types[seg] = 'supply';
      g.campEnterSeg();
    }, seg);
    await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
      timeout: 15000,
    });
    modes.push(await page.evaluate(() => window.__game.camp.exits[0].mode));
  }
  await page.evaluate(() => window.__game.campEnd(false, true));
  c3.push('mode:' + modes.join(','));
  check(
    c3.join(',') === 'c3s1:snow:STRIDER,c3s2:institute:MIRAGE,c3s3:institute:PULSAR,mode:relay,down',
    '第 3 章的 3 個出擊與終點 Boss、冰原 → 技研都市（交界接力、之後下降）（' + c3.join('、') + '）',
  );
  // 總覽圖：第 2 章任一路線完成後開放第 3 章
  const h3 = await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done = { c1s1: 1, c1s2: 1, c2s1: 1, c2s2: 1, c2s3a: 1 };
    g.save.story.choices = { c2: 'castron' };
    return { s1: g.hubSortieState('c3s1'), s2: g.hubSortieState('c3s2'), ch: g.hubChapter() };
  });
  check(
    h3.s1 === 'open' && h3.s2 === 'locked' && h3.ch === 3,
    '第 2 章的路線完成後開放第 3 章（' + JSON.stringify(h3) + '）',
  );
  // 宿敵再登場：依第 2 章的抉擇，對立陣營的專屬 AC（強化）與通訊
  const rv = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    for (const pk of ['castron', 'aetheric']) {
      g.save.story.choices = { c2: pk };
      g.campBegin('c3s3');
      g.camp.seg = 3;
      g.camp.types[3] = 'elite';
      g.campEnterSeg();
      const e = g.bosses[0];
      const log = (g.save.story.log || []).slice(-3).map((l) => l.sp);
      out[pk] = { name: e && e.name, hp: e && e.maxHp, sp: log };
      g.campEnd(false, true);
    }
    return out;
  });
  check(
    rv.castron.name === 'MARSH' &&
      rv.aetheric.name === 'STEVEDORE' &&
      rv.castron.sp.includes('marsh') &&
      rv.aetheric.sp.includes('stevedore'),
    '宿敵再登場：依第 2 章的抉擇（卡斯特隆 → MARSH、艾瑟立克 → STEVEDORE），有各自的通訊',
  );
  await ctx.close();
}

// 主線第 4 章：Grid 086（構造體爬行機、平台底部砲塔、SPIRE）、舊宇宙港（推進器試車台、舊式宇宙用 MT、COUNTDOWN）
// 的專屬敵人、變體與地標；第 4 章的出擊、抉擇 2、依抉擇的路線
async function testChapter4(browser, base) {
  console.log('第 4 章：Grid 086、舊宇宙港的專屬敵人與 AC、變體與地標、出擊、抉擇 2');
  const { ctx, page } = await newPage(browser, 'ch4');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  const enter = (theme, variant) =>
    page.evaluate(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
        g.state = 'foe-test';
        g.player.hp = g.player.maxHp = 1e6;
      },
      [theme, variant],
    );
  // 共用：主迴圈不跑 AI，逐格推進
  await page.evaluate(() => {
    window.__step = (ents, n, stop) => {
      const g = window.__game,
        p = g.player;
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0;
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
        g.projectiles = g.projectiles.filter((q) => !q.dead);
        if (stop && stop()) return i;
      }
      return n;
    };
  });
  await enter('grid086', '');
  const gr = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const out = {};
    // 玩家站上第一層平台，爬行機從地面爬上來
    const deck = w.obstacles.find(
      (o) => o.kind === 'box' && o.deck && Math.abs(o.top - 11) < 0.5 && Math.hypot(o.x, o.z) > 20,
    );
    out.deck = !!deck;
    if (deck) {
      p.pos.set(deck.x, deck.top, deck.z);
      p.vel.set(0, 0, 0);
      const ex = deck.x + deck.w / 2 + 6,
        ez = deck.z;
      const cr = g.spawnType('crawler', 1, 1, new THREE.Vector3(ex, w.terrainHeight(ex, ez), ez), 1);
      let top = 0;
      window.__step([cr], 900, () => {
        top = Math.max(top, cr.pos.y);
        return cr.pos.y > deck.top - 1;
      });
      out.climb = { top, deck: deck.top };
      cr.takeDamage(1e9, 0, p, cr.center(), new THREE.Vector3(0, 0, 1));
    }
    // 平台底部砲塔：吊到平台的底面
    const ut = g.spawnType('underturret', 1, 1);
    window.__step([ut], 30);
    out.hang = { dy: ut.pos.y - w.terrainHeight(ut.pos.x, ut.pos.z), fly: ut.flying, hang: ut.aiState.hang };
    ut.takeDamage(1e9, 0, p, ut.center(), new THREE.Vector3(0, 0, 1));
    return out;
  });
  check(
    gr.deck && gr.climb && gr.climb.top > gr.climb.deck - 1,
    '構造體爬行機：沿柱子爬上平台（' + JSON.stringify(gr.climb) + '）',
  );
  check(
    gr.hang.fly && gr.hang.dy > 5,
    '平台底部砲塔：吊在平台的底面（離地 ' + gr.hang.dy.toFixed(1) + ' m）',
  );
  const sp = await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    g.state = 'foe-test';
    const e = g.bosses[0];
    g.player.hp = g.player.maxHp = 1e6;
    const log = (g.save.story.log || []).map((l) => l.sp);
    window.__step([e], 120);
    return { name: e && e.name, comm: log.includes('spire'), perch: !!e.aiState.perch };
  });
  check(sp.name === 'SPIRE' && sp.comm && sp.perch, '精英區段：Grid 086 是 SPIRE（找高處的平台），有通訊');
  // 舊宇宙港：推進器試車台、舊式宇宙用 MT
  await enter('spaceport', 'runway');
  const spc = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, w.terrainHeight(x, z), z);
    };
    const out = {};
    const tr = g.spawnType('testrig', 1, 1, at(0, -12), 1);
    const h0 = p.hp;
    let warn = false;
    window.__step([tr], 900, () => {
      if (tr.bossVis === 1) warn = true;
      return warn && p.hp < h0;
    });
    out.rig = { warn, hurt: h0 - p.hp };
    tr.takeDamage(1e9, 0, p, tr.center(), new THREE.Vector3(0, 0, 1));
    // 滯空期間暫時拿掉障礙物：跑道的變體有離地 4～5 m 的頂棚（deck），宇宙用 MT 繞圈時鑽到下面就撞頂、
    // 一直按著爬升把能量耗光，只跳得到 2 m 左右（隨機地圖約 2%）
    const ob = w.obstacles;
    w.obstacles = [];
    const hm = g.spawnType('spacemt', 1, 1, at(0, -20), 1);
    let alt = 0;
    window.__step([hm], 400, () => {
      alt = Math.max(alt, hm.pos.y - w.terrainHeight(hm.pos.x, hm.pos.z));
      return false;
    });
    w.obstacles = ob;
    out.hop = alt;
    hm.takeDamage(1e9, 0, p, hm.center(), new THREE.Vector3(0, 0, 1));
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    const e = g.bosses[0];
    const log = (g.save.story.log || []).map((l) => l.sp);
    out.ace = { name: e && e.name, comm: log.includes('countdown') };
    return out;
  });
  check(spc.rig.warn && spc.rig.hurt > 0, '推進器試車台：預警後噴火橫掃（' + Math.round(spc.rig.hurt) + '）');
  check(spc.hop > 3, '舊式宇宙用 MT：跳得高、滯空久（最高離地 ' + spc.hop.toFixed(1) + ' m）');
  check(spc.ace.name === 'COUNTDOWN' && spc.ace.comm, '精英區段：舊宇宙港是 COUNTDOWN，有通訊');
  const vv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    for (const [th, vs, lms] of [
      [
        'grid086',
        ['foundry', 'scrapyard', 'deep', 'catwalks'],
        ['girder', 'doser', 'shaft', 'walker', 'column', 'furnace'],
      ],
      [
        'spaceport',
        ['runway', 'pads', 'hangar', 'ruins'],
        ['rocket', 'dish', 'shuttle', 'fuel', 'assembly', 'station'],
      ],
    ])
      [...vs, '', ''].forEach((v, i) => {
        g.world.dispose();
        g.world = new W(g.scene, th, 1200 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
        out.push(th + '/' + (g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
      });
    return out;
  });
  check(
    vv.filter((s) => !s.includes('/-')).length === 8 && vv.filter((s) => s.endsWith(':1')).length >= 10,
    'Grid 086 與舊宇宙港的各 4 種變體與地標（' + vv.join('、') + '）',
  );
  for (const [th, v] of [
    ['grid086', 'foundry'],
    ['grid086', 'catwalks'],
    ['spaceport', 'pads'],
    ['spaceport', 'hangar'],
  ]) {
    await enter(th, v);
    await page.evaluate(() => (window.__game.state = 'play'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch4-' + th + '-' + v + '.png') });
  }
  // 第 4 章的出擊與終點 Boss
  const c4 = await page.evaluate(() => {
    const g = window.__game;
    if (g.camp) g.campEnd(false, true);
    g.state = 'play';
    const out = [];
    for (const sid of ['c4s1', 'c4s2', 'c4s3a', 'c4s3b']) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(sid + ':' + g.worldTheme + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0]);
      g.campEnd(false, true);
    }
    return out;
  });
  check(
    c4.join(',') ===
      'c4s1:grid086:ARACHNE,c4s2:spaceport:CERBERUS,c4s3a:grid086:NULLIFIER,c4s3b:spaceport:JUDGEMENT',
    '第 4 章的 4 個出擊與終點 Boss（' + c4.join('、') + '）',
  );
  // 抉擇 2：宇宙港的發射台區段清除後出現抉擇出口；之後往地下機庫是下降
  await page.evaluate(() => {
    const g = window.__game;
    g.save.story.done = { c1s1: 1, c1s2: 1, c2s1: 1, c2s2: 1, c2s3a: 1, c3s1: 1, c3s2: 1, c3s3: 1, c4s1: 1 };
    g.save.story.choices = { c2: 'castron' };
    g.campBegin('c4s2');
    g.camp.seg = 3;
    g.camp.types[3] = 'supply';
    g.campEnterSeg();
  });
  await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
    timeout: 20000,
  });
  const ch4 = await page.evaluate(() => {
    const g = window.__game;
    const log = (g.save.story.log || []).map((l) => l.sp);
    return {
      ex: g.camp.exits.map((e) => e.choice + ':' + e.mode),
      sp: log.includes('sancta') && log.includes('veerwell'),
    };
  });
  check(
    ch4.ex.join(',') === 'veerwell:down,sancta:down' && ch4.sp,
    '抉擇 2：發射台區段清除後出現抉擇出口（往地下機庫是下降）與雙方的通訊（' + ch4.ex.join('、') + '）',
  );
  const r4 = await page.evaluate(() => {
    const g = window.__game,
      e = g.camp.exits.find((q) => q.choice === 'sancta');
    g.campLeave(e);
    g.campEnterSeg();
    g.campEnd(true);
    return {
      c4: g.save.story.choices.c4,
      a: g.hubSortieState('c4s3a'),
      b: g.hubSortieState('c4s3b'),
      done: g.campChapterCheck(4),
    };
  });
  check(
    r4.c4 === 'sancta' && r4.a === 'hidden' && r4.b === 'open' && !r4.done,
    '抉擇 2 寫進存檔：開放聖域的路線、維爾威的不出現（' + JSON.stringify(r4) + '）',
  );
  // 依抉擇的路線：精英區段是跨章節再登場的宿敵
  const rv4 = await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.campBegin('c4s3b');
    g.camp.seg = 3;
    g.camp.types[3] = 'elite';
    g.campEnterSeg();
    const e = g.bosses[0];
    const log = (g.save.story.log || []).slice(-3).map((l) => l.sp);
    const r = { name: e && e.name, sp: log.includes('specimen') };
    g.campEnd(false, true);
    return r;
  });
  check(rv4.name === 'SPECIMEN' && rv4.sp, '聖域路線的精英區段：SPECIMEN 再登場，有通訊');
  await ctx.close();
}

// 主線第 5 章：洋上都市（衝撞無人機、艦載防空砲、UNDERTOW）的專屬敵人、變體與地標；出擊依抉擇 2 分成兩條路線
async function testChapter5(browser, base) {
  console.log('第 5 章：洋上都市的專屬敵人與 AC、變體與地標、出擊');
  const { ctx, page } = await newPage(browser, 'ch5');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  const enter = (theme, variant) =>
    page.evaluate(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
        g.state = 'foe-test';
        g.player.hp = g.player.maxHp = 1e6;
        window.__step = (ents, n, stop) => {
          const p = g.player;
          for (let i = 0; i < n; i++) {
            g.time += 1 / 60;
            p.iFrames = 0;
            for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
            for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
            g.projectiles = g.projectiles.filter((q) => !q.dead);
            if (stop && stop()) return i;
          }
          return n;
        };
      },
      [theme, variant],
    );
  await enter('xylem', 'harbor');
  const xy = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, w.terrainHeight(x, z), z);
    };
    const out = {};
    // 衝撞無人機：預警後衝撞，把目標往外推
    p.pos.set(10, w.terrainHeight(10, 0), 0);
    p.vel.set(0, 0, 0);
    // 路線上剛好有障礙物擋住時換個方向再試
    for (const [dx, dz] of [
      [0, -20],
      [-18, 8],
      [16, 12],
    ]) {
      p.pos.set(10, w.terrainHeight(10, 0), 0);
      p.vel.set(0, 0, 0);
      const rm = g.spawnType('rammer', 1, 1, at(dx, dz), 1);
      const h0 = p.hp;
      let warned = false;
      window.__step([rm], 600, () => {
        if (rm.aiState.ph === 1) warned = true;
        return rm.aiState.hit;
      });
      out.ram = { warned, hit: !!rm.aiState.hit, hurt: h0 - p.hp, out: p.vel.x };
      rm.takeDamage(1e9, 0, p, rm.center(), new THREE.Vector3(0, 0, 1));
      if (out.ram.hit) break;
    }
    // 艦載防空砲：目標在地面時不射空炸彈，在空中時射
    p.vel.set(0, 0, 0);
    const fk = g.spawnType('flak', 1, 1, at(0, -25), 1);
    g.projectiles = [];
    window.__step([fk], 90);
    out.flakGround = fk.aiState.fkN || 0;
    p.pos.y += 10;
    window.__step([fk], 90, () => {
      p.pos.y = w.terrainHeight(p.pos.x, p.pos.z) + 10;
      return false;
    });
    out.flakAir = fk.aiState.fkN || 0;
    p.pos.y = w.terrainHeight(p.pos.x, p.pos.z);
    fk.takeDamage(1e9, 0, p, fk.center(), new THREE.Vector3(0, 0, 1));
    return out;
  });
  check(
    xy.ram.warned && xy.ram.hit && xy.ram.hurt > 0 && xy.ram.out > 5,
    '衝撞無人機：預警後衝撞，把目標往外推（' + JSON.stringify(xy.ram) + '）',
  );
  check(
    xy.flakGround === 0 && xy.flakAir > 0,
    '艦載防空砲：只對空中的目標射空炸彈（地面 ' + xy.flakGround + '、空中 ' + xy.flakAir + '）',
  );
  const ut = await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    g.state = 'foe-test';
    const e = g.bosses[0],
      p = g.player,
      w = g.world;
    p.hp = p.maxHp = 1e6;
    const log = (g.save.story.log || []).map((l) => l.sp);
    p.pos.set(8, w.terrainHeight(8, 0), 0);
    p.vel.set(0, 0, 0);
    e.pos.set(4, w.terrainHeight(4, 0), 0);
    e.aiState.shT = 0;
    window.__step([e], 30, () => p.vel.x > 5);
    return { name: e && e.name, comm: log.includes('undertow'), out: p.vel.x };
  });
  check(
    ut.name === 'UNDERTOW' && ut.comm && ut.out > 5,
    '精英區段：洋上都市是 UNDERTOW（貼身往外推），有通訊（' + ut.out.toFixed(1) + ' m/s）',
  );
  const xv = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['turbine', 'dome', 'monorail', 'rig', 'ship', 'spire'];
    ['dense', 'open', 'harbor', 'squall', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'xylem', 1300 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push(
        (g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0) + ':' + g.world.islands.blocks.length,
      );
    });
    return out;
  });
  check(
    xv.slice(0, 4).every((s, i) => s.startsWith(['dense', 'open', 'harbor', 'squall'][i])) &&
      xv.filter((s) => s.split(':')[1] === '1').length >= 5 &&
      +xv[0].split(':')[2] > +xv[1].split(':')[2],
    '洋上都市的 4 種變體（街區數不同）與地標（' + xv.join('、') + '）',
  );
  for (const v of ['dense', 'open', 'harbor', 'squall']) {
    await enter('xylem', v);
    await page.evaluate(() => (window.__game.state = 'play'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch5-xylem-' + v + '.png') });
  }
  // 第 5 章的出擊：終點 Boss、依抉擇 2 的路線
  const c5 = await page.evaluate(() => {
    const g = window.__game;
    if (g.camp) g.campEnd(false, true);
    g.state = 'play';
    const out = [];
    for (const sid of ['c5s1', 'c5s2a', 'c5s2b', 'c5s3']) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(sid + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0]);
      g.campEnd(false, true);
    }
    g.save.story.done = { c4s3b: 1, c5s1: 1 };
    g.save.story.choices = { c2: 'castron', c4: 'sancta' };
    out.push('route:' + ['c5s1', 'c5s2a', 'c5s2b', 'c5s3'].map((s) => g.hubSortieState(s)).join('/'));
    return out;
  });
  check(
    c5.join(',') === 'c5s1:AEGIS,c5s2a:LEVIATHAN,c5s2b:VIPER,c5s3:IGUAZU,route:done/hidden/open/locked',
    '第 5 章的出擊與終點 Boss、依抉擇 2 的路線（' + c5.join('、') + '）',
  );
  await ctx.close();
}

// 地圖專屬敵人擴充（C2 組）：燃料洩漏車、誘導飛彈架（舊宇宙港）、拋網無人機、迴旋刃無人機（洋上都市）、
// 反射鏡衛星、聚光鏡陣列（高空軌道）——各自生成、觸發招式（預警 → 攻擊）、截圖；模型庫三視角截圖與三角面數
async function testFoesC2(browser, base) {
  console.log('地圖專屬敵人擴充（C2）：舊宇宙港、洋上都市、高空軌道的新敵人');
  const { ctx, page } = await newPage(browser, 'foesc2');
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 主迴圈停住：招式的階段只由 __step 與截圖前的 __pump（固定的遊戲時間）推進，和負載無關；
  // 亂數也固定（招式的射線與彈道每次都一樣，同下面固定的地圖種子）
  await freezeLoop(page);
  // 每個 evaluate 開頭重設亂數種子：截圖前推進主迴圈時，天候粒子與文字演出依實際經過的時間取用亂數，會打亂後面的順序
  const ev = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        window.__reseed(4242);
        return (0, eval)('(' + src + ')')(a);
      },
      [fn.toString(), arg],
    );
  const enter = (theme) =>
    ev((theme) => {
      const g = window.__game;
      if (g.camp) g.campEnd(false, true);
      g.state = 'play';
      g.campBegin('c1s1');
      g.campSortie().segs[0].theme = theme;
      g.camp.plan[0] = { ...g.camp.plan[0], variant: '', landmark: '' };
      g.camp.types[0] = 'supply';
      g.camp.seeds[0] = 4242; // 固定地圖（招式的射線與彈道每次都一樣）
      g.campEnterSeg();
      g.state = 'foe-test';
      g.campCleared = () => {}; // 測試中擊破敵人不算區段清除（截圖不被橫幅蓋住）
      const p = g.player;
      p.hp = p.maxHp = 1e6;
      // 共用的場上機制與狀態效果（A 組）：有的話包起來記錄，沒有的話用記錄用的替身
      window.__zones = [];
      window.__status = [];
      if (!g.__c2wrap) {
        g.__c2wrap = true;
        const az = g.addZone;
        g.addZone = (...a) => {
          window.__zones.push(a[0]);
          return az ? az.apply(g, a) : window.__zones.length;
        };
      }
      const as = p.addStatus;
      p.addStatus = (...a) => {
        window.__status.push(a[0]);
        return as ? as.apply(p, a) : undefined;
      };
      window.__step = (ents, n, stop) => {
        for (let i = 0; i < n; i++) {
          g.time += 1 / 60;
          p.iFrames = 0;
          for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
          for (const e of ents) if (!e.dead) e.specialFx(1 / 60);
          for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
          g.projectiles = g.projectiles.filter((q) => !q.dead);
          g.updateHazards(1 / 60);
          g.hazards2Tick(1 / 60); // 區域效果（燃料、光束）
          if (stop && stop()) return i;
        }
        return n;
      };
      // 玩家附近、不是虛空的地面點（相對玩家 dx, dz；h＝離地高度）
      window.__at = (dx, dz, h = 0) => {
        const w = g.world;
        const r0 = Math.hypot(dx, dz),
          a0 = Math.atan2(dz, dx);
        for (let k = 0; k < 72; k++) {
          const a = a0 + (k % 2 ? 1 : -1) * Math.ceil((k >> 1) / 3) * 0.3;
          const r = r0 * [1, 0.8, 1.2][(k >> 1) % 3];
          const x = p.pos.x + Math.cos(a) * r,
            z = p.pos.z + Math.sin(a) * r;
          if (w.isVoid && w.isVoid(x, z)) continue;
          const q = new THREE.Vector3(x, w.groundAt(x, z, p.pos.y + 3) + h, z);
          // 和玩家之間沒有障礙物（招式的射線與彈道不被地圖擋住）
          if (![1, 3, 4.5].every((y) => g.losClear(q.clone().setY(q.y + y), p.center()))) continue;
          return q;
        }
        return new THREE.Vector3(p.pos.x + dx, p.pos.y + h, p.pos.z + dz);
      };
      // 新地圖先跑幾格主迴圈（更新與算繪：機體的矩陣、鏡頭），以前是靠兩次 evaluate 之間的實際幾格
      window.__pump(0.25);
    }, theme);
  // 截圖：讓主迴圈推進 ms 毫秒的遊戲時間（敵人也照常行動），之後停回測試狀態
  const shot = async (name, ms = 350) => {
    await ev((sec) => {
      const g = window.__game;
      if (g.popups) g.popups.length = 0;
      g.state = 'play';
      window.__pump(sec);
    }, ms / 1000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'foesc2-' + name + '.png') });
    await ev(() => (window.__game.state = 'foe-test'));
  };
  const clear = () =>
    ev(() => {
      const g = window.__game;
      for (const e of g.enemies)
        if (!e.dead) {
          e.gone = true; // 不觸發擊破時的燃燒
          e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
        }
      g.projectiles = [];
      g.clearHazards();
      g.player.hp = g.player.maxHp;
    });
  // ---- 舊宇宙港 ----
  await enter('spaceport');
  const fu = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('fueler', 1, 1, window.__at(0, -9), 1);
    window.__fu = e;
    let warned = false;
    window.__step([e], 900, () => {
      if (e.bossVis === 1) warned = true;
      return e.aiState.c2 && e.aiState.c2.n >= 1;
    });
    return {
      n: e.aiState.c2.n,
      warned,
      zones: window.__zones.slice(),
      fuel: (g.zones || []).some((z) => z.k === 'fuel'),
      later: (g.hzLater || []).length,
      res: e.res,
      intro: !!(g.introSeen && g.introSeen.has('fueler')),
    };
  });
  await shot('fueler');
  const fu2 = await ev(() => {
    const g = window.__game,
      e = window.__fu;
    e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    const pools = g.hzPools || [];
    return { dead: e.dead, burst: !!e.c2Burst, big: pools.some((q) => q.R >= 9) };
  });
  check(
    fu.n >= 1 && fu.warned && fu.zones.includes('fuel') && fu.fuel && fu.res && fu.res[0] < 0 && fu.intro,
    '燃料洩漏車：預警後灑燃料（' + JSON.stringify(fu.zones) + '）、弱點實彈、第一次出現的說明',
  );
  check(fu2.dead && fu2.burst && fu2.big, '燃料洩漏車：擊破時原地大範圍燃燒');
  await shot('fueler-burn', 600);
  await clear();
  const mr = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('missilerack', 1, 1, window.__at(-17, -5), 1);
    window.__mr = e;
    let warned = false;
    window.__step([e], 900, () => {
      if (e.aiState.c2 && e.aiState.c2.ph === 1) warned = true;
      return warned;
    });
    return { warned };
  });
  await shot('missilerack-warn', 200);
  const mr2 = await ev(() => {
    const g = window.__game,
      p = g.player,
      e = window.__mr;
    const c = e.aiState.c2;
    c.ph = 1;
    c.t = 0.01;
    c.shot = null;
    // 地圖的障礙物與可破壞物件先拿掉（只測飛彈本身；撞障礙物在下一項）
    const w = g.world,
      ob = w.obstacles,
      pr = w.props;
    w.obstacles = [];
    w.props = [];
    window.__step([e], 300, () => !!c.shot);
    const m = c.shot;
    const info = m
      ? {
          kind: m.kind,
          target: m.target === p,
          shootable: m.shootable,
          sp: +m.vel.length().toFixed(1),
          dmg: Math.round(m.dmg),
        }
      : null;
    const tips = e.model.tips.some((t) => !t.visible);
    const h0 = p.hp;
    if (m) window.__step([e], 900, () => m.dead);
    w.obstacles = ob;
    w.props = pr;
    return { info, hurt: h0 - p.hp, tips };
  });
  check(
    mr.warned &&
      mr2.info &&
      mr2.info.kind === 'missile' &&
      mr2.info.target &&
      mr2.info.shootable > 0 &&
      mr2.info.sp <= 18 &&
      mr2.tips &&
      mr2.hurt > 500,
    '誘導飛彈架：預警線後發射慢速的大型追蹤飛彈（可擊落）、命中高傷害（' +
      JSON.stringify(mr2.info) +
      '，傷害 ' +
      Math.round(mr2.hurt) +
      '）',
  );
  // 繞到障礙物後面：飛彈撞上障礙物就爆炸
  const mr3 = await ev(() => {
    const g = window.__game,
      p = g.player,
      e = window.__mr,
      w = g.world;
    const c = e.aiState.c2;
    c.ph = 1;
    c.t = 0.01;
    c.shot = null;
    window.__step([e], 300, () => !!c.shot);
    const m = c.shot;
    // 在飛彈與玩家之間放一道牆（8 m 見方）：牆的中心離玩家 9 m，飛彈撞上的那一面在 13 m 外，爆炸（半徑 5 m）波及不到玩家。
    // 以前是飛 30 格後放在正中間，飛彈架被 AI 帶近時飛彈只剩 6 m，牆貼著玩家、爆炸也打得到（和亂數有關）
    window.__step([e], 30, () => m.pos.distanceTo(p.center()) < 14);
    const dm = m.pos.distanceTo(p.center());
    const mid = p.center().lerp(m.pos, dm > 13.5 ? 9 / dm : 0.5);
    const y = w.terrainHeight(mid.x, mid.z);
    const o = { kind: 'box', x: mid.x, z: mid.z, w: 8, d: 8, y, top: y + 40, h: 40 };
    w.obstacles.push(o);
    const h0 = p.hp;
    window.__step([e], 900, () => m.dead);
    w.obstacles.splice(w.obstacles.indexOf(o), 1);
    return { dead: m.dead, hurt: h0 - p.hp };
  });
  check(
    mr3.dead && mr3.hurt < 300,
    '誘導飛彈架：飛彈撞上障礙物就爆炸（甩掉，傷害 ' + Math.round(mr3.hurt) + '）',
  );
  await clear();
  // ---- 洋上都市 ----
  await enter('xylem');
  const nt = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('netter', 1, 1, window.__at(13, -5, 3), 1);
    window.__nt = e;
    let warned = false;
    window.__step([e], 900, () => {
      if (e.aiState.c2 && e.aiState.c2.ph === 1) warned = true;
      return warned;
    });
    return { warned };
  });
  await shot('netter-warn', 250);
  const nt2 = await ev(() => {
    const g = window.__game,
      p = g.player,
      e = window.__nt;
    const c = e.aiState.c2;
    if (c.ph !== 1) {
      c.ph = 0;
      c.t = 0.01;
    }
    const h0 = p.hp;
    window.__step([e], 900, () => (c.hits || 0) >= 1);
    return {
      hits: c.hits || 0,
      n: c.n || 0,
      status: window.__status.slice(),
      net: p.hasStatus('net'),
      hurt: h0 - p.hp,
      fly: e.flying,
    };
  });
  check(
    nt.warned && nt2.hits >= 1 && nt2.status.includes('net') && nt2.net && nt2.hurt > 0,
    '拋網無人機：預警線後射網，打中套上「網」（' + JSON.stringify(nt2) + '）',
  );
  await clear();
  const bm = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('boomer', 1, 1, window.__at(-14, -5, 3), 1);
    window.__bm = e;
    let warned = false;
    window.__step([e], 900, () => {
      if (e.aiState.c2 && e.aiState.c2.ph === 1) warned = true;
      return e.aiState.c2 && e.aiState.c2.ph === 2 && e.aiState.c2.ft > 0.15;
    });
    return { warned, bx: !!e.bx, vis: e.model.blade.visible, blade: !!e.c2Blade };
  });
  await shot('boomer-throw', 120);
  const bm2 = await ev(() => {
    const g = window.__game,
      p = g.player,
      e = window.__bm;
    const c = e.aiState.c2;
    c.ph = 1;
    c.t = 0.01;
    const lead = new THREE.Vector3();
    const mz = e.muzzle('rarm');
    c.aimP = p.center().add(lead);
    c.to = c.aimP.clone().add(p.center().sub(mz).setLength(6));
    const h0 = p.hp;
    window.__step([e], 5);
    window.__step([e], 400, () => c.ph !== 2);
    return {
      out: c.hitOut.size,
      back: c.hitBack.size,
      hurt: Math.round(h0 - p.hp),
      caught: c.ph === 0,
      bx: e.bx,
    };
  });
  check(
    bm.warned && bm.bx && !bm.vis && bm.blade && bm2.out === 1 && bm2.back === 1 && bm2.caught && !bm2.bx,
    '迴旋刃無人機：預警後丟出迴旋刃（bx 同步位置），去程與回程各打中一次、飛回本體（' +
      JSON.stringify(bm2) +
      '）',
  );
  await clear();
  // ---- 高空軌道 ----
  await enter('orbit');
  const mi = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('mirror', 1, 1, window.__at(15, -6, 6), 1);
    window.__mi = e;
    let warned = false;
    window.__step([e], 900, () => {
      if (e.aiState.c2 && e.aiState.c2.ph === 1) warned = true;
      return warned;
    });
    // 雷射類（雷射步槍 w_lr）打它只有 30%：和同樣能量屬性、沒有武器的傷害比較
    e.hp = e.maxHp = 1e7;
    let h = e.hp;
    e.takeDamage(1000, 0, g.player, e.center(), null, undefined, 'w_lr', 'en');
    const las = h - e.hp;
    h = e.hp;
    e.takeDamage(1000, 0, g.player, e.center(), null, undefined, undefined, 'en');
    const en = h - e.hp;
    return { warned, laserK: e.laserK, ratio: en > 0 ? +(las / en).toFixed(2) : -1 };
  });
  await shot('mirror-warn', 300);
  const mi2 = await ev(() => {
    const g = window.__game,
      p = g.player,
      e = window.__mi;
    const c = e.aiState.c2;
    e.pos.copy(window.__at(14, -6, 8));
    e.vel.set(0, 0, 0);
    c.ph = 1;
    c.t = 0.3;
    c.aim = p.center();
    const h0 = p.hp,
      n0 = c.n || 0;
    const w = g.world,
      ob = w.obstacles,
      pr = w.props;
    w.obstacles = [];
    w.props = [];
    window.__step([e], 300, () => (c.n || 0) > n0);
    w.obstacles = ob;
    w.props = pr;
    return { n: (c.n || 0) - n0, hurt: h0 - p.hp };
  });
  check(
    mi.warned && mi.laserK === 0.3 && Math.abs(mi.ratio - 0.3) < 0.02 && mi2.n >= 1 && mi2.hurt > 0,
    '反射鏡衛星：雷射 30%（laserK，實測 ' +
      mi.ratio +
      '）、蓄力後射出聚光光束（傷害 ' +
      Math.round(mi2.hurt) +
      '）',
  );
  await clear();
  const fc = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.spawnType('focus', 1, 1, window.__at(-16, -5), 1);
    window.__fc = e;
    let warned = false;
    const lc = g.losClear;
    g.losClear = () => true; // 中間剛好有物件時也照樣測
    window.__step([e], 900, () => {
      if (e.aiState.c2 && e.aiState.c2.ph === 1) warned = true;
      return e.aiState.c2 && e.aiState.c2.ph === 2;
    });
    // 光束剛開始與 4 秒後的傷害（共用的光束還沒有時是自己算的）
    const c = e.aiState.c2;
    let h = p.hp;
    window.__step([e], 60);
    const d0 = h - p.hp;
    window.__step([e], 150);
    h = p.hp;
    window.__step([e], 60);
    const d1 = h - p.hp;
    g.losClear = lc;
    return { warned, zones: window.__zones.slice(), d0, d1, vis: e.bossVis, ph: c.ph, bx: !!e.bx };
  });
  await ev(() => {
    const g = window.__game;
    g.__lc = g.losClear;
    g.losClear = () => true;
  });
  await shot('focus-beam', 250);
  const fc2 = await ev(() => {
    const g = window.__game,
      e = window.__fc;
    g.losClear = g.__lc;
    const c = e.aiState.c2;
    if (c.ph !== 2) return { skip: c.ph };
    // 掩體：視線被擋住就斷開
    const lc = g.losClear;
    g.losClear = () => false;
    window.__step([e], 5);
    g.losClear = lc;
    return { ph: c.ph, broke: c.broke || 0, bx: e.bx };
  });
  check(
    fc.warned && fc.ph === 2 && fc.bx && fc.zones.includes('beam') && fc.d1 > fc.d0 * 1.5 && fc.vis >= 2,
    '聚光鏡陣列：預警後的追蹤光束越照越痛（1 秒 ' +
      Math.round(fc.d0) +
      ' → ' +
      Math.round(fc.d1) +
      '，' +
      JSON.stringify(fc.zones) +
      '）',
  );
  check(fc2.broke === 1 && fc2.ph === 3 && !fc2.bx, '聚光鏡陣列：視線被擋住時光束斷開');
  await clear();
  // 主線的編成：各主題的專屬敵人清單含新敵人
  const tf = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    for (const t of ['spaceport', 'xylem', 'orbit']) {
      const comp = g.foeMix(g.rollComp(6, 1), t, 0);
      out[t] = [...new Set(comp.map((c) => (typeof c === 'string' ? c : c.t || c.type || '')))].join('/');
    }
    return out;
  });
  console.log('    編成：' + JSON.stringify(tf));
  await ctx.close();
  // ---- 模型庫：三視角截圖、三角面數 ----
  const lib = await newPage(browser, 'foesc2-lib');
  for (const k of ['fueler', 'missilerack', 'netter', 'boomer', 'mirror', 'focus']) {
    await lib.page.goto(base + 'model-library.html#vehicle/foe_' + k);
    await lib.page.waitForSelector('#inspect:not([hidden])', { timeout: 15000 }).catch(() => {});
    await wait(1800);
    const info = (await lib.page.textContent('#insInfo').catch(() => '')) || '';
    const tri = +((info.match(/三角面\s*([\d,]+)/) || [])[1] || '0').replace(/,/g, '');
    check(tri > 1500 && tri <= 6000, `模型庫 ${k}：三角面 ${tri}（≤ 6000）`);
    const box = await lib.page.$eval('#insView canvas', (c) => {
      const r = c.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    });
    await lib.page.screenshot({ path: path.join(SHOT_DIR, `foesc2-lib-${k}-a.png`) });
    for (const j of ['b', 'c']) {
      await lib.page.mouse.move(box[0], box[1]);
      await lib.page.mouse.down();
      await lib.page.mouse.move(box[0] + 130, box[1], { steps: 6 });
      await lib.page.mouse.move(box[0] + 260, box[1], { steps: 6 });
      await lib.page.mouse.up();
      await wait(700);
      await lib.page.screenshot({ path: path.join(SHOT_DIR, `foesc2-lib-${k}-${j}.png`) });
    }
  }
  await lib.ctx.close();
}

// 增援波次：編成分成 3～5 波、敵對 AC 在最後一波、剩下少數時預告方向（ECHO、光柱、畫面指示）後在預告地點出現
// 過關條件：每個回合開始時中央的卡片（過關／失敗條件）、之後左上一直顯示；自由出擊、主線的防衛區段、自訂關卡
async function testGoals(browser, base) {
  console.log('過關條件：回合開始的卡片與左上的常駐顯示');
  const { ctx, page } = await newPage(browser, 'goals');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const card = () =>
    page.evaluate(() => {
      const el = document.getElementById('goalCard');
      const ht = document.getElementById('hudTop');
      return {
        on: !!el && el.classList.contains('on'),
        txt: el ? el.textContent : '',
        line: (ht.querySelector('.goalLine') || { textContent: '' }).textContent,
      };
    });
  // 自由出擊：開場時還沒出現，過一下才出現
  const pre = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 2;
    g.startMission();
    const el = document.getElementById('goalCard');
    return !el || !el.classList.contains('on');
  });
  await page.evaluate(() => window.__game.goalTick(3));
  await page.waitForTimeout(300);
  const a = await card();
  await page.screenshot({ path: path.join(SHOT_DIR, 'goals-free.png') });
  check(
    pre &&
      a.on &&
      a.txt.includes('過關條件') &&
      a.txt.includes('擊破所有敵軍') &&
      a.txt.includes('機體被擊破'),
    `自由出擊：開場後出現過關條件卡片（${a.txt.slice(0, 60)}）`,
  );
  check(a.line.includes('擊破所有敵軍'), `自由出擊：左上一直顯示過關條件（${a.line}）`);
  await page.evaluate(() => window.__game.goalTick(7));
  await page.waitForTimeout(300);
  const a2 = await card();
  check(!a2.on && a2.line.includes('擊破所有敵軍'), '卡片幾秒後收起，左上仍顯示');
  // 主線：防衛區段
  await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1s1');
    g.camp.types[0] = 'defend';
    g.campEnterSeg();
    g.goalTick(3);
  });
  await page.waitForTimeout(300);
  const b = await card();
  await page.screenshot({ path: path.join(SHOT_DIR, 'goals-camp.png') });
  check(
    b.on && b.txt.includes('防衛') && b.txt.includes('防衛目標被摧毀') && b.txt.includes('區段 1'),
    `主線區段：防衛的過關與失敗條件（${b.txt.slice(0, 80)}）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
  });
  // 自訂關卡（第一個範例：有出口）
  await page.evaluate(() => {
    const g = window.__game;
    g.lvPlay(g.lvSamples()[0], { src: 'sample' });
    g.goalTick(3);
  });
  await page.waitForTimeout(300);
  const c = await card();
  await page.screenshot({ path: path.join(SHOT_DIR, 'goals-level.png') });
  check(
    c.on && c.txt.includes('出口') && c.line.length > 2,
    `自訂關卡：依關卡內容的過關條件（${c.txt.slice(0, 80)}）`,
  );
  await ctx.close();
}

// 敵人 AI：視線、感知（視角與距離、聲音、受到攻擊、無線電）、攻擊權杖（同時最多 3 台主攻、輪替）、預警招式
async function testEnemyAI(browser, base) {
  console.log('敵人 AI：感知、警戒、仇恨、視線、攻擊權杖、預警招式');
  const { ctx, page } = await newPage(browser, 'enemy-ai');
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 結果只由亂數決定：地圖（startMission 的種子與編成）、生成位置、AI 的移動與冷卻都用 Math.random，
  // 隨機地圖上障礙物擋住後退的路線時「退到外圈」的平均距離會不夠（50 次裡 2 次，最低 19 m），背後找不到看得到的位置、
  // 主攻只輪替 3 台、只放一種招式的也各有幾 %（種子 16 的地圖每項都有餘裕）。所以停住主迴圈（state 'ai-test' 也會跑任務的更新，
  // 兩次 evaluate 之間依實際時間跑了不定的幾格）、每段開頭重設亂數種子，每次都是同一張地圖、同樣的過程
  await freezeLoop(page);
  const r = await page.evaluate(() => {
    window.__reseed(16);
    const g = window.__game;
    g.save.level = 5;
    g.startMission();
    g.state = 'ai-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    g.waves = [];
    g.wavePend = null;
    const dt = 1 / 60;
    const W = g.world;
    const out = {};
    // 據點的守衛（另外有守在原地的規則）與支援類（運輸機、修理…）不算
    const main = g.enemies.filter((e) => !e.guardOf && e.senseOn());
    out.idle = main.filter((e) => e.sn.st === 0).length;
    out.first = main.length;
    // 視線：方塊障礙物兩側被擋住、上方看得到（地圖是隨機的，所以在出生點放一個測試用的方塊、只留它）
    {
      const obs = W.obstacles;
      const x = pl.pos.x,
        z = pl.pos.z,
        h0 = W.terrainHeight(x, z);
      W.obstacles = [{ kind: 'box', x, z, w: 6, d: 6, y: h0, top: h0 + 8 }];
      const y = h0 + 1.5;
      out.losBlock = W.losBlocked(new THREE.Vector3(x - 7, y, z), new THREE.Vector3(x + 7, y, z));
      out.losOver = W.losBlocked(new THREE.Vector3(x - 7, h0 + 12, z), new THREE.Vector3(x + 7, h0 + 12, z));
      W.obstacles = obs;
    }
    for (const e of g.enemies) e.takeDamage(1e9, 0, null, e.center());
    // 測試用的待機 MT
    const mk = () => {
      g.spawnIdle = true;
      const e = g.spawnType('mt', 1, 1, null, 1);
      g.spawnIdle = false;
      e.sn.wT = 99;
      e.sn.wGoal = null;
      return e;
    };
    // 找一個看得到的位置：從 e 的正面（ang＝相對面向的角度）距離 dist
    const spot = (e, ang, dist) => {
      for (let i = 0; i < 40; i++) {
        const a = e.yaw + ang + (i % 2 ? 1 : -1) * Math.floor(i / 2) * 0.05;
        const dd = dist + (i % 5);
        const x = e.pos.x - Math.sin(a) * dd,
          z = e.pos.z - Math.cos(a) * dd;
        const p = new THREE.Vector3(x, W.groundAt(x, z, 50), z);
        if (!W.losBlocked(e.eye(), p.clone().setY(p.y + 1.6))) return p;
      }
      return null;
    };
    const step = (list, sec) => {
      for (let t = 0; t < sec; t += dt) {
        g.time += dt;
        for (const e of list) if (!e.dead) e.updateAI(dt);
      }
    };
    // 背後看不到
    const eB = mk();
    const pB = spot(eB, Math.PI, 26);
    if (pB) {
      pl.pos.copy(pB);
      step([eB], 1.5);
      out.behind = eB.sn.st;
    }
    eB.takeDamage(1e9, 0, null, eB.center());
    // 正面看得到：察覺量表滿了才交戰
    // 測試的 MT 生成在隨機的出生點：站在高處（貨櫃上）或中間剛好有障礙物時，量表上升時走過去查看會被擋住視線
    // （和負載無關、約 3% 的地圖）。所以挑兩者都站在地面、從 MT 往玩家的前 70% 路上沒有障礙物也看得到玩家的位置
    let eF = null,
      pF = null;
    for (let k = 0; k < 40 && !pF; k++) {
      if (eF) eF.takeDamage(1e9, 0, null, eF.center());
      eF = mk();
      pF = Math.abs(eF.pos.y - W.terrainHeight(eF.pos.x, eF.pos.z)) < 0.5 ? spot(eF, 0, 24) : null;
      if (!pF) continue;
      pl.pos.copy(pF);
      const pc = pl.center();
      const clear = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7].every((f) => {
        if (W.losBlocked(eF.eye().lerp(pc, f), pc)) return false;
        if (!f) return true;
        const q = eF.pos.clone().lerp(pF, f);
        const c = W.collide(q.x, q.z, W.terrainHeight(q.x, q.z), 2);
        return Math.abs(c[0] - q.x) < 1e-6 && Math.abs(c[1] - q.z) < 1e-6;
      });
      if (!clear || Math.abs(pF.y - W.terrainHeight(pF.x, pF.z)) > 0.5) pF = null;
    }
    if (pF) {
      pl.pos.copy(pF);
      let t = 0;
      while (eF.sn.st !== 2 && t < 3) {
        step([eF], 0.05);
        t += 0.05;
      }
      out.front = eF.sn.st;
      out.frontT = +t.toFixed(2);
    }
    eF.takeDamage(1e9, 0, null, eF.center());
    // 聲音：開火讓附近的待機敵人起疑
    const eN = mk();
    pl.pos.set(eN.pos.x + 30, eN.pos.y, eN.pos.z);
    g.aiFireNoise(pl, 'bullet');
    out.noise = eN.sn.st;
    eN.takeDamage(1e9, 0, null, eN.center());
    // 受到攻擊：直接交戰＋仇恨；無線電通知 35 m 內的待機友軍
    const eH = mk(),
      eR = mk();
    eR.pos.set(eH.pos.x + 10, eH.pos.y, eH.pos.z);
    pl.pos.set(eH.pos.x + 70, eH.pos.y, eH.pos.z + 70);
    eH.takeDamage(1, 0, pl, eH.center());
    out.hit = eH.sn.st;
    out.threat = +(eH.sn.th.get(pl.id) || 0).toFixed(2);
    out.radio0 = eR.sn.st;
    step([eH], 1.2);
    out.radio = eR.sn.st;
    for (const e of g.enemies) if (!e.dead) e.takeDamage(1e9, 0, null, e.center());
    g.enemies = g.enemies.filter((e) => !e.dead);
    return out;
  });
  check(r.idle > 0 && r.idle === r.first, `第一波在原地待機（${r.idle}/${r.first}）`);
  check(
    r.losBlock === true && r.losOver === false,
    `視線：障礙物兩側擋住、上方看得到（${r.losBlock}／${r.losOver}）`,
  );
  check(r.behind !== undefined && r.behind !== 2, `背後 26 m 看不到（狀態 ${r.behind}）`);
  check(r.front === 2 && r.frontT > 0.1 && r.frontT < 2.5, `正面 24 m 看得到：${r.frontT} 秒後交戰`);
  check(r.noise === 1, `玩家開火讓附近的待機敵人起疑（狀態 ${r.noise}）`);
  check(r.hit === 2 && r.threat > 0, `受到攻擊直接交戰、累積仇恨（${r.threat}）`);
  check(r.radio0 === 0 && r.radio === 2, '發現後以無線電通知附近的待機友軍');
  // 攻擊權杖：一大群敵人在鏡頭前方，推進 12 秒遊戲時間——同時最多 3 台主攻、會輪替、會放預警招式；沒拿到的退到外圈
  const t = await page.evaluate(() => {
    window.__reseed(16);
    const g = window.__game;
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    pl.pos.set(0, g.world.groundAt(0, 0, 50), 0);
    const dt = 1 / 30;
    for (let i = 0; i < 30; i++) g.updateCamera(dt);
    const f = g.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const a0 = Math.atan2(f.z, f.x);
    const types = ['mt', 'mt', 'mt', 'mt', 'mth', 'mth', 'drone', 'mt_gren', 'mt', 'tank'];
    types.forEach((t, i) => {
      const a = a0 + (i / (types.length - 1) - 0.5) * 1.6,
        R = 20 + (i % 3) * 5;
      const x = Math.cos(a) * R,
        z = Math.sin(a) * R;
      g.spawnType(t, 1, 1, new THREE.Vector3(x, g.world.groundAt(x, z, 50), z), 1);
    });
    const L = { maxHold: 0, holders: new Set(), moves: new Set(), samples: 0, holdSum: 0, supD: 0, supN: 0 };
    for (let k = 0; k < 360; k++) {
      g.time += dt;
      pl.pos.set(0, g.world.groundAt(0, 0, 50), 0);
      g.aiDirectorTick(dt);
      for (const e of g.enemies) if (!e.dead) e.updateAI(dt);
      g.projectiles.length = 0;
      g.updateCamera(dt);
      if (k % 3) continue;
      const live = g.enemies.filter((e) => !e.dead && e.sn);
      const h = live.filter((e) => e.sn.tok && !e.ace);
      L.maxHold = Math.max(L.maxHold, h.length);
      if (k > 60) {
        L.samples++;
        L.holdSum += h.length;
      }
      for (const e of h) L.holders.add(e.id);
      for (const e of live) {
        if (e.sn.mv) L.moves.add(e.sn.mv.k);
        if (!e.sn.tok && k > 180) {
          L.supD += e.pos.distanceTo(pl.pos);
          L.supN++;
        }
      }
    }
    return {
      maxHold: L.maxHold,
      avg: +(L.holdSum / L.samples).toFixed(2),
      rot: L.holders.size,
      moves: [...L.moves].join(','),
      supD: Math.round(L.supD / Math.max(1, L.supN)),
    };
  });
  check(t.maxHold <= 3 && t.avg >= 1, `一群敵人同時最多 3 台主攻（最多 ${t.maxHold}、平均 ${t.avg}）`);
  check(t.rot >= 4, `主攻會輪替（拿過權杖的 ${t.rot} 台）`);
  check(t.moves.split(',').filter(Boolean).length >= 2, `主攻放預警招式（${t.moves}）`);
  check(t.supD >= 28, `沒拿到權杖的退到外圈（平均 ${t.supD} m）`);
  await page.evaluate(() => {
    window.__game.state = 'play';
    window.__pump(0.6);
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'enemy-ai.png') });
  await ctx.close();
}

async function testWaves(browser, base) {
  console.log('增援波次：分波、預告方向、在預告的地點出現');
  const { ctx, page } = await newPage(browser, 'waves');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 5;
    g.startMission();
    g.state = 'wave-test';
    g.player.hp = g.player.maxHp = 1e7;
    const dt = 1 / 60;
    const live = () => g.enemies.filter((e) => !e.dead);
    const out = {
      N: g.waveN,
      first: live().length,
      lastAce: g.waves[g.waves.length - 1].some((t) => t === 'ac' || /^ac_/.test(t)),
      waves: [],
    };
    out.lastList = g.waves[g.waves.length - 1].join(',');
    for (let k = 0; k < 6 && (g.waves.length || g.wavePend); k++) {
      for (const e of live()) e.takeDamage(1e9, 0, g.player, e.center());
      let t = 0;
      while (!g.wavePend && t < 10) {
        g.waveTick(dt);
        t += dt;
      }
      const pend = g.wavePend;
      if (!pend) break;
      const say = document.getElementById('comm').textContent;
      const marks = (g.waveMarks || []).length;
      g.drawHud(dt);
      const n0 = g.enemies.length;
      while (g.wavePend) g.waveTick(dt);
      const fresh = g.enemies.slice(n0);
      // 站上高處的（perch）照自己的規則找位置
      const near = fresh.filter(
        (e) => e.opts.perch || Math.hypot(e.pos.x - pend.pos.x, e.pos.z - pend.pos.z) < 45,
      ).length;
      out.waves.push({
        t: +t.toFixed(1),
        say,
        marks,
        drop: pend.drop,
        n: fresh.length,
        near,
        names: fresh.map((e) => e.name).join('/'),
      });
    }
    out.end = !g.waves.length && !g.wavePend;
    return out;
  });
  const W = r.waves;
  check(r.N >= 3 && r.N <= 5 && r.first >= 2, `編成分成 ${r.N} 波、第一波 ${r.first} 台`);
  check(
    W.length === r.N - 1 &&
      W.every((w) => /點鐘方向/.test(w.say) && /第 \d\/\d 波/.test(w.say) && w.marks > 0) &&
      /最後一波/.test(W[W.length - 1].say),
    '每一波出現前 ECHO 預告幾點鐘方向與第幾波、畫面上有增援指示（' +
      W.map((w) => w.say.replace(/^.*?ECHO/, '')).join('｜') +
      '）',
  );
  check(
    W.every((w) => w.n > 0 && w.near === w.n),
    '增援出現在預告的地點附近（' + W.map((w) => `${w.near}/${w.n}${w.drop ? '空降' : ''}`).join('、') + '）',
  );
  check(r.lastAce, '敵對 AC 在最後一波（' + r.lastList + '）');
  check(r.end, '派完所有波次');
  // 截圖：預告中的光柱與指示
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.save.level = 5;
    g.startMission();
    for (const e of g.enemies) e.takeDamage(1e9, 0, g.player, e.center());
    g.player.hp = g.player.maxHp = 1e7;
    g.waveGap = 0;
    g.waveLaunch();
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT_DIR, 'waves-warn.png') });
  await ctx.close();
}

// 據點：補給箱與守衛（守在原地、靠近才出動、不算主要戰力）、開箱獎勵、自由出擊的撤離時間、主線區段也有
async function testOutposts(browser, base) {
  console.log('據點：補給箱、守衛、撤離');
  const { ctx, page } = await newPage(browser, 'outposts');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 5;
    g.startMission();
    g.state = 'cache-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const dt = 1 / 60;
    const out = { n: g.caches.length, kinds: g.caches.map((c) => c.kind).join(',') };
    out.guards = g.caches.map((c) => g.enemies.filter((e) => e.guardOf === c.id).length);
    out.far = Math.min(...g.caches.map((c) => Math.hypot(c.pos.x - pl.pos.x, c.pos.z - pl.pos.z)));
    // 守衛守在原地
    const gs = g.enemies.filter((e) => e.guardOf);
    const p0 = gs.map((e) => e.pos.clone());
    for (let i = 0; i < 120; i++) for (const e of g.enemies) if (!e.dead) e.updateAI(dt);
    out.idle = Math.max(...gs.map((e, i) => (e.dead ? 0 : Math.hypot(e.pos.x - p0[i].x, e.pos.z - p0[i].z))));
    // 主要戰力全滅（守衛還在）：自由出擊給撤離時間
    g.waves = [];
    g.wavePend = null; // 已預告、還沒出現的增援也取消
    // 護盾產生器的護盾罩著自己（和範圍內的友軍）：第一下只打破護盾，所以重複打到擊破；
    // 前面 120 格的 AI 可能剛好 QB（短暫無敵），先清掉無敵時間
    const kill = (e) => {
      for (let k = 0; k < 4 && !e.dead; k++) {
        e.iFrames = 0;
        e.takeDamage(1e9, 0, pl, e.center());
      }
    };
    for (const e of g.enemies.slice()) if (!e.guardOf) kill(e);
    out.mainLeft = g.enemies.filter((e) => !e.dead && !e.guardOf).length;
    out.extract = g.extractStart() && g.extract;
    // 走到第一個箱子旁：守衛出動、站 1.2 秒打開
    const c = g.caches[0];
    pl.pos.set(c.pos.x + 1, c.pos.y, c.pos.z);
    for (const e of g.enemies) if (!e.dead && e.guardOf === c.id) e.updateAI(dt);
    out.alert = g.enemies.filter((e) => e.guardOf === c.id).every((e) => e.guardAlert);
    const coam0 = g.save.coam;
    pl.hp = pl.maxHp * 0.5;
    const hp0 = pl.hp;
    for (let i = 0; i < 90; i++) g.cacheTick(dt);
    out.opened = c.opened;
    out.reward = c.kind + ':' + (g.save.coam - coam0) + '/' + Math.round(pl.hp - hp0);
    // 剩下的也打開：提早撤離
    for (const k of g.caches.slice(1)) {
      pl.pos.set(k.pos.x, k.pos.y, k.pos.z);
      for (let i = 0; i < 90; i++) g.cacheTick(dt);
    }
    g.state = 'play';
    g.cacheTick(dt);
    out.ended = g.state;
    return out;
  });
  check(
    r.n >= 2 && r.n <= 3 && r.guards.every((n) => n >= 1) && r.far >= 40,
    `據點 ${r.n} 個（${r.kinds}）、各有守衛 ${r.guards.join('/')} 台、離出生點 ${Math.round(r.far)} m 以上`,
  );
  check(r.idle < 1.5, `守衛還沒出動時守在原地（移動 ${r.idle.toFixed(2)} m）`);
  check(r.mainLeft === 0 && r.extract === 30, `主要戰力全滅、守衛還在：自由出擊給 ${r.extract} 秒撤離時間`);
  check(r.alert, '玩家靠近時整隊守衛出動');
  check(r.opened && !/^coam:0|^repair:\d+\/0$/.test(r.reward), `站在箱子旁打開、拿到獎勵（${r.reward}）`);
  check(r.ended === 'ending', `補給箱全部打開就提早撤離（${r.ended}）`);
  // 主線的一般戰鬥區段也有據點；守衛不擋區段清除
  const camp = await page.evaluate(async () => {
    const g = window.__game;
    g.clearMission();
    g.state = 'play';
    g.campBegin('c1s2');
    g.camp.types[0] = 'battle';
    g.campEnterSeg();
    g.player.hp = g.player.maxHp = 1e7;
    const n = g.caches.length;
    g.waves = [];
    g.wavePend = null; // 已預告、還沒出現的增援也取消
    // 護盾產生器要先打破護盾（同上），重複打到擊破
    for (const e of g.enemies.slice())
      for (let k = 0; k < 4 && !e.guardOf && !e.dead; k++) {
        e.iFrames = 0;
        e.takeDamage(1e9, 0, g.player, e.center());
      }
    for (let i = 0; i < 30 && !g.camp.cleared; i++) await new Promise((res) => setTimeout(res, 100));
    const out = { n, cleared: g.camp.cleared, guards: g.enemies.filter((e) => !e.dead && e.guardOf).length };
    g.campEnd(false, true);
    return out;
  });
  check(
    camp.n >= 2 && camp.cleared && camp.guards > 0,
    `主線區段也有據點 ${camp.n} 個，守衛還在（${camp.guards}）也能清除區段`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.save.level = 5;
    g.startMission();
    const c = g.caches[0];
    g.player.pos.set(c.pos.x + 9, c.pos.y, c.pos.z + 9);
    g.player.hp = g.player.maxHp = 1e7;
  });
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(SHOT_DIR, 'outpost-cache.png') });
  await ctx.close();
}

// 改變打法的戰術模組：連鎖殉爆、殉爆脈衝、能量虹吸、衝撞推進、緊急障壁
async function testModFx(browser, base) {
  console.log('戰術模組：改變打法的效果');
  const { ctx, page } = await newPage(browser, 'modfx');
  await seededRandom(page); // 地圖固定（隨機地圖偶爾在測試位置有高台或障礙物）
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    window.__reseed(8288);
    g.save.level = 5;
    g.startMission();
    g.state = 'modfx-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e6;
    const dt = 1 / 60;
    const out = {};
    const foes = () => g.enemies.filter((e) => !e.dead && !e.isBoss && e.ai !== 'objective');
    // 平地、沒有障礙物的位置（中心附近 ±r m 的地面都是地形本身、高低差小、不是虛空），從 (x, z) 附近找
    const W = g.world;
    const flat = (x, z, r) => {
      const h0 = W.terrainHeight(x, z);
      for (let dx = -r; dx <= r; dx += 1)
        for (let dz = -r; dz <= r; dz += 1) {
          const h = W.terrainHeight(x + dx, z + dz);
          if (
            Math.abs(h - h0) > 0.4 ||
            Math.abs(W.groundAt(x + dx, z + dz, 99) - h) > 0.05 ||
            W.isVoid(x + dx, z + dz)
          )
            return false;
        }
      return true;
    };
    const spot = (x, z, r) => {
      for (let k = 0; k < 400; k++) {
        const a = k * 2.4,
          d = Math.sqrt(k) * 3;
        const px = x + Math.cos(a) * d,
          pz = z + Math.sin(a) * d;
        if (Math.abs(px) < W.lim - r && Math.abs(pz) < W.lim - r && flat(px, pz, r)) return [px, pz];
      }
      return [x, z];
    };
    const put = (e, x, z) => {
      e.pos.set(x, g.world.groundAt(x, z, 99), z);
      e.mesh.position.copy(e.pos);
    };
    // 每次都用新生成的輕型 MT（地面、單台），不受隨機編成影響
    const fresh = (n) => {
      for (const e of foes()) e.pos.set(300, -50, 300);
      const list = [];
      for (let i = 0; i < n; i++) list.push(g.spawnType('mt', 1, 1, null, 1));
      for (const e of list) {
        e.hp = e.maxHp;
        e.staggerT = 0;
        e.acs = 0;
        e.iFrames = 0;
      }
      return list;
    };
    // 連鎖殉爆
    pl.pm = { ...(pl.pm || {}), killBlast: 1 };
    let [a, b] = fresh(2);
    let [sx, sz] = spot(20, 20, 4);
    put(a, sx, sz);
    put(b, sx + 2, sz);
    a.takeDamage(1e9, 0, pl, a.center());
    out.blast = b.hp < b.maxHp;
    // 殉爆脈衝
    pl.pm = { ...pl.pm, killBlast: 0, killStag: 1 };
    [a, b] = fresh(2);
    [sx, sz] = spot(-20, 20, 5);
    put(a, sx, sz);
    put(b, sx - 4, sz);
    a.takeDamage(1e9, 0, pl, a.center());
    out.stag = b.staggerT > 0;
    // 能量虹吸
    pl.pm = { ...pl.pm, killStag: 0, hitEn: 1 };
    [a] = fresh(1);
    a.hp = a.maxHp = 1e7;
    pl.en = 0;
    pl.enDelay = 9;
    a.takeDamage(10, 0, pl, a.center(), null, { kb: 0 });
    out.en = Math.round((pl.en / pl.enMax) * 100);
    // 衝撞推進
    pl.pm = { ...pl.pm, hitEn: 0, qbRam: 1 };
    [sx, sz] = spot(0, -30, 6); // QB 的路線上沒有障礙物、和敵人同高
    put(pl, sx, sz);
    pl.vel.set(0, 0, 0);
    put(a, sx, sz - 2.5); // QB 一開始就碰得到
    a.hp = a.maxHp = 1e7;
    a.iFrames = 0;
    pl.en = pl.enMax;
    Object.assign(pl, { staggerT: 0, stagGuardT: 0, qbT: 0, empLockT: 0, iFrames: 0 });
    const dbg = {
      d0: +Math.hypot(a.pos.x - pl.pos.x, a.pos.z - pl.pos.z).toFixed(2),
      dy: +(a.pos.y - pl.pos.y).toFixed(2),
    };
    for (let i = 0; i < 30; i++) {
      pl.move(dt, new THREE.Vector3(0, 0, -1), false, i === 0, false, null);
      if (i === 0)
        Object.assign(dbg, {
          qb: +pl.qbT.toFixed(2),
          ramT: +(pl.ramT || 0).toFixed(2),
          k: pl.pmv('qbRam'),
          host: g.hostilesOfEnt(pl).includes(a),
          fp: !!g.fp,
        });
      a.vel.set(0, 0, 0);
      a.iFrames = 0;
    }
    out.ram = Math.round(1e7 - a.hp);
    out.ramDbg = JSON.stringify(dbg);
    // 緊急障壁
    pl.pm = { ...pl.pm, qbRam: 0, lastStand: 1 };
    pl.iFrames = 0;
    pl.hp = pl.maxHp * 0.35;
    pl.takeDamage(pl.maxHp * 0.1, 0, a, pl.center());
    out.last = { hp: Math.round((pl.hp / pl.maxHp) * 100), inv: pl.iFrames > 2 };
    pl.iFrames = 0;
    pl.hp = pl.maxHp * 0.25;
    pl.takeDamage(pl.maxHp * 0.01, 0, a, pl.center());
    out.cool = pl.iFrames <= 0;
    return out;
  });
  check(r.blast, '連鎖殉爆：擊破的敵人爆炸、波及旁邊的敵人');
  check(r.stag, '殉爆脈衝：擊破時周圍的敵人失衡');
  check(r.en >= 14, `能量虹吸：近戰命中回復 EN ${r.en}%`);
  check(r.ram >= 500, `衝撞推進：QB 撞上敵人造成 ${r.ram} 傷害` + (r.ram >= 500 ? '' : r.ramDbg));
  check(
    r.last.inv && r.last.hp >= 35 && r.cool,
    `緊急障壁：AP 低於 30% 時無敵並回復（${r.last.hp}%），冷卻中不再觸發`,
  );
  await ctx.close();
}

// 補給：PvE 的攜彈量加成、擊破掉落彈藥箱與撿起補彈、轉場整備補充修復套件
async function testAim(browser, base) {
  console.log(
    '命中：火控的距離輔助、依彈速預判、手臂的追蹤、導彈鎖定時間、機甲庫的預估命中率、靶場的分距離命中率與有效率',
  );
  const { ctx, page } = await newPage(browser, 'aim');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => {
    const g = window.__game;
    for (const id of ['f_cqb', 'f_mid', 'f_snipe']) if (!g.save.owned.includes(id)) g.save.owned.push(id);
    g.openGarage();
    g.garageSlot = 'fcs';
    g.renderGarage();
  });
  await waitVisible(page, 'garage');
  const gs = await page.evaluate(() => ({
    stats: document.getElementById('stats').textContent,
    list: document.getElementById('partList').textContent,
    fire: document.getElementById('gFire').textContent,
  }));
  check(
    gs.stats.includes('火控輔助') && gs.stats.includes('射擊適性') && gs.stats.includes('導彈鎖定時間'),
    '機甲庫顯示火控輔助、射擊適性、導彈鎖定時間',
  );
  check(
    ['近距特化', '中距特化', '遠距狙擊'].every((n) => gs.list.includes(n)) &&
      gs.list.includes('輔助 近/中/遠'),
    '新的火控 3 款與輔助數值',
  );
  check(
    gs.fire.includes('預估命中率'),
    `機甲庫的預估命中率（${(gs.fire.match(/預估命中率[^右左]*(右手[^左]*)/) || [''])[0].slice(0, 60)}）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    Object.assign(g.rangeCfgGet(), {
      tgt: 'dummy',
      beh: 'static',
      dist: 45,
      n: 1,
      inf: true,
      god: true,
      pm: false,
    });
    g.save.asm.fcs = 'f_cqb';
    g.rangeStart();
  });
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const pl = g.player,
      t = g.range.targets[0];
    const out = { a10: pl.fcsAssist(10), a80: pl.fcsAssist(80) };
    // 預判：目標以 10 m/s 橫移；近距特化在 10 m 幾乎照實際攔截點
    const muz = t.center().addScaledVector(new THREE.Vector3(0, 0, 1), 10);
    t.vel.set(10, 0, 0);
    pl.trkId = null;
    const lp = pl.leadPoint(t, 95, muz);
    out.leadNear = (lp.x - t.center().x) / ((10 * 10) / 95);
    // 遠距狙擊：近距離的預判只到一部分
    g.save.asm.fcs = 'f_snipe';
    g.rangeSpawnPlayer();
    const p2 = g.player;
    p2.trkId = null;
    const lp2 = p2.leadPoint(t, 95, muz);
    out.leadFar = (lp2.x - t.center().x) / ((10 * 10) / 95);
    // 追蹤：目標換方向後，預判的速度要一段時間才跟上
    p2.trkId = null;
    p2.trackVel(t);
    t.vel.set(-10, 0, 0);
    p2.t += 0.1;
    out.trk = p2.trackVel(t).x;
    t.vel.set(0, 0, 0);
    // 導彈鎖定：標準火控 1 秒鎖滿 4 發
    g.save.asm.fcs = 'f_std';
    g.rangeSpawnPlayer();
    const p3 = g.player;
    const d = p3.weapons.rback.def;
    p3.lkId = null;
    p3.lockAge(t);
    out.m0 = p3.missileN(d, t);
    p3.lkT0 -= 0.4;
    out.m5 = p3.missileN(d, t);
    p3.lkT0 -= 0.7;
    out.m10 = p3.missileN(d, t);
    // HUD 的導彈鎖定數
    for (let i = 0; i < 60 && !document.getElementById('lockHint').textContent.includes('導彈鎖定'); i++) {
      p3.lock = t;
      await new Promise((res) => setTimeout(res, 100));
    }
    out.hint = document.getElementById('lockHint').textContent;
    // 靶場的分距離命中率與有效率
    for (let i = 0; i < 4; i++) g.rangeShot('w_rifle');
    for (let i = 0; i < 3; i++) t.takeDamage(500, 0, p3, t.center(), null, undefined, 'w_rifle');
    g.rangePanelRender();
    out.panel = document.getElementById('rangePanel').textContent;
    out.band = g.rangeSummary().band;
    return out;
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'aim-range.png') });
  check(
    Math.abs(r.a10 - 1) < 0.01 && Math.abs(r.a80 - 0.1) < 0.01,
    `近距特化火控：10 m 輔助 ${r.a10}、80 m ${r.a80}`,
  );
  check(
    Math.abs(r.leadNear - 1) < 0.12 && r.leadFar < 0.75 && r.leadFar > 0.5,
    `依彈速預判（近距特化 ${r.leadNear.toFixed(2)}、遠距狙擊 ${r.leadFar.toFixed(2)} 倍的攔截量）`,
  );
  check(r.trk > -9 && r.trk < 9, `目標換方向後的追蹤延遲（0.1 秒後預判速度 ${r.trk.toFixed(1)} m/s）`);
  check(
    r.m0 === 1 && r.m5 === 2 && r.m10 === 4,
    `導彈鎖定時間（0／0.4／1.1 秒：${r.m0}／${r.m5}／${r.m10} 發）`,
  );
  check(r.hint.includes('導彈鎖定'), `鎖定提示顯示導彈鎖定數（${r.hint}）`);
  check(
    r.panel.includes('命中率（近／中／遠）') &&
      r.panel.includes('效率') &&
      r.panel.includes('擴散') &&
      r.band[1] === 0.75,
    '靶場的分距離命中率、有效率、擴散與預判',
  );
  await page.evaluate(() => window.__game.rangeExit());
  await ctx.close();
}
async function testAttrs(browser, base) {
  console.log(
    '武器屬性：三種防禦、能量適性、直擊補正、無屬性、弱點、實彈距離衰減、能量霰彈、機甲庫與靶場的顯示',
  );
  const { ctx, page } = await newPage(browser, 'attrs');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => {
    const g = window.__game;
    g.openGarage();
    g.garageSlot = 'rarm';
    g.renderGarage();
  });
  await waitVisible(page, 'garage');
  const gs = await page.evaluate(() => ({
    stats: document.getElementById('stats').textContent,
    list: document.getElementById('partList').textContent,
  }));
  check(
    gs.stats.includes('減傷（實彈／爆發／能量）') &&
      gs.stats.includes('能量武器適性') &&
      gs.list.includes('[實彈]') &&
      gs.list.includes('理想射程'),
    '機甲庫顯示三種減傷、能量適性、武器屬性與理想射程',
  );
  // 靶場：標準靶（AP 無限）上直接量傷害
  await page.evaluate(() => {
    const g = window.__game;
    Object.assign(g.rangeCfgGet(), {
      tgt: 'dummy',
      beh: 'static',
      dist: 30,
      n: 1,
      inf: true,
      god: true,
      pm: false,
    });
    g.rangeStart();
  });
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const r = await page.evaluate(async () => {
    const g = window.__game;
    const t = () => g.range.targets[0];
    const hit = (wid, attr, stag) => {
      const e = t();
      e.hp = e.maxHp;
      e.iFrames = 0;
      e.staggerT = stag ? 2 : 0;
      const h0 = e.hp;
      e.takeDamage(1000, 0, g.player, e.center(), null, undefined, wid, attr);
      const d = h0 - e.hp;
      e.staggerT = 0;
      e.acs = 0;
      return d;
    };
    const out = {};
    out.kin = hit('w_rifle');
    out.en = hit('w_lr');
    out.none = hit(undefined, 'none');
    out.bzStag = hit('w_bz', undefined, true);
    out.rfStag = hit('w_rifle', undefined, true);
    // 能量特化發電機：能量武器 ×1.18
    const asm0 = { ...g.save.asm };
    g.save.asm.generator = 'g_arc';
    g.rangeSpawnPlayer();
    out.en2 = hit('w_lr');
    out.kin2 = hit('w_rifle');
    // 實彈的距離衰減：同一發子彈從 5 m 與 60 m 外射來
    const e = t();
    const shot = (back) => {
      g.player.fire('rarm', e.center(), e);
      const pr = g.projectiles[g.projectiles.length - 1];
      const dir = pr.vel.clone().normalize();
      pr.pos.copy(e.center()).addScaledVector(dir, -2);
      pr.p0 = pr.pos.clone().addScaledVector(dir, -back);
      pr.dmg = 1000;
      return pr;
    };
    g.player.weapons.rarm.cd = 0;
    e.hp = e.maxHp;
    let h0 = e.hp;
    const prnear = shot(3);
    for (let i = 0; i < 100 && !prnear.dead; i++) await new Promise((res) => setTimeout(res, 100)); // 等到命中（遊戲時間）
    out.near = h0 - e.hp;
    g.player.weapons.rarm.cd = 0;
    e.hp = e.maxHp;
    h0 = e.hp;
    const prfar = shot(58);
    for (let i = 0; i < 100 && !prfar.dead; i++) await new Promise((res) => setTimeout(res, 100)); // 等到命中（遊戲時間）
    out.far = h0 - e.hp;
    // 能量霰彈：不用彈藥、每發耗 EN、7 顆
    g.save.asm.rarm = 'w_lsg';
    g.rangeSpawnPlayer();
    const pl = g.player;
    pl.en = pl.enMax;
    const n0 = g.projectiles.length,
      en0 = pl.en;
    pl.weapons.rarm.cd = 0;
    pl.fire('rarm', e.center(), e);
    out.lsgN = g.projectiles.length - n0;
    out.lsgEn = en0 - pl.en;
    out.lsgAmmo = pl.weapons.rarm.ammo;
    g.save.asm = asm0;
    g.rangeSpawnPlayer();
    return out;
  });
  check(
    Math.abs(r.kin - r.en) <= 2 && r.kin < 1000 && r.none === 1000,
    `三種防禦相同時實彈＝能量（${r.kin}／${r.en}），無屬性不減傷（${r.none}）`,
  );
  check(
    Math.abs(r.en2 / r.en - 1.18) < 0.02 && r.kin2 === r.kin,
    `能量特化發電機：能量武器 ×${(r.en2 / r.en).toFixed(2)}、實彈不變`,
  );
  check(
    Math.abs(r.bzStag / r.rfStag - 1.9 / 1.4) < 0.02,
    `直擊補正依武器（火箭筒 ${r.bzStag}／步槍 ${r.rfStag}）`,
  );
  check(
    r.near > 0 && Math.abs(r.far / r.near - 0.73) < 0.03,
    `實彈超過理想射程遞減（5 m ${r.near}、60 m ${r.far}）`,
  );
  check(
    r.lsgN === 7 && r.lsgEn > 60 && r.lsgAmmo >= 999,
    `能量霰彈：7 顆、耗 EN ${Math.round(r.lsgEn)}、不用彈藥`,
  );
  // 弱點：重型 MT 實彈抗、能量弱
  await page.evaluate(() => {
    const g = window.__game;
    Object.assign(g.rangeCfgGet(), { tgt: 'type:mth', beh: 'static' });
    g.rangeStart();
  });
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const w = await page.evaluate(async () => {
    const g = window.__game;
    const e = g.range.targets[0];
    const hit = (wid) => {
      e.hp = e.maxHp;
      const h0 = e.hp;
      e.takeDamage(1000, 0, g.player, e.center(), null, undefined, wid);
      return h0 - e.hp;
    };
    const kin = hit('w_rifle'),
      en = hit('w_lr');
    // HUD 每格更新：等到鎖定提示畫出來（遊戲時間很慢）
    for (let i = 0; i < 60 && !document.getElementById('lockHint').textContent.includes('弱'); i++) {
      g.player.lock = e;
      await new Promise((res) => setTimeout(res, 100));
    }
    g.rangePanelRender();
    return {
      kin,
      en,
      res: e.res,
      lock: document.getElementById('lockHint').textContent,
      panel: document.getElementById('rangePanel').textContent,
    };
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'attrs-range.png') });
  check(w.res && w.en > w.kin * 1.2, `弱點：重型 MT 受能量 ${w.en}、實彈 ${w.kin}`);
  check(w.lock.includes('弱：能量') && w.panel.includes('弱：能量'), '鎖定提示與靶場面板顯示弱點');
  await page.evaluate(() => window.__game.rangeExit());
  await ctx.close();
}
async function testRange(browser, base) {
  console.log('靶場：機甲庫的理論火力、目標設定、量測輸出與承受、AP 無限、不會被擊破、橫移、紀錄、轉場整備');
  const { ctx, page } = await newPage(browser, 'range');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => {
    const g = window.__game;
    g.openGarage();
    g.garageSlot = 'rarm';
    g.renderGarage();
  });
  await waitVisible(page, 'garage');
  const gf = await page.evaluate(() => ({
    fire: document.getElementById('gFire').textContent,
    delta: document.querySelectorAll('#partList .dUp, #partList .dDn').length,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'range-garage.png') });
  check(
    gf.fire.includes('合計 DPS') && gf.fire.includes('有效 AP') && gf.delta > 0,
    `機甲庫的理論火力與換零件的差異（${gf.delta} 個零件標出 ▲▼）`,
  );
  // 目標設定 → 進入靶場：標準靶、靜止、30 m、AP 無限
  await page.click('#btnRange');
  await waitVisible(page, 'rangeMenu');
  await page.selectOption('#rgTgt', 'dummy');
  await page.selectOption('#rgBeh', 'static');
  await page.selectOption('#rgDist', '30');
  await page.evaluate(() => {
    document.getElementById('rgInf').checked = true;
    document.getElementById('rgGod').checked = false;
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'range-menu.png') });
  await page.click('#btnRangeGo');
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const r1 = await page.evaluate(async () => {
    const g = window.__game;
    const t = g.range.targets[0];
    const d = Math.hypot(t.pos.x - g.player.pos.x, t.pos.z - g.player.pos.z);
    // 4 發、2 發命中
    for (let i = 0; i < 4; i++) g.rangeShot('w_rifle');
    for (let i = 0; i < 2; i++)
      t.takeDamage(500, 200, g.player, t.center(), new THREE.Vector3(0, 0, -1), undefined, 'w_rifle');
    await new Promise((r) => setTimeout(r, 1500));
    t.takeDamage(1e9, 0, g.player, t.center(), null, undefined, 'w_rifle'); // AP 無限：補滿、算一次擊破
    await new Promise((r) => setTimeout(r, 600));
    g.rangePanelRender();
    const s = g.rangeSummary();
    return {
      d,
      n: g.range.targets.length,
      dead: t.dead,
      hp: t.hp,
      max: t.maxHp,
      s,
      panel: document.getElementById('rangePanel').textContent,
    };
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'range-play.png') });
  check(r1.n === 1 && Math.abs(r1.d - 30) < 3, `標準靶在 30 m（${r1.d.toFixed(1)} m）`);
  check(
    r1.s.dealt > 900 && r1.s.dps > 0 && Math.round(r1.s.acc * 100) === 75 && r1.panel.includes('DPS'),
    `量測輸出（總傷害 ${Math.round(r1.s.dealt)}、DPS ${Math.round(r1.s.dps)}、命中率 ${Math.round(r1.s.acc * 100)}%）`,
  );
  check(!r1.dead && r1.hp === r1.max && r1.s.killN === 1, 'AP 無限：歸零時補滿並記一次擊破時間');
  // T 開設定：原地開火的敵人、自己不會被擊破
  await page.keyboard.press('KeyT');
  await waitVisible(page, 'rangeMenu');
  check((await page.evaluate(() => window.__game.state)) === 'rangecfg', '靶場裡按 T：暫停並打開目標設定');
  await page.selectOption('#rgTgt', 'type:mt_shot');
  await page.selectOption('#rgBeh', 'turret');
  await page.evaluate(() => (document.getElementById('rgGod').checked = true));
  await page.click('#btnRangeGo');
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const r2 = await page.evaluate(async () => {
    const g = window.__game;
    const t = g.range.targets[0];
    const a0 = t.pos.clone();
    await new Promise((r) => setTimeout(r, 2500));
    const moved = Math.hypot(t.pos.x - a0.x, t.pos.z - a0.z);
    g.player.takeDamage(1e9, 0, t, g.player.center(), null);
    await new Promise((r) => setTimeout(r, 300));
    const s = g.rangeSummary();
    return { name: t.name, moved, dead: g.player.dead, hp: g.player.hp, s };
  });
  check(r2.moved < 0.5, `原地開火的敵人不移動（${r2.name}，${r2.moved.toFixed(2)} m）`);
  check(
    !r2.dead && r2.s.downs === 1 && r2.s.taken > 0 && r2.s.blocked > 0,
    `測防禦：不會被擊破、記錄受傷 ${Math.round(r2.s.taken)} 與防禦擋下 ${Math.round(r2.s.blocked)}`,
  );
  // 橫移
  await page.keyboard.press('KeyT');
  await waitVisible(page, 'rangeMenu');
  await page.selectOption('#rgTgt', 'dummy');
  await page.selectOption('#rgBeh', 'strafe');
  await page.click('#btnRangeGo');
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const mv = await page.evaluate(async () => {
    const g = window.__game;
    const t = g.range.targets[0];
    // 以遊戲時間等 3 秒（SwiftShader 的格數低，每格的 dt 有上限）
    const c0 = g.range.clock;
    for (let i = 0; i < 300 && g.range.clock < c0 + 3; i++) await new Promise((r) => setTimeout(r, 100));
    return Math.hypot(t.pos.x - t.rangeAt.x, t.pos.z - t.rangeAt.z);
  });
  check(mv > 1, `橫移的標準靶左右移動（離開原位 ${mv.toFixed(1)} m）`);
  // 離開：回機甲庫、留下紀錄
  await page.evaluate(() => {
    const g = window.__game;
    g.state = 'pause';
    g.showScreen('pause');
  });
  check(await visible(page, 'btnRangeCfgP'), '暫停選單有「靶場設定」');
  await page.click('#btnAbort');
  await waitVisible(page, 'garage');
  await page.click('#btnRangeLog');
  const lg = await page.evaluate(() => ({
    rows: document.querySelectorAll('#rangeLogList tr').length - 1,
    range: !!window.__game.range,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'range-log.png') });
  check(!lg.range && lg.rows >= 2, `離開靶場回機甲庫、靶場紀錄 ${lg.rows} 筆`);
  await page.click('#btnRangeLogClose');
  // 轉場整備時進靶場：主線的狀態收起來，離開後放回
  await page.evaluate(() => {
    const g = window.__game;
    g.autoPickMod = true;
    g.useSlot(g.saveSlot);
    g.campBegin('c1s1');
    g.campGarage();
  });
  await waitVisible(page, 'garage');
  await page.click('#btnRange');
  await waitVisible(page, 'rangeMenu');
  await page.click('#btnRangeGo');
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.range, null, {
    timeout: 20000,
  });
  const cp = await page.evaluate(() => ({ camp: !!window.__game.camp, kept: !!window.__game.range.camp }));
  await page.evaluate(() => window.__game.rangeExit());
  await waitVisible(page, 'garage');
  const cp2 = await page.evaluate(() => ({
    camp: !!window.__game.camp && window.__game.camp.sid,
    panel: document.getElementById('gCamp').style.display !== 'none',
  }));
  check(
    !cp.camp && cp.kept && cp2.camp === 'c1s1' && cp2.panel,
    '轉場整備時進靶場：主線狀態收起來、離開後放回（整備面板還在）',
  );
  await ctx.close();
}
async function testGuide(browser, base) {
  console.log('主線的說明：出口文字、抉擇說明卡、模組卡片、委託方面板');
  const { ctx, page } = await newPage(browser, 'guide');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.click('#btnStory');
  await waitVisible(page, 'hub');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const c2a = g.campChoiceInfo('c2', 'castron'),
      c2b = g.campChoiceInfo('c2', 'aetheric'),
      c4 = g.campChoiceInfo('c4', 'veerwell'),
      c6 = g.campChoiceInfo('c6', 'seal');
    const coam = g.campExitLabel('coam', 'battle', 'x', null, null, 4);
    const mod = g.campExitLabel('mod_castron', 'destroy', 'x', null, null, 4);
    const ch = g.campExitLabel('mod_castron', 'battle', 'x', 'castron', 'c2', 5);
    // 沒有能量武器時，雷射的 EN 消耗模組對武器無效
    const asm0 = { ...g.save.asm };
    g.save.asm = { ...asm0, rarm: 'w_rifle', larm: 'w_rifle', rback: 'w_none', lback: 'w_none' };
    const fitBad = g.guideFit('a_eff'),
      fitOk = g.guideFit('c_power'),
      miss = g.guideFactionMiss('aetheric');
    g.save.asm = asm0;
    const card = g.modCardHtml({ id: 'c_impact', lv: 2 }, 0, '選擇');
    g.campSetMods([
      { id: 'c_power', lv: 1 },
      { id: 'c_chain', lv: 1 },
    ]);
    const sum = g.campModsHtml();
    return { c2a, c2b, c4, c6, coam, mod, ch, fitBad, fitOk, miss, card, sum };
  });
  check(
    r.c2a.routes.length && r.c2b.routes.length && r.c2a.aces.length && r.c4.routes.length && r.c6.ending,
    `抉擇的影響：開放的出擊（${r.c2a.routes.join('、')}／${r.c2b.routes.join('、')}）、宿敵（${r.c2a.aces.join('、')}／${r.c2b.aces.join('、')}）、終局決定結局`,
  );
  check(
    r.coam.label.includes('10,000') && r.mod.label.includes('實彈') && r.mod.sub.includes('下一段：破壞'),
    `出口光環寫出效果與下一段（${r.coam.label}｜${r.mod.label}｜${r.mod.sub.split('\n')[0]}）`,
  );
  check(
    r.ch.sub.includes('開放「') && r.ch.sub.includes('不能更改'),
    `抉擇出口寫出路線與不能更改（${r.ch.sub}）`,
  );
  check(
    r.fitBad.bad && !r.fitOk.bad && r.miss > 0,
    `模組對武器的適用性（${r.fitBad.txt}｜${r.fitOk.txt}｜艾瑟立克 ${r.miss} 種用不到）`,
  );
  check(
    r.card.includes('讓敵人更快失衡') && r.card.includes('→') && r.card.includes('適用'),
    '模組卡片：白話效果、升級前後數值、適用性',
  );
  check(r.sum.includes('合計：') && r.sum.includes('連鎖殉爆'), '持有模組的合計');
  await page.evaluate(() => window.__game.renderHub());
  check(
    await page.evaluate(() => !!document.querySelector('.hubNode title')),
    '總覽圖的節點有說明（開放條件、路線、抉擇）',
  );
  // 抉擇說明卡：暫停、兩個選項、關掉回到原本的狀態
  await page.evaluate(() => window.__game.campChoiceCard('c2'));
  const cc = await page.evaluate(() => ({
    st: window.__game.state,
    n: document.querySelectorAll('#mpCards .mpCard').length,
    txt: document.getElementById('mpCards').textContent,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'guide-choice.png') });
  check(
    cc.st === 'modpick' && cc.n === 2 && cc.txt.includes('開放的出擊') && cc.txt.includes('宿敵'),
    '抉擇說明卡：暫停、兩個選項、路線與宿敵',
  );
  await page.click('#mpSkip');
  check((await page.evaluate(() => window.__game.state)) === 'hub', '說明卡關掉後回到原本的狀態');
  // 三選一還開著時，說明卡排隊到它關掉之後
  await page.evaluate(() => {
    const g = window.__game;
    g.campSetMods([{ id: 'c_power', lv: 1 }]);
    g.campOpenPick('veerwell');
    g.campChoiceCard('c4');
  });
  const pk = await page.evaluate(() => ({
    t: document.getElementById('mpTitle').textContent,
    duo: document.getElementById('mpDuo').textContent,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'guide-modpick.png') });
  check(
    pk.duo.includes('衝鋒火線') && pk.duo.includes('✓'),
    `三選一的雙重模組提示（${pk.duo.slice(0, 60)}…）`,
  );
  await page.click('#mpSkip');
  const t2 = await page.evaluate(() => document.getElementById('mpTitle').textContent);
  check(!pk.t.includes('抉擇') && t2.includes('抉擇 2'), '三選一關掉後才顯示抉擇說明卡');
  await page.click('#mpSkip');
  // 作戰室的委託方面板
  await page.click('#btnHubFac');
  const fac = await page.evaluate(() => ({
    vis: document.getElementById('hubFacBox').style.display !== 'none',
    n: document.querySelectorAll('#hubFacList .facSec').length,
    held: document.querySelectorAll('#hubFacList .facMod.held').length,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'guide-factions.png') });
  check(fac.vis && fac.n === 5 && fac.held === 1, '委託方面板：四家＋雙重模組、標出持有的');
  await page.click('#btnHubFacClose');
  await ctx.close();
}
async function testAudio(browser, base) {
  console.log('聲音：混音、環境音、命中分類、回饋音、腳步');
  const { ctx, page } = await newPage(browser, 'audio');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => window.__sfx.init());
  await page.waitForFunction(() => window.__sfx.ready, null, { timeout: 30000 });
  const r = await page.evaluate(() => {
    const g = window.__game,
      S = window.__sfx;
    const out = { n: Object.keys(S.buf).length };
    // 呼叫紀錄：攔截 play 與 tone
    const log = [];
    const play0 = S.play.bind(S),
      tone0 = S.tone.bind(S);
    S.play = (k, ...a) => (log.push(k), play0(k, ...a));
    S.tone = (...a) => (log.push('tone'), tone0(...a));
    const wa0 = S.waveAlert.bind(S);
    S.waveAlert = (pan, last) => (log.push(last ? 'alarmBig' : 'alarm'), wa0(pan, last));
    const took = (f) => {
      log.length = 0;
      f();
      return log.slice();
    };
    localStorage.setItem('rubicon_map', 'snow');
    g.startMission();
    g.state = 'audio-test';
    g.waves = [];
    g.wavePend = null;
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    g.audioTick(0.016);
    out.amb = S.ambNodes.length;
    out.ambKey = S.ambKey;
    out.rev = S.revDecay;
    const e = g.spawnType('mt', 1, 1);
    e.pos.copy(pl.pos).add(new THREE.Vector3(6, 0, 0));
    out.hitE = took(() => S.hit(e.center(), e));
    out.hitP = took(() => S.hit(null, pl));
    // 擊破：確認音與連殺
    out.k1 = took(() => e.takeDamage(1e9, 0, pl, e.center()));
    const e2 = g.spawnType('mt', 1, 1);
    e2.takeDamage(1e9, 0, pl, e2.center());
    out.streak = g.killStreak && g.killStreak.n;
    // 打出失衡
    const e3 = g.spawnType('mt', 1, 1);
    e3.hp = e3.maxHp = 1e8;
    out.brk = took(() => e3.takeDamage(10, e3.acsMax * 10, pl, e3.center()));
    // 腳步（雪地）
    pl.grounded = true;
    pl.moving = true;
    out.step = took(() => g.mechStep(pl));
    // 低 AP：心跳與變悶
    pl.hp = pl.maxHp * 0.05;
    out.hb = took(() => g.audioTick(0.016));
    out.muf = S.mufF;
    pl.hp = pl.maxHp;
    g.audioTick(0.016);
    out.muf2 = S.mufF;
    // 增援預告與通訊
    out.wave = took(() => g.waveShow({ p: [pl.pos.x + 40, pl.pos.z], i: 3, N: 3, n: 4 }));
    // 按鈕的聲音不重複
    out.btn = took(() => {
      S.uiBtn('back');
      S.ui();
    });
    g.clearMission();
    out.ambAfter = S.ambNodes.length;
    localStorage.setItem('rubicon_map', 'industrial');
    g.state = 'title';
    return out;
  });
  check(r.n >= 70, `音效全部解碼（${r.n} 個）`);
  check(r.amb >= 2 && /^snow/.test(r.ambKey) && r.rev < 1, `冰原的環境音 ${r.amb} 層、殘響 ${r.rev} 秒`);
  check(
    r.hitE.some((k) => /^armor/.test(k)) && r.hitP.some((k) => /^punch/.test(k)),
    `命中依目標分類（敵人 ${r.hitE.join('+')}／自己 ${r.hitP.join('+')}）`,
  );
  check(
    r.k1.includes('tone') && r.k1.includes('debris') && r.streak === 2,
    `擊破確認音、殘骸聲、連殺 ×${r.streak}`,
  );
  check(r.brk.includes('bell') && r.brk.includes('glass'), `打出失衡的回饋音（${r.brk.join('+')}）`);
  check(
    r.step.some((k) => /^stepSnow/.test(k)),
    `雪地的腳步聲（${r.step.join('+')}）`,
  );
  check(
    r.hb.includes('tone') && r.muf < 5000 && r.muf2 === 20000,
    `低 AP 心跳與變悶（${Math.round(r.muf)} Hz → 恢復）`,
  );
  check(
    r.wave.includes('alarmBig') && r.wave.includes('glitch'),
    `最後一波的警報與 ECHO 的無線電聲（${r.wave.join('+')}）`,
  );
  check(r.btn.length === 1, '按鈕的介面音不重複');
  check(r.ambAfter === 0, '離開戰區時環境音停止');
  await ctx.close();
}

async function testJuice(browser, base) {
  console.log('打擊回饋：傷害數字、連殺、BREAK、重擊閃光、擊破演出、Boss 橫幅');
  const { ctx, page } = await newPage(browser, 'juice');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    g.startMission();
    g.state = 'juice-test';
    g.waves = [];
    g.wavePend = null;
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const e = g.spawnType('mt', 1, 1);
    e.hp = e.maxHp = 1e8;
    e.pos.copy(pl.pos).add(new THREE.Vector3(0, 0, -10));
    g.popups.length = 0;
    // 連續命中合併成一個數字
    for (let i = 0; i < 4; i++) e.takeDamage(100, 0, pl, e.center(), undefined, undefined, 'w_rifle');
    const nums = g.popups.filter((q) => q.num);
    out.pops = nums.length;
    out.sum = nums[0] && Math.round(nums[0].val);
    // 打出失衡：BREAK
    e.takeDamage(10, e.acsMax * 10, pl, e.center());
    out.brk = g.popups.some((q) => q.val === 'BREAK');
    // 擊破兩台：連殺 ×2，擊破演出（延遲爆炸、冒煙、焦痕）
    // 人形機甲先跪倒崩落（fx.collapse）、0.55 秒後才碎裂與擊破的爆炸
    e.takeDamage(1e9, 0, pl, e.center());
    out.collapse = g.fx.list.some((x) => !x.mesh && x.end) && e.mesh.visible;
    g.fx.update(0.6);
    out.hidden = !e.mesh.visible;
    out.burst = g.fx.list.length;
    out.tasks = g.fx.list.filter((x) => !x.mesh).length;
    const e2 = g.spawnType('mt', 1, 1);
    e2.pos.copy(pl.pos).add(new THREE.Vector3(5, 0, -12));
    e2.takeDamage(1e9, 0, pl, e2.center());
    out.streak = g.killStreak && g.killStreak.n;
    // 自己受到重擊：閃光與色差
    pl.takeDamage(10, 1200, e2, pl.center());
    out.flash = g.hitFlashK;
    out.chroma = g.chromaK;
    // Boss 登場的橫幅
    g.bosses = [g.spawnType('ac', 1, 1)];
    g.bosses[0].isBoss = true;
    g.bosses[0].name = 'TEST BOSS';
    g.drawHud(0.016);
    // 文字演出開著時是 textfx 的橫幅（game/textfx.js），關閉時是原本的 banner
    const tb = g.textfx && g.textfx.items.find((x) => x.cue === 'warning');
    out.banner = tb ? tb.s.text : g.banner && g.banner.txt;
    out.bannerSub = tb ? tb.s.subText : g.banner && g.banner.sub;
    return out;
  });
  check(r.pops === 1 && r.sum > 300, `連續命中合併成一個傷害數字（${r.pops} 個、${r.sum}）`);
  check(r.brk, '打出失衡時跳出 BREAK');
  check(r.collapse && r.hidden, '擊破時人形機甲先跪倒崩落，之後才碎裂');
  check(r.burst >= 4 && r.tasks >= 2, `擊破演出：二次爆炸、殘骸冒煙、焦痕（${r.burst} 個特效）`);
  check(r.streak === 2, `連殺計數 ×${r.streak}`);
  check(r.flash > 0.5 && r.chroma > 0.5, `受到重擊時畫面閃光與色差（${r.flash.toFixed(2)}）`);
  check(r.banner === 'WARNING' && r.bannerSub === 'TEST BOSS', `Boss 登場的 WARNING 橫幅（${r.bannerSub}）`);
  // 畫面：連殺、傷害數字、橫幅
  await page.evaluate(() => {
    const g = window.__game;
    g.state = 'play';
    g.player.hp = g.player.maxHp * 0.1;
    g.killStreak = { n: 5, t: 3, pop: 0.5 };
    for (let i = 0; i < 6; i++) {
      const p = g.player.center().add(new THREE.Vector3((i - 3) * 2, 2, -8));
      g.pushPopup(p, 80 + i * 260, false, i === 4, i === 5, i === 5 ? 3 : 0, 'k' + i);
    }
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOT_DIR, 'juice-hud.png') });
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.state = 'title';
  });
  await ctx.close();
}

async function testBossPower(browser, base) {
  console.log('Boss 強度：血量與火力、三個型態、換型態的增援、失衡後保護、狂暴');
  const { ctx, page } = await newPage(browser, 'bosspower');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    g.save.level = 3;
    g.startMission();
    g.state = 'bp-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e8;
    pl.iFrames = 1e9;
    const b = g.boss;
    g.drawHud(0.016); // Boss 登場的橫幅先顯示過
    g.bossPhaseTick(0.016);
    g.updateLoops();
    out.name = b.name;
    out.hpK = +(b.opts.hpMul / g.bossDef.hpMul / g.scaleHp).toFixed(2);
    out.dmgK = +(b.opts.dmgMul / g.bossDef.dmgMul / g.scaleDmg).toFixed(2);
    out.ph1 = b.bossPhase();
    out.tempo1 = b.bossTempo();
    // 失衡後保護：失衡結束後不會馬上再失衡
    b.staggerT = 0.01;
    b.updateAI(0.05);
    out.guard = b.stagGuardT;
    b.takeDamage(1, b.acsMax * 5, pl, b.center());
    out.restag = b.staggerT > 0;
    // 打到 AP 65%：第二型態、無敵、增援空降（只有雜兵）
    const n0 = g.enemies.filter((e) => !e.dead).length;
    b.iFrames = 0;
    b.hp = b.maxHp * 0.65;
    g.bossPhaseTick(0.016);
    out.ph2 = b.bossPhase();
    out.iF = b.iFrames;
    const adds = g.enemies.filter((e) => !e.dead && e !== b);
    out.adds = adds.length - (n0 - 1);
    out.addAc = adds.some((e) => e.ai === 'ac' || e.isBoss);
    out.tempo2 = b.bossTempo();
    g.updateLoops(); // 換型態的提示與橫幅（feedback.js）
    const tb = g.textfx && g.textfx.items.find((x) => x.cue === 'phase');
    out.banner = tb ? tb.s.text : g.banner && g.banner.txt;
    out.shocks = (g.shocks || []).length;
    // 同一個型態不會再派一次
    g.bossPhaseTick(0.016);
    out.adds2 = g.enemies.filter((e) => !e.dead && e !== b).length - (n0 - 1);
    // AP 30%：最終型態
    b.hp = b.maxHp * 0.3;
    g.bossPhaseTick(0.016);
    out.ph3 = b.bossPhase();
    out.tempo3 = b.bossTempo();
    // 狂暴
    const d0 = b.dmgMul;
    g.bossFightT = 400;
    g.bossPhaseTick(0.016);
    out.enraged = b.enraged;
    out.enDmg = +(b.dmgMul / d0).toFixed(2);
    out.tempoE = b.bossTempo();
    g.clearMission();
    g.state = 'title';
    return out;
  });
  check(r.hpK === 1.8 && r.dmgK === 1.4, `Boss 血量 ×${r.hpK}、火力 ×${r.dmgK}（${r.name}）`);
  check(r.guard > 7 && !r.restag, `失衡結束後 ${r.guard.toFixed(1)} 秒內不會再失衡`);
  check(r.ph1 === 1 && r.ph2 === 2 && r.ph3 === 3, '三個型態（70%、35%）');
  check(r.iF >= 1.4 && r.shocks >= 1, '換型態時短暫無敵並放出地面衝擊波');
  check(
    r.adds >= 3 && !r.addAc && r.adds2 === r.adds,
    `換型態時空降 ${r.adds} 台雜兵（沒有 AC，同一型態只派一次）`,
  );
  check(
    r.tempo1 === 1 && r.tempo2 > 1 && r.tempo3 > r.tempo2 && r.tempoE > r.tempo3,
    `節奏 ${r.tempo1} → ${r.tempo2} → ${r.tempo3} → 狂暴 ${r.tempoE.toFixed(2)}`,
  );
  check(r.enraged && r.enDmg === 1.3, `開打 6 分鐘後狂暴（火力 ×${r.enDmg}）`);
  check(/型態/.test(r.banner || ''), `換型態的橫幅（${r.banner}）`);
  await ctx.close();
}

async function testBoss3(browser, base) {
  console.log('Boss 最終型態的專屬招式（22 隻）');
  const { ctx, page } = await newPage(browser, 'boss3');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (let i = 0; i < 22; i++) {
      const L = 3 * (Math.floor(i / 2) + 1) + (i % 2);
      g.save.level = L;
      g.startMission();
      g.state = 'b3-test';
      const pl = g.player;
      pl.hp = pl.maxHp = 1e8;
      const b = g.boss;
      const cnt = () =>
        (g.hzLater || []).length +
        (g.shocks || []).length +
        (g.hzRings || []).length +
        (g.mines || []).length +
        g.projectiles.length +
        g.enemies.filter((e) => !e.dead && e.ai === 'holo').length;
      b.hp = b.maxHp * 0.3;
      b.staggerT = 0;
      b.noLock = false;
      const ph = b.bossPhase();
      const c0 = cnt();
      b.aiState.b3T = 0;
      b.boss3Tick(0.016, pl);
      out.push({ n: b.name.split(' ')[0], k: b.boss3Key(), ph, d: cnt() - c0 });
      g.clearMission();
    }
    g.state = 'title';
    return out;
  });
  const miss = r.filter((x) => !(x.ph === 3 && x.k && x.d > 0));
  check(
    r.length === 22 && !miss.length,
    `22 隻 Boss 在第三型態都會放專屬招式${miss.length ? '（沒有：' + miss.map((x) => x.n + '/' + x.k).join('、') + '）' : ''}`,
  );
  await ctx.close();
}

async function testSupply(browser, base) {
  console.log('補給：攜彈量、彈藥箱、修復套件');
  const { ctx, page } = await newPage(browser, 'supply');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 3;
    g.startMission();
    g.state = 'supply-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const out = {};
    const w = Object.values(pl.weapons).find((x) => x && x.def && x.def.ammo > 0);
    // 同樣組裝的敵人（沒有駕駛員加成）＝原本的彈數
    const ref = g.spawnEnemy({ name: 'REF', asm: g.save.asm, pal: 'enemy', ai: 'mt' });
    out.ammoK = +(w.def.ammo / ref.weapons[w.slot].def.ammo).toFixed(2);
    ref.takeDamage(1e9, 0, null, ref.center());
    // 敵對 AC 擊破一定掉彈藥箱
    const ac = g.spawnType('ac', 1, 1);
    const n0 = g.pickups.length;
    ac.takeDamage(1e9, 0, pl, ac.center());
    const pk = g.pickups.slice(n0).find((p) => p.kind === 'ammo');
    out.drop = !!pk;
    if (pk) {
      w.ammo = Math.round(w.def.ammo * 0.1);
      const a0 = w.ammo;
      pl.pos.copy(pk.pos);
      g.updateMapExtras(1 / 60);
      out.refill = w.ammo - a0;
      out.gone = pk.dead;
    }
    g.clearMission();
    // 轉場整備：修復套件
    g.state = 'play';
    g.campBegin('c1s1');
    g.campEnterSeg();
    g.camp.carry.kits = 1;
    g.save.coam = 1e6;
    g.camp.inGarage = true;
    g.clearMission();
    g.openGarage();
    const btn = document.getElementById('btnCampKits');
    out.btn = btn.textContent;
    const c0 = g.save.coam;
    btn.click();
    out.kits = g.camp.carry.kits;
    out.kMax = g.campKitsMax();
    out.paid = c0 - g.save.coam;
    out.btn2 = btn.textContent;
    g.campEnd(false, true);
    return out;
  });
  check(r.ammoK >= 1.35, `PvE 的實彈武器總彈數增加（×${r.ammoK}）`);
  check(r.drop && r.refill > 0 && r.gone, `擊破敵對 AC 掉落彈藥箱，撿起後補彈 ${r.refill} 發`);
  check(
    /補充修復套件/.test(r.btn) && r.kits === r.kMax && r.paid > 0 && /已滿/.test(r.btn2),
    `轉場整備可以補充修復套件（${r.btn} → ${r.kits}／${r.kMax}）`,
  );
  await ctx.close();
}

// 第 2 周目以後的委託：第 1 周目不出現、第 2 周目依前置開放（紫色節點）、不算進整章完成、終點 Boss 與通訊
async function testCycle2(browser, base) {
  console.log('第 2 周目：新增的委託');
  const { ctx, page } = await newPage(browser, 'cycle2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  const X = ['c1x', 'c2x', 'c3x', 'c4x', 'c5x', 'c6x'];
  const st1 = await page.evaluate((X) => {
    const g = window.__game;
    const st = g.campStory();
    st.cycle = 1;
    st.done = { c1s1: 1, c1s2: 1, c2s2: 1, c3s2: 1, c4s2: 1, c5s1: 1, c6s1: 1 };
    const c1 = X.map((s) => g.hubSortieState(s)).join('/');
    st.cycle = 2;
    st.done = { c1s1: 1 };
    const c2a = X.map((s) => g.hubSortieState(s)).join('/');
    // 第 1 章的必要委託都完成：整章完成不需要周目限定的 c1x
    st.done = { c1s1: 1, c1s2: 1 };
    const chap = g.campChapterCheck(1);
    g.openHub();
    const node = document.querySelector('#hubMap .hubNode[data-sid="c1x"] circle');
    return { c1, c2a, chap, stroke: node && node.getAttribute('stroke') };
  }, X);
  check(
    st1.c1 === 'hidden/hidden/hidden/hidden/hidden/hidden' &&
      st1.c2a === 'open/locked/locked/locked/locked/locked' &&
      st1.chap &&
      st1.stroke === '#c090ff',
    '周目限定的委託：第 1 周目不出現、第 2 周目依前置開放（紫色）、不算進整章完成（' +
      JSON.stringify(st1) +
      '）',
  );
  await page.click('#hubMap .hubNode[data-sid="c1x"]');
  check(await waitVisible(page, 'brief'), '點紫色節點：顯示簡報');
  const bs = await page.evaluate((X) => {
    const g = window.__game;
    g.state = 'play';
    const out = [];
    for (const sid of X) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(sid + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0]);
      g.campEnd(false, true);
      g.state = 'play';
    }
    // 出擊開始的通訊
    g.campBegin('c1x');
    g.campEnterSeg();
    const log = (g.save.story.log || []).map((l) => l.text).join(' ');
    g.campEnd(false, true);
    return { out, log: log.includes('埋沒都市') };
  }, X);
  check(
    bs.out.join(',') === 'c1x:JUGGERNAUT,c2x:CINDER,c3x:HELIOS,c4x:HALBERD,c5x:NULLIFIER,c6x:PULSAR' &&
      bs.log,
    '6 個周目限定委託的終點 Boss 與通訊（' + bs.out.join('、') + '）',
  );
  await ctx.close();
}

// 文字演出（game/textfx.js）：文字動畫 APNG 產生器的模板——橫幅、中央訊息的種類、通訊框逐字、
// 結果畫面的標題與評價、簡報與結局的逐字、設定的完整／簡化／關閉
async function testTextFx(browser, base) {
  console.log('文字演出：橫幅、中央訊息、通訊框、結果、簡報、結局、設定');
  const { ctx, page } = await newPage(browser, 'textfx');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 設定：預設完整，改成簡化再改回來
  await page.evaluate(() => window.__game.openSettings('title'));
  const set0 = await page.evaluate(() => document.getElementById('ctrlTfx').value);
  await page.selectOption('#ctrlTfx', 'simple');
  const set1 = await page.evaluate(() => window.__game.textfx.mode + '/' + window.__game.ctrl.tfx);
  await page.selectOption('#ctrlTfx', 'full');
  await page.click('#btnSettingsBack');
  check(set0 === 'full' && set1 === 'simple/simple', '設定的文字演出：預設完整、可改成簡化（' + set1 + '）');
  // 出擊：作戰開始的橫幅；中央訊息依顏色分種類、「主 — 副」拆開
  const s1 = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 2;
    g.startMission();
    for (const e of g.enemies) e.updateAI = () => {};
    const start = g.textfx.items.find((x) => x.cue === 'start');
    const kinds = [];
    for (const [t, c] of [
      ['防衛目標被摧毀', 0xff4d4d],
      ['修復完成', 0x7ee081],
      ['取得戰術模組：測試', 0xffd060],
      ['手把已連接 — 測試手把', 0x7fc8ff],
      ['COAM 不足', 0xffb020],
    ]) {
      g.flashMsg(t, c, 1.5);
      const it = g.textfx.items.find((x) => x.slot === 'msg');
      kinds.push(it.cue + ':' + it.s.text + (it.s.subText ? '|' + it.s.subText : ''));
    }
    return { start: start && start.s.text + '|' + start.s.subText, kinds };
  });
  check(
    /^作戰開始\|任務 02/.test(s1.start || '') &&
      s1.kinds.join(',') ===
        'warn:防衛目標被摧毀,good:修復完成,good:取得戰術模組：測試,sys:手把已連接|測試手把,info:COAM 不足',
    '出擊的橫幅與中央訊息的種類（' + s1.kinds.join('、') + '）',
  );
  // 橫幅畫在疊加畫布上（播到顯示中）
  await page.evaluate(() => {
    const g = window.__game;
    g.textfx.clear();
    g.showBanner('WARNING', 'TEST BOSS', '#ff4030', 2.8, { k: 'warning' });
  });
  await page.waitForTimeout(1500);
  const px = await page.evaluate(() => {
    const cv = document.getElementById('tfx');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, Math.round(cv.height * 0.4)).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 40) n++;
    return n;
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'textfx-warning.png') });
  check(px > 2000, `WARNING 的橫幅畫在疊加畫布上（${px} 點）`);
  // 通訊框：逐字，打字中點一下整句顯示
  const cm = await page.evaluate(() => {
    const g = window.__game;
    g.commQ = [['echo', '雷達有反應，三點鐘方向。']];
    g.commNext();
    const sp = document.querySelector('#comm span');
    const n = sp.querySelectorAll('.tqc').length;
    g.commTap();
    return {
      n,
      done: sp.classList.contains('tqDone'),
      text: sp.textContent,
      echo: document.getElementById('comm').classList.contains('echo'),
    };
  });
  check(
    cm.n === 12 && cm.done && cm.text === '雷達有反應，三點鐘方向。' && cm.echo,
    '通訊框逐字、ECHO 的樣式、點一下整句顯示',
  );
  // 結果畫面：標題與評價畫在元素裡的畫布
  await page.evaluate(() => {
    const g = window.__game;
    g.commClear();
    g.endMission(true);
  });
  await page.waitForTimeout(1500);
  const rs = await page.evaluate(() => ({
    t: !!document.querySelector('#rTitle.tfxHost > canvas.tfxC'),
    r: !!document.querySelector('#rRank.tfxHost > canvas.tfxC'),
    text: document.getElementById('rTitle').textContent,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'textfx-result.png') });
  check(rs.t && rs.r && rs.text === '任務完成', '結果畫面的標題與評價（文字保留：' + rs.text + '）');
  // 簡報：系統日誌樣式逐字；結局：真結局的結尾、片尾
  const br = await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.openBrief('c1s1');
    const el = document.getElementById('brLines');
    const n = el.querySelectorAll('.tqc').length;
    g.campStory().memories = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
    g.openEpilogue('beyond');
    const coda = document.querySelector('#epLines .epCoda .tqc');
    g.tfxSkip();
    g.tfxCredits();
    const cr = g.textfx.items.some((x) => x.cue === 'credits');
    return {
      n,
      len: el.textContent.length,
      coda: !!coda,
      cr,
      title: !!document.querySelector('#epTitle > canvas.tfxC'),
    };
  });
  check(
    br.n > 20 && br.n === br.len && br.coda && br.cr && br.title,
    '簡報與結局逐字、真結局的結尾與片尾（' + br.n + ' 字）',
  );
  // 關閉：回到原本的中央訊息與橫幅
  const off = await page.evaluate(() => {
    const g = window.__game;
    g.tfxSetMode('off');
    g.state = 'play';
    g.flashMsg('測試訊息', 0xffb020, 1);
    g.showBanner('WARNING', 'TEST', '#ff4030', 2, { k: 'warning' });
    const r = {
      msg: document.getElementById('msg').classList.contains('on'),
      items: g.textfx.items.length,
      banner: g.banner && g.banner.txt,
      host: !!document.querySelector('.tfxHost'),
    };
    g.tfxSetMode('full');
    g.state = 'title';
    g.showScreen('title');
    return r;
  });
  check(
    off.msg && off.items === 0 && off.banner === 'WARNING' && !off.host,
    '文字演出關閉：原本的中央訊息與橫幅',
  );
  await ctx.close();
}

// 第 3 周目：ECHO 的委託（金色節點、殘響 Boss、記憶片段、ECHO 的紀錄）、真結局的條件（紫色委託）、
// 依上一周目的抉擇改變的通訊與簡報
async function testCycle3(browser, base) {
  console.log('第 3 周目：ECHO 的委託、記憶片段、真結局的條件、依上一周目的抉擇');
  const { ctx, page } = await newPage(browser, 'cycle3');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  const Y = ['c1y', 'c2y', 'c3y', 'c4y', 'c5y', 'c6y'];
  const s1 = await page.evaluate((Y) => {
    const g = window.__game;
    const st = g.campStory();
    const all = { c1s2: 1, c2s3b: 1, c3s3: 1, c4s3a: 1, c5s3: 1, c6s2: 1 };
    st.cycle = 2;
    st.done = { ...all };
    const c2 = Y.map((s) => g.hubSortieState(s)).join('/');
    st.cycle = 3;
    const c3 = Y.map((s) => g.hubSortieState(s)).join('/');
    st.done = { c1s2: 1 };
    const c3a = Y.map((s) => g.hubSortieState(s)).join('/');
    st.done = { c1s1: 1, c1s2: 1 };
    const chap = g.campChapterCheck(1);
    st.memories = {};
    g.openHub();
    const node = document.querySelector('#hubMap .hubNode[data-sid="c1y"] circle');
    return {
      c2,
      c3,
      c3a,
      chap,
      stroke: node && node.getAttribute('stroke'),
      btn: getComputedStyle(document.getElementById('btnHubEcho')).display,
    };
  }, Y);
  check(
    s1.c2 === 'hidden/hidden/hidden/hidden/hidden/hidden' &&
      s1.c3 === 'open/open/open/open/open/open' &&
      s1.c3a === 'open/locked/locked/locked/locked/locked' &&
      s1.chap &&
      s1.stroke === '#ffd060' &&
      s1.btn !== 'none',
    'ECHO 的委託：第 2 周目不出現、第 3 周目依前置開放（金色）、不算進整章完成、作戰室有 ECHO 的紀錄（' +
      JSON.stringify(s1) +
      '）',
  );
  await page.click('#hubMap .hubNode[data-sid="c1y"]');
  check(await waitVisible(page, 'brief'), '點金色節點：顯示 ECHO 的簡報');
  const br = await page.evaluate(() => ({
    client: document.getElementById('brClient').textContent,
    info: document.getElementById('brInfo').textContent,
  }));
  check(
    br.client.includes('ECHO') && br.info.includes('記憶片段'),
    'ECHO 的簡報：私人頻道、記憶片段（' + br.client + '）',
  );
  // 6 個委託的終點：殘響化的 Boss（ECHO-、一開始就是第二型態、能量減傷較高）
  const bs = await page.evaluate((Y) => {
    const g = window.__game;
    g.state = 'play';
    const out = [];
    for (const sid of Y) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      const b = g.bosses[0];
      const o = {
        name: ((g.bossDef && g.bossDef.name) || '').split(' ')[0],
        p2: !!(b && b.forceP2 && b.phase2()),
        en: b && b.res ? b.res[2] : null,
        echo: !!(g.bossDef && g.bossDef.echo),
      };
      g.campEnd(false, true);
      // 同一個區段不殘響化時的能量減傷（原版 Boss 的 res）：殘響化＝原版 +0.2（上限 0.6）
      g.state = 'play';
      g.campBegin(sid);
      const seg = g.campSortie().segs[n - 1];
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      seg.echo = false;
      try {
        g.campEnterSeg();
      } finally {
        seg.echo = true;
      }
      const b0 = g.bosses[0];
      o.en0 = b0 && b0.res ? b0.res[2] : 0;
      out.push(o);
      g.campEnd(false, true);
      g.state = 'play';
    }
    g.state = 'hub';
    return out;
  }, Y);
  check(
    bs.map((b) => b.name).join(',') ===
      'ECHO-BASTILLE,ECHO-HALBERD,ECHO-MIRAGE,ECHO-JUDGEMENT,ECHO-AEGIS,ECHO-DOPPEL' &&
      bs.every((b) => b.p2 && b.echo && Math.abs(b.en - Math.min(0.6, b.en0 + 0.2)) < 1e-6),
    '殘響化的 Boss：名稱、第二型態開始、能量減傷比原版多 0.2（' + JSON.stringify(bs) + '）',
  );
  // 完成 → 回收記憶片段 → ECHO 的紀錄
  const mem = await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1y');
    g.campEnterSeg();
    g.campEnd(true);
    const st = g.campStory();
    g.openHub();
    g.hubEcho(true);
    return {
      mem: Object.keys(st.memories || {}).join(','),
      list: document.getElementById('hubEchoList').textContent,
      btn: document.getElementById('btnHubEcho').textContent,
    };
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'cycle3-echo.png') });
  check(
    mem.mem === '1' && mem.list.includes('訊號') && mem.list.includes('？？？') && mem.btn.includes('1／6'),
    'ECHO 的委託完成：回收記憶片段 1，ECHO 的紀錄顯示（' + mem.btn + '）',
  );
  // 真結局的條件：紫色委託不夠時沒有第三個出口，通訊與說明卡說明；全部完成過才出現
  const exits = async (hist) => {
    await page.evaluate((hist) => {
      const g = window.__game;
      if (g.camp) g.campEnd(false, true);
      g.hubEcho(false);
      g.state = 'play';
      const st = g.campStory();
      st.cycle = 3;
      st.done = { c1x: 1, c2x: 1 };
      st.history = [{ cycle: 2, done: hist, choices: { c2: 'castron', c4: 'sancta', c6: 'seal' } }];
      g.campBegin('c6s3');
      g.camp.seg = 5;
      g.camp.types[5] = 'supply';
      g.campEnterSeg();
    }, hist);
    await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
      timeout: 20000,
    });
    return page.evaluate(() => {
      const g = window.__game;
      const T = g.campTruth();
      const e = g.commPick('choice', g.campCtx());
      // 說明卡（冒煙測試平常略過）：鎖住的第三條路
      g.autoPickMod = false;
      g.campChoiceCard(
        'c6',
        g.camp.exits.map((q) => q.choice),
      );
      const card = document.getElementById('mpCards').textContent;
      document.getElementById('modPick').classList.remove('on');
      g.state = 'play';
      g.autoPickMod = true;
      return {
        ex: g.camp.exits.map((q) => q.choice).join(','),
        n: T.n,
        line: e ? e.lines.map((l) => l[1]).join(' ') : '',
        card,
      };
    });
  };
  const ex1 = await exits({ c3x: 1 });
  const ex2 = await exits({ c3x: 1, c4x: 1, c5x: 1, c6x: 1 });
  check(
    ex1.ex === 'open,seal' &&
      ex1.n === 3 &&
      ex1.line.includes('全部的紀錄') &&
      ex1.card.includes('3／6') &&
      ex2.ex === 'open,seal,beyond' &&
      ex2.line.includes('第三個出口'),
    '真結局的條件：紫色委託 ' +
      ex1.n +
      '／6 時沒有第三個出口（說明卡與通訊說明），全部完成過才出現（' +
      ex2.ex +
      '）',
  );
  // 真結局＋6 片記憶片段：多一段結尾
  const ep = await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    g.campStory().memories = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 };
    g.openEpilogue('beyond');
    const full = document.getElementById('epLines').textContent;
    g.campStory().memories = { 1: 1 };
    g.openEpilogue('beyond');
    return { full, part: document.getElementById('epLines').textContent };
  });
  check(
    ep.full.includes('循環沒有再開始') && !ep.part.includes('循環沒有再開始'),
    '真結局：6 片記憶片段全部回收時多一段結尾',
  );
  // 第 2 周目：依上一周目的抉擇改變通訊與紫色委託的簡報
  const pv = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    st.cycle = 2;
    const pick = (hist, ev, ctx) => {
      st.history = [{ cycle: 1, done: {}, choices: hist }];
      const e = g.commPick(ev, { ...ctx, cycle: 2, ...g.campPrevCtx() });
      return e ? e.lines.map((l) => l[1]).join(' ') : '';
    };
    const out = {
      c2c: pick({ c2: 'castron' }, 'choice', { sid: 'c2s2', chapter: 2 }),
      c2a: pick({ c2: 'aetheric' }, 'choice', { sid: 'c2s2', chapter: 2 }),
      c4v: pick({ c4: 'veerwell' }, 'sortieStart', { sid: 'c4s1', chapter: 4 }),
      endS: pick({ c6: 'seal' }, 'sortieStart', { sid: 'c1s1', chapter: 1 }),
    };
    st.history = [{ cycle: 1, done: {}, choices: { c2: 'aetheric' } }];
    st.done = { c1s1: 1, c2s2: 1 };
    g.openBrief('c2x');
    out.brief = document.getElementById('brLines').textContent;
    return out;
  });
  check(
    pv.c2c.includes('卡斯特隆') &&
      pv.c2a.includes('研究機構') &&
      pv.c4v.includes('上一次') &&
      pv.endS.includes('墜落') &&
      pv.brief.includes('冷卻槽'),
    '第 2 周目：依上一周目的抉擇改變通訊與簡報（' + JSON.stringify(pv).slice(0, 160) + '…）',
  );
  await ctx.close();
}

// 主線的劇本：序章與章節的開場／章末（全畫面）、簡報依抉擇、宿敵依抉擇、擊破宿敵的台詞、結局之後的回收程序、章節回顧
async function testStory(browser, base) {
  console.log('主線的劇本：序章、章節畫面、依抉擇的簡報與宿敵、回收程序');
  const { ctx, page } = await newPage(browser, 'story');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => {
    const g = window.__game;
    g.autoPickMod = true;
    g.storyTest = true;
    g.ctrl.cine = 'off'; // 這裡測文字畫面（過場動畫在 testCine）
    const st = g.campStory();
    st.cycle = 1;
    st.done = {};
    st.choices = {};
    st.storySeen = {};
    g.openHub();
  });
  const s1 = await page.evaluate(() => ({
    state: window.__game.state,
    title: document.getElementById('stTitle').textContent,
    n: document.querySelectorAll('#stLines p').length,
  }));
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-prologue.png') });
  // 逐字全部顯示後的畫面
  await page.evaluate(() => window.__game.tfxSkip());
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-prologue-full.png') });
  await page.evaluate(() => window.__game.storyNext());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__game.tfxSkip());
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-ch1.png') });
  await page.evaluate(() => {
    const g = window.__game;
    g.storySeen().i1_1 = 0;
    g.storyQ = [];
    g.storyPlay(['p1', 'i1_1'], () => g.openHub());
  });
  // 繼續：逐字還沒完時先全部顯示，再按一次換下一則
  const next = () =>
    page.evaluate(() => {
      const g = window.__game;
      g.storyTypeEnd = 0;
      g.storyContinue();
    });
  const typing = await page.evaluate(() => window.__game.storyTypeEnd > performance.now());
  await page.click('#btnStoryNext');
  const same = await page.evaluate(() => document.getElementById('stTitle').textContent);
  check(!typing || same.includes('序章'), '章節畫面：逐字中按「繼續」先全部顯示');
  await next();
  const s2 = await page.evaluate(() => document.getElementById('stTitle').textContent);
  await next();
  const s3 = await page.evaluate(() => window.__game.state);
  check(
    s1.state === 'story' && s1.title.includes('序章') && s1.n >= 4 && s2.includes('第一章') && s3 === 'hub',
    '作戰室：第一次進入時播序章與第 1 章的開場，之後回到作戰室（' + s1.title + ' → ' + s2 + '）',
  );
  // 整章完成 → 結果畫面之後播章末 → 下一章的開場
  await page.evaluate(() => {
    const g = window.__game;
    g.campStory().done = { c1s1: 1 };
    g.state = 'play';
    g.campBegin('c1s2');
    g.campEnterSeg();
    g.campEnd(true);
  });
  await waitVisible(page, 'result');
  await page.click('#btnResultOk');
  await waitVisible(page, 'storyScr');
  const o1 = await page.evaluate(() => document.getElementById('stTitle').textContent);
  await next();
  const i2 = await page.evaluate(() => ({
    state: window.__game.state,
    title: document.getElementById('stTitle').textContent,
  }));
  check(
    o1.includes('第一章') && o1.includes('完') && i2.state === 'story' && i2.title.includes('第二章'),
    '整章完成：結果畫面之後播章末，接著播下一章的開場（' + o1 + ' → ' + i2.title + '）',
  );
  await next();
  // 章末依抉擇：第 2 章
  const o2 = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    const t = (k) => {
      st.choices = { c2: k };
      return g.storyItem('o1_2').lines.join('');
    };
    return { c: t('castron'), a: t('aetheric') };
  });
  check(
    o2.c.includes('閘門') && !o2.c.includes('冷卻槽') && o2.a.includes('冷卻槽') && !o2.a.includes('慶功宴'),
    '第 2 章的章末依抉擇 1 不同',
  );
  // 簡報依抉擇：第 3 章 c3s3 的委託方、c3s1 的句子；紫色委託由米拉說明
  const br = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    st.done = { c1s1: 1, c1s2: 1, c2s1: 1, c2s2: 1, c2s3a: 1, c3s1: 1, c3s2: 1 };
    const out = {};
    for (const k of ['castron', 'aetheric']) {
      st.choices = { c2: k };
      g.openBrief('c3s3');
      out[k] = document.getElementById('brClient').textContent;
      g.openBrief('c3s1');
      out[k + '1'] = document.getElementById('brLines').textContent;
    }
    g.openBrief('c1x');
    out.mira = document.getElementById('brClient').textContent;
    return out;
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-brief.png') });
  check(
    br.castron.includes('霍斯特') &&
      br.aetheric.includes('薩奇') &&
      br.castron1.includes('閘門沒開') &&
      br.aetheric1.includes('河乾了') &&
      br.mira.includes('米拉'),
    '簡報依抉擇：c3s3 的委託方與 c3s1 的句子不同，紫色委託由米拉說明（' +
      br.castron +
      '／' +
      br.aetheric +
      '）',
  );
  // 宿敵依抉擇：c6s1 依抉擇 1、c6s3 依抉擇 2、最後的抉擇區段是 ZENITH；擊破宿敵與依抉擇的通訊
  const ace = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    const segAce = (sid, f, ch) => {
      st.choices = ch;
      g.camp = { sid, seg: 0, choice: null, types: {} };
      const seg = g.campSortie().segs.find(f);
      const a = g.campSegAce(seg);
      g.camp = null;
      return a;
    };
    const pick = (ev, c) => {
      const e = g.commPick(ev, c);
      return e ? e.lines.map((l) => l[1]).join(' ') : '';
    };
    return {
      c6s1c: segAce('c6s1', (s) => s.ace, { c2: 'castron' }),
      c6s1a: segAce('c6s1', (s) => s.ace, { c2: 'aetheric' }),
      c6s3v: segAce('c6s3', (s) => s.ace && !s.choice, { c4: 'veerwell' }),
      c6s3s: segAce('c6s3', (s) => s.ace && !s.choice, { c4: 'sancta' }),
      zen: segAce('c6s3', (s) => s.choice, {}),
      down: pick('aceDown', { ace: 'rust' }),
      zline: pick('segStart', { sid: 'c6s3', type: 'elite', ace: 'zenith', cycle: 1, truth: false }),
      c2end: pick('sortieEnd', { sid: 'c2s2', c2: 'aetheric' }),
    };
  });
  check(
    ace.c6s1c === 'prospector' &&
      ace.c6s1a === 'rust' &&
      ace.c6s3v === 'whiteout' &&
      ace.c6s3s === 'specimen' &&
      ace.zen === 'zenith' &&
      ace.down.includes('天線') &&
      ace.zline.includes('上一個') &&
      ace.c2end.includes('冷卻'),
    '宿敵依抉擇、最後的抉擇區段的 ZENITH、擊破宿敵與依抉擇的通訊（' +
      JSON.stringify(ace).slice(0, 120) +
      '…）',
  );
  // 結局之後的回收程序：交出／墜落有，第 2 周目多兩句，真結局沒有
  const rc = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    st.cycle = 1;
    g.openEpilogue('open');
    const a = document.querySelector('#epLines .epRecall');
    const o = { open: a ? a.textContent : '' };
    st.cycle = 2;
    g.openEpilogue('seal');
    o.seal2 = (document.querySelector('#epLines .epRecall') || {}).textContent || '';
    st.cycle = 3;
    g.openEpilogue('beyond');
    o.beyond = !!document.querySelector('#epLines .epRecall');
    st.cycle = 1;
    return o;
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-recall.png') });
  check(
    rc.open.includes('KEY-07') && rc.seal2.includes('私人頻道') && !rc.beyond,
    '結局之後的回收程序（第 2 周目多兩句、真結局沒有）',
  );
  // 章節回顧：看過的可以重看
  const rv = await page.evaluate(() => {
    const g = window.__game;
    g.openHub();
    g.hubStory(true);
    const n = document.querySelectorAll('#hubStoryList .storyItem').length;
    document.querySelector('#hubStoryList .storyItem').click();
    return { n, state: g.state, title: document.getElementById('stTitle').textContent };
  });
  check(
    rv.n >= 4 && rv.state === 'story' && rv.title.includes('序章'),
    '章節回顧：列出看過的 ' + rv.n + ' 則並重看',
  );
  // 手機橫式：按鈕捲得到
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'story-phone.png') });
  const fit = await page.evaluate(() => {
    const sc = document.getElementById('storyScr');
    const b = document.getElementById('btnStoryNext');
    b.scrollIntoView();
    const r = b.getBoundingClientRect();
    return r.height > 0 && r.bottom <= window.innerHeight + 1 && sc.scrollWidth <= sc.clientWidth + 1;
  });
  check(fit, '手機橫式：章節畫面的按鈕捲得到、沒有橫向捲動');
  await ctx.close();
}

// 各主題的第 5、6 種變體：生成、特徵（物件、涉水、夜間不疊加時間）、主線排程用得到、截圖
// 過場動畫（game/cine.js、data/cine/）：劇本、配樂、播放到結束、各鏡頭的截圖、略過、接回故事畫面、設定關閉、手機
async function testCine(browser, base) {
  console.log(
    '過場動畫：序章與各章的劇本、配樂、播放、略過、故事畫面的接續、設定關閉、手機版面、過場動畫劇場',
  );
  const { ctx, page } = await newPage(browser, 'cine');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 劇本：3 個周目 × 序章、6 章開場、5 章章末都產生得出來；依抉擇的章末不同
  const defs = await page.evaluate(() => {
    const g = window.__game;
    const all = [1, 2, 3].map((c) => g.cineDefs({ cycle: c }).filter((d) => d.k.slice(1, 2) === String(c)));
    const o2c = g.cineDefs({ choices: { c2: 'castron' } }).find((d) => d.k === 'o1_2');
    const o2a = g.cineDefs({ choices: { c2: 'aetheric' } }).find((d) => d.k === 'o1_2');
    return { all, o2c, o2a };
  });
  const flat = defs.all.flat();
  check(
    flat.length === 36 && flat.every((d) => d.n > 0 && d.dur > 8),
    `劇本：序章與各章開場／章末都有鏡頭（${flat.length} 段，最短 ${Math.min(...flat.map((d) => d.dur)).toFixed(0)} 秒）`,
  );
  const p1 = defs.all[0].find((d) => d.k === 'p1');
  check(p1.dur > 120 && p1.n >= 25, `序章約 2 分鐘以上、${p1.n} 個鏡頭（${p1.dur.toFixed(0)} 秒）`);
  check(defs.o2c.subs > 0 && defs.o2a.subs > 0, '第 2 章章末依抉擇產生');
  // 播放序章：配樂載入、從頭播到結束（測試以 6 倍速）
  await page.evaluate(() => {
    const g = window.__game;
    g.cineTest = 6;
    window.__cineEnd = null;
    window.__cineShots = new Set();
    g.cinePlay('p1', (skipped) => (window.__cineEnd = skipped ? 'skip' : 'done'));
    window.__cineIv = setInterval(() => g.cine && window.__cineShots.add(g.cine.shot), 50);
  });
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  const mus = await page.evaluate(() => ({
    lib: !!window.RUBICON_MUSIC,
    n: window.RUBICON_MUSIC ? Object.keys(window.RUBICON_MUSIC).length : 0,
    ok: window.__game.cine.musicOk,
    state: window.__game.state,
  }));
  check(
    mus.lib && mus.n >= 4 && mus.state === 'cine',
    `配樂：從 lib/cine-music.js 載入 ${mus.n} 首、state＝cine`,
  );
  const ended = await page
    .waitForFunction(() => window.__cineEnd, null, { timeout: 120000 })
    .then(
      () => true,
      () => false,
    );
  const seen = await page.evaluate(() => {
    clearInterval(window.__cineIv);
    return { n: window.__cineShots.size, end: window.__cineEnd, state: window.__game.state };
  });
  check(ended && seen.end === 'done', `序章播到結束（經過 ${seen.n} 個鏡頭）`);
  check(
    seen.n >= 12,
    `序章：換場景時建地圖也不會卡住整段（播到 ${seen.n} 個鏡頭；測試以 6 倍速，換場景時會跳過幾個）`,
  );
  // 各個段落的截圖（跳到指定秒數）
  await page.evaluate(() => {
    const g = window.__game;
    g.cineTest = 1;
    g.cinePlay('p1', () => {});
  });
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  const snaps = [
    [10, 'signal'],
    [16, 'orbit'],
    [25, 'station'],
    [31, 'drop'],
    [41, 'entry'],
    [57.5, 'vista'],
    [73.5, 'wake'],
    [80, 'montage-dam'],
    [88.5, 'montage-rail'],
    [95, 'montage-snow'],
    [111, 'zenith'],
    [124, 'logo'],
  ];
  const lit = [];
  for (const [t, name] of snaps) {
    await page.evaluate((t) => window.__game.cineSeek(t), t);
    await page.waitForTimeout(900);
    lit.push(
      await page.evaluate(() => {
        const g = window.__game;
        return { shot: g.cine.shot, actors: g.cine.actors.size, world: !!g.world };
      }),
    );
    await page.screenshot({ path: path.join(SHOT_DIR, `cine-${name}.png`) });
  }
  check(
    lit[6].actors >= 2 && lit[6].world && lit[9].actors >= 2,
    '甦醒與蒙太奇：地圖與演員（主角、墜落的空降艙、Boss）都建好',
  );
  // 長按 Esc 略過
  await page.keyboard.down('Escape');
  await page.waitForTimeout(1300);
  await page.keyboard.up('Escape');
  const sk = await page.evaluate(() => ({ cine: !!window.__game.cine, state: window.__game.state }));
  check(!sk.cine, '長按 Esc 略過過場動畫');
  // 故事畫面：第一次進作戰室播序章的過場動畫；略過時改顯示序章的文字畫面，之後接第 1 章開場的過場動畫
  await page.evaluate(() => {
    const g = window.__game;
    g.storyTest = true;
    g.cineTest = 4;
    g.ctrl.cine = 'on';
    const st = g.campStory();
    st.cycle = 1;
    st.done = {};
    st.choices = {};
    st.storySeen = {};
    g.openHub();
  });
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  const k1 = await page.evaluate(() => window.__game.cine.key);
  await page.evaluate(() => window.__game.cineEnd(true));
  const t1 = await page.evaluate(() => ({
    state: window.__game.state,
    title: document.getElementById('stTitle').textContent,
  }));
  check(
    k1 === 'p1' && t1.state === 'story' && t1.title.includes('序章'),
    '作戰室：序章播過場動畫，略過時改顯示序章的文字',
  );
  await page.evaluate(() => window.__game.storyNext());
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  const k2 = await page.evaluate(() => window.__game.cine.key);
  await page.evaluate(() => window.__game.cineSeek(window.__game.cine.def.dur - 0.3));
  await page.waitForFunction(() => window.__game.state === 'hub', null, { timeout: 20000 }).catch(() => {});
  const t2 = await page.evaluate(() => window.__game.state);
  check(k2 === 'i1_1' && t2 === 'hub', '第 1 章開場的過場動畫播完回到作戰室');
  // 章節回顧：劇本改版前就打完第 1 章的舊存檔（storySeen 是空的）也看得到序章、第 1 章的開場與章末、第 2 章的開場
  const rv = await page.evaluate(() => {
    const g = window.__game;
    const st = g.campStory();
    st.cycle = 1;
    st.choices = {};
    st.storySeen = {};
    st.done = { c1s1: 1, c1s2: 1, c1x: 0 };
    const k = Object.keys(g.storyUnlocked()).filter((x) => g.storyItem(x));
    g.hubStory(true);
    const n = document.querySelectorAll('#hubStoryList .storyItem').length;
    g.hubStory(false);
    return { k, n };
  });
  check(
    ['p1', 'i1_1', 'o1_1', 'i1_2'].every((k) => rv.k.includes(k)) && rv.n >= 4,
    `章節回顧：舊存檔依進度列出序章與已經打過的章節（${rv.k.join('、')}）`,
  );
  // 設定「劇情動畫」關閉：改用文字畫面
  await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.cine = 'off';
    g.storyPlay(['o1_1'], () => g.openHub());
  });
  const t3 = await page.evaluate(() => ({ state: window.__game.state, cine: !!window.__game.cine }));
  check(t3.state === 'story' && !t3.cine, '設定關閉劇情動畫時改用文字畫面');
  // 手機橫式：遮幅與字幕
  await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.cine = 'on';
    g.cineTest = 1;
    g.cinePlay('i1_2', () => {});
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  await page.evaluate(() => window.__game.cineSeek(9));
  await page.waitForTimeout(900);
  const ph = await page.evaluate(() => {
    const s = document.getElementById('cineSub').getBoundingClientRect();
    return { on: document.getElementById('cineSub').classList.contains('on'), w: s.width, b: s.bottom };
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'cine-phone.png') });
  check(ph.on && ph.w <= 844 && ph.b <= 390, '手機橫式：字幕在畫面內');
  await page.evaluate(() => window.__game.cineEnd(true));
  // 抉擇演出：抉擇區段清除後先在戰場上播選前的演出（live，播完回到戰鬥），走進出口後播選後的代價，再到轉場畫面
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.evaluate(() => {
    const g = window.__game;
    g.ctrl.cine = 'on';
    g.storyTest = true;
    g.autoPickMod = true;
    g.cineTest = 1;
    const st = g.campStory();
    st.done = { c1s1: 1, c1s2: 1, c2s1: 1 };
    st.choices = {};
    g.campBegin('c2s2');
    g.camp.seg = 3;
    g.camp.types[3] = 'battle';
    g.camp.plan[3] = { ...g.camp.plan[3], variant: '', landmark: '' };
    g.campEnterSeg();
  });
  const pre = await page
    .waitForFunction(
      () => {
        const g = window.__game;
        if (g.cine) return g.cine.key;
        g.waves = [];
        g.wavePend = null;
        for (const e of g.enemies || [])
          if (!e.dead) {
            e.bossVis = 0;
            e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
          }
        return false;
      },
      null,
      { timeout: 40000, polling: 300 },
    )
    .then(
      (h) => h.jsonValue(),
      () => null,
    );
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 20000,
  });
  await page.evaluate(() => window.__game.cineSeek(4.5));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOT_DIR, 'cine-choice-pre.png') });
  const live = await page.evaluate(() => ({
    live: window.__game.cine.live,
    world: !!window.__game.world,
    ex: window.__game.camp.exits.length,
  }));
  await page.evaluate(() => window.__game.cineEnd(true));
  const back = await page.evaluate(() => window.__game.state);
  check(
    pre === 'x_c2_pre' && live.live && live.world && live.ex === 2 && back === 'play',
    `抉擇演出（選前）：在目前的戰場上播、播完回到戰鬥（${pre}、${back}）`,
  );
  // 走進出口到播出選後的演出：主迴圈停住、以固定 dt 推進，最多 10 秒遊戲時間；演出開始播（配樂載入）是非同步的，照常等。
  // 分段開放的作戰區域（staged）在出口出現時可能還在擴大（每秒 30 m），出口在擴大後的範圍裡：先推進到擴大完，
  // 否則玩家放到出口會被推回作戰區域內、站不進出口（以前靠實際經過的時間，負載高時遊戲時間不夠就失敗）
  await freezeLoop(page);
  const postT = await page.evaluate(() => {
    const g = window.__game;
    const e = g.camp.exits.find((q) => q.choice === 'castron');
    window.__pump(10, () => !g.world.zoneGoal);
    g.flows = [];
    g.player.pos.copy(e.pos);
    return window.__pump(10, () => !!g.cine);
  });
  const post = await page
    .waitForFunction(() => window.__game.cine && window.__game.cine.started && window.__game.cine.key, null, {
      timeout: 20000,
      polling: 200,
    })
    .then(
      (h) => h.jsonValue(),
      () => null,
    );
  await page.evaluate(() => {
    window.__game.cineSeek(5);
    window.__pump(1.2);
  });
  await page.screenshot({ path: path.join(SHOT_DIR, 'cine-choice-post.png') });
  await page.evaluate(() => window.__game.cineEnd(true));
  const tr = await waitVisible(page, 'campTrans', 8000);
  await thawLoop(page);
  if (postT < 0) console.log('    （走進出口 10 秒遊戲時間內沒有播出選後的演出）');
  check(post === 'x_c2_castron' && tr, `抉擇演出（選後）：代價的蒙太奇之後到轉場畫面（${post}）`);
  await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    g.state = 'title';
    g.showScreen('title');
  });
  // 過場動畫劇場：標題按鈕、依周目與抉擇的清單、選前演出改在代替的地圖上播、暫停、下一鏡、返回清單
  await page.click('#btnCineLib');
  const lib = await page.evaluate(() => {
    const g = window.__game;
    return { st: g.state, n: g.clibItems.length, ks: g.clibItems.map((i) => i.k) };
  });
  check(
    lib.st === 'cinelib' && lib.n === 22 && lib.ks.includes('p1') && lib.ks.includes('x_c6_beyond'),
    `過場動畫劇場：第 1 周目列出 ${lib.n} 段（序章、開場、章末、抉擇演出）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.cineTest = 1;
    g.cineLibPlay(g.clibItems.findIndex((i) => i.k === 'x_c2_pre'));
  });
  await page.waitForFunction(() => window.__game.cine && window.__game.cine.started, null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.cineLibPause();
    g.cineLibSeek(1.5);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(SHOT_DIR, 'cine-lib-pre.png') });
  const lp = await page.evaluate(async () => {
    const g = window.__game;
    const t0 = g.cine.t;
    await new Promise((r) => setTimeout(r, 600));
    const still = Math.abs(g.cine.t - t0) < 0.01;
    g.cineLibShot(1);
    await new Promise((r) => setTimeout(r, 300));
    return {
      still,
      shot: g.cine.shot,
      hero: !!(g.cine.actors.get('player') && g.cine.actors.get('player').e),
      ex: (g.cine.set.exits || []).length,
      ctl: getComputedStyle(document.getElementById('cineCtl')).display !== 'none',
    };
  });
  await page.click('#clStop');
  const back2 = await page.evaluate(() => window.__game.state);
  check(
    lp.still && lp.shot === 1 && lp.hero && lp.ex === 2 && lp.ctl && back2 === 'cinelib',
    `過場動畫劇場：代替的戰場（主角、${lp.ex} 個出口）、暫停、下一鏡、返回清單（${back2}）`,
  );
  await ctx.close();
}

async function testVariants6(browser, base) {
  console.log('主題變體：各主題補到 6 種');
  const { ctx, page } = await newPage(browser, 'var6');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const NEW = {
    industrial: ['tankfarm', 'conveyor'],
    dam: ['night', 'quarry'],
    flooded: ['stilts', 'mist'],
    snow: ['forest', 'polar'],
    institute: ['flooded', 'blackout'],
    grid086: ['pillars', 'rust'],
    spaceport: ['crash', 'launchnight'],
    xylem: ['bridges', 'night'],
    orbit: ['debris', 'sunlit'],
    wasteland: ['craters', 'town'],
    dunes: ['buried', 'night'],
    desert: ['drowned', 'collapse'],
  };
  const res = await page.evaluate((NEW) => {
    const g = window.__game;
    g.state = 'play';
    g.campBegin('c1s1');
    g.camp.types[0] = 'supply';
    g.campEnterSeg();
    g.state = 'foe-test';
    const W = g.world.constructor;
    const out = { bad: [], feat: {} };
    let seed = 1500;
    for (const th in NEW) {
      for (const v of NEW[th]) {
        g.world.dispose();
        g.world = new W(g.scene, th, seed++, 3, null, { variant: v, landmark: '', tod: 'night' });
        const w = g.world;
        if (w.variantKey !== v) out.bad.push(th + ':' + v);
        const kinds = {};
        for (const p of w.props || []) kinds[p.kind] = (kinds[p.kind] || 0) + 1;
        out.feat[th + ':' + v] = {
          kinds,
          decks: w.obstacles.filter((o) => o.deck).length,
          // 中央出生點附近是整平的，量周圍幾個點的中位數
          wade: [0, 1, 2, 3, 4, 5, 6, 7]
            .map((i) => w.waterDepth(Math.cos(i * 0.785) * 30 * w.k, Math.sin(i * 0.785) * 30 * w.k))
            .sort((a, b) => a - b)[4],
          noTod: !!w.theme.noTod,
          ok: Number.isFinite(w.terrainHeight(20, 20)),
        };
      }
    }
    return out;
  }, NEW);
  const F = res.feat;
  check(
    res.bad.length === 0 && Object.values(F).every((f) => f.ok),
    '12 個主題的新變體都能生成（' + (res.bad.join('、') || '全部') + '）',
  );
  check(
    (F['industrial:tankfarm'].kinds.container || 0) > 0 &&
      F['industrial:conveyor'].decks >= 6 &&
      F['snow:forest'].kinds.pine >= 15 &&
      F['dam:quarry'].kinds.rockpile > 0 &&
      F['desert:collapse'].kinds.rockpile > 0 &&
      F['institute:blackout'].kinds.lamppost > 0 &&
      F['flooded:stilts'].decks >= 4 &&
      F['wasteland:town'].kinds.car > 0,
    '新變體的物件（儲油槽區的貨櫃、輸送帶 ' +
      F['industrial:conveyor'].decks +
      ' 段、針葉樹 ' +
      F['snow:forest'].kinds.pine +
      ' 棵、落石、緊急照明、高腳平台 ' +
      F['flooded:stilts'].decks +
      ' 座）',
  );
  check(
    F['institute:flooded'].wade > 0.6 && F['desert:drowned'].wade > 0.6,
    '浸水的變體要涉水（技研都市 ' +
      F['institute:flooded'].wade.toFixed(2) +
      ' m、礦坑 ' +
      F['desert:drowned'].wade.toFixed(2) +
      ' m）',
  );
  check(
    ['dam:night', 'snow:polar', 'xylem:night', 'dunes:night', 'spaceport:launchnight', 'orbit:sunlit'].every(
      (k) => F[k].noTod,
    ),
    '夜間與日照面的變體不再疊加主線的時間',
  );
  // 主線排程與自由出擊的選單用得到新變體
  const plan = await page.evaluate(() => {
    const g = window.__game;
    const seen = new Set();
    if (g.camp) g.campEnd(false, true);
    for (let i = 0; i < 30; i++) {
      g.save.story.recent = [];
      for (const sid of ['c2s1', 'c3s1', 'c5s1', 'c6s1']) {
        g.state = 'play';
        g.campBegin(sid);
        for (const p of g.camp.plan) seen.add(p.variant);
        g.campEnd(false, true);
      }
    }
    return [...seen];
  });
  check(
    ['tankfarm', 'conveyor', 'forest', 'polar', 'bridges', 'sunlit'].filter((k) => plan.includes(k)).length >=
      4,
    '主線排程會排到新變體（' + plan.length + ' 種）',
  );
  for (const [th, v] of [
    ['industrial', 'tankfarm'],
    ['industrial', 'conveyor'],
    ['snow', 'forest'],
    ['institute', 'blackout'],
    ['spaceport', 'crash'],
    ['wasteland', 'town'],
  ]) {
    await page.evaluate(
      ([th, v]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = th;
        g.camp.plan[0] = { ...g.camp.plan[0], variant: v, landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
      },
      [th, v],
    );
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'var6-' + th + '-' + v + '.png') });
  }
  await ctx.close();
}

// 主線第 6 章：高空軌道（真空作業機、軌道標定衛星、ZENITH）、出擊、最後的抉擇、結局與周目
async function testChapter6(browser, base) {
  console.log('第 6 章：高空軌道的專屬敵人與 AC、變體與地標、出擊、結局與周目');
  const { ctx, page } = await newPage(browser, 'ch6');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  const enter = (theme, variant) =>
    page.evaluate(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
        g.state = 'foe-test';
        g.player.hp = g.player.maxHp = 1e6;
        window.__step = (ents, n, stop) => {
          const p = g.player;
          for (let i = 0; i < n; i++) {
            g.time += 1 / 60;
            p.iFrames = 0;
            for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
            if (stop && stop()) return i;
          }
          return n;
        };
      },
      [theme, variant],
    );
  await enter('orbit', 'dock');
  const ob = await page.evaluate(() => {
    const g = window.__game,
      p = g.player,
      w = g.world;
    const at = (dx, dz) => {
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, w.terrainHeight(x, z), z);
    };
    const out = {};
    // 真空作業機：一直懸浮、改變高度
    const vc = g.spawnType('vacuum', 1, 1, at(0, -20), 1);
    const hs = new Set();
    // 起飛之後離地 2 m 以上的比例（飛過模組邊緣時地面高度會突然變高，所以不看最低值）
    let up = 0,
      tick = 0;
    window.__step([vc], 400, () => {
      const a = vc.pos.y - w.groundRef(vc.pos.x, vc.pos.z, vc.pos.y);
      if (++tick > 120 && a > 2) up++;
      hs.add(Math.round(vc.hoverH));
      return false;
    });
    out.vac = { fly: vc.flying, up: up / (tick - 120), heights: hs.size };
    vc.takeDamage(1e9, 0, p, vc.center(), new THREE.Vector3(0, 0, 1));
    // 軌道標定衛星：標定後受傷變重
    const h0 = p.hp;
    p.takeDamage(1000, 0, null, p.center(), null);
    const base = h0 - p.hp;
    const mk = g.spawnType('marker', 1, 1, at(0, -25), 1);
    window.__step([mk], 300, () => p.markT > 0);
    out.marked = p.markT > 0;
    const h1 = p.hp;
    p.takeDamage(1000, 0, null, p.center(), null);
    out.mult = (h1 - p.hp) / base;
    mk.takeDamage(1e9, 0, p, mk.center(), new THREE.Vector3(0, 0, 1));
    // ZENITH：精英區段，幾乎不落地
    g.state = 'play';
    g.camp.types[0] = 'elite';
    g.campEnterSeg();
    g.state = 'foe-test';
    const z = g.bosses[0];
    g.player.hp = g.player.maxHp = 1e6;
    const log = (g.save.story.log || []).map((l) => l.sp);
    let maxAlt = 0;
    window.__step([z], 300, () => {
      maxAlt = Math.max(maxAlt, z.pos.y - g.world.groundRef(z.pos.x, z.pos.z, z.pos.y));
      return false;
    });
    out.zen = { name: z && z.name, comm: log.includes('zenith'), maxAlt };
    return out;
  });
  check(
    ob.vac.fly && ob.vac.up > 0.85 && ob.vac.heights >= 2,
    '真空作業機：一直懸浮、改變高度（' + JSON.stringify(ob.vac) + '）',
  );
  check(ob.marked && ob.mult > 1.2, '軌道標定衛星：標定後受到的傷害變重（×' + ob.mult.toFixed(2) + '）');
  check(
    ob.zen.name === 'ZENITH' && ob.zen.comm && ob.zen.maxAlt > 6,
    '精英區段：高空軌道是 ZENITH（空戰，最高離地 ' + ob.zen.maxAlt.toFixed(1) + ' m），有通訊',
  );
  const ov = await page.evaluate(() => {
    const g = window.__game;
    const W = g.world.constructor;
    const out = [];
    const lms = ['tether', 'solar', 'freighter', 'antenna', 'ring', 'hab'];
    ['cluster', 'span', 'dock', 'nightside', '', ''].forEach((v, i) => {
      g.world.dispose();
      g.world = new W(g.scene, 'orbit', 1400 + i, 3, null, { variant: v || undefined, landmark: lms[i] });
      out.push((g.world.variantKey || '-') + ':' + (g.world.landmark ? 1 : 0));
    });
    return out;
  });
  check(
    ov.slice(0, 4).every((s, i) => s.startsWith(['cluster', 'span', 'dock', 'nightside'][i])) &&
      ov.filter((s) => s.endsWith(':1')).length >= 5,
    '高空軌道的 4 種變體與地標（' + ov.join('、') + '）',
  );
  for (const v of ['cluster', 'nightside']) {
    await enter('orbit', v);
    await page.evaluate(() => (window.__game.state = 'play'));
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(SHOT_DIR, 'ch6-orbit-' + v + '.png') });
  }
  // 第 6 章的出擊：宇宙港 → 軌道（上升）、終點 Boss
  const c6 = await page.evaluate(() => {
    const g = window.__game;
    if (g.camp) g.campEnd(false, true);
    g.state = 'play';
    const out = [];
    for (const sid of ['c6s1', 'c6s2', 'c6s3']) {
      g.campBegin(sid);
      const n = g.campSortie().segs.length;
      g.camp.seg = n - 1;
      g.camp.types[n - 1] = 'boss';
      g.campEnterSeg();
      out.push(sid + ':' + n + ':' + ((g.bossDef && g.bossDef.name) || '').split(' ')[0]);
      g.campEnd(false, true);
    }
    return out;
  });
  check(
    c6.join(',') === 'c6s1:7:SERAPHIM,c6s2:7:DOPPEL,c6s3:7:BALTEUS',
    '第 6 章的 3 個出擊（各 7 段）與終點 Boss（' + c6.join('、') + '）',
  );
  // 最後的抉擇：第 1 周目兩個出口，第 3 周目多一個（真結局）
  const finalExits = async (cycle) => {
    await page.evaluate((cycle) => {
      const g = window.__game;
      if (g.camp) g.campEnd(false, true);
      g.state = 'play';
      g.save.story.cycle = cycle;
      // 真結局的出口另外要完成全部紫色委託（哪一周目都算）
      g.save.story.history =
        cycle >= 3
          ? [{ cycle: 2, done: { c1x: 1, c2x: 1, c3x: 1, c4x: 1, c5x: 1, c6x: 1 }, choices: {} }]
          : [];
      g.campBegin('c6s3');
      g.camp.seg = 5;
      g.camp.types[5] = 'supply';
      g.campEnterSeg();
    }, cycle);
    await page.waitForFunction(() => window.__game.camp && window.__game.camp.exits.length >= 2, null, {
      timeout: 20000,
    });
    return page.evaluate(() => window.__game.camp.exits.map((e) => e.choice));
  };
  const e1 = await finalExits(1);
  const e3 = await finalExits(3);
  check(
    e1.join(',') === 'open,seal' && e3.join(',') === 'open,seal,beyond',
    '最後的抉擇：第 1 周目 ' + e1.length + ' 個出口、第 3 周目多出真結局的出口（' + e3.join('、') + '）',
  );
  // 選真結局 → 完成 → 結果畫面 → 結局畫面
  await page.evaluate(() => {
    const g = window.__game;
    const e = g.camp.exits.find((q) => q.choice === 'beyond');
    g.campLeave(e);
    g.campEnterSeg();
    g.campEnd(true);
  });
  await waitVisible(page, 'result');
  await page.click('#btnResultOk');
  check(await waitVisible(page, 'epilogue'), '終章完成：結果畫面之後顯示結局');
  const ep = await page.evaluate(() => ({
    title: document.getElementById('epTitle').textContent,
    next: getComputedStyle(document.getElementById('btnEpNext')).display,
    endings: Object.keys(window.__game.save.story.endings || {}),
  }));
  check(
    ep.title.includes('彼岸') && ep.endings.includes('beyond') && ep.next === 'none',
    '真結局「彼岸」，第 3 周目後不再有下一周目（' + ep.title + '）',
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'ch6-ending.png') });
  // 第 1 周目的結局 → 開始第 2 周目：委託重來、抉擇清空、紀錄留在 history
  await page.evaluate(() => {
    const g = window.__game;
    g.save.story.cycle = 1;
    g.save.story.done = { c1s1: 1, c6s3: 1 };
    g.save.story.history = [];
    g.save.story.choices = { c2: 'castron', c4: 'sancta' };
    g.openEpilogue('seal');
  });
  const ep2 = await page.evaluate(() => getComputedStyle(document.getElementById('btnEpNext')).display);
  await page.click('#btnEpNext');
  check(await waitVisible(page, 'hub'), '開始下一周目：回到機庫');
  const cy = await page.evaluate(() => {
    const st = window.__game.save.story;
    return {
      cycle: st.cycle,
      done: Object.keys(st.done).length,
      choices: Object.keys(st.choices).length,
      hist: (st.history || []).length,
      label: document.getElementById('hubChapter').textContent,
    };
  });
  check(
    ep2 !== 'none' &&
      cy.cycle === 2 &&
      cy.done === 0 &&
      cy.choices === 0 &&
      cy.hist === 1 &&
      cy.label.includes('第 2 周目'),
    '第 2 周目：委託與抉擇重來、上一周目的紀錄保留（' + JSON.stringify(cy) + '）',
  );
  await ctx.close();
}

// 主線第 4 期：戰術模組（三選一、效果、升級、雙重模組、商店、紀錄點還原、放棄退回、整章完成清空）
async function testModules(browser, base) {
  console.log('主線的戰術模組：三選一、效果、升級、雙重模組、商店、還原與清空');
  const { ctx, page } = await newPage(browser, 'mods');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 三選一：暫停、三張卡片、選了寫進存檔
  await page.evaluate(() => {
    const g = window.__game;
    g.campBegin('c1s1');
    g.camp.types[0] = 'battle';
    g.campEnterSeg();
    g.campOpenPick('castron');
  });
  const pk = await page.evaluate(() => ({
    st: window.__game.state,
    on: document.getElementById('modPick').classList.contains('on'),
    n: document.querySelectorAll('#mpCards .mpCard').length,
  }));
  check(pk.st === 'modpick' && pk.on && pk.n === 3, '模組三選一：暫停並顯示三張卡片');
  await page.screenshot({ path: path.join(SHOT_DIR, 'campaign-modpick.png') });
  await page.click('#mpCards .mpCard button');
  const got = await page.evaluate(() => ({
    st: window.__game.state,
    list: window.__game.save.story.mods.list.map((m) => m.id + ':' + m.lv),
  }));
  check(
    got.st === 'play' && got.list.length === 1,
    '選擇後寫進存檔並回到遊戲（' + got.list.join('、') + '）',
  );
  // 效果：AP、擊破回復、空中跳次數（從下一個區段生效）
  const fx = await page.evaluate(() => {
    const g = window.__game;
    const base = { hp: g.player.maxHp, air: g.player.stats.parts.legs.airN };
    g.campSetMods([
      { id: 's_ap', lv: 2 },
      { id: 's_heal', lv: 1 },
      { id: 'v_air', lv: 1 },
    ]);
    g.campEnterSeg();
    const p = g.player;
    const after = { hp: p.maxHp, air: p.stats.parts.legs.airN };
    p.hp = p.maxHp * 0.5;
    const h0 = p.hp;
    const e = g.enemies.find((x) => !x.dead);
    e.takeDamage(1e9, 0, p, e.center(), new THREE.Vector3(0, 0, 1));
    return { base, after, heal: p.hp - h0, max: p.maxHp };
  });
  check(fx.after.hp > fx.base.hp, 'AP 模組：最大 AP 增加（' + fx.base.hp + ' → ' + fx.after.hp + '）');
  check(
    fx.after.air === fx.base.air + 1,
    '空中機動：空中跳次數 +1（' + fx.base.air + ' → ' + fx.after.air + '）',
  );
  check(fx.heal > fx.max * 0.02, '回收迴路：擊破敵人時回復 AP（+' + Math.round(fx.heal) + '）');
  // 升級：已持有的模組在選項裡以下一級出現；雙重模組在持有兩家時出現
  const up = await page.evaluate(() => {
    const g = window.__game;
    g.autoPickMod = false;
    let lv2 = false,
      duo = false;
    for (let i = 0; i < 30; i++) {
      g.campOpenPick('sancta');
      if (g.modOpts.some((o) => o.id === 's_ap' && o.lv === 3)) lv2 = true;
      if (g.modOpts.some((o) => o.id.startsWith('d_'))) duo = true;
      g.campClosePick();
    }
    return { lv2, duo };
  });
  check(up.lv2, '已持有的模組以下一級出現在選項（升級）');
  check(up.duo, '持有兩家委託方的模組時出現雙重模組');
  // 紀錄點：之後拿到的模組在重試時還原
  const ck = await page.evaluate(() => {
    const g = window.__game;
    g.campCheckpoint();
    const n0 = g.campMods().length;
    g.campTakeMod({ id: 'c_power', lv: 1 });
    const n1 = g.campMods().length;
    g.campRestore();
    return { n0, n1, n2: g.campMods().length };
  });
  check(
    ck.n1 === ck.n0 + 1 && ck.n2 === ck.n0,
    '從紀錄點重試：之後拿到的模組不算（' + ck.n0 + ' → ' + ck.n1 + ' → ' + ck.n2 + '）',
  );
  // 商店：補給台用完後出現，用 COAM 購買
  await page.evaluate(() => {
    const g = window.__game;
    g.save.coam = 1e6;
    g.camp.seg = 2;
    g.camp.types[2] = 'supply';
    g.campEnterSeg();
    const ss = g.camp.ss;
    for (let i = 0; i < 40 && !ss.pad.used; i++) {
      g.player.pos.set(ss.pad.pos.x, ss.pad.pos.y, ss.pad.pos.z);
      g.campTick(0.05);
    }
  });
  const shop = await page
    .waitForFunction(() => window.__game.state === 'modpick', null, { timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  check(shop && (await page.textContent('#mpTitle')) === '補給站的商店', '補給台用完後打開商店');
  const buy = await page.evaluate(() => {
    const g = window.__game;
    const c0 = g.save.coam,
      n0 = g.campMods().length;
    document.querySelector('#mpCards .mpCard button').click();
    return { paid: c0 - g.save.coam, n: g.campMods().length - n0, st: g.state };
  });
  check(buy.paid > 0 && buy.st === 'play', '商店：花 ' + buy.paid.toLocaleString() + ' COAM 購買模組');
  // 放棄出擊：退回出擊開始時（空）；整章完成：清空
  const end = await page.evaluate(() => {
    const g = window.__game;
    g.campEnd(false, true);
    const ab = g.campMods().length;
    g.campBegin('c1s1');
    g.campSetMods([{ id: 'c_power', lv: 1 }]);
    const st = g.campStory();
    st.done.c1s2 = 1;
    st.done.c1s1 = 1;
    const reset = g.campChapterCheck(1);
    return { ab, reset, after: g.campMods().length };
  });
  check(end.ab === 0, '放棄出擊：模組退回出擊開始時的狀態');
  check(end.reset && end.after === 0, '第 1 章的委託全部完成：模組清空');
  await ctx.close();
}

// 第三批 Boss（game/bosses2.js、entities/mech-boss2.js）與出場等級：同樣以固定 dt 同步模擬
async function testBosses2(browser, base) {
  console.log(
    '第三批 Boss：複製 AC、高速突擊機、電磁砲台、浮游砲、熔爐、推土要塞、迷彩機、衛星砲、三機合體、武裝列車、脈衝刃翼',
  );
  const { ctx, page } = await newPage(browser, 'boss2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const run = (L, key) =>
    page.evaluate(
      ([L, key]) => {
        const g = window.__game;
        g.save.level = L;
        g.startMission();
        g.state = 'boss-test';
        const pl = g.player;
        Object.assign(pl, { hp: 1e7, maxHp: 1e7, acsMax: 1e9 });
        const boss = g.boss;
        const s = boss.aiState;
        const dt = 1 / 60;
        const step = (sec, each) => {
          for (let i = 0; i < Math.round(sec / dt); i++) {
            g.time += dt;
            pl.move(dt, new THREE.Vector3(), false, false, false, null);
            for (const e of g.enemies) if (!e.dead) e.updateAI(dt);
            g.separateMechs(dt);
            for (let k = g.projectiles.length - 1; k >= 0; k--) {
              g.projectiles[k].update(dt);
              if (g.projectiles[k].dead) g.projectiles.splice(k, 1);
            }
            g.updateShocks(dt);
            g.updateSupport(dt);
            g.updateHazards(dt);
            if (each) each();
          }
        };
        const hit = (wid, e = boss) => {
          const h = e.hp;
          e.iFrames = 0;
          e.takeDamage(1000, 0, pl, e.center(), null, undefined, wid);
          return Math.round(h - e.hp);
        };
        const kill = (list) => list.forEach((e) => e.takeDamage(1e9, 0, pl, e.center()));
        const lost = () => Math.round(1e7 - pl.hp);
        const heal = () => (pl.hp = 1e7);
        const place = (x, z) => pl.pos.set(x, g.world.groundAt(x, z, 99), z);
        const near = (dist) => {
          const x = boss.pos.x + (boss.pos.x > 0 ? -dist : dist);
          place(x, boss.pos.z);
        };
        const r = { name: boss.name };
        if (key === 'doppel') {
          r.copy = JSON.stringify(boss.asm) === JSON.stringify(pl.asm);
          r.a = hit('w_rifle');
          for (let i = 0; i < 40; i++) hit('w_rifle');
          r.b = hit('w_rifle');
          r.c = hit('w_lr');
          step(0.1);
          r.glow = boss.bossVis & 7;
        } else if (key === 'viper') {
          place(0, 0);
          const seen = new Set();
          step(30, () => seen.add(s.vm));
          r.states = [...seen].join(',');
          r.lost = lost();
          s.vm = 'loiter';
          r.a = hit();
          s.vm = 'turn';
          r.b = hit();
          s.vm = 'run';
          boss.staggerT = 1;
          step(0.05);
          r.stall = s.vm;
        } else if (key === 'halberd') {
          r.corner = Math.abs(boss.pos.x) > 30 && Math.abs(boss.pos.z) > 30;
          near(35);
          r.a = hit();
          const los = g.losClear;
          g.losClear = () => false; // 擋住射線：充能中斷
          s.rg = 'idle';
          s.rgT = 0;
          step(1.2);
          r.cancel = s.rg;
          g.losClear = () => true;
          s.rg = 'idle';
          s.rgT = 0;
          let fired = 0;
          const ba = g.beamAttack;
          g.beamAttack = function (...a) {
            fired++;
            return ba.apply(this, a);
          };
          step(3.2);
          g.beamAttack = ba;
          g.losClear = los;
          r.fired = fired;
          r.vent = s.rg;
          r.b = hit();
        } else if (key === 'seraphim') {
          near(20);
          step(2.5);
          r.bits = boss.partsOf('bit').length;
          step(5);
          r.lost = lost();
          r.a = hit();
          s.fm = 'recall';
          s.fmT = 3;
          step(0.05);
          r.b = hit();
          boss.partsOf('bit').forEach((b) => (b.staggerT = 1));
          step(0.1);
          r.left = boss.partsOf('bit').length;
        } else if (key === 'cinder') {
          near(18);
          s.fcT = 0;
          s.act = null;
          const pick = Math.random;
          Math.random = () => 0.1; // 熔渣
          step(0.05);
          Math.random = pick;
          r.act = s.act;
          r.open = hit();
          step(4.5);
          r.pools = (g.hzPools || []).length;
          heal();
          // 站在燃燒的地面上
          g.addPool(boss, pl.pos.clone(), 4, 5, 400);
          step(1);
          r.burn = lost();
          s.act = null;
          s.mouthT = 0;
          s.fcT = 99;
          step(0.05);
          r.closed = hit();
        } else if (key === 'behemoth') {
          // 路線上剛好有障礙物時會先撞上：換個位置再試
          for (let k = 0; k < 4 && !r.lost; k++) {
            heal();
            s.rm = 'walk';
            boss.staggerT = 0;
            boss.pos.set(k * 9 - 12, g.world.groundAt(k * 9 - 12, k * 7 - 10, 99), k * 7 - 10);
            near(25);
            const dir = pl.pos.clone().sub(boss.pos).setY(0).normalize();
            boss.yaw = Math.atan2(-dir.x, -dir.z);
            boss.rampartAim(dir);
            step(1.6);
            r.charge = s.rm;
            step(2.5);
            r.lost = lost();
          }
          // 撞上場地邊界 → 硬直、背後弱點
          const ex = g.world.lim - 16; // 撞牆點與正前方的測試位置都要在邊緣懸崖之內
          boss.pos.set(ex, g.world.groundAt(ex, 0, 99), 0);
          boss.rampartAim(new THREE.Vector3(1, 0, 0));
          step(2.4);
          r.stun = s.rm;
          boss.yaw = boss.aimYaw = -Math.PI / 2; // 面向 +X
          place(boss.pos.x - 15, boss.pos.z); // 背後（boss 面向 +X）
          r.rear = hit();
          place(boss.pos.x + 8, boss.pos.z);
          r.front = hit();
        } else if (key === 'mirage') {
          step(1);
          r.holos = boss.partsOf('holo').length;
          s.reveal = 0;
          s.selfRev = 0;
          step(0.1);
          r.cloak = !!(boss.bossVis & 1) && boss.noLock;
          hit();
          step(0.05);
          r.reveal = !(boss.bossVis & 1);
          boss.staggerT = 1;
          step(0.1);
          r.after = boss.partsOf('holo').length;
        } else if (key === 'judgement') {
          near(20);
          r.a = hit();
          s.om = 'idle';
          s.omT = 0;
          s.n = 0;
          step(6);
          r.track = s.om;
          r.lost = lost();
          s.om = 'cool';
          s.omT = 3;
          step(0.05);
          r.b = hit();
          // 第二型態：格子砲擊
          boss.hp = boss.maxHp * 0.4;
          heal();
          s.om = 'idle';
          s.omT = 0;
          s.n = 1;
          step(8);
          r.grid = lost();
        } else if (key === 'cerberus') {
          near(20);
          boss.hp = boss.maxHp * 0.55;
          step(0.1);
          r.subs = boss.partsOf('sub').length;
          r.hidden = boss.noLock && !!(boss.bossVis & 1);
          r.sum = Math.round(boss.hp);
          // 時間到 → 合體並回復
          s.splitT = 0;
          step(2.6);
          r.merged = !s.split && !boss.dead;
          r.hpBack = Math.round((boss.hp / boss.maxHp) * 100);
          boss.hp = s.nextSplit - 1;
          step(0.1);
          r.again = boss.partsOf('sub').length;
          kill(boss.partsOf('sub'));
          step(0.1);
          r.dead = boss.dead;
        } else if (key === 'citadel') {
          r.rail = g.world.corridor && g.world.corridor.kind;
          r.cars = boss.partsOf().length;
          r.tunnel = hit();
          step(4);
          const c = g.world.corridor;
          r.onTrack = !!c && Math.abs(g.world.corridorU(boss.pos.x, boss.pos.z)) < 0.5 && !(boss.bossVis & 1); // 鐵路可能有彎道
          r.out = hit();
          // 站在軌道上、列車前方
          const p = g.world.corridorPoint(s.ts + 30);
          place(p.x, p.z);
          s.ramCd = 0;
          step(5);
          r.lost = lost();
        } else if (key === 'pulsar') {
          near(15);
          s.pa = 'pulse';
          s.paT = 0;
          s.done = false;
          step(3);
          r.lost = lost();
          heal();
          // QB 的無敵時間：能量環穿過去
          s.pa = 'pulse';
          s.paT = 0;
          s.done = false;
          s.overT = 0;
          step(3, () => (pl.iFrames = 1));
          r.dodge = lost();
          s.pa = null;
          s.overT = 0;
          s.cdT = 99;
          step(0.05);
          r.a = hit();
          s.overT = 2;
          step(0.05);
          r.b = hit();
        }
        if (!boss.dead) {
          if (boss.ai === 'train') boss.aiState.ts = 0; // 列車移出隧道
          boss.bossVis = 0;
          boss.iFrames = 0;
          boss.aiState.split = false;
          kill(boss.partsOf('sub'));
          step(0.05);
          if (!boss.dead) {
            boss.bossVis = 0;
            boss.takeDamage(1e10, 0, pl, boss.center());
          }
        }
        step(0.2);
        r.dead = boss.dead;
        r.left = boss.partsOf().length;
        g.clearMission();
        g.state = 'title';
        return r;
      },
      [L, key],
    );
  let r = await run(4, 'doppel');
  check(
    r.copy && r.b < r.a * 0.6 && r.c > r.b * 1.4 && r.glow === 1 && r.dead,
    `${r.name}：複製玩家組裝、實彈抗性 ${r.a}→${r.b}、換雷射 ${r.c}、裝甲發光`,
  );
  r = await run(7, 'viper');
  check(
    /run/.test(r.states) &&
      /turn/.test(r.states) &&
      r.lost > 0 &&
      r.b > r.a * 1.8 &&
      r.stall === 'stall' &&
      r.dead,
    `${r.name}：${r.states}、掃射命中 ${r.lost}、盤旋 ${r.a}／掉頭 ${r.b}、硬直時失速`,
  );
  r = await run(10, 'halberd');
  check(
    r.corner && r.cancel === 'idle' && r.fired > 0 && r.vent === 'vent' && r.b > r.a * 4 && r.dead,
    `${r.name}：在角落、擋住射線中斷充能、砲擊 ${r.fired} 發後散熱、裝甲 ${r.a}／散熱中 ${r.b}`,
  );
  r = await run(13, 'seraphim');
  check(
    r.bits >= 6 && r.lost > 0 && r.b > r.a * 1.8 && r.left === 0 && r.dead,
    `${r.name}：浮游砲 ${r.bits} 座、命中 ${r.lost}、平時 ${r.a}／回收充能 ${r.b}、EMP 打落`,
  );
  r = await run(16, 'cinder');
  check(
    r.act === 'slag' && r.pools > 0 && r.burn > 0 && r.open > r.closed * 3 && r.dead,
    `${r.name}：熔渣留下 ${r.pools} 處燃燒地面、站在上面受傷 ${r.burn}、爐口開 ${r.open}／關 ${r.closed}`,
  );
  r = await run(19, 'behemoth');
  check(
    r.charge === 'charge' && r.lost > 0 && r.stun === 'stun' && r.rear > r.front * 2 && r.dead,
    `${r.name}：衝撞命中 ${r.lost}（${r.charge}）、撞上邊界 ${r.stun}、背後 ${r.rear}／正面 ${r.front}`,
  );
  r = await run(22, 'mirage');
  check(
    r.holos === 3 && r.cloak && r.reveal && r.after === 0 && r.dead && r.left === 0,
    `${r.name}：分身 ${r.holos} 台、迷彩中不能鎖定、中彈現形、硬直時分身消失`,
  );
  r = await run(25, 'judgement');
  check(
    r.track === 'track' && r.lost > 0 && r.b > r.a * 4 && r.grid > 0 && r.dead,
    `${r.name}：追蹤光柱命中 ${r.lost}、平時 ${r.a}／冷卻 ${r.b}、格子砲擊命中 ${r.grid}`,
  );
  r = await run(28, 'cerberus');
  check(
    r.subs === 3 && r.hidden && r.merged && r.hpBack > 55 && r.again === 3 && r.dead,
    `${r.name}：分離 ${r.subs} 台（本體藏起來）、時間到合體回復到 ${r.hpBack}%、再分離後全滅即擊破`,
  );
  r = await run(31, 'citadel');
  check(
    r.rail === 'rail' &&
      r.cars === 4 &&
      r.tunnel === 0 &&
      r.onTrack &&
      r.out > 0 &&
      r.lost > 0 &&
      r.dead &&
      r.left === 0,
    `${r.name}：${r.rail} 地圖、車廂 ${r.cars} 節、隧道裡 ${r.tunnel}／出來 ${r.out}、沿軌道 ${r.onTrack}、撞到軌道上的目標 ${r.lost}、擊破 ${r.dead}／剩 ${r.left}`,
  );
  r = await run(34, 'pulsar');
  check(
    r.lost > 0 && r.dodge === 0 && r.b > r.a * 1.5 && r.dead,
    `${r.name}：能量環命中 ${r.lost}、無敵時間穿過 ${r.dodge}、平時 ${r.a}／過熱 ${r.b}`,
  );
  // 出場等級：3 起、除以 3 餘 2 以外（每 1～2 級一場）、新舊穿插
  const lv = await page.evaluate(() => {
    const g = window.__game;
    const out = [];
    for (const L of [1, 2, 3, 4, 5, 6, 7, 8]) {
      g.save.level = L;
      g.renderGarage();
      out.push(document.getElementById('mcTitle').textContent.includes('決戰') ? 'B' : '.');
    }
    return out.join('');
  });
  check(lv === '..BB.BB.', `Boss 關的等級（${lv}：任務 3、4、6、7…）`);
  // 失衡後保護（只給玩家）：硬直結束後 3.5 秒內持續受到衝擊也不會再次失衡（不會被連續硬直鎖死）；敵人沒有保護
  const sg = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 1;
    g.startMission();
    g.state = 'boss-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    const dt = 1 / 60;
    const step = (sec) => {
      for (let i = 0; i < Math.round(sec / dt); i++)
        pl.move(dt, new THREE.Vector3(), false, false, false, null);
    };
    const slam = () => pl.takeDamage(10, pl.acsMax * 2, null, pl.center());
    slam();
    const first = pl.staggerT > 0;
    step(pl.staggerT + 0.05);
    let chained = 0;
    for (let i = 0; i < 10; i++) {
      slam();
      if (pl.staggerT > 0) chained++;
      step(0.2);
    }
    const capped = pl.acs < pl.acsMax;
    step(2); // 保護 3.5 秒
    slam();
    const again = pl.staggerT > 0;
    // 敵人：硬直結束後馬上再重擊就會再次失衡
    const e = g.enemies.find((x) => !x.dead && !x.isBoss);
    e.hp = e.maxHp = 1e7;
    e.takeDamage(10, e.acsMax * 2, pl, e.center());
    for (let i = 0; i < 400 && e.staggerT > 0; i++)
      e.move(dt, new THREE.Vector3(), false, false, false, null);
    e.takeDamage(10, e.acsMax * 2, pl, e.center());
    const foe = !(e.stagGuardT > 0) && e.staggerT > 0;
    g.clearMission();
    g.state = 'title';
    return { first, chained, capped, again, foe };
  });
  check(
    sg.first && sg.chained === 0 && sg.capped && sg.again && sg.foe,
    `失衡後保護：玩家硬直結束後持續重擊不會再失衡（${sg.chained}）、保護結束後才會（${sg.again}）；敵人沒有保護（${sg.foe}）`,
  );
  await ctx.close();
}

// 多人的第三批 Boss：房主出擊到該 Boss 關，客機看到的顯示狀態（快照的 bossVis／bx、隱藏、不能鎖定、附屬機體）。
// 同一個 context 的兩個分頁裡房主在背景會被節流，所以房主的 requestAnimationFrame 換成空函式，由這裡推進主迴圈；
// 客機在前景照常執行，以計時器每 100 ms 記錄看到的狀態。
// only：只跑這幾隻 Boss（分段平行時各隻可以分到不同段）
async function testMpBosses(browser, url, only = null) {
  const cases = [
    { L: 10, key: 'halberd', name: '電磁砲台的瞄準線' },
    { L: 31, key: 'citadel', name: '武裝列車出隧道' },
    { L: 22, key: 'mirage', name: '迷彩機與分身' },
    { L: 28, key: 'cerberus', name: '三機合體分離' },
  ].filter((c) => !only || only.includes(c.key));
  console.log('多人 Boss：客機顯示' + cases.map((c) => c.name).join('、'));
  for (const { L, key } of cases) {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
    const host = await ctx.newPage();
    const cli = await ctx.newPage();
    watch(host, `mpboss-${key}:host`);
    watch(cli, `mpboss-${key}:client`);
    await host.goto(url);
    await cli.goto(url);
    await host.click('#btnMP');
    await setNick(host, 'HOST');
    await host.click('#btnMPHost');
    await waitVisible(host, 'lobby');
    await host.check('#mpAuto');
    await host.dispatchEvent('#mpAuto', 'change');
    await cli.click('#btnMP');
    await setNick(cli, 'CLIENT');
    await wait(1000);
    await cli.click('#btnMPList');
    await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
    await cli.click('#mpRooms .part');
    await waitVisible(cli, 'lobby', 15000);
    await host.evaluate((L) => (window.__game.save.level = L), L);
    await cli.click('#btnLobbyReady');
    await wait(500);
    await host.click('#btnLobbyReady');
    await wait(500);
    await host.click('#btnLobbySortie');
    const ok = (await waitVisible(host, 'hudWrap', 20000)) && (await waitVisible(cli, 'hudWrap', 20000));
    await host.evaluate((key) => {
      window.requestAnimationFrame = () => 0;
      const g = window.__game;
      const b = g.boss;
      for (const p of g.players) p.hp = p.maxHp = 1e6;
      if (key === 'halberd') {
        // 玩家放在砲台旁邊的空地，馬上開始瞄準
        const x = b.pos.x + (b.pos.x > 0 ? -16 : 16);
        g.player.pos.set(x, g.world.groundAt(x, b.pos.z, 99), b.pos.z);
        b.aiState.rg = 'idle';
        b.aiState.rgT = 0;
        g.losClear = () => true;
      }
      if (key === 'cerberus') b.hp = b.maxHp * 0.5; // 分離
    }, key);
    await cli.evaluate(() => {
      const seen = (window.__mpSeen = {
        aim: 0,
        line: 0,
        hidden: 0,
        shown: 0,
        cars: 0,
        cloak: 0,
        holo: 0,
        split: 0,
        subs: 0,
      });
      setInterval(() => {
        const g = window.__game;
        const b = g && g.boss;
        if (!b || b.dead) return;
        if (b.bx && b.bx.length === 5) seen.aim++;
        if (b.sx && b.sx.aimLine && b.sx.aimLine.visible) seen.line++;
        if (b.bossVis & 1 && !b.mesh.visible) seen.hidden++;
        if (!(b.bossVis & 1) && b.mesh.visible) seen.shown++;
        seen.cars = Math.max(seen.cars, g.enemies.filter((e) => /^car_/.test(e.opts.partKind || '')).length);
        if (b.bossVis & 1 && b.noLock && b.cloakA < 0.5) seen.cloak++;
        seen.holo = Math.max(seen.holo, g.enemies.filter((e) => !e.dead && e.ai === 'holo').length);
        if (b.bossVis & 1 && b.noLock && !b.mesh.visible) seen.split++;
        seen.subs = Math.max(seen.subs, g.enemies.filter((e) => !e.dead && e.opts.partKind === 'sub').length);
      }, 100);
    });
    // 推進房主的主迴圈至少 160 格；遊戲時間跟著實際經過的時間走，顯示卡算繪時 160 格只有幾秒
    // （SwiftShader 約 1 分鐘），列車可能還沒開進隧道：還沒看到要檢查的現象時繼續推進，最多 60 秒
    const seenAll = (r) =>
      key === 'halberd'
        ? r.aim > 0 && r.line > 0
        : key === 'citadel'
          ? r.cars === 4 && r.hidden > 0 && r.shown > 0
          : key === 'mirage'
            ? r.cloak > 0 && r.holo === 3
            : r.split > 0 && r.subs === 3;
    const tLoop = Date.now();
    for (let i = 0; ; i++) {
      await host.evaluate(() => window.__game.loop());
      await wait(15);
      if (i < 160 || i % 20) continue;
      if (Date.now() - tLoop > 60000 || seenAll(await cli.evaluate(() => window.__mpSeen))) break;
    }
    const r = await cli.evaluate(() => window.__mpSeen);
    await cli.screenshot({ path: path.join(SHOT_DIR, `mp-boss-${key}-client.png`) });
    if (key === 'halberd')
      check(ok && r.aim > 0 && r.line > 0, `多人：客機看到電磁砲台的瞄準線（${r.aim}／${r.line}）`);
    else if (key === 'citadel')
      check(
        ok && r.cars === 4 && r.hidden > 0 && r.shown > 0,
        `多人：客機的武裝列車有 ${r.cars} 節車廂、在隧道裡隱藏（${r.hidden}）、開出後顯示（${r.shown}）`,
      );
    else if (key === 'mirage')
      check(
        ok && r.cloak > 0 && r.holo === 3,
        `多人：客機的迷彩機半透明且不能鎖定（${r.cloak}）、分身 ${r.holo} 台`,
      );
    else
      check(
        ok && r.split > 0 && r.subs === 3,
        `多人：客機的三機合體分離時本體隱藏（${r.split}）、分離機體 ${r.subs} 台`,
      );
    await ctx.close();
  }
}

// 主線第 5 期：多人合作推主線（房主的進度、出口投票、轉場等待與整備、各自三選一、紀錄點同步、全滅失敗、房主遷移）
async function testMpCampaign(browser, url) {
  console.log('多人主線：出擊、出口投票、轉場整備、各自選模組、紀錄點同步、失敗、房主遷移');
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  const host = await ctx.newPage();
  const cli = await ctx.newPage();
  watch(host, 'mpcamp:host');
  watch(cli, 'mpcamp:client');
  await host.goto(url);
  await cli.goto(url);
  await host.click('#btnMP');
  await setNick(host, 'HOST');
  await host.click('#btnMPHost');
  await waitVisible(host, 'lobby');
  await host.check('#mpAuto');
  await host.dispatchEvent('#mpAuto', 'change');
  await cli.click('#btnMP');
  await setNick(cli, 'CLIENT');
  await wait(1000);
  await cli.click('#btnMPList');
  await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
  await cli.click('#mpRooms .part');
  await waitVisible(cli, 'lobby', 15000);
  // 房間模式：主線合作
  await host.selectOption('#pvMode', 'story');
  await wait(500);
  check(
    (await host.$('#pvSid')) !== null && /主線/.test((await cli.textContent('#lobbyMode')) || ''),
    '大廳的「主線合作」模式（房主選委託，客機看得到）',
  );
  for (const p of [host, cli]) await p.evaluate(() => (window.__game.autoPickMod = true));
  // 完整測試的負載很重時房主分頁偶爾卡住超過 3 秒：放寬客機判定房主失聯的時間（遷移那一步另外測）
  await cli.evaluate(() => (window.__game.hostLostMs = 15000));
  await cli.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbySortie');
  // 房主分頁在背景會被節流：停用它自己的 requestAnimationFrame，測試期間另開一條迴圈持續推進房主的主迴圈
  await cli.bringToFront();
  await host.evaluate(() => (window.requestAnimationFrame = () => 0));
  let pumping = true;
  const pumpLoop = (async () => {
    while (pumping) {
      await host.evaluate(() => window.__game.loop()).catch(() => {});
      await wait(20);
    }
  })();
  const pump = async (n, f) => {
    for (let i = 0; i < n; i++) {
      if (f && (await f())) return true;
      await wait(30);
    }
    return false;
  };
  const started = (await waitVisible(host, 'hudWrap', 25000)) && (await waitVisible(cli, 'hudWrap', 25000));
  check(started, '主線合作：空降後雙方進入區段 1');
  await pump(40);
  const v0 = await cli.evaluate(() => ({
    view: !!(window.__game.campC && window.__game.campC.view),
    top: document.getElementById('hudTop').textContent,
    ck: !!window.__game.campCk,
  }));
  check(v0.view && v0.top.includes('主線') && v0.ck, '客機：HUD 顯示主線資訊、收到紀錄點');
  // 清除區段 → 客機看到出口
  await host.evaluate(() => {
    const g = window.__game;
    for (const p of g.players) p.hp = p.maxHp = 1e7;
    g.waves = [];
    g.wavePend = null; // 已預告、還沒出現的增援也取消
    for (const e of g.enemies)
      if (!e.dead) {
        if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
        e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
      }
  });
  // 等出口出現（期間持續清掉運輸機投放的增援）
  await pump(300, () =>
    host.evaluate(() => {
      const g = window.__game;
      g.waves = [];
      g.wavePend = null; // 已預告、還沒出現的增援也取消
      for (const e of g.enemies)
        if (!e.dead) {
          if (e.ai === 'burrow') e.bossVis = 0;
          e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
        }
      return g.camp.exits.length >= 2;
    }),
  );
  const cliEx = await (async () => {
    for (let i = 0; i < 200; i++) {
      const n = await cli.evaluate(() => {
        const C = window.__game.campC;
        return C && C.vis ? C.vis.exits.length : 0;
      });
      if (n >= 2) return n;
      await wait(30);
    }
    return 0;
  })();
  check(cliEx >= 2, '客機看到出口的光環（' + cliEx + ' 個）');
  // 投票：一人站進出口開始倒數（房主的主迴圈由上面的 pumpLoop 依實際時間推進，出口可能在還沒擴大完的作戰區域外、
  // 機體會被推回，所以每次檢查前都把房主放回出口，並在同一個 evaluate 裡讀投票的提示）
  let vote = false;
  await pump(60, async () => {
    vote = await host.evaluate(() => {
      const g = window.__game,
        c = g.camp,
        e = c.exits[0];
      const v = !!c.vote && c.hint;
      g.player.pos.set(e.pos.x, e.pos.y, e.pos.z);
      g.player.vel.set(0, 0, 0);
      return v;
    });
    return !!vote;
  });
  check(!!vote && vote.includes('投票'), '有人站進出口：開始投票倒數（' + vote + '）');
  // 全員站同一個出口：立刻出發，雙方都進入轉場
  await host.evaluate(() => {
    const g = window.__game,
      e = g.camp.exits[0];
    for (const p of g.players) {
      p.pos.set(e.pos.x, e.pos.y, e.pos.z);
      p.vel.set(0, 0, 0);
    }
  });
  await pump(150, () =>
    host.evaluate(() => {
      const g = window.__game;
      if (g.state === 'camptrans') return true;
      const e = g.camp && g.camp.exits[0];
      if (e)
        for (const p of g.players) {
          p.pos.set(e.pos.x, e.pos.y, e.pos.z);
          p.vel.set(0, 0, 0);
        }
      return false;
    }),
  );
  check(
    (await waitVisible(host, 'campTrans', 8000)) && (await waitVisible(cli, 'campTrans', 8000)),
    '全員站同一個出口：雙方進入轉場',
  );
  // 客機進車庫整備 → 繼續作戰；房主直接出擊 → 開始下一段
  await cli.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await cli.click('#btnCampGarage');
  check(
    (await waitVisible(cli, 'garage', 8000)) &&
      (await cli.evaluate(() => getComputedStyle(document.getElementById('gCamp')).display !== 'none')),
    '客機：轉場時進車庫整備（整備面板）',
  );
  await host.waitForFunction(() => document.getElementById('ctBtns').style.visibility === 'visible', null, {
    timeout: 8000,
  });
  await host.click('#btnCampGo');
  await wait(800);
  const waiting = await host.evaluate(() => document.getElementById('ctWait').textContent);
  check(/1／2/.test(waiting), '房主：等待隊友準備（' + waiting + '）');
  await cli.click('#btnCampGo2');
  const seg2 = (await waitVisible(host, 'hudWrap', 15000)) && (await waitVisible(cli, 'hudWrap', 15000));
  const s2 = await host.evaluate(() => window.__game.camp && window.__game.camp.seg);
  check(seg2 && s2 === 1, '全員準備後：雙方進入區段 2');
  // 各自三選一：客機選的模組記在房主存檔
  await host.evaluate(() => window.__game.campMpPick('castron'));
  await wait(1500);
  const mm = await host.evaluate(() => {
    const st = window.__game.save.story;
    return st.mpMods && st.mpMods.by && st.mpMods.by.CLIENT ? st.mpMods.by.CLIENT.length : 0;
  });
  check(mm === 1, '客機自己選的戰術模組記在房主存檔（以暱稱對應）');
  // 全滅 → 失敗畫面（客機沒有按鈕、等房主）
  await host.evaluate(() => {
    const g = window.__game;
    for (const p of g.players) {
      p.hp = 1;
      p.takeDamage(1e9, 0, null, p.center(), new THREE.Vector3(0, 0, 1));
      p.dead = true;
    }
  });
  await pump(20);
  const failed = (await waitVisible(host, 'campFail', 10000)) && (await waitVisible(cli, 'campFail', 10000));
  check(
    failed &&
      (await cli.evaluate(() => getComputedStyle(document.getElementById('ctBtns2')).display === 'none')),
    '全員倒下：雙方回到失敗畫面，客機等房主決定',
  );
  await host.click('#btnCampRetry');
  check(await waitVisible(cli, 'campTrans', 8000), '房主選「從紀錄點繼續」：客機也回到轉場');
  // 房主遷移：房主離線 → 客機從紀錄點接手
  pumping = false;
  await pumpLoop;
  await host.close();
  const mig = await cli
    .waitForFunction(() => window.__game.camp && window.__game.net.role === 'host', null, { timeout: 20000 })
    .then(
      () => true,
      () => false,
    );
  const st3 = await cli.evaluate(() => ({
    st: window.__game.state,
    seg: window.__game.camp && window.__game.camp.seg,
  }));
  check(mig && st3.st === 'camptrans' && st3.seg === 1, '房主離線：客機成為房主、從紀錄點（區段 2）接手');
  // 多人的終章：結果畫面之後房主與隊友都看結局，不能進下一周目，回大廳
  const epOf = () =>
    cli.evaluate(() => ({
      title: document.getElementById('epTitle').textContent,
      cyc: document.getElementById('epCycle').textContent,
      next: getComputedStyle(document.getElementById('btnEpNext')).display,
      back: document.getElementById('btnEpHub').textContent,
      endings: Object.keys(window.__game.save.story.endings || {}),
    }));
  await cli.evaluate(() => {
    const g = window.__game;
    g.camp.sid = 'c6s3';
    g.camp.choice = { id: 'c6', key: 'seal' };
    g.campEnd(true);
  });
  await waitVisible(cli, 'result');
  await cli.click('#btnResultOk');
  const epH = (await waitVisible(cli, 'epilogue')) && (await epOf());
  check(
    epH && epH.endings.includes('seal') && epH.next === 'none' && epH.back === '返回大廳',
    '多人終章（房主）：結果畫面之後顯示結局、沒有下一周目（' + JSON.stringify(epH) + '）',
  );
  await cli.click('#btnEpHub');
  const lob = await waitVisible(cli, 'lobby');
  await cli.evaluate(() =>
    window.__game.clientEnd({
      success: true,
      title: '主線出擊 完成',
      rank: 'A',
      bonus: 0,
      rows: [],
      ending: 'beyond',
      cycle: 3,
    }),
  );
  await cli.click('#btnResultOk');
  const epC = (await waitVisible(cli, 'epilogue')) && (await epOf());
  check(
    lob &&
      epC &&
      epC.title.includes('彼岸') &&
      epC.cyc.includes('第 3 周目') &&
      epC.endings.includes('beyond') &&
      epC.next === 'none',
    '多人終章（隊友）：房主的結局與周目、記進自己的存檔（' + JSON.stringify(epC) + '）',
  );
  await ctx.close();
}

async function testMultiplayer(browser, url, tag, migrate) {
  console.log(`多人（${tag}）：建房 → 加入 → 準備 → 出擊`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const host = await ctx.newPage();
  const cli = await ctx.newPage();
  watch(host, `${tag}:host`);
  watch(cli, `${tag}:client`);
  await host.goto(url);
  await cli.goto(url);
  await host.click('#btnMP');
  await setNick(host, 'HOST');
  await host.click('#btnMPHost');
  check(await waitVisible(host, 'lobby'), '房主進入大廳');
  await host.check('#mpAuto');
  await host.dispatchEvent('#mpAuto', 'change');
  await cli.click('#btnMP');
  await setNick(cli, 'CLIENT');
  await wait(1000);
  await cli.click('#btnMPList');
  await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
  await cli.click('#mpRooms .part');
  check(await waitVisible(cli, 'lobby', 15000), '客機進入大廳');
  await cli.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbySortie');
  check(await waitVisible(host, 'hudWrap', 15000), '房主出擊');
  check(await waitVisible(cli, 'hudWrap', 15000), '客機出擊');
  await Promise.all([playFor(host, 5000), playFor(cli, 5000)]);
  const [hHp, cHp] = [await host.textContent('#hpTxt'), await cli.textContent('#hpTxt')];
  check(
    /\d/.test(hHp || '') && /\d/.test(cHp || ''),
    `雙方 HP 顯示（${(hHp || '').trim()} / ${(cHp || '').trim()}）`,
  );
  await host.screenshot({ path: path.join(SHOT_DIR, `mp-${tag}-host.png`) });
  await cli.screenshot({ path: path.join(SHOT_DIR, `mp-${tag}-client.png`) });
  if (migrate) {
    await host.close();
    await wait(6000);
    check(await visible(cli, 'hudWrap'), '房主離線後客機仍在遊戲中（房主遷移）');
    await cli.screenshot({ path: path.join(SHOT_DIR, `mp-${tag}-migrated.png`) });
  }
  await ctx.close();
}

// 自訂關卡與關卡編輯器（game/levels.js、editor*.js、level-play.js）：選單、新建、擺放（物件／坡道／疊放）、
// 地形筆刷、復原重做、單位與巡邏、標記、區域、路徑、觸發器、存讀、試玩與通關紀錄、觸發器執行、多段、沒有獎勵
async function testLevels(browser, base) {
  console.log('自訂關卡：選單、編輯器（擺放、地形、復原、單位、觸發器）、存讀、試玩、觸發器、多段、獎勵');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'levels');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.click('#btnLevels');
  check(await waitVisible(page, 'levels'), '標題「自訂關卡」開啟關卡選單');
  // 新建：挑底圖（全畫面預覽）——種子上一個／下一個、歷史縮圖、並排比較，最後選空白底圖
  await page.click('#btnLvNew');
  await page.waitForFunction(() => window.__game.state === 'editor' && window.__game.ed.pick, null, {
    timeout: 30000,
  });
  const idle = () =>
    page.waitForFunction(
      () => window.__game.ed.pick && !window.__game.ed.pick.busy && !(window.__game.ed.pick.t > 0),
      null,
      {
        timeout: 30000,
      },
    );
  await page.selectOption('#epTheme', 'wasteland');
  await page.selectOption('#epBase', 'gen');
  await wait(400);
  await idle();
  const pk1 = await page.evaluate(() => {
    const g = window.__game;
    return {
      seed: g.ed.L.base.seed,
      theme: g.world.themeKey,
      hist: g.ed.pick.hist.length,
      info: document.getElementById('epInfo').textContent,
    };
  });
  await page.click('#epNext');
  await wait(200);
  await idle();
  const pk2 = await page.evaluate(() => ({
    seed: window.__game.ed.L.base.seed,
    hist: window.__game.ed.pick.hist.length,
  }));
  check(
    pk1.theme === 'wasteland' &&
      /荒涼工業荒野/.test(pk1.info) &&
      pk2.seed === pk1.seed + 1 &&
      pk2.hist === pk1.hist + 1,
    `挑底圖：改主題與底圖就重新產生、「下一個」種子 +1、歷史縮圖 ${pk2.hist} 張`,
  );
  await page.click('#epHist [data-eh="1"]');
  await idle();
  check((await page.evaluate(() => window.__game.ed.L.base.seed)) === pk1.seed, '點歷史的縮圖回到那張地圖');
  await page.click('#epGrid');
  await page.waitForFunction(() => document.querySelectorAll('#edPickGrid .epCell img').length === 6, null, {
    timeout: 120000,
  });
  const gs = await page.evaluate(() => window.__game.ed.pick.grid[2].seed);
  await page.screenshot({ path: path.join(SHOT_DIR, 'level-pick-grid.png') });
  await page.click('#edPickGrid [data-eg="2"]');
  await page.waitForFunction((s) => window.__game.ed.L.base.seed === s && !window.__game.ed.pick.busy, gs, {
    timeout: 30000,
  });
  check(true, '並排比較 6 張俯視縮圖，點一張改用那個種子');
  await page.screenshot({ path: path.join(SHOT_DIR, 'level-pick.png') });
  await page.selectOption('#epTheme', 'industrial');
  await page.selectOption('#epBase', 'blank');
  await page.fill('#epName', '測試關卡');
  await page.fill('#epLevel', '3');
  await page.click('#epGo');
  await page.waitForFunction(
    () => window.__game.state === 'editor' && !window.__game.ed.pick && window.__game.ed.L.base.blank,
    null,
    {
      timeout: 30000,
    },
  );
  const e0 = await page.evaluate(() => {
    const g = window.__game;
    return {
      n: g.ed.L.terrain.n,
      name: g.ed.L.name,
      lv: g.ed.L.base.level,
      spawn: g.ed.L.marks.filter((m) => m.k === 'spawn').length,
    };
  });
  check(
    e0.n > 1000 && e0.name === '測試關卡' && e0.lv === 3 && e0.spawn === 1,
    `新建關卡：高度圖 ${e0.n} 點、名稱與等級、預設一個出生點`,
  );
  // 滑鼠：物件工具選方塊，點畫面中央放置
  await page.click('[data-tool="prop"]');
  await page.click('[data-pp="ed/block"]');
  await page.mouse.click(800, 520);
  await wait(300);
  const p1 = await page.evaluate(() => {
    const g = window.__game,
      w = g.world;
    const r = w.lvProps[0];
    return {
      n: g.ed.L.props.length,
      ob: r && r.obs.length,
      top: r && r.obs[0] && +r.obs[0].top.toFixed(1),
      sel: g.ed.sel && g.ed.sel.t,
    };
  });
  check(
    p1.n === 1 && p1.ob === 1 && p1.top === 4 && p1.sel === 'prop',
    `滑鼠點地面放方塊：碰撞頂面 ${p1.top} m、自動選取`,
  );
  // 程式：坡道、疊在方塊上的貨櫃、復原／重做
  const p2 = await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      ed = g.ed;
    const b = ed.L.props[0];
    ed.place = 'ed/ramp';
    g.edPlaceProp({ x: b.x + 11, y: 0, z: b.z, terrain: true });
    ed.place = 'prop/container';
    g.edPlaceProp({ x: b.x, y: 4, z: b.z, terrain: false });
    const ramp = (w.ramps || []).find((r) => r.lvl);
    const box = w.lvProps[2];
    const out = {
      n: ed.L.props.length,
      ramp: !!ramp && +ramp.y1.toFixed(1),
      stack: box && +box.obs[0].y.toFixed(1),
      ground: +w.groundAt(b.x, b.z, 10).toFixed(1),
    };
    g.edUndo(false);
    out.undo = ed.L.props.length + '/' + w.lvProps.length;
    g.edUndo(true);
    out.redo = ed.L.props.length + '/' + w.lvProps.length;
    return out;
  });
  check(
    p2.ramp === 5 && p2.stack === 4 && p2.n === 3,
    `坡道（高 ${p2.ramp} m）、貨櫃疊在方塊頂面（底 ${p2.stack} m）`,
  );
  check(p2.undo === '2/2' && p2.redo === '3/3', `復原／重做（${p2.undo} → ${p2.redo}）`);
  // 地形筆刷：抬高 → 高度變了、寫回關卡；復原
  const t1 = await page.evaluate(() => {
    const g = window.__game,
      w = g.world,
      ed = g.ed;
    const h0 = w.terrainHeight(-40, -40);
    const s0 = ed.L.terrain.h;
    ed.tool = 'terrain';
    ed.brush = { k: 'raise', r: 10, s: 2 };
    g.edStrokeStart({ x: -40, y: h0, z: -40 });
    for (let i = 0; i < 30; i++) g.edBrushStep(0.05);
    g.edStrokeEnd();
    const h1 = w.terrainHeight(-40, -40);
    const changed = ed.L.terrain.h !== s0;
    g.edUndo(false);
    const h2 = w.terrainHeight(-40, -40);
    g.edUndo(true);
    return { h0, h1, h2, changed };
  });
  check(
    t1.h1 > t1.h0 + 3 && t1.changed && Math.abs(t1.h2 - t1.h0) < 0.05,
    `地形筆刷抬高 ${(t1.h1 - t1.h0).toFixed(1)} m、寫回關卡、復原`,
  );
  // 單位、標記、路徑、區域、群組、觸發器（程式建立）＋屬性面板
  await page.evaluate(() => {
    const g = window.__game,
      ed = g.ed,
      L = ed.L;
    g.edNewGroup(); // g2：增援
    L.groups[1].name = '增援';
    ed.grp = 'g1';
    ed.unitKind = 'enemy';
    ed.unitType = 'mt';
    g.edPlaceUnit({ x: 30, y: 0, z: -30 }); // 巡邏
    g.edPlaceUnit({ x: -30, y: 0, z: 40 }); // 守住
    ed.grp = 'g2';
    g.edPlaceUnit({ x: 20, y: 0, z: 20 }); // 等觸發器
    g.edPlaceUnit({ x: 24, y: 0, z: 20 });
    L.units[0].beh = { k: 'patrol', path: 'p1', r: 20, m: '', back: false, speed: 0.8 };
    L.units[1].beh = { k: 'hold', path: '', r: 35, m: '', back: false, speed: 0.6 };
    L.units[2].at = L.units[3].at = 'trig';
    L.paths.push({
      id: 'p1',
      name: '巡邏線',
      pts: [
        [30, -30, 0],
        [60, -30, 0],
        [60, 0, 0],
      ],
      loop: false,
    });
    ed.markKind = 'exit';
    g.edPlaceMark({ x: -50, y: 0, z: -50 });
    L.areas.push({
      id: 'a1',
      name: '觸發區',
      sh: 'circle',
      x: 0,
      z: 30,
      w: 10,
      d: 10,
      r: 6,
      yaw: 0,
      show: true,
      color: 0x5cc8ff,
    });
    L.counters.push({ id: 'c1', name: '進度', v: 0 });
    L.triggers.push(
      {
        id: 't1',
        name: '開場',
        on: true,
        once: true,
        any: false,
        ev: { k: 'start' },
        cond: [],
        act: [{ k: 'obj', text: '前往觸發區' }],
      },
      {
        id: 't2',
        name: '進區域',
        on: true,
        once: true,
        any: false,
        ev: { k: 'enter', a: 'a1', who: 'any' },
        cond: [],
        act: [
          { k: 'spawn', g: 'g2', how: 'place', m: '', warn: '0' },
          { k: 'add', c: 'c1', v: 1 },
          { k: 'comm', who: 'custom', name: '測試員', text: '增援來了' },
          { k: 'count', t: 300, text: '撤離' },
        ],
      },
      {
        id: 't3',
        name: '全滅',
        on: true,
        once: true,
        any: false,
        ev: { k: 'gdead', g: 'g2' },
        cond: [{ k: 'counter', c: 'c1', op: '=', v: 1 }],
        act: [
          { k: 'open', m: '' },
          { k: 'obj', text: '走進出口' },
        ],
      },
    );
    g.edChanged();
    g.edRebuildHelpers();
    g.edSelect({ t: 'unit', i: 0 });
  });
  const insp = await page.evaluate(() => document.getElementById('edRight').textContent);
  check(/行為/.test(insp) && /路徑/.test(insp), '選單位時右側顯示屬性（行為、巡邏路徑）');
  // 觸發器面板
  await page.click('[data-tool="trig"]');
  await page.click('[data-tx="expand"]');
  await wait(300);
  const tp = await page.evaluate(() => ({
    cards: document.querySelectorAll('#edTrig .trCard').length,
    acts: document.querySelectorAll('#edTrig .trItem').length,
  }));
  check(tp.cards === 3 && tp.acts >= 7, `觸發器面板：${tp.cards} 張卡片、${tp.acts} 個條件與動作`);
  // 在面板加一個動作（下拉選單）
  await page.selectOption('#edTrig [data-tr="0"] select[data-tx-add]', 'shake');
  const ta = await page.evaluate(() => window.__game.ed.L.triggers[0].act.map((a) => a.k).join(','));
  check(ta === 'obj,shake', `觸發器面板加入動作（${ta}）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'level-editor-trig.png') });
  await page.click('[data-tx="close"]');
  await page.screenshot({ path: path.join(SHOT_DIR, 'level-editor.png') });
  // 存檔 → 重新整理 → 從選單再開
  await page.click('[data-ea="save"]');
  await wait(800);
  const id = await page.evaluate(() => window.__game.ed.L.id);
  await page.reload();
  await waitVisible(page, 'title');
  await page.click('#btnLevels');
  await waitVisible(page, 'levels');
  await page.waitForSelector(`#lvList [data-a="edit"][data-id="${id}"]`, { timeout: 10000 });
  const thumb = await page.evaluate(() => !!document.querySelector('#lvList .lvThumb img'));
  await page.click(`#lvList [data-a="edit"][data-id="${id}"]`);
  await page.waitForFunction(() => window.__game.state === 'editor', null, { timeout: 30000 });
  const re = await page.evaluate(() => {
    const g = window.__game,
      L = g.ed.L;
    return {
      props: L.props.length,
      units: L.units.length,
      trig: L.triggers.length,
      h: +g.world.terrainHeight(-40, -40).toFixed(1),
      lp: g.world.lvProps.length,
    };
  });
  check(
    re.props === 3 && re.units === 4 && re.trig === 3 && re.h > 3 && re.lp === 3 && thumb,
    `存檔後重新整理再開：物件 ${re.props}、單位 ${re.units}、觸發器 ${re.trig}、地形高度 ${re.h} m、選單縮圖`,
  );
  // 上傳前要通關：選單的上傳按鈕（沒有伺服器時不顯示，這裡直接檢查 clear）
  check(await page.evaluate(() => !window.__game.ed.L.clear), '還沒通關：沒有通關紀錄');
  // 試玩：開場的目標文字、巡邏、守住、進區域生成增援、全滅開出口、走進出口通關
  const coam0 = await page.evaluate(() => window.__game.save.coam);
  await page.click('[data-ea="test"]');
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.lv, null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.hp = g.player.maxHp = 1e7;
    g.player.updateAI = () => {};
  });
  await wait(1500);
  const s1 = await page.evaluate(() => {
    const g = window.__game;
    const en = g.enemies.filter((e) => e.edu);
    return {
      obj: document.getElementById('hudTop').textContent,
      n: en.length,
      area: !!(g.lv.areaMesh && g.lv.areaMesh.a1),
      pat: en[0] && [+en[0].pos.x.toFixed(1), +en[0].pos.z.toFixed(1)],
      hold: en[1] && [+en[1].pos.x.toFixed(1), +en[1].pos.z.toFixed(1)],
    };
  });
  check(
    /前往觸發區/.test(s1.obj) && s1.n === 2 && s1.area,
    `試玩：開場的目標文字、開場的 ${s1.n} 個單位、顯示的區域圈`,
  );
  // 玩家遠離：巡邏的往路徑走、守住的不動
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(-60, g.world.groundAt(-60, 60, 99), 60);
  });
  await wait(3000);
  const s2 = await page.evaluate(() => {
    const g = window.__game;
    const en = g.enemies.filter((e) => e.edu);
    return {
      pat: [+en[0].pos.x.toFixed(1), +en[0].pos.z.toFixed(1)],
      hold: [+en[1].pos.x.toFixed(1), +en[1].pos.z.toFixed(1)],
    };
  });
  const moved = Math.hypot(s2.pat[0] - s1.pat[0], s2.pat[1] - s1.pat[1]);
  const held = Math.hypot(s2.hold[0] - s1.hold[0], s2.hold[1] - s1.hold[1]);
  check(
    moved > 2 && s2.pat[0] > s1.pat[0] && held < 0.5,
    `巡邏沿路徑移動 ${moved.toFixed(1)} m、守住不動（${held.toFixed(2)} m）`,
  );
  // 進觸發區：生成增援、計數器、通訊（自訂名字）、倒數
  await page.evaluate(() => {
    const g = window.__game;
    g.player.pos.set(0, g.world.groundAt(0, 30, 99), 30);
  });
  await page
    .waitForFunction(
      () => window.__game.enemies.filter((e) => e.edu && e.edu.g === 'g2').length === 2,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  const s3 = await page.evaluate(() => {
    const g = window.__game;
    return {
      n: g.enemies.filter((e) => e.edu && e.edu.g === 'g2').length,
      c: g.lv.st.cnt.c1,
      comm: document.getElementById('comm').textContent,
      timer: !!g.lv.st.timer,
    };
  });
  check(
    s3.n === 2 && s3.c === 1 && /測試員/.test(s3.comm) && s3.timer,
    `進區域：生成增援 ${s3.n} 台、計數器 ${s3.c}、通訊、倒數`,
  );
  // 增援全滅 → 開出口
  await page.evaluate(() => {
    const g = window.__game;
    for (const e of g.enemies)
      if (e.edu && e.edu.g === 'g2' && !e.dead)
        e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
  });
  await page
    .waitForFunction(
      () =>
        window.__game.lv && window.__game.lv.st.exits && Object.keys(window.__game.lv.st.exits).length > 0,
      null,
      { timeout: 8000 },
    )
    .catch(() => {});
  const s4 = await page.evaluate(() => ({
    exit: Object.keys(window.__game.lv.st.exits).length,
    obj: document.getElementById('hudTop').textContent,
    coam: window.__game.save.coam,
  }));
  check(s4.exit === 1 && /走進出口/.test(s4.obj), '群組全滅（條件：計數器＝1）→ 開出口、換目標文字');
  check(s4.coam === coam0, `擊破沒有獎金（COAM ${coam0.toLocaleString()} 不變）`);
  await page.screenshot({ path: path.join(SHOT_DIR, 'level-play.png') });
  // 走進出口（沒有寫出口的觸發器：預設＝任務成功）→ 回編輯器、記下通關
  await page.evaluate(() => {
    const g = window.__game;
    const m = g.lv.L.marks.find((x) => x.k === 'exit');
    g.player.pos.set(m.x, g.world.groundAt(m.x, m.z, 99), m.z);
  });
  await page
    .waitForFunction(() => window.__game.state === 'editor', null, { timeout: 40000 })
    .catch(() => {});
  const s5 = await page.evaluate(() => ({
    st: window.__game.state,
    clear: window.__game.ed && window.__game.ed.L.clear,
  }));
  check(
    s5.st === 'editor' && s5.clear && s5.clear.t > 0,
    `走進出口通關：回編輯器並記下通關紀錄（${s5.clear && s5.clear.t} 秒）`,
  );
  // 改了關卡就要重新通關
  await page.evaluate(() => {
    const g = window.__game;
    g.edPush();
    g.ed.L.props[0].x += 1;
    g.edChanged();
  });
  check(
    await page.evaluate(() => !window.__game.ed.L.clear),
    '通關後改了關卡：通關紀錄清掉（上傳前要重新通關）',
  );
  // 驗證：沒有出生點時不能試玩
  const v = await page.evaluate(() => {
    const g = window.__game,
      L = g.ed.L;
    const keep = L.marks.slice();
    L.marks = L.marks.filter((m) => m.k !== 'spawn');
    const errs = g
      .edValidate()
      .filter((x) => x.err)
      .map((x) => x.msg);
    g.edTest(false);
    const st = g.state;
    L.marks = keep;
    return { errs, st };
  });
  check(
    v.st === 'editor' && v.errs.some((m) => /出生點/.test(m)),
    `檢查：沒有出生點時擋下試玩（${v.errs[0]}）`,
  );
  // 多段：加第 2 段（出口一開始就開），第 1 段走出口 → 轉到第 2 段
  const m1 = await page.evaluate(async () => {
    const g = window.__game,
      ed = g.ed;
    ed.L.triggers = [];
    ed.L.units = [];
    ed.L.marks.find((m) => m.k === 'exit').open = true;
    g.edAddSeg();
    const seg = g.edCur();
    seg.units = [];
    seg.triggers = [
      {
        id: 't1',
        name: '',
        on: true,
        once: true,
        any: false,
        ev: { k: 'time', t: 1 },
        cond: [],
        act: [{ k: 'win' }],
      },
    ];
    g.edSetSeg(0);
    return { n: 1 + ed.L.segs.length, seg: ed.seg };
  });
  check(m1.n === 2 && m1.seg === 0, '多段出擊：新增第 2 段');
  await page.evaluate(() => window.__game.edTest(false));
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.lv, null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.hp = g.player.maxHp = 1e7;
    const m = g.lv.L.marks.find((x) => x.k === 'exit');
    g.player.pos.set(m.x, g.world.groundAt(m.x, m.z, 99), m.z);
  });
  await page
    .waitForFunction(() => window.__game.state === 'editor', null, { timeout: 25000 })
    .catch(() => {});
  check(await page.evaluate(() => window.__game.lvLastSeg === 1), '走進出口：轉場到第 2 段');
  check(
    await page.evaluate(() => window.__game.state === 'editor' && !!window.__game.ed.L.clear),
    '第 2 段的觸發器「任務成功」：整段出擊通關',
  );
  // 設定的「選擇底圖…」：取消回到原本的底圖；套用換成產生器底圖（可以復原）
  await page.click('[data-tool="set"]');
  await page.click('[data-ea="rebase"]');
  await page.waitForFunction(() => window.__game.ed.pick && window.__game.ed.pick.mode === 'rebase', null, {
    timeout: 10000,
  });
  const nUnits = await page.evaluate(() => window.__game.ed.L.units.length);
  await page.selectOption('#epBase', 'gen');
  await wait(400);
  await page.waitForFunction(() => !window.__game.ed.pick.busy && !(window.__game.ed.pick.t > 0), null, {
    timeout: 30000,
  });
  await page.click('#epCancel');
  const rb1 = await page.evaluate(() => ({
    blank: window.__game.ed.L.base.blank,
    pick: !!window.__game.ed.pick,
  }));
  check(rb1.blank && !rb1.pick, '選擇底圖：取消回到原本的底圖');
  await page.click('[data-tool="set"]');
  await page.click('[data-ea="rebase"]');
  await page.waitForFunction(() => window.__game.ed.pick, null, { timeout: 10000 });
  await page.selectOption('#epTheme', 'wasteland');
  await page.selectOption('#epBase', 'gen');
  await page.click('#epGo');
  await page.waitForFunction(() => !window.__game.ed.pick, null, { timeout: 30000 });
  const rb2 = await page.evaluate(() => {
    const g = window.__game;
    const out = { blank: g.ed.L.base.blank, theme: g.world.themeKey, units: g.ed.L.units.length };
    g.edUndo(false);
    out.undo = g.ed.L.base.blank;
    g.edUndo(true);
    return out;
  });
  check(
    !rb2.blank && rb2.theme === 'wasteland' && rb2.units === nUnits && rb2.undo,
    '選擇底圖：套用換成荒野的產生器底圖、單位保留、可以復原',
  );
  // 產生器底圖：移除產生器物件與還原
  const gn = await page.evaluate(() => {
    const g = window.__game,
      w = g.world;
    const it = (w.genItems || []).find((x) => !x.removed && x.obs.length);
    if (!it) return { n: 0 };
    const ob0 = w.obstacles.length;
    g.edGenToggle(it);
    const ob1 = w.obstacles.length;
    const rm = g.ed.L.removed.length;
    g.edGenRestore(0);
    return { n: w.genItems.length, ob0, ob1, rm, back: w.obstacles.length, vis: it.g.visible };
  });
  check(
    gn.n > 0 && gn.ob1 < gn.ob0 && gn.rm === 1 && gn.back === gn.ob0 && gn.vis,
    `產生器底圖：移除物件（碰撞 ${gn.ob0} → ${gn.ob1}）與還原`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.ed.dirty = false;
    g.edClose();
  });
  await waitVisible(page, 'levels');
  // 選單：遊玩（不是試玩）→ 放棄回選單
  await page.click(`#lvList [data-a="play"][data-id="${id}"]`);
  await page.waitForFunction(
    () => window.__game.state === 'play' && window.__game.lv && !window.__game.lv.test,
    null,
    { timeout: 30000 },
  );
  check(
    await page.evaluate(() => /自訂關卡/.test(document.getElementById('hudTop').textContent)),
    '選單「遊玩」：HUD 顯示自訂關卡',
  );
  await page.keyboard.press('Escape');
  await waitVisible(page, 'pause');
  await page.click('#btnAbort');
  check(await waitVisible(page, 'levels'), '放棄任務回到關卡選單');
  // 範例關卡：巡邏、依序的增援（預告後出現）、護送（車隊沿路線前進）
  await page.click('#levels [data-lt="sample"]');
  const sids = await page.$$eval('#lvList [data-a="xplay"]', (b) => b.map((x) => x.dataset.id));
  check(sids.length === 3, `範例關卡 ${sids.length} 個`);
  for (const sid of sids) {
    await page.click(`#lvList [data-a="xplay"][data-id="${sid}"]`);
    await page.waitForFunction(() => window.__game.state === 'play' && window.__game.lv, null, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      const g = window.__game;
      g.player.hp = g.player.maxHp = 1e7;
    });
    const p0 = await page.evaluate(() =>
      window.__game.allies.filter((a) => a.ai === 'convoy').map((a) => [a.pos.x, a.pos.z]),
    );
    if (/defend/.test(sid)) {
      // 軟體繪圖下雪地很慢：時間快轉到第 1 波的觸發器，預告出現後把預告的倒數縮短
      await page.evaluate(() => (window.__game.missionT = 3));
      const warned = await page
        .waitForFunction(() => window.__game.lv && window.__game.lv.st.pend.length > 0, null, {
          timeout: 20000,
        })
        .then(
          () => true,
          () => false,
        );
      check(warned, '範例「據點防衛」：第 1 波的預告（增援地點）');
      await page.evaluate(() => {
        for (const q of window.__game.lv.st.pend) q.t = 0.05;
      });
    }
    const ok = await page
      .waitForFunction(
        (sid) => {
          const g = window.__game;
          if (!g.lv) return false;
          if (/patrol/.test(sid))
            return g.enemies
              .filter((e) => e.edu && e.edu.g === 'g1')
              .some((e) => Math.hypot(e.pos.x, e.pos.z + 30) > 3);
          if (/defend/.test(sid)) return g.enemies.filter((e) => e.edu && e.edu.g === 'g1').length === 3;
          return g.allies.filter((a) => a.ai === 'convoy').length === 2 && g.missionT > 3;
        },
        sid,
        { timeout: 90000 },
      )
      .then(
        () => true,
        () => false,
      );
    let detail = '';
    if (/convoy/.test(sid)) {
      const p1 = await page.evaluate(() =>
        window.__game.allies.filter((a) => a.ai === 'convoy').map((a) => [a.pos.x, a.pos.z]),
      );
      const mv = p0.length && p1.length ? Math.hypot(p1[0][0] - p0[0][0], p1[0][1] - p0[0][1]) : 0;
      detail = `（車隊前進 ${mv.toFixed(1)} m）`;
      check(ok && mv > 1, '範例「護送車隊」：車隊沿路線前進' + detail);
    } else
      check(
        ok,
        /patrol/.test(sid) ? '範例「巡邏與警戒」：巡邏隊出發' : '範例「據點防衛」：第 1 波預告後從北方進入',
      );
    await page.screenshot({ path: path.join(SHOT_DIR, `level-sample-${sid.slice(8, 14)}.png`) });
    await page.evaluate(() => window.__game.lvAbort());
    await waitVisible(page, 'levels');
  }
  // 複製範例到我的關卡 → 開編輯器；陣列複製
  await page.click('#levels [data-lt="sample"]');
  await page.click(`#lvList [data-a="xcopy"][data-id="${sids[0]}"]`);
  await page.waitForFunction(() => window.__game.state === 'editor', null, { timeout: 30000 });
  const cp = await page.evaluate(() => {
    const g = window.__game,
      ed = g.ed;
    const n0 = ed.L.props.length;
    g.edSelect({ t: 'prop', i: 0 });
    g.edArray(3, 8);
    const out = { name: ed.L.name, n0, n1: ed.L.props.length, recs: g.world.lvProps.filter(Boolean).length };
    ed.dirty = false;
    return out;
  });
  check(
    /副本/.test(cp.name) && cp.n1 === cp.n0 + 3 && cp.recs === cp.n1,
    `範例複製到我的關卡後編輯；陣列複製 ${cp.n0} → ${cp.n1}`,
  );
  await page.evaluate(() => window.__game.edClose());
  await waitVisible(page, 'levels');
  await ctx.close();
  // 平板與手機的版面
  for (const [w, h, tag] of [
    [1180, 820, 'tablet'],
    [844, 390, 'phone'],
  ]) {
    const c2 = await browser.newContext({
      viewport: { width: w, height: h },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    watch(pg, 'levels-' + tag);
    await pg.goto(base + '?test');
    await waitVisible(pg, 'title');
    await pg.evaluate(() => window.__game.openLevels());
    await waitVisible(pg, 'levels');
    if (tag === 'phone') {
      check(
        await pg.evaluate(() => document.getElementById('btnLvNew').disabled),
        '手機：關卡選單可以玩，但不能新建／編輯',
      );
      await pg.screenshot({ path: path.join(SHOT_DIR, 'level-menu-phone.png') });
    } else {
      await pg.click('#btnLvNew');
      await pg.waitForFunction(() => window.__game.state === 'editor' && window.__game.ed.pick, null, {
        timeout: 30000,
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, 'level-pick-tablet.png') });
      await pg.tap('#epGo');
      await pg.waitForFunction(() => window.__game.state === 'editor' && !window.__game.ed.pick, null, {
        timeout: 30000,
      });
      await wait(800);
      // 觸控：點一下放置、雙指縮放
      await pg.tap('[data-tool="mark"]');
      await pg.tap('[data-mk="spawnpt"]');
      const box = await pg.evaluate(() => {
        const r = document.getElementById('edLeft').getBoundingClientRect();
        return r.right;
      });
      await pg.touchscreen.tap(box + 200, h / 2);
      await wait(300);
      const n = await pg.evaluate(() => window.__game.ed.L.marks.filter((m) => m.k === 'spawnpt').length);
      check(n === 1, '平板：點一下地面放置增援地點');
      await pg.screenshot({ path: path.join(SHOT_DIR, 'level-editor-tablet.png') });
    }
    await c2.close();
  }
}

// 建一個簡單的自訂關卡並存進這個頁面的本機關卡（開編輯器 → 加內容 → 試玩通關 → 存檔）；回傳關卡 id
async function makeLevel(page, name, edit) {
  await page.evaluate(() => window.__game.openLevels());
  await waitVisible(page, 'levels');
  await page.click('#btnLvNew');
  await page.waitForFunction(() => window.__game.state === 'editor' && window.__game.ed.pick, null, {
    timeout: 30000,
  });
  await page.fill('#epName', name);
  await page.click('#epGo');
  await page.waitForFunction(() => window.__game.state === 'editor' && !window.__game.ed.pick, null, {
    timeout: 30000,
  });
  await page.evaluate(edit);
  if (edit.clear) {
    await page.evaluate(() => window.__game.edTest(false));
    await page.waitForFunction(() => window.__game.state === 'play' && window.__game.lv, null, {
      timeout: 30000,
    });
    await page.evaluate(() => {
      const g = window.__game;
      g.player.hp = g.player.maxHp = 1e7;
    });
    await page
      .waitForFunction(() => window.__game.state === 'editor', null, { timeout: 20000 })
      .catch(() => {});
  }
  await page.evaluate(() => window.__game.edSave(true));
  const id = await page.evaluate(() => window.__game.ed.L.id);
  await page.evaluate(() => window.__game.edClose());
  await waitVisible(page, 'levels');
  return id;
}
// 只有「一秒後任務成功」的關卡（試玩一下就通關）
function quickWin() {
  const g = window.__game,
    L = g.ed.L;
  L.triggers.push({
    id: 't1',
    name: '',
    on: true,
    once: true,
    any: false,
    ev: { k: 'time', t: 1 },
    cond: [],
    act: [{ k: 'win' }],
  });
  g.edChanged();
}
quickWin.clear = true;

// 區網伺服器的自訂關卡：上傳要先通關、作者金鑰（別人不能覆寫或刪除）、清單、遊玩與通關次數、下載、刪除
async function testLevelsServer(browser, url) {
  console.log('自訂關卡（伺服器）：上傳要通關、作者金鑰、清單、遊玩次數、下載、刪除');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const page = await ctx.newPage();
  watch(page, 'levels-server');
  await page.goto(url + '?test');
  await waitVisible(page, 'title');
  const id = await makeLevel(page, '伺服器測試關卡', quickWin);
  check(await page.evaluate(() => window.__game.lvMine.some((L) => L.clear)), '試玩通關後存檔：有通關紀錄');
  // 選單上傳
  await page.click(`#lvList [data-a="up"][data-id="${id}"]`);
  await page
    .waitForFunction(() => /已上傳/.test(document.getElementById('lvMsg').textContent), null, {
      timeout: 10000,
    })
    .catch(() => {});
  const list = await (await fetch(url + 'api/levels')).json();
  const e = (list.levels || []).find((x) => x.id === id);
  check(
    !!e && e.name === '伺服器測試關卡' && !e.kh && e.clearT > 0,
    '選單「上傳」：/api/levels 列出關卡（不含作者金鑰）',
  );
  // 別人的金鑰：不能覆寫、不能刪除；沒有通關紀錄：不能上傳
  const raw = await (await fetch(url + 'api/levels/' + id)).json();
  const put = (body, key) =>
    fetch(url + 'api/levels/' + id, {
      method: 'PUT',
      headers: { 'X-Author-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const r1 = await put(raw, 'someone-else-key-0000');
  const r2 = await fetch(url + 'api/levels/' + id, {
    method: 'DELETE',
    headers: { 'X-Author-Key': 'someone-else-key-0000' },
  });
  const nc = { ...raw, id: 'lvsmokenoclear01', clear: null };
  const r3 = await fetch(url + 'api/levels/' + nc.id, {
    method: 'PUT',
    headers: { 'X-Author-Key': 'someone-else-key-0000', 'Content-Type': 'application/json' },
    body: JSON.stringify(nc),
  });
  check(
    r1.status === 403 && r2.status === 403 && r3.status === 400,
    `別人不能覆寫（${r1.status}）或刪除（${r2.status}）；沒通關不能上傳（${r3.status}）`,
  );
  // 伺服器分頁：遊玩 → 通關 → 遊玩／通關次數
  await page.click('#levels [data-lt="server"]');
  await page.waitForSelector(`#lvList [data-a="splay"][data-id="${id}"]`, { timeout: 10000 });
  await page.click(`#lvList [data-a="splay"][data-id="${id}"]`);
  await page.waitForFunction(() => window.__game.state === 'play' && window.__game.lv, null, {
    timeout: 30000,
  });
  await page.evaluate(() => {
    const g = window.__game;
    g.player.hp = g.player.maxHp = 1e7;
  });
  check(await waitVisible(page, 'result', 20000), '伺服器上的關卡：遊玩、通關、結果畫面');
  const rows = await page.evaluate(() => document.getElementById('resultGrid').textContent);
  check(/沒有 COAM/.test(rows), '結果畫面：自訂關卡沒有獎勵');
  await wait(500);
  const e2 = ((await (await fetch(url + 'api/levels')).json()).levels || []).find((x) => x.id === id);
  check(e2 && e2.plays === 1 && e2.clears === 1, `遊玩／通關次數（${e2 && e2.plays}／${e2 && e2.clears}）`);
  await page.click('#btnResultOk');
  await waitVisible(page, 'levels');
  // 刪除（作者本人，按兩次確認）
  await page.click('#levels [data-lt="server"]');
  await page.waitForSelector(`#lvList [data-a="sdel"][data-id="${id}"]`, { timeout: 10000 });
  await page.click(`#lvList [data-a="sdel"][data-id="${id}"]`);
  await page.click(`#lvList [data-a="sdel"][data-id="${id}"]`);
  await wait(800);
  const e3 = ((await (await fetch(url + 'api/levels')).json()).levels || []).find((x) => x.id === id);
  check(!e3, '作者本人從伺服器刪除');
  await ctx.close();
}

// 多人的自訂關卡（?lan=local）：大廳的「自訂關卡」模式、關卡資料傳給客機、雙方同一張地圖、觸發器狀態同步、結果
async function testMpLevels(browser, url) {
  console.log('多人自訂關卡：大廳選關卡、傳給客機、同一張地圖、目標文字同步、結束');
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  const host = await ctx.newPage();
  const cli = await ctx.newPage();
  watch(host, 'mplv:host');
  watch(cli, 'mplv:client');
  await host.goto(url);
  await cli.goto(url);
  await waitVisible(host, 'title');
  const id = await makeLevel(host, '多人測試關卡', () => {
    const g = window.__game,
      ed = g.ed,
      L = ed.L;
    ed.place = 'ed/block';
    g.edPlaceProp({ x: 14, y: 0, z: 0, terrain: true });
    ed.unitKind = 'enemy';
    ed.unitType = 'mt';
    g.edPlaceUnit({ x: 30, y: 0, z: 30 });
    L.triggers.push({
      id: 't1',
      name: '',
      on: true,
      once: true,
      any: false,
      ev: { k: 'start' },
      cond: [],
      act: [{ k: 'obj', text: 'MP 目標' }],
    });
    g.edChanged();
  });
  await host.evaluate(() => {
    window.__game.state = 'title';
    window.__game.showScreen('title');
  });
  await host.click('#btnMP');
  await setNick(host, 'HOST');
  await host.click('#btnMPHost');
  await waitVisible(host, 'lobby');
  await host.check('#mpAuto');
  await host.dispatchEvent('#mpAuto', 'change');
  await cli.click('#btnMP');
  await setNick(cli, 'CLIENT');
  await wait(1000);
  await cli.click('#btnMPList');
  await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
  await cli.click('#mpRooms .part');
  await waitVisible(cli, 'lobby', 15000);
  await host.selectOption('#pvMode', 'level');
  await host.waitForSelector(`#pvLevel option[value="l:${id}"]`, { timeout: 10000, state: 'attached' });
  await host.selectOption('#pvLevel', 'l:' + id);
  const got = await cli
    .waitForFunction(() => /✓/.test(document.getElementById('lobbyMode').textContent), null, {
      timeout: 15000,
    })
    .then(
      () => true,
      () => false,
    );
  check(got, '大廳「自訂關卡」：房主選關卡，客機收到關卡資料（✓）');
  await host
    .waitForFunction(() => /關卡 ✓/.test(document.getElementById('lobbySlots').textContent), null, {
      timeout: 10000,
    })
    .catch(() => {});
  await cli.evaluate(() => (window.__game.hostLostMs = 15000));
  await cli.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbyReady');
  await wait(500);
  await host.click('#btnLobbySortie');
  await cli.bringToFront();
  await host.evaluate(() => (window.requestAnimationFrame = () => 0));
  let pumping = true;
  const pumpLoop = (async () => {
    while (pumping) {
      await host.evaluate(() => window.__game.loop()).catch(() => {});
      await wait(20);
    }
  })();
  const started = (await waitVisible(host, 'hudWrap', 25000)) && (await waitVisible(cli, 'hudWrap', 25000));
  check(started, '多人自訂關卡：雙方出擊');
  await wait(2500);
  const v = await cli.evaluate(() => {
    const g = window.__game;
    return {
      props: g.world && g.world.lvProps ? g.world.lvProps.length : -1,
      obs: g.world.obstacles.length,
      edu: g.enemies.filter((e) => e.edu).length,
      obj: document.getElementById('hudTop').textContent,
      name: document.getElementById('hudTop').textContent,
    };
  });
  const hv = await host.evaluate(() => ({ obs: window.__game.world.obstacles.length }));
  check(
    v.props === 1 && v.obs === hv.obs && v.edu === 1,
    `客機：同樣的擺放物件（碰撞 ${v.obs}／${hv.obs}）與關卡的單位`,
  );
  check(/MP 目標/.test(v.obj) && /多人測試關卡/.test(v.name), '客機：觸發器的目標文字與關卡名稱');
  await host.evaluate(() => {
    const g = window.__game;
    for (const p of g.players) p.hp = p.maxHp = 1e7;
    for (const e of g.enemies)
      if (!e.dead) e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
  });
  const end = await cli
    .waitForFunction(() => window.__game.state === 'result', null, { timeout: 20000 })
    .then(
      () => true,
      () => false,
    );
  const t = await cli.evaluate(() => document.getElementById('rTitle').textContent);
  check(end && /完成/.test(t), `敵人全滅：雙方的結果畫面（客機：${t}）`);
  pumping = false;
  await pumpLoop;
  await ctx.close();
}

// 狀態效果（entities/mech-status.js、game/status-hud.js）：每種狀態的移動效果、掙脫規則、HUD、截圖
async function testStatusFx(browser, base) {
  console.log('狀態效果：鉤住、黏附炸彈、纏附、緩速、禁止跳躍、捕獲網、標定、吸取 EN（移動、掙脫、HUD）');
  const { ctx, page } = await newPage(browser, 'status');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    const out = {};
    g.save.level = 1;
    g.startMission();
    g.waves = [];
    g.wavePend = null;
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    pl.asm.larm = 'w_blade'; // 近戰割開用
    pl.initWeapons();
    g.world.obstacles = g.world.obstacles.filter((o) => Math.hypot(o.x - pl.pos.x, o.z - pl.pos.z) > 40);
    for (const e of g.enemies) e.pos.set(300, -80, 300);
    const src = g.enemies[0];
    src.updateAI = () => {};
    src.hp = src.maxHp = 1e8;
    const reset = () => {
      pl.statusClearAll(true);
      pl.pos.set(0, g.world.groundAt(0, 0, 99), 0);
      pl.vel.set(0, 0, 0);
      pl.grounded = true;
      pl.en = pl.enMax;
      pl.qbT = 0;
      pl.melee.active = false;
      pl.staggerT = 0;
      pl.hoverMode = 0;
    };
    const step = (n, wish = new THREE.Vector3(), hover = false, qb = false) => {
      for (let i = 0; i < n; i++) pl.move(1 / 60, wish.clone(), hover, qb && i === 0, false, null);
    };
    const fwd = new THREE.Vector3(1, 0, 0);
    // 量速度時每格把機體放回原點：隨機地圖的坡度不影響（只看速度的比例）
    const walk = (n) => {
      for (let i = 0; i < n; i++) {
        pl.pos.set(0, g.world.groundAt(0, 0, 99), 0);
        pl.grounded = true;
        pl.move(1 / 60, fwd.clone(), false, false, false, null);
      }
    };
    const speed = () => {
      reset();
      walk(60);
      return Math.hypot(pl.vel.x, pl.vel.z);
    };
    const hud = (k) => {
      g.drawHud(1 / 60);
      const el = document.querySelector(`#stsHud .stsI[data-k="${k}"]`);
      return {
        on: !!el && getComputedStyle(document.getElementById('stsHud')).display !== 'none',
        txt: el ? el.querySelector('small').textContent : '',
        bar: el ? parseFloat(el.querySelector('.tb s').style.width) : -1,
        edge: document.getElementById('stsEdge').style.boxShadow.includes('inset'),
      };
    };
    const v0 = speed();
    // 緩速：速度 ×0.6、QB 耗能 ×1.5
    const qbCost = (st) => {
      reset();
      if (st) pl.addStatus(st, 4);
      const e0 = pl.en;
      pl.move(1 / 60, fwd.clone(), false, true, false, null);
      return e0 - pl.en;
    };
    const c0 = qbCost(null);
    const c1 = qbCost('slow');
    reset();
    pl.addStatus('slow', 9); // 上限 4 秒
    out.slowCap = pl.sts.slow.t;
    out.slowHud = hud('slow');
    out.slowSeen = !!(g.stsSeen && g.stsSeen.has('slow'));
    walk(60);
    out.slowV = Math.hypot(pl.vel.x, pl.vel.z) / v0;
    out.slowQb = c1 / c0;
    out.frost = !!(pl.stsV && pl.stsV.slow && pl.stsV.slow.frost.length);
    // 禁止跳躍：地面跳不起來；空中被往下拉、不能懸浮
    reset();
    pl.addStatus('nojump', 4);
    out.njHud = hud('nojump');
    step(20, new THREE.Vector3(), true);
    out.njGround = pl.grounded && pl.pos.y - g.world.groundAt(0, 0, 99) < 0.05;
    pl.pos.y += 10;
    pl.grounded = false;
    pl.vel.y = 0;
    step(20, new THREE.Vector3(), true);
    out.njFall = pl.vel.y;
    out.njHover = pl.hoverMode;
    // 鉤住：往來源拉；QB 一次掙脫
    reset();
    src.pos.set(-30, g.world.groundAt(-30, 0, 99), 0);
    pl.addStatus('hook', 4, { src: src.id, pull: 14 });
    out.hookHud = hud('hook');
    step(45);
    out.hookPull = -pl.pos.x;
    out.cable = !!(pl.stsV && pl.stsV.hook && pl.stsV.hook.cable.visible);
    pl.qbT = 0;
    step(1, new THREE.Vector3(), false, true);
    out.hookEsc = !pl.hasStatus('hook');
    // 黏附炸彈：QB 一次還在、兩次甩掉；時間到爆炸
    reset();
    pl.addStatus('stick', 4, { dmg: 500, impact: 100, src: src.id });
    step(1, new THREE.Vector3(), false, true);
    out.stick1 = pl.hasStatus('stick');
    out.stickHud = hud('stick');
    step(15);
    step(1, new THREE.Vector3(), false, true);
    out.stick2 = !pl.hasStatus('stick');
    reset();
    const hp0 = pl.hp;
    pl.addStatus('stick', 0.5, { dmg: 500, impact: 100, src: src.id });
    step(40);
    out.stickBoom = hp0 - pl.hp;
    out.stickGone = !pl.hasStatus('stick');
    // 纏附：持續受損、變慢；近戰割開；QB 兩次也能甩掉
    reset();
    const hp1 = pl.hp;
    pl.addStatus('latch', 4, { dps: 200, src: src.id });
    out.latchHud = hud('latch');
    walk(60);
    out.latchV = Math.hypot(pl.vel.x, pl.vel.z) / v0;
    out.latchDmg = hp1 - pl.hp;
    pl.startMeleeStage('larm', 0, src.center(), null);
    out.latchCut = !pl.hasStatus('latch');
    reset();
    pl.addStatus('latch', 4, { dps: 0 });
    step(1, new THREE.Vector3(), false, true);
    step(15);
    step(1, new THREE.Vector3(), false, true);
    out.latchQb = !pl.hasStatus('latch');
    // 來源被擊破或離場時自動解除（纏附、鉤住）
    reset();
    const e3 = g.spawnType('mt', 1, 1);
    e3.updateAI = () => {};
    pl.addStatus('latch', 4, { dps: 0, src: e3.id });
    pl.addStatus('hook', 4, { src: e3.id });
    step(2);
    const kept = pl.hasStatus('latch') && pl.hasStatus('hook');
    e3.depart();
    step(1);
    out.srcGone = kept && !pl.hasStatus('latch') && !pl.hasStatus('hook');
    // 捕獲網：變慢＋不能跳；QB 掙脫不了、近戰割開
    reset();
    pl.addStatus('net', 4);
    out.netHud = hud('net');
    walk(60);
    out.netV = Math.hypot(pl.vel.x, pl.vel.z) / v0;
    step(1, new THREE.Vector3(), true);
    out.netJump = pl.grounded;
    step(1, new THREE.Vector3(), false, true);
    out.netQb = pl.hasStatus('net');
    pl.startMeleeStage('larm', 0, src.center(), null);
    out.netCut = !pl.hasStatus('net');
    // 吸取 EN
    reset();
    pl.addStatus('drain', 4, { en: 400, src: src.id });
    out.drainHud = hud('drain');
    const en0 = pl.en;
    step(30);
    out.drain = en0 - pl.en;
    // 標定：搜索中的敵人直接交戰並知道位置
    reset();
    const e2 = g.spawnType('mt', 1, 1);
    e2.updateAI = () => {};
    e2.pos.set(60, g.world.groundAt(60, 40, 99), 40);
    if (e2.senseOn()) {
      e2.sn.on = true;
      e2.sn.st = 3;
      e2.sn.tgt = null;
    }
    pl.addStatus('spotted', 4);
    out.spotHud = hud('spotted');
    g.aiDir().t = 0;
    g.aiDirectorTick(0.01);
    out.spot = !!(e2.sn && e2.sn.st === 2 && e2.sn.tgt === pl && e2.sn.kn && e2.sn.kn.distanceTo(pl.pos) < 1);
    // 觸控時提示改成按鈕名稱
    reset();
    pl.addStatus('hook', 4, { src: src.id });
    g.touchActive = true;
    out.touchTxt = hud('hook').txt;
    g.touchActive = false;
    out.keyTxt = hud('hook').txt;
    pl.statusClearAll(true);
    g.drawHud(1 / 60);
    out.hudOff = getComputedStyle(document.getElementById('stsHud')).display === 'none';
    reset();
    return out;
  });
  const hudOk = (h, re) => h.on && h.edge && h.bar > 50 && re.test(h.txt);
  check(
    Math.abs(r.slowV - 0.6) < 0.08 && r.slowQb > 1.35,
    `緩速：速度 ×${r.slowV.toFixed(2)}、QB 耗能 ×${r.slowQb.toFixed(2)}`,
  );
  check(r.slowCap === 4, `每種狀態上限 4 秒（給 9 秒 → ${r.slowCap}）`);
  check(
    r.frost && r.slowSeen && hudOk(r.slowHud, /移動變慢/),
    '緩速：結霜、第一次中招的說明、HUD 圖示與倒數、畫面邊緣',
  );
  check(
    r.njGround && r.njFall < -5 && r.njHover === 0,
    `禁止跳躍：跳不起來、空中被往下拉（${r.njFall.toFixed(1)} m/s）、不能懸浮`,
  );
  check(hudOk(r.njHud, /不能跳躍/), 'HUD：禁止跳躍');
  check(r.hookPull > 3 && r.cable, `鉤住：0.75 秒被往鉤點拉 ${r.hookPull.toFixed(1)} m、畫出鋼索`);
  check(r.hookEsc && hudOk(r.hookHud, /QB 掙脫/), 'HUD 提示「QB 掙脫」、QB 一次掙脫鉤住');
  check(
    r.stick1 && r.stick2 && hudOk(r.stickHud, /連按 QB 甩掉 1\/2/),
    '黏附炸彈：QB 一次還在（HUD 顯示 1/2）、兩次甩掉',
  );
  check(r.stickBoom >= 400 && r.stickGone, `黏附炸彈時間到爆炸（受到 ${Math.round(r.stickBoom)}）`);
  check(
    r.latchV < 0.7 && r.latchDmg > 50 && r.latchCut && r.latchQb && hudOk(r.latchHud, /近戰割開.*連按 QB/),
    `纏附：變慢 ×${r.latchV.toFixed(2)}、持續受損 ${Math.round(r.latchDmg)}、近戰割開、QB 兩次甩掉`,
  );
  check(
    r.netV < 0.7 && r.netJump && r.netQb && r.netCut && hudOk(r.netHud, /近戰割開/),
    `捕獲網：變慢 ×${r.netV.toFixed(2)}、不能跳、QB 掙脫不了、近戰割開` +
      JSON.stringify({ j: r.netJump, q: r.netQb, c: r.netCut, h: r.netHud }),
  );
  check(r.drain > 100 && hudOk(r.drainHud, /EN/), `吸取 EN（0.5 秒 −${Math.round(r.drain)}）`);
  check(r.spot && hudOk(r.spotHud, /敵人/), '標定：搜索中的敵人知道位置並交戰');
  check(
    /QB 鈕/.test(r.touchTxt) && /左 Shift/.test(r.keyTxt),
    `觸控時提示改成按鈕名稱（${r.touchTxt}／${r.keyTxt}）`,
  );
  check(r.hudOff, '狀態解除後 HUD 收起');
  check(r.srcGone, '纏附者／鉤住的來源離場（或被擊破）時自動解除');
  // 截圖：每種狀態（俯視＋追尾）
  const kinds = ['hook', 'stick', 'latch', 'slow', 'nojump', 'net', 'spotted', 'drain'];
  for (const view of ['top', 'chase']) {
    for (const k of kinds) {
      await page.evaluate(
        ({ k, view }) => {
          const g = window.__game;
          const pl = g.player;
          pl.statusClearAll(true);
          if ((view === 'chase') !== !!g.chase) g.setView(view, true);
          g.fpYaw = 0;
          g.fpPitch = -0.15;
          const src = g.enemies[0];
          const gy = (x, z) => g.world.groundAt(x, z, 99);
          pl.pos.set(0, gy(0, 0), 0);
          pl.vel.set(0, 0, 0);
          src.pos.set(view === 'chase' ? 6 : 14, gy(14, -16), -16);
          src.mesh.position.copy(src.pos);
          pl.addStatus(k, 4, { src: src.id, dps: 0, en: 50, dmg: 0 });
        },
        { k, view },
      );
      await wait(700);
      await page.screenshot({ path: path.join(SHOT_DIR, `status-${k}-${view}.png`) });
    }
  }
  // 多個狀態同時（第一人稱）
  await page.evaluate(() => {
    const g = window.__game;
    const pl = g.player;
    pl.statusClearAll(true);
    g.setView('fp', true);
    for (const k of ['hook', 'stick', 'net']) pl.addStatus(k, 4, { src: g.enemies[0].id, dmg: 0 });
  });
  await wait(700);
  await page.screenshot({ path: path.join(SHOT_DIR, 'status-multi-fp.png') });
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.state = 'title';
  });
  await ctx.close();
}

// 地圖專屬敵人用的場上機制（game/hazards2.js）：區域效果、臨時障礙物、可以打掉的投射物、laserK、受損與碎片、弱點
async function testHazards2(browser, base) {
  console.log(
    '場上機制：區域效果、臨時障礙物、可以打掉的投射物、laserK、受損三階段與擊破碎片、專屬敵人的弱點',
  );
  // 專屬敵人（舊的與擴充組）的弱點（資料檢查）
  // foes.js 是純資料的 ES module（只 import 同資料夾的純資料 foes-<組>.js）：拿掉 export、
  // import 換成那個檔案包在自己的作用域裡執行（各檔的常數名稱可能重複）
  const readData = (n) =>
    fs
      .readFileSync(path.join(ROOT, 'src/data', n), 'utf8')
      .replace(/^export /gm, '')
      .replace(
        /^import \{([^}]*)\} from '\.\/([\w-]+\.js)';$/gm,
        (m, names, f) => `const {${names}} = (() => {\n${readData(f)}\nreturn {${names}};\n})();`,
      );
  const FOES = new Function(readData('foes.js') + '\nreturn FOES;')();
  const themes = {};
  let noRes = [];
  for (const [k, d] of Object.entries(FOES)) {
    if (!Array.isArray(d.res) || d.res.length !== 3) {
      noRes.push(k);
      continue;
    }
    (themes[d.theme] = themes[d.theme] || new Set()).add(d.res.findIndex((x) => x <= -0.2));
  }
  const thin = Object.entries(themes).filter(([, s]) => [...s].filter((i) => i >= 0).length < 2);
  check(
    !noRes.length && !thin.length,
    `專屬敵人都有弱點、每個主題至少兩種不同弱點${noRes.length ? '（缺：' + noRes.join('、') + '）' : ''}${thin.length ? '（不足：' + thin.map((t) => t[0]).join('、') + '）' : ''}`,
  );
  const { ctx, page } = await newPage(browser, 'hazards2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const shot = (n) => page.screenshot({ path: path.join(SHOT_DIR, `hz2-${n}.png`) });
  // 出擊：清掉敵人，留一台不動的放在遠處（不然會判定任務完成）
  await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 2;
    g.startMission();
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    pl.yaw = pl.aimYaw = 0; // 面向 −Z（俯視的鎖定看正面 180°）
    for (const e of g.enemies) e.cleanup();
    g.enemies = [];
    g.waves = [];
    g.wavePend = null;
    const far = g.spawnType('mt', 1, 1, pl.pos.clone().add(new THREE.Vector3(60, 0, 60)), 1);
    far.hp = far.maxHp = 1e9;
    far.updateAI = () => {};
    // 地圖是隨機的：出生點附近的貨櫃等障礙物會擋住探照燈、光束的視線或把臨時障礙物的碰撞推歪，先全部拿掉
    g.world.obstacles.length = 0;
    // 狀態效果（A1 的 mech-status.js）還沒合併時用記錄器代替
    const st = (window.__st = []);
    if (!pl.addStatus) pl.addStatus = (k, s, o) => st.push(k);
    else {
      const f = pl.addStatus.bind(pl);
      pl.addStatus = (k, s, o) => (st.push(k), f(k, s, o));
    }
    window.__at = (dx, dz, dy = 0) => {
      const p = pl.pos.clone().add(new THREE.Vector3(dx, 0, dz));
      p.y = g.world.groundAt(p.x, p.z, p.y + 3) + dy;
      return p;
    };
    window.__tick = (sec, step = 0.05) => {
      pl.iFrames = 0;
      for (let t = 0; t < sec; t += step) g.zonesTick(step);
    };
    window.__clr = () => {
      g.clearZones();
      g.clearTempWalls();
      window.__st.length = 0;
    };
  });
  // ---- 煙霧：不能鎖定、敵人的視線不通 ----
  const smoke = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    const e = g.spawnType('mt', 1, 1, window.__at(0, -14), 1);
    e.updateAI = () => {};
    e.hp = e.maxHp = 1e8;
    window.__mt = e;
    const before = g.lockCands(pl).includes(e);
    const los0 = g.world.losBlocked(pl.center(), e.center());
    const id = g.addZone('smoke', window.__at(0, -14), 6, 60);
    window.__tick(0.8);
    const r = {
      before,
      los0,
      after: g.lockCands(pl).includes(e),
      los1: g.world.losBlocked(e.center(), pl.center()),
      inSmoke: g.inSmoke(e.center()),
    };
    pl.lock = e;
    g.autoLock(pl);
    r.dropped = pl.lock !== e;
    g.removeZone(id);
    r.back = g.lockCands(pl).includes(e);
    g.addZone('smoke', window.__at(0, -14), 6, 60);
    window.__tick(0.8); // 淡入完成再截圖
    return r;
  });
  check(
    smoke.before && !smoke.after && smoke.los1 && smoke.inSmoke && smoke.dropped && smoke.back,
    `煙霧：裡面的敵人不能鎖定（${smoke.before}→${smoke.after}）、鎖定中的被解除、敵人的視線不通、移除後恢復`,
  );
  await wait(900);
  await shot('smoke');
  // ---- 重力場：nojump；吸引：往中心拉 ----
  const grav = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    window.__mt.pos.copy(window.__at(30, 30));
    g.addZone('gravity', window.__at(0, 0), 7, 60);
    window.__tick(0.5);
    const nj = window.__st.includes('nojump');
    window.__clr();
    const id2 = g.addZone('gravity', window.__at(40, 0), 5, 60);
    window.__tick(0.5);
    const far = window.__st.includes('nojump');
    g.removeZone(id2);
    g.addZone('gravity', window.__at(0, 0), 7, 60);
    window.__tick(0.8);
    return { nj, far };
  });
  check(grav.nj && !grav.far, `重力場：裡面的玩家套 nojump（${grav.nj}），外面的不套（${grav.far}）`);
  await wait(900);
  await shot('gravity');
  const suck = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    const c = window.__at(9, 0);
    g.addZone('suction', c, 14, 60, { pull: 10 });
    window.__tick(0.7);
    const d0 = Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z);
    const z = new THREE.Vector3();
    for (let i = 0; i < 40; i++) pl.move(1 / 40, z, false, false, false, null);
    const d1 = Math.hypot(pl.pos.x - c.x, pl.pos.z - c.z);
    pl.pos.add(new THREE.Vector3(-(d0 - d1), 0, 0)); // 放回原位
    return { d0, d1 };
  });
  check(suck.d1 < suck.d0 - 2, `吸引：1 秒內往中心拉近（${suck.d0.toFixed(1)} → ${suck.d1.toFixed(1)} m）`);
  await wait(900);
  await shot('suction');
  // ---- 水面電流：在水裡才受傷 ----
  const elec = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player,
      w = g.world;
    window.__clr();
    const th0 = w.theme;
    const dry = pl.hp;
    g.addZone('electro', window.__at(0, -6), 9, 60, { dps: 400 });
    window.__tick(1);
    const dryLoss = dry - pl.hp;
    w.theme = Object.assign({}, th0, {
      water: { level: w.terrainHeight(pl.pos.x, pl.pos.z) + 0.8, color: 0x305060 },
    });
    window.__th0 = th0;
    const h0 = pl.hp;
    window.__tick(1);
    return { dryLoss, wet: h0 - pl.hp };
  });
  check(
    elec.dryLoss === 0 && elec.wet > 150,
    `水面電流：乾地不受傷（${elec.dryLoss}），站在水中受傷（${Math.round(elec.wet)}）`,
  );
  await wait(900);
  await shot('electro');
  await page.evaluate(() => (window.__game.world.theme = window.__th0));
  // ---- 油漬：時間到點燃、被爆炸提早點燃 ----
  const fuel = await page.evaluate(() => {
    const g = window.__game;
    window.__clr();
    const pools0 = (g.hzPools || []).length;
    g.addZone('fuel', window.__at(-8, -4), 4, 60, { ignite: 0.5, dps: 100 });
    window.__tick(0.7);
    const timed = (g.hzPools || []).length - pools0;
    g.addZone('fuel', window.__at(8, -4), 4, 60, { ignite: 30 });
    const left = g.zones.length;
    g.hz2Blast(window.__at(8, -4, 1), 300, 3, 'exp');
    return { timed, left, blast: (g.hzPools || []).length - pools0, zones: g.zones.length };
  });
  check(
    fuel.timed === 1 && fuel.left === 1 && fuel.blast === 2 && fuel.zones === 0,
    `油漬：時間到點燃成燃燒地面、被爆炸提早點燃（燃燒地面 ${fuel.blast}）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.hzPools = [];
    g.addZone('fuel', window.__at(5, 6), 5, 60, { ignite: 30 });
    window.__tick(0.8);
  });
  await wait(900);
  await shot('fuel');
  // ---- 探照燈：照到套 spotted、照不到不套 ----
  const spot = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    const id = g.addZone('spot', window.__at(-6, -6, 14), 0, 60, {
      dir: pl
        .center()
        .sub(window.__at(-6, -6, 14))
        .normalize(),
      ang: 0.3,
      len: 30,
    });
    window.__tick(0.5);
    const hit = window.__st.includes('spotted');
    window.__st.length = 0;
    g.moveZone(id, null, new THREE.Vector3(1, -1, 0).normalize());
    window.__tick(0.5);
    const miss = window.__st.includes('spotted');
    g.moveZone(
      id,
      null,
      pl
        .center()
        .sub(window.__at(-6, -6, 14))
        .normalize(),
    );
    return { hit, miss };
  });
  check(spot.hit && !spot.miss, `探照燈：照到的玩家套 spotted（${spot.hit}），轉開後不套（${spot.miss}）`);
  await wait(900);
  await shot('spot');
  // ---- 追蹤光束：追越久越痛、被障礙物斷開就重來 ----
  const beam = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    const from = window.__at(8, 8, 14);
    const id = g.addZone('beam', from, 0, 60, { target: pl, dps0: 60, dps1: 600, ramp: 2, track: 30 });
    const z = g.zoneById(id);
    const loss = (sec) => {
      const h = pl.hp;
      // 不讓玩家失衡（失衡中的直擊補正會讓前後的傷害沒辦法比）
      const tk = () => {
        pl.acs = 0;
        pl.staggerT = 0;
      };
      tk();
      for (let k = 0; k < Math.round(sec / 0.1); k++) {
        window.__tick(0.1);
        tk();
      }
      return h - pl.hp;
    };
    // 光束每 0.25 秒（5 個 0.05 秒）結算一次：量的區間取 0.5 秒＝固定 2 次，前後才比得起來
    loss(0.5); // 追上目標
    const early = loss(0.5),
      mid = z.frac;
    loss(1.5);
    const late = loss(0.5);
    const fracFull = z.frac;
    // 中間放一道牆：斷開重來
    const mid2 = from.clone().lerp(pl.center(), 0.5);
    g.addTempWall(mid2.setY(g.world.terrainHeight(mid2.x, mid2.z)), {
      kind: 'rock',
      w: 8,
      h: 14,
      d: 2,
      life: 2,
    });
    window.__tick(0.3);
    const cut = z.frac;
    return { early, late, mid, fracFull, cut, id };
  });
  check(
    beam.early > 0 && beam.late > beam.early * 1.5 && beam.fracFull > 0.95 && beam.cut === 0,
    `追蹤光束：照越久越痛（${Math.round(beam.early)} → ${Math.round(beam.late)}／0.5 秒）、被障礙物斷開就重來（${beam.cut}）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.clearTempWalls();
    const z = g.zones.find((q) => q.k === 'beam');
    z.lockT = z.ramp * 0.6;
  });
  await wait(700);
  await shot('beam');
  // ---- 臨時障礙物：碰撞、擋子彈、打碎、到期崩落 ----
  const wall = await page.evaluate(async () => {
    const g = window.__game,
      pl = g.player,
      w = g.world;
    window.__clr();
    const p = window.__at(0, -9);
    const id = g.addTempWall(p, { kind: 'ice', w: 7, h: 4, d: 1.4, hp: 900, life: 60 });
    const W = g.tWalls.find((x) => x.i === id);
    const r = { obs: w.obstacles.includes(W.ob), occ: w.occluders.includes(W.ob) };
    const [cx, cz] = w.collide(p.x + 0.2, p.z + 0.3, p.y + 0.5, 1);
    r.pushed = Math.abs(cz - p.z) >= 0.7 + 1 - 0.01;
    r.hits = w.hitsWorld(p.clone().setY(p.y + 2));
    r.los = w.losBlocked(
      p.clone().add(new THREE.Vector3(0, 2, 5)),
      p.clone().add(new THREE.Vector3(0, 2, -5)),
    );
    // 玩家的子彈打在牆上
    pl.weapons.rarm.cd = 0;
    pl.fire('rarm', p.clone().setY(p.y + 2), null);
    const pr0 = g.projectiles[g.projectiles.length - 1];
    window.__Proj = pr0.constructor;
    // 地圖是隨機的：從牆前 3 m 射（中間不會有別的物件），地圖物件先移出可破壞清單
    for (const q of g.world.props || []) q.dead = true;
    const pr = new window.__Proj(g, {
      pos: p.clone().add(new THREE.Vector3(0, 2, 3)),
      vel: new THREE.Vector3(0, 0, -150),
      kind: 'bullet',
      dmg: 110,
      impactV: 50,
      team: 'player',
      owner: pl,
      life: 2,
    });
    g.projectiles.push(pr);
    for (let i = 0; i < 60 && !pr.dead; i++) pr.update(1 / 60);
    r.hp1 = W.hp;
    g.tempWallHitAt(p.clone().setY(p.y + 2), 2000, 3);
    r.broken = W.dead && !w.obstacles.includes(W.ob);
    // 岩牆到期崩落
    const id2 = g.addTempWall(window.__at(6, -9), { kind: 'rock', w: 5, h: 3, d: 1.6, life: 0.5 });
    const R = g.tWalls.find((x) => x.i === id2);
    for (let i = 0; i < 20; i++) g.tempWallsTick(0.05);
    r.expired = R.dead && !w.obstacles.includes(R.ob);
    return r;
  });
  check(
    wall.obs && wall.occ && wall.pushed && wall.hits && wall.los,
    '臨時障礙物：碰撞推開、擋子彈（hitsWorld）、擋視線、登記遮擋淡出',
  );
  check(wall.hp1 < 900 && wall.broken, `臨時障礙物：子彈打掉 ${900 - wall.hp1}、打碎後碰撞消失`);
  check(wall.expired, '臨時障礙物：到期崩落、碰撞消失');
  await wait(250);
  await shot('wall-break');
  await page.evaluate(() => {
    const g = window.__game;
    g.addTempWall(window.__at(-3, 8), { kind: 'ice', w: 7, h: 4, d: 1.4, hp: 900, life: 60 });
    g.tempWallsTick(0.5); // 升起完成再截圖
    g.addTempWall(window.__at(7, 5), {
      kind: 'rock',
      w: 6,
      h: 3.5,
      d: 1.6,
      hp: 900,
      life: 60,
      yaw: Math.PI / 2,
    });
    g.tempWallsTick(0.5);
  });
  await wait(900);
  await shot('walls');
  // ---- 可以打掉的投射物 ----
  const sh = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    const P = window.__Proj;
    const src = window.__mt;
    src.pos.copy(window.__at(0, -30));
    const at = window.__at(0, -16, 3);
    const m = new P(g, {
      pos: at,
      vel: new THREE.Vector3(0, 0, 0.5),
      kind: 'missile',
      dmg: 800,
      impactV: 300,
      team: 'enemy',
      owner: src,
      life: 30,
      splash: 3,
      shootable: 300,
      shotR: 1,
      popDmg: 0,
    });
    g.projectiles.push(m);
    const v0 = [g.fp, g.chase];
    g.fp = g.chase = false; // 俯視的鎖定順序（正面 180°）
    pl.yaw = 0;
    window.__mt.pos.copy(window.__at(2, -20));
    const lc = g.lockCands(pl);
    [g.fp, g.chase] = v0;
    const r = { lock: lc.includes(m.tgt), last: lc.at(-1) === m.tgt, n: lc.length };
    r.dest = g.destructibles('player').includes(m.tgt) && !g.destructibles('enemy').includes(m.tgt);
    pl.lock = m.tgt;
    g.damageProp(m.tgt, 120, 0, m.pos.clone());
    r.hp = m.hp;
    // 玩家的子彈擊落
    const hp0 = pl.hp;
    const from = m.pos.clone().add(new THREE.Vector3(0, 0, 1.5)); // 從近處射（地圖是隨機的：避開地圖物件）
    const b = new P(g, {
      pos: from,
      vel: m.pos.clone().sub(from).normalize().multiplyScalar(150),
      kind: 'bullet',
      dmg: 500,
      impactV: 50,
      team: 'player',
      owner: pl,
      life: 2,
    });
    g.projectiles.push(b);
    for (let i = 0; i < 90 && !m.dead; i++) b.dead || b.update(1 / 60);
    r.down = m.dead;
    r.noHurt = pl.hp === hp0;
    window.__mkShot = () => {
      const q = new P(g, {
        pos: window.__at(3, -10, 3),
        vel: new THREE.Vector3(0, 0, 0.01),
        kind: 'missile',
        dmg: 0,
        team: 'enemy',
        owner: src,
        life: 30,
        shootable: 300,
      });
      q.hp = 140;
      g.projectiles.push(q);
      pl.lock = q.tgt;
      return q;
    };
    window.__mkShot();
    return r;
  });
  check(
    sh.lock && sh.last && sh.dest && sh.hp === 180 && sh.down && sh.noHurt,
    `可以打掉的投射物：可以鎖定（排在敵人後面）、子彈打得到（${sh.hp}／300）、擊落（${sh.down}）`,
  );
  await wait(700);
  await shot('shootable');
  // ---- 多人的同步：房主送出的事件交給客機的處理（clientEvent）重建 ----
  const mp = await page.evaluate(() => {
    const g = window.__game;
    window.__clr();
    for (const q of g.projectiles) g.scene.remove(q.mesh);
    g.projectiles = [];
    const net0 = g.net,
      ev0 = g.netEvents,
      seq0 = g.projSeq;
    g.net = { role: 'host' };
    g.netEvents = [];
    g.projSeq = 0;
    g.addZone('smoke', window.__at(-6, 6), 5, 60);
    g.addZone('beam', window.__at(8, 8, 12), 0, 60, { target: g.player, dps0: 1, dps1: 2 });
    g.addTempWall(window.__at(0, 9), { kind: 'ice', w: 6, h: 4, d: 1.4, hp: 500, life: 60 });
    const m = new window.__Proj(g, {
      pos: window.__at(4, -12, 3),
      vel: new THREE.Vector3(0, 0, 0.01),
      kind: 'missile',
      dmg: 0,
      team: 'enemy',
      owner: window.__mt,
      life: 60,
      shootable: 300,
    });
    g.projectiles.push(m);
    g.damageProp(m.tgt, 120, 0, m.pos.clone());
    const evs = g.netEvents.slice();
    // 客機：清掉本機的狀態，只靠事件重建
    g.clearZones();
    g.clearTempWalls();
    for (const q of g.projectiles) g.scene.remove(q.mesh);
    g.projectiles = [];
    g.net = { role: 'client' };
    for (const e of evs) g.clientEvent(e);
    const sh = g.projectiles.find((q) => q.tgt);
    const W = (g.tWalls || [])[0];
    const r = {
      types: [...new Set(evs.map((e) => e.t))].sort().join(','),
      zones: (g.zones || [])
        .map((z) => z.k)
        .sort()
        .join(','),
      wall: !!W && g.world.obstacles.includes(W.ob),
      hp: sh ? sh.hp : -1,
      lock: !!sh && g.lockPool(g.player).includes(sh.tgt),
    };
    // 打碎與移除
    g.clientEvent({ t: 'twX', i: W.i, b: 1 });
    g.clientEvent({ t: 'zclr' });
    r.after = (g.tWalls || []).length + (g.zones || []).length;
    for (const q of g.projectiles) g.scene.remove(q.mesh);
    g.projectiles = [];
    g.net = net0;
    g.netEvents = ev0;
    g.projSeq = seq0;
    return r;
  });
  check(
    mp.zones === 'beam,smoke' && mp.wall && mp.hp === 180 && mp.lock && mp.after === 0,
    `多人：房主的事件（${mp.types}）在客機重建區域效果、臨時障礙物（碰撞）、投射物的血條與鎖定，打碎與清除也同步`,
  );
  // ---- laserK：雷射類 30%、鎖定提示 ----
  const lz = await page.evaluate(async () => {
    const g = window.__game,
      pl = g.player;
    window.__clr();
    for (const q of g.projectiles) g.scene.remove(q.mesh);
    g.projectiles = [];
    const e = g.spawnType('scav', 1, 1, window.__at(0, -12), 1);
    e.updateAI = () => {};
    e.laserK = 0.3;
    const hit = (wid) => {
      e.hp = e.maxHp = 1e6;
      e.iFrames = 0;
      e.staggerT = 0;
      e.takeDamage(1000, 0, pl, e.center(), null, undefined, wid);
      return 1e6 - e.hp;
    };
    const r = {
      lr: hit('w_lr'),
      lc: hit('bw_lc'),
      lsg: hit('w_lsg'),
      emp: hit('w_emp'),
      kin: hit('w_rifle'),
    };
    e.laserK = 1;
    r.lr1 = hit('w_lr');
    e.laserK = 0.3;
    for (let i = 0; i < 60 && !document.getElementById('lockHint').textContent.includes('雷射'); i++) {
      pl.lock = e;
      await new Promise((res) => setTimeout(res, 100));
    }
    r.hint = document.getElementById('lockHint').textContent;
    return r;
  });
  check(
    Math.abs(lz.lr / lz.lr1 - 0.3) < 0.02 && lz.lc < lz.lr1 * 0.5 && lz.lsg < 400 && lz.emp > lz.lr * 2,
    `laserK：雷射步槍 ${lz.lr}／${lz.lr1}、背雷射砲、雷射霰彈也減，電磁槍不減（${lz.emp}）`,
  );
  check(/雷射 30%/.test(lz.hint) && /弱：實彈/.test(lz.hint), `鎖定提示顯示「雷射 30%」與弱點（${lz.hint}）`);
  // ---- 受損三階段與擊破碎片（現有的專屬敵人臨時加 rig.dmg）----
  const dmgSetup = await page.evaluate(() => {
    const g = window.__game,
      pl = g.player;
    for (const q of g.enemies) if (q !== window.__mt && q.etype === 'scav') q.mesh.visible = false; // 拾荒 MT 讓開
    const e = g.spawnType('junk', 1, 1, window.__at(3, 7), 1);
    e.updateAI = (dt) => e.specialFx(dt); // 不移動、只演出
    g.clearTempWalls();
    const gc = document.getElementById('goalCard');
    if (gc) gc.style.visibility = 'hidden'; // 過關條件卡片擋住畫面
    e.hp = e.maxHp = 10000;
    window.__dmgE = e;
    const G = e.model.group;
    const mk = (w, h, d, x, y, z, c) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c }));
      m.position.set(x, y, z);
      return m;
    };
    const plates = [mk(1.4, 1, 0.15, 0, 2, 2.1, 0xd0a020), mk(0.15, 1, 1.4, 2.2, 2, 0, 0xd0a020)];
    const chunks = [];
    for (let i = 0; i < 4; i++) {
      const ch = new THREE.Group();
      ch.add(mk(1.2, 1, 1.2, 0, 0, 0, 0x6a6a70));
      ch.position.set(Math.cos(i * 1.57) * 1.2, 1.5, Math.sin(i * 1.57) * 1.2);
      chunks.push(ch);
    }
    const sub = new THREE.Group();
    sub.add(...plates, ...chunks);
    G.add(sub);
    e.model.dmg = {
      smoke: [
        [0, 3, 0],
        [1, 2.5, 1],
      ],
      plates,
      chunks,
    };
    e.hp = 4500;
    return true;
  });
  check(dmgSetup, '受損測試：在廢鐵合成體加上 rig.dmg');
  await wait(1200);
  await shot('dmg-smoke');
  const st2 = await page.evaluate(() => {
    const g = window.__game,
      e = window.__dmgE;
    const smokes = g.fx.list.length;
    e.hp = 2000;
    for (let i = 0; i < 10; i++) e.specialFx(0.05);
    return { smokes, off: e.model.dmg.plates.every((m) => m.parent === g.scene) };
  });
  check(st2.smokes > 0 && st2.off, `受損：AP 50% 以下冒煙、25% 以下裝甲板脫落（${st2.off}）`);
  await wait(500);
  await shot('dmg-sparks');
  const st3 = await page.evaluate(() => {
    const g = window.__game,
      e = window.__dmgE;
    const p0 = e.model.dmg.chunks.map((c) => c.getWorldPosition(new THREE.Vector3()));
    e.takeDamage(1e9, 0, g.player, e.center());
    return { dead: e.dead, out: e.model.dmg.chunks.every((c) => c.parent === g.scene), p0 };
  });
  await wait(600);
  await shot('dmg-chunks');
  const moved = await page.evaluate((p0) => {
    const e = window.__dmgE;
    return e.model.dmg.chunks.map((c, i) =>
      c.position.distanceTo(new THREE.Vector3(p0[i].x, p0[i].y, p0[i].z)),
    );
  }, st3.p0);
  check(
    st3.dead && st3.out && moved.every((d) => d > 0.3),
    `擊破：chunks 拆下飛散（${moved.map((d) => d.toFixed(1)).join('／')} m）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.clearMission();
    g.state = 'title';
  });
  await ctx.close();
}

// 狀態效果的多人同步：房主套到客機的機體上 → 客機的 HUD、3D 效果、移動預測；客機 QB 掙脫鉤住、房主割開網
async function testMpStatus(browser, url) {
  console.log('多人狀態效果：客機看到鉤住與捕獲網、QB 掙脫同步');
  // 頁面忙或在背景時 playwright 的點擊會等不到畫面更新：直接呼叫元素的 click()
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 680 } });
  const host = await ctx.newPage();
  const cli = await ctx.newPage();
  watch(host, 'mpstatus:host');
  watch(cli, 'mpstatus:client');
  await host.goto(url, { timeout: 90000 });
  await cli.goto(url, { timeout: 90000 });
  await host.$eval('#btnMP', (b) => b.click());
  await setNick(host, 'HOST');
  await host.$eval('#btnMPHost', (b) => b.click());
  await waitVisible(host, 'lobby');
  await host.check('#mpAuto');
  await host.dispatchEvent('#mpAuto', 'change');
  await cli.$eval('#btnMP', (b) => b.click());
  await setNick(cli, 'CLIENT');
  await wait(1000);
  await cli.$eval('#btnMPList', (b) => b.click());
  await cli.waitForSelector('#mpRooms .part', { timeout: 15000 });
  await cli.$eval('#mpRooms .part', (b) => b.click());
  await waitVisible(cli, 'lobby', 15000);
  await cli.evaluate(() => (window.__game.hostLostMs = 15000));
  await cli.$eval('#btnLobbyReady', (b) => b.click());
  await wait(500);
  await host.$eval('#btnLobbyReady', (b) => b.click());
  await wait(500);
  await host.$eval('#btnLobbySortie', (b) => b.click());
  await cli.bringToFront(); // 客機在背景太久會被當成斷線
  await cli.evaluate(() => (window.__game.hostLostMs = 60000)); // 負載高時房主開局可能卡很久
  const ok = (await waitVisible(host, 'hudWrap', 20000)) && (await waitVisible(cli, 'hudWrap', 20000));
  await cli.bringToFront();
  await host.evaluate(() => (window.requestAnimationFrame = () => 0));
  const pump = async (n) => {
    for (let i = 0; i < n; i++) {
      await host.evaluate(() => window.__game.loop()).catch(() => {});
      await wait(20);
    }
  };
  await pump(20);
  // 房主：敵人停住、放在客機旁邊，把客機的機體鉤住
  await host.evaluate(() => {
    const g = window.__game;
    g.waves = [];
    g.wavePend = null;
    for (const p of g.players) p.hp = p.maxHp = 1e7;
    const c = g.players.find((p) => !p.isPlayer);
    const src = g.enemies[0];
    for (const e of g.enemies) e.updateAI = () => {};
    src.hp = src.maxHp = 1e8;
    src.pos.set(c.pos.x + 25, g.world.groundAt(c.pos.x + 25, c.pos.z, 99), c.pos.z);
    src.mesh.position.copy(src.pos);
    c.addStatus('hook', 4, { src: src.id, pull: 14 });
  });
  await pump(15);
  const a = await cli.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const el = document.querySelector('#stsHud .stsI[data-k="hook"]');
    return {
      sts: !!(p.sts && p.sts.hook),
      cable: !!(p.stsV && p.stsV.hook && p.stsV.hook.cable.visible),
      hud: el ? el.querySelector('small').textContent : '',
    };
  });
  check(ok && a.sts && a.cable && /QB 掙脫/.test(a.hud), `多人：客機收到鉤住、畫出鋼索、HUD「${a.hud}」`);
  await cli.screenshot({ path: path.join(SHOT_DIR, 'status-mp-hook-client.png') });
  // 客機按 QB 掙脫（客機自己先預測解除，房主收到輸入後也解除）
  await cli.keyboard.down('ShiftLeft');
  await pump(4);
  await cli.keyboard.up('ShiftLeft');
  await pump(15);
  const esc = await host.evaluate(() => !window.__game.players.find((p) => !p.isPlayer).hasStatus('hook'));
  const escC = await cli.evaluate(() => !window.__game.player.hasStatus('hook'));
  check(esc && escC, '多人：客機 QB 掙脫鉤住（房主與客機都解除）');
  // 捕獲網：房主套上 → 客機的 HUD 與網；客機的移動預測也變慢
  await host.evaluate(() => {
    const g = window.__game;
    return g.players.find((p) => !p.isPlayer).addStatus('net', 4);
  });
  await pump(15);
  const n = await cli.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const el = document.querySelector('#stsHud .stsI[data-k="net"]');
    return {
      sts: !!(p.sts && p.sts.net),
      mesh: !!(p.stsV && p.stsV.net),
      k: p.sts ? p.stsSpeedK() : 1,
      noJump: p.stsNoJump(),
      hud: el ? el.querySelector('small').textContent : '',
    };
  });
  check(
    n.sts && n.mesh && n.k < 0.7 && n.noJump && /近戰割開/.test(n.hud),
    `多人：客機的捕獲網（HUD「${n.hud}」、移動預測變慢、不能跳）`,
  );
  await cli.screenshot({ path: path.join(SHOT_DIR, 'status-mp-net-client.png') });
  await host.evaluate(() => window.__game.players.find((p) => !p.isPlayer).statusMelee());
  await pump(15);
  const cut = await cli.evaluate(() => {
    const g = window.__game;
    g.drawHud(1 / 60);
    return !g.player.sts && getComputedStyle(document.getElementById('stsHud')).display === 'none';
  });
  check(cut, '多人：房主那邊割開網 → 客機的狀態與 HUD 解除');
  await ctx.close();
}

// 第 1、2 章主題專屬敵人的模型（D1）：模型庫檢視窗的斜角／正面／側面截圖與三角面數
// 截圖 test-results/foe-d1-<tag>-<key>-<視角>.png（FOE_D1_TAG 預設 after），三角面數寫到 foe-d1-<tag>.json
const FOE_D1 = [
  'cart',
  'crystal_drone',
  'driller',
  'junk',
  'burrower',
  'jammer',
  'crane',
  'forklift',
  'gate_turret',
  'patrol_cart',
  'gunboat',
  'sprayer',
];
async function testFoeModelsD1(browser, base) {
  console.log('第 1、2 章的主題專屬敵人模型（三視角、三角面數）');
  const tag = process.env.FOE_D1_TAG || 'after';
  const { ctx, page } = await newPage(browser, 'foe-d1');
  const tris = {};
  for (const key of FOE_D1) {
    await reopen(page, `${base}model-library.html?test#vehicle/foe_${key}`);
    const ok = await page.waitForSelector('#inspect:not([hidden])', { timeout: 15000 }).then(
      () => true,
      () => false,
    );
    if (!ok) {
      check(false, `${key}：開啟檢視窗`);
      continue;
    }
    await wait(1800);
    await page.addStyleTag({ content: '#insLabels{display:none}' });
    const info = (await page.textContent('#insInfo')) || '';
    const m = info.match(/三角面\s*([\d,]+)/);
    tris[key] = m ? +m[1].replace(/,/g, '') : -1;
    const box = await page.$eval('#insGl', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const shot = (v) =>
      page.screenshot({ path: path.join(SHOT_DIR, `foe-d1-${tag}-${key}-${v}.png`), clip: box });
    // 固定視角（遊戲的正面是 −Z）；最後一張是預警的姿勢（rig.animD1，warn＝1）
    const view = async (dir, warn) => {
      await page.evaluate(
        ([dir, warn]) => {
          const ins = window.__inspect;
          const t = ins.controls.target;
          const d = ins.d1Dist || (ins.d1Dist = ins.camera.position.distanceTo(t) * 0.8);
          ins.camera.position.copy(t).addScaledVector(new THREE.Vector3(...dir).normalize(), d);
          ins.controls.update();
          const rig = ins.main && ins.main.built && ins.main.built.rig;
          if (warn && rig && rig.animD1)
            for (let i = 0; i < 10; i++)
              rig.animD1(rig, { t: 1 + i * 0.05, dt: 0.05, warn: 1, atk: 0, fwd: 0, vis: 3, remote: true });
        },
        [dir, warn],
      );
      await wait(600);
    };
    await view([0.8, 0.45, -0.9]);
    await shot('angle');
    await view([0, 0.2, -1]);
    await shot('front');
    await view([1, 0.15, 0]);
    await shot('side');
    if (tag !== 'before') {
      await view([0.8, 0.45, -0.9], true);
      await shot('warn');
    }
    check(tris[key] > 0, `${key}：三角面 ${tris[key]}`);
  }
  fs.writeFileSync(path.join(SHOT_DIR, `foe-d1-${tag}.json`), JSON.stringify(tris, null, 1));
  if (tag === 'before') return ctx.close();
  // 遊戲內的預警姿勢：在沒有敵人的區段把各台排在玩家前方，停掉 AI、強制預警，截圖並檢查受損資料
  await reopen(page, base + '?test');
  await waitVisible(page, 'title');
  const groups = [
    ['drill', 'junk', 'cart', 'crystal', 'jammer', 'burrow'],
    ['forklift', 'gategun', 'patrol', 'gunboat', 'sprayer', 'crane'],
  ];
  for (let gi = 0; gi < groups.length; gi++) {
    const res = await page.evaluate(
      ([keys, first]) => {
        const g = window.__game;
        if (first) {
          g.campBegin('c1s1');
          g.campSortie().segs[0].theme = 'industrial';
          g.camp.plan[0] = { ...g.camp.plan[0], variant: 'railyard', landmark: '' };
          g.camp.types[0] = 'supply';
          g.campEnterSeg();
          g.world.obstacles.length = 0;
        }
        for (const e of g.enemies) e.dead = true;
        for (const e of g.enemies) e.mesh.visible = false;
        g.waves = [];
        g.wavePend = null;
        const p = g.player;
        p.hp = p.maxHp = 1e6;
        const fx = -Math.sin(p.yaw),
          fz = -Math.cos(p.yaw);
        const out = [];
        keys.forEach((k, i) => {
          const far = k === 'crane' ? 24 : 9;
          const side = (i - (keys.length - 1) / 2) * (k === 'crane' ? 0 : 6.5);
          const x = p.pos.x + fx * far - fz * side,
            z = p.pos.z + fz * far + fx * side;
          const e = g.spawnType(k, 1, 1, new THREE.Vector3(x, g.world.terrainHeight(x, z), z));
          e.updateAI = () => {};
          e.bossVis = 0;
          e.yaw = Math.atan2(fx, fz); // 面向玩家
          const f = e.model.animD1;
          if (f) e.model.animD1 = (r, st) => f(r, { ...st, warn: 1 });
          const d = e.model.dmg || {};
          out.push(
            `${k}:${f ? 'anim' : '-'}/${(d.smoke || []).length}/${(d.plates || []).length}/${(d.chunks || []).length}`,
          );
        });
        return out;
      },
      [groups[gi], gi === 0],
    );
    await wait(6000); // 等開場的橫幅退場
    await page.screenshot({ path: path.join(SHOT_DIR, `foe-d1-game-warn-${gi + 1}.png`) });
    const ok = res.every((r) => {
      const [, a, s, pl, ch] = r.match(/^\w+:(\w+|-)\/(\d+)\/(\d+)\/(\d+)$/) || [];
      return a === 'anim' && +s >= 1 && +pl >= 2 && +ch >= 3;
    });
    check(ok, `遊戲內的預警姿勢與受損資料（${res.join('、')}）`);
  }
  await ctx.close();
}

// 第 3～6 章的專屬敵人模型（D2）：三角形預算、受損資料（冒煙點、脫落的裝甲板、擊破時拆開的群組）、
// 房主把行為狀態寫進 bossVis 的高位、客機依旗標擺出預警／攻擊的動作；各台在遊戲裡的待機與預警截圖
async function testFoeModelsD2(browser, base) {
  console.log('第 3～6 章專屬敵人的模型：細節、受損資料、待機／預警／攻擊的動作');
  const { ctx, page } = await newPage(browser, 'foe-d2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const dir = path.join(SHOT_DIR, 'foe-d2');
  fs.mkdirSync(dir, { recursive: true });
  // [主題, 種類, 預警／攻擊的旗標（FB_D2：16 開火、32 預警、64 攻擊；試車台用低位 2＝噴火）, 離地高度]
  const LIST = [
    ['snow', 'lurker', 48, 0],
    ['snow', 'skater', 16, 0],
    ['institute', 'blob', 32, 0],
    ['institute', 'chimera', 32, 0],
    ['institute', 'laserpost', 32, 0],
    ['grid086', 'crawler', 48, 0],
    ['grid086', 'underturret', 16, 3],
    ['spaceport', 'testrig', 2, 0],
    ['spaceport', 'spacemt', 16, 0],
    ['xylem', 'rammer', 64, 3],
    ['xylem', 'flak', 112, 0],
    ['orbit', 'vacuum', 16, 3],
    ['orbit', 'marker', 32, 4],
  ];
  let theme = '';
  const res = [];
  for (const [th, key, bits, lift] of LIST) {
    if (th !== theme) {
      theme = th;
      await page.evaluate((th) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = th;
        g.camp.plan[0] = { ...g.camp.plan[0], variant: '', landmark: '' };
        g.camp.types[0] = 'supply';
        g.campEnterSeg();
        g.player.hp = g.player.maxHp = 1e6;
      }, th);
    }
    const r = await page.evaluate(
      ([key, bits, lift]) => {
        const g = window.__game,
          p = g.player,
          w = g.world;
        g.state = 'hub'; // 只畫畫面，不跑 AI
        for (const e of g.enemies) if (!e.dead && e.ai !== 'objective') e.depart();
        const x = p.pos.x,
          z = p.pos.z - 10;
        const e = g.spawnType(key, 1, 1, new THREE.Vector3(x, w.groundAt(x, z, p.pos.y + 4), z), 1);
        e.pos.y += lift;
        e.yaw = Math.PI * 0.85;
        e.mesh.position.copy(e.pos);
        e.mesh.rotation.y = e.yaw;
        const m = e.model;
        // 三角形（不含描邊、加色特效）
        let tris = 0;
        e.mesh.updateMatrixWorld(true);
        e.mesh.traverseVisible((o) => {
          if (
            !o.isMesh ||
            o.material.type === 'ShaderMaterial' ||
            o.material.blending === THREE.AdditiveBlending
          )
            return;
          const gg = o.geometry;
          tris += (gg.index ? gg.index.count : gg.attributes.position.count) / 3;
        });
        // 房主：行為狀態 → 旗標（試車台的 ph 保留在低位）
        let hostBits = null;
        if (key === 'rammer') {
          e.aiState.ph = 1;
          e.specialFx(1 / 60);
          hostBits = e.bossVis;
          e.aiState.ph = 0;
        }
        if (key === 'testrig') {
          e.bossVis = 1;
          e.specialFx(1 / 60);
          hostBits = e.bossVis;
        }
        const c = e.center();
        const cam = g.camera;
        const R = Math.max(5, (m.height || 2) * 2.4);
        const fx = -Math.sin(e.yaw),
          fz = -Math.cos(e.yaw); // 從正面斜前方看
        cam.position.set(c.x + R * (0.9 * fx - 0.6 * fz), c.y + R * 0.45, c.z + R * (0.9 * fz + 0.6 * fx));
        cam.lookAt(c);
        window.__d2 = e;
        const d = m.dmg || {};
        return {
          anim: typeof m.anim_d2 === 'function',
          tris: Math.round(tris),
          smoke: (d.smoke || []).length,
          plates: (d.plates || []).filter((q) => q.isMesh).length,
          chunks: (d.chunks || []).filter((q) => q.isObject3D && q.parent === m.torso).length,
          hostBits,
        };
      },
      [key, bits, lift],
    );
    // 待機 → 預警／攻擊（客機的方式：只看 bossVis）
    for (const [tag, b] of [
      ['rest', 0],
      ['act', bits],
    ]) {
      await page.evaluate((b) => {
        const e = window.__d2;
        e.remote = true;
        for (let i = 0; i < 40; i++) {
          e.t += 1 / 30;
          e.bossVis = b;
          e.specialFx(1 / 30);
        }
      }, b);
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(dir, `game-${key}-${tag}.png`) });
    }
    await page.evaluate(() => {
      const e = window.__d2;
      e.remote = false;
      e.depart();
    });
    res.push(key + ':' + r.tris);
    const cap = key === 'chimera' ? 12000 : 6000;
    check(
      r.anim &&
        r.tris > 0 &&
        r.tris <= cap &&
        r.smoke >= 1 &&
        r.plates >= 1 &&
        r.chunks >= 3 &&
        r.chunks <= 5,
      `${key}：動作、三角形 ${r.tris}（≤ ${cap}）、冒煙點 ${r.smoke}、脫落板 ${r.plates}、拆塊 ${r.chunks}`,
    );
    if (key === 'rammer') check((r.hostBits & 32) > 0, '衝撞無人機：房主把預警寫進 bossVis 的高位');
    if (key === 'testrig')
      check((r.hostBits & 3) === 1, '推進器試車台：bossVis 的低位（行為端的 ph）保留（' + r.hostBits + '）');
  }
  console.log('    三角形：' + res.join('、'));
  await ctx.close();
}

// 地圖專屬敵人擴充 B1（第 1 章）：魚叉拖車、煙幕投射車、沙脊狙擊機、旋風產生機、坍方爆破手、礦燈哨兵
// 每種在對應主題出擊生成、逐格推進觸發一次招式，截圖預警與命中；模型庫三個角度截圖；三角形預算
async function testFoesB1(browser, base) {
  console.log('地圖專屬敵人 B1：荒野／沙丘／礦坑的新敵人（招式、預警、弱點、模型）');
  const { ctx, page } = await newPage(browser, 'foes-b1');
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 主迴圈停住、亂數固定（同 testFoesC1／C2）：地圖種子固定之後剩下的變數是亂數——沙脊狙擊機挑稜線
  // （ridge_b1）用 Math.random（以前挑到射線剛好擦過稜線的位置時，開始瞄準後砲口一動就被擋住、0.3 秒後中斷；
  // 現在選位與瞄準都用架好槍時的砲口＋容差檢查）；截圖前改推進固定的時間
  await freezeLoop(page);
  const ev = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        window.__reseed(5150);
        return (0, eval)('(' + src + ')')(a);
      },
      [fn.toString(), arg],
    );
  const enter = (theme, variant) =>
    ev(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.camp.seeds[0] = 5150; // 固定地圖（招式的射線與彈道每次都一樣）
        g.campEnterSeg();
        g.state = 'foe-test';
        const p = g.player;
        p.hp = p.maxHp = 1e6;
        // 狀態效果（A1）與場上機制（A2）：記錄呼叫（還沒合併時只記錄）
        window.__b1 = { st: [], clr: [], zone: [], mv: 0, rm: [], wall: [] };
        const L = window.__b1;
        const add0 = p.addStatus,
          clr0 = p.clearStatus;
        p.addStatus = function (k, ...a) {
          L.st.push(k);
          return add0 ? add0.call(this, k, ...a) : undefined;
        };
        p.clearStatus = function (k) {
          L.clr.push(k);
          return clr0 ? clr0.call(this, k) : undefined;
        };
        const z0 = g.addZone,
          m0 = g.moveZone,
          r0 = g.removeZone,
          w0 = g.addTempWall;
        g.addZone = function (k, ...a) {
          L.zone.push(k);
          return z0 ? z0.call(this, k, ...a) : L.zone.length;
        };
        g.moveZone = function (...a) {
          L.mv++;
          return m0 ? m0.apply(this, a) : undefined;
        };
        g.removeZone = function (id) {
          L.rm.push(id);
          return r0 ? r0.call(this, id) : undefined;
        };
        g.addTempWall = function (pos, o) {
          L.wall.push(o && o.kind);
          return w0 ? w0.call(this, pos, o) : undefined;
        };
        // 主迴圈不跑 AI，逐格推進
        window.__step = (ents, n, stop) => {
          const p = g.player;
          for (let i = 0; i < n; i++) {
            g.time += 1 / 60;
            p.iFrames = 0;
            p.hp = Math.max(p.hp, 1e5);
            p.vel.set(0, p.vel.y, 0); // 玩家站著不動（預判落點固定）
            for (const e of ents)
              if (!e.dead) {
                if (e.sn) {
                  e.sn.st = 2;
                  e.sn.tok = true;
                }
                e.updateAI(1 / 60);
              }
            for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
            g.projectiles = g.projectiles.filter((q) => !q.dead);
            if (g.updateHazards) g.updateHazards(1 / 60);
            g.hazards2Tick(1 / 60); // 區域效果、臨時障礙物
            g.fx.update(1 / 60);
            if (stop && stop()) return i;
          }
          return n;
        };
        // 生成點：要求的方向與距離附近、地面（不在物件上）、看得到玩家的位置（地圖是隨機的）
        window.__at = (dx, dz) => {
          const w = g.world,
            R = Math.hypot(dx, dz),
            a0 = Math.atan2(dz, dx);
          for (let i = 0; i < 72; i++) {
            const a = a0 + (i % 18) * 0.35,
              r = R * (1 - Math.floor(i / 18) * 0.15);
            const x = p.pos.x + Math.cos(a) * r,
              z = p.pos.z + Math.sin(a) * r;
            const h = w.terrainHeight(x, z);
            if (!w.inZone(x, z, 4) || w.groundAt(x, z, h + 4) > h + 0.5) continue;
            if (w.losBlocked(new THREE.Vector3(x, h + 2.5, z), p.center())) continue;
            return new THREE.Vector3(x, h, z);
          }
          return new THREE.Vector3(p.pos.x + dx, w.terrainHeight(p.pos.x + dx, p.pos.z + dz), p.pos.z + dz);
        };
        // 截圖用：暫停（只畫面）、鏡頭框住玩家與敵人
        window.__frame = (e, k = 1) => {
          const a = p.pos,
            b = e.pos;
          const mid = a.clone().lerp(b, 0.5);
          const d = a.distanceTo(b);
          const dir = b.clone().sub(a).setY(0).normalize();
          const side = new THREE.Vector3(-dir.z, 0, dir.x);
          g.state = 'pause';
          document.querySelectorAll('.screen').forEach((s) => s.classList.remove('on'));
          g.camera.position
            .copy(mid)
            .addScaledVector(side, (d * 0.55 + 9) * k)
            .add(new THREE.Vector3(0, d * 0.35 + 7, 0))
            .addScaledVector(dir, -4);
          g.camera.lookAt(mid.clone().add(new THREE.Vector3(0, 2, 0)));
        };
        // 新地圖先跑幾格主迴圈（更新與算繪），以前是靠兩次 evaluate 之間的實際幾格
        window.__pump(0.25);
      },
      [theme, variant],
    );
  const shot = async (name) => {
    await ev(() => window.__pump(0.5)); // 暫停中（__frame）只算繪
    await page.screenshot({ path: path.join(SHOT_DIR, 'foe-b1-' + name + '.png') });
  };
  // 截圖之後維持暫停：主迴圈不跑 AI（否則招式會在兩次 evaluate 之間以實際時間跑完），一律由 __step 推進
  const resume = () => ev(() => (window.__game.state = 'pause'));

  // ---- 荒野：魚叉拖車 ----
  await enter('wasteland', '');
  const hp1 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.spawnType('harpoon', 1, 1, window.__at(0, -22), 1);
    window.__e = e;
    let warn = false;
    window.__step([e], 600, () => (warn = e.bossVis === 1));
    if (warn) window.__frame(e);
    return { warn, res: e.res, name: e.name };
  });
  check(hp1.warn && hp1.res && hp1.res[1] < 0, '魚叉拖車：鉤頭發紅光的預警（弱點爆發）');
  await shot('harpoon-warn');
  await resume();
  const hp2 = await ev(() => {
    const g = window.__game,
      e = window.__e;
    let hooked = false;
    window.__step([e], 2000, () => (hooked = e.aiState.hk === 'hook')); // 鉤頭撞到物件時下一輪再射
    let pull = 0;
    if (hooked) {
      const p = g.player,
        d0 = p.pos.distanceTo(e.pos);
      for (let k = 0; k < 20; k++) p.move(1 / 60, new THREE.Vector3(), false, false, false, null);
      pull = +(d0 - p.pos.distanceTo(e.pos)).toFixed(2);
      window.__frame(e);
    }
    return {
      hooked,
      real: g.player.hasStatus('hook'),
      pull,
      st: window.__b1.st.slice(),
      vis: e.bossVis,
      dbg: { hk: e.aiState.hk, miss: e.aiState.hkMiss, t: e.aiState.hkT, d: e.pos.distanceTo(g.player.pos) },
    };
  });
  check(
    hp2.hooked && hp2.st.includes('hook') && hp2.real && hp2.pull > 0.3 && hp2.vis === 3,
    '魚叉拖車：鋼索鉤命中 → hook 狀態效果、玩家被拉過去（' +
      hp2.pull +
      ' m）、捲揚機收回' +
      (hp2.hooked ? '' : JSON.stringify(hp2.dbg)),
  );
  await shot('harpoon-hook');
  await resume();
  const hp3 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      p = g.player;
    if (e.aiState.hk !== 'hook') return { cut: 0 };
    e.takeDamage(e.maxHp * 0.2, 0, p, e.center(), new THREE.Vector3(0, 0, 1), undefined, undefined, 'exp');
    window.__step([e], 2);
    const r = { cut: e.aiState.cut || 0, clr: window.__b1.clr.includes('hook'), hk: e.aiState.hk };
    e.takeDamage(1e9, 0, p, e.center(), new THREE.Vector3(0, 0, 1));
    return r;
  });
  check(hp3.cut === 1 && hp3.clr && hp3.hk === 'reload', '魚叉拖車：鉤住時打它，鋼索斷掉並解除 hook');
  // ---- 荒野：煙幕投射車 ----
  const sm1 = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('smoker', 1, 1, window.__at(-6, -26), 1);
    window.__e = e;
    let warn = false;
    window.__step([e], 600, () => (warn = e.bossVis === 1));
    window.__step([e], 40);
    if (warn) window.__frame(e);
    return { warn };
  });
  check(sm1.warn, '煙幕投射車：發射架抬起並發光的預警');
  await shot('smoker-warn');
  await resume();
  const sm2 = await ev(() => {
    const e = window.__e;
    let shot = false;
    window.__step([e], 200, () => (shot = (e.aiState.shots || 0) > 0));
    window.__step([e], 30);
    window.__frame(e);
    return { shot };
  });
  await shot('smoker-land');
  await resume();
  const sm3 = await ev(() => {
    const g = window.__game,
      e = window.__e;
    window.__step([e], 200, () => (e.aiState.smoked || 0) > 0);
    const r = { smoked: e.aiState.smoked || 0, zone: window.__b1.zone.includes('smoke') };
    // 煙裡的敵人：不能鎖定、視線不通
    const z = (g.zones || []).find((q) => q.k === 'smoke');
    if (z) {
      for (let k = 0; k < 40; k++) g.hazards2Tick(1 / 60); // 煙霧濃起來
      const p = g.player;
      const at = z.p.clone();
      at.y = g.world.groundAt(at.x, at.z, at.y + 2);
      const t = g.spawnType('mt', 1, 1, at, 1);
      t.updateAI = () => {};
      p.yaw = p.aimYaw = Math.atan2(-(t.pos.x - p.pos.x), -(t.pos.z - p.pos.z)); // 面向它
      r.inSmoke = g.inSmoke(t.center());
      r.lockable = g.lockCands(p).includes(t);
      r.los = !g.world.losBlocked(p.center(), t.center());
      g.clearZones(); // 對照：煙散掉之後鎖定得到
      r.after = g.lockCands(p).includes(t);
      t.takeDamage(1e9, 0, p, t.center(), new THREE.Vector3(0, 0, 1));
    }
    e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    return r;
  });
  check(sm2.shot && sm3.smoked === 1 && sm3.zone, '煙幕投射車：灰色落點圈 → 落地生成煙幕（smoke 區域）');
  check(
    sm3.inSmoke && !sm3.lockable && !sm3.los && sm3.after,
    '煙幕投射車：煙裡的敵人不能鎖定、視線不通（' + JSON.stringify(sm3) + '）',
  );

  // ---- 沙丘：沙脊狙擊機 ----
  await enter('dunes', '');
  const rs1 = await ev(() => {
    const g = window.__game,
      w = g.world;
    g.clearZones(); // 前面留下的煙霧不擋住這一段
    g.clearTempWalls();
    const e = g.spawnType('ridgesniper', 1, 1, window.__at(10, -45), 1);
    window.__e = e;
    window.__step([e], 2);
    const x = e.pos.x,
      z = e.pos.z;
    let m = 0;
    for (const [dx, dz] of [
      [7, 0],
      [-7, 0],
      [0, 7],
      [0, -7],
    ])
      m += w.terrainHeight(x + dx, z + dz) / 4;
    const ridge = w.terrainHeight(x, z) - m;
    let aim = false;
    window.__step([e], 1200, () => (aim = !!(e.bossVis & 1)));
    window.__step([e], 50);
    if (aim) window.__frame(e, 0.8);
    return { ridge, aim, prone: !!(e.bossVis & 4), bx: !!e.bx, res: e.res };
  });
  check(
    rs1.aim && rs1.prone && rs1.bx && rs1.res[2] < 0,
    '沙脊狙擊機：趴在稜線（比周圍高 ' + rs1.ridge.toFixed(1) + ' m），藍色瞄準線（弱點能量）',
  );
  await shot('sniper-aim');
  await resume();
  const rs2 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      p = g.player;
    const h0 = p.hp;
    let fired = false;
    window.__step([e], 700, () => (fired = (e.aiState.hits || 0) > 0));
    const dmg = h0 - p.hp;
    if (fired) window.__frame(e, 0.8);
    return {
      fired,
      dmg,
      hits: e.aiState.hits || 0,
      sts: Object.keys(p.sts || {}),
      zones: (g.zones || []).map((z) => z.k),
    };
  });
  check(
    rs2.fired && rs2.dmg > 300,
    '沙脊狙擊機：瞄準 1.5 秒後一擊（' + Math.round(rs2.dmg) + '）' + JSON.stringify(rs2),
  );
  await shot('sniper-hit');
  await resume();
  const rs3 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      w = g.world;
    e.aiState.rsT = 0;
    e.aiState.rsGoal = null;
    const b0 = e.aiState.broken || 0,
      h1 = e.aiState.hits || 0;
    let aim = false;
    window.__step([e], 300, () => (aim = !!e.aiState.aim));
    const lb = w.losBlocked;
    w.losBlocked = () => true; // 躲到沙丘後面
    window.__step([e], 40);
    w.losBlocked = lb;
    const r = { aim, broken: (e.aiState.broken || 0) - b0, hits: (e.aiState.hits || 0) - h1 };
    e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    return r;
  });
  check(rs3.aim && rs3.broken === 1 && rs3.hits === 0, '沙脊狙擊機：射線被擋住時中斷瞄準');
  // ---- 沙丘：旋風產生機 ----
  const tw1 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.spawnType('twister', 1, 1, window.__at(0, -24), 1);
    window.__e = e;
    let warn = false;
    window.__step([e], 600, () => (warn = e.bossVis === 1));
    window.__step([e], 40);
    window.__frame(e);
    return { warn };
  });
  check(tw1.warn, '旋風產生機：葉片打開、噴出環發光的預警');
  await shot('twister-warn');
  await resume();
  const tw2 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      p = g.player;
    const h0 = p.hp;
    let hit = false;
    window.__step([e], 600, () => (hit = !!(e.aiState.tw && e.aiState.tw.hits > 2)));
    const r = {
      hit,
      dmg: h0 - p.hp,
      zone: window.__b1.zone.includes('suction') && (g.zones || []).some((z) => z.k === 'suction'),
      mv: window.__b1.mv,
      bx: !!e.bx,
    };
    window.__frame(e);
    return r;
  });
  check(
    tw2.hit && tw2.dmg > 0 && tw2.zone && tw2.mv > 10 && tw2.bx,
    '旋風產生機：旋風追上目標、持續受傷（' + Math.round(tw2.dmg) + '），吸引區跟著移動',
  );
  await shot('twister-vortex');
  await resume();
  const tw3 = await ev(() => {
    const g = window.__game,
      e = window.__e;
    const n0 = window.__b1.rm.length;
    e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    window.__step([e], 2);
    return { gone: !e.aiState.tw && !e.bx, rm: window.__b1.rm.length > n0 };
  });
  check(tw3.gone && tw3.rm, '旋風產生機：擊破產生機時旋風消失');

  // ---- 礦坑（坑道網，有岩頂）：坍方爆破手 ----
  await enter('desert', 'tunnels');
  const bl1 = await ev(() => {
    const g = window.__game;
    const e = g.spawnType('blaster', 1, 1, window.__at(4, -22), 1);
    window.__e = e;
    let warn = false;
    window.__step([e], 600, () => (warn = e.bossVis === 1));
    window.__step([e], 60);
    window.__frame(e);
    return { warn, roof: !!g.world.theme.roof, top: e.aiState.bl && e.aiState.bl.top.y };
  });
  check(bl1.warn && bl1.roof && bl1.top < 20, '坍方爆破手：在岩頂裝炸藥（閃燈＋裂紋圈預警）');
  await shot('blaster-warn');
  await resume();
  const bl2 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      p = g.player;
    const h0 = p.hp;
    window.__step([e], 200, () => (e.aiState.falls || 0) > 0);
    window.__frame(e);
    return { falls: e.aiState.falls || 0, dmg: h0 - p.hp, wall: window.__b1.wall.includes('rock') };
  });
  check(
    bl2.falls === 1 && bl2.dmg > 0 && bl2.wall,
    '坍方爆破手：落石（' + Math.round(bl2.dmg) + '），岩塊留下當掩體',
  );
  await shot('blaster-fall');
  await resume();
  await ev(() => {
    const g = window.__game;
    window.__e.takeDamage(1e9, 0, g.player, window.__e.center(), new THREE.Vector3(0, 0, 1));
  });
  // ---- 礦坑：礦燈哨兵 ----
  const lp1 = await ev(() => {
    const g = window.__game;
    g.clearZones(); // 坍方留下的岩塊（臨時障礙物）會擋住探照燈
    g.clearTempWalls();
    const lat = window.__at(-3, -18);
    lat.y = g.world.terrainHeight(lat.x, lat.z); // 地面（不站在物件上）
    const e = g.spawnType('lamp', 1, 1, lat, 1);
    window.__e = e;
    let lit = false;
    window.__step([e], 1200, () => (lit = (e.aiState.spotted || 0) > 0));
    window.__step([e], 5);
    window.__frame(e, 0.5);
    return {
      lit,
      zone: window.__b1.zone.includes('spot'),
      vis: e.bossVis,
      d: e.pos.distanceTo(g.player.pos),
      los: e.aiState.los,
    };
  });
  check(lp1.lit && lp1.zone, '礦燈哨兵：探照燈掃描、照到目標（spot 區域）' + JSON.stringify(lp1));
  await shot('lamp-spot');
  await resume();
  const lp2 = await ev(() => {
    const g = window.__game,
      e = window.__e,
      p = g.player;
    const h0 = e.hp;
    e.takeDamage(200, 0, p, e.center().add(new THREE.Vector3(0, -1, 0)), new THREE.Vector3(0, 0, 1));
    const body = h0 - e.hp;
    const h1 = e.hp;
    e.takeDamage(200, 0, p, e.lampPos_b1(), new THREE.Vector3(0, 0, 1));
    const head = h1 - e.hp;
    window.__step([e], 3);
    const r = { body, head, off: e.aiState.lmOff, vis: e.bossVis, rm: window.__b1.rm.length };
    window.__frame(e, 0.5);
    return r;
  });
  check(
    lp2.head > lp2.body * 1.4 && lp2.off > 7 && lp2.vis === 2,
    '礦燈哨兵：打燈頭傷害加重（' + Math.round(lp2.body) + ' → ' + Math.round(lp2.head) + '）並熄燈 8 秒',
  );
  await shot('lamp-break');
  await resume();
  // 三角形預算（一般 ≤ 6000）與 rig.dmg、動作節點
  const tri = await ev(() => {
    const g = window.__game;
    const out = {};
    for (const k of ['harpoon', 'smoker', 'ridgesniper', 'twister', 'blaster', 'lamp']) {
      const e = g.spawnType(k, 1, 1, window.__at(30, 30), 1);
      let n = 0;
      e.mesh.traverse((o) => {
        if (
          !o.isMesh ||
          o.material.type === 'ShaderMaterial' ||
          o.material.blending === THREE.AdditiveBlending
        )
          return;
        const gm = o.geometry;
        n += (gm.index ? gm.index.count : gm.attributes.position.count) / 3;
      });
      const m = e.model;
      out[k] = {
        tris: Math.round(n),
        nodes: Object.keys(m).filter((q) => q[0] === 'x' && q !== 'xWarn' && q !== 'xL1' && q !== 'xL2')
          .length,
        dmg: !!(m.dmg && m.dmg.smoke.length && m.dmg.plates.length >= 2 && m.dmg.chunks.length >= 2),
      };
      e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
    }
    return out;
  });
  check(
    Object.values(tri).every((t) => t.tris <= 6000 && t.nodes >= 3 && t.dmg),
    'B1 模型：三角形 ≤ 6000、至少 3 個動作節點、rig.dmg（' +
      Object.entries(tri)
        .map(([k, t]) => k + ' ' + t.tris)
        .join('、') +
      '）',
  );
  await ctx.close();
  // 模型庫：三個角度
  if (!fs.existsSync(LIBRARY)) return;
  const lc = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const lpg = await lc.newPage();
  watch(lpg, 'foes-b1-lib');
  for (const k of ['harpoon', 'smoker', 'ridgesniper', 'twister', 'blaster', 'lamp']) {
    await lpg.goto(base + 'model-library.html?test#vehicle/foe_' + k);
    await lpg.waitForSelector('#inspect:not([hidden])');
    await wait(1500);
    const box = await lpg.$eval('#insGl', (c) => {
      const r = c.getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2, r.height];
    });
    const view = await lpg.$('#insView');
    await view.screenshot({ path: path.join(SHOT_DIR, 'foe-b1-lib-' + k + '-a.png') });
    // OrbitControls：橫向拖曳 height 的 1/4 ≈ 轉 90°
    await dragFrom(lpg, [box[0], box[1]], box[2] / 4, 0);
    await view.screenshot({ path: path.join(SHOT_DIR, 'foe-b1-lib-' + k + '-b.png') });
    await dragFrom(lpg, [box[0], box[1]], box[2] / 4, 0);
    await view.screenshot({ path: path.join(SHOT_DIR, 'foe-b1-lib-' + k + '-c.png') });
  }
  check(true, '模型庫：6 種新敵人的三個角度截圖（test-results/foe-b1-lib-*.png）');
  await lc.close();
}

// 地圖專屬敵人擴充（B2）：集散場的鉚釘槍 MT／電焊 MT、水壩的高壓水砲車／渦輪吸入機、水沒市街的電鰻無人機／漂流水雷浮標
async function testFoesB2(browser, base) {
  console.log('地圖專屬敵人擴充 B2：集散場、水壩、水沒市街的新敵人（行為、預警、模型）');
  const { ctx, page } = await newPage(browser, 'foesb2');
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  // 共用工具：進入主題的補給區段（沒有敵人）、凍結主迴圈（只畫面）、手動推進 AI；記錄狀態效果與場上機制的呼叫
  await page.evaluate(() => {
    const T = (window.__b2 = {});
    T.enter = (theme, variant) => {
      const g = window.__game;
      if (!g.camp) g.campBegin('c1s1');
      g.campSortie().segs[0].theme = theme;
      g.camp.seg = 0;
      g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '', tod: '', weather: '', zone: 'full' };
      g.camp.types[0] = 'supply';
      g.state = 'play';
      g.campEnterSeg();
      g.state = 'foe-test';
      g.freezeT = 1e9; // 主迴圈只畫面，AI 由測試推進
      const p = g.player;
      p.hp = p.maxHp = 1e6;
      const rec = (T.rec = { status: [], zone: [] });
      const os = p.addStatus;
      p.addStatus = function (k, s, o) {
        rec.status.push(k);
        return os ? os.call(this, k, s, o) : undefined;
      };
      if (T.oz === undefined) T.oz = g.addZone || null;
      g.addZone = function (k, ...a) {
        rec.zone.push(k);
        return T.oz ? T.oz.call(this, k, ...a) : rec.zone.length;
      };
      return g.worldTheme;
    };
    T.at = (dx, dz) => {
      const g = window.__game,
        p = g.player;
      const x = p.pos.x + dx,
        z = p.pos.z + dz;
      return new THREE.Vector3(x, g.world.terrainHeight(x, z), z);
    };
    T.step = (ents, n, stop) => {
      const g = window.__game,
        p = g.player;
      for (let i = 0; i < n; i++) {
        g.time += 1 / 60;
        p.iFrames = 0;
        p.staggerT = 0;
        for (const e of ents) if (!e.dead) e.updateAI(1 / 60);
        for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
        g.projectiles = g.projectiles.filter((q) => !q.dead);
        if (g.updateHazards) g.updateHazards(1 / 60);
        g.hazards2Tick(1 / 60); // 區域效果
        g.fx.update(1 / 60);
        if (stop && stop()) return i;
      }
      return n;
    };
    // 截圖的鏡頭：從玩家這一側斜看敵人的正面
    T.cam = (e, dist = 9, h = 3.5, side = 1) => {
      const g = window.__game;
      const c = e.center();
      const d = c.clone().sub(g.player.center()).setY(0).normalize();
      g.camera.position
        .copy(c)
        .addScaledVector(d, -dist)
        .add(new THREE.Vector3(-d.z * side * dist * 0.6, h, d.x * side * dist * 0.6));
      g.camera.lookAt(c);
    };
    // 側面的鏡頭：看玩家與敵人之間的攻擊（水柱、電弧）
    T.side = (e, dist = 16, h = 5) => {
      const g = window.__game;
      const a = e.center(),
        b = g.player.center();
      const mid = a.clone().lerp(b, 0.5);
      const d = b.clone().sub(a).setY(0).normalize();
      g.camera.position.copy(mid).add(new THREE.Vector3(-d.z * dist, h, d.x * dist));
      g.camera.lookAt(mid);
    };
    T.wetAt = (r0, r1) => {
      const g = window.__game,
        w = g.world,
        p = g.player;
      for (let r = r0; r < r1; r += 2)
        for (let a = 0; a < 6.28; a += 0.2) {
          const x = p.pos.x + Math.cos(a) * r,
            z = p.pos.z + Math.sin(a) * r;
          if (w.waterDepth(x, z) > 0.8 && w.inZone(x, z, 4))
            return new THREE.Vector3(x, w.terrainHeight(x, z), z);
        }
      return null;
    };
    T.kill = (e) => e.takeDamage(1e9, 0, window.__game.player, e.center(), new THREE.Vector3(0, 0, 1));
  });
  const shot = async (name) => {
    await page.evaluate(() => (window.__game.popups.length = 0)); // 傷害數字（凍結時不會消失）
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOT_DIR, 'foe-b2-' + name + '.png') });
  };
  // ---- 集散場：鉚釘槍 MT ----
  const r1 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game;
    const th = T.enter('industrial', 'railyard');
    g.world.obstacles.length = 0;
    g.world.props = [];
    // 調車場的地形有路基與土堆（障礙物拿掉了、地形還在）：挑砲口高度到玩家之間沒有地形擋住的位置，
    // 並停在那裡（只轉向；邊走邊瞄時會走到土堆後面，鉚釘打在土堆上）
    const p = g.player,
      w = g.world;
    const clear = (q) =>
      Math.abs(q.y - p.pos.y) < 1.5 &&
      [1.2, 2, 3].every((h) => {
        const a = q.clone().setY(q.y + h),
          b = p.center();
        const n = Math.ceil(a.distanceTo(b) / 0.5);
        for (let i = 1; i < n; i++) if (w.hitsWorld(a.clone().lerp(b, i / n))) return false;
        return true;
      });
    let sp = T.at(0, -18);
    for (let k = 0; k < 24 && !clear(sp); k++) {
      const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.26;
      sp = T.at(Math.sin(a) * 18, -Math.cos(a) * 18);
    }
    const e = g.spawnType('riveter', 1, 1, sp, 1);
    e.speedMul = 0;
    T.e = e;
    const n = T.step([e], 600, () => e.bossVis === 1);
    T.cam(e, 8, 3);
    return { th, n, vis: e.bossVis, res: e.res };
  });
  check(
    r1.th === 'industrial' && r1.vis === 1,
    `鉚釘槍 MT：瞄準前槍口預警（bossVis 1，${JSON.stringify(r1)}）`,
  );
  await shot('riveter-warn');
  const r2 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e;
    let proj = false;
    T.step([e], 300, () => {
      if (window.__game.projectiles.some((q) => q.owner === e)) proj = true;
      return (e.aiState.stuckN || 0) > 0;
    });
    const out = {
      proj,
      stuck: e.aiState.stuckN || 0,
      status: T.rec.status.slice(),
      real: window.__game.player.hasStatus('stick'),
    };
    T.kill(e);
    return out;
  });
  check(
    r2.proj && r2.stuck > 0 && r2.status.includes('stick') && r2.real,
    `鉚釘槍 MT：射出鉚釘，命中時黏上（addStatus stick，${JSON.stringify(r2)}）`,
  );
  // ---- 集散場：電焊 MT ----
  const w1 = await page.evaluate(() => {
    const T = window.__b2;
    const e = window.__game.spawnType('welder', 1, 1, T.at(3, -8), 1);
    T.e = e;
    const n = T.step([e], 600, () => e.bossVis === 1);
    T.cam(e, 7, 2.5);
    return { n, vis: e.bossVis };
  });
  check(w1.vis === 1, `電焊 MT：貼近後焊槍預警（${JSON.stringify(w1)}）`);
  await shot('welder-warn');
  const w2 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e,
      p = window.__game.player;
    const h0 = p.hp;
    T.step([e], 200, () => e.bossVis === 2);
    T.step([e], 70);
    T.side(e, 8, 3);
    return {
      vis: e.bossVis,
      bx: e.bx,
      pid: p.id,
      hurt: h0 - p.hp,
      drain: T.rec.status.includes('drain') && p.hasStatus('drain'),
      arc: !!(e.b2arc && e.b2arc.visible),
    };
  });
  check(
    w2.vis === 2 && w2.bx && w2.bx[0] === w2.pid && w2.hurt > 0 && w2.drain && w2.arc,
    `電焊 MT：電弧連到玩家，吸 EN（drain）並造成能量傷害（${JSON.stringify(w2)}）`,
  );
  await shot('welder-arc');
  const w3 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e,
      p = window.__game.player;
    const dir = p.pos.clone().sub(e.pos).setY(0).normalize();
    p.pos.addScaledVector(dir, 16); // 拉開 12 m 以上
    T.step([e], 3);
    const out = { vis: e.bossVis, bx: e.bx, arc: !!(e.b2arc && e.b2arc.visible) };
    T.kill(e);
    return out;
  });
  check(w3.vis === 0 && !w3.bx && !w3.arc, `電焊 MT：拉開距離電弧就斷（${JSON.stringify(w3)}）`);
  // ---- 水壩：高壓水砲車 ----
  const c1 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game;
    const th = T.enter('dam', '');
    // 找一個看得到玩家、高低差不大的位置（水壩的地形起伏大）
    const p = g.player;
    let sp = T.at(0, -22);
    for (let a = 0; a < 6.28; a += 0.3) {
      const q = T.at(Math.cos(a) * 22, Math.sin(a) * 22);
      const c = q.clone().setY(q.y + 3);
      if (
        Math.abs(q.y - p.pos.y) < 1.5 &&
        g.world.inZone(q.x, q.z, 4) &&
        [0, 1, 2, 3, 4, 5, 6, 7].every(
          (i) =>
            !g.world.hitsWorld(
              new THREE.Vector3(q.x + Math.cos(i * 0.8) * 4, q.y + 3, q.z + Math.sin(i * 0.8) * 4),
            ),
        ) &&
        // 中間的地形平坦（水柱是直線）
        [0.2, 0.4, 0.6, 0.8].every((k) => {
          const x = q.x + (p.pos.x - q.x) * k,
            z = q.z + (p.pos.z - q.z) * k;
          return Math.abs(g.world.terrainHeight(x, z) - (q.y + (p.pos.y - q.y) * k)) < 0.8;
        }) &&
        !g.world.losBlocked(c, p.center()) &&
        // 水柱實際的路線（砲口高度 → 玩家）沒有被坡道擋住（losBlocked 不看坡道；水壩有上壩頂的坡道）
        [2.5, 3, 3.5].every((h) => {
          const a = q.clone().setY(q.y + h),
            b = p.center();
          const n = Math.ceil(a.distanceTo(b) / 0.5);
          for (let i = 1; i < n; i++) {
            const v = a.clone().lerp(b, i / n);
            if (v.y < g.world.rampHeight(v.x, v.z, v.y)) return false;
          }
          return true;
        })
      ) {
        sp = q;
        break;
      }
    }
    const e = g.spawnType('watercannon', 1, 1, sp, 1);
    T.e = e;
    e.speedMul = 0; // 停在選好的位置（只轉向）
    T.obs = g.world.obstacles;
    g.world.obstacles = []; // 水柱的判定只看地形（障礙物擋住水柱是正常的，但會讓測試不穩定）
    const n = T.step([e], 600, () => e.bossVis === 1);
    T.step([e], 30);
    T.cam(e, 12, 4);
    return { th, n, vis: e.bossVis };
  });
  check(c1.th === 'dam' && c1.vis === 1, `高壓水砲車：砲口白霧蓄水（${JSON.stringify(c1)}）`);
  await shot('watercannon-warn');
  const c2 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e,
      p = window.__game.player;
    const h0 = p.hp,
      a0 = p.acs;
    T.step([e], 200, () => (e.aiState.hitN || 0) > 0);
    T.side(e, 16, 5);
    window.__game.world.obstacles = T.obs;
    return {
      hit: e.aiState.hitN || 0,
      vis: e.bossVis,
      bx: e.bx,
      dmg: Math.round(h0 - p.hp),
      acs: Math.round(p.acs - a0),
      col: !!(e.b2col && e.b2col.visible),
      L: e.aiState.lastL,
      d: +e.pos.distanceTo(p.pos).toFixed(1),
      dy: +(e.pos.y - p.pos.y).toFixed(1),
    };
  });
  check(
    c2.hit > 0 && c2.vis === 2 && c2.bx && c2.dmg > 0 && c2.dmg < 300 && c2.acs > c2.dmg && c2.col,
    `高壓水砲車：水柱傷害低、衝擊極高（${JSON.stringify(c2)}）`,
  );
  await shot('watercannon-fire');
  // ---- 水壩：渦輪吸入機 ----
  const t1 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game,
      p = g.player;
    T.kill(T.e);
    const e = g.spawnType('turbine', 1, 1, T.at(-6, -16), 1);
    T.e = e;
    e.updateAI(1 / 60); // 第一次：移到附近的水道
    const wet = g.world.waterDepth(e.pos.x, e.pos.z);
    // 玩家站到渦輪的旁邊 10 m（渦輪會轉過來面向玩家）
    p.pos.set(e.pos.x + 10, g.world.groundAt(e.pos.x + 10, e.pos.z, e.pos.y + 6), e.pos.z);
    const n = T.step([e], 900, () => e.bossVis === 1);
    T.step([e], 50);
    T.cam(e, 13, 5);
    return { n, vis: e.bossVis, wet: +wet.toFixed(2), water: !!g.world.theme.water };
  });
  check(t1.vis === 1, `渦輪吸入機：預警（蓋子半開、水面的預警圈，${JSON.stringify(t1)}）`);
  await shot('turbine-warn');
  const t2 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e;
    T.step([e], 200, () => e.bossVis === 2);
    T.step([e], 40);
    T.cam(e, 13, 5);
    // 蓋子打開時：正面 ×1.6、背面照常
    e.hp = e.maxHp = 1e7;
    const fwd = new THREE.Vector3(-Math.sin(e.yaw), 0, -Math.cos(e.yaw));
    const src = (k) => ({ pos: e.pos.clone().addScaledVector(fwd, k * 10), name: 't' });
    let h = e.hp;
    e.takeDamage(1000, 0, src(1), e.center(), null, undefined, undefined, 'none');
    const front = h - e.hp;
    h = e.hp;
    e.takeDamage(1000, 0, src(-1), e.center(), null, undefined, undefined, 'none');
    const back = h - e.hp;
    return {
      vis: e.bossVis,
      zone: T.rec.zone.slice(),
      real: (window.__game.zones || []).some((z) => z.k === 'suction'),
      front: Math.round(front),
      back: Math.round(back),
      petal: +e.model.petals[0].rotation.y.toFixed(2),
      vortex: !!(e.b2vx && e.b2vx.visible),
    };
  });
  check(
    t2.vis === 2 &&
      t2.zone.includes('suction') &&
      t2.real &&
      t2.front > t2.back * 1.4 &&
      t2.petal < -0.8 &&
      t2.vortex,
    `渦輪吸入機：打開前蓋吸入（addZone suction），正面受傷 ×1.6（${JSON.stringify(t2)}）`,
  );
  await shot('turbine-suck');
  // ---- 水沒市街：電鰻無人機 ----
  const e1 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game;
    T.kill(T.e);
    const th = T.enter('flooded', 'canal');
    const wp = T.wetAt(10, 30);
    const e = g.spawnType('eel', 1, 1, wp, 1);
    T.e = e;
    T.step([e], 60);
    const lvl = g.world.theme.water.level;
    const skim = +(e.pos.y - lvl).toFixed(2);
    const n = T.step([e], 900, () => e.bossVis === 1);
    T.step([e], 50);
    T.cam(e, 9, 4);
    return { th, wet: !!wp, n, vis: e.bossVis, skim };
  });
  check(
    e1.th === 'flooded' && e1.vis === 1 && Math.abs(e1.skim) < 1.3,
    `電鰻無人機：貼著水面游，充電時水面的電流紋預警（${JSON.stringify(e1)}）`,
  );
  await shot('eel-warn');
  const e2 = await page.evaluate(() => {
    const T = window.__b2,
      e = T.e;
    T.step([e], 200, () => e.bossVis === 2);
    T.step([e], 10);
    T.cam(e, 9, 4);
    return {
      vis: e.bossVis,
      zone: T.rec.zone.slice(),
      real: (window.__game.zones || []).some((z) => z.k === 'electro'),
    };
  });
  check(
    e2.vis === 2 && e2.zone.includes('electro') && e2.real,
    `電鰻無人機：放電（addZone electro，${JSON.stringify(e2)}）`,
  );
  await shot('eel-zap');
  // ---- 水沒市街：漂流水雷浮標 ----
  const b1 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game,
      p = g.player;
    T.kill(T.e);
    const wp = T.wetAt(12, 30) || T.at(0, -14);
    g.spawnType('buoy', 1, 1, wp);
    const bs = g.enemies.filter((x) => !x.dead && x.ai === 'buoy');
    const d0 = bs[0].pos.distanceTo(p.pos);
    T.step(bs, 90);
    T.cam(bs[0], 8, 3);
    return {
      hp: Math.round(bs[0].maxHp),
      n: bs.length,
      d0: +d0.toFixed(1),
      d1: +bs[0].pos.distanceTo(p.pos).toFixed(1),
      vis: bs.map((b) => b.bossVis),
    };
  });
  check(b1.n === 3 && b1.d1 < b1.d0, `漂流水雷浮標：三個一群漂向目標（${JSON.stringify(b1)}）`);
  await shot('buoy-drift');
  const b2 = await page.evaluate(() => {
    const T = window.__b2,
      g = window.__game,
      p = g.player;
    for (const b of g.enemies.filter((x) => !x.dead && x.ai === 'buoy')) T.kill(b);
    const wp = T.wetAt(16, 34) || T.at(0, -18);
    g.spawnType('buoy', 1, 1, wp);
    const bs = g.enemies.filter((x) => !x.dead && x.ai === 'buoy');
    // 射爆一個：旁邊的敵人（一般 MT）也受到爆炸
    const mt = g.spawnType('mt', 1, 1, bs[0].pos.clone().add(new THREE.Vector3(2.5, 0, 0)), 1);
    mt.hp = mt.maxHp = 1e5;
    const m0 = mt.hp;
    T.kill(bs[0]);
    const chain = bs.slice(1).filter((b) => b.dead).length;
    const mtHurt = m0 - mt.hp;
    mt.takeDamage(1e9, 0, p, mt.center(), new THREE.Vector3(0, 0, 1));
    // 剩下的浮標：靠近 4 m 就引信、爆炸
    const rest = bs.filter((b) => !b.dead);
    let fused = false;
    const h0 = p.hp;
    if (rest.length) {
      rest[0].pos.set(p.pos.x + 3, rest[0].pos.y, p.pos.z);
      T.step(rest, 60, () => {
        if (rest[0].bossVis === 2) fused = true;
        return rest[0].dead;
      });
    }
    for (const b of rest) if (!b.dead) T.kill(b);
    return {
      chain,
      mtHurt: Math.round(mtHurt),
      rest: rest.length,
      fused,
      boom: rest.length ? rest[0].dead : null,
      hurt: Math.round(h0 - p.hp),
    };
  });
  check(
    b2.mtHurt > 0 && (b2.rest === 0 || (b2.fused && b2.boom && b2.hurt > 0)),
    `漂流水雷浮標：射爆時波及其他敵人、靠近 4 m 引信後爆炸（${JSON.stringify(b2)}）`,
  );
  await page.evaluate(() => {
    const g = window.__game;
    g.freezeT = 0;
    if (window.__b2.oz) g.addZone = window.__b2.oz;
    g.state = 'play';
  });
  await ctx.close();
  // ---- 模型庫：三視角（斜角、正面、側面）＋三角形數 ----
  const lib = await newPage(browser, 'foesb2-lib');
  const lp = lib.page;
  await lp.setViewportSize({ width: 1280, height: 900 });
  const HIDE = ['原點與三軸', '連接點', '尺寸標線', '外框', '刻度尺', '人形 1.8 m', '1 m 格線'];
  for (const key of ['riveter', 'welder', 'water_cannon', 'turbine', 'eel_drone', 'mine_buoy']) {
    await lp.goto(base + 'model-library.html#vehicle/foe_' + key);
    await lp.waitForSelector('#insInfo .kv', { timeout: 15000 }).catch(() => {});
    await wait(1500);
    const info = await lp.evaluate((HIDE) => {
      for (const l of document.querySelectorAll('label')) {
        const i = l.querySelector('input[type=checkbox]');
        if (!i || !i.checked || !l.offsetParent) continue;
        if (HIDE.some((t) => l.textContent.trim().startsWith(t))) i.click();
      }
      const kv = [...document.querySelectorAll('#insInfo .kv')].map((k) => k.innerText.replace(/\n/g, ':'));
      const tri = kv.find((s) => /三角/.test(s)) || '';
      const cv = [...document.querySelectorAll('canvas')]
        .filter((c) => c.offsetParent)
        .sort((a, b) => b.clientHeight - a.clientHeight)[0];
      const r = cv.getBoundingClientRect();
      return {
        tri: +(tri.split(':').pop() || '0').replace(/[^\d]/g, ''),
        h: cv.clientHeight,
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      };
    }, HIDE);
    check(info.tri > 600 && info.tri <= 6000, `模型庫 vehicle/foe_${key}：三角形 ${info.tri}（上限 6000）`);
    const clip = { x: 0, y: 0, width: Math.min(1280, Math.round(info.x * 2)), height: 900 };
    const drag = async (deg) => {
      const dx = (-deg / 360) * info.h;
      await lp.mouse.move(info.x, info.y);
      await lp.mouse.down();
      await lp.mouse.move(info.x + dx, info.y, { steps: 12 });
      await lp.mouse.up();
      await wait(1500);
    };
    await lp.mouse.move(info.x, info.y);
    for (let i = 0; i < 3; i++) {
      await lp.mouse.wheel(0, -300);
      await wait(80);
    }
    await wait(800);
    await lp.screenshot({ path: path.join(SHOT_DIR, `foe-b2-lib-${key}-oblique.png`), clip });
    await drag(36.9); // 預設是右前方的斜角（方位 143°）→ 正面（180°）
    await lp.screenshot({ path: path.join(SHOT_DIR, `foe-b2-lib-${key}-front.png`), clip });
    await drag(-90); // → 右側面
    await lp.screenshot({ path: path.join(SHOT_DIR, `foe-b2-lib-${key}-side.png`), clip });
  }
  await lib.ctx.close();
}

// 區網伺服器：/health、注入、/models、/apng、/paint、渲染風格的分享（testServerModels 等共用同一個伺服器）
async function testServerBasics(browser, game) {
  console.log('區網伺服器：啟動 server.js');
  check(game.health.length > 0, `/health 回應（${game.health.trim().slice(0, 60)}）`);
  const page = await (await browser.newContext()).newPage();
  await page.goto(game.url);
  check(await page.evaluate(() => !!window.RUBICON_SERVER), '遊戲頁已注入 window.RUBICON_SERVER');
  const lib = await fetch(game.url + 'models');
  check(lib.ok && (await lib.text()).includes('模型庫'), '/models 提供模型庫頁面');
  await waitVisible(page, 'title');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('#btnLibrary')]);
  check(
    await popup.waitForSelector('.cell', { timeout: 15000 }).then(
      () => true,
      () => false,
    ),
    '標題畫面「模型庫」按鈕開啟模型庫',
  );
  // 文字動畫 APNG 產生器（dist/apng/，原生 ES Modules）
  const redir = await fetch(game.url + 'apng', { redirect: 'manual' });
  check(redir.status === 301 && redir.headers.get('location') === '/apng/', '/apng 轉到 /apng/');
  const js = await fetch(game.url + 'apng/js/app.js');
  check(
    js.ok && /javascript/.test(js.headers.get('content-type') || ''),
    `/apng/ 的 ES Module 以 JavaScript 型別提供（${js.headers.get('content-type')}）`,
  );
  const bad = await fetch(game.url + 'apng/..%2f..%2fserver.js');
  check(bad.status === 404, '/apng/ 不能讀到資料夾外的檔案');
  // 貼圖繪製（dist/paint/）
  const pr = await fetch(game.url + 'paint', { redirect: 'manual' });
  check(pr.status === 301 && pr.headers.get('location') === '/paint/', '/paint 轉到 /paint/');
  const pj = await fetch(game.url + 'paint/lib/three/three.min.js');
  const ph = await fetch(game.url + 'paint/');
  check(
    pj.ok &&
      /javascript/.test(pj.headers.get('content-type') || '') &&
      (await ph.text()).includes('Rubicon Paint'),
    '/paint/ 提供貼圖繪製與它的程式庫',
  );
  const [apng] = await Promise.all([page.waitForEvent('popup'), page.click('#btnApng')]);
  watch(apng, 'apng');
  check(
    await apng.waitForSelector('#templateStrip > *', { timeout: 15000 }).then(
      () => true,
      () => false,
    ),
    '標題畫面「文字動畫」按鈕開啟文字動畫 APNG 產生器（模板列表顯示）',
  );
  await wait(1500);
  await apng.screenshot({ path: path.join(SHOT_DIR, 'apng-tool.png') });
  // 渲染風格：上傳到伺服器 → 清單有它 → 刪除
  page.on('dialog', (d) => d.accept());
  await page.click('#btnStyleLab');
  await waitVisible(page, 'labPanel', 15000);
  await page.selectOption('#labStyle', 'builtin:ghibli');
  await page.fill('#labName', '區網分享風格');
  await page.click('#labUpload');
  await page
    .waitForFunction(() => /已上傳/.test(document.getElementById('labMsg').textContent), null, {
      timeout: 10000,
    })
    .catch(() => {});
  const sl = await (await fetch(game.url + 'api/styles')).json();
  check(
    (sl.styles || []).some((x) => x.name === '區網分享風格' && x.params && x.params.toon === 1),
    '實驗室「上傳到伺服器」：/api/styles 列出分享的風格',
  );
  check(
    (await page.$$eval('#labStyle option', (o) => o.map((x) => x.textContent))).some((t) =>
      t.includes('伺服器・區網分享風格'),
    ),
    '風格選單出現伺服器上的風格',
  );
  await page.click('#labSrvDel');
  await wait(800);
  const sl2 = await (await fetch(game.url + 'api/styles')).json();
  check(!(sl2.styles || []).some((x) => x.name === '區網分享風格'), '從伺服器刪除分享的風格');
  await page.context().close();
}

// 模型庫的範本 GLB（testLibraryGlb 下載；testLocalModels、testModelSets、testServerModels 讀取）：
// 分段平行時各段的暫存資料夾是分開的，同一段沒有先跑 testLibraryGlb 時在這裡下載同樣的檔案
async function ensureTemplates(browser, base) {
  const want = [
    ['arms/a_std/r_fore', 'a_std_r_fore_template.glb'],
    ['weapon/w_rifle/r', 'w_rifle_r_template.glb'],
  ];
  if (want.every(([, n]) => fs.existsSync(path.join(WORK_DIR, n)))) return;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page, 'templates');
  for (const [id, n] of want) {
    await reopen(page, base + 'model-library.html#' + id);
    await page.waitForSelector('#inspect:not([hidden])');
    await wait(1500);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#insTemplate')]);
    await dl.saveAs(path.join(WORK_DIR, n));
  }
  await ctx.close();
}

// 測試步驟（依序）：key＝SMOKE_ONLY／耗時紀錄／分段用的名稱。server＝要區網伺服器（同一段只啟動一次）：
// 'server' 是伺服器本身的檢查；server: 開頭的照原本的規則，SMOKE_ONLY 要同時有 server 與該測試名稱。
// family＝拆細的測試（testStyleThemes:1、testMpBosses:halberd…）：SMOKE_ONLY 寫整個名稱或單一步驟都可以
const LIB_FILE = () => 'file:///' + LIBRARY.split(path.sep).join('/');
// Coral 戰爭（RTS）的測試在 smoke-rts.js
const RTS = require('./smoke-rts')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// R2 的各包（docs/rts-design.md 13.1）：A＝核心與資料
const RTS_A = require('./smoke-rts-core')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// D＝中立與地圖（野怪營地、酒館、商店、傭兵營）
const RTS_D = require('./smoke-rts-d')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// C 包（英雄與道具）的測試在 smoke-rts-c.js
const RTS_C = require('./smoke-rts-c')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// B 包（兵種行為與模型）的測試在 smoke-rts-b.js
const RTS_B = require('./smoke-rts-b')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// E 包（HUD、輸入、親自駕駛）的測試在 smoke-rts-e.js
const RTS_E = require('./smoke-rts-e')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
  watch,
});
// F 包（電腦對手第二輪）
const RTS_F = require('./smoke-rts-f')({ check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path });
// R3 A 包（艾瑟立克的核心與資料：導管、融合、幻象）
const RTS_R3A = require('./smoke-rts-aeth-a')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R3 B 包（艾瑟立克的兵種行為與模型）
const RTS_R3B = require('./smoke-rts-aeth-b')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R3 C 包（艾瑟立克的英雄與道具）
// R3 E 包（艾瑟立克的 HUD、輸入、親自駕駛）
const RTS_R3E = require('./smoke-rts-aeth-e')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
  watch,
});
const RTS_R3C = require('./smoke-rts-aeth-c')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R3 D 包（地圖主題：冰原、技研都市地表；主題的營地與傭兵）
const RTS_R3D = require('./smoke-rts-aeth-d')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R3 F 包（電腦對手：艾瑟立克）
const RTS_R3F = require('./smoke-rts-aeth-f')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R4 A 包（維爾威的核心與資料）
const RTS_R4A = require('./smoke-rts-veer-a')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R5 A 包（聖域的核心與資料）
// R5 E 包（聖域的 HUD、輸入、親自駕駛）
const RTS_R5E = require('./smoke-rts-sanc-e')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
  watch,
});
const RTS_R5A = require('./smoke-rts-sanc-a')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R5 C 包（聖域的英雄與道具）
// R5 B 包（聖域的兵種行為與模型）
const RTS_R5B = require('./smoke-rts-sanc-b')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
const RTS_R5C = require('./smoke-rts-sanc-c')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R4 E 包（維爾威的 HUD、輸入、親自駕駛）
const RTS_R4E = require('./smoke-rts-veer-e')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
  watch,
});
// R4 C 包（維爾威的英雄與道具）
const RTS_R4C = require('./smoke-rts-veer-c')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R4 B 包（維爾威的兵種行為與模型）
const RTS_R4B = require('./smoke-rts-veer-b')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R5 D 包（地圖主題：汙染水沒市街、多重水壩；水面與涉水、主題的營地與傭兵）
const RTS_R5D = require('./smoke-rts-sanc-d')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R4 D 包（地圖主題：舊宇宙港外圍、Grid 086 地表；主題的營地與傭兵）
const RTS_R4D = require('./smoke-rts-veer-d')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R5 F 包（電腦對手：聖域）
const RTS_R5F = require('./smoke-rts-sanc-f')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R4 F 包（電腦對手：維爾威）
const RTS_R4F = require('./smoke-rts-veer-f')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R6 B 包（電腦對手的難度）
const RTS_R6B = require('./smoke-rts-r6-b')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R6 D 包（單位與中立的表現）
const RTS_R6D = require('./smoke-rts-r6-d')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R6 A 包（平衡與核心）
const RTS_R6A = require('./smoke-rts-r6-a')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
// R6 E 包（收尾的介面：選單、說明、提示卡、設定、投降、結果畫面）
// R6 C 包（地圖主題與地圖大小）
const RTS_R6C = require('./smoke-rts-r6-c')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
});
const RTS_R6E = require('./smoke-rts-r6-e')({
  check,
  newPage,
  freezeLoop,
  seededRandom,
  wait,
  SHOT_DIR,
  path,
  watch,
});
const STEPS = [
  ['testFile', (c) => testFile(c.browser)],
  ['testSolo', (c) => testSolo(c.browser, c.base)],
  ['testMaps', (c) => testMaps(c.browser, c.base + '?test')],
  ['testSaves', (c) => testSaves(c.browser, c.base + '?test')],
  ['testPilot', (c) => testPilot(c.browser, c.base)],
  ['testLibrary', (c) => testLibrary(c.browser, c.base)],
  ['testFoeModelsD1', (c) => testFoeModelsD1(c.browser, c.base)],
  ['testLibraryGlb', (c) => testLibraryGlb(c.browser, c.base)],
  ['testRefTools', (c) => testRefTools(c.browser, c.base)],
  ['testMotion', (c) => testMotion(c.browser, c.base)],
  [
    'testDraco',
    async (c) => {
      await testDraco(c.browser, c.base + 'model-library.html', 'http');
      await testDraco(c.browser, LIB_FILE(), 'file');
    },
  ],
  ['testLibraryJoints', (c) => testLibraryJoints(c.browser, c.base)],
  ['testWorkshop', (c) => testWorkshop(c.browser, c.base)],
  ['testEditor', (c) => testEditor(c.browser, c.base)],
  ['testEditorSplit', (c) => testEditorSplit(c.browser, c.base)],
  ['testEditorMaterials', (c) => testEditorMaterials(c.browser, c.base)],
  ['testEditorTextures', (c) => testEditorTextures(c.browser, c.base)],
  ['testEditorFaces', (c) => testEditorFaces(c.browser, c.base)],
  ['testEditorOptimize', (c) => testEditorOptimize(c.browser, c.base)],
  ['testPaint', (c) => testPaint(c.browser)],
  ['testLabDemo', (c) => testLabDemo(c.browser)],
  ['testHangar', (c) => testHangar(c.browser)],
  ['testStyleLab', (c) => testStyleLab(c.browser)],
  // 每個內建風格 × 13 個主題要量很久，主題分成 3 組（SMOKE_ONLY=testStyleThemes 一樣跑全部）
  ...[1, 2, 3].map((i) => [
    'testStyleThemes:' + i,
    (c) => testStyleThemes(c.browser, i, 3),
    { family: 'testStyleThemes' },
  ]),
  ['testBosses', (c) => testBosses(c.browser, c.base)],
  ['testBosses2', (c) => testBosses2(c.browser, c.base)],
  ['testLockOn', (c) => testLockOn(c.browser, c.base)],
  ['testCamOcclusion', (c) => testCamOcclusion(c.browser, c.base)],
  ['testChase', (c) => testChase(c.browser, c.base)],
  ['testPadUi', (c) => testPadUi(c.browser, c.base)],
  ['testBoundary', (c) => testBoundary(c.browser, c.base)],
  ['testCampaign', (c) => testCampaign(c.browser, c.base)],
  ['testCampaign2', (c) => testCampaign2(c.browser, c.base)],
  ['testModules', (c) => testModules(c.browser, c.base)],
  ['testChapter1', (c) => testChapter1(c.browser, c.base)],
  ['testChapter2', (c) => testChapter2(c.browser, c.base)],
  ['testFoesB2', (c) => testFoesB2(c.browser, c.base)],
  ['testFoesC1', (c) => testFoesC1(c.browser, c.base)],
  ['testFoesC2', (c) => testFoesC2(c.browser, c.base)],
  ['testChapter3', (c) => testChapter3(c.browser, c.base)],
  ['testChapter4', (c) => testChapter4(c.browser, c.base)],
  ['testChapter5', (c) => testChapter5(c.browser, c.base)],
  ['testChapter6', (c) => testChapter6(c.browser, c.base)],
  ['testFoeModelsD2', (c) => testFoeModelsD2(c.browser, c.base)],
  ['testVariants6', (c) => testVariants6(c.browser, c.base)],
  ['testCycle2', (c) => testCycle2(c.browser, c.base)],
  ['testCycle3', (c) => testCycle3(c.browser, c.base)],
  ['testStory', (c) => testStory(c.browser, c.base)],
  ['testCine', (c) => testCine(c.browser, c.base)],
  ['testTextFx', (c) => testTextFx(c.browser, c.base)],
  ['testLevels', (c) => testLevels(c.browser, c.base)],
  ['testWaves', (c) => testWaves(c.browser, c.base)],
  ['testEnemyAI', (c) => testEnemyAI(c.browser, c.base)],
  ['testGoals', (c) => testGoals(c.browser, c.base)],
  ['testOutposts', (c) => testOutposts(c.browser, c.base)],
  ['testModFx', (c) => testModFx(c.browser, c.base)],
  ['testSupply', (c) => testSupply(c.browser, c.base)],
  ['testGuide', (c) => testGuide(c.browser, c.base)],
  ['testRange', (c) => testRange(c.browser, c.base)],
  ['testAttrs', (c) => testAttrs(c.browser, c.base)],
  ['testAim', (c) => testAim(c.browser, c.base)],
  ['testAudio', (c) => testAudio(c.browser, c.base)],
  ['testJuice', (c) => testJuice(c.browser, c.base)],
  ['testFoesB1', (c) => testFoesB1(c.browser, c.base)],
  ['testBossPower', (c) => testBossPower(c.browser, c.base)],
  ['testBoss3', (c) => testBoss3(c.browser, c.base)],
  ['testStatusFx', (c) => testStatusFx(c.browser, c.base)],
  ['testHazards2', (c) => testHazards2(c.browser, c.base)],
  ['testRtsFog', (c) => RTS.testRtsFog(c.browser, c.base)],
  ['testRtsInput', (c) => RTS.testRtsInput(c.browser, c.base)],
  ['testRtsCore', (c) => RTS.testRtsCore(c.browser, c.base)],
  ['testRtsAi', (c) => RTS.testRtsAi(c.browser, c.base)],
  ['testRtsLod', (c) => RTS.testRtsLod(c.browser, c.base)],
  ['testRtsTech', (c) => RTS_A.testRtsTech(c.browser, c.base)],
  ['testRtsNeutral', (c) => RTS_D.testRtsNeutral(c.browser, c.base)],
  ['testRtsCastron', (c) => RTS_B.testRtsCastron(c.browser, c.base)],
  ['testRtsHud2', (c) => RTS_E.testRtsHud2(c.browser, c.base)],
  ['testRtsPilot', (c) => RTS_E.testRtsPilot(c.browser, c.base)],
  ['testRtsHero', (c) => RTS_C.testRtsHero(c.browser, c.base)],
  ['testRtsItems', (c) => RTS_C.testRtsItems(c.browser, c.base)],
  ['testRtsAi2', (c) => RTS_F.testRtsAi2(c.browser, c.base)],
  ['testRtsAeth', (c) => RTS_R3A.testRtsAeth(c.browser, c.base)],
  ['testRtsAethUnits', (c) => RTS_R3B.testRtsAethUnits(c.browser, c.base)],
  ['testRtsAethHero', (c) => RTS_R3C.testRtsAethHero(c.browser, c.base)],
  ['testRtsAethHud', (c) => RTS_R3E.testRtsAethHud(c.browser, c.base)],
  ['testRtsThemes', (c) => RTS_R3D.testRtsThemes(c.browser, c.base)],
  ['testRtsAethAi', (c) => RTS_R3F.testRtsAethAi(c.browser, c.base)],
  ['testRtsVeer', (c) => RTS_R4A.testRtsVeer(c.browser, c.base)],
  ['testRtsVeerHero', (c) => RTS_R4C.testRtsVeerHero(c.browser, c.base)],
  ['testRtsVeerHud', (c) => RTS_R4E.testRtsVeerHud(c.browser, c.base)],
  ['testRtsVeerUnits', (c) => RTS_R4B.testRtsVeerUnits(c.browser, c.base)],
  ['testRtsThemes2', (c) => RTS_R4D.testRtsThemes2(c.browser, c.base)],
  ['testRtsVeerAi', (c) => RTS_R4F.testRtsVeerAi(c.browser, c.base)],
  ['testRtsSanc', (c) => RTS_R5A.testRtsSanc(c.browser, c.base)],
  ['testRtsSancHero', (c) => RTS_R5C.testRtsSancHero(c.browser, c.base)],
  ['testRtsSancHud', (c) => RTS_R5E.testRtsSancHud(c.browser, c.base)],
  ['testRtsSancUnits', (c) => RTS_R5B.testRtsSancUnits(c.browser, c.base)],
  ['testRtsThemes3', (c) => RTS_R5D.testRtsThemes3(c.browser, c.base)],
  ['testRtsSancAi', (c) => RTS_R5F.testRtsSancAi(c.browser, c.base)],
  ['testRtsAiDiff', (c) => RTS_R6B.testRtsAiDiff(c.browser, c.base)],
  ['testRtsCreeps', (c) => RTS_R6D.testRtsCreeps(c.browser, c.base)],
  ['testRtsBalance', () => RTS_R6A.testRtsBalance()],
  ['testRtsEnd', (c) => RTS_R6A.testRtsEnd(c.browser, c.base)],
  ['testRtsFinish', (c) => RTS_R6E.testRtsFinish(c.browser, c.base)],
  ['testRtsThemes4', (c) => RTS_R6C.testRtsThemes4(c.browser, c.base)],
  ['testLocalModels', (c) => testLocalModels(c.browser, c.base), { templates: true }],
  ['testModelSets', (c) => testModelSets(c.browser, c.base), { templates: true }],
  ['testMultiplayer', (c) => testMultiplayer(c.browser, c.base + '?lan=local', 'local', true)],
  // 每隻 Boss 一個步驟（SMOKE_ONLY=testMpBosses 一樣跑全部）
  ...['halberd', 'citadel', 'mirage', 'cerberus'].map((k) => [
    'testMpBosses:' + k,
    (c) => testMpBosses(c.browser, c.base + '?lan=local&test', [k]),
    { family: 'testMpBosses' },
  ]),
  ['testMpStatus', (c) => testMpStatus(c.browser, c.base + '?lan=local&test')],
  ['testMpCampaign', (c) => testMpCampaign(c.browser, c.base + '?lan=local&test')],
  ['testMpLevels', (c) => testMpLevels(c.browser, c.base + '?lan=local&test')],
  ['server', (c) => testServerBasics(c.browser, c.game), { server: true }],
  [
    'server:testServerModels',
    (c) => testServerModels(c.browser, c.game.url),
    { server: true, only: 'testServerModels', templates: true },
  ],
  [
    'server:testLevelsServer',
    (c) => testLevelsServer(c.browser, c.game.url),
    { server: true, only: 'testLevelsServer' },
  ],
  [
    'server:testMultiplayer',
    (c) => testMultiplayer(c.browser, c.game.url, 'server', false),
    { server: true, only: 'testMultiplayer' },
  ],
].map(([key, fn, o = {}]) => ({ key, fn, ...o }));

// 彼此相依、必須在同一段依序執行的步驟（其他步驟彼此獨立：每個測試都開新的 browser context，
// localStorage／IndexedDB 不共用；跨測試的範本 GLB 由 ensureTemplates 補上）
const GROUPS = [
  ['testLibrary', 'testRefTools'], // testRefTools 拿 testLibrary 的截圖 library.png 當參考圖
  ['server', 'server:testServerModels', 'server:testLevelsServer', 'server:testMultiplayer'], // 同一個伺服器
];

// SMOKE_ONLY 選到的步驟（規則和以前相同）
function selectSteps() {
  const srvOn = WITH_SERVER && (!ONLY || ONLY.includes('server'));
  return STEPS.filter((s) =>
    s.server
      ? srvOn && (s.key === 'server' || !ONLY || ONLY.includes(s.only))
      : !ONLY || ONLY.includes(s.key) || (s.family && ONLY.includes(s.family)),
  );
}

async function launchBrowser() {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Edge 或 Chrome');
  // 預設用顯示卡算繪（Windows：ANGLE D3D11）；SMOKE_GPU=0 改回 SwiftShader（CPU 軟體算繪，慢很多）
  const gpu = process.env.SMOKE_GPU !== '0';
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: [
      ...(gpu
        ? [
            process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=default',
            '--enable-gpu',
            '--ignore-gpu-blocklist',
          ]
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  // 印出實際的 WebGL 算繪器（要求 GPU 卻拿到 SwiftShader 時提示）
  const pg = await browser.newPage();
  const renderer = await pg
    .evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl');
      const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
      return gl
        ? e
          ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL)
          : gl.getParameter(gl.RENDERER)
        : '沒有 WebGL';
    })
    .catch((e) => '讀不到：' + e.message);
  await pg.close();
  console.log(`WebGL：${renderer}`);
  if (gpu && /SwiftShader/i.test(renderer)) console.log('  （要求顯示卡算繪，但瀏覽器改用了 SwiftShader）');
  // 地圖預設固定為貨運集散場（平坦、沒有虛空與多層），Boss、鎖定、多人等測試的結果才穩定；
  // 各地圖本身由 testMaps 逐一出擊檢查。測試自己選了地圖（包含選回「隨機」）時不覆蓋
  const newCtx = browser.newContext.bind(browser);
  browser.newContext = async (o) => {
    const c = await newCtx(o);
    await c.addInitScript(() => {
      try {
        if (localStorage.getItem('rubicon_map') === null) localStorage.setItem('rubicon_map', 'industrial');
        if (localStorage.getItem('rubicon_variant') === null) localStorage.setItem('rubicon_variant', 'base');
      } catch (e) {
        /* 沒有 localStorage 的頁面 */
      }
    });
    return c;
  };
  return browser;
}

// 依序執行步驟。keepGoing（分段的子程序）：某一步拋出例外時記成失敗、繼續下一步；
// 單一程序時照舊整個中止
async function runSteps(steps, { keepGoing = false, onStep } = {}) {
  const times = {};
  const counts = {}; // 各步驟的項數
  const browser = await launchBrowser();
  const srv = await serveHtml();
  const c = { browser, base: `http://127.0.0.1:${srv.address().port}/`, game: null };
  try {
    for (const s of steps) {
      CUR = s.key;
      const t0 = Date.now();
      const ctx0 = new Set(browser.contexts());
      const c0 = checks;
      try {
        if (s.server && !c.game) c.game = await startGameServer();
        if (s.templates) await ensureTemplates(browser, c.base);
        await s.fn(c);
      } catch (e) {
        if (!keepGoing) throw e;
        console.log(`  ✗ ${s.key} 拋出例外：${(e && e.stack) || e}`);
        checks++;
        failures.push({ test: s.key, label: `拋出例外：${String((e && e.message) || e).split('\n')[0]}` });
      }
      // 這一步開的 browser context 沒關（測試忘了關、或拋出例外中斷）時關掉，免得頁面在背景一直渲染、拖慢後面的測試
      for (const x of browser.contexts()) if (!ctx0.has(x)) await x.close().catch(() => {});
      times[s.key] = Date.now() - t0;
      counts[s.key] = checks - c0;
      if (onStep) onStep(times, counts);
    }
  } finally {
    CUR = '';
    await browser.close().catch(() => {});
    srv.close();
    if (c.game) {
      const p = c.game.proc;
      if (p.exitCode === null) {
        const done = new Promise((r) => p.once('exit', r));
        p.kill();
        await done;
      }
    }
  }
  return { times, counts };
}

async function main() {
  if (!fs.existsSync(HTML)) throw new Error(`找不到 ${HTML}，請先執行 npm run build`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(WORK_DIR, { recursive: true });
  const jobs = require('./smoke-jobs');
  // 分段的子程序：只跑分到的步驟，結果寫成 JSON 交給協調程序彙整（每一步做完就更新，崩潰時也有部分結果）
  if (CHILD) {
    const want = (process.env.SMOKE_UNITS || '').split(',');
    const steps = STEPS.filter((s) => want.includes(s.key));
    const save = (times, counts, done) =>
      fs.writeFileSync(
        process.env.SMOKE_RESULT,
        JSON.stringify({ checks, counts, failures, errors: [...new Set(errors)], times, done: !!done }),
      );
    const r = await runSteps(steps, { keepGoing: true, onStep: (t, c) => save(t, c) });
    save(r.times, r.counts, true);
    process.exit(0);
  }
  const steps = selectSteps();
  const n = jobs.jobCount();
  if (n > 1) {
    const units = jobs.makeUnits(
      steps.map((s) => s.key),
      GROUPS,
    );
    if (units.length > 1)
      process.exit(await jobs.coordinate({ units, jobs: n, args, root: ROOT, shotDir: SHOT_DIR }));
  }
  // 單一程序依序執行（SMOKE_JOBS=1，或只選到一個單位）
  console.log(`目標：${path.relative(ROOT, HTML)}`);
  const t0 = Date.now();
  const { times } = await runSteps(steps);
  jobs.saveTimes(SHOT_DIR, times);
  const uniq = [...new Set(errors)];
  check(uniq.length === 0, `沒有頁面錯誤（${uniq.length} 筆）`);
  for (const e of uniq) console.log('    ' + e);
  console.log(`\n共 ${checks} 項，通過 ${checks - failures.length} 項，耗時 ${jobs.fmtMs(Date.now() - t0)}`);
  if (failures.length) {
    console.log(`失敗 ${failures.length} 項：`);
    for (const f of failures) console.log(`  ✗ [${f.test || '彙總'}] ${f.label}`);
  } else console.log('全部通過');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// 地圖專屬敵人擴充（C1 組）：各自生成、觸發招式並截圖（攻擊預警）、模型庫三視角截圖
async function testFoesC1(browser, base) {
  console.log('地圖專屬敵人擴充（C1）：冷凍噴霧機、冰錐迫擊砲、全像投影器、寄生纏附體、重力錨、滑索突擊兵');
  const { ctx, page } = await newPage(browser, 'foes-c1');
  await seededRandom(page);
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  await page.evaluate(() => (window.__game.autoPickMod = true));
  // 主迴圈停住（state 'foe-test' 也會跑任務的更新，以前在兩次 evaluate 之間依實際時間跑了不定的幾格），
  // 招式只由 __step 與截圖前的 __pump（固定的遊戲時間）推進；亂數與地圖種子也固定（同 testFoesC2）
  await freezeLoop(page);
  const ev = (fn, arg) =>
    page.evaluate(
      ([src, a]) => {
        window.__reseed(4242);
        return (0, eval)('(' + src + ')')(a);
      },
      [fn.toString(), arg],
    );
  const enter = (theme, variant) =>
    ev(
      ([theme, variant]) => {
        const g = window.__game;
        if (g.camp) g.campEnd(false, true);
        g.state = 'play';
        g.campBegin('c1s1');
        g.campSortie().segs[0].theme = theme;
        g.camp.plan[0] = { ...g.camp.plan[0], variant, landmark: '' };
        g.camp.types[0] = 'supply';
        g.camp.seeds[0] = 4242; // 固定地圖（招式的射線與彈道每次都一樣）
        g.campEnterSeg();
        g.state = 'foe-test';
        const p = g.player;
        p.hp = p.maxHp = 1e6;
        g.waves = [];
        g.wavePend = null;
        g.aiOld = true; // 不用感知系統（看不到目標時不會回到待機，招式的測試才穩定）
        // 狀態效果（mech-status.js）與場上機制（hazards2.js）：記錄呼叫並照常執行
        window.__c1 = { zones: [], walls: [], status: [] };
        if (!g.__c1wrap) {
          g.__c1wrap = true;
          const az = g.addZone,
            aw = g.addTempWall;
          g.addZone = function (...a) {
            window.__c1.zones.push(a);
            return az.apply(this, a);
          };
          g.addTempWall = function (...a) {
            window.__c1.walls.push(a);
            return aw.apply(this, a);
          };
        }
        const as = p.addStatus;
        p.addStatus = function (k, sec, o) {
          window.__c1.status.push([k, sec, o]);
          return as.call(this, k, sec, o);
        };
        // 共用：逐格推進（主迴圈暫停）
        window.__step = (n, stop) => {
          for (let i = 0; i < n; i++) {
            g.time += 1 / 60;
            p.iFrames = 0;
            for (const e of g.enemies.slice()) if (!e.dead) e.updateAI(1 / 60);
            for (const q of g.projectiles) if (!q.dead) q.update(1 / 60);
            g.projectiles = g.projectiles.filter((q) => !q.dead);
            if (g.updateHazards) g.updateHazards(1 / 60);
            g.hazards2Tick(1 / 60); // 區域效果、臨時障礙物
            if (stop && stop()) return i;
          }
          return n;
        };
        // 在玩家前方 dist m 生成（玩家面向它）
        window.__spawn = (type, dist, side = 0) => {
          const w = g.world;
          const x = p.pos.x + side,
            z = p.pos.z - dist;
          const e = g.spawnType(type, 1, 1, new THREE.Vector3(x, w.groundAt(x, z, p.pos.y + 2), z), 1);
          p.yaw = p.aimYaw = 0;
          return e;
        };
        window.__clear = () => {
          for (const e of g.enemies) if (!e.dead) e.depart();
          g.enemies = [];
          g.projectiles = [];
        };
        // 新地圖先跑幾格主迴圈（更新與算繪：機體的矩陣、鏡頭），以前是靠兩次 evaluate 之間的實際幾格
        window.__pump(0.25);
      },
      [theme, variant],
    );
  // 截圖：讓主迴圈推進 ms 毫秒的遊戲時間（預警的特效會動、敵人也照常行動），之後停回測試狀態
  const shot = async (name, ms = 350) => {
    await ev((sec) => {
      const g = window.__game;
      if (g.popups) g.popups.length = 0;
      g.state = 'play';
      window.__pump(sec);
    }, ms / 1000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'foes-c1-' + name + '.png') });
    await ev(() => (window.__game.state = 'foe-test'));
  };
  await enter('snow', 'icefield');
  const reg = await ev(() => {
    const g = window.__game;
    const want = ['cryo', 'icemortar', 'holo', 'parasite', 'anchor', 'zipline'];
    return want.map((k) => {
      const e = window.__spawn(k, 30);
      const ok = !!e && !!e.model && e.model.vehicle && !!e.model.dmg && e.model.dmg.chunks.length >= 3;
      if (e) e.depart();
      g.enemies = g.enemies.filter((x) => x !== e);
      return ok ? '' : k;
    });
  });
  check(
    reg.every((x) => !x),
    '六種新敵人都能生成，模型有受損設定（' + reg.filter((x) => x).join('、') + '）',
  );

  // ---- 冰原：冷凍噴霧機 ----
  const cr = await ev(() => {
    const e = window.__spawn('cryo', 9);
    const n1 = window.__step(400, () => e.bossVis === 1);
    return { warn: n1 < 400 };
  });
  check(cr.warn, '冷凍噴霧機：噴嘴結霜的預警（bossVis 1）');
  await shot('cryo-warn', 250);
  const cr2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'cryo' && !x.dead);
    const hp0 = p.hp;
    window.__step(200, () => e.bossVis === 2);
    window.__step(90);
    const st = window.__c1.status.filter((s) => s[0] === 'slow');
    return {
      hit: p.c1SlowHit || 0,
      dmg: hp0 - p.hp,
      slow: p.hasStatus ? p.hasStatus('slow') : st.length > 0 && st[0][2].k === 0.6 && st[0][2].qb === 1.5,
      vis: e.bossVis,
    };
  });
  check(
    cr2.hit > 0 && cr2.dmg > 0 && cr2.slow,
    `冷凍噴霧機：噴到時受傷並變慢（命中 ${cr2.hit} 次、${Math.round(cr2.dmg)}）`,
  );
  await shot('cryo-spray', 100);
  // ---- 冰原：冰錐迫擊砲 ----
  const im = await ev(() => {
    window.__clear();
    // 冰錐的拋物線（砲口 → 玩家腳下，1.5 秒、頂點高約 8 m）在隨機的冰原上會碰到坡道、丘陵、障礙物或可破壞的物件
    // （信號燈桿的判定球半徑 4 m 多；碰到時在半路或砲口就爆炸，落點的目標沒受傷；約 20%）：生成後（生成點會被挪開）
    // 照實際的位置檢查整條拋物線，不通就換下一個位置；停在那裡（只轉向）
    const g = window.__game,
      w = g.world,
      pl = g.player;
    // 砲口在機體上方約 4 m（依朝向前後差 1 m），所以檢查三條高度不同的拋物線、每點上下各留 0.4 m
    const arcClear = (q) =>
      [3.5, 4, 4.6].every((mh) => {
        const M = q.clone().setY(q.y + mh),
          L = pl.pos.clone().setY(w.groundAt(pl.pos.x, pl.pos.z, pl.pos.y + 1.5));
        const T = 1.5,
          G = 30;
        const v = L.clone().sub(M).divideScalar(T);
        v.y = (L.y - M.y + 0.5 * G * T * T) / T;
        for (let t = 0; t <= T; t += 0.02) {
          const P = M.clone().addScaledVector(v, t);
          P.y -= 0.5 * G * t * t;
          if (P.y < L.y + 0.5) break; // 落地
          for (const dy of [-0.4, 0, 0.4]) if (w.hitsWorld(P.clone().setY(P.y + dy))) return false;
          if ((w.props || []).some((o) => !o.dead && o.center().distanceTo(P) < (o.radius || 1) + 1.5))
            return false;
        }
        return true;
      });
    let e = null;
    for (let k = 0; k < 24 && !e; k++) {
      // 從正前方開始，左右交錯繞一圈（玩家旁邊有坡道時，從另一側打過來）
      const a = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.27,
        x = pl.pos.x - Math.sin(a) * 32,
        z = pl.pos.z - Math.cos(a) * 32;
      const c = g.spawnType('icemortar', 1, 1, new THREE.Vector3(x, w.groundAt(x, z, pl.pos.y + 2), z), 1);
      // 站在平地上（生成在坡道或丘陵上時，速度 0 也會滑下來、離開檢查過的位置）
      const flat = Math.abs(c.pos.y - w.terrainHeight(c.pos.x, c.pos.z)) < 0.3 && w.slopeOK(c.pos.x, c.pos.z);
      if (flat && arcClear(c.pos)) e = c;
      else {
        c.depart();
        g.enemies = g.enemies.filter((x) => x !== c);
      }
    }
    if (!e) e = window.__spawn('icemortar', 32);
    e.speedMul = 0;
    pl.yaw = pl.aimYaw = Math.atan2(-(e.pos.x - pl.pos.x), -(e.pos.z - pl.pos.z)); // 玩家面向它
    const n1 = window.__step(400, () => e.bossVis === 1);
    // 冰錐的傷害另外記下來（截圖時主迴圈也在跑，AP 的差可能被別的處理蓋過）
    const p = window.__game.player;
    p.__imHit = 0;
    if (!p.__imWrap) {
      p.__imWrap = true;
      const td = p.takeDamage;
      p.takeDamage = function (d, ...a) {
        if (a[1] && a[1].ai === 'icemortar') p.__imHit += d;
        return td.call(this, d, ...a);
      };
    }
    const n2 = window.__step(120, () => (e.c1Shots || 0) > 0);
    window.__hp0 = window.__game.player.hp;
    return { warn: n1 < 400, shot: n2 < 120 };
  });
  check(im.warn && im.shot, '冰錐迫擊砲：架砲預警後拋射冰錐（落點白圈）');
  await shot('icemortar-warn', 400);
  const im2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const hp0 = window.__hp0; // 發射時（截圖時主迴圈也可能讓冰錐落地）
    window.__step(150);
    const wl = window.__c1.walls[0];
    const W = (g.tWalls || [])[0];
    let blocks = false;
    if (W && wl) {
      // 從砲台側穿過冰牆的視線被擋住（臨時障礙物有碰撞、可當掩體）
      const c = wl[0].clone().setY(wl[0].y + 1.5);
      const e = g.enemies.find((x) => x.ai === 'icemortar');
      const to = c.clone().sub(e.pos).setY(0).normalize();
      blocks = g.world.losBlocked(c.clone().addScaledVector(to, -3), c.clone().addScaledVector(to, 3));
    }
    return {
      real: (g.tWalls || []).length,
      blocks,
      walls: g.c1Walls || 0,
      wall: wl ? { kind: wl[1].kind, hp: wl[1].hp, life: wl[1].life, d: wl[0].distanceTo(p.pos) } : null,
      dmg: Math.max(hp0 - p.hp, p.__imHit || 0),
    };
  });
  check(
    im2.walls > 0 && (!im2.wall || (im2.wall.kind === 'ice' && im2.wall.life === 20 && im2.wall.d < 8)),
    '冰錐迫擊砲：落點生成冰牆（' + JSON.stringify(im2.wall) + '）',
  );
  check(im2.real > 0 && im2.blocks, `冰錐迫擊砲：冰牆是真的障礙物、擋住視線（${im2.real} 面）`);
  check(im2.dmg > 0, `冰錐迫擊砲：落點的目標受傷（${Math.round(im2.dmg)}）`);
  await shot('icemortar-wall', 300);

  // ---- 技研都市：全像投影器 ----
  await enter('institute', 'core');
  const ho = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = window.__spawn('holo', 30);
    p.lock = e;
    const n1 = window.__step(300, () => e.bossVis === 1);
    window.__step(120, () => e.fakesOf_c1().length > 0);
    const fakes = e.fakesOf_c1();
    const cands = g.lockCands(p);
    return {
      warn: n1 < 300,
      n: fakes.length,
      stolen: !!p.lock && p.lock.ai === 'holofake',
      first: cands.length ? cands[0].ai : null,
      lockable: fakes.every((f) => !f.noLock),
      // 殘存敵軍（HUD、波次門檻、清除判定）不算假敵人
      alive: g.enemies.filter((x) => !x.dead && !x.guardOf && !x.decoy).length,
      decoy: fakes.every((f) => f.decoy),
    };
  });
  check(ho.decoy && ho.alive === 1, `全像投影器：假敵人不算進殘存敵軍（${ho.alive}）`);
  check(ho.warn && ho.n === 3, `全像投影器：預警後投出 3 個假敵人（${ho.n}）`);
  check(
    ho.stolen && ho.first === 'holofake' && ho.lockable,
    '全像投影器：假敵人可以鎖定、搶走鎖定（自動鎖定先選到）' + JSON.stringify(ho),
  );
  await ev(() => window.__step(30));
  await shot('holo-fakes', 500);
  const ho2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'holoproj' && !x.dead);
    const fakes = e.fakesOf_c1();
    const coam = g.save.coam,
      kills = g.save.kills;
    fakes[0].takeDamage(30, 10, p, fakes[0].center(), new THREE.Vector3(0, 0, 1));
    const one = fakes[0].dead && fakes[0].gone && g.save.coam === coam && g.save.kills === kills;
    e.takeDamage(1e9, 0, p, e.center(), new THREE.Vector3(0, 0, 1));
    window.__step(5);
    return { one, rest: fakes.slice(1).every((f) => f.dead && f.gone), left: e.fakesOf_c1().length };
  });
  check(ho2.one, '全像投影器：假的打一下就消失，不給賞金、不算擊破');
  check(ho2.rest && ho2.left === 0, '全像投影器：本體被擊破時假敵人全部消失');
  // ---- 技研都市：寄生纏附體 ----
  const pa = await ev(() => {
    window.__clear();
    const e = window.__spawn('parasite', 6);
    const n1 = window.__step(300, () => e.bossVis === 1);
    return { crouch: n1 < 300 };
  });
  check(pa.crouch, '寄生纏附體：蹲伏預警（bossVis 1）');
  await shot('parasite-crouch', 200);
  const pa2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'parasite' && !x.dead);
    const n = window.__step(120, () => e.c1Latched > 0);
    window.__step(10);
    const st = window.__c1.status.find((s) => s[0] === 'latch');
    return {
      latched: n < 120,
      noLock: e.noLock,
      vis: e.bossVis,
      near: +e.pos.distanceTo(p.pos).toFixed(2),
      status: p.hasStatus ? p.hasStatus('latch') : !!st && st[2].src === e.id && st[2].dps > 0,
      cands: g.lockCands(p).includes(e),
    };
  });
  check(
    pa2.latched && pa2.noLock && pa2.vis === 2 && pa2.near < 3 && pa2.status && !pa2.cands,
    '寄生纏附體：撲上來纏附（跟著機體、不能鎖定、latch 狀態）' + JSON.stringify(pa2),
  );
  await shot('parasite-latch', 200);
  const pa3 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'parasite' && !x.dead);
    if (p.clearStatus && p.hasStatus) p.clearStatus('latch');
    const n = window.__step(300, () => e.c1Shaken > 0);
    return { shaken: n < 300, stag: +e.staggerT.toFixed(2), noLock: e.noLock };
  });
  check(pa3.shaken && pa3.stag > 1 && !pa3.noLock, '寄生纏附體：被甩掉時彈開並硬直' + JSON.stringify(pa3));

  // ---- Grid 086：重力錨 ----
  await enter('grid086', 'catwalks');
  const an = await ev(() => {
    const e = window.__spawn('anchor', 24);
    const n1 = window.__step(400, () => e.bossVis === 1);
    return { warn: n1 < 400 };
  });
  check(an.warn, '重力錨：錨樁的紫圈預警');
  await shot('anchor-warn', 400);
  const an2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'anchor' && !x.dead);
    window.__step(120, () => (g.c1Zones || 0) > 0);
    window.__step(5);
    const z = window.__c1.zones[0];
    return {
      nojump: p.hasStatus('nojump'),
      n: g.c1Zones || 0,
      zone: z ? { k: z[0], r: z[2], life: z[3], d: +z[1].distanceTo(p.pos).toFixed(2) } : null,
      vis: e.bossVis,
    };
  });
  check(
    an2.n > 0 &&
      an2.vis === 2 &&
      (!an2.zone || (an2.zone.k === 'gravity' && an2.zone.r === 14 && an2.zone.life === 8 && an2.zone.d < 6)),
    '重力錨：在目標腳下展開重力圈（' + JSON.stringify(an2.zone) + '）',
  );
  check(an2.nojump, '重力錨：重力圈裡的機體不能跳（nojump）');
  await shot('anchor-field', 300);
  // ---- Grid 086：滑索突擊兵 ----
  const zp = await ev(() => {
    window.__clear();
    const g = window.__game,
      p = g.player,
      w = g.world;
    // 找附近的上層平台站上去（找不到時放在地面 20 m 外）
    let deck = null;
    for (const o of w.obstacles) {
      if (o.kind !== 'box' || !o.deck || !(o.top > w.terrainHeight(o.x, o.z) + 4)) continue;
      const d = Math.hypot(o.x - p.pos.x, o.z - p.pos.z);
      if (d > 14 && d < 40 && (!deck || d < deck.d)) deck = { o, d };
    }
    const at = deck
      ? new THREE.Vector3(deck.o.x, deck.o.top, deck.o.z)
      : p.pos.clone().add(new THREE.Vector3(0, 0, -20));
    const e = g.spawnType('zipline', 1, 1, at, 1);
    const dv = e.pos.clone().sub(p.pos).setY(0).normalize();
    p.yaw = p.aimYaw = Math.atan2(-dv.x, -dv.z);
    const n1 = window.__step(600, () => e.bossVis === 1);
    return { warn: n1 < 600, deck: !!deck, h: e.pos.y - w.terrainHeight(e.pos.x, e.pos.z) };
  });
  check(zp.warn, `滑索突擊兵：纜索閃光的預警（平台上 ${zp.deck}、高 ${zp.h.toFixed(1)} m）`);
  await shot('zipline-warn', 300);
  const zp2 = await ev(() => {
    const g = window.__game,
      p = g.player;
    const e = g.enemies.find((x) => x.ai === 'zipline' && !x.dead);
    window.__step(300, () => e.aiState.zp === 'vuln');
    const f = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
    const rel = e.pos.clone().sub(p.pos).setY(0);
    const k = e.foeDefense_c1(100, 100);
    const out = {
      vuln: e.aiState.zp === 'vuln',
      d: +rel.length().toFixed(2),
      behind: +rel.normalize().dot(f).toFixed(2),
      k: k && k[0],
    };
    window.__step(60);
    out.after = e.foeDefense_c1(100, 100) === undefined && e.aiState.zp === 'fight';
    return out;
  });
  check(
    zp2.vuln && zp2.d < 8 && zp2.behind < 0 && zp2.k === 130 && zp2.after,
    '滑索突擊兵：滑到目標背後、落地 0.8 秒破綻受傷 ×1.3（' + JSON.stringify(zp2) + '）',
  );
  await shot('zipline-land', 150);
  await ctx.close();

  // ---- 模型庫：三視角（斜角、正面、側面）與三角形數 ----
  const lib = await newPage(browser, 'foes-c1-lib');
  for (const key of ['cryo', 'icemortar', 'holoproj', 'parasite', 'anchor', 'zipline']) {
    const lp = lib.page;
    await lp.goto(base + 'model-library.html#vehicle/foe_' + key);
    await lp.waitForSelector('#inspect:not([hidden])', { timeout: 15000 });
    await wait(2500);
    const info = (await lp.textContent('#insInfo')) || '';
    const m = info.replace(/,/g, '').match(/三角面\D*(\d+)/);
    const tris = m ? +m[1] : -1;
    check(tris > 0 && tris <= 6000, `模型庫 ${key}：三角面 ${tris}（≤ 6000）`);
    const box = await lp.$eval('#insGl', (c) => {
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
    const clip = { x: box.x, y: box.y, width: box.w, height: box.h };
    await lp.screenshot({ path: path.join(SHOT_DIR, `foes-c1-lib-${key}-oblique.png`), clip });
    // 拖曳旋轉（OrbitControls：水平拖曳畫布高度的像素＝轉一圈）
    const cx = box.x + box.w / 2,
      cy = box.y + box.h / 2;
    const rot = async (ang) => {
      await lp.mouse.move(cx, cy);
      await lp.mouse.down();
      await lp.mouse.move(cx + (ang / (Math.PI * 2)) * box.h, cy, { steps: 8 });
      await lp.mouse.up();
      await wait(1500);
    };
    await rot(-Math.PI / 4);
    await lp.screenshot({ path: path.join(SHOT_DIR, `foes-c1-lib-${key}-front.png`), clip });
    await rot(Math.PI / 2);
    await lp.screenshot({ path: path.join(SHOT_DIR, `foes-c1-lib-${key}-side.png`), clip });
  }
  await lib.ctx.close();
}
