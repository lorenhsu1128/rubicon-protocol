// Game：攝影機與觀戰目標
import { clamp, lerp, rnd } from '../core/math.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  spectateList() {
    return [
      ...this.players.filter((x) => !x.dead),
      ...this.enemies.filter((x) => !x.dead),
      ...this.allies.filter((x) => !x.dead),
    ];
  },
  // 給定注視點與縮放倍率，兩個點是否都在畫面內（NDC 邊距 margin）
  fitsAt(target, zoom, pts, margin = 0.82) {
    const off = new THREE.Vector3(0, 30, 17.5).multiplyScalar(zoom);
    this.camScratch.position.copy(target).add(off);
    this.camScratch.lookAt(target.x, target.y, target.z);
    this.camScratch.updateMatrixWorld();
    const v = new THREE.Vector3();
    for (const p of pts) {
      v.copy(p).project(this.camScratch);
      if (Math.abs(v.x) > margin || Math.abs(v.y) > margin || v.z > 1) return false;
    }
    return true;
  },
  // 找到能同時容納兩點的最小縮放（0.65 ~ 2.2）
  fitZoom(target, pts, minZ, maxZ) {
    for (let z = minZ; z <= maxZ + 1e-6; z += z < 2 ? 0.05 : 0.15) {
      if (this.fitsAt(target, z, pts)) return z;
    }
    return maxZ;
  },
  updateCamera(dt) {
    if (this.fp) {
      let ent = this.player;
      if (this.spectator) {
        ent = this.player;
        if (ent) {
          const y = ent.aimYaw,
            pt = clamp(ent.aimPitch || 0, -0.6, 0.6);
          this.fpCamera(ent, dt, y, pt);
        }
      } else if (ent && !ent.dead) {
        this.fpCamera(ent, dt, this.fpYaw, this.fpPitch);
      } else if (ent) {
        this.fpShow();
      }
      if (ent) {
        this.world.updateOcclusion(this.camera.position, ent.center(), 0);
        this.camFocus = ent;
        return;
      }
    }
    if (this.spectator) {
      this.specMode = this.specMode || 'follow';
      const alive = this.players.filter((x) => !x.dead);
      if (this.specMode === 'director' && alive.length) {
        this.specDirT = (this.specDirT || 0) + dt;
        if (this.specDirT > 1) {
          this.specDirT = 0;
          const score = (q) => {
            let s = 0;
            for (const e of this.enemies) {
              if (!e.dead && e.pos.distanceTo(q.pos) < 30) s += 1;
            }
            if (q.melee.active) s += 5;
            if (q.hp < q.maxHp * 0.4) s += 3;
            if (q.downed) s += 4;
            if (q.boost) s += 1;
            return s;
          };
          let best = null,
            bs = -1;
          for (const q of alive) {
            const s = score(q);
            if (s > bs) {
              bs = s;
              best = q;
            }
          }
          const cur = alive[this.spectateIdx % alive.length];
          this.specSince = (this.specSince || 0) + 1;
          if (best && best !== cur && this.specSince >= 5 && score(best) > score(cur) + 1) {
            this.spectateIdx = alive.indexOf(best);
            this.specSince = 0;
            this.flashMsg('導演視角 ▸ ' + best.name, 0xffb020, 1.0);
          }
        }
      }
      if (this.specMode === 'boss' && this.bosses && this.bosses.some((b) => !b.dead)) {
        const bz = this.bosses.find((b) => !b.dead);
        this.player = bz;
      } else if (this.fp) {
        const L = this.spectateList();
        if (L.length) this.player = L[this.spectateIdx % L.length];
      } else if (alive.length) this.player = alive[this.spectateIdx % alive.length];
    }
    let p = this.player;
    if (!p) return;
    if (!this.spectator && p.dead && this.players && this.players.length > 1) {
      const alive = this.players.filter((x) => !x.dead);
      if (alive.length) p = alive[this.spectateIdx % alive.length];
    }
    this.camFocus = p;
    if (!this.camScratch) {
      this.camScratch = new THREE.PerspectiveCamera(42, 1, 0.5, 400);
    }
    this.camScratch.aspect = this.camera.aspect;
    this.camScratch.fov = this.camera.fov;
    this.camScratch.updateProjectionMatrix();
    const ZMAX = 8,
      ZMELEE = 0.65; // 不限制拉遠倍率
    // 近戰對象：玩家在連段中砍的目標，或正在砍玩家的敵人
    let meleeFoe = null;
    if (p.melee.active && p.melee.target && !p.melee.target.dead) meleeFoe = p.melee.target;
    else if (p.melee.active && p.lock && !p.lock.dead && p.lock.pos.distanceTo(p.pos) < 18) meleeFoe = p.lock;
    if (!meleeFoe) {
      for (const e of this.enemies) {
        if (!e.dead && e.melee.active && e.melee.target === p && e.pos.distanceTo(p.pos) < 22) {
          meleeFoe = e;
          break;
        }
      }
    }
    let zoomT = 1,
      focus = p.pos.clone();
    const lookAhead = new THREE.Vector3(); // 玩家永遠在畫面正中央：不做滑鼠方向偏移
    // 注視點永遠在玩家（不平移鏡頭），只改變鏡頭距離
    focus = p.pos.clone(); // 玩家永遠置中：不再依滑鼠方向偏移
    if (this.spectator && this.specMode === 'free') {
      if (!this.specPos) this.specPos = p.pos.clone();
      focus = this.specPos.clone();
      meleeFoe = null;
      this.camMode = 'free';
      this.camZoom = lerp(this.camZoom || 1, this.specZoom || 1, Math.min(1, dt * 5));
      const tgt = focus;
      tgt.y = this.world.terrainHeight(focus.x, focus.z) + 1.5;
      this.camTarget.lerp(tgt, Math.min(1, dt * 10));
      const off = new THREE.Vector3(0, 30, 17.5).multiplyScalar(this.camZoom);
      this.camera.position.lerp(this.camTarget.clone().add(off), Math.min(1, dt * 10));
      this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
      this.sun.position.copy(this.camTarget).add(this.sunOff);
      this.sun.target.position.copy(this.camTarget);
      this.world.updateOcclusion(this.camera.position, this.camTarget, dt);
      this.rangeRing.visible = false;
      return;
    }
    if (this.spectator && this.specMode === 'all') {
      const alive = this.players.filter((x) => !x.dead);
      if (alive.length) {
        const cen = new THREE.Vector3();
        alive.forEach((q) => cen.add(q.pos));
        cen.multiplyScalar(1 / alive.length);
        focus = cen;
        const pts = alive.map((q) => q.center());
        for (const b of this.bosses || []) if (!b.dead) pts.push(b.center());
        const zt = this.fitZoom(focus, pts, 1, 8) * (this.specZoom || 1);
        this.camMode = 'all';
        meleeFoe = null;
        this.camZoom = lerp(this.camZoom || 1, zt, Math.min(1, dt * 3));
        const tgt = focus.clone();
        tgt.y = this.world.terrainHeight(focus.x, focus.z) + 1.5;
        this.camTarget.lerp(tgt, Math.min(1, dt * 4));
        const off = new THREE.Vector3(0, 30, 17.5).multiplyScalar(this.camZoom);
        this.camera.position.lerp(this.camTarget.clone().add(off), Math.min(1, dt * 4));
        this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
        this.sun.position.copy(this.camTarget).add(this.sunOff);
        this.sun.target.position.copy(this.camTarget);
        this.world.updateOcclusion(this.camera.position, this.camTarget, dt);
        this.rangeRing.visible = false;
        return;
      }
    }
    if (meleeFoe) {
      zoomT = this.fitZoom(focus, [p.center(), meleeFoe.center()], ZMELEE, ZMAX);
      this.camMode = 'melee';
    } else if (p.lock && !p.lock.dead) {
      if (this.fitsAt(focus, 1, [p.center(), p.lock.center()])) {
        zoomT = 1;
        this.camMode = 'default';
      } else {
        zoomT = this.fitZoom(focus, [p.center(), p.lock.center()], 1, ZMAX);
        this.camMode = 'wide';
      }
    } else {
      this.camMode = 'default';
    }
    if (this.spectator) zoomT *= this.specZoom || 1;
    this.camZoom = lerp(this.camZoom || 1, zoomT, Math.min(1, dt * (zoomT < (this.camZoom || 1) ? 5 : 3.5)));
    const tgt = focus;
    tgt.y = p.pos.y + p.model.height * 0.35; // 以機體中段為中心
    this.camTarget.lerp(tgt, Math.min(1, dt * 12));
    const off = new THREE.Vector3(0, 30, 17.5).multiplyScalar(this.camZoom);
    const desired = this.camTarget.clone().add(off);
    this.camera.position.lerp(desired, Math.min(1, dt * 8));
    if (this.camShake > 0) {
      this.camShake -= dt;
      const a = Math.min(1, this.camShake * 4) * this.camZoom;
      this.camera.position.x += rnd(-0.6, 0.6) * a;
      this.camera.position.z += rnd(-0.6, 0.6) * a;
      this.camera.position.y += rnd(-0.3, 0.3) * a;
    }
    this.camera.lookAt(this.camTarget.x, this.camTarget.y, this.camTarget.z);
    this.sun.position.copy(this.camTarget).add(this.sunOff);
    this.sun.target.position.copy(this.camTarget);
    const sc = this.sun.shadow.camera;
    const ext = 70 * Math.max(1, this.camZoom);
    if (sc.right !== ext) {
      sc.left = -ext;
      sc.right = ext;
      sc.top = ext;
      sc.bottom = -ext;
      sc.updateProjectionMatrix();
    }
    this.world.updateOcclusion(this.camera.position, p.center(), dt);
    this.rangeRing.visible = true;
    this.rangeRing.position.set(p.pos.x, this.world.terrainHeight(p.pos.x, p.pos.z) + 0.12, p.pos.z);
    this.rangeRing.scale.setScalar(p.stats.lockRange);
  },
});
