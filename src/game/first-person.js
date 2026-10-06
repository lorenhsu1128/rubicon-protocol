// ============================================================
//  FIRST PERSON — 第一人稱視角（玩家／觀戰）、指標鎖定、視錐自動鎖定、雷達與羅盤
// ============================================================
import { clamp, rnd } from '../core/math.js';
import { FP_CONE, FP_FOV, TP_FOV } from './constants.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  fpInit() {
    this.fp = false;
    this.fpYaw = 0;
    this.fpPitch = 0;
    this.fpHidden = null;
    const c = this.canvas;
    document.addEventListener('pointerlockchange', () => {
      this.plocked = document.pointerLockElement === c;
    });
    addEventListener('mousemove', (e) => {
      if (this.fp && this.plocked && this.state === 'play' && !this.spectator) {
        const s = (this.ctrl.sens || 1) * 0.0022;
        this.fpYaw -= e.movementX * s;
        this.fpPitch = clamp(this.fpPitch - e.movementY * s, -1.1, 0.9);
      }
    });
    c.addEventListener('mousedown', () => {
      if (this.fp && !this.plocked && this.state === 'play' && !this.spectator && !this.touchActive) {
        try {
          c.requestPointerLock();
        } catch (e) {}
      }
    });
    // 觸控：右半邊拖曳轉視角
    let tid = null,
      tx = 0,
      ty = 0;
    c.addEventListener(
      'touchstart',
      (e) => {
        if (!this.fp || this.state !== 'play') return;
        const t = e.changedTouches[0];
        if (t.clientX > innerWidth * 0.45) {
          const el = document.elementFromPoint(t.clientX, t.clientY);
          if (el && el.closest && el.closest('#vpad')) return;
          tid = t.identifier;
          tx = t.clientX;
          ty = t.clientY;
        }
      },
      { passive: true },
    );
    c.addEventListener(
      'touchmove',
      (e) => {
        if (tid === null) return;
        for (const t of e.changedTouches)
          if (t.identifier === tid) {
            const s = (this.ctrl.sens || 1) * 0.006;
            this.fpYaw -= (t.clientX - tx) * s;
            this.fpPitch = clamp(this.fpPitch - (t.clientY - ty) * s, -1.1, 0.9);
            tx = t.clientX;
            ty = t.clientY;
          }
      },
      { passive: true },
    );
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === tid) tid = null;
    };
    c.addEventListener('touchend', end);
    c.addEventListener('touchcancel', end);
  },
  setFp(on) {
    if (this.fp === on) return;
    this.fp = on;
    this.camera.fov = on ? FP_FOV : TP_FOV;
    this.camera.updateProjectionMatrix();
    if (this.camScratch) {
      this.camScratch.fov = TP_FOV;
      this.camScratch.updateProjectionMatrix();
    }
    if (on) {
      const p = this.player;
      if (p) {
        this.fpYaw = p.aimYaw;
        this.fpPitch = 0;
      }
      if (!this.spectator && !this.touchActive) {
        try {
          this.canvas.requestPointerLock();
        } catch (e) {}
      }
      this.flashMsg('第一人稱視角（V 切換）', 0xffb020, 1.2);
    } else {
      this.fpShow();
      if (document.pointerLockElement) {
        try {
          document.exitPointerLock();
        } catch (e) {}
      }
      this.flashMsg('第三人稱視角', 0xffb020, 1.0);
    }
  },
  fpLookDir(yaw, pitch) {
    return new THREE.Vector3(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
  },
  fpHide(e) {
    if (this.fpHidden === e) return;
    this.fpShow();
    if (!e || !e.model) return;
    const m = e.model;
    this.fpHidden = e;
    this._fpVis = [];
    const hide = (o) => {
      this._fpVis.push([o, o.visible]);
      o.visible = false;
    };
    if (m.legsG) hide(m.legsG);
    if (m.head && m.head !== m.torso) hide(m.head);
    if (m.torso) {
      // 第一人稱只留雙臂（肩部連接點以下），核心、頭、背包、肩上武器都隱藏
      const keep = m.arms ? [m.arms.l.mount, m.arms.r.mount].filter(Boolean) : [];
      for (const ch of m.torso.children) if (!keep.includes(ch)) hide(ch);
    }
    if (e.glare) for (const g of e.glare) hide(g);
  },
  fpShow() {
    if (this._fpVis) {
      for (const [o, v] of this._fpVis) o.visible = v;
    }
    this._fpVis = null;
    this.fpHidden = null;
  },
  // 視錐內離準星最近的敵人；Tab 在錐內循環
  fpPickLock(p, cycle) {
    const look = this.fpLookDir(this.fpYaw, this.fpPitch);
    const eye = this.fpEye(p);
    const cands = [];
    for (const e of this.hostilesOfEnt(p)) {
      if (e.dead) continue;
      const d = e.center().sub(eye);
      const dist = d.length();
      if (dist > p.stats.lockRange * 1.4 || dist < 0.5) continue;
      const ang = Math.acos(clamp(d.normalize().dot(look), -1, 1));
      if (ang < FP_CONE) cands.push({ e, ang });
    }
    cands.sort((a, b) => a.ang - b.ang);
    if (!cands.length) {
      p.lock = null;
      return;
    }
    if (cycle) {
      const i = cands.findIndex((c) => c.e === p.lock);
      p.lock = cands[(i + 1) % cands.length].e;
      return;
    }
    if (p.lock && cands.some((c) => c.e === p.lock)) return;
    p.lock = cands[0].e;
  },
  fpEye(p) {
    const fwd = new THREE.Vector3(-Math.sin(this.fpYaw), 0, -Math.cos(this.fpYaw));
    return p.pos
      .clone()
      .add(new THREE.Vector3(0, p.model.height * 0.86, 0))
      .addScaledVector(fwd, 0.35);
  },
  // 第一人稱鏡頭（玩家或觀戰對象 ent）
  fpCamera(ent, dt, yaw, pitch) {
    const eye = this.fpEye(ent);
    const look = this.fpLookDir(yaw, pitch);
    if (this.camShake > 0) {
      this.camShake -= dt;
      const a = Math.min(1, this.camShake * 4) * 0.35;
      eye.x += rnd(-0.3, 0.3) * a;
      eye.y += rnd(-0.2, 0.2) * a;
      eye.z += rnd(-0.3, 0.3) * a;
    }
    this.camera.position.copy(eye);
    this.camera.lookAt(eye.clone().add(look));
    this.camTarget.copy(ent.pos);
    this.sun.position.copy(ent.pos).add(this.sunOff);
    this.sun.target.position.copy(ent.pos);
    this.fpHide(ent);
    this.rangeRing.visible = false;
  },
  // 雷達與羅盤
  drawFpHud(c, W, H, p) {
    const yaw = this.fpYaw; // 羅盤
    const cw = Math.min(420, W * 0.5),
      cx = W / 2,
      cy = document.body.classList.contains('vpad') ? 52 : 28;
    c.fillStyle = 'rgba(8,12,18,.5)';
    c.fillRect(cx - cw / 2, cy - 10, cw, 20);
    c.strokeStyle = '#ffb020';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(cx, cy - 12);
    c.lineTo(cx, cy + 12);
    c.stroke();
    const names = ['N', 'E', 'S', 'W'];
    for (let k = 0; k < 4; k++) {
      let rel = (-yaw - (k * Math.PI) / 2 + Math.PI) % (Math.PI * 2);
      if (rel < 0) rel += Math.PI * 2;
      rel -= Math.PI;
      const x = cx - (rel / (Math.PI / 2)) * (cw / 2) * 0.5;
      if (Math.abs(x - cx) < cw / 2 - 8) {
        c.fillStyle = '#e6edf3';
        c.font = 'bold 11px Chakra Petch';
        c.textAlign = 'center';
        c.fillText(names[k], x, cy + 4);
      }
    }
    for (const e of this.hostilesOfEnt(p)) {
      if (e.dead) continue;
      const d = e.pos.clone().sub(p.pos);
      const a = Math.atan2(-d.x, -d.z);
      let rel = (a - yaw + Math.PI) % (Math.PI * 2);
      if (rel < 0) rel += Math.PI * 2;
      rel -= Math.PI;
      const x = cx - (rel / (Math.PI / 2)) * (cw / 2) * 0.5;
      if (Math.abs(x - cx) < cw / 2 - 4) {
        c.fillStyle = e.isBoss ? '#ff4d4d' : e === p.lock ? '#ffb020' : '#ff8a8a';
        c.fillRect(x - 2, cy - 7, 4, 14);
      }
    }
    // 雷達（半徑 60 m）
    const R = 62,
      rx = document.body.classList.contains('vpad') ? W - 90 : 96,
      ry = document.body.classList.contains('vpad') ? H / 2 : H - 330;
    c.fillStyle = 'rgba(8,12,18,.55)';
    c.beginPath();
    c.arc(rx, ry, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(rx, ry, R, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.arc(rx, ry, R / 2, 0, Math.PI * 2);
    c.stroke();
    c.save();
    c.beginPath();
    c.arc(rx, ry, R, 0, Math.PI * 2);
    c.clip();
    c.fillStyle = 'rgba(255,176,32,.12)';
    c.beginPath();
    c.moveTo(rx, ry);
    c.arc(rx, ry, R, -Math.PI / 2 - FP_CONE, -Math.PI / 2 + FP_CONE);
    c.closePath();
    c.fill();
    const dot = (pos, col, r = 3) => {
      const d = pos.clone().sub(p.pos);
      const dx = d.x * Math.cos(yaw) + d.z * Math.sin(yaw),
        dz = -d.x * Math.sin(yaw) + d.z * Math.cos(yaw);
      const k = R / 60;
      const x = rx + dx * k,
        y = ry + dz * k;
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    };
    for (const e of this.hostilesOfEnt(p)) {
      if (!e.dead) dot(e.pos, e.isBoss ? '#ff4d4d' : e === p.lock ? '#ffb020' : '#ff7070', e.isBoss ? 5 : 3);
    }
    for (const a of this.allies) {
      if (!a.dead) dot(a.pos, '#80ffb0');
    }
    for (const q of this.players || []) {
      if (!q.dead && q !== p) dot(q.pos, this.net.slotColor(q.slot || 0), 4);
    }
    for (const v of this.vehicles || []) {
      if (!v.dead) dot(v.center(), '#ffd070', 4);
    }
    for (const pk of this.pickups || []) {
      if (!pk.dead) dot(pk.pos, '#e8ff80', 2);
    }
    c.restore();
    c.fillStyle = '#fff';
    c.beginPath();
    c.moveTo(rx, ry - 6);
    c.lineTo(rx - 4, ry + 4);
    c.lineTo(rx + 4, ry + 4);
    c.closePath();
    c.fill();
    // 中央準星
    c.strokeStyle = 'rgba(255,255,255,.85)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(W / 2, H / 2, 12, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(W / 2 - 22, H / 2);
    c.lineTo(W / 2 - 8, H / 2);
    c.moveTo(W / 2 + 8, H / 2);
    c.lineTo(W / 2 + 22, H / 2);
    c.moveTo(W / 2, H / 2 - 22);
    c.lineTo(W / 2, H / 2 - 8);
    c.moveTo(W / 2, H / 2 + 8);
    c.lineTo(W / 2, H / 2 + 22);
    c.stroke();
    if (!this.plocked && !this.touchActive && !this.padActive && !this.spectator) {
      c.font = 'bold 13px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = '#ffb020';
      c.fillText('點擊畫面鎖定滑鼠以轉動視角（Esc 釋放）', W / 2, H / 2 + 48);
    }
  },
});
