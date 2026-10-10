// Game：主線的多人合作（docs/campaign-design.md 第 10 節）
// 房主持有 this.camp（與單人相同的出擊狀態，另加每位玩家的 carryBy）；客機只有顯示用的 this.campC
// ＝{ view（房主快照的 mis.camp）, trans（轉場訊息）, carry（自己的狀態）, vis（出口等光環）}，以及最後的紀錄點 campCk
// （房主遷移時接手）。出口投票、轉場等待全員、每人各自三選一、紀錄點廣播都在這裡。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { EXIT_REWARDS, SEG_TYPES, SORTIES } from '../data/campaign.js';
import { MODULES, modLabel, modOffer, modsPm } from '../data/modules.js';
import { START_ASM } from '../data/parts.js';
import { pilotPayload, sanitizePayload } from '../data/pilot.js';
import { SPEAKERS, speakerBadge } from '../data/story.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PLAYER_PALS } from '../net/transports.js';
import { PALETTES } from '../render/materials.js';
import { Game } from './game.js';

const VOTE_T = 10; // 出口投票的倒數
const WAIT_T = 90; // 轉場時等待隊友（整備）的上限
const EXIT_R = 4;
const WSLOTS = ['rarm', 'larm', 'rback', 'lback'];
const clone = (o) => JSON.parse(JSON.stringify(o));

Object.assign(Game.prototype, {
  campMp() {
    return !!(this.camp && this.net && this.net.role === 'host');
  },
  campIsClient() {
    return !!(this.campC && this.net && this.net.role === 'client');
  },
  // 大廳出擊（房間模式「主線合作」）：房主的進度、房主選的委託
  campBeginMp(sid) {
    if (!SORTIES[sid] || this.hubSortieState(sid) === 'locked') sid = 'c1s1';
    this.campStory().sortie = null;
    this.campBegin(sid);
  },
  // ---------- 房主：玩家與模組 ----------
  // 客機的模組存在房主存檔的 story.mpMods（以暱稱對應，延續到整章結束）；房主自己的用 campMods
  campMpMods() {
    const st = this.campStory();
    const ch = this.campSortie().chapter;
    if (!st.mpMods || st.mpMods.chapter !== ch) st.mpMods = { chapter: ch, by: {} };
    return st.mpMods.by;
  },
  campModsFor(pl) {
    if (pl.slot === this.net.me) return this.campMods();
    return (this.campMpMods()[pl.nick] || []).filter((m) => MODULES[m.id]);
  },
  campPmFor(pl) {
    const pm = { ...(this.pilotModsForPlayer(pl, 'pve') || { pf: {} }) };
    const mp = modsPm(this.campModsFor(pl));
    for (const k in mp) pm[k] = (pm[k] || 0) + mp[k];
    return pm;
  },
  // 多人版的玩家生成：模組加成、帶著上一段的狀態
  campMpSpawn() {
    const n = this.net,
      c = this.camp;
    c.carryBy = c.carryBy || {};
    this.players = [];
    const online = n.players.filter((p) => p.online);
    online.forEach((pl, i) => {
      const a = (Math.PI * 2 * i) / Math.max(1, online.length);
      const x = Math.cos(a) * 4,
        z = Math.sin(a) * 4;
      const e = new MechEntity(this, pl.asm || START_ASM, PALETTES[PLAYER_PALS[pl.color]], {
        team: 'player',
        name: pl.nick,
        palKey: PLAYER_PALS[pl.color],
        slot: pl.slot,
        ms: pl.ms || null,
        pilot: this.campPmFor(pl),
      });
      e.slot = pl.slot;
      e.isPlayer = pl.slot === n.me;
      e.pos.set(x, this.world.terrainHeight(x, z), z);
      e.mesh.position.copy(e.pos);
      this.campApplyCarry(e, c.carryBy[pl.slot] || { hp: 1, kits: null, ammo: {} });
      this.players.push(e);
      this.registerSpawn(e);
      if (e.isPlayer) this.player = e;
      if (!c.stats[pl.slot]) c.stats[pl.slot] = { kills: 0, dmg: 0, rev: 0, taken: 0, xp: 0, pf: {} };
    });
  },
  // 開局訊息（同一般任務，加上 World 的主線參數與區段顯示）
  campStartMsg() {
    const w = this.world;
    return {
      t: 'start',
      pace: this.ctrl.pace || 1,
      seed: this.worldSeed,
      theme: this.worldTheme,
      variant: w.variantKey,
      wopt: w.netOpt(),
      feat: w.netFeat(),
      level: this.campLevel(),
      players: this.net.players.map((p) => ({ slot: p.slot, nick: p.nick, color: p.color })),
      spawns: Object.values(this.net.spawnReg),
      bossName: this.bossDef ? this.bossDef.name : '',
      camp: this.campView(),
    };
  },
  // HUD 與出口光環的顯示資料（房主每個快照帶給客機）
  campView() {
    const c = this.camp,
      so = this.campSortie(),
      ss = c.ss || {};
    const alive = this.enemies.filter((e) => !e.dead).length;
    const P = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
    const chId = c.exits && c.exits.some((e) => e.choice) ? so.segs[c.seg].choice : '';
    const ex = (c.exits || []).map((e) => [...P(e.pos), e.reward, e.type, e.tr.title, e.choice || '', chId]);
    const pad = ss.pad && ss.pad.group ? P(ss.pad.pos) : 0;
    const intel = ss.intel && ss.intel.group ? P(ss.intel.pos) : 0;
    return {
      so: so.name,
      seg: c.seg,
      n: so.segs.length,
      type: ss.type || this.campSegType(),
      name: this.levelName,
      goal: this.campGoal(alive, this.waves.length),
      pend: c.pending ? EXIT_REWARDS[c.pending].name : '',
      time: Math.floor(c.time),
      boss: !!this.isBossLevel || !!ss.elite,
      ex,
      pad,
      intel,
      vk: JSON.stringify([ex.map((e) => e.slice(0, 3)), pad, intel]),
    };
  },
  // ---------- 房主：出口投票 ----------
  // 有人站進出口就開始倒數；時間到時人最多的出口勝出（平手：房主在的、再來是第一個）；全員同一個出口時立刻出發
  campVoteTick(dt) {
    const c = this.camp;
    const alive = this.players.filter((p) => !p.dead && !p.downed);
    if (!alive.length) return;
    const inEx = (p, ex) =>
      Math.hypot(p.pos.x - ex.pos.x, p.pos.z - ex.pos.z) < EXIT_R && Math.abs(p.pos.y - ex.pos.y) < 8;
    const cnt = c.exits.map((ex) => alive.filter((p) => inEx(p, ex)).length);
    const total = cnt.reduce((a, b) => a + b, 0);
    for (const ex of c.exits) ex.group.userData.ring.rotation.z += dt * 0.8;
    if (!total) {
      c.vote = null;
      return;
    }
    const all = cnt.findIndex((k) => k === alive.length);
    if (!c.vote) c.vote = { t: c.exits.some((e) => e.choice) ? VOTE_T * 2 : VOTE_T, hold: 0 }; // 抉擇出口 20 秒
    if (all >= 0) {
      c.vote.hold += dt;
      if (c.vote.hold >= 0.8) return this.campLeave(c.exits[all]);
    } else c.vote.hold = 0;
    c.vote.t -= dt;
    c.hint = `出口投票：${Math.max(0, Math.ceil(c.vote.t))} 秒（${c.exits
      .map((ex, i) => `${EXIT_REWARDS[ex.reward].name} ${cnt[i]}`)
      .join('・')}）`;
    if (c.vote.t <= 0) {
      const max = Math.max(...cnt);
      let pickI = cnt.findIndex((k, i) => k === max && this.player && inEx(this.player, c.exits[i]));
      if (pickI < 0) pickI = cnt.indexOf(max);
      this.campLeave(c.exits[pickI]);
    }
  },
  // 補給台與資料終端：任何一位玩家站上去都算（回傳站在上面的玩家）
  campStandAny(o, dt, r, reset = true) {
    const on = this.players.find(
      (p) =>
        !p.dead && Math.hypot(p.pos.x - o.pos.x, p.pos.z - o.pos.z) < r && Math.abs(p.pos.y - o.pos.y) < 8,
    );
    if (on) o.t += dt;
    else if (reset) o.t = 0;
    return on || null;
  },
  // ---------- 房主：轉場與等待 ----------
  campCaptureAll() {
    const c = this.camp;
    c.carryBy = c.carryBy || {};
    for (const e of this.players) {
      const prev = c.carryBy[e.slot] || { hp: 1, kits: null, ammo: {} };
      c.carryBy[e.slot] = this.campCaptureEnt(e, prev);
    }
    if (this.player) c.carry = c.carryBy[this.net.me];
  },
  // 轉場畫面出現時：告訴客機、開始等待全員準備（第一次空降時大家在大廳已經準備好了）
  campMpTrans(tr, first) {
    const c = this.camp,
      so = this.campSortie(),
      n = this.net;
    const online = n.players.filter((p) => p.online);
    const mods = {};
    for (const pl of online) mods[pl.slot] = this.campModsFor(pl).map((m) => modLabel(m.id, m.lv));
    const msg = {
      t: 'ctrans',
      title: tr.title,
      sub: tr.sub,
      next: document.getElementById('ctNext').textContent,
      reward: document.getElementById('ctReward').textContent,
      carry: c.carryBy || {},
      mods,
      resume: first === 'resume',
      first: first === true,
      so: so.name,
    };
    c.lastTrans = msg;
    n.tr.broadcast(msg);
    c.wait = {
      t0: performance.now(),
      ready: new Set(first === true ? online.map((p) => p.slot) : []),
      slots: online.map((p) => p.slot),
    };
    clearInterval(this.campWaitIv);
    this.campWaitIv = setInterval(() => this.campWaitCheck(), 500);
    this.campWaitCheck();
  },
  // 主迴圈每格呼叫（轉場等待中）：每 0.5 秒檢查一次、順便讓客機知道房主還在（背景分頁的計時器會被節流）
  campWaitTick() {
    const now = performance.now();
    if (now - (this.campWaitLast || 0) < 500) return;
    this.campWaitLast = now;
    this.campWaitCheck();
  },
  campMarkReady(slot) {
    const c = this.camp;
    if (!c || !c.wait) return;
    c.wait.ready.add(slot);
    this.campWaitCheck();
  },
  campWaitCheck() {
    const c = this.camp;
    if (!c || !c.wait || !this.campMp()) return clearInterval(this.campWaitIv);
    const n = this.net;
    const need = c.wait.slots.filter((s) => {
      const p = n.playerBySlot(s);
      return p && p.online;
    });
    const el = (performance.now() - c.wait.t0) / 1000;
    const done = need.filter((s) => c.wait.ready.has(s)).length;
    const left = Math.max(0, Math.ceil(WAIT_T - el));
    const txt = `準備完成 ${done}／${need.length}${done < need.length ? `（最多再等 ${left} 秒）` : ''}`;
    const w = document.getElementById('ctWait');
    if (w) w.textContent = c.wait.ready.has(n.me) ? txt : '';
    n.tr.broadcast({ t: 'cwait', txt, ready: [...c.wait.ready] });
    // 第一次空降：等轉場演出播完
    const minT = c.lastTrans && c.lastTrans.first ? 2.4 : 0;
    if ((done >= need.length && el >= minT) || el >= WAIT_T) {
      clearInterval(this.campWaitIv);
      c.wait = null;
      if (this.state === 'garage') c.inGarage = false;
      this.campCheckpoint();
      this.campEnterSeg();
    }
  },
  // 客機準備好了（可能在車庫換了裝、修理過）
  campOnReady(p, d) {
    const c = this.camp;
    if (!c || !this.campMp()) return;
    if (d.asm && typeof d.asm === 'object') p.asm = d.asm;
    if (d.pilot) p.pilot = sanitizePayload(d.pilot) || p.pilot;
    if (d.carry && typeof d.carry === 'object') {
      const am = {};
      for (const s of WSLOTS)
        if (Number.isFinite(d.carry.ammo && d.carry.ammo[s])) am[s] = clamp(d.carry.ammo[s], 0, 1);
      c.carryBy[p.slot] = {
        hp: clamp(Number(d.carry.hp) || 0, 0.01, 1),
        kits: Number.isFinite(d.carry.kits) ? d.carry.kits : null,
        ammo: am,
      };
    }
    this.campMarkReady(p.slot);
  },
  // 重新連上的玩家（房主遷移、掉線回來）：轉場中就補送轉場訊息；回傳 true＝已處理
  campOnRejoin(pl) {
    const c = this.camp;
    if (!c || !this.campMp() || this.state === 'play') return false;
    this.net.tr.send(pl.peerId, {
      t: 'welcome',
      slot: pl.slot,
      room: this.net.roomName,
      rejoin: true,
      inMission: true,
    });
    if (c.lastTrans) this.net.tr.send(pl.peerId, c.lastTrans);
    if (this.state === 'campfail' && c.lastFail) this.net.tr.send(pl.peerId, c.lastFail);
    return true;
  },
  // ---------- 房主：模組（每人各自三選一）、獎勵 ----------
  campMpPick(faction) {
    const n = this.net;
    for (const pl of n.players.filter((p) => p.online && p.slot !== n.me)) {
      const opts = modOffer(this.campModsFor(pl), faction, Math.random);
      if (opts.length) n.tr.send(pl.peerId, { t: 'cpick', f: faction, opts });
    }
  },
  campOnPicked(p, d) {
    if (!this.campMp() || !d || !MODULES[d.id]) return;
    const by = this.campMpMods();
    const list = (by[p.nick] || []).slice();
    const cur = list.find((m) => m.id === d.id);
    const lv = clamp(Math.round(d.lv) || 1, 1, 3);
    if (cur) cur.lv = Math.max(cur.lv, lv);
    else list.push({ id: d.id, lv });
    by[p.nick] = list;
    this.writeSave();
    this.netEv({ t: 'msg', txt: `${p.nick} 取得 ${MODULES[d.id].name} Lv${lv}`, c: 0xffd060 });
  },
  // 客機用完補給台：商店的選項送給那位玩家（價格同房主的商店，自己付 COAM）
  campMpShop(who) {
    const pl = this.net.playerBySlot(who.slot);
    if (!pl || !pl.online) return;
    const L = this.campLevel();
    const price = Math.round((7000 + L * 1500) / 100) * 100;
    const opts = modOffer(this.campModsFor(pl), null, Math.random, 2);
    if (opts.length) this.net.tr.send(pl.peerId, { t: 'cpick', f: '', opts, price });
  },
  // 資金獎勵：每位玩家各自入帳
  campMpCoam(v) {
    this.netEv({ t: 'ccoam', v });
  },
  // ---------- 客機 ----------
  // 客機收到的主線訊息（net.js 轉過來）；回傳 true＝已處理
  campClientMsg(d) {
    const $ = (id) => document.getElementById(id);
    switch (d.t) {
      case 'ctrans': {
        this.campC = this.campC || {};
        const C = this.campC;
        C.trans = d;
        C.carry = clone((d.carry && d.carry[this.net.me]) || C.carry || { hp: 1, kits: null, ammo: {} });
        C.inGarage = false;
        C.ready = false;
        this.clearMission();
        this.state = 'camptrans';
        this.showScreen('campTrans');
        $('ctTitle').textContent = d.title;
        $('ctSub').textContent = d.sub;
        $('ctNext').textContent = d.next;
        $('ctReward').textContent = d.reward;
        const mine = (d.mods && d.mods[this.net.me]) || [];
        $('ctMods').innerHTML = mine.length
          ? '<span class="dim">戰術模組：</span>' +
            mine.map((m) => `<span class="modChip">${escHtml(m)}</span>`).join('')
          : '<span class="dim">戰術模組：尚未取得</span>';
        $('ctWait').textContent = '';
        $('ctBtns').style.visibility = 'hidden';
        const T = d.resume ? 0 : 2.4;
        clearTimeout(this.campTransTo);
        this.campTransTo = setTimeout(() => {
          if (this.state !== 'camptrans') return;
          if (d.first) {
            $('ctWait').textContent = '出擊準備中…';
            C.ready = true;
          } else $('ctBtns').style.visibility = 'visible';
        }, T * 1000);
        return true;
      }
      case 'cwait':
        if (this.campC && this.campC.ready) {
          const w = document.getElementById('ctWait');
          if (w) w.textContent = d.txt;
        }
        return true;
      case 'cck':
        this.campCk = d.ck;
        return true;
      case 'cfail': {
        this.campC = this.campC || {};
        this.clearMission();
        this.state = 'campfail';
        this.showScreen('campFail');
        $('cfInfo').textContent = d.info + '　等待房主決定…';
        $('ctBtns2').style.display = 'none';
        $('cfComm').innerHTML = (d.lines || [])
          .map(([sp, text]) => {
            const S = SPEAKERS[sp] || SPEAKERS.echo;
            return `<div class="cLine">${speakerBadge(sp)}<div><b style="color:${S.color}">${escHtml(S.name)}</b><span>${escHtml(text)}</span></div></div>`;
          })
          .join('');
        return true;
      }
      case 'cpick':
        this.campShowPick(
          (d.opts || []).filter((o) => MODULES[o.id]),
          d.price ? '補給站的商店' : `${(EXIT_REWARDS['mod_' + d.f] || {}).name || '戰術模組'}：選一個`,
          (o) => this.net.tr.send(this.net.hostPeer, { t: 'cpicked', id: o.id, lv: o.lv }),
          d.price,
        );
        return true;
    }
    return false;
  },
  // 客機的任務事件（快照的 ev）
  campClientEvent(e) {
    if (e.t !== 'ccoam') return false;
    this.save.coam += e.v;
    this.missionEarned = (this.missionEarned || 0) + e.v;
    this.writeSave();
    this.bountyPops.push({ txt: '+' + e.v.toLocaleString() + ' COAM', life: 2.2, y: 0 });
    return true;
  },
  // 客機：直接出擊／整備後繼續
  campClientReady() {
    const C = this.campC;
    if (!C) return;
    SFX.ui();
    C.ready = true;
    C.inGarage = false;
    this.net.tr.send(this.net.hostPeer, {
      t: 'cready',
      asm: this.save.asm,
      pilot: pilotPayload(this.save),
      carry: C.carry,
    });
    if (this.state === 'garage') {
      this.state = 'camptrans';
      this.showScreen('campTrans');
    }
    document.getElementById('ctBtns').style.visibility = 'hidden';
    document.getElementById('ctWait').textContent = '等待其他玩家…';
  },
  campClientGarage() {
    if (!this.campC) return;
    SFX.ui();
    this.campC.inGarage = true;
    this.openGarage();
  },
  // 快照帶來的顯示資料：更新出口、補給台、資料終端的光環
  campClientView(v) {
    const C = this.campC;
    if (!C || !v) return;
    C.view = v;
    if (C.vk === v.vk) return;
    C.vk = v.vk;
    this.campClearClientVis();
    const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
    C.vis = { exits: [], pad: null, intel: null };
    for (const e of v.ex || []) {
      const pos = V(e);
      const L = this.campExitLabel(e[3], e[4], e[5], e[6], e[7]);
      C.vis.exits.push({ pos, reward: e[3], group: this.campRing(pos, L.color, L.label, L.sub, EXIT_R) });
    }
    if (v.pad) C.vis.pad = { pos: V(v.pad), group: this.campRing(V(v.pad), 0x7ee081, '補給') };
    if (v.intel) C.vis.intel = { pos: V(v.intel), group: this.campRing(V(v.intel), 0x7fc8ff, '資料終端') };
  },
  campClearClientVis() {
    const C = this.campC;
    if (!C || !C.vis) return;
    for (const e of C.vis.exits || []) this.campDisposeGroup(e.group);
    if (C.vis.pad) this.campDisposeGroup(C.vis.pad.group);
    if (C.vis.intel) this.campDisposeGroup(C.vis.intel.group);
    C.vis = null;
    C.vk = null;
  },
  // ---------- 房主遷移 ----------
  // 新房主從最後的紀錄點接手（回到該轉場的起點；其他客機重新連上後補送轉場訊息）
  campPromote() {
    const ck = this.campCk;
    if (!ck || !SORTIES[ck.sid]) return false;
    this.clearMission();
    this.campC = null;
    this.camp = clone(ck);
    this.camp.fails = ck.fails || 0;
    this.flashMsg('你已成為房主：從紀錄點繼續作戰', 0xffb020, 3);
    this.campShowTrans(
      this.camp.trans[this.camp.seg] || { title: '重新編組', sub: '從紀錄點繼續' },
      'resume',
    );
    return true;
  },
});
