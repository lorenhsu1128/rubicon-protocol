// 殘影（docs/vfx-design.md 第 6 期，只給玩家自己）：複製機體當下的姿勢，畫成淡的加色剪影，GHOST_T 秒淡出。
// 網格共用原本的幾何；蒙皮網格（mesh-merge.js 的合併：每個錨點一根骨頭）另建一副骨架，骨頭的世界矩陣凍結在複製的那一刻
// （骨頭不在場景裡，不會被更新）。描邊外殼、加色與半透明的網格（推進器光暈等）略過。同時最多 MAX 個。
import { isOutline } from './geometry.js';

const GHOST_T = 0.25;
const MAX = 6;
const OPACITY = 0.24;

export class GhostFx {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
  }
  // root：機體的模型群組；color：殘影的顏色（推進器的顏色）
  snap(root, color) {
    if (this.list.length >= MAX) this.drop(this.list.shift());
    root.updateMatrixWorld(true);
    const grp = new THREE.Group();
    const mats = [],
      skels = [];
    const mk = (skin) => {
      const m = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: OPACITY,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        skinning: skin,
      });
      mats.push(m);
      return m;
    };
    let mBasic = null,
      mSkin = null;
    root.traverseVisible((o) => {
      if (
        !o.isMesh ||
        o.isInstancedMesh ||
        !o.geometry ||
        (o.userData && (o.userData.helper || o.userData.xray))
      )
        return;
      const om = Array.isArray(o.material) ? o.material[0] : o.material;
      if (
        !om ||
        isOutline(om) ||
        om.blending === THREE.AdditiveBlending ||
        (om.transparent && om.opacity < 0.9)
      )
        return;
      let g;
      if (o.isSkinnedMesh && o.skeleton) {
        const bones = o.skeleton.bones.map((b) => {
          const nb = new THREE.Bone();
          nb.matrixAutoUpdate = false;
          nb.matrixWorld.copy(b.matrixWorld);
          return nb;
        });
        const sk = new THREE.Skeleton(bones, o.skeleton.boneInverses);
        skels.push(sk);
        g = new THREE.SkinnedMesh(o.geometry, mSkin || (mSkin = mk(true)));
        g.bindMode = o.bindMode;
        g.bind(sk, o.bindMatrix);
      } else g = new THREE.Mesh(o.geometry, mBasic || (mBasic = mk(false)));
      g.matrixAutoUpdate = false;
      g.matrix.copy(o.matrixWorld);
      g.matrixWorld.copy(o.matrixWorld);
      g.frustumCulled = false;
      g.renderOrder = 3;
      g.userData.noAO = true; // 不進 SSAO 的法線圖
      g.userData.noFade = true;
      grp.add(g);
    });
    grp.matrixAutoUpdate = false;
    this.scene.add(grp);
    this.list.push({ grp, mats, skels, t: 0 });
  }
  update(dt) {
    for (const e of this.list) {
      e.t += dt;
      const o = OPACITY * Math.max(0, 1 - e.t / GHOST_T);
      for (const m of e.mats) m.opacity = o;
    }
    while (this.list.length && this.list[0].t >= GHOST_T) this.drop(this.list.shift());
  }
  drop(e) {
    this.scene.remove(e.grp);
    for (const m of e.mats) m.dispose();
    for (const s of e.skels) if (s.dispose) s.dispose();
  }
  clear() {
    for (const e of this.list) this.drop(e);
    this.list.length = 0;
  }
}
