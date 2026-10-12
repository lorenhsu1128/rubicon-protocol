// Game：主線的說明——陣營抉擇的說明卡、出口光環的文字、模組卡片的適用性與雙重模組提示、作戰室的委託方面板
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { CHOICES, EXIT_REWARDS, SORTIES } from '../data/campaign.js';
import { ACES } from '../data/foes.js';
import { MODULES, MOD_TIPS, modFit, modsSumText } from '../data/modules.js';
import { asmParts } from '../data/parts.js';
import { BRIEFINGS, FACTIONS } from '../data/story.js';
import { Game } from './game.js';

const sortieShort = (sid) => SORTIES[sid].name.split(' — ')[1] || SORTIES[sid].name;

Object.assign(Game.prototype, {
  // 目前裝備的武器定義（右手、左手、右肩、左肩）
  guideWeapons() {
    const P = asmParts(this.save.asm);
    return [P.rarm, P.larm, P.rback, P.lback];
  },
  // 這個模組適用性的文字與等級：null＝和武器無關
  guideFit(id) {
    const f = modFit(id, this.guideWeapons());
    if (!f) return null;
    if (!f.n) return { bad: true, txt: '⚠ 你目前的武器都用不到' };
    return { bad: false, txt: `適用：你的 ${f.total} 把武器中 ${f.n} 把` };
  },
  // 某家委託方的模組有幾種對目前的武器無效（出口光環的警告）
  guideFactionMiss(faction) {
    const ids = Object.keys(MODULES).filter((id) => MODULES[id].faction === faction);
    return ids.filter((id) => {
      const f = modFit(id, this.guideWeapons());
      return f && !f.n;
    }).length;
  },
  // 出口獎勵的效果文字（L＝下一段的等級，用來算資金與經驗）
  guideReward(reward, L) {
    const R = EXIT_REWARDS[reward] || EXIT_REWARDS.coam;
    if (reward === 'coam')
      return L
        ? `${R.icon} 資金 +${(Math.round((4000 + L * 1500) / 100) * 100).toLocaleString()}`
        : `${R.icon} 資金`;
    if (reward === 'xp') return L ? `${R.icon} 經驗 +${120 + L * 30}` : `${R.icon} 經驗`;
    if (reward === 'repair') return `${R.icon} 修理：AP＋35%・彈藥＋35%`;
    const F = FACTIONS[R.faction];
    return `${R.icon} ${R.name}（${F ? F.style : ''}）`;
  },
  // 陣營抉擇的一個選項會帶來什麼：開放的出擊、再登場的宿敵、是否決定結局
  campChoiceInfo(chId, key) {
    const CH = CHOICES[chId];
    const o = CH && CH.opts.find((q) => q.key === key);
    if (!o) return null;
    const routes = Object.keys(BRIEFINGS).filter(
      (sid) => SORTIES[sid] && BRIEFINGS[sid].when && BRIEFINGS[sid].when[chId] === key,
    );
    const aces = [];
    for (const sid in SORTIES) {
      for (const sg of SORTIES[sid].segs) {
        let a = null;
        if (sg.ace && typeof sg.ace === 'object') a = sg.ace[key];
        else if (sg.ace && routes.includes(sid)) a = sg.ace;
        if (a && ACES[a] && !aces.includes(ACES[a].name)) aces.push(ACES[a].name);
      }
    }
    return { o, F: FACTIONS[o.faction], routes, aces, ending: chId === 'c6' };
  },
  // 抉擇說明卡（出口出現時；單人暫停，多人不暫停）。三選一還開著時等它關掉再顯示
  campChoiceCard(chId, keys) {
    const CH = CHOICES[chId];
    if (!CH) return;
    if (this.autoPickMod) return (this.lastChoiceCard = chId); // 冒煙測試：不擋住流程
    const $ = (id) => document.getElementById(id);
    if ($('modPick').classList.contains('on')) return (this.choicePend = [chId, keys]);
    const opts = CH.opts.filter((o) => !keys || keys.includes(o.key));
    if (!(this.net && this.net.role)) {
      this.modPrev = this.state;
      this.state = 'modpick';
    }
    this.modOpts = [];
    SFX.cue('phase');
    $('mpTitle').textContent = `⚑ ${CH.name}`;
    $('mpSub').textContent = '走進其中一個出口＝做出選擇。這一周目選了就不能更改（下一周目可以重選）。';
    $('mpCards').innerHTML = opts
      .map((o) => {
        const I = this.campChoiceInfo(chId, o.key);
        const col = I.F.color;
        const rows = [
          `<div class="mpTip">${escHtml(o.sub)}</div>`,
          `<div class="dim">獎勵：${escHtml(I.F.name)}的戰術模組（${escHtml(I.F.style)}）三選一</div>`,
        ];
        if (I.routes.length)
          rows.push(
            `<div class="dim">開放的出擊：${I.routes.map((s) => `「${escHtml(sortieShort(s))}」`).join('、')}</div>`,
          );
        if (I.aces.length)
          rows.push(`<div class="dim">之後再登場的宿敵：${escHtml(I.aces.join('、'))}</div>`);
        if (I.ending) rows.push('<div class="mpFit bad">這個選擇決定結局</div>');
        else rows.push('<div class="mpFit bad">另一條路線的出擊在這一周目不會出現</div>');
        return `<div class="mpCard" style="border-color:${col}"><div class="mpTag" style="color:${col}">${escHtml(I.F.short)}</div><b>${escHtml(o.name)}</b>${rows.join('')}</div>`;
      })
      .join('');
    $('mpDuo').innerHTML = '';
    $('mpSkip').textContent = '了解，前往選擇';
    $('mpSkip').style.display = '';
    $('modPick').classList.add('on');
  },
  // 三選一關掉之後補上排隊的抉擇說明卡
  campChoicePendShow() {
    const p = this.choicePend;
    if (!p) return;
    this.choicePend = null;
    this.campChoiceCard(p[0], p[1]);
  },
  // 三選一下方的雙重模組提示：faction＝這次的委託方（null＝看持有的）
  guideDuoHtml(faction) {
    const have = new Set(
      this.campMods()
        .map((m) => MODULES[m.id] && MODULES[m.id].faction)
        .filter((f) => f && f !== 'duo'),
    );
    const facs = faction ? [faction] : [...have];
    const rows = [];
    for (const id in MODULES) {
      const M = MODULES[id];
      if (M.faction !== 'duo' || !M.need.some((f) => facs.includes(f))) continue;
      const ok = M.need.every((f) => have.has(f) || f === faction);
      const miss = M.need.filter((f) => !(have.has(f) || f === faction)).map((f) => FACTIONS[f].short);
      rows.push(
        `<span class="modChip${ok ? ' ok' : ''}" style="border-color:#ff8ad8" title="${escHtml(MOD_TIPS[id] || '')}">${ok ? '✓' : '＋' + escHtml(miss.join('＋'))} ${escHtml(M.name)}</span>`,
      );
    }
    if (!rows.length) return '';
    return `<div class="dim">雙重模組：同時持有兩家的模組後，三選一有機會出現（✓＝條件已滿足）</div>${rows.join('')}`;
  },
  // 持有模組的合計（作戰室、轉場、整備）
  guideModsSum() {
    const t = modsSumText(this.campMods());
    return t.length ? `<div class="dim modSum">合計：${escHtml(t.join('・'))}</div>` : '';
  },
  // 總覽圖節點的說明（滑過時的 title、點選鎖住的節點時）
  guideNodeInfo(sid) {
    const B = BRIEFINGS[sid],
      so = SORTIES[sid];
    const out = [so.name];
    const s = this.hubSortieState(sid);
    if (s === 'locked') {
      const need = (B.needs || [])
        .filter((n) => !this.campStory().done[n])
        .map((n) => `「${sortieShort(n)}」`);
      if (need.length) out.push(`需要先完成：${need.join('、')}`);
      if (B.needsAny && !B.needsAny.some((n) => this.campStory().done[n]))
        out.push(`需要先完成其中一個：${B.needsAny.map((n) => `「${sortieShort(n)}」`).join('、')}`);
    }
    if (B.when)
      for (const k in B.when) {
        const CH = CHOICES[k],
          o = CH && CH.opts.find((q) => q.key === B.when[k]);
        if (o) out.push(`路線：${CH.name.split('：')[0]}選了「${o.name}」`);
      }
    const ch = so.segs.find((sg) => sg.choice);
    if (ch && CHOICES[ch.choice]) {
      const CH = CHOICES[ch.choice];
      out.push(`⚑ 這次出擊有${CH.name.split('：')[0]}：${CH.opts.map((o) => o.name).join('／')}`);
    }
    if (B.cycle) out.push(`第 ${B.cycle} 周目起的委託`);
    return out;
  },
  // ---------- 作戰室的委託方面板 ----------
  hubFactions(open) {
    const el = document.getElementById('hubFacBox');
    el.style.display = open ? '' : 'none';
    if (!open) return;
    SFX.ui();
    const st = this.campStory();
    const held = new Map(this.campMods().map((m) => [m.id, m.lv]));
    const picks = {};
    for (const k in st.choices) {
      const CH = CHOICES[k],
        o = CH && CH.opts.find((q) => q.key === st.choices[k]);
      if (o) (picks[o.faction] = picks[o.faction] || []).push(`${CH.name.split('：')[0]}「${o.name}」`);
    }
    const modRow = (id) => {
      const M = MODULES[id],
        lv = held.get(id);
      const fit = this.guideFit(id);
      return `<div class="facMod${lv ? ' held' : ''}"><b>${escHtml(M.name)}</b>${lv ? ` <span class="modChip">持有 Lv${lv}</span>` : ''}<span class="dim">${escHtml(MOD_TIPS[id] || M.desc)}${fit && fit.bad ? '　' + escHtml(fit.txt) : ''}</span></div>`;
    };
    let h = '';
    for (const f in FACTIONS) {
      const F = FACTIONS[f];
      const ids = Object.keys(MODULES).filter((id) => MODULES[id].faction === f);
      h += `<div class="facSec" style="border-color:${F.color}"><div class="facHead"><b style="color:${F.color}">${escHtml(F.name)}</b><span class="dim">${escHtml(F.short)}・${escHtml(F.style)}的模組</span></div>`;
      h += `<div class="dim">你的抉擇：${picks[f] ? escHtml(picks[f].join('、')) : '還沒有選過它'}</div>`;
      h += ids.map(modRow).join('') + '</div>';
    }
    const duos = Object.keys(MODULES).filter((id) => MODULES[id].faction === 'duo');
    h += `<div class="facSec" style="border-color:#ff8ad8"><div class="facHead"><b style="color:#ff8ad8">雙重模組</b><span class="dim">同時持有兩家的模組時，三選一有機會出現</span></div>`;
    h += duos
      .map((id) => {
        const M = MODULES[id],
          lv = held.get(id);
        return `<div class="facMod${lv ? ' held' : ''}"><b>${escHtml(M.name)}</b>${lv ? ` <span class="modChip">持有 Lv${lv}</span>` : ''}<span class="dim">${escHtml(M.need.map((x) => FACTIONS[x].short).join('＋'))}：${escHtml(MOD_TIPS[id] || M.desc)}</span></div>`;
      })
      .join('');
    h += '</div>';
    document.getElementById('hubFacList').innerHTML = h;
  },
});
