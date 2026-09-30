// Game：駕駛員畫面——技能樹配點、免費重置、配置預設組（每模式 5 組）、武器熟練度
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { SLOTS, partById } from '../data/parts.js';
import {
  WEAPON_IDS,
  canDec,
  canInc,
  decSkill,
  gateReason,
  incSkill,
  pointsAt,
  profProgress,
  sanitizeSkills,
  spentPoints,
  weaponPart,
  xpProgress,
} from '../data/pilot.js';
import { BRANCHES, PROF_MAX, SKILLS, skillView } from '../data/skills.js';
import { Game } from './game.js';

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const MODE_NAME = { pve: 'PvE', pvp: 'PvP' };

Object.assign(Game.prototype, {
  openPilot() {
    this.pilotMode = this.pilotCtxMode();
    this.pilotBindUi();
    this.showScreen('pilot');
    this.renderPilot();
  },
  closePilot() {
    this.showScreen('garage');
    this.renderGarage();
  },
  pilotBindUi() {
    if (this._pilotBound) return;
    this._pilotBound = true;
    const $ = (id) => document.getElementById(id);
    $('btnPilotBack').onclick = () => {
      SFX.ui();
      this.closePilot();
    };
    $('btnPilotReset').onclick = () => {
      const P = this.save.pilot[this.pilotMode];
      if (!spentPoints(P.skills)) return;
      P.skills = {};
      this.writeSave();
      SFX.ui();
      this.renderPilot();
    };
    for (const m of ['pve', 'pvp'])
      $('pMode_' + m).onclick = () => {
        this.pilotMode = m;
        SFX.ui();
        this.renderPilot();
      };
  },
  renderPilot() {
    const mode = this.pilotMode || 'pve';
    const P = this.save.pilot[mode];
    const pr = xpProgress(P.xp);
    const total = pointsAt(pr.level),
      spent = spentPoints(P.skills);
    const $ = (id) => document.getElementById(id);
    for (const m of ['pve', 'pvp']) $('pMode_' + m).classList.toggle('sel', m === mode);
    $('pLevel').innerHTML =
      `<div class="pLv">Lv <b>${pr.level}</b> <span class="dim">${MODE_NAME[mode]} 駕駛員</span></div>` +
      `<div class="xpBar"><i style="width:${pr.need ? clamp((pr.into / pr.need) * 100, 0, 100) : 100}%"></i></div>` +
      `<div class="dim">${pr.need ? `經驗 ${Math.floor(pr.into).toLocaleString()} / ${pr.need.toLocaleString()}` : '已達等級上限'}</div>` +
      `<div class="pPts">技能點 剩餘 <b id="pPtsLeft">${total - spent}</b> / 共 ${total}</div>`;
    $('btnPilotReset').disabled = !spent;
    // 技能樹
    const tree = $('pTree');
    tree.innerHTML = '';
    for (const br of BRANCHES) {
      const col = document.createElement('div');
      col.className = 'pBranch';
      const brSpent = SKILLS.filter((s) => s.br === br.id).reduce((a, s) => a + (P.skills[s.id] || 0), 0);
      col.innerHTML = `<div class="pBrHead">${br.name}<span class="dim">${brSpent} 點</span></div>`;
      for (const s of SKILLS.filter((x) => x.br === br.id)) {
        const v = skillView(s, mode);
        const r = P.skills[s.id] || 0;
        const gate = gateReason(P.skills, s.id);
        const node = document.createElement('div');
        node.className =
          'pNode' + (r ? ' on' : '') + (r >= s.max ? ' max' : '') + (gate && !r ? ' locked' : '');
        node.dataset.skill = s.id;
        const now = r ? v.desc(r) : '尚未習得';
        const next = r < s.max ? v.desc(r + 1) : '';
        node.innerHTML =
          `<div class="pNTop"><span class="pT">T${s.tier}</span><b>${v.name}</b><span class="pR">${r} / ${s.max}</span></div>` +
          `<div class="pD">${now}</div>` +
          (next ? `<div class="pD next">下一級：${next}</div>` : '') +
          (gate && !r ? `<div class="pD lock">🔒 ${gate}</div>` : '') +
          `<div class="pBtns"><button class="pDec" ${canDec(P.skills, s.id, pr.level) ? '' : 'disabled'}>−</button><button class="pInc primary" ${canInc(P.skills, s.id, pr.level) ? '' : 'disabled'}>＋</button></div>`;
        node.querySelector('.pInc').onclick = () => {
          if (!canInc(P.skills, s.id, pr.level)) return;
          P.skills = incSkill(P.skills, s.id);
          this.writeSave();
          SFX.ui();
          this.renderPilot();
        };
        node.querySelector('.pDec').onclick = () => {
          if (!canDec(P.skills, s.id, pr.level)) return;
          P.skills = decSkill(P.skills, s.id);
          this.writeSave();
          SFX.ui();
          this.renderPilot();
        };
        col.appendChild(node);
      }
      tree.appendChild(col);
    }
    this.renderPilotPresets();
    this.renderPilotProf();
  },
  // ---------- 配置預設組 ----------
  renderPilotPresets() {
    const mode = this.pilotMode;
    const P = this.save.pilot[mode];
    const box = document.getElementById('pPresets');
    box.innerHTML = '';
    P.presets.forEach((pr, i) => {
      const row = document.createElement('div');
      row.className = 'pPreset';
      const sum = pr
        ? `${partById('arm', pr.asm.rarm).name.split(' ')[0]}／${partById('arm', pr.asm.larm).name.split(' ')[0]}・${spentPoints(pr.skills)} 點`
        : '（空）';
      row.innerHTML =
        `<input class="pName" maxlength="16" placeholder="預設組 ${i + 1}">` +
        `<span class="dim pSum">${esc(sum)}</span>` +
        `<div class="pBtns"><button class="pSave">儲存目前</button><button class="pLoad primary" ${pr ? '' : 'disabled'}>載入</button><button class="pClr" ${pr ? '' : 'disabled'}>清除</button></div>`;
      const name = row.querySelector('.pName');
      name.value = pr ? pr.name : '';
      name.onchange = () => {
        if (!P.presets[i]) return;
        P.presets[i].name = name.value.trim().slice(0, 16);
        this.writeSave();
      };
      row.querySelector('.pSave').onclick = () => this.pilotPresetSave(i, name.value);
      row.querySelector('.pLoad').onclick = () => this.pilotPresetLoad(i);
      row.querySelector('.pClr').onclick = () => this.pilotPresetClear(i);
      box.appendChild(row);
    });
  },
  pilotPresetSave(i, name) {
    const P = this.save.pilot[this.pilotMode];
    P.presets[i] = {
      name:
        String(name || '')
          .trim()
          .slice(0, 16) || `預設組 ${i + 1}`,
      asm: { ...this.save.asm },
      skills: { ...P.skills },
      t: Date.now(),
    };
    this.writeSave();
    SFX.ui();
    this.flashMsg(`已儲存到「${P.presets[i].name}」`, 0x7ee081, 1.2);
    this.renderPilot();
  },
  pilotPresetLoad(i) {
    const P = this.save.pilot[this.pilotMode];
    const pr = P.presets[i];
    if (!pr) return;
    // 所有零件都必須擁有且存在
    const missing = [];
    for (const [key, , cat] of SLOTS) {
      const id = pr.asm[key];
      const part = id && partById(cat, id);
      if (!id || !part || part.id !== id || !this.save.owned.includes(id)) missing.push(id || key);
    }
    if (missing.length) {
      this.flashMsg('無法載入：缺少零件 ' + missing.join('、'), 0xff4d4d, 2);
      return;
    }
    this.save.asm = { ...pr.asm };
    P.skills = sanitizeSkills(pr.skills, xpProgress(P.xp).level);
    this.writeSave();
    SFX.ui();
    this.flashMsg(`已載入「${pr.name}」`, 0x7ee081, 1.2);
    this.renderPilot();
  },
  pilotPresetClear(i) {
    this.save.pilot[this.pilotMode].presets[i] = null;
    this.writeSave();
    SFX.ui();
    this.renderPilot();
  },
  // ---------- 武器熟練度 ----------
  renderPilotProf() {
    const P = this.save.pilot[this.pilotMode];
    const ids = this.save.owned.filter((id) => WEAPON_IDS.has(id));
    ids.sort((a, b) => (P.prof[b] || 0) - (P.prof[a] || 0));
    document.getElementById('pProf').innerHTML = ids
      .map((id) => {
        const p = weaponPart(id);
        const pg = profProgress(P.prof[id]);
        const pips = '◆'.repeat(pg.lv) + '◇'.repeat(PROF_MAX - pg.lv);
        const next = pg.lv < PROF_MAX ? `下一級：${this.pilotProfText(p.type, pg.lv + 1)}` : '已達最高熟練度';
        return (
          `<div class="pProfRow"><div class="pNTop"><b>${p.name}</b><span class="pR">${pips}</span></div>` +
          `<div class="xpBar thin"><i style="width:${pg.need ? clamp((pg.into / pg.need) * 100, 0, 100) : 100}%"></i></div>` +
          `<div class="pD dim">${next}</div></div>`
        );
      })
      .join('');
  },
});
