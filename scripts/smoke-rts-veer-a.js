// Coral 戰爭（RTS）R4 A 包（維爾威的核心與資料，docs/rts-design.md 15.2、15.11）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-veer-a')(H)。
// testRtsVeer：開局與英雄子選單、工人不建造、每趟 10；空投（rtsDropWhy 的原因、扣款、起飛點、飛行時間、下降是低空、
// 放下地基、自己展開、被擊落退 50%、起飛後取消退 75%、同時空投數）；投放艙（信標內＝集結點、信標外＝建築正面、
// 軌道投放、4／2.5 秒、對手看得到、強襲投放艙）；信標上限、被拆時退回、臨時信標到期；收起（條件、導航格與碰撞、低空、
// 生產暫停、人口照給、移動、展開時推開單位、×1.25、20 秒冷卻、只剩收起的建築 90 秒後揭露）；集貨站；交易；載運；
// visAir；緊急補給；「隨機」會抽到維爾威；卡斯特隆與艾瑟立克的開局不變。截圖：rts-r4a-drop／pod／pack.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim＋rtsFogTick 快轉。
/* global window, document */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsVeer(browser, base) {
    console.log('Coral 戰爭：維爾威的空投、投放艙、機動建築、集貨站、交易、載運（R4 核心）');
    const { ctx, page } = await newPage(browser, 'rtsVeer');
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
      window.__start = (fa, fb, seed = 7) => {
        g.rtsStart({ theme: 'wasteland', seed, size: 400, faction: fa, aiFaction: fb, diff: 'normal' });
        const R = g.rts;
        R.teams[0].ore = R.teams[1].ore = 20000;
        R.teams[0].coral = R.teams[1].coral = 20000;
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
      // 可以空投的地點（rtsDropSiteWhy＝''）：從 (x, z) 往外找
      window.__dspot = (team, def, x, z, r0 = 0, r1 = 40) => {
        for (let r = r0; r <= r1; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (!g.rtsDropSiteWhy(team, def, px, pz, 0)) return { x: px, z: pz };
            if (r === 0) break;
          }
        return null;
      };
      // 直接放蓋好的建築（不檢查迷霧）
      window.__bld = (team, def, x, z, r0 = 0, p = 1) => {
        const D = window.__D(def);
        for (let r = r0; r <= 50; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (g.world.nav.buildable(px, pz, D.foot[0] + 2, D.foot[1] + 2))
              return g.rtsSpawnBld(team, def, px, pz, 0, p);
            if (r === 0) break;
          }
        return null;
      };
      window.__dep = [[], []];
      const dep = g.rtsDeposit.bind(g);
      g.rtsDeposit = (t, k, n) => {
        if (window.__dep[t] && k === 'ore') window.__dep[t].push(n);
        return dep(t, k, n);
      };
      const R = window.__start('veerwell', 'castron');
      const hq = window.__hq;
      return {
        fac: [R.teams[0].faction, R.teams[1].faction],
        hq: hq.rtsDef,
        wk: window.__of(0, 'v_worker').length,
        hq1: window.__of(1, 'c_hq').length,
        wk1: window.__of(1, 'c_worker').length,
        menu: (window.__D('v_hq').menus.hero || []).map((c) => c.key + ':' + c.name).join(' '),
        drop: (window.__D('v_hq').menus.drop || []).length,
        wcard: window
          .__D('v_worker')
          .card.map((c) => c.act.k + (c.act.menu ? ':' + c.act.menu : ''))
          .join(' '),
        avail: !!window.__D('v_hq') && g.rtsVeerTeam(0) && !g.rtsVeerTeam(1),
      };
    });
    check(
      st.fac.join() === 'veerwell,castron' && st.hq === 'v_hq' && st.wk === 5 && st.hq1 === 1 && st.wk1 === 5,
      `開局：維爾威（調度中心＋5 台物流 MT）對卡斯特隆（主堡＋5）`,
    );
    check(
      /Q:COURIER W:SKYHOOK E:VECTOR V:返回/.test(st.menu) && st.drop === 12 && st.avail,
      `調度中心的英雄子選單（${st.menu}）、空投子選單 ${st.drop} 格`,
    );
    check(!/menu:build/.test(st.wcard) && /menu:drop/.test(st.wcard), `物流 MT 沒有建造卡（${st.wcard}）`);

    // ---------- 工人不建造、每趟 10 ----------
    const eco = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const ws = window.__of(0, 'v_worker');
      const s = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 14, 34);
      o.spot = !!s;
      const ore0 = R.teams[0].ore;
      const rec = g.rtsOrder(ws, { k: 'build', def: 'v_depot', x: s.x, z: s.z, yaw: 0 });
      o.noBuild = ws.every((w) => !w.orders.some((q) => q.k === 'build'));
      o.drop = !!(rec && rec.st === 'wait' && R.drops.length === 1);
      o.paid = ore0 - R.teams[0].ore;
      o.cancel = g.rtsDropCancel(rec);
      o.refund = R.teams[0].ore === ore0 && R.drops.length === 0;
      window.__sim(40);
      const d0 = window.__dep[0];
      o.n = d0.length;
      o.all10 = d0.length > 0 && d0.every((n) => n === 10);
      return o;
    });
    check(
      eco.spot && eco.noBuild && eco.drop && eco.paid === 80,
      `工人的 build 指令轉成空投（工人不去蓋、扣 ${eco.paid}）`,
    );
    check(eco.cancel && eco.refund, '起飛前取消：全額退還');
    check(eco.all10, `物流 MT 每趟 10（${eco.n} 趟）`);

    // ---------- 空投的限制 ----------
    const why = await ev(() => {
      // 之後的檢查要看資源的增減：工人停工
      for (const w of window.__of(0, 'v_worker')) {
        window.__game.rtsSetOrders(w, []);
        w.carry = null;
      }
      const g = window.__game,
        R = g.rts,
        hq = window.__hq,
        e1 = window.__hq1;
      const o = {};
      o.unexp = g.rtsDropWhy(0, 'v_depot', e1.pos.x + 20, e1.pos.z);
      o.block = g.rtsDropWhy(0, 'v_depot', hq.pos.x, hq.pos.z);
      // 抽取站不在湧出點
      const s = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 14, 34);
      o.vent = g.rtsDropWhy(0, 'v_extractor', s.x + 0.5, s.z + 0.5);
      // 記得的敵方建築：揭露敵方主堡一帶，離主堡邊緣 22 m 的地方
      g.rtsFogReveal(0, e1.pos.x, e1.pos.z, 70, 1);
      window.__sim(0.3);
      o.known = g.rtsFogKnown(0).length;
      let near = '';
      for (let a = 0; a < 24 && !near; a++) {
        const x = e1.pos.x + Math.cos((a / 24) * Math.PI * 2) * 30,
          z = e1.pos.z + Math.sin((a / 24) * Math.PI * 2) * 30;
        if (g.world.nav.buildable(x, z, 7, 7) && g.rtsFogState(0, x, z) >= 1)
          near = g.rtsDropWhy(0, 'v_depot', x, z);
      }
      o.near = near;
      // 運輸機都在任務中
      const a = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 16, 34);
      const r1 = g.rtsDropOrder(0, 'v_depot', a.x, a.z, 0);
      const b = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 16, 34);
      const r2 = g.rtsDropOrder(0, 'v_depot', b.x, b.z, 0);
      const c = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 16, 34);
      o.full = g.rtsDropWhy(0, 'v_depot', c.x, c.z);
      o.lift = g.rtsDropLift(0);
      g.rtsDropCancel(r1);
      g.rtsDropCancel(r2);
      o.empty = R.drops.length === 0;
      return o;
    });
    check(why.unexp === '要投放在探索過的地方', `沒探索：「${why.unexp}」`);
    check(why.block === '這裡不能蓋', `不能蓋：「${why.block}」`);
    check(why.vent === '要蓋在 Coral 湧出點上', `抽取站不在湧出點：「${why.vent}」`);
    check(why.known >= 1 && why.near === '離敵方建築太近', `離記得的敵方建築 30 m：「${why.near}」`);
    check(
      why.full === '運輸機都在任務中（2／2）' && why.lift.max === 2 && why.empty,
      `運輸機滿：「${why.full}」`,
    );

    // ---------- 空投的流程 ----------
    const fl = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const s = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 28, 40);
      const ore0 = R.teams[0].ore;
      const rec = g.rtsDropOrder(0, 'v_depot', s.x, s.z, 0);
      o.paid = ore0 - R.teams[0].ore;
      window.__sim(0.05);
      const ship = g.rtsEnt(rec.ship);
      o.ship = ship && ship.rtsDef;
      o.from = ship ? Math.hypot(ship.pos.x - hq.pos.x, ship.pos.z - hq.pos.z) : -1;
      o.dist = Math.hypot(s.x - hq.pos.x, s.z - hq.pos.z);
      o.alt = ship ? ship.pos.y - g.world.terrainHeight(ship.pos.x, ship.pos.z) : 0;
      // 地面武器（盾牌 MT：只打地面）打不打得到
      const foe = g.rtsSpawn(1, 'c_shield', s.x + 40, s.z + 40);
      foe.updateAI = () => {};
      const D = window.__D('c_shield');
      o.hitFly = foe.rtsAbCanHit(D, ship);
      o.lowFly = g.rtsLowAir(ship);
      o.tFly = window.__sim(20, () => rec.st === 'land');
      o.hitLand = foe.rtsAbCanHit(D, ship);
      o.lowLand = g.rtsLowAir(ship);
      window.__sim(1.2);
      o.altLand = ship.pos.y - g.world.terrainHeight(ship.pos.x, ship.pos.z);
      window.__sim(5, () => rec.st === 'back');
      const b = window.__of(0, 'v_depot').find((e) => Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < 13);
      window.__dep0 = b;
      o.bld = !!b;
      o.p0 = b ? b.bld.progress : -1;
      o.hp0 = b ? b.hp / b.maxHp : 0;
      o.stats = R.stats[0].drops;
      // 展開中受到的傷害 ×1.25（同一棟建築展開前後比較）
      o.kU = b ? g.rtsDmgK('kin', b) : 0;
      window.__sim(30, () => !R.drops.length);
      o.shipGone = !ship || ship.dead;
      window.__sim(30, () => b.bld.progress >= 1);
      o.p1 = b.bld.progress;
      o.kD = g.rtsDmgK('kin', b);
      o.workers = b.bld.builders.size;
      foe.rtsQuiet = true;
      foe.die(null);
      // 從最近的機庫起飛
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      const hg = window.__bld(
        0,
        'v_hangar',
        hq.pos.x - (hq.pos.x / L) * 50,
        hq.pos.z - (hq.pos.z / L) * 50,
        0,
      );
      window.__sim(0.3);
      let s2 = null;
      for (let r = 14; r <= 26 && !s2; r += 2)
        for (let a = 0; a < 24 && !s2; a++) {
          const x = hg.pos.x + Math.cos((a / 24) * Math.PI * 2) * r,
            z = hg.pos.z + Math.sin((a / 24) * Math.PI * 2) * r;
          if (
            Math.hypot(x - hq.pos.x, z - hq.pos.z) > Math.hypot(x - hg.pos.x, z - hg.pos.z) + 10 &&
            !g.rtsDropSiteWhy(0, 'v_beacon', x, z)
          )
            s2 = { x, z };
        }
      const r2 = g.rtsDropOrder(0, 'v_beacon', s2.x, s2.z, 0);
      window.__sim(0.05);
      const sh2 = g.rtsEnt(r2.ship);
      o.fromHangar = sh2 ? Math.hypot(sh2.pos.x - hg.pos.x, sh2.pos.z - hg.pos.z) : -1;
      window.__sim(30, () => !R.drops.length);
      window.__hangar = hg;
      return o;
    });
    check(
      fl.paid === 80 && fl.ship === 'v_carrier' && fl.from < 3,
      `下單扣款 80；空投運輸機從調度中心起飛（${fl.from.toFixed(1)} m）`,
    );
    check(
      !fl.hitFly && !fl.lowFly && fl.hitLand && fl.lowLand && fl.alt > 9,
      `飛行中（高 ${fl.alt.toFixed(1)} m）地面武器打不到；下降時是低空、打得到`,
    );
    const tExp = fl.dist / 22;
    check(
      fl.tFly > tExp * 0.8 && fl.tFly < tExp * 1.6 + 1.5,
      `飛行時間 ${fl.tFly.toFixed(1)} 秒（${fl.dist.toFixed(0)} m／22 m/s ≈ ${tExp.toFixed(1)}）；下降後高 ${fl.altLand.toFixed(1)} m`,
    );
    check(
      fl.bld && fl.p0 < 0.05 && fl.hp0 < 0.2 && fl.stats === 1,
      `放下地基（進度 ${fl.p0.toFixed(3)}、血量 ${(fl.hp0 * 100).toFixed(0)}%）`,
    );
    check(fl.shipGone, '運輸機飛回起飛點後移除');
    check(
      fl.p1 >= 1 && fl.workers === 0 && Math.abs(fl.kU / fl.kD - 1.25) < 0.01,
      `沒有工人也自己展開完成；展開中受到的傷害 ×${(fl.kU / fl.kD).toFixed(2)}`,
    );
    check(fl.fromHangar >= 0 && fl.fromHangar < 3, `從最近的機庫起飛（${fl.fromHangar.toFixed(1)} m）`);

    // ---------- 被擊落退 50%、起飛後取消退 75%、截圖、同時空投數 ----------
    const lost = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const s = window.__dspot(0, 'v_bay', hq.pos.x, hq.pos.z, 20, 40);
      const ore0 = R.teams[0].ore,
        cor0 = R.teams[0].coral;
      const rec = g.rtsDropOrder(0, 'v_bay', s.x, s.z, 0);
      window.__sim(0.5);
      const ship = g.rtsEnt(rec.ship);
      g.rtsHit(ship, 1e6, 0, null, 'none');
      window.__sim(0.1);
      o.ore = ore0 - R.teams[0].ore;
      o.coral = cor0 - R.teams[0].coral;
      o.lost = R.stats[0].dropLost;
      o.gone = !R.drops.length;
      const ore1 = R.teams[0].ore;
      const r2 = g.rtsDropOrder(0, 'v_bay', s.x, s.z, 0);
      window.__sim(0.5);
      o.st = r2.st;
      g.rtsDropCancel(r2);
      o.ore2 = ore1 - R.teams[0].ore;
      o.back = r2.st === 'back';
      window.__sim(20, () => !R.drops.length);
      // 截圖用：一台正在下降的空投運輸機
      const r3 = g.rtsDropOrder(0, 'v_bay', s.x, s.z, 0);
      window.__sim(20, () => r3.st === 'land');
      window.__sim(1.5);
      window.__shot = { x: s.x, z: s.z };
      return o;
    });
    check(
      lost.ore === 85 && lost.coral === 20 && lost.lost === 1 && lost.gone,
      `放下之前被擊落：退 50%（損失礦石 ${lost.ore}、Coral ${lost.coral}）`,
    );
    check(
      lost.st === 'fly' && lost.back && lost.ore2 === 43,
      `起飛後取消：運輸機折返、退 75%（損失 ${lost.ore2}）`,
    );
    await ev(() => {
      const g = window.__game;
      if (g.rtsCamJump) g.rtsCamJump(window.__shot.x, window.__shot.z);
      window.__pump(0.3, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4a-drop.png') });
    const lift = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      window.__sim(30, () => !R.drops.length);
      const o = { m: [g.rtsDropLift(0).max] };
      g.rtsChangeDef(hq, 'v_hq2');
      g.rtsRecount();
      o.m.push(g.rtsDropLift(0).max);
      g.rtsChangeDef(hq, 'v_hq3');
      g.rtsRecount();
      o.m.push(g.rtsDropLift(0).max);
      R.teams[0].tech.res.r_lift = 1;
      o.m.push(g.rtsDropLift(0).max);
      delete R.teams[0].tech.res.r_lift;
      g.rtsChangeDef(hq, 'v_hq');
      g.rtsRecount();
      return o;
    });
    check(lift.m.join() === '2,3,4,5', `同時空投數 T1／T2／T3／研究增派運輸機：${lift.m.join('／')}`);

    // ---------- 投放艙與信標 ----------
    const pod = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const bay = window.__bld(0, 'v_bay', hq.pos.x + 30, hq.pos.z, 0);
      window.__bay = bay;
      // 信標：離調度所 45 m（調度中心的 20 m 範圍外）
      const bp = window.__dspot(0, 'v_beacon', bay.pos.x, bay.pos.z, 40, 60) || {
        x: bay.pos.x,
        z: bay.pos.z + 45,
      };
      const bc = g.rtsSpawnBld(0, 'v_beacon', bp.x, bp.z, 0, 1);
      window.__bc = bc;
      bay.bld.rally = { x: bc.pos.x + 6, z: bc.pos.z };
      o.via = g.rtsDropPoint(bay).via;
      g.rtsQueue(bay, 'v_mt');
      const n0 = R.pods.length;
      window.__sim(20, () => R.pods.length > n0);
      const p = R.pods[R.pods.length - 1];
      o.podVia = p.via;
      o.delay = p.t - p.t0;
      o.podD = Math.hypot(p.x - bc.pos.x - 6, p.z - bc.pos.z);
      o.n0 = window.__of(0, 'v_mt').length;
      o.popWhile = R.teams[0].pop;
      // 對手看得到預警圈（看得到那一格時）
      o.seen0 = g.rtsPodsSeen(1).length;
      g.rtsFogRevealAll(1, true);
      window.__sim(0.25);
      o.seen1 = g.rtsPodsSeen(1).length;
      g.rtsFogRevealAll(1, false);
      window.__sim(0.25);
      const tL = window.__sim(6, () => !R.pods.includes(p));
      o.tL = tL;
      const u = window.__of(0, 'v_mt').find((e) => Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 3);
      o.landed = !!u;
      o.popAfter = R.teams[0].pop;
      o.stun = u ? u.staggerT > 0 : false;
      // 信標外＝建築正面
      bay.bld.rally = { x: bay.pos.x + 90, z: bay.pos.z + 90 };
      const P2 = g.rtsDropPoint(bay);
      o.bldVia = P2.via;
      o.bldD = Math.hypot(P2.x - bay.pos.x, P2.z - bay.pos.z);
      // 臨時信標
      g.rtsBeaconAddTemp(0, bay.bld.rally.x, bay.bld.rally.z, 2);
      o.tmpVia = g.rtsDropPoint(bay).via;
      o.tmpN = g.rtsBeacons(0).length;
      window.__sim(2.5);
      o.tmpExp = g.rtsDropPoint(bay).via;
      // 軌道通訊站：探索過、離記得的敵方建築 20 m 以上的集結點
      const up = window.__bld(0, 'v_uplink', hq.pos.x - 30, hq.pos.z, 0);
      const rp = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 30, 40);
      bay.bld.rally = { x: rp.x, z: rp.z };
      o.orbit = g.rtsDropPoint(bay).via;
      g.rtsQueue(bay, 'v_mt');
      const n1 = R.pods.length;
      window.__sim(20, () => R.pods.length > n1);
      const p2 = R.pods[R.pods.length - 1];
      o.orbitDelay = p2.t - p2.t0;
      window.__sim(8, () => !R.pods.includes(p2));
      up.rtsQuiet = true;
      up.die(null);
      // 強襲投放艙：2.5 秒、著地 4 m 內的敵方地面單位 60 爆發＋暈眩
      R.teams[0].tech.res.r_pod = 1;
      bay.bld.rally = { x: bc.pos.x + 6, z: bc.pos.z };
      g.rtsQueue(bay, 'v_mt');
      const n2 = R.pods.length;
      window.__sim(20, () => R.pods.length > n2);
      const p3 = R.pods[R.pods.length - 1];
      o.resDelay = p3.t - p3.t0;
      const foe = g.rtsSpawn(1, 'c_mt', p3.x + 1.5, p3.z);
      foe.updateAI = () => {};
      foe.rtsHurtBy = () => {};
      const hp0 = foe.hp;
      window.__sim(4, () => !R.pods.includes(p3));
      o.podDmg = hp0 - foe.hp;
      o.podStun = foe.staggerT > 0;
      foe.rtsQuiet = true;
      foe.die(null);
      delete R.teams[0].tech.res.r_pod;
      window.__sim(0.1);
      return o;
    });
    check(
      pod.via === 'beacon' && pod.podVia === 'beacon' && pod.podD < 6,
      `集結點在信標內：投放艙落在集結點（${pod.podD.toFixed(1)} m）`,
    );
    check(
      Math.abs(pod.delay - 4) < 0.01 && Math.abs(pod.tL - 4) < 0.6,
      `投放艙 4 秒落地（${pod.tL.toFixed(2)}）`,
    );
    check(pod.popWhile === pod.popAfter, `落下中人口照算（${pod.popWhile} → ${pod.popAfter}）`);
    check(pod.landed && pod.stun, '著地：單位在落點生成、展開 0.5 秒不能動');
    check(
      pod.seen0 === 0 && pod.seen1 === 1,
      `對手看得到那一格才看得到預警圈（${pod.seen0} → ${pod.seen1}）`,
    );
    check(pod.bldVia === 'bld' && pod.bldD < 16, `集結點在信標外：建築正面（${pod.bldD.toFixed(1)} m）`);
    check(
      pod.tmpVia === 'beacon' && pod.tmpExp === 'bld',
      `臨時信標：期間內投放到集結點、到期後退回建築正面（${pod.tmpVia}→${pod.tmpExp}，${pod.tmpN} 個）`,
    );
    check(
      pod.orbit === 'orbit' && Math.abs(pod.orbitDelay - 6) < 0.01,
      `軌道投放：任何探索過的地方、${pod.orbitDelay} 秒`,
    );
    check(
      Math.abs(pod.resDelay - 2.5) < 0.01 && pod.podDmg > 20 && pod.podStun,
      `強襲投放艙：${pod.resDelay} 秒、著地傷害 ${pod.podDmg.toFixed(0)}＋暈眩`,
    );

    // 截圖：投放艙落下中
    await ev(() => {
      const g = window.__game,
        R = g.rts,
        bay = window.__bay;
      g.rtsQueue(bay, 'v_mt');
      const n = R.pods.length;
      window.__sim(20, () => R.pods.length > n);
      const p = R.pods[R.pods.length - 1];
      if (g.rtsCamJump) g.rtsCamJump(p.x, p.z);
      window.__pump(0.5, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4a-pod.png') });

    const bcn = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq,
        bay = window.__bay,
        bc = window.__bc;
      const o = {};
      window.__sim(6);
      // 上限 6 座
      const made = [];
      for (let i = window.__of(0, 'v_beacon').length; i < 6; i++)
        made.push(window.__bld(0, 'v_beacon', hq.pos.x - 20 + i * 5, hq.pos.z - 26, 0));
      o.n = window.__of(0, 'v_beacon').length;
      const s = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 20, 40);
      o.max = g.rtsDropWhy(0, 'v_beacon', s.x, s.z);
      for (const b of made) if (b) ((b.rtsQuiet = true), b.die(null));
      // 被拆：退回建築正面
      bay.bld.rally = { x: bc.pos.x + 6, z: bc.pos.z };
      o.before = g.rtsDropPoint(bay).via;
      bc.die(null);
      window.__sim(0.2);
      o.after = g.rtsDropPoint(bay).via;
      return o;
    });
    check(bcn.n === 6 && bcn.max === '投放信標最多 6 座', `信標上限：「${bcn.max}」`);
    check(bcn.before === 'beacon' && bcn.after === 'bld', '信標被拆：以它為集結點的投放退回建築正面');

    // ---------- 機動建築 ----------
    const pk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        w = g.world,
        hq = window.__hq,
        bay = window.__bay,
        dp = window.__dep0;
      const o = {};
      const nb = window.__bld(0, 'v_beacon', hq.pos.x + 24, hq.pos.z + 24, 0);
      o.whyBld = g.rtsPackWhy(nb);
      nb.rtsQuiet = true;
      nb.die(null);
      o.why = g.rtsPackWhy(dp);
      g.rtsRecount();
      const cap0 = R.teams[0].cap;
      const x0 = dp.pos.x,
        z0 = dp.pos.z;
      const ob0 = w.obstacles.includes(dp.rtsOb);
      const nav0 = w.nav.buildable(x0, z0, 6, 6);
      o.packed = g.rtsOrder([dp], { k: 'pack' });
      window.__sim(3.2);
      o.state = dp.bld.packed;
      o.ob = !dp.rtsOb && !w.obstacles.some((q) => q.rtsBld === dp);
      o.nav = !nav0 && w.nav.buildable(x0, z0, 6, 6) && ob0;
      o.low = g.rtsLowAir(dp) && dp.flying;
      g.rtsRecount();
      o.cap = R.teams[0].cap === cap0;
      o.sight = dp.rtsVision / window.__D('v_depot').sight;
      // 生產暫停：調度所收起
      g.rtsQueue(bay, 'v_mt');
      window.__sim(2);
      const q = bay.bld.queue[0];
      g.rtsPack(bay);
      const qt = q.t;
      window.__sim(4);
      o.frozen = Math.abs(q.t - qt) < 1e-6;
      // 移動：右鍵地面
      const to = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 20, 40);
      g.rtsSmart([dp], to.x, to.z, null);
      const tm = window.__sim(20, () => Math.hypot(dp.pos.x - to.x, dp.pos.z - to.z) < 0.5);
      o.moveT = tm;
      o.moveD = Math.hypot(to.x - x0, to.z - z0);
      o.alt = dp.pos.y - w.terrainHeight(dp.pos.x, dp.pos.z);
      // 展開：在那裡放一台單位（落地時推開）
      const u = g.rtsSpawn(0, 'v_mt', to.x, to.z);
      u.updateAI = () => {};
      o.unpack = g.rtsUnpack(dp, to.x, to.z, 0);
      window.__sim(0.2);
      o.state3 = dp.bld.packed;
      o.ob3 = !!dp.rtsOb && w.obstacles.includes(dp.rtsOb) && !w.nav.buildable(dp.pos.x, dp.pos.z, 6, 6);
      o.pushed = Math.abs(u.pos.x - dp.pos.x) > 3.5 || Math.abs(u.pos.z - dp.pos.z) > 3.5;
      o.pushTxt = `${(u.pos.x - dp.pos.x).toFixed(1)},${(u.pos.z - dp.pos.z).toFixed(1)}`;
      const k3 = g.rtsDmgK('kin', dp);
      window.__sim(5);
      o.state0 = dp.bld.packed;
      o.k3 = k3 / g.rtsDmgK('kin', dp);
      o.again = g.rtsPackWhy(dp);
      window.__sim(20.5);
      o.again2 = g.rtsPackWhy(dp);
      u.rtsQuiet = true;
      u.die(null);
      window.__bay = bay;
      window.__shot = { x: bay.pos.x, z: bay.pos.z };
      return o;
    });
    check(pk.why === '' && pk.whyBld === '這座建築不能收起', `收起的條件：補給艙可以、信標「${pk.whyBld}」`);
    check(pk.packed === 1 && pk.state === 2 && pk.ob && pk.nav, '收起 3 秒：收好、從碰撞與導航格拿掉');
    check(
      pk.low && pk.cap && Math.abs(pk.sight - 0.6) < 0.01,
      `收好是低空、人口照給、視野 ×${pk.sight.toFixed(2)}`,
    );
    check(pk.frozen, '收起的調度所：生產暫停');
    check(
      pk.moveT > 0 && pk.moveT < (pk.moveD / 8) * 1.3 + 1 && pk.alt > 3,
      `右鍵移動：${pk.moveD.toFixed(0)} m 飛 ${pk.moveT.toFixed(1)} 秒（8 m/s）、高 ${pk.alt.toFixed(1)} m`,
    );
    check(
      pk.unpack && pk.state3 === 3 && pk.ob3 && pk.pushed,
      `展開：落地時登記碰撞與導航格、推開單位（${pk.unpack}／${pk.state3}／${pk.ob3}／${pk.pushTxt}）`,
    );
    check(Math.abs(pk.k3 - 1.25) < 0.01, `展開中受到的傷害 ×${pk.k3.toFixed(2)}`);
    check(
      pk.state0 === 0 && /才能再收起/.test(pk.again) && pk.again2 === '',
      `展開完成；「${pk.again}」、20 秒後可以`,
    );

    // 截圖：收起的調度所在飛
    await ev(() => {
      const g = window.__game,
        bay = window.__bay,
        hq = window.__hq;
      window.__sim(4);
      const to = window.__dspot(0, 'v_bay', hq.pos.x, hq.pos.z, 30, 50);
      if (to) g.rtsSmart([bay], to.x, to.z, null);
      window.__sim(2);
      if (g.rtsCamJump) g.rtsCamJump(bay.pos.x, bay.pos.z);
      window.__pump(0.4, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4a-pack.png') });

    // ---------- 集貨站、交易、緊急補給 ----------
    const hl = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const yard = window.__bld(0, 'v_yard', hq.pos.x, hq.pos.z - 30, 0);
      // 工人交到集貨站：進庫存
      const wk = window.__of(0, 'v_worker')[0];
      g.rtsSetOrders(wk, []);
      wk.pos.set(yard.pos.x + 7, wk.pos.y, yard.pos.z);
      R.hash.update(wk, wk.pos.x, wk.pos.z);
      wk.carry = { kind: 'ore', n: 10 };
      wk.orders = [{ k: 'gather', mine: R.mines[0].id }];
      wk.rt.gp = 'back';
      window.__dep[0].length = 0;
      window.__sim(2.5, () => (yard.bld.stock || 0) > 0);
      o.stock = yard.bld.stock;
      o.dep0 = window.__dep[0].length;
      g.rtsSetOrders(wk, []);
      g.rtsHaulDeposit(yard, { kind: 'ore', n: 20 });
      o.stock2 = yard.bld.stock;
      yard.bld.haulT = 0;
      window.__dep[0].length = 0;
      window.__sim(14.5);
      o.early = window.__dep[0].length;
      window.__sim(4);
      o.dep = window.__dep[0].slice();
      o.left = yard.bld.stock;
      // 上限 300、研究物流最佳化 500／8 秒
      g.rtsHaulDeposit(yard, { kind: 'ore', n: 1000 });
      o.cap = yard.bld.stock;
      R.teams[0].tech.res.r_haul = 1;
      g.rtsHaulDeposit(yard, { kind: 'ore', n: 1000 });
      o.cap2 = yard.bld.stock;
      o.next = g.rtsHaulInfo(yard).next;
      delete R.teams[0].tech.res.r_haul;
      // 被拆：庫存損失
      window.__dep[0].length = 0;
      yard.die(null);
      window.__sim(20);
      o.lostDep = window.__dep[0].length;
      // 交易
      const T = R.teams[0];
      T.ore = 1000;
      T.coral = 100;
      o.buy = g.rtsTrade(0, 'buy');
      o.after = [T.ore, T.coral];
      o.cd = g.rtsTradeWhy(0, 'buy');
      window.__sim(15.1);
      g.rtsChangeDef(hq, 'v_hq2');
      g.rtsRecount();
      g.rtsTrade(0, 'buy');
      o.after2 = [T.ore, T.coral];
      window.__sim(15.1);
      window.__dep[0].length = 0;
      o.sell = g.rtsTrade(0, 'sell');
      o.after3 = [Math.round(T.ore), T.coral];
      o.sellDep = window.__dep[0].slice();
      g.rtsChangeDef(hq, 'v_hq');
      g.rtsRecount();
      o.trades = R.stats[0].trades;
      // 緊急補給：受傷的單位與建築
      T.coral = 500;
      const u = g.rtsSpawn(0, 'v_mt', hq.pos.x + 14, hq.pos.z + 14);
      u.updateAI = () => {};
      u.hp = 100;
      hq.hp = hq.maxHp * 0.5;
      o.far = g.rtsVeerSupplyWhy(hq, hq.pos.x + 150, hq.pos.z);
      o.sup = g.rtsOrder([hq], { k: 'ability', ab: 'ab_supply', x: u.pos.x, z: u.pos.z });
      o.supCoral = 500 - T.coral;
      o.sup2 = g.rtsVeerSupplyWhy(hq, u.pos.x, u.pos.z);
      window.__sim(1.5);
      o.hp1 = u.hp;
      window.__sim(1);
      o.hqHp = hq.hp / hq.maxHp;
      window.__sim(4);
      o.hp2 = u.hp;
      u.rtsQuiet = true;
      u.die(null);
      return o;
    });
    check(hl.stock === 10 && hl.dep0 === 0, `物流 MT 交到集貨站：進庫存 ${hl.stock}、沒有立刻入帳`);
    check(
      hl.early === 0 && hl.dep.length === 1 && hl.dep[0] === 30 && hl.left === 0,
      `每 15 秒運走（3 秒後經過 rtsDeposit 入帳 ${hl.dep.join()}，套維持費）`,
    );
    check(
      hl.cap === 300 && hl.cap2 === 500 && hl.next <= 8,
      `庫存上限 300、研究物流最佳化 500／8 秒（倒數 ${hl.next.toFixed(1)}）`,
    );
    check(hl.lostDep === 0, '集貨站被拆：庫存損失（沒有入帳）');
    check(
      hl.buy && hl.after.join() === '900,130' && /冷卻/.test(hl.cd),
      `交易：買 Coral 100 → 30、冷卻「${hl.cd}」`,
    );
    check(hl.after2.join() === '800,165', `T2 起 100 → 35（${hl.after2.join()}）`);
    check(
      hl.sell && hl.after3[1] === 135 && hl.sellDep.join() === '60' && hl.trades === 3,
      `賣 Coral：30 → 60 礦石（經過 rtsDeposit：${hl.sellDep.join()}）`,
    );
    check(
      hl.sup === 1 &&
        hl.supCoral === 50 &&
        /冷卻/.test(hl.sup2) &&
        hl.hp1 === 100 &&
        hl.hp2 > 250 &&
        hl.hqHp > 0.64,
      `緊急補給：Coral 50、2 秒後落地、單位回復（100 → ${Math.round(hl.hp2)}）、建築 +15%（${(hl.hqHp * 100).toFixed(0)}%）`,
    );
    check(/60 m|探索/.test(hl.far), `緊急補給的距離限制：「${hl.far}」`);

    // ---------- 載運 ----------
    const ld = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const cx = hq.pos.x + 20,
        cz = hq.pos.z + 20;
      const ship = g.rtsSpawn(0, 'v_dropship', cx, cz);
      const mts = [0, 1, 2, 3].map((i) => g.rtsSpawn(0, 'v_mt', cx + 8 + i * 3, cz - 4));
      const extra = g.rtsSpawn(0, 'v_mt', cx - 8, cz - 4);
      g.rtsSmart(mts, ship.pos.x, ship.pos.z, ship);
      o.t = window.__sim(20, () => mts.every((e) => e.rtsAboard));
      o.cargo = ship.cargo.length;
      o.pop = g.rtsCargoUsed(ship);
      o.hidden = mts.every((e) => !e.mesh.parent && !R.hostile[1].includes(e));
      o.full = g.rtsBoardWhy(extra, ship);
      o.heroPop = g.rtsCargoPop({ hero: {}, rtsDef: 'h_courier' });
      o.wkPop = g.rtsCargoPop(window.__of(0, 'v_worker')[0]);
      g.rtsRecount();
      o.popKept = R.teams[0].pop;
      // 卸載：地點
      const to = window.__dspot(0, 'v_depot', hq.pos.x, hq.pos.z, 30, 44);
      g.rtsOrder([ship], { k: 'unload', x: to.x, z: to.z });
      o.tu = window.__sim(30, () => !ship.cargo.length);
      o.near = mts.every(
        (e) => !e.rtsAboard && Math.hypot(e.pos.x - to.x, e.pos.z - to.z) < 10 && e.mesh.parent,
      );
      o.low = ship.rtsLow;
      // 墜毀：乘員 50%
      for (const e of mts.slice(0, 2)) g.rtsBoard(e, ship);
      o.re = ship.cargo.length;
      g.rtsHit(ship, 1e6, 0, null, 'none');
      window.__sim(0.1);
      o.crash = mts.slice(0, 2).map((e) => (e.dead ? -1 : Math.round((e.hp / e.maxHp) * 100)));
      o.out = mts.slice(0, 2).every((e) => !e.rtsAboard && e.mesh.parent);
      for (const e of [...mts, extra]) if (!e.dead) ((e.rtsQuiet = true), e.die(null));
      window.__sim(0.1);
      return o;
    });
    check(
      ld.t > 0 && ld.cargo === 4 && ld.pop === 8 && ld.hidden,
      `載運：4 台空降 MT 走過去登機（8 人口、${ld.t.toFixed(1)} 秒），從場景與敵對名單拿掉（${ld.cargo}／${ld.pop}／${ld.hidden}）`,
    );
    check(
      /滿了/.test(ld.full) && ld.heroPop === 5 && ld.wkPop === 1,
      `第 5 台：「${ld.full}」；英雄 5、工人 1`,
    );
    check(ld.tu > 0 && ld.near && !ld.low, `卸載：飛過去、下降、放下（${ld.tu.toFixed(1)} 秒）`);
    check(
      ld.re === 2 && ld.crash.join() === '50,50' && ld.out,
      `運輸機被擊落：乘員彈出、各 50%（${ld.crash.join()}）`,
    );

    // ---------- visAir：斷崖下的地面單位看得到台上的空中單位、看不到台上的地面單位 ----------
    const va = await ev(() => {
      const g = window.__game,
        R = g.rts,
        F = R.fog,
        w = g.world;
      const o = {};
      // 找斷崖：一格比 3 格（12 m）外的另一格高 6 m 以上，兩邊都在地圖中間、離雙方主堡遠
      const { W, hc, S, cell } = F;
      const h0 = window.__hq.pos,
        h1 = window.__hq1.pos;
      let pick = null;
      for (let gz = 10; gz < W - 10 && !pick; gz += 2)
        for (let gx = 10; gx < W - 10 && !pick; gx += 2) {
          const i = gz * W + gx;
          const x = -S + (gx + 0.5) * cell,
            z = -S + (gz + 0.5) * cell;
          if (Math.hypot(x - h0.x, z - h0.z) < 90 || Math.hypot(x - h1.x, z - h1.z) < 90) continue;
          for (const [dx, dz] of [
            [3, 0],
            [-3, 0],
            [0, 3],
            [0, -3],
          ]) {
            const j = (gz + dz) * W + gx + dx;
            if (hc[i] - hc[j] > 6 && w.nav.walkableAt(x, z, 1)) {
              const lx = x + dx * cell,
                lz = z + dz * cell;
              if (w.nav.walkableAt(lx, lz, 1)) pick = { hx: x, hz: z, lx, lz, dh: hc[i] - hc[j] };
              break;
            }
          }
        }
      o.found = !!pick;
      if (!pick) return o;
      o.dh = pick.dh;
      const obs = g.rtsSpawn(0, 'v_mt', pick.lx, pick.lz);
      const gr = g.rtsSpawn(1, 'c_mt', pick.hx, pick.hz);
      const air = g.rtsSpawn(1, 'c_heli', pick.hx, pick.hz);
      for (const e of [obs, gr, air]) e.updateAI = () => {};
      g.rtsFogTick(0.25);
      o.air = g.rtsVisible(0, air);
      o.ground = g.rtsVisible(0, gr);
      // 卡斯特隆看維爾威：反過來也一樣（台上的觀察者看得到斷崖下的單位）
      for (const e of [obs, gr, air]) ((e.rtsQuiet = true), e.die(null));
      window.__sim(0.1);
      return o;
    });
    check(
      va.found && va.air && !va.ground,
      `visAir：斷崖下（高差 ${va.dh && va.dh.toFixed(1)} m）看得到台上的空中單位、看不到台上的地面單位`,
    );

    // ---------- 只剩收起的建築 90 秒後揭露 ----------
    const rv = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      for (const e of R.units.slice())
        if (!e.dead && e.bld && e.rtsTeam === 0 && !window.__D(e.rtsDef).pack)
          ((e.rtsQuiet = true), e.die(null));
      window.__sim(0.1);
      const bl = R.units.filter((e) => !e.dead && e.bld && e.rtsTeam === 0);
      for (const b of bl) if (!b.bld.packed) g.rtsPack(b);
      window.__sim(10);
      o.all = bl.every((b) => b.bld.packed === 2);
      o.n = bl.length;
      o.r0 = R.fog.reveals.filter((r) => r.team === 1).length;
      window.__sim(75);
      o.r1 = R.fog.reveals.filter((r) => r.team === 1).length;
      window.__sim(10);
      o.r2 = R.fog.reveals.filter((r) => r.team === 1).length;
      o.carriers = window.__of(0, 'v_carrier').length + R.drops.length;
      o.alive = R.teams[0].alive;
      o.over = !!R.over;
      return o;
    });
    check(rv.all && rv.alive && !rv.over, `全部收起（${rv.n} 座）照算還有建築`);
    check(rv.carriers === 0, `空投運輸機都回到起飛點並移除（剩 ${rv.carriers}）`);
    check(
      rv.r0 === 0 && rv.r1 === 0 && rv.r2 >= 1,
      `只剩收起的建築 90 秒後對其他隊伍揭露（${rv.r1} → ${rv.r2}）`,
    );

    // ---------- 隨機、卡斯特隆與艾瑟立克不變、選單 ----------
    const rnd = await ev(() => {
      const g = window.__game;
      const o = { seen: {} };
      for (const s of [3, 5, 8, 11, 13, 21, 34, 55, 89]) {
        g.rtsStart({ theme: 'wasteland', seed: s, size: 400, faction: 'random', aiFaction: 'random' });
        for (const T of g.rts.teams.slice(0, 2)) o.seen[T.faction] = 1;
      }
      g.rtsStart({ theme: 'wasteland', seed: 7, size: 400, faction: 'castron', aiFaction: 'aetheric' });
      const R = g.rts;
      const c = (t, d) => R.units.filter((e) => e.rtsTeam === t && e.rtsDef === d).length;
      o.ca = [c(0, 'c_hq'), c(0, 'c_worker'), c(1, 'a_hq'), c(1, 'a_worker')].join();
      o.lift = g.rtsDropLift(0).max + '/' + g.rtsVeerTeam(0);
      o.cdrop = g.rtsOrder(
        R.units.filter((e) => e.rtsTeam === 0 && e.rtsDef === 'c_worker'),
        { k: 'build', def: 'c_depot', x: 0, z: 0 },
      );
      o.cbuild = R.units.some((e) => e.rtsDef === 'c_worker' && e.orders[0] && e.orders[0].k === 'build');
      o.drops = R.drops.length;
      // 電腦是維爾威（F 包之前沿用卡斯特隆的角色表）：對不動的玩家跑 60 秒不出錯
      g.rtsAiOff = false;
      g.rtsStart({ theme: 'wasteland', seed: 7, size: 400, faction: 'castron', aiFaction: 'veerwell' });
      try {
        window.__sim(60);
      } catch (e) {
        o.aiErr = String(e && e.message);
      }
      o.aiFac = g.rts.teams[1].faction;
      g.rtsAiOff = true;
      g.rtsMenuOpen();
      const el = document.getElementById('rtsMenu');
      const btn = el.querySelector('[data-pf="veerwell"]');
      o.btn = !!btn && !btn.disabled;
      btn.click();
      o.traits = (document.querySelector('#rtsMenu .rtsFacTraits') || {}).textContent || '';
      return o;
    });
    check(
      rnd.seen.veerwell && rnd.seen.castron && rnd.seen.aetheric,
      `「隨機」三個陣營都會抽到（${Object.keys(rnd.seen).join()}）`,
    );
    check(
      rnd.ca === '1,5,1,5' && rnd.cbuild && rnd.drops === 0 && rnd.lift === '2/false',
      `卡斯特隆與艾瑟立克的開局不變、卡斯特隆的工人照舊建造（${rnd.ca}）`,
    );
    check(
      rnd.aiFac === 'veerwell' && !rnd.aiErr,
      `電腦是維爾威時跑 60 秒不出錯（${rnd.aiErr || rnd.aiFac}）`,
    );
    check(rnd.btn && /空投/.test(rnd.traits), `選單：維爾威可以選、說明（${rnd.traits.slice(0, 16)}…）`);
    await ctx.close();
  }

  return { testRtsVeer };
};
