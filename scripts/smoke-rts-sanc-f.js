// Coral 戰爭（RTS）R5 F 包（電腦對手：聖域，docs/rts-design.md 16.6、16.17）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-sanc-f')(H)。
// testRtsSancAi（短的確定性測試；不跑電腦對電腦的完整對局、不跑勝率）：
//   1. 普通的聖域電腦（三套開局各一局，三個頁面同時跑）對不動的玩家（主堡打不倒）快轉 7 分鐘：
//      建築、英雄、打野後拾荒（零件 > 0）、回收站或回收拖車、改裝、第一次進攻出發的時間（4～7 分；民兵海 3:30 起）、
//      施放技能、決策 < 1 ms；截圖 rts-r5-ai.png；
//   2. 避難警報：敵方部隊打到聚落中心旁的工人 → 工人躲進去，威脅消失後解除；
//   3. 電腦選「隨機」（依種子抽到聖域）照常運作；
//   4. 跨陣營只看開局 6 分鐘（聖域對卡斯特隆、維爾威對聖域：兩邊都有建築、部隊、英雄，殘骸與拾荒有在動）；
//      其他陣營打聖域的優先順序（集火修理無人機、進攻目標回收站、爆發兵種的權重）。
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
  // 頁面裡的共用工具：__sim 快轉（同時跑迷霧：電腦只看得到迷霧外的、殘骸要看過才知道）
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

  // 一局：聖域電腦（開局 op）對不動的玩家，快轉 sec 秒，回傳里程碑
  async function vsStatic(browser, op, seed, theme, sec) {
    const { ctx, page, ev } = await open(browser, 'rtsSancAi-' + op);
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
          aiFaction: 'sancta',
          diff: 'normal',
          aiOpener: op,
        });
        // AI 分批以鏡頭注視點為準：固定在地圖中心
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const R = g.rts;
        const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        hq0.maxHp = hq0.hp = 1e7;
        const M = (window.__M = {});
        const at = (k, ok) => {
          if (M[k] === undefined && ok) M[k] = Math.round(R.t);
        };
        window.__mark = () => {
          const T = R.teams[1],
            st = R.stats[1];
          at(
            'hero1',
            T.heroes.some((h) => h.ent && !h.ent.dead),
          );
          at('salv', (st.salvOre || 0) > 0);
          at('parts', (T.parts || 0) + (st.salvParts || 0) > 0);
          at('refit', (st.refits || 0) > 0);
          at('t2', T.tech.tier >= 2);
          at(
            'yard',
            R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 's_yard' && e.bld.progress >= 1),
          );
          at(
            'hauler',
            R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 's_hauler'),
          );
          at(
            'haulOn',
            R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsHaulOn),
          );
          if (M.parts6 === undefined && R.t >= 360) M.parts6 = (T.parts || 0) + (st.salvParts || 0);
        };
      },
      { op, seed, theme },
    );
    const M = await ev((sec) => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1);
      let k = 0;
      window.__sim(sec, () => (++k % 8 === 0 && window.__mark(), false));
      window.__mark();
      const M = { ...window.__M };
      const st = R.stats[1],
        T = R.teams[1];
      M.first = A.firstAtk === null ? null : Math.round(A.firstAtk);
      M.casts = A.casts;
      M.castLog = JSON.stringify({ ...(A.castLog || {}), ...(A.abLog || {}) });
      M.ms = A.ms;
      M.msMax = A.msMax;
      M.n = A.n;
      M.fac = A.fac;
      M.op = A.op.id;
      M.popK = A.popK;
      M.salvN = A.salvN;
      M.salvOre = Math.round(st.salvOre || 0);
      M.salvParts = st.salvParts || 0;
      M.parts = T.parts || 0;
      M.refits = st.refits || 0;
      M.refitLog = JSON.stringify(A.refitLog || {});
      M.yards = A.yards;
      M.salvWhy = JSON.stringify(A.salvWhy || {});
      M.hauls = A.hauls;
      M.wrecks = (R.wrecks || []).filter((w) => !w.map).length;
      M.known = (A.wkList || []).length;
      M.blds = [
        ...new Set(R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).map((e) => e.rtsDef)),
      ].join('、');
      M.army = R.units.filter(
        (e) => !e.dead && e.rtsTeam === 1 && !e.bld && !e.hero && e.rtsDef !== 's_worker',
      ).length;
      M.pop = T.pop;
      M.wk = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 's_worker').length;
      M.log = A.log
        .filter((l) => /英雄|升級|進攻 #1|分礦|回收|開局|打野結束|改裝|營地清除|略過/.test(l))
        .slice(0, 18);
      return M;
    }, sec);
    return { ctx, page, ev, M };
  }

  async function testRtsSancAi(browser, base) {
    console.log('Coral 戰爭：電腦對手（聖域）');
    base0 = base;
    // ---------- 1. 三套開局各一局（同時跑） ----------
    const ops = [
      ['horde', 23, 'wasteland'],
      ['scrap', 7, 'flooded'],
      ['turtle', 11, 'snow'],
    ];
    const runs = await Promise.all(ops.map(([op, seed, theme]) => vsStatic(browser, op, seed, theme, 420)));
    let castSum = 0,
      refitSum = 0;
    for (let i = 0; i < runs.length; i++) {
      const { M } = runs[i];
      const op = ops[i][0];
      console.log(`  [${op}] ${M.log.join('｜')}`);
      console.log(
        `  [${op}] 人口 ${M.pop}（工人 ${M.wk}、部隊 ${M.army}）、建築：${M.blds}；拾荒 ${M.salvN} 次、礦石 ${M.salvOre}、零件 ${M.salvParts}（剩 ${M.parts}）、殘骸 ${M.wrecks}（知道 ${M.known}）、改裝 ${M.refits}（${M.refitLog}）、回收站 ${M.yards}、拖車展開 ${M.hauls}；${M.salvWhy}`,
      );
      check(
        M.fac === 'sancta' && M.op === op && M.popK === 2,
        `[${op}] 電腦是聖域（開局 ${M.op}、門檻以人口算）`,
      );
      check(M.hero1 !== undefined && M.hero1 <= 200, `[${op}] 第 1 個英雄 ${fmt(M.hero1 || 0)}`);
      check(
        M.salv !== undefined && M.parts6 > 0,
        `[${op}] 拾荒：第一次入帳 ${fmt(M.salv || 0)}、6 分鐘時累積零件 ${M.parts6}`,
      );
      if (op !== 'horde')
        check(
          M.yard !== undefined || M.hauler !== undefined,
          `[${op}] 回收站 ${M.yard === undefined ? '—' : fmt(M.yard)}、回收拖車 ${M.hauler === undefined ? '—' : fmt(M.hauler)}（展開 ${M.haulOn === undefined ? '—' : fmt(M.haulOn)}）`,
        );
      const lo = op === 'horde' ? 210 : 240;
      check(
        M.first !== null && M.first >= lo && M.first <= 420,
        `[${op}] 第一次進攻出發 ${M.first === null ? '—' : fmt(M.first)}（${fmt(lo)}～7:00）`,
      );
      check(M.ms < 1, `[${op}] 決策 ${M.n} 次：平均 ${M.ms.toFixed(3)} ms、最長 ${M.msMax.toFixed(2)} ms`);
      castSum += M.casts;
      refitSum += M.refits;
      console.log(
        `  [${op}] 施放技能 ${M.casts} 次（${M.castLog}）、T2 ${M.t2 === undefined ? '—' : fmt(M.t2)}`,
      );
    }
    check(refitSum >= 1, `三局合計改裝 ${refitSum} 台`);
    check(castSum >= 2, `三局合計施放技能 ${castSum} 次`);
    // 截圖：電腦的基地
    {
      const { ev, page } = runs[1];
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
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r5-ai.png') });
    }
    for (const r of runs) await r.ctx.close();

    // ---------- 2. 避難警報：敵方部隊打到聚落中心旁的工人 → 躲進去；威脅消失後解除 ----------
    {
      const { ctx, ev } = await open(browser, 'rtsSancAiShel');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        window.__reseed(77);
        g.rtsNeutralOff = true;
        const R = g.rtsStart({
          theme: 'wasteland',
          seed: 7,
          size: 400,
          faction: 'castron',
          aiFaction: 'sancta',
          diff: 'normal',
          aiOpener: 'scrap',
        });
        g.rtsNeutralOff = false;
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const A = R.ai.find((a) => a.team === 1);
        window.__sim(40);
        const hq = R.units.find((e) => e.rtsTeam === 1 && e.rtsDef === 's_hq');
        // 敵方 10 台 MT 出現在聖域的礦脈旁（工人在採礦的地方）
        const m = R.mines.find((q) => Math.hypot(q.pos.x - hq.pos.x, q.pos.z - hq.pos.z) < 32);
        const foes = [];
        for (let i = 0; i < 10; i++) {
          const e = g.rtsSpawn(0, 'c_mt', m.pos.x + (i % 5) * 2 - 4, m.pos.z + Math.floor(i / 5) * 2 - 1);
          foes.push(e);
        }
        g.rtsOrder(foes, { k: 'amove', x: hq.pos.x, z: hq.pos.z });
        const t0 = R.t;
        let n = 0,
          tIn = -1;
        window.__sim(25, () => {
          const k = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsShelter).length;
          if (k && tIn < 0) tIn = R.t;
          n = Math.max(n, k);
          return n >= 5;
        });
        const shelN = A.shelN;
        // 威脅消失（敵人移除）→ 8 秒後解除
        for (const e of foes) if (!e.dead) ((e.rtsQuiet = true), e.die(null));
        window.__sim(14);
        return {
          tIn: tIn < 0 ? -1 : Math.round(tIn - t0),
          n,
          shelN,
          out: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsShelter).length,
          log: A.log.filter((l) => /避難/.test(l)).join('｜'),
        };
      });
      check(
        r.shelN >= 1 && r.n >= 3 && r.out === 0,
        `避難警報：敵方打進礦區 ${r.tIn} 秒後 ${r.n} 台工人躲進去（${r.log}）、威脅消失後解除（還躲著 ${r.out}）`,
      );
      await ctx.close();
    }

    // ---------- 3. 電腦選「隨機」：依種子抽到聖域也照常運作 ----------
    {
      const { ctx, ev } = await open(browser, 'rtsSancAiRand');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        let seed = 1,
          R = null;
        for (; seed < 60; seed++) {
          R = g.rtsStart({
            theme: 'wasteland',
            seed,
            size: 400,
            faction: 'castron',
            aiFaction: 'random',
            diff: 'normal',
          });
          if (R.teams[1].faction === 'sancta') break;
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
          blds: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.rtsDef.startsWith('s_'))
            .length,
        };
      });
      check(
        r.fac === 'sancta' && r.rand && r.aiFac === 'sancta' && r.blds >= 3,
        `電腦「隨機」（種子 ${r.seed}）抽到聖域：開局 ${r.op}、2:30 有 ${r.blds} 座建築`,
      );
      await ctx.close();
    }

    // ---------- 4. 跨陣營：開局 6 分鐘的狀態（不跑完整對局）與打聖域的優先順序 ----------
    const cross = [
      ['sancta', 'castron', 8],
      ['veerwell', 'sancta', 11],
    ];
    const xs = await Promise.all(
      cross.map(async ([a, b, seed]) => {
        const { ctx, ev } = await open(browser, 'rtsSancAiX-' + seed);
        await ev(SIM);
        const r = await ev(
          ({ a, b, seed }) => {
            const g = window.__game;
            window.__reseed(seed * 7 + 1);
            const R = g.rtsStart({
              theme: 'wasteland',
              seed,
              size: 400,
              aiFactions: [a, b],
              diff: 'normal',
              aiBoth: true,
            });
            if (g.lodFrom) g.lodFrom.set(0, 0, 0);
            window.__sim(360);
            const side = (t) => {
              const us = R.units.filter((e) => !e.dead && e.rtsTeam === t);
              return {
                fac: R.teams[t].faction,
                blds: us.filter((e) => e.bld).length,
                army: us.filter((e) => !e.bld && !e.hero && !RTS_W.has(e.rtsDef)).length,
                heroes: us.filter((e) => e.hero).length,
                ms: R.ai.find((q) => q.team === t).ms,
              };
            };
            const RTS_W = new Set(['c_worker', 'a_worker', 'v_worker', 's_worker']);
            const si = R.teams[0].faction === 'sancta' ? 0 : 1;
            const st = R.stats[si];
            return {
              s0: side(0),
              s1: side(1),
              wrecks: (R.wrecks || []).filter((w) => !w.map).length,
              salvOre: Math.round(st.salvOre || 0),
              salvParts: st.salvParts || 0,
            };
          },
          { a, b, seed },
        );
        await ctx.close();
        return r;
      }),
    );
    xs.forEach((r, i) => {
      const [a, b, seed] = cross[i];
      const ok = (q) => q.blds >= 4 && q.army >= 3 && q.heroes >= 1;
      check(
        ok(r.s0) && ok(r.s1) && r.s0.ms < 1 && r.s1.ms < 1,
        `跨陣營（種子 ${seed}）${a} 對 ${b} 開局 6 分鐘：建築 ${r.s0.blds}／${r.s1.blds}、部隊 ${r.s0.army}／${r.s1.army}、英雄 ${r.s0.heroes}／${r.s1.heroes}、決策 ${r.s0.ms.toFixed(2)}／${r.s1.ms.toFixed(2)} ms`,
      );
      check(
        r.wrecks + r.salvOre > 0 && r.salvOre > 0,
        `跨陣營（種子 ${seed}）殘骸與拾荒：場上殘骸 ${r.wrecks}、聖域拾荒礦石 ${r.salvOre}、零件 ${r.salvParts}`,
      );
    });
    // 打聖域的優先順序（卡斯特隆電腦；不跑對局）
    {
      const { ctx, ev } = await open(browser, 'rtsSancAiPri');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        window.__reseed(93);
        const R = g.rtsStart({
          theme: 'wasteland',
          seed: 8,
          size: 400,
          aiFactions: ['castron', 'sancta'],
          diff: 'normal',
          aiBoth: true,
        });
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const A = R.ai.find((a) => a.team === 0);
        g.rtsFogRevealAll(0, true);
        const mil = g.rtsSpawn(1, 's_militia', 4, 0, 0);
        const rep = g.rtsSpawn(1, 's_repair', 9, 0, 0);
        g.rtsFogTick(0.25);
        A.focusId = null;
        const f = g.rtsAiFocusPick(A, { x: 0, z: 0 }, [mil, rep]);
        // 進攻目標：記得的回收站（−20）比稍近的避難屋優先
        A.known = [
          { id: 9001, def: 's_depot', x: 20, z: 30 },
          { id: 9002, def: 's_yard', x: -30, z: 30 },
        ];
        A.explore = [];
        const obj = g.rtsAiObjective(A, { x: 0, z: 60 });
        // 爆發兵種（迫擊砲）的權重 ×1.2
        A.si = 99;
        const m1 = g.rtsAiMix({ ...A, foeFac: 'sancta', op: { ...A.op, mix: { c_mt: 1, c_mortar: 1 } } });
        const m0 = g.rtsAiMix({ ...A, foeFac: 'castron', op: { ...A.op, mix: { c_mt: 1, c_mortar: 1 } } });
        return {
          f: f && f.rtsDef,
          obj: obj && obj.id,
          k1: (m1.c_mortar || 0) / (m1.c_mt || 1),
          k0: (m0.c_mortar || 0) / (m0.c_mt || 1),
        };
      });
      check(r.f === 's_repair', `卡斯特隆電腦集火：修理無人機優先（${r.f}）`);
      check(r.obj === 9002, `卡斯特隆電腦的進攻目標：記得的回收站優先（${r.obj}）`);
      check(
        r.k1 >= r.k0 * 1.15 || r.k0 === 0,
        `打聖域時爆發兵種的權重：迫擊砲／MT ${r.k0.toFixed(2)} → ${r.k1.toFixed(2)}`,
      );
      await ctx.close();
    }
  }

  return { testRtsSancAi };
};
