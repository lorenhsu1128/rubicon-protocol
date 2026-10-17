// Coral 戰爭（RTS）R5 A 包（聖域的核心與資料，docs/rts-design.md 16.2、16.11）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-sanc-a')(H)。
// testRtsSanc：開局（聚落中心＋5 作業機、英雄子選單、零件 0）、採礦每趟 8；殘骸（只有聖域在場時產生、單位／野怪／建築／
// 拆除的價值、不產生的種類、空中單位落在地面、合併與 400、上限 140、過期）；地圖殘骸（數量、150／10、同時 2 人、拆完只歸零）；
// 拾荒（每趟 12、3 人飽和、帶回聚落中心／回收站、零件與 Coral 的比例、維持費只套一半、零件上限、拆完找下一個、研究 15）；
// 迷霧（看不到的地方產生的殘骸、殘影）；零件的費用（路障、巨像、取消退還）；改裝（範圍、扣款、引導 2 秒、6 種的數值、
// 換掉、已經裝了、對空支架打直升機、自爆裝藥、零件不夠停在第 n 台、拼裝工具箱）；避難警報（躲進去、上限、建築開火、45 秒、
// 解除、建築被拆時彈出受傷）；修理半價；拆除；地雷；潛航的迷霧；互助網；診療所；靜態的成本效率；「隨機」抽到聖域；
// 其他三個陣營的開局不變；效能（殘骸的產生、迷霧的看過）。截圖：rts-r5a-wrecks.png（B 包的外觀之前是測試畫的標記）。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim＋rtsFogTick 快轉。
/* global window, document, THREE */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsSanc(browser, base) {
    console.log('Coral 戰爭：聖域的殘骸、拾荒、零件、改裝、避難警報、拆除、地雷（R5 核心）');
    const { ctx, page } = await newPage(browser, 'rtsSanc');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 開局＋工具 ----------
    const st = await ev(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsCampsOff = true;
      window.__start = (fa, fb, seed = 7, theme = 'wasteland') => {
        g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷（負載高時同一個種子的結果才會相同）
        g.rtsStart({ theme, seed, size: 400, faction: fa, aiFaction: fb, diff: 'normal' });
        const R = g.rts;
        window.__hq = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        window.__hq1 = R.units.find((e) => e.rtsTeam === 1 && e.bld);
        return R;
      };
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          g.rtsFogTick(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__of = (team, def) =>
        g.rts.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      window.__D = (id) => g.rtsUiDef(id);
      // 直接放蓋好的建築（離 (x, z) r0 m 起往外找能蓋的地方）
      window.__bld = (team, def, x, z, r0 = 0, p = 1) => {
        const D = window.__D(def);
        for (let r = r0; r <= 60; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (g.world.nav.buildable(px, pz, D.foot[0] + 2, D.foot[1] + 2))
              return g.rtsSpawnBld(team, def, px, pz, 0, p);
            if (r === 0) break;
          }
        return null;
      };
      // 可以走的地點
      window.__spot = (x, z, size = 0) => {
        const c = g.world.nav.nearestCell(x, z, size, -1, 20);
        return c >= 0 ? g.world.nav.center(c) : { x, z };
      };
      window.__unit = (team, def, x, z) => {
        const p = window.__spot(x, z, (window.__D(def) || {}).size || 0);
        return g.rtsSpawn(team, def, p.x, p.z, 0);
      };
      window.__kill = (e, from = null) => {
        e.hp = 0;
        e.die(from);
      };
      // 繳交的紀錄（{ t, kind, n, salvage }）
      window.__dep = [];
      const dep = g.rtsDeposit.bind(g);
      g.rtsDeposit = (t, k, n, o) => {
        window.__dep.push({ t, k, n, s: !!(o && o.salvage) });
        return dep(t, k, n, o);
      };
      // 清場：工人停工（之後看資源的增減）
      window.__idle = (team) => {
        for (const e of g.rts.units)
          if (!e.dead && !e.bld && e.rtsTeam === team) {
            g.rtsSetOrders(e, []);
            e.carry = null;
          }
      };
      const R = window.__start('sancta', 'castron');
      const hq = window.__hq;
      const plan = g.world.rts;
      const models = new Set(
        ['hopper', 'tank'], // 荒野的 wrecks（world/rts-map.js）
      );
      const nMap = plan.obstacles.filter((o) => models.has(o.model)).length;
      const maps = R.wrecks.filter((w) => w.map);
      return {
        fac: [R.teams[0].faction, R.teams[1].faction],
        hq: hq.rtsDef,
        wk: window.__of(0, 's_worker').length,
        hq1: window.__of(1, 'c_hq').length,
        parts: R.teams[0].parts,
        salvage: R.salvage,
        menu: (window.__D('s_hq').menus.hero || []).map((c) => c.key + ':' + c.name).join(' '),
        build: (window.__D('s_worker').menus.build || []).length,
        wcard: window
          .__D('s_worker')
          .card.map((c) => c.key + ':' + c.act.k + (c.act.o ? ':' + c.act.o : ''))
          .join(' '),
        hqcard: window
          .__D('s_hq')
          .card.map((c) => c.key + ':' + (c.act.ab || c.act.id || c.act.menu || c.act.to || c.act.k))
          .join(' '),
        nMap,
        maps: maps.length,
        mapVal: maps.every((w) => w.ore === 150 && w.parts === 10 && w.end === Infinity),
        cost: window.__D('s_colossus').card
          ? window.__D('s_works').card.find((c) => c.act.id === 's_colossus').tip
          : '',
      };
    });
    check(
      st.fac.join() === 'sancta,castron' && st.hq === 's_hq' && st.wk === 5 && st.hq1 === 1 && st.parts === 0,
      `開局：聖域（聚落中心＋5 台互助作業機、零件 ${st.parts}）對卡斯特隆（主堡＋5）`,
    );
    check(
      /Q:MENDER W:SALVOR E:HAVEN V:返回/.test(st.menu) && st.build === 12,
      `聚落中心的英雄子選單（${st.menu}）、建造子選單 ${st.build} 格`,
    );
    check(
      /V:salvage/.test(st.wcard) && /X:order:gather/.test(st.wcard) && /R:ab_shelter/.test(st.hqcard),
      `作業機的卡片有拾荒（${st.wcard}）、聚落中心有避難警報（${st.hqcard}）`,
    );
    check(/零件 40/.test(st.cost), `拼裝巨像的說明帶零件（${st.cost.slice(-30)}）`);
    check(
      st.salvage && st.nMap > 0 && st.maps === st.nMap && st.mapVal,
      `地圖殘骸：${st.maps} 個（荒野的漏斗車與油槽 ${st.nMap} 個障礙物），各 150 礦石、10 零件、不會過期`,
    );

    // ---------- 採礦每趟 8；採礦量對卡斯特隆（同一局的兩邊各 5 台） ----------
    const eco = await ev(() => {
      window.__dep.length = 0;
      window.__sim(90);
      const d0 = window.__dep.filter((d) => d.t === 0 && d.k === 'ore');
      const d1 = window.__dep.filter((d) => d.t === 1 && d.k === 'ore');
      const sum = (L) => L.reduce((a, d) => a + d.n, 0);
      return { n: d0.length, all8: d0.length > 0 && d0.every((d) => d.n === 8), s0: sum(d0), s1: sum(d1) };
    });
    check(eco.all8, `互助作業機每趟 8（${eco.n} 趟）`);
    const ratio = eco.s0 / Math.max(1, eco.s1);
    check(
      ratio >= 0.75 && ratio <= 0.85,
      `90 秒的採礦量：聖域 ${eco.s0}／卡斯特隆 ${eco.s1} ＝ ${ratio.toFixed(2)}（0.75～0.85）`,
    );

    // ---------- 靜態的成本效率（docs 16.9） ----------
    const eff = await ev(() => {
      const D = window.__D;
      const v = (d) => Math.sqrt(d.hp * d.dps);
      const per100 = (d) =>
        (v(d) / ((d.cost.ore || 0) + 2.5 * (d.cost.coral || 0) + 4 * (d.cost.parts || 0))) * 100;
      const perPop = (d) => v(d) / d.pop;
      const m = D('s_militia'),
        c = D('c_mt');
      return { a: per100(m) / per100(c), b: perPop(m) / perPop(c) };
    });
    check(
      eff.a >= 0.95 && eff.a <= 1.15 && eff.b >= 1.05 && eff.b <= 1.3,
      `成本效率：民兵 MT 對卡斯特隆 MT 每 100 礦石 ${eff.a.toFixed(2)}（0.95～1.15）、每人口 ${eff.b.toFixed(2)}（1.05～1.3）`,
    );

    // ---------- 殘骸的價值與種類 ----------
    const val = await ev(() => {
      const g = window.__game,
        R = g.rts;
      window.__idle(0);
      window.__idle(1);
      const o = {};
      const cx = 0,
        cz = 0;
      const nw = () => R.wrecks.filter((w) => !w.map).length;
      const last = () => R.wrecks.filter((w) => !w.map).slice(-1)[0];
      // 單位：卡斯特隆的 MT（135）＝40 礦石、4 零件
      const mt = window.__unit(1, 'c_mt', cx, cz);
      window.__kill(mt);
      const w1 = last();
      o.mt = w1 ? [w1.ore, w1.coral, w1.parts, w1.size, w1.team, w1.def].join() : '';
      // 盾牌 MT（170／30）＝51 礦石、6 Coral、6 零件（離遠一點，不合併）
      const sh = window.__unit(1, 'c_shield', cx + 30, cz);
      window.__kill(sh);
      const w2 = last();
      o.shield = w2 ? [w2.ore, w2.coral, w2.parts].join() : '';
      // 野怪 lv 2：20＋12×2＝44 礦石、4 零件
      const cr = window.__unit(2, 'cr_mt', cx - 30, cz);
      window.__kill(cr);
      const w3 = last();
      o.creep = w3 ? [w3.ore, w3.coral, w3.parts].join() : '';
      // 建築：補給庫（90）＝27 礦石、10 零件、大小 3、360 秒
      const dp = window.__bld(1, 'c_depot', cx, cz + 40, 0);
      window.__kill(dp);
      const w4 = last();
      o.depot = w4 ? [w4.ore, w4.coral, w4.parts, w4.size, Math.round(w4.end - R.t)].join() : '';
      // 升級過的主堡：(385＋300)×0.3＝205、(120＋150)×0.2＝54、零件 14
      const h2 = window.__bld(1, 'c_hq2', cx + 60, cz + 40, 0);
      window.__kill(h2);
      const w5 = last();
      o.hq2 = w5 ? [w5.ore, w5.coral, w5.parts].join() : '';
      // 不產生的種類
      const n0 = nw();
      const q = window.__unit(1, 'c_mt', cx + 60, cz - 30);
      q.rtsQuiet = true;
      window.__kill(q);
      const il = window.__unit(1, 'c_mt', cx + 60, cz - 30);
      il.rtsIllus = { t: R.t + 10 };
      window.__kill(il);
      const tm = window.__unit(1, 'c_mt', cx + 60, cz - 30);
      tm.rtsTemp = R.t + 10;
      window.__kill(tm);
      const hr = window.__unit(1, 'h_bastion', cx + 60, cz - 30);
      window.__kill(hr);
      const cv = window.__unit(1, 'v_carrier', cx + 60, cz - 30);
      cv.rtsDriven = true;
      window.__kill(cv);
      const inv = window.__bld(2, 'c_depot', cx - 60, cz + 40, 0);
      inv.rtsInv = true;
      inv.die(null);
      o.none = nw() - n0;
      // 空中單位落在正下方的地面
      const he = window.__unit(1, 'c_heli', cx - 50, cz - 40);
      const hy = he.pos.y;
      window.__kill(he);
      const w6 = last();
      o.air = w6
        ? [Math.round(hy - w6.y), Math.abs(w6.y - g.world.terrainHeight(w6.x, w6.z)) < 0.01].join()
        : '';
      o.life = w1 ? Math.round(w1.end - w1.t0) : 0;
      return o;
    });
    check(val.mt === '40,0,4,0,1,c_mt', `單位的殘骸：MT 135 → 40 礦石、4 零件、小（${val.mt}）`);
    check(val.shield === '51,6,6', `盾牌 MT（170／30）→ 51 礦石、6 Coral、6 零件（${val.shield}）`);
    check(val.creep === '44,0,4', `野怪 lv 2 → 20＋12×2＝44 礦石、4 零件（${val.creep}）`);
    check(val.depot === '27,0,10,3,360', `建築：補給庫 → 27 礦石、10 零件、瓦礫、360 秒（${val.depot}）`);
    check(val.hq2 === '205,54,14', `升級過的主堡加上升級費：205 礦石、54 Coral、14 零件（${val.hq2}）`);
    check(val.none === 0, `取消／幻象／臨時／英雄／空投運輸機／中立建築不留殘骸（多了 ${val.none} 個）`);
    check(
      /,true$/.test(val.air) && val.life === 240,
      `空中單位的殘骸落在地面（高差 ${val.air}）、單位殘骸保留 ${val.life} 秒`,
    );

    // ---------- 合併、400、上限 140、過期 ----------
    const mg = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      const base = { x: -60, z: 60 };
      const a = g.rtsWreckSpawn(base.x, base.z, { ore: 100, parts: 6, team: 1 });
      const b = g.rtsWreckSpawn(base.x + 2, base.z, { ore: 120, parts: 4, team: 1 });
      o.merge = a === b && a.ore === 220 && a.parts === 10 && a.size === 2 && a.list.length === 2;
      const c = g.rtsWreckSpawn(base.x + 1, base.z + 1, { ore: 250, parts: 4 });
      o.split = c !== a && a.ore === 220;
      // 上限 140：一直放（間隔 6 m，不合併）
      for (const w of R.wrecks.filter((q) => !q.map)) g.rtsWreckRemove(w);
      let t = 0,
        n = 0;
      for (let i = 0; i < 160; i++) {
        const x = -150 + (i % 20) * 7,
          z = -120 + Math.floor(i / 20) * 7;
        const t0 = performance.now();
        g.rtsWreckSpawn(x, z, { ore: 20 + i, parts: 2 });
        t += performance.now() - t0;
        n++;
      }
      const dyn = R.wrecks.filter((q) => !q.map);
      o.cap = dyn.length;
      o.low = Math.min(...dyn.map((q) => q.ore));
      o.addMs = t / n;
      // 迷霧的「看過」140 個殘骸的一輪
      let fm = 0;
      for (let i = 0; i < 10; i++) {
        g.rtsWreckFog(R.fog);
        fm += R.wreckFogMs;
      }
      o.fogMs = fm / 10;
      // 過期：保留 2 秒的殘骸
      const e = g.rtsWreckSpawn(150, 150, { ore: 50, life: 2 });
      window.__sim(1);
      o.alive1 = !e.gone;
      window.__sim(1.6);
      o.alive2 = !e.gone;
      for (const w of R.wrecks.filter((q) => !q.map)) g.rtsWreckRemove(w);
      return o;
    });
    check(mg.merge && mg.split, '4 m 內的單位殘骸合併（100＋120＝220、零件相加）；合計超過 400 不合併');
    check(
      mg.cap === 140 && mg.low === 40,
      `動態殘骸上限 140（${mg.cap} 個，先移除價值最低的：剩下的最低 ${mg.low}）`,
    );
    check(mg.alive1 && !mg.alive2, '殘骸過期後移除');
    check(
      mg.addMs < 0.2 && mg.fogMs < 0.3,
      `效能：產生一個殘骸 ${mg.addMs.toFixed(3)} ms（< 0.2）、迷霧的看過 140 個 ${mg.fogMs.toFixed(3)} ms（< 0.3）`,
    );

    // ---------- 拾荒 ----------
    const sv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      window.__idle(0);
      const o = {};
      const ws = window.__of(0, 's_worker');
      // 殘骸放在聚落中心旁邊（玩家看得到）
      const p = window.__spot(hq.pos.x + 18, hq.pos.z + 4);
      const w = g.rtsWreckSpawn(p.x, p.z, { ore: 60, coral: 6, parts: 6, team: 1 });
      o.seen = !!(w.seen & 1);
      T.parts = 0;
      window.__dep.length = 0;
      const coral0 = T.coral;
      g.rtsOrder([ws[0]], { k: 'salvage', wid: w.id });
      window.__sim(30, () => window.__dep.some((d) => d.t === 0 && d.s));
      const d = window.__dep.find((q) => q.t === 0 && q.s);
      o.trip = d ? d.n : 0;
      o.parts = T.parts;
      o.coral = Math.round(T.coral - coral0);
      o.left = w.ore;
      // 3 人飽和：派 5 台
      g.rtsOrder(ws, { k: 'salvage', wid: w.id });
      let mx = 0;
      window.__sim(20, () => {
        mx = Math.max(mx, w.takers.size);
        return w.gone;
      });
      o.sat = mx;
      o.gone = w.gone;
      o.salvOre = R.stats[0].salvOre;
      // 拆完找 16 m 內的下一個
      const w2 = g.rtsWreckSpawn(p.x - 6, p.z + 8, { ore: 24, parts: 2, team: 1 });
      const w3 = g.rtsWreckSpawn(p.x - 12, p.z + 14, { ore: 24, parts: 2, team: 1 });
      g.rtsOrder([ws[0]], { k: 'salvage', wid: w2.id });
      window.__sim(40, () => w2.gone && w3.gone);
      o.next = w2.gone && w3.gone;
      // 沒有殘骸了：回去採礦
      window.__sim(2);
      o.back = ws[0].orders[0] ? ws[0].orders[0].k : '';
      // 右鍵（rtsSmart）殘骸＝拾荒；卡斯特隆的工人＝走過去
      const w4 = g.rtsWreckSpawn(p.x, p.z, { ore: 30 });
      g.rtsSmart([ws[1]], w4.x, w4.z, w4);
      o.smart = ws[1].orders[0] && ws[1].orders[0].k;
      const cw = window.__of(1, 'c_worker')[0];
      g.rtsSmart([cw], w4.x, w4.z, w4);
      o.smartC = cw.orders[0] && cw.orders[0].k;
      g.rtsSetOrders(cw, []);
      g.rtsWreckRemove(w4);
      // 研究拾荒效率：15
      T.tech.res.r_salv = 1;
      o.trip1 = g.rtsSalvageTrip(0);
      T.tech.res.r_salv = 2;
      o.trip2 = g.rtsSalvageTrip(0);
      o.haul = g.rtsSalvageTrip(0, true);
      T.tech.res.r_salv = 0;
      return o;
    });
    check(
      sv.seen && sv.trip === 12 && sv.parts === 2 && sv.coral === 2,
      `拾荒每趟 12 礦石，零件與 Coral 依比例（零件 ${sv.parts}、Coral ${sv.coral}）`,
    );
    check(sv.sat === 3 && sv.gone, `同時最多 3 個工人拆一個殘骸（最多 ${sv.sat}）、拆完移除`);
    check(
      sv.next && sv.back === 'gather',
      `拆完找 16 m 內的下一個（${sv.next}）、都拆完回去採礦（${sv.back}）`,
    );
    check(
      sv.smart === 'salvage' && sv.smartC === 'move',
      `右鍵殘骸：作業機拾荒（${sv.smart}）、卡斯特隆的工人走過去（${sv.smartC}）`,
    );
    check(sv.trip1 === 15 && sv.trip2 === 18 && sv.haul === 45, `研究拾荒效率：每趟 15 → 18、回收拖車 45`);

    // ---------- 回收站、展開的回收拖車、維持費只套一半、零件上限 ----------
    const dp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      window.__idle(0);
      const o = {};
      const ws = window.__of(0, 's_worker');
      // 遠處的殘骸：旁邊蓋回收站
      const far = window.__spot(hq.pos.x + 60, hq.pos.z + 60);
      const yard = window.__bld(0, 's_yard', far.x, far.z, 8);
      const w = g.rtsWreckSpawn(far.x, far.z, { ore: 40, team: 1 });
      w.seen |= 1;
      g.rtsOrder([ws[2]], { k: 'salvage', wid: w.id });
      window.__sim(30, () => ws[2].carry && ws[2].carry.kind === 'salv');
      o.drop = g.rtsDropoff(0, ws[2].pos.x, ws[2].pos.z) === yard;
      // 回收拖車（展開＝e.rtsHaulOn，B 包設定）也是回收點
      const hl = window.__unit(0, 's_hauler', ws[2].pos.x + 3, ws[2].pos.z);
      hl.rtsHaulOn = true;
      o.haul = g.rtsDropoff(0, ws[2].pos.x, ws[2].pos.z) === hl;
      hl.rtsHaulOn = false;
      g.rtsSetOrders(ws[2], []);
      ws[2].carry = null;
      // 維持費：人口 80（低維持費）時，礦脈 70%、拾荒 85%
      T.pop = 80;
      const ore0 = T.ore;
      const a = g.rtsDeposit(0, 'ore', 100);
      const b = g.rtsDeposit(0, 'ore', 100, { salvage: true });
      T.pop = 120;
      const c = g.rtsDeposit(0, 'ore', 100, { salvage: true });
      o.upk = [a, b, c].map((v) => Math.round(v)).join();
      T.ore = ore0;
      // 零件上限 200、研究零件倉儲 300
      T.parts = 190;
      o.add = g.rtsPartsAdd(0, 30);
      o.cap = T.parts;
      T.tech.res.r_stock = 1;
      o.add2 = g.rtsPartsAdd(0, 150);
      o.cap2 = T.parts;
      T.tech.res.r_stock = 0;
      T.parts = 0;
      hl.rtsQuiet = true;
      window.__kill(hl);
      yard.rtsQuiet = true;
      yard.die(null);
      return o;
    });
    check(dp.drop && dp.haul, '回收點：回收站、展開的回收拖車（比聚落中心近時）');
    check(dp.upk === '70,85,70', `維持費：礦脈 70%、拾荒只套一半（低 85%、高 70%）：${dp.upk}`);
    check(
      dp.add === 10 && dp.cap === 200 && dp.cap2 === 300,
      `零件上限 200（加了 ${dp.add}）、研究零件倉儲後 300（${dp.cap2}）`,
    );

    // ---------- 地圖殘骸：同時 2 人、拆完外觀與碰撞不變 ----------
    const mp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      window.__idle(0);
      // 離主堡最近的地圖殘骸
      let m = null,
        bd = 1e9;
      for (const w of R.wrecks)
        if (w.map) {
          const d = Math.hypot(w.x - hq.pos.x, w.z - hq.pos.z);
          if (d < bd) ((bd = d), (m = w));
        }
      const o = { has: !!m };
      if (!m) return o;
      const nOb = g.world.obstacles.length;
      const ws = window.__of(0, 's_worker');
      // 工人搬到旁邊（不用走太遠）
      for (const [i, e] of ws.entries()) {
        const p = window.__spot(m.x + 6 + i, m.z + 6);
        e.pos.set(p.x, g.world.groundAt(p.x, p.z, 99), p.z);
        R.hash.update(e, p.x, p.z);
      }
      m.ore = 30;
      m.parts = 2;
      g.rtsOrder(ws.slice(0, 4), { k: 'salvage', wid: m.id });
      let mx = 0;
      window.__sim(40, () => {
        mx = Math.max(mx, m.takers.size);
        return m.ore <= 0;
      });
      o.sat = mx;
      o.zero = m.ore === 0 && !m.gone && R.wrecks.includes(m);
      o.ob =
        g.world.obstacles.length === nOb &&
        g.world.obstacles.includes(m.ob) === g.world.obstacles.some((q) => q === m.ob);
      o.known = g.rtsWreckKnown(1).some((k) => k.id === m.id);
      window.__idle(0);
      return o;
    });
    check(
      mp.has && mp.sat === 2 && mp.zero && mp.ob,
      `地圖殘骸：同時最多 2 人（${mp.sat}）、拆完價值歸零但留著、障礙物不變`,
    );
    check(!mp.known, '拆完的地圖殘骸不再列在電腦的 rtsWreckKnown');

    // ---------- 迷霧：看不到的地方產生的殘骸、殘影 ----------
    const fg = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      // 玩家的主堡旁：電腦看不到
      const p = window.__spot(hq.pos.x - 14, hq.pos.z - 14);
      const w = g.rtsWreckSpawn(p.x, p.z, { ore: 50, team: 0 });
      window.__sim(0.5);
      const has = () => g.rtsWreckKnown(1).find((k) => k.id === w.id);
      o.hidden = !has();
      g.rtsFogReveal(1, p.x, p.z, 12, 1);
      window.__sim(0.5);
      o.seen = !!has() && has().ore === 50;
      window.__sim(1.5); // 揭露結束
      o.blind = g.rtsFogState(1, p.x, p.z) !== 2;
      g.rtsWreckRemove(w);
      const k = has();
      o.ghost = !!(k && k.gone);
      g.rtsFogReveal(1, p.x, p.z, 12, 1);
      window.__sim(0.5);
      o.cleared = !has();
      return o;
    });
    check(fg.hidden && fg.seen, '迷霧：看不到的地方產生的殘骸電腦不知道，看到之後才有（價值是看到的）');
    check(fg.blind && fg.ghost && fg.cleared, '看不到時被拆完：電腦留著殘影，重新看到那一格才移除');

    // ---------- 零件的費用：路障、巨像（取消退還） ----------
    const pc = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      T.parts = 0;
      T.ore = 5000;
      T.coral = 5000;
      const msgs = [];
      const say = g.rtsSay.bind(g);
      g.rtsSay = (t, c) => (msgs.push(t), say(t, c));
      // 能蓋路障的地方
      let s = null;
      for (let r = 20; r < 60 && !s; r += 2)
        for (let a = 0; a < 24 && !s; a++) {
          const x = hq.pos.x + Math.cos(a / 3.82) * r,
            z = hq.pos.z + Math.sin(a / 3.82) * r;
          if (g.world.nav.buildable(x, z, 6, 6)) s = { x, z };
        }
      o.afford = g.rtsAfford(0, window.__D('s_barricade').cost);
      o.why = g.rtsCostWhy(0, window.__D('s_barricade').cost);
      const b0 = g.rtsPlace(0, 's_barricade', s.x, s.z, 0, null);
      o.fail = !b0 && msgs.includes('零件不足');
      T.parts = 5;
      const b1 = g.rtsPlace(0, 's_barricade', s.x, s.z, 0, null);
      o.paid = !!b1 && T.parts === 3;
      if (b1) {
        g.rtsCancel(b1, -1);
        o.cancel = T.parts; // 取消建造退 75%：floor(2×0.75)＝1
      }
      // 巨像：T3＋研究巨像骨架、零件 40
      const works = window.__bld(0, 's_works', hq.pos.x - 40, hq.pos.z + 40, 0);
      g.rtsChangeDef(hq, 's_hq3');
      g.rtsRecount();
      T.tech.res.r_titan = 1;
      T.parts = 30;
      o.q0 = g.rtsQueue(works, 's_colossus');
      T.parts = 45;
      o.q1 = g.rtsQueue(works, 's_colossus');
      o.left = T.parts;
      g.rtsCancel(works, 0);
      o.back = T.parts;
      g.rtsSay = say;
      works.rtsQuiet = true;
      works.die(null);
      g.rtsChangeDef(hq, 's_hq');
      g.rtsRecount();
      return o;
    });
    check(
      !pc.afford && pc.why === '零件不足' && pc.fail,
      `路障要零件 2：沒有零件時「零件不足」（${pc.why}）`,
    );
    check(pc.paid && pc.cancel === 4, `付了零件（5 → 3）、取消建造退 75%（→ ${pc.cancel}）`);
    check(
      !pc.q0 && pc.q1 && pc.left === 5 && pc.back === 45,
      `拼裝巨像：零件 40（不夠不能排、排了剩 ${pc.left}、取消退還 → ${pc.back}）`,
    );

    // ---------- 改裝 ----------
    const rf = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      T.parts = 200;
      T.ore = 5000;
      const near = () => window.__spot(hq.pos.x + 12, hq.pos.z + 2);
      const p = near();
      const m = window.__unit(0, 's_militia', p.x, p.z);
      const hp0 = m.maxHp,
        sp0 = m.speedMul,
        ar0 = m.rtsArmor;
      o.why = g.rtsRefitWhy(m, 'rf_plate');
      const parts0 = T.parts,
        ore0 = T.ore;
      o.n = g.rtsOrder([m], { k: 'refit', rf: 'rf_plate' });
      o.cost = [parts0 - T.parts, ore0 - T.ore].join();
      // 引導中：給移動指令也不動
      g.rtsSetOrders(m, [{ k: 'move', x: m.pos.x + 20, z: m.pos.z }]);
      const x0 = m.pos.x;
      window.__sim(1);
      o.hold = Math.abs(m.pos.x - x0) < 0.3 && m.rtsRefitTo === 'rf_plate';
      window.__sim(1.2);
      o.done = m.rtsRefit === 'rf_plate' && !m.rtsRefitTo;
      o.plate = [m.rtsArmor - ar0, (m.maxHp / hp0).toFixed(2), (m.speedMul / sp0).toFixed(2)].join();
      o.again = g.rtsRefitWhy(m, 'rf_plate');
      // 換成拼裝槍管：裝甲的效果消失
      g.rtsSetOrders(m, []);
      const dm0 = m.dmgMul;
      g.rtsRefit([m], 'rf_gun');
      window.__sim(2.2);
      o.gun = [m.rtsRefit, (m.dmgMul / dm0).toFixed(2), m.rtsArmor - ar0, (m.maxHp / hp0).toFixed(2)].join();
      // 改造推進器、加高天線（T2）
      const s0 = m.rtsVision,
        r0 = m.rtsRangeAdd;
      g.rtsRefit([m], 'rf_boost');
      window.__sim(2.2);
      o.boost = [(m.speedMul / sp0).toFixed(2), m.rtsVision - s0].join();
      o.t2why = g.rtsRefitWhy(m, 'rf_scope');
      g.rtsChangeDef(hq, 's_hq2');
      g.rtsRecount();
      g.rtsRefit([m], 'rf_scope');
      window.__sim(2.2);
      o.scope = [m.rtsRangeAdd - r0, m.rtsVision - s0].join();
      // 不能裝：工人、英雄、對空支架對地空都打的民兵、太遠
      const wk = window.__of(0, 's_worker')[0];
      o.wk = g.rtsRefitWhy(wk, 'rf_plate');
      o.aaMil = g.rtsRefitWhy(m, 'rf_aa');
      const fp = window.__spot(hq.pos.x + 70, hq.pos.z - 50);
      const f = window.__unit(0, 's_militia', fp.x, fp.z);
      o.far = g.rtsRefitWhy(f, 'rf_plate');
      o.farN = g.rtsRefit([f], 'rf_plate');
      // 零件不夠：13 個零件改 3 台廢鐵裝甲（6）＝2 台
      const us = [0, 1, 2].map((i) => window.__unit(0, 's_militia', p.x + i * 2, p.z + 3));
      T.parts = 13;
      o.lack = g.rtsRefit(us, 'rf_plate');
      o.lackLeft = T.parts;
      // 拼裝工具箱：英雄 10 m 內是改裝站、零件 ×0.75
      const tp = window.__spot(hq.pos.x + 70, hq.pos.z - 40);
      const h = window.__unit(0, 's_militia', f.pos.x + 3, f.pos.z);
      void tp;
      h.hero = { inv: [{ id: 'i_toolbox' }] };
      T.parts = 200;
      o.tool = g.rtsRefitWhy(f, 'rf_plate') === '' ? g.rtsRefitCost(0, 'rf_plate', f).parts : -1;
      T.tech.res.r_stock = 1;
      o.tool2 = g.rtsRefitCost(0, 'rf_plate', f).parts;
      T.tech.res.r_stock = 0;
      h.hero = null;
      h.rtsQuiet = true;
      window.__kill(h);
      o.refits = R.stats[0].refits;
      for (const e of [m, f, ...us]) ((e.rtsQuiet = true), window.__kill(e));
      return o;
    });
    check(
      rf.why === '' && rf.n === 1 && rf.cost === '6,10',
      `改裝：聚落中心 12 m 內、扣零件 6＋礦石 10（${rf.cost}）`,
    );
    check(rf.hold && rf.done, '引導 2 秒（期間不動），完成後裝上');
    check(
      rf.plate === '2,1.15,0.92',
      `廢鐵裝甲：護甲 +2、血量 ×1.15、速度 ×0.92（${rf.plate}）；再裝一次＝「${rf.again}」`,
    );
    check(rf.gun === 'rf_gun,1.18,0,1.00', `換成拼裝槍管：傷害 ×1.18、裝甲的效果消失（${rf.gun}）`);
    check(
      rf.boost === '1.20,2' && /T2/.test(rf.t2why) && rf.scope === '3,8',
      `改造推進器（${rf.boost}）、加高天線要 T2（${rf.t2why}）→ 射程 +3、視野 +8（${rf.scope}）`,
    );
    check(
      rf.wk === '工人不能改裝' && rf.aaMil === '這個單位不能裝' && /12 m/.test(rf.far) && rf.farN === 0,
      `不能改：工人、已經地空都打的民兵裝對空支架、不在改裝站附近（${rf.far}）`,
    );
    check(rf.lack === 2 && rf.lackLeft === 1, `零件 13 改 3 台廢鐵裝甲：停在第 2 台（剩 ${rf.lackLeft}）`);
    check(
      rf.tool === 5 && rf.tool2 === 4,
      `拼裝工具箱的英雄 10 m 內：改裝站、零件 ×0.75（6 → ${rf.tool}；加零件倉儲 → ${rf.tool2}）`,
    );

    // ---------- 對空支架打直升機、自爆裝藥 ----------
    const aa = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      T.parts = 200;
      const p = window.__spot(hq.pos.x + 12, hq.pos.z - 4);
      const sc = window.__unit(0, 's_scav', p.x, p.z);
      const he = window.__unit(1, 'c_heli', p.x + 8, p.z);
      he.updateAI = function () {};
      o.can0 = sc.rtsAbCanHit(window.__D('s_scav'), he);
      g.rtsRefit([sc], 'rf_aa');
      window.__sim(2.2);
      o.can1 = sc.rtsAbCanHit(window.__D('s_scav'), he) && sc.rtsAa === 'both' && sc.rtsAaK === 0.6;
      const hp0 = he.hp;
      g.rtsSetOrders(sc, [{ k: 'attack', id: he.id }]);
      window.__sim(4);
      o.dmg = Math.round(hp0 - he.hp);
      he.rtsQuiet = true;
      window.__kill(he);
      // 自爆裝藥：陣亡時 4 m 內的敵人 80 爆發＋暈眩
      g.rtsRefit([sc], 'rf_bomb');
      window.__sim(2.2);
      const en = window.__unit(1, 'c_mt', sc.pos.x + 2, sc.pos.z);
      en.updateAI = function () {};
      const own = window.__unit(0, 's_militia', sc.pos.x - 2, sc.pos.z);
      const e0 = en.hp,
        w0 = own.hp;
      window.__kill(sc);
      o.bomb = Math.round(e0 - en.hp);
      o.stun = en.staggerT > 0 || (en.rtsStunT || 0) > R.t;
      o.own = own.hp === w0;
      en.rtsQuiet = true;
      window.__kill(en);
      own.rtsQuiet = true;
      window.__kill(own);
      return o;
    });
    check(
      !aa.can0 && aa.can1 && aa.dmg > 0,
      `對空支架：拾荒 MT 本來打不到直升機，裝了之後打得到（4 秒 ${aa.dmg} 傷害）`,
    );
    check(
      aa.bomb > 30 && aa.stun && aa.own,
      `自爆裝藥：陣亡時炸到旁邊的敵人（${aa.bomb}）＋暈眩，不打自己人`,
    );

    // ---------- 避難警報 ----------
    const sh = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      window.__idle(0);
      // 12 台工人在聚落中心旁邊（沒有其他避難建築：10 台躲進去）
      while (window.__of(0, 's_worker').length < 12)
        window.__unit(0, 's_worker', hq.pos.x + 14, hq.pos.z - 10);
      for (const w of window.__of(0, 's_worker')) {
        const p = window.__spot(hq.pos.x + 12 + Math.random() * 4, hq.pos.z - 10 + Math.random() * 6);
        w.pos.set(p.x, g.world.groundAt(p.x, p.z, 99), p.z);
        R.hash.update(w, p.x, p.z);
        g.rtsSetOrders(w, [{ k: 'gather', mine: R.mines[0].id }]);
      }
      o.n = g.rtsOrder([hq], { k: 'ability', ab: 'ab_shelter' });
      window.__sim(12, () => (hq.bld.shel || []).length >= 10);
      o.in = (hq.bld.shel || []).length;
      const inW = window.__of(0, 's_worker').filter((w) => w.rtsShelter);
      o.hidden = inW.every(
        (w) => w.rtsShelter === hq && w.rtsAboard && !w.mesh.parent && !g.allies.includes(w),
      );
      o.out = window.__of(0, 's_worker').filter((w) => !w.rtsShelter).length;
      o.cd = g.rtsShelterWhy(hq);
      // 建築開火：10 台＝dps 40
      const p = window.__spot(hq.pos.x + 20, hq.pos.z + 14);
      const en = window.__unit(1, 'c_tank', p.x, p.z);
      en.updateAI = function () {
        this.move(0.05, new THREE.Vector3(), false, false, false, null);
      };
      en.maxHp = en.hp = 1e5;
      const h0 = en.hp;
      window.__sim(5);
      const k = g.rtsDmgK('kin', en);
      o.dps = (h0 - en.hp) / 5 / k;
      en.rtsQuiet = true;
      window.__kill(en);
      // 解除：回原本的工作
      g.rtsOrder([hq], { k: 'ability', ab: 'ab_unshelter' });
      window.__sim(0.2);
      const ws = window.__of(0, 's_worker');
      o.unsh =
        ws.every((w) => !w.rtsShelter && !w.rtsAboard) &&
        ws.filter((w) => w.orders[0] && w.orders[0].k === 'gather').length >= 10;
      // 45 秒後出來（冷卻 60：直接把冷卻歸零再放一次）
      hq.rtsCd.ab_shelter = 0;
      g.rtsShelter(hq);
      window.__sim(12, () => (hq.bld.shel || []).length >= 10);
      window.__sim(30);
      o.still = (hq.bld.shel || []).length;
      window.__sim(16);
      o.after45 = (hq.bld.shel || []).length;
      // 避難屋 5：建築被拆時彈出、各受最大血量 50%
      const dp = window.__bld(0, 's_depot', hq.pos.x + 30, hq.pos.z - 24, 0);
      hq.rtsCd.ab_shelter = 0;
      for (const w of window.__of(0, 's_worker')) {
        const q = window.__spot(dp.pos.x + 6, dp.pos.z + 2);
        w.pos.set(q.x, g.world.groundAt(q.x, q.z, 99), q.z);
        R.hash.update(w, q.x, q.z);
      }
      g.rtsShelter(hq);
      window.__sim(12, () => (dp.bld.shel || []).length >= 5 && (hq.bld.shel || []).length >= 7);
      o.depotIn = (dp.bld.shel || []).length;
      window.__shot = { dp: dp.id };
      const inD = window.__of(0, 's_worker').filter((w) => w.rtsShelter === dp);
      window.__kill(dp);
      o.eject = inD.length === 5 && inD.every((w) => !w.rtsShelter && Math.abs(w.hp / w.maxHp - 0.5) < 0.01);
      o.ej = inD.map((w) => (w.hp / w.maxHp).toFixed(2) + (w.rtsShelter ? 'in' : '')).join(' ');
      g.rtsUnshelter(hq);
      return o;
    });
    check(
      sh.n === 1 && sh.in === 10 && sh.hidden && sh.out === 2,
      `避難警報：12 台工人、聚落中心躲 10 台（${sh.in}，不在場景與名單裡），2 台沒位置`,
    );
    check(/冷卻/.test(sh.cd), `冷卻 60 秒（${sh.cd}）`);
    check(Math.abs(sh.dps - 40) < 6, `有工人躲著的建築開火：10 台＝dps ${sh.dps.toFixed(1)}（40）`);
    check(sh.unsh, '解除避難：工人出來、回去採礦');
    check(sh.still === 10 && sh.after45 === 0, `45 秒後出來（30 秒時還有 ${sh.still}、之後 ${sh.after45}）`);
    check(
      sh.depotIn === 5 && sh.eject,
      `避難屋躲 5 台（${sh.depotIn}）；建築被拆時彈出、各受最大血量 50%（${sh.ej}）`,
    );

    // ---------- 修理半價 ----------
    const rp = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      const per = (team, def, wdef) => {
        const b = window.__bld(team, def, 0, team ? 60 : -60, 0);
        const w = window.__unit(team, wdef, b.pos.x + 8, b.pos.z);
        b.hp = b.maxHp * 0.5;
        const T = R.teams[team];
        T.ore = 1000;
        const h0 = b.hp;
        g.rtsRepairStep(b, w, 1);
        const r = (1000 - T.ore) / (b.hp - h0) / ((window.__D(def).cost.ore / b.maxHp) * 0.35);
        b.rtsQuiet = true;
        b.die(null);
        w.rtsQuiet = true;
        window.__kill(w);
        return r;
      };
      o.c = per(1, 'c_depot', 'c_worker');
      o.s = per(0, 's_depot', 's_worker');
      return o;
    });
    check(
      Math.abs(rp.c - 1) < 0.01 && Math.abs(rp.s - 0.5) < 0.01,
      `修理費：卡斯特隆 ×${rp.c.toFixed(2)}、聖域 ×${rp.s.toFixed(2)}（半價）`,
    );

    // ---------- 拆除 ----------
    const sc = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      window.__idle(0);
      const hall = window.__bld(0, 's_hall', hq.pos.x - 40, hq.pos.z - 30, 0);
      T.ore = 1000;
      g.rtsQueue(hall, 's_militia');
      g.rtsQueue(hall, 's_militia');
      const ore0 = T.ore;
      o.n = g.rtsOrder([hall], { k: 'scrap' });
      window.__sim(2.5);
      o.alive = !hall.dead;
      window.__sim(1);
      o.dead = hall.dead;
      o.refund = T.ore - ore0;
      const w = R.wrecks.filter((q) => !q.map && q.bld).slice(-1)[0];
      o.val = w ? [w.ore, w.parts, w.size, Math.hypot(w.x - hall.pos.x, w.z - hall.pos.z) < 0.5].join() : '';
      // 卡斯特隆的建築不能拆
      o.cwhy = g.rtsScrapWhy(window.__hq1);
      return o;
    });
    check(sc.n === 1 && sc.alive && sc.dead, '拆除：3 秒後建築消失');
    check(
      sc.refund === 150 && sc.val === '70,6,3,true',
      `佇列全額退還（${sc.refund}）、原地留下 50% 的殘骸（集會所 140 → ${sc.val}）`,
    );
    check(sc.cwhy === '這個陣營不能拆除', `卡斯特隆的建築：${sc.cwhy}`);

    // ---------- 地雷 ----------
    const mn = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      const p = window.__spot(40, -40);
      const dr = window.__unit(0, 's_mine', p.x, p.z);
      dr.updateAI = function () {};
      const m = g.rtsLandMineAdd(0, p.x, p.z, { owner: dr });
      const en = window.__unit(1, 'c_mt', p.x + 0.5, p.z);
      en.updateAI = function () {
        this.move(0.05, new THREE.Vector3(), false, false, false, null);
      };
      const h0 = en.hp;
      window.__sim(1.5);
      o.unarmed = !m.dead && en.hp === h0;
      window.__sim(1);
      o.boom = !!m.dead && h0 - en.hp > 20;
      // 自己的單位、空中單位不觸發
      const m2 = g.rtsLandMineAdd(0, p.x + 30, p.z, {});
      const own = window.__unit(0, 's_militia', p.x + 30, p.z);
      own.updateAI = function () {};
      const he = window.__unit(1, 'c_heli', p.x + 30.5, p.z);
      he.updateAI = function () {};
      window.__sim(3);
      o.safe = !m2.dead;
      he.rtsQuiet = true;
      window.__kill(he);
      // 每台 6 顆（最舊的消失）、研究定向地雷 9 顆、120
      for (let i = 0; i < 8; i++) g.rtsLandMineAdd(0, p.x + 40 + i * 3, p.z, { owner: dr });
      o.per = g.rtsLandMinesOf(0).filter((q) => q.owner === dr.id).length;
      R.teams[0].tech.res.r_mines = 1;
      for (let i = 0; i < 8; i++) g.rtsLandMineAdd(0, p.x + 40 + i * 3, p.z + 6, { owner: dr });
      o.per2 = g.rtsLandMinesOf(0).filter((q) => q.owner === dr.id).length;
      o.dmg2 = g.rtsLandMinesOf(0).slice(-1)[0].dmg;
      R.teams[0].tech.res.r_mines = 0;
      // 看得到的規則：敵方 6 m 內
      window.__sim(0.3);
      o.seen0 = g.rtsLandMinesSeen(1).some((q) => q === m2);
      const sp = window.__unit(1, 'c_mt', p.x + 34, p.z + 1);
      sp.updateAI = function () {
        this.move(0.05, new THREE.Vector3(), false, false, false, null);
      };
      window.__sim(0.3);
      o.seen1 = g.rtsLandMinesSeen(1).some((q) => q === m2);
      // 一隊 40 顆
      for (let i = 0; i < 50; i++) g.rtsLandMineAdd(0, -80 + (i % 10) * 3, 80 + Math.floor(i / 10) * 3, {});
      o.team = g.rtsLandMinesOf(0).length;
      for (const q of R.lmines.slice()) g.rtsLandMineRemove(q);
      for (const e of [dr, own, sp, en]) if (!e.dead) ((e.rtsQuiet = true), window.__kill(e));
      return o;
    });
    check(mn.unarmed && mn.boom, '地雷：2 秒後才啟動，敵方的地面單位踩到引爆');
    check(mn.safe, '自己的單位、空中單位不觸發');
    check(
      mn.per === 6 && mn.per2 === 9 && mn.dmg2 === 120 && mn.team === 40,
      `每台 6 顆（${mn.per}）、研究後 9 顆、120；一隊最多 ${mn.team} 顆`,
    );
    check(!mn.seen0 && mn.seen1, `敵方的地雷：6 m 內有單位時才看得到（${mn.seen0}／${mn.seen1}）`);

    // ---------- 潛航的迷霧、互助網、診療所 ----------
    const misc = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      const p = window.__spot(-30, 30);
      const gb = window.__unit(0, 's_gunboat', p.x, p.z);
      gb.updateAI = function () {};
      const en = window.__unit(1, 'c_mt', p.x + 18, p.z);
      en.updateAI = function () {};
      window.__sim(0.3);
      o.vis0 = g.rtsVisible(1, gb);
      gb.rtsSub = true;
      o.vis1 = g.rtsVisible(1, gb);
      en.pos.x = p.x + 5;
      R.hash.update(en, en.pos.x, en.pos.z);
      o.vis2 = g.rtsVisible(1, gb);
      gb.rtsSub = false;
      for (const e of [gb, en]) ((e.rtsQuiet = true), window.__kill(e));
      // 互助網：12 m 內有 4 台以上己方單位
      T.tech.res.r_mutual = 1;
      const q = window.__spot(-40, -10);
      const grp = [0, 1, 2, 3, 4].map((i) => window.__unit(0, 's_militia', q.x + i * 2.4, q.z));
      const lone = window.__unit(0, 's_militia', q.x + 60, q.z + 40);
      for (const e of [...grp, lone]) e.updateAI = function () {};
      const a0 = grp[0].rtsArmor,
        d0 = grp[0].dmgMul;
      window.__sim(0.7);
      o.mutual = [grp[0].rtsArmor - a0, (grp[0].dmgMul / d0).toFixed(2)].join();
      o.lone = lone.rtsArmor - a0;
      T.tech.res.r_mutual = 0;
      for (const e of [...grp, lone]) ((e.rtsQuiet = true), window.__kill(e));
      // 診療所：14 m 內每秒回 3 AP
      const cl = window.__bld(0, 's_clinic', hq.pos.x - 10, hq.pos.z + 40, 0);
      const u = window.__unit(0, 's_militia', cl.pos.x + 12, cl.pos.z);
      u.updateAI = function () {};
      u.hp = 100;
      window.__sim(0.6);
      const h0 = u.hp;
      window.__sim(2);
      o.clinic = ((u.hp - h0) / 2).toFixed(1);
      u.rtsQuiet = true;
      window.__kill(u);
      return o;
    });
    check(misc.vis0 && !misc.vis1 && misc.vis2, '潛航：敵方 6 m 內沒有實體時看不到，靠近 5 m 才看得到');
    check(
      misc.mutual === '2,1.08' && misc.lone === 0,
      `互助網：成群的護甲 +2、傷害 ×1.08（${misc.mutual}），落單的沒有`,
    );
    check(Math.abs(+misc.clinic - 3) < 0.3, `診療所：14 m 內每秒回 ${misc.clinic} AP（3）`);

    // ---------- 截圖：殘骸（B 的外觀之前：測試自己畫的標記）與拾荒中的工人 ----------
    await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      window.__idle(0);
      g.rtsFogRevealAll(0, true);
      const c = { x: hq.pos.x + 26, z: hq.pos.z + 16 };
      const ws = window.__of(0, 's_worker');
      const list = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const p = window.__spot(c.x + Math.cos(a) * 8, c.z + Math.sin(a) * 8);
        list.push(g.rtsWreckSpawn(p.x, p.z, { ore: 40 + i * 30, parts: 6, team: i & 1 }));
      }
      // 工人搬到殘骸旁邊：拆到一半的樣子
      for (let i = 0; i < 8 && i < ws.length; i++) {
        const q = window.__spot(c.x + (i % 4) * 3 - 4, c.z - 12 + Math.floor(i / 4) * 3);
        ws[i].pos.set(q.x, g.world.groundAt(q.x, q.z, 99), q.z);
        ws[i].mesh.position.copy(ws[i].pos);
        R.hash.update(ws[i], q.x, q.z);
        g.rtsOrder([ws[i]], { k: 'salvage', wid: list[i % 9].id });
      }
      window.__sim(9);
      // 標記（B 包的 InstancedMesh 之前）
      const grp = new THREE.Group();
      grp.userData.helper = true;
      for (const w of R.wrecks) {
        if (w.map) continue;
        const k = 0.5 + 0.5 * Math.min(1, w.ore / w.ore0);
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(w.r * 1.6 * k, 0.8 * k, w.r * 1.2 * k),
          new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.9 }),
        );
        m.position.set(w.x, w.y + 0.4 * k, w.z);
        m.rotation.y = w.x;
        grp.add(m);
      }
      g.scene.add(grp);
      window.__grp = grp;
      if (R.cam) {
        R.cam.x = c.x;
        R.cam.z = c.z;
        R.cam.dist = 55;
      }
      if (g.rtsCamJump) g.rtsCamJump(c.x, c.z);
      g.rtsTick(0.001);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r5a-wrecks.png') });
    const hv = await ev(() => {
      const g = window.__game,
        R = g.rts;
      return R.stats[0].salvOre;
    });
    check(hv > 0, `截圖 rts-r5a-wrecks.png（拾荒的礦石合計 ${Math.round(hv)}）`);

    // ---------- 選單、結果、隨機、其他陣營的開局不變 ----------
    const mu = await ev(() => {
      const g = window.__game;
      const o = {};
      g.scene.remove(window.__grp);
      // 結果畫面
      g.rtsEnd(true);
      g.rtsShowResult();
      const txt = document.getElementById('rtsEnd').textContent;
      o.result = /拾荒（礦石／零件）/.test(txt) && /改裝/.test(txt);
      // 選單：聖域可以選
      g.rtsMenuOpen();
      const b = document.querySelector('[data-pf="sancta"]');
      o.menu = !!b && !b.disabled;
      g.state = 'rtsmenu';
      // 「隨機」會抽到聖域
      const seen = new Set();
      for (let i = 1; i <= 24 && !seen.has('sancta'); i++) {
        const s = (i * 2654435761) >>> 0;
        g.rtsStart({ theme: 'wasteland', seed: s, size: 400, faction: 'random', aiFaction: 'castron' });
        seen.add(g.rts.teams[0].faction);
      }
      o.rand = [...seen].join();
      // 其他陣營：沒有聖域時不產生殘骸、開局不變
      const R = window.__start('castron', 'aetheric', 7);
      o.cs = [
        R.salvage,
        R.wrecks.length,
        window.__of(0, 'c_worker').length,
        window.__of(1, 'a_worker').length,
      ].join();
      const mt = window.__unit(0, 'c_mt', 0, 0);
      window.__kill(mt);
      const dp = window.__bld(1, 'a_hq', 0, 40, 0);
      if (dp) dp.die(null);
      o.none = R.wrecks.length;
      const R2 = window.__start('veerwell', 'sancta', 7);
      o.vs = [
        R2.salvage,
        R2.teams[1].faction,
        window.__of(1, 's_worker').length,
        window.__of(0, 'v_worker').length,
      ].join();
      return o;
    });
    check(mu.result, '結果畫面：有聖域的對局多「拾荒（礦石／零件）」與「改裝」兩列');
    check(mu.menu && /sancta/.test(mu.rand), `選單：聖域可以選；「隨機」抽到：${mu.rand}`);
    check(
      /^false,0,5,/.test(mu.cs) && mu.none === 0,
      `卡斯特隆對艾瑟立克：沒有殘骸（${mu.cs}，擊破後 ${mu.none} 個）`,
    );
    check(mu.vs === 'true,sancta,5,5', `維爾威對聖域（電腦）：開局（${mu.vs}）`);

    await ctx.close();
  }

  return { testRtsSanc };
};
