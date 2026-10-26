// ============================================================
//  帶狀軌跡（機甲動作改版第四期，docs/mech-animation.md）：近戰武器刀尖的刀光、滑行／QB 時地面的推進氣流帶。
//  呼叫端每格以 push(key, a, b, o) 加一對點（帶子的兩個邊），每個點存活 o.life 秒、越舊越透明；
//  同一個 key 是同一條帶子，一段時間沒有新的點就移除。只有外觀，房主與客機各自算、不轉送。
// ============================================================
import { isOutline } from '../render/geometry.js';

const VS = `
attribute float alpha;
varying float vA;
void main() {
  vA = alpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FS = `
uniform vec3 color;
uniform float opacity;
varying float vA;
void main() {
  gl_FragColor = vec4(color, opacity * vA);
}`;

class Ribbon {
  constructor(scene, max, o) {
    this.max = max;
    this.pts = []; // { a, b, t }（t＝已經存在的秒數）
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 2 * 3);
    this.alp = new Float32Array(max * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    const idx = [];
    for (let i = 0; i < max - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { color: { value: new THREE.Color(o.color) }, opacity: { value: o.opacity } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.additive ? 6 : 4;
    this.mesh.userData.noFade = true;
    this.mesh.userData.helper = true;
    scene.add(this.mesh);
    this.idle = 0;
    this.o = o;
  }
}

export class RibbonFx {
  constructor(scene) {
    this.scene = scene;
    this.map = new Map();
  }
  // a、b：世界座標（會複製）；o：{ color, opacity, life（秒）, max（點數）, additive }
  push(key, a, b, o) {
    let r = this.map.get(key);
    if (!r) {
      r = new Ribbon(this.scene, o.max || 16, o);
      this.map.set(key, r);
    }
    r.o.life = o.life;
    r.mat.uniforms.color.value.set(o.color);
    r.mat.uniforms.opacity.value = o.opacity;
    r.idle = 0;
    r.pts.push({ a: a.clone(), b: b.clone(), t: 0 });
    if (r.pts.length > r.max) r.pts.shift();
  }
  // 中斷這條帶子（下一個點從新的一段開始）：例如刀光的一招結束、離地
  cut(key) {
    const r = this.map.get(key);
    if (r) r.pts.length = 0;
  }
  update(dt) {
    for (const [key, r] of this.map) {
      r.idle += dt;
      const life = r.o.life;
      let n = 0;
      for (const p of r.pts) p.t += dt;
      while (r.pts.length && r.pts[0].t >= life) r.pts.shift();
      const P = r.pts;
      for (let i = 0; i < P.length; i++) {
        const p = P[i],
          j = n * 6,
          // 越舊越透明；最新的一點也稍微淡一點，帶子的頭比較尖
          f = (1 - p.t / life) * (i === P.length - 1 ? 0.6 : 1);
        r.pos[j] = p.a.x;
        r.pos[j + 1] = p.a.y;
        r.pos[j + 2] = p.a.z;
        r.pos[j + 3] = p.b.x;
        r.pos[j + 4] = p.b.y;
        r.pos[j + 5] = p.b.z;
        r.alp[n * 2] = f;
        r.alp[n * 2 + 1] = f * (r.o.edge !== undefined ? r.o.edge : 1);
        n++;
      }
      const g = r.mesh.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
      g.setDrawRange(0, Math.max(0, n - 1) * 6);
      if (!P.length && r.idle > 1) {
        this.scene.remove(r.mesh);
        g.dispose();
        r.mat.dispose();
        this.map.delete(key);
      }
    }
  }
  clear() {
    for (const r of this.map.values()) {
      this.scene.remove(r.mesh);
      r.mesh.geometry.dispose();
      r.mat.dispose();
    }
    this.map.clear();
  }
}

// 近戰武器的刀尖與刀根（武器持握層的區域座標）：在合併網格之前量（MechEntity.mergeModel）。
// 刀身沿著持握層的 Z 軸（−Z 是刀尖），取外框在 Z 上離握點最遠的那一端
export function measureBlades(rig) {
  if (!rig || rig.vehicle || !rig.arms) return;
  rig.group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(),
    m = new THREE.Matrix4(),
    box = new THREE.Box3(),
    bb = new THREE.Box3();
  for (const k of ['l', 'r']) {
    const a = rig.arms[k];
    if (!a || !a.weapon) continue;
    const ref = a.aim || a.weapon;
    inv.copy(ref.matrixWorld).invert();
    box.makeEmpty();
    ref.traverse((o) => {
      if (!o.isMesh || !o.geometry || o.userData.helper || isOutline(o.material) || !o.visible) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      m.multiplyMatrices(inv, o.matrixWorld);
      bb.copy(o.geometry.boundingBox).applyMatrix4(m);
      box.union(bb);
    });
    if (box.isEmpty()) continue;
    const z = Math.abs(box.min.z) >= Math.abs(box.max.z) ? box.min.z : box.max.z;
    const cx = (box.min.x + box.max.x) / 2,
      cy = (box.min.y + box.max.y) / 2;
    a.bladeRef = ref;
    a.bladeTip = new THREE.Vector3(cx, cy, z);
    a.bladeBase = new THREE.Vector3(cx, cy, z * 0.45);
  }
}
