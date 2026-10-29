// MechEntity 擴充：遠程射擊改版第 4 期「屬性反應」（docs/ranged-design.md、data/react.js）。
// 被打的一方記下玩家上一次打中的屬性（rxPrev），RX.WIN 秒內換另一個屬性打中就觸發反應：
// 過熱裝甲（rxHotT：受到的傷害變重）、破甲爆裂（額外一次爆炸）、EMP 干擾（rxJamT：不能開火、QB、突擊推進）。
// 判定只在房主／單機（takeDamage 裡），提示文字以 popDamage 轉送；客機的機體移動預測不知道干擾（只在房主擋下）。
import * as THREE from 'three';
import { SFX } from '../audio/audio.js';
import { RX, reactionOf } from '../data/react.js';
import { MechEntity } from './mech-entity.js';

Object.assign(MechEntity.prototype, {
  // takeDamage 呼叫：A＝這一擊的屬性；回傳這一擊額外的傷害倍率（過熱裝甲中）
  rxHit(A, from) {
    let mul = this.rxHotT > 0 ? 1 + (RX.HOT_K - 1) * (this.isBoss ? RX.BOSS : 1) : 1;
    if (this.rxNo || !from || !from.pilotEnt || !from.pilotEnt() || from.team === this.team) return mul;
    if (A !== 'kin' && A !== 'exp' && A !== 'en') return mul;
    const t = this.t,
      P = this.rxPrev;
    if (P && P.a !== A && t - P.t <= RX.WIN && !(this.rxCdT > t)) {
      const r = reactionOf(P.a, A);
      if (r) {
        this.rxPrev = null;
        this.rxCdT = t + RX.CD;
        this.rxFire(r, from);
        if (r.id === 'hot') mul = 1 + (RX.HOT_K - 1) * (this.isBoss ? RX.BOSS : 1);
        return mul;
      }
    }
    this.rxPrev = { a: A, t };
    return mul;
  },
  rxFire(r, from) {
    const g = this.game,
      c = this.center(),
      bk = this.isBoss ? RX.BOSS : 1;
    g.popDamage(c.clone().setY(c.y + 3.6 * this.dk), r.name, false, true, false, 0, this.id);
    g.fx.shockwave(c, 4 * this.dk, parseInt(r.color.slice(1), 16), 0.35);
    if (from.syAdd) from.syAdd('rx:' + r.id, 30, r.name); // 風格評價
    if (g.tut && from.tutE) from.tutE('rx', { id: r.id, tgt: this }); // 遠程訓練
    if (from.isPlayer) SFX.reaction(r.id);
    else if (from.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: from.slot, k: 'rx', r: r.id });
    if (r.id === 'hot') this.rxHotT = RX.HOT_T;
    else if (r.id === 'jam') this.rxJamT = RX.JAM_T * bk;
    else if (r.id === 'burst') g.later(0, () => this.rxBurst(from, bk)); // 下一格（不在 takeDamage 裡再受傷）
  },
  rxBurst(from, bk) {
    const g = this.game,
      c = this.center();
    if (this.dead) return;
    {
      g.fx.explosion(c, 2.4, 0xffd040, true);
      SFX.explode(true, c);
      const dmg = Math.min(this.maxHp * RX.BURST_HP, RX.BURST_MAX) * bk;
      this.rxNo = true;
      this.takeDamage(dmg, RX.BURST_IMP * bk, from, c, null, undefined, undefined, 'exp');
      this.rxNo = false;
      const R = RX.BURST_R * this.dk;
      for (const e of g.hostilesOf(from.team, from))
        if (e !== this && !e.dead && !e.isProp && e.pos && e.pos.distanceTo(this.pos) < R) {
          e.rxNo = true;
          e.takeDamage(dmg * 0.5, RX.BURST_IMP * 0.5, from, c, null, undefined, undefined, 'exp');
          e.rxNo = false;
        }
    }
  },
  rxTick(dt) {
    if (this.rxHotT > 0) this.rxHotT -= dt;
    if (this.rxJamT > 0) this.rxJamT -= dt;
    // 效果中的火花（會轉送給客機的 fx）
    const g = this.game;
    if (!this.remote && Math.random() < dt * 6)
      g.fx.spark(
        this.center().add(
          new THREE.Vector3(
            (Math.random() - 0.5) * this.radius,
            (Math.random() - 0.3) * this.radius,
            (Math.random() - 0.5) * this.radius,
          ),
        ),
        this.rxJamT > 0 ? 0x7fc8ff : 0xff9a40,
      );
  },
});
