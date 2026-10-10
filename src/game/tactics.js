// Game：主線的戰術模組（data/modules.js）——三選一（出口獎勵）、補給區段的商店、延續到整章結束
// 持有的模組存在 save.story.mods＝{ chapter, list: [{ id, lv }] }；紀錄點另外保存一份（失敗重試時還原）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { SORTIES } from '../data/campaign.js';
import { MODULES, modLabel, modOffer, modsPm } from '../data/modules.js';
import { FACTIONS } from '../data/story.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // 目前這一章持有的模組（換章時清空）
  campMods(chapter) {
    const st = this.campStory();
    if (!st.mods || typeof st.mods !== 'object' || !Array.isArray(st.mods.list))
      st.mods = { chapter: 0, list: [] };
    if (chapter && st.mods.chapter !== chapter) st.mods = { chapter, list: [] };
    st.mods.list = st.mods.list.filter((m) => MODULES[m.id]);
    return st.mods.list;
  },
  campSetMods(list) {
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
  // 整章的出擊都完成時清空模組
  campChapterCheck(chapter) {
    const st = this.campStory();
    const all = Object.keys(SORTIES).filter((sid) => SORTIES[sid].chapter === chapter);
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
    this.modPrev = this.state;
    this.state = 'modpick';
    this.modOpts = opts;
    const $ = (id) => document.getElementById(id);
    const F = FACTIONS[faction];
    $('mpTitle').textContent = title || (F ? `${F.name} 提供的戰術模組` : '戰術模組');
    $('mpSub').textContent = '選一個（從下一個區段開始生效，延續到這一章結束）';
    $('mpCards').innerHTML = opts.map((o, i) => this.modCardHtml(o, i, '選擇')).join('');
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
    return `<div class="mpCard" style="border-color:${col}"><div class="mpTag" style="color:${col}">${escHtml(tag)}${o.lv > 1 ? '　強化' : '　新'}</div><b>${escHtml(M.name)}</b><div class="dim">${escHtml(modLabel(o.id, o.lv))}</div><button data-i="${i}"${price && this.save.coam < price ? ' disabled' : ''}>${escHtml(btn)}${price ? `（${price.toLocaleString()} COAM）` : ''}</button></div>`;
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
    if (this.state !== 'modpick') return;
    this.state = this.modPrev === 'modpick' ? 'play' : this.modPrev || 'play';
    this.lastT = performance.now();
  },
  // ---------- 商店（補給區段） ----------
  campOpenShop() {
    const L = this.campLevel();
    const price = Math.round((7000 + L * 1500) / 100) * 100;
    const opts = modOffer(this.campMods(), null, Math.random, 2);
    if (!opts.length || this.autoPickMod) return;
    this.modPrev = this.state;
    this.state = 'modpick';
    this.modOpts = opts;
    const $ = (id) => document.getElementById(id);
    $('mpTitle').textContent = '補給站的商店';
    $('mpSub').textContent = `用 COAM 購買戰術模組（持有 ${this.save.coam.toLocaleString()} COAM）`;
    $('mpCards').innerHTML = opts.map((o, i) => this.modCardHtml(o, i, '購買', price)).join('');
    $('mpSkip').style.display = '';
    $('modPick').classList.add('on');
    for (const b of $('mpCards').querySelectorAll('button[data-i]'))
      b.onclick = () => {
        if (this.save.coam < price) return;
        this.save.coam -= price;
        this.campTakeMod(this.modOpts[Number(b.dataset.i)]);
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
        .join('')
    );
  },
});
