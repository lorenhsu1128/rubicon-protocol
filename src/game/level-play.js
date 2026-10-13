// Game：自訂關卡的遊玩（設計見 docs/level-editor-design.md）——開局（單人、房主、編輯器的試玩）、
// 單位的生成與行為（進攻／守住／警戒／巡邏／撤退、護送車輛）、機能物件（補給箱、補給台、資料終端、出口、
// 目標設施、防衛目標）、觸發器（事件 → 條件 → 動作，計數器、倒數、等待）、勝敗、HUD、多段出擊。
// 邏輯只在房主／單機；客機收到快照的 mis.lv（觸發器狀態：目標文字、倒數、區域圈、出口）與 'lvx' 事件只做顯示。
// 自訂關卡不給 COAM、經驗與熟練度（擊破獎金也不入帳），只記通關紀錄。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { AC_ROSTER, BOSS_DEFS, enemyScale } from '../data/enemies.js';
import { ACES } from '../data/foes.js';
import { MechEntity } from '../entities/mech-entity.js';
import { applyLevelProps, levelWorldOpt, setPlacedVisible } from '../level/build.js';
import { ACTIONS, CONDS, cmpOp, inArea, segCount, segOf } from '../level/format.js';
import { LevelStore } from '../level/store.js';
import { PALETTES } from '../render/materials.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const STAND_EXIT = 1; // 站進出口幾秒
const STAND_PAD = 1.5; // 補給台
const PAD_CD = 30; // 可重複使用的補給台冷卻
const WARN_T = 3; // 增援預告到出現
const SIGHT = 45; // 巡邏發現玩家的距離（警戒用自己的半徑）
const CONVOY_ASM = {
  head: 'h_hv',
  core: 'c_hv',
  arms: 'a_hv',
  legs: 'l_tk',
  booster: 'b_std',
  generator: 'g_std',
  fcs: 'f_std',
  rarm: 'w_none',
  larm: 'w_none',
  rback: 'bw_none',
  lback: 'bw_none',
};
const COLOR = {
  info: 0xffb020,
  good: 0x7ee081,
  warn: 0xff4d4d,
  banner: 0xffb020,
  warning: 0xff4030,
  clear: 0x7ee081,
  ace: 0xff4d4d,
};
const CUE_K = {
  banner: 'start',
  warning: 'warning',
  info: 'info',
  good: 'good',
  warn: 'warn',
  clear: 'clear',
  ace: 'ace',
};
const SPK = { echo: 'echo', cmd: 'cmd', ally: 'ally', enemy: 'enemy', custom: 'custom' };

// 關卡裡有沒有某種事件／動作（沒有時套用預設規則）
const hasEv = (L, k) => L.triggers.some((t) => t.ev.k === k);
const hasAct = (L, k) => L.triggers.some((t) => t.act.some((a) => a.k === k));

Object.assign(Game.prototype, {
  // ---------- 開始 ----------
  // full＝整份關卡（已經過 loadLevel）；o：{ test 編輯器試玩, at 從這裡試玩的位置, src 'local'／'server' }
  lvPlay(full, o = {}) {
    SFX.init();
    this.lvFull = full;
    this.lvOpt = o;
    this.lvBegin(0, null);
  },
  // 第 n 段（0 起）：建地圖、玩家、機能物件、開場的單位，送開局訊息（多人）
  lvBegin(n, carryBy) {
    const full = this.lvFull,
      o = this.lvOpt || {};
    const L = segOf(full, n);
    const mp = !!(this.net && this.net.role === 'host');
    this.clearMission();
    const B = L.base;
    this.worldSeed = B.seed;
    this.worldTheme = B.theme;
    this.styleRefresh();
    this.world = new World(this.scene, B.theme, B.seed, B.level, null, levelWorldOpt(L));
    applyLevelProps(this.world, L);
    this.isClient = false;
    this.net.spawnReg = {};
    this.mpStats = {};
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    this.lv = this.lvState(L, n, o);
    this.lvLastSeg = n; // 最後到過的段（冒煙測試）
    const spawns = L.marks.filter((m) => m.k === 'spawn');
    const at = (i) => {
      const m = spawns[i % spawns.length] || { x: 0, z: 0, y: 0, yaw: 0 };
      const off = i >= spawns.length ? 3 * Math.floor(i / spawns.length) : 0;
      const x = m.x + off,
        z = m.z;
      return { x, z, y: this.world.groundAt(x, z, (m.y || 0) + 2), yaw: m.yaw || 0 };
    };
    if (mp) {
      this.mpSpawnPlayers();
      this.players.forEach((e, i) => {
        const p = at(i);
        e.pos.set(p.x, p.y, p.z);
        e.yaw = e.aimYaw = p.yaw;
        e.mesh.position.copy(e.pos);
        if (carryBy && carryBy[e.slot]) this.campApplyCarry(e, carryBy[e.slot]);
        this.net.spawnReg[e.id].p = [e.pos.x, e.pos.y, e.pos.z];
      });
      for (const e of this.players)
        this.mpStats[e.slot] = { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} };
    } else {
      this.player = new MechEntity(this, this.save.asm, PALETTES.player, {
        team: 'player',
        name: 'RAVEN',
        palKey: 'player',
        slot: 0,
        pilot: this.pilotLocalMods('pve'),
      });
      const p =
        o.at && n === 0
          ? { x: o.at.x, z: o.at.z, y: this.world.groundAt(o.at.x, o.at.z, o.at.y + 2), yaw: 0 }
          : at(0);
      this.player.pos.set(p.x, p.y, p.z);
      this.player.yaw = this.player.aimYaw = p.yaw;
      this.player.mesh.position.copy(this.player.pos);
      if (carryBy && carryBy[0]) this.campApplyCarry(this.player, carryBy[0]);
      this.players = [this.player];
      this.mpStats[0] = { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} };
    }
    const np = mp ? this.players.length : 1;
    this.enemies = [];
    this.allies = [];
    this.waves = [];
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.missionEarned = 0;
    this.bountyPops = [];
    this.isBossLevel = false;
    const sc = enemyScale(B.level, np);
    this.scaleHp = sc.hp;
    this.scaleDmg = sc.dmg;
    this.levelName = full.name + (segCount(full) > 1 ? `（${n + 1}／${segCount(full)}）` : '');
    this.lvBuildMarks(true);
    for (const u of L.units) if (u.at === 'start') this.lvSpawnUnit(u, 'place');
    for (const g of new Set(L.units.filter((u) => u.at === 'start').map((u) => u.g)))
      this.lv.st.spawned[g] = (this.lv.st.spawned[g] || 0) + 1;
    if (mp) {
      this.net.tr.broadcast(this.lvStartMsg());
      this.netEvents = [];
    }
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.viewReset();
    const bb = document.getElementById('bossBar');
    bb.style.display = this.bosses.length ? 'block' : 'none';
    if (this.bosses.length) document.getElementById('bossName').textContent = this.bosses[0].name;
    this.flashMsg(this.levelName, 0xffb020, 2.2, {
      k: 'start',
      m: o.test ? '試玩' : '作戰開始',
      s: this.levelName,
    });
    this.goalIntro();
    this.lvEmit('start', {});
  },
  // 執行時的狀態（st 會同步給客機、房主遷移時接手）
  lvState(L, seg, o) {
    const st = {
      en: {},
      fired: {},
      prev: {},
      every: {},
      cnt: {},
      run: [],
      pend: [],
      timer: null,
      obj: '',
      areas: {},
      exits: {},
      marks: {},
      spawned: {},
      beh: {},
      downs: 0,
      v: 0,
    };
    for (const t of L.triggers) st.en[t.id] = t.on;
    for (const c of L.counters) st.cnt[c.id] = c.v;
    for (const a of L.areas) if (a.show) st.areas[a.id] = 1;
    for (const m of L.marks) if (m.k === 'exit' && m.open) st.exits[m.id] = 1;
    return { L, seg, test: !!o.test, st, q: [], vis: {}, ending: false, dirty: true, sentT: 0, hudHtml: '' };
  },
  lvStartMsg(pid) {
    const w = this.world;
    return {
      t: 'start',
      pace: this.ctrl.pace || 1,
      rejoin: !!pid,
      seed: this.worldSeed,
      theme: this.worldTheme,
      variant: w.variantKey,
      wopt: w.netOpt(),
      feat: w.netFeat(),
      level: this.lv.L.base.level,
      players: this.net.players.map((p) => ({ slot: p.slot, nick: p.nick, color: p.color })),
      spawns: Object.values(this.net.spawnReg),
      bossName: this.bosses[0] ? this.bosses[0].name : '',
      lvh: this.lvHash,
      lvSeg: this.lv.seg,
      lvName: this.levelName,
    };
  },
  // ---------- 機能物件 ----------
  // host：房主／單機（補給箱、目標設施由房主生成並同步）；客機只建光環
  lvBuildMarks(host) {
    const lv = this.lv,
      w = this.world;
    for (const m of lv.L.marks) {
      const pos = new THREE.Vector3(m.x, w.groundAt(m.x, m.z, (m.y || 0) + 2), m.z);
      if (m.k === 'cache' && host) {
        this.cacheAdd({
          i: 900 + lv.L.marks.indexOf(m),
          k: m.cache || 'repair',
          p: [+m.x.toFixed(1), +m.z.toFixed(1)],
          m: m.id,
        });
      } else if ((m.k === 'target' || m.k === 'defend') && host) {
        const sh = this.scaleHp;
        this.scaleHp = sh * (m.hp || 1);
        this.lvSpawnU = { m: m.id };
        try {
          const e = this.campObjective(pos, m.k === 'target' ? 'enemy' : 'ally');
          e.name = m.name || e.name;
        } finally {
          this.scaleHp = sh;
          this.lvSpawnU = null;
        }
      } else if (m.k === 'supply')
        lv.vis[m.id] = {
          pos,
          m,
          t: 0,
          group: this.campRing(pos, 0x7ee081, m.name || '補給台', 'AP 與彈藥 +50%'),
        };
      else if (m.k === 'term')
        lv.vis[m.id] = {
          pos,
          m,
          t: 0,
          group: this.campRing(pos, 0x7fc8ff, m.name || '資料終端', `站在裡面 ${m.t || 4} 秒`),
        };
      else if (m.k === 'exit') lv.vis[m.id] = { pos, m, t: 0, group: null };
    }
    this.lvSyncVis();
  },
  // 出口的光環、區域圈依狀態顯示（房主與客機）
  lvSyncVis() {
    const lv = this.lv;
    if (!lv) return;
    const st = lv.st;
    for (const id in lv.vis) {
      const v = lv.vis[id];
      if (v.m.k === 'exit') {
        const on = !!st.exits[id];
        if (on && !v.group) {
          v.group = this.campRing(v.pos, 0xffb020, v.m.name || '出口', '走進去');
          this.fx.ring(v.pos.clone().setY(v.pos.y + 0.2), 6, 0xffb020);
        } else if (!on && v.group) {
          this.campDisposeGroup(v.group);
          v.group = null;
        }
      } else if (v.group) {
        const sm = st.marks[id] || {};
        v.group.visible = !sm.u && !sm.d;
      }
    }
    lv.areaMesh = lv.areaMesh || {};
    for (const a of lv.L.areas) {
      const on = !!st.areas[a.id];
      const mesh = lv.areaMesh[a.id];
      if (on && !mesh) lv.areaMesh[a.id] = this.lvAreaMesh(a);
      else if (!on && mesh) {
        this.campDisposeGroup(mesh);
        delete lv.areaMesh[a.id];
      }
    }
  },
  lvAreaMesh(a) {
    const w = this.world;
    const g = new THREE.Group();
    const y = w.terrainHeight(a.x, a.z);
    g.position.set(a.x, y, a.z);
    g.rotation.y = a.yaw || 0;
    const m = new THREE.MeshBasicMaterial({
      color: a.color || 0x5cc8ff,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const H = 6;
    if (a.sh === 'circle') {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(a.r, a.r, H, 48, 1, true), m);
      c.position.y = H / 2;
      g.add(c);
    } else {
      for (const [px, pz, len, rot] of [
        [0, a.d / 2, a.w, 0],
        [0, -a.d / 2, a.w, 0],
        [a.w / 2, 0, a.d, Math.PI / 2],
        [-a.w / 2, 0, a.d, Math.PI / 2],
      ]) {
        const p = new THREE.Mesh(new THREE.PlaneGeometry(len, H), m);
        p.position.set(px, H / 2, pz);
        p.rotation.y = rot;
        g.add(p);
      }
    }
    g.userData.lvArea = a.id;
    this.scene.add(g);
    return g;
  },
  // ---------- 單位 ----------
  // how：place（擺放的位置）／edge（從增援地點進入）／drop（在增援地點空降）
  lvSpawnUnit(u, how, mk) {
    const sh = this.scaleHp * (u.k || 1),
      sd = this.scaleDmg * (1 + ((u.k || 1) - 1) * 0.3);
    const w = this.world;
    const at = new THREE.Vector3(u.x, w.groundAt(u.x, u.z, (u.y || 0) + 2), u.z); // y＝擺放時的高度（站在平台上）
    const usePt = how !== 'place' && mk;
    if (usePt) this.waveAt = { pos: { x: mk.x, z: mk.z }, drop: how === 'drop' };
    this.lvSpawnU = { u: u.id, g: u.g };
    let ents = [];
    try {
      if (u.kind === 'enemy') {
        const e = this.spawnType(u.type, sh, sd, usePt ? null : at, 1);
        if (e) ents.push(e);
      } else if (u.kind === 'ace') {
        const r = ACES[u.type];
        if (r)
          ents.push(
            this.spawnEnemy({
              name: r.name,
              asm: r.randomAsm ? this.foeRandomAsm() : r.asm,
              pal: r.pal,
              scale: 1,
              hpMul: r.hpMul * sh * 1.3,
              dmgMul: r.dmgMul * sd,
              stabMul: r.stabMul * 1.3,
              ai: r.ai,
              wantDist: r.wantDist,
              speedMul: r.speedMul,
              turnRate: r.turnRate,
              amphib: r.amphib,
              ace: true,
              at: usePt ? null : at,
            }),
          );
        if (r)
          this.flashMsg(`敵對 AC「${r.name}」`, 0xff4d4d, 2.2, { k: 'ace', m: r.name, s: 'HOSTILE AC 介入' });
      } else if (u.kind === 'boss') {
        const bd = BOSS_DEFS[+u.type];
        if (bd && !(bd.rail && !(w.corridor && w.corridor.kind === 'rail'))) {
          if (!usePt) this.waveAt = { pos: { x: u.x, z: u.z }, drop: false };
          this.spawnBossDef(bd, sh, sd);
          ents = this.bosses.slice();
          this.isBossLevel = true;
          this.bossFightT = 0;
          const bb = document.getElementById('bossBar');
          bb.style.display = 'block';
          document.getElementById('bossName').textContent = bd.name;
        } else if (bd) this.flashMsg(`${bd.name} 需要有鐵路的地圖，略過`, 0xff8a8a, 3);
      } else if (u.kind === 'ally') {
        const r = AC_ROSTER[u.type];
        if (r) {
          const o = {
            name: r.name,
            pal: 'ally',
            palKey: 'ally',
            team: 'ally',
            ai: r.ai,
            wantDist: r.wantDist,
            speedMul: r.speedMul,
            turnRate: r.turnRate,
            hpMul: r.hpMul * 1.4 * (u.k || 1),
            dmgMul: r.dmgMul * 0.8,
            stabMul: r.stabMul,
            allyDur: 1e9,
          };
          const e = new MechEntity(this, r.asm, PALETTES.ally, o);
          const p = usePt ? w.spawnPoint(this.player.pos, [], { x: mk.x, z: mk.z }, 4) : at;
          e.pos.set(p.x, w.groundAt(p.x, p.z, (p.y || at.y) + 2) + (how === 'drop' ? 16 : 0), p.z);
          e.mesh.position.copy(e.pos);
          e.allyT = 1e9;
          this.registerSpawn(e);
          this.allies.push(e);
          ents.push(e);
        }
      } else if (u.kind === 'convoy') {
        const P = this.lv.L.paths.find((p) => p.id === u.beh.path);
        const path = (P ? P.pts : [[u.x, u.z]]).map(
          (q) => new THREE.Vector3(q[0], w.groundAt(q[0], q[1], 99), q[1]),
        );
        const leader =
          this.allies.filter((a) => a.ai === 'convoy' && a.edu && a.edu.g === u.g && !a.dead).pop() || null;
        const o = {
          name: '護送車輛',
          pal: 'ally',
          palKey: 'ally',
          team: 'ally',
          scale: 0.9,
          hpMul: 1.8 * this.scaleHp * (u.k || 1),
          dmgMul: 0,
          stabMul: 99,
          ai: 'convoy',
          modelKind: 'vehicle',
          radius: 2,
          speedMul: 0.8,
          path,
          convoySpeed: 0.32 * ((u.beh.speed || 0.6) / 0.6),
          leader,
        };
        const e = new MechEntity(this, CONVOY_ASM, PALETTES.ally, o);
        e.pos.copy(at);
        e.mesh.position.copy(e.pos);
        e.allyT = 1e9;
        this.registerSpawn(e);
        this.allies.push(e);
        ents.push(e);
      }
    } finally {
      this.waveAt = null;
      this.lvSpawnU = null;
    }
    for (const e of ents) {
      if (!e.edu) e.edu = { u: u.id, g: u.g };
      if (how === 'place' && u.kind !== 'boss') e.yaw = e.aimYaw = u.yaw || 0;
    }
    return ents;
  },
  // 生成一個群組裡「等觸發器」的單位
  lvSpawnGroup(g, how, mid, warn) {
    const lv = this.lv;
    const us = lv.L.units.filter((u) => u.g === g && u.at === 'trig');
    if (!us.length) return;
    const mk = lv.L.marks.find((m) => m.id === mid) || null;
    const H = mk ? how : 'place';
    lv.st.spawned[g] = (lv.st.spawned[g] || 0) + 1;
    if (warn && H !== 'place') {
      const pos = { x: mk.x, z: mk.z };
      lv.st.pend.push({ t: WARN_T, g, how: H, m: mid });
      const W = this.world;
      const base = new THREE.Vector3(pos.x, W.groundAt(pos.x, pos.z, 99), pos.z);
      this.fx.warnLine(
        base,
        base.clone().setY(base.y + 45),
        WARN_T + 0.5,
        H === 'drop' ? 0xffa020 : 0xff3030,
        0.5,
      );
      const ev = { t: 'lvx', a: 'wave', p: [pos.x, pos.z], n: us.length, d: H === 'drop' ? 1 : 0 };
      this.netEv(ev);
      this.lvClientEvent(ev);
    } else this.lvSpawnNow(g, H, mid);
    lv.dirty = true;
  },
  lvSpawnNow(g, how, mid) {
    const lv = this.lv;
    const mk = lv.L.marks.find((m) => m.id === mid) || null;
    for (const u of lv.L.units) if (u.g === g && u.at === 'trig') this.lvSpawnUnit(u, mk ? how : 'place', mk);
    if (mk && how === 'drop')
      this.fx.shockwave(new THREE.Vector3(mk.x, this.world.groundAt(mk.x, mk.z, 99), mk.z), 8, 0xffa020, 0.5);
  },
  lvGroupEnts(g) {
    return [...this.enemies, ...this.allies].filter((e) => e.edu && e.edu.g === g);
  },
  // 單位的行為（MechEntity.updateAI 一開始呼叫；回傳 true＝已處理）
  lvAI(e, dt) {
    const lv = this.lv;
    if (!lv || !e.edu || e.edu.u === undefined || e.ai === 'convoy' || e.ai === 'objective') return false;
    const u = lv.L.units.find((x) => x.id === e.edu.u);
    if (!u) return false;
    const b = lv.st.beh[u.g] || u.beh;
    e.edHold = b.k === 'hold';
    if (b.k === 'attack' || b.k === 'hold') return false;
    const pl = this.playersAlive().filter((p) => !p.downed);
    const near = (r) =>
      pl.find((p) => p.pos.distanceTo(e.pos) < r && !this.world.terrainBlocks(e.center(), p.center()));
    const alertGroup = () => {
      for (const o of this.lvGroupEnts(u.g)) o.edAlert = true;
      e.edAlert = true;
    };
    if (b.k === 'retreat') {
      const mk = lv.L.marks.find((m) => m.id === b.m);
      if (!mk) return false;
      const d = Math.hypot(mk.x - e.pos.x, mk.z - e.pos.z);
      if (d < 4) {
        e.depart();
        return true;
      }
      const wish = new THREE.Vector3(mk.x - e.pos.x, 0, mk.z - e.pos.z).normalize();
      e.setAim(e.center().add(wish.clone().multiplyScalar(20)));
      e.move(dt, wish, d > 12 && e.flying, false, d > 25, null);
      return true;
    }
    if (e.edAlert) {
      if (b.k === 'patrol' && b.back) {
        // 出動後：附近 70 m 沒有玩家 8 秒就回到路徑
        e.edLost = near(70) ? 0 : (e.edLost || 0) + dt;
        if (e.edLost > 8) {
          e.edAlert = false;
          e.edLost = 0;
        }
      }
      return false;
    }
    const hurt = e.hp < e.maxHp - 1;
    if (b.k === 'guard') {
      if (hurt || pl.some((p) => p.pos.distanceTo(e.pos) < (b.r || 35))) {
        alertGroup();
        return false;
      }
      e.move(dt, new THREE.Vector3(), false, false, false, null);
      return true;
    }
    if (b.k === 'patrol') {
      if (hurt || near(b.r || SIGHT)) {
        alertGroup();
        return false;
      }
      const P = lv.L.paths.find((p) => p.id === b.path);
      if (!P) {
        e.move(dt, new THREE.Vector3(), false, false, false, null);
        return true;
      }
      const n = P.pts.length;
      if (e.edPi === undefined) {
        // 從最近的路徑點開始
        let bi = 0,
          bd = 1e9;
        P.pts.forEach((q, i) => {
          const d = Math.hypot(q[0] - e.pos.x, q[1] - e.pos.z);
          if (d < bd) {
            bd = d;
            bi = i;
          }
        });
        e.edPi = bi;
        e.edDir = 1;
        e.edWait = 0;
      }
      const q = P.pts[e.edPi];
      const d = Math.hypot(q[0] - e.pos.x, q[1] - e.pos.z);
      if (d < 2.5) {
        if (e.edWait <= 0 && q[2] > 0 && !e.edWaited) {
          e.edWait = q[2];
          e.edWaited = true;
        }
        if (e.edWait > 0) {
          e.edWait -= dt;
          e.move(dt, new THREE.Vector3(), false, false, false, null);
          return true;
        }
        e.edWaited = false;
        let ni = e.edPi + e.edDir;
        if (ni >= n || ni < 0) {
          if (P.loop) ni = (ni + n) % n;
          else {
            e.edDir = -e.edDir;
            ni = e.edPi + e.edDir;
          }
        }
        e.edPi = clamp(ni, 0, n - 1);
      }
      const t = P.pts[e.edPi];
      const wish = new THREE.Vector3(t[0] - e.pos.x, 0, t[1] - e.pos.z);
      if (wish.lengthSq() > 1e-4) wish.normalize().multiplyScalar(b.speed || 0.6);
      e.setAim(e.center().add(wish.clone().normalize().multiplyScalar(20)));
      e.move(dt, wish, !!e.flying, false, false, null);
      return true;
    }
    return false;
  },
  // ---------- 每格（房主／單機） ----------
  lvTick(dt) {
    const lv = this.lv;
    if (!lv || lv.ending) return this.lvVisTick(dt);
    const st = lv.st,
      L = lv.L;
    // 增援預告 → 生成
    for (let i = st.pend.length - 1; i >= 0; i--) {
      const p = st.pend[i];
      if ((p.t -= dt) <= 0) {
        st.pend.splice(i, 1);
        this.lvSpawnNow(p.g, p.how, p.m);
        lv.dirty = true;
      }
    }
    if (this.isBossLevel && this.bosses.some((b) => !b.dead)) this.bossPhaseTick(dt);
    // 倒數
    if (st.timer) {
      st.timer.t -= dt;
      if (st.timer.t <= 0) {
        st.timer = null;
        lv.dirty = true;
        this.lvEmit('timer', {});
        if (!hasEv(L, 'timer')) return this.lvEnd(false, '時間到');
      }
    }
    // 機能物件：補給台、資料終端、出口（任一玩家站在裡面）
    const ps = this.playersAlive().filter((p) => !p.downed);
    const onPad = (v, r) =>
      ps.some((p) => Math.hypot(p.pos.x - v.pos.x, p.pos.z - v.pos.z) < r && Math.abs(p.pos.y - v.pos.y) < 8);
    for (const id in lv.vis) {
      const v = lv.vis[id];
      const sm = st.marks[id] || (st.marks[id] = {});
      if (v.m.k === 'supply') {
        if (sm.u) continue;
        if (sm.cd > 0) {
          sm.cd -= dt;
          continue;
        }
        v.t = onPad(v, 4) ? v.t + dt : 0;
        if (v.t >= STAND_PAD) {
          v.t = 0;
          for (const p of ps) this.lvRefill(p, 0.5, 0.5);
          this.flashMsg('補給完成：AP 與彈藥 +50%', 0x7ee081, 2);
          SFX.kit();
          if (v.m.once !== false) sm.u = 1;
          else sm.cd = PAD_CD;
          lv.dirty = true;
        }
      } else if (v.m.k === 'term') {
        if (sm.d) continue;
        if (onPad(v, 4)) v.t += dt;
        sm.p = +(v.t / (v.m.t || 4)).toFixed(2);
        if (v.t >= (v.m.t || 4)) {
          sm.d = 1;
          lv.dirty = true;
          this.flashMsg(`${v.m.name || '資料終端'}：完成`, 0x7fc8ff, 2, {
            k: 'good',
            m: '資料回收完成',
            s: v.m.name || '',
          });
          this.lvEmit('term', { m: id });
        }
      } else if (v.m.k === 'exit' && st.exits[id]) {
        v.t = onPad(v, 4.5) ? v.t + dt : 0;
        if (v.t >= STAND_EXIT) {
          v.t = -1e9;
          this.lvEmit('exit', { m: id });
          if (!hasEv(L, 'exit')) return this.lvNextOrWin();
        }
      }
    }
    // 目標設施、防衛目標
    for (const e of [...this.enemies, ...this.allies]) {
      if (!e.dead || !e.edu || !e.edu.m || e.edReported) continue;
      e.edReported = true;
      const k = e.team === 'enemy' ? 'target' : 'defend';
      this.lvEmit(k, { m: e.edu.m });
      if (k === 'defend' && !hasEv(L, 'defend')) return this.lvEnd(false, '防衛目標被摧毀');
    }
    // 玩家倒下（多人：倒地；單人：被擊破）
    const downs = (this.players || []).filter((p) => p.dead || p.downed).length;
    if (downs > st.downs) this.lvEmit('pdown', {});
    st.downs = downs;
    // 護送車輛
    const cv = this.allies.filter((a) => a.ai === 'convoy' && a.edu);
    for (const g of new Set(cv.map((a) => a.edu.g))) {
      const list = cv.filter((a) => a.edu.g === g);
      const alive = list.filter((a) => !a.dead);
      if (alive.length && alive.every((a) => a.arrived) && !st.marks['cv_' + g]) {
        st.marks['cv_' + g] = { d: 1 };
        this.flashMsg('護送車輛抵達', 0x7ee081, 2.2, { k: 'clear', m: '護送完成', s: '' });
        this.lvEmit('convoy', { g });
        if (!hasEv(L, 'convoy') && !hasAct(L, 'win')) return this.lvEnd(true);
      }
      if (!alive.length && !st.marks['cvx_' + g]) {
        st.marks['cvx_' + g] = { d: 1 };
        if (!hasEv(L, 'gdead') && !hasAct(L, 'lose')) return this.lvEnd(false, '護送車輛全毀');
      }
    }
    this.lvTriggers(dt);
    if (lv.ending) return;
    // 預設的勝利：沒有寫「任務成功」「前往下一段」、沒有出口、沒有護送時＝敵人全滅（含目標設施）
    if (!hasAct(L, 'win') && !hasAct(L, 'next') && !L.marks.some((m) => m.k === 'exit') && !cv.length) {
      const alive = this.enemies.filter((e) => !e.dead).length;
      const waiting = L.units.some((u) => u.at === 'trig' && !st.spawned[u.g]);
      if (!alive && !st.pend.length && !waiting && this.missionT > 1) {
        this.flashMsg('任務完成', 0x7ee081, 2, { k: 'done', m: '任務完成' });
        return this.lvNextOrWin(true);
      }
    }
    this.lvVisTick(dt);
  },
  lvRefill(p, hp, ammo) {
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * hp));
    for (const w of Object.values(p.weapons || {}))
      if (w && w.def && w.def.ammo && !w.dropped)
        w.ammo = Math.min(w.def.ammo, w.ammo + Math.ceil(w.def.ammo * ammo));
    this.fx.ring(p.center(), 5, 0x7ee081);
    if (p === this.player) this.renderWeaponHud(true);
  },
  // 外部事件（目標設施被毀、補給箱、物件被破壞…）
  lvEmit(k, d) {
    if (!this.lv || this.isClient) return;
    this.lv.q.push({ k, ...d });
  },
  // 觸發器：輪詢型事件（時間、區域、群組狀態、計數器）看「由假變真」，離散事件看佇列
  lvTriggers(dt) {
    const lv = this.lv,
      st = lv.st,
      L = lv.L;
    const q = lv.q;
    lv.q = [];
    const ps = this.playersAlive().filter((p) => !p.downed);
    for (const tr of L.triggers) {
      if (!st.en[tr.id]) continue;
      if (tr.once && st.fired[tr.id]) continue;
      const ev = tr.ev;
      let hit = false;
      const poll = (now) => {
        const was = !!st.prev[tr.id];
        st.prev[tr.id] = now ? 1 : 0;
        return now && !was;
      };
      switch (ev.k) {
        case 'time':
          hit = poll(this.missionT >= ev.t);
          break;
        case 'every':
          st.every[tr.id] = (st.every[tr.id] || 0) + dt;
          if (st.every[tr.id] >= ev.t) {
            st.every[tr.id] = 0;
            hit = true;
          }
          break;
        case 'enter': {
          const a = L.areas.find((x) => x.id === ev.a);
          if (!a) break;
          const ins = ps.filter((p) => inArea(a, p.pos.x, p.pos.z));
          hit = poll(ev.who === 'all' ? ps.length > 0 && ins.length === ps.length : ins.length > 0);
          break;
        }
        case 'leave': {
          const a = L.areas.find((x) => x.id === ev.a);
          if (!a) break;
          const anyIn = ps.some((p) => inArea(a, p.pos.x, p.pos.z));
          // 先進去過才算離開
          if (anyIn) st.every[tr.id] = 1;
          hit = poll(!anyIn && st.every[tr.id] === 1);
          break;
        }
        case 'gdead':
        case 'gleft':
        case 'ghp': {
          const list = this.lvGroupEnts(ev.g);
          const alive = list.filter((e) => !e.dead);
          const started = st.spawned[ev.g] > 0 && !st.pend.some((p) => p.g === ev.g);
          if (ev.k === 'gdead') hit = poll(started && list.length > 0 && !alive.length);
          else if (ev.k === 'gleft') hit = poll(started && list.length > 0 && alive.length <= ev.n);
          else hit = poll(alive.some((e) => e.hp / e.maxHp < ev.p / 100));
          break;
        }
        case 'counter':
          hit = poll(cmpOp(st.cnt[ev.c] || 0, ev.op, ev.v));
          break;
        case 'start':
        case 'timer':
        case 'pdown':
          hit = q.some((x) => x.k === ev.k);
          break;
        case 'prop':
          hit = q.some((x) => x.k === 'prop' && (!ev.tag || x.tag === ev.tag));
          break;
        case 'trig':
          hit = q.some((x) => x.k === 'trig' && x.tr === ev.tr);
          break;
        case 'convoy':
          hit = q.some((x) => x.k === 'convoy' && (!ev.g || x.g === ev.g));
          break;
        default:
          // target／defend／cache／term／exit：m 空白＝任一
          hit = q.some((x) => x.k === ev.k && (!ev.m || x.m === ev.m));
      }
      if (!hit) continue;
      if (!this.lvConds(tr)) continue;
      st.fired[tr.id] = (st.fired[tr.id] || 0) + 1;
      lv.recent = (lv.recent || []).concat([tr.id]).slice(-4);
      st.run.push({ tr: tr.id, i: 0, w: 0 });
      lv.q.push({ k: 'trig', tr: tr.id });
      lv.dirty = true;
    }
    this.lvRunActs(dt);
  },
  lvConds(tr) {
    if (!tr.cond.length) return true;
    const st = this.lv.st;
    const one = (c) => {
      switch (c.k) {
        case 'counter':
          return cmpOp(st.cnt[c.c] || 0, c.op, c.v);
        case 'galive':
          return cmpOp(this.lvGroupEnts(c.g).filter((e) => !e.dead).length, c.op, c.v);
        case 'players':
          return cmpOp(this.playersAlive().length, c.op, c.v);
        case 'time':
          return cmpOp(this.missionT, c.op, c.v);
        case 'fired':
          return !!st.fired[c.tr] === (c.yes === '1');
      }
      return CONDS[c.k] ? false : true;
    };
    return tr.any ? tr.cond.some(one) : tr.cond.every(one);
  },
  // 執行中的動作清單（等待時停在那一步）
  lvRunActs(dt) {
    const lv = this.lv,
      st = lv.st;
    for (let k = 0; k < st.run.length; k++) {
      const r = st.run[k];
      const tr = lv.L.triggers.find((t) => t.id === r.tr);
      if (!tr) {
        r.done = true;
        continue;
      }
      if (r.w > 0) {
        r.w -= dt;
        if (r.w > 0) continue;
      }
      while (r.i < tr.act.length) {
        const a = tr.act[r.i++];
        if (a.k === 'wait') {
          r.w = a.t;
          lv.dirty = true;
          break;
        }
        this.lvAct(a);
        if (lv.ending || this.lv !== lv) return;
      }
      if (r.i >= tr.act.length && !(r.w > 0)) r.done = true;
    }
    st.run = st.run.filter((r) => !r.done);
  },
  lvAct(a) {
    const lv = this.lv,
      st = lv.st,
      L = lv.L;
    lv.dirty = true;
    switch (a.k) {
      case 'spawn':
        if (a.g) this.lvSpawnGroup(a.g, a.how, a.m, a.warn === '1');
        break;
      case 'beh':
        if (a.g) {
          st.beh[a.g] = { k: a.b, path: a.path, m: a.m, r: 40, speed: 0.6, back: false };
          for (const e of this.lvGroupEnts(a.g)) {
            e.edAlert = a.b === 'attack';
            e.edPi = undefined;
          }
        }
        break;
      case 'remove':
        for (const e of this.lvGroupEnts(a.g)) if (!e.dead) e.depart();
        break;
      case 'obj':
        st.obj = a.text || '';
        if (a.text) SFX.ui();
        break;
      case 'open':
        for (const m of L.marks) if (m.k === 'exit' && (!a.m || m.id === a.m)) st.exits[m.id] = 1;
        this.flashMsg('出口開啟', 0xffb020, 2, { k: 'info', m: '出口開啟', s: '' });
        this.lvSyncVis();
        break;
      case 'win':
        return this.lvNextOrWin(true);
      case 'next':
        return this.lvNextOrWin(true);
      case 'lose':
        return this.lvEnd(false, a.text || '');
      case 'count':
        st.timer = { t: a.t, text: a.text || '', max: a.t };
        break;
      case 'stop':
        st.timer = null;
        break;
      case 'tfx': {
        const k = CUE_K[a.cue] || 'info';
        const txt = a.s ? `${a.m} — ${a.s}` : a.m || '';
        this.flashMsg(txt, COLOR[a.cue] || 0xffb020, 2.6, { k, m: a.m || '', s: a.s || '' });
        break;
      }
      case 'comm': {
        const ev = {
          t: 'lvx',
          a: 'comm',
          sp: SPK[a.who] || 'echo',
          name: a.who === 'custom' ? a.name : '',
          text: a.text || '',
        };
        this.netEv(ev);
        this.lvClientEvent(ev);
        break;
      }
      case 'alarm': {
        const ev = { t: 'lvx', a: 'alarm' };
        this.netEv(ev);
        this.lvClientEvent(ev);
        break;
      }
      case 'shake':
        this.camShake = Math.max(this.camShake, 0.45);
        this.netEv({ t: 'shake', v: 0.45 });
        break;
      case 'area':
        if (a.on === '1') st.areas[a.a] = 1;
        else delete st.areas[a.a];
        this.lvSyncVis();
        break;
      case 'hide':
      case 'show': {
        const ev = { t: 'lvx', a: a.k, tag: a.tag };
        this.netEv(ev);
        this.lvClientEvent(ev);
        break;
      }
      case 'weather': {
        const ev = { t: 'lvx', a: 'weather', w: a.w };
        this.netEv(ev);
        this.lvClientEvent(ev);
        break;
      }
      case 'heal':
        for (const p of this.playersAlive()) {
          p.hp = Math.min(p.maxHp, p.hp + Math.round((p.maxHp * a.p) / 100));
          this.fx.ring(p.center(), 5, 0x7ee081);
        }
        break;
      case 'ammo':
        for (const p of this.playersAlive()) this.lvRefill(p, 0, a.p / 100);
        break;
      case 'set':
        st.cnt[a.c] = a.v;
        break;
      case 'add':
        st.cnt[a.c] = (st.cnt[a.c] || 0) + a.v;
        break;
      case 'enable':
        st.en[a.tr] = a.on === '1';
        if (a.on === '1') delete st.fired[a.tr];
        break;
      default:
        if (!ACTIONS[a.k]) break;
    }
  },
  // ---------- 結束 ----------
  // 還有下一段就轉場，否則成功
  lvNextOrWin() {
    const lv = this.lv;
    if (!lv || lv.ending) return;
    if (lv.seg + 1 < segCount(this.lvFull)) return this.lvGoSeg(lv.seg + 1);
    this.lvEnd(true);
  },
  lvGoSeg(n) {
    const lv = this.lv;
    lv.ending = true;
    this.state = 'ending';
    this.flashMsg('區段清除', 0x7ee081, 2, { k: 'clear', m: '區段清除', s: `前往第 ${n + 1} 段` });
    const carry = {};
    for (const p of this.players || []) carry[p.slot || 0] = this.campCaptureEnt(p, null);
    const t0 = this.missionT;
    setTimeout(() => {
      if (this.lv !== lv) return;
      this.lvBegin(n, carry);
      this.missionT = t0; // 多段出擊的時間累計
    }, 1800);
  },
  lvEnd(success, reason) {
    const lv = this.lv;
    if (!lv || lv.ending) return;
    lv.ending = true;
    this.state = 'ending';
    if (!success)
      this.flashMsg(reason ? `任務失敗 — ${reason}` : '任務失敗', 0xff4d4d, 2.5, {
        k: 'warn',
        m: '任務失敗',
        s: reason || '',
      });
    else if (!this.textfx || !this.textfx.items.some((x) => x.cue === 'done'))
      this.flashMsg('任務完成', 0x7ee081, 2, { k: 'done', m: '任務完成' });
    setTimeout(() => this.lv === lv && this.lvResult(success, reason), 1800);
  },
  lvResult(success, reason) {
    const lv = this.lv,
      full = this.lvFull,
      p = this.player;
    const t = this.missionT;
    const kills = this.enemies.filter((e) => e.dead && !e.gone).length;
    if (lv.test) {
      // 編輯器的試玩：成功時記下通關紀錄，回編輯器
      this.edTestDone(success, t, reason);
      return;
    }
    const src = this.lvOpt && this.lvOpt.src;
    if (src === 'server') LevelStore.played(full.id, success);
    // 本機的通關紀錄（最佳時間）
    if (success) this.lvRecord(full, t);
    const $ = (id) => document.getElementById(id);
    this.state = 'result';
    $('rTitle').textContent = success ? '任務完成' : reason ? '任務失敗' : '任務失敗';
    $('rRank').textContent = success ? 'CLEAR' : '—';
    $('rRank').style.color = success ? '' : '#8a97a6';
    const best = this.lvBest(full.id);
    const rows = [
      ['關卡', full.name],
      ['作者', full.author || '—'],
      ['任務時間', t.toFixed(1) + ' s'],
      ['最佳時間', best ? best.toFixed(1) + ' s' : '—'],
      ['擊破數', String(kills)],
      ['受損 AP', String(Math.round(p ? p.dmgTaken : 0))],
      ['獎勵', '自訂關卡沒有 COAM 與經驗'],
    ];
    if (!success && reason) rows.splice(3, 0, ['原因', reason]);
    $('resultGrid').innerHTML = rows
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    $('pilotResult') && ($('pilotResult').innerHTML = '');
    if (this.net && this.net.role === 'host') {
      $('btnResultOk').textContent = '返回大廳';
      this.net.tr.broadcast({
        t: 'end',
        lv: true,
        success,
        title: $('rTitle').textContent,
        rank: $('rRank').textContent,
        rows,
      });
      for (const x of this.net.players) x.ready = false;
    } else $('btnResultOk').textContent = '返回關卡選單';
    this.lvResultBack = true;
    this.showScreen('result');
  },
  // 多人：客機的結果畫面
  lvClientEnd(d) {
    const $ = (id) => document.getElementById(id);
    this.state = 'result';
    $('rTitle').textContent = d.title;
    $('rRank').textContent = d.rank;
    $('resultGrid').innerHTML = (d.rows || [])
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    $('pilotResult') && ($('pilotResult').innerHTML = '');
    $('btnResultOk').textContent = '返回大廳';
    if (d.success) this.lvRecord(this.lvFull, this.missionT);
    this.showScreen('result');
  },
  // 本機的通關紀錄：localStorage rubicon_lv_best＝{ 關卡 id: 最佳秒數 }
  lvRecord(full, t) {
    if (!full) return;
    try {
      const o = JSON.parse(localStorage.getItem('rubicon_lv_best') || '{}');
      if (!o[full.id] || t < o[full.id]) o[full.id] = +t.toFixed(1);
      localStorage.setItem('rubicon_lv_best', JSON.stringify(o));
    } catch (e) {}
  },
  lvBest(id) {
    try {
      return JSON.parse(localStorage.getItem('rubicon_lv_best') || '{}')[id] || 0;
    } catch (e) {
      return 0;
    }
  },
  // 放棄（暫停選單）
  lvAbort() {
    if (this.lv && this.lv.test) return this.edTestDone(false, this.missionT, '放棄');
    if (this.net && this.net.role === 'host') this.net.tr.broadcast({ t: 'abort', pvp: false, xpBySlot: {} });
    const full = this.lvFull;
    this.clearMission();
    if (this.net && this.net.role) {
      this.state = 'lobby';
      this.showScreen('lobby');
      this.renderLobby();
    } else this.openLevels(full && full.id);
  },
  // clearMission 時
  lvClear() {
    const lv = this.lv;
    if (!lv) return;
    for (const id in lv.vis) if (lv.vis[id].group) this.campDisposeGroup(lv.vis[id].group);
    for (const id in lv.areaMesh || {}) this.campDisposeGroup(lv.areaMesh[id]);
    this.lv = null;
  },
  // ---------- 顯示（房主與客機） ----------
  lvVisTick(dt) {
    const lv = this.lv;
    if (!lv) return;
    const st = lv.st;
    for (const id in lv.vis) {
      const v = lv.vis[id];
      if (v.group && v.group.userData.ring) v.group.userData.ring.rotation.z += dt * 0.8;
    }
    if (this.isClient && st.timer) st.timer.t = Math.max(0, st.timer.t - dt);
    // 目標文字、倒數、資料終端的進度（hud.js 接在左上的任務資訊下面）
    let txt = '';
    if (st.obj) txt += `<div class="lvGoal">${escHtml(st.obj)}</div>`;
    if (st.timer) {
      const s = Math.max(0, Math.ceil(st.timer.t));
      txt += `<div class="lvTimer${s <= 10 ? ' hot' : ''}">${escHtml(st.timer.text || '倒數')}　${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</div>`;
    }
    for (const id in st.marks) {
      const sm = st.marks[id];
      if (sm.p > 0 && !sm.d && lv.vis[id])
        txt += `<div class="lvProg">${escHtml(lv.vis[id].m.name || '資料終端')} ${Math.round(sm.p * 100)}%</div>`;
    }
    // 試玩的除錯：計數器、最近執行的觸發器
    if (lv.test) {
      const cs = lv.L.counters.map((c) => `${c.name || c.id}=${st.cnt[c.id] || 0}`).join('　');
      const rec = (lv.recent || [])
        .map((id) => (lv.L.triggers.find((t) => t.id === id) || {}).name || id)
        .join('、');
      if (cs || rec)
        txt += `<div class="lvDbg">${cs ? '計數器 ' + escHtml(cs) : ''}${rec ? `${cs ? '<br>' : ''}最近觸發 ${escHtml(rec)}` : ''}</div>`;
    }
    lv.hudHtml = txt;
  },
  // 房主：快照的 mis.lv（有變動時每格送，否則每秒一次）
  lvSnap() {
    const lv = this.lv;
    if (!lv) return undefined;
    const now = performance.now();
    if (!lv.dirty && now - lv.sentT < 1000) return undefined;
    lv.dirty = false;
    lv.sentT = now;
    lv.st.v++;
    return lv.st;
  },
  lvClientState(st) {
    const lv = this.lv;
    if (!lv || !st) return;
    lv.st = st;
    this.lvSyncVis();
  },
  // 'lvx' 事件（房主自己也呼叫）
  lvClientEvent(e) {
    if (e.t !== 'lvx') return false;
    const w = this.world;
    switch (e.a) {
      case 'comm':
        if (e.text) this.commSay(e.sp, e.text, e.name);
        break;
      case 'alarm':
        SFX.alert();
        SFX.waveAlert(0, true);
        break;
      case 'wave':
        this.lvWarnShow(e);
        break;
      case 'hide':
      case 'show':
        for (const r of (w && w.lvProps) || [])
          if (r && e.tag && r.tag === e.tag) setPlacedVisible(w, r, e.a === 'show');
        break;
      case 'weather':
        if (w) w.setWeather(e.w);
        break;
    }
    return true;
  },
  // 增援的預告（ECHO 的方向、畫面上的標記；同 waves.js 的 waveShow，不帶第幾波）
  lvWarnShow(ev) {
    const pos = new THREE.Vector3(ev.p[0], 0, ev.p[1]);
    if (this.world) pos.y = this.world.groundAt(pos.x, pos.z, 99) + 2;
    this.waveMarks = (this.waveMarks || []).concat([{ pos, t: 7, drop: !!ev.d }]);
    const me = this.player && !this.player.dead ? this.player.pos : this.camera.position;
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const vx = pos.x - me.x,
      vz = pos.z - me.z;
    const ang = Math.atan2(vx * -f.z + vz * f.x, vx * f.x + vz * f.z);
    let clock = Math.round(ang / (Math.PI / 6));
    if (clock <= 0) clock += 12;
    const dist = Math.round(Math.hypot(vx, vz));
    SFX.waveAlert(Math.sin(ang), false);
    this.commSay(
      'echo',
      ev.d
        ? `運輸機在 ${clock} 點鐘方向空降 ${ev.n} 機，距離 ${dist} m！`
        : `敵方增援 ${ev.n} 機從 ${clock} 點鐘方向接近，距離 ${dist} m。`,
    );
  },
  // ---------- 多人 ----------
  // 客機開局：World 的參數換成關卡的；建好之後放物件與光環
  lvClientWopt(d) {
    if (!d.lvh) return null;
    const full = this.lvLib && this.lvLib[d.lvh];
    if (!full) return null;
    this.lvFull = full;
    this.lvHash = d.lvh;
    return { ...(d.wopt || {}), ...levelWorldOpt(segOf(full, d.lvSeg || 0)) };
  },
  lvClientStart(d) {
    this.lv = null;
    if (!d.lvh || !this.lvFull) return;
    const L = segOf(this.lvFull, d.lvSeg || 0);
    applyLevelProps(this.world, L);
    this.lv = this.lvState(L, d.lvSeg || 0, {});
    this.lvBuildMarks(false);
    if (d.lvName) this.levelName = d.lvName;
  },
  // 房主遷移：客機收到的最後一份觸發器狀態（lvClientState 存在 lv.st）就是權威狀態，從這裡接手
  lvPromote() {
    const lv = this.lv;
    if (!lv) return;
    lv.st = JSON.parse(JSON.stringify(lv.st));
    lv.dirty = true;
    // 護送車輛的路徑、單位的群組
    for (const e of [...this.enemies, ...this.allies]) {
      const r = this.net.spawnReg[e.id];
      if (r && r.edu) e.edu = { ...r.edu };
      if (e.ai === 'convoy' && e.edu) {
        const u = lv.L.units.find((x) => x.id === e.edu.u);
        const P = u && lv.L.paths.find((p) => p.id === u.beh.path);
        if (P)
          e.opts.path = P.pts.map((q) => new THREE.Vector3(q[0], this.world.groundAt(q[0], q[1], 99), q[1]));
        e.opts.convoySpeed = 0.32;
      }
    }
    // 補給箱：已經由 cache 事件建好（房主遷移後由新房主判定）
  },
  // 生成紀錄的 edu（mp-host.js 的 registerSpawn）：生成中的單位帶上關卡的單位與群組
  lvEdu(e) {
    if (!this.lv) return null;
    if (this.lvSpawnU && !e.edu && e.team !== 'player') e.edu = { ...this.lvSpawnU };
    return e.edu ? { ...e.edu } : null;
  },
  // 物件被破壞（map-extras.js 的 damageProp 呼叫）
  lvPropDown(p) {
    if (this.lv) this.lvEmit('prop', { tag: p.lvTag || '' });
  },
});
