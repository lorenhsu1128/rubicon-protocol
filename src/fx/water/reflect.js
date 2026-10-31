// 水面的平面反射（品質「高」，docs/water-design.md）：鏡頭對水面做鏡像（照 three.js 的 Reflector：鏡像的位置、
// 注視點與上方向，近平面換成水面的斜投影），把場景畫到半解析度的貼圖；水面的著色器以 uRM（世界 → 貼圖）取樣。
// 不經過後處理（只是反射），陰影沿用這一格的（不重畫）。
const _n = new THREE.Vector3(0, 1, 0),
  _p = new THREE.Vector3(),
  _cw = new THREE.Vector3(),
  _rot = new THREE.Matrix4(),
  _look = new THREE.Vector3(),
  _tgt = new THREE.Vector3(),
  _view = new THREE.Vector3(),
  _plane = new THREE.Plane(),
  _clip = new THREE.Vector4(),
  _q = new THREE.Vector4();

export class PlanarRefl {
  constructor() {
    this.rt = new THREE.WebGLRenderTarget(4, 4, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    this.cam = new THREE.PerspectiveCamera();
    this.M = new THREE.Matrix4(); // 世界 → 反射貼圖
  }
  get tex() {
    return this.rt.texture;
  }
  // hide：畫反射時要藏起來的物件（水面本身）
  render(R, scene, camera, level, hide, k = 0.5) {
    const sz = R.getDrawingBufferSize(new THREE.Vector2());
    const W = Math.max(64, Math.round(sz.x * k)),
      H = Math.max(64, Math.round(sz.y * k));
    if (this.rt.width !== W || this.rt.height !== H) this.rt.setSize(W, H);
    _cw.setFromMatrixPosition(camera.matrixWorld);
    if (_cw.y < level) return false; // 鏡頭在水面下：不畫
    _view.set(_cw.x, 2 * level - _cw.y, _cw.z);
    _rot.extractRotation(camera.matrixWorld);
    _look.set(0, 0, -1).applyMatrix4(_rot).add(_cw);
    _tgt.copy(_look);
    _tgt.y = 2 * level - _look.y;
    const vc = this.cam;
    vc.position.copy(_view);
    vc.up.set(0, 1, 0).applyMatrix4(_rot);
    vc.up.y = -vc.up.y;
    vc.lookAt(_tgt);
    vc.far = camera.far;
    vc.near = camera.near;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    this.M.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.M.multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);
    // 斜投影：近平面＝水面（水面以下的東西不畫進反射）
    _plane.setFromNormalAndCoplanarPoint(_n, _p.set(0, level, 0));
    _plane.applyMatrix4(vc.matrixWorldInverse);
    _clip.set(_plane.normal.x, _plane.normal.y, _plane.normal.z, _plane.constant);
    const pm = vc.projectionMatrix.elements;
    _q.x = (Math.sign(_clip.x) + pm[8]) / pm[0];
    _q.y = (Math.sign(_clip.y) + pm[9]) / pm[5];
    _q.z = -1;
    _q.w = (1 + pm[10]) / pm[14];
    _clip.multiplyScalar(2 / _clip.dot(_q));
    pm[2] = _clip.x;
    pm[6] = _clip.y;
    pm[10] = _clip.z + 1;
    pm[14] = _clip.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();
    const vis = hide.map((o) => o.visible);
    for (const o of hide) o.visible = false;
    const rt0 = R.getRenderTarget(),
      au = R.shadowMap.autoUpdate,
      nu = R.shadowMap.needsUpdate;
    try {
      R.shadowMap.autoUpdate = false;
      R.shadowMap.needsUpdate = false;
      R.setRenderTarget(this.rt);
      R.state.buffers.depth.setMask(true);
      R.clear();
      R.render(scene, vc);
    } finally {
      R.setRenderTarget(rt0);
      R.shadowMap.autoUpdate = au;
      R.shadowMap.needsUpdate = nu;
      hide.forEach((o, i) => (o.visible = vis[i]));
    }
    return true;
  }
  dispose() {
    this.rt.dispose();
  }
}
