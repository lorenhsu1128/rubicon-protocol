// Coral 戰爭（RTS）R3 C 包（艾瑟立克的英雄與道具，docs/rts-design.md 14.4、14.13）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-aeth-c')(H)。
// testRtsAethHero：三位英雄（PRISM／CURATOR／VEIL）12 個技能的 Coral、冷卻、效果（折射直線、屏障吸收、共振場、天光陣列、
//   孵化 40 秒消失、催化立刻完成融合、共生、群體融合、分身、EMP 的暈眩與建築暫停、相位迷彩、虛像軍團）；4 種專屬道具；
//   樣本保管庫的貨架依層級、停擺不能買、中立商店與補給商店與掉寶沒有專屬道具；截圖 rts-r3-hero.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，以 rtsSim 快轉。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsAethHero(browser, base) {
    console.log('Coral 戰爭：艾瑟立克的英雄（PRISM／CURATOR／VEIL）與專屬道具');
    const { ctx, page } = await newPage(browser, 'rtsAethHero');
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
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'aetheric',
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
        const e = g.rtsSpawn(team, def, p.x, p.z, 0);
        if (e) e.orders = [{ k: 'hold' }];
        return e;
      };
      // 英雄（直接生成＋紀錄），技能等級 sk
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
        g.rtsHeroApply(e);
        e.hp = e.maxHp;
        e.orders = [{ k: 'hold' }];
        return e;
      };
      // 有電的地方放建築
      window.__pbld = (team, def, x, z, p = 1) => {
        const D = g.rtsUiDef ? g.rtsUiDef(def) : null;
        const nav = g.world.nav;
        for (let r = 0; r <= 26; r += 1)
          for (let a = 0; a < 36; a++) {
            const px = x + Math.cos((a / 36) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 36) * Math.PI * 2) * r;
            if (nav.buildable(px, pz, D.foot[0] + 1, D.foot[1] + 1) && !g.rtsPowerWhy(team, def, px, pz))
              return g.rtsSpawnBld(team, def, px, pz, 0, p);
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
      const hq = window.__of(0, 'a_hq')[0];
      window.__hq = hq;
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      window.__field = { x: hq.pos.x - (hq.pos.x / L) * 45, z: hq.pos.z - (hq.pos.z / L) * 45 };
      // 清掉敵人的工人（測試的範圍傷害不要波及）
      return {
        why: [g.rtsHeroWhy(0, 'h_prism'), g.rtsHeroWhy(0, 'h_bastion'), g.rtsHeroWhy(1, 'h_veil')],
        skills: ['h_prism', 'h_curator', 'h_veil'].map((id) =>
          g
            .rtsUiDef(id)
            .card.filter((c) => c.act.k === 'ability')
            .map((c) => c.key + ':' + c.name)
            .join(' '),
        ),
        q: g.rtsHeroQueue(hq, 'h_prism'),
      };
    });
    check(
      st.why[0] === '' && /陣營/.test(st.why[1]) && /陣營/.test(st.why[2]),
      `艾瑟立克的英雄只給艾瑟立克（${st.why.map((w) => w || '可以').join('／')}）`,
    );
    check(
      st.skills[0] === 'Z:折射光束 X:稜鏡屏障 C:共振場 V:天光陣列' &&
        st.skills[1] === 'Z:孵化 X:催化 C:共生 V:群體融合' &&
        st.skills[2] === 'Z:全像分身 X:電磁脈衝 C:相位迷彩 V:虛像軍團',
      `三位英雄的技能卡（${st.skills.join('｜')}）`,
    );
    const got = await ev(() => {
      const g = window.__game;
      const t = window.__sim(70, () => g.rtsHeroState(0, 'h_prism') === 'alive');
      const e = g.rtsHeroRec(0, 'h_prism').ent;
      return { t, hp: e.maxHp, armor: e.rtsArmor, lv: e.hero.lv, fac: g.rts.teams[0].faction };
    });
    check(
      st.q && got.t > 50 && got.t < 60 && got.hp === 1100 && got.armor === 2,
      `研究中樞生產 PRISM（${got.t.toFixed(1)} 秒、血量 ${got.hp}、護甲 ${got.armor}）`,
    );

    // ---------- PRISM ----------
    const pr = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      const h = window.__hero('h_prism', F.x, F.z, [3, 1, 1, 1]);
      window.__prism = h;
      g.rtsHeroShift(h, h.pos.x, h.pos.z);
      // 折射：直線上 3 台、旁邊 1 台、線上的建築
      const on = [10, 18, 26].map((d) => window.__mk(1, 'c_mt', h.pos.x + d, h.pos.z));
      const off = window.__mk(1, 'c_mt', h.pos.x + 14, h.pos.z + 7);
      const b = g.rtsSpawnBld(1, 'c_depot', h.pos.x + 36, h.pos.z, 0, 1);
      window.__sim(0.6); // 共振場（自己也是能量攻擊）
      o.k = h.dmgMul;
      const c0 = T.coral;
      window.__spy = [];
      o.ok = g.rtsSkillCast(h, 0, { x: h.pos.x + 30, z: h.pos.z });
      o.coral = c0 - T.coral;
      o.cd = Math.round(h.hero.cd[0] - R.t);
      o.early = window.__spy.length;
      window.__sim(0.8);
      const sp = window.__spy.filter((s) => s.src === h.id);
      o.on = on.map((u) => ((sp.find((s) => s.id === u.id) || {}).d || 0) / o.k);
      o.off = sp.some((s) => s.id === off.id);
      o.bld = b ? ((sp.find((s) => s.id === b.id) || {}).d || 0) / o.k : -1;
      o.atk = sp.length ? sp[0].atk : '';
      window.__spy = null;
      for (const u of [...on, off]) ((u.rtsQuiet = true), u.die(null));
      if (b) ((b.rtsQuiet = true), b.die(null));
      // 稜鏡屏障：友軍吸收 200
      const ally = window.__mk(0, 'a_laser', h.pos.x + 4, h.pos.z + 4);
      const c1 = T.coral;
      o.sh = g.rtsSkillCast(h, 1, ally);
      o.shCoral = c1 - T.coral;
      o.n0 = ally.rtsShield ? ally.rtsShield.n : 0;
      const hp0 = ally.hp;
      g.rtsHit(ally, 100, 0, null, 'none');
      o.hp1 = hp0 - ally.hp;
      o.n1 = ally.rtsShield ? ally.rtsShield.n : 0;
      g.rtsHit(ally, 150, 0, null, 'none');
      o.hp2 = hp0 - ally.hp;
      o.gone = !ally.rtsShield;
      h.hero.cd[1] = 0;
      o.noCast = g.rtsSkillCast(h, 1, window.__mk(1, 'c_mt', h.pos.x - 6, h.pos.z)); // 不能對敵人
      // 共振場：能量攻擊的友軍 +8%，實驗體（實彈）不受影響
      const blob = window.__mk(0, 'a_blob', h.pos.x - 4, h.pos.z + 4);
      window.__sim(0.6);
      o.resoAlly = Math.round(ally.rtsM.dmg * 100) / 100;
      o.resoBlob = Math.round(blob.rtsM.dmg * 100) / 100;
      // 天光陣列
      const tgts = [0, 1, 2].map((i) => window.__mk(1, 'c_mt', h.pos.x + 30 + i * 2, h.pos.z + 6));
      const c2 = T.coral;
      window.__spy = [];
      o.sky = g.rtsSkillCast(h, 3, { x: h.pos.x + 32, z: h.pos.z + 6 });
      o.skyCoral = c2 - T.coral;
      o.skyCd = Math.round(h.hero.cd[3] - R.t);
      window.__sim(4.6);
      const sk = window.__spy.filter((s) => s.src === h.id);
      o.skyBig = sk.filter((s) => s.d > 300).length;
      o.skyMax = Math.max(0, ...sk.map((s) => s.d));
      o.skyAtk = [...new Set(sk.map((s) => s.atk))].join();
      window.__spy = null;
      for (const u of tgts) if (!u.dead) ((u.rtsQuiet = true), u.die(null));
      ally.rtsQuiet = blob.rtsQuiet = true;
      ally.die(null);
      blob.die(null);
      return o;
    });
    check(
      pr.ok && pr.coral === 30 && pr.cd === 10 && pr.early === 0,
      `折射光束 3 級：Coral ${pr.coral}、冷卻 ${pr.cd}、預警中沒有傷害`,
    );
    check(
      pr.on.every((d) => Math.abs(d - 190) < 1) && !pr.off && Math.abs(pr.bld - 95) < 1 && pr.atk === 'en',
      `折射光束：直線上 ${pr.on.map((d) => d.toFixed(0)).join('／')} 能量、旁邊的沒打到、建築 ${pr.bld.toFixed(0)}（×0.5）`,
    );
    check(
      pr.sh &&
        pr.shCoral === 15 &&
        pr.n0 === 200 &&
        pr.hp1 === 0 &&
        Math.abs(pr.n1 - 100) < 1 &&
        Math.abs(pr.hp2 - 50) < 1 &&
        pr.gone &&
        !pr.noCast,
      `稜鏡屏障：吸收 200（打 100 → 剩 ${pr.n1}、再打 150 → 扣血 ${pr.hp2.toFixed(0)}）、不能對敵人`,
    );
    check(
      pr.resoAlly === 1.08 && pr.resoBlob === 1,
      `共振場：雷射步兵 ×${pr.resoAlly}、實驗體 ×${pr.resoBlob}`,
    );
    check(
      pr.sky && pr.skyCoral === 90 && pr.skyCd === 140 && pr.skyBig >= 1 && pr.skyAtk === 'en',
      `天光陣列：Coral ${pr.skyCoral}、冷卻 ${pr.skyCd}、中心 400 打中 ${pr.skyBig} 台（最大 ${pr.skyMax.toFixed(0)}）`,
    );

    // ---------- CURATOR ----------
    const cu = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      const h = window.__hero('h_curator', F.x + 6, F.z - 10, [1, 1, 1, 1]);
      window.__cur = h;
      // 孵化
      g.rtsRecount();
      const pop0 = T.pop;
      const n0 = window.__of(0, 'a_blob').length;
      const c0 = T.coral;
      o.hatch = g.rtsSkillCast(h, 0);
      o.hCoral = c0 - T.coral;
      o.hCd = Math.round(h.hero.cd[0] - R.t);
      const hatched = window.__of(0, 'a_blob').filter((b) => b.rtsTemp);
      o.n = window.__of(0, 'a_blob').length - n0;
      g.rtsRecount();
      o.pop = T.pop - pop0;
      o.quiet = hatched.every((b) => b.rtsQuiet && b.rtsNoPop); // 擊破不給經驗、不算陣亡
      const lost0 = R.stats[0].lost;
      hatched[0].takeDamage(99999, 0, null, hatched[0].center());
      o.lost = R.stats[0].lost - lost0;
      o.t40 = window.__sim(41, () => window.__of(0, 'a_blob').filter((b) => b.rtsTemp).length === 0);
      // 共生：生體單位回復＋傷害
      const b = window.__mk(0, 'a_blob', h.pos.x + 3, h.pos.z);
      const lz = window.__mk(0, 'a_laser', h.pos.x - 3, h.pos.z);
      window.__sim(0.6);
      o.symb = [Math.round(b.rtsM.dmg * 100) / 100, b.rtsRegen, Math.round(lz.rtsM.dmg * 100) / 100];
      // 催化：生體單位回復 30%、速度 ×1.3；非生體不能
      b.hp = b.maxHp * 0.4;
      const c1 = T.coral;
      o.cat = g.rtsSkillCast(h, 1, b);
      o.catCoral = c1 - T.coral;
      o.catHp = Math.round((b.hp / b.maxHp) * 100);
      o.catSp = b.rtsM.speed;
      h.hero.cd[1] = 0;
      o.catNo = g.rtsSkillCast(h, 1, lz);
      ((b.rtsQuiet = true), b.die(null));
      ((lz.rtsQuiet = true), lz.die(null));
      // 催化：引導中的融合立刻完成（T2＋培養槽）
      g.rtsChangeDef(window.__hq, 'a_hq2');
      g.rtsRecount();
      if (g.rtsPowerRebuild) g.rtsPowerRebuild(0);
      o.lab = !!window.__pbld(0, 'a_lab', window.__hq.pos.x, window.__hq.pos.z);
      g.rtsRecount();
      const mats = [0, 1, 2].map((i) => window.__mk(0, 'a_blob', h.pos.x + 6 + i * 2, h.pos.z + 3));
      for (const m of mats) m.orders = [];
      o.groups = g.rtsFuseIssue ? g.rtsFuseIssue(mats, 'fu_chimera') : 0;
      o.chanT = window.__sim(10, () => R.fuses.some((f) => f.st === 'chan'));
      const f = R.fuses.find((x) => x.st === 'chan');
      const ch0 = window.__of(0, 'a_chimera').length;
      h.hero.cd[1] = 0;
      o.catFuse = f ? g.rtsSkillCast(h, 1, f.host) : false;
      o.chim = window.__of(0, 'a_chimera').length - ch0;
      o.fuses = R.fuses.length;
      // 群體融合：7 隻 → 2 隻嵌合體＋1 隻回滿血、免費（只扣技能的 80）
      for (const c of window.__of(0, 'a_chimera')) ((c.rtsQuiet = true), c.die(null));
      const seven = [];
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const u = window.__mk(0, 'a_blob', h.pos.x + Math.cos(a) * 8, h.pos.z + Math.sin(a) * 8);
        u.hp = u.maxHp * 0.5;
        seven.push(u);
      }
      const c2 = T.coral;
      o.mass = g.rtsSkillCast(h, 3);
      o.massCoral = c2 - T.coral;
      o.massCd = Math.round(h.hero.cd[3] - R.t);
      const chims = window.__of(0, 'a_chimera');
      o.massChim = chims.length;
      const left = window.__of(0, 'a_blob').filter((u) => seven.includes(u));
      o.massLeft = left.length;
      o.massFull = left.every((u) => u.hp === u.maxHp);
      o.massTaken = chims.map((c) => Math.round(c.rtsTakenK * 100) / 100).join();
      for (const u of [...chims, ...left]) ((u.rtsQuiet = true), u.die(null));
      g.rtsRecount();
      return o;
    });
    check(
      cu.hatch &&
        cu.hCoral === 20 &&
        cu.hCd === 18 &&
        cu.n === 2 &&
        cu.pop === 0 &&
        cu.quiet &&
        cu.lost === 0,
      `孵化：Coral ${cu.hCoral}、冷卻 ${cu.hCd}、${cu.n} 隻實驗體、人口 +${cu.pop}、擊破不算（${cu.lost}）`,
    );
    check(cu.t40 > 39 && cu.t40 < 41, `孵化的實驗體 40 秒後消失（${cu.t40.toFixed(1)} 秒）`);
    check(
      cu.symb[0] === 1.05 && cu.symb[1] === 2 && (cu.symb[2] === 1 || cu.symb[2] === 1.08),
      `共生：實驗體傷害 ×${cu.symb[0]}、每秒回復 ${cu.symb[1]}；雷射步兵 ×${cu.symb[2]}`,
    );
    check(
      cu.cat && cu.catCoral === 15 && cu.catHp === 70 && Math.abs(cu.catSp - 1.3) < 1e-6 && !cu.catNo,
      `催化：Coral ${cu.catCoral}、血量 40% → ${cu.catHp}%、速度 ×${cu.catSp}；雷射步兵不能`,
    );
    check(
      cu.lab && cu.groups === 1 && cu.chanT >= 0 && cu.catFuse && cu.chim === 1 && cu.fuses === 0,
      `催化：引導中的融合立刻完成（嵌合體 +${cu.chim}）`,
    );
    check(
      cu.mass &&
        cu.massCoral === 80 &&
        cu.massCd === 150 &&
        cu.massChim === 2 &&
        cu.massLeft === 1 &&
        cu.massFull &&
        cu.massTaken === '0.7,0.7',
      `群體融合：7 隻 → 嵌合體 ${cu.massChim}＋剩 ${cu.massLeft} 隻回滿血、只扣 ${cu.massCoral}、受到的傷害 ×${cu.massTaken}`,
    );

    // ---------- VEIL ----------
    const ve = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0],
        F = window.__field;
      const o = {};
      g.rtsHeroShift(window.__prism, window.__hq.pos.x, window.__hq.pos.z); // 共振場不要影響
      const h = window.__hero('h_veil', F.x - 8, F.z + 10, [1, 1, 0, 1], 3);
      window.__veil = h;
      window.__sim(0.6);
      g.rtsRecount();
      const pop0 = T.pop;
      const c0 = T.coral;
      o.mir = g.rtsSkillCast(h, 0);
      o.mCoral = c0 - T.coral;
      o.mCd = Math.round(h.hero.cd[0] - R.t);
      const il = g.rtsIllusionsOf(0).filter((e) => e.rtsDef === 'h_veil');
      o.n = il.length;
      g.rtsRecount();
      o.pop = T.pop - pop0;
      o.ilHp = il.map((e) => Math.round(e.maxHp)).join();
      o.hp = Math.round(h.maxHp);
      o.ilDmg = il.length ? Math.round((il[0].dmgMul / h.dmgMul) * 100) / 100 : 0;
      o.ilTaken = il.length ? il[0].rtsTakenK : 0;
      o.ilRec = il.every((e) => !e.hero);
      o.ilT = il.length ? Math.round(il[0].rtsIllus.t - R.t) : 0;
      // 3 級：3 個、25 秒
      for (const e of il) g.rtsIllusionEnd(e);
      h.hero.sk[0] = 3;
      h.hero.cd[0] = 0;
      g.rtsSkillCast(h, 0);
      const il3 = g.rtsIllusionsOf(0).filter((e) => e.rtsDef === 'h_veil');
      o.n3 = il3.length;
      o.t3 = il3.length ? Math.round(il3[0].rtsIllus.t - R.t) : 0;
      for (const e of il3) g.rtsIllusionEnd(e);
      // 電磁脈衝：敵方主堡的生產暫停、單位暈眩
      const hq1 = window.__of(1, 'c_hq')[0];
      g.rtsQueue(hq1, 'c_worker');
      window.__sim(1);
      const q0 = JSON.stringify(hq1.bld.queue[0]);
      const mt = window.__mk(1, 'c_mt', hq1.pos.x + 12, hq1.pos.z + 2);
      window.__spy = [];
      const c1 = T.coral;
      o.emp = g.rtsSkillCast(h, 1, { x: mt.pos.x, z: mt.pos.z });
      o.eCoral = c1 - T.coral;
      o.eCd = Math.round(h.hero.cd[1] - R.t);
      o.stun = mt.staggerT;
      const near = g.rtsHeroFoes(0, mt.pos.x, mt.pos.z, 8).filter((t) => t.bld);
      o.empT = near.length ? Math.round(near[0].bld.empT - R.t) : -1;
      o.empBld = near.length;
      o.empDmg = ((window.__spy.find((s) => s.id === mt.id) || {}).d || 0) / h.dmgMul;
      window.__spy = null;
      // 主堡（在 8 m 內時）：生產停住
      hq1.bld.empT = R.t + 4;
      window.__sim(2);
      o.qStop = JSON.stringify(hq1.bld.queue[0]) === q0 || !hq1.bld.queue.length;
      o.off = g.rtsBldOff(hq1);
      window.__sim(2.2);
      o.qGo = JSON.stringify(hq1.bld.queue[0]) !== q0;
      ((mt.rtsQuiet = true), mt.die(null));
      // 相位迷彩：學了之後 4 秒不開火隱形，打中敵人現形
      h.hero.sk[2] = 1;
      h.hs.actT = R.t;
      window.__sim(3.5);
      o.ph0 = h.noLock;
      window.__sim(1);
      o.ph1 = h.noLock;
      const foe = window.__mk(1, 'c_mt', h.pos.x + 8, h.pos.z);
      foe.takeDamage(5, 0, h, foe.center());
      ((foe.rtsQuiet = true), foe.die(null)); // VEIL 不要一直開火
      window.__sim(0.6);
      o.ph2 = h.noLock;
      window.__sim(4.2);
      o.ph3 = h.noLock;
      h.hero.cd[1] = 0;
      g.rtsSkillCast(h, 1, { x: h.pos.x + 20, z: h.pos.z });
      window.__sim(0.6);
      o.ph4 = h.noLock;
      // 虛像軍團：5 台雷射步兵＋1 台工人 → 5 個幻象
      const army = [0, 1, 2, 3, 4].map((i) => window.__mk(0, 'a_laser', h.pos.x + 4 + i * 2, h.pos.z + 3));
      const wk = window.__mk(0, 'a_worker', h.pos.x - 4, h.pos.z + 3);
      const n0 = g.rtsIllusionsOf(0).length;
      const c2 = T.coral;
      o.leg = g.rtsSkillCast(h, 3);
      o.lCoral = c2 - T.coral;
      o.lCd = Math.round(h.hero.cd[3] - R.t);
      const li = g.rtsIllusionsOf(0).slice(n0);
      o.lN = li.length;
      o.lDef = [...new Set(li.map((e) => e.rtsDef))].join();
      o.lK = li.length ? [Math.round((li[0].dmgMul / army[0].dmgMul) * 100) / 100, li[0].rtsTakenK] : [];
      for (const e of [...li, ...army, wk]) ((e.rtsQuiet = true), e.die(null));
      return o;
    });
    check(
      ve.mir &&
        ve.mCoral === 20 &&
        ve.mCd === 16 &&
        ve.n === 2 &&
        ve.pop === 0 &&
        ve.ilHp === `${ve.hp},${ve.hp}` &&
        ve.ilDmg === 0.25 &&
        ve.ilTaken === 2 &&
        ve.ilRec &&
        ve.ilT === 15,
      `全像分身：${ve.n} 個（血量 ${ve.ilHp}＝英雄 ${ve.hp}、傷害 ×${ve.ilDmg}、受到 ×${ve.ilTaken}、${ve.ilT} 秒、不佔人口、沒有英雄紀錄）`,
    );
    check(ve.n3 === 3 && ve.t3 === 25, `全像分身 3 級：${ve.n3} 個、${ve.t3} 秒`);
    check(
      ve.emp && ve.eCoral === 25 && ve.eCd === 14 && ve.stun >= 0.9 && Math.abs(ve.empDmg - 60) < 1,
      `電磁脈衝：Coral ${ve.eCoral}、冷卻 ${ve.eCd}、${ve.empDmg.toFixed(0)} 能量、暈眩 ${ve.stun.toFixed(1)} 秒`,
    );
    check(
      ve.qStop && ve.off && ve.qGo,
      `電磁脈衝：敵方建築的生產暫停（停擺 ${ve.off}）、時間到恢復；範圍內的建築 ${ve.empBld} 座（暫停 ${ve.empT} 秒）`,
    );
    check(
      !ve.ph0 && ve.ph1 && !ve.ph2 && ve.ph3 && !ve.ph4,
      `相位迷彩：4 秒後隱形（${ve.ph0}→${ve.ph1}）、開火現形（${ve.ph2}）、再隱形（${ve.ph3}）、施放現形（${ve.ph4}）`,
    );
    check(
      ve.leg &&
        ve.lCoral === 100 &&
        ve.lCd === 160 &&
        ve.lN === 5 &&
        ve.lDef === 'a_laser' &&
        ve.lK.join() === '0.3,2',
      `虛像軍團：${ve.lN} 個幻象（不含工人）、傷害 ×${ve.lK[0]}、受到 ×${ve.lK[1]}`,
    );

    // ---------- 道具與保管庫 ----------
    const it = await ev(() => {
      const g = window.__game,
        R = g.rts,
        T = R.teams[0];
      const o = {};
      const RD = (id) => g.rtsUiDef(id);
      const vD = RD('a_vault');
      o.shelf = (vD.shopItems || []).join();
      o.card = (vD.card || []).map((c) => c.key + (c.req ? c.req.tier : '')).join('');
      o.cm = (RD('c_market').shopItems || []).some((id) => /stim|sample|relay|lens/.test(id));
      o.cmCard = (RD('c_market').card || []).some((c) => /stim|sample|relay|lens/.test(c.act.item));
      o.neu = (g.rtsUiDef('n_shop') ? g.rtsUiDef('n_shop').card || [] : []).some((c) =>
        /stim|sample|relay|lens/.test(c.act && c.act.item),
      );
      // 保管庫：導管裡、英雄 12 m 內
      g.rtsChangeDef(window.__hq, 'a_hq');
      g.rtsRecount();
      g.rtsPowerRebuild(0);
      const v = window.__pbld(0, 'a_vault', window.__hq.pos.x, window.__hq.pos.z);
      const h = window.__prism;
      g.rtsHeroShift(h, v.pos.x + 9, v.pos.z);
      h.hero.inv = new Array(6).fill(null);
      g.rtsHeroApply(h);
      o.t1 = g.rtsBuyList(v, 0).length;
      o.t1why = g.rtsBuyWhy(h, 'i_relay');
      g.rtsChangeDef(window.__hq, 'a_hq2');
      g.rtsRecount();
      o.t2 = g.rtsBuyList(v, 0).length;
      g.rtsChangeDef(window.__hq, 'a_hq3');
      g.rtsRecount();
      o.t3 = g.rtsBuyList(v, 0).length;
      const ore0 = T.ore,
        c0 = T.coral;
      for (const id of ['i_stim', 'i_sample', 'i_relay', 'i_lens']) o['b_' + id] = g.rtsBuyAct(h, id);
      o.paid = [ore0 - T.ore, c0 - T.coral];
      // 停擺時不能買
      v.bld.empT = R.t + 5;
      o.offWhy = g.rtsBuyWhy(h, 'i_kit');
      o.offWhy2 = g.rtsBuyWhy(v, 'i_kit');
      o.offBuy = g.rtsBuyAct(h, 'i_kit');
      v.bld.empT = 0;
      o.onWhy = g.rtsBuyWhy(h, 'i_kit');
      // 聚焦透鏡：技能傷害 ×1.15
      o.skill = Math.round(h.rtsM.skill * 100) / 100;
      // 興奮劑
      const slot = (id) => h.hero.inv.findIndex((s) => s && s.id === id);
      window.__sim(0.7); // 導管上的加成（buff 0.6 秒）先穩定
      const sp0 = h.speedMul,
        rof0 = h.rtsRofK;
      h.hp = h.maxHp;
      o.stim = g.rtsItemUse(h, slot('i_stim'));
      o.stimSp = Math.round((h.speedMul / sp0) * 100) / 100;
      o.stimRof = Math.round((rof0 / h.rtsRofK) * 100) / 100;
      window.__sim(8.3);
      o.stimHp = Math.round((1 - h.hp / h.maxHp) * 100);
      o.stimEnd = Math.round((h.speedMul / sp0) * 100) / 100;
      o.stimCh = (h.hero.inv[slot('i_stim')] || {}).ch;
      // 實驗體樣本
      g.rtsRecount();
      const pop0 = T.pop;
      const n0 = window.__of(0, 'a_blob').length;
      o.sample = g.rtsItemUse(h, slot('i_sample'));
      o.sN = window.__of(0, 'a_blob').length - n0;
      g.rtsRecount();
      o.sPop = T.pop - pop0;
      o.sT = Math.round(window.__of(0, 'a_blob').find((b) => b.rtsTemp).rtsTemp - R.t);
      // 攜帶式導管：範圍外 → 用了之後可以蓋 → 60 秒後又不行
      g.rtsHeroShift(h, window.__field.x, window.__field.z);
      let px = null;
      for (let r = 10; r <= 20 && !px; r += 2)
        for (let a = 0; a < 16; a++) {
          const x = h.pos.x + Math.cos((a / 16) * Math.PI * 2) * r,
            z = h.pos.z + Math.sin((a / 16) * Math.PI * 2) * r;
          if (g.rtsPowerWhy(0, 'a_lab', x, z) && !g.rtsPowerAt(0, x, z)) {
            px = { x, z };
            break;
          }
        }
      o.relayPt = !!px;
      if (px) {
        o.why0 = g.rtsPowerWhy(0, 'a_lab', px.x, px.z);
        o.relayFar = g.rtsItemUse(h, slot('i_relay'), { x: h.pos.x + 60, z: h.pos.z });
        o.relay = g.rtsItemUse(h, slot('i_relay'), px);
        o.why1 = g.rtsPowerWhy(0, 'a_lab', px.x, px.z);
        window.__sim(61);
        o.why2 = g.rtsPowerWhy(0, 'a_lab', px.x, px.z);
      }
      // 透鏡＋折射：90 × 1.15
      const mt = window.__mk(1, 'c_mt', h.pos.x + 10, h.pos.z);
      h.hero.sk[0] = 1;
      h.hero.cd[0] = 0;
      window.__spy = [];
      g.rtsSkillCast(h, 0, { x: mt.pos.x, z: mt.pos.z });
      window.__sim(0.8);
      const d = (window.__spy.find((s) => s.id === mt.id) || {}).d || 0;
      o.lensDmg = Math.round((d / h.dmgMul) * 10) / 10;
      window.__spy = null;
      ((mt.rtsQuiet = true), mt.die(null));
      return o;
    });
    check(
      it.shelf ===
        'i_kit,i_scout,i_beacon,i_stim,i_sample,i_barrier,i_fcs,i_plate,i_relay,i_lens,i_scope,i_antenna' &&
        it.card === 'QWERAS2D2F2Z2X2C3V3',
      `樣本保管庫的貨架 12 格與卡片（${it.card}）`,
    );
    check(!it.cm && !it.cmCard && !it.neu, `補給商店、中立商店沒有專屬道具`);
    check(
      it.t1 === 5 && it.t2 === 10 && it.t3 === 12 && /T2/.test(it.t1why),
      `貨架依層級：${it.t1}／${it.t2}／${it.t3}（T1 時攜帶式導管：${it.t1why}）`,
    );
    check(
      it.b_i_stim && it.b_i_sample && it.b_i_relay && it.b_i_lens && it.paid.join() === '340,130',
      `買 4 種專屬道具（礦石 ${it.paid[0]}、Coral ${it.paid[1]}）`,
    );
    check(
      /停擺/.test(it.offWhy) && /停擺/.test(it.offWhy2) && !it.offBuy && it.onWhy === '',
      `保管庫停擺時不能買（${it.offWhy}／${it.offWhy2}／${it.offBuy}／恢復後：${it.onWhy || '可以'}）`,
    );
    check(
      it.stim &&
        it.stimSp === 1.25 &&
        it.stimRof === 1.2 &&
        it.stimHp === 8 &&
        it.stimEnd === 1 &&
        it.stimCh === 1,
      `生體興奮劑：速度 ×${it.stimSp}、射速 ×${it.stimRof}、結束扣 ${it.stimHp}% 血量（之後速度 ×${it.stimEnd}）、剩 ${it.stimCh} 次`,
    );
    check(
      it.sample && it.sN === 2 && it.sPop === 0 && it.sT === 45,
      `實驗體樣本：${it.sN} 隻、人口 +${it.sPop}、${it.sT} 秒`,
    );
    check(
      it.relayPt && !!it.why0 && !it.relayFar && it.relay && it.why1 === '' && !!it.why2,
      `攜帶式導管：範圍外（${it.why0}）→ 可以蓋 → 60 秒後又不行；20 m 外不能用`,
    );
    check(
      it.skill === 1.15 && Math.abs(it.lensDmg - 79 * 1.15) < 0.6 /* R6 平衡：折射 1 級 90 → 79 */,
      `聚焦透鏡：技能 ×${it.skill}（折射 ${it.lensDmg}）`,
    );

    // ---------- 截圖：折射、天光陣列、稜鏡屏障、分身、EMP、孵化 ----------
    await ev(() => {
      const g = window.__game,
        F = window.__field;
      const pr = window.__prism,
        cu = window.__cur,
        ve = window.__veil;
      g.rtsHeroShift(pr, F.x, F.z);
      g.rtsHeroShift(cu, F.x + 6, F.z - 8);
      g.rtsHeroShift(ve, F.x - 6, F.z + 8);
      for (const h of [pr, cu, ve]) {
        h.hero.cd = [0, 0, 0, 0];
        h.hero.sk = [1, 1, 0, 1];
        h.hs.stealth = 0;
        h.hs.actT = g.rts.t;
      }
      const foes = [0, 1, 2, 3].map((i) => window.__mk(1, 'c_mt', F.x + 22 + i * 3, F.z + (i % 2) * 4));
      g.rtsSkillCast(pr, 3, { x: F.x + 26, z: F.z + 2 });
      g.rtsSkillCast(pr, 1, cu);
      g.rtsSkillCast(cu, 0);
      g.rtsSkillCast(ve, 0);
      window.__sim(3.3);
      g.rtsSkillCast(pr, 0, { x: foes[0].pos.x, z: foes[0].pos.z });
      g.rtsSkillCast(ve, 1, { x: foes[2].pos.x, z: foes[2].pos.z });
      if (g.rtsCamJump) g.rtsCamJump(F.x + 10, F.z);
      window.__pump(0.75, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3-hero.png') });
    await ctx.close();
  }

  return { testRtsAethHero };
};
