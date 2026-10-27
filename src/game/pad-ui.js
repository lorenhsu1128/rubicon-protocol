// ============================================================
//  PAD UI — 手把操作所有選單畫面（編輯器除外）：十字鍵／左搖桿移動焦點（依畫面位置）、A 決定、B 返回、
//  LB／RB 切換分頁、X 下一句通訊／略過文字、右搖桿捲動；下拉選單與數值用左右改。
//  可操作的元素一律從畫面上找（按鈕、選單、輸入框、有 onclick 的元素、data-a），只取最上層看得到的
//  （elementFromPoint），所以疊在上面的視窗（模組三選一、抉擇說明卡、確認視窗）自動優先。
//  確認視窗 uiConfirm 取代瀏覽器的 confirm（手把按不到）。
// ============================================================
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { Game } from './game.js';

const BACK_RE = /^(←|‹|返回|回標題|回到標題|取消|關閉|回大廳|離開|略過|不要|否|Back)/;
const REPEAT0 = 0.32,
  REPEAT = 0.11;

const visible = (el) => {
  if (!el.getClientRects().length) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
};
// 可以捲動的祖先
const scroller = (el) => {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const cs = getComputedStyle(p);
    if (
      /(auto|scroll)/.test(cs.overflowY + cs.overflowX) &&
      (p.scrollHeight > p.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2)
    )
      return p;
  }
  return null;
};
// 這個元素在畫面上（沒有被別的視窗蓋住）
const onTop = (el, r) => {
  const W = innerWidth,
    H = innerHeight;
  const x0 = Math.max(0, r.left),
    x1 = Math.min(W, r.right),
    y0 = Math.max(0, r.top),
    y1 = Math.min(H, r.bottom);
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  for (const [fx, fy] of [
    [0.5, 0.5],
    [0.2, 0.5],
    [0.8, 0.5],
    [0.5, 0.2],
    [0.5, 0.8],
  ]) {
    const h = document.elementFromPoint(x0 + (x1 - x0) * fx, y0 + (y1 - y0) * fy);
    if (h && (h === el || el.contains(h))) return true;
  }
  return false;
};

Object.assign(Game.prototype, {
  // 手把選單操作是否作用（任務中只有多人的暫停選單與確認視窗）
  padUiActive() {
    if (this.rebinding) return false;
    if (this.state === 'editor' || this.state === 'ending' || this.state === 'cine') return false; // 過場動畫自己讀手把（長按略過）
    if (this.uiModalOn) return true;
    if (this.state === 'play') {
      // 多人時任務不暫停：暫停選單、模組三選一與抉擇說明卡
      const mp = document.getElementById('modPick');
      return !!this.menuOpen || !!(mp && mp.classList.contains('on'));
    }
    return true;
  },
  // 目前可以操作的元素
  padUiCands() {
    const root = document.getElementById('ui') || document.body;
    const out = [];
    const all = root.querySelectorAll(
      'button, select, input, a[href], summary, [tabindex], [data-a], .slot, .part, .hubNode, [data-mi], [data-i], [data-slot] button',
    );
    const seen = new Set();
    const consider = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (el.disabled || el.closest('#editor, #vpad, #hudWrap')) return;
      if (el.tagName === 'INPUT' && (el.type === 'hidden' || el.type === 'file')) return;
      if (el.getAttribute('tabindex') === '-1') return;
      if (!visible(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      let ok = onTop(el, r);
      if (ok === null) {
        // 在畫面外（捲動清單裡）：所在的捲動區在最上層才算
        const sc = scroller(el);
        if (!sc) return;
        const sr = sc.getBoundingClientRect();
        ok = !!onTop(sc, sr);
      }
      if (ok) out.push({ el, r });
    };
    for (const el of all) consider(el);
    // 有 onclick 的其他元素（卡片、列表項目）
    for (const el of root.querySelectorAll('div, li, span, td, tr, label, img')) {
      if (el.onclick && !el.closest('button')) consider(el);
    }
    // 包在另一個候選裡的（卡片裡的按鈕）兩個都留；label 包著 checkbox 時只留 checkbox
    return out.filter((c) => !(c.el.tagName === 'LABEL' && c.el.querySelector('input')));
  },
  padUiFocus(el, quiet) {
    if (this.puEl === el) return;
    if (this.puEl) this.puEl.classList.remove('padFocus');
    this.puEl = el;
    if (!el) return;
    el.classList.add('padFocus');
    try {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } catch (e) {}
    if (!quiet) SFX.ui && SFX.ui();
  },
  padUiClear() {
    if (this.puEl) this.puEl.classList.remove('padFocus');
    this.puEl = null;
    const h = document.getElementById('padHint');
    if (h) h.classList.remove('on');
  },
  // 預設焦點：primary 的按鈕，否則畫面上最上面、最左邊的
  padUiDefault(C) {
    if (!C.length) return null;
    const inView = C.filter((c) => c.r.top >= 0 && c.r.bottom <= innerHeight);
    const L = inView.length ? inView : C;
    // 模組三選一、確認視窗：第一個卡片
    const pri = L.find((c) => c.el.closest('#modPick, #uiModal') && !BACK_RE.test(c.el.textContent.trim()));
    if (pri) return pri.el;
    const p = L.find((c) => c.el.classList.contains('primary'));
    if (p) return p.el;
    return L[0].el; // 頁面順序的第一個（通常是主要的流程）
  },
  // 往 (dx, dy) 方向找最近的
  padUiMove(dx, dy) {
    let C = this.padUiCands();
    if (!C.length) return;
    const cur = C.find((c) => c.el === this.puEl);
    if (!cur) return this.padUiFocus(this.padUiDefault(C));
    const pick = () => {
      const r0 = cur.el.getBoundingClientRect();
      const cx = (r0.left + r0.right) / 2,
        cy = (r0.top + r0.bottom) / 2;
      let best = null,
        bs = 1e9;
      for (const c of C) {
        if (c.el === cur.el || c.el.contains(cur.el) || cur.el.contains(c.el)) continue;
        const r = c.el.getBoundingClientRect();
        // 邊緣到邊緣的距離（寬的元素也能正確判斷）
        const gx = dx > 0 ? r.left - r0.right : dx < 0 ? r0.left - r.right : 0;
        const gy = dy > 0 ? r.top - r0.bottom : dy < 0 ? r0.top - r.bottom : 0;
        const along = dx ? gx : gy;
        const ccx = (r.left + r.right) / 2,
          ccy = (r.top + r.bottom) / 2;
        const cAlong = dx ? (ccx - cx) * dx : (ccy - cy) * dy;
        if (cAlong <= 2 || along < -Math.min(r.width, r.height, r0.width, r0.height) * 0.5) continue;
        // 橫向重疊時不算偏移
        const perp = dx
          ? Math.max(0, Math.max(r.top, r0.top) - Math.min(r.bottom, r0.bottom)) + Math.abs(ccy - cy) * 0.3
          : Math.max(0, Math.max(r.left, r0.left) - Math.min(r.right, r0.right)) + Math.abs(ccx - cx) * 0.3;
        const s = Math.max(0, along) + perp * 2.2;
        if (s < bs) {
          bs = s;
          best = c.el;
        }
      }
      return best;
    };
    let nx = pick();
    if (!nx) {
      // 沒有：捲動所在的清單再找一次
      const sc = scroller(cur.el);
      if (sc) {
        const before = dy ? sc.scrollTop : sc.scrollLeft;
        if (dy) sc.scrollTop += dy * sc.clientHeight * 0.6;
        else sc.scrollLeft += dx * sc.clientWidth * 0.6;
        if ((dy ? sc.scrollTop : sc.scrollLeft) !== before) {
          C = this.padUiCands();
          nx = pick();
        }
      }
    }
    if (nx) this.padUiFocus(nx);
  },
  // 下拉選單／數值／滑桿：左右改值；回傳 true＝已處理
  padUiAdjust(el, d) {
    if (el.tagName === 'SELECT') {
      const n = el.options.length;
      let i = el.selectedIndex;
      for (let k = 0; k < n; k++) {
        i = (i + d + n) % n;
        if (!el.options[i].disabled && !el.options[i].hidden) break;
      }
      if (i === el.selectedIndex) return true;
      el.selectedIndex = i;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      SFX.ui && SFX.ui();
      return true;
    }
    if (el.tagName === 'INPUT' && (el.type === 'range' || el.type === 'number')) {
      const st = parseFloat(el.step) || 1;
      let v = (parseFloat(el.value) || 0) + st * d;
      if (el.min !== '') v = Math.max(parseFloat(el.min), v);
      if (el.max !== '') v = Math.min(parseFloat(el.max), v);
      el.value = String(+v.toFixed(6));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  },
  padUiActivate(el) {
    if (!el) return;
    if (el.tagName === 'SELECT') return this.padUiAdjust(el, 1);
    if (el.tagName === 'INPUT' && (el.type === 'text' || el.type === 'search' || el.type === 'number')) {
      el.focus();
      return;
    }
    el.click();
  },
  // B：確認視窗取消、暫停時繼續、設定關閉，其他找畫面上的「返回／關閉／取消」按鈕，都沒有時當作 Esc
  padUiBack() {
    if (this.uiModalOn) return this.uiModalClose(false);
    if (this.state === 'pause') return this.resume();
    if (this.state === 'play' && this.menuOpen) {
      this.menuOpen = false;
      for (const s of document.querySelectorAll('#ui .screen')) s.classList.remove('on');
      return;
    }
    if (this.state === 'settings') return this.closeSettings();
    const C = this.padUiCands();
    const bk =
      C.find((c) => /back|close|cancel/i.test(c.el.id || '') && BACK_RE.test(c.el.textContent.trim())) ||
      C.find((c) => c.el.tagName === 'BUTTON' && BACK_RE.test(c.el.textContent.trim()));
    if (bk) {
      bk.el.click();
      return;
    }
    dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }));
  },
  // LB／RB：分頁（[data-padtabs] 裡目前選中的前後一個）
  padUiTab(d) {
    for (const g of document.querySelectorAll('[data-padtabs]')) {
      if (!visible(g) || g.closest('#editor')) continue;
      const items = [...g.querySelectorAll(g.dataset.padtabs || 'button')].filter(
        (b) => visible(b) && !b.disabled,
      );
      if (items.length < 2) continue;
      const r = g.getBoundingClientRect();
      if (!onTop(items[0], items[0].getBoundingClientRect()) && !onTop(g, r)) continue;
      let i = items.findIndex(
        (b) =>
          b.classList.contains('on') ||
          b.classList.contains('sel') ||
          b.classList.contains('active') ||
          b.classList.contains('primary'),
      );
      if (i < 0) i = items.indexOf(this.puEl);
      const nx = items[(i + d + items.length) % items.length];
      nx.click();
      this.padUiFocus(nx, true);
      return;
    }
  },
  // 每格（pollGamepad 呼叫）：gp＝手把
  padUiPoll(gp, dt) {
    this.puN = (this.puN || 0) + 1; // 讀過幾次（冒煙測試等手把被讀到）
    const prev = this.puPrev || (this.puPrev = {});
    const btn = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5));
    const edge = (i) => {
      const on = btn(i);
      const e = on && !prev[i];
      prev[i] = on;
      return e;
    };
    const active = this.padUiActive();
    const hint = document.getElementById('padHint');
    // 每個按鈕都要更新 prev（不作用時也是，避免切換畫面時誤判成按下）
    const eA = edge(0),
      eB = edge(1),
      eX = edge(2),
      eY = edge(3),
      eLB = edge(4),
      eRB = edge(5);
    const ax = gp.axes[0] || 0,
      ay = gp.axes[1] || 0;
    let dx = (btn(15) ? 1 : 0) - (btn(14) ? 1 : 0),
      dy = (btn(13) ? 1 : 0) - (btn(12) ? 1 : 0);
    if (!dx && !dy) {
      if (Math.abs(ax) > 0.55 && Math.abs(ax) > Math.abs(ay)) dx = Math.sign(ax);
      else if (Math.abs(ay) > 0.55) dy = Math.sign(ay);
    }
    if (!active || !this.padActive) {
      this.puDir = null;
      if (this.puEl || (hint && hint.classList.contains('on'))) this.padUiClear(); // 改用滑鼠或觸控時拿掉焦點框
      return false;
    }
    if (hint) hint.classList.add('on');
    // 焦點不見了（換畫面、元素被重建）：找預設；這一格的按鍵只用來顯示焦點，不移動也不決定
    if (!this.puEl || !document.contains(this.puEl) || !visible(this.puEl)) {
      const C = this.padUiCands();
      if (this.puEl) this.puEl.classList.remove('padFocus');
      this.puEl = null;
      this.padUiFocus(this.padUiDefault(C), true);
      if (dx || dy) this.puDir = { k: dx + ',' + dy, t: REPEAT0 };
      return true;
    } else {
      // 被蓋住（開了新的視窗）：移到上層
      const r = this.puEl.getBoundingClientRect();
      if (onTop(this.puEl, r) === false) {
        const C = this.padUiCands();
        if (!C.find((c) => c.el === this.puEl)) {
          this.puEl.classList.remove('padFocus');
          this.puEl = null;
          this.padUiFocus(this.padUiDefault(C), true);
          if (dx || dy) this.puDir = { k: dx + ',' + dy, t: REPEAT0 };
          return true;
        }
      }
    }
    // 方向（按住時重複）
    const key = dx || dy ? dx + ',' + dy : null;
    if (key) {
      const t = this.puDir;
      let fire = false;
      if (!t || t.k !== key) {
        this.puDir = { k: key, t: REPEAT0 };
        fire = true;
      } else {
        t.t -= dt;
        if (t.t <= 0) {
          t.t = REPEAT;
          fire = true;
        }
      }
      if (fire) {
        const el = this.puEl;
        if (dx && el && this.padUiAdjust(el, dx)) {
          /* 左右改值 */
        } else this.padUiMove(dx, dy);
      }
    } else this.puDir = null;
    // 右搖桿：捲動
    const ry = gp.axes[3] || 0;
    if (Math.abs(ry) > 0.25) {
      const sc = (this.puEl && scroller(this.puEl)) || document.querySelector('#ui .screen.on');
      if (sc) sc.scrollTop += ry * dt * 900;
    }
    if (eA) this.padUiActivate(this.puEl);
    // 按住 A：焦點元素有 padHold 時把按住的狀態交給它（駕駛員畫面的按住投點，docs/pilot-ui.md）
    const holdEl = this.puEl && this.puEl.padHold ? this.puEl : null;
    const down = !!holdEl && btn(0);
    if (this.puHoldEl && (this.puHoldEl !== holdEl || !down)) {
      this.puHoldEl.padHold(false);
      this.puHoldEl = null;
    }
    if (down && !this.puHoldEl) {
      this.puHoldEl = holdEl;
      holdEl.padHold(true);
    }
    if (eB) this.padUiBack();
    if (eLB) this.padUiTab(-1);
    if (eRB) this.padUiTab(1);
    if (eX && this.puEl && this.puEl.padDec) this.puEl.padDec();
    else if (eX) {
      // X：通訊下一句、略過逐字（焦點元素有 padDec 時改成它：駕駛員畫面的退一點）
      const cm = document.getElementById('comm');
      if (cm && cm.classList.contains('on')) cm.click();
      else if (this.tfxSkip) this.tfxSkip();
    }
    // Y：機甲庫的裝備頁 ⇄ 規格頁（docs/garage-ui.md）
    if (eY && this.state === 'garage' && this.garageTab) this.garageTab(this.gTab === 'spec' ? 'eq' : 'spec');
    return true;
  },
  // ---------- 確認視窗（取代 confirm，手把也能操作） ----------
  uiConfirm(text, onYes, yes = '確定', no = '取消') {
    let el = document.getElementById('uiModal');
    if (!el) {
      el = document.createElement('div');
      el.id = 'uiModal';
      document.getElementById('ui').appendChild(el);
    }
    el.innerHTML = `<div class="panel"><p>${escHtml(text)}</p><div class="row"><button class="primary" data-um="1">${escHtml(yes)}</button><button data-um="0">${escHtml(no)}</button></div></div>`;
    el.classList.add('on');
    this.uiModalOn = { el, onYes };
    el.onclick = (e) => {
      const b = e.target.closest('[data-um]');
      if (b) this.uiModalClose(b.dataset.um === '1');
    };
  },
  uiModalClose(ok) {
    const m = this.uiModalOn;
    if (!m) return;
    this.uiModalOn = null;
    m.el.classList.remove('on');
    if (ok && m.onYes) m.onYes();
  },
});
