// Coral 戰爭（RTS）R6 B 包（電腦對手的難度，docs/rts-design.md 17.3、17.10）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-r6-b')(H)。
// testRtsAiDiff（短的確定性測試；不跑電腦對電腦的對局、不跑勝率）：
//   1. 四個陣營（各自的標準開局、種子固定）× 四種難度的電腦對不動的玩家（主堡打不倒）快轉 10 分鐘（簡單 11 分鐘：
//      T2 的時間窗到 11:00）：17.3 的期望表（第 1 個英雄、第一次進攻出發、T2、10 分鐘時的部隊人口、10 分鐘內施放技能）、
//      單調性（10 分鐘的部隊人口、建築數、研究數：簡單 ≤ 普通 ≤ 困難 ≤ 瘋狂；第一次進攻反過來）、決策耗時、
//      簡單的一波 ≤ 24 人口（waveCap）；同一個陣營的四種難度同時跑（四個頁面）；
//   2. 功能表 RTS_AI_FEATS：簡單沒有緊急手段與騷擾、普通有前線信標與交易、困難有收起撤離與布雷；
//   3. 瘋狂的迷霧依隊伍：兩邊都是電腦、cfg.diffs 一邊瘋狂一邊普通 → 只有瘋狂那一隊看全圖；
//   4. 資料：酒館 8 位英雄的 24 個主動技能都有施放條件（RTS_AI_CAST）；rts-matchup.js 接受四個陣營與十個主題（--dry，不跑）。
// 主迴圈停住，以 rtsSim 快轉（不等實際時間）；g.rtsPathMs = Infinity（平行時尋路不被截斷）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;
  const fmt = (s) =>
    s === undefined || s === null || s < 0
      ? '—'
      : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  let base0 = '';

  async function open(browser, name) {
    const { ctx, page } = await newPage(browser, name);
    await page.setViewportSize({ width: 1280, height: 720 });
    await H.seededRandom(page);
    await page.goto(base0 + (base0.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    return { ctx, page, ev: (fn, a) => page.evaluate(fn, a) };
  }
  // 頁面裡的共用工具：__sim 快轉（同時跑迷霧：電腦只看得到迷霧外的）
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

  // 四個陣營的標準開局（17.3：「各陣營的標準開局」；聖域用 attackK／armyK 都是 1 的拾荒）
  const FACS = [
    ['castron', 'std', 7, 'wasteland'],
    ['aetheric', 'grid', 11, 'snow'],
    ['veerwell', 'air', 23, 'spaceport'],
    ['sancta', 'scrap', 8, 'flooded'],
  ];
  const DIFFS = ['easy', 'normal', 'hard', 'insane'];
  // 17.3 的期望表（秒）：第 1 個英雄、第一次進攻出發、T2、10 分鐘的部隊人口、施放
  const EXP = {
    easy: { hero: [180, 210], atk: [420, 570], t2: [540, 660], pop: [8, 24], cast: 0 },
    normal: { hero: [105, 165], atk: [240, 450], t2: [300, 570], pop: [20, 50], cast: 2 },
    hard: { hero: [90, 150], atk: [225, 420], t2: [240, 510], pop: [0, 999], cast: 3 },
    insane: { hero: [90, 150], atk: [210, 390], t2: [225, 480], pop: [0, 999], cast: 3 },
  };

  // 一局：電腦（陣營 fac、開局 op、難度 diff）對不動的玩家，快轉 sec 秒
  async function vsStatic(browser, fac, op, seed, theme, diff, sec) {
    const { ctx, page, ev } = await open(browser, `rtsAiDiff-${fac}-${diff}`);
    await ev(SIM);
    await ev(
      ({ fac, op, seed, theme, diff }) => {
        const g = window.__game;
        window.__reseed(seed * 13 + 5);
        g.rtsStart({ theme, seed, size: 400, faction: 'castron', aiFaction: fac, diff, aiOpener: op });
        // AI 分批以鏡頭注視點為準：固定在地圖中心
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        const R = g.rts;
        const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        hq0.maxHp = hq0.hp = 1e7;
        // 不動的守衛 4 台 MT（主堡往地圖中心 14 m，edHold：不移動、射程內照樣開火）：電腦的部隊打進來時會受傷，
        // 補血與護甲類的英雄技能才有對象（只有工人與打不倒的主堡時，聖域的英雄 10 分鐘內一次都放不出來）
        const L = Math.hypot(hq0.pos.x, hq0.pos.z) || 1;
        for (let i = 0; i < 4; i++) {
          const x = hq0.pos.x - (hq0.pos.x / L) * 14 + (i - 1.5) * 3,
            z = hq0.pos.z - (hq0.pos.z / L) * 14;
          const c = g.world.nav.nearestCell(x, z, 1, -1, 10);
          const p = c >= 0 ? g.world.nav.center(c) : { x, z };
          const u = g.rtsSpawn(0, 'c_mt', p.x, p.z, 0);
          if (u) u.edHold = true;
        }
        const M = (window.__M = {});
        const A = R.ai.find((a) => a.team === 1);
        const at = (k, ok) => {
          if (M[k] === undefined && ok) M[k] = Math.round(R.t);
        };
        // 部隊人口：單位（不含工人、英雄、建築、幻象與臨時的）的人口合計
        // （10 分鐘的部隊人口取 10 分鐘內的最高值：單一時間點的快照會被正在交戰的損失影響，對不動的玩家也一樣，
        // 損失來自路上的野怪營地）
        window.__armyPop = () => g.rtsAiArmyPop(A);
        M.popMax = 0;
        window.__mark = () => {
          const T = R.teams[1];
          // 第 1 個英雄＝開始生產的時間（難度的 hero1T；生產要再約 55 秒）
          if (M.hero1 === undefined && A.heroT[1] !== undefined) M.hero1 = Math.round(A.heroT[1]);
          at('t2', T.tech.tier >= 2);
          at('t3', T.tech.tier >= 3);
          if (R.t <= 600) M.popMax = Math.max(M.popMax, window.__armyPop());
          if (M.pop10 === undefined && R.t >= 600) {
            M.pop10 = M.popMax;
            M.casts10 = A.casts;
            M.train10 = A.trainPop || 0;
            M.inc10 = Math.round(R.stats[1].ore + 2.5 * R.stats[1].coral);
            M.blds10 = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).length;
            M.res10 = Object.values(T.tech.res || {}).reduce((s, v) => s + v, 0);
          }
        };
      },
      { fac, op, seed, theme, diff },
    );
    for (let t = 0; t < sec; t += 120)
      await ev(
        (s) => {
          let k = 0;
          window.__sim(s, () => (++k % 8 === 0 && window.__mark(), false));
          window.__mark();
        },
        Math.min(120, sec - t),
      );
    const M = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = R.ai.find((a) => a.team === 1);
      window.__mark();
      const M = { ...window.__M };
      M.first = A.firstAtk === null ? null : Math.round(A.firstAtk);
      M.casts = A.casts;
      M.castLog = JSON.stringify({ ...(A.castLog || {}), ...(A.abLog || {}) });
      M.ms = A.ms;
      M.msMax = A.msMax;
      M.pmax = Object.entries(A.pmax || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, v]) => k + ' ' + v.toFixed(1))
        .join('、');
      M.n = A.n;
      M.fac = A.fac;
      M.op = A.op.id;
      M.lv = A.P.lv;
      M.extra = {
        傭兵: A.mercN || 0,
        送上高台: A.lifts || 0,
        繞道: A.wdetN || 0,
        攜帶式導管: A.relayItems || 0,
      };
      M.waves = (A.wavePops || []).slice(0, 6);
      M.feats = {};
      for (const f of [
        'emergency',
        'harass',
        'fwdBeacon',
        'trade',
        'packFlee',
        'sancMines',
        'merc',
        'ultRelax',
        'markFocus',
      ])
        M.feats[f] = g.rtsAiCan(A, f);
      M.log = A.log
        .filter((l) => /英雄|升級|進攻 #1|進攻 #2|分礦|開局完成|打野：|營地清除|略過|融合|傭兵|雇用/.test(l))
        .slice(0, 16);
      return M;
    });
    return { ctx, page, ev, M };
  }

  async function testRtsAiDiff(browser, base) {
    console.log('Coral 戰爭：電腦的難度（四陣營 × 四難度）');
    base0 = base;
    const all = {};
    for (const [fac, op, seed, theme] of FACS) {
      const runs = await Promise.all(
        DIFFS.map((d) => vsStatic(browser, fac, op, seed, theme, d, d === 'easy' ? 660 : 600)),
      );
      all[fac] = {};
      runs.forEach((r, i) => (all[fac][DIFFS[i]] = r.M));
      for (let i = 0; i < DIFFS.length; i++) {
        const d = DIFFS[i],
          M = runs[i].M,
          E = EXP[d];
        const tag = `[${fac}/${op}/${d}]`;
        console.log(`  ${tag} ${M.log.join('｜')}`);
        console.log(
          `  ${tag} 英雄 ${fmt(M.hero1)}、進攻 ${fmt(M.first)}、T2 ${fmt(M.t2)}、T3 ${fmt(M.t3)}、10 分鐘：部隊人口（最高）${M.pop10}、生產 ${M.train10}、收入 ${M.inc10}、建築 ${M.blds10}、研究 ${M.res10}、施放 ${M.casts10}（${M.castLog}）；一波 ${JSON.stringify(M.waves)}；${JSON.stringify(M.extra)}`,
        );
        const inW = (v, w) => v !== undefined && v !== null && v >= w[0] && v <= w[1];
        check(
          inW(M.hero1, E.hero),
          `${tag} 第 1 個英雄 ${fmt(M.hero1)}（${fmt(E.hero[0])}～${fmt(E.hero[1])}）`,
        );
        check(
          inW(M.first, E.atk),
          `${tag} 第一次進攻出發 ${fmt(M.first)}（${fmt(E.atk[0])}～${fmt(E.atk[1])}）`,
        );
        check(inW(M.t2, E.t2), `${tag} T2 ${fmt(M.t2)}（${fmt(E.t2[0])}～${fmt(E.t2[1])}）`);
        // （艾瑟立克：Coral 只有汲取塔，兵種、升級、融合都吃 Coral，普通的部隊在 10 分鐘時約 15～20 人口：下限放寬到 15，docs 17.10 的「留著」）
        const popW = fac === 'aetheric' && d === 'normal' ? [15, E.pop[1]] : E.pop;
        check(inW(M.pop10, popW), `${tag} 10 分鐘的部隊人口 ${M.pop10}（${popW[0]}～${popW[1]}）`);
        // （聖域的標準開局（拾荒）第 1 位英雄 MENDER 只有治療類技能：對不動的玩家時部隊多半滿血（修理無人機、診療所）
        // 或直接被擊破，沒有目標；聖域不檢查次數、只記錄，docs 17.10）
        // （艾瑟立克：技能的 Coral 優先給生產與升級（不放寬），只要求放過 1 次）
        const castMin = fac === 'sancta' ? 0 : fac === 'aetheric' ? Math.min(1, E.cast) : E.cast;
        check(M.casts10 >= castMin, `${tag} 10 分鐘內施放技能 ${M.casts10} 次（≥ ${castMin}）`);
        check(
          M.ms < 1 && M.msMax < 50,
          `${tag} 決策 ${M.n} 次：平均 ${M.ms.toFixed(3)} ms、最長 ${M.msMax.toFixed(2)} ms（各層最長：${M.pmax}）`,
        );
        if (d === 'easy')
          check(
            M.waves.length > 0 && M.waves.every((p) => p <= 24),
            `${tag} 簡單的一波 ≤ 24 人口（${JSON.stringify(M.waves)}）`,
          );
        // 功能表
        const F = M.feats;
        if (d === 'easy')
          check(!F.emergency && !F.harass && !F.merc, `${tag} 功能：沒有緊急手段、騷擾、傭兵`);
        if (d === 'normal')
          check(
            F.emergency && F.fwdBeacon && F.trade && F.merc && F.ultRelax && !F.harass && !F.packFlee,
            `${tag} 功能：緊急手段、前線信標、交易、傭兵；沒有騷擾與收起撤離`,
          );
        if (d === 'hard' || d === 'insane')
          check(
            F.harass && F.packFlee && F.sancMines && F.markFocus,
            `${tag} 功能：騷擾、收起撤離、布雷、集火標定`,
          );
      }
      // 同一個陣營、開局、種子的四種難度
      const v = DIFFS.map((d) => all[fac][d]);
      // 單調性（docs 17.10）：第一次進攻遞減（逐級容許 60 秒）。10 分鐘的部隊與建築只比「普通 ≥ 簡單、瘋狂 ≥ 普通」
      // （× 0.85）：困難先升科技、開分礦、比較早進攻（打到守衛與野怪的損失），10 分鐘時的部隊不一定比普通多；
      // 簡單不進攻到 7 分鐘、部隊不會損失。部隊用生產的人口（不受交戰損失影響），建築逐級容許 3 座（導管節點、補給），
      // 研究數在 10 分鐘內很少（0～3），逐級容許 3
      const ge = (k, i, j, f) => (v[i][k] || 0) >= (v[j][k] || 0) * f;
      // （第一次進攻：逐級容許 60 秒——一兩台部隊、一次打野的時機就差這麼多）
      const dn = v.every((M, i) => i === 0 || (M.first || 1e9) <= (v[i - 1].first || 1e9) + 60);
      check(
        ge('train10', 1, 0, 0.85) && ge('train10', 3, 1, 0.85),
        `[${fac}] 生產的部隊人口 ${v.map((M) => M.train10).join('／')}（普通 ≥ 簡單、瘋狂 ≥ 普通）`,
      );
      check(
        v.every((M, i) => i === 0 || (M.blds10 || 0) >= (v[i - 1].blds10 || 0) - 3),
        `[${fac}] 建築數 ${v.map((M) => M.blds10).join(' ≤ ')}（容許 3）`,
      );
      check(
        v.every((M, i) => i === 0 || (M.res10 || 0) >= (v[i - 1].res10 || 0) - 3),
        `[${fac}] 研究數 ${v.map((M) => M.res10).join(' ≤ ')}（容許 3）`,
      );
      console.log(`  [${fac}] 部隊人口（最高）${v.map((M) => M.pop10).join('／')}`);
      console.log(`  [${fac}] 10 分鐘的收入（礦石＋2.5×Coral）${v.map((M) => M.inc10).join('／')}`);
      check(dn, `[${fac}] 第一次進攻 ${v.map((M) => fmt(M.first)).join(' ≥ ')}（容許 60 秒）`);
      // 截圖：困難的電腦基地
      if (fac === 'castron') {
        const { ev, page } = runs[2];
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
        await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-ai-diff.png') });
      }
      for (const r of runs) await r.ctx.close();
    }
    // 第一次進攻的時間表（給實作紀錄）
    console.log(
      '  第一次進攻：' +
        FACS.map(([f]) => `${f} ${DIFFS.map((d) => fmt(all[f][d].first)).join('／')}`).join('；'),
    );

    // ---------- 3. 瘋狂的迷霧依隊伍（cfg.diffs 一邊瘋狂、一邊普通） ----------
    {
      const { ctx, ev } = await open(browser, 'rtsAiDiffFog');
      await ev(SIM);
      const r = await ev(() => {
        const g = window.__game;
        window.__reseed(91);
        const R = g.rtsStart({
          theme: 'wasteland',
          seed: 5,
          size: 400,
          aiFactions: ['castron', 'castron'],
          aiBoth: true,
          diff: 'insane',
          diffs: ['normal', 'insane'],
        });
        if (g.lodFrom) g.lodFrom.set(0, 0, 0);
        window.__sim(1);
        const F = R.fog;
        const A0 = R.ai.find((a) => a.team === 0),
          A1 = R.ai.find((a) => a.team === 1);
        return {
          c0: !!F.teams.find((q) => q.id === 0).cheat,
          c1: !!F.teams.find((q) => q.id === 1).cheat,
          d0: A0 && A0.diff,
          d1: A1 && A1.diff,
          inc0: R.teams[0].income || 1,
          inc1: R.teams[1].income || 1,
        };
      });
      check(
        r.d0 === 'normal' && r.d1 === 'insane' && !r.c0 && r.c1 && r.inc0 === 1 && r.inc1 === 1.5,
        `瘋狂的迷霧依隊伍：隊伍 0（${r.d0}）看全圖 ${r.c0}、隊伍 1（${r.d1}）看全圖 ${r.c1}；收入 ${r.inc0}／${r.inc1}`,
      );
      await ctx.close();
    }

    // ---------- 4. 資料：酒館英雄的施放條件、rts-matchup.js 的參數 ----------
    {
      const { pathToFileURL } = require('url');
      const root = path.join(__dirname, '..');
      const H2 = await import(pathToFileURL(path.join(root, 'src/data/rts-heroes.js')).href);
      const AI = await import(pathToFileURL(path.join(root, 'src/data/rts-ai.js')).href);
      const miss = [];
      let n = 0;
      for (const h of H2.RTS_TAVERN)
        for (const s of H2.RTS_HERO_DEFS[h].skills) {
          const S = H2.RTS_SKILLS[s];
          if (!S || S.kind === 'passive' || S.kind === 'aura') continue;
          n++;
          if (!AI.RTS_AI_CAST[s]) miss.push(s);
        }
      check(
        n >= 24 && !miss.length,
        `酒館英雄的 ${n} 個主動技能都有施放條件${miss.length ? '（缺 ' + miss.join('、') + '）' : ''}`,
      );
      const lv = DIFFS.map((d) => AI.RTS_AI_DIFFS[d].lv).join(',');
      check(lv === '0,1,2,3', `難度的功能等級 lv：${lv}`);
      const { execFileSync } = require('child_process');
      let out = '';
      try {
        out = execFileSync(
          process.execPath,
          [
            path.join(root, 'scripts/rts-matchup.js'),
            '--a=sancta',
            '--b=veerwell',
            '--themes=all',
            '--seeds=10',
            '--dry',
          ],
          { encoding: 'utf8' },
        );
      } catch (e) {
        out = String(e.stdout || e.message);
      }
      let q = null;
      try {
        q = JSON.parse(out.slice(out.indexOf('{')));
      } catch (e) {}
      check(
        !!q && q.games === 10 && q.themes.length === 10 && q.facs.join() === 'sancta,veerwell',
        `rts-matchup.js 的參數（--dry，不跑）：${q ? `${q.games} 局、主題 ${q.themes.length} 個、陣營 ${q.facs.join('／')}` : out.slice(0, 120)}`,
      );
    }
  }

  return { testRtsAiDiff };
};
