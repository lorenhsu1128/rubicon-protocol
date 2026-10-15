// Game：狀態效果的 HUD（機體失去行動自由時讓玩家清楚知道）——畫面中下方的狀態列（圖示、名稱、倒數條、
// 掙脫提示）與畫面邊緣依種類變色的光暈。drawHud 每格呼叫（俯視、追尾、第一人稱都一樣是 DOM，房主與客機相同）。
// 狀態本身在 entities/mech-status.js，文字與顏色在 data/status.js。
import { clamp } from '../core/math.js';
import { STATUS_DEFS, STATUS_KINDS, STATUS_QB_N } from '../data/status.js';
import { Game } from './game.js';

const css = (hex, a) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a.toFixed(3)})`;

Object.assign(Game.prototype, {
  // 測試掛勾（網址帶 ?test 或在靶場裡）：直接給玩家套上狀態，例如 __game.statusTest('hook', 4, { src: 敵人 id })
  statusTest(kind, sec = 4, o = {}) {
    if (!this.player || !(this.range || /[?&]test\b/.test(location.search))) return false;
    return this.player.addStatus(kind, sec, o);
  },
  // 掙脫提示：鍵盤／手把顯示按鍵，觸控改成按鈕名稱
  stsKeys() {
    const p = this.player;
    const touch = !!this.touchActive,
      pad = !this.touchActive && this.padActive;
    const mslot = ['rarm', 'larm'].find(
      (s) => p.weapons[s] && !p.weapons[s].dropped && p.weapons[s].def.type === 'melee',
    );
    const lab = (name) => (pad ? this.padLabel(this.padmap[name]) : this.keyLabel(this.keymap[name]));
    return {
      touch,
      qb: touch ? 'QB 鈕' : lab('qb'),
      melee: mslot ? (touch ? '射擊鈕' : lab(mslot === 'rarm' ? 'fireR' : 'fireL')) : null,
    };
  },
  stsHint(k, s, K) {
    const D = STATUS_DEFS[k];
    const need = STATUS_QB_N[k] || 1;
    const qb1 = K.touch ? `點 ${K.qb}掙脫` : `QB 掙脫 [${K.qb}]`;
    const qb2 = K.touch ? `連點 ${K.qb}甩掉 ${s.n}/${need}` : `連按 QB 甩掉 ${s.n}/${need} [${K.qb}]`;
    const cut = K.melee ? (K.touch ? `點${K.melee}（近戰）割開` : `近戰割開 [${K.melee}]`) : null;
    if (D.esc === 'qb1') return { act: qb1 };
    if (D.esc === 'qb2') return { act: qb2 };
    if (D.esc === 'mq') return { act: cut ? `${cut}／${qb2}` : qb2 };
    if (D.esc === 'melee') return cut ? { act: cut } : { act: '近戰割開（沒有近戰武器：等待解除）', weak: 1 };
    return { act: D.desc, weak: 1 };
  },
  stsEls() {
    let hud = document.getElementById('stsHud');
    if (!hud) {
      const wrap = document.getElementById('hudWrap');
      const edge = document.createElement('div');
      edge.id = 'stsEdge';
      wrap.appendChild(edge);
      hud = document.createElement('div');
      hud.id = 'stsHud';
      wrap.appendChild(hud);
    }
    return { hud, edge: document.getElementById('stsEdge') };
  },
  statusHud(dt) {
    const p = this.player;
    const { hud, edge } = this.stsEls();
    const S = p && !p.dead && !this.spectator ? p.sts : null;
    if (!S) {
      if (hud.dataset.sig) {
        hud.dataset.sig = '';
        hud.innerHTML = '';
        hud.classList.remove('on');
        edge.style.boxShadow = 'none';
        edge.style.opacity = 0;
      }
      if (this.stsFlash) this.stsFlash = null;
      return;
    }
    const kinds = STATUS_KINDS.filter((k) => S[k]);
    const K = this.stsKeys();
    const hints = kinds.map((k) => this.stsHint(k, S[k], K));
    const sig = kinds.map((k, i) => k + ':' + hints[i].act).join('|');
    if (hud.dataset.sig !== sig) {
      hud.dataset.sig = sig;
      hud.innerHTML = kinds
        .map((k, i) => {
          const D = STATUS_DEFS[k];
          const c = '#' + D.hex.toString(16).padStart(6, '0');
          return `<div class="stsI${hints[i].weak ? '' : ' esc'}" data-k="${k}" style="--c:${c}"><i>${D.ch}</i><div><b>${D.name}<em></em></b><span class="tb"><s></s></span><small>${hints[i].act}</small></div></div>`;
        })
        .join('');
      hud.classList.add('on');
    }
    for (const el of hud.children) {
      const s = S[el.dataset.k];
      if (!s) continue;
      el.querySelector('em').textContent = s.t.toFixed(1) + 's';
      el.querySelector('s').style.width = clamp((s.t / Math.max(0.1, s.T)) * 100, 0, 100) + '%';
    }
    // 畫面邊緣：每種狀態一層光暈（依種類不同色），黏附炸彈越接近爆炸閃得越快；剛中招時更亮
    const t = this.time || 0;
    const fl = this.stsFlash;
    if (fl && (fl.t -= dt) <= 0) this.stsFlash = null;
    const shadows = kinds.map((k, i) => {
      const s = S[k];
      let a = 0.42 + 0.18 * Math.sin(t * 5 + i);
      if (k === 'stick')
        a = 0.35 + 0.35 * Math.max(0, Math.sin(t * (8 + (1 - s.t / Math.max(0.5, s.T)) * 22)));
      if (k === 'spotted' || k === 'drain') a *= 0.75;
      if (fl && fl.k === k && !fl.ok) a = Math.min(0.95, a + fl.t * 1.2);
      const w = Math.round((innerHeight < 540 ? 60 : 110) + i * 30);
      return `inset 0 0 ${w}px ${Math.round(w * 0.12)}px ${css(STATUS_DEFS[k].hex, a)}`;
    });
    edge.style.boxShadow = shadows.join(',');
    edge.style.opacity = 1;
  },
});
