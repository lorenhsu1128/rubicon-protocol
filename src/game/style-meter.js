// Game 的 mixin：遠程射擊改版第 6 期「風格評價」的 HUD（判定在 entities/mech-style.js）
import { Game } from './game.js';
import { clamp } from '../core/math.js';
import { SY, syRank } from '../data/style-meter.js';

Object.assign(Game.prototype, {
  // 客機收到 fb 'sty'
  syClient(v, a) {
    const s = this.syC || (this.syC = { pts: 0, labels: [] });
    s.pts = v;
    if (a && (!s.labels.length || s.labels[0].txt !== a)) {
      s.labels.unshift({ txt: a, t: 1.6 });
      if (s.labels.length > 4) s.labels.length = 4;
    }
  },
  // 畫面右側：等級的大字、這一級的進度條、最近的加分項目
  syHud(c, p, W, H, dt) {
    const client = this.net && this.net.role === 'client';
    const s = client ? this.syC : p.sy;
    if (!s || s.pts <= 0 || this.pvp) return;
    if (client) for (const l of s.labels) l.t -= dt;
    const r = syRank(s.pts);
    if (r < 0) return;
    const [lo, name, col] = SY.RANKS[r];
    const hi = r + 1 < SY.RANKS.length ? SY.RANKS[r + 1][0] : SY.MAX;
    const k = clamp((s.pts - lo) / Math.max(1, hi - lo), 0, 1);
    const touch = document.body.classList.contains('vpad');
    const x = W - (touch ? 150 : 110),
      y = H * (touch ? 0.3 : 0.36);
    c.save();
    c.textAlign = 'center';
    c.shadowColor = 'rgba(0,0,0,.85)';
    c.shadowBlur = 6;
    c.font = `italic 900 ${name.length > 1 ? 40 : 48}px Chakra Petch`;
    c.fillStyle = col;
    c.fillText(name, x, y);
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(0,0,0,.5)';
    c.fillRect(x - 46, y + 8, 92, 5);
    c.fillStyle = col;
    c.fillRect(x - 46, y + 8, 92 * k, 5);
    c.font = 'bold 11px Chakra Petch';
    c.fillStyle = 'rgba(255,255,255,.75)';
    c.fillText('STYLE', x, y - (name.length > 1 ? 38 : 44));
    let ly = y + 28;
    for (const l of s.labels) {
      if (l.t <= 0) continue;
      c.globalAlpha = clamp(l.t / 0.5, 0, 1);
      c.fillStyle = '#fff';
      c.fillText(l.txt, x, ly);
      ly += 15;
    }
    c.restore();
  },
});
