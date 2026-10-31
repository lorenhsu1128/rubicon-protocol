// ============================================================
//  戰鬥機式的噴流（docs/vfx-design.md 第 6 期）：每個噴口每格一條細長的四邊形，沿噴射方向拉長、繞軸轉向鏡頭，
//  著色器畫出白熱的細核心（往尾端漸細、轉成噴焰色）、噴口附近的馬赫環、輕微的閃爍。
//  所有機體的噴流一次畫完（InstancedBufferGeometry，每格重寫實例）。add() 在模擬的每一格呼叫
//  （推進器 ThrusterFx.stream、腳的噴口）；新的一格（tick 增加）第一次 add 時清掉上一格的。
//  每個實例：p（噴口的位置, 寬度）、a（方向 × 長度, 強度）、c（顏色, 種子）。
// ============================================================
const STRIDE = 12;
const MAX = 512;

const VS = /* glsl */ `
attribute vec4 iP, iA, iC;
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vI, vSeed, vFogD, vLen;
void main() {
  vec3 base = iP.xyz;
  vec3 ax = iA.xyz;
  float len = length(ax);
  vec3 dir = len > 1e-4 ? ax / len : vec3(0.0, -1.0, 0.0);
  vec3 mid = base + ax * 0.5;
  vec3 eye = normalize(cameraPosition - mid);
  vec3 rt = cross(dir, eye);
  rt = length(rt) > 1e-4 ? normalize(rt) : vec3(1.0, 0.0, 0.0);
  float y = position.y + 0.5; // 0＝噴口、1＝尾端
  // 噴口端稍微比寬度窄一點，往外先略寬再收細（像真的噴流）
  float w = iP.w * (0.75 + 0.35 * sin(min(y * 2.2, 1.57))) * (1.0 - 0.55 * y);
  vec3 wp = base + ax * y + rt * position.x * w * 2.0;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogD = -mv.z;
  vUv = vec2(position.x * 2.0, y);
  vCol = iC.rgb;
  vI = iA.w;
  vSeed = iC.w;
  vLen = len / max(iP.w, 1e-3); // 長寬比：馬赫環的數量依它
}`;

const FS = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vCol;
varying float vI, vSeed, vFogD, vLen;
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear, fogFar;
#endif
#endif
void main() {
  float x = vUv.x, y = vUv.y;
  float fl = 0.88 + 0.12 * sin(uTime * 61.0 + vSeed * 17.0) * sin(uTime * 37.0 + vSeed * 5.0); // 閃爍
  float tail = 1.0 - smoothstep(0.35, 1.0, y); // 尾端淡出
  float core = exp(-x * x * 18.0) * (1.0 - smoothstep(0.0, 0.75, y)); // 白熱的細核心（前段）
  float body = exp(-x * x * 4.0) * tail; // 外層的噴焰
  // 馬赫環：噴口附近等距的亮帶（數量依長寬比，3～5 個），越後面越淡；環與環之間的核心暗一點（一節一節）
  float n = clamp(vLen * 0.32, 3.0, 5.0);
  float wave = cos((y * n - 0.4) * 6.2832); // 第一個環在噴口稍微下游（噴口剛出來是暗的）
  float near = 1.0 - smoothstep(0.05, 0.7, y);
  float ring = pow(max(0.0, wave), 6.0) * near * exp(-x * x * 5.0);
  float pulse = mix(1.0, 0.45 + 0.55 * max(0.0, wave), near);
  float a = (core * 1.1 * pulse + body * 0.5 + ring * 2.0) * vI * fl;
  vec3 hot = vec3(1.0);
  vec3 rgb = mix(hot, vCol, smoothstep(0.05, 0.55, y) * (1.0 - ring * 0.8));
  rgb *= 1.0 + core * 0.5 + ring * 0.8;
  a = min(a, 1.0);
  if (a < 0.004) discard;
#ifdef USE_FOG
#ifdef FOG_EXP2
  float ff = 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD);
#else
  float ff = smoothstep(fogNear, fogFar, vFogD);
#endif
  rgb *= 1.0 - ff;
#endif
  // 加色為主、帶一點遮蔽（明亮的地面上也看得到）
  gl_FragColor = vec4(rgb * a, a * 0.25);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

const _c = new THREE.Color();

export class JetFx {
  constructor(scene) {
    this.scene = scene;
    this.arr = new Float32Array(MAX * STRIDE);
    this.n = 0;
    this.tick = 0; // 模擬的格數（ThrusterFx.update 每格加 1）
    this.addTick = -1;
    this.time = 0;
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1, 1, 1);
    g.setIndex(q.index);
    g.setAttribute('position', q.attributes.position);
    const buf = new THREE.InstancedInterleavedBuffer(this.arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iP', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    g.setAttribute('iA', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    g.setAttribute('iC', new THREE.InterleavedBufferAttribute(buf, 4, 8));
    g.instanceCount = 0;
    this.buf = buf;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uTime: { value: 0 } },
      vertexShader: VS,
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const m = new THREE.Mesh(g, this.mat);
    m.frustumCulled = false;
    m.renderOrder = 6;
    m.userData.noAO = true;
    m.userData.noFade = true;
    m.visible = false;
    scene.add(m);
    this.mesh = m;
  }
  // 一條噴流：p 噴口、dir 噴射方向（正規化）、len 長度、w 噴口的寬度（公尺）、k 強度 0～1、color、seed（閃爍錯開）
  add(p, dir, len, w, k, color, seed = 0) {
    if (this.addTick !== this.tick) {
      this.addTick = this.tick;
      this.n = 0;
    }
    if (this.n >= MAX || k <= 0.01 || len <= 0.01) return;
    const a = this.arr,
      o = this.n++ * STRIDE;
    _c.setHex(color);
    a[o] = p.x;
    a[o + 1] = p.y;
    a[o + 2] = p.z;
    a[o + 3] = w;
    a[o + 4] = dir.x * len;
    a[o + 5] = dir.y * len;
    a[o + 6] = dir.z * len;
    a[o + 7] = k;
    a[o + 8] = _c.r;
    a[o + 9] = _c.g;
    a[o + 10] = _c.b;
    a[o + 11] = seed;
  }
  // 模擬的一格（ThrusterFx.update）
  step(dt) {
    this.tick++;
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time % 1000;
  }
  // 算繪前：上傳這一格的噴流；兩格以上沒有新的（沒有機體在噴）就清掉
  flush() {
    if (this.tick - this.addTick > 1) this.n = 0;
    const g = this.mesh.geometry;
    g.instanceCount = this.n;
    this.mesh.visible = this.n > 0;
    if (!this.n) return;
    this.buf.updateRange.offset = 0;
    this.buf.updateRange.count = this.n * STRIDE;
    this.buf.needsUpdate = true;
  }
  clear() {
    this.n = 0;
    this.mesh.visible = false;
    this.mesh.geometry.instanceCount = 0;
  }
}
