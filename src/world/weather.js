// 天氣粒子（雪、風沙、塵埃）：只有外觀，不影響任何判定。粒子放在跟著鏡頭的方盒裡循環，
// 位置由著色器以時間推算（每格只更新 uniform）；初始位置用 Math.random，各端不必一致。
const VERT = /* glsl */ `
uniform vec3 cam, wind;
uniform float box, size, time, pr, fall, sway;
attribute float seed;
varying float vA;
void main() {
	float sp = 0.75 + seed * 0.5;
	vec3 p = position + wind * time * sp + vec3( 0.0, - fall * time * sp, 0.0 );
	p += vec3( sin( time * 0.9 + seed * 17.0 ), 0.0, cos( time * 0.7 + seed * 11.0 ) ) * sway;
	p = mod( p - cam + box * 0.5, box ) - box * 0.5 + cam;
	vec4 mv = modelViewMatrix * vec4( p, 1.0 );
	float dist = - mv.z;
	vA = smoothstep( 0.4, 2.5, dist ) * ( 1.0 - smoothstep( box * 0.32, box * 0.5, dist ) );
	gl_PointSize = size * pr * ( 0.6 + seed * 0.8 ) * 300.0 / max( dist, 0.5 );
	gl_Position = projectionMatrix * mv;
}
`;
const FRAG = /* glsl */ `
uniform vec3 color;
uniform float opacity;
varying float vA;
void main() {
	vec2 q = gl_PointCoord - 0.5;
	float a = smoothstep( 0.5, 0.15, length( q ) );
	gl_FragColor = vec4( color, a * vA * opacity );
}
`;

// n：粒子數；box：循環方盒邊長；fall：下落速度；wind：水平風速；sway：飄動幅度
const KINDS = {
  snow: { n: 3600, box: 70, size: 0.1, fall: 2.6, wind: [1.8, 0, 0.9], sway: 0.9, opacity: 0.9 },
  sand: { n: 2600, box: 56, size: 0.05, fall: 0.35, wind: [12, 0, 4.5], sway: 0.4, opacity: 0.55 },
  dust: { n: 1400, box: 60, size: 0.07, fall: 0.25, wind: [2.4, 0, 1.1], sway: 1.2, opacity: 0.35 },
};

export class Weather {
  // theme：用主題的顏色決定粒子顏色（風沙、塵埃）
  constructor(scene, kind, theme) {
    const K = KINDS[kind];
    this.scene = scene;
    if (!K) return;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(K.n * 3),
      seed = new Float32Array(K.n);
    for (let i = 0; i < K.n; i++) {
      pos[i * 3] = Math.random() * K.box;
      pos[i * 3 + 1] = Math.random() * K.box;
      pos[i * 3 + 2] = Math.random() * K.box;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    const col =
      kind === 'snow'
        ? new THREE.Color(0xffffff)
        : new THREE.Color(theme.ground).lerp(new THREE.Color(theme.fog), kind === 'sand' ? 0.35 : 0.6);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        cam: { value: new THREE.Vector3() },
        wind: { value: new THREE.Vector3(...K.wind) },
        box: { value: K.box },
        size: { value: K.size },
        time: { value: 0 },
        pr: { value: 1 },
        fall: { value: K.fall },
        sway: { value: K.sway },
        color: { value: col.convertSRGBToLinear() },
        opacity: { value: K.opacity },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }
  update(camera, time, pr) {
    if (!this.points) return;
    const u = this.mat.uniforms;
    u.cam.value.copy(camera.position);
    u.time.value = time % 10000;
    u.pr.value = pr;
  }
  dispose() {
    if (!this.points) return;
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.mat.dispose();
  }
}
