// Game：自訂關卡的選單（標題的「自訂關卡」，state 'levels'）——我的關卡（本機 IndexedDB）、伺服器上的關卡、
// 新建（底圖：空白或產生器的主題／變體／種子）、匯入／匯出、上傳（要先自己通關）、刪除、遊玩、編輯。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { LEVEL_LV, levelBytes, LIMITS, newLevel, newLevelId } from '../level/format.js';
import { loadLevel } from '../level/known.js';
import { SAMPLES } from '../level/samples.js';
import { LevelStore } from '../level/store.js';
import { VARIANTS } from '../world/variants.js';
import { THEMES } from '../world/world.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);

Object.assign(Game.prototype, {
  levelsInit() {
    $('btnLevels').onclick = () => {
      SFX.init();
      this.openLevels();
    };
    $('btnLvBack').onclick = () => {
      this.state = 'title';
      this.showScreen('title');
    };
    $('btnLvNew').onclick = () => this.lvNewOpen();
    $('btnLvImport').onclick = () => $('lvFile').click();
    $('lvFile').onchange = (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) this.lvImportFile(f);
    };
    $('btnLvGarage').onclick = () => {
      this.fromLevels = true;
      this.fromHub = false;
      this.openGarage();
    };
    for (const b of document.querySelectorAll('#levels [data-lt]'))
      b.onclick = () => {
        this.lvTab = b.dataset.lt;
        this.lvRenderList();
      };
    $('lvSearch').oninput = () => this.lvRenderList(true);
    $('lvSort').onchange = () => this.lvRenderList();
    $('btnLvNewCancel').onclick = () => ($('lvNew').hidden = true);
    $('btnLvNewGo').onclick = () => this.lvNewGo();
    $('lvnBase').onchange = () => this.lvNewSync();
    $('lvnTheme').onchange = () => this.lvNewSync();
    $('btnLvnSeed').onclick = () => ($('lvnSeed').value = Math.floor(Math.random() * 1e9));
    $('lvList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (b) this.lvItemAct(b.dataset.a, b.dataset.id);
    });
  },
  async openLevels(focusId) {
    if (this.net && this.net.role) return;
    this.clearMission();
    this.state = 'levels';
    this.showScreen('levels');
    this.lvTab = this.lvTab || 'mine';
    $('lvTabServer').style.display = LevelStore.serverOn ? '' : 'none';
    if (!LevelStore.serverOn && this.lvTab === 'server') this.lvTab = 'mine';
    this.lvFocus = focusId || '';
    const phone = this.edPhone();
    $('btnLvNew').disabled = phone;
    $('lvMsg').textContent = phone ? '手機畫面太小，只能遊玩；請用電腦或平板編輯關卡。' : '';
    await this.lvLoadLists();
    this.lvRenderList();
  },
  // 手機（橫式 390 高）不能編輯
  edPhone() {
    return Math.min(innerWidth, innerHeight) < 480;
  },
  async lvLoadLists() {
    try {
      this.lvMine = await LevelStore.list();
    } catch (e) {
      this.lvMine = [];
      $('lvMsg').textContent = '讀取本機關卡失敗：' + e.message;
    }
    this.lvServer = null;
    if (LevelStore.serverOn)
      try {
        this.lvServer = await LevelStore.serverList();
      } catch (e) {
        this.lvServer = [];
      }
  },
  lvRenderList() {
    for (const b of document.querySelectorAll('#levels [data-lt]'))
      b.classList.toggle('on', b.dataset.lt === this.lvTab);
    const q = ($('lvSearch').value || '').trim().toLowerCase();
    const match = (L) =>
      !q || (L.name + ' ' + (L.author || '') + ' ' + (L.desc || '')).toLowerCase().includes(q);
    const phone = this.edPhone();
    const mine = new Set(LevelStore.mine());
    $('lvSort').style.display = this.lvTab === 'server' ? '' : 'none';
    const card = (L, server, sample) => {
      const T = THEMES[server ? L.theme : L.base.theme] || {};
      const best = this.lvBest(L.id);
      const clear = server ? true : !!L.clear;
      const btn = (a, t, cls = '') =>
        `<button class="${cls}" data-a="${a}" data-id="${escHtml(L.id)}">${t}</button>`;
      const acts = sample
        ? btn('xplay', '遊玩', 'primary') + (phone ? '' : btn('xcopy', '複製到我的關卡（編輯）'))
        : server
          ? btn('splay', '遊玩', 'primary') +
            btn('sget', '下載到本機') +
            (mine.has(L.id) ? btn('sdel', '從伺服器刪除') : '')
          : btn('play', '遊玩', 'primary') +
            (phone ? '' : btn('edit', '編輯')) +
            btn('copy', '複製') +
            btn('export', '匯出') +
            (LevelStore.serverOn ? btn('up', clear ? '上傳' : '上傳（要先通關）', clear ? '' : 'dim') : '') +
            btn('del', '刪除');
      const info = server
        ? `${escHtml(T.name || '')}　等級 ${L.level}　建議 ${L.np || 1} 人${L.segs > 1 ? `　${L.segs} 段` : ''}　遊玩 ${L.plays || 0}　通關 ${L.clears || 0}　作者通關 ${(+L.clearT || 0).toFixed(0)} s`
        : `${escHtml(T.name || '')}　等級 ${L.base.level}　建議 ${L.base.np || 1} 人${L.segs ? `　${L.segs.length + 1} 段` : ''}　物件 ${L.props.length}　單位 ${L.units.length}　觸發器 ${L.triggers.length}`;
      return `<div class="lvItem${this.lvFocus === L.id ? ' focus' : ''}"><div class="lvThumb">${L.thumb ? `<img src="${escHtml(L.thumb)}" alt="">` : ''}</div><div class="lvBody"><b>${escHtml(L.name)}</b>${clear ? '<span class="lvClear">CLEAR</span>' : ''}${mine.has(L.id) && server ? '<span class="lvMine">我的</span>' : ''}<div class="dim">作者 ${escHtml(L.author || '—')}${best ? `　最佳 ${best.toFixed(1)} s` : ''}</div><div class="dim">${info}</div>${L.desc ? `<div class="lvDesc">${escHtml(L.desc)}</div>` : ''}<div class="row">${acts}</div></div></div>`;
    };
    let html;
    if (this.lvTab === 'sample') {
      html = this.lvSamples()
        .filter(match)
        .map((L) => card(L, false, true))
        .join('');
    } else if (this.lvTab === 'server') {
      const so = $('lvSort').value;
      const rate = (L) => (L.plays ? (L.clears || 0) / L.plays : 1);
      const list = (this.lvServer || [])
        .filter(match)
        .sort((a, b) =>
          so === 'plays'
            ? (b.plays || 0) - (a.plays || 0)
            : so === 'rate'
              ? rate(a) - rate(b)
              : (b.t || 0) - (a.t || 0),
        );
      html = list.length
        ? list.map((L) => card(L, true)).join('')
        : '<div class="dim">伺服器上還沒有關卡</div>';
    } else {
      const list = (this.lvMine || []).filter(match);
      html = list.length
        ? list.map((L) => card(L, false)).join('')
        : `<div class="dim">還沒有關卡${phone ? '' : '：按「新建關卡」開始做第一關'}</div>`;
    }
    $('lvList').innerHTML = html;
    const f = $('lvList').querySelector('.focus');
    if (f) f.scrollIntoView({ block: 'nearest' });
  },
  async lvItemAct(a, id) {
    const msg = (t, err) => {
      $('lvMsg').textContent = t;
      $('lvMsg').style.color = err ? '#ff8a8a' : '';
    };
    try {
      if (a === 'play' || a === 'edit' || a === 'copy' || a === 'export' || a === 'up' || a === 'del') {
        const raw = await LevelStore.get(id);
        if (!raw) return msg('找不到這個關卡', true);
        const warn = [];
        const L = loadLevel(raw, warn);
        if (a === 'play') return this.lvPlay(L, { src: 'local' });
        if (a === 'edit') return this.edOpen(L);
        if (a === 'export') return LevelStore.download(L);
        if (a === 'copy') {
          L.id = newLevelId();
          L.name = (L.name + '（副本）').slice(0, LIMITS.name);
          L.created = L.updated = Date.now();
          L.clear = null;
          await LevelStore.put(L);
          await this.lvLoadLists();
          this.lvFocus = L.id;
          return this.lvRenderList();
        }
        if (a === 'del') {
          if (!this.lvConfirmDel || this.lvConfirmDel !== id) {
            this.lvConfirmDel = id;
            return msg(`再按一次「刪除」確定刪除「${L.name}」（無法復原）`, true);
          }
          this.lvConfirmDel = null;
          await LevelStore.del(id);
          await this.lvLoadLists();
          msg('已刪除');
          return this.lvRenderList();
        }
        if (a === 'up') {
          if (!L.clear) return msg('上傳前要先在編輯器「試玩」並通關一次（確認關卡打得完）', true);
          if (levelBytes(L) > LIMITS.bytes) return msg('關卡太大（上限 2 MB）', true);
          msg('上傳中…');
          await LevelStore.upload(L);
          LevelStore.markMine(L.id, true);
          await this.lvLoadLists();
          return msg(`已上傳「${L.name}」到伺服器`);
        }
      }
      if (a === 'xplay' || a === 'xcopy') {
        const L = this.lvSamples().find((x) => x.id === id);
        if (!L) return;
        if (a === 'xplay') return this.lvPlay(L, { src: 'sample' });
        const c = JSON.parse(JSON.stringify(L));
        c.id = newLevelId();
        c.name = L.name.replace(/^範例：/, '') + '（副本）';
        c.author = this.edAuthorName();
        c.created = c.updated = Date.now();
        c.clear = null;
        await LevelStore.put(c);
        await this.lvLoadLists();
        this.lvTab = 'mine';
        this.lvFocus = c.id;
        this.lvRenderList();
        return this.edOpen(loadLevel(c));
      }
      if (a === 'splay' || a === 'sget') {
        msg('下載中…');
        const raw = await LevelStore.serverGet(id);
        const L = loadLevel(raw);
        msg('');
        if (a === 'splay') return this.lvPlay(L, { src: 'server' });
        // 下載到本機：不是自己的關卡就換新的編號（改了之後是自己的作品）
        if (!LevelStore.mine().includes(L.id)) {
          L.id = newLevelId();
          L.clear = null;
        }
        await LevelStore.put(L);
        await this.lvLoadLists();
        this.lvTab = 'mine';
        this.lvFocus = L.id;
        this.lvRenderList();
        return msg(`已下載「${L.name}」到我的關卡`);
      }
      if (a === 'sdel') {
        if (this.lvConfirmDel !== 's' + id) {
          this.lvConfirmDel = 's' + id;
          return msg('再按一次確定從伺服器刪除', true);
        }
        this.lvConfirmDel = null;
        await LevelStore.serverDel(id);
        LevelStore.markMine(id, false);
        await this.lvLoadLists();
        this.lvRenderList();
        return msg('已從伺服器刪除');
      }
    } catch (e) {
      msg(e.message || String(e), true);
    }
  },
  async lvImportFile(f) {
    try {
      const raw = JSON.parse(await f.text());
      const warn = [];
      const L = loadLevel(raw, warn);
      L.clear = LevelStore.mine().includes(L.id) ? L.clear : null;
      const ex = await LevelStore.get(L.id);
      if (ex && !LevelStore.mine().includes(L.id)) L.id = newLevelId();
      await LevelStore.put(L);
      await this.lvLoadLists();
      this.lvTab = 'mine';
      this.lvFocus = L.id;
      this.lvRenderList();
      $('lvMsg').textContent = `已匯入「${L.name}」` + (warn.length ? '（' + warn.join('；') + '）' : '');
    } catch (e) {
      $('lvMsg').textContent = '匯入失敗：' + (e.message || e);
    }
  },
  // 內建的範例關卡（每次重新產生並驗證）
  lvSamples() {
    if (!this.lvSampleList) this.lvSampleList = SAMPLES.map((f) => loadLevel(f()));
    return this.lvSampleList;
  },
  // ---------- 新建 ----------
  lvNewOpen() {
    $('lvnTheme').innerHTML = Object.keys(THEMES)
      .map((k) => `<option value="${k}">${escHtml(THEMES[k].name)}</option>`)
      .join('');
    $('lvnTheme').value = 'industrial';
    $('lvnSeed').value = Math.floor(Math.random() * 1e9);
    $('lvnLevel').min = LEVEL_LV[0];
    $('lvnLevel').max = LEVEL_LV[1];
    $('lvnLevel').value = Math.max(1, Math.min(30, this.save.level || 5));
    $('lvnName').value = '';
    $('lvNew').hidden = false;
    this.lvNewSync();
  },
  lvNewSync() {
    const gen = $('lvnBase').value === 'gen';
    const th = $('lvnTheme').value;
    $('lvnGenRow').style.display = gen ? '' : 'none';
    const vs = VARIANTS[th] || {};
    $('lvnVariant').innerHTML =
      '<option value="">標準</option>' +
      Object.keys(vs)
        .filter((k) => !vs[k].border)
        .map((k) => `<option value="${k}">${escHtml(vs[k].name || k)}</option>`)
        .join('');
  },
  lvNewGo() {
    const gen = $('lvnBase').value === 'gen';
    const L = newLevel({
      theme: $('lvnTheme').value,
      blank: !gen,
      variant: gen ? $('lvnVariant').value : '',
      seed: Math.max(1, Math.floor(+$('lvnSeed').value || 1)),
      props: gen ? $('lvnProps').value : 'none',
      level: Math.max(LEVEL_LV[0], Math.min(LEVEL_LV[1], Math.round(+$('lvnLevel').value || 5))),
    });
    L.name = ($('lvnName').value || '').trim().slice(0, LIMITS.name) || '新關卡';
    L.author = this.edAuthorName();
    $('lvNew').hidden = true;
    this.edOpen(L, { fresh: true });
  },
  edAuthorName() {
    try {
      return (localStorage.getItem('rubicon_nick') || '').slice(0, 24);
    } catch (e) {
      return '';
    }
  },
});
