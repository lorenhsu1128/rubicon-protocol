// Coral 戰爭（RTS）R5 C 包（聖域的英雄與道具，docs/rts-design.md 16.4、16.13）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-sanc-c')(H)。
// testRtsSancHero：三位英雄（MENDER／SALVOR／HAVEN）12 個技能的 Coral、冷卻、效果（修復光束與中斷、緊急處置的解除、
//   記下名字的回血與陣亡礦石、重新站起來（殘骸的 list、人口、revived）、磁吸、廢鐵外殼、拾荒本能（殘骸 +25%、零件）、
//   臨時巨像、布雷區、避難護盾（外面打不進來、裡面打得到、打破）、守住家園（建築附近的單位與建築）、最後的避難所）；
//   4 種專屬道具（磁吸手套、急救包、拼裝工具箱、聚落名冊）；互助市集的貨架；截圖 rts-r5-hero.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，以 rtsSim＋rtsFogTick 快轉。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsSancHero(browser, base) {
    console.log('Coral 戰爭：聖域的英雄（MENDER／SALVOR／HAVEN）與專屬道具');
    const { ctx, page } = await newPage(browser, 'rtsSancHero');
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
        faction: 'sancta',
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
          g.fx.update(dt); // 粒子照遊戲的主迴圈消失（不然快轉時產生的煙塵全部疊在截圖上）
        }
        return until && !until() ? -1 : t;
      };
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
      // 清場：場上的殘骸、地雷
      window.__clean = () => {
        for (const w of [...R.wrecks]) if (!w.map) g.rtsWreckRemove(w);
        for (const m of [...(R.lmines || [])]) g.rtsLandMineRemove(m, 'del');
      };
      R.teams[0].ore = R.teams[1].ore = 50000;
      R.teams[0].coral = R.teams[1].coral = 50000;
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.bld && e.rtsDef === 's_hq');
      window.__hq = hq;
      // 人口：多蓋幾座避難屋（重新站起來要人口）
      for (let i = 0; i < 4; i++) window.__bld(0, 's_depot', hq.pos.x, hq.pos.z, 14);
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      window.__field = { x: hq.pos.x - (hq.pos.x / L) * 60, z: hq.pos.z - (hq.pos.z / L) * 60 };
      window.__sim(1);
      return {
        why: [g.rtsHeroWhy(0, 'h_mender'), g.rtsHeroWhy(0, 'h_bastion'), g.rtsHeroWhy(1, 'h_haven')],
        skills: ['h_mender', 'h_salvor', 'h_haven'].map((id) =>
          g
            .rtsUiDef(id)
            .card.filter((c) => c.act.k === 'ability')
            .map((c) => c.key + ':' + c.name)
            .join(' '),
        ),
        q: g.rtsHeroQueue(hq, 'h_mender'),
      };
    });
    check(
      st.why[0] === '' && /陣營/.test(st.why[1]) && /陣營/.test(st.why[2]),
      `聖域的英雄只給聖域（${st.why.map((w) => w || '可以').join('／')}）`,
    );
    check(
      st.skills[0] === 'Z:修復光束 X:緊急處置 C:記下名字 V:重新站起來' &&
        st.skills[1] === 'Z:磁吸 X:廢鐵外殼 C:拾荒本能 V:臨時巨像' &&
        st.skills[2] === 'Z:布雷區 X:避難護盾 C:守住家園 V:最後的避難所',
      `三位英雄的技能卡（${st.skills.join('｜')}）`,
    );
    const got = await ev(() => {
      const g = window.__game;
      const t = window.__sim(70, () => g.rtsHeroState(0, 'h_mender') === 'alive');
      const e = g.rtsHeroRec(0, 'h_mender').ent;
      return { t, hp: e.maxHp, armor: e.rtsArmor, pal: e.rtsTeam };
    });
    check(
      st.q && got.t > 50 && got.t < 60 && got.hp === 1150 && got.armor === 2,
      `聚落中心生產 MENDER（${got.t.toFixed(1)} 秒、血量 ${got.hp}、護甲 ${got.armor}）`,
    );

    // ---------- MENDER ----------
    const me = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      window.__clean();
      const h = window.__hero('h_mender', F.x, F.z, [1, 1, 0, 0]);
      window.__mend = h;
      const o = {};
      // 修復光束：4 秒共 200（建築 50%）、Coral 10、冷卻 8
      const u = window.__mk(0, 's_rivet', F.x + 12, F.z);
      u.hp = 100;
      const c0 = T.coral;
      o.cast = g.rtsSkillCast(h, 0, u);
      o.coral = Math.round(c0 - T.coral);
      o.cd = Math.round(h.hero.cd[0] - R.t);
      window.__sim(4.6);
      o.heal = Math.round(u.hp - 100);
      // 建築
      const b =
        window.__bld(0, 's_barricade', F.x - 6, F.z + 10, 0) || window.__bld(0, 's_barricade', F.x, F.z, 6);
      b.hp = b.maxHp * 0.3;
      const bh = b.hp;
      h.hero.cd[0] = 0;
      o.castB = g.rtsSkillCast(h, 0, b);
      window.__sim(4.6);
      o.healB = Math.round(b.hp - bh);
      window.__kill(b); // 守住家園的測試要「離建築遠」的地方
      // 中斷：目標離開 26 m
      u.hp = 100;
      h.hero.cd[0] = 0;
      g.rtsSkillCast(h, 0, u);
      window.__sim(1.1);
      g.rtsHeroShift(u, h.pos.x + 32, h.pos.z);
      const hp1 = u.hp;
      window.__sim(3.5);
      o.cut = Math.round(u.hp - hp1);
      o.cutHeal = Math.round(hp1 - 100);
      window.__kill(u);
      // 緊急處置：半徑 8、+15% 最大血量、解除暈眩與緩速（釘住）
      const us = [0, 1, 2].map((i) => window.__mk(0, 's_militia', F.x + 10 + i * 2, F.z + 6));
      for (const q of us) {
        q.hp = q.maxHp * 0.4;
        q.staggerT = 3;
        g.rtsBuff(q, { src: 'ab_pin', speed: 0 }, 3);
      }
      const far = window.__mk(0, 's_militia', F.x + 30, F.z + 6);
      far.hp = far.maxHp * 0.4;
      o.tri = g.rtsSkillCast(h, 1, { x: F.x + 12, z: F.z + 6 });
      o.triHp = us.map((q) => Math.round((q.hp / q.maxHp) * 100));
      o.triStag = us.every((q) => !(q.staggerT > 0));
      o.triSpd = us.every((q) => q.speedMul > 0.1);
      o.triFar = Math.round((far.hp / far.maxHp) * 100);
      o.triN = h.hs.triageN;
      window.__kill(us, far);
      // 記下名字：25 m 內每秒 1 AP；陣亡時 +10% 礦石成本
      h.hero.sk[2] = 1;
      g.rtsHeroApply(h);
      const v = window.__mk(0, 's_rivet', F.x + 8, F.z - 4);
      v.hp = 100;
      window.__sim(4);
      o.regen = Math.round(v.hp - 100);
      const n0 = T.names || 0;
      g.rtsHit(v, 99999, 0, null, 'none');
      o.names = (T.names || 0) - n0;
      const v2 = window.__mk(0, 's_rivet', F.x + 40, F.z - 4);
      g.rtsHit(v2, 99999, 0, null, 'none');
      o.namesFar = (T.names || 0) - n0 - o.names;
      // 重新站起來：60 秒內陣亡的己方單位（合併的殘骸也一台一台起來）
      window.__clean();
      h.hero.sk[3] = 1;
      h.hero.lv = 6;
      h.hero.cd = [0, 0, 0, 0];
      const dead = [0, 1, 2].map((i) => window.__mk(0, 's_militia', F.x + 6 + i * 1.5, F.z + 8));
      const foe = window.__mk(1, 'c_mt', F.x + 6, F.z + 20);
      for (const q of dead) g.rtsHit(q, 99999, 0, null, 'none');
      const ws = g.rtsWreckAt(F.x + 8, F.z + 8, 10, { map: false });
      o.wN = ws.length;
      o.wList = ws.reduce((a, w) => a + w.list.length, 0);
      const pop0 = (g.rtsRecount(), T.pop);
      const made0 = R.stats[0].made;
      o.laz = g.rtsSkillCast(h, 3);
      o.lazN = h.hs.reviveN;
      g.rtsRecount();
      o.lazPop = T.pop - pop0;
      o.lazMade = R.stats[0].made - made0;
      o.revived = R.stats[0].revived;
      const back = R.units.filter((q) => !q.dead && q.rtsTeam === 0 && q.rtsDef === 's_militia');
      o.lazHp = back.map((q) => Math.round((q.hp / q.maxHp) * 100)).join(',');
      o.lazW = g.rtsWreckAt(F.x + 8, F.z + 8, 10, { map: false }).length;
      // 再放一次：沒有殘骸 → 不施放、不扣 Coral
      h.hero.cd[3] = 0;
      const c1 = T.coral;
      o.laz2 = g.rtsSkillCast(h, 3);
      o.laz2c = T.coral === c1;
      window.__kill(back, foe);
      return o;
    });
    check(
      me.cast && me.coral === 10 && me.cd === 8 && Math.abs(me.heal - 200) <= 2,
      `修復光束：Coral ${me.coral}、冷卻 ${me.cd}、4 秒回復 ${me.heal}`,
    );
    check(me.castB && Math.abs(me.healB - 100) <= 2, `修復光束對建築 50%（${me.healB}）`);
    check(
      me.cut === 0 && me.cutHeal > 0 && me.cutHeal < 200,
      `目標離開 26 m 中斷（中斷前 ${me.cutHeal}、之後 ${me.cut}）`,
    );
    check(
      me.tri &&
        me.triHp.join() === '55,55,55' &&
        me.triStag &&
        me.triSpd &&
        me.triFar === 40 &&
        me.triN === 3,
      `緊急處置：+15%（${me.triHp.join('／')}）、解除暈眩與釘住、8 m 外的 ${me.triFar}%`,
    );
    check(
      me.regen >= 3 && me.regen <= 5 && me.names === 13 && me.namesFar === 0,
      `記下名字：每秒 ${me.regen / 4} AP、陣亡 +${me.names} 礦石（25 m 外 ${me.namesFar}）`,
    );
    check(
      me.wN >= 1 &&
        me.wList === 3 &&
        me.laz &&
        me.lazN === 3 &&
        me.lazPop === 3 &&
        me.lazMade === 0 &&
        me.revived === 3,
      `重新站起來：殘骸 ${me.wN} 個（${me.wList} 台）→ ${me.lazN} 台、人口 +${me.lazPop}、revived ${me.revived}`,
    );
    check(
      me.lazHp === '50,50,50' && me.lazW === 0 && !me.laz2 && me.laz2c,
      `重新站起來：血量 ${me.lazHp}%、殘骸用掉、沒有殘骸時不施放`,
    );

    // ---------- SALVOR ----------
    const sa = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      window.__clean();
      const h = window.__hero('h_salvor', F.x, F.z, [1, 1, 1, 1], 6);
      window.__salv = h;
      const o = {};
      // 磁吸：20 m 外的敵方 MT 拉到 3 m、暈眩 1 秒；建築不行
      const mt = window.__mk(1, 'c_mt', F.x + 20, F.z);
      const c0 = T.coral;
      o.mag = g.rtsSkillCast(h, 0, mt);
      o.magC = Math.round(c0 - T.coral);
      o.magD = Math.hypot(mt.pos.x - h.pos.x, mt.pos.z - h.pos.z);
      o.magStun = mt.staggerT;
      h.hero.cd[0] = 0;
      const tw =
        window.__bld(1, 'c_tower', F.x + 18, F.z - 14, 0) || window.__bld(1, 'c_tower', F.x, F.z, 14);
      const c1 = T.coral;
      o.magB = g.rtsSkillCast(h, 0, tw);
      o.magBc = T.coral === c1;
      window.__kill(mt, tw);
      // 廢鐵外殼：附近沒有殘骸 → 不施放；4 個殘骸 → 吸 3 個、360 吸收、+6 零件
      const c2 = T.coral;
      o.mail0 = g.rtsSkillCast(h, 1);
      o.mail0c = T.coral === c2;
      for (let i = 0; i < 4; i++) g.rtsWreckSpawn(F.x + 4 + i * 5, F.z + 4, { ore: 60, parts: 4, team: 1 });
      const p0 = T.parts || 0;
      o.mail = g.rtsSkillCast(h, 1);
      o.mailN = h.hs.mailN;
      o.mailS = h.rtsShield ? Math.round(h.rtsShield.n) : 0;
      o.mailP = (T.parts || 0) - p0;
      o.mailLeft = g
        .rtsWreckAt(F.x + 10, F.z + 4, 16, { map: false })
        .map((w) => w.ore)
        .join(',');
      // 吸收：120×3 打掉
      const hp0 = h.hp;
      const foe = window.__mk(1, 'c_mt', F.x + 12, F.z - 6);
      g.rtsHit(h, 200, 0, foe, 'none');
      o.mailHp = Math.round(hp0 - h.hp);
      h.rtsShield = null;
      window.__clean();
      // 拾荒本能：SALVOR 擊破的 MT 殘骸 40 → 50、零件 +3；別人擊破的照常
      const m1 = window.__mk(1, 'c_mt', F.x + 10, F.z + 10);
      const p1 = T.parts || 0;
      g.rtsHit(m1, 99999, 0, h, 'none');
      o.scrP = (T.parts || 0) - p1;
      const w1 = g.rtsWreckAt(m1.pos.x, m1.pos.z, 3, { map: false, all: true })[0];
      o.scr = w1 ? w1.ore : -1;
      const m2 = window.__mk(1, 'c_mt', F.x - 20, F.z + 10);
      const kill = window.__mk(0, 's_militia', F.x - 16, F.z + 10);
      g.rtsHit(m2, 99999, 0, kill, 'none');
      const w2 = g.rtsWreckAt(m2.pos.x, m2.pos.z, 3, { map: false, all: true })[0];
      o.scr0 = w2 ? w2.ore : -1;
      window.__kill(kill, foe);
      window.__clean();
      // 臨時巨像：殘骸 2 個不夠；5 個 → 巨像 45 秒、血量 +50%、不佔人口
      for (let i = 0; i < 2; i++) g.rtsWreckSpawn(F.x + 6 + i * 6, F.z - 8, { ore: 50, team: 1 });
      o.golem0 = g.rtsSkillCast(h, 3);
      for (let i = 0; i < 3; i++) g.rtsWreckSpawn(F.x + 6 + i * 6, F.z + 8, { ore: 50, team: 1 });
      g.rtsRecount();
      const pop0 = T.pop;
      o.golem = g.rtsSkillCast(h, 3);
      o.golemN = h.hs.golemN;
      const col = R.units.find((q) => !q.dead && q.rtsDef === 's_colossus' && q.rtsTemp);
      o.golemHp = col ? Math.round(col.maxHp) : 0;
      o.golemBase = g.rtsUiDef('s_colossus').hp;
      g.rtsRecount();
      o.golemPop = T.pop - pop0;
      o.golemW = g.rtsWreckAt(F.x + 12, F.z, 20, { map: false }).length;
      window.__sim(46);
      o.golemEnd = !col || col.dead;
      return o;
    });
    check(
      sa.mag && sa.magC === 15 && sa.magD < 4.5 && sa.magStun >= 0.99 && !sa.magB && sa.magBc,
      `磁吸：拉到 ${sa.magD.toFixed(1)} m、暈眩 ${sa.magStun.toFixed(1)} 秒、Coral ${sa.magC}；建築不行`,
    );
    check(
      !sa.mail0 && sa.mail0c && sa.mail && sa.mailN === 3 && sa.mailS === 360 && sa.mailP === 6,
      `廢鐵外殼：沒有殘骸不施放；吸 ${sa.mailN} 個 → 吸收 ${sa.mailS}、零件 +${sa.mailP}（剩 ${sa.mailLeft}）`,
    );
    check(sa.mailHp === 0, `廢鐵外殼吸收傷害（扣血 ${sa.mailHp}）`);
    check(
      sa.scr === 50 && sa.scr0 === 40 && sa.scrP === 3,
      `拾荒本能：SALVOR 擊破的 MT 殘骸 ${sa.scr}（別人 ${sa.scr0}）、零件 +${sa.scrP}`,
    );
    check(
      !sa.golem0 &&
        sa.golem &&
        sa.golemN === 5 &&
        sa.golemHp === Math.round(sa.golemBase * 1.5) &&
        sa.golemPop === 0,
      `臨時巨像：殘骸 2 個不夠；${sa.golemN} 個 → 血量 ${sa.golemHp}（基本 ${sa.golemBase}）、人口 +${sa.golemPop}`,
    );
    check(sa.golemW === 0 && sa.golemEnd, `臨時巨像用掉殘骸、45 秒後消失`);

    // ---------- HAVEN ----------
    const hv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      window.__clean();
      const h = window.__hero('h_haven', F.x, F.z, [1, 1, 1, 1], 6);
      window.__haven = h;
      const o = {};
      // 布雷區：4 顆、80、60 秒、不算布雷無人機的上限
      const c0 = T.coral;
      o.mine = g.rtsSkillCast(h, 0, { x: F.x + 14, z: F.z });
      o.mineC = Math.round(c0 - T.coral);
      const ms = g.rtsLandMinesOf(0);
      o.mineN = ms.length;
      o.mineInfo = ms.length ? [ms[0].dmg, Math.round(ms[0].end - ms[0].t0), ms[0].free] : [];
      o.mineR = Math.max(...ms.map((m) => Math.hypot(m.x - F.x - 14, m.z - F.z)));
      window.__clean();
      // 避難護盾：外面打不進來、裡面打得到、400 打破
      const u = window.__mk(0, 's_rivet', F.x + 10, F.z + 4);
      o.dome = g.rtsSkillCast(h, 1, u);
      const out = window.__mk(1, 'c_mt', u.pos.x + 20, u.pos.z);
      const ins = window.__mk(1, 'c_mt', u.pos.x + 3, u.pos.z);
      const hp0 = u.hp;
      g.rtsHit(u, 150, 0, out, 'none');
      o.out = Math.round(hp0 - u.hp);
      const hp1 = u.hp;
      g.rtsHit(u, 50, 0, ins, 'none');
      o.ins = Math.round(hp1 - u.hp);
      const d = R.hfx.domes[0];
      o.domeLeft = d ? Math.round(d.n) : -1;
      const hp2 = u.hp;
      g.rtsHit(u, 400, 0, out, 'none');
      o.brk = Math.round(hp2 - u.hp);
      o.domeGone = !R.hfx.domes.some((q) => !q.gone);
      window.__kill(u, out, ins);
      // 兩套圓頂同時罩住（避難護盾＋護盾產生器的圓頂）：依序吸收，不重複扣
      h.hero.cd = [0, 0, 0, 0];
      const u2 = window.__mk(0, 's_rivet', F.x + 10, F.z + 4);
      g.rtsSkillCast(h, 1, u2);
      const dC = R.hfx.domes.find((q) => !q.gone && q.host === u2);
      const nC = dC ? dC.n : 0;
      const dB = g.rtsSancDomeAdd(0, u2.pos.x, u2.pos.z, 10, 300, {});
      const out2 = window.__mk(1, 'c_mt', u2.pos.x + 20, u2.pos.z);
      const k = g.rtsDmgK('kin', u2);
      const hpA = u2.hp;
      g.rtsHit(u2, (nC + 100) / k, 0, out2, 'kin');
      o.stack1 = [Math.round(hpA - u2.hp), dC ? Math.round(Math.max(0, dC.n)) : -1, Math.round(dB.hp)];
      const hpB = u2.hp;
      g.rtsHit(u2, 250 / k, 0, out2, 'kin');
      o.stack2 = [Math.round(hpB - u2.hp), Math.round(dB.hp)];
      g.rtsSancDomeDel(dB);
      window.__kill(u2, out2);
      // 守住家園：建築 30 m 內的單位護甲 +1、建築護甲 +1；離建築遠的單位沒有
      const b =
        window.__bld(0, 's_barricade', F.x + 8, F.z - 8, 0) || window.__bld(0, 's_barricade', F.x, F.z, 8);
      const near = window.__mk(0, 's_rivet', b.pos.x + 4, b.pos.z);
      const away = window.__mk(0, 's_rivet', F.x - 20, F.z + 16);
      const base = near.rtsArmor,
        bBase = b.rtsArmor,
        aBase = away.rtsArmor;
      window.__sim(0.6);
      o.hold = [near.rtsArmor - base, b.rtsArmor - bBase];
      o.holdAway = Math.hypot(away.pos.x - b.pos.x, away.pos.z - b.pos.z) > 32 ? away.rtsArmor - aBase : 0;
      window.__kill(away);
      window.__kill(near);
      // 最後的避難所：己方單位與建築 ×0.4、敵人速度 ×0.6、HAVEN 不能動
      const a = window.__mk(0, 's_militia', F.x + 5, F.z + 5); // 鉚釘機會自動釘住敵人（B 包），這裡用民兵
      const e2 = window.__mk(1, 'c_mt', F.x + 8, F.z - 3);
      const sp0 = e2.speedMul;
      o.ref = g.rtsSkillCast(h, 3);
      window.__sim(0.6);
      o.refK = [a.rtsTakenK, b.rtsTakenK, h.rtsTakenK].map((k) => +k.toFixed(2));
      o.refSp = +(e2.speedMul / sp0).toFixed(2);
      o.refMe = h.speedMul;
      window.__kill(e2);
      window.__sim(15.5);
      o.refEnd = [a.rtsTakenK, b.rtsTakenK, h.speedMul > 0];
      window.__kill(a);
      return o;
    });
    check(
      hv.mine && hv.mineC === 20 && hv.mineN === 4 && hv.mineInfo.join() === '80,60,true' && hv.mineR <= 8,
      `布雷區：${hv.mineN} 顆（${hv.mineInfo.join('／')}、最遠 ${hv.mineR.toFixed(1)} m）、Coral ${hv.mineC}`,
    );
    check(
      hv.dome &&
        hv.out === 0 &&
        hv.ins > 0 &&
        hv.domeLeft > 0 &&
        hv.domeLeft < 400 &&
        hv.brk > 0 &&
        hv.domeGone,
      `避難護盾：外面 ${hv.out}、裡面 ${hv.ins}、剩 ${hv.domeLeft}、打破後 ${hv.brk}`,
    );
    check(
      hv.stack1[0] === 0 &&
        hv.stack1[1] === 0 &&
        hv.stack1[2] === 200 &&
        Math.abs(hv.stack2[0] - 50) <= 1 &&
        hv.stack2[1] === 0,
      `兩套圓頂依序吸收：避難護盾先吸滿、剩下 100 給產生器的圓頂（${hv.stack1.join('／')}），再 250 打破後機體受 ${hv.stack2[0]}（圓頂 ${hv.stack2[1]}）`,
    );
    check(
      hv.hold.join() === '1,1' && hv.holdAway === 0,
      `守住家園：建築附近的單位與建築護甲 +${hv.hold.join('／+')}（離建築遠的 +${hv.holdAway}）`,
    );
    check(
      hv.ref && hv.refK.join() === '0.4,0.4,0.4' && hv.refSp === 0.6 && hv.refMe === 0,
      `最後的避難所：受到的傷害 ×${hv.refK.join('／')}、敵人速度 ×${hv.refSp}、HAVEN 速度 ${hv.refMe}`,
    );
    check(
      hv.refEnd[0] === 1 && hv.refEnd[1] === 1 && hv.refEnd[2],
      `最後的避難所 15 秒後結束（${hv.refEnd.join('／')}）`,
    );

    // ---------- 道具與互助市集 ----------
    const it = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      window.__clean();
      const o = {};
      const D = g.rtsUiDef('s_market');
      o.shelf = (D.shopItems || []).join();
      o.card = (D.card || []).map((c) => c.key + (c.req ? c.req.tier : '')).join('');
      o.other = ['c_market', 'a_vault', 'v_market'].some((id) =>
        (g.rtsUiDef(id).shopItems || []).some((x) =>
          ['i_magnet', 'i_bandage', 'i_toolbox', 'i_logbook'].includes(x),
        ),
      );
      const h = window.__mend;
      g.rtsHeroShift(h, F.x, F.z);
      h.hero.inv = [null, null, null, null, null, null];
      h.hero.sk = [1, 1, 0, 1]; // 記下名字的回血不算進急救包
      g.rtsHeroApply(h);
      window.__sim(0.6);
      const slot = (id) => h.hero.inv.findIndex((s) => s && s.id === id);
      // 磁吸手套：12 m 內價值最高的殘骸拆完、60% 入帳
      g.rtsItemGive(h, 'i_magnet', 3);
      g.rtsWreckSpawn(F.x + 5, F.z, { ore: 40, parts: 2, team: 1 });
      const big = g.rtsWreckSpawn(F.x - 6, F.z + 2, { ore: 100, parts: 10, team: 1 });
      const p0 = T.parts || 0,
        so0 = R.stats[0].salvOre || 0;
      o.mag = g.rtsItemUse(h, slot('i_magnet'));
      o.magGot = h.hs.magnetGot;
      o.magGone = big.gone;
      o.magP = (T.parts || 0) - p0;
      o.magSalv = (R.stats[0].salvOre || 0) - so0;
      o.magCh = h.hero.inv[slot('i_magnet')].ch;
      // 急救包：英雄與 8 m 內 5 秒共 150
      g.rtsItemGive(h, 'i_bandage', 2);
      const u = window.__mk(0, 's_rivet', F.x + 5, F.z + 3);
      u.hp = 100;
      h.hp = h.maxHp - 300;
      const hh = h.hp;
      o.band = g.rtsItemUse(h, slot('i_bandage'));
      const foe = window.__mk(1, 'c_mt', F.x + 30, F.z);
      g.rtsHit(h, 20, 0, foe, 'none'); // 受傷不中斷
      window.__kill(foe);
      window.__sim(5.6);
      o.bandU = Math.round(u.hp - 100);
      o.bandH = Math.round(h.hp - hh + 20);
      // 拼裝工具箱：英雄 10 m 內是改裝站
      o.tool0 = g.rtsRefitStations(0).some((s) => s.tool);
      g.rtsItemGive(h, 'i_toolbox');
      o.tool1 = g.rtsRefitStations(0).some((s) => s.tool && s.e === h && s.r === 10);
      // 聚落名冊：25 m 內己方陣亡 +5 零件、殘骸 +25%
      g.rtsItemGive(h, 'i_logbook');
      const v = window.__mk(0, 's_rivet', F.x + 10, F.z - 6);
      const p1 = T.parts || 0;
      g.rtsHit(v, 99999, 0, null, 'none');
      o.logP = (T.parts || 0) - p1;
      const w = g.rtsWreckAt(v.pos.x, v.pos.z, 3, { map: false, all: true })[0];
      o.logW = w ? w.ore : -1;
      const v2 = window.__mk(0, 's_rivet', F.x + 50, F.z - 6);
      const p2 = T.parts || 0;
      g.rtsHit(v2, 99999, 0, null, 'none');
      o.logP2 = (T.parts || 0) - p2;
      const w2 = g.rtsWreckAt(v2.pos.x, v2.pos.z, 3, { map: false, all: true })[0];
      o.logW2 = w2 ? w2.ore : -1;
      window.__kill(u);
      return o;
    });
    check(
      it.shelf ===
        'i_kit,i_scout,i_beacon,i_magnet,i_bandage,i_barrier,i_fcs,i_plate,i_toolbox,i_logbook,i_scope,i_antenna' &&
        !it.other,
      `互助市集的貨架 12 格（${it.card}）、其他商店沒有聖域的專屬道具`,
    );
    check(
      it.mag &&
        it.magGot &&
        it.magGot.ore === 60 &&
        it.magGot.parts === 6 &&
        it.magGone &&
        it.magP === 6 &&
        it.magCh === 2,
      `磁吸手套：拆完 100 的殘骸 → 礦石 ${it.magGot && it.magGot.ore}、零件 +${it.magP}、剩 ${it.magCh} 次`,
    );
    check(
      it.band && it.bandU >= 148 && it.bandU <= 168 && it.bandH >= 148 && it.bandH <= 168,
      `急救包：英雄 +${it.bandH}（受傷不中斷）、旁邊 +${it.bandU}`,
    );
    check(!it.tool0 && it.tool1, `拼裝工具箱：帶著時英雄 10 m 內是改裝站`);
    check(
      it.logP === 5 && it.logW === 48 && it.logP2 === 0 && it.logW2 === 39,
      `聚落名冊：陣亡 +${it.logP} 零件、殘骸 ${it.logW}（25 m 外 +${it.logP2}、${it.logW2}）`,
    );

    // ---------- 截圖：避難所、避難護盾、布雷區、修復光束、臨時巨像 ----------
    await ev(() => {
      const g = window.__game,
        F = window.__field;
      window.__clean();
      const me = window.__mend,
        sa = window.__salv,
        hv = window.__haven;
      g.rtsHeroShift(hv, F.x, F.z);
      g.rtsHeroShift(me, F.x - 6, F.z + 6);
      g.rtsHeroShift(sa, F.x + 8, F.z - 6);
      for (const h of [me, sa, hv]) {
        h.hero.cd = [0, 0, 0, 0];
        h.hero.sk = [1, 1, 1, 1];
        h.hero.lv = 6;
        h.orders = [{ k: 'hold' }];
      }
      const us = [0, 1, 2].map((i) => window.__mk(0, 's_rivet', F.x - 4 + i * 4, F.z - 4));
      for (const q of us) q.hp = q.maxHp * 0.5;
      for (let i = 0; i < 4; i++) g.rtsWreckSpawn(F.x + 8 + i * 5, F.z - 12, { ore: 60, team: 1 });
      g.rtsSkillCast(hv, 3);
      g.rtsSkillCast(hv, 1, us[0]);
      g.rtsSkillCast(hv, 0, { x: F.x + 22, z: F.z + 4 });
      g.rtsSkillCast(me, 0, us[1]);
      g.rtsSkillCast(sa, 3);
      const foes = [0, 1, 2].map((i) => window.__mk(1, 'c_mt', F.x + 26 + i * 4, F.z + 10));
      for (const f of foes) f.orders = [{ k: 'amove', x: F.x, z: F.z }];
      if (g.rtsCamJump) g.rtsCamJump(F.x + 6, F.z);
      window.__pump(1.0, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r5-hero.png') });
    await ctx.close();
  }

  return { testRtsSancHero };
};
