// Coral 戰爭（RTS）的鏡頭與輸入（mixin）：注視點＋固定俯角的鏡頭（滾輪縮放、中鍵／Alt 拖曳旋轉、Home 重設、
// 邊緣捲動與方向鍵、貼著地形高度）、點選／框選／Shift 加減選／雙擊或 Ctrl 點選同種／Tab 子群組、右鍵智慧指令與指令標記、
// Ctrl＋數字編隊、指令卡快捷鍵（依格子位置 Q W E R／A S D F／Z X C V）、目標模式（攻擊移動、巡邏…）、建造預覽與放置。
// 狀態放在 this.rts.cam（鏡頭）與 this.rts.ui（輸入與介面）；選取是 this.rts.sel、編隊 this.rts.groups（docs/rts-design.md 12 節）。
// 核心的 rtsTick 每格呼叫 rtsCamUpdate(dt)（鏡頭、3D 標示、HUD 都在這裡更新）。
// R3 艾瑟立克（docs 14.15）：建造預覽多看 rtsPowerWhy（導管範圍；原因顯示在模式提示）；導管的範圍圈 rtsHudRings
// （建造要電／供電的建築、選取己方的導管建築時，貼著地形畫己方全部的供電範圍：有電青色、沒電灰色、選中的較亮；
// 導管重算（rtsHudPower）或選取改變時才重建網格）；預覽的建築是供電源時另外畫它自己的範圍與連接距離。
import { Game } from './game.js';
import { clamp } from '../core/math.js';
import { RTS_DEFS, RTS_SEL_MAX } from '../data/rts-units.js';

const RTS_ME = 0; // 玩家的隊伍編號（rts.teams[0]）
const PITCH0 = 0.96; // 預設俯角（約 55°）
const DIST0 = 95;
const DIST_MIN = 30,
  DIST_MAX = 260;
const EDGE_PX = 6; // 畫面邊緣捲動的寬度
const SEL_MAX = RTS_SEL_MAX;
const DBL_T = 0.35; // 雙擊、連按兩下編隊的間隔（秒）
const COL = { own: 0x4cff7a, foe: 0xff4a3a, neu: 0xffd23a, sig: 0x5cf0ff };
const POW = { on: [0.36, 0.85, 1], off: [0.5, 0.55, 0.6], sel: [0.8, 0.97, 1] }; // 範圍圈的顏色
const RING_SEG = 72; // 範圍圈的邊緣段數
const RING_LIFT = 0.35; // 離地高度

let ringGeo = null;
const ringMats = {};
const ringMat = (c) =>
  ringMats[c] ||
  (ringMats[c] = new THREE.MeshBasicMaterial({
    color: c,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  }));

Object.assign(Game.prototype, {
  // ---------- 初始化（第一次進 RTS 時綁定事件；所有處理都先看 rtsActive） ----------
  rtsActive() {
    return !!(this.rts && this.state === 'rts' && this.world && !this.rts.over);
  },
  rtsInputInit() {
    const R = this.rts;
    if (!R) return;
    if (!R.cam) R.cam = { x: 0, z: 0, gy: null, yaw: 0, pitch: PITCH0, dist: DIST0 };
    if (!R.sel) R.sel = [];
    if (!R.groups) R.groups = {};
    if (!R.ui)
      R.ui = {
        mode: null, // { k: 'target', order, label } 或 { k: 'build', def }
        menu: null, // 指令卡的子選單（'build'＝工人的建造清單）
        sub: 0, // Tab 子群組（第幾種）
        focus: null, // 選中的非單位物件（礦脈、Coral）
        drag: null, // 框選 { x0, y0, x1, y1 }
        rot: null, // 旋轉鏡頭 { x, y }
        mx: -1,
        my: -1,
        mouseIn: false,
        lastClick: { t: -9, id: null },
        lastGroup: { n: -1, t: -9 },
        events: [], // { x, z, t, txt }（空白鍵跳過去）
        marks: [], // 右鍵的指令標記
        rings: [], // 選取圈的網格池
        ghost: null, // 建造預覽
      };
    if (R.cam.gy === null) {
      // 開局：鏡頭對準自己的主堡
      const base = (R.units || []).find((e) => e.rtsTeam === RTS_ME && e.bld && !e.dead);
      if (base) this.rtsCamJump(base.pos.x, base.pos.z);
      else if (this.world.rts && this.world.rts.bases) {
        const b = this.world.rts.bases.find((q) => q.owner === RTS_ME) || this.world.rts.bases[0];
        if (b) this.rtsCamJump(b.pos.x, b.pos.z);
      }
      R.cam.gy = this.world.terrainHeight(R.cam.x, R.cam.z);
    }
    if (this._rtsBound) return;
    this._rtsBound = true;
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => this.rtsActive() && this.rtsPtrDown(e));
    addEventListener('pointermove', (e) => this.rts && this.rts.ui && this.rtsPtrMove(e));
    addEventListener('pointerup', (e) => this.rtsActive() && this.rtsPtrUp(e));
    addEventListener(
      'pointercancel',
      () => this.rts && this.rts.ui && ((this.rts.ui.drag = null), (this.rts.ui.rot = null)),
    );
    cv.addEventListener('wheel', (e) => this.rtsActive() && this.rtsWheel(e), { passive: false });
    document.addEventListener('mouseleave', () => this.rts && this.rts.ui && (this.rts.ui.mouseIn = false));
    addEventListener('blur', () => this.rts && this.rts.ui && (this.rts.ui.mouseIn = false));
    // 捕獲階段：先於 input.js 的全域處理（Esc 不要變成一般任務的暫停、Tab 不要換焦點）
    addEventListener('keydown', (e) => this.rtsActive() && this.rtsKey(e), true);
    if (this.rtsHudInit) this.rtsHudInit();
  },

  // ---------- 鏡頭 ----------
  rtsCamUpdate(dt) {
    const R = this.rts;
    if (!R || !this.world) return;
    if (!R.ui) this.rtsInputInit();
    const C = R.cam,
      ui = R.ui,
      k = this.keys || {};
    const typing = this.edTyping && this.edTyping();
    if (this.state === 'rts' && !typing) {
      // 方向鍵與畫面邊緣捲動（速度依鏡頭距離）
      let mx = 0,
        mz = 0;
      if (k.ArrowUp) mz += 1;
      if (k.ArrowDown) mz -= 1;
      if (k.ArrowLeft) mx -= 1;
      if (k.ArrowRight) mx += 1;
      if (ui.mouseIn && !ui.drag && !ui.rot && document.hasFocus()) {
        if (ui.mx <= EDGE_PX) mx -= 1;
        if (ui.mx >= innerWidth - 1 - EDGE_PX) mx += 1;
        if (ui.my <= EDGE_PX) mz += 1;
        if (ui.my >= innerHeight - 1 - EDGE_PX) mz -= 1;
      }
      if (mx || mz) {
        const sp = dt * (C.dist * 1.15 + 20);
        const fx = -Math.sin(C.yaw),
          fz = -Math.cos(C.yaw);
        const rx = Math.cos(C.yaw),
          rz = -Math.sin(C.yaw);
        C.x += (fx * mz + rx * mx) * sp;
        C.z += (fz * mz + rz * mx) * sp;
      }
    }
    const lim = this.world.size / 2 - 16;
    C.x = clamp(C.x, -lim, lim);
    C.z = clamp(C.z, -lim, lim);
    // 跟著地形高度（平滑，避免經過坡地時鏡頭抖動）
    const gy = this.world.terrainHeight(C.x, C.z);
    C.gy = C.gy === null ? gy : C.gy + (gy - C.gy) * Math.min(1, dt * 5);
    this.rtsCamApply();
    this.rtsMarksTick(dt);
    if (this.rtsHudTick) this.rtsHudTick(dt);
  },
  rtsCamApply() {
    const C = this.rts.cam,
      cam = this.camera;
    if (cam.view && cam.view.enabled) cam.clearViewOffset();
    const cp = Math.cos(C.pitch);
    cam.position.set(
      C.x + Math.sin(C.yaw) * cp * C.dist,
      C.gy + Math.sin(C.pitch) * C.dist,
      C.z + Math.cos(C.yaw) * cp * C.dist,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(C.x, C.gy, C.z);
    // 遠處的地面：視野上緣的射線到地面約 2 倍距離；400 m 的地圖拉遠時也不能被霧蓋住
    const far = Math.max(1200, C.dist * 6);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    this.camExtra = C.dist * 1.7 + 140; // render-setup.js 的 fogPush：霧往外推
    const focus = (this._rtsFocus = this._rtsFocus || new THREE.Vector3());
    focus.set(C.x, C.gy, C.z);
    if (this.camTarget) this.camTarget.copy(focus);
    if (this.sun) {
      this.sun.position.copy(focus).add(this.sunOff);
      this.sun.target.position.copy(focus);
      const sc = this.sun.shadow.camera;
      const Rr = clamp(C.dist * 0.9, 70, 160); // 陰影範圍（太大時陰影貼圖的格子太粗）
      if (sc.right !== Rr) {
        sc.left = sc.bottom = -Rr;
        sc.right = sc.top = Rr;
        sc.updateProjectionMatrix();
      }
    }
  },
  rtsCamJump(x, z) {
    const R = this.rts;
    if (!R || !this.world) return;
    if (!R.cam) R.cam = { x: 0, z: 0, gy: null, yaw: 0, pitch: PITCH0, dist: DIST0 };
    const lim = this.world.size / 2 - 16;
    R.cam.x = clamp(x, -lim, lim);
    R.cam.z = clamp(z, -lim, lim);
    R.cam.gy = this.world.terrainHeight(R.cam.x, R.cam.z);
  },
  rtsCamReset() {
    const C = this.rts.cam;
    C.yaw = 0;
    C.pitch = PITCH0;
    C.dist = DIST0;
  },
  rtsWheel(e) {
    e.preventDefault();
    const C = this.rts.cam;
    C.dist = clamp(C.dist * (e.deltaY > 0 ? 1.12 : 0.89), DIST_MIN, DIST_MAX);
  },

  // ---------- 射線與點選 ----------
  // 螢幕座標 → 地面（沿射線步進地形高度再二分，不對大網格做射線檢查）
  rtsGroundAt(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    const v = (this._rtsV2 = this._rtsV2 || new THREE.Vector2());
    v.set(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1);
    const ray = (this._rtsRay = this._rtsRay || new THREE.Raycaster());
    ray.setFromCamera(v, this.camera);
    const o = ray.ray.origin,
      d = ray.ray.direction;
    const w = this.world;
    const S = w.size / 2 + 40;
    const th = (x, z) => (Math.abs(x) <= S && Math.abs(z) <= S ? w.terrainHeight(x, z) : 0);
    let t0 = 0,
      step = 2,
      maxT = this.camera.far;
    for (let t = step; t < maxT; t += step) {
      const x = o.x + d.x * t,
        z = o.z + d.z * t,
        y = o.y + d.y * t;
      if (y <= th(x, z)) {
        let a = t0,
          b = t;
        for (let i = 0; i < 12; i++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m,
            mz = o.z + d.z * m;
          if (o.y + d.y * m <= th(mx, mz)) b = m;
          else a = m;
        }
        const x1 = o.x + d.x * b,
          z1 = o.z + d.z * b;
        return { x: x1, y: th(x1, z1), z: z1 };
      }
      t0 = t;
      if (t > 60) step = 3;
    }
    // 打不到：和 y＝0 平面求交
    if (Math.abs(d.y) < 1e-4) return null;
    const t = -o.y / d.y;
    if (t < 0) return null;
    return { x: o.x + d.x * t, y: 0, z: o.z + d.z * t };
  },
  // 玩家看得到的實體（自己的一律看得到；別人的要在可見的格子裡、模型有顯示）
  rtsSeen(e) {
    if (!e || e.dead) return false;
    if (e.rtsTeam === RTS_ME) return true;
    if (e.group && e.group.visible === false) return false;
    if (typeof this.rtsVisible === 'function') return this.rtsVisible(RTS_ME, e); // 戰爭迷霧（rts-fog.js）
    return true;
  },
  rtsOwn(e) {
    return !!e && e.rtsTeam === RTS_ME && !e.dead;
  },
  // 實體在地面上的半徑（選取圈、點選）
  rtsRadius(e) {
    if (e.bld) {
      const D = this.rtsUiDef(e);
      if (D && D.foot) return Math.max(D.foot[0], D.foot[1]) * 0.6;
      return Math.max(3, e.radius || 3);
    }
    return Math.max(0.8, e.radius || 1.3);
  },
  // 畫面上每公尺幾個像素（在 p 的深度）
  rtsPxPerM(p) {
    const cam = this.camera;
    const d = Math.max(1, cam.position.distanceTo(p));
    return innerHeight / 2 / (Math.tan((cam.fov * Math.PI) / 360) * d);
  },
  rtsScreen(e, out) {
    const v = (this._rtsP = this._rtsP || new THREE.Vector3());
    v.set(e.pos.x, e.pos.y + (e.bld ? 1.5 : (e.height || 3) * 0.45), e.pos.z);
    const p = v.project(this.camera);
    out.x = ((p.x + 1) / 2) * innerWidth;
    out.y = ((-p.y + 1) / 2) * innerHeight;
    out.in = p.z < 1 && p.z > -1;
    return out;
  },
  // 點到的東西：實體（單位優先於建築）或礦脈／Coral 湧出點
  rtsPickAt(sx, sy) {
    const R = this.rts;
    let best = null,
      bd = 1e9;
    const s = {};
    for (const e of R.units || []) {
      if (!this.rtsSeen(e)) continue;
      this.rtsScreen(e, s);
      if (!s.in) continue;
      const rpx = Math.max(e.bld ? 16 : 11, this.rtsRadius(e) * this.rtsPxPerM(e.pos) * (e.bld ? 0.85 : 1.1));
      const d = Math.hypot(s.x - sx, s.y - sy) / rpx;
      const score = d + (e.bld ? 0.35 : 0); // 單位疊在建築前面時選單位
      if (d <= 1 && score < bd) {
        bd = score;
        best = e;
      }
    }
    if (best) return best;
    for (const m of [...(R.mines || []), ...(R.corals || [])]) {
      if (!m || !m.pos || (m.amount !== undefined && m.amount <= 0 && !m.ext)) continue;
      if (typeof this.rtsFogState === 'function' && !this.rtsFogState(RTS_ME, m.pos.x, m.pos.z)) continue;
      const v = new THREE.Vector3(
        m.pos.x,
        (m.pos.y || this.world.terrainHeight(m.pos.x, m.pos.z)) + 1.5,
        m.pos.z,
      );
      const p = v.clone().project(this.camera);
      if (!(p.z < 1 && p.z > -1)) continue;
      const x = ((p.x + 1) / 2) * innerWidth,
        y = ((-p.y + 1) / 2) * innerHeight;
      const rpx = Math.max(16, 4.5 * this.rtsPxPerM(v));
      const d = Math.hypot(x - sx, y - sy) / rpx;
      if (d <= 1 && d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  },
  rtsIsEnt(o) {
    return !!(o && o.pos && (o.rtsDef !== undefined || o.hp !== undefined) && o.maxHp !== undefined);
  },

  // ---------- 選取 ----------
  rtsSetSel(list, add) {
    const R = this.rts;
    let s = add ? R.sel.slice() : [];
    for (const e of list) if (!s.includes(e)) s.push(e);
    s = s.filter((e) => e && !e.dead);
    // 自己的與別人的不混選；自己的有單位時不選建築
    if (s.some((e) => this.rtsOwn(e))) {
      s = s.filter((e) => this.rtsOwn(e));
      if (s.some((e) => !e.bld) && s.some((e) => e.bld) && list.some((e) => !e.bld))
        s = s.filter((e) => !e.bld);
    } else s = s.slice(0, 1);
    R.sel = s.slice(0, SEL_MAX);
    R.ui.focus = null;
    R.ui.sub = 0;
    R.ui.menu = null;
    this.rtsHudDirty = true;
  },
  rtsToggleSel(e) {
    const R = this.rts;
    if (!this.rtsOwn(e)) return this.rtsSetSel([e]);
    const i = R.sel.indexOf(e);
    if (i >= 0) {
      R.sel.splice(i, 1);
      R.ui.sub = 0;
      this.rtsHudDirty = true;
    } else this.rtsSetSel([e], true);
  },
  // 畫面內同種的自己單位
  rtsSameType(e) {
    const s = {};
    return (this.rts.units || []).filter((u) => {
      if (!this.rtsOwn(u) || u.rtsDef !== e.rtsDef) return false;
      this.rtsScreen(u, s);
      return s.in && s.x >= 0 && s.y >= 0 && s.x <= innerWidth && s.y <= innerHeight;
    });
  },
  rtsBoxSelect(x0, y0, x1, y1, add) {
    const a = Math.min(x0, x1),
      b = Math.max(x0, x1),
      c = Math.min(y0, y1),
      d = Math.max(y0, y1);
    const s = {};
    const inBox = (e) => {
      this.rtsScreen(e, s);
      return s.in && s.x >= a && s.x <= b && s.y >= c && s.y <= d;
    };
    const own = (this.rts.units || []).filter((e) => this.rtsOwn(e) && inBox(e));
    let pick = own.filter((e) => !e.bld);
    if (!pick.length) pick = own;
    if (!pick.length) {
      if (!add) {
        // 框到的只有別人的：選一個（魔獸3 一樣）
        const other = (this.rts.units || []).find((e) => !this.rtsOwn(e) && this.rtsSeen(e) && inBox(e));
        if (other) this.rtsSetSel([other]);
      }
      return;
    }
    // 依距離框選中心排序，超過上限時留近的
    const cx = (a + b) / 2,
      cy = (c + d) / 2;
    pick.sort((p, q) => {
      this.rtsScreen(p, s);
      const dp = Math.hypot(s.x - cx, s.y - cy);
      this.rtsScreen(q, s);
      return dp - Math.hypot(s.x - cx, s.y - cy);
    });
    this.rtsSetSel(pick, add);
  },
  // 子群組：依種類分組（順序：英雄、單位、建築）；ui.sub 是目前作用中的那一組
  rtsSubgroups() {
    const map = new Map();
    for (const e of this.rts.sel) {
      if (e.dead) continue;
      const k = e.rtsDef || e.name;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(e);
    }
    const arr = [...map.values()];
    const rank = (g) => (g[0].hero ? 0 : g[0].bld ? 2 : 1);
    arr.sort((a, b) => rank(a) - rank(b));
    return arr;
  },
  rtsActiveGroup() {
    const gs = this.rtsSubgroups();
    if (!gs.length) return [];
    return gs[this.rts.ui.sub % gs.length];
  },
  // 下指令的對象：自己的、還活著的選取
  rtsCommandUnits() {
    return this.rts.sel.filter((e) => this.rtsOwn(e));
  },

  // ---------- 指標 ----------
  rtsPtrDown(e) {
    const ui = this.rts.ui;
    if (this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    ui.mx = e.clientX;
    ui.my = e.clientY;
    ui.mouseIn = true;
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      e.preventDefault();
      ui.rot = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2) {
      if (ui.mode) return this.rtsCancelMode();
      const gp = this.rtsGroundAt(e.clientX, e.clientY);
      const hit = this.rtsPickAt(e.clientX, e.clientY);
      if (gp || hit) this.rtsRightAt(gp ? gp.x : hit.pos.x, gp ? gp.z : hit.pos.z, hit, e.shiftKey);
      return;
    }
    if (e.button !== 0) return;
    if (ui.mode) {
      // 城牆：Shift＋拖曳蓋一排（放開時沿拖曳方向排開）
      if (ui.mode.k === 'build' && ui.mode.D && ui.mode.D.wall && e.shiftKey) {
        this.rtsGhostUpdate();
        const G = ui.ghost;
        if (G && G.g.visible) {
          ui.wallDrag = { x0: G.x, z0: G.z };
          return;
        }
      }
      const gp = this.rtsGroundAt(e.clientX, e.clientY);
      const hit = this.rtsPickAt(e.clientX, e.clientY);
      if (gp || hit) this.rtsModeAt(gp ? gp.x : hit.pos.x, gp ? gp.z : hit.pos.z, hit, e.shiftKey);
      return;
    }
    ui.drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false };
  },
  rtsPtrMove(e) {
    const ui = this.rts.ui;
    ui.mx = e.clientX;
    ui.my = e.clientY;
    ui.mouseIn = true;
    if (ui.rot) {
      const C = this.rts.cam;
      C.yaw -= (e.clientX - ui.rot.x) * 0.006;
      C.pitch = clamp(C.pitch + (e.clientY - ui.rot.y) * 0.003, 0.7, 1.35);
      ui.rot.x = e.clientX;
      ui.rot.y = e.clientY;
    }
    if (ui.drag) {
      ui.drag.x1 = e.clientX;
      ui.drag.y1 = e.clientY;
      if (Math.hypot(ui.drag.x1 - ui.drag.x0, ui.drag.y1 - ui.drag.y0) > 6) ui.drag.moved = true;
    }
  },
  rtsPtrUp(e) {
    const ui = this.rts.ui;
    if (ui.rot && (e.button === 1 || e.button === 0)) ui.rot = null;
    if (ui.wallDrag && e.button === 0) {
      const w = ui.wallDrag;
      ui.wallDrag = null;
      return this.rtsWallRow(w.x0, w.z0);
    }
    const d = ui.drag;
    if (!d || e.button !== 0) return;
    ui.drag = null;
    if (d.moved) return this.rtsBoxSelect(d.x0, d.y0, d.x1, d.y1, e.shiftKey);
    this.rtsClickAt(e.clientX, e.clientY, e.shiftKey, e.ctrlKey || e.metaKey);
  },
  rtsClickAt(sx, sy, shift, ctrl) {
    const R = this.rts,
      ui = R.ui;
    const hit = this.rtsPickAt(sx, sy);
    const now = R.t !== undefined ? R.t : performance.now() / 1000;
    const tNow = performance.now() / 1000;
    if (!hit) {
      if (!shift) this.rtsSetSel([]);
      return;
    }
    if (!this.rtsIsEnt(hit)) {
      // 礦脈、Coral 湧出點：只顯示資訊
      R.sel = [];
      ui.focus = hit;
      this.rtsHudDirty = true;
      return;
    }
    const dbl = ui.lastClick.id === hit.id && tNow - ui.lastClick.t < DBL_T;
    ui.lastClick = { t: tNow, id: hit.id };
    if ((dbl || ctrl) && this.rtsOwn(hit)) return this.rtsSetSel(this.rtsSameType(hit), shift);
    if (shift && this.rtsOwn(hit)) return this.rtsToggleSel(hit);
    void now;
    this.rtsSetSel([hit]);
  },
  // 右鍵＝智慧指令（地面移動、敵人攻擊、礦脈採集、己方建築修理、建築設集結點）
  rtsRightAt(x, z, hit, shift) {
    const units = this.rtsCommandUnits();
    if (!units.length) return;
    const tgt = hit || null;
    const kind = this.rtsSmartKind(units, tgt);
    if (typeof this.rtsSmart === 'function') this.rtsSmart(units, x, z, tgt, shift);
    else if (typeof this.rtsOrder === 'function') this.rtsOrder(units, { k: 'move', x, z }, shift);
    this.rtsMark(tgt && tgt.pos ? tgt.pos.x : x, tgt && tgt.pos ? tgt.pos.z : z, kind);
  },
  // 標記的顏色：攻擊＝紅、採集／修理＝黃、其他＝綠
  rtsSmartKind(units, tgt) {
    if (!tgt) return 'move';
    if (this.rtsIsEnt(tgt)) {
      if (this.isHostile && units[0] && this.isHostile(units[0], tgt)) return 'attack';
      if (tgt.rtsTeam !== undefined && tgt.rtsTeam !== RTS_ME) return 'attack';
      if (tgt.bld && tgt.hp < tgt.maxHp) return 'gather';
      return 'move';
    }
    return 'gather';
  },

  // ---------- 模式（目標、建造） ----------
  rtsSetMode(m) {
    const ui = this.rts.ui;
    ui.mode = m;
    if (!m || m.k !== 'build') this.rtsGhostHide();
    this.rtsHudDirty = true;
  },
  rtsCancelMode() {
    const ui = this.rts.ui;
    if (ui.mode) {
      this.rtsSetMode(null);
      return true;
    }
    if (ui.menu) {
      ui.menu = null;
      this.rtsHudDirty = true;
      return true;
    }
    return false;
  },
  rtsModeAt(x, z, hit, shift) {
    const ui = this.rts.ui,
      m = ui.mode;
    const units = this.rtsActiveGroup().filter((e) => this.rtsOwn(e));
    if (m.k === 'build') return this.rtsBuildAt(shift);
    if (!units.length) return this.rtsSetMode(null);
    const ent = this.rtsIsEnt(hit) ? hit : null;
    let order = null,
      mk = 'move';
    switch (m.order) {
      case 'amove':
        if (ent && !this.rtsOwn(ent)) ((order = { k: 'attack', id: ent.id }), (mk = 'attack'));
        else ((order = { k: 'amove', x, z }), (mk = 'attack'));
        break;
      case 'attack':
        order = ent ? { k: 'attack', id: ent.id } : { k: 'amove', x, z };
        mk = 'attack';
        break;
      case 'patrol': {
        let cx = 0,
          cz = 0;
        for (const u of units) ((cx += u.pos.x), (cz += u.pos.z));
        order = { k: 'patrol', x, z, x0: cx / units.length, z0: cz / units.length };
        break;
      }
      case 'gather':
        if (hit && !ent) ((order = { k: 'gather', mine: hit.id }), (mk = 'gather'));
        else if (ent && this.rtsOwn(ent) && (this.rtsUiDef(ent) || {}).on === 'coral')
          ((order = { k: 'gather', mine: ent.id }), (mk = 'gather'));
        break;
      case 'repair':
        if (ent && this.rtsOwn(ent) && ent.bld) ((order = { k: 'repair', id: ent.id }), (mk = 'gather'));
        break;
      case 'ability': {
        // 技能：地點或單位（英雄的技能由 C 包、一般單位的由 B 包執行）
        if (m.target === 'unit' && !ent) {
          this.rtsMsg('要點一個單位', 0xff8a8a, 1);
          return;
        }
        order = { k: 'ability', ab: m.ab, x, z };
        if (ent) order.id = ent.id;
        mk = ent && !this.rtsOwn(ent) ? 'attack' : 'gather';
        break;
      }
      case 'item': {
        // 英雄的道具（C 包的 rtsItemUse）
        const h = m.hero;
        if (!h || h.dead) return this.rtsSetMode(null);
        if (m.target === 'unit' && !ent) {
          this.rtsMsg('要點一個單位', 0xff8a8a, 1);
          return;
        }
        if (typeof this.rtsItemUse === 'function')
          this.rtsItemUse(h, m.slot, { x, z, id: ent ? ent.id : undefined });
        this.rtsMark(x, z, 'gather');
        this.rtsHudDirty = true;
        if (!shift) this.rtsSetMode(null);
        return;
      }
      case 'rally':
        // 集結點：交給智慧指令（只有建築時＝設集結點，點礦脈＝工人自動採集）
        if (typeof this.rtsSmart === 'function')
          this.rtsSmart(
            units.filter((b) => b.bld),
            x,
            z,
            hit,
          );
        else
          for (const b of units) if (b.bld) b.bld.rally = ent && ent !== b ? { x, z, id: ent.id } : { x, z };
        this.rtsMark(x, z, 'move');
        if (!shift) this.rtsSetMode(null);
        return;
      default:
        order = { k: 'move', x, z };
    }
    if (!order) {
      this.flashMsg(m.order === 'gather' ? '要點礦脈或抽取站' : '目標不對', 0xff8a8a, 1);
      return;
    }
    if (typeof this.rtsOrder === 'function') this.rtsOrder(units, order, shift);
    this.rtsMark(ent ? ent.pos.x : x, ent ? ent.pos.z : z, mk);
    if (!shift) this.rtsSetMode(null);
  },

  // ---------- 建造預覽 ----------
  // 建築的佔地（公尺）：定義的 fp／size（[w, d] 或邊長）
  rtsFootprint(D) {
    return D && D.foot ? [D.foot[0], D.foot[1]] : [8, 8];
  },
  rtsGhostUpdate() {
    const R = this.rts,
      ui = R.ui,
      m = ui.mode;
    if (!m || m.k !== 'build') return this.rtsGhostHide();
    const D = m.D;
    const [w, d] = this.rtsFootprint(D);
    const gp = this.rtsGroundAt(ui.mx, ui.my);
    if (!gp) return this.rtsGhostHide();
    // 對齊導航格（cell），邊緣落在格線上
    const nav = this.world.nav;
    const cell = (nav && nav.cell) || 2,
      S = this.world.size / 2;
    const snap = (v, s) => Math.round((v - s / 2 + S) / cell) * cell - S + s / 2;
    let x = snap(gp.x, w),
      z = snap(gp.z, d);
    let ok, why;
    if (D.on === 'coral') {
      // 抽取站：吸附到最近的 Coral 湧出點（已經有抽取站的不行）
      let best = null,
        bd = 14;
      for (const c of R.corals || []) {
        const dd = Math.hypot(c.pos.x - gp.x, c.pos.z - gp.z);
        if (dd < bd) ((bd = dd), (best = c));
      }
      ok = !!(best && !best.ext);
      why = ok ? '' : best ? '這個湧出點已經有抽取站' : '要蓋在 Coral 湧出點上';
      if (best) ((x = best.pos.x), (z = best.pos.z));
    } else {
      ok = nav ? nav.buildable(x, z, w, d) : true;
      why = ok ? '' : '這裡不能建造';
    }
    // 導管（艾瑟立克：要電的建築在有電的範圍內、節點在有電的導管 32 m 內）
    if (ok && typeof this.rtsPowerWhy === 'function') {
      const pw = this.rtsPowerWhy(RTS_ME, m.def, x, z);
      if (pw) ((ok = false), (why = pw));
    }
    // 沒探索過的地方不能蓋（照魔獸3）
    if (ok && typeof this.rtsFogState === 'function' && this.rtsFogState(RTS_ME, x, z) === 0) {
      ok = false;
      why = '不能蓋在沒探索過的地方';
    }
    if (ok && typeof this.rtsAfford === 'function' && D.cost && !this.rtsAfford(RTS_ME, D.cost)) {
      ok = false;
      why = this.rtsCostWhy(D.cost);
    }
    // 單位擋住：仍可放（工人到了會等），只在建築格判斷
    if (!ui.ghost) {
      const g = new THREE.Group();
      g.userData.helper = true;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      box.position.y = 0.5;
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
        new THREE.LineBasicMaterial({ color: 0x40ff70, transparent: true, opacity: 0.9 }),
      );
      edge.position.y = 0.5;
      g.add(box, edge);
      g.renderOrder = 5;
      ui.ghost = { g, box, edge };
      this.scene.add(g);
    }
    const G = ui.ghost;
    const h = (D && D.height) || Math.max(3, Math.min(w, d) * 0.6);
    G.g.visible = true;
    G.g.scale.set(w, h, d);
    G.g.position.set(x, nav ? this.rtsFootY(x, z, w, d) : gp.y, z);
    const c = ok ? 0x40ff70 : 0xff4040;
    G.box.material.color.setHex(c);
    G.edge.material.color.setHex(c);
    G.x = x;
    G.z = z;
    G.ok = ok;
    G.why = why;
    this.rtsHudGhostRing(D, x, z, ok);
  },
  rtsFootY(x, z, w, d) {
    const th = (a, b) => this.world.terrainHeight(a, b);
    return Math.min(
      th(x, z),
      th(x - w / 2, z - d / 2),
      th(x + w / 2, z - d / 2),
      th(x - w / 2, z + d / 2),
      th(x + w / 2, z + d / 2),
    );
  },
  rtsGhostHide() {
    const g = this.rts && this.rts.ui && this.rts.ui.ghost;
    if (g) g.g.visible = false;
    const gr = this.rts && this.rts.ui && this.rts.ui.gRing;
    if (gr) gr.visible = false;
  },
  rtsCostWhy(cost) {
    const T = this.rts.teams[RTS_ME];
    if (cost.ore && T.ore < cost.ore) return '礦石不足';
    if (cost.coral && T.coral < cost.coral) return 'Coral 不足';
    if (cost.pop && T.cap !== undefined && T.pop + cost.pop > T.cap) return '人口不足';
    return '資源不足';
  },
  rtsBuildAt(shift) {
    const ui = this.rts.ui,
      m = ui.mode,
      G = ui.ghost;
    this.rtsGhostUpdate();
    if (!G || !G.g.visible) return;
    if (!G.ok) {
      this.flashMsg(G.why || '這裡不能建造', 0xff8a8a, 1.2);
      return;
    }
    // 派最近的一個工人（Shift 排隊時沿用上一次的工人）
    const ws = this.rtsActiveGroup().filter((e) => this.rtsOwn(e) && !e.bld);
    if (!ws.length) return this.rtsSetMode(null);
    let w = shift && m.worker && ws.includes(m.worker) ? m.worker : null;
    if (!w) {
      let bd = 1e9;
      for (const u of ws) {
        const dd = Math.hypot(u.pos.x - G.x, u.pos.z - G.z);
        if (dd < bd) ((bd = dd), (w = u));
      }
    }
    m.worker = w;
    if (typeof this.rtsOrder === 'function')
      this.rtsOrder([w], { k: 'build', def: m.def, x: G.x, z: G.z, yaw: 0 }, shift);
    this.rtsMark(G.x, G.z, 'gather');
    if (!shift) this.rtsSetMode(null);
  },

  // 城牆一排：從 (x0, z0) 到目前的預覽位置，沿主要方向每 4 m 一段（橫的 yaw 0、直的轉 90°），全部排進同一個工人的佇列
  rtsWallRow(x0, z0) {
    const ui = this.rts.ui,
      m = ui.mode;
    if (!m || m.k !== 'build') return;
    this.rtsGhostUpdate();
    const G = ui.ghost;
    if (!G || !G.g.visible) return;
    const dx = G.x - x0,
      dz = G.z - z0;
    const [fw, fd] = this.rtsFootprint(m.D);
    const horiz = Math.abs(dx) >= Math.abs(dz);
    const len = horiz ? Math.abs(dx) : Math.abs(dz);
    const n = Math.min(20, Math.round(len / fw) + 1);
    if (n <= 1) return this.rtsBuildAt(true);
    const ws = this.rtsActiveGroup().filter((e) => this.rtsOwn(e) && !e.bld);
    if (!ws.length) return this.rtsSetMode(null);
    let w = m.worker && ws.includes(m.worker) ? m.worker : null;
    if (!w) {
      let bd = 1e9;
      for (const u of ws) {
        const dd = Math.hypot(u.pos.x - x0, u.pos.z - z0);
        if (dd < bd) ((bd = dd), (w = u));
      }
    }
    m.worker = w;
    const nav = this.world.nav;
    const sg = horiz ? Math.sign(dx) : Math.sign(dz);
    let placed = 0;
    for (let i = 0; i < n; i++) {
      const x = horiz ? x0 + sg * i * fw : x0,
        z = horiz ? z0 : z0 + sg * i * fw;
      const ok =
        (!nav || (horiz ? nav.buildable(x, z, fw, fd) : nav.buildable(x, z, fd, fw))) &&
        !(this.rtsPowerWhy && this.rtsPowerWhy(RTS_ME, m.def, x, z));
      if (!ok) continue;
      if (typeof this.rtsOrder === 'function')
        this.rtsOrder([w], { k: 'build', def: m.def, x, z, yaw: horiz ? 0 : Math.PI / 2 }, true);
      this.rtsMark(x, z, 'gather');
      placed++;
    }
    if (!placed) this.rtsMsg('這裡不能建造', 0xff8a8a, 1.2);
    return placed;
  },

  // ---------- 指令標記與選取圈（3D） ----------
  rtsMark(x, z, kind) {
    const ui = this.rts.ui;
    if (!ringGeo) ringGeo = new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2);
    const c =
      kind === 'attack' ? COL.foe : kind === 'gather' ? COL.neu : kind === 'signal' ? COL.sig : COL.own;
    let mk = ui.marks.find((q) => q.t >= q.life);
    if (!mk) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({
          color: c,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      mesh.userData.helper = true;
      mesh.renderOrder = 6;
      this.scene.add(mesh);
      mk = { mesh, t: 0, life: 0.6 };
      ui.marks.push(mk);
    }
    mk.t = 0;
    mk.life = kind === 'signal' ? 1.6 : 0.6;
    mk.big = kind === 'signal' ? 3 : 1;
    mk.mesh.material.color.setHex(c);
    mk.mesh.position.set(x, this.world.terrainHeight(x, z) + 0.3, z);
    mk.mesh.visible = true;
  },
  rtsMarksTick(dt) {
    const ui = this.rts.ui;
    for (const mk of ui.marks) {
      if (mk.t >= mk.life) continue;
      mk.t += dt;
      const k = Math.min(1, mk.t / mk.life);
      const s = (3.2 * (1 - k) + 0.6) * (mk.big || 1);
      mk.mesh.scale.set(s, 1, s);
      mk.mesh.material.opacity = 1 - k * k;
      if (mk.t >= mk.life) mk.mesh.visible = false;
    }
    // 選取圈：池子裡的網格依選取（＋滑鼠下的）實體擺放
    if (!ringGeo) ringGeo = new THREE.RingGeometry(0.82, 1, 28).rotateX(-Math.PI / 2);
    const show = this.rts.sel.filter((e) => !e.dead && this.rtsSeen(e));
    let i = 0;
    for (const e of show) {
      let r = ui.rings[i];
      if (!r) {
        r = new THREE.Mesh(ringGeo, ringMat(COL.own));
        r.userData.helper = true;
        r.renderOrder = 4;
        this.scene.add(r);
        ui.rings[i] = r;
      }
      const c = this.rtsOwn(e)
        ? COL.own
        : e.rtsTeam === undefined || e.team === 'neutral'
          ? COL.neu
          : COL.foe;
      r.material = ringMat(c);
      const rad = this.rtsRadius(e) * 1.15;
      r.scale.set(rad, 1, rad);
      r.position.set(
        e.pos.x,
        (e.flying ? this.world.terrainHeight(e.pos.x, e.pos.z) : e.pos.y) + 0.2,
        e.pos.z,
      );
      r.visible = true;
      i++;
    }
    for (; i < ui.rings.length; i++) ui.rings[i].visible = false;
    if (ui.mode && ui.mode.k === 'build') this.rtsGhostUpdate();
    this.rtsHudRings();
  },
  // ---------- 導管的範圍圈（R3） ----------
  // 要不要顯示：建造模式的建築要電或是供電源、選取中有己方的導管建築（要電的建築、供電源）
  rtsHudRingsWant() {
    const R = this.rts,
      ui = R.ui;
    if (R.pilot || this.state !== 'rts' || !(this.rtsPowerTeam && this.rtsPowerTeam(RTS_ME))) return false;
    const m = ui.mode;
    if (m && m.k === 'build') return !!(m.D && (m.D.needPower || m.D.conduit));
    return R.sel.some((e) => {
      if (e.dead || !e.bld || e.rtsTeam !== RTS_ME) return false;
      const D = RTS_DEFS[e.rtsDef] || {};
      return !!(D.needPower || D.conduit);
    });
  },
  // 範圍圈：一個網格（填色）＋一組線段（邊緣；有電的範圍被別的有電範圍蓋住的段不畫），貼著地形；導管重算或選取改變時重建
  rtsHudRings() {
    const R = this.rts,
      ui = R.ui;
    if (!this.rtsHudRingsWant()) {
      if (ui.rings3) ui.rings3.g.visible = false;
      return;
    }
    const T = R.teams[RTS_ME];
    const P = T.power || { srcs: [], ver: 0 };
    const selIds = R.sel.filter((e) => !e.dead && e.bld).map((e) => e.id);
    const key = (P.ver || 0) + '|' + P.srcs.length + '|' + selIds.join(',');
    if (!ui.rings3) {
      const g = new THREE.Group();
      g.userData.helper = true;
      const fill = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      const edge = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      );
      fill.renderOrder = 3;
      edge.renderOrder = 4;
      fill.frustumCulled = edge.frustumCulled = false;
      g.add(fill, edge);
      this.scene.add(g);
      ui.rings3 = { g, fill, edge, n: 0 };
      ui.ringKey = '';
    }
    const Rg = ui.rings3;
    Rg.g.visible = true;
    if (ui.ringKey === key) return;
    ui.ringKey = key;
    const th = (x, z) => this.world.terrainHeight(x, z) + RING_LIFT;
    const fp = [],
      fc = [],
      fi = [],
      lp = [],
      lc = [];
    const srcs = P.srcs;
    const covered = (x, z, self) =>
      srcs.some((o) => o !== self && o.on && Math.hypot(o.x - x, o.z - z) < o.r - 0.05);
    const N = 36,
      RN = 4; // 填色：中心＋4 圈 × 36 段
    for (const s of srcs) {
      const sel = !!(s.e && selIds.includes(s.e.id));
      const col = sel ? POW.sel : s.on ? POW.on : POW.off;
      const v0 = fp.length / 3;
      fp.push(s.x, th(s.x, s.z), s.z);
      fc.push(...col);
      for (let k = 1; k <= RN; k++)
        for (let i = 0; i < N; i++) {
          const a = (i / N) * Math.PI * 2,
            rr = (s.r * k) / RN;
          const x = s.x + Math.cos(a) * rr,
            z = s.z + Math.sin(a) * rr;
          fp.push(x, th(x, z), z);
          fc.push(...col);
        }
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N;
        fi.push(v0, v0 + 1 + i, v0 + 1 + j);
        for (let k = 1; k < RN; k++) {
          const a = v0 + 1 + (k - 1) * N,
            b = v0 + 1 + k * N;
          fi.push(a + i, b + i, b + j, a + i, b + j, a + j);
        }
      }
      for (let i = 0; i < RING_SEG; i++) {
        const a0 = (i / RING_SEG) * Math.PI * 2,
          a1 = ((i + 1) / RING_SEG) * Math.PI * 2;
        const x0 = s.x + Math.cos(a0) * s.r,
          z0 = s.z + Math.sin(a0) * s.r,
          x1 = s.x + Math.cos(a1) * s.r,
          z1 = s.z + Math.sin(a1) * s.r;
        if (s.on && !sel && covered((x0 + x1) / 2, (z0 + z1) / 2, s)) continue;
        lp.push(x0, th(x0, z0), z0, x1, th(x1, z1), z1);
        lc.push(...col, ...col);
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
    fg.setIndex(fi);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(lc, 3));
    Rg.fill.geometry.dispose();
    Rg.edge.geometry.dispose();
    Rg.fill.geometry = fg;
    Rg.edge.geometry = lg;
    Rg.n = srcs.length;
  },
  // 建造預覽是供電源時：它自己的供電範圍（綠／紅）＋節點的連接距離（灰色虛線：要在有電的導管這個距離內）
  rtsHudGhostRing(D, x, z, ok) {
    const ui = this.rts.ui;
    if (!(D && D.conduit && this.rtsPowerTeam && this.rtsPowerTeam(RTS_ME))) {
      if (ui.gRing) ui.gRing.visible = false;
      return;
    }
    const segs = RING_SEG;
    const rings = [this.rtsPowerR ? this.rtsPowerR(RTS_ME, D) : D.conduit.r];
    if (!D.conduit.root) rings.push(D.conduit.link || 32);
    if (!ui.gRing) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs * 2 * 2 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(segs * 2 * 2 * 3), 3));
      const l = new THREE.LineSegments(
        geo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
        }),
      );
      l.userData.helper = true;
      l.renderOrder = 6;
      l.frustumCulled = false;
      this.scene.add(l);
      ui.gRing = l;
    }
    const l = ui.gRing;
    const pa = l.geometry.attributes.position,
      ca = l.geometry.attributes.color;
    const c0 = ok ? [0.3, 1, 0.45] : [1, 0.3, 0.3],
      c1 = [0.6, 0.65, 0.7];
    let n = 0;
    rings.forEach((r, ri) => {
      const c = ri ? c1 : c0;
      for (let i = 0; i < segs; i++) {
        if (ri && i % 2) continue; // 連接距離畫成虛線
        for (const t of [i, i + 1]) {
          const a = (t / segs) * Math.PI * 2;
          const px = x + Math.cos(a) * r,
            pz = z + Math.sin(a) * r;
          pa.setXYZ(n, px, this.world.terrainHeight(px, pz) + RING_LIFT + 0.05, pz);
          ca.setXYZ(n, c[0], c[1], c[2]);
          n++;
        }
      }
    });
    l.geometry.setDrawRange(0, n);
    pa.needsUpdate = ca.needsUpdate = true;
    l.visible = true;
  },

  // 離開 RTS 時清掉 3D 標示（核心的 rtsEnd／clearMission 呼叫）
  rtsInputClear() {
    const ui = this.rts && this.rts.ui;
    if (!ui) return;
    for (const r of ui.rings) this.scene.remove(r);
    for (const m of ui.marks) {
      this.scene.remove(m.mesh);
      m.mesh.material.dispose();
    }
    if (ui.ghost) this.scene.remove(ui.ghost.g);
    if (ui.rings3) {
      this.scene.remove(ui.rings3.g);
      ui.rings3.fill.geometry.dispose();
      ui.rings3.edge.geometry.dispose();
      ui.rings3 = null;
    }
    if (ui.gRing) {
      this.scene.remove(ui.gRing);
      ui.gRing.geometry.dispose();
      ui.gRing = null;
    }
    ui.rings = [];
    ui.marks = [];
    ui.ghost = null;
    this.camExtra = 0;
    if (this.rtsHudHide) this.rtsHudHide();
  },

  // ---------- 鍵盤 ----------
  rtsKey(e) {
    if (this.edTyping && this.edTyping()) return;
    const R = this.rts,
      ui = R.ui;
    if (!ui) return;
    const code = e.code;
    const ctrl = e.ctrlKey || e.metaKey;
    if (code === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (this.rtsCancelMode()) return;
      if (typeof this.rtsPause === 'function') this.rtsPause();
      return;
    }
    if (code === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      const n = this.rtsSubgroups().length;
      if (n > 1) {
        ui.sub = (ui.sub + (e.shiftKey ? n - 1 : 1)) % n;
        ui.menu = null;
        this.rtsHudDirty = true;
      }
      return;
    }
    if (code === 'Home') {
      e.preventDefault();
      return this.rtsCamReset();
    }
    if (code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      const ev = ui.events[ui.events.length - 1];
      if (ev) this.rtsCamJump(ev.x, ev.z);
      return;
    }
    // F1～F3 英雄、F8 閒置工人（Ctrl＝全部）、F9 閒置部隊
    const fk = /^F([1-3])$/.exec(code);
    if (fk) {
      e.preventDefault();
      if (!e.repeat && this.rtsHudHeroKey) this.rtsHudHeroKey(+fk[1] - 1);
      return;
    }
    if (code === 'F8' || code === 'F9') {
      e.preventDefault();
      if (!e.repeat && this.rtsIdleSelect)
        this.rtsIdleSelect(code === 'F8' ? 'worker' : 'army', code === 'F9' || ctrl);
      return;
    }
    // Alt＋1～6：選中的英雄使用道具
    const ak = e.altKey && /^Digit([1-6])$/.exec(code);
    if (ak) {
      e.preventDefault();
      if (e.repeat) return;
      const h = this.rtsActiveGroup().find((u) => u.hero && this.rtsOwn(u));
      if (h && this.rtsHudItemUse) this.rtsHudItemUse(h, +ak[1] - 1);
      return;
    }
    if (/^Digit[0-9]$/.test(code)) {
      e.preventDefault();
      if (e.repeat) return;
      const n = +code.slice(5);
      if (ctrl || e.shiftKey) {
        // Ctrl＝設定編隊、Shift＝加進編隊
        const own = R.sel.filter((u) => this.rtsOwn(u));
        if (!own.length) return;
        const cur = e.shiftKey && !ctrl ? (R.groups[n] || []).filter((u) => !u.dead) : [];
        for (const u of own) if (!cur.includes(u)) cur.push(u);
        R.groups[n] = cur.slice(0, SEL_MAX);
        this.flashMsg('編隊 ' + n + '：' + R.groups[n].length + ' 個', 0x7ee081, 0.9);
        this.rtsHudDirty = true;
        return;
      }
      const g = (R.groups[n] || []).filter((u) => !u.dead);
      R.groups[n] = g;
      if (!g.length) return;
      const t = performance.now() / 1000;
      if (ui.lastGroup.n === n && t - ui.lastGroup.t < DBL_T) {
        let cx = 0,
          cz = 0;
        for (const u of g) ((cx += u.pos.x), (cz += u.pos.z));
        this.rtsCamJump(cx / g.length, cz / g.length);
      }
      ui.lastGroup = { n, t };
      this.rtsSetSel(g);
      return;
    }
    if (ctrl || e.altKey) return;
    // 指令卡：依格子位置的鍵（Q W E R／A S D F／Z X C V）與定義的 alt 鍵（M 移動、H 守住、P 巡邏…）
    const m = /^Key([A-Z])$/.exec(code);
    if (m && this.rtsCardKey) {
      if (e.repeat) return;
      if (this.rtsCardKey(m[1], e.shiftKey)) e.preventDefault();
    }
  },
});
