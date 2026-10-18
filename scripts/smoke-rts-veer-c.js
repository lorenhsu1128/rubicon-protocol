// Coral 戰爭（RTS）R4 C 包（維爾威的英雄與道具，docs/rts-design.md 15.4、15.13）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-veer-c')(H)。
// testRtsVeerHero：三位英雄（COURIER／SKYHOOK／VECTOR）12 個技能的 Coral、冷卻、效果（急件突進的路線傷害、補給投放、
//   時間就是錢、特快專送（載走 16 人口、落地加傷、被擊落時乘員 50%）、強襲空投艙與臨時信標、緊急增援的臨時單位、
//   空域管制、地毯轟炸（不打空中）、空爆彈幕（空中 100%／地面 50%）、干擾吊艙（單位與建築）、滑流、無人機中隊）；
//   4 種專屬道具（熱焰彈、推進背包上高台、攜帶式信標讓投放落在那裡、運費帳簿 15%）；物流倉庫的貨架依層級、收起時不能買、
//   其他商店沒有專屬道具；截圖 rts-r4-hero.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，以 rtsSim＋rtsFogTick 快轉。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsVeerHero(browser, base) {
    console.log('Coral 戰爭：維爾威的英雄（COURIER／SKYHOOK／VECTOR）與專屬道具');
    const { ctx, page } = await newPage(browser, 'rtsVeerHero');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);

    // ---------- 開局＋工具 ----------
    const st = await ev(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsCampsOff = true;
      g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷（負載高時同一個種子的結果才會相同）
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'veerwell',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          g.rtsFogTick(dt);
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
        const e = g.rtsSpawn(team, def, p.x, p.z, 0);
        if (e) e.orders = [{ k: 'hold' }];
        return e;
      };
      window.__kill = (...L) => {
        for (const u of L.flat()) if (u && !u.dead) ((u.rtsQuiet = true), u.die(null));
      };
      window.__hero = (def, x, z, sk = [1, 1, 1, 1], lv = 1) => {
        const p = window.__at(x, z);
        const rec = g.rtsHeroRec(0, def);
        let e = rec && rec.ent && !rec.ent.dead ? rec.ent : null;
        if (e) g.rtsHeroShift(e, p.x, p.z);
        else {
          e = g.rtsSpawn(0, def, p.x, p.z, 0);
          g.rtsHeroSpawned(e, {});
        }
        e.hero.lv = lv;
        e.hero.sk = sk.slice();
        e.hero.cd = [0, 0, 0, 0];
        g.rtsHeroApply(e);
        e.hp = e.maxHp;
        e.orders = [{ k: 'hold' }];
        return e;
      };
      window.__bld = (team, def, x, z, r0 = 0) => {
        const D = g.rtsUiDef(def);
        for (let r = r0; r <= 50; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (g.world.nav.buildable(px, pz, D.foot[0] + 2, D.foot[1] + 2))
              return g.rtsSpawnBld(team, def, px, pz, 0, 1);
            if (r === 0) break;
          }
        return null;
      };
      // 傷害的紀錄（rtsHit 的原始傷害）
      window.__spy = null;
      const hit = g.rtsHit.bind(g);
      g.rtsHit = (t, dmg, imp, src, atk, at) => {
        if (window.__spy) window.__spy.push({ id: t.id, d: dmg, atk, bld: !!t.bld, src: src && src.id });
        return hit(t, dmg, imp, src, atk, at);
      };
      R.teams[0].ore = R.teams[1].ore = 50000;
      R.teams[0].coral = R.teams[1].coral = 50000;
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.bld && e.rtsDef === 'v_hq');
      window.__hq = hq;
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      window.__field = { x: hq.pos.x - (hq.pos.x / L) * 45, z: hq.pos.z - (hq.pos.z / L) * 45 };
      window.__sim(1);
      return {
        why: [g.rtsHeroWhy(0, 'h_courier'), g.rtsHeroWhy(0, 'h_bastion'), g.rtsHeroWhy(1, 'h_vector')],
        skills: ['h_courier', 'h_skyhook', 'h_vector'].map((id) =>
          g
            .rtsUiDef(id)
            .card.filter((c) => c.act.k === 'ability')
            .map((c) => c.key + ':' + c.name)
            .join(' '),
        ),
        q: g.rtsHeroQueue(hq, 'h_courier'),
      };
    });
    check(
      st.why[0] === '' && /陣營/.test(st.why[1]) && /陣營/.test(st.why[2]),
      `維爾威的英雄只給維爾威（${st.why.map((w) => w || '可以').join('／')}）`,
    );
    check(
      st.skills[0] === 'Z:急件突進 X:補給投放 C:時間就是錢 V:特快專送' &&
        st.skills[1] === 'Z:強襲空投艙 X:緊急增援 C:空域管制 V:地毯轟炸' &&
        st.skills[2] === 'Z:空爆彈幕 X:干擾吊艙 C:滑流 V:無人機中隊',
      `三位英雄的技能卡（${st.skills.join('｜')}）`,
    );
    const got = await ev(() => {
      const g = window.__game;
      const t = window.__sim(70, () => g.rtsHeroState(0, 'h_courier') === 'alive');
      const e = g.rtsHeroRec(0, 'h_courier').ent;
      return { t, hp: e.maxHp, armor: e.rtsArmor, sp: e.speedMul * e.stats.speed };
    });
    check(
      st.q && got.t > 50 && got.t < 60 && got.hp === 1250 && got.armor === 2,
      `調度中心生產 COURIER（${got.t.toFixed(1)} 秒、血量 ${got.hp}、護甲 ${got.armor}、速度 ${got.sp.toFixed(1)}）`,
    );

    // ---------- COURIER ----------
    const co = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      const h = window.__hero('h_courier', F.x, F.z, [1, 1, 1, 1]);
      window.__cour = h;
      // 急件突進：路線上 2 台、旁邊 1 台
      const on = [8, 15].map((d) => window.__mk(1, 'c_mt', h.pos.x + d, h.pos.z));
      const off = window.__mk(1, 'c_mt', h.pos.x + 10, h.pos.z + 8);
      const x0 = h.pos.x,
        z0 = h.pos.z;
      const c0 = T.coral;
      window.__spy = [];
      o.ok = g.rtsSkillCast(h, 0, { x: h.pos.x + 20, z: h.pos.z });
      o.coral = c0 - T.coral;
      o.cd = Math.round(h.hero.cd[0] - R.t);
      o.busy = g.rtsSkillWhy(h, 1);
      o.bt = window.__sim(1, () => !h.hs.blitz);
      const sp = window.__spy.filter((s) => s.src === h.id);
      o.on = on.map((u) => ((sp.find((s) => s.id === u.id) || {}).d || 0) / h.dmgMul);
      o.off = sp.some((s) => s.id === off.id);
      o.atk = sp.length ? sp[0].atk : '';
      o.moved = Math.hypot(h.pos.x - x0, h.pos.z - z0);
      window.__spy = null;
      window.__kill(on, off);
      // 時間就是錢：維爾威的單位速度＋射速、卡斯特隆的單位只有速度
      const vm = window.__mk(0, 'v_mt', h.pos.x + 4, h.pos.z + 3);
      const cm = window.__mk(0, 'c_mt', h.pos.x - 4, h.pos.z + 3);
      window.__sim(0.6);
      o.tempo = [vm.rtsM.speed, vm.rtsM.rof, cm.rtsM.speed, cm.rtsM.rof].map(
        (v) => Math.round(v * 100) / 100,
      );
      // 補給投放：1.5 秒後 5 秒共回復 150
      vm.hp = vm.maxHp * 0.4;
      const hp0 = vm.hp,
        rg0 = vm.rtsRegen || 0; // 其他的回復（扣掉）
      const c1 = T.coral;
      o.drop = g.rtsSkillCast(h, 1, { x: vm.pos.x, z: vm.pos.z });
      o.dCoral = c1 - T.coral;
      o.dCd = Math.round(h.hero.cd[1] - R.t);
      window.__sim(1.3);
      o.dEarly = Math.round(vm.hp - hp0);
      window.__sim(5.6);
      o.dHeal = Math.round(vm.hp - hp0 - rg0 * 6.9);
      window.__kill(vm, cm);
      return o;
    });
    check(
      co.ok && co.coral === 15 && co.cd === 10 && co.busy === '施放中' && co.bt > 0.3 && co.bt < 0.6,
      `急件突進：Coral ${co.coral}、冷卻 ${co.cd}、${co.bt.toFixed(2)} 秒衝完（衝刺中：${co.busy}）`,
    );
    check(
      co.on.every((d) => Math.abs(d - 77) < 1) /* R6 平衡：70 → 77 */ &&
        !co.off &&
        co.atk === 'kin' &&
        co.moved > 17,
      `急件突進：路線上 ${co.on.map((d) => d.toFixed(0)).join('／')} 實彈、旁邊的沒打到、移動 ${co.moved.toFixed(1)} m`,
    );
    check(
      co.tempo.join() === '1.06,1.04,1.06,1',
      `時間就是錢：空降 MT 速度 ×${co.tempo[0]}、射速 ×${co.tempo[1]}；卡斯特隆的 MT 速度 ×${co.tempo[2]}、射速 ×${co.tempo[3]}`,
    );
    check(
      co.drop && co.dCoral === 20 && co.dCd === 18 && co.dEarly === 0 && co.dHeal >= 148 && co.dHeal <= 166, // buff 每 0.5 秒才清（最多多 0.5 秒）
      `補給投放：Coral ${co.dCoral}、冷卻 ${co.dCd}、落地前 +${co.dEarly}、5 秒共回復 ${co.dHeal}`,
    );

    // ---------- 特快專送 ----------
    const ex = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      const h = window.__hero('h_courier', F.x, F.z, [1, 1, 1, 1], 6);
      // 6 台空降 MT（人口 2）：英雄 5＋5 台＝15，第 6 台放不下（16）
      const mts = [0, 1, 2, 3, 4, 5].map((i) =>
        window.__mk(0, 'v_mt', h.pos.x + Math.cos(i) * (3 + i), h.pos.z + Math.sin(i) * (3 + i)),
      );
      const far = window.__mk(0, 'v_mt', h.pos.x + 20, h.pos.z + 6); // 12 m 外
      const dst = window.__at(window.__hq.pos.x + 30, window.__hq.pos.z + 10);
      o.fogNo = g.rtsSkillWhy(h, 3);
      h.rtsPiloted = true;
      o.pilotWhy = g.rtsSkillWhy(h, 3);
      h.rtsPiloted = false;
      const c0 = T.coral;
      o.ok = g.rtsSkillCast(h, 3, dst);
      o.coral = c0 - T.coral;
      o.cd = Math.round(h.hero.cd[3] - R.t);
      const q = R.hfx.express[0];
      o.shipHp = q ? Math.round(q.ship.maxHp) : 0;
      window.__sim(1.5);
      o.pre = !h.rtsAboard;
      o.lowPick = q && g.rtsLowAir(q.ship);
      window.__sim(0.7);
      o.aboard = !!h.rtsAboard;
      o.pop = q.pop;
      o.n = (q.ship.cargo || []).length;
      o.left = mts.filter((u) => !u.rtsAboard).length;
      o.farLeft = !far.rtsAboard;
      o.fly = g.rtsLowAir(q.ship);
      const d = Math.hypot(dst.x - q.ship.pos.x, dst.z - q.ship.pos.z);
      o.dist = d;
      const tf = window.__sim(12, () => q.st === 'land');
      o.flyT = tf;
      o.landLow = g.rtsLowAir(q.ship);
      window.__sim(1.7);
      o.down = !h.rtsAboard;
      o.atDst = Math.hypot(h.pos.x - dst.x, h.pos.z - dst.z);
      o.mtDst = Math.max(
        ...mts
          .filter((u) => !u.dead && q.ids.includes(u.id))
          .map((u) => Math.hypot(u.pos.x - dst.x, u.pos.z - dst.z)),
      );
      o.buffT = Math.round(((h.rtsMods.buff.find((b) => b.src === 'sk_express') || {}).t || 0) - R.t);
      window.__sim(2);
      o.gone = q.ship.dead && !R.hfx.express.length;
      // 被擊落：乘員彈出、各受最大血量 50%
      h.hero.cd[3] = 0;
      h.hp = h.maxHp;
      g.rtsHeroShift(h, F.x, F.z);
      o.ok2 = g.rtsSkillCast(h, 3, dst);
      const q2 = R.hfx.express[0];
      window.__sim(2.2);
      window.__sim(0.5);
      o.aboard2 = !!h.rtsAboard;
      g.rtsHit(q2.ship, 99999, 0, null, 'none');
      window.__sim(0.1);
      o.crash = !h.rtsAboard && !h.dead;
      o.crashHp = Math.round((h.hp / h.maxHp) * 100);
      window.__kill(mts, far);
      return o;
    });
    check(
      ex.ok &&
        ex.coral === 75 &&
        ex.cd === 120 &&
        ex.shipHp === 1200 &&
        ex.pre &&
        ex.lowPick &&
        /駕駛/.test(ex.pilotWhy),
      `特快專送：Coral ${ex.coral}、冷卻 ${ex.cd}、運輸機血量 ${ex.shipHp}、2 秒前下降中是低空、親自駕駛中不能（${ex.pilotWhy}）`,
    );
    check(
      ex.aboard && ex.pop === 15 && ex.n === 6 && ex.left === 1 && ex.farLeft && !ex.fly,
      `特快專送：載走英雄＋5 台（人口 ${ex.pop}／16、${ex.n} 台）、放不下 ${ex.left} 台、12 m 外的不載、飛行中不是低空`,
    );
    check(
      ex.flyT > 0 && Math.abs(ex.flyT - ex.dist / 40) < 0.5 && ex.landLow,
      `特快專送：${ex.dist.toFixed(0)} m 飛 ${ex.flyT.toFixed(2)} 秒（40 m/s）、下降時是低空`,
    );
    check(
      ex.down && ex.atDst < 4 && ex.mtDst < 12 && ex.buffT >= 6 && ex.gone,
      `特快專送：卸在目的地（英雄 ${ex.atDst.toFixed(1)} m、MT 最遠 ${ex.mtDst.toFixed(1)} m）、傷害 +20% ${ex.buffT} 秒、運輸機離開`,
    );
    check(
      ex.ok2 && ex.aboard2 && ex.crash && Math.abs(ex.crashHp - 50) <= 2,
      `特快專送被擊落：乘員彈出、英雄剩 ${ex.crashHp}% 血量`,
    );

    // ---------- SKYHOOK ----------
    const sk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      g.rtsHeroShift(window.__cour, window.__hq.pos.x, window.__hq.pos.z); // 光環不要影響
      const h = window.__hero('h_skyhook', F.x - 6, F.z + 8, [1, 1, 1, 1], 6);
      window.__sky = h;
      // 強襲空投艙
      const px = h.pos.x + 20,
        pz = h.pos.z;
      const foes = [0, 1, 2].map((i) => window.__mk(1, 'c_mt', px + (i - 1) * 2, pz + (i % 2)));
      const c0 = T.coral;
      window.__spy = [];
      o.pod = g.rtsSkillCast(h, 0, { x: px, z: pz });
      o.pCoral = c0 - T.coral;
      o.pCd = Math.round(h.hero.cd[0] - R.t);
      window.__sim(1.1);
      o.pEarly = window.__spy.length;
      window.__sim(0.25);
      const sp = window.__spy.filter((s) => s.src === h.id);
      o.pMax = Math.max(0, ...sp.map((s) => s.d / h.dmgMul));
      o.pN = new Set(sp.map((s) => s.id)).size;
      o.pAtk = sp.length ? sp[0].atk : '';
      o.stun = foes.filter((u) => u.staggerT > 0.5).length;
      o.bcn = g.rtsBeacons(0).filter((b) => b.temp && Math.hypot(b.x - px, b.z - pz) < 1).length;
      window.__spy = null;
      window.__kill(foes);
      window.__sim(20);
      o.bcnEnd = g.rtsBeacons(0).filter((b) => b.temp && Math.hypot(b.x - px, b.z - pz) < 1).length;
      // 緊急增援：2 秒後 2 台空降 MT（不佔人口、擊破不算）、40 秒後消失
      g.rtsRecount();
      const pop0 = T.pop;
      const n0 = window.__of(0, 'v_mt').length;
      const c1 = T.coral;
      o.rein = g.rtsSkillCast(h, 1);
      o.rCoral = c1 - T.coral;
      o.rCd = Math.round(h.hero.cd[1] - R.t);
      window.__sim(1.8);
      o.rEarly = window.__of(0, 'v_mt').length - n0;
      window.__sim(0.4);
      const temps = window.__of(0, 'v_mt').filter((u) => u.rtsTemp);
      o.rN = temps.length;
      g.rtsRecount();
      o.rPop = T.pop - pop0;
      o.rQuiet = temps.every((u) => u.rtsQuiet && u.rtsNoPop);
      o.rT = window.__sim(41, () => window.__of(0, 'v_mt').filter((u) => u.rtsTemp).length === 0);
      // 空域管制：空中單位傷害 ×1.08、射程 +2；地面的不受影響
      const dr = window.__mk(0, 'v_drone', h.pos.x + 4, h.pos.z + 2);
      const gm = window.__mk(0, 'v_mt', h.pos.x - 4, h.pos.z + 2);
      window.__sim(0.6);
      o.air = [
        Math.round(dr.rtsM.dmg * 100) / 100,
        dr.rtsRangeAdd,
        Math.round(gm.rtsM.dmg * 100) / 100,
        gm.rtsRangeAdd,
      ];
      window.__kill(dr, gm);
      // 地毯轟炸：沿線的地面單位受傷，空中的不受影響
      const line = [10, 25, 40, 55].map((d) => window.__mk(1, 'c_mt', h.pos.x + 4 + d, h.pos.z));
      const heli = window.__mk(1, 'c_heli', h.pos.x + 30, h.pos.z);
      const c2 = T.coral;
      window.__spy = [];
      o.carpet = g.rtsSkillCast(h, 3, { x: h.pos.x + 30, z: h.pos.z });
      o.cCoral = c2 - T.coral;
      o.cCd = Math.round(h.hero.cd[3] - R.t);
      window.__sim(1.9);
      o.cEarly = window.__spy.length;
      window.__sim(2);
      const cs = window.__spy.filter((s) => s.src === h.id);
      o.cHit = line.filter((u) => cs.some((s) => s.id === u.id)).length;
      o.cMax = Math.max(0, ...cs.map((s) => s.d / h.dmgMul));
      o.cHeli = cs.some((s) => s.id === heli.id);
      o.cN = cs.length;
      window.__spy = null;
      window.__kill(line, heli);
      return o;
    });
    check(
      sk.pod && sk.pCoral === 20 && sk.pCd === 12 && sk.pEarly === 0,
      `強襲空投艙：Coral ${sk.pCoral}、冷卻 ${sk.pCd}、預警中沒有傷害`,
    );
    check(
      Math.abs(sk.pMax - 100) < 1 &&
        sk.pN === 3 &&
        sk.pAtk === 'exp' &&
        sk.stun === 3 &&
        sk.bcn === 1 &&
        sk.bcnEnd === 0,
      `強襲空投艙：${sk.pN} 台受傷（最大 ${sk.pMax.toFixed(0)} 爆發）、暈眩 ${sk.stun} 台、臨時信標 ${sk.bcn} → 20 秒後 ${sk.bcnEnd}`,
    );
    check(
      sk.rein &&
        sk.rCoral === 25 &&
        sk.rCd === 24 &&
        sk.rEarly === 0 &&
        sk.rN === 2 &&
        sk.rPop === 0 &&
        sk.rQuiet &&
        sk.rT > 38 &&
        sk.rT < 41,
      `緊急增援：Coral ${sk.rCoral}、冷卻 ${sk.rCd}、2 秒後 ${sk.rN} 台空降 MT、人口 +${sk.rPop}、${sk.rT.toFixed(1)} 秒後消失`,
    );
    check(
      sk.air.join() === '1.08,2,1,0',
      `空域管制：偵察無人機傷害 ×${sk.air[0]}、射程 +${sk.air[1]}；空降 MT ×${sk.air[2]}、+${sk.air[3]}`,
    );
    check(
      sk.carpet &&
        sk.cCoral === 90 &&
        sk.cCd === 140 &&
        sk.cEarly === 0 &&
        sk.cHit === 4 &&
        !sk.cHeli &&
        sk.cMax <= 120.5,
      `地毯轟炸：Coral ${sk.cCoral}、冷卻 ${sk.cCd}、沿線 ${sk.cHit}／4 台受傷（${sk.cN} 次、最大 ${sk.cMax.toFixed(0)}）、直升機沒有`,
    );

    // ---------- VECTOR ----------
    const ve = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      g.rtsHeroShift(window.__sky, window.__hq.pos.x, window.__hq.pos.z);
      const h = window.__hero('h_vector', F.x + 8, F.z - 8, [1, 1, 0, 1], 6);
      window.__vec = h;
      // 滑流：速度 ×1.05、穿甲 −10%
      const sp0 = h.speedMul;
      const loss = () => {
        let s = 0;
        for (let i = 0; i < 20; i++) {
          h.hp = h.maxHp;
          g.rtsHit(h, 50, 0, null, 'pierce');
          s += h.maxHp - h.hp;
        }
        h.hp = h.maxHp;
        return s;
      };
      const a = loss();
      h.hero.sk[2] = 1;
      g.rtsHeroApply(h);
      const b = loss();
      o.slip = [Math.round((h.speedMul / sp0) * 100) / 100, Math.round((b / a) * 100) / 100];
      // 空爆彈幕：空中 100%、地面 50%
      const px = h.pos.x + 22,
        pz = h.pos.z;
      const heli = window.__mk(1, 'c_heli', px + 2, pz);
      const mt = window.__mk(1, 'c_mt', px - 2, pz);
      const c0 = T.coral;
      window.__spy = [];
      o.flak = g.rtsSkillCast(h, 0, { x: px, z: pz });
      o.fCoral = c0 - T.coral;
      o.fCd = Math.round(h.hero.cd[0] - R.t);
      window.__sim(0.4);
      o.fEarly = window.__spy.length;
      window.__sim(0.3);
      const fs = window.__spy.filter((s) => s.src === h.id);
      o.fAir = ((fs.find((s) => s.id === heli.id) || {}).d || 0) / h.dmgMul;
      o.fGnd = ((fs.find((s) => s.id === mt.id) || {}).d || 0) / h.dmgMul;
      o.fAtk = fs.length ? fs[0].atk : '';
      window.__spy = null;
      window.__kill(heli, mt);
      // 干擾吊艙：單位射程 −40%、技能不能施放；建築暫停
      const sh = window.__mk(1, 'c_shield', h.pos.x + 14, h.pos.z + 4);
      window.__sim(0.3);
      const r0 = sh.rtsRangeAdd || 0;
      const c1 = T.coral;
      o.jam = g.rtsSkillCast(h, 1, sh);
      o.jCoral = c1 - T.coral;
      o.jCd = Math.round(h.hero.cd[1] - R.t);
      o.jRange = Math.round(((sh.rtsRangeAdd || 0) - r0) * 10) / 10;
      o.jRangeDef = g.rtsUiDef('c_shield').range;
      o.jAb = (sh.rtsCd && sh.rtsCd.ab_wall) > R.t + 5; // 技能的冷卻＝干擾的期間
      o.jT = Math.round(sh.rtsJamT - R.t);
      const hq1 = R.units.find((e) => e.rtsTeam === 1 && e.bld && e.rtsDef === 'c_hq');
      h.hero.cd[1] = 0;
      o.jamB = g.rtsSkillCast(h, 1, hq1);
      o.jB = Math.round(hq1.bld.empT - R.t);
      o.jOff = g.rtsBldOff(hq1);
      hq1.bld.empT = 0;
      window.__sim(6.2);
      o.jEnd = Math.round(((sh.rtsRangeAdd || 0) - r0) * 10) / 10;
      o.jAb2 = (sh.rtsCd && sh.rtsCd.ab_wall) > R.t;
      // 英雄被干擾：不能施放
      h.rtsJamT = R.t + 2;
      h.hero.cd[0] = 0;
      o.jHero = g.rtsSkillWhy(h, 0);
      h.rtsJamT = 0;
      window.__kill(sh);
      // 無人機中隊：8 台偵察無人機（臨時、不佔人口），跟著 VECTOR 攻擊它的目標
      g.rtsRecount();
      const pop0 = T.pop;
      const c2 = T.coral;
      o.sq = g.rtsSkillCast(h, 3);
      o.sCoral = c2 - T.coral;
      o.sCd = Math.round(h.hero.cd[3] - R.t);
      const dr = window.__of(0, 'v_drone').filter((u) => u.rtsLead === h);
      o.sN = dr.length;
      o.sFly = dr.every((u) => u.flying && u.pos.y - g.world.terrainHeight(u.pos.x, u.pos.z) > 3);
      g.rtsRecount();
      o.sPop = T.pop - pop0;
      const foe = window.__mk(1, 'c_mt', h.pos.x + 25, h.pos.z - 4);
      h.rt.engage = foe;
      window.__sim(0.6);
      o.sAtk = dr.filter(
        (u) => u.orders[0] && u.orders[0].k === 'attack' && u.orders[0].id === foe.id,
      ).length;
      window.__kill(foe);
      h.rt.engage = null;
      o.sT = window.__sim(31, () => window.__of(0, 'v_drone').filter((u) => u.rtsLead === h).length === 0);
      return o;
    });
    check(ve.slip.join() === '1.05,0.9', `滑流：速度 ×${ve.slip[0]}、受到的穿甲傷害 ×${ve.slip[1]}`);
    check(
      ve.flak &&
        ve.fCoral === 15 &&
        ve.fCd === 12 &&
        ve.fEarly === 0 &&
        Math.abs(ve.fAir - 120) < 1 &&
        Math.abs(ve.fGnd - 60) < 1 &&
        ve.fAtk === 'pierce',
      `空爆彈幕：Coral ${ve.fCoral}、冷卻 ${ve.fCd}、直升機 ${ve.fAir.toFixed(0)}、地面 ${ve.fGnd.toFixed(0)}（穿甲）`,
    );
    check(
      ve.jam &&
        ve.jCoral === 20 &&
        ve.jCd === 16 &&
        Math.abs(ve.jRange + ve.jRangeDef * 0.4) < 0.2 &&
        ve.jAb &&
        ve.jT === 6 &&
        ve.jEnd === 0 &&
        !ve.jAb2 &&
        /干擾/.test(ve.jHero),
      `干擾吊艙：射程 ${ve.jRange}（定義 ${ve.jRangeDef}）、技能不能施放 ${ve.jT} 秒（之後 ${ve.jAb2 ? '還不行' : '可以'}）；英雄：${ve.jHero}`,
    );
    check(ve.jamB && ve.jB === 4 && ve.jOff, `干擾吊艙：敵方主堡的生產與研究暫停 ${ve.jB} 秒`);
    check(
      ve.sq &&
        ve.sCoral === 100 &&
        ve.sCd === 160 &&
        ve.sN === 8 &&
        ve.sFly &&
        ve.sPop === 0 &&
        ve.sAtk === 8 &&
        ve.sT > 29 &&
        ve.sT < 31,
      `無人機中隊：Coral ${ve.sCoral}、${ve.sN} 台在空中、人口 +${ve.sPop}、${ve.sAtk} 台跟著攻擊目標、${ve.sT.toFixed(1)} 秒後消失`,
    );

    // ---------- 物流倉庫與專屬道具 ----------
    const it = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      const RD = (id) => g.rtsUiDef(id);
      const mD = RD('v_market');
      o.shelf = (mD.shopItems || []).join();
      o.card = (mD.card || []).map((c) => c.key + (c.req ? c.req.tier : '')).join('');
      const vf = /i_flare|i_jetpack|i_beacon2|i_ledger/;
      o.other =
        (RD('c_market').shopItems || []).some((id) => vf.test(id)) ||
        (RD('a_vault').shopItems || []).some((id) => vf.test(id)) ||
        (RD('n_shop') ? RD('n_shop').card || [] : []).some((c) => vf.test(c.act && c.act.item));
      const m = window.__bld(0, 'v_market', window.__hq.pos.x, window.__hq.pos.z, 16);
      const h = window.__cour;
      g.rtsHeroShift(h, m.pos.x + 9, m.pos.z);
      h.hero.inv = new Array(6).fill(null);
      h.hero.cd = [0, 0, 0, 0];
      g.rtsHeroApply(h);
      g.rtsRecount();
      o.t1 = g.rtsBuyList(m, 0).length;
      o.t1why = g.rtsBuyWhy(h, 'i_ledger');
      g.rtsChangeDef(window.__hq, 'v_hq2');
      g.rtsRecount();
      o.t2 = g.rtsBuyList(m, 0).length;
      g.rtsChangeDef(window.__hq, 'v_hq3');
      g.rtsRecount();
      o.t3 = g.rtsBuyList(m, 0).length;
      const ore0 = T.ore,
        c0 = T.coral;
      for (const id of ['i_flare', 'i_jetpack', 'i_beacon2', 'i_ledger']) o['b_' + id] = g.rtsBuyAct(h, id);
      o.paid = [Math.round(ore0 - T.ore), Math.round(c0 - T.coral)];
      // 收起中不能買
      o.packWhy = g.rtsPackWhy ? g.rtsPackWhy(m) : '?';
      o.pack = g.rtsPack ? g.rtsPack(m) : false;
      o.offWhy = g.rtsBuyWhy(h, 'i_kit');
      o.offWhy2 = g.rtsBuyWhy(m, 'i_kit');
      o.offBuy = g.rtsBuyAct(h, 'i_kit');
      const slot = (id) => h.hero.inv.findIndex((s) => s && s.id === id);
      // 熱焰彈：4 秒不能被鎖定
      g.rtsHeroShift(h, F.x, F.z);
      const spot = window.__mk(1, 'c_mt', h.pos.x + 12, h.pos.z); // 對手看得到（不然迷霧也會設 noLock）
      spot.dmgMul = 0;
      window.__sim(0.5);
      o.flPre = h.noLock;
      o.flare = g.rtsItemUse(h, slot('i_flare'));
      o.fl0 = h.noLock;
      window.__sim(3.5);
      o.fl1 = h.noLock;
      window.__sim(1);
      o.fl2 = h.noLock;
      window.__kill(spot);
      o.flCh = (h.hero.inv[slot('i_flare')] || {}).ch;
      // 推進背包：跳上高台（附近有高 4 m 以上、20 m 內可以站的地方）
      const w = g.world,
        nav = w.nav;
      let lo = null,
        hi = null;
      for (let gx = -150; gx <= 150 && !hi; gx += 6)
        for (let gz = -150; gz <= 150 && !hi; gz += 6) {
          const c = nav.nearestCell(gx, gz, 1, -1, 1);
          if (c < 0) continue;
          const p = nav.center(c);
          const h0 = w.terrainHeight(p.x, p.z);
          for (let a = 0; a < 16 && !hi; a++) {
            const qx = p.x + Math.cos((a / 16) * Math.PI * 2) * 14,
              qz = p.z + Math.sin((a / 16) * Math.PI * 2) * 14;
            const c2 = nav.nearestCell(qx, qz, 1, -1, 1);
            if (c2 < 0) continue;
            const q = nav.center(c2);
            if (w.terrainHeight(q.x, q.z) - h0 > 4 && Math.hypot(q.x - p.x, q.z - p.z) < 18) {
              lo = p;
              hi = q;
            }
          }
        }
      o.plat = !!hi;
      if (hi) {
        g.rtsHeroShift(h, lo.x, lo.z);
        const y0 = h.pos.y;
        o.far = g.rtsItemUse(h, slot('i_jetpack'), { x: h.pos.x + 40, z: h.pos.z });
        o.jet = g.rtsItemUse(h, slot('i_jetpack'), { x: hi.x, z: hi.z });
        window.__sim(1.2);
        o.jetUp = h.pos.y - y0;
        o.jetD = Math.hypot(h.pos.x - hi.x, h.pos.z - hi.z);
      }
      // 攜帶式信標：15 m 內變成臨時投放信標，軌道調度所的集結點在那裡時投放艙落在集結點
      g.rtsHeroShift(h, F.x, F.z);
      const bp = window.__at(F.x + 10, F.z + 6);
      o.bcnFar = g.rtsItemUse(h, slot('i_beacon2'), { x: F.x + 40, z: F.z });
      const bay = window.__bld(0, 'v_bay', window.__hq.pos.x, window.__hq.pos.z, 20);
      bay.bld.rally = { x: bp.x, z: bp.z };
      o.via0 = g.rtsDropPoint(bay).via;
      o.bcn = g.rtsItemUse(h, slot('i_beacon2'), bp);
      o.via1 = g.rtsDropPoint(bay).via;
      window.__sim(61);
      o.via2 = g.rtsDropPoint(bay).via;
      // 運費帳簿：英雄擊破單位 → 隊伍 +15% 礦石成本；幻象與臨時單位不算
      const mt = window.__mk(1, 'c_mt', h.pos.x + 6, h.pos.z);
      const ore1 = T.ore;
      g.rtsHit(mt, 99999, 0, h, 'none');
      o.ledger = Math.round(T.ore - ore1);
      const mt2 = window.__mk(1, 'c_mt', h.pos.x + 6, h.pos.z);
      mt2.rtsTemp = R.t + 30;
      const ore2 = T.ore;
      g.rtsHit(mt2, 99999, 0, h, 'none');
      o.ledgerTemp = Math.round(T.ore - ore2);
      return o;
    });
    check(
      it.shelf ===
        'i_kit,i_scout,i_beacon,i_flare,i_jetpack,i_barrier,i_fcs,i_boost,i_beacon2,i_ledger,i_scope,i_antenna' &&
        it.card === 'QWERAS2D2F2Z2X2C3V3',
      `物流倉庫的貨架 12 格與卡片（${it.card}）`,
    );
    check(!it.other, `補給商店、樣本保管庫、中立商店沒有維爾威的專屬道具`);
    check(
      it.t1 === 5 && it.t2 === 10 && it.t3 === 12 && /T2/.test(it.t1why),
      `貨架依層級：${it.t1}／${it.t2}／${it.t3}（T1 時運費帳簿：${it.t1why}）`,
    );
    check(
      it.b_i_flare && it.b_i_jetpack && it.b_i_beacon2 && it.b_i_ledger && it.paid.join() === '330,95',
      `買 4 種專屬道具（礦石 ${it.paid[0]}、Coral ${it.paid[1]}）`,
    );
    check(
      it.pack && /收起/.test(it.offWhy) && /收起/.test(it.offWhy2) && !it.offBuy,
      `物流倉庫收起中不能買（${it.offWhy}／${it.offWhy2}；收起：${it.packWhy || '可以'}）`,
    );
    check(
      it.flare && !it.flPre && it.fl0 && it.fl1 && !it.fl2 && it.flCh === 1,
      `熱焰彈：4 秒不能被鎖定（${it.fl0}→${it.fl1}→${it.fl2}）、剩 ${it.flCh} 次`,
    );
    check(
      it.plat && !it.far && it.jet && it.jetUp > 3.5 && it.jetD < 3,
      `推進背包：20 m 外不能用、跳上高台（高 ${(it.jetUp || 0).toFixed(1)} m、離落點 ${(it.jetD || 0).toFixed(1)} m）`,
    );
    check(
      !it.bcnFar && it.via0 === 'bld' && it.bcn && it.via1 === 'beacon' && it.via2 === 'bld',
      `攜帶式信標：15 m 外不能用、投放點 ${it.via0} → ${it.via1} → 60 秒後 ${it.via2}`,
    );
    check(
      it.ledger === 20 && it.ledgerTemp === 0,
      `運費帳簿：擊破 MT +${it.ledger} 礦石、臨時單位 +${it.ledgerTemp}`,
    );

    // ---------- 截圖：地毯轟炸、強襲空投艙、空爆彈幕、無人機中隊、特快專送 ----------
    await ev(() => {
      const g = window.__game,
        F = window.__field;
      const co = window.__cour,
        sky = window.__sky,
        vec = window.__vec;
      g.rtsHeroShift(co, F.x - 4, F.z - 10);
      g.rtsHeroShift(sky, F.x, F.z);
      g.rtsHeroShift(vec, F.x + 6, F.z + 8);
      for (const h of [co, sky, vec]) {
        h.hero.cd = [0, 0, 0, 0];
        h.hero.sk = [1, 1, 1, 1];
        h.hero.lv = 6;
        h.orders = [{ k: 'hold' }];
      }
      const foes = [0, 1, 2, 3, 4].map((i) => window.__mk(1, 'c_mt', F.x + 20 + i * 5, F.z + (i % 2) * 3));
      const heli = window.__mk(1, 'c_heli', F.x + 22, F.z + 12);
      window.__shot = { foes, heli };
      g.rtsSkillCast(vec, 3);
      g.rtsSkillCast(co, 3, window.__at(F.x - 30, F.z - 20));
      g.rtsSkillCast(sky, 3, { x: F.x + 30, z: F.z + 1 });
      window.__sim(1.2);
      g.rtsSkillCast(sky, 0, { x: foes[1].pos.x, z: foes[1].pos.z });
      g.rtsSkillCast(vec, 0, { x: heli.pos.x, z: heli.pos.z });
      if (g.rtsCamJump) g.rtsCamJump(F.x + 10, F.z);
      window.__pump(1.0, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r4-hero.png') });
    await ctx.close();
  }

  return { testRtsVeerHero };
};
