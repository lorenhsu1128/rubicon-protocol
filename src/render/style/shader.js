// 渲染風格：全域修改 MeshStandardMaterial 的著色器（色階光照、影色、高光、邊緣光、機體金屬、貼圖細節、
// 高度霧、水彩地形）。所有風格寫在同一份著色器裡、以 uniform 切換，所以調參數不用重新編譯；
// 參數全是 0 的「寫實」走原本的物理渲染路徑，畫面與修改前相同。
// 材質分類（機甲／武器／載具＝1、其他＝0）用 WeakMap 記，不寫 userData（GLTFExporter 會把 userData 寫進 GLB）。

import { fxStyle } from '../../fx/gpu.js';

const CAT = new WeakMap();
// 把 root 底下所有材質標成機體類（金屬只套用在這一類；描線的「地形描線」也以此分辨）
export function tagStyle(root, cat = 1) {
  if (!root) return root;
  root.traverse((o) => {
    const m = o.material;
    if (!m) return;
    for (const x of Array.isArray(m) ? m : [m]) CAT.set(x, cat);
  });
  return root;
}
export const styleCat = (m) => CAT.get(m) || 0;
// GLB 等美術畫好的貼圖（記在貼圖物件上，材質複製後仍共用同一張）：「貼圖細節」不把它混成平均色，
// 因為它不是程式產生的磨損細節，而是部件的配色與分件線本身
const AUTH = new WeakSet();
export const markAuthoredTex = (t) => {
  if (t) AUTH.add(t);
};
// 貼花層（貼圖繪製畫在色槽之上的圖層，docs/glb-spec.md）：記在底圖的貼圖物件上（材質複製後仍共用），
// { tex 貼花（預乘 alpha、sRGB 值）, wts 色槽權重（預乘，RGBA＝main／sub／joint／acc） }。
// 色槽顏色記在材質上（tintMaterial 依配色設定；沒有時用材質本身的顏色）
const DECAL = new WeakMap();
const SLOTCOL = new WeakMap();
export const DECAL_SLOTS = ['main', 'sub', 'joint', 'acc'];
export const setDecal = (map, d) => {
  if (map && d) DECAL.set(map, d);
};
export const hasDecal = (m) => !!(m && m.map && DECAL.has(m.map));
export const setDecalColors = (m, cols) => SLOTCOL.set(m, cols);
let BLACK = null;
const blackTex = () => {
  if (!BLACK) {
    BLACK = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    BLACK.needsUpdate = true;
  }
  return BLACK;
};

const V4 = (x, y, z, w) => ({ value: new THREE.Vector4(x, y, z, w) });
// 全部材質共用同一組 uniform 物件（改 value 就全部生效）
export const SU = {
  stA: V4(0, 2, 0.5, 0.02), // 色階開關、色階數、明暗分界、交界柔和度
  stB: V4(0.5, 0.5, 0.7, 0.4), // 影色（線性，已乘暗面亮度）、環境光混入
  stC: V4(0.35, 0.02, 0.6, 0.25), // 高光大小、高光柔和、高光強度、邊緣光寬度
  stD: V4(1, 1, 1, 0), // 邊緣光顏色、強度
  stE: V4(1, 1, 1, 1), // 機體貼圖細節、地形貼圖細節、面板凹凸、環境反射
  stM: V4(0, 0.9, 0.28, 0.7), // 金屬開關、金屬感、粗糙度、保留陣營色
  stN: V4(1.6, 0, 1, 1), // 金屬反射強度、動畫金屬反光帶、亮面亮度、陰影濃度
  stF: V4(0, 2, 8, 0), // 高度霧濃度、高度、衰減、水彩地形
  stW: V4(0.08, 0, 0, 0), // 水彩筆觸大小
  // 水面（fx/water/index.js 每格設定，docs/water-design.md）：水位、焦散開關、濕的岸邊的高度、有水面
  stWa: V4(-1e9, 0, 0, 0),
  stWb: V4(0, 0, 1, 0), // 焦散貼圖的視窗：中心 x、z、邊長、強度
  stWc: V4(0, 0, 0, 0), // 平水面的折射光的水平分量 ÷ 垂直分量（焦散貼圖的座標換算）
  stCau: { value: null }, // 焦散貼圖（fx/water/caustics.js）
  stCauT: { value: null }, // 細的焦散花紋（可拼接，fx/water/caustics.js 的 causTex）
  stWd: V4(0, 0.05, 0, 0), // 焦散花紋：時間、每公尺幾張、強度
};
SU.stCau.value = SU.stCauT.value = (() => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
})();

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
// k：場景的尺度（遊戲＝core/scale.js 的 DS，機甲庫與模型庫 1）：高度霧與水彩筆觸的公尺數乘上它
export function setStyleUniforms(P, k = 1) {
  const sh = lin(P.shade).multiplyScalar(P.shadeK);
  const rc = lin(P.rimColor);
  SU.stA.value.set(P.toon ? 1 : 0, P.steps, P.thresh, P.soft);
  SU.stB.value.set(sh.r, sh.g, sh.b, P.ambient);
  SU.stC.value.set(P.specSize, P.specSoft, P.spec, P.rimW);
  SU.stD.value.set(rc.r, rc.g, rc.b, P.rim);
  SU.stE.value.set(P.mechDetail, P.envDetail, P.normalK, P.envRefl);
  SU.stM.value.set(P.metal ? 1 : 0, P.metalness, P.roughness, P.metalTint);
  SU.stN.value.set(P.metalRefl, P.toon ? P.metalAnime : 0, P.litK, P.shadowK);
  SU.stF.value.set(P.hfog, P.hfogH * k, P.hfogFall * k, P.water);
  fxStyle(P.fxCel); // 粒子特效的色階（fx/gpu.js）
  SU.stW.value.set(P.waterScale / k, 0, 0, 0);
}

const PARS = /* glsl */ `
uniform vec4 stA, stB, stC, stD, stE, stM, stN, stF, stW, stWa, stWb, stWc, stWd;
uniform sampler2D stCau, stCauT;
uniform float stCat, stOpq, stAuth;
#ifdef ST_DECAL
uniform sampler2D stDecT, stDecW;
uniform vec3 stSlot[ 4 ];
#endif
varying vec3 vStW;
float stSh = 1.0;
vec3 stLit = vec3( 0.0 );
vec3 stSpec = vec3( 0.0 );
float stKey = 0.0;
float stBand( float x ) {
	float n = stA.y - 1.0;
	float w = max( stA.w, 0.001 );
	float s = 0.0;
	for ( int k = 0; k < 3; k ++ ) {
		if ( float( k ) < n ) {
			float xk = stA.z + float( k ) * ( 1.0 - stA.z ) / n;
			s += smoothstep( xk - w, xk + w, x );
		}
	}
	return s / n;
}
void RE_Direct_Style( const in IncidentLight directLight, const in GeometricContext geometry, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	if ( stA.x < 0.5 ) {
		RE_Direct_Physical( directLight, geometry, material, reflectedLight );
		stSh = 1.0;
		return;
	}
	float ndl = dot( geometry.normal, directLight.direction );
	float w = max( stA.w, 0.001 );
	float sh = mix( 1.0, smoothstep( 0.5 - w, 0.5 + w, stSh ), stN.w );
	float b = min( stBand( ndl * 0.5 + 0.5 ), sh );
	stLit += directLight.color * mix( stB.rgb, vec3( stN.z ), b );
	vec3 h = normalize( directLight.direction + geometry.viewDir );
	float e = mix( 400.0, 6.0, stC.x );
	float sp = pow( saturate( dot( geometry.normal, h ) ), e );
	float sw = max( stC.y, 0.002 );
	stSpec += directLight.color * smoothstep( 0.5 - sw, 0.5 + sw, sp ) * b * saturate( 1.25 - material.specularRoughness );
	stKey += dot( directLight.color, vec3( 0.299, 0.587, 0.114 ) );
	stSh = 1.0;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Style
float stHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float stNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( stHash( i ), stHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( stHash( i + vec2( 0.0, 1.0 ) ), stHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
`;

const MAP = /* glsl */ `
#ifdef USE_MAP
	vec4 texelColor = texture2D( map, vUv );
	float stDet = max( mix( stE.y, stE.x, stCat ), stAuth );
	if ( stDet < 0.999 ) texelColor = mix( texture2D( map, vUv, 10.0 ), texelColor, stDet );
	texelColor = mapTexelToLinear( texelColor );
	diffuseColor *= texelColor;
	#ifdef ST_DECAL
	vec4 stDc = texture2D( stDecT, vUv );
	if ( stDc.a > 0.002 ) {
		vec4 stDw = texture2D( stDecW, vUv );
		vec3 stDcol = sRGBToLinear( vec4( stDc.rgb / stDc.a, 1.0 ) ).rgb;
		float stFx = max( 0.0, stDc.a - stDw.r - stDw.g - stDw.b - stDw.a );
		vec3 stTint = ( stSlot[ 0 ] * stDw.r + stSlot[ 1 ] * stDw.g + stSlot[ 2 ] * stDw.b + stSlot[ 3 ] * stDw.a + stFx ) / stDc.a;
		diffuseColor.rgb = mix( diffuseColor.rgb, stDcol * stTint, min( stDc.a, 1.0 ) );
	}
	#endif
#endif
`;

const AFTER_COLOR = /* glsl */ `
if ( stF.w > 0.0 && stCat < 0.5 ) {
	vec2 wp = vStW.xz * stW.x;
	float n1 = stNoise( wp ) * 0.55 + stNoise( wp * 2.7 + 3.1 ) * 0.3 + stNoise( wp * 7.3 + 9.2 ) * 0.15;
	float n2 = stNoise( wp * 0.37 + 17.0 );
	vec3 wc = diffuseColor.rgb * ( 0.78 + 0.44 * n1 );
	wc = mix( wc, wc * vec3( 1.1, 1.0, 0.84 ), smoothstep( 0.35, 0.75, n2 ) );
	diffuseColor.rgb = mix( diffuseColor.rgb, wc, stF.w );
}
`;

const AFTER_METAL = /* glsl */ `
float stMk = stM.x * stCat;
if ( stMk > 0.0 ) {
	metalnessFactor = mix( metalnessFactor, stM.y, stMk );
	roughnessFactor = mix( roughnessFactor, stM.z, stMk );
	diffuseColor.rgb = mix( diffuseColor.rgb, mix( vec3( 0.85 ), min( diffuseColor.rgb * 1.25, vec3( 1.0 ) ), stM.w ), stMk );
}
// 水面：水位以上一小段是濕的岸邊（變暗、反光變強）；水位以下照焦散貼圖加上晃動的光紋
float stCa = 0.0;
if ( stWa.w > 0.5 ) {
	float stDh = vStW.y - stWa.x;
	if ( stDh < 0.0 ) {
		if ( stWa.y > 0.5 ) {
			// 細的花紋（兩層錯開移動、取小的＝網狀）＋模擬的焦散（機體、爆炸攪動的地方）
			vec2 stQ = vStW.xz + stWc.xy * ( stWa.x - vStW.y );
			vec2 stCq = stQ * stWd.y;
			float stC1 = texture2D( stCauT, stCq + stWd.x * vec2( 0.021, 0.013 ) ).r;
			float stC2 = texture2D( stCauT, stCq * 1.31 + vec2( 0.37, 0.19 ) - stWd.x * vec2( 0.017, -0.015 ) ).r;
			stCa = pow( min( stC1, stC2 ) * 2.2, 2.0 ) * stWd.z;
			vec2 stCu = ( stQ - stWb.xy ) / stWb.z + 0.5;
			vec2 stCe = min( stCu, 1.0 - stCu );
			float stIn = smoothstep( 0.0, 0.06, min( stCe.x, stCe.y ) );
			if ( stIn > 0.0 ) stCa += pow( max( 0.0, texture2D( stCau, stCu ).r * 5.0 - 1.15 ), 1.4 ) * stIn * stWb.w;
			stCa *= exp( stDh * 0.05 ) * smoothstep( 0.0, 0.3, - stDh );
		}
		diffuseColor.rgb *= 0.72;
		roughnessFactor *= 0.5;
	} else {
		float stWet = 1.0 - smoothstep( 0.0, stWa.z, stDh );
		diffuseColor.rgb *= 1.0 - 0.32 * stWet;
		roughnessFactor *= 1.0 - 0.55 * stWet;
	}
}
vec3 stAlb = diffuseColor.rgb;
`;

const AFTER_MAPS = /* glsl */ `
#if defined( RE_IndirectSpecular )
	radiance *= stE.w * mix( 1.0, stN.x, stMk );
#endif
#if defined( RE_IndirectDiffuse )
	iblIrradiance *= stE.w;
#endif
`;

const TOON = /* glsl */ `
if ( stA.x > 0.5 ) {
	vec3 stV = normalize( vViewPosition );
	vec3 stCol = stAlb * stLit;
	#if defined( RE_IndirectDiffuse )
	stCol += stAlb * irradiance * RECIPROCAL_PI * stB.w;
	#endif
	stCol += stSpec * stC.z * mix( vec3( 1.0 ), stAlb, 0.3 );
	float stFr = 1.0 - saturate( dot( normal, stV ) );
	float stRim = smoothstep( 1.0 - stC.w - 0.03, 1.0 - stC.w + 0.03, stFr );
	stCol += stRim * stD.rgb * stD.w * stKey * 0.5;
	if ( stMk > 0.0 && stN.y > 0.0 ) {
		vec3 stR = inverseTransformDirection( reflect( - stV, normal ), viewMatrix );
		float y = stR.y;
		float line = step( 0.0, y ) - step( 0.07, y );
		float L = y > 0.0 ? ( y > 0.35 ? 1.05 : 0.72 ) : ( y > - 0.35 ? 0.16 : 0.42 );
		vec3 chrome = stAlb * ( L + line * 0.6 ) * stKey * stN.z + stSpec * stC.z;
		stCol = mix( stCol, chrome, stN.y * stMk );
	}
	outgoingLight = stCol + totalEmissiveRadiance;
}
if ( stCa > 0.0 ) outgoingLight += stAlb * stCa * ( stA.x > 0.5 ? step( 0.35, stCa ) * 0.9 : 1.0 );
`;

const FOG = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * fogDepth * fogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, fogDepth );
	#endif
	if ( stF.x > 0.0 ) {
		float stHd = stF.x * exp( - max( vStW.y - stF.y, 0.0 ) / max( stF.z, 0.1 ) );
		float stHf = 1.0 - exp( - stHd * fogDepth * 0.03 );
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - stHf );
	}
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

const OUTGOING =
  'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;';

function rep(src, find, by) {
  if (!src.includes(find)) {
    console.warn('style shader: 找不到', find);
    return src;
  }
  return src.replace(find, by);
}

let installed = false;
// 修改 MeshStandardMaterial（也涵蓋 MeshPhysicalMaterial）的著色器；只需呼叫一次，越早越好
export function installStyleShader() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  const begin = C.lights_fragment_begin.replace(
    /directLight\.color \*= (all\( bvec2\( directLight\.visible, receiveShadow \) \) \? get\w+\([^;]*\) : 1\.0);/g,
    'stSh = ( $1 ); directLight.color *= mix( mix( 1.0, stSh, stN.w ), 1.0, stA.x );',
  );
  const nmaps = C.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * stE.z;');
  const proto = THREE.MeshStandardMaterial.prototype;
  proto.onBeforeCompile = function (shader) {
    const mat = this;
    Object.assign(shader.uniforms, SU, {
      stCat: {
        get value() {
          return CAT.get(mat) || 0;
        },
      },
      stAuth: {
        get value() {
          return mat.map && AUTH.has(mat.map) ? 1 : 0;
        },
      },
      stOpq: {
        get value() {
          return mat.transparent ? 0 : 1;
        },
      },
    });
    const dec = hasDecal(mat);
    if (dec) {
      const slotCols = DECAL_SLOTS.map(() => new THREE.Color());
      Object.assign(shader.uniforms, {
        stDecT: {
          get value() {
            const d = mat.map && DECAL.get(mat.map);
            return d ? d.tex : blackTex();
          },
        },
        stDecW: {
          get value() {
            const d = mat.map && DECAL.get(mat.map);
            return (d && d.wts) || blackTex();
          },
        },
        stSlot: {
          get value() {
            const c = SLOTCOL.get(mat);
            for (let i = 0; i < 4; i++) slotCols[i].copy(c ? c[i] : mat.color);
            return slotCols;
          },
        },
      });
    }
    let v = shader.vertexShader;
    v = 'varying vec3 vStW;\n' + v;
    v = rep(
      v,
      '#include <project_vertex>',
      '#include <project_vertex>\nvec4 stWP = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\nstWP = instanceMatrix * stWP;\n#endif\nvStW = ( modelMatrix * stWP ).xyz;',
    );
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    if (dec) f = '#define ST_DECAL\n' + f;
    f = rep(
      f,
      '#include <lights_physical_pars_fragment>',
      '#include <lights_physical_pars_fragment>\n' + PARS,
    );
    f = rep(f, '#include <map_fragment>', MAP);
    f = rep(f, '#include <color_fragment>', '#include <color_fragment>\n' + AFTER_COLOR);
    f = rep(f, '#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + AFTER_METAL);
    f = rep(f, '#include <normal_fragment_maps>', nmaps);
    f = rep(f, '#include <lights_fragment_begin>', begin);
    f = rep(f, '#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + AFTER_MAPS);
    f = rep(f, OUTGOING, OUTGOING + '\n' + TOON);
    f = rep(f, '#include <fog_fragment>', FOG);
    // 不透明材質的 alpha 記分類（1＝環境、0.5＝機體），描線與動態模糊用；透明材質維持原本的 alpha
    f = rep(
      f,
      '#include <dithering_fragment>',
      '#include <dithering_fragment>\ngl_FragColor.a = mix( gl_FragColor.a, 1.0 - 0.5 * stCat, stOpq );',
    );
    shader.fragmentShader = f;
  };
  proto.customProgramCacheKey = function () {
    return hasDecal(this) ? 'rubicon-style-1d' : 'rubicon-style-1';
  };
}
