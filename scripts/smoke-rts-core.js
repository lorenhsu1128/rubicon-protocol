// Coral 戰爭（RTS）R2 A 包（核心與資料）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-core')(H)。
// testRtsTech：主堡升級、研究、相剋表與護甲、需求檢查、中立隊伍與敵對判定、維持費、民兵、自動管家的建築位置。
// 電腦對手不動（g.rtsAiOff），主迴圈停住，只以 rtsSim 快轉（不等實際時間）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsTech(browser, base) {
    console.log('Coral 戰爭：科技層級、研究、相剋表、中立隊伍（R2 核心）');
    const { ctx, page } = await newPage(browser, 'rtsTech');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    // 開局（電腦不動）＋共用的工具
    const st = await ev(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      // 己方蓋好的建築（直接放、不經過工人）：自動管家的位置
      window.__put = (team, def) => {
        const p = g.rtsAutoSpot(team, def);
        return p ? g.rtsSpawnBld(team, def, p.x, p.z, 0, 1) : null;
      };
      R.teams[0].ore = R.teams[1].ore = 20000;
      R.teams[0].coral = R.teams[1].coral = 20000;
      const hq = window.__of(0, 'c_hq')[0];
      window.__hq = hq;
      return {
        teams: R.teams.length,
        neutral: !!R.teams[2].neutral && R.teams[2].team === 'neutral',
        tier: g.rtsTier(0),
        tech: JSON.stringify(R.teams[0].tech),
        hostile: R.hostile.map((h) => h.length),
        units: R.units.length,
        hqArm: [hq.rtsArm, hq.rtsArmor, hq.maxHp],
      };
    });
    check(
      st.teams === 3 && st.neutral && st.tier === 1 && /"tier":1/.test(st.tech),
      `開局：隊伍 ${st.teams}（第 3 隊中立）、層級 T${st.tier}、科技 ${st.tech}`,
    );
    check(
      st.hostile[0] + st.hostile[1] + st.hostile[2] === 2 * st.units, // 每個實體在另外兩隊的名單裡（含 D 包的野怪與中立建築）
      `敵對名單：隊伍 0 ${st.hostile[0]}、隊伍 1 ${st.hostile[1]}、中立 ${st.hostile[2]}（全部 ${st.units}）`,
    );
    check(st.hqArm.join() === 'fort,5,4200', `主堡：城甲 ${st.hqArm.join('／')}`);

    // ---------- 需求與主堡升級 T2 ----------
    const t2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      o.whyArty = g.rtsReqWhy(0, { req: { tier: 3 } });
      o.noFac = g.rtsUpgrade(hq, 'c_hq2');
      o.whyHq2 = g.rtsReqWhy(0, window.__hq && { req: { blds: ['c_factory'] } });
      const fac = window.__put(0, 'c_factory');
      o.fac = !!fac;
      o.qMortar = g.rtsQueue(fac, 'c_mortar'); // 迫擊砲 MT 要 T2
      o.whyMortar = g.rtsReqWhy(0, { req: { tier: 2 } });
      const ore0 = R.teams[0].ore;
      o.up = g.rtsUpgrade(hq, 'c_hq2');
      o.paid = ore0 - R.teams[0].ore;
      o.qWorker = g.rtsQueue(hq, 'c_worker'); // 升級中不能生產工人
      o.up2 = g.rtsUpgrade(hq, 'c_hq2'); // 重複升級
      hq.hp = hq.maxHp * 0.5;
      o.cap0 = R.teams[0].cap;
      o.t = window.__sim(70, () => hq.rtsDef === 'c_hq2');
      window.__sim(0.2);
      o.def = hq.rtsDef;
      o.hpK = hq.hp / hq.maxHp;
      o.max = hq.maxHp;
      o.cap = R.teams[0].cap;
      o.tier = g.rtsTier(0);
      o.armor = hq.rtsArmor;
      o.qMortar2 = g.rtsQueue(fac, 'c_mortar');
      o.qWorker2 = g.rtsQueue(hq, 'c_worker');
      o.log = (R.teams[0].tech.log || []).map((l) => l.id).join();
      return o;
    });
    check(/T3/.test(t2.whyArty), `T1 時 T3 的需求不足（${t2.whyArty}）`);
    check(!t2.noFac && /兵工廠/.test(t2.whyHq2), `沒有兵工廠不能升級（${t2.whyHq2}）`);
    check(t2.fac && !t2.qMortar && /T2/.test(t2.whyMortar), `迫擊砲 MT 要 T2（${t2.whyMortar}）`);
    check(
      t2.up && t2.paid === 300 && !t2.qWorker && !t2.up2,
      `升級要塞主堡：扣礦石 ${t2.paid}、升級中不能生產工人、不能重複升級`,
    );
    check(
      t2.t >= 55 && t2.t <= 62 && t2.def === 'c_hq2' && t2.tier === 2 && t2.armor === 6,
      `T2 完成（${t2.t.toFixed(1)} 秒）：${t2.def}、層級 T${t2.tier}、護甲 ${t2.armor}、事件 ${t2.log}`,
    );
    check(
      Math.abs(t2.hpK - 0.5) < 0.02 && t2.max === 5200,
      `升級後血量依比例（${(t2.hpK * 100).toFixed(1)}%，上限 ${t2.max}）`,
    );
    check(t2.cap === t2.cap0 + 2, `人口上限 ${t2.cap0} → ${t2.cap}（主堡 10 → 12）`);
    check(t2.qMortar2 && t2.qWorker2, 'T2 之後可以生產迫擊砲 MT、工人');

    // ---------- T3 ----------
    const t3 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      for (const b of R.units) if (b.bld && b.rtsTeam === 0) b.bld.queue.length = 0;
      o.why = g.rtsReqWhy(0, g.rtsUiDef ? g.rtsUiDef('c_hq3') : { req: { blds: ['c_heavy', 'c_works'] } });
      const heavy = window.__put(0, 'c_heavy');
      window.__heavy = heavy;
      o.qTank = g.rtsQueue(heavy, 'c_tank');
      o.qArty = g.rtsQueue(heavy, 'c_arty'); // T3 單位
      heavy.bld.queue.length = 0;
      const works = window.__put(0, 'c_works');
      window.__works = works;
      o.up = g.rtsUpgrade(hq, 'c_hq3');
      o.cap0 = R.teams[0].cap;
      o.t = window.__sim(90, () => hq.rtsDef === 'c_hq3');
      window.__sim(0.2);
      o.def = hq.rtsDef;
      o.tier = g.rtsTier(0);
      o.cap = R.teams[0].cap;
      o.qArty = [o.qArty, g.rtsQueue(heavy, 'c_arty')];
      heavy.bld.queue.length = 0;
      return o;
    });
    check(/重工廠|工程研究所/.test(t3.why), `重工司令部的需求（${t3.why}）`);
    check(t3.qTank && !t3.qArty[0], 'T2：裝甲車可以生產、自走砲（T3）被需求擋下');
    check(
      t3.up && t3.t > 0 && t3.def === 'c_hq3' && t3.tier === 3 && t3.cap === t3.cap0 + 3,
      `T3 完成（${t3.t.toFixed(1)} 秒）：層級 T${t3.tier}、人口上限 ${t3.cap0} → ${t3.cap}`,
    );
    check(t3.qArty[1], 'T3 之後可以生產自走砲');

    // ---------- 研究 ----------
    const rs = await ev(() => {
      const g = window.__game,
        R = g.rts,
        works = window.__works;
      const o = {};
      const old = g.rtsSpawn(0, 'c_mt', works.pos.x + 14, works.pos.z, 0);
      const k0 = old.dmgMul * old.rtsSlotK.rarm;
      o.arm0 = old.rtsArmor;
      const works2 = window.__put(0, 'c_works');
      o.r1 = g.rtsResearch(works, 'r_kin');
      o.r1b = g.rtsResearch(works2, 'r_kin'); // 同一項不能兩棟同時研究
      o.busy = !!R.teams[0].tech.busy.r_kin;
      o.r2 = g.rtsResearch(works2, 'r_arm');
      o.t = window.__sim(80, () => !R.teams[0].tech.busy.r_kin);
      o.lv1 = g.rtsResLv(0, 'r_kin');
      o.k1 = (old.dmgMul * old.rtsSlotK.rarm) / k0;
      // 2、3 級
      for (let i = 0; i < 2; i++) {
        g.rtsResearch(works, 'r_kin');
        window.__sim(80, () => !R.teams[0].tech.busy.r_kin);
      }
      window.__sim(30, () => !R.teams[0].tech.busy.r_arm);
      o.lv3 = g.rtsResLv(0, 'r_kin');
      o.r4 = g.rtsResearch(works, 'r_kin'); // 已完成
      o.info = g.rtsResearchInfo(0, 'r_kin', works).why;
      o.k3 = (old.dmgMul * old.rtsSlotK.rarm) / k0;
      const nu = g.rtsSpawn(0, 'c_mt', works.pos.x + 16, works.pos.z, 0);
      o.kNew = (nu.dmgMul * nu.rtsSlotK.rarm) / k0;
      o.arm = [old.rtsArmor, nu.rtsArmor];
      o.hqArmor = window.__hq.rtsArmor; // 複合裝甲不含建築
      // 要塞化：建築護甲 +3、血量 +20%
      const dep = window.__put(0, 'c_depot');
      const m0 = dep.maxHp;
      g.rtsResearch(works, 'r_fort');
      window.__sim(60, () => !R.teams[0].tech.busy.r_fort);
      o.fort = [dep.rtsArmor, dep.maxHp / m0, g.rtsBldRange(window.__hq)];
      // 研究中被拆：取消（busy 清掉）
      g.rtsResearch(works2, 'r_exp');
      o.busyExp = !!R.teams[0].tech.busy.r_exp;
      works2.die(null);
      window.__sim(0.5);
      o.busyExp2 = !!R.teams[0].tech.busy.r_exp;
      old.rtsQuiet = nu.rtsQuiet = true;
      old.die(null);
      nu.die(null);
      window.__sim(0.2);
      return o;
    });
    check(rs.r1 && !rs.r1b && rs.busy && rs.r2, '研究：同一項不能兩棟同時研究、不同項可以');
    check(
      rs.lv1 === 1 && Math.abs(rs.k1 - 1.1) < 0.001 && rs.t > 35 && rs.t < 45,
      `實彈武器 1 級（${rs.t.toFixed(1)} 秒）：既有 MT 的傷害 ×${rs.k1.toFixed(2)}`,
    );
    check(
      rs.lv3 === 3 &&
        !rs.r4 &&
        rs.info === '已完成' &&
        Math.abs(rs.k3 - 1.3) < 0.001 &&
        Math.abs(rs.kNew - 1.3) < 0.001,
      `實彈武器 3 級：既有 ×${rs.k3.toFixed(2)}、新生產 ×${rs.kNew.toFixed(2)}，第 4 次「${rs.info}」`,
    );
    check(
      rs.arm0 === 1 && rs.arm.join() === '3,3' && rs.hqArmor === 7,
      `複合裝甲 1 級：MT 護甲 ${rs.arm0} → ${rs.arm.join('／')}（主堡不變 ${rs.hqArmor}）`,
    );
    check(
      rs.fort[0] === 6 && Math.abs(rs.fort[1] - 1.2) < 0.001 && rs.fort[2] === 30,
      `要塞化：補給庫護甲 ${rs.fort[0]}、血量 ×${rs.fort[1].toFixed(2)}、主堡射程 ${rs.fort[2]}`,
    );
    check(rs.busyExp && !rs.busyExp2, '研究中的建築被拆：研究取消');

    // ---------- 相剋表與護甲 ----------
    const ty = await ev(() => {
      const g = window.__game,
        nav = g.world.nav;
      const spot = (x, z) => nav.center(nav.nearestCell(x, z, 1, -1, 20));
      const mk = (arm, armor, i) => {
        const p = spot(-60 + i * 8, 40);
        const e = g.rtsSpawn(1, 'c_mt', p.x, p.z, 0);
        e.rtsArm = arm;
        e.rtsArmor = armor;
        e.maxHp = e.hp = 1e6;
        return e;
      };
      const arms = ['none', 'light', 'med', 'heavy', 'fort', 'hero'];
      const T = arms.map((a, i) => mk(a, 0, i));
      const out = {};
      for (const atk of ['kin', 'pierce', 'exp', 'en'])
        out[atk] = T.map((t) => Math.round(g.rtsHit(t, 100, 0, null, atk)));
      const a5 = mk('med', 5, 7);
      out.armor5 = g.rtsHit(a5, 100, 0, null, 'hero');
      // 一般的命中（投射物的 takeDamage）：來源定義的攻擊類型（MT＝實彈）
      const src = g.rtsSpawn(0, 'c_mt', spot(-60, 60).x, spot(-60, 60).z, 0);
      const t = mk('med', 1, 8);
      const h0 = t.hp;
      t.takeDamage(100, 0, src, t.center(), null);
      out.proj = h0 - t.hp;
      // 裝甲車的加特林（slotAtk：實彈）與火箭筒（穿甲）
      const tank = g.rtsSpawn(0, 'c_tank', spot(-40, 60).x, spot(-40, 60).z, 0);
      const t2 = mk('heavy', 0, 9);
      const h1 = t2.hp;
      t2.takeDamage(100, 0, tank, t2.center(), null, undefined, tank.weapons.rarm.def.id);
      const h2 = t2.hp;
      t2.takeDamage(100, 0, tank, t2.center(), null, undefined, tank.weapons.rback.def.id);
      out.tank = [h1 - h2, h2 - t2.hp];
      out.slotK = Object.keys(tank.rtsSlotK).sort().join();
      for (const e of [...T, a5, src, t, tank, t2]) {
        e.rtsQuiet = true;
        e.die(null);
      }
      window.__sim(0.2);
      return out;
    });
    const want = {
      kin: [100, 100, 150, 100, 70, 100],
      pierce: [125, 75, 100, 175, 50, 75],
      exp: [125, 125, 75, 75, 150, 50],
      en: [100, 125, 100, 125, 50, 75],
    };
    for (const k in want)
      check(
        ty[k].join() === want[k].join(),
        `相剋表 ${k}：無／輕／中／重／城甲／英雄 ＝ ${ty[k].join('／')}`,
      );
    check(Math.abs(ty.armor5 - 76.9) < 0.2, `護甲 5：100 → ${ty.armor5.toFixed(1)}（−23%）`);
    check(
      Math.abs(ty.proj - 141.5) < 0.6,
      `MT 的子彈打中甲 1：100 → ${ty.proj.toFixed(1)}（實彈 ×1.5 × 護甲 1）`,
    );
    check(
      Math.abs(ty.tank[0] - 175) < 0.3 && Math.abs(ty.tank[1] - 100) < 0.3 && ty.slotK === 'rarm,rback',
      `裝甲車：火箭筒打重甲 ${ty.tank[0].toFixed(0)}（穿甲）、加特林 ${ty.tank[1].toFixed(0)}（實彈），開火槽 ${ty.slotK}`,
    );

    // ---------- 中立隊伍：兩隊的子彈都打得到、不影響勝敗 ----------
    const nt = await ev(() => {
      const g = window.__game,
        R = g.rts,
        nav = g.world.nav;
      const spot = (x, z) => nav.center(nav.nearestCell(x, z, 1, -1, 20));
      const pn = spot(0, -30);
      const neu = g.rtsSpawn(2, 'c_mt', pn.x, pn.z, 0);
      neu.maxHp = neu.hp = 1e5;
      neu.orders = [{ k: 'hold' }];
      const by = new Set();
      const td = neu.takeDamage;
      neu.takeDamage = function (d, i, from, ...r) {
        if (from && from.rtsTeam !== undefined) by.add(from.rtsTeam);
        return td.call(this, d, i, from, ...r);
      };
      const a = spot(pn.x + 16, pn.z),
        b = spot(pn.x - 16, pn.z);
      const u0 = g.rtsSpawn(0, 'c_mt', a.x, a.z, 0),
        u1 = g.rtsSpawn(1, 'c_mt', b.x, b.z, 0);
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, true);
      g.rtsFogRevealAll && g.rtsFogRevealAll(1, true);
      g.rtsFogTick && g.rtsFogTick(0.3);
      g.rtsOrder([u0], { k: 'attack', id: neu.id });
      g.rtsOrder([u1], { k: 'attack', id: neu.id });
      const o = {
        hostile: [g.isHostile(u0, neu), g.isHostile(u1, neu), g.isHostile(neu, u0), g.isHostile(u0, u1)],
        inList: [R.hostile[0].includes(neu), R.hostile[1].includes(neu)],
      };
      window.__sim(12);
      o.by = [...by].sort().join();
      o.inEnemies = g.enemies.includes(neu);
      neu.die(u0);
      window.__sim(1.2);
      o.over = !!R.over;
      o.alive = [R.teams[0].alive, R.teams[1].alive];
      o.pop2 = R.teams[2].pop;
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, false);
      g.rtsFogRevealAll && g.rtsFogRevealAll(1, false);
      for (const e of [u0, u1]) {
        e.rtsQuiet = true;
        e.die(null);
      }
      window.__sim(0.2);
      return o;
    });
    check(
      nt.hostile.join() === 'true,true,true,true' && nt.inList.join() === 'true,true' && nt.inEnemies,
      `中立單位：兩隊都敵對、在兩隊的敵對名單、放在 enemies（${nt.hostile.join()}）`,
    );
    check(nt.by === '0,1', `兩隊的子彈都打中中立單位（來源隊伍 ${nt.by}）`);
    check(!nt.over && nt.alive.join() === 'true,true', '中立單位全滅不影響勝敗');

    // ---------- 維持費、民兵、取消升級、層級退回 ----------
    const misc = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      const pop = T.pop;
      T.pop = 70;
      o.up70 = g.rtsDeposit(0, 'ore', 10);
      T.pop = 110;
      o.up110 = g.rtsDeposit(0, 'ore', 10);
      o.coral110 = g.rtsDeposit(0, 'coral', 10);
      T.pop = pop;
      o.grant = (() => {
        const a = T.ore;
        g.rtsGrant(0, 75, 0);
        return T.ore - a;
      })();
      // 民兵：主堡附近的工人
      const hq = window.__hq;
      const n = g.rtsMilitia(hq);
      const mil = R.units.filter((e) => !e.dead && e.rtsTeam === 0 && e.rtsDef === 'c_militia');
      o.mil = [n, mil.length, mil.length ? mil[0].rtsArm + mil[0].rtsArmor : ''];
      window.__sim(30);
      o.still = R.units.filter((e) => !e.dead && e.rtsTeam === 0 && e.rtsDef === 'c_militia').length;
      window.__sim(16);
      const back = R.units.filter((e) => !e.dead && e.rtsTeam === 0 && e.rtsDef === 'c_worker');
      o.back = [
        R.units.filter((e) => !e.dead && e.rtsTeam === 0 && e.rtsDef === 'c_militia').length,
        back.length,
      ];
      o.gather = back.filter((e) => e.orders[0] && e.orders[0].k === 'gather').length;
      g.rtsMilitia(hq);
      o.demob = g.rtsDemob(hq);
      // 分礦的第二座主堡：升級中被拆＝取消
      const hq2 = window.__put(0, 'c_hq');
      o.hq2 = !!hq2;
      if (hq2) {
        o.up = g.rtsUpgrade(hq2, 'c_hq2');
        window.__sim(10);
        hq2.die(null);
        window.__sim(70);
        o.hq2s = window.__of(0, 'c_hq2').length;
      }
      // 主堡被拆：層級退回（只剩其他建築）
      o.tier0 = g.rtsTier(0);
      hq.die(null);
      window.__sim(1);
      o.tier1 = g.rtsTier(0);
      o.over = !!R.over;
      return o;
    });
    check(
      Math.abs(misc.up70 - 7) < 1e-6 &&
        Math.abs(misc.up110 - 4) < 1e-6 &&
        misc.coral110 === 10 &&
        misc.grant === 75,
      `維持費：人口 70 礦石 ×0.7、110 ×0.4、Coral 不受影響；直接入帳 +${misc.grant}`,
    );
    check(
      misc.mil[0] > 0 && misc.mil[0] === misc.mil[1] && misc.mil[2] === 'med3',
      `動員：${misc.mil[0]} 台作業 MT 變成民兵（中甲 1＋複合裝甲 1 級：${misc.mil[2]}）`,
    );
    check(
      misc.still === misc.mil[0] && misc.back[0] === 0 && misc.gather >= misc.mil[0],
      `民兵 45 秒後變回工人並回去採集（30 秒時 ${misc.still} 台、之後 ${misc.back[0]} 台、採集中 ${misc.gather}）`,
    );
    check(misc.demob > 0, `解除動員（${misc.demob} 台）`);
    check(misc.hq2 && misc.up && misc.hq2s === 0, '升級中的主堡被拆：升級取消');
    check(
      misc.tier0 === 3 && misc.tier1 === 1 && !misc.over,
      `主堡被拆：層級 T${misc.tier0} → T${misc.tier1}（還有其他建築，沒有結束）`,
    );
    await ev(() => window.__pump(0.3, null, 1 / 30));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-tech.png') });
    await ctx.close();
  }

  return { testRtsTech };
};
