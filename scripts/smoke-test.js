// 冒煙測試：以 headless Edge/Chrome 開啟建置後的遊戲，收集頁面例外與 console 錯誤。
//   1. 直接開檔（file://）：標題畫面
//   2. 本機多分頁（?lan=local）：單機出擊、多人建房／加入／出擊、房主遷移
//   3. 區網伺服器（server.js，WebSocket 中繼）：/health、多人建房／加入／出擊
// 用法：node scripts/smoke-test.js [html 路徑] [--no-server]
//   指定 html 路徑時只跑 1、2（例如拿舊版單檔 HTML 當基準比對）；截圖存到 test-results/
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
const failures = [];
const errors = [];
function check(ok, label) {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}`);
  if (!ok) failures.push(label);
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

function freePort() {
  return new Promise((res) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

// 伺服器模型組的資料夾（測試用，每次重來）
const SERVER_MODELS = path.join(SHOT_DIR, 'server-models');
async function startGameServer() {
  const [gamePort, controlPort] = [await freePort(), await freePort()];
  fs.rmSync(SERVER_MODELS, { recursive: true, force: true });
  const proc = spawn(process.execPath, ['-r', './scripts/test-server-preload.js', 'server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      TEST_GAME_PORT: gamePort,
      TEST_CONTROL_PORT: controlPort,
      RUBICON_MODELS_DIR: SERVER_MODELS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${gamePort}/`;
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url + 'health');
      if (r.ok) return { proc, url, health: await r.text() };
    } catch (e) {}
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
  await page.selectOption('#labStyle', 'builtin:ac6');
  await page.selectOption('#labCam', 'cinema');
  await wait(1500);
  await page.screenshot({ path: path.join(SHOT_DIR, 'style-lab-ac6.png') });
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
  for (let i = 0; i < 40; i++) {
    await page.mouse.wheel(0, 700);
    await wait(250);
  }
  await wait(3000);
  const sizes = await page.$$eval('.cell .sz', (x) => x.map((e) => e.textContent));
  const bad = sizes.filter((t) => !/\d+\.\d\d × \d+\.\d\d × \d+\.\d\d m/.test(t)).length;
  check(bad === 0, `每格都標示公尺尺寸（未完成 ${bad} 格）`);
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
    const fp = path.join(SHOT_DIR, name);
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
  check(def === '-0.48', `手肘預設位置 Y＝${def}（glTF 座標）`);
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
  check((await page.$eval(elbowY, (i) => i.value)) === '-0.48', '重設後回到預設值');
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
  check(((await page.textContent('#wsChecks')) || '').includes('沒有明顯的縫隙'), '玩家初始機沒有穿幫提示');
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
  check(((await page.textContent(elbow + ' .cv')) || '').includes('-0.480'), '重設後回到預設值');
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
    (await cv(elbow)).includes('-0.480') && (await cv(lElbow)).includes('-0.480'),
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
  await page.click('#edRot button[data-ax="y"][data-deg="90"]');
  await wait(300);
  check((await stats()).includes('0.42 × 0.60 × 0.59'), `Y +90° 旋轉後寬深對調（${await stats()}）`);
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
  check((await stats()).includes('Y0.00 ～ 0.60'), `原點設在底面中心（${await stats()}）`);
  await page.keyboard.press('Control+z');
  await wait(400);
  check((await stats()).includes('Y-0.50 ～ 0.10'), `Ctrl+Z 復原原點修改（${await stats()}）`);
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
  await wait(1500);
  await reopen(page, base + 'model-library.html#head/h_std');
  await page.waitForSelector('#inspect:not([hidden])');
  await wait(2000);
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
  check(t0 > 20000 && t1 <= 3000 && t1 > 1500, `減到預算（${t0} → ${t1} 面，預算 3000）`);
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
  const fore = path.join(SHOT_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(SHOT_DIR, 'w_rifle_r_template.glb');
  if (!fs.existsSync(fore) || !fs.existsSync(rifle)) return check(false, '找不到模型庫測試產生的範本 GLB');
  const { ctx, page } = await newPage(browser, 'local-models');
  await page.goto(base);
  check(await waitVisible(page, 'title'), '標題畫面顯示');
  await page.click('#btnLmReload');
  await wait(300);
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
  // 戰區主題隨機：方格主題只有高柱，其他主題有碎塊、路燈桿、貨櫃
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
  check(!(await visible(mp, 'gLocal')), '多人時不套用本地模型');
  await ctx.close();
}

// 模型組：舊版資料庫（第 3 版）遷移成「預設」、新增／切換／複製／改名／刪除、匯出匯入、組裝調整記住零件組合、遊戲選模型組
async function testModelSets(browser, base) {
  console.log('模型組：遷移、切換、複製、匯出匯入、遊戲選模型組');
  const fore = path.join(SHOT_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(SHOT_DIR, 'w_rifle_r_template.glb');
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
  await wait(1500);
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
  await wait(1500);
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
  await ctx.close();
}

// 伺服器模型組：模型庫的伺服器預設組（整組發佈、直接編輯）→ 單人（敵人用伺服器組、自己用本地模型組）
// → 多人（兩個瀏覽器各自上傳模型組，房主與客機看到對方的機甲用對方的模型組，敵人用伺服器組）
async function testServerModels(browser, url) {
  console.log('伺服器模型組：伺服器預設組 → 單人套用 → 多人各自上傳模型組');
  const fore = path.join(SHOT_DIR, 'a_std_r_fore_template.glb');
  const rifle = path.join(SHOT_DIR, 'w_rifle_r_template.glb');
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
  check(await waitVisible(page, 'garage'), '返回車庫');
  check((await page.textContent('#stats')).includes('(+'), '車庫規格顯示技能加成');
  await page.screenshot({ path: path.join(SHOT_DIR, 'garage-pilot.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.click('#btnPilot');
  await wait(300);
  await page.screenshot({ path: path.join(SHOT_DIR, 'pilot-narrow.png') });
  await ctx.close();
}

// 房主建房 → 客機加入 → 雙方準備 → 出擊；migrate 為 true 時再測房主離線後的遷移
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

async function main() {
  if (!fs.existsSync(HTML)) throw new Error(`找不到 ${HTML}，請先執行 npm run build`);
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Edge 或 Chrome');
  console.log(`目標：${path.relative(ROOT, HTML)}`);
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: [
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const srv = await serveHtml();
  let game = null;
  try {
    const base = `http://127.0.0.1:${srv.address().port}/`;
    await testFile(browser);
    await testSolo(browser, base);
    await testSaves(browser, base + '?test');
    await testPilot(browser, base);
    await testLibrary(browser, base);
    await testLibraryGlb(browser, base);
    await testRefTools(browser, base);
    await testDraco(browser, base + 'model-library.html', 'http');
    await testDraco(browser, 'file:///' + LIBRARY.split(path.sep).join('/'), 'file');
    await testLibraryJoints(browser, base);
    await testWorkshop(browser, base);
    await testEditor(browser, base);
    await testEditorSplit(browser, base);
    await testEditorMaterials(browser, base);
    await testEditorTextures(browser, base);
    await testEditorFaces(browser, base);
    await testEditorOptimize(browser, base);
    await testPaint(browser);
    await testStyleLab(browser);
    await testLocalModels(browser, base);
    await testModelSets(browser, base);
    await testMultiplayer(browser, base + '?lan=local', 'local', true);
    if (WITH_SERVER) {
      console.log('區網伺服器：啟動 server.js');
      game = await startGameServer();
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
      await testServerModels(browser, game.url);
      await testMultiplayer(browser, game.url, 'server', false);
    }
  } finally {
    await browser.close();
    srv.close();
    if (game) game.proc.kill();
  }
  const uniq = [...new Set(errors)];
  check(uniq.length === 0, `沒有頁面錯誤（${uniq.length} 筆）`);
  for (const e of uniq) console.log('    ' + e);
  console.log(failures.length ? `\n失敗 ${failures.length} 項` : '\n全部通過');
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
