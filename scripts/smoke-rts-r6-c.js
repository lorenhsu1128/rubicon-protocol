// Coral 戰爭（RTS）R6 C 包（地圖主題與地圖大小）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts-r6-c')(H)。
// testRtsThemes4（docs 17.4、17.7）：
// - 不開瀏覽器：既有七個主題（400 m）100 個種子的地圖雜湊和 R6 之前相同（同 rts-map-test.js 的 HASHES）
// - 沙丘地帶 dunes、礦坑地表 desert、貨運集散場 industrial 各 3 個種子（7、23、101）開局：主題覆寫（沒有岩頂、
//   不疊加時間、天候）、對稱、兩邊的路徑代價、附加結構（沙丘的高度、擋住低處的視線、可以走；礦坑的深度、坡道（大型單位
//   下得去）、坑底的富礦與 tier 3 營地、酒館在坑緣；貨櫃堆的巷道寬度、擋子彈、龍門起重機的腳）、主題的野怪與傭兵、
//   營地到傭兵營 ≥ 30 m、靜態合併與迷霧著色、俯視與近景的亮度；截圖 rts-r6-map-<主題>.png、-near.png
// - 小地圖（300 m）十個主題各 1 個種子開局：點位數量、鏡頭邊界、小地圖的比例；荒野另外讓電腦跑 90 秒（會蓋基地）；
//   截圖 rts-r6-map-small.png
// 電腦對手不動（g.rtsAiOff，小地圖的電腦測試除外），主迴圈停住，以 rtsSim 快轉。
/* global window, document */
'use strict';
const crypto = require('crypto');
const { pathToFileURL } = require('url');

module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;
  const THEMES = {
    dunes: {
      creeps: [
        'cr_burrow',
        'cr_jammer',
        'cr_ridgesniper',
        'cr_twister',
        'cr_mt',
        'cr_mth',
        'cr_scav',
        'cr_mtshot',
        'cr_ac_',
      ],
      mercs: ['m_burrow', 'm_ridgesniper', 'm_jammer', 'm_mth'],
      weather: 'sand',
    },
    desert: {
      creeps: ['cr_drill', 'cr_lamp', 'cr_blaster', 'cr_cart', 'cr_mt', 'cr_mth', 'cr_scav', 'cr_ac_'],
      mercs: ['m_drill', 'm_blaster', 'm_lamp', 'm_mth'],
      weather: 'dust',
    },
    industrial: {
      creeps: ['cr_forklift', 'cr_riveter', 'cr_crane', 'cr_welder', 'cr_mt', 'cr_mth', 'cr_scav', 'cr_ac_'],
      mercs: ['m_forklift', 'm_riveter', 'm_welder', 'm_crane'],
      weather: '',
    },
  };
  const SEEDS = [7, 23, 101];
  // 既有七個主題（400 m）的地圖雜湊（scripts/rts-map-test.js 的 HASHES）
  const HASHES = {
    wasteland: 'dbdb9dc2c7e03e5ade9c311c60ed051797a5320f',
    snow: '5299d75d5540fdc062c78b0dabb50634ce8429a1',
    institute: '60a6b81654ebc1d78e7a2b652b667a96ec5e5374',
    spaceport: 'dcf836115e5c33f655977620217b4144fd8a9fe0',
    grid086: '29de65975c8b0da7f79dddb2d3ab9f8b8f51ade7',
    flooded: '80fa248223fcd210f31bd9cb00e34eecf1d32f5e',
    dam: 'd94cba84fa206edefc23549cf1dbab676508c3f8',
  };
  const planHash = (p) => {
    const hs = crypto.createHash('sha1');
    hs.update(Buffer.from(p.h.buffer));
    const rest = { ...p };
    delete rest.h;
    delete rest.ms;
    delete rest.check;
    hs.update(JSON.stringify(rest));
    return hs.digest('hex');
  };

  async function testRtsThemes4(browser, base) {
    console.log('Coral 戰爭：沙丘地帶、礦坑地表、貨運集散場、小地圖（R6 C 包）');
    // ---------- 既有七個主題的地圖不變（node） ----------
    const t0 = Date.now();
    const M = await import(pathToFileURL(path.join(__dirname, '..', 'src', 'world', 'rts-map.js')).href);
    const same = [];
    for (const theme of Object.keys(HASHES)) {
      const all = crypto.createHash('sha1');
      for (let s = 1; s <= 100; s++) all.update(planHash(M.planRtsMap(s * 7919, { theme, size: 400 })));
      if (all.digest('hex') === HASHES[theme]) same.push(theme);
    }
    check(
      same.length === 7,
      `既有七個主題（400 m）100 個種子的地圖雜湊不變（${same.join(' ')}；${((Date.now() - t0) / 1000).toFixed(1)} 秒）`,
    );
    check(
      M.RTS_SIZES && M.RTS_SIZES.s.size === 300 && M.RTS_SIZES.m.size === 400 && M.RTS_THEMES.desert.r6,
      `RTS_SIZES（${Object.values(M.RTS_SIZES || {})
        .map((q) => q.name + q.size)
        .join(
          '、',
        )}）與新主題（${['dunes', 'desert', 'industrial'].map((k) => M.RTS_THEMES[k].name).join('、')}）`,
    );

    const { ctx, page } = await newPage(browser, 'rtsThemes4');
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
    // 開局＋快轉函式（每次開局都重設）
    const start = (o) =>
      ev((o) => {
        const g = window.__game;
        g.rtsAiOff = o.ai ? false : true;
        g.rtsPathMs = Infinity; // 尋路不依實際耗時截斷
        g.rtsStart({
          theme: o.theme,
          seed: o.seed,
          size: o.size,
          faction: 'castron',
          aiFaction: 'castron',
          diff: 'normal',
        });
        g.lodFrom = new window.THREE.Vector3(0, 0, 0);
        window.__sim = (sec, until, dt = 1 / 20) => {
          let t = 0;
          for (; t < sec; t += dt) {
            if (until && until()) return t;
            g.rtsSim(dt);
            if (g.rtsFogTick) g.rtsFogTick(dt);
            if (g.fx) g.fx.update(dt);
          }
          return until && !until() ? -1 : t;
        };
        return { ok: g.world.rts.ok, size: g.world.size };
      }, o);

    for (const theme of Object.keys(THEMES)) {
      const T = THEMES[theme];
      for (const seed of SEEDS) {
        const full = seed === SEEDS[0];
        await start({ theme, seed, size: 400 });
        const r = await ev(
          ({ theme, T }) => {
            const g = window.__game,
              R = g.rts,
              w = g.world,
              plan = w.rts,
              nav = w.nav;
            const near = (a, b) => Math.abs(a - b) < 1e-4;
            const out = { theme: w.themeKey, ok: plan.ok, errs: [] };
            const err = (s) => out.errs.push(s);
            out.roof = !!w.theme.roof;
            out.noTod = !!w.theme.noTod;
            out.weather = w.weather ? w.weather.kind || 'on' : '';
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
            if (
              !pairOf(
                R.neutrals.filter((q) => !(plan.pit && q.kind === 'tavern')),
                (q) => q.ent.pos,
              )
            )
              err('中立建築不對稱');
            if (!pairOf(plan.decor || [], (q) => q)) err('裝飾不對稱');
            for (const k of ['dunes', 'stacks', 'gantries'])
              if (!pairOf(plan[k] || [], (q) => q)) err(k + ' 不對稱');
            for (let i = 0; i + 1 < R.camps.length; i += 2)
              if (
                R.camps[i].pair === R.camps[i + 1].pair &&
                R.camps[i].set.join() !== R.camps[i + 1].set.join()
              )
                err('營地編成不對稱 ' + i);
            // 尋路：兩邊的坡道下到營地、礦脈（礦坑的富礦在正中央）
            const [bA, bB] = plan.bases;
            const A0 = bA.ramp.bottom,
              B0 = bB.ramp.bottom;
            out.path = nav.findPath(A0, B0, 1).length;
            const cellNear = (p, size = 1) => {
              const c = nav.nearestCell(p.x, p.z, size, -1, 10);
              return c >= 0 ? nav.center(c) : p;
            };
            let worst = 0;
            out.worstAt = '';
            for (let p of [
              ...R.camps.filter((c) => c.near === 0).map((c) => c.pos),
              ...R.mines.map((m) => m.pos),
            ]) {
              // 正中央（礦坑的富礦）：自己的鏡像就是自己，改量往 A 側偏 6 m 的點（B 量它的鏡像）
              if (Math.hypot(p.x, p.z) < 0.01) {
                const L = Math.hypot(A0.x, A0.z) || 1;
                p = { x: (A0.x / L) * 6, z: (A0.z / L) * 6 };
              }
              const ca = nav.pathCost(A0, cellNear(p), 1),
                cb = nav.pathCost(B0, cellNear({ x: -p.x, z: -p.z }), 1);
              if (!isFinite(ca) || !isFinite(cb)) {
                err('到不了 ' + Math.round(p.x) + ',' + Math.round(p.z));
                continue;
              }
              const d = Math.abs(ca - cb) / Math.max(ca, cb, 1);
              if (d > worst)
                ((worst = d),
                  (out.worstAt = `${Math.round(p.x)},${Math.round(p.z)}（${Math.round(ca)}／${Math.round(cb)}）`));
            }
            out.worst = worst;
            // 營地到傭兵營（佔地）≥ 30 m
            const mercs = R.neutrals.filter((q) => q.kind === 'merc');
            out.campMerc = Math.min(
              ...R.camps.flatMap((c) =>
                mercs.map(
                  (q) => Math.hypot(c.pos.x - q.ent.pos.x, c.pos.z - q.ent.pos.z) - Math.hypot(12, 10) / 2,
                ),
              ),
            );
            // 主題的野怪與傭兵
            const allowed = (id) => T.creeps.some((c) => id === c || (c.endsWith('_') && id.startsWith(c)));
            const ids = R.camps.flatMap((c) => c.set);
            out.campIds = [...new Set(ids)].sort();
            if (!ids.every(allowed))
              err('營地有別的主題的野怪：' + ids.filter((id) => !allowed(id)).join(','));
            out.creeps = R.units.filter((e) => e.creep && !e.dead).length;
            out.creepIds = ids.length;
            out.stillOk = R.units
              .filter((e) => e.creep && !e.dead && ['cr_twister', 'cr_crane'].includes(e.rtsDef))
              .every((e) => e.edHold);
            const merc = mercs[0];
            out.mercStock = Object.keys(merc.stock).sort();
            // 靜態合併
            const merged = w.scene.children.filter((m) => m.userData && m.userData.rtsProps);
            out.merged = merged.length;
            out.mergedFog = merged.every(
              (m) => m.geometry.attributes.rtsC && m.material.customProgramCacheKey().includes('rtsPropFog'),
            );
            out.decor = (plan.decor || []).length;
            out.decorObs = w.obstacles.filter((o) =>
              (plan.decor || []).some((d) => Math.hypot(o.x - d.x, o.z - d.z) < 0.01 && d.model !== 'gantry'),
            ).length;
            out.neutrals = R.neutrals.length;
            return out;
          },
          { theme, T },
        );
        const tag = `${theme}（種子 ${seed}）`;
        check(r.theme === theme && r.ok, `${tag}：開局、地圖產生器合格`);
        check(
          !r.roof && r.noTod && (T.weather ? r.weather === T.weather || r.weather === 'on' : !r.weather),
          `${tag}：主題覆寫（沒有岩頂、不疊加時間、天候 ${r.weather || '晴'}）`,
        );
        check(
          !r.errs.length,
          `${tag}：對稱與尋路（${r.errs.slice(0, 3).join('；') || '高度、障礙物、資源、營地、中立建築、結構、裝飾'}）`,
        );
        check(
          r.path > 1 && r.worst < 0.03,
          `${tag}：基地到基地有路徑、兩邊的路徑代價差 ${(r.worst * 100).toFixed(2)}%${r.worstAt ? '（' + r.worstAt + '）' : ''}`,
        );
        check(r.campMerc >= 30 - 1e-3, `${tag}：營地到傭兵營（佔地）最近 ${r.campMerc.toFixed(1)} m（≥ 30）`);
        check(
          r.neutrals === 5 && r.creeps === r.creepIds && r.creeps > 10 && r.stillOk,
          `${tag}：中立建築 5 棟、野怪 ${r.creeps} 台（${r.campIds.join(' ')}；不能移動的 edHold）`,
        );
        check(
          JSON.stringify(r.mercStock) === JSON.stringify([...T.mercs].sort()),
          `${tag}：傭兵營是這個主題的名單（${r.mercStock.join(' ')}）`,
        );
        check(
          r.merged > 0 && r.mergedFog && r.decorObs === 0,
          `${tag}：障礙物靜態合併 ${r.merged} 個網格、迷霧著色、裝飾 ${r.decor} 個不碰撞`,
        );

        // ---------- 附加結構 ----------
        const s = await ev((theme) => {
          const g = window.__game,
            R = g.rts,
            w = g.world,
            plan = w.rts,
            nav = w.nav;
          const th = (x, z) => w.terrainHeight(x, z);
          const out = {};
          const quiet = (u) => {
            u.rtsQuiet = true;
            u.die(null);
          };
          if (theme === 'dunes') {
            const ds = plan.dunes;
            out.n = ds.length;
            out.walk = ds.every((d) => nav.walkableAt(d.x, d.z, 1));
            // 擋視線：迎風面坡腳外 2 m 的單位看不到背風面坡腳外 2 m；同樣距離、沒有沙丘的方向看得到
            let blocked = 0,
              tried = 0,
              ctrl = 0,
              ctrlN = 0;
            for (const d of ds.slice(0, 4)) {
              const c = Math.cos(d.rot),
                sn = Math.sin(d.rot);
              const at = (v) => ({ x: d.x - v * sn, z: d.z + v * c });
              const o = at(-d.ww - 2),
                tgt = at(d.w - d.ww + 2),
                far = at(-d.ww - 2 - (d.w + 4));
              if (Math.max(Math.abs(o.x), Math.abs(o.z), Math.abs(tgt.x), Math.abs(tgt.z)) > w.size / 2 - 20)
                continue;
              tried++;
              const u = g.rtsSpawn(0, 'c_mt', o.x, o.z, 0);
              u.rtsVision = 40;
              g.rtsFogTick(0.25);
              if (g.rtsFogState(0, tgt.x, tgt.z) !== 2) blocked++;
              // 對照：反方向同樣距離（路上沒有比觀察者高 1.5 m 以上的地形才算）
              let flat = true;
              for (let k = 1; k <= 10; k++)
                if (th(o.x + ((far.x - o.x) * k) / 10, o.z + ((far.z - o.z) * k) / 10) > th(o.x, o.z) + 1.5)
                  flat = false;
              if (flat) {
                ctrlN++;
                if (g.rtsFogState(0, far.x, far.z) === 2) ctrl++;
              }
              quiet(u);
              g.rtsFogTick(0.25);
            }
            out.tried = tried;
            out.blocked = blocked;
            out.ctrl = ctrl;
            out.ctrlN = ctrlN;
            out.fence = (plan.decor || []).filter((q) => q.model === 'sandfence').length;
            out.arch = plan.obstacles.filter((o) => o.model === 'archfoot').length;
          }
          if (theme === 'desert') {
            const P = plan.pit;
            out.depth = th(0, 0);
            out.D = P.depth;
            const A0 = plan.bases[0].ramp.bottom;
            const cn = (p, size) => {
              const c = nav.nearestCell(p.x, p.z, size, -1, 10);
              return c >= 0 ? nav.center(c) : p;
            };
            out.bigDown = nav.reachable(cn(A0, 2), cn({ x: 0, z: 0 }, 2), 2);
            const rich = R.mines.find((m) => Math.hypot(m.pos.x, m.pos.z) < 0.01);
            out.rich = rich ? rich.amount : 0;
            const pc = R.camps.find((c) => Math.hypot(c.pos.x, c.pos.z) < 0.01);
            out.pitCamp = pc ? pc.tier : 0;
            const tav = R.neutrals.find((q) => q.kind === 'tavern');
            out.tavR = Math.hypot(tav.ent.pos.x, tav.ent.pos.z);
            out.zone = P.zone;
            out.rails = (plan.decor || []).filter((q) => q.model === 'minerail').length;
          }
          if (theme === 'industrial') {
            out.stacks = plan.stacks.length;
            out.narrow = plan.yardMin;
            out.legs = w.obstacles.filter(
              (o) =>
                o.kind === 'circle' &&
                plan.obstacles.some(
                  (q) => q.model === 'gantryleg' && Math.hypot(q.x - o.x, q.z - o.z) < 0.01,
                ),
            ).length;
            // 擋子彈：最大的貨櫃堆兩側各一台，射線被擋住
            const st = plan.obstacles.filter((o) => o.model === 'ctrstack').sort((a, b) => b.h - a.h)[0];
            const along = st.w < st.d; // 短邊的方向放兩台
            const off = (along ? st.w : st.d) / 2 + 3;
            const pa = along ? { x: st.x - off, z: st.z } : { x: st.x, z: st.z - off },
              pb = along ? { x: st.x + off, z: st.z } : { x: st.x, z: st.z + off };
            const a = g.rtsSpawn(0, 'c_mt', pa.x, pa.z, 0),
              b = g.rtsSpawn(1, 'c_mt', pb.x, pb.z, 0);
            a.pos.set(pa.x, th(pa.x, pa.z), pa.z);
            b.pos.set(pb.x, th(pb.x, pb.z), pb.z);
            out.stackH = st.h;
            out.shotBlocked = a.rtsLosBlocked(b);
            quiet(a);
            quiet(b);
          }
          window.__sim(0.2);
          return out;
        }, theme);
        if (theme === 'dunes')
          check(
            s.n >= 8 && s.walk && s.tried >= 2 && s.blocked === s.tried && s.ctrl === s.ctrlN && s.fence > 0,
            `${tag}：沙丘 ${s.n} 道（可以走）、擋住低處的視線 ${s.blocked}／${s.tried}（沒有沙丘的方向看得到 ${s.ctrl}／${s.ctrlN}）、防沙柵欄 ${s.fence}、拱形殘骸的腳 ${s.arch}`,
          );
        if (theme === 'desert')
          check(
            Math.abs(s.depth + s.D) < 1.2 &&
              s.bigDown &&
              s.rich === 8000 &&
              s.pitCamp === 3 &&
              s.tavR > s.zone &&
              s.rails > 0,
            `${tag}：露天礦坑（坑底 ${s.depth.toFixed(1)} m、大型單位下得去 ${s.bigDown}、富礦 ${s.rich}、坑底營地 tier ${s.pitCamp}、酒館在坑緣 ${s.tavR.toFixed(0)} m、軌道 ${s.rails}）`,
          );
        if (theme === 'industrial')
          check(
            s.stacks >= 8 && s.narrow >= 8 && s.legs === 8 && s.shotBlocked,
            `${tag}：貨櫃堆 ${s.stacks} 組、巷道最窄 ${s.narrow.toFixed(1)} m、龍門起重機的腳 ${s.legs}、貨櫃堆（高 ${s.stackH.toFixed(1)} m）擋子彈 ${s.shotBlocked}`,
          );
        if (!full) continue;
        // 截圖：俯視與近景（沙丘、礦坑、貨櫃堆），量亮度
        for (const v of ['map', 'near']) {
          await ev(
            ({ v, theme }) => {
              const g = window.__game,
                R = g.rts,
                plan = g.world.rts;
              if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
              let p = { x: 0, z: 0 };
              if (v === 'near') {
                const q =
                  theme === 'dunes'
                    ? plan.dunes[0]
                    : theme === 'industrial'
                      ? plan.stacks[0]
                      : { x: 0, z: 0 };
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
            path: path.join(SHOT_DIR, `rts-r6-map-${theme}${v === 'near' ? '-near' : ''}.png`),
          });
          check(
            m.mean <= 0.82 && m.hi <= 0.25 && m.mean >= 0.08 && m.lo <= 0.45,
            `${theme} 的${v === 'map' ? '俯視' : '近景'}亮度（平均 ${m.mean.toFixed(2)}、過曝 ${Math.round(m.hi * 100)}%、死黑 ${Math.round(m.lo * 100)}%）`,
          );
        }
      }
    }

    // ---------- 小地圖（300 m）：十個主題各 1 個種子 ----------
    const small = [];
    for (const theme of [
      'wasteland',
      'snow',
      'institute',
      'spaceport',
      'grid086',
      'flooded',
      'dam',
      'dunes',
      'desert',
      'industrial',
    ]) {
      const st = await start({ theme, seed: 7, size: 300 });
      const q = await ev(() => {
        window.__pump(0.1, null, 1 / 30); // HUD 在主迴圈裡顯示
        const g = window.__game,
          R = g.rts,
          w = g.world,
          plan = w.rts;
        const out = {
          size: w.size,
          mines: plan.mines.length,
          camps: plan.camps.filter((c) => !c.pit).length,
          corals: plan.corals.length,
          neutrals: R.neutrals.length,
          lanes: plan.lanes.length,
        };
        // 鏡頭邊界：跳到很遠的地方會夾在 ±(size/2 − 16)
        g.rtsCamJump(1000, -1000);
        out.camX = R.cam.x;
        out.camZ = R.cam.z;
        g.rtsCamJump(0, 0);
        // 小地圖的位置（點右下 75% 的位置 → 鏡頭移到 (+size/4, +size/4)）
        const cv = document.getElementById('rtsMiniCv');
        out.rect = null;
        if (cv) {
          const rc = cv.getBoundingClientRect();
          const x = rc.left + rc.width * 0.75,
            y = rc.top + rc.height * 0.75;
          const el = document.elementFromPoint(x, y);
          out.miniEl = rc.width ? (el ? el.id || el.className || el.tagName : 'null') : 'hidden';
          if (rc.width > 0 && el === cv) out.rect = { x, y };
        }
        return out;
      });
      if (q.rect) {
        await page.mouse.click(q.rect.x, q.rect.y);
        q.mini = await ev(() => ({ x: window.__game.rts.cam.x, z: window.__game.rts.cam.z }));
      }
      small.push({ theme, ok: st.ok, ...q });
    }
    const lim = 150 - 16;
    const bad = small.filter(
      (q) =>
        !q.ok ||
        q.size !== 300 ||
        q.camps < 4 ||
        q.camps > 6 ||
        q.mines < 6 ||
        q.neutrals !== 5 ||
        q.lanes < 2 ||
        Math.abs(q.camX - lim) > 0.01 ||
        Math.abs(q.camZ + lim) > 0.01,
    );
    check(
      !bad.length,
      `小地圖 300 m 十個主題開局（礦脈 ${[...new Set(small.map((q) => q.mines))].join('/')}、營地 ${[...new Set(small.map((q) => q.camps))].join('/')}、通道 ${[...new Set(small.map((q) => q.lanes))].join('/')}、鏡頭夾在 ±${lim}）${bad.length ? '：不合格 ' + bad.map((q) => q.theme).join(' ') : ''}`,
    );
    const mm = small.filter((q) => q.mini);
    check(
      mm.length > 0 && mm.every((q) => Math.abs(q.mini.x - 75) < 3 && Math.abs(q.mini.z - 75) < 3),
      `小地圖的比例：點 75% 的位置鏡頭到 (${mm.length ? mm[0].mini.x.toFixed(0) + ', ' + mm[0].mini.z.toFixed(0) : '—（' + small[0].miniEl + '）'})（300 m 時是 75, 75）`,
    );
    // 電腦能蓋基地（荒野、300 m、電腦跑 90 秒）
    await start({ theme: 'wasteland', seed: 23, size: 300, ai: true });
    const ai = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const blds = () => R.units.filter((e) => e.bld && !e.dead && e.rtsTeam === 1).length;
      const b0 = blds();
      window.__sim(90, null, 1 / 10);
      const done = R.units.filter((e) => e.bld && !e.dead && e.rtsTeam === 1 && e.bld.progress >= 1).length;
      return { b0, b1: blds(), done };
    });
    check(ai.b1 > ai.b0 && ai.done > 1, `小地圖：電腦 90 秒蓋了建築（${ai.b0} → ${ai.b1}，完成 ${ai.done}）`);
    await ev(() => {
      const g = window.__game,
        R = g.rts;
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
      g.rtsCamJump(0, 0);
      if (R.cam) R.cam.dist = 190;
      window.__pump(0.3, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-r6-map-small.png') });
    await ctx.close();
  }

  return { testRtsThemes4 };
};
