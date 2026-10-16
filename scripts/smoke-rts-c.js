// Coral 戰爭（RTS）R2 C 包（英雄與道具）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-c')(H)。
// testRtsHero：第 1 個英雄免費、第 2 個要 T2；經驗表（擊破 lv 2 單位 +40、兩位英雄在 40 m 內平分、40 m 外沒有）、
//   升級與技能點、學習的等級限制、三位英雄 12 個技能（Coral、冷卻、效果）、死亡 → 主堡復活、10 級上限、酒館英雄的雇用
//   與 32 個技能都能施放；技能效果的截圖。
// testRtsItems：補給商店依層級的貨架、買、用、丟、撿、交給別的英雄、背包滿、永久道具的數值與同名不疊加、回城信標、
//   中立商店的庫存與補貨、賣出。
// 電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉（不等實際時間）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  // 開局＋共用的工具（頁面裡）
  async function setup(page, base) {
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      window.__at = (x, z, size = 1) => {
        const c = g.world.nav.nearestCell(x, z, size, -1, 16);
        return c >= 0 ? g.world.nav.center(c) : { x, z };
      };
      window.__mk = (team, def, x, z) => {
        const p = window.__at(x, z);
        return g.rtsSpawn(team, def, p.x, p.z, 0);
      };
      window.__put = (team, def) => {
        const p = g.rtsAutoSpot(team, def);
        return p ? g.rtsSpawnBld(team, def, p.x, p.z, 0, 1) : null;
      };
      window.__mv = (e, x, z) => {
        const p = window.__at(x, z);
        g.rtsHeroShift(e, p.x, p.z);
        e.orders = [];
        if (e.rt) e.rt.home = null;
      };
      R.teams[0].ore = R.teams[1].ore = 50000;
      for (let i = 0; i < 5; i++) window.__put(0, 'c_depot'); // 人口上限
      R.teams[0].coral = R.teams[1].coral = 50000;
      const hq = window.__of(0, 'c_hq')[0];
      window.__hq = hq;
      // 戰場：主堡前方 40 m（主基地的平台外）
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      window.__field = { x: hq.pos.x - (hq.pos.x / L) * 45, z: hq.pos.z - (hq.pos.z / L) * 45 };
    });
  }

  async function testRtsHero(browser, base) {
    console.log('Coral 戰爭：英雄（取得、經驗、技能、復活、酒館）');
    const { ctx, page } = await newPage(browser, 'rtsHero');
    await setup(page, base);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 取得：第 1 個免費、第 2 個要 T2 ----------
    const get = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      const ore0 = T.ore,
        coral0 = T.coral;
      o.q1 = g.rtsHeroQueue(hq, 'h_bastion');
      o.paid1 = [ore0 - T.ore, coral0 - T.coral];
      o.why2 = g.rtsHeroQueueWhy(0, 'h_rain');
      o.q2 = g.rtsHeroQueue(hq, 'h_rain');
      o.state = g.rtsHeroState(0, 'h_bastion');
      o.t = window.__sim(70, () => g.rtsHeroState(0, 'h_bastion') === 'alive');
      const e = g.rtsHeroRec(0, 'h_bastion').ent;
      window.__bas = e;
      o.stat = [e.maxHp, e.rtsArmor, e.rtsArm, e.hero.lv, e.hero.pts, T.pop];
      o.dup = g.rtsHeroQueue(hq, 'h_bastion');
      // T2：直接換成要塞主堡
      g.rtsChangeDef(hq, 'c_hq2');
      g.rtsRecount();
      o.why2b = g.rtsHeroQueueWhy(0, 'h_rain');
      const ore1 = T.ore,
        coral1 = T.coral;
      o.q2b = g.rtsHeroQueue(hq, 'h_rain');
      o.paid2 = [ore1 - T.ore, coral1 - T.coral];
      o.why3 = g.rtsHeroQueueWhy(0, 'h_pile');
      o.t2 = window.__sim(70, () => g.rtsHeroState(0, 'h_rain') === 'alive');
      window.__rain = g.rtsHeroRec(0, 'h_rain').ent;
      g.rtsChangeDef(hq, 'c_hq3');
      g.rtsRecount();
      o.q3 = g.rtsHeroQueue(hq, 'h_pile');
      window.__sim(70, () => g.rtsHeroState(0, 'h_pile') === 'alive');
      window.__pile = g.rtsHeroRec(0, 'h_pile').ent;
      o.n = T.heroes.length;
      o.why4 = g.rtsHeroWhy(0, 'h_pile');
      return o;
    });
    check(
      get.q1 && get.paid1.join() === '0,0' && get.state === 'queued',
      `第 1 個英雄免費（扣 ${get.paid1.join('／')}）`,
    );
    check(!get.q2 && /T2/.test(get.why2), `T1 時第 2 個英雄要 T2（${get.why2}）`);
    check(
      get.t > 50 && get.t < 60 && get.stat.join() === '1600,4,hero,1,1,' + get.stat[5],
      `BASTION 生產 ${get.t.toFixed(1)} 秒：血量 ${get.stat[0]}、護甲 ${get.stat[1]}、${get.stat[2]} 甲、1 級 1 技能點`,
    );
    check(!get.dup, '同一位英雄不能再生產');
    check(
      get.why2b === '' && get.q2b && get.paid2.join() === '425,100' && /T3/.test(get.why3),
      `T2：第 2 個英雄 425／100（扣 ${get.paid2.join('／')}），第 3 個要 T3（${get.why3}）`,
    );
    check(get.n === 3 && /已經有/.test(get.why4), `T3：3 位英雄（${get.n}），重複的拒絕（${get.why4}）`);

    // ---------- 經驗 ----------
    const xp = await ev(() => {
      const g = window.__game,
        F = window.__field;
      const bas = window.__bas,
        rain = window.__rain,
        pile = window.__pile;
      const o = {};
      window.__mv(bas, F.x, F.z);
      window.__mv(rain, F.x + 200, F.z + 200); // 遠處
      window.__mv(pile, F.x - 200, F.z - 200);
      const kill = (lvDef, by) => {
        const u = window.__mk(1, lvDef, by.pos.x + 6, by.pos.z + 6);
        g.rtsHit(u, 1e6, 0, by, 'kin');
        return u.dead;
      };
      const x0 = bas.hero.xp;
      o.k1 = kill('c_mt', bas);
      o.solo = bas.hero.xp - x0;
      // 兩位英雄在 40 m 內平分
      window.__mv(rain, bas.pos.x + 20, bas.pos.z);
      const a0 = bas.hero.xp,
        b0 = rain.hero.xp,
        c0 = pile.hero.xp;
      kill('c_mt', bas);
      o.split = [bas.hero.xp - a0, rain.hero.xp - b0, pile.hero.xp - c0];
      // 擊破者不是英雄也算（同隊的工人）
      const w = window.__mk(0, 'c_worker', bas.pos.x + 3, bas.pos.z);
      const a1 = bas.hero.xp;
      const u = window.__mk(1, 'c_shield', bas.pos.x + 8, bas.pos.z);
      g.rtsHit(u, 1e6, 0, w, 'kin');
      o.byWorker = bas.hero.xp - a1;
      // 建築不給經驗
      const b = window.__put(1, 'c_depot');
      const a2 = bas.hero.xp;
      window.__mv(bas, b.pos.x + 12, b.pos.z);
      g.rtsHit(b, 1e7, 0, bas, 'kin');
      o.bld = bas.hero.xp - a2;
      window.__mv(bas, F.x, F.z);
      return o;
    });
    check(xp.k1 && Math.abs(xp.solo - 40) < 1e-6, `擊破 lv 2 的 MT：+${xp.solo}`);
    check(
      Math.abs(xp.split[0] - 20) < 1e-6 && Math.abs(xp.split[1] - 20) < 1e-6 && xp.split[2] === 0,
      `40 m 內兩位英雄平分（${xp.split.join('、')}），40 m 外沒有`,
    );
    check(
      Math.abs(xp.byWorker - 30) < 1e-6,
      `同隊的工人擊破 lv 3 盾牌 MT：英雄 +${xp.byWorker}（兩位平分 60）`,
    );
    check(xp.bld === 0, '擊破建築沒有經驗');

    // ---------- 升級、技能點、學習的限制、10 級上限 ----------
    const lv = await ev(() => {
      const g = window.__game,
        bas = window.__bas,
        rec = bas.hero;
      const o = {};
      g.rtsHeroAddXp(rec, 200 - rec.xp);
      o.lv2 = [rec.lv, rec.pts, Math.round(bas.maxHp)];
      o.l0 = g.rtsHeroLearn(bas, 0);
      o.why01 = g.rtsHeroLearnWhy(bas, 0);
      o.why3 = g.rtsHeroLearnWhy(bas, 3);
      o.l1 = g.rtsHeroLearn(bas, 1);
      o.why12 = g.rtsHeroLearnWhy(bas, 1);
      g.rtsHeroAddXp(rec, 2000 - rec.xp); // 6 級
      o.lv6 = [rec.lv, rec.pts];
      o.l3 = g.rtsHeroLearn(bas, 3);
      o.why33 = g.rtsHeroLearnWhy(bas, 3);
      g.rtsHeroAddXp(rec, 99999);
      o.lv10 = [rec.lv, rec.xp, rec.pts + rec.sk.reduce((a, b) => a + b, 0), Math.round(bas.maxHp)];
      o.armor = +bas.rtsArmor.toFixed(2);
      return o;
    });
    check(lv.lv2.join() === '2,2,1710', `200 經驗＝2 級、2 技能點、血量 ${lv.lv2[2]}（＋110）`);
    check(
      lv.l0 && /3 級/.test(lv.why01) && lv.l1 && /6 級/.test(lv.why3) && /沒有技能點/.test(lv.why12),
      `學習：1 級技能可學、第 2 級要英雄 3 級（${lv.why01}）、終極技要 6 級（${lv.why3}）`,
    );
    check(lv.lv6.join() === '6,4' && lv.l3 && /學滿/.test(lv.why33), '6 級可以學終極技（只有 1 級）');
    check(
      lv.lv10.join() === '10,5400,10,2590' && lv.armor === 9.4,
      `10 級上限：經驗 ${lv.lv10[1]}、技能點合計 ${lv.lv10[2]}、血量 ${lv.lv10[3]}、護甲 ${lv.armor}`,
    );

    // ---------- 三位英雄的 12 個技能 ----------
    const sk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const bas = window.__bas,
        rain = window.__rain,
        pile = window.__pile;
      for (const e of [bas, rain, pile]) {
        e.hero.lv = 10;
        e.hero.sk = [3, 3, 3, 1];
        e.hero.cd = [0, 0, 0, 0];
        g.rtsHeroApply(e);
        e.hp = e.maxHp;
      }
      // 敵人不還手（測傷害）：停住
      const calm = (u) => {
        u.staggerT = 1e3;
        return u;
      };
      const o = {};
      const cast = (e, slot, tgt) => {
        const c0 = T.coral;
        const ok = g.rtsSkillCast(e, slot, tgt);
        return { ok, coral: c0 - T.coral, cd: g.rtsSkillWhy(e, slot) };
      };
      window.__mv(bas, F.x, F.z);
      window.__mv(rain, F.x - 10, F.z);
      window.__mv(pile, F.x + 10, F.z);
      // BASTION Z：重裝甲板
      const mt = window.__mk(0, 'c_mt', F.x, F.z + 8);
      const a0 = mt.rtsArmor;
      o.plate = cast(bas, 0, mt);
      o.plateArmor = mt.rtsArmor - a0;
      // C：鋼鐵意志（光環 25 m）
      const far = window.__mk(0, 'c_mt', F.x + 60, F.z + 60);
      window.__sim(0.6);
      o.will = [+(mt.rtsArmor - a0).toFixed(2), +mt.rtsImpK.toFixed(2), far.rtsArmor];
      // X：貨櫃壁壘（3 段臨時牆）
      const w0 = (g.tWalls || []).length;
      o.wall = cast(bas, 1, { x: F.x, z: F.z - 14 });
      o.walls = (g.tWalls || []).length - w0;
      o.navW = R.hfx.walls.length;
      // V：不落要塞
      const foes = [0, 1, 2].map((i) => calm(window.__mk(1, 'c_mt', bas.pos.x + 5 + i * 2, bas.pos.z + 3)));
      const hp0 = foes.map((u) => u.hp);
      o.fort = cast(bas, 3);
      o.fortStat = [+bas.rtsTakenK.toFixed(2), bas.rtsRangeAdd, bas.speedMul];
      window.__sim(3.6);
      o.fortHit = foes.filter((u, i) => u.dead || u.hp < hp0[i]).length;
      // RAIN Z：飛彈雨
      const grp = [0, 1, 2, 3].map((i) =>
        calm(window.__mk(1, 'c_shield', F.x - 30 + (i % 2) * 3, F.z + 25 + (i >> 1) * 3)),
      );
      const g0 = grp.map((u) => u.hp);
      o.rain = cast(rain, 0, { x: F.x - 28, z: F.z + 26 });
      window.__sim(3.8);
      o.rainDmg = Math.round(grp.reduce((a, u, i) => a + (g0[i] - Math.max(0, u.hp)), 0));
      // X：標定（受到的傷害 +35%、全隊看得到）
      const tgt = calm(window.__mk(1, 'c_tank', rain.pos.x + 55, rain.pos.z + 35));
      o.mark = cast(rain, 1, tgt);
      o.markK = +tgt.rtsTakenK.toFixed(2);
      g.rtsFogTick(0.25);
      o.markSeen = g.rtsFogState(0, tgt.pos.x, tgt.pos.z);
      // C：火控連結（射程 30 以上的友軍）
      const mort = window.__mk(0, 'c_mortar', rain.pos.x + 4, rain.pos.z - 4);
      window.__sim(0.6);
      o.link = [mort.rtsRangeAdd, +(1 / mort.rtsRofK).toFixed(2), mt.rtsRangeAdd];
      // V：飽和砲擊（直線）
      const line = [0, 1, 2].map((i) => calm(window.__mk(1, 'c_mt', rain.pos.x + 15 + i * 12, rain.pos.z)));
      const l0 = line.map((u) => u.hp);
      o.barrage = cast(rain, 3, { x: rain.pos.x + 60, z: rain.pos.z });
      o.barrageCd = g.rtsSkillInfo(rain, 3).cd;
      window.__barrage = { x: rain.pos.x, z: rain.pos.z };
      window.__sim(8);
      o.lineHit = line.filter((u, i) => u.dead || u.hp < l0[i]).length;
      // PILEDRIVER Z：突擊推進
      const rt = calm(window.__mk(1, 'c_shield', pile.pos.x + 22, pile.pos.z));
      rt.staggerT = 0;
      rt.orders = [{ k: 'hold' }];
      const rh0 = rt.hp;
      const d0 = Math.hypot(rt.pos.x - pile.pos.x, rt.pos.z - pile.pos.z);
      o.rush = cast(pile, 0, rt);
      window.__sim(1.2, () => !pile.hs.dash);
      o.rushD = [Math.round(d0), +Math.hypot(rt.pos.x - pile.pos.x, rt.pos.z - pile.pos.z).toFixed(1)];
      o.rushHit = [Math.round(rh0 - rt.hp), +rt.staggerT.toFixed(1)];
      // X：打樁（加血量，打不死）
      g.rtsBuff(rt, { src: 'test', hp: 4000 }, 600);
      rt.hp = rt.maxHp;
      rt.staggerT = 0;
      const ph0 = rt.hp;
      o.pile = cast(pile, 1, rt);
      o.pileHit = [Math.round(ph0 - rt.hp), rt.staggerT > 0];
      // C：破甲（普通攻擊）
      g.rtsBuffDel(rt, 'sk_break');
      const ar0 = rt.rtsArmor;
      g.rtsHit(rt, 1, 0, pile, 'hero');
      o.brk = +(rt.rtsArmor - ar0).toFixed(2);
      // V：地裂
      pile.yaw = 0;
      const qs = [0, 1].map((i) => calm(window.__mk(1, 'c_mt', pile.pos.x + (i ? 1 : -1), pile.pos.z + 10)));
      const q0 = qs.map((u) => u.hp);
      pile.rt.engage = qs[0];
      const sp0 = pile.speedMul;
      o.quake = cast(pile, 3);
      o.quakeSp = +(pile.speedMul / sp0).toFixed(2);
      window.__sim(1.2);
      o.quakeHit = qs.filter((u, i) => u.dead || u.hp < q0[i]).length;
      // 不能施放：冷卻、Coral 不足、被動
      o.cdWhy = g.rtsSkillWhy(rain, 3);
      o.passive = g.rtsSkillWhy(pile, 2);
      const keep = T.coral;
      T.coral = 0;
      bas.hero.cd[0] = 0;
      o.noCoral = g.rtsSkillWhy(bas, 0);
      T.coral = keep;
      // 指揮時的技能指令：走到射程內再放
      bas.hero.cd[0] = 0;
      const ally = window.__mk(0, 'c_mt', bas.pos.x + 50, bas.pos.z);
      ally.staggerT = 1e3;
      bas.hs.root = 0;
      g.rtsBuffDel(bas, 'sk_fortress');
      g.rtsSkillOrder(bas, 0, null, null, ally.id);
      o.order = window.__sim(12, () => bas.hero.cd[0] > R.t);
      o.orderArmor = ally.rtsArmor;
      return o;
    });
    const okc = (r, coral) => r.ok && r.coral === coral && r.cd === '冷卻中';
    check(
      okc(sk.plate, 25) && sk.plateArmor >= 10,
      `重裝甲板：Coral ${sk.plate.coral}、護甲 +${sk.plateArmor}、冷卻`,
    );
    check(
      sk.will[0] === 13 && sk.will[1] === 0.7 && sk.will[2] === 1,
      `鋼鐵意志：25 m 內護甲 +3（合計 +${sk.will[0]}）、失衡值 ×${sk.will[1]}，遠處的不受影響`,
    );
    check(
      okc(sk.wall, 20) && sk.walls === 3 && sk.navW === 3,
      `貨櫃壁壘：3 段臨時牆（${sk.walls}）、導航佔用`,
    );
    check(
      okc(sk.fort, 75) &&
        sk.fortStat[0] === 0.4 &&
        sk.fortStat[1] >= 14 &&
        sk.fortStat[2] === 0 &&
        sk.fortHit >= 2,
      `不落要塞：受到的傷害 ×${sk.fortStat[0]}、射程 +${sk.fortStat[1]}、不能移動、衝擊波打中 ${sk.fortHit} 台`,
    );
    check(okc(sk.rain, 35) && sk.rainDmg > 200, `飛彈雨：Coral 35、4 台盾牌 MT 共受到 ${sk.rainDmg}`);
    check(
      okc(sk.mark, 15) && sk.markK === 1.35 && sk.markSeen === 2,
      `標定：受到的傷害 ×${sk.markK}、迷霧中看得到（${sk.markSeen}）`,
    );
    check(
      sk.link[0] === 6 && sk.link[1] === 1.2 && sk.link[2] === 0,
      `火控連結：迫擊砲 MT 射程 +${sk.link[0]}、射速 ×${sk.link[1]}；射程 26 的 MT 不受影響`,
    );
    check(
      okc(sk.barrage, 90) && sk.barrageCd > 140 && sk.lineHit >= 2,
      `飽和砲擊：Coral 90、冷卻 ${Math.round(sk.barrageCd)} 秒、直線上打中 ${sk.lineHit}／3`,
    );
    check(
      okc(sk.rush, 15) && sk.rushD[1] < 5 && sk.rushHit[0] > 60 && sk.rushHit[1] > 1,
      `突擊推進：距離 ${sk.rushD[0]} → ${sk.rushD[1]} m、傷害 ${sk.rushHit[0]}、暈眩 ${sk.rushHit[1]} 秒`,
    );
    check(okc(sk.pile, 20) && sk.pileHit[0] > 300 && sk.pileHit[1], `打樁：傷害 ${sk.pileHit[0]}、失衡`);
    check(sk.brk === -3, `破甲：普通攻擊讓目標護甲 ${sk.brk}`);
    check(
      okc(sk.quake, 80) && sk.quakeSp === 1.3 && sk.quakeHit === 2,
      `地裂：前方噴發打中 ${sk.quakeHit}／2、移動速度 ×${sk.quakeSp}`,
    );
    check(
      sk.cdWhy === '冷卻中' && sk.passive === '被動技能' && sk.noCoral === 'Coral 不足',
      `不能施放：${sk.cdWhy}、${sk.passive}、${sk.noCoral}`,
    );
    check(sk.order > 0, `技能指令：走到射程內再施放（${sk.order.toFixed(1)} 秒）`);

    // 技能效果的截圖：飽和砲擊＋飛彈雨＋貨櫃壁壘
    await ev(() => {
      const g = window.__game,
        rain = window.__rain,
        F = window.__field;
      rain.hero.cd = [0, 0, 0, 0];
      window.__mv(rain, F.x - 20, F.z);
      g.rtsSkillCast(rain, 3, { x: rain.pos.x + 60, z: rain.pos.z + 10 });
      g.rtsSkillCast(rain, 0, { x: rain.pos.x + 20, z: rain.pos.z - 14 });
      g.rtsHeroWall(rain.pos.x + 8, rain.pos.z + 8, {
        kind: 'rock',
        w: 6,
        h: 3,
        d: 1.5,
        yaw: 0,
        hp: 600,
        life: 20,
      });
      if (g.rtsCamJump) g.rtsCamJump(rain.pos.x + 25, rain.pos.z);
      window.__pump(2.2, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hero-skills.png') });

    // ---------- 死亡 → 主堡復活 ----------
    const rv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      for (const b of R.units) if (b.bld && b.rtsTeam === 0) b.bld.queue.length = 0;
      const bas = window.__bas,
        rec = bas.hero;
      g.rtsItemGive(bas, 'i_plate');
      const o = {};
      const killer = window.__mk(1, 'c_mt', bas.pos.x + 5, bas.pos.z);
      g.rtsHit(bas, 1e7, 0, killer, 'kin');
      o.dead = [bas.dead, rec.st, g.rtsHeroState(0, 'h_bastion')];
      o.why = g.rtsHeroQueueWhy(0, 'h_bastion');
      const ore0 = T.ore;
      o.q = g.rtsHeroQueue(hq, 'h_bastion');
      o.paid = ore0 - T.ore;
      const q = hq.bld.queue[0];
      o.time = q && q.time;
      o.st2 = g.rtsHeroState(0, 'h_bastion');
      o.t = window.__sim(70, () => g.rtsHeroState(0, 'h_bastion') === 'alive');
      const e = rec.ent;
      window.__bas = e;
      o.back = [
        e !== bas,
        rec.lv,
        Math.round(e.hp) === Math.round(e.maxHp),
        e.hero.inv[0] && e.hero.inv[0].id,
      ];
      return o;
    });
    check(rv.dead.join() === 'true,dead,dead', '英雄陣亡：紀錄保留（狀態 dead）');
    check(
      rv.q && rv.paid === 470 && rv.time === 60 && rv.st2 === 'reviving',
      `10 級的復活：礦石 ${rv.paid}、${rv.time} 秒`,
    );
    check(
      rv.t > 58 && rv.t < 62 && rv.back[0] && rv.back[1] === 10 && rv.back[2] && rv.back[3] === 'i_plate',
      `復活完成（${rv.t.toFixed(1)} 秒）：10 級、滿血、道具還在`,
    );

    // ---------- 酒館：雇用與 8 位英雄的 32 個技能 ----------
    const tv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      const tavRec = (R.neutrals || []).find((q) => q.kind === 'tavern');
      let tav = tavRec && tavRec.ent;
      if (!tav) tav = g.rtsSpawnBld(2, 'n_tavern', window.__field.x + 40, window.__field.z + 40, 0, 1);
      o.hasTav = !!tav;
      o.far = g.rtsHireWhy(0, tav, 't_rust');
      const u = window.__mk(0, 'c_mt', tav.pos.x + 10, tav.pos.z + 10);
      u.staggerT = 1e3;
      const u1 = window.__mk(1, 'c_mt', tav.pos.x - 10, tav.pos.z - 10);
      u1.staggerT = 1e3;
      o.full = g.rtsHireWhy(0, tav, 't_rust'); // 已經有 3 位
      // 讓出一個名額：PILEDRIVER 從紀錄移除（測試用）
      const pile = window.__pile;
      T.heroes.splice(T.heroes.indexOf(pile.hero), 1);
      pile.hero = null;
      pile.rtsQuiet = true;
      pile.die(null);
      const ore0 = T.ore;
      const e = g.rtsHire(0, tav, 't_rust');
      o.hire = [!!e, ore0 - T.ore, e && e.hero.lv, e && e.hero.src];
      o.taken = g.rtsHireWhy(1, tav, 't_rust');
      o.state1 = g.rtsHeroState(1, 't_rust');
      // 8 位英雄的技能（直接生成，略過上限）：全部學滿、各放一次
      const F = window.__field;
      const res = {};
      const ids = [
        't_rust',
        't_sirocco',
        't_whiteout',
        't_specimen',
        't_spire',
        't_countdown',
        't_undertow',
        't_marsh',
      ];
      ids.forEach((id, k) => {
        let h = id === 't_rust' ? e : null;
        const x = F.x + ((k % 4) - 1.5) * 30,
          z = F.z + 40 + Math.floor(k / 4) * 35;
        if (!h) {
          const p = window.__at(x, z);
          h = g.rtsSpawn(0, id, p.x, p.z, 0);
          g.rtsHeroSpawned(h, { id });
        } else window.__mv(h, x, z);
        h.hero.lv = 10;
        h.hero.sk = [3, 3, 3, 1];
        g.rtsHeroApply(h);
        h.hp = h.maxHp;
        const foe = window.__mk(1, 'c_mt', h.pos.x + 8, h.pos.z + 4);
        foe.staggerT = 1e3;
        const ally = window.__mk(0, 'c_mt', h.pos.x - 4, h.pos.z - 3);
        ally.staggerT = 1e3;
        // 殘骸（RUST 的拾荒）
        const dead = window.__mk(1, 'c_mt', h.pos.x + 3, h.pos.z - 6);
        g.rtsHit(dead, 1e6, 0, h, 'kin');
        const r = [];
        for (let s = 0; s < 4; s++) {
          const I = g.rtsSkillInfo(h, s);
          if (I.passive) {
            r.push('p');
            continue;
          }
          const tgt = I.kind === 'unit' ? foe : I.kind === 'point' ? { x: foe.pos.x, z: foe.pos.z } : null;
          const c0 = T.coral;
          let ok = false;
          try {
            ok = g.rtsSkillCast(h, s, tgt);
          } catch (err) {
            r.push('E:' + err.message);
            continue;
          }
          r.push(ok && T.coral < c0 ? 'ok' : 'x:' + g.rtsSkillWhy(h, s));
          window.__sim(2);
        }
        res[id] = r.join(',');
      });
      o.err = '';
      try {
        window.__sim(16);
      } catch (err) {
        o.err = err.message;
      }
      o.res = res;
      o.alive = ids.filter((id) => g.rtsHeroState(0, id) === 'alive').length;
      return o;
    });
    check(tv.hasTav && /m 內/.test(tv.far), `酒館：己方單位不在附近時不能雇用（${tv.far}）`);
    check(/最多/.test(tv.full), `英雄滿 3 位時不能雇用（${tv.full}）`);
    check(
      tv.hire[0] && tv.hire[1] === 425 && tv.hire[2] === 1 && tv.hire[3] === 'tavern',
      `雇用 RUST：礦石 ${tv.hire[1]}、1 級、來源 ${tv.hire[3]}`,
    );
    check(/雇走|雇用/.test(tv.taken) && tv.state1 === 'taken', `全場唯一：對手不能雇用（${tv.taken}）`);
    const bad = Object.entries(tv.res).filter(([, v]) => /x:|E:/.test(v));
    check(
      !bad.length && !tv.err && Object.keys(tv.res).length === 8,
      `酒館 8 位英雄的技能都能施放${bad.length ? '：' + bad.map((b) => b.join(' ')).join('；') : ''}${tv.err ? '（' + tv.err + '）' : ''}`,
    );
    await ev(() => {
      const g = window.__game,
        F = window.__field;
      if (g.rtsCamJump) g.rtsCamJump(F.x, F.z + 55);
      window.__pump(0.6, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hero-tavern.png') });
    await ctx.close();
  }

  async function testRtsItems(browser, base) {
    console.log('Coral 戰爭：道具與商店');
    const { ctx, page } = await newPage(browser, 'rtsItems');
    await setup(page, base);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 補給商店的貨架、買 ----------
    const shop = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        hq = window.__hq;
      const o = {};
      const mk = window.__put(0, 'c_market');
      window.__mkt = mk;
      const h = g.rtsHeroSpawnAt(0, 'h_bastion', hq, {});
      const h2 = g.rtsHeroSpawnAt(0, 'h_rain', hq, {});
      window.__h = h;
      window.__h2 = h2;
      o.t1 = g.rtsBuyList(mk, 0).length;
      o.far = g.rtsBuyWhyAt(h, mk, 'i_kit');
      window.__mv(h, mk.pos.x + 9, mk.pos.z);
      window.__mv(h2, mk.pos.x + 9, mk.pos.z + 3);
      o.card = g.rtsHeroShopCard(h).length;
      const ore0 = T.ore;
      o.buy = g.rtsBuy(h, mk, 'i_kit');
      o.paid = ore0 - T.ore;
      o.inv = h.hero.inv[0] && [h.hero.inv[0].id, h.hero.inv[0].ch].join();
      o.t2why = g.rtsBuyWhyAt(h, mk, 'i_fcs');
      g.rtsChangeDef(hq, 'c_hq2');
      g.rtsRecount();
      o.t2 = g.rtsBuyList(mk, 0).length;
      g.rtsChangeDef(hq, 'c_hq3');
      g.rtsRecount();
      o.t3 = g.rtsBuyList(mk, 0).length;
      o.drop = g.rtsBuyWhyAt(h, mk, 'i_stab');
      // 選商店本身：買給 12 m 內最近的英雄
      o.buyer = g.rtsBuyer(mk, 0) === h;
      o.act = g.rtsBuyAct(mk, 'i_smoke');
      o.inv2 = h.hero.inv
        .filter(Boolean)
        .map((s) => s.id)
        .join();
      return o;
    });
    check(
      shop.t1 === 4 && shop.t2 === 10 && shop.t3 === 12,
      `補給商店的貨架：T1 ${shop.t1}、T2 ${shop.t2}、T3 ${shop.t3} 種`,
    );
    check(/12 m/.test(shop.far), `英雄要在商店 12 m 內（${shop.far}）`);
    check(shop.card === 4, `英雄卡片的商店子選單（${shop.card} 格）`);
    check(
      shop.buy && shop.paid === 50 && shop.inv === 'i_kit,2',
      `買修復套件：礦石 ${shop.paid}、背包 ${shop.inv}`,
    );
    check(/T2/.test(shop.t2why), `T1 時不能買 2 階道具（${shop.t2why}）`);
    check(/不能購買/.test(shop.drop), `只掉落的道具不能買（${shop.drop}）`);
    check(shop.buyer && shop.act && shop.inv2 === 'i_kit,i_smoke', `選商店時買給附近的英雄（${shop.inv2}）`);

    // ---------- 使用：修復套件、煙幕、障壁、偵察 ----------
    const use = await ev(() => {
      const g = window.__game,
        R = g.rts,
        h = window.__h;
      const o = {};
      h.hp = h.maxHp - 600;
      const hp0 = h.hp;
      o.kit = g.rtsItemUse(h, 0);
      window.__sim(5.3);
      o.heal = Math.round(h.hp - hp0);
      o.ch = h.hero.inv[0] && h.hero.inv[0].ch;
      // 受傷中斷
      h.hp = h.maxHp - 600;
      h.hero.inv[0].cd = 0;
      g.rtsItemUse(h, 0);
      window.__sim(1);
      const foe = window.__mk(1, 'c_mt', h.pos.x + 30, h.pos.z + 30);
      foe.staggerT = 1e3;
      g.rtsHit(h, 10, 0, foe, 'kin');
      const hp1 = h.hp;
      window.__sim(3);
      o.cut = Math.round(h.hp - hp1);
      o.kitGone = !h.hero.inv.some((s) => s && s.id === 'i_kit');
      // 煙幕：友軍不能被鎖定
      const sl = h.hero.inv.findIndex((s) => s && s.id === 'i_smoke');
      o.smoke = g.rtsItemUse(h, sl);
      window.__sim(0.6);
      o.smokeNL = h.noLock;
      window.__sim(9);
      o.smokeEnd = h.noLock;
      // 緊急障壁：吸收 300
      g.rtsItemGive(h, 'i_barrier');
      const bl = h.hero.inv.findIndex((s) => s && s.id === 'i_barrier');
      g.rtsItemUse(h, bl);
      const hp2 = h.hp;
      g.rtsHit(h, 250, 0, foe, 'none');
      o.absorb = Math.round(hp2 - h.hp);
      g.rtsHit(h, 250, 0, foe, 'none');
      o.absorb2 = Math.round(hp2 - h.hp);
      // 偵察無人機
      g.rtsItemGive(h, 'i_scout');
      const sc = h.hero.inv.findIndex((s) => s && s.id === 'i_scout');
      const P = { x: h.pos.x * 0.4, z: h.pos.z * 0.4 }; // 往地圖中央
      o.fog0 = g.rtsFogState(0, P.x, P.z);
      o.scout = g.rtsItemUse(h, sc, P);
      g.rtsFogTick(0.25);
      o.fog1 = g.rtsFogState(0, P.x, P.z);
      void R;
      return o;
    });
    check(
      use.kit && use.heal >= 340 && use.heal <= 360 && use.ch === 1,
      `修復套件：5 秒回復 ${use.heal}、剩 ${use.ch} 次`,
    );
    check(use.cut <= 1 && use.kitGone, `受傷中斷修復（之後 3 秒回復 ${use.cut}）、用完後背包清掉`);
    check(use.smoke && use.smokeNL && !use.smokeEnd, '煙幕彈：裡面的英雄不能被鎖定，結束後還原');
    check(
      use.absorb === 0 && use.absorb2 > 150 && use.absorb2 < 250,
      `緊急障壁：吸收 300（第二下扣 ${use.absorb2}）`,
    );
    check(use.scout && use.fog0 !== 2 && use.fog1 === 2, `偵察無人機：遠處揭露（${use.fog0} → ${use.fog1}）`);

    // ---------- 丟、撿、交給、背包滿 ----------
    const inv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        h = window.__h,
        h2 = window.__h2;
      const o = {};
      h.hero.inv = new Array(6).fill(null);
      h2.hero.inv = new Array(6).fill(null);
      g.rtsHeroApply(h);
      g.rtsItemGive(h, 'i_kit');
      window.__mv(h, window.__field.x, window.__field.z - 20); // 空曠處
      const p0 = { x: h.pos.x - Math.sin(h.yaw) * 8, z: h.pos.z - Math.cos(h.yaw) * 8 };
      o.drop = g.rtsItemDrop(h, 0);
      const it = R.items[R.items.length - 1];
      o.ground = !!it && it.item === 'i_kit' && !h.hero.inv[0];
      window.__sim(1);
      o.noRepick = !h.hero.inv[0];
      // 撿（指令）
      window.__mv(h, p0.x, p0.z);
      g.rtsOrder([h], { k: 'pickup', uid: it.uid });
      o.pickT = window.__sim(10, () => !!h.hero.inv[0]);
      o.picked = R.items.indexOf(it) < 0;
      // 交給 6 m 內的另一位英雄
      window.__mv(h2, h.pos.x + 30, h.pos.z);
      o.passFar = g.rtsItemPass(h, 0, h2);
      window.__mv(h2, h.pos.x + 3, h.pos.z);
      o.pass = g.rtsItemPass(h, 0, h2);
      o.inv2 = h2.hero.inv[0] && h2.hero.inv[0].id;
      // 背包滿
      for (const id of ['i_fcs', 'i_plate', 'i_plate', 'i_boost', 'i_cooler', 'i_scope'])
        g.rtsItemGive(h, id);
      o.full = g.rtsItemGive(h, 'i_kit');
      const g2 = g.rtsItemSpawn('i_kit', h.pos.x + 0.5, h.pos.z);
      window.__sim(0.6);
      o.stay = R.items.indexOf(g2) >= 0;
      window.__mv(h, window.__mkt.pos.x + 9, window.__mkt.pos.z);
      o.buyFull = g.rtsBuyWhyAt(h, window.__mkt, 'i_kit');
      return o;
    });
    check(inv.drop && inv.ground && inv.noRepick, '丟在腳下：地上有道具，丟下的英雄不會馬上撿回來');
    check(inv.pickT > 0 && inv.picked, `撿道具的指令：走過去撿（${inv.pickT.toFixed(1)} 秒）`);
    check(!inv.passFar && inv.pass && inv.inv2 === 'i_kit', '交給 6 m 內的英雄（太遠時拒絕）');
    check(
      inv.full === -1 && inv.stay && /滿/.test(inv.buyFull),
      `背包滿：給不了、地上的留著、不能買（${inv.buyFull}）`,
    );

    // ---------- 永久道具的數值、同名不疊加 ----------
    const perm = await ev(() => {
      const g = window.__game,
        h = window.__h;
      const o = {};
      const snap = () => [h.rtsArmor, h.dmgMul, h.speedMul, h.rtsRangeAdd, h.rtsVision, 1 / h.rtsRofK];
      const full = snap();
      h.hero.inv = new Array(6).fill(null);
      g.rtsHeroApply(h);
      const base = snap();
      o.d = full.map((v, i) => +(v / (i === 0 || i === 3 || i === 4 ? 1 : base[i])).toFixed(3));
      o.add = [+(full[0] - base[0]).toFixed(2), full[3] - base[3], full[4] - base[4]];
      // 同名不疊加
      g.rtsItemGive(h, 'i_plate');
      const a1 = h.rtsArmor;
      g.rtsItemGive(h, 'i_plate');
      o.stack = +(h.rtsArmor - a1).toFixed(2);
      // 指揮天線（光環）
      g.rtsItemGive(h, 'i_antenna');
      const mt = window.__mk(0, 'c_mt', h.pos.x + 6, h.pos.z);
      const am0 = mt.rtsArmor,
        dm0 = mt.dmgMul;
      window.__sim(0.6);
      o.ant = [+(mt.rtsArmor - am0).toFixed(2), +(mt.dmgMul / dm0).toFixed(2)];
      return o;
    });
    check(
      perm.add[0] === 3 &&
        perm.d[1] === 1.1 &&
        perm.d[2] === 1.12 &&
        perm.add[1] === 4 &&
        perm.add[2] === 6 &&
        perm.d[5] === 1.15,
      `永久道具：護甲 +${perm.add[0]}、傷害 ×${perm.d[1]}、速度 ×${perm.d[2]}、射程 +${perm.add[1]}、視野 +${perm.add[2]}、射速 ×${perm.d[5]}`,
    );
    check(perm.stack === 0, '兩個追加裝甲不疊加');
    check(
      perm.ant[0] === 1 && perm.ant[1] === 1.05,
      `指揮天線：附近友軍護甲 +${perm.ant[0]}、傷害 ×${perm.ant[1]}`,
    );

    // ---------- 回城信標、賣出、中立商店 ----------
    const misc = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        h = window.__h,
        hq = window.__hq;
      const o = {};
      h.hero.inv = new Array(6).fill(null);
      g.rtsHeroApply(h);
      g.rtsItemGive(h, 'i_beacon');
      const F = window.__field;
      window.__mv(h, hq.pos.x + (F.x - hq.pos.x) * 2, hq.pos.z + (F.z - hq.pos.z) * 2);
      o.d0 = Math.round(Math.hypot(h.pos.x - hq.pos.x, h.pos.z - hq.pos.z));
      o.use = g.rtsItemUse(h, 0);
      window.__sim(3.3);
      o.d1 = Math.round(Math.hypot(h.pos.x - hq.pos.x, h.pos.z - hq.pos.z));
      // 賣出：退一半
      window.__mv(h, window.__mkt.pos.x + 9, window.__mkt.pos.z);
      g.rtsItemGive(h, 'i_scope');
      const ore0 = T.ore,
        c0 = T.coral;
      o.sell = g.rtsItemSell(h, 0);
      o.back = [T.ore - ore0, T.coral - c0];
      // 中立商店：庫存與補貨（D 包的紀錄）
      const nrec = (R.neutrals || []).find((q) => q.kind === 'shop');
      o.hasShop = !!nrec;
      if (nrec) {
        const s = nrec.ent;
        window.__mv(h, s.pos.x + Math.max(s.bld.w, s.bld.d) / 2 + 4, s.pos.z);
        o.list = g.rtsBuyList(s, 0).length;
        o.b1 = g.rtsBuy(h, s, 'i_antenna'); // 3 階、庫存 1
        o.n = nrec.stock.i_antenna.n;
        o.why = g.rtsBuyWhyAt(h, s, 'i_antenna');
        o.rt = window.__sim(130, () => nrec.stock.i_antenna.n > 0);
        o.b2 = g.rtsBuy(h, s, 'i_antenna');
      }
      return o;
    });
    check(misc.use && misc.d0 > 40 && misc.d1 < 22, `回城信標：離主堡 ${misc.d0} → ${misc.d1} m`);
    check(misc.sell && misc.back.join() === '100,50', `賣出遠距照準：退 ${misc.back.join('／')}`);
    check(misc.hasShop, '地圖上有中立商店（D 包）');
    if (misc.hasShop)
      check(
        misc.list === 12 && misc.b1 && misc.n === 0 && /缺貨/.test(misc.why) && misc.rt > 100 && misc.b2,
        `中立商店：全部 ${misc.list} 種、買完缺貨（${misc.why}）、${Math.round(misc.rt)} 秒後補貨再買`,
      );
    await ev(() => {
      const g = window.__game,
        h = window.__h;
      g.rtsItemSpawn('i_fcs', h.pos.x + 3, h.pos.z + 2);
      g.rtsItemSpawn('i_stab', h.pos.x + 4, h.pos.z - 2);
      if (g.rtsCamJump) g.rtsCamJump(h.pos.x, h.pos.z);
      window.__pump(0.5, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-items.png') });
    await ctx.close();
  }

  return { testRtsHero, testRtsItems };
};
