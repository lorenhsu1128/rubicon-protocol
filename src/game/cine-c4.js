// 第 4 章 構造體（垂直一鏡到底與倒數） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch4.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c4 開頭，避免和別章重複。
//
// 掛勾（鏡頭的欄位）：
//   c4tower：Grid 086 往雲上延伸的高塔（S.tw）、雲海、遠方的發射台（S.pad）；鏡頭附近的原本平台隱藏
//   c4env：依鏡頭高度改調色（S.env＝{ y0, y1, lo, hi }：雲下 → 雲上；hfog＝雲海）
//   c4pin：把演員釘在關鍵影格上（S.pin＝[{ id, keys: [{ t, p, yaw, pitch }] }]，爬柱子、吊在平台底面）
//   c4dz：滑動變焦（S.dz＝{ t0, t1, a 演員, h 畫面高度 m }：依距離改 fov，主體大小不變、背景往後掉）
//   c4room：發射控制室（抉擇 2 的選前；S.room＝房間的位置，倒數螢幕與兩個按鈕）
//   c4launch：發射台與火箭（S.launch＝{ at, mode: 'lift'|'night'|'burnt', t0, acc, ig, town }）
//   c4gate：發射設施的大門（S.gate＝{ at, t0, t1, closed }）
// 疊加：c4count（倒數，S.cd）、c4duo（兩種顏色的對話字幕，S.duo）、c4title（直向捲動的章名，S.vt）、
//       c4radio（各勢力的頻道，S.radio）、c4letter（手寫信與軌道站的光點，S.letter）
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { c4RocketY } from '../data/cine/ch4.js';
import { SPEAKERS } from '../data/story.js';
import { PK, mat } from '../world/prop-models.js';
import { buildBarrels, buildShack } from '../world/themes/grid086.js';
import { Game } from './game.js';

const smooth = (x) => x * x * (3 - 2 * x);
const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const D2R = Math.PI / 180;
const MONO = '"Share Tech Mono", "Noto Sans TC", monospace';
const SANS = '"Noto Sans TC", sans-serif';
const HAND = '"Klee One", "Yuji Syuku", "Noto Serif TC", "Songti TC", "PMingLiU", serif';

// 光暈（按鈕、燈）的貼圖
let GLOW = null;
function glowTex() {
  if (GLOW) return GLOW;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  GLOW = new THREE.CanvasTexture(cv);
  return GLOW;
}
// 字的換行（中文逐字）
function wrap(x, text, maxW) {
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (x.measureText(cur + ch).width > maxW && cur) {
      out.push(cur);
      cur = ch;
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

// ---------- 網格建造（純函式，原點在地面中心） ----------
// 火箭：高 h、半徑 r，原點在底部中心；回傳 { group, nozzle（噴口的高度） }
function buildRocket(h, r) {
  const white = mat(0xe8eaec, { roughness: 0.45, metalness: 0.15 }),
    dk = mat(0x2a2d31, { roughness: 0.7 }),
    org = mat(0xd86a20, { roughness: 0.6 });
  const k = new PK();
  k.cyl(white, r, r, h * 0.78, 0, h * 0.39 + 1.2, 0, 0, 0, 0, 18);
  k.geo(white, new THREE.ConeGeometry(r, h * 0.2, 18), 0, h * 0.88 + 1.2, 0);
  for (const y of [h * 0.22, h * 0.5, h * 0.74]) k.cyl(dk, r * 1.02, r * 1.02, 0.6, 0, y, 0, 0, 0, 0, 18);
  k.cyl(org, r * 1.015, r * 1.015, h * 0.06, 0, h * 0.62, 0, 0, 0, 0, 18);
  k.box(dk, 0.2, h * 0.16, r * 0.5, r * 1.0, h * 0.36, 0);
  for (let j = 0; j < 4; j++) {
    const a = (j * Math.PI) / 2;
    k.box(
      dk,
      0.35,
      h * 0.12,
      r * 0.9,
      Math.cos(a) * r * 1.25,
      h * 0.08 + 1.2,
      Math.sin(a) * r * 1.25,
      0,
      -a,
      0,
    );
  }
  k.cyl(dk, r * 0.55, r * 0.85, 1.4, 0, 0.7, 0, 0, 0, 0, 12);
  const group = k.build();
  // 尾焰（點火後才顯示）：內外兩層加色的圓錐，尖端朝下
  const pm = new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide, // 從下往上看時看到的是圓錐的內側
    fog: false,
  });
  const pm2 = pm.clone();
  pm2.color.set(0xfff4d8);
  const plume = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(r * 1.1, h * 0.7, 14, 1, true), pm);
  outer.rotation.x = Math.PI;
  outer.position.y = -h * 0.35;
  const inner = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, h * 0.4, 12, 1, true), pm2);
  inner.rotation.x = Math.PI;
  inner.position.y = -h * 0.2;
  plume.add(outer, inner);
  plume.visible = false;
  group.add(plume);
  return { group, plume, mats: [pm, pm2] };
}
// 發射塔（格子塔＋台面）：塔在 −X 方向 tx，高 h；原點在台面中心
function buildPadTower(h, tx, w = 7) {
  const steel = mat(0xb04a2a, { roughness: 0.6, metalness: 0.5 }),
    dk = mat(0x3d4044, { roughness: 0.8 }),
    pad = mat(0x7a7c7e, { roughness: 0.95 });
  const k = new PK();
  k.cb(pad, 30, 0.8, 30, 0, 0.4, 0, 0, 0, 0, 0.2);
  k.box(dk, 9, 0.1, 9, 0, 0.82, 0);
  const a = w / 2 - 0.2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box(steel, 0.6, h, 0.6, tx + sx * a, h / 2, sz * a);
  let yp = 0,
    i = 0;
  for (let y = 4; y < h; y += 4.5, i++) {
    const f = i % 2 ? 1 : -1;
    for (const s of [-1, 1]) {
      k.box(steel, w, 0.35, 0.35, tx, y, s * a);
      k.box(steel, 0.35, 0.35, w, tx + s * a, y, 0);
      k.bar(steel, [tx - f * a, yp, s * a], [tx + f * a, y, s * a], 0.2);
      k.bar(steel, [tx + s * a, yp, -f * a], [tx + s * a, y, f * a], 0.2);
    }
    yp = y;
  }
  for (const y of [h * 0.3, h * 0.55, h * 0.8]) k.box(steel, Math.abs(tx) - 2, 0.8, 1.8, tx / 2 - 1, y, 0);
  k.cyl(dk, 0.12, 0.2, 8, tx, h + 4, 0, 0, 0, 0, 6);
  return k.build();
}
// Doser／難民的帳篷（布＋支架），原點在底面中心
function buildTent(color) {
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.95, flatShading: true });
  const k = new PK();
  k.geo(cloth, new THREE.ConeGeometry(2.4, 2.6, 4), 0, 1.3, 0, 0, Math.PI / 4, 0);
  k.cyl(mat(0x3a3836), 0.06, 0.06, 3.1, 0, 1.55, 0, 0, 0, 0, 5);
  return k.build();
}

Object.assign(Game.prototype, {
  // ---------- 共用：這個掛勾建的東西（場景群組、要釋放的資源、加進 World 的障礙物、隱藏的原本物件） ----------
  c4Rec(name) {
    const c = this.cine;
    c.c4 = c.c4 || {};
    if (!c.c4[name]) {
      const g = new THREE.Group();
      this.scene.add(g);
      // 也登記在場景的 extra：跳時間（cineSeek、劇場的上一鏡）沒有呼叫 exit 時，換場景或結束時引擎也會移除
      if (c.set && c.set.extra) c.set.extra.push(g);
      c.c4[name] = { g, own: [], obs: [], wm: [], hid: [], st: {} };
    }
    return c.c4[name];
  },
  // 鏡頭開始時：清掉不是這一鏡的掛勾留下來的東西（跳時間時不會呼叫上一鏡的 exit）
  c4Sync(S) {
    const c = this.cine;
    const keep = [].concat(S.hook || []).map((n) => n.replace(/^c4/, ''));
    for (const name of Object.keys(c.c4 || {})) if (!keep.includes(name)) this.c4Free(name);
  },
  c4Free(name) {
    const c = this.cine;
    const R = c && c.c4 && c.c4[name];
    if (!R) return;
    if (R.g.parent) R.g.parent.remove(R.g);
    const ex = c.set && c.set.extra;
    if (ex && ex.includes(R.g)) ex.splice(ex.indexOf(R.g), 1);
    R.g.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
    for (const m of R.own) m.dispose && m.dispose();
    const w = this.world;
    if (w) {
      for (const o of R.obs) {
        const i = w.obstacles.indexOf(o);
        if (i >= 0) w.obstacles.splice(i, 1);
      }
      for (const m of R.wm) {
        const i = w.meshes.indexOf(m);
        if (i >= 0) w.meshes.splice(i, 1);
        if (m.parent) m.parent.remove(m);
        m.traverse((o) => o.isMesh && o.geometry && o.geometry.dispose());
      }
    }
    for (const o of R.hid) o.visible = true;
    delete c.c4[name];
  },
  // 場景原點的相對座標 → 世界座標
  c4At(p) {
    return this.cinePt(p, new THREE.Vector3());
  },
  // 把原本地圖在這個範圍（水平距離 r）裡的大型物件隱藏（平台、柱子、煙囪…），離開時還原
  // at＝中心（場景原點的相對座標 [x, z]，預設原點）
  c4Hide(R, r, at) {
    const w = this.world,
      A = this.c4At(at ? { g: at } : [0, 0, 0]);
    const v = new THREE.Vector3();
    for (const o of w.obstacles) {
      const g = o.group || o.mesh;
      if (!g || !g.visible || R.obs.includes(o)) continue;
      // 大型物件（addBig）只有 Box3，沒有 x／z
      let x = o.x,
        z = o.z,
        hw = o.kind === 'box' ? Math.hypot(o.w || 0, o.d || 0) / 2 : o.r || 1;
      if (o.box && (x == null || z == null)) {
        o.box.getCenter(v);
        x = v.x;
        z = v.z;
        hw = Math.hypot(o.box.max.x - o.box.min.x, o.box.max.z - o.box.min.z) / 2;
      }
      if (x == null || z == null || Math.hypot(x - A.x, z - A.z) - hw > r) continue;
      g.visible = false;
      R.hid.push(g);
    }
    // 沒有碰撞的網格（坡道、地形特徵的外觀…）：外框的中心在範圍裡的也隱藏（地形、水面、遠景除外）
    const bb = new THREE.Box3();
    for (const m of w.meshes) {
      if (!m.visible || m === w.terrainMesh || m === w.waterMesh || m.userData.noFade || R.wm.includes(m))
        continue;
      bb.setFromObject(m);
      if (bb.isEmpty()) continue;
      bb.getCenter(v);
      const hw = Math.hypot(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2;
      if (hw > 60 || Math.hypot(v.x - A.x, v.z - A.z) - hw > r) continue;
      m.visible = false;
      R.hid.push(m);
    }
  },

  // ---------- 開場：往雲上延伸的高塔 ----------
  cineHook_c4tower(S, phase, lt) {
    if (phase === 'exit') return this.c4Free('tower');
    if (phase === 'tick') return this.c4TowerTick(S, lt);
    if (phase !== 'enter' || !this.world) return;
    this.c4Sync(S);
    this.c4Free('tower');
    const R = this.c4Rec('tower');
    const w = this.world,
      A = this.cine.set.anchor,
      T = S.tw;
    R.g.position.copy(A);
    // 原本的平台：高塔周圍（鏡頭繞著飛的範圍）隱藏，外圈的保留當背景
    this.c4Hide(R, T.clearR || 40);
    // 遠景的剪影物件（隔牆、巨柱）：從雲上看會變成一片描了邊的白牆，高的都隱藏
    const bb = new THREE.Box3();
    for (const m of w.meshes)
      if (m.userData.noFade && m.visible && !m.isMesh) {
        bb.setFromObject(m);
        if (bb.max.y > A.y + 20) {
          m.visible = false;
          R.hid.push(m);
        }
      }
    // 平台與柱子用 World 的（主題的外觀＋可以站在上面）
    const n0 = w.obstacles.length,
      m0 = w.meshes.length;
    T.lv.forEach((y, i) => {
      const [dx, dz] = T.off[i] || [0, 0];
      w.addDeck(A.x + dx, A.z + dz, T.size, T.size, A.y + y, 1.2, false, null);
    });
    const top = T.lv[T.lv.length - 1];
    for (const sx of [-1, 1])
      for (const sz of [-1, 1])
        w.addPillar(A.x + sx * T.col, A.z + sz * T.col, 1.1, A.y - 0.5, A.y + top - 1.2);
    R.obs = w.obstacles.slice(n0);
    R.wm = w.meshes.slice(m0);
    // 斜撐：每兩層之間、四個面的 X 形鋼骨
    const k = new PK();
    const steel = mat(0x4a4540, { roughness: 0.6, metalness: 0.6 }),
      a = T.col;
    const cn = [
      [-a, -a],
      [a, -a],
      [a, a],
      [-a, a],
    ];
    for (let i = 0; i < T.lv.length - 1; i++) {
      const y0 = T.lv[i],
        y1 = T.lv[i + 1] - 1.4;
      for (let f = 0; f < 4; f++) {
        const p = cn[f],
          q = cn[(f + 1) % 4];
        k.bar(steel, [p[0], y0, p[1]], [q[0], y1, q[1]], 0.28);
        k.bar(steel, [q[0], y0, q[1]], [p[0], y1, p[1]], 0.28);
      }
    }
    R.g.add(k.build());
    // 燈：柱頂與平台角的紅色航空障礙燈、平台底的工作燈（自發光，Bloom 會亮）
    const red = new THREE.MeshBasicMaterial({ color: 0xff3a24 }),
      warm = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    R.own.push(red, warm);
    const bg = new THREE.BoxGeometry(0.5, 0.5, 0.5),
      wg = new THREE.BoxGeometry(1.6, 0.25, 0.5);
    T.lv.forEach((y, i) => {
      const [dx, dz] = T.off[i] || [0, 0],
        h = T.size / 2 - 0.4;
      for (const [sx, sz] of cn) {
        const b = new THREE.Mesh(bg, red);
        b.position.set(dx + Math.sign(sx) * h, y + 0.4, dz + Math.sign(sz) * h);
        R.g.add(b);
      }
      for (let j = 0; j < 4; j++) {
        const l = new THREE.Mesh(wg, warm);
        const ang = (j * Math.PI) / 2;
        l.position.set(dx + Math.cos(ang) * (h - 1), y - 1.5, dz + Math.sin(ang) * (h - 1));
        l.rotation.y = ang;
        R.g.add(l);
      }
    });
    // Doser 的棚屋與油桶（住在平台上）
    for (const [i, x, z, r, b] of T.huts || []) {
      const [dx, dz] = T.off[i] || [0, 0];
      const g = b ? buildBarrels() : buildShack(0x6a6a5a);
      g.position.set(dx + x, T.lv[i], dz + z);
      g.rotation.y = (r || 0) * D2R;
      R.g.add(g);
    }
    // 雲海：一整片延伸到地平線的雲層（從下面看是雲底；鏡頭穿過去時由 c4cloud 疊一層白霧）
    const cl = T.cloud;
    if (cl) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const x = cv.getContext('2d');
      x.fillStyle = '#b6c3d2';
      x.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 90; i++) {
        const px = (i * 97) % 256,
          py = (i * 61) % 256,
          r = 14 + ((i * 13) % 30);
        for (const [ox, oy] of [
          [0, 0],
          [256, 0],
          [0, 256],
          [-256, 0],
          [0, -256],
        ]) {
          const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, r);
          g.addColorStop(0, 'rgba(255,255,255,0.65)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = g;
          x.fillRect(px + ox - r, py + oy - r, r * 2, r * 2);
        }
      }
      const tex2 = new THREE.CanvasTexture(cv);
      tex2.wrapS = tex2.wrapT = THREE.RepeatWrapping;
      tex2.repeat.set(40, 40);
      const sm2 = new THREE.MeshBasicMaterial({ map: tex2, color: 0xf2f5f8, side: THREE.DoubleSide });
      R.own.push(tex2, sm2);
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), sm2);
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = cl.y + 2;
      R.g.add(sea);
      R.st.sea = sea;
      // 遠景地形與地圖邊緣的高地形（山脊、階梯開採面會比雲海高）
      R.st.far = w.meshes.filter((m) => m.userData.noFade && m.isMesh && m.visible);
      if (w.terrainMesh) R.st.far.push(w.terrainMesh);
      R.hid.push(...R.st.far); // 離開時還原
      R.st.cloudY = cl.y;
    }
    // 遠方的發射台（火箭從雲海裡伸出來；倒數到 0 時點火）
    if (S.pad) {
      const P = S.pad;
      const tw = buildPadTower(P.h * 1.1, -P.r * 2.4, P.r * 2);
      tw.position.set(P.at[0], 0, P.at[1]);
      R.g.add(tw);
      const rk = buildRocket(P.h, P.r);
      rk.group.position.set(P.at[0], 0.8, P.at[1]);
      R.g.add(rk.group);
      R.own.push(...rk.mats);
      R.st.rocket = rk.group;
      R.st.plume = rk.plume;
    }
  },
  // 尾焰的閃爍：點火後顯示，越往上越長
  c4Plume(pl, on, k) {
    if (!pl) return;
    pl.visible = on;
    if (!on) return;
    const f = 0.9 + Math.random() * 0.2;
    pl.scale.set(f, (0.55 + k) * (0.9 + Math.random() * 0.25), f);
  },
  // 遠方的發射台：倒數到 0 點火、火箭升空（噴焰與煙）
  c4TowerTick(S, lt) {
    const c = this.cine;
    const R = c.c4 && c.c4.tower;
    const P = S.pad;
    if (!R) return;
    const A = c.set.anchor;
    // 雲上：遠景地形與地圖邊緣的高地形（會從雲海裡穿出來）隱藏
    if (R.st.sea) {
      const up = this.camera.position.y - A.y > R.st.cloudY + 3;
      for (const m of R.st.far) m.visible = !up;
    }
    if (!P || !R.st.rocket) return;
    this.c4Plume(R.st.plume, lt >= P.ig, clamp((lt - P.t0) / 4, 0, 1));
    if (lt < P.ig) return;
    const ry = c4RocketY(lt, P.t0, P.acc);
    R.st.rocket.position.y = 0.8 + ry;
    if (c.paused) return;
    const noz = new THREE.Vector3(A.x + P.at[0], A.y + ry + 1, A.z + P.at[1]);
    // 雲海上方才有煙（雲下的被雲海蓋住）
    if (Math.random() < 0.35 && noz.y - A.y > 95)
      this.fx.smoke(noz.clone().setY(noz.y - P.h * 0.4), 5 + Math.random() * 3, 0xe8e4dc, 5, 2);
    this.fx.flashLight && this.fx.flashLight(noz, 0xffb070, 8);
  },
  // ---------- 依鏡頭高度改調色：雲下的冷金屬 → 雲上的強光 ----------
  cineHook_c4env(S, phase) {
    const c = this.cine;
    if (phase === 'enter') {
      c.c4env = { ...c.P };
      return;
    }
    if (phase === 'exit') {
      c.c4env = null;
      return;
    }
    const E = S.env,
      B = c.c4env;
    if (!E || !B) return;
    const A = c.set.anchor;
    const k = sstep(E.y0, E.y1, this.camera.position.y - A.y);
    const P = c.P;
    const ca = new THREE.Color(),
      cb = new THREE.Color();
    for (const key of Object.keys(E.hi)) {
      const lo = E.lo[key] !== undefined ? E.lo[key] : B[key],
        hi = E.hi[key];
      if (typeof hi === 'number') P[key] = lerp(lo, hi, k);
      else if (typeof hi === 'string' && hi[0] === '#') {
        ca.set(lo || hi);
        cb.set(hi);
        P[key] = '#' + ca.lerp(cb, k).getHexString();
      } else P[key] = k > 0.5 ? hi : lo;
    }
    for (const key of Object.keys(E.mul || {})) P[key] = B[key] * lerp(1, E.mul[key], k);
    // 雲海＝高度霧：鏡頭在雲下時關掉，到了雲層才出現
    if (E.cloudY != null) {
      P.hfogH = A.y + E.cloudY;
      P.hfogFall = E.fall || 5;
      P.hfog = (E.hfog || 1) * sstep(E.cloudY - 30, E.cloudY - 4, this.camera.position.y - A.y);
    }
  },
  // ---------- 把演員釘在關鍵影格上 ----------
  cineHook_c4pin(S, phase, lt) {
    if (phase !== 'tick') return;
    const c = this.cine;
    for (const P of S.pin || []) {
      const A = c.actors.get(P.id);
      if (!A || !A.e || A.e.dead) continue;
      const K = P.keys;
      const t = lt + S.at - A.t0; // 演員自己的時間（同一張地圖連續的鏡頭沿用）
      if (t < K[0].t) continue;
      let i = 0;
      while (i < K.length - 1 && K[i + 1].t <= t) i++;
      const a = K[i],
        b = K[Math.min(i + 1, K.length - 1)];
      const u = b === a ? 0 : smooth(clamp((t - a.t) / (b.t - a.t), 0, 1));
      const e = A.e;
      const p = this.c4At(a.p).lerp(this.c4At(b.p), u);
      e.pos.copy(p);
      e.vel.set(0, 0, 0);
      e.mesh.position.copy(p);
      const yaw = lerp(a.yaw || 0, b.yaw == null ? a.yaw || 0 : b.yaw, u) * D2R;
      e.yaw = e.aimYaw = yaw;
      e.mesh.rotation.set(lerp(a.pitch || 0, b.pitch || 0, u) * D2R, yaw, 0, 'YXZ');
      // 爬的時候冒火花
      if (P.spark && !c.paused && u > 0 && u < 1 && Math.random() < 0.08) this.fx.spark(p.clone(), 0xffa040);
    }
  },
  // ---------- 滑動變焦：主體在畫面上的大小不變（依距離改 fov） ----------
  cineHook_c4dz(S, phase, lt) {
    if (phase !== 'tick' || !S.dz) return;
    const D = S.dz;
    if (lt < D.t0 || lt > D.t1) return;
    const A = this.cine.actors.get(D.a);
    const tp = A && A.e ? A.e.center() : this.c4At(D.p || [0, 0, 0]);
    const d = this.camera.position.distanceTo(tp);
    const cam = this.camera;
    cam.fov = clamp((2 * Math.atan(D.h / 2 / Math.max(0.5, d))) / D2R, 6, 100);
    cam.updateProjectionMatrix();
  },

  // ---------- 抉擇 2 的選前：發射控制室 ----------
  cineHook_c4room(S, phase, lt) {
    if (phase === 'exit') return this.c4Free('room');
    const c = this.cine;
    if (phase === 'enter') {
      this.c4Sync(S);
      this.c4Free('room');
      const R = this.c4Rec('room');
      R.g.position.copy(this.c4At(S.room));
      const M = (color, o = {}) => {
        const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.4, ...o });
        R.own.push(m);
        return m;
      };
      const B = (color) => {
        const m = new THREE.MeshBasicMaterial({ color });
        R.own.push(m);
        return m;
      };
      const box = (m, w, h, d, x, y, z, rx = 0) => {
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
        o.position.set(x, y, z);
        o.rotation.x = rx;
        R.g.add(o);
        return o;
      };
      const wall = M(0x15181c),
        dark = M(0x0c0e11),
        desk = M(0x22272d, { metalness: 0.6, roughness: 0.5 });
      box(dark, 12, 0.2, 10, 0, -0.1, 0);
      box(wall, 12, 4.4, 0.2, 0, 2.2, -4.2);
      box(wall, 0.2, 4.4, 10, -5.5, 2.2, 0);
      box(wall, 0.2, 4.4, 10, 5.5, 2.2, 0);
      box(dark, 12, 0.2, 10, 0, 4.4, 0);
      // 天花板的燈條（暗的青色）
      const strip = B(0x2a5060);
      for (const x of [-3, 0, 3]) box(strip, 0.12, 0.04, 7, x, 4.28, 0);
      // 牆上的大螢幕：倒數與發射台的線框（每格重畫）
      const cv = document.createElement('canvas');
      cv.width = 1024;
      cv.height = 448;
      const tex = new THREE.CanvasTexture(cv);
      const sm = new THREE.MeshBasicMaterial({ map: tex });
      R.own.push(tex, sm);
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.8), sm);
      scr.position.set(0, 2.45, -4.08);
      R.g.add(scr);
      box(desk, 6.8, 3.2, 0.1, 0, 2.45, -4.14);
      // 控制台：桌身＋斜的面板（按鈕、指示燈）
      box(desk, 4.6, 0.95, 1.1, 0, 0.47, -1.7);
      const panel = new THREE.Group();
      panel.position.set(0, 1.0, -1.62);
      panel.rotation.x = -0.42;
      R.g.add(panel);
      const pm = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.08, 1.2), M(0x2a3038, { metalness: 0.7 }));
      panel.add(pm);
      const btn = [];
      for (const [s, col, lab] of [
        [-1, 0x5cff6a, 'VEERWELL ／ LAUNCH'],
        [1, 0xffdc50, 'SANCTA ／ SEAL'],
      ]) {
        const x0 = s * 0.78;
        // 黑黃的警示框
        const fr = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.03, 0.62), M(0xd8a020));
        fr.position.set(x0, 0.05, 0.05);
        panel.add(fr);
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.27, 0.06, 20), M(0x111316));
        base.position.set(x0, 0.08, 0.05);
        panel.add(base);
        const bm = B(col);
        const bt = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.09, 20), bm);
        bt.position.set(x0, 0.14, 0.05);
        panel.add(bt);
        // 光暈（貼在面板上的加色圓形；不用 Sprite，Sprite 在過場的後處理裡會變成方塊）
        const gm = new THREE.MeshBasicMaterial({
          map: glowTex(),
          color: col,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          fog: false,
        });
        R.own.push(gm);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), gm);
        gl.rotation.x = -Math.PI / 2;
        gl.position.set(x0, 0.06, 0.05);
        panel.add(gl);
        // 標籤
        const lc = document.createElement('canvas');
        lc.width = 256;
        lc.height = 48;
        const lx = lc.getContext('2d');
        lx.fillStyle = '#' + new THREE.Color(col).getHexString();
        lx.font = `bold 26px ${MONO}`;
        lx.textAlign = 'center';
        lx.fillText(lab, 128, 33);
        const lt2 = new THREE.CanvasTexture(lc);
        const lm = new THREE.MeshBasicMaterial({ map: lt2, transparent: true, depthWrite: false });
        R.own.push(lt2, lm);
        const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.15), lm);
        lp.rotation.x = -Math.PI / 2;
        lp.position.set(x0, 0.046, 0.48);
        panel.add(lp);
        btn.push({ bm, gm, col: new THREE.Color(col), who: s < 0 ? 'veerwell' : 'sancta' });
      }
      // 指示燈列
      const leds = [];
      for (let i = 0; i < 26; i++) {
        const m = B(i % 5 === 0 ? 0xff4030 : i % 3 === 0 ? 0x40d0ff : 0x60ff80);
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.04), m);
        l.position.set(-2.0 + (i % 13) * 0.33, 0.06, -0.45 + Math.floor(i / 13) * 0.12);
        panel.add(l);
        leds.push(l);
      }
      // 兩側的小螢幕（委託方的徽章）
      for (const [s, who] of [
        [-1, 'veerwell'],
        [1, 'sancta'],
      ]) {
        const Sp = SPEAKERS[who];
        const mc = document.createElement('canvas');
        mc.width = mc.height = 128;
        const mx = mc.getContext('2d');
        mx.fillStyle = '#05080b';
        mx.fillRect(0, 0, 128, 128);
        mx.strokeStyle = Sp.color;
        mx.lineWidth = 4;
        mx.strokeRect(14, 14, 100, 100);
        mx.fillStyle = Sp.color;
        mx.font = 'bold 64px sans-serif';
        mx.textAlign = 'center';
        mx.textBaseline = 'middle';
        mx.fillText(Sp.mark, 64, 68);
        const mt = new THREE.CanvasTexture(mc);
        const mm = new THREE.MeshBasicMaterial({ map: mt });
        R.own.push(mt, mm);
        const mon = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), mm);
        mon.position.set(s * 2.0, 1.55, -1.95);
        mon.rotation.y = -s * 0.35;
        R.g.add(mon);
        box(desk, 0.8, 0.8, 0.06, s * 2.02, 1.55, -1.99).rotation.y = -s * 0.35;
      }
      R.st = { cv, tex, btn, leds, last: -1 };
      return;
    }
    if (phase !== 'tick') return;
    const R = c.c4 && c.c4.room;
    if (!R) return;
    const st = R.st;
    // 按鈕：說話的那一方亮、另一方暗；倒數最後幾秒兩個一起閃
    const talk = (S.duo || []).filter((d) => lt >= d.t && lt < d.t + d.d).map((d) => d.who);
    const T = this.c4CountVal(S.cd);
    const end = T != null && T < 2.2;
    for (const b of st.btn) {
      const on = talk.includes(b.who) ? 1 : end ? (Math.sin(c.t * 14) > 0 ? 1 : 0.25) : 0.45;
      const pulse = on * (0.85 + Math.sin(c.t * 5) * 0.15);
      b.bm.color.copy(b.col).multiplyScalar(0.35 + pulse * 0.9);
      b.gm.opacity = 0.25 + pulse * 0.75;
    }
    for (let i = 0; i < st.leds.length; i++)
      st.leds[i].visible = Math.sin(c.t * (2 + (i % 4)) + i * 1.7) > -0.4;
    // 大螢幕：每 0.05 秒重畫一次
    const fr = Math.floor(c.t * 20);
    if (fr !== st.last) {
      st.last = fr;
      this.c4DrawScreen(st.cv.getContext('2d'), st.cv.width, st.cv.height, T, c.t);
      st.tex.needsUpdate = true;
    }
  },
  // 控制室的大螢幕：發射台的線框＋倒數
  c4DrawScreen(x, W, H, T, t) {
    x.fillStyle = '#03080c';
    x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(80,200,255,0.12)';
    x.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 32) {
      x.beginPath();
      x.moveTo(gx, 0);
      x.lineTo(gx, H);
      x.stroke();
    }
    for (let gy = 0; gy < H; gy += 32) {
      x.beginPath();
      x.moveTo(0, gy);
      x.lineTo(W, gy);
      x.stroke();
    }
    // 發射台（線框）
    x.strokeStyle = 'rgba(120,220,255,0.85)';
    x.lineWidth = 2;
    const bx = 160,
      by = 400;
    x.strokeRect(bx - 18, by - 300, 36, 270);
    x.beginPath();
    x.moveTo(bx - 18, by - 300);
    x.lineTo(bx, by - 345);
    x.lineTo(bx + 18, by - 300);
    x.stroke();
    for (let y = by - 30; y > by - 330; y -= 22) {
      x.beginPath();
      x.moveTo(bx - 70, y);
      x.lineTo(bx - 46, y - 22);
      x.moveTo(bx - 46, y);
      x.lineTo(bx - 70, y - 22);
      x.stroke();
    }
    x.strokeRect(bx - 70, by - 330, 24, 300);
    x.beginPath();
    x.moveTo(bx - 110, by);
    x.lineTo(bx + 110, by);
    x.stroke();
    // 倒數
    const v = T == null ? 0 : Math.max(0, T);
    const red = v < 3;
    x.fillStyle = red ? '#ff5040' : '#ffb050';
    x.font = `bold 150px ${MONO}`;
    x.textAlign = 'left';
    x.fillText(`T-${String(Math.floor(v)).padStart(2, '0')}`, 330, 230);
    x.font = `60px ${MONO}`;
    x.fillText('.' + String(Math.floor((v % 1) * 100)).padStart(2, '0'), 760, 230);
    x.fillStyle = 'rgba(160,220,255,0.9)';
    x.font = `28px ${MONO}`;
    x.fillText('PAD-2 // GRID 086 NORTH', 330, 90);
    x.fillText('AUTHORIZATION : PENDING', 330, 300);
    if (Math.sin(t * 8) > 0) {
      x.fillStyle = '#ff5040';
      x.fillText('▶ AWAITING OPERATOR R-07', 330, 350);
    }
  },

  // ---------- 發射台與火箭（維爾威的選後、章末） ----------
  cineHook_c4launch(S, phase, lt, dt) {
    if (phase === 'exit') return this.c4Free('launch');
    const c = this.cine;
    const L = S.launch;
    if (phase === 'enter') {
      this.c4Sync(S);
      this.c4Free('launch');
      const R = this.c4Rec('launch');
      R.g.position.copy(c.set.anchor);
      this.c4Hide(R, L.clearR || 70);
      const P = L.at;
      const tw = buildPadTower(L.h * 1.25, -L.r * 3.2, 8);
      tw.position.set(P[0], this.c4At({ g: P }).y - c.set.anchor.y, P[1]);
      R.g.add(tw);
      const rk = buildRocket(L.h, L.r);
      rk.group.position.set(P[0], tw.position.y + 0.8, P[1]);
      R.g.add(rk.group);
      R.own.push(...rk.mats);
      R.st = { rk, y0: rk.group.position.y, huts: [], lit: false, ig: false, smokeT: 0 };
      // 外圍的聚落（棚屋＋帳篷）：每棟自己的材質，尾焰掃過時燒黑
      for (const [x, z, r, kind] of L.town || []) {
        const g = kind ? buildTent([0xb8a070, 0x8a9a7a, 0xa07050][kind % 3]) : buildShack(0x7a7468);
        g.position.set(x, this.c4At({ g: [x, z] }).y - c.set.anchor.y - 0.1, z);
        g.rotation.y = (r || 0) * D2R;
        const mats = [];
        g.traverse((o) => {
          if (!o.isMesh) return;
          o.material = o.material.clone();
          R.own.push(o.material);
          mats.push([o.material, o.material.color.clone()]);
        });
        R.g.add(g);
        const d = Math.hypot(x - P[0], z - P[1]);
        R.st.huts.push({ g, mats, d, burnt: L.mode === 'burnt' ? 1 : 0, fire: false });
      }
      // 夜間：探照燈的光柱（加色的半透明圓錐）照著火箭
      if (L.mode === 'night') {
        const bm = new THREE.MeshBasicMaterial({
          color: 0xbfd8ff,
          transparent: true,
          opacity: 0.06,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });
        R.own.push(bm);
        for (const [x, z] of [
          [-26, 14],
          [24, 10],
          [-18, -30],
        ]) {
          const from = new THREE.Vector3(x, 0.5, z),
            to = new THREE.Vector3(P[0], L.h * 0.7, P[1]);
          const len = from.distanceTo(to);
          const cone = new THREE.Mesh(new THREE.ConeGeometry(5, len, 16, 1, true), bm);
          cone.position.copy(from).lerp(to, 0.5);
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), to.clone().sub(from).normalize());
          R.g.add(cone);
        }
        const lm = new THREE.MeshBasicMaterial({ color: 0xfff0d0 });
        R.own.push(lm);
        for (let i = 0; i < 12; i++) {
          const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), lm);
          l.position.set(P[0] - L.r * 3.2 + (i % 2 ? 4 : -4), 4 + i * L.h * 0.09, P[1] + (i % 3) - 1);
          R.g.add(l);
        }
      }
      // 燒過的聚落：一開始就是焦黑，還有幾處在燒
      for (const h of R.st.huts)
        if (h.burnt) {
          this.c4Burn(h, 1);
          if (h.d % 3 < 1.4) this.fx.firePool(h.g.getWorldPosition(new THREE.Vector3()), 2.6, 30, 0);
        }
      return;
    }
    if (phase !== 'tick') return;
    const R = c.c4 && c.c4.launch;
    if (!R) return;
    const st = R.st,
      A = c.set.anchor;
    const P = L.at;
    const base = new THREE.Vector3(A.x + P[0], A.y + st.y0, A.z + P[1]);
    // 燒過的聚落：一直悶燒冒煙
    if (L.mode === 'burnt') {
      st.smokeT -= c.paused ? 0 : dt;
      if (st.smokeT <= 0) {
        st.smokeT = 0.18;
        const h = st.huts[Math.floor(Math.random() * st.huts.length)];
        if (h) {
          const p = h.g.getWorldPosition(new THREE.Vector3());
          this.fx.smoke(p.add(new THREE.Vector3(0, 2, 0)), 2.2, 0x2e2c2a, 3.5, 2.5);
          if (Math.random() < 0.3) this.fx.flash(p, 0.8, 0xff7a30, 0.3);
        }
      }
      return;
    }
    if (L.mode !== 'lift') return;
    // 點火：尾焰沿導焰槽往外掃，經過的棚屋燒黑
    const tig = L.ig;
    this.c4Plume(st.rk.plume, lt >= tig, clamp((lt - L.t0) / 3, 0, 1));
    if (lt >= tig) {
      const d = (lt - tig) * (L.front || 34);
      if (!st.ig) {
        st.ig = true;
        this.fx.flash(base.clone().setY(base.y + 3), 8, 0xffe0b0, 0.6);
        this.fx.flashLight && this.fx.flashLight(base.clone().setY(base.y + 6), 0xffb070, 14);
      }
      const ry = c4RocketY(lt, L.t0, L.acc);
      const noz = base.clone().setY(base.y + ry);
      // 火箭本體
      st.rk.group.position.y = st.y0 + ry;
      if (!c.paused && Math.random() < 0.8) {
        this.fx.flameCone(noz, new THREE.Vector3(0, -1, 0), 10 + Math.min(30, ry * 0.3), 0.18, 6);
        this.fx.smoke(noz.clone().setY(noz.y - 6), 3 + Math.min(6, ry * 0.05), 0xb0aca6, 4, 1.2);
      }
      if (ry < 2 && !c.paused) this.fx.flashLight && this.fx.flashLight(noz, 0xffa060, 10);
      // 地面的尾焰（點火後 3 秒內）
      if (lt - tig < 3.2 && !c.paused && Math.random() < 0.7) {
        const dir = new THREE.Vector3(L.dir[0], 0.04, L.dir[1]).normalize();
        const p0 = base.clone().setY(base.y + 1.2);
        this.fx.flameCone(p0, dir, Math.min(d, 60), 0.32, 10);
        const fp = p0.clone().addScaledVector(dir, Math.min(d, 60));
        this.fx.smoke(fp, 6, 0x6a625a, 5, 1.5);
      }
      for (const h of st.huts) {
        if (d > h.d && h.burnt < 1) {
          h.burnt = Math.min(1, h.burnt + 0.05);
          this.c4Burn(h, h.burnt);
          if (!h.fire) {
            h.fire = true;
            const p = h.g.getWorldPosition(new THREE.Vector3());
            this.fx.firePool(p, 3.4, 9, 0);
            this.fx.flash(p.clone().setY(p.y + 2), 3, 0xffb060, 0.25);
          }
        }
      }
    }
  },
  // 棚屋燒黑：顏色往焦黑內插
  c4Burn(h, k) {
    const ch = new THREE.Color(0x141210);
    for (const [m, c0] of h.mats) m.color.copy(c0).lerp(ch, k);
  },

  // ---------- 聖域的選後：發射設施的大門 ----------
  cineHook_c4gate(S, phase, lt) {
    if (phase === 'exit') return this.c4Free('gate');
    const c = this.cine;
    const G = S.gate;
    if (phase === 'enter') {
      this.c4Sync(S);
      this.c4Free('gate');
      const R = this.c4Rec('gate');
      R.g.position.copy(c.set.anchor);
      this.c4Hide(R, G.clearR || 60);
      if (G.hideAt) this.c4Hide(R, G.hideAt[2], G.hideAt); // 鏡頭附近擋住畫面的物件
      const steel = mat(0x5a6068, { roughness: 0.55, metalness: 0.7 }),
        dk = mat(0x2a2d31, { roughness: 0.8 }),
        yl = mat(0xd8a020, { roughness: 0.6 });
      const [gx, gz] = G.at;
      const gy = this.c4At({ g: G.at }).y - c.set.anchor.y;
      // 門框：兩根柱子＋橫樑（警示條紋）
      const k = new PK();
      for (const s of [-1, 1]) {
        k.cb(steel, 7, 36, 7, s * 19, 18, 0, 0, 0, 0, 0.3);
        for (let y = 3; y < 34; y += 4) k.box(dk, 7.1, 0.4, 7.1, s * 19, y, 0);
      }
      k.cb(steel, 45, 6, 7, 0, 37, 0, 0, 0, 0, 0.3);
      for (let x = -21; x < 22; x += 3) k.box(x % 2 ? yl : dk, 1.5, 1.2, 0.2, x, 33.6, 3.55);
      k.box(dk, 31, 0.6, 2, 0, 0.3, 0);
      const frame = k.build();
      frame.position.set(gx, gy, gz);
      R.g.add(frame);
      // 兩扇門：鋼板＋加強肋＋警示條紋（往中間滑動）
      const doors = [];
      for (const s of [-1, 1]) {
        const d = new PK();
        d.cb(steel, 15.6, 32, 2.6, 0, 16, 0, 0, 0, 0, 0.15);
        for (let y = 2; y < 32; y += 3.2) d.box(dk, 15.2, 0.35, 2.8, 0, y, 0);
        for (const x of [-5, 0, 5]) d.box(dk, 0.5, 31, 2.9, x, 16, 0);
        for (let y = 1; y < 31; y += 2.4)
          d.box(y % 4.8 < 2.4 ? yl : dk, 0.8, 1.2, 2.95, -s * 7.4, y + 0.6, 0);
        const g = d.build();
        g.position.set(gx + s * (G.closed ? 7.8 : 7.8 + G.open), gy, gz);
        R.g.add(g);
        doors.push({ g, s });
      }
      // 門後的發射塔與火箭（從門縫看得到）
      const tw = buildPadTower(56, -10, 8);
      tw.position.set(gx + 4, gy, gz - 52);
      R.g.add(tw);
      const rk = buildRocket(46, 3.6);
      rk.group.position.set(gx + 4, gy + 0.8, gz - 52);
      R.g.add(rk.group);
      R.own.push(...rk.mats);
      // 門上方的狀態燈
      const lm = new THREE.MeshBasicMaterial({ color: 0xffb020 });
      R.own.push(lm);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 0.6), lm);
      lamp.position.set(gx, gy + 41, gz + 3.6);
      R.g.add(lamp);
      R.st = { doors, gx, lamp, lm, slam: !!G.closed };
      return;
    }
    if (phase !== 'tick') return;
    const R = c.c4 && c.c4.gate;
    if (!R) return;
    const st = R.st;
    if (!G.closed) {
      const u = smooth(clamp((lt - G.t0) / (G.t1 - G.t0), 0, 1));
      for (const d of st.doors) d.g.position.x = st.gx + d.s * (7.8 + G.open * (1 - u));
      if (u >= 1 && !st.slam) {
        st.slam = true;
        const p = this.c4At([G.at[0], 1, G.at[1] + 2]);
        this.fx.dust(p, 16, 24, 0x9a9488);
        this.fx.shockwave(p, 22, 0xffd090, 0.6);
      }
    }
    // 狀態燈：關上之前橘色閃、關上之後紅色常亮
    st.lm.color.set(st.slam ? 0xff2a1a : Math.sin(c.t * 9) > 0 ? 0xffb020 : 0x402800);
    // 凍結：關上之後畫面慢慢褪色
    if (G.freeze != null && c.c4gateP == null) c.c4gateP = { sat: c.P.sat, temp: c.P.temp };
    if (G.freeze != null) {
      const k = sstep(G.freeze, G.freeze + 1.2, lt);
      c.P.sat = lerp(c.c4gateP.sat == null ? 1 : c.c4gateP.sat, 0.2, k);
      c.P.temp = lerp(c.c4gateP.temp || 0, -0.45, k);
    }
  },

  // ---------- 疊加：倒數 ----------
  // S.cd＝{ from, at（過場的第幾秒是 from）, hold（停在這個數字）, label, call: [{ t, d, txt }] }
  c4CountVal(cd) {
    if (!cd || !this.cine) return null;
    let v = cd.from - (this.cine.t - (cd.at || 0));
    if (cd.hold != null) v = Math.max(cd.hold, v);
    return v;
  },
  cineOv_c4count(x, W, H, lt, S) {
    const cd = S.cd;
    if (!cd) return;
    const c = this.cine;
    const s = H / 720;
    const v = this.c4CountVal(cd);
    const bar = c.bar || 0;
    // 右上角、遮幅的下面（遮幅的 DOM 蓋在疊加畫布上面）
    const big = v < 10.5 && v > -3;
    const sz = (big ? 34 : 24) * s;
    const yb = bar + 20 * s + sz;
    const xr = W - 34 * s;
    const held = cd.hold != null && v <= cd.hold;
    const neg = v < 0;
    const a = Math.abs(v);
    const txt = `${neg ? 'T+' : 'T−'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(Math.floor(a % 60)).padStart(2, '0')}.${String(Math.floor((a % 1) * 100)).padStart(2, '0')}`;
    x.save();
    x.textAlign = 'right';
    x.textBaseline = 'alphabetic';
    const col = held
      ? Math.sin(c.t * 7) > 0
        ? 'rgba(255,70,60,1)'
        : 'rgba(255,70,60,0.35)'
      : neg
        ? 'rgba(255,230,190,0.95)'
        : v < 10.5
          ? 'rgba(255,140,60,0.98)'
          : 'rgba(210,230,245,0.92)';
    x.fillStyle = col;
    x.shadowColor = held || v < 10.5 ? 'rgba(255,90,40,0.8)' : 'rgba(120,200,255,0.5)';
    x.shadowBlur = 10 * s;
    x.font = `${sz}px ${MONO}`;
    x.fillText(txt, xr, yb);
    x.shadowBlur = 0;
    x.font = `${11 * s}px ${MONO}`;
    x.fillStyle = 'rgba(190,210,225,0.75)';
    const lab = held ? 'HOLD — LAUNCH SEALED' : neg ? 'LIFTOFF' : cd.label || 'VEERWELL LAUNCH CONTROL';
    x.fillText(lab, xr, yb - sz - 4 * s);
    // 秒的刻度（一秒一格，倒數最後 10 秒）
    if (v > 0 && v < 10.5 && !held) {
      for (let i = 0; i < 10; i++) {
        x.fillStyle = i < Math.ceil(v) ? 'rgba(255,140,60,0.9)' : 'rgba(255,255,255,0.12)';
        x.fillRect(xr - (i + 1) * 9 * s, yb + 6 * s, 6 * s, 3 * s);
      }
    }
    // COUNTDOWN 的無線電（在倒數的下面）
    for (const k of cd.call || []) {
      const u = c.t - k.t;
      if (u < 0 || u > k.d) continue;
      const al = clamp(u / 0.2, 0, 1) * clamp((k.d - u) / 0.3, 0, 1);
      const n = Math.min(k.txt.length, Math.floor(u * 9) + 1);
      x.globalAlpha = al;
      x.fillStyle = SPEAKERS.countdown.color;
      x.font = `${13 * s}px ${SANS}`;
      x.fillText(`COUNTDOWN ▸ ${k.txt.slice(0, n)}`, xr, yb + 30 * s);
      x.globalAlpha = 1;
    }
    // 每秒一聲（最後 10 秒）
    const sec = Math.ceil(v);
    if (c.c4sec !== sec && v > 0 && v < 10.5 && !held && !c.paused)
      SFX.play('uiTick', 0.5, 0.8, 0, 0, null, 'ui');
    c.c4sec = sec;
    x.restore();
  },
  // ---------- 疊加：穿過雲層（鏡頭接近雲的高度時整個畫面蓋上流動的白霧） ----------
  cineOv_c4cloud(x, W, H, lt, S) {
    const c = this.cine;
    const cl = S.tw && S.tw.cloud;
    if (!cl || !c.set) return;
    const dy = this.camera.position.y - c.set.anchor.y - (cl.y + 2);
    const k = clamp(1 - Math.abs(dy) / (cl.th || 9), 0, 1);
    if (k <= 0) return;
    x.save();
    x.fillStyle = `rgba(232,238,244,${(0.9 * smooth(k)).toFixed(3)})`;
    x.fillRect(0, 0, W, H);
    // 流過去的雲團（往下流＝鏡頭往上）
    for (let i = 0; i < 14; i++) {
      const px = ((i * 0.37 + Math.sin(i * 3.1) * 0.2) % 1) * W;
      const py = (((i * 0.53 + c.t * 0.35) % 1.4) - 0.2) * H;
      const r = (0.18 + (i % 4) * 0.07) * W;
      const g = x.createRadialGradient(px, py, 0, px, py, r);
      g.addColorStop(0, `rgba(255,255,255,${0.5 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(px - r, py - r, r * 2, r * 2);
    }
    x.restore();
  },
  // ---------- 疊加：兩種顏色的對話（同一個鏡頭裡，左右各一個說話者） ----------
  // S.duo＝[{ t, d, who, text, side: 'l'|'r' }]
  cineOv_c4duo(x, W, H, lt, S) {
    const c = this.cine;
    const s = H / 720;
    const bar = c.bar || 0;
    c.c4duoSaid = c.c4duoSaid || new Set();
    x.save();
    for (const L of S.duo || []) {
      const u = lt - L.t;
      if (u < 0 || u > L.d) continue;
      const key = S.at + ':' + L.t;
      if (!c.c4duoSaid.has(key)) {
        c.c4duoSaid.add(key);
        if (u < 0.5) SFX.radio();
      }
      const Sp = SPEAKERS[L.who] || SPEAKERS.echo;
      const al = clamp(u / 0.25, 0, 1) * clamp((L.d - u) / 0.4, 0, 1);
      const left = L.side !== 'r';
      const fs = 19 * s;
      x.font = `${fs}px ${SANS}`;
      const lines = wrap(x, L.text, W * 0.36);
      const n = lines.length;
      const y0 = H - bar - 40 * s - (n - 1) * fs * 1.4 - (left ? 0 : 0);
      const xx = left ? W * 0.06 : W * 0.94;
      x.textAlign = left ? 'left' : 'right';
      x.globalAlpha = al;
      // 名字＋細的色條
      x.fillStyle = Sp.color;
      x.font = `700 ${12 * s}px ${MONO}`;
      x.fillText(Sp.name, xx, y0 - fs * 1.55);
      x.fillRect(left ? xx : xx - 46 * s, y0 - fs * 1.22, 46 * s, 2 * s);
      x.font = `${fs}px ${SANS}`;
      x.shadowColor = 'rgba(0,0,0,0.9)';
      x.shadowBlur = 6 * s;
      // 逐字（說話的速度）
      let left2 = Math.floor(u * 16) + 1;
      lines.forEach((ln, i) => {
        const part = ln.slice(0, Math.max(0, left2));
        left2 -= ln.length;
        x.fillStyle = Sp.color;
        x.fillText(part, xx, y0 + i * fs * 1.4);
      });
      x.shadowBlur = 0;
    }
    x.restore();
  },
  // ---------- 疊加：直向捲動的章名（像火箭一樣從下往上） ----------
  // S.vt＝{ t, d, text, s }
  cineOv_c4title(x, W, H, lt, S) {
    const V = S.vt;
    if (!V) return;
    const u = lt - V.t;
    if (u < 0 || u > V.d) return;
    const s = H / 720;
    const chars = [...V.text];
    const fs = 46 * s,
      gap = fs * 1.18;
    const colH = chars.length * gap;
    // 從畫面下方升上來、減速停在中央，最後再往上飛出去
    const rise = 1 - Math.pow(1 - clamp(u / 2.6, 0, 1), 3);
    const out = Math.pow(clamp((u - (V.d - 1.3)) / 1.3, 0, 1), 2);
    const yTop = H + 20 * s - rise * (H / 2 + colH / 2 + 20 * s) - out * H * 0.8;
    const xc = W * (V.x || 0.5);
    x.save();
    x.globalAlpha = 1 - out * 0.8;
    // 尾跡：一條細的光線
    const gl = x.createLinearGradient(0, yTop + colH, 0, H);
    gl.addColorStop(0, 'rgba(255,220,170,0.7)');
    gl.addColorStop(1, 'rgba(255,220,170,0)');
    x.fillStyle = gl;
    x.fillRect(xc - 1 * s, yTop + colH + 8 * s, 2 * s, H);
    x.font = `700 ${fs}px "Noto Serif TC", ${SANS}`;
    x.textAlign = 'center';
    x.textBaseline = 'top';
    x.fillStyle = '#f4f1ea';
    x.shadowColor = 'rgba(255,190,120,0.7)';
    x.shadowBlur = 16 * s;
    chars.forEach((ch, i) => x.fillText(ch, xc, yTop + i * gap));
    x.shadowBlur = 0;
    // 副標（橫躺，貼在章名的右邊）
    x.translate(xc + fs * 0.95, yTop);
    x.rotate(Math.PI / 2);
    x.font = `${13 * s}px ${MONO}`;
    x.textAlign = 'left';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(230,236,242,0.8)';
    x.fillText(V.s || '', 0, 0);
    x.restore();
  },
  // ---------- 疊加：各勢力的頻道都在講東岸 ----------
  // S.radio＝[{ t, who, txt }]
  cineOv_c4radio(x, W, H, lt, S) {
    const c = this.cine;
    const s = H / 720;
    const L = (S.radio || []).filter((r) => lt >= r.t);
    if (!L.length) return;
    c.c4radioN = c.c4radioN || {};
    const key = S.at;
    if ((c.c4radioN[key] || 0) < L.length && !c.paused) {
      c.c4radioN[key] = L.length;
      SFX.play('glitch', 0.25, 0.7 + Math.random() * 0.5, 0, 0, null, 'ui');
    }
    x.save();
    const lh = 30 * s;
    const yb = H * 0.62;
    // 新的一行從下面推上來，舊的往上淡出
    L.forEach((r, i) => {
      const age = lt - r.t;
      const row = L.length - 1 - i;
      const y = yb - row * lh - clamp(1 - age / 0.2, 0, 1) * -lh * 0.5;
      const al = clamp(age / 0.15, 0, 1) * clamp(1 - row / 7, 0, 1);
      if (al <= 0) return;
      const Sp = SPEAKERS[r.who] || SPEAKERS.enemy;
      x.globalAlpha = al;
      x.font = `${11 * s}px ${MONO}`;
      x.textAlign = 'right';
      x.fillStyle = 'rgba(170,190,205,0.7)';
      x.fillText(`CH ${(12.4 + ((i * 7.3) % 40)).toFixed(1)}`, W * 0.2, y);
      x.fillStyle = Sp.color;
      x.fillText(Sp.mark, W * 0.2 + 20 * s, y);
      x.textAlign = 'left';
      x.font = `${16 * s}px ${SANS}`;
      const n = Math.min(r.txt.length, Math.floor(age * 22) + 1);
      let t = r.txt.slice(0, n);
      // 雜訊：偶爾有字變成方塊
      if (r.noise) t = t.replace(/./g, (ch) => (Math.random() < r.noise ? '█' : ch));
      x.fillText(t, W * 0.2 + 36 * s, y);
    });
    x.globalAlpha = 1;
    // 聲紋
    for (let i = 0; i < 48; i++) {
      const a = Math.abs(Math.sin(c.t * 11 + i * 1.3) * Math.sin(c.t * 4.1 + i * 0.7));
      x.fillStyle = 'rgba(160,200,230,0.35)';
      x.fillRect(W * 0.2 + i * 9 * s, yb + 30 * s - a * 14 * s, 5 * s, a * 28 * s);
    }
    x.restore();
  },
  // ---------- 疊加：霍斯特的手寫信＋背景很淡的夜空與軌道站的光點 ----------
  // S.letter＝{ t（開始寫的時間）, cps, gap（換行的停頓）, lines, sign, head, sky }
  cineOv_c4letter(x, W, H, lt, S) {
    const c = this.cine;
    const Lt = S.letter;
    if (!Lt) return;
    const s = H / 720;
    const fadeIn = clamp(lt / 1.6, 0, 1);
    x.save();
    // 夜空：很淡的星點與地平線的微光、軌道站的光點（比上一章大，慢慢一明一滅）
    if (Lt.sky) {
      x.globalAlpha = fadeIn;
      for (let i = 0; i < 90; i++) {
        const px = ((i * 977) % 1000) / 1000,
          py = ((i * 613) % 1000) / 1000;
        const tw = 0.15 + 0.15 * Math.sin(c.t * 1.3 + i);
        x.fillStyle = `rgba(200,215,240,${tw * 0.6})`;
        x.fillRect(px * W, (c.bar || 0) + py * (H * 0.75), 1.4 * s, 1.4 * s);
      }
      const hz = x.createLinearGradient(0, H * 0.55, 0, H);
      hz.addColorStop(0, 'rgba(40,60,90,0)');
      hz.addColorStop(1, 'rgba(60,70,90,0.22)');
      x.fillStyle = hz;
      x.fillRect(0, H * 0.55, W, H * 0.45);
      const sx = W * 0.74,
        sy = H * 0.3;
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(c.t * 1.6));
      const end = clamp((lt - (Lt.flare || 1e9)) / 0.6, 0, 1) * clamp((Lt.flare + 2.4 - lt) / 1.2, 0, 1);
      const r = (9 + pulse * 4 + end * 20) * s;
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, r * 4);
      g.addColorStop(0, `rgba(255,220,210,${0.5 + end * 0.4})`);
      g.addColorStop(0.18, `rgba(255,110,90,${0.22 + end * 0.3})`);
      g.addColorStop(1, 'rgba(255,80,60,0)');
      x.fillStyle = g;
      x.fillRect(sx - r * 4, sy - r * 4, r * 8, r * 8);
      x.fillStyle = 'rgba(255,240,235,0.95)';
      x.fillRect(sx - 1.5 * s, sy - 1.5 * s, 3 * s, 3 * s);
      // 十字光芒
      x.fillStyle = `rgba(255,170,150,${0.25 + end * 0.4})`;
      x.fillRect(sx - r * 2.2, sy - 0.6 * s, r * 4.4, 1.2 * s);
      x.fillRect(sx - 0.6 * s, sy - r * 1.6, 1.2 * s, r * 3.2);
    }
    // 信紙：半透明、橫線，左上是機器打的抬頭
    const pw = Math.min(W * 0.62, 760 * s),
      ph = H * 0.56;
    const px = W * 0.12,
      py = H * 0.5 - ph / 2;
    x.globalAlpha = fadeIn * 0.9;
    x.fillStyle = 'rgba(232,222,200,0.07)';
    x.fillRect(px, py, pw, ph);
    x.strokeStyle = 'rgba(232,222,200,0.16)';
    x.lineWidth = 1;
    const fs = 30 * s,
      lh = fs * 1.75;
    const top = py + ph * 0.3;
    for (let i = 0; i < 6; i++) {
      x.beginPath();
      x.moveTo(px + 24 * s, top + i * lh + 8 * s);
      x.lineTo(px + pw - 24 * s, top + i * lh + 8 * s);
      x.stroke();
    }
    x.globalAlpha = fadeIn;
    x.font = `${11 * s}px ${MONO}`;
    x.fillStyle = 'rgba(216,144,58,0.85)';
    (Lt.head || []).forEach((h, i) => x.fillText(h, px + 24 * s, py + 28 * s + i * 15 * s));
    // 手寫：逐字寫出（每個字從左到右擦出，字稍微歪）
    const all = [...Lt.lines, Lt.sign || ''];
    let tt = lt - Lt.t;
    let wrote = 0;
    x.font = `${fs}px ${HAND}`;
    x.textBaseline = 'alphabetic';
    for (let li = 0; li < all.length && tt > 0; li++) {
      const chars = [...all[li]];
      const sign = li === all.length - 1;
      let cx = px + 30 * s + (sign ? pw * 0.5 : 0);
      const cy = top + li * lh;
      for (let ci = 0; ci < chars.length && tt > 0; ci++) {
        const ch = chars[ci];
        const k = clamp(tt * Lt.cps, 0, 1); // 這個字寫了多少
        const cw = x.measureText(ch).width;
        const seed = li * 31 + ci * 7;
        x.save();
        x.beginPath();
        x.rect(cx - 2 * s, cy - fs * 1.1, (cw + 4 * s) * k, fs * 1.5);
        x.clip();
        x.translate(cx + cw / 2, cy - fs * 0.35);
        x.rotate((((seed * 13) % 9) - 4) * 0.012);
        x.fillStyle = 'rgba(242,232,210,0.95)';
        x.shadowColor = 'rgba(255,220,170,0.35)';
        x.shadowBlur = 5 * s;
        x.fillText(ch, -cw / 2, fs * 0.35 + (((seed * 7) % 5) - 2) * 0.6 * s);
        x.restore();
        // 筆尖
        if (k < 1) {
          x.fillStyle = 'rgba(255,240,220,0.9)';
          x.fillRect(cx + cw * k, cy - fs * 0.2, 2 * s, 2 * s);
        }
        cx += cw * 1.04;
        tt -= 1 / Lt.cps;
        wrote++;
      }
      tt -= Lt.gap || 0.5;
    }
    // 筆的聲音：每寫一個字一聲
    if ((c.c4pen || 0) < wrote && !c.paused)
      SFX.play('uiTick', 0.12, 0.45 + Math.random() * 0.2, 0, 0, null, 'ui');
    c.c4pen = wrote;
    x.restore();
  },
});
