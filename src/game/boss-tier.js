// Game 的 mixin：Boss 改版的共用部分（docs/boss-design.md、data/boss-tier.js；Boss 自己的判定在 entities/mech-boss-tier.js）。
// K 的雜兵小隊與破甲充能、O 的擊破評價與獎勵、第一次遇到機制的說明、HUD（打斷量表、破綻、破甲充能、風格加成）。
// 判定只在房主／單機；客機用快照的 bt（Boss）、bk（自己的破甲充能）與 bossDown 事件的評價顯示。
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { DS } from '../core/scale.js';
import { clamp, rnd } from '../core/math.js';
import { syRank } from '../data/style-meter.js';
import { HABITS, HABIT_NAMES, bossKitOf } from '../data/boss-kit.js';
import {
  J_COAM,
  J_COAM_MAX,
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

// J：算進部位數、打壞時掉補給與結算加成的部位種類（浮游砲、分身、三機合體的分離機體不算）
const J_KINDS = new Set([
  'bpart',
  'cannon',
  'engine',
  'pylon',
  'joint',
  'fturret',
  'car_aa',
  'car_ms',
  'car_lz',
  'car_mine',
]);
// 還沒有專屬內容（BOSS_KIT 的 parts）的 Boss：共用的部位（off＝Boss 身高的倍數，+Z 往前），各停用一個型態的大招
const GENERIC_PARTS = [
  { id: 'g1', name: '左肩武裝', off: [-0.42, 0.85, 0.1], stops: ['p1'] },
  { id: 'g2', name: '右肩武裝', off: [0.42, 0.85, 0.1], stops: ['p2'] },
  { id: 'g3', name: '背部推進器', off: [0, 0.7, -0.45], stops: ['p3'] },
];
const SWAP = { p1: 'p2', p2: 'p3', p3: 'p1' };
const CARS_J = new Set(['car_aa', 'car_ms', 'car_lz', 'car_mine']); // J：刁鑽度 7～8 重建的部位換成另一種招式
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
    this.tierFieldTick(dt); // 部位重建、跟著 Boss 的區域、作戰區域縮小
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
  // 這隻 Boss 的專屬內容（data/boss-kit.js；第 3～5 期逐隻補上）
  bossKit(key) {
    return bossKitOf(key);
  },
  // ---------- J 部位破壞 ----------
  // spawnBossDef 之後：每隻 Boss 補到刁鑽度要的部位數（原本就有的部位算在裡面）
  tierSetupParts(b) {
    if (!b || !b.isBoss || !b.tierOn()) return;
    const T = tierRow(b.bossTier());
    const kit = b.tierKit();
    // 原本就有的部位算在部位數裡：同一種（四座砲台、六條腳…）算一個；浮游砲在戰鬥中才放出，整群算一個
    const kinds = new Set(
      b
        .partsOf()
        .filter((p) => J_KINDS.has(p.opts.partKind))
        .map((p) => (CARS_J.has(p.opts.partKind) ? 'car' : p.opts.partKind)),
    );
    const have = kinds.size + (b.opts.bossKind === 'funnel' ? 1 : 0);
    const list = (kit.parts || GENERIC_PARTS).slice(0, Math.max(0, T.jParts - have));
    list.forEach((sp, i) => {
      const s = { ...sp };
      // 刁鑽度 3 起：其中 1 個在背後或底下；5 起：最後一個只在出招時露出
      const last = i === list.length - 1;
      if (T.jParts >= 3 && last && s.back === undefined) s.back = true;
      if (T.jRebuild && last) s.expose = true;
      this.tierSpawnPart(b, s);
    });
  },
  tierSpawnPart(b, sp, rebuild) {
    const T = tierRow(b.bossTier());
    const off = sp.off ? sp.off.slice() : [0, 0.7, 0];
    if (sp.back && off[2] >= 0) off[2] = -Math.max(0.4, Math.abs(off[2]) || 0.45);
    const e = this.spawnPart(b, 'bpart', {
      name: sp.name,
      off,
      hpAbs: b.maxHp * T.jHp,
      at: b.center(),
    });
    e.tierSpec = { ...sp, off };
    e.tierExpose = !!sp.expose;
    if (rebuild) b.tierPartLost(sp, false); // 重建：恢復它負責的招式與機能
    return e;
  },
  // 這隻 Boss 的破綻與部位（BOSS_KIT 的 tip）：開打後跳一次
  tierTip(b) {
    const kit = b.tierKit();
    if (!kit.tip || !b.tierOn()) return;
    this.later(5, () => !b.dead && this.flashAlert(kit.tip));
  },
  // 部位被擊破（onEnemyKilled，房主／單機）：停用招式、掉補給、結算加成、重建
  tierPartDown(e) {
    if (e.ai !== 'part' || !J_KINDS.has(e.opts.partKind)) return;
    const b = e.parentEnt && e.parentEnt();
    if (!b || !b.isBoss || b.dead || !b.tierOn()) return;
    const T = tierRow(b.bossTier());
    this.tierPartsBroken = (this.tierPartsBroken || 0) + 1;
    const sp = e.tierSpec;
    if (sp) b.tierPartLost(sp, true);
    const c = e.center();
    this.popDamage(c.clone().setY(c.y + 2 * DS), '部位破壞', false, true, false, 0, e.id);
    this.flashMsg(
      `部位破壞：${e.name}${sp && sp.stops && sp.stops.length ? ' — 招式停用' : ''}`,
      0xffe070,
      1.8,
    );
    const [x, z] = this.world.nearSolid ? this.world.nearSolid(c.x, c.z) : [c.x, c.z];
    this.spawnPickup('bossPart', new THREE.Vector3(x, this.world.groundAt(x, z, c.y) + 0.6, z));
    this.tierIntro(
      'part',
      '部位破壞 — 打壞 Boss 的部位會停用它負責的招式並掉落補給，結算時每個部位 COAM +8%',
    );
    // 重建（刁鑽度 5 起）；7～8 重建的部位換成另一種招式
    if (sp && T.jRebuild) {
      const nsp = { ...sp };
      if (T.jSwap && nsp.stops) nsp.stops = nsp.stops.map((id) => SWAP[id] || id);
      (this.tierReb || (this.tierReb = [])).push({ b, sp: nsp, t: T.jRebuild });
    }
  },
  // 結算時的部位加成（COAM 倍率）
  tierPartsK() {
    return 1 + Math.min(J_COAM_MAX, J_COAM * (this.tierPartsBroken || 0));
  },
  // ---------- E 型態改變場地 ----------
  // 換型態（bossPhaseShift）：依刁鑽度與 BOSS_KIT 的 field
  tierFieldShift(b, ph) {
    if (!b.tierOn()) return;
    const T = tierRow(b.bossTier());
    if (!T.eWhen.includes(ph)) return;
    const kit = b.tierKit();
    const f = kit.field && kit.field[ph];
    if (typeof f === 'function') {
      f(this, b, T);
      return;
    }
    const tier = b.bossTier();
    const good = tier <= 2 || (tier <= 4 && ph === 2);
    if (good) this.tierFieldGood(b);
    else this.tierFieldBad(b, ph, T);
    if (T.eZone < 1 && ph === 2) this.tierShrinkZone(T.eZone);
  },
  // 場地的小工具（BOSS_KIT 的 field 用）：玩家和 Boss 之間的掩體牆
  // o：h／w／d（舊尺度的公尺）、hp、life、spread（牆的間距）
  tierWalls(b, n, o = {}) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const mid = pl.pos.clone().lerp(b.pos, 0.35);
    const dir = b.pos.clone().sub(pl.pos).setY(0);
    const yaw = dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.z) : 0;
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const K = this.fx.k;
    for (let i = 0; i < n; i++) {
      const p = mid.clone().addScaledVector(side, (i - (n - 1) / 2) * (o.spread || 14) * K);
      this.addTempWall(p, {
        kind: 'rock',
        w: (o.w || 7) * K,
        h: (o.h || 4) * K,
        d: (o.d || 1.6) * K,
        yaw,
        hp: o.hp || 1400,
        life: o.life || 60,
      });
    }
  },
  // 燃燒地面：at＝'player'（玩家周圍）、'boss'（Boss 周圍）、'line'（兩者之間一條）
  tierPools(b, n, at, R = 6) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const K = this.fx.k;
    for (let i = 0; i < n; i++) {
      let p;
      if (at === 'line') p = pl.pos.clone().lerp(b.pos, (i + 1) / (n + 1));
      else {
        const c = at === 'boss' ? b.pos : pl.pos;
        const a = Math.random() * Math.PI * 2,
          r = rnd(8, 18) * K;
        p = c.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      this.addPool(b, p, R, 25, 150 * b.dmgMul);
    }
  },
  // 煙霧（follow＝跟著 Boss 移動，刁鑽度 7～8）
  tierSmoke(b, R, follow) {
    const id = this.addZone('smoke', b.pos.clone(), R * this.fx.k, follow ? 9999 : 30, { src: b });
    if (follow && id > 0) b.tierState().fzone = id;
  },
  // 有利：多出掩體與彈藥箱
  tierFieldGood(b) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const mid = pl.pos.clone().lerp(b.pos, 0.35);
    const dir = b.pos.clone().sub(pl.pos).setY(0);
    const yaw = dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.z) : 0;
    const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    for (const k of [-1, 0, 1]) {
      const p = mid.clone().addScaledVector(side, k * 14 * DS);
      this.addTempWall(p, { kind: 'rock', w: 7 * DS, h: 4 * DS, d: 1.6 * DS, yaw, hp: 1400, life: 60 });
    }
    for (const k of [-1, 1]) {
      const p = pl.pos.clone().addScaledVector(side, k * 9 * DS);
      this.spawnPickup('ammo', new THREE.Vector3(p.x, this.world.groundAt(p.x, p.z, p.y + 1) + 0.6, p.z));
    }
    this.flashAlert('戰場改變 — 出現掩體與彈藥箱');
  },
  // 不利：燃燒地面與煙霧；刁鑽度 7～8 的煙霧跟著 Boss 移動
  tierFieldBad(b, ph, T) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2,
        r = rnd(8, 18) * DS;
      const p = pl.pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      this.addPool(b, p, 6, 25, 150 * b.dmgMul);
    }
    if (ph >= 3 || T.eMove) {
      const id = this.addZone('smoke', b.pos.clone(), 16 * DS, T.eMove ? 9999 : 30, { src: b });
      if (T.eMove && id > 0) b.tierState().fzone = id;
    }
    this.flashAlert(T.eMove ? '戰場改變 — 煙霧跟著 Boss 移動' : '戰場改變 — 燃燒地面與煙霧');
  },
  // 作戰區域縮小到比例 k（以目前作戰區域的中心）
  tierShrinkZone(k, at) {
    const w = this.world;
    if (!w || !w.zone) return;
    const Z = w.zone;
    const cx = (Z[0] + Z[1]) / 2,
      cz = (Z[2] + Z[3]) / 2,
      hx = ((Z[1] - Z[0]) / 2) * k,
      hz = ((Z[3] - Z[2]) / 2) * k;
    w.zoneGoal = [cx - hx, cx + hx, cz - hz, cz + hz];
    if (at) {
      // 以某個位置為中心（例如陣地周圍），超出原本的作戰區域的部分夾回去
      const ax = clamp(at.x, Z[0] + hx, Z[1] - hx),
        az = clamp(at.z, Z[2] + hz, Z[3] - hz);
      w.zoneGoal = [ax - hx, ax + hx, az - hz, az + hz];
    }
    this.netEv({ t: 'tzone', z: w.zoneGoal.map((v) => +v.toFixed(1)) });
    this.flashAlert('作戰區域縮小');
  },
  // bossTierTick 每格：部位重建、跟著 Boss 的區域、作戰區域縮小
  tierFieldTick(dt) {
    for (const b of this.bosses || []) {
      const fz = b.bt && b.bt.fzone;
      if (!fz) continue;
      if (b.dead) {
        this.removeZone(fz);
        b.bt.fzone = 0;
      } else this.moveZone(fz, b.pos.clone());
    }
    if (this.world && this.world.zoneGoal && !this.camp) this.world.tickZone(dt);
    if (!this.tierReb) return;
    for (const r of this.tierReb) {
      r.t -= dt;
      if (r.t > 0 || r.b.dead) continue;
      r.done = true;
      const e = this.tierSpawnPart(r.b, r.sp, true);
      this.flashMsg(`${r.b.name.split(' ')[0]} 的部位重建：${e.name}`, 0xff9040, 1.8);
    }
    this.tierReb = this.tierReb.filter((r) => !r.done && !r.b.dead);
  },
  // 客機的事件
  tierClientEvent(e) {
    if (e.t !== 'tzone') return false;
    if (this.world) this.world.zone = e.z.slice();
    return true;
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
    // 應對中的習慣（Boss 血條下）
    const hb = document.getElementById('bossHabit');
    if (hb) {
      let bits = 0;
      for (const b of bs) {
        const x = b.tierView && b.tierView();
        if (x) bits |= x.habits || 0;
      }
      const names = HABITS.filter((h, i) => bits & (1 << i)).map((h) => HABIT_NAMES[h]);
      hb.style.display = names.length ? 'block' : 'none';
      if (names.length) hb.textContent = 'BOSS 正在應對：' + names.join('、');
    }
    // 反擊點（自己的）：Boss 頭上的藍字
    for (const b of bs) {
      const x = b.tierView && b.tierView();
      if (!x || !(x.cp > 0) || !p || x.cpBy !== p.id) continue;
      const s = this.proj(b.center());
      if (!s.in) continue;
      c.save();
      c.textAlign = 'center';
      c.font = 'bold 14px Chakra Petch';
      c.fillStyle = '#7fc8ff';
      c.shadowColor = 'rgba(0,0,0,.9)';
      c.shadowBlur = 6;
      c.fillText(`反擊點 ${x.cp.toFixed(1)}s`, s.x, s.y - 20);
      c.restore();
    }
    // 部位：刁鑽度 1～2 有黃色標記
    if (this.tierFightTier() && this.tierFightTier() <= 2) {
      c.save();
      for (const e of this.enemies || []) {
        if (e.dead || e.ai !== 'part' || e.opts.partKind !== 'bpart' || e.bossVis & 1) continue;
        const s = this.proj(e.center());
        if (!s.in) continue;
        c.strokeStyle = '#ffe070';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(s.x, s.y - 11);
        c.lineTo(s.x + 11, s.y);
        c.lineTo(s.x, s.y + 11);
        c.lineTo(s.x - 11, s.y);
        c.closePath();
        c.stroke();
        c.font = 'bold 11px Chakra Petch';
        c.textAlign = 'center';
        c.fillStyle = '#ffe070';
        c.fillText(e.name, s.x, s.y - 16);
      }
      c.restore();
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
