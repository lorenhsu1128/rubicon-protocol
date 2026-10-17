// Coral 戰爭（RTS）R3 F 包（電腦對手：艾瑟立克，docs/rts-design.md 14.6、14.17）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-aeth-f')(H)。
// testRtsAethAi：
//   1. 普通的艾瑟立克電腦（三套開局各一局，三個頁面同時跑）對不動的玩家（主堡打不倒）快轉 12 分鐘：
//      8 分鐘時停擺的建築 0、要電的建築都在有電的地方、分礦的研究中樞旁有導管節點或汲取塔、英雄、8 分鐘內 T2、
//      融合 ≥ 1 次、施放技能 ≥ 2 次、第一次進攻的時間、決策 < 1 ms；
//   2. 拆掉電腦一座會讓建築停擺的導管節點 → 30 秒內重蓋（地基放下去）；
//   3. 電腦選「隨機」陣營（依種子抽到艾瑟立克）照常運作；
//   4. 跨陣營兩局的開局（種子 8 卡斯特隆對艾瑟立克、種子 11 艾瑟立克對卡斯特隆，兩個頁面同時跑，各 6 分鐘）：
//      兩邊的電腦都在運作（建築、部隊、英雄、沒有停擺、決策 < 1 ms）。完整對局與勝率在 scripts/rts-matchup.js。
// 截圖 rts-r3-ai.png（電腦的基地：導管網與建築）。主迴圈停住，以 rtsSim 快轉（不等實際時間）。
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
  // 頁面裡的共用工具：__sim 快轉（同時跑迷霧：迷霧決定 noLock 與電腦看得到什麼）
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

  // 一局：艾瑟立克電腦（開局 op）對不動的玩家，快轉 12 分鐘，回傳里程碑
  async function vsStatic(browser, op, seed, theme) {
    const { ctx, page, ev } = await open(browser, 'rtsAethAi-' + op);
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
          aiFaction: 'aetheric',
          diff: 'normal',
          aiOpener: op,
        });
        // AI 分批以鏡頭注視點為準：固定在地圖中心
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const R = g.rts;
        const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        hq0.maxHp = hq0.hp = 1e7;
        const A = R.ai.find((a) => a.team === 1);
        const M = (window.__M = { off8: null, unpowered8: null });
        const at = (k, ok) => {
          if (M[k] === undefined && ok) M[k] = Math.round(R.t);
        };
        const own = (def) => R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === def);
        window.__mark = () => {
          const T = R.teams[1];
          at(
            'hero1',
            T.heroes.some((h) => h.ent && !h.ent.dead),
          );
          at('t2', T.tech.tier >= 2);
          at('hero2', g.rtsHeroCount(1) >= 2);
          at('fuse', A.fuseN > 0);
          at('fused', R.stats[1].fused > 0);
          at('lab', own('a_lab'));
          at('foundry', own('a_foundry'));
          // 分礦：主基地外的研究中樞（蓋好），旁邊（34 m 內）有導管節點或汲取塔
          const hqs = R.units.filter(
            (e) =>
              !e.dead &&
              e.rtsTeam === 1 &&
              e.bld &&
              /^a_hq/.test(e.rtsDef) &&
              Math.hypot(e.pos.x - A.base.pos.x, e.pos.z - A.base.pos.z) > A.base.r + 10,
          );
          at(
            'exp',
            hqs.some((h) => h.bld.progress >= 1),
          );
          at(
            'expGrid',
            hqs.some(
              (h) =>
                h.bld.progress >= 1 &&
                R.units.some(
                  (e) =>
                    !e.dead &&
                    e.rtsTeam === 1 &&
                    (e.rtsDef === 'a_node' || e.rtsDef === 'a_tap') &&
                    Math.hypot(e.pos.x - h.pos.x, e.pos.z - h.pos.z) < 40,
                ),
            ),
          );
          if (M.off8 === null && R.t >= 480) {
            const blds = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld);
            M.off8 = blds.filter((e) => e.bld.off).length;
            // 要電的建築都在有電的範圍裡（施工中的也算）
            M.unpowered8 = blds.filter(
              (e) => (g.rtsPowerWhy(1, e.rtsDef, e.pos.x, e.pos.z) || '') === '要蓋在導管範圍內',
            ).length;
            M.blds8 = blds.length;
          }
        };
      },
      { op, seed, theme },
    );
    const M = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1);
      window.__sim(720, () => (window.__mark(), false));
      const M = { ...window.__M };
      // 融合：12 分鐘內沒有時再推進到 17 分鐘（R5 整合：開火間隔改用局內時間之後射速正確了，部隊一直在打野與進攻、
      // 實驗體很少閒在基地，融合常在 12 分鐘之後；其他里程碑照 12 分鐘時的）
      if (M.fused === undefined && A.op.id !== 'tech') {
        window.__sim(300, () => (window.__mark(), window.__M.fused !== undefined));
        M.fuse = window.__M.fuse;
        M.fused = window.__M.fused;
      }
      M.first = A.firstAtk === null ? null : Math.round(A.firstAtk);
      M.casts = A.casts;
      M.castLog = JSON.stringify({ ...(A.castLog || {}), ...(A.abLog || {}) });
      M.ms = A.ms;
      M.msMax = A.msMax;
      M.n = A.n;
      M.fac = A.fac;
      M.op = A.op.id;
      M.nodes = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 'a_node').length;
      M.nodeLog = A.nodeLog.slice(-6).join('、');
      M.blds = [
        ...new Set(R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).map((e) => e.rtsDef)),
      ].join('、');
      M.log = A.log.filter((l) => /英雄|升級|融合|進攻 #1|分礦|導管/.test(l)).slice(0, 14);
      return M;
    });
    return { ctx, page, ev, M };
  }

  async function testRtsAethAi(browser, base) {
    console.log('Coral 戰爭：電腦對手（艾瑟立克）');
    base0 = base;
    // ---------- 1. 三套開局各一局（同時跑） ----------
    const ops = [
      ['grid', 7, 'wasteland'],
      ['swarm', 23, 'institute'],
      ['tech', 11, 'snow'],
    ];
    const runs = await Promise.all(ops.map(([op, seed, theme]) => vsStatic(browser, op, seed, theme)));
    let shotDone = false,
      castSum = 0;
    for (let i = 0; i < runs.length; i++) {
      const { M } = runs[i];
      const op = ops[i][0];
      console.log(`  [${op}] ${M.log.join('｜')}`);
      check(M.fac === 'aetheric' && M.op === op, `[${op}] 電腦是艾瑟立克（開局 ${M.op}）`);
      check(
        M.off8 === 0 && M.unpowered8 === 0 && M.blds8 > 4,
        `[${op}] 8 分鐘時 ${M.blds8} 座建築：停擺 ${M.off8}、不在導管範圍內 ${M.unpowered8}（導管節點 ${M.nodes} 座；${M.nodeLog}）`,
      );
      check(M.hero1 !== undefined && M.hero1 <= 200, `[${op}] 第 1 個英雄 ${fmt(M.hero1 || 0)}`);
      check(
        M.t2 !== undefined && M.t2 <= 570 && M.hero2 !== undefined && M.hero2 <= 630,
        `[${op}] T2 ${fmt(M.t2 || 0)}（9:30 內；標準開局的 Coral 被雷射步兵用掉，約 8～9 分）、第 2 個英雄 ${fmt(M.hero2 || 0)}（建築：${M.blds}）`,
      );
      if (op !== 'tech')
        check(
          M.fused !== undefined && M.fused <= 1020,
          `[${op}] 17 分鐘內融合嵌合體（下指令 ${fmt(M.fuse || 0)}、完成 ${fmt(M.fused || 0)}）`,
        );
      check(
        M.exp !== undefined && M.expGrid !== undefined,
        `[${op}] 分礦的研究中樞 ${fmt(M.exp || 0)}、旁邊的導管 ${fmt(M.expGrid || 0)}`,
      );
      castSum += M.casts;
      console.log(`  [${op}] 施放技能 ${M.casts} 次（${M.castLog}）`);
      const lo = op === 'swarm' ? 210 : 240;
      // grid（先開分礦與升級）：R5 整合後射速正確了，打野打得過、不再提早「偵查到對方兵力薄弱」，第一次進攻在 T2 之後（約 8:40）
      const hi = op === 'grid' ? 570 : 420;
      check(
        M.first !== null && M.first >= lo && M.first <= hi,
        `[${op}] 第一次進攻 ${M.first === null ? '—' : fmt(M.first)}（${fmt(lo)}～${fmt(hi)}）`,
      );
      check(M.ms < 1, `[${op}] 決策 ${M.n} 次：平均 ${M.ms.toFixed(3)} ms、最長 ${M.msMax.toFixed(2)} ms`);
      // 截圖：電腦的基地（導管網）
      if (!shotDone && op === 'grid') {
        shotDone = true;
        const { ev, page } = runs[i];
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
        await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3-ai.png') });
        await ev(() => window.__game.rtsFogRevealAll(0, false));
      }
    }
    check(castSum >= 2, `三局合計施放技能 ${castSum} 次`);
    // ---------- 2. 拆掉一座節點 → 30 秒內重蓋 ----------
    {
      const { ev } = runs[0];
      const r = await ev(() => {
        const g = window.__game,
          R = g.rts,
          A = R.ai.find((a) => a.team === 1);
        // 只靠導管節點供電（不在根的範圍裡）的生產建築：把覆蓋它的節點全部拆掉 → 停擺（備援的節點也一起拆）
        const blds = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.bld.progress >= 1);
        const srcs = g.rtsPowerFields(1).filter((f) => f.on);
        let n = null,
          cut = [];
        for (const b of blds) {
          if (!/a_lab|a_foundry|a_inst/.test(b.rtsDef)) continue;
          const cov = srcs.filter((f) => Math.hypot(f.x - b.pos.x, f.z - b.pos.z) <= f.r);
          if (!cov.length || cov.some((f) => f.root)) continue;
          n = b;
          cut = blds.filter(
            (e) =>
              e.rtsDef === 'a_node' &&
              cov.some((f) => Math.abs(f.x - e.pos.x) < 0.1 && Math.abs(f.z - e.pos.z) < 0.1),
          );
          break;
        }
        if (!n) {
          // 電腦的生產建築都在研究中樞的範圍裡（或有備援）：在主堡外放一座節點＋只靠它供電的培養槽（直接生成）
          const hq = R.units.find((e) => !e.dead && e.rtsTeam === 1 && e.bld && /^a_hq/.test(e.rtsDef));
          const nav = g.world.nav;
          const hr = srcs.find((f) => f.root && Math.hypot(f.x - hq.pos.x, f.z - hq.pos.z) < 1).r;
          let why = { nb: 0, lb: 0 };
          for (const k of [12, 9, 15, 6, 18])
            for (let i = 0; i < 48 && !n; i++) {
              const a = (i / 48) * 6.283;
              const nx = hq.pos.x + Math.cos(a) * (hr - 3),
                nz = hq.pos.z + Math.sin(a) * (hr - 3);
              const lx = hq.pos.x + Math.cos(a) * (hr + k),
                lz = hq.pos.z + Math.sin(a) * (hr + k);
              if (!nav.buildable(nx, nz, 4, 4)) {
                why.nb++;
                continue;
              }
              if (!nav.buildable(lx, lz, 12, 12)) {
                why.lb++;
                continue;
              }
              const nd = g.rtsSpawnBld(1, 'a_node', nx, nz, 0, 1);
              n = g.rtsSpawnBld(1, 'a_lab', lx, lz, 0, 1);
              window.__sim(1);
              // 覆蓋這座培養槽的節點全部拆（原本的備援節點也算）
              cut = R.units.filter(
                (e) =>
                  !e.dead &&
                  e.rtsTeam === 1 &&
                  e.rtsDef === 'a_node' &&
                  Math.hypot(e.pos.x - lx, e.pos.z - lz) <= 24, // 節點的範圍 18（＋導管增幅 6）
              );
              if (!cut.includes(nd)) cut.push(nd);
            }
          if (!n) return { none: true, why };
          window.__sim(1);
        }
        const nd = cut.length;
        const ids0 = new Set(R.units.filter((e) => e.rtsDef === 'a_node').map((e) => e.id));
        // 對方（玩家）的部隊不在附近：直接拆
        for (const e of cut) g.rtsHit(e, 1e6, 0, null, 'none');
        window.__sim(0.5);
        const off0 = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.bld.off).length;
        const t0 = R.t;
        const tt = window.__sim(30, () =>
          R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 'a_node' && !ids0.has(e.id)),
        );
        window.__sim(30);
        const off1 = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.bld.off).length;
        return { deps: nd, off0, tt, t0, off1, log: A.nodeLog.slice(-3).join('、') };
      });
      check(
        !r.none && r.off0 > 0 && r.tt >= 0 && r.tt <= 30,
        `拆掉供電給生產建築的 ${r.deps} 座導管節點${r.why ? JSON.stringify(r.why) : ''}（停擺 ${r.off0} 座）→ ${r.tt >= 0 ? r.tt.toFixed(1) + ' 秒' : '30 秒內沒有'}重蓋（${r.log}）；再 30 秒後停擺 ${r.off1} 座`,
      );
    }
    for (const r of runs) await r.ctx.close();

    // ---------- 3. 電腦選「隨機」：依種子抽到艾瑟立克也照常運作 ----------
    {
      const { ctx, ev } = await open(browser, 'rtsAethAiRand');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        // 找一個「隨機」抽到艾瑟立克的種子（rtsStart 以 makeRng(seed × 7 + 3) 抽：先玩家、再電腦）
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
          if (R.teams[1].faction === 'aetheric') break;
        }
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const A = R.ai.find((a) => a.team === 1);
        window.__sim(240);
        return {
          seed,
          fac: R.teams[1].faction,
          rand: R.cfg.rand[1],
          aiFac: A && A.fac,
          op: A && A.op.id,
          blds: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).length,
          nodes: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 'a_node').length,
          off: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.bld.off).length,
        };
      });
      check(
        r.fac === 'aetheric' &&
          r.rand &&
          r.aiFac === 'aetheric' &&
          r.blds >= 4 &&
          r.nodes >= 1 &&
          r.off === 0,
        `電腦「隨機」（種子 ${r.seed}）抽到艾瑟立克：開局 ${r.op}、4 分鐘 ${r.blds} 座建築（導管節點 ${r.nodes}、停擺 ${r.off}）`,
      );
      await ctx.close();
    }

    // ---------- 4. 跨陣營兩局的開局（同時跑，各 6 分鐘）：兩邊的電腦都在運作 ----------
    // （完整的電腦對電腦對局與勝率在 scripts/rts-matchup.js，不放進冒煙測試）
    const games = [
      [8, ['castron', 'aetheric'], 'wasteland'],
      [11, ['aetheric', 'castron'], 'snow'],
    ];
    const ends = await Promise.all(
      games.map(async ([seed, facs, theme]) => {
        const { ctx, ev } = await open(browser, 'rtsAethAiX' + seed);
        await ev(SIM);
        const end = await ev(
          ({ seed, facs, theme }) => {
            const g = window.__game;
            window.__reseed(seed * 7 + 1);
            g.rtsStart({ theme, seed, size: 400, aiFactions: facs, diff: 'normal', aiBoth: true });
            if (g.lodFrom) g.lodFrom.set(0, 0, 0);
            const R = g.rts;
            window.__sim(360);
            const of = (i, f) => R.units.filter((e) => !e.dead && e.rtsTeam === i && f(e));
            return {
              facs: R.teams.slice(0, 2).map((T) => T.faction),
              aiFac: R.ai.map((a) => a.fac),
              ops: R.ai.map((a) => a.op.id).join('／'),
              blds: [0, 1].map((i) => of(i, (e) => e.bld).length),
              army: [0, 1].map((i) => of(i, (e) => !e.bld && !e.hero && !/worker/.test(e.rtsDef)).length),
              heroes: [0, 1].map((i) => of(i, (e) => e.hero).length),
              off: [0, 1].map((i) => of(i, (e) => e.bld && e.bld.off).length),
              ms: R.ai.map((a) => a.ms),
            };
          },
          { seed, facs, theme },
        );
        await ctx.close();
        return { seed, end };
      }),
    );
    for (const { seed, end } of ends) {
      check(
        end.aiFac.join() === end.facs.join() &&
          end.blds.every((n) => n >= 5) &&
          end.army.every((n) => n >= 3) &&
          end.heroes.every((n) => n >= 1) &&
          end.off.every((n) => n === 0) &&
          end.ms.every((m) => m < 1),
        `跨陣營（種子 ${seed}，${end.facs.join(' 對 ')}，${end.ops}）6 分鐘：建築 ${end.blds.join('／')}、部隊 ${end.army.join('／')}、英雄 ${end.heroes.join('／')}、停擺 ${end.off.join('／')}、決策 ${end.ms.map((m) => m.toFixed(3)).join('／')} ms`,
      );
    }
  }

  return { testRtsAethAi };
};
