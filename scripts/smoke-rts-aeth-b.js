// Coral 戰爭（RTS）R3 B 包（艾瑟立克的兵種行為與模型，docs/rts-design.md 14.3、14.5、14.12）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-aeth-b')(H)。
// testRtsAethUnits：每個兵種的生產、移動、開火（近戰也算）與實際 dps；纏附（撲上、持續傷害、緩速、8 秒、建築與空中不能纏、
// 寄生孵化）；投影（3／5 個、打一下消失、敵方會打它）；過載與硬直；共振砲的導管射程與最短射程；浮游砲機只被對空打、
// 浮游砲展開；吞噬；共鳴光環；雷射網的警報；斷電的外觀；融合的引導外觀；導管連線（一隊一個網格）；單位走單一材質合併；
// 截圖 rts-r3-blds.png、rts-r3-units.png、rts-r3-conduit.png、rts-r3-fuse.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim 快轉。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsAethUnits(browser, base) {
    console.log('Coral 戰爭：艾瑟立克的兵種行為、技能、雷射網與建築模型（R3 B 包）');
    const { ctx, page } = await newPage(browser, 'rtsAethUnits');
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
      g.rtsCampsOff = true;
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'aetheric',
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
        }
        return until && !until() ? -1 : t;
      };
      window.__RD = (id) => g.rtsUiDef(id);
      window.__of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
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
      // 有電又可以蓋的位置（從 (x, z) 往外找）
      window.__pbld = (team, def, x, z, p = 1, maxR = 30) => {
        const D = window.__RD(def);
        const nav = w.nav;
        for (let r = 0; r <= maxR; r += 1)
          for (let a = 0; a < 36; a++) {
            const px = x + Math.cos((a / 36) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 36) * Math.PI * 2) * r;
            if (nav.buildable(px, pz, D.foot[0] + 1, D.foot[1] + 1) && !g.rtsPowerWhy(team, def, px, pz))
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
      for (const T of R.teams) {
        T.ore = 50000;
        T.coral = 50000;
      }
      const hq = window.__of(0, 'a_hq')[0];
      window.__hq = hq;
      const A = window.__spot(70, 70, 1.5) || window.__spot(60, 60, 2.5) || window.__spot(44, 44, 3);
      window.__A = A;
      // 測試用的空地不在導管範圍裡（導管上的加成會改速度與回血）
      return { A, hq: !!hq, inGrid: A ? !!g.rtsPowerAt(0, A.x, A.z) : true };
    });
    check(
      !!st.A && st.hq && !st.inGrid,
      `開局、找到測試用的空地（${st.A ? st.A.x.toFixed(0) + ', ' + st.A.z.toFixed(0) : '沒有'}，不在導管範圍）`,
    );
    if (!st.A) {
      await ctx.close();
      return;
    }

    // ---------- 研究中樞三階＋每個兵種都能生產、移動 ----------
    const prod = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = { tiers: [] };
      const tv = () => [hq.model.tier, !!hq.model.tier2.visible, !!hq.model.tier3.visible].join('/');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'a_hq2');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'a_hq3');
      o.tiers.push(tv());
      o.tier = g.rtsTier(0);
      const at = (d) => {
        const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
        return { x: hq.pos.x - (hq.pos.x / L) * d, z: hq.pos.z - (hq.pos.z / L) * d };
      };
      const c = at(20);
      // 人口：導管節點 +8／座
      for (let i = 0; i < 3; i++) window.__pbld(0, 'a_node', hq.pos.x, hq.pos.z, 1, 30);
      g.rtsRecount();
      const lab = window.__pbld(0, 'a_lab', c.x, c.z),
        fd = window.__pbld(0, 'a_foundry', c.x, c.z),
        hg = window.__pbld(0, 'a_hangar', c.x, c.z);
      o.blds = [lab, fd, hg].map((b) => !!b && !b.bld.off);
      const want = {
        a_blob: lab,
        a_parasite: lab,
        a_laser: fd,
        a_holo: fd,
        a_beam: fd,
        a_reson: fd,
        a_bit: hg,
      };
      o.queued = [];
      for (const id in want) if (want[id] && g.rtsQueue(want[id], id)) o.queued.push(id);
      o.t = window.__sim(240, () => Object.keys(want).every((id) => window.__of(0, id).length));
      o.made = Object.keys(want).filter((id) => window.__of(0, id).length);
      const bit = window.__of(0, 'a_bit')[0];
      o.bitY = bit ? bit.pos.y - g.world.terrainHeight(bit.pos.x, bit.pos.z) : -1;
      // 移動：全部走到測試空地旁
      const A = window.__A;
      const list = Object.keys(want).flatMap((id) => window.__of(0, id));
      const d0 = list.map((e) => Math.hypot(e.pos.x - A.x, e.pos.z - A.z));
      g.rtsOrder(list, { k: 'move', x: A.x + 25, z: A.z + 25 });
      window.__sim(12);
      o.moved = list.filter(
        (e, i) =>
          Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < d0[i] - 10 ||
          Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < 40,
      ).length;
      o.n = list.length;
      // 單位走單一材質合併（render/rts-merge.js）：實驗體類的模型也是
      if (g.rtsRenderTick) g.rtsRenderTick();
      o.merged = list.filter((e) => e.model.rtsMerged).map((e) => e.rtsDef);
      o.meshes = {};
      for (const e of list) {
        let n = 0;
        e.mesh.traverse((q) => (q.isMesh || q.isSprite) && q.visible && q.layers.mask && n++);
        o.meshes[e.rtsDef] = n;
      }
      // 動作的發光脈動（rts-merge.js 的 rtsPulse：lit_d2 改的材質強度以 uniform 重現）
      o.pulse = [];
      const blob = list.find((e) => e.rtsDef === 'a_blob');
      let pm = null;
      if (blob)
        blob.mesh.traverse((q) => q.isSkinnedMesh && q.material.rtsPulseU && q.onBeforeRender && (pm = q));
      if (pm)
        for (let i = 0; i < 8; i++) {
          window.__sim(0.15);
          blob.specialFx(0.15);
          pm.onBeforeRender();
          o.pulse.push(+pm.material.rtsPulseU.value.x.toFixed(3));
        }
      window.__kill(list);
      return o;
    });
    check(
      prod.tiers.join() === '1/false/false,2/true/false,3/true/true' && prod.tier === 3,
      `研究中樞三階的外觀：${prod.tiers.join(' → ')}`,
    );
    check(prod.blds.every(Boolean), '培養槽、兵器廠、格納庫蓋在有電的地方');
    check(
      prod.made.length === 7 && prod.t > 0,
      `7 種生產的兵種都生產出來（${prod.made.join('、')}；${prod.t.toFixed(0)} 秒）`,
    );
    check(prod.bitY > 4, `浮游砲機在空中（離地 ${prod.bitY.toFixed(1)} m）`);
    check(prod.moved === prod.n, `移動指令：${prod.moved}／${prod.n} 台走到了`);
    check(
      prod.merged.length === prod.n && Object.values(prod.meshes).every((n) => n <= 8),
      `單位都走單一材質合併（網格數 ${JSON.stringify(prod.meshes)}）`,
    );
    check(
      prod.pulse.length && new Set(prod.pulse).size > 1,
      `實驗體合併後的發光仍會脈動（強度 ${prod.pulse.join('、')}）`,
    );

    // ---------- 實際 dps（近戰也算） ----------
    const dps = await ev(() => {
      const g = window.__game,
        A = window.__A;
      const res = {};
      const CASES = [
        ['a_blob', 2],
        ['a_parasite', 2],
        ['a_laser', 18],
        ['a_holo', 16],
        ['a_beam', 20],
        ['a_chimera', 3],
        ['a_reson', 30],
        ['a_bit', 18],
        ['a_proto', 4],
      ];
      for (const [def, d] of CASES) {
        const tgt = window.__dummy(1, 'c_stomper', A.x, A.z - d / 2);
        const a = window.__mk(0, def, A.x, A.z + d / 2, 0);
        a.rtsAuto = { ab_latch: false }; // 只量攻擊
        g.rtsOrder([a], { k: 'attack', id: tgt.id });
        window.__sim(4);
        const hp0 = tgt.hp,
          T = 24;
        window.__sim(T);
        const k = g.rtsDmgK(g.rtsAtkOf(a, null, null), tgt);
        res[def] = {
          got: (hp0 - tgt.hp) / T / k,
          want: window.__RD(def).dps,
          hits: a.rtsAeth ? a.rtsAeth.hits : 0,
        };
        window.__kill([a, tgt]);
      }
      return res;
    });
    for (const k in dps) {
      const r = dps[k];
      check(
        r.got >= r.want * 0.85 && r.got <= r.want * 1.15,
        `${k} 的實際 dps ${r.got.toFixed(1)}（定義 ${r.want}${r.hits ? '、近戰 ' + r.hits + ' 下' : ''}）`,
      );
    }

    // ---------- 嵌合體的範圍啃咬 ----------
    const spl = await ev(() => {
      const g = window.__game,
        A = window.__A;
      const t1 = window.__dummy(1, 'c_mt', A.x, A.z - 1.5),
        t2 = window.__dummy(1, 'c_mt', A.x + 2.6, A.z - 1.5);
      const c = window.__mk(0, 'a_chimera', A.x, A.z + 3, 0);
      g.rtsOrder([c], { k: 'attack', id: t1.id });
      window.__sim(6);
      const o = { d1: 1e6 - t1.hp, d2: 1e6 - t2.hp };
      window.__kill([c, t1, t2]);
      return o;
    });
    check(
      spl.d1 > 0 && spl.d2 > 0 && spl.d2 < spl.d1 * 0.75,
      `嵌合體：範圍啃咬（目標 ${spl.d1.toFixed(0)}、旁邊 ${spl.d2.toFixed(0)}）`,
    );

    // ---------- 纏附 ----------
    const lat = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      const t = window.__dummy(1, 'c_mt', A.x, A.z - 3);
      const p = window.__mk(0, 'a_parasite', A.x, A.z + 3, 0);
      g.rtsOrder([p], { k: 'attack', id: t.id });
      window.__sim(0.25);
      o.auto = !!(p.rtsAuto && p.rtsAuto.ab_latch);
      o.leap = !!(p.rtsAeth && p.rtsAeth.leap);
      window.__sim(0.5);
      o.latched = !!(p.rtsAeth && p.rtsAeth.latch);
      o.by = t.rtsLatchBy === p;
      o.dist = Math.hypot(p.pos.x - t.pos.x, p.pos.z - t.pos.z);
      o.speed = t.rtsM.speed;
      o.rofK = t.rtsRofK;
      const h0 = t.hp;
      p.rtsAuto.ab_latch = false; // 之後不再自動施放（量持續傷害與結束）
      window.__sim(4);
      o.dot = (h0 - t.hp) / 4;
      window.__sim(4.5);
      o.ended = !(p.rtsAeth && p.rtsAeth.latch);
      o.speed2 = t.rtsM.speed;
      o.cd = Math.round(p.rtsCd.ab_latch - R.t);
      window.__kill([p, t]);
      // 建築、空中單位不能纏
      const b = window.__of(1, 'c_hq')[0];
      const heli = window.__dummy(1, 'c_heli', A.x, A.z - 4);
      const p2 = window.__mk(0, 'a_parasite', A.x, A.z + 2, 0);
      p2.rtsAuto = { ab_latch: false };
      o.bld = p2.rtsAethLatchOk(b);
      o.air = p2.rtsAethLatchOk(heli);
      g.rtsOrder([p2], { k: 'ability', ab: 'ab_latch', id: heli.id });
      window.__sim(1);
      o.airLatch = !!(p2.rtsAeth && (p2.rtsAeth.latch || p2.rtsAeth.leap));
      window.__kill([p2, heli]);
      // 寄生孵化：纏附中的目標死亡 → 原地一隻實驗體
      window.__res('r_brood');
      const weak = window.__mk(1, 'c_mt', A.x, A.z - 3, 0);
      weak.updateAI = () => true;
      weak.hp = 20;
      const p3 = window.__mk(0, 'a_parasite', A.x, A.z + 3, 0);
      const n0 = window.__of(0, 'a_blob').length;
      g.rtsOrder([p3], { k: 'attack', id: weak.id });
      window.__sim(6);
      o.weakDead = weak.dead;
      o.brood = window.__of(0, 'a_blob').length - n0;
      window.__kill([p3, ...window.__of(0, 'a_blob')]);
      return o;
    });
    check(
      lat.auto && lat.leap && lat.latched && lat.by,
      '纏附：自動施放（預設開）、撲上 0.4 秒、黏在目標身上',
    );
    check(lat.dist < 2, `纏附：跟著目標（距離 ${lat.dist.toFixed(2)} m）`);
    check(
      Math.abs(lat.speed - 0.7) < 0.01 && Math.abs(lat.rofK - 1.25) < 0.02,
      `纏附：目標速度 ×${lat.speed}、開火間隔 ×${lat.rofK.toFixed(2)}`,
    );
    check(Math.abs(lat.dot - 16) < 3, `纏附：每秒 ${lat.dot.toFixed(1)} 傷害（定義 16，不看護甲）`);
    check(lat.ended && lat.speed2 === 1, `纏附：8 秒後放開、緩速消失（冷卻剩 ${lat.cd} 秒）`);
    check(!lat.bld && !lat.air && !lat.airLatch, '纏附：建築、空中單位不能纏');
    check(lat.weakDead && lat.brood === 1, `寄生孵化：纏附中的目標死亡時出現 ${lat.brood} 隻實驗體`);

    // ---------- 投影 ----------
    const dec = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      const holo = window.__mk(0, 'a_holo', A.x, A.z + 8, 0);
      const ally = window.__mk(0, 'a_laser', A.x, A.z, 0);
      g.rtsOrder([ally], { k: 'hold' });
      const c0 = R.teams[0].coral;
      const n0 = g.rtsIllusionsOf(0).length;
      g.rtsOrder([holo], { k: 'ability', ab: 'ab_decoy', id: ally.id });
      window.__sim(0.3);
      const L = g.rtsIllusionsOf(0);
      o.n = L.length - n0;
      o.coral = c0 - R.teams[0].coral;
      o.hp = L.map((e) => e.maxHp);
      o.def = L.map((e) => e.rtsDef);
      o.t = Math.round(L[0].rtsIllus.t - R.t);
      // 敵方的單位會打它（打一下就消失）
      // 敵人放在第一個幻象的外側 12 m（最近的目標是幻象，不是本尊）
      // 本尊與投影器不開火（否則敵人會回擊它們）
      ally.rtsRangeAdd = holo.rtsRangeAdd = -100;
      const q = L[0];
      const dx = q.pos.x - ally.pos.x,
        dz = q.pos.z - ally.pos.z,
        dl = Math.hypot(dx, dz) || 1;
      const foe = window.__mk(1, 'c_mt', q.pos.x + (dx / dl) * 12, q.pos.z + (dz / dl) * 12, 0);
      o.scan = foe.rtsHostileOk(q);
      foe.maxHp = foe.hp = 1e6;
      g.rtsOrder([foe], { k: 'hold' });
      window.__sim(6);
      o.gone = L.filter((e) => e.dead).length;
      window.__kill([foe, ...g.rtsIllusionsOf(0)]);
      // 投影強化：5 個、25 秒
      window.__res('r_holo');
      holo.rtsCd = {};
      g.rtsOrder([holo], { k: 'ability', ab: 'ab_decoy', id: ally.id });
      window.__sim(0.3);
      const L2 = g.rtsIllusionsOf(0);
      o.n2 = L2.length;
      o.t2 = L2.length ? Math.round(L2[0].rtsIllus.t - R.t) : 0;
      o.sight = holo.rtsVision;
      window.__kill([holo, ally, ...L2]);
      return o;
    });
    check(
      dec.n === 3 &&
        Math.abs(dec.coral - 20) < 0.5 &&
        dec.hp.every((h) => h === 1) &&
        dec.def.every((d) => d === 'a_laser'),
      `投影：3 個幻象（血量 1、同外觀）、Coral ${dec.coral.toFixed(0)}、${dec.t} 秒`,
    );
    check(dec.scan && dec.gone >= 1, `投影：敵方的單位會打幻象（打掉 ${dec.gone} 個）`);
    check(dec.n2 === 5 && dec.t2 === 25, `投影強化：${dec.n2} 個、${dec.t2} 秒；投影器視野 ${dec.sight}`);

    // ---------- 過載 ----------
    const oc = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const b = window.__mk(0, 'a_beam', A.x, A.z, 0);
      window.__sim(0.2);
      o.why = b.rtsAbWhy('ab_overcharge');
      window.__res('r_overload');
      o.why2 = b.rtsAbWhy('ab_overcharge');
      const k0 = b.rtsRofK;
      g.rtsOrder([b], { k: 'ability', ab: 'ab_overcharge' });
      window.__sim(0.3);
      o.rof = k0 / b.rtsRofK;
      window.__sim(4.6);
      o.stag0 = b.staggerT;
      window.__sim(0.4);
      o.stag1 = b.staggerT;
      o.rofAfter = b.rtsRofK;
      window.__sim(2.2);
      o.stag2 = b.staggerT;
      window.__kill([b]);
      return o;
    });
    check(/過載|能量過載|研究/.test(oc.why) && oc.why2 === '', `過載：要研究能量過載（${oc.why}）`);
    check(Math.abs(oc.rof - 1.6) < 0.02, `過載：射速 ×${oc.rof.toFixed(2)}`);
    check(
      oc.stag0 <= 0 && oc.stag1 > 1.5 && oc.stag2 <= 0,
      `過載：5 秒後硬直 2 秒（${oc.stag0.toFixed(2)} → ${oc.stag1.toFixed(2)} → ${oc.stag2.toFixed(2)}）`,
    );

    // ---------- 共振砲：導管射程、最短射程 ----------
    const rs = await ev(() => {
      const g = window.__game,
        hq = window.__hq,
        A = window.__A,
        o = {};
      const r = window.__mk(0, 'a_reson', hq.pos.x + 12, hq.pos.z + 12, 0);
      const D = window.__RD('a_reson');
      window.__sim(1);
      o.onGrid = r.rtsRange(D);
      window.__res('r_reson');
      window.__sim(1);
      o.onGrid2 = r.rtsRange(D);
      o.splash = r.rtsSplashK;
      window.__kill([r]);
      const r2 = window.__mk(0, 'a_reson', A.x, A.z, 0);
      window.__sim(1);
      o.off = r2.rtsRange(D);
      const t = window.__dummy(1, 'c_stomper', A.x, A.z - 7);
      g.rtsOrder([r2], { k: 'hold' });
      window.__sim(6);
      o.near = 1e6 - t.hp;
      window.__kill([r2, t]);
      return o;
    });
    check(
      rs.onGrid === 76 && rs.onGrid2 === 84 && rs.off === 60,
      `共振砲：射程 ${rs.off}、導管上 ${rs.onGrid}、共振校準後 ${rs.onGrid2}（範圍 ×${rs.splash}）`,
    );
    check(rs.near === 0, '共振砲：最短射程內不開火');

    // ---------- 浮游砲機：只被對空打、浮游砲展開 ----------
    const bt = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        o = {};
      const bit = window.__mk(0, 'a_bit', A.x, A.z + 12, 0);
      window.__sim(1);
      const P = window.__game.player || null;
      void P;
      o.byMt = bit.rtsAbCanHit(window.__RD('c_mt'), bit);
      o.byStomper = bit.rtsAbCanHit(window.__RD('c_stomper'), bit);
      o.byFlak = bit.rtsAbCanHit(window.__RD('c_flak'), bit);
      const t = window.__dummy(1, 'c_stomper', A.x, A.z - 10);
      g.rtsOrder([bit], { k: 'hold' });
      bit.rtsCd = {};
      const c0 = R.teams[0].coral;
      // 只量浮游砲：本身不開火
      bit.rtsRangeAdd = -100;
      const h0 = t.hp;
      g.rtsOrder([bit], { k: 'ability', ab: 'ab_bits', id: t.id });
      window.__sim(0.1);
      o.coral = c0 - R.teams[0].coral;
      window.__sim(9);
      o.dmg = (h0 - t.hp) / g.rtsDmgK('en', t);
      o.done = !(bit.rtsAeth && bit.rtsAeth.bits);
      window.__kill([bit, t]);
      return o;
    });
    check(
      !bt.byStomper && bt.byFlak,
      `浮游砲機只被對空武器打（重踏機甲 ${bt.byStomper}、防空砲塔 ${bt.byFlak}、MT ${bt.byMt}）`,
    );
    check(
      Math.abs(bt.coral - 25) < 0.5 && Math.abs(bt.dmg - 192) < 30 && bt.done,
      `浮游砲展開：Coral ${bt.coral.toFixed(0)}、8 秒 ${bt.dmg.toFixed(0)} 能量傷害（定義 3×8×8＝192）`,
    );

    // ---------- 吞噬、共鳴光環 ----------
    const pv = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const pr = window.__mk(0, 'a_proto', A.x, A.z, 0);
      const bl = window.__mk(0, 'a_blob', A.x + 4, A.z, 0);
      g.rtsOrder([bl], { k: 'hold' });
      window.__sim(0.6);
      o.kit = !!pr.model.rtsProtoKit;
      bl.hp = bl.maxHp * 0.5;
      const h0 = bl.hp;
      window.__sim(2);
      o.regen = (bl.hp - h0) / 2;
      pr.hp = pr.maxHp - 1000;
      const hp0 = pr.hp;
      g.rtsOrder([pr], { k: 'ability', ab: 'ab_devour', id: bl.id });
      window.__sim(0.5);
      o.eaten = bl.dead;
      o.heal = pr.hp - hp0;
      o.dmg = pr.dmgMul;
      window.__kill([pr]);
      return o;
    });
    check(pv.kit, '原型體：嵌合體的模型＋背上的 Coral 結晶（addProtoKit）');
    check(Math.abs(pv.regen - 3) < 0.6, `共鳴光環：生體單位每秒回復 ${pv.regen.toFixed(2)}`);
    check(
      pv.eaten && pv.heal >= 595 && Math.abs(pv.dmg - 1.2) < 0.01,
      `吞噬：吃掉實驗體、回復 ${pv.heal.toFixed(0)}、傷害 ×${pv.dmg}`,
    );

    // ---------- 雷射網：警報、斷電的外觀、導管連線 ----------
    const fn = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq,
        o = {};
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      const ux = -hq.pos.x / L,
        uz = -hq.pos.z / L;
      // 兩個節點往地圖中心延伸，第二個節點旁邊放雷射網與培養槽
      const nodes = [];
      for (let i = 1; i <= 2; i++) {
        const p = { x: hq.pos.x + ux * (27 * i), z: hq.pos.z + uz * (27 * i) };
        let n = null;
        for (let r = 0; r < 8 && !n; r++)
          for (let a = 0; a < 12 && !n; a++) {
            const x = p.x + Math.cos(a) * r,
              z = p.z + Math.sin(a) * r;
            if (g.world.nav.buildable(x, z, 5, 5) && !g.rtsPowerWhy(0, 'a_node', x, z))
              n = g.rtsSpawnBld(0, 'a_node', x, z, 0, 1);
          }
        nodes.push(n);
      }
      o.nodes = nodes.filter(Boolean).length;
      const n2 = nodes[1];
      const fence = window.__pbld(0, 'a_fence', n2.pos.x, n2.pos.z, 1, 16);
      const lab = window.__pbld(0, 'a_lab', n2.pos.x, n2.pos.z, 1, 18);
      window.__n2 = n2;
      window.__fence = fence;
      window.__lab2 = lab;
      const lk = R.aethLinks && R.aethLinks[0];
      o.links = lk ? lk.n : -1;
      o.linkMesh = !!(lk && lk.mesh && lk.mesh.parent);
      o.linkOne = R.g.children.filter((c) => c.userData && c.userData.rtsLinks).length;
      // 敵人走進雷射網的射程：開火＋警報（20 秒一次）
      const foe = window.__mk(1, 'c_mt', fence.pos.x + 14, fence.pos.z + 6, 0);
      foe.updateAI = () => true;
      foe.maxHp = foe.hp = 1e5;
      const ev0 = [];
      const re = g.rtsEvent;
      g.rtsEvent = function (x, z, txt) {
        ev0.push(txt);
        return re ? re.apply(this, arguments) : undefined;
      };
      const rv = [];
      const fr = g.rtsFogReveal;
      g.rtsFogReveal = function (t, x, z, r, s) {
        rv.push([t, Math.round(r), Math.round(s)]);
        return fr.apply(this, arguments);
      };
      window.__sim(5);
      o.hit = 1e5 - foe.hp;
      o.alarms = fence.rtsAlarms || 0;
      o.events = ev0.filter((t) => /警報/.test(t)).length;
      o.reveal = rv.filter((q) => q[0] === 0 && q[1] === 20).length;
      window.__sim(16);
      o.alarms2 = fence.rtsAlarms || 0;
      g.rtsEvent = re;
      g.rtsFogReveal = fr;
      window.__kill([foe]);
      // 斷電：拆掉第二個節點 → 雷射網與培養槽停擺、發光熄滅；連線少一條
      const v0 = R.teams[0].power.ver;
      nodes[1].rtsQuiet = true;
      nodes[1].die(null);
      window.__sim(0.5);
      o.off = [fence.bld.off, lab.bld.off];
      o.pw = [fence.model.powered, lab.model.powered];
      o.dim = lab.model.coralK();
      o.links2 = R.aethLinks[0].n;
      o.ver = R.teams[0].power.ver > v0;
      // 重蓋節點：恢復
      const nn = g.rtsSpawnBld(0, 'a_node', n2.pos.x, n2.pos.z, 0, 1);
      window.__nn = nn;
      window.__sim(0.5);
      o.back = [!fence.bld.off, lab.model.powered, lab.model.coralK() > 1];
      o.links3 = R.aethLinks[0].n;
      return o;
    });
    check(fn.nodes === 2, '導管：串接兩個節點');
    check(fn.linkMesh && fn.linkOne === 1 && fn.links >= 2, `導管連線：一隊一個網格（${fn.links} 條）`);
    check(
      fn.hit > 0 && fn.alarms === 1 && fn.events === 1 && fn.reveal >= 1,
      `雷射網：開火、警報揭露攻擊者（${fn.alarms} 次）`,
    );
    check(fn.alarms2 === 2, `雷射網：警報 20 秒一次（21 秒 ${fn.alarms2} 次）`);
    check(
      fn.off.every(Boolean) &&
        fn.pw.every((p) => p === false) &&
        fn.dim === 0 &&
        fn.ver &&
        fn.links2 === fn.links - 1,
      `斷電：停擺、Coral 發光熄滅（連線 ${fn.links} → ${fn.links2}）`,
    );
    check(fn.back.every(Boolean) && fn.links3 === fn.links, '重蓋節點：恢復供電、發光恢復、連線恢復');

    // ---------- 截圖：導管連線與斷電 ----------
    await ev(() => {
      const g = window.__game,
        hq = window.__hq,
        n = window.__nn;
      // 再拆一次看斷電的樣子
      n.rtsQuiet = true;
      n.die(null);
      window.__sim(0.3);
      if (g.rtsCamJump) g.rtsCamJump((hq.pos.x + n.pos.x) / 2, (hq.pos.z + n.pos.z) / 2);
      if (g.rts.cam) g.rts.cam.dist = 110;
      window.__pump(0.5, null, 1 / 30);
    });
    await shot('rts-r3-conduit.png');

    // ---------- 融合的引導外觀 ----------
    const fu = await ev(() => {
      const g = window.__game,
        A = window.__A,
        o = {};
      const L = [0, 1, 2].map((i) => window.__mk(0, 'a_blob', A.x + i * 2, A.z, 0));
      g.rtsOrder(L, { k: 'fuse', recipe: 'fu_chimera' });
      window.__sim(3, () => L.some((e) => e.rtsAeth && e.rtsAeth.fuseT > g.rts.t));
      const h = L.find((e) => e.rtsAeth && e.rtsAeth.fuseT > g.rts.t);
      o.fx = !!h;
      o.fuseT = h ? +(h.rtsAeth.fuseT - g.rts.t).toFixed(1) : -1;
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z);
      if (g.rts.cam) g.rts.cam.dist = 34;
      window.__pump(1.2, null, 1 / 30);
      return o;
    });
    check(fu.fx && fu.fuseT > 3, `融合：引導的外觀（宿主 ${fu.fuseT} 秒）`);
    await shot('rts-r3-fuse.png');
    const fu2 = await ev(() => {
      const A = window.__A;
      window.__sim(5);
      const ch = window.__of(0, 'a_chimera');
      const o = { n: ch.length };
      window.__kill(ch);
      void A;
      return o;
    });
    check(fu2.n === 1, '融合完成：嵌合體');

    // ---------- 截圖：全部建築（三階）與兵種 ----------
    const lay = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      // 測試空地變成臨時的導管根（建築都有電）
      g.rtsPowerAddTemp(0, A.x, A.z, 70, 999);
      const IDS = [
        'a_hq',
        'a_hq2',
        'a_hq3',
        'a_node',
        'a_tap',
        'a_lab',
        'a_foundry',
        'a_inst',
        'a_fence',
        'a_vault',
        'a_hangar',
      ];
      const made = [];
      let x = A.x - 40;
      let row = 0;
      for (const id of IDS) {
        const D = window.__RD(id);
        if (x + D.foot[0] > A.x + 40) {
          x = A.x - 40;
          row++;
        }
        const z = A.z - 14 + row * 22;
        const b = g.rtsSpawnBld(0, id, x + D.foot[0] / 2, z, 0, 1);
        if (b) made.push(b);
        x += D.foot[0] + 4;
      }
      // 一座施工中的（結晶外殼）
      const site = g.rtsSpawnBld(0, 'a_foundry', A.x + 30, A.z + 30, 0, 0.45);
      made.push(site);
      window.__blds = made;
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 4);
      if (g.rts.cam) g.rts.cam.dist = 105;
      if (g.rtsRenderTick) g.rtsRenderTick();
      window.__pump(0.5, null, 1 / 30);
      return {
        n: made.length,
        tiers: made.filter((b) => b.model.setTier).map((b) => b.model.tier),
        shell: !!site.model.scaf.visible,
        aeth: made.every((b) => b.model.aeth),
        merged: made.filter((b) => b.model.rtsMerged).length,
      };
    });
    check(lay.n === 12 && lay.aeth, `全部建築（${lay.n} 座，艾瑟立克的模型）`);
    check(lay.tiers.join() === '1,2,3', `研究中樞三階的外觀（${lay.tiers.join('、')}）`);
    check(lay.shell, '施工中的建築：結晶外殼（沒有鷹架）');
    check(lay.merged === lay.n, `建築都走單一材質合併（${lay.merged}／${lay.n}）`);
    await shot('rts-r3-blds.png');
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      for (const b of window.__blds) {
        b.rtsQuiet = true;
        b.die(null);
      }
      window.__sim(4);
      const IDS = [
        'a_worker',
        'a_blob',
        'a_parasite',
        'a_laser',
        'a_holo',
        'a_beam',
        'a_chimera',
        'a_reson',
        'a_bit',
        'a_proto',
      ];
      IDS.forEach((id, i) => {
        const e = window.__mk(0, id, A.x - 18 + (i % 5) * 9, A.z - 4 + Math.floor(i / 5) * 10, Math.PI);
        e.updateAI = () => true;
      });
      window.__sim(0.2);
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 3);
      if (g.rts.cam) g.rts.cam.dist = 42;
      window.__pump(0.6, null, 1 / 30);
    });
    await shot('rts-r3-units.png');
    await ctx.close();
  }

  return { testRtsAethUnits };
};
