// Game：駕駛員畫面（docs/pilot-ui.md）——圖示節點的技能樹（按住投點、右鍵／X 退點）、詳細列、
// 機體數值（沒有配點／目前／投點之後）、配置預設組的卡片（每模式 5 組）、武器熟練度的徽章
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { effectiveAp } from '../data/firepower.js';
import { SLOTS, START_ASM, asmStats, jumpSpec, partById } from '../data/parts.js';
import {
  WEAPON_IDS,
  applyPilotStats,
  canDec,
  canInc,
  computePilotMods,
  decSkill,
  gateReason,
  incSkill,
  pilotPayload,
  pointsAt,
  profProgress,
  sanitizeSkills,
  spentPoints,
  weaponPart,
  xpProgress,
} from '../data/pilot.js';
import { BRANCHES, PROF_MAX, SKILLS, TIER_REQ, skillView } from '../data/skills.js';
import { hexScores } from '../data/garage-hex.js';
import { hexSvg } from '../render/garage-charts.js';
import { partIcon } from '../render/garage-icons.js';
import { branchIcon, skillIcon } from '../render/pilot-icons.js';
import { Game } from './game.js';

const MODE_NAME = { pve: 'PvE', pvp: 'PvP' };
const HOLD = 0.45; // 按住幾秒投一點
const fmt = (v) => Math.round(v).toLocaleString();
// 機體數值：[鍵, 名稱, 格式, 越小越好, 會影響它的技能效果]
const STAT_ROWS = [
  ['sus', '持續火力', fmt, false, ['dmg', 'rld', 'mag', 'mDmg', 'mEn', 'enWpn', 'chg']],
  ['burst', '瞬間火力', fmt, false, ['dmg', 'mDmg', 'enWpn']],
  ['ap', 'AP', fmt, false, ['ap']],
  ['eap', '有效 AP', fmt, false, ['ap', 'def']],
  ['stab', '姿態穩定', fmt, false, ['stab']],
  ['spd', '地面速度', (v) => v.toFixed(1), false, ['spd']],
  ['qb', 'QB 速度', fmt, false, ['qb']],
  ['qbc', 'QB 消耗', fmt, true, ['qbc']],
  ['jump', '跳躍高度', (v) => v.toFixed(1) + ' m', false, ['jump']],
  ['enCap', 'EN 容量', fmt, false, ['enCap']],
  ['rch', 'EN 回復', fmt, false, ['rch']],
  ['dly', '回復延遲', (v) => v.toFixed(2) + ' s', true, ['dly']],
  ['lock', '鎖定距離', (v) => Math.round(v) + ' m', false, ['lock']],
];
const STAT_FX = new Set(STAT_ROWS.flatMap((r) => r[4]));
// 「目前 → 下一級」：兩段說明的數字以外相同時，只把變動的數字標出來
function diffDesc(a, b) {
  const re = /([+−-]?\d+(?:\.\d+)?(?:%| 秒)?)/;
  const A = a.split(re),
    B = b.split(re);
  const same = A.length === B.length && A.every((t, i) => i % 2 || t === B[i]);
  if (!same) return `${escHtml(a)} <span class="pTo">→</span> <b class="up">${escHtml(b)}</b>`;
  return A.map((t, i) =>
    i % 2 === 0
      ? escHtml(t)
      : t === B[i]
        ? t
        : `<s>${t}</s> <span class="pTo">→</span> <b class="up">${B[i]}</b>`,
  ).join('');
}
// 說明裡的數字標成綠色（還沒習得時）
const greenNums = (t) => escHtml(t).replace(/([+−-]?\d+(?:\.\d+)?(?:%| 秒)?)/g, '<b class="up">$1</b>');

Object.assign(Game.prototype, {
  openPilot() {
    this.pilotMode = this.pilotCtxMode();
    document.getElementById('btnPilotBack').textContent = this.pilotFromHub ? '返回作戰室' : '返回機甲庫';
    this.pilotBindUi();
    this.showScreen('pilot');
    this.pSel = this.pSel || 'g_dmg';
    this.pHover = null;
    this.renderPilot();
  },
  closePilot() {
    this.pilotHoldStop();
    if (this.pilotFromHub) {
      this.pilotFromHub = false;
      return this.openHub(); // 從主線機庫開的
    }
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
      this.uiConfirm(
        `把 ${MODE_NAME[this.pilotMode]} 駕駛員的 ${spentPoints(P.skills)} 點全部退回？（免費）`,
        () => {
          P.skills = {};
          this.writeSave();
          SFX.ui();
          this.renderPilot();
        },
        '全部重置',
      );
    };
    for (const m of ['pve', 'pvp'])
      $('pMode_' + m).onclick = () => {
        this.pilotMode = m;
        SFX.ui();
        this.renderPilot();
      };
    addEventListener('resize', () => this.pilotOn() && this.pilotLinks());
    // 放開滑鼠＝停止投點（在節點外放開也算）
    addEventListener('pointerup', () => this.pHoldSrc === 'ptr' && this.pilotHoldStop());
    addEventListener('pointercancel', () => this.pHoldSrc === 'ptr' && this.pilotHoldStop());
  },
  // 駕駛員畫面開著（state 照舊是機甲庫或作戰室）
  pilotOn() {
    const el = document.getElementById('pilot');
    return !!el && el.classList.contains('on');
  },
  pilotP() {
    return this.save.pilot[this.pilotMode || 'pve'];
  },
  pilotLevel() {
    return xpProgress(this.pilotP().xp).level;
  },
  renderPilot() {
    const mode = this.pilotMode || 'pve';
    const P = this.save.pilot[mode];
    const pr = xpProgress(P.xp);
    const total = pointsAt(pr.level),
      spent = spentPoints(P.skills);
    const $ = (id) => document.getElementById(id);
    for (const m of ['pve', 'pvp']) $('pMode_' + m).classList.toggle('sel', m === mode);
    const f = pr.need ? clamp(pr.into / pr.need, 0, 1) : 1;
    $('pLevel').innerHTML =
      `<svg viewBox="0 0 40 40" class="pLvRing" aria-hidden="true"><circle cx="20" cy="20" r="16" class="bg"/><circle cx="20" cy="20" r="16" class="fg" pathLength="100" stroke-dasharray="${(f * 100).toFixed(1)} 100" transform="rotate(-90 20 20)"/><text x="20" y="25" text-anchor="middle">${pr.level}</text></svg>` +
      `<div class="pLvT"><div class="pLv">Lv <b>${pr.level}</b> <span class="dim">${MODE_NAME[mode]} 駕駛員</span></div>` +
      `<div class="xpBar"><i style="width:${(f * 100).toFixed(1)}%"></i></div>` +
      `<div class="dim">${pr.need ? `經驗 ${Math.floor(pr.into).toLocaleString()} / ${pr.need.toLocaleString()}` : '已達等級上限'}</div></div>`;
    $('pPts').innerHTML =
      `<span>技能點</span><b id="pPtsLeft">${total - spent}</b><span class="dim">/ ${total}</span>`;
    $('pPts').classList.toggle('has', total - spent > 0);
    $('btnPilotReset').disabled = !spent;
    if (this.pTreeMode !== mode || !$('pTree').querySelector('.pNode')) this.pilotTreeBuild();
    this.pilotTreeUpdate();
    this.renderPilotPresets();
    this.renderPilotProf();
  },
  // ---------- 技能樹 ----------
  pilotTreeBuild() {
    const mode = this.pilotMode || 'pve';
    this.pTreeMode = mode;
    const tree = document.getElementById('pTree');
    tree.replaceChildren();
    const svgNs = 'http://www.w3.org/2000/svg';
    const links = document.createElementNS(svgNs, 'svg');
    links.id = 'pLinks';
    tree.appendChild(links);
    BRANCHES.forEach((br, ci) => {
      const col = ci + 1;
      const head = document.createElement('div');
      head.className = 'pBrHead';
      head.dataset.br = br.id;
      head.style.gridColumn = col;
      head.style.gridRow = 1;
      head.innerHTML = `${branchIcon(br.id)}<b>${br.name}</b><span class="pBrN"></span>`;
      tree.appendChild(head);
      const list = SKILLS.filter((s) => s.br === br.id);
      // 門檻列（T2、T3）
      for (const [tier, row] of [
        [2, 3],
        [3, 5],
      ]) {
        const g = document.createElement('div');
        g.className = 'pGate';
        g.dataset.br = br.id;
        g.dataset.tier = tier;
        g.style.gridColumn = col;
        g.style.gridRow = row;
        tree.appendChild(g);
      }
      for (const tier of [1, 2, 3]) {
        const cell = document.createElement('div');
        cell.className = 'pCell t' + tier;
        cell.style.gridColumn = col;
        cell.style.gridRow = tier * 2;
        for (const s of list.filter((x) => x.tier === tier)) {
          const v = skillView(s, mode);
          const b = document.createElement('button');
          b.className = 'pNode t' + tier;
          b.dataset.skill = s.id;
          b.title = v.name;
          b.innerHTML = `<span class="pRing"></span><span class="pHold"></span>${skillIcon(s.id, s.br)}<span class="pRk"></span><span class="srOnly">${escHtml(v.name)}</span>`;
          b.onpointerenter = () => this.pilotHover(s.id);
          b.onpointerleave = () => this.pilotHover(null);
          b.onfocus = () => this.pilotHover(s.id);
          b.onclick = () => this.pilotSelect(s.id);
          b.onpointerdown = (e) => {
            this.pPtrType = e.pointerType;
            if (e.button !== 0) return;
            this.pilotSelect(s.id, true);
            this.pilotHoldStart(s.id, 'ptr');
          };
          b.oncontextmenu = (e) => {
            e.preventDefault();
            // 觸控／觸控筆長按也會觸發 contextmenu：按住投點時不能變成退點（退點用「退一點」按鈕）
            if (this.pPtrType === 'touch' || this.pPtrType === 'pen' || this.pHoldSrc === 'ptr') return;
            this.pilotDec(s.id);
          };
          // 手把（pad-ui.js）：按住 A＝投點、X＝退一點
          b.padHold = (down) => this.pilotPadHold(s.id, down);
          b.padDec = () => this.pilotDec(s.id);
          cell.appendChild(b);
        }
        tree.appendChild(cell);
      }
    });
    requestAnimationFrame(() => this.pilotLinks());
  },
  // 節點的狀態、門檻列、分支點數
  pilotTreeUpdate() {
    const mode = this.pilotMode || 'pve';
    const P = this.pilotP();
    const L = this.pilotLevel();
    const left = pointsAt(L) - spentPoints(P.skills);
    for (const s of SKILLS) {
      const el = document.querySelector(`#pTree .pNode[data-skill="${s.id}"]`);
      if (!el) continue;
      const r = P.skills[s.id] || 0;
      const gate = gateReason(P.skills, s.id);
      el.classList.toggle('on', r > 0);
      el.classList.toggle('max', r >= s.max);
      el.classList.toggle('locked', !!gate && !r);
      el.classList.toggle('can', left > 0 && canInc(P.skills, s.id, L));
      el.classList.toggle('sel', this.pSel === s.id);
      // 外圈：每一級一段弧
      const segs = [];
      const gap = s.max > 1 ? 6 : 0,
        len = (100 - gap * s.max) / s.max;
      for (let i = 0; i < s.max; i++)
        segs.push(
          `<circle cx="20" cy="20" r="18" pathLength="100" class="${i < r ? 'on' : ''}" stroke-dasharray="${len.toFixed(2)} ${(100 - len).toFixed(2)}" stroke-dashoffset="${(-(i * (len + gap)) + 25 - gap / 2).toFixed(2)}"/>`,
        );
      el.querySelector('.pRing').innerHTML =
        `<svg viewBox="0 0 40 40" aria-hidden="true">${segs.join('')}</svg>`;
      el.querySelector('.pRk').textContent = `${r}/${s.max}`;
      el.title = `${skillView(s, mode).name}　${r}/${s.max}`;
    }
    for (const br of BRANCHES) {
      const n = SKILLS.filter((s) => s.br === br.id).reduce((a, s) => a + (P.skills[s.id] || 0), 0);
      const h = document.querySelector(`#pTree .pBrHead[data-br="${br.id}"] .pBrN`);
      if (h) h.textContent = n;
      for (const tier of [2, 3]) {
        const g = document.querySelector(`#pTree .pGate[data-br="${br.id}"][data-tier="${tier}"]`);
        if (!g) continue;
        const low = SKILLS.filter((s) => s.br === br.id && s.tier < tier).reduce(
          (a, s) => a + (P.skills[s.id] || 0),
          0,
        );
        const need = TIER_REQ[tier];
        g.classList.toggle('ok', low >= need);
        g.innerHTML = `<span>${low >= need ? '✓' : `${Math.min(low, need)}／${need}`}</span>`;
        g.title = `T${tier}：本分支前段投入 ${need} 點`;
      }
    }
    this.pilotLinks();
    this.pilotInfoUi();
    this.pilotStatsUi();
  },
  // 節點之間的連線（排版後量位置）：T1→T2（同一側）、T2→T3；T3 的前置技能那一條加粗
  pilotLinks() {
    const tree = document.getElementById('pTree');
    const svg = document.getElementById('pLinks');
    if (!tree || !svg || !tree.offsetParent) return;
    const tr = tree.getBoundingClientRect();
    svg.setAttribute('width', tree.scrollWidth);
    svg.setAttribute('height', tree.scrollHeight);
    const P = this.pilotP();
    const pos = {};
    for (const el of tree.querySelectorAll('.pNode')) {
      const r = el.getBoundingClientRect();
      pos[el.dataset.skill] = [
        r.left + r.width / 2 - tr.left + tree.scrollLeft,
        r.top + r.height / 2 - tr.top + tree.scrollTop,
        r.width / 2,
      ];
    }
    let h = '';
    const line = (a, b, cls) => {
      const A = pos[a],
        B = pos[b];
      if (!A || !B) return;
      const dx = B[0] - A[0],
        dy = B[1] - A[1],
        d = Math.hypot(dx, dy) || 1;
      const o0 = A[2] + (dy > 0 ? 18 : 3); // 往下的線從級數文字下面開始
      const x0 = A[0] + (dx / d) * o0,
        y0 = A[1] + (dy / d) * o0,
        x1 = B[0] - (dx / d) * (B[2] + 3),
        y1 = B[1] - (dy / d) * (B[2] + 3);
      h += `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}" class="${cls}"/>`;
    };
    for (const br of BRANCHES) {
      const L = SKILLS.filter((s) => s.br === br.id);
      const t1 = L.filter((s) => s.tier === 1),
        t2 = L.filter((s) => s.tier === 2),
        t3 = L.find((s) => s.tier === 3);
      const on = (s) => (P.skills[s.id] || 0) > 0;
      t2.forEach((s, i) => t1[i] && line(t1[i].id, s.id, on(s) ? 'on' : ''));
      if (t3) {
        for (const s of t2) line(s.id, t3.id, on(t3) && on(s) ? 'on' : '');
        if (t3.req) {
          const rq = SKILLS.find((s) => s.id === t3.req);
          // 前置技能：從它沿外側走到 T3（不和 T2 的線重疊時才畫得清楚，所以畫成虛線）
          if (rq && pos[rq.id] && pos[t3.id] && !t2.some((s) => s.id === rq.id)) {
            const A = pos[rq.id],
              B = pos[t3.id];
            const side = A[0] < B[0] ? -1 : 1;
            const xs = A[0] + side * (A[2] + 6);
            h += `<path d="M${(A[0] + side * A[2]).toFixed(1)} ${A[1].toFixed(1)} H${xs.toFixed(1)} V${B[1].toFixed(1)} H${(B[0] + side * (B[2] + 3)).toFixed(1)}" class="req${(P.skills[rq.id] || 0) >= rq.max ? ' on' : ''}"/>`;
          }
        }
      }
    }
    svg.innerHTML = h;
  },
  // 游標停在節點上＝選取它（詳細列的按鈕作用在它）；離開後照舊顯示最後選取的
  pilotHover(id) {
    if (this.pHover === id) return;
    this.pHover = id;
    if (id && this.pSel !== id) {
      this.pSel = id;
      for (const el of document.querySelectorAll('#pTree .pNode'))
        el.classList.toggle('sel', el.dataset.skill === id);
    }
    this.pilotInfoUi();
    this.pilotStatsUi();
  },
  pilotSelect(id, quiet) {
    if (this.pSel !== id) {
      this.pSel = id;
      if (!quiet) SFX.ui();
      for (const el of document.querySelectorAll('#pTree .pNode'))
        el.classList.toggle('sel', el.dataset.skill === id);
    }
    this.pilotInfoUi();
    this.pilotStatsUi();
  },
  pilotFocusId() {
    return this.pHover || this.pSel;
  },
  // ---------- 投點與退點 ----------
  pilotInc(id) {
    const P = this.pilotP();
    const L = this.pilotLevel();
    if (!canInc(P.skills, id, L)) return false;
    P.skills = incSkill(P.skills, id);
    this.writeSave();
    SFX.ui();
    this.renderPilot();
    const el = document.querySelector(`#pTree .pNode[data-skill="${id}"]`);
    if (el) {
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
    return true;
  },
  pilotDec(id) {
    const P = this.pilotP();
    if (!canDec(P.skills, id, this.pilotLevel())) return;
    P.skills = decSkill(P.skills, id);
    this.writeSave();
    SFX.ui();
    this.renderPilot();
  },
  // 按住：每 HOLD 秒投一點（進度圈在節點與詳細列的按鈕上）
  pilotHoldStart(id, src) {
    this.pilotHoldStop();
    const P = this.pilotP();
    if (!canInc(P.skills, id, this.pilotLevel())) return;
    this.pHoldId = id;
    this.pHoldSrc = src;
    this.pHoldT = 0;
    let last = performance.now();
    const tick = (now) => {
      if (this.pHoldId !== id || !this.pilotOn()) return;
      const dt = Math.min(0.5, (now - last) / 1000); // 照實際經過的時間（畫面卡住時也不會變慢）
      last = now;
      this.pHoldT += dt;
      if (this.pHoldT >= HOLD) {
        this.pHoldT = 0;
        if (!this.pilotInc(id) || !canInc(this.pilotP().skills, id, this.pilotLevel())) {
          this.pilotHoldStop();
          return;
        }
      }
      this.pilotHoldShow(this.pHoldT / HOLD);
      this.pHoldRaf = requestAnimationFrame(tick);
    };
    this.pHoldRaf = requestAnimationFrame(tick);
  },
  pilotHoldStop() {
    if (this.pHoldRaf) cancelAnimationFrame(this.pHoldRaf);
    this.pHoldRaf = 0;
    this.pHoldId = null;
    this.pHoldSrc = null;
    this.pilotHoldShow(0);
  },
  pilotHoldShow(k) {
    for (const el of document.querySelectorAll('#pilot .pNode, #pHoldBtn'))
      el.style.setProperty(
        '--hold',
        el.dataset.skill === this.pHoldId || (el.id === 'pHoldBtn' && this.pHoldId) ? k : 0,
      );
  },
  pilotPadHold(id, down) {
    if (down && this.pHoldId !== id) {
      this.pilotSelect(id, true);
      this.pilotHoldStart(id, 'pad');
    } else if (!down && this.pHoldSrc === 'pad') this.pilotHoldStop();
  },
  // ---------- 詳細列 ----------
  pilotInfoUi() {
    const el = document.getElementById('pInfo');
    if (!el) return;
    const id = this.pilotFocusId();
    const s = SKILLS.find((x) => x.id === id);
    if (!s) {
      el.innerHTML = '';
      return;
    }
    const mode = this.pilotMode || 'pve';
    const v = skillView(s, mode);
    const P = this.pilotP();
    const L = this.pilotLevel();
    const r = P.skills[s.id] || 0;
    const gate = gateReason(P.skills, s.id);
    const br = BRANCHES.find((b) => b.id === s.br);
    const pips = Array.from({ length: s.max }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
    const eff =
      r >= s.max ? escHtml(v.desc(r)) : r ? diffDesc(v.desc(r), v.desc(r + 1)) : greenNums(v.desc(1));
    const left = pointsAt(L) - spentPoints(P.skills);
    const why = r >= s.max ? '已滿級' : gate && !r ? gate : !left ? '沒有技能點' : '';
    // 按鈕是同一組（按住的計時在 pointerdown 開始），換技能時只改內容
    if (!el.querySelector('#pHoldBtn')) {
      el.innerHTML = `<div class="pInfoIco"></div><div class="pInfoT"><div class="pInfoH"></div><div class="pInfoE"></div></div><div class="pInfoB"><button id="pHoldBtn" class="primary"><span class="pHold"></span>按住投點</button><button id="pDecBtn">退一點</button></div>`;
      const hb = el.querySelector('#pHoldBtn');
      hb.onpointerdown = (e) => e.button === 0 && this.pilotHoldStart(this.pSel, 'ptr');
      hb.padHold = (down) => this.pilotPadHold(this.pSel, down);
      hb.onclick = () => {};
      el.querySelector('#pDecBtn').onclick = () => this.pilotDec(this.pSel);
    }
    el.classList.toggle('t3', s.tier === 3);
    el.querySelector('.pInfoIco').innerHTML = skillIcon(s.id, s.br);
    el.querySelector('.pInfoH').innerHTML =
      `<b>${escHtml(v.name)}</b><span class="dim">${br.name} · T${s.tier}</span><span class="pPips">${pips}</span>`;
    el.querySelector('.pInfoE').innerHTML =
      `<span>${eff}</span>${why ? `<span class="${gate && !r ? 'lock' : 'dim'}">${gate && !r ? '🔒 ' : ''}${escHtml(why)}</span>` : ''}`;
    // 按鈕作用在選取的技能（游標停在別的節點上時看的是那一個，按鈕仍是選取的）
    const sel = this.pSel;
    el.querySelector('#pHoldBtn').disabled = !canInc(P.skills, sel, L);
    el.querySelector('#pDecBtn').disabled = !canDec(P.skills, sel, L);
  },
  // ---------- 機體數值 ----------
  pilotMods(skills) {
    const mode = this.pilotMode || 'pve';
    const pay = pilotPayload(this.save)[mode];
    return computePilotMods({ ...pay, s: skills }, mode);
  },
  pilotStatVals(pm) {
    const asm = this.save.asm;
    const ef = applyPilotStats(asmStats(asm), pm);
    const F = this.garageFire(asm, pm);
    const P = ef.parts;
    return {
      sus: F.sus,
      burst: F.burst,
      ap: ef.ap,
      eap: effectiveAp(ef.ap, ef.def),
      stab: ef.stab,
      spd: ef.speed,
      qb: P.booster.qb,
      qbc: P.booster.qbCost,
      jump: jumpSpec(P.legs).maxH,
      enCap: ef.enCap,
      rch: P.generator.recharge,
      dly: P.generator.delay,
      lock: ef.lockRange,
    };
  },
  pilotStatsUi() {
    const box = document.getElementById('pStats');
    if (!box) return;
    const P = this.pilotP();
    const L = this.pilotLevel();
    const id = this.pilotFocusId();
    const s = SKILLS.find((x) => x.id === id);
    const nx = s && canInc(P.skills, id, L) ? incSkill(P.skills, id) : null;
    const base = this.pilotStatVals(this.pilotMods({}));
    const cur = this.pilotStatVals(this.pilotMods(P.skills));
    const nxt = nx ? this.pilotStatVals(this.pilotMods(nx)) : null;
    const fx = s ? Object.keys(skillView(s, this.pilotMode || 'pve').fx) : [];
    // 機體的六角性能圖（data/garage-hex.js，和機甲庫的規格頁同一套）：灰＝沒有配點、黃＝目前、虛線＝投點之後
    const asm = this.save.asm;
    const hBase = hexScores(asm, this.pilotMods({})),
      hCur = hexScores(asm, this.pilotMods(P.skills)),
      hNx = nx ? hexScores(asm, this.pilotMods(nx)) : null;
    document.getElementById('pHex').innerHTML = hexSvg(hCur, hNx, true, hBase);
    // 條：灰＝沒有配點、黃＝配點的加成、綠＝投點之後再多的（全長＝沒有配點的 1.4 倍；越小越好的看倒數）
    const rows = STAT_ROWS.map(([k, name, f, low, keys]) => {
      const b = base[k],
        c = cur[k],
        n = nxt ? nxt[k] : c;
      if (!b) return '';
      const q = (v) => (low ? b / Math.max(1e-6, v) : v / b);
      const W = 1.4;
      const wb = 1 / W,
        wc = Math.max(0, q(c) - 1) / W,
        wn = Math.max(0, q(n) - q(c)) / W;
      const bonus = Math.round((q(c) - 1) * 100);
      const chg = Math.abs(n - c) > Math.abs(c) * 1e-4;
      const hot = chg || (s && keys.some((x) => fx.includes(x)));
      return `<div class="pSR${hot ? ' hot' : ''}" data-stat="${k}"><span>${name}</span><span class="pSB"><i style="width:${(Math.min(1, wb) * 100).toFixed(1)}%"></i><b style="width:${(Math.min(1 - wb, wc) * 100).toFixed(1)}%"></b><u style="width:${(Math.min(Math.max(0, 1 - wb - wc), wn) * 100).toFixed(1)}%"></u></span><span class="pSV">${f(c)}${chg ? `<em class="up">→ ${f(n)}</em>` : bonus ? `<em>${low ? '−' : '+'}${bonus}%</em>` : ''}</span></div>`;
    }).join('');
    box.innerHTML = rows;
    // 不影響上面數值的技能
    const mode = this.pilotMode || 'pve';
    const other = SKILLS.filter((x) => (P.skills[x.id] || 0) > 0)
      .map((x) => {
        const v = skillView(x, mode);
        if (Object.keys(v.fx).every((k) => STAT_FX.has(k))) return '';
        return `<span>${skillIcon(x.id, x.br)}${escHtml(v.desc(P.skills[x.id]))}</span>`;
      })
      .filter(Boolean);
    document.getElementById('pOther').innerHTML = other.length
      ? `<div class="pOtH">其他效果</div>${other.join('')}`
      : '';
  },
  // ---------- 配置預設組 ----------
  renderPilotPresets() {
    const mode = this.pilotMode;
    const P = this.save.pilot[mode];
    const box = document.getElementById('pPresets');
    box.innerHTML = '';
    P.presets.forEach((pr, i) => {
      const card = document.createElement('div');
      card.className = 'pPreset' + (pr ? '' : ' empty');
      if (!pr) {
        card.innerHTML = `<span class="pPN">0${i + 1}</span><button class="pSave pNew">＋ 儲存目前的機體</button><input class="pName" maxlength="16" placeholder="預設組 ${i + 1}">`;
        const name = card.querySelector('.pName');
        card.querySelector('.pSave').onclick = () => this.pilotPresetSave(i, name.value);
        box.appendChild(card);
        return;
      }
      const w = (k) => partById('arm', pr.asm[k]);
      const sk = pr.skills || {};
      const hx = hexScores({ ...START_ASM, ...pr.asm }, this.pilotMods(sk)); // 這組的機體＋配點
      card.innerHTML =
        `<button class="pLoad" title="載入「${escHtml(pr.name)}」"><span class="pPN">0${i + 1}</span><span class="pPW">${partIcon('arm', w('rarm'))}${partIcon('arm', w('larm'))}</span><span class="pPHex">${hexSvg(hx, null, false)}</span><span class="pPS">${spentPoints(sk)} 點</span></button>` +
        `<input class="pName" maxlength="16" placeholder="預設組 ${i + 1}">` +
        `<div class="pPBtns"><button class="pSave" title="用目前的機體與配點覆蓋">覆蓋</button><button class="pClr" title="清除">×</button></div>`;
      const name = card.querySelector('.pName');
      name.value = pr.name;
      name.onchange = () => {
        if (!P.presets[i]) return;
        P.presets[i].name = name.value.trim().slice(0, 16) || `預設組 ${i + 1}`;
        this.writeSave();
      };
      card.querySelector('.pLoad').onclick = () => this.pilotPresetLoad(i);
      card.querySelector('.pSave').onclick = () =>
        this.uiConfirm(
          `用目前的機體與配點覆蓋「${pr.name}」？`,
          () => this.pilotPresetSave(i, name.value),
          '覆蓋',
        );
      card.querySelector('.pClr').onclick = () =>
        this.uiConfirm(`清除「${pr.name}」？`, () => this.pilotPresetClear(i), '清除');
      box.appendChild(card);
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
        const f = pg.need ? clamp(pg.into / pg.need, 0, 1) : 1;
        const stars = `${'★'.repeat(pg.lv)}<span class="off">${'★'.repeat(PROF_MAX - pg.lv)}</span>`;
        const next = pg.lv < PROF_MAX ? `下一級 ${this.pilotProfText(p.type, pg.lv + 1)}` : '最高熟練度';
        const cat = PARTS_CAT(p);
        return (
          `<div class="pProfRow${pg.lv >= PROF_MAX ? ' max' : ''}" title="${escHtml(p.name)}"><span class="pPfB"><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" class="bg"/><circle cx="20" cy="20" r="17" class="fg" pathLength="100" stroke-dasharray="${(f * 100).toFixed(1)} 100" transform="rotate(-90 20 20)"/></svg>${partIcon(cat, p)}<i>${pg.lv}</i></span>` +
          `<span class="pPfT"><b>${escHtml(p.name)}</b><span class="pStars">${stars}</span><span class="dim">${next}</span></span></div>`
        );
      })
      .join('');
  },
});
const PARTS_CAT = (p) => (partById('arm', p.id) && partById('arm', p.id).id === p.id ? 'arm' : 'back');
