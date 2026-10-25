// Game：機甲庫的格納庫演出（docs/garage-hangar.md）：場景依場合、整備架上的機體、繞看的鏡頭與依部位的鏡頭位置、
// 瀏覽零件時的全像預覽、換上零件時的掃描換裝
import { SFX } from '../audio/audio.js';
import { buildHangar, disposeHangar, glowMat, keepAlpha, tickHangar } from '../render/hangar.js';
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
  hangarSwapTick(dt) {
    const S = this.hg.swap;
    if (!S) return;
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
