// 第 1 章 荒野的訊號（西部對決） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch1.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c1 開頭，避免和別章重複。
//
// 這一章用到的：
//   hook c1ecu      對決的大特寫：鏡頭貼著演員的頭（眼燈）或武器（S.ecu）
//   hook c1antenna  半埋在沙裡的舊天線，紅燈一明一滅
//   hook c1fire     營火（木柴、火焰、閃爍的光）
//   ov   c1sand     飛沙橫過畫面
//   ov   c1glint    眼燈的星芒（S.glint）
//   ov   c1scope    BASTILLE 的砲台瞄準鏡
//   ov   c1pulse    天線的訊號圈
//   ov   c1title    西部片的大字章名（S.title）
//   ov   c1chan     攔截到的頻道標籤（S.chans）
//   ov   c1stars    星空與軌道站的光點（S.stars）
//   render c1heat   熱浪：畫完之後把地平線一帶的橫條左右錯開
import { clamp } from '../core/math.js';
import { SPEAKERS } from '../data/story.js';
import { Game } from './game.js';

const V3 = () => new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (u) => u * u * (3 - 2 * u);
// 固定的亂數（每格畫一樣的星星、沙粒）
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const FACTION = {
  castron: '卡斯特隆重工',
  aetheric: '艾瑟立克',
  veerwell: '維爾威',
  sancta: '聖域',
};

Object.assign(Game.prototype, {
  // 這一章自己加進場景的物件：換鏡頭、跳時間時清乾淨（cineSeek 不會呼叫上一鏡的 exit）
  c1Keep(key, obj) {
    const m = (this.c1Objs = this.c1Objs || {});
    this.c1Drop(key);
    m[key] = obj;
    this.scene.add(obj.group);
  },
  c1Drop(key) {
    const m = this.c1Objs;
    if (!m || !m[key]) return;
    const o = m[key];
    if (o.group.parent) o.group.parent.remove(o.group);
    o.group.traverse((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) [].concat(n.material).forEach((mt) => mt.dispose());
    });
    delete m[key];
  },
  // ---------- 空曠的荒野 ----------
  // S.bare＝半徑（m）：把場景原點附近的地圖物件藏起來（地形、公路、遠景照舊），西部片要的是空無一物的地平線。
  // 同一張地圖只做一次（換地圖時整張重建，藏起來的物件跟著丟掉）；碰撞一起拿掉
  cineHook_c1bare(S, phase) {
    if (phase !== 'enter' || !this.world || this.c1BareW === this.world) return;
    this.c1BareW = this.world;
    const A = this.cinePt([0, 0, 0]);
    const R = S.bare || 90;
    const box = new THREE.Box3(),
      sz = V3(),
      ct = V3();
    const w = this.world;
    const hid = new Set();
    for (const g of w.meshes || []) {
      // 地形、水面留著；遠景（noFade）只藏小的剪影物件（柵欄、管線段），遠景地形留著
      if (!g || !g.visible || g === w.terrainMesh || g === w.waterMesh) continue;
      box.setFromObject(g);
      if (box.isEmpty()) continue;
      box.getSize(sz);
      box.getCenter(ct);
      if (g.userData && g.userData.noFade && Math.max(sz.x, sz.z) > 40) continue;
      // 中心在半徑內，或是橫跨過來的長物件（管線、公路）
      const d = Math.hypot(ct.x - A.x, ct.z - A.z);
      if (d < R || (Math.max(sz.x, sz.z) > 60 && d < R + Math.max(sz.x, sz.z) / 2)) {
        g.visible = false;
        hid.add(g);
      }
    }
    // 藏起來的物件也拿掉碰撞：演員不會撞上看不見的牆，也不會踩碎它而噴出碎片
    w.obstacles = w.obstacles.filter((o) => !(o.group && hid.has(o.group)));
  },
  // 清掉前一段留下的特效（同一張地圖換到別的段落時，遠處的爆炸碎片、煙不要跟進來）
  cineHook_c1fxclear(S, phase) {
    if (phase === 'enter' && this.fx) this.fx.clear();
  },
  // ---------- 跪著 ----------
  // S.kneel＝{ 演員: [往下沉（m）, 前後傾（弧度，負＝往前）] }：每格在模擬之後直接設定（不累加），
  // 所以暫停、跳時間都停在同一個姿勢
  cineHook_c1kneel(S, phase) {
    if (phase !== 'tick' || !S.kneel) return;
    for (const id in S.kneel) {
      const A = this.cine.actors.get(id);
      if (!A || !A.e || A.e.dead) continue;
      const [dy, tilt] = S.kneel[id];
      const m = A.e.mesh;
      m.position.y = A.e.pos.y - dy * (A.e.scale || 1);
      m.rotation.x = tilt;
      m.updateMatrixWorld(true);
    }
  },
  // 機體某個部位的外框中心（頭＝head 群組、武器槽＝那隻手臂的武器）：機體大小、零件、GLB 不同也對得準
  c1PartCenter(e, part) {
    const M = e.model;
    if (!M) return null;
    let g = null;
    if (part === 'head') g = M.head;
    else if (M.arms) {
      const arm = M.arms[part === 'larm' || part === 'lback' ? 'l' : 'r'];
      g = arm && (part.endsWith('back') ? arm.back : arm.weapon || arm.hand);
    }
    if (!g) return null;
    const box = new THREE.Box3().setFromObject(g);
    if (box.isEmpty()) return g.getWorldPosition(V3());
    return box.getCenter(V3());
  },
  // ---------- 大特寫（對決） ----------
  // S.ecu＝{ a: 演員, part: 'head'｜武器槽, o: [x, y, z]（依演員朝向）, o1: 結束時的 o, l: 注視點的偏移, fov }
  cineHook_c1ecu(S, phase, lt) {
    if (phase !== 'tick' || !S.ecu) return;
    const c = this.cine,
      E = S.ecu;
    const A = c.actors.get(E.a);
    if (!A || !A.e) return;
    const e = A.e;
    const base = this.c1PartCenter(e, E.part);
    if (!base) return;
    const next = c.def.shots[c.shot + 1];
    const dur = (next ? next.at : c.def.dur) - S.at;
    const u = clamp(lt / Math.max(0.1, dur), 0, 1);
    const o = E.o1 ? E.o.map((v, i) => v + (E.o1[i] - v) * u) : E.o;
    const cam = this.camera;
    cam.position.copy(base).add(new THREE.Vector3(...o).applyAxisAngle(UP, e.yaw));
    const look = base.clone().add(new THREE.Vector3(...(E.l || [0, 0, 0])).applyAxisAngle(UP, e.yaw));
    c.look.copy(look);
    // 極輕的手持晃動（長焦鏡頭）
    const t = c.t;
    cam.lookAt(look);
    cam.translateX(Math.sin(t * 1.9) * 0.012);
    cam.translateY(Math.sin(t * 2.3 + 1) * 0.01);
    if (E.fov && Math.abs(cam.fov - E.fov) > 0.01) {
      cam.fov = E.fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    if (S.cam && S.cam.dof) {
      c.P.dofF = cam.position.distanceTo(look);
      c.P.dofR = Math.max(0.3, c.P.dofF * 0.15);
    }
  },
  // ---------- 舊天線 ----------
  // S.antenna＝{ at: [x, z], yaw, tilt }：格子桅杆斜插在沙裡、碟形天線、紅色信號燈
  cineHook_c1antenna(S, phase, lt) {
    if (phase === 'exit') return this.c1Drop('antenna');
    if (phase === 'enter') {
      const A = S.antenna || {};
      const g = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({ color: 0x5a5048, roughness: 0.85, metalness: 0.4 });
      const rust = new THREE.MeshStandardMaterial({ color: 0x7a4428, roughness: 0.95, metalness: 0.2 });
      const mast = new THREE.Group();
      // 三角格子桅杆
      const H = 16,
        R = 0.9;
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, H, 6), i ? steel : rust);
        leg.position.set(Math.cos(a) * R, H / 2, Math.sin(a) * R);
        mast.add(leg);
      }
      for (let y = 1; y < H; y += 1.6) {
        for (let i = 0; i < 3; i++) {
          const a0 = (i / 3) * Math.PI * 2,
            a1 = ((i + 1) / 3) * Math.PI * 2;
          const p0 = new THREE.Vector3(Math.cos(a0) * R, y, Math.sin(a0) * R);
          const p1 = new THREE.Vector3(Math.cos(a1) * R, y + 1.6, Math.sin(a1) * R);
          const len = p0.distanceTo(p1);
          const br = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 4), steel);
          br.position.copy(p0).add(p1).multiplyScalar(0.5);
          br.quaternion.setFromUnitVectors(UP, p1.clone().sub(p0).normalize());
          mast.add(br);
        }
      }
      // 碟形天線（缺了一角）與饋源
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(3.2, 18, 8, 0, Math.PI * 1.7, 0, 0.75),
        new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 0.7, metalness: 0.3, side: 2 }),
      );
      dish.position.set(0, H - 1.5, 1.4);
      dish.rotation.set(-1.9, 0.4, 0);
      mast.add(dish);
      const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 4), steel);
      feed.position.set(0, H - 0.6, 2.4);
      feed.rotation.x = 1.1;
      mast.add(feed);
      // 信號燈：發光球＋點光源
      const lampM = new THREE.MeshBasicMaterial({ color: 0xff3020 });
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 8), lampM);
      lamp.position.set(0, H + 0.35, 0);
      mast.add(lamp);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10), rust);
      cap.position.set(0, H + 0.02, 0);
      mast.add(cap);
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.9, 12, 8),
        new THREE.MeshBasicMaterial({
          color: 0xff4020,
          transparent: true,
          opacity: 0.3,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.position.copy(lamp.position);
      mast.add(halo);
      const light = new THREE.PointLight(0xff3020, 0, 28, 2);
      light.position.copy(lamp.position);
      mast.add(light);
      // 斜插在沙裡：桅杆的下半段埋在地面以下
      mast.position.y = -5;
      mast.rotation.set(A.tilt == null ? 0.32 : A.tilt, 0, 0.12);
      g.add(mast);
      // 斷掉的纜線與底座的碎塊
      for (let i = 0; i < 6; i++) {
        const b = new THREE.Mesh(
          new THREE.BoxGeometry(0.6 + hash(i) * 1.2, 0.3 + hash(i + 9) * 0.5, 0.5 + hash(i + 3)),
          i % 2 ? rust : steel,
        );
        b.position.set((hash(i + 5) - 0.5) * 7, 0.1, (hash(i + 7) - 0.5) * 7);
        b.rotation.set(hash(i + 1) * 0.6, hash(i + 2) * 3, hash(i + 4) * 0.5);
        g.add(b);
      }
      g.position.copy(this.cinePt({ g: A.at || [0, 0] }));
      g.rotation.y = ((A.yaw || 0) * Math.PI) / 180;
      this.c1Keep('antenna', { group: g, lamp, lampM, halo, light });
      return;
    }
    // 紅光一明一滅（約 1.25 秒一次，亮得快、暗得慢）
    const o = this.c1Objs && this.c1Objs.antenna;
    if (!o) return;
    const ph = (lt % 1.25) / 1.25;
    const k = ph < 0.08 ? ph / 0.08 : Math.max(0, 1 - (ph - 0.08) / 0.5);
    o.lampM.color.setRGB(0.25 + k * 0.75, 0.05 + k * 0.15, 0.03 + k * 0.1);
    o.halo.material.opacity = 0.05 + k * 0.45;
    o.halo.scale.setScalar(0.7 + k * 0.6);
    o.light.intensity = k * 6;
  },
  // ---------- 營火 ----------
  // S.fire＝{ at: [x, z] }：石圈、交叉的木柴、跳動的火焰、閃爍的點光源、往上飄的火星
  cineHook_c1fire(S, phase, lt, dt) {
    if (phase === 'exit') return this.c1Drop('fire');
    const F = S.fire || {};
    if (phase === 'enter') {
      const g = new THREE.Group();
      const stone = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 1 });
      const wood = new THREE.MeshStandardMaterial({ color: 0x3a2416, roughness: 1 });
      const ember = new THREE.MeshBasicMaterial({ color: 0xff5a10 });
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * Math.PI * 2;
        const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + hash(i) * 0.14, 0), stone);
        s.position.set(Math.cos(a) * 1.15, 0.12, Math.sin(a) * 1.15);
        s.rotation.set(hash(i + 3) * 3, hash(i + 4) * 3, 0);
        g.add(s);
      }
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const l = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.6, 6), wood);
        l.position.set(Math.cos(a) * 0.35, 0.35, Math.sin(a) * 0.35);
        l.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
        g.add(l);
      }
      const bed = new THREE.Mesh(new THREE.CircleGeometry(0.6, 12), ember);
      bed.rotation.x = -Math.PI / 2;
      bed.position.y = 0.06;
      g.add(bed);
      // 火焰：幾個加色的圓錐，各自跳動
      const flames = [];
      for (let i = 0; i < 6; i++) {
        const m = new THREE.Mesh(
          new THREE.ConeGeometry(0.28 - i * 0.025, 1.4, 7, 1, true),
          new THREE.MeshBasicMaterial({
            color: i < 2 ? 0xffd070 : i < 4 ? 0xff8a20 : 0xff4a10,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        m.position.set((hash(i + 11) - 0.5) * 0.5, 0.75, (hash(i + 13) - 0.5) * 0.5);
        g.add(m);
        flames.push(m);
      }
      const light = new THREE.PointLight(0xff8a3a, 4, 30, 1.6);
      light.position.y = 1.4;
      g.add(light);
      g.position.copy(this.cinePt({ g: F.at || [0, 0] }));
      this.c1Keep('fire', { group: g, flames, light, sparkT: 0 });
      return;
    }
    const o = this.c1Objs && this.c1Objs.fire;
    if (!o) return;
    const t = this.cine.t;
    o.flames.forEach((m, i) => {
      const n = Math.sin(t * (7 + i) + i * 2.1) * 0.5 + Math.sin(t * (13 + i * 2) + i) * 0.3;
      m.scale.set(1 + n * 0.15, 0.8 + n * 0.35 + hash(i) * 0.3, 1 + n * 0.15);
      m.rotation.y = t * (0.6 + i * 0.2);
      m.material.opacity = 0.45 + n * 0.15;
    });
    o.light.intensity =
      3.6 + Math.sin(t * 9) * 0.5 + Math.sin(t * 23 + 1) * 0.35 + (Math.random() - 0.5) * 0.4;
    // 火星往上飄
    o.sparkT -= dt;
    if (o.sparkT <= 0 && this.fx) {
      o.sparkT = 0.25 + Math.random() * 0.4;
      const p = o.group.position.clone();
      p.y += 0.8;
      this.fx.streaks(p, 3, 0xffa040, 2.2, 1.6, -1.6, UP, 0.5);
    }
  },
  // ---------- 疊加畫面 ----------
  // 飛沙：一陣一陣橫過畫面的沙粒與沙幕（S.sand＝強度，預設 1）
  cineOv_c1sand(x, W, H, lt, S) {
    const k = S.sand == null ? 1 : S.sand;
    const t = this.cine.t;
    x.save();
    const s = H / 720;
    // 沙幕：低處的暖色薄霧往右流
    const gust = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
    const g = x.createLinearGradient(0, H * 0.45, 0, H);
    g.addColorStop(0, 'rgba(210,150,90,0)');
    g.addColorStop(1, `rgba(210,150,90,${0.16 * k * gust})`);
    x.fillStyle = g;
    x.fillRect(0, H * 0.45, W, H * 0.55);
    // 沙粒：細長的橫線
    for (let i = 0; i < 110; i++) {
      const sp = 0.6 + hash(i) * 1.6;
      const y = H * (0.25 + hash(i + 50) * 0.75);
      const xx = ((hash(i + 100) + t * sp * 0.55) % 1.2) * W * 1.1 - W * 0.1;
      const L = (12 + hash(i + 7) * 46) * s * sp;
      const a = (0.08 + hash(i + 3) * 0.25) * k * gust;
      x.strokeStyle = `rgba(235,190,130,${a})`;
      x.lineWidth = (0.8 + hash(i + 9) * 1.4) * s;
      x.beginPath();
      x.moveTo(xx, y);
      x.lineTo(xx + L, y + L * 0.04);
      x.stroke();
    }
    x.restore();
  },
  // 眼燈的星芒：S.glint＝{ a, c: 顏色, t: [開始, 結束], r }
  cineOv_c1glint(x, W, H, lt, S) {
    const G = S.glint;
    if (!G) return;
    const A = this.cine.actors.get(G.a);
    if (!A || !A.e) return;
    const t0 = (G.t && G.t[0]) || 0,
      t1 = (G.t && G.t[1]) || 99;
    if (lt < t0 || lt > t1) return;
    const e = A.e;
    // 眼燈＝頭的外框中心往正面推到表面（G.o＝再加的偏移，依機體朝向）
    const box = new THREE.Box3().setFromObject(e.model.head);
    const p = box.getCenter(V3());
    const sz = box.getSize(V3());
    const o = G.o || [0, 0.1, 0];
    p.add(new THREE.Vector3(o[0], o[1] * sz.y, o[2] - Math.max(sz.x, sz.z) * 0.45).applyAxisAngle(UP, e.yaw));
    const q = p.clone().project(this.camera);
    if (q.z > 1 || Math.abs(q.x) > 1.2 || Math.abs(q.y) > 1.2) return;
    const sx = (q.x * 0.5 + 0.5) * W,
      sy = (-q.y * 0.5 + 0.5) * H;
    const u = clamp((lt - t0) / 0.35, 0, 1);
    const k = smooth(u) * (0.85 + 0.15 * Math.sin(lt * 17));
    const r = (G.r || 1) * H * 0.12 * k;
    const col = G.c || '255,120,60';
    x.save();
    x.globalCompositeOperation = 'lighter';
    const g = x.createRadialGradient(sx, sy, 0, sx, sy, r);
    g.addColorStop(0, `rgba(255,240,220,${0.9 * k})`);
    g.addColorStop(0.15, `rgba(${col},${0.6 * k})`);
    g.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g;
    x.fillRect(sx - r, sy - r, r * 2, r * 2);
    // 橫向的長光條＋短的縱向光條
    for (const [w, h, a] of [
      [r * 4.5, r * 0.03, 0.7],
      [r * 0.03, r * 1.4, 0.45],
    ]) {
      const g2 = x.createRadialGradient(sx, sy, 0, sx, sy, Math.max(w, h));
      g2.addColorStop(0, `rgba(255,230,200,${a * k})`);
      g2.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g2;
      x.fillRect(sx - w, sy - h, w * 2, h * 2);
    }
    x.restore();
  },
  // BASTILLE 的瞄準鏡：圓形視野外全黑、十字線、測距刻度、鎖定框（S.scope＝{ a: 目標 }）
  cineOv_c1scope(x, W, H, lt, S) {
    const s = H / 720;
    const cx = W / 2,
      cy = H / 2,
      R = H * 0.36;
    x.save();
    x.fillStyle = '#000';
    x.beginPath();
    x.rect(0, 0, W, H);
    x.arc(cx, cy, R, 0, Math.PI * 2, true);
    x.fill('evenodd');
    // 鏡筒邊緣的暗圈
    const g = x.createRadialGradient(cx, cy, R * 0.7, cx, cy, R);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.85)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, R, 0, Math.PI * 2);
    x.fill();
    // 十字線與刻度
    x.strokeStyle = 'rgba(255,70,40,0.85)';
    x.lineWidth = 1.2 * s;
    x.beginPath();
    x.moveTo(cx - R, cy);
    x.lineTo(cx - 14 * s, cy);
    x.moveTo(cx + 14 * s, cy);
    x.lineTo(cx + R, cy);
    x.moveTo(cx, cy - R);
    x.lineTo(cx, cy - 14 * s);
    x.moveTo(cx, cy + 14 * s);
    x.lineTo(cx, cy + R);
    for (let i = -6; i <= 6; i++) {
      if (!i) continue;
      const L = (i % 3 ? 4 : 9) * s;
      x.moveTo(cx + i * 24 * s, cy - L);
      x.lineTo(cx + i * 24 * s, cy + L);
      x.moveTo(cx - L, cy + i * 24 * s);
      x.lineTo(cx + L, cy + i * 24 * s);
    }
    x.stroke();
    // 文字
    x.font = `${12 * s}px "Share Tech Mono", monospace`;
    x.fillStyle = 'rgba(255,90,60,0.9)';
    x.fillText('BASTILLE // FCS-03', cx - R * 0.62, cy - R * 0.72);
    const rng = Math.max(0, 842 - Math.floor(lt * 3));
    x.fillText(`RNG ${String(rng).padStart(4, '0')}m`, cx + R * 0.28, cy + R * 0.66);
    x.fillText(`ELV +${(4.2 + Math.sin(lt * 0.7) * 0.3).toFixed(2)}`, cx + R * 0.28, cy + R * 0.66 + 16 * s);
    if (Math.floor(lt * 3) % 2) x.fillText('▲ TARGET: CASTRON CONVOY', cx - R * 0.62, cy + R * 0.66);
    // 鎖定框（套住目標）
    const A = S.scope && this.cine.actors.get(S.scope.a);
    if (A && A.e && lt > 0.6) {
      const p = A.e.center().project(this.camera);
      if (p.z < 1) {
        const sx = (p.x * 0.5 + 0.5) * W,
          sy = (-p.y * 0.5 + 0.5) * H;
        const r = (36 + Math.max(0, 1.2 - lt) * 60) * s;
        x.strokeStyle = `rgba(255,60,40,${Math.floor(lt * 8) % 2 ? 1 : 0.5})`;
        x.lineWidth = 2 * s;
        x.strokeRect(sx - r, sy - r * 0.7, r * 2, r * 1.4);
        x.fillText('LOCK', sx + r + 4 * s, sy - r * 0.7 + 10 * s);
      }
    }
    x.restore();
  },
  // 天線的訊號圈：從信號燈往外擴散的紅色圓（螢幕座標）
  cineOv_c1pulse(x, W, H, lt) {
    const o = this.c1Objs && this.c1Objs.antenna;
    if (!o) return;
    const p = o.lamp.getWorldPosition(V3()).project(this.camera);
    if (p.z > 1) return;
    const sx = (p.x * 0.5 + 0.5) * W,
      sy = (-p.y * 0.5 + 0.5) * H;
    x.save();
    x.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const u = (lt / 1.25 + i / 3) % 1;
      x.strokeStyle = `rgba(255,70,40,${0.35 * (1 - u)})`;
      x.lineWidth = 1.5 + (1 - u) * 2;
      x.beginPath();
      x.arc(sx, sy, u * H * 0.6, 0, Math.PI * 2);
      x.stroke();
    }
    x.restore();
  },
  // 西部片的大字章名：直接壓在遠景上（S.title＝{ at, big, sub, en }）
  cineOv_c1title(x, W, H, lt, S) {
    const T = S.title;
    if (!T || lt < T.at) return;
    const u = lt - T.at;
    const next = this.cine.def.shots[this.cine.shot + 1];
    const left = (next ? next.at : this.cine.def.dur) - S.at - lt;
    const a = clamp(left / 1.2, 0, 1);
    // 一下子砸上來（稍微放大再定住），之後慢慢變大一點點
    const pop = u < 0.12 ? 1.06 - u * 0.5 : 1 + Math.min(u, 8) * 0.004;
    const s = Math.min(W / 1280, H / 720);
    const cx = W / 2,
      cy = H * (T.y || 0.42);
    x.save();
    x.globalAlpha = a;
    x.translate(cx, cy);
    x.scale(pop, pop);
    const serif = '"Noto Serif TC","Source Han Serif TC","PMingLiU","MingLiU",serif';
    // 上方小字
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillStyle = 'rgba(245,225,190,0.92)';
    x.font = `700 ${18 * s}px Georgia, ${serif}`;
    x.fillText(T.sub.split('').join(' '), 0, -96 * s);
    // 上下的雙線與星
    x.strokeStyle = 'rgba(245,225,190,0.85)';
    x.lineWidth = 2 * s;
    for (const y of [-74, 70]) {
      x.beginPath();
      x.moveTo(-330 * s, y * s);
      x.lineTo(-30 * s, y * s);
      x.moveTo(30 * s, y * s);
      x.lineTo(330 * s, y * s);
      x.stroke();
      x.beginPath();
      x.moveTo(-330 * s, (y + 6) * s);
      x.lineTo(-30 * s, (y + 6) * s);
      x.moveTo(30 * s, (y + 6) * s);
      x.lineTo(330 * s, (y + 6) * s);
      x.lineWidth = 0.8 * s;
      x.stroke();
      x.lineWidth = 2 * s;
      x.font = `${16 * s}px ${serif}`;
      x.fillText('★', 0, (y + 3) * s);
    }
    // 大字：深色的粗描邊＋奶油色＋木刻的粗糙感（幾條水平的缺口）
    x.font = `900 ${104 * s}px ${serif}`;
    x.lineJoin = 'round';
    x.lineWidth = 10 * s;
    x.strokeStyle = 'rgba(40,16,6,0.85)';
    x.strokeText(T.big, 0, 0);
    const g = x.createLinearGradient(0, -52 * s, 0, 52 * s);
    g.addColorStop(0, '#fff1cf');
    g.addColorStop(0.55, '#f2c98a');
    g.addColorStop(1, '#c9813e');
    x.fillStyle = g;
    x.fillText(T.big, 0, 0);
    x.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 9; i++) {
      x.fillStyle = `rgba(0,0,0,${0.25 + hash(i) * 0.4})`;
      x.fillRect(
        (hash(i + 1) - 0.5) * 620 * s,
        (hash(i + 2) - 0.5) * 90 * s,
        (20 + hash(i + 3) * 90) * s,
        1.5 * s,
      );
    }
    x.globalCompositeOperation = 'source-over';
    // 下方英文
    x.fillStyle = 'rgba(245,225,190,0.9)';
    x.font = `italic 700 ${19 * s}px Georgia, ${serif}`;
    x.fillText(T.en, 0, 120 * s);
    x.restore();
  },
  // 攔截到的頻道：S.chans＝[{ t, d, who }]，畫面左上的徽章、頻道名、聲紋
  cineOv_c1chan(x, W, H, lt, S) {
    const s = H / 720;
    for (const ch of S.chans || []) {
      if (lt < ch.t || lt > ch.t + ch.d) continue;
      const u = lt - ch.t;
      const a = clamp(u / 0.3, 0, 1) * clamp((ch.d - u) / 0.4, 0, 1);
      const SP = SPEAKERS[ch.who];
      if (!SP) continue;
      const bx = 48 * s,
        by = (this.cine.bar || 0) + 40 * s;
      x.save();
      x.globalAlpha = a;
      x.fillStyle = 'rgba(8,6,4,0.55)';
      x.fillRect(bx - 10 * s, by - 10 * s, 290 * s, 64 * s);
      x.strokeStyle = SP.color;
      x.lineWidth = 1.5 * s;
      x.strokeRect(bx, by, 44 * s, 44 * s);
      x.fillStyle = SP.color;
      x.font = `700 ${26 * s}px sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(SP.mark, bx + 22 * s, by + 23 * s);
      x.textAlign = 'left';
      x.font = `700 ${14 * s}px "Noto Sans TC", sans-serif`;
      x.fillText(FACTION[ch.who] || SP.name, bx + 56 * s, by + 12 * s);
      x.font = `${10 * s}px "Share Tech Mono", monospace`;
      x.fillStyle = 'rgba(230,215,190,0.7)';
      x.fillText(`CH.0${ch.n || 1}  // INTERCEPTED`, bx + 56 * s, by + 28 * s);
      for (let i = 0; i < 22; i++) {
        const h =
          (0.15 + Math.abs(Math.sin(this.cine.t * 11 + i * 1.3) * Math.sin(this.cine.t * 4 + i))) * 10 * s;
        x.fillStyle = SP.color;
        x.globalAlpha = a * 0.7;
        x.fillRect(bx + 56 * s + i * 8 * s, by + 40 * s - h / 2, 5 * s, h);
      }
      x.restore();
    }
  },
  // 星空：固定方向的星星（隨鏡頭轉動），S.stars＝{ on: [開始, 全亮], station: [閃的時間], dir: 軌道站的方向 }
  cineOv_c1stars(x, W, H, lt, S) {
    const st = S.stars || {};
    const on = st.on || [0, 1];
    const k = clamp((lt - on[0]) / Math.max(0.1, on[1] - on[0]), 0, 1);
    const cam = this.camera;
    const p = V3();
    x.save();
    x.globalCompositeOperation = 'lighter';
    if (k > 0)
      for (let i = 0; i < 700; i++) {
        const az = hash(i) * Math.PI * 2;
        const el = 0.2 + Math.pow(hash(i + 500), 0.7) * 1.35;
        if (el > Math.PI / 2) continue;
        p.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
        p.multiplyScalar(300).add(cam.position).project(cam);
        if (p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) continue;
        const sx = (p.x * 0.5 + 0.5) * W,
          sy = (-p.y * 0.5 + 0.5) * H;
        const b = hash(i + 900);
        const tw = 0.7 + 0.3 * Math.sin(this.cine.t * (1 + b * 3) + i);
        const a = k * tw * (0.45 + b * b * 0.55) * clamp((el - 0.2) / 0.25, 0, 1);
        const r = (1 + b * b * 2.2) * Math.max(1, H / 720);
        x.fillStyle = b > 0.93 ? `rgba(255,220,180,${a})` : `rgba(210,225,255,${a})`;
        x.fillRect(sx - r / 2, sy - r / 2, r, r);
      }
    // 軌道站的光點：一直有一個暗紅的點，最後閃一下
    const d = st.dir || [-0.35, 0.85, -0.4];
    p.set(d[0], d[1], d[2]).normalize().multiplyScalar(300).add(cam.position).project(cam);
    if (k > 0 && p.z < 1 && Math.abs(p.x) < 1 && Math.abs(p.y) < 1) {
      const sx = (p.x * 0.5 + 0.5) * W,
        sy = (-p.y * 0.5 + 0.5) * H;
      const fl = st.station || [999, 999];
      let f = 0;
      if (lt > fl[0] && lt < fl[1]) {
        const u = (lt - fl[0]) / (fl[1] - fl[0]);
        f = Math.sin(u * Math.PI) * (u < 0.5 ? 1 : 0.6 + 0.4 * Math.sin(u * 40));
      }
      const r = H * (0.004 + f * 0.06);
      const g = x.createRadialGradient(sx, sy, 0, sx, sy, r * 3);
      g.addColorStop(0, `rgba(255,235,225,${0.6 * k + f * 0.4})`);
      g.addColorStop(0.25, `rgba(255,80,60,${0.35 * k + f * 0.5})`);
      g.addColorStop(1, 'rgba(255,40,30,0)');
      x.fillStyle = g;
      x.fillRect(sx - r * 3, sy - r * 3, r * 6, r * 6);
      if (f > 0.05) {
        x.fillStyle = `rgba(255,200,190,${f * 0.6})`;
        x.fillRect(sx - r * 8, sy - 0.75, r * 16, 1.5);
        x.fillRect(sx - 0.75, sy - r * 3, 1.5, r * 6);
      }
    }
    x.restore();
  },
  // ---------- 熱浪 ----------
  // S.heat＝[上緣, 下緣]（畫面高度的比例）：畫完場景之後，把這一帶切成橫條、左右錯開疊在上面
  cineRender_c1heat(S) {
    this.renderMain();
    const src = this.renderer.domElement;
    const cv = document.getElementById('cineCv');
    if (!cv || !src.width) return;
    const W = innerWidth,
      H = innerHeight;
    const fade = +document.getElementById('cineFade').style.opacity || 0;
    if (fade > 0.97) return;
    const x = cv.getContext('2d');
    const dpr = cv.width / W;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const ky = src.height / H;
    const band = S.heat || [0.45, 0.7];
    const y0 = H * band[0],
      y1 = H * band[1],
      step = 2;
    const amp = (S.heatAmp || 2.2) * (H / 720);
    const t = this.cine.t;
    x.save();
    x.globalAlpha = 1 - fade;
    for (let y = y0; y < y1; y += step) {
      const u = (y - y0) / (y1 - y0);
      const env = Math.sin(u * Math.PI);
      const off = env * amp * (Math.sin(y * 0.21 + t * 6.5) + 0.6 * Math.sin(y * 0.67 - t * 10.3));
      x.drawImage(src, 0, y * ky, src.width, step * ky, off, y, W, step + 0.5);
    }
    x.restore();
  },
});
