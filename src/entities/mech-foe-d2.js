// ---------- MechEntity 擴充：第 3～6 章主題專屬敵人模型的動作（render/foe-models.js 的 anim_d2） ----------
// 房主／單機把行為狀態（aiState、開火）寫進 bossVis 的高位（FB_D2：16 開火、32 預警、64 攻擊），隨快照的 sx 同步；
// 房主與客機都以同一份旗標驅動模型的動作節點與預警發光（mech-special.js 的 specialFx 每格呼叫）。
// 只加旗標、不改行為：低 4 位（lurker 的隱藏、testrig 的 ph…）照原本的行為端設定。
import { FB_D2 } from '../render/foe-models.js';
import { MechEntity } from './mech-entity.js';

const LOW = 15;

Object.assign(MechEntity.prototype, {
  foeAnim_d2(dt) {
    const m = this.model;
    if (!this.remote && !this.dead) this.bossVis = ((this.bossVis || 0) & LOW) | this.foeBits_d2();
    // 速度從位置差推算（客機的 vel 不一定有值）
    const lp = this._lp_d2 || (this._lp_d2 = this.pos.clone());
    const spd = dt > 0 ? Math.hypot(this.pos.x - lp.x, this.pos.z - lp.z) / dt : 0;
    const vy = dt > 0 ? (this.pos.y - lp.y) / dt : 0;
    lp.copy(this.pos);
    const w = this.game && this.game.world;
    const air = w ? this.pos.y - w.groundAt(this.pos.x, this.pos.z, this.pos.y + 0.5) : 0;
    m.anim_d2({
      t: this.t || 0,
      dt,
      vis: this.bossVis || 0,
      spd: Math.min(spd, 60),
      vy,
      air,
      dead: !!this.dead,
      remote: !!this.remote,
    });
  },
  // 房主：行為狀態 → 動作旗標
  foeBits_d2() {
    const s = this.aiState || {};
    let b = this.recoil && this.recoil.r + this.recoil.l > 0.05 ? FB_D2.fire : 0;
    switch (this.ai) {
      case 'lurker':
        if (s.lk === 'up' && s.upT < 1.2) b |= FB_D2.warn; // 剛現身
        break;
      case 'blob': {
        const big = this.opts.vehKey === 'chimera';
        if (s.biteT > (big ? 1.15 : 0.75))
          b |= FB_D2.atk; // 剛咬下
        else if (s.biteT !== undefined && s.biteT < 0.4 && this.foeNear_d2(2.6 + this.radius))
          b |= FB_D2.warn;
        break;
      }
      case 'laserpost':
        if (s.alarmT > 11) b |= FB_D2.warn; // 警報
        break;
      case 'crawler':
        if (s.climb) b |= FB_D2.warn; // 爬牆
        break;
      case 'rammer':
        if (s.ph === 1) b |= FB_D2.warn;
        else if (s.ph === 2) b |= FB_D2.atk;
        break;
      case 'flak':
        if (s.fkN && s.fkT > -0.8) b |= FB_D2.warn; // 正在打空中的目標
        if (s.fkT > 0.2) b |= FB_D2.atk;
        break;
      case 'marker':
        if (s.mkT > 0 && s.mkT < 1.2)
          b |= FB_D2.warn; // 標定前的充能
        else if (s.mkT > 5.5) b |= FB_D2.atk;
        break;
    }
    return b;
  },
  // 附近（r 以內）有沒有敵對的機體
  foeNear_d2(r) {
    const g = this.game;
    if (!g || !g.hostilesOfEnt) return false;
    for (const t of g.hostilesOfEnt(this))
      if (!t.dead && t.pos.distanceTo(this.pos) < r + t.radius) return true;
    return false;
  },
});
