// Coral 戰爭（RTS）R2 F 包（電腦對手第二輪）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-f')(H)。
// testRtsAi2：普通電腦對不動的玩家（野怪營地照常生成）：第 1 個英雄、打野（清除營地、撿到道具）、8 分鐘內 T2 與
// 第 2 個英雄、12 分鐘內重工廠、工程研究所與研究、施放英雄技能、帶著英雄進攻；之後兩邊都是電腦（普通）快轉，30 分鐘內分出勝負並記錄決策耗時。
// 主迴圈停住，以 rtsSim 快轉（不等實際時間）；截圖前才算繪幾格。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;
  const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');

  async function open(browser, name) {
    const { ctx, page } = await newPage(browser, name);
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base0 + (base0.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    return { ctx, page, ev: (fn, a) => page.evaluate(fn, a) };
  }
  let base0 = '';

  // 截圖：鏡頭移到 (x, z)、揭露全圖、只更新迷霧與鏡頭並算繪（模擬停住）
  async function shot(ev, page, name, x, z, dist) {
    await ev(
      ({ x, z, dist }) => {
        const g = window.__game,
          R = g.rts;
        g.rtsFogRevealAll(0, true);
        g.rtsCamJump(x, z);
        R.cam.dist = dist;
        for (let i = 0; i < 8; i++) {
          g.rtsFogTick(1 / 30);
          g.rtsCamUpdate(1 / 30);
          g.renderMain();
        }
      },
      { x, z, dist },
    );
    await page.screenshot({ path: path.join(SHOT_DIR, name) });
    await ev(() => window.__game.rtsFogRevealAll(0, false));
  }

  async function testRtsAi2(browser, base) {
    console.log('Coral 戰爭：電腦對手第二輪（英雄、打野、科技、研究、技能、電腦對電腦）');
    base0 = base;
    const { ctx, page, ev } = await open(browser, 'rtsAi2a');
    const st = await ev(() => {
      const g = window.__game;
      g.rtsPathMs = Infinity;
      window.__reseed(17);
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
        aiOpener: 'std',
      });
      const R = g.rts;
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
      // 玩家不動，而且主堡打不倒（看電腦 8 分鐘內的發展；不讓局提早結束）
      const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
      hq0.maxHp = hq0.hp = 1e7;
      window.__hq0 = hq0;
      const A = R.ai.find((a) => a.team === 1);
      return { ai: R.ai.length, op: A.op.id, camps: R.camps.filter((c) => !c.off && c.ents.size).length };
    });
    check(
      st.ai === 1 && st.op === 'std' && st.camps >= 6,
      `普通電腦（開局 ${st.op}）、野怪營地 ${st.camps} 個照常生成`,
    );

    // 快轉 12 分鐘：每格記下各里程碑（window.__mark）；第一次施放技能時停下來截圖
    await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1),
        T = R.teams[1];
      const M = (window.__M = {
        atkHero: 0,
        atkHeroN: 0,
        castAt: null,
        creepAt: null,
        pick: null,
      });
      const own = (def) => R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === def);
      const at = (k, ok) => {
        if (M[k] === undefined && ok) M[k] = Math.round(R.t);
      };
      window.__mark = () => {
        const heroes = T.heroes.filter((h) => h.ent && !h.ent.dead).map((h) => h.ent);
        at('hero1', heroes.length > 0);
        at('hero2', g.rtsHeroCount(1) >= 2); // 生產中的也算
        at('works', own('c_works'));
        at('res', Object.keys(T.tech.res).length > 0);
        at('t2', T.tech.tier >= 2);
        at('heavy', own('c_heavy'));
        if (M.creep === undefined && A.creep && !A.creep.next) {
          M.creep = Math.round(R.t);
          M.creepAt = { x: A.creep.camp.pos.x, z: A.creep.camp.pos.z };
        }
        at(
          'cleared',
          R.camps.some((c) => c.cleared && c.clearedBy === 1),
        );
        for (const h of T.heroes)
          for (const s of h.inv) if (s && !M.pick) M.pick = s.id + ' ' + Math.round(R.t);
        if (M.cast === undefined && A.casts > 0) {
          M.cast = Math.round(R.t);
          const h = heroes[0];
          if (h) M.castAt = { x: h.pos.x, z: h.pos.z };
        }
        // 第一次進攻出發後 30 秒：英雄在出擊的部隊（進攻中的、或先清路上營地的）旁邊的比例
        if (A.firstAtk !== null && R.t - A.firstAtk < 30) {
          const ids = A.mode === 'attack' ? A.atk : A.creep && A.creep.next ? A.creep.units : null;
          const L = ids ? R.units.filter((e) => ids.has(e.id) && !e.dead && !e.hero) : [];
          if (L.length) {
            const cx = L.reduce((s, e) => s + e.pos.x, 0) / L.length,
              cz = L.reduce((s, e) => s + e.pos.z, 0) / L.length;
            M.atkHeroN++;
            if (heroes.some((h) => Math.hypot(h.pos.x - cx, h.pos.z - cz) < 30)) M.atkHero++;
          }
        }
      };
    });
    // 推進到 12 分鐘；第一次施放技能、第一次在營地交戰（打了 4 秒）時停下來截圖
    const shots = { cast: false, fight: false };
    for (let k = 0; k < 3; k++) {
      const r = await ev((sh) => {
        const g = window.__game,
          R = g.rts,
          A = R.ai.find((a) => a.team === 1),
          M = window.__M;
        let ev = null;
        window.__sim(720 - R.t, () => {
          window.__mark();
          if (!sh.cast && M.castAt) ev = { k: 'cast', ...M.castAt };
          else if (!sh.fight && A.creep && A.creep.ph === 'fight' && R.t - A.creep.fightT > 4) {
            const L = R.units.filter((e) => A.creep.units.has(e.id) && !e.dead);
            ev = {
              k: 'fight',
              x: L.reduce((s, e) => s + e.pos.x, 0) / L.length,
              z: L.reduce((s, e) => s + e.pos.z, 0) / L.length,
            };
          }
          return !!ev;
        });
        return ev;
      }, shots);
      if (!r) break;
      shots[r.k] = true;
      await shot(ev, page, r.k === 'cast' ? 'rts-ai2-cast.png' : 'rts-ai2-creep.png', r.x, r.z, 50);
    }
    const M2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1),
        T = R.teams[1];
      window.__sim(720 - R.t, () => (window.__mark(), false));
      const M = { ...window.__M };
      M.first = A.firstAtk === null ? null : Math.round(A.firstAtk);
      M.res2 = JSON.stringify(T.tech.res);
      M.heroes = T.heroes.map((h) => `${h.def} ${h.lv} 級（${h.sk.join('')}）`).join('、');
      M.casts = A.casts;
      M.castLog = JSON.stringify(A.castLog || {});
      M.camps = A.campDone.size;
      M.ms = A.ms;
      M.msMax = A.msMax;
      M.n = A.n;
      M.items = T.heroes
        .map((h) =>
          h.inv
            .filter(Boolean)
            .map((s) => s.id)
            .join('+'),
        )
        .join('／');
      M.log = A.log.filter((l) => /英雄|打野|營地|升級|研究|進攻|買|雇用|蓋/.test(l)).slice(0, 40);
      M.blds = [
        ...new Set(R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).map((e) => e.rtsDef)),
      ].join('、');
      return M;
    });
    console.log('  電腦的紀錄：' + M2.log.join('｜'));
    check(
      M2.hero1 !== undefined && M2.hero1 <= 200,
      `第 1 個英雄 ${fmt(M2.hero1 || 0)} 出現（英雄：${M2.heroes}）`,
    );
    check(
      M2.creep !== undefined && M2.cleared !== undefined && M2.camps >= 1,
      `打野：${fmt(M2.creep || 0)} 出發、${fmt(M2.cleared || 0)} 清除第一個營地（共 ${M2.camps} 個）`,
    );
    check(!!M2.pick, `英雄拿到道具（${M2.pick}；現在的背包 ${M2.items}）`);
    check(
      M2.t2 !== undefined && M2.t2 <= 480 && M2.hero2 !== undefined && M2.hero2 <= 480,
      `8 分鐘內升到 T2（${fmt(M2.t2 || 0)}）、第 2 個英雄（${fmt(M2.hero2 || 0)}）`,
    );
    check(
      M2.works !== undefined && M2.res !== undefined && M2.heavy !== undefined,
      `12 分鐘內：工程研究所 ${fmt(M2.works || 0)}、第一項研究完成 ${fmt(M2.res || 0)}（${M2.res2}）、重工廠 ${fmt(M2.heavy || 0)}（建築：${M2.blds}）`,
    );
    check(
      M2.casts >= 2 && M2.cast !== undefined,
      `施放技能 ${M2.casts} 次（第一次 ${fmt(M2.cast || 0)}：${M2.castLog}）`,
    );
    check(
      M2.first !== null &&
        M2.first >= 240 &&
        M2.first <= 420 &&
        M2.atkHeroN > 0 &&
        M2.atkHero / M2.atkHeroN > 0.5,
      `第一次進攻 ${fmt(M2.first || 0)}（4～7 分）、出發後 30 秒內英雄在部隊旁 ${Math.round((100 * M2.atkHero) / Math.max(1, M2.atkHeroN))}%`,
    );
    check(M2.ms < 1, `決策 ${M2.n} 次：平均 ${M2.ms.toFixed(3)} ms、最長 ${M2.msMax.toFixed(2)} ms`);
    // 截圖：打野的營地、電腦的基地（科技）
    const hq1 = await ev(() => {
      const R = window.__game.rts;
      const h = R.units.find((e) => !e.dead && e.rtsTeam === 1 && e.bld && /^c_hq/.test(e.rtsDef));
      return h ? { x: h.pos.x, z: h.pos.z } : null;
    });
    if (hq1) await shot(ev, page, 'rts-ai2-tech.png', hq1.x, hq1.z, 90);
    await ctx.close();

    // ---------- 兩邊都是電腦（普通）：30 分鐘內分出勝負 ----------
    const res = [];
    for (const seed of [8, 11]) {
      const { ctx: c2, page: p2, ev: ev2 } = await open(browser, 'rtsAi2b' + seed);
      const end = await ev2((seed) => {
        const g = window.__game;
        g.rtsPathMs = Infinity;
        window.__reseed(seed * 7 + 1);
        g.rtsStart({
          theme: 'wasteland',
          seed,
          size: 400,
          faction: 'castron',
          aiFaction: 'castron',
          diff: 'normal',
          aiBoth: true,
        });
        // AI 分批（game.js 的 aiStep）以鏡頭注視點為準：這裡不算繪，固定在地圖中心（點對稱，兩隊一樣）
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const R = g.rts;
        const dt = 1 / 15;
        for (let t = 0; t < 1800 && !R.over; t += dt) {
          g.rtsSim(dt);
          g.fx.update(dt);
          g.rtsFogTick(dt);
        }
        return {
          over: R.over,
          t: R.t,
          ops: R.ai.map((a) => a.op.id).join('／'),
          tier: R.teams
            .slice(0, 2)
            .map((T) => T.tech.tier)
            .join('／'),
          heroes: R.teams
            .slice(0, 2)
            .map((T) => T.heroes.length)
            .join('／'),
          camps: R.ai.map((a) => a.campDone.size).join('／'),
          ms: R.ai.map((a) => a.ms),
          msMax: R.ai.map((a) => a.msMax),
        };
      }, seed);
      res.push(end);
      check(
        !!end.over && end.over.t <= 1800,
        `電腦對電腦（種子 ${seed}，${end.ops}）：${end.over ? fmt(end.over.t) + ' 分出勝負、隊伍 ' + (end.over.win ? 0 : 1) + ' 獲勝' : '30 分鐘還沒結束'}（層級 ${end.tier}、英雄 ${end.heroes}、營地 ${end.camps}）`,
      );
      check(
        end.ms.every((m) => m < 1),
        `決策平均 ${end.ms.map((m) => m.toFixed(3)).join('／')} ms（最長 ${end.msMax.map((m) => m.toFixed(1)).join('／')}）`,
      );
      await c2.close();
    }
  }

  return { testRtsAi2 };
};
