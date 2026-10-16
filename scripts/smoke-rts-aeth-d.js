// Coral 戰爭（RTS）R3 D 包（地圖主題與中立）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-aeth-d')(H)。
// testRtsThemes：冰原 snow、技研都市地表 institute 各 3 個種子開局：主題覆寫（沒有岩頂、不疊加時間）、
// 對稱（高度、障礙物、資源、營地、中立建築）、尋路（兩邊到營地與要點的路徑代價相等、基地到基地）、
// 冰湖（冰面高度、不能蓋、在通道上、冰上變快）、技研都市的湧出點 6 個與 Coral 脈（不擋路、和障礙物一起合併）、
// 迷霧（障礙物的靜態合併與迷霧著色）、營地（主題的野怪、整營出動與交戰）、傭兵營（主題的名單、雇用、實驗體一次 2 隻）、
// 畫面亮度（同 testStyleThemes 的範圍）；截圖 rts-r3-map-<主題>.png（俯視）與 -near.png（近景）。
// 電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉。
/* global window, document */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  const THEMES = {
    snow: {
      creeps: ['cr_lurker', 'cr_skater', 'cr_cryo', 'cr_icemortar', 'cr_mt', 'cr_mth', 'cr_ac_'],
      mercs: ['m_lurker', 'm_skater', 'm_cryo', 'm_icemortar'],
    },
    institute: {
      creeps: [
        'cr_blob',
        'cr_parasite',
        'cr_holo',
        'cr_chimera',
        'cr_laserpost',
        'cr_mt',
        'cr_mth',
        'cr_ac_',
      ],
      mercs: ['m_blob', 'm_parasite', 'm_holo', 'm_chimera'],
    },
  };
  const SEEDS = [7, 23, 101];

  async function testRtsThemes(browser, base) {
    console.log('Coral 戰爭：冰原與技研都市地表（R3 地圖主題、營地、傭兵）');
    const { ctx, page } = await newPage(browser, 'rtsThemes');
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
          ({ theme, seed, full, T }) => {
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
            // 主題覆寫
            out.roof = !!w.theme.roof;
            out.noTod = !!w.theme.noTod;
            // 對稱：高度（隨機取樣）、障礙物、資源、營地、中立建築
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
            const sig = (c) => c.set.join(',');
            for (let i = 0; i + 1 < R.camps.length; i += 2)
              if (sig(R.camps[i]) !== sig(R.camps[i + 1]) || R.camps[i].tier !== R.camps[i + 1].tier)
                err('營地編成不對稱 ' + i);
            out.corals = (R.corals || []).length;
            out.neutrals = R.neutrals.length;
            // 尋路：兩邊的坡道下到營地與資源旁可以走的格子的路徑代價（主堡、礦脈本身佔用導航格）
            const [bA, bB] = plan.bases;
            const A0 = bA.ramp.bottom,
              B0 = bB.ramp.bottom;
            out.path = nav.findPath(A0, B0, 1).length;
            let worst = 0;
            const cellNear = (p) => {
              const c = nav.nearestCell(p.x, p.z, 1, -1, 10);
              return c >= 0 ? nav.center(c) : p;
            };
            for (const p of [
              ...R.camps.filter((c) => c.near === 0).map((c) => c.pos),
              ...R.mines.map((m) => m.pos),
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
            // 營地：主題的野怪
            const allowed = (id) => T.creeps.some((c) => id === c || (c.endsWith('_') && id.startsWith(c)));
            const ids = R.camps.flatMap((c) => c.set);
            out.campIds = [...new Set(ids)].sort();
            if (!ids.every(allowed))
              err('營地有別的主題的野怪：' + ids.filter((id) => !allowed(id)).join(','));
            out.creeps = R.units.filter((e) => e.creep && !e.dead).length;
            out.creepIds = ids.length;
            // 傭兵營：主題的名單與指令卡
            const merc = R.neutrals.find((q) => q.kind === 'merc');
            out.mercStock = Object.keys(merc.stock).sort();
            out.mercCard = g.rtsUiDef
              ? (g.rtsUiDef(merc.ent).card || []).map((c) => c.act && c.act.merc)
              : [];
            // 迷霧：障礙物合併成世界座標的網格、迷霧著色開啟
            const merged = w.scene.children.filter((m) => m.userData && m.userData.rtsProps);
            out.merged = merged.length;
            out.mergedFog = merged.every(
              (m) => m.geometry.attributes.rtsC && m.material.customProgramCacheKey().includes('rtsPropFog'),
            );
            g.rtsFogTick && g.rtsFogTick(0.25);
            out.fogOn = !!(R.fog || g.rtsFogGrid);
            // 主題專屬
            if (theme === 'snow') {
              out.ice = (plan.ice || []).length;
              out.iceOk = (plan.ice || []).every(
                (L) => w.onIce(L.x, L.z) && !nav.buildable(L.x, L.z, 4, 4) && nav.walkableAt(L.x, L.z, 1),
              );
              let onLane = false;
              for (const ln of plan.lanes)
                for (let k = 1; k < ln.length && !onLane; k++)
                  for (let s = 0; s <= 10 && !onLane; s++) {
                    const x = ln[k - 1].x + ((ln[k].x - ln[k - 1].x) * s) / 10,
                      z = ln[k - 1].z + ((ln[k].z - ln[k - 1].z) * s) / 10;
                    if (w.onIce(x, z)) onLane = true;
                  }
              out.iceLane = onLane;
              out.sheets = w.meshes.filter((m) => m.geometry && m.geometry.type === 'CircleGeometry').length;
            } else {
              out.decor = (plan.decor || []).length;
              out.veinsWalk = (plan.decor || []).filter((d) => nav.walkableAt(d.x, d.z, 0)).length;
              // Coral 脈不是障礙物（world.obstacles 裡沒有在 Coral 脈位置的）
              out.veinObs = w.obstacles.filter((o) =>
                (plan.decor || []).some((d) => Math.hypot(o.x - d.x, o.z - d.z) < 0.01),
              ).length;
            }
            return out;
          },
          { theme, seed, full, T },
        );
        const tag = `${theme}（種子 ${seed}）`;
        check(r.theme === theme && r.ok, `${tag}：開局、地圖產生器合格`);
        check(!r.roof && r.noTod, `${tag}：主題覆寫（沒有岩頂、不疊加時間）`);
        check(
          !r.errs.length,
          `${tag}：對稱與尋路（${r.errs.slice(0, 3).join('；') || '高度、障礙物、資源、營地、中立建築'}）`,
        );
        check(
          r.path > 1 && r.worst < 0.03,
          `${tag}：基地到基地有路徑、兩邊到營地與礦脈的路徑代價差 ${(r.worst * 100).toFixed(2)}%`,
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
        if (theme === 'snow')
          check(
            r.ice >= 2 && r.iceOk && r.iceLane && r.sheets === r.ice,
            `${tag}：冰湖 ${r.ice / 2} 對（冰面高度、可以走、不能蓋、在通道上、冰面 ${r.sheets} 片）`,
          );
        else
          check(
            r.corals === 6 && r.decor > 0 && r.veinsWalk === r.decor && r.veinObs === 0,
            `${tag}：湧出點 ${r.corals} 個、Coral 脈 ${r.decor} 段都不擋路（可以走 ${r.veinsWalk}、障礙物 ${r.veinObs}）`,
          );
        if (!full) continue;

        // ---------- 第一個種子：冰上變快、營地交戰、傭兵雇用、截圖與亮度 ----------
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
            if (theme === 'snow') {
              const L = w.rts.ice[0];
              const a = g.rtsSpawn(0, 'c_mt', L.x, L.z, 0);
              const p = spot(L.x + 60, L.z);
              const bb = g.rtsSpawn(0, 'c_mt', p.x, p.z, 0);
              window.__sim(1.2);
              out.iceMul = a.speedMul / bb.speedMul;
              out.iceBuff = !!a.rtsMods.buff.find((x) => x.src === 'ice');
              a.die();
              bb.die();
              window.__sim(0.2);
            }
            // 傭兵：每種雇一次（己方單位站在傭兵營旁）
            const merc =
              R.neutrals.find((q) => q.kind === 'merc' && q.near === 0) ||
              R.neutrals.find((q) => q.kind === 'merc');
            R.teams[0].ore = R.teams[0].coral = 20000;
            const m = merc.ent;
            const sp = spot(m.pos.x + Math.sin(m.yaw) * 10, m.pos.z + Math.cos(m.yaw) * 10);
            g.rtsSpawn(0, 'c_mt', sp.x, sp.z, 0);
            g.rtsRecount();
            out.hired = {};
            for (const id of T.mercs) {
              const before = R.units.filter((e) => !e.dead && e.rtsDef === id && e.rtsTeam === 0).length;
              R.teams[0].cap = 150; // 測試：開局只有主堡的人口上限，照樣雇用
              const pop0 = R.teams[0].pop;
              const e = g.rtsMercHire(0, merc, id);
              const after = R.units.filter((x) => !x.dead && x.rtsDef === id && x.rtsTeam === 0).length;
              out.hired[id] = { ok: !!e, n: after - before, pop: R.teams[0].pop - pop0 };
            }
            // 營地交戰：最近的小營地旁放 5 台 MT，整營出動、互相打到
            const camp = R.camps.filter((c) => c.near === 0 && c.tier === 1)[0] || R.camps[0];
            const units = [];
            // 和營地同高的地方（不要放到台地上：低處看不到高處，野怪會看不到它們）
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
            return out;
          },
          { theme, T },
        );
        if (theme === 'snow')
          check(
            b.iceBuff && Math.abs(b.iceMul - 1.1) < 0.02,
            `${theme}：冰上的地面單位速度 ×${b.iceMul.toFixed(2)}`,
          );
        const hired = Object.entries(b.hired);
        check(
          hired.every(([id, h]) => h.ok && h.n === (id === 'm_blob' ? 2 : 1) && h.pop > 0),
          `${theme}：傭兵 4 種都能雇用（${hired.map(([id, h]) => `${id}×${h.n} 人口 +${h.pop}`).join('、')}）`,
        );
        check(
          b.dealt > 0 && b.taken > 0,
          `${theme}：營地（${b.campSet}）出動交戰：野怪打出 ${Math.round(b.dealt)}、受到 ${Math.round(b.taken)}（${b.campSt}）`,
        );
        // 截圖：俯視（整個中央）與近景（冰湖或 Coral 脈旁的營地），量亮度
        for (const v of ['map', 'near']) {
          await ev(
            ({ v, theme }) => {
              const g = window.__game,
                R = g.rts,
                plan = g.world.rts;
              if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
              let p = { x: 0, z: 0 };
              if (v === 'near') {
                const q = theme === 'snow' ? plan.ice[0] : (plan.decor || [])[0] || R.corals[4].pos;
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
            path: path.join(SHOT_DIR, `rts-r3-map-${theme}${v === 'near' ? '-near' : ''}.png`),
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

  return { testRtsThemes };
};
