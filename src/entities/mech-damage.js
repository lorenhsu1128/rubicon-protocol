// ============================================================
//  分階段受損的姿勢（docs/crew-civilians-design.md 第 1 期）：所有敵人在 AP ≤ 25%（第 3 階段）起
//  依機型擺出受損的姿勢，≤ 10% 加大並且一直抖；外觀（煙、火、焦黑、碎板）在 render/foe-damage.js。
//  做法和受擊反應相同：dmgRestore 在動作與 IK 還原之前扣掉上一格的偏移，dmgApply 在模型自己的動作與 IK 之後套用。
//  房主與客機各自依 AP 演出，只改外觀。
// ============================================================
import { MechEntity } from './mech-entity.js';
import { dmgStage } from '../render/foe-damage.js';

// 機型 → 受損姿勢的種類
function dmgKind(e) {
  const m = e.model;
  if (m.legsG && m.torso && !m.vehicle) return 'mech'; // 人形（四足、戰車腳也走這裡：前臂垂）
  const b = m.hrBody || m.cls;
  if (b === 'heli' || b === 'drone' || b === 'fly' || b === 'hang') return 'fly';
  if (b === 'fixed' || e.ai === 'turret' || e.ai === 'part') return 'fixed';
  if (b === 'boat') return 'boat';
  if (b === 'soft') return null;
  return 'ground';
}

Object.assign(MechEntity.prototype, {
  dmgRestore() {
    const m = this.model,
      o = m && m.dmgOff;
    if (!o) return;
    if (o.x || o.z) {
      m.group.rotation.x -= o.x;
      m.group.rotation.z -= o.z;
      o.x = o.z = 0;
    }
    if (o.node) {
      o.node.rotation.x -= o.nv;
      o.node = null;
      o.nv = 0;
    }
  },
  dmgApply(dt) {
    const m = this.model;
    if (!m || !m.group || this.dead || this.team !== 'enemy' || !(this.maxHp > 0)) return;
    const st = dmgStage(this.hp / this.maxHp);
    if (st < 3) return;
    if (m.dmgKind === undefined) m.dmgKind = dmgKind(this);
    const kind = m.dmgKind;
    if (!kind) return;
    const k = (st >= 4 ? 1 : 0.6) * (this.isBoss || m.cls === 'boss' ? 0.3 : 1);
    const side = (this.id || 0) % 2 ? 1 : -1,
      t = this.t || 0;
    const o = m.dmgOff || (m.dmgOff = { x: 0, z: 0, node: null, nv: 0 });
    let x = 0,
      z = 0;
    if (kind === 'mech') {
      // 一隻手臂的前臂垂下來（選邊依編號）
      const a = m.arms && m.arms[side > 0 ? 'r' : 'l'];
      if (a && a.fore) {
        o.node = a.fore;
        o.nv = 0.35 * k;
        a.fore.rotation.x += o.nv;
      }
    } else if (kind === 'ground') {
      // 爆胎、懸吊壞掉：車身歪一邊
      z = 0.07 * side * k;
      x = 0.025 * k;
    } else if (kind === 'fly') {
      // 搖晃
      x = 0.06 * k * Math.sin(t * 1.7 + side);
      z = 0.1 * k * Math.sin(t * 2.3);
    } else if (kind === 'fixed') {
      x = 0.06 * k; // 往前垂
    } else if (kind === 'boat') {
      z = 0.12 * side * k;
      x = 0.03 * k;
    }
    if (x || z) {
      m.group.rotation.x += x;
      m.group.rotation.z += z;
      o.x = x;
      o.z = z;
    }
    // 第 4 階段：一直抖（受擊反應的小幅度，只在本機）
    if (st >= 4 && this.hrAdd) {
      this.dmgJitT = (this.dmgJitT || 0) - dt;
      if (this.dmgJitT <= 0) {
        this.dmgJitT = 0.5 + Math.random() * 0.7;
        this.hrAdd('rifle', side * 0.3, 1, 0, false, 0, 0.45);
      }
    }
  },
});
