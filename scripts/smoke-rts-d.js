// Coral 戰爭（RTS）R2 D 包（中立與地圖）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-d')(H)。
// testRtsNeutral：營地的數量與對稱（兩邊同編成、同掉寶、位置點對稱）、靠近才出動、追擊上限與回營回血、整營全滅的掉寶
// 與資源、打野經驗（C 包的 rtsXpOnKill 有實作時）、酒館（距離條件、全場唯一；C 包的 rtsHire 有實作時另測雇用）、
// 中立商店的庫存與補貨、傭兵營的庫存與補貨、中立建築打不壞；營地與中立建築的截圖。
// 電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉（不等實際時間）。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsNeutral(browser, base) {
    console.log('Coral 戰爭：野怪營地、酒館、商店、傭兵營（R2 中立）');
    const { ctx, page } = await newPage(browser, 'rtsNeutral');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 開局：營地與中立建築 ----------
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
      const R = g.rts;
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
        }
        return until && !until() ? -1 : t;
      };
      // 測試用的單位：放在 (x, z) 附近可以走的格子
      window.__mk = (team, def, x, z) => {
        const c = g.world.nav.nearestCell(x, z, 1, -1, 12);
        const p = c >= 0 ? g.world.nav.center(c) : { x, z };
        return g.rtsSpawn(team, def, p.x, p.z, 0);
      };
      R.teams[0].ore = R.teams[1].ore = 20000;
      R.teams[0].coral = R.teams[1].coral = 20000;
      const plan = g.world.rts;
      const sig = (c) => [...c.ents].map((e) => e.rtsDef).join(',');
      const pairs = [];
      for (let i = 0; i + 1 < R.camps.length; i += 2) {
        const a = R.camps[i],
          b = R.camps[i + 1];
        pairs.push({
          same: sig(a) === sig(b) && JSON.stringify(a.loot) === JSON.stringify(b.loot) && a.tier === b.tier,
          sym: Math.abs(a.pos.x + b.pos.x) < 1e-6 && Math.abs(a.pos.z + b.pos.z) < 1e-6,
          n: a.ents.size,
          set: a.set.length,
          sig: sig(a),
          loot: a.loot,
          tier: a.tier,
        });
      }
      const neu = R.neutrals.map((q) => ({
        kind: q.kind,
        inv: !!q.ent.rtsInv,
        noLock: !!q.ent.noLock,
        team: q.ent.rtsTeam,
        stock: Object.keys(q.stock).length,
      }));
      // 中立建築打不壞：一般傷害與 rtsHit 都沒效
      const tav = R.neutrals.find((q) => q.kind === 'tavern').ent;
      const hp0 = tav.hp;
      tav.takeDamage(5000, 100, null, tav.center());
      const hit = g.rtsHit(tav, 5000, 0, null, 'exp');
      const creeps = R.units.filter((e) => e.creep && !e.dead);
      return {
        camps: R.camps.length,
        planCamps: plan.camps.length,
        pairs,
        neu,
        invHp: [hp0, tav.hp, hit],
        creeps: creeps.length,
        creepTeam: creeps.every((e) => e.rtsTeam === 2),
        hostile: R.hostile[0].filter((e) => e.creep).length,
        tiers: R.camps.map((c) => c.tier).join(''),
      };
    });
    check(
      st.camps === st.planCamps && st.camps >= 6 && st.camps <= 10,
      `營地 ${st.camps} 個（地圖 ${st.planCamps}，等級 ${st.tiers}）、野怪 ${st.creeps} 台`,
    );
    check(
      st.pairs.every((p) => p.same && p.sym && p.n === p.set && p.n >= 3),
      '兩邊對稱的營地：同編成、同掉寶、位置點對稱：' +
        st.pairs.map((p) => `T${p.tier}[${p.sig}｜${p.loot.item || '—'}+${p.loot.ore}]`).join(' '),
    );
    check(
      st.creepTeam && st.hostile === st.creeps,
      `野怪屬於中立隊伍、在玩家的敵對名單裡（${st.hostile}／${st.creeps}）`,
    );
    const kinds = st.neu
      .map((q) => q.kind)
      .sort()
      .join(',');
    check(
      kinds === 'merc,merc,shop,shop,tavern' && st.neu.every((q) => q.inv && q.noLock && q.team === 2),
      `中立建築：${kinds}（打不壞、不能鎖定、中立隊伍）`,
    );
    check(
      st.invHp[0] === st.invHp[1] && st.invHp[2] === 0,
      `中立建築打不壞（血量 ${st.invHp[0]} → ${st.invHp[1]}、rtsHit ${st.invHp[2]}）`,
    );

    // ---------- 出動、追擊上限、回營回血 ----------
    const ag = await ev(() => {
      const g = window.__game,
        R = g.rts;
      // 小營地（離兩邊主堡最遠的那個）
      const camp = R.camps
        .filter((c) => c.tier === 1)
        .sort((a, b) => Math.hypot(b.pos.x, b.pos.z) - Math.hypot(a.pos.x, a.pos.z))[0];
      window.__camp = camp;
      const o = { id: camp.id, tier: camp.tier };
      // 30 m 外：不出動
      const dx = -camp.pos.x,
        dz = -camp.pos.z;
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L,
        uz = dz / L;
      const bait = window.__mk(0, 'c_mt', camp.pos.x + ux * 30, camp.pos.z + uz * 30);
      bait.orders = [{ k: 'hold' }];
      bait.maxHp = bait.hp = 1e7;
      window.__bait = bait;
      window.__sim(3);
      o.far = camp.st;
      // 走到 8 m：出動
      bait.orders = [{ k: 'move', x: camp.pos.x + ux * 8, z: camp.pos.z + uz * 8 }];
      o.tAggro = window.__sim(12, () => camp.st === 'fight');
      // 往外跑 90 m（野怪追到追擊上限就回營）：記下離營地中心最遠的距離
      const fx = camp.pos.x + ux * 90,
        fz = camp.pos.z + uz * 90;
      bait.orders = [{ k: 'move', x: fx, z: fz }];
      bait.speedMul *= 1.6;
      let maxD = 0;
      o.tRet = window.__sim(40, () => {
        for (const e of camp.ents)
          if (!e.dead) maxD = Math.max(maxD, Math.hypot(e.pos.x - camp.pos.x, e.pos.z - camp.pos.z));
        return camp.st === 'return';
      });
      o.maxD = Math.round(maxD * 10) / 10;
      // 回營途中受傷 → 回到營地時滿血
      for (const e of camp.ents) if (!e.dead) e.hp = e.maxHp * 0.3;
      o.tIdle = window.__sim(30, () => camp.st === 'idle');
      o.full = [...camp.ents].every((e) => e.dead || e.hp >= e.maxHp - 0.5);
      o.home = [...camp.ents].every((e) => Math.hypot(e.pos.x - e.rtsHome.x, e.pos.z - e.rtsHome.z) < 3);
      bait.orders = [{ k: 'hold' }];
      return o;
    });
    check(ag.far === 'idle', `${ag.id}（T${ag.tier}）：30 m 外的敵人不出動（${ag.far}）`);
    check(ag.tAggro >= 0, `敵人走進出動半徑：整營出動（${ag.tAggro.toFixed(1)} 秒）`);
    check(
      ag.tRet >= 0 && ag.maxD <= 28 + 10,
      `目標跑出追擊範圍：回營（野怪離營地中心最遠 ${ag.maxD} m ≤ 28＋10、${ag.tRet.toFixed(1)} 秒）`,
    );
    check(ag.tIdle >= 0 && ag.full && ag.home, `回營：回到原位、血量回滿（${ag.tIdle.toFixed(1)} 秒）`);

    // ---------- 打野經驗（C 包）與整營全滅的掉寶 ----------
    const lt = await ev(() => {
      const g = window.__game,
        R = g.rts,
        camp = window.__camp,
        bait = window.__bait;
      const o = { items0: R.items.length, loot: camp.loot };
      // 英雄（C 包有實作時）：1 級時擊破一台野怪的經驗
      o.xp = null;
      if (g.rtsHeroSpawned && g.rtsXpOnKill && g.rtsNeutralDef('h_bastion')) {
        try {
          const h = window.__mk(0, 'h_bastion', camp.pos.x + 6, camp.pos.z);
          g.rtsHeroSpawned(h, { id: 'h_bastion' });
          h.maxHp = h.hp = 1e7;
          const v = [...camp.ents].find((e) => !e.dead);
          const xp0 = h.hero ? h.hero.xp : 0;
          const lv = g.rtsNeutralDef(v.rtsDef).lv;
          g.rtsHit(v, 1e7, 0, h, 'kin');
          o.xp = { got: (h.hero ? h.hero.xp : 0) - xp0, lv, hlv: h.hero ? h.hero.lv : 0 };
        } catch (err) {
          o.xpErr = String(err);
        }
      }
      o.ore0 = R.teams[0].ore;
      o.coral0 = R.teams[0].coral;
      // 全滅：剩下的由 bait 擊破（最後一台的位置掉寶）
      for (const e of [...camp.ents]) if (!e.dead) g.rtsHit(e, 1e7, 0, bait, 'kin');
      // 掉寶在擊破的當下（rtsOnDeath → rtsLootOnKill）入帳：先量資源，再推進（工人繳礦會混進來）
      o.dOre = Math.round(R.teams[0].ore - o.ore0);
      o.dCoral = Math.round(R.teams[0].coral - o.coral0);
      window.__sim(0.2);
      o.cleared = camp.cleared;
      o.by = camp.clearedBy;
      o.items = R.items.length - o.items0;
      const it = R.items[R.items.length - 1];
      o.item = it ? it.item : null;
      // 中營地：2 階道具＋礦石 50
      const c2 = R.camps.find((c) => c.tier === 2 && !c.cleared);
      if (c2) {
        const ore = R.teams[0].ore,
          n0 = R.items.length;
        for (const e of [...c2.ents]) if (!e.dead) g.rtsHit(e, 1e7, 0, bait, 'kin');
        const it2 = R.items[R.items.length - 1];
        o.t2 = {
          loot: c2.loot,
          dOre: Math.round(R.teams[0].ore - ore),
          items: R.items.length - n0,
          item: it2 && it2.item,
        };
      }
      return o;
    });
    if (lt.xp)
      check(
        lt.xp.got > 0,
        `打野經驗：1 級英雄擊破 lv ${lt.xp.lv} 的野怪 +${Math.round(lt.xp.got)}（C 包的 rtsXpOnKill）`,
      );
    else console.log(`  （英雄還沒有實作，略過打野經驗${lt.xpErr ? '：' + lt.xpErr : ''}）`);
    check(
      lt.cleared && lt.by === 0 && lt.dOre === lt.loot.ore && lt.dCoral === lt.loot.coral,
      `整營全滅：營地清除、資源給擊破者（礦石 +${lt.dOre}、Coral +${lt.dCoral}，不套維持費）`,
    );
    if (lt.t2)
      check(
        lt.t2.dOre === lt.t2.loot.ore &&
          lt.t2.loot.ore === 50 &&
          lt.t2.items === 1 &&
          lt.t2.item === lt.t2.loot.item,
        `中營地全滅：${lt.t2.item}＋礦石 ${lt.t2.dOre}`,
      );
    check(
      lt.loot.item ? lt.items === 1 && lt.item === lt.loot.item : lt.items === 0,
      `掉寶：${lt.loot.item ? lt.item + '（地上 ' + lt.items + ' 個）' : '沒有道具（改給礦石）'}`,
    );

    // ---------- 酒館、商店、傭兵營 ----------
    const nb = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const o = {};
      const tav = R.neutrals.find((q) => q.kind === 'tavern');
      const merc = R.neutrals.find((q) => q.kind === 'merc' && q.near === 0);
      const shop = R.neutrals.find((q) => q.kind === 'shop' && q.near === 0);
      // 酒館：沒有單位在 14 m 內不能雇
      const hero = 't_rust';
      o.tavFar = g.rtsTavernWhy(0, tav, hero);
      const front = (q, k = 4) => {
        const b = q.ent;
        const half = (Math.round(b.yaw / (Math.PI / 2)) & 1 ? b.bld.w : b.bld.d) / 2;
        return [b.pos.x + Math.sin(b.yaw) * (half + k), b.pos.z + Math.cos(b.yaw) * (half + k)];
      };
      const [tx, tz] = front(tav);
      const u0 = window.__mk(0, 'c_mt', tx, tz);
      u0.orders = [{ k: 'hold' }];
      const u1 = window.__mk(1, 'c_mt', tx - 2, tz);
      u1.orders = [{ k: 'hold' }];
      u0.maxHp = u0.hp = u1.maxHp = u1.hp = 1e7;
      o.tavNear = g.rtsTavernWhy(0, tav, hero);
      o.tavNear1 = g.rtsTavernWhy(1, tav, hero);
      // C 包的雇用有實作時：真的雇用；否則只測 D 的全場唯一
      o.hired = null;
      if (g.rtsHire) {
        try {
          // 隊伍 1 還沒有英雄（隊伍 0 在打野經驗的檢查已經有一位，第 2 位要 T2）
          const r = g.rtsHire(1, tav.ent, hero);
          o.hired = !!r;
          o.hire2 = !!g.rtsHire(0, tav.ent, hero);
        } catch (err) {
          o.hireErr = String(err);
        }
      }
      if (!o.hired) g.rtsTavernTake(tav, hero, 1);
      o.owner = g.rtsTavernOwner(hero);
      o.tavOther = g.rtsTavernWhy(0, tav, hero);
      o.tavMine = g.rtsTavernWhy(1, tav, hero);
      // 傭兵營
      const id = Object.keys(merc.stock)[0];
      o.mercId = id;
      o.mercFar = g.rtsMercWhy(0, merc, id);
      const [mx, mz] = front(merc);
      const m0 = window.__mk(0, 'c_mt', mx, mz);
      m0.orders = [{ k: 'hold' }];
      m0.maxHp = m0.hp = 1e7;
      const T = R.teams[0];
      g.rtsRecount();
      o.pop0 = T.pop;
      if (T.cap < T.pop + 20) {
        window.__depots = [];
        for (let i = 0; i < 3; i++) {
          const p = g.rtsAutoSpot(0, 'c_depot');
          if (p) window.__depots.push(g.rtsSpawnBld(0, 'c_depot', p.x, p.z, 0, 1));
        }
        g.rtsRecount();
      }
      const ore0 = T.ore;
      const a = g.rtsMercHire(0, merc, id);
      const b = g.rtsMercHire(1, merc, id); // 對手沒有單位在附近
      const c = g.rtsMercHire(0, merc, id);
      const d = g.rtsMercHire(0, merc, id); // 庫存 2：第 3 台不行
      o.merc = [!!a, !!b, !!c, !!d];
      o.mercCost = Math.round(ore0 - T.ore);
      const MD = g.rtsNeutralDef(id);
      o.mercDef = { cost: MD.cost, pop: MD.pop };
      o.mercUnit = a
        ? { team: a.rtsTeam, creep: !!a.creep, card: !!(g.rtsNeutralDef(a.rtsDef).card || []).length }
        : null;
      g.rtsRecount();
      o.pop1 = T.pop;
      o.stock0 = merc.stock[id].n;
      o.why0 = g.rtsMercWhy(0, merc, id);
      window.__sim(61);
      o.stock1 = merc.stock[id].n;
      // 中立商店：庫存（C 包的道具表有內容時）與補貨
      const items = Object.keys(shop.stock);
      o.shopItems = items.length;
      if (items.length) {
        const it = items[items.length - 1];
        const s = shop.stock[it];
        o.shopIt = it;
        o.shopMax = s.max;
        o.shopFar = g.rtsShopWhy(0, shop, it);
        let n = 0;
        while (g.rtsShopTake(shop, it)) n++;
        o.shopTaken = n;
        o.shopEmpty = g.rtsShopWhy(0, shop, it);
        o.shopWait = s.wait;
        window.__sim(s.wait + 1);
        o.shopBack = s.n;
      }
      return o;
    });
    check(
      /14 m/.test(nb.tavFar) && nb.tavNear === '' && nb.tavNear1 === '',
      `酒館：沒有單位在 14 m 內不能雇（「${nb.tavFar}」），走近之後可以`,
    );
    if (nb.hired !== null || nb.hireErr)
      check(
        nb.hired && !nb.hire2,
        `酒館雇用（C 包的 rtsHire）：隊伍 1 雇用 RUST、隊伍 0 不能再雇${nb.hireErr || ''}`,
      );
    else console.log('  （英雄的雇用還沒有實作，只測全場唯一）');
    check(
      nb.owner === 1 && /對手/.test(nb.tavOther) && /已經雇用/.test(nb.tavMine),
      `酒館的英雄全場唯一：被隊伍 1 雇走後隊伍 0「${nb.tavOther}」`,
    );
    check(/14 m/.test(nb.mercFar), `傭兵營：沒有單位在附近不能雇（「${nb.mercFar}」）`);
    check(
      nb.merc.join() === 'true,false,true,false' &&
        nb.mercCost === 2 * nb.mercDef.cost.ore &&
        nb.pop1 - nb.pop0 === 2 * nb.mercDef.pop,
      `傭兵 ${nb.mercId}：雇用 2 台（礦石 −${nb.mercCost}、人口 +${nb.pop1 - nb.pop0}），對手不在附近不能雇、第 3 台缺貨（「${nb.why0}」）`,
    );
    check(
      nb.mercUnit && nb.mercUnit.team === 0 && !nb.mercUnit.creep && nb.mercUnit.card,
      '傭兵屬於雇用的隊伍、照一般單位的指令',
    );
    check(nb.stock0 === 0 && nb.stock1 === 1, `傭兵營補貨：60 秒補 1 台（${nb.stock0} → ${nb.stock1}）`);
    if (nb.shopItems)
      check(
        nb.shopTaken === nb.shopMax &&
          /缺貨/.test(nb.shopEmpty) &&
          nb.shopBack === 1 &&
          /英雄/.test(nb.shopFar),
        `中立商店：${nb.shopItems} 種，${nb.shopIt} 庫存 ${nb.shopMax}、賣完「${nb.shopEmpty}」、${nb.shopWait} 秒補 1 個；沒有英雄「${nb.shopFar}」`,
      );
    else console.log('  （道具表還沒有內容，略過中立商店的庫存）');

    // ---------- 截圖：營地、酒館、商店與傭兵營 ----------
    const SHOTS = ['camp', 'tavern', 'shop', 'merc'];
    for (let idx = 0; idx < SHOTS.length; idx++) {
      await ev(
        ({ idx }) => {
          const g = window.__game,
            R = g.rts;
          const p = [
            () => R.camps.filter((c) => !c.cleared).sort((a, b) => b.tier - a.tier)[0].pos,
            () => R.neutrals.find((q) => q.kind === 'tavern').ent.pos,
            () => R.neutrals.find((q) => q.kind === 'shop').ent.pos,
            () => R.neutrals.find((q) => q.kind === 'merc').ent.pos,
          ][idx]();
          if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
          if (g.rtsCamJump) g.rtsCamJump(p.x, p.z);
          if (R.cam) R.cam.dist = [42, 46, 38, 38][idx];
          window.__pump(0.25, null, 1 / 30);
        },
        { idx },
      );
      await page.screenshot({ path: path.join(SHOT_DIR, `rts-neutral-${SHOTS[idx]}.png`) });
    }
    await ctx.close();
  }

  return { testRtsNeutral };
};
