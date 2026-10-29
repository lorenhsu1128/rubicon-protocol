// MechEntity 擴充：遠程射擊改版第 3 期「蓄力射擊」（docs/ranged-design.md、data/charge.js）。
// pwInput（每格的開火輸入：單機 player.js、房主替客機 mp-host.js）處理按住蓄力與機槍的收尾，
// pwShot（fire 開火時）決定這一發是不是強力彈，pwGain（投射物打中時）累積充能，pwTick（move）送出連發。
// 判定只在房主／單機；客機收到 fb 事件 'pwr'（充能完成）只顯示。
import * as THREE from 'three';
import { SFX } from '../audio/audio.js';
import { PW, PW_FX, PW_HITS, PW_KIND } from '../data/charge.js';
import { MechEntity } from './mech-entity.js';

Object.assign(MechEntity.prototype, {
  pwKind(d) {
    return (d && PW_KIND[d.id]) || null;
  },
  // 開火輸入：回傳 true＝這一格由蓄力處理，不走一般的開火
  pwInput(slot, held, dt, aimPos, aimEnt) {
    const w = this.weapons[slot];
    const k = w && this.pwKind(w.def);
    if (!k || !this.pilotEnt()) return false;
    if (k === 'fin') {
      // 機槍類：持續射擊 MG_HOLD 秒以上放開＝收尾連射（兩種方式相同）
      if (held) w.pwHeld = true;
      else if (w.pwHeld) {
        w.pwHeld = false;
        if ((w.streak || 0) >= PW.MG_HOLD && this.t - (w.lastShot || -9) < PW.MG_GAP)
          this.pwQueue(slot, k, aimEnt, aimPos);
      }
      return false;
    }
    if (this.pwMode !== 'hold') return false;
    if (held) {
      if (w.pwH === undefined) {
        w.pwH = 0;
        this.fire(slot, aimPos, aimEnt); // 按下立刻開一槍
      }
      w.pwH += dt;
      if (w.pwH > PW.HOLD_T && w.reloadT <= 0) {
        const was = w.pwCh || 0;
        w.pwCh = Math.min(PW.CH_T, was + dt);
        if (was === 0 && this.isPlayer) SFX.charge(null);
        if (was < PW.CH_T && w.pwCh >= PW.CH_T) this.pwReadyFx(slot);
      }
    } else if (w.pwH !== undefined) {
      if ((w.pwCh || 0) >= PW.CH_T) {
        w.pwForce = true;
        w.cd = 0;
        this.fire(slot, aimPos, aimEnt);
      }
      w.pwH = undefined;
      w.pwCh = 0;
    }
    return true;
  },
  // fire 開火時：這一發的強力彈效果（沒有時 null）；用掉充能
  pwShot(slot, w, d) {
    const k = this.pwKind(d);
    if (!k) return null;
    if (this.pwFollow && this.pwFollow.slot === slot) return PW_FX[this.pwFollow.k]; // 連發的後續
    if (k === 'fin') return null;
    if (!w.pwForce && !w.pwReady) return null;
    w.pwForce = false;
    w.pwReady = false;
    w.pwc = 0;
    w.pwHits = 0;
    const fx = PW_FX[k];
    if (fx.n) this.pwQueue(slot, k, this.pwLast && this.pwLast.e, this.pwLast && this.pwLast.p);
    return fx;
  },
  // 連發：第一發之後再排 n 發（三連發、收尾連射）
  pwQueue(slot, k, e, p) {
    const fx = PW_FX[k];
    this.pwQ = { slot, k, n: fx.n, t: fx.dt, e: e || null, p: p ? p.clone() : null };
  },
  pwTick(dt) {
    const q = this.pwQ;
    if (!q) return;
    q.t -= dt;
    if (q.t > 0) return;
    const w = this.weapons[q.slot];
    const tgt = q.e && !q.e.dead ? q.e : null;
    const p = tgt ? tgt.center() : q.p;
    if (!w || !p || q.n <= 0 || w.reloadT > 0 || !this.canAct()) {
      this.pwQ = null;
      return;
    }
    w.cd = 0;
    this.pwFollow = q;
    const ok = this.fire(q.slot, p, tgt);
    this.pwFollow = null;
    q.n--;
    q.t = PW_FX[q.k].dt;
    if (!ok || q.n <= 0) this.pwQ = null;
  },
  // 連射累積充能：打中時（一次射擊只算一次）
  pwGain(slot, grp) {
    if (this.pwMode === 'hold') return;
    const w = this.weapons[slot];
    const n = w && PW_HITS[w.def.id];
    if (!n || w.pwReady || w.pwGrp === grp) return;
    w.pwGrp = grp;
    w.pwHits = (w.pwHits || 0) + 1; // 用次數算（1/n 加 n 次會差一點點到不了 1）
    w.pwc = Math.min(1, w.pwHits / n);
    if (w.pwHits >= n) {
      w.pwReady = true;
      this.pwReadyFx(slot);
    }
  },
  // 充能完成的提示（只給本人）
  pwReadyFx(slot) {
    const g = this.game;
    if (this.isPlayer) g.pwReadyLocal(this, slot);
    else if (this.slot !== undefined && g.net && g.net.role === 'host')
      g.netEv({ t: 'fb', s: this.slot, k: 'pwr', w: slot });
  },
  // 強力彈的開火演出（第一發）
  pwFireFx(k, muzzle, dir) {
    const g = this.game;
    g.fx.flash(muzzle, 2.2, 0x9fe8ff, 0.14);
    g.fx.shockwave(muzzle.clone().addScaledVector(dir, 1.5 * this.dk), 2.2, 0x9fe8ff, 0.25);
    SFX.play('boom2', 0.45, 1.6, 0.05, 0.05, this.isPlayer ? null : muzzle);
    if (this.isPlayer) {
      g.camShake = Math.max(g.camShake, 0.12);
      g.rumble(0.8, 0.6, 160);
    }
  },
  // 強力彈打中：名稱（0.6 秒內不重複）
  pwHitPop(target, k) {
    if (!target || !target.center || this.t - (this.pwPopT || -9) < 0.6) return;
    this.syAdd('pw:' + k, 25, PW_FX[k].name); // 風格評價（mech-style.js）
    if (this.game.tut) this.tutE('pw', { k, tgt: target }); // 遠程訓練
    this.pwPopT = this.t;
    this.game.popDamage(
      target.center().add(new THREE.Vector3(0, 3.2 * this.dk, 0)),
      PW_FX[k].name,
      false,
      true,
      false,
      0,
      target.id,
    );
  },
});
