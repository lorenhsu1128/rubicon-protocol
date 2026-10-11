// Game：一般戰鬥的增援波次——編成分成 3～5 波，場上的敵人剩下少數時派出下一波：
// 從作戰區域邊緣進入，或由運輸機空降到玩家附近；出現前 ECHO 預告方向（依各自的鏡頭換算成幾點鐘方向）、
// 地點立起紅色光柱、畫面邊緣顯示指示。派出與生成只在房主／單機，客機收到 'wave' 事件只做顯示。
import { clamp, pick, rnd } from '../core/math.js';
import { ENEMY_TYPES } from '../data/enemies.js';
import { Game } from './game.js';

const WAVE_WARN = 3; // 預告到出現的秒數
const WAVE_GAP = 2.5; // 敵人降到門檻後再等幾秒
const MARK_T = 7; // 畫面上的增援指示顯示幾秒
const isAce = (t) => t === 'ac' || !!(ENEMY_TYPES[t] || {}).roster;

Object.assign(Game.prototype, {
  // 編成分成 3～5 波：第一波直接生成，其餘由 waveTick 依序派出；敵對 AC（小頭目）在最後一波
  spawnComp(comp, np, scaleHp, scaleDmg) {
    const aces = comp.filter(isAce);
    const body = comp.filter((t) => !isAce(t));
    const per = 3 + (np - 1) * 2;
    const n = Math.max(1, Math.min(body.length, clamp(Math.round(body.length / per), 3, 5)));
    const waves = Array.from({ length: n }, () => []);
    body.forEach((t, i) => waves[i % n].push(t));
    waves[n - 1].push(...aces);
    const first = waves.shift();
    this.waves = waves.filter((w) => w.length);
    this.waveN = this.waves.length + 1;
    this.waveI = 1;
    this.waveSize = Math.max(1, Math.ceil(body.length / n));
    this.waveGap = WAVE_GAP;
    this.wavePend = null;
    for (const t of first) this.spawnType(t, scaleHp, scaleDmg);
  },
  // 每格（房主／單機，非 Boss 關）：等待中的波次倒數；場上的敵人降到門檻就派出下一波
  waveTick(dt) {
    if (this.wavePend) {
      if ((this.wavePend.t -= dt) <= 0) {
        const w = this.wavePend;
        this.wavePend = null;
        this.waveSpawn(w);
      }
      return;
    }
    if (!this.waves.length) return;
    const fighters = this.enemies.filter(
      (e) => !e.dead && e.ai !== 'objective' && e.ai !== 'part' && !e.guardOf,
    ).length;
    const thr = Math.max(1, Math.round((this.waveSize || 3) * 0.34));
    if (fighters > thr) {
      this.waveGap = WAVE_GAP;
      return;
    }
    this.waveGap -= dt * (fighters === 0 ? 2 : 1);
    if (this.waveGap <= 0) this.waveLaunch();
  },
  // 派出下一波：決定進入方式與地點、預告，WAVE_WARN 秒後生成
  waveLaunch() {
    if (!this.waveN) {
      // 沒經過 spawnComp 的波次（防衛區段自己排的）
      this.waveN = this.waves.length + 1;
      this.waveI = 1;
    }
    const list = this.waves.shift();
    this.waveI++;
    this.waveGap = WAVE_GAP;
    const alive = this.playersAlive();
    const tgt = alive.length ? pick(alive) : this.player;
    const ace = list.some(isAce);
    const drop = !ace && Math.random() < 0.4;
    const pos = drop ? this.waveDropPoint(tgt.pos) : this.waveEdgePoint(tgt.pos);
    this.wavePend = { t: WAVE_WARN, pos, list, drop };
    const W = this.world;
    const base = new THREE.Vector3(pos.x, W.groundAt(pos.x, pos.z, 99), pos.z);
    this.fx.warnLine(base, base.clone().setY(base.y + 45), WAVE_WARN + 0.5, drop ? 0xffa020 : 0xff3030, 0.5);
    const ev = {
      t: 'wave',
      p: [+pos.x.toFixed(1), +pos.z.toFixed(1)],
      n: list.reduce((a, t) => a + (isAce(t) ? 1 : (ENEMY_TYPES[t] || {}).group || 1), 0),
      d: drop ? 1 : 0,
      a: ace ? 1 : 0,
      i: this.waveI,
      N: this.waveN,
    };
    this.netEv(ev);
    this.waveShow(ev);
  },
  // 作戰區域邊緣、離玩家們夠遠的地點（8 個方向裡挑）
  waveEdgePoint(near) {
    const W = this.world,
      Z = W.zone;
    const cx = (Z[0] + Z[1]) / 2,
      cz = (Z[2] + Z[3]) / 2;
    const hx = (Z[1] - Z[0]) / 2 - 8,
      hz = (Z[3] - Z[2]) / 2 - 8;
    const a0 = Math.random() * Math.PI * 2;
    const cands = [];
    for (let k = 0; k < 8; k++) {
      const a = a0 + (k * Math.PI) / 4;
      const p = { x: cx + Math.cos(a) * hx * 0.85, z: cz + Math.sin(a) * hz * 0.85 };
      const far = Math.min(...this.playersAlive().map((q) => Math.hypot(q.pos.x - p.x, q.pos.z - p.z)), 999);
      cands.push({ p, far });
    }
    const ok = cands.filter((c) => c.far > 40);
    const c = ok.length ? pick(ok) : cands.sort((a, b) => b.far - a.far)[0];
    return W.spawnPoint(near, [], c.p);
  },
  // 空降：玩家周圍 22～36 m
  waveDropPoint(near) {
    const a = Math.random() * Math.PI * 2,
      r = rnd(22, 36);
    return this.world.spawnPoint(near, [], { x: near.x + Math.cos(a) * r, z: near.z + Math.sin(a) * r }, 18);
  },
  waveSpawn(w) {
    this.waveAt = w;
    try {
      for (const t of w.list) this.spawnType(t, this.scaleHp, this.scaleDmg);
    } finally {
      this.waveAt = null;
    }
    if (w.drop)
      this.fx.shockwave(
        new THREE.Vector3(w.pos.x, this.world.groundAt(w.pos.x, w.pos.z, 99), w.pos.z),
        8,
        0xffa020,
        0.5,
      );
  },
  // 顯示預告（房主與客機各自依自己的鏡頭算方向）：ECHO 的通訊、畫面邊緣的指示
  waveShow(ev) {
    const pos = new THREE.Vector3(ev.p[0], 0, ev.p[1]);
    if (this.world) pos.y = this.world.groundAt(pos.x, pos.z, 99) + 2;
    this.waveMarks = (this.waveMarks || []).concat([{ pos, t: MARK_T, drop: !!ev.d }]);
    const me = this.player && !this.player.dead ? this.player.pos : this.camera.position;
    const f = new THREE.Vector3();
    this.camera.getWorldDirection(f);
    f.y = 0;
    if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
    f.normalize();
    const vx = pos.x - me.x,
      vz = pos.z - me.z;
    const ang = Math.atan2(vx * -f.z + vz * f.x, vx * f.x + vz * f.z);
    let clock = Math.round(ang / (Math.PI / 6));
    if (clock <= 0) clock += 12;
    const dist = Math.round(Math.hypot(vx, vz));
    const head = `第 ${ev.i}/${ev.N} 波：`;
    let text = ev.d
      ? `${head}運輸機在 ${clock} 點鐘方向空降 ${ev.n} 機，距離 ${dist} m！`
      : `${head}敵方增援 ${ev.n} 機從 ${clock} 點鐘方向接近，距離 ${dist} m。`;
    if (ev.a) text += '敵對 AC 也在裡面。';
    if (ev.i >= ev.N) text += '這是最後一波。';
    this.commSay('echo', text);
  },
  // HUD：增援地點的指示（畫面外是邊緣的箭頭，畫面內是菱形標記）
  drawWaveMarks(c, W, H, p, dt) {
    if (!this.waveMarks || !this.waveMarks.length) return;
    this.waveMarks = this.waveMarks.filter((m) => (m.t -= dt) > 0);
    for (const m of this.waveMarks) {
      const s = this.proj(m.pos);
      const col = m.drop ? '#ffa020' : '#ff4040';
      const blink = 0.55 + 0.45 * Math.sin(this.time * 10);
      const dist = Math.round(m.pos.distanceTo(p.pos));
      c.save();
      c.globalAlpha = Math.min(1, m.t) * blink;
      c.fillStyle = col;
      c.strokeStyle = 'rgba(0,0,0,.7)';
      c.lineWidth = 3;
      c.font = 'bold 12px Chakra Petch';
      c.textAlign = 'center';
      if (!s.in || s.x < 0 || s.x > W || s.y < 0 || s.y > H) {
        const cx = W / 2,
          cy = H / 2;
        let dx = s.x - cx,
          dy = s.y - cy;
        if (!s.in) {
          dx = -dx;
          dy = -dy;
        }
        const ang = Math.atan2(dy, dx);
        const mg = 64;
        const k = Math.min(
          Math.abs((W / 2 - mg) / (Math.cos(ang) || 1e-6)),
          Math.abs((H / 2 - mg - 40) / (Math.sin(ang) || 1e-6)),
        );
        const ax = cx + Math.cos(ang) * k,
          ay = cy + Math.sin(ang) * k;
        c.translate(ax, ay);
        c.rotate(ang);
        c.beginPath();
        c.moveTo(24, 0);
        c.lineTo(-12, -16);
        c.lineTo(-4, 0);
        c.lineTo(-12, 16);
        c.closePath();
        c.stroke();
        c.fill();
        c.rotate(-ang);
        c.strokeText(`增援 ${dist}m`, 0, ay < H / 2 ? 40 : -28);
        c.fillText(`增援 ${dist}m`, 0, ay < H / 2 ? 40 : -28);
      } else {
        c.translate(s.x, s.y);
        c.beginPath();
        c.moveTo(0, -16);
        c.lineTo(12, 0);
        c.lineTo(0, 16);
        c.lineTo(-12, 0);
        c.closePath();
        c.stroke();
        c.fill();
        c.strokeText(`增援 ${dist}m`, 0, -24);
        c.fillText(`增援 ${dist}m`, 0, -24);
      }
      c.restore();
    }
  },
});
