// Game：主線機庫的模擬器與作戰紀錄（docs/campaign-design.md 第 6、7.3、8 節）
// 模擬器：在模擬訓練場（grid）裡重現遇過的敵人、宿敵 AC 與 Boss，加上教官 INSTRUCTOR 的考核（通過解鎖零件）；
//         不寫進度、不給報酬（考核除外）。遇過的記在 save.story.seen＝{ foes, aces, bosses }。
// 作戰紀錄：重打完成過的委託，可以加上危險條款（報酬倍率提高），戰術模組從零開始、不影響這一章持有的。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SORTIES } from '../data/campaign.js';
import { AC_ROSTER, BOSS_DEFS, ENEMY_TYPES } from '../data/enemies.js';
import { ACES, FOES } from '../data/foes.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

// 危險條款：k＝報酬加成
const HEAT = {
  shield: { name: '敵人強化', desc: '敵人 AP ×1.35', k: 0.25 },
  p2: { name: 'Boss 第二型態', desc: 'Boss 一開始就是第二型態', k: 0.25 },
  timed: { name: '限時作戰', desc: '25 分鐘內完成，超過就失敗', k: 0.2 },
  nosupply: { name: '補給中斷', desc: '沒有補給區段', k: 0.15 },
};
const INSTRUCTOR = {
  name: 'INSTRUCTOR',
  pal: 'duelist',
  ai: 'duelist',
  wantDist: 10,
  hpMul: 1.6,
  dmgMul: 0.6,
  stabMul: 1.4,
  speedMul: 1.05,
  asm: {
    head: 'h_std',
    core: 'c_std',
    arms: 'a_std',
    legs: 'l_bp',
    booster: 'b_hi',
    generator: 'g_hi',
    fcs: 'f_std',
    rarm: 'w_rifle',
    larm: 'w_blade',
    rback: 'bw_ms',
    lback: 'bw_none',
  },
};
const INSTRUCTOR_PRIZE = 'w_saber'; // 考核通過解鎖的零件

Object.assign(Game.prototype, {
  simSeen() {
    const st = this.campStory();
    if (!st.seen2 || typeof st.seen2 !== 'object') st.seen2 = { foes: {}, aces: {}, bosses: {} };
    return st.seen2;
  },
  simMark(kind, key) {
    const s = this.simSeen();
    if (!s[kind][key]) {
      s[kind][key] = 1;
      this.writeSave();
    }
  },
  // ---------- 模擬器畫面 ----------
  openSim() {
    SFX.ui();
    this.state = 'sim';
    this.showScreen('simMenu');
    const s = this.simSeen();
    const row = (kind, key, name, note) =>
      `<button class="simItem" data-k="${kind}" data-key="${escHtml(key)}"><b>${escHtml(name)}</b><span class="dim">${escHtml(note)}</span></button>`;
    let h = '<h3>考核</h3>';
    h += row(
      'instructor',
      'instructor',
      '教官 INSTRUCTOR 的考核',
      this.campStory().instructor ? '已通過（可以再挑戰）' : '通過解鎖零件',
    );
    h += '<h3>敵人練習</h3>';
    const foes = Object.keys(s.foes);
    h += foes.length
      ? foes.map((k) => row('foe', k, FOES[k].name, '主線遇過的專屬敵人')).join('')
      : '<p class="dim">主線遇到專屬敵人後，這裡就能練習。</p>';
    h += row('foe', 'mixed', '一般敵人混合編隊', '各種一般敵人');
    h += '<h3>宿敵再戰</h3>';
    const aces = Object.keys(s.aces);
    h += aces.length
      ? aces.map((k) => row('ace', k, ACES[k].name, ACES[k].intro)).join('')
      : '<p class="dim">主線遇到宿敵 AC 後，這裡就能再戰。</p>';
    h += '<h3>Boss 練習</h3>';
    const bosses = Object.keys(s.bosses);
    h += bosses.length
      ? bosses
          .map((k) =>
            row('boss', k, (BOSS_DEFS.find((b) => b.kind === k) || { name: k }).name, '主線打過的 Boss'),
          )
          .join('')
      : '<p class="dim">主線打過 Boss 後，這裡就能練習。</p>';
    const el = document.getElementById('simList');
    el.innerHTML = h;
    for (const b of el.querySelectorAll('.simItem'))
      b.onclick = () => this.simStart(b.dataset.k, b.dataset.key);
  },
  // ---------- 模擬戰 ----------
  simStart(kind, key) {
    SFX.ui();
    this.clearMission();
    this.camp = null;
    this.sim = { kind, key };
    const L = Math.max(2, this.save.level);
    const seed = Math.floor(Math.random() * 1e9);
    this.worldSeed = seed;
    this.worldTheme = 'grid';
    this.styleRefresh();
    this.world = new World(this.scene, 'grid', seed, L, null, { zone: kind === 'boss' ? 'full' : 'arena' });
    this.isClient = false;
    this.net.spawnReg = {};
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    this.player = new MechEntity(this, this.save.asm, PALETTES.player, {
      team: 'player',
      name: 'RAVEN',
      palKey: 'player',
      slot: 0,
      pilot: this.pilotLocalMods('pve'),
    });
    this.player.pos.set(0, this.world.terrainHeight(0, 0), 0);
    this.players = [this.player];
    this.mpStats = { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } };
    this.enemies = [];
    this.waves = [];
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.bossDef = null;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.isBossLevel = kind === 'boss';
    const sh = 1 + (L - 1) * 0.09,
      sd = 1 + (L - 1) * 0.06;
    this.scaleHp = sh;
    this.scaleDmg = sd;
    document.getElementById('bossBar').style.display = 'none';
    if (kind === 'instructor' || kind === 'ace') {
      const r = kind === 'ace' ? ACES[key] : INSTRUCTOR;
      const e = this.spawnEnemy({
        name: r.name,
        asm: r.asm || this.foeRandomAsm(),
        pal: r.pal,
        scale: 1,
        hpMul: r.hpMul * sh,
        dmgMul: r.dmgMul * sd,
        stabMul: r.stabMul,
        ai: r.ai,
        wantDist: r.wantDist,
        speedMul: r.speedMul,
      });
      this.bosses = [e];
      document.getElementById('bossBar').style.display = 'block';
      document.getElementById('bossName').textContent = r.name;
    } else if (kind === 'boss') {
      const bd = BOSS_DEFS.find((b) => b.kind === key);
      if (bd) {
        this.spawnBossDef(bd, sh, sd);
        document.getElementById('bossBar').style.display = 'block';
        document.getElementById('bossName').textContent = bd.name;
      }
      this.waves = [];
    } else if (key === 'mixed') this.spawnComp(this.rollComp(L, 1), 1, sh, sd);
    else for (let i = 0; i < 2; i++) this.spawnType(key, sh, sd);
    this.levelName = '模擬訓練場（模擬戰）';
    this.waveAlerted = false;
    this.vehPlan = [];
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.fp = false;
    this.fpShow();
    if (this.ctrl.view === 'fps') this.setFp(true);
    this.flashMsg('模擬戰開始 — 不消耗、不記錄進度', 0x7fc8ff, 2.2);
  },
  // 結束模擬戰（ok＝全滅敵人）：考核通過時解鎖零件
  simEnd(ok) {
    const sim = this.sim;
    if (!sim) return;
    this.sim = null;
    const $ = (id) => document.getElementById(id);
    let prize = '';
    if (ok && sim.kind === 'instructor') {
      const st = this.campStory();
      if (!st.instructor) {
        st.instructor = 1;
        if (!this.save.owned.includes(INSTRUCTOR_PRIZE)) this.save.owned.push(INSTRUCTOR_PRIZE);
        this.save.coam += 20000;
        prize = '考核通過：解鎖零件 LS-70 光束大劍、COAM +20,000';
      } else prize = '考核通過（已經領過獎勵）';
      this.writeSave();
    }
    const t = this.missionT;
    this.clearMission();
    this.state = 'result';
    this.pilotRenderResult(null);
    $('rTitle').textContent = ok ? '模擬戰 完成' : '模擬戰 結束';
    $('rRank').textContent = ok ? '—' : '—';
    $('rRank').style.color = '#8a97a6';
    const rows = [
      ['模擬', sim.kind === 'instructor' ? '教官考核' : sim.kind],
      ['時間', t.toFixed(1) + ' s'],
    ];
    if (prize) rows.push(['獎勵', prize]);
    $('resultGrid').innerHTML = rows
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    $('btnResultOk').textContent = '返回機庫';
    this.campResultHub = true;
    this.showScreen('result');
  },
  // RUST：每次出現的組裝都不同（從具名 AC 的組裝挑一套，再換一把右手武器）
  foeRandomAsm() {
    const ks = Object.keys(AC_ROSTER);
    const a = { ...AC_ROSTER[ks[Math.floor(Math.random() * ks.length)]].asm };
    const arms = ['w_rifle', 'w_mg', 'w_sg', 'w_bz', 'w_hg', 'w_lr'];
    a.rarm = arms[Math.floor(Math.random() * arms.length)];
    return a;
  },
  // ---------- 作戰紀錄（重打＋危險條款） ----------
  openRecord() {
    SFX.ui();
    this.state = 'record';
    this.showScreen('record');
    const st = this.campStory();
    const done = Object.keys(SORTIES).filter((sid) => st.done[sid]);
    const el = document.getElementById('recList');
    el.innerHTML = done.length
      ? done
          .map(
            (sid) =>
              `<label class="recRow"><input type="radio" name="recSid" value="${sid}"> ${escHtml(SORTIES[sid].name)}<span class="dim">　完成 ${st.done[sid]} 次</span></label>`,
          )
          .join('')
      : '<p class="dim">完成過的委託會出現在這裡。</p>';
    document.getElementById('recHeat').innerHTML = Object.keys(HEAT)
      .map(
        (k) =>
          `<label class="recRow"><input type="checkbox" data-h="${k}"> <b>${escHtml(HEAT[k].name)}</b><span class="dim">　${escHtml(HEAT[k].desc)}（報酬 +${Math.round(HEAT[k].k * 100)}%）</span></label>`,
      )
      .join('');
    const first = el.querySelector('input');
    if (first) first.checked = true;
    document.getElementById('btnRecGo').disabled = !done.length;
  },
  recordGo() {
    const sel = document.querySelector('#recList input:checked');
    if (!sel) return;
    const heat = {};
    for (const c of document.querySelectorAll('#recHeat input:checked')) heat[c.dataset.h] = true;
    const st = this.campStory();
    if (st.sortie && !confirm('目前有進行中的出擊，開始重打會放棄它的紀錄點。確定？')) return;
    st.sortie = null;
    this.campBegin(sel.value, { replay: true, heat });
  },
  // 危險條款的報酬倍率
  heatMul(heat) {
    let k = 1;
    for (const h in heat || {}) if (HEAT[h]) k += HEAT[h].k;
    return k;
  },
  heatNames(heat) {
    return Object.keys(heat || {})
      .filter((h) => HEAT[h])
      .map((h) => HEAT[h].name);
  },
  // 一般敵人的種類（模擬器的混合編隊不包含主題專屬敵人）
  simEnemyKeys() {
    return Object.keys(ENEMY_TYPES);
  },
});
