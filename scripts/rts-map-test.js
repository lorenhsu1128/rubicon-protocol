// RTS 地圖產生器與導航格的自測（node scripts/rts-map-test.js [種子數，預設 100] [--theme=wasteland|snow|institute|spaceport|grid086|all]）：
// 每個種子產生地圖 → 對稱（高度圖、障礙物、點位轉 180° 相同）、可達與路徑長度相等（產生器自己的檢查）、產生耗時；
// 最後量 400 m、cell 2 的 findPath 與 flowField 耗時（含 120 個單位同時下指令）。
// 荒野、冰原、技研都市另外比對 100 個種子的地圖雜湊（HASHES：R4 加主題之前的結果；新主題的附加地形不能改到它們）；
// 冰原檢查冰湖（在通道上、冰面高度、不在主基地與資源 20 m 內），技研都市檢查湧出點 6 個；
// 舊宇宙港外圍檢查發射台（頂面高度、可以蓋、發射塔）與防爆牆列（離通道 WALL_GAP 以上），Grid 086 地表檢查構造體台階
// （兩層的高度、頂層可以蓋、從主基地到得了）；R4 的兩個主題第一次就合格的比例要 60% 以上。
'use strict';
const path = require('path');
const { pathToFileURL } = require('url');

const crypto = require('crypto');
const src = (p) => pathToFileURL(path.join(__dirname, '..', 'src', p)).href;
// 100 個種子（s × 7919）的地圖雜湊（高度圖＋其他欄位的 JSON，不含耗時與檢查結果）：荒野是 R3 之前、冰原與技研都市是 R4 之前的結果
const HASHES = {
  wasteland: 'dbdb9dc2c7e03e5ade9c311c60ed051797a5320f',
  snow: '5299d75d5540fdc062c78b0dabb50634ce8429a1',
  institute: '60a6b81654ebc1d78e7a2b652b667a96ec5e5374',
};
const planHash = (p) => {
  const hs = crypto.createHash('sha1');
  hs.update(Buffer.from(p.h.buffer));
  const rest = { ...p };
  delete rest.h;
  delete rest.ms;
  delete rest.check;
  hs.update(JSON.stringify(rest));
  return hs.digest('hex');
};

(async () => {
  const { planRtsMap, rtsShim, rtsOnLake, RTS_THEMES, RTS_ICE_Y, wallsBad, WALL_GAP } = await import(
    src('world/rts-map.js')
  );
  const { NavGrid } = await import(src('world/nav.js'));
  const N = +process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 100;
  const targ = (process.argv.find((a) => a.startsWith('--theme=')) || '--theme=wasteland').slice(8);
  const themes = targ === 'all' ? Object.keys(RTS_THEMES) : [targ];
  let failAll = 0;
  for (const theme of themes) failAll += runTheme(theme);
  if (failAll) process.exitCode = 1;

  function runTheme(theme) {
    console.log(`
===== 主題 ${theme} =====`);
    const hsAll = crypto.createHash('sha1');
    const tries = {},
      times = [];
    let bad = 0,
      worst = 0;
    const fails = {};
    const stat = { slots: [], camps: {}, mines: {}, lanes: {}, chokes: [] };
    const near = (a, b) => Math.abs(a - b) < 1e-4;
    for (let s = 1; s <= N; s++) {
      const plan = planRtsMap(s * 7919, { theme, size: 400 });
      times.push(plan.ms);
      hsAll.update(planHash(plan));
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
      if (plan.ice) {
        symList('冰湖', plan.ice, (o) => o);
        const thI = rtsShim(plan).terrainHeight;
        for (const L of plan.ice) if (Math.abs(thI(L.x, L.z) - RTS_ICE_Y) > 0.05) errs.push('冰面高度');
        for (const q of [
          ...plan.bases.map((b) => b.pos),
          ...plan.mines.map((m) => m.pos),
          ...plan.corals.map((c) => c.pos),
        ])
          for (const L of plan.ice)
            if (Math.hypot(q.x - L.x, q.z - L.z) < Math.min(L.rx, L.rz) + 20 && rtsOnLake(plan, q.x, q.z))
              errs.push('冰湖太近');
        if (!plan.lanes.some((ln) => ln.some((p) => rtsOnLake(plan, p.x, p.z))))
          stat.laneIce = (stat.laneIce || 0) + 1; // 通道的轉折點不一定落在湖上（產生器另外沿線段檢查）
        stat.lakes = (stat.lakes || 0) + plan.ice.length / 2;
      } else if (theme === 'snow') errs.push('沒有冰湖');
      if (theme === 'institute' && plan.corals.length !== 6) errs.push('湧出點 ' + plan.corals.length);
      if (plan.decor) symList('裝飾', plan.decor, (o) => o);
      // R4：發射台與防爆牆列、構造體台階
      const thR = rtsShim(plan).terrainHeight;
      const nav4 = plan.nav;
      const topOk = (x, z) =>
        nav4 &&
        [0, 2, -2, 4, -4].some((ox) => [0, 2, -2, 4, -4].some((oz) => nav4.buildable(x + ox, z + oz, 8, 8)));
      if (theme === 'spaceport') {
        const pads = plan.pads || [];
        if (pads.length !== 2) errs.push('發射台數 ' + pads.length);
        symList('發射台', pads, (o) => o.pos);
        for (const q of pads) {
          if (Math.abs(thR(q.pos.x, q.pos.z) - q.h) > 0.4) errs.push('發射台高度');
          if (!topOk(q.pos.x, q.pos.z)) errs.push('發射台頂面不能蓋');
        }
        if (plan.obstacles.filter((o) => o.model === 'launchtower').length !== 2) errs.push('發射塔');
        const rows = plan.obstacles.filter((o) => o.row);
        if (rows.length < 12) errs.push('防爆牆段數 ' + rows.length);
        if (wallsBad(plan).size) errs.push('防爆牆離通道不到 ' + WALL_GAP + ' m');
        stat.walls = (stat.walls || 0) + rows.length / 2;
      }
      if (theme === 'grid086') {
        const st = plan.steps || [];
        if (st.length !== 4) errs.push('台階數 ' + st.length);
        symList('台階', st, (o) => o.pos);
        for (const q of st) {
          if (Math.abs(thR(q.top.x, q.top.z) - q.h1 - q.h2) > 0.4) errs.push('台階上層高度');
          if (!topOk(q.top.x, q.top.z)) errs.push('台階上層不能蓋');
        }
        if (!(plan.decor || []).some((d) => d.model === 'g86wall')) errs.push('沒有金屬牆');
      }
      if (plan.tries === 1) stat.first = (stat.first || 0) + 1;
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
    console.log(
      `第一次就合格：${stat.first || 0}／${N}${stat.lakes ? `；冰湖（半張圖）平均 ${(stat.lakes / N).toFixed(2)} 個` : ''}${stat.walls ? `；防爆牆（半張圖）平均 ${(stat.walls / N).toFixed(1)} 段` : ''}`,
    );
    const hAll = hsAll.digest('hex');
    if (HASHES[theme] && N === 100) {
      const same = hAll === HASHES[theme];
      console.log(
        `${RTS_THEMES[theme].name} 100 個種子的地圖雜湊 ${hAll}：${same ? '和之前相同' : '不同！（這個主題的地圖改變了）'}`,
      );
      if (!same) bad++;
    }
    if ((theme === 'spaceport' || theme === 'grid086') && (stat.first || 0) < N * 0.6) {
      console.log(`第一次就合格的比例 ${stat.first || 0}／${N} 低於 60%`);
      bad++;
    }
    if (theme !== themes[themes.length - 1]) return bad;

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
    console.log(
      `block 8×8：${(performance.now() - t).toFixed(2)} ms；流場快取已清空：${nav.flows.size === 0}`,
    );
    nav.block(ch.pos.x, ch.pos.z, 8, 8, 0.3, false);
    return bad;
  }
})();
