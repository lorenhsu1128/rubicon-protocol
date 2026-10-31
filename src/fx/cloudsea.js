// 雲海（高空軌道，docs/water-design.md）：原本是一片白色的平面，改成粒子的煙霧——鏡頭周圍不斷產生大顆的煙團
// （顯示卡粒子 fx/gpu.js、一般混合），緩緩漂移、旋轉、淡入淡出，下面墊一片同色的雲底（World.addWater 建的平面），
// 從上面看是起伏的雲層。只有外觀，各端自己產生；暫停時跟著特效時鐘停住。渲染風格的粒子色階（fxCel）照樣套用。
import { GpuFx } from './gpu.js';
import { FXG, pickCell } from './atlas.js';

const N = 800; // 同時大約幾團
const LIFE = [12, 22];

export class CloudSea {
  constructor(scene) {
    this.sys = new GpuFx(scene, { add: false, cap: 1024, order: 1 });
    this.time = 0;
    this.acc = 0;
    this.warm = false;
    this._p = new THREE.Vector3();
    this._v = new THREE.Vector3();
  }
  // c：鏡頭；level：雲海的高度；color：雲的顏色；k：場景的尺度（DS）
  update(dt, c, level, color, k) {
    this.time += dt;
    const R = 150 * k; // 鏡頭周圍多遠以內
    let n = 0;
    if (!this.warm) {
      this.warm = true;
      n = N;
    } else {
      this.acc += (dt * N) / ((LIFE[0] + LIFE[1]) / 2);
      n = Math.floor(this.acc);
      this.acc -= n;
    }
    const cx = c.position.x,
      cz = c.position.z;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        r = R * Math.sqrt(Math.random());
      const p = this._p.set(
        cx + Math.cos(a) * r,
        level + (Math.random() * 4.5 - 1.5) * k,
        cz + Math.sin(a) * r,
      );
      const s = (16 + Math.random() * 18) * k;
      // 每團的亮度不同、隨壽命從亮白慢慢變成帶藍的灰（疊起來看得出雲團的起伏）
      const sh = 0.9 + Math.random() * 0.12;
      const top = new THREE.Color(color).multiplyScalar(sh).getHex();
      const low = new THREE.Color(color).multiplyScalar(sh * 0.62).lerp(new THREE.Color(0x7d8aa4), 0.3);
      this.sys.emit({
        p,
        v: this._v.set(1.6 * k, 0, 0.7 * k),
        life: LIFE[0] + Math.random() * (LIFE[1] - LIFE[0]),
        s0: s,
        s1: s * 1.35,
        c0: top,
        c1: low.getHex(),
        a: 0.75,
        occ: 1,
        cell: pickCell(FXG.smoke),
        fade: 3,
        rot: Math.random() * 6.28,
        rv: (Math.random() - 0.5) * 0.06,
      });
    }
    this.sys.update(this.time, dt);
  }
  clear() {
    this.sys.clear();
    this.warm = false;
    this.time = 0;
  }
  dispose() {
    this.clear();
    if (this.sys.mesh && this.sys.mesh.parent) this.sys.mesh.parent.remove(this.sys.mesh);
  }
}
