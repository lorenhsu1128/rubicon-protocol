// Game 的 mixin：Boss 改版的場地效果（docs/boss-design.md 的 E；外觀在 render/boss-field-models.js）。
// 種類：quicksand 流沙（緩速＋往中心吸）、ice 冰面（滑）、shock 電擊地面（預警 → 放電，扣 EN）、
// collapse 地面塌陷（裂縫預警 → 坑洞）、magma 熔岩裂地、belt 移動的燃燒帶、minefield 地雷區、
// haze 煙霧／沙塵／暴風雪（擋視線、鎖定距離變短）、steam 蒸氣（擋視線、裡面的燃燒地面熄滅＝安全區），
// 另有全場變暗（bfDarkness）與新的掩體（臨時障礙物的 berm／rubble／crate／pillar／slab，hazards2.js）。
// 判定只在房主／單機（bfTick）；客機收到 bfadd／bfst／bfmv／bfrm／bfdark 事件只做外觀，移動的效果（流沙、冰面、坑洞）
// 在 MechEntity.move 的 bfMove 各端都算（客機的自身預測一致）。
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { buildField, conformField } from '../render/boss-field-models.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const arr = (v) => [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];

Object.assign(Game.prototype, {
  bfHost() {
    return !(this.net && this.net.role === 'client');
  },
  // 新增一個場地效果（房主／單機）：r＝世界尺寸的半徑；o：src（Boss 的 id）、color、len／w／sp（燃燒帶）、
  // air（空雷）、follow（跟著這個實體 id）、delay（塌陷的預警秒數）
  bfAdd(kind, pos, r, life, o = {}) {
    if (!this.bfHost() || !this.world) return -1;
    this.bfSeq = (this.bfSeq || 0) + 1;
    const p = pos.clone();
    p.y = this.world.groundAt(p.x, p.z, p.y + 2 * this.fx.k);
    const rec = { i: this.bfSeq, k: kind, p, r, life, o: { ...o }, t: 0, st: {}, tick: 0, cd: {} };
    this.bfBuild(rec);
    this.netEv({ t: 'bfadd', i: rec.i, k: kind, p: arr(p), r: +r.toFixed(2), l: life, o: rec.o });
    return rec.i;
  },
  bfBuild(rec) {
    if (!this.bfs) this.bfs = [];
    if (this.bfs.some((x) => x.i === rec.i)) return;
    const v = buildField(rec.k, rec.r, { ...rec.o, k: this.fx.k });
    v.group.position.copy(rec.p);
    if (rec.o.dir) v.group.rotation.y = Math.atan2(-rec.o.dir[0], -rec.o.dir[1]);
    // 不會移動的場地：圓盤貼著地形
    if (!rec.o.dir && !rec.o.follow)
      conformField(v.group, (x, z) => this.world.groundAt(x, z, rec.p.y + 1.2 * this.fx.k), this.fx.k); // 不爬上高的物件
    this.scene.add(v.group);
    rec.vis = v;
    this.bfs.push(rec);
    this.bfHooks();
  },
  bfRemove(id) {
    const k = (this.bfs || []).findIndex((x) => x.i === id);
    if (k < 0) return;
    const rec = this.bfs[k];
    if (rec.vis) this.scene.remove(rec.vis.group);
    this.bfs.splice(k, 1);
    if (this.bfHost()) this.netEv({ t: 'bfrm', i: id });
    this.bfHooks();
  },
  bfClear() {
    for (const rec of this.bfs || []) if (rec.vis) this.scene.remove(rec.vis.group);
    this.bfs = [];
    this.bfDarkT = 0;
    const d = document.getElementById('bfDark');
    if (d) d.style.opacity = '0';
    this.bfHooks();
  },
  // 視線：煙霧、蒸氣擋住（敵人的感知與 Boss 的射線；World.losBlocked 的 losHook2）
  bfHooks() {
    const w = this.world;
    if (!w) return;
    const any = (this.bfs || []).some((x) => x.k === 'haze' || x.k === 'steam');
    w.losHook2 = any ? (a, b) => this.bfLos(a, b) : null;
  },
  bfLos(a, b) {
    for (const f of this.bfs || []) {
      if (f.k !== 'haze' && f.k !== 'steam') continue;
      if (Math.max(a.y, b.y) > f.p.y + 8 * this.fx.k) continue;
      // 線段到圓心的水平距離
      const dx = b.x - a.x,
        dz = b.z - a.z;
      const L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((f.p.x - a.x) * dx + (f.p.z - a.z) * dz) / L2));
      const px = a.x + dx * t - f.p.x,
        pz = a.z + dz * t - f.p.z;
      if (px * px + pz * pz < f.r * f.r * 0.8) return true;
    }
    return false;
  },
  // 在場地裡（水平）＋貼地
  bfIn(f, e, ground = true) {
    if (Math.hypot(e.pos.x - f.p.x, e.pos.z - f.p.z) > f.r + (e.radius || 1) * 0.3) return false;
    if (!ground) return true;
    return e.pos.y - this.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 1) < 1.5 * this.fx.k;
  },
  bfTeam(f) {
    const s = f.o.src ? this.entById(f.o.src) : null;
    return s ? s.team : 'enemy';
  },
  // 移動（MechEntity.move，各端）：流沙緩速＋往中心吸、冰面滑、坑洞緩速；回傳新的加速度
  bfMove(e, target, acc) {
    if (!this.bfs || !this.bfs.length || e.noPush || e.flying) return acc;
    const K = this.fx.k;
    for (const f of this.bfs) {
      if (f.k !== 'quicksand' && f.k !== 'ice' && !(f.k === 'collapse' && f.st.open)) continue;
      if (e.team === this.bfTeam(f) || !this.bfIn(f, e)) continue;
      if (f.k === 'ice') {
        acc *= 0.15; // 冰面：幾乎停不住
        target.multiplyScalar(1.1);
      } else {
        target.multiplyScalar(f.k === 'quicksand' ? 0.5 : 0.6);
        if (f.k === 'quicksand') {
          const to = V(f.p.x - e.pos.x, 0, f.p.z - e.pos.z);
          const d = to.length();
          if (d > 0.5 * K) target.addScaledVector(to.divideScalar(d), 5 * K);
        }
      }
    }
    return acc;
  },
  // 鎖定距離（player.js 的 lockReach）：在煙霧裡、全場變暗時變短
  bfLockK(p) {
    let k = this.bfDarkT > 0 ? 0.75 : 1;
    for (const f of this.bfs || []) if (f.k === 'haze' && this.bfIn(f, p, false)) k = Math.min(k, 0.6);
    return k;
  },
  // 燃燒地面的安全區（蒸氣裡）
  bfSafe(pos) {
    for (const f of this.bfs || [])
      if (f.k === 'steam' && Math.hypot(pos.x - f.p.x, pos.z - f.p.z) < f.r) return true;
    return false;
  },
  // 全場變暗（sec 秒）：畫面暗下來、鎖定距離 ×0.75
  bfDarkness(sec) {
    this.bfDarkT = sec;
    if (this.bfHost()) this.netEv({ t: 'bfdark', d: sec });
  },
  // ---------- 房主每格 ----------
  bfTick(dt) {
    if (!this.bfs || !this.bfs.length || !this.bfHost()) return;
    const K = this.fx.k;
    for (const f of this.bfs.slice()) {
      f.t += dt;
      if (f.t >= f.life) {
        this.bfRemove(f.i);
        continue;
      }
      const src = f.o.src ? this.entById(f.o.src) : null;
      const dm = src ? src.dmgMul : 1;
      const hs = (src ? this.hostilesOfEnt(src) : this.playersAlive()).filter(
        (t) => t && !t.dead && !t.isProp && t.pos,
      );
      // 跟著 Boss
      if (f.o.follow) {
        const fe = this.entById(f.o.follow);
        if (!fe || fe.dead) {
          this.bfRemove(f.i);
          continue;
        }
        f.p.set(fe.pos.x, this.world.groundAt(fe.pos.x, fe.pos.z, fe.pos.y + 1), fe.pos.z);
        this.bfSync(f, dt);
      }
      f.tick -= dt;
      switch (f.k) {
        case 'shock': {
          // 1.2 秒平時 → 1 秒預警 → 0.35 秒放電
          const c = f.t % 2.55;
          const ph = c < 1.2 ? 0 : c < 2.2 ? 1 : 2;
          if (ph !== f.st.ph) {
            f.st.ph = ph;
            if (ph === 2) {
              f.st.n = (f.st.n || 0) + 1;
              SFX.play('laser2', 0.8, 0.7, 0.05, 0.05, f.p);
              for (const t of hs) {
                if (!this.bfIn(f, t)) continue;
                t.takeDamage(160 * dm, 300 * dm, src, t.center(), null, undefined, undefined, 'en');
                if (t.en !== undefined) t.en = Math.max(0, t.en - (t.enMax || 0) * 0.2); // 扣 EN
              }
            }
            this.netEv({ t: 'bfst', i: f.i, st: f.st });
          }
          break;
        }
        case 'collapse':
          if (!f.st.open && f.t >= (f.o.delay || 1.6)) {
            f.st.open = true;
            this.fx.dust(f.p.clone(), f.r / K, 18, 0x6e5e4c);
            this.fx.shockwave(f.p.clone(), f.r / K, 0x9a8a70, 0.4);
            SFX.play('explode2', 0.8, 0.6, 0.05, 0.05, f.p);
            for (const t of hs) {
              if (!this.bfIn(f, t)) continue;
              const out = V(t.pos.x - f.p.x, 0, t.pos.z - f.p.z);
              if (out.lengthSq() < 0.01) out.set(1, 0, 0);
              t.takeDamage(
                300 * dm,
                900 * dm,
                src,
                t.center(),
                out.clone().normalize(),
                undefined,
                undefined,
                'exp',
              );
              t.vel.addScaledVector(out.normalize(), 14 * K);
            }
            this.netEv({ t: 'bfst', i: f.i, st: f.st });
          }
          break;
        case 'magma':
        case 'belt':
          if (f.k === 'belt') this.bfBeltMove(f, dt);
          if (f.tick > 0) break;
          f.tick = 0.25;
          for (const t of hs) {
            if (!(f.k === 'belt' ? this.bfInBelt(f, t) : this.bfIn(f, t))) continue;
            t.takeDamage(
              (f.k === 'belt' ? 220 : 140) * 0.25 * dm,
              60,
              src,
              t.center(),
              null,
              undefined,
              undefined,
              'exp',
            );
          }
          break;
        case 'minefield':
          for (const t of hs) {
            if (!this.bfIn(f, t, !f.o.air) || (f.cd[t.id] || 0) > f.t) continue;
            f.cd[t.id] = f.t + 2.2;
            const at = t.pos.clone();
            const R = 4.5 * K;
            this.fx.warnCircle(at, R, 0.7);
            this.netEv({ t: 'warn', p: arr(at), R, dl: 0.7 });
            this.later(0.7, () =>
              this.blastTeam(
                at.clone().setY(at.y + 1 * K),
                260 * dm,
                600 * dm,
                R,
                src ? src.team : 'enemy',
                src,
              ),
            );
          }
          break;
        case 'steam':
          // 蒸氣：裡面的燃燒地面熄滅
          for (const P of this.hzPools || [])
            if (Math.hypot(P.p.x - f.p.x, P.p.z - f.p.z) < f.r) P.life = Math.min(P.life, 0.3);
          break;
      }
    }
  },
  // 移動中的場地：每 0.2 秒告訴客機位置
  bfSync(f, dt) {
    f.syncT = (f.syncT || 0) - dt;
    if (f.syncT > 0) return;
    f.syncT = 0.2;
    this.netEv({ t: 'bfmv', i: f.i, p: arr(f.p) });
  },
  // 燃燒帶：沿 dir 前進，碰到作戰區域的邊就掉頭
  bfBeltMove(f, dt) {
    const Z = this.world.zone;
    const d = f.o.dir;
    f.p.x += d[0] * f.o.sp * dt;
    f.p.z += d[1] * f.o.sp * dt;
    if (f.p.x < Z[0] || f.p.x > Z[1] || f.p.z < Z[2] || f.p.z > Z[3]) {
      f.o.dir = [-d[0], -d[1]];
      f.p.x = Math.max(Z[0], Math.min(Z[1], f.p.x));
      f.p.z = Math.max(Z[2], Math.min(Z[3], f.p.z));
    }
    f.p.y = this.world.groundAt(f.p.x, f.p.z, f.p.y + 2 * this.fx.k);
    this.bfSync(f, dt);
  },
  // 在燃燒帶上（長邊與前進方向垂直）
  bfInBelt(f, e) {
    const d = f.o.dir;
    const rx = e.pos.x - f.p.x,
      rz = e.pos.z - f.p.z;
    const along = rx * d[0] + rz * d[1]; // 前進方向
    const side = rx * -d[1] + rz * d[0];
    if (Math.abs(along) > (f.o.w || f.r) / 2 || Math.abs(side) > (f.o.len || f.r * 4) / 2) return false;
    return e.pos.y - this.world.groundAt(e.pos.x, e.pos.z, e.pos.y + 1) < 2 * this.fx.k;
  },
  // ---------- 外觀（房主與客機，renderMain 每格）----------
  bfVis(dt) {
    if (this.bfDarkT > 0) this.bfDarkT -= dt;
    const d = document.getElementById('bfDark');
    if (d)
      d.style.opacity =
        this.bfDarkT > 0 && this.state === 'play' ? String(Math.min(1, this.bfDarkT / 1.5) * 0.62) : '0';
    if (!this.bfs || !this.bfs.length) return;
    const t = performance.now() / 1000;
    for (const f of this.bfs) {
      if (!f.vis) continue;
      f.vis.group.position.lerp(f.p, f.o.dir || f.o.follow ? Math.min(1, dt * 10) : 1);
      if (f.o.dir) f.vis.group.rotation.y = Math.atan2(-f.o.dir[0], -f.o.dir[1]);
      f.vis.update(t, dt, f.st);
    }
  },
  // ---------- 客機的事件 ----------
  bfClientEvent(e) {
    switch (e.t) {
      case 'bfadd':
        if (this.world)
          this.bfBuild({
            i: e.i,
            k: e.k,
            p: V(...e.p),
            r: e.r,
            life: e.l,
            o: e.o || {},
            t: 0,
            st: {},
            tick: 0,
            cd: {},
          });
        return true;
      case 'bfst': {
        const f = (this.bfs || []).find((x) => x.i === e.i);
        if (f) f.st = e.st || {};
        return true;
      }
      case 'bfmv': {
        const f = (this.bfs || []).find((x) => x.i === e.i);
        if (f) f.p.set(...e.p);
        return true;
      }
      case 'bfrm':
        this.bfRemove(e.i);
        return true;
      case 'bfdark':
        this.bfDarkT = e.d;
        return true;
    }
    return false;
  },
  // ---------- BOSS_KIT 的 field 用的小工具 ----------
  // 掩體：玩家和 Boss 之間排 n 個（kind＝berm／rubble／crate／pillar／slab；o.h／w／d 舊尺度的公尺、hp、life、spread）
  bfCover(b, kind, n, o = {}) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const K = this.fx.k;
    const mid = o.at ? o.at.clone() : pl.pos.clone().lerp(b.pos, 0.35);
    const dir = b.pos.clone().sub(pl.pos).setY(0);
    const yaw = dir.lengthSq() > 0.01 ? Math.atan2(dir.x, dir.z) : 0;
    const side = V(Math.cos(yaw), 0, -Math.sin(yaw));
    for (let i = 0; i < n; i++) {
      const p = mid.clone().addScaledVector(side, (i - (n - 1) / 2) * (o.spread || 14) * K);
      this.addTempWall(p, {
        kind,
        w: (o.w || 7) * K,
        h: (o.h || 4) * K,
        d: (o.d || 2) * K,
        yaw,
        hp: o.hp || 1400,
        life: o.life || 70,
      });
    }
  },
  // 一種場地放 n 處：where＝'player'（玩家周圍）、'boss'、'line'（兩者之間）、'center'（作戰區域中央）
  bfAround(b, kind, where, n, R, life, o = {}) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const K = this.fx.k;
    const Z = this.world.zone;
    for (let i = 0; i < n; i++) {
      let p;
      if (where === 'line') p = pl.pos.clone().lerp(b.pos, (i + 1) / (n + 1));
      else {
        const c =
          where === 'boss' ? b.pos : where === 'center' ? V((Z[0] + Z[1]) / 2, 0, (Z[2] + Z[3]) / 2) : pl.pos;
        const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.random() * 0.8,
          r = (n > 1 ? 10 + Math.random() * 10 : 0) * K;
        p = c.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      this.bfAdd(kind, p, R * K, life, { src: b.id, ...o });
    }
  },
  // 霧團（煙霧 0x8a8e96、沙塵 0xc8a070、暴風雪 0xeef6ff）；follow＝跟著 Boss
  bfHaze(b, color, R, follow) {
    const pl = this.playersAlive()[0];
    const at = follow || !pl ? b.pos : pl.pos.clone().lerp(b.pos, 0.5);
    this.bfAdd('haze', at, R * this.fx.k, follow ? 9999 : 35, {
      src: b.id,
      color,
      follow: follow ? b.id : 0,
    });
  },
  // 移動的燃燒帶：從 Boss 那一側往玩家掃過去，碰到邊界掉頭
  bfBelt(b, life = 40) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const K = this.fx.k;
    const d = pl.pos.clone().sub(b.pos).setY(0);
    if (d.lengthSq() < 0.01) d.set(1, 0, 0);
    d.normalize();
    const Z = this.world.zone;
    const len = Math.max(Z[1] - Z[0], Z[3] - Z[2]) * 0.8;
    this.bfAdd('belt', b.pos.clone().addScaledVector(d, 6 * K), 4 * K, life, {
      src: b.id,
      dir: [+d.x.toFixed(3), +d.z.toFixed(3)],
      sp: 7 * K,
      len,
      w: 5 * K,
    });
  },
  // 吊掛的貨櫃落下：預警圈 1.2 秒後砸下（傷害），變成掩體
  bfCrates(b, n) {
    const pl = this.playersAlive()[0];
    if (!pl) return;
    const K = this.fx.k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random(),
        r = (8 + Math.random() * 10) * K;
      const p = pl.pos.clone().add(V(Math.cos(a) * r, 0, Math.sin(a) * r));
      p.y = this.world.groundAt(p.x, p.z, p.y + 2 * K);
      const R = 5 * K;
      this.fx.warnCircle(p, R, 1.2);
      this.netEv({ t: 'warn', p: arr(p), R, dl: 1.2 });
      this.later(1.2, () => {
        this.blastTeam(p.clone().setY(p.y + 1 * K), 300 * b.dmgMul, 800 * b.dmgMul, R, b.team, b);
        this.fx.dust(p.clone(), 4, 14, 0x7a6a58);
        this.addTempWall(p, { kind: 'crate', w: 12 * K, h: 2.6 * K, d: 2.5 * K, yaw: a, hp: 1600, life: 80 });
      });
    }
    this.flashAlert('戰場改變 — 吊掛的貨櫃落下（之後可以當掩體）');
  },
});
