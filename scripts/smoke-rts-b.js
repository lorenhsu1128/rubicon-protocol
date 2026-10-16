// Coral 戰爭（RTS）R2 B 包（兵種行為與模型）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-b')(H)。
// testRtsCastron：卡斯特隆每個兵種的生產、移動、開火與實際 dps、最短射程、自走砲的架設、盾牆、投擲貨櫃與掩體、照明彈、
// 踏地、直升機（直線飛越、只被對空打）、火箭齊射、起重機砲台與防空砲塔的目標、民兵動員與解除、城牆擋路、主堡三階與
// 新建築的截圖。電腦對手不動（g.rtsAiOff），主迴圈停住，只以 rtsSim 快轉（不等實際時間）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsCastron(browser, base) {
    console.log('Coral 戰爭：卡斯特隆的兵種行為、技能、防禦塔與建築模型（R2 B 包）');
    const { ctx, page } = await newPage(browser, 'rtsCastron');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name) });

    // ---------- 開局與共用工具 ----------
    const st = await ev(() => {
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
      const R = g.rts,
        w = g.world;
      if (g.rtsFogRevealAll) {
        g.rtsFogRevealAll(0);
        g.rtsFogRevealAll(1);
      }
      // fx＝也更新特效（截圖前）；平常只跑模擬
      window.__sim = (sec, until, dt = 1 / 20, fx = false) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          if (fx) g.fx.update(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      window.__put = (team, def) => {
        const p = g.rtsAutoSpot(team, def);
        return p ? g.rtsSpawnBld(team, def, p.x, p.z, 0, 1) : null;
      };
      // 平坦、可以走的空地（從地圖中心往外找）
      window.__spot = (W, D, tol = 1.2, avoid = []) => {
        const nav = w.nav;
        for (let r = 0; r < 180; r += 8)
          for (let a = 0; a < Math.PI * 2; a += r ? 8 / r : 7) {
            const x = Math.cos(a) * r,
              z = Math.sin(a) * r;
            if (avoid.some((q) => Math.hypot(q.x - x, q.z - z) < q.r)) continue;
            if (!nav.buildable(x, z, W, D)) continue;
            let lo = 1e9,
              hi = -1e9;
            for (let i = -2; i <= 2; i++)
              for (let j = -2; j <= 2; j++) {
                const h = w.terrainHeight(x + (i * W) / 4, z + (j * D) / 4);
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
              }
            if (hi - lo < tol) return { x, z };
          }
        return null;
      };
      window.__mk = (team, def, x, z, yaw = 0) => g.rtsSpawn(team, def, x, z, yaw);
      // 不動、不開火的靶（血量很多）
      window.__dummy = (team, def, x, z) => {
        const e = g.rtsSpawn(team, def, x, z, 0);
        e.updateAI = () => true;
        e.maxHp = e.hp = 1e6;
        return e;
      };
      window.__kill = (list) => {
        for (const e of list)
          if (e && !e.dead) {
            e.rtsQuiet = true;
            e.die(null);
          }
        window.__sim(0.1);
      };
      for (const T of R.teams) {
        T.ore = 50000;
        T.coral = 50000;
      }
      const hq = window.__of(0, 'c_hq')[0];
      window.__hq = hq;
      const A = window.__spot(70, 70, 1.5) || window.__spot(60, 60, 2.5) || window.__spot(44, 44, 3);
      window.__A = A;
      return { A, hq: !!hq };
    });
    check(
      !!st.A && st.hq,
      `開局、找到測試用的空地（${st.A ? st.A.x.toFixed(0) + ', ' + st.A.z.toFixed(0) : '沒有'}）`,
    );
    if (!st.A) {
      await ctx.close();
      return;
    }

    // ---------- 主堡三階＋每個兵種都能生產 ----------
    const prod = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = { tiers: [] };
      const tv = () => [hq.model.tier, !!hq.model.tier2.visible, !!hq.model.tier3.visible].join('/');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'c_hq2');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'c_hq3');
      o.tiers.push(tv());
      o.tier = g.rtsTier(0);
      for (let i = 0; i < 4; i++) window.__put(0, 'c_depot');
      const fac = window.__put(0, 'c_factory'),
        heavy = window.__put(0, 'c_heavy'),
        pad = window.__put(0, 'c_helipad');
      const want = {
        c_mt: fac,
        c_shield: fac,
        c_forklift: fac,
        c_mortar: fac,
        c_stomper: heavy,
        c_tank: heavy,
        c_arty: heavy,
        c_heli: pad,
      };
      o.queued = [];
      for (const id in want) if (want[id] && g.rtsQueue(want[id], id)) o.queued.push(id);
      o.t = window.__sim(150, () => Object.keys(want).every((id) => window.__of(0, id).length));
      o.made = Object.keys(want).filter((id) => window.__of(0, id).length);
      o.heliY = (() => {
        const h = window.__of(0, 'c_heli')[0];
        return h ? h.pos.y - g.world.terrainHeight(h.pos.x, h.pos.z) : -1;
      })();
      // 生產出來的這批不再使用（各項另外在空地生成）
      window.__kill(Object.keys(want).flatMap((id) => window.__of(0, id)));
      return o;
    });
    check(
      prod.tiers.join() === '1/false/false,2/true/false,3/true/true' && prod.tier === 3,
      `主堡三階的外觀：${prod.tiers.join(' → ')}`,
    );
    check(
      prod.made.length === 8 && prod.t > 0,
      `8 種兵種都生產出來（${prod.made.join('、')}；${prod.t.toFixed(0)} 秒）`,
    );
    check(prod.heliY > 4, `武裝直升機在空中（離地 ${prod.heliY.toFixed(1)} m）`);

    // ---------- 實際 dps（slots 的換算） ----------
    const dps = await ev(() => {
      const g = window.__game,
        A = window.__A;
      const res = {};
      const CASES = [
        ['c_mt', 'c_stomper', 14],
        ['c_shield', 'c_stomper', 12],
        ['c_forklift', 'c_stomper', 12],
        ['c_mortar', 'c_stomper', 26],
        ['c_stomper', 'c_stomper', 7],
        ['c_tank', 'c_stomper', 18],
        ['c_arty', 'c_stomper', 40],
        ['c_heli', 'c_stomper', 14],
        ['c_militia', 'c_stomper', 12],
        ['c_tank', 'c_heli', 18, 'air'],
        ['c_mt', 'c_heli', 14, 'air'],
      ];
      for (const [def, tdef, d, tag] of CASES) {
        const tgt = window.__dummy(1, tdef, A.x, A.z - d / 2);
        const a = window.__mk(0, def, A.x, A.z + d / 2, 0);
        a.rtsAuto = { ab_stomp: false }; // 只量武器
        g.rtsOrder([a], { k: 'attack', id: tgt.id });
        window.__sim(def === 'c_arty' ? 6 : 4);
        const hp0 = tgt.hp,
          T = 24;
        window.__sim(T);
        const atk = tag === 'air' && def === 'c_tank' ? 'kin' : g.rtsAtkOf(a, null, null);
        const k = g.rtsDmgK(atk, tgt);
        res[def + (tag ? '>' + tag : '')] = { got: (hp0 - tgt.hp) / T / k, deployed: !!a.deployed };
        window.__kill([a, tgt]);
      }
      return res;
    });
    const DPS = {
      c_mt: 14,
      c_shield: 10,
      c_forklift: 12,
      c_mortar: 16,
      c_stomper: 30,
      c_tank: 22,
      c_arty: 34,
      c_heli: 20,
      c_militia: 9,
      'c_tank>air': 10,
      'c_mt>air': 14,
    };
    for (const k in DPS) {
      const r = dps[k] || { got: 0 };
      const lo = /mortar|arty|shield/.test(k) ? 0.8 : 0.85; // 盾牌 MT 的重型手臂擴散大、會打偏
      check(
        r.got >= DPS[k] * lo && r.got <= DPS[k] * 1.15,
        `${k} 的實際 dps ${r.got.toFixed(1)}（定義 ${DPS[k]}${k === 'c_arty' ? '，架設 ' + r.deployed : ''}）`,
      );
    }

    // ---------- 迫擊砲的最短射程、自走砲的架設 ----------
    const siege = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const tgt = window.__dummy(1, 'c_stomper', A.x, A.z - 3);
      const m = window.__mk(0, 'c_mortar', A.x, A.z + 3, 0);
      g.rtsOrder([m], { k: 'hold' });
      const hp0 = tgt.hp;
      window.__sim(5);
      o.mortarNear = hp0 - tgt.hp;
      o.mortarShots = g.projectiles.filter((p) => p.owner === m).length;
      window.__kill([m, tgt]);
      // 自走砲：守住（沒架設）不開火 → 架設 3 秒 → 開火、視野 +6 → 移動指令自動收起
      const t2 = window.__dummy(1, 'c_stomper', A.x, A.z - 20);
      const ar = window.__mk(0, 'c_arty', A.x, A.z + 20, 0);
      g.rtsOrder([ar], { k: 'hold' });
      const h0 = t2.hp;
      window.__sim(6);
      o.noDeploy = h0 - t2.hp;
      o.sight0 = ar.rtsVision;
      g.rtsOrder([ar], { k: 'ability', ab: 'ab_siege' });
      window.__sim(2.5);
      o.at25 = ar.deployed;
      window.__sim(0.7);
      o.at32 = ar.deployed;
      o.sight1 = ar.rtsVision;
      o.legs = !!(ar.sx && ar.sx.rtsLegs && ar.sx.rtsLegs.visible);
      g.rtsOrder([ar], { k: 'hold' });
      const h1 = t2.hp;
      window.__sim(8);
      o.fired = h1 - t2.hp;
      window.__arty = ar;
      window.__artyT = t2;
      const p0 = ar.pos.clone();
      g.rtsOrder([ar], { k: 'move', x: A.x + 20, z: A.z + 20 });
      window.__sim(1.5);
      o.packing = ar.rtsSiege.st;
      o.moved15 = ar.pos.distanceTo(p0);
      window.__sim(3);
      o.after = ar.rtsSiege.st;
      o.moved = ar.pos.distanceTo(p0);
      o.sight2 = ar.rtsVision;
      return o;
    });
    check(
      siege.mortarNear === 0 && siege.mortarShots === 0,
      `迫擊砲：最短射程內不開火（傷害 ${siege.mortarNear}、砲彈 ${siege.mortarShots}）`,
    );
    check(siege.noDeploy === 0, '自走砲：沒架設不開火');
    check(
      !siege.at25 && siege.at32 && siege.legs && siege.sight1 === siege.sight0 + 6,
      `自走砲：架設 3 秒（2.5 秒 ${siege.at25}、3.2 秒 ${siege.at32}）、駐鋤、視野 ${siege.sight0} → ${siege.sight1}`,
    );
    check(siege.fired > 0, `自走砲：架設後開火（傷害 ${siege.fired.toFixed(0)}）`);
    check(
      siege.packing === 'packing' &&
        siege.moved15 < 0.5 &&
        siege.after === 'up' &&
        siege.moved > 2 &&
        siege.sight2 === siege.sight0,
      `自走砲：移動指令先收起 2 秒（${siege.packing}、移動 ${siege.moved15.toFixed(2)} m）再走（${siege.after}、${siege.moved.toFixed(1)} m）`,
    );

    // ---------- 盾牆 ----------
    const wall = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      window.__kill([window.__arty, window.__artyT]);
      const sh = window.__mk(0, 'c_shield', A.x, A.z, 0);
      const ally = window.__mk(0, 'c_mt', A.x, A.z + 3, 0);
      window.__sim(0.2);
      sh.yaw = sh.aimYaw = 0;
      o.why = sh.rtsAbWhy('ab_wall');
      g.rtsOrder([sh], { k: 'ability', ab: 'ab_wall' });
      window.__sim(0.2);
      o.noRes = !!sh.rtsWall;
      R.teams[0].tech.res.r_wall = 1;
      g.rtsOrder([sh], { k: 'ability', ab: 'ab_wall' });
      window.__sim(0.8);
      o.on = !!sh.rtsWall;
      o.allyK = ally.rtsTakenK;
      // 從側後方（約 100°）打：沒有盾牆＝全額、有盾牆 ×0.12
      const src = window.__mk(1, 'c_mt', A.x + 10, A.z + 1.8, 0);
      src.updateAI = () => true;
      sh.yaw = sh.aimYaw = 0;
      let h = sh.hp;
      g.rtsHit(sh, 100, 0, src, 'kin');
      o.sideOn = h - sh.hp;
      sh.rtsAbWall(false);
      h = sh.hp;
      g.rtsHit(sh, 100, 0, src, 'kin');
      o.sideOff = h - sh.hp;
      sh.rtsAbWall(true);
      // 不能移動：推擠也不動
      const p0 = sh.pos.clone();
      window.__sim(3);
      o.still = sh.pos.distanceTo(p0);
      // 移動指令：放下盾牆
      g.rtsOrder([sh], { k: 'move', x: A.x + 10, z: A.z - 10 });
      window.__sim(1);
      o.offAfterMove = !sh.rtsWall;
      window.__sim(1);
      o.allyK2 = ally.rtsTakenK;
      window.__kill([sh, ally, src]);
      return o;
    });
    check(/盾牆/.test(wall.why) && !wall.noRes, `盾牆：沒有研究時不能施放（${wall.why}）`);
    check(wall.on && Math.abs(wall.allyK - 0.7) < 0.01, `盾牆：身後的友軍受到的傷害 ×${wall.allyK}`);
    check(
      wall.sideOff > 0 && Math.abs(wall.sideOn / wall.sideOff - 0.12) < 0.02,
      `盾牆：側後方 100° 的傷害 ${wall.sideOff.toFixed(1)} → ${wall.sideOn.toFixed(1)}`,
    );
    check(wall.still < 0.05, `盾牆：不能移動（${wall.still.toFixed(3)} m）`);
    check(wall.offAfterMove && wall.allyK2 === 1, '盾牆：收到移動指令時放下、掩護消失');

    // ---------- 叉架 MT：投擲貨櫃、貨櫃盾、貨櫃掩體 ----------
    const fork = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      const tgt = window.__dummy(1, 'c_mt', A.x, A.z - 16);
      const f = window.__mk(0, 'c_forklift', A.x, A.z + 2, 0);
      window.__sim(0.2);
      o.crate0 = f.bossVis & 1;
      // 正面的貨櫃盾 ×0.5（從正前方打）
      f.yaw = f.aimYaw = 0;
      const src = window.__dummy(1, 'c_mt', A.x, A.z - 8);
      let h = f.hp;
      g.rtsHit(f, 100, 0, src, 'kin');
      o.front = h - f.hp;
      o.full = 100 * g.rtsDmgK('kin', f);
      g.rtsOrder([f], { k: 'ability', ab: 'ab_crate', x: tgt.pos.x, z: tgt.pos.z });
      const hp0 = tgt.hp;
      window.__sim(0.6);
      o.early = hp0 - tgt.hp;
      o.crateGone = !(f.bossVis & 1);
      window.__sim(0.8);
      o.dmg = hp0 - tgt.hp;
      o.expect = 90 * g.rtsDmgK('exp', tgt);
      o.cd = Math.round(f.rtsCd.ab_crate - R.t);
      f.yaw = f.aimYaw = 0;
      h = f.hp;
      g.rtsHit(f, 100, 0, src, 'kin');
      o.frontNo = h - f.hp;
      window.__sim(19);
      o.crateBack = f.bossVis & 1;
      // 掩體：Coral 15、臨時牆、導航格擋住 30 秒
      const c0 = R.teams[0].coral;
      const cx = A.x,
        cz = A.z - 5;
      g.rtsOrder([f], { k: 'ability', ab: 'ab_cover', x: cx, z: cz });
      window.__sim(0.3);
      o.coral = c0 - R.teams[0].coral;
      o.walls = (g.tWalls || []).length;
      o.navBlocked = !g.world.nav.buildable(cx, cz, 2, 2);
      window.__fork = f;
      window.__forkT = [tgt, src];
      window.__coverAt = { x: cx, z: cz };
      return o;
    });
    check(
      fork.crate0 && Math.abs(fork.front / fork.full - 0.5) < 0.02,
      `叉架 MT：舉著貨櫃，正面傷害 ${fork.front.toFixed(1)}（全額 ${fork.full.toFixed(1)} 的一半）`,
    );
    check(
      fork.early === 0 && fork.crateGone && Math.abs(fork.dmg - fork.expect) / fork.expect < 0.1,
      `投擲貨櫃：1 秒後落地（之前 ${fork.early}），傷害 ${fork.dmg.toFixed(1)}（預期 ${fork.expect.toFixed(1)}）、冷卻 ${fork.cd} 秒`,
    );
    check(
      Math.abs(fork.frontNo / fork.full - 1) < 0.02 && fork.crateBack,
      `丟出後沒有貨櫃盾（正面 ${fork.frontNo.toFixed(1)}），20 秒後舉回`,
    );
    check(
      fork.coral === 15 && fork.walls >= 1 && fork.navBlocked,
      `貨櫃掩體：Coral ${fork.coral}、臨時牆 ${fork.walls}、導航格擋住`,
    );

    // 截圖：貨櫃掩體、拋出中的貨櫃與預警圈、踏地的衝擊波、架設的自走砲、照明彈、火箭齊射的預警線
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      g.fx.update(10); // 之前快轉時沒有更新特效（rtsSim 不跑 fx）
      const f = window.__fork;
      const t = window.__dummy(1, 'c_mt', A.x - 12, A.z - 12);
      const st = window.__mk(0, 'c_stomper', A.x + 10, A.z - 2, 0);
      st.rtsAuto = { ab_stomp: false };
      window.__dummy(1, 'c_mt', A.x + 13, A.z - 3);
      window.__dummy(1, 'c_mt', A.x + 7, A.z - 4);
      const ar = window.__mk(0, 'c_arty', A.x - 6, A.z + 8, 0);
      const mo = window.__mk(0, 'c_mortar', A.x + 16, A.z + 10, 0);
      const he = window.__mk(0, 'c_heli', A.x + 2, A.z + 14, 0);
      g.rtsOrder([ar], { k: 'ability', ab: 'ab_siege' });
      window.__sim(3.3, null, 1 / 20, true);
      f.rtsCd.ab_crate = 0;
      g.rtsOrder([f], { k: 'ability', ab: 'ab_crate', x: t.pos.x, z: t.pos.z });
      g.rtsOrder([mo], { k: 'ability', ab: 'ab_flare', x: A.x + 20, z: A.z - 14 });
      g.rtsOrder([he], { k: 'ability', ab: 'ab_rockets', x: A.x - 4, z: A.z - 4 });
      window.__sim(0.35, null, 1 / 20, true);
      g.rtsOrder([st], { k: 'ability', ab: 'ab_stomp' });
      window.__sim(0.15, null, 1 / 20, true);
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0);
      if (g.rtsFogTick) g.rtsFogTick(0.5);
      g.rtsCamJump(A.x, A.z);
      g.rts.cam.dist = 55;
      for (let i = 0; i < 3; i++) {
        g.rtsCamUpdate(1 / 60);
        g.renderMain();
      }
    });
    await shot('rts-castron-abil.png');

    // ---------- 踏地 ----------
    const stomp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      for (const e of [...R.units])
        if (!e.bld && !e.dead && Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < 40) window.__kill([e]);
      window.__kill([]);
      const s = window.__mk(0, 'c_stomper', A.x, A.z, 0);
      const a = window.__dummy(1, 'c_mt', A.x + 4, A.z);
      const b = window.__dummy(1, 'c_mt', A.x - 4, A.z + 1);
      const far = window.__dummy(1, 'c_mt', A.x + 14, A.z);
      const heli = window.__dummy(1, 'c_heli', A.x, A.z + 3);
      const hp = () => [a.hp, b.hp, far.hp, heli.hp];
      // 只算踏地（爆發）的傷害：重踏機甲同時也會用霰彈打
      let ex = 0;
      const td0 = a.takeDamage;
      a.takeDamage = function (...x) {
        const h = this.hp;
        const r = td0.apply(this, x);
        if (x[7] === 'exp') ex += h - this.hp;
        return r;
      };
      const h0 = hp();
      window.__sim(0.6);
      const h1 = hp();
      o.auto = !!(s.rtsCd.ab_stomp > R.t);
      o.dmg = ex;
      o.expect = 60 * g.rtsDmgK('exp', a);
      o.far = h0[2] - h1[2];
      o.heli = h0[3] - h1[3];
      o.stag = a.staggerT;
      R.teams[0].tech.res.r_stomp = 1;
      s.rtsAuto.ab_stomp = false;
      s.rtsCd.ab_stomp = 0;
      window.__sim(1);
      g.rtsOrder([s], { k: 'ability', ab: 'ab_stomp' });
      window.__sim(0.05);
      o.stag2 = a.staggerT;
      window.__kill([s, a, b, far, heli]);
      return o;
    });
    check(
      stomp.auto &&
        Math.abs(stomp.dmg - stomp.expect) / stomp.expect < 0.05 &&
        stomp.far === 0 &&
        stomp.heli === 0,
      `踏地：自動施放、傷害 ${stomp.dmg.toFixed(1)}（預期 ${stomp.expect.toFixed(1)}）、9 m 外與空中不受影響`,
    );
    check(
      stomp.stag > 0.3 && stomp.stag2 > 1.3,
      `踏地：失衡 ${stomp.stag.toFixed(2)} 秒、重踏強化後 ${stomp.stag2.toFixed(2)} 秒`,
    );

    // ---------- 直升機：直線飛越、只被對空單位打、火箭齊射 ----------
    const heli = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        w = g.world,
        o = {};
      // 中間擋一座重工廠：直升機直線飛過去，地面單位繞路
      const blk = g.rtsSpawnBld(0, 'c_heavy', A.x, A.z, 0, 1);
      const h = window.__mk(0, 'c_heli', A.x, A.z + 22, 0);
      const m = window.__mk(0, 'c_mt', A.x + 2, A.z + 22, 0);
      g.rtsOrder([h], { k: 'move', x: A.x, z: A.z - 22 });
      g.rtsOrder([m], { k: 'move', x: A.x + 2, z: A.z - 22 });
      let dev = 0,
        devM = 0;
      let tH = -1;
      const t0 = g.rts.t;
      const t = window.__sim(40, () => {
        dev = Math.max(dev, Math.abs(h.pos.x - A.x));
        devM = Math.max(devM, Math.abs(m.pos.x - A.x - 2));
        if (tH < 0 && Math.abs(h.pos.z - (A.z - 22)) < 2) tH = g.rts.t - t0;
        return tH > 0 && Math.abs(m.pos.z - (A.z - 22)) < 3;
      });
      o.t = t;
      o.tH = tH;
      o.dev = dev;
      o.devM = devM;
      o.alt = h.pos.y - w.terrainHeight(h.pos.x, h.pos.z);
      window.__kill([blk, m]);
      // 對空：盾牌 MT（只打地面）不理它，MT 打得到
      h.updateAI = () => true;
      h.maxHp = h.hp = 1e6;
      const sh = window.__mk(1, 'c_shield', h.pos.x + 12, h.pos.z, 0);
      const h0 = h.hp;
      window.__sim(5);
      o.byShield = h0 - h.hp;
      o.shieldEngage = !!(sh.rt && sh.rt.engage);
      const mt = window.__mk(1, 'c_mt', h.pos.x - 12, h.pos.z, 0);
      const h1 = h.hp;
      window.__sim(5);
      o.byMt = h1 - h.hp;
      window.__kill([sh, mt]);
      // 火箭齊射：Coral 20、預警 1 秒、8 發沿直線
      delete h.updateAI;
      const ts = [0, 1, 2].map((i) => window.__dummy(1, 'c_stomper', A.x, A.z - 38 + i * 8));
      const c0 = R.teams[0].coral;
      g.rtsOrder([h], { k: 'ability', ab: 'ab_rockets', x: A.x, z: A.z - 30 });
      // 只算火箭（沒有武器 id 的投射物）：直升機之後也會用機槍打
      const rk = ts.map(() => 0);
      ts.forEach((e, i) => {
        const td0 = e.takeDamage;
        e.takeDamage = function (...x) {
          const h = this.hp;
          const r = td0.apply(this, x);
          if (!x[6]) rk[i] += h - this.hp;
          return r;
        };
      });
      window.__sim(0.8);
      o.rEarly = rk.reduce((s, v) => s + v, 0);
      o.rCoral = c0 - R.teams[0].coral;
      window.__sim(2.2);
      o.rHit = rk.filter((v) => v > 0).length;
      o.rDmg = rk.reduce((s, v) => s + v, 0);
      o.rExp = 8 * 45 * g.rtsDmgK('pierce', ts[0]);
      o.rCd = Math.round(h.rtsCd.ab_rockets - R.t);
      window.__heliT = ts;
      window.__heli = h;
      return o;
    });
    check(
      heli.tH > 0 && heli.t > 0 && heli.dev < 1.5 && heli.devM > 4 && heli.alt > 4,
      `直升機：直線飛越建築（${heli.tH.toFixed(1)} 秒、地面 MT ${heli.t.toFixed(1)} 秒；偏離 ${heli.dev.toFixed(1)} m，地面 MT 繞路 ${heli.devM.toFixed(1)} m）、離地 ${heli.alt.toFixed(1)} m`,
    );
    check(
      heli.byShield === 0 && !heli.shieldEngage && heli.byMt > 0,
      `直升機：盾牌 MT 打不到（${heli.byShield}），MT 打得到（${heli.byMt.toFixed(0)}）`,
    );
    check(
      heli.rEarly === 0 && heli.rCoral === 20 && heli.rHit >= 2 && heli.rDmg > heli.rExp * 0.4,
      `火箭齊射：Coral ${heli.rCoral}、預警時沒有傷害、命中 ${heli.rHit} 台共 ${heli.rDmg.toFixed(0)}（8 發都直接命中＝${heli.rExp.toFixed(0)}；間隔 3.4 m、範圍 2.5 m）、冷卻 ${heli.rCd} 秒`,
    );

    // ---------- 照明彈 ----------
    const flare = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      window.__kill([window.__heli, ...window.__heliT]);
      const m = window.__mk(0, 'c_mortar', A.x, A.z + 20, 0);
      const c0 = R.teams[0].coral;
      const F = R.fog;
      const n0 = F ? F.reveals.length : 0;
      g.rtsOrder([m], { k: 'ability', ab: 'ab_flare', x: A.x, z: A.z - 25 });
      window.__sim(0.3);
      const rv = F ? F.reveals[F.reveals.length - 1] : null;
      const o = {
        coral: c0 - R.teams[0].coral,
        added: F ? F.reveals.length - n0 : -1,
        r: rv ? rv.r : 0,
        t: rv ? rv.t : 0,
      };
      window.__kill([m]);
      return o;
    });
    check(
      flare.coral === 10 && flare.added === 1 && flare.r === 18 && flare.t > 9,
      `照明彈：Coral ${flare.coral}、揭露半徑 ${flare.r} m、${flare.t.toFixed(1)} 秒`,
    );

    // ---------- 防禦塔：起重機砲台只打地面、防空砲塔只打空中 ----------
    const tw = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const crane = g.rtsSpawnBld(0, 'c_tower', A.x - 15, A.z, 0, 1);
      const flak = g.rtsSpawnBld(0, 'c_flak', A.x + 15, A.z, 0, 1);
      const gnd = window.__dummy(1, 'c_stomper', A.x, A.z - 22);
      const air = window.__dummy(1, 'c_heli', A.x, A.z + 22);
      const g0 = gnd.hp,
        a0 = air.hp;
      window.__sim(10);
      o.craneTgt = crane.rtw && crane.rtw.tgt ? crane.rtw.tgt.rtsDef : null;
      o.flakTgt = flak.rtw && flak.rtw.tgt ? flak.rtw.tgt.rtsDef : null;
      o.gnd = g0 - gnd.hp;
      o.air = a0 - air.hp;
      o.armYaw = crane.model.arm ? crane.model.arm.rotation.y : null;
      // 指定目標（攻擊指令）
      const gnd2 = window.__dummy(1, 'c_mt', A.x - 30, A.z + 6);
      g.rtsOrder([crane], { k: 'attack', id: gnd2.id });
      const h2 = gnd2.hp;
      window.__sim(6);
      o.ordered = h2 - gnd2.hp;
      window.__kill([crane, flak, gnd, air, gnd2]);
      return o;
    });
    check(
      tw.craneTgt === 'c_stomper' && tw.flakTgt === 'c_heli' && tw.gnd > 0 && tw.air > 0,
      `防禦塔：起重機砲台打 ${tw.craneTgt}（${tw.gnd.toFixed(0)}）、防空砲塔打 ${tw.flakTgt}（${tw.air.toFixed(0)}）`,
    );
    check(tw.ordered > 0, `防禦塔：攻擊指令指定的目標（${tw.ordered.toFixed(0)}）`);

    // ---------- 民兵 ----------
    const mil = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq,
        o = {};
      const ws = window.__of(0, 'c_worker');
      o.workers = ws.length;
      o.n = g.rtsMilitia(hq);
      const ms = window.__of(0, 'c_militia');
      o.mil = ms.length;
      const m = ms[0];
      o.gun = m ? m.weapons.rarm.def.id : null;
      o.kit = m ? !!m.model.rtsKit : null;
      // 打得到：攻擊一個靶
      const tgt = window.__dummy(1, 'c_stomper', hq.pos.x + 14, hq.pos.z + 14);
      g.rtsOrder(ms, { k: 'attack', id: tgt.id });
      const h0 = tgt.hp;
      window.__sim(6);
      o.dmg = h0 - tgt.hp;
      window.__kill([tgt]);
      o.back = g.rtsDemob(hq);
      const w = window.__of(0, 'c_worker');
      o.workers2 = w.length;
      o.kit2 = w.every((e) => !!e.model.rtsKit);
      o.gun2 = w[0] ? w[0].weapons.rarm.def.type : null;
      o.gather = w.filter((e) => e.orders[0] && e.orders[0].k === 'gather').length;
      void R;
      return o;
    });
    check(
      mil.n > 0 && mil.mil === mil.n && mil.gun === 'w_rifle' && mil.kit === false && mil.dmg > 0,
      `民兵：${mil.n} 台作業 MT 換成步槍（${mil.gun}、沒有工程套件）、開火 ${mil.dmg.toFixed(0)}`,
    );
    check(
      mil.back === mil.n && mil.workers2 === mil.workers && mil.kit2 && mil.gather === mil.workers2,
      `解除動員：變回作業 MT（工程套件 ${mil.kit2}、回去採集 ${mil.gather}／${mil.workers2}）`,
    );

    // ---------- 城牆擋路（尋路繞過） ----------
    const walls = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const ws = [];
      for (let i = -3; i <= 3; i++) ws.push(g.rtsSpawnBld(0, 'c_wall', A.x + i * 4, A.z, 0, 1));
      const m = window.__mk(0, 'c_mt', A.x, A.z + 14, 0);
      g.rtsOrder([m], { k: 'move', x: A.x, z: A.z - 14 });
      let minD = 1e9;
      const t = window.__sim(40, () => {
        for (const w of ws) {
          const dx = Math.abs(m.pos.x - w.pos.x) - 2,
            dz = Math.abs(m.pos.z - w.pos.z) - 1;
          minD = Math.min(minD, Math.max(dx, dz));
        }
        return Math.hypot(m.pos.x - A.x, m.pos.z - (A.z - 14)) < 2.5;
      });
      o.t = t;
      o.minD = minD;
      o.blocked = !g.world.nav.lineClear(A.x, A.z + 14, A.x, A.z - 14, 1);
      window.__kill([m, ...ws]);
      return o;
    });
    check(
      walls.blocked && walls.t > 0 && walls.minD > 0,
      `城牆擋路：尋路繞過（${walls.t.toFixed(1)} 秒、離牆最近 ${walls.minD.toFixed(2)} m）`,
    );

    // ---------- 建築與單位的截圖（合併後切換主堡的階） ----------
    const gal = await ev(() => {
      const g = window.__game,
        A = window.__A;
      g.fx.update(30);
      const ids = ['c_works', 'c_tower', 'c_market', 'c_heavy', 'c_flak', 'c_helipad'];
      const xs = [-34, -18, -4, 14, 30, 30];
      const zs = [-10, -12, -10, -10, -14, 10];
      const out = [];
      ids.forEach((id, i) => out.push(g.rtsSpawnBld(0, id, A.x + xs[i], A.z + zs[i], 0, 1)));
      for (let i = 0; i < 4; i++) out.push(g.rtsSpawnBld(0, 'c_wall', A.x - 30 + i * 4, A.z + 6, 0, 1));
      const us = ['c_mt', 'c_shield', 'c_forklift', 'c_mortar', 'c_stomper', 'c_tank', 'c_arty', 'c_heli'];
      us.forEach((id, i) => {
        const e = window.__mk(0, id, A.x - 18 + i * 5, A.z + 12, Math.PI);
        e.updateAI = () => true;
      });
      const hq2 = g.rtsSpawnBld(1, 'c_hq', A.x + 4, A.z + 32, 0, 1);
      window.__hqG = hq2;
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0);
      if (g.rtsFogTick) g.rtsFogTick(0.5);
      g.rtsCamJump(A.x, A.z + 6);
      g.rts.cam.dist = 85;
      for (let i = 0; i < 3; i++) {
        g.rtsCamUpdate(1 / 60);
        g.renderMain();
      }
      return { merged: !!hq2.model.merged, n: out.length };
    });
    await shot('rts-castron-blds.png');
    const tier = await ev(() => {
      const g = window.__game,
        hq = window.__hqG;
      const o = { merged: !!hq.model.merged };
      hq.model.setTier(3);
      o.t3 = [hq.model.tier, hq.model.tier2.visible, hq.model.tier3.visible].join('/');
      g.rtsCamJump(hq.pos.x, hq.pos.z);
      g.rts.cam.dist = 45;
      for (let i = 0; i < 3; i++) {
        g.rtsCamUpdate(1 / 60);
        g.renderMain();
      }
      return o;
    });
    await shot('rts-castron-hq3.png');
    const tier2 = await ev(() => {
      const g = window.__game,
        hq = window.__hqG;
      hq.model.setTier(2);
      for (let i = 0; i < 2; i++) {
        g.rtsCamUpdate(1 / 60);
        g.renderMain();
      }
      return [hq.model.tier, hq.model.tier2.visible, hq.model.tier3.visible].join('/');
    });
    await shot('rts-castron-hq2.png');
    check(gal.n === 10, `新建築的截圖（${gal.n} 棟，rts-castron-blds.png）`);
    check(
      tier.merged && tier.t3 === '3/true/true' && tier2 === '2/true/false',
      `合併過的主堡切換階：T3 ${tier.t3}、T2 ${tier2}（rts-castron-hq3.png、-hq2.png）`,
    );
    await ctx.close();
  }

  return { testRtsCastron };
};
