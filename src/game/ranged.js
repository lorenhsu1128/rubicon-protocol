// Game 的 mixin：遠程射擊改版第 1 期「邊閃邊打」的回饋與 HUD（判定在 entities/mech-ranged.js，數值在 data/ranged.js）
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { RB } from '../data/ranged.js';
import { ATTRS } from '../data/attrs.js';
import { RX } from '../data/react.js';

Object.assign(Game.prototype, {
  // 反擊開始的慢動作：一開始最慢，慢慢回到原速
  rbSlowK() {
    const k = clamp(this.rbSlowT / RB.CTR_SLOW, 0, 1);
    return 1 - (1 - RB.CTR_SLOW_K) * k;
  },
  // 完美 QB 反擊的射擊開始（只給本人：房主／單機直接呼叫，客機由 fb 事件 'ctr'）
  rbCtrFx(p, dur) {
    if (this.net && this.net.role === 'client') p.rbCtrT = dur || RB.CTR_SLOW; // 客機只用來畫 HUD
    const c = p.center();
    this.fx.flash(c, 2.6, 0x7fd8ff, 0.2);
    this.fx.shockwave(c, 7, 0x7fd8ff, 0.4);
    SFX.play('bell', 0.45, 1.1, 0.02, 0.2, null, 'ui');
    SFX.play('thrBurst', 0.9, 1.5, 0.04, 0.1, null, 'ui');
    this.rumble(0.5, 0.8, 160);
  },
  // 蓄力射擊的充能完成（只給本人：房主／單機直接呼叫，客機由 fb 事件 'pwr'）
  pwReadyLocal(p, slot) {
    const w = p.weapons[slot];
    if (w) w.pwFlashT = 0.6;
    SFX.play('uiOk', 0.5, 1.4, 0.02, 0.1, null, 'ui');
    SFX.play('bell', 0.25, 1.8, 0.02, 0.1, null, 'ui');
  },
  // HUD：鎖定目標上的屬性反應（上一次打中的屬性與剩下的時間、效果中）；判定在房主，客機沒有
  rxHud(c, p, W, H) {
    const L = p.lock;
    if (!L || L.dead || !L.center) return;
    const P = L.rxPrev;
    const items = [];
    if (P && L.t - P.t <= RX.WIN && ATTRS[P.a])
      items.push([`${ATTRS[P.a].short} ▸`, ATTRS[P.a].color, 1 - (L.t - P.t) / RX.WIN]);
    if (L.rxHotT > 0) items.push(['過熱', '#ff9a40', L.rxHotT / RX.HOT_T]);
    if (L.rxJamT > 0) items.push(['干擾', '#7fc8ff', L.rxJamT / RX.JAM_T]);
    if (!items.length) return;
    const s = this.proj(L.center().setY(L.pos.y - 0.5 * L.dk));
    if (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H) return;
    c.save();
    c.font = 'bold 11px Chakra Petch';
    c.textAlign = 'center';
    let x = s.x - (items.length - 1) * 26;
    for (const [txt, col, k] of items) {
      c.fillStyle = 'rgba(0,0,0,.55)';
      c.fillRect(x - 22, s.y + 14, 44, 16);
      c.fillStyle = col;
      c.fillRect(x - 22, s.y + 28, 44 * clamp(k, 0, 1), 2);
      c.fillText(txt, x, s.y + 26);
      x += 52;
    }
    c.restore();
  },
  // HUD：反擊時間（畫面邊緣的藍光＋倒數）、繞射（鎖定目標周圍的環，滿了顯示 ORBIT）
  rbHud(c, p, W, H) {
    if (!p || p.dead) return;
    if (p.rbCtrT > 0) {
      const a = clamp(p.rbCtrT / 1.5, 0, 1);
      const gw = Math.min(W, H) * 0.16;
      c.save();
      for (const [x0, y0, x1, y1, rx, ry, rw, rh] of [
        [0, 0, gw, 0, 0, 0, gw, H],
        [W, 0, W - gw, 0, W - gw, 0, gw, H],
        [0, 0, 0, gw, 0, 0, W, gw],
        [0, H, 0, H - gw, 0, H - gw, W, gw],
      ]) {
        const gr = c.createLinearGradient(x0, y0, x1, y1);
        gr.addColorStop(0, `rgba(90,200,255,${0.5 * a})`);
        gr.addColorStop(1, 'rgba(110,210,255,0)');
        c.fillStyle = gr;
        c.fillRect(rx, ry, rw, rh);
      }
      c.font = 'bold 16px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = `rgba(160,230,255,${0.5 + 0.5 * a})`;
      c.shadowColor = 'rgba(0,0,0,.8)';
      c.shadowBlur = 4;
      c.fillText(`COUNTER ${p.rbCtrT.toFixed(1)}`, W / 2, H * 0.72);
      c.restore();
    }
    const k = p.rbOrbK ? p.rbOrbK() : 0;
    const L = p.lock;
    if (k > 0 && L && !L.dead && L.center) {
      const s = this.proj(L.center());
      if (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H) return;
      const r = (L.isBoss ? 70 : 46) * (1 - 0.3 * k);
      c.save();
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.45)';
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = k >= 1 ? '#7fe8ff' : 'rgba(127,232,255,.7)';
      c.beginPath();
      c.arc(s.x, s.y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
      c.stroke();
      if (k >= 1) {
        c.font = 'bold 11px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = '#7fe8ff';
        c.fillText('ORBIT', s.x, s.y + r + 13);
      }
      c.restore();
    }
  },
});
