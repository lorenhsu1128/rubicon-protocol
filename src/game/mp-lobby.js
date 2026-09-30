// Game 多人擴充：初始化、建房／搜尋／加入、大廳、訊號
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { START_ASM, asmStats } from '../data/parts.js';
import { Net } from '../net/net.js';
import { SIGNALS, iceDiag, unmaskLocalIp } from '../net/transports.js';
import { AI_DIFF, PVP_TEAM_COLORS } from './constants.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  netInit() {
    this.net = new Net(this);
    this.players = [];
    this.netEvents = [];
    this.snapAcc = 0;
    this.freezeT = 0;
    this.spectateIdx = 0;
    // 房主：有位置的音效轉送給客機（netEv 只在房主時送出）；_noMirror 期間不轉送，
    // 用在客機收到事件後會自己播放同一音效的流程，避免重複
    SFX.mirror = (k, v, r, pos) => {
      if (this._noMirror) return;
      this.netEv({ t: 'sfx', k, v, r, p: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)] });
    };
    const $ = (id) => document.getElementById(id);
    $('btnMP').onclick = () => {
      SFX.init();
      this.openMP();
    };
    $('btnMPBack').onclick = () => {
      this.net.leave(true);
      this.state = 'title';
      this.showScreen('title');
    };
    $('btnMPUnmask').onclick = () => unmaskLocalIp((t) => this.net.log(t));
    $('btnMPTurn').onclick = () => {
      const url = prompt('TURN 伺服器網址（例如 turn:1.2.3.4:3478）', '');
      if (url === null) return;
      const user = prompt('帳號', '') || '';
      const pass = prompt('密碼', '') || '';
      try {
        localStorage.setItem('rubicon_turn', JSON.stringify({ url, user, pass }));
      } catch (e) {}
      this.net.log(url ? '已設定自訂中繼：' + url : '已清除自訂中繼');
    };
    $('btnMPDiag').onclick = () => {
      this.net.log('診斷中（約 4 秒）…');
      iceDiag((t) => this.net.log(t)).catch((e) => this.net.log('診斷失敗：' + e.message));
    };
    $('mpRelay').value = localStorage.getItem('rubicon_relay') || 'auto';
    $('mpRelay').onchange = (e) => {
      try {
        localStorage.setItem('rubicon_relay', e.target.value);
      } catch (x) {}
    };
    $('btnMPHost').onclick = () => this.mpHost();
    $('btnMPList').onclick = () => this.mpList();
    $('btnMPDirect').onclick = async () => {
      const n = parseInt($('mpRoomNo').value) || 1;
      if (!this.net.nick) {
        this.net.log('請先輸入暱稱');
        return;
      }
      this.net.log(`直接連線房間 ${n}…`);
      try {
        await this.net.joinRoomNumber(n);
      } catch (e) {
        this.net.log('連線失敗：' + (e.message || e));
      }
    };
    $('mpNick').onchange = (e) => {
      this.net.nick = e.target.value.trim().slice(0, 12);
      try {
        localStorage.setItem('rubicon_nick', this.net.nick);
      } catch (x) {}
    };
    $('btnLobbyGarage').onclick = () => {
      this.openGarage();
    };
    $('btnLobbyReady').onclick = () => {
      const me = this.net.meP();
      const v = !(me && me.ready);
      this.net.sendReady(v);
      if (this.net.role === 'host') this.renderLobby();
    };
    $('btnLobbySortie').onclick = () => {
      if (this.net.role === 'host' && this.net.allReady()) this.startMission();
    };
    $('btnLobbyLeave').onclick = () => {
      this.net.leave(true);
      this.openMP();
    };
    $('mpAuto').onchange = (e) => {
      this.net.autoApprove = e.target.checked;
      this.net.syncLobby();
    };
    $('btnGarageLobby').onclick = () => {
      this.state = 'lobby';
      this.showScreen('lobby');
      const me = this.net.meP();
      if (me) {
        me.asm = Object.assign({}, this.save.asm);
      }
      this.net.sendReady(false);
      this.renderLobby();
    };
  },
  openMP() {
    this.state = 'mp';
    this.showScreen('mp');
    document.getElementById('mpNick').value = this.net.nick;
    document.getElementById('mpRooms').innerHTML = '';
    const srv = this.net.server;
    for (const id of ['mpP2Rows']) {
      const el = document.getElementById(id);
      if (el) el.style.display = srv ? 'none' : '';
    }
    document.getElementById('mpIntro').textContent = srv
      ? '此頁面由區網伺服器提供：建立房間或搜尋房間都經由伺服器中繼，不需要網際網路；也可以觀戰其他房間。'
      : '同一個區域網路（同一台路由器）的玩家會自動互相看到房間。建房／搜尋時需要網際網路做信令，連上後為點對點。若自動辨識失敗，所有人輸入相同的「區網代碼」即可。';
    this.net.log(
      this.net.local
        ? '本機測試模式（同一瀏覽器多分頁）'
        : srv
          ? '已連上區網伺服器：建房或搜尋房間都經由伺服器，不需要網際網路。'
          : '建房與搜尋需要網際網路（信令）；連上後為區網點對點。',
    );
    if (srv) this.mpList();
  },
  async mpHost() {
    if (!this.net.nick) {
      this.net.log('請先輸入暱稱');
      return;
    }
    if (localStorage.getItem('rubicon_unmask') === '1') await unmaskLocalIp(() => {});
    this.net.log('建立房間中…');
    try {
      await this.net.host(this.net.nick + ' 的房');
      this.state = 'lobby';
      this.showScreen('lobby');
      this.renderLobby();
    } catch (e) {
      this.net.log('建房失敗：' + (e.message || e));
    }
  },
  async mpList() {
    if (!this.net.nick) {
      this.net.log('請先輸入暱稱');
      return;
    }
    if (localStorage.getItem('rubicon_unmask') === '1') await unmaskLocalIp(() => {});
    this.net.log('搜尋附近的房間…');
    const el = document.getElementById('mpRooms');
    el.innerHTML = '';
    try {
      const rooms = await this.net.listRooms();
      if (!rooms.length) {
        const d = this.net.lastDiag || {};
        this.net.log(
          d.timeout
            ? '附近沒有房間（有房間但連線逾時：兩台可能不在同一區網、路由器開了 AP 隔離、或防火牆擋住 WebRTC。可請房主把「區網代碼」與「房間編號」報給你，用下方直接加入再試）'
            : '附近沒有房間（確認房主已建房，且雙方區網代碼相同；房主的代碼顯示在大廳標題）',
        );
        return;
      }
      this.net.log(`找到 ${rooms.length} 個房間`);
      for (const r of rooms) {
        const d = document.createElement('div');
        d.className = 'part';
        d.innerHTML = `<div><div class="n">${escHtml(r.room)}</div><div class="s">${r.noProbe ? '信令上看得到，但 WebRTC 直連逾時。可嘗試加入（會自動試中繼），或兩邊先按「解除區網位址匿名」' : `${escHtml(r.n)}/4 人 · 房主 ${escHtml(r.host)} · 關卡 ${escHtml(r.level)}`}</div></div><div class="pr">${r.full ? '已滿' : r.noProbe ? '嘗試加入' : '加入'}</div>`;
        if (!r.full)
          d.onclick = () => {
            if (this.net.joining) return;
            this.mpJoin(r.peerId);
            for (const x of el.querySelectorAll('.part')) x.style.opacity = '.5';
          };
        if (this.net.server) {
          const sb = document.createElement('button');
          sb.textContent = '觀戰';
          sb.style.marginLeft = '8px';
          sb.onclick = (ev) => {
            ev.stopPropagation();
            this.mpSpectate(r.peerId);
          };
          d.querySelector('.pr').appendChild(sb);
        }
        el.appendChild(d);
      }
    } catch (e) {
      this.net.log('搜尋失敗：' + (e.message || e));
    }
  },
  async mpSpectate(peerId) {
    this.net.log('以觀戰者身分加入…');
    try {
      await this.net.join(peerId, true);
    } catch (e) {
      this.net.log('連線失敗：' + (e.message || e));
    }
  },
  async mpJoin(peerId) {
    if (this.net.joining) {
      this.net.log('已送出請求，等待房主回應…');
      return;
    }
    if (this.net.role) {
      this.net.log('已在房間中');
      return;
    }
    this.net.joining = true;
    setTimeout(() => {
      this.net.joining = false;
    }, 8000);
    if (localStorage.getItem('rubicon_unmask') === '1') await unmaskLocalIp(() => {});
    this.net.log('送出加入請求…');
    try {
      await this.net.join(peerId);
    } catch (e) {
      this.net.log('連線失敗：' + (e.message || e));
    }
  },
  renderLobby() {
    const n = this.net;
    const $ = (id) => document.getElementById(id);
    if (!n.role) return;
    $('lobbyTitle').textContent =
      n.roomName +
      (n.role === 'host'
        ? n.server
          ? '（你是房主）'
          : `（你是房主）　房間編號 ${n.roomNo}　區網代碼 ${n.lanCode}`
        : '') +
      ((n.spectators && n.spectators.size) || n.spectatorCount
        ? `　觀戰 ${(n.spectators && n.spectators.size) || n.spectatorCount} 人`
        : '') +
      (this.spectator ? '　（你是觀戰者）' : '');
    $('mpAuto').checked = n.autoApprove;
    $('mpAutoWrap').style.display = n.role === 'host' ? '' : 'none';
    const order = n.players.filter((p) => p.online).sort((a, b) => a.order - b.order);
    $('lobbySlots').innerHTML = [0, 1, 2, 3]
      .map((s) => {
        const p = n.players.find((x) => x.slot === s);
        if (!p) return `<div class="lslot empty"><b>位子 ${s + 1}</b><span class="dim">空</span></div>`;
        const st = asmStats(p.asm || START_ASM);
        const isHost = (n.role === 'host' && s === n.me) || (n.role === 'client' && s === n.hostSlot);
        const ord = order.indexOf(p);
        const S = n.pvpSet || {};
        const teamTag =
          S.mode === 'pvp' && S.type === 'team'
            ? `<span style="color:${PVP_TEAM_COLORS[p.pvpTeam === undefined ? p.slot % 2 : p.pvpTeam]};font-weight:700">［${(p.pvpTeam === undefined ? p.slot % 2 : p.pvpTeam) === 0 ? '藍隊' : '紅隊'}］</span> `
            : '';
        return `<div class="lslot ${S.mode === 'pvp' && S.type === 'team' && (s === n.me || n.role === 'host') ? 'teamtoggle' : ''}" data-s="${s}" style="border-color:${n.slotColor(p.color)}"><b style="color:${n.slotColor(p.color)}">${teamTag}${escHtml(p.nick)}${isHost ? ' ★房主' : ''}${!p.online ? ' （離線）' : ''}${ord === 1 ? ' ・候補房主' : ''}</b><span>${n.pilotLv(p) ? 'Lv ' + n.pilotLv(p) + ' · ' : ''}AP ${st.ap} · ${st.parts.rarm.name.split(' ')[0]} / ${st.parts.larm.name.split(' ')[0]}</span><span class="${p.ready ? 'ok' : 'dim'}">${p.ready ? '✔ 已準備' : '未準備'}${p.lat ? ' · ' + p.lat + 'ms' : ''}</span>${n.role === 'host' && s !== n.me ? `<button class="kick" data-s="${s}">踢出</button>` : ''}</div>`;
      })
      .join('');
    for (const b of $('lobbySlots').querySelectorAll('.kick')) b.onclick = () => n.kick(+b.dataset.s);
    for (const el of $('lobbySlots').querySelectorAll('.teamtoggle'))
      el.onclick = (ev) => {
        if (ev.target.classList.contains('kick')) return;
        const s = +el.dataset.s;
        if (n.role === 'host') {
          const p = n.playerBySlot(s);
          p.pvpTeam = (p.pvpTeam === undefined ? s % 2 : p.pvpTeam) === 1 ? 0 : 1;
          n.syncLobby();
          this.renderLobby();
        } else if (s === n.me) n.tr.send(n.hostPeer, { t: 'team' });
      };
    $('lobbyReq').innerHTML = n.requests
      .map(
        (r, i) =>
          `<div class="lreq"><span><b>${escHtml(r.nick)}</b> 想加入（${asmStats(r.asm || START_ASM).parts.rarm.name.split(' ')[0]}）</span><span><button class="primary" data-i="${i}" data-ok="1">同意</button> <button data-i="${i}" data-ok="0">拒絕</button></span></div>`,
      )
      .join('');
    for (const b of $('lobbyReq').querySelectorAll('button'))
      b.onclick = () => n.approve(n.requests[+b.dataset.i], b.dataset.ok === '1');
    {
      const S = n.pvpSet || { mode: 'pve' };
      const host = n.role === 'host';
      $('lobbyMode').innerHTML =
        `<div class="krow"><span>房間模式</span><span>${host ? `<select id="pvMode"><option value="pve">PVE 合作</option><option value="pvp">PVP 對戰</option></select>` : S.mode === 'pvp' ? 'PVP 對戰' : 'PVE 合作'}</span></div>` +
        (S.mode === 'pvp'
          ? `<div class="krow"><span>對戰型態</span><span>${host ? `<select id="pvType"><option value="ffa">大亂鬥（2–4 人）</option><option value="team">分隊 2v2</option><option value="vsai">玩家 vs 電腦 AC（1v1～4v4）</option></select>` : { ffa: '大亂鬥', team: '分隊 2v2', vsai: '玩家 vs 電腦 AC' }[S.type]}</span></div><div class="krow"><span>勝負規則</span><span>${host ? `<select id="pvRule"><option value="kills">擊破制（重生 5s×死亡次數，目標＝參戰機甲數×5）</option><option value="elim">淘汰制（一條命）</option></select>` : S.rule === 'kills' ? '擊破制' : '淘汰制'}</span></div>` +
            (S.type !== 'vsai'
              ? `<div class="krow"><span>人數不足時</span><span>${host ? `<select id="pvFill"><option value="no">只用目前玩家出擊</option><option value="yes">電腦 AC 補位（大亂鬥補到 4 台、分隊每隊 2 台）</option></select>` : S.fill === 'yes' ? '電腦 AC 補位' : '只用目前玩家'}</span></div>`
              : '') +
            (S.type === 'vsai' || S.fill === 'yes'
              ? `<div class="krow"><span>電腦 AC 難度</span><span>${host ? `<select id="pvDiff"><option value="easy">簡單</option><option value="std">標準</option><option value="hard">困難</option></select>` : AI_DIFF[S.diff].name}</span></div>`
              : '') +
            `<div class="dim" style="font-size:11px">PVP：友軍 AC 消耗品停用、不可救援；時間 6 分鐘。${S.type === 'team' ? '分隊：點自己的位子切換隊伍（藍／紅）。' : ''}</div>`
          : '');
      if (host) {
        const bind = (id, key) => {
          const el = $(id);
          if (!el) return;
          el.value = S[key];
          el.onchange = (e) => {
            S[key] = e.target.value;
            n.syncLobby();
            this.renderLobby();
          };
        };
        bind('pvMode', 'mode');
        bind('pvType', 'type');
        bind('pvRule', 'rule');
        bind('pvDiff', 'diff');
        bind('pvFill', 'fill');
      }
    }
    const me = n.meP();
    $('btnLobbyReady').textContent = me && me.ready ? '取消準備' : '準備';
    $('btnLobbyReady').style.display = this.spectator ? 'none' : '';
    $('btnLobbyGarage').style.display = this.spectator ? 'none' : '';
    $('btnLobbySortie').style.display = n.role === 'host' ? '' : 'none';
    {
      const S = n.pvpSet || { mode: 'pve' };
      const cnt = n.players.filter((p) => p.online).length;
      let ok = n.allReady() && cnt >= 1;
      if (S.mode === 'pvp' && (S.type === 'ffa' || S.type === 'team') && cnt < 2 && S.fill !== 'yes')
        ok = false;
      $('btnLobbySortie').disabled = !ok;
      $('btnLobbySortie').title =
        !ok && cnt < 2 && S.mode === 'pvp' ? '人數不足：等待玩家加入，或選「電腦 AC 補位」' : '';
    }
    $('lobbyLevel').textContent =
      '任務 ' +
      String(n.role === 'host' ? this.save.level : n.hostLevel || 1).padStart(2, '0') +
      ((n.role === 'host' ? this.save.level : n.hostLevel || 1) % 3 === 0 ? '（決戰）' : '');
  },
  netOff() {
    this.netEvents = [];
  },
  onSignal(slot, n) {
    const p = this.net.playerBySlot(slot);
    const txt = `${p ? p.nick : '?'}：${SIGNALS[n] || ''}`;
    this.flashMsg(txt, parseInt(this.net.slotColor(p ? p.color : 0).slice(1), 16), 1.6);
    SFX.ui();
  },
});
