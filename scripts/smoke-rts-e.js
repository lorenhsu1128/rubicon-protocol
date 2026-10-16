// Coral 戰爭（RTS）R2 E 包（HUD、輸入、親自駕駛）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-e')(H)。
// testRtsHud2：英雄頭像列（F1 選取、兩下跳鏡頭、陣亡與復活倒數）、閒置工人 F8／Ctrl＋F8、閒置部隊 F9、小地圖（營地、
//   中立建築、英雄、Alt 信號）、警示（英雄升級、研究完成、人口將滿）、指令卡（技能冷卻、自動施放切換）、背包（Alt＋數字）、
//   資源列（層級、維持費）、三種大小的截圖與版面。
// testRtsPilot：F 進入親自駕駛（this.player、isPlayer、state 'play'、動作鏡頭、不接 RTS 指令）、移動、開火與鎖定（迷霧裡的
//   不能鎖定）、Z 技能、1 道具、短按 F＝突擊推進、長按 F 離開、陣亡自動離開、自動管家（採集、循環生產、補給庫、回防）、
//   切換那一格的耗時、三種大小的截圖。
// 電腦對手不動（g.rtsAiOff）；主迴圈停住，以 rtsSim（只模擬）或 __pump（g.loop：模擬＋鏡頭＋HUD＋算繪）推進。
// 英雄（C 包）還沒有完整的生產流程時，測試自己補一筆英雄紀錄（T.heroes）。
/* global window, THREE, document, localStorage, innerWidth, innerHeight, getComputedStyle */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  // 開局＋共用的工具（頁面裡的 window.__*）
  async function setup(page, base, seed) {
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    return page.evaluate((seed) => {
      const g = window.__game;
      g.rtsAiOff = true;
      try {
        localStorage.removeItem('rubicon_rts');
      } catch (e) {
        void e;
      }
      g.rtsStart({
        theme: 'wasteland',
        seed,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      R.teams[0].ore = R.teams[1].ore = 20000;
      R.teams[0].coral = R.teams[1].coral = 20000;
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
        }
        return until && !until() ? -1 : t;
      };
      // 只更新鏡頭與 HUD（不模擬），每格換 lastT（rtsHudTick 每格只跑一次）
      window.__tick = (n = 1) => {
        for (let i = 0; i < n; i++) {
          g.lastT = performance.now() + Math.random();
          g.rtsHudDirty = true;
          if (R.pilot) g.rtsPilotView(1 / 60);
          else g.rtsCamUpdate(1 / 60);
          g.renderMain();
        }
      };
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      window.__put = (team, def) => {
        const p = g.rtsAutoSpot(team, def);
        return p ? g.rtsSpawnBld(team, def, p.x, p.z, 0, 1) : null;
      };
      window.__hq = window.__of(0, 'c_hq')[0];
      window.__scr = (e) => {
        const s = {};
        g.rtsScreen(e, s);
        return [Math.round(s.x), Math.round(s.y)];
      };
      // 英雄：主堡生產（C 包的 rtsHeroSpawned 建紀錄）；沒有紀錄時測試自己補
      window.__hero = (def = 'h_bastion') => {
        const T = R.teams[0];
        const hq = window.__hq;
        hq.bld.queue.length = 0;
        g.rtsQueue(hq, def);
        window.__sim(90, () => window.__of(0, def).length > 0);
        const e = window.__of(0, def)[0];
        if (!e) return null;
        let rec = (T.heroes || []).find((h) => h && h.def === def);
        if (!rec) {
          rec = {
            def,
            lv: 1,
            xp: 0,
            pts: 1,
            sk: [0, 0, 0, 0],
            cd: [0, 0, 0, 0],
            inv: [null, null, null, null, null, null],
            ent: e,
            st: 'alive',
            src: 'hq',
          };
          (T.heroes || (T.heroes = [])).push(rec);
        }
        e.hero = rec;
        return e;
      };
      // 陣亡的英雄在主堡復活（C 包沒有更新紀錄時測試自己接上）
      window.__revive = (def) => {
        const T = R.teams[0];
        const rec = T.heroes.find((h) => h && h.def === def);
        window.__hq.bld.queue.length = 0;
        g.rtsQueue(window.__hq, def, { revive: true });
        window.__sim(90, () => window.__of(0, def).length > 0);
        const e = window.__of(0, def)[0];
        if (e && rec && rec.ent !== e) {
          rec.ent = e;
          rec.st = 'alive';
        }
        if (e && rec) e.hero = rec;
        return e;
      };
      // 呼叫紀錄（C 包的 API 還沒有時當成假的實作）
      window.__calls = [];
      window.__spy = (fn, ret = true) => {
        const orig = g[fn];
        g[fn] = function (...a) {
          window.__calls.push({ fn, a });
          return typeof orig === 'function' ? orig.apply(g, a) : ret;
        };
      };
      // 背包放一個道具（C 包的 rtsItemGive，沒有時直接寫紀錄）
      window.__give = (e, item) => {
        if (typeof g.rtsItemGive === 'function') {
          const r = g.rtsItemGive(e, item);
          if (r !== false && e.hero.inv.some(Boolean)) return true;
        }
        const i = e.hero.inv.findIndex((x) => !x);
        e.hero.inv[i] = { id: item, charges: 2 };
        return true;
      };
      g.rtsInputInit();
      return { units: R.units.length };
    }, seed);
  }

  async function testRtsHud2(browser, base) {
    console.log('Coral 戰爭：英雄頭像列、閒置、小地圖、警示、技能與背包（R2 HUD）');
    const { ctx, page } = await newPage(browser, 'rtsHud2');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await setup(page, base, 7);
    const ev = (fn, a) => page.evaluate(fn, a);
    const tick = (n = 2) => ev((n) => window.__tick(n), n);

    // ---------- 英雄頭像列 ----------
    const h0 = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const e = window.__hero('h_bastion');
      window.__h = e;
      // 主堡附近一台閒置的英雄：鏡頭先移開，F1 兩下要跳回去
      g.rtsCamJump(e.pos.x + 120 > 180 ? e.pos.x - 120 : e.pos.x + 120, e.pos.z);
      window.__tick(3);
      return {
        ok: !!e,
        n: document.querySelectorAll('#rtsHeroes .rtsHero').length,
        txt: (document.querySelector('#rtsHeroes .rtsHero') || {}).textContent || '',
        tier: document.getElementById('rtsTier').textContent,
        cam: R.cam.x,
      };
    });
    check(
      h0.ok && h0.n === 1 && /BASTION/.test(h0.txt) && /Lv1/.test(h0.txt),
      `英雄頭像列：${h0.n} 格（${h0.txt}）`,
    );
    check(h0.tier === 'T1', `資源列的層級：${h0.tier}`);
    await page.keyboard.press('F1');
    await tick(1);
    const f1 = await ev(() => {
      const R = window.__game.rts;
      return { sel: R.sel.length === 1 && R.sel[0] === window.__h, cam: R.cam.x };
    });
    await page.keyboard.press('F1');
    await tick(1);
    const f2 = await ev(() => {
      const R = window.__game.rts;
      return { d: Math.hypot(R.cam.x - window.__h.pos.x, R.cam.z - window.__h.pos.z) };
    });
    check(f1.sel && Math.abs(f1.cam - h0.cam) < 1, 'F1：選取英雄（鏡頭不動）');
    check(f2.d < 2, `F1 連按兩下：鏡頭跳到英雄（距離 ${f2.d.toFixed(1)} m）`);

    // ---------- 指令卡：英雄的技能、學習 ----------
    const card = await ev(() => {
      window.__tick(2);
      const L = [...document.querySelectorAll('#rtsCard .rtsCmd')].map(
        (b) => b.querySelector('b').textContent,
      );
      return L;
    });
    check(
      card[11] !== '' && card[8] !== '' && card.includes('親自駕駛'),
      `英雄的指令卡：Z X C V 技能（${card.slice(8).join('、')}）、F 親自駕駛`,
    );

    // ---------- 背包：Alt＋1、點一下＝使用 ----------
    await ev(() => {
      window.__spy('rtsItemUse');
      window.__give(window.__h, 'i_kit');
      window.__game.rtsHudDirty = true;
      window.__tick(2);
      window.__calls.length = 0;
    });
    await page.keyboard.press('Alt+Digit1');
    const inv = await ev(() => {
      const c = window.__calls.filter((q) => q.fn === 'rtsItemUse');
      return {
        n: c.length,
        slot: c[0] ? c[0].a[1] : -1,
        cells: document.querySelectorAll('#rtsPanel .rtsInv').length,
        full: document.querySelectorAll('#rtsPanel .rtsInv:not(.empty)').length,
      };
    });
    check(inv.cells === 6 && inv.full >= 1, `選取面板的背包 2×3（${inv.full} 格有道具）`);
    check(inv.n >= 1 && inv.slot === 0, `Alt＋1：使用第 1 格的道具（rtsItemUse 第 ${inv.slot + 1} 格）`);

    // ---------- 陣亡與復活倒數 ----------
    const dead = await ev(() => {
      const g = window.__game,
        R = g.rts,
        e = window.__h;
      g.rtsHit(e, 1e7, 0, null, 'none');
      window.__sim(0.3);
      const rec = R.teams[0].heroes.find((h) => h.def === 'h_bastion');
      if (rec.ent && rec.ent.dead && rec.st === 'alive') rec.st = 'dead';
      window.__tick(2);
      const t1 = document.querySelector('#rtsHeroes .rtsHero').className;
      const tx1 = document.querySelector('#rtsHeroes .rtsHero').textContent;
      // 主堡的英雄子選單：復活
      g.rtsQueue(window.__hq, 'h_bastion', { revive: true });
      window.__sim(1);
      window.__tick(2);
      const tx2 = document.querySelector('#rtsHeroes .rtsHero').textContent;
      return { cls: t1, tx1, tx2, ev: R.ui.events.map((x) => x.txt).join('|') };
    });
    check(/dead/.test(dead.cls) && /陣亡/.test(dead.tx1), `英雄陣亡：頭像灰掉（${dead.tx1}）`);
    check(/復活 \d+s/.test(dead.tx2), `復活倒數：${dead.tx2}`);
    check(/英雄陣亡/.test(dead.ev), '警示：英雄陣亡');
    const rv = await ev(() => {
      const g = window.__game,
        R = g.rts;
      window.__sim(80, () => window.__of(0, 'h_bastion').length > 0);
      const e = window.__of(0, 'h_bastion')[0];
      const rec = R.teams[0].heroes.find((h) => h.def === 'h_bastion');
      if (e && rec.ent !== e) {
        rec.ent = e;
        e.hero = rec;
        rec.st = 'alive';
      }
      window.__h = e;
      window.__tick(2);
      // 升級警示
      rec.lv = 2;
      rec.pts = 2;
      window.__tick(2);
      return {
        e: !!e,
        ev: R.ui.events.map((x) => x.txt).join('|'),
        plus: !!document.querySelector('#rtsHeroes .pts'),
      };
    });
    check(rv.e && /英雄復活/.test(rv.ev), '英雄復活完成：警示');
    check(/英雄升級/.test(rv.ev) && rv.plus, '英雄升級：警示、頭像顯示技能點「＋」');

    // ---------- 研究完成、人口將滿、維持費 ----------
    const al = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      window.__put(0, 'c_factory');
      const works = window.__put(0, 'c_works');
      g.rtsResearch(works, 'r_kin');
      window.__sim(45, () => (T.tech.res.r_kin || 0) > 0);
      window.__tick(2);
      const evs1 = R.ui.events.map((x) => x.txt).join('|');
      T.pop = T.cap - 3;
      window.__tick(2);
      const evs2 = R.ui.events.map((x) => x.txt).join('|');
      T.pop = 58;
      window.__tick(2);
      const near = document.getElementById('rtsUpkeep').className;
      T.pop = 62;
      window.__tick(2);
      const evs3 = R.ui.events.map((x) => x.txt).join('|');
      g.rtsRecount();
      return { evs1, evs2, evs3, near };
    });
    check(/研究完成/.test(al.evs1), '警示：研究完成');
    check(/人口將滿/.test(al.evs2), '警示：人口將滿（剩 3）');
    check(
      /near/.test(al.near) && /維持費：低維持費/.test(al.evs3),
      `維持費：接近下一級變黃（${al.near}）、改變時警示`,
    );

    // ---------- 閒置工人 F8／Ctrl＋F8、閒置部隊 F9 ----------
    const idle0 = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const ws = window.__of(0, 'c_worker');
      for (const w of ws.slice(0, 2)) g.rtsSetOrders(w, []);
      window.__idleW = ws.slice(0, 2).map((w) => w.id);
      const mt = g.rtsSpawn(0, 'c_mt', window.__hq.pos.x + 20, window.__hq.pos.z + 20, 0);
      const mt2 = g.rtsSpawn(0, 'c_mt', window.__hq.pos.x + 23, window.__hq.pos.z + 20, 0);
      window.__mts = [mt, mt2];
      g.rtsCamJump(0, 0);
      window.__tick(2);
      return { btn: document.getElementById('rtsIdleW').textContent };
    });
    await page.keyboard.press('F8');
    await tick(1);
    const idle1 = await ev(() => {
      const R = window.__game.rts;
      const e = R.sel[0];
      return { n: R.sel.length, id: e && e.id, d: e ? Math.hypot(R.cam.x - e.pos.x, R.cam.z - e.pos.z) : 99 };
    });
    await page.keyboard.press('Control+F8');
    const idle2 = await ev(() => window.__game.rts.sel.map((e) => e.id));
    await page.keyboard.press('F9');
    const idle3 = await ev(() => window.__game.rts.sel.map((e) => e.rtsDef));
    check(/工 2/.test(idle0.btn), `小地圖旁的閒置工人按鈕（${idle0.btn}）`);
    check(idle1.n === 1 && idle0 && idle1.d < 2, 'F8：選一個閒置工人並把鏡頭移過去');
    check(idle2.length === 2, `Ctrl＋F8：全部的閒置工人（${idle2.length}）`);
    check(idle3.length >= 2 && idle3.every((d) => d === 'c_mt'), `F9：閒置部隊（${idle3.join()}）`);

    // ---------- 指令卡：技能冷卻、自動施放 ----------
    const cd = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq = window.__hq;
      const fk = g.rtsSpawn(0, 'c_forklift', hq.pos.x - 22, hq.pos.z + 20, 0);
      fk.rtsCd = { ab_crate: R.t + 6 };
      g.rtsSetSel([fk]);
      window.__tick(2);
      const b = document.querySelector('#rtsCard .rtsCmd[data-slot="8"]');
      const o = {
        cool: b.classList.contains('cool'),
        txt: b.querySelector('.cdf').textContent,
        bg: !!b.querySelector('.cdf').style.background,
      };
      const st = g.rtsSpawn(0, 'c_stomper', hq.pos.x - 22, hq.pos.z + 26, 0);
      window.__st = st;
      g.rtsSetSel([st]);
      window.__tick(2);
      return o;
    });
    check(cd.cool && cd.txt === '6' && cd.bg, `技能冷卻：扇形遮罩與剩餘秒數（${cd.txt}）`);
    const sb = await page.$('#rtsCard .rtsCmd[data-slot="8"]');
    await sb.click({ button: 'right' });
    await tick(2);
    const au = await ev(() => ({
      on: !!(window.__st.rtsAuto && window.__st.rtsAuto.ab_stomp),
      cls: document.querySelector('#rtsCard .rtsCmd[data-slot="8"]').classList.contains('auto'),
    }));
    check(au.on && au.cls, '右鍵點技能格：切換自動施放（金框）');

    // ---------- 小地圖：營地、中立建築、英雄、Alt 信號 ----------
    const mm = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const S = g.world.size / 2;
      // D 包還沒有營地時放一個測試用的（只畫在小地圖上）
      let camp = (R.camps || [])[0];
      if (!camp) {
        camp = { id: 'tc', pos: { x: -S * 0.5, z: S * 0.5 }, tier: 3, cleared: false, ents: new Set() };
        R.camps.push(camp);
        window.__fakeCamp = true;
      }
      window.__camp = camp;
      R.sel = [];
      g.rtsMiniDraw();
      const cv = document.getElementById('rtsMiniCv');
      const px = (x, z) => {
        const k = cv.width / (2 * S);
        const d = cv
          .getContext('2d')
          .getImageData(Math.round((x + S) * k), Math.round((z + S) * k), 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const c0 = px(camp.pos.x, camp.pos.z);
      const h = window.__h;
      const hp = px(h.pos.x, h.pos.z);
      camp.cleared = true;
      g.rtsMiniDraw();
      const c1 = px(camp.pos.x, camp.pos.z);
      // 中立建築的圖示：D 包有的話看第一個
      const neu = (R.neutrals || []).length;
      return { c0, c1, hp, neu };
    });
    check(
      mm.c0[0] > 200 && mm.c0[1] > 170 && mm.c0[2] < 120 && Math.abs(mm.c1[0] - mm.c1[2]) < 30,
      `小地圖：野怪營地黃點（${mm.c0}）、清除後變灰（${mm.c1}）`,
    );
    check(mm.hp[1] > 180 && mm.hp[0] < 160, `小地圖：英雄（己方綠色菱形 ${mm.hp}）`);
    const sig = await ev(() => {
      const r = document.getElementById('rtsMiniCv').getBoundingClientRect();
      return {
        x: r.left + r.width * 0.3,
        y: r.top + r.height * 0.3,
        n: (window.__game.rts.ui.pings || []).length,
      };
    });
    await page.keyboard.down('Alt');
    await page.mouse.click(sig.x, sig.y);
    await page.keyboard.up('Alt');
    const sg = await ev(() => {
      const ui = window.__game.rts.ui;
      return {
        n: (ui.pings || []).length,
        mark: ui.marks.some((m) => m.mesh.visible && m.big === 3),
        col: (ui.pings || []).slice(-1)[0] && ui.pings.slice(-1)[0].col,
      };
    });
    check(
      sg.n > sig.n && sg.mark && sg.col === '#5cf0ff',
      'Alt＋點小地圖：信號（小地圖的擴散圈＋地面的標記）',
    );
    // 小地圖的切換：敵我 → 隊伍 → 地形
    await page.click('#rtsMiniMode');
    const mode = await ev(() => [
      window.__game.rts.ui.miniMode,
      document.getElementById('rtsMiniMode').textContent,
    ]);
    check(mode[0] === 1 && mode[1] === '隊伍', `小地圖的配色切換（${mode[1]}）`);
    await page.click('#rtsMiniMode');
    await page.click('#rtsMiniMode');
    if (await ev(() => window.__fakeCamp))
      await ev(() => {
        const R = window.__game.rts;
        R.camps.splice(R.camps.indexOf(window.__camp), 1);
      });

    // ---------- 管家按鈕 ----------
    await page.click('#rtsButlerBtn');
    const bt = await ev(() => document.querySelectorAll('#rtsButlerPanel .rtsTg').length);
    await page.click('#rtsButlerPanel .rtsTg[data-k="on"]');
    const bon = await ev(() => {
      const R = window.__game.rts;
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem('rubicon_rts')).butler;
      } catch (e) {
        void e;
      }
      return { on: R.butler.on, saved: saved && saved.on };
    });
    check(bt === 6 && bon.on && bon.saved, '資源列的「管家」：開關面板（啟用＋5 項），設定記在 rubicon_rts');
    await page.click('#rtsButlerPanel .rtsTg[data-k="on"]');
    await page.click('#rtsButlerPanel .rtsTgClose');

    // ---------- 三種大小 ----------
    const lay = async (tag) => {
      await ev(() => {
        const g = window.__game;
        g.resize();
        g.rtsSetSel([window.__h]);
        g.rtsCamJump(window.__h.pos.x, window.__h.pos.z);
        window.__tick(4);
      });
      await page.screenshot({ path: path.join(SHOT_DIR, `rts-hud2-${tag}.png`) });
      return ev(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const top = r('rtsTop'),
          hb = r('rtsHeroes'),
          bot = r('rtsBottom'),
          card = r('rtsCard');
        const ins = (b) =>
          b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5;
        return {
          ok: hb.top >= top.bottom - 1 && hb.bottom <= bot.top && ins(card) && ins(hb) && ins(top),
          sw: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    };
    const l1 = await lay('1920');
    await page.setViewportSize({ width: 1180, height: 820 });
    const l2 = await lay('1180');
    check(
      l1.ok && l1.sw && l2.ok && l2.sw,
      '1920×1080、1180×820：英雄頭像列在資源列與下方列之間、不超出畫面',
    );
    await ctx.close();
    // 手機橫式（觸控）：只確認不重疊、不超出畫面
    const c2 = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    if (H.watch) H.watch(pg, 'rtsHud2-phone');
    await setup(pg, base, 7);
    await pg.evaluate(() => {
      const e = window.__hero('h_rain');
      window.__h = e;
    });
    const page0 = page;
    void page0;
    const l3 = await (async () => {
      await pg.evaluate(() => {
        const g = window.__game;
        g.resize();
        g.rtsSetSel([window.__h]);
        g.rtsCamJump(window.__h.pos.x, window.__h.pos.z);
        window.__tick(4);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, 'rts-hud2-844.png') });
      return pg.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const top = r('rtsTop'),
          hb = r('rtsHeroes'),
          bot = r('rtsBottom'),
          card = r('rtsCard');
        return {
          ok: hb.top >= top.bottom - 1 && hb.bottom <= bot.top && card.right <= innerWidth + 0.5,
          sw: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    })();
    check(l3.ok && l3.sw, '844×390 觸控：英雄頭像列、下方列不重疊、不超出畫面');
    await c2.close();
  }

  async function testRtsPilot(browser, base) {
    console.log('Coral 戰爭：親自駕駛英雄、自動管家（R2）');
    const { ctx, page } = await newPage(browser, 'rtsPilot');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await setup(page, base, 7);
    const ev = (fn, a) => page.evaluate(fn, a);

    // 英雄＋前方一台看得到的敵人、遠一點（迷霧裡）的敵人
    const st = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const e = window.__hero('h_bastion');
      window.__h = e;
      g.setView && g.ctrl && (g.ctrl.view = 'tps');
      const hq = window.__hq;
      // 英雄走到主堡外側的空地
      const dx = -Math.sign(hq.pos.x) || 1,
        dz = -Math.sign(hq.pos.z) || 1;
      const nav = g.world.nav;
      const spot = (x, z) => {
        const c = nav.nearestCell(x, z, 1, -1, 12);
        return c >= 0 ? nav.center(c) : { x, z };
      };
      const p0 = spot(hq.pos.x + dx * 30, hq.pos.z + dz * 30);
      e.pos.set(p0.x, g.world.terrainHeight(p0.x, p0.z), p0.z);
      e.mesh.position.copy(e.pos);
      e.yaw = Math.atan2(-dx, -dz); // 面向地圖中央
      const fx = -Math.sin(e.yaw),
        fz = -Math.cos(e.yaw);
      const p1 = spot(p0.x + fx * 20, p0.z + fz * 20);
      const near = g.rtsSpawn(1, 'c_mt', p1.x, p1.z, 0);
      near.rtsVision = 0;
      near.hp = near.maxHp = 1e6;
      window.__near = near;
      const reach = g.lockReach(e);
      const far = Math.min(reach - 1, 70);
      const p2 = spot(p0.x + fx * far, p0.z + fz * far);
      const hid = g.rtsSpawn(1, 'c_mt', p2.x, p2.z, 0);
      hid.rtsVision = 0;
      window.__hid = hid;
      // 敵人不動、不開火（只當靶子）
      for (const t of [near, hid]) {
        t.rtsUnitAI = () => true;
        t.updateAI = () => {};
      }
      g.rtsFogTick(1);
      window.__tick(2);
      return {
        ok: !!e,
        reach,
        dHid: Math.hypot(p2.x - p0.x, p2.z - p0.z),
        sight: e.rtsVision,
        hidLock: hid.noLock,
      };
    });
    check(st.ok, '英雄就位（主堡外的空地，前方一台敵人）');

    // F 進入
    await ev(() => {
      const g = window.__game;
      g.rtsSetSel([window.__h]);
      window.__tick(2);
    });
    await page.keyboard.press('KeyF');
    const en = await ev(() => {
      const g = window.__game,
        R = g.rts,
        e = window.__h;
      window.__pump(0.3);
      return {
        pilot: !!R.pilot && R.pilot.e === e,
        player: g.player === e,
        isPlayer: e.isPlayer,
        state: g.state,
        piloted: e.rtsPiloted,
        camD: g.camera.position.distanceTo(e.pos),
        ms: R.pilot ? R.pilot.ms : -1,
        cls: document.getElementById('rtsHud').className,
        hudBottom: getComputedStyle(document.getElementById('hudBottom')).display,
        card: getComputedStyle(document.getElementById('rtsCard')).display,
      };
    });
    check(
      en.pilot && en.player && en.isPlayer && en.piloted && en.state === 'play',
      `F：親自駕駛（this.player＝英雄、isPlayer、state ${en.state}）`,
    );
    check(en.camD < 60, `鏡頭換成動作視角（離英雄 ${en.camD.toFixed(1)} m）`);
    check(
      /pilot/.test(en.cls) && en.hudBottom !== 'none' && en.card === 'none',
      'HUD：動作 HUD（AP、EN、ACS）＋RTS 小面板（指令卡隱藏）',
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-pilot-1920.png') });

    // 移動
    const mv = await ev(() => {
      const g = window.__game,
        e = window.__h;
      const p0 = e.pos.clone();
      g.down[g.keymap.left] = true;
      window.__pump(1.2);
      g.down[g.keymap.left] = false;
      window.__pump(0.3);
      // RTS 指令：英雄不接
      g.rtsOrder([e], { k: 'move', x: e.pos.x + 30, z: e.pos.z });
      const p1 = e.pos.clone();
      window.__pump(0.5);
      return { d: p0.distanceTo(p1), d2: p1.distanceTo(e.pos), orders: e.orders.length };
    });
    check(mv.d > 3, `WASD 移動（${mv.d.toFixed(1)} m）`);
    check(
      mv.orders === 0 && mv.d2 < 2.5,
      `英雄不接 RTS 的指令（指令 ${mv.orders} 個、移動 ${mv.d2.toFixed(1)} m）`,
    );

    // 鎖定與開火：迷霧裡的不能鎖定
    const fire = await ev(() => {
      const g = window.__game,
        e = window.__h,
        near = window.__near,
        hid = window.__hid;
      // 面向前方的敵人
      e.yaw = Math.atan2(-(near.pos.x - e.pos.x), -(near.pos.z - e.pos.z));
      g.fpYaw = e.yaw;
      e.lock = null;
      window.__pump(0.3);
      const cands = g.lockCands(e);
      const hp0 = near.hp;
      g.down[g.keymap.fireR] = true;
      g.down[g.keymap.fireL] = true;
      window.__pump(2);
      g.down[g.keymap.fireR] = false;
      g.down[g.keymap.fireL] = false;
      return {
        lock: e.lock === near,
        hidIn: cands.includes(hid),
        hidNoLock: hid.noLock,
        hidD: hid.pos.distanceTo(e.pos),
        reach: g.lockReach(e),
        dmg: hp0 - near.hp,
      };
    });
    check(fire.lock, '鎖定前方看得到的敵人');
    check(
      !fire.hidIn && fire.hidNoLock,
      `迷霧裡的敵人不能鎖定（${fire.hidD.toFixed(0)} m，攻擊距離 ${fire.reach.toFixed(0)} m）`,
    );
    check(fire.dmg > 0, `開火命中（${Math.round(fire.dmg)}）`);

    // Z 技能、1 道具（C 包的 API；還沒有時記錄呼叫）
    const sk = await ev(() => {
      const g = window.__game,
        e = window.__h;
      e.hero.sk[1] = 1; // 貨櫃壁壘（地點）
      e.hero.cd = [0, 0, 0, 0];
      window.__spy('rtsSkillCast');
      window.__spy('rtsItemUse');
      if (!e.hero.inv.some(Boolean)) window.__give(e, 'i_kit');
      window.__calls.length = 0;
      window.__coral0 = g.rts.teams[0].coral;
      return e.hero.inv.findIndex(Boolean);
    });
    await page.keyboard.press('KeyX');
    await page.keyboard.press(`Digit${sk + 1}`);
    const sk2 = await ev(() => {
      const g = window.__game;
      window.__pump(0.2);
      return {
        cast: window.__calls.filter((q) => q.fn === 'rtsSkillCast').map((q) => q.a[1]),
        item: window.__calls.filter((q) => q.fn === 'rtsItemUse').map((q) => q.a[1]),
        pilot: !!g.rts.pilot,
        coral: Math.round(window.__coral0 - g.rts.teams[0].coral),
      };
    });
    check(
      sk2.cast[0] === 1 && sk2.coral > 0,
      `X：施放英雄的第 2 個技能（slot ${sk2.cast.join()}、Coral −${sk2.coral}）`,
    );
    check(sk2.item[0] === sk && sk2.pilot, `${sk + 1}：使用道具欄第 ${sk + 1} 格`);

    // 短按 F＝突擊推進（不離開）、長按 F 0.6 秒離開
    const ab = await ev(() => {
      const g = window.__game,
        e = window.__h;
      e.lock = window.__near;
      e.en = e.enMax;
      g.down[g.keymap.ab] = true;
      window.__pump(0.25);
      const abT = e.abT;
      const still = !!g.rts.pilot;
      g.down[g.keymap.ab] = false;
      window.__pump(0.1);
      g.down[g.keymap.ab] = true;
      const t = window.__pump(1.5, () => !g.rts.pilot);
      g.down[g.keymap.ab] = false;
      window.__pump(0.1);
      const R = g.rts;
      return {
        abT,
        still,
        t,
        exit: !R.pilot,
        player: g.player,
        state: g.state,
        sel: R.sel.length === 1 && R.sel[0] === e,
        isPlayer: e.isPlayer,
        exitMs: g.rtsPilotLastExitMs,
        camD: Math.hypot(R.cam.x - e.pos.x, R.cam.z - e.pos.z),
      };
    });
    check(ab.still && ab.abT > 0, '短按 F：突擊推進（仍在親自駕駛）');
    check(
      ab.exit &&
        ab.t > 0.5 &&
        ab.t < 0.8 &&
        ab.player === null &&
        ab.state === 'rts' &&
        !ab.isPlayer &&
        ab.sel,
      `長按 F ${ab.t.toFixed(2)} 秒：回到指揮（this.player＝null、選取這位英雄、鏡頭在英雄 ${ab.camD.toFixed(1)} m）`,
    );
    check(
      en.ms >= 0 && en.ms < 8 && ab.exitMs < 8,
      `切換的耗時：進入 ${en.ms.toFixed(2)} ms、離開 ${ab.exitMs.toFixed(2)} ms（< 8 ms）`,
    );

    // 暫停選單的「回到指揮」
    await page.keyboard.press('KeyF');
    await ev(() => window.__pump(0.2));
    await page.keyboard.press('Escape');
    const pz = await ev(() => ({
      state: window.__game.state,
      btn: getComputedStyle(document.getElementById('btnRtsCmd')).display,
    }));
    await page.click('#btnRtsCmd');
    const pz2 = await ev(() => ({ state: window.__game.state, pilot: !!window.__game.rts.pilot }));
    check(
      pz.state === 'pause' && pz.btn !== 'none' && pz2.state === 'rts' && !pz2.pilot,
      '暫停選單的「回到指揮」',
    );

    // 陣亡：自動離開
    await page.keyboard.press('KeyF');
    const dd = await ev(() => {
      const g = window.__game,
        R = g.rts,
        e = window.__h;
      window.__pump(0.2);
      const on = !!R.pilot;
      g.rtsHit(e, 1e7, 0, window.__near, 'none');
      window.__pump(0.3);
      return { on, exit: !R.pilot, player: g.player, state: g.state };
    });
    check(
      dd.on && dd.exit && dd.player === null && dd.state === 'rts',
      '英雄陣亡：自動回到指揮（this.player＝null）',
    );

    // ---------- 自動管家（親自駕駛 3 分鐘） ----------
    const bt = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      // 新的英雄（第二位要 T2：直接用測試的紀錄）
      const e = window.__revive('h_bastion');
      window.__h2 = e;
      const hq = window.__hq;
      const fac = window.__of(0, 'c_factory')[0] || window.__put(0, 'c_factory');
      fac.bld.queue.length = 0;
      fac.bld.lastId = 'c_mt';
      fac.bld.loop = true;
      // 兩個工人閒置
      const ws = window.__of(0, 'c_worker');
      for (const w of ws.slice(0, 2)) g.rtsSetOrders(w, []);
      // 人口快滿（補給庫）
      for (const d of window.__of(0, 'c_depot')) d.die(null);
      window.__sim(0.2);
      const mts0 = window.__of(0, 'c_mt').length;
      const dep0 = window.__of(0, 'c_depot').length;
      g.rtsPilotEnter(e);
      // 敵人走進基地：閒置的部隊回防
      const guard = g.rtsSpawn(0, 'c_mt', hq.pos.x + 8, hq.pos.z + 18, 0);
      window.__guard = guard;
      const foe = g.rtsSpawn(1, 'c_mt', hq.pos.x + 26, hq.pos.z + 26, 0);
      foe.hp = foe.maxHp = 1e6;
      foe.rtsUnitAI = () => true;
      foe.updateAI = () => {};
      window.__foe = foe;
      g.rtsFogTick(1);
      window.__sim(1.5);
      const gd = guard.orders[0] ? guard.orders[0].k : '';
      foe.rtsQuiet = true;
      foe.die(null);
      const idle = [];
      let tp = 0;
      // 3 分鐘：每 10 秒記一次閒置的工人
      for (let s = 0; s < 18; s++) {
        window.__sim(10);
        g.rtsFogTick(1);
        idle.push(window.__of(0, 'c_worker').filter((w) => !w.orders.length && !w.rtsMilFrom).length);
        tp = Math.max(tp, T.pop);
      }
      const o = {
        pilot: !!R.pilot,
        gd,
        mts: window.__of(0, 'c_mt').length - mts0,
        dep: window.__of(0, 'c_depot').length - dep0,
        depAll: R.units.filter((b) => b.rtsDef === 'c_depot' && b.rtsTeam === 0 && !b.dead).length,
        idle,
        back: guard.orders[0] ? guard.orders[0].k : '',
      };
      g.rtsPilotExit('key');
      return o;
    });
    check(bt.pilot, '自動管家：親自駕駛 3 分鐘（英雄一直在駕駛中）');
    check(
      bt.idle.slice(1).every((n) => n === 0),
      `工人一直在採（每 10 秒的閒置數 ${bt.idle.join(',')}）`,
    );
    check(bt.mts >= 3, `循環生產：兵工廠持續生產 MT（+${bt.mts}）`);
    check(bt.dep >= 1, `人口快滿：自動蓋了補給庫（+${bt.dep}）`);
    check(bt.gd === 'amove', `基地被攻擊：閒置的部隊回防（指令 ${bt.gd}）`);
    const after = await ev(() => ({ player: window.__game.player, state: window.__game.state }));
    check(after.player === null && after.state === 'rts', '離開後 this.player 是 null、state 回到 rts');
    await ctx.close();

    // 三種大小（平板、手機橫式是觸控）：親自駕駛的畫面
    for (const [w, h, tag, touch] of [
      [1180, 820, '1180', true],
      [844, 390, '844', true],
    ]) {
      const c2 = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: touch,
        isMobile: touch,
      });
      const pg = await c2.newPage();
      if (H.watch) H.watch(pg, 'rtsPilot-' + tag);
      await setup(pg, base, 7);
      const o = await pg.evaluate(() => {
        const g = window.__game;
        const e = window.__hero('h_bastion');
        g.rtsPilotEnter(e);
        window.__pump(0.4);
        // 看得到的區塊兩兩不重疊、都在畫面內
        const els = ['rtsTop', 'rtsHeroes', 'rtsMini', 'hudBottom', 'weapons'].map((id) =>
          document.getElementById(id),
        );
        const top = document.querySelector('#vpad.on .top');
        if (top) els.push(top);
        const R = els
          .filter((el) => el && el.offsetParent !== null && getComputedStyle(el).display !== 'none')
          .map((el) => [el.id || 'vpadTop', el.getBoundingClientRect()]);
        const bad = [];
        for (let i = 0; i < R.length; i++) {
          const [n, a] = R[i];
          if (a.left < -0.5 || a.top < -0.5 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5)
            bad.push(n);
          for (let j = i + 1; j < R.length; j++) {
            const [m, b] = R[j];
            const ov = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oh = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ov > 1 && oh > 1) bad.push(n + '×' + m);
          }
        }
        return {
          ok: !bad.length && document.documentElement.scrollWidth <= innerWidth,
          bad: bad.join(','),
          n: R.length,
          pilot: !!g.rts.pilot,
        };
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-pilot-${tag}.png`) });
      check(
        o.pilot && o.ok,
        `${w}×${h}${touch ? ' 觸控' : ''}：親自駕駛的畫面（資源列、頭像、小地圖、動作 HUD、虛擬按鈕 ${o.n} 塊不重疊${o.bad ? '；重疊：' + o.bad : ''}）`,
      );
      await c2.close();
    }
  }

  return { testRtsHud2, testRtsPilot };
};
