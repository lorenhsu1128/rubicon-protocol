// Coral 戰爭（RTS）R4 D 包（地圖主題與中立）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-veer-d')(H)。
// testRtsThemes2：舊宇宙港外圍 spaceport、Grid 086 地表 grid086 各 3 個種子開局：主題覆寫（沒有岩頂、不疊加時間）、
// 對稱（高度、障礙物、資源、營地、中立建築、發射台與台階）、尋路（兩邊到營地、礦脈、發射台頂面、台階上層的路徑代價相等）、
// 發射台（頂面高度、可以蓋、坡道上得去、發射塔）、防爆牆列（離通道 WALL_GAP 以上）、構造體台階（兩層的高度、頂層可以蓋、
// 金屬牆與鋼板接縫是不碰撞的裝飾）、迷霧（障礙物與裝飾的靜態合併與迷霧著色）、營地（主題的野怪、整營出動與交戰）、
// 傭兵營（主題的名單、雇用、試車台不移動）、誘導飛彈架的野怪打空中單位、畫面亮度（同 testStyleThemes 的範圍）；
// 截圖 rts-r4-map-<主題>.png（俯視）與 -near.png（近景）。電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉。
/* global window, document */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  const THEMES = {
    spaceport: {
      creeps: ['cr_testrig', 'cr_spacemt', 'cr_fueler', 'cr_rack', 'cr_mt', 'cr_mth', 'cr_ac_'],
      mercs: ['m_spacemt', 'm_fueler', 'm_rack', 'm_testrig'],
    },
    grid086: {
      creeps: ['cr_crawler', 'cr_zipline', 'cr_anchor', 'cr_mt', 'cr_scout', 'cr_mth', 'cr_ac_'],
      mercs: ['m_crawler', 'm_zipline', 'm_anchor', 'm_mth'],
    },
  };
  const SEEDS = [7, 23, 101];

  async function testRtsThemes2(browser, base) {
    console.log('Coral 戰爭：舊宇宙港外圍與 Grid 086 地表（R4 地圖主題、營地、傭兵）');
    const { ctx, page } = await newPage(browser, 'rtsThemes2');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    // 畫面中央（避開 HUD）縮成 96×64 量亮度（同 testStyleThemes）
    const measure = async () => {
      const clip = { x: 200, y: 80, width: 1200, height: 600 };
      const b64 = (await page.screenshot({ clip })).toString('base64');
      return ev(async (b64) => {
        const img = new window.Image();
        img.src = 'data:image/png;base64,' + b64;
        await img.decode();
        const cv = document.createElement('canvas');
        cv.width = 96;
        cv.height = 64;
        const c = cv.getContext('2d');
        c.drawImage(img, 0, 0, 96, 64);
        const d = c.getImageData(0, 0, 96, 64).data;
        let sum = 0,
          hi = 0,
          lo = 0;
        const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) {
          const y = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          sum += y;
          if (y > 0.96) hi++;
          if (y < 0.04) lo++;
        }
        return { mean: sum / n, hi: hi / n, lo: lo / n };
      }, b64);
    };

    for (const theme of Object.keys(THEMES)) {
      const T = THEMES[theme];
      for (const seed of SEEDS) {
        const full = seed === SEEDS[0];
        const r = await ev(
          ({ theme, seed, T }) => {
            const g = window.__game;
            g.rtsAiOff = true;
            g.rtsStart({ theme, seed, size: 400, faction: 'castron', aiFaction: 'castron', diff: 'normal' });
            const R = g.rts,
              w = g.world,
              plan = w.rts,
              nav = w.nav;
            window.__sim = (sec, until, dt = 1 / 20) => {
              let t = 0;
              for (; t < sec; t += dt) {
                if (until && until()) return t;
                g.rtsSim(dt);
                if (g.rtsFogTick) g.rtsFogTick(dt); // 迷霧決定 noLock（看不到的打不到）
              }
              return until && !until() ? -1 : t;
            };
            const near = (a, b) => Math.abs(a - b) < 1e-4;
            const out = { theme: w.themeKey, ok: plan.ok, errs: [] };
            const err = (s) => out.errs.push(s);
            out.roof = !!w.theme.roof;
            out.noTod = !!w.theme.noTod;
            out.weather = w.weather ? w.weather.kind || 'on' : '';
            // 對稱：高度（隨機取樣）、障礙物、資源、營地、中立建築、發射台與台階
            let asym = 0;
            for (let k = 0; k < 400; k++) {
              const x = (Math.sin(k * 12.9898) * 0.5 + Math.cos(k * 3.1)) * 90,
                z = (Math.cos(k * 78.233) * 0.5 + Math.sin(k * 1.7)) * 90;
              if (Math.abs(w.terrainHeight(x, z) - w.terrainHeight(-x, -z)) > 1e-3) asym++;
            }
            if (asym) err(`高度不對稱 ${asym}／400`);
            const pairOf = (arr, get) =>
              arr.every((a) => arr.some((b) => near(get(b).x, -get(a).x) && near(get(b).z, -get(a).z)));
            if (!pairOf(plan.obstacles, (o) => o)) err('障礙物不對稱');
            if (!pairOf(R.mines, (m) => m.pos)) err('礦脈不對稱');
            if (!pairOf(R.corals || [], (m) => m.pos)) err('湧出點不對稱');
            if (!pairOf(R.camps, (c) => c.pos)) err('營地不對稱');
            if (!pairOf(R.neutrals, (q) => q.ent.pos)) err('中立建築不對稱');
            if (!pairOf(plan.pads || [], (q) => q.pos)) err('發射台不對稱');
            if (!pairOf(plan.steps || [], (q) => q.pos)) err('台階不對稱');
            if (!pairOf(plan.decor || [], (q) => q)) err('裝飾不對稱');
            const sig = (c) => c.set.join(',');
            for (let i = 0; i + 1 < R.camps.length; i += 2)
              if (sig(R.camps[i]) !== sig(R.camps[i + 1]) || R.camps[i].tier !== R.camps[i + 1].tier)
                err('營地編成不對稱 ' + i);
            out.neutrals = R.neutrals.length;
            // 尋路：兩邊的坡道下到營地、礦脈、發射台頂面、台階上層（可以走的格子）的路徑代價
            const [bA, bB] = plan.bases;
            const A0 = bA.ramp.bottom,
              B0 = bB.ramp.bottom;
            out.path = nav.findPath(A0, B0, 1).length;
            let worst = 0;
            const cellNear = (p, size = 1) => {
              const c = nav.nearestCell(p.x, p.z, size, -1, 10);
              return c >= 0 ? nav.center(c) : p;
            };
            const tops = [
              ...(plan.pads || []).filter((q) => q.near === 0).map((q) => q.pos),
              ...(plan.steps || []).filter((q) => q.near === 0).map((q) => q.top),
            ];
            for (const p of [
              ...R.camps.filter((c) => c.near === 0).map((c) => c.pos),
              ...R.mines.map((m) => m.pos),
              ...tops,
            ]) {
              const ca = nav.pathCost(A0, cellNear(p), 1),
                cb = nav.pathCost(B0, cellNear({ x: -p.x, z: -p.z }), 1);
              if (!isFinite(ca) || !isFinite(cb)) {
                err('到不了 ' + Math.round(p.x) + ',' + Math.round(p.z));
                continue;
              }
              worst = Math.max(worst, Math.abs(ca - cb) / Math.max(ca, cb, 1));
            }
            out.worst = worst;
            out.tops = tops.length;
            // 頂面：高度、可以蓋（8×8，中心附近找得到）、大型單位到得了
            const buildNear = (p) =>
              [0, 2, -2, 4, -4].some((ox) =>
                [0, 2, -2, 4, -4].some((oz) => nav.buildable(p.x + ox, p.z + oz, 8, 8)),
              );
            out.topErr = [];
            for (const q of plan.pads || []) {
              if (Math.abs(w.terrainHeight(q.pos.x, q.pos.z) - q.h) > 0.4) out.topErr.push('發射台高度');
              if (!buildNear(q.pos)) out.topErr.push('發射台頂面不能蓋');
              if (!nav.reachable(cellNear(q.ramp.bottom, 2), cellNear(q.pos, 2), 2))
                out.topErr.push('發射台坡道上不去（大型）');
            }
            for (const q of plan.steps || []) {
              const y = w.terrainHeight(q.top.x, q.top.z);
              if (Math.abs(y - q.h1 - q.h2) > 0.4) out.topErr.push('台階上層高度');
              // 下層：地面坡道的上端
              const t1 = q.ramps[0].top;
              if (Math.abs(w.terrainHeight(t1.x, t1.z) - q.h1) > 0.6) out.topErr.push('台階下層高度');
              if (!buildNear(q.top)) out.topErr.push('台階上層不能蓋');
              if (!nav.reachable(cellNear(q.ramps[0].bottom, 2), cellNear(q.top, 2), 2))
                out.topErr.push('台階上不去（大型）');
            }
            out.pads = (plan.pads || []).length;
            out.steps = (plan.steps || []).length;
            // 防爆牆列：離通道的路徑 WALL_GAP（3 m）以上
            const rows = plan.obstacles.filter((o) => o.row);
            out.walls = rows.length;
            let wallNear = 0;
            for (const ln of plan.lanes)
              for (let k = 1; k < ln.length; k++)
                for (let s = 0; s <= 20; s++) {
                  const x = ln[k - 1].x + ((ln[k].x - ln[k - 1].x) * s) / 20,
                    z = ln[k - 1].z + ((ln[k].z - ln[k - 1].z) * s) / 20;
                  for (const o of rows)
                    if (
                      Math.max(Math.abs(x - o.x) - o.w / 2, 0) ** 2 +
                        Math.max(Math.abs(z - o.z) - o.d / 2, 0) ** 2 <
                      9
                    )
                      wallNear++;
                }
            out.wallNear = wallNear;
            // 裝飾（金屬牆、鋼板接縫）不是障礙物
            out.decor = (plan.decor || []).length;
            out.decorObs = w.obstacles.filter((o) =>
              (plan.decor || []).some((d) => Math.hypot(o.x - d.x, o.z - d.z) < 0.01),
            ).length;
            out.g86wall = (plan.decor || []).filter((d) => d.model === 'g86wall').length;
            // 營地：主題的野怪
            const allowed = (id) => T.creeps.some((c) => id === c || (c.endsWith('_') && id.startsWith(c)));
            const ids = R.camps.flatMap((c) => c.set);
            out.campIds = [...new Set(ids)].sort();
            if (!ids.every(allowed))
              err('營地有別的主題的野怪：' + ids.filter((id) => !allowed(id)).join(','));
            out.creeps = R.units.filter((e) => e.creep && !e.dead).length;
            out.creepIds = ids.length;
            const merc = R.neutrals.find((q) => q.kind === 'merc');
            out.mercStock = Object.keys(merc.stock).sort();
            out.mercCard = g.rtsUiDef
              ? (g.rtsUiDef(merc.ent).card || []).map((c) => c.act && c.act.merc)
              : [];
            // 迷霧：障礙物與裝飾合併成世界座標的網格、迷霧著色開啟
            const merged = w.scene.children.filter((m) => m.userData && m.userData.rtsProps);
            out.merged = merged.length;
            out.mergedFog = merged.every(
              (m) => m.geometry.attributes.rtsC && m.material.customProgramCacheKey().includes('rtsPropFog'),
            );
            // 每個裝飾的位置（rtsC）都在合併的網格裡（發射塔、金屬牆…）
            const cs = new Set();
            for (const m of merged) {
              const a = m.geometry.attributes.rtsC.array;
              for (let i = 0; i < a.length; i += 2)
                cs.add(Math.round(a[i] * 10) + ',' + Math.round(a[i + 1] * 10));
            }
            const key = (o) => Math.round(o.x * 10) + ',' + Math.round(o.z * 10);
            out.towerMerged = plan.obstacles
              .filter((o) => o.model === 'launchtower')
              .every((o) => cs.has(key(o)));
            out.decorMerged = (plan.decor || []).filter((d) => cs.has(key(d))).length;
            return out;
          },
          { theme, seed, T },
        );
        const tag = `${theme}（種子 ${seed}）`;
        check(r.theme === theme && r.ok, `${tag}：開局、地圖產生器合格`);
        check(
          !r.roof && r.noTod && (theme === 'spaceport' ? !r.weather : !!r.weather),
          `${tag}：主題覆寫（沒有岩頂、不疊加時間、天候 ${r.weather || '晴'}）`,
        );
        check(
          !r.errs.length,
          `${tag}：對稱與尋路（${r.errs.slice(0, 3).join('；') || '高度、障礙物、資源、營地、中立建築、結構'}）`,
        );
        check(
          r.path > 1 && r.worst < 0.03 && r.tops >= 1,
          `${tag}：基地到基地有路徑、兩邊到營地、礦脈與${theme === 'spaceport' ? '發射台' : '台階'}頂面的路徑代價差 ${(r.worst * 100).toFixed(2)}%`,
        );
        check(
          !r.topErr.length,
          `${tag}：${theme === 'spaceport' ? `發射台 ${r.pads} 個` : `台階 ${r.steps} 組`}（高度、頂面可以蓋、大型單位上得去${r.topErr.length ? '：' + r.topErr.join('；') : ''}）`,
        );
        if (theme === 'spaceport')
          check(
            r.pads === 2 && r.walls >= 12 && r.wallNear === 0 && r.towerMerged,
            `${tag}：防爆牆列 ${r.walls} 段（離通道 3 m 以上）、發射塔合併`,
          );
        else
          check(
            r.steps === 4 && r.g86wall > 0 && r.decorObs === 0 && r.decorMerged > r.decor * 0.8,
            `${tag}：金屬牆 ${r.g86wall} 段、裝飾 ${r.decor} 個都不碰撞、合併 ${r.decorMerged}`,
          );
        check(
          r.neutrals === 5 && r.creeps === r.creepIds && r.creeps > 10,
          `${tag}：中立建築 5 棟、野怪 ${r.creeps} 台（${r.campIds.join(' ')}）`,
        );
        check(
          JSON.stringify(r.mercStock) === JSON.stringify([...T.mercs].sort()) &&
            (!r.mercCard.length || JSON.stringify(r.mercCard) === JSON.stringify(T.mercs)),
          `${tag}：傭兵營是這個主題的名單（${r.mercStock.join(' ')}）、指令卡相同`,
        );
        check(r.merged > 0 && r.mergedFog, `${tag}：障礙物靜態合併 ${r.merged} 個網格、都有迷霧著色`);
        if (!full) continue;

        // ---------- 空中單位飛越最高的障礙物（發射塔、排氣煙囪；整合） ----------
        const fl = await ev(() => {
          const g = window.__game,
            R = g.rts,
            w = g.world;
          let best = null,
            bh = 0;
          const L = w.lim - 20;
          for (const o of w.obstacles) {
            if (o.top === undefined || Math.abs(o.x) > L || Math.abs(o.z) > L) continue;
            const h = o.top - w.terrainHeight(o.x, o.z);
            if (h > bh) ((bh = h), (best = o));
          }
          if (!best) return { none: true };
          // 從障礙物一側 18 m 飛到另一側 18 m（直線穿過障礙物中心）
          const a = Math.atan2(best.z, best.x) + Math.PI / 2;
          const ax = best.x + Math.cos(a) * 18,
            az = best.z + Math.sin(a) * 18,
            bx = best.x - Math.cos(a) * 18,
            bz = best.z - Math.sin(a) * 18;
          const u = g.rtsSpawn(0, 'v_heli', ax, az, 0);
          u.hp = u.maxHp = 1e6;
          u.pos.y = w.terrainHeight(ax, az) + 7;
          g.rtsOrder([u], { k: 'move', x: bx, z: bz });
          let maxY = 0,
            pass = 0;
          for (let t = 0; t < 20; t += 0.05) {
            g.rtsSim(0.05);
            maxY = Math.max(maxY, u.pos.y);
            if (Math.hypot(u.pos.x - best.x, u.pos.z - best.z) < 3) pass++;
            if (Math.hypot(u.pos.x - bx, u.pos.z - bz) < 2) break;
          }
          const out = {
            kind: best.kind,
            h: +bh.toFixed(1),
            top: +best.top.toFixed(1),
            maxY: +maxY.toFixed(1),
            d: +Math.hypot(u.pos.x - bx, u.pos.z - bz).toFixed(1),
            pass,
          };
          u.rtsQuiet = true;
          u.die(null);
          g.rtsSim(0.05);
          return out;
        });
        if (!fl.none)
          check(
            fl.d < 3 && fl.maxY > fl.top,
            `${tag}：攻擊直升機飛越最高的障礙物（${fl.kind} 高 ${fl.h} m、頂 ${fl.top}；最高 ${fl.maxY}、離終點 ${fl.d} m）`,
          );

        // ---------- 第一個種子：傭兵、營地交戰、誘導飛彈架打空中、截圖與亮度 ----------
        const b = await ev(
          ({ theme, T }) => {
            const g = window.__game,
              R = g.rts,
              w = g.world,
              nav = w.nav;
            const out = {};
            const spot = (x, z, size = 1) => {
              const c = nav.nearestCell(x, z, size, -1, 12);
              return c >= 0 ? nav.center(c) : { x, z };
            };
            const merc =
              R.neutrals.find((q) => q.kind === 'merc' && q.near === 0) ||
              R.neutrals.find((q) => q.kind === 'merc');
            R.teams[0].ore = R.teams[0].coral = 20000;
            const m = merc.ent;
            const sp = spot(m.pos.x + Math.sin(m.yaw) * 10, m.pos.z + Math.cos(m.yaw) * 10);
            g.rtsSpawn(0, 'c_mt', sp.x, sp.z, 0);
            g.rtsRecount();
            out.hired = {};
            let rig = null;
            for (const id of T.mercs) {
              const before = R.units.filter((e) => !e.dead && e.rtsDef === id && e.rtsTeam === 0).length;
              R.teams[0].cap = 150;
              const pop0 = R.teams[0].pop;
              const e = g.rtsMercHire(0, merc, id);
              if (id === 'm_testrig') rig = e;
              const after = R.units.filter((x) => !x.dead && x.rtsDef === id && x.rtsTeam === 0).length;
              out.hired[id] = { ok: !!e, n: after - before, pop: R.teams[0].pop - pop0 };
            }
            // 試車台不移動：雇用時一起出現的單位推開之後，下移動指令 4 秒後還在原地
            if (rig) {
              window.__sim(3);
              const p0 = { x: rig.pos.x, z: rig.pos.z };
              g.rtsOrder([rig], { k: 'move', x: p0.x + 20, z: p0.z + 20 });
              window.__sim(4);
              out.rigMoved = Math.hypot(rig.pos.x - p0.x, rig.pos.z - p0.z);
              out.rigToward = Math.hypot(20, 20) - Math.hypot(p0.x + 20 - rig.pos.x, p0.z + 20 - rig.pos.z);
            }
            // 營地交戰：最近的小營地旁放 5 台 MT（和營地同高），整營出動、互相打到
            const camp = R.camps.filter((c) => c.near === 0 && c.tier === 1)[0] || R.camps[0];
            const units = [];
            let ang = 0;
            for (let a = 0; a < 6.28; a += 0.3) {
              const q = spot(camp.pos.x + Math.cos(a) * 11, camp.pos.z + Math.sin(a) * 11);
              if (Math.abs(w.terrainHeight(q.x, q.z) - camp.pos.y) < 1 && nav.reachable(q, camp.pos, 1)) {
                ang = a;
                break;
              }
            }
            for (let k = 0; k < 5; k++) {
              const p = spot(
                camp.pos.x + Math.cos(ang) * (11 + k * 1.5),
                camp.pos.z + Math.sin(ang) * (11 + k * 1.5),
              );
              const u = g.rtsSpawn(0, 'c_mt', p.x, p.z, 0);
              u.hp = u.maxHp = 5000;
              units.push(u);
            }
            const hp0 = units.reduce((s, u) => s + u.hp, 0);
            const ch0 = [...camp.ents].reduce((s, e) => s + e.hp, 0);
            g.rtsOrder(units, { k: 'amove', x: camp.pos.x, z: camp.pos.z });
            window.__sim(20, () => camp.st === 'fight' && units.reduce((s, u) => s + u.hp, 0) < hp0 - 50);
            window.__sim(8);
            out.campSt = camp.st;
            out.campSet = camp.set.join(',');
            out.dealt = hp0 - units.reduce((s, u) => s + Math.max(0, u.hp), 0);
            out.taken = ch0 - [...camp.ents].reduce((s, e) => s + (e.dead ? 0 : e.hp), 0);
            for (const u of units) if (!u.dead) u.die();
            window.__sim(0.5);
            // 誘導飛彈架的野怪（地空）：營地裡的或另外放一台中立的，旁邊放一架武裝直升機
            if (theme === 'spaceport') {
              let rack = R.units.find((e) => e.creep && !e.dead && e.rtsDef === 'cr_rack');
              const c0 = R.camps.find((c) => c.near === 0 && c.st !== 'done') || R.camps[0];
              if (!rack) {
                const p = spot(c0.pos.x + 3, c0.pos.z + 3);
                rack = g.rtsSpawn(2, 'cr_rack', p.x, p.z, 0);
              }
              const c = rack.rtsCamp || c0;
              const p = spot(rack.pos.x + 10, rack.pos.z + 4);
              const heli = g.rtsSpawn(0, 'c_heli', p.x, p.z, 0);
              heli.hp = heli.maxHp = 20000;
              const h0 = heli.hp;
              g.rtsOrder([heli], { k: 'hold' });
              window.__sim(12, () => heli.hp < h0 - 50);
              out.rackHit = h0 - heli.hp;
              out.rackSt = c ? c.st : '';
              heli.die();
              window.__sim(0.3);
            }
            return out;
          },
          { theme, T },
        );
        const hired = Object.entries(b.hired);
        check(
          hired.every(([, h]) => h.ok && h.n === 1 && h.pop > 0),
          `${theme}：傭兵 4 種都能雇用（${hired.map(([id, h]) => `${id}×${h.n} 人口 +${h.pop}`).join('、')}）`,
        );
        if (theme === 'spaceport') {
          check(
            b.rigMoved !== undefined && b.rigMoved < 1.5 && b.rigToward < 1,
            `${theme}：試車台（傭兵）不會走向移動指令的地點（位移 ${(b.rigMoved || 0).toFixed(2)} m，只有被推擠）`,
          );
          check(
            b.rackHit > 0,
            `${theme}：誘導飛彈架的野怪打空中單位（武裝直升機受到 ${Math.round(b.rackHit || 0)}）`,
          );
        }
        check(
          b.dealt > 0 && b.taken > 0,
          `${theme}：營地（${b.campSet}）出動交戰：野怪打出 ${Math.round(b.dealt)}、受到 ${Math.round(b.taken)}（${b.campSt}）`,
        );
        // 截圖：俯視（整個中央）與近景（發射台或台階），量亮度
        for (const v of ['map', 'near']) {
          await ev(
            ({ v, theme }) => {
              const g = window.__game,
                R = g.rts,
                plan = g.world.rts;
              if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
              let p = { x: 0, z: 0 };
              if (v === 'near') {
                const q = theme === 'spaceport' ? plan.pads[0].pos : plan.steps[0].top;
                p = { x: q.x, z: q.z };
              }
              if (g.rtsCamJump) g.rtsCamJump(p.x, p.z);
              if (R.cam) R.cam.dist = v === 'map' ? 230 : 60;
              window.__pump(0.3, null, 1 / 30);
            },
            { v, theme },
          );
          const m = await measure();
          await page.screenshot({
            path: path.join(SHOT_DIR, `rts-r4-map-${theme}${v === 'near' ? '-near' : ''}.png`),
          });
          check(
            m.mean <= 0.82 && m.hi <= 0.25 && m.mean >= 0.08 && m.lo <= 0.45,
            `${theme} 的${v === 'map' ? '俯視' : '近景'}亮度（平均 ${m.mean.toFixed(2)}、過曝 ${Math.round(m.hi * 100)}%、死黑 ${Math.round(m.lo * 100)}%）`,
          );
        }
      }
    }
    await ctx.close();
  }

  return { testRtsThemes2 };
};
