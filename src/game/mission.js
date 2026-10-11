// Game：任務流程、敵人生成、道具與支援
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp, pick, rnd } from '../core/math.js';
import {
  AC_NAMES,
  AC_ROSTER,
  DUO_BOSS,
  ENEMY_TYPES,
  FOE_HP_K,
  bossForLevel,
  enemyScale,
  isBossLevel,
} from '../data/enemies.js';
import { CONSUMABLES, FOE_STAB_K, PARTS, partById } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { Projectile } from '../entities/projectile.js';
import { buildBomberMesh } from '../render/extra-models.js';
import { PALETTES } from '../render/materials.js';
import { FOES, themeFoes } from '../data/foes.js';
import { VARIANTS, variantKeys } from '../world/variants.js';
import { THEMES, World, corridorSpec } from '../world/world.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  useKit() {
    const p = this.player;
    if (this.net && this.net.role && this.players) {
      if (this.net.role === 'host') {
        if (this.tryRevive(p, 0)) return;
      }
      if (this.net.role === 'client') {
        this.kitPressed = true;
        setTimeout(() => (this.kitPressed = false), 150);
        return;
      }
    }
    if (p.kits <= 0 || p.hp >= p.maxHp || p.dead || p.downed) return;
    p.kits--;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * p.kitHeal));
    p.en = Math.min(p.enMax, p.en + p.enMax * p.pmv('kitEn'));
    this.fx.ring(p.center(), 5, 0x7ee081);
    SFX.kit();
    this.rumble(0.15, 0.4, 180);
    this.flashMsg('修復完成', 0x7ee081, 0.8);
  },
  useConsumable(slot) {
    if (this.lab) return this.flashMsg('渲染風格實驗室不能使用消耗品', 0xff8a8a, 1);
    const p = this.player;
    if (!p || p.dead || p.downed || this.state !== 'play') return;
    if (this.pvp && this.save.asm[slot] === 'cs_ally') {
      this.flashMsg('PVP 中不能使用友軍 AC', 0xff4d4d, 1);
      return;
    }
    if (this.net && this.net.role === 'client') {
      const id = this.save.asm[slot];
      const n = this.save.items[id] || 0;
      if (id === 'cs_none' || n <= 0) {
        this.flashMsg('消耗品已用完', 0xff4d4d, 0.8);
        return;
      }
      this.save.items[id] = n - 1;
      this.writeSave();
      if (slot === 'c1') {
        this.cs1Pressed = true;
        setTimeout(() => (this.cs1Pressed = false), 150);
      } else {
        this.cs2Pressed = true;
        setTimeout(() => (this.cs2Pressed = false), 150);
      }
      return;
    }
    const id = this.save.asm[slot];
    const def = CONSUMABLES.find((c) => c.id === id);
    if (!def || id === 'cs_none') return;
    const n = this.save.items[id] || 0;
    this.csCd = this.csCd || {};
    if ((this.csCd[slot] || 0) > 0) return;
    if (n <= 0) {
      this.flashMsg('消耗品已用完', 0xff4d4d, 0.8);
      return;
    }
    this.save.items[id] = n - 1;
    this.csCd[slot] = 4;
    this.writeSave();
    SFX.ui();
    if (id === 'cs_bomber') this.callBomber();
    else if (id === 'cs_ally') this.callAlly(def);
  },
  callBomber() {
    const p = this.player;
    const tgt = p.lock && !p.lock.dead ? p.lock.pos.clone() : this.mouseWorld.clone();
    tgt.y = this.world.terrainHeight(tgt.x, tgt.z);
    let dir = tgt.clone().sub(p.pos);
    dir.y = 0;
    if (dir.length() < 3) dir.set(-Math.sin(p.aimYaw), 0, -Math.cos(p.aimYaw));
    dir.normalize();
    this.flashMsg('AIRSTRIKE 轟炸機接近中', 0xffb020, 1.6);
    SFX.bomber(tgt.clone().setY(tgt.y + 30));
    // warning rings along path
    for (let i = -5; i <= 6; i++) {
      const q = tgt.clone().addScaledVector(dir, i * 7);
      q.y = this.world.terrainHeight(q.x, q.z) + 0.15;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.2, 6.2, 32),
        new THREE.MeshBasicMaterial({
          color: 0xff3030,
          transparent: true,
          opacity: 0.7,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.position.copy(q);
      ring.rotation.x = -Math.PI / 2;
      this.fx.add(ring, 1.6, (e, t) => {
        e.mesh.material.opacity = 0.7 * (0.5 + 0.5 * Math.sin(t * 40));
        e.mesh.scale.setScalar(1 - t * 0.15);
      });
    }
    // bomber mesh
    const bm = buildBomberMesh();
    const alt = 30,
      speed = 48,
      startD = -95,
      endD = 95;
    bm.position.copy(tgt).addScaledVector(dir, startD);
    bm.position.y = alt;
    bm.lookAt(bm.position.clone().add(dir));
    bm.rotation.y += Math.PI;
    this.scene.add(bm);
    const startT = this.time;
    const total = (endD - startD) / speed;
    let dropped = 0;
    const dropStart = -72,
      dropEnd = 8;
    const self = this;
    this.bomberActive = true;
    setTimeout(() => {
      this.bomberActive = false;
    }, total * 1000);
    this.netEv({ t: 'bomber' });
    this.fx.list.push({
      mesh: bm,
      life: total,
      max: total,
      fn: (e, t, dt) => {
        const dcur = startD + (endD - startD) * t;
        bm.position.copy(tgt).addScaledVector(dir, dcur);
        bm.position.y = alt + Math.sin(t * 6) * 0.4;
        if (Math.random() < dt * 30)
          for (const sx of [-7, 7]) {
            self.fx.smoke(
              bm.position.clone().add(new THREE.Vector3(dir.z * sx, -0.5, -dir.x * sx)),
              0.8,
              0xb0b4ba,
              1.4,
              0.5,
            );
          }
        const want = Math.floor(clamp((dcur - dropStart) / (dropEnd - dropStart), 0, 1) * 12);
        while (dropped < want && dcur <= dropEnd) {
          dropped++;
          const bp = bm.position.clone();
          bp.y -= 1.5;
          self.projectiles.push(
            new Projectile(self, {
              pos: bp,
              vel: dir
                .clone()
                .multiplyScalar(speed * 0.5)
                .add(new THREE.Vector3(rnd(-2, 2), -4, rnd(-2, 2))),
              kind: 'shell',
              dmg: 900 * (1 + (self.save.level - 1) * 0.05),
              impactV: 700,
              team: 'player',
              owner: self.player,
              color: 0xffa040,
              life: 6,
              splash: 7,
              gravity: 30,
            }),
          );
        }
      },
    });
  },
  callAlly(def) {
    const p = this.player;
    const asm = {
      head: pick(PARTS.head).id,
      core: pick(PARTS.core).id,
      arms: pick(PARTS.arms).id,
      legs: pick(PARTS.legs.filter((l) => l.type !== 'tank')).id,
      booster: pick(PARTS.booster).id,
      generator: 'g_hi',
      fcs: pick(PARTS.fcs).id,
      rarm: pick(PARTS.arm.filter((w) => w.type !== 'none' && w.type !== 'melee')).id,
      larm: pick(PARTS.arm.filter((w) => w.type !== 'none')).id,
      rback: pick(
        PARTS.back.filter((w) => w.type === 'missile' || w.type === 'grenade' || w.type === 'laser'),
      ).id,
      lback: pick(PARTS.back).id,
    };
    const a = new MechEntity(this, asm, PALETTES.ally, {
      team: 'ally',
      palKey: 'ally',
      name: pick(AC_NAMES) + ' (友軍)',
      ai: 'ac',
      hpMul: 1.3 * (1 + (this.save.level - 1) * 0.08),
      dmgMul: 0.9 * (1 + (this.save.level - 1) * 0.05),
      stabMul: 1.4,
      wantDist: 20,
      allyDur: def.dur || 45,
    });
    const ang = Math.random() * 6.28;
    const sx = p.pos.x + Math.cos(ang) * 6,
      sz = p.pos.z + Math.sin(ang) * 6;
    const [cx, cz] = this.world.collide(sx, sz, 50, 1.5);
    a.pos.set(cx, this.world.terrainHeight(cx, cz) + 40, cz);
    a.vel.y = -30;
    a.mesh.position.copy(a.pos);
    a.kits = 0;
    this.allies.push(a);
    this.registerSpawn(a);
    this.flashMsg(`友軍 ${a.name} 空降支援 — ${def.dur || 45} 秒`, 0x80ffb0, 2);
    SFX.ally(a.pos.clone());
    this.fx.ring(new THREE.Vector3(cx, this.world.terrainHeight(cx, cz) + 0.1, cz), 6, 0x80ffb0);
  },

  // ---------- 地圖選擇（localStorage rubicon_map：主題 key，空字串＝隨機）----------
  mapPref() {
    try {
      const k = localStorage.getItem('rubicon_map') || '';
      return THEMES[k] ? k : '';
    } catch (e) {
      return '';
    }
  },
  setMapPref(k) {
    try {
      localStorage.setItem('rubicon_map', THEMES[k] ? k : '');
    } catch (e) {}
  },
  mapName(k) {
    return THEMES[k] ? THEMES[k].name : '隨機';
  },
  // 主題變體（localStorage rubicon_variant：''＝隨機、'base'＝標準、其餘＝變體 key）
  variantPref() {
    try {
      return localStorage.getItem('rubicon_variant') || '';
    } catch (e) {
      return '';
    }
  },
  setVariantPref(k) {
    try {
      localStorage.setItem('rubicon_variant', k || '');
    } catch (e) {}
  },
  // 依選擇決定這次的變體：隨機時一半標準、一半隨機變體；選的變體不屬於這個主題時用標準
  resolveVariant(theme, want) {
    const ks = variantKeys(theme).filter((k) => !VARIANTS[theme][k].border);
    if (!want) return ks.length && Math.random() < 0.5 ? pick(ks) : '';
    return ks.includes(want) ? want : '';
  },
  variantName(theme, k) {
    return (VARIANTS[theme] && VARIANTS[theme][k] && VARIANTS[theme][k].name) || '';
  },
  mapOptionsHtml() {
    return (
      '<option value="">隨機</option>' +
      Object.keys(THEMES)
        .map((k) => `<option value="${k}">${escHtml(THEMES[k].name)}</option>`)
        .join('')
    );
  },

  // ---------- mission ----------
  startMission() {
    const S = this.save;
    const L = S.level;
    const mp0 = !!(this.net && this.net.role === 'host');
    // 多人主線：房主的進度（campaign-mp.js）
    if (mp0 && this.net.pvpSet && this.net.pvpSet.mode === 'story')
      return this.campBeginMp(this.net.pvpSet.sid);
    const boss = isBossLevel(L) && !(mp0 && this.net.pvpSet && this.net.pvpSet.mode === 'pvp');
    const bd0 = boss ? bossForLevel(L) : null;
    this.clearMission();
    // 地圖：單人用車庫選的，多人用房主在大廳選的；沒選（隨機）或不認得時隨機
    const want = mp0 ? (this.net.pvpSet || {}).map : this.mapPref();
    // 有些 Boss 不能在某些地圖（例：會鑽地、衝撞的 Boss 不排在有虛空的地圖）：主題的 bossBan
    // 武裝列車只排在允許鐵路的地圖
    const fits = (k) =>
      !(bd0 && (THEMES[k].bossBan || []).includes(bd0.kind)) &&
      !(bd0 && bd0.rail && !corridorSpec(THEMES[k]).kinds.includes('rail'));
    let theme = THEMES[want] ? want : pick(Object.keys(THEMES).filter(fits));
    if (!fits(theme)) {
      const alt = pick(Object.keys(THEMES).filter(fits));
      this.flashMsg(
        `${bd0.name} 不適合在「${THEMES[theme].name}」作戰，改到「${THEMES[alt].name}」`,
        0xffb020,
        4,
      );
      theme = alt;
    }
    const seed = Math.floor(Math.random() * 1e9);
    this.worldSeed = seed;
    this.worldTheme = theme;
    this.styleRefresh(); // 渲染風格只在出擊時套用，任務中不換
    const variant = this.resolveVariant(theme, mp0 ? (this.net.pvpSet || {}).variant : this.variantPref());
    // 武裝列車：地圖一定有鐵路（客機收到開局訊息的地形特徵，跟著一致）
    this.world = new World(this.scene, theme, seed, L, null, { rail: !!(bd0 && bd0.rail), variant });
    this.isClient = false;
    const mp = !!(this.net && this.net.role === 'host');
    this.net.spawnReg = {};
    this.mpStats = {};
    const T = this.world.theme;
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    if (mp && this.net.pvpSet && this.net.pvpSet.mode === 'pvp') {
      this.pvpSet = this.net.pvpSet;
      this.startPvp(L);
      this.state = 'play';
      this.showScreen('');
      this.lastT = performance.now();
      this.camZoom = 1;
      this.camera.position.set(0, 40, 24);
      this.renderWeaponHud(true);
      this.fp = false;
      this.fpShow();
      if (this.ctrl.view === 'fps') this.setFp(true);
      this.levelName =
        T.name + (this.world.featureNames.length ? '・' + this.world.featureNames.join('／') : '');
      this.flashMsg('PVP 對戰 — ' + T.name, 0xff4d4d, 2.2);
      return;
    }
    if (mp) {
      this.mpSpawnPlayers();
      for (const e of this.players)
        this.mpStats[e.slot] = { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} };
    } else {
      this.player = new MechEntity(this, S.asm, PALETTES.player, {
        team: 'player',
        name: 'RAVEN',
        palKey: 'player',
        slot: 0,
        pilot: this.pilotLocalMods('pve'),
      });
      this.player.pos.set(0, this.world.terrainHeight(0, 0), 0);
      this.players = [this.player];
      this.mpStats[0] = { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} };
    }
    const np = mp ? this.players.length : 1;
    this.enemies = [];
    this.waves = [];
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.missionEarned = 0;
    this.bountyPops = [];
    this.levelName =
      T.name +
      (variant ? '・' + this.variantName(theme, variant) : '') +
      (this.world.featureNames.length ? '・' + this.world.featureNames.join('／') : '');
    this.isBossLevel = boss;
    this.enemyPointsTotal = 0;
    const sc = enemyScale(L, np),
      scaleHp = sc.hp,
      scaleDmg = sc.dmg;
    if (boss) this.spawnBossDef(bd0, scaleHp, scaleDmg);
    else this.spawnComp(this.foeMix(this.rollComp(L, np), theme, 0, true), np, scaleHp, scaleDmg);
    this.scaleHp = scaleHp;
    this.scaleDmg = scaleDmg;
    this.waveAlerted = false;
    this.planVehicles();
    if (this.bossDef && this.bossDef.rail && boss) this.vehPlan = []; // 武裝列車佔用鐵路：不開運輸列車
    if (mp) {
      this.net.tr.broadcast({
        t: 'start',
        pace: this.ctrl.pace || 1,
        seed,
        theme,
        variant: this.world.variantKey,
        feat: this.world.features.map((f) => ({
          k: f.k,
          kind: f.kind,
          dir: f.dir ? [f.dir.x, f.dir.y] : 0,
          perp: f.perp ? [f.perp.x, f.perp.y] : 0,
          off: f.off,
          width: f.width,
          depth: f.depth,
          bridges: f.bridges,
          deckW: f.deckW,
          center: f.center,
          span: f.span,
          rampL: f.rampL,
          deckH: f.deckH,
          count: f.count,
          len: f.len,
        })),
        level: L,
        players: this.net.players.map((p) => ({ slot: p.slot, nick: p.nick, color: p.color })),
        spawns: Object.values(this.net.spawnReg),
        bossName: this.bossDef ? this.bossDef.name : '',
      });
      this.netEvents = [];
    }
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.fp = false;
    this.fpShow();
    if (this.ctrl.view === 'fps') this.setFp(true);
    this.flashMsg(
      (boss ? '決戰任務 ' : '任務 ') + String(L).padStart(2, '0') + ' — ' + T.name,
      0xffb020,
      2.2,
    );
    document.getElementById('bossBar').style.display = boss ? 'block' : 'none';
    if (boss) document.getElementById('bossName').textContent = this.bossDef.name;
  },
  // Boss 關：生成 Boss（新 Boss 交給 spawnBossKind）與兩波增援（主線的 Boss 區段共用）
  spawnBossDef(bd, scaleHp, scaleDmg) {
    this.bossDef = bd;
    this.bosses = [];
    if (bd.kind === 'heli') {
      const b = this.spawnEnemy({
        name: bd.name,
        asm: bd.asm,
        pal: 'helios',
        scale: bd.scale,
        hpMul: bd.hpMul * scaleHp,
        dmgMul: bd.dmgMul * scaleDmg,
        stabMul: bd.stabMul,
        ai: 'heli',
        flying: true,
        hoverH: 10,
        modelKind: 'heli',
        radius: 2.2,
        wantDist: bd.wantDist,
        speedMul: bd.speedMul,
        isBoss: true,
        extraWeapons: { larm: 'w_bz' },
        bossKind: 'heli',
      });
      this.bosses.push(b);
      this.boss = b;
    } else if (bd.kind === 'duo') {
      for (const D of DUO_BOSS) {
        const b = this.spawnEnemy({
          name: D.name,
          asm: D.asm,
          pal: D.pal,
          scale: bd.scale,
          hpMul: bd.hpMul * scaleHp,
          dmgMul: bd.dmgMul * scaleDmg,
          stabMul: bd.stabMul,
          ai: D.ai,
          wantDist: D.wantDist,
          speedMul: D.speedMul,
          isBoss: true,
          bossKind: 'duo',
        });
        b.kits = 0;
        this.bosses.push(b);
      }
      this.boss = this.bosses[0];
    } else if (bd.kind) {
      // 新 Boss（game/bosses.js）
      const b = this.spawnBossKind(bd, scaleHp, scaleDmg);
      this.bosses.push(b);
      this.boss = b;
    } else {
      const b = this.spawnEnemy({
        name: bd.name,
        asm: bd.asm,
        pal: 'boss',
        scale: bd.scale,
        hpMul: bd.hpMul * scaleHp,
        dmgMul: bd.dmgMul * scaleDmg,
        stabMul: bd.stabMul,
        ai: 'ac',
        wantDist: bd.wantDist,
        speedMul: bd.speedMul,
        isBoss: true,
      });
      b.kits = 0;
      this.bosses.push(b);
      this.boss = b;
    }
    this.waves = [
      ['mt', 'mt'],
      ['drone', 'drone', 'mth'],
    ];
  },
  // 一般關卡的敵人編成（依等級的點數與人數）
  rollComp(L, np) {
    let pts = (4 + L * 1.5) * np;
    const comp = [];
    const types = Object.keys(ENEMY_TYPES);
    if (L >= 2) {
      comp.push('ac');
      pts -= 3.5;
    }
    let guard = 0;
    while (pts > 0.9 && guard++ < 30) {
      const cand = types.filter(
        (k) =>
          ENEMY_TYPES[k].cost <= pts + 0.5 &&
          (!(k === 'ac' || ENEMY_TYPES[k].roster) || Math.random() < 0.3) &&
          (!ENEMY_TYPES[k].support || comp.some((c) => !ENEMY_TYPES[c].support)) &&
          !(comp.filter((c) => c === k).length >= 2 && ENEMY_TYPES[k].roster),
      );
      if (!cand.length) break;
      const t = pick(cand);
      comp.push(t);
      pts -= ENEMY_TYPES[t].cost;
    }
    comp.sort(() => Math.random() - 0.5);
    return comp;
  },
  // 先生成一部分，其餘當增援波次
  spawnComp(comp, np, scaleHp, scaleDmg) {
    if (np > 1) {
      const third = Math.ceil(comp.length / 3);
      this.waves = [comp.slice(third, third * 2), comp.slice(third * 2)].filter((w) => w.length);
      for (const t of comp.slice(0, third)) this.spawnType(t, scaleHp, scaleDmg);
    } else {
      const half = Math.ceil(comp.length / 2);
      this.waves = [comp.slice(half)];
      for (const t of comp.slice(0, half)) this.spawnType(t, scaleHp, scaleDmg);
    }
  },
  // at：指定生成位置（運輸機投放）；count：覆寫編隊數量
  // 主題專屬敵人混進編成（約 35%）：主線依主題與深度；自由出擊只放主線遇過的（onlySeen）
  foeMix(comp, theme, depth = 0, onlySeen = false) {
    let foes = themeFoes(theme, depth);
    if (onlySeen) {
      const seen = ((this.save.story || {}).seen2 || {}).foes || {};
      foes = foes.filter((k) => seen[k]);
    }
    if (!foes.length || !comp.length) return comp;
    const out = comp.slice();
    const idx = out.map((t, i) => i).filter((i) => !(out[i] === 'ac' || (ENEMY_TYPES[out[i]] || {}).roster));
    const n = Math.min(idx.length, Math.round(out.length * 0.35) + 1);
    const cnt = {};
    const ok = (k) => !FOES[k].max || (cnt[k] || 0) < FOES[k].max; // 一波最多幾台（起重機砲台…）
    for (let k = 0; k < n; k++) {
      const j = idx.splice(Math.floor(Math.random() * idx.length), 1)[0];
      if (j === undefined) continue;
      let f = pick(foes);
      if (!ok(f)) {
        const alt = foes.filter(ok);
        if (!alt.length) continue;
        f = pick(alt);
      }
      cnt[f] = (cnt[f] || 0) + 1;
      out[j] = f;
    }
    return out;
  },
  spawnType(t, scaleHp, scaleDmg, at, count) {
    const d = ENEMY_TYPES[t] || FOES[t];
    if (FOES[t] && this.simMark && !this.sim) this.simMark('foes', t); // 遇過的專屬敵人（模擬器、自由出擊）
    // 新類型第一次出現：提示打法
    if (d.intro && !d.roster) {
      if (!this.introSeen) this.introSeen = new Set();
      if (!this.introSeen.has(t)) {
        this.introSeen.add(t);
        this.alertAll(d.intro);
      }
    }
    if (d.roster) {
      const r = AC_ROSTER[d.roster];
      const e = this.spawnEnemy({
        name: r.name,
        asm: r.asm,
        pal: r.pal,
        scale: d.scale,
        hpMul: r.hpMul * scaleHp * 0.85,
        dmgMul: r.dmgMul * scaleDmg,
        stabMul: r.stabMul * FOE_STAB_K,
        ai: r.ai,
        wantDist: r.wantDist,
        speedMul: r.speedMul,
        turnRate: r.turnRate,
      });
      this.flashMsg(`敵對 AC「${r.name}」介入`, 0xff4d4d, 2.2);
      this.flashAlert(r.intro);
      return e;
    }
    const n = count || d.group || 1;
    let last = null;
    const a0 = Math.random() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const asm = d.gen();
      last = this.spawnEnemy({
        name: d.name,
        asm,
        pal: d.pal,
        scale: d.scale,
        hpMul: d.hpMul * scaleHp * FOE_HP_K,
        dmgMul: d.dmgMul * scaleDmg,
        stabMul: d.stabMul * FOE_STAB_K,
        ai: d.ai,
        flying: d.flying,
        hoverH: d.hoverH,
        modelKind: d.modelKind,
        vehKey: d.vehKey,
        cargo: d.cargo,
        radius: d.radius,
        turnRate: d.turnRate,
        wantDist: d.wantDist,
        speedMul: d.speedMul,
        explodeOnDeath: d.explodeOnDeath,
        foe: d.foe,
        perch: d.perch,
        extraWeapons: d.extraWeapons,
        flankAngle: a0 + i * ((Math.PI * 2) / n),
        at: at ? at.clone().add(new THREE.Vector3(i * 1.5, 0, 0)) : null,
      });
    }
    if (n > 1 && !at) this.flashAlert(`${d.name} ×${n} 編隊`);
    return last;
  },
  spawnEnemy(o) {
    o.palKey = o.pal;
    const e = new MechEntity(this, o.asm, PALETTES[o.pal], o);
    let sp = this.world.spawnPoint(
      this.player.pos,
      this.enemies.map((x) => x.pos),
    );
    let y = this.world.terrainHeight(sp.x, sp.z) + (o.flying ? o.hoverH || 6 : 0);
    if (o.at) {
      sp = { x: o.at.x, z: o.at.z };
      y = Math.max(o.at.y, this.world.terrainHeight(sp.x, sp.z));
    } else if (o.perch === 'dam' && this.world.dam) {
      // 壩頂巡邏砲車：站上壩頂（找不到時照一般的高處）
      const W = this.world;
      for (let t = 0; t < 20; t++) {
        const x = rnd(-W.lim * 0.8, W.lim * 0.8),
          z = W.dam.zc;
        const top = W.groundAt(x, z, 40);
        if (top > W.terrainHeight(x, z) + 6 && W.inZone(x, z, 3)) {
          sp = { x, z };
          y = top;
          break;
        }
      }
    }
    if (o.perch && y < this.world.terrainHeight(sp.x, sp.z) + 1 && !o.at) {
      const decks = this.world.obstacles.filter(
        (ob) =>
          ob.kind === 'box' &&
          this.world.inZone(ob.x, ob.z, 3) &&
          ob.top > this.world.terrainHeight(ob.x, ob.z) + 2.5 &&
          ob.top < this.world.terrainHeight(ob.x, ob.z) + 25 && // 太高的（發射塔、高樓頂）不站
          !this.world.isVoid(ob.x, ob.z) &&
          Math.hypot(ob.x - this.player.pos.x, ob.z - this.player.pos.z) > 20,
      );
      if (decks.length) {
        const d = pick(decks);
        sp = { x: d.x + rnd(-d.w * 0.25, d.w * 0.25), z: d.z + rnd(-d.d * 0.25, d.d * 0.25) };
        y = d.top;
      }
    }
    if (o.extraWeapons) {
      for (const k in o.extraWeapons) {
        const def = partById('arm', o.extraWeapons[k]);
        e.weapons[k] = {
          def,
          ammo: def.ammo || 0,
          mag: def.mag || 0,
          cd: 0,
          reloadT: 0,
          charge: 0,
          charging: false,
          side: k[0] === 'r' ? 1 : -1,
          slot: k,
        };
      }
    }
    e.pos.set(sp.x, y, sp.z);
    this.registerSpawn(e);
    e.yaw = e.aimYaw = Math.atan2(-(0 - sp.x), -(0 - sp.z));
    e.mesh.position.copy(e.pos);
    this.enemies.push(e);
    this.fx.ring(e.pos.clone(), 4, 0xff4040);
    return e;
  },
  onEnemyKilled(e, from) {
    if (this.lab) return; // 渲染風格實驗室的模擬戰鬥：不計入存檔
    this.foeScavenge(e);
    // 主線的戰術模組「回收迴路」：擊破時回復 AP
    if (from && from.pmv && !from.dead && from.pmv('killHeal') > 0)
      from.hp = Math.min(from.maxHp, from.hp + from.maxHp * from.pmv('killHeal'));
    this.save.kills++;
    if (this.mpStats && from && from.team === 'player' && this.mpStats[from.slot])
      this.mpStats[from.slot].kills++;
    this.pilotCreditKill(from, e);
    if (e.isBoss) {
      if (!this.bosses || this.bosses.every((b) => b.dead)) {
        this.save.bosses++;
        this.waves = [];
      } else
        this.flashMsg(
          `${e.name} 已擊破 — 剩餘 ${this.bosses
            .filter((b) => !b.dead)
            .map((b) => b.name)
            .join(', ')}`,
          0xffb020,
          2,
        );
    }
    const bounty = Math.round((e.isBoss ? e.maxHp * 2.2 : e.maxHp * 1.8) / 100) * 100;
    this.save.coam += bounty;
    this.missionEarned = (this.missionEarned || 0) + bounty;
    this.writeSave();
    this.netEv({ t: 'bounty', v: bounty });
    this.bountyPops.push({ txt: '+' + bounty.toLocaleString() + ' COAM', life: 2.2, y: 0 });
  },
  // 拾荒 MT：附近的同伴被擊破時撿零件強化（最多 3 次）
  foeScavenge(dead) {
    for (const s of this.enemies) {
      if (s.dead || s === dead || s.opts.foe !== 'scav' || (s.scavN || 0) >= 3) continue;
      if (s.pos.distanceTo(dead.pos) > 18) continue;
      s.scavN = (s.scavN || 0) + 1;
      s.maxHp = Math.round(s.maxHp * 1.25);
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.3);
      s.dmgMul *= 1.12;
      this.fx.ring(s.center(), 3, 0xc8702a);
      if (!this.scavTold) {
        this.scavTold = true;
        this.flashAlert('拾荒 MT 撿起零件強化了');
      }
      break;
    }
  },
  onPlayerDead() {
    if (this.lab) return; // 實驗室：由 labTick 重新空降
    if (this.sim) {
      this.flashMsg('AC 已被擊破', 0xff4d4d, 2);
      return setTimeout(() => this.sim && this.simEnd(false), 1800); // 模擬戰
    }
    if (this.camp) {
      this.flashMsg('AC 已被擊破', 0xff4d4d, 3);
      if (this.campMp()) return; // 多人：全員倒下才算失敗（game.js 的主迴圈）
      return this.campDead(); // 主線：回機庫，從紀錄點重來
    }
    this.flashMsg('AC 已被擊破', 0xff4d4d, 3);
    setTimeout(() => {
      if (this.state === 'play') this.endMission(false, false);
    }, 2600);
  },
  clearMission() {
    this.rangeRing.visible = false;
    this.campClearExits();
    this.campClearClientVis();
    SFX.stopLoops();
    this.pvp = false;
    this.pvpOver = false;
    if (this.fp) this.setFp(false);
    this.fpShow();
    for (const v of this.vehicles || []) v.cleanup();
    this.vehicles = [];
    for (const p of this.pickups || []) p.remove();
    this.pickups = [];
    this.vehPlan = [];
    document.getElementById('hudBottom').style.display = '';
    document.getElementById('weapons').style.display = '';
    for (const a of this.allies) a.cleanup();
    this.allies = [];
    this.csCd = {};
    if (this.players) for (const p of this.players) if (p !== this.player) p.cleanup();
    this.players = [];
    this.isClient = false;
    this.freezeT = 0;
    this.bomberActive = false;
    if (this.world) {
      this.world.dispose();
      this.world = null;
    }
    for (const e of this.enemies) e.cleanup();
    this.enemies = [];
    if (this.player) {
      this.player.cleanup();
      this.player = null;
    }
    for (const p of this.projectiles) this.scene.remove(p.mesh);
    this.projectiles = [];
    this.shocks = [];
    this.clearSupport();
    this.clearHazards();
    this.introSeen = null;
    this.fx.clear();
    this.popups = [];
  },
  endMission(success, aborted) {
    const S = this.save,
      L = S.level,
      p = this.player;
    this.state = 'result';
    const $ = (id) => document.getElementById(id);
    let bonus = 0,
      rank = '—';
    const bossMul = this.isBossLevel ? 2.5 : 1;
    const earned = this.missionEarned || 0;
    const xpAll = this.pilotEndXpPve(success, aborted); // 要在關卡前進之前計算
    let baseBonus = 0;
    if (success) {
      bonus = Math.round((8000 + L * 2500) * bossMul);
      const score = (p.dmgTaken / p.maxHp) * 0.6 + (Math.max(0, this.missionT - 90) / 180) * 0.4;
      rank = score < 0.25 ? 'S' : score < 0.5 ? 'A' : score < 0.85 ? 'B' : 'C';
      const mul = { S: 1.5, A: 1.2, B: 1, C: 0.8 }[rank];
      baseBonus = Math.round(bonus * mul);
      bonus = Math.round(baseBonus * (1 + p.pmv('coam'))); // 駕駛員技能「報酬交涉」只加在自己身上
      S.coam += bonus;
      S.level++;
      S.missionsDone++;
    }
    this.writeSave();
    // PvP 中途放棄也會走到這裡：經驗記到對應模式的駕駛員
    this.pilotRenderResult(this.pilotGrant(this.pvp ? 'pvp' : 'pve', xpAll[p ? p.slot : 0]));
    $('rTitle').textContent = success
      ? this.isBossLevel
        ? '決戰任務 完成'
        : '任務完成'
      : aborted
        ? '任務放棄'
        : '任務失敗';
    $('rRank').textContent = rank;
    $('rRank').style.color = success ? '' : '#8a97a6';
    const rows = [
      ['戰區', this.levelName],
      ['任務時間', this.missionT.toFixed(1) + ' s'],
      ['擊破數', this.enemies.filter((e) => e.dead).length + ' / ' + this.enemies.length],
      ['受損 AP', Math.round(p.dmgTaken)],
      ['擊破獎金（已即時入帳）', '+' + earned.toLocaleString()],
      ['任務完成獎金', '+' + bonus.toLocaleString()],
      ['COAM 結餘', S.coam.toLocaleString()],
    ];
    $('resultGrid').innerHTML = rows
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    if (this.net && this.net.role === 'host') {
      const st = this.mpStats || {};
      const mprows = this.net.players
        .filter((x) => x.online || st[x.slot])
        .map((x) => {
          const s = st[x.slot] || { kills: 0, dmg: 0, rev: 0, taken: 0 };
          return [`${x.nick}`, `擊破 ${s.kills} · 輸出 ${s.dmg} · 救援 ${s.rev} · 受損 ${s.taken}`];
        });
      $('resultGrid').innerHTML += mprows
        .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
        .join('');
      $('btnResultOk').textContent = '返回大廳';
      this.net.tr.broadcast({
        t: 'end',
        success,
        title: $('rTitle').textContent,
        rank,
        bonus: success ? baseBonus : 0,
        xpBySlot: xpAll,
        rows: [...rows.filter((r) => r[0] !== 'COAM 結餘'), ...mprows],
      });
      for (const x of this.net.players) x.ready = false;
    } else $('btnResultOk').textContent = '返回車庫';
    this.showScreen('result');
  },
});
