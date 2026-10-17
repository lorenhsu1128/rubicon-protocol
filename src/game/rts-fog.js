// Coral 戰爭（RTS）的戰爭迷霧（docs/rts-design.md 3.7、12 節）：每個隊伍一張視野格（FOG_CELL 的格子），
// 狀態 0 未探索、1 探索過但目前看不到、2 可見；每 FOG_DT 秒重算。
// 視線（照魔獸3）：每格的高度＝格內導航格高度的最大值；觀察者的高度＝所在位置的地面（飛行單位用機體高度）。
// 從觀察者沿射線往外，某一格比觀察者高出 FOG_UP 以上就看不到它與它後面的格子（低處看不到高台、山脊擋住後面）。
// 圓形樣板依整數半徑快取：位移依距離排序、每個位移記錄往中心一步的「父格」，可見＝父格可見且高度沒有超過門檻。
// 顯示（玩家的隊伍）：地形上方一層黑色半透明網格（DataTexture 的 alpha、線性過濾、狀態改變時漸變）；
// 看不到的敵方實體、未探索處的地圖物件與資源點在 scene.onBeforeRender 暫時隱藏、onAfterRender 還原
// （不直接改 visible，所以和迷彩、隧道、潛航等自己改 visible 的機制不衝突）；
// 敵方建築在看不到時留下殘影（當時的模型複本換成暗色材質），重新看到該處時才更新或消失。
// 實體的 noLock：任何敵對隊伍都看不到時設為 true（鎖定、名牌、一般 AI 找目標都會略過），由這裡設定的才由這裡清掉。
// R4（docs 15.2）：對空的視野 visAir——同樣的觀察者與半徑、不看高度（場上有空中／低空的實體時才算）；
// 空中（flying）與低空（rtsLowAir）的實體查 visAir，所以斷崖下的單位看得到台上的空中單位、看不到台上的地面單位。
// 收起搬走的建築：在飛時不記成殘影（它是單位的狀態）；記得的位置重新看到、建築不在那裡時拿掉。運輸機上的乘員不提供視野。
import { Game } from './game.js';
import { isOutline } from '../render/geometry.js';
import { FAR_R } from '../world/edges.js';
import { rtsDef } from '../data/rts-units.js';
import { RTS_PROP_FOG } from '../world/rts-props.js';

export const FOG_CELL = 4; // 視野格（m）
const FOG_DT = 0.2; // 重算間隔（秒）
const FOG_UP = 2.5; // 低處看高處的門檻（m）
const DEF_VIS = 28; // 定義沒有寫視野時（單位）
const DEF_VIS_BLD = 24; // 建築
const A_UNSEEN = 1, // 顯示的不透明度（線性空間，輸出經過 gamma，所以灰色要比看起來的高）：未探索
  A_GREY = 0.78, // 探索過但看不到
  A_OUT = 1; // 地圖外
const FOG_MARGIN = 24; // 迷霧網格延伸到地圖外（m）；再外面是全黑的外圍網格（到遠景地形外）
const FADE = 3.5; // 漸變速度（每秒）

const TPL = new Map(); // 整數半徑 → 樣板 { n, dx, dz, par }
function template(R) {
  let t = TPL.get(R);
  if (t) return t;
  const lim = (R + 0.35) * (R + 0.35);
  const pts = [];
  for (let dz = -R; dz <= R; dz++)
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dz * dz;
      if (d2 <= lim) pts.push([dx, dz, d2]);
    }
  pts.sort((a, b) => a[2] - b[2]);
  const n = pts.length;
  const idx = new Map();
  t = { n, dx: new Int16Array(n), dz: new Int16Array(n), par: new Int32Array(n) };
  pts.forEach((p, k) => {
    t.dx[k] = p[0];
    t.dz[k] = p[1];
    idx.set(p[0] * 4096 + p[1], k);
  });
  for (let k = 1; k < n; k++) {
    const dx = t.dx[k],
      dz = t.dz[k],
      d = Math.sqrt(dx * dx + dz * dz);
    const f = Math.max(0, d - 1) / d;
    const px = Math.round(dx * f),
      pz = Math.round(dz * f);
    const p = idx.get(px * 4096 + pz);
    t.par[k] = p === undefined || p >= k ? 0 : p;
  }
  TPL.set(R, t);
  return t;
}
let SCR = new Uint8Array(1024); // 樣板的暫存（可見與否）

const GHOST_MAT = new WeakMap(); // 原材質 → 殘影用的暗色複本
function ghostMat(m) {
  if (!m || isOutline(m)) return m;
  let g = GHOST_MAT.get(m);
  if (g) return g;
  g = m.clone();
  if (g.color) g.color.multiplyScalar(0.18).lerp(new THREE.Color(0x30343b), 0.3);
  if (g.metalness !== undefined) g.envMapIntensity = 0.2;
  if (g.emissive) g.emissive.setHex(0);
  if (g.emissiveMap) g.emissiveMap = null;
  GHOST_MAT.set(m, g);
  return g;
}

Object.assign(Game.prototype, {
  // ---------- 建立與清除 ----------
  rtsFogInit() {
    const R = this.rts,
      w = this.world;
    if (!R || !w) return null;
    this.rtsFogClear();
    const size = w.size,
      W = Math.ceil(size / FOG_CELL),
      N = W * W,
      S = size / 2;
    // 每格的高度（格內導航格高度的最大值；沒有導航格時取樣地形）
    const hc = new Float32Array(N);
    const nav = w.nav;
    for (let gz = 0; gz < W; gz++)
      for (let gx = 0; gx < W; gx++) {
        const x0 = -S + gx * FOG_CELL,
          z0 = -S + gz * FOG_CELL;
        let m = -1e9;
        if (nav) {
          const c = nav.cell;
          for (let z = z0 + c / 2; z < z0 + FOG_CELL; z += c)
            for (let x = x0 + c / 2; x < x0 + FOG_CELL; x += c) {
              const i = nav.cellOf(x, z);
              if (i >= 0) m = Math.max(m, nav.heightAt(i));
            }
        }
        if (m < -1e8)
          for (const [u, v] of [
            [0.5, 0.5],
            [0.15, 0.15],
            [0.85, 0.15],
            [0.15, 0.85],
            [0.85, 0.85],
          ])
            m = Math.max(m, w.terrainHeight(x0 + u * FOG_CELL, z0 + v * FOG_CELL));
        hc[gz * W + gx] = m;
      }
    const diff = (R.cfg && R.cfg.diff) || '';
    const teams = (R.teams || []).map((t) => ({
      id: t.id,
      vis: new Uint8Array(N),
      visAir: new Uint8Array(N), // 對空的視野（不看高度）
      airOk: false, // visAir 這一輪有算（場上有空中／低空的實體）
      exp: new Uint8Array(N),
      cheat: !!(t.fogCheat || (t.ai && diff === 'insane')), // 「瘋狂」難度的電腦不受迷霧限制
      mem: new Map(), // 記得的敵方建築：id → { e, id, def, team, x, z, gone, ghost }
    }));
    const F = {
      world: w,
      W,
      N,
      S,
      cell: FOG_CELL,
      hc,
      teams,
      me: this.rtsFogMe(),
      t: FOG_DT, // 第一格就算
      ver: 0,
      ms: 0,
      msMax: 0,
      msSum: 0,
      runs: 0,
      reveals: [], // 暫時揭露：{ team, x, z, r, t }
      hide: [], // 這一格算繪時要隱藏的物件
      hidden: [], // 正在隱藏中（onAfterRender 還原）
      nl: new Set(), // 由迷霧設成 noLock 的實體
      props: null, // 地圖物件的群組與所在格（未探索時隱藏）
      disp: new Float32Array(N).fill(A_UNSEEN),
      dirty: true,
    };
    R.fog = F;
    this.rtsFogBuildOverlay(F);
    F.ghosts = new THREE.Group();
    F.ghosts.userData.helper = true;
    this.scene.add(F.ghosts);
    F.props = [];
    for (const o of w.obstacles || []) {
      if (!o.group) continue;
      F.props.push({ o: o.group, i: this.rtsFogCell(F, o.x, o.z) });
    }
    // 靜態合併的地圖物件（world/rts-props.js）：著色器查「探索過」的貼圖（每格一個像素，玩家的隊伍）
    F.expData = new Uint8Array(W * W * 4);
    F.expTex = new THREE.DataTexture(F.expData, W, W, THREE.RGBAFormat);
    F.expTex.magFilter = F.expTex.minFilter = THREE.NearestFilter;
    F.expTex.needsUpdate = true;
    RTS_PROP_FOG.rtsFogTex.value = F.expTex;
    RTS_PROP_FOG.rtsFogM.value.set(S, FOG_CELL, W);
    RTS_PROP_FOG.rtsFogOn.value = 1;
    // 遠景地形與剪影物件：一直隱藏（地圖外是黑的外圍網格）
    F.outside = [];
    for (const m of w.meshes || [])
      if (m.userData && m.userData.noFade && m !== w.terrainMesh && m !== w.waterMesh) F.outside.push(m);
    // 算繪時隱藏
    const sc = this.scene;
    F.prevB = sc.onBeforeRender;
    F.prevA = sc.onAfterRender;
    F.onB = (...a) => {
      F.prevB.apply(sc, a);
      if (!this.rts || this.rts.fog !== F) return;
      for (const o of F.hide)
        if (o && o.visible) {
          o.visible = false;
          F.hidden.push(o);
        }
    };
    F.onA = (...a) => {
      for (const o of F.hidden) o.visible = true;
      F.hidden.length = 0;
      F.prevA.apply(sc, a);
    };
    sc.onBeforeRender = F.onB;
    sc.onAfterRender = F.onA;
    this.rtsFogTick(0);
    return F;
  },
  rtsFogClear() {
    const F = this.rts && this.rts.fog;
    if (this._rtsFogLast && this._rtsFogLast !== F) this.rtsFogDispose(this._rtsFogLast);
    if (F) this.rtsFogDispose(F);
    this._rtsFogLast = null;
    if (this.rts) this.rts.fog = null;
  },
  rtsFogDispose(F) {
    if (!F || F.disposed) return;
    F.disposed = true;
    const sc = this.scene;
    for (const o of F.hidden) o.visible = true;
    F.hidden.length = 0;
    if (sc.onBeforeRender === F.onB) sc.onBeforeRender = F.prevB;
    if (sc.onAfterRender === F.onA) sc.onAfterRender = F.prevA;
    for (const e of F.nl) e.noLock = false;
    F.nl.clear();
    if (F.mesh) {
      sc.remove(F.mesh);
      F.mesh.geometry.dispose();
      F.mesh.material.dispose();
      F.tex.dispose();
    }
    if (F.skirt) {
      sc.remove(F.skirt);
      F.skirt.geometry.dispose();
      F.skirt.material.dispose();
    }
    if (F.ghosts) sc.remove(F.ghosts);
    if (F.expTex) {
      if (RTS_PROP_FOG.rtsFogTex.value === F.expTex) {
        RTS_PROP_FOG.rtsFogTex.value = null;
        RTS_PROP_FOG.rtsFogOn.value = 0;
      }
      F.expTex.dispose();
    }
  },
  // 玩家的隊伍（迷霧顯示用）
  rtsFogMe() {
    const R = this.rts;
    if (!R) return 0;
    if (typeof R.me === 'number') return R.me;
    const t = (R.teams || []).find((q) => !q.ai);
    return t ? t.id : 0;
  },
  rtsFogCell(F, x, z) {
    const gx = Math.floor((x + F.S) / F.cell),
      gz = Math.floor((z + F.S) / F.cell);
    if (gx < 0 || gz < 0 || gx >= F.W || gz >= F.W) return -1;
    return gz * F.W + gx;
  },
  // 地形上方的迷霧網格：頂點＝地形高度＋0.35 m（地圖外 FOG_MARGIN 用遠景地形的高度），
  // 貼圖每格一個像素（alpha）、外圍多一圈固定全黑的像素（地圖外一律是黑的），線性過濾
  rtsFogBuildOverlay(F) {
    const w = F.world,
      size = w.size,
      sp0 = size / (w.cells || Math.round(size / 2.5)), // 和地形網格對齊（同樣的頂點與三角形）
      mg = Math.ceil(FOG_MARGIN / sp0),
      seg = w.cells + mg * 2,
      ext = seg * sp0;
    const geo = new THREE.PlaneGeometry(ext, ext, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position,
      uv = geo.attributes.uv;
    const TW = F.W + 2,
      full = TW * F.cell;
    const fh = w.farHeight ? (x, z) => w.farHeight(x, z) : (x, z) => w.terrainHeight(x, z);
    for (let k = 0; k < pos.count; k++) {
      const x = pos.getX(k),
        z = pos.getZ(k);
      pos.setY(k, fh(x, z) + 0.35);
      uv.setXY(k, (x + F.S + F.cell) / full, (z + F.S + F.cell) / full);
    }
    geo.computeBoundingSphere();
    const data = new Uint8Array(TW * TW * 4).fill(0);
    for (let k = 0; k < TW * TW; k++) data[k * 4 + 3] = Math.round(A_OUT * 255);
    const tex = new THREE.DataTexture(data, TW, TW, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 5;
    m.frustumCulled = false;
    m.userData.helper = true;
    m.userData.noFade = true;
    m.userData.rtsFog = true;
    this.scene.add(m);
    // 外圍：全黑、不透明、粗格子，地圖裡的頂點壓到地形下面
    const ER = FAR_R + 80,
      sg = new THREE.PlaneGeometry(ER * 2, ER * 2, 96, 96);
    sg.rotateX(-Math.PI / 2);
    const sp = sg.attributes.position,
      lim = F.S - 1;
    for (let k = 0; k < sp.count; k++) {
      const x = sp.getX(k),
        z = sp.getZ(k);
      const inside = Math.abs(x) < lim && Math.abs(z) < lim;
      sp.setY(k, inside ? w.terrainHeight(x, z) - 60 : fh(x, z) + 0.6);
    }
    sg.computeBoundingSphere();
    const sk = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    sk.frustumCulled = false;
    sk.userData.helper = true;
    sk.userData.noFade = true;
    sk.userData.rtsFog = true;
    this.scene.add(sk);
    F.skirt = sk;
    F.mesh = m;
    F.tex = tex;
    F.data = data;
  },
  // ---------- 每格 ----------
  rtsFogTick(dt) {
    const R = this.rts;
    if (!R) return;
    let F = R.fog;
    if (!F || F.world !== this.world) {
      if (F) this.rtsFogDispose(F);
      R.fog = null;
      F = this.rtsFogInit();
      if (!F) return;
    }
    this._rtsFogLast = F;
    F.t += dt;
    for (const r of F.reveals) r.t -= dt;
    if (F.reveals.length) F.reveals = F.reveals.filter((r) => r.t > 0);
    if (F.t >= FOG_DT) {
      F.t = 0;
      this.rtsFogUpdate(F);
    }
    this.rtsFogApply(F, dt);
  },
  // 重算各隊伍的視野格
  rtsFogUpdate(F) {
    const t0 = performance.now();
    const R = this.rts,
      { W, N, hc } = F;
    const units = R.units || [];
    // 場上有沒有空中／低空的實體（沒有時不算 visAir）
    let anyAir = false;
    for (const e of units)
      if (e && !e.dead && !e.rtsAboard && (e.flying || (this.rtsLowAir && this.rtsLowAir(e)))) {
        anyAir = true;
        break;
      }
    for (const T of F.teams) {
      const vis = T.vis,
        exp = T.exp,
        va = T.visAir;
      vis.fill(0);
      T.airOk = anyAir;
      if (anyAir) va.fill(0);
      if (T.cheat) {
        vis.fill(1);
        exp.fill(1);
        va.fill(1);
        continue;
      }
      for (const e of units) {
        if (!e || e.dead || e.rtsTeam !== T.id || !e.pos || e.rtsAboard) continue;
        const r = this.rtsFogVision(e);
        if (!(r > 0)) continue;
        const c = this.rtsFogCell(F, e.pos.x, e.pos.z);
        if (c < 0) continue;
        let oh = e.pos.y;
        if (!(oh > -1e6)) oh = this.world.terrainHeight(e.pos.x, e.pos.z);
        this.rtsFogStamp(vis, hc, W, c, r / F.cell, oh + FOG_UP, false);
        if (anyAir) this.rtsFogStamp(va, hc, W, c, r / F.cell, 0, true);
      }
      for (const rv of F.reveals)
        if (rv.team === T.id) {
          const c = this.rtsFogCell(F, rv.x, rv.z);
          if (c >= 0) {
            this.rtsFogStamp(vis, hc, W, c, rv.r / F.cell, 0, true);
            if (anyAir) this.rtsFogStamp(va, hc, W, c, rv.r / F.cell, 0, true);
          }
        }
      for (let i = 0; i < N; i++) if (vis[i]) exp[i] = 1;
    }
    // 記得的敵方建築（電腦 AI 也用）
    const gen = (F.ver = F.ver + 1);
    for (const T of F.teams) {
      for (const e of units) {
        if (!e || !e.bld || e.rtsTeam === T.id || !e.pos) continue;
        // 收好在飛的建築（維爾威）：當成單位，不更新記得的位置
        const fly = e.bld.packed === 2;
        const seen = !e.dead && !fly && this.rtsFogSees(F, T, e);
        let rec = T.mem.get(e.id);
        // 記得的位置重新看到、建築已經不在那裡（收起搬走）：忘掉
        if (
          rec &&
          !rec.gone &&
          !seen &&
          !e.dead &&
          (fly || Math.hypot(e.pos.x - rec.x, e.pos.z - rec.z) > 2)
        ) {
          const c = this.rtsFogCell(F, rec.x, rec.z);
          if (c >= 0 && T.vis[c]) rec.gone = true;
        }
        if (seen) {
          if (!rec) T.mem.set(e.id, (rec = { e, id: e.id, def: e.rtsDef, team: e.rtsTeam, gone: false }));
          rec.x = e.pos.x;
          rec.z = e.pos.z;
          rec.yaw = e.yaw || 0;
        }
        if (rec) rec.gen = gen;
      }
      for (const rec of T.mem.values()) {
        const e = rec.e;
        if (rec.gen !== gen || e.dead) rec.gone = true;
        if (!rec.gone) continue;
        const c = this.rtsFogCell(F, rec.x, rec.z);
        if (T.cheat || (c >= 0 && T.vis[c])) {
          if (rec.ghost) this.rtsFogDropGhost(F, rec);
          T.mem.delete(rec.id);
        }
      }
    }
    // 未探索處的地圖物件
    const me = F.teams.find((q) => q.id === F.me);
    F.hideProps = [];
    if (me) for (const p of F.props) if (p.i >= 0 && !me.exp[p.i]) F.hideProps.push(p.o);
    if (me && F.expData) {
      const D = F.expData;
      let ch = false;
      for (let i = 0; i < me.exp.length; i++) {
        const v = me.exp[i] ? 255 : 0;
        if (D[i * 4] !== v) ((D[i * 4] = v), (ch = true));
      }
      if (ch) F.expTex.needsUpdate = true;
    }
    F.dirty = true;
    const ms = performance.now() - t0;
    F.ms = ms;
    F.msMax = Math.max(F.msMax, ms);
    F.msSum += ms;
    F.runs++;
  },
  // 以樣板照亮：高度超過 lim 的格子擋住它與它後面（free＝不看高度）
  rtsFogStamp(vis, hc, W, c, rCells, lim, free) {
    const Rr = Math.max(1, Math.round(rCells));
    const t = template(Rr);
    if (SCR.length < t.n) SCR = new Uint8Array(t.n * 2);
    const sc = SCR;
    const cx = c % W,
      cz = (c - cx) / W;
    const { dx, dz, par, n } = t;
    sc[0] = 1;
    vis[c] = 1;
    for (let k = 1; k < n; k++) {
      const gx = cx + dx[k],
        gz = cz + dz[k];
      if (gx < 0 || gz < 0 || gx >= W || gz >= W || !sc[par[k]]) {
        sc[k] = 0;
        continue;
      }
      const i = gz * W + gx;
      if (!free && hc[i] > lim) {
        sc[k] = 0;
        continue;
      }
      sc[k] = 1;
      vis[i] = 1;
    }
  },
  // 實體的視野半徑（m）：data/rts-units.js 的 sight（可以用 e.rtsVision 覆寫，例如升級或技能）
  rtsFogVision(e) {
    if (e.rtsVision > 0) return e.rtsVision;
    const d = this.rtsFogDef(e);
    if (d && d.sight > 0) return d.sight;
    return e.bld ? DEF_VIS_BLD : DEF_VIS;
  },
  rtsFogDef(e) {
    if (e.rtsDef && typeof e.rtsDef === 'object') return e.rtsDef;
    if (e.rtsDef) return rtsDef(e.rtsDef);
    const b = e.bld && e.bld.def;
    return b ? (typeof b === 'object' ? b : rtsDef(b)) : null;
  },
  // 隊伍 T 看不看得到實體 e（建築看佔地範圍內的幾個點）
  rtsFogSees(F, T, e) {
    if (T.cheat) return true;
    // 空中與低空的實體查對空的視野（不看高度）
    const V = T.airOk && (e.flying || (this.rtsLowAir && this.rtsLowAir(e))) ? T.visAir : T.vis;
    const c = this.rtsFogCell(F, e.pos.x, e.pos.z);
    if (c >= 0 && V[c]) return true;
    if (e.bld) {
      const r = this.rtsFogBldR(e);
      for (const [u, v] of [
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const i = this.rtsFogCell(F, e.pos.x + u * r, e.pos.z + v * r);
        if (i >= 0 && V[i]) return true;
      }
    }
    return false;
  },
  rtsFogBldR(e) {
    const d = this.rtsFogDef(e);
    const fp = d && d.foot;
    if (Array.isArray(fp)) return Math.max(fp[0], fp[1]) * 0.4;
    return 3;
  },
  // 依目前的視野格：隱藏、noLock、殘影、資源點、貼圖漸變（每格）
  rtsFogApply(F, dt) {
    const R = this.rts,
      units = R.units || [];
    const hide = F.hide;
    hide.length = 0;
    const me = F.teams.find((q) => q.id === F.me);
    for (const e of units) {
      if (!e || !e.pos || e.rtsAboard) continue; // 運輸機上的乘員：不在場景裡
      // noLock：所有敵對隊伍都看不到
      let seenByFoe = false,
        anyFoe = false;
      for (const T of F.teams) {
        if (T.id === e.rtsTeam) continue;
        anyFoe = true;
        if (this.rtsFogSees(F, T, e)) {
          seenByFoe = true;
          break;
        }
      }
      const nl = anyFoe && !seenByFoe && !e.dead;
      if (nl && !e.noLock) {
        e.noLock = true;
        F.nl.add(e);
      } else if (!nl && F.nl.has(e)) {
        e.noLock = false;
        F.nl.delete(e);
      }
      if (!me || e.rtsTeam === me.id || e.dead) continue;
      const sees = this.rtsFogSees(F, me, e);
      e.fogHid = !sees; // 玩家看不到（算繪時隱藏；假影子、名牌等自己畫的東西看這個旗標）
      if (!sees && e.mesh) hide.push(e.mesh);
      if (e.bld) {
        const rec = me.mem.get(e.id);
        if (sees) {
          if (rec && rec.ghost) this.rtsFogDropGhost(F, rec);
        } else if (rec && !rec.ghost && !rec.gone && !e.bld.packed) this.rtsFogMakeGhost(F, rec, e);
      }
    }
    // 資源點：探索過後一直顯示
    if (me) {
      for (const list of [R.mines, R.corals])
        for (const m of list || []) {
          if (!m || !m.pos) continue;
          const c = this.rtsFogCell(F, m.pos.x, m.pos.z);
          if (c >= 0 && me.exp[c]) continue;
          if (m.mesh) hide.push(m.mesh);
          if (m.ext && m.ext.mesh && m.ext.rtsTeam !== me.id) hide.push(m.ext.mesh);
        }
      if (F.hideProps) for (const o of F.hideProps) hide.push(o);
      for (const o of F.outside) hide.push(o);
    }
    // 迷霧貼圖：目標不透明度 → 漸變 → 3×3 模糊寫進 alpha
    if (!me || !F.mesh) return;
    const { N, W, disp } = F,
      vis = me.vis,
      exp = me.exp;
    let moving = F.dirty;
    const step = Math.min(1, FADE * Math.max(dt, 0));
    for (let i = 0; i < N; i++) {
      const tg = vis[i] ? 0 : exp[i] ? A_GREY : A_UNSEEN;
      const d = tg - disp[i];
      if (d > 0.002 || d < -0.002) {
        disp[i] += dt > 0 ? (Math.abs(d) <= step ? d : Math.sign(d) * step) : d;
        moving = true;
      }
    }
    if (!moving) return;
    F.dirty = false;
    const data = F.data;
    for (let gz = 0; gz < W; gz++)
      for (let gx = 0; gx < W; gx++) {
        let s = 0,
          wsum = 0;
        for (let oz = -1; oz <= 1; oz++) {
          const z = gz + oz;
          if (z < 0 || z >= W) continue;
          for (let ox = -1; ox <= 1; ox++) {
            const x = gx + ox;
            if (x < 0 || x >= W) continue;
            const wgt = (ox ? 1 : 2) * (oz ? 1 : 2);
            s += disp[z * W + x] * wgt;
            wsum += wgt;
          }
        }
        data[((gz + 1) * (W + 2) + gx + 1) * 4 + 3] = Math.round((s / wsum) * 255);
      }
    F.tex.needsUpdate = true;
  },
  // 殘影：當時的模型複本（共用幾何）換成暗色材質，不動
  rtsFogMakeGhost(F, rec, e) {
    if (!e.mesh) return;
    let g;
    try {
      g = e.mesh.clone(true);
    } catch {
      return;
    }
    g.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.material = Array.isArray(o.material) ? o.material.map(ghostMat) : ghostMat(o.material);
        o.castShadow = false;
      }
    });
    g.visible = true;
    g.userData = { rtsGhost: rec.id, helper: true };
    e.mesh.updateMatrixWorld(true);
    g.matrixAutoUpdate = false;
    g.matrix.copy(e.mesh.matrixWorld);
    F.ghosts.add(g);
    rec.ghost = g;
  },
  rtsFogDropGhost(F, rec) {
    if (rec.ghost) F.ghosts.remove(rec.ghost);
    rec.ghost = null;
  },
  // ---------- API ----------
  // 隊伍在 (x, z) 的狀態：0 未探索、1 探索過、2 可見（沒有迷霧時一律 2）
  rtsFogState(teamId, x, z) {
    const F = this.rts && this.rts.fog;
    if (!F) return 2;
    const T = F.teams.find((q) => q.id === teamId);
    if (!T || T.cheat) return 2;
    const c = this.rtsFogCell(F, x, z);
    if (c < 0) return 0;
    return T.vis[c] ? 2 : T.exp[c] ? 1 : 0;
  },
  // 隊伍看不看得到實體（自己的一律看得到；選取、下攻擊、電腦 AI 都用它）
  rtsVisible(teamId, ent) {
    if (!ent || ent.dead) return false;
    if (ent.rtsTeam === teamId) return true;
    const F = this.rts && this.rts.fog;
    if (!F || !ent.pos) return true;
    const T = F.teams.find((q) => q.id === teamId);
    if (!T) return true;
    return this.rtsFogSees(F, T, ent);
  },
  // 電腦 AI：自己看得到的敵方單位與建築
  // 中立隊伍（野怪、中立建築：R.teams[i].neutral）預設不算；withNeutral＝也列出（電腦對手的打野，F 包）
  rtsFogEnemies(teamId, withNeutral = false) {
    const R = this.rts;
    if (!R) return [];
    const neu = (e) => !withNeutral && R.teams && R.teams[e.rtsTeam] && R.teams[e.rtsTeam].neutral;
    return (R.units || []).filter(
      (e) => e && !e.dead && e.rtsTeam !== teamId && !neu(e) && this.rtsVisible(teamId, e),
    );
  },
  // 電腦 AI：記得的敵方建築（看過、還沒確認被摧毀的；位置是最後看到的）
  // 中立建築（酒館、商店、傭兵營）預設不算；withNeutral＝也列出
  rtsFogKnown(teamId, withNeutral = false) {
    const R = this.rts;
    const F = R && R.fog;
    const T = F && F.teams.find((q) => q.id === teamId);
    if (!T) return [];
    const neu = (r) => !withNeutral && R.teams && R.teams[r.team] && R.teams[r.team].neutral;
    return [...T.mem.values()]
      .filter((r) => !neu(r))
      .map((r) => ({
        id: r.id,
        def: r.def,
        team: r.team,
        x: r.x,
        z: r.z,
        gone: r.gone,
      }));
  },
  // 小地圖：整張格子（vis＝1 可見、exp＝1 探索過；W×W，(gx, gz) → gz×W＋gx，格子左上角 x＝−S＋gx×cell）
  rtsFogGrid(teamId) {
    const F = this.rts && this.rts.fog;
    const T = F && F.teams.find((q) => q.id === (teamId === undefined ? F.me : teamId));
    if (!T) return null;
    return { W: F.W, S: F.S, cell: F.cell, vis: T.vis, exp: T.exp, cheat: T.cheat, ver: F.ver };
  },
  // 暫時揭露（不看高度）：例如只剩單位時的倒數揭露、技能
  rtsFogReveal(teamId, x, z, r, sec = 3) {
    const F = this.rts && this.rts.fog;
    if (!F) return;
    F.reveals.push({ team: teamId, x, z, r, t: sec });
    F.t = FOG_DT;
  },
  // 整張揭露（測試、觀戰）
  rtsFogRevealAll(teamId, on = true) {
    const F = this.rts && this.rts.fog;
    const T = F && F.teams.find((q) => q.id === teamId);
    if (!T) return;
    T.cheat = on;
    F.t = FOG_DT;
  },
  // 效能：最近一次、最大、平均（ms）
  rtsFogStats() {
    const F = this.rts && this.rts.fog;
    if (!F) return null;
    return { ms: F.ms, max: F.msMax, avg: F.runs ? F.msSum / F.runs : 0, runs: F.runs, W: F.W };
  },
});
