// 繪圖核心：在 UV 空間跑投影繪圖（每個貼圖像素都知道自己在 3D 的位置）。
// 貼圖組（TexSet）＝一張會被畫的貼圖，有自己的圖層堆疊（layers，最下面是「底圖」＝原貼圖）。
// 圖層的像素存成預乘 alpha 的 RenderTarget；stroke 是目前這一筆的覆蓋率（MAX 混合，避免筆刷點重疊變濃），
// 一筆結束才合進目前的圖層。comp 是所有圖層合成＋接縫外擴的結果，直接當材質的貼圖；mask 是 UV 覆蓋範圍。
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});
  const MAXD = 64; // 每次繪製最多幾個筆刷點（uniform 陣列長度）
  const HISTORY_MAX = 40;

  // 混合模式（值是 shader 裡的編號）
  const BLEND_MODES = [
    ['normal', '一般'],
    ['multiply', '色彩增值'],
    ['screen', '濾色'],
    ['overlay', '覆蓋'],
    ['softlight', '柔光'],
    ['hardlight', '實光'],
    ['dodge', '加亮顏色'],
    ['burn', '加深顏色'],
    ['darken', '變暗'],
    ['lighten', '變亮'],
    ['difference', '差異化'],
    ['exclusion', '排除'],
    ['add', '相加（線性加亮）'],
    ['subtract', '減去'],
    ['linearburn', '線性加深'],
    ['hue', '色相'],
    ['saturation', '飽和度'],
    ['color', '顏色'],
    ['luminosity', '明度'],
  ];
  const BLEND_INDEX = Object.fromEntries(BLEND_MODES.map(([k], i) => [k, i]));

  const UV_VERT = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNrm;
    varying vec2 vUv;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNrm = normalize(mat3(modelMatrix) * normal);
      vUv = uv;
      gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    }`;

  // 從相機看得到這個點嗎（深度＋朝向）；px 是畫面座標（左下原點，CSS px）
  const VIS_FN = /* glsl */ `
    #include <packing>
    uniform mat4 uVP;
    uniform vec2 uView;
    uniform sampler2D uDepth;
    uniform float uNear;
    uniform float uFar;
    uniform bool uOrtho;
    uniform vec3 uCam;
    uniform vec3 uCamDir;
    uniform bool uCull;
    uniform float uBias;
    float viewDist(float z) {
      return uOrtho ? -orthographicDepthToViewZ(z, uNear, uFar) : -perspectiveDepthToViewZ(z, uNear, uFar);
    }
    bool visibleAt(vec3 P, vec3 N, out vec2 px) {
      px = vec2(0.0);
      vec4 c = uVP * vec4(P, 1.0);
      if (c.w <= 0.0) return false;
      vec3 n = c.xyz / c.w;
      if (abs(n.x) >= 1.0 || abs(n.y) >= 1.0) return false;
      vec2 s = n.xy * 0.5 + 0.5;
      px = s * uView;
      float zs = viewDist(unpackRGBAToDepth(texture2D(uDepth, s)));
      float zm = viewDist(n.z * 0.5 + 0.5);
      if (zm > zs * 1.002 + uBias) return false;
      if (uCull) {
        vec3 V = uOrtho ? -uCamDir : normalize(uCam - P);
        if (dot(N, V) < 0.0) return false;
      }
      return true;
    }`;

  const PAINT_FRAG = /* glsl */ `
    ${VIS_FN}
    #define MAXD ${MAXD}
    uniform int uNS;            // 畫面筆刷點數量
    uniform vec4 uS[MAXD];      // x, y（畫面 px，左下原點；UV 模式是貼圖像素）, 半徑, alpha
    uniform int uNW;            // 球體筆刷點數量
    uniform vec4 uW[MAXD];      // 世界座標中心, 半徑
    uniform float uWA[MAXD];    // alpha
    uniform float uHard;
    uniform float uSR[MAXD];    // 畫面筆刷點的旋轉（弧度）
    uniform bool uUseTip;       // 用筆尖圖形（否則是圓形＋硬度）
    uniform sampler2D uTip;
    uniform float uGrainAmt;    // 紙紋強度（0＝不用）
    uniform float uGrainScale;
    uniform sampler2D uGrain;
    uniform bool uUVSpace;      // 在 UV 面板直接畫（不跨接縫）
    uniform vec2 uTexSize;
    varying vec3 vWorld;
    varying vec3 vNrm;
    varying vec2 vUv;

    float fall(float d) {
      if (d >= 1.0) return 0.0;
      return 1.0 - smoothstep(uHard, 1.0, d);
    }
    void main() {
      float a = 0.0;
      if (uNS > 0) {
        vec2 px;
        bool vis;
        if (uUVSpace) {
          px = vUv * uTexSize;
          vis = true;
        } else vis = visibleAt(vWorld, vNrm, px);
        if (vis) {
          for (int i = 0; i < MAXD; i++) {
            if (i >= uNS) break;
            vec4 d = uS[i];
            vec2 q = (px - d.xy) / d.z;
            float cov;
            if (uUseTip) {
              float c = cos(uSR[i]);
              float sn = sin(uSR[i]);
              vec2 r = vec2(c * q.x + sn * q.y, -sn * q.x + c * q.y);
              cov = abs(r.x) < 1.0 && abs(r.y) < 1.0 ? texture2D(uTip, r * 0.5 + 0.5).r : 0.0;
            } else cov = fall(length(q));
            a = max(a, cov * d.w);
          }
        }
      }
      for (int i = 0; i < MAXD; i++) {
        if (i >= uNW) break;
        vec4 d = uW[i];
        a = max(a, fall(length(vWorld - d.xyz) / d.w) * uWA[i]);
      }
      if (uGrainAmt > 0.0) a *= mix(1.0, texture2D(uGrain, vUv * uGrainScale).r, uGrainAmt);
      if (a <= 0.0) discard;
      gl_FragColor = vec4(a);
    }`;

  // 漸層：目前顏色 → 透明。畫面模式沿畫面上的 A→B（只畫看得到的面）；穿透模式沿 3D 的 A→B（所有面）
  const GRAD_FRAG = /* glsl */ `
    ${VIS_FN}
    uniform bool uGWorld;
    uniform vec3 uGA;
    uniform vec3 uGB;
    varying vec3 vWorld;
    varying vec3 vNrm;
    void main() {
      float t;
      if (uGWorld) {
        vec3 d = uGB - uGA;
        t = dot(vWorld - uGA, d) / max(dot(d, d), 1e-12);
      } else {
        vec2 px;
        if (!visibleAt(vWorld, vNrm, px)) discard;
        vec2 d = uGB.xy - uGA.xy;
        t = dot(px - uGA.xy, d) / max(dot(d, d), 1e-6);
      }
      float a = 1.0 - clamp(t, 0.0, 1.0);
      if (a <= 0.0) discard;
      gl_FragColor = vec4(a);
    }`;

  // 位置圖：每個貼圖像素的世界座標（UV 面板繪圖用來換算 3D 位置）
  const POS_FRAG = /* glsl */ `
    varying vec3 vWorld;
    void main() { gl_FragColor = vec4(vWorld, 1.0); }`;

  // 圖片貼紙：以表面上的一點 P 與法線 N 建立投影框（T 右、B 上、N 外），沿 −N 方向把圖片貼到框內的面上。
  // 和相機無關，貼上後旋轉視角也不會變。uMirror 是左右對稱用的鏡射：取鏡射點在框內的位置，另一側貼上鏡像的圖。
  const STAMP_FRAG = /* glsl */ `
    uniform sampler2D uImg;
    uniform vec3 uP;
    uniform vec3 uT;
    uniform vec3 uB;
    uniform vec3 uN;
    uniform vec2 uSize;
    uniform vec2 uDepth;        // 表面前方、後方的投影深度
    uniform bool uFlip;
    uniform mat4 uMirror;
    uniform bool uThrough;
    uniform bool uGraze;
    varying vec3 vWorld;
    varying vec3 vNrm;
    void main() {
      vec3 X = (uMirror * vec4(vWorld, 1.0)).xyz;
      vec3 Nx = normalize(mat3(uMirror) * vNrm);
      vec3 d = X - uP;
      vec3 l = vec3(dot(d, uT), dot(d, uB), dot(d, uN));
      if (l.z > uDepth.x || l.z < -uDepth.y) discard; // 前方只留一點容許量，擋在前面的其他零件不會被貼到
      vec2 iuv = l.xy / uSize + 0.5;
      if (iuv.x < 0.0 || iuv.y < 0.0 || iuv.x > 1.0 || iuv.y > 1.0) discard;
      if (uFlip) iuv.x = 1.0 - iuv.x;
      float fade = 1.0;
      if (!uThrough) {
        float f = dot(Nx, uN);
        if (f <= 0.0) discard; // 背對的面（薄板的另一面、另一側）不貼
        if (uGraze) fade = smoothstep(0.15, 0.45, f);
      }
      // 圖片以預乘 alpha 上傳：縮放取樣時透明像素裡的顏色（常常是白色）不會混進邊緣
      vec4 t = texture2D(uImg, iuv);
      vec3 c = t.a > 0.0 ? t.rgb / t.a : vec3(0.0);
      float a = t.a * fade;
      if (a <= 0.0) discard;
      gl_FragColor = vec4(c * a, a);
    }`;

  const QUAD_VERT = /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const COLOR_FN = /* glsl */ `
    vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 l2s(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;

  // 原圖 × 材質顏色 → 底圖（預乘 alpha）
  const BASE_FRAG = /* glsl */ `
    ${COLOR_FN}
    uniform sampler2D uMap;
    uniform bool uHasMap;
    uniform bool uMapSRGB;
    uniform vec3 uColor;
    varying vec2 vUv;
    void main() {
      vec4 t = uHasMap ? texture2D(uMap, vUv) : vec4(1.0);
      vec3 lin = (uMapSRGB ? s2l(t.rgb) : t.rgb) * uColor;
      gl_FragColor = vec4(l2s(lin) * t.a, t.a);
    }`;

  // 目前圖層＋這一筆
  const LAYER_FN = /* glsl */ `
    uniform sampler2D uLayer;
    uniform sampler2D uStroke;
    uniform bool uStrokeOn;
    uniform int uMode;          // 0 筆、1 橡皮擦、2 圖片（stroke 存預乘 RGBA）
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform bool uLockAlpha;    // 鎖定透明：只改顏色，不改 alpha
    vec4 layerAt(vec2 uv) {
      vec4 L0 = texture2D(uLayer, uv);
      vec4 L = L0;
      if (uStrokeOn) {
        if (uMode == 2) {
          vec4 S = texture2D(uStroke, uv) * uOpacity;
          L = S + L * (1.0 - S.a);
        } else {
          float s = texture2D(uStroke, uv).r * uOpacity;
          L = uMode == 1 ? L * (1.0 - s) : vec4(uColor * s, s) + L * (1.0 - s);
        }
        if (uLockAlpha) L = L.a > 0.0 ? vec4(L.rgb / L.a * L0.a, L0.a) : vec4(0.0);
      }
      return L;
    }`;

  const MERGE_FRAG = /* glsl */ `
    ${LAYER_FN}
    varying vec2 vUv;
    void main() { gl_FragColor = layerAt(vUv); }`;

  // 把一個圖層疊到累積結果上（都是預乘 alpha）。混合公式照 W3C Compositing：
  // Cr = (1 − αb)·Cs + αb·B(Cb, Cs)，再以來源 alpha 做 source-over。
  const BLEND_FRAG = /* glsl */ `
    ${LAYER_FN}
    uniform sampler2D uAcc;
    uniform int uBlend;
    uniform float uLayerOpacity;
    uniform bool uClip;
    uniform sampler2D uClipBase;
    uniform float uClipOpacity;
    varying vec2 vUv;

    float lum(vec3 c) { return dot(c, vec3(0.3, 0.59, 0.11)); }
    vec3 clipColor(vec3 c) {
      float l = lum(c);
      float n = min(min(c.r, c.g), c.b);
      float x = max(max(c.r, c.g), c.b);
      if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
      if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
      return c;
    }
    vec3 setLum(vec3 c, float l) { return clipColor(c + (l - lum(c))); }
    float sat(vec3 c) { return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b); }
    vec3 setSat(vec3 c, float s) {
      float mx = max(max(c.r, c.g), c.b);
      float mn = min(min(c.r, c.g), c.b);
      return mx > mn ? (c - mn) * s / (mx - mn) : vec3(0.0);
    }
    float softLight(float b, float s) {
      if (s <= 0.5) return b - (1.0 - 2.0 * s) * b * (1.0 - b);
      float d = b <= 0.25 ? ((16.0 * b - 12.0) * b + 4.0) * b : sqrt(b);
      return b + (2.0 * s - 1.0) * (d - b);
    }
    float hardLight(float b, float s) { return s <= 0.5 ? b * 2.0 * s : 1.0 - (1.0 - b) * (1.0 - (2.0 * s - 1.0)); }
    float dodge(float b, float s) { return b <= 0.0 ? 0.0 : (s >= 1.0 ? 1.0 : min(1.0, b / (1.0 - s))); }
    float burn(float b, float s) { return b >= 1.0 ? 1.0 : (s <= 0.0 ? 0.0 : 1.0 - min(1.0, (1.0 - b) / s)); }

    vec3 blendFn(vec3 b, vec3 s) {
      if (uBlend == 1) return b * s;
      if (uBlend == 2) return b + s - b * s;
      if (uBlend == 3) return vec3(hardLight(s.r, b.r), hardLight(s.g, b.g), hardLight(s.b, b.b));
      if (uBlend == 4) return vec3(softLight(b.r, s.r), softLight(b.g, s.g), softLight(b.b, s.b));
      if (uBlend == 5) return vec3(hardLight(b.r, s.r), hardLight(b.g, s.g), hardLight(b.b, s.b));
      if (uBlend == 6) return vec3(dodge(b.r, s.r), dodge(b.g, s.g), dodge(b.b, s.b));
      if (uBlend == 7) return vec3(burn(b.r, s.r), burn(b.g, s.g), burn(b.b, s.b));
      if (uBlend == 8) return min(b, s);
      if (uBlend == 9) return max(b, s);
      if (uBlend == 10) return abs(b - s);
      if (uBlend == 11) return b + s - 2.0 * b * s;
      if (uBlend == 12) return min(vec3(1.0), b + s);
      if (uBlend == 13) return max(vec3(0.0), b - s);
      if (uBlend == 14) return max(vec3(0.0), b + s - 1.0);
      if (uBlend == 15) return setLum(setSat(s, sat(b)), lum(b));
      if (uBlend == 16) return setLum(setSat(b, sat(s)), lum(b));
      if (uBlend == 17) return setLum(s, lum(b));
      if (uBlend == 18) return setLum(b, lum(s));
      return s;
    }

    void main() {
      vec4 D = texture2D(uAcc, vUv);
      vec4 S = layerAt(vUv) * uLayerOpacity;
      if (uClip) S *= texture2D(uClipBase, vUv).a * uClipOpacity;
      if (S.a <= 0.0) { gl_FragColor = D; return; }
      vec3 cs = S.rgb / S.a;
      vec3 cb = D.a > 0.0 ? D.rgb / D.a : vec3(0.0);
      vec3 mixed = (1.0 - D.a) * cs + D.a * clamp(blendFn(cb, cs), 0.0, 1.0);
      gl_FragColor = vec4(S.a * mixed + D.rgb * (1.0 - S.a), S.a + D.a * (1.0 - S.a));
    }`;

  // 最後一步：預乘 → 直接 alpha；UV 島外的像素往外找最近的島內像素（接縫外擴）
  const FINAL_FRAG = /* glsl */ `
    #define PAD 6
    uniform sampler2D uAcc;
    uniform sampler2D uMask;
    uniform vec2 uTexel;
    varying vec2 vUv;
    vec4 at(vec2 uv) {
      vec4 c = texture2D(uAcc, uv);
      return vec4(c.a > 0.0 ? c.rgb / c.a : vec3(0.0), c.a);
    }
    void main() {
      if (texture2D(uMask, vUv).r > 0.5) { gl_FragColor = at(vUv); return; }
      for (int r = 1; r <= PAD; r++) {
        for (int k = 0; k < 8; k++) {
          float ang = float(k) * 0.78539816;
          vec2 o = vec2(floor(cos(ang) * float(r) + 0.5), floor(sin(ang) * float(r) + 0.5)) * uTexel;
          if (texture2D(uMask, vUv + o).r > 0.5) { gl_FragColor = at(vUv + o); return; }
        }
      }
      gl_FragColor = at(vUv);
    }`;

  // 直接 alpha 的圖片 → 預乘的圖層
  const PREMUL_FRAG = /* glsl */ `
    uniform sampler2D uTex;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(uTex, vUv);
      gl_FragColor = vec4(c.rgb * c.a, c.a);
    }`;

  // AO：從一個方向看過去的深度圖，判斷每個貼圖像素有沒有被擋住。R 累加「看得到 × 權重」，G 累加權重
  const AO_FRAG = /* glsl */ `
    #include <packing>
    uniform mat4 uVP;
    uniform sampler2D uDepth;
    uniform vec3 uDir;
    uniform float uBias;
    varying vec3 vWorld;
    varying vec3 vNrm;
    void main() {
      vec3 N = normalize(vNrm);
      float w = dot(N, uDir);
      if (w <= 0.0) discard;
      vec4 c = uVP * vec4(vWorld + N * uBias, 1.0);
      vec3 n = c.xyz / c.w;
      float d = unpackRGBAToDepth(texture2D(uDepth, n.xy * 0.5 + 0.5));
      float vis = n.z * 0.5 + 0.5 <= d + 0.002 ? 1.0 : 0.0;
      gl_FragColor = vec4(vis * w, w, 0.0, 1.0);
    }`;

  const AO_FINAL_FRAG = /* glsl */ `
    uniform sampler2D uAcc;
    uniform sampler2D uMask;
    uniform float uStrength;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      float m = texture2D(uMask, vUv).r;
      vec4 a = texture2D(uAcc, vUv);
      float ao = a.g > 0.0 ? clamp(a.r / a.g, 0.0, 1.0) : 1.0;
      ao = pow(ao, uContrast);
      float v = mix(1.0, ao, uStrength);
      gl_FragColor = vec4(vec3(v) * m, m);
    }`;

  const COPY_FRAG = /* glsl */ `
    uniform sampler2D uTex;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(uTex, vUv); }`;

  function makeRT(w, h, mips) {
    return new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      generateMipmaps: !!mips,
    });
  }

  // 三角形的 UV 島編號（union-find；UV 座標相同的頂點視為相連，所以法線分開的頂點也會連在一起）
  function computeIslands(p) {
    const g = p.mesh.geometry;
    const idx = g.index;
    const uv = g.attributes.uv;
    const n = Math.floor(p.count / 3);
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const first = new Map();
    for (let t = 0; t < n; t++)
      for (let k = 0; k < 3; k++) {
        const b = p.start + t * 3 + k;
        const vi = idx ? idx.getX(b) : b;
        const key = (Math.round(uv.getX(vi) * 1e5) + 1e6) * 1e7 + (Math.round(uv.getY(vi) * 1e5) + 1e6);
        const f = first.get(key);
        if (f === undefined) first.set(key, t);
        else {
          const a = find(f);
          const c = find(t);
          if (a !== c) parent[a] = c;
        }
      }
    const out = new Int32Array(n);
    for (let t = 0; t < n; t++) out[t] = find(t);
    return out;
  }

  function pointInTri(px, py, ax, ay, bx, by, cx, cy) {
    const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
    const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
    const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  }

  const LAYER_PROPS = ['name', 'visible', 'opacity', 'blend', 'lockAlpha', 'clip'];
  let layerSeq = 0;

  class Layer {
    constructor(rt, name) {
      this.uid = ++layerSeq;
      this.rt = rt;
      this.name = name;
      this.visible = true;
      this.opacity = 1;
      this.blend = 'normal';
      this.lockAlpha = false;
      this.clip = false;
    }
    props() {
      const o = {};
      for (const k of LAYER_PROPS) o[k] = this[k];
      return o;
    }
  }

  class TexSet {
    constructor(painter, id, name, w, h) {
      this.painter = painter;
      this.id = id;
      this.name = name;
      this.w = w;
      this.h = h;
      this.parts = []; // { mesh, start, count, proxy }
      this.materials = [];
      this.srcMap = null;
      this.srcColor = new THREE.Color(1, 1, 1);
      this.scene = new THREE.Scene();
      this.scene.autoUpdate = false; // proxy 的 matrixWorld 直接複製原網格的
      this.box = new THREE.Box3();
      this.layers = [];
      this.active = 0;
      this.dirty = true;
      this.strokeActive = false;
      this.screenRect = null;
      this.triCount = 0;
    }

    get activeLayer() {
      return this.layers[this.active];
    }

    addPart(mesh, start, count) {
      const src = mesh.geometry;
      const g = new THREE.BufferGeometry();
      if (src.index) g.setIndex(src.index);
      g.setAttribute('position', src.attributes.position);
      g.setAttribute('normal', src.attributes.normal);
      g.setAttribute('uv', src.attributes.uv);
      g.setDrawRange(start, count);
      const proxy = new THREE.Mesh(g, this.painter.paintMat);
      proxy.frustumCulled = false;
      proxy.matrixAutoUpdate = false;
      this.scene.add(proxy);
      this.parts.push({ mesh, start, count, proxy });
      this.triCount += Math.floor(count / 3);
    }

    // 同步網格的位置；隱藏的網格不畫
    syncMatrices() {
      this.box.makeEmpty();
      for (const p of this.parts) {
        p.mesh.updateWorldMatrix(true, false);
        p.proxy.matrixWorld.copy(p.mesh.matrixWorld);
        let vis = true;
        for (let o = p.mesh; o; o = o.parent) if (!o.visible) vis = false;
        p.proxy.visible = vis;
        if (!vis) continue;
        if (!p.mesh.geometry.boundingBox) p.mesh.geometry.computeBoundingBox();
        this.box.union(p.mesh.geometry.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld));
      }
    }

    init() {
      const P = this.painter;
      const base = P.newLayerRT(this);
      this.stroke = makeRT(this.w, this.h);
      this.mask = makeRT(this.w, this.h);
      this.accA = makeRT(this.w, this.h);
      this.accB = makeRT(this.w, this.h);
      this.comp = makeRT(this.w, this.h, true);
      const t = this.comp.texture;
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = Math.min(8, P.renderer.capabilities.getMaxAnisotropy());
      if (this.srcMap) {
        t.wrapS = this.srcMap.wrapS;
        t.wrapT = this.srcMap.wrapT;
      }
      // 底圖
      const bm = P.baseMat;
      bm.uniforms.uHasMap.value = !!this.srcMap;
      bm.uniforms.uMap.value = this.srcMap;
      bm.uniforms.uMapSRGB.value = !!this.srcMap && this.srcMap.encoding === THREE.sRGBEncoding;
      bm.uniforms.uColor.value.copy(this.srcColor);
      P.quad(bm, base);
      P.clear(this.stroke);
      this.layers = [new Layer(base, '底圖'), new Layer(P.newLayerRT(this, true), '圖層 1')];
      this.active = 1;
      // UV 覆蓋範圍
      this.scene.overrideMaterial = P.maskMat;
      P.clear(this.mask);
      P.renderer.setRenderTarget(this.mask);
      P.renderer.autoClear = false;
      P.renderer.render(this.scene, P.uvCam);
      P.renderer.autoClear = true;
      this.scene.overrideMaterial = null;
      for (const m of this.materials) {
        m.map = this.comp.texture;
        m.color.setRGB(1, 1, 1);
        m.needsUpdate = true;
      }
      this.dirty = true;
    }

    dispose() {
      for (const k of ['stroke', 'mask', 'accA', 'accB', 'comp']) this[k] && this[k].dispose();
      for (const p of this.parts) p.proxy.geometry.dispose();
    }
  }

  class Painter {
    constructor(renderer) {
      this.renderer = renderer;
      this.sets = [];
      this.matSet = new Map(); // material → TexSet
      this.undoStack = [];
      this.redoStack = [];
      this.layerRTs = new Set(); // 所有圖層像素的 RenderTarget（沒人用時回收）
      this.uvCam = new THREE.Camera();
      this.quadScene = new THREE.Scene();
      this.quadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
      this.quadMesh.frustumCulled = false;
      this.quadScene.add(this.quadMesh);

      const sArr = [];
      const wArr = [];
      const waArr = [];
      for (let i = 0; i < MAXD; i++) {
        sArr.push(new THREE.Vector4());
        wArr.push(new THREE.Vector4());
        waArr.push(0);
      }
      const quadMat = (frag, uniforms) =>
        new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
      this.paintMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: PAINT_FRAG,
        uniforms: {
          uNS: { value: 0 },
          uS: { value: sArr },
          uNW: { value: 0 },
          uW: { value: wArr },
          uWA: { value: waArr },
          uHard: { value: 0.5 },
          uVP: { value: new THREE.Matrix4() },
          uView: { value: new THREE.Vector2(1, 1) },
          uDepth: { value: null },
          uNear: { value: 0.1 },
          uFar: { value: 100 },
          uOrtho: { value: false },
          uCam: { value: new THREE.Vector3() },
          uCamDir: { value: new THREE.Vector3() },
          uCull: { value: true },
          uBias: { value: 0.001 },
          uUVSpace: { value: false },
          uTexSize: { value: new THREE.Vector2(1, 1) },
          uSR: { value: new Array(MAXD).fill(0) },
          uUseTip: { value: false },
          uTip: { value: null },
          uGrainAmt: { value: 0 },
          uGrainScale: { value: 8 },
          uGrain: { value: null },
        },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      this.maskMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }',
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      this.baseMat = quadMat(BASE_FRAG, {
        uMap: { value: null },
        uHasMap: { value: false },
        uMapSRGB: { value: true },
        uColor: { value: new THREE.Color() },
      });
      const layerUniforms = () => ({
        uLayer: { value: null },
        uStroke: { value: null },
        uStrokeOn: { value: false },
        uMode: { value: 0 },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
        uLockAlpha: { value: false },
      });
      this.mergeMat = quadMat(MERGE_FRAG, layerUniforms());
      this.blendMat = quadMat(
        BLEND_FRAG,
        Object.assign(layerUniforms(), {
          uAcc: { value: null },
          uBlend: { value: 0 },
          uLayerOpacity: { value: 1 },
          uClip: { value: false },
          uClipBase: { value: null },
          uClipOpacity: { value: 1 },
        }),
      );
      this.finalMat = quadMat(FINAL_FRAG, {
        uAcc: { value: null },
        uMask: { value: null },
        uTexel: { value: new THREE.Vector2() },
      });
      this.copyMat = quadMat(COPY_FRAG, { uTex: { value: null } });
      this.premulMat = quadMat(PREMUL_FRAG, { uTex: { value: null } });
      this.aoMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: AO_FRAG,
        uniforms: {
          uVP: { value: new THREE.Matrix4() },
          uDepth: { value: null },
          uDir: { value: new THREE.Vector3() },
          uBias: { value: 0.001 },
        },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      this.aoFinalMat = quadMat(AO_FINAL_FRAG, {
        uAcc: { value: null },
        uMask: { value: null },
        uStrength: { value: 1 },
        uContrast: { value: 1 },
      });
      this.stampMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: STAMP_FRAG,
        uniforms: {
          uImg: { value: null },
          uP: { value: new THREE.Vector3() },
          uT: { value: new THREE.Vector3(1, 0, 0) },
          uB: { value: new THREE.Vector3(0, 1, 0) },
          uN: { value: new THREE.Vector3(0, 0, 1) },
          uSize: { value: new THREE.Vector2(1, 1) },
          uDepth: { value: new THREE.Vector2(0.1, 1) },
          uFlip: { value: false },
          uMirror: { value: new THREE.Matrix4() },
          uThrough: { value: false },
          uGraze: { value: true },
        },
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      });
      // 漸層：可見性相關的 uniform 和筆共用同一個物件（beginStroke 設定一次即可）
      const pu = this.paintMat.uniforms;
      const vis = {};
      for (const k of ['uVP', 'uView', 'uDepth', 'uNear', 'uFar', 'uOrtho', 'uCam', 'uCamDir', 'uCull', 'uBias']) vis[k] = pu[k];
      this.gradMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: GRAD_FRAG,
        uniforms: Object.assign(vis, {
          uGWorld: { value: false },
          uGA: { value: new THREE.Vector3() },
          uGB: { value: new THREE.Vector3() },
        }),
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      this.posMat = new THREE.ShaderMaterial({
        vertexShader: UV_VERT,
        fragmentShader: POS_FRAG,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      this.depthRT = null;
      this.depthBuf = null;
      this.brush = { color: new THREE.Color(1, 0, 0), opacity: 1, hardness: 0.5, erase: false, mode: 'paint' };
      this.stroke = null;
    }

    // ---------- 共用小工具 ----------
    quad(mat, target) {
      this.quadMesh.material = mat;
      this.renderer.setRenderTarget(target);
      this.renderer.render(this.quadScene, this.uvCam);
    }
    clear(target) {
      const r = this.renderer;
      const prev = r.getClearColor(new THREE.Color());
      const prevA = r.getClearAlpha();
      r.setRenderTarget(target);
      r.setClearColor(0x000000, 0);
      r.clear(true, false, false);
      r.setClearColor(prev, prevA);
    }
    newLayerRT(s, cleared) {
      const rt = makeRT(s.w, s.h);
      this.layerRTs.add(rt);
      if (cleared) this.clear(rt);
      return rt;
    }
    copyRT(s, src) {
      const rt = this.newLayerRT(s);
      this.copyMat.uniforms.uTex.value = src.texture;
      this.quad(this.copyMat, rt);
      return rt;
    }

    // ---------- 載入 ----------
    build(root, opts) {
      this.dispose();
      const defaultSize = (opts && opts.defaultSize) || 1024;
      const maxSize = Math.min(4096, this.renderer.capabilities.maxTextureSize);
      const byKey = new Map();
      const warnings = [];
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        if (!o.isMesh) return;
        if (o.isSkinnedMesh) warnings.push(`「${o.name || '網格'}」是蒙皮網格，以靜止姿勢繪製`);
        const g = o.geometry;
        if (!g.attributes.uv) {
          warnings.push(`「${o.name || '網格'}」沒有 UV，不能畫`);
          return;
        }
        if (!g.attributes.normal) g.computeVertexNormals();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const total = g.index ? g.index.count : g.attributes.position.count;
        const groups = Array.isArray(o.material) && g.groups.length ? g.groups : [{ start: 0, count: total, materialIndex: 0 }];
        for (const gr of groups) {
          const m = mats[gr.materialIndex];
          if (!m || !m.color) continue;
          const key = m.map && m.map.image ? m.map.image : m;
          let set = byKey.get(key);
          if (!set) {
            let w = defaultSize;
            let h = defaultSize;
            if (m.map && m.map.image) {
              w = m.map.image.width || defaultSize;
              h = m.map.image.height || defaultSize;
              const s = Math.min(1, maxSize / Math.max(w, h));
              w = Math.max(32, Math.round(w * s));
              h = Math.max(32, Math.round(h * s));
              const t = m.map;
              if (t.offset.x || t.offset.y || t.repeat.x !== 1 || t.repeat.y !== 1 || t.rotation)
                warnings.push(`材質「${m.name}」有貼圖變換，繪製位置可能不準`);
            }
            set = new TexSet(this, this.sets.length, m.name || `材質 ${this.sets.length + 1}`, w, h);
            set.srcMap = m.map || null;
            set.srcColor.copy(m.color);
            byKey.set(key, set);
            this.sets.push(set);
          }
          if (!set.materials.includes(m)) set.materials.push(m);
          this.matSet.set(m, set);
          set.addPart(o, gr.start, Math.min(gr.count, total - gr.start));
        }
      });
      for (const s of this.sets) {
        s.syncMatrices();
        s.init();
      }
      this.renderer.setRenderTarget(null);
      return warnings;
    }

    dispose() {
      for (const s of this.sets) s.dispose();
      this.sets = [];
      this.matSet.clear();
      this.undoStack = [];
      this.redoStack = [];
      for (const rt of this.layerRTs) rt.dispose();
      this.layerRTs.clear();
    }

    // ---------- 一筆 ----------
    // view: { camera, scene, w, h, hide: [Object3D], modelSize }
    beginStroke(view, brush) {
      const r = this.renderer;
      const cam = view.camera;
      const w = Math.max(1, Math.round(view.w));
      const h = Math.max(1, Math.round(view.h));
      if (!this.depthRT || this.depthRT.width !== w || this.depthRT.height !== h) {
        if (this.depthRT) this.depthRT.dispose();
        this.depthRT = new THREE.WebGLRenderTarget(w, h, {
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: true,
        });
        this.depthBuf = new Uint8Array(w * h * 4);
      }
      // 相機深度（打包成 RGBA）：GPU 判斷可見性，CPU 用來把畫面座標換成 3D 位置
      const hidden = [];
      for (const o of view.hide || []) {
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      }
      const prevBg = view.scene.background;
      view.scene.background = null;
      view.scene.overrideMaterial = this.depthMat;
      const prevC = r.getClearColor(new THREE.Color());
      const prevA = r.getClearAlpha();
      r.setClearColor(0xffffff, 1);
      r.setRenderTarget(this.depthRT);
      r.clear(true, true, false);
      r.render(view.scene, cam);
      r.setClearColor(prevC, prevA);
      view.scene.overrideMaterial = null;
      view.scene.background = prevBg;
      for (const o of hidden) o.visible = true;
      r.readRenderTargetPixels(this.depthRT, 0, 0, w, h, this.depthBuf);
      r.setRenderTarget(null);

      cam.updateMatrixWorld();
      const u = this.paintMat.uniforms;
      u.uVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      u.uView.value.set(w, h);
      u.uDepth.value = this.depthRT.texture;
      u.uNear.value = cam.near;
      u.uFar.value = cam.far;
      u.uOrtho.value = !!cam.isOrthographicCamera;
      u.uCam.value.setFromMatrixPosition(cam.matrixWorld);
      cam.getWorldDirection(u.uCamDir.value);
      u.uHard.value = Math.min(0.98, Math.max(0, brush.hardness));
      u.uCull.value = !brush.backfaces;
      u.uBias.value = (view.modelSize || 1) * 0.002;
      u.uUVSpace.value = false;

      this.setBrush(brush);
      this.applyTip(brush);
      this.stroke = { view: { camera: cam, w, h }, touched: new Set() };
      // 每組貼圖在畫面上的範圍（判斷筆刷點有沒有碰到）
      const v = new THREE.Vector3();
      for (const s of this.sets) {
        s.syncMatrices();
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        let behind = false;
        for (let i = 0; i < 8; i++) {
          v.set(i & 1 ? s.box.max.x : s.box.min.x, i & 2 ? s.box.max.y : s.box.min.y, i & 4 ? s.box.max.z : s.box.min.z);
          v.applyMatrix4(cam.matrixWorldInverse);
          if (-v.z <= 0 && !cam.isOrthographicCamera) behind = true;
          v.applyMatrix4(cam.projectionMatrix);
          x0 = Math.min(x0, (v.x * 0.5 + 0.5) * w);
          x1 = Math.max(x1, (v.x * 0.5 + 0.5) * w);
          y0 = Math.min(y0, (v.y * 0.5 + 0.5) * h);
          y1 = Math.max(y1, (v.y * 0.5 + 0.5) * h);
        }
        s.screenRect = s.box.isEmpty() ? { x0: 1, y0: 1, x1: -1, y1: -1 } : behind ? null : { x0, y0, x1, y1 };
      }
    }

    // 筆尖與紙紋（beginStroke／beginUVStroke 時套用）
    applyTip(brush) {
      const u = this.paintMat.uniforms;
      u.uUseTip.value = !!brush.tip;
      u.uTip.value = brush.tip || null;
      u.uGrainAmt.value = brush.grain ? brush.grainAmt || 0 : 0;
      u.uGrain.value = brush.grain || null;
      u.uGrainScale.value = brush.grainScale || 8;
    }

    setBrush(brush) {
      Object.assign(this.brush, brush);
      this.brush.color = new THREE.Color(brush.color || '#000000');
      this.brush.mode = brush.mode || 'paint';
    }

    // 畫面座標（左上原點，CSS px）→ 3D 位置與每像素的世界長度；沒打到模型回傳 null
    pickWorld(x, y) {
      if (!this.stroke || !this.stroke.view) return null;
      const { camera: cam, w, h } = this.stroke.view;
      const px = Math.floor(x);
      const py = h - 1 - Math.floor(y);
      if (px < 0 || py < 0 || px >= w || py >= h) return null;
      const i = (py * w + px) * 4;
      const b = this.depthBuf;
      const d = (255 / 256) * (b[i] / 255 / 16777216 + b[i + 1] / 255 / 65536 + b[i + 2] / 255 / 256 + b[i + 3] / 255);
      if (d >= 0.99999) return null;
      const p = new THREE.Vector3(((px + 0.5) / w) * 2 - 1, ((py + 0.5) / h) * 2 - 1, d * 2 - 1).unproject(cam);
      let perPx;
      if (cam.isOrthographicCamera) perPx = (cam.top - cam.bottom) / cam.zoom / h;
      else {
        const dist = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
        perPx = (2 * dist * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / cam.zoom / h;
      }
      return { p, perPx };
    }

    touch(s) {
      if (s.strokeActive) return;
      this.clear(s.stroke);
      s.strokeActive = true;
      this.stroke.touched.add(s);
    }

    // dabs: [{ type: 's', x, y, r, a } | { type: 'w', p: Vector3, r, a }]（s 的 x, y 是左下原點）
    paintDabs(dabs) {
      if (!this.stroke || !dabs.length) return;
      const u = this.paintMat.uniforms;
      for (let off = 0; off < dabs.length; off += MAXD) {
        const batch = dabs.slice(off, off + MAXD);
        let ns = 0;
        let nw = 0;
        for (const d of batch) {
          if (d.type === 's') {
            u.uSR.value[ns] = d.rot || 0;
            u.uS.value[ns++].set(d.x, d.y, d.r, d.a);
          }
          else {
            u.uW.value[nw].set(d.p.x, d.p.y, d.p.z, d.r);
            u.uWA.value[nw++] = d.a;
          }
        }
        u.uNS.value = ns;
        u.uNW.value = nw;
        const only = this.stroke.only;
        for (const s of this.sets) {
          if (only ? s !== only : !this.batchHits(s, batch)) continue;
          this.touch(s);
          this.renderer.setRenderTarget(s.stroke);
          this.renderer.autoClear = false; // 筆畫緩衝要累積，不能清掉
          this.renderer.render(s.scene, this.uvCam);
          this.renderer.autoClear = true;
          s.dirty = true;
        }
      }
      this.renderer.setRenderTarget(null);
    }

    // ---------- UV 面板繪圖 ----------
    // connected：跨接縫連續（把 UV 位置換成 3D 位置，用球體筆刷）；否則直接在貼圖平面上畫（只限這組）
    beginUVStroke(s, brush, connected) {
      this.cancelStroke();
      this.setBrush(brush);
      const u = this.paintMat.uniforms;
      u.uHard.value = Math.min(0.98, Math.max(0, brush.hardness));
      u.uUVSpace.value = !connected;
      u.uTexSize.value.set(s.w, s.h);
      this.applyTip(brush);
      s.syncMatrices();
      this.stroke = { view: null, touched: new Set(), only: s };
    }

    // 位置圖（最多 1024 邊長，讀回 CPU 一次後快取）；不支援浮點貼圖時回傳 null
    posMap(s) {
      if (s.pos !== undefined) return s.pos;
      s.pos = null;
      const r = this.renderer;
      if (!r.capabilities.isWebGL2 || !r.extensions.get('EXT_color_buffer_float')) return null;
      const k = Math.min(1, 1024 / Math.max(s.w, s.h));
      const w = Math.max(1, Math.round(s.w * k));
      const h = Math.max(1, Math.round(s.h * k));
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.FloatType,
        format: THREE.RGBAFormat,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
      s.syncMatrices();
      this.clear(rt);
      s.scene.overrideMaterial = this.posMat;
      r.setRenderTarget(rt);
      r.autoClear = false;
      r.render(s.scene, this.uvCam);
      r.autoClear = true;
      s.scene.overrideMaterial = null;
      const data = new Float32Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, data);
      r.setRenderTarget(null);
      rt.dispose();
      s.pos = { w, h, data };
      return s.pos;
    }

    // UV → 3D 位置（剛好在島外時，往附近兩個像素內找）
    posAt(s, u, v) {
      const pm = this.posMap(s);
      if (!pm) return null;
      const x0 = Math.floor(u * pm.w);
      const y0 = Math.floor(v * pm.h);
      for (let r = 0; r <= 2; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = x0 + dx;
            const y = y0 + dy;
            if (x < 0 || y < 0 || x >= pm.w || y >= pm.h) continue;
            const i = (y * pm.w + x) * 4;
            if (pm.data[i + 3] > 0.5) return new THREE.Vector3(pm.data[i], pm.data[i + 1], pm.data[i + 2]);
          }
      return null;
    }

    // UV 一單位對應的世界長度（取附近最小的，避免跨到別的島）
    worldPerUV(s, u, v) {
      const pm = this.posMap(s);
      const P = this.posAt(s, u, v);
      if (!P) return null;
      const d = 3 / Math.max(pm.w, pm.h);
      let best = Infinity;
      for (const [du, dv] of [
        [d, 0],
        [-d, 0],
        [0, d],
        [0, -d],
      ]) {
        const Q = this.posAt(s, u + du, v + dv);
        if (!Q) continue;
        const l = Q.distanceTo(P);
        if (l > 1e-9) best = Math.min(best, l / d);
      }
      return isFinite(best) ? best : null;
    }

    // ---------- 填色 ----------
    // region：{ part, indices }（要填的三角形），null＝整組
    fill(s, brush, region) {
      this.cancelStroke();
      this.setBrush(brush);
      this.stroke = { view: null, touched: new Set() };
      s.syncMatrices();
      this.touch(s);
      const r = this.renderer;
      r.setRenderTarget(s.stroke);
      r.autoClear = false;
      if (!region) {
        s.scene.overrideMaterial = this.maskMat;
        r.render(s.scene, this.uvCam);
        s.scene.overrideMaterial = null;
      } else {
        const src = region.part.proxy;
        const g = new THREE.BufferGeometry();
        g.setIndex(region.indices);
        for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, src.geometry.attributes[k]);
        const m = new THREE.Mesh(g, this.maskMat);
        m.frustumCulled = false;
        m.matrixAutoUpdate = false;
        m.matrixWorld.copy(src.matrixWorld);
        const sc = new THREE.Scene();
        sc.autoUpdate = false;
        sc.add(m);
        r.render(sc, this.uvCam);
        g.dispose();
      }
      r.autoClear = true;
      r.setRenderTarget(null);
      s.dirty = true;
      this.endStroke();
    }

    // 三角形所在的 UV 島（同一個網格片段內，UV 座標相同的頂點視為相連）
    island(s, mesh, faceIndex) {
      const p = s.parts.find((q) => q.mesh === mesh && faceIndex * 3 >= q.start && faceIndex * 3 < q.start + q.count);
      if (!p) return null;
      return this.islandOf(p, faceIndex - p.start / 3);
    }
    islandOf(p, t) {
      if (!p.islands) p.islands = computeIslands(p);
      const id = p.islands[t];
      const idx = p.mesh.geometry.index;
      const out = [];
      for (let i = 0; i < p.islands.length; i++) {
        if (p.islands[i] !== id) continue;
        const b = p.start + i * 3;
        for (let k = 0; k < 3; k++) out.push(idx ? idx.getX(b + k) : b + k);
      }
      return { part: p, indices: out };
    }
    // UV 面板上點到的島
    islandAtUV(s, u, v) {
      for (const p of s.parts) {
        const g = p.mesh.geometry;
        const idx = g.index;
        const uv = g.attributes.uv;
        const n = Math.floor(p.count / 3);
        for (let t = 0; t < n; t++) {
          const b = p.start + t * 3;
          const ia = idx ? idx.getX(b) : b;
          const ib = idx ? idx.getX(b + 1) : b + 1;
          const ic = idx ? idx.getX(b + 2) : b + 2;
          if (pointInTri(u, v, uv.getX(ia), uv.getY(ia), uv.getX(ib), uv.getY(ib), uv.getX(ic), uv.getY(ic)))
            return this.islandOf(p, t);
        }
      }
      return null;
    }

    // ---------- 漸層 ----------
    // beginStroke 之後呼叫，可以重複呼叫更新預覽；a, b：畫面 px（左下原點，放在 x, y）或世界座標；only：只畫這組
    gradient(a, b, world, only) {
      if (!this.stroke) return;
      const u = this.gradMat.uniforms;
      u.uGWorld.value = !!world;
      u.uGA.value.copy(a);
      u.uGB.value.copy(b);
      const r = this.renderer;
      for (const s of this.sets) {
        if (s.box.isEmpty() || (only && s !== only)) continue;
        this.touch(s);
        this.clear(s.stroke);
        s.scene.overrideMaterial = this.gradMat;
        r.setRenderTarget(s.stroke);
        r.autoClear = false;
        r.render(s.scene, this.uvCam);
        r.autoClear = true;
        s.scene.overrideMaterial = null;
        s.dirty = true;
      }
      r.setRenderTarget(null);
    }

    batchHits(s, batch) {
      if (s.box.isEmpty()) return false;
      for (const d of batch) {
        if (d.type === 's') {
          const R = s.screenRect;
          if (!R) return true;
          if (d.x + d.r >= R.x0 && d.x - d.r <= R.x1 && d.y + d.r >= R.y0 && d.y - d.r <= R.y1) return true;
        } else if (s.box.distanceToPoint(d.p) <= d.r) return true;
      }
      return false;
    }

    // 圖片貼紙的預覽：貼到各組的 stroke 緩衝（還沒寫進圖層），endStroke 確定、cancelStroke 取消。
    // d: { P, T, B, N（世界座標，T/B/N 單位向量）, w, h（世界長度）, flip, opacity, through, graze, sym, mirrorX }
    previewImage(tex, d) {
      this.cancelStroke();
      Object.assign(this.brush, { opacity: d.opacity, erase: false, mode: 'image' });
      this.stroke = { view: null, touched: new Set() };
      const u = this.stampMat.uniforms;
      u.uImg.value = tex;
      u.uP.value.copy(d.P);
      u.uT.value.copy(d.T);
      u.uB.value.copy(d.B);
      u.uN.value.copy(d.N);
      u.uSize.value.set(d.w, d.h);
      const m = Math.max(d.w, d.h);
      u.uDepth.value.set(m * 0.08, m * 0.5); // 前方 8%（曲面起伏）、後方半個圖片大小（曲面往後彎）
      u.uFlip.value = !!d.flip;
      u.uThrough.value = !!d.through;
      u.uGraze.value = d.graze !== false;
      const mirror = new THREE.Matrix4().set(-1, 0, 0, 2 * d.mirrorX, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
      const mirrors = d.sym ? [new THREE.Matrix4(), mirror] : [new THREE.Matrix4()];
      // 投影框的外接球（對稱時另一側也算），只處理碰得到的貼圖組
      const rad = Math.hypot(d.w, d.h, Math.max(d.w, d.h)) / 2;
      const spheres = [new THREE.Sphere(d.P.clone(), rad)];
      if (d.sym) spheres.push(new THREE.Sphere(d.P.clone().applyMatrix4(mirror), rad));
      const r = this.renderer;
      for (const s of this.sets) {
        s.syncMatrices();
        if (s.box.isEmpty() || !spheres.some((sp) => s.box.intersectsSphere(sp))) continue;
        this.touch(s);
        s.dirty = true;
        s.scene.overrideMaterial = this.stampMat;
        r.setRenderTarget(s.stroke);
        r.autoClear = false;
        for (const mm of mirrors) {
          u.uMirror.value.copy(mm);
          r.render(s.scene, this.uvCam);
        }
        r.autoClear = true;
        s.scene.overrideMaterial = null;
      }
      r.setRenderTarget(null);
    }

    cancelStroke() {
      if (!this.stroke) return;
      for (const s of this.stroke.touched) {
        s.strokeActive = false;
        s.dirty = true;
      }
      this.stroke = null;
    }

    // 一筆結束：合進各組目前的圖層（新的 RenderTarget，舊的留給復原）
    endStroke() {
      if (!this.stroke) return;
      const touched = [...this.stroke.touched];
      this.stroke = null;
      if (!touched.length) return;
      const ops = [];
      for (const s of touched) {
        const L = s.activeLayer;
        const next = this.newLayerRT(s);
        this.setLayerUniforms(this.mergeMat, s, L, true);
        this.quad(this.mergeMat, next);
        ops.push(this.pixelsOp(s, L, next));
        s.strokeActive = false;
        s.dirty = true;
      }
      this.renderer.setRenderTarget(null);
      this.pushHistory(ops);
    }

    setLayerUniforms(mat, s, L, strokeOn) {
      const u = mat.uniforms;
      u.uLayer.value = L.rt.texture;
      u.uStroke.value = s.stroke.texture;
      u.uStrokeOn.value = strokeOn;
      u.uMode.value = this.brush.mode === 'image' ? 2 : this.brush.erase ? 1 : 0;
      u.uColor.value.copy(this.brush.color);
      u.uOpacity.value = this.brush.opacity;
      u.uLockAlpha.value = !!L.lockAlpha;
    }

    // 每個畫面更新一次：重新合成有變動的貼圖組（由下往上逐層疊，最後做接縫外擴）
    composite() {
      let any = false;
      for (const s of this.sets) {
        if (!s.dirty) continue;
        this.compositeSet(s);
        s.dirty = false;
        any = true;
      }
      if (any) this.renderer.setRenderTarget(null);
    }

    compositeSet(s) {
      let src = s.accA;
      let dst = s.accB;
      this.clear(src);
      const u = this.blendMat.uniforms;
      let clipBase = null;
      for (let i = 0; i < s.layers.length; i++) {
        const L = s.layers[i];
        if (!L.clip) clipBase = L;
        const base = L.clip ? clipBase : L;
        if (!L.visible || (L.clip && (!base || base === L || !base.visible))) continue;
        this.setLayerUniforms(this.blendMat, s, L, s.strokeActive && i === s.active);
        u.uAcc.value = src.texture;
        u.uBlend.value = BLEND_INDEX[L.blend] || 0;
        u.uLayerOpacity.value = L.opacity;
        u.uClip.value = !!L.clip;
        u.uClipBase.value = L.clip ? base.rt.texture : null;
        u.uClipOpacity.value = L.clip ? base.opacity : 1;
        this.quad(this.blendMat, dst);
        const t = src;
        src = dst;
        dst = t;
      }
      const f = this.finalMat.uniforms;
      f.uAcc.value = src.texture;
      f.uMask.value = s.mask.texture;
      f.uTexel.value.set(1 / s.w, 1 / s.h);
      this.quad(this.finalMat, s.comp);
    }

    // ---------- 圖層 ----------
    snapshot(s) {
      return { layers: s.layers.map((l) => ({ l, props: l.props() })), active: s.active };
    }
    applySnapshot(s, snap) {
      s.layers = snap.layers.map((x) => Object.assign(x.l, x.props));
      s.active = Math.min(snap.active, s.layers.length - 1);
      s.dirty = true;
    }
    // 復原項目：每個 op 都是「交換」，所以復原與重做都呼叫同一個 swap
    structOp(s, before) {
      const op = {
        kind: 'struct',
        set: s,
        snap: before,
        swap: () => {
          const cur = this.snapshot(s);
          this.applySnapshot(s, op.snap);
          op.snap = cur;
        },
      };
      return op;
    }
    pixelsOp(s, L, nextRT) {
      const op = {
        kind: 'pixels',
        set: s,
        layer: L,
        rt: L.rt,
        swap: () => {
          const cur = L.rt;
          L.rt = op.rt;
          op.rt = cur;
          s.dirty = true;
        },
      };
      L.rt = nextRT;
      return op;
    }
    // 修改圖層結構或屬性：fn 裡直接改 s.layers／s.active／屬性，結束後記一筆復原
    editLayers(s, fn) {
      const before = this.snapshot(s);
      const extra = fn() || [];
      this.pushHistory([this.structOp(s, before), ...extra]);
      s.dirty = true;
    }
    addLayer(s, name) {
      this.editLayers(s, () => {
        const L = new Layer(this.newLayerRT(s, true), name || this.nextLayerName(s));
        s.layers.splice(s.active + 1, 0, L);
        s.active += 1;
      });
      this.renderer.setRenderTarget(null);
    }
    nextLayerName(s) {
      let n = 1;
      while (s.layers.some((l) => l.name === `圖層 ${n}`)) n++;
      return `圖層 ${n}`;
    }
    duplicateLayer(s, i) {
      const src = s.layers[i];
      this.editLayers(s, () => {
        const L = new Layer(this.copyRT(s, src.rt), src.name + ' 複製');
        Object.assign(L, { visible: src.visible, opacity: src.opacity, blend: src.blend, lockAlpha: src.lockAlpha, clip: src.clip });
        s.layers.splice(i + 1, 0, L);
        s.active = i + 1;
      });
      this.renderer.setRenderTarget(null);
    }
    deleteLayer(s, i) {
      if (s.layers.length <= 1) return false;
      this.editLayers(s, () => {
        s.layers.splice(i, 1);
        if (s.active >= s.layers.length) s.active = s.layers.length - 1;
        else if (s.active > i) s.active -= 1;
      });
      return true;
    }
    moveLayer(s, i, dir) {
      const j = i + dir;
      if (j < 0 || j >= s.layers.length) return false;
      this.editLayers(s, () => {
        const [L] = s.layers.splice(i, 1);
        s.layers.splice(j, 0, L);
        if (s.active === i) s.active = j;
        else if (s.active === j) s.active = i;
      });
      return true;
    }
    // 向下合併：把第 i 層（含混合模式、不透明度、剪裁）疊到 i−1 層的像素上
    mergeDown(s, i) {
      if (i <= 0) return false;
      const upper = s.layers[i];
      const lower = s.layers[i - 1];
      this.editLayers(s, () => {
        const next = this.newLayerRT(s);
        const u = this.blendMat.uniforms;
        this.setLayerUniforms(this.blendMat, s, upper, false);
        u.uAcc.value = lower.rt.texture;
        u.uBlend.value = BLEND_INDEX[upper.blend] || 0;
        u.uLayerOpacity.value = upper.visible ? upper.opacity : 0;
        u.uClip.value = !!upper.clip;
        u.uClipBase.value = upper.clip ? lower.rt.texture : null;
        u.uClipOpacity.value = 1;
        this.quad(this.blendMat, next);
        this.renderer.setRenderTarget(null);
        const op = this.pixelsOp(s, lower, next);
        s.layers.splice(i, 1);
        s.active = i - 1;
        return [op];
      });
      return true;
    }
    clearLayer(s, i) {
      const L = s.layers[i == null ? s.active : i];
      const next = this.newLayerRT(s, true);
      this.renderer.setRenderTarget(null);
      this.pushHistory([this.pixelsOp(s, L, next)]);
      s.dirty = true;
    }

    // ---------- 圖層像素的讀寫（專案檔、PSD） ----------
    // 直接 alpha 的 RGBA，第 0 列是 v=0（＝圖片的最上面一列）
    layerPixels(s, L) {
      const buf = this.readRT(L.rt, s.w, s.h);
      for (let i = 0; i < buf.length; i += 4) {
        const a = buf[i + 3];
        if (a > 0 && a < 255) {
          buf[i] = Math.min(255, Math.round((buf[i] * 255) / a));
          buf[i + 1] = Math.min(255, Math.round((buf[i + 1] * 255) / a));
          buf[i + 2] = Math.min(255, Math.round((buf[i + 2] * 255) / a));
        }
      }
      return buf;
    }
    // 圖片（直接 alpha，最上面一列是 v=0）→ 圖層像素
    rtFromImage(s, img) {
      const t = new THREE.Texture(img);
      t.flipY = false;
      t.premultiplyAlpha = false;
      t.generateMipmaps = false;
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.needsUpdate = true;
      const rt = this.newLayerRT(s);
      this.premulMat.uniforms.uTex.value = t;
      this.quad(this.premulMat, rt);
      this.renderer.setRenderTarget(null);
      t.dispose();
      return rt;
    }
    // 讀專案檔：整組換成這些圖層（[{ props, rt }]），清掉復原紀錄
    restoreLayers(s, list, active) {
      s.layers = list.map(({ props, rt }) => Object.assign(new Layer(rt, props.name), props));
      s.active = Math.max(0, Math.min(active, s.layers.length - 1));
      s.dirty = true;
    }
    resetHistory() {
      this.undoStack = [];
      this.redoStack = [];
      this.gc();
    }

    // ---------- AO 烘焙 ----------
    // 從很多方向（球面上平均分布）各算一張深度圖，統計每個貼圖像素在法線那一側的半球有多少方向看得到天空。
    // 結果放成每組最上面的「AO」圖層（色彩增值）。opts: { scene, hide, dirs, strength, contrast, sets }
    bakeAO(opts) {
      const r = this.renderer;
      if (!r.capabilities.isWebGL2 || !r.extensions.get('EXT_color_buffer_float')) throw new Error('這個瀏覽器不支援浮點貼圖，不能烘焙 AO');
      const sets = (opts.sets || this.sets).filter((s) => {
        s.syncMatrices();
        return !s.box.isEmpty();
      });
      if (!sets.length) return 0;
      const box = new THREE.Box3();
      for (const s of this.sets) if (!s.box.isEmpty()) box.union(s.box);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const R = sphere.radius;
      const res = 1024;
      const depthRT = new THREE.WebGLRenderTarget(res, res, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
      const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.001, 4 * R);
      const accs = sets.map(
        (s) =>
          new THREE.WebGLRenderTarget(s.w, s.h, {
            type: THREE.HalfFloatType,
            format: THREE.RGBAFormat,
            depthBuffer: false,
            minFilter: THREE.NearestFilter,
            magFilter: THREE.NearestFilter,
          }),
      );
      for (const a of accs) this.clear(a);
      const hidden = [];
      for (const o of opts.hide || [])
        if (o.visible) {
          o.visible = false;
          hidden.push(o);
        }
      const prevBg = opts.scene.background;
      opts.scene.background = null;
      const prevC = r.getClearColor(new THREE.Color());
      const prevA = r.getClearAlpha();
      const u = this.aoMat.uniforms;
      u.uDepth.value = depthRT.texture;
      u.uBias.value = R * 0.004;
      const n = opts.dirs || 64;
      const golden = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        // 斐波那契球面
        const y = 1 - (2 * (i + 0.5)) / n;
        const rad = Math.sqrt(1 - y * y);
        const dir = new THREE.Vector3(Math.cos(golden * i) * rad, y, Math.sin(golden * i) * rad);
        cam.position.copy(sphere.center).addScaledVector(dir, 2 * R);
        cam.up.set(Math.abs(dir.y) > 0.99 ? 1 : 0, Math.abs(dir.y) > 0.99 ? 0 : 1, 0);
        cam.lookAt(sphere.center);
        cam.updateMatrixWorld();
        opts.scene.overrideMaterial = this.depthMat;
        r.setClearColor(0xffffff, 1);
        r.setRenderTarget(depthRT);
        r.clear(true, true, false);
        r.render(opts.scene, cam);
        opts.scene.overrideMaterial = null;
        u.uVP.value.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
        u.uDir.value.copy(dir);
        sets.forEach((s, k) => {
          s.scene.overrideMaterial = this.aoMat;
          r.setRenderTarget(accs[k]);
          r.autoClear = false;
          r.render(s.scene, this.uvCam);
          r.autoClear = true;
          s.scene.overrideMaterial = null;
        });
      }
      r.setClearColor(prevC, prevA);
      opts.scene.background = prevBg;
      for (const o of hidden) o.visible = true;
      depthRT.dispose();
      // 每組加一個「AO」圖層（可以復原）
      const fu = this.aoFinalMat.uniforms;
      fu.uStrength.value = opts.strength == null ? 1 : opts.strength;
      fu.uContrast.value = opts.contrast == null ? 1 : opts.contrast;
      const ops = [];
      sets.forEach((s, k) => {
        const before = this.snapshot(s);
        const rt = this.newLayerRT(s);
        fu.uAcc.value = accs[k].texture;
        fu.uMask.value = s.mask.texture;
        this.quad(this.aoFinalMat, rt);
        const L = new Layer(rt, 'AO');
        L.blend = 'multiply';
        s.layers.push(L);
        ops.push(this.structOp(s, before));
        s.dirty = true;
        accs[k].dispose();
      });
      r.setRenderTarget(null);
      this.pushHistory(ops);
      return sets.length;
    }

    // ---------- 復原 ----------
    pushHistory(ops) {
      if (!ops.length) return;
      this.undoStack.push(ops);
      this.redoStack = [];
      while (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
      this.gc();
    }
    undo() {
      const e = this.undoStack.pop();
      if (!e) return false;
      for (let i = e.length - 1; i >= 0; i--) e[i].swap();
      this.redoStack.push(e);
      return true;
    }
    redo() {
      const e = this.redoStack.pop();
      if (!e) return false;
      for (const op of e) op.swap();
      this.undoStack.push(e);
      return true;
    }
    // 回收沒有任何圖層或復原紀錄用到的像素
    gc() {
      const used = new Set();
      for (const s of this.sets) for (const L of s.layers) used.add(L.rt);
      for (const e of this.undoStack.concat(this.redoStack))
        for (const op of e) {
          if (op.kind === 'pixels') {
            used.add(op.rt);
            used.add(op.layer.rt);
          } else for (const x of op.snap.layers) used.add(x.l.rt);
        }
      for (const rt of this.layerRTs)
        if (!used.has(rt)) {
          rt.dispose();
          this.layerRTs.delete(rt);
        }
    }

    // ---------- 讀回 ----------
    readRT(rt, w, h) {
      const buf = new Uint8Array(w * h * 4);
      this.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
      return buf;
    }
    readComp(s) {
      return this.readRT(s.comp, s.w, s.h);
    }
    // 讀回的第 0 列是 v=0；glTF 圖片的第 0 列（最上面）也是 v=0，所以直接照順序放進畫布
    toCanvas(s) {
      const buf = this.readComp(s);
      const c = document.createElement('canvas');
      c.width = s.w;
      c.height = s.h;
      c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(buf.buffer), s.w, s.h), 0, 0);
      return c;
    }
    pickColor(s, uv) {
      const x = Math.min(s.w - 1, Math.max(0, Math.floor((uv.x - Math.floor(uv.x)) * s.w)));
      const y = Math.min(s.h - 1, Math.max(0, Math.floor((uv.y - Math.floor(uv.y)) * s.h)));
      const b = new Uint8Array(4);
      this.renderer.readRenderTargetPixels(s.comp, x, y, 1, 1, b);
      return b;
    }
  }

  RP.Painter = Painter;
  RP.Layer = Layer;
  RP.BLEND_MODES = BLEND_MODES;
  RP.MAXD = MAXD;
  RP.makeRT = makeRT;
})();
