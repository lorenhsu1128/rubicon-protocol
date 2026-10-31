// ============================================================
//  EFFECTS — 加色發光粒子、曳光、衝擊波、塵土、彈殼
// ============================================================
import { SFX } from '../audio/audio.js';
import { rnd } from '../core/math.js';
import { mergeGeos } from '../render/geometry.js';
import { FxBatch } from './batch.js';
import { GpuFx } from './gpu.js';
import { FXC, FXG, pickCell, SOFT, LINE, BEAM } from './atlas.js';
import { emitPreset } from './presets.js';
import { GhostFx } from '../render/ghost.js';
import { ThrusterFx } from './thruster.js';
import { RibbonFx } from './trail.js';
import { MB } from '../core/scale.js';

// 擊破時跪倒崩落的秒數（之後才碎裂）
export const COLLAPSE_T = 0.55;

const FX_BUSY = 400; // 特效數量達到這個數時才略過畫面外的小粒子（一般戰鬥照原本）
const FX_FAR = 70; // 粒子很多時，離鏡頭這麼遠（m）以上的減量
const _skS = new THREE.Sphere(),
  _skV = new THREE.Vector3(),
  _Z = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.sphereGeo = new THREE.SphereGeometry(1, 8, 6);
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.chevGeo = new THREE.ConeGeometry(0.35, 0.7, 3);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    this.discGeo = new THREE.CircleGeometry(1, 20);
    // k：裝飾性的大小與速度（閃光、火花、煙、衝擊環、光束寬、碎片）的倍率；參數照舊尺度傳，這裡乘上。
    // 和判定一致的範圍（預警圈、地面衝擊波、燃燒地面、能量環、斬擊半徑）是世界尺寸，不乘。Game 設定（setK）
    this.k = 1;
    this.light = new THREE.PointLight(0xffc070, 0, 26, 2);
    scene.add(this.light);
    this.lightT = 0;
    this.hitStop = 0;
    this.thruster = new ThrusterFx(scene); // 機甲推進器噴焰粒子
    this.thruster.cull = (p) => this.skip(p, 4);
    this.ribbons = new RibbonFx(scene); // 帶狀軌跡：刀光、地面的推進氣流帶（fx/trail.js）
    this.ghosts = new GhostFx(scene); // 殘影（render/ghost.js，只給玩家自己）
    this.view = null; // 粒子的距離分級（skip／far）：上一格鏡頭的視錐與位置
    this.viewPos = new THREE.Vector3();
    // 顯示卡粒子（fx/gpu.js，docs/vfx-design.md）：產生時寫一次，之後由著色器依 fx.time 算動態。
    // 時鐘 fx.time 只在 update 前進（暫停時粒子停住），clear 歸零
    this.time = 0;
    this.g = {
      sm: new GpuFx(scene, { add: false }), // 煙、塵土（一般混合，先畫）
      gl: new GpuFx(scene), // 閃光、火球、火焰
      ln: new GpuFx(scene, { mode: 'stretch', spd: 0.035, maxL: 1.6 }), // 火花、光束、槍口火焰、刀痕
      rg: new GpuFx(scene, { mode: 'ground' }), // 衝擊環
      dc: new GpuFx(scene, { mode: 'ground', add: false, cap: 64 }), // 焦痕
    };
    this.gList = Object.values(this.g);
    // CPU 的粒子批次（fx/batch.js）：受光的碎片與彈殼、跟著實體的光暈與子彈、突進箭頭
    this.batches = {
      ca: new FxBatch(scene, this.chevGeo), // 突進箭頭
      gl: new FxBatch(scene, this.sphereGeo, { attached: true, renderOrder: 5 }), // 推進器光暈（glareMesh）
      dk: new FxBatch(scene, this.boxGeo, { std: { color: 0x2a2a2a, roughness: 0.9 } }), // 爆炸碎片
      cs: new FxBatch(scene, this.boxGeo, { std: { color: 0xd4a54a, metalness: 0.8, roughness: 0.3 } }), // 彈殼
    };
    this.batchList = Object.values(this.batches);
    this.projPart = this.projPartOf.bind(this); // 傳給 buildProjectileMesh（entities/projectile.js）
  }
  setK(k) {
    this.k = k;
    this.light.distance = 26 * k;
    this.g.ln.uniforms.uMaxL.value = 1.6 * k;
    this.thruster.cull = (p) => this.skip(p, 4);
  }
  // 批次粒子的代理（fx/batch.js）：照一般網格改 position／scale／rotation、material.opacity，加進 list 後由 update 更新
  P(kind, color, opacity = 1) {
    return this.batches[kind].get(color, opacity);
  }
  // 子彈的發光部分（render/extra-models.js 的 buildProjectileMesh 的 part）：依幾何各一個 attached 批次，
  // 代理掛在彈體的群組裡；彈體從場景移除時自動放掉
  projPartOf(geo, color, opacity, parent) {
    const M = this.projB || (this.projB = new Map());
    let b = M.get(geo);
    if (!b) {
      b = new FxBatch(this.scene, geo, { attached: true });
      M.set(geo, b);
      this.batchList.push(b);
    }
    return b.get(color, opacity, parent);
  }
  // 把批次的代理寫進 InstancedMesh（update 結尾與渲染前各一次，update 之後才產生的粒子也畫得到）
  flush() {
    for (const b of this.batchList) b.flush();
    this.thruster.jets.flush();
    for (const g of this.gList) g.update(this.time);
  }
  addM(color, opacity = 1, additive = true) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
  }
  add(mesh, life, fn) {
    if (!mesh.isFxProxy) this.scene.add(mesh);
    this.list.push({ mesh, life, max: life, fn });
    return mesh;
  }
  // 粒子很多時（FX_BUSY 以上）畫面外的小粒子不產生（看不到；房主照樣轉送給客機，各端依自己的鏡頭判斷）。
  // view＝上一格鏡頭的視錐（Game.lodTick 設定，null＝不判斷），r＝粒子會擴散到的範圍
  skip(p, r = 0) {
    if (!this.view || this.busyN() < FX_BUSY) return false;
    _skS.center.copy(p);
    _skS.radius = (4 + r * 1.5) * this.k;
    return !this.view.intersectsSphere(_skS);
  }
  // 粒子很多時離鏡頭 FX_FAR 以上的：火花數減半、細小的煙不產生（viewPos＝鏡頭位置，Game.lodTick 設定）
  far(p) {
    return (
      !!this.view &&
      this.busyN() >= FX_BUSY &&
      this.viewPos.distanceToSquared(p) > FX_FAR * FX_FAR * this.k * this.k
    );
  }
  // 目前的特效數量：CPU 的項目＋顯示卡粒子最近產生的數量（約等於活著的）
  busyN() {
    let n = this.list.length;
    for (const g of this.gList) n += g.load;
    return n;
  }
  flashLight(p, color, intensity) {
    this.light.position.copy(p);
    this.light.color.set(color);
    this.light.intensity = intensity;
    this.lightT = 0.08;
  }
  // bright sphere flash
  flash(p, r, color, life = 0.12) {
    if (this.skip(p, r)) return;
    const rk = r * this.k;
    // 柔邊的圓點：看得到的半徑約是格子的 0.6，所以邊長＝半徑 × 3.3（和舊的球同樣大）
    this.g.gl.emit({ p, life, s0: rk * 2, s1: rk * 4.3, c0: color, a: 0.95, cell: SOFT });
  }
  // spark streaks: elongated additive boxes flying out
  streaks(p, n, color, speed, life = 0.3, grav = 30, dir = null, spread = 1) {
    if (this.skip(p, speed * life * 0.5)) return;
    if (this.far(p)) n = Math.ceil(n / 2);
    const K = this.k;
    speed *= K;
    grav *= K;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1));
      if (dir) v.multiplyScalar(spread).add(dir.clone().multiplyScalar(1.6));
      v.normalize().multiplyScalar(speed * rnd(0.5, 1.3));
      const w = rnd(0.05, 0.1) * K * 3.5; // 直線的格子：看得到的寬度約是邊長的 0.28
      // 沿速度拉長：長度＝寬×0.3＋速度×0.035（上限 1.6 m × k）
      this.g.ln.emit({
        p,
        v,
        life: life * rnd(0.6, 1.2),
        s0: w,
        c0: color,
        cell: LINE,
        fade: 2,
        g: grav,
        asp: 0.3,
      });
    }
  }
  smoke(p, sc = 1, color = 0x5a5e66, life = 1.0, rise = 2) {
    if (this.skip(p, sc + rise * life) || (sc < 0.5 && this.far(p))) return;
    const K = this.k;
    const drift = new THREE.Vector3(rnd(-1, 1), rise, rnd(-1, 1)).multiplyScalar(K);
    // 煙團的貼圖約佔格子的 0.8：邊長＝半徑 × 2.6
    this.g.sm.emit({
      p,
      v: drift,
      life: life * rnd(0.8, 1.2),
      s0: sc * K * 1,
      s1: sc * K * 4.2,
      c0: color,
      a: 0.85,
      cell: pickCell(FXG.smoke),
      fade: 1,
      rot: Math.random() * 6.28,
      rv: rnd(-0.8, 0.8),
    });
  }
  // 沒有網格的計時工作（延遲爆炸、持續冒煙）：fn(e, t, dt) 每格呼叫
  // end：時間到時呼叫一次（clear 清掉時不呼叫）
  task(life, fn, end) {
    this.list.push({ mesh: null, life, max: life, fn, end });
  }
  // 擊破時人形機甲先跪倒崩落（COLLAPSE_T 秒、冒火花），之後才碎裂（end）；動作直接改關節（實體已經不更新）
  collapse(ent, end) {
    const m = ent.model;
    const side = Math.random() < 0.5 ? -1 : 1,
      back = Math.random() < 0.35; // 往後倒（否則往前跪倒）
    const legs = m.legs.map((L) => ({
      L,
      th: L.thigh.rotation.x,
      kn: L.knee.rotation.x,
      ft: L.foot.rotation.x,
      lead: L.side === side,
    }));
    const arms = Object.values(m.arms).map((a) => ({ a, up: a.up.rotation.x, fo: a.fore.rotation.x }));
    const s0 = {
      ly: m.legsG.position.y,
      ty: m.torso.position.y,
      tx: m.torso.rotation.x,
      tz: m.torso.rotation.z,
    };
    const hx = m.head ? m.head.rotation.x : 0;
    const sc = ent.scale || 1;
    let acc = 0;
    const L = (a, b, u) => a + (b - a) * u;
    this.task(
      COLLAPSE_T,
      (e, t, dt) => {
        const u = t * t * (3 - 2 * t);
        for (const g of legs) {
          g.L.thigh.rotation.x = L(g.th, g.lead ? 0.95 : 0.15, u);
          g.L.knee.rotation.x = L(g.kn, g.lead ? -1.35 : -1.7, u);
          g.L.foot.rotation.x = L(g.ft, g.lead ? 0.4 : 1.0, u);
        }
        for (const g of arms) {
          g.a.up.rotation.x = L(g.up, 0.1, u);
          g.a.fore.rotation.x = L(g.fo, 0.5, u);
        }
        m.legsG.position.y = s0.ly - 0.75 * MB * u; // 機甲的建模尺寸（新尺度）
        m.torso.position.y = s0.ty - 0.75 * MB * u;
        m.torso.rotation.x = L(s0.tx, back ? 0.45 : -0.6, u);
        m.torso.rotation.z = L(s0.tz, side * 0.25, u);
        if (m.head) m.head.rotation.x = L(hx, back ? -0.3 : 0.5, u);
        acc += dt;
        if (acc > 0.07) {
          acc = 0;
          const c = ent.center();
          this.streaks(
            c.add(new THREE.Vector3(rnd(-0.6, 0.6), rnd(-0.4, 0.6), rnd(-0.6, 0.6)).multiplyScalar(sc)),
            5,
            0xffc060,
            12,
            0.25,
            10,
          );
        }
      },
      end,
    );
  }
  // 擊破的追加演出（房主與客機各自呼叫，不轉送）：連續的二次爆炸、殘骸冒煙、地面焦痕、強光
  killBurst(p, sc = 1, big = false, groundY = null) {
    const n = big ? 4 : 2,
      K = this.k;
    let k = 0;
    this.task(big ? 0.9 : 0.45, (e, t) => {
      if (t * n < k) return;
      k++;
      const q = p
        .clone()
        .add(new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 1), rnd(-1, 1)).multiplyScalar(1.6 * sc * K));
      this.explosion(q, rnd(2.2, 3.4) * sc, 0xff8030, big);
    });
    this.flashLight(p, 0xffb060, big ? 90 : 45);
    this.lightT = big ? 0.25 : 0.14;
    const gy = groundY == null ? p.y - 2 * K : groundY;
    this.shockwave(
      new THREE.Vector3(p.x, gy + 0.15 * K, p.z),
      9 * sc * (big ? 1.8 : 1),
      0xffd8a0,
      big ? 0.7 : 0.45,
    );
    // 噴發：往上噴的火花與慢慢飄起、閃爍的火星（特效預設 eruption；直接寫進顯示卡粒子，不經過會轉送給客機的 streaks）
    emitPreset(this.g, 'eruption', p, { S: K, n: big ? 2.1 : 1, spd: big ? 1.3 : 1 });
    // 殘骸冒煙：慢慢升起的黑煙柱，幾秒後停
    let acc = 0;
    this.task(big ? 7 : 4.5, (e, t, dt) => {
      acc += dt;
      if (acc < 0.16) return;
      acc = 0;
      const q = new THREE.Vector3(p.x + rnd(-0.6, 0.6) * sc * K, gy + 0.6 * K, p.z + rnd(-0.6, 0.6) * sc * K);
      this.smoke(q, (1.4 + t) * sc, t < 0.2 ? 0x3a3530 : 0x24262a, 2.6, 3.2);
      if (t < 0.4 && Math.random() < 0.35) this.flash(q, 0.7 * sc, 0xff7a20, 0.15);
    });
    // 地面焦痕（平放的焦痕貼圖，維持 8 秒後淡出）
    this.g.dc.emit({
      p: new THREE.Vector3(p.x, gy + 0.08, p.z),
      life: 12,
      s0: 7.4 * sc * K * (big ? 1.6 : 1),
      c0: 0x0c0a08,
      a: 0.8,
      cell: pickCell(FXG.scorch),
      fade: 5,
      rot: Math.random() * 6.28,
    });
  }
  // 蓄力（倒著播）：粒子從半徑 r（舊尺度）的球面往 p 吸進去，在 dur 秒內陸續出發（每次呼叫一小段，跟著槍口移動）；
  // 中心的光核同時變亮。蓄力射擊、雷射蓄力、電磁砲台、Boss 的大招（會轉送給客機）
  gather(p, r, color, dur = 0.2, n = 8) {
    if (this.skip(p, r)) return;
    emitPreset(this.g, 'gather', p, { S: r * this.k, color, n: n / 8, dur });
  }
  // 電弧：電擊的貼圖在 p 附近閃爍（EMP、能量武器命中；r 舊尺度，會轉送給客機）
  arc(p, r, color = 0x9fe0ff) {
    if (this.skip(p, r)) return;
    emitPreset(this.g, 'arc', p, { S: r * this.k, color, n: r > 2 ? 5 / 3 : 1 });
  }
  // 十字星光：彈刀、完美迴避、處決的最後一擊（r 舊尺度，會轉送給客機）
  star(p, r, color = 0xfff0c0) {
    emitPreset(this.g, 'star', p, { S: r * this.k, color });
  }
  // 地圖的持續特效（game/fx-ambient.js）：burn 燃燒的殘骸（黑煙＋火星）、steam 管線的蒸氣、dust 料斗落下的粉塵
  ambient(kind, p) {
    if (this.skip(p, 6)) return;
    emitPreset(this.g, kind, p, { S: this.k });
  }
  // 旋翼的下洗氣流：地面上 (x, gy, z) 往外貼地吹開的沙塵（sc＝機體的縮放、k＝貼近地面的程度 0～1）；只有外觀、不轉送
  downwash(x, gy, z, sc, k) {
    const p = new THREE.Vector3(x, gy + 0.3 * this.k, z);
    if (this.skip(p, 6 * sc)) return;
    emitPreset(this.g, 'downwash', p, { S: sc, n: (2 + k * 3) / 3, spd: 0.5 + k });
  }
  shockwave(p, r, color = 0xffd090, life = 0.4) {
    const rk = r * this.k;
    // 環在格子半徑的 0.82：邊長＝半徑 × 2.44
    this.g.rg.emit({
      p,
      life,
      s0: rk * 0.37,
      s1: rk * 2.8,
      c0: color,
      cell: FXC.ring,
      rot: Math.random() * 6.28,
    });
  }
  explosion(p, r, color = 0xffa040, big = false) {
    this.flash(p, r * 0.32, 0xffffff, 0.08);
    this.flash(p, r * 0.45, color, 0.18);
    const K = this.k;
    // 火球：幾團火焰貼圖由白熱轉成暗紅，往外膨脹、旋轉（特效預設 fireball，fx/presets.js）
    emitPreset(this.g, 'fireball', p, { S: r * K, n: big ? 2 : 1, lifeK: big ? 1.5 : 1 });
    this.shockwave(p.clone().setY(p.y - r * 0.3 * K), r * 1.6, 0xffc080, big ? 0.5 : 0.3);
    this.streaks(p, big ? 26 : 12, 0xffa030, rnd(16, 26) * (big ? 1.5 : 1), big ? 0.9 : 0.5, 32);
    this.streaks(p, big ? 10 : 5, 0xffe0a0, rnd(24, 34), 0.25, 10);
    for (let i = 0; i < (big ? 14 : 6); i++) {
      const s = this.P('dk', 0x2a2a2a);
      s.position.copy(p);
      s.scale.setScalar(rnd(0.1, 0.24) * (big ? 1.6 : 1) * K);
      const v = new THREE.Vector3(rnd(-1, 1), rnd(0.4, 1.6), rnd(-1, 1))
        .normalize()
        .multiplyScalar(rnd(9, 22) * (big ? 1.6 : 1) * K);
      const rv = new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8));
      this.add(s, rnd(0.7, 1.3), (e, t, dt) => {
        v.y -= 34 * K * dt;
        e.mesh.position.addScaledVector(v, dt);
        e.mesh.rotation.x += rv.x * dt;
        e.mesh.rotation.y += rv.y * dt;
        if (t > 0.8) e.mesh.scale.multiplyScalar(0.9);
      });
    }
    for (let i = 0; i < (big ? 8 : 4); i++)
      this.smoke(
        p.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)).multiplyScalar(r * 0.3 * K)),
        r * 0.35 * rnd(0.7, 1.3),
        0x2e3136,
        big ? 1.6 : 1.0,
        2.5,
      );
    this.flashLight(p, color, big ? 40 : 18);
  }
  spark(p, color = 0xffe080, dir = null) {
    this.flash(p, 0.3, 0xffffff, 0.06);
    this.flash(p, 0.28, color, 0.12);
    this.streaks(p, 7, color, rnd(12, 18), 0.3, 30, dir ? dir.clone().negate() : null, 1.2);
    this.smoke(p, 0.35, 0x6a6e75, 0.45, 1.5);
  }
  // kind（第 5 個參數，隨轉送帶給客機；docs/vfx-design.md 第 6 期）：'sg' 霰彈槍＝前方扇形的煙、
  // 'bz' 火箭筒與榴彈＝筒子後方的後焰、'ms' 導彈莢艙＝發射口的小閃光與往後的煙（沒有槍口火焰）
  muzzle(p, dir, color = 0xffd080, size = 1, kind) {
    if (this.skip(p, size)) return;
    const sz = size * this.k;
    if (kind === 'ms') {
      this.g.gl.emit({
        p,
        life: 0.08,
        s0: sz * 1.6,
        s1: sz * 0.8,
        c0: 0xffffff,
        c1: color,
        k: 1.4,
        cell: SOFT,
      });
      emitPreset(this.g, 'bzBlast', p, { S: this.k * size * 0.5, axis: dir.clone().negate(), n: 0.6 });
      return;
    }
    if (kind === 'sg') emitPreset(this.g, 'sgSmoke', p, { S: this.k, axis: dir });
    else if (kind === 'bz')
      emitPreset(this.g, 'bzBlast', p.clone().addScaledVector(dir, -2.2 * this.k), {
        S: this.k,
        axis: dir.clone().negate(),
      });
    this.g.gl.emit({ p, life: 0.06, s0: sz * 1.05, s1: sz * 0.55, c0: 0xffffff, cell: SOFT });
    // 槍口火焰：沿槍管方向從槍口往外（aspect 負的＝一端固定在槍口）
    this.g.ln.emit({
      p,
      life: 0.07,
      s0: sz * 2,
      s1: sz * 2.5,
      c0: 0xffffff,
      c1: color,
      a: 0.95,
      cell: pickCell(FXG.muzzle),
      axis: dir,
      asp: -sz * 2.2,
    });
    if (this.far(p)) return; // 遠處只留閃光
    this.streaks(p, 3, color, 14, 0.14, 4, dir, 0.5);
    this.smoke(p.clone().addScaledVector(dir, 0.6 * this.k), 0.25, 0x8a8e96, 0.4, 1.5);
  }
  empBeam(w, a, b, color) {
    if (!w.beamMesh) {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), this.addM(color, 0.9));
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 6), this.addM(color, 0.18));
      const grp = new THREE.Group();
      grp.add(core);
      grp.add(glow);
      grp.renderOrder = 4;
      this.scene.add(grp);
      w.beamMesh = grp;
      w.beamCore = core;
      w.beamGlow = glow;
    }
    const grp = w.beamMesh;
    grp.visible = true;
    const d = a.distanceTo(b);
    grp.position.copy(a).lerp(b, 0.5);
    grp.lookAt(b);
    grp.rotateX(Math.PI / 2);
    w.beamCore.scale.set(this.k, d, this.k);
    w.beamGlow.scale.set(this.k, d, this.k);
    w.beamGlow.material.opacity = 0.12 + Math.random() * 0.08;
    w.beamHideT = 0.08;
  }
  beam(a, b, color, width = 0.12) {
    const d = a.distanceTo(b);
    const w0 = width;
    width *= this.k;
    const mid = a.clone().lerp(b, 0.5),
      ax = b.clone().sub(a);
    // 光束的格子：中央亮線＋外圈光暈，看得到的寬度約是邊長的 0.3
    this.g.ln.emit({
      p: mid,
      life: 0.2,
      s0: width * 3.4,
      s1: width * 10,
      c0: color,
      a: 0.95,
      cell: BEAM,
      axis: ax,
      asp: d,
    });
    this.g.ln.emit({ p: mid, life: 0.13, s0: width * 1.2, c0: 0xffffff, cell: BEAM, axis: ax, asp: d });
    this.flash(a, w0 * 6, color, 0.1);
    emitPreset(this.g, 'laserGlow', a, { S: this.k * Math.max(1, w0 * 6), color }); // 開火後槍口的餘光
    this.flashLight(a, color, 12);
  }
  chevrons(p, dir, color = 0xffffff) {
    for (let i = 0; i < 6; i++) {
      const c = this.P('ca', color, 0.9);
      const K = this.k;
      c.position.copy(p).addScaledVector(dir, -i * 1.3 * K);
      c.position.y += 0.5 * K;
      c.lookAt(c.position.clone().add(dir));
      c.rotateX(Math.PI / 2);
      c.scale.set(1.2 * K, K, 1.2 * K);
      this.add(c, 0.3 + i * 0.05, (e, t) => {
        e.mesh.material.opacity = 0.9 * (1 - t);
      });
    }
  }
  dust(p, r, n = 8, color = 0x9aa0a8) {
    if (this.skip(p, r * 2)) return;
    const r0 = r;
    r *= this.k;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
      const v = new THREE.Vector3(Math.cos(a) * r * 2.2, rnd(0.5, 1.5) * this.k, Math.sin(a) * r * 2.2);
      this.g.sm.emit({
        p: p.clone().add(new THREE.Vector3(Math.cos(a) * r * 0.3, 0.2 * this.k, Math.sin(a) * r * 0.3)),
        v,
        drag: 3,
        life: rnd(0.5, 0.8),
        s0: r * 0.24,
        s1: r * 0.9,
        c0: color,
        a: 0.7,
        cell: pickCell(FXG.smoke),
        rot: Math.random() * 6.28,
        rv: rnd(-1, 1),
      });
    }
    this.shockwave(p.clone().setY(p.y + 0.1), r0 * 1.2, 0xffffff, 0.25);
  }
  casing(p, side, dir) {
    if (this.skip(p, 3)) return;
    const s = this.P('cs', 0xd4a54a);
    s.position.copy(p);
    const K = this.k;
    s.scale.set(0.05 * K, 0.05 * K, 0.14 * K);
    const right = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side);
    const v = right
      .multiplyScalar(rnd(3, 5))
      .add(new THREE.Vector3(0, rnd(4, 6), 0))
      .multiplyScalar(K);
    const rv = rnd(10, 25);
    this.add(s, 1.2, (e, t, dt) => {
      v.y -= 30 * K * dt;
      e.mesh.position.addScaledVector(v, dt);
      e.mesh.rotation.x += rv * dt;
      e.mesh.rotation.z += rv * 0.5 * dt;
    });
  }
  boostFlame(p, dir, color) {
    if (this.skip(p, 1)) return;
    const K = this.k;
    this.g.gl.emit({
      p,
      v: dir.clone().multiplyScalar(6 * K),
      life: 0.18,
      s0: 1.3 * K,
      s1: 0.17 * K,
      c0: color,
      a: 0.7,
      cell: SOFT,
    });
  }
  ring(p, r, color) {
    this.shockwave(p, r, color, 0.5);
  }
  // 地面衝擊波：中心先閃紅色預警 dl 秒，再以 sp m/s 擴散到半徑 R 的光牆，沿地形起伏（ground(x, z) 回傳地面高度）；
  // R、sp 是世界尺寸（和判定一致）
  groundWave(p, R, sp, dl, ground, color = 0xff8a3a) {
    const K = this.k;
    const warn = new THREE.Mesh(this.discGeo, this.addM(0xff3020, 0.5));
    warn.rotation.x = -Math.PI / 2;
    warn.position.copy(p).setY(p.y + 0.15);
    this.add(warn, dl, (e, t) => {
      e.mesh.scale.setScalar((3 + t * 5) * K);
      e.mesh.material.opacity = 0.2 + 0.4 * Math.abs(Math.sin(t * dl * 12));
    });
    const N = 72;
    const pos = new Float32Array((N + 1) * 6);
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = this.addM(color, 0.85);
    mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    const life = dl + R / sp;
    this.add(m, life, (e, t) => {
      const el = t * life - dl;
      if (el < 0) return;
      if (!m.visible) {
        m.visible = true;
        SFX.explode(true, p);
        this.shockwave(p.clone().setY(p.y + 0.2), 8, 0xffc080, 0.4);
        this.dust(p.clone(), 4, 14);
      }
      const r = Math.max(0.5 * K, el * sp),
        h = 1.8 * K * (1 - (0.5 * r) / R);
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r,
          z = p.z + Math.sin(a) * r;
        const y = ground(x, z);
        pos.set([x, y + 0.05, z, x, y + h, z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.85 * (1 - r / R);
    });
  }
  // 落點預警（迫擊砲）：紅色外圈＋由內往外填滿的圓，dl 秒後填滿，接近落地時閃得更快；R 是世界尺寸（和判定一致）
  warnCircle(p, R, dl, color = 0xff3020) {
    const grp = new THREE.Group();
    grp.position.copy(p).setY(p.y + 0.12);
    const ring = new THREE.Mesh(this.ringGeo, this.addM(color, 0.8));
    ring.material.side = THREE.DoubleSide;
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(R);
    const fill = new THREE.Mesh(this.discGeo, this.addM(color, 0.3));
    fill.rotation.x = -Math.PI / 2;
    grp.add(ring, fill);
    this.add(grp, dl, (e, t) => {
      fill.scale.setScalar(Math.max(0.01, R * t));
      const f = 4 + t * 14;
      ring.material.opacity = 0.3 + 0.3 * Math.abs(Math.sin(t * dl * f));
      fill.material.opacity = 0.18 + 0.2 * t;
    });
  }
  // 瞄準／路徑預警線：a→b 的細光束閃爍 dl 秒（雷射扇形、衝刺路線）
  warnLine(a, b, dl, color = 0xff2020, width = 0.06) {
    const d = a.distanceTo(b);
    if (d < 0.01) return;
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(width * this.k, width * this.k, d, 5),
      this.addM(color, 0.7),
    );
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    m.rotateX(Math.PI / 2);
    m.renderOrder = 4;
    this.add(m, dl, (e, t) => {
      e.mesh.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(t * dl * (6 + t * 16)));
      e.mesh.scale.x = e.mesh.scale.z = 1 + t * 1.5;
    });
  }
  // 地面的長方形預警（衝撞路線、進場路線、格子砲擊）：中心 c、朝向 yaw（長邊沿 −Z）、寬 w、長 l（世界尺寸）
  warnRect(c, yaw, w, l, dl, color = 0xff3020) {
    const grp = new THREE.Group();
    grp.position.copy(c).setY(c.y + 0.14);
    grp.rotation.y = yaw;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, l), this.addM(color, 0.2));
    fill.rotation.x = -Math.PI / 2;
    fill.material.side = THREE.DoubleSide;
    const edgeM = this.addM(color, 0.8);
    for (const s of [-1, 1]) {
      const e1 = new THREE.Mesh(this.boxGeo, edgeM);
      e1.scale.set(0.18 * this.k, 0.05 * this.k, l);
      e1.position.x = (s * w) / 2;
      const e2 = new THREE.Mesh(this.boxGeo, edgeM);
      e2.scale.set(w, 0.05 * this.k, 0.18 * this.k);
      e2.position.z = (s * l) / 2;
      grp.add(e1, e2);
    }
    grp.add(fill);
    this.add(grp, dl, (e, t) => {
      fill.material.opacity = 0.12 + 0.22 * t;
      edgeM.opacity = 0.35 + 0.45 * Math.abs(Math.sin(t * dl * (5 + t * 12)));
    });
  }
  // 擴散的能量球殼（脈衝刃翼）：以 sp m/s 擴散到半徑 R（世界尺寸）
  pulseShell(c, R, sp, color = 0xff5070) {
    const life = R / sp;
    const m = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.35));
    m.material.side = THREE.DoubleSide;
    m.position.copy(c);
    m.renderOrder = 4;
    const ring = new THREE.Mesh(this.ringGeo, this.addM(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(c);
    this.add(m, life, (e, t) => {
      e.mesh.scale.setScalar(Math.max(0.3, R * t));
      e.mesh.material.opacity = 0.32 * (1 - t * 0.7);
    });
    this.add(ring, life, (e, t) => {
      e.mesh.scale.setScalar(Math.max(0.3, R * t));
      e.mesh.material.opacity = 0.9 * (1 - t * 0.6);
    });
    this.flash(c, 3, color, 0.2);
  }
  // 燃燒的地面（熔渣）：半徑 R（世界尺寸）、持續 life 秒，火苗與煙
  // kind：0 燃燒地面、1 腐蝕區（綠色）
  firePool(p, R, life, kind = 0) {
    const C =
      kind === 1
        ? [0x6aa820, 0xc8ff50, 0x9aff40, 0x5a8a20, 0x3a4a2a]
        : [0xff5a10, 0xffc040, 0xff7a20, 0xffb040, 0x3a3430];
    const grp = new THREE.Group();
    grp.position.copy(p).setY(p.y + 0.1);
    const disc = new THREE.Mesh(this.discGeo, this.addM(C[0], 0.55));
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(R);
    const core = new THREE.Mesh(this.discGeo, this.addM(C[1], 0.5));
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.02;
    core.scale.setScalar(R * 0.55);
    grp.add(disc, core);
    let acc = 0;
    this.add(grp, life, (e, t, dt) => {
      const fade = t < 0.85 ? 1 : (1 - t) / 0.15;
      disc.material.opacity = (0.4 + 0.15 * Math.sin(t * life * 9)) * fade;
      core.material.opacity = (0.35 + 0.2 * Math.sin(t * life * 13 + 1)) * fade;
      acc += dt;
      if (acc > 0.06 && fade > 0.3) {
        acc = 0;
        const a = Math.random() * Math.PI * 2,
          r = Math.random() * R * 0.85;
        const K = this.k;
        const q = p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3 * K, Math.sin(a) * r));
        // 火苗：直立的火舌貼圖往上飄、縮小
        this.g.gl.emit({
          p: q,
          v: new THREE.Vector3(0, rnd(2.5, 4.5) * K, 0),
          life: rnd(0.5, 0.8),
          s0: 2.6 * K,
          s1: 0.5 * K,
          c0: C[1],
          c1: Math.random() < 0.5 ? C[2] : C[3],
          a: 0.85,
          occ: 0.4,
          cell: pickCell(FXG.tongue),
        });
        if (Math.random() < 0.15) this.smoke(q.clone().setY(q.y + K), 0.9, C[4], 1.2, 3);
      }
    });
  }
  // 火焰噴射：從 p 沿 dir 噴出 len 公尺（世界尺寸）、半角 ang 的火焰粒子
  flameCone(p, dir, len, ang, n = 10) {
    const K = this.k;
    for (let i = 0; i < n; i++) {
      const v = dir
        .clone()
        .add(new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 0.6), rnd(-1, 1)).multiplyScalar(Math.tan(ang)))
        .normalize()
        .multiplyScalar(len * rnd(1.6, 2.4));
      this.g.gl.emit({
        p,
        v,
        life: 0.45,
        s0: 0.8 * K,
        s1: 4.6 * K,
        c0: 0xffe0a0,
        c1: Math.random() < 0.6 ? 0xa02800 : 0xc06000,
        a: 0.85,
        occ: 0.45,
        cell: pickCell(FXG.fire),
        rot: Math.random() * 6.28,
        rv: rnd(-3, 3),
      });
    }
  }
  // 天上落下的光柱（衛星砲的格子砲擊）：p 是地面點、R 世界尺寸
  pillarStrike(p, R, color = 0x9fe8ff) {
    const K = this.k;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 80 * K, 14, 1, true), this.addM(color, 0.8));
    m.material.side = THREE.DoubleSide;
    m.position.copy(p).setY(p.y + 40 * K);
    this.add(m, 0.5, (e, t) => {
      e.mesh.scale.x = e.mesh.scale.z = 1 - t * 0.7;
      e.mesh.material.opacity = 0.8 * (1 - t);
    });
    const c = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.4, R * 0.4, 80 * K, 8, 1, true),
      this.addM(0xffffff, 1),
    );
    c.position.copy(m.position);
    this.add(c, 0.3, (e, t) => {
      e.mesh.material.opacity = 1 - t;
    });
    this.shockwave(p.clone().setY(p.y + 0.2), (R * 2.2) / K, color, 0.4);
    this.flashLight(p.clone().setY(p.y + 3 * K), color, 30);
  }
  // big additive thruster glare (billboard sphere) — used every frame by mechs, pooled per entity
  // 批次的代理（fx/batch.js 的 attached）：掛在場景裡，別處照舊 scene.remove／visible／position／scale／material.opacity
  // owner：所屬的實體（戰爭迷霧裡看不到時不畫）
  glareMesh(color, owner = null) {
    return this.batches.gl.get(color, 0.55, null, owner);
  }
  // ---- 機體支離破碎：把每個關節節點的網格拆成獨立碎片，給予初速、角速度、重力、地面反彈 ----
  shatter(ent, world) {
    // 合併過的網格（render/mesh-merge.js 的 mergeRig）先還原成各關節底下的網格，才拆得成碎片
    if (ent.model.unmerge) ent.model.unmerge();
    const root = ent.model.group;
    root.updateMatrixWorld(true);
    const center = ent.center();
    const pieces = [];
    const nodes = [];
    // 程式模型的網格掛在群組上；GLB 的網格可能掛在一般節點（Object3D）上，且網格本身帶有位移
    root.traverse((o) => {
      if ((o.isGroup || o.type === 'Object3D') && o.children.some((c) => c.isMesh)) nodes.push(o);
    });
    for (const n of nodes) {
      const g = new THREE.Group();
      n.matrixWorld.decompose(g.position, g.quaternion, g.scale);
      const meshes = n.children.filter((c) => c.isMesh && c.material.blending !== THREE.AdditiveBlending);
      for (const m of meshes) {
        n.remove(m);
        g.add(m); // 碎片群組＝原節點的世界變換，網格保留自己的區域變換
      }
      // sub-groups (e.g. weapons under hand) are handled as their own nodes; flames are not meshes so they vanish with the root
      this.scene.add(g);
      const pc = new THREE.Vector3();
      g.getWorldPosition(pc);
      const K = this.k;
      const dir = pc.clone().sub(center);
      dir.y += 0.6 * K;
      if (dir.lengthSq() < 0.01) dir.set(rnd(-1, 1), 1, rnd(-1, 1));
      dir.normalize();
      const v = dir
        .multiplyScalar(rnd(5, 13) * (ent.isBoss ? 1.4 : 1))
        .add(new THREE.Vector3(rnd(-2, 2), rnd(4, 11), rnd(-2, 2)))
        .multiplyScalar(K);
      const av = new THREE.Vector3(rnd(-7, 7), rnd(-7, 7), rnd(-7, 7));
      const burning = Math.random() < 0.35;
      let rest = false;
      let smokeT = 0;
      pieces.push(g);
      this.list.push({
        mesh: g,
        life: 9 + Math.random() * 2,
        max: 11,
        fn: (e, t, dt) => {
          if (!rest) {
            v.y -= 34 * K * dt;
            g.position.addScaledVector(v, dt);
            g.rotation.x += av.x * dt;
            g.rotation.y += av.y * dt;
            g.rotation.z += av.z * dt;
            const gy = world.terrainHeight(g.position.x, g.position.z) + 0.35 * K;
            if (g.position.y < gy) {
              g.position.y = gy;
              if (Math.abs(v.y) < 3 * K) {
                rest = true;
              } else {
                v.y *= -0.35;
                v.x *= 0.55;
                v.z *= 0.55;
                av.multiplyScalar(0.5);
                this.dust(g.position.clone().setY(gy - 0.3 * K), 1.2, 5);
                if (Math.random() < 0.5) this.streaks(g.position, 4, 0xffc050, 10, 0.3, 20);
              }
            }
          }
          if (burning) {
            smokeT += dt;
            if (smokeT > 0.12) {
              smokeT = 0;
              this.smoke(g.position.clone(), 0.7, 0x3a3d44, 1.2, 2.2);
              if (Math.random() < 0.5)
                this.boostFlame(
                  g.position
                    .clone()
                    .add(new THREE.Vector3(rnd(-0.3, 0.3), 0.2, rnd(-0.3, 0.3)).multiplyScalar(K)),
                  new THREE.Vector3(0, 1, 0),
                  0xff8030,
                );
            }
          }
          if (t > 0.85) {
            g.position.y -= dt * 0.8 * K;
          } // sink away at the end
        },
      });
    }
    // secondary detonations + big flash
    this.explosion(center, ent.isBoss ? 12 : 5, 0xffa040, true);
    this.flashLight(center, 0xffc060, ent.isBoss ? 60 : 30);
    // 依遊戲時間（fx.task）排程，不用 setTimeout：暫停時不會繼續爆，也不會在實際時間的空檔取用亂數
    // （遊戲邏輯共用同一個亂數串；冒煙測試快轉模擬時，結果會依實際經過的時間不同）
    const nB = ent.isBoss ? 8 : 3,
      step = ent.isBoss ? 0.16 : 0.11;
    let k = 0;
    this.task(nB * step + 0.08, (e, t) => {
      const el = t * e.max;
      while (k < nB && el >= (k + 1) * step) {
        k++;
        const p = center
          .clone()
          .add(new THREE.Vector3(rnd(-3, 3), rnd(-1, 3), rnd(-3, 3)).multiplyScalar(this.k));
        this.explosion(p, ent.isBoss ? 6 : 2.6, 0xff7030, ent.isBoss);
      }
    });
    return pieces;
  }
  // 斬擊的弧（XZ 平面、朝 yaw）；radius 是世界尺寸（呼叫端已乘機體的 scale）
  slash(center, yaw, arcDeg, radius, color, mirror = false, tilt = 0.35, dur = 0.22, spin = false) {
    const len = THREE.MathUtils.degToRad(arcDeg);
    const start = spin ? 0 : -len / 2;
    const mk = (inner, outer, col, op) =>
      new THREE.Mesh(new THREE.RingGeometry(inner, outer, 28, 1, start, len), this.addM(col, op));
    const grp = new THREE.Group();
    grp.position.copy(center);
    grp.rotation.order = 'YXZ';
    grp.rotation.y = yaw + Math.PI / 2;
    grp.rotation.x = -Math.PI / 2 + (mirror ? -tilt : tilt);
    const a = mk(radius * 0.55, radius, color, 0.85),
      b = mk(radius * 0.82, radius * 0.92, 0xffe0c0, 0.8);
    a.material.blending = THREE.NormalBlending;
    a.material.side = b.material.side = THREE.DoubleSide;
    grp.add(a);
    grp.add(b);
    this.scene.add(grp);
    this.list.push({
      mesh: grp,
      life: dur,
      max: dur,
      fn: (e, t) => {
        e.mesh.scale.setScalar(0.7 + t * 0.5);
        a.material.opacity = 0.85 * (1 - t * t);
        b.material.opacity = 0.8 * (1 - t);
        e.mesh.rotation.z = (mirror ? 1 : -1) * (spin ? t * Math.PI * 2 : t * len * 0.8);
      },
    });
    this.streaks(
      center.clone().add(new THREE.Vector3(-Math.sin(yaw), 0.3, -Math.cos(yaw)).multiplyScalar(radius * 0.6)),
      6,
      color,
      16,
      0.25,
      10,
    );
    this.flashLight(center, color, 10);
  }
  // 近戰命中：o.sw＝揮的方向（刀痕的角度：'h' 橫斬、'hm' 反手、'u' 上挑、'v' 往下砸、't' 突刺、's' 迴旋），
  // o.s＝頓格秒數與 o.r＝範圍（客機用 onMeleeStop 讓附近的機體一起停住）
  meleeHit(p, color, big, dir, o) {
    o = o || {};
    if (o.s && this.onMeleeStop) this.onMeleeStop(p, o.s, o.r || 0);
    this.flash(p, big ? 0.9 : 0.5, 0xffffff, 0.06);
    this.flash(p, big ? 1.6 : 1.1, color, 0.22);
    // 刀痕：依揮的方向（Euler YXZ：先俯仰再偏航，長邊是本地 z）
    const yaw = dir && dir.x !== undefined ? Math.atan2(dir.x, dir.z) : 0;
    const sw = o.sw || 'h';
    const tilt = (Math.random() - 0.5) * 0.3;
    let pitch = 0.6 * (Math.random() < 0.5 ? 1 : -1),
      ry = yaw + Math.PI / 2,
      len = 1,
      mv = null; // 刀痕移動的方向（往上挑、往下砸）
    if (sw === 'h') pitch = -0.35 + tilt;
    else if (sw === 'hm') pitch = 0.35 + tilt;
    else if (sw === 's') pitch = tilt * 0.3;
    else if (sw === 'u' || sw === 'v') {
      pitch = Math.PI / 2 + tilt;
      mv = sw === 'u' ? 1 : -1;
    } else if (sw === 't') {
      pitch = tilt;
      ry = yaw;
      len = 0.75;
    }
    const K = this.k;
    // 刀痕的長邊＝本地 z 轉到世界；沿它拉長、面向鏡頭（往上挑、往下砸時整條往上下移）
    const axis = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(pitch, ry, 0, 'YXZ'));
    const v = mv ? new THREE.Vector3(0, (mv * 1.6 * K) / 0.3, 0) : null;
    const L = (big ? 6 : 4.2) * len * K;
    this.g.ln.emit({
      p,
      v,
      life: 0.28,
      s0: 0.42 * K,
      s1: 0.75 * K,
      c0: 0xffffff,
      cell: LINE,
      fade: 2,
      axis,
      asp: L,
    });
    this.g.ln.emit({
      p,
      v,
      life: 0.32,
      s0: 1.2 * K,
      s1: 2.3 * K,
      c0: color,
      a: 0.9,
      cell: LINE,
      axis,
      asp: L * 1.1,
    });
    if (sw === 't') this.shockwave(p, big ? 3.5 : 2.2, 0xffffff, 0.18); // 突刺：貫穿的小衝擊環
    this.shockwave(p.clone().setY(p.y - K), big ? 5 : 3, color, 0.3);
    this.streaks(p, big ? 24 : 12, color, big ? 26 : 18, 0.35, 24);
    this.streaks(p, big ? 8 : 4, 0xffffff, 30, 0.2, 8);
    if (big) {
      this.shockwave(p, 6, color, 0.4);
      this.smoke(p, 1.4, 0x4a4e55, 0.9, 2);
    }
  }
  update(dt) {
    this.time += dt;
    if (this.time > 2000) {
      // float 精度：時鐘與所有粒子的產生時間一起往回平移
      for (const g of this.gList) g.rebase(1900);
      this.time -= 1900;
    }
    for (const g of this.gList) g.update(this.time, dt);
    this.thruster.update(dt);
    this.ribbons.update(dt);
    this.ghosts.update(dt);
    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
      else this.light.intensity *= 0.8;
    }
    // 一次走完並就地壓縮（大量粒子時逐一 splice 是 O(n²)）；這一格 fn 裡新加的項目留到下一格才更新
    const L = this.list,
      n = L.length;
    let j = 0;
    for (let i = 0; i < n; i++) {
      const e = L[i];
      e.life -= dt;
      if (e.life <= 0) {
        if (e.mesh) this.dispose(e.mesh);
        if (e.end) e.end();
        continue;
      }
      e.fn(e, 1 - e.life / e.max, dt);
      L[j++] = e;
    }
    if (this.list !== L) return this.flush(); // fn 裡呼叫了 clear()
    for (let i = n; i < L.length; i++) L[j++] = L[i];
    L.length = j;
    this.flush();
  }
  // 移除到期的特效網格並釋放材質與（非共用的）幾何
  dispose(mesh) {
    if (mesh.isFxProxy) {
      if (mesh.fxBatch) mesh.fxBatch.release(mesh);
      return;
    }
    if (mesh.parent) mesh.parent.remove(mesh);
    const keep =
      this.keepGeos ||
      (this.keepGeos = new Set([this.sphereGeo, this.boxGeo, this.chevGeo, this.ringGeo, this.discGeo]));
    mesh.traverse((o) => {
      if (o.material) o.material.dispose();
      if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    });
  }
  clear() {
    for (const e of this.list) if (e.mesh && !e.mesh.isFxProxy) this.scene.remove(e.mesh);
    this.list = [];
    for (const b of this.batchList) b.clear();
    for (const g of this.gList) g.clear();
    this.time = 0;
    this.light.intensity = 0;
    this.thruster.clear();
    this.ribbons.clear();
    this.ghosts.clear();
  }
}

// ---------- 特效：物件與車輛碎裂（碎片落地後合併成一個網格、永久保留） ----------
Object.assign(Effects.prototype, {
  debrisPieces(list, color, persist) {
    const scene = this.scene;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.2, flatShading: true });
    const pieces = [];
    for (const d of list) {
      const m = new THREE.Mesh(d.geo, mat);
      m.position.copy(d.pos);
      m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      m.castShadow = true;
      scene.add(m);
      const v = d.pos
        .clone()
        .sub(d.origin)
        .normalize()
        .multiplyScalar(rnd(4, 10))
        .add(new THREE.Vector3(rnd(-2, 2), rnd(5, 11), rnd(-2, 2)))
        .multiplyScalar(this.k);
      const av = new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
      pieces.push({ m, v, av, rest: false });
    }
    const world = persist.world,
      K = this.k;
    let done = false;
    this.list.push({
      mesh: null,
      life: 6,
      max: 6,
      fn: (e, t, dt) => {
        let all = true;
        for (const p of pieces) {
          if (p.rest) continue;
          all = false;
          p.v.y -= 34 * K * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += p.av.x * dt;
          p.m.rotation.y += p.av.y * dt;
          p.m.rotation.z += p.av.z * dt;
          const gy = world.terrainHeight(p.m.position.x, p.m.position.z) + 0.25;
          if (p.m.position.y < gy) {
            p.m.position.y = gy;
            if (Math.abs(p.v.y) < 2.5 * K) {
              p.rest = true;
            } else {
              p.v.y *= -0.35;
              p.v.x *= 0.5;
              p.v.z *= 0.5;
              p.av.multiplyScalar(0.5);
            }
          }
        }
        if ((all || t > 0.95) && !done) {
          done = true; // 合併成單一網格並永久保留
          const geos = [];
          for (const p of pieces) {
            p.m.updateMatrixWorld(true);
            geos.push({ geo: p.m.geometry, mm: p.m.matrixWorld.clone() });
            scene.remove(p.m);
          }
          const merged = mergeGeos(geos);
          if (merged) {
            const mm = new THREE.Mesh(merged, mat);
            mm.castShadow = true;
            mm.receiveShadow = true;
            scene.add(mm);
            if (world.meshes) world.meshes.push(mm);
          }
        }
      },
    });
  },
  shatterProp(p, world) {
    const c = p.center();
    const list = [];
    const ob = p.ob;
    const origin = c.clone();
    const K = p.kind;
    if (K === 'container' || K === 'pillarBlock' || K === 'truck') {
      const size = ob.box ? ob.box.getSize(new THREE.Vector3()) : new THREE.Vector3(3, 2.4, 7);
      const n = K === 'pillarBlock' ? 14 : 12;
      for (let i = 0; i < n; i++) {
        const w = rnd(0.6, 1.8) * Math.max(0.6, size.x / 4),
          h = rnd(0.1, 0.35),
          d = rnd(0.6, 1.8) * Math.max(0.6, size.z / 4);
        list.push({
          geo: new THREE.BoxGeometry(w, h, d),
          pos: c
            .clone()
            .add(
              new THREE.Vector3(
                rnd(-size.x / 2, size.x / 2),
                rnd(-size.y / 2, size.y / 2),
                rnd(-size.z / 2, size.z / 2),
              ),
            ),
          origin,
        });
      }
    } else if (K === 'rock') {
      for (let i = 0; i < 10; i++) {
        list.push({
          geo: new THREE.DodecahedronGeometry(rnd(0.4, 1.1), 0),
          pos: c.clone().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-1.5, 1.5))),
          origin,
        });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        list.push({
          geo: new THREE.BoxGeometry(0.6, rnd(0.8, 1.6), 0.6),
          pos: c.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-2, 2), rnd(-0.3, 0.3))),
          origin,
        });
      }
    }
    this.explosion(c, K === 'rock' ? 3 : 2.5, K === 'rock' ? 0xc0b090 : 0xffa040, false);
    this.dust(c.clone().setY(world.terrainHeight(c.x, c.z) + 0.1), 3, 8);
    SFX.explode(false, c);
    this.debrisPieces(list, p.color, { world });
  },
  shatterVehicle(v) {
    const world = v.game.world;
    const list = [];
    for (let i = 0; i < v.cars; i++) {
      const cp = v.carPos(i).add(new THREE.Vector3(0, 1.5, 0));
      for (let k = 0; k < 8; k++)
        list.push({
          geo: new THREE.BoxGeometry(rnd(0.6, 2.2), rnd(0.15, 0.5), rnd(0.8, 2.4)),
          pos: cp.clone().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-3, 3))),
          origin: cp,
        });
    }
    this.debrisPieces(list, v.kind === 'train' ? 0x4a4a44 : 0x2b4a8a, { world });
  },
});
