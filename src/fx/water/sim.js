// ============================================================
//  水波模擬（docs/water-design.md）。做法參考 jeantimex/threejs-water（MIT；原作 Evan Wallace 的 WebGL Water，
//  見 src/assets/fx/CREDITS.txt）：高度圖存在顯示卡的貼圖裡，兩張輪流讀寫，每步解一次二維波動方程式
//  （速度 += k²×拉普拉斯、衰減、高度 += 速度），之後算法線。改成遊戲用的地方：
//   - 模擬的範圍是一個跟著鏡頭的方形視窗（win：中心 x、z、邊長、水位），視窗移動時整張貼圖照格數平移（shift）
//   - 單位是公尺與秒（固定 60 Hz 的步長，波速與衰減換算成每步的係數）
//   - 地形高於水位的格子是岸（高度歸零，波會被擋回去）；視窗邊緣一圈慢慢吸掉（不從邊緣反射）
//   - 擾動一次處理：水滴（爆炸、子彈、雨、下洗氣流）最多 DROPS 個、球體（機體的腳與身體）最多 SPHERES 個，
//     球體以「這一步與上一步沉在水裡的體積差」推水（物體移動時前面的水被推高、後面被吸低＝尾跡）
//  貼圖的通道：R 高度（公尺）、G 每步的速度、B／A 法線的 x、z。
// ============================================================
import { QUAD_VS, TER_GLSL } from './glsl.js';

export const DROPS = 16;
export const SPHERES = 32;

const STEP_FS = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 px;
uniform vec2 shift;
uniform vec3 wave; // k²、速度的衰減、高度回到 0 的衰減
uniform vec4 win;
${TER_GLSL}
varying vec2 vUv;
vec4 S(vec2 c) {
  vec2 q = c + shift * px;
  if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) return vec4(0.0);
  return texture2D(tIn, q);
}
void main() {
  vec4 c = S(vUv);
  float lap = S(vUv + vec2(px.x, 0.0)).r + S(vUv - vec2(px.x, 0.0)).r + S(vUv + vec2(0.0, px.y)).r
    + S(vUv - vec2(0.0, px.y)).r - 4.0 * c.r;
  c.g += wave.x * lap;
  c.g *= wave.y;
  c.r += c.g;
  c.r *= wave.z;
  float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  c.rg *= mix(0.9, 1.0, smoothstep(0.0, 0.07, e));
  vec2 p = win.xy + (vUv - 0.5) * win.z;
  if (terH(p) > win.w) c.rg = vec2(0.0);
  c.r = clamp(c.r, -8.0, 8.0);
  c.g = clamp(c.g, -2.0, 2.0);
  gl_FragColor = c;
}
`;

const DIST_FS = /* glsl */ `
#define PI 3.141592653589793
uniform sampler2D tIn;
uniform vec4 win;
uniform vec4 drops[${DROPS}];
uniform int nDrop;
uniform vec4 s0[${SPHERES}];
uniform vec4 s1[${SPHERES}];
uniform int nS;
uniform float sK;
varying vec2 vUv;
// 球（xyz 中心、w 半徑）在 (x, z) 這一柱沉在水面以下的長度
float subm(vec4 s, vec2 p) {
  vec2 d = p - s.xz;
  float h2 = s.w * s.w - dot(d, d);
  if (h2 <= 0.0) return 0.0;
  float hc = sqrt(h2);
  float cy = s.y - win.w;
  return max(0.0, min(cy + hc, 0.0) - (cy - hc));
}
void main() {
  vec4 c = texture2D(tIn, vUv);
  vec2 p = win.xy + (vUv - 0.5) * win.z;
  for (int i = 0; i < ${DROPS}; i++) {
    if (i >= nDrop) break;
    vec4 d = drops[i];
    float t = max(0.0, 1.0 - length(p - d.xy) / d.z);
    c.r += d.w * (0.5 - 0.5 * cos(t * PI));
  }
  for (int i = 0; i < ${SPHERES}; i++) {
    if (i >= nS) break;
    c.r += (subm(s0[i], p) - subm(s1[i], p)) * sK;
  }
  gl_FragColor = c;
}
`;

const NRM_FS = /* glsl */ `
uniform sampler2D tIn;
uniform vec2 px;
uniform float cell; // 一格的公尺數
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tIn, vUv);
  float hx = texture2D(tIn, vUv + vec2(px.x, 0.0)).r - texture2D(tIn, vUv - vec2(px.x, 0.0)).r;
  float hz = texture2D(tIn, vUv + vec2(0.0, px.y)).r - texture2D(tIn, vUv - vec2(0.0, px.y)).r;
  vec3 n = normalize(vec3(-hx, 2.0 * cell, -hz));
  c.ba = n.xz;
  gl_FragColor = c;
}
`;

// 可以當模擬貼圖的格式：{ type, filter }；都不行時 null（品質降成「低」：沒有模擬）
export function simFormat(R) {
  const ext = R.extensions,
    gl2 = R.capabilities.isWebGL2;
  if (gl2) {
    if (!ext.has('EXT_color_buffer_float')) return null;
    // Float32 要有線性取樣的擴充才能平滑地取樣；沒有時用 Half（WebGL2 原生可線性取樣）
    if (ext.has('OES_texture_float_linear')) return { type: THREE.FloatType, filter: THREE.LinearFilter };
    return { type: THREE.HalfFloatType, filter: THREE.LinearFilter };
  }
  if (ext.has('OES_texture_float') && ext.has('WEBGL_color_buffer_float'))
    return {
      type: THREE.FloatType,
      filter: ext.has('OES_texture_float_linear') ? THREE.LinearFilter : THREE.NearestFilter,
    };
  if (ext.has('OES_texture_half_float') && ext.has('EXT_color_buffer_half_float'))
    return {
      type: THREE.HalfFloatType,
      filter: ext.has('OES_texture_half_float_linear') ? THREE.LinearFilter : THREE.NearestFilter,
    };
  return null;
}

export class WaterSim {
  // res：每邊的格數；fmt：simFormat；ter：{ tex, M }（地形高度貼圖）
  constructor(R, res, fmt) {
    this.R = R;
    this.res = res;
    const o = {
      type: fmt.type,
      minFilter: fmt.filter,
      magFilter: fmt.filter,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    this.a = new THREE.WebGLRenderTarget(res, res, o);
    this.b = new THREE.WebGLRenderTarget(res, res, o);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.scene = new THREE.Scene();
    const px = new THREE.Vector2(1 / res, 1 / res);
    const mk = (fs, u) =>
      new THREE.ShaderMaterial({
        vertexShader: QUAD_VS,
        fragmentShader: fs,
        uniforms: u,
        depthTest: false,
        depthWrite: false,
      });
    this.win = new THREE.Vector4(0, 0, 1, 0);
    this.ter = { tTer: { value: null }, terM: { value: new THREE.Vector4(0, 0, 1, 2) } };
    this.mStep = mk(STEP_FS, {
      tIn: { value: null },
      px: { value: px },
      shift: { value: new THREE.Vector2() },
      wave: { value: new THREE.Vector3(0.05, 0.99, 0.9995) },
      win: { value: this.win },
      ...this.ter,
    });
    this.mDist = mk(DIST_FS, {
      tIn: { value: null },
      win: { value: this.win },
      drops: { value: Array.from({ length: DROPS }, () => new THREE.Vector4()) },
      nDrop: { value: 0 },
      s0: { value: Array.from({ length: SPHERES }, () => new THREE.Vector4()) },
      s1: { value: Array.from({ length: SPHERES }, () => new THREE.Vector4()) },
      nS: { value: 0 },
      sK: { value: 0.2 },
    });
    this.mNrm = mk(NRM_FS, { tIn: { value: null }, px: { value: px }, cell: { value: 1 } });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mStep);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.reset();
  }
  get tex() {
    return this.a.texture;
  }
  // 清空（換地圖、品質）
  reset() {
    const R = this.R,
      rt = R.getRenderTarget(),
      cc = R.getClearColor(new THREE.Color()),
      ca = R.getClearAlpha();
    R.setClearColor(0x000000, 0);
    for (const t of [this.a, this.b]) {
      R.setRenderTarget(t);
      R.clear(true, false, false);
    }
    R.setClearColor(cc, ca);
    R.setRenderTarget(rt);
  }
  setTerrain(ter) {
    this.ter.tTer.value = ter.tex;
    this.ter.terM.value.copy(ter.M);
  }
  pass(m) {
    m.uniforms.tIn.value = this.a.texture;
    this.quad.material = m;
    this.R.setRenderTarget(this.b);
    this.R.render(this.scene, this.cam);
    const t = this.a;
    this.a = this.b;
    this.b = t;
  }
  // 一步；shift＝視窗這一步移動的格數（只在第一步給）
  step(k2, damp, sx, sz) {
    const u = this.mStep.uniforms;
    u.shift.value.set(sx, sz);
    u.wave.value.set(k2, damp, 0.9995);
    this.pass(this.mStep);
  }
  // 水滴 drops＝[x, z, 半徑, 高度（負＝往下壓）]，球 sph＝[[舊 x, y, z, r], [新 x, y, z, r]]
  disturb(drops, sph, k) {
    const u = this.mDist.uniforms;
    const nd = Math.min(DROPS, drops.length),
      ns = Math.min(SPHERES, sph.length);
    if (!nd && !ns) return;
    for (let i = 0; i < nd; i++) u.drops.value[i].fromArray(drops[i]);
    for (let i = 0; i < ns; i++) {
      u.s0.value[i].fromArray(sph[i][0]);
      u.s1.value[i].fromArray(sph[i][1]);
    }
    u.nDrop.value = nd;
    u.nS.value = ns;
    u.sK.value = k;
    this.pass(this.mDist);
  }
  normals() {
    this.mNrm.uniforms.cell.value = this.win.z / this.res;
    this.pass(this.mNrm);
  }
  dispose() {
    this.a.dispose();
    this.b.dispose();
    for (const m of [this.mStep, this.mDist, this.mNrm]) m.dispose();
    this.quad.geometry.dispose();
  }
}
