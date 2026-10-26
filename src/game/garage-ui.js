// Game：機甲庫的換裝介面（docs/garage-ui.md）：上方列與子分頁、雙翼的部位格、零件格子與小卡片、
// 標註線（水平線＋固定 45° 斜線）、六角性能圖、量表、規格頁的圖表。組裝與存檔在 garage.js 的 renderGarage
import { SFX } from '../audio/audio.js';
import { ATTRS, ATTR_KEYS, directOf, weaponAttr } from '../data/attrs.js';
import { hexBounds, hexScores } from '../data/garage-hex.js';
import { hexSvg } from '../render/garage-charts.js';
import { PARTS, SLOTS, asmStats, jumpSpec, partById, usesAmmo } from '../data/parts.js';
import { applyPilotStats } from '../data/pilot.js';
import { escHtml } from '../core/html.js';
import { partIcon, slotIcon } from '../render/garage-icons.js';
import { hasThumb, renderThumb, thumbCached, thumbKey } from '../render/part-thumbs.js';
import { Game } from './game.js';

const WING_L = ['rarm', 'larm', 'rback', 'lback', 'c1', 'c2'];
const WING_R = ['head', 'core', 'arms', 'legs', 'booster', 'generator', 'fcs'];
const SLOT_OF = Object.fromEntries(SLOTS.map((s) => [s[0], s]));
const DIAGS = [Math.PI / 4, Math.PI / 3, (Math.PI * 5) / 12]; // 標註線的斜線角度（固定的三種）
const fmt = (v) => Math.round(v).toLocaleString();
const pct = (v) => Math.round(v * 100) + '%';
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
// 型號（零件名的第一段，例如「RF-024 突擊步槍」→「RF-024」）
const model = (p) => (p.id.endsWith('_none') ? '—' : String(p.name).split(/[ \u3000]/)[0]);
const _v = new THREE.Vector3();

Object.assign(Game.prototype, {
  // ---------- 一次性的設定 ----------
  garageUiInit() {
    if (this.gUiOn) return;
    this.gUiOn = true;
    this.gTab = 'eq';
    for (const b of document.querySelectorAll('#gTabs [data-tab]'))
      b.onclick = () => {
        SFX.ui();
        this.garageTab(b.dataset.tab);
      };
  },
  garageTab(t) {
    this.gTab = t;
    const g = document.getElementById('garage');
    g.dataset.tab = t;
    for (const b of document.querySelectorAll('#gTabs [data-tab]'))
      b.classList.toggle('on', b.dataset.tab === t);
    if (t === 'spec') this.garageSpecUi();
  },
  // ---------- 雙翼的部位格 ----------
  garageSlotsUi() {
    const asm = this.save.asm;
    const make = (key) => {
      const [, label, cat] = SLOT_OF[key];
      const p = partById(cat, asm[key]);
      const b = document.createElement('button');
      b.className =
        'slot' + (this.garageSlot === key ? ' sel' : '') + (p.id.endsWith('_none') ? ' empty' : '');
      b.dataset.slot = key;
      b.innerHTML = `<span class="gThumb" data-thumb="${key}:${p.id}">${slotIcon(cat, p)}</span><span class="gSlotT"><small>${label}</small><span>${escHtml(model(p))}</span></span>`;
      b.title = `${label}：${p.name}`;
      b.onclick = () => {
        if (this.garageSlot === key && this.gFlyOpen) this.gFlyOpen = false;
        else {
          this.garageSlot = key;
          this.gFlyOpen = true;
        }
        this.gTipPid = null;
        SFX.ui();
        this.renderGarage();
      };
      return b;
    };
    const L = document.getElementById('gWingL'),
      R = document.getElementById('gWingR');
    L.replaceChildren(...WING_L.map(make));
    R.replaceChildren(...WING_R.map(make));
  },
  // ---------- 零件格子 ----------
  garageFlyUi() {
    const S = this.save,
      asm = S.asm;
    const [key, label, cat] = SLOT_OF[this.garageSlot];
    const fly = document.getElementById('gFly');
    fly.classList.toggle('on', this.gFlyOpen !== false);
    document.getElementById('garage').classList.toggle('flyOn', this.gFlyOpen !== false);
    fly.classList.toggle('right', WING_R.includes(key));
    const list = document.getElementById('partList');
    const parts = PARTS[cat];
    const own = cat === 'consumable' ? parts.length : parts.filter((p) => S.owned.includes(p.id)).length;
    document.getElementById('gFlyHead').innerHTML =
      `<b>${label}</b><span class="dim">${cat === 'consumable' ? '持有後裝備' : `擁有 ${own}／全部 ${parts.length}`}</span>`;
    list.replaceChildren();
    S.items = S.items || {};
    for (const p of parts) {
      const eq = asm[key] === p.id;
      const owned = cat === 'consumable' || S.owned.includes(p.id);
      const d = document.createElement('button');
      d.className = 'part' + (eq ? ' eq' : '') + (owned ? '' : ' locked');
      d.dataset.pid = p.id; // 全像預覽（hangar.js）與小卡片
      let badge = '';
      if (cat === 'consumable' && p.id !== 'cs_none') badge = `<i class="pN">×${S.items[p.id] || 0}</i>`;
      else if (!owned) badge = `<i class="pPr">${(p.price / 1000).toFixed(0)}k</i>`;
      const dl = eq ? 0 : this.garageTileDelta(key, cat, p);
      const arrow = dl ? `<i class="${dl > 0 ? 'dUp' : 'dDn'}">${dl > 0 ? '▲' : '▼'}</i>` : '';
      d.innerHTML = `<span class="gThumb" data-thumb="${key}:${p.id}">${partIcon(cat, p)}</span><span class="pM">${escHtml(model(p))}</span>${badge}${arrow}<span class="srOnly">${escHtml(p.name)} ${this.garageSpecText(cat, p)}</span>`;
      d.title = p.name;
      d.onpointerenter = () => this.garageHover(p.id);
      d.onfocus = () => this.garageHover(p.id);
      d.onclick = () => this.garagePick(key, cat, p);
      list.appendChild(d);
    }
    this.garageTipUi(this.gTipPid || asm[key]);
    this.garageFlyPlace();
  },
  // 點零件：擁有＝裝備、沒有＝購買並裝備；消耗品＝裝備（購買在小卡片的按鈕）
  garagePick(key, cat, p) {
    const S = this.save,
      asm = S.asm;
    this.gTipPid = p.id;
    if (cat === 'consumable') {
      asm[key] = p.id;
      const other = key === 'c1' ? 'c2' : 'c1';
      if (p.id !== 'cs_none' && asm[other] === p.id) asm[other] = 'cs_none';
    } else if (!S.owned.includes(p.id)) {
      if (S.coam >= p.price) {
        S.coam -= p.price;
        S.owned.push(p.id);
        asm[key] = p.id;
        SFX.ui();
      } else {
        this.flashMsg('COAM 不足', 0xff4d4d, 1);
        return;
      }
    } else asm[key] = p.id;
    this.writeSave();
    this.renderGarage();
  },
  garageBuyItem(p) {
    const S = this.save;
    const n = S.items[p.id] || 0;
    if (n >= p.max) return this.flashMsg(`最多攜帶 ${p.max} 個`, 0xff4d4d, 1);
    if (S.coam < p.price) return this.flashMsg('COAM 不足', 0xff4d4d, 1);
    S.coam -= p.price;
    S.items[p.id] = n + 1;
    SFX.ui();
    this.writeSave();
    this.renderGarage();
  },
  // 零件格子放在選中的部位格旁邊（左翼的往右、右翼的往左），上緣對齊部位格、不超出畫面
  garageFlyPlace() {
    const fly = document.getElementById('gFly');
    const sl = document.querySelector(`#slots .slot[data-slot="${this.garageSlot}"]`);
    if (!fly || !sl || !fly.classList.contains('on')) return;
    const r = sl.getBoundingClientRect();
    const wing = sl.parentElement.getBoundingClientRect();
    const right = fly.classList.contains('right');
    fly.style.left = right ? '' : wing.right + 12 + 'px';
    fly.style.right = right ? innerWidth - wing.left + 12 + 'px' : '';
    const h = fly.offsetHeight;
    const bottom = innerHeight - (document.getElementById('gBottom').offsetHeight || 60) - 8;
    fly.style.top = Math.max(64, Math.min(r.top - 6, bottom - h)) + 'px';
  },
  // 零件格子的箭頭：換上後的主要數值（武器＝持續 DPS、其他＝有效 AP）變好或變差
  garageTileDelta(slot, cat, p) {
    if (cat === 'consumable') return 0;
    const cur = this.garageFireCache || (this.garageFireCache = this.garageFire(this.save.asm));
    const F = this.garageFire({ ...this.save.asm, [slot]: p.id });
    const x = cat === 'arm' || cat === 'back' ? F.sus - cur.sus : F.eap - cur.eap || F.sus - cur.sus;
    return Math.abs(x) < 0.5 ? 0 : x;
  },
  // 零件的完整說明（讀螢幕的人與搜尋用；畫面上是小卡片）
  garageSpecText(cat, p) {
    let spec = '';
    if (cat === 'arm' || cat === 'back') {
      if (p.type === 'melee')
        spec = `${p.combo.length} 段 · 總傷 ${p.combo.reduce((a, c) => a + c.dmg, 0)} · 終結衝擊 ${p.combo[p.combo.length - 1].impact}`;
      else if (p.type !== 'none' && p.type !== 'shield')
        spec = `傷 ${p.dmg} · 衝擊 ${p.impact} · 射程 ${p.range}${usesAmmo(p) ? ' · 彈匣 ' + p.mag : ''}`;
      else if (p.type === 'shield') spec = '被動減傷 55%';
      if (!['none', 'shield'].includes(p.type))
        spec = `[${ATTRS[weaponAttr(p)].name}] ${spec}${p.ideal ? ' · 理想射程 ' + p.ideal : ''} · 直擊 ×${directOf(p)}`;
    } else if (cat === 'legs') spec = `AP ${p.ap} · 負重 ${p.load} · 速 ${p.speed}`;
    else if (cat === 'generator') spec = `容量 ${p.cap} · 輸出 ${p.output} · 回充 ${p.recharge}`;
    else if (cat === 'booster') spec = `推力 ×${p.thrust} · QB ${p.qb}`;
    else if (cat === 'fcs')
      spec = `鎖定距離 ${p.range} · 輔助 近/中/遠 ${(p.assist || [0.6, 0.6, 0.45]).map((v) => Math.round(v * 100)).join('/')} · 導彈鎖定 ${(1 / (p.lockSpeed || 1)).toFixed(1)} 秒`;
    else if (cat === 'consumable') spec = p.desc || '';
    else spec = `AP ${p.ap} · 穩定 ${p.stab}`;
    if (p.defs) spec += ` · 防 實/爆/能 ${p.defs.join('/')}`;
    if (p.desc && cat !== 'consumable') spec += ' · ' + p.desc;
    if (p.weight !== undefined) spec += ` · 重 ${p.weight} · EN ${p.en}`;
    return spec;
  },
  // ---------- 小卡片 ----------
  garageTipUi(pid) {
    const tip = document.getElementById('gTip');
    if (!tip) return;
    const S = this.save;
    const [key, , cat] = SLOT_OF[this.garageSlot];
    const p = PARTS[cat].find((x) => x.id === pid) || partById(cat, S.asm[key]);
    const cur = partById(cat, S.asm[key]);
    const eq = p.id === cur.id;
    const owned = cat === 'consumable' || S.owned.includes(p.id);
    // [名稱, 數值, 目前零件的數值, 越大越好？, 格式]
    const rows = [];
    const R = (n, f, good = 1, form = fmt) => {
      const a = f(p),
        b = f(cur);
      if (a === undefined || a === null || Number.isNaN(a)) return;
      rows.push([n, a, b, good, form, f]);
    };
    const W = (q) => this.garageWeaponV(key, q);
    if (cat === 'arm' || cat === 'back') {
      if (!['none', 'shield'].includes(p.type)) {
        R('持續 DPS', (q) => W(q).sus);
        if (p.type === 'melee') {
          R('總傷', (q) => (q.combo || []).reduce((a, c) => a + c.dmg, 0));
          R(
            '段數',
            (q) => (q.combo || []).length,
            1,
            (v) => v,
          );
        } else {
          R('傷害', (q) => (q.type === 'melee' ? undefined : q.dmg));
          R('衝擊', (q) => (q.type === 'melee' ? undefined : q.impact));
          R('射程', (q) => q.range || 0);
          if (p.ideal) R('理想射程', (q) => q.ideal || 0);
          if (usesAmmo(p)) R('彈匣', (q) => (usesAmmo(q) ? q.mag : 0));
        }
      }
    } else if (cat === 'consumable') {
      /* 消耗品只有說明 */
    } else if (cat === 'generator') {
      R('容量', (q) => q.cap);
      R('輸出', (q) => q.output);
      R('回復', (q) => q.recharge);
      R('能量適性', (q) => q.enAdapt || 1, 1, pct);
    } else if (cat === 'booster') {
      R(
        '推力',
        (q) => q.thrust,
        1,
        (v) => '×' + v,
      );
      R('QB 速度', (q) => q.qb);
      R('QB 消耗', (q) => q.qbCost, -1);
    } else if (cat === 'fcs') {
      R('鎖定距離', (q) => q.range);
      ['近', '中', '遠'].forEach((n, i) => R('輔助・' + n, (q) => (q.assist || [0.6, 0.6, 0.45])[i], 1, pct));
      R(
        '導彈鎖定',
        (q) => 1 / (q.lockSpeed || 1),
        -1,
        (v) => v.toFixed(1) + ' 秒',
      );
    } else {
      R('AP', (q) => q.ap);
      R('姿態穩定', (q) => q.stab);
      if (cat === 'legs') {
        R('負重', (q) => q.load);
        R('速度', (q) => q.speed);
        R(
          '跳躍',
          (q) => jumpSpec(q).height,
          1,
          (v) => v.toFixed(1) + ' m',
        );
      }
      if (cat === 'arms') R('射擊適性', (q) => q.aim || 0.6, 1, pct);
    }
    if (p.weight !== undefined) {
      R('重量', (q) => q.weight, -1);
      R('EN 負載', (q) => q.en, -1);
    }
    const body = rows
      .map(([n, a, b, good, form, f]) => {
        const d = a - b;
        const dc = Math.abs(d) < 1e-6 ? '' : d * good > 0 ? 'up' : 'dn';
        // 長條：同一類零件裡的最大值當滿格
        const m = Math.max(1e-6, ...PARTS[cat].map((q) => Math.abs(Number(f(q)) || 0)));
        const sign = d > 0 ? '+' : '−';
        return `<div class="tR"><span>${n}</span><span class="tBar"><b style="width:${(clamp01(a / m) * 100).toFixed(0)}%"></b>${eq ? '' : `<s style="left:${(clamp01(b / m) * 100).toFixed(0)}%"></s>`}</span><span>${form(a)}</span><span class="${dc}">${eq || !dc ? '' : sign + form(Math.abs(d))}</span></div>`;
      })
      .join('');
    // 防禦（實／爆／能）：三條
    let defs = '';
    if (p.defs)
      defs = `<div class="tDefs">${ATTR_KEYS.map((k, i) => {
        const a = p.defs[i],
          b = (cur.defs || [])[i] || 0;
        const d = a - b;
        return `<span style="--c:${ATTRS[k].color}"><i>${ATTRS[k].short}</i><b style="width:${clamp01(a / 2000) * 100}%"></b><em class="${eq || !d ? '' : d > 0 ? 'up' : 'dn'}">${a}</em></span>`;
      }).join('')}</div>`;
    const attr =
      (cat === 'arm' || cat === 'back') && !['none', 'shield'].includes(p.type)
        ? `<span class="tAttr" style="--c:${ATTRS[weaponAttr(p)].color}">${ATTRS[weaponAttr(p)].name}</span>`
        : '';
    let act = '';
    if (cat === 'consumable') {
      if (p.id !== 'cs_none')
        act = `<span class="dim">持有 ×${S.items[p.id] || 0}／最多 ${p.max}</span><button class="tBuy">購買 ${p.price.toLocaleString()} C</button>`;
      act += `<button class="tEq"${S.asm[key] === p.id ? ' disabled' : ''}>${S.asm[key] === p.id ? '裝備中' : '裝備'}</button>`;
    } else
      act = eq
        ? '<span class="tOn">裝備中</span>'
        : owned
          ? '<button class="tEq">裝備</button>'
          : `<button class="tEq">購買並裝備 ${p.price.toLocaleString()} C</button>`;
    tip.innerHTML = `<div class="tH"><b>${escHtml(p.name)}</b>${attr}</div>${p.desc ? `<div class="tD">${escHtml(p.desc)}</div>` : ''}${body}${defs}<div class="tA">${act}</div>`;
    const be = tip.querySelector('.tEq');
    if (be) be.onclick = () => this.garagePick(key, cat, p);
    const bb = tip.querySelector('.tBuy');
    if (bb) bb.onclick = () => this.garageBuyItem(p);
  },
  // 武器在這個武器槽的理論 DPS（套用加成）
  garageWeaponV(slot, p) {
    const F = this.garageFire({ ...this.save.asm, [slot]: p.id });
    const w = F.ws.find((x) => x.slot === slot);
    return w || { sus: 0, burst: 0 };
  },
  // 游標停在零件上（手把的焦點也算）：小卡片、量表與六角圖的預覽
  garageHover(pid) {
    if (this.gHoverPid === pid) return;
    this.gHoverPid = pid;
    if (pid) {
      this.gTipPid = pid;
      this.garageTipUi(pid);
    }
    this.garageStatsUi(pid);
  },
  // ---------- 量表（裝備頁） ----------
  garageStatsUi(pid) {
    const asm = this.save.asm;
    const key = this.garageSlot;
    const prevAsm = pid && pid !== asm[key] ? { ...asm, [key]: pid } : null;
    const pm = this.rangePmOn() ? this.rangePm() : null;
    const cur = hexScores(asm, pm),
      nx = prevAsm ? hexScores(prevAsm, pm) : null;
    const st = asmStats(asm),
      st2 = prevAsm ? asmStats(prevAsm) : null;
    const ef = applyPilotStats(st, pm),
      ef2 = st2 ? applyPilotStats(st2, pm) : null;
    const B = hexBounds();
    const meter = (name, a, b, max, over, good = 1, txt) => {
      const w = clamp01(a / max),
        w2 = b === null ? w : clamp01(b / max);
      const d = b === null ? 0 : b - a;
      const lo = Math.min(w, w2),
        hi = Math.max(w, w2);
      const cls = d * good > 0 ? '' : 'dn';
      return `<div class="gM${over ? ' over' : ''}"><div><span>${name}</span><span>${txt}${d ? ` <em class="${d * good > 0 ? 'up' : 'dn'}">${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}</em>` : ''}</span></div><div class="gMb"><b style="width:${(lo * 100).toFixed(1)}%"></b>${d ? `<s class="${cls}" style="left:${(lo * 100).toFixed(1)}%;width:${((hi - lo) * 100).toFixed(1)}%"></s>` : ''}</div></div>`;
    };
    const ws = (s) => s.weight,
      wl = st.load;
    document.getElementById('gMeters').innerHTML = [
      meter('AP', ef.ap, ef2 ? ef2.ap : null, B.apMax, false, 1, fmt(ef.ap)),
      meter('火力', cur.raw.fire, nx ? nx.raw.fire : null, B.fire[1], false, 1, fmt(cur.raw.fire)),
      meter(
        '負重',
        ws(st),
        st2 ? ws(st2) : null,
        st2 ? Math.max(wl, st2.load) : wl,
        (st2 || st).overWeight,
        -1,
        `${fmt(st.weight)} / ${fmt(st.load)}`,
      ),
      meter(
        'EN 負載',
        st.enLoad,
        st2 ? st2.enLoad : null,
        st2 ? Math.max(st.enOut, st2.enOut) : st.enOut,
        (st2 || st).overEn,
        -1,
        `${fmt(st.enLoad)} / ${fmt(st.enOut)}`,
      ),
    ].join('');
  },
  // ---------- 規格頁：圖表 ----------
  garageSpecUi() {
    const el = document.getElementById('gSpecCharts');
    if (!el) return;
    const asm = this.save.asm;
    const pm = this.rangePmOn() ? this.rangePm() : null;
    const H = hexScores(asm, pm);
    const F = this.garageFire(asm);
    const st = asmStats(asm);
    const ef = applyPilotStats(st, pm);
    const P = ef.parts;
    const JS = jumpSpec(P.legs);
    const B = hexBounds();
    const bar = (name, v, max, txt, col) =>
      `<div class="sR"><span>${name}</span><span class="sB"><b style="width:${(clamp01(v / max) * 100).toFixed(1)}%${col ? ';background:' + col : ''}"></b></span><span>${txt}</span></div>`;
    const card = (t, body, wide) =>
      `<section class="sC${wide ? ' wide' : ''}"><h3>${t}</h3>${body}</section>`;
    // 火力：每把武器的瞬間（淡）與持續（實心）DPS
    const fMax = Math.max(1, ...F.ws.map((w) => w.burst));
    const SN = { rarm: '右手', larm: '左手', rback: '右背', lback: '左背' };
    const fire = F.ws.length
      ? F.ws
          .map(
            (w) =>
              `<div class="sR fire"><span><i class="aDot" style="background:${ATTRS[w.attr].color}"></i>${SN[w.slot]}　${escHtml(model({ id: w.id, name: w.name }))}</span><span class="sB"><u style="width:${((w.burst / fMax) * 100).toFixed(1)}%;background:${ATTRS[w.attr].color}"></u><b style="width:${((w.sus / fMax) * 100).toFixed(1)}%;background:${ATTRS[w.attr].color}"></b></span><span>${fmt(w.sus)}<em class="dim"> / ${fmt(w.burst)}</em></span></div>`,
          )
          .join('') +
        `<div class="sSum"><span>合計　持續 <b>${fmt(F.sus)}</b>　瞬間 <b>${fmt(F.burst)}</b>　衝擊／秒 <b>${fmt(F.imp)}</b></span></div>`
      : '<p class="dim">沒有裝備武器</p>';
    // 預估命中率：90 m／180 m
    const hw = F.ws.filter((w) => w.hit30 !== null);
    const hit = hw.length
      ? `<div class="sHit">${hw
          .map(
            (w) =>
              `<div><span>${SN[w.slot]}</span><span class="col"><b style="height:${(w.hit30 * 100).toFixed(0)}%"></b><em>${pct(w.hit30)}</em></span><span class="col far"><b style="height:${(w.hit60 * 100).toFixed(0)}%"></b><em>${pct(w.hit60)}</em></span></div>`,
          )
          .join('')}</div><div class="sNote">左＝90 m、右＝180 m（對移動中的 AC）</div>`
      : '<p class="dim">沒有可以估算的武器</p>';
    const defs = ATTR_KEYS.map((k) =>
      bar(
        ATTRS[k].name,
        ef.defs[k],
        0.4,
        (Math.round(ef.defs[k] * 1000) / 10).toFixed(1) + '%',
        ATTRS[k].color,
      ),
    ).join('');
    const armor =
      bar('AP', ef.ap, B.apMax, fmt(ef.ap)) +
      bar('有效 AP', F.eap, B.armor[1], fmt(F.eap)) +
      bar('姿態穩定', ef.stab, B.stab[1], fmt(ef.stab)) +
      `<div class="sSub">減傷</div>${defs}`;
    const load =
      bar(
        '負重',
        st.weight,
        st.load,
        `${fmt(st.weight)} / ${fmt(st.load)}`,
        st.overWeight ? 'var(--danger)' : '',
      ) +
      bar(
        'EN 負載',
        st.enLoad,
        st.enOut,
        `${fmt(st.enLoad)} / ${fmt(st.enOut)}`,
        st.overEn ? 'var(--danger)' : '',
      );
    const mobi =
      bar('地面速度', ef.speed, B.speed[1], ef.speed.toFixed(1)) +
      bar('QB 速度', P.booster.qb, B.qb[1], fmt(P.booster.qb)) +
      bar('QB 消耗', P.booster.qbCost, 400, fmt(P.booster.qbCost), 'var(--dimbar)') +
      bar('跳躍（地面）', JS.height, 60, JS.height.toFixed(1) + ' m') +
      bar('跳躍（空中）', JS.airH, 60, JS.airH.toFixed(1) + ' m') +
      `<div class="sChips"><span>空中跳 <b>${JS.air}</b> 次</span><span>${JS.canHover ? `懸浮 <b>${JS.hover}</b>/s` : '不能懸浮'}</span></div>`;
    const en =
      bar('EN 容量', ef.enCap, B.cap[1], fmt(ef.enCap)) +
      bar('EN 回復', P.generator.recharge, B.rec[1], fmt(P.generator.recharge)) +
      bar('能量武器適性', ef.enAdapt, 1.6, pct(ef.enAdapt));
    const as = P.fcs.assist || [0.6, 0.6, 0.45];
    const fcs =
      bar('鎖定距離', ef.lockRange, B.lock[1], Math.round(ef.lockRange) + ' m') +
      `<div class="sAs">${['近', '中', '遠'].map((n, i) => `<div><span class="col"><b style="height:${(as[i] * 100).toFixed(0)}%"></b><em>${pct(as[i])}</em></span><span>${n}</span></div>`).join('')}<div class="sAsT"><span>火控輔助</span><span>導彈鎖定 <b>${(1 / (P.fcs.lockSpeed || 1)).toFixed(1)}</b> 秒</span><span>射擊適性 <b>${pct(P.arms.aim || 0.6)}</b></span></div></div>`;
    el.innerHTML =
      `<section class="sC hexC">${hexSvg(H, null, true)}</section>` +
      card('火力（理論值）', fire, true) +
      card('預估命中率', hit) +
      card('裝甲', armor) +
      card('負載', load) +
      card('機動', mobi) +
      card('EN', en) +
      card('火控', fcs);
  },
  // ---------- 每格：游標停留、標註線 ----------
  garageUiTick() {
    if (this.state !== 'garage') return;
    if (this.gTab === 'eq') {
      const el =
        document.querySelector('#partList .part.padFocus') || document.querySelector('#partList .part:hover');
      const pid = el ? el.dataset.pid : null;
      if (pid !== this.gHoverPid) this.garageHover(pid);
    }
    this.garageThumbTick();
    this.garageCallouts();
  },
  // 零件縮圖（render/part-thumbs.js）：畫面上還沒換成縮圖的格子，每格最多拍一張
  garageThumbTick() {
    let shot = false;
    const src = this.garageSource();
    const palKey = this.myPalKey();
    for (const el of document.querySelectorAll('#garage .gThumb[data-thumb]:not([data-done])')) {
      const [slot, pid] = el.dataset.thumb.split(':');
      if (!hasThumb(slot, pid)) {
        el.dataset.done = '1';
        continue;
      }
      const key = thumbKey(slot, pid, palKey, src);
      let url = thumbCached(key);
      if (url === undefined) {
        if (shot) continue;
        shot = true;
        url = renderThumb(this.renderer, {
          slot,
          pid,
          asm: this.save.asm,
          pal: this.myPal(),
          palKey,
          source: src,
          env: this.envTex,
        });
      }
      el.dataset.done = '1';
      if (url) el.innerHTML = `<img src="${url}" alt="" draggable="false">`;
    }
  },
  // 標註線：部位格內側的邊 → 水平線 → 固定角度的斜線 → 機體上的點
  garageCallouts() {
    const cv = document.getElementById('gCallout');
    if (!cv) return;
    const W = innerWidth,
      H = innerHeight,
      dpr = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const m = this.garageMech;
    if (!m || this.gTab !== 'eq' || (this.hg && (this.hg.launch || (this.hg.swap && this.hg.swap.rig))))
      return;
    const cam = this.garageCam;
    cam.updateMatrixWorld();
    m.group.updateMatrixWorld(true);
    const scr = (o) => {
      o.getWorldPosition(_v);
      _v.project(cam);
      return _v.z > 1 ? null : [((_v.x + 1) / 2) * W, ((1 - _v.y) / 2) * H];
    };
    // 部位在機體上的點（左翼取畫面左邊的、右翼取右邊的）
    const legs = (m.legs || []).map((L) => L.knee).filter(Boolean);
    const nodes = {
      rarm: [m.arms.r && m.arms.r.hand],
      larm: [m.arms.l && m.arms.l.hand],
      rback: [m.arms.r && m.arms.r.back],
      lback: [m.arms.l && m.arms.l.back],
      head: [m.head],
      core: [m.torso],
      arms: [m.arms.r && m.arms.r.fore, m.arms.l && m.arms.l.fore],
      legs: legs.length ? legs : [m.legsG],
      booster: [m.pack],
      generator: [m.torso],
      fcs: [m.head],
    };
    const hov = document.querySelector('#slots .slot:hover, #slots .slot.padFocus');
    const hk = hov ? hov.dataset.slot : null;
    for (const sl of document.querySelectorAll('#slots .slot')) {
      const key = sl.dataset.slot;
      const ns = (nodes[key] || []).filter(Boolean);
      if (!ns.length) continue;
      const r = sl.getBoundingClientRect();
      if (!r.width) continue;
      const right = sl.parentElement.id === 'gWingR';
      let P = null;
      for (const o of ns) {
        const s = scr(o);
        if (s && (!P || (right ? s[0] > P[0] : s[0] < P[0]))) P = s;
      }
      if (!P) continue;
      // 起點：格子內側的邊、縮圖的中線
      const th = sl.querySelector('.gThumb').getBoundingClientRect();
      const A = [right ? r.left - 6 : r.right + 6, th.top + th.height / 2];
      const dy = Math.abs(P[1] - A[1]);
      const dir = right ? -1 : 1; // 往機體的方向
      const room = (P[0] - A[0]) * dir; // 可以走的水平距離
      if (room < 10) continue;
      // 斜線的角度只用 45°、60°、75°：先試 45°，水平距離不夠才換陡的
      const ang = DIAGS.find((t) => dy / Math.tan(t) <= room - 6) || DIAGS[DIAGS.length - 1];
      const dx = Math.min(room, dy / Math.tan(ang));
      const K = [P[0] - dir * dx, A[1]]; // 水平線的終點＝斜線的起點
      const on = key === this.garageSlot || key === hk;
      c.strokeStyle = on ? 'rgba(255,176,32,0.95)' : 'rgba(220,232,240,0.28)';
      c.lineWidth = on ? 1.6 : 1;
      c.beginPath();
      c.moveTo(A[0], A[1]);
      c.lineTo(K[0], K[1]);
      c.lineTo(P[0], P[1]);
      c.stroke();
      c.fillStyle = on ? '#ffb020' : 'rgba(220,232,240,0.5)';
      c.beginPath();
      c.arc(P[0], P[1], on ? 3.5 : 2.2, 0, Math.PI * 2);
      c.fill();
      c.beginPath();
      c.arc(A[0], A[1], 1.8, 0, Math.PI * 2);
      c.fill();
    }
  },
});
