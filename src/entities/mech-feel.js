// MechEntity 擴充：遠程射擊改版第 5 期「手感與回饋」（docs/ranged-design.md、data/feel.js）。
// feelHit（投射物、雷射打中時，攻擊者是玩家操作的機體）：依武器的受擊反應（霰彈推退、火箭筒與榴彈把小型敵人打飛、
// 機槍讓目標持續抖動變慢、重的單發讓目標頓格）＋命中標記與確認音；arInput（每格的開火輸入）：主動裝填。
// 判定只在房主／單機；客機的命中標記與裝填結果由 fb 事件 'hm'／'ar' 給本人。
import * as THREE from 'three';
import { SFX } from '../audio/audio.js';
import { FEEL } from '../data/feel.js';
import { MechEntity } from './mech-entity.js';

const _d = new THREE.Vector3();

Object.assign(MechEntity.prototype, {
  // 被打的一方會不會被推動（一般敵人；Boss、部位、目標物、不動的不算）
  feelMovable() {
    return (
      !this.isBoss &&
      this.ai !== 'part' &&
      this.ai !== 'objective' &&
      !this.noPush &&
      !this.edHold &&
      !this.dead
    );
  },
  // 打中：t＝目標、type＝武器種類（bullet／shotgun／shell／grenade／laser）、dir＝子彈方向或爆炸中心→目標、imp＝衝擊
  feelHit(t, type, dir, imp, o = {}) {
    if (!t || t.isProp || t.isShot || !t.pos || !this.pilotEnt() || t.team === this.team) return;
    const k = this.dk;
    if (t.feelMovable && t.feelMovable() && !this.game.pvp) {
      if (type === 'shotgun' && dir) {
        _d.set(dir.x, 0, dir.z).normalize();
        t.vel.addScaledVector(_d, FEEL.SG_PUSH * k * (o.slug ? 4 : 1));
      } else if ((type === 'shell' || type === 'grenade') && t.radius < FEEL.SMALL_R * t.dk && !t.flying) {
        if (dir) {
          _d.set(dir.x, 0, dir.z).normalize();
          t.vel.addScaledVector(_d, FEEL.LAUNCH_PUSH * k);
        }
        if (!t.stats || t.stats.parts.legs.type !== 'tank') {
          t.vel.y = Math.max(t.vel.y, FEEL.LAUNCH_V * k);
          t.grounded = false;
        }
      } else if (type === 'bullet' && o.mg) t.flinchT = FEEL.MG_FLINCH;
    }
    if (imp >= FEEL.HEAVY_IMP && type !== 'shell' && type !== 'grenade' && t.hitStopLocal)
      t.hitStopLocal(FEEL.HEAVY_STOP);
    // 命中標記與確認音（本人）
    const heavy = imp >= FEEL.HEAVY_IMP;
    const g = this.game;
    if (this.isPlayer) g.hitMarkLocal(type, heavy);
    else if (this.slot !== undefined && g.net && g.net.role === 'host' && this.t - (this.hmT || -9) > 0.08) {
      this.hmT = this.t;
      g.netEv({ t: 'fb', s: this.slot, k: 'hm', y: type, h: heavy ? 1 : 0 });
    }
  },
  // 主動裝填：換彈中按下開火鍵（每次換彈一次機會）
  arInput(slot, held) {
    const w = this.weapons[slot];
    if (!w) return;
    const press = held && !w.arPrev;
    w.arPrev = held;
    if (!press || !(w.reloadT > 0) || this.arOn === false || !this.pilotEnt()) return;
    const R = w.def.reload || 0;
    if (R < FEEL.AR_MIN || w.arTried) return;
    w.arTried = true;
    const p = 1 - w.reloadT / R;
    const ok = p >= FEEL.AR_A && p <= FEEL.AR_B;
    if (ok) {
      w.reloadT = 1e-4; // 下一格裝填完成
      w.arBuff = true;
    } else w.reloadT += FEEL.AR_JAM;
    const g = this.game;
    if (this.isPlayer) g.arFx(slot, ok);
    else if (this.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: this.slot, k: 'ar', w: slot, ok: ok ? 1 : 0 });
    if (ok && !this.isPlayer) SFX.play('uiOk', 0.4, 1.3, 0.02, 0.05, this.center());
  },
});
