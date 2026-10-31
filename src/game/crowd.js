// ============================================================
//  地圖上的小人（docs/crew-civilians-design.md 第 2 期）：生成、平時的活動（做事、走動）、
//  受驚逃跑與躲藏、被機甲踩死／撞死、被爆炸炸死、血跡、人員擊殺數（非戰鬥 civ／敵方 foe）。
//  模型是 render/crowd-model.js 的 CrowdMesh（合批）。亂數一律用自己的亂數串（不動 Math.random，
//  不影響遊戲其他部分的亂數順序）。自由出擊、主線、自訂關卡才有；靶場、模擬器、訓練、實驗室、過場、PvP 沒有。
//  第 2 期只在單機（多人在第 5 期：各端依種子生成、房主判定死亡）。
// ============================================================
import { Game } from './game.js';
import { CrowdMesh } from '../render/crowd-model.js';
import { makeRng, withRng } from '../core/math.js';
import { CREW, CREW_CHUTE, CREW_K } from '../data/crew.js';
import { CROWD_SEG, CROWD_THEME0, CROWD_THEMES, INF_K } from '../data/crowd-themes.js';

const CROWD_MAX = 64;
const CREW_SLOTS = 40; // 戰鬥中逃出來的乘員（第 3 期）預留的位置
const WALK = 1.4; // m/s
const RUN = 5.5;
const SCARE_R = 34; // 移動中的機甲在這個距離內＝受驚
const NEAR_R = 15; // 機甲（就算不動）在這個距離內＝受驚
const BLOOD_MAX = 32;
const BLOOD_LIFE = 45; // 秒（最後 6 秒淡出）
const BLOOD_COL = { red: 0x1c0403, oil: 0x070605 }; // 紅褐（預設）／深色油污（線性值：r128 的 setHex 不做 sRGB 轉換，畫面上會亮很多）

// 狀態（多人同步用的編號）
const ST = ['idle', 'walk', 'run', 'hide', 'flee', 'shoot', 'chute', 'post', 'engage', 'eject'];
// 膚色（衣服與帽子依主題：data/crowd-themes.js）
const SKIN = [0xe0b896, 0xc69072, 0x8d5a3c, 0xf0cfb0];
// 乘員的外觀：駕駛服＋頭盔（敵對 AC 的駕駛員另一種）
const CREW_LOOK = [
  { shirt: 0x4a5236, pants: 0x4a5236, hat: 0x2a2d30 },
  { shirt: 0x3d4248, pants: 0x3d4248, hat: 0x2a2d30 },
  { shirt: 0x5a5040, pants: 0x3a3a34, hat: 0x3a3e30 },
];
const PILOT_LOOK = { shirt: 0x24272e, pants: 0x24272e, hat: 0x7a1a16 };

// 降落傘（共用的幾何與材質）
let CHUTE = null;
function chuteMesh() {
  if (!CHUTE)
    CHUTE = {
      g: new THREE.SphereGeometry(2.2, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2.4),
      m: new THREE.MeshStandardMaterial({
        color: 0xd8d2c0,
        roughness: 0.9,
        side: THREE.DoubleSide,
        flatShading: true,
      }),
    };
  const m = new THREE.Mesh(CHUTE.g, CHUTE.m);
  m.castShadow = true;
  m.userData.noFade = true;
  return m;
}

// 這台敵人的乘員：{ n 人數, chute 降落傘, armed 駕駛員爬出來開槍 }；沒有人時 null
function crewOf(e) {
  if (!e || e.team !== 'enemy' || e.decoy || e.gone) return null;
  const md = e.model;
  const humanoid = !!(md && md.legsG && md.torso && !md.vehicle);
  if (e.ace || (e.isBoss && humanoid && e.ai !== 'part')) return { n: 1, chute: false, armed: true };
  const n = CREW[e.etype];
  if (!n) return null;
  return { n, chute: CREW_CHUTE.has(e.etype), armed: false };
}

// 血跡的幾何：鋸齒的圓（幾種形狀輪流用，不呼叫亂數）
let BLOOD_GEO = null;
function bloodGeos() {
  if (BLOOD_GEO) return BLOOD_GEO;
  BLOOD_GEO = [0, 1, 2].map((v) => {
    const N = 14,
      s = new THREE.Shape();
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      const r = 1 + 0.22 * Math.sin(a * 3 + v * 2.1) + 0.14 * Math.sin(a * 5 + v * 1.3);
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(-Math.PI / 2);
    return g;
  });
  return BLOOD_GEO;
}

// 小人建立 three.js 物件（uuid 用 Math.random）與特效（core/math 的 rnd）時，暫時換成自己的亂數：
// 不改變遊戲其他部分的亂數順序（冒煙測試的固定亂數、之後多人各端的一致）
function quiet(rng, fn) {
  const mr = Math.random;
  Math.random = rng;
  try {
    return withRng(Math.floor(rng() * 1e9), fn);
  } finally {
    Math.random = mr;
  }
}

Object.assign(Game.prototype, {
  // 這一場的人員擊殺數歸零（自由出擊、主線出擊、自訂關卡開始時）
  hkReset() {
    this.hk = { civ: 0, foe: 0 };
    this.hkOn = false;
  },
  // 結果畫面的一列（這一場有小人時）
  hkRows() {
    if (!this.hkOn || !this.hk) return [];
    const S = (this.save && this.save.hk) || { civ: 0, foe: 0 };
    return [['人員擊殺', `非戰鬥人員 ${this.hk.civ}・敵方人員 ${this.hk.foe}（累計 ${S.civ + S.foe}）`]];
  },
  // 生成：地圖建好、玩家放好之後呼叫
  // o.ambient＝false：只建立小人系統，不隨機放（自訂關卡「只有擺放的」）
  crowdPlan(o = {}) {
    this.crowdClear();
    if (!this.world || !this.scene || this.crowdOff) return;
    if (
      this.sim ||
      this.range ||
      this.tut ||
      this.lab ||
      this.cine ||
      this.pvp ||
      (this.net && this.net.role === 'client')
    )
      return;
    const W = this.world,
      Z = W.zone;
    const rng = makeRng(((W.seed | 0) * 131 + 7) >>> 0);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const pl = this.player;
    // 主題的人物與人數（第 4 期，data/crowd-themes.js）；主線依區段類型增減
    const T = CROWD_THEMES[W.themeKey] || CROWD_THEME0;
    const seg = (this.camp && this.camp.ss && CROWD_SEG[this.camp.ss.type]) || [1, 1];
    const look = () => ({
      shirt: pick(T.look.shirt),
      pants: pick(T.look.pants),
      skin: pick(SKIN),
      hat: pick(T.look.hat),
    });
    const amb = o.ambient !== false ? 1 : 0;
    const n = amb * Math.min(CROWD_MAX, Math.round((18 + rng() * 10) * (W.k || 1) * T.civ * seg[0]));
    const nc = Math.max(1, Math.round((6 + Math.floor(rng() * 4)) * Math.min(1.3, T.civ * seg[0])));
    // 活動點：地圖物件（貨櫃、倉庫、機具…）的旁邊，一群人面向它做事
    const props = W.obstacles.filter(
      (o) =>
        !o.deck &&
        (o.kind === 'box' ? Math.max(o.w, o.d) > 2 && Math.max(o.w, o.d) < 40 : o.r > 0.8 && o.r < 12),
    );
    const list = [];
    const far = (x, z) => !pl || Math.hypot(x - pl.pos.x, z - pl.pos.z) > 15;
    for (let c = 0; c < nc && list.length < n && n > 0; c++) {
      let cx = 0,
        cz = 0,
        face = null,
        ok = false;
      // 前三群在玩家附近（15～50 m）：一開場就看得到（2026-10-31 使用者定案）
      if (c < 3 && pl)
        for (let t = 0; t < 40 && !ok; t++) {
          const a = rng() * Math.PI * 2,
            r = 15 + rng() * 35;
          cx = pl.pos.x + Math.cos(a) * r;
          cz = pl.pos.z + Math.sin(a) * r;
          ok = this.crowdFree(cx, cz);
        }
      if (!ok && props.length && rng() < T.near)
        for (let t = 0; t < 12 && !ok; t++) {
          const o = props[Math.floor(rng() * props.length)];
          const a = rng() * Math.PI * 2;
          const r = (o.kind === 'box' ? Math.max(o.w, o.d) / 2 : o.r) + 2 + rng() * 2;
          cx = o.x + Math.cos(a) * r;
          cz = o.z + Math.sin(a) * r;
          face = Math.atan2(o.x - cx, o.z - cz);
          ok = this.crowdFree(cx, cz) && far(cx, cz);
        }
      for (let t = 0; t < 30 && !ok; t++) {
        cx = Z[0] + 8 + rng() * (Z[1] - Z[0] - 16);
        cz = Z[2] + 8 + rng() * (Z[3] - Z[2] - 16);
        face = null;
        ok = this.crowdFree(cx, cz) && far(cx, cz);
      }
      if (!ok) continue;
      const m = Math.min(n - list.length, 2 + Math.floor(rng() * 4));
      for (let j = 0; j < m; j++) {
        let x = cx,
          z = cz;
        for (let t = 0; t < 8; t++) {
          const a = rng() * Math.PI * 2,
            r = 1 + rng() * (face === null ? 6 : 3.5);
          x = cx + Math.cos(a) * r;
          z = cz + Math.sin(a) * r;
          if (this.crowdFree(x, z)) break;
          x = cx;
          z = cz;
        }
        list.push({
          i: list.length,
          x,
          z,
          y: W.groundAt(x, z, W.terrainHeight(x, z) + 0.5),
          yaw: face === null ? rng() * Math.PI * 2 : face + (rng() - 0.5) * 0.8,
          hx: cx,
          hz: cz,
          st: 'idle',
          t: 1 + rng() * 6 + (face === null ? 0 : 6),
          ph: rng() * 6,
          work: face !== null || rng() < 0.6 ? 1 : 0,
          look: look(),
          kind: 'civ',
          alive: true,
          tx: x,
          tz: z,
          dx: 0,
          dz: 0,
          cr: 0,
          sc: 0,
        });
      }
    }
    // 敵方步兵（C3）：小隊守在據點，玩家靠近就開槍，一部分拿火箭筒
    const ns = amb * Math.round((T.inf[0] + Math.floor(rng() * (T.inf[1] - T.inf[0] + 1))) * seg[1]);
    for (let q = 0; q < ns; q++) {
      let cx = 0,
        cz = 0,
        ok = false;
      // 離玩家遠（150 m 以上，放不下時 90 m）：步兵 100 m 內就開槍，不要一開場就被打
      for (let t = 0; t < 60 && !ok; t++) {
        cx = Z[0] + 10 + rng() * (Z[1] - Z[0] - 20);
        cz = Z[2] + 10 + rng() * (Z[3] - Z[2] - 20);
        ok =
          this.crowdFree(cx, cz) && (!pl || Math.hypot(cx - pl.pos.x, cz - pl.pos.z) > (t < 40 ? 150 : 90));
      }
      if (!ok) continue;
      const m = INF_K.SQUAD[0] + Math.floor(rng() * (INF_K.SQUAD[1] - INF_K.SQUAD[0] + 1));
      for (let j = 0; j < m && list.length < CROWD_MAX + 16; j++) {
        let x = cx,
          z = cz;
        for (let t = 0; t < 8; t++) {
          const a = rng() * Math.PI * 2,
            r = 2 + rng() * 4;
          x = cx + Math.cos(a) * r;
          z = cz + Math.sin(a) * r;
          if (this.crowdFree(x, z)) break;
          x = cx;
          z = cz;
        }
        list.push({
          i: list.length,
          x,
          z,
          y: W.groundAt(x, z, W.terrainHeight(x, z) + 0.5),
          yaw: rng() * Math.PI * 2,
          hx: x,
          hz: z,
          st: 'post',
          t: 0,
          sT: 0.5 + rng(),
          rT: INF_K.ROCKET_DT[0] * rng(),
          ph: rng() * 6,
          work: 0,
          look: { shirt: T.soldier.shirt, pants: T.soldier.pants, skin: pick(SKIN), hat: T.soldier.hat },
          kind: 'foe',
          soldier: true,
          armed: true,
          rocket: rng() < INF_K.ROCKET_P,
          kneel: rng() < 0.5,
          alive: true,
          tx: x,
          tz: z,
          dx: 0,
          dz: 0,
          cr: 0,
          sc: 0,
        });
      }
    }
    const mesh = quiet(rng, () => new CrowdMesh(list.length + CREW_SLOTS));
    for (const h of list) mesh.setLook(h.i, h.look);
    this.scene.add(mesh.group);
    this.crowd = {
      list,
      mesh,
      rng,
      blood: [],
      scareT: 0,
      used: list.length,
      chutes: [],
      rockets: [],
      byI: new Map(list.map((h) => [h.i, h])),
    };
    if (!this.hk) this.hkReset();
    this.hkOn = true;
    this.crowdTick(0);
    this.crowdNetFull(); // 多人：完整清單給客機（第 5 期）
  },
  crowdClear() {
    const C = this.crowd;
    if (!C) return;
    C.mesh.dispose();
    for (const c of C.chutes) this.scene.remove(c);
    for (const b of C.blood) {
      this.scene.remove(b.m);
      b.m.material.dispose();
    }
    this.crowd = null;
  },
  // 這一點可以站人：不在障礙物裡、不是虛空、水不深、在作戰區域裡
  crowdFree(x, z) {
    const W = this.world,
      Z = W.zone;
    if (x < Z[0] + 2 || x > Z[1] - 2 || z < Z[2] + 2 || z > Z[3] - 2) return false;
    if (W.isVoid && W.isVoid(x, z)) return false;
    if (W.waterDepth && W.waterDepth(x, z) > 0.5) return false;
    const y = W.groundAt(x, z, W.terrainHeight(x, z) + 0.5);
    if (W.groundAt(x, z, 999) > y + 2.2) return false; // 高台、橋面、屋頂底下：從上方的鏡頭看不到
    const [cx, cz] = W.collide(x, z, y, 0.4);
    return Math.abs(cx - x) + Math.abs(cz - z) < 0.05;
  },
  // 場上的機甲與載具（會踩人、會嚇到人）
  crowdMechs() {
    const out = [];
    const add = (e) => {
      if (e && !e.dead && e.model && e.pos && !e.isProp && !e.gone && !(e.mesh && e.mesh.visible === false))
        out.push(e);
    };
    add(this.player);
    for (const p of this.players || []) if (p !== this.player) add(p);
    for (const e of this.enemies) add(e);
    for (const e of this.allies) add(e);
    return out;
  },
  // 踩到的範圍（水平）：人形看腳的範圍，載具看車身；飛在空中的不算
  crowdCrushR(m) {
    const md = m.model;
    const r = m.radius || 2;
    if (md.legsG && md.torso && !md.vehicle) return r * 0.55;
    return r * 0.8;
  },
  // 受驚：從 src 逃開
  crowdScareOne(h, sx, sz) {
    const C = this.crowd;
    h.sc = 1.2;
    if (h.st === 'flee' || h.st === 'shoot' || h.st === 'chute' || h.st === 'eject') return;
    if (h.soldier && h.st === 'hide') return;
    // 已經在逃：遇到新的威脅時改成離開它（每 0.6 秒最多改一次，不要每格抖）
    if (h.st === 'run') {
      if ((this.time || 0) - (h.reT || -9) < 0.6) return;
      h.t = Math.max(h.t, 2);
    }
    h.reT = this.time || 0;
    let dx = h.x - sx,
      dz = h.z - sz;
    const d = Math.hypot(dx, dz) || 1;
    const a = (C.rng() - 0.5) * 0.9;
    dx /= d;
    dz /= d;
    h.dx = dx * Math.cos(a) - dz * Math.sin(a);
    h.dz = dx * Math.sin(a) + dz * Math.cos(a);
    h.st = 'run';
    h.t = 3 + C.rng() * 2.5;
    h.work = 0;
  },
  crowdScare(pos, r) {
    const C = this.crowd;
    if (!C) return;
    for (const h of C.list)
      if (h.alive && !h.soldier && Math.hypot(h.x - pos.x, h.z - pos.z) < r)
        this.crowdScareOne(h, pos.x, pos.z); // 步兵不怕槍聲
  },
  // 戰鬥中加一個人（乘員）：用沒用過的位置，滿了就用已經死掉／離開的
  crowdAdd(h) {
    const C = this.crowd;
    if (!C) return null;
    let i = -1;
    if (C.used < C.mesh.max) i = C.used++;
    else {
      const k = C.list.findIndex((q) => !q.alive);
      if (k < 0) return null;
      i = C.list[k].i;
      C.list.splice(k, 1);
    }
    Object.assign(h, {
      i,
      alive: true,
      cr: 0,
      sc: 0,
      ph: C.rng() * 6,
      work: 0,
      hx: h.x,
      hz: h.z,
      tx: h.x,
      tz: h.z,
    });
    C.list.push(h);
    C.byI.set(i, h);
    C.mesh.setLook(i, h.look);
    if (this.crowdHost()) this.netEv({ t: 'hadd', h: this.crowdEnc(h) });
    return h;
  },
  // 乘員逃出（第 3 期）：擊破時（die）剩下的人；early＝重傷時先逃一人
  crowdCrew(e, early = false) {
    const C = this.crowd;
    if (!C) return;
    const cr = crewOf(e);
    if (!cr) return;
    if (e.crewLeft === undefined) e.crewLeft = cr.n;
    const W = this.world,
      rng = C.rng;
    const n = early ? Math.min(1, e.crewLeft) : e.crewLeft;
    e.crewLeft -= n;
    const R = (e.radius || 3) * (early ? 0.9 : 1.45); // 擊破時在爆炸範圍外（die 的 crowdBlast＝半徑 ×1.4 的九成）
    for (let k = 0; k < n; k++) {
      if (!cr.armed && !early && rng() > CREW_K.ESCAPE_P) continue; // 沒逃出來
      const air = cr.chute && e.pos.y - W.groundAt(e.pos.x, e.pos.z, e.pos.y) > 4;
      let x = e.pos.x,
        z = e.pos.z,
        ok = air;
      // 旁邊是障礙物時範圍慢慢放大
      for (let t = 0; t < 24 && !ok; t++) {
        const a = rng() * Math.PI * 2,
          r = R * (1 + Math.floor(t / 6) * 0.35);
        x = e.pos.x + Math.cos(a) * r;
        z = e.pos.z + Math.sin(a) * r;
        ok = this.crowdFree(x, z);
      }
      if (!ok) continue;
      if (air) {
        x += (rng() - 0.5) * 6;
        z += (rng() - 0.5) * 6;
      }
      const L = cr.armed ? PILOT_LOOK : CREW_LOOK[Math.floor(rng() * CREW_LOOK.length)];
      const h = this.crowdAdd({
        x,
        z,
        y: air ? e.pos.y : W.groundAt(x, z, W.terrainHeight(x, z) + 0.5),
        yaw: rng() * Math.PI * 2,
        st: air ? 'chute' : 'eject',
        t: 0,
        sT: 0.6 + rng() * 0.8,
        armed: cr.armed,
        look: { shirt: L.shirt, pants: L.pants, skin: SKIN[Math.floor(rng() * SKIN.length)], hat: L.hat },
        kind: 'foe',
        crew: true,
        dx: 0,
        dz: 0,
      });
      // 地面：從機體的艙口（機體中心上方）跳到落點
      if (h && !air) {
        const c = e.center();
        h.ej = {
          x0: c.x,
          z0: c.z,
          y0: c.y + (e.radius || 3) * 0.35,
          x1: x,
          z1: z,
          y1: h.y,
          t: 0,
          T: 0.55 + rng() * 0.25,
        };
        h.x = c.x;
        h.z = c.z;
        h.y = h.ej.y0;
        quiet(rng, () => this.fx.flash(new THREE.Vector3(c.x, h.ej.y0, c.z), 0.35, 0xfff0c0, 0.12));
      }
      if (h && air)
        quiet(rng, () => {
          h.chute = chuteMesh();
          this.scene.add(h.chute);
          C.chutes.push(h.chute);
        });
    }
  },
  // 自訂關卡擺放的小人：civ 平民、soldier 步兵、rocket 火箭筒步兵、pilot 拿槍的駕駛員
  crowdSpawnUnit(type, at, yaw) {
    const C = this.crowd;
    if (!C) return null;
    const rng = C.rng;
    const T = CROWD_THEMES[this.world.themeKey] || CROWD_THEME0;
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const sol = type === 'soldier' || type === 'rocket';
    const L =
      type === 'pilot'
        ? PILOT_LOOK
        : sol
          ? T.soldier
          : { shirt: pick(T.look.shirt), pants: pick(T.look.pants), hat: pick(T.look.hat) };
    return this.crowdAdd({
      x: at.x,
      z: at.z,
      y: at.y,
      yaw,
      st: type === 'pilot' ? 'shoot' : sol ? 'post' : 'idle',
      t: 2 + rng() * 4,
      sT: 0.5 + rng(),
      rT: INF_K.ROCKET_DT[0] * rng(),
      look: { shirt: L.shirt, pants: L.pants, skin: pick(SKIN), hat: L.hat },
      kind: type === 'civ' ? 'civ' : 'foe',
      soldier: sol,
      armed: type !== 'civ',
      rocket: type === 'rocket',
      kneel: rng() < 0.5,
      crew: type === 'pilot',
      dx: 0,
      dz: 0,
    });
  },
  // 駕駛員開一槍：曳光＋目標身上的火花，傷害幾乎為零
  crowdShoot(h, tp) {
    const C = this.crowd;
    const a = new THREE.Vector3(h.x + Math.sin(h.yaw) * 0.5, h.y + 1.35, h.z + Math.cos(h.yaw) * 0.5);
    const c = tp.center();
    const b = c.clone().add(new THREE.Vector3((C.rng() - 0.5) * 2, (C.rng() - 0.5) * 2, (C.rng() - 0.5) * 2));
    const fx = this.fx;
    quiet(C.rng, () => {
      fx.beam(a, b, 0xffe0a0, 0.04);
      fx.flash(a, 0.12, 0xffd080, 0.06);
      fx.spark(b, 0xffd080);
    });
    const dir = b.clone().sub(a).normalize();
    tp.takeDamage(CREW_K.SHOOT_DMG, 1, null, b, dir, undefined, undefined, 'kin');
  },
  // 步兵的火箭筒：看得到、飛得慢，打到玩家附近爆炸（傷害一點點）
  crowdRocket(h, tp) {
    const C = this.crowd;
    const a = new THREE.Vector3(h.x + Math.sin(h.yaw) * 0.4, h.y + 1.4, h.z + Math.cos(h.yaw) * 0.4);
    const b = tp
      .center()
      .add(new THREE.Vector3((C.rng() - 0.5) * 4, (C.rng() - 0.5) * 2, (C.rng() - 0.5) * 4));
    const v = b.sub(a).normalize().multiplyScalar(INF_K.ROCKET_V);
    quiet(C.rng, () => {
      this.fx.flash(a, 0.3, 0xffb050, 0.1);
      this.fx.smoke(a, 0.8, 0x8a8a8a, 0.8, 1);
    });
    C.rockets.push({ p: a, v, life: 4, sm: 0 });
  },
  crowdRocketTick(dt, pls) {
    const C = this.crowd;
    if (!C.rockets.length) return;
    const W = this.world,
      fx = this.fx;
    for (let i = C.rockets.length - 1; i >= 0; i--) {
      const r = C.rockets[i];
      r.p.addScaledVector(r.v, dt);
      r.life -= dt;
      r.sm -= dt;
      if (r.sm <= 0) {
        r.sm = 0.03;
        quiet(C.rng, () => {
          fx.smoke(r.p.clone(), 0.5, 0xb0b0b0, 0.7, 0.5);
          fx.flash(r.p, 0.12, 0xffa040, 0.04);
        });
      }
      let hit = r.life <= 0 || r.p.y < W.groundAt(r.p.x, r.p.z, r.p.y + 1);
      for (const p of pls) if (p.center().distanceTo(r.p) < (p.radius || 3) * 0.8) hit = true;
      if (!hit) continue;
      C.rockets.splice(i, 1);
      quiet(C.rng, () => fx.explosion(r.p, 0.5, 0xffa040, false));
      for (const p of pls)
        if (p.center().distanceTo(r.p) < INF_K.ROCKET_R + (p.radius || 3))
          p.takeDamage(
            INF_K.ROCKET_DMG,
            30,
            null,
            r.p.clone(),
            r.v.clone().normalize(),
            undefined,
            undefined,
            'exp',
          );
      this.crowdBlast(r.p, 2.5, null); // 小人也會被炸到
    }
  },
  // ---------- 多人（第 5 期）：房主判定、客機照收到的顯示 ----------
  crowdHost() {
    return !!(this.net && this.net.role === 'host' && this.crowd);
  },
  // 一個人 → 陣列：[i, x, z, y, yaw, 狀態, 種類位元（1 敵方 2 乘員 4 步兵 8 拿槍 16 火箭筒）, 衣服, 褲子, 膚色, 帽子（-1＝沒有）]
  crowdEnc(h) {
    const L = h.look;
    const f =
      (h.kind === 'foe' ? 1 : 0) |
      (h.crew ? 2 : 0) |
      (h.soldier ? 4 : 0) |
      (h.armed ? 8 : 0) |
      (h.rocket ? 16 : 0);
    return [
      h.i,
      +h.x.toFixed(1),
      +h.z.toFixed(1),
      +h.y.toFixed(1),
      +h.yaw.toFixed(2),
      ST.indexOf(h.st),
      f,
      L.shirt,
      L.pants,
      L.skin,
      L.hat === null ? -1 : L.hat,
    ];
  },
  crowdNetFull() {
    const C = this.crowd;
    if (!this.crowdHost()) return;
    this.netEv({ t: 'crowd', n: C.mesh.max, l: C.list.filter((h) => h.alive).map((h) => this.crowdEnc(h)) });
  },
  // 客機：收到的人加進來或更新
  crowdNetPut(a, snap) {
    const C = this.crowd;
    const [i, x, z, y, yaw, st, f, shirt, pants, skin, hat] = a;
    let h = C.byI.get(i);
    if (!h || (!h.alive && !h.gone && f !== undefined)) {
      if (h) C.list.splice(C.list.indexOf(h), 1);
      h = {
        i,
        x,
        z,
        y,
        yaw,
        st: ST[st] || 'idle',
        t: 1,
        sT: 1,
        rT: 5,
        ph: 0,
        work: 0,
        cr: 0,
        sc: 0,
        hx: x,
        hz: z,
        tx: x,
        tz: z,
        dx: 0,
        dz: 0,
        alive: true,
        kind: f & 1 ? 'foe' : 'civ',
        crew: !!(f & 2),
        soldier: !!(f & 4),
        armed: !!(f & 8),
        rocket: !!(f & 16),
        look: { shirt, pants, skin, hat: hat === -1 ? null : hat },
      };
      C.list.push(h);
      C.byI.set(i, h);
      C.used = Math.max(C.used, i + 1);
      C.mesh.setLook(i, h.look);
    }
    if (!h.alive) return;
    h.nx = x;
    h.nz = z;
    h.ny = y;
    h.nyaw = yaw;
    h.st = ST[st] || h.st;
    if (snap) {
      h.x = x;
      h.z = z;
      h.y = y;
      h.yaw = yaw;
    }
  },
  crowdNetEvent(e) {
    if (e.t === 'crowd') {
      if (!this.crowd) {
        if (!this.world || !this.scene || this.crowdOff) return;
        const rng = makeRng(((this.world.seed | 0) * 131 + 7) >>> 0);
        const mesh = quiet(rng, () => new CrowdMesh(e.n || CROWD_MAX + 56));
        this.scene.add(mesh.group);
        this.crowd = { list: [], mesh, rng, blood: [], used: 0, chutes: [], rockets: [], byI: new Map() };
        if (!this.hk) this.hkReset();
        this.hkOn = true;
      }
      for (const a of e.l) this.crowdNetPut(a, !this.crowd.byI.get(a[0]));
      return;
    }
    const C = this.crowd;
    if (!C) return;
    if (e.t === 'hadd') this.crowdNetPut(e.h, true);
    else if (e.t === 'cw') {
      for (let k = 0; k + 5 < e.l.length; k += 6) {
        const h = C.byI.get(e.l[k]);
        if (h && h.alive)
          this.crowdNetPut([e.l[k], e.l[k + 1], e.l[k + 2], e.l[k + 3], e.l[k + 4], e.l[k + 5]], false);
      }
    } else if (e.t === 'hkill') {
      const h = C.byI.get(e.i);
      if (!h || !h.alive) return;
      h.x = e.x;
      h.z = e.z;
      h.y = e.y;
      this.crowdKill(h, null, e.w, e.s);
    } else if (e.t === 'hgone') {
      const h = C.byI.get(e.i);
      if (!h || !h.alive) return;
      h.alive = false;
      h.gone = true;
      C.mesh.hide(h.i);
      this.crowdChuteOff(h);
    }
  },
  // 客機每格：往房主送來的位置內插，依狀態擺姿勢（判定都在房主）
  crowdClientTick(dt) {
    const C = this.crowd;
    const W = this.world;
    const k = Math.min(1, dt * 4);
    for (const h of C.list) {
      if (!h.alive) continue;
      const ox = h.x,
        oz = h.z;
      if (h.nx !== undefined) {
        h.x += (h.nx - h.x) * k;
        h.z += (h.nz - h.z) * k;
        h.y += (h.ny - h.y) * k;
        let dy = h.nyaw - h.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        h.yaw += dy * k;
      }
      if (h.st !== 'chute' && h.st !== 'eject') h.y = Math.max(h.y, W.groundAt(h.x, h.z, h.y + 0.6) - 0.05);
      // 降落傘
      if (h.st === 'chute' && !h.chute)
        quiet(C.rng, () => {
          h.chute = chuteMesh();
          this.scene.add(h.chute);
          C.chutes.push(h.chute);
        });
      if (h.st !== 'chute' && h.chute) this.crowdChuteOff(h);
      if (h.chute) h.chute.position.set(h.x, h.y + 2.6, h.z);
      const sp = dt > 0 ? Math.hypot(h.x - ox, h.z - oz) / dt : 0;
      h.ph += dt * (sp > 3 ? 11 : sp > 0.4 ? 6.5 : 0);
      const crT = h.st === 'hide' ? 1 : h.st === 'engage' && h.soldier && h.i % 2 ? 0.55 : 0;
      h.cr += (crT - h.cr) * Math.min(1, dt * 6);
      const t = this.time || 0;
      C.mesh.pose(
        h.i,
        {
          x: h.x,
          y: h.y,
          z: h.z,
          yaw: h.yaw,
          sw: sp > 0.4 ? Math.sin(h.ph) : 0,
          run: sp > 3 ? 1 : 0,
          crouch: h.cr,
          work: h.st === 'idle' && h.i % 5 < 3 ? 0.6 + 0.4 * Math.sin(t * 5 + h.i) : 0,
          wave: h.st === 'chute' || h.st === 'eject' ? 0.85 : h.st === 'run' && h.i % 3 === 0 ? 0.6 : 0,
          aim: h.st === 'shoot' || h.st === 'engage' ? 1 : 0,
          lean: h.st === 'hide' ? 0.3 : 0,
        },
        h.look.hat !== null,
      );
    }
    C.mesh.commit(C.used);
    this.crowdBloodTick(dt);
  },
  crowdChuteOff(h) {
    const C = this.crowd;
    if (!h.chute) return;
    this.scene.remove(h.chute);
    if (C) C.chutes = C.chutes.filter((c) => c !== h.chute);
    h.chute = null;
  },
  // 爆炸：範圍內炸死，外圈受驚（owner＝攻擊者，玩家的才算進擊殺數）
  crowdBlast(pos, r, owner) {
    const C = this.crowd;
    if (!C || !(r > 0)) return;
    for (const h of C.list) {
      if (!h.alive) continue;
      const d = Math.hypot(h.x - pos.x, h.z - pos.z);
      if (d < r * 0.9 && Math.abs(h.y + 0.9 - pos.y) < r + 1) this.crowdKill(h, owner, 'blast');
      else if (d < r * 3 + 12) this.crowdScareOne(h, pos.x, pos.z);
    }
  },
  crowdKill(h, by, how, slot) {
    const C = this.crowd;
    if (!C || !h.alive) return;
    if (this.net && this.net.role === 'client' && slot === undefined) return; // 客機：死亡只由房主的事件決定
    h.alive = false;
    C.mesh.hide(h.i);
    this.crowdChuteOff(h);
    const W = this.world;
    const gy = W.groundAt(h.x, h.z, h.y + 0.5);
    const mode = (this.ctrl && this.ctrl.blood) || 'red';
    const fx = this.fx;
    const p = new THREE.Vector3(h.x, gy + 0.5, h.z);
    const nest = fx._nested;
    fx._nested = true; // 不轉送（各端自己演出）
    try {
      quiet(C.rng, () => {
        if (mode !== 'off') fx.streaks(p, 6, BLOOD_COL[mode] || BLOOD_COL.red, 3, 0.35, 20);
        if (how === 'blast' && fx.dust) fx.dust(p, 0.6);
      });
    } finally {
      fx._nested = nest;
    }
    if (mode !== 'off') quiet(C.rng, () => this.crowdBlood(h.x, gy, h.z, mode));
    // 只有玩家造成的算進擊殺數（多人：房主送 hkill 事件，記在動手的那位玩家名下）
    if (this.crowdHost()) {
      const s = by && by.team === 'player' && by.slot !== undefined && !by.isAI ? by.slot : -1;
      this.netEv({
        t: 'hkill',
        i: h.i,
        x: +h.x.toFixed(2),
        z: +h.z.toFixed(2),
        y: +h.y.toFixed(2),
        w: how,
        s,
      });
    }
    const mine = slot !== undefined ? this.net && slot === this.net.me : by && by === this.player;
    if (mine) {
      if (!this.hk) this.hkReset();
      this.hk[h.kind] = (this.hk[h.kind] || 0) + 1;
      const S = this.save;
      if (S) {
        S.hk = S.hk || { civ: 0, foe: 0 };
        S.hk[h.kind] = (S.hk[h.kind] || 0) + 1;
      }
    }
    // 附近的人看到了：逃
    this.crowdScare(p, 18);
  },
  // 血跡：慢慢擴大、最後淡出
  crowdBloodTick(dt) {
    const C = this.crowd;
    for (let i = C.blood.length - 1; i >= 0; i--) {
      const b = C.blood[i];
      b.t += dt;
      const g = Math.min(1, b.t / 2.5);
      const s = b.s * (0.1 + 0.9 * (1 - (1 - g) * (1 - g)));
      b.m.scale.set(s, 1, s);
      if (b.t > BLOOD_LIFE - 6) b.m.material.opacity = Math.max(0, (BLOOD_LIFE - b.t) / 6);
      if (b.t > BLOOD_LIFE) {
        this.scene.remove(b.m);
        b.m.material.dispose();
        C.blood.splice(i, 1);
      }
    }
  },
  crowdBlood(x, y, z, mode) {
    const C = this.crowd;
    const G = bloodGeos();
    const v = C.blood.length % G.length;
    const mat = new THREE.MeshStandardMaterial({
      color: BLOOD_COL[mode] || BLOOD_COL.red,
      roughness: 0.35,
      metalness: 0,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(G[v], mat);
    const s = 0.7 + C.rng() * 0.6;
    m.scale.set(s * 0.1, 1, s * 0.1); // 一小攤：從小慢慢擴大
    m.position.set(x, y + 0.15, z); // 地形網格的三角形內插和 terrainHeight 有落差：抬高一點
    m.rotation.y = C.rng() * Math.PI * 2;
    m.receiveShadow = true;
    m.userData.noFade = true;
    this.scene.add(m);
    C.blood.push({ m, t: 0, s });
    if (C.blood.length > BLOOD_MAX) {
      const b = C.blood.shift();
      this.scene.remove(b.m);
      b.m.material.dispose();
    }
  },
  // 每格（房主／單機的主迴圈）
  crowdTick(dt) {
    const C = this.crowd;
    if (!C) return;
    if (this.net && this.net.role === 'client') return this.crowdClientTick(dt);
    if (this.crowdHost()) {
      // 多人：每 0.5 秒送位置與狀態、每 5 秒送完整清單（中途加入、房主遷移）
      C.syncT = (C.syncT || 0) - dt;
      C.fullT = (C.fullT === undefined ? 0.5 : C.fullT) - dt; // 開局的事件會被清掉：0.5 秒後送第一次
      if (C.fullT <= 0) {
        C.fullT = 5;
        this.crowdNetFull();
      } else if (C.syncT <= 0) {
        C.syncT = 0.5;
        const l = [];
        for (const h of C.list)
          if (h.alive)
            l.push(
              h.i,
              +h.x.toFixed(1),
              +h.z.toFixed(1),
              +h.y.toFixed(1),
              +h.yaw.toFixed(2),
              ST.indexOf(h.st),
            );
        this.netEv({ t: 'cw', l });
      }
    }
    const W = this.world,
      rng = C.rng;
    const mechs = this.crowdMechs();
    // 重傷時先逃一人（多人乘員的載具，房主／單機）
    for (const e of mechs) {
      if (e.team !== 'enemy' || e.crewEarly || !(e.maxHp > 0) || e.hp / e.maxHp > CREW_K.EARLY_AP) continue;
      e.crewEarly = true;
      const cr = crewOf(e);
      if (cr && cr.n >= 2 && rng() < CREW_K.EARLY_P) this.crowdCrew(e, true);
    }
    const pls = (this.players && this.players.length ? this.players : [this.player]).filter(
      (p) => p && !p.dead,
    );
    for (const h of C.list) {
      if (!h.alive) continue;
      // 機甲：踩到＝死；靠近＝受驚
      let near = null,
        nd = 1e9;
      for (const m of mechs) {
        const dx = h.x - m.pos.x,
          dz = h.z - m.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < nd) {
          nd = d;
          near = m;
        }
        const air = m.pos.y - h.y;
        if (d < this.crowdCrushR(m) && air < 2.2 && air > -3) {
          this.crowdKill(h, m, 'crush');
          break;
        }
      }
      if (!h.alive) continue;
      if (near && h.soldier) {
        if (nd < INF_K.NEAR) this.crowdScareOne(h, near.pos.x, near.pos.z); // 步兵：機甲很近時才散開
      } else if (near && !h.crew) {
        const mv = Math.hypot(near.vel ? near.vel.x : 0, near.vel ? near.vel.z : 0) > 1.5;
        if (nd < NEAR_R || (nd < SCARE_R && mv)) this.crowdScareOne(h, near.pos.x, near.pos.z);
      }
      if (h.sc > 0) h.sc -= dt;
      let sp = 0;
      // 最近的玩家（乘員逃開的對象、駕駛員射擊的目標）
      let tp = null,
        td = 1e9;
      if (h.crew || h.soldier)
        for (const p of pls) {
          const d = Math.hypot(p.pos.x - h.x, p.pos.z - h.z);
          if (d < td) {
            td = d;
            tp = p;
          }
        }
      if (h.st === 'eject') {
        // 從艙口跳出來：拋物線落到旁邊，落地後逃跑（駕駛員開槍）
        const E = h.ej;
        if (!E) h.st = h.armed ? 'shoot' : 'flee';
        else {
          E.t += dt;
          const k = Math.min(1, E.t / E.T);
          h.x = E.x0 + (E.x1 - E.x0) * k;
          h.z = E.z0 + (E.z1 - E.z0) * k;
          h.y = E.y0 + (E.y1 - E.y0) * k + 2.2 * 4 * k * (1 - k);
          h.yaw = Math.atan2(E.x1 - E.x0, E.z1 - E.z0);
          if (k >= 1) {
            h.ej = null;
            h.st = h.armed ? 'shoot' : 'flee';
            h.t = 0;
          }
        }
      } else if (h.st === 'chute') {
        // 降落傘：慢慢落下，落地後逃跑（駕駛員開槍）
        h.y -= CREW_K.CHUTE_V * dt;
        const gy = W.groundAt(h.x, h.z, h.y + 0.5);
        if (h.chute) {
          h.chute.position.set(h.x, h.y + 2.6, h.z);
          h.chute.rotation.z = Math.sin((this.time || 0) * 1.3 + h.i) * 0.12;
        }
        if (h.y <= gy) {
          h.y = gy;
          this.crowdChuteOff(h);
          h.st = h.armed ? 'shoot' : 'flee';
          h.t = 0;
        }
      } else if (h.st === 'flee') {
        // 逃跑的乘員：一直離開最近的玩家，跑遠了就消失
        h.t += dt;
        sp = RUN;
        if (tp && (h.t < 0.05 || h.sc <= 0)) {
          const dx = h.x - tp.pos.x,
            dz = h.z - tp.pos.z;
          const d = Math.hypot(dx, dz) || 1;
          h.dx = dx / d;
          h.dz = dz / d;
          h.sc = 1.5;
        }
        if (h.t > CREW_K.GONE_T && td > CREW_K.GONE_R) {
          h.alive = false;
          h.gone = true;
          C.mesh.hide(h.i);
          if (this.crowdHost()) this.netEv({ t: 'hgone', i: h.i });
          continue;
        }
      } else if (h.st === 'post' || h.st === 'engage') {
        // 敵方步兵：守在原地；玩家進到射程就轉向、開槍（一部分拿火箭筒），蹲著或站著
        h.st = tp && td < INF_K.RANGE ? 'engage' : 'post';
        if (h.st === 'engage') {
          const ty = Math.atan2(tp.pos.x - h.x, tp.pos.z - h.z);
          let dy = ty - h.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          h.yaw += dy * Math.min(1, dt * 5);
          h.sT -= dt;
          h.rT -= dt;
          const eye = new THREE.Vector3(h.x, h.y + 1.5, h.z);
          if (h.rocket && h.rT <= 0) {
            h.rT = INF_K.ROCKET_DT[0] + rng() * (INF_K.ROCKET_DT[1] - INF_K.ROCKET_DT[0]);
            if (!W.losBlocked(eye, tp.center())) this.crowdRocket(h, tp);
          } else if (h.sT <= 0) {
            h.sT = CREW_K.SHOOT_DT[0] + rng() * (CREW_K.SHOOT_DT[1] - CREW_K.SHOOT_DT[0]) * 1.5;
            if (!W.losBlocked(eye, tp.center())) this.crowdShoot(h, tp);
          }
        } else if (h.sc <= 0) {
          // 站哨：偶爾轉頭
          h.yaw += Math.sin((this.time || 0) * 0.4 + h.i) * dt * 0.3;
        }
      } else if (h.st === 'shoot') {
        // 敵對 AC 的駕駛員：站在原地拿槍射玩家
        if (tp) {
          const ty = Math.atan2(tp.pos.x - h.x, tp.pos.z - h.z);
          let dy = ty - h.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          h.yaw += dy * Math.min(1, dt * 6);
          h.sT -= dt;
          if (h.sT <= 0 && td < CREW_K.SHOOT_R) {
            h.sT = CREW_K.SHOOT_DT[0] + rng() * (CREW_K.SHOOT_DT[1] - CREW_K.SHOOT_DT[0]);
            this.crowdShoot(h, tp);
          }
        }
      } else if (h.st === 'idle') {
        h.t -= dt;
        if (h.t <= 0) {
          // 換一個地方：家附近 10 m 內
          for (let k = 0; k < 4; k++) {
            const a = rng() * Math.PI * 2,
              r = 2 + rng() * 9;
            const x = h.hx + Math.cos(a) * r,
              z = h.hz + Math.sin(a) * r;
            if (this.crowdFree(x, z)) {
              h.tx = x;
              h.tz = z;
              break;
            }
          }
          h.st = 'walk';
          h.t = 10;
          h.work = 0;
        }
      } else if (h.st === 'walk') {
        h.t -= dt;
        const dx = h.tx - h.x,
          dz = h.tz - h.z,
          d = Math.hypot(dx, dz);
        if (d < 0.4 || h.t <= 0) {
          h.st = 'idle';
          h.t = 3 + rng() * 7;
          h.work = rng() < 0.6 ? 1 : 0;
        } else {
          h.dx = dx / d;
          h.dz = dz / d;
          sp = WALK;
        }
      } else if (h.st === 'run') {
        h.t -= dt;
        sp = RUN;
        if (h.t <= 0) {
          h.st = 'hide';
          h.t = 2.5 + rng() * 3;
        }
      } else if (h.st === 'hide') {
        if (h.sc <= 0) h.t -= dt;
        if (h.t <= 0 && h.soldier) {
          h.st = 'engage'; // 步兵：躲完回到戰鬥
          h.hx = h.x;
          h.hz = h.z;
        } else if (h.t <= 0) {
          h.st = 'idle';
          h.t = 2 + rng() * 4;
          // 躲完之後在這裡重新開始（家改成這裡）
          h.hx = h.x;
          h.hz = h.z;
        }
      }
      if (sp > 0 && dt > 0) {
        let nx = h.x + h.dx * sp * dt,
          nz = h.z + h.dz * sp * dt;
        const blocked =
          (W.isVoid && W.isVoid(nx, nz)) ||
          (W.waterDepth && W.waterDepth(nx, nz) > 0.8) ||
          W.groundAt(nx, nz, 999) > h.y + 2.2; // 不鑽到高台、橋面底下
        if (!blocked) {
          const [cx, cz] = W.collide(nx, nz, h.y, 0.35);
          // 被擋住：逃跑時轉個方向，走路時放棄這個目的地
          if (Math.abs(cx - nx) + Math.abs(cz - nz) > 0.01) {
            if (h.st === 'run' || h.st === 'flee') {
              // 換一個走得通的方向（先試偏一點的，再試更偏的）
              const sg = rng() < 0.5 ? 1 : -1,
                ox = h.dx,
                oz = h.dz;
              for (const a of [0.7, -0.7, 1.3, -1.3, 2, -2, 2.8]) {
                const b = a * sg,
                  ux = ox * Math.cos(b) - oz * Math.sin(b),
                  uz = ox * Math.sin(b) + oz * Math.cos(b);
                if (this.crowdFree(h.x + ux * 1.5, h.z + uz * 1.5)) {
                  h.dx = ux;
                  h.dz = uz;
                  break;
                }
              }
            } else h.t = 0;
          }
          nx = cx;
          nz = cz;
        } else if (h.st === 'run' || h.st === 'flee') {
          h.dx = -h.dx;
          h.dz = -h.dz;
          nx = h.x;
          nz = h.z;
        } else {
          h.t = 0;
          nx = h.x;
          nz = h.z;
        }
        h.x = nx;
        h.z = nz;
        h.y = W.groundAt(nx, nz, h.y + 0.6);
        const ty = Math.atan2(h.dx, h.dz);
        let dy = ty - h.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        h.yaw += dy * Math.min(1, dt * 10);
      }
      h.ph += dt * (sp >= RUN ? 11 : sp > 0 ? 6.5 : 0);
      const crT = h.st === 'hide' ? 1 : h.st === 'engage' && h.kneel ? 0.55 : 0;
      h.cr += (crT - h.cr) * Math.min(1, dt * 6);
      const t = this.time || 0;
      C.mesh.pose(
        h.i,
        {
          x: h.x,
          y: h.y,
          z: h.z,
          yaw: h.yaw,
          sw: sp > 0 ? Math.sin(h.ph) : 0,
          run: sp >= RUN ? 1 : 0,
          crouch: h.cr,
          work: h.st === 'idle' && h.work ? 0.6 + 0.4 * Math.sin(t * 5 + h.i) : 0,
          wave: h.st === 'chute' || h.st === 'eject' ? 0.85 : h.st === 'run' && h.i % 3 === 0 ? 0.6 : 0,
          aim: h.st === 'shoot' || h.st === 'engage' ? 1 : 0,
          lean: h.st === 'hide' ? 0.3 : 0,
        },
        h.look.hat !== null,
      );
    }
    C.mesh.commit(C.used);
    this.crowdRocketTick(dt, pls);
    this.crowdBloodTick(dt);
  },
});
