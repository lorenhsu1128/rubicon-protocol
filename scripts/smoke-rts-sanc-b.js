// Coral 戰爭（RTS）R5 B 包（聖域的兵種行為與模型，docs/rts-design.md 16.3、16.5、16.12）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-sanc-b')(H)。
// testRtsSancUnits：聚落中心三階、每個兵種生產、移動、實際 dps（±15%；潛航砲艇在陸上量）；撿零件的層數與上限；釘住（2.5 秒、
// 英雄 1.5、建築不行）；修理無人機（8／12、建築 50%、同一個目標最多 2 台）；布雷（放下、上限 6、自動）；潛航（水深 0.6、開火浮出、
// 速度）；外殼（吃 70%、吸附 +200、上限 400／600）；護盾產生器（展開、外面打不進來、800 打破、15 秒重新展開、移動時收起）；
// 廢鐵重組（每礦石 4 AP、上限 600）；回收拖車（展開、回收點、自己拆、野戰改裝站、移動時收起）；改裝零件與耗時；
// 殘骸的批次（140 個 ≤ 4 個 draw call、依價值縮放、看不到的縮成 0）；全部建築與單一材質合併（每台 ≤ 8 個網格）。
// 截圖 rts-r5-blds.png、rts-r5-units.png、rts-r5-wrecks.png、rts-r5-refit.png。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsSancUnits(browser, base) {
    console.log('Coral 戰爭：聖域的兵種行為、技能、殘骸與建築模型（R5 B 包）');
    const { ctx, page } = await newPage(browser, 'rtsSancUnits');
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
      const R = g.rts,
        w = g.world;
      if (g.rtsFogRevealAll) {
        g.rtsFogRevealAll(0);
        g.rtsFogRevealAll(1);
      }
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          if (g.rtsFogTick) g.rtsFogTick(dt);
        }
        return until && !until() ? -1 : t;
      };
      window.__RD = (id) => g.rtsUiDef(id);
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      window.__spot = (W, D, tol = 1.2) => {
        const nav = w.nav;
        for (let r = 0; r < 180; r += 8)
          for (let a = 0; a < Math.PI * 2; a += r ? 8 / r : 7) {
            const x = Math.cos(a) * r,
              z = Math.sin(a) * r;
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
      window.__bld = (team, def, x, z, p = 1, maxR = 40) => {
        const D = window.__RD(def);
        for (let r = 0; r <= maxR; r += 2)
          for (let a = 0; a < 24; a++) {
            const px = x + Math.cos((a / 24) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 24) * Math.PI * 2) * r;
            if (w.nav.buildable(px, pz, D.foot[0] + 1, D.foot[1] + 1))
              return g.rtsSpawnBld(team, def, px, pz, 0, p);
            if (r === 0) break;
          }
        return null;
      };
      window.__mk = (team, def, x, z, yaw = 0) => g.rtsSpawn(team, def, x, z, yaw);
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
      window.__res = (id, lv = 1) => {
        R.teams[0].tech.res[id] = lv;
        for (const e of R.units) if (!e.dead && e.rtsTeam === 0) g.rtsModsApply(e);
      };
      window.__meshes = (e) => {
        let n = 0;
        e.mesh.traverse((q) => (q.isMesh || q.isSprite) && q.visible && q.layers.mask && n++);
        return n;
      };
      for (const T of R.teams) {
        T.ore = 50000;
        T.coral = 50000;
        T.parts = 150;
      }
      const hq = window.__of(0, 's_hq')[0];
      window.__hq = hq;
      const A = window.__spot(70, 70, 1.5) || window.__spot(60, 60, 2.5) || window.__spot(44, 44, 3);
      window.__A = A;
      return { A, hq: !!hq };
    });
    check(
      !!st.A && st.hq,
      `開局（聖域）、找到測試用的空地（${st.A ? st.A.x.toFixed(0) + ', ' + st.A.z.toFixed(0) : '沒有'}）`,
    );
    if (!st.A) {
      await ctx.close();
      return;
    }

    // ---------- 聚落中心三階＋每個兵種都能生產、移動 ----------
    const prod = await ev(() => {
      const g = window.__game,
        hq = window.__hq,
        A = window.__A;
      const o = { tiers: [] };
      const tv = () => [hq.model.tier, !!hq.model.tier2.visible, !!hq.model.tier3.visible].join('/');
      o.tiers.push(tv());
      const hall = window.__bld(0, 's_hall', A.x - 20, A.z - 20),
        shop = window.__bld(0, 's_shop', A.x + 20, A.z - 20),
        clinic = window.__bld(0, 's_clinic', A.x - 20, A.z + 25);
      g.rtsRecount();
      g.rtsUpgradeDone(hq, 's_hq2');
      o.tiers.push(tv());
      const works = window.__bld(0, 's_works', A.x + 22, A.z + 25);
      g.rtsRecount();
      g.rtsUpgradeDone(hq, 's_hq3');
      o.tiers.push(tv());
      window.__res('r_titan');
      for (let i = 0; i < 6; i++) window.__bld(0, 's_depot', hq.pos.x, hq.pos.z, 1, 60);
      g.rtsRecount();
      o.blds = [hall, shop, clinic, works].map((b) => !!b);
      const want = {
        s_worker: hq,
        s_hauler: hq,
        s_militia: hall,
        s_scav: hall,
        s_rivet: hall,
        s_repair: shop,
        s_mine: shop,
        s_gunboat: works,
        s_junk: works,
        s_dome: works,
        s_colossus: works,
      };
      o.queued = [];
      for (const id in want) if (want[id] && g.rtsQueue(want[id], id)) o.queued.push(id);
      o.t = window.__sim(400, () =>
        Object.keys(want).every((id) => window.__of(0, id).length > (id === 's_worker' ? 5 : 0)),
      );
      o.made = Object.keys(want).filter((id) => window.__of(0, id).length);
      const list = Object.keys(want)
        .filter((id) => id !== 's_worker')
        .map((id) => window.__of(0, id)[0])
        .filter(Boolean);
      window.__units = list;
      const d0 = list.map((e) => Math.hypot(e.pos.x - A.x, e.pos.z - A.z));
      g.rtsOrder(list, { k: 'move', x: A.x - 25, z: A.z + 25 });
      window.__sim(16);
      o.moved = list.filter(
        (e, i) =>
          Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < d0[i] - 8 ||
          Math.hypot(e.pos.x - A.x + 25, e.pos.z - A.z - 25) < 30,
      ).length;
      o.n = list.length;
      if (g.rtsRenderTick) g.rtsRenderTick();
      o.merged = list.filter((e) => e.model.rtsMerged).length;
      o.meshes = {};
      for (const e of list) o.meshes[e.rtsDef] = window.__meshes(e);
      o.kits = list.filter((e) => e.model.rtsRefitKits).length;
      o.dbg = list
        .filter((e) => window.__meshes(e) > 2)
        .map((e) => {
          const L = [];
          e.mesh.traverse((q) => {
            if ((q.isMesh || q.isSprite) && q.visible && q.layers.mask)
              L.push(
                (q.isSkinnedMesh ? 'S' : q.isSprite ? 'P' : 'M') +
                  ':' +
                  (q.material.type || '') +
                  ':' +
                  (q.material.transparent ? 't' : '') +
                  ':' +
                  Object.keys(q.userData).join(',') +
                  ':' +
                  (q.parent && q.parent.name),
              );
          });
          return e.rtsDef + ' ' + L.join(' | ');
        });
      o.haulKit = !!window.__of(0, 's_hauler')[0].model.rtsHaul;
      o.colKit = !!window.__of(0, 's_colossus')[0].model.rtsColossus;
      return o;
    });
    check(
      prod.tiers.join() === '1/false/false,2/true/false,3/true/true',
      `聚落中心三階的外觀：${prod.tiers.join(' → ')}`,
    );
    check(prod.blds.every(Boolean), '集會所、改裝工坊、診療所、回收工廠');
    check(
      prod.made.length === 11 && prod.t > 0,
      `11 種兵種都生產出來（${prod.made.join('、')}；${prod.t.toFixed(0)} 秒）`,
    );
    check(prod.moved === prod.n, `移動指令：${prod.moved}／${prod.n} 台走到了`);
    check(
      prod.merged === prod.n && Object.values(prod.meshes).every((n) => n <= 8),
      `單位都走單一材質合併（網格數 ${JSON.stringify(prod.meshes)}）${JSON.stringify(prod.dbg)}`,
    );
    check(
      prod.kits === prod.n && prod.haulKit && prod.colKit,
      `改裝零件（${prod.kits}／${prod.n} 台）、回收拖車的吊臂、巨像的外加零件`,
    );

    // ---------- 實際 dps ----------
    const dps = await ev(() => {
      const g = window.__game,
        A = window.__A;
      window.__kill(window.__units);
      const res = {};
      const CASES = [
        ['s_militia', 10],
        ['s_scav', 10],
        ['s_rivet', 18],
        ['s_gunboat', 22],
        ['s_junk', 16],
        ['s_colossus', 20],
      ];
      for (const [def, d] of CASES) {
        const tgt = window.__dummy(1, 'c_stomper', A.x, A.z - d / 2);
        const a = window.__mk(0, def, A.x, A.z + d / 2, 0);
        a.rtsAuto = { ab_pin: false, ab_absorb: false, ab_rebuild: false };
        // AI 分批（離鏡頭注視點遠時每 2 格）照常：開火間隔改用局內時間（R5 整合，16.16）之後射速不再少一格
        g.rtsOrder([a], { k: 'attack', id: tgt.id });
        window.__sim(4);
        const hp0 = tgt.hp,
          T = 30;
        const P = g.projectiles;
        let torp = 0,
          other = 0;
        for (let i = 0; i < T * 10; i++) {
          window.__sim(0.1);
          if (P.some((q) => q.owner === a && !q.dead && q.kind === 'torpedo')) torp++;
          if (P.some((q) => q.owner === a && !q.dead && q.kind !== 'torpedo')) other++;
        }
        const k = g.rtsDmgK(g.rtsAtkOf(a, null, null), tgt);
        res[def] = { got: (hp0 - tgt.hp) / T / k, want: window.__RD(def).dps, torp, other };
        window.__kill([a, tgt]);
      }
      return res;
    });
    for (const k in dps)
      check(
        Math.abs(dps[k].got / dps[k].want - 1) <= 0.15,
        `${k} 的實際 dps ${dps[k].got.toFixed(1)}（期望 ${dps[k].want.toFixed(1)}，±15%）`,
      );
    check(
      dps.s_gunboat.torp > 0 && dps.s_gunboat.other === 0,
      `潛航砲艇的魚雷用魚雷的彈體（看到魚雷 ${dps.s_gunboat.torp} 次、其他彈體 ${dps.s_gunboat.other} 次）`,
    );

    // ---------- 空中單位的速度（R5 整合：空中的 0.85 倍不套在 RTS 的空中單位） ----------
    const air = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const e = window.__mk(0, 's_repair', A.x, A.z, 0);
      window.__sim(0.5);
      g.rtsOrder([e], { k: 'move', x: e.pos.x + 60, z: e.pos.z });
      window.__sim(1);
      const x0 = e.pos.x,
        z0 = e.pos.z,
        t0 = R.t;
      window.__sim(2);
      const v = Math.hypot(e.pos.x - x0, e.pos.z - z0) / (R.t - t0);
      window.__kill([e]);
      return { v: +v.toFixed(2), want: window.__RD('s_repair').speed };
    });
    check(Math.abs(air.v / air.want - 1) < 0.05, `修理無人機的移動速度 ${air.v}（定義 ${air.want}）`);

    // ---------- 撿零件、釘住 ----------
    const sk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const sc = window.__mk(0, 's_scav', A.x, A.z);
      sc.updateAI = () => true;
      const dmg0 = sc.dmgMul,
        hp0 = sc.maxHp;
      const vs = [];
      for (let i = 0; i < 7; i++) vs.push(window.__mk(1, 'c_mt', A.x + 4 + i, A.z + 3));
      for (const v of vs) v.die(null);
      window.__sim(0.3);
      o.n = sc.rtsScavN;
      o.dmg = +(sc.dmgMul / dmg0).toFixed(3);
      o.hp = Math.round(sc.maxHp - hp0);
      const far = window.__mk(1, 'c_mt', A.x + 30, A.z);
      const sc2 = window.__mk(0, 's_scav', A.x - 5, A.z);
      far.die(null);
      window.__sim(0.2);
      o.far = sc2.rtsScavN || 0;
      window.__kill([sc, sc2]);
      // 釘住
      const rv = window.__mk(0, 's_rivet', A.x, A.z + 10);
      rv.updateAI = () => true;
      rv.rtsAbI = rv.rtsDef;
      rv.rtsAbInit(window.__RD('s_rivet'));
      const mt = window.__mk(1, 'c_mt', A.x, A.z - 6);
      const c0 = R.teams[0].coral;
      const ok = rv.rtsAbCast('ab_pin', { id: mt.id });
      void ok;
      o.coral = c0 - R.teams[0].coral;
      o.cd = +(rv.rtsCd.ab_pin - R.t).toFixed(1);
      o.pinT = +(mt.rtsPinT - R.t).toFixed(2);
      const p0 = mt.pos.clone();
      g.rtsOrder([mt], { k: 'move', x: A.x + 40, z: A.z - 6 });
      window.__sim(2);
      o.pinMove = +Math.hypot(mt.pos.x - p0.x, mt.pos.z - p0.z).toFixed(2);
      window.__sim(2);
      o.freeMove = +Math.hypot(mt.pos.x - p0.x, mt.pos.z - p0.z).toFixed(2);
      const b = window.__bld(1, 'c_depot', A.x + 30, A.z + 30);
      o.bld = rv.rtsSancPinOk(b);
      const hero = R.units.find((e) => e.hero && !e.dead);
      o.heroT = null;
      {
        const h = window.__mk(1, 'h_bastion', A.x + 6, A.z - 6);
        if (h) {
          h.hero = h.hero || { id: 'h_bastion', inv: [] };
          rv.rtsSancPin(h);
          o.heroT = +(h.rtsPinT - R.t).toFixed(2);
          window.__kill([h]);
        }
      }
      void hero;
      // 自動釘住：交戰中的目標
      rv.rtsCd.ab_pin = 0;
      const mt2 = window.__mk(1, 'c_mt', A.x + 3, A.z - 4);
      delete rv.updateAI;
      rv.rtsAuto.ab_pin = true;
      g.rtsOrder([rv], { k: 'attack', id: mt2.id });
      window.__sim(3, () => mt2.rtsPinT > R.t);
      o.auto = mt2.rtsPinT > R.t;
      window.__kill([rv, mt, mt2, b]);
      return o;
    });
    check(
      sk.n === 5 && sk.dmg === 1.25 && sk.hp === 125,
      `撿零件：5 層（上限）、傷害 ×${sk.dmg}、最大血量 +${sk.hp}`,
    );
    check(sk.far === 0, '12 m 外陣亡的不算');
    check(
      sk.coral === 5 && sk.pinT === 2.5 && sk.pinMove < 0.5 && sk.freeMove > 3 && sk.cd === 12,
      `釘住：Coral 5、2.5 秒不能移動（${sk.pinMove} m → 之後 ${sk.freeMove} m）、冷卻 ${sk.cd}`,
    );
    check(sk.bld === false && sk.heroT === 1.5, `釘住：建築不行、英雄 ${sk.heroT} 秒`);
    check(sk.auto, '自動釘住交戰中的目標');

    // ---------- 修理無人機、布雷 ----------
    const rp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const mt = window.__mk(0, 's_militia', A.x, A.z);
      mt.updateAI = () => true;
      mt.hp = mt.maxHp * 0.3;
      const d = window.__mk(0, 's_repair', A.x + 3, A.z);
      g.rtsOrder([d], { k: 'hold' });
      window.__sim(1);
      let h0 = mt.hp;
      window.__sim(5);
      o.rate = +((mt.hp - h0) / 5).toFixed(2);
      window.__res('r_mend');
      h0 = mt.hp;
      window.__sim(5);
      o.rateRes = +((mt.hp - h0) / 5).toFixed(2);
      window.__res('r_mend', 0);
      window.__kill([mt]);
      // 建築 50%
      const b = window.__bld(0, 's_yard', A.x + 4, A.z + 4);
      b.hp = b.maxHp * 0.3;
      d.pos.set(b.pos.x + 6, d.pos.y, b.pos.z);
      window.__sim(1);
      h0 = b.hp;
      window.__sim(4);
      o.bld = +((b.hp - h0) / 4).toFixed(2);
      window.__kill([b]);
      // 同一個目標最多 2 台
      const t = window.__mk(0, 's_militia', A.x - 10, A.z);
      t.updateAI = () => true;
      t.maxHp = t.hp = 5000;
      t.hp = 100;
      const ds = [d, window.__mk(0, 's_repair', A.x - 8, A.z), window.__mk(0, 's_repair', A.x - 12, A.z)];
      for (const q of ds) {
        q.pos.set(A.x - 10 + Math.random(), q.pos.y, A.z + 2);
      }
      window.__sim(1.5);
      o.healers = ds.filter((q) => q.rtsSanc.rep.tgt === t.id).length;
      // 專心修理
      const f = window.__mk(0, 's_militia', A.x + 14, A.z + 2);
      f.updateAI = () => true;
      f.hp = f.maxHp * 0.5;
      ds[2].rtsSanc.rep.focus = null;
      g.rtsOrder([ds[2]], { k: 'ability', ab: 'ab_focus', id: f.id });
      for (let i = 0; i < 14; i++) {
        window.__sim(0.5);
      }
      o.focusD = +Math.hypot(ds[2].pos.x - f.pos.x, ds[2].pos.z - f.pos.z).toFixed(1);
      o.focus = ds[2].rtsSanc.rep.tgt === f.id && o.focusD < 9;
      window.__kill([t, f, ...ds]);
      // 布雷
      const ml = window.__mk(0, 's_mine', A.x, A.z);
      window.__sim(0.2);
      const n0 = R.lmines.length;
      g.rtsOrder([ml], { k: 'ability', ab: 'ab_mine', x: A.x + 4, z: A.z });
      window.__sim(1);
      o.mine = R.lmines.length - n0;
      o.mineFx = !!(R.lmines[R.lmines.length - 1].fx && R.lmines[R.lmines.length - 1].fx.i >= 0);
      ml.rtsAuto.ab_mine = true;
      window.__sim(40);
      o.auto = R.lmines.filter((m) => m.owner === ml.id).length;
      o.autoOff = window.__RD('s_mine') && !ml.rtsAuto.undefined;
      window.__kill([ml]);
      return o;
    });
    check(
      Math.abs(rp.rate - 8) < 0.6 && Math.abs(rp.rateRes - 12) < 0.8,
      `修理無人機：${rp.rate}／${rp.rateRes} AP／秒（8／12）`,
    );
    check(Math.abs(rp.bld - 4) < 0.5, `修理建築 50%（${rp.bld} AP／秒）`);
    check(rp.healers === 2, `同一個目標最多 2 台（${rp.healers}）`);
    check(rp.focus, `專心修理：跟著指定的對象（${rp.focusD} m）`);
    check(rp.mine === 1 && rp.mineFx, '布雷：放下一顆地雷（外觀）');
    check(rp.auto === 6, `自動布雷：補到上限 6 顆（${rp.auto}）`);

    // ---------- 潛航、外殼、圓頂、重組 ----------
    const ab = await ev(() => {
      const g = window.__game,
        R = g.rts,
        w = g.world,
        A = window.__A;
      const o = {};
      // 潛航：在測試點放一片假的水面（水深 2 m）
      const W0 = w.theme.water;
      w.theme.water = { level: w.terrainHeight(A.x, A.z) + 2, color: 0x406070, opacity: 0.6 };
      const gb = window.__mk(0, 's_gunboat', A.x, A.z);
      window.__sim(3);
      o.sub = !!gb.rtsSub;
      o.subSpeed = +(gb.rtsM.speed || 1).toFixed(2);
      const tg = window.__dummy(1, 'c_stomper', A.x, A.z - 20);
      g.rtsOrder([gb], { k: 'attack', id: tg.id });
      window.__sim(2, () => !gb.rtsSub);
      o.surface = !gb.rtsSub;
      window.__kill([gb, tg]);
      w.theme.water = W0;
      // 外殼
      const jk = window.__mk(0, 's_junk', A.x, A.z);
      jk.updateAI = () => true;
      jk.rtsAbI = jk.rtsDef;
      jk.rtsAbInit(window.__RD('s_junk'));
      o.shell0 = jk.rtsSanc.shell;
      const hp0 = jk.hp;
      jk._rtsAtk = 'en';
      jk.takeDamage(100, 0, null, null, null);
      const kk = g.rtsDmgK('en', jk);
      o.shellTake = +((o.shell0 - jk.rtsSanc.shell) / (100 * kk)).toFixed(2);
      o.hpTake = +((hp0 - jk.hp) / (100 * kk)).toFixed(2);
      jk.rtsSanc.shell = 50;
      delete jk.updateAI;
      g.rtsWreckSpawn(A.x + 3, A.z, { ore: 120, parts: 4 });
      window.__sim(1.5);
      o.absorb = Math.round(jk.rtsSanc.shell);
      window.__res('r_hull');
      window.__sim(0.1);
      o.max = jk.rtsSanc.shellMax;
      window.__res('r_hull', 0);
      window.__kill([jk]);
      // 圓頂
      const dm = window.__mk(0, 's_dome', A.x, A.z);
      const ally = window.__mk(0, 's_militia', A.x + 3, A.z);
      ally.updateAI = () => true;
      const foe = window.__mk(1, 'c_mt', A.x + 25, A.z);
      foe.updateAI = () => true;
      g.rtsOrder([dm], { k: 'ability', ab: 'ab_dome' });
      window.__sim(1.0);
      o.deploying = dm.rtsSanc.dome.st;
      window.__sim(1.0);
      const rec = dm.rtsSanc.dome.rec;
      o.on = dm.rtsSanc.dome.st === 'on' && !!rec;
      const a0 = ally.hp;
      g.rtsHit(ally, 300, 0, foe, 'kin');
      o.blocked = a0 - ally.hp;
      o.domeHp = Math.round(rec.hp);
      const near = window.__mk(1, 'c_mt', A.x + 4, A.z + 2);
      near.updateAI = () => true;
      const a1 = ally.hp;
      g.rtsHit(ally, 50, 0, near, 'kin');
      o.inside = a1 - ally.hp > 0;
      g.rtsHit(ally, 2000, 0, foe, 'kin');
      o.broken = rec.reT > 0 ? +(rec.reT - R.t).toFixed(1) : 0;
      window.__sim(15.2);
      o.back = rec.hp === rec.max && !rec.reT;
      g.rtsOrder([dm], { k: 'move', x: A.x + 20, z: A.z + 20 });
      window.__sim(1);
      o.packed = dm.rtsSanc.dome.st !== 'on' && !dm.rtsSanc.dome.rec;
      window.__kill([dm, ally, foe, near]);
      // 重組
      const co = window.__mk(0, 's_colossus', A.x, A.z);
      co.updateAI = () => true;
      co.rtsAbI = co.rtsDef;
      co.rtsAbInit(window.__RD('s_colossus'));
      co.hp = co.maxHp * 0.4;
      for (let i = 0; i < 4; i++)
        g.rtsWreckSpawn(A.x + Math.cos(i * 1.6) * 6, A.z + Math.sin(i * 1.6) * 6, { ore: 100, parts: 4 });
      const h0 = co.hp;
      o.rebuildOk = co.rtsAbCast('ab_rebuild') !== false;
      o.healed = Math.round(co.hp - h0);
      window.__kill([co]);
      return o;
    });
    check(ab.sub && ab.subSpeed === 1.3, `潛航：水深 0.6 以上、2 秒沒開火（速度 ×${ab.subSpeed}）`);
    check(ab.surface, '潛航：開火時浮出');
    check(
      ab.shell0 === 400 && Math.abs(ab.shellTake - 0.7) < 0.03 && Math.abs(ab.hpTake - 0.3) < 0.03,
      `外殼 400：吃掉 ${ab.shellTake}、本體 ${ab.hpTake}`,
    );
    check(ab.absorb === 250 && ab.max === 600, `吸附殘骸 +200（${ab.absorb}）、研究後上限 ${ab.max}`);
    check(ab.deploying === 'deploying' && ab.on, '護盾產生器：展開 1.5 秒');
    check(
      ab.blocked === 0 && ab.domeHp < 800 && ab.inside,
      `圓頂：外面打進來全吸收（剩 ${ab.domeHp}）、裡面的照打`,
    );
    check(ab.broken > 14 && ab.back, `圓頂打破後 ${ab.broken} 秒重新展開`);
    check(ab.packed, '收到移動指令時收起');
    check(ab.healed === 600, `廢鐵重組：一次回 ${ab.healed} AP（上限 600）`);

    // ---------- 回收拖車、改裝零件 ----------
    const hl = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      for (const w of R.wrecks.slice()) if (!w.map) g.rtsWreckRemove(w);
      const h = window.__mk(0, 's_hauler', A.x, A.z);
      g.rtsOrder([h], { k: 'ability', ab: 'ab_haul' });
      window.__sim(2.3);
      o.on = !!h.rtsHaulOn;
      o.drop = g.rtsDropoff(0, A.x + 2, A.z + 2) === h;
      o.station = g.rtsRefitStations(0).some((s) => s.e === h);
      const w0 = g.rtsWreckSpawn(A.x + 5, A.z, { ore: 100, parts: 10 });
      const ore0 = R.teams[0].ore,
        p0 = R.teams[0].parts;
      window.__sim(5.2);
      o.took = 100 - w0.ore;
      o.gotParts = R.teams[0].parts - p0;
      o.gotOre = Math.round(R.teams[0].ore - ore0);
      g.rtsOrder([h], { k: 'move', x: A.x + 20, z: A.z });
      window.__sim(1.5);
      o.packed = !h.rtsHaulOn && h.rtsSanc.haul.st !== 'on';
      window.__kill([h]);
      // 改裝零件
      const m = window.__mk(0, 's_militia', A.x, A.z);
      window.__sim(0.1);
      if (g.rtsRenderTick) g.rtsRenderTick();
      const n0 = window.__meshes(m);
      g.rtsRefitApply(m, 'rf_scope');
      o.ms = R.refitFxMs;
      o.kit = !!m.model.rtsRefitKits.rf_scope.visible;
      g.rtsRefitApply(m, 'rf_gun');
      o.swap = !m.model.rtsRefitKits.rf_scope.visible && !!m.model.rtsRefitKits.rf_gun.visible;
      o.meshes = [n0, window.__meshes(m)];
      window.__kill([m]);
      return o;
    });
    check(hl.on && hl.drop && hl.station, '回收拖車：展開 2 秒＝回收點、野戰改裝站');
    check(hl.took === 30 && hl.gotParts === 3, `回收拖車自己拆：30 礦石（${hl.took}）、零件 ${hl.gotParts}`);
    check(hl.packed, '回收拖車：移動時收起');
    check(hl.kit && hl.swap && hl.ms < 6, `改裝零件：顯示、換掉（${hl.ms.toFixed(3)} ms，< 6 ms）`);
    check(hl.meshes[0] === hl.meshes[1], `改裝不增加網格（${hl.meshes.join(' → ')}）`);

    // ---------- 殘骸的批次 ----------
    const wr = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      for (const w of R.wrecks.slice()) if (!w.map) g.rtsWreckRemove(w);
      for (let i = 0; i < 140; i++) {
        // 5 m 的格子（4 m 內會合併）
        g.rtsWreckSpawn(A.x - 27.5 + (i % 12) * 5, A.z - 27.5 + Math.floor(i / 12) * 5, {
          ore: 20 + ((i * 37) % 300),
          parts: 4,
          size: i % 12 === 0 ? 3 : undefined,
          team: i % 3 === 0 ? 1 : 0,
        });
      }
      window.__sim(1);
      g.rtsSancWreckTick(0.1);
      o.n = R.wrecks.filter((w) => !w.map).length;
      o.calls = g.rtsSancWreckCalls();
      // 依價值縮放：拿走一半
      const w = R.wrecks.find((q) => !q.map && q.ore >= 200 && q.size === 2);
      const s0 = w.fx.sc;
      g.rtsWreckTake(w, w.ore / 2);
      o.scale = [+s0.toFixed(2), +w.fx.sc.toFixed(2)];
      // 沒看過的縮成 0
      const u = R.wrecks.find((q) => !q.map);
      u.seen = 0;
      g.rtsSancWreckFx(u, 'set');
      o.unseen = u.fx.sc;
      u.seen = 1;
      g.rtsSancWreckFx(u, 'seen');
      // 拆完沉下去後釋放
      const z = R.wrecks.find((q) => !q.map && q !== w);
      g.rtsWreckTake(z, 1e9);
      for (let i = 0; i < 20; i++) (g.rtsSancWreckTick(0.05), (R.t += 0.05));
      o.freed = z.fx.s === -1;
      // 截圖
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 4);
      if (g.rts.cam) g.rts.cam.dist = 70;
      window.__pump(0.5, null, 1 / 30);
      return o;
    });
    check(wr.n === 140 && wr.calls <= 4, `140 個殘骸 ${wr.calls} 個 draw call（≤ 4）`);
    check(wr.scale[1] < wr.scale[0] && wr.scale[1] >= 0.4, `依價值縮放（${wr.scale.join(' → ')}）`);
    check(wr.unseen === 0, '玩家沒看過的殘骸縮成 0');
    check(wr.freed, '拆完的殘骸沉下去、釋放實例');
    await shot('rts-r5-wrecks.png');

    // ---------- 截圖：改裝零件 ----------
    await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      for (const w of R.wrecks.slice()) if (!w.map) g.rtsWreckRemove(w);
      window.__sim(1);
      const IDS = ['rf_plate', 'rf_gun', 'rf_aa', 'rf_boost', 'rf_bomb', 'rf_scope'];
      window.__refit = IDS.map((rf, i) => {
        const e = window.__mk(0, 's_militia', A.x - 10 + i * 4, A.z, Math.PI * 0.85);
        e.updateAI = () => true;
        g.rtsRefitApply(e, rf);
        return e;
      });
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 1);
      if (g.rts.cam) g.rts.cam.dist = 26;
      window.__pump(0.5, null, 1 / 30);
    });
    await shot('rts-r5-refit.png');

    // ---------- 截圖：全部建築與兵種 ----------
    const lay = await ev(() => {
      const g = window.__game,
        A = window.__A;
      window.__kill(
        g.rts.units.filter(
          (e) =>
            !e.dead && e.rtsTeam === 0 && e !== window.__hq && Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < 75,
        ),
      );
      const IDS = [
        's_hq',
        's_hq2',
        's_hq3',
        's_depot',
        's_hall',
        's_extractor',
        's_yard',
        's_shop',
        's_clinic',
        's_tower',
        's_barricade',
        's_market',
        's_works',
      ];
      const made = [];
      let x = A.x - 46,
        row = 0;
      for (const id of IDS) {
        const D = window.__RD(id);
        if (x + D.foot[0] > A.x + 46) {
          x = A.x - 46;
          row++;
        }
        const b = g.rtsSpawnBld(0, id, x + D.foot[0] / 2, A.z - 20 + row * 22, 0, 1);
        if (b) made.push(b);
        x += D.foot[0] + 4;
      }
      const site = g.rtsSpawnBld(0, 's_hall', A.x + 34, A.z + 36, 0, 0.4);
      made.push(site);
      window.__blds = made;
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 6);
      if (g.rts.cam) g.rts.cam.dist = 116;
      if (g.rtsRenderTick) g.rtsRenderTick();
      window.__pump(0.5, null, 1 / 30);
      const bar = made.find((b) => b.rtsDef === 's_barricade');
      return {
        n: made.length,
        tiers: made.filter((b) => b.model.setTier).map((b) => b.model.tier),
        site: !!site.model.scaf.visible,
        sanc: made.every((b) => b.model.sancta),
        merged: made.filter((b) => b.model.rtsMerged).length,
        meshes: Math.max(...made.map((b) => window.__meshes(b))),
        bar: bar ? !!bar.model.picked : false,
        tower: !!made.find((b) => b.rtsDef === 's_tower').model.turret,
      };
    });
    check(lay.n === 14 && lay.sanc, `全部建築（${lay.n} 座，聖域的模型）`);
    check(lay.tiers.join() === '1,2,3', `聚落中心三階（${lay.tiers.join('、')}）`);
    check(lay.site, '施工中：木架＋帆布');
    check(
      lay.merged === lay.n && lay.meshes <= 8,
      `建築都走單一材質合併（${lay.merged}／${lay.n}，最多 ${lay.meshes} 個網格）`,
    );
    check(lay.bar && lay.tower, '廢鐵路障依位置選外觀、瞭望塔的砲塔');
    await shot('rts-r5-blds.png');
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      for (const b of window.__blds) {
        b.rtsQuiet = true;
        b.die(null);
      }
      window.__sim(4);
      const IDS = [
        's_worker',
        's_hauler',
        's_militia',
        's_scav',
        's_rivet',
        's_repair',
        's_mine',
        's_gunboat',
        's_junk',
        's_dome',
        's_colossus',
      ];
      IDS.forEach((id, i) => {
        const e = window.__mk(0, id, A.x - 30 + (i % 6) * 12, A.z - 8 + Math.floor(i / 6) * 16, Math.PI);
        e.updateAI = () => true;
        if (id === 's_hauler' && e.model.setHaul) e.model.setHaul(1);
      });
      window.__sim(0.2);
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 3);
      if (g.rts.cam) g.rts.cam.dist = 62;
      window.__pump(0.6, null, 1 / 30);
    });
    await shot('rts-r5-units.png');
    await ctx.close();
  }

  return { testRtsSancUnits };
};
