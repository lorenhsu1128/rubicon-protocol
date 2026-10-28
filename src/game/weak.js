// Game 的 mixin：遠程射擊改版第 2 期的弱點 HUD 與追尾視角／第一人稱的改瞄（判定在 entities/mech-weak.js）
import { Game } from './game.js';
import { WP, WP_KINDS } from '../data/weak.js';

const FACE_TXT = { back: '背', top: '上', side: '側' };

Object.assign(Game.prototype, {
  // 鎖定提示的弱點文字：「弱點 背：推進器／上：感測器」（壞掉的劃掉）
  wpHint(L) {
    const K = L && L.wpKeys ? L.wpKeys() : null;
    if (!K || !K.length) return '';
    const s = K.map((k) => `${FACE_TXT[WP_KINDS[k].face]}：${WP_KINDS[k].name}${L.wpBroken(k) ? '✕' : ''}`);
    return `　弱點 ${s.join('／')}`;
  },
  // 每格（drawHud）：鎖定目標的弱點位置；追尾視角與第一人稱時準星壓在弱點上＝改瞄它（p.wpAim）
  wpHud(c, p, W, H) {
    p.wpAim = null;
    const L = p.lock;
    if (!L || L.dead || !L.wpKeys) return;
    const t = this.time || 0;
    const aimMode = this.chase || this.fp;
    const open = L.wpOpen();
    // Boss 與一般敵人：弱點露出中（準備中、或 Boss 剛被打出 CRITICAL）
    if (open || (L.isBoss && L.wpBossT !== undefined && L.t - L.wpBossT < 1.2)) {
      const s = this.proj(L.center().setY(L.pos.y + ((L.model && L.model.height) || 3)));
      if (s.in) {
        c.save();
        c.font = 'bold 12px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = `rgba(255,210,64,${0.65 + 0.35 * Math.sin(t * 14)})`;
        c.shadowColor = 'rgba(0,0,0,.8)';
        c.shadowBlur = 4;
        c.fillText('弱點露出', s.x, s.y - 30);
        c.restore();
      }
    }
    const K = L.wpKeys();
    if (!K) return;
    let best = null;
    c.save();
    for (const k of K) {
      const broken = L.wpBroken(k);
      const reach = !broken && L.wpReach(k, p);
      for (const pt of L.wpPoints(k)) {
        const s = this.proj(pt);
        if (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
        if (aimMode && !broken) {
          const d = Math.hypot(s.x - W / 2, s.y - H / 2);
          if (d < WP.AIM_PX && (!best || d < best.d)) best = { d, k, s };
        }
        const r = 6;
        c.lineWidth = 2;
        if (broken) {
          c.strokeStyle = 'rgba(255,80,80,.8)';
          c.beginPath();
          c.moveTo(s.x - r, s.y - r);
          c.lineTo(s.x + r, s.y + r);
          c.moveTo(s.x + r, s.y - r);
          c.lineTo(s.x - r, s.y + r);
          c.stroke();
          continue;
        }
        const hot = reach || open;
        c.strokeStyle = hot ? '#ffd040' : 'rgba(255,255,255,.4)';
        c.fillStyle = hot ? `rgba(255,208,64,${0.35 + 0.25 * Math.sin(t * 10)})` : 'rgba(0,0,0,.25)';
        c.beginPath();
        c.moveTo(s.x, s.y - r);
        c.lineTo(s.x + r, s.y);
        c.lineTo(s.x, s.y + r);
        c.lineTo(s.x - r, s.y);
        c.closePath();
        c.fill();
        c.stroke();
      }
    }
    if (best) {
      p.wpAim = { e: L, k: best.k };
      c.strokeStyle = '#ffd040';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(best.s.x, best.s.y, 13, 0, Math.PI * 2);
      c.stroke();
      c.font = 'bold 11px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = '#ffd040';
      c.fillText(WP_KINDS[best.k].name, best.s.x, best.s.y + 26);
    }
    c.restore();
  },
});
