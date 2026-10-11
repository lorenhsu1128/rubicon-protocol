// 非機甲的小型模型（純函式，不使用亂數、不加入場景）：運輸貨車／列車、掉落物、轟炸機、彈體
// 遊戲的本地模型庫可以用 GLB 取代（model-provider.js）：每節車廂、掉落物本體、轟炸機、彈體各自一個槽位
import { box, cyl } from '../world/prop-models.js';
import { providedModel } from './model-provider.js';
import { tagStyle } from './style/shader.js';

// 運輸車輛每一節的槽位：列車第一節是機車頭、其餘是車廂；貨車每節相同
export const transportSlot = (kind, i) =>
  kind === 'train' ? `vehicle/transport_train/${i === 0 ? 'loco' : 'car'}` : 'vehicle/transport_truck';

// 沿公路／鐵路行駛的運輸車輛；cars 節車廂沿 −Z 排列，車頭朝 +Z
// first：從第幾節開始建立（模型庫單獨顯示車廂用），第一節放在原點
export function buildTransport(kind, cars, carLen, first = 0) {
  const g = new THREE.Group();
  const M = (c, o) =>
    new THREE.MeshStandardMaterial(
      Object.assign({ color: c, roughness: 0.6, metalness: 0.3, flatShading: true }, o || {}),
    );
  const bx = (w, h, d, m, x, y, z) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z);
    b.castShadow = true;
    g.add(b);
    return b;
  };
  for (let i = first; i < cars; i++) {
    const zc = -(i - first) * carLen;
    // GLB：原點為這一節的地面中心；每個實例各自一份材質（受擊閃光）
    const glb = providedModel(transportSlot(kind, i), null, true);
    if (glb) {
      glb.position.z = zc;
      g.add(glb);
      continue;
    }
    if (kind === 'train') {
      if (i === 0) {
        bx(3.2, 3.2, 7, M(0x7a2a2a), 0, 2.2, zc);
        bx(2.6, 1.6, 2.4, M(0x2a2d31), 0, 4.2, zc + 1.8);
        bx(0.8, 1.2, 0.8, M(0x1a1a1a), 0, 4.4, zc - 2.2);
        bx(3.4, 0.4, 7.2, M(0xd8c060), 0, 0.7, zc);
      } else {
        bx(3.2, 3.0, 7, M(i % 2 ? 0x4a5a3a : 0x3a4a6a), 0, 2.1, zc);
        bx(3.4, 0.3, 7.2, M(0x2a2d31), 0, 0.55, zc);
        bx(3.4, 0.2, 7.2, M(0x8a8f96), 0, 3.65, zc);
      }
      for (const sz of [-2.4, 2.4])
        for (const sx of [-1.4, 1.4]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.4, 10), M(0x1c1e20));
          w.rotation.z = Math.PI / 2;
          w.position.set(sx, 0.5, zc + sz);
          g.add(w);
        }
    } else {
      bx(3, 2.4, 7, M(0x2b4a8a), 0, 1.8, zc - 0.5);
      bx(3, 1.7, 2.4, M(0xe6e6e6), 0, 1.55, zc + 3.6);
      bx(2.6, 0.6, 2.2, M(0x30a0ff, { transparent: true, opacity: 0.6 }), 0, 2.3, zc + 3.7);
      bx(3.2, 0.3, 7.4, M(0x2a2d31), 0, 0.55, zc);
      for (const sz of [-2.6, -0.5, 3.2])
        for (const sx of [-1.45, 1.45]) {
          const w = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.5, 10), M(0x1c1e20));
          w.rotation.z = Math.PI / 2;
          w.position.set(sx, 0.6, zc + sz);
          g.add(w);
        }
    }
  }
  return tagStyle(g);
}

// 掉落物：發光方塊＋地面光環。kind：掉落物種類（GLB 槽位 small/pickup_<kind>，只取代方塊，光環維持程式特效）
// ring：false 時只建立方塊（模型庫用，作為 GLB 的參考）
export function buildPickupMesh(color, kind, ring = true) {
  const g = new THREE.Group();
  const glb = kind ? providedModel('small/pickup_' + kind) : null;
  if (glb) g.add(glb);
  else {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4 }),
    );
    m.castShadow = true;
    g.add(m);
  }
  if (!ring) return g;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -0.55;
  g.add(halo);
  return g;
}

// 據點的補給箱：原點在底面中心；color 是獎勵種類的顏色（發光條與光柱，glow 材質）
export function buildCacheMesh(color, beam = true) {
  const g = new THREE.Group();
  const glb = providedModel('small/cache');
  if (glb) g.add(glb);
  else {
    const body = new THREE.MeshStandardMaterial({ color: 0x4a5560, roughness: 0.6, metalness: 0.4 });
    const glow = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1,
      roughness: 0.4,
    });
    g.add(box(1.8, 1.1, 1.2, body, 0, 0.55, 0));
    g.add(box(1.9, 0.18, 1.3, body, 0, 1.15, 0));
    g.add(box(1.82, 0.12, 1.22, glow, 0, 0.75, 0));
    g.add(box(0.5, 0.08, 0.5, glow, 0, 1.28, 0));
  }
  if (!beam) return g;
  const bm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
  );
  bm.position.y = 15;
  g.add(bm);
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(2.6, 3.0, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.08;
  g.add(halo);
  return g;
}

// 空襲轟炸機：機身沿 Z 軸、機頭朝 −Z
export function buildBomberMesh() {
  const bm = new THREE.Group();
  const glb = providedModel('vehicle/bomber');
  if (glb) return bm.add(glb);
  const mm = new THREE.MeshStandardMaterial({
    color: 0x4a5058,
    roughness: 0.6,
    metalness: 0.5,
    flatShading: true,
  });
  const b1 = box(2.2, 1.6, 14, mm, 0, 0, 0);
  const w1 = box(24, 0.4, 4, mm, 0, 0, 1);
  const t1 = box(8, 0.3, 2.5, mm, 0, 0.6, 6);
  const f1 = box(0.3, 2.5, 3, mm, 0, 1.4, 6);
  bm.add(b1, w1, t1, f1);
  for (const sx of [-7, -3.5, 3.5, 7]) {
    bm.add(cyl(0.7, 0.7, 3, mm, sx, -0.6, 0.5).rotateX(Math.PI / 2));
  }
  return tagStyle(bm);
}

// ---------- 彈體（子彈、飛彈、砲彈／榴彈）----------
export const ProjGeo = new THREE.BoxGeometry(0.16, 0.16, 0.9),
  MissileGeo = new THREE.ConeGeometry(0.18, 0.8, 6),
  ShellGeo = new THREE.SphereGeometry(0.28, 6, 5);
const glow = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
// 彈體 GLB：命名為 glow 的材質改成武器的彈色（同一個顏色共用材質）
const PROJ_SLOT = {
  bullet: 'proj_bullet',
  missile: 'proj_missile',
  shell: 'proj_shell',
  grenade: 'proj_shell',
};
const projPals = new Map();
const projPal = (col) => {
  if (!projPals.has(col)) projPals.set(col, { glow: col });
  return projPals.get(col);
};
const bulletLen = (speed) => Math.min(2.0, Math.max(0.9, speed * 0.009));
// GLB 彈體：外層群組由 Projectile.orient 以 lookAt 讓 +Z 朝飛行方向，所以 GLB（正面 −Z）轉 180°；
// 子彈依彈速沿前後拉長（GLB 以 0.9 倍長度製作）；飛彈尾端保留程式的尾焰
function glbProjectile(kind, col, speed) {
  const slot = PROJ_SLOT[kind];
  const inner = slot ? providedModel('small/' + slot, projPal(col)) : null;
  if (!inner) return null;
  const mesh = new THREE.Group();
  inner.rotation.y = Math.PI;
  if (kind === 'bullet') inner.scale.z = bulletLen(speed) / 0.9;
  mesh.add(inner);
  if (kind === 'missile') {
    const box = new THREE.Box3().setFromObject(inner);
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), glow(0xffb060, 0.9));
    fl.position.z = box.isEmpty() ? -0.5 : box.min.z;
    mesh.add(fl);
  }
  mesh.userData.glb = true;
  return mesh;
}
// 子彈的拖曳長度依速度決定（speed：彈速 m/s）
export function buildProjectileMesh(kind, color, speed) {
  const col = color || 0xffe0a0;
  const g = glbProjectile(kind, col, speed);
  if (g) return g;
  const mesh = new THREE.Group();
  if (kind === 'bullet') {
    const L = bulletLen(speed);
    const core = new THREE.Mesh(ProjGeo, glow(0xfff2c8, 0.95));
    core.scale.set(0.4, 0.4, L);
    const halo = new THREE.Mesh(ProjGeo, glow(col, 0.5));
    halo.scale.set(1.3, 1.3, L * 1.1);
    mesh.add(core);
    mesh.add(halo);
  } else if (kind === 'missile') {
    const body = new THREE.Mesh(
      MissileGeo,
      new THREE.MeshStandardMaterial({ color: 0xd0d4d8, metalness: 0.6, roughness: 0.4 }),
    );
    const fl = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 5), glow(0xffb060, 0.9));
    fl.position.y = -0.5;
    mesh.add(body);
    mesh.add(fl);
  } else if (kind === 'torpedo') {
    // 潛航砲艇的魚雷：沿水面直線前進（長軸沿 Z）
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 1.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a4a3a, metalness: 0.6, roughness: 0.4 }),
    );
    body.rotation.x = Math.PI / 2;
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.25, 6, 5), glow(col, 0.9));
    tail.position.z = -1;
    mesh.add(body);
    mesh.add(tail);
  } else if (kind === 'crate') {
    // 起重機砲台／叉架 MT 丟出的貨櫃（長軸沿 X，飛行中不轉向）
    const cm = new THREE.MeshStandardMaterial({
      color: col,
      roughness: 0.7,
      metalness: 0.3,
      flatShading: true,
    });
    const fm = new THREE.MeshStandardMaterial({ color: 0x26282c, roughness: 0.6, metalness: 0.5 });
    mesh.add(new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.2, 2.3), cm));
    for (const s of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.3, 2.4), fm);
      f.position.x = s * 2.1;
      mesh.add(f);
    }
  } else {
    const geo = kind === 'shell' || kind === 'grenade' ? ShellGeo : ProjGeo;
    const b = new THREE.Mesh(geo, glow(col, 0.95));
    const h = new THREE.Mesh(geo, glow(col, 0.4));
    h.scale.setScalar(2.2);
    mesh.add(b);
    mesh.add(h);
  }
  return mesh;
}
