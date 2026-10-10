// ---------- MechEntity 擴充：主題專屬敵人（data/foes.js） ----------
// drill 鑽頭採礦機（衝向目標、貼身鑽擊）、junk 廢鐵合成體（外殼吸收傷害、吸附可破壞物件補外殼）；
// 拾荒 MT（opts.foe 'scav'）撿同伴零件強化的處理在 game/mission.js 的 onEnemyKilled（foeScavenge）。
// crane 起重機砲台（不移動，丟貨櫃到預警圈）、forklift 叉架 MT（舉貨櫃當盾、靠近丟出）：吊著／舉著貨櫃＝bossVis 1。
// gategun 閘門砲台：站上水壩的閘門，預警後開閘，下游的水流把機體往下游推（game/support.js 的 addFlow）。
// gunboat 潛航砲艇（潛航＝bossVis 1：隱藏、打不到，浮出後發射魚雷）、sprayer 汙染噴射 MT（腐蝕區）、
// marsh 專屬 AC MARSH（在水中離目標遠時潛行＝bossVis 2：隱藏、不能鎖定）。
// lurker 雪中潛伏 MT（埋在雪裡＝bossVis 1：隱藏、不能鎖定，靠近才現身）、skater 冰面滑行砲車（繞圈、冰面加速）、
// whiteout 專屬 AC WHITEOUT（沒開火時隱藏＝bossVis 2）。
// blob 實驗體（撲咬；三隻以上聚集時融合成 chimera）、laserpost 保全雷射網（旋轉的柵欄，碰到受傷並叫增援）、
// specimen 專屬 AC SPECIMEN（定期過載＝bossVis 4，之後硬直）。
// crawler 構造體爬行機（目標在高處時沿柱子爬上去）、underturret 平台底部砲塔（吊在平台底面）、
// spire 專屬 AC SPIRE（佔高處）、testrig 推進器試車台（預警後噴火橫掃）、hopper 舊式宇宙用 MT（長時間滯空）。
// rammer 衝撞無人機（預警後衝撞、往外推）、flak 艦載防空砲（專打空中）、undertow 專屬 AC UNDERTOW（貼身往外推）。
// vacuum 真空作業機（懸浮、改變高度閃避）、marker 軌道標定衛星（標定目標＝markT，受傷 ×1.3）、zenith 專屬 AC ZENITH（空戰）。
// 行為只在房主／單機執行；外殼量以 sx 同步給客機（顯示外殼大小）。
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';
import { Projectile } from './projectile.js';

const SHELL_K = 0.8; // 外殼吸收的比例
const HIDE_AI = new Set(['burrow', 'gunboat', 'marsh', 'lurker', 'whiteout']); // 會隱藏（不能鎖定）的
const DRILL_R = 3.6; // 鑽擊距離
// 近戰命中的參數（takeDamage 的 melee：kb＝擊退速度；不能只傳 true，否則擊退是 NaN）
const DRILL_HIT = { kb: 9 },
  RAM_HIT = { kb: 20 },
  SHOVE_HIT = { kb: 26 },
  BITE = { kb: 4 },
  BITE_BIG = { kb: 12 };

Object.assign(MechEntity.prototype, {
  // aiSpecialMove 轉過來：回傳 null＝不是這裡的
  foeMove(dt, d, dir, perp, wish, pl) {
    const s = this.aiState;
    const r = { hover: false, qb: false, ab: false, done: false };
    if (this.ai === 'drill') {
      if (d > 2.5) wish.copy(dir);
      else wish.copy(perp).multiplyScalar(0.3);
      if (d > 14 && Math.random() < dt * 0.6) r.qb = true;
      s.drillT = (s.drillT === undefined ? 1 : s.drillT) - dt;
      if (d < DRILL_R && s.drillT <= 0 && this.canAct()) {
        s.drillT = 1.6;
        const at = pl.center();
        pl.takeDamage(420 * this.dmgMul, 1500 * this.dmgMul, this, at, dir.clone(), DRILL_HIT);
        this.game.fx.meleeHit(at, 0xffc070, true, dir.clone());
        SFX.meleeHit(true, at);
        s.spin = 0.6;
      }
      s.spin = Math.max(0, (s.spin || 0) - dt);
      if (this.model.drill) this.model.drill.rotation.z += dt * (s.spin > 0 ? 30 : 6);
      this.stuckJump(dt, r);
      return r;
    }
    if (this.ai === 'burrow') return this.foeBurrow(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'crane') {
      this.noPush = true;
      wish.set(0, 0, 0);
      return r;
    }
    if (this.ai === 'forklift') return this.foeForklift(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'gategun') return this.foeGate(dt, d, dir, wish, pl, r);
    if (this.ai === 'gunboat') return this.foeGunboat(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'sprayer') return this.foeSprayer(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'marsh') return this.foeMarsh(dt, d, dir, perp, wish, r);
    if (this.ai === 'lurker') return this.foeLurker(dt, d, dir, perp, wish, r);
    if (this.ai === 'skater') return this.foeSkater(dt, d, dir, perp, wish, r);
    if (this.ai === 'whiteout') return this.foeWhiteout(dt, d, dir, perp, wish, r);
    if (this.ai === 'blob') return this.foeBlob(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'laserpost') return this.foeLaserPost(dt, wish, r);
    if (this.ai === 'specimen') return this.foeSpecimen(dt, d, dir, perp, wish, r);
    if (this.ai === 'crawler') return this.foeCrawler(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'underturret') return this.foeUnderTurret(wish, r);
    if (this.ai === 'spire') return this.foeSpire(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'testrig') return this.foeTestRig(dt, d, wish, pl, r);
    if (this.ai === 'hopper') return this.foeHopper(dt, d, dir, perp, wish, r);
    if (this.ai === 'rammer') return this.foeRammer(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'flak') {
      this.noPush = true;
      wish.set(0, 0, 0);
      return r;
    }
    if (this.ai === 'undertow') return this.foeUndertow(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'vacuum') return this.foeVacuum(dt, d, dir, perp, wish, r);
    if (this.ai === 'marker') return this.foeMarker(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'zenith') return this.foeZenith(dt, d, dir, perp, wish, pl, r);
    if (this.ai === 'junk') {
      this.foeShellInit();
      if (d > s.want) wish.copy(dir).multiplyScalar(0.8);
      else wish.copy(perp).multiplyScalar(0.3);
      // 吸附附近的可破壞物件補外殼
      s.absT = (s.absT === undefined ? 4 : s.absT) - dt;
      if (s.absT <= 0 && this.shell < this.shellMax * 0.9) {
        s.absT = 6;
        const w = this.game.world;
        const p = (w.props || []).find((q) => !q.dead && q.pos && q.pos.distanceTo(this.pos) < 22);
        if (p) {
          this.game.damageProp(p, p.hp + 1, 0, p.pos.clone());
          this.shell = Math.min(this.shellMax, this.shell + this.shellMax * 0.35);
          this.game.fx.ring(this.center(), 5, 0xc07040);
          this.game.netEv({ t: 'alert', txt: '廢鐵合成體吸附物件補強外殼' });
          if (!this.game.isClient) this.game.flashAlert('廢鐵合成體吸附物件補強外殼');
        }
      }
      this.foeShellFx();
      this.stuckJump(dt, r);
      return r;
    }
    return null;
  },
  // 沙中伏擊者：under（地下：打不到、看不到，快速接近）→ rise（預警沙塵）→ 鑽出攻擊 → up（露出 4 秒）→ 再鑽回去
  foeBurrow(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (!s.bw) {
      s.bw = 'under';
      s.bwT = 2 + Math.random() * 2;
    }
    s.bwT -= dt;
    if (s.bw === 'under') {
      this.bossVis = 1;
      this.noLock = true;
      wish.copy(dir).multiplyScalar(d > 4 ? 1.2 : 0.2);
      if (Math.random() < dt * 8) g.fx.dust(this.pos.clone(), 1.6, 3, 0xc9a06a);
      if ((d < 5 && s.bwT <= 0) || s.bwT < -6) {
        s.bw = 'rise';
        s.bwT = 0.9;
        s.at = pl.pos.clone();
        g.fx.warnCircle(s.at, 4, 0.9);
      }
    } else if (s.bw === 'rise') {
      wish.set(0, 0, 0);
      if (Math.random() < dt * 20) g.fx.dust(s.at.clone(), 3, 6, 0xc9a06a);
      if (s.bwT <= 0) {
        // 從腳下鑽出：預警圈內的目標受傷並被頂起
        this.pos.x = s.at.x;
        this.pos.z = s.at.z;
        this.bossVis = 0;
        this.noLock = false;
        g.fx.dust(this.pos.clone(), 5, 14, 0xc9a06a);
        for (const t of g.hostilesOfEnt(this))
          if (!t.dead && Math.hypot(t.pos.x - s.at.x, t.pos.z - s.at.z) < 4 && t.pos.y - s.at.y < 3) {
            t.takeDamage(520 * this.dmgMul, 1100 * this.dmgMul, this, t.center(), new THREE.Vector3(0, 1, 0));
            t.vel.y = Math.max(t.vel.y, 9);
          }
        s.bw = 'up';
        s.bwT = 4;
      }
    } else if (s.bw === 'up') {
      if (d < 8) wish.copy(dir).negate().multiplyScalar(0.4);
      else wish.copy(perp).multiplyScalar(0.3);
      if (s.bwT <= 0) {
        s.bw = 'under';
        s.bwT = 2.5 + Math.random() * 2;
        g.fx.dust(this.pos.clone(), 3, 10, 0xc9a06a);
      }
    }
    return r;
  },
  // 起重機砲台的開火（aiSpecialFire 轉過來）：每 5～6.5 秒把吊著的貨櫃拋到目標的預判位置，之後重新吊起
  foeFire(dt, d, aimPos, pl) {
    const s = this.aiState;
    if (s.crT === undefined) {
      s.crT = rnd(1.5, 3);
      s.loaded = true;
    }
    s.crT -= dt;
    if (s.crT <= 0 && s.loaded && d < 70 && this.canAct()) {
      const lead = pl.vel.clone().setY(0).multiplyScalar(0.7);
      if (lead.length() > 7) lead.setLength(7);
      this.game.crateShot(this, pl.pos.clone().add(lead), {
        dmg: 700 * this.dmgMul,
        im: 1300 * this.dmgMul,
        R: 4.5,
        T: clamp(1.4 + d / 45, 1.6, 2.6),
      });
      s.crT = rnd(5, 6.5);
      s.loaded = false;
    }
    if (!s.loaded && s.crT < 2.5) s.loaded = true;
    this.bossVis = s.loaded ? 1 : 0;
    return true;
  },
  // 叉架 MT：舉著貨櫃時往前推進，到 20 m 內丟出；7 秒後再舉起一個（沒有貨櫃時保持距離）
  foeForklift(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState;
    if (s.hold === undefined) {
      s.hold = true;
      s.thT = rnd(1.5, 3);
    }
    if (!s.hold && (s.reT -= dt) <= 0) {
      s.hold = true;
      this.game.fx.dust(this.pos.clone(), 2, 6);
    }
    if (s.hold) {
      if (d > 9) wish.copy(dir).multiplyScalar(0.9);
      else wish.copy(perp).multiplyScalar(0.4);
    } else if (d < 22) wish.copy(dir).multiplyScalar(-0.7).addScaledVector(perp, 0.5);
    else wish.copy(perp).multiplyScalar(0.6);
    s.thT -= dt;
    if (s.hold && s.thT <= 0 && d < 20 && d > 3 && this.canAct()) {
      const lead = pl.vel.clone().setY(0).multiplyScalar(0.4);
      if (lead.length() > 4) lead.setLength(4);
      this.game.crateShot(this, pl.pos.clone().add(lead), {
        dmg: 520 * this.dmgMul,
        im: 1000 * this.dmgMul,
        R: 3.5,
        T: 0.9,
        G: 26,
      });
      s.hold = false;
      s.reT = 7;
      s.thT = 3;
    }
    this.bossVis = s.hold ? 1 : 0;
    this.stuckJump(dt, r);
    return r;
  },
  // 閘門砲台：在水壩時站到沒人用的閘門上（下游方向固定）；其他地圖原地朝目標開閘
  // 循環：倒數 → 藍色預警 2 秒（bossVis 1）→ 水流 4.5 秒 → 9～12 秒後再來
  foeGate(dt, d, dir, wish, pl, r) {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (!s.gInit) {
      s.gInit = true;
      s.gT = rnd(3, 6);
      const D = w.dam;
      if (D && D.gates && D.gates.length) {
        w.gateUsed = w.gateUsed || new Set();
        const free = D.gates.filter((q) => !w.gateUsed.has(q) && Math.abs(q.x) < w.lim);
        if (free.length) {
          const q = free.reduce((a, b) => (Math.abs(a.x - this.pos.x) < Math.abs(b.x - this.pos.x) ? a : b));
          w.gateUsed.add(q);
          s.gate = q;
          this.pos.set(q.x, w.groundAt(q.x, D.zc, 40), D.zc);
          this.vel.set(0, 0, 0);
        }
      }
    }
    s.gT -= dt;
    if (!s.warn && s.gT <= 0 && d < 95 && this.canAct()) {
      let fl;
      if (s.gate) {
        const D = w.dam,
          dn = -D.up;
        fl = { x: s.gate.x, z: D.zc + dn * 5.5, dx: 0, dz: dn, hw: s.gate.gw / 2 - 0.5, len: 48 * w.k };
      } else {
        const to = pl.pos.clone().sub(this.pos).setY(0).normalize();
        fl = { x: this.pos.x, z: this.pos.z, dx: to.x, dz: to.z, hw: 5, len: 42 };
      }
      s.warn = fl;
      s.gT = 2;
      const c = new THREE.Vector3(fl.x + (fl.dx * fl.len) / 2, 0, fl.z + (fl.dz * fl.len) / 2);
      c.y = w.terrainHeight(c.x, c.z);
      g.fx.warnRect(c, Math.atan2(fl.dx, fl.dz), fl.hw * 2, fl.len, 2, 0x40a0ff);
      SFX.play('ui2', 0.7, 0.6, 0.05, 0.05, this.center());
    } else if (s.warn && s.gT <= 0) {
      g.addFlow({ ...s.warn, t: 4.5, dps: 110 * this.dmgMul, team: this.team, src: this });
      SFX.play('door', 1, 0.6, 0.05, 0.05, this.center());
      s.warn = null;
      s.gT = rnd(9, 12);
    }
    this.bossVis = s.warn ? 1 : 0;
    return r;
  },
  // 潛航砲艇：under（潛航：打不到、看不到，只在水裡移動，保持 16～26 m）→ up（浮出 5 秒，發射 3 枚魚雷）→ 再潛下去
  foeGunboat(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game,
      w = g.world;
    if (!s.gb) {
      s.gb = 'under';
      s.gbT = rnd(2, 4);
    }
    s.gbT -= dt;
    const wet = (x, z) => !w.theme.water || w.waterDepth(x, z) > 0.25;
    if (s.gb === 'under') {
      this.bossVis = 1;
      this.noLock = true;
      if (d > 26) wish.copy(dir);
      else if (d < 16) wish.copy(dir).negate();
      else wish.copy(perp);
      // 在水裡時只往水裡走（上了岸就照常移動，回到水道為止）
      if (wet(this.pos.x, this.pos.z) && !wet(this.pos.x + wish.x * 3, this.pos.z + wish.z * 3)) {
        const alt = wish.clone().set(-wish.z, 0, wish.x);
        if (!wet(this.pos.x + alt.x * 3, this.pos.z + alt.z * 3)) alt.negate();
        wish.copy(wet(this.pos.x + alt.x * 3, this.pos.z + alt.z * 3) ? alt : alt.set(0, 0, 0));
      }
      if (Math.random() < dt * 6) g.fx.dust(this.pos.clone(), 1.2, 2, 0x9fb8a8);
      if ((s.gbT <= 0 && d < 40 && wet(this.pos.x, this.pos.z)) || s.gbT < -6) {
        s.gb = 'up';
        s.gbT = 5;
        s.shots = 3;
        s.shT = 0.8;
        this.bossVis = 0;
        this.noLock = false;
        g.fx.dust(this.pos.clone(), 3, 10, 0xb8dcf0);
      }
    } else {
      wish.copy(perp).multiplyScalar(0.3);
      s.shT -= dt;
      if (s.shots > 0 && s.shT <= 0 && this.canAct()) {
        s.shots--;
        s.shT = 0.45;
        g.torpedoShot(this, pl, { dmg: 420 * this.dmgMul, im: 700 * this.dmgMul, R: 3.5 });
      }
      if (s.gbT <= 0) {
        s.gb = 'under';
        s.gbT = rnd(3, 5);
        g.fx.dust(this.pos.clone(), 3, 10, 0xb8dcf0);
      }
    }
    return r;
  },
  // 汙染噴射 MT：保持 9～16 m，每 4～5.5 秒往目標噴汙染液，1 秒後落地成腐蝕區（10 秒）
  foeSprayer(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (d > 16) wish.copy(dir).multiplyScalar(0.8);
    else if (d < 9) wish.copy(dir).multiplyScalar(-0.6);
    else wish.copy(perp).multiplyScalar(0.5);
    s.spT = (s.spT === undefined ? rnd(2, 3) : s.spT) - dt;
    if (s.spT <= 0 && d < 26 && this.canAct()) {
      s.spT = rnd(4, 5.5);
      const lead = pl.vel.clone().setY(0).multiplyScalar(0.4);
      if (lead.length() > 4) lead.setLength(4);
      const at = pl.pos.clone().add(lead);
      at.y = g.world.groundAt(at.x, at.z, at.y + 1.5);
      const mz = this.muzzle('rarm');
      g.fx.streaks(mz, 12, 0x9aff40, 18, 0.5, 14, at.clone().sub(mz).normalize(), 0.35);
      g.fx.warnCircle(at, 4.5, 1, 0x9aff40);
      g.netEv({ t: 'warn', p: at.toArray().map((x) => +x.toFixed(2)), R: 4.5, dl: 1, c: 0x9aff40 });
      g.later(1, () => g.addPool(this, at, 4.5, 10, 50 * this.dmgMul, true));
    }
    this.stuckJump(dt, r);
    return r;
  },
  // MARSH：在水裡、離目標 14 m 以上時潛行（隱藏、不能鎖定），靠近後從水裡 QB 突襲；近身時橫移
  foeMarsh(dt, d, dir, perp, wish, r) {
    const s = this.aiState,
      w = this.game.world;
    const wet =
      this.pos.y - w.terrainHeight(this.pos.x, this.pos.z) < 0.8 &&
      w.waterDepth(this.pos.x, this.pos.z) > 0.3;
    const sub = wet && d > 14;
    this.bossVis = sub ? 2 : 0;
    if (d > s.want + 4) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
    else wish.copy(perp);
    if (sub && d < 26 && Math.random() < dt * 1.5) {
      r.qb = true;
      wish.copy(dir);
    } else if (!sub && Math.random() < dt * 0.8) r.qb = true;
    if (sub && Math.random() < dt * 5) this.game.fx.dust(this.pos.clone(), 1.4, 2, 0x9fb8a8);
    this.stuckJump(dt, r);
    return r;
  },
  // 雪中潛伏 MT：hide（埋在雪裡：隱藏、不能鎖定，慢慢爬近，冒出熱源的白煙）→ 16 m 內或被打中時現身；
  // 現身 10 秒後目標在 32 m 外就再埋回去
  foeLurker(dt, d, dir, perp, wish, r) {
    const s = this.aiState,
      g = this.game;
    if (!s.lk) s.lk = 'hide';
    if (s.lk === 'hide') {
      this.bossVis = 1;
      this.noLock = true;
      if (d > 20) wish.copy(dir).multiplyScalar(0.35);
      if (Math.random() < dt * 2) g.fx.dust(this.pos.clone().setY(this.pos.y + 0.5), 0.8, 2, 0xffffff);
      if (d < 16 || s.hit) this.foeLurkerRise();
    } else {
      s.upT = (s.upT || 0) + dt;
      if (d > s.want + 4) wish.copy(dir);
      else wish.copy(perp).multiplyScalar(0.6);
      if (s.upT > 10 && d > 32) {
        s.lk = 'hide';
        s.hit = false;
        g.fx.dust(this.pos.clone(), 3, 10, 0xf0f4f8);
      }
    }
    this.stuckJump(dt, r);
    return r;
  },
  foeLurkerRise() {
    const s = this.aiState;
    s.lk = 'up';
    s.upT = 0;
    this.bossVis = 0;
    this.noLock = false;
    this.game.fx.dust(this.pos.clone(), 4, 14, 0xf0f4f8);
  },
  // 冰面滑行砲車：在 24 m 左右繞著目標高速滑行（冰面上 ×1.4），機砲照常開火
  foeSkater(dt, d, dir, perp, wish, r) {
    const s = this.aiState,
      w = this.game.world;
    if (s.sp0 === undefined) s.sp0 = this.speedMul;
    const ice = w.onIce(this.pos.x, this.pos.z);
    this.speedMul = s.sp0 * (ice ? 1.4 : 1);
    // 繞圈的方向固定（一般 AI 的橫移會定時換邊），卡住時才反向
    if (!s.skDir) s.skDir = Math.random() < 0.5 ? 1 : -1;
    if (s.stuck > 0.4) {
      s.skDir *= -1;
      s.stuck = 0;
    }
    wish
      .set(-dir.z * s.skDir, 0, dir.x * s.skDir)
      .addScaledVector(dir, clamp((d - s.want) / 8, -1, 1))
      .normalize();
    if (this.model.fan) this.model.fan.rotation.z += dt * 25;
    if (ice && Math.random() < dt * 8) this.game.fx.dust(this.pos.clone(), 1, 2, 0xe8f0f8);
    return r;
  },
  // WHITEOUT：保持 55 m 狙擊；開火後 2.5 秒內與 14 m 內看得到，其他時候隱藏（不能鎖定）
  foeWhiteout(dt, d, dir, perp, wish, r) {
    const s = this.aiState;
    if (d < s.want - 8) {
      wish.copy(dir).negate();
      if (Math.random() < dt * 2) r.qb = true;
    } else if (d > s.want + 10) wish.copy(dir);
    else wish.copy(perp).multiplyScalar(0.6);
    wish.normalize();
    if (s.stuck > 0.4) {
      s.strafe *= -1;
      s.stuck = 0;
      s.jumpT = 0.5;
    }
    s.jumpT = (s.jumpT || 0) - dt;
    if (s.jumpT > 0) r.hover = 2;
    s.seenT = Math.max(0, (s.seenT || 0) - dt);
    if (this.recoil.r + this.recoil.l > 0.05) s.seenT = 2.5;
    const hidden = s.seenT <= 0 && d > 14;
    this.bossVis = hidden ? 2 : 0;
    if (hidden && Math.random() < dt * 3) this.game.fx.dust(this.pos.clone(), 1.5, 3, 0xf4f8fc);
    return r;
  },
  // 實驗體：撲向目標，貼身啃咬；每 1.5 秒檢查附近的同類，三隻以上聚在 7 m 內時由編號最小的一隻融合成大型個體
  foeBlob(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    const big = this.opts.vehKey === 'chimera';
    if (d > 1.5 + this.radius) wish.copy(dir);
    else wish.copy(perp).multiplyScalar(0.3);
    if (!big && d > 10 && Math.random() < dt * 0.8) r.qb = true;
    s.biteT = (s.biteT === undefined ? 0.8 : s.biteT) - dt;
    if (d < 1.6 + this.radius + pl.radius && s.biteT <= 0 && this.canAct()) {
      s.biteT = big ? 1.4 : 1;
      const at = pl.center();
      pl.takeDamage(
        (big ? 480 : 160) * this.dmgMul,
        (big ? 1400 : 380) * this.dmgMul,
        this,
        at,
        dir.clone(),
        big ? BITE_BIG : BITE,
      );
      g.fx.meleeHit(at, 0xff3a30, big, dir.clone());
    }
    if (!big) {
      s.mergeT = (s.mergeT === undefined ? 1.5 : s.mergeT) - dt;
      if (s.mergeT <= 0) {
        s.mergeT = 1.5;
        const near = this.friendsOf().filter(
          (f) => !f.dead && f.ai === 'blob' && f.opts.vehKey !== 'chimera' && f.pos.distanceTo(this.pos) < 7,
        );
        if (near.length >= 3 && near.every((f) => f.id >= this.id)) this.foeMerge(near);
      }
    }
    this.stuckJump(dt, r);
    return r;
  },
  foeMerge(list) {
    const g = this.game;
    const at = this.pos.clone();
    for (const f of list) {
      g.fx.explosion(f.center(), 1.4, 0xff3a30);
      f.depart();
    }
    const e = g.spawnType('chimera', g.scaleHp || 1, g.scaleDmg || 1, at, 1);
    g.fx.shockwave(at.clone().setY(at.y + 1), 6, 0xff3a30, 0.5);
    g.alertAll(`實驗體 ×${list.length} 融合成大型個體`);
    return e;
  },
  // 保全雷射網：柱子慢慢轉，雷射柵欄（往前 16 m、高 3.6 m 以下）碰到的敵人受傷；有人碰到時發出警報叫增援（15 秒一次）
  foeLaserPost(dt, wish, r) {
    const s = this.aiState,
      g = this.game;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (s.ang === undefined) {
      s.ang = Math.random() * Math.PI * 2;
      s.alarmT = 0;
      s.tick = 0;
    }
    s.ang += dt * 0.45;
    this.aimYaw = s.ang;
    s.alarmT -= dt;
    s.tick -= dt;
    if (s.tick > 0 || !this.canAct()) return r;
    s.tick = 0.2;
    const fx = -Math.sin(this.yaw),
      fz = -Math.cos(this.yaw);
    for (const t of g.hostilesOfEnt(this)) {
      if (t.dead || t.noLock) continue;
      const rx = t.pos.x - this.pos.x,
        rz = t.pos.z - this.pos.z;
      const u = rx * fx + rz * fz,
        v = Math.abs(-rx * fz + rz * fx);
      if (u < 0.5 || u > 16.5 || v > t.radius + 0.4 || t.pos.y - this.pos.y > 3.6) continue;
      t.takeDamage(90 * 0.2 * this.dmgMul, 120 * this.dmgMul, this, t.center(), null);
      g.fx.spark(t.center(), 0xff3a30);
      if (s.alarmT <= 0) {
        s.alarmT = 15;
        g.alertAll('保全警報：增援接近');
        SFX.play('ui2', 1, 0.5, 0.05, 0.05, this.center());
        for (let i = 0; i < 2; i++) {
          const a = Math.random() * Math.PI * 2;
          const p = this.pos.clone().add(new THREE.Vector3(Math.cos(a) * 8, 0, Math.sin(a) * 8));
          const [x, z] = g.world.collide(p.x, p.z, p.y, 2);
          g.spawnType(
            'mt',
            g.scaleHp || 1,
            g.scaleDmg || 1,
            new THREE.Vector3(x, g.world.groundAt(x, z, p.y + 2), z),
            1,
          );
        }
      }
    }
    return r;
  },
  // SPECIMEN：一般的接近與橫移；每 12 秒過載 5 秒（速度 ×1.5、擴散減小、bossVis 4），之後硬直 3 秒（受傷 ×1.3）
  foeSpecimen(dt, d, dir, perp, wish, r) {
    const s = this.aiState,
      g = this.game;
    if (s.ovT === undefined) {
      s.ovT = 12;
      s.ov = false;
      s.sp0 = this.speedMul;
    }
    s.ovT -= dt;
    if (!s.ov && s.ovT <= 0) {
      s.ov = true;
      s.ovT = 5;
      g.alertAll('SPECIMEN 過載');
      g.fx.shockwave(this.center(), 5, 0xff3a30, 0.4);
    } else if (s.ov && s.ovT <= 0) {
      s.ov = false;
      s.ovT = 12;
      this.staggerT = Math.max(this.staggerT, 3);
      s.tired = 3;
      g.alertAll('SPECIMEN 過載結束 — 硬直');
    }
    s.tired = Math.max(0, (s.tired || 0) - dt);
    this.speedMul = s.sp0 * (s.ov ? 1.5 : 1);
    if (s.ov) this.buffT = 0.3;
    this.bossVis = s.ov ? 4 : 0;
    if (d > s.want + 5) wish.copy(dir).addScaledVector(perp, 0.4).normalize();
    else if (d < s.want - 6) wish.copy(dir).negate().addScaledVector(perp, 0.5).normalize();
    else wish.copy(perp);
    if (Math.random() < dt * (s.ov ? 1.6 : 0.5)) r.qb = true;
    if (s.ov && d > 20 && Math.random() < dt) r.ab = true;
    this.stuckJump(dt, r);
    return r;
  },
  // 構造體爬行機：接近；目標在 4 m 以上的高處、水平 16 m 內時沿柱子／牆面爬上去（垂直上升，不耗能量）
  foeCrawler(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState;
    const up = pl.pos.y - this.pos.y;
    if (d > s.want) wish.copy(dir);
    else wish.copy(perp).multiplyScalar(0.5);
    s.climb = up > 4 && d < 16 && !this.flying ? true : up < 0.5 ? false : s.climb;
    // 頭上有平台時先橫移出來（沿平台邊緣、柱子爬）
    const w = this.game.world;
    if (s.climb && w.groundAt(this.pos.x, this.pos.z, pl.pos.y + 2) > this.pos.y + 3) {
      wish.copy(perp);
    } else if (s.climb) {
      // 貼著邊緣垂直爬，高過目標的高度之後才往內走
      this.vel.y = Math.max(this.vel.y, 9);
      if (this.pos.y < pl.pos.y + 0.5) wish.set(0, 0, 0);
      else wish.copy(dir).multiplyScalar(0.6);
      if (Math.random() < dt * 10) this.game.fx.spark(this.pos.clone().setY(this.pos.y + 0.5), 0xffa040);
    }
    this.stuckJump(dt, r);
    return r;
  },
  // 平台底部砲塔：第一次時吊到附近平台的底面（找不到就待在原地），之後不移動
  foeUnderTurret(wish, r) {
    const s = this.aiState,
      w = this.game.world;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (s.hang === undefined) {
      s.hang = null;
      const decks = w.obstacles.filter(
        (o) => o.kind === 'box' && o.deck && o.y - w.terrainHeight(o.x, o.z) > 5 && w.inZone(o.x, o.z, 3),
      );
      decks.sort(
        (a, b) =>
          Math.hypot(a.x - this.pos.x, a.z - this.pos.z) - Math.hypot(b.x - this.pos.x, b.z - this.pos.z),
      );
      const o = decks[0];
      if (o) {
        const x = o.x + rnd(-o.w * 0.3, o.w * 0.3),
          z = o.z + rnd(-o.d * 0.3, o.d * 0.3);
        s.hang = o.y - 2.1;
        this.pos.set(x, s.hang, z);
        this.vel.set(0, 0, 0);
      }
    }
    if (s.hang !== null) {
      this.flying = true;
      this.hoverH = s.hang - w.terrainHeight(this.pos.x, this.pos.z);
    } else this.flying = false;
    return r;
  },
  // SPIRE：找 50 m 內最高的平台頂爬上去，從高處打；常常 QB 換位置
  foeSpire(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      w = this.game.world;
    s.perT = (s.perT || 0) - dt;
    if (s.perT <= 0) {
      s.perT = rnd(5, 8);
      let best = null;
      for (const o of w.obstacles) {
        if (o.kind !== 'box' || !o.deck) continue;
        const dd = Math.hypot(o.x - this.pos.x, o.z - this.pos.z);
        if (dd > 50 || o.top < pl.pos.y + 3) continue;
        if (!best || o.top > best.top + 1 || (Math.abs(o.top - best.top) < 1 && dd < best.dd))
          best = { ...o, dd };
      }
      s.perch = best;
    }
    const P = s.perch;
    if (P && this.pos.y < P.top - 0.5) {
      const to = new THREE.Vector3(P.x - this.pos.x, 0, P.z - this.pos.z);
      wish.copy(to.normalize());
      if (to.length() < 14 || s.stuck > 0.3) r.hover = 2;
    } else if (d > s.want + 8) wish.copy(dir).addScaledVector(perp, 0.4).normalize();
    else wish.copy(perp);
    if (Math.random() < dt * 0.9) r.qb = true;
    return r;
  },
  // 推進器試車台：慢慢轉向目標；每 7 秒預警 1.5 秒（地上的長方形）→ 噴火 2.5 秒（前方 26 m、寬 8 m）
  foeTestRig(dt, d, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    this.noPush = true;
    wish.set(0, 0, 0);
    if (s.trT === undefined) {
      s.trT = rnd(3, 5);
      s.ph = 0;
    }
    s.trT -= dt;
    const fx = -Math.sin(this.yaw),
      fz = -Math.cos(this.yaw);
    if (s.ph === 0 && s.trT <= 0 && d < 40 && this.canAct()) {
      s.ph = 1;
      s.trT = 1.5;
      s.dir = [fx, fz];
      const c = this.pos.clone().add(new THREE.Vector3(fx * 15, 0, fz * 15));
      c.y = g.world.terrainHeight(c.x, c.z);
      g.fx.warnRect(c, Math.atan2(fx, fz), 8, 26, 1.5, 0xff8a30);
    } else if (s.ph === 1 && s.trT <= 0) {
      s.ph = 2;
      s.trT = 2.5;
      s.tick = 0;
      SFX.play('overload', 0.8, 0.6, 0.05, 0.05, this.center());
    } else if (s.ph === 2) {
      // 噴火中：方向固定在預警時的方向
      const [ax, az] = s.dir;
      s.fxT = (s.fxT || 0) - dt;
      if (s.fxT <= 0) {
        s.fxT = 0.15;
        g.fx.flameCone(this.muzzle('rarm'), new THREE.Vector3(ax, 0, az), 26, 0.16, 8);
      }
      s.tick -= dt;
      if (s.tick <= 0) {
        s.tick = 0.25;
        for (const t of g.hostilesOfEnt(this)) {
          if (t.dead) continue;
          const rx = t.pos.x - this.pos.x,
            rz = t.pos.z - this.pos.z;
          const u = rx * ax + rz * az,
            v = Math.abs(-rx * az + rz * ax);
          if (u < 1 || u > 28 || v > 4 + t.radius || t.pos.y - this.pos.y > 6) continue;
          t.takeDamage(
            140 * 0.25 * this.dmgMul,
            260 * this.dmgMul,
            this,
            t.center(),
            new THREE.Vector3(ax, 0, az),
          );
        }
      }
      if (s.trT <= 0) {
        s.ph = 0;
        s.trT = 7;
      }
    }
    this.bossVis = s.ph;
    return r;
  },
  // 舊式宇宙用 MT：保持距離橫移，常常跳起來長時間滯空（低重力設計）
  foeHopper(dt, d, dir, perp, wish, r) {
    const s = this.aiState;
    if (d > s.want + 6) wish.copy(dir);
    else if (d < s.want - 6) wish.copy(dir).negate();
    else wish.copy(perp);
    s.hopT = (s.hopT === undefined ? rnd(1, 3) : s.hopT) - dt;
    if (s.hopT <= 0) {
      s.hopT = rnd(3, 5);
      s.airT = rnd(1.6, 2.4);
    }
    s.airT = (s.airT || 0) - dt;
    if (s.airT > 0) r.hover = s.airT > 1.2 ? 2 : true;
    this.stuckJump(dt, r);
    return r;
  },
  // 把目標往「外」推的方向：地圖中心往外（洋上都市的街區外是虛空）
  foeOutward(t) {
    const v = new THREE.Vector3(t.pos.x, 0, t.pos.z);
    if (v.lengthSq() < 1) v.set(Math.random() - 0.5, 0, Math.random() - 0.5);
    return v.normalize();
  },
  // 衝撞無人機：繞著目標飛；每 4～5 秒預警線 0.8 秒後高速衝撞（擊中時往外推，之後減速）
  foeRammer(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    this.flying = true;
    if (s.rmT === undefined) {
      s.rmT = rnd(2, 4);
      s.ph = 0;
    }
    s.rmT -= dt;
    if (s.ph === 0) {
      wish
        .copy(perp)
        .addScaledVector(dir, clamp((d - s.want) / 8, -1, 1))
        .normalize();
      if (s.rmT <= 0 && d < 34 && this.canAct()) {
        s.ph = 1;
        s.rmT = 0.8;
        s.at = pl.pos.clone();
        g.fx.warnLine(this.center(), pl.center(), 0.8, 0x60e0ff);
      }
    } else if (s.ph === 1) {
      wish.set(0, 0, 0);
      if (s.rmT <= 0) {
        s.ph = 2;
        s.rmT = 1.2;
        s.dv = s.at.clone().sub(this.pos).setY(0).normalize();
        s.hit = false;
      }
    } else {
      this.vel.x = s.dv.x * 42;
      this.vel.z = s.dv.z * 42;
      wish.copy(s.dv);
      if (!s.hit && d < this.radius + pl.radius + 1.2) {
        s.hit = true;
        pl.takeDamage(260 * this.dmgMul, 900 * this.dmgMul, this, pl.center(), this.foeOutward(pl), RAM_HIT);
        g.fx.meleeHit(pl.center(), 0x60e0ff, true, s.dv.clone());
      }
      if (s.rmT <= 0 || s.hit) {
        s.ph = 0;
        s.rmT = rnd(4, 5);
      }
    }
    return r;
  },
  // 艦載防空砲：目標在空中（離地 3 m 以上）時每 0.35 秒射出空炸彈（高速榴彈），在地面時只用機砲
  foeFlakFire(dt, d, aimPos, pl) {
    const s = this.aiState,
      g = this.game;
    const air = pl.pos.y - g.world.groundAt(pl.pos.x, pl.pos.z, pl.pos.y + 0.5) > 3;
    s.fkT = (s.fkT || 0) - dt;
    if (air && s.fkT <= 0 && d < 80 && this.canAct()) {
      s.fkT = 0.35;
      s.fkN = (s.fkN || 0) + 1; // 射出的空炸彈數
      const mz = this.muzzle('rarm');
      const tgt = pl.center().addScaledVector(pl.vel, d / 70);
      const v = tgt.sub(mz).normalize().multiplyScalar(70);
      g.projectiles.push(
        new Projectile(g, {
          pos: mz.clone(),
          vel: v,
          kind: 'shell',
          dmg: 120 * this.dmgMul,
          impactV: 260 * this.dmgMul,
          team: this.team,
          owner: this,
          color: 0x60e0ff,
          life: d / 70 + 0.15,
          splash: 3.2,
        }),
      );
      g.fx.muzzle(mz, v.clone().normalize(), 0x60e0ff, 1.6);
      return true;
    }
    return air; // 空中的目標只用空炸彈；地面的照常用機砲
  },
  // UNDERTOW：一般的接近；貼身（6 m 內）每 3 秒一次推擊，大幅往外推
  foeUndertow(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    if (d > s.want + 2) wish.copy(dir).addScaledVector(perp, 0.3).normalize();
    else wish.copy(perp);
    if (d > 14 && Math.random() < dt * 1.2) r.qb = true;
    s.shT = (s.shT === undefined ? 2 : s.shT) - dt;
    if (d < 6 && s.shT <= 0 && this.canAct()) {
      s.shT = 3;
      pl.takeDamage(320 * this.dmgMul, 1100 * this.dmgMul, this, pl.center(), this.foeOutward(pl), SHOVE_HIT);
      g.fx.shockwave(pl.center(), 4, 0x40c0e0, 0.3);
      g.fx.meleeHit(pl.center(), 0x40c0e0, true, dir.clone());
    }
    this.stuckJump(dt, r);
    return r;
  },
  // 真空作業機：在目標周圍懸浮繞行，每 2 秒換一個高度（4～12 m）
  foeVacuum(dt, d, dir, perp, wish, r) {
    const s = this.aiState;
    this.flying = true;
    s.hT = (s.hT || 0) - dt;
    if (s.hT <= 0) {
      s.hT = rnd(1.5, 2.5);
      this.hoverH = rnd(4, 12);
    }
    wish
      .copy(perp)
      .addScaledVector(dir, clamp((d - s.want) / 8, -1, 1))
      .normalize();
    return r;
  },
  // 軌道標定衛星：高空保持距離；每 6 秒用光束標定目標 5 秒（被標定的受傷 ×1.3，game/support.js 的 markT）
  foeMarker(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      g = this.game;
    this.flying = true;
    wish.copy(perp).multiplyScalar(0.6);
    if (d < s.want - 6) wish.addScaledVector(dir, -0.6);
    else if (d > s.want + 10) wish.addScaledVector(dir, 0.6);
    s.mkT = (s.mkT === undefined ? rnd(2, 3) : s.mkT) - dt;
    if (s.mkT <= 0 && d < 70 && this.canAct()) {
      s.mkT = 6;
      pl.markT = 5;
      g.fx.beam(this.muzzle('rarm'), pl.center(), 0xff5050, 0.12);
      g.fx.ring(pl.center(), 3, 0xff5050);
      if (pl.isPlayer || pl.slot !== undefined) g.alertAll('被軌道衛星標定 — 受到的傷害增加');
    }
    return r;
  },
  // ZENITH：幾乎不落地——離地 10 m 以下就爬升，空中橫移與 QB，偶爾俯衝接近
  foeZenith(dt, d, dir, perp, wish, pl, r) {
    const s = this.aiState,
      w = this.game.world;
    const alt = this.pos.y - w.groundRef(this.pos.x, this.pos.z, this.pos.y);
    if (d > s.want + 8) wish.copy(dir).addScaledVector(perp, 0.5).normalize();
    else if (d < s.want - 8) wish.copy(dir).negate().addScaledVector(perp, 0.5).normalize();
    else wish.copy(perp);
    r.hover = alt < 10 ? 2 : true;
    if (Math.random() < dt * 1.2) r.qb = true;
    if (d > 45 && Math.random() < dt * 0.6) r.ab = true;
    return r;
  },
  // 地下時打不到；房主與客機都呼叫（specialFx）：依 bossVis 隱藏、外殼大小
  foeFx() {
    if (HIDE_AI.has(this.ai)) {
      // 沙下／水下／雪裡（MARSH 的潛行、WHITEOUT 的隱形是 bossVis 2）
      const under = !!(this.bossVis & (this.ai === 'marsh' || this.ai === 'whiteout' ? 2 : 1)) && !this.dead;
      this.mesh.visible = !under;
      this.noLock = under;
    }
    if (this.ai === 'junk') this.foeShellFx();
    if (this.model.dish) this.model.dish.rotation.y += 0.08; // 沙暴干擾機的天線
    if (this.model.bar) this.model.bar.visible = !this.dead && Math.sin(this.t * 30) > -0.7; // 雷射柵欄（閃爍）
    if (this.ai === 'specimen' && this.bossVis & 4 && Math.random() < 0.3)
      this.game.fx.spark(this.center().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))), 0xff3a30);
    if (this.model.wheel && this.bossVis & 1) this.model.wheel.rotation.x += 0.15; // 閘門砲台開閘前轉動捲揚輪
    if (this.model.crate) this.model.crate.visible = !!(this.bossVis & 1) && !this.dead; // 吊著／舉著的貨櫃
  },
  foeShellInit() {
    if (this.shell !== undefined) return;
    this.shellMax = this.maxHp * 0.8;
    this.shell = this.shellMax;
  },
  // 外殼的大小（房主與客機都呼叫；客機的外殼比例來自快照）
  foeShellFx() {
    const sh = this.model.shell;
    if (!sh) return;
    // 房主依外殼量（同步給客機的 bossVis＝0～15），客機依 bossVis
    if (!this.remote && this.shellMax)
      this.bossVis = Math.round(clamp(this.shell / this.shellMax, 0, 1) * 15);
    const k = this.remote
      ? (this.bossVis || 0) / 15
      : this.shellMax
        ? clamp(this.shell / this.shellMax, 0, 1)
        : 1;
    sh.visible = k > 0.02;
    sh.scale.setScalar(0.5 + 0.5 * k);
  },
  // specialDefense 先呼叫：外殼還在時吸收大部分傷害
  foeDefense(dmg, impact, from, at, melee) {
    if ((this.ai === 'burrow' || this.ai === 'gunboat') && this.bossVis & 1) return [0, 0]; // 在沙下／潛航中
    if (this.ai === 'forklift') return this.foeCrateGuard(dmg, impact, from, at, melee);
    if (this.ai === 'lurker' && this.aiState.lk === 'hide') this.aiState.hit = true; // 被打中就現身
    if (this.ai === 'specimen' && this.aiState.tired > 0) return [dmg * 1.3, impact * 1.3]; // 過載後的硬直
    if (this.ai !== 'junk') return [dmg, impact];
    this.foeShellInit();
    if (!(this.shell > 0)) return [dmg, impact];
    this.shell -= dmg * SHELL_K;
    if (this.shell <= 0) {
      this.shell = 0;
      this.game.flashAlert('廢鐵合成體的外殼剝落');
      this.game.netEv({ t: 'alert', txt: '廢鐵合成體的外殼剝落' });
      this.game.fx.explosion(this.center(), 3, 0xc07040);
    }
    return [dmg * (1 - SHELL_K), impact * 0.5];
  },
  // 叉架 MT 舉著的貨櫃：正面（約 ±65°）的傷害 15%；近戰打掉貨櫃（全額、衝擊 ×1.5，6 秒後才再舉起）
  foeCrateGuard(dmg, impact, from, at, melee) {
    const s = this.aiState;
    if (!s.hold || this.staggerT > 0) return [dmg, impact];
    const src = from && from.pos && from !== this ? from.pos : at;
    if (!src) return [dmg, impact];
    const to = src.clone().sub(this.pos).setY(0);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    if (to.lengthSq() < 0.01 || to.normalize().dot(fwd) < 0.42) return [dmg, impact];
    const p = at || this.center();
    if (melee) {
      s.hold = false;
      s.reT = 6;
      this.bossVis = 0;
      this.game.fx.flash(p, 1.6, 0xffb020, 0.18);
      this.game.popDamage(p, 'GUARD BREAK', false, true, false, 0);
      return [dmg, impact * 1.5];
    }
    this.game.fx.spark(p, 0xffd080);
    return [dmg * 0.15, impact * 0.4];
  },
});
