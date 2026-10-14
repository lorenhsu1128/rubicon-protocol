// 過場動畫的專用場景（game/cine.js）：軌道上的太空（行星、大氣、星空、碎片帶、太陽能環、軌道站、軌道電纜）、
// 空降艙與墜落現場。全部程式產生，純函式（不呼叫遊戲的亂數串，用自己的 makeRng），模型庫登記 vehicle/cine_*。
// 座標：太空場景的鏡頭在原點附近，行星中心在 (0, -PLANET_R - ALT, 0)，所以原點離地 ALT 公尺。
import { makeRng } from '../core/math.js';
import { CB, P, bakeAll, gBox, gCyl, gSph } from './geometry.js';
import { mechMats } from './materials.js';
import { tagStyle } from './style/shader.js';

export const PLANET_R = 2400;
export const ALT = 600;
export const PLANET_C = new THREE.Vector3(0, -PLANET_R - ALT, 0);
// 太陽方向（太空場景）：剛好在地平線上方、逆光（行星大半在陰影裡，邊緣一圈亮的晨昏線）
export const SPACE_SUN = new THREE.Vector3(0.3, -0.42, -0.86).normalize();

// 白灰色的工業外殼（軌道站、空降艙；照預告片的運輸艦：白灰、橘色警示條、綠色指示燈）
export const CINE_PAL = {
  main: 0xc9cdd1,
  main2: 0x8d9298,
  main3: 0xd4d7da,
  sub: 0x2a2e33,
  acc: 0xc9572c,
  joint: 0x26292d,
  visor: 0x46ff9a,
  glow: 0x8fe8ff,
};

const NOISE3 = /* glsl */ `
float h31( vec3 p ) { return fract( sin( dot( p, vec3( 127.1, 311.7, 74.7 ) ) ) * 43758.5453 ); }
float vn3( vec3 p ) {
	vec3 i = floor( p ), f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = mix( h31( i ), h31( i + vec3( 1, 0, 0 ) ), f.x ), b = mix( h31( i + vec3( 0, 1, 0 ) ), h31( i + vec3( 1, 1, 0 ) ), f.x );
	float c = mix( h31( i + vec3( 0, 0, 1 ) ), h31( i + vec3( 1, 0, 1 ) ), f.x ), d = mix( h31( i + vec3( 0, 1, 1 ) ), h31( i + vec3( 1, 1, 1 ) ), f.x );
	return mix( mix( a, b, f.y ), mix( c, d, f.y ), f.z );
}
float fbm3( vec3 p ) {
	float s = 0.0, a = 0.5;
	for ( int i = 0; i < 6; i ++ ) { s += a * vn3( p ); p = p * 2.07 + vec3( 1.7, 9.2, 4.1 ); a *= 0.5; }
	return s;
}
`;

// 行星：大陸、海、極冠、雲層、晨昏線；夜側的 Coral 紅色脈絡（伏筆）
const PLANET_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vW;
void main() {
	vN = normalize( mat3( modelMatrix ) * normal );
	vec4 w = modelMatrix * vec4( position, 1.0 );
	vW = w.xyz;
	gl_Position = projectionMatrix * viewMatrix * w;
}`;
const PLANET_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform float time; uniform float coral; uniform float bright;
varying vec3 vN; varying vec3 vW;
${NOISE3}
void main() {
	vec3 n = normalize( vN );
	vec3 v = normalize( cameraPosition - vW );
	float land = smoothstep( 0.5, 0.54, fbm3( n * 7.0 + vec3( 3.1 ) ) );
	float rough = fbm3( n * 40.0 );
	vec3 ocean = vec3( 0.025, 0.045, 0.07 );
	vec3 soil = mix( vec3( 0.16, 0.15, 0.14 ), vec3( 0.34, 0.32, 0.29 ), rough );
	vec3 col = mix( ocean, soil, land );
	float pole = smoothstep( 0.72, 0.86, abs( n.y + ( rough - 0.5 ) * 0.2 ) );
	col = mix( col, vec3( 0.75, 0.78, 0.8 ), pole );
	// 雲：兩層，慢慢漂移
	vec3 q = n * 11.0 + vec3( time * 0.004, 0.0, time * 0.002 );
	float cl = smoothstep( 0.55, 0.8, fbm3( q ) ) * 0.9 + smoothstep( 0.62, 0.82, fbm3( n * 34.0 + vec3( 0.0, time * 0.003, 0.0 ) ) ) * 0.35;
	cl = clamp( cl, 0.0, 1.0 );
	float d = dot( n, sunDir );
	float day = smoothstep( -0.12, 0.28, d );
	vec3 lit = col * ( 0.006 + 1.0 * max( d, 0.0 ) );
	lit = mix( lit, vec3( 0.92, 0.94, 0.97 ) * ( 0.01 + 0.95 * max( d, 0.0 ) ), cl * 0.9 );
	// 海面的太陽反光
	vec3 h = normalize( sunDir + v );
	lit += vec3( 1.0, 0.95, 0.85 ) * pow( max( dot( n, h ), 0.0 ), 90.0 ) * ( 1.0 - land ) * ( 1.0 - cl ) * day * 0.5;
	// 夜側：Coral 的紅色脈絡
	float vein = ( 1.0 - smoothstep( 0.0, 0.012, abs( fbm3( n * 60.0 + vec3( 7.0 ) ) - 0.5 ) ) ) * land * ( 1.0 - cl * 0.8 );
	lit += vec3( 1.0, 0.16, 0.1 ) * vein * ( 1.0 - day ) * coral * 0.35;
	// 邊緣的大氣散射
	float rim = pow( 1.0 - max( dot( n, v ), 0.0 ), 4.0 );
	lit = mix( lit, vec3( 0.45, 0.62, 0.95 ) * ( 0.25 + day ), rim * 0.4 * smoothstep( -0.3, 0.2, d ) );
	gl_FragColor = vec4( lit * bright, 1.0 );
}`;
// 大氣層的外殼（加色）：邊緣發亮、日側較亮
const ATMO_FRAG = /* glsl */ `
uniform vec3 sunDir; uniform vec3 tint; uniform float k;
varying vec3 vN; varying vec3 vW;
void main() {
	vec3 n = normalize( vN );
	vec3 v = normalize( cameraPosition - vW );
	float f = pow( 1.0 - abs( dot( n, v ) ), 3.2 );
	float d = dot( n, sunDir );
	float a = f * ( 0.15 + 1.3 * smoothstep( -0.35, 0.5, d ) ) * k;
	gl_FragColor = vec4( tint * a, 1.0 );
}`;

function glowTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.18, inner.replace(/[\d.]+\)$/, '0.55)'));
  g.addColorStop(1, outer);
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
// 電漿外殼的貼圖：橫向條紋（沿著高度捲動）＋往尾端淡出
let PLASMA = null;
function plasmaTex() {
  if (PLASMA) return PLASMA;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const x = c.getContext('2d');
  const rng = makeRng(77);
  for (let y = 0; y < 256; y++) {
    const fall = Math.pow(1 - y / 256, 1.6);
    for (let i = 0; i < 64; i += 4) {
      const v = (0.35 + rng() * 0.65) * fall;
      x.fillStyle = `rgba(255,${Math.round(150 + 90 * v)},${Math.round(80 + 80 * v)},${v})`;
      x.fillRect(i, y, 4, 1);
    }
  }
  PLASMA = new THREE.CanvasTexture(c);
  PLASMA.wrapS = PLASMA.wrapT = THREE.RepeatWrapping;
  return PLASMA;
}
let GLOW = null;
export function glowTex() {
  return GLOW || (GLOW = glowTexture());
}

// 太陽能板的面板貼圖（格線＋反光）
function panelTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#10161f';
  x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 4; j++) {
      const l = 30 + ((i * 7 + j * 13) % 5) * 6;
      x.fillStyle = `rgb(${l},${l + 8},${l + 22})`;
      x.fillRect(i * 16 + 1, j * 16 + 1, 14, 14);
    }
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// ---------- 太空場景 ----------
export function buildSpaceSet(scene) {
  const rng = makeRng(90731);
  const root = new THREE.Group();
  root.name = 'cineSpace';
  // 行星
  const pu = {
    sunDir: { value: SPACE_SUN.clone() },
    time: { value: 0 },
    coral: { value: 0.6 },
    bright: { value: 0.62 },
  };
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_R, 160, 120),
    new THREE.ShaderMaterial({ uniforms: pu, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }),
  );
  planet.position.copy(PLANET_C);
  planet.userData.noFade = true;
  root.add(planet);
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(PLANET_R * 1.03, 120, 90),
    new THREE.ShaderMaterial({
      uniforms: {
        sunDir: pu.sunDir,
        tint: { value: new THREE.Color(0.55, 0.72, 1.0) },
        k: { value: 0.75 },
      },
      vertexShader: PLANET_VERT,
      fragmentShader: ATMO_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  atmo.position.copy(PLANET_C);
  root.add(atmo);
  // 星空：跟著鏡頭
  const sg = new THREE.BufferGeometry();
  const N = 3600,
    sp = new Float32Array(N * 3),
    sc = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = rng() * 2 - 1,
      a = rng() * Math.PI * 2,
      r = Math.sqrt(1 - u * u);
    sp[i * 3] = Math.cos(a) * r * 5200;
    sp[i * 3 + 1] = u * 5200;
    sp[i * 3 + 2] = Math.sin(a) * r * 5200;
    const b = 0.35 + rng() ** 3 * 0.9,
      w = rng();
    sc[i * 3] = b * (w < 0.2 ? 1 : 0.85);
    sc[i * 3 + 1] = b * 0.92;
    sc[i * 3 + 2] = b * (w > 0.7 ? 1.1 : 0.95);
  }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(sc, 3));
  const stars = new THREE.Points(
    sg,
    new THREE.PointsMaterial({
      size: 1.6,
      sizeAttenuation: false,
      vertexColors: true,
      fog: false,
      depthWrite: false,
    }),
  );
  stars.frustumCulled = false;
  stars.renderOrder = -5;
  root.add(stars);
  // 太陽
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex(),
      color: 0xdff0ff,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  sun.scale.set(320, 320, 1);
  root.add(sun);
  // 碎片帶：鏡頭附近的扇形區域（軌道高度）＋近景
  const rock = new THREE.IcosahedronGeometry(1, 0);
  const rmat = new THREE.MeshStandardMaterial({
    color: 0x45484c,
    roughness: 0.95,
    metalness: 0.15,
    flatShading: true,
  });
  const debris = new THREE.InstancedMesh(rock, rmat, 2600);
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    s3 = new THREE.Vector3();
  for (let i = 0; i < 2600; i++) {
    let x, y, z, sz;
    if (i < 2100) {
      // 扇形帶：以行星中心為圓心、半徑 R+ALT±60，角度在鏡頭前後 ±32°
      const ang = (rng() * 2 - 1) * 0.56,
        rr = PLANET_R + ALT + (rng() * 2 - 1) * 70 - 40,
        lat = (rng() * 2 - 1) * 0.5;
      x = Math.sin(lat) * rr * 0.3 + (rng() * 2 - 1) * 260;
      y = PLANET_C.y + Math.cos(ang) * rr;
      z = -Math.sin(ang) * rr;
      sz = 0.4 + rng() ** 4 * 5;
    } else {
      // 近景（視差用）：離原點 70～320 m 的殼層，避開鏡頭經過的地方
      const u = rng() * 2 - 1,
        a = rng() * Math.PI * 2,
        r = 70 + rng() * 250;
      x = Math.cos(a) * Math.sqrt(1 - u * u) * r;
      y = u * r * 0.35 - 10;
      z = Math.sin(a) * Math.sqrt(1 - u * u) * r;
      sz = 0.3 + rng() ** 3 * 2.2;
    }
    e.set(rng() * 6, rng() * 6, rng() * 6);
    q.setFromEuler(e);
    s3.set(sz, sz * (0.5 + rng()), sz * (0.6 + rng() * 0.8));
    m4.compose(v.set(x, y, z), q, s3);
    debris.setMatrixAt(i, m4);
  }
  debris.instanceMatrix.needsUpdate = true;
  debris.castShadow = false;
  const debrisPivot = new THREE.Group();
  debrisPivot.position.copy(PLANET_C);
  debris.position.copy(PLANET_C).negate();
  debrisPivot.add(debris);
  root.add(debrisPivot);
  // 太陽能環：在鏡頭上方的大圓弧（畫面左上），桁架＋面板
  const ring = new THREE.Group();
  const RR = PLANET_R + ALT + 260;
  const pmat = new THREE.MeshStandardMaterial({
    map: panelTexture(),
    color: 0xffffff,
    emissive: 0x0a1018,
    roughness: 0.25,
    metalness: 0.75,
  });
  const tmat = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.6, metalness: 0.7 });
  const nP = 90;
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(46, 1.2, 30), pmat, nP * 2);
  const truss = new THREE.InstancedMesh(new THREE.BoxGeometry(4, 4, 60), tmat, nP);
  for (let i = 0; i < nP; i++) {
    const a = -0.32 + (i / nP) * 0.5;
    const px = Math.sin(a) * RR,
      py = Math.cos(a) * RR;
    q.setFromEuler(e.set(0, 0, -a));
    for (let k = 0; k < 2; k++) {
      m4.compose(v.set(px, py, (k ? 1 : -1) * 34), q, s3.set(1, 1, 1));
      panels.setMatrixAt(i * 2 + k, m4);
    }
    m4.compose(v.set(px, py, 0), q, s3.set(1, 1, 1));
    truss.setMatrixAt(i, m4);
  }
  ring.add(panels, truss);
  ring.position.copy(PLANET_C);
  ring.rotation.set(0.62, 0.95, 0.16); // 斜斜地橫過畫面左上
  ring.updateMatrixWorld();
  root.add(ring);
  // 軌道站與軌道電纜（畫面右側斜插下去的巨大構造）
  const station = buildStation();
  station.group.position.set(330, 70, -560);
  station.group.rotation.set(0.18, -0.55, -0.42);
  root.add(station.group);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(1.6, 1.6, 2600, 8, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x3a3e45, roughness: 0.5, metalness: 0.8 }),
  );
  station.group.updateMatrixWorld();
  const top = new THREE.Vector3(0, -90, 0).applyMatrix4(station.group.matrixWorld);
  const dir = PLANET_C.clone().sub(top).normalize();
  cable.position.copy(top).addScaledVector(dir, 1300);
  cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  root.add(cable);
  // 行星的反光（從下方來的冷色補光）
  const bounce = new THREE.DirectionalLight(0x8fb0e0, 0.55);
  bounce.position.set(0, -1, 0.2);
  root.add(bounce);
  scene.add(root);
  tagStyle(station.group);
  return {
    root,
    planet,
    atmo,
    stars,
    sun,
    debris: debrisPivot,
    ring,
    station,
    pu,
    update(t, cam) {
      pu.time.value = t;
      stars.position.copy(cam.position);
      sun.position.copy(cam.position).addScaledVector(pu.sunDir.value, 4600);
      debrisPivot.rotation.x = -t * 0.0016; // 碎片帶慢慢往鏡頭前方漂
    },
    dispose() {
      scene.remove(root);
      root.traverse((o) => {
        if (o.geometry && !o.geometry.parameters) o.geometry.dispose();
      });
    },
  };
}

// 軌道站：長長的脊柱、模組、環、散熱板、投放艙口（艙口在 -Y 端；pod 掛在 bay 底下）
export function buildStation() {
  const g = new THREE.Group();
  g.name = 'cineStation';
  const M = mechMats(CINE_PAL);
  const rng = makeRng(4417);
  const hull = new THREE.Group();
  g.add(hull);
  // 脊柱：一節一節（近拍時看得到接縫），沿 Y 軸
  for (let i = 0; i < 18; i++) {
    const y = -80 + i * 22;
    const r = i % 3 === 0 ? 15 : 12;
    P(hull, gCyl(r, r, 20, 12), i % 2 ? M.main : M.main2, 0, y, 0);
    P(hull, gCyl(r + 1.2, r + 1.2, 1.6, 12), M.sub, 0, y + 10.5, 0);
    // 外掛的模組與管線
    for (let k = 0; k < 4; k++) {
      if (rng() < 0.35) continue;
      const a = (k / 4) * Math.PI * 2 + rng() * 0.4;
      const w = 6 + rng() * 6,
        h = 10 + rng() * 10;
      CB(
        hull,
        w,
        h,
        5 + rng() * 4,
        k % 2 ? M.main3 : M.grey,
        Math.cos(a) * (r + 3),
        y,
        Math.sin(a) * (r + 3),
        0,
        -a,
        0,
        0.8,
      );
    }
    P(hull, gCyl(1.4, 1.4, 22, 6), M.joint, r + 1.5, y, 4);
  }
  // 環狀居住區
  for (const y of [40, 150, 250]) {
    const ringG = new THREE.Group();
    ringG.position.y = y;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      CB(ringG, 16, 7, 9, i % 4 === 0 ? M.acc : M.main, Math.cos(a) * 44, 0, Math.sin(a) * 44, 0, -a, 0, 0.8);
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      P(ringG, gBox(40, 2.4, 2.4), M.sub, Math.cos(a) * 24, 0, Math.sin(a) * 24, 0, -a, 0);
    }
    g.add(ringG);
  }
  // 散熱板（大翼）
  const wing = new THREE.Group();
  for (const s of [-1, 1]) {
    P(wing, gBox(160, 1, 46), M.main3, s * 98, 200, 0);
    for (let i = 0; i < 6; i++) P(wing, gBox(2, 1.6, 46), M.sub, s * (24 + i * 28), 200, 0);
  }
  g.add(wing);
  // 投放艙口（-Y 端）：框架與夾爪；艙口的燈（開啟時變紅）
  const bay = new THREE.Group();
  bay.position.y = -96;
  CB(bay, 30, 14, 30, M.main2, 0, 0, 0, 0, 0, 0, 1.2);
  for (const [x, z] of [
    [-11, -11],
    [11, -11],
    [-11, 11],
    [11, 11],
  ])
    CB(bay, 3, 16, 3, M.sub, x, -12, z, 0, 0, 0, 0.4);
  g.add(bay);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0x40ff90 });
  const lamps = [];
  for (let i = 0; i < 6; i++) {
    const l = new THREE.Mesh(gSph(0.9, 8), lampMat);
    const a = (i / 6) * Math.PI * 2;
    l.position.set(Math.cos(a) * 16, -96 - 7, Math.sin(a) * 16);
    g.add(l);
    lamps.push(l);
  }
  bakeAll(g);
  return { group: g, bay, lampMat };
}

// ---------- 空降艙（vehicle/cine_pod）：裡面裝著一台 AC。機頭（熱罩）朝 -Y，尾端 +Y 有 4 具推進器 ----------
export function buildPod() {
  const g = new THREE.Group();
  g.name = 'cinePod';
  const M = mechMats(CINE_PAL);
  const body = new THREE.Group();
  g.add(body);
  P(body, gCyl(2.7, 2.7, 6.5, 10), M.main, 0, 0.6, 0);
  P(body, gCyl(2.75, 2.75, 0.5, 10), M.acc, 0, 2.2, 0);
  P(body, gCyl(2.75, 2.75, 0.3, 10), M.sub, 0, -1.6, 0);
  P(body, gCyl(2.7, 1.2, 2.6, 10), M.main2, 0, -3.9, 0); // 熱罩
  P(body, gCyl(1.2, 0.5, 0.8, 10), M.sub, 0, -5.6, 0);
  P(body, gCyl(2.3, 2.7, 1.2, 10), M.main3, 0, 4.4, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const x = Math.cos(a),
      z = Math.sin(a);
    CB(body, 0.35, 4.2, 2.2, M.main3, x * 2.9, -0.4, z * 2.9, 0, -a, 0, 0.1); // 翼
    P(body, gCyl(0.55, 0.75, 1.3, 8), M.joint, x * 1.4, 5.4, z * 1.4); // 噴嘴
    CB(body, 1.2, 1.4, 0.5, M.grey, x * 2.5, 1.2, z * 2.5, 0, -a, 0, 0.1); // 艙門鉸鍊
  }
  // 指示燈
  const lamp = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const l = new THREE.Mesh(gSph(0.18, 6), lamp);
    l.position.set(Math.cos(a) * 2.78, 2.2, Math.sin(a) * 2.78);
    g.add(l);
  }
  bakeAll(g);
  // 推進器火焰（加色圓錐，scale.y＝推力）
  const fmat = new THREE.MeshBasicMaterial({
    map: glowTex(),
    color: 0xff9a70,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const flames = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.75, 6, 10, 1, true), fmat);
    f.geometry.translate(0, -3, 0);
    f.rotation.x = Math.PI;
    f.position.set(Math.cos(a) * 1.4, 6.1, Math.sin(a) * 1.4);
    f.scale.set(1, 0.001, 1);
    f.visible = false;
    g.add(f);
    flames.push(f);
  }
  // 大氣層突入的電漿：機頭的發光＋往後展開的電漿外殼（加色）
  const heat = new THREE.Group();
  heat.position.y = -5.4;
  const nose = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex(),
      color: 0xffb070,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  nose.scale.set(7, 7, 1);
  heat.add(nose);
  const sheath = new THREE.Mesh(
    new THREE.ConeGeometry(9, 24, 28, 1, true),
    new THREE.MeshBasicMaterial({
      map: plasmaTex(),
      color: 0xff8040,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  sheath.geometry.translate(0, -12, 0); // 尖端在機頭，往後（+Y）張開（震波）
  sheath.rotation.x = Math.PI;
  heat.add(sheath);
  g.add(heat);
  tagStyle(g);
  heat.visible = false;
  return {
    group: g,
    flames,
    heat,
    setThrust(k, t) {
      for (let i = 0; i < flames.length; i++) {
        const f = flames[i];
        const j = k > 0 ? 0.85 + Math.sin(t * 60 + i * 2.1) * 0.15 : 0;
        f.scale.set(0.6 + k * 0.6, Math.max(0.001, k * j * 1.6), 0.6 + k * 0.6);
        f.visible = k > 0.01;
      }
    },
    setHeat(k, t = 0) {
      heat.visible = k > 0.01;
      const f = 0.85 + Math.sin(t * 47) * 0.08 + Math.sin(t * 23) * 0.07;
      nose.material.opacity = Math.min(0.8, k * 0.8) * f;
      sheath.material.opacity = Math.min(1, k) * 0.9 * f;
      sheath.scale.set(0.7 + k * 0.4, 0.5 + k * 0.8 * f, 0.7 + k * 0.4);
      sheath.material.map.offset.y = -t * 2.5;
    },
  };
}

// 墜落現場：焦黑的坑（貼地）＋斜插在地上的空降艙（艙門打開）
export function buildCrashSite(groundAt) {
  const g = new THREE.Group();
  g.name = 'cineCrash';
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(64, 64, 4, 64, 64, 64);
  gr.addColorStop(0, 'rgba(12,10,9,0.95)');
  gr.addColorStop(0.55, 'rgba(30,24,20,0.75)');
  gr.addColorStop(1, 'rgba(30,24,20,0)');
  x.fillStyle = gr;
  x.fillRect(0, 0, 128, 128);
  const scorch = new THREE.Mesh(
    new THREE.PlaneGeometry(26, 26),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(c),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    }),
  );
  scorch.rotation.x = -Math.PI / 2;
  scorch.position.y = 0.06;
  g.add(scorch);
  // 坑的土堆
  const M = mechMats({ ...CINE_PAL, main: 0x5d5246, main2: 0x4a4038, main3: 0x6a5e50 });
  const rim = new THREE.Group();
  const rng = makeRng(5521);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rng() * 0.2;
    const r = 8 + rng() * 2;
    P(
      rim,
      gBox(4 + rng() * 3, 1 + rng() * 1.4, 2 + rng() * 2),
      M.main,
      Math.cos(a) * r,
      0.3,
      Math.sin(a) * r,
      rng(),
      -a,
      rng() * 0.4,
    );
  }
  g.add(rim);
  bakeAll(g);
  const pod = buildPod();
  pod.group.rotation.set(0.5, 0.4, 0.3); // 斜插：機頭在地下
  pod.group.position.set(1.5, 1.4, -1);
  pod.group.scale.setScalar(0.8);
  g.add(pod.group);
  tagStyle(g);
  if (groundAt) g.userData.groundAt = groundAt;
  return { group: g, pod };
}
