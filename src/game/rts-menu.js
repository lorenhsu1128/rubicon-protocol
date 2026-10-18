// Coral 戰爭（docs/rts-design.md）的選單畫面 'rtsmenu' 與結果畫面 'rtsend'（mixin；R6 從 rts.js 移過來，之後歸 E 包，docs 17.1、17.6）。
// 局內的核心在 rts.js（rtsStart、rtsEnd…）；這裡只有畫面：
// - 選單：陣營（traits 的說明）、電腦、難度（說明）、地圖主題（RTS_THEMES 自動列出）、地圖大小（小 300 m／中 400 m）、種子、
//   預覽（鍵＝主題|種子|大小）、「說明」頁（操作、資源與人口、相剋表、四個陣營；分頁 data-padtabs，手把可以操作）。
// - 結果：表格＋兩張折線圖（累計收入、部隊人口；R.timeline 每 30 秒的取樣，標出升階與英雄陣亡）、「再來一場」、投降的局標「投降」。
//   R.timeline 由 A 包（rts.js）取樣；A 還沒有時由 rtsHudTimeline（HUD 每格呼叫）在 R.tlHud 取樣，格式見 rtsMenuTl。
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { RTS_ARM_NAME, RTS_ATK_NAME, RTS_TYPE_K, armorK } from '../data/rts-combat.js';
import {
  RTS_DEFS,
  RTS_DIFFS,
  RTS_FACTIONS,
  RTS_POP_MAX,
  RTS_TEAM_COLORS,
  RTS_UPKEEP,
} from '../data/rts-units.js';
import { RTS_SIZES, RTS_THEMES } from '../world/rts-map.js';
import { Game } from './game.js';

const ME = 0; // 玩家的隊伍
const PREF_KEY = 'rubicon_rts'; // 選單的設定
const REC_KEY = 'rubicon_rts_rec'; // 遭遇戰的戰績（rts.js 的 rtsEnd 也寫這個鍵，格式見那裡）
const TL_DT = 30; // 結果圖的取樣間隔（秒）
const TL_MAX = 80; // 最多幾筆（40 分鐘）
// 地圖大小的說明（docs 17.4；大小與名稱以 C 包 world/rts-map.js 的 RTS_SIZES 為準）
const SIZES = [
  { size: 300, name: '小', desc: '300 m：主基地離中心約 100 m、分礦少，節奏快' },
  { size: 400, name: '中', desc: '400 m：標準的大小' },
];
// 難度的說明（docs 17.3；RTS_DIFFS 有 desc 時用它的）
const DIFF_DESC = {
  easy: '不太會打、7 分鐘後才進攻、不撤退',
  normal: '會打野、升科技、用英雄技能',
  hard: '騷擾、集火、撤回受傷的單位，進攻更早',
  insane: '困難的行為＋看得到全地圖、收入 ×1.5',
};
// 各陣營「怎麼開始」（說明頁與 rts-tips.js 的開局卡共用：rtsMenuHowto；mixin 不能 export）
const RTS_HOWTO = {
  castron: '選工人（作業 MT）蓋補給庫（人口）與兵工廠；主堡繼續生產工人採礦，Coral 湧出點上蓋抽取站。',
  aetheric: '先放導管節點：要電的建築只能蓋在導管範圍內；研究作業機放下地基就能離開，建築自己長。',
  veerwell: '沒有建造工人：選調度中心，從指令卡空投建築（運輸機有同時空投的上限）；集貨站可以蓋在遠處的礦。',
  sancta: '互助作業機會採礦也會拾荒：戰場上的殘骸是礦石、Coral 與零件；敵人來襲時在聚落中心按避難警報。',
};
const loadJson = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || d;
  } catch (e) {
    return d;
  }
};
const saveJson = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch (e) {}
};
const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const facName = (f) => (RTS_FACTIONS[f] && RTS_FACTIONS[f].name) || f;
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
// 戰績（docs 14.7）：鍵＝我方陣營-電腦陣營-難度；舊的 { w, l } 當成卡斯特隆對卡斯特隆（普通難度）讀進來
function loadRec() {
  const r = loadJson(REC_KEY, {});
  if (typeof r.w === 'number' || typeof r.l === 'number') {
    const o = { 'castron-castron-normal': { w: r.w || 0, l: r.l || 0 } };
    saveJson(REC_KEY, o);
    return o;
  }
  return r && typeof r === 'object' ? r : {};
}
const recKey = (a, b, d) => `${a}-${b}-${d}`;
const sizeName = (s) =>
  (Object.values(RTS_SIZES || {}).find((z) => z.size === s) || SIZES.find((z) => z.size === s) || {}).name ||
  s + ' m';

// 說明頁的內容（分頁）
const HELP_TABS = [
  ['ops', '操作'],
  ['res', '資源與人口'],
  ['type', '相剋'],
  ['fac', '陣營'],
];
function helpHtml(tab) {
  if (tab === 'res') {
    return `
      <ul>
        <li><b>礦石</b>：工人在礦脈與主堡（回收點）之間來回採集；分礦是第二座主堡。</li>
        <li><b>Coral</b>：在 Coral 湧出點上蓋抽取站（艾瑟立克是汲取塔），自動產出；科技、英雄與高階兵種都要它。</li>
        <li><b>零件</b>（聖域）：拾荒殘骸取得，用來改裝與拼裝。</li>
        <li><b>人口</b>：活著的單位＋已開始生產的單位；上限由補給庫等建築提供，最多 ${RTS_POP_MAX}。</li>
      </ul>
      <h4>維持費（人口越多，礦石收入越少；Coral 不受影響）</h4>
      <table class="rtsHelpTbl"><tr><th>人口</th><th>名稱</th><th>礦石收入</th></tr>
      ${RTS_UPKEEP.map((u, i) => `<tr><td>${i ? RTS_UPKEEP[i - 1].max + 1 : 0}～${u.max}</td><td>${escHtml(u.name)}</td><td>${Math.round(u.k * 100)}%</td></tr>`).join('')}
      </table>
      <h4>勝敗</h4>
      <ul>
        <li>拆光對方所有的建築（含工地）就獲勝。</li>
        <li>一隊沒有任何蓋好的主堡時開始 120 秒倒數，時間到對方看得到它全部建築與單位的位置（重新蓋好主堡就取消）。</li>
        <li>暫停選單可以投降（算敗）。局內不寫存檔，只記勝敗。</li>
      </ul>`;
  }
  if (tab === 'type') {
    const atks = Object.keys(RTS_TYPE_K);
    const arms = Object.keys(RTS_TYPE_K[atks[0]] || {});
    const cell = (k) => `<td class="${k > 1.01 ? 'up' : k < 0.99 ? 'dn' : ''}">${Math.round(k * 100)}%</td>`;
    return `
      <p class="dim">攻擊類型（列）打護甲類型（欄）的傷害倍率；選取單位時面板也會顯示。</p>
      <table class="rtsHelpTbl rtsHelpType"><tr><th></th>${arms.map((a) => `<th>${escHtml(RTS_ARM_NAME[a] || a)}</th>`).join('')}</tr>
      ${atks.map((k) => `<tr><th>${escHtml(RTS_ATK_NAME[k] || k)}</th>${arms.map((a) => cell(RTS_TYPE_K[k][a])).join('')}</tr>`).join('')}
      </table>
      <p class="dim">護甲值另外減傷：護甲 2＝受到 ${Math.round(armorK(2) * 100)}%、5＝${Math.round(armorK(5) * 100)}%、10＝${Math.round(armorK(10) * 100)}%。研究可以提高攻擊與護甲。</p>`;
  }
  if (tab === 'fac') {
    return Object.entries(RTS_FACTIONS)
      .filter(([, F]) => F.avail)
      .map(
        ([k, F]) => `
        <h4>${escHtml(F.name)} <small class="dim">${escHtml(F.style || '')}（${escHtml(F.leader || '')}）</small></h4>
        <ul>${(F.traits || []).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>
        <p class="rtsHow">怎麼開始：${escHtml(RTS_HOWTO[k] || '')}</p>`,
      )
      .join('');
  }
  return `
    <table class="rtsHelpTbl rtsHelpKeys">
      <tr><td>左鍵</td><td>選取；拖曳框選（有單位時不選建築）；Shift 加選／減選；連按兩下或 Ctrl＋點＝畫面上同種的</td></tr>
      <tr><td>右鍵</td><td>智慧指令：移動、攻擊、採集、修理；選建築時設集結點（多座一起設）</td></tr>
      <tr><td>Q W E R／A S D F／Z X C V</td><td>指令卡（位置對應的鍵）；M 移動、H 守住、P 巡邏</td></tr>
      <tr><td>Ctrl＋數字／Shift＋數字</td><td>設定編隊／加進編隊；數字＝選取編隊，連按兩下鏡頭跳過去</td></tr>
      <tr><td>Tab</td><td>選取多種單位時換子群組（指令卡跟著換，英雄的技能用目前的英雄）</td></tr>
      <tr><td>F1～F3</td><td>選英雄（連按兩下鏡頭跳過去）；選英雄按 F 親自駕駛，長按 F 回到指揮</td></tr>
      <tr><td>F8／F9</td><td>閒置工人／閒置部隊</td></tr>
      <tr><td>空白鍵</td><td>跳到最近的事件（被攻擊、生產完成…）</td></tr>
      <tr><td>方向鍵、畫面邊緣</td><td>捲動鏡頭（設定裡可以改速度、關掉邊緣捲動）</td></tr>
      <tr><td>滾輪／中鍵或 Alt＋拖曳／Home</td><td>縮放／旋轉／重設鏡頭</td></tr>
      <tr><td>小地圖</td><td>左鍵移動鏡頭、右鍵下指令、Alt＋左鍵發信號</td></tr>
      <tr><td>指令卡右鍵</td><td>技能的自動施放開關</td></tr>
      <tr><td>Esc</td><td>取消目前的模式，再按一次暫停（投降、設定）</td></tr>
    </table>
    <p class="dim">局內的操作只支援滑鼠與鍵盤；選單、說明與結果畫面可以用手把。</p>`;
}

Object.assign(Game.prototype, {
  // ---------- 選單 ----------
  rtsMenuOpen() {
    SFX.init();
    if (this.rts) this.clearMission();
    const P = (this.rtsPrefs = {
      faction: 'castron',
      aiFaction: 'castron',
      diff: 'normal',
      theme: 'wasteland',
      size: 400,
      ...loadJson(PREF_KEY, {}),
    });
    const okFac = (f) => f === 'random' || (RTS_FACTIONS[f] && RTS_FACTIONS[f].avail);
    if (!okFac(P.faction)) P.faction = 'castron';
    if (!okFac(P.aiFaction)) P.aiFaction = 'castron';
    if (!RTS_THEMES[P.theme]) P.theme = 'wasteland';
    if (!this.rtsMenuSizes().some((z) => z.size === P.size)) P.size = 400;
    if (!RTS_DIFFS.some((d) => d.id === P.diff)) P.diff = 'normal';
    P.seed = Math.floor(Math.random() * 1e9);
    this.rtsHelpTab = null;
    this.state = 'rtsmenu';
    this.showScreen('rtsMenu');
    this.rtsMenuRender();
    // 預覽要等畫面出來再算（建 World 要一點時間）
    setTimeout(() => this.state === 'rtsmenu' && this.rtsMenuPreview(), 30);
  },
  rtsMenuHowto(f) {
    return RTS_HOWTO[f] || '';
  },
  // 地圖大小的選項（C 包的 RTS_SIZES 還沒有時用這裡的）
  rtsMenuSizes() {
    const L = Object.values(RTS_SIZES || {}).map((z) => ({
      ...(SIZES.find((x) => x.size === z.size) || {}),
      ...z,
    }));
    return L.length ? L.sort((a, b) => a.size - b.size) : SIZES;
  },
  rtsMenuRender() {
    const el = document.getElementById('rtsMenu');
    if (!el) return;
    const P = this.rtsPrefs;
    const recs = loadRec();
    const rec = (P.faction !== 'random' &&
      P.aiFaction !== 'random' &&
      recs[recKey(P.faction, P.aiFaction, P.diff)]) || { w: 0, l: 0 };
    const D = RTS_DIFFS.find((d) => d.id === P.diff) || {};
    const recTxt =
      P.faction === 'random' || P.aiFaction === 'random'
        ? '戰績：隨機陣營（依實際的陣營記錄）'
        : `戰績（${facName(P.faction)} 對 ${facName(P.aiFaction)}・${D.name || P.diff}）：${rec.w} 勝 ${rec.l} 敗`;
    const fac = (sel, id) =>
      Object.entries(RTS_FACTIONS)
        .map(
          ([k, F]) =>
            `<button type="button" class="rtsFac${k === sel ? ' on' : ''}" data-${id}="${k}"${F.avail ? '' : ' disabled'} title="${escHtml(F.style + '（' + F.leader + '）' + (F.avail ? '' : '：之後的分期'))}">${escHtml(F.name)}</button>`,
        )
        .join('') +
      `<button type="button" class="rtsFac rtsFacRand${sel === 'random' ? ' on' : ''}" data-${id}="random" title="從可以選的陣營隨機挑一個（依種子固定）">隨機</button>`;
    // 陣營的說明（3 行特色）
    const traits = (f) => {
      const F = RTS_FACTIONS[f];
      if (!F) return '<p class="dim rtsFacTraits">從可以選的陣營隨機挑一個（同一個種子結果相同）</p>';
      return `<ul class="dim rtsFacTraits">${(F.traits || [F.style]).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
    };
    const aiStyle = (f) => {
      const F = RTS_FACTIONS[f];
      return F ? `<p class="dim rtsAiStyle">${escHtml(F.style + '（' + F.leader + '）')}</p>` : '';
    };
    const sizes = this.rtsMenuSizes();
    const Z = sizes.find((z) => z.size === P.size) || sizes[sizes.length - 1];
    el.innerHTML = `
      <div class="panel rtsMenuPanel">
        <h2>Coral 戰爭 <small>遭遇戰 — 1 對 1</small></h2>
        <div class="rtsMenuGrid">
          <div class="rtsMenuOpts">
            <h3>你的陣營</h3>
            <div class="rtsFacs" data-padtabs="[data-pf]">${fac(P.faction, 'pf')}</div>
            ${traits(P.faction)}
            <h3>電腦對手</h3>
            <div class="rtsFacs">${fac(P.aiFaction, 'af')}</div>
            ${aiStyle(P.aiFaction)}
            <div class="row">
              <label>難度 <select id="rtsDiff">${RTS_DIFFS.map((d) => `<option value="${d.id}"${d.id === P.diff ? ' selected' : ''}>${escHtml(d.name)}</option>`).join('')}</select></label>
            </div>
            <p class="dim rtsDiffDesc">${escHtml(D.desc || DIFF_DESC[P.diff] || '')}</p>
            <h3>地圖</h3>
            <div class="row">
              <label>主題 <select id="rtsTheme">${Object.entries(RTS_THEMES)
                .map(
                  ([k, T]) =>
                    `<option value="${k}"${k === P.theme ? ' selected' : ''}>${escHtml(T.name)}</option>`,
                )
                .join('')}</select></label>
              <label>大小 <select id="rtsSize">${sizes
                .map(
                  (z) =>
                    `<option value="${z.size}"${z.size === P.size ? ' selected' : ''}>${escHtml(z.name)}（${z.size} m）</option>`,
                )
                .join('')}</select></label>
            </div>
            <p class="dim rtsSizeDesc">${escHtml(Z.desc || '')}</p>
            <div class="row">
              <label>種子 <input id="rtsSeed" value="${P.seed}" size="11" inputmode="numeric" /></label>
              <button type="button" id="rtsReroll" title="換一張地圖">重抽</button>
              <button type="button" id="rtsPrevBtn" title="依種子重新預覽">預覽</button>
            </div>
            <p class="dim rtsRec">${escHtml(recTxt)}</p>
          </div>
          <div class="rtsPrev">
            <img id="rtsPrevImg" alt="地圖預覽" />
            <div id="rtsPrevInfo" class="dim">產生地圖中…</div>
          </div>
        </div>
        <div class="row">
          <button type="button" class="primary" id="rtsGo">開始</button>
          <button type="button" id="rtsHelpBtn" title="操作、資源、相剋與陣營的說明">說明</button>
          <button type="button" id="rtsBack">回標題</button>
        </div>
        <p class="dim" style="font-size: 11px">
          左鍵選取、拖曳框選；右鍵移動／攻擊／採集；指令卡的快捷鍵 Q W E R／A S D F／Z X C V；Ctrl＋數字編隊；Esc 選單。
          局內不寫存檔（沒有 COAM 與經驗），只記勝敗。
        </p>
      </div>
      <div id="rtsHelp" class="rtsHelp" hidden></div>`;
    const $ = (id) => document.getElementById(id);
    for (const b of el.querySelectorAll('[data-pf]'))
      b.onclick = () => {
        P.faction = b.dataset.pf;
        this.rtsMenuSave();
        this.rtsMenuRender();
      };
    for (const b of el.querySelectorAll('[data-af]'))
      b.onclick = () => {
        P.aiFaction = b.dataset.af;
        this.rtsMenuSave();
        this.rtsMenuRender();
      };
    $('rtsDiff').onchange = (e) => {
      P.diff = e.target.value;
      this.rtsMenuSave();
      this.rtsMenuRender();
    };
    $('rtsTheme').onchange = (e) => {
      P.theme = e.target.value;
      this.rtsMenuSave();
      this.rtsMenuPreview();
    };
    $('rtsSize').onchange = (e) => {
      P.size = +e.target.value || 400;
      this.rtsMenuSave();
      this.rtsMenuRender();
      this.rtsMenuPreview();
    };
    $('rtsSeed').onchange = (e) => {
      P.seed = Math.abs(parseInt(e.target.value, 10) || 0) >>> 0;
      this.rtsMenuPreview();
    };
    $('rtsReroll').onclick = () => {
      P.seed = Math.floor(Math.random() * 1e9);
      $('rtsSeed').value = P.seed;
      this.rtsMenuPreview();
    };
    $('rtsPrevBtn').onclick = () => this.rtsMenuPreview();
    $('rtsHelpBtn').onclick = () => this.rtsMenuHelp(true);
    $('rtsGo').onclick = () => {
      P.seed = Math.abs(parseInt($('rtsSeed').value, 10) || 0) >>> 0;
      this.rtsMenuGo();
    };
    $('rtsBack').onclick = () => {
      this.clearMission();
      this.state = 'title';
      this.showScreen('title');
    };
    if (this.rtsPrevUrl && this.rtsPrevKey === this.rtsKeyOf(P)) {
      $('rtsPrevImg').src = this.rtsPrevUrl;
      $('rtsPrevInfo').textContent = this.rtsPrevTxt || '';
    }
    if (this.rtsHelpTab) this.rtsMenuHelp(true, this.rtsHelpTab);
  },
  // 依選單的設定開局（「再來一場」也走這裡）
  rtsMenuGo() {
    const P = this.rtsPrefs;
    this.rtsStart({
      theme: P.theme,
      seed: P.seed >>> 0,
      size: P.size || 400,
      faction: P.faction,
      aiFaction: P.aiFaction,
      diff: P.diff,
    });
  },
  // 說明頁（選單上的疊加視窗；分頁＝LB／RB，「關閉」＝B）
  rtsMenuHelp(on, tab) {
    const el = document.getElementById('rtsHelp');
    if (!el) return;
    if (!on) {
      el.hidden = true;
      this.rtsHelpTab = null;
      const b = document.getElementById('rtsHelpBtn');
      if (b && this.padUiFocus && this.puEl) this.padUiFocus(b, true);
      return;
    }
    tab = tab || this.rtsHelpTab || 'ops';
    this.rtsHelpTab = tab;
    el.hidden = false;
    el.innerHTML = `
      <div class="panel rtsHelpPanel">
        <h2>Coral 戰爭：說明</h2>
        <div class="rtsHelpTabs" data-padtabs="button">
          ${HELP_TABS.map(([k, n]) => `<button type="button" data-ht="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}
        </div>
        <div class="rtsHelpBody">${helpHtml(tab)}</div>
        <div class="row"><button type="button" class="primary" id="rtsHelpClose">關閉</button></div>
      </div>`;
    for (const b of el.querySelectorAll('[data-ht]')) b.onclick = () => this.rtsMenuHelp(true, b.dataset.ht);
    document.getElementById('rtsHelpClose').onclick = () => this.rtsMenuHelp(false);
  },
  rtsMenuSave() {
    const P = this.rtsPrefs;
    saveJson(PREF_KEY, {
      ...loadJson(PREF_KEY, {}),
      faction: P.faction,
      aiFaction: P.aiFaction,
      diff: P.diff,
      theme: P.theme,
      size: P.size || 400,
    });
  },
  rtsKeyOf(P) {
    return `${P.theme}|${P.seed >>> 0}|${P.size || 400}`;
  },
  // 俯視縮圖（rts-preview.js 的 rtsMapPreview：建 World 並從正上方算繪）；建好的 World 留著，開始時沿用
  rtsMenuPreview() {
    const P = this.rtsPrefs;
    const info = document.getElementById('rtsPrevInfo');
    // 同一張地圖已經建好：只還原圖與文字（開選單時排的預覽可能比改大小的晚執行，不能把文字蓋回「產生地圖中…」）
    if (
      this.rtsPrevUrl &&
      this.rtsPrevKey === this.rtsKeyOf(P) &&
      this._rtsPrevW &&
      this._rtsPrevW === this.world
    ) {
      const img = document.getElementById('rtsPrevImg');
      if (img) img.src = this.rtsPrevUrl;
      if (info) info.textContent = this.rtsPrevTxt || '';
      return;
    }
    if (info) info.textContent = '產生地圖中…';
    // 連續改設定時只算最後一次
    const req = (this._rtsPrevReq = (this._rtsPrevReq || 0) + 1);
    setTimeout(() => {
      if (this.state !== 'rtsmenu' || req !== this._rtsPrevReq) return;
      const key = this.rtsKeyOf(P);
      let r;
      try {
        r = this.rtsMapPreview(P.seed >>> 0, { theme: P.theme, size: P.size || 400 });
      } catch (err) {
        console.warn('RTS 地圖預覽失敗', err);
        const inf = document.getElementById('rtsPrevInfo');
        if (inf) inf.textContent = '這張地圖產生失敗，換一個種子';
        return;
      }
      this.rtsPreviewClear();
      this._rtsPrevW = this.world;
      this.rtsPrevKey = this._rtsPrevK = key;
      this.rtsPrevUrl = r.url;
      this.rtsPrevTxt = `${r.ok ? '' : '（檢查未通過）'}${sizeName(P.size || 400)}・礦脈 ${r.mines}・Coral ${r.corals}・野怪營地 ${r.camps}・通道 ${r.lanes}`;
      const img = document.getElementById('rtsPrevImg');
      if (img) img.src = r.url;
      const inf = document.getElementById('rtsPrevInfo');
      if (inf) inf.textContent = this.rtsPrevTxt;
      // 背景：從斜上方看整張地圖（依大小）
      const k = (P.size || 400) / 400;
      const cam = this.camera;
      cam.position.set(0, 260 * k, 300 * k);
      cam.lookAt(0, 0, 0);
      cam.far = 1600;
      cam.updateProjectionMatrix();
    }, 20);
  },

  // ---------- 結果畫面 ----------
  rtsShowResult() {
    const R = this.rts;
    R.shown = true;
    if (this.rtsHudTimeline) this.rtsHudTimeline(true); // 最後一筆
    if (this.rtsHudHide) this.rtsHudHide();
    if (this.rtsTipsHide) this.rtsTipsHide();
    this.state = 'rtsend';
    this.showScreen('rtsEnd');
    const el = document.getElementById('rtsEnd');
    const S = R.stats;
    const row = (name, a, b) => `<tr><td>${name}</td><td>${a}</td><td>${b}</td></tr>`;
    const facTxt = (i) =>
      escHtml(facName(R.teams[i].faction) + (R.cfg.rand && R.cfg.rand[i] ? '（隨機）' : ''));
    const sur = !!(R.over && R.over.surrender);
    const title = R.over.win ? '勝利' : sur ? '敗北（投降）' : '敗北';
    const D = RTS_DIFFS.find((d) => d.id === R.cfg.diff) || {};
    const T = RTS_THEMES[R.cfg.theme] || {};
    const tl = this.rtsMenuTl();
    const charts = tl.pts.length >= 2;
    el.innerHTML = `
      <div class="panel rtsEndPanel">
        <h2 id="rtsEndTitle" style="color:${R.over.win ? '#7ee081' : '#ff6a5a'}">${title}</h2>
        <p class="dim">作戰時間 ${fmtT(R.over.t)}・${escHtml(T.name || R.cfg.theme)}（${escHtml(sizeName(R.cfg.size || 400))}）・${escHtml(D.name || R.cfg.diff)}${sur ? '・<span class="rtsSurTag">投降</span>' : ''}</p>
        <div class="rtsEndGrid">
          <table class="rtsEndTbl">
            <tr><th></th><th>你</th><th>電腦</th></tr>
            ${row('陣營', facTxt(ME), facTxt(1))}
            ${row('生產的單位', S[0].made, S[1].made)}
            ${row('建造的建築', S[0].blds, S[1].blds)}
            ${row('擊破', S[0].killed, S[1].killed)}
            ${row('損失', S[0].lost, S[1].lost)}
            ${row('採集的礦石', Math.round(S[0].ore), Math.round(S[1].ore))}
            ${row('抽取的 Coral', Math.round(S[0].coral), Math.round(S[1].coral))}
            ${S[0].fused || S[1].fused ? row('融合用掉的單位', S[0].fused, S[1].fused) : ''}
            ${S[0].drops || S[1].drops || S[0].dropLost || S[1].dropLost ? row('空投（成功／被擊落）', `${S[0].drops}／${S[0].dropLost}`, `${S[1].drops}／${S[1].dropLost}`) : ''}
            ${R.salvage ? row('拾荒（礦石／零件）', `${Math.round(S[0].salvOre || 0)}／${Math.round(S[0].salvParts || 0)}`, `${Math.round(S[1].salvOre || 0)}／${Math.round(S[1].salvParts || 0)}`) : ''}
            ${R.salvage ? row('改裝', S[0].refits || 0, S[1].refits || 0) : ''}
          </table>
          <div class="rtsCharts">
            ${
              charts
                ? `<div class="rtsChart"><h4>累計收入 <small class="dim">礦石＋2.5×Coral</small></h4><canvas id="rtsChartInc"></canvas></div>
            <div class="rtsChart"><h4>部隊人口</h4><canvas id="rtsChartPop"></canvas></div>
            <p class="dim rtsChartKey"><i style="background:${hex(RTS_TEAM_COLORS[0])}"></i>你　<i style="background:${hex(RTS_TEAM_COLORS[1])}"></i>電腦　┆ 升階　✕ 英雄陣亡</p>`
                : '<p class="dim">作戰時間太短，沒有時間軸。</p>'
            }
          </div>
        </div>
        <div class="row">
          <button type="button" class="primary" id="rtsEndAgain" title="同樣的陣營、難度、主題與大小，換一張地圖">再來一場</button>
          <button type="button" id="rtsEndMenu">回 Coral 戰爭選單</button>
          <button type="button" id="rtsEndTitleBtn">回標題</button>
        </div>
      </div>`;
    if (charts) {
      this.rtsMenuChart(document.getElementById('rtsChartInc'), tl, 'inc');
      this.rtsMenuChart(document.getElementById('rtsChartPop'), tl, 'pop');
    }
    const cfg = R.cfg;
    document.getElementById('rtsEndAgain').onclick = () => this.rtsMenuAgain(cfg);
    document.getElementById('rtsEndMenu').onclick = () => this.rtsMenuOpen();
    document.getElementById('rtsEndTitleBtn').onclick = () => {
      this.clearMission();
      this.state = 'title';
      this.showScreen('title');
    };
  },
  // 再來一場：同樣的陣營（隨機的照樣隨機）、難度、主題、大小，新的種子
  rtsMenuAgain(cfg) {
    const P = (this.rtsPrefs = {
      ...loadJson(PREF_KEY, {}),
      faction: cfg.rand && cfg.rand[0] ? 'random' : cfg.faction,
      aiFaction: cfg.rand && cfg.rand[1] ? 'random' : cfg.aiFaction,
      diff: cfg.diff,
      theme: cfg.theme,
      size: cfg.size || 400,
    });
    P.seed = Math.floor(Math.random() * 1e9);
    if (this.rts) this.clearMission();
    this.rtsMenuGo();
  },
  // 時間軸的正規化：{ pts: [{ t, v: [{ inc, pop, tier, hero }, …兩隊] }], ev: [{ t, team, k: 'tier'|'die', v }] }
  // 來源：R.timeline（A 包；每筆 { t, teams: [{ ore, coral, pop, str, tier, hero }] }，欄位名稱寬鬆地讀）或 R.tlHud（E 的備援）
  rtsMenuTl() {
    const R = this.rts;
    const src = R && (R.timeline && R.timeline.length ? R.timeline : R.tlHud && R.tlHud.pts);
    const num = (...v) => {
      for (const x of v) if (typeof x === 'number' && isFinite(x)) return x;
      return 0;
    };
    const pts = [];
    for (const s of src || []) {
      if (!s) continue;
      const arr = s.teams || s.v || s.s || [s[0], s[1]];
      if (!arr || !arr[0]) continue;
      pts.push({
        t: num(s.t),
        v: [0, 1].map((i) => {
          const x = arr[i] || {};
          const inc = x.inc && typeof x.inc === 'object' ? x.inc : x;
          return {
            inc: num(inc.ore) + 2.5 * num(inc.coral),
            pop: num(x.pop, x.army, x.armyPop),
            str: num(x.str, x.power),
            tier: num(x.tier) || 1,
            hero: num(x.hero, x.heroLv),
          };
        }),
      });
    }
    pts.sort((a, b) => a.t - b.t);
    const ev = [];
    // 升階：取樣之間層級變高（R.tlHud 有精確時間時用它）
    // 事件：A 包的 R.timelineEv（k 'tier'｜'hero'＝英雄陣亡）優先，沒有時用 R.tlHud 的
    const evA = (R && R.timelineEv) || [];
    const evH = (R && R.tlHud && R.tlHud.ev) || [];
    for (const e of evA.length ? evA : evH)
      if (e && typeof e.t === 'number') ev.push(e.k === 'hero' ? { ...e, k: 'die' } : e);
    for (let i = 1; i < pts.length; i++)
      for (const tm of [0, 1]) {
        const a = pts[i - 1].v[tm].tier,
          b = pts[i].v[tm].tier;
        if (b > a && !ev.some((e) => e.k === 'tier' && e.team === tm && e.v === b))
          ev.push({ t: pts[i].t, team: tm, k: 'tier', v: b });
      }
    return { pts, ev };
  },
  // 折線圖（canvas）：k＝'inc' 累計收入、'pop' 部隊人口；兩隊兩色，升階＝虛線、英雄陣亡＝✕
  rtsMenuChart(cv, tl, k) {
    if (!cv) return;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.max(200, cv.clientWidth || 300),
      H = Math.max(90, cv.clientHeight || 120);
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const pad = { l: 34, r: 8, t: 8, b: 16 };
    const t1 = Math.max(60, tl.pts[tl.pts.length - 1].t);
    let vmax = 1;
    for (const p of tl.pts) for (const v of p.v) vmax = Math.max(vmax, v[k]);
    vmax = Math.max(vmax, k === 'pop' ? 12 : 300) * 1.08;
    const X = (t) => pad.l + (t / t1) * (W - pad.l - pad.r);
    const Y = (v) => H - pad.b - (v / vmax) * (H - pad.t - pad.b);
    c.font = '10px Chakra Petch, sans-serif';
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    c.fillStyle = 'rgba(220,230,240,0.6)';
    c.lineWidth = 1;
    // 橫線與刻度
    for (let i = 0; i <= 3; i++) {
      const v = (vmax / 1.08) * (i / 3);
      const y = Math.round(Y(v)) + 0.5;
      c.beginPath();
      c.moveTo(pad.l, y);
      c.lineTo(W - pad.r, y);
      c.stroke();
      c.textAlign = 'right';
      c.fillText(v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v)), pad.l - 4, y + 3);
    }
    // 時間刻度（每 5 分鐘）
    c.textAlign = 'center';
    const step = t1 > 1500 ? 600 : t1 > 600 ? 300 : 60;
    for (let t = step; t <= t1; t += step) c.fillText(fmtT(t), X(t), H - 4);
    // 升階：虛線（隊伍色）
    for (const e of tl.ev) {
      if (e.k !== 'tier') continue;
      const x = Math.round(X(e.t)) + 0.5;
      c.save();
      c.setLineDash([3, 3]);
      c.strokeStyle = hex(RTS_TEAM_COLORS[e.team] || 0xffffff);
      c.globalAlpha = 0.7;
      c.beginPath();
      c.moveTo(x, pad.t);
      c.lineTo(x, H - pad.b);
      c.stroke();
      c.restore();
      c.fillStyle = hex(RTS_TEAM_COLORS[e.team] || 0xffffff);
      c.fillText('T' + e.v, x, pad.t + 8 + e.team * 10);
    }
    // 兩隊的線
    for (const tm of [1, 0]) {
      c.strokeStyle = hex(RTS_TEAM_COLORS[tm]);
      c.lineWidth = 2;
      c.beginPath();
      tl.pts.forEach((p, i) => (i ? c.lineTo(X(p.t), Y(p.v[tm][k])) : c.moveTo(X(p.t), Y(p.v[tm][k]))));
      c.stroke();
    }
    // 英雄陣亡：✕ 在底線
    c.lineWidth = 1.6;
    for (const e of tl.ev) {
      if (e.k !== 'die') continue;
      const x = X(e.t),
        y = H - pad.b - 5 - e.team * 7;
      c.strokeStyle = hex(RTS_TEAM_COLORS[e.team] || 0xffffff);
      c.beginPath();
      c.moveTo(x - 3, y - 3);
      c.lineTo(x + 3, y + 3);
      c.moveTo(x + 3, y - 3);
      c.lineTo(x - 3, y + 3);
      c.stroke();
    }
  },
  // 結果圖的取樣（HUD 每格呼叫；final＝結束時的最後一筆）：A 包的 R.timeline 有在取樣時只記事件（升階、英雄陣亡）
  rtsHudTimeline(final) {
    const R = this.rts;
    if (!R || !R.teams) return;
    const H = R.tlHud || (R.tlHud = { pts: [], ev: [], next: 0, tier: [1, 1], dead: [0, 0] });
    const t = R.t || 0;
    // 事件：層級變高、英雄陣亡（每格比對，便宜）
    for (const tm of [0, 1]) {
      const T = R.teams[tm];
      if (!T) continue;
      const tier = (this.rtsTier ? this.rtsTier(tm) : T.tech && T.tech.tier) || 1;
      if (tier > H.tier[tm]) H.ev.push({ t, team: tm, k: 'tier', v: tier });
      H.tier[tm] = tier;
      const dead = (T.heroes || []).filter((h) => h && (h.st === 'dead' || (h.ent && h.ent.dead))).length;
      if (dead > H.dead[tm]) H.ev.push({ t, team: tm, k: 'die' });
      H.dead[tm] = dead;
    }
    if (H.ev.length > 200) H.ev.splice(0, H.ev.length - 200);
    if (R.timeline && R.timeline.length && !final) return; // A 包有取樣
    if (!final && t < H.next) return;
    H.next = Math.floor(t / TL_DT) * TL_DT + TL_DT;
    const stats = R.stats || [];
    const v = [0, 1].map((tm) => {
      let pop = 0,
        str = 0,
        hero = 0;
      for (const e of R.units) {
        if (e.dead || e.rtsTeam !== tm || e.bld || e.rtsQuiet || e.rtsIllus || e.rtsTemp) continue;
        const D = RTS_DEFS[e.rtsDef] || {};
        if (e.hero) hero = Math.max(hero, e.hero.lv || 1);
        if (D.worker || e.hero) continue;
        pop += D.pop || 0;
        str += Math.sqrt(Math.max(0, e.hp) * (D.dps || 0));
      }
      const S = stats[tm] || {};
      return {
        ore: S.ore || 0,
        coral: S.coral || 0,
        pop,
        str: Math.round(str),
        tier: H.tier[tm],
        hero,
      };
    });
    const last = H.pts[H.pts.length - 1];
    if (last && last.t === t) H.pts.pop();
    H.pts.push({ t, teams: v });
    if (H.pts.length > TL_MAX) H.pts.splice(0, H.pts.length - TL_MAX);
  },
});
