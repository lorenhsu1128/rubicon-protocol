// RTS 大量單位的效能基準（R0：docs/rts-design.md 的 8.3）
// 用 headless Edge／Chrome 開 dist/rubicon-protocol.html，出擊後清掉原本的敵人，生成兩隊互打的機體（約 10% AC），
// 每種單位數暖機後量測 FPS、1% low、更新／渲染 ms、draw calls、三角形，並把結果寫成 JSON。
//
//   npm run bench:rts                         預設 0,20,40,80,120 台、近鏡頭、顯示卡算繪
//   npm run bench:rts -- --counts=40,120 --cam=far --hp --tag=after
//
// 參數：
//   --counts=0,20,40      單位數清單（兩隊各一半）
//   --cam=near|far        near＝照遊戲的鏡頭（俯視跟著玩家）；far＝從 85 m 高往下看整個戰場
//   --hp                  強制高效能顯示卡（--force_high_performance_gpu，雙顯示卡的筆電）
//   --gpu=0               改用 SwiftShader 軟體算繪（很慢，只用來比較）
//   --measure=10          每種單位數量測幾秒（暖機另外 3 秒）
//   --warm=3              暖機秒數
//   --profile=120         這個單位數時另外錄 CPU profile（.cpuprofile ＋ 排名 JSON）
//   --lod=0               關掉距離分級（g.lod＝false），比較用
//   --aibatch=on|off|auto AI 分批（g.aiBatch；auto＝依單位數）
//   --ab                  同一個頁面交替量測 off（關掉距離分級與 AI 分批）與 on，各量 measure 秒（比較用）
//   --shots               每種單位數存一張截圖
//   --vsync               不關垂直同步與幀率上限（預設關掉，才量得到 60 FPS 以上）
//   --rts                 RTS 渲染設定（g.setRtsRender(true)）＋ RTS 鏡頭：俯角約 55°、看著戰場中心，
//                         距離 near＝60 m、far＝90 m（--dist=公尺 另訂）；--ssao=off|depth|half|full 換掉 RTS 的 SSAO 設定
//   --hud=rts             HUD 換成 RTS 的（只畫受傷單位的血條，同 game/rts-hud.js 的 rtsDrawOverlay），不畫一般任務的
//                         名牌與 HUD（120 台的名牌文字在 2D 畫布上點陣化要好幾 ms，不在 JS 的計時裡、但會拉長每一格）
//   --tag=名稱            輸出檔名的標記（預設 gpu／swiftshader＋鏡頭）
//   --seed=1              擺放位置的亂數種子
// 輸出：test-results/rts-bench-<tag>.json（以及截圖、profile）。需要先 npm run build；瀏覽器可用 BENCH_BROWSER 指定。
/* global window, document, localStorage, getComputedStyle, innerWidth, innerHeight, devicePixelRatio, THREE -- page.evaluate 的回呼在瀏覽器端執行 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const HTML = path.join(ROOT, 'dist', 'rubicon-protocol.html');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const GPU = args.gpu !== '0';
const COUNTS = String(args.counts || '0,20,40,80,120')
  .split(',')
  .map(Number)
  .filter((n) => n >= 0);
const CAM = args.cam === 'far' ? 'far' : 'near';
const MEASURE = +(args.measure || 10);
const WARM = +(args.warm || 3);
const PROFILE_N = args.profile === undefined ? -1 : args.profile === true ? 120 : +args.profile;
const TAG =
  args.tag ||
  `${GPU ? 'gpu' : 'swiftshader'}-${args.rts ? 'rts-' : ''}${args.hud === 'rts' ? 'rtshud-' : ''}${args.cam === 'far' ? 'far' : 'near'}`;
const SEED = +(args.seed || 1);
const AB = !!args.ab;
const LOD_TAG = args.lod === '0' ? 'off' : 'on';
const RTS = !!args.rts;
const RTS_DIST = +(args.dist || (CAM === 'far' ? 90 : 60));
const HUD = args.hud === 'rts' ? 'rts' : 'mission';

const EXE = [
  process.env.BENCH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(HTML)) throw new Error('找不到 dist/rubicon-protocol.html，先執行 npm run build');
  if (!EXE) throw new Error('找不到 Edge／Chrome（可用環境變數 BENCH_BROWSER 指定）');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: [
      ...(GPU
        ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      ...(args.vsync ? [] : ['--disable-gpu-vsync', '--disable-frame-rate-limit']),
      ...(args.hp ? ['--force_high_performance_gpu'] : []),
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript((seed) => {
    localStorage.setItem('rubicon_map', 'industrial');
    localStorage.setItem('rubicon_variant', 'base');
    // 頁面的亂數固定種子（mulberry32）：戰況每次接近，比較不同設定時的雜訊小一點
    let a = seed >>> 0 || 1;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }, SEED);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.goto('file:///' + HTML.replace(/\\/g, '/') + '?test');
  await page.waitForFunction(
    () => {
      const t = document.getElementById('title');
      return window.__game && t && getComputedStyle(t).display !== 'none';
    },
    null,
    { timeout: 60000 },
  );
  await sleep(1000);
  const glInfo = await page.evaluate(() => {
    const gl = window.__game.renderer.getContext();
    const e = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      w: innerWidth,
      h: innerHeight,
      dpr: devicePixelRatio,
    };
  });
  console.log(`WebGL 算繪器：${glInfo.renderer}（${glInfo.w}×${glInfo.h}，dpr ${glInfo.dpr}）`);
  console.log(
    `鏡頭 ${CAM}${RTS ? `（RTS 渲染設定，距離 ${RTS_DIST} m）` : ''}、量測 ${MEASURE} 秒、單位數 ${COUNTS.join(',')}`,
  );

  await page.evaluate(() => {
    const g = window.__game;
    g.save.level = 1;
    g.startMission();
  });
  await sleep(4000);
  // 安裝量測：包住主要的更新函式累計耗時，主迴圈每格記錄 draw calls 與三角形
  await page.evaluate(
    ({ far, lod, aiBatch, rts, rtsDist, ssao, hud }) => {
      const g = window.__game;
      const pl = g.player;
      pl.takeDamage = () => 0; // 玩家無敵
      pl.hp = pl.maxHp;
      g.spawnIdle = false;
      if (lod === '0') g.lod = false;
      if (aiBatch === 'on') g.aiBatch = true;
      else if (aiBatch === 'off') g.aiBatch = false;
      const T = (window.__T = { acc: {} });
      const wrap = (obj, name, key) => {
        const f = obj[name];
        if (!f || f.__w) return;
        const w = function (...a) {
          const t0 = performance.now();
          try {
            return f.apply(this, a);
          } finally {
            T.acc[key] = (T.acc[key] || 0) + performance.now() - t0;
          }
        };
        w.__w = 1;
        obj[name] = w;
      };
      const MP = Object.getPrototypeOf(pl);
      wrap(MP, 'updateAI', 'updateAI');
      wrap(MP, 'move', 'move');
      wrap(MP, 'fire', 'fire');
      wrap(g, 'separateMechs', 'separateMechs');
      wrap(g, 'aiDirectorTick', 'aiDirector');
      wrap(g, 'lodTick', 'lod');
      wrap(g, 'updateSupport', 'updateSupport');
      wrap(g, 'updateMapExtras', 'mapExtras');
      wrap(g, 'updateCamera', 'camera');
      if (rts) {
        // RTS 鏡頭（同 game/rts-input.js 的 rtsCamApply）：俯角約 55°，看著戰場中心
        g.setRtsRender(true);
        if (ssao) g.setLowFx({ ssao, mblur: false });
        const uc = g.updateCamera;
        g.updateCamera = function (dt) {
          uc.call(this, dt);
          const cam = g.camera,
            pitch = 0.96,
            D = rtsDist;
          const gy = g.world.terrainHeight(0, 0);
          cam.position.set(0, gy + Math.sin(pitch) * D, Math.cos(pitch) * D);
          cam.up.set(0, 1, 0);
          cam.lookAt(0, gy, 0);
          const fr = Math.max(1200, D * 6);
          if (cam.far !== fr) {
            cam.far = fr;
            cam.updateProjectionMatrix();
          }
          g.camExtra = D * 1.7 + 140;
          if (g.sun) {
            g.sun.position.set(0, gy, 0).add(g.sunOff);
            g.sun.target.position.set(0, gy, 0);
            const sc = g.sun.shadow.camera,
              Rr = Math.min(160, Math.max(70, D * 0.9));
            if (sc.right !== Rr) {
              sc.left = sc.bottom = -Rr;
              sc.right = sc.top = Rr;
              sc.updateProjectionMatrix();
            }
          }
        };
      } else if (far) {
        const uc = g.updateCamera;
        g.updateCamera = function (dt) {
          uc.call(this, dt);
          g.camera.position.set(0, 85, 85 * 0.62);
          g.camera.lookAt(0, 0, 0);
          g.camExtra = 85 * 1.1;
        };
      }
      if (hud === 'rts') {
        // RTS 的 HUD：受傷單位的血條（沒有名牌、文字）
        const v = new THREE.Vector3();
        g.drawHud = function () {
          const c = g.hctx;
          if (!c) return;
          c.clearRect(0, 0, innerWidth, innerHeight);
          for (const L of [g.enemies, g.allies])
            for (const e of L) {
              if (e.dead || e.hp >= e.maxHp - 0.5) continue;
              v.copy(e.pos);
              v.y += 3;
              v.project(g.camera);
              if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
              const x = ((v.x + 1) / 2) * innerWidth,
                y = ((1 - v.y) / 2) * innerHeight;
              c.fillStyle = 'rgba(0,0,0,0.65)';
              c.fillRect(x - 14, y - 1, 28, 5);
              c.fillStyle = e.team === 'enemy' ? '#ff6a4a' : '#4cff7a';
              c.fillRect(x - 13, y, 26 * Math.max(0, e.hp / e.maxHp), 3);
            }
        };
      }
      wrap(g, 'updatePlayer', 'player');
      wrap(g.fx, 'update', 'fx');
      wrap(g, 'renderMain', 'render');
      wrap(g, 'drawHud', 'hud');
      g.renderer.info.autoReset = false;
      const orig = g.loop;
      const R = (window.__R = { on: false, frames: [] });
      g.loop = function () {
        if (g.projectiles.length) {
          const PP = Object.getPrototypeOf(g.projectiles[0]);
          if (!PP.update.__w) wrap(PP, 'update', 'projectiles');
        }
        const t0 = performance.now();
        g.renderer.info.reset();
        const a0 = Object.assign({}, T.acc);
        orig.call(this);
        const t1 = performance.now();
        if (R.on) {
          const d = {};
          for (const k in T.acc) d[k] = T.acc[k] - (a0[k] || 0);
          R.frames.push({
            t: t0,
            loop: t1 - t0,
            d,
            calls: g.renderer.info.render.calls,
            tris: g.renderer.info.render.triangles,
            proj: g.projectiles.length,
            fxN: g.fx.list.length,
          });
        }
      };
    },
    {
      far: CAM === 'far',
      lod: args.lod,
      aiBatch: args.aibatch,
      rts: RTS,
      rtsDist: RTS_DIST,
      ssao: args.ssao,
      hud: HUD,
    },
  );

  const results = [];
  for (const N of COUNTS) {
    const info = await page.evaluate(
      ({ N, seed }) => {
        const g = window.__game;
        const w = g.world;
        let s = (seed * 2654435761 + N * 97) >>> 0 || 1;
        const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
        for (const e of g.enemies) e.cleanup && e.cleanup();
        for (const e of g.allies) e.cleanup && e.cleanup();
        g.enemies.length = 0;
        g.allies.length = 0;
        g.waves = [];
        g.wavePend = null;
        for (const p of g.projectiles) {
          p.dead = true;
          if (p.mesh && p.mesh.parent) p.mesh.parent.remove(p.mesh);
        }
        g.projectiles.length = 0;
        g.state = 'play';
        const pl = g.player;
        pl.hp = pl.maxHp;
        const L = w.lim;
        pl.pos.set(0, w.groundAt(0, 26, 99), 26);
        pl.vel.set(0, 0, 0);
        pl.mesh.position.copy(pl.pos);
        const TYPES = ['mt', 'mth', 'mt_shot', 'drone', 'mt_gren', 'tank', 'mt', 'heli', 'strider', 'ac'];
        const half = N / 2;
        const spread = Math.min(L * 0.85, 14 + Math.sqrt(half) * 3.2);
        const mk = (i, team) => {
          const t = TYPES[i % TYPES.length];
          const side = team === 'enemy' ? 1 : -1;
          const x = Math.max(-L * 0.95, Math.min(L * 0.95, side * (10 + rand() * spread * 0.9)));
          const z = Math.max(-L * 0.95, Math.min(L * 0.95, (rand() * 2 - 1) * spread));
          const [qx, qz] = w.collide(x, z, 50, 1.8);
          const at = new THREE.Vector3(qx, w.groundAt(qx, qz, 99), qz);
          const e = g.spawnType(t, g.scaleHp * 25, g.scaleDmg, at, 1);
          if (team === 'ally') {
            const k = g.enemies.indexOf(e);
            if (k >= 0) g.enemies.splice(k, 1);
            e.team = 'ally';
            e.allyT = 1e9;
            e.sn = null;
            g.allies.push(e);
          }
        };
        for (let i = 0; i < half; i++) mk(i, 'ally');
        for (let i = 0; i < half; i++) mk(i, 'enemy');
        g.waves = [];
        g.wavePend = null;
        if (g.rtsR) g.rtsRenderTick(); // RTS 渲染設定：網格合併在第一次算繪前（render/rts-merge.js）
        let meshes = 0;
        for (const e of [...g.enemies, ...g.allies])
          e.mesh.traverse((o) => o.isMesh && o.visible && o.layers.mask && meshes++);
        return { en: g.enemies.length, al: g.allies.length, spread: Math.round(spread), meshes };
      },
      { N, seed: SEED },
    );
    await sleep(WARM * 1000);
    if (AB) {
      // 同一個頁面交替量測：關掉距離分級與 AI 分批（off）→ 預設（on）→ off → on，排除其他程序與建置的干擾
      const segs = { off: [], on: [] };
      for (const mode of ['off', 'on', 'off', 'on']) {
        await page.evaluate((mode) => {
          const g = window.__game;
          g.lod = mode === 'off' ? false : undefined;
          g.aiBatch = mode === 'off' ? false : undefined;
        }, mode);
        await sleep(1000);
        await page.evaluate(() => {
          window.__R.frames = [];
          window.__R.on = true;
        });
        await sleep((MEASURE * 1000) / 2);
        segs[mode].push(
          await page.evaluate(() => {
            const R = window.__R;
            R.on = false;
            const f = R.frames;
            R.frames = [];
            return f;
          }),
        );
      }
      for (const mode of ['off', 'on']) {
        const row = summarize(N, segs[mode], info, 0);
        row.mode = mode;
        results.push(row);
        printRow(row);
      }
      continue;
    }
    await page.evaluate(() => {
      window.__R.frames = [];
      window.__R.on = true;
    });
    const doProf = PROFILE_N === N;
    let cdp = null;
    if (doProf) {
      cdp = await ctx.newCDPSession(page);
      await cdp.send('Profiler.enable');
      await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      await cdp.send('Profiler.start');
    }
    await sleep(MEASURE * 1000);
    const prof = doProf ? (await cdp.send('Profiler.stop')).profile : null;
    const fr = await page.evaluate(() => {
      const R = window.__R;
      R.on = false;
      const f = R.frames;
      R.frames = [];
      return f;
    });
    const alive = await page.evaluate(() => {
      const g = window.__game;
      return g.enemies.filter((e) => !e.dead).length + g.allies.filter((e) => !e.dead).length;
    });
    const row = summarize(N, [fr], info, alive);
    results.push(row);
    printRow(row);
    if (args.shots) await page.screenshot({ path: path.join(OUT, `rts-bench-${TAG}-${N}.png`) });
    if (prof) {
      fs.writeFileSync(path.join(OUT, `rts-bench-${TAG}-${N}.cpuprofile`), JSON.stringify(prof));
      const top = analyze(prof);
      fs.writeFileSync(path.join(OUT, `rts-bench-${TAG}-${N}-profile.json`), JSON.stringify(top, null, 1));
      console.log('  CPU profile（自身耗時前 15）：');
      for (const [k, v] of top.self.slice(0, 15)) console.log(`    ${v.toFixed(2).padStart(6)}%  ${k}`);
    }
  }
  console.log('');
  printTable(results);
  const file = path.join(OUT, `rts-bench-${TAG}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      { date: new Date().toISOString(), glInfo, cam: CAM, args, results, pageErrors: errs },
      null,
      1,
    ),
  );
  console.log(`\n結果：${path.relative(ROOT, file)}${errs.length ? `；頁面錯誤 ${errs.length} 個` : ''}`);
  for (const e of errs.slice(0, 5)) console.log('  ' + e);
  await browser.close();
  process.exit(errs.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

// segs：一段或多段連續的格（多段時各段之間的空檔不算）
function summarize(N, segs, info, alive) {
  const iv = [];
  for (const sg of segs) for (let i = 1; i < sg.length; i++) iv.push(sg[i].t - sg[i - 1].t);
  const fr = [].concat(...segs);
  const span = iv.reduce((a, b) => a + b, 0) || 1;
  const fps = iv.length / (span / 1000);
  const sorted = iv.slice().sort((a, b) => b - a);
  const n1 = Math.max(1, Math.floor(sorted.length * 0.01));
  const low1 = sorted.length ? 1000 / (sorted.slice(0, n1).reduce((s, x) => s + x, 0) / n1) : 0;
  const n = Math.max(1, fr.length);
  const avg = (fn) => fr.reduce((s, x) => s + fn(x), 0) / n;
  const keys = new Set();
  fr.forEach((x) => Object.keys(x.d).forEach((k) => keys.add(k)));
  const per = {};
  for (const k of keys) per[k] = +avg((x) => x.d[k] || 0).toFixed(2);
  const render = per.render || 0,
    hud = per.hud || 0,
    loop = avg((x) => x.loop);
  return {
    N,
    spawned: info,
    alive,
    frames: fr.length,
    fps: +fps.toFixed(1),
    low1: +low1.toFixed(1),
    frameMs: +(span / Math.max(1, iv.length)).toFixed(2),
    loopMs: +loop.toFixed(2),
    updateMs: +(loop - render - hud).toFixed(2),
    renderMs: render,
    hudMs: hud,
    per,
    calls: Math.round(avg((x) => x.calls)),
    tris: Math.round(avg((x) => x.tris)),
    proj: +avg((x) => x.proj).toFixed(1),
    fxN: Math.round(avg((x) => x.fxN)),
  };
}

function printRow(r) {
  const p = r.per;
  console.log(
    `[${r.N} 台${r.mode ? ' ' + r.mode : ''}] FPS ${r.fps}（1% low ${r.low1}）更新 ${r.updateMs} ms（AI ${p.updateAI || 0}、移動 ${p.move || 0}、` +
      `粒子 ${p.fx || 0}／${r.fxN} 個）渲染 ${r.renderMs} ms、draw calls ${r.calls}、三角形 ${r.tris}、網格 ${r.spawned.meshes}`,
  );
}

function printTable(rows) {
  const head = ['單位數', '分級', 'FPS', '1% low', '更新 ms', '渲染 ms', 'draw calls', '三角形'];
  const body = rows.map((r) => [
    r.N,
    r.mode || LOD_TAG,
    r.fps,
    r.low1,
    r.updateMs,
    r.renderMs,
    r.calls >= 1000 ? (r.calls / 1000).toFixed(1) + 'k' : r.calls,
    r.tris >= 10000 ? (r.tris / 10000).toFixed(0) + ' 萬' : r.tris,
  ]);
  console.log('| ' + head.join(' | ') + ' |');
  console.log('|' + head.map(() => '---').join('|') + '|');
  for (const b of body) console.log('| ' + b.join(' | ') + ' |');
}

// CPU profile：依自身耗時與總耗時排名（百分比）
function analyze(p) {
  const byId = new Map();
  for (const n of p.nodes) byId.set(n.id, n);
  const parent = new Map();
  for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const name = (n) => {
    const cf = n.callFrame;
    const file = cf.url ? cf.url.split('/').pop().split('?')[0] : '';
    return (cf.functionName || '(anon)') + (file ? `@${file}:${cf.lineNumber}:${cf.columnNumber}` : '');
  };
  const dts = p.timeDeltas;
  const self = new Map(),
    total = new Map();
  let all = 0;
  for (let i = 0; i < p.samples.length; i++) {
    const dt = dts[i + 1] !== undefined ? dts[i + 1] : 0;
    all += dt;
    let id = p.samples[i];
    const k0 = name(byId.get(id));
    self.set(k0, (self.get(k0) || 0) + dt);
    const seen = new Set();
    while (id !== undefined) {
      const k = name(byId.get(id));
      if (!seen.has(k)) {
        seen.add(k);
        total.set(k, (total.get(k) || 0) + dt);
      }
      id = parent.get(id);
    }
  }
  const fmt = (m) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([k, v]) => [k, +((v / all) * 100).toFixed(2)]);
  return { allMs: all / 1000, self: fmt(self), total: fmt(total) };
}
