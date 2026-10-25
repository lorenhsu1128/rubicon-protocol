// Game：機甲庫的格納庫演出（docs/garage-hangar.md）：場景依場合、整備架上的機體、繞看的鏡頭與依部位的鏡頭位置、
// 瀏覽零件時的全像預覽、換上零件時的掃描換裝
import { SFX } from '../audio/audio.js';
import {
  buildHangar,
  disposeHangar,
  emitSparks,
  glowMat,
  hatchOpen,
  keepAlpha,
  makeHatch,
  puff,
  removeHatch,
  robotReach,
  tickHangar,
} from '../render/hangar.js';
import { isOutline } from '../render/geometry.js';
import { animateMech, buildMech } from '../render/mech-model.js';
import { Game } from './game.js';

const POSE = { pose: 'garage', moving: false, grounded: true, hover: false, boost: false, aimPitch: 0 };
const DEF_VIEW = { yaw: 0.55, pitch: 0.2, dist: 7.4 };
// 全像（瀏覽零件）：青色、邊緣亮、掃描線
const HOLO = keepAlpha(
  new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(0x46d8ff) } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; vec4 mv = viewMatrix * wp;
      vV = -mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uT; uniform vec3 uC; varying vec3 vN; varying vec3 vV; varying float vY;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = f * f;
      float s = smoothstep(0.55, 1.0, 0.5 + 0.5 * sin(vY * 70.0 - uT * 5.0));
      float b = smoothstep(0.9, 1.0, fract(vY * 0.4 - uT * 0.6));
      float a = 0.1 + f * 0.75 + s * 0.12 + b * 0.35;
      gl_FragColor = vec4(uC * a, a); }`,
    transparent: true,
    depthWrite: false,
  }),
);
// 區塊屬於哪一類換裝：head、core、booster、arms、legs、weapon:r／l、back:r／l
const swapCat = (slot) => {
  const [c, , k] = slot.split('/');
  return c === 'weapon' || c === 'back' ? c + ':' + k : c;
};
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
const seg = (t, a, b) => ease((t - a) / (b - a));
// 實體換裝的時間表（秒）：接近 → 夾住 → 舊零件移走 → 新零件送來 → 鎖上 → 收回
const RT = { grab: 0.45, out0: 0.5, out1: 1.0, in0: 1.1, in1: 1.65, lock: 1.65, back0: 1.8, end: 2.1 };
const sideK = (k) => (k === 'l' ? 1 : -1); // 機體轉了 180°：右手在世界的 −X

Object.assign(Game.prototype, {
  // 依機甲庫的場合決定場景（campGarageUi 的 mode）
  hangarKind() {
    const mp = !!(this.net && this.net.role);
    const inG = !!((this.camp && this.camp.inGarage) || (this.campC && this.campC.inGarage));
    if (mp) return 'multi';
    if (inG) return 'field';
    if (this.fromHub) return 'ship';
    return 'base';
  },
  hangarFx() {
    const v = this.ctrl && this.ctrl.hangarFx;
    if (v === 'full' || v === 'short' || v === 'off') return v;
    return /[?&]test\b/.test(location.search) ? 'short' : 'full';
  },
  hangarEnsure() {
    const kind = this.hangarKind();
    if (this.hg && this.hg.H.kind === kind) return;
    const s = this.garageScene;
    if (this.hg) {
      s.remove(this.hg.H.root);
      disposeHangar(this.hg.H);
    }
    const H = buildHangar(kind);
    s.add(H.root);
    const L = H.light;
    s.background = new THREE.Color(L.bg);
    s.fog = new THREE.Fog(L.fog[0], L.fog[1], L.fog[2]);
    this.garageSun.color.set(L.sun[0]);
    this.garageSun.intensity = L.sun[1];
    this.garageHemi.color.set(L.hemi[0]);
    this.garageHemi.groundColor.set(L.hemi[1]);
    this.garageHemi.intensity = L.hemi[2];
    const old = this.hg || {};
    this.hg = {
      H,
      cam: old.cam || { ...DEF_VIEW, tgt: new THREE.Vector3(0, 1.9, 0) },
      goal: old.goal || { ...DEF_VIEW, tgt: new THREE.Vector3(0, 1.9, 0) },
      idle: 99,
      slot: null,
      hover: null,
      prev: null,
      swap: null,
    };
    this.hangarInput();
  },
  // 進機甲庫：下一次 renderGarage 不播換裝（記下的組裝清掉）
  hangarOpen() {
    this.hangarEnsure();
    this.hgAsm = null;
    this.hangarFinish();
    this.hg.slot = null;
  },
  // ---------- 鏡頭 ----------
  hangarInput() {
    if (this.hgInputOn) return;
    this.hgInputOn = true;
    const el = document.getElementById('garageMid');
    const pts = new Map();
    let pinch = 0;
    el.addEventListener('pointerdown', (e) => {
      if (this.state !== 'garage' || e.target.closest('#missionCard')) return;
      if (this.hg && this.hg.swap && this.hg.swap.rig) this.hangarFinish(); // 點一下略過換裝
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      el.setPointerCapture(e.pointerId);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p || !this.hg) return;
      const G = this.hg.goal;
      if (pts.size === 1) {
        G.yaw -= (e.clientX - p[0]) * 0.007;
        G.pitch = Math.max(-0.12, Math.min(1.1, G.pitch + (e.clientY - p[1]) * 0.005));
      } else if (pts.size === 2) {
        p[0] = e.clientX;
        p[1] = e.clientY;
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch > 0) G.dist = Math.max(2.4, Math.min(11, (G.dist * pinch) / d));
        pinch = d;
      }
      p[0] = e.clientX;
      p[1] = e.clientY;
      this.hg.idle = 0;
    });
    const up = (e) => {
      pts.delete(e.pointerId);
      pinch = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        if (this.state !== 'garage' || !this.hg) return;
        e.preventDefault();
        const G = this.hg.goal;
        G.dist = Math.max(2.4, Math.min(11, G.dist * (e.deltaY > 0 ? 1.1 : 0.9)));
        this.hg.idle = 0;
      },
      { passive: false },
    );
  },
  // 部位的鏡頭位置（目標點取機體上的節點）
  hangarView(slot) {
    const m = this.garageMech;
    const v = { ...DEF_VIEW, tgt: new THREE.Vector3(0, m ? m.height * 0.6 : 1.9, 0) };
    if (!m) return v;
    const at = (o, dy = 0) => o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, dy, 0));
    m.group.updateMatrixWorld(true);
    const S = {
      head: () => ({ yaw: 0.35, pitch: 0.12, dist: 3.6, tgt: at(m.head, 0.15) }),
      core: () => ({ yaw: 0.5, pitch: 0.15, dist: 4.2, tgt: at(m.torso, 0.35) }),
      generator: () => ({ yaw: 0.35, pitch: 0.1, dist: 4.6, tgt: at(m.torso, 0.3) }),
      fcs: () => ({ yaw: 0.25, pitch: 0.18, dist: 4.4, tgt: at(m.torso, 0.5) }),
      arms: () => ({ yaw: 0.6, pitch: 0.12, dist: 6.0, tgt: at(m.torso, 0.1) }),
      legs: () => ({ yaw: 0.5, pitch: 0.06, dist: 6.2, tgt: new THREE.Vector3(0, m.hipY * 0.55, 0) }),
      booster: () => ({ yaw: Math.PI - 0.6, pitch: 0.25, dist: 4.6, tgt: at(m.pack) }),
      rarm: () => ({ yaw: sideK('r') * 0.5, pitch: 0.12, dist: 4.8, tgt: at(m.arms.r.hand) }),
      larm: () => ({ yaw: sideK('l') * 0.5, pitch: 0.12, dist: 4.8, tgt: at(m.arms.l.hand) }),
      rback: () => ({ yaw: sideK('r') * 0.45, pitch: 0.35, dist: 5.0, tgt: at(m.arms.r.back) }),
      lback: () => ({ yaw: sideK('l') * 0.45, pitch: 0.35, dist: 5.0, tgt: at(m.arms.l.back) }),
    };
    return S[slot] ? { ...v, ...S[slot]() } : v;
  },
  hangarFocus(slot) {
    const v = this.hangarView(slot);
    const G = this.hg.goal;
    // 往最近的方向轉
    let dy = v.yaw - G.yaw;
    dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
    G.yaw += dy;
    G.pitch = v.pitch;
    G.dist = v.dist;
    G.tgt.copy(v.tgt);
    this.hg.idle = 99;
  },
  hangarCamera(dt) {
    const hg = this.hg,
      C = hg.cam,
      G = hg.goal;
    hg.idle += dt;
    // 停手 4 秒後回到目前部位的鏡頭位置
    if (hg.idle > 4 && hg.idle < 50) {
      this.hangarFocus(this.garageSlot);
      hg.idle = 99;
    }
    const k = 1 - Math.exp(-dt * (hg.idle < 0.5 ? 12 : 3.2));
    C.yaw += (G.yaw - C.yaw) * k;
    C.pitch += (G.pitch - C.pitch) * k;
    C.dist += (G.dist - C.dist) * k;
    C.tgt.lerp(G.tgt, k);
    const cam = this.garageCam;
    const cp = Math.cos(C.pitch);
    cam.position.set(
      C.tgt.x + Math.sin(C.yaw) * cp * C.dist,
      Math.max(0.35, C.tgt.y + Math.sin(C.pitch) * C.dist),
      C.tgt.z + Math.cos(C.yaw) * cp * C.dist,
    );
    cam.lookAt(C.tgt);
    // 機體放在左右面板中間（面板寬度不同時畫面中心偏移）
    const w = innerWidth,
      h = innerHeight;
    const l = document.getElementById('garageLeft'),
      r = document.getElementById('garageRight');
    const off = ((l ? l.offsetWidth : 0) - (r ? r.offsetWidth : 0)) / 2;
    if (Math.abs(off) > 2) cam.setViewOffset(w, h, -off, 0, w, h);
    else cam.clearViewOffset();
  },
  // ---------- 每格 ----------
  hangarTick(dt, t) {
    if (!this.hg) this.hangarEnsure();
    const hg = this.hg;
    const st = { ...POSE, t };
    for (const m of [this.garageMech, hg.swap && hg.swap.old, hg.prev && hg.prev.m])
      if (m) animateMech(m, dt, st);
    tickHangar(hg.H, dt, t);
    HOLO.uniforms.uT.value = t;
    this.hangarHoverTick(dt);
    this.hangarSwapTick(dt);
    if (hg.slot !== this.garageSlot) {
      hg.slot = this.garageSlot;
      this.hangarFocus(hg.slot);
    }
    this.hangarCamera(dt);
  },
  // ---------- 全像預覽：滑鼠停在零件上（手把的焦點）時，疊上換上之後的區塊 ----------
  hangarHoverTick(dt) {
    const hg = this.hg;
    const el =
      document.querySelector('#partList .part.padFocus') || document.querySelector('#partList .part:hover');
    const pid = el && !el.classList.contains('eq') ? el.dataset.pid || null : null;
    const key = pid ? this.garageSlot + ':' + pid : null;
    if (key !== hg.hover) {
      hg.hover = key;
      hg.hoverT = 0;
      this.hangarPreviewClear();
    }
    if (!key || hg.prev || hg.swap || this.hangarFx() === 'off') return;
    hg.hoverT += dt;
    if (hg.hoverT < 0.12) return;
    this.hangarPreviewBuild(this.garageSlot, pid);
  },
  hangarPreviewBuild(slot, pid) {
    const hg = this.hg,
      cur = this.garageMech;
    if (!cur) return;
    const asm = { ...this.save.asm, [slot]: pid };
    let m;
    try {
      m = buildMech(asm, this.myPal(), 1, { source: this.garageSource() });
    } catch {
      hg.prev = { m: null, keep: [] };
      return;
    }
    m.group.rotation.y = Math.PI;
    const add = Object.keys(m.pieces).filter((k) => !cur.pieces[k]);
    const gone = Object.keys(cur.pieces).filter((k) => !m.pieces[k]);
    for (const [k, o] of Object.entries(m.pieces)) o.visible = add.includes(k);
    m.group.traverse((o) => {
      if (!o.isMesh) return;
      if (isOutline(o.material)) o.visible = false;
      else {
        o.material = HOLO;
        o.castShadow = false;
      }
    });
    // 換掉的區塊變淡
    const keep = [];
    for (const k of gone)
      cur.pieces[k].traverse((o) => {
        if (!o.isMesh) return;
        keep.push([o, o.material, o.visible]);
        if (isOutline(o.material)) o.visible = false;
        else {
          const f = (mt) => {
            const c = mt.clone();
            c.transparent = true;
            c.opacity = 0.22;
            c.depthWrite = false;
            return c;
          };
          o.material = Array.isArray(o.material) ? o.material.map(f) : f(o.material);
        }
      });
    for (let i = 0; i < 60; i++) animateMech(m, 1 / 60, { ...POSE, t: performance.now() / 1000 });
    this.garageScene.add(m.group);
    hg.prev = { m, keep };
  },
  hangarPreviewClear() {
    const hg = this.hg;
    if (!hg || !hg.prev) return;
    const P = hg.prev;
    hg.prev = null;
    if (P.m) this.garageScene.remove(P.m.group);
    for (const [o, mt, vis] of P.keep) {
      if (o.material !== mt) {
        for (const c of [].concat(o.material)) c.dispose();
        o.material = mt;
      }
      o.visible = vis;
    }
  },
  // ---------- 換上零件：比較新舊區塊，掃描帶由下往上（下方是新零件、上方是舊零件） ----------
  // renderGarage 建好新的機體之後呼叫（old＝原本的機體，還在場景裡）
  hangarSwapStart(old, cur) {
    const hg = this.hg;
    const os = old.pieces,
      ns = cur.pieces;
    const add = Object.keys(ns).filter((k) => !os[k]);
    const gone = Object.keys(os).filter((k) => !ns[k]);
    if ((!add.length && !gone.length) || this.hangarFx() === 'off') {
      this.garageScene.remove(old.group);
      return;
    }
    for (const [k, o] of Object.entries(os)) if (ns[k]) o.visible = false;
    for (let i = 0; i < 60; i++) animateMech(cur, 1 / 60, { ...POSE, t: performance.now() / 1000 });
    this.garageScene.updateMatrixWorld(true);
    // 完整：只換一類零件時播實體換裝（吊車、機械臂、地板開口），多類（隨機組裝）或簡短時用掃描
    const cats = new Set([...add, ...gone].map(swapCat));
    if (this.hangarFx() === 'full' && cats.size === 1)
      return this.hangarRigStart([...cats][0], old, cur, add, gone);
    const box = new THREE.Box3();
    for (const k of add) box.expandByObject(ns[k]);
    for (const k of gone) box.expandByObject(os[k]);
    const pNew = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0),
      pOld = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const restore = [];
    const clip = (root, pl) =>
      root.traverse((o) => {
        if (!o.isMesh) return;
        restore.push([o, o.material, o.visible]);
        if (isOutline(o.material)) {
          o.visible = false;
          return;
        }
        const f = (mt) => {
          const c = mt.clone();
          c.clippingPlanes = [pl];
          c.clipShadows = true;
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(f) : f(o.material);
      });
    for (const k of add) clip(ns[k], pNew);
    for (const k of gone) clip(os[k], pOld);
    // 掃描帶：平面＋外框
    const sz = box.getSize(new THREE.Vector3()),
      c = box.getCenter(new THREE.Vector3());
    const band = new THREE.Group();
    const pl = new THREE.Mesh(
      new THREE.PlaneGeometry(sz.x + 0.5, sz.z + 0.5),
      glowMat(0x46d8ff, 0.22, { side: THREE.DoubleSide }),
    );
    pl.rotation.x = -Math.PI / 2;
    band.add(pl);
    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(sz.x + 0.5, sz.z + 0.5)),
      new THREE.LineBasicMaterial({ color: 0x9ef0ff, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    keepAlpha(edge.material);
    edge.rotation.x = -Math.PI / 2;
    band.add(edge);
    band.position.set(c.x, box.min.y, c.z);
    this.garageScene.add(band);
    const dur = this.hangarFx() === 'short' ? 0.45 : 0.75;
    hg.swap = { old, t: 0, dur, y0: box.min.y - 0.05, y1: box.max.y + 0.05, pNew, pOld, restore, band };
    SFX.tone(380, 1500, dur, 0.04, 'sine', 'ui');
    this.hangarSwapTick(0);
  },
  // ---------- 實體換裝 ----------
  hangarRigStart(cat, old, cur, add, gone) {
    const hg = this.hg,
      H = hg.H;
    const kind =
      (cat === 'head' || cat.startsWith('back')) && H.cranes.length // 野戰帳篷沒有吊車：改用機械臂
        ? 'crane'
        : cat === 'core' || cat === 'booster'
          ? 'rear'
          : cat === 'legs'
            ? 'lift'
            : 'robot';
    const S = {
      rig: true,
      kind,
      cat,
      old,
      cur,
      t: 0,
      ev: {},
      items: [],
      groups: new Map(),
      hatches: [],
      robots: [],
    };
    const item = (o, isNew) => {
      const b = new THREE.Box3().setFromObject(o);
      const c = b.getCenter(new THREE.Vector3());
      const s = kind === 'robot' ? (c.x < 0 ? -1 : 1) : 0;
      if (!S.groups.has(s)) S.groups.set(s, { s, box: new THREE.Box3() });
      const g = S.groups.get(s);
      g.box.union(b);
      S.items.push({ o, p0: o.position.clone(), isNew, g });
      if (isNew) o.visible = false;
    };
    for (const k of gone) item(old.pieces[k], false);
    for (const k of add) item(cur.pieces[k], true);
    for (const g of S.groups.values()) {
      g.c = g.box.getCenter(new THREE.Vector3());
      g.sz = g.box.getSize(new THREE.Vector3());
      g.D = g.box.max.y + 0.4; // 沉到地板下的深度
      if (kind === 'robot') g.out = new THREE.Vector3(g.s * 1.3, 0.1, 1.6);
    }
    // 地板的開口
    const hatch = (x, z, w, d) => {
      const h = makeHatch(H, x, z, Math.max(1.1, w), Math.max(1.1, d));
      hatchOpen(h, 0);
      S.hatches.push(h);
      return h;
    };
    for (const g of S.groups.values()) {
      if (kind === 'lift') hatch(0, 0.1, 3.0, 3.2);
      if (kind === 'rear') hatch(g.c.x, g.c.z - 2.4, g.sz.x + 0.6, g.sz.z + 0.8);
      if (kind === 'robot') {
        hatch(g.c.x + g.out.x, g.c.z + g.out.z, g.sz.x + 0.6, g.sz.z + 0.6);
        const r = H.robots[g.s < 0 ? 0 : 1];
        r.g.visible = true;
        r.base = hatch(r.home.x, r.home.z, 1.5, 1.5);
        r.rest = r.home.clone().add(new THREE.Vector3(0, 2.6, -0.4));
        S.robots.push({ r, g });
      }
    }
    if (kind === 'crane') {
      const c = H.cranes[0];
      c.busy = true;
      S.crane = { c, x0: c.x, z0: c.z, d0: c.drop };
    }
    if (kind === 'lift') S.dy = old.lift.position.y - cur.lift.position.y;
    // 鏡頭：看得到零件被移走的地方
    const g0 = [...S.groups.values()][0];
    const two = S.groups.size > 1;
    const V = {
      crane: { yaw: 0.5, pitch: 0.16, dist: 8.5, tgt: g0.c.clone().add(new THREE.Vector3(0, 0.6, 0)) },
      rear: { yaw: Math.PI - 0.5, pitch: 0.25, dist: 7.5, tgt: new THREE.Vector3(0, 1.6, -1.2) },
      lift: { yaw: 0.45, pitch: 0.12, dist: 7.6, tgt: new THREE.Vector3(0, 1.3, 0.3) },
      robot: {
        yaw: two ? 0.15 : Math.sign(g0.s) * 0.35,
        pitch: 0.15,
        dist: two ? 8.5 : 7.2,
        tgt: two ? new THREE.Vector3(0, 1.4, 1.0) : new THREE.Vector3(g0.c.x + g0.s * 0.8, 1.3, 0.8),
      },
    }[kind];
    const G = hg.goal;
    let dy = V.yaw - G.yaw;
    dy -= Math.round(dy / (Math.PI * 2)) * Math.PI * 2;
    Object.assign(G, { yaw: G.yaw + dy, pitch: V.pitch, dist: V.dist });
    G.tgt.copy(V.tgt);
    hg.idle = 99;
    hg.swap = S;
    SFX.tone(110, 170, 0.5, 0.035, 'sawtooth', 'ui');
    this.hangarSwapTick(0);
  },
  // 零件離開原位的位移（世界座標）：u＝0 在原位、1 在地板下／天花板
  hangarRigPath(S, g, u) {
    const v = new THREE.Vector3();
    if (S.kind === 'crane') return v.set(0, 3.0 * u, 0);
    if (S.kind === 'lift') return v.set(0, -g.D * u, 0);
    const k1 = Math.min(1, u / 0.45),
      k2 = Math.max(0, (u - 0.45) / 0.55);
    if (S.kind === 'rear') return v.set(0, -g.D * k2, -2.4 * k1);
    return v
      .copy(g.out)
      .multiplyScalar(k1)
      .add(new THREE.Vector3(0, -g.D * k2, 0));
  },
  hangarRigTick(S, dt) {
    const H = this.hg.H;
    S.t += dt;
    const t = S.t;
    const uOld = seg(t, RT.out0, RT.out1),
      uNew = 1 - seg(t, RT.in0, RT.in1);
    S.old.group.updateMatrixWorld(true);
    S.cur.group.updateMatrixWorld(true);
    const at = new THREE.Vector3();
    for (const it of S.items) {
      const u = it.isNew ? uNew : uOld;
      it.o.visible = it.isNew ? t >= RT.in0 : t < RT.out1 + 0.02;
      const J = it.o.parent;
      at.copy(it.p0)
        .applyMatrix4(J.matrixWorld)
        .add(this.hangarRigPath(S, it.g, u));
      it.o.position.copy(J.worldToLocal(at));
    }
    // 移動中的那一組零件（夾具跟著它）
    const phaseU = t < RT.in0 ? uOld : uNew;
    const hold = t >= RT.grab && t < RT.lock + 0.05; // 夾住
    const appr = seg(t, 0.1, RT.grab),
      back = seg(t, RT.back0, RT.end);
    // 整備架的固定臂伸過來扶住機體
    const ck = seg(t, 0, 0.3) * (1 - back);
    for (const [i, c] of H.beds[0].clamps.entries()) c.userData.arm.position.x = (i ? -1 : 1) * 0.28 * ck;
    // 地板的開口
    const hk = seg(t, 0.25, 0.5) * (1 - seg(t, RT.lock, RT.back0 + 0.05));
    for (const h of S.hatches) if (!S.robots.some((R) => R.r.base === h)) hatchOpen(h, hk);
    // 吊車：吊鉤在零件頂上
    if (S.crane) {
      const { c } = S.crane;
      const g = [...S.groups.values()][0];
      const top = g.box.max.y + this.hangarRigPath(S, g, phaseU).y + 0.1;
      const k = appr * (1 - back);
      c.x = S.crane.x0 + (g.c.x - S.crane.x0) * k;
      c.z = S.crane.z0 + (g.c.z - S.crane.z0) * k;
      const dTo = c.railY - 1.5 - top;
      c.drop = Math.max(0.05, S.crane.d0 + (dTo - S.crane.d0) * k);
    }
    // 機械臂：從地板下升起，夾爪到零件，跟著零件進出開口
    for (const R of S.robots) {
      const { r, g } = R;
      const up = seg(t, 0.0, 0.3) * (1 - seg(t, RT.back0 + 0.05, RT.end));
      hatchOpen(r.base, Math.min(1, up * 3));
      r.g.position.y = -3.4 * (1 - up);
      const tgt = g.c.clone().add(this.hangarRigPath(S, g, phaseU));
      const k = appr * (1 - seg(t, RT.lock + 0.05, RT.back0 + 0.1));
      r.grip = hold ? 1 : 0;
      robotReach(r, r.rest.clone().lerp(tgt, k));
    }
    // 腳部：新的腳升上來之前，上半身維持在舊的高度
    if (S.dy) S.cur.group.position.y = S.dy * (t < RT.in0 ? 1 : uNew);
    // 夾住與鎖上的火花、蒸氣、聲音
    const once = (k, tt, fn) => {
      if (!S.ev[k] && t >= tt) {
        S.ev[k] = 1;
        fn();
      }
    };
    const burst = (big) => {
      for (const g of S.groups.values()) {
        const p = g.c.clone();
        emitSparks(H.sparks, p, new THREE.Vector3(0, 0.6, 1), big ? 26 : 14);
        if (big) puff(H, new THREE.Vector3(p.x, Math.max(0.3, g.box.min.y + 0.3), p.z + 0.2), 5, 0.45);
      }
      SFX.noise(big ? 0.22 : 0.12, big ? 500 : 900, big ? 0.09 : 0.06, 'bandpass', 'ui', 3);
    };
    once('grab', RT.grab, () => S.items.some((i) => !i.isNew) && burst(false));
    once('out', RT.out0, () => SFX.tone(140, 220, 0.5, 0.03, 'sawtooth', 'ui'));
    once('in', RT.in0, () => SFX.tone(220, 140, 0.55, 0.03, 'sawtooth', 'ui'));
    once('lock', RT.lock, () => burst(true));
    if (t >= RT.end) this.hangarFinish();
  },
  hangarSwapTick(dt) {
    const S = this.hg.swap;
    if (!S) return;
    if (S.rig) return this.hangarRigTick(S, dt);
    S.t += dt;
    const k = Math.min(1, S.t / S.dur);
    const e = k * k * (3 - 2 * k);
    const y = S.y0 + (S.y1 - S.y0) * e;
    S.pNew.constant = y;
    S.pOld.constant = -y;
    S.band.position.y = y;
    S.band.children[0].material.opacity = 0.22 * (1 - k * 0.6);
    if (k >= 1) this.hangarFinish();
  },
  // 換裝立刻結束（又換了零件、離開機甲庫）
  hangarFinish() {
    const hg = this.hg;
    if (!hg || !hg.swap) return;
    const S = hg.swap;
    hg.swap = null;
    if (S.rig) {
      const H = hg.H;
      for (const it of S.items) {
        it.o.position.copy(it.p0);
        if (it.isNew) it.o.visible = true;
      }
      S.cur.group.position.y = 0;
      this.garageScene.remove(S.old.group);
      for (const h of S.hatches) removeHatch(H, h);
      for (const R of S.robots) {
        R.r.g.visible = false;
        R.r.g.position.y = -3.4;
      }
      if (S.crane) {
        S.crane.c.busy = false;
        S.crane.c.wait = 1.5;
      }
      for (const c of H.beds[0].clamps) c.userData.arm.position.x = 0;
      this.hangarFocus(this.garageSlot);
      return;
    }
    for (const [o, mt, vis] of S.restore) {
      if (o.material !== mt) for (const c of [].concat(o.material)) c.dispose();
      o.material = mt;
      o.visible = vis;
    }
    this.garageScene.remove(S.old.group);
    this.garageScene.remove(S.band);
    S.band.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    SFX.noise(0.12, 900, 0.05, 'bandpass', 'ui', 2);
  },
});
