// Coral 戰爭（RTS）R3 E 包（艾瑟立克的 HUD、輸入、親自駕駛，docs/rts-design.md 14.15）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-aeth-e')(H)。
// testRtsAethHud：資源列的陣營（導管狀態）、研究作業機沒有修理卡、研究中樞的卡片、建造預覽（導管範圍外紅、範圍內綠、
//   原因在模式提示、節點的連接距離）、範圍圈（建造模式與選取導管建築時顯示、選工人時不顯示）、斷電（事件只發一次、
//   資源列變紅、選取面板「無導管供電」、恢復的事件）、融合卡片（需求、選 2 隻、3 隻＝1 組、7 隻＝2 組＋剩 1 隻、
//   按下去分組、引導進度）、結晶護壁從指令卡施放（建築傳給 rtsOrder、冷卻時灰掉與原因）、自己的幻象標「幻象」（敵方的不標）、
//   自動管家（艾瑟立克不派修理、補給＝導管節點且蓋在有電的地方）、親自駕駛艾瑟立克英雄（幻象不能駕駛）、選單、
//   三種大小的截圖 rts-r3-hud-{1920,1180,844}.png。
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
        faction: 'aetheric',
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
      window.__hq = window.__of(0, 'a_hq')[0];
      window.__D = (id) => g.rtsUiDef(id);
      // 世界座標 → 螢幕座標（建造預覽用 ui.mx／my）
      window.__scr = (x, z) => {
        const v = new THREE.Vector3(x, g.world.terrainHeight(x, z), z).project(g.camera);
        return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
      };
      // 離 c 距離在 [d0, d1] 之間、可以蓋 w×d、探索過的點
      window.__ring = (c, d0, d1, w, d) => {
        const nav = g.world.nav;
        for (let r = d0; r <= d1; r += 1)
          for (let a = 0; a < 48; a++) {
            const x = c.x + Math.cos((a / 48) * Math.PI * 2) * r,
              z = c.z + Math.sin((a / 48) * Math.PI * 2) * r;
            if (Math.abs(x) > g.world.size / 2 - 20 || Math.abs(z) > g.world.size / 2 - 20) continue;
            if (!nav.buildable(x, z, w, d)) continue;
            if (g.rtsFogState(0, x, z) === 0) continue;
            return { x, z };
          }
        return null;
      };
      // 有電的地方放一座蓋好的建築
      window.__pbld = (team, def, x, z, maxR = 24) => {
        const D = window.__D(def);
        const nav = g.world.nav;
        for (let r = 0; r <= maxR; r += 1)
          for (let a = 0; a < 36; a++) {
            const px = x + Math.cos((a / 36) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 36) * Math.PI * 2) * r;
            if (nav.buildable(px, pz, D.foot[0] + 1, D.foot[1] + 1) && !g.rtsPowerWhy(team, def, px, pz))
              return g.rtsSpawnBld(team, def, px, pz, 0, 1);
            if (r === 0) break;
          }
        return null;
      };
      g.rtsInputInit();
      return { ok: !!window.__hq };
    }, seed);
  }

  async function testRtsAethHud(browser, base) {
    console.log(
      'Coral 戰爭：艾瑟立克的 HUD（導管範圍、停擺、融合卡片、結晶護壁、幻象、管家、親自駕駛）（R3 E）',
    );
    const { ctx, page } = await newPage(browser, 'rtsAethHud');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await setup(page, base, 7);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 資源列、卡片 ----------
    const c0 = await ev(() => {
      const g = window.__game,
        R = g.rts;
      window.__tick(3);
      const pw = document.getElementById('rtsPower');
      const wk = window.__of(0, 'a_worker')[0];
      g.rtsSetSel([wk]);
      const wc = g.rtsCardItems().filter(Boolean);
      R.ui.menu = 'build';
      const bc = g
        .rtsCardItems()
        .filter(Boolean)
        .map((it) => it.label);
      R.ui.menu = null;
      g.rtsSetSel([window.__hq]);
      const hc = g
        .rtsCardItems()
        .map((it, i) => (it ? i + ':' + it.label : ''))
        .filter(Boolean);
      return {
        fac: document.getElementById('rtsHud').dataset.fac,
        pw: pw && !pw.hidden ? pw.textContent : '',
        repair: wc.some((it) => /repair/.test(it.cmd)),
        wcmds: wc.map((it) => it.cmd).join(' '),
        bc: bc.join('、'),
        hc: hc.join(' '),
      };
    });
    check(c0.fac === 'aetheric' && /導管 1/.test(c0.pw), `資源列：陣營 ${c0.fac}、導管狀態「${c0.pw}」`);
    check(!c0.repair && /build/.test(c0.wcmds), `研究作業機沒有修理卡（${c0.wcmds}）`);
    check(/導管節點/.test(c0.bc) && /生體培養槽/.test(c0.bc), `建造子選單：${c0.bc}`);
    check(
      /0:研究作業機/.test(c0.hc) && /1:英雄/.test(c0.hc) && /3:結晶護壁/.test(c0.hc),
      `研究中樞的卡片：${c0.hc}`,
    );

    // ---------- 建造預覽與範圍圈 ----------
    const gh = await ev(() => {
      const g = window.__game,
        R = g.rts,
        ui = R.ui;
      const hq = window.__hq;
      g.rtsCamJump(hq.pos.x, hq.pos.z);
      R.cam.dist = 150;
      const wk = window.__of(0, 'a_worker')[0];
      g.rtsSetSel([wk]);
      window.__tick(2);
      const o = {};
      const at = (p) => {
        const s = window.__scr(p.x, p.z);
        ui.mx = s.x;
        ui.my = s.y;
        g.rtsGhostUpdate();
        window.__tick(1);
        return {
          ok: ui.ghost.ok,
          why: ui.ghost.why,
          hint: document.getElementById('rtsModeHint').textContent,
          gr: !!(ui.gRing && ui.gRing.visible),
        };
      };
      // 培養槽：範圍外（30～38 m）紅、範圍內綠
      g.rtsSetMode({ k: 'build', def: 'a_lab', D: window.__D('a_lab') });
      const out = window.__ring(hq.pos, 30, 60, 12, 12);
      const inn = window.__ring(hq.pos, 16, 20, 12, 12);
      o.pts = [!!out, !!inn];
      o.out = out ? at(out) : null;
      o.inn = inn ? at(inn) : null;
      o.rings = !!(ui.rings3 && ui.rings3.g.visible) && ui.rings3.n === R.teams[0].power.srcs.length;
      // 導管節點：32 m 內綠（並畫自己的範圍與連接距離）、40 m 以外紅
      g.rtsSetMode({ k: 'build', def: 'a_node', D: window.__D('a_node') });
      const n1 = window.__ring(hq.pos, 27, 30, 4, 4);
      const n2 = window.__ring(hq.pos, 40, 46, 4, 4);
      o.n1 = n1 ? at(n1) : null;
      o.n2 = n2 ? at(n2) : null;
      // 放下：rtsBuildAt 派工人（rtsPowerWhy 擋住範圍外的）
      g.rtsSetMode({ k: 'build', def: 'a_lab', D: window.__D('a_lab') });
      if (out) at(out);
      g.rtsBuildAt(false);
      o.badOrder = wk.orders.some((q) => q.k === 'build');
      g.rtsSetMode(null);
      window.__tick(1);
      o.offMode = !(ui.rings3 && ui.rings3.g.visible);
      // 選取研究中樞：顯示範圍圈；選工人：不顯示
      g.rtsSetSel([hq]);
      window.__tick(1);
      o.selHq = !!(ui.rings3 && ui.rings3.g.visible);
      g.rtsSetSel([wk]);
      window.__tick(1);
      o.selWk = !!(ui.rings3 && ui.rings3.g.visible);
      g.rtsSetMode({ k: 'build', def: 'a_lab', D: window.__D('a_lab') });
      if (out) at(out);
      window.__out = out;
      return o;
    });
    check(gh.pts[0] && gh.pts[1], '找得到導管範圍內外可以蓋的位置');
    check(
      gh.out && !gh.out.ok && /導管範圍/.test(gh.out.why) && /導管範圍/.test(gh.out.hint),
      `建造預覽：範圍外紅（${gh.out && gh.out.why}；提示「${gh.out && gh.out.hint}」）`,
    );
    check(gh.inn && gh.inn.ok && !gh.inn.gr, '建造預覽：範圍內綠（培養槽不是供電源，不畫自己的範圍）');
    check(gh.rings, '建造模式：畫出己方全部的導管範圍圈');
    check(
      gh.n1 && gh.n1.ok && gh.n1.gr && gh.n2 && !gh.n2.ok && /32 m/.test(gh.n2.why),
      `導管節點：32 m 內綠並畫自己的範圍、太遠紅（${gh.n2 && gh.n2.why}）`,
    );
    check(!gh.badOrder, '範圍外放不下去（沒有派工人）');
    check(gh.offMode && gh.selHq && !gh.selWk, '範圍圈：取消建造時消失、選研究中樞時顯示、選工人時不顯示');
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3-hud-ghost.png') });

    // ---------- 斷電 ----------
    const pw = await ev(() => {
      const g = window.__game,
        R = g.rts,
        ui = R.ui;
      g.rtsSetMode(null);
      const hq = window.__hq;
      const o = {};
      // 節點在 26～30 m（研究中樞範圍外一點），培養槽靠節點那一側、在研究中樞範圍外
      const p = window.__ring(hq.pos, 16, 25, 4, 4);
      const node = g.rtsSpawnBld(0, 'a_node', p.x, p.z, 0, 1);
      const dx = (p.x - hq.pos.x) / Math.hypot(p.x - hq.pos.x, p.z - hq.pos.z),
        dz = (p.z - hq.pos.z) / Math.hypot(p.x - hq.pos.x, p.z - hq.pos.z);
      let lab = null;
      const nav = g.world.nav;
      for (let r = 8; r <= 18 && !lab; r += 1)
        for (let a = -17; a <= 17 && !lab; a++) {
          const ang = Math.atan2(dz, dx) + a * 0.18;
          const x = p.x + Math.cos(ang) * r,
            z = p.z + Math.sin(ang) * r;
          if (Math.hypot(x - hq.pos.x, z - hq.pos.z) < 28) continue;
          if (!nav.buildable(x, z, 12, 12) || g.rtsPowerWhy(0, 'a_lab', x, z)) continue;
          lab = g.rtsSpawnBld(0, 'a_lab', x, z, 0, 1);
        }
      window.__node = node;
      window.__lab = lab;
      o.ok = !!node && !!lab && !lab.bld.off;
      window.__sim(1);
      const n0 = ui.events.filter((e) => /導管中斷/.test(e.txt)).length;
      node.die(null);
      window.__sim(1.5);
      window.__tick(2);
      o.ev = ui.events.filter((e) => /導管中斷/.test(e.txt)).length - n0;
      o.off = lab.bld.off;
      o.pw = document.getElementById('rtsPower').textContent;
      o.pwOff = document.getElementById('rtsPower').classList.contains('off');
      g.rtsSetSel([lab]);
      window.__tick(1);
      o.panel = document.getElementById('rtsPanel').textContent;
      o.ringOff = !!(ui.rings3 && ui.rings3.g.visible);
      // 再等一下：不會重複發
      window.__sim(3);
      o.ev2 = ui.events.filter((e) => /導管中斷/.test(e.txt)).length - n0;
      g.rtsCamJump(lab.pos.x, lab.pos.z);
      window.__tick(2);
      window.__offShot = true;
      return o;
    });
    check(pw.ok, '導管節點＋它供電的培養槽');
    check(
      pw.off && pw.ev === 1 && pw.ev2 === 1,
      `拆掉節點：培養槽停擺、「導管中斷」事件只發一次（${pw.ev}／${pw.ev2}）`,
    );
    check(pw.pwOff && /停擺 1/.test(pw.pw), `資源列變紅：「${pw.pw}」`);
    check(/無導管供電/.test(pw.panel), `選取面板顯示「無導管供電」（${pw.panel.slice(0, 60)}）`);
    check(pw.ringOff, '選取停擺的建築也顯示範圍圈');
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3-hud-off.png') });
    const back = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const n = g.rtsSpawnBld(0, 'a_node', window.__node.pos.x, window.__node.pos.z, 0, 1);
      window.__node = n;
      window.__sim(1);
      window.__tick(2);
      return {
        on: !window.__lab.bld.off,
        ev: R.ui.events.some((e) => /導管恢復/.test(e.txt)),
        pw: document.getElementById('rtsPower').textContent,
      };
    });
    check(back.on && back.ev && /導管/.test(back.pw), `重蓋節點：恢復、「導管恢復」事件（${back.pw}）`);

    // ---------- 融合卡片 ----------
    const fu = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq = window.__hq;
      const o = {};
      const mk = (n, x, z) => {
        const L = [];
        for (let i = 0; i < n; i++)
          L.push(g.rtsSpawn(0, 'a_blob', x + (i % 4) * 2.2, z + Math.floor(i / 4) * 2.2));
        return L;
      };
      const card = () => g.rtsCardItems().find((it) => it && it.cmd === 'fuse');
      const c = window.__ring(hq.pos, 20, 30, 8, 8);
      const b7 = mk(7, c.x, c.z);
      g.rtsSetSel(b7.slice(0, 3));
      let it = card();
      o.req = it ? it.dis : 'none';
      // T2＋培養槽（上面已經有）：研究中樞升級要兵器廠
      window.__pbld(0, 'a_foundry', hq.pos.x, hq.pos.z);
      g.rtsUpgrade(hq, 'a_hq2');
      o.upT = window.__sim(60, () => hq.rtsDef === 'a_hq2');
      window.__sim(0.3);
      // 原本的位置：重新排好
      b7.forEach((e, i) => e.pos.set(c.x + (i % 4) * 2.2, e.pos.y, c.z + Math.floor(i / 4) * 2.2));
      g.rtsSetSel(b7.slice(0, 2));
      it = card();
      o.two = it ? it.dis : 'none';
      g.rtsSetSel(b7.slice(0, 3));
      it = card();
      o.three = it ? [it.dis, it.lvTxt] : null;
      g.rtsSetSel(b7);
      it = card();
      o.seven = it ? [it.dis, it.lvTxt, it.tip] : null;
      const slot = g.rtsCardItems().findIndex((q) => q && q.cmd === 'fuse');
      g.rtsCardDraw();
      g.rtsTipShow(slot);
      o.tipBox = document.getElementById('rtsTip').textContent;
      g.rtsTipHide();
      g.rtsCardPress(slot, false, true);
      o.fuses = R.fuses.length;
      window.__sim(8, () => R.fuses.some((f) => f.st === 'chan'));
      const f = R.fuses.find((q) => q.st === 'chan');
      if (f) {
        window.__sim(1);
        g.rtsSetSel([f.host]);
        window.__tick(2);
        o.chan = document.getElementById('rtsPanel').textContent;
      }
      window.__sim(10, () => !R.fuses.length);
      o.chim = window.__of(0, 'a_chimera').length;
      return o;
    });
    check(/需要/.test(fu.req), `融合卡片：T1 時灰掉（${fu.req}）`);
    check(fu.upT > 0, `研究中樞升級到 T2（${fu.upT.toFixed(1)} 秒）`);
    check(/選了 2 隻/.test(fu.two), `選 2 隻：灰掉（${fu.two}）`);
    check(
      fu.three && !fu.three[0] && fu.three[1] === '1 組',
      `選 3 隻：可以按（${fu.three && fu.three[1]}）`,
    );
    check(
      fu.seven &&
        !fu.seven[0] &&
        fu.seven[1] === '2 組' &&
        /剩 1 隻/.test(fu.seven[2]) &&
        /2 組/.test(fu.tipBox),
      `選 7 隻：2 組、剩 1 隻（${JSON.stringify(fu.seven)}；說明框：${fu.tipBox.slice(0, 50)}…）`,
    );
    check(fu.fuses === 2, `按下融合：分成 ${fu.fuses} 組`);
    check(
      /融合引導/.test(fu.chan || ''),
      `引導中的宿主：選取面板的引導進度（${(fu.chan || '').slice(0, 50)}）`,
    );
    check(fu.chim === 2, `融合完成：嵌合體 ${fu.chim} 隻`);

    // ---------- 結晶護壁、幻象 ----------
    const ag = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq = window.__hq;
      const o = {};
      g.rtsSetSel([hq]);
      const card = () => g.rtsCardItems().find((it) => it && it.cmd === 'ability:ab_aegis');
      let it = card();
      o.dis0 = it ? it.dis : 'none';
      const c0 = R.teams[0].coral;
      g.rtsCardPress(
        g.rtsCardItems().findIndex((q) => q && q.cmd === 'ability:ab_aegis'),
        false,
        true,
      );
      o.cd = (hq.rtsCd && hq.rtsCd.ab_aegis) > R.t;
      o.paid = Math.round(c0 - R.teams[0].coral);
      o.buff = (hq.rtsAegisT || 0) > R.t;
      window.__tick(1);
      it = card();
      o.dis1 = it ? it.dis : 'none';
      o.cool = !!document.querySelector('#rtsCard .rtsCmd.cool');
      o.panel = document.getElementById('rtsPanel').textContent;
      // 幻象：自己的標「幻象」、敵方的不標
      const ch = window.__of(0, 'a_chimera')[0];
      const il = g.rtsIllusion(ch, ch.pos.x + 4, ch.pos.z, { sec: 20, dmg: 0, hp: 1 });
      g.rtsSetSel([il]);
      window.__tick(1);
      o.own = document.getElementById('rtsPanel').textContent;
      const foe = g.rtsSpawn(1, 'c_mt', ch.pos.x + 8, ch.pos.z + 8);
      foe.updateAI = () => {};
      const fil = g.rtsIllusion(foe, foe.pos.x + 3, foe.pos.z, { sec: 20, dmg: 0, hp: 1 });
      fil.updateAI = () => {};
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, true);
      g.rtsFogTick && g.rtsFogTick(0.5);
      g.rtsSetSel([fil]);
      window.__tick(1);
      o.foe = document.getElementById('rtsPanel').textContent;
      g.rtsSetSel([il, ch]);
      window.__tick(1);
      o.multi = !!document.querySelector('#rtsPanel .rtsU.illus');
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, false);
      fil.die(null);
      foe.die(null);
      return o;
    });
    check(
      !ag.dis0 && ag.cd && ag.paid === 60 && ag.buff,
      `結晶護壁從指令卡施放（扣 ${ag.paid} Coral、建築的護壁）`,
    );
    check(/冷卻/.test(ag.dis1) && ag.cool, `施放後：卡片灰掉（${ag.dis1}）`);
    check(/結晶護壁/.test(ag.panel), '選取面板：結晶護壁的剩餘秒數');
    check(/幻象/.test(ag.own) && !/幻象/.test(ag.foe), '自己的幻象標「幻象」、敵方的幻象看不出來');
    check(ag.multi, '多選時自己的幻象格子是虛線框');

    // ---------- 自動管家 ----------
    const bu = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      o.noRep = g.rtsButlerNoRepair(T);
      // 受傷的建築＋附近的敵人：不派修理
      const lab = window.__lab;
      lab.hp = lab.maxHp * 0.4;
      lab._bHurtT = R.t;
      const foe = g.rtsSpawn(1, 'c_mt', lab.pos.x + 12, lab.pos.z);
      foe.updateAI = () => {};
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, true);
      g.rtsFogTick && g.rtsFogTick(0.5);
      R.butler.on = true;
      R.butler.defend = true;
      R.butler.depot = true;
      g.rtsButlerDefend(T);
      o.rep = R.units.some((w) => !w.dead && w.orders[0] && w.orders[0].k === 'repair');
      foe.die(null);
      g.rtsFogRevealAll && g.rtsFogRevealAll(0, false);
      // 人口快滿：管家蓋導管節點（在有電的地方）
      g.rtsRecount();
      T.cap = T.pop + 3;
      const cap = T.cap;
      R.butler._depotT = 0;
      g.rtsButlerDepot(T);
      const w = R.units.find((e) => !e.dead && e.rtsTeam === 0 && e.orders.some((q) => q.k === 'build'));
      const b = w && w.orders.find((q) => q.k === 'build');
      o.def = b ? b.def : '';
      o.why = b ? g.rtsPowerWhy(0, b.def, b.x, b.z) : 'none';
      window.__sim(40, () => window.__of(0, 'a_node').some((n) => n !== window.__node));
      o.built = window.__of(0, 'a_node').length;
      void cap;
      R.butler.on = false;
      return o;
    });
    check(bu.noRep && !bu.rep, '自動管家：艾瑟立克的工人不能修理，不派修理');
    check(
      bu.def === 'a_node' && bu.why === '' && bu.built >= 2,
      `自動管家：人口快滿時蓋導管節點（有電的地方，${bu.built} 座）`,
    );

    // ---------- 親自駕駛艾瑟立克英雄 ----------
    const pl = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq = window.__hq;
      const o = {};
      hq.bld.queue.length = 0;
      g.rtsQueue(hq, 'h_prism');
      window.__sim(90, () => window.__of(0, 'h_prism').length > 0);
      const h = window.__of(0, 'h_prism')[0];
      o.hero = !!h;
      if (!h) return o;
      if (!h.hero) {
        const rec = {
          def: 'h_prism',
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
      const il = g.rtsIllusion(h, h.pos.x + 3, h.pos.z, { sec: 10 });
      o.illus = il ? g.rtsPilotCan(il) : 'none';
      o.can = g.rtsPilotCan(h);
      o.enter = g.rtsPilotEnter(h);
      o.state = g.state;
      o.player = g.player === h;
      window.__sim(0.5);
      window.__tick(2);
      o.exit = g.rtsPilotExit('key');
      o.back = g.state;
      o.player2 = g.player === null;
      if (il && !il.dead) il.die(null);
      return o;
    });
    check(pl.hero, '研究中樞生產英雄 PRISM');
    if (pl.hero) {
      check(/幻象/.test(pl.illus), `幻象不能親自駕駛（${pl.illus}）`);
      check(
        pl.can === 'ok' && pl.enter && pl.state === 'play' && pl.player && pl.back === 'rts' && pl.player2,
        '親自駕駛艾瑟立克英雄：進入（state play、this.player）與離開',
      );
    }

    // ---------- 三種大小 ----------
    const lay = async (pg, tag) => {
      await pg.evaluate(() => {
        const g = window.__game,
          R = g.rts;
        g.resize();
        const wk = window.__of(0, 'a_worker')[0];
        g.rtsSetSel([wk]);
        g.rtsCamJump(window.__hq.pos.x, window.__hq.pos.z);
        R.cam.dist = 130;
        window.__tick(2);
        g.rtsSetMode({ k: 'build', def: 'a_lab', D: window.__D('a_lab') });
        const p = window.__ring(window.__hq.pos, 30, 60, 12, 12) || window.__hq.pos;
        const s = window.__scr(p.x, p.z);
        R.ui.mx = s.x;
        R.ui.my = s.y;
        window.__tick(4);
      });
      await pg.screenshot({ path: path.join(SHOT_DIR, `rts-r3-hud-${tag}.png`) });
      return pg.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect();
        const top = r('rtsTop'),
          pw = r('rtsPower'),
          bot = r('rtsBottom'),
          card = r('rtsCard');
        return {
          ok:
            pw.right <= innerWidth + 0.5 &&
            pw.bottom <= top.bottom + 0.5 &&
            pw.width > 0 &&
            card.right <= innerWidth + 0.5 &&
            bot.bottom <= innerHeight + 0.5,
          sw: document.documentElement.scrollWidth <= innerWidth,
        };
      });
    };
    const l1 = await lay(page, '1920');
    await page.setViewportSize({ width: 1180, height: 820 });
    const l2 = await lay(page, '1180');
    check(l1.ok && l1.sw && l2.ok && l2.sw, '1920×1080、1180×820：導管狀態在資源列裡、不超出畫面');
    // 選單
    const mn = await ev(() => {
      const g = window.__game;
      g.rtsSetMode(null);
      g.rtsAbort ? g.rtsAbort() : g.rtsMenuOpen();
      if (g.state !== 'rtsmenu') g.rtsMenuOpen();
      const el = document.getElementById('rtsMenu');
      const b = el && el.querySelector('[data-pf="aetheric"]');
      if (b) b.click();
      return {
        btn: !!b && !b.disabled,
        rand: !!(el && el.querySelector('.rtsFacRand')),
        traits: document.querySelectorAll('#rtsMenu .rtsFacTraits li').length,
        rec: ((document.querySelector('#rtsMenu .rtsRec') || {}).textContent || '').trim(),
      };
    });
    check(
      mn.btn && mn.rand && mn.traits === 3 && /艾瑟立克/.test(mn.rec),
      `選單：艾瑟立克、隨機、3 行特色、戰績（${mn.rec}）`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3-hud-menu.png') });
    await ctx.close();
    // 手機橫式（觸控）
    const c2 = await browser.newContext({
      viewport: { width: 844, height: 390 },
      hasTouch: true,
      isMobile: true,
    });
    const pg = await c2.newPage();
    if (H.watch) H.watch(pg, 'rtsAethHud-phone');
    await setup(pg, base, 7);
    const l3 = await lay(pg, '844');
    check(l3.ok && l3.sw, '844×390 觸控：導管狀態、下方列不超出畫面');
    await c2.close();
  }

  return { testRtsAethHud };
};
