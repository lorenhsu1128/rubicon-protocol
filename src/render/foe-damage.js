// 受損狀態與擊破碎片的共用執行：所有敵人（docs/crew-civilians-design.md 第 1 期）＋有 rig.dmg 的模型
//   rig.dmg = { smoke: [[x, y, z], ...]（冒煙點，模型座標）, plates: [Mesh...]（AP ≤ 25% 脫落的裝甲板）,
//               chunks: [Group...]（擊破時拆開飛散的大塊）, unmerge?／remerge?（拆下前還原合併的網格、拆完再合併，render/foe-merge.js） }
//   沒有 rig.dmg 的敵人自動產生冒煙點（人形＝頭、核心、兩肩的關節群組；其他＝外框），裝甲板改成噴出同色的碎板
// - 四段（dmgStage）：≤ 75% 焦黑一點；≤ 50% 冒煙；≤ 25% 濃煙、火花、小火、裝甲板脫落；≤ 10% 起火、再掉一次碎板
// - 焦黑：模型自己的材質（rig.mats，每台各一份）顏色變暗
// - 擊破：chunks 從模型拆下，依物理拋物線飛散、落地彈跳，幾秒後淡出
// 房主與客機各自依 AP 演出（客機的 AP 來自快照），不用新協定；特效一律不轉送（fx._nested）。
// 不是敵人、也沒有 rig.dmg 的模型完全不受影響。碎片是 fx 的工作項目，clearMission 的 fx.clear 會一併清掉。
import { rnd } from '../core/math.js';

const GRAV = 30;
const SMOKE_DT = 0.16; // 每個冒煙點的冒煙間隔
const SPARK_DT = 0.35;
const FIRE_DT = 0.13; // 小火的間隔
const CHAR = [0, 0.14, 0.26, 0.38, 0.5]; // 各階段的焦黑程度（顏色 ×(1−值)）

// 受損的階段：0 無、1 ≤ 75%、2 ≤ 50%、3 ≤ 25%、4 ≤ 10%
export function dmgStage(frac) {
  return frac <= 0.1 ? 4 : frac <= 0.25 ? 3 : frac <= 0.5 ? 2 : frac <= 0.75 ? 1 : 0;
}
// 誰有受損演出：所有敵人，以及模型有 rig.dmg 的（專屬敵人、戰車、直升機原本就有）
export const dmgOn = (ent) => !!(ent && ent.model && (ent.team === 'enemy' || ent.model.dmg));

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

// 沒有 rig.dmg 時自動產生：人形用關節群組（跟著動作），其他用建立時的外框（模型座標）
function autoDmg(ent) {
  const m = ent.model;
  if (m.dmgAuto) return m.dmgAuto;
  const D = { smoke: [], nodes: [] };
  if (m.legsG && m.torso && !m.vehicle) {
    for (const n of [m.torso, m.head, m.arms && m.arms.r && m.arms.r.up, m.arms && m.arms.l && m.arms.l.up])
      if (n && n.isObject3D) D.nodes.push(n);
  } else {
    const g = m.group || ent.mesh;
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(g);
    if (!b.isEmpty()) {
      const c = b.getCenter(new THREE.Vector3()),
        sz = b.getSize(new THREE.Vector3());
      const top = b.max.y - sz.y * 0.15;
      for (const [x, z] of [
        [0, 0],
        [0.25, 0.2],
        [-0.25, -0.2],
      ]) {
        const w = new THREE.Vector3(c.x + x * sz.x, top, c.z + z * sz.z);
        const l = g.worldToLocal(w);
        D.smoke.push([l.x, l.y, l.z]);
      }
    }
  }
  return (m.dmgAuto = D);
}
// 冒煙點的世界座標
function smokePts(ent, d) {
  const g = ent.model.group || ent.mesh;
  g.updateMatrixWorld(true);
  const out = (d.smoke || []).map((p) => g.localToWorld(new THREE.Vector3(p[0], p[1], p[2])));
  for (const n of d.nodes || []) out.push(n.getWorldPosition(new THREE.Vector3()));
  return out;
}
// 焦黑：材質顏色依建立時的顏色變暗
function applyChar(rig, k) {
  const L = rig.mats;
  if (!L || !L.length) return;
  if (!rig.dmgC0) rig.dmgC0 = L.map((m) => (m && m.color ? m.color.clone() : null));
  L.forEach((m, i) => {
    const c0 = rig.dmgC0[i];
    if (c0 && m.color) m.color.copy(c0).multiplyScalar(1 - k);
  });
}
// 沒有 dmg.plates 的模型：從機體噴出同色的碎板
const SHARD_GEO = new THREE.BoxGeometry(1, 0.18, 0.7);
function shards(ent, pts, n) {
  const g = ent.game,
    rig = ent.model;
  const src = (rig.mats && rig.mats[0]) || null;
  if (!src || !pts.length) return;
  const R = Math.max(0.4, (ent.radius || 2) * 0.22);
  const c = ent.center();
  for (let i = 0; i < n; i++) {
    const mat = src.clone();
    mat.transparent = true;
    mat.userData.op0 = 1;
    const o = new THREE.Mesh(SHARD_GEO, mat);
    o.scale.setScalar(R * rnd(0.6, 1.2));
    o.castShadow = true;
    const p = pts[Math.floor(Math.random() * pts.length)];
    o.position.copy(p);
    g.scene.add(o);
    const out = p.clone().sub(c).setY(0);
    if (out.lengthSq() < 0.01) out.set(rnd(-1, 1), 0, rnd(-1, 1));
    out.normalize().multiplyScalar(rnd(3, 7));
    fling(g.fx, g.world, o, out.add(new THREE.Vector3(0, rnd(5, 9), 0)), 4);
    local(g.fx, () => g.fx.streaks(p.clone(), 6, 0xffe090, 11, 0.3, 26));
  }
}

// 每格（specialFx）：依 AP 比例演出受損狀態；擊破時拆出 chunks
export function foeDamageTick(ent, dt) {
  const rig = ent.model;
  if (!dmgOn(ent)) return;
  const g = ent.game;
  const fx = g && g.fx;
  if (!fx || !g.scene) return;
  const S =
    ent._fd || (ent._fd = { sm: 0, sp: 0, fi: 0, plates: false, plates2: false, burst: false, ch: 0 });
  if (ent.dead) {
    if (!S.burst) {
      S.burst = true;
      foeDamageBurst(ent);
    }
    return;
  }
  if (!ent.mesh || !ent.mesh.visible || !(ent.maxHp > 0)) return;
  const d = rig.dmg || autoDmg(ent);
  const frac = ent.hp / ent.maxHp;
  const st = dmgStage(frac);
  // 焦黑（回復 AP 時也會變回來）
  const ch = CHAR[st];
  if (Math.abs(S.ch - ch) > 0.002) {
    S.ch += (ch - S.ch) * Math.min(1, dt * 3);
    applyChar(rig, S.ch);
  }
  if (st < 2) return;
  S.sm -= dt;
  S.sp -= dt;
  S.fi -= dt;
  const pts =
    S.sm <= 0 || (st >= 3 && (S.sp <= 0 || S.fi <= 0)) || (st >= 3 && !S.plates) || (st >= 4 && !S.plates2)
      ? smokePts(ent, d)
      : null;
  if (S.sm <= 0 && pts) {
    S.sm = SMOKE_DT * (st >= 4 ? 0.6 : st >= 3 ? 0.75 : 1);
    // 一次最多 2 個點（自動產生的冒煙點比較多，不要整台被煙蓋住）
    const sp = pts.length > 2 ? [pts[Math.floor(Math.random() * pts.length)], pts[0]] : pts;
    local(fx, () => {
      for (const p of sp)
        fx.smoke(
          p.clone().add(new THREE.Vector3(rnd(-0.2, 0.2), 0.1, rnd(-0.2, 0.2))),
          0.7 + (0.5 - frac) + (st >= 4 ? 0.15 : 0),
          st >= 3 ? 0x1c1c1e : 0x3a3a3e,
          1.4,
          2.6,
        );
    });
  }
  if (st < 3) return;
  if (S.sp <= 0 && pts && pts.length) {
    S.sp = SPARK_DT * rnd(0.6, 1.4) * (st >= 4 ? 0.6 : 1);
    const p = pts[Math.floor(Math.random() * pts.length)];
    local(fx, () => {
      fx.streaks(p, 5, 0xffd070, 9, 0.3, 26);
      if (Math.random() < 0.4) fx.flash(p, 0.5, 0xffa040, 0.08);
    });
  }
  // 小火：第 3 階段一個點、第 4 階段每個點
  if (S.fi <= 0 && pts && pts.length) {
    S.fi = FIRE_DT * rnd(0.7, 1.3);
    const R = 0.24; // fx 會再乘尺度倍率（約 0.7 m 的火；加色混合，太大在亮的地圖會變成白色一團）
    const list = [
      st >= 4 ? pts[Math.floor(Math.random() * Math.min(2, pts.length))] : pts[(ent.id || 0) % pts.length],
    ];
    local(fx, () => {
      for (const p of list) {
        const q = p.clone().add(new THREE.Vector3(rnd(-0.6, 0.6), rnd(0, 0.8), rnd(-0.6, 0.6)));
        fx.flash(q, R * rnd(0.6, 1) * (st >= 4 ? 1.25 : 1), Math.random() < 0.6 ? 0xd8480a : 0xff7018, 0.16);
        if (Math.random() < 0.35) fx.streaks(q, 2, 0xff9a30, 4, 0.5, -6); // 往上飄的火星
      }
    });
  }
  if (!S.plates) {
    S.plates = true;
    if (d.plates && d.plates.length) {
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
    } else if (pts) shards(ent, pts, 3);
  }
  if (st >= 4 && !S.plates2) {
    S.plates2 = true;
    if (pts) shards(ent, pts, 2);
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
