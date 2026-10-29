// 冒煙測試的分段平行（scripts/smoke-test.js 呼叫）：把選到的步驟依相依群組分成單位，依上次的耗時
// （test-results/smoke-times.json，沒有時用 DEFAULT_TIMES）貪婪分配到 N 段，每段一個子程序
// （各自的瀏覽器、靜態伺服器、區網伺服器、暫存資料夾），最後彙整項數、失敗、頁面錯誤與耗時。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

// 對時間敏感的步驟（多人：兩分頁、背景分頁節流、房主失聯判定；追尾鏡頭的速度偏移、過場動畫的即時計時）：
// 負載高時容易偶發失敗。預設照常分配（失敗的由 coordinate 在最後單獨重跑一次）；SMOKE_SENSITIVE=last 時
// 排在最後一段單獨跑
const SENSITIVE = [
  'testMultiplayer',
  'testMpBosses',
  'testMpStatus',
  'testMpCampaign',
  'testMpLevels',
  'server',
  'testChase',
  'testCine',
];

// 沒有耗時紀錄時的估計（毫秒，顯示卡算繪、3 段平行時量到的值；只用來分配，比例對就好）
const DEFAULT_TIMES = {
  'testStyleThemes:1': 56046,
  'testMpBosses:halberd': 15312,
  testFile: 6611,
  testSolo: 14984,
  testMaps: 40443,
  testSaves: 5648,
  testPilot: 4838,
  testLibrary: 45553,
  testRefTools: 21126,
  testFoeModelsD1: 78599,
  testLibraryGlb: 34464,
  testDraco: 12441,
  testLibraryJoints: 7478,
  testWorkshop: 30266,
  testEditor: 21676,
  testEditorSplit: 32361,
  testEditorMaterials: 8470,
  testEditorTextures: 14142,
  testEditorFaces: 16346,
  testEditorOptimize: 9486,
  testPaint: 12665,
  testStyleLab: 30641,
  'testStyleThemes:2': 57141,
  'testStyleThemes:3': 37507,
  testBosses: 3336,
  testBosses2: 5178,
  testLockOn: 1614,
  testCamOcclusion: 3736,
  testChase: 12166,
  testPadUi: 5609,
  testBoundary: 1548,
  testCampaign: 47376,
  testCampaign2: 17321,
  testModules: 4232,
  testChapter1: 10653,
  testChapter2: 28025,
  testFoesB2: 50542,
  testFoesC1: 46090,
  testFoesC2: 30968,
  testChapter3: 17513,
  testChapter4: 11233,
  testChapter5: 10750,
  testChapter6: 7308,
  testFoeModelsD2: 14286,
  testVariants6: 12536,
  testCycle2: 2986,
  testCycle3: 4762,
  testStory: 6337,
  testCine: 49186,
  testTextFx: 5321,
  testLevels: 35443,
  testWaves: 2921,
  testGoals: 5403,
  testOutposts: 4148,
  testModFx: 2149,
  testSupply: 2433,
  testGuide: 1600,
  testRange: 11979,
  testAttrs: 2601,
  testAim: 1844,
  testAudio: 1848,
  testJuice: 2421,
  testFoesB1: 29235,
  testBossPower: 1775,
  testBossTier: 6000,
  testBossTier2: 6000,
  testBossKit12: 20000,
  testBossKit34: 20000,
  testBossKit56: 20000,
  testBoss3: 5041,
  testStatusFx: 18931,
  testHazards2: 13837,
  testLocalModels: 35263,
  testModelSets: 31519,
  testMultiplayer: 21593,
  'testMpBosses:citadel': 17113,
  'testMpBosses:mirage': 18675,
  'testMpBosses:cerberus': 17652,
  testMpStatus: 13037,
  testMpCampaign: 31951,
  testMpLevels: 13521,
  server: 8089,
  'server:testServerModels': 32811,
  'server:testLevelsServer': 9780,
  'server:testMultiplayer': 13591,
};
const DEFAULT_MS = 40000;

const fmtMs = (ms) => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${s % 60} 秒` : `${s} 秒`;
};

// SMOKE_JOBS：段數；沒設定時＝min(3, 邏輯核心數 / 4)。顯示卡算繪（預設）時全套 3 段約 9 分鐘；
// SwiftShader（SMOKE_GPU=0）是 CPU 算繪，段數多了每段都變慢（24 執行緒的筆電上 2 段＝1.55 倍、3 段＝2 倍、
// 4 段也只有 2 倍的產出且開始逾時失敗；固定 CPU 親和性沒有幫助）
function jobCount() {
  const v = process.env.SMOKE_JOBS;
  if (v !== undefined && v !== '') return Math.max(1, Math.floor(+v) || 1);
  return Math.max(1, Math.min(3, Math.floor(os.cpus().length / 4)));
}

// 步驟 → 單位（同一個相依群組的步驟合成一個單位，維持原本的順序）
function makeUnits(keys, groups) {
  const units = [];
  const seen = new Map();
  for (const k of keys) {
    const g = groups.find((x) => x.includes(k));
    if (g) {
      const id = g[0];
      if (seen.has(id)) {
        seen.get(id).keys.push(k);
        continue;
      }
      const u = { keys: [k] };
      seen.set(id, u);
      units.push(u);
    } else units.push({ keys: [k] });
  }
  units.forEach((u, i) => (u.idx = i));
  return units;
}

const timesFile = (shotDir) => path.join(shotDir, 'smoke-times.json');
function loadTimes(shotDir) {
  try {
    return JSON.parse(fs.readFileSync(timesFile(shotDir), 'utf8')).times || {};
  } catch (e) {
    return {};
  }
}
// 這次量到的耗時合併進紀錄（沒跑到的保留舊值）
function saveTimes(shotDir, times) {
  const all = { ...loadTimes(shotDir), ...times };
  const sorted = Object.fromEntries(Object.keys(all).map((k) => [k, all[k]]));
  fs.writeFileSync(
    timesFile(shotDir),
    JSON.stringify({ updated: new Date().toISOString(), times: sorted }, null, 1),
  );
}

// 貪婪分配：估計耗時由大到小，每次放進目前最輕的一段；段內照原本的順序
function plan(units, n, times) {
  const est = (u) => u.keys.reduce((a, k) => a + (times[k] ?? DEFAULT_TIMES[k] ?? DEFAULT_MS), 0);
  for (const u of units) u.est = est(u);
  const bins = Array.from({ length: Math.min(n, units.length) }, () => ({ units: [], est: 0 }));
  for (const u of [...units].sort((a, b) => b.est - a.est)) {
    const b = bins.reduce((m, x) => (x.est < m.est ? x : m));
    b.units.push(u);
    b.est += u.est;
  }
  for (const b of bins) b.units.sort((a, b2) => a.idx - b2.idx);
  return bins.filter((b) => b.units.length);
}

// 結束整個程序樹（Windows 的子程序被強制結束時不會跑 finally，瀏覽器與伺服器要一起收掉）
function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
  else proc.kill('SIGKILL');
}

function runJob(job, { args, root, tmp }) {
  const dir = path.join(tmp, 'job' + job.no);
  fs.mkdirSync(dir, { recursive: true });
  const result = path.join(dir, 'result.json');
  const keys = job.units.flatMap((u) => u.keys);
  const tag = `[${job.no}] `;
  const t0 = Date.now();
  const proc = spawn(process.execPath, [path.join(__dirname, 'smoke-test.js'), ...args], {
    cwd: root,
    env: {
      ...process.env,
      SMOKE_CHILD: String(job.no),
      SMOKE_UNITS: keys.join(','),
      SMOKE_WORK: dir,
      SMOKE_RESULT: result,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  job.proc = proc;
  const log = [];
  for (const s of [proc.stdout, proc.stderr]) {
    readline.createInterface({ input: s }).on('line', (l) => {
      log.push(l);
      console.log(tag + l);
    });
  }
  return new Promise((res) => {
    proc.on('exit', (code) => {
      job.ms = Date.now() - t0;
      job.code = code;
      job.log = log;
      try {
        job.res = JSON.parse(fs.readFileSync(result, 'utf8'));
      } catch (e) {
        job.res = null;
      }
      // stdout 可能還有沒讀完的行
      setTimeout(res, 100);
    });
  });
}

async function runPhases(phases, opt) {
  const all = phases.flat();
  const stop = () => {
    for (const j of all) killTree(j.proc);
    fs.rmSync(opt.tmp, { recursive: true, force: true });
    process.exit(130);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    for (const ph of phases) await Promise.all(ph.map((j) => runJob(j, opt)));
  } finally {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    for (const j of all) killTree(j.proc);
  }
}

// 一段的結果 → 各步驟的紀錄 { job, checks, failures, ms }；沒跑完的步驟記成 missing
function collect(j, recs, missing) {
  const r = j.res;
  for (const k of j.units.flatMap((u) => u.keys)) {
    if (!r || !(k in r.times)) {
      missing.add(k);
      continue;
    }
    recs[k] = {
      job: j.no,
      checks: r.counts[k],
      failures: r.failures.filter((f) => f.test === k),
      ms: r.times[k],
    };
  }
  if (!r || !r.done || j.code !== 0) {
    console.log(`\n[${j.no}] 子程序異常結束（exit ${j.code}），最後幾行：`);
    for (const l of (j.log || []).slice(-15)) console.log(`  [${j.no}] ${l}`);
  }
}

async function coordinate({ units, jobs: n, args, root, shotDir }) {
  const t0 = Date.now();
  const times = loadTimes(shotDir);
  // 對時間敏感的單位：預設和其他單位一起分配；SMOKE_SENSITIVE=last 時改成等其他段都跑完，再單獨跑一段
  const isSens = (u) => u.keys.some((k) => SENSITIVE.some((x) => k === x || k.startsWith(x + ':')));
  const last = process.env.SMOKE_SENSITIVE === 'last';
  const sens = last ? units.filter(isSens) : [];
  const rest = units.filter((u) => !sens.includes(u));
  const phases = [];
  if (rest.length) phases.push(plan(rest, n, times));
  if (sens.length) phases.push(plan(sens, 1, times));
  let no = 0;
  for (const ph of phases) for (const j of ph) j.no = ++no;
  console.log(`分段平行：${no} 段（SMOKE_JOBS=${n}${last ? '，對時間敏感的測試在最後一段單獨跑' : ''}）`);
  phases.forEach((ph, pi) => {
    for (const j of ph)
      console.log(
        `  [${j.no}]${pi ? '（最後）' : ''} 估計 ${fmtMs(j.est)}：` +
          j.units.map((u) => u.keys.join('+')).join('、'),
      );
  });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rubicon-smoke-'));
  const opt = { args, root, tmp };
  const all = phases.flat();
  const recs = {};
  const missing = new Set();
  const errors = new Set();
  let retry = null;
  try {
    await runPhases(phases, opt);
    for (const j of all) {
      collect(j, recs, missing);
      for (const e of (j.res && j.res.errors) || []) errors.add(e);
    }
    // 有失敗或沒跑完的單位：等全部跑完後在一段裡依序重跑一次（負載低），以重跑的結果為準；
    // 重跑才通過的列成「不穩定」。SMOKE_RETRY=0 關掉
    const bad = units.filter((u) =>
      u.keys.some((k) => missing.has(k) || (recs[k] && recs[k].failures.length)),
    );
    if (bad.length && process.env.SMOKE_RETRY !== '0') {
      retry = { no: ++no, units: bad, est: bad.reduce((a, u) => a + u.est, 0), first: {} };
      console.log(
        `\n重跑有失敗的測試（[${retry.no}]，單獨一段）：${bad.map((u) => u.keys.join('+')).join('、')}`,
      );
      for (const k of bad.flatMap((u) => u.keys)) {
        retry.first[k] = recs[k];
        delete recs[k];
        missing.delete(k);
      }
      await runPhases([[retry]], opt);
      collect(retry, recs, missing);
      for (const e of (retry.res && retry.res.errors) || []) errors.add(e);
    }
  } finally {
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
        break;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // 彙整（重跑的步驟以重跑的結果為準）
  let checks = 0;
  const failures = [];
  const measured = {};
  for (const u of units)
    for (const k of u.keys) {
      const r = recs[k];
      if (!r) {
        checks++;
        failures.push({ job: '-', test: k, label: '沒有跑完（子程序崩潰或中止）' });
        continue;
      }
      checks += r.checks;
      for (const f of r.failures) failures.push({ job: r.job, ...f });
      // 重跑的耗時是低負載時的，不拿來當分配的估計
      if (!retry || !(k in retry.first)) measured[k] = r.ms;
    }
  saveTimes(shotDir, measured);
  checks++;
  if (errors.size) failures.push({ job: '-', test: '彙總', label: `沒有頁面錯誤（${errors.size} 筆）` });

  console.log('\n==== 冒煙測試彙整 ====');
  for (const j of retry ? [...all, retry] : all) {
    const r = j.res;
    console.log(
      `[${j.no}]${j === retry ? '（重跑）' : ''} ${fmtMs(j.ms)}（估計 ${fmtMs(j.est)}）、` +
        `${r ? r.checks : '?'} 項、失敗 ${r ? r.failures.length : '?'}：` +
        j.units
          .flatMap((u) => u.keys)
          .map((k) => `${k} ${r && k in r.times ? fmtMs(r.times[k]) : '—'}`)
          .join('、'),
    );
  }
  if (retry) {
    const flaky = Object.entries(retry.first).filter(
      ([k, r]) => recs[k] && !recs[k].failures.length && (!r || r.failures.length),
    );
    if (flaky.length) {
      console.log(`\n不穩定（平行時失敗、單獨重跑通過）${flaky.length} 項測試：`);
      for (const [k, r] of flaky)
        for (const f of r ? r.failures : [{ label: '沒有跑完' }]) console.log(`  ~ [${k}] ${f.label}`);
    }
  }
  if (errors.size) {
    console.log(`\n頁面錯誤 ${errors.size} 筆：`);
    for (const e of errors) console.log('    ' + e);
  }
  console.log(
    `\n共 ${checks} 項，通過 ${checks - failures.length} 項，總耗時 ${fmtMs(Date.now() - t0)}（${all.length} 段${retry ? '＋重跑' : ''}）`,
  );
  if (failures.length) {
    console.log(`失敗 ${failures.length} 項：`);
    for (const f of failures) console.log(`  ✗ [${f.job}][${f.test || '-'}] ${f.label}`);
  } else console.log('全部通過');
  return failures.length ? 1 : 0;
}

module.exports = { jobCount, makeUnits, coordinate, saveTimes, fmtMs, SENSITIVE };
