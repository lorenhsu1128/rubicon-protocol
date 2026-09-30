// ============================================================
//  PVP — 大亂鬥／分隊 2v2／玩家 vs 電腦 AC；擊破制與淘汰制
// ============================================================
import { rnd } from '../core/math.js';
import { AC_ROSTER } from '../data/enemies.js';
import { START_ASM } from '../data/parts.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PLAYER_PALS } from '../net/transports.js';
import { PALETTES } from '../render/materials.js';
import { AI_DIFF, PVP_TEAM_COLORS } from './constants.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  pvpDefaults() {
    return { mode: 'pve', type: 'ffa', rule: 'kills', diff: 'std', fill: 'ask' };
  },
  pvpCombatants() {
    return [...(this.players || []), ...this.enemies.filter((e) => e.pvpAi)];
  },
  pvpTeamOf(e) {
    if (e.pvpAi || e.team === 'enemy') return e.pvpTeam !== undefined ? e.pvpTeam : -1;
    return e.pvpTeam || 0;
  },
  pvpBotName(e) {
    return e.name;
  },
  pvpSpawnPoint(i, n) {
    const R = 52;
    const angs = [
      Math.PI / 4,
      (Math.PI * 5) / 4,
      (Math.PI * 3) / 4,
      (Math.PI * 7) / 4,
      0,
      Math.PI,
      Math.PI / 2,
      (Math.PI * 3) / 2,
    ];
    const a = angs[i % angs.length];
    let x = Math.cos(a) * R,
      z = Math.sin(a) * R;
    for (let t = 0; t < 30; t++) {
      if (
        !this.world.onCorridor(x, z, 3) &&
        this.world.slopeOK(x, z) &&
        !this.world.obstacles.some(
          (o) => Math.hypot(o.x - x, o.z - z) < (o.r || Math.max(o.w || 0, o.d || 0) / 2) + 2.5,
        )
      )
        break;
      x += rnd(-6, 6);
      z += rnd(-6, 6);
    }
    return new THREE.Vector3(x, this.world.terrainHeight(x, z), z);
  },
  // 房主：PVP 出擊
  startPvp(L) {
    const S = this.pvpSet;
    this.pvp = true;
    this.enemies = [];
    this.allies = [];
    this.missionT = 0;
    this.missionEarned = 0;
    this.bountyPops = [];
    this.pvpType = S.type;
    this.pvpRule = S.rule;
    this.waves = [];
    this.bosses = [];
    this.boss = null;
    this.isBossLevel = false;
    document.getElementById('bossBar').style.display = 'none';
    const online = this.net.players.filter((p) => p.online);
    const n = online.length; // 玩家隊伍
    online.forEach((pl, i) => {
      pl.pvpTeam =
        S.type === 'ffa' ? pl.slot : S.type === 'team' ? (pl.pvpTeam !== undefined ? pl.pvpTeam : i % 2) : 0;
    });
    this.players = [];
    online.forEach((pl, i) => {
      const e = new MechEntity(this, pl.asm || START_ASM, PALETTES[PLAYER_PALS[pl.color]], {
        team: 'player',
        name: pl.nick,
        palKey: PLAYER_PALS[pl.color],
        slot: pl.slot,
        pvpTeam: pl.pvpTeam,
      });
      e.slot = pl.slot;
      e.isPlayer = pl.slot === this.net.me;
      e.pos.copy(this.pvpSpawnPoint(i, n));
      e.mesh.position.copy(e.pos);
      e.deaths = 0;
      e.kills = 0;
      this.players.push(e);
      this.registerSpawn(e);
      if (e.isPlayer) this.player = e;
    });
    this.mpStats = {};
    for (const e of this.players) this.mpStats[e.slot] = { kills: 0, dmg: 0, rev: 0, taken: 0, deaths: 0 };
    // 電腦補位（大亂鬥補到 4 台；分隊每隊補到 2 台）
    if (S.fill === 'yes' && S.type !== 'vsai') {
      const D = AI_DIFF[S.diff] || AI_DIFF.std;
      const keys = Object.keys(AC_ROSTER).sort(() => Math.random() - 0.5);
      let bi = 0;
      const addBot = (team, idx, total) => {
        const r = AC_ROSTER[keys[bi++ % keys.length]];
        const e = this.spawnEnemy({
          name: r.name,
          asm: r.asm,
          pal: r.pal,
          scale: 1,
          hpMul: r.hpMul * D.hp,
          dmgMul: r.dmgMul * D.dmg,
          stabMul: r.stabMul,
          ai: r.ai,
          wantDist: r.wantDist,
          speedMul: r.speedMul,
          turnRate: r.turnRate,
          aiSkill: D.skill,
          pvpAi: true,
          pvpTeam: team,
        });
        e.pvpAi = true;
        e.pvpTeam = team;
        e.kits = 3;
        e.pos.copy(this.pvpSpawnPoint(idx, total));
        e.mesh.position.copy(e.pos);
        e.deaths = 0;
        e.kills = 0;
        this.net.spawnReg[e.id].pvpTeam = team;
      };
      if (S.type === 'ffa') {
        let idx = n;
        for (let k = n; k < 4; k++) addBot(100 + k, idx++, 4);
      } else {
        for (const t of [0, 1]) {
          let c = online.filter((p) => p.pvpTeam === t).length;
          let idx = n;
          while (c < 2) {
            addBot(t, idx++, 4);
            c++;
          }
        }
      }
    }
    // vs AI：補上同數量的具名 AC
    if (S.type === 'vsai') {
      const D = AI_DIFF[S.diff] || AI_DIFF.std;
      const keys = Object.keys(AC_ROSTER)
        .sort(() => Math.random() - 0.5)
        .slice(0, n);
      keys.forEach((k, i) => {
        const r = AC_ROSTER[k];
        const e = this.spawnEnemy({
          name: r.name,
          asm: r.asm,
          pal: r.pal,
          scale: 1,
          hpMul: r.hpMul * D.hp,
          dmgMul: r.dmgMul * D.dmg,
          stabMul: r.stabMul,
          ai: r.ai,
          wantDist: r.wantDist,
          speedMul: r.speedMul,
          turnRate: r.turnRate,
          aiSkill: D.skill,
          pvpAi: true,
          pvpTeam: -1,
        });
        e.pvpAi = true;
        e.kits = 3;
        e.pos.copy(this.pvpSpawnPoint(n + i, n * 2));
        e.mesh.position.copy(e.pos);
        e.deaths = 0;
        e.kills = 0;
      });
    }
    this.pvpTarget = 5 * this.pvpCombatants().length;
    this.pvpTime = 360;
    this.pvpScore = {};
    this.pvpOver = false;
    this.freezeT = 3.2;
    this.pvpCountdown = 3.2;
    this.flashMsg('對戰開始倒數 3', 0xffb020, 1);
    this.planVehicles();
    if (this.net.role === 'host') {
      this.net.tr.broadcast({
        t: 'start',
        pace: this.ctrl.pace || 1,
        pvp: {
          type: S.type,
          rule: S.rule,
          diff: S.diff,
          target: this.pvpTarget,
          teams: Object.fromEntries(online.map((p) => [p.slot, p.pvpTeam])),
        },
        seed: this.worldSeed,
        theme: this.worldTheme,
        feat: this.world.features.map((f) => ({
          k: f.k,
          kind: f.kind,
          dir: f.dir ? [f.dir.x, f.dir.y] : 0,
          perp: f.perp ? [f.perp.x, f.perp.y] : 0,
          off: f.off,
          width: f.width,
          depth: f.depth,
          bridges: f.bridges,
          deckW: f.deckW,
          center: f.center,
          span: f.span,
          rampL: f.rampL,
          deckH: f.deckH,
          count: f.count,
          len: f.len,
        })),
        level: L,
        players: this.net.players.map((p) => ({ slot: p.slot, nick: p.nick, color: p.color })),
        spawns: Object.values(this.net.spawnReg),
        bossName: '',
      });
      this.netEvents = [];
    }
  },
  pvpTick(dt) {
    if (!this.pvp || this.pvpOver) return;
    if (this.pvpCountdown > 0) {
      const prev = Math.ceil(this.pvpCountdown);
      this.pvpCountdown -= dt / (this.ctrl.pace || 1);
      const now = Math.ceil(this.pvpCountdown);
      if (now !== prev && now > 0) this.flashMsg('對戰開始倒數 ' + now, 0xffb020, 0.9);
      if (this.pvpCountdown <= 0) {
        this.flashMsg('FIGHT!', 0xff4d4d, 1.2);
        for (const e of this.pvpCombatants()) e.iFrames = Math.max(e.iFrames, 0.5);
      }
      return;
    }
    this.pvpTime -= dt; // 重生
    for (const e of this.pvpCombatants()) {
      if (e.dead && e.respawnT !== undefined) {
        e.respawnT -= dt;
        if (e.respawnT <= 0) {
          e.respawnT = undefined;
          const i = Math.floor(Math.random() * 8);
          const p = this.pvpSpawnPoint(i, 8);
          // 客機收到 respawn 事件會自己呼叫 respawnAt 並播放音效，這裡不再轉送
          this._noMirror = true;
          try {
            e.respawnAt(p);
          } finally {
            this._noMirror = false;
          }
          this.netEv({ t: 'respawn', i: e.id, p: [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)] });
          this.flashMsg(`${e.name} 重新出擊`, 0x7ee081, 1.2);
        }
      }
    }
    // 勝負判定
    if (this.pvpRule === 'kills') {
      for (const e of this.pvpCombatants()) {
        const sc = this.pvpScoreOf(e);
        if (sc >= this.pvpTarget) {
          this.pvpEnd(this.pvpWinnerLabel(e));
          return;
        }
      }
    } else {
      const alive = this.pvpCombatants().filter((e) => !e.dead);
      const teams = new Set(alive.map((e) => this.pvpTeamOf(e)));
      if (teams.size <= 1) {
        const w = alive[0];
        this.pvpEnd(w ? this.pvpWinnerLabel(w) : '平手');
        return;
      }
    }
    if (this.pvpTime <= 0) {
      let best = null,
        bs = -1;
      for (const e of this.pvpCombatants()) {
        const sc = this.pvpScoreOf(e);
        if (sc > bs) {
          bs = sc;
          best = e;
        }
      }
      const tied = this.pvpCombatants()
        .filter((e) => this.pvpScoreOf(e) === bs)
        .map((e) => this.pvpTeamOf(e));
      this.pvpEnd(new Set(tied).size > 1 ? '時間到 — 平手' : '時間到 — ' + this.pvpWinnerLabel(best));
    }
  },
  pvpScoreOf(e) {
    const t = this.pvpTeamOf(e);
    if (this.pvpType === 'ffa') return e.kills || 0;
    let s = 0;
    for (const q of this.pvpCombatants()) if (this.pvpTeamOf(q) === t) s += q.kills || 0;
    return s;
  },
  pvpWinnerLabel(e) {
    const t = this.pvpTeamOf(e);
    if (this.pvpType === 'ffa') return `${e.name} 獲勝`;
    if (t === -1) return '電腦 AC 獲勝';
    if (this.pvpType === 'vsai') return '玩家獲勝';
    return `${t === 0 ? '藍' : '紅'}隊獲勝`;
  },
  pvpWinners(label) {
    // 回傳獲勝的玩家 slot 集合
    const out = new Set();
    for (const e of this.players) {
      const t = this.pvpTeamOf(e);
      if (this.pvpType === 'ffa') {
        if (label.startsWith(e.name + ' ')) out.add(e.slot);
      } else if (this.pvpType === 'vsai') {
        if (label.includes('玩家')) out.add(e.slot);
      } else {
        if (label.includes(t === 0 ? '藍' : '紅')) out.add(e.slot);
      }
    }
    return out;
  },
  onPvpDeath(victim, killer) {
    victim.deaths = (victim.deaths || 0) + 1;
    if (victim.slot !== undefined && this.mpStats[victim.slot]) this.mpStats[victim.slot].deaths++;
    if (killer && killer !== victim && this.isHostile(killer, victim)) {
      killer.kills = (killer.kills || 0) + 1;
      if (killer.slot !== undefined && this.mpStats[killer.slot]) this.mpStats[killer.slot].kills++;
      this.flashMsg(`${killer.name} 擊破 ${victim.name}`, 0xffb020, 1.6);
      if (victim.team === 'enemy') {
        const bounty = Math.round((victim.maxHp * 1.8) / 100) * 100;
        this.save.coam += bounty;
        this.missionEarned = (this.missionEarned || 0) + bounty;
        this.writeSave();
        this.netEv({ t: 'bounty', v: bounty });
      }
    } else this.flashMsg(`${victim.name} 被擊破`, 0xff8a8a, 1.4);
    if (this.pvpRule === 'kills') {
      victim.respawnT = 5 * victim.deaths;
      if (victim.isPlayer) this.flashMsg(`${victim.respawnT} 秒後重生`, 0xffb020, 2);
    } else if (victim.isPlayer) this.flashMsg('已淘汰 — 旁觀模式', 0xff4d4d, 2.5);
  },
  pvpEnd(label) {
    if (this.pvpOver) return;
    this.pvpOver = true;
    this.state = 'ending';
    this.flashMsg(label, 0xffb020, 3);
    setTimeout(() => this.endPvp(label), 2500);
  },
  endPvp(label) {
    const $ = (id) => document.getElementById(id);
    const winners = this.pvpWinners(label);
    const rows = this.pvpCombatants().map((e) => [
      e.name + (e.team === 'enemy' ? '（AI）' : ''),
      `擊破 ${e.kills || 0} · 死亡 ${e.deaths || 0}${e.slot !== undefined && this.mpStats[e.slot] ? ' · 輸出 ' + this.mpStats[e.slot].dmg : ''}`,
    ]);
    const bonusOf = (slot) => (winners.has(slot) ? 15000 : 5000);
    const myBonus = bonusOf(this.net.me);
    this.save.coam += myBonus;
    this.writeSave();
    this.state = 'result';
    $('rTitle').textContent = '對戰結束 — ' + label;
    $('rRank').textContent = winners.has(this.net.me) ? 'WIN' : 'LOSE';
    $('resultGrid').innerHTML =
      rows.map((r) => `<span class="dim">${r[0]}</span><span>${r[1]}</span>`).join('') +
      `<span class="dim">本場獎勵</span><span>+${myBonus.toLocaleString()}</span><span class="dim">COAM 結餘</span><span>${this.save.coam.toLocaleString()}</span>`;
    $('btnResultOk').textContent = '返回大廳';
    if (this.net.role === 'host') {
      this.net.tr.broadcast({
        t: 'end',
        pvp: true,
        label,
        rows,
        bonusBySlot: Object.fromEntries(this.net.players.map((p) => [p.slot, bonusOf(p.slot)])),
        winners: [...winners],
      });
      for (const x of this.net.players) x.ready = false;
    }
    this.clearMission();
    this.pvp = false;
    this.showScreen('result');
  },
  drawPvpHud(c, W, H, p) {
    if (!this.pvp) return;
    const vp = document.body.classList.contains('vpad');
    const y0 = vp ? (innerHeight < 540 ? 40 : 70) : 80;
    const x0 = W / 2 - 150;
    c.fillStyle = 'rgba(8,12,18,.55)';
    const list = this.pvpCombatants()
      .slice()
      .sort((a, b) => this.pvpScoreOf(b) - this.pvpScoreOf(a) || (b.kills || 0) - (a.kills || 0));
    c.fillRect(x0, y0, 300, 20 + list.length * 16);
    c.font = 'bold 11px Chakra Petch';
    c.textAlign = 'left';
    c.fillStyle = '#ffb020';
    const tl = Math.max(0, this.pvpTime || 0);
    c.fillText(
      `${this.pvpRule === 'kills' ? '目標 ' + this.pvpTarget + ' 擊破' : '淘汰制'}　${Math.floor(tl / 60)}:${String(Math.floor(tl % 60)).padStart(2, '0')}`,
      x0 + 8,
      y0 + 14,
    );
    list.forEach((e, i) => {
      const t = this.pvpTeamOf(e);
      const col =
        t === -1 ? '#ff8a8a' : this.pvpType === 'team' ? PVP_TEAM_COLORS[t] : this.net.slotColor(e.slot || 0);
      c.fillStyle = e === p ? '#fff' : col;
      c.fillText(`${e.name}${e.dead ? ' ✖' : ''}`, x0 + 8, y0 + 30 + i * 16);
      c.textAlign = 'right';
      c.fillText(
        `${e.kills || 0} / ${e.deaths || 0}${this.pvpType !== 'ffa' ? '  [' + this.pvpScoreOf(e) + ']' : ''}`,
        x0 + 292,
        y0 + 30 + i * 16,
      );
      c.textAlign = 'left';
    });
    if (p && p.dead && p.respawnT !== undefined) {
      c.font = 'bold 22px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = '#ffb020';
      c.fillText(`${Math.ceil(p.respawnT)} 秒後重生`, W / 2, H * 0.32);
    }
  },
});
