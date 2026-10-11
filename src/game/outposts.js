// Game：地圖上的據點——每張一般戰鬥地圖放 2～3 個補給箱，各有一小隊守衛（guardOf）。
// 守衛平常守在箱子旁，玩家靠近或被打中才出動；守衛不算主要戰力（不擋區段清除與波次）。
// 站在箱子旁 1.2 秒打開，獎勵在地圖上預先標示（資金、修理、彈藥、修理套件、主線單人的戰術模組）。
// 自由出擊清除主要戰力後還有箱子沒開時，給 30 秒撤離時間（全部打開就提早結束）；主線的出口本來就會等玩家。
// 判定只在房主／單機；客機收到 'cache'／'cacheX' 事件只做顯示。
import { SFX } from '../audio/audio.js';
import { pick } from '../core/math.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { FOES } from '../data/foes.js';
import { FACTIONS } from '../data/story.js';
import { buildCacheMesh } from '../render/extra-models.js';
import { Game } from './game.js';

const CACHE_KINDS = {
  coam: { name: 'COAM 資金', color: 0xffd060 },
  repair: { name: '全員修理', color: 0x7ee081 },
  ammo: { name: '彈藥補給', color: 0x7fc8ff },
  kit: { name: '修理套件補滿', color: 0x9fffc8 },
  mod: { name: '戰術模組', color: 0xc090ff },
};
const OPEN_R = 3.4; // 打開的距離
const OPEN_T = 1.2; // 站幾秒打開
const ALERT_R = 38; // 守衛發現玩家的距離
const EXTRACT_T = 30; // 自由出擊的撤離時間
const isAce = (t) => t === 'ac' || !!(ENEMY_TYPES[t] || {}).roster;

Object.assign(Game.prototype, {
  // 生成據點（房主／單機，主要戰力生成之後）
  outpostsPlan(L) {
    this.caches = [];
    this.extract = 0;
    if (this.pvp || this.sim || this.lab || this.isBossLevel || !this.world) return;
    const W = this.world;
    const mp = !!(this.net && this.net.role);
    const kinds = ['coam', 'repair', 'ammo', 'kit'];
    if (this.camp && !mp && !this.camp.replay) kinds.push('mod');
    const n = Math.random() < 0.5 ? 3 : 2;
    const pts = [];
    for (let i = 0; i < n && kinds.length; i++) {
      const sp = W.spawnPoint(this.player.pos, pts, null, 45);
      if (pts.some((q) => Math.hypot(q.x - sp.x, q.z - sp.z) < 30)) continue;
      pts.push(sp);
      const kind = kinds.splice(Math.floor(Math.random() * kinds.length), 1)[0];
      const id = i + 1;
      this.cacheAdd({ i: id, k: kind, p: [+sp.x.toFixed(1), +sp.z.toFixed(1)] });
      // 守衛：低一級的小隊（主題專屬敵人照樣混進來）
      const comp = this.foeMix(
        this.rollComp(Math.max(1, L - 1), 1).filter((t) => !isAce(t)),
        this.worldTheme,
        this.camp ? (this.camp.plan[this.camp.seg] || {}).depth || 0 : 0,
        !this.camp,
      ).slice(0, L >= 8 ? 3 : 2);
      this.waveAt = { pos: sp, drop: false };
      this.guardAt = id;
      try {
        for (const t of comp)
          this.spawnType(
            t,
            this.scaleHp,
            this.scaleDmg,
            null,
            Math.min(2, (ENEMY_TYPES[t] || FOES[t] || {}).group || 1),
          ); // 編隊的最多 2 台
      } finally {
        this.waveAt = null;
        this.guardAt = 0;
      }
    }
  },
  // 建立箱子的顯示（房主與客機共用；房主同時轉送）
  cacheAdd(ev) {
    const d = CACHE_KINDS[ev.k];
    const W = this.world;
    const pos = new THREE.Vector3(ev.p[0], W.groundAt(ev.p[0], ev.p[1], 99), ev.p[1]);
    const mesh = buildCacheMesh(d.color);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const c = { id: ev.i, kind: ev.k, pos, mesh, t: 0, opened: false };
    (this.caches || (this.caches = [])).push(c);
    this.netEv({ t: 'cache', i: ev.i, k: ev.k, p: ev.p });
    return c;
  },
  cacheRemove(c) {
    if (c.opened) return;
    c.opened = true;
    this.scene.remove(c.mesh);
    c.mesh.traverse((o) => o.geometry && o.geometry.dispose());
    this.fx.ring(c.pos.clone().setY(c.pos.y + 0.5), 5, CACHE_KINDS[c.kind].color);
    this.fx.flash(c.pos.clone().setY(c.pos.y + 1), 2, CACHE_KINDS[c.kind].color, 0.15);
  },
  cachesLeft() {
    return (this.caches || []).filter((c) => !c.opened).length;
  },
  // 每格（房主／單機）：開箱、守衛出動、自由出擊的撤離倒數
  cacheTick(dt) {
    for (const c of this.caches || []) {
      if (c.opened) continue;
      c.mesh.rotation.y += dt * 0.6;
      const who = this.playersAlive().find(
        (p) =>
          !p.downed &&
          Math.hypot(p.pos.x - c.pos.x, p.pos.z - c.pos.z) < OPEN_R &&
          Math.abs(p.pos.y - c.pos.y) < 4,
      );
      c.t = who ? c.t + dt : Math.max(0, c.t - dt);
      if (c.t >= OPEN_T) this.cacheOpen(c, who);
    }
    if (this.extract > 0) {
      this.extract -= dt;
      if ((this.extract <= 0 || !this.cachesLeft()) && this.state === 'play') {
        this.extract = 0;
        this.state = 'ending';
        this.flashMsg('撤離完成', 0x7ee081, 2);
        setTimeout(() => this.state === 'ending' && this.player && this.endMission(true, false), 1500);
      }
    }
  },
  // 自由出擊清除主要戰力時：還有箱子就先給撤離時間（回傳 true 表示延後結束）
  extractStart() {
    if (this.extract > 0) return true;
    if (!this.cachesLeft()) return false;
    this.extract = EXTRACT_T;
    this.flashMsg(`主要目標完成 — ${EXTRACT_T} 秒後撤離（可以先回收補給箱）`, 0x7ee081, 3);
    return true;
  },
  cacheOpen(c, ent) {
    this.cacheRemove(c);
    this.netEv({ t: 'cacheX', i: c.id });
    const d = CACHE_KINDS[c.kind];
    const L = this.camp ? this.campLevel() : this.save.level || 1;
    SFX.kit();
    let txt = d.name;
    if (c.kind === 'coam') {
      const v = 150 + L * 40;
      this.cacheCoam(v);
      this.netEv({ t: 'cacheCoam', v });
      txt = `COAM +${v.toLocaleString()}`;
    } else if (c.kind === 'repair') {
      for (const p of this.playersAlive()) {
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35));
        this.fx.ring(p.center(), 5, 0x7ee081);
      }
    } else if (c.kind === 'ammo') {
      for (const p of this.playersAlive())
        for (const w of Object.values(p.weapons || {}))
          if (w && w.def && w.def.ammo) w.ammo = Math.min(w.def.ammo, w.ammo + Math.ceil(w.def.ammo * 0.5));
      this.renderWeaponHud(true);
    } else if (c.kind === 'kit') {
      for (const p of this.playersAlive()) p.kits = p.kitsMax;
      this.renderWeaponHud(true);
    } else if (c.kind === 'mod') {
      setTimeout(
        () => this.camp && this.state === 'play' && this.campOpenPick(pick(Object.keys(FACTIONS))),
        300,
      );
    }
    this.flashMsg(`${ent ? ent.name + ' ' : ''}打開補給箱：${txt}`, d.color, 2);
  },
  cacheCoam(v) {
    this.save.coam += v;
    this.missionEarned = (this.missionEarned || 0) + v;
    this.writeSave();
    this.bountyPops.push({ txt: '+' + v.toLocaleString() + ' COAM', life: 2.2, y: 0 });
  },
  clearCaches() {
    for (const c of this.caches || []) if (!c.opened) this.cacheRemove(c);
    this.caches = [];
    this.extract = 0;
  },
  // 客機
  clientCacheEvent(e) {
    if (e.t === 'cache') {
      if (!(this.caches || []).some((c) => c.id === e.i)) this.cacheAdd(e);
    } else if (e.t === 'cacheX') {
      const c = (this.caches || []).find((x) => x.id === e.i);
      if (c) this.cacheRemove(c);
    } else if (e.t === 'cacheCoam') this.cacheCoam(e.v);
    else return false;
    return true;
  },
  // 守衛（MechEntity.updateAI 呼叫）：還沒出動時守在原地；玩家靠近或自己受傷就整隊出動
  guardIdle(e) {
    if (e.guardAlert) return false;
    const near = this.playersAlive().some((p) => p.pos.distanceTo(e.pos) < ALERT_R);
    if (near || e.hp < e.maxHp) {
      for (const o of this.enemies) if (o.guardOf === e.guardOf) o.guardAlert = true;
      return false;
    }
    return true;
  },
  // HUD：箱子的標示（畫面內是方塊與名稱、距離、開箱進度；畫面外 90 m 內是淡淡的箭頭）
  drawCacheMarks(c, W, H, p) {
    for (const k of this.caches || []) {
      if (k.opened) continue;
      const d = CACHE_KINDS[k.kind];
      const col = '#' + d.color.toString(16).padStart(6, '0');
      const top = k.pos.clone().setY(k.pos.y + 2.6);
      const s = this.proj(top);
      const dist = Math.round(k.pos.distanceTo(p.pos));
      c.save();
      c.font = 'bold 12px Chakra Petch';
      c.textAlign = 'center';
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(0,0,0,.7)';
      c.fillStyle = col;
      if (s.in && s.x > 0 && s.x < W && s.y > 0 && s.y < H) {
        c.strokeRect(s.x - 7, s.y - 7, 14, 14);
        c.fillRect(s.x - 7, s.y - 7, 14, 14);
        const label = `補給箱：${d.name} ${dist}m`;
        c.strokeText(label, s.x, s.y - 14);
        c.fillText(label, s.x, s.y - 14);
        if (k.t > 0) {
          c.strokeStyle = col;
          c.beginPath();
          c.arc(s.x, s.y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, k.t / OPEN_T));
          c.stroke();
        }
      } else if (dist < 90) {
        const cx = W / 2,
          cy = H / 2;
        let dx = s.x - cx,
          dy = s.y - cy;
        if (!s.in) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const k2 = Math.min(
          Math.abs((W / 2 - 90) / (Math.cos(ang) || 1e-6)),
          Math.abs((H / 2 - 130) / (Math.sin(ang) || 1e-6)),
        );
        c.globalAlpha = 0.6;
        c.translate(cx + Math.cos(ang) * k2, cy + Math.sin(ang) * k2);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(10, 0);
        c.lineTo(-6, -7);
        c.lineTo(-6, 7);
        c.closePath();
        c.stroke();
        c.fill();
      }
      c.restore();
    }
  },
});
