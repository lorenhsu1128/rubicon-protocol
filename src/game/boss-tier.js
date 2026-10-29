// Game 的 mixin：Boss 改版的共用部分（docs/boss-design.md、data/boss-tier.js；Boss 自己的判定在 entities/mech-boss-tier.js）。
// K 的雜兵小隊與破甲充能、O 的擊破評價與獎勵、第一次遇到機制的說明、HUD（打斷量表、破綻、破甲充能、風格加成）。
// 判定只在房主／單機；客機用快照的 bt（Boss）、bk（自己的破甲充能）與 bossDown 事件的評價顯示。
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { DS } from '../core/scale.js';
import { clamp } from '../core/math.js';
import { syRank } from '../data/style-meter.js';
import {
  K_SQUAD_MAX,
  K_SQUAD_T,
  L_BONUS,
  O_COAM,
  O_PAR,
  aNeedK,
  aStagT,
  campaignTier,
  freeTier,
  kSquad,
  oRank,
  tierRow,
} from '../data/boss-tier.js';

// 冒煙測試（網址帶 ?test）：刁鑽度的換算
if (typeof window !== 'undefined' && /[?&]test/.test(location.search))
  window.__bossTier = { campaignTier, freeTier, oRank, aNeedK, aStagT };

Object.assign(Game.prototype, {
  // 目前這場 Boss 戰的刁鑽度（還有活著的 Boss 且有刁鑽度時；否則 0）
  tierFightTier() {
    if (this.range || this.lab || this.pvp || this.cine) return 0;
    const b = (this.bosses || []).find((x) => !x.dead && x.opts && x.opts.tier);
    return b ? b.opts.tier : 0;
  },
  // 第一次遇到某個機制：跳一次說明（記在存檔，多人時只有房主自己的存檔）
  tierIntro(key, txt) {
    const S = this.save;
    if (!S) return;
    const seen = S.tierSeen || (S.tierSeen = {});
    if (seen[key]) return;
    seen[key] = 1;
    this.writeSave();
    this.flashAlert(txt);
  },
  // 掉一個彈藥箱（打斷大招）
  tierDropAmmo(b) {
    if (!this.world || (this.net && this.net.role === 'client')) return;
    const [x, z] = this.world.nearSolid ? this.world.nearSolid(b.pos.x, b.pos.z) : [b.pos.x, b.pos.z];
    const off = 6 * DS;
    const a = Math.random() * Math.PI * 2;
    const px = x + Math.cos(a) * off,
      pz = z + Math.sin(a) * off;
    this.spawnPickup('ammo', new THREE.Vector3(px, this.world.groundAt(px, pz, b.pos.y + 1) + 0.6, pz));
  },
  // 大招「投放空降兵」：Boss 附近空降 n 台雜兵
  tierDrop(b, n) {
    this.waveAt = { pos: b.pos.clone(), drop: true };
    for (let i = 0; i < n; i++) this.spawnType(i ? 'mt' : 'mt_shot', this.scaleHp, this.scaleDmg, null, 1);
    this.waveAt = null;
  },
  // bossPhaseTick 每格（房主／單機）：雜兵小隊、破甲充能的減少
  bossTierTick(dt) {
    const t = this.tierFightTier();
    if (!t) return;
    for (const p of this.players || []) if (p && !p.dead && p.bkTick) p.bkTick(dt, t);
    this.kSquadT = (this.kSquadT === undefined ? K_SQUAD_T : this.kSquadT) - dt;
    if (this.kSquadT > 0) return;
    this.kSquadT = K_SQUAD_T;
    const grunts = this.enemies.filter(
      (e) => !e.dead && !e.isBoss && e.ai !== 'part' && e.ai !== 'holo' && !e.guardOf,
    ).length;
    if (grunts >= K_SQUAD_MAX) return;
    const tgt = this.playersAlive()[0];
    if (!tgt || !this.waveEdgePoint) return;
    const T = tierRow(t);
    this.waveAt = { pos: this.waveEdgePoint(tgt.pos), drop: false };
    let last = null;
    for (const k of kSquad(t)) {
      last = this.spawnType(k, this.scaleHp, this.scaleDmg, null, 1); // 一台一台（不照編隊數量）
      // 刁鑽度 7～8：會閃避與躲掩體（技巧較高、會找射線）
      if (last && T.kSmart) last.aiSkill = Math.max(last.aiSkill || 1, 1.25);
    }
    this.waveAt = null;
    this.flashAlert('敵方小隊進入戰區 — 擊破累積破甲充能');
  },
  // 擊破敵人（onEnemyKilled，房主／單機）：Boss 戰中擊破雜兵累積破甲充能
  tierOnKill(e, from) {
    if (!from || !from.pilotEnt || !from.pilotEnt() || e.isBoss || e.ai === 'part' || e.ai === 'holo') return;
    if (!this.tierFightTier()) return;
    from.bkAdd();
  },
  // 最後一個 Boss 擊破（die）：依時間給 S／A／B
  tierBossRank(b) {
    const t = b.opts && b.opts.tier;
    if (!t || this.range || this.lab) return null;
    const sec = this.bossFightT || 0;
    const par = (this.bossDef && this.bossDef.par) || O_PAR;
    const r = oRank(t, sec, par);
    this.bossRank = { r, sec, t };
    if (this.camp && r === 'S') this.camp.bossS = true; // 主線：結算時多一個戰術模組三選一
    return this.bossRank;
  },
  // Boss 擊破獎金的倍率（最後一個 Boss）
  tierBountyK(e) {
    if (!e.isBoss || !this.bossRank || !(this.bosses || []).every((b) => b.dead)) return 1;
    return O_COAM[this.bossRank.r] || 1;
  },
  // 評價 S 的戰術模組三選一：出擊的委託方（沒有時隨機）
  tierPickFaction(so) {
    const ks = ['castron', 'aetheric', 'veerwell', 'sancta'];
    const f = so && so.faction;
    return ks.includes(f) ? f : ks[Math.floor(Math.random() * ks.length)];
  },
  tierRankTxt(rk) {
    if (!rk) return '';
    const m = Math.floor(rk.sec / 60),
      s = Math.floor(rk.sec % 60);
    return `評價 ${rk.r}（${m}:${String(s).padStart(2, '0')}）`;
  },
  // ---------- HUD ----------
  // Boss 血條下的打斷量表與破綻（DOM）、Boss 頭上的量表（畫布）、自己的破甲充能、風格評價的傷害加成
  tierHud(c, p, W, H) {
    const bar = document.getElementById('bossTier');
    const bs = (this.bosses || []).filter((b) => !b.dead);
    let v = null,
      vb = null;
    for (const b of bs) {
      const x = b.tierView && b.tierView();
      if (x && (x.chg >= 0 || x.open > 0)) {
        v = x;
        vb = b;
        if (x.chg >= 0) break;
      }
    }
    if (bar) {
      if (!v) bar.style.display = 'none';
      else {
        bar.style.display = 'block';
        const lab = document.getElementById('bossTierLab'),
          fill = document.getElementById('bossTierFill');
        if (v.chg >= 0) {
          bar.className = 'chg' + (v.guard ? ' guard' : '');
          lab.textContent = `${v.second ? '再次蓄力' : '蓄力中'}：${v.name} — 打斷 ${Math.round(v.gauge * 100)}%`;
          fill.style.width = clamp(v.gauge * 100, 0, 100) + '%';
          document.getElementById('bossTierT').style.width = clamp((1 - v.chg) * 100, 0, 100) + '%';
        } else {
          bar.className = 'open';
          lab.textContent = v.fake ? '破綻？' : `破綻！ ${v.open.toFixed(1)}s`;
          fill.style.width = '100%';
          document.getElementById('bossTierT').style.width = '0%';
        }
      }
    }
    // Boss 頭上：蓄力中的量表
    if (vb && v && v.chg >= 0) {
      const s = this.proj(vb.center().setY(vb.center().y + (vb.model.height || 4) * 0.7 + 2 * DS));
      if (s.in) {
        const w = 90;
        c.save();
        c.fillStyle = 'rgba(0,0,0,.6)';
        c.fillRect(s.x - w / 2 - 2, s.y - 64, w + 4, 9);
        c.fillStyle = '#7fd8ff';
        c.fillRect(s.x - w / 2, s.y - 62, w * clamp(v.gauge, 0, 1), 5);
        c.fillStyle = '#ff7030';
        c.fillRect(s.x - w / 2, s.y - 56, w * clamp(1 - v.chg, 0, 1), 2);
        c.font = 'bold 11px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = '#ffd0a0';
        c.fillText('打斷！', s.x, s.y - 68);
        c.restore();
      }
    }
    // 破甲充能（EN 條旁）
    const bk = document.getElementById('bkWrap');
    const t = this.tierFightTier(); // 客機的 Boss 也帶著生成紀錄的刁鑽度（bt）
    if (bk) {
      const show = t > 0 && p && !p.dead;
      bk.style.display = show ? '' : 'none';
      if (show) {
        const f = p.remote || (this.net && this.net.role === 'client') ? p.bkC || 0 : p.bkFrac(t);
        document.getElementById('bkBar').style.width = clamp(f * 100, 0, 100) + '%';
        bk.classList.toggle('full', f >= 1);
      }
    }
    // 風格評價的傷害加成（風格評價的等級下方）
    if (t > 0 && p) {
      const client = this.net && this.net.role === 'client';
      const st = client ? this.syC : p.sy;
      const r = st ? syRank(st.pts) : -1;
      if (L_BONUS[r]) {
        // 電腦：等級的大字上方；觸控：大字左邊（上方是暫停等按鈕）
        const touch = document.body.classList.contains('vpad');
        const x = W - (touch ? 198 : 110),
          y = H * (touch ? 0.3 : 0.36) + (touch ? -12 : -62);
        c.save();
        c.textAlign = touch ? 'right' : 'center';
        c.font = 'bold 11px Chakra Petch';
        c.fillStyle = '#ffd040';
        c.shadowColor = 'rgba(0,0,0,.85)';
        c.shadowBlur = 5;
        c.fillText(`BOSS 傷害 +${Math.round(L_BONUS[r] * 100)}%`, x, y);
        c.restore();
      }
    }
  },
  // 客機收到 bossDown 的評價
  tierClientRank(r) {
    if (!r) return;
    this.bossRank = r;
    SFX.cue('clear');
  },
});
