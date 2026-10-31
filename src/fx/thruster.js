// ============================================================
//  推進器噴焰：粒子特效（不是模型）。所有機體共用一個顯示卡粒子系統（fx/gpu.js 的 GpuFx，沿速度拉長、加色），
//  從背包的噴口連接點沿噴口方向（連接點的 −Y 軸）噴出：剛噴出時白熱、隨後轉成噴焰色並變大淡出（docs/vfx-design.md）。
//  遊戲（Effects.thruster）與模型庫檢視窗共用；時間是自己的（update 的 dt 累加，暫停時不更新）。
// ============================================================
import { GpuFx } from './gpu.js';
import { SOFT, LINE } from './atlas.js';

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
// 噴口的世界座標與噴射方向（連接點的 −Y 軸）
// （往上更新一次世界矩陣再分解；fresh＝世界矩陣剛算過，不再更新）
const _s = new THREE.Vector3();
export function nozzleWorld(n, pos, dir, fresh) {
  if (!fresh) n.updateWorldMatrix(true, false);
  nozzleFrom(n.matrixWorld, pos, dir);
}
// 從噴口的世界矩陣算位置與方向
export function nozzleFrom(m, pos, dir) {
  m.decompose(pos, _q, _s);
  dir.copy(DOWN).applyQuaternion(_q).normalize();
}

export class ThrusterFx {
  constructor(scene, max = 3000) {
    this.time = 0;
    // 拉長：長度＝寬×1.2＋速度×0.045（噴流的條紋），上限 3 m
    this.sys = new GpuFx(scene, { mode: 'stretch', spd: 0.045, maxL: 3, order: 6, cap: Math.min(4096, max) });
  }
  // 一顆噴焰：p 位置、v 速度、color 噴焰色、size 直徑（公尺）、life 秒
  emit(p, v, color, size, life) {
    // 柔邊圓點看得到的直徑約是邊長的 0.6；白熱 → 噴焰色、變大、淡出，空氣阻力 3（和原本的 Points 相同）
    this.sys.emit({
      p,
      v,
      life,
      s0: size * 1.0,
      s1: size * 3.6,
      c0: 0xffffff,
      c1: color,
      k: 1.6,
      a: 0.9,
      cell: SOFT,
      fade: 1,
      drag: 3,
      asp: 1.2,
    });
  }
  // QB 的一次噴發：從每個噴口沿噴射方向噴出一團（白熱的條紋＋外圈的噴焰）
  burst(model, color, scale, carry) {
    if (!model || !model.nozzles || !model.nozzles.length) return;
    const pos = new THREE.Vector3(),
      dir = new THREE.Vector3(),
      v = new THREE.Vector3();
    for (const nz of model.nozzles) {
      nozzleWorld(nz, pos, dir, false);
      for (let k = 0; k < 14; k++) {
        const sp = (14 + Math.random() * 16) * scale;
        v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(0.7)
          .add(dir)
          .normalize()
          .multiplyScalar(sp);
        if (carry) v.addScaledVector(carry, 0.3);
        this.sys.emit({
          p: pos,
          v,
          life: 0.12 + Math.random() * 0.14,
          s0: (0.35 + Math.random() * 0.3) * scale,
          s1: (1.2 + Math.random() * 0.6) * scale,
          c0: 0xffffff,
          c1: color,
          k: 1.8,
          cell: k < 5 ? LINE : SOFT,
          fade: 1,
          drag: 5,
          asp: k < 5 ? 0.6 : 1.2,
        });
      }
    }
  }
  // 依推力（0～1）從模型的每個噴口持續噴出；scale 為機體縮放，carry 為機體速度（尾焰會被帶著走一點）
  stream(model, thrust, color, scale, dt, carry) {
    if (!model || !model.nozzles || !model.nozzles.length || thrust <= 0.005) return;
    if (this.cull && model.group && this.cull(model.group.position)) return; // 粒子很多時畫面外的不噴（Effects.skip）
    const rate = (15 + 220 * thrust) * dt;
    model._thrAcc = (model._thrAcc || 0) + rate;
    let n = Math.floor(model._thrAcc);
    model._thrAcc -= n;
    if (!n) return;
    const pos = new THREE.Vector3(),
      dir = new THREE.Vector3(),
      v = new THREE.Vector3();
    const nzs = model.nozzles;
    for (let i = 0; i < nzs.length; i++) {
      nozzleWorld(nzs[i], pos, dir, model.nzFresh);
      for (let k = 0; k < n; k++) {
        const sp = (3 + 8 * thrust) * scale * (0.8 + Math.random() * 0.4);
        v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
          .multiplyScalar(0.35)
          .add(dir)
          .normalize()
          .multiplyScalar(sp);
        if (carry) v.addScaledVector(carry, 0.35);
        // 一幀內分散在噴口附近，避免一團一團
        _v.copy(pos).addScaledVector(dir, Math.random() * sp * dt);
        this.emit(
          _v,
          v,
          color,
          (0.4 + 0.6 * thrust) * scale * (0.8 + Math.random() * 0.4),
          0.1 + 0.14 * thrust,
        );
      }
    }
  }
  update(dt) {
    this.time += dt;
    if (this.time > 2000) {
      this.sys.rebase(1900);
      this.time -= 1900;
    }
    this.sys.update(this.time, dt);
  }
  clear() {
    this.sys.clear();
    this.time = 0;
  }
}
