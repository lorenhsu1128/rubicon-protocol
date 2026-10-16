// Coral 戰爭（RTS）的冒煙測試：由 smoke-test.js 載入 require('./smoke-rts')(H)，
// H＝smoke-test.js 的共用工具 { check, newPage, freezeLoop, seededRandom, wait, SHOT_DIR, path }；回傳各測試函式。
// 各 agent 在這裡加自己的測試（每個函式 (browser, base)），smoke-test.js 的 STEPS 加一行。
/* global window, document, localStorage, THREE -- page.evaluate 的回呼在瀏覽器端執行 */
module.exports = (H) => {
  const { check, newPage, freezeLoop, SHOT_DIR, path } = H;

  // ---------- 戰爭迷霧（game/rts-fog.js） ----------
  // 開局（核心 rtsStart 還沒有時用最小的局：planRtsMap 的地圖＋兩邊各一座建築）；單位一律以瞬間移動擺位置，
  // 主迴圈停住，只呼叫 rtsFogTick（不跑單位 AI），截圖用固定鏡頭直接 renderMain
  async function testRtsFog(browser, base) {
    console.log('Coral 戰爭：戰爭迷霧（視野、探索過、殘影、高低差視線、效能）');
    const { ctx, page } = await newPage(browser, 'rtsFog');
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const info = await page.evaluate(() => {
      const g = window.__game;
      const seed = 7;
      let core = false;
      if (typeof g.rtsStart === 'function') {
        try {
          g.rtsStart({
            theme: 'wasteland',
            seed,
            size: 400,
            faction: 'castron',
            aiFaction: 'castron',
            diff: 'normal',
          });
          core = !!(g.rts && g.world && g.world.rts);
        } catch (e) {
          console.warn('rtsStart 失敗，改用測試用的局：' + e.message);
        }
      }
      if (!core) {
        g.rtsMapPreview(seed);
        g.rtsPreviewClear();
        g.player = { pos: new THREE.Vector3() }; // spawnType 用
        g.rts = {
          cfg: { theme: 'wasteland', seed, diff: 'normal' },
          t: 0,
          teams: [
            { id: 0, team: 'player', ai: false, alive: true },
            { id: 1, team: 'enemy', ai: true, alive: true },
          ],
          units: [],
          mines: [],
          corals: [],
        };
      }
      const w = g.world,
        plan = w.rts;
      // 測試用的單位：核心的 rtsSpawn，沒有時用一般敵人的生成再標上隊伍
      window.__mk = (team, def, x, z, bld) => {
        let e = null;
        if (core && typeof g.rtsSpawn === 'function') e = g.rtsSpawn(team, def, x, z, 0);
        if (!e) {
          e = g.spawnType('mt', 1, 1, new THREE.Vector3(x, w.terrainHeight(x, z), z), 1);
          e.rtsTeam = team;
          e.rtsDef = def;
          e.team = team ? 'enemy' : 'player';
          if (bld) e.bld = { def, progress: 1, queue: [] };
          if (!g.rts.units.includes(e)) g.rts.units.push(e);
        }
        return e;
      };
      window.__tp = (e, x, z) => {
        e.pos.set(x, w.terrainHeight(x, z), z);
        if (e.mesh) e.mesh.position.copy(e.pos);
      };
      window.__fog = (n = 3) => {
        for (let i = 0; i < n; i++) g.rtsFogTick(0.25);
      };
      // 固定鏡頭的截圖：看向 (x, z)，距離 d
      window.__view = (x, z, d) => {
        document.querySelectorAll('.screen').forEach((s) => (s.style.display = 'none'));
        const c = g.camera;
        c.up.set(0, 1, 0);
        c.fov = 50;
        c.far = 3000;
        c.position.set(x, d * 0.85, z + d * 0.55);
        c.lookAt(x, 0, z);
        c.updateProjectionMatrix();
        g.scene.fog = null;
        g.renderMain();
      };
      const B = plan.bases;
      if (!core) {
        window.__mk(0, 'c_hq', B[0].pos.x, B[0].pos.z, true);
        window.__mk(1, 'c_hq', B[1].pos.x, B[1].pos.z, true);
      }
      if (!g.rts.fog) g.rtsFogInit();
      window.__fog(4);
      return {
        core,
        st0: g.rtsFogState(0, B[0].pos.x, B[0].pos.z),
        st1: g.rtsFogState(0, B[1].pos.x, B[1].pos.z),
        ai0: g.rtsFogState(1, B[1].pos.x, B[1].pos.z),
        ai1: g.rtsFogState(1, B[0].pos.x, B[0].pos.z),
        size: plan.size,
      };
    });
    console.log(`  （${info.core ? '核心 rtsStart 開局' : '測試用的局：核心還沒有 rtsStart'}）`);
    check(
      info.st0 === 2 && info.st1 === 0,
      `開局：自己的基地可見、對方基地未探索（${info.st0}／${info.st1}）`,
    );
    check(
      info.ai0 === 2 && info.ai1 === 0,
      `電腦的視野也一樣（自己的基地 ${info.ai0}、玩家的基地 ${info.ai1}）`,
    );
    await page.evaluate(() => window.__view(0, 0, 330));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-fog-start.png') });

    // 偵察：走到對方坡道下 → 可見；看得到附近的敵方單位；離開後變灰、敵方單位隱藏
    const r1 = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        B = w.rts.bases;
      const bot = B[1].ramp.bottom,
        top = B[1].ramp.top;
      // 坡道下往外（離開平台）一點，敵方單位在偵察機旁邊的低地
      const ox = bot.x + (bot.x - top.x) * 0.25,
        oz = bot.z + (bot.z - top.z) * 0.25;
      const scout = (window.__scout = window.__mk(0, 'c_mt', B[0].pos.x, B[0].pos.z));
      const foe = (window.__foe = window.__mk(1, 'c_mt', ox + 6, oz + 4));
      window.__tp(foe, ox + 6, oz + 4);
      window.__fog(2);
      const before = { st: g.rtsFogState(0, ox, oz), vis: g.rtsVisible(0, foe) };
      window.__tp(scout, ox, oz);
      window.__fog(2);
      const at = { st: g.rtsFogState(0, ox, oz), vis: g.rtsVisible(0, foe), nl: !!foe.noLock };
      const seeMe = g.rtsVisible(1, scout); // 電腦的單位也看得到偵察機
      const enemies = g.rtsFogEnemies(0).includes(foe);
      window.__tp(scout, B[0].pos.x, B[0].pos.z);
      window.__fog(2);
      const after = { st: g.rtsFogState(0, ox, oz), vis: g.rtsVisible(0, foe), nl: !!foe.noLock };
      // 算繪時隱藏、之後還原（不動其他機制自己的 visible）
      g.scene.onBeforeRender(g.renderer, g.scene, g.camera, null);
      const hidDuring = foe.mesh && foe.mesh.visible === false;
      g.scene.onAfterRender(g.renderer, g.scene, g.camera);
      const restored = foe.mesh && foe.mesh.visible === true;
      return { before, at, after, seeMe, enemies, hidDuring, restored, ox, oz };
    });
    check(r1.before.st === 0 && !r1.before.vis, `偵察前：對方坡道下未探索、看不到敵方單位`);
    check(r1.at.st === 2 && r1.at.vis && !r1.at.nl, `走到對方坡道下：可見，看得到旁邊的敵方單位（可以鎖定）`);
    check(r1.seeMe && r1.enemies, `電腦也看得到偵察機；rtsFogEnemies 列出看得到的敵人`);
    check(
      r1.after.st === 1 && !r1.after.vis && r1.after.nl,
      `離開後：變成探索過（灰）、敵方單位看不到且不能鎖定（${r1.after.st}）`,
    );
    check(r1.hidDuring && r1.restored, `灰區的敵方單位算繪時隱藏、算繪後還原 visible`);
    await page.evaluate(({ ox, oz }) => window.__view(ox, oz, 120), r1);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-fog-grey.png') });

    // 敵方建築的殘影：看過之後離開 → 殘影；在迷霧裡被摧毀 → 殘影還在；再看到 → 消失
    const r2 = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        B = w.rts.bases,
        F = g.rts.fog;
      const hq = g.rts.units.find((e) => e.bld && e.rtsTeam === 1 && !e.dead);
      if (!hq) return { none: true };
      const scout = window.__scout;
      window.__tp(scout, hq.pos.x + 8, hq.pos.z + 8);
      window.__fog(2);
      const seen = g.rtsVisible(0, hq) && F.ghosts.children.length === 0;
      window.__tp(scout, B[0].pos.x, B[0].pos.z);
      window.__fog(2);
      const ghost = F.ghosts.children.length === 1 && !g.rtsVisible(0, hq);
      const known = g.rtsFogKnown(0).some((k) => k.id === hq.id);
      const stGrey = g.rtsFogState(0, hq.pos.x, hq.pos.z);
      // 在迷霧裡被摧毀
      hq.dead = true;
      if (hq.mesh && hq.mesh.parent) hq.mesh.parent.remove(hq.mesh);
      window.__fog(2);
      const ghostAfterDeath = F.ghosts.children.length === 1;
      return { seen, ghost, known, stGrey, ghostAfterDeath, x: hq.pos.x, z: hq.pos.z, id: hq.id };
    });
    if (r2.none) check(false, '找不到對方的建築');
    else {
      check(r2.seen, '偵察到對方的主堡（看得到、沒有殘影）');
      check(r2.ghost && r2.known && r2.stGrey === 1, '離開後：主堡留下殘影、記得它的位置（電腦 AI 用）');
      check(r2.ghostAfterDeath, '在迷霧裡被摧毀：殘影還在');
      await page.evaluate(({ x, z }) => window.__view(x, z, 110), r2);
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-fog-ghost.png') });
      const r3 = await page.evaluate(({ x, z, id }) => {
        const g = window.__game;
        window.__tp(window.__scout, x + 8, z + 8);
        window.__fog(2);
        return {
          ghosts: g.rts.fog.ghosts.children.length,
          known: g.rtsFogKnown(0).some((k) => k.id === id),
        };
      }, r2);
      check(r3.ghosts === 0 && !r3.known, `再看到該處：殘影消失（${r3.ghosts}）`);
    }

    // 高低差視線：坡道下看不到平台上的單位，爬上坡道才看得到
    const r4 = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        B = w.rts.bases;
      const bot = B[0].ramp.bottom,
        top = B[0].ramp.top;
      const dx = top.x - bot.x,
        dz = top.z - bot.z,
        L = Math.hypot(dx, dz);
      // 從平台中心往外找一個斷崖（避開坡道方向）：平台上離邊緣 5 m 的點、斷崖下的低地
      const c = B[0].pos,
        H0 = w.terrainHeight(c.x, c.z),
        ra = Math.atan2(dx, dz);
      let hx = 0,
        hz = 0,
        lx = 0,
        lz = 0;
      for (let k = 0; k < 16; k++) {
        const a = ra + Math.PI / 2 + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.3,
          sx = Math.sin(a),
          sz = Math.cos(a);
        let edge = -1;
        for (let d = 2; d < 80; d += 0.5)
          if (w.terrainHeight(c.x + sx * d, c.z + sz * d) < H0 - 0.5) {
            edge = d;
            break;
          }
        if (edge < 0) continue;
        let low = -1;
        for (let d = edge; d < edge + 20; d += 0.5)
          if (
            w.terrainHeight(c.x + sx * d, c.z + sz * d) < H0 - 5 &&
            w.nav.walkableAt(c.x + sx * d + sx * 2, c.z + sz * d + sz * 2)
          ) {
            low = d + 2;
            break;
          }
        if (low < 0) continue;
        hx = c.x + sx * (edge - 5);
        hz = c.z + sz * (edge - 5);
        lx = c.x + sx * low;
        lz = c.z + sz * low;
        break;
      }
      const scout = window.__scout;
      // 對方的單位上到玩家的平台（玩家自己的建築與單位先移開：只看偵察機的視野）
      const mine = g.rts.units.filter((e) => e.rtsTeam === 0 && e !== scout && !e.dead);
      const keep = mine.map((e) => [e, e.pos.x, e.pos.z]);
      for (const e of mine) window.__tp(e, -B[0].pos.x, -B[0].pos.z + 30); // 移到對方那一半的低地
      const hi = (window.__hi = window.__mk(1, 'c_mt', hx, hz));
      window.__tp(hi, hx, hz);
      window.__tp(scout, lx, lz);
      window.__fog(2);
      const low = {
        dh: w.terrainHeight(hx, hz) - w.terrainHeight(lx, lz),
        d: Math.hypot(hx - lx, hz - lz),
        vis: g.rtsVisible(0, hi),
        hiSees: g.rtsVisible(1, scout), // 高處看得到低處
      };
      // 坡道：敵方單位在坡道頂再往平台裡面 6 m；偵察機在坡道 35% 看不到、爬到 85% 看得到
      const tx = top.x + (dx / L) * 6,
        tz = top.z + (dz / L) * 6;
      window.__tp(hi, tx, tz);
      const on = (f) => {
        const ux = bot.x + dx * f,
          uz = bot.z + dz * f;
        window.__tp(scout, ux, uz);
        window.__fog(2);
        return {
          vis: g.rtsVisible(0, hi),
          dh: w.terrainHeight(tx, tz) - w.terrainHeight(ux, uz),
          d: Math.hypot(tx - ux, tz - uz),
        };
      };
      const mid = on(0.35);
      const up = on(0.85);
      window.__tp(hi, hx, hz);
      window.__tp(scout, lx, lz);
      window.__fog(2);
      window.__lowAt = [lx, lz];
      window.__keep = keep;
      return { low, mid, up };
    });
    check(r4.low.dh > 2.5, `平台比斷崖下高 ${r4.low.dh.toFixed(1)} m`);
    check(
      !r4.low.vis && r4.low.hiSees,
      `斷崖下（距離 ${r4.low.d.toFixed(0)} m）看不到平台上的敵方單位，平台上的看得到下面`,
    );
    check(
      !r4.mid.vis && r4.up.vis,
      `坡道中段（高差 ${r4.mid.dh.toFixed(1)} m、距離 ${r4.mid.d.toFixed(0)} m）看不到坡道頂的敵方單位，爬上去（高差 ${r4.up.dh.toFixed(1)} m）就看得到`,
    );
    await page.evaluate(() => {
      const B = window.__game.world.rts.bases;
      window.__view(B[0].pos.x, B[0].pos.z, 120);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-fog-highground.png') });

    // 效能：120 個單位（兩隊各一半）的視野重算
    const perf = await page.evaluate(() => {
      const g = window.__game,
        w = g.world,
        F = g.rts.fog,
        L = w.size * 0.42;
      const fake = [];
      let s = 12345;
      const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < 120; i++) {
        const x = (r() * 2 - 1) * L,
          z = (r() * 2 - 1) * L;
        fake.push({
          id: 'p' + i,
          pos: new THREE.Vector3(x, w.terrainHeight(x, z), z),
          rtsTeam: i & 1,
          rtsVision: 26 + (i % 4) * 4,
        });
      }
      const n0 = g.rts.units.length;
      g.rts.units.push(...fake);
      for (let i = 0; i < 5; i++) g.rtsFogUpdate(F);
      const t0 = performance.now();
      const N = 60;
      let max = 0;
      for (let i = 0; i < N; i++) {
        const a = performance.now();
        g.rtsFogUpdate(F);
        max = Math.max(max, performance.now() - a);
      }
      const avg = (performance.now() - t0) / N;
      const a1 = performance.now();
      for (let i = 0; i < N; i++) g.rtsFogApply(F, 1 / 60);
      const apply = (performance.now() - a1) / N;
      g.rts.units.length = n0;
      window.__fog(2);
      return { avg, max, apply, W: F.W };
    });
    console.log(
      `  視野格 ${perf.W}×${perf.W}、120 個單位：重算平均 ${perf.avg.toFixed(3)} ms（最大 ${perf.max.toFixed(2)}），每格套用 ${perf.apply.toFixed(3)} ms`,
    );
    check(perf.avg < 2, `120 個單位的視野重算 < 2 ms（${perf.avg.toFixed(3)} ms）`);
    await page.evaluate(() => window.__view(0, 0, 330));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-fog-explored.png') });
    await ctx.close();
  }

  // ---------- 鏡頭、選取、指令、HUD（game/rts-input.js、rts-hud.js） ----------
  // 核心有 rtsStart 時用它開局，否則用測試用的局（地圖＋假的單位與建築）。下指令的 API（rtsSmart／rtsOrder／rtsQueue）
  // 包一層記錄呼叫（核心有的話照常執行）。主迴圈停住，__tick 逐格呼叫 rtsTick（沒有時 rtsCamUpdate）＋算繪
  async function testRtsInput(browser, base) {
    console.log('Coral 戰爭：鏡頭、選取、編隊、指令卡、建造預覽、小地圖、HUD');
    const { ctx, page } = await newPage(browser, 'rtsInput');
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const info = await page.evaluate(() => {
      const g = window.__game;
      const seed = 11;
      let core = false;
      if (typeof g.rtsStart === 'function') {
        try {
          g.rtsStart({
            theme: 'wasteland',
            seed,
            size: 400,
            faction: 'castron',
            aiFaction: 'castron',
            diff: 'easy',
          });
          core = !!(g.rts && g.world && g.world.rts);
        } catch (e) {
          console.warn('rtsStart 失敗，改用測試用的局：' + e.message);
        }
      }
      if (!core) {
        g.rtsMapPreview(seed);
        g.rtsPreviewClear();
        g.player = { pos: new THREE.Vector3() };
        g.rts = {
          cfg: { theme: 'wasteland', seed, diff: 'easy' },
          t: 0,
          teams: [
            {
              id: 0,
              team: 'player',
              faction: 'castron',
              ore: 500,
              coral: 100,
              pop: 5,
              cap: 10,
              ai: false,
              alive: true,
            },
            {
              id: 1,
              team: 'enemy',
              faction: 'castron',
              ore: 500,
              coral: 100,
              pop: 5,
              cap: 10,
              ai: true,
              alive: true,
            },
          ],
          units: [],
          mines: [],
          corals: [],
          sel: [],
          groups: {},
        };
        g.state = 'rts';
        g.showScreen('');
      }
      const w = g.world,
        R = g.rts;
      const B = w.rts.bases[0];
      // 測試用的單位：核心的 rtsSpawn，沒有時用一般敵人的生成再標上隊伍
      window.__mk = (team, def, x, z, bld) => {
        let e = null;
        if (core && typeof g.rtsSpawn === 'function') e = g.rtsSpawn(team, def, x, z, 0);
        if (!e) {
          e = g.spawnType('mt', 1, 1, new THREE.Vector3(x, w.terrainHeight(x, z), z), 1);
          e.rtsTeam = team;
          e.rtsDef = def;
          e.team = team ? 'enemy' : 'player';
          e.ai = 'idle';
          if (bld) e.bld = { def, progress: 1, queue: [] };
          if (!R.units.includes(e)) R.units.push(e);
        }
        return e;
      };
      if (!core) {
        window.__mk(0, 'c_hq', B.pos.x, B.pos.z, true);
        for (let i = 0; i < 3; i++) window.__mk(0, 'c_worker', B.pos.x - 14 + i * 3, B.pos.z + 12);
      }
      // 自己的 MT 四台（主堡旁邊的空地）
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.bld);
      const spot = (dx, dz) => [hq.pos.x + dx, hq.pos.z + dz];
      window.__mts = [];
      for (let i = 0; i < 4; i++) {
        const [x, z] = spot(-6 + i * 4, -16);
        const e = window.__mk(0, 'c_mt', x, z);
        e.pos.set(x, w.terrainHeight(x, z), z);
        window.__mts.push(e);
      }
      // 記錄下指令的呼叫
      window.__calls = [];
      for (const fn of ['rtsSmart', 'rtsOrder', 'rtsQueue', 'rtsCancel']) {
        const orig = g[fn];
        g[fn] = function (...a) {
          window.__calls.push({ fn, a });
          return typeof orig === 'function' ? orig.apply(g, a) : undefined;
        };
      }
      // 停住單位：測試只看輸入（核心的 AI 不跑，避免單位在兩次 evaluate 之間移動）
      window.__tick = (n = 1) => {
        for (let i = 0; i < n; i++) {
          g.lastT = performance.now() + i; // rtsHudTick 每格只跑一次（以 lastT 判斷）
          g.rtsCamUpdate(1 / 60);
          g.renderMain();
        }
      };
      window.__scr = (e) => {
        const s = {};
        g.rtsScreen(e, s);
        return [Math.round(s.x), Math.round(s.y)];
      };
      g.rtsInputInit();
      g.rtsCamJump(hq.pos.x, hq.pos.z - 8);
      window.__tick(10);
      return { core, hq: hq.id };
    });
    console.log(`  （${info.core ? '核心 rtsStart 開局' : '測試用的局：核心還沒有 rtsStart'}）`);
    const ev = (fn, arg) => page.evaluate(fn, arg);
    const tick = (n) => ev((n) => window.__tick(n), n);
    check(await page.isVisible('#rtsHud #rtsCard'), 'RTS 的 HUD 顯示（資源列、小地圖、選取面板、指令卡）');

    // 鏡頭：方向鍵、畫面邊緣、滾輪、Home
    const cam = () => ev(() => ({ ...window.__game.rts.cam }));
    const c0 = await cam();
    await page.mouse.move(960, 500);
    await page.keyboard.down('ArrowRight');
    await tick(30);
    await page.keyboard.up('ArrowRight');
    const c1 = await cam();
    check(c1.x > c0.x + 5, `方向鍵（→）捲動鏡頭（x ${c0.x.toFixed(0)} → ${c1.x.toFixed(0)}）`);
    await page.mouse.move(960, 0);
    await tick(30);
    const c2 = await cam();
    check(c2.z < c1.z - 5, `畫面上緣捲動（z ${c1.z.toFixed(0)} → ${c2.z.toFixed(0)}）`);
    await page.mouse.move(960, 500);
    await page.mouse.wheel(0, 400);
    await tick(2);
    const c3 = await cam();
    check(c3.dist > c2.dist, `滾輪拉遠（${c2.dist.toFixed(0)} → ${c3.dist.toFixed(0)} m）`);
    for (let i = 0; i < 20; i++) await page.mouse.wheel(0, 400);
    await tick(2);
    const far = await ev(() => {
      const g = window.__game;
      return { dist: g.rts.cam.dist, far: g.camera.far, fog: g.scene.fog ? g.scene.fog.far : 1e9 };
    });
    check(
      far.far >= far.dist * 4 && far.fog > far.dist * 2.2,
      `拉到最遠（${far.dist.toFixed(0)} m）：鏡頭 far ${far.far.toFixed(0)}、霧 ${far.fog.toFixed(0)} m，整張圖不被霧蓋住`,
    );
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-far.png') });
    // 鏡頭限制在地圖範圍內
    await ev(() => window.__game.rtsCamJump(9999, -9999));
    const lim = await ev(() => ({ c: window.__game.rts.cam, S: window.__game.world.size / 2 }));
    check(Math.abs(lim.c.x) < lim.S && Math.abs(lim.c.z) < lim.S, '鏡頭不會超出地圖');
    // Alt＋拖曳旋轉、Home 重設
    await page.keyboard.down('Alt');
    await page.mouse.move(900, 500);
    await page.mouse.down();
    await page.mouse.move(1000, 500, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    const yaw = (await cam()).yaw;
    await page.keyboard.press('Home');
    const c4 = await cam();
    check(
      Math.abs(yaw) > 0.2 && c4.yaw === 0 && c4.dist < far.dist,
      `Alt＋拖曳旋轉（${yaw.toFixed(2)}）、Home 重設`,
    );
    await ev(() => {
      const g = window.__game,
        m = window.__mts;
      g.rtsCamJump(m[1].pos.x, m[1].pos.z + 4);
    });
    await tick(5);

    // 點選
    const mts = await ev(() => window.__mts.map((e) => window.__scr(e)));
    await page.mouse.click(mts[0][0], mts[0][1]);
    await tick(2);
    let sel = await ev(() => window.__game.rts.sel.map((e) => window.__mts.indexOf(e)));
    check(sel.length === 1 && sel[0] === 0, `左鍵點選一台 MT（${JSON.stringify(sel)}）`);
    // 框選：框住四台 MT 與主堡 → 只選單位
    const xs = mts.map((p) => p[0]),
      ys = mts.map((p) => p[1]);
    const hqS = await ev((id) => window.__scr(window.__game.rts.units.find((e) => e.id === id)), info.hq);
    const bx0 = Math.min(...xs, hqS[0]) - 40,
      by0 = Math.min(...ys, hqS[1]) - 40,
      bx1 = Math.max(...xs, hqS[0]) + 40,
      by1 = Math.max(...ys, hqS[1]) + 40;
    await page.mouse.move(bx0, by0);
    await page.mouse.down();
    await page.mouse.move(bx1, by1, { steps: 6 });
    await tick(1);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-drag.png') });
    await page.mouse.up();
    await tick(2);
    sel = await ev(() => window.__game.rts.sel.map((e) => (e.bld ? 'B' : window.__mts.indexOf(e))));
    check(
      sel.length >= 4 && !sel.includes('B') && [0, 1, 2, 3].every((i) => sel.includes(i)),
      `框選：四台 MT 都選到、有單位時不選建築（${JSON.stringify(sel)}）`,
    );
    // 框選後選取面板是小圖示格子
    check((await page.$$('#rtsPanel .rtsU')).length === sel.length, '多選：選取面板列出每一個單位');
    // Shift＋點選：取消一台
    await page.keyboard.down('Shift');
    await page.mouse.click(mts[2][0], mts[2][1]);
    await page.keyboard.up('Shift');
    await tick(1);
    sel = await ev(() => window.__game.rts.sel.map((e) => window.__mts.indexOf(e)));
    check(!sel.includes(2) && sel.includes(0), `Shift＋點選：取消選取（${JSON.stringify(sel)}）`);
    // 編隊：Ctrl＋1 → 點空地取消選取 → 1 選回；連按兩下鏡頭跳過去
    await page.keyboard.press('Control+Digit1');
    await page.keyboard.press('Escape'); // 沒有模式時＝暫停（核心沒有 rtsPause 時沒有作用）
    await ev(() => {
      const g = window.__game;
      if (g.state !== 'rts') {
        g.state = 'rts';
        if (g.showScreen) g.showScreen('');
      }
      g.rtsSetSel([]);
    });
    await page.keyboard.press('Digit1');
    sel = await ev(() => window.__game.rts.sel.map((e) => window.__mts.indexOf(e)));
    check(sel.length >= 2 && !sel.includes(2), `Ctrl＋1 編隊、按 1 選回（${JSON.stringify(sel)}）`);
    await ev(() => window.__game.rtsCamJump(0, 0));
    await page.keyboard.press('Digit1');
    await page.keyboard.press('Digit1');
    const cj = await ev(() => {
      const g = window.__game,
        c = g.rts.cam,
        m = window.__mts[0];
      return Math.hypot(c.x - m.pos.x, c.z - m.pos.z);
    });
    check(cj < 20, `連按兩下 1：鏡頭跳到編隊（離 ${cj.toFixed(1)} m）`);
    await tick(3);
    // 雙擊：選畫面內同種
    const mts2 = await ev(() => window.__mts.map((e) => window.__scr(e)));
    await page.mouse.dblclick(mts2[1][0], mts2[1][1]);
    await tick(1);
    sel = await ev(() => window.__game.rts.sel.filter((e) => e.rtsDef === 'c_mt').length);
    check(sel >= 4, `雙擊：選畫面內的同種單位（${sel} 台）`);

    // 右鍵：智慧指令與指令標記
    await ev(() => (window.__calls.length = 0));
    const gx = mts2[1][0] + 160,
      gy = mts2[1][1] - 60;
    await page.mouse.click(gx, gy, { button: 'right' });
    await tick(4);
    const rc = await ev(() => {
      const g = window.__game;
      const c = window.__calls.find((q) => q.fn === 'rtsSmart' || q.fn === 'rtsOrder');
      const mk = g.rts.ui.marks.find((m) => m.mesh.visible);
      return c
        ? { fn: c.fn, n: c.a[0].length, x: c.a[1] && c.a[1].x !== undefined ? c.a[1].x : c.a[1], mk: !!mk }
        : null;
    });
    check(!!rc && rc.n >= 4 && rc.mk, `右鍵點地面：${rc && rc.fn}（${rc && rc.n} 個單位）＋指令標記`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-1920.png') });

    // 指令卡快捷鍵：A＝攻擊（選目標）→ 左鍵；S＝停止
    await ev(() => (window.__calls.length = 0));
    await page.keyboard.press('KeyA');
    const mode = await ev(() => window.__game.rts.ui.mode && window.__game.rts.ui.mode.order);
    await page.mouse.click(gx - 40, gy + 20);
    await page.keyboard.press('KeyS');
    const ks = await ev(() =>
      window.__calls.filter((q) => q.fn === 'rtsOrder').map((q) => q.a[1] && q.a[1].k),
    );
    check(
      mode === 'amove' && ks[0] === 'amove' && ks.includes('stop'),
      `A＋左鍵＝攻擊移動、S＝停止（${ks.join('、')}）`,
    );
    // H（alt 鍵）＝守住
    await page.keyboard.press('KeyH');
    const kh = await ev(() => window.__calls.filter((q) => q.fn === 'rtsOrder').map((q) => q.a[1].k));
    check(kh.includes('hold'), 'H＝守住');
    // 目標模式中 Esc 取消（不暫停）
    await page.keyboard.press('KeyA');
    await page.keyboard.press('Escape');
    const esc = await ev(() => ({ m: window.__game.rts.ui.mode, st: window.__game.state }));
    check(!esc.m && esc.st === 'rts', 'Esc 先取消目前的模式');

    // 選主堡：指令卡的 Q＝生產作業 MT
    await ev(() => (window.__calls.length = 0));
    const hq2 = await ev((id) => {
      const g = window.__game;
      const hq = g.rts.units.find((e) => e.id === id);
      g.rtsCamJump(hq.pos.x, hq.pos.z);
      window.__tick(3);
      return window.__scr(hq);
    }, info.hq);
    await page.mouse.click(hq2[0], hq2[1]);
    await tick(2);
    const card = await ev(() =>
      [...document.querySelectorAll('#rtsCard .rtsCmd')].map((b) => b.querySelector('b').textContent),
    );
    await page.keyboard.press('KeyQ');
    const tq = await ev(() => window.__calls.filter((q) => q.fn === 'rtsQueue').map((q) => q.a[1]));
    check(
      card[0] === '作業 MT' && tq[0] === 'c_worker',
      `選主堡：指令卡 Q＝${card[0]}、按 Q 生產（${tq.join()}）`,
    );
    await tick(3);
    await page.setViewportSize({ width: 1180, height: 820 });
    await ev(() => window.__game.resize());
    await tick(3);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-1180.png') });
    const lay = await ev(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const a = r('rtsMini'),
        b = r('rtsPanel'),
        c = r('rtsCard');
      return {
        ok:
          a.right <= b.left &&
          b.right <= c.left &&
          c.right <= window.innerWidth &&
          c.bottom <= window.innerHeight,
        pw: b.width,
      };
    });
    check(
      lay.ok && lay.pw > 300,
      `1180×820：小地圖、選取面板、指令卡不重疊（面板寬 ${Math.round(lay.pw)} px）`,
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await ev(() => window.__game.resize());

    // 建造：選工人 → Z（建造）→ W（補給庫）→ 預覽綠／紅 → 左鍵放置
    await ev(() => (window.__calls.length = 0));
    const wk = await ev(() => {
      const g = window.__game;
      const w = g.rts.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_worker' && !e.dead);
      g.rtsCamJump(w.pos.x, w.pos.z);
      window.__tick(3);
      g.rtsSetSel([w]);
      return w.id;
    });
    await page.keyboard.press('KeyZ');
    const menu = await ev(() => window.__game.rts.ui.menu);
    await page.keyboard.press('KeyW');
    const bm = await ev(() => window.__game.rts.ui.mode);
    check(
      menu === 'build' && bm && bm.k === 'build' && bm.def === 'c_depot',
      `工人：Z 開建造選單、W 選補給庫（${bm && bm.def}）`,
    );
    // 在畫面上找可以蓋與不能蓋的位置
    const spots = await ev(() => {
      const g = window.__game,
        nav = g.world.nav;
      let ok = null,
        bad = null;
      for (let y = 160; y < 820 && !(ok && bad); y += 23)
        for (let x = 300; x < 1600 && !(ok && bad); x += 29) {
          const p = g.rtsGroundAt(x, y);
          if (!p) continue;
          const b = nav.buildable(p.x, p.z, 10, 10) && (!g.rtsFogState || g.rtsFogState(0, p.x, p.z) > 0);
          if (b && !ok) ok = [x, y];
          if (!b && !nav.buildable(p.x, p.z, 4, 4) && !bad) bad = [x, y];
        }
      return { ok, bad };
    });
    let ghostOk = null,
      ghostBad = null;
    if (spots.bad) {
      await page.mouse.move(spots.bad[0], spots.bad[1]);
      await tick(2);
      ghostBad = await ev(() => window.__game.rts.ui.ghost && window.__game.rts.ui.ghost.ok);
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-build-red.png') });
    }
    if (spots.ok) {
      await page.mouse.move(spots.ok[0], spots.ok[1]);
      await tick(2);
      ghostOk = await ev(() => {
        const G = window.__game.rts.ui.ghost;
        return G && G.g.visible && G.ok && G.box.material.color.getHex() === 0x40ff70;
      });
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-build-green.png') });
    }
    check(
      ghostOk === true && ghostBad === false,
      `建造預覽：空地綠色、不能蓋的地方紅色（${ghostOk}／${ghostBad}）`,
    );
    if (spots.ok) await page.mouse.click(spots.ok[0], spots.ok[1]);
    const bo = await ev(() => {
      const c = window.__calls.find((q) => q.fn === 'rtsOrder' && q.a[1] && q.a[1].k === 'build');
      return c
        ? { n: c.a[0].length, id: c.a[0][0].id, def: c.a[1].def, mode: window.__game.rts.ui.mode }
        : null;
    });
    check(
      !!bo && bo.n === 1 && bo.id === wk && bo.def === 'c_depot' && !bo.mode,
      '左鍵放置：派工人去建造、離開建造模式',
    );

    // 小地圖：點一下鏡頭跳過去
    const mm = await ev(() => {
      const r = document.getElementById('rtsMiniCv').getBoundingClientRect();
      return [r.left + r.width * 0.75, r.top + r.height * 0.25, window.__game.world.size];
    });
    await page.mouse.click(mm[0], mm[1]);
    const cm = await cam();
    check(
      Math.abs(cm.x - mm[2] * 0.25) < 8 && Math.abs(cm.z + mm[2] * 0.25) < 8,
      `點小地圖：鏡頭移到 (${cm.x.toFixed(0)}, ${cm.z.toFixed(0)})`,
    );
    // Tab 子群組：選工人＋MT → Tab 換作用中的種類（指令卡跟著換）
    const tab0 = await ev(() => {
      const g = window.__game;
      const w = g.rts.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_worker' && !e.dead);
      g.rtsSetSel([w, ...window.__mts]);
      return g.rtsActiveGroup()[0].rtsDef;
    });
    await page.keyboard.press('Tab');
    const tab = [tab0, await ev(() => window.__game.rtsActiveGroup()[0].rtsDef)];
    check(tab[0] !== tab[1], `Tab 換子群組（${tab.join(' → ')}）`);
    // 核心在時：照主迴圈跑 3 秒（rtsTick → rtsCamUpdate → HUD），選主堡看生產佇列的進度
    if (info.core) {
      const run = await ev((id) => {
        const g = window.__game;
        const hq = g.rts.units.find((e) => e.id === id);
        g.rtsSetSel([hq]);
        g.rtsCamJump(hq.pos.x, hq.pos.z);
        window.__pump(3);
        return {
          t: g.rts.t,
          clock: document.getElementById('rtsClock').textContent,
          q: hq.bld.queue.length,
          prog: !!document.querySelector('#rtsPanel .rtsProg'),
        };
      }, info.hq);
      check(
        run.t > 2.5 && run.clock !== '0:00' && (run.q === 0 || run.prog),
        `主迴圈 3 秒：時鐘 ${run.clock}、主堡的生產佇列 ${run.q} 項${run.prog ? '（顯示進度）' : ''}`,
      );
      await page.setViewportSize({ width: 1180, height: 820 });
      await ev(() => {
        window.__game.resize();
        window.__pump(0.1);
      });
      await page.screenshot({ path: path.join(SHOT_DIR, 'rts-hud-1180-queue.png') });
    }
    await ctx.close();
  }

  // ---------- 核心（game/rts.js、rts-orders.js、entities/mech-rts.js） ----------
  // 標題按鈕 → 選單（預覽縮圖）→ 開局：兩邊主堡＋5 工人；採礦資源增加；建補給庫人口上限增加；兵工廠生產 MT；
  // 移動指令繞過建築走到目標；攻擊移動交戰；拆光對方建築 → 勝利畫面；局內不改存檔；120 台的指令與索敵耗時。
  // 遊戲時間一律由頁面裡的 rtsSim（只模擬，__sim）或 __pump（模擬＋算繪）推進
  async function testRtsCore(browser, base) {
    console.log('Coral 戰爭：核心（開局、採礦、建造、生產、移動、交戰、勝敗）');
    const { ctx, page } = await newPage(browser, 'rtsCore');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    const ev = (fn, a) => page.evaluate(fn, a);
    const saves = () =>
      ev(() => {
        const o = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (/^rubicon_save/.test(k)) o[k] = localStorage.getItem(k);
        }
        return JSON.stringify(o);
      });
    const save0 = await saves();
    const shown = (id) =>
      ev((id) => {
        const el = document.getElementById(id);
        return !!el && el.classList.contains('on');
      }, id);
    // 標題 → 選單
    check(await ev(() => !!document.getElementById('btnRts')), '標題畫面有「Coral 戰爭」按鈕');
    await page.click('#btnRts');
    await page.waitForTimeout(300);
    check(await shown('rtsMenu'), '選單畫面顯示');
    await page.waitForFunction(
      () => (document.getElementById('rtsPrevImg').src || '').startsWith('data:image'),
      null,
      { timeout: 30000 },
    );
    const menu = await ev(() => ({
      facs: [...document.querySelectorAll('#rtsMenu [data-pf]')].map((b) => [b.dataset.pf, b.disabled]),
      info: document.getElementById('rtsPrevInfo').textContent,
      state: window.__game.state,
    }));
    check(
      menu.facs.length === 4 &&
        menu.facs
          .filter((f) => !f[1])
          .map((f) => f[0])
          .join() === 'castron',
      `陣營四個、只有卡斯特隆可以選（${menu.facs.map((f) => f[0] + (f[1] ? '×' : '')).join('、')}）`,
    );
    check(/礦脈 \d+/.test(menu.info) && menu.state === 'rtsmenu', `地圖預覽（${menu.info}）`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-menu.png') });
    await page.fill('#rtsSeed', '7');
    await freezeLoop(page);
    await ev(() => (window.__game.rtsAiOff = true)); // 電腦對手（rts-ai.js）由 testRtsAi 測；這裡的電腦不動
    await page.click('#rtsGo');
    const st = await ev(() => {
      const g = window.__game,
        R = g.rts;
      // 只推進模擬（不算繪）：sec 秒或 until() 成立；逾時回傳 -1
      window.__sim = (sec, until, dt = 1 / 20) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
        }
        return until && !until() ? -1 : t;
      };
      const of = (team, def) => R.units.filter((e) => e.rtsTeam === team && e.rtsDef === def && !e.dead);
      return {
        state: g.state,
        hq: [of(0, 'c_hq').length, of(1, 'c_hq').length],
        wk: [of(0, 'c_worker').length, of(1, 'c_worker').length],
        res: [R.teams[0].ore, R.teams[0].coral],
        pop: [R.teams[0].pop, R.teams[0].cap],
        mines: R.mines.length,
        corals: R.corals.length,
        player: g.player,
        gather: of(0, 'c_worker').every((e) => e.orders[0] && e.orders[0].k === 'gather'),
      };
    });
    check(st.state === 'rts' && st.player === null, `開局：state ${st.state}、沒有玩家機甲`);
    check(
      st.hq.join() === '1,1' && st.wk.join() === '5,5',
      `兩邊主堡 ${st.hq.join('／')}、工人 ${st.wk.join('／')}`,
    );
    check(
      st.res.join() === '500,100' && st.pop.join() === '5,10',
      `開局資源：礦石 ${st.res[0]}、Coral ${st.res[1]}，人口 ${st.pop.join('/')}`,
    );
    check(
      st.mines >= 6 && st.corals >= 4 && st.gather,
      `礦脈 ${st.mines}、Coral 湧出點 ${st.corals}，工人開局就去採礦`,
    );
    await ev(() => window.__pump(0.6, null, 1 / 30));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-start.png') });
    // 暫停選單：Esc → 暫停（放棄＝回 Coral 戰爭選單），繼續 → 回到 'rts'
    await page.keyboard.press('Escape');
    const pz = await ev(() => ({
      state: window.__game.state,
      abort: document.getElementById('btnAbort').textContent,
      on: document.getElementById('pause').classList.contains('on'),
    }));
    await page.click('#btnResume');
    const rs = await ev(() => window.__game.state);
    check(
      pz.state === 'pause' && pz.on && pz.abort.includes('Coral 戰爭') && rs === 'rts',
      `Esc 暫停（${pz.abort}）、繼續回到 ${rs}`,
    );
    // 採礦 40 秒
    const mine = await ev(() => {
      const R = window.__game.rts;
      const o0 = R.teams[0].ore,
        o1 = R.teams[1].ore;
      window.__sim(40);
      return {
        d0: R.teams[0].ore - o0,
        d1: R.teams[1].ore - o1,
        mined: R.mines.filter((q) => q.amount < q.max).length,
      };
    });
    check(
      mine.d0 >= 200 && mine.d0 <= 900,
      `採礦 40 秒：礦石 +${Math.round(mine.d0)}（電腦 +${Math.round(mine.d1)}），${mine.mined} 座礦脈減少`,
    );
    await ev(() => window.__pump(0.5, null, 1 / 30));
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-mining.png') });
    // 建補給庫 → 人口上限
    const dep = await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      const w = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_worker');
      const p = g.rtsFindSpot('c_depot', { x: hq.pos.x - 18, z: hq.pos.z }, null, 26);
      const cap0 = R.teams[0].cap;
      g.rtsOrder([w], { k: 'build', def: 'c_depot', x: p.x, z: p.z, yaw: 0 });
      const placed = window.__sim(20, () => R.units.some((e) => e.rtsTeam === 0 && e.rtsDef === 'c_depot'));
      const b = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_depot');
      window.__sim(8);
      window.__dep = b;
      return { placed, mid: b ? b.bld.progress : 0, cap0 };
    });
    check(dep.placed >= 0, `工人走到工地放下補給庫（${dep.placed.toFixed(1)} 秒）`);
    check(dep.mid > 0.1 && dep.mid < 1, `建造中（進度 ${(dep.mid * 100).toFixed(0)}%）`);
    await ev(() => {
      const g = window.__game,
        b = window.__dep;
      if (g.rtsCamJump) g.rtsCamJump(b.pos.x, b.pos.z);
      if (g.rts.cam) g.rts.cam.dist = 60;
      window.__pump(0.3, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-build.png') });
    const dep2 = await ev(() => {
      const R = window.__game.rts,
        b = window.__dep;
      const t = window.__sim(40, () => b.bld.progress >= 1);
      window.__sim(0.5);
      return { t, cap: R.teams[0].cap, hp: b.hp, max: b.maxHp };
    });
    check(
      dep2.t >= 0 && dep2.cap === dep.cap0 + 10,
      `補給庫完成（再 ${dep2.t.toFixed(1)} 秒）：人口上限 ${dep.cap0} → ${dep2.cap}`,
    );
    check(dep2.hp >= dep2.max * 0.98, `建好時血量補滿（${Math.round(dep2.hp)}/${dep2.max}）`);
    // 兵工廠（兩個工人一起蓋）→ 生產 MT → 集結點
    const fac = await ev(() => {
      const g = window.__game,
        R = g.rts;
      R.teams[0].ore += 2000;
      R.teams[0].coral += 400;
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      const ws = R.units.filter((e) => e.rtsTeam === 0 && e.rtsDef === 'c_worker' && !e.dead);
      const p = g.rtsFindSpot('c_factory', { x: hq.pos.x, z: hq.pos.z - 22 }, null, 30);
      g.rtsOrder([ws[0]], { k: 'build', def: 'c_factory', x: p.x, z: p.z, yaw: 0 });
      window.__sim(20, () => R.units.some((e) => e.rtsTeam === 0 && e.rtsDef === 'c_factory'));
      const f = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_factory');
      if (!f) return { ok: false };
      g.rtsSmart([ws[1]], f.pos.x, f.pos.z, f); // 右鍵工地＝續建
      const t = window.__sim(70, () => f.bld.progress >= 1);
      const q = [g.rtsQueue(f, 'c_mt'), g.rtsQueue(f, 'c_mt')];
      // 集結點：兵工廠往主堡方向 14 m 的可以走的地方
      const nav = g.world.nav;
      const L = Math.hypot(hq.pos.x - f.pos.x, hq.pos.z - f.pos.z) || 1;
      const rc = nav.center(
        nav.nearestCell(
          f.pos.x + ((hq.pos.x - f.pos.x) / L) * 14 + 8,
          f.pos.z + ((hq.pos.z - f.pos.z) / L) * 14,
          1,
          -1,
          10,
        ),
      );
      const rx = rc.x,
        rz = rc.z;
      g.rtsSmart([f], rx, rz, null); // 集結點
      const mt0 = R.units.filter((e) => e.rtsTeam === 0 && e.rtsDef === 'c_mt').length;
      const t2 = window.__sim(
        60,
        () => R.units.filter((e) => e.rtsTeam === 0 && e.rtsDef === 'c_mt').length >= mt0 + 2,
      );
      const mts = R.units.filter((e) => e.rtsTeam === 0 && e.rtsDef === 'c_mt');
      window.__sim(30, () => mts.every((e) => !e.orders.length));
      return {
        ok: true,
        t,
        q,
        t2,
        mts: mts.length,
        rally: mts.length ? Math.round(Math.hypot(mts[0].pos.x - rx, mts[0].pos.z - rz)) : -1,
        pop: R.teams[0].pop,
      };
    });
    check(
      fac.ok && fac.t >= 0 && fac.t < 50,
      `兵工廠蓋好（兩個工人 ${fac.ok ? fac.t.toFixed(1) : '—'} 秒，一個人要 55 秒）`,
    );
    check(
      fac.ok && fac.q[0] && fac.q[1] && fac.t2 >= 0 && fac.mts >= 2,
      `生產 MT ×2（${fac.t2 >= 0 ? fac.t2.toFixed(1) + ' 秒' : '逾時'}），人口 ${fac.pop}`,
    );
    check(fac.rally >= 0 && fac.rally < 8, `生產的 MT 走到集結點（離集結點 ${fac.rally} m）`);
    // 移動指令：起點與終點在主堡的兩側（直線穿過主堡），要繞過去
    const mv = await ev(() => {
      const g = window.__game,
        R = g.rts,
        nav = g.world.nav;
      const hq = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_hq');
      const u = R.units.find((e) => e.rtsTeam === 0 && e.rtsDef === 'c_mt');
      const pick = (a) => {
        for (let r = 13; r < 24; r++) {
          const x = hq.pos.x + Math.cos(a) * r,
            z = hq.pos.z + Math.sin(a) * r;
          if (nav.walkableAt(x, z, 1)) return { x, z };
        }
        return null;
      };
      let A = null,
        B = null;
      for (let a = 0; a < 6.28 && !(A && B); a += 0.3) {
        A = pick(a);
        B = pick(a + Math.PI);
      }
      if (!A || !B) return { ok: false };
      u.pos.set(A.x, g.world.terrainHeight(A.x, A.z), A.z);
      u.mesh.position.copy(u.pos);
      g.rtsOrder([u], { k: 'move', x: B.x, z: B.z });
      let inside = 0,
        L = 0,
        px = u.pos.x,
        pz = u.pos.z;
      const hw = hq.bld.w / 2,
        hd = hq.bld.d / 2;
      const t = window.__sim(40, () => {
        if (Math.abs(u.pos.x - hq.pos.x) < hw - 0.3 && Math.abs(u.pos.z - hq.pos.z) < hd - 0.3) inside++;
        L += Math.hypot(u.pos.x - px, u.pos.z - pz);
        px = u.pos.x;
        pz = u.pos.z;
        return !u.orders.length;
      });
      return {
        ok: true,
        t,
        d: Math.hypot(u.pos.x - B.x, u.pos.z - B.z),
        straight: Math.hypot(A.x - B.x, A.z - B.z),
        L,
        inside,
      };
    });
    check(
      mv.ok && mv.t >= 0 && mv.d < 3 && mv.inside === 0 && mv.L > mv.straight * 1.05,
      `移動指令繞過主堡（直線 ${(mv.straight || 0).toFixed(0)} m、實際走 ${(mv.L || 0).toFixed(0)} m、離終點 ${(mv.d || 0).toFixed(1)} m、${mv.t >= 0 ? mv.t.toFixed(1) + ' 秒' : '逾時'}）`,
    );
    // 攻擊移動：6 台 MT 對 3 台電腦的 MT（地圖中央）
    const fight = await ev(() => {
      const g = window.__game,
        nav = g.world.nav;
      const spot = (x, z) => {
        const c = nav.nearestCell(x, z, 1, -1, 20);
        return c >= 0 ? nav.center(c) : { x, z };
      };
      const A = spot(0, 0);
      const mine = [],
        foes = [];
      for (let i = 0; i < 6; i++) {
        const p = spot(A.x + 40 + (i % 3) * 3, A.z + Math.floor(i / 3) * 3);
        mine.push(g.rtsSpawn(0, 'c_mt', p.x, p.z, 0));
      }
      for (let i = 0; i < 3; i++) {
        const p = spot(A.x - 30 + i * 3, A.z);
        foes.push(g.rtsSpawn(1, 'c_mt', p.x, p.z, 0));
      }
      g.rtsOrder(mine, { k: 'amove', x: A.x - 40, z: A.z });
      window.__fight = { mine, foes };
      window.__sim(6);
      return { hit: foes.some((e) => e.hp < e.maxHp || e.dead) };
    });
    check(fight.hit, '攻擊移動：遇到敵人就交戰（敵方 MT 受傷）');
    await ev(() => {
      const g = window.__game,
        F = window.__fight;
      const f = F.foes.find((e) => !e.dead) || F.mine[0];
      if (g.rtsCamJump) g.rtsCamJump(f.pos.x + 10, f.pos.z);
      if (g.rts.cam) g.rts.cam.dist = 55;
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, true);
      window.__pump(0.5, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-battle.png') });
    const fight2 = await ev(() => {
      const g = window.__game,
        F = window.__fight;
      if (g.rtsFogRevealAll) g.rtsFogRevealAll(0, false);
      const t = window.__sim(60, () => F.foes.every((e) => e.dead));
      return {
        t,
        alive: F.mine.filter((e) => !e.dead).length,
        dead: F.foes.filter((e) => e.dead).length,
        killed: g.rts.stats[0].killed,
      };
    });
    check(
      fight2.t >= 0 && fight2.dead === 3,
      `敵方 3 台全滅（${fight2.t >= 0 ? fight2.t.toFixed(1) + ' 秒' : '逾時'}），我方剩 ${fight2.alive}/6、擊破 ${fight2.killed}`,
    );
    // 效能：每邊 60 台互相攻擊移動（共 120 台）時，指令與索敵＋推擠與空間索引的耗時
    const perf = await ev(() => {
      const g = window.__game,
        R = g.rts,
        nav = g.world.nav;
      const spot = (x, z) => {
        const c = nav.nearestCell(x, z, 1, -1, 20);
        return c >= 0 ? nav.center(c) : { x, z };
      };
      const add = [[], []];
      for (let t = 0; t < 2; t++)
        for (let i = 0; i < 60; i++) {
          const p = spot((t ? -1 : 1) * (45 + (i % 10) * 3), (Math.floor(i / 10) - 3) * 3);
          add[t].push(g.rtsSpawn(t, 'c_mt', p.x, p.z, 0));
        }
      g.rtsOrder(add[0], { k: 'amove', x: -60, z: 0 });
      g.rtsOrder(add[1], { k: 'amove', x: 60, z: 0 });
      const n = R.units.filter((e) => !e.dead && !e.bld).length;
      let lg = 0,
        f = 0;
      for (let i = 0; i < 150; i++) {
        g.rtsSim(1 / 30);
        if (i >= 30) {
          lg += R.logicMs;
          f++;
        }
      }
      const out = {
        n,
        logic: lg / f,
        sep: R.perf.sep,
        ai: R.perf.ai,
        paths: R.pathN || 0,
        hits: add[0].concat(add[1]).filter((e) => e.hp < e.maxHp || e.dead).length,
      };
      for (const e of [...add[0], ...add[1]])
        if (!e.dead) {
          e.rtsQuiet = true; // 收掉（不演出、不算損失）
          e.die(null);
        }
      window.__sim(0.2);
      return out;
    });
    check(
      perf.logic + perf.sep < 5,
      `${perf.n} 台單位：指令與索敵 ${perf.logic.toFixed(2)} ms＋推擠與空間索引 ${perf.sep.toFixed(2)} ms／格（< 5 ms；含移動與動作的整個單位更新 ${perf.ai.toFixed(1)} ms），尋路 ${perf.paths} 條，交火 ${perf.hits} 台受傷`,
    );
    // 勝利：16 台 MT 拆光電腦的建築 → 結果畫面
    const win = await ev(() => {
      const g = window.__game,
        R = g.rts,
        nav = g.world.nav;
      const hq = R.units.find((e) => e.rtsTeam === 1 && e.rtsDef === 'c_hq');
      const army = [];
      for (let i = 0; i < 16; i++) {
        const c = nav.nearestCell(hq.pos.x + 22 + (i % 4) * 3, hq.pos.z + Math.floor(i / 4) * 3, 1, -1, 20);
        const p = nav.center(c);
        army.push(g.rtsSpawn(0, 'c_mt', p.x, p.z, 0));
      }
      g.rtsOrder(army, { k: 'attack', id: hq.id });
      if (g.rtsCamJump) g.rtsCamJump(hq.pos.x, hq.pos.z);
      if (g.rts.cam) g.rts.cam.dist = 80;
      const t = window.__sim(150, () => !!R.over);
      return { t, over: R.over, blds: R.units.filter((e) => e.rtsTeam === 1 && e.bld && !e.dead).length };
    });
    check(
      win.t >= 0 && win.over && win.over.win,
      `拆光電腦的建築 → 勝利（${win.t >= 0 ? win.t.toFixed(1) + ' 秒' : '逾時'}，電腦剩 ${win.blds} 座建築）`,
    );
    const res = await ev(() => {
      window.__pump(4, () => window.__game.state === 'rtsend', 1 / 20);
      const el = document.getElementById('rtsEnd');
      return {
        state: window.__game.state,
        on: el.classList.contains('on'),
        txt: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      };
    });
    check(res.state === 'rtsend' && res.on && res.txt.includes('勝利'), `結果畫面（${res.txt}…）`);
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-win.png') });
    check(save0 === (await saves()), '局內沒有改動存檔');
    await page.click('#rtsEndMenu');
    await page.waitForTimeout(200);
    const back = await ev(() => ({
      state: window.__game.state,
      rts: !!window.__game.rts,
      rec: localStorage.getItem('rubicon_rts_rec'),
    }));
    check(
      back.state === 'rtsmenu' && !back.rts && /"w":1/.test(back.rec || ''),
      `回 Coral 戰爭選單（戰績 ${back.rec}）`,
    );
    await ctx.close();
  }

  // ---------- 大量單位的渲染（render/rts-merge.js、world/rts-props.js 的合併） ----------
  // 單位整台一個網格＋描邊外殼、骨頭群組延後更新、受擊閃光、拆開再合併；地圖物件靜態合併後迷霧照樣隱藏；
  // 拉近與拉遠的截圖（test-results/rts-lod-*.png）
  async function testRtsLod(browser, base) {
    console.log('Coral 戰爭：大量單位的渲染（單一材質、骨頭群組、地圖物件合併）');
    const { ctx, page } = await newPage(browser, 'rtsLod');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    const r = await ev(() => {
      const g = window.__game;
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      const hq = R.units.find((e) => e.bld && e.rtsTeam === 0);
      const defs = ['c_mt', 'c_shield', 'c_worker'];
      const L = [];
      for (let i = 0; i < 36; i++) {
        const t = i % 2;
        const x = hq.pos.x + 18 + (i % 6) * 4 + (t ? 30 : 0),
          z = hq.pos.z - 12 + Math.floor(i / 12) * 5 + (Math.floor(i / 6) % 2) * 2.5;
        L.push(g.rtsSpawn(t, defs[i % 3], x, z, t ? Math.PI / 2 : -Math.PI / 2));
      }
      window.__L = L;
      window.__pump(1);
      const meshes = (e) => {
        let n = 0;
        e.mesh.traverse((o) => {
          if (o.isMesh && o.visible && o.layers.mask) n++; // layers 清空的＝合併進骨架、不畫
        });
        return n;
      };
      const ms = L.map(meshes);
      const lazy = L.filter((e) => e.mesh.rtsHolder && !e.mesh.rtsHolder.visible).length;
      // 受擊閃光：單一材質的自發光
      const e = L[0];
      const mat = e.mesh.children.find((c) => c.material && c.material.isRtsUnitMat).material;
      e.takeDamage(1, 1, L[1], e.center(), new THREE.Vector3(1, 0, 0));
      const flash = mat.emissive.getHex();
      window.__pump(0.5);
      const unflash = mat.emissive.getHex();
      // 拆開（丟武器、碎裂之前）再合併
      e.model.unmerge();
      const un = meshes(e),
        holderVis = e.mesh.rtsHolder.visible;
      e.model.remerge();
      const re = meshes(e);
      // 骨頭跟著動作：手的世界座標和骨頭矩陣一致
      window.__pump(0.2);
      return {
        avg: ms.reduce((a, b) => a + b, 0) / ms.length,
        max: Math.max(...ms),
        min: Math.min(...ms),
        n: L.length,
        lazy,
        merged: L.filter((u) => u.model.rtsMerged).length,
        flash,
        unflash,
        un,
        holderVis,
        re,
        hq: [hq.pos.x, hq.pos.z],
      };
    });
    check(
      r.max <= 7 && r.avg <= 3.5 && r.merged === r.n,
      `單位整台一個網格＋描邊外殼（${r.n} 台，每台 ${r.min}～${r.max} 個網格、平均 ${r.avg.toFixed(1)}；盾牌 MT 的發光縫另外畫）`,
    );
    check(r.lazy === r.n, `骨頭群組不顯示、延後更新（${r.lazy}／${r.n}）`);
    check(r.flash !== 0 && r.unflash === 0, `受擊閃光（${r.flash.toString(16)} → ${r.unflash}）`);
    check(r.un > 5 && r.holderVis && r.re <= 2, `拆開還原 ${r.un} 個網格、再合併 ${r.re} 個`);
    // 截圖：拉近（60 m）與拉遠（120 m）
    const shot = async (name, x, z, dist) => {
      await ev(
        ([x, z, dist]) => {
          const g = window.__game;
          g.rtsCamJump(x, z);
          g.rts.cam.dist = dist;
          window.__pump(0.25);
        },
        [x, z, dist],
      );
      await page.screenshot({ path: path.join(SHOT_DIR, `rts-lod-${name}.png`) });
    };
    await shot('near', r.hq[0] + 32, r.hq[1] - 6, 60);
    await shot('far', r.hq[0] + 32, r.hq[1] - 6, 120);
    // 骨頭的世界矩陣跟著單位：移動後手的位置（getWorldPosition）在骨架算出來的網格範圍內
    const mv = await ev(() => {
      const g = window.__game;
      const e = window.__L[2];
      g.rtsOrder([e], { k: 'move', x: e.pos.x + 12, z: e.pos.z });
      window.__pump(2);
      const sk = e.mesh.children.find((c) => c.isSkinnedMesh).skeleton;
      const b = sk.bones[sk.bones.length - 1];
      const p = new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
      return { d: p.distanceTo(e.pos), moved: e.pos.x };
    });
    check(mv.d < 8, `移動後骨頭跟著單位（最後一根骨頭離單位 ${mv.d.toFixed(1)} m）`);
    // 地圖物件：合併成少數網格；未探索處的物件由著色器丟掉（探索貼圖），全部揭露後顯示
    const pr = await ev(() => {
      const g = window.__game;
      const w = g.world;
      let merged = 0,
        left = 0;
      g.scene.traverse((o) => {
        if (o.userData && o.userData.rtsProps) merged++;
      });
      for (const o of w.obstacles) if (o.group) o.group.traverse((x) => x.isMesh && left++);
      const F = g.rts.fog;
      // 離主堡最遠的物件
      const hq = g.rts.units.find((e) => e.bld && e.rtsTeam === 0);
      let far = null,
        fd = 0;
      for (const o of w.obstacles) {
        const d = Math.hypot(o.x - hq.pos.x, o.z - hq.pos.z);
        if (d > fd) ((fd = d), (far = o));
      }
      const cell = g.rtsFogCell(F, far.x, far.z);
      return { merged, left, far: [far.x, far.z], before: F.expData[cell * 4], cell };
    });
    check(
      pr.merged > 0 && pr.merged <= 16,
      `地圖物件靜態合併成 ${pr.merged} 個網格（留在群組裡 ${pr.left} 個）`,
    );
    await shot('fog-before', pr.far[0], pr.far[1], 70);
    const after = await ev((cell) => {
      const g = window.__game;
      g.rtsFogRevealAll(0, true);
      window.__pump(0.6);
      return g.rts.fog.expData[cell * 4];
    }, pr.cell);
    await shot('fog-after', pr.far[0], pr.far[1], 70);
    check(
      pr.before === 0 && after === 255,
      `未探索的物件隱藏、揭露後顯示（探索貼圖 ${pr.before} → ${after}）`,
    );
    await ctx.close();
  }

  // ---------- 電腦對手（game/rts-ai.js） ----------
  // 普通難度、玩家不動：電腦會蓋補給庫與兵工廠、生產部隊；開局不知道玩家主堡（受迷霧限制），派偵查找到之後才進攻；
  // 7 分鐘內打到玩家基地；決策耗時。之後兩邊都是電腦（cfg.aiBoth）快轉一整場：25 分鐘內分出勝負。
  // 只推進模擬（rtsSim＋rtsFogTick，不算繪）；截圖前才用 __pump 算繪幾格
  async function testRtsAi(browser, base) {
    console.log('Coral 戰爭：電腦對手（經濟、建造順序、偵查、進攻、兩邊都是電腦）');
    const { ctx, page } = await newPage(browser, 'rtsAi');
    await page.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page);
    await page.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    const st = await ev(() => {
      const g = window.__game;
      // 尋路服務不依實際耗時截斷（同一個種子每次的結果相同；以前平行跑時偶爾 25 分鐘還沒分出勝負）
      g.rtsPathMs = Infinity;
      window.__reseed(7);
      g.rtsStart({
        theme: 'wasteland',
        seed: 7,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
      });
      const R = g.rts;
      // 只推進模擬：rtsSim＋迷霧（rtsTick 裡呼叫的那一份），sec 秒或 until() 成立；逾時回傳 -1
      window.__sim = (sec, until, dt = 1 / 15) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          g.rtsFogTick(dt);
          if (g.rts.over) break;
        }
        return until && !until() ? -1 : t;
      };
      const A = R.ai && R.ai.find((a) => a.team === 1);
      const hq0 = R.units.find((e) => e.rtsTeam === 0 && e.bld);
      window.__hq0 = hq0;
      return {
        ais: (R.ai || []).map((a) => a.team).join(),
        diff: A && A.diff,
        op: A && A.op.name,
        known: g.rtsFogKnown(1).length,
        see: g.rtsVisible(1, hq0),
        rally: A && A.rally,
      };
    });
    check(
      st.ais === '1' && st.diff === 'normal',
      `電腦對手啟動（隊伍 ${st.ais}、難度 ${st.diff}、開局「${st.op}」）`,
    );
    check(
      !st.see && st.known === 0,
      `開局：電腦看不到玩家的主堡、記得的敵方建築 ${st.known} 座（受迷霧限制）`,
    );
    // 快轉到電腦打到玩家基地（最多 7 分鐘）：記下各里程碑的時間
    const run = await ev(() => {
      const g = window.__game,
        R = g.rts,
        hq0 = window.__hq0;
      const A = R.ai.find((a) => a.team === 1);
      const M = {};
      const mark = (k, ok) => {
        if (M[k] === undefined && ok) M[k] = Math.round(R.t);
      };
      const own = (def, done) =>
        R.units.some((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === def && (!done || e.bld.progress >= 1));
      let msMax = 0;
      const t = window.__sim(420, () => {
        mark('depot', own('c_depot', true));
        mark('factory', own('c_factory', true));
        mark('unit', own('c_mt') || own('c_shield'));
        mark('ext', own('c_extractor', true));
        mark('scout', A.scout);
        mark(
          'found',
          g.rtsFogKnown(1).some((k) => k.id === hq0.id),
        );
        mark('attack', A.firstAtk !== null);
        msMax = Math.max(msMax, A.msMax);
        // 打到了：電腦的部隊在玩家主堡 40 m 內，或玩家的建築受傷
        const near = R.units.some(
          (e) =>
            !e.dead &&
            e.rtsTeam === 1 &&
            !e.bld &&
            (e.rtsDef === 'c_mt' || e.rtsDef === 'c_shield') &&
            Math.hypot(e.pos.x - hq0.pos.x, e.pos.z - hq0.pos.z) < 40,
        );
        const hurt = R.units.some((e) => !e.dead && e.rtsTeam === 0 && e.bld && e.hp < e.maxHp - 1);
        mark('arrive', near || hurt);
        return M.arrive !== undefined;
      });
      const army = R.units.filter(
        (e) => !e.dead && e.rtsTeam === 1 && (e.rtsDef === 'c_mt' || e.rtsDef === 'c_shield'),
      );
      return {
        t,
        M,
        army: army.length,
        workers: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.rtsDef === 'c_worker').length,
        blds: R.units.filter((e) => !e.dead && e.rtsTeam === 1 && e.bld).map((e) => e.rtsDef.slice(2)),
        ms: A.ms,
        msMax: A.msMax,
        n: A.n,
        log: A.log.slice(0, 12),
        known: g.rtsFogKnown(1).length,
      };
    });
    const M = run.M;
    console.log('  電腦的紀錄：' + run.log.join('｜'));
    check(
      M.depot !== undefined && M.factory !== undefined,
      `電腦蓋了補給庫（${M.depot} 秒）與兵工廠（${M.factory} 秒），建築：${run.blds.join('、')}`,
    );
    check(
      M.unit !== undefined && run.army + (M.arrive !== undefined ? 1 : 0) >= 3,
      `電腦生產部隊（第一台 ${M.unit} 秒，現在 ${run.army} 台、工人 ${run.workers}）`,
    );
    check(
      M.scout !== undefined &&
        M.found !== undefined &&
        M.found > M.scout &&
        (M.attack === undefined || M.found <= M.attack),
      `電腦派偵查（${M.scout} 秒）後才知道玩家主堡的位置（${M.found} 秒），進攻在那之後（${M.attack} 秒）`,
    );
    check(
      M.attack !== undefined && M.attack >= 180 && M.arrive !== undefined && M.arrive <= 420,
      `普通難度第一次進攻 ${M.attack} 秒、${M.arrive} 秒打到玩家基地（7 分鐘內）`,
    );
    check(
      run.ms < 1 && run.msMax < 8,
      `決策 ${run.n} 次：平均 ${run.ms.toFixed(3)} ms、最長 ${run.msMax.toFixed(2)} ms（不含 rtsOrder 的流場）`,
    );
    // 截圖：電腦的部隊打進玩家基地（玩家的視野）、電腦的基地（暫時揭露）
    await ev(() => {
      const g = window.__game,
        hq0 = window.__hq0;
      window.__sim(6);
      const R = g.rts;
      const foes = R.units.filter((e) => !e.dead && e.rtsTeam === 1 && !e.bld && e.rtsDef !== 'c_worker');
      let x = hq0.pos.x,
        z = hq0.pos.z;
      const near = foes.filter((e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 60);
      if (near.length) {
        x = near.reduce((s, e) => s + e.pos.x, 0) / near.length;
        z = near.reduce((s, e) => s + e.pos.z, 0) / near.length;
      }
      g.rtsCamJump(x, z);
      R.cam.dist = 70;
      window.__pump(0.4, null, 1 / 30);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-ai-attack.png') });
    await ev(() => {
      const g = window.__game,
        R = g.rts;
      const hq1 = R.units.find((e) => !e.dead && e.rtsTeam === 1 && e.bld && e.rtsDef === 'c_hq');
      g.rtsFogRevealAll(0, true);
      if (hq1) g.rtsCamJump(hq1.pos.x, hq1.pos.z);
      R.cam.dist = 95;
      window.__pump(0.4, null, 1 / 30);
      g.rtsFogRevealAll(0, false);
    });
    await page.screenshot({ path: path.join(SHOT_DIR, 'rts-ai-base.png') });
    await ctx.close();

    // 兩邊都是電腦：快轉一整場（25 分鐘內分出勝負）。開新的頁面，種子固定時每次的結果相同（上面那一局的截圖推進過
    // 主迴圈，留下的實體編號、粒子等狀態和這一局無關）
    const { ctx: ctx2, page: page2 } = await newPage(browser, 'rtsAi2');
    await page2.setViewportSize({ width: 1600, height: 900 });
    await H.seededRandom(page2);
    await page2.goto(base + (base.includes('?') ? '&' : '?') + 'test');
    await page2.waitForFunction(() => window.__game && window.__game.renderer);
    await freezeLoop(page2);
    const ev2 = (fn, a) => page2.evaluate(fn, a);
    const both = await ev2(() => {
      const g = window.__game;
      g.rtsPathMs = Infinity;
      window.__reseed(8);
      g.rtsStart({
        theme: 'wasteland',
        seed: 8,
        size: 400,
        faction: 'castron',
        aiFaction: 'castron',
        diff: 'normal',
        aiBoth: true,
      });
      const R = g.rts;
      window.__sim = (sec, until, dt = 1 / 15) => {
        let t = 0;
        for (; t < sec; t += dt) {
          if (until && until()) return t;
          g.rtsSim(dt);
          g.fx.update(dt); // 粒子照常到期（同 rtsTick；不然越積越多，畫面外粒子的省略與取用的亂數都和遊戲不同）
          g.rtsFogTick(dt);
          if (g.rts.over) break;
        }
        return until && !until() ? -1 : t;
      };
      window.__sim(600); // 前 10 分鐘（截圖用中盤的戰況）
      return {
        ais: R.ai.map((a) => a.team + ':' + a.op.name).join('、'),
        t: R.t,
        over: R.over,
        rec: localStorage.getItem('rubicon_rts_rec'),
      };
    });
    check(both.ais.split('、').length === 2, `兩邊都是電腦（${both.ais}）`);
    // 中盤截圖：看整個戰場（兩邊的視野都打開）
    await ev2(() => {
      const g = window.__game,
        R = g.rts;
      g.rtsFogRevealAll(0, true);
      const army = R.units.filter((e) => !e.dead && !e.bld && e.rtsDef !== 'c_worker');
      const c = army.length
        ? {
            x: army.reduce((s, e) => s + e.pos.x, 0) / army.length,
            z: army.reduce((s, e) => s + e.pos.z, 0) / army.length,
          }
        : { x: 0, z: 0 };
      g.rtsCamJump(c.x, c.z);
      R.cam.dist = 160;
      // 只更新迷霧、鏡頭與算繪，模擬停住，dt 固定（__pump 的 dt 含實際經過的一點時間，迷霧的更新時機會跟著偏移；
      // 算繪時粒子依實際時間取用亂數，和 AI 交錯的話之後的結果每次不同）
      for (let i = 0; i < 9; i++) {
        g.rtsFogTick(1 / 30);
        g.rtsCamUpdate(1 / 30);
        g.renderMain();
      }
    });
    await page2.screenshot({ path: path.join(SHOT_DIR, 'rts-ai-both.png') });
    const end = await ev2(() => {
      const g = window.__game,
        R = g.rts;
      g.rtsFogRevealAll(0, false);
      // 截圖時的算繪會產生粒子、取用亂數：清掉粒子並重設種子
      g.fx.clear();
      window.__reseed(81);
      window.__sim(1500 - R.t + 0.1, () => !!R.over);
      const S = R.stats;
      return {
        over: R.over,
        t: R.t,
        made: S.map((s) => s.made),
        lost: S.map((s) => s.lost),
        logs: R.ai.map((a) => a.log.filter((l) => /進攻|開分礦|撤退/.test(l)).length),
        ms: R.ai.map((a) => a.ms.toFixed(3) + '/' + a.msMax.toFixed(2)),
        rec: localStorage.getItem('rubicon_rts_rec'),
      };
    });
    const fmt = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    check(
      !!end.over && end.over.t <= 1500,
      `電腦對電腦：${end.over ? fmt(end.over.t) + ' 分出勝負，' + (end.over.win ? '隊伍 0' : '隊伍 1') + ' 獲勝' : '25 分鐘還沒結束'}（生產 ${end.made.join('／')}、損失 ${end.lost.join('／')}、決策 ${end.ms.join('／')} ms）`,
    );
    check(end.rec === both.rec, '兩邊都是電腦的局不記戰績');
    await ev2(() => window.__pump(3, () => window.__game.state === 'rtsend', 1 / 20));
    await page2.screenshot({ path: path.join(SHOT_DIR, 'rts-ai-both-end.png') });
    await ctx2.close();
  }

  return { testRtsInput, testRtsFog, testRtsCore, testRtsLod, testRtsAi };
};
