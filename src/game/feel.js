// Game 的 mixin：遠程射擊改版第 5 期「手感與回饋」的畫面（判定在 entities/mech-feel.js）：
// 命中標記（準星上的 ×，依武器的顏色、重擊放大）、命中確認音、主動裝填的提示
import * as THREE from 'three';
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { FEEL } from '../data/feel.js';

const MARK_COL = {
  bullet: '#ffffff',
  shotgun: '#ffd890',
  shell: '#ff9a50',
  grenade: '#ff9a50',
  laser: '#9fd8ff',
};

Object.assign(Game.prototype, {
  hitMarkLocal(type, heavy) {
    this.hmk = {
      t: FEEL.MARK_T * (heavy ? 1.6 : 1),
      max: FEEL.MARK_T * (heavy ? 1.6 : 1),
      c: MARK_COL[type] || '#fff',
      h: heavy,
    };
    SFX.hitConfirm(type, heavy);
  },
  // 主動裝填的結果（只給本人）
  arFx(slot, ok) {
    const p = this.player;
    const w = p && p.weapons[slot];
    if (w) w.arFxT = { ok, t: 0.8 };
    if (ok) {
      SFX.play('uiOk', 0.55, 1.3, 0.02, 0.05, null, 'ui');
      SFX.play('plate1', 0.4, 1.4, 0.03, 0.05, null, 'ui');
    } else SFX.play('uiErr', 0.5, 0.8, 0.02, 0.05, null, 'ui');
  },
  // 地面的彈痕（玩家的子彈打在地上）：小的暗色圓斑，幾秒後淡出；機槍每 0.06 秒最多一個
  bulletMark(p, type) {
    const w = this.world;
    if (!w || !this.fx || this.fx.skip(p)) return;
    const gy = w.terrainHeight(p.x, p.z);
    if (Math.abs(p.y - gy) > 1.2 * this.fx.k) return; // 只在地面（牆與物件照舊只有火花）
    const t = this.time || 0;
    if (t - (this.bmT || -9) < 0.06) return;
    this.bmT = t;
    const m = new THREE.Mesh(
      this.fx.discGeo,
      new THREE.MeshBasicMaterial({
        color: 0x14110e,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
      }),
    );
    m.position.set(p.x, gy + 0.05, p.z);
    m.rotation.x = -Math.PI / 2;
    m.scale.setScalar((type === 'shotgun' ? 0.22 : 0.3) * this.fx.k);
    m.userData.noFade = true;
    this.fx.add(m, 5, (e, k) => {
      e.mesh.material.opacity = 0.5 * (k < 0.7 ? 1 : (1 - k) / 0.3);
    });
  },
  // HUD：命中標記（準星的位置；俯視時畫在滑鼠準星，追尾／第一人稱畫在畫面中央）
  hitMarkHud(c, W, H, dt) {
    const m = this.hmk;
    if (!m || m.t <= 0) return;
    m.t -= dt;
    let x = W / 2,
      y = H / 2;
    if (!this.chase && !this.fp) {
      x = this.mouse.x;
      y = this.mouse.y;
      if (this.padActive && this.mouseWorld) {
        const s = this.proj(this.mouseWorld);
        x = s.x;
        y = s.y;
      }
    }
    const k = clamp(m.t / m.max, 0, 1);
    const r0 = (m.h ? 9 : 6) + (1 - k) * 4,
      r1 = r0 + (m.h ? 9 : 6);
    c.save();
    c.globalAlpha = 0.4 + 0.6 * k;
    c.strokeStyle = m.c;
    c.lineWidth = m.h ? 3 : 2;
    c.shadowColor = 'rgba(0,0,0,.8)';
    c.shadowBlur = 3;
    c.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      c.moveTo(x + sx * r0, y + sy * r0);
      c.lineTo(x + sx * r1, y + sy * r1);
    }
    c.stroke();
    c.restore();
  },
});
