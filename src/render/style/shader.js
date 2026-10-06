// 渲染風格：全域修改 MeshStandardMaterial 的著色器（色階光照、影色、高光、邊緣光、機體金屬、貼圖細節、
// 高度霧、水彩地形）。所有風格寫在同一份著色器裡、以 uniform 切換，所以調參數不用重新編譯；
// 參數全是 0 的「寫實」走原本的物理渲染路徑，畫面與修改前相同。
// 材質分類（機甲／武器／載具＝1、其他＝0）用 WeakMap 記，不寫 userData（GLTFExporter 會把 userData 寫進 GLB）。

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
};

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
export function setStyleUniforms(P) {
  const sh = lin(P.shade).multiplyScalar(P.shadeK);
  const rc = lin(P.rimColor);
  SU.stA.value.set(P.toon ? 1 : 0, P.steps, P.thresh, P.soft);
  SU.stB.value.set(sh.r, sh.g, sh.b, P.ambient);
  SU.stC.value.set(P.specSize, P.specSoft, P.spec, P.rimW);
  SU.stD.value.set(rc.r, rc.g, rc.b, P.rim);
  SU.stE.value.set(P.mechDetail, P.envDetail, P.normalK, P.envRefl);
  SU.stM.value.set(P.metal ? 1 : 0, P.metalness, P.roughness, P.metalTint);
  SU.stN.value.set(P.metalRefl, P.toon ? P.metalAnime : 0, P.litK, P.shadowK);
  SU.stF.value.set(P.hfog, P.hfogH, P.hfogFall, P.water);
  SU.stW.value.set(P.waterScale, 0, 0, 0);
}

const PARS = /* glsl */ `
uniform vec4 stA, stB, stC, stD, stE, stM, stN, stF, stW;
uniform float stCat, stOpq;
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
	float stDet = mix( stE.y, stE.x, stCat );
	if ( stDet < 0.999 ) texelColor = mix( texture2D( map, vUv, 10.0 ), texelColor, stDet );
	texelColor = mapTexelToLinear( texelColor );
	diffuseColor *= texelColor;
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
      stOpq: {
        get value() {
          return mat.transparent ? 0 : 1;
        },
      },
    });
    let v = shader.vertexShader;
    v = 'varying vec3 vStW;\n' + v;
    v = rep(
      v,
      '#include <project_vertex>',
      '#include <project_vertex>\nvec4 stWP = vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\nstWP = instanceMatrix * stWP;\n#endif\nvStW = ( modelMatrix * stWP ).xyz;',
    );
    shader.vertexShader = v;
    let f = shader.fragmentShader;
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
  proto.customProgramCacheKey = () => 'rubicon-style-1';
}
