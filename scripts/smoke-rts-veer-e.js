// Coral 戰爭（RTS）R4 E 包（維爾威的 HUD、輸入、親自駕駛，docs/rts-design.md 15.15）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-veer-e')(H)。
// testRtsVeerHud：資源列的陣營與空投狀態（空投 n／m、投放艙）、物流 MT 與調度中心的卡片、空投子選單（運輸機 n／m）、
//   空投預覽（rtsDropWhy：探索過的地方綠、沒探索過紅、原因在模式提示；投放範圍圈）、放下去扣款、Shift 連續放、
//   運輸機都在任務中時卡片灰掉；軌道調度所的投放點（面板、範圍圈）、投放艙的倒數；收起（卡片、進度、收好的卡片：
//   移動與展開、展開的預覽、展開後 20 秒的冷卻）；物流交易（比例、冷卻灰掉）；運輸機（載運卡的目標模式、右鍵己方單位＝
//   載運、乘員面板、登機的單位點不到、編隊略過登機的、卸載）；空中單位的框選與到地面的細線、框選不選空投運輸機、
//   空投運輸機的「取消空投」；自動管家用空投蓋補給艙；親自駕駛維爾威英雄（投放艙的集結點跟著英雄、離開時還原；
//   在運輸機上不能駕駛）；三種大小的截圖 rts-r4-hud-{1920,1180,844}.png。
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
      g.rtsStart({
        theme: 'wasteland',
        seed,
        size: 400,
        faction: 'veerwell',
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
      window.__hq = window.__of(0, 'v_hq')[0];
      window.__D = (id) => g.rtsUiDef(id);
      window.__scr = (x, z, y) => {
        const v = new THREE.Vector3(x, y !== undefined ? y : g.world.terrainHeight(x, z), z).project(
          g.camera,
        );
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      };
      // 可以空投的地點（rtsDropSiteWhy＝''）：從 (x, z) 往外找
      window.__dspot = (def, x, z, r0 = 0, r1 = 40) => {
        for (let r = r0; r <= r1; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (!g.rtsDropSiteWhy(0, def, px, pz, 0) && g.world.nav.buildable(px, pz, 14, 14))
              return { x: px, z: pz };
            if (r === 0) break;
          }
        return null;
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
      // 卡片：cmd → 格子
      window.__slot = (cmd) => g.rtsCardItems().findIndex((it) => it && it.cmd === cmd);
      window.__card = (cmd) => g.rtsCardItems().find((it) => it && it.cmd === cmd) || null;
      // 滑鼠移到世界座標 (x, z)，更新預覽
      window.__mouse = (x, z) => {
        const s = window.__scr(x, z);
        R.ui.mx = s.x;
        R.ui.my = s.y;
        g.rtsGhostUpdate();
        return R.ui.ghost;
      };
      window.__look = (x, z, dist = 110) => {
        g.rtsCamJump(x, z);
        R.cam.dist = dist;
        window.__tick(1);
      };
      g.rtsInputInit();
      return { ok: !!window.__hq };
    }, seed);
  }

  async function testRtsVeerHud(browser, base) {
    console.log(
      'Coral 戰爭：維爾威的 HUD（空投預覽、投放艙、收起、交易、運輸機、空中單位、管家、親自駕駛）（R4 E）',
    );
    const { ctx, page } = await newPage(browser, 'rtsVeerHud');
    await page.setViewportSize({ width: 1920, height: 1080 });
    const s0 = await setup(page, base, 7);
    check(s0.ok, '開局：維爾威的調度中心');
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 資源列、卡片 ----------
    const c0 = await ev(() => {
      const g = window.__game,
        R = g.rts;
      window.__tick(3);
      const lift = document.getElementById('rtsLift');
      const wk = window.__of(0, 'v_worker')[0];
      g.rtsSetSel([wk]);
      const wc = g.rtsCardItems().filter(Boolean);
      R.ui.menu = 'drop';
      const dc = g.rtsCardItems().filter((it) => it && /^drop:/.test(it.cmd));
      R.ui.menu = null;
      g.rtsSetSel([window.__hq]);
      const hc = g
        .rtsCardItems()
        .map((it, i) => (it ? i + ':' + it.label : ''))
        .filter(Boolean);
      return {
        fac: document.getElementById('rtsHud').dataset.fac,
        lift: lift && !lift.hidden ? lift.textContent : '',
        power: document.getElementById('rtsPower').hidden,
        wcmds: wc.map((it) => it.cmd).join(' '),
        dn: dc.length,
        note: (dc[0] && dc[0].note) || '',
        hc: hc.join(' '),
      };
    });
    check(
      c0.fac === 'veerwell' && /空投 0／2/.test(c0.lift) && c0.power,
      `資源列：陣營 ${c0.fac}、空投狀態「${c0.lift}」、沒有導管狀態`,
    );
    check(
      /menu:drop/.test(c0.wcmds) &&
        /gather/.test(c0.wcmds) &&
        /repair/.test(c0.wcmds) &&
        !/build:/.test(c0.wcmds),
      `物流 MT 的卡片：空投子選單、採集、修理，沒有建造（${c0.wcmds}）`,
    );
    check(c0.dn === 11 && /運輸機 0／2/.test(c0.note), `空投子選單：${c0.dn} 種建築、說明「${c0.note}」`);
    check(
      /0:物流 MT/.test(c0.hc) &&
        /1:英雄/.test(c0.hc) &&
        /4:空投建築/.test(c0.hc) &&
        /5:收起/.test(c0.hc) &&
        /6:物流交易/.test(c0.hc),
      `調度中心的卡片：${c0.hc}`,
    );

    // ---------- 空投預覽 ----------
    const dp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      g.rtsSetSel([hq]);
      R.ui.menu = 'drop';
      o.press = g.rtsCardPress(window.__slot('drop:v_depot'), false, true);
      o.mode = !!(R.ui.mode && R.ui.mode.drop && R.ui.mode.def === 'v_depot');
      const sp = window.__dspot('v_depot', hq.pos.x, hq.pos.z, 22, 40);
      o.sp = !!sp;
      if (!sp) return o;
      window.__look(sp.x, sp.z);
      let G = window.__mouse(sp.x, sp.z);
      o.ok = G.ok;
      o.why = G.why;
      o.same = G.why === g.rtsDropWhy(0, 'v_depot', G.x, G.z, 0);
      window.__tick(1);
      o.hint = document.getElementById('rtsModeHint').textContent;
      o.rings = R.ui.vRings && R.ui.vRings.visible ? { ...R.ui.vInfo } : null;
      // 沒探索過的地方：紅、原因
      const far = { x: -hq.pos.x * 0.9, z: -hq.pos.z * 0.9 };
      window.__look(far.x, far.z);
      G = window.__mouse(far.x, far.z);
      o.farOk = G.ok;
      o.farWhy = G.why;
      window.__tick(1);
      o.farHint = document.getElementById('rtsModeHint').textContent;
      // 放下去（Shift：模式保留）
      window.__look(sp.x, sp.z);
      window.__mouse(sp.x, sp.z);
      const ore0 = T.ore;
      g.rtsBuildAt(true);
      o.n1 = R.drops.length;
      o.paid = ore0 - T.ore;
      o.keep = !!R.ui.mode;
      const sp2 = window.__dspot('v_depot', sp.x, sp.z, 14, 30);
      window.__mouse(sp2.x, sp2.z);
      g.rtsBuildAt(false);
      o.n2 = R.drops.length;
      o.cleared = !R.ui.mode;
      window.__sim(0.2);
      window.__tick(2);
      o.lift = document.getElementById('rtsLift').textContent;
      g.rtsSetSel([hq]);
      R.ui.menu = 'drop';
      const c = window.__card('drop:v_depot');
      o.full = c ? c.dis : '';
      R.ui.menu = null;
      o.ringDrops = R.ui.vInfo ? R.ui.vInfo.drops : 0;
      // 空投完成：地基出現、運輸機飛回後空投數歸零
      window.__sim(40, () => !R.drops.length);
      window.__tick(1);
      o.depots = window.__of(0, 'v_depot').length;
      o.lift2 = document.getElementById('rtsLift').textContent;
      return o;
    });
    check(dp.press && dp.mode, '空投子選單的補給艙：進入空投預覽');
    if (dp.sp) {
      check(dp.ok && dp.same, `空投預覽：探索過的地方綠（原因和 rtsDropWhy 一致）`);
      check(/空投 補給艙/.test(dp.hint) && /運輸機 0／2/.test(dp.hint), `模式提示：「${dp.hint}」`);
      check(
        !!dp.rings && dp.rings.beacons >= 1,
        `空投模式畫投放範圍（信標 ${dp.rings && dp.rings.beacons}）`,
      );
      check(
        !dp.farOk && /探索/.test(dp.farWhy) && /探索/.test(dp.farHint),
        `沒探索過的地方紅：「${dp.farWhy}」`,
      );
      check(
        dp.n1 === 1 && dp.paid === 80 && dp.keep,
        `放下去：空投 1 件、扣 ${dp.paid} 礦石、Shift 時模式保留`,
      );
      check(dp.n2 === 2 && dp.cleared, '第二件：沒按 Shift 時離開預覽');
      check(
        /空投 2／2/.test(dp.lift) && /運輸機都在任務中/.test(dp.full),
        `運輸機都在任務中：「${dp.lift}」、卡片「${dp.full}」`,
      );
      check(dp.ringDrops === 2, `空投中的落點畫在地上（${dp.ringDrops}）`);
      check(
        dp.depots >= 2 && /空投 0／2/.test(dp.lift2),
        `空投完成：補給艙 ${dp.depots} 座、「${dp.lift2}」`,
      );
    }

    // ---------- 投放點與投放艙 ----------
    const pd = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const bay = window.__bld(0, 'v_bay', hq.pos.x + 30, hq.pos.z, 0);
      window.__bay = bay;
      const bp = window.__dspot('v_beacon', bay.pos.x, bay.pos.z, 40, 60) || {
        x: bay.pos.x,
        z: bay.pos.z + 45,
      };
      const bc = g.rtsSpawnBld(0, 'v_beacon', bp.x, bp.z, 0, 1);
      window.__bc = bc;
      bay.bld.rally = { x: bc.pos.x + 6, z: bc.pos.z };
      g.rtsSetSel([bay]);
      window.__look(bay.pos.x, bay.pos.z, 140);
      window.__tick(2);
      o.panel = document.getElementById('rtsPanel').textContent;
      o.rings = R.ui.vInfo ? { ...R.ui.vInfo } : null;
      g.rtsSetSel([bc]);
      window.__tick(1);
      o.bpanel = document.getElementById('rtsPanel').textContent;
      g.rtsQueue(bay, 'v_mt');
      window.__sim(30, () => R.pods.length > 0);
      o.pods = R.pods.length;
      window.__look(bc.pos.x, bc.pos.z, 90);
      window.__tick(2);
      o.lift = document.getElementById('rtsLift').textContent;
      o.marks = g._rtsPodMarks || 0;
      window.__sim(8, () => !R.pods.length);
      window.__tick(1);
      o.lift2 = document.getElementById('rtsLift').textContent;
      return o;
    });
    check(/投放點：信標內的集結點/.test(pd.panel), '軌道調度所的面板：投放點＝信標內的集結點');
    check(
      !!pd.rings && pd.rings.bays === 1 && pd.rings.beacons >= 2,
      `選了調度所：畫投放範圍與投放點（${JSON.stringify(pd.rings)}）`,
    );
    check(
      /投放半徑 14 m/.test(pd.bpanel) && /1 座建築以它為集結點/.test(pd.bpanel),
      `信標的面板：${pd.bpanel.slice(0, 60)}`,
    );
    check(
      pd.pods === 1 && /艙 1/.test(pd.lift) && pd.marks >= 1,
      `投放艙：資源列「${pd.lift}」、畫面上的倒數 ${pd.marks}`,
    );
    check(!/艙/.test(pd.lift2), '投放艙落地後資源列不再顯示');

    // ---------- 收起與展開 ----------
    const pk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const dpt =
        window.__of(0, 'v_depot').find((b) => b.bld.progress >= 1) ||
        window.__bld(0, 'v_depot', hq.pos.x - 30, hq.pos.z, 0);
      if (dpt.bld.progress < 1) dpt.bld.progress = 1;
      window.__dpt = dpt;
      g.rtsSetSel([dpt]);
      const c = window.__card('pack');
      o.lab = c && c.label;
      o.dis = c ? c.dis : 'none';
      g.rtsCardPress(window.__slot('pack'), false, true);
      o.p1 = dpt.bld.packed;
      window.__tick(1);
      o.panel1 = document.getElementById('rtsPanel').textContent;
      window.__sim(10, () => dpt.bld.packed === 2);
      o.p2 = dpt.bld.packed;
      window.__tick(1);
      o.cards = g
        .rtsCardItems()
        .map((it, i) => (it ? i + ':' + it.label : ''))
        .filter(Boolean)
        .join(' ');
      o.panel2 = document.getElementById('rtsPanel').textContent;
      // 移動（Q＝目標模式）
      const x0 = dpt.pos.x,
        z0 = dpt.pos.z;
      g.rtsCardPress(window.__slot('move'), false, true);
      o.mmode = R.ui.mode && R.ui.mode.order;
      const mv = window.__dspot('v_depot', hq.pos.x, hq.pos.z, 26, 44);
      g.rtsModeAt(mv.x, mv.z, null, false);
      window.__sim(3);
      o.moved = Math.hypot(dpt.pos.x - x0, dpt.pos.z - z0);
      // 展開（S＝預覽）
      g.rtsCardPress(window.__slot('pack'), false, true);
      o.umode = !!(R.ui.mode && R.ui.mode.unpack);
      const far = { x: -hq.pos.x * 0.9, z: -hq.pos.z * 0.9 };
      window.__look(far.x, far.z);
      let G = window.__mouse(far.x, far.z);
      o.farOk = G.ok;
      o.farWhy = G.why;
      window.__look(mv.x, mv.z);
      G = window.__mouse(mv.x, mv.z);
      o.ok = G.ok;
      o.why = G.why;
      g.rtsBuildAt(false);
      o.to = !!dpt.bld.unpackTo;
      window.__sim(30, () => dpt.bld.packed === 0);
      o.p0 = dpt.bld.packed;
      o.d = Math.hypot(dpt.pos.x - mv.x, dpt.pos.z - mv.z);
      g.rtsSetSel([dpt]);
      window.__tick(1);
      const c2 = window.__card('pack');
      o.cool = c2 ? c2.dis : '';
      o.panel3 = document.getElementById('rtsPanel').textContent;
      return o;
    });
    check(pk.lab === '收起' && !pk.dis && pk.p1 === 1, `收起卡（${pk.lab}）：按下去開始收起`);
    check(/收起中/.test(pk.panel1), '面板：收起中的進度');
    check(
      pk.p2 === 2 && /0:移動/.test(pk.cards) && /5:展開/.test(pk.cards),
      `收好：卡片只有移動與展開（${pk.cards}）`,
    );
    check(/收好：飛行中/.test(pk.panel2) && /生產、研究暫停/.test(pk.panel2), '面板：收好在飛、生產暫停');
    check(pk.mmode === 'move' && pk.moved > 3, `移動：收好的建築飛過去（${pk.moved.toFixed(1)} m）`);
    check(pk.umode && !pk.farOk && /探索/.test(pk.farWhy), `展開預覽：沒探索過的地方紅（${pk.farWhy}）`);
    check(
      pk.ok && pk.to && pk.p0 === 0 && pk.d < 14,
      `展開：飛到地點落地展開（離目標 ${pk.d.toFixed(1)} m）`,
    );
    check(/才能再收起/.test(pk.cool) && /秒後才能再收起/.test(pk.panel3), `展開後的冷卻：卡片「${pk.cool}」`);

    // ---------- 同時選多座收好的建築：S 依序指定展開地點（整合） ----------
    const pk2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const a = window.__bld(0, 'v_yard', hq.pos.x + 26, hq.pos.z, 0),
        b = window.__bld(0, 'v_depot', hq.pos.x, hq.pos.z + 26, 0);
      o.made = !!(a && b);
      if (!o.made) return o;
      g.rtsPack(a);
      g.rtsPack(b);
      window.__sim(15, () => a.bld.packed === 2 && b.bld.packed === 2);
      o.packed = a.bld.packed === 2 && b.bld.packed === 2;
      g.rtsSetSel([a, b]);
      window.__tick(1);
      g.rtsCardPress(window.__slot('pack'), false, true);
      o.m0 = !!(R.ui.mode && R.ui.mode.unpack);
      const s1 = window.__dspot('v_yard', hq.pos.x + 26, hq.pos.z, 0, 40);
      window.__look(s1.x, s1.z);
      window.__mouse(s1.x, s1.z);
      o.def1 = R.ui.mode && R.ui.mode.def;
      g.rtsBuildAt(false);
      o.n1 = [a, b].filter((x) => x.bld.unpackTo).length;
      o.m1 = !!(R.ui.mode && R.ui.mode.unpack);
      const s2 = window.__dspot('v_depot', hq.pos.x, hq.pos.z + 26, 0, 40);
      window.__look(s2.x, s2.z);
      window.__mouse(s2.x, s2.z);
      o.def2 = R.ui.mode && R.ui.mode.def;
      g.rtsBuildAt(false);
      o.n2 = [a, b].filter((x) => x.bld.unpackTo).length;
      o.m2 = !!R.ui.mode;
      return o;
    });
    check(pk2.made && pk2.packed && pk2.m0, '多座收好的建築：S 進入展開預覽');
    check(
      pk2.n1 === 1 && pk2.m1 && pk2.def2 !== pk2.def1,
      `第一下指定一座、預覽換成下一座（${pk2.def1} → ${pk2.def2}）`,
    );
    check(pk2.n2 === 2 && !pk2.m2, '第二下指定另一座、全部指定完離開展開模式');

    // ---------- 物流交易 ----------
    const tr = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      g.rtsSetSel([window.__hq]);
      R.ui.menu = 'trade';
      const c = g.rtsCardItems().filter((it) => it && it.cmd === 'trade');
      o.labs = c.map((it) => it.label + '|' + it.lvTxt).join(' ');
      o.dis0 = c.map((it) => it.dis).join('');
      const ore = T.ore,
        coral = T.coral;
      const i = g.rtsCardItems().findIndex((it) => it && it.cmd === 'trade' && it.label === '買 Coral');
      g.rtsCardPress(i, false, true);
      o.dOre = ore - T.ore;
      o.dCoral = T.coral - coral;
      R.ui.menu = 'trade';
      const c2 = g.rtsCardItems()[i];
      o.cool = c2.dis;
      o.cd = c2.ab ? c2.ab.cd : 0;
      R.ui.menu = null;
      return o;
    });
    check(
      /買 Coral\|礦石 100 → Coral 30/.test(tr.labs) &&
        /賣 Coral\|Coral 30 → 礦石 60/.test(tr.labs) &&
        !tr.dis0,
      `交易卡：${tr.labs}`,
    );
    check(tr.dOre === 100 && tr.dCoral === 30, `買 Coral：礦石 −${tr.dOre}、Coral +${tr.dCoral}`);
    check(/冷卻/.test(tr.cool) && tr.cd > 10, `交易後冷卻灰掉（${tr.cool}）`);

    // ---------- 運輸機 ----------
    const sh = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const cx = hq.pos.x + 20,
        cz = hq.pos.z + 22;
      const ship = g.rtsSpawn(0, 'v_dropship', cx, cz);
      const m1 = g.rtsSpawn(0, 'v_mt', cx + 8, cz - 4);
      const m2 = g.rtsSpawn(0, 'v_mt', cx + 11, cz - 4);
      window.__ship = ship;
      window.__sim(1);
      g.rtsSetSel([ship]);
      const lc = window.__card('load');
      o.load = lc ? lc.lvTxt + '|' + lc.dis : 'none';
      const uc = window.__card('unload');
      o.unload0 = uc ? uc.dis : 'none';
      g.rtsCardPress(window.__slot('load'), false, true);
      o.mode = R.ui.mode && R.ui.mode.order;
      g.rtsModeAt(m1.pos.x, m1.pos.z, m1, false);
      o.o1 = m1.orders[0] && m1.orders[0].k;
      g.rtsSetSel([ship]);
      g.rtsRightAt(m2.pos.x, m2.pos.z, m2, false);
      o.o2 = m2.orders[0] && m2.orders[0].k;
      R.groups[3] = [m1, ship];
      window.__sim(20, () => m1.rtsAboard && m2.rtsAboard);
      o.aboard = !!(m1.rtsAboard && m2.rtsAboard);
      g.rtsSetSel([ship]);
      window.__look(ship.pos.x, ship.pos.z, 80);
      window.__tick(2);
      const el = document.getElementById('rtsPanel');
      o.cargo = ((el.querySelector('.rtsCargo label') || {}).textContent || '').trim();
      o.cells = el.querySelectorAll('.rtsCg').length;
      o.out = !!el.querySelector('.rtsCgOut');
      o.seen = g.rtsSeen(m1);
      const s = window.__scr(m1.pos.x, m1.pos.z, m1.pos.y);
      const pick = g.rtsPickAt(s.x, s.y);
      o.pick = pick === m1 || pick === m2;
      // 編隊：略過登機的
      g.rtsKey({ code: 'Digit3', preventDefault() {}, stopImmediatePropagation() {} });
      o.grp = R.sel.map((e) => e.rtsDef).join();
      // 卸載
      g.rtsSetSel([ship]);
      const uc2 = window.__card('unload');
      o.unload1 = uc2 ? uc2.dis : 'none';
      g.rtsCardPress(window.__slot('unload'), false, true);
      o.umode = R.ui.mode && R.ui.mode.order;
      const to = window.__dspot('v_depot', hq.pos.x, hq.pos.z, 30, 48);
      g.rtsModeAt(to.x, to.z, null, false);
      o.tu = window.__sim(30, () => !ship.cargo.length);
      o.down = !m1.rtsAboard && !m2.rtsAboard && g.rtsSeen(m1);
      return o;
    });
    check(
      /^0／8\|$/.test(sh.load) && /沒有單位/.test(sh.unload0),
      `運輸機的卡片：載運「${sh.load}」、空的時卸載灰掉`,
    );
    check(sh.mode === 'load' && sh.o1 === 'board', '載運卡：目標模式點己方單位＝走過去登機');
    check(sh.o2 === 'board', '選運輸機右鍵己方地面單位＝載運');
    check(
      sh.aboard && /載運 4／8/.test(sh.cargo) && sh.cells === 2 && sh.out,
      `乘員面板：「${sh.cargo}」、${sh.cells} 格、卸載按鈕`,
    );
    check(!sh.seen && !sh.pick, '登機的單位點不到、不顯示');
    check(sh.grp === 'v_dropship', `編隊略過登機的單位（${sh.grp}）`);
    check(
      !sh.unload1 && sh.umode === 'unload' && sh.tu >= 0 && sh.down,
      `卸載：目標模式點地點、${sh.tu.toFixed(1)} 秒放下`,
    );

    // ---------- 空中單位、空投運輸機 ----------
    const air = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const jet = g.rtsSpawn(0, 'v_jet', hq.pos.x + 26, hq.pos.z - 24);
      jet.orders = [{ k: 'hold' }];
      window.__sim(3);
      o.alt = jet.pos.y - g.world.terrainHeight(jet.pos.x, jet.pos.z);
      window.__look(jet.pos.x, jet.pos.z, 100);
      const s = {};
      g.rtsScreen(jet, s);
      g.rtsBoxSelect(s.x - 30, s.y - 30, s.x + 30, s.y + 30, false);
      o.box = R.sel.includes(jet);
      window.__tick(1);
      o.lines = g._rtsAirLines || 0;
      // 空投運輸機：框選不選、單獨選取時「取消空投」
      const sp = window.__dspot('v_beacon', hq.pos.x, hq.pos.z, 30, 50);
      const rec = g.rtsDropOrder(0, 'v_beacon', sp.x, sp.z, 0);
      window.__sim(0.3);
      const car = g.rtsEnt(rec.ship);
      o.car = !!car;
      if (!car) return o;
      g.rtsScreen(car, s);
      const s2 = {};
      g.rtsScreen(jet, s2);
      g.rtsBoxSelect(
        Math.min(s.x, s2.x) - 40,
        Math.min(s.y, s2.y) - 40,
        Math.max(s.x, s2.x) + 40,
        Math.max(s.y, s2.y) + 40,
        false,
      );
      o.boxCar = R.sel.includes(car);
      o.boxJet = R.sel.includes(jet);
      g.rtsSetSel([car]);
      window.__tick(1);
      o.panel = document.getElementById('rtsPanel').textContent;
      const c = window.__card('dropcancel');
      o.cdis = c ? c.dis : 'none';
      const ore = R.teams[0].ore;
      g.rtsCardPress(window.__slot('dropcancel'), false, true);
      o.back = rec.st;
      o.refund = R.teams[0].ore - ore;
      o.idle = g.rtsIdleList('army').includes(car);
      jet.rtsQuiet = true;
      jet.die(null);
      return o;
    });
    check(air.alt > 6 && air.box, `空中單位（離地 ${air.alt.toFixed(1)} m）以模型的投影框選得到`);
    check(air.lines >= 1, '選取的空中單位畫到地面的細線');
    if (air.car) {
      check(!air.boxCar && air.boxJet, '框選不選空投運輸機');
      check(
        /空投：投放信標/.test(air.panel) && air.cdis === '',
        `空投運輸機的面板：${air.panel.slice(0, 40)}`,
      );
      check(air.back === 'back' && air.refund > 0 && !air.idle, `取消空投：運輸機折返、退還 ${air.refund}`);
    }

    // ---------- 自動管家（空投） ----------
    const bu = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      window.__sim(15, () => !R.drops.length);
      R.butler.on = true;
      R.butler.depot = true;
      g.rtsRecount();
      T.cap = T.pop + 3;
      R.butler._depotT = 0;
      const n0 = R.drops.length;
      g.rtsButlerDepot(T);
      const d = R.drops[R.drops.length - 1];
      o.drop = R.drops.length - n0 === 1 && d && d.def;
      o.why = d ? g.rtsDropSiteWhy(0, d.def, d.x, d.z, 0) : 'none';
      o.wk = R.units.some((e) => !e.dead && e.rtsTeam === 0 && e.orders.some((q) => q.k === 'build'));
      R.butler._depotT = 0;
      g.rtsButlerDepot(T);
      o.dup = R.drops.length - n0;
      R.butler.on = false;
      g.rtsRecount();
      return o;
    });
    check(
      bu.drop === 'v_depot' && bu.why === '' && !bu.wk,
      `自動管家：人口快滿時空投補給艙（不派工人，${bu.drop}）`,
    );
    check(bu.dup === 1, '自動管家：空投中的補給艙不重複下單');

    // ---------- 親自駕駛維爾威英雄 ----------
    const pl = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      hq.bld.queue.length = 0;
      g.rtsQueue(hq, 'h_courier');
      window.__sim(90, () => window.__of(0, 'h_courier').length > 0);
      const h = window.__of(0, 'h_courier')[0];
      o.hero = !!h;
      if (!h) return o;
      if (!h.hero) {
        const rec = {
          def: 'h_courier',
          lv: 1,
          xp: 0,
          pts: 1,
          sk: [0, 0, 0, 0],
          cd: [0, 0, 0, 0],
          inv: [],
          ent: h,
        };
        (R.teams[0].heroes || (R.teams[0].heroes = [])).push(rec);
        h.hero = rec;
      }
      h.rtsAboard = window.__ship.id;
      o.aboard = g.rtsPilotCan(h);
      h.rtsAboard = null;
      const bay = window.__bay,
        bc = window.__bc;
      const r0 = bay.bld.rally ? { ...bay.bld.rally } : null;
      o.can = g.rtsPilotCan(h);
      o.enter = g.rtsPilotEnter(h);
      o.state = g.state;
      // C 包的技能（有實作時）：學 Z 急件突進，往準星的地點施放；特快專送在親自駕駛中不能施放
      if (typeof g.rtsSkillCast === 'function' && typeof g.rtsHeroLearn === 'function' && h.hero) {
        h.hero.pts = Math.max(h.hero.pts || 0, 2);
        g.rtsHeroLearn(h, 0);
        h.lock = null;
        o.lv = (h.hero.sk || [])[0];
        o.why0 = g.rtsHudSkillWhy(h, 0);
        // 找一個沒有被擋住的方向（急件突進碰到建築就不施放）
        for (let i = 0; i < 8 && !o.blitz; i++) {
          const a = (i / 8) * Math.PI * 2;
          const p = new THREE.Vector3(h.pos.x + Math.cos(a) * 12, h.pos.y, h.pos.z + Math.sin(a) * 12);
          g.aimRet = p;
          if (g.mouseWorld) g.mouseWorld.copy(p);
          o.blitz = g.rtsPilotSkill(0);
        }
        o.c = true;
      }
      // 英雄站在信標旁：跟隨時集結點移到英雄身邊
      h.pos.set(bc.pos.x + 5, g.world.terrainHeight(bc.pos.x + 5, bc.pos.z + 3), bc.pos.z + 3);
      R.butler.follow = true;
      o.rally = g.rtsButlerRally(h);
      o.rd = bay.bld.rally ? Math.hypot(bay.bld.rally.x - h.pos.x, bay.bld.rally.z - h.pos.z) : -1;
      o.via = g.rtsDropPoint(bay).via;
      window.__sim(0.3);
      window.__tick(2);
      o.lift = document.getElementById('rtsLift').textContent;
      o.exit = g.rtsPilotExit('key');
      o.back = g.state;
      o.restored = JSON.stringify(bay.bld.rally) === JSON.stringify(r0);
      return o;
    });
    check(pl.hero, '調度中心生產英雄 COURIER');
    if (pl.hero) {
      check(/運輸機/.test(pl.aboard), `在運輸機上不能親自駕駛（${pl.aboard}）`);
      check(
        pl.can === 'ok' && pl.enter && pl.state === 'play' && pl.exit && pl.back === 'rts',
        '親自駕駛維爾威英雄：進入與離開',
      );
      check(
        pl.rally >= 1 && pl.rd >= 0 && pl.rd < 1 && pl.via === 'beacon',
        '親自駕駛＋跟隨：英雄在信標內時投放艙降在英雄旁',
      );
      check(pl.restored, '離開親自駕駛：集結點還原');
      if (pl.c) check(pl.blitz, `親自駕駛：Z＝急件突進（準星的地點；${pl.lv} 級、${pl.why0 || '可以'}）`);
      check(/空投/.test(pl.lift), `親自駕駛時資源列照樣顯示空投（${pl.lift}）`);
    }
    // 特快專送的目標模式：從英雄畫到游標地點的直線（整合）
    const ex = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const h = window.__of(0, 'h_courier')[0];
      if (!h) return { none: true };
      g.rtsSetSel([h]);
      g.rtsSetMode({ k: 'target', order: 'ability', ab: 'sk_express', target: 'any', label: '特快專送' });
      window.__look(h.pos.x + 20, h.pos.z);
      window.__mouse(h.pos.x + 35, h.pos.z);
      window.__tick(1);
      const on = g._rtsExpressLine;
      g.rtsSetMode({ k: 'target', order: 'ability', ab: 'sk_carpet', target: 'line', label: '' });
      window.__tick(1);
      const off = g._rtsExpressLine;
      g.rtsSetMode(null);
      return { on, off };
    });
    if (!ex.none) check(ex.on && !ex.off, '特快專送的目標模式：畫到目的地的直線（其他技能不畫）');

    // ---------- 三種大小 ----------
    const lay = async (pg, tag) => {
      await pg.evaluate(() => {
        const g = window.__game,
          R = g.rts,
          hq = window.__hq;
        g.resize();
        g.rtsSetMode(null);
        R.ui.menu = null;
        g.rtsSetSel([hq]);
        R.ui.menu = 'drop';
        g.rtsCardPress(window.__slot('drop:v_bay'), false, true);
        const sp = window.__dspot('v_bay', hq.pos.x, hq.pos.z, 26, 50) || hq.pos;
        window.__look(sp.x, sp.z, 130);
        window.__mouse(sp.x, sp.z);
        window.__tick(4);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r4-hud-${tag}.png`) });
      return pg.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const top = r('rtsTop'),
          lf = r('rtsLift'),
          bot = r('rtsBottom'),
          card = r('rtsCard');
        return {
          ok:
            lf.right <= innerWidth + 0.5 &&
            lf.bottom <= top.bottom + 0.5 &&
            lf.width > 0 &&
            card.right <= innerWidth + 0.5 &&
            bot.bottom <= innerHeight + 0.5,
          sw: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    };
    const l1 = await lay(page, '1920');
    await page.setViewportSize({ width: 1180, height: 820 });
    const l2 = await lay(page, '1180');
    check(l1.ok && l1.sw && l2.ok && l2.sw, '1920×1080、1180×820：空投狀態在資源列裡、不超出畫面');
    // 運輸機的乘員面板（截圖）
    await ev(() => {
      const g = window.__game;
      g.rtsSetMode(null);
      const ship = window.__ship;
      for (const u of window.__of(0, 'v_mt').slice(0, 3)) g.rtsBoard(u, ship);
      g.rtsSetSel([ship]);
      window.__look(ship.pos.x, ship.pos.z, 80);
      window.__tick(3);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4-hud-cargo.png') });
    await ctx.close();
    // 手機橫式（觸控）
    const c2 = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    if (H.watch) H.watch(pg, 'rtsVeerHud-phone');
    await setup(pg, base, 7);
    const l3 = await lay(pg, '844');
    check(l3.ok && l3.sw, '844×390 觸控：空投狀態、下方列不超出畫面');
    await c2.close();
  }

  return { testRtsVeerHud };
};
