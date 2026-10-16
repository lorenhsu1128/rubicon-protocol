// Coral 戰爭（RTS）R3 A 包（艾瑟立克的核心與資料，docs/rts-design.md 14.2、14.11）的冒煙測試：
// 由 smoke-test.js 載入 require('./smoke-rts-aeth-a')(H)。
// testRtsAeth：導管網（範圍、節點的連線、串接、斷電停擺與恢復、汲取塔是根、臨時導管）、建築自己長、工人每趟 8、
// 研究中樞的 Coral、導管上的加成與建築回血、結晶護壁、融合（組數、扣款、人口、血量、取消、宿主被擊破、原型體的需求）、
// 幻象（人口、擊破、到期、上限）、隨機陣營、兩邊都是艾瑟立克、卡斯特隆不變、選單。
// 電腦對手不動（g.rtsAiOff）、野怪不生成（g.rtsCampsOff），主迴圈停住，只以 rtsSim 快轉。
/* global window, document */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  async function testRtsAeth(browser, base) {
    console.log('Coral 戰爭：艾瑟立克的導管網、自己長的建築、融合、幻象（R3 核心）');
    const { ctx, page } = await newPage(browser, 'rtsAeth');
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
      // 可以蓋的位置：從 (x, z) 往外找（不檢查導管）
      window.__spot = (x, z, w, d, maxR = 30) => {
        const nav = g.world.nav;
        for (let r = 0; r <= maxR; r += 2)
          for (let a = 0; a < 16; a++) {
            const px = x + Math.cos((a / 16) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
            if (nav.buildable(px, pz, w, d)) return { x: px, z: pz };
            if (r === 0) break;
          }
        return null;
      };
      // 蓋好的建築（直接放、不經過工人與導管檢查）
      window.__bld = (team, def, x, z, p = 1) => {
        const D = window.__RD(def);
        const s = window.__spot(x, z, D.foot[0] + 1, D.foot[1] + 1);
        return s ? g.rtsSpawnBld(team, def, s.x, s.z, 0, p) : null;
      };
      // 有電的地方（要電的建築）
      window.__pbld = (team, def, x, z, p = 1) => {
        const D = window.__RD(def);
        const nav = g.world.nav;
        for (let r = 0; r <= 24; r += 1)
          for (let a = 0; a < 36; a++) {
            const px = x + Math.cos((a / 36) * Math.PI * 2) * r,
              pz = z + Math.sin((a / 36) * Math.PI * 2) * r;
            if (nav.buildable(px, pz, D.foot[0] + 1, D.foot[1] + 1) && !g.rtsPowerWhy(team, def, px, pz))
              return g.rtsSpawnBld(team, def, px, pz, 0, p);
            if (r === 0) break;
          }
        return null;
      };
      window.__RD = (id) => (g.rtsUiDef ? g.rtsUiDef(id) : null);
      R.teams[0].ore = R.teams[1].ore = 20000;
      R.teams[0].coral = R.teams[1].coral = 20000;
      // 繳交的紀錄（每趟的量）
      window.__dep = [[], []];
      const dep = g.rtsDeposit.bind(g);
      g.rtsDeposit = (t, k, n) => {
        if (window.__dep[t] && k === 'ore') window.__dep[t].push(n);
        return dep(t, k, n);
      };
      const hq = window.__of(0, 'a_hq')[0];
      window.__hq = hq;
      return {
        fac: [R.teams[0].faction, R.teams[1].faction],
        hq: !!hq,
        hq1: window.__of(1, 'c_hq').length,
        wk: window.__of(0, 'a_worker').length,
        srcs: R.teams[0].power.srcs.map((s) => [s.root, s.on, s.r]),
        at: !!g.rtsPowerAt(0, hq.pos.x, hq.pos.z),
        at1: !!g.rtsPowerAt(1, 0, 0),
        hqHp: hq.maxHp,
        menu: (window.__RD('a_hq').menus.hero || []).map((c) => c.key + ':' + c.name).join(' '),
        cmenu: (window.__RD('c_hq').menus.hero || []).map((c) => c.key + ':' + c.name).join(' '),
      };
    });
    check(
      st.fac.join() === 'aetheric,castron' && st.hq && st.hq1 === 1 && st.wk === 5,
      `開局：艾瑟立克（研究中樞＋5 台研究作業機）對卡斯特隆`,
    );
    check(
      st.srcs.length === 1 && st.srcs[0].join() === 'true,true,26' && st.at && !st.at1,
      `研究中樞是導管的根（26 m、有電）；卡斯特隆沒有導管（${JSON.stringify(st.srcs)}）`,
    );
    check(
      /Q:PRISM W:CURATOR E:VEIL V:返回/.test(st.menu) &&
        /Q:BASTION W:RAIN E:PILEDRIVER V:返回/.test(st.cmenu),
      `英雄子選單依陣營（${st.menu}／${st.cmenu}）`,
    );

    // ---------- 經濟：每趟 8／10、研究中樞的 Coral ----------
    const eco = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const c0 = R.teams[0].coral,
        c1 = R.teams[1].coral;
      window.__sim(40);
      const d0 = window.__dep[0],
        d1 = window.__dep[1];
      return {
        n0: d0.length,
        n1: d1.length,
        all8: d0.length > 0 && d0.every((n) => n === 8),
        all10: d1.length > 0 && d1.every((n) => n === 10),
        dc0: R.teams[0].coral - c0,
        dc1: R.teams[1].coral - c1,
      };
    });
    check(eco.all8 && eco.all10, `工人每趟：艾瑟立克 8（${eco.n0} 趟）、卡斯特隆 10（${eco.n1} 趟）`);
    check(
      Math.abs(eco.dc0 - 6) < 0.3 && Math.abs(eco.dc1) < 1e-6,
      `研究中樞自己產出 Coral：40 秒 +${eco.dc0.toFixed(2)}（0.15／秒）；卡斯特隆的主堡 +${eco.dc1}`,
    );

    // ---------- 導管：範圍、節點、串接 ----------
    const grid = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      // 往地圖中心的方向延伸
      const L = Math.hypot(hq.pos.x, hq.pos.z) || 1;
      const ux = -hq.pos.x / L,
        uz = -hq.pos.z / L;
      const at = (d) => ({ x: hq.pos.x + ux * d, z: hq.pos.z + uz * d });
      const o = {};
      const far = at(60);
      o.whyLab = g.rtsPowerWhy(0, 'a_lab', far.x, far.z);
      o.whyNode = g.rtsPowerWhy(0, 'a_node', at(45).x, at(45).z);
      o.okNode = g.rtsPowerWhy(0, 'a_node', at(25).x, at(25).z);
      o.whyHq = g.rtsPowerWhy(0, 'a_hq', far.x, far.z); // 研究中樞不受限制
      o.castron = g.rtsPowerWhy(1, 'c_factory', 0, 0);
      const fs = window.__spot(far.x, far.z, 13, 13);
      o.place = !!g.rtsPlace(0, 'a_lab', fs.x, fs.z, 0, null);
      // 三個節點（每個 28 m）
      const nodes = [];
      for (let i = 1; i <= 3; i++) {
        const p = at(28 * i);
        const s = window.__spot(p.x, p.z, 5, 5, 6);
        nodes.push(s ? g.rtsSpawnBld(0, 'a_node', s.x, s.z, 0, 1) : null);
      }
      window.__nodes = nodes;
      o.nodes = nodes.map((n) => !!n);
      const P = R.teams[0].power;
      o.on = nodes.map((n) => n && P.srcs.find((s) => s.e === n).on);
      o.links = g.rtsPowerLinks(0).length;
      o.fields = g.rtsPowerFields(0).length;
      // 第 3 個節點旁的培養槽、雷射網、施工中的兵器廠
      const n3 = nodes[2];
      const fd = window.__pbld(0, 'a_foundry', n3.pos.x, n3.pos.z, 0);
      const lab = window.__pbld(0, 'a_lab', n3.pos.x, n3.pos.z);
      const fence = window.__pbld(0, 'a_fence', n3.pos.x, n3.pos.z);
      window.__lab = lab;
      window.__fence = fence;
      window.__fd = fd;
      o.labOn = lab && !lab.bld.off && g.rtsPowerAt(0, lab.pos.x, lab.pos.z) !== null;
      o.fenceOn = fence && !fence.bld.off;
      o.fdSelf = fd && fd.bld.progress === 0;
      g.rtsRecount();
      o.cap0 = R.teams[0].cap;
      g.rtsQueue(lab, 'a_blob');
      window.__sim(3);
      o.q0 = lab.bld.queue[0] ? lab.bld.queue[0].t : -1;
      o.fd0 = fd.bld.progress;
      // 敵方單位放在雷射網旁：有電時開火
      const foe = g.rtsSpawn(1, 'c_mt', fence.pos.x + 10, fence.pos.z + 4);
      foe.updateAI = () => {};
      window.__foe = foe;
      window.__sim(2);
      o.foeHit = foe.hp < foe.maxHp;
      foe.hp = foe.maxHp;
      // 拆中間的節點：後面斷電
      nodes[1].die(null);
      window.__sim(0.5);
      o.n3dark = !!n3.bld.unp;
      o.labOff = lab.bld.off;
      o.fenceOff = fence.bld.off;
      o.fdOff = fd.bld.off;
      o.cap1 = R.teams[0].cap;
      const qa = lab.bld.queue[0] ? lab.bld.queue[0].t : -1;
      const pa = fd.bld.progress;
      foe.hp = foe.maxHp;
      window.__sim(5);
      o.qFrozen = lab.bld.queue[0] && Math.abs(lab.bld.queue[0].t - qa) < 1e-6;
      o.fdFrozen = Math.abs(fd.bld.progress - pa) < 1e-6;
      o.foeSafe = foe.hp >= foe.maxHp;
      o.offT = R.stats[0].offT;
      // 重蓋節點：恢復
      const s2 = window.__spot(at(56).x, at(56).z, 5, 5, 6);
      nodes[1] = g.rtsSpawnBld(0, 'a_node', s2.x, s2.z, 0, 1);
      window.__sim(0.5);
      o.labBack = !lab.bld.off && !n3.bld.unp;
      window.__sim(3);
      o.qMove = lab.bld.queue[0] ? lab.bld.queue[0].t > qa + 1 : true;
      o.fdGrow = fd.bld.progress > pa;
      foe.die(null);
      return o;
    });
    check(
      grid.whyLab === '要蓋在導管範圍內' &&
        /32 m/.test(grid.whyNode) &&
        grid.okNode === '' &&
        grid.whyHq === '',
      `建造的限制：範圍外「${grid.whyLab}」、節點「${grid.whyNode}」、範圍內可以、研究中樞不受限制`,
    );
    check(!grid.place && grid.castron === '', '範圍外的 rtsPlace 被拒絕；卡斯特隆不受導管影響');
    check(
      grid.nodes.every(Boolean) && grid.on.every(Boolean) && grid.links === 3 && grid.fields === 4,
      `串接三個節點：全部有電（連線 ${grid.links}、範圍 ${grid.fields}）`,
    );
    check(grid.labOn && grid.fenceOn && grid.fdSelf, '第 3 個節點旁的培養槽、雷射網有電；兵器廠的地基 0%');
    check(
      grid.q0 > 2 && grid.fd0 > 0 && grid.foeHit,
      `有電：生產計時 ${grid.q0.toFixed(1)}、地基自己長（${grid.fd0.toFixed(3)}）、雷射網開火（${grid.foeHit}）`,
    );
    check(
      grid.n3dark && grid.labOff && grid.fenceOff && grid.fdOff && grid.cap1 === grid.cap0 - 8,
      `拆中間的節點：後面的節點沒電、建築停擺、沒電的節點照給人口（${grid.cap0} → ${grid.cap1}：只少了拆掉的 8）`,
    );
    check(
      grid.qFrozen && grid.fdFrozen && grid.foeSafe && grid.offT > 5,
      `停擺：生產計時、施工都停住，雷射網不開火（停擺累計 ${grid.offT.toFixed(1)} 秒）`,
    );
    check(
      grid.labBack && grid.qMove && grid.fdGrow,
      `重蓋節點：立刻恢復供電、生產與施工繼續（${grid.labBack}／${grid.qMove}／${grid.fdGrow}）`,
    );

    // ---------- 汲取塔是根、臨時導管 ----------
    const tap = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      // 離研究中樞最遠的 Coral 湧出點
      const v = R.corals
        .filter((c) => !c.ext)
        .sort(
          (a, b) =>
            Math.hypot(b.pos.x - hq.pos.x, b.pos.z - hq.pos.z) -
            Math.hypot(a.pos.x - hq.pos.x, a.pos.z - hq.pos.z),
        )[0];
      o.whyFar = g.rtsPowerWhy(0, 'a_lab', v.pos.x + 9, v.pos.z);
      const t = g.rtsPlace(0, 'a_tap', v.pos.x, v.pos.z, 0, null); // 汲取塔不受導管限制
      o.tapPlaced = !!t;
      window.__sim(31);
      o.done = t && t.bld.progress >= 1;
      o.vent = t && t.bld.vent === v;
      const s = window.__spot(v.pos.x + 9, v.pos.z, 13, 13, 8);
      o.whyNear = s ? g.rtsPowerWhy(0, 'a_lab', s.x, s.z) : 'no spot';
      const c0 = R.teams[0].coral;
      window.__sim(4);
      o.rate = (R.teams[0].coral - c0) / 4;
      // 臨時導管：地圖上沒有電的地方，14 m、3 秒
      const p = { x: -hq.pos.x * 0.3, z: hq.pos.z * 0.9 };
      const ps = window.__spot(p.x, p.z, 13, 13, 30);
      o.why0 = g.rtsPowerWhy(0, 'a_lab', ps.x, ps.z);
      g.rtsPowerAddTemp(0, ps.x, ps.z, 14, 3);
      o.why1 = g.rtsPowerWhy(0, 'a_lab', ps.x, ps.z);
      const lab = g.rtsPlace(0, 'a_lab', ps.x, ps.z, 0, null);
      o.placed = !!lab && !lab.bld.off;
      window.__sim(3.6);
      o.why2 = g.rtsPowerWhy(0, 'a_lab', ps.x, ps.z);
      o.off = lab && lab.bld.off;
      if (lab) g.rtsCancel(lab, -1);
      return o;
    });
    check(tap.tapPlaced && tap.done && tap.vent, '汲取塔蓋在湧出點上、30 秒自己長好');
    check(
      tap.whyFar !== '' && tap.whyNear === '' && Math.abs(tap.rate - (1.25 + 0.15)) < 0.05,
      `汲取塔是根：旁邊可以蓋（之前「${tap.whyFar}」）；Coral ${tap.rate.toFixed(2)}／秒（汲取塔 1.25＋研究中樞 0.15）`,
    );
    check(
      tap.why0 !== '' && tap.why1 === '' && tap.placed && tap.why2 !== '' && tap.off,
      '臨時導管：3 秒內可以蓋、到期後停擺',
    );

    // ---------- 建築自己長（工人放下地基就回去採） ----------
    const sb = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const w = window.__of(0, 'a_worker')[0];
      const s = (() => {
        for (let r = 22; r >= 12; r -= 2)
          for (let a = 0; a < 24; a++) {
            const x = hq.pos.x + Math.cos(a / 3.8) * r,
              z = hq.pos.z + Math.sin(a / 3.8) * r;
            if (g.world.nav.buildable(x, z, 15, 13) && !g.rtsPowerWhy(0, 'a_foundry', x, z)) return { x, z };
          }
        return null;
      })();
      o.spot = !!s;
      const n0 = window.__of(0, 'a_foundry').length;
      g.rtsOrder([w], { k: 'build', def: 'a_foundry', x: s.x, z: s.z, yaw: 0 });
      window.__sim(25, () => window.__of(0, 'a_foundry').length > n0);
      const b = window.__of(0, 'a_foundry').find((e) => e !== window.__fd);
      window.__fd2 = b;
      o.placed = !!b;
      window.__sim(1);
      o.leave = w.orders[0] ? w.orders[0].k : 'none';
      o.builders = b ? b.bld.builders.size : -1;
      const t = window.__sim(60, () => b.bld.progress >= 1);
      o.t = t;
      o.hp = b.hp / b.maxHp;
      return o;
    });
    check(
      sb.spot && sb.placed && sb.leave === 'gather' && sb.builders === 0,
      `工人放下地基就回去採（指令 ${sb.leave}）`,
    );
    check(
      sb.t > 40 && sb.t < 52 && sb.hp > 0.95,
      `光學兵器廠沒有工人也自己長好（${sb.t.toFixed(1)} 秒，定義 50 秒；血量 ${(sb.hp * 100).toFixed(0)}%）`,
    );

    // ---------- 導管上的加成、建築回血、結晶護壁 ----------
    const buf = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const u = g.rtsSpawn(0, 'a_laser', hq.pos.x + 14, hq.pos.z);
      u.orders = [{ k: 'hold' }];
      const sp0 = u.speedMul;
      window.__sim(0.6);
      o.speedK = u.speedMul / sp0;
      u.hp = u.maxHp * 0.5;
      const h0 = u.hp;
      window.__sim(2);
      o.regen = (u.hp - h0) / 2;
      // 離開導管：0.6 秒後過期
      const far = window.__spot(0, 0, 3, 3, 40);
      u.pos.set(far.x, g.world.terrainHeight(far.x, far.z), far.z);
      g.rts.hash.update(u, far.x, far.z);
      o.outAt = !!g.rtsPowerAt(0, far.x, far.z);
      window.__sim(1.2);
      o.speedOut = u.speedMul / sp0;
      // 共振砲：導管上射程 +16
      const rs = g.rtsSpawn(0, 'a_reson', hq.pos.x - 14, hq.pos.z);
      rs.orders = [{ k: 'hold' }];
      window.__sim(0.6);
      o.reson = rs.rtsRangeAdd;
      // 建築：8 秒沒受傷才回血
      const lab = window.__lab;
      lab.hp = lab.maxHp; // 確定沒有其他回復
      g.rtsHit(lab, 300, 0, null, 'none');
      const b0 = lab.hp;
      window.__sim(5);
      o.early = lab.hp - b0;
      window.__sim(6);
      o.late = lab.hp - b0;
      // 結晶護壁：Coral 60、冷卻 90 秒、36 m 內的建築受到的傷害減半
      const fd = window.__fd2;
      const c0 = R.teams[0].coral;
      o.cast = g.rtsOrder([hq], { k: 'ability', ab: 'ab_aegis' });
      o.paid = c0 - R.teams[0].coral;
      o.taken = fd.rtsTakenK;
      o.labTaken = lab.rtsTakenK; // 很遠：沒有
      o.again = g.rtsOrder([hq], { k: 'ability', ab: 'ab_aegis' });
      o.why = g.rtsFactionAegisWhy(hq);
      window.__sim(15.6);
      o.after = fd.rtsTakenK;
      u.die(null);
      rs.die(null);
      return o;
    });
    check(
      Math.abs(buf.speedK - 1.15) < 0.01 && Math.abs(buf.regen - 2) < 0.3,
      `導管上的單位：速度 ×${buf.speedK.toFixed(2)}、每秒回 ${buf.regen.toFixed(2)} AP`,
    );
    check(!buf.outAt && Math.abs(buf.speedOut - 1) < 1e-6, '離開導管：加成過期');
    check(buf.reson === 16, `共振砲站在導管上射程 +${buf.reson}`);
    check(
      buf.early === 0 && buf.late > 0,
      `建築：受傷 8 秒內不回血（+${buf.early.toFixed(1)}）、之後回血（+${buf.late.toFixed(1)}）`,
    );
    check(
      buf.cast === 1 &&
        buf.paid === 60 &&
        buf.taken === 0.5 &&
        buf.labTaken === 1 &&
        buf.again === 0 &&
        /冷卻/.test(buf.why),
      `結晶護壁：扣 Coral ${buf.paid}、36 m 內的建築受到的傷害 ×${buf.taken}、遠處的不受影響、${buf.why}`,
    );
    check(buf.after === 1, '結晶護壁 15 秒後結束');

    // ---------- 融合 ----------
    const fu = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const mk = (n, x, z, def = 'a_blob') => {
        const L = [];
        for (let i = 0; i < n; i++)
          L.push(g.rtsSpawn(0, def, x + (i % 4) * 2.2, z + Math.floor(i / 4) * 2.2));
        return L;
      };
      const cx = hq.pos.x + 20 * Math.sign(-hq.pos.x || 1),
        cz = hq.pos.z;
      // T1：需求不滿足
      const b3 = mk(3, cx, cz);
      o.reqWhy = g.rtsFuseWhy(0, 'fu_chimera');
      o.req = g.rtsOrder(b3, { k: 'fuse', recipe: 'fu_chimera' });
      // T2（研究中樞升級，需要兵器廠）＋培養槽
      o.up = g.rtsUpgrade(hq, 'a_hq2');
      o.upT = window.__sim(55, () => hq.rtsDef === 'a_hq2');
      window.__sim(0.3);
      o.r30 = R.teams[0].power.srcs.find((s) => s.e === hq).r;
      // 融合 3 隻（一隻受傷到 40%）
      b3[0].hp = b3[0].maxHp * 0.4;
      const hpK = (0.4 + 1 + 1) / 3;
      g.rtsRecount();
      R.teams[0].income = 1e-9; // 量扣款時不算收入（研究中樞、汲取塔）
      const pop0 = R.teams[0].pop,
        c0 = R.teams[0].coral,
        lost0 = R.stats[0].lost;
      o.groups = g.rtsOrder(b3, { k: 'fuse', recipe: 'fu_chimera' });
      let popMid = -1;
      o.t = window.__sim(15, () => {
        if (R.fuses[0] && R.fuses[0].st === 'chan' && popMid < 0) {
          g.rtsRecount();
          popMid = R.teams[0].pop;
        }
        return window.__of(0, 'a_chimera').length > 0;
      });
      const ch = window.__of(0, 'a_chimera')[0];
      g.rtsRecount();
      o.chim = !!ch;
      o.pop = [pop0, popMid, R.teams[0].pop];
      o.paid = Math.round(c0 - R.teams[0].coral);
      R.teams[0].income = 0;
      o.hpK = ch ? ch.hp / ch.maxHp : 0;
      o.hpWant = hpK;
      o.blobs = b3.filter((e) => !e.dead).length;
      o.lost = R.stats[0].lost - lost0;
      o.fused = R.stats[0].fused;
      window.__chim = ch;
      // 7 隻＝兩組＋剩 1 隻
      const b7 = mk(7, cx, cz + 14);
      const G = g.rtsFuseGroups(b7, 'fu_chimera');
      o.g7 = [G.groups.length, G.left.length];
      o.n7 = g.rtsOrder(b7, { k: 'fuse', recipe: 'fu_chimera' });
      window.__sim(12, () => !R.fuses.length);
      o.chim7 = window.__of(0, 'a_chimera').length;
      o.left7 = b7.filter((e) => !e.dead).length;
      // 引導中宿主被擊破：全部損失
      const bk = mk(3, cx - 10, cz + 28);
      g.rtsOrder(bk, { k: 'fuse', recipe: 'fu_chimera' });
      window.__sim(10, () => R.fuses[0] && R.fuses[0].st === 'chan');
      const f = R.fuses[0];
      o.chan = !!f && f.st === 'chan';
      o.hostTaken = f ? f.host.rtsTakenK : 0;
      const nch = window.__of(0, 'a_chimera').length;
      if (f) f.host.die(null);
      window.__sim(6);
      o.killed = [R.fuses.length, window.__of(0, 'a_chimera').length - nch, bk.filter((e) => !e.dead).length];
      // 集合不了（10 秒）：取消、不扣款
      const sp = mk(3, cx, cz - 14);
      const c1 = R.teams[0].coral;
      g.rtsOrder(sp, { k: 'fuse', recipe: 'fu_chimera' });
      for (const e of sp) e.updateAI = () => {}; // 不動
      sp[1].pos.x += 12;
      window.__sim(11);
      o.timeout = [R.fuses.length, R.teams[0].coral - c1 > -1e-6, sp.filter((e) => !e.dead).length];
      for (const e of sp) e.die(null);
      // 原型體要 T3＋r_proto
      o.protoWhy = g.rtsFuseWhy(0, 'fu_proto');
      return o;
    });
    check(/T2|培養槽/.test(fu.reqWhy) && fu.req === 0, `融合的需求：T1 時「${fu.reqWhy}」`);
    check(
      fu.up && fu.upT > 45 && fu.upT < 52 && fu.r30 === 30,
      `研究中樞升級 T2（${fu.upT.toFixed(1)} 秒，導管 30 m）`,
    );
    check(
      fu.groups === 1 && fu.chim && fu.blobs === 0 && fu.t > 3.5 && fu.t < 10,
      `3 隻實驗體 → 嵌合體（${fu.t.toFixed(1)} 秒）`,
    );
    check(
      fu.paid === 25 && fu.pop[0] === fu.pop[1] && fu.pop[1] === fu.pop[2],
      `融合扣 Coral ${fu.paid}、人口不變（${fu.pop.join(' → ')}）`,
    );
    check(
      Math.abs(fu.hpK - fu.hpWant) < 0.02 && fu.lost === 0 && fu.fused === 3,
      `血量依材料的平均比例（${(fu.hpK * 100).toFixed(0)}%）；材料不算陣亡、融合統計 ${fu.fused}`,
    );
    check(
      fu.g7.join() === '2,1' && fu.n7 === 2 && fu.chim7 === 3 && fu.left7 === 1,
      `多選 7 隻：${fu.g7[0]} 組＋剩 ${fu.g7[1]} 隻（嵌合體共 ${fu.chim7}）`,
    );
    check(
      fu.chan && fu.hostTaken === 1.25 && fu.killed.join() === '0,0,0',
      `引導中宿主受到的傷害 ×${fu.hostTaken}；被擊破＝全部損失（${fu.killed.join('／')}）`,
    );
    check(fu.timeout.join() === '0,true,3', `10 秒沒到齊：取消、不扣款（${fu.timeout.join('／')}）`);
    check(/T3|原型體協定/.test(fu.protoWhy), `原型融合要 T3＋研究（${fu.protoWhy}）`);

    // ---------- 幻象 ----------
    const il = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq = window.__hq;
      const o = {};
      const src = g.rtsSpawn(0, 'a_laser', hq.pos.x + 10, hq.pos.z + 10);
      g.rtsRecount();
      const pop0 = R.teams[0].pop,
        lost0 = R.stats[0].lost,
        made0 = R.stats[0].made;
      const e = g.rtsIllusion(src, src.pos.x + 3, src.pos.z, { sec: 3, hp: 1 });
      g.rtsRecount();
      o.pop = R.teams[0].pop - pop0;
      o.hp = e.maxHp;
      o.dmg = e.dmgMul;
      o.def = e.rtsDef;
      g.rtsHit(e, 50, 0, null, 'kin');
      window.__sim(0.2);
      o.dead = e.dead;
      o.hpAfter = e.hp;
      o.lost = R.stats[0].lost - lost0;
      o.made = R.stats[0].made - made0;
      const e2 = g.rtsIllusion(src, src.pos.x - 3, src.pos.z, { sec: 1, dmg: 0.25, taken: 2 });
      o.taken = e2.rtsTakenK;
      o.dmg2 = e2.dmgMul;
      window.__sim(1.6);
      o.expired = e2.dead;
      const L = [];
      for (let i = 0; i < 26; i++)
        L.push(
          g.rtsIllusion(src, src.pos.x + (i % 6) * 2, src.pos.z + 6 + Math.floor(i / 6) * 2, { sec: 30 }),
        );
      window.__sim(0.1);
      o.cap = g.rtsIllusionsOf(0).length;
      o.oldGone = L[0].dead && L[1].dead && !L[2].dead;
      for (const x of L) g.rtsIllusionEnd(x);
      src.die(null);
      return o;
    });
    check(
      il.pop === 0 && il.hp === 1 && il.dmg === 0 && il.def === 'a_laser',
      `幻象：不佔人口、血量 ${il.hp}、傷害 ×${il.dmg}`,
    );
    check(
      il.dead && il.lost === 0 && il.made === 0,
      `幻象打一下就消失；不算陣亡與生產（${il.dead}／${il.hpAfter}／${il.lost}／${il.made}）`,
    );
    check(il.taken === 2 && il.dmg2 === 0.25 && il.expired, '分身的傷害與受到的傷害倍率、到期移除');
    check(il.cap === 24 && il.oldGone, `一隊最多 24 個幻象（最舊的先消失）`);

    // ---------- 截圖：導管網（連線以預警線、範圍以地面的圓環標出；B、E 包的外觀之前的除錯顯示）與融合 ----------
    await ev(() => {
      const g = window.__game,
        T3 = window.THREE;
      const hq = window.__hq,
        n = window.__nodes[2];
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
      if (g.rtsCamJump) g.rtsCamJump((hq.pos.x + n.pos.x) / 2, (hq.pos.z + n.pos.z) / 2);
      if (g.rts.cam) g.rts.cam.dist = 150;
      const grp = new T3.Group();
      for (const [a, b, on] of g.rtsPowerLinks(0)) {
        const A = new T3.Vector3(a.x, g.world.terrainHeight(a.x, a.z) + 0.6, a.z);
        const B = new T3.Vector3(b.x, g.world.terrainHeight(b.x, b.z) + 0.6, b.z);
        g.fx.warnLine(A, B, 5, on ? 0x5ab8ff : 0x666666, 0.5);
      }
      for (const f of g.rtsPowerFields(0)) {
        const m = new T3.Mesh(
          new T3.RingGeometry(f.r - 0.6, f.r, 64),
          new T3.MeshBasicMaterial({
            color: f.on ? 0x5ab8ff : 0x777777,
            transparent: true,
            opacity: 0.6,
            side: 2,
          }),
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(f.x, g.world.terrainHeight(f.x, f.z) + 0.4, f.z);
        grp.add(m);
      }
      g.scene.add(grp);
      window.__dbg = grp;
      window.__pump(0.4, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3a-grid.png') });
    await ev(() => {
      const g = window.__game,
        ch = window.__chim;
      g.scene.remove(window.__dbg);
      if (g.rts.cam) g.rts.cam.dist = 45;
      if (g.rtsCamJump && ch && !ch.dead) g.rtsCamJump(ch.pos.x, ch.pos.z);
      window.__pump(0.4, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3a-fuse.png') });

    // ---------- 隨機陣營、兩邊都是艾瑟立克、選單 ----------
    const rnd = await ev(() => {
      const g = window.__game;
      const o = { seen: {} };
      const pick = (seed) => {
        g.rtsStart({
          theme: 'wasteland',
          seed,
          size: 400,
          faction: 'random',
          aiFaction: 'random',
          diff: 'normal',
        });
        const R = g.rts;
        return [R.teams[0].faction, R.teams[1].faction, R.cfg.rand.join()];
      };
      const a = pick(11),
        b = pick(11);
      o.same = a.join() === b.join();
      o.a = a.join();
      for (const s of [3, 5, 8, 13, 21, 34]) for (const f of pick(s).slice(0, 2)) o.seen[f] = 1;
      // 兩邊都是艾瑟立克
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'aetheric',
        aiFaction: 'aetheric',
        diff: 'normal',
      });
      const R = g.rts;
      o.both = [0, 1].map((t) => R.units.filter((e) => e.rtsTeam === t && e.rtsDef === 'a_hq').length).join();
      o.both2 = [0, 1]
        .map((t) => R.units.filter((e) => e.rtsTeam === t && e.rtsDef === 'a_worker').length)
        .join();
      // cfg.aiFactions；電腦是艾瑟立克（F 包之前沒有它的開局）：跑 90 秒不出錯、卡斯特隆的電腦照常
      g.rtsAiOff = false;
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        aiBoth: true,
        aiFactions: ['castron', 'aetheric'],
      });
      o.ai = g.rts.teams
        .slice(0, 2)
        .map((T) => T.faction)
        .join();
      try {
        window.__sim(90);
      } catch (e) {
        o.aiErr = String(e && e.message);
      }
      o.aiC = g.rts.units.filter((e) => e.rtsTeam === 0 && !e.dead).length;
      g.rtsAiOff = true;
      // 選單：陣營按鈕、隨機、說明
      g.rtsMenuOpen();
      const el = document.getElementById('rtsMenu');
      const btn = el.querySelector('[data-pf="aetheric"]');
      o.btn = !!btn && !btn.disabled;
      o.rand = !!el.querySelector('[data-pf="random"]') && !!el.querySelector('[data-af="random"]');
      btn.click();
      o.traits = (document.querySelector('#rtsMenu .rtsFacTraits') || {}).textContent || '';
      o.rec = (document.querySelector('#rtsMenu .rtsRec') || {}).textContent || '';
      return o;
    });
    check(
      rnd.same && rnd.seen.castron && rnd.seen.aetheric,
      `隨機陣營依種子固定（種子 11：${rnd.a}），兩個陣營都會出現`,
    );
    check(rnd.both === '1,1' && rnd.both2 === '5,5', '兩邊都是艾瑟立克：各一座研究中樞、5 台研究作業機');
    check(rnd.ai === 'castron,aetheric', 'cfg.aiFactions 指定兩邊的陣營');
    check(
      !rnd.aiErr && rnd.aiC > 6,
      `電腦是艾瑟立克時跑 90 秒不出錯（${rnd.aiErr || '卡斯特隆的電腦 ' + rnd.aiC + ' 個實體'}）`,
    );
    check(
      rnd.btn && rnd.rand && /導管/.test(rnd.traits) && /艾瑟立克/.test(rnd.rec),
      `選單：艾瑟立克可以選、隨機、說明（${rnd.traits.slice(0, 20)}…）、戰績（${rnd.rec}）`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r3a-menu.png') });
    await ctx.close();
  }

  return { testRtsAeth };
};
