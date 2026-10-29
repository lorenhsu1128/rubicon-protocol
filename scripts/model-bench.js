// 程式模型精細化的量測（docs/model-detail.md）：
//   模型：模型庫每個載具／地圖物件／小物件的三角形數、網格數（約等於繪製次數）、建造耗時
//   地圖：每個主題出擊後（清掉敵人）的繪製次數、三角形、平均幀時間（遊戲鏡頭與從上方看整張地圖）
//
//   node scripts/model-bench.js                       兩種都量，結果寫到 test-results/model-bench-<tag>.json
//   node scripts/model-bench.js --only=models --cat=vehicle --tag=after --compare=before
//
// 參數：--only=models|maps、--cat=vehicle,prop,small（模型的分類）、--maps=industrial,snow（地圖）、
//       --measure=3（每個鏡頭量幾秒）、--hp（強制高效能顯示卡；預設讓系統挑，雙顯示卡的筆電通常是內顯）、
//       --tag=名稱、--compare=名稱（和之前的結果比較，印出差異最大的項目）、--dist=資料夾（別的建置，例如舊版）。
//       頁面的亂數固定種子，每次的地圖相同。需要先 npm run build。
/* global window, document, getComputedStyle, localStorage, requestAnimationFrame -- page.evaluate 的回呼在瀏覽器端執行 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const TAG = args.tag || 'now';
const CATS = String(args.cat || 'vehicle,prop,small').split(',');
const MAPS = String(
  args.maps ||
    'industrial,grid,desert,snow,wasteland,dunes,flooded,dam,spaceport,grid086,xylem,orbit,institute',
).split(',');
const MEASURE = +(args.measure || 3);
const BROWSERS = [
  process.env.BENCH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// --dist＝改用別的建置資料夾（含 lib/；比較舊版用）
const DIST = args.dist ? path.resolve(args.dist) : path.join(ROOT, 'dist');
const url = (f) => require('url').pathToFileURL(path.join(DIST, f)).href + '?test';

async function models(browser) {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.goto(url('model-library.html'));
  await page.waitForFunction(() => window.__catalog, null, { timeout: 60000 });
  const res = await page.evaluate((cats) => {
    const out = {};
    for (const e of window.__catalog) {
      if (!cats.includes(e.cat)) continue;
      const t0 = performance.now();
      let b;
      try {
        b = e.build(e.pal);
      } catch (err) {
        out[e.id] = { err: String(err).slice(0, 120) };
        continue;
      }
      const ms = performance.now() - t0;
      let tris = 0,
        meshes = 0,
        fine = 0;
      (b.obj || b).traverse((o) => {
        if (!o.isMesh || o.visible === false) return;
        meshes++;
        const g = o.geometry,
          n = (g.index ? g.index.count : g.attributes.position.count) / 3;
        // 描邊外殼（背面放大）不算進模型的三角形
        if (o.material && o.material.side === 1 && o.material.type === 'ShaderMaterial') return;
        tris += n * (o.isInstancedMesh ? o.count : 1);
        if (o.userData.fine) fine += n;
      });
      out[e.id] = {
        cat: e.cat,
        name: e.name,
        tris: Math.round(tris),
        meshes,
        fine: Math.round(fine),
        ms: +ms.toFixed(1),
      };
    }
    return out;
  }, CATS);
  await page.close();
  return res;
}

async function maps(browser) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  // 頁面的亂數固定種子：每次量測的地圖相同，才能比較
  await page.addInitScript(() => {
    let a = 12345;
    window.__reseed = (v) => (a = v >>> 0);
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  await page.goto(url('rubicon-protocol.html'));
  await page.waitForFunction(
    () => {
      const t = document.getElementById('title');
      return window.__game && t && getComputedStyle(t).display !== 'none';
    },
    null,
    { timeout: 60000 },
  );
  await sleep(5000); // 等內建的玩家預設機甲（GLB）載入：沒載入時玩家的機體是沒合併的程式模型，繪製次數不同
  const gl = await page.evaluate(() => {
    const c = window.__game.renderer.getContext(),
      e = c.getExtension('WEBGL_debug_renderer_info');
    return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : c.getParameter(c.RENDERER);
  });
  console.log('WebGL 算繪器：' + gl);
  const out = { gl };
  for (const key of MAPS) {
    const t0 = Date.now();
    await page.evaluate((key) => {
      localStorage.setItem('rubicon_map', key);
      localStorage.setItem('rubicon_variant', 'base');
      const g = window.__game;
      g.save.level = 1;
      window.__reseed(7777); // 出擊前重設亂數：每個版本的地圖相同
      window.__tStart = performance.now();
      g.startMission();
      window.__tBuilt = performance.now() - window.__tStart;
    }, key);
    await sleep(2500);
    const r = await page.evaluate(
      async ({ sec }) => {
        const g = window.__game;
        for (const e of [...g.enemies]) e.dead || (e.die && e.die());
        g.enemies.length = 0;
        g.waves = [];
        g.wavePend = null;
        g.player.takeDamage = () => 0;
        let tris = 0,
          meshes = 0;
        g.scene.traverse((o) => {
          if (!o.isMesh) return;
          meshes++;
          const gg = o.geometry;
          tris +=
            ((gg.index ? gg.index.count : gg.attributes.position.count) / 3) *
            (o.isInstancedMesh ? o.count : 1);
        });
        const run = async (far) => {
          const uc = g.updateCamera;
          if (far)
            g.updateCamera = function (dt) {
              uc.call(this, dt);
              g.camera.position.set(0, 140, 110);
              g.camera.lookAt(0, 0, 0);
              g.camExtra = 160;
            };
          g.renderer.info.autoReset = false;
          // 暖機 1 秒（著色器編譯、陰影貼圖），之後量每一格的時間，取中位數與 90%
          await new Promise((res) => {
            const t1 = performance.now();
            const f = () => requestAnimationFrame(() => (performance.now() - t1 < 1000 ? f() : res()));
            f();
          });
          let n = 0,
            calls = 0,
            tr = 0;
          const dts = [];
          const t0 = performance.now();
          let last = t0;
          await new Promise((res) => {
            const f = () => {
              g.renderer.info.reset();
              requestAnimationFrame(() => {
                const now = performance.now();
                dts.push(now - last);
                last = now;
                calls += g.renderer.info.render.calls;
                tr += g.renderer.info.render.triangles;
                n++;
                if (now - t0 < sec * 1000) f();
                else res();
              });
            };
            f();
          });
          g.updateCamera = uc;
          g.renderer.info.autoReset = true;
          dts.sort((a, b) => a - b);
          return {
            ms: +dts[Math.floor(dts.length / 2)].toFixed(2),
            p90: +dts[Math.floor(dts.length * 0.9)].toFixed(2),
            calls: Math.round(calls / n),
            tris: Math.round(tr / n),
          };
        };
        const near = await run(false),
          far = await run(true);
        return {
          props: (g.world.props || []).length,
          meshes,
          sceneTris: Math.round(tris),
          build: +window.__tBuilt.toFixed(0),
          near,
          far,
        };
      },
      { sec: MEASURE },
    );
    r.wall = Date.now() - t0;
    out[key] = r;
    console.log(
      `${key.padEnd(11)} 物件 ${String(r.props).padStart(4)}  場景 ${String(r.meshes).padStart(5)} 網格 ${(r.sceneTris / 1e3).toFixed(0).padStart(5)}k 三角形  建造 ${r.build} ms  ` +
        `近：${r.near.ms} ms ${r.near.calls} 次 ${(r.near.tris / 1e3).toFixed(0)}k  遠：${r.far.ms} ms ${r.far.calls} 次 ${(r.far.tris / 1e3).toFixed(0)}k`,
    );
    await page.evaluate(() => window.__game.clearMission && window.__game.clearMission());
  }
  await page.close();
  return out;
}

(async () => {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  const browser = await chromium.launch({
    executablePath: exe,
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      ...(args.hp ? ['--force_high_performance_gpu'] : []),
    ],
  });
  const res = { tag: TAG, t: new Date().toISOString() };
  try {
    if (args.only !== 'maps') {
      res.models = await models(browser);
      const sum = {};
      for (const v of Object.values(res.models)) {
        if (v.err) continue;
        const s = (sum[v.cat] = sum[v.cat] || { n: 0, tris: 0, meshes: 0, max: 0 });
        s.n++;
        s.tris += v.tris;
        s.meshes += v.meshes;
        s.max = Math.max(s.max, v.tris);
      }
      for (const [c, s] of Object.entries(sum))
        console.log(
          `${c.padEnd(8)} ${s.n} 個：平均 ${Math.round(s.tris / s.n)} 三角形、最多 ${s.max}、平均 ${(s.meshes / s.n).toFixed(1)} 網格`,
        );
      const errs = Object.entries(res.models).filter(([, v]) => v.err);
      for (const [id, v] of errs) console.log('建造失敗 ' + id + '：' + v.err);
    }
    if (args.only !== 'models') res.maps = await maps(browser);
  } finally {
    await browser.close();
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `model-bench-${TAG}.json`), JSON.stringify(res, null, 1));
  if (args.compare) {
    const old = JSON.parse(fs.readFileSync(path.join(OUT, `model-bench-${args.compare}.json`), 'utf8'));
    if (res.models && old.models) {
      const d = Object.entries(res.models)
        .filter(([id, v]) => old.models[id] && !v.err && !old.models[id].err)
        .map(([id, v]) => [id, old.models[id].tris, v.tris, v.meshes - old.models[id].meshes])
        .filter((x) => x[1] !== x[2])
        .sort((a, b) => b[2] / Math.max(1, b[1]) - a[2] / Math.max(1, a[1]));
      for (const [id, a, b, dm] of d.slice(0, 40))
        console.log(
          `${id.padEnd(34)} ${String(a).padStart(6)} → ${String(b).padStart(6)} 三角形（×${(b / Math.max(1, a)).toFixed(1)}，網格 ${dm >= 0 ? '+' : ''}${dm}）`,
        );
    }
    if (res.maps && old.maps)
      for (const k of MAPS)
        if (res.maps[k] && old.maps[k])
          console.log(
            `${k.padEnd(11)} 近 ${old.maps[k].near.ms}→${res.maps[k].near.ms} ms、${old.maps[k].near.calls}→${res.maps[k].near.calls} 次；遠 ${old.maps[k].far.ms}→${res.maps[k].far.ms} ms、${old.maps[k].far.calls}→${res.maps[k].far.calls} 次`,
          );
  }
})();
