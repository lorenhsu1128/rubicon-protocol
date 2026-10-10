// ---------- 多人主控 ----------
import { SFX } from '../audio/audio.js';
import { pilotPayload, sanitizePayload } from '../data/pilot.js';
import {
  LocalTransport,
  MAX_ROOMS,
  NET_VERSION,
  PLAYER_COLORS,
  PeerTransport,
  WsTransport,
} from './transports.js';

export class Net {
  constructor(game) {
    this.g = game;
    this.role = null;
    this.players = [];
    this.me = -1;
    this.requests = [];
    this.autoApprove = true;
    this.pvpSet = { mode: 'pve', type: 'ffa', rule: 'kills', diff: 'std', fill: 'no' };
    this.roomName = '';
    this.tr = null;
    this.tick = 0;
    this.snap = null;
    this.prevSnap = null;
    this.lastHostMsg = 0;
    this.spawnReg = {};
    this.inputs = {};
    this.lat = {};
    this.pings = {};
    this.sig = null;
    this.migrating = false;
    this.hostPeer = null;
    this.local = location.search.includes('lan=local');
    this.nick = (() => {
      try {
        return localStorage.getItem('rubicon_nick') || '';
      } catch (e) {
        return '';
      }
    })();
  }
  log(t) {
    const el = document.getElementById('mpLog');
    if (el) {
      el.textContent = t;
    }
  }
  async prefix() {
    if (this.local) return 'local';
    if (this._prefix) return this._prefix;
    const inp = document.getElementById('mpLan');
    const manual = inp && inp.value.trim();
    const m = manual ? [0, manual.replace(/[^a-z0-9]/gi, '')] : location.search.match(/[?&]lan=([a-z0-9]+)/i);
    if (m && m[1] && m[1] !== 'local') {
      this._prefix = null;
      this._prefix = 'rp' + m[1].toLowerCase();
      return this._prefix;
    }
    try {
      const r = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const j = await r.json();
      let h = 0;
      for (const c of j.ip) h = (h * 31 + c.charCodeAt(0)) >>> 0;
      this._prefix = 'rp' + h.toString(36);
    } catch (e) {
      this._prefix = 'rpnoip';
    }
    return this._prefix;
  }
  get server() {
    return !!window.RUBICON_SERVER && !this.local;
  }
  mkTransport(prefix) {
    return this.local
      ? new LocalTransport(prefix)
      : this.server
        ? new WsTransport()
        : new PeerTransport(prefix);
  }
  roomInfoObj() {
    const online = this.players.filter((p) => p.online);
    return {
      room: this.roomName + (this.pvpSet.mode === 'pvp' ? '【PVP】' : ''),
      host: this.nick,
      n: online.length,
      level: this.g.save.level,
      full: online.length >= 4 || this.g.state === 'play' || this.g.state === 'ending',
      state: this.g.state === 'play' || this.g.state === 'ending' ? 'play' : 'lobby',
      spectators: this.spectators ? this.spectators.size : 0,
    };
  }
  slotColor(slot) {
    return PLAYER_COLORS[slot] || '#fff';
  }
  playerBySlot(s) {
    return this.players.find((p) => p.slot === s);
  }
  playerByPeer(pid) {
    return this.players.find((p) => p.peerId === pid);
  }
  meP() {
    return this.playerBySlot(this.me);
  }
  // ===== 建房 =====
  async host(name) {
    this.spectators = new Set();
    if (this.server) {
      this.tr = this.mkTransport('');
      await this.tr.open();
      this.tr.onShutdown = () => this.serverLost();
      this.role = 'host';
      this.roomName = name;
      this.hostPeer = this.tr.id;
      this.roomNo = '-';
      this.lanCode = '伺服器';
      this.players = [
        {
          slot: 0,
          nick: this.nick,
          peerId: this.tr.id,
          ready: false,
          asm: Object.assign({}, this.g.save.asm),
          pilot: sanitizePayload(pilotPayload(this.g.save)),
          color: 0,
          order: 0,
          online: true,
          joinT: 0,
        },
      ];
      this.me = 0;
      this.tr.onConn = (pid, incoming, meta) => this.hostOnConn(pid, meta);
      this.tr.onMsg = (pid, d) => this.hostOnMsg(pid, d);
      this.tr.onClose = (pid) => this.hostOnClose(pid);
      this.tr.registerRoom(this.roomInfoObj());
      this.startPing();
      return;
    }
    const pre = await this.prefix();
    this.tr = this.mkTransport(pre);
    let n = 1;
    while (n <= MAX_ROOMS) {
      try {
        await this.tr.open(pre + '-room' + n);
        break;
      } catch (e) {
        if (String(e.message) === 'idtaken') {
          n++;
          this.tr.destroy();
          this.tr = this.mkTransport(pre);
          continue;
        }
        throw e;
      }
    }
    if (n > MAX_ROOMS) throw new Error('區網房間已滿（8）');
    this.roomNo = n;
    this.lanCode = pre.replace(/^rp/, '');
    this.role = 'host';
    this.roomName = name;
    this.hostPeer = this.tr.id;
    this.players = [
      {
        slot: 0,
        nick: this.nick,
        peerId: this.tr.id,
        ready: false,
        asm: Object.assign({}, this.g.save.asm),
        pilot: sanitizePayload(pilotPayload(this.g.save)),
        color: 0,
        order: 0,
        online: true,
        joinT: 0,
      },
    ];
    this.me = 0;
    this.tr.onConn = (pid, incoming, meta) => this.hostOnConn(pid, meta);
    this.tr.onMsg = (pid, d) => this.hostOnMsg(pid, d);
    this.tr.onClose = (pid) => this.hostOnClose(pid);
    this.startPing();
  }
  hostOnConn(pid, meta) {
    if (meta && meta.spectator) {
      this.spectators = this.spectators || new Set();
      this.spectators.add(pid);
      this.tr.send(pid, {
        t: 'welcome',
        spectator: true,
        room: this.roomName,
        slot: -1,
        inMission: this.g.state === 'play' || this.g.state === 'ending',
      });
      if (this.g.state === 'play' || this.g.state === 'ending') this.sendMissionState(pid);
      this.syncLobby();
      return;
    }
    if (!meta || !meta.nick) return;
    if (meta.v !== NET_VERSION) {
      this.tr.send(pid, { t: 'reject', why: '版本不符（房主 ' + NET_VERSION + '）' });
      setTimeout(() => this.tr.close(pid), 300);
      return;
    }
    // 60 秒內同暱稱回歸（原房主／掉線者）→ 直接接回
    const back = this.players.find(
      (p) => p.nick === meta.nick && !p.online && performance.now() - p.offT < 60000,
    );
    if (back) {
      back.online = true;
      back.peerId = pid;
      back.asm = meta.asm || back.asm;
      this.acceptPlayer(back, true);
      return;
    }
    if (this.players.filter((p) => p.online).length >= 4) {
      this.tr.send(pid, { t: 'reject', why: '房間已滿' });
      setTimeout(() => this.tr.close(pid), 300);
      return;
    }
    if (this.g.state === 'play' || this.g.state === 'ending') {
      this.tr.send(pid, { t: 'reject', why: '任務進行中' });
      setTimeout(() => this.tr.close(pid), 300);
      return;
    }
    if (this.playerByPeer(pid) && this.g.campOnRejoin(this.playerByPeer(pid))) return; // 主線轉場中重新連上
    if (this.playerByPeer(pid)) {
      this.tr.send(pid, {
        t: 'welcome',
        slot: this.playerByPeer(pid).slot,
        room: this.roomName,
        rejoin: true,
        inMission: false,
      });
      return;
    } // 同一連線重複請求：直接回應既有位子
    const dup = this.requests.find((r) => r.pid === pid);
    if (dup) {
      dup.asm = meta.asm || dup.asm;
      this.tr.send(pid, { t: 'wait' });
      return;
    } // 已在等待清單：不重複加入
    const req = { pid, nick: meta.nick, asm: meta.asm, t: performance.now() };
    if (this.autoApprove) {
      this.approve(req, true);
    } else {
      this.requests.push(req);
      this.tr.send(pid, { t: 'wait' });
      SFX.alert();
      this.g.renderLobby();
    }
  }
  sendMissionState(pid, rejoin) {
    const g = this.g;
    this.tr.send(pid, {
      t: 'start',
      pace: g.ctrl.pace || 1,
      rejoin: !!rejoin,
      seed: g.worldSeed,
      theme: g.worldTheme,
      variant: g.world.variantKey,
      wopt: g.world.netOpt(),
      camp: g.camp ? g.campView() : null,
      feat: g.world.features.map((f) => ({
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
        bend: f.bend,
      })),
      level: g.save.level,
      players: this.players.map((p) => ({ slot: p.slot, nick: p.nick, color: p.color })),
      spawns: Object.values(this.spawnReg),
      bossName: g.bossDef ? g.bossDef.name : '',
    });
  }
  approve(req, ok) {
    if (!this.requests.includes(req) && !this.autoApprove) return;
    this.requests = this.requests.filter((r) => r !== req);
    if (ok && this.playerByPeer(req.pid)) return;
    if (ok && this.players.filter((p) => p.online).length >= 4) {
      this.tr.send(req.pid, { t: 'reject', why: '房間已滿' });
      setTimeout(() => this.tr.close(req.pid), 300);
      this.g.renderLobby();
      return;
    }
    if (!ok) {
      this.tr.send(req.pid, { t: 'reject', why: '房主拒絕了加入請求' });
      setTimeout(() => this.tr.close(req.pid), 300);
      this.g.renderLobby();
      return;
    }
    let slot = 0;
    while (this.players.some((p) => p.slot === slot)) slot++;
    const pl = {
      slot,
      nick: req.nick,
      peerId: req.pid,
      ready: false,
      asm: req.asm,
      color: slot,
      order: this.players.length,
      online: true,
      joinT: performance.now(),
    };
    this.players.push(pl);
    this.acceptPlayer(pl, false);
  }
  acceptPlayer(pl, rejoin) {
    if (rejoin && this.g.campOnRejoin(pl)) {
      this.syncLobby();
      return;
    }
    this.tr.send(pl.peerId, {
      t: 'welcome',
      slot: pl.slot,
      room: this.roomName,
      rejoin,
      inMission: this.g.state === 'play',
    });
    this.syncLobby();
    if (rejoin && this.g.state === 'play') this.hostRejoinInMission(pl);
    this.g.renderLobby();
  }
  // 玩家在目前房間模式的駕駛員等級（大廳顯示用；客機只收到等級，不含配點）
  pilotLv(p) {
    const mode = this.pvpSet && this.pvpSet.mode === 'pvp' ? 'pvp' : 'pve';
    return p.pilot ? p.pilot[mode].lv : p.plv || 0;
  }
  syncLobby() {
    const list = this.players.map((p) => ({
      slot: p.slot,
      nick: p.nick,
      peerId: p.peerId,
      ready: p.ready,
      asm: p.asm,
      color: p.color,
      order: p.order,
      online: p.online,
      lat: this.lat[p.peerId] || 0,
      pvpTeam: p.pvpTeam,
      plv: this.pilotLv(p),
      ms: p.ms || null, // 玩家上傳到伺服器的模型組（內容雜湊），沒有時用伺服器預設組
      msn: p.msn || '',
    }));
    const m = {
      t: 'lobby',
      room: this.roomName,
      players: list,
      hostSlot: this.me,
      auto: this.autoApprove,
      level: this.g.save.level,
      spectators: this.spectators ? this.spectators.size : 0,
      pvp: this.pvpSet,
    };
    this.tr.broadcast(m);
    this.lobbyState = m;
    if (this.server && this.tr.roomInfo) this.tr.roomInfo(this.roomInfoObj());
  }
  kick(slot) {
    const p = this.playerBySlot(slot);
    if (!p || slot === this.me) return;
    this.tr.send(p.peerId, { t: 'reject', why: '你被房主移出房間' });
    setTimeout(() => this.tr.close(p.peerId), 300);
    this.players = this.players.filter((x) => x !== p);
    this.syncLobby();
    this.g.renderLobby();
  }
  hostOnClose(pid) {
    if (this.spectators && this.spectators.delete(pid)) {
      this.syncLobby();
      return;
    }
    const p = this.playerByPeer(pid);
    if (!p) return;
    if (this.g.state === 'play' || this.g.state === 'ending') {
      p.online = false;
      p.offT = performance.now();
      this.g.playerWentOffline(p);
      this.syncLobby();
    } else {
      this.players = this.players.filter((x) => x !== p);
      this.syncLobby();
      this.g.renderLobby();
    }
  }
  hostOnMsg(pid, d) {
    if (this.spectators && this.spectators.has(pid)) {
      if (d.t === 'ping') this.tr.send(pid, { t: 'pong', n: d.n });
      return;
    }
    if (d.t === 'probe') {
      this.tr.send(pid, {
        t: 'info',
        room: this.roomName,
        n: this.players.filter((p) => p.online).length,
        host: this.nick,
        level: this.g.save.level,
        full: this.players.filter((p) => p.online).length >= 4 || this.g.state === 'play',
      });
      setTimeout(() => this.tr.close(pid), 1500);
      return;
    }
    const p = this.playerByPeer(pid);
    if (!p) return;
    switch (d.t) {
      case 'ready':
        p.ready = !!d.v;
        p.asm = d.asm || p.asm;
        p.pilot = sanitizePayload(d.pilot) || p.pilot; // 駕駛員等級與配點（兩種模式）
        this.syncLobby();
        this.g.renderLobby();
        break;
      case 'in':
        this.inputs[p.slot] = d;
        break;
      case 'ping':
        this.tr.send(pid, { t: 'pong', n: d.n });
        break;
      case 'pong':
        {
          const s = this.pings[d.n];
          if (s) {
            this.lat[pid] = Math.round(performance.now() - s);
            delete this.pings[d.n];
          }
        }
        break;
      case 'sig':
        this.g.onSignal(p.slot, d.n);
        this.tr.broadcast({ t: 'sig', slot: p.slot, n: d.n });
        break;
      case 'lock':
        p.lockId = d.id;
        break;
      case 'team':
        p.pvpTeam = p.pvpTeam === 1 ? 0 : 1;
        this.syncLobby();
        this.g.renderLobby();
        break;
      case 'mset': // 玩家換了模型組（任務中收到的只影響下次出擊）
        p.ms = typeof d.ms === 'string' && /^[0-9a-f]{64}$/.test(d.ms) ? d.ms : null;
        p.msn = p.ms ? String(d.msn || '').slice(0, 40) : '';
        this.syncLobby();
        this.g.renderLobby();
        this.g.mpPrefetch();
        break;
      case 'leave':
        this.hostOnClose(pid);
        break;
      case 'cready': // 主線：轉場準備好了（campaign-mp.js）
        this.g.campOnReady(p, d);
        break;
      case 'cpicked': // 主線：戰術模組選好了
        this.g.campOnPicked(p, d);
        break;
    }
  }
  // ===== 加入 =====
  // 第一步：只靠信令伺服器判斷房間存在（嘗試佔用 room ID，被佔用＝有房）；第二步：對存在的房間做 WebRTC 探測取得資訊
  async roomExists(id) {
    if (this.local) return null;
    return new Promise((res) => {
      let done = false;
      const p = new Peer(id, { debug: 0 });
      const fin = (v) => {
        if (done) return;
        done = true;
        try {
          p.destroy();
        } catch (e) {}
        res(v);
      };
      p.on('open', () => fin(false));
      p.on('error', (e) => fin(e.type === 'unavailable-id'));
      setTimeout(() => fin(null), 8000);
    });
  }
  async listRooms() {
    if (this.server) {
      const tr = new WsTransport();
      await tr.open();
      const list = await tr.listRooms();
      tr.destroy();
      return list;
    }
    const pre = await this.prefix();
    this.log(`搜尋中（區網代碼 ${pre.replace(/^rp/, '')}）…`);
    const found = [];
    const diag = { ok: 0, unavailable: 0, timeout: 0, other: 0 };
    let candidates = [];
    if (this.local) {
      candidates = Array.from({ length: MAX_ROOMS }, (_, i) => i + 1);
    } else {
      const ex = await Promise.all(
        Array.from({ length: MAX_ROOMS }, (_, i) => this.roomExists(pre + '-room' + (i + 1))),
      );
      candidates = ex.map((v, i) => (v ? i + 1 : 0)).filter(Boolean);
      this.log(`信令伺服器上有 ${candidates.length} 個房間，探測連線中…`);
    }
    if (!candidates.length) {
      this.lastDiag = diag;
      return found;
    }
    const tr = this.mkTransport(pre);
    await tr.open();
    const infoOf = {};
    tr.onMsg = (pid, d) => {
      if (d.t === 'info') {
        infoOf[pid] = Object.assign({ peerId: pid }, d);
        diag.ok++;
      }
    };
    await Promise.all(
      candidates.map((n) => {
        const id = pre + '-room' + n;
        return tr
          .connect(id, { probe: true })
          .then(() => {
            tr.send(id, { t: 'probe' });
          })
          .catch((e) => {
            const m = String((e && e.message) || e);
            if (m === 'unavailable') diag.unavailable++;
            else if (m.includes('逾時')) diag.timeout++;
            else diag.other++;
          });
      }),
    );
    await new Promise((r) => setTimeout(r, this.local ? 300 : 2000));
    tr.destroy();
    for (const n of candidates) {
      const id = pre + '-room' + n;
      if (infoOf[id]) found.push(infoOf[id]);
      else if (!this.local)
        found.push({
          peerId: id,
          room: `房間 ${n}（直連探測失敗）`,
          n: '?',
          host: '?',
          level: '?',
          full: false,
          noProbe: true,
        });
    }
    this.lastDiag = diag;
    return found;
  }
  async joinRoomNumber(n) {
    const pre = await this.prefix();
    return this.join(pre + '-room' + n);
  }
  async join(peerId, spectator) {
    const pre = this.server ? '' : await this.prefix();
    this.tr = this.mkTransport(pre);
    await this.tr.open();
    if (this.server) this.tr.onShutdown = () => this.serverLost();
    this.role = 'client';
    this.spectating = !!spectator;
    this.hostPeer = peerId;
    this.tr.onMsg = (pid, d) => this.clientOnMsg(pid, d);
    this.tr.onClose = (pid) => this.clientOnClose(pid);
    await this.tr.connect(
      peerId,
      spectator
        ? { spectator: true, nick: this.nick || '觀戰者', v: NET_VERSION }
        : { nick: this.nick, asm: this.g.save.asm, v: NET_VERSION },
    );
    this.lastHostMsg = performance.now();
    this.startPing();
  }
  serverLost() {
    const g = this.g;
    if (!this.role) return;
    this.leave(false);
    g.clearMission();
    g.state = 'title';
    g.showScreen('title');
    g.flashMsg('伺服器已停止，房間中斷', 0xff4d4d, 3);
  }
  clientOnMsg(pid, d) {
    if (pid !== this.hostPeer && d.t !== 'pong' && d.t !== 'ping') return;
    this.lastHostMsg = performance.now();
    const g = this.g;
    if (g.campClientMsg(d)) return; // 主線的轉場、紀錄點、失敗、三選一（campaign-mp.js）
    switch (d.t) {
      case 'wait':
        this.log('等待房主同意…');
        break;
      case 'reject':
        this.joining = false;
        this.log('被拒絕：' + d.why);
        this.leave(false);
        g.flashMsg(d.why, 0xff4d4d, 2.5);
        break;
      case 'welcome':
        this.joining = false;
        this.me = d.slot;
        this.roomName = d.room;
        this.log(d.rejoin ? '已重新接回' : '已加入房間');
        if (d.spectator) {
          g.spectator = true;
          if (!d.inMission) {
            g.state = 'lobby';
            g.showScreen('lobby');
          }
        } else if (!d.inMission) {
          g.state = 'lobby';
          g.showScreen('lobby');
        }
        break;
      case 'lobby':
        this.players = d.players;
        this.autoApprove = d.auto;
        if (d.pvp) this.pvpSet = d.pvp;
        this.roomName = d.room;
        this.hostSlot = d.hostSlot;
        this.hostLevel = d.level;
        this.spectatorCount = d.spectators || 0;
        g.mpPrefetch();
        if (g.state === 'lobby') g.renderLobby();
        break;
      case 'ping':
        this.tr.send(pid, { t: 'pong', n: d.n });
        break;
      case 'pong':
        {
          const s = this.pings[d.n];
          if (s) {
            this.lat[this.hostPeer] = Math.round(performance.now() - s);
            delete this.pings[d.n];
          }
        }
        break;
      case 'start':
        g.startMissionClient(d);
        break;
      case 'spawn':
        g.clientSpawn(d);
        break;
      case 's':
        this.prevSnap = this.snap;
        this.snap = d;
        this.snap.rt = performance.now();
        g.clientApplySnapshot(d);
        break;
      case 'ev':
        for (const e of d.list) g.clientEvent(e);
        break;
      case 'end':
        g.clientEnd(d);
        break;
      case 'sig':
        g.onSignal(d.slot, d.n);
        break;
      case 'abort':
        {
          const rep = g.pilotGrant(d.pvp ? 'pvp' : 'pve', d.xpBySlot && d.xpBySlot[this.me]);
          if (rep && rep.x) g.flashMsg(`駕駛員經驗 +${rep.x.toLocaleString()}`, 0x5cc8ff, 2.5);
        }
        g.flashMsg('房主結束了任務', 0xff4d4d, 2.5);
        g.campC = null;
        g.campCk = null;
        g.clearMission();
        g.state = 'lobby';
        g.showScreen('lobby');
        break;
      case 'newhost':
        break;
    }
  }
  clientOnClose(pid) {
    if (pid === this.hostPeer) this.hostLost();
  }
  // ===== 房主掉線 → 依加入順序遷移 =====
  hostLost() {
    if (this.role !== 'client' || this.migrating) return;
    if (this.spectating) {
      this.leave(false);
      this.g.clearMission();
      this.g.state = 'title';
      this.g.showScreen('title');
      this.g.flashMsg('房主已離線，觀戰結束', 0xff4d4d, 3);
      return;
    }
    this.migrating = true;
    const g = this.g;
    // 主線：轉場、失敗畫面、整備中也能遷移（新房主從紀錄點接手）
    const inCamp = g.campCk && ['camptrans', 'campfail', 'garage', 'modpick'].includes(g.state);
    if (g.state !== 'play' && g.state !== 'ending' && !inCamp) {
      this.leave(false);
      g.flashMsg('房主已離線，房間關閉', 0xff4d4d, 2.5);
      return;
    }
    const order = this.players
      .filter((p) => p.slot !== this.hostSlot && p.online)
      .sort((a, b) => a.order - b.order);
    const next = order[0];
    if (!next) {
      this.leave(false);
      return;
    }
    g.freezeT = 2.5;
    g.flashMsg(`房主連線中斷，${next.nick} 接手主機`, 0xffb020, 3);
    if (next.slot === this.me) this.becomeHost();
    else this.reconnectTo(next);
  }
  becomeHost() {
    const g = this.g;
    const oldHostSlot = this.hostSlot;
    const oldTr = this.tr;
    this.role = 'host';
    this.hostPeer = this.tr.id;
    this.hostSlot = this.me;
    for (const p of this.players) {
      if (p.slot === oldHostSlot) {
        p.online = false;
        p.offT = performance.now();
      }
      p.ready = false;
    }
    this.players = this.players.filter((p) => p.online || p.slot === oldHostSlot);
    this.tr.onConn = (pid, incoming, meta) => this.hostOnConn(pid, meta);
    this.tr.onMsg = (pid, d) => this.hostOnMsg(pid, d);
    this.tr.onClose = (pid) => this.hostOnClose(pid);
    g.promoteToHost(oldHostSlot);
    g.campPromote(); // 主線：從紀錄點接手（campaign-mp.js）
    this.migrating = false;
    this.syncLobby();
  }
  async reconnectTo(next) {
    const t0 = performance.now();
    while (performance.now() - t0 < 10000) {
      try {
        this.hostPeer = next.peerId;
        await this.tr.connect(next.peerId, { nick: this.nick, asm: this.g.save.asm, v: NET_VERSION });
        this.lastHostMsg = performance.now();
        this.migrating = false;
        this.hostSlot = next.slot;
        this.g.flashMsg('已連上新房主', 0x7ee081, 1.5);
        return;
      } catch (e) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    this.migrating = false;
    this.leave(false);
    this.g.flashMsg('無法連上新房主，任務中止', 0xff4d4d, 3);
  }
  // ===== 共通 =====
  startPing() {
    this.pingIv = setInterval(() => {
      const n = ++this.tick;
      this.pings[n] = performance.now();
      if (this.role === 'host') this.tr.broadcast({ t: 'ping', n });
      else if (this.tr) this.tr.send(this.hostPeer, { t: 'ping', n });
      for (const k in this.pings) if (performance.now() - this.pings[k] > 5000) delete this.pings[k];
      if (this.role === 'host') this.syncLobbyLat();
    }, 1000);
  }
  syncLobbyLat() {
    if (this.g.state === 'lobby' || this.g.state === 'garage') this.syncLobby();
  }
  sendReady(v) {
    if (this.role === 'host') {
      const me = this.meP();
      me.ready = v;
      me.asm = Object.assign({}, this.g.save.asm);
      me.pilot = sanitizePayload(pilotPayload(this.g.save));
      this.syncLobby();
    } else
      this.tr.send(this.hostPeer, { t: 'ready', v, asm: this.g.save.asm, pilot: pilotPayload(this.g.save) });
  }
  sendInput(d) {
    if (this.role === 'client' && this.tr) this.tr.send(this.hostPeer, d);
  }
  signal(n) {
    if (this.role === 'host') {
      this.g.onSignal(this.me, n);
      this.tr.broadcast({ t: 'sig', slot: this.me, n });
    } else this.tr.send(this.hostPeer, { t: 'sig', n });
  }
  leave(notify = true) {
    this.spectating = false;
    this.g.spectator = false;
    if (this.tr) {
      if (this.server && this.role === 'host' && this.tr.unregister) this.tr.unregister();
      if (notify && this.role === 'client') this.tr.send(this.hostPeer, { t: 'leave' });
      if (notify && this.role === 'host') this.tr.broadcast({ t: 'reject', why: '房主關閉了房間' });
      setTimeout(() => {
        try {
          this.tr.destroy();
        } catch (e) {}
      }, 200);
    }
    clearInterval(this.pingIv);
    this.role = null;
    this.players = [];
    this.requests = [];
    this.me = -1;
    this.snap = null;
    this.prevSnap = null;
    this.g.netOff();
  }
  allReady() {
    return this.players.filter((p) => p.online).every((p) => p.ready);
  }
}
