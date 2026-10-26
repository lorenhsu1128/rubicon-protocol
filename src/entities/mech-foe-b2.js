// ---------- MechEntity 擴充：地圖專屬敵人（B2 組，data/foes-b2.js） ----------
// riveter 鉚釘槍 MT：槍口預警（橘光＋瞄準線）→ 黏性鉚釘，命中時 addStatus('stick')。bossVis＝0 待機／1 預警／2 後座。
// welder 電焊 MT：貼近 → 焊槍藍光預警（面罩拉下）→ 電弧連到目標（addStatus('drain')＋少量能量傷害），
//   拉開 12 m 就斷。bossVis 1 預警／2 電弧中，bx＝[目標 id]（客機畫電弧）。
// watercannon 高壓水砲車：砲口白霧蓄水 1.2 秒（bossVis 1）→ 水柱（傷害低、衝擊極高；bossVis 2，bx＝[水柱長度]）。
// turbine 渦輪吸入機：移到附近的水道／取水口；預警 1.5 秒（虹彩蓋半開，bossVis 1）→ 吸入 6 秒
//   （addZone('suction')，葉片近身傷害；bossVis 2，此時正面受傷 ×1.6）。
// eel 電鰻無人機：貼水面游；充電 1.5 秒（水面的電流紋預警，bossVis 1）→ addZone('electro') 4 秒（bossVis 2）。
// buoy 漂流水雷浮標：沿水面漂向目標，靠近（bossVis 1 閃燈變快）到 4 m 內引信（bossVis 2）0.4 秒後爆炸
//   （explodeOnDeath，敵我都炸；被射爆也一樣會波及其他敵人）。
// 行為只在房主／單機（foeMove_b2／foeFire_b2）；外觀（foeFx_b2）房主與客機都依 bossVis／bx 驅動。
// 狀態效果（entities/mech-status.js 的 addStatus）與場上機制（game/hazards2.js 的 addZone）。
import { SFX } from '../audio/audio.js';
import { DS, MS } from '../core/scale.js';
import { clamp, lerp, rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';
import { Projectile } from './projectile.js';

const PI = Math.PI,
  PI2 = Math.PI * 2,
  HP2 = Math.PI / 2;
const B2 = new Set(['riveter', 'welder', 'watercannon', 'turbine', 'eel', 'buoy']);
const ARC_R = 12 * DS; // 電弧拉開這個距離就斷
const WATER_LEN = 42 * DS; // 水柱射程
const SUCK_R = 18 * MS; // 吸入範圍
const BUOY_R = 4 * MS; // 浮標的引爆距離
const _v = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _up = new THREE.Vector3(0, 1, 0);

Object.assign(MechEntity.prototype, {
  // mech-foe.js 的 foeMove 轉過來：回傳 undefined＝不是這組的
  foeMove_b2(dt, d, dir, perp, wish, pl) {
    if (!B2.has(this.ai)) return undefined;
    const r = { hover: false, qb: false, ab: false, done: false };
    const s = this.aiState;
    switch (this.ai) {
      case 'riveter':
        if (s.rv === 1)
          wish.set(0, 0, 0); // 瞄準時站穩
        else if (d > s.want + 4 * DS) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
        else if (d < s.want - 5 * DS) wish.copy(dir).negate().addScaledVector(perp, 0.4).normalize();
        else wish.copy(perp).multiplyScalar(0.6);
        this.stuckJump(dt, r);
        return r;
      case 'welder':
        if (s.wd === 2) {
          if (d > 6 * DS) wish.copy(dir);
          else wish.copy(perp).multiplyScalar(0.3);
        } else if (s.wd === 1) wish.copy(dir).multiplyScalar(d > 5 * DS ? 0.5 : 0);
        else if (d > 4.5 * DS) {
          wish.copy(dir).addScaledVector(perp, 0.25).normalize();
          if (d > 16 * DS && Math.random() < dt * 0.7) r.qb = true;
        } else wish.copy(perp).multiplyScalar(0.4);
        this.stuckJump(dt, r);
        return r;
      case 'watercannon':
        if (s.wc) wish.set(0, 0, 0);
        else if (d > s.want + 6 * DS) wish.copy(dir).multiplyScalar(0.8);
        else if (d < s.want - 8 * DS) wish.copy(dir).multiplyScalar(-0.7);
        else wish.copy(perp).multiplyScalar(0.5);
        this.stuckJump(dt, r);
        return r;
      case 'turbine':
        this.noPush = true;
        wish.set(0, 0, 0);
        if (!s.tbInit) this.turbinePlace_b2();
        return r;
      case 'eel':
        return this.eelMove_b2(dt, d, dir, perp, wish, pl, r);
      case 'buoy':
        return this.buoyMove_b2(dt, d, dir, wish, pl, r);
    }
    return undefined;
  },
  // aiSpecialFire 轉過來（mech-foe.js 的 foeFire）：true＝自己處理開火（略過一般武器）
  foeFire_b2(dt, d, aimPos, pl) {
    if (!B2.has(this.ai)) return undefined;
    switch (this.ai) {
      case 'riveter':
        this.riveterFire_b2(dt, d, pl);
        return true;
      case 'welder':
        this.welderFire_b2(dt, d, pl);
        return true;
      case 'watercannon':
        this.waterFire_b2(dt, d, pl);
        return true;
      case 'turbine':
        return this.turbineFire_b2(dt, d);
      case 'eel':
      case 'buoy':
        return true;
    }
    return undefined;
  },
  // ---------- 鉚釘槍 MT ----------
  riveterFire_b2(dt, d, pl) {
    const s = this.aiState,
      g = this.game;
    if (s.rv === undefined) {
      s.rv = 0;
      s.rvT = rnd(1.5, 3);
    }
    s.rvT -= dt;
    if (s.rv === 0) {
      if (s.rvT <= 0 && d < 40 * DS && this.canAct()) {
        s.rv = 1;
        s.rvT = 0.7;
        const mz = this.muzzle('rarm');
        g.fx.warnLine(mz, pl.center(), 0.7, 0xffa030);
        g.fx.flash(mz, 0.9, 0xffa030, 0.7);
        SFX.play('charge', 0.6, 1.4, 0.05, 0.05, this.center());
      }
    } else if (s.rv === 1) {
      if (!this.canAct()) {
        s.rv = 0;
        s.rvT = 2;
      } else if (s.rvT <= 0) {
        this.rivetShot_b2(pl, d);
        s.rv = 2;
        s.rvT = 0.35;
      }
    } else if (s.rvT <= 0) {
      s.rv = 0;
      s.rvT = rnd(3, 4);
    }
    this.bossVis = s.rv;
  },
  // 黏性鉚釘：一般的實彈投射物，命中機體時黏上（stick：3 秒後爆炸，QB 兩次甩掉）
  rivetShot_b2(pl, d) {
    const g = this.game;
    const mz = this.muzzle('rarm');
    const tgt = pl.center().addScaledVector(pl.vel, Math.min(0.6, d / (60 * DS)) * 0.7);
    const v = tgt
      .sub(mz)
      .normalize()
      .multiplyScalar(60 * DS);
    const me = this;
    const p = new Projectile(g, {
      pos: mz.clone(),
      vel: v,
      kind: 'bullet',
      attr: 'kin',
      dmg: 150 * this.dmgMul,
      impactV: 260 * this.dmgMul,
      team: this.team,
      owner: this,
      color: 0xffa030,
      life: 1.2,
    });
    const imp = p.impact;
    p.impact = function (direct) {
      imp.call(this, direct);
      if (direct && !direct.isProp && !direct.dead) {
        direct.addStatus?.('stick', 3, { dmg: 420 * me.dmgMul, impact: 750 * me.dmgMul });
        g.fx.ring(direct.center(), 1.2, 0xffa030);
        me.aiState.stuckN = (me.aiState.stuckN || 0) + 1; // 冒煙測試用：黏上幾次
      }
    };
    g.projectiles.push(p);
    g.fx.muzzle(mz, v.clone().normalize(), 0xffa030, 1.4);
    SFX.play('pistol', 0.8, 0.7, 0.05, 0.05, mz);
  },
  // ---------- 電焊 MT ----------
  welderFire_b2(dt, d, pl) {
    const s = this.aiState,
      g = this.game;
    if (s.wd === undefined) {
      s.wd = 0;
      s.wdT = rnd(0.5, 1.5);
    }
    s.wdT -= dt;
    if (s.wd === 0) {
      if (s.wdT <= 0 && d < 9 * DS && this.canAct()) {
        s.wd = 1;
        s.wdT = 0.8;
        const tp = this.muzzle('rarm');
        g.fx.warnLine(tp, pl.center(), 0.8, 0x60a8ff);
        g.fx.streaks(tp, 8, 0x9fd0ff, 6, 0.3, 10);
        SFX.play('charge', 0.6, 1.8, 0.05, 0.05, this.center());
      }
    } else if (s.wd === 1) {
      if (!this.canAct()) {
        s.wd = 0;
        s.wdT = 2;
      } else if (s.wdT <= 0) {
        if (d < ARC_R - 1 * DS) {
          s.wd = 2;
          s.wdT = 3;
          s.tick = 0;
          s.drT = 0;
          s.arcTgt = pl;
          SFX.play('laser2', 0.7, 0.8, 0.05, 0.05, this.center());
        } else {
          s.wd = 0;
          s.wdT = 1.5;
        }
      }
    } else {
      const t = s.arcTgt;
      const gone = !t || t.dead || t.pos.distanceTo(this.pos) > ARC_R || !this.canAct();
      if (gone || s.wdT <= 0) {
        if (gone && t && !t.dead) g.fx.spark(this.muzzle('rarm'), 0x9fd0ff);
        s.wd = 0;
        s.wdT = rnd(4, 5);
        s.arcTgt = null;
      } else {
        s.tick -= dt;
        s.drT -= dt;
        if (s.drT <= 0) {
          s.drT = 1;
          t.addStatus?.('drain', 2, { en: 380 });
          s.drainN = (s.drainN || 0) + 1; // 冒煙測試用
        }
        if (s.tick <= 0) {
          s.tick = 0.25;
          t.takeDamage(
            32 * this.dmgMul,
            40 * this.dmgMul,
            this,
            t.center(),
            null,
            undefined,
            undefined,
            'en',
          );
        }
      }
    }
    this.bossVis = s.wd;
    this.bx = s.wd === 2 && s.arcTgt ? [s.arcTgt.id] : null;
  },
  // ---------- 高壓水砲車 ----------
  waterFire_b2(dt, d, pl) {
    const s = this.aiState,
      g = this.game;
    if (s.wcT === undefined) {
      s.wc = 0;
      s.wcT = rnd(2, 3.5);
    }
    s.wcT -= dt;
    if (s.wc === 0) {
      if (s.wcT <= 0 && d < WATER_LEN && this.canAct()) {
        s.wc = 1;
        s.wcT = 1.2;
        s.mistT = 0;
        s.aimP = pl.center();
        g.fx.warnLine(this.muzzle('rarm'), pl.center(), 1.2, 0xe8f4ff, 0.1);
        SFX.play('splash', 0.7, 0.6, 0.05, 0.05, this.center());
      }
    } else if (s.wc === 1) {
      // 蓄水：瞄準點跟著目標，發射前 0.2 秒鎖住
      if (s.wcT > 0.2) s.aimP.lerp(pl.center().addScaledVector(pl.vel, 0.25), Math.min(1, dt * 5));
      this.setAim(s.aimP);
      s.mistT -= dt;
      if (s.mistT <= 0) {
        s.mistT = 0.2;
        g.fx.dust(this.muzzle('rarm'), 0.7, 3, 0xf4faff);
      }
      if (!this.canAct()) {
        s.wc = 0;
        s.wcT = 2.5;
      } else if (s.wcT <= 0) {
        this.waterShot_b2();
        s.wc = 2;
        s.wcT = 0.6;
      }
    } else if (s.wcT <= 0) {
      s.wc = 0;
      s.wcT = rnd(5, 6.5);
    }
    this.bossVis = s.wc;
    if (s.wc !== 2) this.bx = null;
  },
  // 水柱：從砲口往瞄準點的直線（地形與障礙物擋住就停），第一個碰到的敵方機體受到低傷害、極高衝擊
  waterShot_b2() {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    const mz = this.muzzle('rarm');
    const dv = s.aimP.clone().sub(mz).normalize();
    let L = WATER_LEN; // 砲管尖端插進牆裡時不算（從 3 m 起檢查）
    for (let k = 3 * MS; k < WATER_LEN; k += 1.5 * MS) {
      _v.copy(mz).addScaledVector(dv, k);
      if (w.hitsWorld(_v)) {
        L = k;
        break;
      }
    }
    let best = null,
      bu = L;
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead) continue;
      const c = t.center();
      const u = c.clone().sub(mz).dot(dv);
      if (u < 0 || u > bu) continue;
      const off = c.distanceTo(_w.copy(mz).addScaledVector(dv, u));
      if (off < 1.4 * MS + t.radius) {
        best = t;
        bu = u;
      }
    }
    const end = mz.clone().addScaledVector(dv, best ? bu : L);
    s.lastL = L; // 冒煙測試用：水柱的長度
    if (best) {
      best.takeDamage(
        110 * this.dmgMul,
        2000 * this.dmgMul,
        this,
        best.center(),
        dv.clone().setY(0).normalize(),
        undefined,
        undefined,
        'kin',
      );
      s.hitN = (s.hitN || 0) + 1; // 冒煙測試用
    }
    g.fx.beam(mz, end, 0x9fd0f0, 0.3);
    g.fx.streaks(end, 16, 0xe8f6ff, 14, 0.6, 20, dv.clone().negate(), 0.9);
    g.fx.dust(end, 2.2, 10, 0xe8f6ff);
    SFX.play('splash', 1, 1.1, 0.05, 0.05, mz);
    this.bx = [+(best ? bu : L).toFixed(1)];
  },
  // ---------- 渦輪吸入機 ----------
  // 第一次：移到 25 m 內最近的水道（水深 0.5 m 以上、在作戰區域裡、不是虛空）；沒有水就留在原地
  turbinePlace_b2() {
    const s = this.aiState,
      w = this.game.world;
    s.tbInit = true;
    s.tb = 0;
    s.tbT = rnd(2.5, 4);
    if (!w.theme.water) return;
    for (let r = 0; r <= 25 * DS; r += 2.5 * DS)
      for (let a = 0; a < PI2; a += r ? (2.5 * DS) / r : PI2) {
        const x = this.pos.x + Math.cos(a) * r,
          z = this.pos.z + Math.sin(a) * r;
        if (w.waterDepth(x, z) > 0.5 * MS && w.inZone(x, z, 3 * MS) && !(w.isVoid && w.isVoid(x, z))) {
          this.pos.set(x, w.terrainHeight(x, z), z);
          this.vel.set(0, 0, 0);
          return;
        }
      }
  },
  // 回傳 true＝吸入中不開機槍；平時照一般武器（哨戒機槍）
  turbineFire_b2(dt, d) {
    const s = this.aiState,
      g = this.game;
    if (!s.tbInit) this.turbinePlace_b2();
    s.tbT -= dt;
    if (s.tb === 0) {
      if (s.tbT <= 0 && d < 40 * DS && this.canAct()) {
        s.tb = 1;
        s.tbT = 1.5;
        const p = this.pos.clone();
        g.fx.warnCircle(p, SUCK_R, 1.5, 0x60c0ff);
        g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R: SUCK_R, dl: 1.5, c: 0x60c0ff });
        SFX.play('engineHi', 0.8, 0.7, 0.05, 0.05, this.center());
      }
    } else if (s.tb === 1) {
      if (!this.canAct()) {
        s.tb = 0;
        s.tbT = 3;
      } else if (s.tbT <= 0) {
        s.tb = 2;
        s.tbT = 6;
        s.bladeT = 0;
        s.ringT = 0;
        const p = this.pos.clone();
        s.zone = g.addZone?.('suction', p, SUCK_R, 6, { to: p.clone(), pull: 9 * DS }) ?? null;
        s.suckN = (s.suckN || 0) + 1; // 冒煙測試用
        SFX.play('engineHi', 1, 1.1, 0.05, 0.05, this.center());
      }
    } else {
      // 吸入中：葉片附近的機體受傷；水面的漩渦（會轉送的 fx）
      s.bladeT -= dt;
      if (s.bladeT <= 0) {
        s.bladeT = 0.4;
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead) continue;
          const dd = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
          if (dd > 3.4 * MS + t.radius || Math.abs(t.pos.y - this.pos.y) > 5 * MS) continue;
          const out = t.pos.clone().sub(this.pos).setY(0).normalize();
          t.takeDamage(
            170 * this.dmgMul,
            420 * this.dmgMul,
            this,
            t.center(),
            out,
            undefined,
            undefined,
            'kin',
          );
          g.fx.spark(t.center(), 0xbfe8ff);
        }
      }
      s.ringT -= dt;
      if (s.ringT <= 0) {
        s.ringT = 0.6;
        g.fx.ring(this.pos.clone().setY(this.vortexY_b2() + 0.1), 7, 0x9fd8ff);
      }
      if (s.tbT <= 0 || !this.canAct()) {
        if (s.zone !== null && s.zone !== undefined) g.removeZone?.(s.zone);
        s.zone = null;
        s.tb = 0;
        s.tbT = rnd(6, 8);
      }
    }
    this.bossVis = s.tb;
    return s.tb !== 0;
  },
  // 水面的高度（世界座標）：沒有水時是地面
  vortexY_b2() {
    const w = this.game.world;
    const gy = w.terrainHeight(this.pos.x, this.pos.z);
    return w.theme.water ? Math.max(gy, w.theme.water.level) : gy;
  },
  // ---------- 電鰻無人機 ----------
  // 貼著水面（沒有水時離地 0.5 m）；只往有水的地方游，保持 10～16 m 繞著目標；充電與放電時停下
  skimH_b2(lift) {
    const w = this.game.world;
    const gy = w.terrainHeight(this.pos.x, this.pos.z);
    this.flying = true;
    this.hoverH = Math.max((lift *= MS), (w.theme.water ? w.theme.water.level : -1e9) - gy + lift * 0.4);
  },
  eelMove_b2(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    this.skimH_b2(0.5);
    if (s.el === undefined) {
      s.el = 0;
      s.elT = rnd(2.5, 4);
    }
    s.elT -= dt;
    if (s.el === 0) {
      wish
        .copy(perp)
        .addScaledVector(dir, clamp((d - s.want) / (6 * DS), -1, 1))
        .normalize();
      const wet = (x, z) => !w.theme.water || w.waterDepth(x, z) > 0.3 * MS;
      if (wet(this.pos.x, this.pos.z) && !wet(this.pos.x + wish.x * 3 * DS, this.pos.z + wish.z * 3 * DS)) {
        wish.set(-wish.z, 0, wish.x);
        if (!wet(this.pos.x + wish.x * 3 * DS, this.pos.z + wish.z * 3 * DS)) wish.negate();
      }
      if (s.elT <= 0 && d < 22 * DS && this.canAct()) {
        s.el = 1;
        s.elT = 1.5;
        const p = this.pos.clone().setY(this.vortexY_b2());
        g.fx.warnCircle(p, 14 * MS, 1.5, 0x60e8ff);
        g.netEv({ t: 'warn', p: p.toArray().map((x) => +x.toFixed(2)), R: 14 * MS, dl: 1.5, c: 0x60e8ff });
        g.fx.streaks(this.center(), 10, 0x9ff4ff, 8, 0.4, 6);
        SFX.play('charge', 0.8, 1.2, 0.05, 0.05, this.center());
      }
    } else if (s.el === 1) {
      wish.set(0, 0, 0);
      if (!this.canAct()) {
        s.el = 0;
        s.elT = 2.5;
      } else if (s.elT <= 0) {
        s.el = 2;
        s.elT = 4;
        const p = this.pos.clone().setY(this.vortexY_b2());
        g.addZone?.('electro', p, 14 * MS, 4, { dps: 120 * this.dmgMul });
        s.zapN = (s.zapN || 0) + 1; // 冒煙測試用
        g.fx.shockwave(p, 14, 0x60e8ff, 0.5);
        g.fx.flash(this.center(), 3, 0x9ff4ff, 0.2);
        SFX.play('laser2', 1, 0.6, 0.05, 0.05, this.center());
      }
    } else {
      wish.set(0, 0, 0);
      if (s.elT <= 0) {
        s.el = 0;
        s.elT = rnd(5, 7);
      }
    }
    this.bossVis = s.el;
    return r;
  },
  // ---------- 漂流水雷浮標 ----------
  buoyMove_b2(dt, d, dir, wish, pl, r) {
    const s = this.aiState;
    this.skimH_b2(0.3);
    wish.copy(dir).multiplyScalar(0.7);
    if (s.fuse !== undefined) {
      s.fuse -= dt;
      wish.set(0, 0, 0);
      this.bossVis = 2;
      if (s.fuse <= 0) this.die(pl); // explodeOnDeath：敵我都炸
      return r;
    }
    const near = d < BUOY_R + pl.radius && Math.abs(pl.pos.y - this.pos.y) < 3.5 * MS;
    if (near) {
      s.fuse = 0.4;
      SFX.play('bell', 0.9, 1.6, 0.05, 0.05, this.center());
      this.game.fx.flash(this.center(), 1.4, 0xff3020, 0.4);
    }
    this.bossVis = d < 12 * DS ? 1 : 0;
    return r;
  },
  // ---------- 防禦：渦輪吸入機的蓋子打開時，正面的傷害 ×1.6 ----------
  foeDefense_b2(dmg, impact, from, at) {
    if (this.ai !== 'turbine' || this.bossVis !== 2) return undefined;
    const src = from && from.pos && from !== this ? from.pos : at;
    if (!src) return undefined;
    const to = src.clone().sub(this.pos).setY(0);
    const fwd = _w.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (to.lengthSq() < 0.01 || to.normalize().dot(fwd) < 0.35) return undefined;
    this.game.fx.spark(at || this.center(), 0x9fe8ff);
    return [dmg * 1.6, impact * 1.3];
  },
  // ---------- 外觀（房主與客機每格；dt 可能是 0）----------
  foeFx_b2(dt) {
    if (!B2.has(this.ai)) return undefined;
    const m = this.model,
      v = this.bossVis || 0;
    const t = (this.b2t = (this.b2t || 0) + dt);
    // 移動速度：用位置差（客機沒有 AI 的速度）
    const lp = this.b2p || (this.b2p = this.pos.clone());
    const sp = dt > 0 ? Math.hypot(this.pos.x - lp.x, this.pos.z - lp.z) / dt : 0;
    lp.copy(this.pos);
    this.b2sp = lerp(this.b2sp || 0, Math.min(sp, 20), Math.min(1, dt * 8));
    // 預警的漸強（bossVis 剛變成 1 起算）
    this.b2w = v === 1 ? Math.min(1, (this.b2w || 0) + dt / 0.8) : 0;
    const walk = () => {
      const k = clamp(this.b2sp / 4, 0, 1);
      this.b2ph = (this.b2ph || 0) + dt * (2 + this.b2sp * 1.4);
      if (m.legL) m.legL.rotation.x = Math.sin(this.b2ph) * 0.42 * k;
      if (m.legR) m.legR.rotation.x = -Math.sin(this.b2ph) * 0.42 * k;
    };
    switch (this.ai) {
      case 'riveter':
        walk();
        m.ant.rotation.y += dt * 1.4;
        m.muzzleM.emissiveIntensity = v === 1 ? 0.5 + 3 * this.b2w : v === 2 ? 4 : 0.3;
        m.drum.rotation.z += dt * (v === 2 ? 14 : 0.3);
        m.gun.position.z = lerp(
          m.gun.position.z,
          v === 2 ? -0.1 : -0.3,
          Math.min(1, dt * (v === 2 ? 30 : 6)),
        );
        break;
      case 'welder': {
        walk();
        m.mask.rotation.x = lerp(m.mask.rotation.x, v ? 0.5 : 0, Math.min(1, dt * 8));
        m.arm.rotation.x =
          lerp(m.arm.rotation.x, v ? -0.32 : 0, Math.min(1, dt * 6)) +
          (v === 2 ? (Math.random() - 0.5) * 0.03 : 0);
        m.coil.rotation.z += dt * (v ? 9 : 1.5);
        const fl = v === 2 ? 2.5 + Math.random() * 2 : v === 1 ? 0.5 + 3 * this.b2w : 0.4;
        m.torchM.emissiveIntensity = fl;
        m.coilM.emissiveIntensity = v ? fl : 0.5;
        this.arcFx_b2(v === 2 && this.bx && !this.dead ? this.game.entById(this.bx[0]) : null);
        break;
      }
      case 'watercannon': {
        m.pump.rotation.x += dt * (v ? 14 : 2.5);
        for (const o of m.outs) {
          const s = Math.sign(o.position.x);
          o.rotation.z = lerp(o.rotation.z, s * (v ? -0.45 : 0.15), Math.min(1, dt * 5));
        }
        m.barrel.position.z = lerp(
          m.barrel.position.z,
          v === 2 ? -0.25 : -0.5,
          Math.min(1, dt * (v === 2 ? 30 : 4)),
        );
        m.mistM.emissiveIntensity = v === 1 ? 0.3 + 2.5 * this.b2w : v === 2 ? 3 : 0.2;
        this.waterFx_b2(v === 2 && this.bx && !this.dead ? this.bx[0] : 0);
        break;
      }
      case 'turbine': {
        m.fan.rotation.z += dt * (v === 2 ? 24 : v === 1 ? 9 : 1.2);
        const open = v === 2 ? 1 : v === 1 ? 0.55 : 0;
        for (const h of m.petals)
          h.rotation.y = lerp(h.rotation.y, lerp(-0.12, -1.4, open), Math.min(1, dt * 4));
        m.beacon.rotation.y += dt * (v ? 9 : 2.5);
        m.intakeM.emissiveIntensity =
          v === 2 ? 2.5 + Math.sin(t * 20) * 0.5 : v === 1 ? 0.4 + 2 * this.b2w : 0.4;
        this.ringsFx_b2(v, t, false);
        break;
      }
      case 'eel':
        for (let i = 0; i < m.segs.length; i++)
          m.segs[i].rotation.y = Math.sin(t * (v ? 9 : 4) - i * 0.9) * (v ? 0.08 : 0.2);
        m.prop.rotation.z += dt * (v ? 6 : 22);
        this.ringsFx_b2(v, t, true);
        m.coilM.emissiveIntensity =
          v === 2
            ? 2.5 + Math.random() * 2.5
            : v === 1
              ? 0.4 + 3.5 * this.b2w * (0.6 + Math.random() * 0.4)
              : 0.4;
        break;
      case 'buoy': {
        m.body.rotation.x = Math.sin(t * 1.3) * 0.12;
        m.body.rotation.z = Math.cos(t * 1.1) * 0.1;
        m.body.position.y = Math.sin(t * 1.7) * 0.06;
        const per = v === 2 ? 0.1 : v === 1 ? 0.45 : 1.3;
        m.lampM.emissiveIntensity = (t % per) / per < 0.4 ? 4 : 0.2;
        const hs = v === 2 ? 1.25 : 1;
        m.horns.scale.setScalar(lerp(m.horns.scale.x, hs, Math.min(1, dt * 10)));
        break;
      }
    }
    return true;
  },
  // 電焊 MT 的電弧：從焊槍到目標的折線（掛在機體上，跟著一起移除）
  arcFx_b2(tgt) {
    let a = this.b2arc;
    if (!tgt || tgt.dead) {
      if (a) a.visible = false;
      return;
    }
    if (!a) {
      a = this.b2arc = new THREE.Group();
      const geo = new THREE.CylinderGeometry(1, 1, 1, 5);
      const mOut = new THREE.MeshBasicMaterial({
        color: 0x60a8ff,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const mIn = new THREE.MeshBasicMaterial({
        color: 0xe8f4ff,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      for (let i = 0; i < 8; i++) {
        const o = new THREE.Mesh(geo, mOut);
        o.scale.set(0.12, 1, 0.12);
        const c = new THREE.Mesh(geo, mIn);
        c.scale.set(0.4, 1, 0.4);
        o.add(c);
        o.userData.helper = true;
        a.add(o);
      }
      this.mesh.add(a);
    }
    a.visible = true;
    const p0 = this.muzzle('rarm'),
      p1 = tgt.center();
    const n = a.children.length;
    let prev = this.mesh.worldToLocal(p0.clone());
    for (let i = 0; i < n; i++) {
      const k = (i + 1) / n;
      const q = p0.clone().lerp(p1, k);
      if (i < n - 1) q.add(_v.set(rnd(-0.35, 0.35) * MS, rnd(-0.35, 0.35) * MS, rnd(-0.35, 0.35) * MS));
      const ql = this.mesh.worldToLocal(q);
      const seg = a.children[i];
      const dv = ql.clone().sub(prev);
      const L = dv.length();
      seg.position.copy(prev).addScaledVector(dv, 0.5);
      seg.quaternion.setFromUnitVectors(_up, dv.normalize());
      seg.scale.y = Math.max(0.01, L);
      prev = ql;
    }
  },
  // 高壓水砲車的水柱：掛在砲口（hand）上往 −Z 延伸 L 公尺（bx[0]）
  waterFx_b2(L) {
    let c = this.b2col;
    if (!(L > 0)) {
      if (c) c.visible = false;
      return;
    }
    if (!c) {
      c = this.b2col = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.55, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xcfe6f6,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      c.rotation.x = -HP2;
      c.userData.helper = true;
      this.model.arms.r.hand.add(c);
    }
    const s = this.mesh.scale.x || 1, // 手的世界倍率＝模型根節點
      u = (this.scale || 1) / s;
    c.visible = true;
    c.scale.set((1 + Math.random() * 0.25) * u, L / s, (1 + Math.random() * 0.25) * u);
    c.position.set(0, 0, -L / s / 2);
    c.material.opacity = 0.4 + Math.random() * 0.2;
  },
  // 水面的環紋：渦輪吸入機的漩渦（預警時小、吸入時大、旋轉）／電鰻的電流紋（預警時往外擴到 14 m、放電時閃爍）
  ringsFx_b2(v, t, eel) {
    let vx = this.b2vx;
    if (!v || this.dead) {
      if (vx) vx.visible = false;
      return;
    }
    if (!vx) {
      vx = this.b2vx = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({
        color: eel ? 0x80f0ff : 0x9fd8ff,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      for (let i = 0; i < (eel ? 4 : 3); i++) {
        const r0 = eel ? 3.5 * (i + 1) : 2 + i * 2.2;
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(r0, r0 + (eel ? 0.22 : 0.5), eel ? 40 : 24, 1, 0, PI * (eel ? 1.7 : 1.3)),
          mat,
        );
        ring.rotation.x = -HP2;
        ring.rotation.z = i * 2;
        vx.add(ring);
      }
      vx.userData.helper = true;
      this.mesh.add(vx);
    }
    const s = this.scale || 1;
    vx.visible = true;
    vx.position.y = (this.vortexY_b2() - this.pos.y + 0.08) / s;
    if (eel) {
      // 機體的偏擺不影響水面的紋路
      vx.rotation.y = Math.random() * PI2 - this.yaw;
      vx.scale.setScalar(((v === 2 ? 1 : 0.25 + 0.75 * this.b2w) * MS) / s);
      vx.children[0].material.opacity = v === 2 ? 0.3 + Math.random() * 0.5 : 0.35 + 0.3 * this.b2w;
    } else {
      vx.rotation.y = -t * (v === 2 ? 3 : 1.2);
      vx.scale.setScalar(((v === 2 ? 1 : 0.5) * MS) / s);
    }
  },
});
