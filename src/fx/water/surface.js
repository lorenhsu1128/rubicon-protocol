// ============================================================
//  水面的網格與著色器（docs/water-design.md）。World.addWater 建立（沒有接上水面系統時也能單獨顯示：
//  只有程式產生的細碎波紋與深淺），水面系統（fx/water/index.js）每格更新 uniform。
//   - 近處：跟著模擬視窗的細網格（頂點依模擬的高度起伏）；遠處：延伸到遠景外的大平面，視窗裡面不畫
//   - 水深＝水位－地形高度（地形高度貼圖 bakeTerrain），越深越不透明、越偏水的顏色；岸邊一圈泡沫，
//     模擬的波峰（速度大）也起泡沫
//   - 反射依菲涅耳：天空與霧的顏色＋太陽的高光（品質「低」）、螢幕空間反射（「中」：上一格的畫面與深度）、
//     平面反射（「高」：把場景從水面下對稱的鏡頭再畫一次）
//   - 接受陰影（太陽的陰影讓高光與水色變暗）；色階風格時反射、高光、泡沫與深淺變成分階的硬邊（動畫的水）
//   - 從水面下往上看（背面）：水色＋全反射
//  做法參考 jeantimex/threejs-water（MIT）的菲涅耳與水色，見 src/assets/fx/CREDITS.txt。
// ============================================================
import { TER_GLSL } from './glsl.js';

// ---------- 地形高度貼圖：整張地圖＋外面一圈遠景（地圖外用 farHeight；再外面沿用邊上的值），Float、最近取樣 ----------
export function bakeTerrain(w, n = 512) {
  const S = w.size * 1.3;
  const x0 = -S / 2,
    cell = S / (n - 1);
  const data = new Float32Array(n * n * 4);
  const far = w.farHeight ? (x, z) => w.farHeight(x, z) : (x, z) => w.terrainHeight(x, z);
  const H = w.size / 2;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + i * cell,
        z = x0 + j * cell;
      const h = Math.abs(x) <= H && Math.abs(z) <= H ? w.terrainHeight(x, z) : far(x, z);
      data[(j * n + i) * 4] = h;
    }
  const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, M: new THREE.Vector4(x0, x0, cell, n) };
}

// ---------- 細碎波紋的法線貼圖（可以拼接）：RG＝斜率、B＝泡沫的花紋 ----------
let DET = null;
export function detailTex() {
  if (DET) return DET;
  const N = 256,
    TAU = Math.PI * 2;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const waves = [],
    foam = [];
  for (let k = 0; k < 18; k++) {
    let kx = Math.round((rnd() * 2 - 1) * 7),
      ky = Math.round((rnd() * 2 - 1) * 7);
    if (!kx && !ky) kx = 1;
    waves.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 1.15), rnd() * TAU]);
  }
  for (let k = 0; k < 10; k++) {
    const kx = Math.round((rnd() * 2 - 1) * 9) || 2,
      ky = Math.round((rnd() * 2 - 1) * 9) || 3;
    foam.push([kx, ky, rnd() * TAU]);
  }
  const dx = new Float32Array(N * N),
    dz = new Float32Array(N * N),
    fo = new Float32Array(N * N);
  let m = 0;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      let a = 0,
        b = 0,
        f = 0;
      for (const [kx, ky, am, ph] of waves) {
        const c = Math.cos(((kx * i + ky * j) / N) * TAU + ph) * am;
        a += c * kx;
        b += c * ky;
      }
      for (const [kx, ky, ph] of foam) f += Math.sin(((kx * i + ky * j) / N) * TAU + ph);
      const o = j * N + i;
      dx[o] = a;
      dz[o] = b;
      fo[o] = f;
      m = Math.max(m, Math.abs(a), Math.abs(b));
    }
  const d = new Uint8Array(N * N * 4);
  for (let o = 0; o < N * N; o++) {
    d[o * 4] = 128 + Math.round((dx[o] / m) * 127);
    d[o * 4 + 1] = 128 + Math.round((dz[o] / m) * 127);
    d[o * 4 + 2] = Math.round(Math.min(1, Math.max(0, 0.5 + fo[o] / 6)) * 255);
    d[o * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  DET = t;
  return t;
}

const VS = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
uniform sampler2D tSim;
uniform vec4 win;
uniform mat4 uRM;
varying vec3 vW;
varying vec4 vRP;
varying float vFogD;
void main() {
#ifdef NEAR
  vec3 p = vec3(win.x + position.x * win.z, 0.0, win.y + position.z * win.z);
  vec2 su = position.xz + 0.5;
  float e = min(min(su.x, 1.0 - su.x), min(su.y, 1.0 - su.y));
  p.y += texture2D(tSim, su).r * smoothstep(0.0, 0.05, e);
#else
  vec3 p = position;
#endif
  vec4 worldPosition = modelMatrix * vec4(p, 1.0);
  vW = worldPosition.xyz;
  vec3 transformedNormal = normalMatrix * vec3(0.0, 1.0, 0.0);
  #include <shadowmap_vertex>
  vRP = uRM * worldPosition;
  vec4 mv = viewMatrix * worldPosition;
  vFogD = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FS = /* glsl */ `
#include <common>
#include <packing>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
uniform sampler2D tSim, tDet, tRefl, tPrevC, tPrevD;
uniform vec4 win;
uniform float uLevel, uTime, uAbs, uRough, uRefl, uScale;
uniform vec3 uDeep, uSkyHi, uSkyLo, uSun, uSunC, uAmb;
uniform vec4 uToon; // 色階開關、階數
uniform vec4 uDet;  // 細碎波紋的強度、開始淡掉的距離、完全淡掉的距離、泡沫強度
uniform mat4 uPrevVP;
uniform vec2 uCamNF;
${TER_GLSL}
varying vec3 vW;
varying vec4 vRP;
varying float vFogD;
#ifdef USE_FOG
uniform vec3 fogColor;
uniform float fogNear, fogFar;
#endif
vec3 tm(vec3 c) {
#ifdef TONE_MAPPING
  c = toneMapping(c);
#endif
  return linearToOutputTexel(vec4(c, 1.0)).rgb;
}
vec2 det(vec2 p) {
  vec2 a = texture2D(tDet, p * (0.021 / uScale) + uTime * vec2(0.011, 0.007)).rg * 2.0 - 1.0;
  vec2 b = texture2D(tDet, p * (0.047 / uScale) - uTime * vec2(0.013, -0.017)).rg * 2.0 - 1.0;
  return a * 0.6 + b * 0.4;
}
// 螢幕空間反射：沿反射方向往前走，投影到上一格的畫面，深度在後面就算打到
vec4 ssr(vec3 p, vec3 R) {
  float st = 1.5 * uScale;
  vec3 q = p;
  for (int i = 0; i < 26; i++) {
    q += R * st;
    st *= 1.14;
    vec4 c = uPrevVP * vec4(q, 1.0);
    if (c.w <= 0.0) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
    float vz = -perspectiveDepthToViewZ(texture2D(tPrevD, uv).x, uCamNF.x, uCamNF.y);
    float dz = c.w - vz;
    if (dz > 0.0 && dz < st * 2.5 + uScale) {
      vec2 e = min(uv, 1.0 - uv);
      float f = smoothstep(0.0, 0.08, min(e.x, e.y)) * (1.0 - float(i) / 26.0);
      return vec4(texture2D(tPrevC, uv).rgb, f);
    }
  }
  return vec4(0.0);
}
void main() {
  vec3 wp = vW;
  vec2 su = (wp.xz - win.xy) / max(win.z, 1e-3) + 0.5;
#ifdef FAR
  if (win.w > 0.5 && max(abs(su.x - 0.5), abs(su.y - 0.5)) < 0.5) discard;
#endif
  float inW = 0.0;
  vec4 sim = vec4(0.0);
#ifdef NEAR
  float e = min(min(su.x, 1.0 - su.x), min(su.y, 1.0 - su.y));
  inW = smoothstep(0.0, 0.05, e);
  sim = texture2D(tSim, su);
#endif
  float dist = length(cameraPosition - wp);
  vec3 V = (cameraPosition - wp) / dist;
  float dk = uDet.x * (1.0 - smoothstep(uDet.y, uDet.z, dist));
  vec2 dn = det(wp.xz) * dk;
  vec3 n = normalize(vec3(sim.b * inW * 2.5 + dn.x, 1.0, sim.a * inW * 2.5 + dn.y));
  float tk = uToon.x;
  float depth = max(0.0, uLevel + sim.r * inW - terH(wp.xz));
  if (!gl_FrontFacing) {
    // 水面下往上看：水色，視角斜的地方全反射（更暗的水色），正上方透出天空
    float c = max(dot(-n, V), 0.0);
    float win2 = smoothstep(0.55, 0.75, c);
    vec3 col = mix(uDeep * (uAmb + uSunC * 0.4), uSkyHi * 0.8, win2);
    gl_FragColor = vec4(tm(col), 0.92);
  } else {
    float T = exp(-uAbs * depth);
    if (tk > 0.5) T = floor(T * 3.0 + 0.5) / 3.0;
    float ndv = max(dot(n, V), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    F = mix(F, 0.06, uRough);
    if (tk > 0.5) F = F > 0.18 ? 0.55 : 0.08;
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    float sh = getShadowMask();
    vec3 sky = mix(uSkyLo, uSkyHi, smoothstep(0.0, 0.6, R.y));
    float sp = pow(max(dot(R, uSun), 0.0), mix(900.0, 40.0, uRough));
    if (tk > 0.5) sp = step(0.35, sp);
    vec3 spec = uSunC * sp * (1.0 - uRough) * 3.0 * sh;
    vec3 lit = uAmb + uSunC * (0.35 + 0.65 * sh) * max(uSun.y, 0.15);
    // 水色也照法線受光：波紋（模擬與細碎波紋）從正上方看也有明暗
    float lam = clamp(dot(n, uSun) / max(uSun.y, 0.2), 0.0, 2.0);
    float ld = 0.4 + 0.6 * lam;
    if (tk > 0.5) ld = ld > 1.08 ? 1.3 : (ld > 0.9 ? 1.0 : 0.72);
    vec3 body = uDeep * (uAmb + uSunC * (0.35 + 0.65 * sh) * max(uSun.y, 0.15) * ld);
    // 泡沫：岸邊（淺處）與波峰（模擬的速度大）
    float pat = texture2D(tDet, wp.xz * (0.09 / uScale) + uTime * vec2(0.02, 0.015)).b;
    float shore = 1.0 - smoothstep(0.0, 0.16 * uScale, depth);
    float crest = smoothstep(0.05, 0.16, abs(sim.g) * inW) + smoothstep(0.5, 1.2, sim.r * inW / uScale);
    float foam = clamp(shore + crest, 0.0, 1.0) * smoothstep(0.5, 0.68, pat + 0.2 * shore) * uDet.w;
    foam *= step(0.001, depth) * (1.0 - smoothstep(0.0, 0.25 * uScale, -sim.r * inW));
    if (tk > 0.5) foam = step(0.45, foam);
    // 正常混合：畫面上的地形 × T(1−F) ＋ 水的顏色
    float a = 1.0 - T * (1.0 - F);
    vec3 bodyC = tm(body) * (1.0 - T) * (1.0 - F);
    vec3 reflC = tm(sky);
    if (uRefl > 1.5) {
      vec4 rp = vRP;
      rp.xy += n.xz * 0.06 * rp.w;
      reflC = mix(reflC, texture2DProj(tRefl, rp).rgb, 1.0 - uRough);
    } else if (uRefl > 0.5 && uRough < 0.5) {
      vec4 r = ssr(wp, R);
      reflC = mix(reflC, r.rgb, r.a);
    }
    vec3 rgb = (bodyC + reflC * F + tm(spec)) / max(a, 0.02);
    vec3 fc = tm(lit * 0.9);
    rgb = mix(rgb, fc, foam);
    a = mix(a, 1.0, foam * 0.9);
    gl_FragColor = vec4(rgb, a);
  }
#ifdef USE_FOG
  float ff = smoothstep(fogNear, fogFar, vFogD);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, ff);
#endif
}
`;

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const NIL = (() => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

// 水面的 uniform（近處與遠處兩個材質共用同一份）
function waterUniforms(W, ter, scale) {
  const opac = Math.min(0.995, W.opacity || 0.8);
  return {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.lights),
    tSim: { value: NIL },
    tDet: { value: detailTex() },
    tRefl: { value: NIL },
    tPrevC: { value: NIL },
    tPrevD: { value: NIL },
    tTer: { value: ter.tex },
    terM: { value: ter.M.clone() },
    win: { value: new THREE.Vector4(0, 0, 0, 0) },
    uLevel: { value: W.level },
    uTime: { value: 0 },
    // 吸收：主題的不透明度越高越混濁（每公尺，4 m 深時透過率＝1－不透明度）
    uAbs: { value: -Math.log(1 - opac) / 4 },
    uRough: { value: Math.min(1, W.rough !== undefined ? W.rough : 0.08) },
    uRefl: { value: 0 },
    uScale: { value: scale },
    uDeep: { value: lin(W.color) },
    uSkyHi: { value: new THREE.Color(0.55, 0.65, 0.75) },
    uSkyLo: { value: new THREE.Color(0.7, 0.75, 0.8) },
    uSun: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    uSunC: { value: new THREE.Color(1, 1, 1) },
    uAmb: { value: new THREE.Color(0.35, 0.38, 0.42) },
    uToon: { value: new THREE.Vector4() },
    uDet: { value: new THREE.Vector4(0.35, 60 * scale, 220 * scale, 0.85) },
    uPrevVP: { value: new THREE.Matrix4() },
    uCamNF: { value: new THREE.Vector2(0.5, 1000) },
    uRM: { value: new THREE.Matrix4() },
  };
}

function waterMat(U, near) {
  const m = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: VS,
    fragmentShader: FS,
    defines: near ? { NEAR: '' } : { FAR: '' },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    lights: true,
  });
  return m;
}

// 還沒烘地形高度貼圖時：到處都很深
function flatTer() {
  const tex = new THREE.DataTexture(
    new Float32Array([-1e4, 0, 0, 1]),
    1,
    1,
    THREE.RGBAFormat,
    THREE.FloatType,
  );
  tex.needsUpdate = true;
  return { tex, M: new THREE.Vector4(0, 0, 1, 1), flat: true };
}

// W：主題的水面 { level, color, opacity, rough }；ext：遠處平面的邊長；scale：場景的尺度（DS）。
// 地形高度貼圖等水面系統接上時才烘（rebakeWater：地圖建好之後的地形才準）。
// 回傳群組（position.y＝水位；userData.water＝{ U, near, far, ter, W }）
export function buildWaterMesh(W, ext, scale) {
  const ter = flatTer();
  const U = waterUniforms(W, ter, scale);
  const g = new THREE.Group();
  const ng = new THREE.PlaneGeometry(1, 1, 255, 255);
  ng.rotateX(-Math.PI / 2);
  const near = new THREE.Mesh(ng, waterMat(U, true));
  near.visible = false;
  const fg = new THREE.PlaneGeometry(ext, ext);
  fg.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(fg, waterMat(U, false));
  for (const m of [near, far]) {
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.receiveShadow = true;
    m.userData.noAO = true;
    m.userData.noFade = true;
    m.raycast = () => {};
    g.add(m);
  }
  g.position.y = W.level;
  g.userData.noFade = true;
  g.userData.water = { U, near, far, ter, W };
  return g;
}

// 地形改了（關卡編輯器的筆刷）：重新烘地形高度貼圖
export function rebakeWater(g, w) {
  const d = g && g.userData.water;
  if (!d) return;
  d.ter.tex.dispose();
  d.ter = bakeTerrain(w);
  d.U.tTer.value = d.ter.tex;
  d.U.terM.value.copy(d.ter.M);
}

export function disposeWater(g) {
  const d = g && g.userData.water;
  if (!d) return;
  d.ter.tex.dispose();
  for (const m of [d.near, d.far]) {
    m.geometry.dispose();
    m.material.dispose();
  }
}
