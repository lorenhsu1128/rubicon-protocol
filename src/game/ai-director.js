// Game：敵人 AI 的導演（只在房主／單機）——攻擊權杖、節奏導演、小隊共享的目標位置、無線電、聲音、防止停擺；
// 以及 HUD 上的警戒標示（房主與客機都畫，客機用快照的 aw）。數值在 data/ai.js，個體的感知在 entities/mech-sense.js。
// 權杖：每個目標同時最多 TOKEN_MAX 台主攻（權重合計不超過預算），沒拿到的退到外圈壓制；優先給玩家看得到的、
// 和其他主攻不同種類的、等最久的。敵對 AC 一律主攻（在場時其他人的預算少 1）。
// 節奏導演：最近 STRESS_T 秒受到的傷害與目前 AP 算出壓力 0～1，壓力高時預算與主攻數變少。
import { clamp, lerp, rnd } from '../core/math.js';
import {
  NOISE,
  RADIO_R,
  STALL_T,
  STRESS_T,
  TOKEN_BUDGET,
  TOKEN_HOLD,
  TOKEN_MAX,
  TOKEN_REST,
  TOKEN_W,
} from '../data/ai.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  aiReset() {
    this.aiD = { t: 0, seen: new Map(), hp: new Map(), dmg: new Map(), stallT: 0 };
  },
  aiDir() {
    if (!this.aiD) this.aiReset();
    return this.aiD;
  },
  // 交戰中的敵人看到目標（小隊共享位置用）
  aiSaw(t, e) {
    const D = this.aiDir();
    let m = D.seen.get(t.id);
    if (!m) D.seen.set(t.id, (m = new Map()));
    m.set(e, this.time);
  },
  // 有沒有在 R 公尺內、最近 0.6 秒看到目標 t 的友軍
  aiSeenNear(t, pos, R) {
    const m = this.aiDir().seen.get(t.id);
    if (!m) return false;
    for (const [e, tm] of m) {
      if (e.dead || this.time - tm > 0.6) continue;
      if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) < R) return true;
    }
    return false;
  },
  // 無線電：附近（指揮官 MT 在場時加倍）與同一小隊的待機敵人進入交戰（被叫來的不再往外傳）
  aiRadio(e) {
    const sn = e.sn;
    const cmd = this.enemies.some((o) => !o.dead && o.ai === 'commander' && o.pos.distanceTo(e.pos) < 50);
    const R = RADIO_R * (cmd ? 2 : 1);
    for (const o of this.enemies) {
      if (o === e || o.dead || !o.sn || o.sn.st === 2) continue;
      const near = o.pos.distanceTo(e.pos) < R;
      if (near || (e.sq && o.sq === e.sq)) o.senseEngage(sn.tgt, false);
    }
  },
  // 聲音：玩家開火、QB（src＝發出聲音的機體）
  aiNoise(src, r) {
    if (!r || (this.net && this.net.role === 'client')) return;
    for (const o of this.enemies) if (o.sn && o.sn.st !== 2) o.senseHear(src.pos, r, src);
  },
  aiFireNoise(src, type) {
    src.firedT = 0.6;
    this.playerFiredAt = 0.3; // 敵人的閃避（房主處理客機開火時也算）
    this.aiNoise(src, NOISE[type] || 40);
  },
  aiRelease(e) {
    const sn = e.sn;
    if (!sn || !sn.tok) return;
    sn.tok = false;
    sn.restT = rnd(TOKEN_REST[0], TOKEN_REST[1]);
    sn.lastHeld = this.time;
    if (sn.mv && sn.mv.ph !== 'rec') sn.mv = null;
  },
  // 目標 t 看不看得到 e：本機玩家用鏡頭（畫面外緣再放寬一圈：拿到權杖後會走進畫面、招式有預警），
  // 遠端玩家與友軍用機體面向（約 160° 內）或 30 m 內
  aiInView(t, e) {
    if (t === this.player && this.camera) {
      const p = e.center().project(this.camera);
      return p.z < 1 && p.z > -1 && Math.abs(p.x) < 1.4 && Math.abs(p.y) < 1.4;
    }
    const dx = e.pos.x - t.pos.x,
      dz = e.pos.z - t.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 30) return true;
    const yaw = t.aimYaw !== undefined ? t.aimYaw : t.yaw;
    return (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / d > 0.17;
  },
  // 壓力 0～1：最近 STRESS_T 秒受到的傷害（AP 比例）＋目前 AP 的缺口
  aiStress(t) {
    if (!t.isPlayer) return 0.4;
    const D = this.aiDir();
    const h = D.dmg.get(t.id) || [];
    let sum = 0;
    for (const [tm, v] of h) if (this.time - tm < STRESS_T) sum += v;
    return clamp(sum * 2.2 + (1 - t.hp / t.maxHp) * 0.5, 0, 1);
  },
  // 每格（房主／單機，任務中）
  aiDirectorTick(dt) {
    if (this.pvp || this.range || this.lab) return;
    const D = this.aiDir();
    // 玩家受到的傷害紀錄（節奏導演）
    for (const p of this.players && this.players.length ? this.players : [this.player]) {
      if (!p) continue;
      const last = D.hp.get(p.id);
      if (last !== undefined && p.hp < last && !p.dead) {
        let h = D.dmg.get(p.id);
        if (!h) D.dmg.set(p.id, (h = []));
        h.push([this.time, (last - p.hp) / p.maxHp]);
        while (h.length && this.time - h[0][0] > STRESS_T) h.shift();
      }
      D.hp.set(p.id, p.hp);
      if (p.firedT > 0) p.firedT -= dt;
    }
    for (const e of this.enemies) if (e.sn && e.sn.tok) e.sn.tokT += dt;
    // 沒有交戰中的敵人太久：最近的待機敵人（不含守衛）帶著小隊來找玩家
    const live = this.enemies.filter((e) => !e.dead && e.sn && e.sn.on && !e.guardOf);
    if (live.length && !live.some((e) => e.sn.st === 2)) {
      D.stallT += dt;
      if (D.stallT > STALL_T) {
        D.stallT = 0;
        const pl = this.playersAlive()[0];
        if (pl) {
          live.sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos));
          const e0 = live[0];
          for (const o of live)
            if (o === e0 || o.pos.distanceTo(e0.pos) < 30 || (e0.sq && o.sq === e0.sq)) {
              o.sn.st = 3;
              o.sn.srchT = 0;
              o.sn.kn = pl.pos.clone().add(new THREE.Vector3(rnd(-8, 8), 0, rnd(-8, 8)));
            }
        }
      }
    } else D.stallT = 0;
    D.t -= dt;
    if (D.t > 0) return;
    D.t = 0.3;
    // 權杖：依目標分組
    const groups = new Map();
    for (const e of this.enemies) {
      const sn = e.sn;
      if (!sn || !sn.on || e.dead) continue;
      if (sn.st !== 2 || !sn.tgt || sn.tgt.dead) {
        if (sn.tok) this.aiRelease(e);
        continue;
      }
      let g = groups.get(sn.tgt);
      if (!g) groups.set(sn.tgt, (g = []));
      g.push(e);
    }
    for (const [t, list] of groups) {
      const stress = this.aiStress(t);
      let budget = lerp(TOKEN_BUDGET[1], TOKEN_BUDGET[0], stress);
      const aces = list.filter((e) => e.ace);
      for (const a of aces) a.sn.tok = true;
      // 敵對 AC 在場時其他人的名額與預算都少 1（至少 1 台）
      const maxN = Math.max(1, (stress > 0.6 ? 2 : TOKEN_MAX) - (aces.length ? 1 : 0));
      if (aces.length) budget -= 1;
      const others = list.filter((e) => !e.ace);
      // 交出權杖：時間到（招式放完）、看不到目標太久
      for (const e of others) {
        const sn = e.sn;
        if (!sn.tok) continue;
        if ((sn.tokT > sn.hold && !(sn.mv && sn.mv.ph !== 'rec')) || sn.blind > 2.5) this.aiRelease(e);
      }
      const holders = others.filter((e) => e.sn.tok);
      let used = holders.reduce((s, e) => s + (TOKEN_W[e.etype] || 1), 0);
      const cands = others.filter((e) => !e.sn.tok && e.sn.restT <= 0 && e.sn.los && this.aiInView(t, e));
      if (!cands.length) continue;
      const types = new Set(holders.map((e) => e.etype));
      for (const e of cands) {
        const d = e.pos.distanceTo(t.pos);
        e.sn.score =
          (this.time - e.sn.lastHeld) * 0.6 + (types.has(e.etype) ? 0 : 3) - d / 40 + Math.random();
      }
      cands.sort((a, b) => b.sn.score - a.sn.score);
      for (const e of cands) {
        if (holders.length >= maxN) break;
        const w = TOKEN_W[e.etype] || 1;
        if (used + w > budget && holders.length) continue;
        const sn = e.sn;
        sn.tok = true;
        sn.tokT = 0;
        sn.hold = rnd(TOKEN_HOLD[0], TOKEN_HOLD[1]);
        sn.mvCd = Math.min(sn.mvCd, rnd(0.2, 0.8));
        holders.push(e);
        used += w;
      }
    }
  },
  // HUD：名牌上的警戒標示（? 起疑／搜索、! 剛發現、主攻的紅色箭頭、破綻）；s＝名牌在畫面上的位置
  drawAwareMark(c, e, s) {
    const aw = e.sn ? e.senseAw() : e.aw || 0;
    if (!aw) return;
    const st = (aw - 1) & 7;
    const tok = aw & 8,
      vuln = aw & 16;
    const now = this.time;
    if (e._awSt !== st) {
      if (st === 2 && e._awSt !== undefined) e._awSpot = now;
      e._awSt = st;
    }
    c.save();
    c.textAlign = 'center';
    c.lineWidth = 3;
    c.strokeStyle = 'rgba(0,0,0,.75)';
    let mark = null,
      col = null;
    if (st === 1 || st === 3) {
      mark = '?';
      col = '#ffd040';
    } else if (st === 2 && now - (e._awSpot || -9) < 1.4) {
      mark = '!';
      col = '#ff3a2a';
    }
    if (mark) {
      c.font = 'bold 22px Chakra Petch';
      const y = s.y - 16 - (mark === '!' ? Math.max(0, 0.25 - (now - e._awSpot)) * 30 : 0);
      c.strokeText(mark, s.x, y);
      c.fillStyle = col;
      c.fillText(mark, s.x, y);
    }
    if (tok && st === 2) {
      // 主攻：名牌上方的紅色箭頭
      const y = s.y - (mark ? 40 : 14),
        k = 1 + 0.15 * Math.sin(now * 8);
      c.fillStyle = '#ff4a3a';
      c.beginPath();
      c.moveTo(s.x - 6 * k, y - 7 * k);
      c.lineTo(s.x + 6 * k, y - 7 * k);
      c.lineTo(s.x, y);
      c.closePath();
      c.stroke();
      c.fill();
    }
    if (vuln) {
      c.font = 'bold 11px Chakra Petch';
      c.strokeText('OVERHEAT', s.x, s.y - 4);
      c.fillStyle = '#ffb040';
      c.fillText('OVERHEAT', s.x, s.y - 4);
    }
    c.restore();
  },
});
