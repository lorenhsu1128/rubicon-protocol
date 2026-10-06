// Game：伺服器模型組（只在從 rubicon-server 的網址開啟時）
// - 我的機甲模型組：大廳／車庫選本地模型庫的一組 → 打包上傳到伺服器（內容雜湊相同就不重傳）→ 雜湊告訴房主（mset）
//   選「伺服器預設組」表示不上傳；設定和單人模式共用（rubicon_localmodels 的 on／set）
// - 大廳顯示每位玩家的模型組與下載狀態；房主出擊前先備齊所有玩家的模型組（子彈發射點依玩家的模型計算）
// - 客機與觀戰者在背景下載，還沒好之前先用伺服器預設組，好了再換（swapModel，只換外觀）
import { Game } from './game.js';
import { escHtml } from '../core/html.js';
import { LocalModels, SERVER_SET } from '../render/local-models.js';
import { RemoteSets, onServer, uploadSet } from '../render/net-models.js';

const $ = (id) => document.getElementById(id);
const HASH_RE = /^[0-9a-f]{64}$/;
const validHash = (h) => (typeof h === 'string' && HASH_RE.test(h) ? h : null);

Object.assign(Game.prototype, {
  mpModelsInit() {
    this.mySet = null; // { hash, name }：已上傳的模型組
    this.mySetState = ''; // ''／'busy'／'err'
    this.mySetErr = '';
    // 下載完成：大廳更新狀態；任務中把用這一組的機甲換上新模型
    RemoteSets.listeners.add((h) => {
      if (this.state === 'lobby') this.renderLobby();
      if (this.state === 'garage') this.renderGarage();
      const set = RemoteSets.get(h);
      if (!set) return;
      for (const e of this.allMechs ? this.allMechs() : [])
        if (e.opts && e.opts.ms === h && e.modelSrc !== set && !e.dead) e.swapModel();
    });
  },
  // 我想用的本地模型組 id（null＝伺服器預設組）
  mySetWanted() {
    const S = LocalModels.settings;
    return S.on && S.set !== SERVER_SET ? S.set : null;
  },
  // 依設定上傳我的模型組並通知房主；重複呼叫時共用同一次
  mpSyncMySet() {
    if (!onServer() || !this.net || !this.net.role || this.spectator) return Promise.resolve();
    if (this.mySetBusy) return this.mySetBusy;
    this.mySetBusy = this._mpSyncMySet().finally(() => (this.mySetBusy = null));
    return this.mySetBusy;
  },
  async _mpSyncMySet() {
    const want = this.mySetWanted();
    let next = null;
    if (want) {
      this.mySetState = 'busy';
      this.mySetErr = '';
      this.mpModelsUi();
      try {
        await LocalModels.reload();
        const d = LocalModels.setData;
        if (d && d.id === want && (d.recs.length || Object.keys(d.joints).length)) {
          const r = await uploadSet(d);
          next = { hash: r.hash, name: d.name };
          RemoteSets.load(r.hash);
        }
        this.mySetState = '';
      } catch (e) {
        this.mySetState = 'err';
        this.mySetErr = e.message || String(e);
      }
    } else this.mySetState = '';
    const changed = (next && next.hash) !== (this.mySet && this.mySet.hash);
    this.mySet = next;
    this.mpSendMySet();
    this.mpModelsUi();
    if (changed && this.state === 'garage') this.renderGarage();
  },
  mpSendMySet() {
    const n = this.net;
    if (!n || !n.role) return;
    const ms = this.mySet ? this.mySet.hash : null,
      msn = this.mySet ? this.mySet.name : '';
    if (n.role === 'host') {
      const me = n.meP();
      if (!me) return;
      me.ms = ms;
      me.msn = msn;
      n.syncLobby();
      if (this.state === 'lobby') this.renderLobby();
    } else n.tr.send(n.hostPeer, { t: 'mset', ms, msn });
  },
  // 下載房間裡所有玩家的模型組（大廳收到名單時）
  mpPrefetch() {
    if (!onServer() || !this.net) return;
    for (const p of this.net.players || []) if (validHash(p.ms)) RemoteSets.load(p.ms);
  },
  // 進大廳、車庫時：讀伺服器預設組、上傳我的模型組、下載其他人的
  async mpModelsRefresh() {
    if (!onServer()) return;
    await this.srvRefresh();
    this.mpPrefetch();
    await this.mpSyncMySet();
  },
  // 房主出擊：先備齊伺服器預設組與所有玩家的模型組（最多等 30 秒，失敗的用伺服器預設組）
  async mpStartWhenReady() {
    if (this.mpStarting) return;
    if (!onServer()) return this.startMission();
    this.mpStarting = true;
    const p = this.lmProgress('準備模型組…', true);
    try {
      await this.srvRefresh();
      const hs = [...new Set(this.net.players.filter((x) => x.online).map((x) => validHash(x.ms)))].filter(
        Boolean,
      );
      let done = 0;
      p.step(0, hs.length || 1, '');
      const all = Promise.all(
        hs.map((h) =>
          RemoteSets.load(h).then(() => {
            done++;
            p.step(done, hs.length, '');
          }),
        ),
      );
      await Promise.race([all, new Promise((r) => setTimeout(r, 30000))]);
    } finally {
      $('lmLoad').classList.remove('on');
      this.mpStarting = false;
    }
    if (this.state === 'lobby' && this.net.role === 'host' && this.net.allReady()) this.startMission();
  },
  // 玩家的模型組狀態文字（大廳）
  mpModelTag(p) {
    if (!onServer()) return '';
    const n = this.net;
    const mine = p.slot === n.me;
    let st;
    if (mine && this.mySetState === 'busy') st = '<span class="dim">上傳中…</span>';
    else if (mine && this.mySetState === 'err')
      st = `<span style="color:#ff6b6b">上傳失敗（${escHtml(this.mySetErr)}）</span>`;
    else if (!validHash(p.ms)) st = '';
    else {
      const s = RemoteSets.state(p.ms);
      st =
        s === 'ok'
          ? '<span class="ok">✓</span>'
          : s === 'err'
            ? '<span style="color:#ff6b6b">✗ 下載失敗，用伺服器預設組</span>'
            : '<span class="dim">下載中…</span>';
    }
    const name = validHash(p.ms) ? `「${escHtml(p.msn || '模型組')}」` : '伺服器預設組';
    return `<span class="mtag" data-slot="${p.slot}">模型：${name} ${st}</span>`;
  },
  // 我的機甲模型組選單（大廳與車庫）：伺服器預設組＋本地模型庫的模型組
  mySetSelect(id) {
    const S = LocalModels.settings;
    const cur = this.mySetWanted() || SERVER_SET;
    const opts =
      `<option value="${SERVER_SET}">伺服器預設組（不上傳）</option>` +
      LocalModels.sets
        .map(
          (s) =>
            `<option value="${escHtml(s.id)}"${s.id === cur ? ' selected' : ''}>${escHtml(s.name || s.id)}</option>`,
        )
        .join('');
    const inMp = !!(this.net && this.net.role);
    return (
      `<label class="mySet">我的機甲模型組 <select id="${id}">${opts}</select></label>` +
      `<span class="dim" style="font-size:11px">${
        inMp
          ? '選本地模型庫的一組會上傳到伺服器，其他玩家也看得到；任務中變更下次出擊才套用'
          : '本地模型庫的一組；選伺服器預設組時用伺服器上的模型'
      }${S.on ? '' : '（目前沒開啟本地模型庫）'}</span>`
    );
  },
  bindMySet(id) {
    const el = $(id);
    if (!el) return;
    el.onchange = () => {
      const S = LocalModels.settings;
      if (el.value === SERVER_SET) S.set = SERVER_SET;
      else {
        S.set = el.value;
        S.on = true;
      }
      LocalModels.saveSettings();
      if (this.net && this.net.role) this.mpSyncMySet();
      else this.lmRefresh().then(() => this.state === 'garage' && this.renderGarage());
      this.mpModelsUi();
    };
  },
  // 大廳／車庫的模型組區塊（只在伺服器網址）
  mpModelsUi() {
    if (!onServer()) return;
    const box = this.state === 'lobby' ? $('lobbyModels') : this.state === 'garage' ? $('gModelSet') : null;
    if (!box || this.spectator) return;
    if (!this.setsListed) {
      this.setsListed = true;
      LocalModels.listSets().then(() => this.mpModelsUi());
    }
    box.innerHTML = this.mySetSelect(box.id + 'Sel');
    box.style.display = '';
    this.bindMySet(box.id + 'Sel');
    if (this.state === 'lobby') {
      const me = this.net && this.net.meP && this.net.meP();
      const tag = document.querySelector(`#lobbySlots .mtag[data-slot="${me ? me.slot : -1}"]`);
      if (tag && me) tag.outerHTML = this.mpModelTag(me);
    }
  },
  // 任務中所有的機甲（模型下載完時換模型）
  allMechs() {
    return [...(this.players || []), ...(this.enemies || []), ...(this.allies || [])];
  },
});
