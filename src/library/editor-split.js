// GLB 編輯器的「拆分」：把一整台機甲（或一隻手）的 GLB 拆成遊戲的各個區塊。
// 1. 對齊：選零件組合，程式模型（各區塊不同顏色的線框）疊在模型上；用朝向／尺寸工具對齊，並調整程式模型的姿勢配合模型
//    （手臂張開、手肘彎曲等，例如 T 字或 A 字姿勢）。
// 2. 分配：每個三角形分給最近的程式模型區塊；框選改分配、平面切割（切開三角形並補切面）。
// 3. 存檔：每個區塊轉成「拉直靜止姿勢」下該區塊的區域座標（原點＝旋轉中心）存進各自的槽位。
import { escHtml } from '../core/html.js';
import { PARTS, START_ASM } from '../data/parts.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { budgetFor } from '../render/glb.js';
import { PALETTES } from '../render/materials.js';
import { CONN_NAMES, PIECE_NAMES, SIDE_NAMES, buildMech, mechPieces } from '../render/mech-model.js';
import { MODEL_CATALOG } from '../render/model-catalog.js';
import { DROP, NONE, buildSoup, centroid, cutSoup, pieceMeshes, triTotal } from './editor-cut.js';
import { boxIn, exportGlb } from './editor-ops.js';
import { processGlb, simplifyGeometry, triCountOf } from './editor-opt.js';
import { disposeObject } from './stage.js';
import { WS_SLOTS, restPose, sanitizeAsm } from './workshop.js';

const $ = (id) => document.getElementById(id);
const D2R = Math.PI / 180;
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);
// 快速姿勢：手臂張開（肩，向外）、手肘彎曲（向前）、腿張開（髖，向外）、膝蓋彎曲（向後）
const QUICK = [
  ['arm', '手臂張開', 0, 120],
  ['elbow', '手肘彎曲', 0, 150],
  ['leg', '腿張開', 0, 60],
  ['knee', '膝蓋彎曲', 0, 120],
];
const colorOf = (i) => new THREE.Color().setHSL((i * 0.618) % 1, 0.7, 0.55);
const label = (info) =>
  (info.key ? SIDE_NAMES[info.key] || '' : '') +
  (info.cat === 'weapon'
    ? '手持武器'
    : info.cat === 'back'
      ? '肩上武器'
      : PIECE_NAMES[info.kind] || info.kind);

export class SplitTool {
  constructor(ed) {
    this.ed = ed;
    this.active = false; // 拆分模式（對齊階段起）
    this.cutting = false; // 分配階段（已建立三角形湯）
    this.asm = { ...START_ASM };
    this.off = new Set(); // 不參與分配的區塊槽位
    this.quick = { arm: 0, elbow: 0, leg: 0, knee: 0 };
    this.pose = {}; // 槽位 → [x, y, z]°（加在快速姿勢之上）
    this.rig = null;
    this.list = []; // [{ info, slot, color }]，索引就是三角形湯裡的區塊編號
    this.cur = 0; // 選中的區塊（框選的目標、姿勢數值）
    this.soup = null;
    this.undo = [];
    this.redo = [];
    this.boxMode = false;
    this.colorView = true;
    this.view = null;
    this.mats = new Map();
    // 切割平面：區域 +Y 是法線（正面＝子區塊那側）
    this.plane = new THREE.Group();
    const disk = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        Array.from({ length: 48 }, (_, i) => {
          const a = (i / 48) * Math.PI * 2;
          return new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
        }),
      ),
      new THREE.LineBasicMaterial({ color: 0xffd23f }),
    );
    this.disk = new THREE.Group();
    this.disk.add(disk, ring);
    const arrow = new THREE.ArrowHelper(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(),
      0.25,
      0xffd23f,
      0.08,
      0.05,
    );
    this.arrow = arrow;
    this.plane.add(this.disk, arrow);
    this.plane.visible = false;
    ed.frame.add(this.plane);
    this.radius = 0.3;
    this.setupBox();
  }

  // ---------- 開關與階段 ----------
  toggle() {
    if (this.active) {
      if (this.cutting && !confirm('離開拆分模式會放棄目前的分配與切割，確定？')) return;
      this.stopCut();
      this.active = false;
      if (this.rig) {
        this.ed.scene.remove(this.rig.group);
        disposeObject(this.rig.group);
        this.rig = null;
      }
    } else {
      this.active = true;
      this.buildRig();
    }
    this.render();
    this.ed.applyShow();
    this.ed.renderAll();
    if (this.active) this.ed.frameView();
  }
  start() {
    const ed = this.ed;
    if (!ed.content) return ed.toast('請先載入模型', true);
    if (!this.included().length) return ed.toast('至少要有一個區塊參與分配', true);
    this.soup = buildSoup(ed.content, ed.frame);
    if (!this.soup.length) return ed.toast('模型沒有可見的網格', true);
    this.cutting = true;
    this.undo = [];
    this.redo = [];
    ed.xform.visible = false;
    if (ed.tc) ed.tc.detach();
    this.soup = this.assigned(this.soup);
    this.render();
    this.display();
    ed.renderAll();
  }
  stopCut() {
    this.cutting = false;
    this.soup = null;
    this.setBox(false);
    this.plane.visible = false;
    if (this.view) {
      this.ed.frame.remove(this.view);
      for (const m of this.view.children) m.geometry.dispose();
      this.view = null;
    }
    this.ed.xform.visible = true;
    if (this.ed.content && this.ed.tc) this.ed.tc.attach(this.ed.sel || this.ed.xform);
  }
  back() {
    if (!confirm('回到對齊會放棄目前的分配與切割，確定？')) return;
    this.stopCut();
    this.render();
    this.ed.renderAll();
  }

  // ---------- 程式模型 ----------
  included() {
    return this.list.map((x, i) => i).filter((i) => !this.off.has(this.list[i].slot));
  }
  buildRig() {
    if (this.rig) {
      this.ed.scene.remove(this.rig.group);
      disposeObject(this.rig.group);
    }
    this.rig = buildMech(this.asm, PALETTES.player, 1, { piece: () => null });
    this.list = mechPieces(this.asm).map((info, i) => ({ info, slot: info.slot, color: colorOf(i) }));
    if (this.cur >= this.list.length) this.cur = 0;
    this.list.forEach((x, i) => {
      const obj = this.rig.pieces[x.slot];
      if (!obj) return;
      const mat = new THREE.MeshBasicMaterial({
        color: x.color,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
      });
      obj.traverse((o) => {
        if (o.isLineSegments) o.visible = false;
        if (!o.isMesh) return;
        if (o.material === OUTLINE_MAT) o.visible = false;
        else o.material = mat;
      });
      obj.userData.idx = i;
    });
    this.ed.scene.add(this.rig.group);
    this.applyPose();
  }
  // 拉直靜止姿勢 → 快速姿勢 → 個別區塊的旋轉
  applyPose() {
    const rig = this.rig;
    if (!rig) return;
    restPose(rig);
    const q = this.quick;
    for (const a of Object.values(rig.arms)) {
      const s = Math.sign(a.mount.position.x) || 1;
      a.up.rotation.z = s * q.arm * D2R;
      a.fore.rotation.x = q.elbow * D2R;
    }
    if (rig.type === 'biped' || rig.type === 'reverse')
      for (const L of rig.legs) {
        const s = Math.sign(L.thigh.parent.position.x) || 1;
        L.thigh.rotation.z = s * q.leg * D2R;
        L.knee.rotation.x = -q.knee * D2R;
      }
    for (const [slot, r] of Object.entries(this.pose)) {
      const obj = rig.pieces[slot];
      if (!obj || !obj.parent) continue;
      const j = obj.parent;
      j.rotation.set(j.rotation.x + r[0] * D2R, j.rotation.y + r[1] * D2R, j.rotation.z + r[2] * D2R);
    }
    rig.group.updateMatrixWorld(true);
    this.pieceData();
    this.ed.renderStats();
  }
  // 每個區塊：glTF 座標 → 區塊區域座標的矩陣、區域外框
  pieceData() {
    const frameW = this.ed.frame.matrixWorld;
    this.data = this.list.map((x) => {
      const obj = this.rig.pieces[x.slot];
      if (!obj) return null;
      const inv = obj.matrixWorld.clone().invert();
      const box = new THREE.Box3(),
        tmp = new THREE.Box3(),
        m = new THREE.Matrix4(),
        v = new THREE.Vector3();
      const surf = []; // 區塊的三角形（區域座標），外框相近時用來算到表面的距離
      obj.traverse((o) => {
        if (!o.isMesh || o.material === OUTLINE_MAT || !o.visible) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        m.multiplyMatrices(inv, o.matrixWorld);
        box.union(tmp.copy(o.geometry.boundingBox).applyMatrix4(m));
        const g = o.geometry,
          pos = g.attributes.position,
          idx = g.index;
        const n = idx ? idx.count : pos.count;
        for (let k = 0; k < n; k++) {
          v.fromBufferAttribute(pos, idx ? idx.getX(k) : k).applyMatrix4(m);
          surf.push(v.x, v.y, v.z);
        }
      });
      return {
        obj,
        A: inv.clone().multiply(frameW),
        box,
        surf: new Float32Array(surf),
        center: box.getCenter(new THREE.Vector3()),
        size: Math.max(box.getSize(new THREE.Vector3()).length(), 0.05),
      };
    });
  }
  // 參與分配的區塊在 glTF 座標的外框（「對齊程式模型」用）
  refBox() {
    const b = new THREE.Box3();
    if (!this.rig) return b;
    for (const i of this.included()) {
      const d = this.data[i];
      if (d) b.union(boxIn(d.obj, this.ed.frame, false));
    }
    return b;
  }

  // ---------- 分配 ----------
  // 每個三角形分給最近的區塊（點到區塊外框的距離；在多個外框內時取相對中心最近的），排除的三角形保留
  // 先算到各區塊外框的距離；外框距離相近（NEAR 以內）的區塊不只一個時，再比到區塊表面的實際距離
  assigned(soup) {
    const NEAR = 0.15;
    const idx = this.included().filter((i) => this.data[i]);
    const c = new THREE.Vector3(),
      q = new THREE.Vector3(),
      cp = new THREE.Vector3();
    const T = new THREE.Triangle();
    const surfDist = (d, pt) => {
      const a = d.surf;
      let best = Infinity;
      for (let o = 0; o < a.length; o += 9) {
        T.a.set(a[o], a[o + 1], a[o + 2]);
        T.b.set(a[o + 3], a[o + 4], a[o + 5]);
        T.c.set(a[o + 6], a[o + 7], a[o + 8]);
        const dd = T.closestPointToPoint(pt, cp).distanceToSquared(pt);
        if (dd < best) best = dd;
      }
      return Math.sqrt(best);
    };
    const near = [];
    return soup.map((s) => {
      const tri = s.tri.slice();
      for (let t = 0; t < tri.length; t++) {
        if (tri[t] === DROP) continue;
        centroid(s, t, c);
        let best = NONE,
          bd = Infinity,
          bn = Infinity;
        near.length = 0;
        for (const i of idx) {
          const d = this.data[i];
          q.copy(c).applyMatrix4(d.A);
          const dist = d.box.distanceToPoint(q);
          near.push([i, dist]);
          const norm = q.distanceTo(d.center) / d.size;
          if (dist < bd - 1e-6 || (Math.abs(dist - bd) <= 1e-6 && norm < bn)) {
            best = i;
            bd = dist;
            bn = norm;
          }
        }
        const cand = near.filter((x) => x[1] <= bd + NEAR);
        if (cand.length > 1) {
          let sd = Infinity;
          for (const [i] of cand) {
            const d = this.data[i];
            if (!d.surf.length) continue;
            const dist = surfDist(d, q.copy(c).applyMatrix4(d.A));
            if (dist < sd) {
              sd = dist;
              best = i;
            }
          }
        }
        tri[t] = best;
      }
      return { ...s, tri };
    });
  }
  reassign() {
    if (!this.cutting) return;
    this.push();
    this.soup = this.assigned(this.soup);
    this.changed();
  }

  // ---------- 框選 ----------
  setupBox() {
    const ed = this.ed;
    const el = document.createElement('div');
    el.className = 'edBoxSel';
    el.hidden = true;
    $('edView').appendChild(el);
    let start = null;
    const rel = (e) => {
      const r = ed.canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top, r];
    };
    ed.canvas.addEventListener('pointerdown', (e) => {
      if (!this.boxMode || !this.cutting) return;
      start = rel(e);
      el.hidden = false;
      Object.assign(el.style, { left: start[0] + 'px', top: start[1] + 'px', width: '0px', height: '0px' });
    });
    addEventListener('pointermove', (e) => {
      if (!start) return;
      const [x, y] = rel(e);
      Object.assign(el.style, {
        left: Math.min(x, start[0]) + 'px',
        top: Math.min(y, start[1]) + 'px',
        width: Math.abs(x - start[0]) + 'px',
        height: Math.abs(y - start[1]) + 'px',
      });
    });
    addEventListener('pointerup', (e) => {
      if (!start) return;
      const [x, y, r] = rel(e);
      const s = start;
      start = null;
      el.hidden = true;
      if (Math.abs(x - s[0]) < 3 && Math.abs(y - s[1]) < 3) return;
      const nx = (v) => (v / r.width) * 2 - 1,
        ny = (v) => -((v / r.height) * 2 - 1);
      this.boxAssign(
        Math.min(nx(x), nx(s[0])),
        Math.max(nx(x), nx(s[0])),
        Math.min(ny(y), ny(s[1])),
        Math.max(ny(y), ny(s[1])),
      );
    });
  }
  setBox(on) {
    this.boxMode = on;
    this.ed.controls.enabled = !on;
    const b = $('edSpBox');
    if (b) b.classList.toggle('sel', on);
  }
  // 重心投影在框內的三角形改分給目前選中的區塊（或排除）；可只選朝向鏡頭的面
  boxAssign(x0, x1, y0, y1) {
    const ed = this.ed;
    const target = this.boxTarget();
    const front = $('edSpFront') && $('edSpFront').checked;
    const fw = ed.frame.matrixWorld,
      fq = ed.frame.quaternion;
    const cam = ed.camera.position;
    const c = new THREE.Vector3(),
      p = new THREE.Vector3(),
      e1 = new THREE.Vector3(),
      e2 = new THREE.Vector3();
    let n = 0;
    const next = this.soup.map((s) => {
      const tri = s.tri.slice();
      const pos = s.attrs.position.arr;
      for (let t = 0; t < tri.length; t++) {
        centroid(s, t, c).applyMatrix4(fw);
        p.copy(c).project(ed.camera);
        if (p.z > 1 || p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1) continue;
        if (front) {
          const o = t * 9;
          e1.set(pos[o + 3] - pos[o], pos[o + 4] - pos[o + 1], pos[o + 5] - pos[o + 2]);
          e2.set(pos[o + 6] - pos[o], pos[o + 7] - pos[o + 1], pos[o + 8] - pos[o + 2]);
          e1.cross(e2).applyQuaternion(fq);
          if (e1.dot(p.copy(cam).sub(c)) <= 0) continue;
        }
        if (tri[t] !== target) {
          tri[t] = target;
          n++;
        }
      }
      return { ...s, tri };
    });
    if (!n) return ed.toast('框內沒有要改分配的三角形', true);
    this.push();
    this.soup = next;
    this.changed();
    ed.toast(`已改分配 ${n.toLocaleString()} 個三角形`);
  }
  boxTarget() {
    return $('edSpDrop') && $('edSpDrop').checked ? DROP : this.cur;
  }
  // 點畫面上的模型：選取該三角形所屬的區塊
  pick(e) {
    if (this.boxMode || !this.view) return;
    const ed = this.ed;
    const r = ed.canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1),
      ed.camera,
    );
    const hit = ray.intersectObjects(this.view.children, false)[0];
    if (hit && hit.object.userData.piece < this.list.length) this.select(hit.object.userData.piece);
  }

  // ---------- 平面切割 ----------
  // 放到連接點：平面在連接點上，法線指向子區塊，A＝父區塊、B＝子區塊，半徑依子區塊大小
  placeAt(mi) {
    const m = this.rig && this.rig.mounts[mi];
    if (!m) return;
    const ed = this.ed;
    const ci = this.list.findIndex((x) => {
      const o = this.rig.pieces[x.slot];
      return o && o.parent && o.parent.parent === m.node;
    });
    const pi = this.list.findIndex((x) => x.slot === m.slot);
    if (ci < 0 || pi < 0) return;
    const p = ed.frame.worldToLocal(m.node.getWorldPosition(new THREE.Vector3()));
    const cb = boxIn(this.data[ci].obj, ed.frame, false);
    const n = cb.getCenter(new THREE.Vector3()).sub(p);
    if (n.lengthSq() < 1e-8) n.set(0, -1, 0);
    n.normalize();
    this.plane.position.copy(p);
    this.plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const size = cb.getSize(new THREE.Vector3());
    this.setRadius(Math.max(0.1, Math.max(size.x, size.y, size.z) * 0.75));
    $('edCutA').value = pi;
    $('edCutB').value = ci;
    this.showPlane(true);
  }
  setRadius(r) {
    this.radius = r;
    this.disk.scale.setScalar(r);
    this.arrow.setLength(Math.max(0.1, r * 0.6), r * 0.15, r * 0.08);
    if ($('edCutR')) $('edCutR').value = +r.toFixed(3);
  }
  showPlane(on) {
    this.plane.visible = on;
    const tc = this.ed.tc;
    if (tc) {
      if (on) tc.attach(this.plane);
      else tc.detach();
    }
    const b = $('edCutShow');
    if (b) b.classList.toggle('sel', on);
  }
  cut() {
    const ed = this.ed;
    const A = +$('edCutA').value,
      B = +$('edCutB').value;
    if (A === B) return ed.toast('平面兩側要分給不同的區塊', true);
    if (!this.plane.visible) return ed.toast('請先放置切割平面（例如「放到連接點」）', true);
    this.plane.updateMatrix();
    const n = new THREE.Vector3(0, 1, 0).applyQuaternion(this.plane.quaternion).normalize();
    const res = cutSoup(this.soup, { p: this.plane.position.clone(), n, r: this.radius, A, B });
    if (!res.cut && res.soup === this.soup) return ed.toast('範圍內沒有分給這兩個區塊的三角形', true);
    this.push();
    this.soup = res.soup;
    this.changed();
    ed.toast(
      `切開 ${res.cut.toLocaleString()} 個三角形，補面 ${res.capped.toLocaleString()} 個（${res.loops} 個切口）` +
        (res.open ? `；${res.open} 處切口沒有封閉，未補面（網格有破洞或半徑太小）` : ''),
      !!res.open,
    );
  }

  // ---------- 復原／重做 ----------
  snap() {
    return { soup: this.soup, quick: { ...this.quick }, pose: JSON.parse(JSON.stringify(this.pose)) };
  }
  push() {
    this.undo.push(this.snap());
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }
  step(back) {
    const e = (back ? this.undo : this.redo).pop();
    if (!e) return this.ed.toast(back ? '沒有可以復原的修改' : '沒有可以重做的修改', true);
    (back ? this.redo : this.undo).push(this.snap());
    this.soup = e.soup;
    this.quick = e.quick;
    this.pose = e.pose;
    this.applyPose();
    this.changed();
    this.render();
  }
  changed() {
    this.display();
    this.renderPieces();
    this.renderUndo();
  }

  // ---------- 顯示 ----------
  matOf(i, s) {
    if (!this.colorView && i !== DROP && i !== NONE) return s.mat;
    const key = i;
    if (!this.mats.has(key)) {
      const col =
        i === DROP ? 0x30363d : i === NONE ? 0xff3b30 : this.list[i] ? this.list[i].color : 0xffffff;
      this.mats.set(
        key,
        new THREE.MeshStandardMaterial({
          color: col,
          roughness: 0.7,
          transparent: i === DROP,
          opacity: i === DROP ? 0.35 : 1,
          side: THREE.DoubleSide,
        }),
      );
    }
    const m = this.mats.get(key);
    if (m.emissive) m.emissive.set(i === this.cur && this.colorView ? 0x3a3a3a : 0x000000);
    return m;
  }
  display() {
    const ed = this.ed;
    if (this.view) {
      ed.frame.remove(this.view);
      for (const m of this.view.children) m.geometry.dispose();
    }
    this.view = new THREE.Group();
    if (!this.soup) return;
    const ids = new Set();
    for (const s of this.soup) for (const t of s.tri) ids.add(t);
    for (const i of ids)
      for (const s of this.soup) {
        const parts = pieceMeshes([s], i, null);
        for (const pm of parts) {
          const mesh = new THREE.Mesh(pm.geometry, this.matOf(i, s));
          mesh.userData.piece = i;
          mesh.castShadow = true;
          this.view.add(mesh);
        }
      }
    ed.frame.add(this.view);
  }
  counts() {
    const n = new Map();
    if (!this.soup) return n;
    for (const s of this.soup) for (const t of s.tri) n.set(t, (n.get(t) || 0) + 1);
    return n;
  }

  // ---------- 存檔：每個區塊轉成區塊的區域座標（glTF）存進槽位 ----------
  async saveAll() {
    const ed = this.ed;
    const n = this.counts();
    const todo = this.included().filter((i) => n.get(i));
    if (!todo.length) return ed.toast('沒有分配到任何三角形的區塊', true);
    const left = n.get(NONE) || 0;
    const names = todo.map((i) => label(this.list[i].info)).join('、');
    if (
      !confirm(
        `將覆寫 ${todo.length} 個槽位的瀏覽器暫存 GLB：\n${names}` +
          (left ? `\n\n還有 ${left.toLocaleString()} 個三角形未分配，不會存進任何區塊。` : '') +
          '\n\n確定存檔？',
      )
    )
      return;
    ed.frame.updateMatrixWorld(true);
    const base = (ed.orig ? ed.orig.name : ed.fileName || 'model').replace(/\.glb$/i, '');
    let done = 0;
    for (const i of todo) {
      const { slot } = this.list[i];
      const d = this.data[i];
      const M = FLIP.clone().multiply(d.A);
      const root = new THREE.Group();
      root.name = slot.replace(/\//g, '_');
      const parts = pieceMeshes(this.soup, i, M);
      const entry = MODEL_CATALOG.find((e) => e.id === slot);
      const spec = entry ? entry.spec : 'piece';
      try {
        // 減到這個區塊的預算
        if ($('edSpOpt') && $('edSpOpt').checked) {
          const tris = parts.reduce((n, pm) => n + triCountOf(pm.geometry), 0);
          const ratio = (budgetFor(spec).tris * 0.98) / Math.max(1, tris);
          if (ratio < 1)
            for (const pm of parts) {
              const g = await simplifyGeometry(pm.geometry, ratio);
              pm.geometry.dispose();
              pm.geometry = g;
            }
        }
        for (const pm of parts) root.add(new THREE.Mesh(pm.geometry, pm.mat));
        const buf = await processGlb(await exportGlb(root), ed.exportOptsFor(spec));
        await ed.store.putBuf(slot, `${base}（拆分）→${slot.split('/').slice(1).join('_')}.glb`, buf);
        done++;
        if (ed.onSaved) ed.onSaved(slot);
      } catch (err) {
        ed.toast(`${slot} 匯出失敗：${err.message || err}`, true);
      } finally {
        for (const pm of parts) pm.geometry.dispose();
      }
    }
    ed.toast(`已存 ${done} 個區塊到各自的槽位${ed.store.ok ? '' : '（瀏覽器無法保存，重新整理後會消失）'}`);
  }

  // ---------- 介面 ----------
  select(i) {
    this.cur = i;
    if (this.cutting) this.display();
    this.renderPieces();
    this.renderPose();
  }
  render() {
    const on = this.active;
    $('edSplitLeft').hidden = !on;
    $('edSplitRight').hidden = !on;
    $('edSplitOn').classList.toggle('sel', on);
    $('edSplitOn').textContent = on ? '離開拆分模式' : '拆分成區塊…';
    $('edMain').hidden = this.cutting;
    $('edSlotBox').hidden = on;
    $('edTreeBox').hidden = on;
    $('edSaveBox').hidden = on;
    if (!on) return;
    this.renderAsm();
    this.renderPieces();
    const R = $('edSplitRight');
    if (!this.cutting) {
      R.innerHTML =
        `<h3>拆分：對齊與姿勢</h3>` +
        `<div class="dim small">先用下方的朝向、尺寸工具把模型對齊彩色線框（「對齊程式模型」會對齊參與分配的區塊），再調整線框的姿勢配合模型。</div>` +
        QUICK.map(
          ([k, n, a, b]) =>
            `<label class="edSlider">${n}<input type="range" min="${a}" max="${b}" step="1" data-q="${k}" value="${this.quick[k]}"><span>${this.quick[k]}°</span></label>`,
        ).join('') +
        `<div id="edPose"></div>` +
        `<div class="btns"><button id="edPoseReset">重設姿勢</button>` +
        `<button id="edSpStart" class="primary" title="每個三角形分給最近的區塊">開始拆分（自動分配）</button></div>`;
      for (const r of R.querySelectorAll('input[data-q]')) {
        r.oninput = () => {
          this.quick[r.dataset.q] = +r.value;
          r.nextElementSibling.textContent = r.value + '°';
          this.applyPose();
        };
      }
      $('edPoseReset').onclick = () => {
        this.quick = { arm: 0, elbow: 0, leg: 0, knee: 0 };
        this.pose = {};
        this.applyPose();
        this.render();
      };
      $('edSpStart').onclick = () => this.start();
      this.renderPose();
      return;
    }
    const opts = this.included()
      .map((i) => `<option value="${i}">${escHtml(label(this.list[i].info))}</option>`)
      .join('');
    const conns = this.rig.mounts
      .map((m, mi) => {
        const ci = this.list.findIndex((x) => {
          const o = this.rig.pieces[x.slot];
          return o && o.parent && o.parent.parent === m.node;
        });
        const pi = this.list.findIndex((x) => x.slot === m.slot);
        if (ci < 0 || pi < 0 || this.off.has(this.list[ci].slot) || this.off.has(this.list[pi].slot))
          return '';
        return `<option value="${mi}">${escHtml(label(this.list[pi].info))} → ${escHtml(label(this.list[ci].info))}（${escHtml(CONN_NAMES[m.name] || m.name)}）</option>`;
      })
      .join('');
    R.innerHTML =
      `<h3>拆分：分配</h3>` +
      `<div class="dim small">左側點選區塊（或點畫面上的模型）作為框選目標。</div>` +
      `<div class="btns"><button id="edSpAuto" title="依目前的姿勢重新分配（排除的三角形保留）">重新自動分配</button>` +
      `<button id="edSpBox" title="在畫面上拖曳框選，改分給選中的區塊（框選時不能旋轉視角）">框選</button></div>` +
      `<label class="tog small"><input type="checkbox" id="edSpFront" checked> 只選朝向鏡頭的面</label>` +
      `<label class="tog small"><input type="checkbox" id="edSpDrop"> 框選改成「排除」（不存進任何區塊）</label>` +
      `<label class="tog small"><input type="checkbox" id="edSpColor"${this.colorView ? ' checked' : ''}> 以區塊顏色顯示</label>` +
      `<div class="btns"><button id="edSpUndo">↶ 復原</button><button id="edSpRedo">↷ 重做</button></div>` +
      `<h3>平面切割（切開並補面）</h3>` +
      `<div class="edRow"><select id="edCutConn">${conns}</select><button id="edCutPlace">放到連接點</button></div>` +
      `<div class="edRow"><label>背面 <select id="edCutA">${opts}</select></label><label>正面（箭頭）<select id="edCutB">${opts}</select></label></div>` +
      `<div class="edRow"><label>半徑 <input id="edCutR" type="number" min="0.01" step="0.05" value="${+this.radius.toFixed(3)}"> m</label>` +
      `<button id="edCutShow" title="顯示切割平面並用箭頭（W 移動、E 旋轉）調整">顯示平面</button><button id="edCutGo" class="primary">切開</button></div>` +
      `<div class="dim small">只切分給這兩個區塊、且在半徑範圍內的三角形：平面正面（箭頭方向）分給「正面」的區塊，背面分給「背面」的區塊。</div>` +
      `<h3>存檔</h3>` +
      `<label class="tog small"><input type="checkbox" id="edSpOpt" checked> 存檔時減面到各區塊的預算</label>` +
      `<div class="btns"><button id="edSpSave" class="primary">全部存到槽位</button><button id="edSpBack">回到對齊</button></div>` +
      `<div class="dim small">每個區塊轉成拉直靜止姿勢下的區塊座標（原點＝關節）存進各自的槽位；之後可在「組裝調整」微調連接點。</div>`;
    $('edSpAuto').onclick = () => this.reassign();
    $('edSpBox').onclick = () => this.setBox(!this.boxMode);
    $('edSpColor').onchange = () => {
      this.colorView = $('edSpColor').checked;
      this.display();
    };
    $('edSpUndo').onclick = () => this.step(true);
    $('edSpRedo').onclick = () => this.step(false);
    $('edCutPlace').onclick = () => this.placeAt(+$('edCutConn').value);
    $('edCutR').onchange = () => {
      const r = parseFloat($('edCutR').value);
      if (r > 0) this.setRadius(r);
    };
    $('edCutShow').onclick = () => this.showPlane(!this.plane.visible);
    $('edCutGo').onclick = () => this.cut();
    $('edSpSave').onclick = () => this.saveAll();
    $('edSpBack').onclick = () => this.back();
    this.setBox(this.boxMode);
    this.setRadius(this.radius);
    this.showPlane(this.plane.visible);
    this.renderUndo();
  }
  renderUndo() {
    if ($('edSpUndo')) $('edSpUndo').disabled = !this.undo.length;
    if ($('edSpRedo')) $('edSpRedo').disabled = !this.redo.length;
  }
  // 零件組合（拆出的區塊存進這些零件的槽位）
  renderAsm() {
    const box = $('edAsm');
    box.innerHTML = WS_SLOTS.map(([key, name, list]) => {
      const o = PARTS[list]
        .map(
          (p) =>
            `<option value="${p.id}"${p.id === this.asm[key] ? ' selected' : ''}>${escHtml(p.name)}</option>`,
        )
        .join('');
      return `<label>${name}<select data-k="${key}"${this.cutting ? ' disabled' : ''}>${o}</select></label>`;
    }).join('');
    for (const s of box.querySelectorAll('select'))
      s.onchange = () => {
        this.asm = sanitizeAsm({ ...this.asm, [s.dataset.k]: s.value });
        this.buildRig();
        this.render();
      };
  }
  renderPieces() {
    const n = this.counts();
    const rows = this.list.map((x, i) => {
      const on = !this.off.has(x.slot);
      const c = n.get(i) || 0;
      const entry = MODEL_CATALOG.find((e) => e.id === x.slot);
      const B = budgetFor(entry ? entry.spec : 'piece');
      const lv = c > B.tris * 1.5 ? 'error' : c > B.tris ? 'warn' : '';
      return (
        `<div class="edPc${i === this.cur ? ' sel' : ''}${on ? '' : ' off'}" data-i="${i}">` +
        `<input type="checkbox" data-on="${i}"${on ? ' checked' : ''}${this.cutting ? ' disabled' : ''} title="參與分配">` +
        `<i style="background:#${x.color.getHexString()}"></i><span class="nm">${escHtml(label(x.info))}</span>` +
        (this.cutting
          ? `<span class="small ${lv}" title="建議 ≤ ${B.tris}">${c.toLocaleString()}</span>`
          : '') +
        `</div>`
      );
    });
    if (this.cutting) {
      const none = n.get(NONE) || 0,
        drop = n.get(DROP) || 0;
      rows.push(
        `<div class="small dim">共 ${triTotal(this.soup).toLocaleString()} 面・未分配 ${none.toLocaleString()}・排除 ${drop.toLocaleString()}</div>`,
      );
    }
    const box = $('edPieces');
    box.innerHTML = rows.join('');
    for (const r of box.querySelectorAll('.edPc'))
      r.onclick = (e) => {
        const i = +r.dataset.i;
        if (e.target.dataset.on !== undefined) {
          if (e.target.checked) this.off.delete(this.list[i].slot);
          else this.off.add(this.list[i].slot);
          r.classList.toggle('off', !e.target.checked);
          return;
        }
        this.select(i);
      };
  }
  // 選中區塊的關節旋轉（加在快速姿勢之上）
  renderPose() {
    const box = $('edPose');
    if (!box) return;
    const x = this.list[this.cur];
    if (!x) return (box.innerHTML = '');
    const v = this.pose[x.slot] || [0, 0, 0];
    box.innerHTML =
      `<div class="small">${escHtml(label(x.info))}的關節旋轉（°）</div><div class="edRow">` +
      ['X', 'Y', 'Z']
        .map(
          (a, k) =>
            `<label><i class="ax-${a.toLowerCase()}">${a}</i><input type="number" step="5" data-k="${k}" value="${v[k]}"></label>`,
        )
        .join('') +
      `</div>`;
    for (const inp of box.querySelectorAll('input'))
      inp.onchange = () => {
        const r = [...(this.pose[x.slot] || [0, 0, 0])];
        r[+inp.dataset.k] = parseFloat(inp.value) || 0;
        if (r.every((a) => !a)) delete this.pose[x.slot];
        else this.pose[x.slot] = r;
        this.applyPose();
      };
  }
}
