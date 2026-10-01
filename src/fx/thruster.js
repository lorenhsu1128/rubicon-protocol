// ============================================================
//  推進器噴焰：粒子特效（不是模型）。所有機體共用一個 THREE.Points（加色混合），
//  從背包的噴口連接點沿噴口方向（連接點的 −Y 軸）噴出：剛噴出時白熱、隨後轉成噴焰色並變大淡出。
//  遊戲（Effects.thruster）與模型庫檢視窗共用。
// ============================================================
const VS = `
attribute float size;
attribute float alpha;
attribute vec3 color;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
  vAlpha = alpha;
  vColor = color;
}`;
const FS = `
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (d > 1.0) discard;
  float a = (1.0 - d) * (1.0 - d) * vAlpha;
  gl_FragColor = vec4(vColor * a * 1.8, a);
}`;

const DOWN = new THREE.Vector3(0, -1, 0);
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const COLORS = new Map();
const colorOf = (c) => COLORS.get(c) || COLORS.set(c, new THREE.Color(c)).get(c);
// 噴口的世界座標與噴射方向（連接點的 −Y 軸）
export function nozzleWorld(n, pos, dir) {
  n.getWorldPosition(pos);
  n.getWorldQuaternion(_q);
  dir.copy(DOWN).applyQuaternion(_q).normalize();
}

export class ThrusterFx {
  constructor(scene, max = 3000) {
    this.max = max;
    this.next = 0;
    this.used = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.tint = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    // 粒子大小以公尺計：依畫面高度與視角換算成像素
    const sz = new THREE.Vector2();
    this.points.onBeforeRender = (renderer, scene, camera) => {
      renderer.getDrawingBufferSize(sz);
      if (camera.isPerspectiveCamera)
        this.uniforms.uScale.value = sz.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    };
    this.geo = g;
    scene.add(this.points);
  }
  emit(p, v, color, size, life) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    this.used = Math.max(this.used, i + 1);
    const c = colorOf(color);
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.tint.set([c.r, c.g, c.b], i * 3);
    this.size0[i] = size;
    this.life[i] = this.maxLife[i] = life;
  }
  // 依推力（0～1）從模型的每個噴口持續噴出；scale 為機體縮放，carry 為機體速度（尾焰會被帶著走一點）
  stream(model, thrust, color, scale, dt, carry) {
    if (!model || !model.nozzles || !model.nozzles.length || thrust <= 0.005) return;
    const rate = (15 + 220 * thrust) * dt;
    model._thrAcc = (model._thrAcc || 0) + rate;
    let n = Math.floor(model._thrAcc);
    model._thrAcc -= n;
    if (!n) return;
    const pos = new THREE.Vector3(),
      dir = new THREE.Vector3(),
      v = new THREE.Vector3();
    for (const nz of model.nozzles) {
      nozzleWorld(nz, pos, dir);
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
    const P = this.pos,
      V = this.vel;
    const drag = Math.exp(-dt * 3);
    for (let i = 0; i < this.used; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const j = i * 3;
      P[j] += V[j] * dt;
      P[j + 1] += V[j + 1] * dt;
      P[j + 2] += V[j + 2] * dt;
      V[j] *= drag;
      V[j + 1] *= drag;
      V[j + 2] *= drag;
      // 白熱核心 → 噴焰色，變大、淡出
      const hot = Math.max(0, 1 - t * 2.5);
      for (let k = 0; k < 3; k++) this.col[j + k] = this.tint[j + k] * (1 - hot) + hot;
      this.size[i] = this.size0[i] * (0.6 + t * 1.6);
      this.alpha[i] = Math.pow(1 - t, 1.4) * 0.9;
    }
    const g = this.geo;
    g.setDrawRange(0, this.used);
    for (const k of ['position', 'color', 'size', 'alpha']) g.attributes[k].needsUpdate = true;
  }
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.used = 0;
    this.next = 0;
    this.geo.setDrawRange(0, 0);
  }
}
