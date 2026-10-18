// Coral 戰爭（RTS）R6 D 包（單位與中立的表現，docs/rts-design.md 17.2、17.7）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-r6-d')(H)。
// testRtsCreeps：6 種野怪的特殊行為（雪中潛伏 MT 的埋下與現身、煙幕投射車的煙幕、汙染噴射 MT 的腐蝕區、推進器試車台的
// 預警噴火、重力錨的重力場、保全雷射網的警報）與「出動到全滅的時間」和關掉行為時相比差 < 30%；防禦塔優先打攻擊建築的
// 單位；臨時牆（冰牆、貨櫃壁壘、貨櫃掩體）把單位推出去、佔地裡有建築時不放；技能與升級的音效（window.__sfx 記錄播放的
// id；看不到的位置不播）；結晶護壁的外殼；特快專送的運輸機動作；強襲空投艙與緊急增援的投放艙外觀；收好在飛的建築讓
// rtsFlyAlt 爬升。電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉。截圖 rts-r6-creeps.png、rts-r6-aegis.png。
/* global window, THREE */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsCreeps(browser, base) {
    console.log('Coral 戰爭：野怪的特殊行為、防禦塔、臨時牆、音效與外觀（R6 D 包）');
    const { ctx, page } = await newPage(browser, 'rtsCreeps');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    const shot = (name) => page.screenshot({ path: path.join(SHOT_DIR, name) });

    const st = await ev(() => {
      const g = window.__game;
      g.rtsAiOff = true;
      g.rtsCampsOff = true; // 營地照樣記錄、不生成；測試自己放營地
      g.rtsPathMs = Infinity;
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
      g.lodFrom = new THREE.Vector3(0, 0, 0);
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          if (g.rtsFogTick) g.rtsFogTick(dt);
          g.fx.update(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__at = (x, z, size = 1) => {
        const c = w.nav.nearestCell(x, z, size, -1, 16);
        return c >= 0 ? w.nav.center(c) : { x, z };
      };
      window.__mk = (team, def, x, z, yaw = 0) => {
        const p = window.__at(x, z);
        return g.rtsSpawn(team, def, p.x, p.z, yaw);
      };
      window.__kill = (list) => {
        for (const e of list)
          if (e && !e.dead) {
            e.rtsQuiet = true;
            e.die(null);
          }
        window.__sim(0.1);
      };
      // 平坦、開闊的地點（離 (cx, cz) 最近）
      window.__spot = (cx, cz, W = 50, tol = 1.2) => {
        for (let r = 0; r < 160; r += 6)
          for (let a = 0; a < Math.PI * 2; a += r ? 6 / r : 7) {
            const x = cx + Math.cos(a) * r,
              z = cz + Math.sin(a) * r;
            if (!w.nav.buildable(x, z, W, W)) continue;
            let lo = 1e9,
              hi = -1e9;
            for (let i = -2; i <= 2; i++)
              for (let j = -2; j <= 2; j++) {
                const h = w.terrainHeight(x + (i * W) / 4, z + (j * W) / 4);
                lo = Math.min(lo, h);
                hi = Math.max(hi, h);
              }
            if (hi - lo < tol) return { x, z };
          }
        return null;
      };
      // 測試用的營地（編成 set、等級 tier）：同 rts-neutral.js 的開局（rtsCampSetup＋rtsCampSpawn）
      window.__camp = (set, x, z, tier = 2) => {
        const c = g.rtsCampSetup({ pos: { x, z }, tier }, 90 + R.camps.length, 'wasteland');
        c.set = set.slice();
        c.loot = { item: null, ore: 0, coral: 0 };
        R.camps.push(c);
        g.rtsCampSpawn(c);
        return c;
      };
      for (const T of R.teams) {
        T.ore = 50000;
        T.coral = 50000;
      }
      for (let i = 0; i < 6; i++) {
        const p = g.rtsAutoSpot(0, 'c_depot');
        if (p) g.rtsSpawnBld(0, 'c_depot', p.x, p.z, 0, 1);
      }
      const A = window.__spot(0, 0, 60) || window.__spot(0, 0, 44, 2.5);
      window.__A = A;
      return { A };
    });
    check(!!st.A, `測試場地（${st.A ? st.A.x.toFixed(0) + ', ' + st.A.z.toFixed(0) : '找不到'}）`);

    // ---------- 6 種野怪：行為與「出動到全滅的時間」 ----------
    // 每種：營地（2 台同種＋MT）、玩家 6 台 MT 守在營地中心 9 m 外（只打射程內）；行為開／關各跑一次（同一個亂數種子）
    const runs = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const SETS = {
        cr_lurker: ['cr_lurker', 'cr_lurker', 'cr_mt'],
        cr_smoker: ['cr_smoker', 'cr_smoker', 'cr_mt'],
        cr_sprayer: ['cr_sprayer', 'cr_sprayer', 'cr_mt'],
        cr_testrig: ['cr_testrig', 'cr_testrig', 'cr_mt'],
        cr_anchor: ['cr_anchor', 'cr_anchor', 'cr_mt'],
        cr_laserpost: ['cr_laserpost', 'cr_mt', 'cr_mt'],
      };
      const out = {};
      for (const id in SETS)
        for (const on of [true, false]) {
          window.__reseed(4242);
          g.rtsCreepFxOff = !on;
          const camp = window.__camp(SETS[id], A.x, A.z, 2);
          const o = { grav0: (R.creepGrav || []).length };
          const ents = [...camp.ents];
          const me = ents.find((e) => e.rtsDef === id);
          window.__sim(0.6);
          o.sub0 = !!me.rtsSub;
          o.hid0 = !!me.noLock && !!me.fogHid;
          o.bv0 = me.bossVis & 1;
          o.st0 = camp.st;
          const squad = [];
          for (let i = 0; i < 6; i++) {
            const a = Math.PI + (i - 2.5) * 0.28;
            const u = window.__mk(0, 'c_mt', A.x + Math.cos(a) * 9, A.z + Math.sin(a) * 9);
            u.maxHp = u.hp = 4000; // 不會被打倒（只量野怪的全滅時間）
            u.orders = [{ k: 'hold' }];
            squad.push(u);
          }
          let tF = -1,
            warn = 0,
            fire = 0,
            smoke = 0,
            nojump = 0,
            acid = 0,
            surf = -1;
          const t0 = R.t;
          for (let k = 0; k < 900 && !camp.cleared; k++) {
            window.__sim(0.1);
            if (tF < 0 && camp.st === 'fight') tF = R.t;
            if (surf < 0 && !me.rtsSub && o.sub0) surf = R.t - t0;
            for (const e of ents) {
              if (e.dead) continue;
              if (e.rtsDef === 'cr_testrig') {
                if ((e.bossVis & 3) === 1) warn++;
                if ((e.bossVis & 3) === 2) fire++;
              }
              if (e.rtcSmoke && e.noLock) smoke++;
            }
            for (const u of squad) if (u.hasStatus && u.hasStatus('nojump')) nojump++;
            if (R.hfx && R.hfx.zones.some((z) => z.src && z.src.rtsDef === 'cr_sprayer' && z.dps)) acid++;
          }
          o.clear = camp.cleared ? R.t - tF : -1;
          o.warn = warn;
          o.fire = fire;
          o.smoke = smoke;
          o.nojump = nojump;
          o.acid = acid;
          o.surf = surf;
          o.alarmT = camp.alarmT !== undefined ? camp.alarmT - t0 : -1;
          o.fightT = tF - t0;
          out[id + (on ? '' : '-off')] = o;
          window.__kill(squad);
          window.__kill([...camp.ents]);
          R.camps.splice(R.camps.indexOf(camp), 1);
          if (camp.marker && camp.marker.parent) camp.marker.parent.remove(camp.marker);
          window.__sim(1);
        }
      // 保全雷射網的警報：13 m 外（出動半徑 12 m 外）站著不動的單位
      for (const on of [true, false]) {
        g.rtsCreepFxOff = !on;
        const camp = window.__camp(['cr_laserpost', 'cr_mt', 'cr_mt'], A.x, A.z, 2);
        window.__sim(0.5);
        const ents = [...camp.ents];
        const lp = ents.find((e) => e.rtsDef === 'cr_laserpost');
        const dx = lp.pos.x - A.x,
          dz = lp.pos.z - A.z,
          L = Math.hypot(dx, dz) || 1;
        const u = window.__mk(0, 'c_mt', lp.pos.x + (dx / L) * 13, lp.pos.z + (dz / L) * 13);
        u.updateAI = () => true;
        u.pos.x = lp.pos.x + (dx / L) * 13;
        u.pos.z = lp.pos.z + (dz / L) * 13;
        R.hash.update(u, u.pos.x, u.pos.z);
        const t = window.__sim(2, () => camp.st === 'fight');
        out['alarm' + (on ? '' : '-off')] = {
          t,
          alarm: camp.alarmT !== undefined,
          d: Math.min(...ents.map((e) => Math.hypot(e.pos.x - u.pos.x, e.pos.z - u.pos.z))),
        };
        window.__kill([u, ...camp.ents]);
        R.camps.splice(R.camps.indexOf(camp), 1);
        window.__sim(1);
      }
      g.rtsCreepFxOff = false;
      return out;
    });
    if (process.env.RTS_D_DEBUG) console.log(JSON.stringify(runs));
    const NAME = {
      cr_lurker: '雪中潛伏 MT',
      cr_smoker: '煙幕投射車',
      cr_sprayer: '汙染噴射 MT',
      cr_testrig: '推進器試車台',
      cr_anchor: '重力錨',
      cr_laserpost: '保全雷射網',
    };
    const L = runs.cr_lurker;
    check(
      L.sub0 && L.hid0 && L.bv0 === 1 && L.surf > 0 && !runs['cr_lurker-off'].sub0,
      `雪中潛伏 MT：待機時埋著（潛航規則、不能鎖定、玩家看不到、模型蹲下），靠近 ${L.surf.toFixed(1)} 秒後現身；關掉時不埋`,
    );
    check(
      runs.cr_smoker.smoke > 0 && runs['cr_smoker-off'].smoke === 0,
      `煙幕投射車：出動時放煙幕，煙裡的野怪不能被鎖定（${runs.cr_smoker.smoke} 格次）`,
    );
    check(
      runs.cr_sprayer.acid > 0 && runs['cr_sprayer-off'].acid === 0,
      `汙染噴射 MT：腐蝕區（${(runs.cr_sprayer.acid / 10).toFixed(1)} 秒）`,
    );
    check(
      runs.cr_testrig.warn > 0 && runs.cr_testrig.fire > 0 && runs['cr_testrig-off'].fire === 0,
      `推進器試車台：預警 ${(runs.cr_testrig.warn / 10).toFixed(1)}、噴火 ${(runs.cr_testrig.fire / 10).toFixed(1)}（台·秒）`,
    );
    check(
      runs.cr_anchor.nojump > 0 && runs['cr_anchor-off'].nojump === 0,
      `重力錨：重力場讓玩家的單位不能跳躍（${runs.cr_anchor.nojump} 台·格）`,
    );
    const LP = runs.alarm,
      LO = runs['alarm-off'];
    check(
      LP.alarm && LP.t >= 0 && LP.t < 0.5 && LO.t < 0 && !LO.alarm && LP.d > 12,
      `保全雷射網：出動半徑外（最近 ${LP.d.toFixed(1)} m）的敵人觸發警報，${LP.t.toFixed(2)} 秒出動；沒有行為時不出動`,
    );
    const diffs = Object.keys(NAME).map((id) => {
      const a = runs[id].clear,
        b = runs[id + '-off'].clear;
      return { id, a, b, k: a > 0 && b > 0 ? Math.abs(a - b) / b : 9 };
    });
    check(
      diffs.every((d) => d.k < 0.3),
      '出動到全滅的時間（有行為／沒有）差 < 30%：' +
        diffs.map((d) => `${NAME[d.id]} ${d.a.toFixed(1)}／${d.b.toFixed(1)}`).join('、'),
    );

    // 截圖：試車台的預警與噴火、重力場、煙幕、腐蝕區
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      window.__reseed(77);
      const c1 = window.__camp(['cr_testrig', 'cr_anchor', 'cr_sprayer', 'cr_smoker'], A.x, A.z, 2);
      const sq = [];
      for (let i = 0; i < 5; i++) {
        const u = window.__mk(0, 'c_mt', A.x - 14 + i * 2, A.z - 6);
        u.maxHp = u.hp = 1e5;
        sq.push(u);
      }
      g.rtsOrder(sq, { k: 'amove', x: A.x, z: A.z });
      window.__sim(9);
      window.__shotCamp = c1;
      window.__shotSq = sq;
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z);
      if (g.rts.cam) g.rts.cam.dist = 46;
      window.__pump(0.3, null, 1 / 30);
    });
    await shot('rts-r6-creeps.png');
    await ev(() => {
      const g = window.__game;
      window.__kill(window.__shotSq);
      window.__kill([...window.__shotCamp.ents]);
      g.rts.camps.splice(g.rts.camps.indexOf(window.__shotCamp), 1);
      window.__sim(6);
    });

    // ---------- 炸藥礦車：衝向單位、點火預警、自爆的範圍傷害、自己死亡；被打死時小爆炸；關掉行為時不自爆（docs 18.4） ----------
    const cart = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        S = window.__sfx;
      const out = {};
      const warn0 = g.fx.warnCircle,
        play0 = S.play;
      let warns = [],
        bells = 0;
      g.fx.warnCircle = function (p, r) {
        warns.push(r);
        return warn0.apply(this, arguments);
      };
      S.play = function (k) {
        if (k === 'bell') bells++;
        return play0.apply(this, arguments);
      };
      const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      // 不動也不開火的小隊（擠在一起：量範圍傷害）＋一位英雄
      const squadAt = (cx, cz, hero) => {
        const sq = [];
        for (let i = 0; i < 3; i++) {
          const u = window.__mk(0, 'c_mt', cx + (i - 1) * 2.2, cz);
          u.updateAI = () => true;
          sq.push(u);
        }
        if (hero) {
          const h = g.rtsHeroSpawnAt(0, 'h_bastion', hq0, {});
          g.rtsHeroShift(h, cx, cz + 2.2);
          h.updateAI = () => true;
          sq.push(h);
        }
        return sq;
      };
      const run = (on) => {
        window.__reseed(919);
        g.rtsCreepFxOff = !on;
        warns = [];
        bells = 0;
        const camp = window.__camp(['cr_cart'], A.x, A.z, 2);
        const c = [...camp.ents][0];
        window.__sim(0.3);
        const sq = squadAt(A.x - 9.5, A.z, on);
        const hp0 = sq.map((u) => u.hp);
        const dist = () => Math.min(...sq.map((u) => Math.hypot(u.pos.x - c.pos.x, u.pos.z - c.pos.z)));
        const o = { d0: dist(), dFuse: -1, fuseAt: -1 };
        const t0 = R.t;
        for (let k = 0; k < 120 && !c.dead; k++) {
          window.__sim(0.05);
          if (o.fuseAt < 0 && c.rtc && c.rtc.ph === 1) {
            o.fuseAt = R.t - t0;
            o.dFuse = dist();
            o.fuseX = c.pos.x;
            o.fuseZ = c.pos.z;
          }
          if (
            o.fuseAt >= 0 &&
            c.rtc &&
            c.rtc.ph === 1 &&
            Math.hypot(c.pos.x - o.fuseX, c.pos.z - o.fuseZ) > 0.3
          )
            o.moved = true; // 點火中不動
        }
        if (!on) window.__sim(4); // 關掉時：多看幾秒，照近戰打、不自爆
        o.dead = c.dead;
        o.boom = c.rtcBoom || null;
        o.fuseLen = o.boom && c.rtc ? o.boom.t - c.rtc.fuseT : -1;
        o.dmg = sq.map((u, i) => Math.round(hp0[i] - u.hp));
        o.heroK = on ? (hp0[3] - sq[3].hp) / sq[3].maxHp : 0;
        o.warns = warns.slice();
        o.bells = bells;
        o.cleared = camp.cleared;
        o.clearedBy = camp.clearedBy;
        window.__kill(sq);
        window.__kill([...camp.ents]);
        R.camps.splice(R.camps.indexOf(camp), 1);
        window.__sim(0.5);
        return o;
      };
      out.on = run(true);
      out.off = run(false);
      g.rtsCreepFxOff = false;
      // 被打死（還沒點火）：小爆炸，旁邊的單位受一點傷害
      {
        window.__reseed(920);
        const camp = window.__camp(['cr_cart'], A.x, A.z, 2);
        const c = [...camp.ents][0];
        window.__sim(0.3);
        const u = window.__mk(0, 'c_mt', c.pos.x + 2, c.pos.z);
        u.updateAI = () => true;
        u.pos.x = c.pos.x + 2;
        u.pos.z = c.pos.z;
        R.hash.update(u, u.pos.x, u.pos.z);
        const h0 = u.hp;
        g.rtsHit(c, 1e5, 0, u, 'kin');
        out.shot = {
          dead: c.dead,
          boom: c.rtcBoom || null,
          dmg: Math.round(h0 - u.hp),
          cleared: camp.cleared,
          by: camp.clearedBy,
        };
        window.__kill([u]);
        R.camps.splice(R.camps.indexOf(camp), 1);
        window.__sim(0.5);
      }
      g.fx.warnCircle = warn0;
      S.play = play0;
      return out;
    });
    if (process.env.RTS_D_DEBUG) console.log(JSON.stringify(cart));
    const CO = cart.on;
    check(
      CO.fuseAt > 0 && CO.dFuse < CO.d0 - 3 && !CO.moved,
      `炸藥礦車：衝向單位（${CO.d0.toFixed(1)} → ${CO.dFuse.toFixed(1)} m，${CO.fuseAt.toFixed(1)} 秒）後停下點火`,
    );
    check(
      CO.warns.includes(4.5) && CO.bells >= 4 && CO.fuseLen > 1.1 && CO.fuseLen < 1.4,
      `炸藥礦車的預警：地面預警圈 4.5 m、嗶聲 ${CO.bells} 次、${CO.fuseLen.toFixed(2)} 秒後爆炸`,
    );
    check(
      CO.boom && CO.boom.full && CO.boom.n >= 3 && CO.dmg.filter((d) => d > 20).length >= 3 && CO.dead,
      `炸藥礦車自爆：範圍內 ${CO.boom ? CO.boom.n : 0} 個單位受傷（${CO.dmg.join('、')}），自己死亡`,
    );
    check(
      CO.heroK > 0 && CO.heroK < 0.15,
      `炸藥礦車不秒殺英雄（BASTION 失去 ${(CO.heroK * 100).toFixed(1)}% 血量）`,
    );
    check(
      CO.cleared && CO.clearedBy === 0,
      `自爆算給目標的隊伍：營地清除（擊破者 ${CO.clearedBy}，經驗與掉寶照一般野怪）`,
    );
    check(
      cart.shot.dead && cart.shot.boom && !cart.shot.boom.full && cart.shot.dmg > 0 && cart.shot.dmg < 80,
      `炸藥礦車被打爆：小爆炸（旁邊的 MT −${cart.shot.dmg}）`,
    );
    check(
      !cart.off.boom && cart.off.warns.length === 0,
      `關掉行為（g.rtsCreepFxOff）時不自爆、沒有預警（照近戰，小隊受傷 ${cart.off.dmg.join('、')}）`,
    );

    // ---------- 防禦塔：優先打攻擊建築的單位 ----------
    const tw = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const tower = g.rtsSpawnBld(1, 'c_tower', A.x, A.z, 0, 1);
      const dep = g.rtsSpawnBld(1, 'c_depot', A.x + 14, A.z, 0, 1);
      dep.maxHp = dep.hp = 1e6;
      const near = window.__mk(0, 'c_mt', A.x - 14, A.z);
      near.maxHp = near.hp = 1e6;
      near.updateAI = () => true; // 站著不動、不開火
      const far = window.__mk(0, 'c_mt', A.x + 34, A.z + 4);
      far.maxHp = far.hp = 1e6;
      far.updateAI = () => true;
      window.__sim(2);
      const o = { first: tower.rtw && tower.rtw.tgt === near };
      delete far.updateAI; // 開始打倉庫
      far.orders = [{ k: 'attack', id: dep.id }];
      o.t = window.__sim(8, () => tower.rtw && tower.rtw.tgt === far);
      o.hot = tower.rtsTowerHotK(far);
      // 不打建築了：3 秒後恢復一般的順序（近的優先）
      far.orders = [{ k: 'hold' }];
      far.updateAI = () => true;
      window.__sim(3.2);
      tower.rtw.tgt = null;
      o.back = window.__sim(8, () => tower.rtw && tower.rtw.tgt === near);
      window.__kill([tower, dep, near, far]);
      return o;
    });
    check(
      tw.first && tw.t > 0 && tw.hot === 30 && tw.back > 0,
      `防禦塔：先打近的，有單位打己方建築後 ${tw.t.toFixed(1)} 秒換過去（評分 −${tw.hot}），停手後回到近的`,
    );

    // ---------- 臨時牆：把佔地裡的單位推出去，有建築時不放 ----------
    const wl = await ev(() => {
      const g = window.__game,
        w = g.world,
        A = window.__A;
      const o = {};
      const inFoot = (u, x, z, W, D) =>
        Math.abs(u.pos.x - x) < W / 2 + 0.2 && Math.abs(u.pos.z - z) < D / 2 + 0.2;
      const test = (name, place, W, D) => {
        const x = A.x + o.n * 18 - 20,
          z = A.z + 20;
        o.n++;
        const us = [window.__mk(0, 'c_mt', x, z), window.__mk(0, 'c_mt', x + 1.5, z + 0.3)];
        for (const u of us) {
          u.pos.x = x + (u === us[1] ? 1.2 : 0);
          u.pos.z = z + (u === us[1] ? 0.3 : -0.2);
          g.rts.hash.update(u, u.pos.x, u.pos.z);
        }
        const ok = place(x, z);
        const inside = us.filter((u) => inFoot(u, x, z, W, D)).length;
        // 推出去之後還能走
        const p0 = us.map((u) => u.pos.clone());
        g.rtsOrder(us, { k: 'move', x: x + 12, z: z + 12 });
        window.__sim(3);
        const moved = us.map((u, i) => u.pos.distanceTo(p0[i]));
        o[name] = { ok, inside, moved: Math.min(...moved) };
        window.__kill(us);
      };
      o.n = 0;
      test(
        'ice',
        (x, z) => g.rtsHeroWall(x, z, { kind: 'ice', w: 6, h: 3.5, d: 1.4, yaw: 0, hp: 500, life: 14 }) >= 0,
        6,
        1.4,
      );
      test(
        'bulwark',
        (x, z) =>
          g.rtsHeroWall(x, z, { kind: 'rock', w: 6, h: 3, d: 1.5, yaw: Math.PI / 2, hp: 600, life: 20 }) >= 0,
        1.5,
        6,
      );
      const fk = window.__mk(0, 'c_forklift', A.x - 40, A.z + 40);
      test(
        'cover',
        (x, z) => {
          fk.pos.set(x, fk.pos.y, z - 9);
          return fk.rtsAbCover(x, z) !== false;
        },
        8,
        2.6,
      );
      // 建築在佔地裡：不放
      const dep = g.rtsSpawnBld(0, 'c_depot', A.x - 30, A.z - 30, 0, 1);
      const n0 = (g.tWalls || []).filter((q) => !q.dead).length;
      o.blocked = g.rtsHeroWall(dep.pos.x + 1, dep.pos.z, {
        kind: 'ice',
        w: 6,
        h: 3.5,
        d: 1.4,
        yaw: 0,
        hp: 500,
        life: 14,
      });
      o.blockedCover = fk.rtsAbCover(dep.pos.x, dep.pos.z + 1);
      o.n1 = (g.tWalls || []).filter((q) => !q.dead).length - n0;
      window.__kill([dep, fk]);
      void w;
      return o;
    });
    check(
      ['ice', 'bulwark', 'cover'].every((k) => wl[k].ok && wl[k].inside === 0 && wl[k].moved > 2),
      '臨時牆（冰牆、貨櫃壁壘、貨櫃掩體）把佔地裡的單位推到兩側、之後能走：' +
        ['ice', 'bulwark', 'cover']
          .map((k) => `${k} 牆內 ${wl[k].inside}、走了 ${wl[k].moved.toFixed(1)} m`)
          .join('、'),
    );
    check(
      wl.blocked < 0 && wl.blockedCover === false && wl.n1 === 0,
      '佔地裡有建築時臨時牆不放（冰牆、貨櫃掩體）',
    );

    // ---------- 音效：技能、升級；看不到的位置不播 ----------
    const sfx = await ev(() => {
      const g = window.__game,
        R = g.rts,
        S = window.__sfx,
        A = window.__A;
      const log = [];
      const play0 = S.play;
      S.play = function (k, vol, rate, det, gap, pos, bus) {
        log.push({ k, bus: bus || '' });
        return play0.apply(this, arguments);
      };
      const o = {};
      const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      const hq1 = R.units.find((e) => e.rtsTeam === 1 && e.rtsDef === 'c_hq');
      const bas = g.rtsHeroSpawnAt(0, 'h_bastion', hq0, {});
      g.rtsHeroShift(bas, A.x, A.z - 10);
      bas.hero.lv = 10;
      bas.hero.sk = [3, 3, 3, 1];
      bas.hero.cd = [0, 0, 0, 0];
      g.rtsHeroApply(bas);
      const ally = window.__mk(0, 'c_mt', A.x + 3, A.z - 10);
      log.length = 0;
      o.cast = g.rtsSkillCast(bas, 0, ally);
      o.mine = log.map((q) => q.k).join(',');
      // 升級：介面的短音
      const b2 = g.rtsHeroSpawnAt(0, 'h_rain', hq0, {});
      log.length = 0;
      g.rtsHeroAddXp(b2.hero, 250);
      o.lvup = log
        .filter((q) => q.bus === 'ui')
        .map((q) => q.k)
        .join(',');
      // 敵方英雄在玩家看不到的地方施放：不播
      g.rtsFogRevealAll(0, false);
      const en = g.rtsHeroSpawnAt(1, 'h_pile', hq1, {});
      en.hero.lv = 10;
      en.hero.sk = [3, 3, 3, 1];
      en.hero.cd = [0, 0, 0, 0];
      g.rtsHeroApply(en);
      window.__sim(0.5);
      o.fog = g.rtsFogState(0, en.pos.x, en.pos.z);
      log.length = 0;
      o.sfxHidden = en.rtsSfxSkill('sk_quake', null);
      o.hidden = log.length;
      // 看得到的時候播
      o.sfxSeen = bas.rtsSfxSkill('sk_quake', null);
      S.play = play0;
      window.__kill([bas, b2, en, ally]);
      return o;
    });
    check(sfx.cast && sfx.mine === 'plate1', `技能的音效：BASTION 的重裝甲板播 ${sfx.mine || '（沒有）'}`);
    check(sfx.lvup === 'bell', `英雄升級：介面的短音（${sfx.lvup || '沒有'}）`);
    check(
      sfx.fog !== 2 && sfx.sfxHidden === false && sfx.hidden === 0 && sfx.sfxSeen === 'explode3',
      `看不到的位置不播（迷霧 ${sfx.fog}），自己的英雄照播（${sfx.sfxSeen}）`,
    );

    // ---------- 外觀：結晶護壁、特快專送、投放艙、收好在飛的建築 ----------
    const look = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      g.rtsFogRevealAll && g.rtsFogRevealAll(0);
      const o = {};
      // 結晶護壁
      const node = g.rtsSpawnBld(0, 'a_lab', A.x - 16, A.z + 6, 0, 1);
      const hq = g.rtsSpawnBld(0, 'c_depot', A.x + 2, A.z + 6, 0, 1);
      for (const b of [node, hq]) {
        g.rtsBuff(b, { src: 'aegis', taken: 0.5 }, 4);
        b.rtsAegisT = R.t + 4;
      }
      window.__sim(0.5);
      o.shell = !!(node.rtsAegisFx && hq.rtsAegisFx);
      o.k = node.rtsAegisFx ? +node.rtsAegisFx.userData.k.toFixed(2) : 0;
      o.vis = !!(node.rtsAegisFx && node.rtsAegisFx.visible && node.rtsAegisFx.parent);
      window.__aegis = [node, hq];
      return o;
    });
    check(look.shell && look.k > 0.9 && look.vis, `結晶護壁：建築外加結晶殼（透明度 ${look.k}）`);
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      if (g.rtsCamJump) g.rtsCamJump(A.x - 7, A.z + 6);
      if (g.rts.cam) g.rts.cam.dist = 40;
      window.__pump(0.3, null, 1 / 30);
    });
    await shot('rts-r6-aegis.png');
    const look2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const [node] = window.__aegis;
      window.__sim(4);
      o.gone = !node.rtsAegisFx;
      window.__kill(window.__aegis);
      // 特快專送：運輸機的旋翼與動作（rtsVeerCarrierMove）
      const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      const cou = g.rtsHeroSpawnAt(0, 'h_courier', hq0, {});
      g.rtsHeroShift(cou, A.x, A.z);
      cou.hero.lv = 10;
      cou.hero.sk = [3, 3, 3, 1];
      cou.hero.cd = [0, 0, 0, 0];
      g.rtsHeroApply(cou);
      o.exp = g.rtsSkillCast(cou, 3, { x: A.x + 40, z: A.z + 10 });
      const q = R.hfx.express[0];
      const ship = q && q.ship;
      const rot = ship && ship.model.rotor ? ship.model.rotor.rotation.y : null;
      window.__sim(4);
      o.anim = q ? q.anim || 0 : 0;
      o.rotor = rot !== null && ship.model.rotor.rotation.y !== rot;
      o.st = q ? q.st : '';
      window.__sim(12, () => !R.hfx.express.length);
      // 強襲空投艙、緊急增援：投放艙的外觀
      const sky = g.rtsHeroSpawnAt(0, 'h_skyhook', hq0, {});
      g.rtsHeroShift(sky, A.x, A.z);
      sky.hero.lv = 10;
      sky.hero.sk = [3, 3, 3, 1];
      sky.hero.cd = [0, 0, 0, 0];
      g.rtsHeroApply(sky);
      const n0 = (R.hPods || []).length;
      o.pod = g.rtsSkillCast(sky, 0, { x: A.x + 12, z: A.z });
      o.rein = g.rtsSkillCast(sky, 1, null);
      const pods = (R.hPods || []).slice(n0);
      o.pods = pods.length;
      o.podVis = pods.every((p) => p.vis && p.vis.P);
      window.__sim(3);
      o.landed = pods.every((p) => p.vis && p.vis.land > 0);
      window.__kill([cou, sky]);
      // 收好在飛的建築：rtsFlyAlt 爬升到它上方
      const vhq = g.rtsSpawnBld(0, 'v_hq', A.x + 20, A.z - 20, 0, 1);
      g.rtsPack(vhq);
      g.rtsPackRelease(vhq);
      vhq.pos.y = g.world.terrainHeight(vhq.pos.x, vhq.pos.z) + 5;
      R.hash.update(vhq, vhq.pos.x, vhq.pos.z);
      const heli = window.__mk(0, 'c_heli', A.x + 20 - 14, A.z - 20);
      const D = g.rtsUiDef ? g.rtsUiDef('c_heli') : null;
      const RD = D || { hoverH: heli.hoverH };
      heli.rt.wish.set(1, 0, 0);
      heli.rt.flyT = 0;
      const h0 = RD.hoverH;
      heli.rtsFlyAlt(RD, heli.rt);
      o.fly = [
        +h0.toFixed(1),
        +heli.hoverH.toFixed(1),
        +(vhq.pos.y + 5 - g.world.terrainHeight(heli.pos.x, heli.pos.z)).toFixed(1),
      ];
      window.__kill([vhq, heli]);
      return o;
    });
    check(look2.gone, '結晶護壁到期：外殼移除');
    check(
      look2.exp && look2.anim > 10 && look2.rotor,
      `特快專送：運輸機跑空投運輸機的飛行動作（${look2.anim} 格、旋翼轉動，狀態 ${look2.st}）`,
    );
    check(
      look2.pod && look2.rein && look2.pods >= 3 && look2.podVis && look2.landed,
      `強襲空投艙、緊急增援：投放艙的外觀 ${look2.pods} 個（落下、著地）`,
    );
    check(
      look2.fly[1] >= look2.fly[2] && look2.fly[1] > look2.fly[0],
      `收好在飛的建築：直升機的飛行高度 ${look2.fly[0]} → ${look2.fly[1]}（建築頂 ＋3 ≈ ${look2.fly[2] + 3}）`,
    );
    await ctx.close();
  }

  return { testRtsCreeps };
};
