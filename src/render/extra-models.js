// 非機甲的小型模型（純函式，不使用亂數、不加入場景）：運輸貨車／列車、掉落物、轟炸機、彈體
import { box, cyl } from '../world/prop-models.js';

// 沿公路／鐵路行駛的運輸車輛；cars 節車廂沿 −Z 排列，車頭朝 +Z
export function buildTransport(kind, cars, carLen) {
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
  for (let i = 0; i < cars; i++) {
    const zc = -i * carLen;
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
  return g;
}

// 掉落物：發光方塊＋地面光環
export function buildPickupMesh(color) {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.4 }),
  );
  m.castShadow = true;
  g.add(m);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.2, 1.5, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.55;
  g.add(ring);
  return g;
}

// 空襲轟炸機：機身沿 Z 軸、機頭朝 −Z
export function buildBomberMesh() {
  const bm = new THREE.Group();
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
  return bm;
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
// 子彈的拖曳長度依速度決定（speed：彈速 m/s）
export function buildProjectileMesh(kind, color, speed) {
  const col = color || 0xffe0a0;
  const mesh = new THREE.Group();
  if (kind === 'bullet') {
    const L = Math.min(2.0, Math.max(0.9, speed * 0.009));
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
