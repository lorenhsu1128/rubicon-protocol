// Coral 戰爭（RTS）R4 B 包（維爾威的兵種行為與模型，docs/rts-design.md 15.3、15.5、15.12）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-veer-b')(H)。
// testRtsVeerUnits：每個兵種生產（投放艙或機庫）、移動、開火與實際 dps（突擊機約 70%、誘導飛彈架分對空／對地）；
// 空中單位只被對空打、低空單位地面也打得到、範圍傷害打不到空中但打得到低空；不飛出 lim − 4、分層高度、同種推擠；
// 長程推進（上高台、低空、落地傷害、r_jump）；衝撞（自動、預警、擊退、暈眩、建築 ×0.5）；機動迴避；掃射；臨時信標；
// 運輸機的載運與卸載（卸在高台）；飛彈防禦塔（對空 38、對地 30）；建築的收起／展開動作與飛行；集貨站的貨箱；
// 空投運輸機的吊掛、投放艙的外觀；單位與建築走單一材質合併。
// 截圖 rts-r4-blds.png、rts-r4-units.png、rts-r4-drop.png、rts-r4-pack.png。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim 快轉。
/* global window */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsVeerUnits(browser, base) {
    console.log('Coral 戰爭：維爾威的兵種行為、技能、飛彈防禦塔與建築模型（R4 B 包）');
    const { ctx, page } = await newPage(browser, 'rtsVeerUnits');
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
      g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷（負載高時同一個種子的結果才會相同）
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'veerwell',
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
      // 直接放蓋好的建築（不經過空投）
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
      // 高台：可以走的格子 P，旁邊 22 m 有低 4 m 以上、和主基地連通的格子 Q（P 和主基地不連通的優先）
      window.__ledge = () => {
        const nav = w.nav,
          C = nav.components(0);
        const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
        const main = C[nav.nearestCell(hq0.pos.x, hq0.pos.z, 0, -1, 20)];
        let best = null;
        const L = w.lim - 10;
        for (let x = -L; x <= L; x += 6)
          for (let z = -L; z <= L; z += 6) {
            const i = nav.cellOf(x, z);
            if (!nav.walkable(i, 0)) continue;
            const hp = w.terrainHeight(x, z);
            for (let a = 0; a < 8; a++) {
              const qx = x + Math.cos((a * Math.PI) / 4) * 22,
                qz = z + Math.sin((a * Math.PI) / 4) * 22;
              const j = nav.cellOf(qx, qz);
              if (!nav.walkable(j, 0) || C[j] !== main) continue;
              if (hp - w.terrainHeight(qx, qz) < 4) continue;
              const cut = C[i] !== main;
              const sc = (cut ? 100 : 0) + hp - w.terrainHeight(qx, qz);
              if (!best || sc > best.sc)
                best = { sc, cut, P: { x, z }, Q: { x: qx, z: qz }, dh: hp - w.terrainHeight(qx, qz) };
            }
          }
        return best;
      };
      window.__meshes = (e) => {
        let n = 0;
        e.mesh.traverse((q) => (q.isMesh || q.isSprite) && q.visible && q.layers.mask && n++);
        return n;
      };
      for (const T of R.teams) {
        T.ore = 50000;
        T.coral = 50000;
      }
      const hq = window.__of(0, 'v_hq')[0];
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

    // ---------- 調度中心三階＋每個兵種都能生產（投放艙或機庫）、移動 ----------
    const prod = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq,
        A = window.__A;
      const o = { tiers: [] };
      const tv = () => [hq.model.tier, !!hq.model.tier2.visible, !!hq.model.tier3.visible].join('/');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'v_hq2');
      o.tiers.push(tv());
      g.rtsUpgradeDone(hq, 'v_hq3');
      o.tiers.push(tv());
      o.tier = g.rtsTier(0);
      for (let i = 0; i < 5; i++) window.__bld(0, 'v_depot', hq.pos.x, hq.pos.z, 1, 50);
      g.rtsRecount();
      const bay = window.__bld(0, 'v_bay', A.x - 20, A.z - 20),
        hg = window.__bld(0, 'v_hangar', A.x + 20, A.z - 20),
        up = window.__bld(0, 'v_uplink', A.x + 20, A.z + 25);
      o.blds = [bay, hg, up].map((b) => !!b);
      window.__bay = bay;
      window.__hg = hg;
      const want = {
        v_mt: bay,
        v_rack: bay,
        v_spacemt: bay,
        v_drone: hg,
        v_heli: hg,
        v_rammer: hg,
        v_dropship: hg,
        v_jet: hg,
      };
      // 集結點：建築正面（投放到建築正面）
      o.queued = [];
      for (const id in want) if (want[id] && g.rtsQueue(want[id], id)) o.queued.push(id);
      // 投放艙：開始落下時有外觀（pod.vis）
      o.podVis = 0;
      o.podsSeen = 0;
      o.t = window.__sim(400, () => {
        for (const p of R.pods) {
          o.podsSeen++;
          if (p.vis && p.vis.P) o.podVis++;
        }
        return Object.keys(want).every((id) => window.__of(0, id).length);
      });
      o.made = Object.keys(want).filter((id) => window.__of(0, id).length);
      const list = Object.keys(want).flatMap((id) => window.__of(0, id));
      window.__units = list;
      // 高度（離地）
      // 移動：全部飛／走到測試空地旁
      const d0 = list.map((e) => Math.hypot(e.pos.x - A.x, e.pos.z - A.z));
      g.rtsOrder(list, { k: 'move', x: A.x - 25, z: A.z + 25 });
      window.__sim(14);
      o.moved = list.filter(
        (e, i) =>
          Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < d0[i] - 10 ||
          Math.hypot(e.pos.x - A.x + 25, e.pos.z - A.z - 25) < 30,
      ).length;
      // 高度（離地，2 秒的平均；空地上）
      const sum = {};
      for (let i = 0; i < 20; i++) {
        window.__sim(0.1);
        for (const e of list)
          if (window.__RD(e.rtsDef).flying)
            sum[e.rtsDef] = (sum[e.rtsDef] || 0) + (e.pos.y - g.world.terrainHeight(e.pos.x, e.pos.z)) / 20;
      }
      o.alt = {};
      for (const k in sum) o.alt[k] = +sum[k].toFixed(1);
      o.n = list.length;
      if (g.rtsRenderTick) g.rtsRenderTick();
      o.merged = list.filter((e) => e.model.rtsMerged).map((e) => e.rtsDef);
      o.meshes = {};
      for (const e of list) o.meshes[e.rtsDef] = window.__meshes(e);
      return o;
    });
    check(
      prod.tiers.join() === '1/false/false,2/true/false,3/true/true' && prod.tier === 3,
      `調度中心三階的外觀：${prod.tiers.join(' → ')}`,
    );
    check(prod.blds.every(Boolean), '軌道調度所、機庫、軌道通訊站');
    check(
      prod.made.length === 8 && prod.t > 0,
      `8 種生產的兵種都生產出來（${prod.made.join('、')}；${prod.t.toFixed(0)} 秒）`,
    );
    check(prod.podsSeen > 0 && prod.podVis > 0, `投放艙落下時有外觀（${prod.podVis}／${prod.podsSeen} 格）`);
    const A0 = prod.alt;
    check(
      A0.v_drone > 4.5 &&
        A0.v_heli > A0.v_drone &&
        A0.v_dropship > A0.v_heli &&
        A0.v_jet > 8 &&
        A0.v_rammer < 4.5,
      `空中單位分層的高度：${JSON.stringify(A0)}`,
    );
    check(prod.moved === prod.n, `移動指令：${prod.moved}／${prod.n} 台走到了`);
    check(
      prod.merged.length === prod.n && Object.values(prod.meshes).every((n) => n <= 8),
      `單位都走單一材質合併（網格數 ${JSON.stringify(prod.meshes)}）`,
    );

    // ---------- 實際 dps ----------
    const dps = await ev(() => {
      const g = window.__game,
        A = window.__A;
      window.__kill(window.__units);
      const res = {};
      // [兵種, 距離, 目標, 期望的倍率, 名稱]
      const CASES = [
        ['v_mt', 16, 'c_stomper', 1, 'v_mt'],
        ['v_rack', 28, 'c_stomper', 1, 'v_rack 對地', 10],
        ['v_rack', 28, 'c_heli', 1, 'v_rack 對空', 30],
        ['v_drone', 14, 'c_stomper', 1, 'v_drone'],
        ['v_spacemt', 18, 'c_stomper', 1, 'v_spacemt'],
        ['v_heli', 18, 'c_stomper', 1, 'v_heli'],
        ['v_rammer', 8, 'c_stomper', 1, 'v_rammer'],
        ['v_jet', 26, 'c_stomper', 0.7, 'v_jet（70%）'],
      ];
      for (const [def, d, tdef, k0, name, want0] of CASES) {
        const tgt = window.__dummy(1, tdef, A.x, A.z - d / 2);
        const a = window.__mk(0, def, A.x, A.z + d / 2, 0);
        a.rtsAuto = { ab_ram: false }; // 只量攻擊
        g.rtsOrder([a], { k: 'attack', id: tgt.id });
        window.__sim(4);
        const hp0 = tgt.hp,
          T = 30;
        window.__sim(T);
        const k = g.rtsDmgK(g.rtsAtkOf(a, null, null), tgt);
        res[name] = { got: (hp0 - tgt.hp) / T / k, want: (want0 || window.__RD(def).dps) * k0 };
        window.__kill([a, tgt]);
      }
      return res;
    });
    for (const k in dps) {
      const r = dps[k];
      check(
        Math.abs(r.got / r.want - 1) <= 0.15,
        `${k} 的實際 dps ${r.got.toFixed(1)}（期望 ${r.want.toFixed(1)}，±15%）`,
      );
    }

    // ---------- 空中、低空與對空 ----------
    const air = await ev(() => {
      const g = window.__game,
        w = g.world,
        A = window.__A;
      const o = {};
      const dr = window.__mk(0, 'v_drone', A.x, A.z);
      const rm = window.__mk(0, 'v_rammer', A.x + 6, A.z);
      const st = window.__mk(1, 'c_stomper', A.x, A.z + 10);
      const fl = window.__RD('c_flak');
      window.__sim(0.5);
      o.gndDrone = st.rtsAbCanHit(window.__RD('c_stomper'), dr);
      o.gndRammer = st.rtsAbCanHit(window.__RD('c_stomper'), rm);
      o.aaDrone = st.rtsAbCanHit(fl, dr);
      o.aaRammer = st.rtsAbCanHit(fl, rm);
      const h0 = dr.hp,
        h1 = rm.hp;
      g.rtsSplash(A.x + 3, A.z, 10, 100, 0, null, 'exp', 1);
      o.splDrone = h0 - dr.hp;
      o.splRammer = h1 - rm.hp;
      // 不飛出 lim − 4
      const L = w.lim;
      g.rtsOrder([dr], { k: 'move', x: L + 40, z: A.z });
      window.__sim(30);
      o.lim = +(L - 4).toFixed(1);
      o.dx = +dr.pos.x.toFixed(1);
      // 同種推擠：兩台無人機在同一點
      const d1 = window.__mk(0, 'v_drone', A.x, A.z),
        d2 = window.__mk(0, 'v_drone', A.x + 0.2, A.z);
      window.__sim(2);
      o.sep = +Math.hypot(d1.pos.x - d2.pos.x, d1.pos.z - d2.pos.z).toFixed(2);
      // 高度差 3 m 以上不互推：突擊機（10 m）與衝撞無人機（3 m）
      window.__kill([st]);
      const h = window.__mk(0, 'v_heli', A.x + 30, A.z + 30);
      const r2 = window.__mk(0, 'v_rammer', A.x + 30.2, A.z + 30);
      h.updateAI = () => true;
      h.hoverH = 10;
      window.__sim(2);
      o.sepX = +Math.hypot(h.pos.x - r2.pos.x, h.pos.z - r2.pos.z).toFixed(2);
      // 高度層（整合）：偵察無人機（6 m）與攻擊直升機（7 m）只差 1 m 也不互推
      const d3 = window.__mk(0, 'v_drone', A.x - 30, A.z - 30),
        h3 = window.__mk(0, 'v_heli', A.x - 29.8, A.z - 30);
      d3.updateAI = () => true;
      h3.updateAI = () => true;
      window.__sim(2);
      o.sepL = +Math.hypot(d3.pos.x - h3.pos.x, d3.pos.z - h3.pos.z).toFixed(2);
      window.__kill([dr, rm, d1, d2, h, r2, d3, h3]);
      return o;
    });
    check(!air.gndDrone && air.gndRammer, '地面武器打不到空中的偵察無人機、打得到低空的衝撞無人機');
    check(air.aaDrone && air.aaRammer, '對空武器打得到空中與低空');
    check(
      air.splDrone === 0 && air.splRammer > 0,
      `範圍傷害：空中 ${air.splDrone}、低空 ${air.splRammer.toFixed(0)}`,
    );
    check(air.dx <= air.lim + 0.6, `空中單位不飛出 lim − 4（${air.dx}／${air.lim}）`);
    check(air.sep >= 1.5 && air.sepX < 1, `同種推擠（${air.sep} m）、高度差 3 m 以上不互推（${air.sepX} m）`);
    check(air.sepL < 1, `不同高度層（6 m 與 7 m）不互推（${air.sepL} m）`);

    // ---------- 長程推進 ----------
    const jp = await ev(() => {
      const g = window.__game,
        R = g.rts,
        w = g.world,
        A = window.__A;
      const o = {};
      // 高台（window.__ledge）：從低處 Q 跳上高處 P；沒有時在空地上跳 20 m
      const L0 = window.__ledge();
      const hi = L0 ? L0.P : null;
      const from = L0 ? L0.Q : A;
      const y0 = w.terrainHeight(from.x, from.z);
      o.hi = !!hi;
      o.cut = !!(L0 && L0.cut);
      const sm = window.__mk(0, 'v_spacemt', from.x, from.z);
      sm.rtsCd = {};
      window.__sim(0.6);
      const tx = hi ? hi.x : from.x + 20,
        tz = hi ? hi.z : from.z;
      const foe = window.__dummy(1, 'c_stomper', tx + 1, tz);
      foe.maxHp = foe.hp = 1e6;
      const hp0 = foe.hp;
      g.rtsOrder([sm], { k: 'ability', ab: 'ab_vjump', x: tx, z: tz });
      window.__sim(0.7);
      o.low = !!(sm.rtsVeer && sm.rtsVeer.jump) && g.rtsLowAir(sm);
      o.gndHit = foe.rtsAbCanHit(window.__RD('c_stomper'), sm);
      o.midY = +(sm.pos.y - y0).toFixed(1);
      window.__sim(1.2);
      o.landed = !(sm.rtsVeer && sm.rtsVeer.jump) && !sm.flying;
      o.dist = +Math.hypot(sm.pos.x - tx, sm.pos.z - tz).toFixed(1);
      o.dy = +(sm.pos.y - w.groundAt(sm.pos.x, sm.pos.z, sm.pos.y + 1)).toFixed(2);
      o.hiY = +(sm.pos.y - y0).toFixed(1);
      o.dmg = +((hp0 - foe.hp) / g.rtsDmgK('exp', foe)).toFixed(1);
      o.cd = +(sm.rtsCd.ab_vjump - R.t).toFixed(1);
      window.__kill([foe]);
      // 研究：40 m、冷卻 12
      window.__res('r_jump');
      sm.rtsCd = {};
      const bx = sm.pos.x - 37,
        bz = sm.pos.z;
      g.rtsOrder([sm], { k: 'ability', ab: 'ab_vjump', x: bx, z: bz });
      window.__sim(0.2);
      o.res40 = !!(sm.rtsVeer && sm.rtsVeer.jump);
      window.__sim(2);
      o.cd2 = +(sm.rtsCd.ab_vjump - R.t).toFixed(1);
      o.dist2 = +Math.hypot(sm.pos.x - bx, sm.pos.z - bz).toFixed(1);
      window.__kill([sm]);
      window.__res('r_jump', 0);
      return o;
    });
    check(jp.low && jp.gndHit && jp.midY > 3, `長程推進：跳躍中是低空、地面武器打得到（離地 ${jp.midY} m）`);
    check(
      jp.landed && jp.dist < 4.5 && Math.abs(jp.dy) < 0.6,
      `長程推進：落在目標點（差 ${jp.dist} m）${jp.hi ? `、上了高台（高 ${jp.hiY} m${jp.cut ? '，地面走不上去' : ''}）` : ''}`,
    );
    check(Math.abs(jp.dmg - 40) < 12, `落地 3 m 爆發傷害約 40（${jp.dmg}）`);
    check(
      jp.cd > 17 && jp.res40 && jp.cd2 < 12.5 && jp.cd2 > 9 && jp.dist2 < 3,
      `冷卻 ${jp.cd} 秒；研究後 40 m（差 ${jp.dist2} m）、冷卻 ${jp.cd2} 秒`,
    );

    // ---------- 衝撞 ----------
    const ram = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const rm = window.__mk(0, 'v_rammer', A.x, A.z + 7);
      // 只量衝撞：停掉衝撞無人機自己的機槍（不然 1.5 秒內的總傷害偶爾超過上限）
      for (const s in rm.weapons) if (rm.weapons[s]) rm.weapons[s].cd = 1e9;
      const t = window.__dummy(1, 'c_stomper', A.x, A.z - 7);
      t.maxHp = t.hp = 1e6;
      window.__sim(0.35);
      o.auto = !!(rm.rtsVeer && rm.rtsVeer.ram);
      o.warn = o.auto && rm.rtsVeer.ram.st === 'warn';
      const z0 = t.pos.z,
        hp0 = t.hp;
      window.__sim(1.5);
      o.dmg = +((hp0 - t.hp) / g.rtsDmgK('kin', t)).toFixed(0);
      o.kb = +(z0 - t.pos.z).toFixed(1);
      o.stun = t.staggerT > 0 || o.dmg > 0;
      o.cd = +(rm.rtsCd.ab_ram - R.t).toFixed(1);
      window.__kill([t]);
      // 建築 ×0.5、不擊退
      const b = window.__bld(1, 'c_depot', A.x, A.z - 12, 1, 20);
      rm.rtsCd = {};
      rm.pos.set(b.pos.x, rm.pos.y, b.pos.z + 12);
      const bh0 = b.hp,
        bx = b.pos.x;
      rm.rtsAbCast('ab_ram', { id: b.id });
      window.__sim(1.6);
      o.bld = +((bh0 - b.hp) / g.rtsDmgK('kin', b)).toFixed(0);
      o.bldMove = b.pos.x !== bx;
      window.__kill([rm, b]);
      return o;
    });
    check(ram.auto && ram.warn, '衝撞：自動施放、先預警');
    check(
      Math.abs(ram.dmg - 90) < 10 && ram.kb > 4 && ram.stun,
      `衝撞：${ram.dmg} 傷害、擊退 ${ram.kb} m、暈眩`,
    );
    check(
      Math.abs(ram.bld - 45) < 8 && !ram.bldMove,
      `衝撞建築 ×0.5（${ram.bld}）、不擊退；冷卻 ${ram.cd} 秒`,
    );

    // ---------- 機動迴避、掃射、臨時信標 ----------
    const ab = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const h = window.__mk(0, 'v_heli', A.x, A.z);
      window.__sim(0.3);
      const sp0 = h.speedMul;
      g.rtsOrder([h], { k: 'ability', ab: 'ab_evade' });
      window.__sim(0.2);
      o.evSpeed = +(h.speedMul / sp0).toFixed(2);
      o.evTaken = h.rtsTakenK;
      window.__sim(3.2);
      o.evEnd = h.rtsTakenK === 1;
      window.__kill([h]);
      // 掃射：線上的三台目標都受傷
      const jet = window.__mk(0, 'v_jet', A.x, A.z + 30);
      jet.rtsRange = () => 0; // 只量掃射（不用機槍交戰）
      window.__sim(0.5);
      const ts = [-8, 0, 8].map((dz) => window.__dummy(1, 'c_stomper', A.x, A.z + dz));
      const hp = ts.map((t) => t.hp);
      const c0 = R.teams[0].coral;
      g.rtsOrder([jet], { k: 'ability', ab: 'ab_strafe', x: A.x, z: A.z });
      window.__sim(0.5);
      o.cd = +(jet.rtsCd.ab_strafe - R.t).toFixed(1);
      o.early = ts.every((t, i) => t.hp === hp[i]);
      window.__sim(1.6);
      o.hit = ts.map((t, i) => +((hp[i] - t.hp) / g.rtsDmgK('kin', t)).toFixed(0));
      o.coral = c0 - R.teams[0].coral;
      o.slow = jet.rtsMods.buff.some((b) => b.src === 'strafe');
      window.__kill([...ts]);
      // 研究後燃器：冷卻 11
      window.__res('r_burn');
      jet.rtsCd = {};
      g.rtsOrder([jet], { k: 'ability', ab: 'ab_strafe', x: A.x + 10, z: A.z });
      window.__sim(0.2);
      o.cd2 = +(jet.rtsCd.ab_strafe - R.t).toFixed(1);
      window.__res('r_burn', 0);
      // 臨時信標
      const dr = window.__mk(0, 'v_drone', A.x + 10, A.z + 10);
      window.__sim(0.3);
      const n0 = g.rtsBeacons(0).filter((b) => b.temp || !b.e).length;
      g.rtsOrder([dr], { k: 'ability', ab: 'ab_relay' });
      window.__sim(0.3);
      const bs = g.rtsBeacons(0).filter((b) => b.temp || !b.e);
      o.relay = bs.length === n0 + 1 && dr.dead;
      o.relayAt = bs.length
        ? +Math.hypot(bs[bs.length - 1].x - (A.x + 10), bs[bs.length - 1].z - (A.z + 10)).toFixed(1)
        : -1;
      window.__sim(41);
      o.relayEnd = g.rtsBeacons(0).filter((b) => b.temp || !b.e).length === n0;
      window.__kill([h, jet]);
      return o;
    });
    check(
      ab.evSpeed > 1.35 && Math.abs(ab.evTaken - 0.5) < 0.01 && ab.evEnd,
      `機動迴避：速度 ×${ab.evSpeed}、受到的傷害 ×${ab.evTaken}、3 秒`,
    );
    check(
      ab.early && ab.hit.every((n) => n >= 20) && ab.coral === 15 && ab.slow,
      `掃射：預警後線上的目標都受傷（${ab.hit.join('、')}）、Coral ${ab.coral}、之後減速`,
    );
    check(ab.cd > 15 && ab.cd2 > 10 && ab.cd2 < 11.5, `掃射的冷卻 ${ab.cd} 秒、研究後燃器後 ${ab.cd2} 秒`);
    check(
      ab.relay && ab.relayAt >= 0 && ab.relayAt < 2 && ab.relayEnd,
      `臨時信標：無人機消耗、信標在原地（差 ${ab.relayAt} m）、40 秒後消失`,
    );

    // ---------- 運輸機：載運與卸在高台 ----------
    const ds = await ev(() => {
      const g = window.__game,
        w = g.world,
        A = window.__A;
      const o = {};
      const ship = window.__mk(0, 'v_dropship', A.x, A.z);
      const us = [0, 1, 2].map((i) => window.__mk(0, 'v_mt', A.x + 4 + i * 2, A.z + 4));
      window.__sim(0.3);
      o.cargo0 = !!(ship.model.rtsCargo && !ship.model.rtsCargo.visible);
      g.rtsOrder(us, { k: 'board', id: ship.id });
      window.__sim(6, () => (ship.cargo || []).length === 3);
      o.boarded = (ship.cargo || []).length;
      window.__sim(0.2);
      o.cargoVis = !!(ship.model.rtsCargo && ship.model.rtsCargo.visible);
      // 卸載點：高台（window.__ledge，地面走不上去的優先）
      const L0 = window.__ledge();
      o.cut = !!(L0 && L0.cut);
      let best = L0 ? L0.P : null,
        by = -1e9;
      const fixed = !!L0;
      for (let r = 10; r <= 60; r += 5)
        for (let a = 0; a < 24; a++) {
          const x = A.x + Math.cos((a / 24) * Math.PI * 2) * r,
            z = A.z + Math.sin((a / 24) * Math.PI * 2) * r;
          if (fixed) break;
          if (!w.nav.walkableAt(x, z, 0)) continue;
          const y = w.terrainHeight(x, z);
          if (y > by) ((by = y), (best = { x, z }));
        }
      g.rtsOrder([ship], { k: 'unload', x: best.x, z: best.z });
      o.lowSeen = false;
      window.__sim(70, () => {
        if (g.rtsLowAir(ship)) o.lowSeen = true;
        return !(ship.cargo || []).length;
      });
      o.left = (ship.cargo || []).length;
      // 高台上（和高台同一個連通分量；地面走不上去的高台就是只有空中到得了）、站在地面上
      const C = w.nav.components(0);
      const cP = C[w.nav.cellOf(best.x, best.z)];
      o.sameComp = us.every((u) => C[w.nav.cellOf(u.pos.x, u.pos.z)] === cP);
      by = L0 ? w.terrainHeight(L0.Q.x, L0.Q.z) : by;
      o.unloadY = us.map((u) => +(u.pos.y - by).toFixed(1));
      o.onGnd = us.every((u) => Math.abs(u.pos.y - w.groundAt(u.pos.x, u.pos.z, u.pos.y + 1)) < 0.6);
      o.near = us.every((u) => Math.hypot(u.pos.x - best.x, u.pos.z - best.z) < 8);
      window.__sim(1);
      o.cargoOff = !!(ship.model.rtsCargo && !ship.model.rtsCargo.visible);
      window.__kill([ship, ...us]);
      return o;
    });
    check(ds.cargo0 && ds.boarded === 3 && ds.cargoVis, `運輸機：3 台登機、吊掛的貨櫃出現`);
    check(
      ds.left === 0 &&
        ds.lowSeen &&
        ds.near &&
        ds.sameComp &&
        ds.onGnd &&
        (!ds.cut || ds.unloadY.every((d) => d > 3)) &&
        ds.cargoOff,
      `運輸機：卸在高台（比下方高 ${ds.unloadY.join('、')} m${ds.cut ? '，地面走不上去' : ''}）、卸載中是低空、卸完貨櫃收起`,
    );

    // ---------- 飛彈防禦塔 ----------
    const sam = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const s = window.__bld(0, 'v_sam', A.x, A.z, 1, 20);
      const at = (d, a = 0) => ({ x: s.pos.x + Math.cos(a) * d, z: s.pos.z + Math.sin(a) * d });
      // 對空 36 m
      const p1 = at(36);
      const h = window.__dummy(1, 'c_heli', p1.x, p1.z);
      window.__sim(2);
      const h0 = h.hp;
      window.__sim(14);
      o.air = +((h0 - h.hp) / 14 / g.rtsDmgK('pierce', h)).toFixed(1);
      window.__kill([h]);
      // 對地 34 m：打不到；26 m：打得到
      const p2 = at(34 + 2.5, 1.5);
      const t1 = window.__dummy(1, 'c_stomper', p2.x, p2.z);
      window.__sim(4);
      o.far = 1e6 - t1.hp;
      window.__kill([t1]);
      const p3 = at(24, 1.5);
      const t2 = window.__dummy(1, 'c_stomper', p3.x, p3.z);
      window.__sim(2);
      const g0 = t2.hp;
      window.__sim(14);
      o.gnd = +((g0 - t2.hp) / 14 / g.rtsDmgK('pierce', t2)).toFixed(1);
      // 同時有空中與地面：打空中的
      const p4 = at(30, -1.5);
      const h2 = window.__dummy(1, 'c_heli', p4.x, p4.z);
      window.__sim(1.5);
      o.pref = s.rtw && s.rtw.tgt === h2;
      o.aim = !!s.model.turret && Math.abs(s.model.turret.rotation.y) > 0.01;
      window.__kill([t2, h2]);
      window.__sam = s;
      void R;
      return o;
    });
    check(
      Math.abs(sam.air / 26 - 1) < 0.15 && Math.abs(sam.gnd / 10 - 1) < 0.15,
      `飛彈防禦塔：對空 dps ${sam.air}（26）、對地 ${sam.gnd}（10）`,
    );
    check(
      sam.far === 0 && sam.pref && sam.aim,
      '飛彈防禦塔：對地射程 30（34 m 的打不到）、空中目標優先、發射器轉向',
    );

    // ---------- 收起／展開、集貨站、空投運輸機與投放艙 ----------
    const pk = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A;
      const o = {};
      const b = window.__bay;
      R.t += 30; // 不受「展開後 20 秒」的限制
      const fan0 = b.model.fans[3].rotation.z;
      o.packOk = g.rtsPack(b);
      window.__sim(2.5);
      o.mid = +b.model.pack.toFixed(2);
      window.__sim(4);
      o.packed = b.bld.packed;
      o.full = b.model.pack;
      o.fan = +(b.model.fans[3].rotation.z - fan0).toFixed(2);
      o.gear = +b.model.gear[0].scale.y.toFixed(2);
      o.rotors = b.model.rotors.every((r) => r.visible);
      o.alt = +(b.pos.y - g.world.terrainHeight(b.pos.x, b.pos.z)).toFixed(1);
      const x0 = b.pos.x;
      g.rtsOrder([b], { k: 'move', x: b.pos.x + 20, z: b.pos.z });
      window.__sim(3);
      o.flew = +(b.pos.x - x0).toFixed(1);
      if (g.rtsRenderTick) g.rtsRenderTick();
      window.__packed = b;
      // 集貨站
      const y = window.__bld(0, 'v_yard', A.x - 30, A.z + 20, 1, 30);
      o.stack0 = y.model.stacks.filter((s) => s.visible).length;
      g.rtsHaulDeposit(y, { kind: 'ore', n: 150 });
      o.stackHalf = y.model.stacks.filter((s) => s.visible).length;
      g.rtsHaulDeposit(y, { kind: 'ore', n: 300 });
      o.stackFull = y.model.stacks.filter((s) => s.visible).length;
      window.__yard = y;
      return o;
    });
    check(
      pk.packOk && pk.mid > 0.1 && pk.mid < 0.9 && pk.packed === 2 && pk.full > 0.999,
      `收起：setPack 從 0 到 1（中途 ${pk.mid}；${pk.packOk}／${pk.packed}／${pk.full}）`,
    );
    check(
      Math.abs(pk.fan) > 1.4 && pk.gear < 0.4 && pk.rotors,
      `收好：風扇轉成水平（${pk.fan}）、起落架收起（${pk.gear}）、葉片轉動`,
    );
    check(pk.alt > 3 && pk.flew > 8, `收好的建築飛在低空（${pk.alt} m）、移動 ${pk.flew} m`);
    check(
      pk.stack0 === 0 && pk.stackHalf === 3 && pk.stackFull === 6,
      `集貨站的貨箱：0 → ${pk.stackHalf} → ${pk.stackFull} 堆`,
    );
    await ev(() => {
      const g = window.__game,
        b = window.__packed;
      if (g.rtsCamJump) g.rtsCamJump(b.pos.x - 6, b.pos.z + 6);
      if (g.rts.cam) g.rts.cam.dist = 50;
      window.__pump(0.6, null, 1 / 30);
    });
    await shot('rts-r4-pack.png');
    const un = await ev(() => {
      const g = window.__game,
        b = window.__packed;
      const o = {};
      const tx = b.pos.x,
        tz = b.pos.z;
      o.unOk = g.rtsUnpack(b, tx, tz, 0);
      o.unWhy = g.rtsUnpackWhy(b, tx, tz, 0);
      window.__sim(12, () => b.bld.packed === 0);
      o.state = b.bld.packed;
      o.pack = b.model.pack;
      o.gear = +b.model.gear[0].scale.y.toFixed(2);
      o.rotors = b.model.rotors.some((r) => r.visible);
      return o;
    });
    check(
      un.unOk && un.state === 0 && un.pack < 1e-3 && un.gear > 0.95 && !un.rotors,
      `展開：落地、setPack 回到 0、起落架放下、葉片停（${un.unOk}${un.unWhy}／${un.state}／${un.pack}／${un.gear}）`,
    );
    const drop = await ev(() => {
      const g = window.__game,
        R = g.rts,
        A = window.__A,
        hq = window.__hq;
      const o = {};
      // 投放艙：從調度所生產一台空降 MT（落下前 3 秒）
      const bay = window.__bay;
      bay.bld.rally = { x: bay.pos.x, z: bay.pos.z + 20 };
      g.rtsQueue(bay, 'v_mt');
      window.__sim(40, () => R.pods.some((p) => p.vis && p.t - R.t < 3));
      const pod = R.pods.find((p) => p.vis);
      o.pod = !!pod;
      window.__pod = pod;
      // 空投：投放艙附近的地點（運輸機吊著貨櫃、放下時貨櫃離開）
      const c0 = pod || hq.pos;
      let spot = null;
      for (let r = 16; r < 70 && !spot; r += 4)
        for (let a = 0; a < 16; a++) {
          const x = c0.x + Math.cos(a) * r,
            z = c0.z + Math.sin(a) * r;
          if (!g.rtsDropWhy(0, 'v_lab', x, z, 0)) {
            spot = { x, z };
            break;
          }
        }
      const rec = spot && g.rtsDropOrder(0, 'v_lab', spot.x, spot.z, 0);
      o.rec = !!rec;
      window.__sim(0.2);
      const ship = rec && g.rtsEnt(rec.ship);
      o.cargo = !!(ship && ship.model.rtsCargo && ship.model.rtsCargo.visible);
      window.__ship = ship;
      window.__sim(3, () => pod && pod.t - R.t < 0.75);
      o.podY = pod ? +(pod.vis.P.group.position.y - pod.vis.y).toFixed(1) : -1;
      window.__pump(0.05, null, 1 / 30);
      o.podY = pod ? +(pod.vis.P.group.position.y - pod.vis.y).toFixed(1) : -1;
      if (ship && g.rtsCamJump)
        g.rtsCamJump(
          (ship.pos.x + (pod ? pod.x : ship.pos.x)) / 2,
          (ship.pos.z + (pod ? pod.z : ship.pos.z)) / 2,
        );
      if (g.rts.cam) g.rts.cam.dist = 80;
      window.__pump(0.1, null, 1 / 30);
      void A;
      return o;
    });
    check(drop.rec && drop.cargo, '空投運輸機吊著貨櫃');
    check(drop.pod && drop.podY > 0, `投放艙從天上落下（離地 ${drop.podY} m）`);
    await shot('rts-r4-drop.png');
    const drop2 = await ev(() => {
      const g = window.__game,
        R = g.rts,
        ship = window.__ship,
        pod = window.__pod;
      const o = {};
      window.__sim(2);
      o.podLand = !!(pod && pod.vis && pod.vis.land);
      window.__sim(60, () => !ship || ship.dead || !ship.model.rtsCargo.visible);
      o.cargoOff = !!ship && !ship.model.rtsCargo.visible;
      o.lab = window.__of(0, 'v_lab').some((b) => b.bld.progress < 1);
      window.__sim(6);
      window.__pump(0.3, null, 1 / 30); // 外觀的計時在 fx 的每格（算繪的主迴圈）
      o.podGone = !!pod && !pod.vis.P.group.parent;
      void R;
      return o;
    });
    check(
      drop2.podLand && drop2.podGone,
      `投放艙著地（艙門打開）、3 秒後消失（${drop2.podLand}／${drop2.podGone}）`,
    );
    check(drop2.cargoOff && drop2.lab, '空投：放下地基時吊掛的貨櫃離開、地基開始展開');

    // ---------- 截圖：全部建築（三階）與兵種 ----------
    const lay = await ev(() => {
      const g = window.__game,
        A = window.__A;
      window.__kill(
        g.rts.units.filter(
          (e) =>
            !e.dead && e.rtsTeam === 0 && e !== window.__hq && Math.hypot(e.pos.x - A.x, e.pos.z - A.z) < 70,
        ),
      );
      const IDS = [
        'v_hq',
        'v_hq2',
        'v_hq3',
        'v_depot',
        'v_yard',
        'v_extractor',
        'v_bay',
        'v_hangar',
        'v_lab',
        'v_beacon',
        'v_sam',
        'v_market',
        'v_uplink',
      ];
      const made = [];
      let x = A.x - 44;
      let row = 0;
      for (const id of IDS) {
        const D = window.__RD(id);
        if (x + D.foot[0] > A.x + 44) {
          x = A.x - 44;
          row++;
        }
        const z = A.z - 18 + row * 22;
        const b = g.rtsSpawnBld(0, id, x + D.foot[0] / 2, z, 0, 1);
        if (b) made.push(b);
        x += D.foot[0] + 4;
      }
      const yard = made.find((b) => b.rtsDef === 'v_yard');
      if (yard) g.rtsHaulDeposit(yard, { kind: 'ore', n: 200 });
      const site = g.rtsSpawnBld(0, 'v_hangar', A.x + 34, A.z + 34, 0, 0.45);
      made.push(site);
      window.__blds = made;
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 6);
      if (g.rts.cam) g.rts.cam.dist = 112;
      if (g.rtsRenderTick) g.rtsRenderTick();
      window.__pump(0.5, null, 1 / 30);
      return {
        n: made.length,
        tiers: made.filter((b) => b.model.setTier).map((b) => b.model.tier),
        site: !!site.model.scaf.visible,
        veer: made.every((b) => b.model.veer),
        merged: made.filter((b) => b.model.rtsMerged).length,
        meshes: Math.max(...made.map((b) => window.__meshes(b))),
      };
    });
    check(lay.n === 14 && lay.veer, `全部建築（${lay.n} 座，維爾威的模型）`);
    check(lay.tiers.join() === '1,2,3', `調度中心三階的外觀（${lay.tiers.join('、')}）`);
    check(lay.site, '空投展開中的建築：貨櫃板（沒有鷹架）');
    check(
      lay.merged === lay.n && lay.meshes <= 8,
      `建築都走單一材質合併（${lay.merged}／${lay.n}，最多 ${lay.meshes} 個網格）`,
    );
    await shot('rts-r4-blds.png');
    await ev(() => {
      const g = window.__game,
        A = window.__A;
      for (const b of window.__blds) {
        b.rtsQuiet = true;
        b.die(null);
      }
      window.__sim(4);
      const IDS = [
        'v_worker',
        'v_mt',
        'v_rack',
        'v_drone',
        'v_spacemt',
        'v_heli',
        'v_rammer',
        'v_dropship',
        'v_jet',
        'v_carrier',
      ];
      IDS.forEach((id, i) => {
        const e = window.__mk(0, id, A.x - 32 + (i % 5) * 16, A.z - 8 + Math.floor(i / 5) * 18, Math.PI);
        e.updateAI = () => true;
        if (id === 'v_carrier') e.rtsAbInit(window.__RD(id));
      });
      window.__sim(0.2);
      if (g.rtsCamJump) g.rtsCamJump(A.x, A.z + 3);
      if (g.rts.cam) g.rts.cam.dist = 66;
      window.__pump(0.6, null, 1 / 30);
    });
    await shot('rts-r4-units.png');
    await ctx.close();
  }

  return { testRtsVeerUnits };
};
