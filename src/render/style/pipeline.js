// 渲染風格：後處理管線（取代原本的 EffectComposer 組合）。
// 場景 → 自己的 render target（含深度貼圖）→［SSAO］→ 合成（AO、動態模糊、描線）→ Bloom → 調色（含 gamma、
// 色偏、暗角、色差、顆粒、紙紋）→［FXAA］→ 畫面。左右比較時整條管線跑兩次再合成。
// 原本的組合是 RenderPass＋SSAOPass（SSAOPass 自己又畫一次場景），這裡只畫一次場景＋SSAO 的法線。
import { OUTLINE_MAT } from '../geometry.js';
import { StyleAtmos } from './atmos.js';
import { STYLE_DEFAULTS } from './params.js';
import { setStyleUniforms } from './shader.js';

// 著色器 uniform 與描邊材質是全域共用的：同一頁有其他畫面（模型庫）時，畫完風格預覽後恢復預設
export function resetStyleGlobals() {
  setStyleUniforms(STYLE_DEFAULTS);
  OUTLINE_MAT.visible = true;
  OUTLINE_MAT.uniforms.th.value = 0.012;
}

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }';

const COMP_FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tDepth, tAO;
uniform vec2 px;
uniform float cNear, cFar, useAO, aoK;
uniform vec4 inkA, inkB, inkC, mbA;
uniform mat4 invVP, prevVP;
varying vec2 vUv;
float vz( vec2 uv ) { return - perspectiveDepthToViewZ( texture2D( tDepth, uv ).x, cNear, cFar ); }
vec3 scol( vec2 uv ) {
	vec3 c = texture2D( tColor, uv ).rgb;
	if ( useAO > 0.5 ) c *= mix( 1.0, texture2D( tAO, uv ).r, aoK );
	return c;
}
float lap( vec2 o, float iz ) { return 2.0 * iz - 1.0 / vz( vUv + o ) - 1.0 / vz( vUv - o ); }
void main() {
	vec4 c0 = texture2D( tColor, vUv );
	float isMech = step( c0.a, 0.75 );
	float z = vz( vUv );
	vec3 col;
	if ( mbA.x > 0.0 ) {
		float d = texture2D( tDepth, vUv ).x;
		vec4 wp = invVP * vec4( vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
		wp /= wp.w;
		vec4 pp = prevVP * wp;
		vec2 vel = ( vUv - ( pp.xy / pp.w * 0.5 + 0.5 ) ) * mbA.x * ( 1.0 - isMech * mbA.y );
		float L = length( vel );
		if ( L > 0.04 ) vel *= 0.04 / L;
		col = vec3( 0.0 );
		for ( int i = 0; i < 8; i ++ ) col += scol( vUv - vel * ( float( i ) / 7.0 - 0.5 ) );
		col /= 8.0;
	} else col = scol( vUv );
	if ( inkA.x > 0.0 && z < cFar * 0.97 ) {
		float iz = 1.0 / z;
		float eo = 0.0;
		if ( inkA.y > 0.0 ) {
			vec2 r = px * inkA.y;
			float L = max( max( lap( vec2( r.x, 0.0 ), iz ), lap( vec2( 0.0, r.y ), iz ) ), max( lap( r * 0.7071, iz ), lap( vec2( r.x, - r.y ) * 0.7071, iz ) ) );
			eo = smoothstep( 0.06, 0.14, L * z );
		}
		float ei = 0.0;
		if ( inkA.z > 0.0 ) {
			vec2 r = px * inkA.z;
			float a = lap( vec2( r.x, 0.0 ), iz ) * z, b = lap( vec2( 0.0, r.y ), iz ) * z;
			float th = mix( 0.06, 0.0025, inkA.w );
			float m = max( abs( a ), abs( b ) );
			ei = smoothstep( th, th * 1.8, m ) * step( - 0.05, min( a, b ) );
		}
		float fade = 1.0 - smoothstep( inkC.x, inkC.y, z );
		float amt = clamp( max( eo, ei ) * inkA.x * fade * mix( inkC.z, 1.0, isMech ), 0.0, 1.0 );
		col = mix( col, mix( inkB.rgb, col * 0.28, inkB.w ), amt );
	}
	gl_FragColor = vec4( col, c0.a );
}
`;

const GRADE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 px;
uniform float time, aspect;
uniform vec4 gA, gL, gH, gB;
varying vec2 vUv;
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vn( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
void main() {
	vec3 c;
	if ( gB.y > 0.0 ) {
		vec2 d = ( vUv - 0.5 ) * gB.y * 0.012;
		c = vec3( texture2D( tDiffuse, vUv + d ).r, texture2D( tDiffuse, vUv ).g, texture2D( tDiffuse, vUv - d ).b );
	} else c = texture2D( tDiffuse, vUv ).rgb;
	c = LinearTosRGB( vec4( c, 1.0 ) ).rgb;
	c *= vec3( 1.0 + 0.1 * gA.w, 1.0 + 0.015 * gA.w, 1.0 - 0.12 * gA.w );
	c += gA.z;
	c = ( c - 0.5 ) * gA.y + 0.5;
	float l = clamp( dot( c, vec3( 0.299, 0.587, 0.114 ) ), 0.0, 1.0 );
	c = mix( vec3( l ), c, gA.x );
	c += ( gL.rgb - 0.5 ) * gL.w * ( 1.0 - l ) * ( 1.0 - l ) * 0.9;
	c += ( gH.rgb - 0.5 ) * gH.w * l * l * 0.7;
	vec2 v = ( vUv - 0.5 ) * vec2( aspect, 1.0 );
	c *= 1.0 - gB.x * smoothstep( 0.25, 1.05, length( v ) * 1.15 );
	vec2 sp = vUv / px;
	if ( gB.z > 0.0 ) c += ( h21( sp + fract( time ) * vec2( 113.1, 71.7 ) ) - 0.5 ) * gB.z * 0.14 * ( 1.0 - 0.5 * l );
	if ( gB.w > 0.0 ) {
		float p = vn( sp / 160.0 ) * 0.6 + vn( sp / 47.0 ) * 0.3 + vn( sp / 9.0 ) * 0.1;
		float fib = h21( floor( sp / 1.5 ) );
		c *= 1.0 - gB.w * ( 0.13 * p + 0.05 * fib );
		c = mix( c, c * vec3( 1.03, 1.0, 0.93 ) + vec3( 0.02, 0.015, 0.0 ), gB.w * 0.6 );
	}
	gl_FragColor = vec4( clamp( c, 0.0, 1.0 ), 1.0 );
}
`;

const SPLIT_FRAG = /* glsl */ `
uniform sampler2D tA, tB;
uniform float split, pxX;
varying vec2 vUv;
void main() {
	vec4 c = vUv.x < split ? texture2D( tA, vUv ) : texture2D( tB, vUv );
	if ( abs( vUv.x - split ) < pxX * 1.5 ) c = vec4( 1.0, 0.85, 0.3, 1.0 );
	gl_FragColor = c;
}
`;

const TM = () => ({
  aces: THREE.ACESFilmicToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
});

function quad(frag, uniforms) {
  const m = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
  mesh.frustumCulled = false;
  return { m, mesh };
}

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
const srgb = (hex) => new THREE.Color(hex);
const warm = (k) =>
  k >= 0 ? new THREE.Color(1, 1 - 0.18 * k, 1 - 0.42 * k) : new THREE.Color(1 + 0.25 * k, 1 + 0.08 * k, 1);

export class StylePipeline {
  // ctx：{ scene, camera, sun, hemi, sunOff（Vector3，太陽相對位置，鏡頭程式每格用它擺太陽）}
  constructor(renderer, ctx) {
    this.R = renderer;
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.camera = ctx.camera;
    this.atmos = ctx.indoor ? null : new StyleAtmos(ctx.scene);
    const depthOk = renderer.capabilities.isWebGL2 || renderer.extensions.has('WEBGL_depth_texture');
    this.depthOk = depthOk;
    const rt = (depth) => {
      const t = new THREE.WebGLRenderTarget(4, 4, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });
      if (depth && depthOk) {
        t.depthTexture = new THREE.DepthTexture(4, 4);
        t.depthTexture.type = renderer.capabilities.isWebGL2
          ? THREE.UnsignedIntType
          : THREE.UnsignedShortType;
      }
      return t;
    };
    this.rtScene = rt(true);
    this.rtA = rt(false);
    this.rtB = rt(false);
    this.rtL = rt(false);
    this.rtR = rt(false);
    this.cam2 = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.comp = quad(COMP_FRAG, {
      tColor: { value: null },
      tDepth: { value: null },
      tAO: { value: null },
      px: { value: new THREE.Vector2() },
      cNear: { value: 0.5 },
      cFar: { value: 400 },
      useAO: { value: 0 },
      aoK: { value: 1 },
      inkA: { value: new THREE.Vector4() },
      inkB: { value: new THREE.Vector4() },
      inkC: { value: new THREE.Vector4() },
      mbA: { value: new THREE.Vector4() },
      invVP: { value: new THREE.Matrix4() },
      prevVP: { value: new THREE.Matrix4() },
    });
    this.grade = quad(GRADE_FRAG, {
      tDiffuse: { value: null },
      px: { value: new THREE.Vector2() },
      time: { value: 0 },
      aspect: { value: 1 },
      gA: { value: new THREE.Vector4(1, 1, 0, 0) },
      gL: { value: new THREE.Vector4() },
      gH: { value: new THREE.Vector4() },
      gB: { value: new THREE.Vector4() },
    });
    this.split = quad(SPLIT_FRAG, {
      tA: { value: null },
      tB: { value: null },
      split: { value: 0.5 },
      pxX: { value: 0.001 },
    });
    this.fxaa = THREE.FXAAShader
      ? quad(THREE.FXAAShader.fragmentShader, THREE.UniformsUtils.clone(THREE.FXAAShader.uniforms))
      : null;
    this.qScene = new THREE.Scene();
    this.ssao = null;
    if (THREE.SSAOPass && ctx.ssao !== false) {
      this.ssao = new THREE.SSAOPass(ctx.scene, ctx.camera, 4, 4);
      this.ssao.output = THREE.SSAOPass.OUTPUT.Default;
      this.ssaoBase = ctx.ssaoBase || { kernelRadius: 1.6, minDistance: 0.0004, maxDistance: 0.012 };
    }
    this.bloom = THREE.UnrealBloomPass
      ? new THREE.UnrealBloomPass(new THREE.Vector2(4, 4), 0.45, 0.4, 0.9)
      : null;
    this.prevVP = new THREE.Matrix4();
    this.hasPrev = false;
    this.base = null;
    this.w = this.h = 0;
  }
  setSize(w, h) {
    const pr = this.R.getPixelRatio();
    const W = Math.max(1, Math.round(w * pr)),
      H = Math.max(1, Math.round(h * pr));
    if (W === this.w && H === this.h) return;
    this.w = W;
    this.h = H;
    for (const t of [this.rtScene, this.rtA, this.rtB, this.rtL, this.rtR]) t.setSize(W, H);
    if (this.ssao) this.ssao.setSize(W, H);
    if (this.bloom) this.bloom.setSize(W, H);
  }
  // 鏡頭切換（瞬移）後呼叫：動態模糊不要拿上一格的位置
  resetHistory() {
    this.hasPrev = false;
  }
  // 依場景目前的戰區設定記下基準值（霧、太陽、環境光）；換戰區（新的 Fog 物件）時重新記錄
  captureBase() {
    const s = this.scene,
      c = this.ctx;
    const fog = s.fog;
    if (this.base && this.base.fog === fog) return this.base;
    this.base = {
      fog,
      near: fog ? fog.near : 0,
      far: fog ? fog.far : 0,
      fogColor: fog ? fog.color.clone() : new THREE.Color(0x888888),
      bg: s.background && s.background.isColor ? s.background.clone() : null,
      sunColor: c.sun ? c.sun.color.clone() : null,
      sunI: c.sun ? c.sun.intensity : 1,
      hemiI: c.hemi ? c.hemi.intensity : 1,
    };
    return this.base;
  }
  // 戰區設定改了（例如重新開始任務但沿用同一個 Fog 物件）時強制重新記錄
  rebase() {
    this.base = null;
  }
  // 套用不需要重新編譯的場景參數（每格、比較時每半邊各一次）
  applyScene(P, time) {
    setStyleUniforms(P);
    const R = this.R,
      s = this.scene,
      c = this.ctx;
    R.toneMappingExposure = P.exposure;
    const B = this.captureBase();
    const out = !c.indoor;
    if (out && s.fog && B.fog) {
      s.fog.near = B.near * P.fogK;
      s.fog.far = B.far * P.fogK;
      s.fog.color.copy(B.fogColor).lerp(lin(P.fogColor), P.fogColorK);
    }
    if (out && B.bg && s.background && s.background.isColor) {
      if (P.sky === 'theme') s.background.copy(B.bg).lerp(lin(P.fogColor), P.fogColorK * 0.6);
      else s.background.copy(s.fog ? s.fog.color : B.bg);
    }
    if (c.sun && B.sunColor) {
      c.sun.color.copy(B.sunColor).multiply(warm(P.sunWarm));
      c.sun.intensity = B.sunI * P.sunK;
    }
    if (c.hemi) c.hemi.intensity = B.hemiI * P.hemiK;
    if (c.sunOff) {
      const az = (P.sunAz * Math.PI) / 180,
        el = (P.sunEl * Math.PI) / 180,
        r = 94.3;
      c.sunOff.set(Math.cos(el) * Math.cos(az) * r, Math.sin(el) * r, Math.cos(el) * Math.sin(az) * r);
    }
    OUTLINE_MAT.visible = P.hull > 0;
    OUTLINE_MAT.uniforms.th.value = 0.012 * P.hull;
    if (!this.atmos) return;
    const fc = s.fog ? s.fog.color : B.fogColor;
    this.atmos.update(
      P,
      this.camera,
      time,
      fc,
      c.sunOff || new THREE.Vector3(40, 80, 30),
      c.sun ? c.sun.color : new THREE.Color(1, 1, 1),
      R.getPixelRatio(),
    );
  }
  // 需要重新編譯的設定（色調映射、陰影種類）：改變時回傳 true，呼叫端把場景材質標成 needsUpdate
  applyStructural(P) {
    const R = this.R;
    const tm = TM()[P.toneMap] || THREE.ACESFilmicToneMapping;
    const st = P.shadowType === 'hard' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    let ch = false;
    if (R.toneMapping !== tm) {
      R.toneMapping = tm;
      ch = true;
    }
    if (R.shadowMap.type !== st) {
      R.shadowMap.type = st;
      R.shadowMap.needsUpdate = true;
      ch = true;
    }
    return ch;
  }
  // 整條管線；out 為 null 時畫到畫面
  run(P, out, time) {
    const R = this.R,
      cam = this.camera,
      s = this.scene;
    this.applyScene(P, time);
    const W = this.w,
      H = this.h;
    // 1. 場景
    R.setRenderTarget(this.rtScene);
    R.render(s, cam);
    // 2. SSAO（只畫法線＋算 AO，不再重畫一次場景）
    const ao = this.ssao && P.ssao > 0;
    if (ao) {
      const S = this.ssao,
        b = this.ssaoBase;
      S.kernelRadius = b.kernelRadius;
      S.minDistance = b.minDistance;
      S.maxDistance = b.maxDistance;
      S.overrideVisibility();
      S.renderOverride(R, S.normalMaterial, S.normalRenderTarget, 0x7777ff, 1.0);
      S.restoreVisibility();
      S.ssaoMaterial.uniforms.kernelRadius.value = S.kernelRadius;
      S.ssaoMaterial.uniforms.minDistance.value = S.minDistance;
      S.ssaoMaterial.uniforms.maxDistance.value = S.maxDistance;
      S.renderPass(R, S.ssaoMaterial, S.ssaoRenderTarget);
      S.renderPass(R, S.blurMaterial, S.blurRenderTarget);
    }
    // 3. 合成：AO、動態模糊、描線
    const u = this.comp.m.uniforms;
    u.tColor.value = this.rtScene.texture;
    u.tDepth.value = this.rtScene.depthTexture || null;
    u.tAO.value = ao ? this.ssao.blurRenderTarget.texture : null;
    u.useAO.value = ao ? 1 : 0;
    u.aoK.value = P.ssao;
    u.px.value.set(1 / W, 1 / H);
    u.cNear.value = cam.near;
    u.cFar.value = cam.far;
    const pr = R.getPixelRatio();
    const depth = !!this.rtScene.depthTexture;
    u.inkA.value.set(depth ? P.ink : 0, P.inkOuter * pr, P.inkInner * pr, P.crease);
    const ic = lin(P.inkColor);
    u.inkB.value.set(ic.r, ic.g, ic.b, P.inkObj);
    u.inkC.value.set(P.inkNear, Math.max(P.inkFar, P.inkNear + 1), P.inkEnv, 0);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const mb = depth && P.mblur && P.mblurK > 0 && this.hasPrev;
    u.mbA.value.set(mb ? P.mblurK * 1.2 : 0, P.mblurMech, 0, 0);
    u.invVP.value.copy(vp).invert();
    u.prevVP.value.copy(this.prevVP);
    this.draw(this.comp, this.rtA);
    // 4. Bloom（疊加回 rtA）
    if (this.bloom && P.bloom > 0) {
      const b = this.bloom;
      b.strength = P.bloom;
      b.radius = P.bloomR;
      b.threshold = P.bloomTh;
      b.render(R, null, this.rtA, 0, false);
    }
    // 5. 調色（含 gamma）→ 6. FXAA
    const g = this.grade.m.uniforms;
    g.tDiffuse.value = this.rtA.texture;
    g.px.value.set(1 / W, 1 / H);
    g.time.value = time;
    g.aspect.value = W / H;
    g.gA.value.set(P.sat, P.contrast, P.bright, P.temp);
    const tl = srgb(P.tintLo),
      th = srgb(P.tintHi);
    g.gL.value.set(tl.r, tl.g, tl.b, P.tintLoK);
    g.gH.value.set(th.r, th.g, th.b, P.tintHiK);
    g.gB.value.set(P.vignette, P.chroma, P.grain, P.paper);
    if (this.fxaa && P.fxaa) {
      this.draw(this.grade, this.rtB);
      const f = this.fxaa.m.uniforms;
      f.tDiffuse.value = this.rtB.texture;
      f.resolution.value.set(1 / W, 1 / H);
      this.draw(this.fxaa, out);
    } else this.draw(this.grade, out);
  }
  draw(q, target) {
    this.qScene.children.length = 0;
    this.qScene.add(q.mesh);
    this.R.setRenderTarget(target);
    this.R.render(this.qScene, this.cam2);
  }
  // P：目前的參數；cmp：{ P, split }（左半邊顯示 cmp.P）
  render(P, time, cmp) {
    const R = this.R;
    const cam = this.camera;
    cam.updateMatrixWorld();
    if (cmp && cmp.P) {
      this.run(cmp.P, this.rtL, time);
      this.run(P, this.rtR, time);
      const u = this.split.m.uniforms;
      u.tA.value = this.rtL.texture;
      u.tB.value = this.rtR.texture;
      u.split.value = cmp.split;
      u.pxX.value = 1 / this.w;
      this.draw(this.split, null);
    } else this.run(P, null, time);
    R.setRenderTarget(null);
    this.prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.hasPrev = true;
  }
  // 不做後處理時：直接畫到畫面（設定裡關掉後製特效）
  renderPlain(P, time) {
    this.applyScene(P, time);
    this.R.setRenderTarget(null);
    this.R.render(this.scene, this.camera);
    this.hasPrev = false;
  }
}
