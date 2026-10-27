// 作戰室的全像戰略桌（docs/hub-ui.md）：大陸的底板＋每個區域一塊從真的關卡生成取樣的地形（game/hub-holo.js 的
// hubHoloSample），大型障礙物是線框、水面是半透明平面；委託是桌上的光柱（標籤是 DOM，game/hub-holo.js 投影）。
// 座標：總覽圖的 0～100 對到桌面 ±TABLE_R（公尺，人的尺寸）
export const TABLE_R = 3.2;
export const TABLE_Y = 1.02; // 桌面的高度
export const TILE_R = 0.8; // 一塊區域地形的半徑
export const mapToTable = (x, y) => [((x - 50) / 50) * TABLE_R, ((y - 50) / 50) * TABLE_R];

// 全像的材質：高度著色＋等高線＋掃描線（加色、不寫深度）
function holoMat(color, o = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uAlpha: { value: o.alpha != null ? o.alpha : 1 },
      uLines: { value: o.lines != null ? o.lines : 1 },
      uR: { value: o.r || TILE_R },
    },
    vertexShader: `
      varying vec3 vP; varying vec3 vW; varying float vH;
      attribute float hk;
      void main() {
        vP = position; vH = hk;
        vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime; uniform float uAlpha; uniform float uLines; uniform float uR;
      varying vec3 vP; varying vec3 vW; varying float vH;
      void main() {
        float r = length(vP.xz) / uR;
        float edge = smoothstep(1.0, 0.82, r);
        float c = fract(vH * 9.0);
        float contour = smoothstep(0.08, 0.0, min(c, 1.0 - c)) * uLines;
        float scan = 0.5 + 0.5 * sin(vW.z * 40.0 - uTime * 2.4);
        float a = (0.22 + 0.55 * vH + contour * 0.6) * edge * (0.8 + 0.2 * scan) * uAlpha;
        vec3 col = mix(uColor * 0.55, uColor * 1.6 + vec3(0.15), vH) + contour * 0.35;
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
const lineMat = (color, opacity) =>
  new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

// 一塊區域的地形：S＝{ n, h（0～1，n×n）, obs: [[x, z, w, d, h]（0～1 的座標與高度）], water（0～1 或 null）}
export function buildHoloTile(S, color, scale = 1, o = {}) {
  const g = new THREE.Group();
  const R = TILE_R * scale;
  const N = S.n;
  const geo = new THREE.PlaneGeometry(R * 2, R * 2, N - 1, N - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const hk = new Float32Array(pos.count);
  const HS = (o.hs || 0.42) * scale; // 最高處的高度（公尺）
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      z = pos.getZ(i);
    const u = Math.round(((x + R) / (2 * R)) * (N - 1)),
      v = Math.round(((z + R) / (2 * R)) * (N - 1));
    const h = S.h[v * N + u];
    const r = Math.hypot(x, z) / R;
    const fall = r > 0.92 ? Math.max(0, 1 - (r - 0.92) / 0.08) : 1; // 邊緣壓平
    pos.setY(i, h * HS * fall);
    hk[i] = h * fall;
  }
  geo.setAttribute('hk', new THREE.BufferAttribute(hk, 1));
  const m = holoMat(color, { r: R, alpha: o.alpha });
  const mesh = new THREE.Mesh(geo, m);
  g.add(mesh);
  // 大型障礙物：線框
  if (S.obs.length) {
    const pts = [];
    for (const [ox, oz, w, d, h, y0] of S.obs) {
      const x0 = (ox - w / 2) * 2 * R - R,
        x1 = (ox + w / 2) * 2 * R - R,
        z0 = (oz - d / 2) * 2 * R - R,
        z1 = (oz + d / 2) * 2 * R - R;
      if (Math.hypot((x0 + x1) / 2, (z0 + z1) / 2) > R * 0.9) continue;
      const yb = (y0 || 0) * HS,
        yt = yb + Math.max(0.01, h * HS);
      const c = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z1],
      ];
      for (let k = 0; k < 4; k++) {
        const a = c[k],
          b = c[(k + 1) % 4];
        pts.push(a[0], yt, a[1], b[0], yt, b[1], a[0], yb, a[1], a[0], yt, a[1]);
      }
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(lg, lineMat(0xbfeaff, 0.5)));
  }
  if (S.water != null) {
    const wg = new THREE.CircleGeometry(R * 0.93, 48);
    wg.rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(
      wg,
      new THREE.MeshBasicMaterial({
        color: 0x2a7fc0,
        transparent: true,
        opacity: 0.18,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    w.position.y = S.water * HS + 0.003;
    g.add(w);
  }
  g.userData.mat = m;
  return g;
}

// 桌子本體與大陸的底板
export function buildHoloTable() {
  const g = new THREE.Group();
  // 桌子：圓形底座＋發光的桌緣
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c2228, roughness: 0.5, metalness: 0.75 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x04080b });
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_R + 0.25, TABLE_R + 0.45, TABLE_Y, 64, 1),
    metal,
  );
  base.position.y = TABLE_Y / 2;
  g.add(base);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE_R + 0.2, TABLE_R + 0.2, 0.04, 64), dark);
  top.position.y = TABLE_Y;
  g.add(top);
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(TABLE_R + 0.2, 0.025, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x5cc8ff }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = TABLE_Y + 0.02;
  g.add(rim);
  // 底板：全像的格線圓盤
  const plate = new THREE.Mesh(
    new THREE.CircleGeometry(TABLE_R, 96),
    new THREE.MeshBasicMaterial({
      color: 0x0c2a3a,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  plate.rotation.x = -Math.PI / 2;
  plate.position.y = TABLE_Y + 0.025;
  g.add(plate);
  const grid = [];
  for (let k = -10; k <= 10; k++) {
    const t = (k / 10) * TABLE_R,
      w = Math.sqrt(Math.max(0, TABLE_R * TABLE_R - t * t));
    grid.push(-w, 0, t, w, 0, t, t, 0, -w, t, 0, w);
  }
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(grid, 3));
  const gl = new THREE.LineSegments(gg, lineMat(0x2f7fa8, 0.25));
  gl.position.y = TABLE_Y + 0.03;
  g.add(gl);
  return { g, plate };
}

// 委託的光柱（col＝顏色、h＝高度；open 的比較高、有光點）
export function buildBeacon(col, h, strong) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: col,
    transparent: true,
    opacity: strong ? 0.9 : 0.6,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, h, 6), mat);
  pole.position.y = h / 2;
  g.add(pole);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.05, 24), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  g.add(ring);
  if (strong) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat);
    dot.position.y = h;
    g.add(dot);
    g.userData.dot = dot;
  }
  g.userData.top = h;
  g.userData.ring = ring;
  return g;
}

// 區域的輪廓圈（開放的亮、沒開放的虛）
export function buildRegionRing(open) {
  const pts = [];
  const n = 72;
  for (let i = 0; i < n; i++) {
    if (!open && i % 2) continue;
    const a0 = (i / n) * Math.PI * 2,
      a1 = ((i + 1) / n) * Math.PI * 2;
    pts.push(
      Math.cos(a0) * TILE_R,
      0,
      Math.sin(a0) * TILE_R,
      Math.cos(a1) * TILE_R,
      0,
      Math.sin(a1) * TILE_R,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, lineMat(open ? 0x5cc8ff : 0x2a4a60, open ? 0.7 : 0.45));
}

export function tickHolo(root, t) {
  root.traverse((o) => {
    const m = o.material;
    if (m && m.uniforms && m.uniforms.uTime) m.uniforms.uTime.value = t;
  });
}

export function disposeTree(o) {
  o.traverse((x) => {
    if (x.geometry) x.geometry.dispose();
    if (x.material) (Array.isArray(x.material) ? x.material : [x.material]).forEach((m) => m.dispose());
  });
}
