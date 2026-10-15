import { ATTRS, ATTR_KEYS, weakText } from '../data/attrs.js';
// Game：機甲庫的靶場（像《機戰傭兵6》的 AC TEST）——選目標、行為與距離，量測輸出（DPS、命中率、失衡、擊破時間）
// 與承受（受傷、防禦擋下的量、還能撐幾秒）；不寫進度、不給報酬。轉場整備時也能進（主線的狀態先收起來，離開時放回）。
// 機甲庫的理論火力（每把武器的 DPS、有效 AP、換零件的差異）與靶場紀錄也在這裡。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { AC_ROSTER, BOSS_DEFS, ENEMY_TYPES, FOE_HP_K, enemyScale } from '../data/enemies.js';
import { effectiveAp, estHit, weaponDps } from '../data/firepower.js';
import { ACES, FOES } from '../data/foes.js';
import { FIST_DEF, FOE_STAB_K, PARTS, START_ASM, asmStats, assistSpread, usesAmmo } from '../data/parts.js';
import { applyPilotStats, pilotWeaponDef } from '../data/pilot.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const CFG_KEY = 'rubicon_range';
const LOG_KEY = 'rubicon_range_log';
const LOG_MAX = 12;
const WIN = 5; // 「最近 5 秒」的 DPS
const BEH = { static: '靜止', strafe: '橫移', turret: '原地開火', ai: '完整 AI' };
const NO_TYPES = ['dropship', 'ac']; // 運輸機會飛走、ac 是隨機的敵對 AC（另外列）
const WSLOTS = ['rarm', 'larm', 'rback', 'lback'];
const SLOT_NAMES = { rarm: '右手', larm: '左手', rback: '右肩', lback: '左肩' };
const lsGet = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch {
    return d;
  }
};
const lsSet = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 私密視窗等：只是不記住 */
  }
};
const fmt = (v) => Math.round(v).toLocaleString();
const wName = (id) => {
  if (!id) return '其他';
  if (id === FIST_DEF.id) return FIST_DEF.name;
  const p = [...PARTS.arm, ...PARTS.back].find((x) => x.id === id);
  return p ? p.name : id;
};

Object.assign(Game.prototype, {
  // ---------- 設定 ----------
  rangeCfgGet() {
    const d = {
      tgt: 'dummy',
      beh: 'static',
      dist: 30,
      n: 1,
      lv: Math.max(1, this.save.level || 1),
      inf: true,
      god: false,
      pm: true,
      ammo: true,
    };
    if (!this.rangeCfg) this.rangeCfg = { ...d, ...lsGet(CFG_KEY, {}) };
    return this.rangeCfg;
  },
  // 加成開關（機甲庫的理論值也跟著它）
  rangePmOn() {
    return this.rangeCfgGet().pm !== false;
  },
  // 玩家機體的加成：駕駛員（PvE）＋主線的戰術模組
  rangePm() {
    if (!this.rangePmOn()) return null;
    const camp = this.camp || (this.range && this.range.camp);
    if (camp) {
      const c0 = this.camp;
      this.camp = camp;
      const pm = this.campPilotPm();
      this.camp = c0;
      return pm;
    }
    return this.pilotLocalMods('pve');
  },
  // 可以選的目標：標準靶、一般敵人與敵對 AC 全部；專屬敵人、宿敵、Boss 要主線遇過
  rangeTargets() {
    const seen = this.simSeen();
    const g = [['標準', [['dummy', '標準靶（AC 型，不還手）']]]];
    g.push([
      '一般敵人',
      Object.keys(ENEMY_TYPES)
        .filter((k) => !NO_TYPES.includes(k))
        .map((k) => ['type:' + k, ENEMY_TYPES[k].name]),
    ]);
    g.push([
      '敵對 AC',
      Object.keys(AC_ROSTER)
        .filter((k) => AC_ROSTER[k].asm)
        .map((k) => ['ac:' + k, AC_ROSTER[k].name]),
    ]);
    const foes = Object.keys(seen.foes).filter((k) => FOES[k] && !FOES[k].spawnOnly);
    if (foes.length) g.push(['專屬敵人（主線遇過）', foes.map((k) => ['type:' + k, FOES[k].name])]);
    const aces = Object.keys(seen.aces).filter((k) => ACES[k]);
    if (aces.length) g.push(['宿敵 AC（主線遇過）', aces.map((k) => ['ace:' + k, ACES[k].name])]);
    const bosses = Object.keys(seen.bosses)
      .map((k) => BOSS_DEFS.find((b) => b.kind === k))
      .filter(Boolean);
    if (bosses.length) g.push(['Boss（主線打過）', bosses.map((b) => ['boss:' + b.kind, b.name])]);
    return g;
  },
  rangeTgtName(tgt) {
    for (const [, list] of this.rangeTargets()) for (const [k, n] of list) if (k === tgt) return n;
    return '標準靶';
  },
  // ---------- 設定畫面（機甲庫進來＝畫面；靶場裡＝暫停中的覆蓋） ----------
  openRangeMenu() {
    if (this.net && this.net.role) return;
    SFX.ui();
    const cfg = this.rangeCfgGet();
    const $ = (id) => document.getElementById(id);
    const inRange = !!this.range;
    if (inRange) {
      this.rangePrev = this.state;
      this.state = 'rangecfg';
    } else this.state = 'rangemenu';
    this.showScreen('rangeMenu');
    let ok = false;
    $('rgTgt').innerHTML = this.rangeTargets()
      .map(
        ([grp, list]) =>
          `<optgroup label="${escHtml(grp)}">${list
            .map(([k, n]) => {
              if (k === cfg.tgt) ok = true;
              return `<option value="${escHtml(k)}">${escHtml(n)}</option>`;
            })
            .join('')}</optgroup>`,
      )
      .join('');
    $('rgTgt').value = ok ? cfg.tgt : 'dummy';
    $('rgBeh').value = cfg.beh;
    $('rgDist').value = String(cfg.dist);
    $('rgN').value = String(cfg.n);
    $('rgLv').value = String(cfg.lv);
    $('rgInf').checked = cfg.inf;
    $('rgGod').checked = cfg.god;
    $('rgPm').checked = cfg.pm;
    $('rgAmmo').checked = cfg.ammo;
    const upd = () => {
      const boss = $('rgTgt').value.startsWith('boss:');
      $('rgBeh').disabled = boss;
      $('rgN').disabled = boss;
      $('rgDist').disabled = boss;
      $('rgNote').textContent = boss ? 'Boss 只能用完整 AI，位置照 Boss 關的配置。' : '';
    };
    $('rgTgt').onchange = upd;
    upd();
    $('btnRangeGo').textContent = inRange ? '套用並重新開始' : '進入靶場';
    $('btnRangeBack').textContent = inRange ? '返回靶場' : '返回機甲庫';
  },
  rangeReadCfg() {
    const $ = (id) => document.getElementById(id);
    const cfg = this.rangeCfgGet();
    cfg.tgt = $('rgTgt').value || 'dummy';
    cfg.beh = $('rgBeh').value;
    cfg.dist = Number($('rgDist').value) || 30;
    cfg.n = Number($('rgN').value) || 1;
    cfg.lv = Math.max(1, Math.min(60, Math.round(Number($('rgLv').value) || 1)));
    cfg.inf = $('rgInf').checked;
    cfg.god = $('rgGod').checked;
    cfg.pm = $('rgPm').checked;
    cfg.ammo = $('rgAmmo').checked;
    lsSet(CFG_KEY, cfg);
    return cfg;
  },
  rangeMenuGo() {
    if (this.range) this.rangeLogSave(); // 先記下這一段（還是舊的設定）
    this.rangeReadCfg();
    SFX.ui();
    this.rangeStart();
  },
  rangeMenuBack() {
    SFX.ui();
    if (this.range) {
      this.state = 'play';
      this.showScreen('');
      this.lastT = performance.now();
      return;
    }
    this.openGarage();
  },
  // ---------- 開始／離開 ----------
  rangeStart() {
    const cfg = this.rangeCfgGet();
    const camp = this.range ? this.range.camp : this.camp; // 轉場整備：主線的狀態先收起來
    this.camp = null;
    this.clearMission();
    this.range = { camp, clock: 0, st: this.rangeNewStats(), respT: 0, uiT: 0, fire: null };
    const seed = Math.floor(Math.random() * 1e9);
    this.worldSeed = seed;
    this.worldTheme = 'grid';
    this.styleRefresh();
    this.world = new World(this.scene, 'grid', seed, cfg.lv, null, { zone: 'full' });
    this.isClient = false;
    this.net.spawnReg = {};
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    this.rangeSpawnPlayer();
    this.mpStats = { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } };
    this.enemies = [];
    this.waves = [];
    this.wavePend = null;
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.bossDef = null;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.vehPlan = [];
    this.waveAlerted = false;
    this.isBossLevel = cfg.tgt.startsWith('boss:');
    const sc = enemyScale(cfg.lv, 1);
    this.scaleHp = sc.hp;
    this.scaleDmg = sc.dmg;
    document.getElementById('bossBar').style.display = 'none';
    this.rangeSpawnTargets();
    this.levelName = `靶場：${this.rangeTgtName(cfg.tgt)}`;
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.viewReset();
    document.getElementById('btnAbort').textContent = '離開靶場（回機甲庫）';
    document.getElementById('rangePanel').style.display = '';
    // 手機橫式：面板預設收合（只留 DPS 與命中率）
    if (this.rangeMini === undefined) this.rangeMini = this.vpadWanted() && innerHeight <= 540;
    this.flashMsg(
      this.vpadWanted() ? '靶場 — 面板上的按鈕：目標設定、重置數據' : '靶場 — T：目標設定　Y：重置數據',
      0x7fc8ff,
      3,
    );
  },
  // 射擊道：找一條沒有障礙物的長方形（寬 36 m、長＝距離＋24 m），玩家站在一端、目標在另一端
  rangeLane() {
    const r = this.range;
    if (r.lane) return r.lane;
    const cfg = this.rangeCfgGet(),
      W = this.world;
    const len = cfg.dist + 24,
      half = 18;
    const free = (cx, cz, dx, dz) => {
      const px = -dz,
        pz = dx;
      // 四個角都在場內
      for (const [u, v] of [
        [-12, -half],
        [-12, half],
        [len - 12, -half],
        [len - 12, half],
      ]) {
        const x = cx + dx * u + px * v,
          z = cz + dz * u + pz * v;
        if (Math.abs(x) > W.lim - 6 || Math.abs(z) > W.lim - 6 || W.isVoid(x, z)) return false;
      }
      // 沒有碰到障礙物
      for (const o of W.obstacles) {
        const ox = o.x - cx,
          oz = o.z - cz;
        const u = ox * dx + oz * dz,
          v = ox * px + oz * pz;
        const ext = o.w !== undefined ? Math.hypot(o.w, o.d || o.w) / 2 : o.r || 1; // 箱形、平台用長寬，圓柱用半徑
        if (u > -12 - ext && u < len - 12 + ext && Math.abs(v) < half + ext) return false;
      }
      return true;
    };
    const dirs = [
      [0, -1],
      [0, 1],
      [1, 0],
      [-1, 0],
    ];
    for (let t = 0; t < 400; t++) {
      const [dx, dz] = dirs[t % 4];
      const cx = t ? (Math.random() * 2 - 1) * W.lim * 0.6 : -dx * (len / 2 - 12),
        cz = t ? (Math.random() * 2 - 1) * W.lim * 0.6 : -dz * (len / 2 - 12);
      if (free(cx, cz, dx, dz)) return (r.lane = { x: cx, z: cz, dx, dz });
    }
    return (r.lane = { x: 0, z: cfg.dist * 0.5, dx: 0, dz: -1 }); // 找不到時照舊
  },
  rangeStartPos() {
    const L = this.rangeLane();
    return { x: L.x, z: L.z };
  },
  rangeSpawnPlayer() {
    if (this.player) {
      this.scene.remove(this.player.mesh);
      this.player.dead = true;
    }
    const p0 = this.rangeStartPos();
    this.player = new MechEntity(this, this.save.asm, PALETTES.player, {
      team: 'player',
      name: 'RAVEN',
      palKey: 'player',
      slot: 0,
      pilot: this.rangePm(),
    });
    this.player.pos.set(p0.x, this.world.terrainHeight(p0.x, p0.z), p0.z);
    const L = this.rangeLane();
    this.player.yaw = this.player.aimYaw = Math.atan2(-L.dx, -L.dz); // 面向射擊道
    this.players = [this.player];
  },
  // 依設定生成目標（全滅後重新生成時也用）
  rangeSpawnTargets() {
    const cfg = this.rangeCfgGet();
    const [kind, key] = cfg.tgt.includes(':') ? cfg.tgt.split(':') : ['dummy', ''];
    const sh = this.scaleHp,
      sd = this.scaleDmg;
    const p0 = this.rangeStartPos();
    const out = [];
    if (kind === 'boss') {
      const bd = BOSS_DEFS.find((b) => b.kind === key);
      if (bd) {
        this.spawnBossDef(bd, sh, sd);
        document.getElementById('bossBar').style.display = 'block';
        document.getElementById('bossName').textContent = bd.name;
        for (const b of this.bosses) out.push(b);
      }
    } else {
      for (let i = 0; i < cfg.n; i++) {
        const L = this.rangeLane(),
          o = (i - (cfg.n - 1) / 2) * 7;
        const at = new THREE.Vector3(p0.x + L.dx * cfg.dist - L.dz * o, 0, p0.z + L.dz * cfg.dist + L.dx * o);
        at.y = this.world.terrainHeight(at.x, at.z);
        let e = null;
        if (kind === 'type') {
          const d = ENEMY_TYPES[key] || FOES[key];
          if (d && d.flying) at.y += d.hoverH || 6; // 飛行的敵人從懸浮高度開始
          e = this.spawnType(key, sh, sd, at, 1);
        } else if (kind === 'ac' || kind === 'ace') {
          const r = kind === 'ac' ? AC_ROSTER[key] : ACES[key];
          e = this.spawnEnemy({
            name: r.name,
            asm: r.asm || this.foeRandomAsm(),
            pal: r.pal,
            scale: 1,
            hpMul: r.hpMul * sh * (kind === 'ac' ? 0.85 : 1),
            dmgMul: r.dmgMul * sd,
            stabMul: r.stabMul * (kind === 'ac' ? FOE_STAB_K : 1),
            ai: r.ai,
            wantDist: r.wantDist,
            speedMul: r.speedMul,
            turnRate: r.turnRate,
            at,
          });
        } else
          e = this.spawnEnemy({
            name: '標準靶',
            asm: { ...START_ASM, rarm: 'w_none', larm: 'w_none', rback: 'bw_none', lback: 'bw_none' },
            pal: 'mt',
            scale: 1,
            hpMul: 1.2 * sh * FOE_HP_K,
            dmgMul: 0,
            stabMul: FOE_STAB_K,
            ai: 'ac',
            wantDist: 30,
            speedMul: 1,
            at,
          });
        if (!e) continue;
        e.rangeB = kind === 'dummy' && cfg.beh === 'ai' ? 'strafe' : cfg.beh;
        e.rangeAt = at.clone();
        e.rangePh = i * 1.7;
        e.yaw = e.aimYaw = Math.atan2(L.dx, L.dz); // 面向玩家
        out.push(e);
      }
    }
    for (const e of out) e.rangeTgt = true;
    this.range.targets = out;
  },
  rangeExit() {
    const r = this.range;
    if (!r) return;
    SFX.ui();
    this.rangeLogSave();
    this.range = null;
    this.clearMission();
    this.camp = r.camp; // 轉場整備：主線的狀態放回去
    document.getElementById('btnAbort').textContent = '放棄任務';
    document.getElementById('rangePanel').style.display = 'none';
    document.getElementById('bossBar').style.display = 'none';
    this.openGarage();
  },
  // ---------- 每格 ----------
  rangeTick(dt) {
    const r = this.range,
      cfg = this.rangeCfgGet();
    if (!r || !this.player) return;
    r.clock += dt;
    // 原地開火：AI 照常，但位置固定
    for (const e of r.targets || []) {
      if (e.dead || e.rangeB !== 'turret' || !e.rangeAt) continue;
      e.pos.x = e.rangeAt.x;
      e.pos.z = e.rangeAt.z;
      e.vel.x = e.vel.z = 0;
    }
    // 彈藥無限：每秒補滿
    if (cfg.ammo && (r.ammoT = (r.ammoT || 0) - dt) <= 0) {
      r.ammoT = 1;
      for (const s of WSLOTS) {
        const w = this.player.weapons[s];
        if (w && !w.dropped && w.def.ammo > 0 && usesAmmo(w.def)) w.ammo = w.def.ammo;
      }
    }
    // 全滅（AP 不是無限時）：2 秒後重新生成
    if ((r.targets || []).length && r.targets.every((e) => e.dead)) {
      r.respT += dt;
      if (r.respT > 2) {
        r.respT = 0;
        this.rangeSpawnTargets();
      }
    }
    r.uiT -= dt;
    if (r.uiT <= 0) {
      r.uiT = 0.25;
      this.rangePanelRender();
    }
  },
  // 鍵盤：T 目標設定、Y 重置數據（主迴圈外的 keydown，由 input.js 呼叫）
  rangeKey(code) {
    if (!this.range || this.state !== 'play') return false;
    if (code === 'KeyT') {
      this.openRangeMenu();
      return true;
    }
    if (code === 'KeyY') {
      this.range.st = this.rangeNewStats();
      this.flashMsg('數據已重置', 0x7fc8ff, 1);
      return true;
    }
    return false;
  },
  // 目標的行為（MechEntity.updateAI 開頭）：回傳 true＝這一格不跑一般 AI
  rangeAI(e, dt) {
    const b = e.rangeB;
    if (!b || b === 'ai' || b === 'turret') return false;
    const pl = this.player;
    if (pl && !pl.dead) e.yaw = e.aimYaw = Math.atan2(-(pl.pos.x - e.pos.x), -(pl.pos.z - e.pos.z));
    const wish = new THREE.Vector3();
    if (b === 'strafe' && pl) {
      // 左右來回（垂直於玩家方向）
      const dx = pl.pos.x - e.pos.x,
        dz = pl.pos.z - e.pos.z,
        L = Math.hypot(dx, dz) || 1;
      const s = Math.sin(this.range.clock * 0.7 + (e.rangePh || 0));
      wish.set((-dz / L) * s, 0, (dx / L) * s);
      // 離原本的位置太遠時拉回
      if (e.rangeAt) {
        const ox = e.rangeAt.x - e.pos.x,
          oz = e.rangeAt.z - e.pos.z;
        if (Math.hypot(ox, oz) > 14) wish.set(ox, 0, oz).normalize();
      }
    }
    e.move(dt, wish, false, false, false, null);
    return true;
  },
  // ---------- 量測 ----------
  rangeNewStats() {
    return {
      t0: null,
      dealt: 0,
      imp: 0,
      maxHit: 0,
      win: [],
      byW: {},
      shots: 0,
      hits: 0,
      stags: [],
      kills: [],
      tt0: null,
      taken: 0,
      raw: 0,
      hitsIn: 0,
      twin: [],
      byA: {},
      byAin: {},
      band: [
        [0, 0],
        [0, 0],
        [0, 0],
      ],
      selfStag: 0,
      downs: 0,
    };
  },
  // 和最近的目標的距離 → 分段（0～30、30～60、60 m 以上）
  rangeBand(t) {
    const pl = this.player;
    if (!pl) return 0;
    let d = 1e9;
    for (const e of t ? [t] : (this.range && this.range.targets) || [])
      if (!e.dead) d = Math.min(d, e.pos.distanceTo(pl.pos));
    return d < 30 ? 0 : d < 60 ? 1 : 2;
  },
  rangeShot(wid) {
    const S = this.range && this.range.st;
    if (!S) return;
    if (S.t0 === null) S.t0 = this.range.clock;
    S.shots++;
    S.band[this.rangeBand(this.player && this.player.lock)][0]++;
    const w = (S.byW[wid] = S.byW[wid] || { dmg: 0, hits: 0, shots: 0 });
    w.shots++;
  },
  // takeDamage 算出實際傷害後（raw＝防禦前）
  rangeHit(t, from, real, raw, impact, wid, A = 'kin') {
    const r = this.range;
    if (!r) return;
    const S = r.st,
      now = r.clock;
    // 超過剩餘 AP 的溢出傷害不算（和多人的統計一樣）
    const eff = Math.min(real, Math.max(0, t.hp));
    if (real > 0) raw *= eff / real;
    real = eff;
    if (from && from === this.player && t !== this.player) {
      if (S.t0 === null) S.t0 = now;
      S.dealt += real;
      S.imp += impact || 0;
      S.maxHit = Math.max(S.maxHit, real);
      S.win.push([now, real]);
      S.byA[A] = (S.byA[A] || 0) + real;
      S.hits++;
      S.band[this.rangeBand(t)][1]++;
      const w = (S.byW[wid || 'x'] = S.byW[wid || 'x'] || { dmg: 0, hits: 0, shots: 0 });
      w.dmg += real;
      w.hits++;
      if (t.rangeS0 == null) t.rangeS0 = now;
      if (t.rangeK0 == null) t.rangeK0 = now;
    } else if (t === this.player) {
      if (S.tt0 === null) S.tt0 = now;
      S.taken += real;
      S.raw += raw;
      S.byAin[A] = (S.byAin[A] || 0) + real;
      S.hitsIn++;
      S.twin.push([now, real]);
    }
  },
  rangeStag(t, from) {
    const r = this.range;
    if (!r) return;
    if (t === this.player) r.st.selfStag++;
    else if (from === this.player && t.rangeS0 != null) {
      r.st.stags.push(r.clock - t.rangeS0);
      t.rangeS0 = null;
    }
  },
  // AP 歸零前（takeDamage）：目標 AP 無限／自己不會被擊破時補滿，回傳 true＝不擊破
  rangeSave(e) {
    const r = this.range,
      cfg = this.rangeCfgGet();
    if (!r) return false;
    if (e === this.player) {
      if (!cfg.god) return false;
      r.st.downs++;
      e.hp = e.maxHp;
      this.flashMsg('AP 歸零（不會被擊破：已補滿）', 0xff8a8a, 1.2);
      return true;
    }
    if (!e.rangeTgt) return false;
    if (e.rangeK0 != null) r.st.kills.push(r.clock - e.rangeK0);
    e.rangeK0 = null;
    if (!cfg.inf || e.isBoss) return false;
    e.hp = e.maxHp;
    this.fx.ring(e.center(), 4, 0x7fc8ff);
    return true;
  },
  rangeKilled(e) {
    if (e.rangeK0 != null && this.range) this.range.st.kills.push(this.range.clock - e.rangeK0);
    e.rangeK0 = null;
  },
  rangePlayerDead() {
    this.range.st.downs++;
    this.flashMsg('AC 已被擊破 — 重新出場', 0xff4d4d, 1.6);
    setTimeout(() => {
      if (!this.range) return;
      this.rangeSpawnPlayer();
      this.renderWeaponHud(true);
    }, 1500);
  },
  // 統計的數值（面板與紀錄共用）
  rangeSummary() {
    const r = this.range,
      S = r.st,
      now = r.clock;
    const t = S.t0 === null ? 0 : Math.max(0.5, now - S.t0);
    const recent = (arr) => {
      while (arr.length && arr[0][0] < now - 60) arr.shift(); // 只留最近 60 秒
      const span = Math.min(WIN, Math.max(0.5, now - (arr.length ? arr[0][0] : now)));
      return arr.filter((x) => x[0] >= now - WIN).reduce((a, x) => a + x[1], 0) / span;
    };
    const tt = S.tt0 === null ? 0 : Math.max(0.5, now - S.tt0);
    const tdps5 = recent(S.twin);
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const pl = this.player;
    return {
      t,
      dealt: S.dealt,
      dps: t ? S.dealt / t : 0,
      dps5: recent(S.win),
      maxHit: S.maxHit,
      acc: S.shots ? Math.min(1, S.hits / S.shots) : null,
      band: S.band.map(([sh, hi]) => (sh ? Math.min(1, hi / sh) : null)),
      imp: t ? S.imp / t : 0,
      stagN: S.stags.length,
      stagT: avg(S.stags),
      killN: S.kills.length,
      ttk: avg(S.kills),
      byW: S.byW,
      byA: S.byA,
      byAin: S.byAin,
      taken: S.taken,
      tdps: tt ? S.taken / tt : 0,
      tdps5,
      blocked: Math.max(0, S.raw - S.taken),
      hitsIn: S.hitsIn,
      selfStag: S.selfStag,
      downs: S.downs,
      survive: pl && tdps5 > 1 ? pl.hp / tdps5 : null,
    };
  },
  rangePanelRender() {
    const el = document.getElementById('rangePanel');
    if (!el || !this.range) return;
    const s = this.rangeSummary(),
      cfg = this.rangeCfgGet();
    const row = (a, b) => `<div><span>${escHtml(a)}</span><b>${b}</b></div>`;
    const t0 = (this.range.targets || []).find((e) => !e.dead) || (this.range.targets || [])[0];
    const weak = t0 && (t0.res || t0.laserK !== 1) ? weakText(t0.res, t0.laserK) : '';
    // 觸控：沒有鍵盤，用面板上的按鈕（input.js 接 data-ra）；收合時只留主要數據
    const touch = this.vpadWanted();
    const mini = touch && this.rangeMini;
    const btns = touch
      ? `<div class="rpBtns"><button data-ra="cfg">設定</button><button data-ra="reset">重置</button><button data-ra="mini">${mini ? '展開' : '收合'}</button></div>`
      : '';
    let h = `${btns}<div class="rpHead">靶場　${escHtml(this.rangeTgtName(cfg.tgt))}・${BEH[cfg.beh]}・${cfg.dist} m${touch ? '' : '　<span class="dim">T 設定／Y 重置</span>'}${weak ? `<br><span class="rpWeak">${escHtml(weak)}</span>` : ''}</div>`;
    const byA = (o) =>
      ATTR_KEYS.filter((k) => o[k] > 0)
        .map((k) => `<span style="color:${ATTRS[k].color}">${ATTRS[k].short} ${fmt(o[k])}</span>`)
        .join(' ') || '—';
    // 收合：只留 DPS、命中率、受到傷害
    if (mini) {
      el.innerHTML =
        h +
        row('DPS（最近 5 秒）', fmt(s.dps5)) +
        row('命中率', s.acc === null ? '—' : Math.round(s.acc * 100) + '%') +
        row('受到傷害', fmt(s.taken));
      return;
    }
    h += '<div class="rpSec">輸出</div>';
    h += row('DPS（最近 5 秒）', fmt(s.dps5));
    h += row('DPS（平均）', fmt(s.dps));
    h += row('總傷害', fmt(s.dealt) + `（${s.t.toFixed(1)} 秒）`);
    h += row('單次最高', fmt(s.maxHit));
    h += row('命中率', s.acc === null ? '—' : Math.round(s.acc * 100) + '%');
    h += row(
      '命中率（近／中／遠）',
      s.band.map((v) => (v === null ? '—' : Math.round(v * 100) + '%')).join(' ／ '),
    );
    h += row('衝擊／秒', fmt(s.imp));
    h += row('打出失衡', s.stagN ? `${s.stagN} 次（平均 ${s.stagT.toFixed(1)} 秒）` : '—');
    h += row('擊破', s.killN ? `${s.killN} 次（平均 ${s.ttk.toFixed(1)} 秒）` : '—');
    h += row('依屬性', byA(s.byA));
    const ws = Object.entries(s.byW).filter(([, w]) => w.dmg > 0 || w.shots > 0);
    if (ws.length) {
      h += '<div class="rpSec">各武器</div>';
      // 每把武器：DPS、命中率、實測 ÷ 理論的有效率、擴散角與預判準度（目前目標的距離）
      const F = (this.range.fire = this.range.fire || this.garageFire(this.save.asm));
      const pl = this.player;
      const tg = pl && (pl.lock || (this.range.targets || []).find((e) => !e.dead));
      const dist = tg ? tg.pos.distanceTo(pl.pos) : 30;
      const A = pl ? pl.fcsAssist(dist) : 0.6;
      for (const [id, w] of ws) {
        const dps = s.t ? w.dmg / s.t : 0;
        const th = F.ws.find((x) => x.id === id);
        const eff = th && th.sus > 0 ? `・效率 ${Math.round((dps / th.sus) * 100)}%` : '';
        h += row(
          wName(id),
          `${fmt(dps)}/s${w.shots ? `・${Math.round(Math.min(1, w.hits / w.shots) * 100)}%` : ''}${eff}`,
        );
        const slot = pl && WSLOTS.find((k) => pl.weapons[k] && pl.weapons[k].def.id === id);
        const d = slot && pl.weapons[slot].def;
        if (d && d.spread !== undefined) {
          const arm = slot.endsWith('arm') ? 1.3 - pl.stats.parts.arms.aim * 0.6 : 0.55;
          const deg = (d.spread || 0) * arm * assistSpread(A) * 57.3;
          h += `<div class="rpSub"><span>　擴散 ${deg.toFixed(1)}°・預判 ${Math.round(pl.leadK(dist) * 100)}%（${Math.round(dist)} m）</span></div>`;
        }
      }
    }
    h += '<div class="rpSec">承受</div>';
    h += row('受到傷害', fmt(s.taken) + (s.hitsIn ? `（${s.hitsIn} 次）` : ''));
    h += row('每秒受傷（最近 5 秒）', fmt(s.tdps5));
    h += row('防禦擋下', fmt(s.blocked));
    h += row('依屬性', byA(s.byAin));
    h += row('還能撐', s.survive === null ? '—' : s.survive.toFixed(1) + ' 秒');
    h += row('自己失衡／AP 歸零', `${s.selfStag}／${s.downs}`);
    el.innerHTML = h;
  },
  // ---------- 紀錄 ----------
  rangeLogSave() {
    const r = this.range;
    if (!r || (!r.st.dealt && !r.st.taken)) return;
    const s = this.rangeSummary(),
      cfg = this.rangeCfgGet();
    const P = asmStats(this.save.asm).parts;
    const log = lsGet(LOG_KEY, []);
    log.unshift({
      at: Date.now(),
      w: WSLOTS.map((k) => P[k])
        .filter((p) => p && p.type !== 'none')
        .map((p) => p.name),
      tgt: this.rangeTgtName(cfg.tgt),
      beh: BEH[cfg.beh],
      dist: cfg.dist,
      pm: cfg.pm,
      t: +s.t.toFixed(1),
      dps: Math.round(s.dps),
      acc: s.acc === null ? null : Math.round(s.acc * 100),
      stagT: +s.stagT.toFixed(1),
      band: s.band.map((v) => (v === null ? null : Math.round(v * 100))),
      ttk: +s.ttk.toFixed(1),
      tdps: Math.round(s.tdps),
      blocked: Math.round(s.blocked),
    });
    lsSet(LOG_KEY, log.slice(0, LOG_MAX));
  },
  rangeLogOpen(open) {
    const el = document.getElementById('rangeLogBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    SFX.ui();
    const log = lsGet(LOG_KEY, []);
    const sel = (this.rangeCmp = this.rangeCmp || []);
    const best = (k, hi) => {
      const v = log.map((x) => x[k]).filter((x) => typeof x === 'number' && x > 0);
      return v.length > 1 ? (hi ? Math.max(...v) : Math.min(...v)) : null; // 至少兩筆才標出最好的
    };
    const B = {
      dps: best('dps', true),
      acc: best('acc', true),
      stagT: best('stagT'),
      ttk: best('ttk'),
      tdps: best('tdps'),
    };
    const cell = (x, k) => {
      const v = x[k];
      const s = v === null || v === undefined || v === 0 ? '—' : k === 'acc' ? v + '%' : v.toLocaleString();
      return `<td class="${B[k] !== undefined && v === B[k] && v ? 'best' : ''}">${s}</td>`;
    };
    document.getElementById('rangeLogList').innerHTML = log.length
      ? `<table class="rgLog"><tr><th>比較</th><th>時間</th><th>武器</th><th>目標</th><th>DPS</th><th>命中</th><th>近／中／遠</th><th>失衡(秒)</th><th>擊破(秒)</th><th>受傷/秒</th><th>擋下</th></tr>${log
          .map(
            (x, i) =>
              `<tr class="${sel.includes(i) ? 'sel' : ''}"><td><input type="checkbox" data-i="${i}"${sel.includes(i) ? ' checked' : ''}></td><td>${new Date(x.at).toLocaleString()}</td><td>${escHtml(x.w.join('、'))}${x.pm ? '' : '<span class="dim">（純機體）</span>'}</td><td>${escHtml(x.tgt)}・${escHtml(x.beh)}・${x.dist}m</td>${cell(x, 'dps')}${cell(x, 'acc')}<td>${(x.band || []).map((v) => (v === null ? '—' : v + '%')).join('／') || '—'}</td>${cell(x, 'stagT')}${cell(x, 'ttk')}${cell(x, 'tdps')}<td>${(x.blocked || 0).toLocaleString()}</td></tr>`,
          )
          .join('')}</table><div class="dim">勾選兩筆會排在最上面並排比較；綠色＝所有紀錄裡最好的。</div>`
      : '<p class="dim">還沒有紀錄：進靶場打一打，離開或重新設定時會記下來。</p>';
    // 勾選的排到最上面（最多兩筆）
    for (const c of document.querySelectorAll('#rangeLogList input[data-i]'))
      c.onchange = () => {
        const i = Number(c.dataset.i);
        const k = sel.indexOf(i);
        if (k >= 0) sel.splice(k, 1);
        else {
          sel.push(i);
          if (sel.length > 2) sel.shift();
        }
        this.rangeCmp = sel;
        this.rangeLogOpen(true);
        const tb = document.querySelector('#rangeLogList table');
        if (tb && sel.length) {
          const rows = [...tb.querySelectorAll('tr')].slice(1);
          for (const i2 of sel.slice().reverse()) if (rows[i2]) tb.insertBefore(rows[i2], tb.rows[1]);
        }
      };
  },
  // ---------- 機甲庫：理論火力與防禦 ----------
  // 目前組裝（或換上某個零件後）的理論值
  garageFire(asm) {
    const st = asmStats(asm);
    const pm = this.rangePm();
    const ef = applyPilotStats(st, pm);
    const gen = ef.parts.generator;
    const ws = [];
    for (const k of WSLOTS) {
      const p = st.parts[k];
      if (!p || p.type === 'none') continue;
      const d = pilotWeaponDef(p, pm);
      const v = weaponDps(d, gen, (pm && pm.enWpn) || 0);
      if (v)
        ws.push({
          slot: k,
          id: p.id,
          name: p.name,
          ...v,
          hit30: estHit(d, k, ef.parts.fcs, ef.parts.arms.aim, 30),
          hit60: estHit(d, k, ef.parts.fcs, ef.parts.arms.aim, 60),
        });
    }
    const sum = (k) => ws.reduce((a, w) => a + (w[k] || 0), 0);
    return {
      ws,
      burst: sum('burst'),
      sus: sum('sus'),
      imp: sum('imp'),
      ap: ef.ap,
      def: ef.def,
      defs: ef.defs,
      eap: effectiveAp(ef.ap, ef.def),
    };
  },
  garageFireHtml() {
    const F = this.garageFire(this.save.asm);
    const row = (a, b, c = '') => `<div class="stat ${c}"><span>${a}</span><span>${b}</span></div>`;
    let h = `<h3 class="gFireH">火力（理論值）<label class="dim"><input type="checkbox" id="gFirePm"${this.rangePmOn() ? ' checked' : ''}> 套用加成</label></h3>`;
    for (const w of F.ws)
      h += row(
        `${SLOT_NAMES[w.slot]}　<b style="color:${ATTRS[w.attr].color}">${ATTRS[w.attr].short}</b> ${escHtml(w.name)}`,
        `${fmt(w.burst)}${Math.round(w.sus) !== Math.round(w.burst) ? ` <span class="dim">／持續 ${fmt(w.sus)}</span>` : ''}${w.charge ? ` <span class="dim">／蓄力 ${fmt(w.charge)}</span>` : ''}`,
      );
    if (!F.ws.length) h += row('武器', '沒有裝備');
    h += row('合計 DPS', `${fmt(F.burst)} <span class="dim">／持續 ${fmt(F.sus)}</span>`, 'ok');
    h += row('衝擊／秒', fmt(F.imp));
    // 預估命中率：對移動中的 AC（firepower.js 的 estHit）
    const hp = (v) => (v === null ? '—' : Math.round(v * 100) + '%');
    const hw = F.ws.filter((w) => w.hit30 !== null);
    if (hw.length) {
      h += '<div class="dim gFireNote">預估命中率（對移動中的 AC：30 m ／ 60 m）</div>';
      for (const w of hw)
        h += row(`${SLOT_NAMES[w.slot]}　${escHtml(w.name)}`, `${hp(w.hit30)} ／ ${hp(w.hit60)}`);
    }
    h += row('有效 AP（含防禦）', fmt(F.eap));
    h += row(
      '減傷（實／爆／能）',
      ATTR_KEYS.map(
        (k) => `<span style="color:${ATTRS[k].color}">${Math.round(F.defs[k] * 1000) / 10}%</span>`,
      ).join(' ／ '),
    );
    h += '<div class="dim gFireNote">理論值假設全部命中；實際請到靶場量測。</div>';
    return h;
  },
  // 零件清單的差異：換上這個零件後，合計 DPS／有效 AP 的變化
  garagePartDelta(slot, cat, p) {
    if (cat === 'consumable') return '';
    const cur = this.garageFireCache || (this.garageFireCache = this.garageFire(this.save.asm));
    const asm = { ...this.save.asm, [slot]: p.id };
    const F = this.garageFire(asm);
    const d = (a, b, name) => {
      const x = Math.round(a - b);
      if (!x) return '';
      return `<span class="${x > 0 ? 'dUp' : 'dDn'}">${name} ${x > 0 ? '▲' : '▼'}${Math.abs(x).toLocaleString()}</span>`;
    };
    const parts = [];
    if (cat === 'arm' || cat === 'back') parts.push(d(F.sus, cur.sus, 'DPS'));
    else parts.push(d(F.eap, cur.eap, '有效 AP'), d(F.sus, cur.sus, 'DPS'));
    return parts.filter(Boolean).join(' ');
  },
});
