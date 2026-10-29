// Game：主線的戰術模組（data/modules.js）——三選一（出口獎勵）、補給區段的商店、延續到整章結束
// 持有的模組存在 save.story.mods＝{ chapter, list: [{ id, lv }] }；紀錄點另外保存一份（失敗重試時還原）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SORTIES } from '../data/campaign.js';
import { MODULES, MOD_TIPS, modFxCompare, modLabel, modOffer, modsPm } from '../data/modules.js';
import { BRIEFINGS, FACTIONS } from '../data/story.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // 目前這一章持有的模組（換章時清空）
  campMods(chapter) {
    if (this.camp && this.camp.replay) return (this.camp.rmods = this.camp.rmods || []); // 作戰紀錄的重打
    const st = this.campStory();
    if (!st.mods || typeof st.mods !== 'object' || !Array.isArray(st.mods.list))
      st.mods = { chapter: 0, list: [] };
    if (chapter && st.mods.chapter !== chapter) st.mods = { chapter, list: [] };
    st.mods.list = st.mods.list.filter((m) => MODULES[m.id]);
    return st.mods.list;
  },
  campSetMods(list) {
    if (this.camp && this.camp.replay) {
      this.camp.rmods = list.map((m) => ({ ...m }));
      return;
    }
    const st = this.campStory();
    st.mods = { chapter: (st.mods && st.mods.chapter) || 0, list: list.map((m) => ({ ...m })) };
  },
  // 玩家機體的加成：駕駛員（PvE）＋模組
  campPilotPm() {
    const pm = { ...(this.pilotLocalMods('pve') || { pf: {} }) };
    const mp = modsPm(this.campMods());
    for (const k in mp) pm[k] = (pm[k] || 0) + mp[k];
    return pm;
  },
  // 改變打法的模組：擊破時（mission.js 的 onEnemyKilled，房主／單機）
  modKillFx(e, from) {
    const kb = from.pmv('killBlast');
    if (kb > 0) {
      // 連鎖殉爆：爆炸再擊破的敵人也會爆炸
      const c = e.center();
      this.explodeAt(c, Math.min(e.maxHp * 0.35, 2600) * kb, 700 * kb, (6 + kb * 2) * this.fx.k, from, false);
      this.fx.shockwave(c, 6 + kb * 2, 0xff8030, 0.35);
    }
    const ks = from.pmv('killStag');
    if (ks > 0) {
      const R = (8 + ks * 2) * this.fx.k;
      this.fx.shockwave(e.center(), R / this.fx.k, 0x9fd8ff, 0.4);
      for (const h of this.enemies) {
        if (h.dead || h === e || h.isBoss || h.ai === 'objective' || h.pos.distanceTo(e.pos) > R) continue;
        h.acs = h.acsMax;
        h.staggerT = Math.max(h.staggerT, 1.6);
        this.netEv({ t: 'stag', i: h.id });
      }
    }
  },
  // 整章的出擊都完成時清空模組
  campChapterCheck(chapter) {
    const st = this.campStory();
    // 依陣營抉擇不會出現的出擊、周目限定的委託（BRIEFINGS 的 cycle）不算
    const all = Object.keys(SORTIES).filter(
      (sid) =>
        SORTIES[sid].chapter === chapter &&
        this.hubSortieState(sid) !== 'hidden' &&
        !(BRIEFINGS[sid] && BRIEFINGS[sid].cycle),
    );
    if (all.every((sid) => st.done[sid])) {
      st.mods = { chapter: chapter + 1, list: [] };
      return true;
    }
    return false;
  },
  // ---------- 三選一 ----------
  // 打開選擇畫面（遊戲暫停）；faction＝null 時任意委託方
  campOpenPick(faction, title) {
    const opts = modOffer(this.campMods(), faction, Math.random);
    if (this.autoPickMod) return opts.length && this.campTakeMod(opts[0]); // 冒煙測試：直接選第一個
    if (!opts.length) return this.flashMsg('沒有可以選的模組（全部已滿級）', 0x8a97a6, 2);
    if (!(this.net && this.net.role)) {
      // 單人暫停；多人不暫停（其他玩家還在打）
      this.modPrev = this.state;
      this.state = 'modpick';
    }
    this.modOpts = opts;
    SFX.cue('mod');
    const $ = (id) => document.getElementById(id);
    const F = FACTIONS[faction];
    $('mpTitle').textContent = title || (F ? `${F.name} 提供的戰術模組` : '戰術模組');
    $('mpSub').textContent = '選一個（從下一個區段開始生效，延續到這一章結束）';
    $('mpCards').innerHTML = opts.map((o, i) => this.modCardHtml(o, i, '選擇')).join('');
    $('mpDuo').innerHTML = this.guideDuoHtml(faction);
    $('mpSkip').textContent = '略過';
    $('mpSkip').style.display = '';
    $('modPick').classList.add('on');
    for (const b of $('mpCards').querySelectorAll('button[data-i]'))
      b.onclick = () => this.campTakeMod(this.modOpts[Number(b.dataset.i)]);
  },
  modCardHtml(o, i, btn, price) {
    const M = MODULES[o.id];
    const F = M.faction === 'duo' ? null : FACTIONS[M.faction];
    const col = F ? F.color : '#ff8ad8';
    const tag = M.faction === 'duo' ? `雙重：${M.need.map((f) => FACTIONS[f].short).join('＋')}` : F.short;
    // 白話效果、數值（升級時前後比較）、對目前武器的適用性
    const fit = this.guideFit(o.id);
    const vals = modFxCompare(o.id, o.lv)
      .map((t) => `<div>${escHtml(t)}</div>`)
      .join('');
    return `<div class="mpCard" style="border-color:${col}"><div class="mpTag" style="color:${col}">${escHtml(tag)}${o.lv > 1 ? `　強化 Lv${o.lv - 1} → Lv${o.lv}` : '　新'}</div><b>${escHtml(M.name)} Lv${o.lv}</b><div class="mpTip">${escHtml(MOD_TIPS[o.id] || M.desc)}</div><div class="dim">${vals}</div>${fit ? `<div class="mpFit${fit.bad ? ' bad' : ''}">${escHtml(fit.txt)}</div>` : ''}<button data-i="${i}"${price && this.save.coam < price ? ' disabled' : ''}>${escHtml(btn)}${price ? `（${price.toLocaleString()} COAM）` : ''}</button></div>`;
  },
  campTakeMod(o) {
    if (!o) return this.campClosePick();
    const list = this.campMods().slice();
    const cur = list.find((m) => m.id === o.id);
    if (cur) cur.lv = o.lv;
    else list.push({ id: o.id, lv: o.lv });
    this.campSetMods(list);
    this.writeSave();
    SFX.ui();
    this.flashMsg(`取得戰術模組：${modLabel(o.id, o.lv)}`, 0xffd060, 2.6);
    this.campClosePick();
  },
  campClosePick() {
    document.getElementById('modPick').classList.remove('on');
    if (this.state === 'modpick') {
      this.state = this.modPrev === 'modpick' ? 'play' : this.modPrev || 'play';
      this.lastT = performance.now();
    }
    // 排隊的三選一（Boss 擊破評價 S 的獎勵，boss-tier.js）
    if (this.modPickQ && this.modPickQ.length) {
      const f = this.modPickQ.shift();
      setTimeout(() => this.campOpenPick(f, 'Boss 擊破評價 S 的獎勵'), 300);
    }
    this.campChoicePendShow(); // 排隊的抉擇說明卡（guide.js）
    this.fpRelock(); // 追尾／第一人稱：選完直接回到瞄準（first-person.js）
  },
  // ---------- 商店（補給區段） ----------
  campOpenShop() {
    const L = this.campLevel();
    const price = Math.round((7000 + L * 1500) / 100) * 100;
    const opts = modOffer(this.campMods(), null, Math.random, 2);
    if (!opts.length || this.autoPickMod) return;
    if (!(this.net && this.net.role)) {
      // 單人暫停；多人不暫停（其他玩家還在打）
      this.modPrev = this.state;
      this.state = 'modpick';
    }
    this.modOpts = opts;
    SFX.cue('mod');
    const $ = (id) => document.getElementById(id);
    $('mpTitle').textContent = '補給站的商店';
    $('mpSub').textContent = `用 COAM 購買戰術模組（持有 ${this.save.coam.toLocaleString()} COAM）`;
    $('mpCards').innerHTML = opts.map((o, i) => this.modCardHtml(o, i, '購買', price)).join('');
    $('mpDuo').innerHTML = this.guideDuoHtml(null);
    $('mpSkip').textContent = '略過';
    $('mpSkip').style.display = '';
    $('modPick').classList.add('on');
    for (const b of $('mpCards').querySelectorAll('button[data-i]'))
      b.onclick = () => {
        if (this.save.coam < price) return;
        this.save.coam -= price;
        this.campTakeMod(this.modOpts[Number(b.dataset.i)]);
      };
  },
  // 客機：房主送來的選項（自己選、回報房主；price＝商店價格，自己付 COAM）
  campShowPick(opts, title, onPick, price) {
    if (!opts.length) return;
    if (this.autoPickMod) return onPick(opts[0]);
    const $ = (id) => document.getElementById(id);
    this.modOpts = opts;
    $('mpTitle').textContent = title;
    $('mpSub').textContent = price
      ? `用 COAM 購買（持有 ${this.save.coam.toLocaleString()} COAM）`
      : '選一個（從下一個區段開始生效，延續到這一章結束）';
    $('mpCards').innerHTML = opts
      .map((o, i) => this.modCardHtml(o, i, price ? '購買' : '選擇', price))
      .join('');
    const f0 = opts[0] && MODULES[opts[0].id] && MODULES[opts[0].id].faction;
    $('mpDuo').innerHTML = this.guideDuoHtml(!price && f0 && f0 !== 'duo' ? f0 : null);
    $('mpSkip').textContent = '略過';
    $('modPick').classList.add('on');
    for (const b of $('mpCards').querySelectorAll('button[data-i]'))
      b.onclick = () => {
        if (price) {
          if (this.save.coam < price) return;
          this.save.coam -= price;
          this.writeSave();
        }
        SFX.ui();
        onPick(this.modOpts[Number(b.dataset.i)]);
        this.campClosePick();
      };
  },
  // 持有模組的一覽（轉場畫面、車庫整備、機庫）
  campModsHtml() {
    const list = this.campMods();
    if (!list.length) return '<span class="dim">戰術模組：尚未取得</span>';
    return (
      '<span class="dim">戰術模組：</span>' +
      list
        .map((m) => {
          const M = MODULES[m.id];
          const F = M.faction === 'duo' ? null : FACTIONS[M.faction];
          return `<span class="modChip" style="border-color:${F ? F.color : '#ff8ad8'}" title="${escHtml(modLabel(m.id, m.lv))}">${escHtml(M.name)} ${m.lv}</span>`;
        })
        .join('') +
      this.guideModsSum()
    );
  },
});
