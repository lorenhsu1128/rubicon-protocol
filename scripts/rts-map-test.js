// RTS 地圖產生器與導航格的自測（node scripts/rts-map-test.js [種子數，預設 100]）：
// 每個種子產生地圖 → 對稱（高度圖、障礙物、點位轉 180° 相同）、可達與路徑長度相等（產生器自己的檢查）、產生耗時；
// 最後量 400 m、cell 2 的 findPath 與 flowField 耗時（含 120 個單位同時下指令）。
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const src = (p) => pathToFileURL(path.join(__dirname, '..', 'src', p)).href;

(async () => {
  const { planRtsMap, rtsShim } = await import(src('world/rts-map.js'));
  const { NavGrid } = await import(src('world/nav.js'));
  const N = +process.argv[2] || 100;
  const tries = {},
    times = [];
  let bad = 0,
    worst = 0;
  const fails = {};
  const stat = { slots: [], camps: {}, mines: {}, lanes: {}, chokes: [] };
  const near = (a, b) => Math.abs(a - b) < 1e-4;
  for (let s = 1; s <= N; s++) {
    const plan = planRtsMap(s * 7919, { theme: 'wasteland', size: 400 });
    times.push(plan.ms);
    tries[plan.tries] = (tries[plan.tries] || 0) + 1;
    for (const f of plan.fails) {
      const k = f.replace(/[\d.]+/g, '#');
      fails[k] = (fails[k] || 0) + 1;
    }
    const errs = [];
    if (!plan.ok) errs.push('不合格：' + plan.fail);
    // 高度圖：k 與 N²−1−k 相同
    const n = plan.n,
      h = plan.h;
    for (let k = 0; k < n * n; k++)
      if (h[k] !== h[n * n - 1 - k]) {
        errs.push('高度圖不對稱 ' + k);
        break;
      }
    // 障礙物與點位：每一個都有轉 180° 的對應
    const symList = (name, arr, get) => {
      for (const a of arr) {
        const p = get(a);
        if (!arr.some((b) => near(get(b).x, -p.x) && near(get(b).z, -p.z))) {
          errs.push(name + ' 不對稱');
          return;
        }
      }
    };
    symList('障礙物', plan.obstacles, (o) => o);
    for (const k of ['bases', 'mines', 'corals', 'camps', 'neutrals', 'chokes', 'highs'])
      symList(k, plan[k], (o) => o.pos);
    if (plan.bases.length !== 2) errs.push('主基地數');
    if (plan.camps.length < 6 || plan.camps.length > 10) errs.push('營地數 ' + plan.camps.length);
    if (plan.lanes.length < 2) errs.push('通道數 ' + plan.lanes.length);
    // 高低差：主基地平台比坡道下高 6 m 以上
    const th = rtsShim(plan).terrainHeight;
    const b = plan.bases[0];
    const dh = th(b.pos.x, b.pos.z) - th(b.ramp.bottom.x, b.ramp.bottom.z);
    if (dh < 6) errs.push('高低差 ' + dh.toFixed(1));
    if (plan.check) {
      worst = Math.max(worst, plan.check.worst);
      stat.slots.push(plan.check.slots);
    }
    stat.camps[plan.camps.length] = (stat.camps[plan.camps.length] || 0) + 1;
    stat.mines[plan.mines.length] = (stat.mines[plan.mines.length] || 0) + 1;
    stat.lanes[plan.lanes.length] = (stat.lanes[plan.lanes.length] || 0) + 1;
    for (const c of plan.chokes) stat.chokes.push(c.w);
    if (errs.length) {
      bad++;
      console.log(`種子 ${s * 7919}：${errs.join('；')}`);
    }
  }
  times.sort((a, b) => a - b);
  console.log(`\n${N} 個種子，失敗 ${bad}`);
  console.log('重試次數分布：', JSON.stringify(tries));
  console.log('子種子不合格的原因：', JSON.stringify(fails));
  console.log(
    `產生耗時 ms：中位 ${times[N >> 1]}、P90 ${times[Math.floor(N * 0.9)]}、最大 ${times[N - 1]}、平均 ${(times.reduce((a, b) => a + b, 0) / N).toFixed(0)}`,
  );
  console.log(
    `建築格（8×8）最少 ${Math.min(...stat.slots)}、平均 ${(stat.slots.reduce((a, b) => a + b, 0) / stat.slots.length).toFixed(0)}；營地數 ${JSON.stringify(stat.camps)}；礦脈數 ${JSON.stringify(stat.mines)}；通道數 ${JSON.stringify(stat.lanes)}；路口寬 ${Math.min(...stat.chokes).toFixed(1)}～${Math.max(...stat.chokes).toFixed(1)} m`,
  );
  console.log(`兩邊路徑代價最大差：${(worst * 100).toFixed(3)}%`);

  // ---------- 導航格的耗時 ----------
  const plan = planRtsMap(12345, { size: 400 });
  let t = performance.now();
  const nav = new NavGrid(rtsShim(plan), { cell: 2 });
  console.log(`\nNavGrid 建立（${nav.W}×${nav.W}）：${(performance.now() - t).toFixed(1)} ms`);
  const [A, B] = plan.bases;
  t = performance.now();
  nav.components(0);
  nav.components(1);
  nav.components(2);
  console.log(`連通分量（3 種大小）：${(performance.now() - t).toFixed(1)} ms`);
  // 基地到基地（最長的路徑）
  nav.findPath(A.pos, B.pos, 1);
  t = performance.now();
  const reps = 50;
  let len = 0;
  for (let k = 0; k < reps; k++) len = nav.findPath(A.pos, B.pos, 1).length;
  const tLong = (performance.now() - t) / reps;
  console.log(`findPath 基地→基地（${len} 點、代價 ${nav.lastCost.toFixed(0)} m）：${tLong.toFixed(2)} ms`);
  // 120 個單位從我方基地附近隨機位置同時下指令到隨機目標
  const r = (() => {
    let s = 99;
    return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  })();
  const units = [];
  while (units.length < 120) {
    const p = { x: A.pos.x + (r() - 0.5) * 50, z: A.pos.z + (r() - 0.5) * 50 };
    if (nav.walkableAt(p.x, p.z, 1)) units.push(p);
  }
  const goals = [];
  while (goals.length < 120) {
    const p = { x: (r() - 0.5) * 360, z: (r() - 0.5) * 360 };
    if (nav.walkableAt(p.x, p.z, 1)) goals.push(p);
  }
  t = performance.now();
  for (let k = 0; k < 120; k++) nav.findPath(units[k], goals[k], 1);
  const t120 = performance.now() - t;
  console.log(
    `findPath ×120（各自不同的目標）：合計 ${t120.toFixed(1)} ms、平均 ${(t120 / 120).toFixed(2)} ms`,
  );
  t = performance.now();
  for (let k = 0; k < 120; k++) nav.findPath(units[k], B.pos, 1);
  console.log(`findPath ×120（同一個目標＝敵方基地）：合計 ${(performance.now() - t).toFixed(1)} ms`);
  // 不可到達的目標（障礙物裡）
  const ob = plan.obstacles.find((o) => o.kind === 'circle' && o.r > 2);
  t = performance.now();
  const pu = nav.findPath(A.pos, ob, 1);
  console.log(
    `findPath 到障礙物中心（走到最近可達點，${pu.length} 點）：${(performance.now() - t).toFixed(2)} ms`,
  );
  // 流場
  nav.flowField(B.pos.x, B.pos.z, 1);
  nav.flows.clear();
  t = performance.now();
  const F = nav.flowField(B.pos.x, B.pos.z, 1);
  const tF = performance.now() - t;
  t = performance.now();
  nav.flowField(B.pos.x, B.pos.z, 1);
  const tF2 = performance.now() - t;
  console.log(`flowField 整張圖：${tF.toFixed(1)} ms（快取命中 ${tF2.toFixed(3)} ms）`);
  // 沿流場從 A 走到 B
  let p = { x: A.pos.x, z: A.pos.z },
    steps = 0,
    walked = 0;
  const o = {};
  t = performance.now();
  while (steps < 5000) {
    const d = F.dir(p.x, p.z, o);
    if (!d) break;
    p = { x: p.x + d.x * 1, z: p.z + d.z * 1 };
    walked += 1;
    steps++;
  }
  console.log(
    `沿流場走到敵方基地：${steps} 步（${walked} m，剩 ${Math.hypot(p.x - B.pos.x, p.z - B.pos.z).toFixed(1)} m），dir 查詢 ${(((performance.now() - t) / steps) * 1000).toFixed(2)} µs／次`,
  );
  // 建築：蓋在路口上 → 流場與路徑更新
  const ch = plan.chokes[0];
  t = performance.now();
  nav.block(ch.pos.x, ch.pos.z, 8, 8, 0.3, true);
  console.log(`block 8×8：${(performance.now() - t).toFixed(2)} ms；流場快取已清空：${nav.flows.size === 0}`);
  nav.block(ch.pos.x, ch.pos.z, 8, 8, 0.3, false);
  if (bad) process.exitCode = 1;
})();
