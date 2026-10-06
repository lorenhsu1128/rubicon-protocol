// 渲染風格：天空（漸層／積雲）與空氣塵埃。掛在場景裡跟著鏡頭，參數由 applySceneStyle 每格更新。
const NOISE = /* glsl */ `
float h21( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float vn( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
float fbm( vec2 p ) {
	float s = 0.0, a = 0.5;
	for ( int i = 0; i < 5; i ++ ) { s += a * vn( p ); p = p * 2.03 + vec2( 1.7, 9.2 ); a *= 0.5; }
	return s;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 horizon, top, sunDir;
uniform float cloud, toon, time;
varying vec3 vDir;
${NOISE}
void main() {
	vec3 d = normalize( vDir );
	float h = max( d.y, 0.0 );
	vec3 col = mix( horizon, top, pow( smoothstep( 0.0, 0.65, h ), 0.85 ) );
	if ( cloud > 0.0 && d.y > 0.01 ) {
		vec2 uv = d.xz / ( d.y + 0.12 ) * 0.85 + time * vec2( 0.006, 0.003 );
		float n = fbm( uv * 1.3 );
		float cov = 1.0 - cloud;
		float m = smoothstep( cov * 0.85, cov * 0.85 + 0.16, n ) * smoothstep( 0.01, 0.16, d.y );
		vec2 toSun = normalize( sunDir.xz + vec2( 1e-4 ) ) * 0.06;
		float lit = clamp( ( n - fbm( ( uv + toSun ) * 1.3 ) ) * 5.0 + 0.62, 0.0, 1.0 );
		lit = mix( lit, smoothstep( 0.45, 0.55, lit ) * 0.75 + 0.25 * lit, toon );
		m = mix( m, smoothstep( 0.4, 0.6, m ), toon );
		vec3 shadow = mix( top, vec3( 0.55, 0.58, 0.72 ), 0.55 );
		vec3 cc = mix( shadow, vec3( 1.0, 0.985, 0.95 ), lit );
		col = mix( col, cc, m );
	}
	gl_FragColor = vec4( col, 1.0 );
}
`;

const DUST_VERT = /* glsl */ `
uniform vec3 cam;
uniform float box, size, time, pr;
attribute float seed;
varying float vA;
void main() {
	vec3 p = position + vec3( sin( time * 0.3 + seed * 6.0 ), sin( time * 0.21 + seed * 9.0 ) * 0.5, cos( time * 0.27 + seed * 4.0 ) ) * 0.8;
	p += vec3( time * 0.9, 0.0, time * 0.4 );
	p = mod( p - cam + box * 0.5, box ) - box * 0.5 + cam;
	vec4 mv = modelViewMatrix * vec4( p, 1.0 );
	float dist = - mv.z;
	vA = smoothstep( 0.5, 3.0, dist ) * ( 1.0 - smoothstep( box * 0.3, box * 0.5, dist ) );
	gl_PointSize = size * pr * ( 0.6 + seed ) * 300.0 / max( dist, 0.5 );
	gl_Position = projectionMatrix * mv;
}
`;
const DUST_FRAG = /* glsl */ `
uniform vec3 color;
uniform float opacity;
varying float vA;
void main() {
	vec2 q = gl_PointCoord - 0.5;
	float a = smoothstep( 0.5, 0.1, length( q ) );
	gl_FragColor = vec4( color, a * vA * opacity );
}
`;

const DUST_N = 2400;
export class StyleAtmos {
  constructor(scene) {
    this.scene = scene;
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        horizon: { value: new THREE.Color() },
        top: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        cloud: { value: 0 },
        toon: { value: 0 },
        time: { value: 0 },
      },
      vertexShader:
        'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.visible = false;
    scene.add(this.sky);
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(DUST_N * 3),
      seed = new Float32Array(DUST_N);
    for (let i = 0; i < DUST_N; i++) {
      pos[i * 3] = Math.random() * 60;
      pos[i * 3 + 1] = Math.random() * 60;
      pos[i * 3 + 2] = Math.random() * 60;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      uniforms: {
        cam: { value: new THREE.Vector3() },
        box: { value: 60 },
        size: { value: 0.05 },
        time: { value: 0 },
        pr: { value: 1 },
        color: { value: new THREE.Color(0xd8c4a0) },
        opacity: { value: 0.5 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.dust = new THREE.Points(g, this.dustMat);
    this.dust.frustumCulled = false;
    this.dust.visible = false;
    scene.add(this.dust);
  }
  // fogColor／skyTop：已換成場景用的顏色空間；sunOff：太陽相對位置
  update(P, camera, time, fogColor, sunOff, sunColor, pr) {
    const sky = P.sky !== 'theme';
    this.sky.visible = sky;
    if (sky) {
      this.sky.position.copy(camera.position);
      const u = this.skyMat.uniforms;
      u.horizon.value.copy(fogColor);
      u.top.value.set(P.skyTop).convertSRGBToLinear();
      u.cloud.value = P.sky === 'cloud' ? P.cloud : 0;
      u.toon.value = P.skyToon;
      u.time.value = time;
      u.sunDir.value.copy(sunOff).normalize();
    }
    this.dust.visible = P.dust > 0;
    if (P.dust > 0) {
      const u = this.dustMat.uniforms;
      u.cam.value.copy(camera.position);
      u.time.value = time;
      u.pr.value = pr;
      u.opacity.value = 0.35 + P.dust * 0.4;
      u.color.value.copy(sunColor).lerp(fogColor, 0.4);
      this.dust.geometry.setDrawRange(0, Math.round(DUST_N * P.dust));
    }
  }
  dispose() {
    this.scene.remove(this.sky);
    this.scene.remove(this.dust);
  }
}
