// ============================================================
//  顯示卡粒子（docs/vfx-design.md）：參考 wawa-vfx（https://github.com/wass08/wawa-vfx，MIT，Wassim SAMAD）的做法——
//  粒子產生時把參數寫進實例緩衝區一次，之後每格只更新 uTime，位置、大小、透明度、顏色、旋轉都在頂點著色器裡依年齡算出來。
//  一個 GpuFx＝一種畫法（bill 面向鏡頭／stretch 沿速度或軸拉長／ground 平放在地面）＋一種混合模式，一次 draw call。
//  時間由擁有者傳入（Effects 的 fx.time：暫停時不前進），不用實際時間。只有外觀，亂數用 Math.random。
//  每顆粒子 28 個 float（交錯緩衝區）：
//    p (x, y, z, t0)  v (vx, vy, vz, life)  c0 (r, g, b, a)  c1 (r, g, b, occ)
//    s (size0, size1, rot0, rotSpeed)  m (gravity, drag, cell, fade)  d (axis x, y, z, aspect)
//  stretch：有 axis（不是 0）時沿 axis、長度＝|aspect|（公尺）；沒有時沿速度、長度＝size×|aspect|＋速度×uSpd（上限 uMaxL）。
//  aspect 是負的＝一端固定在粒子的位置（槍口火焰從槍口往外長），否則以粒子為中心。
//  fade：0 線性、1 平方、2 結尾才淡（1−t²）、3 淡入淡出、4 閃爍、5 先維持再淡出（t＞0.7）、6 淡入（蓄力：越接近中心越亮）。
//  混合一律是預乘透明度（ONE, ONE_MINUS_SRC_ALPHA）：輸出 (rgb·a, a·occ)，occ＝遮蔽度——0＝純加色（光、火花），
//  1＝一般混合（煙），中間＝發光但也蓋住背景（火球、火焰：在明亮的地面上也看得到）。同一個系統裡可以混著用。
// ============================================================
import { fxAtlasTex } from './atlas.js';

const STRIDE = 28;
const MODES = { bill: 0, stretch: 1, ground: 2 };
// 所有粒子系統共用的 uniform：圖集與渲染風格的色階（render/style 設定 fxStyle）
export const FXU = { uTex: { value: null }, uCel: { value: 0 } };
export function fxStyle(cel) {
  FXU.uCel.value = cel || 0;
}

const VS = /* glsl */ `
#define MODE ${'$'}{MODE}
uniform float uTime, uSpd, uMaxL;
attribute vec4 aP, aV, aC0, aC1, aS, aM, aD;
varying vec2 vUv;
varying vec4 vCol;
varying float vT, vCell, vA0, vFogD, vOcc;
void main() {
  float age = uTime - aP.w;
  float life = aV.w;
  float t = age / max(life, 1e-4);
  if (life <= 0.0 || t < 0.0 || t >= 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vCol = vec4(0.0);
    return;
  }
  float d = aM.y;
  float ed = exp(-d * age);
  vec3 lp = aP.xyz + (d > 1e-3 ? aV.xyz * (1.0 - ed) / d : aV.xyz * age);
  lp.y -= 0.5 * aM.x * age * age;
  // 粒子的座標是系統所在群組的座標（遊戲裡掛在場景＝單位矩陣；格納庫掛在場景的群組裡）
  vec3 wp = (modelMatrix * vec4(lp, 1.0)).xyz;
  mat3 mm = mat3(modelMatrix);
  vec3 vel = mm * (aV.xyz * ed - vec3(0.0, aM.x * age, 0.0));
  float sz = mix(aS.x, aS.y, t);
  float ang = aS.z + aS.w * age;
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * position.x - sa * position.y, sa * position.x + ca * position.y) * sz;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 off;
#if MODE == 0
  off = camR * q.x + camU * q.y;
#elif MODE == 1
  bool hasAx = dot(aD.xyz, aD.xyz) > 1e-8;
  vec3 ax = hasAx ? mm * aD.xyz : vel;
  float sp = length(vel);
  float asp = abs(aD.w);
  float len = hasAx ? asp : min(sz * asp + sp * uSpd, uMaxL + sz * asp);
  vec3 eye = normalize(cameraPosition - wp);
  vec3 dir = length(ax) > 1e-5 ? normalize(ax) : camU;
  vec3 up = dir - dot(dir, eye) * eye;
  up = length(up) > 1e-4 ? normalize(up) : camU;
  vec3 rt = normalize(cross(up, eye));
  float y = position.y + (aD.w < 0.0 ? 0.5 : 0.0);
  off = rt * position.x * sz + up * y * len;
#else
  off = vec3(q.x, 0.0, -q.y);
#endif
  vec4 mv = viewMatrix * vec4(wp + off, 1.0);
  gl_Position = projectionMatrix * mv;
  vFogD = -mv.z;
  float f = aM.w, fa;
  if (f < 0.5) fa = 1.0 - t;
  else if (f < 1.5) fa = (1.0 - t) * (1.0 - t);
  else if (f < 2.5) fa = 1.0 - t * t;
  else if (f < 3.5) fa = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.55, 1.0, t));
  else if (f < 4.5) fa = (1.0 - t) * (0.55 + 0.45 * sin(age * 38.0 + aP.x * 7.0 + aP.z * 3.0));
  else if (f < 5.5) fa = t < 0.7 ? 1.0 : (1.0 - t) / 0.3;
  else fa = smoothstep(0.0, 0.7, t) * (1.0 - smoothstep(0.9, 1.0, t));
  vCol = vec4(mix(aC0.rgb, aC1.rgb, t), aC0.a * fa);
  vA0 = aC0.a;
  vOcc = aC1.w;
  vT = t;
  vCell = aM.z;
  vUv = position.xy + 0.5;
}`;

const FS = /* glsl */ `
uniform sampler2D uTex;
uniform float uCel;
varying vec2 vUv;
varying vec4 vCol;
varying float vT, vCell, vA0, vFogD, vOcc;
#ifdef USE_FOG
uniform vec3 fogColor;
#ifdef FOG_EXP2
uniform float fogDensity;
#else
uniform float fogNear, fogFar;
#endif
#endif
void main() {
  float cell = floor(vCell + 0.5);
  float ch = floor(cell / 32.0);
  float c = cell - ch * 32.0;
  float col = mod(c, 8.0), row = floor(c / 8.0);
  vec2 uv = vec2((col + vUv.x) / 8.0, 1.0 - (row + 1.0 - vUv.y) / 4.0);
  vec3 tx = texture2D(uTex, uv).rgb;
  float m = ch < 0.5 ? tx.r : (ch < 1.5 ? tx.g : tx.b);
  vec3 rgb = vCol.rgb;
  float a = vCol.a * m;
  if (uCel > 0.0) {
    // 動畫的特效：透明度改成門檻（隨壽命升高＝溶解），顏色分 3 階、邊緣變硬
    float fade = vA0 > 0.0 ? vCol.a / vA0 : 0.0;
    // 起點 0.35：柔邊的閃光不會變成一大片實心的圓
    float th = 0.35 + 0.6 * (1.0 - fade);
    float hard = smoothstep(th - 0.03, th + 0.03, m);
    float tone = m > th + 0.4 ? 1.35 : (m > th + 0.15 ? 1.0 : 0.62);
    a = mix(a, min(vA0, 1.0) * hard * (0.7 + 0.3 * vOcc), uCel);
    rgb = mix(rgb, rgb * tone, uCel);
  }
  a = min(a, 1.0); // a＞1 的粒子＝加強貼圖（淡的貼圖也看得清楚）
  if (a < 0.004) discard;
#ifdef USE_FOG
#ifdef FOG_EXP2
  float ff = 1.0 - exp(-fogDensity * fogDensity * vFogD * vFogD);
#else
  float ff = smoothstep(fogNear, fogFar, vFogD);
#endif
  // 加色的部分被霧淡掉，遮蔽的部分混霧色
  rgb = rgb * (1.0 - ff) + fogColor * ff * vOcc;
#endif
  gl_FragColor = vec4(rgb * a, a * vOcc);
  #include <tonemapping_fragment>
  #include <encodings_fragment>
}`;

const _col = new THREE.Color();
const COLS = new Map();
function rgbOf(hex) {
  let c = COLS.get(hex);
  if (!c) {
    _col.setHex(hex); // r128 的 setHex 不做 sRGB 轉換（和 MeshBasicMaterial 的 color 相同）
    c = [_col.r, _col.g, _col.b];
    COLS.set(hex, c);
  }
  return c;
}
const MAX = 32768;

export class GpuFx {
  // o：{ mode: 'bill'|'stretch'|'ground', add: 預設的遮蔽度 0（true，預設）或 1, order: renderOrder, cap: 初始容量, spd, maxL,
  //      keepAlpha: 不改畫面的 alpha（格納庫：alpha 通道另有用途） }
  //  scene：掛上去的場景或群組
  constructor(scene, o = {}) {
    this.scene = scene;
    this.mode = MODES[o.mode || 'bill'];
    this.add = o.add !== false;
    this.time = 0;
    this.n = 0; // 寫過的最大格號＋1
    this.cur = 0; // 下一個寫入的格
    this.lo = Infinity;
    this.hi = -1;
    this.load = 0; // 最近產生的數量（指數衰減，約等於活著的粒子數；Effects 的減量用）
    if (!FXU.uTex.value) FXU.uTex.value = fxAtlasTex();
    const fogU = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        ...fogU,
        uTex: FXU.uTex,
        uCel: FXU.uCel,
        uTime: { value: 0 },
        uSpd: { value: o.spd || 0 },
        uMaxL: { value: o.maxL || 1e3 },
      },
      vertexShader: VS.replace('${MODE}', String(this.mode)),
      fragmentShader: FS,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: o.keepAlpha ? THREE.ZeroFactor : null,
      blendDstAlpha: o.keepAlpha ? THREE.OneFactor : null,
      side: THREE.DoubleSide,
    });
    this.order = o.order != null ? o.order : this.add ? 2 : 1;
    this.mesh = null;
    this.grow(o.cap || 1024);
  }
  get uniforms() {
    return this.mat.uniforms;
  }
  grow(cap) {
    const old = this.arr;
    this.cap = cap;
    this.arr = new Float32Array(cap * STRIDE);
    if (old) this.arr.set(old);
    const g = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    g.setIndex(quad.index);
    g.setAttribute('position', quad.attributes.position);
    const buf = new THREE.InstancedInterleavedBuffer(this.arr, STRIDE, 1).setUsage(THREE.DynamicDrawUsage);
    const names = ['aP', 'aV', 'aC0', 'aC1', 'aS', 'aM', 'aD'];
    names.forEach((nm, i) => g.setAttribute(nm, new THREE.InterleavedBufferAttribute(buf, 4, i * 4)));
    g.instanceCount = this.n;
    this.buf = buf;
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.geometry = g;
    } else {
      const m = new THREE.Mesh(g, this.mat);
      m.frustumCulled = false;
      m.renderOrder = this.order;
      m.userData.noFade = true; // 鏡頭遮擋的淡出不處理
      m.userData.noAO = true; // 不進 SSAO 的法線圖
      m.userData.fxGpu = true;
      this.scene.add(m);
      this.mesh = m;
    }
    this.lo = 0;
    this.hi = this.n - 1;
  }
  alive(i) {
    const a = this.arr,
      o = i * STRIDE;
    return a[o + 7] > 0 && this.time < a[o + 3] + a[o + 7];
  }
  // 產生一顆粒子。e：{ p, v?, life, s0, s1?, c0, c1?, k?, a?, occ?, cell, fade?, g?, drag?, rot?, rv?, axis?, asp?, delay? }
  //   p、v、axis 是 Vector3（或 {x,y,z}）；c0／c1 是 0xRRGGBB；s0／s1 是邊長（公尺）
  emit(e) {
    // 找格子：照順序重複使用死掉的格；下一格還活著時改用新的空間（不夠就加倍，到上限才覆蓋最舊的）
    let i = this.cur;
    if (i < this.n && this.alive(i)) {
      if (this.n < this.cap) i = this.n;
      else if (this.cap < MAX) {
        this.grow(this.cap * 2);
        i = this.n;
      }
    } else if (i >= this.cap) {
      if (this.cap < MAX) this.grow(this.cap * 2);
      else i = 0;
    }
    if (i + 1 > this.n) this.n = i + 1;
    const a = this.arr,
      o = i * STRIDE;
    const p = e.p,
      v = e.v,
      c0 = rgbOf(e.c0),
      c1 = e.c1 != null ? rgbOf(e.c1) : c0,
      k = e.k || 1; // 亮度倍率（＞1＝超過白色，後處理的光暈抓得到）
    a[o] = p.x;
    a[o + 1] = p.y;
    a[o + 2] = p.z;
    a[o + 3] = this.time + (e.delay || 0);
    a[o + 4] = v ? v.x : 0;
    a[o + 5] = v ? v.y : 0;
    a[o + 6] = v ? v.z : 0;
    a[o + 7] = e.life;
    a[o + 8] = c0[0] * k;
    a[o + 9] = c0[1] * k;
    a[o + 10] = c0[2] * k;
    a[o + 11] = e.a != null ? e.a : 1;
    a[o + 12] = c1[0] * k;
    a[o + 13] = c1[1] * k;
    a[o + 14] = c1[2] * k;
    a[o + 15] = e.occ != null ? e.occ : this.add ? 0 : 1;
    a[o + 16] = e.s0;
    a[o + 17] = e.s1 != null ? e.s1 : e.s0;
    a[o + 18] = e.rot || 0;
    a[o + 19] = e.rv || 0;
    a[o + 20] = e.g || 0;
    a[o + 21] = e.drag || 0;
    a[o + 22] = e.cell;
    a[o + 23] = e.fade || 0;
    const ax = e.axis;
    a[o + 24] = ax ? ax.x : 0;
    a[o + 25] = ax ? ax.y : 0;
    a[o + 26] = ax ? ax.z : 0;
    a[o + 27] = e.asp != null ? e.asp : 1;
    // 寫到目前用過的範圍的尾端時，第 0 格已經死掉就繞回去重複使用
    this.cur = i + 1 >= this.n && !this.alive(0) ? 0 : i + 1;
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    this.load += 1;
  }
  // 每格：時間（秒，擁有者的時鐘）與 dt（load 的衰減）
  update(time, dt = 0) {
    this.time = time;
    this.mat.uniforms.uTime.value = time;
    if (dt) this.load *= Math.exp(-dt / 0.6);
    if (this.hi >= this.lo) {
      const b = this.buf;
      b.updateRange.offset = this.lo * STRIDE;
      b.updateRange.count = (this.hi - this.lo + 1) * STRIDE;
      b.needsUpdate = true;
      this.mesh.geometry.instanceCount = this.n;
      this.lo = Infinity;
      this.hi = -1;
    }
    this.mesh.visible = this.n > 0;
  }
  // 時間往回平移（float 精度）：所有粒子的產生時間一起減 dt
  rebase(dt) {
    const a = this.arr;
    for (let i = 0; i < this.n; i++) a[i * STRIDE + 3] -= dt;
    this.lo = 0;
    this.hi = this.n - 1;
  }
  clear() {
    this.time = 0;
    this.mat.uniforms.uTime.value = 0;
    this.arr.fill(0);
    this.n = 0;
    this.cur = 0;
    this.load = 0;
    this.lo = Infinity;
    this.hi = -1;
    this.buf.needsUpdate = true;
    this.buf.updateRange.offset = 0;
    this.buf.updateRange.count = -1;
    this.mesh.geometry.instanceCount = 0;
    this.mesh.visible = false;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
