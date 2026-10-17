// Coral 戰爭（RTS）R5 E 包（聖域的 HUD、輸入、親自駕駛，docs/rts-design.md 16.15）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-sanc-e')(H)。
// testRtsSancHud：資源列（零件、殘骸數、避難）、殘骸的點選（看過的才點得到、面板的價值與拾荒人數、滑鼠停留的提示）、
//   作業機的 V 拾荒（目標模式只點殘骸、殘骸的範圍圈）、右鍵殘骸（工人拾荒、其他單位走過去）、採集模式點殘骸、
//   拾荒帶回來（攜帶、零件入帳）；零件的費用（卡片的 ⚙、建造預覽的「零件不足」）；改裝子選單（費用、可以改的台數、
//   零件不足、要在改裝站附近、T2、改裝站的範圍圈、改裝中的進度、改裝後的面板）；避難警報（卡片、躲進去、資源列、
//   建築上的人數、面板、冷卻、解除）；拆除（面板按鈕＋uiConfirm 取消與確定、拆除中、留下殘骸、敵方建築沒有按鈕）；
//   小地圖（殘骸、己方地雷、看不到的敵方地雷不畫）；自動管家（閒置工人去拾荒、回收拖車開到殘骸堆展開）；
//   親自駕駛聖域英雄（SALVOR：進入與離開、英雄附近的殘骸標示）；三種大小的截圖 rts-r5-hud-{1920,1180,844}.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff）；主迴圈停住，以 rtsSim 快轉、__tick 更新鏡頭與 HUD。
/* global window, THREE, document, localStorage, innerWidth, innerHeight */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function setup(page, base, seed) {
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    return page.evaluate((seed) => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsCampsOff = true;
      try {
        localStorage.removeItem('rubicon_rts');
      } catch (e) {
        void e;
      }
      g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷（負載高時同一個種子的結果才會相同）
      g.rtsStart({
        theme: 'wasteland',
        seed,
        size: 400,
        faction: 'sancta',
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
          g.rtsFogTick(dt);
          g.fx.update(dt); // 粒子照遊戲的主迴圈消失（不然快轉時產生的煙塵全部疊在截圖上）
        }
        return until && !until() ? -1 : t;
      };
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
      window.__hq = window.__of(0, 's_hq')[0];
      window.__D = (id) => g.rtsUiDef(id);
      window.__scr = (x, z, y) => {
        const v = new THREE.Vector3(x, y !== undefined ? y : g.world.terrainHeight(x, z), z).project(
          g.camera,
        );
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      };
      window.__spot = (x, z, size = 0) => {
        const c = g.world.nav.nearestCell(x, z, size, -1, 20);
        return c >= 0 ? g.world.nav.center(c) : { x, z };
      };
      window.__unit = (team, def, x, z) => {
        const p = window.__spot(x, z, (window.__D(def) || {}).size || 0);
        return g.rtsSpawn(team, def, p.x, p.z, 0);
      };
      // 直接放蓋好的建築
      window.__bld = (team, def, x, z, r0 = 0) => {
        const D = window.__D(def);
        for (let r = r0; r <= 60; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (g.world.nav.buildable(px, pz, D.foot[0] + 2, D.foot[1] + 2))
              return g.rtsSpawnBld(team, def, px, pz, 0, 1);
            if (r === 0) break;
          }
        return null;
      };
      window.__slot = (cmd) => g.rtsCardItems().findIndex((it) => it && it.cmd === cmd);
      window.__card = (cmd) => g.rtsCardItems().find((it) => it && it.cmd === cmd) || null;
      window.__look = (x, z, dist = 90) => {
        g.rtsCamJump(x, z);
        R.cam.dist = dist;
        window.__tick(1);
      };
      // 聚落中心正面（往地圖中心的方向）的一點
      const hq = window.__hq;
      const dl = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      window.__front = (d) => window.__spot(hq.pos.x - (hq.pos.x / dl) * d, hq.pos.z - (hq.pos.z / dl) * d);
      g.rtsInputInit();
      return { ok: !!hq };
    }, seed);
  }

  async function testRtsSancHud(browser, base) {
    console.log('Coral 戰爭：聖域的 HUD（零件、殘骸、拾荒、改裝、避難、拆除、地雷、管家、親自駕駛）（R5 E）');
    const { ctx, page } = await newPage(browser, 'rtsSancHud');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const s0 = await setup(page, base, 7);
    check(s0.ok, '開局：聖域的聚落中心');
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 資源列、殘骸的點選與說明 ----------
    const r0 = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      window.__tick(2);
      o.fac = document.getElementById('rtsHud').dataset.fac;
      o.parts = !document.getElementById('rtsPartsBox').hidden;
      o.salv = document.getElementById('rtsSalv');
      o.salvTxt = o.salv && !o.salv.hidden ? o.salv.textContent : '';
      o.salv = !!o.salv;
      o.lift = document.getElementById('rtsLift').hidden && document.getElementById('rtsPower').hidden;
      const n0 = g.rtsHudWrecks(false).filter((w) => w.ore > 0).length;
      // 看得到的地方放一個殘骸；看不到的地方放一個
      const p = window.__front(22);
      const w = g.rtsWreckSpawn(p.x, p.z, { ore: 60, coral: 6, parts: 6, team: 1, def: 'c_mt' });
      const far = g.rtsWreckSpawn(-window.__hq.pos.x * 0.9, -window.__hq.pos.z * 0.9, { ore: 50, team: 0 });
      window.__w = w;
      window.__sim(0.3);
      window.__look(p.x, p.z, 70);
      o.n = g.rtsHudWrecks(false).filter((x) => x.ore > 0).length - n0;
      o.hidden = !g.rtsHudWrecks(false).includes(far);
      o.salvTxt2 = document.getElementById('rtsSalv').textContent;
      // 點選：螢幕上的殘骸
      const s = window.__scr(w.x, w.z, w.y + 0.6);
      o.pick = g.rtsPickAt(s.x, s.y) === w;
      const sf = window.__scr(far.x, far.z, far.y + 0.6);
      o.pickFar = g.rtsPickAt(sf.x, sf.y);
      o.pickFar = !!(o.pickFar && o.pickFar.wreck);
      g.rtsClickAt(s.x, s.y, false, false);
      window.__tick(1);
      o.focus = R.ui.focus === w && !R.sel.length;
      o.panel = document.getElementById('rtsPanel').textContent;
      // 滑鼠停留的提示
      R.ui.mouseIn = true;
      R.ui.mx = s.x;
      R.ui.my = s.y;
      window.__tick(2);
      o.tip = g._rtsWreckTip || '';
      R.ui.mouseIn = false;
      // 小地圖
      g.rtsMiniDraw();
      o.mini = (g._rtsSancMini || {}).wrecks || 0;
      return o;
    });
    check(
      r0.fac === 'sancta' && r0.parts && r0.salv && r0.lift,
      '資源列：聖域、零件、殘骸（沒有導管與空投）',
    );
    check(/^殘骸 \d+/.test(r0.salvTxt), `資源列的殘骸數（${r0.salvTxt}）`);
    check(r0.n === 1 && r0.hidden, '看過的殘骸才算（沒探索過的地方的不算）');
    check(r0.pick && !r0.pickFar, '殘骸可以點選（看不到的點不到）');
    check(
      r0.focus && /殘骸/.test(r0.panel) && /礦石 60/.test(r0.panel) && /零件 6/.test(r0.panel),
      '點殘骸：面板顯示價值',
    );
    check(
      /礦石 60/.test(r0.tip) && /拾荒 0／3/.test(r0.tip),
      `滑鼠停留在殘骸上：價值與拾荒人數（${r0.tip}）`,
    );
    check(r0.mini >= 1, `小地圖畫殘骸（${r0.mini}）`);

    // ---------- 拾荒：卡片、目標模式、右鍵、採集模式、帶回來 ----------
    const r1 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        w = window.__w;
      const o = {};
      const wk = window.__of(0, 's_worker');
      g.rtsSetSel([wk[0]]);
      const it = window.__card('salvage');
      o.card = !!it && it.key === 'V' && !it.dis && /殘骸 \d/.test(it.lvTxt || '');
      g.rtsCardPress(window.__slot('salvage'), false, true);
      o.mode = R.ui.mode && R.ui.mode.order === 'salvage';
      window.__tick(1);
      o.hint = document.getElementById('rtsModeHint').textContent;
      o.rings = (R.ui.sInfo || {}).wrecks || 0;
      // 點地面（沒有殘骸）＝提示；點殘骸＝拾荒
      const gp = window.__front(5);
      g.rtsModeAt(gp.x, gp.z, null, false);
      o.stay = !!R.ui.mode;
      g.rtsModeAt(w.x, w.z, w, false);
      o.ord = wk[0].orders[0] && wk[0].orders[0].k === 'salvage' && wk[0].orders[0].wid === w.id;
      o.modeOff = !R.ui.mode;
      // 右鍵殘骸：工人拾荒、民兵走過去
      g.rtsSetSel([wk[1]]);
      g.rtsRightAt(w.x, w.z, w, false);
      o.right = wk[1].orders[0] && wk[1].orders[0].k === 'salvage';
      const mil = window.__unit(0, 's_militia', window.__hq.pos.x, window.__hq.pos.z);
      window.__mil = mil;
      g.rtsSetSel([mil]);
      g.rtsRightAt(w.x, w.z, w, false);
      o.rightMil = mil.orders[0] && mil.orders[0].k === 'move';
      // 採集模式點殘骸＝拾荒
      g.rtsSetSel([wk[2]]);
      g.rtsSetMode({ k: 'target', order: 'gather', target: 'any', label: '採集' });
      g.rtsModeAt(w.x, w.z, w, false);
      o.gather = wk[2].orders[0] && wk[2].orders[0].k === 'salvage';
      // 拆一趟、帶回來
      const T = R.teams[0];
      const p0 = T.parts;
      g.rtsSetSel([wk[0]]);
      o.carry = window.__sim(20, () => wk[0].carry && wk[0].carry.kind === 'salv') >= 0;
      window.__tick(1);
      o.carryTxt = document.getElementById('rtsPanel').textContent;
      // 拆的時候：說明的拾荒人數
      o.tak = g.rtsHudWreckInfo(w).takers;
      window.__sim(30, () => T.parts > p0);
      o.dp = T.parts - p0;
      window.__tick(1);
      o.partsTxt = document.getElementById('rtsParts').textContent;
      return o;
    });
    check(r1.card, '作業機的 V＝拾荒（顯示看過的殘骸數）');
    check(
      r1.mode && /點殘骸/.test(r1.hint) && r1.rings >= 1,
      `拾荒的目標模式：提示與殘骸的範圍圈（${r1.rings}）`,
    );
    check(r1.stay && r1.ord && r1.modeOff, '目標模式：點地面不動作、點殘骸＝拾荒');
    check(r1.right && r1.rightMil, '右鍵殘骸：工人拾荒、民兵 MT 走過去');
    check(r1.gather, '採集模式點殘骸＝拾荒');
    check(
      r1.carry && /攜帶 礦石/.test(r1.carryTxt) && /零件/.test(r1.carryTxt),
      '拾荒：面板顯示攜帶的礦石與零件',
    );
    check(r1.dp > 0, `拾荒帶回來：零件入帳（+${r1.dp}）`);
    check(+r1.partsTxt > 0, `資源列的零件更新（${r1.partsTxt}）`);

    // ---------- 零件的費用 ----------
    const r2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      const wk = window.__of(0, 's_worker')[3];
      g.rtsSetSel([wk]);
      R.ui.menu = 'build';
      T.parts = 0;
      g.rtsHudDirty = true;
      window.__tick(1);
      const it = window.__card('build:s_barricade');
      o.dis = it && it.dis;
      o.small = document.querySelector(
        `#rtsCard .rtsCmd[data-slot="${window.__slot('build:s_barricade')}"] small`,
      ).textContent;
      // 卡片灰掉時按不下去；直接進預覽看原因
      g.rtsSetMode({ k: 'build', def: 's_barricade', D: window.__D('s_barricade') });
      let p = window.__front(24);
      for (let i = 0; i < 40; i++) {
        const q = window.__front(18 + (i % 8) * 3);
        const c = { x: q.x + Math.floor(i / 8) * 4 - 8, z: q.z + Math.floor(i / 8) * 3 - 6 };
        if (g.world.nav.buildable(c.x, c.z, 6, 6) && g.rtsFogState(0, c.x, c.z) === 2) {
          p = c;
          break;
        }
      }
      window.__look(p.x, p.z, 80);
      const s = window.__scr(p.x, p.z);
      R.ui.mx = s.x;
      R.ui.my = s.y;
      g.rtsGhostUpdate();
      o.why = R.ui.ghost && R.ui.ghost.why;
      g.rtsSetMode(null);
      R.ui.menu = null;
      T.parts = 120;
      return o;
    });
    check(r2.dis === '零件不足' && /⚙2/.test(r2.small), `建造卡：零件的費用與「零件不足」（${r2.small}）`);
    check(r2.why === '零件不足', `建造預覽：付不起零件時的原因（${r2.why}）`);

    // ---------- 改裝 ----------
    const r3 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      const near = window.__unit(0, 's_militia', hq.pos.x + hq.bld.w / 2 + 4, hq.pos.z);
      const far = window.__unit(0, 's_militia', window.__front(50).x, window.__front(50).z);
      window.__near = near;
      g.rtsSetSel([near, far]);
      g.rtsCardPress(window.__slot('menu:refit'), false, true);
      window.__tick(1);
      o.menu = R.ui.menu === 'refit';
      o.cmds = g
        .rtsCardItems()
        .map((x) => (x ? x.cmd + ':' + (x.dis || '') : '-'))
        .join(' ');
      o.st = (R.ui.sInfo || {}).st || 0;
      let it = window.__card('refit:rf_plate');
      o.cmd = it && it.cmd;
      const slot = window.__slot('refit:rf_plate');
      o.cost = it && it.cost;
      if (slot < 0) return o;
      o.small = document.querySelector(`#rtsCard .rtsCmd[data-slot="${slot}"] small`).textContent;
      o.lv = it && it.lvTxt;
      o.note = it && it.note;
      o.dis0 = it && it.dis;
      T.parts = 2;
      it = g.rtsCardItems()[slot];
      o.lack = it.dis;
      T.parts = 120;
      // 只選遠的那一台：要在改裝站附近
      g.rtsSetSel([far]);
      R.ui.menu = 'refit';
      o.far = g.rtsCardItems()[slot].dis;
      const bomb = window.__card('refit:rf_bomb');
      o.t2 = bomb && bomb.dis;
      g.rtsSetSel([near, far]);
      R.ui.menu = 'refit';
      const p0 = T.parts;
      g.rtsCardPress(slot, false, true);
      o.paid = p0 - T.parts;
      o.to = near.rtsRefitTo;
      o.farTo = !!far.rtsRefitTo;
      g.rtsSetSel([near]);
      window.__look(near.pos.x, near.pos.z, 60);
      window.__tick(2);
      o.mark = (g._rtsSancMarks || {}).refit || 0;
      o.prog = document.getElementById('rtsPanel').textContent;
      window.__sim(2.6);
      window.__tick(1);
      o.done = near.rtsRefit;
      o.panel = document.getElementById('rtsPanel').textContent;
      R.ui.menu = 'refit';
      const it2 = g.rtsCardItems()[slot];
      o.again = it2.dis;
      o.on = !!it2.on;
      R.ui.menu = null;
      return o;
    });
    check(r3.menu && r3.st >= 1, `改裝子選單：改裝站的範圍圈（${r3.st}）`);
    check(
      r3.cost && r3.cost.parts === 6 && r3.cost.ore === 10 && /⚙6/.test(r3.small),
      `改裝卡：零件＋礦石（${r3.small}）`,
    );
    check(
      r3.lv === '1 台可改' && /在改裝站附近 1/.test(r3.note || '') && !r3.dis0,
      `可以改的台數（${r3.lv}）`,
    );
    check(r3.lack === '零件不足', `零件不夠：「零件不足」（${r3.lack}）`);
    check(/改裝/.test(r3.far || ''), `不在改裝站附近：原因（${r3.far}）`);
    check(/需要/.test(r3.t2 || ''), `T2 的改裝在 T1 灰掉（${r3.t2}）`);
    check(r3.paid === 6 && r3.to === 'rf_plate' && !r3.farTo, '按下去：附近的那台扣款改裝、遠的不動');
    check(r3.mark >= 1 && /改裝中/.test(r3.prog), '改裝中：畫面上的進度、面板的進度條');
    check(r3.done === 'rf_plate' && /改裝：廢鐵裝甲/.test(r3.panel), '改裝完成：面板顯示裝了什麼');
    check(r3.again === '已經裝了' && r3.on, '同一種：已經裝了');

    // ---------- 避難警報 ----------
    const r4 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      for (const e of window.__of(0, 's_worker')) {
        g.rtsSetOrders(e, []);
        e.carry = null;
        e.pos.set(hq.pos.x + hq.bld.w / 2 + 3, e.pos.y, hq.pos.z + (e.id % 5) - 2);
      }
      g.rtsSetSel([hq]);
      const it = window.__card('ability:ab_shelter');
      o.card = !!it && !it.dis && /躲 0／10/.test(it.lvTxt || '');
      o.un = (window.__card('ability:ab_unshelter') || {}).dis;
      g.rtsCardPress(window.__slot('ability:ab_shelter'), false, true);
      window.__sim(15, () => window.__of(0, 's_worker').filter((e) => e.rtsShelter).length >= 3);
      o.n = window.__of(0, 's_worker').filter((e) => e.rtsShelter).length;
      window.__look(hq.pos.x, hq.pos.z, 80);
      window.__tick(2);
      o.res = document.getElementById('rtsSalv').textContent;
      o.mark = (g._rtsSancMarks || {}).shelter || 0;
      o.panel = document.getElementById('rtsPanel').textContent;
      o.cd = (window.__card('ability:ab_shelter') || {}).dis || '';
      const un = window.__card('ability:ab_unshelter');
      o.unDis = un && un.dis;
      g.rtsCardPress(window.__slot('ability:ab_unshelter'), false, true);
      window.__sim(0.2);
      o.out = window.__of(0, 's_worker').filter((e) => e.rtsShelter).length;
      return o;
    });
    check(r4.card && r4.un === '沒有躲著的工人', '聚落中心：避難警報卡（躲 0／10）、沒有人時解除灰掉');
    check(r4.n >= 3 && /避難 \d/.test(r4.res), `避難：工人躲進去、資源列顯示（${r4.res}）`);
    check(
      r4.mark >= 1 && /避難 \d+／10/.test(r4.panel) && /開火/.test(r4.panel),
      '避難：建築上的人數、面板（躲著的人數、開火）',
    );
    check(/冷卻/.test(r4.cd) && !r4.unDis && r4.out === 0, `避難：冷卻中（${r4.cd}）、解除後出來`);

    // ---------- 拆除 ----------
    const r5 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const b = window.__bld(0, 's_depot', hq.pos.x, hq.pos.z, 26);
      window.__dep = b;
      g.rtsSetSel([b]);
      window.__tick(1);
      const btn = document.querySelector('#rtsPanel .rtsScrap');
      o.btn = !!btn && !btn.disabled;
      btn.click();
      const m = document.getElementById('uiModal');
      o.modal = !!m && m.classList.contains('on') && /拆除/.test(m.textContent) && /零件/.test(m.textContent);
      m.querySelector('[data-um="0"]').click();
      o.cancel = !b.bld.scrapT;
      document.querySelector('#rtsPanel .rtsScrap').click();
      document.querySelector('#uiModal [data-um="1"]').click();
      o.scrap = !!b.bld.scrapT;
      window.__tick(1);
      o.panel = document.getElementById('rtsPanel').textContent;
      o.btn2 = !document.querySelector('#rtsPanel .rtsScrap');
      const x = b.pos.x,
        z = b.pos.z;
      window.__sim(3.5);
      o.dead = b.dead;
      o.wreck = !!R.wrecks.find((w) => w.bld && Math.hypot(w.x - x, w.z - z) < 1);
      // 敵方的建築：沒有拆除按鈕
      g.rtsSetSel([window.__of(1, 'c_hq')[0]]);
      window.__tick(1);
      o.foe = !document.querySelector('#rtsPanel .rtsScrap');
      return o;
    });
    check(r5.btn && r5.modal, '拆除：面板的按鈕、確認視窗（uiConfirm，寫出殘骸的價值）');
    check(r5.cancel && r5.scrap, '拆除：取消不動作、確定後開始拆');
    check(/拆除中/.test(r5.panel) && r5.btn2, '拆除中：面板的倒數（按鈕拿掉）');
    check(r5.dead && r5.wreck, '拆除完成：建築消失、留下瓦礫');
    check(r5.foe, '敵方的建築沒有拆除按鈕');

    // ---------- 地雷（小地圖） ----------
    const r6 = await ev(() => {
      const g = window.__game,
        hq = window.__hq;
      const p = window.__front(16);
      g.rtsLandMineAdd(0, p.x, p.z, {});
      g.rtsLandMineAdd(1, -hq.pos.x * 0.8, -hq.pos.z * 0.8, {});
      window.__sim(0.3);
      g.rtsMiniDraw();
      return (g._rtsSancMini || {}).mines;
    });
    check(r6 === 1, `小地圖：己方的地雷，看不到的敵方地雷不畫（${r6}）`);

    // ---------- 自動管家 ----------
    const r7 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const p = window.__front(18);
      g.rtsWreckSpawn(p.x, p.z, { ore: 120, parts: 8 });
      window.__sim(0.3);
      for (const e of window.__of(0, 's_worker')) {
        g.rtsSetOrders(e, []);
        e.carry = null;
        e._bIdle = 10;
      }
      R.butler.on = true;
      R.butler.gather = true;
      o.name = g.rtsButlerName('gather');
      R.butler._t = 5;
      g.rtsButlerTick(0.1);
      const ws = window.__of(0, 's_worker');
      o.salv = ws.filter((e) => e.orders[0] && e.orders[0].k === 'salvage').length;
      o.mine = ws.filter((e) => e.orders[0] && e.orders[0].k === 'gather').length;
      o.w = ws.length;
      // 回收拖車：殘骸堆
      const hl = window.__unit(0, 's_hauler', hq.pos.x + hq.bld.w / 2 + 4, hq.pos.z);
      const q = window.__front(34);
      for (let i = 0; i < 3; i++) g.rtsWreckSpawn(q.x + i * 2.5, q.z, { ore: 40, parts: 4 });
      window.__sim(0.3);
      R.butler._t = 5;
      g.rtsButlerTick(0.1);
      o.haulMove = hl.orders[0] && hl.orders[0].k === 'move';
      window.__sim(25, () => !hl.orders.length);
      R.butler._t = 5;
      g.rtsButlerTick(0.1);
      o.haulCast = !!hl._bHaulCastT;
      window.__sim(3);
      o.haulOn = !!hl.rtsHaulOn;
      R.butler.on = false;
      return o;
    });
    check(r7.name === '自動採集與拾荒', '管家的設定：自動採集與拾荒');
    check(
      r7.salv >= 2 && r7.salv <= Math.max(2, Math.ceil(r7.w / 4)) && r7.mine >= 1,
      `管家：閒置工人去拾荒（${r7.salv} 台）、其他回去採礦（${r7.mine}）`,
    );
    check(r7.haulMove && r7.haulCast, `管家：回收拖車開到殘骸堆、展開（B 包有實作時展開：${r7.haulOn}）`);

    // ---------- 親自駕駛聖域英雄 ----------
    const r8 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const h = g.rtsHeroSpawnAt ? g.rtsHeroSpawnAt(0, 'h_salvor', hq) : null;
      o.hero = !!h;
      if (!h) return o;
      for (let i = 0; i < 3; i++) g.rtsWreckSpawn(h.pos.x + 6 + i * 3, h.pos.z + 4, { ore: 40, parts: 4 });
      window.__sim(0.3);
      o.can = g.rtsPilotCan(h);
      o.enter = g.rtsPilotEnter(h);
      o.state = g.state;
      window.__tick(2);
      o.wrk = g._rtsPilotWrk || 0;
      o.parts = !document.getElementById('rtsPartsBox').hidden;
      o.exit = g.rtsPilotExit('key');
      o.back = g.state;
      return o;
    });
    check(r8.hero, '英雄 SALVOR');
    if (r8.hero) {
      check(
        r8.can === 'ok' && r8.enter && r8.state === 'play' && r8.exit && r8.back === 'rts',
        '親自駕駛聖域英雄：進入與離開',
      );
      check(r8.wrk >= 3 && r8.parts, `親自駕駛：英雄附近的殘骸標示（${r8.wrk}）、資源列的零件照樣顯示`);
    }

    // ---------- R5 整合：外殼與圓頂的面板、地點技能的範圍圈、多選拆除、親自駕駛的修復光束挑建築 ----------
    const r9 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const p = window.__front(22);
      // 拾荒外殼機的外殼、護盾產生器的圓頂（B 包的欄位）
      const jk = window.__unit(0, 's_junk', p.x, p.z);
      const dm = window.__unit(0, 's_dome', p.x + 6, p.z);
      window.__sim(0.2);
      if (dm.rtsSanc.dome.st === 'up') dm.rtsAbCast('ab_dome', {}); // 停著時會自動展開（B 包）
      window.__sim(2.5);
      o.domeSt = dm.rtsSanc.dome.st;
      g.rtsSetSel([dm]);
      window.__tick(1);
      o.dome = (document.getElementById('rtsPanel').textContent.match(/圓頂 \d+／\d+/) || [''])[0];
      g.rtsSetSel([jk]);
      window.__tick(1);
      o.shell = /外殼 \d+／\d+/.test(document.getElementById('rtsPanel').textContent);
      // 地點技能（布雷區，半徑 8）的目標模式：滑鼠所在的地面畫範圍圈
      const h = g.rtsHeroSpawnAt ? g.rtsHeroSpawnAt(0, 'h_haven', hq) : null;
      if (h) {
        h.hero.sk = [1, 1, 1, 1];
        g.rtsSetSel([h]);
        g.rtsSetMode({ k: 'target', order: 'ability', ab: 'sk_minefield', target: 'point', label: '布雷區' });
        const q = window.__spot(h.pos.x + 10, h.pos.z);
        window.__look(q.x, q.z, 80);
        const sc = window.__scr(q.x, q.z);
        R.ui.mx = sc.x;
        R.ui.my = sc.y;
        R.ui.mouseIn = true;
        window.__tick(1);
        const I = R.ui.pInfo;
        o.ring = I
          ? [I.r, I.far, R.ui.pRing && R.ui.pRing.visible, Math.round(Math.hypot(I.x - q.x, I.z - q.z))]
          : null;
        g.rtsSetMode(null);
        window.__tick(1);
        o.ringOff = !R.ui.pRing || !R.ui.pRing.visible;
      }
      // 多選自己的聖域建築：一起拆除
      const b1 = window.__bld(0, 's_barricade', hq.pos.x, hq.pos.z, 30);
      const b2 = window.__bld(0, 's_barricade', hq.pos.x, hq.pos.z, 34);
      g.rtsSetSel([b1, b2]);
      window.__tick(1);
      const btn = document.querySelector('#rtsPanel .rtsScrap');
      o.mBtn = btn ? btn.textContent : '';
      if (btn) {
        btn.click();
        const m = document.getElementById('uiModal');
        o.mModal = !!m && m.classList.contains('on') && /2 座/.test(m.textContent);
        document.querySelector('#uiModal [data-um="1"]').click();
      }
      o.mScrap = [!!b1.bld.scrapT, !!b2.bld.scrapT];
      // 親自駕駛 MENDER：修復光束的友軍目標也挑建築（血量比例最低的）
      const md = g.rtsHeroSpawnAt ? g.rtsHeroSpawnAt(0, 'h_mender', hq) : null;
      if (md) {
        const bb = window.__bld(0, 's_depot', md.pos.x, md.pos.z, 10);
        bb.hp = bb.maxHp * 0.3;
        o.mend = g.rtsPilotAlly(md, { range: 20, bld: true }) === bb;
        o.mendNo = g.rtsPilotAlly(md, { range: 20 }) !== bb;
      }
      g.rtsSetSel([]);
      return o;
    });
    check(
      r9.shell && /^圓頂 \d+／\d+$/.test(r9.dome),
      `面板：拾荒外殼機的外殼、護盾產生器的${r9.dome}（${r9.domeSt}）`,
    );
    check(
      !!r9.ring && r9.ring[0] === 8 && !r9.ring[1] && r9.ring[2] && r9.ring[3] <= 2 && r9.ringOff,
      `布雷區的目標模式：滑鼠處半徑 ${r9.ring && r9.ring[0]} m 的範圍圈（離游標 ${r9.ring && r9.ring[3]} m）、離開模式後消失`,
    );
    check(
      /拆除 2 座/.test(r9.mBtn) && r9.mModal && r9.mScrap.join() === 'true,true',
      `多選兩座聖域建築：「${r9.mBtn}」、確認後一起拆`,
    );
    check(r9.mend && r9.mendNo, '親自駕駛 MENDER：修復光束挑受傷的建築（沒有 bld 的技能不挑）');

    // ---------- 三種大小 ----------
    const lay = async (pg, tag) => {
      await pg.evaluate(() => {
        const g = window.__game,
          R = g.rts,
          hq = window.__hq;
        g.resize();
        g.rtsSetMode(null);
        const p = window.__front(20);
        if (!g.rtsHudWrecks(false).some((w) => Math.hypot(w.x - p.x, w.z - p.z) < 3))
          g.rtsWreckSpawn(p.x, p.z, { ore: 90, coral: 10, parts: 8, team: 1, def: 'c_mt' });
        const mil = window.__near || window.__unit(0, 's_militia', hq.pos.x + hq.bld.w / 2 + 4, hq.pos.z + 3);
        window.__sim(0.3);
        g.rtsSetSel([mil]);
        R.ui.menu = 'refit';
        window.__look(p.x, p.z, 75);
        const s = window.__scr(p.x, p.z, g.world.terrainHeight(p.x, p.z) + 0.6);
        R.ui.mouseIn = true;
        R.ui.mx = s.x;
        R.ui.my = s.y;
        window.__tick(4);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r5-hud-${tag}.png`) });
      return pg.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const top = r('rtsTop'),
          sv = r('rtsSalv'),
          pb = r('rtsPartsBox'),
          bot = r('rtsBottom'),
          card = r('rtsCard');
        const R = window.__game.rts;
        R.ui.mouseIn = false;
        return {
          ok:
            sv.right <= innerWidth + 0.5 &&
            sv.bottom <= top.bottom + 0.5 &&
            sv.width > 0 &&
            pb.width > 0 &&
            pb.bottom <= top.bottom + 0.5 &&
            card.right <= innerWidth + 0.5 &&
            bot.bottom <= innerHeight + 0.5,
          sw: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    };
    const l1 = await lay(page, '1920');
    await page.setViewportSize({ width: 1180, height: 820 });
    const l2 = await lay(page, '1180');
    check(l1.ok && l1.sw && l2.ok && l2.sw, '1920×1080、1180×820：零件與殘骸在資源列裡、不超出畫面');
    await ctx.close();
    const c2 = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    if (H.watch) H.watch(pg, 'rtsSancHud-phone');
    await setup(pg, base, 7);
    const l3 = await lay(pg, '844');
    check(l3.ok && l3.sw, '844×390 觸控：零件與殘骸、下方列不超出畫面');
    await c2.close();
  }

  return { testRtsSancHud };
};
