// RTS 地圖產生器與導航格的自測（node scripts/rts-map-test.js [種子數，預設 100] [--theme=wasteland|snow|institute|spaceport|grid086|flooded|dam|dunes|desert|industrial|all] [--size=400|300]）：
// 每個種子產生地圖 → 對稱（高度圖、障礙物、點位轉 180° 相同）、可達與路徑長度相等（產生器自己的檢查）、產生耗時；
// 最後量 400 m、cell 2 的 findPath 與 flowField 耗時（含 120 個單位同時下指令）。
// 荒野、冰原、技研都市另外比對 100 個種子的地圖雜湊（HASHES：R4 加主題之前的結果；新主題的附加地形不能改到它們）；
// 冰原檢查冰湖（在通道上、冰面高度、不在主基地與資源 20 m 內），技研都市檢查湧出點 6 個；
// 舊宇宙港外圍檢查發射台（頂面高度、可以蓋、發射塔）與防爆牆列（離通道 WALL_GAP 以上），Grid 086 地表檢查構造體台階
// （兩層的高度、頂層可以蓋、從主基地到得了）；R5 的汙染水沒市街檢查水窪（成對、水深 0.9～1.2 m、每條通道都經過），
// 多重水壩檢查壩體（壩頂高度、可以蓋、四條坡道成對、河道水深 0.8 m）；兩個主題整張圖的水深都不超過 1.4 m；
// R4、R5 的四個主題第一次就合格的比例要 60% 以上。既有七個主題（400 m）比對地圖雜湊（HASHES）。
// R6（docs 17.4）：沙丘檢查新月沙丘（成對、高 2.6～3.5 m、不在通道 6 m 內、坡度能走），礦坑地表檢查露天礦坑（坑底深度、
// 坑底的富礦與 tier 3 營地、兩座酒館成對在坑緣、坡道兩條）、貨運集散場檢查貨櫃堆（成對、離通道 6 m、巷道寬 ≥ 8 m）與龍門起重機
// （四支腳）；新主題與小地圖另外檢查營地到傭兵營 ≥ 30 m。三個新主題（與 --size=300 的十個主題）第一次就合格要 60% 以上；
// 小地圖（300 m）比對 HASHES_300（第一次合格時記下的結果）。
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
  // R5 之前（R4 的結果）
  spaceport: 'dcf836115e5c33f655977620217b4144fd8a9fe0',
  grid086: '29de65975c8b0da7f79dddb2d3ab9f8b8f51ade7',
  // R6 之前（R5 的結果）
  flooded: '80fa248223fcd210f31bd9cb00e34eecf1d32f5e',
  dam: 'd94cba84fa206edefc23549cf1dbab676508c3f8',
  // R6 的新主題（C 包完成時的結果）
  dunes: '104ba29618d05413c366fa1e5355673707f4539e',
  // 礦坑地表：R6 之後的 C 包把酒館改成坑緣的兩座（成對、點對稱）後的結果（docs 18.3）
  desert: '8e8666bff2bd8efbf535b70beb951c3fcd986984',
  industrial: '05f647a7ca4df42bb692270b87b4e1a8f99c7cfe',
};
// 小地圖（300 m）的地圖雜湊（R6 C 包完成時的結果；之後改產生器不能改到它們）
const HASHES_300 = {
  wasteland: 'a0778146a204705fdc5b196d91cd8ec40cc51d33',
  snow: '6c93bfcc008153e731607f4d735bb6e94833edc5',
  institute: '6d40f453ac852489d6afec32ef1f83855213a5f8',
  spaceport: '069cc3aab4771f5943f028f89e27e51b591de6e4',
  grid086: '3e4cf1cd292d2ecd56255e2042979957d47b2b59',
  flooded: 'cda86b40b19711560e26238f118ff89bec3e9a3b',
  // 多重水壩：R6 之後的 C 包修正小地圖的合格率（中立建築的佔地與正面、山脊後的備用範圍、營地範圍）後的結果（docs 18.3）
  dam: 'c601e2a585fa04df730366f04780712a0d23549f',
  dunes: '70b35e6ab901261bb1c04241d786b444bdb9f02f',
  desert: 'e704508e9a3066456acbd63095cb050bb65d7396', // 兩座酒館（docs 18.3）
  industrial: 'fb099ffdc04914a5bc0763c24a930603a2cf6785',
};
// 第一次就合格的門檻：一律 60%（小地圖的多重水壩原本 40%，R6 之後的 C 包修正後改回，docs 18.3）
const firstMin = () => 0.6;
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
  const {
    planRtsMap,
    rtsShim,
    rtsOnLake,
    rtsInPool,
    RTS_THEMES,
    RTS_ICE_Y,
    RTS_WATER_Y,
    wallsBad,
    WALL_GAP,
    yardNarrow,
    RTS_NEUTRAL_FOOT,
  } = await import(src('world/rts-map.js'));
  const { NavGrid } = await import(src('world/nav.js'));
  const N = +process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 100;
  const targ = (process.argv.find((a) => a.startsWith('--theme=')) || '--theme=wasteland').slice(8);
  const themes = targ === 'all' ? Object.keys(RTS_THEMES) : [targ];
  const SIZE = +(process.argv.find((a) => a.startsWith('--size=')) || '--size=400').slice(7) || 400;
  const HS = SIZE === 400 ? HASHES : HASHES_300;
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
      const plan = planRtsMap(s * 7919, { theme, size: SIZE });
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
      for (const k of ['bases', 'mines', 'corals', 'camps', 'chokes', 'highs'])
        symList(k, plan[k], (o) => o.pos);
      // 礦坑地表的兩座酒館也是成對的（R6 之後的 C 包：原本只有一間、不是點對稱）
      symList('neutrals', plan.neutrals, (o) => o.pos);
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
        if (rows.length < (SIZE === 400 ? 12 : 4)) errs.push('防爆牆段數 ' + rows.length);
        if (wallsBad(plan).size) errs.push('防爆牆離通道不到 ' + WALL_GAP + ' m');
        stat.walls = (stat.walls || 0) + rows.length / 2;
      }
      if (theme === 'grid086') {
        const st = plan.steps || [];
        if (st.length !== (SIZE === 400 ? 4 : 2)) errs.push('台階數 ' + st.length);
        symList('台階', st, (o) => o.pos);
        for (const q of st) {
          if (Math.abs(thR(q.top.x, q.top.z) - q.h1 - q.h2) > 0.4) errs.push('台階上層高度');
          if (!topOk(q.top.x, q.top.z)) errs.push('台階上層不能蓋');
        }
        if (!(plan.decor || []).some((d) => d.model === 'g86wall')) errs.push('沒有金屬牆');
      }
      // R5：水面主題（全部可以走：水深最多 1.4 m）
      if (plan.waterY !== undefined) {
        let deep = 0;
        for (let k = 0; k < n * n; k++) deep = Math.max(deep, plan.waterY - h[k]);
        if (deep > 1.4 + 1e-3) errs.push('水太深 ' + deep.toFixed(2));
        stat.deep = Math.max(stat.deep || 0, deep);
      }
      if (theme === 'flooded') {
        const pools = plan.pools || [];
        if (pools.length < (SIZE === 400 ? 6 : 2) || pools.length > 10) errs.push('水窪數 ' + pools.length);
        symList('水窪', pools, (o) => o);
        for (const q of pools) {
          const d = RTS_WATER_Y - thR(q.x, q.z);
          if (d < 0.85 || d > 1.25) errs.push('水窪深度 ' + d.toFixed(2));
        }
        for (const ln of SIZE === 400 ? plan.lanes : []) {
          let hit = false;
          for (let k = 1; k < ln.length && !hit; k++)
            for (let s2 = 0; s2 <= 20 && !hit; s2++)
              hit = rtsInPool(
                plan,
                ln[k - 1].x + ((ln[k].x - ln[k - 1].x) * s2) / 20,
                ln[k - 1].z + ((ln[k].z - ln[k - 1].z) * s2) / 20,
              );
          if (!hit) errs.push('通道沒有經過水窪');
        }
        if (plan.obstacles.some((o) => rtsInPool(plan, o.x, o.z))) errs.push('水窪裡有障礙物');
        stat.pools = (stat.pools || 0) + pools.length / 2;
      }
      if (theme === 'dam') {
        const D = plan.dam;
        if (!D) errs.push('沒有壩體');
        else {
          if (D.ramps.length !== 4) errs.push('坡道數 ' + D.ramps.length);
          symList('坡道', D.ramps, (o) => o.top);
          for (const q of D.tops) {
            if (Math.abs(thR(q.x, q.z) - D.h) > 0.4) errs.push('壩頂高度');
            if (!topOk(q.x, q.z)) errs.push('壩頂不能蓋');
          }
          const ax = Math.cos(plan.axis),
            az = Math.sin(plan.axis);
          // 中央平台與坡道之間（v＝平台＋8）的河道中央
          const u = D.river.u0 + D.river.w / 2,
            v = D.plaza + 8;
          const rd = RTS_WATER_Y - thR(u * ax - v * az, u * az + v * ax);
          if (Math.abs(rd - 0.8) > 0.15) errs.push('河道水深 ' + rd.toFixed(2));
          if (!(plan.decor || []).some((d) => d.model === 'damwall')) errs.push('沒有壩面');
        }
      }
      // R6：沙丘地帶、礦坑地表、貨運集散場
      if (theme === 'dunes') {
        const ds = plan.dunes || [];
        if (ds.length < (SIZE === 400 ? 8 : 4)) errs.push('沙丘數 ' + ds.length);
        symList('沙丘', ds, (o) => o);
        for (const d of ds) {
          const top = thR(d.x, d.z),
            c = Math.cos(d.rot),
            sn = Math.sin(d.rot);
          // 沙丘的兩個坡腳（迎風面 −ww、背風面 w − ww）的地面取低的：沙丘頂比它高 2.4 m 以上（低處的視線被擋住）
          const v1 = d.ww + 0.5,
            v2 = d.w - d.ww + 0.5;
          const g = Math.min(thR(d.x + sn * v1, d.z - c * v1), thR(d.x - sn * v2, d.z + c * v2));
          if (top - g < 2.4 || d.h < 2.6 || d.h > 3.5) errs.push(`沙丘高 ${(top - g).toFixed(1)}`);
        }
        const dots = [];
        for (const ln of plan.lanes) for (const p of ln) dots.push(p);
        if (!plan.arches) stat.noArch = (stat.noArch || 0) + 1;
        stat.dunes = (stat.dunes || 0) + ds.length / 2;
        // 沙丘上能走：沙丘中心的導航格可以通行
        if (nav4)
          for (const d of ds)
            if (!nav4.walkableAt(d.x, d.z, 1)) stat.duneBlocked = (stat.duneBlocked || 0) + 1;
      }
      if (theme === 'desert') {
        const P = plan.pit;
        if (!P) errs.push('沒有礦坑');
        else {
          const fl = thR(0, 0);
          if (fl > -P.depth + 1.2 || fl < -P.depth - 1.2) errs.push('坑底高度 ' + fl.toFixed(1));
          if (P.ramps.length !== 2) errs.push('坡道數');
          const rich = plan.mines.filter((m) => m.rich && m.pit);
          if (rich.length !== 1 || Math.hypot(rich[0].pos.x, rich[0].pos.z) > 0.01) errs.push('坑底沒有富礦');
          const pc = plan.camps.filter((q) => q.pit);
          if (pc.length !== 1 || pc[0].tier !== 3) errs.push('坑底的營地');
          const tavs = plan.neutrals.filter((q) => q.kind === 'tavern');
          if (tavs.length !== 2) errs.push('酒館數 ' + tavs.length);
          if (tavs.some((t) => Math.hypot(t.pos.x, t.pos.z) < P.zone)) errs.push('酒館不在坑緣');
          if (
            plan.ok &&
            tavs
              .map((t) => t.near)
              .sort()
              .join() !== '0,1'
          )
            errs.push('酒館的 near');
          if (plan.decor && !plan.decor.some((d) => d.model === 'minerail')) errs.push('沒有礦車軌道');
        }
      }
      if (theme === 'industrial') {
        const st = plan.stacks || [];
        if (st.length < (SIZE === 400 ? 8 : 4)) errs.push('貨櫃堆數 ' + st.length);
        symList('貨櫃堆', st, (o) => o);
        const legs = plan.obstacles.filter((o) => o.model === 'gantryleg');
        if (legs.length !== 8) errs.push('龍門起重機的腳 ' + legs.length);
        const nw = yardNarrow(plan);
        if (nw < 8) errs.push('巷道寬 ' + nw.toFixed(1));
        stat.narrow = Math.min(stat.narrow || Infinity, nw);
        stat.stacks = (stat.stacks || 0) + st.length / 2;
      }
      // 營地到傭兵營的佔地 ≥ 30 m（R6 的新主題與小地圖；17.2 #11）
      if (RTS_THEMES[theme].r6 || SIZE !== 400) {
        const mercR = Math.hypot(...RTS_NEUTRAL_FOOT.merc) / 2;
        for (const q of plan.neutrals.filter((n) => n.kind === 'merc'))
          for (const cp of plan.camps)
            if (Math.hypot(cp.pos.x - q.pos.x, cp.pos.z - q.pos.z) - mercR < 30 - 1e-6) {
              errs.push('營地離傭兵營太近');
              break;
            }
      }
      if (plan.tries === 1) stat.first = (stat.first || 0) + 1;
      const nCamp = plan.camps.filter((q) => !q.pit).length;
      const [cMin, cMax] = SIZE === 400 ? [6, 10] : [4, 6];
      if (nCamp < cMin || nCamp > cMax) errs.push('營地數 ' + nCamp);
      if (plan.lanes.length < 2) errs.push('通道數 ' + plan.lanes.length);
      // 高低差：主基地平台比坡道下高 6 m 以上
      const th = rtsShim(plan).terrainHeight;
      const b = plan.bases[0];
      const dh = th(b.pos.x, b.pos.z) - th(b.ramp.bottom.x, b.ramp.bottom.z);
      if (dh < (SIZE === 400 ? 6 : 5)) errs.push('高低差 ' + dh.toFixed(1));
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
    if (stat.dunes)
      console.log(
        `沙丘（半張圖）平均 ${(stat.dunes / N).toFixed(2)} 道；沒有拱形殘骸 ${stat.noArch || 0} 張；沙丘中心不能走 ${stat.duneBlocked || 0} 個`,
      );
    if (stat.stacks)
      console.log(
        `貨櫃堆（半張圖）平均 ${(stat.stacks / N).toFixed(2)} 組；巷道最窄 ${stat.narrow.toFixed(1)} m`,
      );
    if (N === 100 && !HS[theme])
      console.log(`${RTS_THEMES[theme].name}（${SIZE} m）100 個種子的地圖雜湊 ${hAll}（還沒有記錄）`);
    if (HS[theme] && N === 100) {
      const same = hAll === HS[theme];
      console.log(
        `${RTS_THEMES[theme].name} 100 個種子的地圖雜湊 ${hAll}：${same ? '和之前相同' : '不同！（這個主題的地圖改變了）'}`,
      );
      if (!same) bad++;
    }
    if (stat.deep !== undefined) console.log(`最深的水 ${stat.deep.toFixed(2)} m`);
    if (stat.pools) console.log(`水窪（半張圖）平均 ${(stat.pools / N).toFixed(2)} 個`);
    if (
      (['spaceport', 'grid086', 'flooded', 'dam'].includes(theme) || RTS_THEMES[theme].r6 || SIZE !== 400) &&
      (stat.first || 0) < N * firstMin(theme, SIZE)
    ) {
      console.log(`第一次就合格的比例 ${stat.first || 0}／${N} 低於 ${firstMin(theme, SIZE) * 100}%`);
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
