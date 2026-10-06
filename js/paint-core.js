// 繪圖核心：在 UV 空間跑投影繪圖（每個貼圖像素都知道自己在 3D 的位置）。
// 貼圖組（TexSet）＝一張會被畫的貼圖；每組有 base（原圖）、layer（繪圖圖層，預乘 alpha）、
// stroke（目前這一筆的覆蓋率，MAX 混合，避免筆刷點重疊變濃）、comp（合成＋接縫外擴，給材質用）、mask（UV 覆蓋範圍）。
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});
  const MAXD = 64; // 每次繪製最多幾個筆刷點（uniform 陣列長度）
  const HISTORY_MAX = 30;

  const UV_VERT = /* glsl */ `
    varying vec3 vWorld;
    varying vec3 vNrm;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      vNrm = normalize(mat3(modelMatrix) * normal);
      gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    }`;

  const PAINT_FRAG = /* glsl */ `
    #include <packing>
    #define MAXD ${MAXD}
    uniform int uNS;            // 畫面筆刷點數量
    uniform vec4 uS[MAXD];      // x, y（畫面 px，左下原點）, 半徑 px, alpha
    uniform int uNW;            // 球體筆刷點數量
    uniform vec4 uW[MAXD];      // 世界座標中心, 半徑
    uniform float uWA[MAXD];    // alpha
    uniform float uHard;
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
    varying vec3 vWorld;
    varying vec3 vNrm;

    float fall(float d) {
      if (d >= 1.0) return 0.0;
      return 1.0 - smoothstep(uHard, 1.0, d);
    }
    float viewDist(float z) {
      return uOrtho ? -orthographicDepthToViewZ(z, uNear, uFar) : -perspectiveDepthToViewZ(z, uNear, uFar);
    }
    void main() {
      float a = 0.0;
      if (uNS > 0) {
        vec4 c = uVP * vec4(vWorld, 1.0);
        bool vis = false;
        vec2 px = vec2(0.0);
        if (c.w > 0.0) {
          vec3 n = c.xyz / c.w;
          if (abs(n.x) < 1.0 && abs(n.y) < 1.0) {
            vec2 s = n.xy * 0.5 + 0.5;
            float zs = viewDist(unpackRGBAToDepth(texture2D(uDepth, s)));
            float zm = viewDist(n.z * 0.5 + 0.5);
            vis = zm <= zs * 1.002 + uBias;
            px = s * uView;
          }
        }
        if (vis && uCull) {
          vec3 V = uOrtho ? -uCamDir : normalize(uCam - vWorld);
          if (dot(vNrm, V) < 0.0) vis = false;
        }
        if (vis) {
          for (int i = 0; i < MAXD; i++) {
            if (i >= uNS) break;
            vec4 d = uS[i];
            a = max(a, fall(length(px - d.xy) / d.z) * d.w);
          }
        }
      }
      for (int i = 0; i < MAXD; i++) {
        if (i >= uNW) break;
        vec4 d = uW[i];
        a = max(a, fall(length(vWorld - d.xyz) / d.w) * uWA[i]);
      }
      if (a <= 0.0) discard;
      gl_FragColor = vec4(a);
    }`;

  const QUAD_VERT = /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

  const COLOR_FN = /* glsl */ `
    vec3 s2l(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 l2s(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }`;

  // 原圖 × 材質顏色 → sRGB 底圖
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
      gl_FragColor = vec4(l2s(lin), t.a);
    }`;

  const LAYER_FN = /* glsl */ `
    uniform sampler2D uLayer;
    uniform sampler2D uStroke;
    uniform bool uStrokeOn;
    uniform int uMode;          // 0 筆、1 橡皮擦、2 圖片（stroke 存預乘 RGBA）
    uniform vec3 uColor;
    uniform float uOpacity;
    vec4 layerAt(vec2 uv) {
      vec4 L = texture2D(uLayer, uv);
      if (uStrokeOn) {
        if (uMode == 2) {
          vec4 S = texture2D(uStroke, uv) * uOpacity;
          L = S + L * (1.0 - S.a);
        } else {
          float s = texture2D(uStroke, uv).r * uOpacity;
          L = uMode == 1 ? L * (1.0 - s) : vec4(uColor * s, s) + L * (1.0 - s);
        }
      }
      return L;
    }`;

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
      vec4 t = texture2D(uImg, iuv);
      float a = t.a * fade;
      if (a <= 0.0) discard;
      gl_FragColor = vec4(t.rgb * a, a);
    }`;

  const MERGE_FRAG = /* glsl */ `
    ${LAYER_FN}
    varying vec2 vUv;
    void main() { gl_FragColor = layerAt(vUv); }`;

  // 合成：底圖（直接 alpha）＋圖層（預乘）；UV 島外的像素往外找最近的島內像素（接縫外擴）
  const COMP_FRAG = /* glsl */ `
    ${LAYER_FN}
    #define PAD 6
    uniform sampler2D uBase;
    uniform sampler2D uMask;
    uniform vec2 uTexel;
    varying vec2 vUv;
    vec4 compAt(vec2 uv) {
      vec4 B = texture2D(uBase, uv);
      vec4 L = layerAt(uv);
      float a = L.a + B.a * (1.0 - L.a);
      vec3 rgb = L.rgb + B.rgb * B.a * (1.0 - L.a);
      return vec4(a > 0.0 ? rgb / a : vec3(0.0), a);
    }
    void main() {
      if (texture2D(uMask, vUv).r > 0.5) { gl_FragColor = compAt(vUv); return; }
      for (int r = 1; r <= PAD; r++) {
        for (int k = 0; k < 8; k++) {
          float ang = float(k) * 0.78539816;
          vec2 o = vec2(floor(cos(ang) * float(r) + 0.5), floor(sin(ang) * float(r) + 0.5)) * uTexel;
          if (texture2D(uMask, vUv + o).r > 0.5) { gl_FragColor = compAt(vUv + o); return; }
        }
      }
      gl_FragColor = compAt(vUv);
    }`;

  const COPY_FRAG = /* glsl */ `
    uniform sampler2D uTex;
    varying vec2 vUv;
    void main() { gl_FragColor = texture2D(uTex, vUv); }`;

  function makeRT(w, h, mips) {
    const rt = new THREE.WebGLRenderTarget(w, h, {
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
      magFilter: THREE.LinearFilter,
      minFilter: mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter,
      generateMipmaps: !!mips,
    });
    return rt;
  }

  class TexSet {
    constructor(painter, id, name, w, h) {
      this.painter = painter;
      this.id = id;
      this.name = name;
      this.w = w;
      this.h = h;
      this.parts = []; // { mesh, start, count }
      this.materials = [];
      this.srcMap = null;
      this.srcColor = new THREE.Color(1, 1, 1);
      this.scene = new THREE.Scene();
      this.scene.autoUpdate = false; // proxy 的 matrixWorld 直接複製原網格的
      this.box = new THREE.Box3();
      this.dirty = true;
      this.strokeActive = false;
      this.screenRect = null;
      this.triCount = 0;
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

    syncMatrices() {
      this.box.makeEmpty();
      for (const p of this.parts) {
        p.mesh.updateWorldMatrix(true, false);
        p.proxy.matrixWorld.copy(p.mesh.matrixWorld);
        if (!p.mesh.geometry.boundingBox) p.mesh.geometry.computeBoundingBox();
        const b = p.mesh.geometry.boundingBox.clone().applyMatrix4(p.mesh.matrixWorld);
        this.box.union(b);
      }
    }

    init() {
      const P = this.painter;
      this.base = makeRT(this.w, this.h);
      this.layer = makeRT(this.w, this.h);
      this.stroke = makeRT(this.w, this.h);
      this.mask = makeRT(this.w, this.h);
      this.comp = makeRT(this.w, this.h, true);
      const wrap = this.srcMap ? this.srcMap : null;
      const t = this.comp.texture;
      t.encoding = THREE.sRGBEncoding;
      t.anisotropy = Math.min(8, P.renderer.capabilities.getMaxAnisotropy());
      if (wrap) {
        t.wrapS = wrap.wrapS;
        t.wrapT = wrap.wrapT;
      }
      // 底圖
      const bm = P.baseMat;
      bm.uniforms.uHasMap.value = !!this.srcMap;
      bm.uniforms.uMap.value = this.srcMap;
      bm.uniforms.uMapSRGB.value = !!this.srcMap && this.srcMap.encoding === THREE.sRGBEncoding;
      bm.uniforms.uColor.value.copy(this.srcColor);
      P.quad(bm, this.base);
      P.clear(this.layer);
      P.clear(this.stroke);
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
      for (const k of ['base', 'layer', 'stroke', 'mask', 'comp']) this[k] && this[k].dispose();
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
      this.baseMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: BASE_FRAG,
        uniforms: {
          uMap: { value: null },
          uHasMap: { value: false },
          uMapSRGB: { value: true },
          uColor: { value: new THREE.Color() },
        },
        depthTest: false,
        depthWrite: false,
      });
      const layerUniforms = () => ({
        uLayer: { value: null },
        uStroke: { value: null },
        uStrokeOn: { value: false },
        uMode: { value: 0 },
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 1 },
      });
      this.mergeMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: MERGE_FRAG,
        uniforms: layerUniforms(),
        depthTest: false,
        depthWrite: false,
      });
      this.compMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: COMP_FRAG,
        uniforms: Object.assign(layerUniforms(), {
          uBase: { value: null },
          uMask: { value: null },
          uTexel: { value: new THREE.Vector2() },
        }),
        depthTest: false,
        depthWrite: false,
      });
      this.copyMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VERT,
        fragmentShader: COPY_FRAG,
        uniforms: { uTex: { value: null } },
        depthTest: false,
        depthWrite: false,
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
      this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
      this.depthRT = null;
      this.depthBuf = null;
      this.brush = { color: new THREE.Color(1, 0, 0), opacity: 1, hardness: 0.5, erase: false };
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
      this.clearHistory();
    }

    // ---------- 一筆 ----------
    // view: { camera, scene, w, h, hide: [Object3D] }
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

      Object.assign(this.brush, brush);
      this.brush.color = new THREE.Color(brush.color);
      this.brush.mode = brush.mode || 'paint';
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
        s.screenRect = behind ? null : { x0, y0, x1, y1 };
      }
    }

    // 畫面座標（左上原點，CSS px）→ 3D 位置與每像素的世界長度；沒打到模型回傳 null
    pickWorld(x, y) {
      if (!this.stroke) return null;
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

    // dabs: [{ type: 's', x, y, r, a } | { type: 'w', p: Vector3, r, a }]（s 的 x, y 是左下原點）
    paintDabs(dabs) {
      if (!this.stroke || !dabs.length) return;
      const u = this.paintMat.uniforms;
      for (let off = 0; off < dabs.length; off += MAXD) {
        const batch = dabs.slice(off, off + MAXD);
        let ns = 0;
        let nw = 0;
        for (const d of batch) {
          if (d.type === 's') u.uS.value[ns++].set(d.x, d.y, d.r, d.a);
          else {
            u.uW.value[nw].set(d.p.x, d.p.y, d.p.z, d.r);
            u.uWA.value[nw++] = d.a;
          }
        }
        u.uNS.value = ns;
        u.uNW.value = nw;
        for (const s of this.sets) {
          if (!this.batchHits(s, batch)) continue;
          if (!s.strokeActive) {
            this.clear(s.stroke);
            s.strokeActive = true;
            this.stroke.touched.add(s);
          }
          this.renderer.setRenderTarget(s.stroke);
          this.renderer.autoClear = false; // 筆畫緩衝要累積，不能清掉
          this.renderer.render(s.scene, this.uvCam);
          this.renderer.autoClear = true;
          s.dirty = true;
        }
      }
      this.renderer.setRenderTarget(null);
    }

    batchHits(s, batch) {
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
        if (!spheres.some((sp) => s.box.intersectsSphere(sp))) continue;
        this.clear(s.stroke);
        s.strokeActive = true;
        s.dirty = true;
        this.stroke.touched.add(s);
        s.scene.overrideMaterial = this.stampMat;
        r.setRenderTarget(s.stroke);
        r.autoClear = false;
        for (const m of mirrors) {
          u.uMirror.value.copy(m);
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

    endStroke() {
      if (!this.stroke) return;
      const touched = [...this.stroke.touched];
      this.stroke = null;
      if (!touched.length) return;
      const entry = [];
      for (const s of touched) {
        const next = makeRT(s.w, s.h);
        this.setLayerUniforms(this.mergeMat, s, true);
        this.quad(this.mergeMat, next);
        entry.push({ set: s, rt: s.layer });
        s.layer = next;
        s.strokeActive = false;
        s.dirty = true;
      }
      this.renderer.setRenderTarget(null);
      this.pushHistory(entry);
    }

    setLayerUniforms(mat, s, strokeOn) {
      const u = mat.uniforms;
      u.uLayer.value = s.layer.texture;
      u.uStroke.value = s.stroke.texture;
      u.uStrokeOn.value = strokeOn;
      u.uMode.value = this.brush.mode === 'image' ? 2 : this.brush.erase ? 1 : 0;
      u.uColor.value.copy(this.brush.color);
      u.uOpacity.value = this.brush.opacity;
    }

    // 每個畫面更新一次：重新合成有變動的貼圖組
    composite() {
      let any = false;
      for (const s of this.sets) {
        if (!s.dirty) continue;
        const u = this.compMat.uniforms;
        this.setLayerUniforms(this.compMat, s, s.strokeActive);
        u.uBase.value = s.base.texture;
        u.uMask.value = s.mask.texture;
        u.uTexel.value.set(1 / s.w, 1 / s.h);
        this.quad(this.compMat, s.comp);
        s.dirty = false;
        any = true;
      }
      if (any) this.renderer.setRenderTarget(null);
    }

    // ---------- 復原 ----------
    pushHistory(entry) {
      this.undoStack.push(entry);
      for (const e of this.redoStack) for (const it of e) it.rt.dispose();
      this.redoStack = [];
      while (this.undoStack.length > HISTORY_MAX) for (const it of this.undoStack.shift()) it.rt.dispose();
    }
    swapEntry(entry) {
      for (const it of entry) {
        const cur = it.set.layer;
        it.set.layer = it.rt;
        it.rt = cur;
        it.set.dirty = true;
      }
    }
    undo() {
      const e = this.undoStack.pop();
      if (!e) return false;
      this.swapEntry(e);
      this.redoStack.push(e);
      return true;
    }
    redo() {
      const e = this.redoStack.pop();
      if (!e) return false;
      this.swapEntry(e);
      this.undoStack.push(e);
      return true;
    }
    clearHistory() {
      for (const e of this.undoStack.concat(this.redoStack)) for (const it of e) it.rt.dispose();
      this.undoStack = [];
      this.redoStack = [];
    }
    clearLayer(s) {
      const next = makeRT(s.w, s.h);
      this.clear(next);
      this.renderer.setRenderTarget(null);
      this.pushHistory([{ set: s, rt: s.layer }]);
      s.layer = next;
      s.dirty = true;
    }

    // ---------- 讀回 ----------
    readComp(s) {
      const buf = new Uint8Array(s.w * s.h * 4);
      this.renderer.readRenderTargetPixels(s.comp, 0, 0, s.w, s.h, buf);
      return buf;
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
  RP.MAXD = MAXD;
})();
