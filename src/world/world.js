// ============================================================
//  WORLD — 隨機關卡生成
// ============================================================
// legacy prop helpers
import { RNG, clamp, lerp, makeNoise, makeRng, pick, rnd, rndi, withRng } from '../core/math.js';

const MatCache = {};
function mat(color, opts) {
  const k = color + '|' + JSON.stringify(opts || {});
  if (MatCache[k]) return MatCache[k];
  const m = new THREE.MeshStandardMaterial(
    Object.assign({ color, roughness: 0.62, metalness: 0.28, flatShading: true }, opts || {}),
  );
  MatCache[k] = m;
  return m;
}
export function box(w, h, d, m, x = 0, y = 0, z = 0) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.position.set(x, y, z);
  g.castShadow = true;
  g.receiveShadow = true;
  return g;
}
export function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  g.position.set(x, y, z);
  g.castShadow = true;
  return g;
}
const ARENA = 150,
  CELL = 2.5,
  GRID = Math.round(ARENA / CELL);
export const THEMES = {
  snow: {
    name: '極地封鎖區',
    ground: 0xbfc8d1,
    slope: 0x3a4048,
    rock: 0x2c3238,
    fog: 0xb3bfcb,
    sky: 0xb7c4d0,
    sun: 0xfff2dc,
    amb: 0x8fa0b4,
    container: 0x6b7d6a,
    container2: 0xd7a23c,
    hasRocks: true,
  },
  industrial: {
    name: '貨運集散場',
    ground: 0x5c626a,
    slope: 0x40454c,
    rock: 0x4a4f56,
    fog: 0x9aa3ad,
    sky: 0xa9b3bc,
    sun: 0xfff0d0,
    amb: 0x8894a2,
    container: 0xe0a020,
    container2: 0x2b4fb0,
    hasRocks: false,
  },
  grid: {
    name: '模擬訓練場',
    ground: 0x9ea6b3,
    slope: 0x7a828e,
    rock: 0x6f757f,
    fog: 0xc4cbd6,
    sky: 0xcdd4de,
    sun: 0xfff6ea,
    amb: 0xa8b0bc,
    container: 0xd2d6de,
    container2: 0xc8ccd4,
    hasRocks: false,
    flat: true,
    grid: true,
  },
  desert: {
    name: '礦坑遺跡',
    ground: 0x9c8360,
    slope: 0x5a4636,
    rock: 0x5a4636,
    fog: 0xd8c7a8,
    sky: 0xe3d4b7,
    sun: 0xffe8c0,
    amb: 0xb8a48a,
    container: 0x7c8790,
    container2: 0xb8452a,
    hasRocks: true,
  },
};

export class World {
  constructor(scene, theme, seed, level, feat) {
    this.scene = scene;
    this.theme = THEMES[theme];
    this.themeKey = theme;
    this.level = level;
    this.seed = seed;
    this.noise = makeNoise(seed);
    this.noise2 = makeNoise(seed * 7 + 3);
    this.rng = makeRng(seed * 13 + 7);
    this.obstacles = [];
    this.occluders = [];
    this.meshes = [];
    this.h = new Float32Array((GRID + 1) * (GRID + 1));
    withRng(seed * 31 + 11, () => {
      if (feat) {
        this.features = feat.map((f) => ({
          k: f.k,
          kind: f.kind,
          dir: f.dir ? new THREE.Vector2(f.dir[0], f.dir[1]) : undefined,
          perp: f.perp ? new THREE.Vector2(f.perp[0], f.perp[1]) : undefined,
          off: f.off,
          width: f.width,
          depth: f.depth,
          bridges: f.bridges,
          deckW: f.deckW,
          center: f.center,
          span: f.span,
          rampL: f.rampL,
          deckH: f.deckH,
          count: f.count,
          len: f.len,
        }));
        this.featureNames = this.features
          .filter((f) => f.k !== 'corridor')
          .map(
            (f) =>
              ({
                river_bridge: '河道與橋梁',
                overpass: '高架橋',
                bunkers: '掩體群',
                trench: '壕溝',
                platforms: '高台',
              })[f.k],
          );
        const cf = this.features.find((f) => f.k === 'corridor');
        if (cf) {
          this.corridor = { kind: cf.kind, dir: cf.dir, perp: cf.perp, off: cf.off, width: 10, len: cf.len };
          this.featureNames.push(cf.kind === 'road' ? '穿越公路' : '穿越鐵路');
        }
      } else this.planFeatures();
      this.buildTerrain();
      this.buildFeatures();
      this.buildProps();
    });
  }
  hAt(i, j) {
    i = clamp(i, 0, GRID);
    j = clamp(j, 0, GRID);
    return this.h[j * (GRID + 1) + i];
  }
  terrainHeight(x, z) {
    const fx = (x + ARENA / 2) / CELL,
      fz = (z + ARENA / 2) / CELL;
    const i = Math.floor(fx),
      j = Math.floor(fz),
      u = fx - i,
      v = fz - j;
    return lerp(
      lerp(this.hAt(i, j), this.hAt(i + 1, j), u),
      lerp(this.hAt(i, j + 1), this.hAt(i + 1, j + 1), u),
      v,
    );
  }
  buildTerrain() {
    const T = this.theme,
      n = this.noise,
      n2 = this.noise2;
    const plateaus = [];
    const pc = T.flat ? rndi(0, 1) : rndi(2, 4);
    for (let k = 0; k < pc; k++)
      plateaus.push({
        x: rnd(-45, 45),
        z: rnd(-45, 45),
        w: rnd(14, 30),
        d: rnd(14, 30),
        h: rnd(3, 7),
        r: rnd(4, 8),
      });
    const cliffPts = [];
    for (let k = 0; k < (T.flat ? 0 : rndi(2, 4)); k++)
      cliffPts.push({ x: rnd(-55, 55), z: rnd(-55, 55), r: rnd(9, 16), h: rnd(6, 10) });
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) {
        const x = i * CELL - ARENA / 2,
          z = j * CELL - ARENA / 2;
        let h = T.flat ? 0 : n(x * 0.03, z * 0.03) * 1.2 + n2(x * 0.1, z * 0.1) * 0.3;
        for (const p of plateaus) {
          const dx = Math.max(Math.abs(x - p.x) - p.w / 2, 0),
            dz = Math.max(Math.abs(z - p.z) - p.d / 2, 0);
          const d = Math.sqrt(dx * dx + dz * dz);
          const t = clamp(1 - d / p.r, 0, 1);
          h += p.h * (t * t * (3 - 2 * t));
        }
        for (const c of cliffPts) {
          const d = Math.hypot(x - c.x, z - c.z);
          const t = clamp(1 - d / c.r, 0, 1);
          h += c.h * t * t;
        }
        const edge = Math.max(Math.abs(x), Math.abs(z)) / (ARENA / 2);
        const et = clamp((edge - 0.78) / 0.22, 0, 1);
        h += et * et * 16 + n(x * 0.2, z * 0.2) * et * 4; // enclosing cliffs
        h = this.featureHeight(x, z, h);
        this.h[j * (GRID + 1) + i] = h;
      }
    // smooth a little
    const s = new Float32Array(this.h);
    for (let j = 1; j < GRID; j++)
      for (let i = 1; i < GRID; i++) {
        s[j * (GRID + 1) + i] =
          (this.hAt(i, j) * 4 +
            this.hAt(i - 1, j) +
            this.hAt(i + 1, j) +
            this.hAt(i, j - 1) +
            this.hAt(i, j + 1)) /
          8;
      }
    this.h = s;
    // geometry
    const geo = new THREE.PlaneGeometry(ARENA, ARENA, GRID, GRID);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k),
        z = pos.getZ(k);
      pos.setY(k, this.terrainHeight(x, z));
    }
    const ng = geo.toNonIndexed();
    ng.computeVertexNormals();
    const col = new Float32Array(ng.attributes.position.count * 3);
    const cg = new THREE.Color(T.ground),
      cs = new THREE.Color(T.slope),
      cr = new THREE.Color(T.rock),
      tmp = new THREE.Color();
    const nr = ng.attributes.normal,
      pp = ng.attributes.position;
    for (let f = 0; f < pp.count; f += 3) {
      const ny = (nr.getY(f) + nr.getY(f + 1) + nr.getY(f + 2)) / 3;
      const y = (pp.getY(f) + pp.getY(f + 1) + pp.getY(f + 2)) / 3;
      const steep = clamp((0.93 - ny) * 6, 0, 1);
      tmp.copy(cg).lerp(cs, steep);
      if (y > 9) tmp.lerp(cr, clamp((y - 9) / 6, 0, 0.7));
      tmp.offsetHSL(0, 0, rnd(-0.02, 0.02));
      for (let q = 0; q < 3; q++) {
        col[(f + q) * 3] = tmp.r;
        col[(f + q) * 3 + 1] = tmp.g;
        col[(f + q) * 3 + 2] = tmp.b;
      }
    }
    ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(
      ng,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.95,
        metalness: 0.02,
      }),
    );
    m.receiveShadow = true;
    m.castShadow = true;
    this.scene.add(m);
    this.meshes.push(m);
    this.terrainMesh = m;
    if (T.grid) {
      const gh = new THREE.GridHelper(ARENA, ARENA / 2.5, 0x6b7280, 0x8b93a0);
      gh.position.y = 0.04;
      gh.material.transparent = true;
      gh.material.opacity = 0.35;
      this.scene.add(gh);
      this.meshes.push(gh);
    }
  }
  onCorridor(x, z, margin = 2) {
    const c = this.corridor;
    if (!c) return false;
    const u = x * c.perp.x + z * c.perp.y - c.off;
    return Math.abs(u) < c.width / 2 + margin;
  }
  corridorPoint(s) {
    const c = this.corridor;
    const x = c.dir.x * s + c.perp.x * c.off,
      z = c.dir.y * s + c.perp.y * c.off;
    return new THREE.Vector3(x, this.terrainHeight(x, z), z);
  }
  slopeOK(x, z) {
    const s =
      Math.abs(this.terrainHeight(x + 2, z) - this.terrainHeight(x - 2, z)) +
      Math.abs(this.terrainHeight(x, z + 2) - this.terrainHeight(x, z - 2));
    return s < 1.6;
  }
  buildProps() {
    const T = this.theme;
    if (T.grid) {
      // tall pillar blocks like the reference arena
      const pm = mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 });
      for (let k = 0; k < rndi(14, 22); k++) {
        let x = rnd(-55, 55),
          z = rnd(-55, 55);
        if (
          Math.hypot(x, z) < 10 ||
          this.onCorridor(x, z, 3) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 9)
        )
          continue;
        const w = rnd(3, 7),
          d = rnd(3, 7),
          h = RNG() < 0.3 ? rnd(2.5, 4) : rnd(9, 18);
        const m2 = pm.clone();
        m2.transparent = true;
        const g = box(w, h, d, m2, x, h / 2, z);
        const eg = new THREE.LineSegments(
          new THREE.EdgesGeometry(g.geometry),
          new THREE.LineBasicMaterial({ color: 0x7a8290, transparent: true, opacity: 0.5 }),
        );
        g.add(eg);
        this.scene.add(g);
        this.meshes.push(g);
        const ob = {
          kind: 'box',
          x,
          z,
          w,
          d,
          top: h,
          y: 0,
          group: g,
          mats: [m2],
          box: new THREE.Box3(
            new THREE.Vector3(x - w / 2, 0, z - d / 2),
            new THREE.Vector3(x + w / 2, h, z + d / 2),
          ),
        };
        this.obstacles.push(ob);
        this.regProp('pillarBlock', ob, 4000, 0xc9cdd5);
        this.occluders.push(ob);
      }
      return;
    }
    const cMat = [mat(T.container), mat(T.container2), mat(0x8b8f94)],
      frame = mat(0x2a2d31);
    const count = this.themeKey === 'industrial' ? rndi(26, 36) : rndi(14, 22);
    for (let k = 0; k < count; k++) {
      let x,
        z,
        tries = 0;
      do {
        x = rnd(-52, 52);
        z = rnd(-52, 52);
        tries++;
      } while (
        tries < 20 &&
        (Math.hypot(x, z) < 10 ||
          this.onCorridor(x, z, 4) ||
          !this.slopeOK(x, z) ||
          this.obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < 7))
      );
      if (tries >= 20) continue;
      const rot = RNG() < 0.5 ? 0 : Math.PI / 2;
      const long = rnd(6, 9),
        short = rnd(2.6, 3.2),
        h = rnd(2.6, 3.0);
      const w = rot ? short : long,
        d = rot ? long : short;
      const y = this.terrainHeight(x, z);
      const g = new THREE.Group();
      const cm = pick(cMat).clone();
      cm.transparent = true;
      const body = box(w, h, d, cm, 0, h / 2, 0);
      g.add(body);
      const fm = frame.clone();
      fm.transparent = true;
      for (const t of [-0.35, 0.35]) {
        g.add(
          box(rot ? w + 0.1 : 0.3, h + 0.1, rot ? 0.3 : d + 0.1, fm, rot ? 0 : t * w, h / 2, rot ? t * d : 0),
        );
      }
      g.add(box(w + 0.08, 0.2, d + 0.08, fm, 0, h, 0));
      g.add(box(w + 0.08, 0.2, d + 0.08, fm, 0, 0.1, 0));
      g.position.set(x, y - 0.15, z);
      this.scene.add(g);
      this.meshes.push(g);
      const ob = {
        kind: 'box',
        x,
        z,
        w,
        d,
        top: y - 0.15 + h,
        y: y - 0.15,
        group: g,
        mats: [cm, fm],
        box: new THREE.Box3(
          new THREE.Vector3(x - w / 2, y - 0.2, z - d / 2),
          new THREE.Vector3(x + w / 2, y + h, z + d / 2),
        ),
      };
      this.obstacles.push(ob);
      this.occluders.push(ob);
      this.regProp('container', ob, 3000, cm.color.getHex());
      // stacked container sometimes
      if (RNG() < 0.25) {
        const g2 = g.clone();
        g2.position.y += h;
        g2.traverse((o) => {
          if (o.isMesh) {
            o.material = o.material.clone();
            o.material.transparent = true;
          }
        });
        this.scene.add(g2);
        this.meshes.push(g2);
        const mats2 = [];
        g2.traverse((o) => {
          if (o.isMesh) mats2.push(o.material);
        });
        const ob2 = {
          kind: 'box',
          x,
          z,
          w,
          d,
          top: ob.top + h,
          y: ob.top,
          group: g2,
          mats: mats2,
          box: new THREE.Box3(
            new THREE.Vector3(x - w / 2, ob.top, z - d / 2),
            new THREE.Vector3(x + w / 2, ob.top + h, z + d / 2),
          ),
        };
        this.obstacles.push(ob2);
        this.occluders.push(ob2);
        this.regProp('container', ob2, 3000, cm.color.getHex());
      }
    }
    if (T.hasRocks) {
      const rm = mat(T.rock, { roughness: 1 });
      for (let k = 0; k < rndi(10, 18); k++) {
        let x = rnd(-58, 58),
          z = rnd(-58, 58);
        if (Math.hypot(x, z) < 12 || this.onCorridor(x, z, 4)) continue;
        const r = rnd(1.8, 4.2);
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rm.clone());
        m.material.transparent = true;
        m.scale.set(rnd(0.8, 1.5), rnd(0.5, 1.0), rnd(0.8, 1.5));
        m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
        m.position.set(x, this.terrainHeight(x, z) + r * 0.2, z);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
        this.meshes.push(m);
        const ob = {
          kind: 'circle',
          x,
          z,
          r: r * 1.05,
          group: m,
          mats: [m.material],
          box: new THREE.Box3().setFromObject(m),
        };
        this.obstacles.push(ob);
        this.occluders.push(ob);
        this.regProp('rock', ob, 5000, T.rock);
      }
    }
    // pillars / lamp posts
    const pm = mat(0x33373c);
    for (let k = 0; k < rndi(6, 12); k++) {
      const x = rnd(-55, 55),
        z = rnd(-55, 55);
      if (Math.hypot(x, z) < 8 || this.onCorridor(x, z, 2) || !this.slopeOK(x, z)) continue;
      const h = rnd(5, 9);
      const m = box(0.6, h, 0.6, pm, x, this.terrainHeight(x, z) + h / 2 - 0.3, z);
      this.scene.add(m);
      this.meshes.push(m);
      {
        const ob = { kind: 'circle', x, z, r: 0.6, group: m, mats: [], box: null, h };
        this.obstacles.push(ob);
        this.regProp('pillar', ob, 1000, 0x33373c);
      }
    }
    // scattered debris (visual only)
    const dm = mat(0x55595e);
    for (let k = 0; k < 40; k++) {
      const x = rnd(-60, 60),
        z = rnd(-60, 60);
      const m = box(rnd(0.3, 1.2), rnd(0.2, 0.5), rnd(0.3, 1.2), dm, x, this.terrainHeight(x, z) + 0.1, z);
      m.rotation.y = rnd(0, 3);
      m.castShadow = false;
      this.scene.add(m);
      this.meshes.push(m);
    }
    // vehicles (industrial): trucks
    if (this.themeKey !== 'snow') {
      for (let k = 0; k < rndi(3, 6); k++) {
        const x = rnd(-50, 50),
          z = rnd(-50, 50);
        if (Math.hypot(x, z) < 12 || this.onCorridor(x, z, 4) || !this.slopeOK(x, z)) continue;
        const g = new THREE.Group();
        const cm = mat(k % 2 ? 0x2b4fb0 : 0xd8d8d8).clone();
        cm.transparent = true;
        g.add(box(3, 2.4, 7, cm, 0, 1.6, 0));
        g.add(box(3, 1.6, 2.2, mat(0xe6e6e6).clone(), 0, 1.2, -4.4));
        for (const sx of [-1.4, 1.4])
          for (const sz of [-3.8, -1.5, 2.2]) {
            const w = cyl(0.6, 0.6, 0.5, mat(0x1c1e20), sx, 0.6, sz);
            w.rotateZ(Math.PI / 2);
            g.add(w);
          }
        g.rotation.y = rnd(0, 6.28);
        g.position.set(x, this.terrainHeight(x, z) - 0.1, z);
        this.scene.add(g);
        this.meshes.push(g);
        const ob = {
          kind: 'circle',
          x,
          z,
          r: 3.6,
          group: g,
          mats: [cm],
          box: new THREE.Box3().setFromObject(g),
        };
        this.obstacles.push(ob);
        this.occluders.push(ob);
        this.regProp('truck', ob, 1600, cm.color.getHex());
      }
    }
  }

  // ---------- 地形特徵：橋梁／高架／掩體／壕溝 ----------
  planFeatures() {
    withRng(this.seed * 17 + 5, () => this.planFeatures0());
  }
  planFeatures0() {
    this.features = [];
    this.featureNames = [];
    const kinds = ['river_bridge', 'overpass', 'bunkers', 'trench', 'platforms'];
    const n = this.theme.flat ? rndi(1, 2) : rndi(1, 3);
    const chosen = [];
    while (chosen.length < n) {
      const k = pick(kinds);
      if (!chosen.includes(k)) chosen.push(k);
    }
    {
      const diag = RNG() < 0.5 ? 1 : -1;
      const d = new THREE.Vector2(1, diag).normalize();
      this.corridor = {
        kind: RNG() < 0.5 ? 'road' : 'rail',
        dir: d,
        perp: new THREE.Vector2(-d.y, d.x),
        off: rnd(-6, 6),
        width: 10,
        len: ARENA * 0.75,
      };
      this.featureNames.push(this.corridor.kind === 'road' ? '穿越公路' : '穿越鐵路');
    }
    for (const k of chosen) {
      const ang = RNG() < 0.5 ? 0 : Math.PI / 2;
      const dir = new THREE.Vector2(Math.cos(ang), Math.sin(ang)),
        perp = new THREE.Vector2(-dir.y, dir.x);
      const off = rnd(-25, 25);
      if (k === 'river_bridge') {
        this.features.push({
          k,
          dir,
          perp,
          off,
          width: rnd(13, 18),
          depth: rnd(4.5, 6.5),
          bridges: [rnd(-38, -8), rnd(8, 38)],
          deckW: 9,
        });
        this.featureNames.push('河道與橋梁');
      } else if (k === 'overpass') {
        this.features.push({
          k,
          dir,
          perp,
          off,
          center: rnd(-15, 15),
          span: rnd(34, 46),
          rampL: 18,
          deckH: 7.5,
          deckW: 10,
        });
        this.featureNames.push('高架橋');
      } else if (k === 'bunkers') {
        this.features.push({ k, count: rndi(3, 5) });
        this.featureNames.push('掩體群');
      } else if (k === 'trench') {
        this.features.push({
          k,
          dir,
          perp,
          off: rnd(-30, 30),
          width: rnd(6, 9),
          depth: rnd(2.5, 3.5),
          len: rnd(50, 90),
        });
        this.featureNames.push('壕溝');
      } else {
        this.features.push({ k, count: rndi(2, 4) });
        this.featureNames.push('高台');
      }
    }
    this.features.push({
      k: 'corridor',
      dir: this.corridor.dir,
      perp: this.corridor.perp,
      off: this.corridor.off,
      width: 10,
      len: this.corridor.len,
      kind: this.corridor.kind,
    });
  }
  featureHeight(x, z, h) {
    for (const f of this.features) {
      if (f.k === 'river_bridge') {
        const u = x * f.perp.x + z * f.perp.y - f.off;
        const t = clamp(1 - (Math.abs(u) - f.width / 2 + 2) / 3, 0, 1);
        h -= f.depth * t * t * (3 - 2 * t);
      } else if (f.k === 'overpass') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y - f.center;
        const lat = clamp(1 - (Math.abs(u) - f.deckW / 2) / 2.5, 0, 1);
        const half = f.span / 2;
        if (lat > 0 && Math.abs(v) > half && Math.abs(v) < half + f.rampL) {
          const t = 1 - (Math.abs(v) - half) / f.rampL;
          h = lerp(h, Math.max(h, f.deckH * t + h * (1 - t)), lat);
        }
      } else if (f.k === 'trench') {
        const u = x * f.perp.x + z * f.perp.y - f.off,
          v = x * f.dir.x + z * f.dir.y;
        if (Math.abs(v) < f.len / 2) {
          const t = clamp(1 - (Math.abs(u) - f.width / 2 + 1.5) / 2, 0, 1);
          h -= f.depth * t;
        }
      }
    }
    if (this.corridor) {
      const c = this.corridor;
      const u = x * c.perp.x + z * c.perp.y - c.off;
      const v = x * c.dir.x + z * c.dir.y;
      const inside = clamp(1 - (Math.abs(u) - c.width / 2) / 3.5, 0, 1);
      const edge = Math.max(Math.abs(x), Math.abs(z));
      if (inside > 0 && edge < (ARENA / 2) * 0.88) {
        const t = inside * inside * (3 - 2 * inside);
        h = lerp(h, 0.25, t);
      }
    }
    return h;
  }
  addDeck(x, z, w, d, y, thick, rotY, mats) {
    // elevated slab you can stand on AND walk under
    const g = new THREE.Group();
    const dm = mats.deck.clone();
    dm.transparent = true;
    const rm = mats.rail.clone();
    rm.transparent = true;
    g.add(box(w, thick, d, dm, 0, -thick / 2, 0));
    for (const s of [-1, 1]) {
      g.add(
        box(
          rotY ? 0.3 : w,
          0.9,
          rotY ? d : 0.3,
          rm,
          rotY ? s * (w / 2 - 0.15) : 0,
          0.45,
          rotY ? 0 : s * (d / 2 - 0.15),
        ),
      );
    }
    g.position.set(x, y, z);
    this.scene.add(g);
    this.meshes.push(g);
    const ob = {
      kind: 'box',
      x,
      z,
      w,
      d,
      top: y,
      y: y - thick,
      group: g,
      mats: [dm, rm],
      box: new THREE.Box3(
        new THREE.Vector3(x - w / 2, y - thick, z - d / 2),
        new THREE.Vector3(x + w / 2, y + 0.9, z + d / 2),
      ),
      deck: true,
    };
    this.obstacles.push(ob);
    this.occluders.push(ob);
    return ob;
  }
  addPillar(x, z, r, y0, y1, m) {
    const h = y1 - y0;
    const c = cyl(r, r * 1.15, h, m, x, y0 + h / 2, z, 8);
    this.scene.add(c);
    this.meshes.push(c);
    this.obstacles.push({ kind: 'circle', x, z, r: r * 1.1, group: c, mats: [], box: null });
  }
  regProp(kind, ob, hp, color) {
    this.props = this.props || [];
    const id = this.props.length;
    const c = ob.box
      ? ob.box.getCenter(new THREE.Vector3())
      : new THREE.Vector3(ob.x, this.terrainHeight(ob.x, ob.z) + (ob.h || 3) / 2, ob.z);
    const r = ob.box ? ob.box.getSize(new THREE.Vector3()).length() * 0.5 : ob.r + 0.5;
    const p = {
      id: 800000 + id,
      idx: id,
      kind,
      ob,
      hp,
      maxHp: hp,
      color,
      dead: false,
      team: 'prop',
      isProp: true,
      radius: Math.max(1.2, r * 0.85),
      name: { container: '貨櫃', rock: '岩石', pillar: '柱子', truck: '卡車', pillarBlock: '高柱' }[kind],
      pos: c,
      center: () => c.clone(),
      flashT: 0,
    };
    ob.prop = p;
    this.props.push(p);
    return p;
  }
  destroyProp(p, fx) {
    if (p.dead) return;
    p.dead = true;
    const i = this.obstacles.indexOf(p.ob);
    if (i >= 0) this.obstacles.splice(i, 1);
    const j = this.occluders.indexOf(p.ob);
    if (j >= 0) this.occluders.splice(j, 1);
    if (p.ob.group) {
      p.ob.group.visible = false;
    }
    if (fx) fx.shatterProp(p, this);
  }
  buildCorridor() {
    const c = this.corridor;
    if (!c) return;
    const half = c.len / 2 + 18;
    const L = [];
    const pts = (u) => {
      const out = [];
      for (let s = -half; s <= half; s += 2) {
        const x = c.dir.x * s + c.perp.x * (c.off + u),
          z = c.dir.y * s + c.perp.y * (c.off + u);
        out.push(new THREE.Vector3(x, this.terrainHeight(x, z) + 0.06, z));
      }
      return out;
    };
    const strip = (u0, u1, color, rough = 0.9, y = 0.06) => {
      const A = pts(u0),
        B = pts(u1);
      const pos = [];
      for (let i = 0; i < A.length - 1; i++) {
        const a = A[i],
          b = B[i],
          c2 = A[i + 1],
          d = B[i + 1];
        pos.push(
          a.x,
          a.y + y,
          a.z,
          b.x,
          b.y + y,
          b.z,
          c2.x,
          c2.y + y,
          c2.z,
          b.x,
          b.y + y,
          b.z,
          d.x,
          d.y + y,
          d.z,
          c2.x,
          c2.y + y,
          c2.z,
        );
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat(color, { roughness: rough }));
      m.receiveShadow = true;
      this.scene.add(m);
      this.meshes.push(m);
      return m;
    };
    if (c.kind === 'road') {
      strip(-5, 5, 0x3a3d42);
      strip(-5.2, -4.8, 0xd8d8d0, 0.8, 0.02);
      strip(4.8, 5.2, 0xd8d8d0, 0.8, 0.02);
      for (let s = -half; s < half; s += 8) {
        const x = c.dir.x * s + c.perp.x * c.off,
          z = c.dir.y * s + c.perp.y * c.off;
        const m = box(0.3, 0.05, 3.2, mat(0xe8d070), x, this.terrainHeight(x, z) + 0.09, z);
        m.rotation.y = Math.atan2(c.dir.x, c.dir.y);
        this.scene.add(m);
        this.meshes.push(m);
      }
    } else {
      strip(-4.5, 4.5, 0x6e6558, 1, 0.02);
      strip(-1.6, -1.3, 0x9aa0a8, 0.4, 0.16);
      strip(1.3, 1.6, 0x9aa0a8, 0.4, 0.16);
      for (let s = -half; s < half; s += 1.6) {
        const x = c.dir.x * s + c.perp.x * c.off,
          z = c.dir.y * s + c.perp.y * c.off;
        const m = box(4.2, 0.12, 0.5, mat(0x4a3b2e), x, this.terrainHeight(x, z) + 0.06, z);
        m.rotation.y = Math.atan2(c.dir.x, c.dir.y);
        this.scene.add(m);
        this.meshes.push(m);
      }
    }
    // 隧道口：地圖兩端各一座（拱門＋門柱＋黑洞＋山體）
    for (const sgn of [-1, 1]) {
      const s = sgn * ((ARENA / 2) * 0.86);
      const x = c.dir.x * s + c.perp.x * c.off,
        z = c.dir.y * s + c.perp.y * c.off;
      const y = this.terrainHeight(x, z);
      const g = new THREE.Group();
      const dm = mat(0x5b5f66, { roughness: 0.95 });
      g.add(box(14, 9, 2.5, dm, 0, 4.5, 0));
      g.add(box(10, 0.9, 2.7, mat(0x8a8f96), 0, 8.1, 0));
      const hole = box(8, 6.5, 2.8, new THREE.MeshBasicMaterial({ color: 0x07080a }), 0, 3.25, 0);
      g.add(hole);
      g.add(box(1.4, 7, 3, mat(0x3d4147), -4.7, 3.5, 0));
      g.add(box(1.4, 7, 3, mat(0x3d4147), 4.7, 3.5, 0));
      const mount = box(24, 14, 10, mat(this.theme.rock, { roughness: 1 }), 0, 5, -6);
      g.add(mount);
      g.position.set(x, y - 0.1, z);
      g.rotation.y = Math.atan2(c.dir.x, c.dir.y) + (sgn > 0 ? Math.PI : 0);
      this.scene.add(g);
      this.meshes.push(g);
    }
    this.corridorHalf = half;
  }
  buildFeatures() {
    this.buildCorridor();
    const T = this.theme;
    const mats = {
      deck: mat(0x6a6f77, { roughness: 0.85, metalness: 0.2 }),
      rail: mat(0x3a3d42),
      pillar: mat(0x4a4f57, { roughness: 0.9 }),
    };
    for (const f of this.features) {
      if (f.k === 'river_bridge') {
        for (let bpos of f.bridges) {
          {
            let tries = 0;
            while (tries++ < 12) {
              const cx0 = f.perp.x * f.off + f.dir.x * bpos,
                cz0 = f.perp.y * f.off + f.dir.y * bpos;
              let clear = true;
              for (const q of [-1, -0.5, 0, 0.5, 1])
                if (
                  this.onCorridor(
                    cx0 + f.dir.x * q * (f.deckW / 2 + 2),
                    cz0 + f.dir.y * q * (f.deckW / 2 + 2),
                    9,
                  )
                )
                  clear = false;
              if (clear) break;
              bpos += (bpos < 0 ? -1 : 1) * 6;
              if (Math.abs(bpos) > 52) {
                bpos = NaN;
                break;
              }
            }
            if (isNaN(bpos)) continue;
          } // 橋梁避開公路／鐵路走廊
          const cx = f.perp.x * f.off + f.dir.x * bpos,
            cz = f.perp.y * f.off + f.dir.y * bpos;
          const rot = Math.abs(f.perp.x) > 0.5;
          const span = f.width + 8;
          const deckY =
            Math.max(
              this.terrainHeight(cx + f.perp.x * (span / 2), cz + f.perp.y * (span / 2)),
              this.terrainHeight(cx - f.perp.x * (span / 2), cz - f.perp.y * (span / 2)),
            ) + 0.3;
          this.addDeck(cx, cz, rot ? span : f.deckW, rot ? f.deckW : span, deckY, 0.7, !rot, mats);
          for (const s of [-1, 1])
            for (const q of [-1, 1]) {
              const px = cx + f.perp.x * s * f.width * 0.28 + f.dir.x * q * f.deckW * 0.35,
                pz = cz + f.perp.y * s * f.width * 0.28 + f.dir.y * q * f.deckW * 0.35;
              if (this.onCorridor(px, pz, 1)) continue;
              this.addPillar(px, pz, 0.6, deckY - f.depth - 1.5, deckY - 0.7, mats.pillar);
            }
        }
      } else if (f.k === 'overpass') {
        const cx = f.perp.x * f.off + f.dir.x * f.center,
          cz = f.perp.y * f.off + f.dir.y * f.center;
        const rot = Math.abs(f.dir.x) > 0.5;
        const deckY = f.deckH + this.terrainHeight(cx, cz) * 0;
        const base = this.terrainHeight(cx, cz);
        const dy = Math.max(deckY, base + 5, 7.2);
        this.addDeck(cx, cz, rot ? f.span : f.deckW, rot ? f.deckW : f.span, dy, 0.8, !rot, mats);
        const np = Math.floor(f.span / 12);
        for (let i = 0; i <= np; i++) {
          const v = -f.span / 2 + 4 + (i * (f.span - 8)) / np;
          for (const s of [-1, 1]) {
            const px = cx + f.dir.x * v + f.perp.x * s * f.deckW * 0.32,
              pz = cz + f.dir.y * v + f.perp.y * s * f.deckW * 0.32;
            if (this.onCorridor(px, pz, 1.5)) continue;
            this.addPillar(px, pz, 0.55, this.terrainHeight(px, pz) - 0.5, dy - 0.8, mats.pillar);
          }
        }
      } else if (f.k === 'bunkers') {
        for (let i = 0; i < f.count; i++) {
          let x = rnd(-48, 48),
            z = rnd(-48, 48);
          const w = rnd(9, 14),
            d = rnd(9, 14);
          {
            let tr = 0;
            while (
              tr++ < 10 &&
              (Math.hypot(x, z) < 10 ||
                this.onCorridor(x, z, Math.max(w, d) * 0.72 + 2) ||
                !this.slopeOK(x, z))
            ) {
              x = rnd(-48, 48);
              z = rnd(-48, 48);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const h = rnd(5, 6.5);
          this.addDeck(x, z, w, d, y0 + h, 0.8, false, mats);
          for (const sx of [-1, 1])
            for (const sz of [-1, 1])
              this.addPillar(
                x + sx * (w / 2 - 1),
                z + sz * (d / 2 - 1),
                0.5,
                y0 - 0.5,
                y0 + h - 0.8,
                mats.pillar,
              );
          // one side wall for cover
          const side = RNG() < 0.5;
          const wm = mats.pillar.clone();
          wm.transparent = true;
          const wall = box(
            side ? w - 2 : 0.8,
            h - 0.8,
            side ? 0.8 : d - 2,
            wm,
            x + (side ? 0 : (w / 2 - 0.4) * (RNG() < 0.5 ? 1 : -1)),
            y0 + (h - 0.8) / 2,
            z + (side ? (d / 2 - 0.4) * (RNG() < 0.5 ? 1 : -1) : 0),
          );
          this.scene.add(wall);
          this.meshes.push(wall);
          const bb = new THREE.Box3().setFromObject(wall);
          this.obstacles.push({
            kind: 'box',
            x: wall.position.x,
            z: wall.position.z,
            w: bb.max.x - bb.min.x,
            d: bb.max.z - bb.min.z,
            top: bb.max.y,
            y: bb.min.y,
            group: wall,
            mats: [wm],
            box: bb,
          });
          this.occluders.push(this.obstacles[this.obstacles.length - 1]);
        }
      } else if (f.k === 'platforms') {
        const pm = mat(0x7a7f88, { roughness: 0.8 });
        for (let i = 0; i < f.count; i++) {
          let x = rnd(-45, 45),
            z = rnd(-45, 45);
          const w = rnd(10, 18),
            d = rnd(10, 18),
            h = rnd(4, 7);
          {
            let tr = 0;
            while (tr++ < 10 && (Math.hypot(x, z) < 12 || this.onCorridor(x, z, Math.max(w, d) * 0.72 + 8))) {
              x = rnd(-45, 45);
              z = rnd(-45, 45);
            }
            if (tr > 10) continue;
          }
          const y0 = this.terrainHeight(x, z);
          const m2 = pm.clone();
          m2.transparent = true;
          const g = box(w, h, d, m2, x, y0 + h / 2 - 0.5, z);
          this.scene.add(g);
          this.meshes.push(g);
          const ob = {
            kind: 'box',
            x,
            z,
            w,
            d,
            top: y0 + h - 0.5,
            y: y0 - 0.5,
            group: g,
            mats: [m2],
            box: new THREE.Box3(
              new THREE.Vector3(x - w / 2, y0 - 0.5, z - d / 2),
              new THREE.Vector3(x + w / 2, y0 + h - 0.5, z + d / 2),
            ),
          };
          this.obstacles.push(ob);
          this.occluders.push(ob);
          // ramp: a tilted slab up to the platform (walkable via terrain-like ground function)
          const side = pick([
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]);
          const rl = h * 2.2;
          const rx = x + side[0] * (w / 2 + rl / 2),
            rz = z + side[1] * (d / 2 + rl / 2);
          const rw = side[0] ? rl : 6,
            rd = side[1] ? rl : 6;
          const rg = box(rw, 0.4, rd, pm, 0, 0, 0);
          rg.position.set(rx, y0 + h / 2 - 0.7, rz);
          rg.rotation.z = side[0] ? -side[0] * Math.atan2(h - 0.5, rl) : 0;
          rg.rotation.x = side[1] ? side[1] * Math.atan2(h - 0.5, rl) : 0;
          this.scene.add(rg);
          this.meshes.push(rg);
          this.ramps = this.ramps || [];
          this.ramps.push({ x: rx, z: rz, w: rw, d: rd, side, y0: y0 - 0.5, y1: y0 + h - 0.5, len: rl });
        }
      }
    }
  }
  rampHeight(x, z) {
    if (!this.ramps) return -1e9;
    let best = -1e9;
    for (const r of this.ramps) {
      if (Math.abs(x - r.x) > r.w / 2 || Math.abs(z - r.z) > r.d / 2) continue;
      const along = r.side[0] ? (r.x - x) * r.side[0] : (r.z - z) * r.side[1];
      const t = clamp((along + r.len / 2) / r.len, 0, 1);
      best = Math.max(best, lerp(r.y0, r.y1, t));
    }
    return best;
  }
  ceiling(x, z, y, h) {
    let c = 1e9;
    for (const o of this.obstacles) {
      if (o.kind !== 'box' || !o.deck) continue;
      if (Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2 && y < o.y - 0.2 && y + h > o.y)
        c = Math.min(c, o.y);
    }
    return c;
  }
  // ground height incl. box tops for an entity at (x,z) currently at height y
  groundAt(x, z, y) {
    let g = Math.max(this.terrainHeight(x, z), this.rampHeight(x, z));
    for (const o of this.obstacles) {
      if (o.kind !== 'box') continue;
      if (
        Math.abs(x - o.x) < o.w / 2 + 0.3 &&
        Math.abs(z - o.z) < o.d / 2 + 0.3 &&
        y >= o.top - 0.6 &&
        o.top > g
      )
        g = o.top;
    }
    return g;
  }
  // horizontal collision push-out; returns [x,z]
  collide(x, z, y, r) {
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
        if (y >= o.top - 0.6) continue;
        if (o.deck && y + 3.2 < o.y) continue;
        if (o.deck && y < o.y - 0.2) continue;
        const hw = o.w / 2 + r,
          hd = o.d / 2 + r;
        const dx = x - o.x,
          dz = z - o.z;
        if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
          const px = hw - Math.abs(dx),
            pz = hd - Math.abs(dz);
          if (px < pz) x = o.x + Math.sign(dx || 1) * hw;
          else z = o.z + Math.sign(dz || 1) * hd;
        }
      } else {
        const dx = x - o.x,
          dz = z - o.z;
        const d = Math.hypot(dx, dz);
        const rr = o.r + r;
        if (d < rr) {
          const k = d < 1e-3 ? 1 : rr / d;
          x = o.x + dx * k;
          z = o.z + dz * k;
        }
      }
    }
    // arena bounds + steep walls: keep inside 62
    const lim = 62;
    x = clamp(x, -lim, lim);
    z = clamp(z, -lim, lim);
    return [x, z];
  }
  // projectile vs world
  hitsWorld(p) {
    if (p.y < this.terrainHeight(p.x, p.z) || p.y < this.rampHeight(p.x, p.z)) return true;
    for (const o of this.obstacles) {
      if (o.kind === 'box') {
        if (Math.abs(p.x - o.x) < o.w / 2 && Math.abs(p.z - o.z) < o.d / 2 && p.y < o.top && p.y > o.y)
          return true;
      } else if (
        o.r > 1 &&
        Math.hypot(p.x - o.x, p.z - o.z) < o.r * 0.9 &&
        p.y < this.terrainHeight(o.x, o.z) + o.r * 2
      )
        return true;
    }
    return false;
  }
  spawnPoint(minDistFrom, others) {
    for (let t = 0; t < 40; t++) {
      const x = rnd(-50, 50),
        z = rnd(-50, 50);
      if (this.onCorridor(x, z, 2)) continue;
      if (!this.slopeOK(x, z)) continue;
      if (Math.hypot(x - minDistFrom.x, z - minDistFrom.z) < 28) continue;
      if (others.some((o) => Math.hypot(o.x - x, o.z - z) < 6)) continue;
      if (
        this.obstacles.some((o) =>
          o.kind === 'box'
            ? Math.abs(x - o.x) < o.w / 2 + 1.5 && Math.abs(z - o.z) < o.d / 2 + 1.5
            : Math.hypot(x - o.x, z - o.z) < o.r + 1.5,
        )
      )
        continue;
      return { x, z };
    }
    return { x: rnd(-40, 40), z: rnd(-40, 40) };
  }
  dispose() {
    for (const m of this.meshes) {
      this.scene.remove(m);
      m.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
    }
  }
  // fade objects between camera and player
  updateOcclusion(camPos, playerPos, dt) {
    const ray = new THREE.Ray(camPos.clone(), playerPos.clone().sub(camPos).normalize());
    const dist = camPos.distanceTo(playerPos);
    for (const o of this.occluders) {
      if (!o.box) continue;
      let hit = false;
      const r = ray.intersectBox(o.box, new THREE.Vector3());
      if (r && r.distanceTo(camPos) < dist - 1) hit = true;
      const target = hit ? 0.22 : 1;
      for (const m of o.mats) {
        m.opacity = lerp(m.opacity, target, Math.min(1, dt * 10));
        m.depthWrite = m.opacity > 0.9;
      }
    }
  }
}
