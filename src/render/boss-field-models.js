// Boss 改版的場地效果（docs/boss-design.md 的 E）的外觀：每種效果各自的網格與動畫，純函式（不用亂數之外的狀態）。
// buildField(kind, r, o) → { group, update(t, dt, st) }；st＝場地的狀態（電擊的預警／放電、塌陷打開了沒…）。
// buildCover(rec) → 掩體（臨時障礙物的新種類：彈坑土堤、碎石、貨櫃、岩柱、混凝土牆），碰撞與血量照 hazards2.js 的臨時障礙物。
// 圓盤都貼地（y＝0 是地面，呼叫端放在地面高度），r 是世界尺寸的半徑。
const TEX = {};
// 畫布貼圖（依種類快取）
function canvasTex(key, size, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  TEX[key] = t;
  return t;
}
// 固定的偽亂數（貼圖的花紋每次一樣）
function prng(seed) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
const sandTex = () =>
  canvasTex('sand', 256, (g, S) => {
    const R = prng(7);
    const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    gr.addColorStop(0, '#5a4325');
    gr.addColorStop(0.5, '#a07c48');
    gr.addColorStop(1, 'rgba(176,140,86,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(70,50,25,.55)';
    g.lineWidth = 3;
    for (let k = 0; k < 4; k++) {
      g.beginPath();
      for (let a = 0; a < 14; a += 0.1) {
        const r = (a / 14) * (S / 2);
        const x = S / 2 + Math.cos(a + (k * Math.PI) / 2) * r,
          y = S / 2 + Math.sin(a + (k * Math.PI) / 2) * r;
        if (a === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${200 + R() * 40},${160 + R() * 40},${100 + R() * 30},${R() * 0.4})`;
      g.fillRect(R() * S, R() * S, 2, 2);
    }
  });
const iceTex = () =>
  canvasTex('ice', 256, (g, S) => {
    const R = prng(11);
    const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(220,245,255,.95)');
    gr.addColorStop(0.85, 'rgba(170,220,250,.8)');
    gr.addColorStop(1, 'rgba(170,220,250,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) {
      let x = S / 2 + (R() - 0.5) * S * 0.6,
        y = S / 2 + (R() - 0.5) * S * 0.6;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (R() - 0.5) * 40;
        y += (R() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
const hexTex = (col) =>
  canvasTex('hex' + col, 256, (g, S) => {
    g.fillStyle = '#10161e';
    g.fillRect(0, 0, S, S);
    const r = 18;
    g.strokeStyle = col;
    g.lineWidth = 2.5;
    for (let row = -1; row < 10; row++)
      for (let q = -1; q < 9; q++) {
        const cx = q * r * 1.75 + (row % 2) * r * 0.87,
          cy = row * r * 1.5;
        g.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
          const x = cx + Math.cos(a) * r,
            y = cy + Math.sin(a) * r;
          if (i) g.lineTo(x, y);
          else g.moveTo(x, y);
        }
        g.closePath();
        g.stroke();
      }
    // 外緣淡出
    const gr = g.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  });
const crackTex = (key, hot) =>
  canvasTex(key, 256, (g, S) => {
    const R = prng(hot ? 23 : 31);
    g.clearRect(0, 0, S, S);
    if (hot) {
      const gr = g.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
      gr.addColorStop(0, 'rgba(40,14,6,.95)');
      gr.addColorStop(0.8, 'rgba(30,12,6,.8)');
      gr.addColorStop(1, 'rgba(30,12,6,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, S, S);
    }
    g.strokeStyle = hot ? '#ff6a18' : '#ff4020';
    g.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const a0 = R() * Math.PI * 2;
      let x = S / 2,
        y = S / 2,
        a = a0;
      g.lineWidth = hot ? 4 : 3;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        a += (R() - 0.5) * 0.8;
        x += Math.cos(a) * 17;
        y += Math.sin(a) * 17;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
const softTex = () =>
  canvasTex('soft', 128, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.5, 'rgba(255,255,255,.5)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  });
// 貼地的圓盤：細分成同心環（呼叫端以 conformField 讓每個頂點貼著地形，userData.ground＝離地高度）
function disc(r, mat, y = 0.08) {
  const geo = new THREE.RingGeometry(0.001, r, 40, 8);
  geo.rotateX(-Math.PI / 2);
  // RingGeometry 的貼圖座標以外圈為準（0～1），和 CircleGeometry 一樣
  const m = new THREE.Mesh(geo, mat);
  m.userData.ground = y;
  m.renderOrder = 3;
  return m;
}
// 讓圓盤貼著地形（group 在世界的 (x, y, z)；hAt(x, z)＝地面高度）
export function conformField(group, hAt, K = 1) {
  group.updateMatrixWorld(true);
  const o = group.position;
  group.traverse((m) => {
    if (!m.isMesh || m.userData.ground === undefined) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + m.position.x,
        z = pos.getZ(i) + m.position.z;
      // 地形網格比取樣粗：離地抬高一點（照尺度），不讓三角形穿出來
      pos.setY(i, hAt(o.x + x, o.z + z) - o.y + (m.userData.ground + 0.22) * K);
    }
    pos.needsUpdate = true;
    m.geometry.computeBoundingSphere();
  });
}
const surf = (map, o = {}) =>
  new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, opacity: 1, ...o });
const glowM = (color, o = {}) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    ...o,
  });

// 霧團（煙霧、沙塵、暴風雪、蒸氣）：一群大的柔光片，慢慢轉
function puffs(group, r, color, n, h, op) {
  const R = prng(n * 13 + Math.round(r));
  const mat = new THREE.SpriteMaterial({
    map: softTex(),
    color,
    transparent: true,
    depthWrite: false,
    opacity: op,
  });
  const list = [];
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(mat);
    const a = R() * Math.PI * 2,
      d = Math.sqrt(R()) * r * 0.85;
    s.position.set(Math.cos(a) * d, h * (0.3 + R() * 0.9), Math.sin(a) * d);
    const k = r * (0.45 + R() * 0.4);
    s.scale.set(k, k * 0.8, 1);
    s.userData.a = a;
    s.userData.d = d;
    s.userData.sp = (R() - 0.5) * 0.25;
    group.add(s);
    list.push(s);
  }
  return { mat, list };
}

export function buildField(kind, r, o = {}) {
  const group = new THREE.Group();
  const K = o.k || 1; // 舊尺度 → 世界的倍率（元件高度用）
  let update = () => {};
  switch (kind) {
    case 'quicksand': {
      // 流沙：漩渦的沙面（貼圖本身轉動）＋揚起的沙
      const tex = sandTex().clone();
      tex.needsUpdate = true;
      tex.center.set(0.5, 0.5);
      const base = disc(r, surf(tex, { opacity: 0.95 }));
      group.add(base);
      const inner = disc(r * 0.45, surf(null, { color: 0x3a2a16, opacity: 0.35 }), 0.11);
      group.add(inner);
      const dust = puffs(group, r * 0.8, 0xc8a070, 6, 2 * K, 0.25);
      update = (t, dt) => {
        tex.rotation += dt * 0.6;
        for (const s of dust.list) s.position.y = (1 + Math.sin(t * 1.3 + s.userData.a * 3)) * K;
      };
      break;
    }
    case 'ice': {
      // 冰面：反光的冰層與裂紋，表面微微閃
      const mat = new THREE.MeshStandardMaterial({
        map: iceTex(),
        color: 0xd8f2ff,
        roughness: 0.05,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        emissive: 0x2a5a7a,
        emissiveIntensity: 0.3,
      });
      const m = disc(r, mat, 0.1);
      group.add(m);
      const shine = disc(r * 0.7, glowM(0xbfe8ff, { opacity: 0.12 }), 0.14);
      group.add(shine);
      update = (t) => {
        shine.material.opacity = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2.2));
        shine.position.x = Math.sin(t * 0.6) * r * 0.15;
      };
      break;
    }
    case 'shock': {
      // 電擊地面：六角格的導電板；預警時越來越亮、放電時發白並有電弧
      const col = o.color || '#4fc8ff';
      const base = disc(r, surf(hexTex(col), { opacity: 0.85 }));
      group.add(base);
      const glow = disc(r * 0.98, glowM(new THREE.Color(col), { opacity: 0 }), 0.12);
      group.add(glow);
      const arcs = new THREE.Group();
      group.add(arcs);
      const arcMat = new THREE.LineBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.9 });
      let lastZap = -1;
      update = (t, dt, st) => {
        const ph = st.ph || 0; // 0 平時、1 預警、2 放電
        glow.material.opacity =
          ph === 2 ? 0.75 : ph === 1 ? 0.2 + 0.25 * (0.5 + 0.5 * Math.sin(t * 22)) : 0.06;
        if (ph === 2 && st.n !== lastZap) {
          lastZap = st.n;
          while (arcs.children.length) arcs.remove(arcs.children[0]);
          const R = prng(st.n * 7 + 3);
          for (let i = 0; i < 9; i++) {
            const pts = [];
            let a = R() * Math.PI * 2,
              d = R() * r * 0.3;
            for (let k = 0; k < 7; k++) {
              pts.push(new THREE.Vector3(Math.cos(a) * d, 0.3 * K + R() * 1.2 * K, Math.sin(a) * d));
              a += (R() - 0.5) * 0.6;
              d = Math.min(r, d + r * 0.14);
            }
            arcs.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), arcMat));
          }
        }
        arcs.visible = ph === 2;
      };
      break;
    }
    case 'collapse': {
      // 地面塌陷：先出現發紅的裂縫（預警），之後變成坑洞與坑邊的碎岩
      const crack = disc(r, surf(crackTex('crack', false), { opacity: 0.9 }), 0.1);
      group.add(crack);
      const pit = new THREE.Group();
      pit.visible = false;
      group.add(pit);
      const hole = disc(r * 0.92, new THREE.MeshBasicMaterial({ color: 0x0b0a09 }), 0.06);
      pit.add(hole);
      const rim = new THREE.MeshStandardMaterial({ color: 0x5e554b, roughness: 0.95 });
      const R = prng(Math.round(r * 10));
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2 + R() * 0.2;
        const s = (0.6 + R() * 0.9) * K;
        const rk = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rim);
        rk.position.set(Math.cos(a) * r, s * 0.3, Math.sin(a) * r);
        rk.rotation.set(R() * 3, R() * 3, R() * 3);
        pit.add(rk);
      }
      update = (t, dt, st) => {
        const open = !!st.open;
        pit.visible = open;
        crack.visible = !open;
        if (!open) crack.material.opacity = 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(t * 14));
      };
      break;
    }
    case 'magma': {
      // 熔岩裂地：焦黑的地面＋發光的裂縫（脈動）＋飄起的火星
      const base = disc(r, surf(crackTex('magma', true), { opacity: 0.95 }));
      group.add(base);
      const glow = disc(r * 0.8, glowM(0xff5a10, { opacity: 0.2 }), 0.13);
      group.add(glow);
      const emb = puffs(group, r * 0.7, 0xff8a30, 5, 1.5 * K, 0.35);
      update = (t) => {
        glow.material.opacity = 0.12 + 0.14 * (0.5 + 0.5 * Math.sin(t * 3.1));
        for (const s of emb.list) s.position.y = ((t * 0.6 + s.userData.a) % 1) * 3 * K;
      };
      break;
    }
    case 'belt': {
      // 移動的燃燒帶：一長條發光的火線＋一排火焰（group 的 −Z＝前進方向，長度沿 X）
      const L = o.len || r * 4,
        Wd = o.w || r;
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(L, Wd), glowM(0xff6a20, { opacity: 0.45 }));
      strip.rotation.x = -Math.PI / 2;
      strip.position.y = 0.15;
      group.add(strip);
      const flames = [];
      const fm = glowM(0xffa040, { opacity: 0.7 });
      const n = Math.max(6, Math.round(L / (2 * K)));
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.6 * K, 2.4 * K, 6, 1, true), fm);
        c.position.set(-L / 2 + ((i + 0.5) * L) / n, 1.2 * K, 0);
        group.add(c);
        flames.push(c);
      }
      update = (t) => {
        flames.forEach((c, i) => {
          const s = 0.7 + 0.45 * (0.5 + 0.5 * Math.sin(t * 9 + i * 1.7));
          c.scale.set(1, s, 1);
          c.position.y = 1.2 * K * s;
        });
      };
      break;
    }
    case 'minefield': {
      // 地雷區：散布的感應地雷（閃燈）＋外圈的警示環
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.97, r, 64),
        glowM(0xff4030, { opacity: 0.45, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.1;
      group.add(ring);
      const R = prng(Math.round(r * 7));
      const body = new THREE.MeshStandardMaterial({ color: 0x3a3c40, roughness: 0.6, metalness: 0.5 });
      const lights = [];
      const n = Math.max(8, Math.round(r / (2.5 * K)));
      for (let i = 0; i < n; i++) {
        const a = R() * Math.PI * 2,
          d = Math.sqrt(R()) * r * 0.9;
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.45 * K, 0.55 * K, 0.25 * K, 8), body);
        m.position.set(Math.cos(a) * d, (o.air ? 2.5 + R() * 2 : 0.12) * K, Math.sin(a) * d);
        group.add(m);
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.16 * K, 6, 4), glowM(0xff3020, { opacity: 1 }));
        l.position.copy(m.position).setY(m.position.y + 0.2 * K);
        l.userData.ph = R() * 6;
        group.add(l);
        lights.push(l);
      }
      update = (t) => {
        for (const l of lights) l.material.opacity = Math.sin(t * 5 + l.userData.ph) > 0.4 ? 1 : 0.15;
        ring.material.opacity = 0.3 + 0.2 * (0.5 + 0.5 * Math.sin(t * 3));
      };
      break;
    }
    case 'haze':
    case 'steam': {
      // 霧團：煙霧（灰）、沙塵（黃）、暴風雪（白）；蒸氣另外有往上冒的蒸氣柱
      const col = o.color !== undefined ? o.color : kind === 'steam' ? 0xffffff : 0x8a8e96;
      const p = puffs(
        group,
        r,
        col,
        kind === 'steam' ? 10 : 14,
        (kind === 'steam' ? 4 : 3) * K,
        kind === 'steam' ? 0.5 : 0.62,
      );
      let cols = [];
      if (kind === 'steam') {
        const cm = glowM(0xffffff, { opacity: 0.14 });
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const c = new THREE.Mesh(new THREE.CylinderGeometry(0.9 * K, 2.2 * K, 9 * K, 10, 1, true), cm);
          c.position.set(Math.cos(a) * r * 0.45, 4.5 * K, Math.sin(a) * r * 0.45);
          group.add(c);
          cols.push(c);
        }
        group.add(disc(r, glowM(0x9fe8ff, { opacity: 0.12 }), 0.1)); // 安全區的地面
      }
      update = (t, dt) => {
        for (const s of p.list) {
          s.userData.a += s.userData.sp * dt;
          s.position.x = Math.cos(s.userData.a) * s.userData.d;
          s.position.z = Math.sin(s.userData.a) * s.userData.d;
        }
        for (const c of cols) c.scale.set(1, 0.85 + 0.15 * Math.sin(t * 2 + c.position.x), 1);
      };
      break;
    }
  }
  return { group, update };
}

// ---------- 掩體（臨時障礙物的新種類）----------
// rec：{ k, w, h, d }（世界尺寸），回傳群組（原點在底面中心，長邊沿 X）
export const COVER_KINDS = ['berm', 'rubble', 'crate', 'pillar', 'slab'];
export function buildCover(rec) {
  const g = new THREE.Group();
  const { w, h, d } = rec;
  const R = prng(Math.round(w * 13 + h * 7 + d));
  switch (rec.k) {
    case 'berm': {
      // 彈坑的土堤：弧形的土堆＋焦黑的內側
      const soil = new THREE.MeshStandardMaterial({ color: 0x6b5a44, roughness: 1 });
      const burnt = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1 });
      const n = 7;
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / n;
        const s = new THREE.Mesh(
          new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2),
          i % 3 ? soil : burnt,
        );
        s.scale.set((w / n) * 0.9, h * (0.75 + R() * 0.35), d * 0.7);
        s.position.set(x, 0, (R() - 0.5) * d * 0.3);
        g.add(s);
      }
      break;
    }
    case 'rubble': {
      // 碎石堆：壞掉的砲台殘骸（混凝土塊、扭曲的鋼板、露出的鋼筋）
      const conc = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.95 });
      const steel = new THREE.MeshStandardMaterial({ color: 0x4a4e54, roughness: 0.6, metalness: 0.6 });
      for (let i = 0; i < 8; i++) {
        const s = Math.min(w, d) * (0.25 + R() * 0.25);
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), conc);
        m.position.set(
          (R() - 0.5) * w * 0.8,
          s * 0.6 * (h / Math.max(h, s * 2)) + R() * h * 0.3,
          (R() - 0.5) * d * 0.6,
        );
        m.rotation.set(R() * 3, R() * 3, R() * 3);
        g.add(m);
      }
      for (let i = 0; i < 3; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(w * 0.5, 0.15 * h, d * 0.4), steel);
        p.position.set((R() - 0.5) * w * 0.5, h * (0.3 + R() * 0.4), (R() - 0.5) * d * 0.3);
        p.rotation.set(R() - 0.5, R() * 3, R() - 0.5);
        g.add(p);
      }
      break;
    }
    case 'crate': {
      // 落下的貨櫃：波紋板的箱體、門閂、凹陷
      const col = [0xa04a2a, 0x2a6a8a, 0x6a8a2a][Math.floor(R() * 3)];
      const shell = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.3 });
      const frame = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.5 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shell);
      b.position.y = h / 2;
      b.rotation.z = (R() - 0.5) * 0.08;
      g.add(b);
      const n = Math.round(w / (0.6 * Math.min(h, 4)));
      for (let i = 0; i <= n; i++) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(w * 0.012 + 0.05, h * 0.96, d * 1.02), frame);
        rib.position.set(-w / 2 + (i * w) / n, h / 2, 0);
        g.add(rib);
      }
      for (const s of [-1, 1]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, h * 0.06, d * 1.03), frame);
        bar.position.set(0, s > 0 ? h * 0.97 : h * 0.03, 0);
        g.add(bar);
      }
      break;
    }
    case 'pillar': {
      // 岩柱高台：分層的岩柱，頂面平（可以站上去）
      const rock = new THREE.MeshStandardMaterial({ color: 0x8b7458, roughness: 1 });
      const top = new THREE.MeshStandardMaterial({ color: 0xa48a68, roughness: 1 });
      const n = 4;
      for (let i = 0; i < n; i++) {
        const k = 1 - i * 0.08;
        const m = new THREE.Mesh(new THREE.CylinderGeometry((w / 2) * k * 0.92, (w / 2) * k, h / n, 7), rock);
        m.position.y = (i + 0.5) * (h / n);
        m.rotation.y = R() * 3;
        g.add(m);
      }
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.42, h * 0.04, 7), top);
      cap.position.y = h;
      g.add(cap);
      break;
    }
    case 'slab':
    default: {
      // 混凝土牆：升起的預鑄牆板＋鋼框＋警示條
      const conc = new THREE.MeshStandardMaterial({ color: 0xa8a49c, roughness: 0.9 });
      const steel = new THREE.MeshStandardMaterial({ color: 0x3c4046, roughness: 0.5, metalness: 0.6 });
      const warn = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.6 });
      const n = Math.max(2, Math.round(w / Math.max(2, h * 0.6)));
      for (let i = 0; i < n; i++) {
        const p = new THREE.Mesh(new THREE.BoxGeometry((w / n) * 0.96, h, d), conc);
        p.position.set(-w / 2 + ((i + 0.5) * w) / n, h / 2, 0);
        g.add(p);
      }
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.06, d * 1.1), steel);
      rail.position.y = h * 0.97;
      g.add(rail);
      const st = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, h * 0.08, d * 1.05), warn);
      st.position.y = h * 0.12;
      g.add(st);
    }
  }
  g.traverse((q) => {
    if (q.isMesh) {
      q.castShadow = true;
      q.receiveShadow = true;
    }
  });
  return g;
}
