// Game 的 mixin：遠程射擊改版第 1 期「邊閃邊打」的回饋與 HUD（判定在 entities/mech-ranged.js，數值在 data/ranged.js）
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { RB } from '../data/ranged.js';

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
