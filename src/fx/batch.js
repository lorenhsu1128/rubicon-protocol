// ============================================================
//  粒子批次：同一種幾何＋混合模式的粒子共用一個 InstancedMesh，一次 draw call 畫完。
//  每顆粒子是一個不在場景裡的 Object3D（代理），照舊改 position／scale／rotation／quaternion、lookAt，
//  以及 material.opacity／material.color（代理的 material 只是 { color, opacity }）；
//  flush() 把所有代理的矩陣與顏色＋透明度（每個實例的 iCol 屬性）寫進批次。
//  透明的批次：MeshBasicMaterial 改著色器，顏色＝白色 × iCol.rgb、透明度＝iCol.a；
//  不透明的（碎片、彈殼）：MeshStandardMaterial（同一個顏色，一樣經過渲染風格的著色器）。
//  attached（推進器光暈、子彈這種一直存在、由別處移除的）：代理掛在場景或別的群組裡（沒有幾何，不會畫），
//  別處照舊 scene.remove(代理或群組)／visible＝false；flush 只畫掛在場景底下且一路看得到的（用世界矩陣），
//  不在場景底下的放掉。代理的 owner（實體）在戰爭迷霧裡（fogHid）時也不畫。
// ============================================================

const START = 128; // 初始容量（不夠時加倍）

// 每個實例的顏色與透明度
function patchBasic(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader =
      'attribute vec4 iCol;\nvarying vec4 vICol;\n' +
      sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvICol = iCol;');
    sh.fragmentShader =
      'varying vec4 vICol;\n' +
      sh.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse * vICol.rgb, opacity * vICol.a );',
      );
  };
  mat.customProgramCacheKey = () => 'fxBatch';
  return mat;
}

export class FxBatch {
  // o：{ blending, side, renderOrder, attached, std: { color, roughness, metalness }（不透明的標準材質）}
  constructor(scene, geo, o = {}) {
    this.scene = scene;
    this.std = !!o.std;
    this.attached = !!o.attached;
    this.renderOrder = o.renderOrder || 0;
    this.geo = geo.clone(); // iCol 屬性掛在自己的幾何上（原本的幾何別處還在用）
    this.mat = this.std
      ? new THREE.MeshStandardMaterial(o.std)
      : patchBasic(
          new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            depthWrite: false,
            blending: o.blending === undefined ? THREE.AdditiveBlending : o.blending,
            side: o.side || THREE.FrontSide,
          }),
        );
    this.items = [];
    this.free = [];
    this.cap = 0;
    this.mesh = null;
    this.grow(START);
  }
  grow(cap) {
    const old = this.mesh;
    this.cap = cap;
    this.col = new Float32Array(cap * 4);
    const ic = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    if (this.geo.attributes.iCol) this.geo.deleteAttribute('iCol');
    if (!this.std) this.geo.setAttribute('iCol', ic);
    this.iCol = ic;
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // 實例散在整個場地，幾何的外接球沒有意義
    m.count = 0;
    m.visible = false;
    m.renderOrder = this.renderOrder;
    m.userData.noFade = true;
    m.userData.fxBatch = true;
    if (old) {
      this.scene.remove(old);
      old.dispose && old.dispose();
      // 幾何的 iCol 換成新的緩衝區：舊的 GPU 緩衝區要釋放並讓繫結重建
      this.geo.dispose();
    }
    this.scene.add(m);
    this.mesh = m;
  }
  // 取一個代理（重設變換、顏色與透明度）；attached 時掛到 parent（預設場景）底下，owner＝所屬的實體
  get(color, opacity, parent = null, owner = null) {
    let p = this.attached ? null : this.free.pop();
    if (p) {
      p.position.set(0, 0, 0);
      p.rotation.set(0, 0, 0); // 同時把 quaternion 設成單位
      p.scale.set(1, 1, 1);
    } else {
      p = new THREE.Object3D(); // matrixAutoUpdate 保留：lookAt 要用到最新的矩陣
      // quaternion 改了不回寫 rotation（每格設朝向的火花省掉換算）：粒子只會「改 rotation 再轉換」或「直接設朝向」，
      // 不會設了朝向再讀 rotation；重複使用時 rotation 一律歸零
      p.quaternion._onChange(() => {});
      p.material = { color: new THREE.Color(), opacity: 1, dispose() {} };
      p.isFxProxy = true;
    }
    p.material.color.set(color);
    p.material.opacity = opacity;
    p.fxBatch = this;
    p.owner = owner;
    p._bi = this.items.length;
    this.items.push(p);
    if (this.attached) (parent || this.scene).add(p);
    return p;
  }
  release(p) {
    const it = this.items,
      i = p._bi;
    if (it[i] !== p) return;
    const last = it.pop();
    if (last !== p) {
      it[i] = last;
      last._bi = i;
    }
    p._bi = -1;
    p.fxBatch = null;
    if (this.free.length < 2048) this.free.push(p);
  }
  clear() {
    if (this.attached) return; // 由別處擁有（推進器光暈），照舊留著
    for (const p of this.items) {
      p._bi = -1;
      p.fxBatch = null;
    }
    this.items.length = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }
  flush() {
    const it = this.items;
    if (this.attached) {
      // 不在場景底下的放掉；看不到的（自己或上層 visible＝false、所屬實體在迷霧裡）這一格不畫（_hide）
      const S = this.scene;
      let j = 0;
      for (let i = 0; i < it.length; i++) {
        const p = it[i];
        let o = p,
          vis = !(p.owner && p.owner.fogHid);
        while (o && o !== S) {
          if (!o.visible) vis = false;
          o = o.parent;
        }
        if (!o) {
          p._bi = -1;
          p.fxBatch = null;
          p.owner = null;
          continue;
        }
        p._hide = !vis;
        p._bi = j;
        it[j++] = p;
      }
      it.length = j;
    }
    let n = it.length;
    if (n > this.cap) {
      let c = this.cap;
      while (c < n) c *= 2;
      this.grow(c);
    }
    const m = this.mesh;
    const M = m.instanceMatrix.array,
      C = this.col;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const p = it[i];
      let e;
      if (this.attached) {
        if (p._hide) continue;
        if (p.parent === this.scene) e = p.matrix.compose(p.position, p.quaternion, p.scale).elements;
        else {
          p.updateWorldMatrix(true, false); // 掛在群組裡（子彈）：連同上層算世界矩陣
          e = p.matrixWorld.elements;
        }
      } else e = p.matrix.compose(p.position, p.quaternion, p.scale).elements;
      const o = w * 16;
      for (let k = 0; k < 16; k++) M[o + k] = e[k];
      if (!this.std) {
        const c = p.material.color,
          q = w * 4;
        C[q] = c.r;
        C[q + 1] = c.g;
        C[q + 2] = c.b;
        C[q + 3] = p.material.opacity;
      }
      w++;
    }
    n = m.count = w;
    m.visible = w > 0;
    if (!n) return;
    m.instanceMatrix.updateRange.offset = 0;
    m.instanceMatrix.updateRange.count = n * 16;
    m.instanceMatrix.needsUpdate = true;
    if (!this.std) {
      this.iCol.updateRange.offset = 0;
      this.iCol.updateRange.count = n * 4;
      this.iCol.needsUpdate = true;
    }
  }
}

// ============================================================
//  圓形假影子（RTS 渲染設定：單位不投影，腳下改畫一個淡淡的圓）：所有單位共用一個 InstancedMesh。
//  update(list, ground) 每格重寫：list＝實體陣列，ground(e)＝腳下地面高度。離地越高越淡。
// ============================================================
let BLOB_TEX = null;
function blobTex() {
  if (BLOB_TEX) return BLOB_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  BLOB_TEX = new THREE.CanvasTexture(c);
  return BLOB_TEX;
}
export class BlobShadows {
  constructor(scene, alpha = 0.6) {
    this.scene = scene;
    this.alpha = alpha;
    this.geo = new THREE.PlaneGeometry(2, 2);
    this.geo.rotateX(-Math.PI / 2); // 平放（矩陣只要縮放＋位移）
    this.mat = patchBasic(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        map: blobTex(),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    this.cap = 0;
    this.mesh = null;
    this.grow(256);
  }
  grow(cap) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.geo.dispose();
    }
    this.cap = cap;
    this.col = new Float32Array(cap * 4); // rgb＝0（黑），a＝濃淡
    this.iCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iCol', this.iCol);
    const m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.renderOrder = -1; // 透明物件裡最先畫（壓在地面上，其他特效在它上面）
    m.userData.noFade = true;
    m.userData.fxBatch = true;
    this.scene.add(m);
    this.mesh = m;
  }
  update(list, ground) {
    if (list.length > this.cap) {
      let c = this.cap;
      while (c < list.length) c *= 2;
      this.grow(c);
    }
    const M = this.mesh.instanceMatrix.array,
      C = this.col;
    let n = 0;
    for (const e of list) {
      const gy = ground(e);
      const h = e.pos.y - gy;
      const a = this.alpha * Math.max(0.25, Math.min(1, 1 - h / 25));
      const r = Math.max(1.1, (e.radius || 1.3) * 1.4) * (h > 1 ? 1 + Math.min(h, 20) * 0.02 : 1);
      const o = n * 16;
      M[o] = r;
      M[o + 1] = M[o + 2] = M[o + 3] = M[o + 4] = 0;
      M[o + 5] = 1;
      M[o + 6] = M[o + 7] = M[o + 8] = M[o + 9] = 0;
      M[o + 10] = r;
      M[o + 11] = 0;
      M[o + 12] = e.pos.x;
      M[o + 13] = gy + 0.08;
      M[o + 14] = e.pos.z;
      M[o + 15] = 1;
      const q = n * 4;
      C[q] = C[q + 1] = C[q + 2] = 0;
      C[q + 3] = a;
      n++;
    }
    const m = this.mesh;
    m.count = n;
    m.visible = n > 0;
    if (!n) return;
    m.instanceMatrix.updateRange.offset = 0;
    m.instanceMatrix.updateRange.count = n * 16;
    m.instanceMatrix.needsUpdate = true;
    this.iCol.updateRange.offset = 0;
    this.iCol.updateRange.count = n * 4;
    this.iCol.needsUpdate = true;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}
