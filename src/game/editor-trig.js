// Game：關卡編輯器的觸發器面板（工具「觸發器」）——觸發器卡片（事件 → 條件 → 動作，可以展開／收合、
// 排序、複製）、群組（名稱、顏色）、計數器（名稱、初始值）。參數依 level/format.js 的表產生欄位。
import { escHtml } from '../core/html.js';
import { ACTIONS, CONDS, EVENTS, GROUP_COLORS, LIMITS, MARK_KINDS, blankParams } from '../level/format.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const COLOR_NAMES = ['紅', '橙', '綠', '藍', '紫', '粉', '黃', '青'];
const opt = (v, t, cur) =>
  `<option value="${escHtml(v)}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(t)}</option>`;

Object.assign(Game.prototype, {
  edRenderTrig() {
    const ed = this.ed;
    if (!ed) return;
    const cur = this.edCur();
    const el = $('edTrig');
    ed.trTab = ed.trTab || 'trig';
    ed.trOpen = ed.trOpen || {};
    const tabs = [
      ['trig', `觸發器（${cur.triggers.length}）`],
      ['group', `群組（${cur.groups.length}）`],
      ['counter', `計數器（${cur.counters.length}）`],
    ];
    let h = `<div class="trTop">${tabs.map(([k, n]) => `<button data-tt="${k}" class="${ed.trTab === k ? 'on' : ''}">${n}</button>`).join('')}<span class="grow"></span><button data-tx="close">關閉</button></div><div class="trBody">`;
    if (ed.trTab === 'trig') {
      h += `<div class="row"><button class="primary" data-tx="add">＋ 新增觸發器</button><button data-tx="expand">全部展開</button><button data-tx="collapse">全部收合</button></div>`;
      h += `<div class="dim">觸發器只在房主執行。沒有寫「任務成功」時，敵人全滅（含目標設施）就是成功；走進出口、護送抵達、倒數歸零、防衛目標被毀也有預設的結果。</div>`;
      cur.triggers.forEach((t, i) => (h += this.edTrigCard(t, i)));
    } else if (ed.trTab === 'group') {
      h += `<div class="row"><button class="primary" data-tx="gadd">＋ 新增群組</button></div>`;
      for (const g of cur.groups) {
        const n = cur.units.filter((u) => u.g === g.id).length;
        h += `<div class="trRow" data-gid="${escHtml(g.id)}"><input data-gf="name" value="${escHtml(g.name)}" maxlength="${LIMITS.name}"><select data-gf="color">${GROUP_COLORS.map((c, i) => opt(c, COLOR_NAMES[i], g.color)).join('')}</select><span class="dim">${n} 個單位</span><button data-tx="gdel">刪除</button></div>`;
      }
    } else {
      h += `<div class="row"><button class="primary" data-tx="cadd2">＋ 新增計數器</button></div>`;
      for (const c of cur.counters)
        h += `<div class="trRow" data-cid="${escHtml(c.id)}"><input data-cf="name" value="${escHtml(c.name)}" maxlength="${LIMITS.name}"><span>初始值</span><input type="number" data-cf="v" value="${c.v}" step="1"><button data-tx="cdel2">刪除</button></div>`;
    }
    h += '</div>';
    el.innerHTML = h;
    if (!el.dataset.bound) {
      el.dataset.bound = '1';
      el.addEventListener('click', (e) => this.edTrigClick(e));
      el.addEventListener('change', (e) => this.edTrigChange(e));
    }
  },
  edTrigSummary(t) {
    const E = EVENTS[t.ev.k];
    return `${E ? E.name : t.ev.k}${t.cond.length ? `・條件 ${t.cond.length}` : ''} → ${t.act.map((a) => (ACTIONS[a.k] || {}).name || a.k).join('、') || '（沒有動作）'}`;
  },
  edTrigCard(t, i) {
    const ed = this.ed;
    const open = ed.trOpen[t.id];
    let h = `<div class="trCard${t.on ? '' : ' off'}" data-tr="${i}"><div class="trHead"><button data-tx="toggle" class="trTog">${open ? '▾' : '▸'}</button><input data-tf="name" value="${escHtml(t.name || '')}" placeholder="${escHtml(t.id)}" maxlength="${LIMITS.name}"><label><input type="checkbox" data-tf="on"${t.on ? ' checked' : ''}>啟用</label><label><input type="checkbox" data-tf="once"${t.once ? ' checked' : ''}>只一次</label><button data-tx="up">↑</button><button data-tx="down">↓</button><button data-tx="dup">複製</button><button data-tx="del" class="danger">刪除</button></div>`;
    if (!open) return h + `<div class="trSum dim">${escHtml(this.edTrigSummary(t))}</div></div>`;
    h += `<div class="trSec"><b>事件</b><select data-tp="ev" data-pk="k">${Object.entries(EVENTS)
      .map(([k, E]) => opt(k, E.name, t.ev.k))
      .join('')}</select>${this.edParams('ev', EVENTS[t.ev.k].p, t.ev)}</div>`;
    h += `<div class="trSec"><b>條件</b><select data-tf="any">${opt('0', '全部符合', t.any ? '1' : '0')}${opt('1', '任一符合', t.any ? '1' : '0')}</select>`;
    t.cond.forEach((c, j) => {
      h += `<div class="trItem"><select data-tp="cond.${j}" data-pk="k">${Object.entries(CONDS)
        .map(([k, C]) => opt(k, C.name, c.k))
        .join(
          '',
        )}</select>${this.edParams('cond.' + j, CONDS[c.k].p, c)}<button data-tx="cdel" data-j="${j}">✕</button></div>`;
    });
    h += `${t.cond.length < LIMITS.conds ? '<button data-tx="cadd">＋ 條件</button>' : ''}</div>`;
    h += `<div class="trSec"><b>動作</b>`;
    t.act.forEach((a, j) => {
      h += `<div class="trItem"><span class="trN">${j + 1}</span><select data-tp="act.${j}" data-pk="k">${Object.entries(
        ACTIONS,
      )
        .map(([k, A]) => opt(k, A.name, a.k))
        .join(
          '',
        )}</select>${this.edParams('act.' + j, ACTIONS[a.k].p, a)}<button data-tx="aup" data-j="${j}">↑</button><button data-tx="adown" data-j="${j}">↓</button><button data-tx="adel" data-j="${j}">✕</button></div>`;
    });
    h += `${
      t.act.length < LIMITS.acts
        ? `<select data-tx-add="1">${opt('', '＋ 加入動作…', '')}${Object.entries(ACTIONS)
            .map(([k, A]) => opt(k, A.name, ''))
            .join('')}</select>`
        : ''
    }</div></div>`;
    return h;
  },
  // 參數欄位
  edParams(tp, spec, obj) {
    const cur = this.edCur();
    let h = '';
    for (const p of spec) {
      const v = obj[p.k];
      const at = `data-tp="${tp}" data-pk="${p.k}"`;
      let inp;
      if (p.type === 'num')
        inp = `<input type="number" ${at} value="${escHtml(v)}" min="${p.min}" max="${p.max}" step="any">`;
      else if (p.type === 'text')
        inp = `<input type="text" ${at} value="${escHtml(v || '')}" maxlength="${LIMITS.text}" class="wide">`;
      else if (p.type === 'tag') {
        const tags = [...new Set(cur.props.map((x) => x.tag).filter(Boolean))];
        inp = `<input type="text" ${at} value="${escHtml(v || '')}" maxlength="24" list="edTags">${tags.length ? `<datalist id="edTags">${tags.map((x) => `<option value="${escHtml(x)}">`).join('')}</datalist>` : ''}`;
      } else if (p.type === 'sel')
        inp = `<select ${at}>${Object.entries(p.opts)
          .map(([k, t]) => opt(k, t, v))
          .join('')}</select>`;
      else {
        const list =
          p.type === 'area'
            ? cur.areas
            : p.type === 'group'
              ? cur.groups
              : p.type === 'path'
                ? cur.paths
                : p.type === 'counter'
                  ? cur.counters
                  : p.type === 'trigger'
                    ? cur.triggers.map((t) => ({ id: t.id, name: t.name || t.id }))
                    : cur.marks
                        .filter((m) => !p.mk || m.k === p.mk)
                        .map((m) => ({ id: m.id, name: m.name || MARK_KINDS[m.k].name }));
        inp = `<select ${at}>${opt('', '（無）', v)}${list.map((x) => opt(x.id, x.name || x.id, v)).join('')}</select>`;
      }
      h += `<label class="trP"><span>${escHtml(p.name)}</span>${inp}</label>`;
    }
    return h;
  },
  edTrigObj(card, tp) {
    const cur = this.edCur();
    const t = cur.triggers[+card.dataset.tr];
    if (!tp) return { t };
    if (tp === 'ev') return { t, o: t.ev, spec: EVENTS };
    const [k, j] = tp.split('.');
    return { t, o: t[k][+j], spec: k === 'cond' ? CONDS : ACTIONS };
  },
  edTrigClick(e) {
    const ed = this.ed,
      cur = this.edCur();
    const tt = e.target.closest('[data-tt]');
    if (tt) {
      ed.trTab = tt.dataset.tt;
      return this.edRenderTrig();
    }
    const b = e.target.closest('[data-tx]');
    if (!b) return;
    const x = b.dataset.tx;
    if (x === 'close') return this.edSetTool('select');
    if (x === 'expand' || x === 'collapse') {
      for (const t of cur.triggers) ed.trOpen[t.id] = x === 'expand';
      return this.edRenderTrig();
    }
    if (x === 'add') {
      if (cur.triggers.length >= LIMITS.triggers) return this.edMsg(`觸發器最多 ${LIMITS.triggers} 個`, true);
      this.edPush();
      let n = cur.triggers.length + 1;
      while (cur.triggers.some((t) => t.id === 't' + n)) n++;
      const t = {
        id: 't' + n,
        name: '觸發器 ' + n,
        on: true,
        once: true,
        any: false,
        ev: { k: 'start' },
        cond: [],
        act: [],
      };
      cur.triggers.push(t);
      ed.trOpen[t.id] = true;
      this.edChanged();
      return this.edRenderTrig();
    }
    if (x === 'gadd') {
      this.edNewGroup();
      return this.edRenderTrig();
    }
    if (x === 'gdel') {
      const id = b.closest('[data-gid]').dataset.gid;
      if (cur.groups.length <= 1) return this.edMsg('至少要有一個群組', true);
      this.edPush();
      cur.groups = cur.groups.filter((g) => g.id !== id);
      for (const u of cur.units) if (u.g === id) u.g = cur.groups[0].id;
      this.edChanged();
      this.edRebuildHelpers();
      return this.edRenderTrig();
    }
    if (x === 'cadd2') {
      if (cur.counters.length >= LIMITS.counters) return this.edMsg(`計數器最多 ${LIMITS.counters} 個`, true);
      this.edPush();
      let n = cur.counters.length + 1;
      while (cur.counters.some((c) => c.id === 'c' + n)) n++;
      cur.counters.push({ id: 'c' + n, name: '計數器 ' + n, v: 0 });
      this.edChanged();
      return this.edRenderTrig();
    }
    if (x === 'cdel2') {
      const id = b.closest('[data-cid]').dataset.cid;
      this.edPush();
      cur.counters = cur.counters.filter((c) => c.id !== id);
      this.edChanged();
      return this.edRenderTrig();
    }
    const card = b.closest('[data-tr]');
    if (!card) return;
    const i = +card.dataset.tr;
    const t = cur.triggers[i];
    if (x === 'toggle') {
      ed.trOpen[t.id] = !ed.trOpen[t.id];
      return this.edRenderTrig();
    }
    this.edPush();
    const j = +b.dataset.j;
    const mv = (arr, a, d) => {
      const k = a + d;
      if (k < 0 || k >= arr.length) return;
      [arr[a], arr[k]] = [arr[k], arr[a]];
    };
    if (x === 'del') cur.triggers.splice(i, 1);
    else if (x === 'dup') {
      const c = JSON.parse(JSON.stringify(t));
      let n = cur.triggers.length + 1;
      while (cur.triggers.some((q) => q.id === 't' + n)) n++;
      c.id = 't' + n;
      c.name = (t.name || t.id) + '（副本）';
      cur.triggers.splice(i + 1, 0, c);
      ed.trOpen[c.id] = true;
    } else if (x === 'up') mv(cur.triggers, i, -1);
    else if (x === 'down') mv(cur.triggers, i, 1);
    else if (x === 'cadd') t.cond.push({ k: 'counter', ...blankParams(CONDS.counter.p) });
    else if (x === 'cdel') t.cond.splice(j, 1);
    else if (x === 'adel') t.act.splice(j, 1);
    else if (x === 'aup') mv(t.act, j, -1);
    else if (x === 'adown') mv(t.act, j, 1);
    this.edChanged();
    this.edRenderTrig();
  },
  edTrigChange(e) {
    const ed = this.ed,
      cur = this.edCur();
    const el = e.target;
    if (el.dataset.gf) {
      const g = cur.groups.find((x) => x.id === el.closest('[data-gid]').dataset.gid);
      this.edPush();
      g[el.dataset.gf] = el.dataset.gf === 'color' ? +el.value : el.value;
      this.edChanged();
      this.edRebuildHelpers();
      return;
    }
    if (el.dataset.cf) {
      const c = cur.counters.find((x) => x.id === el.closest('[data-cid]').dataset.cid);
      this.edPush();
      c[el.dataset.cf] = el.dataset.cf === 'v' ? Math.round(+el.value || 0) : el.value;
      this.edChanged();
      return;
    }
    const card = el.closest('[data-tr]');
    if (!card) return;
    if (el.dataset.txAdd) {
      const k = el.value;
      if (!k) return;
      const { t } = this.edTrigObj(card);
      this.edPush();
      t.act.push({ k, ...blankParams(ACTIONS[k].p) });
      this.edChanged();
      return this.edRenderTrig();
    }
    if (el.dataset.tf) {
      const { t } = this.edTrigObj(card);
      this.edPush();
      const f = el.dataset.tf;
      if (f === 'on' || f === 'once') t[f] = el.checked;
      else if (f === 'any') t.any = el.value === '1';
      else t[f] = el.value.slice(0, LIMITS.name);
      this.edChanged();
      if (f === 'on') card.classList.toggle('off', !t.on);
      return;
    }
    if (el.dataset.tp) {
      const { o, spec } = this.edTrigObj(card, el.dataset.tp);
      if (!o) return;
      this.edPush();
      const pk = el.dataset.pk;
      if (pk === 'k') {
        // 換種類：參數重設
        for (const k of Object.keys(o)) delete o[k];
        Object.assign(o, { k: el.value, ...blankParams(spec[el.value].p) });
        this.edChanged();
        return this.edRenderTrig();
      }
      const p = spec[o.k].p.find((q) => q.k === pk);
      o[pk] = p && p.type === 'num' ? Math.min(p.max, Math.max(p.min, +el.value || 0)) : el.value;
      this.edChanged();
    }
  },
});
