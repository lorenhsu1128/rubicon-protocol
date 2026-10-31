// ============================================================
//  焦散（docs/water-design.md）：照 jeantimex/threejs-water（MIT）的「面積比」做法——模擬視窗上一張格子網格，
//  每個頂點是一條陽光：在平的水面折射後落到水底的位置（old）與在起伏的水面折射後落到水底的位置（new），
//  頂點畫在 new 的位置、亮度＝old 的面積 ÷ new 的面積（光被集中的地方越亮），加色畫進一張貼圖。
//  改成遊戲用：水底是地形（地形高度貼圖，落點再修正一次）；貼圖的座標是「沿平水面的折射光往回推到水位高度」的
//  水平位置，地形的著色器（render/style/shader.js 的 stCau）用同一個換算取樣，所以光紋落在正確的地方。
// ============================================================
import { TER_GLSL } from './glsl.js';

const VS = /* glsl */ `
uniform sampler2D tSim;
uniform vec4 win;
uniform vec3 uSun;
uniform float uLevel, uTime, uScale, uDetK;
uniform sampler2D tDet;
${TER_GLSL}
varying vec3 vOld, vNew;
varying float vOk;
const float ETA = 0.75;
vec3 back(vec3 X, vec3 r0) {
  return X + r0 * ((uLevel - X.y) / r0.y);
}
void main() {
  vec2 su = position.xy + 0.5;
  vec4 s = texture2D(tSim, su);
  vec2 xz = win.xy + position.xy * win.z;
  // 法線：模擬＋細碎波紋（平靜的水也有晃動的光紋；比水面看到的波紋細一點、強一點，光才聚得起來）
  vec2 dn = (texture2D(tDet, xz * (0.047 / uScale) + uTime * vec2(0.013, 0.009)).rg * 2.0 - 1.0) * 0.55
    + (texture2D(tDet, xz * (0.1 / uScale) - uTime * vec2(0.017, -0.021)).rg * 2.0 - 1.0) * 0.45;
  vec3 n = normalize(vec3(s.b * 2.5 + dn.x * uDetK * 2.2, 1.0, s.a * 2.5 + dn.y * uDetK * 2.2));
  vec3 L = -uSun;
  vec3 r0 = refract(L, vec3(0.0, 1.0, 0.0), ETA);
  vec3 r1 = refract(L, n, ETA);
  float fl = terH(xz);
  float d0 = uLevel - fl;
  vOk = smoothstep(0.0, 0.6, d0);
  vec3 P0 = vec3(xz.x, uLevel, xz.y);
  vec3 P1 = vec3(xz.x, uLevel + s.r, xz.y);
  vec3 o = P0 + r0 * (max(d0, 0.01) / -r0.y);
  vec3 h = P1 + r1 * (max(P1.y - fl, 0.01) / -r1.y);
  float fl2 = min(terH(h.xz), uLevel - 0.01);
  vec3 nw = P1 + r1 * ((P1.y - fl2) / -r1.y);
  vOld = back(o, r0);
  vNew = back(nw, r0);
  gl_Position = vec4((vNew.xz - win.xy) / win.z * 2.0, 0.0, 1.0);
}
`;

const FS = /* glsl */ `
varying vec3 vOld, vNew;
varying float vOk;
void main() {
  float a0 = length(dFdx(vOld)) * length(dFdy(vOld));
  float a1 = length(dFdx(vNew)) * length(dFdy(vNew));
  gl_FragColor = vec4(vOk * min(a0 / max(a1, 1e-6), 4.0) * 0.2, 0.0, 0.0, 1.0);
}
`;

export class Caustics {
  // res：貼圖的邊長；grid：網格每邊的格數
  constructor(R, res, grid) {
    this.R = R;
    this.rt = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.U = {
      tSim: { value: null },
      win: { value: new THREE.Vector4() },
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uLevel: { value: 0 },
      tTer: { value: null },
      terM: { value: new THREE.Vector4() },
      tDet: { value: null },
      uTime: { value: 0 },
      uScale: { value: 1 },
      uDetK: { value: 0.35 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.U,
      vertexShader: VS,
      fragmentShader: FS,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      extensions: { derivatives: true },
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, grid, grid), m);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  get tex() {
    return this.rt.texture;
  }
  // wu：水面的 uniform（細碎波紋的貼圖、時間、尺度、強度和水面一致）
  render(simTex, win, sun, level, ter, wu) {
    const U = this.U;
    U.tDet.value = wu.tDet.value;
    U.uTime.value = wu.uTime.value;
    U.uScale.value = wu.uScale.value;
    U.uDetK.value = wu.uDet.value.x;
    U.tSim.value = simTex;
    U.win.value.copy(win);
    U.uSun.value.copy(sun);
    U.uLevel.value = level;
    U.tTer.value = ter.tex;
    U.terM.value.copy(ter.M);
    const R = this.R,
      rt = R.getRenderTarget(),
      cc = R.getClearColor(new THREE.Color()),
      ca = R.getClearAlpha();
    R.setRenderTarget(this.rt);
    R.setClearColor(0x000000, 0);
    R.clear(true, false, false);
    R.render(this.scene, this.cam);
    R.setClearColor(cc, ca);
    R.setRenderTarget(rt);
  }
  dispose() {
    this.rt.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// 平水面的折射光（地形的著色器換算焦散貼圖的座標）：回傳 r0.xz / r0.y
export function refractK(sun, out) {
  const L = new THREE.Vector3().copy(sun).negate().normalize();
  const eta = 0.75,
    c = -L.y; // cos θi（法線朝上）
  const k = 1 - eta * eta * (1 - c * c);
  const r = L.multiplyScalar(eta).add(new THREE.Vector3(0, eta * c - Math.sqrt(Math.max(0, k)), 0));
  return out.set(r.x / r.y, r.z / r.y);
}

// ---------- 細的焦散花紋（可以拼接）：在 CPU 上算一次——一張可以拼接的起伏水面，每條光線依斜率偏移後落點累加，
// 光被集中的地方亮（同樣的面積比原理，只是解析度高、不必每格算）。地形的著色器拿兩層錯開、方向不同地移動，
// 取較小的一層成網狀；模擬的焦散（上面的 Caustics）疊在上面＝機體與爆炸攪動的地方光紋跟著亂。
let CT = null;
export function causTex() {
  if (CT) return CT;
  const N = 256,
    M = 640,
    TAU = Math.PI * 2;
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const waves = [];
  for (let k = 0; k < 10; k++) {
    const kx = Math.round((rnd() * 2 - 1) * 4) || 1,
      ky = Math.round((rnd() * 2 - 1) * 4) || 2;
    waves.push([kx, ky, 1 / Math.hypot(kx, ky), rnd() * TAU]);
  }
  const acc = new Float32Array(N * N);
  const D = 0.018; // 偏移量（相對一張）：越大光越聚
  for (let j = 0; j < M; j++)
    for (let i = 0; i < M; i++) {
      const u = i / M,
        v = j / M;
      let gx = 0,
        gy = 0;
      for (const [kx, ky, am, ph] of waves) {
        const c = Math.cos((kx * u + ky * v) * TAU + ph) * am;
        gx += c * kx;
        gy += c * ky;
      }
      let x = (u + gx * D) * N,
        y = (v + gy * D) * N;
      x = ((x % N) + N) % N;
      y = ((y % N) + N) % N;
      const x0 = Math.floor(x),
        y0 = Math.floor(y),
        fx = x - x0,
        fy = y - y0;
      const x1 = (x0 + 1) % N,
        y1 = (y0 + 1) % N;
      acc[y0 * N + x0] += (1 - fx) * (1 - fy);
      acc[y0 * N + x1] += fx * (1 - fy);
      acc[y1 * N + x0] += (1 - fx) * fy;
      acc[y1 * N + x1] += fx * fy;
    }
  const mean = (M * M) / (N * N);
  const d = new Uint8Array(N * N * 4);
  for (let o = 0; o < N * N; o++) {
    const v = Math.min(1, (acc[o] / mean) * 0.25);
    d[o * 4] = d[o * 4 + 1] = d[o * 4 + 2] = Math.round(v * 255);
    d[o * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  CT = t;
  return t;
}
