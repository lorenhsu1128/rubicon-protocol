// 組裝調整頁的高度尺：機甲旁的垂直刻度尺（每 0.1 m 小刻度、0.5 m 標數字），
// 標出目前的頭頂高度、同零件組合的程式模型身高（標準），以及腳底沒有貼地時的離地高度。
// 量測略過參考圖平面（userData.helper）、描邊外殼與發光特效。標籤放在 #wsRuler，每幀投影到畫面上。
import { PALETTES } from '../render/materials.js';
import { buildMech } from '../render/mech-model.js';
import { isFxMaterial } from '../render/measure.js';
import { disposeObject } from './stage.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const COL = { ruler: 0xe6edf3, cur: 0xffb020, std: 0x7ee081, ground: 0xff5a4a };

function lineMat(color, opacity = 0.9) {
  return new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
}
function segs(points, mat) {
  const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), mat);
  l.renderOrder = 10;
  return l;
}
// 外框（世界座標），略過參考圖等輔助物件的整個子樹
export function bodyBox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(),
    tmp = new THREE.Box3();
  const walk = (o) => {
    if (!o.visible || (o.userData && o.userData.helper)) return;
    if (o.isMesh && !isFxMaterial(o.material)) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      tmp.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      box.union(tmp);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  return box;
}
const cm = (v) => Math.round(v * 100) / 100;

export class HeightRuler {
  constructor(scene, labelBox) {
    this.group = new THREE.Group();
    this.group.userData.helper = true;
    scene.add(this.group);
    this.box = labelBox;
    this.labels = [];
    this.key = '';
    this.stdKey = '';
    this.std = 0;
    this.t = 0;
  }
  // 同零件組合的程式模型身高（拉直靜止姿勢），零件組合變了才重算
  standardOf(asm) {
    const k = JSON.stringify(asm);
    if (k !== this.stdKey) {
      const rig = buildMech(asm, PALETTES.player, 1);
      this.std = Math.max(0, bodyBox(rig.group).max.y);
      disposeObject(rig.group);
      this.stdKey = k;
    }
    return this.std;
  }
  // 每幀呼叫：rig 為 null 或 on 為 false 時隱藏；量測每 0.2 秒一次，數值變了才重建線段與標籤
  update(dt, rig, asm, on, camera, w, h) {
    this.group.visible = !!(on && rig);
    this.box.style.display = this.group.visible ? '' : 'none';
    if (!this.group.visible) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = 0.2;
      const b = bodyBox(rig.group);
      if (!b.isEmpty()) this.rebuild(b, this.standardOf(asm));
    }
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      v.copy(l.pos).project(camera);
      const off = v.z > 1 || v.z < -1;
      l.el.style.display = off ? 'none' : '';
      if (off) continue;
      l.el.style.left = ((v.x + 1) / 2) * w + 'px';
      l.el.style.top = ((1 - v.y) / 2) * h + 'px';
    }
  }
  rebuild(b, std) {
    const top = cm(b.max.y),
      low = cm(b.min.y);
    const key = [top, low, cm(std), cm(b.min.x), cm(b.max.x), cm(b.min.z)].join(',');
    if (key === this.key) return;
    this.key = key;
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry.dispose();
    }
    this.box.innerHTML = '';
    this.labels = [];
    const label = (pos, text, cls) => {
      const el = document.createElement('div');
      el.className = 'lbl ' + cls;
      el.textContent = text;
      this.box.appendChild(el);
      this.labels.push({ pos, el });
    };
    const x = b.min.x - 0.6,
      z = (b.min.z + b.max.z) / 2;
    const H = Math.max(1, Math.ceil((Math.max(top, std) + 0.3) * 2) / 2);
    // 刻度尺：每 0.1 m 小刻度、每 0.5 m 大刻度＋數字
    const pts = [V(x, 0, z), V(x, H, z)];
    for (let i = 0; i <= Math.round(H * 10); i++) {
      const y = i / 10,
        major = i % 5 === 0;
      const tk = major ? 0.14 : 0.06;
      pts.push(V(x - tk, y, z), V(x, y, z));
      if (major) label(V(x - 0.16, y, z), `${y.toFixed(1)} m`, 'tick');
    }
    this.group.add(segs(pts, lineMat(COL.ruler, 0.85)));
    // 目前的頭頂、標準身高：從刻度尺橫跨到機甲另一側
    const across = (y, col, dashed) => {
      const p = [];
      if (dashed) {
        for (let t = x; t < b.max.x + 0.3; t += 0.3)
          p.push(V(t, y, z), V(Math.min(t + 0.18, b.max.x + 0.3), y, z));
      } else p.push(V(x, y, z), V(b.max.x + 0.3, y, z));
      this.group.add(segs(p, lineMat(col)));
    };
    across(top, COL.cur, false);
    const d = cm(top - std);
    if (std > 0 && Math.abs(d) < 0.01)
      label(V(b.max.x + 0.35, top, z), `身高 ${top.toFixed(2)} m（＝標準）`, 'hgt cur');
    else {
      // 兩條線很近時，較高的標籤往上、較低的往下，避免疊在一起
      const near = std > 0 && Math.abs(d) < 0.2;
      label(
        V(b.max.x + 0.35, top, z),
        `身高 ${top.toFixed(2)} m`,
        'hgt cur' + (near ? (d > 0 ? ' up' : ' down') : ''),
      );
      if (std > 0) {
        across(std, COL.std, true);
        label(
          V(b.max.x + 0.35, std, z),
          `標準 ${std.toFixed(2)} m（${d > 0 ? '+' : ''}${d.toFixed(2)}）`,
          'hgt std' + (near ? (d > 0 ? ' down' : ' up') : ''),
        );
      }
    }
    // 腳底沒有貼地：標出離地／陷入多少
    if (Math.abs(low) >= 0.02) {
      across(low, COL.ground, true);
      label(
        V(b.max.x + 0.35, low, z),
        low > 0 ? `離地 ${low.toFixed(2)} m` : `陷入地面 ${(-low).toFixed(2)} m`,
        'hgt gnd',
      );
    }
  }
  dispose() {
    for (const c of [...this.group.children]) c.geometry.dispose();
    this.group.parent && this.group.parent.remove(this.group);
    this.box.innerHTML = '';
  }
}
