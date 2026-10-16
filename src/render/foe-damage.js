// 受損狀態與擊破碎片的共用執行（地圖專屬敵人的模型）：讀模型的 rig.dmg
//   rig.dmg = { smoke: [[x, y, z], ...]（冒煙點，模型座標）, plates: [Mesh...]（AP ≤ 25% 脫落的裝甲板）,
//               chunks: [Group...]（擊破時拆開飛散的大塊）, unmerge?／remerge?（拆下前還原合併的網格、拆完再合併，render/foe-merge.js） }
// - AP ≤ 50%：冒煙點冒黑煙；≤ 25%：冒煙點與裝甲板位置噴火花、裝甲板脫落（一次）
// - 擊破：chunks 從模型拆下，依物理拋物線飛散、落地彈跳，幾秒後淡出
// 房主與客機各自依 AP 演出（客機的 AP 來自快照），不用新協定；特效一律不轉送（fx._nested）。
// 沒有 rig.dmg 的模型完全不受影響。碎片是 fx 的工作項目，clearMission 的 fx.clear 會一併清掉。
import { rnd } from '../core/math.js';

const GRAV = 30;
const SMOKE_DT = 0.16; // 每個冒煙點的冒煙間隔
const SPARK_DT = 0.35;

// 不轉送給客機的特效呼叫
function local(fx, fn) {
  const nest = fx._nested;
  fx._nested = true;
  try {
    fn();
  } finally {
    fx._nested = nest;
  }
}

// 從模型拆下（保留世界座標）並各自複製材質（淡出不影響其他網格）
function detach(obj, scene) {
  obj.updateMatrixWorld(true);
  scene.attach(obj);
  obj.traverse((o) => {
    if (!o.material) return;
    const own = (m) => {
      const c = m.clone();
      c.transparent = true;
      c.userData.op0 = m.opacity;
      return c;
    };
    o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
    o.castShadow = true;
  });
}
function setOpacity(obj, k) {
  obj.traverse((o) => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      m.opacity = (m.userData.op0 ?? 1) * k;
      m.depthWrite = k > 0.9;
    }
  });
}

// 拋出一個碎片：v 初速、life 總時間（最後 1.2 秒淡出）
function fling(fx, world, obj, v, life) {
  const av = new THREE.Vector3(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5));
  let rest = false;
  fx.add(obj, life, (e, t, dt) => {
    if (!rest) {
      v.y -= GRAV * dt;
      obj.position.addScaledVector(v, dt);
      obj.rotation.x += av.x * dt;
      obj.rotation.y += av.y * dt;
      obj.rotation.z += av.z * dt;
      const gy = world ? world.groundAt(obj.position.x, obj.position.z, obj.position.y + 1) + 0.2 : -1e9;
      if (obj.position.y < gy) {
        obj.position.y = gy;
        if (Math.abs(v.y) < 3) rest = true;
        else {
          v.y *= -0.35;
          v.x *= 0.55;
          v.z *= 0.55;
          av.multiplyScalar(0.5);
        }
      }
    }
    const left = (1 - t) * life;
    if (left < 1.2) setOpacity(obj, Math.max(0, left / 1.2));
  });
}

// 一組已經在場景裡的碎片（各自的材質）從 origin 往外拋出（臨時障礙物被打碎，game/hazards2.js）
export function flingDebris(fx, world, objs, origin, sp = 7) {
  for (const o of objs) {
    o.traverse((q) => {
      if (!q.material) return;
      for (const m of Array.isArray(q.material) ? q.material : [q.material]) {
        m.transparent = true;
        m.userData.op0 = m.userData.op0 ?? m.opacity;
      }
    });
    const out = o.position.clone().sub(origin);
    if (out.lengthSq() < 0.01) out.set(rnd(-1, 1), 0.3, rnd(-1, 1));
    out.normalize().multiplyScalar(rnd(0.5, 1.2) * sp);
    out.y = Math.abs(out.y) + rnd(4, 9);
    fling(fx, world, o, out, rnd(3.5, 5));
  }
}

// 冒煙點的世界座標
function smokePts(ent) {
  const d = ent.model.dmg;
  const g = ent.model.group || ent.mesh;
  g.updateMatrixWorld(true);
  return (d.smoke || []).map((p) => g.localToWorld(new THREE.Vector3(p[0], p[1], p[2])));
}

// 每格（specialFx）：依 AP 比例演出受損狀態；擊破時拆出 chunks
export function foeDamageTick(ent, dt) {
  const rig = ent.model;
  const d = rig && rig.dmg;
  if (!d) return;
  const g = ent.game;
  const fx = g && g.fx;
  if (!fx || !g.scene) return;
  const S = ent._fd || (ent._fd = { sm: 0, sp: 0, plates: false, burst: false });
  if (ent.dead) {
    if (!S.burst) {
      S.burst = true;
      foeDamageBurst(ent);
    }
    return;
  }
  if (!ent.mesh || !ent.mesh.visible || !(ent.maxHp > 0)) return;
  const frac = ent.hp / ent.maxHp;
  if (frac > 0.5) return;
  S.sm -= dt;
  S.sp -= dt;
  const pts = S.sm <= 0 || (frac <= 0.25 && S.sp <= 0) ? smokePts(ent) : null;
  if (S.sm <= 0 && pts) {
    S.sm = SMOKE_DT * (frac <= 0.25 ? 0.6 : 1);
    local(fx, () => {
      for (const p of pts)
        fx.smoke(
          p.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), 0.1, rnd(-0.2, 0.2))),
          0.7 + (0.5 - frac),
          frac <= 0.25 ? 0x1c1c1e : 0x3a3a3e,
          1.4,
          2.6,
        );
    });
  }
  if (frac > 0.25) return;
  if (S.sp <= 0 && pts && pts.length) {
    S.sp = SPARK_DT * rnd(0.6, 1.4);
    const p = pts[Math.floor(Math.random() * pts.length)];
    local(fx, () => {
      fx.streaks(p, 5, 0xffd070, 9, 0.3, 26);
      if (Math.random() < 0.4) fx.flash(p, 0.5, 0xffa040, 0.08);
    });
  }
  if (!S.plates && d.plates && d.plates.length) {
    S.plates = true;
    if (d.unmerge) d.unmerge(); // 合併過的靜態零件還原成原本的網格（render/foe-merge.js）
    const c = ent.center();
    for (const m of d.plates) {
      if (!m || !m.parent) continue;
      detach(m, g.scene);
      const out = m.position.clone().sub(c).setY(0);
      if (out.lengthSq() < 0.01) out.set(rnd(-1, 1), 0, rnd(-1, 1));
      out.normalize().multiplyScalar(rnd(3, 6));
      fling(fx, g.world, m, out.add(new THREE.Vector3(0, rnd(5, 8), 0)), 5);
      local(fx, () => fx.streaks(m.position.clone(), 8, 0xffe090, 12, 0.35, 26));
    }
    if (d.remerge) d.remerge(); // 剩下的零件再合併（render/foe-merge.js）
  }
}

// 擊破：chunks 從模型拆下飛散（房主的 die 與客機的 dieVisual 都經過 specialFx）
export function foeDamageBurst(ent) {
  const d = ent.model && ent.model.dmg;
  if (!d || !d.chunks || !d.chunks.length) return;
  if (d.unmerge) d.unmerge(); // 合併過的靜態零件還原成原本的網格（render/foe-merge.js）
  const g = ent.game;
  const c = ent.center();
  for (const ch of d.chunks) {
    if (!ch || !ch.parent) continue;
    detach(ch, g.scene);
    ch.visible = true;
    const wp = ch.getWorldPosition(new THREE.Vector3());
    const out = wp.sub(c).setY(0);
    if (out.lengthSq() < 0.01) out.set(rnd(-1, 1), 0, rnd(-1, 1));
    out.normalize().multiplyScalar(rnd(5, 10));
    fling(g.fx, g.world, ch, out.add(new THREE.Vector3(0, rnd(7, 12), 0)), rnd(4.5, 6));
  }
}
