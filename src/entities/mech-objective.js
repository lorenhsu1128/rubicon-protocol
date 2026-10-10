// ---------- MechEntity 擴充：主線區段的目標物 ----------
// objective：不動、不開火的目標（摧毀目標＝敵方設施；防衛目標＝友方據點），可被鎖定與攻擊
// convoy：護送的友方車輛，沿 opts.path（世界座標的路徑點）慢慢前進，抵達終點後停下（arrived）
// 行為只在房主／單機執行（主線目前只有單人）。
import { MechEntity } from './mech-entity.js';

Object.assign(MechEntity.prototype, {
  // updateAI 一開始呼叫：回傳 true 表示已處理（不走一般 AI）
  objectiveAI(dt) {
    if (this.ai === 'objective') {
      this.vel.set(0, 0, 0);
      return true;
    }
    if (this.ai !== 'convoy') return false;
    const path = this.opts.path || [];
    let i = this.pathI || 0;
    while (i < path.length && Math.hypot(path[i].x - this.pos.x, path[i].z - this.pos.z) < 3) i++;
    this.pathI = i;
    const wish = new THREE.Vector3();
    if (i < path.length) {
      wish
        .set(path[i].x - this.pos.x, 0, path[i].z - this.pos.z)
        .normalize()
        .multiplyScalar(this.opts.convoySpeed || 0.35);
      this.yaw = this.aimYaw = Math.atan2(-wish.x, -wish.z);
    } else this.arrived = true;
    // 前面的車停下時跟著停（保持間距）
    if (this.opts.leader && !this.opts.leader.dead && !this.opts.leader.arrived) {
      const l = this.opts.leader;
      if (Math.hypot(l.pos.x - this.pos.x, l.pos.z - this.pos.z) < 9) wish.multiplyScalar(0.2);
    }
    this.move(dt, wish, false, false, false, null);
    return true;
  },
});
