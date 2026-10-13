// Game：自訂關卡的多人——大廳的房間模式「自訂關卡」（房主選關卡）、關卡資料分塊傳給每位玩家
// （'lvc'，缺的塊由客機以 'lvreq' 再要；收齊後驗證雜湊、經過 loadLevel，回 'lvok'），全員收到才出擊。
// 任務中加入的玩家：開局訊息帶關卡的雜湊，還沒有那份關卡時先要資料、收齊再開局。
import { escHtml } from '../core/html.js';
import { loadLevel } from '../level/known.js';
import { LevelStore } from '../level/store.js';
import { Game } from './game.js';

const CHUNK = 16000;
const WAIT_MS = 30000;

Object.assign(Game.prototype, {
  lvLibPut(h, full) {
    this.lvLib = this.lvLib || {};
    this.lvLib[h] = full;
  },
  // 房主：大廳選了關卡（full 已經過 loadLevel）
  lvShare(full) {
    const n = this.net;
    const txt = JSON.stringify(full);
    const h = LevelStore.hashTxt(txt);
    this.lvLibPut(h, full);
    this.lvTxt = this.lvTxt || {};
    this.lvTxt[h] = txt;
    this.lvHash = h;
    n.pvpSet = n.pvpSet || { mode: 'level' };
    n.pvpSet.lv = {
      h,
      id: full.id,
      name: full.name,
      author: full.author,
      theme: full.base.theme,
      np: full.base.np,
      segs: 1 + ((full.segs && full.segs.length) || 0),
    };
    const me = n.meP && n.meP();
    if (me) me.lvh = h;
    for (const p of n.players) if (p.slot !== n.me && p.online) this.lvSendChunks(p.peerId, h);
    n.syncLobby();
    this.renderLobby();
  },
  lvSendChunks(pid, h, miss) {
    const txt = this.lvTxt && this.lvTxt[h];
    if (!txt) return;
    const N = Math.ceil(txt.length / CHUNK) || 1;
    for (let i = 0; i < N; i++) {
      if (miss && !miss.includes(i)) continue;
      this.net.tr.send(pid, { t: 'lvc', h, i, n: N, d: txt.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
  },
  // 房主收到客機的訊息
  lvHostMsg(p, d) {
    if (d.t === 'lvreq') {
      if (typeof d.h === 'string') this.lvSendChunks(p.peerId, d.h, Array.isArray(d.miss) ? d.miss : null);
      return true;
    }
    if (d.t === 'lvok') {
      p.lvh = typeof d.h === 'string' ? d.h : null;
      this.net.syncLobby();
      this.renderLobby();
      return true;
    }
    return false;
  },
  // 客機收到房主的訊息：關卡的分塊；開局時還沒有關卡就先等
  lvClientMsg(d) {
    if (d.t === 'lvc') {
      this.lvRecv(d);
      return true;
    }
    if (d.t === 'start' && d.lvh && !(this.lvLib && this.lvLib[d.lvh])) {
      this.lvPendStart = d;
      this.lvRequest(d.lvh);
      this.flashMsg('下載自訂關卡…', 0x5cc8ff, 2);
      return true;
    }
    if (d.t === 'lobby') {
      const lv = d.pvp && d.pvp.mode === 'level' && d.pvp.lv;
      if (lv && lv.h && !(this.lvLib && this.lvLib[lv.h])) this.lvRequest(lv.h);
      else if (lv && lv.h && this.lvLib && this.lvLib[lv.h] && this.lvOkSent !== lv.h) {
        this.lvOkSent = lv.h;
        this.net.tr.send(this.net.hostPeer, { t: 'lvok', h: lv.h });
      }
    }
    return false;
  },
  lvRequest(h) {
    this.lvRx = this.lvRx || {};
    const rx = this.lvRx[h];
    const now = performance.now();
    if (rx && now - rx.t < 2500) return;
    if (rx) {
      rx.t = now;
      const miss = [];
      for (let i = 0; i < rx.n; i++) if (rx.parts[i] === undefined) miss.push(i);
      this.net.tr.send(this.net.hostPeer, { t: 'lvreq', h, miss: rx.n ? miss : null });
    } else {
      this.lvRx[h] = { t: now, n: 0, parts: [] };
      this.net.tr.send(this.net.hostPeer, { t: 'lvreq', h });
    }
    clearTimeout(this.lvRxTo);
    this.lvRxTo = setTimeout(() => {
      if (this.lvRx && this.lvRx[h] && !(this.lvLib && this.lvLib[h]) && this.net.role === 'client')
        this.lvRequest(h);
    }, 3000);
  },
  lvRecv(d) {
    if (typeof d.h !== 'string' || !(d.n > 0) || d.n > 400 || typeof d.d !== 'string') return;
    this.lvRx = this.lvRx || {};
    const rx = this.lvRx[d.h] || (this.lvRx[d.h] = { t: performance.now(), n: 0, parts: [] });
    rx.n = d.n;
    rx.parts[d.i] = d.d;
    for (let i = 0; i < rx.n; i++) if (rx.parts[i] === undefined) return;
    const txt = rx.parts.join('');
    delete this.lvRx[d.h];
    let full;
    try {
      if (LevelStore.hashTxt(txt) !== d.h) throw new Error('雜湊不符');
      const raw = JSON.parse(txt);
      full = loadLevel(raw);
    } catch (e) {
      this.flashMsg('自訂關卡的資料損毀：' + e.message, 0xff4d4d, 3);
      return;
    }
    this.lvLibPut(d.h, full);
    // 原文也留著：房主遷移後由這裡把同一份資料（同一個雜湊）傳給重新連上的玩家
    this.lvTxt = this.lvTxt || {};
    this.lvTxt[d.h] = txt;
    this.lvOkSent = d.h;
    this.net.tr.send(this.net.hostPeer, { t: 'lvok', h: d.h });
    if (this.state === 'lobby') this.renderLobby();
    const ps = this.lvPendStart;
    if (ps && ps.lvh === d.h) {
      this.lvPendStart = null;
      this.startMissionClient(ps);
    }
  },
  // 房主出擊：全員收到關卡才開始（最多等 30 秒，期間重送）
  lvBeginMp() {
    const n = this.net,
      S = n.pvpSet || {};
    const h = S.lv && S.lv.h;
    const full = h && this.lvLib && this.lvLib[h];
    if (!full) return this.flashMsg('請先選擇自訂關卡', 0xff8a8a, 2);
    const t0 = performance.now();
    const go = () => {
      const missing = n.players.filter((p) => p.online && p.slot !== n.me && p.lvh !== h);
      if (!missing.length || performance.now() - t0 > WAIT_MS) {
        if (missing.length)
          this.flashMsg(`${missing.map((p) => p.nick).join('、')} 還沒收到關卡，仍然出擊`, 0xffb020, 3);
        this.lvHash = h;
        return this.lvPlay(full, { src: S.lv.src || 'lobby' });
      }
      for (const p of missing) this.lvSendChunks(p.peerId, h);
      this.flashMsg('等待隊友下載關卡…', 0x5cc8ff, 1.2);
      setTimeout(go, 1500);
    };
    go();
  },
  // 大廳的位子：關卡下載狀態
  lvSlotTag(p) {
    const S = (this.net && this.net.pvpSet) || {};
    if (S.mode !== 'level' || !S.lv) return '';
    return p.lvh === S.lv.h ? '<span class="ok">關卡 ✓</span>' : '<span class="dim">關卡下載中…</span>';
  },
  // 大廳：房間模式「自訂關卡」的列（房主選關卡，其他人看名稱與下載狀態）
  lvLobbyHtml(host) {
    const S = this.net.pvpSet || {};
    const lv = S.lv;
    if (!host)
      return `<div class="krow"><span>關卡</span><span>${lv ? escHtml(lv.name) + (this.lvLib && this.lvLib[lv.h] ? ' <span class="ok">✓</span>' : ' <span class="dim">下載中…</span>') : '<span class="dim">房主還沒選</span>'}</span></div>`;
    const opts = (this.lvLobbyList || [])
      .map((x) => `<option value="${escHtml(x.key)}">${escHtml(x.name)}</option>`)
      .join('');
    return `<div class="krow"><span>關卡</span><span><select id="pvLevel"><option value="">（選擇關卡）</option>${opts}</select></span></div>${lv ? `<div class="dim" style="font-size:11px">${escHtml(lv.name)}${lv.author ? '　作者 ' + escHtml(lv.author) : ''}　建議 ${lv.np || 1} 人${lv.segs > 1 ? `　${lv.segs} 段` : ''}　自訂關卡沒有 COAM 與經驗</div>` : ''}`;
  },
  async lvLobbyRefresh() {
    const list = [];
    try {
      for (const L of await LevelStore.list()) list.push({ key: 'l:' + L.id, name: '本機：' + L.name });
    } catch (e) {}
    if (LevelStore.serverOn)
      try {
        for (const L of await LevelStore.serverList())
          list.push({ key: 's:' + L.id, name: '伺服器：' + L.name });
      } catch (e) {}
    this.lvLobbyList = list;
    if (this.state === 'lobby') this.renderLobby();
  },
  lvLobbyBind() {
    const el = document.getElementById('pvLevel');
    if (!el) return;
    const S = this.net.pvpSet || {};
    el.value = (S.lv && S.lv.key) || '';
    el.onchange = async () => {
      const key = el.value;
      if (!key) return;
      try {
        const raw =
          key[0] === 'l' ? await LevelStore.get(key.slice(2)) : await LevelStore.serverGet(key.slice(2));
        const full = loadLevel(raw);
        this.lvShare(full);
        this.net.pvpSet.lv.key = key;
        this.net.pvpSet.lv.src = key[0] === 's' ? 'server' : 'local';
        this.net.syncLobby();
        this.renderLobby();
      } catch (e) {
        this.flashMsg('讀取關卡失敗：' + e.message, 0xff4d4d, 3);
      }
    };
  },
});
