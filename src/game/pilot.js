// Game：駕駛員成長——戰鬥中累積經驗與熟練度（房主／單機計算）、任務結算、結果畫面
import { clamp } from '../core/math.js';
import {
  WEAPON_IDS,
  computePilotMods,
  levelOf,
  pilotPayload,
  pointsAt,
  profLevel,
  sanitizePayload,
  weaponPart,
  xpProgress,
} from '../data/pilot.js';
import { FX_LABEL, FX_LOWER, PROF_BONUS } from '../data/skills.js';
import { Game } from './game.js';

// 經驗值規則（可依實測調整）
const XP = {
  kill: 1 / 100, // PvE 擊破：敵人基礎 AP × 此值
  killBoss: 1.5,
  assist: 0.3, // 其他存活隊友分得的比例
  revive: 50,
  stun: 3000, // EMP 暈眩一台敵人換算的熟練度（有效傷害）
  pvpKillPlayer: 60,
  pvpKillAi: 25,
};

Object.assign(Game.prototype, {
  // 車庫／駕駛員畫面預設顯示的模式：多人大廳選了 PVP 時為 pvp
  pilotCtxMode() {
    return this.net && this.net.role && this.net.pvpSet && this.net.pvpSet.mode === 'pvp' ? 'pvp' : 'pve';
  },
  // 本機存檔在指定模式的加成（單機出擊、車庫顯示用）
  pilotLocalMods(mode) {
    const p = sanitizePayload(pilotPayload(this.save));
    return computePilotMods(p[mode], mode);
  },
  // 房主：玩家在指定模式的加成。房主自己用本機存檔（永遠是最新的），其他人用 ready 訊息送來的資料
  pilotModsForPlayer(pl, mode) {
    if (pl.slot === this.net.me) return this.pilotLocalMods(mode);
    return pl.pilot ? computePilotMods(pl.pilot[mode], mode) : null;
  },
  pilotStat(slot) {
    const st = this.mpStats && this.mpStats[slot];
    if (!st) return null;
    if (!st.pf) st.pf = {};
    if (st.xp === undefined) st.xp = 0;
    return st;
  },
  // ---------- 戰鬥中累積（客機不計算，由房主快照同步 mpStats）----------
  pilotCreditHit(from, target, wid, real) {
    if (this.isClient || !from || from.team !== 'player' || from.slot === undefined) return;
    if (!target || target.isProp || !(real > 0) || !WEAPON_IDS.has(wid) || !this.isHostile(from, target))
      return;
    const st = this.pilotStat(from.slot);
    if (!st) return;
    const k = this.pvp && target.team === 'enemy' ? 0.5 : 1; // PvP 打電腦 AC 減半
    st.pf[wid] = (st.pf[wid] || 0) + Math.round(real * k);
  },
  pilotCreditStun(src, target, wid) {
    if (this.isClient || !src || src.team !== 'player' || src.slot === undefined || !WEAPON_IDS.has(wid))
      return;
    const st = this.pilotStat(src.slot);
    if (!st) return;
    const k = (target.isBoss ? 2 : 1) * (this.pvp && target.team === 'enemy' ? 0.5 : 1);
    st.pf[wid] = (st.pf[wid] || 0) + Math.round(XP.stun * k);
  },
  pilotCreditShield(victim, absorbed) {
    if (this.isClient || victim.team !== 'player' || victim.slot === undefined || !(absorbed > 0)) return;
    const w = ['rback', 'lback'].map((s) => victim.weapons[s].def).find((d) => d.type === 'shield');
    const st = w && this.pilotStat(victim.slot);
    if (st) st.pf[w.id] = (st.pf[w.id] || 0) + Math.round(absorbed);
  },
  pilotCreditKill(from, victim) {
    if (this.isClient || !from || from.team !== 'player' || from.slot === undefined) return;
    const st = this.pilotStat(from.slot);
    if (!st) return;
    if (this.pvp) {
      st.xp += victim.team === 'player' ? XP.pvpKillPlayer : XP.pvpKillAi;
      return;
    }
    const base = victim.maxHp / (this.scaleHp || 1); // 以敵人未經關卡加成的 AP 計算
    const kxp = Math.round(base * XP.kill * (victim.isBoss ? XP.killBoss : 1));
    st.xp += kxp;
    for (const e of this.players || [])
      if (e.slot !== from.slot && !e.dead) {
        const o = this.pilotStat(e.slot);
        if (o) o.xp += Math.round(kxp * XP.assist);
      }
  },
  pilotCreditRevive(rescuer) {
    const st = !this.isClient && rescuer.slot !== undefined && this.pilotStat(rescuer.slot);
    if (st) st.xp += XP.revive;
  },
  // ---------- 結算 ----------
  // PvE：回傳 { slot: { x 總經驗, m 任務, k 擊破／支援, pf 熟練度 } }；必須在 save.level 前進之前呼叫
  pilotEndXpPve(success, aborted) {
    const L = this.save.level;
    const base = (180 + 45 * L) * (this.isBossLevel ? 1.8 : 1);
    const out = {};
    for (const slot in this.mpStats || {}) {
      const st = this.pilotStat(slot);
      let m = 0;
      if (success) {
        const e = (this.players || []).find((p) => String(p.slot) === String(slot));
        const taken = e ? e.dmgTaken : st.taken || 0;
        const maxHp = e ? e.maxHp : 1;
        const score = (taken / maxHp) * 0.6 + (Math.max(0, this.missionT - 90) / 180) * 0.4;
        m = base * (score < 0.25 ? 1.3 : score < 0.5 ? 1.15 : score < 0.85 ? 1 : 0.9);
      } else if (!aborted) m = base * 0.25;
      m = Math.round(m);
      out[slot] = { x: m + st.xp, m, k: st.xp, pf: { ...st.pf } };
    }
    return out;
  },
  // 把結算寫入本機存檔，回傳給結果畫面的報告
  pilotGrant(mode, entry) {
    if (!entry || !this.save.pilot) return null;
    const P = this.save.pilot[mode];
    const before = levelOf(P.xp);
    P.xp += Math.max(0, entry.x || 0);
    const after = levelOf(P.xp);
    const ups = [];
    for (const wid in entry.pf || {}) {
      if (!WEAPON_IDS.has(wid)) continue;
      const b = profLevel(P.prof[wid]);
      P.prof[wid] = (P.prof[wid] || 0) + Math.max(0, entry.pf[wid] || 0);
      const a = profLevel(P.prof[wid]);
      if (a > b) ups.push({ wid, from: b, to: a });
    }
    this.writeSave();
    return {
      mode,
      x: entry.x || 0,
      m: entry.m || 0,
      k: entry.k || 0,
      before,
      after,
      points: pointsAt(after) - pointsAt(before),
      ups,
    };
  },
  // 熟練度第 lv 級新增的加成說明
  pilotProfText(type, lv) {
    const b = (PROF_BONUS[type] || [])[lv - 1];
    if (!b) return '';
    return Object.keys(b)
      .map((k) => `${FX_LABEL[k] || k} ${FX_LOWER.has(k) ? '−' : '+'}${Math.round(b[k] * 100)}%`)
      .join('、');
  },
  pilotRenderResult(rep) {
    const el = document.getElementById('rPilot');
    if (!el) return;
    if (!rep) {
      el.innerHTML = '';
      return;
    }
    const pr = xpProgress(this.save.pilot[rep.mode].xp);
    const pctW = pr.need ? clamp((pr.into / pr.need) * 100, 0, 100) : 100;
    let h = `<div class="rpHead">駕駛員經驗（${rep.mode === 'pvp' ? 'PvP' : 'PvE'}）<b>+${rep.x.toLocaleString()}</b> <span class="dim">任務 ${rep.m.toLocaleString()}・擊破／支援 ${rep.k.toLocaleString()}</span></div>`;
    h += `<div class="xpBar"><i style="width:${pctW}%"></i></div>`;
    h += `<div class="dim">Lv ${pr.level}${pr.need ? `　${Math.floor(pr.into).toLocaleString()} / ${pr.need.toLocaleString()}` : '（已達上限）'}</div>`;
    if (rep.after > rep.before)
      h += `<div class="rpUp">等級提升！Lv ${rep.before} → ${rep.after}　技能點 +${rep.points}</div>`;
    for (const u of rep.ups) {
      const p = weaponPart(u.wid);
      h += `<div class="rpUp">${p ? p.name : u.wid} 熟練度 Lv${u.from} → Lv${u.to}（${this.pilotProfText(p && p.type, u.to)}）</div>`;
    }
    el.innerHTML = h;
  },
});
