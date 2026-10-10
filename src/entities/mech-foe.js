// ---------- MechEntity 擴充：主題專屬敵人（data/foes.js） ----------
// drill 鑽頭採礦機（衝向目標、貼身鑽擊）、junk 廢鐵合成體（外殼吸收傷害、吸附可破壞物件補外殼）；
// 拾荒 MT（opts.foe 'scav'）撿同伴零件強化的處理在 game/mission.js 的 onEnemyKilled（foeScavenge）。
// 行為只在房主／單機執行；外殼量以 sx 同步給客機（顯示外殼大小）。
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { MechEntity } from './mech-entity.js';

const SHELL_K = 0.8; // 外殼吸收的比例
const DRILL_R = 3.6; // 鑽擊距離

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
        pl.takeDamage(420 * this.dmgMul, 1500 * this.dmgMul, this, at, dir.clone(), true);
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
  // 地下時打不到；房主與客機都呼叫（specialFx）：依 bossVis 隱藏、外殼大小
  foeFx() {
    if (this.ai === 'burrow') {
      const under = !!(this.bossVis & 1) && !this.dead;
      this.mesh.visible = !under;
      this.noLock = under;
    }
    if (this.ai === 'junk') this.foeShellFx();
    if (this.model.dish) this.model.dish.rotation.y += 0.08; // 沙暴干擾機的天線
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
  foeDefense(dmg, impact) {
    if (this.ai === 'burrow' && this.bossVis & 1) return [0, 0]; // 在沙下
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
});
