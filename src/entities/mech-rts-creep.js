// Coral 戰爭（RTS）的野怪行為（MechEntity 擴充；docs/rts-design.md 13.6、13.15；D 包）。
// e.creep＝營地 id、e.rtsCamp＝營地紀錄（game/rts-neutral.js 的 R.camps）、e.rtsHome＝自己在營地裡的位置。
// 營地的狀態（camp.st：'idle' 待機、'fight' 出動、'return' 回營、'done' 清除）由 Game.rtsNeutralTick 決定，這裡照著做：
//   待機：站在自己的位置，偶爾轉頭；出動：打營地的目標（或打自己的攻擊者），追擊不超過營地中心 RTS_CREEP.leash；
//   回營：走回自己的位置、不理會攻擊（照樣受傷），RTS_CREEP.healT 秒回滿。不會重生。
// mech-rts.js（B）的 rtsUnitAI 開頭轉過來（if (this.creep) return this.rtsCreepAI(dt)）；生成時另外在實體上掛一份，
// 所以兩邊的順序不影響。移動與開火沿用 mech-rts.js 的 rtsGo／rtsFight／rtsScan。
import { MechEntity } from './mech-entity.js';
import { RTS_DEFS } from '../data/rts-units.js';
import { RTS_CREEP } from '../data/rts-neutral.js';

const ZERO = new THREE.Vector3();
const _aim = new THREE.Vector3();

Object.assign(MechEntity.prototype, {
  rtsCreepAI(dt) {
    const g = this.game,
      R = g.rts;
    if (this.dead || !R) return true;
    const D = RTS_DEFS[this.rtsDef];
    const rt = this.rt;
    const camp = this.rtsCamp;
    rt.wish.set(0, 0, 0);
    rt.face = null;
    rt.fireT -= dt;
    rt.scanT -= dt;
    if (this.staggerT > 0 || R.over || !camp) {
      this.move(dt, ZERO, false, false, false, null);
      return true;
    }
    const home = this.rtsHome || camp.pos;
    const st = camp.st;
    if (st === 'fight') this.rtsCreepFight(dt, D, camp, home);
    else if (st === 'return') {
      rt.engage = null;
      this.rtsGo(home.x, home.z, 1, dt, null);
    } else {
      // 待機：回到自己的位置；站著時偶爾轉頭
      rt.engage = null;
      if (Math.hypot(this.pos.x - home.x, this.pos.z - home.z) > RTS_CREEP.home)
        this.rtsGo(home.x, home.z, 1, dt, null);
      else {
        rt.lookT = (rt.lookT || 0) - dt;
        if (rt.lookT <= 0) {
          rt.lookT = 3 + Math.random() * 5;
          rt.lookA = (home.a || 0) + (Math.random() - 0.5) * 2.4;
        }
        if (rt.lookA !== undefined) {
          _aim.set(
            this.pos.x + Math.cos(rt.lookA) * 10,
            this.pos.y + this.model.height * 0.5,
            this.pos.z + Math.sin(rt.lookA) * 10,
          );
          rt.face = rt.faceV.copy(_aim);
        }
      }
    }
    if (rt.face) this.setAim(rt.face);
    else if (rt.wish.lengthSq() > 0.01) {
      _aim.set(
        this.pos.x + rt.wish.x * 10,
        this.pos.y + this.model.height * 0.5,
        this.pos.z + rt.wish.z * 10,
      );
      this.setAim(_aim);
    }
    this.move(dt, rt.wish, false, false, false, null);
    return true;
  },
  // 出動：目標＝自己的攻擊者（最近 4 秒）＞視野內最近的敵人＞營地共用的目標；目標跑出追擊範圍就放掉
  rtsCreepFight(dt, D, camp, home) {
    const rt = this.rt,
      R = this.game.rts;
    const inLeash = (t) =>
      Math.hypot(t.pos.x - camp.pos.x, t.pos.z - camp.pos.z) < RTS_CREEP.leash + this.rtsRange(D) * 0.6;
    if (rt.engage && (!this.rtsHostileOk(rt.engage) || rt.engage.rtsInv || !inLeash(rt.engage)))
      rt.engage = null;
    if (rt.scanT <= 0) {
      rt.scanT = 0.35;
      let t = null;
      if (rt.hurtBy && R.t - rt.hurtT < 4 && this.rtsHostileOk(rt.hurtBy) && inLeash(rt.hurtBy))
        t = rt.hurtBy;
      if (!t && !rt.engage) {
        const s = this.rtsScan(D.sight, D);
        if (s && !s.rtsInv && inLeash(s)) t = s;
      }
      if (!t && !rt.engage && camp.tgt && this.rtsHostileOk(camp.tgt) && inLeash(camp.tgt)) t = camp.tgt;
      if (t && t !== rt.engage) {
        rt.engage = t;
        rt.tgtHp = t.hp;
      }
    }
    const t = rt.engage;
    if (!t) {
      this.rtsGo(home.x, home.z, 1, dt, null);
      return;
    }
    camp.tgt = t;
    camp.seenT = R.t;
    this.rtsFight(t, dt, D, true);
    // 打到敵人（目標的血量變少）：營地的放棄計時重來
    if (t.hp < (rt.tgtHp === undefined ? t.hp : rt.tgtHp) - 0.01) camp.hitT = R.t;
    rt.tgtHp = t.hp;
  },
});
