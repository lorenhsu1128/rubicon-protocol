// GLB 編輯器的全身參考：把整台機甲的其他區塊擺在編輯中區塊的周圍。
// 零件組合＝目前模型組記住的組合（組裝調整頁）換上這個零件；模型＝目前模型組的 GLB（沒有的用程式模型）。
// 以這個區塊在機甲裡的位置為準：整台機甲放在容器裡，容器的矩陣＝這個區塊（關節群組）世界矩陣的反矩陣，
// 所以編輯中的模型（在原點）和周圍的區塊對得上；這個區塊本身在機甲裡隱藏，由編輯中的模型取代。
import { OUTLINE_MAT } from '../render/geometry.js';
import { PALETTES } from '../render/materials.js';
import { applyQuick } from './pose.js';
import { buildMechWithGlb, composeAsm, disposeObject } from './stage.js';
import { restPose } from './workshop.js';

const KEY = 'rubicon_glb_ctx';
const BODY_CATS = ['head', 'core', 'arms', 'legs', 'booster', 'weapon', 'back'];
const WIRE = new THREE.MeshBasicMaterial({
  color: 0x8fa3b8,
  wireframe: true,
  transparent: true,
  opacity: 0.35,
});
const GHOST = new Map();
function ghostOf(m) {
  if (Array.isArray(m)) return m.map(ghostOf);
  if (!GHOST.has(m)) {
    const g = m.clone();
    g.transparent = true;
    g.opacity = 0.32;
    g.depthWrite = false;
    GHOST.set(m, g);
  }
  return GHOST.get(m);
}

export class BodyContext {
  constructor(ed) {
    this.ed = ed;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.userData.helper = true;
    ed.scene.add(this.group);
    this.rig = null;
    this.tok = 0;
    let st = {};
    try {
      st = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch (e) {}
    this.on = st.on !== false;
    this.look = ['ghost', 'wire', 'solid'].includes(st.look) ? st.look : 'ghost';
  }
  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ on: this.on, look: this.look }));
    } catch (e) {}
  }
  applicable(e = this.ed.entry) {
    return !!(e && e.piece && BODY_CATS.includes(e.cat));
  }
  clear() {
    if (this.rig) {
      this.group.remove(this.rig.group);
      disposeObject(this.rig.group);
    }
    this.rig = null;
  }
  // 重建（換槽位、換模型組、其他區塊或關節設定改了）
  async build() {
    const tok = ++this.tok;
    const ed = this.ed;
    const e = ed.entry;
    if (!this.on || !this.applicable(e)) {
      this.clear();
      this.done();
      return;
    }
    const set = ed.store.curSet();
    let res;
    try {
      res = await buildMechWithGlb(composeAsm(e, set && set.asm), PALETTES.player, ed.store);
    } catch (err) {
      console.warn('body context failed', err);
      return;
    }
    if (tok !== this.tok) return disposeObject(res.rig.group);
    this.clear();
    const rig = res.rig;
    this.rig = rig;
    const own = rig.pieces[e.id];
    if (own) own.visible = false;
    this.group.add(rig.group);
    this.applyLook();
    this.pose();
    this.done();
  }
  done() {
    const ed = this.ed;
    if (ed.ref) ed.ref.attach();
    ed.applyShow();
    const note = document.getElementById('edCtxNote');
    if (note)
      note.textContent = !this.applicable()
        ? '選擇機甲區塊或武器的槽位後，可以顯示整台機甲的其他區塊'
        : this.rig && !this.rig.pieces[ed.entry.id]
          ? '這個區塊不在目前的零件組合裡'
          : '零件組合沿用組裝調整頁；其他區塊用目前模型組的 GLB';
  }
  // 姿勢（拉直靜止＋快速姿勢）後，把容器擺到「這個區塊在原點」的位置
  pose() {
    const rig = this.rig;
    if (!rig) return;
    restPose(rig);
    applyQuick(rig, this.ed.ref ? this.ed.ref.q : null);
    const own = rig.pieces[this.ed.entry.id];
    this.group.matrix.identity();
    this.group.updateMatrixWorld(true);
    if (own) this.group.matrix.copy(own.matrixWorld).invert();
    this.group.updateMatrixWorld(true);
  }
  applyLook() {
    if (!this.rig) return;
    const lk = this.look;
    this.rig.group.traverse((o) => {
      if (!o.isMesh || (o.parent && o.parent.userData.helper)) return; // 參考圖平面不改
      if (o.material === OUTLINE_MAT) {
        o.visible = lk === 'solid';
        return;
      }
      if (!o.userData.ctxOrig) o.userData.ctxOrig = o.material;
      o.material = lk === 'solid' ? o.userData.ctxOrig : lk === 'wire' ? WIRE : ghostOf(o.userData.ctxOrig);
      o.castShadow = lk === 'solid';
    });
  }
}
