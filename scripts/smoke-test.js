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
          const a = e.model.arms[k].weapon;
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
          step(5);
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
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 1;
    g.startMission();
    g.state = 'lock-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e7;
    pl.pos.set(0, g.world.terrainHeight(0, 0), 0); // 地面上（中央可能有高架橋）
    pl.yaw = pl.aimYaw = 0; // 面向 −Z
    const reach = g.lockReach(pl);
    // 五台：前方近、前方遠、前方偏右、背後最近、正側面（畫面外）；其他敵人移走
    for (const e of g.enemies) e.pos.set(200, -50, 200);
    const es = g.enemies.slice(0, 5);
    while (es.length < 5) es.push(g.spawnEnemy({ name: 'T', asm: pl.asm, pal: 'enemy', ai: 'mt' }));
    // 放在地面上（不站到貨櫃、掩體頂，否則高度改變會影響是否在畫面內）
    const put = (e, x, z) => {
      e.pos.set(x, g.world.terrainHeight(x, z), z);
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
    await page.evaluate(() => getComputedStyle(document.getElementById('btnCamp')).display !== 'none'),
    '車庫有「主線（機庫）」按鈕',
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
  check(await waitVisible(page, 'hub'), '結果畫面「返回機庫」');
  const nodes2 = await page.$$eval('.hubNode', (l) => l.map((n) => n.dataset.sid + ':' + n.classList[1]));
  check(
    nodes2.includes('c1s1:done') && nodes2.includes('c1s2:open'),
    '完成後第 2 個委託開放（' + nodes2.join('、') + '）',
  );
  // 車庫：從機庫進入時左下是「返回機庫」
  await page.click('#btnHubGarage');
  await waitVisible(page, 'garage');
  check((await page.textContent('#btnToTitle')) === '返回機庫', '從機庫進車庫：按鈕變成「返回機庫」');
  await page.click('#btnToTitle');
  check(await waitVisible(page, 'hub'), '車庫返回機庫');
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
  await page.evaluate(() => {
    const g = window.__game;
    g.waves = [];
    g.wavePend = null; // 已預告、還沒出現的增援也取消
    for (const e of g.enemies)
      if (!e.dead) {
        if (e.ai === 'burrow') e.bossVis = 0; // 沙中伏擊者：先浮出地面
        e.takeDamage(1e9, 0, g.player, e.center(), new THREE.Vector3(0, 0, 1));
      }
  });
  check(await waitVisible(page, 'result', 8000), '模擬戰清除後顯示結果');
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
      comm: log.some((t) => t.includes('主壩的電力接上了')),
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
    step([sk], 70);
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
    const hm = g.spawnType('spacemt', 1, 1, at(0, -20), 1);
    let alt = 0;
    window.__step([hm], 400, () => {
      alt = Math.max(alt, hm.pos.y - w.terrainHeight(hm.pos.x, hm.pos.z));
      return false;
    });
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
    const rm = g.spawnType('rammer', 1, 1, at(0, -20), 1);
    const h0 = p.hp;
    let warned = false;
    window.__step([rm], 600, () => {
      if (rm.aiState.ph === 1) warned = true;
      return rm.aiState.hit;
    });
    out.ram = { warned, hit: !!rm.aiState.hit, hurt: h0 - p.hp, out: p.vel.x };
    rm.takeDamage(1e9, 0, p, rm.center(), new THREE.Vector3(0, 0, 1));
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

// 增援波次：編成分成 3～5 波、敵對 AC 在最後一波、剩下少數時預告方向（ECHO、光柱、畫面指示）後在預告地點出現
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
    for (const e of g.enemies) if (!e.guardOf) e.takeDamage(1e9, 0, pl, e.center());
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
    for (const e of g.enemies) if (!e.guardOf) e.takeDamage(1e9, 0, g.player, e.center());
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
  await page.goto(base + '?test');
  await waitVisible(page, 'title');
  const r = await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 5;
    g.startMission();
    g.state = 'modfx-test';
    const pl = g.player;
    pl.hp = pl.maxHp = 1e6;
    const dt = 1 / 60;
    const out = {};
    const foes = () => g.enemies.filter((e) => !e.dead && !e.isBoss && e.ai !== 'objective');
    const put = (e, x, z) => {
      e.pos.set(x, g.world.groundAt(x, z, 99), z);
      e.mesh.position.copy(e.pos);
    };
    const fresh = (n) => {
      while (foes().length < n) g.spawnType('mt', 1, 1);
      const list = foes().slice(0, n);
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
    put(a, 20, 20);
    put(b, 22, 20);
    a.takeDamage(1e9, 0, pl, a.center());
    out.blast = b.hp < b.maxHp;
    // 殉爆脈衝
    pl.pm = { ...pl.pm, killBlast: 0, killStag: 1 };
    [a, b] = fresh(2);
    put(a, -20, 20);
    put(b, -24, 20);
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
    put(pl, 0, -30);
    pl.vel.set(0, 0, 0);
    put(a, 0, -34);
    a.hp = a.maxHp = 1e7;
    a.iFrames = 0;
    pl.en = pl.enMax;
    for (let i = 0; i < 30; i++) {
      pl.move(dt, new THREE.Vector3(0, 0, -1), false, i === 0, false, null);
      a.vel.set(0, 0, 0);
      a.iFrames = 0;
    }
    out.ram = Math.round(1e7 - a.hp);
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
  check(r.ram >= 500, `衝撞推進：QB 撞上敵人造成 ${r.ram} 傷害`);
  check(
    r.last.inv && r.last.hp >= 35 && r.cool,
    `緊急障壁：AP 低於 30% 時無敵並回復（${r.last.hp}%），冷卻中不再觸發`,
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

// 各主題的第 5、6 種變體：生成、特徵（物件、涉水、夜間不疊加時間）、主線排程用得到、截圖
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
async function testMpBosses(browser, url) {
  console.log('多人 Boss：客機顯示電磁砲台的瞄準線、武裝列車出隧道、迷彩機與分身、三機合體分離');
  const cases = [
    { L: 10, key: 'halberd' },
    { L: 31, key: 'citadel' },
    { L: 22, key: 'mirage' },
    { L: 28, key: 'cerberus' },
  ];
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
    for (let i = 0; i < 160; i++) {
      await host.evaluate(() => window.__game.loop());
      await wait(15);
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
  // 投票：一人站進出口開始倒數
  await host.evaluate(() => {
    const g = window.__game,
      e = g.camp.exits[0];
    g.player.pos.set(e.pos.x, e.pos.y, e.pos.z);
  });
  await pump(60, () => host.evaluate(() => !!window.__game.camp.vote));
  const vote = await host.evaluate(() => !!window.__game.camp.vote && window.__game.camp.hint);
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
  await pump(150, () => host.evaluate(() => window.__game.state === 'camptrans'));
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
  const srv = await serveHtml();
  let game = null;
  try {
    const base = `http://127.0.0.1:${srv.address().port}/`;
    await testFile(browser);
    await testSolo(browser, base);
    await testMaps(browser, base + '?test');
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
    await testBosses(browser, base);
    await testBosses2(browser, base);
    await testLockOn(browser, base);
    await testBoundary(browser, base);
    await testCampaign(browser, base);
    await testCampaign2(browser, base);
    await testModules(browser, base);
    await testChapter1(browser, base);
    await testChapter2(browser, base);
    await testChapter3(browser, base);
    await testChapter4(browser, base);
    await testChapter5(browser, base);
    await testChapter6(browser, base);
    await testVariants6(browser, base);
    await testCycle2(browser, base);
    await testWaves(browser, base);
    await testOutposts(browser, base);
    await testModFx(browser, base);
    await testLocalModels(browser, base);
    await testModelSets(browser, base);
    await testMultiplayer(browser, base + '?lan=local', 'local', true);
    await testMpBosses(browser, base + '?lan=local&test');
    await testMpCampaign(browser, base + '?lan=local&test');
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
