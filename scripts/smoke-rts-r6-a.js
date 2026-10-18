// Coral 戰爭（RTS）R6 A 包（平衡與核心，docs/rts-design.md 17.5、17.6）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-r6-a')(H)。
// testRtsBalance：不開瀏覽器：平衡腳本（scripts/rts-balance.js）的 run({ check: true })：資料檔都能在 node 載入、四個陣營的
//   單位都有表、--check 沒有超出範圍的項目（留著的有原因）、經濟模擬 20 分鐘沒有負的資源或 NaN、耗時 < 10 秒。
// testRtsEnd：投降（uiConfirm → rtsSurrender：敗、戰績、R.over.surrender）；沒有主堡時的揭露（拆光主堡 → 120 秒倒數 →
//   對方拿得到位置、沒有視野；重新蓋好主堡取消）；時間軸（R.timeline 每 30 秒、升階與英雄陣亡的事件）；殘骸被爆發攻擊炸散
//   （−15%、1 秒一次、最少 30%、地圖殘骸不變、實彈不影響、看過的才算、爆發的投射物）；17.2 #7 的說明文字。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim＋rtsFogTick 快轉。
/* global window, document, THREE, localStorage */
const pathM = require('path');
const { pathToFileURL } = require('url');

module.exports = (H) => {
  const { check, newPage, freezeLoop } = H;

  async function testRtsBalance() {
    console.log('Coral 戰爭：靜態平衡（scripts/rts-balance.js --check）');
    const t0 = Date.now();
    const B = require('./rts-balance.js');
    let out = null,
      err = null;
    try {
      out = await B.run({ check: true, json: false });
    } catch (e) {
      err = e;
    }
    check(!err && !!out, `平衡腳本執行（資料檔都能在 node 載入）${err ? '：' + err.message : ''}`);
    if (!out) return;
    const facs = ['castron', 'aetheric', 'veerwell', 'sancta'];
    const per = facs.map((f) => Object.values(out.units).filter((u) => u.faction === f && !u.support).length);
    check(
      per.every((n) => n >= 3),
      `四個陣營的戰鬥單位都有表：${per.join('／')}`,
    );
    check(
      out.fail.length === 0,
      `--check 沒有超出範圍的項目（${out.checks.length} 項、留著 ${out.kept.length}）` +
        (out.fail.length
          ? '：' +
            out.fail
              .slice(0, 4)
              .map((c) => c.msg)
              .join('；')
          : ''),
    );
    check(
      out.kept.every((c) => typeof c.keep === 'string' && c.keep.length > 8),
      '留著的項目都寫了原因',
    );
    const econ = Object.entries(out.econ);
    const okEcon = econ.every(
      ([, E]) =>
        !E.bad.length &&
        E.inc.length >= 20 &&
        E.inc.every((r) => Number.isFinite(r.ore) && Number.isFinite(r.coral) && r.ore >= 0 && r.coral >= 0),
    );
    check(
      okEcon,
      `經濟模擬 20 分鐘沒有負的資源或 NaN（${econ.map(([f, E]) => f + ' ' + Math.round(E.inc5)).join('、')}）`,
    );
    check(
      facs.every((f) => Number.isFinite(out.econ[f].t2) && Number.isFinite(out.econ[f].t3)),
      `四個陣營都升到 T3（${facs.map((f) => f + ' ' + Math.round(out.econ[f].t2) + '／' + Math.round(out.econ[f].t3)).join('、')}）`,
    );
    const ms = Date.now() - t0;
    check(ms < 10000, `平衡腳本耗時 ${ms} ms（< 10 秒）`);
  }

  async function testRtsEnd(browser, base) {
    console.log('Coral 戰爭：投降、沒有主堡時的揭露、時間軸、殘骸被爆發攻擊炸散（R6 A）');
    const { ctx, page } = await newPage(browser, 'rtsEnd');
    await page.setViewportSize({ width: 1280, height: 800 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    await ev(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsCampsOff = true;
      window.__start = (fa, fb, seed = 7) => {
        g.rtsPathMs = Infinity;
        g.rtsStart({ theme: 'wasteland', seed, size: 400, faction: fa, aiFaction: fb, diff: 'normal' });
        return g.rts;
      };
      window.__sim = (sec, dt = 1 / 10) => {
        for (let t = 0; t < sec; t += dt) {
          g.rtsSim(dt);
          g.rtsFogTick(dt);
        }
      };
      window.__kill = (e) => {
        e.hp = 0;
        e.die(null);
      };
      window.__bld = (team, def, x, z) => {
        const D = g.rtsUiDef ? g.rtsUiDef(def) : null;
        const f = D ? D.foot : [8, 8];
        for (let r = 0; r <= 60; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (g.world.nav.buildable(px, pz, f[0] + 2, f[1] + 2))
              return g.rtsSpawnBld(team, def, px, pz, 0, 1);
            if (r === 0) break;
          }
        return null;
      };
    });

    // ---------- 投降 ----------
    const sur = await ev(() => {
      const g = window.__game;
      try {
        localStorage.removeItem('rubicon_rts_rec');
      } catch (e) {}
      const R = window.__start('castron', 'castron');
      window.__sim(2);
      g.rtsPause();
      const paused = g.state;
      g.uiConfirm('投降？', () => g.rtsSurrender(), '投降', '取消');
      const btn = document.querySelector('#uiModal [data-um="1"]');
      if (btn) btn.click();
      let rec = null;
      try {
        rec = JSON.parse(localStorage.getItem('rubicon_rts_rec'));
      } catch (e) {}
      const r = {
        paused,
        state: g.state,
        over: R.over && { win: R.over.win, surrender: R.over.surrender },
        rec: rec && rec['castron-castron-normal'],
        tl: R.timeline.length,
        again: g.rtsSurrender(),
      };
      return r;
    });
    check(
      sur.paused === 'pause' &&
        sur.state === 'rts' &&
        sur.over &&
        sur.over.win === false &&
        sur.over.surrender === true,
      `投降：暫停選單 → uiConfirm → 敗、R.over.surrender（${JSON.stringify(sur.over)}、狀態 ${sur.state}）`,
    );
    check(sur.rec && sur.rec.l === 1 && sur.rec.w === 0, `投降的戰績記敗（${JSON.stringify(sur.rec)}）`);
    check(sur.tl >= 1 && sur.again === false, `結束時有時間軸的最後一筆（${sur.tl}）、結束後不能再投降`);

    // ---------- 時間軸、沒有主堡時的揭露 ----------
    const rv = await ev(() => {
      const g = window.__game;
      const R = window.__start('castron', 'castron');
      const o = {};
      window.__sim(65);
      o.tl = R.timeline.map((x) => x.t);
      const s0 = R.timeline[R.timeline.length - 1].s[0];
      o.keys = Object.keys(s0).join(',');
      o.ore = s0.ore;
      // 電腦這一隊：先放一座補給庫（不然拆了主堡就全滅）
      const hq1 = R.units.find((e) => e.rtsTeam === 1 && e.bld && e.rtsDef === 'c_hq');
      const dep = window.__bld(1, 'c_depot', hq1.pos.x, hq1.pos.z + 26);
      o.dep = !!dep;
      o.info0 = g.rtsRevealInfo(1);
      window.__kill(hq1);
      window.__sim(1);
      o.info1 = g.rtsRevealInfo(1);
      o.mine = g.rtsRevealInfo(0);
      o.over1 = !!R.over;
      window.__sim(60);
      o.info2 = g.rtsRevealInfo(1);
      o.pts2 = g.rtsRevealPts(0).length;
      window.__sim(61);
      o.info3 = g.rtsRevealInfo(1);
      const pts = g.rtsRevealPts(0);
      o.pts3 = pts.length;
      o.ptsBld = pts.filter((p) => p.bld).length;
      o.ptsTeam = pts.every((p) => p.team === 1);
      o.own = g.rtsRevealPts(1).length;
      // 只標位置、不給視野：玩家看不到補給庫那一格
      o.vis = dep ? g.rtsFogState(0, dep.pos.x, dep.pos.z) : -1;
      // 重新蓋好主堡：取消
      const hq = window.__bld(1, 'c_hq', hq1.pos.x, hq1.pos.z);
      o.rebuilt = !!hq;
      window.__sim(1);
      o.info4 = g.rtsRevealInfo(1);
      o.pts4 = g.rtsRevealPts(0).length;
      o.tl2 = R.timeline.length;
      o.dt = R.timeline.length > 2 ? R.timeline[2].t - R.timeline[1].t : 0;
      return o;
    });
    check(
      rv.tl.length >= 3 && rv.tl[0] === 0 && rv.tl.includes(30) && rv.tl.includes(60),
      `時間軸每 30 秒一筆（${rv.tl.join('、')}）`,
    );
    check(
      /ore/.test(rv.keys) &&
        /coral/.test(rv.keys) &&
        /pop/.test(rv.keys) &&
        /str/.test(rv.keys) &&
        /tier/.test(rv.keys) &&
        /heroLv/.test(rv.keys) &&
        rv.ore > 0,
      `時間軸的欄位：${rv.keys}（礦石 ${rv.ore}）`,
    );
    check(rv.dep && rv.info0 === null && rv.mine === null, '有主堡時沒有倒數');
    check(
      rv.info1 && !rv.info1.on && rv.info1.left > 118 && rv.info1.left <= 120 && !rv.over1,
      `拆光主堡（還有補給庫）：開始倒數 ${rv.info1 && rv.info1.left.toFixed(1)} 秒、局還沒結束`,
    );
    check(
      rv.info2 && !rv.info2.on && rv.pts2 === 0,
      `倒數中（剩 ${rv.info2 && rv.info2.left.toFixed(1)} 秒）不揭露`,
    );
    check(
      rv.info3 &&
        rv.info3.on &&
        rv.info3.left === 0 &&
        rv.pts3 > 0 &&
        rv.ptsBld >= 1 &&
        rv.ptsTeam &&
        rv.own === 0,
      `120 秒後揭露：對方拿得到 ${rv.pts3} 個位置（建築 ${rv.ptsBld}），自己這一隊沒有`,
    );
    check(rv.vis !== 2, `揭露只給位置、不給視野（迷霧狀態 ${rv.vis}）`);
    check(rv.rebuilt && rv.info4 === null && rv.pts4 === 0, '重新蓋好主堡：取消揭露');

    // ---------- 時間軸的事件：升階、英雄陣亡 ----------
    const tev = await ev(() => {
      const g = window.__game;
      const R = window.__start('castron', 'castron', 11);
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.bld && e.rtsDef === 'c_hq');
      g.rtsUpgradeDone(hq, 'c_hq2');
      const h = g.rtsSpawn(0, 'h_bastion', hq.pos.x + 20, hq.pos.z + 20, 0);
      if (g.rtsHeroSpawned) g.rtsHeroSpawned(h);
      window.__sim(0.5);
      window.__kill(h);
      window.__sim(0.5);
      return R.timelineEv.map((e) => e.k + ':' + e.team + ':' + e.v);
    });
    check(
      tev.includes('tier:0:2') && tev.includes('hero:0:h_bastion'),
      `時間軸的事件：升階與英雄陣亡（${tev.join('、')}）`,
    );

    // ---------- 殘骸被爆發攻擊炸散 ----------
    const wb = await ev(() => {
      const g = window.__game;
      const R = window.__start('sancta', 'castron', 7);
      const o = {};
      const x = 0,
        z = 0;
      const w = g.rtsWreckSpawn(x, z, { ore: 100, parts: 10 });
      w.coral = 20;
      w.seen |= 2; // 隊伍 1（攻擊方）看過
      const val = () => [
        Math.round(w.ore * 100) / 100,
        Math.round(w.coral * 100) / 100,
        Math.round(w.parts * 100) / 100,
      ];
      o.v0 = val();
      g.rtsSplash(x, z, 6, 10, 0, null, 'exp', 1);
      o.v1 = val();
      g.rtsSplash(x, z, 6, 10, 0, null, 'exp', 1); // 1 秒內第二次：不變
      o.v2 = val();
      g.rtsSplash(x, z, 6, 10, 0, null, 'kin', 1); // 實彈：不變
      window.__sim(1.1);
      g.rtsSplash(x, z, 6, 10, 0, null, 'kin', 1);
      o.v3 = val();
      for (let i = 0; i < 20; i++) {
        window.__sim(1.05);
        g.rtsSplash(x, z, 6, 10, 0, null, 'exp', 1);
      }
      o.v4 = val();
      // 攻擊方沒看過的殘骸：不受影響
      const w2 = g.rtsWreckSpawn(30, -40, { ore: 100, parts: 4 });
      w2.seen &= ~2;
      window.__sim(1.1);
      g.rtsSplash(30, -40, 6, 10, 0, null, 'exp', 1);
      o.unseen = w2.ore;
      // 地圖殘骸：不受影響
      const m = R.wrecks.find((q) => q.map && q.ore > 0);
      o.map0 = m ? m.ore : -1;
      if (m) {
        m.seen |= 2;
        g.rtsSplash(m.x, m.z, 8, 10, 0, null, 'exp', 1);
      }
      o.map1 = m ? m.ore : -1;
      // 爆發的投射物（迫擊砲 MT）與實彈的投射物
      const w3 = g.rtsWreckSpawn(-30, 40, { ore: 100, parts: 4 });
      w3.seen |= 2;
      const mortar = g.rtsSpawn(1, 'c_mortar', -50, 40, 0);
      const mt = g.rtsSpawn(1, 'c_mt', -50, 44, 0);
      const pos = new THREE.Vector3(-30, 0, 40);
      const wid = (s, e) => e.weapons[s] && e.weapons[s].def && e.weapons[s].def.id;
      g.rtsProjBlast({ splash: 4, pos, owner: mt, wid: wid('rarm', mt) });
      o.pk = w3.ore;
      g.rtsProjBlast({ splash: 4, pos, owner: mortar, wid: wid('rback', mortar) });
      o.pe = w3.ore;
      return o;
    });
    check(
      wb.v1[0] === 85 && wb.v1[1] === 17 && wb.v1[2] === 8.5,
      `爆發攻擊：殘骸價值 −15%（礦石／Coral／零件 ${wb.v0.join('／')} → ${wb.v1.join('／')}）`,
    );
    check(wb.v2[0] === 85, `同一個殘骸 1 秒內只炸一次（${wb.v2[0]}）`);
    check(wb.v3[0] === 85, `實彈的範圍攻擊不影響（${wb.v3[0]}）`);
    check(wb.v4[0] === 30 && wb.v4[2] === 3, `最少留原價值的 30%（${wb.v4.join('／')}）`);
    check(wb.unseen === 100, `攻擊方沒看過的殘骸不受影響（${wb.unseen}）`);
    check(wb.map0 > 0 && wb.map1 === wb.map0, `地圖殘骸不受影響（${wb.map0} → ${wb.map1}）`);
    check(wb.pk === 100 && wb.pe === 85, `投射物：實彈不影響、爆發（迫擊砲）−15%（${wb.pk} → ${wb.pe}）`);

    // ---------- 17.2 #7：SIROCCO 的迴避、COUNTDOWN 的長程導彈的說明 ----------
    const H6 = await import(pathToFileURL(pathM.join(__dirname, '..', 'src', 'data', 'rts-heroes.js')).href);
    const ev7 = H6.RTS_SKILLS.sk_evade.desc,
      lm = H6.RTS_SKILLS.sk_longms.desc;
    check(/受到的傷害/.test(ev7) && /所有武器的射程/.test(lm), `說明文字：迴避「${ev7}」、長程導彈「${lm}」`);

    await ev(() => window.__game.clearMission());
    await ctx.close();
  }

  return { testRtsBalance, testRtsEnd };
};
