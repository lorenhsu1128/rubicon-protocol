// ============================================================
//  MULTIPLAYER — 區域網路 2–4 人合作（方式 2：公用信令 + 自動房間名）
// ============================================================
export const NET_VERSION = '9.6';
export const PLAYER_PALS = ['player', 'ally', 'p3', 'p4'];
export const PLAYER_COLORS = ['#5cc8ff', '#80ffb0', '#ffb060', '#d070ff'];
export const SIGNALS = ['集火！', '救我！', '撤退！', '謝謝', '等等', '出發！'];
export const MAX_ROOMS = 8;
// ICE：STUN + 免費 TURN 中繼（區網直連失敗時的備援；relay 模式會經網際網路繞一圈，延遲較高）
function ICE_SERVERS() {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const mode = localStorage.getItem('rubicon_relay') || 'auto';
  if (mode !== 'off') {
    list.push({
      urls: [
        'turn:openrelay.metered.ca:80',
        'turn:openrelay.metered.ca:443',
        'turn:openrelay.metered.ca:443?transport=tcp',
      ],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    });
    try {
      const c = JSON.parse(localStorage.getItem('rubicon_turn') || 'null');
      if (c && c.url) list.push({ urls: c.url, username: c.user || '', credential: c.pass || '' });
    } catch (e) {}
  }
  return list;
}
// 解除 Chrome 的區網位址 mDNS 匿名：取得（並立即釋放）麥克風權限後，WebRTC 會改用真實區網 IP，直連成功率大增
export async function unmaskLocalIp(log) {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    localStorage.setItem('rubicon_unmask', '1');
    log('已取得權限：之後的連線會使用真實區網 IP（可重新按「連線診斷」確認 mDNS 匿名數變 0）');
    return true;
  } catch (e) {
    log('未取得麥克風權限（' + (e.name || e) + '）：仍會以 mDNS 匿名位址連線');
    return false;
  }
}
// 連線診斷：蒐集 ICE candidate 類型，判斷區網直連是否可行
export async function iceDiag(log) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS() });
  pc.createDataChannel('d');
  const types = { host: 0, srflx: 0, relay: 0, mdns: 0 };
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const c = e.candidate.candidate;
    if (/ typ host/.test(c)) {
      types.host++;
      if (/\.local /.test(c)) types.mdns++;
    } else if (/ typ srflx/.test(c)) types.srflx++;
    else if (/ typ relay/.test(c)) types.relay++;
  };
  const off = await pc.createOffer();
  await pc.setLocalDescription(off);
  await new Promise((r) => setTimeout(r, 4000));
  pc.close();
  const msg = [
    `區網候選 ${types.host}（其中 mDNS 匿名 ${types.mdns}）`,
    `公網候選 ${types.srflx}`,
    `中繼候選 ${types.relay}`,
  ].join('　');
  let hint = '';
  if (!types.host)
    hint = '　⚠ 完全沒有區網候選：瀏覽器可能關閉了 WebRTC 或安裝了「防止 WebRTC 洩漏 IP」的擴充功能／設定';
  else if (types.mdns === types.host)
    hint = '　ⓘ 區網位址以 mDNS 匿名（Chrome 預設）：對方裝置必須能解析 mDNS，路由器若開了 AP 隔離會失敗';
  if (!types.srflx) hint += '　⚠ 無公網候選：STUN 被擋，可能有代理或防火牆';
  if (!types.relay) hint += '　ⓘ 中繼伺服器目前不可用（免費 TURN 可能忙碌）';
  log(msg + hint);
  return types;
}

// ---------- 傳輸層：PeerJS（跨裝置）與 BroadcastChannel（同一台電腦兩個分頁測試） ----------
export class PeerTransport {
  constructor(prefix) {
    this.prefix = prefix;
    this.peer = null;
    this.conns = new Map();
    this.onConn = null;
    this.onMsg = null;
    this.onClose = null;
  }
  open(id) {
    return new Promise((res, rej) => {
      if (!window.Peer) {
        rej(new Error('PeerJS 未載入（需要網際網路）'));
        return;
      }
      const p = new Peer(id || undefined, {
        debug: 0,
        config: { iceServers: ICE_SERVERS(), iceTransportPolicy: 'all' },
      });
      this.peer = p;
      const to = setTimeout(() => rej(new Error('信令伺服器逾時')), 12000);
      p.on('open', (pid) => {
        clearTimeout(to);
        this.id = pid;
        res(pid);
      });
      p.on('error', (e) => {
        clearTimeout(to);
        if (e.type === 'unavailable-id') rej(new Error('idtaken'));
        else rej(e);
      });
      p.on('connection', (c) => this.wire(c, true));
    });
  }
  wire(c, incoming) {
    c.on('open', () => {
      this.conns.set(c.peer, c);
      if (this.onConn) this.onConn(c.peer, incoming, c.metadata || {});
    });
    c.on('data', (d) => {
      if (this.onMsg) this.onMsg(c.peer, d);
    });
    c.on('close', () => {
      this.conns.delete(c.peer);
      if (this.onClose) this.onClose(c.peer);
    });
    c.on('error', () => {
      this.conns.delete(c.peer);
      if (this.onClose) this.onClose(c.peer);
    });
  }
  connect(peerId, meta) {
    return new Promise((res, rej) => {
      const c = this.peer.connect(peerId, { reliable: false, serialization: 'json', metadata: meta });
      let done = false;
      const fin = (ok, v) => {
        if (done) return;
        done = true;
        clearTimeout(to);
        this.peer.off('error', onErr);
        ok ? res(v) : rej(v);
      };
      const to = setTimeout(() => {
        if (!c.open) {
          try {
            c.close();
          } catch (e) {}
          fin(false, new Error('連線逾時'));
        }
      }, 9000);
      const onErr = (e) => {
        if (e.type === 'peer-unavailable' && String(e.message || '').includes(peerId))
          fin(false, new Error('unavailable'));
      };
      this.peer.on('error', onErr);
      c.on('open', () => fin(true, c.peer));
      c.on('error', (e) => fin(false, e));
      this.wire(c, false);
    });
  }
  send(peerId, obj) {
    const c = this.conns.get(peerId);
    if (c && c.open) {
      try {
        c.send(obj);
      } catch (e) {}
    }
  }
  broadcast(obj) {
    for (const c of this.conns.values())
      if (c.open) {
        try {
          c.send(obj);
        } catch (e) {}
      }
  }
  close(peerId) {
    const c = this.conns.get(peerId);
    if (c) {
      try {
        c.close();
      } catch (e) {}
      this.conns.delete(peerId);
    }
  }
  destroy() {
    try {
      if (this.peer) this.peer.destroy();
    } catch (e) {}
    this.conns.clear();
  }
}
export class LocalTransport {
  // 同一瀏覽器多分頁（測試用）：BroadcastChannel 模擬點對點
  constructor(prefix) {
    this.prefix = prefix;
    this.conns = new Map();
    this.onConn = null;
    this.onMsg = null;
    this.onClose = null;
    this.ch = new BroadcastChannel('rubicon-lan');
    this.ch.onmessage = (e) => this.recv(e.data);
    this.alive = new Map();
    this.hb = setInterval(() => {
      for (const [pid, t] of this.alive) {
        if (performance.now() - t > 3000) {
          this.alive.delete(pid);
          if (this.conns.has(pid)) {
            this.conns.delete(pid);
            if (this.onClose) this.onClose(pid);
          }
        }
      }
    }, 1000);
  }
  open(id) {
    this.id = id || 'local-' + Math.random().toString(36).slice(2, 8);
    return Promise.resolve(this.id);
  }
  post(o) {
    this.ch.postMessage(Object.assign({ from: this.id }, o));
  }
  recv(o) {
    if (o.from === this.id) return;
    if (o.k === 'dial' && o.to === this.id) {
      this.conns.set(o.from, true);
      this.post({ k: 'accept', to: o.from, meta: o.meta });
      if (this.onConn) this.onConn(o.from, true, o.meta || {});
      return;
    }
    if (o.k === 'accept' && o.to === this.id) {
      this.conns.set(o.from, true);
      const r = this.pending && this.pending[o.from];
      if (r) {
        r.res(o.from);
        delete this.pending[o.from];
      }
      if (this.onConn) this.onConn(o.from, false, {});
      return;
    }
    if (o.k === 'ping' && o.to === this.id) {
      this.post({ k: 'pong', to: o.from });
      return;
    }
    if (o.k === 'pong' && o.to === this.id) {
      this.alive.set(o.from, performance.now());
      return;
    }
    if (o.k === 'msg' && o.to === this.id) {
      this.alive.set(o.from, performance.now());
      if (this.onMsg) this.onMsg(o.from, o.d);
      return;
    }
    if (o.k === 'bye' && o.to === this.id) {
      this.conns.delete(o.from);
      if (this.onClose) this.onClose(o.from);
    }
  }
  connect(peerId, meta) {
    return new Promise((res, rej) => {
      this.pending = this.pending || {};
      this.pending[peerId] = { res, rej };
      this.post({ k: 'dial', to: peerId, meta });
      setTimeout(() => {
        if (this.pending[peerId]) {
          delete this.pending[peerId];
          rej(new Error('unavailable'));
        }
      }, 800);
    });
  }
  send(peerId, obj) {
    if (this.conns.has(peerId)) this.post({ k: 'msg', to: peerId, d: obj });
  }
  broadcast(obj) {
    for (const pid of this.conns.keys()) this.post({ k: 'msg', to: pid, d: obj });
  }
  close(peerId) {
    this.post({ k: 'bye', to: peerId });
    this.conns.delete(peerId);
  }
  destroy() {
    for (const pid of this.conns.keys()) this.post({ k: 'bye', to: pid });
    clearInterval(this.hb);
    this.ch.close();
  }
}

// ---------- 伺服器中繼（方式 1：房主電腦跑 rubicon-server.exe，所有訊息經伺服器轉送） ----------
export class WsTransport {
  constructor() {
    this.conns = new Map();
    this.onConn = null;
    this.onMsg = null;
    this.onClose = null;
    this.pending = {};
    this.roomCb = null;
  }
  open() {
    return new Promise((res, rej) => {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      const ws = new WebSocket(url);
      this.ws = ws;
      const to = setTimeout(() => rej(new Error('伺服器無回應')), 8000);
      ws.onopen = () => {};
      ws.onerror = () => {
        clearTimeout(to);
        rej(new Error('無法連線到伺服器'));
      };
      ws.onclose = () => {
        for (const pid of [...this.conns.keys()]) {
          this.conns.delete(pid);
          if (this.onClose) this.onClose(pid);
        }
        if (this.onShutdown) this.onShutdown();
      };
      ws.onmessage = (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch (e) {
          return;
        }
        switch (m.t) {
          case 'hello':
            clearTimeout(to);
            this.id = m.id;
            res(m.id);
            break;
          case 'conn':
            this.conns.set(m.from, true);
            this.send0({ t: 'accept', to: m.from });
            if (this.onConn) this.onConn(m.from, true, m.meta || {});
            break;
          case 'accept':
            {
              this.conns.set(m.from, true);
              const p = this.pending[m.from];
              if (p) {
                clearTimeout(p.to);
                p.res(m.from);
                delete this.pending[m.from];
              }
              if (this.onConn) this.onConn(m.from, false, {});
            }
            break;
          case 'noroute':
            {
              const p = this.pending[m.to];
              if (p) {
                clearTimeout(p.to);
                p.rej(new Error('unavailable'));
                delete this.pending[m.to];
              }
            }
            break;
          case 'from':
            if (this.onMsg) this.onMsg(m.from, m.d);
            break;
          case 'close':
            this.conns.delete(m.from);
            if (this.onClose) this.onClose(m.from);
            break;
          case 'rooms':
            if (this.roomCb) {
              this.roomCb(m.list);
              this.roomCb = null;
            }
            break;
          case 'shutdown':
            if (this.onShutdown) this.onShutdown();
            break;
        }
      };
    });
  }
  send0(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }
  connect(peerId, meta) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => {
        delete this.pending[peerId];
        rej(new Error('連線逾時'));
      }, 6000);
      this.pending[peerId] = { res, rej, to };
      this.send0({ t: 'conn', to: peerId, meta });
    });
  }
  send(peerId, obj) {
    if (this.conns.has(peerId)) this.send0({ t: 'to', to: peerId, d: obj });
  }
  broadcast(obj) {
    for (const pid of this.conns.keys()) this.send0({ t: 'to', to: pid, d: obj });
  }
  close(peerId) {
    this.send0({ t: 'bye', to: peerId });
    this.conns.delete(peerId);
  }
  destroy() {
    try {
      this.ws.onclose = null;
      this.ws.close();
    } catch (e) {}
    this.conns.clear();
  }
  registerRoom(info) {
    this.send0({ t: 'reg', room: info });
  }
  roomInfo(info) {
    this.send0({ t: 'roominfo', room: info });
  }
  unregister() {
    this.send0({ t: 'unreg' });
  }
  listRooms() {
    return new Promise((res) => {
      this.roomCb = res;
      this.send0({ t: 'list' });
      setTimeout(() => {
        if (this.roomCb) {
          this.roomCb = null;
          res([]);
        }
      }, 3000);
    });
  }
}
