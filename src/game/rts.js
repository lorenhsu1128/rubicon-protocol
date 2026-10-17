// Coral 戰爭（RTS，docs/rts-design.md）的核心（mixin）：選單畫面 'rtsmenu'、開局 rtsStart、局內狀態 this.rts、
// 主迴圈 rtsTick（state 'rts'：game.js 的 loop 在 this.rts 存在時改呼叫它）、資源與維持費、人口、生產佇列、建造、
// 修理、勝敗與結果畫面 'rtsend'。
// - 單位與建築都是 MechEntity（建築＝不移動、ai 'bld'、模型由 opts.buildModel 給）：放進既有的 enemies／allies 清單，
//   所以投射物、命中、爆炸、鎖定照舊；e.isPlayer 一律 false（玩家沒有自己的機甲，this.player 是 null）。
//   每個實體的 takeDamage／die 換成 RTS 版（記下攻擊者給回擊；死亡不經過 onEnemyKilled／onPlayerDead，局內不寫存檔）。
// - 建築在 world.obstacles 登記碰撞方塊、world.nav.block 佔用導航格（拆掉時解除），命中用外形（e.shape，prop-hit.js）。
// - 單位行為在 entities/mech-rts.js（updateAI 開頭攔截），指令發佈在 game/rts-orders.js；鏡頭、選取、HUD 在
//   rts-input.js／rts-hud.js（rtsCamUpdate），戰爭迷霧在 rts-fog.js（rtsFogTick），電腦對手在 rts-ai.js（rtsAiTick）。
// - 敵人 AI 導演、感知、增援波次、據點、過關條件卡片在 RTS 都不啟動（rtsTick 不呼叫它們）。
// - 冒煙測試：rtsSim(dt) 只推進模擬（不算繪），rtsPerf 記錄每格的耗時。
// - R4（docs 15.2）：維爾威的空投、投放艙、機動建築、集貨站、交易、搭乘在 rts-veer.js（rtsVeerTick 每格）；這裡的呼叫點：
//   rtsTrained 的投放艙、rtsBuildings 的收起中建築、rtsDmgK 的 rtsVeerTakenK、rtsSplash 的低空、rtsOnDeath 的 rtsVeerOnDeath。
import { SFX } from '../audio/audio.js';
import { clamp, makeRng } from '../core/math.js';
import { escHtml } from '../core/html.js';
import { SpatialHash } from '../core/spatial.js';
import {
  RTS_BUILD_ASSIST,
  RTS_DEFS,
  RTS_DIFFS,
  RTS_FACTIONS,
  RTS_GATHER,
  RTS_HERO_COST,
  RTS_HERO_MAX,
  RTS_MILITIA,
  RTS_NEUTRAL,
  RTS_POP_MAX,
  RTS_QUEUE_MAX,
  RTS_REPAIR,
  RTS_START,
  bldSatisfies,
  reqOf,
  upkeepOf,
} from '../data/rts-units.js';
import {
  RTS_RESEARCH,
  armorK,
  attrAtk,
  atkAttr,
  emptyMods,
  mergeMods,
  researchMods,
  typeK,
} from '../data/rts-combat.js';
import { MechEntity } from '../entities/mech-entity.js';
import {
  CORAL_GLOW,
  addWorkerKit,
  buildCoralVent,
  buildMineNode,
  buildRtsBuilding,
  rtsPal,
  setMineAmount,
} from '../render/rts-models.js';
import { propShape, targetDist } from '../world/prop-hit.js';
import { RTS_THEMES, planRtsMap } from '../world/rts-map.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const ME = 0; // 玩家的隊伍
const PREF_KEY = 'rubicon_rts'; // 選單的設定
const REC_KEY = 'rubicon_rts_rec'; // 遭遇戰的戰績（R3：{ '<我方陣營>-<電腦陣營>-<難度>': { w, l } }；舊格式 { w, l }＝卡斯特隆對卡斯特隆）
const BLD_ASM = RTS_DEFS.c_worker.asm; // 建築的 MechEntity 只用來算數值（沒有武器）
const END_DELAY = 2.5; // 勝敗決定後幾秒顯示結果
const _q = [];
// 空中單位的高度層：定義的飛行高度（沒有時用目前的 hoverH）
const rtsLayer = (e) => {
  const D = RTS_DEFS[e.rtsDef];
  return (D && D.hoverH) || e.hoverH || 0;
};

const loadJson = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch (e) {
    return d;
  }
};
const saveJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
// 可以選的陣營（選單的「隨機」從這裡挑）
const availFacs = () => Object.keys(RTS_FACTIONS).filter((k) => RTS_FACTIONS[k].avail);
const facName = (f) => (RTS_FACTIONS[f] && RTS_FACTIONS[f].name) || f;
// 戰績（docs 14.7）：鍵＝我方陣營-電腦陣營-難度；舊的 { w, l } 當成卡斯特隆對卡斯特隆（普通難度）讀進來
function loadRec() {
  const r = loadJson(REC_KEY, {});
  if (typeof r.w === 'number' || typeof r.l === 'number') {
    const o = { 'castron-castron-normal': { w: r.w || 0, l: r.l || 0 } };
    saveJson(REC_KEY, o);
    return o;
  }
  return r && typeof r === 'object' ? r : {};
}
const recKey = (a, b, d) => `${a}-${b}-${d}`;

Object.assign(Game.prototype, {
  // ---------- 初始化（Game 的 constructor 呼叫）：標題按鈕、選單與結果畫面 ----------
  rtsInit() {
    const b = document.getElementById('btnRts');
    if (b) b.onclick = () => this.rtsMenuOpen();
  },

  // ---------- 選單 ----------
  rtsMenuOpen() {
    SFX.init();
    if (this.rts) this.clearMission();
    const P = (this.rtsPrefs = {
      faction: 'castron',
      aiFaction: 'castron',
      diff: 'normal',
      theme: 'wasteland',
      ...loadJson(PREF_KEY, {}),
    });
    const okFac = (f) => f === 'random' || (RTS_FACTIONS[f] && RTS_FACTIONS[f].avail);
    if (!okFac(P.faction)) P.faction = 'castron';
    if (!okFac(P.aiFaction)) P.aiFaction = 'castron';
    if (!RTS_THEMES[P.theme]) P.theme = 'wasteland';
    P.seed = Math.floor(Math.random() * 1e9);
    this.state = 'rtsmenu';
    this.showScreen('rtsMenu');
    this.rtsMenuRender();
    // 預覽要等畫面出來再算（建 World 要一點時間）
    setTimeout(() => this.state === 'rtsmenu' && this.rtsMenuPreview(), 30);
  },
  rtsMenuRender() {
    const el = document.getElementById('rtsMenu');
    if (!el) return;
    const P = this.rtsPrefs;
    const recs = loadRec();
    const rec = (P.faction !== 'random' &&
      P.aiFaction !== 'random' &&
      recs[recKey(P.faction, P.aiFaction, P.diff)]) || { w: 0, l: 0 };
    const recTxt =
      P.faction === 'random' || P.aiFaction === 'random'
        ? '戰績：隨機陣營（依實際的陣營記錄）'
        : `戰績（${facName(P.faction)} 對 ${facName(P.aiFaction)}・${(RTS_DIFFS.find((d) => d.id === P.diff) || {}).name || P.diff}）：${rec.w} 勝 ${rec.l} 敗`;
    const fac = (sel, id) =>
      Object.entries(RTS_FACTIONS)
        .map(
          ([k, F]) =>
            `<button type="button" class="rtsFac${k === sel ? ' on' : ''}" data-${id}="${k}"${F.avail ? '' : ' disabled'} title="${escHtml(F.style + '（' + F.leader + '）' + (F.avail ? '' : '：之後的分期'))}">${escHtml(F.name)}</button>`,
        )
        .join('') +
      `<button type="button" class="rtsFac rtsFacRand${sel === 'random' ? ' on' : ''}" data-${id}="random" title="從可以選的陣營隨機挑一個（依種子固定）">隨機</button>`;
    // 陣營的說明（3 行特色）
    const traits = (f) => {
      const F = RTS_FACTIONS[f];
      if (!F) return '<p class="dim rtsFacTraits">從可以選的陣營隨機挑一個（同一個種子結果相同）</p>';
      return `<ul class="dim rtsFacTraits">${(F.traits || [F.style]).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
    };
    el.innerHTML = `
      <div class="panel rtsMenuPanel">
        <h2>Coral 戰爭 <small>遭遇戰 — 1 對 1</small></h2>
        <div class="rtsMenuGrid">
          <div class="rtsMenuOpts">
            <h3>你的陣營</h3>
            <div class="rtsFacs" data-padtabs="[data-pf]">${fac(P.faction, 'pf')}</div>
            ${traits(P.faction)}
            <h3>電腦對手</h3>
            <div class="rtsFacs">${fac(P.aiFaction, 'af')}</div>
            <div class="row">
              <label>難度 <select id="rtsDiff">${RTS_DIFFS.map((d) => `<option value="${d.id}"${d.id === P.diff ? ' selected' : ''}>${escHtml(d.name)}</option>`).join('')}</select></label>
            </div>
            <h3>地圖</h3>
            <div class="row">
              <label>主題 <select id="rtsTheme">${Object.entries(RTS_THEMES)
                .map(
                  ([k, T]) =>
                    `<option value="${k}"${k === P.theme ? ' selected' : ''}>${escHtml(T.name)}</option>`,
                )
                .join('')}</select></label>
            </div>
            <div class="row">
              <label>種子 <input id="rtsSeed" value="${P.seed}" size="11" inputmode="numeric" /></label>
              <button type="button" id="rtsReroll" title="換一張地圖">重抽</button>
              <button type="button" id="rtsPrevBtn" title="依種子重新預覽">預覽</button>
            </div>
            <p class="dim rtsRec">${escHtml(recTxt)}</p>
          </div>
          <div class="rtsPrev">
            <img id="rtsPrevImg" alt="地圖預覽" />
            <div id="rtsPrevInfo" class="dim">產生地圖中…</div>
          </div>
        </div>
        <div class="row">
          <button type="button" class="primary" id="rtsGo">開始</button>
          <button type="button" id="rtsBack">回標題</button>
        </div>
        <p class="dim" style="font-size: 11px">
          左鍵選取、拖曳框選；右鍵移動／攻擊／採集；指令卡的快捷鍵 Q W E R／A S D F／Z X C V；Ctrl＋數字編隊；Esc 選單。
          局內不寫存檔（沒有 COAM 與經驗），只記勝敗。
        </p>
      </div>`;
    const $ = (id) => document.getElementById(id);
    for (const b of el.querySelectorAll('[data-pf]'))
      b.onclick = () => {
        P.faction = b.dataset.pf;
        this.rtsMenuSave();
        this.rtsMenuRender();
      };
    for (const b of el.querySelectorAll('[data-af]'))
      b.onclick = () => {
        P.aiFaction = b.dataset.af;
        this.rtsMenuSave();
        this.rtsMenuRender();
      };
    $('rtsDiff').onchange = (e) => {
      P.diff = e.target.value;
      this.rtsMenuSave();
      this.rtsMenuRender();
    };
    $('rtsTheme').onchange = (e) => {
      P.theme = e.target.value;
      this.rtsMenuSave();
      this.rtsMenuPreview();
    };
    $('rtsSeed').onchange = (e) => {
      P.seed = Math.abs(parseInt(e.target.value, 10) || 0) >>> 0;
      this.rtsMenuPreview();
    };
    $('rtsReroll').onclick = () => {
      P.seed = Math.floor(Math.random() * 1e9);
      $('rtsSeed').value = P.seed;
      this.rtsMenuPreview();
    };
    $('rtsPrevBtn').onclick = () => this.rtsMenuPreview();
    $('rtsGo').onclick = () => {
      P.seed = Math.abs(parseInt($('rtsSeed').value, 10) || 0) >>> 0;
      this.rtsStart({
        theme: P.theme,
        seed: P.seed,
        size: 400,
        faction: P.faction,
        aiFaction: P.aiFaction,
        diff: P.diff,
      });
    };
    $('rtsBack').onclick = () => {
      this.clearMission();
      this.state = 'title';
      this.showScreen('title');
    };
    if (this.rtsPrevUrl && this.rtsPrevKey === this.rtsKeyOf(P)) {
      $('rtsPrevImg').src = this.rtsPrevUrl;
      $('rtsPrevInfo').textContent = this.rtsPrevTxt || '';
    }
  },
  rtsMenuSave() {
    const P = this.rtsPrefs;
    saveJson(PREF_KEY, {
      ...loadJson(PREF_KEY, {}),
      faction: P.faction,
      aiFaction: P.aiFaction,
      diff: P.diff,
      theme: P.theme,
    });
  },
  rtsKeyOf(P) {
    return `${P.theme}|${P.seed >>> 0}|400`;
  },
  // 俯視縮圖（rts-preview.js 的 rtsMapPreview：建 World 並從正上方算繪）；建好的 World 留著，開始時沿用
  rtsMenuPreview() {
    const P = this.rtsPrefs;
    const info = document.getElementById('rtsPrevInfo');
    if (info) info.textContent = '產生地圖中…';
    setTimeout(() => {
      if (this.state !== 'rtsmenu') return;
      const key = this.rtsKeyOf(P);
      const r = this.rtsMapPreview(P.seed >>> 0, { theme: P.theme, size: 400 });
      this.rtsPreviewClear();
      this._rtsPrevW = this.world;
      this.rtsPrevKey = this._rtsPrevK = key;
      this.rtsPrevUrl = r.url;
      this.rtsPrevTxt = `${r.ok ? '' : '（檢查未通過）'}礦脈 ${r.mines}・Coral ${r.corals}・野怪營地 ${r.camps}・通道 ${r.lanes}`;
      const img = document.getElementById('rtsPrevImg');
      if (img) img.src = r.url;
      const inf = document.getElementById('rtsPrevInfo');
      if (inf) inf.textContent = this.rtsPrevTxt;
      // 背景：從斜上方看整張地圖
      const cam = this.camera;
      cam.position.set(0, 260, 300);
      cam.lookAt(0, 0, 0);
      cam.far = 1600;
      cam.updateProjectionMatrix();
    }, 20);
  },

  // ---------- 開局 ----------
  rtsStart(cfg) {
    SFX.init();
    const seed = cfg.seed >>> 0,
      theme = RTS_THEMES[cfg.theme] ? cfg.theme : 'wasteland',
      size = cfg.size || 400;
    const key = `${theme}|${seed}|${size}`;
    let w = this.world;
    if (!(w && w === this._rtsPrevW && this._rtsPrevK === key && w.rts)) {
      this.clearMission();
      if (this.rtsPreviewClear) this.rtsPreviewClear();
      const plan = planRtsMap(seed, { theme, size });
      w = this.world = new World(this.scene, plan.theme, seed, 1, null, { rts: plan });
    } else if (this.rtsPreviewClear) this.rtsPreviewClear();
    this._rtsPrevW = null;
    this._rtsPrevK = null;
    const plan = w.rts;
    w.applyLight(this);
    this.worldSeed = seed;
    this.worldTheme = plan.theme;
    this.missionT = 0;
    this.time = this.time || 0;
    this.isBossLevel = false;
    this.waves = [];
    this.wavePend = null;
    // 陣營（docs 14.7）：「隨機」以 makeRng(seed × 7 + 3) 決定（先玩家、再電腦；一律抽兩次，同一個種子同樣的結果）；
    // cfg.aiFactions＝[隊伍 0, 隊伍 1] 直接指定（測試、勝率腳本）
    const facs = availFacs();
    const frng = makeRng(seed * 7 + 3);
    const r0 = frng(),
      r1 = frng();
    const want = [cfg.faction || 'castron', cfg.aiFaction || 'castron'];
    if (cfg.aiFactions) for (const i of [0, 1]) if (cfg.aiFactions[i]) want[i] = cfg.aiFactions[i];
    const rand = [want[0] === 'random', want[1] === 'random'];
    const fac = want.map((f, i) =>
      f === 'random'
        ? facs[Math.min(facs.length - 1, Math.floor((i ? r1 : r0) * facs.length))]
        : RTS_FACTIONS[f] && RTS_FACTIONS[f].avail
          ? f
          : 'castron',
    );
    const R = (this.rts = {
      cfg: {
        theme,
        seed,
        size,
        faction: fac[0],
        aiFaction: fac[1],
        rand, // 哪一邊是「隨機」選的
        diff: cfg.diff || 'normal',
        aiBoth: !!cfg.aiBoth, // 測試／除錯：兩邊都是電腦（rts-ai.js）
        aiOpener: cfg.aiOpener || null,
        diffs: cfg.diffs || null, // 兩邊都是電腦時各自的難度 [隊伍 0, 隊伍 1]
      },
      t: 0,
      me: ME,
      teams: [0, 1].map((i) => ({
        id: i,
        team: i === ME ? 'player' : 'enemy',
        faction: fac[i],
        ore: RTS_START.ore,
        coral: RTS_START.coral,
        pop: 0,
        cap: 0,
        ai: i !== ME,
        alive: true,
        upk: 0,
        tech: { tier: 1, res: {}, busy: {} }, // 13.2：主堡層級、研究的級數、研究中的項目
        heroes: [], // 英雄紀錄（C 包，13.4）
        power: { srcs: [], temp: [], ver: 0, deps: null }, // 導管網（docs 14.2；rts-grid.js）
        bcn: [], // 臨時投放信標（維爾威，docs 15.2；rts-veer.js）
        tradeT: 0, // 物流交易的冷卻到這個局內時間
      })),
      units: [],
      byId: new Map(),
      mines: [],
      corals: [],
      resById: new Map(),
      hash: new SpatialHash(8),
      sel: [],
      groups: {},
      fog: null,
      over: null,
      overT: 0,
      pathQ: [],
      stats: [0, 1, 2].map(() => ({
        made: 0,
        lost: 0,
        killed: 0,
        ore: 0,
        coral: 0,
        blds: 0,
        fused: 0,
        offT: 0,
        drops: 0, // 維爾威（docs 15.7、15.9）：空投成功、被擊落、投放艙、收起、交易、空中單位人口的最大值
        dropLost: 0,
        pods: 0,
        packs: 0,
        trades: 0,
        airMax: 0,
      })),
      hostile: [[], [], []], // 每個隊伍的敵對實體（rtsSim 每格重建；game.js 的 hostilesOfEnt 用它）
      items: [], // 地上的道具（C 包）
      camps: [], // 野怪營地（D 包）
      neutrals: [], // 中立建築（D 包）
      pilot: null, // 親自駕駛（E 包，13.8）
      butler: { gather: true, loop: true, depot: true, defend: true, follow: false }, // 自動管家（E 包）
      modT: 0, // 數值層的 buff 到期檢查（每 0.5 秒）
      powT: 0, // 導管加成的檢查（每 0.5 秒，rts-grid.js）
      fuses: [], // 融合中的組（rts-grid.js）
      fuseN: 0,
      illus: [[], [], []], // 每隊的幻象（最舊的在前面）
      drops: [], // 空投（rts-veer.js）：{ id, team, def, x, z, yaw, st 'wait'|'fly'|'land'|'back', ship, cost, t0 }
      dropN: 0,
      pods: [], // 投放艙：{ id, team, def, x, z, t（落地的局內時間）, q, via, b, rally, pop }
      podN: 0,
      hauls: [], // 集貨站的物流無人機（到達時入帳）
      vtasks: [], // 延遲事件（緊急補給）
      veerT: 0,
      g: new THREE.Group(),
      perf: { ai: 0, sim: 0, n: 0 },
      endT: 0,
    });
    // 中立隊伍（13.6）：野怪、中立建築；不算進勝敗、人口、戰績
    R.teams[RTS_NEUTRAL] = {
      id: RTS_NEUTRAL,
      team: 'neutral',
      faction: 'neutral',
      neutral: true,
      ore: 0,
      coral: 0,
      pop: 0,
      cap: 0,
      ai: false,
      alive: true,
      upk: 0,
      tech: { tier: 1, res: {}, busy: {} },
      heroes: [],
      power: { srcs: [], temp: [], ver: 0, deps: null },
      bcn: [],
      tradeT: 0,
    };
    R.g.userData.helper = true;
    this.scene.add(R.g);
    // 資源點
    const th = (p) => w.terrainHeight(p.x, p.z);
    plan.mines.forEach((m, i) => {
      const mesh = buildMineNode();
      mesh.position.set(m.pos.x, th(m.pos) - 0.3, m.pos.z);
      mesh.rotation.y = i * 1.7;
      R.g.add(mesh);
      const rec = {
        id: 'm' + i,
        kind: 'mine',
        pos: { x: m.pos.x, y: th(m.pos), z: m.pos.z },
        amount: m.amount,
        max: m.amount,
        mesh,
        miners: new Set(),
        mk: m.kind,
      };
      R.mines.push(rec);
      R.resById.set(rec.id, rec);
      // 礦脈本身擋路（小圓柱＋導航格：工人從邊緣採）
      const mr = RTS_GATHER.mineR - 0.6;
      w.obstacles.push({
        kind: 'circle',
        x: m.pos.x,
        z: m.pos.z,
        r: mr,
        y: th(m.pos) - 1,
        top: th(m.pos) + 2.6,
        rtsRes: rec,
      });
      w.nav.block(m.pos.x, m.pos.z, mr * 1.5, mr * 1.5, 0, true);
    });
    plan.corals.forEach((c, i) => {
      const mesh = buildCoralVent();
      mesh.position.set(c.pos.x, th(c.pos) - 0.1, c.pos.z);
      mesh.rotation.y = i * 2.1;
      R.g.add(mesh);
      const rec = {
        id: 'c' + i,
        kind: 'coral',
        pos: { x: c.pos.x, y: th(c.pos), z: c.pos.z },
        amount: c.amount,
        max: c.amount,
        mesh,
        ext: null,
      };
      R.corals.push(rec);
      R.resById.set(rec.id, rec);
    });
    // 兩邊的主堡＋工人
    for (const T of R.teams) {
      if (T.neutral) continue;
      const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
      const base = plan.bases.find((b) => b.owner === T.id) || plan.bases[T.id];
      const main = R.mines.find(
        (m) => m.mk === 'main' && Math.hypot(m.pos.x - base.pos.x, m.pos.z - base.pos.z) < base.r + 20,
      );
      const spot = this.rtsFindSpot(F.hq, base.pos, main ? main.pos : null, base.r);
      const hq = this.rtsSpawnBld(T.id, F.hq, spot.x, spot.z, 0, 1);
      // 工人：主堡朝礦脈的一側排開，開局就去採礦
      const to = main ? main.pos : base.pos;
      const ang = Math.atan2(to.z - hq.pos.z, to.x - hq.pos.x);
      for (let i = 0; i < RTS_START.workers; i++) {
        const a = ang + (i - (RTS_START.workers - 1) / 2) * 0.35;
        const rr = RTS_DEFS[F.hq].foot[0] / 2 + 3;
        let x = hq.pos.x + Math.cos(a) * rr,
          z = hq.pos.z + Math.sin(a) * rr;
        const c = w.nav.nearestCell(x, z, 0, -1, 8);
        if (c >= 0) ({ x, z } = w.nav.center(c));
        const u = this.rtsSpawn(T.id, F.worker, x, z, -ang - Math.PI / 2);
        if (main) u.orders = [{ k: 'gather', mine: main.id }];
      }
      if (this.rtsPowerRebuild) this.rtsPowerRebuild(T.id);
    }
    this.rtsRecount();
    // 其他包的開局（還沒實作時略過）：中立（野怪營地、酒館、商店、傭兵營）、英雄
    if (this.rtsNeutralInit) this.rtsNeutralInit();
    if (this.rtsHeroInit) this.rtsHeroInit();
    this.rtsHostileRebuild();
    // 鏡頭、迷霧、輸入、HUD、電腦對手（各自的檔案；還沒有時略過）
    const cam = this.camera;
    cam.far = 1400;
    cam.updateProjectionMatrix();
    // 大量單位的渲染設定（render-setup.js：低特效、單位的假影子、AI 分批）
    if (this.setRtsRender) this.setRtsRender(true);
    else if (this.setLowFx) this.setLowFx({ ssao: 'half', mblur: false });
    if (this.stylePipe && this.stylePipe.resetHistory) this.stylePipe.resetHistory();
    if (this.rtsFogInit) this.rtsFogInit();
    if (this.rtsInputInit) this.rtsInputInit();
    if (this.rtsAiInit) this.rtsAiInit();
    // 陣營的樣式（E 包：資源列、卡片）；隨機選到的陣營提示
    if (this.rtsHudFaction) this.rtsHudFaction();
    if (rand[ME] && !R.cfg.aiBoth) this.rtsSay(`你的陣營：${facName(fac[ME])}（隨機）`, 0x9fd0ff);
    if (rand[1] && !R.cfg.aiBoth) this.rtsSay(`電腦的陣營：${facName(fac[1])}（隨機）`, 0x9fd0ff);
    this.state = 'rts';
    this.showScreen('');
    document.body.classList.add('rtsOn');
    this.lastT = performance.now();
    return R;
  },
  // 主堡的位置：基地平台上可以蓋的地方，外形離主礦（中心）約 13 m、離平台中心近（兩邊用同樣的規則，結果對稱）
  rtsFindSpot(defId, c, near, r) {
    const D = RTS_DEFS[defId];
    const nav = this.world.nav;
    const [w, d] = D.foot;
    const cell = nav.cell,
      S = this.world.size / 2;
    const snap = (v, s) => Math.round((v - s / 2 + S) / cell) * cell - S + s / 2;
    let best = null,
      bs = 1e9;
    for (let dx = -r; dx <= r; dx += 2)
      for (let dz = -r; dz <= r; dz += 2) {
        const x = snap(c.x + dx, w),
          z = snap(c.z + dz, d);
        if (Math.hypot(x - c.x, z - c.z) > r) continue;
        if (!nav.buildable(x, z, w, d)) continue;
        // 離主礦：主堡外形到礦脈中心的距離（工人來回要走一段，不能站在中間兩邊都搆得到）
        const rd = near
          ? Math.hypot(Math.max(0, Math.abs(near.x - x) - w / 2), Math.max(0, Math.abs(near.z - z) - d / 2))
          : 0;
        if (near && rd < 11) continue;
        const s = (near ? Math.abs(rd - 13) : 0) + 0.3 * Math.hypot(x - c.x, z - c.z);
        if (s < bs) ((bs = s), (best = { x, z }));
      }
    return best || { x: c.x, z: c.z };
  },

  // ---------- 實體 ----------
  // 單位（建築轉給 rtsSpawnBld，已完成）
  rtsSpawn(teamId, defId, x, z, yaw = 0) {
    const R = this.rts,
      D = RTS_DEFS[defId],
      T = R.teams[teamId];
    if (!D || !T) return null;
    if (D.kind === 'bld') return this.rtsSpawnBld(teamId, defId, x, z, yaw, 1);
    // 配色：定義的 palBase（實驗體類 'specimen'、投影器 'whiteout'）或陣營的，換上隊伍色（docs 14.3）
    const pal = rtsPal(D.palBase || T.faction, teamId);
    const e = new MechEntity(this, { ...D.asm }, pal, {
      team: T.team,
      name: D.name,
      ai: D.ai || 'rts',
      scale: D.scale || 1,
      radius: (D.radius || 1.2) / (D.scale || 1),
      stabMul: 3,
      modelKind: D.modelKind,
      vehKey: D.vehKey,
      flying: D.flying,
      hoverH: D.hoverH,
      buildModel: D.buildModel ? () => D.buildModel(pal) : undefined,
    });
    e.isPlayer = false;
    e.rtsTeam = teamId;
    e.rtsDef = defId;
    e.rtNavSize = D.size || 0;
    e.orders = [];
    e.carry = null;
    e.rt = {
      wish: new THREE.Vector3(),
      faceV: new THREE.Vector3(),
      face: null,
      fireT: 0,
      scanT: Math.random() * 0.35,
      nav: null,
      cur: undefined,
    };
    this.rtsBaseStats(e);
    e.hp = e.maxHp;
    const gy = this.world.groundAt(x, z, this.world.terrainHeight(x, z) + 2);
    const y = D.flying ? this.world.terrainHeight(x, z) + (D.hoverH || 6) : gy;
    e.pos.set(x, y, z);
    e.yaw = e.aimYaw = yaw;
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = yaw;
    if (D.worker) addWorkerKit(e.model, pal, T.faction); // 第 3 個參數：陣營的套件（B 包，R3）
    if (e.rtsAethModel) e.rtsAethModel(D); // 艾瑟立克的外加零件（原型體；B 包，在網格合併之前）
    this.rtsHook(e);
    (teamId === ME ? this.allies : this.enemies).push(e);
    this.rtsAddEnt(e, x, z);
    R.stats[teamId].made++;
    return e;
  },
  // 定義的基準數值（rtsSpawn、換定義（升級、民兵）時）：e.rtsBase、攻擊與護甲類型、各武器槽的傷害倍率，再套數值層。
  // 傷害：每個 slots 的武器槽依「武器的單發傷害 ÷ 兩發間隔（定義的 rof 與武器的 rof 取慢的）」換算，
  // 合計＝定義的 dps（slotDps 另外指定的槽各自換算、不算進 dps）；結果是 e.rtsSlotK[槽]（mech-rts.js 開火時乘上）
  rtsBaseStats(e) {
    const D = RTS_DEFS[e.rtsDef];
    if (!D) return;
    e.rtsArm = D.arm || (e.bld ? 'fort' : 'med');
    e.rtsAtkBy = null;
    e.rtsSlotK = null;
    const base = {
      hp: D.hp,
      speedMul: 1,
      armor: D.armor || 0,
      sight: D.sight || 0,
    };
    if (!e.bld) {
      base.speedMul = (D.speed || 6) / Math.max(1, e.stats.speed);
      const slots = D.slots || ['rarm'];
      const dpsOf = (s) => {
        const wd = e.weapons[s] && e.weapons[s].def;
        if (!wd || !wd.dmg) return 0;
        // 多連導彈（共振砲的 PM-6）一次射出 count 發（R3 B 包）
        const per = wd.dmg * (wd.npcK || 1) * (wd.pellets || 1) * (wd.type === 'missile' ? wd.count || 1 : 1);
        return per / Math.max(D.rof || 0, wd.rof || 0.1);
      };
      const K = {};
      let main = 0;
      for (const s of slots) if (!(D.slotDps && D.slotDps[s])) main += dpsOf(s);
      for (const s of slots) {
        const d = dpsOf(s);
        if (!d) continue;
        if (D.slotDps && D.slotDps[s]) K[s] = D.slotDps[s] / d;
        else if (D.dps && main > 0) K[s] = D.dps / main;
      }
      e.rtsSlotK = K;
      if (D.slotAtk) {
        e.rtsAtkBy = {};
        for (const s in D.slotAtk) {
          const wd = e.weapons[s] && e.weapons[s].def;
          if (wd) e.rtsAtkBy[wd.id] = D.slotAtk[s];
        }
      }
    }
    e.rtsBase = base;
    if (!e.rtsMods) e.rtsMods = emptyMods();
    this.rtsModsApply(e);
  },
  // 數值層（docs 13.3）：研究（up，依隊伍的研究即時算）＋英雄成長、道具、光環、buff → 實體的數值。
  // 血量依比例換算；改了 e.rtsMods 之後呼叫
  rtsModsApply(e) {
    const R = this.rts;
    if (!R || !e || !e.rtsBase) return;
    const D = RTS_DEFS[e.rtsDef] || {};
    const T = R.teams[e.rtsTeam];
    const M = e.rtsMods || (e.rtsMods = emptyMods());
    M.up = researchMods(T && T.tech ? T.tech.res : null, D);
    const m = mergeMods(M, R.t);
    const B = e.rtsBase;
    e.dmgMul = m.dmg;
    e.speedMul = B.speedMul * m.speed;
    e.rtsArmor = B.armor + m.armor;
    e.rtsRangeAdd = m.range;
    e.rtsVision = B.sight + m.sight;
    e.rtsRegen = m.regen;
    e.rtsRofK = 1 / Math.max(0.05, m.rof); // 開火間隔的倍率（mech-rts.js）
    e.rtsTakenK = m.taken;
    e.rtsImpK = m.imp;
    e.rtsSplashK = m.splash;
    const max = Math.max(1, (B.hp + m.hp) * m.hpK);
    if (e.maxHp && e.maxHp !== max && e.hp > 0) e.hp = (e.hp / e.maxHp) * max;
    e.maxHp = max;
    e.rtsM = m; // 合併的結果（HUD 顯示用）
  },
  // 換定義（主堡升級、民兵動員／解除）：保留血量比例
  rtsChangeDef(e, defId) {
    const D = RTS_DEFS[defId];
    if (!D) return;
    e.rtsDef = defId;
    e.name = D.name;
    if (e.bld) e.bld.def = defId;
    this.rtsBaseStats(e);
  },
  // 建築：progress＜1 時是工地（鷹架、血量從 10% 長起來）
  rtsSpawnBld(teamId, defId, x, z, yaw = 0, progress = 1) {
    const R = this.rts,
      D = RTS_DEFS[defId],
      T = R.teams[teamId],
      w = this.world;
    const pal = rtsPal(D.palBase || T.faction, teamId);
    const q = Math.round((yaw || 0) / (Math.PI / 2)) & 3;
    yaw = (q * Math.PI) / 2;
    const [fw, fd] = q & 1 ? [D.foot[1], D.foot[0]] : D.foot;
    const e = new MechEntity(this, { ...BLD_ASM }, pal, {
      team: T.team,
      name: D.name,
      ai: 'bld',
      modelKind: 'rts',
      buildModel: D.buildModel ? () => D.buildModel(pal) : () => buildRtsBuilding(defId, pal),
      radius: Math.max(fw, fd) / 2,
    });
    e.isPlayer = false;
    e.noPush = true;
    e.rtsTeam = teamId;
    e.rtsDef = defId;
    e.orders = [];
    e.acsMax = 1e9;
    // off＝停擺（導管斷電，docs 14.2；rts-grid.js 的 rtsPowerRebuild 設定）、pw＝外觀目前的供電狀態（setPower）、
    // empT＝電磁脈衝讓生產與研究暫停到這個局內時間（C 包的 VEIL）
    e.bld = {
      def: defId,
      progress,
      queue: [],
      rally: null,
      builders: new Set(),
      vent: null,
      w: fw,
      d: fd,
      off: false,
      pw: true,
      empT: 0,
    };
    this.rtsBaseStats(e);
    e.hp = progress >= 1 ? e.maxHp : Math.max(1, e.maxHp * 0.1);
    if (D.inv) {
      // 中立建築：打不壞、不能鎖定（D 包）
      e.rtsInv = true;
      e.noLock = true;
    }
    // 地面：佔地四角與中心的最低點（本體略微埋進地面）
    const th = (a, b) => w.terrainHeight(a, b);
    const gy = Math.min(
      th(x, z),
      th(x - fw / 2, z - fd / 2),
      th(x + fw / 2, z - fd / 2),
      th(x - fw / 2, z + fd / 2),
      th(x + fw / 2, z + fd / 2),
    );
    e.pos.set(x, gy, z);
    e.yaw = e.aimYaw = yaw;
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = yaw;
    if (e.model.setProgress) e.model.setProgress(progress);
    if (e.model.setTier && D.tier) e.model.setTier(D.tier);
    const ob = { kind: 'box', x, z, w: fw, d: fd, y: gy - 0.5, top: gy + D.height, rtsBld: e };
    w.obstacles.push(ob);
    e.rtsOb = ob;
    e.shape = propShape(w, ob);
    w.nav.block(x, z, fw, fd, 0, true);
    if (D.on === 'coral') {
      const v = R.corals.find((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 3);
      if (v) {
        v.ext = e;
        e.bld.vent = v;
      }
    }
    this.rtsHook(e);
    (teamId === ME ? this.allies : this.enemies).push(e);
    this.rtsAddEnt(e, x, z);
    R.stats[teamId].blds++;
    // 導管網：供電源（蓋好的才算）與要電的建築（docs 14.2）
    if ((D.conduit || D.needPower) && this.rtsPowerRebuild) this.rtsPowerRebuild(teamId);
    return e;
  },
  // 實體的 takeDamage／die 換成 RTS 版。傷害（docs 13.3）：
  //   dmg（已含來源的 dmgMul）× 相剋表[來源的攻擊類型][自己的護甲類型] × 護甲（armorK）× 受到的傷害倍率（數值層 taken），
  //   再以屬性 'none' 交給原本的 takeDamage（不套零件的防禦與弱點；盾牌 MT 正面大盾的 specialDefense 照舊）。
  //   攻擊類型：rtsHit 指定的 > 來源定義的 slotAtk（依武器）> 來源定義的 atk > 依屬性推算（kin／exp／en）。
  //   e.rtsInv（中立建築）忽略傷害。
  rtsHook(e) {
    const td = MechEntity.prototype.takeDamage;
    const g = this;
    e.takeDamage = function (dmg, impact, from, at, dir, melee, wid, attr) {
      const atk = this._rtsAtk || g.rtsAtkOf(from, wid, attr);
      this._rtsAtk = null;
      if (this.rtsInv || this.dead) return;
      if (from && this.rtsHurtBy) this.rtsHurtBy(from);
      // 原本的 takeDamage 把傷害四捨五入成整數：RTS 每發的傷害小（機槍約 2.4），改成依小數部分的機率進位，平均才不會偏掉（B 包）
      let v = dmg * g.rtsDmgK(atk, this);
      if (v > 0) v = Math.floor(v) + (Math.random() < v - Math.floor(v) ? 1 : 0);
      if (v > 0 && g.rts) this.rtsHurtT = g.rts.t; // 最後一次受傷的局內時間（導管裡的建築 8 秒沒受傷才回血）
      return td.call(this, v, (impact || 0) * (this.rtsImpK || 1), from, at, dir, melee, wid, 'none');
    };
    e.die = function (from) {
      if (this.dead) return;
      this.dead = true;
      this.rtsDie(from);
    };
  },
  // 來源的攻擊類型
  rtsAtkOf(from, wid, attr) {
    if (from && from.rtsAtkBy && wid && from.rtsAtkBy[wid]) return from.rtsAtkBy[wid];
    const D = from && from.rtsDef && RTS_DEFS[from.rtsDef];
    if (D && D.atk) return D.atk;
    return attrAtk(attr);
  },
  // 對 t 的傷害倍率：相剋 × 護甲 × 受到的傷害倍率
  rtsDmgK(atk, t) {
    if (atk === 'none') return t.rtsTakenK || 1;
    // 維爾威（rts-veer.js）：展開中的建築 ×1.25、熱焰彈（空中單位受到的穿甲 −20%）
    const vk = this.rtsVeerTakenK ? this.rtsVeerTakenK(atk, t) : 1;
    return typeK(atk, t.rtsArm) * armorK(t.rtsArmor || 0) * (t.rtsTakenK || 1) * vk;
  },
  // 技能與範圍傷害的入口（docs 13.3）：atk 明確指定、src 是施放者（擊破的經驗照常算給它）；回傳實際扣的血量
  rtsHit(t, dmg, impact, src, atk = 'kin', at = null) {
    if (!t || t.dead || t.rtsInv) return 0;
    const hp0 = t.hp;
    const c = at || t.center();
    let dir = null;
    if (src && src.pos) {
      dir = new THREE.Vector3(t.pos.x - src.pos.x, 0, t.pos.z - src.pos.z);
      if (dir.lengthSq() > 1e-6) dir.normalize();
      else dir = null;
    }
    t._rtsAtk = atk;
    t.takeDamage(dmg, impact || 0, src || null, c, dir, undefined, undefined, atkAttr(atk));
    t._rtsAtk = null;
    return Math.max(0, hp0 - Math.max(0, t.hp));
  },
  // 範圍傷害：中心 100% 線性降到邊緣 40%（建築以外形最近點算距離）；team＝攻擊方的隊伍（沒有 src 時用）；
  // 只打敵對的、高度差在半徑＋3 m 以內；空中單位（flying）不會被波及，低空的（rtsLowAir）一律算。回傳命中的數量
  rtsSplash(x, z, r, dmg, impact, src, atk = 'exp', team) {
    const R = this.rts;
    if (!R || !(r > 0)) return 0;
    const tm = src && src.rtsTeam !== undefined ? src.rtsTeam : team;
    const y = this.world.terrainHeight(x, z);
    const p = new THREE.Vector3(x, y + 0.5, z);
    const list = this.rtsNear(x, z, r + 12).slice();
    let n = 0;
    for (const t of list) {
      if (!t || t.dead || t.rtsInv || t.rtsTeam === tm) continue;
      const d = t.shape
        ? targetDist(t, p)
        : Math.max(0, Math.hypot(t.pos.x - x, t.pos.z - z) - (t.radius || 1));
      if (d > r) continue;
      // 空中單位不受地面的範圍傷害；低空（維爾威的衝撞無人機、下降中的運輸機、收起的建築…）一律算（docs 15.2）
      const low = this.rtsLowAir ? this.rtsLowAir(t) : false;
      if (!low && t.flying) continue;
      if (!t.bld && !low && Math.abs(t.pos.y - y) > r + 3) continue;
      const k = 1 - 0.6 * Math.min(1, d / r);
      this.rtsHit(t, dmg * k, (impact || 0) * k, src, atk);
      n++;
    }
    return n;
  },
  // 登記新的實體：清單、編號、空間索引、其他隊伍的敵對名單（這一格之內新生成的也打得到）
  rtsAddEnt(e, x, z) {
    const R = this.rts;
    R.units.push(e);
    R.byId.set(e.id, e);
    R.hash.insert(e, x, z);
    for (let i = 0; i < R.teams.length; i++) if (i !== e.rtsTeam && R.hostile[i]) R.hostile[i].push(e);
  },
  // 每個隊伍的敵對實體（不同隊、活著）；rtsSim 每格重建
  rtsHostileRebuild() {
    const R = this.rts;
    const H = R.hostile;
    for (let i = 0; i < R.teams.length; i++) (H[i] || (H[i] = [])).length = 0;
    for (const e of R.units) {
      if (e.dead || e.rtsAboard) continue; // 運輸機上的乘員（docs 15.3）不能被打
      for (let i = 0; i < R.teams.length; i++) if (i !== e.rtsTeam) H[i].push(e);
    }
  },
  // 數值層的維護（rtsSim 每格）：每秒回復（regen）、每 0.5 秒清掉過期的 buff 並重算、民兵到期
  rtsModsTick(dt) {
    const R = this.rts;
    for (const e of R.units)
      if (!e.dead && e.rtsRegen > 0 && e.hp < e.maxHp && !(e.bld && e.bld.progress < 1))
        e.hp = Math.min(e.maxHp, e.hp + e.rtsRegen * dt);
    R.modT -= dt;
    if (R.modT > 0) return;
    R.modT = 0.5;
    for (const e of R.units) {
      if (e.dead || !e.rtsMods) continue;
      const B = e.rtsMods.buff;
      if (B && B.length && B.some((b) => b.t !== undefined && b.t <= R.t)) {
        e.rtsMods.buff = B.filter((b) => !(b.t !== undefined && b.t <= R.t));
        this.rtsModsApply(e);
      }
      if (e.rtsMilT !== undefined && R.t >= e.rtsMilT) this.rtsDemobUnit(e);
      if (e.rtsIllus && R.t >= e.rtsIllus.t && this.rtsIllusionEnd) this.rtsIllusionEnd(e); // 幻象到期
    }
  },
  // 加一筆 buff（B、C 包的技能）：b＝{ src, ...欄位 }、sec 秒後到期；同一個 src 取代舊的
  rtsBuff(e, b, sec) {
    if (!e || e.dead || !e.rtsMods) return;
    const R = this.rts;
    const o = { ...b, t: R.t + sec };
    const L = e.rtsMods.buff;
    const i = b.src !== undefined ? L.findIndex((x) => x.src === b.src) : -1;
    if (i >= 0) L[i] = o;
    else L.push(o);
    this.rtsModsApply(e);
  },
  rtsEnt(id) {
    return this.rts ? this.rts.byId.get(id) || null : null;
  },
  rtsMine(id) {
    return this.rts ? this.rts.resById.get(id) || null : null;
  },
  rtsUnitsOf(teamId) {
    return this.rts ? this.rts.units.filter((e) => e.rtsTeam === teamId && !e.dead) : [];
  },
  // 範圍內的實體（空間索引粗篩，共用的陣列：呼叫端不要保留）
  rtsNear(x, z, r) {
    return this.rts.hash.query(x, z, r, _q);
  },
  rtsMineAt(x, z, r) {
    let best = null,
      bd = r;
    for (const m of this.rts.mines) {
      if (m.amount <= 0) continue;
      const d = Math.hypot(m.pos.x - x, m.pos.z - z);
      if (d < bd) ((bd = d), (best = m));
    }
    return best;
  },
  rtsNearestMine(x, z, teamId, exclude, freeOnly) {
    let best = null,
      bd = 1e9;
    for (const m of this.rts.mines) {
      if (m === exclude || m.amount <= 0) continue;
      if (freeOnly && m.miners.size >= RTS_GATHER.sat) continue;
      const d = Math.hypot(m.pos.x - x, m.pos.z - z);
      if (d < bd) ((bd = d), (best = m));
    }
    return best;
  },
  // 最近的回收點（蓋好的主堡；維爾威的集貨站也是，交貨時由 rts-veer.js 的 rtsHaulDeposit 放進庫存）
  rtsDropoff(teamId, x, z) {
    let best = null,
      bd = 1e9;
    for (const e of this.rts.units) {
      if (
        e.dead ||
        !e.bld ||
        e.rtsTeam !== teamId ||
        e.bld.progress < 1 ||
        e.bld.packed || // 收起的建築（維爾威）不收貨
        !RTS_DEFS[e.rtsDef].dropoff
      )
        continue;
      const d = Math.hypot(e.pos.x - x, e.pos.z - z);
      if (d < bd) ((bd = d), (best = e));
    }
    return best;
  },
  rtsMineChanged(m) {
    setMineAmount(m.mesh, m.amount / m.max);
    if (m.amount <= 0) {
      m.amount = 0;
      if (this.rtsEvent && [...m.miners].some((u) => u.rtsTeam === ME))
        this.rtsEvent(m.pos.x, m.pos.z, '礦脈採完了');
    }
  },
  // 特效只在鏡頭附近產生（遠處的採礦火花不畫）
  rtsFxOk(p) {
    const c = this.camTarget;
    return !c || Math.hypot(p.x - c.x, p.z - c.z) < 160;
  },

  // ---------- 資源 ----------
  rtsAfford(teamId, cost) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T || !cost) return !!T;
    if ((cost.ore || 0) > T.ore + 1e-6 || (cost.coral || 0) > T.coral + 1e-6) return false;
    if (cost.pop && T.pop + cost.pop > T.cap) return false;
    return true;
  },
  rtsPay(teamId, cost) {
    if (!this.rtsAfford(teamId, cost)) return false;
    const T = this.rts.teams[teamId];
    T.ore -= cost.ore || 0;
    T.coral -= cost.coral || 0;
    return true;
  },
  rtsRefund(teamId, cost, k = 1) {
    const T = this.rts.teams[teamId];
    T.ore += Math.floor((cost.ore || 0) * k);
    T.coral += Math.floor((cost.coral || 0) * k);
  },
  // 繳交資源：礦石套維持費（人口 60／100 以上收入 70%／40%），Coral 不受影響；回傳實際入帳的量
  rtsDeposit(teamId, kind, n) {
    const T = this.rts.teams[teamId];
    if (kind === 'coral') {
      T.coral += n * (T.income || 1);
      return n * (T.income || 1);
    }
    const v = n * upkeepOf(T.pop).k * (T.income || 1); // T.income：電腦「瘋狂」難度的收入倍率（rts-ai.js）
    T.ore += v;
    return v;
  },
  // 人口與上限：活著的單位＋生產中（已開始）的單位；上限＝蓋好的建築的 popCap 合計（最多 150）
  rtsRecount() {
    const R = this.rts;
    for (const T of R.teams) {
      T.pop = 0;
      T.cap = 0;
      if (T.tech) T.tech.tier = 1;
    }
    for (const e of R.units) {
      if (e.dead) continue;
      const T = R.teams[e.rtsTeam],
        D = RTS_DEFS[e.rtsDef];
      if (!T || !D) continue;
      if (e.bld) {
        if (e.bld.progress >= 1) {
          T.cap += D.popCap || 0;
          if (D.heroes && D.tier && T.tech) T.tech.tier = Math.max(T.tech.tier, D.tier); // 層級＝蓋好的主堡的最高階
        }
        const q = e.bld.queue[0];
        if (q && q.on && !q.upg && !q.res)
          T.pop += q.pop !== undefined ? q.pop : (RTS_DEFS[q.id] || {}).pop || 0;
      } else if (!e.rtsIllus && !e.rtsNoPop) T.pop += e.rtsPopFuse !== undefined ? e.rtsPopFuse : D.pop || 0; // 幻象與臨時單位（C 包的孵化）不佔人口、融合中的宿主算結果的人口
    }
    // 投放艙還在落下的單位（維爾威）：生產已經完成，人口照算
    for (const p of R.pods || []) if (R.teams[p.team]) R.teams[p.team].pop += p.pop || 0;
    for (const T of R.teams) {
      T.cap = Math.min(RTS_POP_MAX, T.cap);
      T.upk = upkeepOf(T.pop).lv;
    }
  },
  // 資源直接入帳（不套維持費：營地掉寶、拾荒；docs 13.6）
  rtsGrant(teamId, ore = 0, coral = 0) {
    const T = this.rts && this.rts.teams[teamId];
    if (!T) return;
    T.ore += ore;
    T.coral += coral;
  },

  // ---------- 科技（docs 13.2） ----------
  // 層級＝蓋好的主堡的最高階（主堡被拆光時退回剩下的最高階，沒有＝1）
  rtsTier(teamId) {
    const T = this.rts && this.rts.teams[teamId];
    return T && T.tech ? T.tech.tier : 1;
  },
  // 研究的級數
  rtsResLv(teamId, id) {
    const T = this.rts && this.rts.teams[teamId];
    return (T && T.tech && T.tech.res[id]) || 0;
  },
  // 有沒有蓋好的建築 want（升級過的主堡也算低階的）
  rtsHasBld(teamId, want) {
    for (const e of this.rts.units)
      if (!e.dead && e.bld && e.rtsTeam === teamId && e.bld.progress >= 1 && bldSatisfies(e.rtsDef, want))
        return true;
    return false;
  },
  // 需求檢查：D＝定義、卡片或任何有 req 的物件；回傳 '' 或原因。英雄另外看數量與層級（C 包的 rtsHeroWhy 優先）
  rtsReqWhy(teamId, D) {
    if (!this.rts || !D) return '';
    const r = reqOf(D);
    if (r) {
      if (r.tier && this.rtsTier(teamId) < r.tier)
        return `需要 ${this.rtsTierName(teamId, r.tier)}（T${r.tier}）`;
      for (const id of r.blds || [])
        if (!this.rtsHasBld(teamId, id)) return '需要 ' + ((RTS_DEFS[id] && RTS_DEFS[id].name) || id);
      for (const id of r.res || [])
        if (!this.rtsResLv(teamId, id))
          return '需要研究 ' + ((RTS_RESEARCH[id] && RTS_RESEARCH[id].name) || id);
    }
    if (D.hero && D.id) {
      if (this.rtsHeroWhy) return this.rtsHeroWhy(teamId, D.id) || '';
      return this.rtsHeroWhyDefault(teamId, D.id);
    }
    return '';
  },
  // 第 n 階主堡的名稱（依陣營）
  rtsTierName(teamId, tier) {
    const T = this.rts.teams[teamId];
    const F = RTS_FACTIONS[T && T.faction] || RTS_FACTIONS.castron;
    let id = F.hq;
    for (let i = 1; i < tier && id && RTS_DEFS[id]; i++) id = RTS_DEFS[id].upTo;
    return (id && RTS_DEFS[id] && RTS_DEFS[id].name) || '主堡';
  },
  // 英雄的取得條件（C 包沒有提供 rtsHeroWhy 時）：同一位只能一個、最多 3 個、第 n 個要 Tn
  rtsHeroWhyDefault(teamId, heroId) {
    const R = this.rts,
      T = R.teams[teamId];
    const have = (T.heroes || []).map((h) => h.def);
    const queued = [];
    for (const e of R.units)
      if (!e.dead && e.bld && e.rtsTeam === teamId)
        for (const q of e.bld.queue)
          if (RTS_DEFS[q.id] && RTS_DEFS[q.id].hero && !q.revive) queued.push(q.id);
    if (have.includes(heroId) || queued.includes(heroId)) return '已經有這位英雄';
    const n = have.length + queued.length;
    if (n >= RTS_HERO_MAX) return `英雄最多 ${RTS_HERO_MAX} 位`;
    if (this.rtsTier(teamId) < n + 1) return `需要 ${this.rtsTierName(teamId, n + 1)}（T${n + 1}）`;
    return '';
  },
  // 英雄的價格：第 1 位免費（只花人口），之後 425／100（C 包可以提供 rtsHeroCost 覆寫）；
  // 復活另外由 C 包的 rtsHeroReviveCost(teamId, heroId) 決定 { cost, time }
  rtsHeroPrice(teamId, heroId) {
    if (this.rtsHeroCost) return this.rtsHeroCost(teamId, heroId);
    const R = this.rts,
      T = R.teams[teamId];
    let n = (T.heroes || []).length;
    for (const e of R.units)
      if (!e.dead && e.bld && e.rtsTeam === teamId)
        for (const q of e.bld.queue) if (RTS_DEFS[q.id] && RTS_DEFS[q.id].hero && !q.revive) n++;
    return n === 0 ? { ore: 0, coral: 0 } : { ...RTS_HERO_COST };
  },
  // 研究的資訊（HUD 與電腦對手）：{ lv 目前級數, max, next（下一級的 { cost, time, tier }）, why（不能研究的原因） }
  rtsResearchInfo(teamId, id, b = null) {
    const Rs = RTS_RESEARCH[id];
    const T = this.rts && this.rts.teams[teamId];
    if (!Rs || !T) return null;
    const lv = T.tech.res[id] || 0;
    const max = Rs.lv.length;
    const next = lv < max ? Rs.lv[lv] : null;
    let why = '';
    if (!next) why = '已完成';
    else if (T.tech.busy[id]) why = '研究中';
    else if (this.rtsTier(teamId) < next.tier)
      why = `需要 ${this.rtsTierName(teamId, next.tier)}（T${next.tier}）`;
    else if (b && b.bld && b.bld.progress < 1) why = '建築還沒蓋好';
    else if (b && b.bld && b.bld.queue.length >= RTS_QUEUE_MAX) why = '佇列已滿';
    else if (T.ore < next.cost.ore) why = '礦石不足';
    else if (T.coral < next.cost.coral) why = 'Coral 不足';
    return { lv, max, next, why };
  },
  // 研究：放進建築的佇列（同一隊同一項同時只能一棟在研究）
  rtsResearch(b, id) {
    const R = this.rts;
    if (!R || !b || b.dead || !b.bld) return false;
    const BD = RTS_DEFS[b.rtsDef];
    const me = b.rtsTeam === ME;
    if (!BD || !(BD.research || []).includes(id)) return false;
    const inf = this.rtsResearchInfo(b.rtsTeam, id, b);
    if (!inf || inf.why) return (me && inf && this.rtsSay(inf.why), false);
    if (!this.rtsPay(b.rtsTeam, inf.next.cost)) return false;
    R.teams[b.rtsTeam].tech.busy[id] = true;
    b.bld.queue.push({
      id,
      t: 0,
      on: true,
      res: true,
      lv: inf.lv + 1,
      time: inf.next.time,
      cost: inf.next.cost,
    });
    return true;
  },
  // 主堡升級（同一棟建築原地升級；期間不能生產工人，佇列只能有這一項）
  rtsUpgrade(b, toId) {
    const R = this.rts;
    if (!R || !b || b.dead || !b.bld) return false;
    const BD = RTS_DEFS[b.rtsDef],
      U = RTS_DEFS[toId];
    const me = b.rtsTeam === ME;
    if (!BD || !U || BD.upTo !== toId) return false;
    if (b.bld.progress < 1) return (me && this.rtsSay('建築還沒蓋好'), false);
    if (b.bld.queue.length) return (me && this.rtsSay('佇列要是空的才能升級'), false);
    const why = this.rtsReqWhy(b.rtsTeam, U);
    if (why) return (me && this.rtsSay(why), false);
    if (!this.rtsPay(b.rtsTeam, U.cost)) {
      if (me) this.rtsSay(R.teams[b.rtsTeam].ore < (U.cost.ore || 0) ? '礦石不足' : 'Coral 不足');
      return false;
    }
    b.bld.queue.push({ id: toId, t: 0, on: true, upg: true, time: U.time, cost: { ...U.cost } });
    return true;
  },
  // 升級完成：換定義（血量依比例）、外觀換階（B 包的 setTier）、高度與命中外形
  rtsUpgradeDone(b, toId) {
    const D = RTS_DEFS[toId];
    this.rtsChangeDef(b, toId);
    if (b.rtsOb) {
      b.rtsOb.top = b.rtsOb.y + 0.5 + D.height;
      b.shape = propShape(this.world, b.rtsOb);
    }
    if (b.model.setTier && D.tier) b.model.setTier(D.tier);
    if (D.conduit && this.rtsPowerRebuild) this.rtsPowerRebuild(b.rtsTeam); // 研究中樞升級：導管範圍變大
    this.rtsRecount();
    this.rtsTechDone(b.rtsTeam, toId, D.tier || 1, b);
  },
  // 研究完成：級數 +1、全隊重算數值層
  rtsResearchDone(b, q) {
    const R = this.rts,
      T = R.teams[b.rtsTeam];
    T.tech.res[q.id] = Math.max(T.tech.res[q.id] || 0, q.lv || 1);
    delete T.tech.busy[q.id];
    for (const e of R.units) if (!e.dead && e.rtsTeam === b.rtsTeam && e.rtsBase) this.rtsModsApply(e);
    if (q.id === 'r_grid' && this.rtsPowerRebuild) this.rtsPowerRebuild(b.rtsTeam); // 導管範圍 +6 m
    this.rtsTechDone(b.rtsTeam, q.id, T.tech.res[q.id], b);
  },
  // 研究或升級完成的通知（事件、電腦對手讀 T.tech.log）
  rtsTechDone(teamId, id, lv, b) {
    const R = this.rts,
      T = R.teams[teamId];
    (T.tech.log || (T.tech.log = [])).push({ id, lv, t: R.t });
    if (teamId !== ME) return;
    const name = RTS_RESEARCH[id]
      ? RTS_RESEARCH[id].name + (RTS_RESEARCH[id].lv.length > 1 ? ' ' + lv + ' 級' : '')
      : (RTS_DEFS[id] && RTS_DEFS[id].name) || id;
    const txt = (RTS_RESEARCH[id] ? '研究完成：' : '升級完成：') + name;
    if (this.rtsEvent && b) this.rtsEvent(b.pos.x, b.pos.z, txt);
    this.rtsSay(txt, 0x7ee081);
  },
  // 建築的攻擊距離（防禦塔＝定義的 range＋數值層；主堡研究要塞化後 T2 起 fortGun）；0＝不會攻擊
  rtsBldRange(b) {
    const D = RTS_DEFS[b.rtsDef];
    if (!D || !b.bld || b.bld.progress < 1) return 0;
    if (D.range) return D.range + (b.rtsRangeAdd || 0);
    if (D.fortGun && this.rtsResLv(b.rtsTeam, 'r_fort')) return D.fortGun.range;
    return 0;
  },

  // ---------- 民兵（主堡的動員；docs 13.3 的 ab_militia） ----------
  // 主堡 RTS_MILITIA.r 內的作業 MT 變成民兵（定義 c_militia；外觀由 B 包的 e.rtsMorph(defId) 換組裝）
  rtsMilitia(hq) {
    const R = this.rts;
    if (!R || !hq || hq.dead || !hq.bld || hq.bld.progress < 1 || !RTS_DEFS[hq.rtsDef].heroes) return 0;
    const T = R.teams[hq.rtsTeam];
    const F = RTS_FACTIONS[T.faction] || RTS_FACTIONS.castron;
    if (!F.militia) return 0;
    const dur = this.rtsResLv(hq.rtsTeam, 'r_militia') ? RTS_MILITIA.t2 : RTS_MILITIA.t;
    let n = 0;
    for (const e of R.units) {
      if (e.dead || e.bld || e.rtsTeam !== hq.rtsTeam || !RTS_DEFS[e.rtsDef].worker) continue;
      if (Math.hypot(e.pos.x - hq.pos.x, e.pos.z - hq.pos.z) > RTS_MILITIA.r) continue;
      const lastMine = e.rt.lastMine !== undefined ? e.rt.lastMine : e.orders[0] && e.orders[0].mine;
      if (e.carry && e.carry.n) e.carry = null;
      this.rtsSetOrders(e, []);
      e.rtsLeaveOrder(null);
      e.rt.cur = undefined;
      e.rtsMilFrom = e.rtsDef;
      e.rtsMilMine = lastMine;
      e.rtsMilT = R.t + dur;
      if (e.rtsMorph) e.rtsMorph(F.militia);
      this.rtsChangeDef(e, F.militia);
      n++;
    }
    if (hq.rtsTeam === ME)
      this.rtsSay(n ? `動員：${n} 台作業 MT 拿起武器` : '附近沒有作業 MT', n ? 0xffd070 : undefined);
    return n;
  },
  // 解除動員：這一隊全部的民兵
  rtsDemob(hq) {
    const R = this.rts;
    if (!R || !hq) return 0;
    let n = 0;
    for (const e of R.units)
      if (!e.dead && e.rtsTeam === hq.rtsTeam && e.rtsMilFrom) {
        this.rtsDemobUnit(e);
        n++;
      }
    return n;
  },
  rtsDemobUnit(e) {
    const from = e.rtsMilFrom;
    if (!from || e.dead) return;
    e.rtsMilFrom = null;
    e.rtsMilT = undefined;
    if (e.rtsMorph) e.rtsMorph(from);
    this.rtsChangeDef(e, from);
    this.rtsSetOrders(e, []);
    const m =
      (e.rtsMilMine !== undefined && this.rtsMine(e.rtsMilMine)) ||
      this.rtsNearestMine(e.pos.x, e.pos.z, e.rtsTeam, null, true);
    if (m && m.amount > 0) e.orders = [{ k: 'gather', mine: m.id }];
  },
  // 自動管家等用的建築位置（E 包）：主基地（第一座主堡）maxR 內、同一個平台、四周留 2 m 通道（找不到時放寬）、
  // 不擋主堡與礦脈之間的路；找不到回傳 null
  rtsAutoSpot(teamId, defId, maxR = 60) {
    const R = this.rts,
      D = RTS_DEFS[defId],
      nav = this.world.nav;
    if (!R || !D || D.kind !== 'bld') return null;
    const hq = R.units.find((e) => !e.dead && e.bld && e.rtsTeam === teamId && RTS_DEFS[e.rtsDef].dropoff);
    if (!hq) return null;
    const [w, d] = D.foot;
    const cell = nav.cell,
      S = this.world.size / 2;
    const snap = (v, s) => Math.round((v - s / 2 + S) / cell) * cell - S + s / 2;
    const m = this.rtsNearestMine(hq.pos.x, hq.pos.z, teamId);
    // 先找同一個平台、四周留 2 m 通道的；都沒有時放寬（不看平台、通道 1 m）
    for (const [pad, flat] of [
      [4, true],
      [2, false],
    ]) {
      let best = null,
        bs = 1e9;
      for (let dx = -maxR; dx <= maxR; dx += 2)
        for (let dz = -maxR; dz <= maxR; dz += 2) {
          const x = snap(hq.pos.x + dx, w),
            z = snap(hq.pos.z + dz, d);
          const r = Math.hypot(x - hq.pos.x, z - hq.pos.z);
          if (r > maxR || r < (hq.bld.w + w) / 2 + 3) continue;
          if (!nav.buildable(x, z, w + pad, d + pad)) continue;
          if (this.rtsPowerWhy && this.rtsPowerWhy(teamId, defId, x, z)) continue; // 導管（docs 14.2）
          const dh = Math.abs(this.world.terrainHeight(x, z) - hq.pos.y);
          if (flat && dh > 2.5) continue; // 同一個平台
          // 不擋主堡與礦脈之間的路
          if (m) {
            const ax = m.pos.x - hq.pos.x,
              az = m.pos.z - hq.pos.z,
              L = Math.hypot(ax, az) || 1;
            const t = ((x - hq.pos.x) * ax + (z - hq.pos.z) * az) / (L * L);
            const off = Math.abs(((x - hq.pos.x) * az - (z - hq.pos.z) * ax) / L);
            if (t > -0.1 && t < 1.1 && off < (w + d) / 2 + 5) continue;
          }
          const s = r + dh * 4;
          if (s < bs) ((bs = s), (best = { x, z }));
        }
      if (best) return best;
    }
    return null;
  },
  // ---------- 建造 ----------
  // 工人到了工地：檢查位置、需求與資源、扣款、建立地基（progress 0）；不行時回傳 null（玩家的提示）
  rtsPlace(teamId, defId, x, z, yaw, builder) {
    const R = this.rts,
      D = RTS_DEFS[defId],
      nav = this.world.nav;
    const say = (t) => teamId === ME && this.rtsSay(t);
    if (!D || D.kind !== 'bld') return null;
    const T = R.teams[teamId];
    if (D.faction && T && D.faction !== T.faction) return (say('不是這個陣營的建築'), null);
    const why = this.rtsReqWhy(teamId, D);
    if (why) return (say(why), null);
    // 導管（docs 14.2）：要電的建築要在有電的範圍內、導管節點要在有電的供電源 32 m 內
    const pw = this.rtsPowerWhy ? this.rtsPowerWhy(teamId, defId, x, z) : '';
    if (pw) return (say(pw), null);
    if (D.on === 'coral') {
      const v = R.corals.find((c) => Math.hypot(c.pos.x - x, c.pos.z - z) < 6);
      if (!v) return (say('要蓋在 Coral 湧出點上'), null);
      if (v.ext && !v.ext.dead) return (say('這個湧出點已經有抽取站'), null);
      x = v.pos.x;
      z = v.pos.z;
    } else {
      const q = Math.round((yaw || 0) / (Math.PI / 2)) & 1;
      const [fw, fd] = q ? [D.foot[1], D.foot[0]] : D.foot;
      if (!nav.buildable(x, z, fw, fd)) return (say('這裡不能建造'), null);
    }
    if (!this.rtsPay(teamId, D.cost))
      return (say(R.teams[teamId].ore < (D.cost.ore || 0) ? '礦石不足' : 'Coral 不足'), null);
    const b = this.rtsSpawnBld(teamId, defId, x, z, yaw, 0);
    if (builder) b.bld.builders.add(builder);
    if (teamId === ME && this.rtsEvent) this.rtsEvent(x, z, '');
    return b;
  },
  // 修理一格：補血並扣礦石；資源不足時回傳 false
  rtsRepairStep(b, w, dt) {
    const D = RTS_DEFS[b.rtsDef],
      T = this.rts.teams[b.rtsTeam];
    const dh = Math.min((b.maxHp / (D.time * RTS_REPAIR.timeK)) * dt, b.maxHp - b.hp);
    if (dh <= 0) return true;
    const cost = ((D.cost.ore || 0) * RTS_REPAIR.costK * dh) / b.maxHp;
    if (T.ore < cost) {
      if (b.rtsTeam === ME) this.rtsSay('礦石不足，無法修理');
      return false;
    }
    T.ore -= cost;
    b.hp += dh;
    return true;
  },
  // 生產：加入佇列（扣款；人口在開始生產時才檢查）。英雄（定義的 hero）在有 heroes 的建築（主堡）生產；
  // o.revive＝復活（C 包的 rtsHeroReviveCost 決定費用與時間）。佇列項目 { id, t, on, cost, time?, pop?, revive? }
  rtsQueue(b, defId, o = {}) {
    const D = RTS_DEFS[defId],
      BD = b && RTS_DEFS[b.rtsDef];
    const me = b && b.rtsTeam === ME;
    if (!b || b.dead || !b.bld || !D || !BD) return false;
    const hero = !!D.hero;
    if (hero ? !BD.heroes : !(BD.trains || []).includes(defId)) return false;
    if (b.bld.progress < 1) return (me && this.rtsSay('建築還沒蓋好'), false);
    if (b.bld.queue.some((q) => q.upg)) return (me && this.rtsSay('升級中，不能生產'), false);
    if (b.bld.queue.length >= RTS_QUEUE_MAX) return (me && this.rtsSay('生產佇列已滿'), false);
    let cost = D.cost,
      time;
    if (hero && o.revive) {
      const rv = this.rtsHeroReviveCost ? this.rtsHeroReviveCost(b.rtsTeam, defId) : null;
      cost = (rv && rv.cost) || { ore: 155, coral: 0 };
      time = (rv && rv.time) || 15;
    } else {
      const why = this.rtsReqWhy(b.rtsTeam, D);
      if (why) return (me && this.rtsSay(why), false);
      if (hero) cost = this.rtsHeroPrice(b.rtsTeam, defId);
    }
    if (!this.rtsPay(b.rtsTeam, cost)) {
      if (me) this.rtsSay(this.rts.teams[b.rtsTeam].ore < (cost.ore || 0) ? '礦石不足' : 'Coral 不足');
      return false;
    }
    const it = { id: defId, t: 0, cost: { ore: cost.ore || 0, coral: cost.coral || 0 } };
    if (time !== undefined) it.time = time;
    if (o.revive) it.revive = true;
    b.bld.queue.push(it);
    return true;
  },
  // 取消：i＝-1（或建築還沒蓋好）＝取消建造（退 75%）；否則取消佇列的第 i 項（全額退還；研究與升級也是）
  rtsCancel(b, i) {
    if (!b || b.dead || !b.bld) return false;
    const R = this.rts;
    if (i === -1 || b.bld.progress < 1) {
      this.rtsRefund(b.rtsTeam, RTS_DEFS[b.rtsDef].cost, 0.75);
      b.rtsQuiet = true;
      b.die(null);
      return true;
    }
    if (i === undefined || i < 0 || i >= b.bld.queue.length) i = b.bld.queue.length - 1;
    if (i < 0) return false;
    const it = b.bld.queue.splice(i, 1)[0];
    this.rtsRefund(b.rtsTeam, it.cost || (RTS_DEFS[it.id] || {}).cost || {}, 1);
    if (it.res) delete R.teams[b.rtsTeam].tech.busy[it.id];
    this.rtsRecount();
    return true;
  },
  rtsSay(t, color = 0xff8a8a) {
    if (this.rtsMsg) this.rtsMsg(t, color);
    else this.flashMsg(t, color, 1.4);
  },

  // ---------- 每格 ----------
  rtsTick(dt) {
    const R = this.rts;
    if (!R || !this.world) return;
    this.time += dt;
    this.missionT += dt;
    this.rtsSim(dt);
    this.fx.update(dt);
    this.tickPopups(dt);
    if (this.rtsFogTick) this.rtsFogTick(dt);
    // 親自駕駛中（E 包）：動作鏡頭＋動作 HUD＋RTS 小面板，不跑 RTS 鏡頭
    if (R.pilot && this.rtsPilotView) this.rtsPilotView(dt);
    else if (this.rtsCamUpdate) this.rtsCamUpdate(dt);
    else this.rtsCamFallback();
    SFX.setListener(this.camTarget);
    this.updateLoops();
    const gm = CORAL_GLOW();
    gm.emissiveIntensity = 1.35 + 0.45 * Math.sin(R.t * 2.2);
    this.renderMain();
    if (!this.rtsHudTick) this.hctx.clearRect(0, 0, innerWidth, innerHeight);
    if (R.over && !R.shown) {
      R.overT += dt;
      if (R.overT >= END_DELAY) this.rtsShowResult();
    }
  },
  // 模擬一格（不含鏡頭與算繪；冒煙測試可以直接呼叫來快轉）
  rtsSim(dt) {
    const R = this.rts;
    if (!R) return;
    const t0 = performance.now();
    R.t += dt;
    R.dt = dt; // 這一格的模擬時間（B 包的近戰等用）
    this.rtsPathService();
    this.lodTick();
    this.rtsHostileRebuild();
    const t1 = performance.now();
    // 親自駕駛的英雄（E 包：updatePlayer），之後的單位迴圈略過它
    if (R.pilot && this.rtsPilotStep) this.rtsPilotStep(dt);
    // 單位行為（updateAI → mech-rts.js 的 rtsUnitAI）；離鏡頭遠的分批更新（game.js 的 aiStep）
    R.logicMs = 0;
    const batch = this.aiBatchOn ? this.aiBatchOn() : false;
    // 每格輪流正向、反向（R.units 依生成順序，隊伍 0 的開局單位在前面：同一格先開火、先打倒對方的一直是同一隊，
    // 電腦對電腦時隊伍 0 的勝率明顯偏高；docs 13.18）
    const U = R.units,
      n = U.length,
      rev = (R.simN = (R.simN || 0) + 1) & 1;
    for (let i = 0; i < n; i++) {
      const e = U[rev ? n - 1 - i : i];
      // 運輸機上的乘員、rts-veer.js 駕駛的空投運輸機不跑單位 AI
      if (!e.dead && !e.bld && !e.rtsPiloted && !e.rtsAboard && !e.rtsDriven)
        this.aiStep ? this.aiStep(e, dt, batch) : e.updateAI(dt);
    }
    const t2 = performance.now();
    this.rtsSeparate();
    for (const e of R.units) if (!e.dead && !e.bld && !e.rtsAboard) R.hash.update(e, e.pos.x, e.pos.z);
    const t3 = performance.now();
    this.rtsBuildings(dt);
    this.rtsModsTick(dt);
    // 艾瑟立克（rts-grid.js）：導管的加成與臨時導管、融合的集合與引導
    if (this.rtsPowerTick) this.rtsPowerTick(dt);
    if (this.rtsFuseTick) this.rtsFuseTick(dt);
    // 維爾威（rts-veer.js）：空投、投放艙、集貨站、乘員、臨時信標、只剩收起的建築的揭露
    if (this.rtsVeerTick) this.rtsVeerTick(dt);
    // 其他包的每格（還沒實作時略過）：英雄（經驗、光環、復活）、中立（營地、商店補貨）、自動管家
    if (this.rtsHeroTick) this.rtsHeroTick(dt);
    if (this.rtsNeutralTick) this.rtsNeutralTick(dt);
    if (this.rtsButlerTick) this.rtsButlerTick(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt);
      if (p.dead) this.projectiles.splice(i, 1);
    }
    this.updateShocks(dt);
    this.updateSupport(dt);
    this.updateHazards(dt);
    this.rtsSweep(dt);
    this.rtsRecount();
    if (this.rtsAiTick) this.rtsAiTick(dt);
    R.endT -= dt;
    if (R.endT <= 0) {
      R.endT = 0.5;
      this.rtsCheckEnd();
    }
    // 耗時（毫秒，指數平均）：ai＝單位行為（含 move／動作），sep＝推擠＋空間索引，sim＝整格
    const k = 0.1;
    R.perf.ai += (t2 - t1 - R.perf.ai) * k;
    R.perf.sep = (R.perf.sep || 0) + (t3 - t2 - (R.perf.sep || 0)) * k;
    R.perf.sim += (performance.now() - t0 - R.perf.sim) * k;
    R.perf.logic = (R.perf.logic || 0) + (R.logicMs - (R.perf.logic || 0)) * k;
    R.perf.n = R.units.length;
  },
  // 單位之間的推擠：空間索引找鄰近的，兩兩推開（待命的讓路給移動中的；採集中的工人互相穿過，不塞車）
  rtsSeparate() {
    const R = this.rts;
    for (const a of R.units) {
      if (a.dead || a.bld || a.noPush || a.rtsAboard) continue;
      const near = R.hash.query(a.pos.x, a.pos.z, a.radius + 3, _q);
      const ag = a.orders[0] && a.orders[0].k === 'gather';
      for (let i = 0; i < near.length; i++) {
        const b = near[i];
        if (b === a || b.id < a.id || b.dead || b.bld || b.noPush) continue;
        if (ag && b.orders[0] && b.orders[0].k === 'gather' && a.rtsTeam === b.rtsTeam) continue;
        if (Math.abs(a.pos.y - b.pos.y) > 3) continue;
        // 空中單位依高度層分開：兩台都在飛、定義的飛行高度（hoverH）差 1 m 以上就不推擠（偵察無人機 6、直升機 7…）
        if (a.flying && b.flying && Math.abs(rtsLayer(a) - rtsLayer(b)) >= 1) continue;
        const dx = b.pos.x - a.pos.x,
          dz = b.pos.z - a.pos.z;
        let d = Math.hypot(dx, dz);
        const min = a.radius + b.radius + 0.2;
        if (d >= min) continue;
        if (d < 1e-4) d = 1e-4;
        const nx = dx / d,
          nz = dz / d,
          push = min - d;
        const wa = a.orders.length ? 0.35 : 1,
          wb = b.orders.length ? 0.35 : 1;
        const s = wa + wb;
        a.pos.x -= nx * push * (wa / s);
        a.pos.z -= nz * push * (wa / s);
        b.pos.x += nx * push * (wb / s);
        b.pos.z += nz * push * (wb / s);
        a.mesh.position.x = a.pos.x;
        a.mesh.position.z = a.pos.z;
        b.mesh.position.x = b.pos.x;
        b.mesh.position.z = b.pos.z;
      }
    }
  },
  // 建築：工地進度、生產佇列、Coral 產出
  rtsBuildings(dt) {
    const R = this.rts;
    const n = R.units.length,
      rev = (R.simN || 0) & 1; // 和單位一樣每格輪流方向（防禦塔先開火的不固定是同一隊）
    for (let i = 0; i < n; i++) {
      const b = R.units[rev ? n - 1 - i : i];
      if (!b || b.dead || !b.bld) continue;
      const B = b.bld,
        D = RTS_DEFS[b.rtsDef],
        T = R.teams[b.rtsTeam];
      if (B.progress < 1) {
        for (const w of B.builders) if (w.dead || w.rt.buildOn !== b) B.builders.delete(w);
        const n = B.builders.size;
        // 自己長的建築（艾瑟立克，docs 14.2）：不需要工人、斷電時不長；多派工人不會更快
        const self = !!D.selfBuild;
        if (self ? B.off : !n) continue;
        const dp = ((self ? 1 : 1 + RTS_BUILD_ASSIST * (n - 1)) / D.time) * dt;
        const p = Math.min(1, B.progress + dp);
        b.hp = Math.min(b.maxHp, b.hp + b.maxHp * 0.9 * (p - B.progress));
        B.progress = p;
        b.model.setProgress(p);
        if (p >= 1) {
          B.builders.clear();
          SFX.play('door', 0.6, 0.9, 0.05, 0.03, b.center());
          if (b.rtsTeam === ME && this.rtsEvent) this.rtsEvent(b.pos.x, b.pos.z, '建造完成：' + D.name);
          if (D.conduit && this.rtsPowerRebuild) this.rtsPowerRebuild(b.rtsTeam); // 新的供電源
        }
        continue;
      }
      // 機動建築（維爾威）：收起中、收好在飛、展開中——生產、研究、防禦塔都停止（佇列與計時保留）
      if (B.packed) {
        if (this.rtsPackStep) this.rtsPackStep(b, dt);
        continue;
      }
      // Coral：抽取站／汲取塔（蓋在湧出點上，消耗湧出點）；沒有 on 'coral' 的（研究中樞）自己產出
      if (D.coralRate) {
        if (D.on === 'coral') {
          if (B.vent && B.vent.amount > 0) {
            const n = Math.min(D.coralRate * dt, B.vent.amount);
            B.vent.amount -= n;
            T.coral += n * (T.income || 1);
            R.stats[b.rtsTeam].coral += n;
          }
        } else if (!B.off) {
          const n = D.coralRate * dt;
          T.coral += n * (T.income || 1);
          R.stats[b.rtsTeam].coral += n;
        }
      }
      // 停擺（導管斷電）：生產、研究、升級的計時暫停、防禦塔不開火（docs 14.2）
      if (B.off) {
        R.stats[b.rtsTeam].offT += dt;
        continue;
      }
      // 防禦塔、研究要塞化後的主堡（B 包的 rtsTowerAI）
      if (b.rtsTowerAI && this.rtsBldRange(b) > 0) b.rtsTowerAI(dt);
      // 生產、研究、升級（電磁脈衝 empT 期間暫停：C 包的 VEIL）
      const q = B.queue[0];
      if (!q || B.empT > R.t) continue;
      if (q.upg || q.res) {
        q.t += dt;
        if (q.t >= q.time) {
          B.queue.shift();
          if (q.upg) this.rtsUpgradeDone(b, q.id);
          else this.rtsResearchDone(b, q);
        }
        continue;
      }
      const U = RTS_DEFS[q.id];
      if (!U) {
        B.queue.shift();
        continue;
      }
      const pop = q.pop !== undefined ? q.pop : U.pop || 0;
      if (!q.on) {
        if (T.pop + pop > T.cap) {
          if (!q.warn && b.rtsTeam === ME) {
            q.warn = true;
            this.rtsSay(T.cap >= RTS_POP_MAX ? '人口已達上限' : '人口不足 — 蓋補給庫');
          }
          continue;
        }
        q.on = true;
        T.pop += pop;
      }
      q.t += dt;
      if (q.t >= (q.time !== undefined ? q.time : U.time)) {
        B.queue.shift();
        this.rtsTrained(b, q.id, q);
      }
    }
  },
  // 生產完成：在建築正面出來，前往集結點（點了礦脈的集結點：工人自動採集）；工人沒有集結點時自動去採最近的礦
  // q＝佇列項目（英雄：C 包的 rtsHeroSpawned(e, q) 套回等級與道具；q.revive＝復活）
  // 定義 dropIn 的單位（維爾威的軌道調度所，docs 15.2）改成投放艙（rts-veer.js 的 rtsDropUnit）
  rtsTrained(b, id, q = null) {
    const D = RTS_DEFS[id],
      nav = this.world.nav;
    if (D.dropIn && this.rtsDropUnit) return this.rtsDropUnit(b, id, q);
    const B = b.bld;
    const fx = Math.sin(b.yaw),
      fz = Math.cos(b.yaw);
    const r = Math.max(B.w, B.d) / 2 + 2.5;
    let x = b.pos.x + fx * r,
      z = b.pos.z + fz * r;
    const rl = B.rally;
    if (rl) {
      // 從離集結點最近的一側出來
      const a = Math.atan2(rl.z - b.pos.z, rl.x - b.pos.x);
      x = b.pos.x + Math.cos(a) * r;
      z = b.pos.z + Math.sin(a) * r;
    }
    const c = nav.nearestCell(x, z, D.size || 0, -1, 10);
    if (c >= 0) ({ x, z } = nav.center(c));
    const u = this.rtsSpawn(b.rtsTeam, id, x, z, Math.atan2(-(x - b.pos.x), -(z - b.pos.z)) + Math.PI);
    if (!u) return;
    if (D.hero && this.rtsHeroSpawned) this.rtsHeroSpawned(u, q || { id });
    this.rtsRallyUnit(b, u, D, rl);
    if (b.rtsTeam === ME && this.rtsEvent && !D.worker) this.rtsEvent(u.pos.x, u.pos.z, '');
  },
  // 剛生產（或投放艙落地）的單位前往集結點 rl（rtsTrained、rts-veer.js 的投放艙共用；b 可以是 null）
  rtsRallyUnit(b, u, D, rl) {
    const x = u.pos.x,
      z = u.pos.z;
    const m =
      rl && rl.mine
        ? this.rtsMine(rl.mine)
        : rl && D.worker
          ? this.rtsMineAt(rl.x, rl.z, RTS_GATHER.mineR + 2)
          : null;
    if (D.worker && m && m.amount > 0) u.orders = [{ k: 'gather', mine: m.id }];
    else if (rl && rl.id !== undefined && this.rtsEnt(rl.id) && !this.rtsEnt(rl.id).dead)
      this.rtsSmart([u], rl.x, rl.z, this.rtsEnt(rl.id));
    else if (rl) u.orders = [{ k: 'move', x: rl.x, z: rl.z }];
    else if (D.worker && b) {
      const n = this.rtsNearestMine(x, z, b.rtsTeam, null, true) || this.rtsNearestMine(x, z, b.rtsTeam);
      if (n && Math.hypot(n.pos.x - x, n.pos.z - z) < 60) u.orders = [{ k: 'gather', mine: n.id }];
    }
  },
  // 死亡（mech-rts.js 的 rtsDie 呼叫）：統計、建築倒塌、解除碰撞與導航佔用
  rtsOnDeath(e, from) {
    const R = this.rts,
      w = this.world;
    if (!R) return;
    // 其他包：英雄的經驗、野怪的掉寶、英雄陣亡（C、D）
    if (!e.rtsQuiet) {
      if (this.rtsXpOnKill) this.rtsXpOnKill(e, from);
      if (this.rtsLootOnKill) this.rtsLootOnKill(e, from);
    }
    if (e.hero && this.rtsHeroDied) this.rtsHeroDied(e);
    // 維爾威（rts-veer.js）：空投運輸機被擊落（退 50%）、運輸機墜毀（乘員彈出）、信標被摧毀、集貨站的庫存
    if (this.rtsVeerOnDeath) this.rtsVeerOnDeath(e, from);
    const c = e.center();
    if (!e.rtsQuiet) {
      R.stats[e.rtsTeam].lost++;
      if (from && from.rtsTeam !== undefined && from.rtsTeam !== e.rtsTeam) R.stats[from.rtsTeam].killed++;
    }
    if (e.rtsQuiet && !e.bld) {
      // 不演出（取消、測試的清場）
      e.mesh.visible = false;
      e.rtsCleanT = 0;
      return;
    }
    if (e.bld) {
      const B = e.bld;
      if (e.rtsOb) {
        const i = w.obstacles.indexOf(e.rtsOb);
        if (i >= 0) w.obstacles.splice(i, 1);
        w.nav.block(e.pos.x, e.pos.z, B.w, B.d, 0, false);
        e.rtsOb = null;
      }
      if (B.vent && B.vent.ext === e) B.vent.ext = null;
      // 供電源被拆：後面的節點與建築可能斷電（docs 14.2）
      if (RTS_DEFS[e.rtsDef] && RTS_DEFS[e.rtsDef].conduit && this.rtsPowerRebuild)
        this.rtsPowerRebuild(e.rtsTeam);
      for (const q of B.queue) {
        if (q.res && R.teams[e.rtsTeam]) delete R.teams[e.rtsTeam].tech.busy[q.id]; // 研究中被拆：取消
        if (e.rtsQuiet) this.rtsRefund(e.rtsTeam, q.cost || (RTS_DEFS[q.id] || {}).cost || {}, 1);
      }
      B.queue = [];
      if (e.rtsQuiet) {
        e.mesh.visible = false;
        e.rtsCleanT = 0;
        return;
      }
      // 倒塌：佔地上的連續爆炸、煙，本體往下沉
      const D = RTS_DEFS[e.rtsDef];
      const y0 = e.mesh.position.y;
      let k = 0;
      const n = Math.max(3, Math.round((B.w * B.d) / 40));
      this.fx.task(2.4, (q, t) => {
        if (t * n * 1.6 > k && k < n) {
          k++;
          const p = new THREE.Vector3(
            e.pos.x + (Math.random() - 0.5) * B.w * 0.8,
            e.pos.y + Math.random() * D.height * 0.7,
            e.pos.z + (Math.random() - 0.5) * B.d * 0.8,
          );
          this.fx.explosion(p, 3 + Math.random() * 3, 0xffa040, k === 1);
          this.fx.smoke(p, 2.2, 0x4a4a4e, 2.5, 3);
        }
        e.mesh.position.y = y0 - t * t * D.height * 0.9;
        e.mesh.rotation.z = Math.sin(t * 9) * 0.02 * t;
        if (t >= 0.999) e.rtsCleanT = 0;
      });
      e.rtsCleanT = 3;
      SFX.explode('huge', c);
      SFX.wreck(c);
      this.fx.dust(
        new THREE.Vector3(e.pos.x, e.pos.y + 0.3, e.pos.z),
        Math.max(B.w, B.d) * 0.5,
        14,
        0x8a8070,
      );
      this.fx.killBurst(c, Math.max(B.w, B.d) / 8, true, e.pos.y);
    } else {
      this.fx.shatter(e, w);
      if (this.rtsFxOk(c)) this.fx.killBurst(c, e.scale || 1, false, w.groundAt(c.x, c.z, c.y));
      e.mesh.visible = false;
      SFX.explode(true, c);
      SFX.wreck(c);
      e.rtsCleanT = 0;
    }
  },
  // 清掉死掉的實體（建築等倒塌演出結束）
  // dt＝模擬這一格的時間（不用主迴圈的 lastDt：冒煙測試以 rtsSim 快轉時它是實際時間，結果會依負載不同）
  rtsSweep(dt) {
    const R = this.rts;
    let any = false;
    for (const e of R.units) {
      if (!e.dead) continue;
      if (!e.rtsGone) {
        e.rtsGone = true;
        R.hash.remove(e);
        R.byId.delete(e.id);
        for (const L of [this.enemies, this.allies]) {
          const i = L.indexOf(e);
          if (i >= 0) L.splice(i, 1);
        }
      }
      if (e.rtsCleanT === undefined) e.rtsCleanT = 0;
      if (e.rtsCleanT > 0) {
        e.rtsCleanT -= dt || 0.016;
        continue;
      }
      e.cleanup();
      e.rtsSwept = true;
      any = true;
    }
    if (any) R.units = R.units.filter((e) => !e.rtsSwept);
  },
  // 勝敗：一方的建築全毀（含工地）
  rtsCheckEnd() {
    const R = this.rts;
    if (R.over) return;
    for (const T of R.teams)
      if (!T.neutral) T.alive = R.units.some((e) => !e.dead && e.bld && e.rtsTeam === T.id);
    if (!R.teams[ME].alive) this.rtsEnd(false);
    else if (R.teams.every((T) => T.id === ME || T.neutral || !T.alive)) this.rtsEnd(true);
  },
  rtsEnd(win) {
    const R = this.rts;
    if (!R || R.over) return;
    R.over = { win: !!win, t: R.t };
    R.overT = 0;
    if (!R.cfg.aiBoth) {
      // 兩邊都是電腦（測試）不記戰績；鍵＝實際的陣營組合與難度（docs 14.7）
      const recs = loadRec();
      const k = recKey(R.teams[ME].faction, R.teams[1].faction, R.cfg.diff);
      const rec = recs[k] || (recs[k] = { w: 0, l: 0 });
      if (win) rec.w++;
      else rec.l++;
      saveJson(REC_KEY, recs);
    }
    SFX.cue('exit');
    const sub = win ? '敵方基地全毀' : '我方基地全毀';
    if (
      !this.tfx(win ? 'done' : 'warn', win ? '勝利' : '敗北', sub, {
        states: ['rts', 'rtsend'],
        freeze: ['pause'],
      })
    )
      this.rtsSay((win ? '勝利 — ' : '敗北 — ') + sub, win ? 0x7ee081 : 0xff4d4d);
  },
  rtsShowResult() {
    const R = this.rts;
    R.shown = true;
    if (this.rtsHudHide) this.rtsHudHide();
    this.state = 'rtsend';
    this.showScreen('rtsEnd');
    const el = document.getElementById('rtsEnd');
    const S = R.stats;
    const row = (name, a, b) => `<tr><td>${name}</td><td>${a}</td><td>${b}</td></tr>`;
    const facTxt = (i) =>
      escHtml(facName(R.teams[i].faction) + (R.cfg.rand && R.cfg.rand[i] ? '（隨機）' : ''));
    el.innerHTML = `
      <div class="panel" style="min-width: 340px">
        <h2 id="rtsEndTitle" style="color:${R.over.win ? '#7ee081' : '#ff6a5a'}">${R.over.win ? '勝利' : '敗北'}</h2>
        <p class="dim">作戰時間 ${fmtT(R.over.t)}</p>
        <table class="rtsEndTbl">
          <tr><th></th><th>你</th><th>電腦</th></tr>
          ${row('陣營', facTxt(ME), facTxt(1))}
          ${row('生產的單位', S[0].made, S[1].made)}
          ${row('建造的建築', S[0].blds, S[1].blds)}
          ${row('擊破', S[0].killed, S[1].killed)}
          ${row('損失', S[0].lost, S[1].lost)}
          ${row('採集的礦石', Math.round(S[0].ore), Math.round(S[1].ore))}
          ${row('抽取的 Coral', Math.round(S[0].coral), Math.round(S[1].coral))}
          ${S[0].fused || S[1].fused ? row('融合用掉的單位', S[0].fused, S[1].fused) : ''}
          ${S[0].drops || S[1].drops || S[0].dropLost || S[1].dropLost ? row('空投（成功／被擊落）', `${S[0].drops}／${S[0].dropLost}`, `${S[1].drops}／${S[1].dropLost}`) : ''}
        </table>
        <div class="row">
          <button type="button" class="primary" id="rtsEndMenu">回 Coral 戰爭選單</button>
          <button type="button" id="rtsEndTitleBtn">回標題</button>
        </div>
      </div>`;
    document.getElementById('rtsEndMenu').onclick = () => this.rtsMenuOpen();
    document.getElementById('rtsEndTitleBtn').onclick = () => {
      this.clearMission();
      this.state = 'title';
      this.showScreen('title');
    };
  },
  // 暫停（Esc、HUD 的選單按鈕）；暫停選單的「放棄」＝回 Coral 戰爭選單
  rtsPause() {
    if (this.state !== 'rts') return;
    this.state = 'pause';
    this.showScreen('pause');
  },
  rtsAbort() {
    this.rtsMenuOpen();
  },
  // 離開 RTS（clearMission 呼叫）：輸入、迷霧、3D 物件、畫面設定
  rtsClear() {
    const R = this.rts;
    if (!R) return;
    // 其他包的清理（還沒實作時略過）：親自駕駛、中立、英雄
    if (this.rtsPilotExit && R.pilot) this.rtsPilotExit('clear');
    if (this.rtsNeutralClear) this.rtsNeutralClear();
    if (this.rtsHeroClear) this.rtsHeroClear();
    if (this.rtsInputClear) this.rtsInputClear();
    if (this.rtsFogClear) this.rtsFogClear();
    if (this.rtsAiClear) this.rtsAiClear();
    if (this.rtsHudHide) this.rtsHudHide();
    this.scene.remove(R.g);
    if (this.setRtsRender) this.setRtsRender(false);
    else if (this.setLowFx) this.setLowFx(null);
    this.camExtra = 0;
    this.camera.far = 400;
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('rtsOn');
    this.rts = null;
  },
  // 沒有輸入模組時的鏡頭：從斜上方看自己的主堡
  rtsCamFallback() {
    const R = this.rts;
    if (!R.cam) {
      const b = R.units.find((e) => e.rtsTeam === ME && e.bld) || { pos: new THREE.Vector3() };
      R.cam = { x: b.pos.x, z: b.pos.z, yaw: 0, pitch: 0.96, dist: 95 };
    }
    const C = R.cam,
      cam = this.camera;
    const gy = this.world.terrainHeight(C.x, C.z);
    const cp = Math.cos(C.pitch);
    cam.position.set(
      C.x + Math.sin(C.yaw) * cp * C.dist,
      gy + Math.sin(C.pitch) * C.dist,
      C.z + Math.cos(C.yaw) * cp * C.dist,
    );
    cam.lookAt(C.x, gy, C.z);
    this.camTarget.set(C.x, gy, C.z);
    this.sun.position.copy(this.camTarget).add(this.sunOff);
    this.sun.target.position.copy(this.camTarget);
    void clamp;
  },
});
