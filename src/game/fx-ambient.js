// Game 的 mixin：地圖的持續特效（docs/vfx-design.md 第 4 期）：燃燒的殘骸冒煙與火星、管線的蒸氣、料斗落下的粉塵。
// 地圖建好後從可破壞物件（world.props 的種類）挑幾個點，每格在 renderMain 依特效時鐘的前進量產生顯示卡粒子
// （暫停時特效時鐘不動＝不產生）。只有外觀、各端自己算，不轉送；物件被打壞就停。
import { Game } from './game.js';

// 種類 → 特效（每秒幾次）
const SPOTS = {
  mtwreck: { k: 'burn', rate: 7 },
  pipestack: { k: 'steam', rate: 3 },
  piperun: { k: 'steam', rate: 2 },
  hopper: { k: 'dust', rate: 3 },
};
const MAX_SPOTS = 10;
const NEAR = 160; // 離鏡頭多遠以內才產生（公尺 × 尺度）

Object.assign(Game.prototype, {
  fxAmbientTick() {
    const w = this.world,
      fx = this.fx;
    if (!w || !fx) return;
    if (this.fxaW !== w) {
      // 換了地圖：重新挑點（照物件的順序，不用亂數）
      this.fxaW = w;
      this.fxaT = fx.time;
      this.fxa = [];
      for (const p of w.props || []) {
        const S = SPOTS[p.kind];
        if (!S || this.fxa.length >= MAX_SPOTS) continue;
        const ob = p.ob;
        const c = ob.box
          ? ob.box.getCenter(new THREE.Vector3())
          : new THREE.Vector3(ob.x, w.terrainHeight(ob.x, ob.z) + (ob.h || 3) / 2, ob.z);
        const top = ob.box ? ob.box.max.y : c.y + (ob.h || 3) / 2;
        this.fxa.push({ prop: p, k: S.k, rate: S.rate, p: c.setY(top), acc: Math.random() });
      }
    }
    const dt = fx.time - this.fxaT;
    this.fxaT = fx.time;
    if (!(dt > 0) || dt > 0.5 || !this.fxa.length) return;
    const cam = this.camera.position,
      near = NEAR * (fx.k || 1);
    for (const s of this.fxa) {
      if (s.prop.dead) continue;
      if (s.p.distanceToSquared(cam) > near * near) continue;
      s.acc += dt * s.rate;
      while (s.acc >= 1) {
        s.acc -= 1;
        fx.ambient(s.k, s.p);
      }
    }
  },
});
