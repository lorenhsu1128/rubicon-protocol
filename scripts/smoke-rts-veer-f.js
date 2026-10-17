// Coral 戰爭（RTS）R4 F 包（電腦對手：維爾威，docs/rts-design.md 15.6、15.17）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-veer-f')(H)。
// testRtsVeerAi（短的確定性測試；不跑電腦對電腦的完整對局）：
//   1. 普通的維爾威電腦（三套開局各一局，三個頁面同時跑）對不動的玩家（主堡打不倒）快轉 7 分鐘：
//      建築都是空投（工人沒有建造指令）、6 分鐘內的空投與投放艙、英雄、第一次進攻出發的時間（4～7 分；
//      空降速攻 3:30 起）、物流擴張的集貨站分礦、空降速攻的前線信標與投放艙降在信標、決策 < 1 ms；截圖 rts-r4-ai.png；
//   2. 電腦選「隨機」（依種子抽到維爾威）照常運作（2 分鐘：空投）；
//   3. 跨陣營的優先順序（卡斯特隆電腦）：集火時射程內的空投運輸機優先、進攻目標記得的投放信標優先；對空的權重 airK。
// 主迴圈停住，以 rtsSim 快轉（不等實際時間）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let base0 = '';

  async function open(browser, name) {
    const { ctx, page } = await newPage(browser, name);
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base0 + (base0.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    return { ctx, page, ev: (fn, a) => page.evaluate(fn, a) };
  }
  // 頁面裡的共用工具：__sim 快轉（同時跑迷霧：迷霧決定電腦看得到什麼、能空投到哪裡）
  const SIM = () => {
    const g = window.__game;
    g.rtsPathMs = Infinity;
    window.__sim = (sec, until, dt = 1 / 15) => {
      let t = 0;
      for (; t < sec; t += dt) {
        if (until && until()) return t;
        g.rtsSim(dt);
        g.fx.update(dt);
        g.rtsFogTick(dt);
        if (g.rts.over) break;
      }
      return until && !until() ? -1 : t;
    };
  };

  // 一局：維爾威電腦（開局 op）對不動的玩家，快轉 7 分鐘，回傳里程碑
  async function vsStatic(browser, op, seed, theme) {
    const { ctx, page, ev } = await open(browser, 'rtsVeerAi-' + op);
    await ev(SIM);
    await ev(
      ({ op, seed, theme }) => {
        const g = window.__game;
        window.__reseed(seed * 13 + 5);
        g.rtsStart({
          theme,
          seed,
          size: 400,
          faction: 'castron',
          aiFaction: 'veerwell',
          diff: 'normal',
          aiOpener: op,
        });
        // AI 分批以鏡頭注視點為準：固定在地圖中心
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const R = g.rts;
        const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        hq0.maxHp = hq0.hp = 1e7;
        const A = R.ai.find((a) => a.team === 1);
        const M = (window.__M = { wbuild: 0, podVia: {} });
        const at = (k, ok) => {
          if (M[k] === undefined && ok) M[k] = Math.round(R.t);
        };
        const seenPod = new Set();
        window.__mark = () => {
          const T = R.teams[1];
          at(
            'hero1',
            T.heroes.some((h) => h.ent && !h.ent.dead),
          );
          at('drop1', R.drops.some((d) => d.team === 1) || R.stats[1].drops > 0);
          at('pod1', R.stats[1].pods > 0);
          at('t2', T.tech.tier >= 2);
          for (const p of R.pods)
            if (p.team === 1 && !seenPod.has(p.id)) {
              seenPod.add(p.id);
              M.podVia[p.via] = (M.podVia[p.via] || 0) + 1;
            }
          // 工人有沒有建造的指令（空投陣營不應該有）
          for (const e of R.units)
            if (
              !e.dead &&
              e.rtsTeam === 1 &&
              e.rtsDef === 'v_worker' &&
              e.orders.some((o) => o.k === 'build')
            )
              M.wbuild++;
          // 集貨站的分礦（主基地外、蓋好的）
          at(
            'yard',
            R.units.some(
              (e) =>
                !e.dead &&
                e.rtsTeam === 1 &&
                e.rtsDef === 'v_yard' &&
                e.bld.progress >= 1 &&
                Math.hypot(e.pos.x - A.base.pos.x, e.pos.z - A.base.pos.z) > A.base.r + 6,
            ),
          );
          // 前線信標：主基地外的投放信標（蓋好的）
          at(
            'beacon',
            R.units.some(
              (e) =>
                !e.dead &&
                e.rtsTeam === 1 &&
                e.rtsDef === 'v_beacon' &&
                e.bld.progress >= 1 &&
                Math.hypot(e.pos.x - A.base.pos.x, e.pos.z - A.base.pos.z) > A.base.r + 10,
            ),
          );
          if (M.drops6 === undefined && R.t >= 360) {
            M.drops6 = R.stats[1].drops;
            M.pods6 = R.stats[1].pods;
          }
        };
      },
      { op, seed, theme },
    );
    const M = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1);
      window.__sim(420, () => (window.__mark(), false));
      const M = { ...window.__M };
      M.first = A.firstAtk === null ? null : Math.round(A.firstAtk);
      M.casts = A.casts;
      M.castLog = JSON.stringify({ ...(A.castLog || {}), ...(A.abLog || {}) });
      M.ms = A.ms;
      M.msMax = A.msMax;
      M.n = A.n;
      M.fac = A.fac;
      M.op = A.op.id;
      M.pend = A.pend.length;
      M.dropsAi = A.drops;
      M.lost = R.stats[1].dropLost || 0;
      M.trades = A.trades;
      M.fwdN = A.fwdN || 0;
      M.fwdRally = A.fwdRally || 0;
      M.dropWhy = A.dropWhy || '';
      M.blds = [
        ...new Set(R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).map((e) => e.rtsDef)),
      ].join('、');
      M.army = R.units.filter(
        (e) => !e.dead && e.rtsTeam === 1 && !e.bld && !e.hero && e.rtsDef !== 'v_worker',
      ).length;
      M.log = A.log.filter((l) => /英雄|升級|進攻 #1|分礦|信標|集貨|交易|開局/.test(l)).slice(0, 14);
      return M;
    });
    return { ctx, page, ev, M };
  }

  async function testRtsVeerAi(browser, base) {
    console.log('Coral 戰爭：電腦對手（維爾威）');
    base0 = base;
    // ---------- 1. 三套開局各一局（同時跑） ----------
    const ops = [
      ['air', 7, 'spaceport'],
      ['drop', 23, 'wasteland'],
      ['eco', 11, 'grid086'],
    ];
    const runs = await Promise.all(ops.map(([op, seed, theme]) => vsStatic(browser, op, seed, theme)));
    let castSum = 0;
    for (let i = 0; i < runs.length; i++) {
      const { M } = runs[i];
      const op = ops[i][0];
      console.log(`  [${op}] ${M.log.join('｜')}`);
      check(M.fac === 'veerwell' && M.op === op, `[${op}] 電腦是維爾威（開局 ${M.op}）`);
      check(
        M.wbuild === 0 && M.pend === 0 && M.drops6 >= 4,
        `[${op}] 建築都是空投：6 分鐘內放下 ${M.drops6} 座（第一次 ${fmt(M.drop1 || 0)}；工人的建造指令 ${M.wbuild}；建築：${M.blds}）`,
      );
      check(
        M.pod1 !== undefined && M.pods6 >= 3,
        `[${op}] 投放艙：第一次 ${fmt(M.pod1 || 0)}、6 分鐘內 ${M.pods6} 個（${JSON.stringify(M.podVia)}）`,
      );
      check(M.hero1 !== undefined && M.hero1 <= 200, `[${op}] 第 1 個英雄 ${fmt(M.hero1 || 0)}`);
      const lo = op === 'drop' ? 210 : 240;
      check(
        M.first !== null && M.first >= lo && M.first <= 420,
        `[${op}] 第一次進攻出發 ${M.first === null ? '—' : fmt(M.first)}（${fmt(lo)}～7:00；部隊 ${M.army} 台）`,
      );
      if (op === 'eco') check(M.yard !== undefined, `[eco] 集貨站的分礦 ${fmt(M.yard || 0)}`);
      if (op === 'drop')
        check(
          M.beacon !== undefined && (M.podVia.beacon || 0) > 0,
          `[drop] 前線信標 ${fmt(M.beacon || 0)}、投放艙降在信標 ${M.podVia.beacon || 0} 個（進攻前的信標 ${M.fwdN}、集結點改到前線 ${M.fwdRally} 次）`,
        );
      check(M.ms < 1, `[${op}] 決策 ${M.n} 次：平均 ${M.ms.toFixed(3)} ms、最長 ${M.msMax.toFixed(2)} ms`);
      castSum += M.casts;
      console.log(
        `  [${op}] 施放技能 ${M.casts} 次（${M.castLog}）、交易 ${M.trades} 次、空投被擊落 ${M.lost}、最後一次空投的原因：${M.dropWhy || '—'}`,
      );
    }
    console.log(`  三局合計施放技能 ${castSum} 次`);
    // 截圖：電腦的基地（空投的建築）
    {
      const { ev, page } = runs[0];
      await ev(() => {
        const g = window.__game,
          R = g.rts,
          A = R.ai.find((a) => a.team === 1);
        g.rtsFogRevealAll(0, true);
        g.rtsCamJump(A.base.pos.x, A.base.pos.z);
        R.cam.dist = 95;
        for (let k = 0; k < 8; k++) {
          g.rtsFogTick(1 / 30);
          g.rtsCamUpdate(1 / 30);
          g.renderMain();
        }
      });
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4-ai.png') });
    }
    for (const r of runs) await r.ctx.close();

    // ---------- 2. 電腦選「隨機」：依種子抽到維爾威也照常運作 ----------
    {
      const { ctx, ev } = await open(browser, 'rtsVeerAiRand');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        let seed = 1,
          R = null;
        for (; seed < 40; seed++) {
          R = g.rtsStart({
            theme: 'wasteland',
            seed,
            size: 400,
            faction: 'castron',
            aiFaction: 'random',
            diff: 'normal',
          });
          if (R.teams[1].faction === 'veerwell') break;
        }
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const A = R.ai.find((a) => a.team === 1);
        window.__sim(150);
        return {
          seed,
          fac: R.teams[1].faction,
          rand: R.cfg.rand[1],
          aiFac: A && A.fac,
          op: A && A.op.id,
          drops: R.stats[1].drops + R.drops.filter((d) => d.team === 1).length,
          blds: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).length,
        };
      });
      check(
        r.fac === 'veerwell' && r.rand && r.aiFac === 'veerwell' && r.drops >= 2 && r.blds >= 2,
        `電腦「隨機」（種子 ${r.seed}）抽到維爾威：開局 ${r.op}、2:30 空投 ${r.drops} 次、${r.blds} 座建築`,
      );
      await ctx.close();
    }

    // ---------- 3. 跨陣營的優先順序（卡斯特隆電腦打維爾威；不跑對局） ----------
    {
      const { ctx, ev } = await open(browser, 'rtsVeerAiX');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        window.__reseed(91);
        const R = g.rtsStart({
          theme: 'wasteland',
          seed: 8,
          size: 400,
          aiFactions: ['castron', 'veerwell'],
          diff: 'normal',
          aiBoth: true,
        });
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const A = R.ai.find((a) => a.team === 0);
        g.rtsFogRevealAll(0, true);
        g.rtsFogTick(0.25);
        const c = { x: 0, z: 0 };
        const mt = g.rtsSpawn(1, 'v_mt', 4, 0, 0);
        const ship = g.rtsSpawn(1, 'v_carrier', 8, 0, 0);
        g.rtsFogTick(0.25);
        // 集火：部隊打得到空中（aaOk）時空投運輸機優先；打不到時照舊（MT 比較近）
        A.aaOk = true;
        A.focusId = null;
        const f1 = g.rtsAiFocusPick(A, c, [mt, ship]);
        A.aaOk = false;
        A.focusId = null;
        const f0 = g.rtsAiFocusPick(A, c, [mt, ship]);
        // 進攻目標：記得的投放信標（+30）比同距離的補給艙優先
        const dep = g.rtsDropNow(1, 'v_depot', 30, 30, 0);
        const bcn = g.rtsDropNow(1, 'v_beacon', -30, 30, 0);
        dep.bld.progress = bcn.bld.progress = 1;
        A.known = [
          { id: dep.id, def: 'v_depot', x: dep.pos.x, z: dep.pos.z },
          { id: bcn.id, def: 'v_beacon', x: bcn.pos.x, z: bcn.pos.z },
        ];
        A.explore = [];
        const obj = g.rtsAiObjective(A, { x: 0, z: 60 });
        // 對空的權重：看過的敵方單位一半以上是空中 → 打得到空中的兵種加權
        A.armSeen = new Map([
          [1, { t: R.t, arm: 'light', pop: 6, air: true }],
          [2, { t: R.t, arm: 'light', pop: 2, air: false }],
        ]);
        A.armPruneT = -1;
        A.vis = [];
        g.rtsAiIntel(A, { blds: [] });
        const mix0 = g.rtsAiMix({ ...A, airK: 0 });
        const mix1 = g.rtsAiMix(A);
        const aa = (m) => (m.c_mt || 0) / ((m.c_mt || 0) + (m.c_shield || 0) || 1);
        return {
          f1: f1 && f1.rtsDef,
          f0: f0 && f0.rtsDef,
          obj: obj && obj.id === bcn.id,
          airK: A.airK,
          aa0: aa(mix0),
          aa1: aa(mix1),
        };
      });
      check(
        r.f1 === 'v_carrier' && r.f0 === 'v_mt',
        `卡斯特隆電腦集火：打得到空中時空投運輸機優先（${r.f1}）、打不到時照舊（${r.f0}）`,
      );
      check(r.obj, '卡斯特隆電腦的進攻目標：記得的投放信標優先');
      check(
        r.airK > 0.5 && r.aa1 > r.aa0,
        `對空的權重 airK ${r.airK.toFixed(2)}：MT（地空）在比例裡的份量 ${r.aa0.toFixed(2)} → ${r.aa1.toFixed(2)}`,
      );
      await ctx.close();
    }
  }

  return { testRtsVeerAi };
};
