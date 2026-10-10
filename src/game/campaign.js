// Game：主線任務模式（設計見 docs/campaign-design.md）
// 出擊狀態集中在 this.camp（之後多人由房主持有）：區段鏈、地圖上的出口、轉場、轉場整備、紀錄點、狀態延續（第 1 期）；
// 區段類型、主題變體／地標／時間與天候／深度／作戰區域形狀的排程、跨主題入口（第 2 期）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp, pick, rnd } from '../core/math.js';
import {
  CHOICES,
  EXIT_REWARDS,
  SEG_TYPES,
  SORTIES,
  SORTIE_DEFAULT,
  TRANSITIONS,
  sortieBoss,
  transList,
  transMode,
} from '../data/campaign.js';
import { TOD_NAMES, planKeys, planSortie } from '../data/campaign-plan.js';
import { AC_ROSTER, PART_DEFS } from '../data/enemies.js';
import { ACES, THEME_ACE } from '../data/foes.js';
import { FACTIONS, SPEAKERS, speakerBadge } from '../data/story.js';
import { partById } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES, World, corridorSpec } from '../world/world.js';
import { Game } from './game.js';

const TRANS_T = 2.4; // 轉場演出秒數
const EXIT_R = 4; // 出口的觸發半徑
const EXIT_HOLD = 0.8; // 站進出口多久才出發
const PAD_R = 3.5; // 補給台、資料終端的半徑
const WSLOTS = ['rarm', 'larm', 'rback', 'lback'];
const clone = (o) => JSON.parse(JSON.stringify(o));
// 紀錄點保存的欄位（this.camp 裡其餘的是執行中的狀態）
const CK_KEYS = [
  'sid',
  'seg',
  'seeds',
  'plan',
  'types',
  'trans',
  'usedTrans',
  'carry',
  'pending',
  'stats',
  'xpBonus',
  'earned',
  'time',
  'fails',
  'mods',
  'mods0',
  'modNext',
  'carryBy',
  'replay',
  'heat',
  'rmods',
  'choice',
];
// 情報區段下載到的內容（第 3 期換成劇情資料表）
const INTEL = {
  wasteland: ['補給線的排程表：礦坑方面每 6 小時有一批運輸車', '舊企業的通訊紀錄：礦坑深處有東西被封存'],
  desert: ['礦坑結構圖：深層有大型空洞', '砲兵陣地的配置：砲台由周圍的發電機供電'],
  snow: ['冰原基地的巡邏表：暴風雪時哨兵會撤回室內', '舊觀測站的紀錄：冰層下有大型的熱源'],
  institute: ['研究紀錄：強化人間計畫的第 7 號受試者還在運作', 'Coral 收容槽的讀數：濃度正在上升'],
  orbit: ['軌道站的日誌：「它」還在等待命令', '舊時代的設計圖：最上層有一台艦載機動兵器'],
  xylem: ['都市的管理日誌：最後一位居民在 30 年前離開', '海底電纜的配置：都市的電力來自軌道'],
  grid086: ['Doser 的物資清單：他們在囤積燃料', '構造體的結構圖：底層有一座沒有登記的發電機'],
  spaceport: ['發射排程：最後一班火箭在 20 年前', '軌道站的座標：它還在上面'],
  industrial: ['集散場的貨運排程：武裝列車每天經過調度場兩次', '卡斯特隆的出貨清單：大量的重型榴彈'],
  dam: ['水壩的閘門控制碼：主壩的閘門可以從下游開啟', '艾瑟立克的電力需求表：數字大得不像是研究用的'],
  flooded: ['舊研究所的平面圖：地下有一層沒有登記的實驗室', '水質報告：汙染源在研究所的排水口'],
};

Object.assign(Game.prototype, {
  campStory() {
    const S = this.save;
    if (!S.story || typeof S.story !== 'object') S.story = {};
    if (!S.story.done || typeof S.story.done !== 'object') S.story.done = {};
    if (!Array.isArray(S.story.recent)) S.story.recent = [];
    if (!S.story.choices || typeof S.story.choices !== 'object') S.story.choices = {}; // 陣營抉擇（data/campaign.js 的 CHOICES）
    const ck = S.story.sortie;
    if (ck && (!SORTIES[ck.sid] || !Array.isArray(ck.plan) || !Array.isArray(ck.types)))
      S.story.sortie = null; // 舊版紀錄點
    return S.story;
  },
  campSortie() {
    return SORTIES[this.camp.sid];
  },
  // 通訊的條件（data/story.js 的 COMMS）
  campCtx(extra = {}) {
    const c = this.camp,
      so = this.campSortie();
    return {
      sid: c.sid,
      seg: c.seg,
      type: this.campSegType(),
      theme: so.segs[c.seg].theme,
      chapter: so.chapter,
      fails: c.fails,
      ace: (c.ss && c.ss.ace) || '',
      cycle: this.campStory().cycle || 1,
      pick: (c.choice && c.choice.key) || this.campLastPick(so.chapter),
      ...extra,
    };
  },
  // 到這一章為止最近的陣營抉擇（第 3 章看第 2 章的抉擇 1）
  campLastPick(chapter) {
    const ch = this.campStory().choices;
    for (let k = chapter; k >= 1; k--) if (ch['c' + k]) return ch['c' + k];
    return '';
  },
  campLevel() {
    return this.campSortie().level + Math.floor(this.camp.seg / 2);
  },
  campSegType(i = this.camp.seg) {
    return this.camp.types[i] || this.campSortie().segs[i].pool[0];
  },
  // 區段的顯示名稱：主題・變體（時間）
  campSegName(i = this.camp.seg) {
    const seg = this.campSortie().segs[i],
      p = this.camp.plan[i] || {};
    const v = p.variant && VARIANTS[seg.theme] ? VARIANTS[seg.theme][p.variant] : null;
    const roof = (v && v.theme && v.theme.roof) || THEMES[seg.theme].roof;
    return `${THEMES[seg.theme].name}${v ? '・' + v.name : ''}${p.tod && !roof ? `（${TOD_NAMES[p.tod]}）` : ''}`;
  },
  // 這個區段能不能是某種類型（護送要有公路）
  campTypeOk(type, i) {
    if (type !== 'escort') return true;
    const seg = this.campSortie().segs[i],
      p = this.camp.plan[i] || {};
    const v = p.variant && VARIANTS[seg.theme] ? VARIANTS[seg.theme][p.variant] : null;
    const T = v && v.theme ? { ...THEMES[seg.theme], ...v.theme } : THEMES[seg.theme];
    return corridorSpec(T).kinds.includes('road');
  },

  // ---------- 出擊開始／紀錄點 ----------
  // o.replay＝從作戰紀錄重打（模組從零開始、不影響這一章持有的）、o.heat＝危險條款
  campBegin(sid = SORTIE_DEFAULT, o = {}) {
    const so = SORTIES[sid],
      st = this.campStory();
    const plan = planSortie(so, Math.random, st.recent);
    st.recent = [...st.recent, ...planKeys(so, plan)].slice(-40);
    this.camp = {
      sid,
      seg: 0,
      seeds: so.segs.map(() => Math.floor(Math.random() * 1e9)),
      plan,
      types: [],
      trans: [TRANSITIONS.drop],
      usedTrans: [],
      carry: { hp: 1, kits: null, ammo: {} },
      pending: null,
      stats: { 0: { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} } },
      xpBonus: 0,
      earned: 0,
      time: 0,
      fails: 0,
      replay: !!o.replay,
      heat: o.heat || {},
      rmods: [],
    };
    // 戰術模組：這一章持有的（換章時清空）；放棄出擊時退回出擊開始時的狀態
    this.camp.mods0 = this.campMods(so.chapter).map((m) => ({ ...m }));
    const pool0 = so.segs[0].pool.filter(
      (t) => this.campTypeOk(t, 0) && !(o.heat && o.heat.nosupply && t === 'supply'),
    );
    this.camp.types[0] = pick(pool0.length ? pool0 : ['battle']);
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
    if (ck.mods) this.campSetMods(ck.mods); // 紀錄點之後拿到的模組不算
    return true;
  },
  campCheckpoint() {
    this.camp.mods = this.campMods().map((m) => ({ ...m }));
    const ck = {};
    for (const k of CK_KEYS) ck[k] = this.camp[k];
    this.campStory().sortie = clone(ck);
    this.writeSave();
    // 多人：紀錄點也給客機一份（房主遷移時由新房主接手）
    if (this.campMp()) this.net.tr.broadcast({ t: 'cck', ck: clone(ck) });
  },

  // ---------- 區段 ----------
  campEnterSeg() {
    const c = this.camp,
      so = this.campSortie(),
      seg = so.segs[c.seg],
      S = this.save;
    this.clearMission();
    const type = this.campSegType();
    const p = c.plan[c.seg] || {};
    const L = this.campLevel();
    const bd = sortieBoss(seg, type);
    const seed = c.seeds[c.seg];
    // 作戰區域：Boss、護送、防衛、補給用全區，精英用小型戰場，其餘照排程
    const zone = ['boss', 'escort', 'defend', 'supply'].includes(type)
      ? 'full'
      : type === 'elite'
        ? 'arena'
        : p.zone || 'full';
    const tr = c.trans[c.seg] || {};
    this.worldSeed = seed;
    this.worldTheme = seg.theme;
    this.styleRefresh();
    this.world = new World(this.scene, seg.theme, seed, L, null, {
      rail: !!(bd && bd.rail),
      road: type === 'escort',
      variant: p.variant,
      landmark: p.landmark,
      tod: p.tod,
      weather: p.weather,
      depth: p.depth,
      zone,
      zoneAxis: p.zoneAxis,
      entry: tr.entry,
    });
    this.isClient = false;
    this.net.spawnReg = {};
    this.mpStats = c.stats;
    this.world.applyLight(this);
    this.sun.position.set(40, 80, 30);
    const mp = this.campMp();
    if (mp)
      this.campMpSpawn(); // 多人：每位玩家各自的模組與上一段的狀態（campaign-mp.js）
    else {
      this.player = new MechEntity(this, S.asm, PALETTES.player, {
        team: 'player',
        name: 'RAVEN',
        palKey: 'player',
        slot: 0,
        pilot: this.campPilotPm(), // 駕駛員（PvE）＋戰術模組
      });
      this.player.pos.set(0, this.world.terrainHeight(0, 0), 0);
      this.players = [this.player];
      this.campApplyCarry(this.player);
    }
    const np = mp ? this.players.length : 1;
    this.enemies = [];
    this.waves = [];
    this.missionT = 0;
    this.boss = null;
    this.bosses = [];
    this.bossDef = null;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.levelName = this.campSegName();
    this.isBossLevel = !!bd;
    this.enemyPointsTotal = 0;
    const scaleHp = (1 + (L - 1) * 0.09) * (1 + 0.6 * (np - 1)) * (c.heat && c.heat.shield ? 1.35 : 1),
      scaleDmg = 1 + (L - 1) * 0.06;
    this.scaleHp = scaleHp;
    this.scaleDmg = scaleDmg;
    c.cleared = false;
    c.exits = [];
    c.hint = '';
    c.vote = null;
    c.ss = { type, np }; // 這個區段執行中的狀態（不進紀錄點）
    document.getElementById('bossBar').style.display = 'none';
    this.campSpawnType(type, L, bd);
    c.ss.n0 = this.enemies.length;
    this.waveAlerted = false;
    this.planVehicles();
    if ((bd && bd.rail) || type === 'escort') this.vehPlan = [];
    if (mp) {
      this.net.tr.broadcast(this.campStartMsg());
      this.netEvents = [];
      this.snapAcc = 0;
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
      `區段 ${c.seg + 1}／${so.segs.length}【${SEG_TYPES[type].name}】${this.levelName}`,
      0xffb020,
      2.6,
    );
    const lm = this.world.landmark && this.world.landmark.name;
    if (lm) setTimeout(() => this.camp && this.state === 'play' && this.flashAlert(`地標：${lm}`), 2800);
    // 通訊（data/story.js）
    const ctx = this.campCtx();
    if (c.seg === 0 && !c.started) {
      c.started = true;
      this.campComm('sortieStart', ctx);
    }
    this.campComm('segStart', ctx);
    // 突破區段沒清除就離開時，選模組延到這一段開始
    if (c.modNext) {
      const f = c.modNext;
      c.modNext = null;
      setTimeout(() => this.camp && this.state === 'play' && this.campOpenPick(f), 600);
    }
  },
  // 依區段類型生成敵人與目標物
  campSpawnType(type, L, bd) {
    const c = this.camp,
      ss = c.ss,
      sh = this.scaleHp,
      sd = this.scaleDmg;
    const seg = this.campSortie().segs[c.seg],
      p = c.plan[c.seg] || {};
    // 一般敵人＋主題專屬敵人（data/foes.js）
    const comp = (lv) => this.foeMix(this.rollComp(Math.max(1, lv), ss.np || 1), seg.theme, p.depth || 0);
    if (type === 'boss') {
      this.spawnBossDef(bd, sh, sd);
      if (bd.kind) this.simMark('bosses', bd.kind);
      // 危險條款：Boss 一開始就是第二型態
      if (c.heat && c.heat.p2) for (const b of this.bosses) b.forceP2 = true;
      document.getElementById('bossBar').style.display = 'block';
      document.getElementById('bossName').textContent = bd.name;
    } else if (type === 'elite') {
      // 具名 AC（強化）＋少數護衛
      // 主題的專屬 AC（劇情角色）；沒有時用一般的具名 AC
      // 區段指定的（依抉擇）＞主題的；別的主題的專屬 AC 是跨章節再登場（強化）
      const pk = this.campCtx().pick;
      const ace = (seg.ace && (typeof seg.ace === 'string' ? seg.ace : seg.ace[pk])) || THEME_ACE[seg.theme];
      const key = ace || pick(Object.keys(AC_ROSTER));
      const r = ace ? ACES[ace] : AC_ROSTER[key];
      const up = ace && ACES[ace].theme !== seg.theme ? 1.3 : 1;
      if (ace) {
        ss.ace = ace;
        this.simMark('aces', ace);
      }
      const e = this.spawnEnemy({
        name: r.name,
        asm: r.randomAsm ? this.foeRandomAsm() : r.asm,
        pal: r.pal,
        scale: 1,
        hpMul: r.hpMul * sh * 1.6 * up,
        dmgMul: r.dmgMul * sd * (up > 1 ? 1.15 : 1),
        stabMul: r.stabMul * 1.3,
        ai: r.ai,
        wantDist: r.wantDist,
        speedMul: r.speedMul,
        turnRate: r.turnRate,
        amphib: r.amphib,
      });
      this.bosses = [e];
      ss.elite = e;
      for (const t of comp(L - 2).slice(0, 2)) this.spawnType(t, sh, sd);
      document.getElementById('bossBar').style.display = 'block';
      document.getElementById('bossName').textContent = `敵對 AC「${r.name}」`;
      this.flashAlert(r.intro || `敵對 AC「${r.name}」`);
    } else if (type === 'destroy') {
      const n = 3 + (L >= 4 ? 1 : 0);
      ss.targets = this.campSpots(n, 'inner').map((pos) => this.campObjective(pos, 'enemy'));
      this.spawnComp(comp(L - 1), 1, sh, sd);
    } else if (type === 'defend') {
      const pos = this.campSpots(1, 'near')[0];
      ss.defend = this.campObjective(pos, 'ally');
      const w = [comp(L - 1), comp(L - 1), comp(L)];
      for (const t of w[0]) this.spawnType(t, sh, sd);
      this.waves = [w[1], w[2]];
      this.flashAlert('防衛目標遭到攻擊 — 擊退所有敵軍');
    } else if (type === 'escort' && this.world.corridor) {
      this.campConvoy();
    } else if (type === 'breakthrough') {
      ss.brk = { t: 75, waveT: 10 };
      this.spawnComp(comp(L), 1, sh, sd);
      this.campSpawnExits();
      this.flashAlert('突破任務：不必全滅，抵達任一出口即可');
    } else if (type === 'supply') {
      const pos = this.campSpots(1, 'near')[0];
      ss.pad = { pos, t: 0, used: false, group: this.campRing(pos, 0x7ee081, '補給') };
    } else if (type === 'intel') {
      const pos = this.campSpots(1, 'inner')[0];
      ss.intel = { pos, t: 0, done: false, group: this.campRing(pos, 0x7fc8ff, '資料終端') };
      this.spawnComp(comp(L - 1), 1, sh, sd);
    } else {
      ss.type = 'battle';
      this.spawnComp(comp(L), 1, sh, sd);
    }
  },
  // 目標物：敵方設施（摧毀）或友方據點（防衛），外觀用發生器模型、不動不開火
  campObjective(pos, team) {
    const P = PART_DEFS.pylon;
    const o = {
      name: team === 'ally' ? '防衛目標' : '目標設施',
      asm: P.asm,
      pal: team === 'ally' ? 'ally' : 'enemy',
      scale: 1.3,
      hpMul: (team === 'ally' ? 2.4 : 0.9) * this.scaleHp,
      dmgMul: 0,
      stabMul: 99,
      ai: 'objective',
      modelKind: 'part',
      vehKey: 'pylon',
      radius: 1.8,
      flying: true,
      hoverH: 0,
      at: pos,
    };
    if (team === 'enemy') {
      const e = this.spawnEnemy(o);
      e.noPush = true;
      return e;
    }
    o.palKey = o.pal;
    o.team = 'ally';
    const a = new MechEntity(this, o.asm, PALETTES[o.pal], o);
    a.pos.copy(pos);
    a.mesh.position.copy(pos);
    a.allyT = 1e9;
    a.noPush = true;
    this.registerSpawn(a);
    this.allies.push(a);
    return a;
  },
  // 護送：三台友方裝甲車沿公路從一端開到另一端，玩家從車隊旁出發
  campConvoy() {
    const w = this.world,
      c = this.camp;
    const S = w.trackS * 0.8;
    const dirS = Math.random() < 0.5 ? 1 : -1;
    const path = [];
    for (let s = -S; s <= S; s += 8) path.push(w.corridorPoint(s * dirS, 0));
    const start = path[0];
    const sp = w.corridorPoint(-S * dirS + dirS * 10, 9);
    this.player.pos.set(sp.x, w.terrainHeight(sp.x, sp.z), sp.z);
    let leader = null;
    c.ss.convoy = [];
    for (let i = 0; i < 3; i++) {
      const at = w.corridorPoint((-S - i * 9) * dirS, 0); // 起點後方依序排開
      const o = {
        name: '護送車輛',
        asm: {
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
        },
        pal: 'ally',
        palKey: 'ally',
        team: 'ally',
        scale: 0.9,
        hpMul: 1.8 * this.scaleHp,
        dmgMul: 0,
        stabMul: 99,
        ai: 'convoy',
        modelKind: 'vehicle',
        radius: 2,
        speedMul: 0.8,
        path,
        convoySpeed: 0.32,
        leader,
      };
      const a = new MechEntity(this, o.asm, PALETTES.ally, o);
      a.pos.set(at.x, at.y, at.z);
      a.mesh.position.copy(a.pos);
      a.yaw = a.aimYaw = Math.atan2(-(path[1].x - start.x), -(path[1].z - start.z));
      a.allyT = 1e9;
      this.registerSpawn(a);
      this.allies.push(a);
      c.ss.convoy.push(a);
      leader = a;
    }
    c.ss.waveT = 6;
    this.flashAlert('護送任務：保護車隊抵達公路的另一端');
  },
  // 帶進下一段的狀態：AP 比例、修復套件、各武器槽的彈藥比例（換武器時沿用被換下那把的比例）
  campCaptureEnt(p, prev) {
    const cy = { hp: 1, kits: null, ammo: { ...((prev && prev.ammo) || {}) } };
    cy.hp = p.dead ? 0.01 : clamp(p.hp / p.maxHp, 0.01, 1);
    cy.kits = p.kits;
    for (const s of WSLOTS) {
      const w = p.weapons[s];
      if (w && !w.dropped && w.def.ammo > 0) cy.ammo[s] = clamp(w.ammo / w.def.ammo, 0, 1);
    }
    return cy;
  },
  campCapture() {
    if (this.player) this.camp.carry = this.campCaptureEnt(this.player, this.camp.carry);
  },
  campApplyCarry(p, cy = this.camp.carry) {
    p.hp = Math.max(1, Math.round(p.maxHp * clamp(cy.hp == null ? 1 : cy.hp, 0, 1)));
    if (cy.kits != null) p.kits = clamp(cy.kits, 0, p.kitsMax);
    for (const s of WSLOTS) {
      const w = p.weapons[s];
      if (!w || !(w.def.ammo > 0) || cy.ammo[s] == null) continue;
      w.ammo = Math.round(w.def.ammo * cy.ammo[s]);
      if (w.def.mag) w.mag = Math.min(w.def.mag, w.ammo);
    }
  },
  // 目標還沒完成時，敵人全滅也不算清除（護送、情報、突破）
  campBlockClear() {
    const ss = this.camp.ss || {};
    if (ss.convoy && !ss.convoyDone) return true;
    if (ss.intel && !ss.intel.done) return true;
    if (ss.brk) return true;
    return false;
  },
  // 區段清除：發放上一個出口選的獎勵；最後一段就結束出擊，否則開出口
  campCleared() {
    const c = this.camp,
      so = this.campSortie();
    if (this.campBlockClear()) return;
    c.cleared = true;
    const last = c.seg >= so.segs.length - 1;
    // 最後一段的模組獎勵在結果畫面選
    if (c.pending && last && EXIT_REWARDS[c.pending].faction) c.endPick = EXIT_REWARDS[c.pending].faction;
    else if (c.pending) this.campGrant(c.pending);
    c.pending = null;
    if (last) {
      this.state = 'ending';
      this.flashMsg('作戰目標達成', 0x7ee081, 2);
      setTimeout(() => this.state === 'ending' && this.campEnd(true, false), 1800);
      return;
    }
    if (this.world.zoneShape === 'staged' && !c.ss.expanded) {
      c.ss.expanded = true;
      this.world.expandZone();
    }
    if (!c.exits.length) this.campSpawnExits();
    this.flashMsg('區段清除 — 選擇出口前往下一區', 0x7ee081, 2.4);
    SFX.ui();
    this.campComm('exitsOpen', this.campCtx());
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
      if (this.campMp()) this.campMpCoam(v); // 每位玩家各自入帳
    } else if (k === 'repair' && p) {
      for (const q of this.campMp() ? this.players : [p]) {
        if (q.dead) continue;
        q.hp = Math.min(q.maxHp, q.hp + Math.round(q.maxHp * 0.35));
        for (const s of WSLOTS) {
          const w = q.weapons[s];
          if (w && !w.dropped && w.def.ammo > 0)
            w.ammo = Math.min(w.def.ammo, w.ammo + Math.ceil(w.def.ammo * 0.35));
        }
        this.fx.ring(q.center(), 5, 0x7ee081);
      }
      this.flashMsg('出口獎勵：修理與補給', 0x7ee081, 2);
    } else if (k === 'xp') {
      const v = 120 + L * 30;
      this.camp.xpBonus += v;
      this.flashMsg(`出口獎勵：駕駛員經驗 +${v}`, 0x7fc8ff, 2);
    } else if (EXIT_REWARDS[k] && EXIT_REWARDS[k].faction) {
      // 戰術模組：三選一（單人暫停遊戲；多人每人各自選、不暫停）
      if (this.state === 'play') {
        this.campOpenPick(EXIT_REWARDS[k].faction);
        if (this.campMp()) this.campMpPick(EXIT_REWARDS[k].faction);
      } else this.camp.modNext = EXIT_REWARDS[k].faction;
    }
  },

  // ---------- 位置 ----------
  // 在作戰區域裡找 n 個空地：edge＝靠近作戰區域邊緣（接力型出口）、inner＝場內、near＝出生點附近（12～22 m）
  campSpots(n, kind) {
    const w = this.world,
      p = this.player.pos,
      Z = w.zoneGoal || w.zone,
      out = [];
    const ex = Math.min(Z[1] - Z[0], Z[3] - Z[2]);
    const free = (x, z) =>
      w.slopeOK(x, z) &&
      !w.isVoid(x, z) &&
      !w.isReserved(x, z, 3) &&
      !w.offLimits(x, z) &&
      !w.onCorridor(x, z, 2) &&
      !w.obstacles.some((o) =>
        o.kind === 'box'
          ? Math.abs(x - o.x) < o.w / 2 + 4 && Math.abs(z - o.z) < o.d / 2 + 4
          : Math.hypot(x - o.x, z - o.z) < o.r + 4,
      );
    const gap = kind === 'near' ? 0 : ex * 0.35;
    for (let t = 0; t < 600 && out.length < n; t++) {
      let x, z;
      if (kind === 'near') {
        const a = Math.random() * Math.PI * 2,
          r = rnd(12, 22);
        x = p.x + Math.cos(a) * r;
        z = p.z + Math.sin(a) * r;
      } else {
        x = rnd(Z[0] + 6, Z[1] - 6);
        z = rnd(Z[2] + 6, Z[3] - 6);
      }
      if (!w.inZone(x, z, 5) && !w.zoneGoal) continue;
      if (kind === 'edge') {
        const de = Math.min(x - Z[0], Z[1] - x, z - Z[2], Z[3] - z);
        if (de > ex * 0.2) continue;
      }
      if (!free(x, z)) continue;
      if (kind !== 'near' && t < 450 && Math.hypot(x - p.x, z - p.z) < ex * 0.3) continue;
      if (out.some((q) => Math.hypot(q.x - x, q.z - z) < Math.max(gap, 10) * (t < 450 ? 1 : 0.5))) continue;
      out.push(new THREE.Vector3(x, w.terrainHeight(x, z), z));
    }
    while (out.length < n) {
      const sp = w.spawnPoint(p, out);
      out.push(new THREE.Vector3(sp.x, w.terrainHeight(sp.x, sp.z), sp.z));
    }
    return out;
  },
  // 地面光環＋光柱＋標籤（出口、補給台、資料終端共用；不碰撞、不投影）
  campRing(pos, color, title, sub, r = PAD_R) {
    const col = new THREE.Color(color);
    const g = new THREE.Group();
    g.position.copy(pos);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r - 0.6, r, 40),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    g.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.9, r, 60, 24, 1, true),
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
    cv.height = sub ? 192 : 112;
    const x = cv.getContext('2d');
    x.fillStyle = 'rgba(10,14,20,0.78)';
    x.fillRect(0, 0, 512, cv.height);
    x.strokeStyle = '#' + col.getHexString();
    x.lineWidth = 6;
    x.strokeRect(3, 3, 506, cv.height - 6);
    x.fillStyle = '#' + col.getHexString();
    x.font = 'bold 60px sans-serif';
    x.textAlign = 'center';
    x.fillText(title, 256, 78);
    if (sub) {
      x.fillStyle = '#d8e2ec';
      x.font = '32px sans-serif';
      x.fillText(sub, 256, 146);
    }
    const tex = new THREE.CanvasTexture(cv);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    spr.scale.set(9, (9 * cv.height) / 512, 1);
    spr.position.y = 8;
    spr.renderOrder = 10;
    g.add(spr);
    g.userData.ring = ring;
    this.scene.add(g);
    return g;
  },
  campDisposeGroup(g) {
    if (!g) return;
    this.scene.remove(g);
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  },

  // ---------- 出口 ----------
  campSpawnExits() {
    const c = this.camp,
      so = this.campSortie(),
      cur = so.segs[c.seg],
      ni = c.seg + 1,
      next = so.segs[ni];
    if (!next) return;
    const mode = transMode(cur, next);
    let types = next.pool.filter(
      (t) => this.campTypeOk(t, ni) && !(c.heat && c.heat.nosupply && t === 'supply'),
    );
    if (!types.length) types = ['battle'];
    types = types.sort(() => Math.random() - 0.5);
    // 獎勵：一般獎勵與委託方的戰術模組混合，至少一個出口是模組
    const mods = Object.keys(EXIT_REWARDS)
      .filter((k) => EXIT_REWARDS[k].faction)
      .sort(() => Math.random() - 0.5);
    const plain = Object.keys(EXIT_REWARDS)
      .filter((k) => !EXIT_REWARDS[k].faction)
      .sort(() => Math.random() - 0.5);
    const rewards = [mods[0], ...[mods[1], plain[0], plain[1], mods[2]].sort(() => Math.random() - 0.5)];
    const n = Math.min(3, Math.max(2, types.length), rewards.length);
    // 陣營抉擇：這一段的出口換成互斥的抉擇出口（每個選項一個，獎勵是該委託方的模組）
    const CH = cur.choice && CHOICES[cur.choice];
    if (CH) {
      // 周目限定的選項（真結局）
      const cyc = this.campStory().cycle || 1;
      const opts = CH.opts.filter((o) => !o.cycle || cyc >= o.cycle);
      const spots = this.campSpots(opts.length, mode === 'relay' ? 'edge' : 'inner');
      const trs = transList(next.theme, mode).slice();
      c.exits = spots.map((pos, i) => {
        const o = opts[i],
          type = types[i % types.length],
          tr = trs[i % trs.length];
        const L = this.campExitLabel('mod_' + o.faction, type, tr.title, o.key, cur.choice);
        const group = this.campRing(pos, L.color, L.label, L.sub, EXIT_R);
        this.fx.ring(pos.clone().setY(pos.y + 0.2), 6, 0xff5050);
        return { pos, reward: 'mod_' + o.faction, type, mode, tr, t: 0, group, choice: o.key };
      });
      this.flashMsg(CH.name, 0xff8a50, 3);
      this.campComm('choice', this.campCtx());
      return;
    }
    const spots = this.campSpots(n, mode === 'relay' ? 'edge' : 'inner');
    // 轉場演出：同一次出擊盡量不重複
    let trs = transList(next.theme, mode).filter((t) => !c.usedTrans.includes(t.title));
    if (!trs.length) trs = transList(next.theme, mode).slice();
    trs = trs.sort(() => Math.random() - 0.5);
    c.exits = spots.map((pos, i) => {
      const reward = rewards[i % rewards.length],
        type = types[i % types.length],
        tr = trs[i % trs.length];
      const L = this.campExitLabel(reward, type, tr.title);
      const group = this.campRing(pos, L.color, L.label, L.sub, EXIT_R);
      this.fx.ring(pos.clone().setY(pos.y + 0.2), 6, 0xffb020);
      return { pos, reward, type, mode, tr, t: 0, group };
    });
  },
  // 出口光環的顏色與文字（房主與客機共用）：抉擇出口顯示選項與後果
  campExitLabel(reward, type, trTitle, choice, chId) {
    const R = EXIT_REWARDS[reward] || EXIT_REWARDS.coam;
    const o = choice && chId && CHOICES[chId] ? CHOICES[chId].opts.find((q) => q.key === choice) : null;
    if (o) return { color: FACTIONS[o.faction].color, label: `⚑ ${o.name}`, sub: o.sub };
    return {
      color: R.color,
      label: `${R.icon} ${R.name}`,
      sub: `${(SEG_TYPES[type] || SEG_TYPES.battle).name}・${trTitle}`,
    };
  },
  campClearExits() {
    const c = this.camp;
    if (!c) return;
    for (const ex of c.exits || []) this.campDisposeGroup(ex.group);
    c.exits = [];
    const ss = c.ss || {};
    if (ss.pad) this.campDisposeGroup(ss.pad.group);
    if (ss.intel) this.campDisposeGroup(ss.intel.group);
    if (ss.pad) ss.pad.group = null;
    if (ss.intel) ss.intel.group = null;
  },
  // 站在光環裡累計秒數（離開就歸零：reset）
  campStand(o, dt, r, reset = true) {
    const p = this.player;
    const on = Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z) < r && Math.abs(p.pos.y - o.pos.y) < 8;
    if (on) o.t += dt;
    else if (reset) o.t = 0;
    return on;
  },
  // 每格：作戰區域、各類型的目標、出口動畫與觸發
  campTick(dt) {
    const c = this.camp,
      ss = c.ss || {},
      w = this.world;
    c.time += dt;
    c.hint = '';
    const p = this.player;
    if (!p) return;
    w.tickZone(dt);
    // 危險條款：限時 25 分鐘
    if (c.heat && c.heat.timed && c.time > 1500 && this.state === 'play') {
      this.flashMsg('超過作戰時限', 0xff4d4d, 3);
      this.state = 'ending';
      return this.campDead(true);
    }
    // Boss 剩一半時的通訊
    if (this.bosses && this.bosses.length && this.isBossLevel && !ss.half) {
      const hp = this.bosses.reduce((a, b) => a + Math.max(0, b.hp), 0),
        mx = this.bosses.reduce((a, b) => a + b.maxHp, 0);
      if (hp < mx * 0.5) {
        ss.half = true;
        this.campComm('bossHalf', this.campCtx());
      }
    }
    // 分段開放：擊破一半的敵人後擴大作戰區域
    if (w.zoneShape === 'staged' && !ss.expanded) {
      const dead = this.enemies.filter((e) => e.dead).length;
      if (dead >= Math.ceil((ss.n0 || 1) / 2)) {
        ss.expanded = true;
        w.expandZone();
        this.flashAlert('作戰區域擴大');
      }
    }
    for (const g of [ss.pad && ss.pad.group, ss.intel && ss.intel.group])
      if (g) g.userData.ring.rotation.z += dt * 0.8;
    if (ss.defend && ss.defend.dead && this.state === 'play') {
      this.flashMsg('防衛目標被摧毀', 0xff4d4d, 3);
      this.state = 'ending';
      return this.campDead(true);
    }
    if (ss.convoy) this.campConvoyTick(dt);
    if (this.state !== 'play') return;
    const mp = this.campMp();
    if (ss.pad && !ss.pad.used) {
      const who = mp
        ? this.campStandAny(ss.pad, dt, PAD_R)
        : !p.dead && this.campStand(ss.pad, dt, PAD_R)
          ? p
          : null;
      if (who && who === p) c.hint = '補給中…';
      if (ss.pad.t >= 1.5 && who) {
        ss.pad.used = true;
        const p = who;
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.5));
        p.kits = Math.min(p.kitsMax, p.kits + 1);
        for (const s of WSLOTS) {
          const wp = p.weapons[s];
          if (wp && !wp.dropped && wp.def.ammo > 0)
            wp.ammo = Math.min(wp.def.ammo, wp.ammo + Math.ceil(wp.def.ammo * 0.5));
        }
        this.fx.ring(p.center(), 6, 0x7ee081);
        SFX.kit();
        this.flashMsg('補給完成：AP 50%、彈藥 50%、修復套件 +1', 0x7ee081, 2.4);
        this.campDisposeGroup(ss.pad.group);
        ss.pad.group = null;
        if (who === this.player)
          setTimeout(() => this.camp && this.state === 'play' && this.campOpenShop(), 900);
        else if (mp) this.campMpShop(who);
      }
    }
    if (ss.intel && !ss.intel.done) {
      if (
        mp
          ? this.campStandAny(ss.intel, dt, PAD_R, false)
          : !p.dead && this.campStand(ss.intel, dt, PAD_R, false)
      )
        c.hint = `下載情報… ${Math.min(100, Math.round((ss.intel.t / 4) * 100))}%`;
      if (ss.intel.t >= 4) {
        ss.intel.done = true;
        const v = 150 + this.campLevel() * 30;
        c.xpBonus += v;
        const seg = this.campSortie().segs[c.seg];
        this.flashAlert('取得情報：' + pick(INTEL[seg.theme] || ['作戰區域的配置圖']));
        this.flashMsg(`情報下載完成（經驗 +${v}）`, 0x7fc8ff, 2.4);
        this.campDisposeGroup(ss.intel.group);
        ss.intel.group = null;
      }
    }
    if (ss.brk) {
      ss.brk.t -= dt;
      ss.brk.waveT -= dt;
      if (ss.brk.waveT <= 0) {
        ss.brk.waveT = ss.brk.t > 0 ? 14 : 7;
        for (const t of this.rollComp(Math.max(1, this.campLevel() - 1), ss.np || 1).slice(0, 3))
          this.spawnType(t, this.scaleHp, this.scaleDmg);
        this.flashAlert(ss.brk.t > 0 ? '敵方增援抵達' : '時間超過 — 增援加劇');
      }
    }
    if (!c.exits || !c.exits.length) return;
    if (mp) return this.campVoteTick(dt); // 多人：出口投票（campaign-mp.js）
    if (p.dead) return;
    for (const ex of c.exits) {
      ex.group.userData.ring.rotation.z += dt * 0.8;
      if (this.campStand(ex, dt, EXIT_R)) {
        c.hint = `進入出口：${SEG_TYPES[ex.type].name}・${EXIT_REWARDS[ex.reward].name}…`;
        if (ex.t >= EXIT_HOLD) return this.campLeave(ex);
      }
    }
  },
  // 護送：車隊全滅＝失敗；全部抵達＝清除（剩下的敵軍撤退）；途中定時在車隊前方出現敵軍
  campConvoyTick(dt) {
    const c = this.camp,
      ss = c.ss;
    if (ss.convoyDone) return;
    const alive = ss.convoy.filter((a) => !a.dead);
    if (!alive.length && this.state === 'play') {
      this.flashMsg('護送車隊全滅', 0xff4d4d, 3);
      this.state = 'ending';
      return this.campDead(true);
    }
    if (alive.length && alive.every((a) => a.arrived)) {
      ss.convoyDone = true;
      this.waves = [];
      let n = 0;
      for (const e of this.enemies)
        if (!e.dead) {
          e.dead = true;
          e.mesh.visible = false;
          n++;
        }
      if (n) this.flashAlert('車隊抵達 — 敵軍撤退');
      return;
    }
    ss.waveT -= dt;
    if (ss.waveT <= 0 && alive.length) {
      ss.waveT = 16;
      const lead = alive[0];
      const w = this.world;
      const i = Math.min((lead.pathI || 0) + 4, lead.opts.path.length - 1);
      const q = lead.opts.path[i];
      const side = Math.random() < 0.5 ? 1 : -1;
      const at = new THREE.Vector3(q.x + side * rnd(12, 20), 0, q.z + side * rnd(-6, 6));
      const [x, z] = w.nearSolid(clamp(at.x, -w.lim + 4, w.lim - 4), clamp(at.z, -w.lim + 4, w.lim - 4));
      at.set(x, w.terrainHeight(x, z), z);
      for (const t of this.rollComp(Math.max(1, this.campLevel() - 1), 1).slice(0, 3))
        this.spawnType(t, this.scaleHp, this.scaleDmg, at);
      this.flashAlert('敵軍襲擊車隊');
    }
  },
  campLeave(ex) {
    const c = this.camp;
    SFX.ui();
    if (!c.cleared && c.pending) {
      this.state = 'leaving';
      this.campGrant(c.pending); // 突破：沒有全滅也發放（模組延到下一段選）
      this.state = 'play';
      c.pending = null;
    }
    if (this.campMp()) this.campCaptureAll();
    else this.campCapture();
    c.earned += this.missionEarned || 0;
    c.pending = ex.reward;
    if (ex.choice) {
      // 陣營抉擇：出擊完成時寫進存檔（紀錄點也記著）
      c.choice = { id: this.campSortie().segs[c.seg].choice, key: ex.choice };
      const o = CHOICES[c.choice.id].opts.find((q) => q.key === ex.choice);
      this.flashMsg(`抉擇：${o.name}（${FACTIONS[o.faction].name}）`, 0xff8a50, 3);
    }
    c.seg++;
    c.types[c.seg] = ex.type;
    c.trans[c.seg] = ex.tr;
    c.usedTrans.push(ex.tr.title);
    this.clearMission();
    this.campCheckpoint(); // 紀錄點＝這次轉場的起點（整備後再記一次）
    this.campShowTrans(ex.tr, false);
  },

  // ---------- 轉場畫面 ----------
  campShowTrans(tr, first) {
    const c = this.camp,
      so = this.campSortie();
    const $ = (id) => document.getElementById(id);
    this.state = 'camptrans';
    this.showScreen('campTrans');
    $('ctTitle').textContent = tr.title;
    $('ctSub').textContent = tr.sub;
    $('ctNext').textContent =
      `${so.name}　區段 ${c.seg + 1}／${so.segs.length}【${SEG_TYPES[this.campSegType()].name}】${this.campSegName()}`;
    $('ctReward').textContent = c.pending
      ? `本區段清除後獲得：${EXIT_REWARDS[c.pending].name}（${EXIT_REWARDS[c.pending].desc}）`
      : '';
    $('ctMods').innerHTML = this.campModsHtml();
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
    if (first !== 'resume' && c.seg > 0) this.campComm('trans', this.campCtx());
    $('ctWait').textContent = '';
    if (this.campMp()) this.campMpTrans(tr, first);
  },
  campGo() {
    if (this.campIsClient()) return this.campClientReady();
    if (!this.camp) return;
    SFX.ui();
    if (this.campMp()) {
      // 多人：等全員準備（campaign-mp.js 的 campWaitCheck 開始下一段）
      document.getElementById('ctBtns').style.visibility = 'hidden';
      if (this.state === 'garage') {
        this.state = 'camptrans';
        this.showScreen('campTrans');
      }
      return this.campMarkReady(this.net.me);
    }
    this.campCheckpoint();
    this.campEnterSeg();
  },
  // 進車庫整備：沿用車庫畫面，按鈕換成「繼續作戰」
  campGarage() {
    if (this.campIsClient()) return this.campClientGarage();
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
    const inG = !!((this.camp && this.camp.inGarage) || (this.campC && this.campC.inGarage));
    $('btnCamp').style.display = mp || inG ? 'none' : '';
    $('btnToTitle').textContent = this.fromHub ? '返回機庫' : '回標題';
    if (inG) {
      $('btnSortie').style.display = 'none';
      $('btnToTitle').style.display = 'none';
    }
    $('gMap').style.display = inG ? 'none' : ''; // 主線的地圖由出擊決定
    box.style.display = inG ? '' : 'none';
    if (!inG) return;
    const cl = this.campIsClient();
    const T = cl ? this.campC.trans || {} : null;
    $('mcTitle').textContent = `主線出擊｜${cl ? T.so || '' : this.campSortie().name}`;
    $('mcDesc').textContent =
      `轉場整備中：${cl ? T.next || '' : `下一個是區段 ${this.camp.seg + 1}／${this.campSortie().segs.length}【${SEG_TYPES[this.campSegType()].name}】${this.campSegName()}`}。換裝時 AP 依比例換算，換上的武器沿用該武器槽的剩餘彈藥比例。`;
    const cost = this.campCosts();
    const cy = this.campCarry();
    $('gCampInfo').innerHTML =
      `AP <b>${Math.round((cy.hp == null ? 1 : cy.hp) * 100)}%</b>　彈藥 <b>${Math.round(cost.ammoPct * 100)}%</b><div class="gCampMods">${cl ? '' : this.campModsHtml()}</div>`;
    $('btnCampRepair').textContent = cost.repair
      ? `修理 AP（${cost.repair.toLocaleString()} COAM）`
      : 'AP 已滿';
    $('btnCampRepair').disabled = !cost.repair || this.save.coam < cost.repair;
    $('btnCampAmmo').textContent = cost.ammo ? `補充彈藥（${cost.ammo.toLocaleString()} COAM）` : '彈藥已滿';
    $('btnCampAmmo').disabled = !cost.ammo || this.save.coam < cost.ammo;
    $('btnCampGo2').disabled = warn.length > 0;
  },
  // 整備的花費：修理到滿、補彈到滿（以目前裝備的實彈武器平均缺少比例計）
  // 整備用的「自己的狀態」：房主／單人在 camp.carry，客機在 campC.carry
  campCarry() {
    if (this.campIsClient()) return (this.campC.carry = this.campC.carry || { hp: 1, kits: null, ammo: {} });
    return this.camp.carry;
  },
  campCosts() {
    const cy = this.campCarry(),
      L = this.campIsClient() ? 3 : this.campLevel();
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
    this.campCarry().hp = 1;
    if (!this.campIsClient()) this.campCheckpoint();
    else this.writeSave();
    SFX.ui();
    this.renderGarage();
  },
  campAmmo() {
    const k = this.campCosts().ammo;
    if (!k || this.save.coam < k) return;
    this.save.coam -= k;
    for (const s of WSLOTS) this.campCarry().ammo[s] = 1;
    if (!this.campIsClient()) this.campCheckpoint();
    else this.writeSave();
    SFX.ui();
    this.renderGarage();
  },
  campGarageGo() {
    if (this.campIsClient()) return this.campClientReady();
    if (!this.camp) return;
    this.camp.inGarage = false;
    this.campGo();
  },

  // ---------- 失敗／結束 ----------
  // 陣亡或目標失敗（obj：防衛目標被毀、車隊全滅，這時 state 已是 ending）
  campDead(obj) {
    this.campKilledBy = obj ? '' : (this.player && this.player.lastHitBy) || '';
    setTimeout(() => {
      if ((this.state === 'play' || (obj && this.state === 'ending')) && this.camp) this.campFail();
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
    document.getElementById('ctBtns2').style.display = '';
    // 失敗的通訊（依擊破你的敵人、失敗次數）直接顯示在失敗畫面
    this.commClear();
    const e = this.campComm('fail', this.campCtx({ killedBy: this.campKilledBy }), false);
    document.getElementById('cfComm').innerHTML = e
      ? e.lines
          .map(([sp, text]) => {
            const S = SPEAKERS[sp] || SPEAKERS.echo;
            return `<div class="cLine">${speakerBadge(sp)}<div><b style="color:${S.color}">${escHtml(S.name)}</b><span>${escHtml(text)}</span></div></div>`;
          })
          .join('')
      : '';
    if (this.campMp()) {
      c.lastFail = {
        t: 'cfail',
        info: document.getElementById('cfInfo').textContent,
        lines: e ? e.lines : [],
      };
      this.net.tr.broadcast(c.lastFail);
    }
  },
  campRetry(toGarage) {
    SFX.ui();
    this.campRestore();
    if (toGarage) return this.campGarage();
    this.campShowTrans(this.camp.trans[this.camp.seg] || TRANSITIONS.drop, 'resume');
  },
  // 機庫的「繼續出擊」：從存檔的紀錄點接回
  campResume() {
    SFX.ui();
    if (this.campStory().sortie && this.campRestore())
      this.campShowTrans(this.camp.trans[this.camp.seg] || TRANSITIONS.drop, 'resume');
  },
  // 放棄存檔裡的紀錄點（車庫）
  campDrop() {
    const st = this.campStory();
    if (!st.sortie) return;
    if (!confirm('放棄目前的主線出擊？紀錄點會被刪除。')) return;
    st.sortie = null;
    this.camp = null;
    this.writeSave();
    if (this.state === 'hub') this.renderHub();
    else this.renderGarage();
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
    const mp = this.campMp();
    const xpAll = this.pilotEndXpPve(success, aborted);
    for (const k in xpAll) {
      xpAll[k].x += c.xpBonus;
      xpAll[k].m += c.xpBonus;
    }
    const e = xpAll[mp ? this.net.me : 0];
    let bonus = 0;
    if (success) {
      bonus = Math.round((so.reward * this.heatMul(c.heat)) / 100) * 100; // 危險條款的報酬加成
      S.coam += bonus;
      st.done[c.sid] = (st.done[c.sid] || 0) + 1;
      if (c.choice && !c.replay) st.choices[c.choice.id] = c.choice.key; // 陣營抉擇（重打不改）
      // 終章：依最後的抉擇進入結局（結果畫面按確定之後）
      if (so.final && !c.replay && !mp) {
        const key = (c.choice && c.choice.key) || 'open';
        st.endings = st.endings || {};
        st.endings[key] = (st.endings[key] || 0) + 1;
        this.campEnding = key;
      }
      this.campComm('sortieEnd', this.campCtx());
      // 整章都完成時戰術模組清空（重打不影響）
      if (!c.replay && this.campChapterCheck(so.chapter)) {
        c.endPick = null; // 整章完成：模組重置，不再選
        this.flashMsg('章節完成：戰術模組重置', 0xffd060, 3);
      }
    } else if (c.mods0) this.campSetMods(c.mods0); // 失敗／放棄：退回出擊開始時的模組
    this.campResultHub = !mp; // 結果畫面的「確定」回到機庫（多人回大廳）
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
      ...(c.replay ? [['作戰紀錄', this.heatNames(c.heat).join('、') || '無危險條款']] : []),
      ['擊破數', String(c.stats[0] ? c.stats[0].kills : 0)],
      ['報酬（已即時入帳）', '+' + c.earned.toLocaleString()],
      ['作戰完成報酬', '+' + bonus.toLocaleString()],
      ['COAM 結餘', S.coam.toLocaleString()],
    ];
    $('resultGrid').innerHTML = rows
      .map((r) => `<span class="dim">${escHtml(r[0])}</span><span>${escHtml(r[1])}</span>`)
      .join('');
    $('btnResultOk').textContent = mp ? '返回大廳' : '返回機庫';
    this.showScreen('result');
    if (mp) {
      // 多人：經驗依每位玩家、作戰完成報酬各自入帳（clientEnd）
      clearInterval(this.campWaitIv);
      if (aborted) this.net.tr.broadcast({ t: 'abort', pvp: false, xpBySlot: xpAll });
      else
        this.net.tr.broadcast({
          t: 'end',
          success,
          title: $('rTitle').textContent,
          rank,
          bonus: success ? so.reward : 0,
          xpBySlot: xpAll,
          rows: rows.filter((r) => r[0] !== 'COAM 結餘'),
        });
      for (const x of this.net.players) x.ready = false;
    }
    if (success && c.endPick) this.campOpenPick(c.endPick);
  },

  // ---------- HUD ----------
  campHudTop() {
    return this.campHudHtml(this.campView());
  },
  // HUD 上方的作戰資訊（房主與單人由 campView 產生，客機用快照帶來的同一份資料）
  campHudHtml(v) {
    return `<b>主線｜${escHtml(v.so)}</b> ｜ 區段 ${v.seg + 1}／${v.n}【${escHtml((SEG_TYPES[v.type] || SEG_TYPES.battle).name)}】${escHtml(v.name)}<div id="objective">${escHtml(v.goal)} ｜ ${Math.floor(v.time / 60)} 分</div><div style="color:var(--acc)">COAM ${this.save.coam.toLocaleString()}${v.pend ? ` <span class="dim">（清除後：${escHtml(v.pend)}）</span>` : ''}</div>`;
  },
  campGoal(alive, wavesLeft) {
    const c = this.camp,
      ss = c.ss || {};
    let goal;
    if (c.cleared) goal = c.hint || '前往出口（站進光環）';
    else if (c.hint) goal = c.hint;
    else if (ss.targets)
      goal = `摧毀目標 ${ss.targets.filter((e) => e.dead).length}／${ss.targets.length} ｜ 殘存敵軍 ${alive}`;
    else if (ss.defend)
      goal = `防衛目標 AP ${Math.round((Math.max(0, ss.defend.hp) / ss.defend.maxHp) * 100)}% ｜ 殘存敵軍 ${alive}${wavesLeft ? '（尚有增援）' : ''}`;
    else if (ss.convoy)
      goal = ss.convoyDone
        ? '車隊已抵達'
        : `護送車隊 ${ss.convoy.filter((a) => !a.dead).length}／${ss.convoy.length} 台 ｜ 敵軍 ${alive}`;
    else if (ss.brk)
      goal = ss.brk.t > 0 ? `突破：前往出口（${Math.ceil(ss.brk.t)} 秒）` : '突破：增援加劇，盡快抵達出口';
    else if (ss.intel && !ss.intel.done) goal = `前往資料終端下載情報 ｜ 殘存敵軍 ${alive}`;
    else
      goal = `${SEG_TYPES[ss.type || 'battle'].goal} ｜ 殘存敵軍 ${alive}${wavesLeft ? '（尚有增援）' : ''}`;
    return goal;
  },
  // 出口、補給台、資料終端的標記：畫面內畫在上方，畫面外貼在畫面邊緣
  campDrawHud(ctx) {
    const c = this.camp;
    if (!this.player) return;
    const marks = [];
    const mk = (pos, reward, color, icon) =>
      marks.push({
        pos,
        color: reward ? EXIT_REWARDS[reward].color : color,
        icon: reward ? EXIT_REWARDS[reward].icon : icon,
      });
    if (c) {
      const ss = c.ss || {};
      for (const ex of c.exits || []) mk(ex.pos, ex.reward);
      if (ss.pad && ss.pad.group) mk(ss.pad.pos, null, '#7ee081', '補');
      if (ss.intel && ss.intel.group) mk(ss.intel.pos, null, '#7fc8ff', '情');
    } else if (this.campC && this.campC.vis) {
      const V = this.campC.vis;
      for (const ex of V.exits || []) mk(ex.pos, ex.reward);
      if (V.pad) mk(V.pad.pos, null, '#7ee081', '補');
      if (V.intel) mk(V.intel.pos, null, '#7fc8ff', '情');
    }
    if (!marks.length) return;
    const W = innerWidth,
      H = innerHeight;
    for (const mk of marks) {
      const v = mk.pos.clone();
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
      const d = Math.round(Math.hypot(this.player.pos.x - mk.pos.x, this.player.pos.z - mk.pos.z));
      ctx.save();
      ctx.fillStyle = mk.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px sans-serif';
      ctx.strokeText(`${mk.icon} ${d}m`, x, y);
      ctx.fillText(`${mk.icon} ${d}m`, x, y);
      if (edge) {
        ctx.beginPath();
        ctx.arc(x, y - 5, 15, 0, Math.PI * 2);
        ctx.strokeStyle = mk.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.restore();
    }
  },
});
