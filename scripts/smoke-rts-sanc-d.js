// Coral 戰爭（RTS）R5 D 包（地圖主題與中立）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-sanc-d')(H)。
// testRtsThemes3：汙染水沒市街 flooded、多重水壩 dam 各 3 個種子開局：主題覆寫（水面 −0.4、沒有岩頂、不疊加時間、天候）、
// 對稱（高度、障礙物、資源、營地、中立建築、水窪、壩體的坡道、裝飾）、尋路（兩邊到營地、礦脈、壩頂的路徑代價相等；
// 壩體：兩組坡道都到得了、基地到基地的路徑經過壩頂、坡道以外沒有路）、水裡不能蓋、水深最多 1.4 m、迷霧網格貼著水面、
// 水窪橫跨通道、主題的野怪與傭兵、障礙物與裝飾的靜態合併；第一個種子另測涉水 ×0.85（兩棲 ×1.1）、4 種傭兵的雇用、
// 不能移動的傭兵、營地出動交戰、俯視與近景的亮度。截圖 rts-r5-map-<主題>.png（俯視）與 -near.png（近景）。
// 電腦對手不動（g.rtsAiOff），主迴圈停住，以 rtsSim 快轉。
/* global window, document */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  const THEMES = {
    flooded: {
      creeps: ['cr_gunboat', 'cr_sprayer', 'cr_buoy', 'cr_mt', 'cr_mth', 'cr_scav', 'cr_ac_'],
      mercs: ['m_gunboat', 'm_sprayer', 'm_buoy', 'm_scav'],
      still: ['m_buoy'],
    },
    dam: {
      creeps: ['cr_patrol', 'cr_watercannon', 'cr_gategun', 'cr_turbine', 'cr_mt', 'cr_mth', 'cr_ac_'],
      mercs: ['m_patrol', 'm_watercannon', 'm_gategun', 'm_mth'],
      still: ['m_gategun'],
    },
  };
  const SEEDS = [7, 23, 101];

  async function testRtsThemes3(browser, base) {
    console.log('Coral 戰爭：汙染水沒市街與多重水壩（R5 地圖主題、水面與涉水、營地、傭兵）');
    const { ctx, page } = await newPage(browser, 'rtsThemes3');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
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
            g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷（負載高時同一個種子的結果才會相同）
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
                if (g.rtsFogTick) g.rtsFogTick(dt);
              }
              return until && !until() ? -1 : t;
            };
            const near = (a, b) => Math.abs(a - b) < 1e-4;
            const out = { theme: w.themeKey, ok: plan.ok, errs: [] };
            const err = (s) => out.errs.push(s);
            out.roof = !!w.theme.roof;
            out.noTod = !!w.theme.noTod;
            out.weather = w.weather ? w.weather.kind || 'on' : '';
            out.water = w.theme.water ? w.theme.water.level : null;
            out.waterMesh = !!w.waterMesh && Math.abs(w.waterMesh.position.y - (out.water || 0)) < 1e-6;
            // 對稱
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
            if (!pairOf(plan.pools || [], (q) => q)) err('水窪不對稱');
            if (!pairOf((plan.dam && plan.dam.ramps) || [], (q) => q.top)) err('坡道不對稱');
            if (!pairOf(plan.decor || [], (q) => q)) err('裝飾不對稱');
            for (let i = 0; i + 1 < R.camps.length; i += 2)
              if (
                R.camps[i].set.join() !== R.camps[i + 1].set.join() ||
                R.camps[i].tier !== R.camps[i + 1].tier
              )
                err('營地編成不對稱 ' + i);
            out.neutrals = R.neutrals.length;
            // 尋路：兩邊的坡道下到營地、礦脈、壩頂
            const [bA, bB] = plan.bases;
            const A0 = bA.ramp.bottom,
              B0 = bB.ramp.bottom;
            const path = nav.findPath(A0, B0, 1);
            out.path = path.length;
            const cellNear = (p, size = 1) => {
              const c = nav.nearestCell(p.x, p.z, size, -1, 10);
              return c >= 0 ? nav.center(c) : p;
            };
            const tops = (plan.dam && plan.dam.tops) || [];
            let worst = 0;
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
            // 水：最深、水裡不能蓋（水窪中心、河道）、乾的低地可以蓋
            let deep = 0,
              wetCells = 0,
              wetBuild = 0;
            for (let i = 0; i < nav.N; i += 3) {
              const d = out.water - nav.hgt[i];
              if (d > deep) deep = d;
              if (d > 0.3) {
                wetCells++;
                const c = nav.center(i);
                if (nav.buildable(c.x, c.z, 4, 4)) wetBuild++;
              }
            }
            out.deep = deep;
            out.wetCells = wetCells;
            out.wetBuild = wetBuild;
            // 迷霧網格貼著水面：水窪中心（或河道）上方的迷霧網格頂點
            const fog = w.scene.children.find((m) => m.userData && m.userData.rtsFog);
            const wetPts = [];
            for (const q of plan.pools || []) wetPts.push({ x: q.x, z: q.z });
            const D = plan.dam;
            const ax = Math.cos(plan.axis),
              az = Math.sin(plan.axis);
            if (D) {
              const u = D.river.u0 + D.river.w / 2,
                v = D.plaza + 8;
              wetPts.push({ x: u * ax - v * az, z: u * az + v * ax });
            }
            out.fogLow = 0;
            if (fog) {
              const pos = fog.geometry.attributes.position;
              for (const p of wetPts) {
                let best = 1e9,
                  y = 0;
                for (let k = 0; k < pos.count; k++) {
                  const dd = (pos.getX(k) - p.x) ** 2 + (pos.getZ(k) - p.z) ** 2;
                  if (dd < best) ((best = dd), (y = pos.getY(k)));
                }
                if (y < out.water + 0.2) out.fogLow++;
              }
            } else out.fogLow = -1;
            out.wetPts = wetPts.length;
            // 水窪橫跨通道（每條通道都經過水窪）
            const inPool = (x, z) =>
              (plan.pools || []).some((L) => {
                const dx = x - L.x,
                  dz = z - L.z,
                  c = Math.cos(L.rot),
                  s = Math.sin(L.rot);
                return ((dx * c + dz * s) / L.rx) ** 2 + ((-dx * s + dz * c) / L.rz) ** 2 < 1;
              });
            const laneHits = (ln, f) => {
              for (let k = 1; k < ln.length; k++)
                for (let s = 0; s <= 20; s++)
                  if (
                    f(
                      ln[k - 1].x + ((ln[k].x - ln[k - 1].x) * s) / 20,
                      ln[k - 1].z + ((ln[k].z - ln[k - 1].z) * s) / 20,
                    )
                  )
                    return true;
              return false;
            };
            out.lanesWet = plan.lanes.filter((ln) => laneHits(ln, inPool)).length;
            out.lanes = plan.lanes.length;
            out.pools = (plan.pools || []).length;
            // 壩體：壩頂高度、基地到基地的路徑經過壩頂、坡道以外沒有路
            if (D) {
              const uOf = (p) => p.x * ax + p.z * az;
              out.damTop = tops.every((q) => Math.abs(w.terrainHeight(q.x, q.z) - D.h) < 0.4);
              let full = [];
              for (let k = 1; k < path.length; k++)
                for (let s = 0; s <= 10; s++)
                  full.push({
                    x: path[k - 1].x + ((path[k].x - path[k - 1].x) * s) / 10,
                    z: path[k - 1].z + ((path[k].z - path[k - 1].z) * s) / 10,
                  });
              out.overDam = full.some(
                (p) => Math.abs(uOf(p)) < D.hw - 1 && w.terrainHeight(p.x, p.z) > D.h - 1,
              );
              const fy = (dd) => Math.atan2(-az * dd, ax * dd);
              for (const q of D.ramps)
                nav.block(
                  (q.top.x + q.bottom.x) / 2,
                  (q.top.z + q.bottom.z) / 2,
                  q.w + 8,
                  q.len + 6,
                  fy(q.dd),
                  true,
                );
              out.sealed = !nav.reachable(bA.pos, bB.pos, 0);
              for (const q of D.ramps)
                nav.block(
                  (q.top.x + q.bottom.x) / 2,
                  (q.top.z + q.bottom.z) / 2,
                  q.w + 8,
                  q.len + 6,
                  fy(q.dd),
                  false,
                );
              out.ramps = D.ramps.length;
              // 兩組坡道都到得了（大型單位）
              out.rampsBig = D.ramps.every((q) => nav.reachable(cellNear(A0, 2), cellNear(q.bottom, 2), 2));
              out.damwall = (plan.decor || []).filter((d) => d.model === 'damwall').length;
            }
            // 營地：主題的野怪
            const allowed = (id) => T.creeps.some((c) => id === c || (c.endsWith('_') && id.startsWith(c)));
            const ids = R.camps.flatMap((c) => c.set);
            out.campIds = [...new Set(ids)].sort();
            if (!ids.every(allowed))
              err('營地有別的主題的野怪：' + ids.filter((id) => !allowed(id)).join(','));
            out.creeps = R.units.filter((e) => e.creep && !e.dead).length;
            out.creepIds = ids.length;
            out.stillOk = R.units
              .filter((e) => e.creep && !e.dead && ['cr_buoy', 'cr_gategun', 'cr_turbine'].includes(e.rtsDef))
              .every((e) => e.edHold);
            out.amphOk = R.units
              .filter((e) => e.creep && !e.dead && ['cr_gunboat', 'cr_ac_marsh'].includes(e.rtsDef))
              .every((e) => e.opts.amphib);
            const merc = R.neutrals.find((q) => q.kind === 'merc');
            out.mercStock = Object.keys(merc.stock).sort();
            out.mercCard = g.rtsUiDef
              ? (g.rtsUiDef(merc.ent).card || []).map((c) => c.act && c.act.merc)
              : [];
            // 地圖殘骸（聖域的拾荒）：主題的 wrecks 模型
            out.mapWrecks = plan.obstacles.filter((o) =>
              ['sunkbus', 'wreckcar', 'gatewreck', 'cranewreck'].includes(o.model),
            ).length;
            // 靜態合併
            const merged = w.scene.children.filter((m) => m.userData && m.userData.rtsProps);
            out.merged = merged.length;
            out.mergedFog = merged.every(
              (m) => m.geometry.attributes.rtsC && m.material.customProgramCacheKey().includes('rtsPropFog'),
            );
            const cs = new Set();
            for (const m of merged) {
              const a = m.geometry.attributes.rtsC.array;
              for (let i = 0; i < a.length; i += 2)
                cs.add(Math.round(a[i] * 10) + ',' + Math.round(a[i + 1] * 10));
            }
            out.decor = (plan.decor || []).length;
            out.decorMerged = (plan.decor || []).filter((d) =>
              cs.has(Math.round(d.x * 10) + ',' + Math.round(d.z * 10)),
            ).length;
            out.decorObs = w.obstacles.filter((o) =>
              (plan.decor || []).some((d) => Math.hypot(o.x - d.x, o.z - d.z) < 0.01),
            ).length;
            return out;
          },
          { theme, seed, T },
        );
        const tag = `${theme}（種子 ${seed}）`;
        check(r.theme === theme && r.ok, `${tag}：開局、地圖產生器合格`);
        check(
          !r.roof &&
            r.noTod &&
            (theme === 'flooded' ? r.weather === 'rain' || r.weather === 'on' : !r.weather) &&
            r.water === -0.4 &&
            r.waterMesh,
          `${tag}：主題覆寫（水面 ${r.water}、沒有岩頂、不疊加時間、天候 ${r.weather || '晴'}）`,
        );
        check(
          !r.errs.length,
          `${tag}：對稱與尋路（${r.errs.slice(0, 3).join('；') || '高度、障礙物、資源、營地、中立建築、水、裝飾'}）`,
        );
        check(
          r.path > 1 && r.worst < 0.03,
          `${tag}：基地到基地有路徑、兩邊的路徑代價差 ${(r.worst * 100).toFixed(2)}%`,
        );
        check(
          r.deep <= 1.4 + 1e-3 && r.wetCells > 20 && r.wetBuild === 0,
          `${tag}：水深最多 ${r.deep.toFixed(2)} m、水裡（${r.wetCells} 格）不能蓋（能蓋 ${r.wetBuild}）`,
        );
        check(
          r.fogLow === 0 && r.wetPts > 0,
          `${tag}：迷霧網格貼著水面（${r.wetPts} 處、低於水面 ${r.fogLow}）`,
        );
        if (theme === 'flooded')
          check(
            r.pools >= 6 && r.lanesWet === r.lanes && r.mapWrecks >= 10,
            `${tag}：水窪 ${r.pools} 個、${r.lanesWet}／${r.lanes} 條通道經過水窪、地圖殘骸 ${r.mapWrecks} 個`,
          );
        else
          check(
            r.ramps === 4 && r.damTop && r.overDam && r.sealed && r.rampsBig && r.damwall > 10,
            `${tag}：壩體（坡道 ${r.ramps}、壩頂高度、路徑經過壩頂 ${r.overDam}、坡道以外沒有路 ${r.sealed}、大型單位上得去 ${r.rampsBig}、壩面 ${r.damwall}）`,
          );
        check(
          r.neutrals === 5 && r.creeps === r.creepIds && r.creeps > 10 && r.stillOk && r.amphOk,
          `${tag}：中立建築 5 棟、野怪 ${r.creeps} 台（${r.campIds.join(' ')}；不能移動的 edHold、兩棲）`,
        );
        check(
          JSON.stringify(r.mercStock) === JSON.stringify([...T.mercs].sort()) &&
            (!r.mercCard.length || JSON.stringify(r.mercCard) === JSON.stringify(T.mercs)),
          `${tag}：傭兵營是這個主題的名單（${r.mercStock.join(' ')}）、指令卡相同`,
        );
        check(
          r.merged > 0 && r.mergedFog && r.decorObs === 0 && (!r.decor || r.decorMerged > r.decor * 0.8),
          `${tag}：障礙物靜態合併 ${r.merged} 個網格、迷霧著色、裝飾 ${r.decor} 個不碰撞（合併 ${r.decorMerged}）`,
        );
        if (!full) continue;

        // ---------- 第一個種子：涉水、傭兵、營地交戰、截圖與亮度 ----------
        const b = await ev(
          ({ T }) => {
            const g = window.__game,
              R = g.rts,
              w = g.world,
              nav = w.nav;
            const out = {};
            const spot = (x, z, size = 1) => {
              const c = nav.nearestCell(x, z, size, -1, 12);
              return c >= 0 ? nav.center(c) : { x, z };
            };
            // 涉水：一樣的單位在乾地與水深 0.6 m 以上的地方各走 1.5 秒（直線、平地），比速度
            const W = w.theme.water.level;
            // 直線 16 m（±2 m 寬）都是水深 0.65 m 以上（或都是乾地）、可以走的方向（8 個方向依序試）
            const flat = (x, z, wet) => {
              // 多重水壩的河道順著壩（主軸的垂直方向）
              const dirs = [];
              if (w.rts.dam) dirs.push(w.rts.axis + Math.PI / 2);
              for (let a = 0; a < 8; a++) dirs.push((a * Math.PI) / 4);
              for (const ang of dirs) {
                const dx = Math.cos(ang),
                  dz = Math.sin(ang);
                let ok = true;
                for (let t = -3; t <= 14 && ok; t += 1)
                  for (const l of [-2, 0, 2]) {
                    const px = x + dx * t - dz * l,
                      pz = z + dz * t + dx * l;
                    const d = W - w.terrainHeight(px, pz);
                    if ((wet ? d < 0.65 : d > 0.1) || !nav.walkableAt(px, pz, 1)) {
                      ok = false;
                      break;
                    }
                  }
                if (ok) return { x, z, dx, dz };
              }
              return null;
            };
            let wet = null,
              dry = null;
            for (let k = 0; k < nav.N && (!wet || !dry); k += 3) {
              const c = nav.center(k);
              if (Math.abs(c.x) > 150 || Math.abs(c.z) > 150) continue;
              if (!wet) wet = flat(c.x, c.z, true);
              if (!dry && Math.hypot(c.x, c.z) > 20) dry = flat(c.x, c.z, false);
            }
            // 單位 u 放到 p 的後方 2 m，沿方向走：0.6 秒加速後量 1 秒的位移
            const speedAt = (u, p) => {
              const sx = p.x - p.dx * 2,
                sz = p.z - p.dz * 2;
              u.pos.set(sx, w.terrainHeight(sx, sz), sz);
              u.mesh.position.copy(u.pos);
              if (u.vel) u.vel.set(0, 0, 0);
              g.rtsOrder([u], { k: 'stop' });
              window.__sim(0.5);
              g.rtsOrder([u], { k: 'move', x: p.x + p.dx * 14, z: p.z + p.dz * 14 });
              window.__sim(0.6);
              const x1 = u.pos.x,
                z1 = u.pos.z;
              window.__sim(1);
              return { v: Math.hypot(u.pos.x - x1, u.pos.z - z1), k: u.waterK() };
            };
            out.found = !!(wet && dry);
            const merc0 =
              R.neutrals.find((q) => q.kind === 'merc' && q.near === 0) ||
              R.neutrals.find((q) => q.kind === 'merc');
            if (wet && dry) {
              const mt = g.rtsSpawn(0, 'c_mt', dry.x, dry.z, 0);
              mt.hp = mt.maxHp = 1e6;
              out.mtDry = speedAt(mt, dry);
              out.mtWet = speedAt(mt, wet);
              mt.rtsQuiet = true;
              mt.die(null);
              // 兩棲：照正常的雇用流程（rtsMercHire → rtsCampFlags）雇一台潛航砲艇（只有水沒市街的傭兵營有）
              const amph = T.mercs.find((id) => id === 'm_gunboat');
              if (amph) {
                R.teams[0].ore = R.teams[0].coral = 20000;
                R.teams[0].cap = 150;
                const sp0 = spot(
                  merc0.ent.pos.x + Math.sin(merc0.ent.yaw) * 10,
                  merc0.ent.pos.z + Math.cos(merc0.ent.yaw) * 10,
                );
                const helper = g.rtsSpawn(0, 'c_mt', sp0.x, sp0.z, 0);
                g.rtsRecount();
                const gb = g.rtsMercHire(0, merc0, amph);
                merc0.stock[amph].n = merc0.stock[amph].max;
                helper.rtsQuiet = true;
                helper.die(null);
                if (gb) {
                  gb.hp = gb.maxHp = 1e6;
                  out.gbDry = speedAt(gb, dry);
                  out.gbWet = speedAt(gb, wet);
                  gb.rtsQuiet = true;
                  gb.die(null);
                }
              }
              window.__sim(0.3);
            }
            // 傭兵 4 種
            const merc =
              R.neutrals.find((q) => q.kind === 'merc' && q.near === 0) ||
              R.neutrals.find((q) => q.kind === 'merc');
            R.teams[0].ore = R.teams[0].coral = 20000;
            const m = merc.ent;
            const sp = spot(m.pos.x + Math.sin(m.yaw) * 10, m.pos.z + Math.cos(m.yaw) * 10);
            g.rtsSpawn(0, 'c_mt', sp.x, sp.z, 0);
            g.rtsRecount();
            out.hired = {};
            const still = [];
            for (const id of T.mercs) {
              const before = R.units.filter((e) => !e.dead && e.rtsDef === id && e.rtsTeam === 0).length;
              R.teams[0].cap = 150;
              const pop0 = R.teams[0].pop;
              const e = g.rtsMercHire(0, merc, id);
              if (T.still.includes(id) && e) still.push(e);
              const after = R.units.filter((x) => !x.dead && x.rtsDef === id && x.rtsTeam === 0).length;
              out.hired[id] = { ok: !!e, n: after - before, pop: R.teams[0].pop - pop0 };
            }
            window.__sim(3);
            out.still = still.map((e) => {
              const p0 = { x: e.pos.x, z: e.pos.z };
              g.rtsOrder([e], { k: 'move', x: p0.x + 20, z: p0.z + 20 });
              return { e, p0 };
            });
            window.__sim(4);
            out.stillMoved = Math.max(
              0,
              ...out.still.map((s) => Math.hypot(s.e.pos.x - s.p0.x, s.e.pos.z - s.p0.z)),
            );
            out.stillHold = out.still.every((s) => s.e.edHold);
            delete out.still;
            // 營地交戰
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
            return out;
          },
          { T },
        );
        if (b.found) {
          const rk = b.mtWet.v / Math.max(b.mtDry.v, 1e-6),
            rg = b.gbWet ? b.gbWet.v / Math.max(b.gbDry.v, 1e-6) : 0;
          check(
            b.mtWet.k === 0.85 && b.mtDry.k === 1 && rk > 0.75 && rk < 0.95,
            `${theme}：涉水變慢（MT 乾地 ${b.mtDry.v.toFixed(2)}、水裡 ${b.mtWet.v.toFixed(2)} m／秒，×${rk.toFixed(2)}；waterK ${b.mtWet.k}）`,
          );
          if (b.gbWet)
            check(
              b.gbWet.k === 1.1 && rg > 1.0 && rg < 1.2,
              `${theme}：兩棲的潛航砲艇（雇用）在水裡變快（×${rg.toFixed(2)}；waterK ${b.gbWet.k}）`,
            );
        } else check(false, `${theme}：找不到量涉水的乾地與水裡`);
        const hired = Object.entries(b.hired);
        check(
          hired.every(([, h]) => h.ok && h.n === 1 && h.pop > 0),
          `${theme}：傭兵 4 種都能雇用（${hired.map(([id, h]) => `${id}×${h.n} 人口 +${h.pop}`).join('、')}）`,
        );
        check(
          b.stillHold && b.stillMoved < 1.5,
          `${theme}：不能移動的傭兵（${T.still.join(' ')}）不走向移動指令的地點（位移 ${b.stillMoved.toFixed(2)} m）`,
        );
        check(
          b.dealt > 0 && b.taken > 0,
          `${theme}：營地（${b.campSet}）出動交戰：野怪打出 ${Math.round(b.dealt)}、受到 ${Math.round(b.taken)}（${b.campSt}）`,
        );
        // 截圖：俯視與近景（水窪或壩體的坡道），量亮度
        for (const v of ['map', 'near']) {
          await ev(
            ({ v, theme }) => {
              const g = window.__game,
                R = g.rts,
                plan = g.world.rts;
              if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
              let p = { x: 0, z: 0 };
              if (v === 'near') {
                const q = theme === 'flooded' ? plan.pools[0] : plan.dam.ramps[0].top;
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
            path: path.join(SHOT_DIR, `rts-r5-map-${theme}${v === 'near' ? '-near' : ''}.png`),
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

  return { testRtsThemes3 };
};
