// Coral 戰爭（RTS）電腦對電腦的勝率量測（docs/rts-design.md 14.9、14.17；R3 F 包）。
// headless Edge／Chrome 開 dist/rubicon-protocol.html（file://），兩邊都是電腦，以 rtsSim 快轉（不算繪）到分出勝負或時限，
// 記下每局的勝方、時間、雙方的陣營與開局、最大人口、融合用掉的單位、停擺建築秒數、第一次進攻的時間與決策耗時。
// 不放進冒煙測試（48 局約 20～60 分鐘，看平行數）。
//
//   node scripts/rts-matchup.js --a=castron --b=aetheric --seeds=24 --swap --diff=normal --themes=wasteland,snow,institute
//   node scripts/rts-matchup.js --a=aetheric --b=aetheric --seeds=24
//
// 參數：
//   --a、--b            兩隊的陣營（castron｜aetheric｜veerwell｜random）；--swap＝每個種子另外再打一局交換位置（共 2 × seeds 局）
//   --seeds=24          種子數；--seed0=1 第一個種子（種子＝seed0、seed0+1…）
//   --diff=normal       難度（兩邊一樣）
//   --themes=…          主題輪流（預設 wasteland,snow,institute）
//   --openers=a,b       指定兩隊的開局 id（預設隨機：依種子固定）
//   --max=2400          時限（局內秒；預設 40 分鐘）
//   --jobs=6            同時開幾個瀏覽器（每個瀏覽器一局一局跑）
//   --size=400          地圖大小
//   --tag=名稱          輸出檔名（預設 <a>-<b>）
//   --gpu=0             SwiftShader（預設顯示卡）
//   --log               每局的紀錄另外帶兩隊電腦的事件紀錄（A.log，除錯用）
// 輸出：test-results/rts-matchup-<tag>.json（每局的紀錄＋彙整），終端機印出彙整。需要先 npm run build。
/* global window -- page.evaluate 的回呼在瀏覽器端執行 */
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright-core');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'test-results');
const HTML = path.join(ROOT, 'dist', 'rubicon-protocol.html');

const args = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args[m[1]] = m[2] === undefined ? true : m[2];
}
const FA = args.a || 'castron',
  FB = args.b || 'aetheric';
const SEEDS = +(args.seeds || 24);
const SEED0 = +(args.seed0 || 1);
const SWAP = !!args.swap;
const DIFF = args.diff || 'normal';
const THEMES = String(args.themes || 'wasteland,snow,institute').split(',');
const OPENERS = args.openers ? String(args.openers).split(',') : null;
const MAX = +(args.max || 2400);
const JOBS = Math.max(1, +(args.jobs || 6));
const SIZE = +(args.size || 400);
const TAG = args.tag || `${FA}-${FB}`;
const GPU = args.gpu !== '0';

const EXE = [
  process.env.BENCH_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((p) => p && fs.existsSync(p));
const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

// 一局：在頁面裡開局、分段快轉（每段 60 秒，避免一次 evaluate 太久）
async function runGame(page, G) {
  await page.evaluate((G) => {
    const g = window.__game;
    g.rtsPathMs = Infinity;
    window.__reseed(G.seed * 7919 + (G.swap ? 17 : 3));
    g.rtsStart({
      theme: G.theme,
      seed: G.seed,
      size: G.size,
      aiFactions: G.facs,
      diff: G.diff,
      aiBoth: true,
      aiOpener: G.openers || null,
    });
    // AI 分批以鏡頭注視點為準：不算繪，固定在地圖中心（點對稱，兩隊一樣；docs 13.18）
    if (g.lodFrom) g.lodFrom.set(0, 0, 0);
    window.__mx = { pop: [0, 0], air: [0, 0] };
  }, G);
  for (;;) {
    const st = await page.evaluate((max) => {
      const g = window.__game,
        R = g.rts,
        M = window.__mx;
      const dt = 1 / 15;
      const end = Math.min(max, R.t + 60);
      while (R.t < end && !R.over) {
        g.rtsSim(dt);
        g.fx.update(dt);
        g.rtsFogTick(dt);
        for (const i of [0, 1]) M.pop[i] = Math.max(M.pop[i], R.teams[i].pop);
        // （R4）空中單位台數的最大值（每 2 秒量一次）
        if (Math.floor(R.t / 2) !== Math.floor((R.t - dt) / 2))
          for (const i of [0, 1]) {
            let n = 0;
            for (const e of R.units)
              if (!e.dead && e.rtsTeam === i && !e.bld && e.flying && !e.rtsDriven) n++;
            M.air[i] = Math.max(M.air[i], n);
          }
      }
      return { t: R.t, over: !!R.over };
    }, MAX);
    if (st.over || st.t >= MAX - 0.01) break;
  }
  return page.evaluate((log) => {
    const g = window.__game,
      R = g.rts,
      M = window.__mx;
    const res = {
      t: R.over ? R.over.t : R.t,
      over: !!R.over,
      win: R.over ? (R.over.win ? 0 : 1) : -1,
      facs: [0, 1].map((i) => R.teams[i].faction),
      ops: [0, 1].map((i) => {
        const A = R.ai.find((a) => a.team === i);
        return A ? A.op.id : '?';
      }),
      pop: M.pop,
      fused: [0, 1].map((i) => R.stats[i].fused || 0),
      offT: [0, 1].map((i) => Math.round(R.stats[i].offT || 0)),
      tier: [0, 1].map((i) => R.teams[i].tech.tier),
      first: [0, 1].map((i) => {
        const A = R.ai.find((a) => a.team === i);
        return A && A.firstAtk !== null ? Math.round(A.firstAtk) : null;
      }),
      ms: [0, 1].map((i) => {
        const A = R.ai.find((a) => a.team === i);
        return A ? +A.ms.toFixed(3) : 0;
      }),
      msMax: [0, 1].map((i) => {
        const A = R.ai.find((a) => a.team === i);
        return A ? +A.msMax.toFixed(1) : 0;
      }),
      killed: [0, 1].map((i) => R.stats[i].killed),
      lost: [0, 1].map((i) => R.stats[i].lost),
      // （R4 維爾威）空投（成功／被擊落）、信標、收起、交易、空中單位台數的最大值
      veer: [0, 1].map((i) => {
        const A = R.ai.find((a) => a.team === i);
        const st = R.stats[i];
        return {
          drops: st.drops || 0,
          dropLost: st.dropLost || 0,
          beacons: A ? A.fwdN || 0 : 0,
          packs: st.packs || 0,
          trades: st.trades || 0,
          air: M.air[i],
        };
      }),
    };
    // 各層的平均耗時（毫秒／決策，含 rtsOrder）與結束時的狀態（沒分出勝負時看是誰佔優勢）
    res.layers = [0, 1].map((i) => {
      const A = R.ai.find((a) => a.team === i);
      const o = {};
      if (A && A.psum) for (const k in A.psum) o[k] = +(A.psum[k] / Math.max(1, A.n)).toFixed(3);
      return o;
    });
    res.end = [0, 1].map((i) => {
      const A = R.ai.find((a) => a.team === i);
      const mine = R.units.filter((e) => !e.dead && e.rtsTeam === i);
      return {
        blds: mine.filter((e) => e.bld).length,
        hq: mine.filter((e) => e.bld && /_hq/.test(e.rtsDef)).length,
        army: mine.filter((e) => !e.bld && !e.hero && e.rtsDef && !/worker/.test(e.rtsDef)).length,
        mode: A ? A.mode : '',
        known: A && A.known ? A.known.length : 0,
        ore: Math.round(R.teams[i].ore),
        coral: Math.round(R.teams[i].coral),
      };
    });
    res.casts = [0, 1].map((i) => {
      const A = R.ai.find((a) => a.team === i);
      return A ? { ...(A.castLog || {}), ...(A.abLog || {}) } : {};
    });
    if (log) res.log = [0, 1].map((i) => (R.ai.find((a) => a.team === i) || { log: [] }).log.slice());
    return res;
  }, !!args.log);
}

async function worker(id, queue, out) {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: [
      ...(GPU
        ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
        : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
      '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
    ],
  });
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  await ctx.addInitScript(() => {
    let a = 1;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    window.__reseed = (s) => (a = s >>> 0 || 1);
  });
  let page = null;
  const open = async () => {
    if (page) await page.close().catch(() => {});
    page = await ctx.newPage();
    page.on('pageerror', (e) => console.log(`  [${id}] pageerror: ${e.message}`));
    await page.goto(pathToFileURL(HTML).href + '?test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await page.evaluate(() => {
      window.requestAnimationFrame = () => 0; // 停住主迴圈（只用 rtsSim 快轉）
    });
  };
  let n = 0;
  while (queue.length) {
    const G = queue.shift();
    // 每 4 局重開頁面（釋放記憶體）
    if (!page || n % 4 === 0) await open();
    n++;
    const t0 = Date.now();
    let r;
    try {
      r = await runGame(page, G);
    } catch (e) {
      console.log(`  [${id}] 種子 ${G.seed} 失敗：${e.message}`);
      page = null;
      continue;
    }
    r.seed = G.seed;
    r.theme = G.theme;
    r.swap = G.swap;
    r.wall = Math.round((Date.now() - t0) / 1000);
    out.push(r);
    console.log(
      `  [${id}] 種子 ${G.seed}（${G.theme}）${r.facs[0]}/${r.ops[0]} 對 ${r.facs[1]}/${r.ops[1]}：` +
        (r.over ? `${fmt(r.t)} 隊伍 ${r.win}（${r.facs[r.win]}）勝` : `${fmt(r.t)} 未分勝負`) +
        `；人口 ${r.pop.join('/')}、融合 ${r.fused.join('/')}、停擺 ${r.offT.join('/')} 秒、` +
        `首攻 ${r.first.map((f) => (f === null ? '—' : fmt(f))).join('/')}、決策 ${r.ms.join('/')} ms（${r.wall} 秒）`,
    );
  }
  await browser.close();
}

function summary(rs) {
  const S = { games: rs.length };
  const done = rs.filter((r) => r.over);
  S.decided = done.length;
  S.in30 = done.filter((r) => r.t <= 1800).length;
  S.in40 = done.filter((r) => r.t <= 2400).length;
  S.avgMin = done.length ? +(done.reduce((s, r) => s + r.t, 0) / done.length / 60).toFixed(1) : null;
  S.team0 = done.filter((r) => r.win === 0).length;
  S.team1 = done.filter((r) => r.win === 1).length;
  const facW = {};
  for (const r of done) facW[r.facs[r.win]] = (facW[r.facs[r.win]] || 0) + 1;
  S.facWins = facW;
  // 開局別：每個開局（陣營/開局）的勝敗
  const op = {};
  for (const r of done)
    for (const i of [0, 1]) {
      const k = r.facs[i] + '/' + r.ops[i];
      op[k] = op[k] || { w: 0, l: 0 };
      if (r.win === i) op[k].w++;
      else op[k].l++;
    }
  S.openers = op;
  const ms = rs.flatMap((r) => r.ms);
  S.msAvg = ms.length ? +(ms.reduce((s, m) => s + m, 0) / ms.length).toFixed(3) : 0;
  S.msMaxAvg = Math.max(0, ...ms);
  return S;
}

(async () => {
  if (!fs.existsSync(HTML)) throw new Error('找不到 dist/rubicon-protocol.html，先執行 npm run build');
  if (!EXE) throw new Error('找不到 Edge／Chrome（可用環境變數 BENCH_BROWSER 指定）');
  fs.mkdirSync(OUT, { recursive: true });
  const queue = [];
  for (let i = 0; i < SEEDS; i++) {
    const seed = SEED0 + i;
    const theme = THEMES[i % THEMES.length];
    const base = { seed, theme, size: SIZE, diff: DIFF };
    queue.push({ ...base, facs: [FA, FB], openers: OPENERS, swap: false });
    if (SWAP)
      queue.push({ ...base, facs: [FB, FA], openers: OPENERS ? [OPENERS[1], OPENERS[0]] : null, swap: true });
  }
  console.log(
    `Coral 戰爭的勝率：${FA} 對 ${FB}（${DIFF}）${queue.length} 局、${JOBS} 個瀏覽器、時限 ${fmt(MAX)}`,
  );
  const t0 = Date.now();
  const out = [];
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, (_, i) => worker(i, queue, out)));
  out.sort((a, b) => a.seed - b.seed || a.swap - b.swap);
  const S = summary(out);
  const file = path.join(OUT, `rts-matchup-${TAG}.json`);
  fs.writeFileSync(file, JSON.stringify({ args, summary: S, games: out }, null, 1));
  console.log('\n彙整：');
  console.log(
    `  ${S.games} 局：分出勝負 ${S.decided}（30 分鐘內 ${S.in30}＝${Math.round((100 * S.in30) / Math.max(1, S.games))}%、` +
      `40 分鐘內 ${S.in40}＝${Math.round((100 * S.in40) / Math.max(1, S.games))}%）、平均 ${S.avgMin} 分`,
  );
  console.log(`  隊伍 0 勝 ${S.team0}、隊伍 1 勝 ${S.team1}；陣營：${JSON.stringify(S.facWins)}`);
  console.log(`  開局：${JSON.stringify(S.openers)}`);
  console.log(
    `  決策平均 ${S.msAvg} ms（最長 ${S.msMaxAvg} ms）；用了 ${Math.round((Date.now() - t0) / 60000)} 分鐘`,
  );
  console.log(`  → ${path.relative(ROOT, file)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
