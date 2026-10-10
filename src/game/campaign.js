// Game：主線任務模式（設計見 docs/campaign-design.md）
// 第 1 期：出擊骨架——區段鏈、地圖上的出口、轉場、轉場整備、紀錄點、狀態延續（單人；出擊狀態集中在 this.camp，之後多人由房主持有）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp, pick, rnd } from '../core/math.js';
import {
  EXIT_REWARDS,
  SEG_TYPES,
  SORTIES,
  SORTIE_DEFAULT,
  TRANSITIONS,
  sortieBoss,
  transMode,
} from '../data/campaign.js';
import { partById } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { THEMES, World } from '../world/world.js';
import { Game } from './game.js';

const TRANS_T = 2.4; // 轉場演出秒數
const EXIT_R = 4; // 出口的觸發半徑
const EXIT_HOLD = 0.8; // 站進出口多久才出發
const WSLOTS = ['rarm', 'larm', 'rback', 'lback'];
const clone = (o) => JSON.parse(JSON.stringify(o));
// 紀錄點保存的欄位（this.camp 裡其餘的是執行中的狀態）
const CK_KEYS = ['sid', 'seg', 'seeds', 'carry', 'pending', 'stats', 'xpBonus', 'earned', 'time', 'fails'];

Object.assign(Game.prototype, {
  campStory() {
    const S = this.save;
    if (!S.story || typeof S.story !== 'object') S.story = {};
    if (!S.story.done || typeof S.story.done !== 'object') S.story.done = {};
    if (S.story.sortie && !SORTIES[S.story.sortie.sid]) S.story.sortie = null;
    return S.story;
  },
  campSortie() {
    return SORTIES[this.camp.sid];
  },
  campLevel() {
    return this.campSortie().level + Math.floor(this.camp.seg / 2);
  },

  // ---------- 出擊開始／紀錄點 ----------
  campBegin(sid = SORTIE_DEFAULT) {
    const so = SORTIES[sid];
    this.camp = {
      sid,
      seg: 0,
      seeds: so.segs.map(() => Math.floor(Math.random() * 1e9)),
      carry: { hp: 1, kits: null, ammo: {} },
      pending: null,
      stats: { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } },
      xpBonus: 0,
      earned: 0,
      time: 0,
      fails: 0,
    };
    this.campCheckpoint();
    this.campShowTrans(TRANSITIONS.drop, true);
  },
  // 從存檔的紀錄點還原（車庫的「繼續主線出擊」、失敗後重試）
  campRestore() {
    const ck = this.campStory().sortie;
    if (!ck) return false;
    const fails = this.camp ? this.camp.fails : ck.fails || 0;
    this.camp = clone(ck);
    this.camp.fails = fails;
    return true;
  },
  campCheckpoint() {
    const ck = {};
    for (const k of CK_KEYS) ck[k] = this.camp[k];
    this.campStory().sortie = clone(ck);
    this.writeSave();
  },

  // ---------- 區段 ----------
  campEnterSeg() {
    const c = this.camp,
      so = this.campSortie(),
      seg = so.segs[c.seg],
      S = this.save;
    this.clearMission();
    const L = this.campLevel();
    const bd = sortieBoss(seg);
    const seed = c.seeds[c.seg];
    this.worldSeed = seed;
    this.worldTheme = seg.theme;
    this.styleRefresh();
    this.world = new World(this.scene, seg.theme, seed, L, null, { rail: !!(bd && bd.rail) });
    this.isClient = false;
    this.net.spawnReg = {};
    this.mpStats = c.stats;
    const T = this.world.theme;
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    this.player = new MechEntity(this, S.asm, PALETTES.player, {
      team: 'player',
      name: 'RAVEN',
      palKey: 'player',
      slot: 0,
      pilot: this.pilotLocalMods('pve'),
    });
    this.player.pos.set(0, this.world.terrainHeight(0, 0), 0);
    this.players = [this.player];
    this.campApplyCarry(this.player);
    this.enemies = [];
    this.waves = [];
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.bossDef = null;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.levelName = T.name;
    this.isBossLevel = !!bd;
    this.enemyPointsTotal = 0;
    const scaleHp = 1 + (L - 1) * 0.09,
      scaleDmg = 1 + (L - 1) * 0.06;
    if (bd) this.spawnBossDef(bd, scaleHp, scaleDmg);
    else this.spawnComp(this.rollComp(L, 1), 1, scaleHp, scaleDmg);
    this.scaleHp = scaleHp;
    this.scaleDmg = scaleDmg;
    this.waveAlerted = false;
    this.planVehicles();
    if (bd && bd.rail) this.vehPlan = [];
    c.cleared = false;
    c.exits = [];
    c.hint = '';
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
    this.camZoom = 1;
    this.camera.position.set(0, 40, 24);
    this.renderWeaponHud(true);
    this.fp = false;
    this.fpShow();
    if (this.ctrl.view === 'fps') this.setFp(true);
    this.flashMsg(`區段 ${c.seg + 1}／${so.segs.length} — ${T.name}`, 0xffb020, 2.2);
    document.getElementById('bossBar').style.display = bd ? 'block' : 'none';
    if (bd) document.getElementById('bossName').textContent = bd.name;
  },
  // 帶進下一段的狀態：AP 比例、修復套件、各武器槽的彈藥比例（換武器時沿用被換下那把的比例）
  campCapture() {
    const p = this.player,
      cy = this.camp.carry;
    if (!p) return;
    cy.hp = p.dead ? 0 : clamp(p.hp / p.maxHp, 0, 1);
    cy.kits = p.kits;
    for (const s of WSLOTS) {
      const w = p.weapons[s];
      if (w && !w.dropped && w.def.ammo > 0) cy.ammo[s] = clamp(w.ammo / w.def.ammo, 0, 1);
    }
  },
  campApplyCarry(p) {
    const cy = this.camp.carry;
    p.hp = Math.max(1, Math.round(p.maxHp * clamp(cy.hp == null ? 1 : cy.hp, 0, 1)));
    if (cy.kits != null) p.kits = clamp(cy.kits, 0, p.kitsMax);
    for (const s of WSLOTS) {
      const w = p.weapons[s];
      if (!w || !(w.def.ammo > 0) || cy.ammo[s] == null) continue;
      w.ammo = Math.round(w.def.ammo * cy.ammo[s]);
      if (w.def.mag) w.mag = Math.min(w.def.mag, w.ammo);
    }
  },
  // 區段清除：發放上一個出口選的獎勵；最後一段就結束出擊，否則開出口
  campCleared() {
    const c = this.camp,
      so = this.campSortie();
    c.cleared = true;
    if (c.pending) this.campGrant(c.pending);
    c.pending = null;
    if (c.seg >= so.segs.length - 1) {
      this.state = 'ending';
      this.flashMsg('作戰目標達成', 0x7ee081, 2);
      setTimeout(() => this.state === 'ending' && this.campEnd(true, false), 1800);
      return;
    }
    this.campSpawnExits();
    this.flashMsg('區段清除 — 選擇出口前往下一區', 0x7ee081, 2.4);
    SFX.ui();
  },
  campGrant(k) {
    const p = this.player,
      L = this.campLevel();
    if (k === 'coam') {
      const v = Math.round((4000 + L * 1500) / 100) * 100;
      this.save.coam += v;
      this.missionEarned = (this.missionEarned || 0) + v;
      this.bountyPops.push({ txt: '+' + v.toLocaleString() + ' COAM', life: 2.2, y: 0 });
      this.writeSave();
      this.flashMsg(`出口獎勵：資金 +${v.toLocaleString()}`, 0xffc040, 2);
    } else if (k === 'repair' && p) {
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35));
      for (const s of WSLOTS) {
        const w = p.weapons[s];
        if (w && !w.dropped && w.def.ammo > 0)
          w.ammo = Math.min(w.def.ammo, w.ammo + Math.ceil(w.def.ammo * 0.35));
      }
      this.fx.ring(p.center(), 5, 0x7ee081);
      this.flashMsg('出口獎勵：修理與補給', 0x7ee081, 2);
    } else if (k === 'xp') {
      const v = 120 + L * 30;
      this.camp.xpBonus += v;
      this.flashMsg(`出口獎勵：駕駛員經驗 +${v}`, 0x7fc8ff, 2);
    }
  },

  // ---------- 出口 ----------
  // 出口位置：接力型在作戰區域邊緣附近，垂直型在場內；避開虛空、保留區、障礙物，彼此分開、離玩家遠一點
  campExitSpots(n, mode) {
    const w = this.world,
      p = this.player.pos,
      L = w.lim,
      out = [];
    const [r0, r1] = mode === 'relay' ? [0.7, 0.86] : [0.25, 0.62];
    const free = (x, z) =>
      w.slopeOK(x, z) &&
      !w.isVoid(x, z) &&
      !w.isReserved(x, z, 3) &&
      !w.obstacles.some((o) =>
        o.kind === 'box'
          ? Math.abs(x - o.x) < o.w / 2 + 4 && Math.abs(z - o.z) < o.d / 2 + 4
          : Math.hypot(x - o.x, z - o.z) < o.r + 4,
      );
    for (let t = 0; t < 400 && out.length < n; t++) {
      const a = Math.random() * Math.PI * 2,
        r = L * rnd(r0, r1);
      const x = Math.cos(a) * r,
        z = Math.sin(a) * r;
      if (!free(x, z)) continue;
      if (t < 300 && Math.hypot(x - p.x, z - p.z) < L * 0.35) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < L * 0.45)) continue;
      out.push(new THREE.Vector3(x, w.terrainHeight(x, z), z));
    }
    while (out.length < n) {
      const sp = w.spawnPoint(p, out);
      out.push(new THREE.Vector3(sp.x, w.terrainHeight(sp.x, sp.z), sp.z));
    }
    return out;
  },
  campSpawnExits() {
    const c = this.camp,
      so = this.campSortie(),
      cur = so.segs[c.seg],
      next = so.segs[c.seg + 1];
    const mode = transMode(cur.theme, next.theme);
    const keys = Object.keys(EXIT_REWARDS).sort(() => Math.random() - 0.5);
    const n = Math.min(keys.length, 2 + (Math.random() < 0.4 ? 1 : 0));
    const spots = this.campExitSpots(n, mode);
    c.exits = spots.map((pos, i) => {
      const reward = keys[i];
      const tr = pick(TRANSITIONS[mode] || TRANSITIONS.relay);
      const ex = { pos, reward, mode, tr, t: 0, group: this.campExitMesh(pos, reward, next, tr) };
      this.fx.ring(pos.clone().setY(pos.y + 0.2), 6, 0xffb020);
      return ex;
    });
  },
  // 出口的外觀：地面光環＋光柱＋浮在上方的獎勵標籤（不碰撞、不投影）
  campExitMesh(pos, reward, next, tr) {
    const R = EXIT_REWARDS[reward];
    const col = new THREE.Color(R.color);
    const g = new THREE.Group();
    g.position.copy(pos);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(EXIT_R - 0.6, EXIT_R, 40),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(EXIT_R * 0.9, EXIT_R, 60, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 30;
    g.add(beam);
    const cv = document.createElement('canvas');
    cv.width = 512;
    cv.height = 192;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(10,14,20,0.78)';
    x.fillRect(0, 0, 512, 192);
    x.strokeStyle = R.color;
    x.lineWidth = 6;
    x.strokeRect(3, 3, 506, 186);
    x.fillStyle = R.color;
    x.font = 'bold 64px sans-serif';
    x.textAlign = 'center';
    x.fillText(`${R.icon} ${R.name}`, 256, 82);
    x.fillStyle = '#d8e2ec';
    x.font = '34px sans-serif';
    x.fillText(`${tr.title} → ${THEMES[next.theme].name}・${SEG_TYPES[next.type].name}`, 256, 146);
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(9, 3.4, 1);
    spr.position.y = 8;
    spr.renderOrder = 10;
    g.add(spr);
    g.userData.ring = ring;
    this.scene.add(g);
    return g;
  },
  campClearExits() {
    if (!this.camp || !this.camp.exits) return;
    for (const ex of this.camp.exits) {
      this.scene.remove(ex.group);
      ex.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    this.camp.exits = [];
  },
  // 每格：出口動畫與觸發（站進光環 EXIT_HOLD 秒就出發）
  campTick(dt) {
    const c = this.camp;
    c.time += dt;
    c.hint = '';
    const p = this.player;
    if (!c.exits || !c.exits.length || !p || p.dead) return;
    for (const ex of c.exits) {
      ex.group.userData.ring.rotation.z += dt * 0.8;
      const d = Math.hypot(p.pos.x - ex.pos.x, p.pos.z - ex.pos.z);
      if (d < EXIT_R && Math.abs(p.pos.y - ex.pos.y) < 8 && this.state === 'play') {
        ex.t += dt;
        c.hint = `進入出口：${EXIT_REWARDS[ex.reward].name}…`;
        if (ex.t >= EXIT_HOLD) return this.campLeave(ex);
      } else ex.t = 0;
    }
  },
  campLeave(ex) {
    const c = this.camp;
    SFX.ui();
    this.campCapture();
    c.earned += this.missionEarned || 0;
    c.pending = ex.reward;
    c.seg++;
    this.clearMission();
    this.campCheckpoint(); // 紀錄點＝這次轉場的起點（整備後再記一次）
    this.campShowTrans(ex.tr, false);
  },

  // ---------- 轉場畫面 ----------
  campShowTrans(tr, first) {
    const c = this.camp,
      so = this.campSortie(),
      seg = so.segs[c.seg];
    const $ = (id) => document.getElementById(id);
    this.state = 'camptrans';
    this.showScreen('campTrans');
    $('ctTitle').textContent = tr.title;
    $('ctSub').textContent = tr.sub;
    $('ctNext').textContent =
      `${so.name}　區段 ${c.seg + 1}／${so.segs.length}：${THEMES[seg.theme].name}・${SEG_TYPES[seg.type].name}`;
    $('ctReward').textContent = c.pending
      ? `本區段清除後獲得：${EXIT_REWARDS[c.pending].name}（${EXIT_REWARDS[c.pending].desc}）`
      : '';
    $('ctBtns').style.visibility = 'hidden';
    const bar = $('ctBar');
    bar.style.transition = 'none';
    bar.style.width = '0%';
    void bar.offsetWidth;
    const T = first === 'resume' ? 0 : TRANS_T;
    bar.style.transition = `width ${T}s linear`;
    bar.style.width = '100%';
    clearTimeout(this.campTransTo);
    this.campTransTo = setTimeout(() => {
      if (this.state === 'camptrans') $('ctBtns').style.visibility = 'visible';
    }, T * 1000);
  },
  campGo() {
    if (!this.camp) return;
    SFX.ui();
    this.campCheckpoint();
    this.campEnterSeg();
  },
  // 進車庫整備：沿用車庫畫面，按鈕換成「繼續作戰」
  campGarage() {
    if (!this.camp) return;
    SFX.ui();
    this.camp.inGarage = true;
    this.openGarage();
  },
  // 車庫：主線相關的按鈕與整備面板（renderGarage 結尾呼叫）
  campGarageUi(warn) {
    const $ = (id) => document.getElementById(id);
    const box = $('gCamp');
    if (!box) return;
    const mp = !!(this.net && this.net.role);
    const st = this.campStory();
    const inG = !!(this.camp && this.camp.inGarage);
    $('btnCamp').style.display = mp || inG ? 'none' : '';
    $('btnCamp').textContent = st.sortie ? '繼續主線出擊' : '主線出擊';
    $('btnCampDrop').style.display = !mp && !inG && st.sortie ? '' : 'none';
    if (inG) {
      $('btnSortie').style.display = 'none';
      $('btnToTitle').style.display = 'none';
    }
    $('gMap').style.display = inG ? 'none' : ''; // 主線的地圖由出擊決定
    box.style.display = inG ? '' : 'none';
    if (!inG) return;
    const c = this.camp,
      so = this.campSortie(),
      seg = so.segs[c.seg];
    $('mcTitle').textContent = `主線出擊｜${so.name}`;
    $('mcDesc').textContent =
      `轉場整備中：下一個是區段 ${c.seg + 1}／${so.segs.length}（${THEMES[seg.theme].name}・${SEG_TYPES[seg.type].name}）。換裝時 AP 依比例換算，換上的武器沿用該武器槽的剩餘彈藥比例。`;
    const cost = this.campCosts();
    const cy = c.carry;
    $('gCampInfo').innerHTML =
      `AP <b>${Math.round((cy.hp == null ? 1 : cy.hp) * 100)}%</b>　彈藥 <b>${Math.round(cost.ammoPct * 100)}%</b>`;
    $('btnCampRepair').textContent = cost.repair
      ? `修理 AP（${cost.repair.toLocaleString()} COAM）`
      : 'AP 已滿';
    $('btnCampRepair').disabled = !cost.repair || this.save.coam < cost.repair;
    $('btnCampAmmo').textContent = cost.ammo ? `補充彈藥（${cost.ammo.toLocaleString()} COAM）` : '彈藥已滿';
    $('btnCampAmmo').disabled = !cost.ammo || this.save.coam < cost.ammo;
    $('btnCampGo2').disabled = warn.length > 0;
  },
  // 整備的花費：修理到滿、補彈到滿（以目前裝備的實彈武器平均缺少比例計）
  campCosts() {
    const cy = this.camp.carry,
      L = this.campLevel();
    const miss = 1 - (cy.hp == null ? 1 : cy.hp);
    const rows = WSLOTS.filter((s) => {
      const d = this.campWeaponDef(s);
      return d && d.ammo > 0;
    }).map((s) => (cy.ammo[s] == null ? 1 : cy.ammo[s]));
    const ammoPct = rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 1;
    const r100 = (v) => Math.round(v / 100) * 100;
    return {
      repair: miss > 0.005 ? Math.max(100, r100(miss * (9000 + L * 1500))) : 0,
      ammo: ammoPct < 0.995 ? Math.max(100, r100((1 - ammoPct) * (6000 + L * 1000))) : 0,
      ammoPct,
    };
  },
  campWeaponDef(s) {
    return partById(s.endsWith('arm') ? 'arm' : 'back', this.save.asm[s]);
  },
  campRepair() {
    const k = this.campCosts().repair;
    if (!k || this.save.coam < k) return;
    this.save.coam -= k;
    this.camp.carry.hp = 1;
    this.campCheckpoint();
    SFX.ui();
    this.renderGarage();
  },
  campAmmo() {
    const k = this.campCosts().ammo;
    if (!k || this.save.coam < k) return;
    this.save.coam -= k;
    for (const s of WSLOTS) this.camp.carry.ammo[s] = 1;
    this.campCheckpoint();
    SFX.ui();
    this.renderGarage();
  },
  campGarageGo() {
    if (!this.camp) return;
    this.camp.inGarage = false;
    this.campGo();
  },

  // ---------- 失敗／結束 ----------
  campDead() {
    setTimeout(() => {
      if (this.state === 'play' && this.camp) this.campFail();
    }, 2600);
  },
  campFail() {
    const c = this.camp;
    c.fails++;
    this.clearMission();
    this.campClearExits();
    this.state = 'campfail';
    this.showScreen('campFail');
    const so = this.campSortie(),
      ck = this.campStory().sortie;
    document.getElementById('cfInfo').textContent =
      `${so.name}　紀錄點：區段 ${ck.seg + 1}／${so.segs.length} 的轉場起點（失敗 ${c.fails} 次）`;
  },
  campRetry(toGarage) {
    SFX.ui();
    this.campRestore();
    if (toGarage) return this.campGarage();
    this.campShowTrans(TRANSITIONS.drop, 'resume');
  },
  // 車庫的「繼續主線出擊」：沒有紀錄點時開始新的出擊
  campStartOrResume() {
    SFX.ui();
    if (this.campStory().sortie && this.campRestore()) this.campShowTrans(TRANSITIONS.drop, 'resume');
    else this.campBegin();
  },
  // 放棄存檔裡的紀錄點（車庫）
  campDrop() {
    const st = this.campStory();
    if (!st.sortie) return;
    if (!confirm('放棄目前的主線出擊？紀錄點會被刪除。')) return;
    st.sortie = null;
    this.camp = null;
    this.writeSave();
    this.renderGarage();
  },
  campEnd(success, aborted) {
    const c = this.camp,
      so = this.campSortie(),
      S = this.save,
      st = this.campStory();
    const $ = (id) => document.getElementById(id);
    if (this.state === 'play' || this.state === 'ending') {
      c.earned += this.missionEarned || 0;
    }
    this.mpStats = c.stats;
    this.missionT = c.time;
    this.isBossLevel = true; // 經驗基準以決戰計
    const xpAll = this.pilotEndXpPve(success, aborted);
    const e = xpAll[0];
    if (e) {
      e.x += c.xpBonus;
      e.m += c.xpBonus;
    }
    let bonus = 0;
    if (success) {
      bonus = so.reward;
      S.coam += bonus;
      st.done[c.sid] = (st.done[c.sid] || 0) + 1;
    }
    st.sortie = null;
    this.writeSave();
    const segsDone = success ? so.segs.length : c.seg;
    this.clearMission();
    this.campClearExits();
    this.camp = null;
    this.state = 'result';
    this.pilotRenderResult(this.pilotGrant('pve', e));
    $('rTitle').textContent = success ? '主線出擊 完成' : aborted ? '主線出擊 放棄' : '主線出擊 失敗';
    const rank = success ? (c.fails === 0 ? 'S' : c.fails <= 1 ? 'A' : c.fails <= 3 ? 'B' : 'C') : '—';
    $('rRank').textContent = rank;
    $('rRank').style.color = success ? '' : '#8a97a6';
    const mm = Math.floor(c.time / 60),
      ss = Math.floor(c.time % 60);
    const rows = [
      ['作戰', so.name],
      ['完成區段', `${segsDone} / ${so.segs.length}`],
      ['作戰時間', `${mm} 分 ${String(ss).padStart(2, '0')} 秒`],
      ['重試次數', String(c.fails)],
      ['擊破數', String(c.stats[0] ? c.stats[0].kills : 0)],
      ['報酬（已即時入帳）', '+' + c.earned.toLocaleString()],
      ['作戰完成報酬', '+' + bonus.toLocaleString()],
      ['COAM 結餘', S.coam.toLocaleString()],
    ];
    $('resultGrid').innerHTML = rows
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    $('btnResultOk').textContent = '返回車庫';
    this.showScreen('result');
  },

  // ---------- HUD ----------
  campHudTop(alive, wavesLeft) {
    const c = this.camp,
      so = this.campSortie();
    const goal = c.cleared
      ? c.hint || '前往出口（站進光環）'
      : `殘存敵軍 ${alive}${wavesLeft ? ' （尚有增援）' : ''}`;
    const mm = Math.floor(c.time / 60);
    return `<b>主線｜${escHtml(so.name)}</b> ｜ 區段 ${c.seg + 1}／${so.segs.length}・${escHtml(this.levelName)}<div id="objective">${escHtml(goal)} ｜ ${mm} 分</div><div style="color:var(--acc)">COAM ${this.save.coam.toLocaleString()}${c.pending ? ` <span class="dim">（清除後：${EXIT_REWARDS[c.pending].name}）</span>` : ''}</div>`;
  },
  // 出口標記：畫面內畫在出口上方，畫面外貼在畫面邊緣
  campDrawHud(ctx) {
    const c = this.camp;
    if (!c || !c.exits || !c.exits.length || !this.player) return;
    const W = innerWidth,
      H = innerHeight;
    for (const ex of c.exits) {
      const R = EXIT_REWARDS[ex.reward];
      const v = ex.pos.clone();
      v.y += 3;
      const s = this.proj(v);
      let x = s.x,
        y = s.y;
      const behind = v.clone().project(this.camera).z > 1;
      if (behind) {
        x = W - x;
        y = H - 30;
      }
      const m = 28;
      const edge = behind || x < m || x > W - m || y < m || y > H - m;
      x = clamp(x, m, W - m);
      y = clamp(y, m, H - m);
      const d = Math.round(Math.hypot(this.player.pos.x - ex.pos.x, this.player.pos.z - ex.pos.z));
      ctx.save();
      ctx.fillStyle = R.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px sans-serif';
      ctx.strokeText(`${R.icon} ${d}m`, x, y);
      ctx.fillText(`${R.icon} ${d}m`, x, y);
      if (edge) {
        ctx.beginPath();
        ctx.arc(x, y - 5, 15, 0, Math.PI * 2);
        ctx.strokeStyle = R.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  },
});
