// MechEntity 擴充：遠程射擊改版第 2 期「反擊與弱點」（docs/ranged-design.md、data/weak.js）。
// 一般敵人的方向型弱點（依子彈打進來的方向）、時機型弱點（預警招式的準備期間）、打壞弱點的效果、
// 用 QB 甩掉追蹤的導彈。判定只在房主／單機（takeDamage 裡）；客機由生成紀錄的 wpk、事件 'wpb'、
// 快照的 aw（32＝準備中）顯示。
import * as THREE from 'three';
import { SFX } from '../audio/audio.js';
import { WP, WP_KINDS, WEAK_OF, weakList } from '../data/weak.js';
import { MechEntity } from './mech-entity.js';

const _a = new THREE.Vector3();

Object.assign(MechEntity.prototype, {
  // 這台的弱點種類（房主依 etype；客機用生成紀錄帶來的 wpKeysC）
  wpKeys() {
    if (this.wpKeysC !== undefined) return this.wpKeysC;
    if (this.team !== 'enemy' || this.isBoss || this.ai === 'part' || this.decoy || this.themeFoe)
      return null;
    return weakList(this.etype) || (this.ace ? WEAK_OF.ac : null);
  },
  // 弱點的狀態：[{ k, hp, off }]（第一次用到時建立）
  wpList() {
    if (this.wp !== undefined) return this.wp;
    const K = this.wpKeys();
    this.wp = K ? K.map((k) => ({ k, hp: this.maxHp * WP.BREAK_HP, off: false })) : null;
    return this.wp;
  },
  wpBroken(k) {
    return !!(this.wpOff && this.wpOff[k]);
  },
  // 時機型弱點：預警招式的準備中（房主看 sn.mv，客機看快照的 aw）
  wpOpen() {
    if (this.sn) return !!(this.sn.mv && this.sn.mv.ph === 'wind');
    return !!((this.aw || 0) & 32);
  },
  // 機體的正面與右方（水平）
  wpAxes() {
    const y = this.yaw || 0;
    return {
      f: new THREE.Vector3(-Math.sin(y), 0, -Math.cos(y)),
      r: new THREE.Vector3(Math.cos(y), 0, -Math.sin(y)),
    };
  },
  // 攻擊從哪個方向來（目標 → 攻擊者的單位向量）：有子彈方向時用它的反方向，否則用攻擊者的位置
  wpFrom(from, dir) {
    if (dir && dir.lengthSq() > 1e-6) return _a.copy(dir).normalize().negate();
    if (from && from.center) return _a.copy(from.center()).sub(this.center()).normalize();
    return null;
  },
  // 攻擊方向 a 打得到哪一面
  wpFace(face, a, from) {
    if (!a) return false;
    if (face === 'top') {
      if (a.y > WP.TOP) return true;
      return !!(
        from &&
        from.center &&
        from.center().y - this.center().y > WP.TOP_DY * this.dk &&
        a.y > WP.TOP * 0.6
      );
    }
    const ax = this.wpAxes();
    const h = Math.hypot(a.x, a.z) || 1;
    if (face === 'back') return (a.x * ax.f.x + a.z * ax.f.z) / h < WP.BACK;
    if (face === 'side') return Math.abs(a.x * ax.r.x + a.z * ax.r.z) / h > WP.SIDE;
    return false;
  },
  // 從 from 的位置現在打得到的弱點（HUD 的亮暗）
  wpReach(k, from) {
    const a = from && from.center ? _a.copy(from.center()).sub(this.center()).normalize() : null;
    return this.wpFace(WP_KINDS[k].face, a, from);
  },
  // 弱點在世界座標的位置（HUD 與追尾視角的改瞄）；side 回傳 [左, 右]
  wpPoints(k) {
    const P = WP_KINDS[k].pos,
      ax = this.wpAxes();
    const h = (this.model && this.model.height) || this.radius * 2;
    const base = this.pos.clone().addScaledVector(ax.f, P[0] * this.radius);
    base.y += P[1] * h;
    if (WP_KINDS[k].face !== 'side') return [base];
    return [
      base.clone().addScaledVector(ax.r, -this.radius),
      base.clone().addScaledVector(ax.r, this.radius),
    ];
  },
  // takeDamage 呼叫（玩家操作的機體的遠程攻擊）：回傳 [傷害, 衝擊]
  wpTake(dmg, impact, from, dir) {
    if (this.wpNo) return [dmg, impact];
    const list = this.wpList();
    let hit = null;
    if (list) {
      const aim = this.wpAimK; // 追尾／第一人稱的準星壓在弱點上（game/weak.js，投射物帶來）
      const a = this.wpFrom(from, dir);
      for (const w of list)
        if (!w.off && (w.k === aim || this.wpFace(WP_KINDS[w.k].face, a, from))) {
          hit = w;
          break;
        }
    }
    const open = this.wpOpen();
    if (!hit && !open) return [dmg, impact];
    dmg *= WP.CRIT;
    this.wpGold = true; // 金色的傷害數字（takeDamage 的 popDamage）
    const g = this.game;
    if (this.t - (this.wpPopT || -9) > 0.35) {
      this.wpPopT = this.t;
      g.popDamage(
        this.center().setY(this.pos.y + ((this.model && this.model.height) || 3) + 1.4 * this.dk),
        'CRITICAL',
        false,
        true,
        false,
        0,
        this.id,
      );
    }
    if (from.isPlayer) SFX.crit();
    else if (from.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: from.slot, k: 'crit' });
    if (from.syEvent) from.syEvent('crit'); // 風格評價
    if (hit) {
      hit.hp -= dmg;
      if (hit.hp <= 0) this.wpBreak(hit, from);
    }
    if (open) this.wpInterrupt(impact, from);
    return [dmg, impact];
  },
  // 準備中累積的衝擊夠了：打斷招式並短暫失衡
  wpInterrupt(impact, from) {
    const mv = this.sn && this.sn.mv;
    if (!mv) return;
    mv.brk = (mv.brk || 0) + impact;
    if (mv.brk < this.acsMax * WP.OPEN_BRK || this.staggerT > 0) return;
    const g = this.game;
    this.cueCancel();
    this.sn.mv = null;
    this.sn.mvCd = 2.5;
    this.acs = this.acsMax;
    this.staggerT = WP.OPEN_STAG;
    this.stagBy = from ? { id: from.id, cls: 'interrupt' } : null;
    g.fx.ring(this.center(), 4, 0xffd040);
    g.popDamage(
      this.center().setY(this.center().y + 2 * this.dk),
      'INTERRUPT',
      false,
      true,
      false,
      0,
      this.id,
    );
    SFX.stagger(this.center());
    g.netEv({ t: 'stag', i: this.id });
    if (from && from.syEvent) from.syEvent('interrupt'); // 風格評價
  },
  // 打壞弱點
  wpBreak(w, from) {
    w.off = true;
    this.wpOff = this.wpOff || {};
    this.wpOff[w.k] = true;
    const g = this.game,
      c = this.center();
    g.fx.explosion(this.wpPoints(w.k)[0], 1.4, 0xffb050, false);
    g.popDamage(
      c.clone().setY(c.y + 2.6 * this.dk),
      WP_KINDS[w.k].name + ' 破壞',
      false,
      true,
      false,
      0,
      this.id,
    );
    g.netEv({ t: 'wpb', i: this.id, k: w.k });
    if (from && from.syEvent) from.syEvent('wpBreak', WP_KINDS[w.k].name + ' 破壞'); // 風格評價
    if (w.k === 'thr') this.speedMul *= WP.THR_SPD;
    if (w.k === 'ammo') g.later(0, () => this.wpCookOff(from)); // 殉爆：下一格（不在 takeDamage 裡再受傷）
  },
  // 彈藥箱殉爆：自己受重傷，附近的友軍一起受傷
  wpCookOff(from) {
    if (this.dead) return;
    const g = this.game,
      c = this.center();
    {
      g.fx.explosion(c, 3.2, 0xff8030, true);
      SFX.explode(true, c);
      this.wpNo = true;
      this.takeDamage(this.maxHp * WP.AMMO_SELF, 900, from, c, null, undefined, undefined, 'exp');
      this.wpNo = false;
      const R = WP.AMMO_SPLASH * this.dk;
      for (const e of g.enemies)
        if (e !== this && !e.dead && e.pos.distanceTo(this.pos) < R)
          e.takeDamage(Math.min(e.maxHp * 0.15, 1800), 400, from, c, null, undefined, undefined, 'exp');
    }
  },
  // Boss 的時機型弱點被打中：CRITICAL（傷害倍率由各 Boss 的 bossDefense 決定，這裡只顯示）
  wpBossCrit(from) {
    this.wpGold = true;
    const g = this.game;
    if (this.t - (this.wpPopT || -9) > 0.35) {
      this.wpPopT = this.t;
      this.wpBossT = this.t; // HUD 的「弱點露出」
      g.popDamage(
        this.center().setY(this.center().y + 3 * this.dk),
        'CRITICAL',
        false,
        true,
        false,
        0,
        this.id,
      );
    }
    if (from.isPlayer) SFX.crit();
    else if (from.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: from.slot, k: 'crit' });
  },
  // 敵人的導彈、火箭彈、榴彈：可以打掉（一發就掉），擊落時在原地爆炸
  foeShotOpt(dmg) {
    return { shootable: 1, shotR: 0.9, popDmg: dmg * 0.6 };
  },
  // 追著自己的導彈快打到時（MSL_T 秒內）按了 QB：導彈失去追蹤＋算完美 QB（反擊時間）
  missileDodge(pr) {
    if (!this.pilotEnt() || pr.dodged || (this.game.net && this.game.net.role === 'client')) return;
    if (
      !pr.owner ||
      pr.owner.team === this.team ||
      this.qbStartT === undefined ||
      this.t - this.qbStartT > 0.12
    )
      return;
    const d = pr.pos.distanceTo(this.center());
    if (d / Math.max(1, pr.vel.length()) > WP.MSL_T) return;
    pr.dodged = true;
    pr.target = null;
    this.pqbCheck(pr.owner, true);
  },
  // 客機收到 'wpb'
  wpBreakC(k) {
    this.wpOff = this.wpOff || {};
    this.wpOff[k] = true;
  },
});
