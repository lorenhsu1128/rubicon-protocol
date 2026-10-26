// ============================================================
//  畫面的打擊回饋（動作遊戲風格）：傷害數字（跳出、依傷害放大、連續命中合併）、
//  連殺計數、BREAK、受到重擊的閃光與色差、低 AP 的紅色邊框、QB 的速度線、
//  增援方向的畫面邊緣警示、Boss 登場與擊破的橫幅
// ============================================================
import { Game } from './game.js';
import { clamp, lerp } from '../core/math.js';

const POP_MERGE = 0.3; // 同一個目標在這段時間內的非近戰命中合併成一個數字
const POP_MERGE_C = 0.6; // 精簡模式：合併的時間更長（近戰也合併），連射時只剩一個累加的數字
const POP_LIFE = { num: 0.6, melee: 0.8, tag: 1.0 }; // 顯示秒數
const POP_FADE = 0.2; // 最後幾秒淡出
const POP_POP = 0.25; // 剛跳出時放大的比例
const POP_RISE = 70; // 數字整段往上飄的距離（px／秒 × 顯示秒數）
const POP_OUT = 30; // 數字整段往外（離開機體）飄的距離
const _v = new THREE.Vector3(),
  _r = new THREE.Vector3();
const STREAK_NAMES = [
  [8, '無人能擋'],
  [6, '殲滅'],
  [5, '狂暴'],
  [4, '四連殺'],
  [3, '三連殺'],
  [2, '雙殺'],
];
const font = (px) => `bold ${Math.round(px)}px Chakra Petch`;

Object.assign(Game.prototype, {
  // 加入一個傷害數字（hud.js 的 popDamage 呼叫）；key＝目標，用來合併連續命中。
  // 數字一律畫在目標機體的輪廓外（左右兩側輪流、往外上方飄），狀態字（BREAK、連攜…）
  // 疊在名牌上方，所以不會蓋住機體
  pushPopup(pos, val, onPlayer, stag, melee, combo, key) {
    const num = typeof val === 'number';
    const mode = (this.ctrl && this.ctrl.dmgNum) || 'full';
    if (num && (mode === 'off' || (onPlayer && this.ctrl && this.ctrl.dmgSelf === false))) return;
    const ent = this.popEnt(pos, key);
    const k = ent ? ent.id : key;
    if (num && k !== undefined && (!melee || mode === 'compact')) {
      const win = mode === 'compact' ? POP_MERGE_C : POP_MERGE;
      const q = this.popups.find((x) => x.key === k && x.num && !!x.melee === !!melee && x.age < win);
      if (q) {
        q.val += val;
        q.age = 0;
        q.pop = 1;
        q.life = q.max;
        q.stag = q.stag || stag;
        q.combo = combo || q.combo;
        q.pos.lerp(pos, 0.3);
        return;
      }
    }
    const life = melee ? POP_LIFE.melee : num ? POP_LIFE.num : POP_LIFE.tag;
    // 同一個目標的數字左右輪流
    let alt = 0;
    if (num && k !== undefined) {
      this.popAlt = this.popAlt || new Map();
      alt = this.popAlt.get(k) ? 0 : 1;
      this.popAlt.set(k, alt);
      if (this.popAlt.size > 200) this.popAlt.clear();
    }
    this.popups.push({
      pos: pos.clone(),
      val,
      num,
      life,
      max: life,
      age: 0,
      pop: 1,
      ent,
      alt,
      side: 0, // 第一次畫的時候決定（離畫面中心遠的那一側）
      box: null, // 目標最後一次在畫面上的外框（目標消失後沿用）
      dx: (Math.random() * 2 - 1) * 22,
      onPlayer,
      stag,
      melee,
      combo,
      key: k,
    });
  },
  // 數字屬於哪個實體：有 key 時照 id 找，沒有時找命中點附近的機體（PARRY、GUARD BREAK…）
  popEnt(pos, key) {
    if (key !== undefined && key !== -1 && this.entById) {
      const e = this.entById(key);
      if (e && e.model && e.pos) return e;
    }
    if (key !== undefined) return null;
    let best = null,
      bd = Infinity;
    const list = [this.player, ...(this.players || []), ...(this.enemies || []), ...(this.allies || [])];
    for (const e of list) {
      if (!e || e.dead || !e.model || !e.pos) continue;
      const d = e.center().distanceTo(pos) - e.radius * 1.6;
      if (d < 0 && d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  },
  // 實體在畫面上的外框：cx、上緣、下緣、半寬（像素）
  popBox(e) {
    const h = (e.model && e.model.height) || e.radius * 2;
    const base = this.proj(e.pos);
    const top = this.proj(_v.copy(e.pos).setY(e.pos.y + h));
    if (!base.in && !top.in) return null;
    _r.setFromMatrixColumn(this.camera.matrixWorld, 0);
    const c = e.center();
    const sc = this.proj(c);
    const sr = this.proj(c.add(_r.multiplyScalar(e.radius)));
    return {
      cx: sc.x,
      top: Math.min(base.y, top.y),
      bot: Math.max(base.y, top.y),
      w: Math.max(12, Math.abs(sr.x - sc.x)),
    };
  },
  // 每格更新數字的時間（主迴圈）；位置在畫的時候依目標的外框算
  tickPopups(dt) {
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const q = this.popups[i];
      q.life -= dt;
      q.age = (q.age || 0) + dt;
      q.pop = Math.max(0, (q.pop || 0) - dt * 7);
      if (q.life <= 0) this.popups.splice(i, 1);
    }
  },
  // 傷害數字：數值越大字越大，剛跳出時稍微放大再縮回，打在失衡中的敵人是金色、近戰是橘色、自己受傷是紅色
  drawPopups(c) {
    const W = innerWidth,
      H = innerHeight;
    const ph = H < 540 ? 0.65 : 1;
    const compact = ((this.ctrl && this.ctrl.dmgNum) || 'full') === 'compact';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 狀態字的堆疊：同一個目標的依出現順序往上排
    const lanes = new Map();
    for (const q of this.popups) {
      if (q.num) continue;
      const lk = q.ent || q;
      q.slot = lanes.get(lk) || 0;
      lanes.set(lk, q.slot + 1);
    }
    for (const q of this.popups) {
      const a = clamp(q.life / POP_FADE, 0, 1) * (q.num && !q.stag && !q.melee && !q.onPlayer ? 0.85 : 1);
      if (q.ent && !q.ent.dead && q.ent.model) {
        const b = this.popBox(q.ent);
        if (b) q.box = b;
      }
      let px, col, glow;
      if (!q.num) {
        // 文字（BREAK、GUARD BREAK、PARRY…）
        px = 22;
        col = q.stag ? '#ffcf40' : '#9fe8ff';
        glow = col;
      } else {
        const v = Math.abs(q.val);
        px = q.onPlayer ? 15 : 12 + Math.min(18, Math.sqrt(v) * 0.5);
        if (q.melee) px += 6;
        if (q.stag) px += 4;
        if (compact) px *= 0.8;
        col = q.onPlayer
          ? '#ff5050'
          : q.melee
            ? '#ff7a30'
            : q.stag
              ? '#ffd040'
              : v >= 600
                ? '#ffb020'
                : '#ffffff';
        glow = q.onPlayer ? null : q.stag || q.melee || v >= 600 ? col : null;
      }
      // 遠的目標字小一點（以畫面上的身高判斷）
      const far = q.box ? clamp((q.box.bot - q.box.top) / 160, 0.72, 1) : 1;
      px *= ph * far * (1 + q.pop * POP_POP);
      const txt = q.num ? String(Math.round(q.val)) + (q.stag && !q.onPlayer ? '!' : '') : q.val;
      c.font = font(px);
      let x, y;
      const ease = 1 - Math.pow(1 - Math.min(1, q.age / q.max), 2); // 先快後慢
      if (q.box) {
        const b = q.box;
        if (!q.num) {
          x = b.cx;
          // 名牌上方放不下（目標在畫面上緣）時改排在腳下
          const up = b.top - (54 + (lanes.get(q.ent) - 1) * 26) * ph - 12 > 16 * ph;
          y = up ? b.top - (54 + q.slot * 26) * ph - ease * 12 : b.bot + (22 + q.slot * 26) * ph + ease * 12;
        } else {
          if (!q.side) q.side = b.cx >= W / 2 ? 1 : -1;
          const side = q.alt ? -q.side : q.side;
          const tw = c.measureText(txt).width;
          const s = this.proj(q.pos);
          const y0 = clamp(s.in ? s.y : (b.top + b.bot) / 2, b.top + px * 0.5, b.bot - px * 0.5);
          x = b.cx + side * (b.w + 10 + tw / 2 + ease * POP_OUT * q.max);
          y = y0 - ease * POP_RISE * q.max;
        }
      } else {
        // 沒有對應的機體（地圖物件、投射物）：照舊在命中點，往上飄
        const s = this.proj(q.pos);
        if (!s.in) continue;
        x = s.x + q.dx * Math.min(1, q.age * 6);
        y = s.y - ease * POP_RISE * q.max;
      }
      q.sx = x; // 畫面上的位置（冒煙測試檢查不蓋住機體）
      q.sy = y;
      c.globalAlpha = a;
      c.lineJoin = 'round';
      c.lineWidth = Math.max(3, px * 0.18);
      c.strokeStyle = 'rgba(0,0,0,.75)';
      if (glow) {
        c.shadowColor = glow;
        c.shadowBlur = 6 + q.pop * 10;
      }
      c.strokeText(txt, x, y);
      c.fillStyle = col;
      c.fillText(txt, x, y);
      c.shadowBlur = 0;
      if (q.melee && !q.onPlayer && q.combo > 0 && !compact) {
        c.font = font(13 * ph * far * (1 + q.pop * 0.3));
        c.lineWidth = 3;
        const t2 = 'HIT ×' + q.combo;
        c.strokeText(t2, x, y + px * 0.85);
        c.fillStyle = '#ffe0a0';
        c.fillText(t2, x, y + px * 0.85);
      }
    }
    c.globalAlpha = 1;
    c.textBaseline = 'alphabetic';
  },
  // 受到重擊：畫面閃一下並加一點色差（k 0～1）
  screenHit(k) {
    this.hitFlashK = Math.max(this.hitFlashK || 0, k);
    this.chromaK = Math.max(this.chromaK || 0, k);
  },
  // 打出失衡：BREAK 字樣（疊在目標的名牌上方，鎖定中且鏡頭瞄準時在準星下方）
  popBreak(t) {
    this.pushPopup(t.center(), 'BREAK', false, true, false, 0, t.id);
  },
  // 畫面邊緣的回饋（drawHud 結尾呼叫）
  drawJuice(c, W, H, p, dt) {
    const t = this.time || 0;
    // 速度線：QB、突擊推進、高速推進時從畫面中心往外
    const sp = Math.hypot(p.vel.x, p.vel.z);
    const sk = p.dead ? 0 : p.qbT > 0 ? 1 : p.abT > 0 ? 0.8 : p.boost && sp > 22 ? 0.35 : 0;
    this.speedK = lerp(this.speedK || 0, sk, Math.min(1, dt * (sk > (this.speedK || 0) ? 20 : 5)));
    if (this.speedK > 0.03 && !this.fp) {
      const cx = W / 2,
        cy = H / 2,
        R = Math.hypot(W, H) / 2;
      c.save();
      c.strokeStyle = '#ffffff';
      c.lineCap = 'round';
      const n = Math.round(26 * this.speedK);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2,
          r0 = R * (0.55 + Math.random() * 0.25),
          r1 = r0 + R * (0.2 + Math.random() * 0.35) * this.speedK;
        c.globalAlpha = (0.08 + Math.random() * 0.18) * this.speedK;
        c.lineWidth = 1 + Math.random() * 2.5;
        c.beginPath();
        c.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
        c.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
        c.stroke();
      }
      c.restore();
    }
    // 受到重擊的閃光
    if (this.hitFlashK > 0) {
      c.fillStyle = `rgba(255,235,220,${this.hitFlashK * 0.28})`;
      c.fillRect(0, 0, W, H);
      this.hitFlashK = Math.max(0, this.hitFlashK - dt * 4);
    }
    if (this.chromaK > 0) this.chromaK = Math.max(0, this.chromaK - dt * 2.5);
    // 低 AP：紅色邊框，跟著心跳閃
    const low = p.dead ? 0 : clamp((0.3 - p.hp / p.maxHp) / 0.3, 0, 1);
    if (low > 0) {
      const beat = 0.6 + 0.4 * Math.pow(Math.max(0, Math.sin(t * lerp(5.5, 11, low))), 6);
      const g = c.createRadialGradient(
        W / 2,
        H / 2,
        Math.min(W, H) * 0.48,
        W / 2,
        H / 2,
        Math.hypot(W, H) / 2,
      );
      g.addColorStop(0, 'rgba(255,0,0,0)');
      g.addColorStop(1, `rgba(200,0,0,${(0.16 + 0.26 * low) * beat})`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
    this.drawWaveEdges(c, W, H, p);
    this.drawStreak(c, W, H, dt);
    this.drawBanner(c, W, H, dt);
  },
  // 增援方向：預告後幾秒，畫面邊緣朝那個方向發紅光
  drawWaveEdges(c, W, H, p) {
    for (const m of this.waveMarks || []) {
      if (m.g0 === undefined) m.g0 = m.t;
      const k = clamp((m.t - (m.g0 - 3)) / 3, 0, 1);
      if (k <= 0) continue;
      const s = this.proj(m.pos);
      if (s.in && s.x > 0 && s.x < W && s.y > 0 && s.y < H) continue;
      let dx = s.x - W / 2,
        dy = s.y - H / 2;
      if (s.behind) {
        dx = -dx;
        dy = -dy;
      }
      const ang = Math.atan2(dy, dx);
      const blink = 0.6 + 0.4 * Math.sin(this.time * 12);
      const ex = W / 2 + Math.cos(ang) * W * 0.5,
        ey = H / 2 + Math.sin(ang) * H * 0.5;
      const g = c.createRadialGradient(ex, ey, 0, ex, ey, Math.min(W, H) * 0.45);
      const col = m.drop ? '255,160,32' : '255,50,40';
      g.addColorStop(0, `rgba(${col},${0.4 * k * blink})`);
      g.addColorStop(1, `rgba(${col},0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
  },
  // 連殺計數：右側，數字跳出、計時條、等級名稱
  drawStreak(c, W, H, dt) {
    const s = this.killStreak;
    if (!s) return;
    s.t -= dt;
    s.pop = Math.max(0, s.pop - dt * 5);
    if (s.t <= 0) {
      this.killStreak = null;
      return;
    }
    if (s.n < 2 && !s.big) return;
    const ph = innerHeight < 540 ? 0.65 : 1;
    const a = clamp(s.t / 0.5, 0, 1);
    const x = W - 40 * ph,
      y = H * 0.36;
    const hot = clamp((s.n - 2) / 6, 0, 1);
    const col = `rgb(255,${Math.round(lerp(220, 70, hot))},${Math.round(lerp(90, 40, hot))})`;
    c.save();
    c.globalAlpha = a;
    c.textAlign = 'right';
    c.textBaseline = 'alphabetic';
    c.lineJoin = 'round';
    const px = (46 + Math.min(s.n, 10) * 3) * ph * (1 + s.pop * 0.6);
    c.font = font(px);
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(0,0,0,.75)';
    c.shadowColor = col;
    c.shadowBlur = 14 + s.pop * 20;
    const num = s.n >= 2 ? `×${s.n}` : '';
    if (num) {
      c.strokeText(num, x, y);
      c.fillStyle = col;
      c.fillText(num, x, y);
    }
    c.shadowBlur = 0;
    const name = s.big && s.pop > 0.2 ? '王牌擊破' : (STREAK_NAMES.find(([n]) => s.n >= n) || [0, ''])[1];
    if (name) {
      c.font = font(20 * ph * (1 + s.pop * 0.3));
      c.lineWidth = 4;
      c.strokeText(name, x, y + 26 * ph);
      c.fillStyle = s.big ? '#ffd040' : '#ffe8c0';
      c.fillText(name, x, y + 26 * ph);
    }
    // 連殺的剩餘時間
    const bw = 120 * ph;
    c.fillStyle = 'rgba(0,0,0,.5)';
    c.fillRect(x - bw, y + 36 * ph, bw, 4);
    c.fillStyle = col;
    c.fillRect(x - bw * (s.t / 4), y + 36 * ph, bw * (s.t / 4), 4);
    c.restore();
  },
  // 橫幅：Boss 登場（WARNING）與擊破
  // o：文字演出 { k, m, s }（開著時改用 game/textfx.js）
  showBanner(txt, sub, col = '#ff4030', dur = 2.6, o) {
    if (o && this.tfx(o.k, o.m || txt, o.s != null ? o.s : sub)) return;
    this.banner = { txt, sub, col, t: dur, max: dur };
  },
  drawBanner(c, W, H, dt) {
    // Boss 登場：每個 Boss 第一次出現在場上時（房主與客機各自判斷）
    for (const b of this.bosses || []) {
      if (b.introShown || b.dead) continue;
      b.introShown = true;
      if (this.lab) continue;
      this.showBanner('WARNING', b.name, '#ff4030', 2.8, { k: 'warning' });
      if (/^ECHO-/.test(b.name)) this.tfx('echo', '殘響反應', 'ECHO');
    }
    const B = this.banner;
    if (!B) return;
    B.t -= dt;
    if (B.t <= 0) {
      this.banner = null;
      return;
    }
    const e = B.max - B.t;
    const a = Math.min(1, e / 0.2, B.t / 0.4);
    const ph = innerHeight < 540 ? 0.65 : 1;
    const y = H * 0.19;
    c.save();
    c.globalAlpha = a;
    // 斜紋警示帶
    const h = 64 * ph;
    c.fillStyle = 'rgba(0,0,0,.55)';
    c.fillRect(0, y - h / 2, W, h);
    c.strokeStyle = B.col;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, y - h / 2);
    c.lineTo(W, y - h / 2);
    c.moveTo(0, y + h / 2);
    c.lineTo(W, y + h / 2);
    c.stroke();
    c.globalAlpha = a * 0.35;
    c.fillStyle = B.col;
    const off = (e * 80) % 40;
    for (let x = -40 + off; x < W; x += 40) {
      c.beginPath();
      c.moveTo(x, y - h / 2);
      c.lineTo(x + 14, y - h / 2);
      c.lineTo(x + 4, y - h / 2 - 8 * ph);
      c.lineTo(x - 10, y - h / 2 - 8 * ph);
      c.fill();
      c.beginPath();
      c.moveTo(x, y + h / 2);
      c.lineTo(x + 14, y + h / 2);
      c.lineTo(x + 4, y + h / 2 + 8 * ph);
      c.lineTo(x - 10, y + h / 2 + 8 * ph);
      c.fill();
    }
    c.globalAlpha = a;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    const sc = 1 + Math.max(0, 0.25 - e) * 2;
    c.font = font(34 * ph * sc);
    c.shadowColor = B.col;
    c.shadowBlur = 18;
    c.fillStyle = B.col;
    c.fillText(B.txt, W / 2, y - 8 * ph);
    c.shadowBlur = 0;
    if (B.sub) {
      c.font = font(15 * ph);
      c.fillStyle = '#ffffff';
      c.fillText(B.sub, W / 2, y + 18 * ph);
    }
    c.restore();
  },
});
