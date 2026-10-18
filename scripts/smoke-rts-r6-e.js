// Coral 戰爭（RTS）R6 E 包（收尾的介面，docs/rts-design.md 17.6、17.14）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-r6-e')(H)。
// testRtsFinish：
//   1. 選單：地圖大小（小／中、預覽的鍵帶大小）、主題的下拉（RTS_THEMES 全部）、難度說明、電腦陣營的說明、說明頁（4 個分頁、
//      手把 LB／RB 換分頁、B 關閉）；
//   2. 提示卡：開局卡暫停（state 'pause'＋#rtsTipCard）與手把 B 關閉、同陣營第二局不再出現、情境提示（每種一次、8 秒收起、
//      rubicon_rts_tips）、設定的提示開關與重設；
//   3. 設定（設定畫面的 #rtsSetBox）：邊緣捲動的開關與速度、方向鍵速度、血條模式（all／hurt／sel 畫的血條數）、管家的預設；
//   4. 揭露倒數的顯示（rtsRevealInfo）、停擺的黃字（面板、卡片、排下去的提示）、殘影的說明（Coral、零件、n 秒前）；
//   5. 多選：循環生產一起切換、右鍵與集結點卡片一起設、兩位英雄 Tab 換技能卡、有目標的技能給最近的一台、改裝一起；
//   6. 投降（暫停選單的按鈕、uiConfirm、R.over.surrender、戰績記敗）→ 結果畫面（兩張圖、投降標示、手把）→ 再來一場（同設定、新種子）；
//   7. 三種大小的截圖 rts-r6-{menu,end,tips}-{1920,1180,844}.png（版面不超出畫面）。
// 電腦不動（g.rtsAiOff）；主迴圈停住，以 rtsSim 快轉、__pump（g.loop）推進到結果畫面。
/* global window, document, localStorage, innerWidth, innerHeight */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  // 頁面裡的工具
  const TOOLS = () => {
    const g = window.__game;
    g.rtsAiOff = true;
    g.rtsPathMs = Infinity;
    window.__sim = (sec, until, dt = 1 / 20) => {
      let t = 0;
      for (; t < sec; t += dt) {
        if (until && until()) return t;
        g.rtsSim(dt);
      }
      return until && !until() ? -1 : t;
    };
    // 鏡頭＋HUD 一格（不模擬）
    window.__tick = (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) {
        g.lastT = performance.now() + Math.random();
        g.rtsHudDirty = true;
        if (g.rts && g.rts.ui && g.rtsHudTick) g.rtsHudTick(dt);
        else if (g.rts) g.rtsCamUpdate(dt);
      }
    };
    window.__start = (cfg) => {
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
        ...cfg,
      });
      if (g.lodFrom) g.lodFrom.set(0, 0, 0);
      const R = g.rts;
      R.teams[0].ore = R.teams[0].coral = 50000;
      R.teams[0].parts = 500;
      g.rtsCamUpdate(1 / 60); // 建立 R.ui
      return R;
    };
    window.__of = (team, def) => g.rts.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
    window.__put = (team, def) => {
      const p = g.rtsAutoSpot(team, def);
      return p ? g.rtsSpawnBld(team, def, p.x, p.z, 0, 1) : null;
    };
    window.__near = (team, def, dx, dz) => {
      const hq = g.rts.units.find((e) => e.rtsTeam === team && e.bld && !e.dead);
      return g.rtsSpawn(team, def, hq.pos.x + dx, hq.pos.z + dz);
    };
  };
  async function open(page, base) {
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    await page.evaluate(() => {
      for (const k of ['rubicon_rts', 'rubicon_rts_tips', 'rubicon_rts_rec']) localStorage.removeItem(k);
    });
    await page.evaluate(TOOLS);
  }
  // 版面：畫面上的 .screen.on 的 panel 不超出左右、沒有橫向捲動
  const layout = (sel) =>
    window.__game &&
    (() => {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, why: '沒有 ' + sel };
      const r = el.getBoundingClientRect();
      return {
        ok:
          r.left >= -0.5 && r.right <= innerWidth + 0.5 && document.documentElement.scrollWidth <= innerWidth,
        why: `${Math.round(r.left)}～${Math.round(r.right)}／${innerWidth}`,
      };
    })();

  async function testRtsFinish(browser, base) {
    console.log('Coral 戰爭 R6：選單、說明、提示卡、設定、投降、結果畫面、多選（E 包）');
    const { ctx, page } = await newPage(browser, 'rtsFinish');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await open(page, base);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 1. 選單 ----------
    const m1 = await ev(() => {
      const g = window.__game;
      g.rtsMenuOpen();
      const $ = (id) => document.getElementById(id);
      const o = {
        state: g.state,
        sizes: [...$('rtsSize').options].map((x) => x.value),
        themes: $('rtsTheme').options.length,
        desc0: $('rtsMenu').querySelector('.rtsDiffDesc').textContent,
        ai: ($('rtsMenu').querySelector('.rtsAiStyle') || {}).textContent || '',
      };
      $('rtsDiff').value = 'insane';
      $('rtsDiff').onchange({ target: $('rtsDiff') });
      o.desc1 = $('rtsMenu').querySelector('.rtsDiffDesc').textContent;
      $('rtsSize').value = '300';
      $('rtsSize').onchange({ target: $('rtsSize') });
      o.size = g.rtsPrefs.size;
      o.key = g.rtsKeyOf(g.rtsPrefs);
      o.saved = JSON.parse(localStorage.getItem('rubicon_rts')).size;
      return o;
    });
    const nThemes = await ev(() => document.querySelectorAll('#rtsTheme option').length);
    check(
      m1.state === 'rtsmenu' && m1.sizes.join() === '300,400' && nThemes >= 7,
      `選單：地圖大小 ${m1.sizes.join('／')}、主題 ${nThemes} 個`,
    );
    check(
      /7 分鐘/.test(m1.desc0) === false && /全地圖/.test(m1.desc1) && m1.desc0.length > 4 && m1.ai.length > 2,
      `難度說明（普通「${m1.desc0}」→ 瘋狂「${m1.desc1}」）、電腦陣營的說明（${m1.ai}）`,
    );
    check(
      m1.size === 300 && /\|300$/.test(m1.key) && m1.saved === 300,
      `大小改成小：預覽的鍵 ${m1.key}、記住大小`,
    );
    await page
      .waitForFunction(() => /\|300$/.test(window.__game.rtsPrevKey || ''), null, { timeout: 30000 })
      .catch(() => {});
    const pv = await ev(() => ({
      key: window.__game.rtsPrevKey,
      info: document.getElementById('rtsPrevInfo').textContent,
    }));
    check(/\|300$/.test(pv.key || '') && /小/.test(pv.info), `小地圖的預覽（${pv.key}：${pv.info}）`);
    // 說明頁
    const hp = await ev(() => {
      const g = window.__game;
      document.getElementById('rtsHelpBtn').click();
      const el = document.getElementById('rtsHelp');
      const o = { on: !el.hidden, tabs: el.querySelectorAll('[data-ht]').length, tab0: g.rtsHelpTab };
      const C = g.padUiCands();
      o.cands = C.length;
      o.inHelp = C.every((c) => el.contains(c.el));
      g.padUiTab(1);
      o.tab1 = g.rtsHelpTab;
      g.padUiTab(1);
      o.type = !!el.querySelector('.rtsHelpType');
      g.padUiTab(1);
      o.fac = el.querySelectorAll('.rtsHow').length;
      return o;
    });
    check(
      hp.on && hp.tabs === 4 && hp.tab1 === 'res' && hp.type && hp.fac >= 4 && hp.cands > 0 && hp.inHelp,
      `說明頁：4 個分頁、RB 換分頁（${hp.tab0} → ${hp.tab1}）、相剋表、四個陣營、手把只選得到說明頁裡的（${hp.cands} 個）`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-help-1920.png') });
    const hb = await ev(() => {
      const g = window.__game;
      g.padUiBack();
      return { hidden: document.getElementById('rtsHelp').hidden, state: g.state };
    });
    check(hb.hidden && hb.state === 'rtsmenu', '手把 B：關閉說明頁、留在選單');
    await ev(() => {
      const $ = (id) => document.getElementById(id);
      $('rtsSize').value = '400';
      $('rtsSize').onchange({ target: $('rtsSize') });
      $('rtsDiff').value = 'normal';
      $('rtsDiff').onchange({ target: $('rtsDiff') });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-menu-1920.png') });
    const lm = await ev(layout, '#rtsMenu .rtsMenuPanel');
    check(lm.ok, `1920×1080：選單不超出畫面（${lm.why}）`);

    // ---------- 2. 提示卡 ----------
    const tp = await ev(() => {
      const g = window.__game;
      g.rtsTipsTest = true;
      window.__start({});
      window.__tick(2);
      const o = {
        state: g.state,
        card: document.getElementById('rtsTipCard').classList.contains('on'),
        txt: document.getElementById('rtsTipCard').textContent.replace(/\s+/g, ' ').slice(0, 80),
        seen: JSON.parse(localStorage.getItem('rubicon_rts_tips') || '[]'),
      };
      const C = g.padUiCands();
      o.go = C.some((c) => c.el.id === 'rtsTipGo');
      o.def = (g.padUiDefault(C) || {}).id;
      return o;
    });
    check(
      tp.state === 'pause' && tp.card && tp.seen.includes('open_castron') && /怎麼開始/.test(tp.txt) && tp.go,
      `開局卡：暫停、陣營特色與怎麼開始、手把選得到「開始」（${tp.txt.slice(0, 40)}…）`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-tips-1920.png') });
    const tc = await ev(() => {
      const g = window.__game;
      g.padUiBack();
      return { state: g.state, card: document.getElementById('rtsTipCard').classList.contains('on') };
    });
    check(tc.state === 'rts' && !tc.card, '手把 B：關閉開局卡、回到局內');
    const tp2 = await ev(() => {
      const g = window.__game;
      window.__start({ seed: 8 });
      g.state = 'rts';
      window.__tick(2);
      return g.state;
    });
    check(tp2 === 'rts', '同一個陣營的第二局沒有開局卡');
    // 情境提示：閒置工人（R.t > 30）
    const hi = await ev(() => {
      const g = window.__game,
        R = g.rts;
      R.t = 40;
      for (const w of window.__of(0, 'c_worker'))
        g.rtsSetOrders ? g.rtsSetOrders(w, []) : (w.orders.length = 0);
      window.__tick(1, 0.6);
      const el = document.getElementById('rtsHint');
      const o = {
        on: el.classList.contains('on'),
        id: el.dataset.id,
        seen: JSON.parse(localStorage.getItem('rubicon_rts_tips') || '[]'),
        again: g.rtsTipsNote('idle'),
      };
      // 8 秒收起（換下一張或收起）
      R.tips.hideAt = performance.now() - 1;
      const first = R.tips.cur;
      window.__tick(1, 0.01);
      o.next = R.tips.cur !== first;
      return o;
    });
    check(
      hi.on && hi.seen.includes('idle') && hi.again === false && hi.next,
      `情境提示：閒置工人（第一張 ${hi.id}、看過 ${hi.seen.join('、')}）、同一種不再顯示、時間到換下一張`,
    );

    // ---------- 3. 設定 ----------
    const st = await ev(() => {
      const g = window.__game,
        R = g.rts;
      g.state = 'pause';
      g.showScreen('pause');
      g.openSettings('pause');
      const box = document.getElementById('rtsSetBox');
      const o = { n: box.querySelectorAll('select, input, button').length };
      const C = R.cam,
        ui = R.ui;
      // 邊緣捲動：滑鼠在左邊緣
      const move = () => {
        const x0 = C.x,
          z0 = C.z;
        g.state = 'rts';
        ui.mouseIn = true;
        ui.mx = 0;
        ui.my = innerHeight / 2;
        const hf = document.hasFocus;
        document.hasFocus = () => true;
        g.lastT = performance.now() + Math.random();
        g.rtsCamUpdate(0.1);
        document.hasFocus = hf;
        g.state = 'settings';
        const d = Math.hypot(C.x - x0, C.z - z0);
        C.x = x0;
        C.z = z0;
        return d;
      };
      g.rtsCamJump(0, 0);
      o.d1 = move();
      const sp = document.getElementById('rtsSetEdgeSp');
      sp.value = '2';
      sp.onchange({ target: sp });
      o.d2 = move();
      const ed = document.getElementById('rtsSetEdge');
      ed.checked = false;
      ed.onchange({ target: ed });
      o.d0 = move();
      o.saved = (JSON.parse(localStorage.getItem('rubicon_rts')).set || {}).edge;
      ed.checked = true;
      ed.onchange({ target: ed });
      // 血條：畫的血條數（hctx.fillRect 的次數）
      const bars = (mode) => {
        const s = document.getElementById('rtsSetBars');
        s.value = mode;
        s.onchange({ target: s });
        const c = g.hctx,
          f = c.fillRect;
        let n = 0;
        c.fillRect = function (...a) {
          n++;
          return f.apply(this, a);
        };
        g.rtsDrawOverlay();
        c.fillRect = f;
        return n;
      };
      R.sel = [];
      g.rtsCamJump(window.__of(0, 'c_hq')[0].pos.x, window.__of(0, 'c_hq')[0].pos.z);
      g.rtsCamUpdate(0.01);
      o.bAll = bars('all');
      o.bHurt = bars('hurt');
      o.bSel = bars('sel');
      bars('hurt');
      // 管家的預設
      const bk = box.querySelector('[data-bk="loop"]');
      bk.checked = false;
      bk.onchange();
      o.butler = (JSON.parse(localStorage.getItem('rubicon_rts')).butler || {}).loop;
      o.rb = R.butler ? R.butler.loop : null;
      bk.checked = true;
      bk.onchange();
      // 提示的開關與重設
      const tb = document.getElementById('rtsSetTips');
      tb.checked = false;
      tb.onchange({ target: tb });
      o.tipsOff = !g.rtsTipsOn();
      tb.checked = true;
      tb.onchange({ target: tb });
      document.getElementById('rtsSetTipsReset').click();
      o.reset = JSON.parse(localStorage.getItem('rubicon_rts_tips') || '[]').length;
      g.closeSettings();
      o.back = g.state;
      return o;
    });
    check(
      st.n >= 10 && st.d1 > 0 && st.d2 > st.d1 * 1.6 && st.d0 === 0 && st.saved === false,
      `設定：邊緣捲動（×1 ${st.d1.toFixed(1)} m、×2 ${st.d2.toFixed(1)} m、關掉 ${st.d0} m，存在 rubicon_rts.set）`,
    );
    check(
      st.bAll > st.bHurt && st.bHurt >= st.bSel,
      `血條模式：全部 ${st.bAll}／受傷或選取 ${st.bHurt}／只有選取 ${st.bSel}（畫的次數）`,
    );
    check(
      st.butler === false && st.tipsOff && st.reset === 0 && st.back === 'pause',
      `管家的預設（loop ${st.butler}）、提示的開關與重設、返回暫停選單`,
    );

    // ---------- 4. 揭露倒數、停擺、殘影 ----------
    const rv = await ev(() => {
      const g = window.__game;
      g.state = 'rts';
      const orig = Object.prototype.hasOwnProperty.call(g, 'rtsRevealInfo') ? g.rtsRevealInfo : undefined;
      const out = {};
      g.rtsRevealInfo = (t) => (t === 0 ? { left: 87.2, on: false } : { left: 0, on: false });
      g.rtsResDraw();
      out.mine = document.getElementById('rtsReveal').textContent;
      g.rtsRevealInfo = (t) => (t === 1 ? { left: 0, on: true } : { left: 0, on: false });
      g.rtsResDraw();
      out.foe = document.getElementById('rtsReveal').textContent;
      g.rtsRevealInfo = () => ({ left: 0, on: false });
      g.rtsResDraw();
      out.none = document.getElementById('rtsReveal').hidden;
      // 揭露的位置：小地圖與畫面上的標記（迷霧裡的才標）
      const op = Object.prototype.hasOwnProperty.call(g, 'rtsRevealPts') ? g.rtsRevealPts : undefined;
      const hq1 = g.rts.units.find((e) => e.rtsTeam === 1 && e.bld);
      g.rtsRevealPts = () => [
        { id: hq1.id, team: 1, x: hq1.pos.x, z: hq1.pos.z, bld: true, def: hq1.rtsDef },
      ];
      out.pts = g.rtsHudRevealPts().length;
      g.rtsMiniDraw();
      g.rtsDrawOverlay();
      if (op === undefined) delete g.rtsRevealPts;
      else g.rtsRevealPts = op;
      if (orig === undefined) delete g.rtsRevealInfo;
      else g.rtsRevealInfo = orig;
      out.real = typeof g.rtsRevealInfo === 'function';
      return out;
    });
    check(
      /88 秒後暴露位置/.test(rv.mine) && /敵方主堡全毀/.test(rv.foe) && rv.none && rv.pts === 1,
      `揭露倒數：「${rv.mine}」「${rv.foe}」、沒有時隱藏、迷霧裡的位置標記 ${rv.pts} 個（A 包的 rtsRevealInfo ${rv.real ? '有' : '還沒有'}）`,
    );
    const sl = await ev(() => {
      const g = window.__game;
      window.__start({ faction: 'aetheric', seed: 11, theme: 'snow' });
      g.state = 'rts';
      const b = window.__put(0, 'a_lab');
      if (!b) return { err: '放不下生體培養槽' };
      b.bld.off = true;
      g.rtsSetSel([b]);
      window.__tick(1);
      g.rtsPanelDraw();
      const panel = document.getElementById('rtsPanel').textContent;
      const items = g.rtsCardItems().filter((it) => it && it.stall);
      const tr = g.rtsCardItems().find((it) => it && it.c.act && it.c.act.k === 'train');
      g.rtsTrain([b], tr.c.act.id);
      const msg = document.getElementById('rtsMsg').textContent;
      return { panel, stall: items.length, msg, q: b.bld.queue.length };
    });
    check(
      !sl.err &&
        /停擺中：生產暫停，接上導管後繼續/.test(sl.panel) &&
        sl.stall > 0 &&
        /停擺中/.test(sl.msg) &&
        sl.q === 1,
      `停擺的黃字：面板、卡片 ${sl.stall} 格、排下去時提示（${sl.err || sl.msg}）`,
    );
    const wk = await ev(() => {
      const g = window.__game;
      const R = window.__start({ faction: 'sancta', seed: 8, theme: 'flooded' });
      g.state = 'rts';
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.bld);
      const w = g.rtsWreckSpawn(hq.pos.x + 14, hq.pos.z, { ore: 80, coral: 12, parts: 6 });
      if (!w) return { err: '沒有殘骸' };
      g.rtsFogTick(0.3);
      g.rtsFogTick(0.3);
      g.rtsHudWreckSeen();
      const fs = g.rtsFogState;
      g.rtsFogState = (t, x, z) => (x === w.x && z === w.z ? 1 : fs.call(g, t, x, z));
      R.t += 25;
      const lines = g.rtsHudWreckLines(w)[1].join('／');
      delete g.rtsFogState;
      return { lines };
    });
    check(
      !wk.err && /Coral 12/.test(wk.lines) && /零件 6/.test(wk.lines) && /25 秒前看到/.test(wk.lines),
      `殘影的說明：${wk.err || wk.lines}`,
    );

    // ---------- 5. 多選 ----------
    const ms = await ev(() => {
      const g = window.__game;
      const R = window.__start({ seed: 7 });
      g.state = 'rts';
      const o = {};
      const f1 = window.__put(0, 'c_factory'),
        f2 = window.__put(0, 'c_factory'),
        dp = window.__put(0, 'c_depot');
      // 循環生產（同種）
      g.rtsSetSel([f1, f2]);
      R.ui.sub = 0;
      const lp = g.rtsCardItems().find((it) => it && it.c.act && it.c.act.k === 'loop');
      lp.act(false);
      o.loop = !!(f1.bld.loop && f2.bld.loop);
      // 右鍵：選取的建築一起設集結點（不同種也一起）
      g.rtsSetSel([f1, f2, dp]);
      g.rtsRightAt(f1.pos.x + 20, f1.pos.z + 20, null, false);
      o.rally = [f1, f2].every((b) => b.bld.rally && Math.abs(b.bld.rally.x - (f1.pos.x + 20)) < 0.1);
      // 集結點卡片（子群組＝兵工廠）：選取中的建築一起設
      f1.bld.rally = f2.bld.rally = null;
      R.ui.sub = g.rtsSubgroups().findIndex((G) => G[0] === f1 || G[0] === f2);
      g.rtsSetMode({ k: 'target', order: 'rally', target: 'any', label: '集結點' });
      g.rtsModeAt(f1.pos.x - 15, f1.pos.z + 5, null, false);
      o.rally2 = !!(f1.bld.rally && f2.bld.rally);
      // 兩位英雄：Tab 換技能卡
      const h1 = window.__near(0, 'h_bastion', 8, 8),
        h2 = window.__near(0, 'h_rain', 10, 8);
      g.rtsSetSel([h1, h2]);
      R.ui.sub = 0;
      const lbl = () =>
        g
          .rtsCardItems()
          .filter(Boolean)
          .map((it) => it.label)
          .join(',');
      const a0 = g.rtsActiveGroup()[0];
      const c0 = lbl();
      g.rtsKey({ code: 'Tab', shiftKey: false, preventDefault() {}, stopImmediatePropagation() {} });
      const a1 = g.rtsActiveGroup()[0];
      const c1 = lbl();
      o.heroes = a0 !== a1 && c0 !== c1 && !!a0.rtsDef && !!a1.rtsDef;
      // 有目標的技能：三台叉架 MT，給最近、沒在冷卻的一台
      const fk = [0, 1, 2].map((i) => window.__near(0, 'c_forklift', 12 + i * 6, -12));
      g.rtsSetSel(fk);
      R.ui.sub = 0;
      g.rtsSetMode({ k: 'target', order: 'ability', ab: 'ab_crate', target: 'point', label: '投擲貨櫃' });
      const tx = fk[0].pos.x - 10,
        tz = fk[0].pos.z;
      g.rtsModeAt(tx, tz, null, false);
      const got = fk.filter((u) => u.orders[0] && u.orders[0].k === 'ability');
      o.ab = got.length === 1 && got[0] === fk[0];
      o.abN = got.length;
      return o;
    });
    check(ms.loop, '多選同種建築：循環生產一起切換');
    check(ms.rally && ms.rally2, '多選建築：右鍵與集結點卡片一起設集結點');
    check(ms.heroes, '兩位英雄：Tab 換子群組，技能卡跟著換');
    check(ms.ab, `有目標的技能：多選時給最近的一台（${ms.abN} 台接到）`);
    const rf = await ev(() => {
      const g = window.__game;
      const R = window.__start({ faction: 'sancta', seed: 8, theme: 'flooded' });
      g.state = 'rts';
      const shop = window.__put(0, 's_shop');
      if (!shop) return { err: '放不下改裝工坊' };
      const us = [0, 1].map((i) => g.rtsSpawn(0, 's_militia', shop.pos.x + 6 + i * 2, shop.pos.z + 6));
      g.rtsSetSel(us);
      R.ui.sub = 0;
      g.rtsCardAct({ act: { k: 'refit', rf: 'rf_plate' } }, us, false);
      return { n: us.filter((u) => u.rtsRefitTo || u.rtsRefit === 'rf_plate').length };
    });
    check(!rf.err && rf.n === 2, `多選的改裝：兩台一起（${rf.err || rf.n + ' 台'}）`);

    // ---------- 6. 投降 → 結果畫面 → 再來一場 ----------
    const sr = await ev(() => {
      const g = window.__game;
      g.rtsTipsTest = false;
      const R = window.__start({ seed: 21, diff: 'hard' });
      g.state = 'rts';
      // 3 分鐘：每秒跑一次 HUD（結果圖的取樣、升階與英雄的事件）
      for (let s = 0; s < 180; s++) {
        window.__sim(1);
        g.lastT = performance.now() + Math.random();
        g.rtsHudTick(1 / 60);
      }
      g.rtsPause();
      const b = document.getElementById('btnRtsSurr');
      const o = {
        btn: !!b && b.style.display !== 'none' && document.getElementById('pause').classList.contains('on'),
      };
      b.click();
      o.modal = !!g.uiModalOn;
      const yes = document.querySelector('#uiModal [data-um="1"]');
      yes.click();
      o.over = !!(R.over && !R.over.win && R.over.surrender);
      o.rec = JSON.parse(localStorage.getItem('rubicon_rts_rec') || '{}')['castron-castron-hard'];
      o.tl = g.rtsMenuTl().pts.length;
      window.__pump(6, () => g.state === 'rtsend', 1 / 20);
      o.state = g.state;
      const el = document.getElementById('rtsEnd');
      o.title = document.getElementById('rtsEndTitle').textContent;
      o.canvas = el.querySelectorAll('canvas').length;
      // 圖上有畫東西（不透明的像素）
      o.ink = [...el.querySelectorAll('canvas')].map((cv) => {
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      });
      const C = g.padUiCands();
      o.def = (g.padUiDefault(C) || {}).id;
      o.surBtn = document.getElementById('btnRtsSurr').style.display;
      return o;
    });
    check(sr.btn && sr.modal && sr.over, '暫停選單的投降：uiConfirm 確定 → 敗、R.over.surrender');
    check(sr.rec && sr.rec.l === 1, `投降照樣記敗（${JSON.stringify(sr.rec)}）`);
    check(
      sr.state === 'rtsend' &&
        /投降/.test(sr.title) &&
        sr.canvas === 2 &&
        sr.ink.every((n) => n > 200) &&
        sr.tl >= 5,
      `結果畫面：「${sr.title}」、兩張圖（${sr.ink.join('、')} 個像素、${sr.tl} 筆取樣）`,
    );
    check(
      sr.def === 'rtsEndAgain' && sr.surBtn === 'none',
      `結果畫面的手把預設焦點＝再來一場（${sr.def}）、投降按鈕收起`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-end-1920.png') });
    const lg = await ev(() => {
      const g = window.__game;
      const seed0 = g.rts.cfg.seed;
      document.getElementById('rtsEndAgain').click();
      const R = g.rts;
      return {
        state: g.state,
        same:
          !!R &&
          R.cfg.diff === 'hard' &&
          R.cfg.theme === 'wasteland' &&
          R.cfg.size === 400 &&
          R.cfg.faction === 'castron',
        seed: !!R && R.cfg.seed !== seed0,
      };
    });
    check(lg.state === 'rts' && lg.same && lg.seed, '再來一場：同樣的陣營、難度、主題、大小，新的種子');
    await ctx.close();

    // ---------- 7. 三種大小的截圖 ----------
    for (const [w, h, tag, touch] of [
      [1180, 820, '1180', false],
      [844, 390, '844', true],
    ]) {
      const c2 = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: touch,
        isMobile: touch,
      });
      const pg = await c2.newPage();
      if (H.watch) H.watch(pg, 'rtsFinish-' + tag);
      await open(pg, base);
      await pg.evaluate(() => window.__game.rtsMenuOpen());
      await pg.waitForFunction(
        () => (document.getElementById('rtsPrevImg').src || '').startsWith('data:image'),
        null,
        {
          timeout: 30000,
        },
      );
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r6-menu-${tag}.png`) });
      const l1 = await pg.evaluate(layout, '#rtsMenu .rtsMenuPanel');
      const go = await pg.evaluate(() => {
        const b = document.getElementById('rtsGo');
        b.scrollIntoView({ block: 'nearest' });
        const r = b.getBoundingClientRect();
        return r.bottom <= innerHeight + 0.5 && r.top >= 0;
      });
      await pg.evaluate(() => document.getElementById('rtsHelpBtn').click());
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r6-help-${tag}.png`) });
      const l2 = await pg.evaluate(layout, '#rtsHelp .rtsHelpPanel');
      await pg.evaluate(() => {
        const g = window.__game;
        g.rtsMenuHelp(false);
        g.rtsTipsTest = true;
        window.__start({});
        window.__tick(2);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r6-tips-${tag}.png`) });
      const l3 = await pg.evaluate(layout, '#rtsTipCard .rtsTipPanel');
      await pg.evaluate(() => {
        const g = window.__game;
        g.resume();
        for (let s = 0; s < 90; s++) {
          window.__sim(1);
          g.lastT = performance.now() + Math.random();
          g.rtsHudTick(1 / 60);
        }
        g.rtsEnd(false);
        window.__pump(6, () => g.state === 'rtsend', 1 / 20);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r6-end-${tag}.png`) });
      const l4 = await pg.evaluate(layout, '#rtsEnd .rtsEndPanel');
      check(
        l1.ok && go && l2.ok && l3.ok && l4.ok,
        `${w}×${h}${touch ? ' 觸控' : ''}：選單（${l1.why}）、開始按鈕捲得到、說明頁、開局卡、結果畫面不超出畫面`,
      );
      await c2.close();
    }
  }

  return { testRtsFinish };
};
