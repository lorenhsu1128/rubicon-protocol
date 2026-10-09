// ============================================================
//  EFFECTS — 加色發光粒子、曳光、衝擊波、塵土、彈殼
// ============================================================
import { SFX } from '../audio/audio.js';
import { rnd } from '../core/math.js';
import { mergeGeos } from '../render/geometry.js';
import { ThrusterFx } from './thruster.js';

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.sphereGeo = new THREE.SphereGeometry(1, 8, 6);
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.chevGeo = new THREE.ConeGeometry(0.35, 0.7, 3);
    this.ringGeo = new THREE.RingGeometry(0.85, 1, 32);
    this.discGeo = new THREE.CircleGeometry(1, 20);
    this.light = new THREE.PointLight(0xffc070, 0, 26, 2);
    scene.add(this.light);
    this.lightT = 0;
    this.hitStop = 0;
    this.thruster = new ThrusterFx(scene); // 機甲推進器噴焰粒子
  }
  addM(color, opacity = 1, additive = true) {
    return new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
    });
  }
  add(mesh, life, fn) {
    this.scene.add(mesh);
    this.list.push({ mesh, life, max: life, fn });
    return mesh;
  }
  flashLight(p, color, intensity) {
    this.light.position.copy(p);
    this.light.color.set(color);
    this.light.intensity = intensity;
    this.lightT = 0.08;
  }
  // bright sphere flash
  flash(p, r, color, life = 0.12) {
    const m = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.9));
    m.position.copy(p);
    this.add(m, life, (e, t) => {
      e.mesh.scale.setScalar(r * (0.6 + t * 0.7));
      e.mesh.material.opacity = 0.9 * (1 - t);
    });
  }
  // spark streaks: elongated additive boxes flying out
  streaks(p, n, color, speed, life = 0.3, grav = 30, dir = null, spread = 1) {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(this.boxGeo, this.addM(color, 1));
      s.position.copy(p);
      const v = new THREE.Vector3(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1));
      if (dir) v.multiplyScalar(spread).add(dir.clone().multiplyScalar(1.6));
      v.normalize().multiplyScalar(speed * rnd(0.5, 1.3));
      const w = rnd(0.05, 0.1);
      this.add(s, life * rnd(0.6, 1.2), (e, t, dt) => {
        v.y -= grav * dt;
        e.mesh.position.addScaledVector(v, dt);
        const L = Math.min(1.6, v.length() * 0.035);
        e.mesh.scale.set(w, w, L);
        e.mesh.lookAt(e.mesh.position.clone().add(v));
        e.mesh.material.opacity = 1 - t * t;
      });
    }
  }
  smoke(p, sc = 1, color = 0x5a5e66, life = 1.0, rise = 2) {
    const sm = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.28, false));
    sm.position.copy(p);
    const drift = new THREE.Vector3(rnd(-1, 1), rise, rnd(-1, 1));
    this.add(sm, life * rnd(0.8, 1.2), (e, t, dt) => {
      e.mesh.position.addScaledVector(drift, dt);
      e.mesh.scale.setScalar(sc * (0.3 + t * 1.0));
      e.mesh.material.opacity = 0.28 * (1 - t) * (1 - t);
    });
  }
  shockwave(p, r, color = 0xffd090, life = 0.4) {
    const g = new THREE.Mesh(this.ringGeo, this.addM(color, 1));
    g.position.copy(p);
    g.rotation.x = -Math.PI / 2;
    this.add(g, life, (e, t) => {
      e.mesh.scale.setScalar(r * (0.15 + t));
      e.mesh.material.opacity = 1 - t;
    });
  }
  explosion(p, r, color = 0xffa040, big = false) {
    this.flash(p, r * 0.32, 0xffffff, 0.08);
    this.flash(p, r * 0.45, color, 0.18);
    const fb = new THREE.Mesh(this.sphereGeo, this.addM(0xff6a20, 0.9));
    fb.position.copy(p);
    this.add(fb, big ? 0.45 : 0.3, (e, t) => {
      e.mesh.scale.setScalar(r * (0.22 + t * 0.55));
      e.mesh.material.opacity = 0.9 * (1 - t) * (1 - t);
    });
    this.shockwave(p.clone().setY(p.y - r * 0.3), r * 1.6, 0xffc080, big ? 0.5 : 0.3);
    this.streaks(p, big ? 26 : 12, 0xffa030, rnd(16, 26) * (big ? 1.5 : 1), big ? 0.9 : 0.5, 32);
    this.streaks(p, big ? 10 : 5, 0xffe0a0, rnd(24, 34), 0.25, 10);
    for (let i = 0; i < (big ? 14 : 6); i++) {
      const s = new THREE.Mesh(
        this.boxGeo,
        new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 }),
      );
      s.position.copy(p);
      s.scale.setScalar(rnd(0.15, 0.4) * (big ? 2 : 1));
      const v = new THREE.Vector3(rnd(-1, 1), rnd(0.4, 1.6), rnd(-1, 1))
        .normalize()
        .multiplyScalar(rnd(9, 22) * (big ? 1.6 : 1));
      const rv = new THREE.Vector3(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8));
      this.add(s, rnd(0.7, 1.3), (e, t, dt) => {
        v.y -= 34 * dt;
        e.mesh.position.addScaledVector(v, dt);
        e.mesh.rotation.x += rv.x * dt;
        e.mesh.rotation.y += rv.y * dt;
        if (t > 0.8) e.mesh.scale.multiplyScalar(0.9);
      });
    }
    for (let i = 0; i < (big ? 8 : 4); i++)
      this.smoke(
        p.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(0, 1.5), rnd(-1, 1)).multiplyScalar(r * 0.3)),
        r * 0.35 * rnd(0.7, 1.3),
        0x2e3136,
        big ? 1.6 : 1.0,
        2.5,
      );
    this.flashLight(p, color, big ? 40 : 18);
  }
  spark(p, color = 0xffe080, dir = null) {
    this.flash(p, 0.3, 0xffffff, 0.06);
    this.flash(p, 0.28, color, 0.12);
    this.streaks(p, 7, color, rnd(12, 18), 0.3, 30, dir ? dir.clone().negate() : null, 1.2);
    this.smoke(p, 0.35, 0x6a6e75, 0.45, 1.5);
  }
  muzzle(p, dir, color = 0xffd080, size = 1) {
    const f = new THREE.Mesh(this.sphereGeo, this.addM(0xffffff, 1));
    f.position.copy(p);
    this.add(f, 0.06, (e, t) => {
      e.mesh.scale.setScalar(size * (0.32 - t * 0.15));
      e.mesh.material.opacity = 1 - t;
    });
    const c = new THREE.Mesh(this.chevGeo, this.addM(color, 0.95));
    c.position.copy(p).addScaledVector(dir, size * 0.6);
    c.lookAt(c.position.clone().add(dir));
    c.rotateX(-Math.PI / 2);
    c.scale.set(size * 0.9, size * 1.6, size * 0.9);
    this.add(c, 0.07, (e, t) => {
      e.mesh.material.opacity = 1 - t;
      e.mesh.scale.multiplyScalar(1.06);
    });
    this.streaks(p, 3, color, 14, 0.14, 4, dir, 0.5);
    this.smoke(p.clone().addScaledVector(dir, 0.6), 0.25, 0x8a8e96, 0.4, 1.5);
  }
  empBeam(w, a, b, color) {
    if (!w.beamMesh) {
      const core = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6), this.addM(color, 0.9));
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 6), this.addM(color, 0.18));
      const grp = new THREE.Group();
      grp.add(core);
      grp.add(glow);
      grp.renderOrder = 4;
      this.scene.add(grp);
      w.beamMesh = grp;
      w.beamCore = core;
      w.beamGlow = glow;
    }
    const grp = w.beamMesh;
    grp.visible = true;
    const d = a.distanceTo(b);
    grp.position.copy(a).lerp(b, 0.5);
    grp.lookAt(b);
    grp.rotateX(Math.PI / 2);
    w.beamCore.scale.set(1, d, 1);
    w.beamGlow.scale.set(1, d, 1);
    w.beamGlow.material.opacity = 0.12 + Math.random() * 0.08;
    w.beamHideT = 0.08;
  }
  beam(a, b, color, width = 0.12) {
    const d = a.distanceTo(b);
    const g = new THREE.Mesh(new THREE.CylinderGeometry(width, width, d, 6), this.addM(color, 0.95));
    g.position.copy(a).lerp(b, 0.5);
    g.lookAt(b);
    g.rotateX(Math.PI / 2);
    this.add(g, 0.2, (e, t) => {
      e.mesh.material.opacity = 0.95 * (1 - t);
      e.mesh.scale.x = e.mesh.scale.z = 1 + t * 2;
    });
    const core = new THREE.Mesh(
      new THREE.CylinderGeometry(width * 0.35, width * 0.35, d, 6),
      this.addM(0xffffff, 1),
    );
    core.position.copy(g.position);
    core.quaternion.copy(g.quaternion);
    this.add(core, 0.13, (e, t) => {
      e.mesh.material.opacity = 1 - t;
    });
    this.flash(a, width * 6, color, 0.1);
    this.flashLight(a, color, 12);
  }
  chevrons(p, dir, color = 0xffffff) {
    for (let i = 0; i < 6; i++) {
      const c = new THREE.Mesh(this.chevGeo, this.addM(color, 0.9));
      c.position.copy(p).addScaledVector(dir, -i * 1.3);
      c.position.y += 0.5;
      c.lookAt(c.position.clone().add(dir));
      c.rotateX(Math.PI / 2);
      c.scale.set(1.2, 1, 1.2);
      this.add(c, 0.3 + i * 0.05, (e, t) => {
        e.mesh.material.opacity = 0.9 * (1 - t);
      });
    }
  }
  dust(p, r, n = 8, color = 0x9aa0a8) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
      const sm = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.3, false));
      sm.position.copy(p).add(new THREE.Vector3(Math.cos(a) * r * 0.3, 0.2, Math.sin(a) * r * 0.3));
      const v = new THREE.Vector3(Math.cos(a) * r * 2.2, rnd(0.5, 1.5), Math.sin(a) * r * 2.2);
      this.add(sm, rnd(0.5, 0.8), (e, t, dt) => {
        e.mesh.position.addScaledVector(v, dt * (1 - t));
        e.mesh.scale.setScalar(r * 0.18 * (0.5 + t * 1.4));
        e.mesh.material.opacity = 0.3 * (1 - t);
      });
    }
    this.shockwave(p.clone().setY(p.y + 0.1), r * 1.2, 0xffffff, 0.25);
  }
  casing(p, side, dir) {
    const s = new THREE.Mesh(
      this.boxGeo,
      new THREE.MeshStandardMaterial({ color: 0xd4a54a, metalness: 0.8, roughness: 0.3 }),
    );
    s.position.copy(p);
    s.scale.set(0.05, 0.05, 0.14);
    const right = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(side);
    const v = right.multiplyScalar(rnd(3, 5)).add(new THREE.Vector3(0, rnd(4, 6), 0));
    const rv = rnd(10, 25);
    this.add(s, 1.2, (e, t, dt) => {
      v.y -= 30 * dt;
      e.mesh.position.addScaledVector(v, dt);
      e.mesh.rotation.x += rv * dt;
      e.mesh.rotation.z += rv * 0.5 * dt;
    });
  }
  boostFlame(p, dir, color) {
    const m = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.7));
    m.position.copy(p);
    this.add(m, 0.18, (e, t, dt) => {
      e.mesh.position.addScaledVector(dir, dt * 6);
      e.mesh.scale.setScalar(0.35 * (1 - t) + 0.05);
      e.mesh.material.opacity = 0.7 * (1 - t);
    });
  }
  ring(p, r, color) {
    this.shockwave(p, r, color, 0.5);
  }
  // 地面衝擊波：中心先閃紅色預警 dl 秒，再以 sp m/s 擴散到半徑 R 的光牆，沿地形起伏（ground(x, z) 回傳地面高度）
  groundWave(p, R, sp, dl, ground, color = 0xff8a3a) {
    const warn = new THREE.Mesh(this.discGeo, this.addM(0xff3020, 0.5));
    warn.rotation.x = -Math.PI / 2;
    warn.position.copy(p).setY(p.y + 0.15);
    this.add(warn, dl, (e, t) => {
      e.mesh.scale.setScalar(3 + t * 5);
      e.mesh.material.opacity = 0.2 + 0.4 * Math.abs(Math.sin(t * dl * 12));
    });
    const N = 72;
    const pos = new Float32Array((N + 1) * 6);
    const idx = [];
    for (let i = 0; i < N; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    const mat = this.addM(color, 0.85);
    mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.visible = false;
    const life = dl + R / sp;
    this.add(m, life, (e, t) => {
      const el = t * life - dl;
      if (el < 0) return;
      if (!m.visible) {
        m.visible = true;
        SFX.explode(true, p);
        this.shockwave(p.clone().setY(p.y + 0.2), 8, 0xffc080, 0.4);
        this.dust(p.clone(), 4, 14);
      }
      const r = Math.max(0.5, el * sp),
        h = 1.8 * (1 - (0.5 * r) / R);
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const x = p.x + Math.cos(a) * r,
          z = p.z + Math.sin(a) * r;
        const y = ground(x, z);
        pos.set([x, y + 0.05, z, x, y + h, z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.85 * (1 - r / R);
    });
  }
  // 落點預警（迫擊砲）：紅色外圈＋由內往外填滿的圓，dl 秒後填滿，接近落地時閃得更快
  warnCircle(p, R, dl, color = 0xff3020) {
    const grp = new THREE.Group();
    grp.position.copy(p).setY(p.y + 0.12);
    const ring = new THREE.Mesh(this.ringGeo, this.addM(color, 0.8));
    ring.material.side = THREE.DoubleSide;
    ring.rotation.x = -Math.PI / 2;
    ring.scale.setScalar(R);
    const fill = new THREE.Mesh(this.discGeo, this.addM(color, 0.3));
    fill.rotation.x = -Math.PI / 2;
    grp.add(ring, fill);
    this.add(grp, dl, (e, t) => {
      fill.scale.setScalar(Math.max(0.01, R * t));
      const f = 4 + t * 14;
      ring.material.opacity = 0.3 + 0.3 * Math.abs(Math.sin(t * dl * f));
      fill.material.opacity = 0.18 + 0.2 * t;
    });
  }
  // 瞄準／路徑預警線：a→b 的細光束閃爍 dl 秒（雷射扇形、衝刺路線）
  warnLine(a, b, dl, color = 0xff2020, width = 0.06) {
    const d = a.distanceTo(b);
    if (d < 0.01) return;
    const m = new THREE.Mesh(new THREE.CylinderGeometry(width, width, d, 5), this.addM(color, 0.7));
    m.position.copy(a).lerp(b, 0.5);
    m.lookAt(b);
    m.rotateX(Math.PI / 2);
    m.renderOrder = 4;
    this.add(m, dl, (e, t) => {
      e.mesh.material.opacity = 0.35 + 0.45 * Math.abs(Math.sin(t * dl * (6 + t * 16)));
      e.mesh.scale.x = e.mesh.scale.z = 1 + t * 1.5;
    });
  }
  // 地面的長方形預警（衝撞路線、進場路線、格子砲擊）：中心 c、朝向 yaw（長邊沿 −Z）、寬 w、長 l
  warnRect(c, yaw, w, l, dl, color = 0xff3020) {
    const grp = new THREE.Group();
    grp.position.copy(c).setY(c.y + 0.14);
    grp.rotation.y = yaw;
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(w, l), this.addM(color, 0.2));
    fill.rotation.x = -Math.PI / 2;
    fill.material.side = THREE.DoubleSide;
    const edgeM = this.addM(color, 0.8);
    for (const s of [-1, 1]) {
      const e1 = new THREE.Mesh(this.boxGeo, edgeM);
      e1.scale.set(0.18, 0.05, l);
      e1.position.x = (s * w) / 2;
      const e2 = new THREE.Mesh(this.boxGeo, edgeM);
      e2.scale.set(w, 0.05, 0.18);
      e2.position.z = (s * l) / 2;
      grp.add(e1, e2);
    }
    grp.add(fill);
    this.add(grp, dl, (e, t) => {
      fill.material.opacity = 0.12 + 0.22 * t;
      edgeM.opacity = 0.35 + 0.45 * Math.abs(Math.sin(t * dl * (5 + t * 12)));
    });
  }
  // 擴散的能量球殼（脈衝刃翼）：以 sp m/s 擴散到半徑 R
  pulseShell(c, R, sp, color = 0xff5070) {
    const life = R / sp;
    const m = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.35));
    m.material.side = THREE.DoubleSide;
    m.position.copy(c);
    m.renderOrder = 4;
    const ring = new THREE.Mesh(this.ringGeo, this.addM(color, 0.9));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(c);
    this.add(m, life, (e, t) => {
      e.mesh.scale.setScalar(Math.max(0.3, R * t));
      e.mesh.material.opacity = 0.32 * (1 - t * 0.7);
    });
    this.add(ring, life, (e, t) => {
      e.mesh.scale.setScalar(Math.max(0.3, R * t));
      e.mesh.material.opacity = 0.9 * (1 - t * 0.6);
    });
    this.flash(c, 3, color, 0.2);
  }
  // 燃燒的地面（熔渣）：半徑 R、持續 life 秒，火苗與煙
  firePool(p, R, life) {
    const grp = new THREE.Group();
    grp.position.copy(p).setY(p.y + 0.1);
    const disc = new THREE.Mesh(this.discGeo, this.addM(0xff5a10, 0.55));
    disc.rotation.x = -Math.PI / 2;
    disc.scale.setScalar(R);
    const core = new THREE.Mesh(this.discGeo, this.addM(0xffc040, 0.5));
    core.rotation.x = -Math.PI / 2;
    core.position.y = 0.02;
    core.scale.setScalar(R * 0.55);
    grp.add(disc, core);
    let acc = 0;
    this.add(grp, life, (e, t, dt) => {
      const fade = t < 0.85 ? 1 : (1 - t) / 0.15;
      disc.material.opacity = (0.4 + 0.15 * Math.sin(t * life * 9)) * fade;
      core.material.opacity = (0.35 + 0.2 * Math.sin(t * life * 13 + 1)) * fade;
      acc += dt;
      if (acc > 0.12 && fade > 0.3) {
        acc = 0;
        const a = Math.random() * Math.PI * 2,
          r = Math.random() * R * 0.85;
        const q = p.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.3, Math.sin(a) * r));
        const f = new THREE.Mesh(this.sphereGeo, this.addM(Math.random() < 0.5 ? 0xff7a20 : 0xffb040, 0.8));
        f.position.copy(q);
        const up = rnd(2.5, 4.5);
        this.add(f, rnd(0.4, 0.7), (e2, t2, dt2) => {
          e2.mesh.position.y += up * dt2;
          e2.mesh.scale.setScalar(0.5 * (1 - t2) + 0.1);
          e2.mesh.material.opacity = 0.8 * (1 - t2);
        });
        if (Math.random() < 0.3) this.smoke(q.clone().setY(q.y + 1), 0.9, 0x3a3430, 1.2, 3);
      }
    });
  }
  // 火焰噴射：從 p 沿 dir 噴出 len 公尺、半角 ang 的火焰粒子
  flameCone(p, dir, len, ang, n = 10) {
    for (let i = 0; i < n; i++) {
      const v = dir
        .clone()
        .add(new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 0.6), rnd(-1, 1)).multiplyScalar(Math.tan(ang)))
        .normalize()
        .multiplyScalar(len * rnd(1.6, 2.4));
      const f = new THREE.Mesh(this.sphereGeo, this.addM(Math.random() < 0.6 ? 0xff6a10 : 0xffc040, 0.8));
      f.position.copy(p);
      this.add(f, 0.45, (e, t, dt) => {
        e.mesh.position.addScaledVector(v, dt);
        e.mesh.scale.setScalar(0.3 + t * 1.6);
        e.mesh.material.opacity = 0.8 * (1 - t);
      });
    }
  }
  // 天上落下的光柱（衛星砲的格子砲擊）：p 是地面點
  pillarStrike(p, R, color = 0x9fe8ff) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 80, 14, 1, true), this.addM(color, 0.8));
    m.material.side = THREE.DoubleSide;
    m.position.copy(p).setY(p.y + 40);
    this.add(m, 0.5, (e, t) => {
      e.mesh.scale.x = e.mesh.scale.z = 1 - t * 0.7;
      e.mesh.material.opacity = 0.8 * (1 - t);
    });
    const c = new THREE.Mesh(
      new THREE.CylinderGeometry(R * 0.4, R * 0.4, 80, 8, 1, true),
      this.addM(0xffffff, 1),
    );
    c.position.copy(m.position);
    this.add(c, 0.3, (e, t) => {
      e.mesh.material.opacity = 1 - t;
    });
    this.shockwave(p.clone().setY(p.y + 0.2), R * 2.2, color, 0.4);
    this.flashLight(p.clone().setY(p.y + 3), color, 30);
  }
  // big additive thruster glare (billboard sphere) — used every frame by mechs, pooled per entity
  glareMesh(color) {
    const m = new THREE.Mesh(this.sphereGeo, this.addM(color, 0.55));
    m.renderOrder = 5;
    this.scene.add(m);
    return m;
  }
  // ---- 機體支離破碎：把每個關節節點的網格拆成獨立碎片，給予初速、角速度、重力、地面反彈 ----
  shatter(ent, world) {
    const root = ent.model.group;
    root.updateMatrixWorld(true);
    const center = ent.center();
    const pieces = [];
    const nodes = [];
    // 程式模型的網格掛在群組上；GLB 的網格可能掛在一般節點（Object3D）上，且網格本身帶有位移
    root.traverse((o) => {
      if ((o.isGroup || o.type === 'Object3D') && o.children.some((c) => c.isMesh)) nodes.push(o);
    });
    for (const n of nodes) {
      const g = new THREE.Group();
      n.matrixWorld.decompose(g.position, g.quaternion, g.scale);
      const meshes = n.children.filter((c) => c.isMesh && c.material.blending !== THREE.AdditiveBlending);
      for (const m of meshes) {
        n.remove(m);
        g.add(m); // 碎片群組＝原節點的世界變換，網格保留自己的區域變換
      }
      // sub-groups (e.g. weapons under hand) are handled as their own nodes; flames are not meshes so they vanish with the root
      this.scene.add(g);
      const pc = new THREE.Vector3();
      g.getWorldPosition(pc);
      const dir = pc.clone().sub(center);
      dir.y += 0.6;
      if (dir.lengthSq() < 0.01) dir.set(rnd(-1, 1), 1, rnd(-1, 1));
      dir.normalize();
      const v = dir
        .multiplyScalar(rnd(5, 13) * (ent.isBoss ? 1.4 : 1))
        .add(new THREE.Vector3(rnd(-2, 2), rnd(4, 11), rnd(-2, 2)));
      const av = new THREE.Vector3(rnd(-7, 7), rnd(-7, 7), rnd(-7, 7));
      const burning = Math.random() < 0.35;
      let rest = false;
      let smokeT = 0;
      pieces.push(g);
      this.list.push({
        mesh: g,
        life: 9 + Math.random() * 2,
        max: 11,
        fn: (e, t, dt) => {
          if (!rest) {
            v.y -= 34 * dt;
            g.position.addScaledVector(v, dt);
            g.rotation.x += av.x * dt;
            g.rotation.y += av.y * dt;
            g.rotation.z += av.z * dt;
            const gy = world.terrainHeight(g.position.x, g.position.z) + 0.35;
            if (g.position.y < gy) {
              g.position.y = gy;
              if (Math.abs(v.y) < 3) {
                rest = true;
              } else {
                v.y *= -0.35;
                v.x *= 0.55;
                v.z *= 0.55;
                av.multiplyScalar(0.5);
                this.dust(g.position.clone().setY(gy - 0.3), 1.2, 5);
                if (Math.random() < 0.5) this.streaks(g.position, 4, 0xffc050, 10, 0.3, 20);
              }
            }
          }
          if (burning) {
            smokeT += dt;
            if (smokeT > 0.12) {
              smokeT = 0;
              this.smoke(g.position.clone(), 0.7, 0x3a3d44, 1.2, 2.2);
              if (Math.random() < 0.5)
                this.boostFlame(
                  g.position.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), 0.2, rnd(-0.3, 0.3))),
                  new THREE.Vector3(0, 1, 0),
                  0xff8030,
                );
            }
          }
          if (t > 0.85) {
            g.position.y -= dt * 0.8;
          } // sink away at the end
        },
      });
    }
    // secondary detonations + big flash
    this.explosion(center, ent.isBoss ? 12 : 5, 0xffa040, true);
    this.flashLight(center, 0xffc060, ent.isBoss ? 60 : 30);
    for (let i = 1; i <= (ent.isBoss ? 8 : 3); i++)
      setTimeout(
        () => {
          const p = center.clone().add(new THREE.Vector3(rnd(-3, 3), rnd(-1, 3), rnd(-3, 3)));
          this.explosion(p, ent.isBoss ? 6 : 2.6, 0xff7030, ent.isBoss);
        },
        i * (ent.isBoss ? 160 : 110),
      );
    return pieces;
  }
  // crescent slash arc in XZ plane around center, facing yaw
  slash(center, yaw, arcDeg, radius, color, mirror = false, tilt = 0.35, dur = 0.22, spin = false) {
    const len = THREE.MathUtils.degToRad(arcDeg);
    const start = spin ? 0 : -len / 2;
    const mk = (inner, outer, col, op) =>
      new THREE.Mesh(new THREE.RingGeometry(inner, outer, 28, 1, start, len), this.addM(col, op));
    const grp = new THREE.Group();
    grp.position.copy(center);
    grp.rotation.order = 'YXZ';
    grp.rotation.y = yaw + Math.PI / 2;
    grp.rotation.x = -Math.PI / 2 + (mirror ? -tilt : tilt);
    const a = mk(radius * 0.55, radius, color, 0.85),
      b = mk(radius * 0.82, radius * 0.92, 0xffe0c0, 0.8);
    a.material.blending = THREE.NormalBlending;
    a.material.side = b.material.side = THREE.DoubleSide;
    grp.add(a);
    grp.add(b);
    this.scene.add(grp);
    this.list.push({
      mesh: grp,
      life: dur,
      max: dur,
      fn: (e, t) => {
        e.mesh.scale.setScalar(0.7 + t * 0.5);
        a.material.opacity = 0.85 * (1 - t * t);
        b.material.opacity = 0.8 * (1 - t);
        e.mesh.rotation.z = (mirror ? 1 : -1) * (spin ? t * Math.PI * 2 : t * len * 0.8);
      },
    });
    this.streaks(
      center.clone().add(new THREE.Vector3(-Math.sin(yaw), 0.3, -Math.cos(yaw)).multiplyScalar(radius * 0.6)),
      6,
      color,
      16,
      0.25,
      10,
    );
    this.flashLight(center, color, 10);
  }
  meleeHit(p, color, big, dir) {
    this.flash(p, big ? 0.9 : 0.5, 0xffffff, 0.06);
    this.flash(p, big ? 1.6 : 1.1, color, 0.22);
    // cut mark: bright slash line across the target
    const cut = new THREE.Mesh(this.boxGeo, this.addM(0xffffff, 1));
    cut.position.copy(p);
    const yaw = dir ? Math.atan2(dir.x, dir.z) : 0;
    cut.rotation.set(0.6, yaw + Math.PI / 2 + (Math.random() < 0.5 ? 0.5 : -0.5), 0);
    this.add(cut, 0.28, (e, t) => {
      e.mesh.scale.set(0.12 + t * 0.1, 0.12, (big ? 6 : 4.2) * (0.6 + t * 0.7));
      e.mesh.material.opacity = 1 - t * t;
    });
    const cut2 = new THREE.Mesh(this.boxGeo, this.addM(color, 0.9));
    cut2.position.copy(p);
    cut2.rotation.copy(cut.rotation);
    this.add(cut2, 0.32, (e, t) => {
      e.mesh.scale.set(0.35 + t * 0.3, 0.35, (big ? 6.5 : 4.6) * (0.6 + t * 0.7));
      e.mesh.material.opacity = 0.9 * (1 - t);
    });
    this.shockwave(p.clone().setY(p.y - 1), big ? 5 : 3, color, 0.3);
    this.streaks(p, big ? 24 : 12, color, big ? 26 : 18, 0.35, 24);
    this.streaks(p, big ? 8 : 4, 0xffffff, 30, 0.2, 8);
    if (big) {
      this.shockwave(p, 6, color, 0.4);
      this.smoke(p, 1.4, 0x4a4e55, 0.9, 2);
    }
  }
  update(dt) {
    this.thruster.update(dt);
    if (this.lightT > 0) {
      this.lightT -= dt;
      if (this.lightT <= 0) this.light.intensity = 0;
      else this.light.intensity *= 0.8;
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      e.life -= dt;
      const t = 1 - e.life / e.max;
      if (e.life <= 0) {
        if (!e.mesh) {
          this.list.splice(i, 1);
          continue;
        }
        this.scene.remove(e.mesh);
        const keep = [this.sphereGeo, this.boxGeo, this.chevGeo, this.ringGeo, this.discGeo];
        e.mesh.traverse((o) => {
          if (o.material) o.material.dispose();
          if (o.geometry && !keep.includes(o.geometry)) o.geometry.dispose();
        });
        this.list.splice(i, 1);
      } else e.fn(e, t, dt);
    }
  }
  clear() {
    for (const e of this.list) this.scene.remove(e.mesh);
    this.list = [];
    this.light.intensity = 0;
    this.thruster.clear();
  }
}

// ---------- 特效：物件與車輛碎裂（碎片落地後合併成一個網格、永久保留） ----------
Object.assign(Effects.prototype, {
  debrisPieces(list, color, persist) {
    const scene = this.scene;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.2, flatShading: true });
    const pieces = [];
    for (const d of list) {
      const m = new THREE.Mesh(d.geo, mat);
      m.position.copy(d.pos);
      m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      m.castShadow = true;
      scene.add(m);
      const v = d.pos
        .clone()
        .sub(d.origin)
        .normalize()
        .multiplyScalar(rnd(4, 10))
        .add(new THREE.Vector3(rnd(-2, 2), rnd(5, 11), rnd(-2, 2)));
      const av = new THREE.Vector3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
      pieces.push({ m, v, av, rest: false });
    }
    const world = persist.world;
    let done = false;
    this.list.push({
      mesh: null,
      life: 6,
      max: 6,
      fn: (e, t, dt) => {
        let all = true;
        for (const p of pieces) {
          if (p.rest) continue;
          all = false;
          p.v.y -= 34 * dt;
          p.m.position.addScaledVector(p.v, dt);
          p.m.rotation.x += p.av.x * dt;
          p.m.rotation.y += p.av.y * dt;
          p.m.rotation.z += p.av.z * dt;
          const gy = world.terrainHeight(p.m.position.x, p.m.position.z) + 0.25;
          if (p.m.position.y < gy) {
            p.m.position.y = gy;
            if (Math.abs(p.v.y) < 2.5) {
              p.rest = true;
            } else {
              p.v.y *= -0.35;
              p.v.x *= 0.5;
              p.v.z *= 0.5;
              p.av.multiplyScalar(0.5);
            }
          }
        }
        if ((all || t > 0.95) && !done) {
          done = true; // 合併成單一網格並永久保留
          const geos = [];
          for (const p of pieces) {
            p.m.updateMatrixWorld(true);
            geos.push({ geo: p.m.geometry, mm: p.m.matrixWorld.clone() });
            scene.remove(p.m);
          }
          const merged = mergeGeos(geos);
          if (merged) {
            const mm = new THREE.Mesh(merged, mat);
            mm.castShadow = true;
            mm.receiveShadow = true;
            scene.add(mm);
            if (world.meshes) world.meshes.push(mm);
          }
        }
      },
    });
  },
  shatterProp(p, world) {
    const c = p.center();
    const list = [];
    const ob = p.ob;
    const origin = c.clone();
    const K = p.kind;
    if (K === 'container' || K === 'pillarBlock' || K === 'truck') {
      const size = ob.box ? ob.box.getSize(new THREE.Vector3()) : new THREE.Vector3(3, 2.4, 7);
      const n = K === 'pillarBlock' ? 14 : 12;
      for (let i = 0; i < n; i++) {
        const w = rnd(0.6, 1.8) * Math.max(0.6, size.x / 4),
          h = rnd(0.1, 0.35),
          d = rnd(0.6, 1.8) * Math.max(0.6, size.z / 4);
        list.push({
          geo: new THREE.BoxGeometry(w, h, d),
          pos: c
            .clone()
            .add(
              new THREE.Vector3(
                rnd(-size.x / 2, size.x / 2),
                rnd(-size.y / 2, size.y / 2),
                rnd(-size.z / 2, size.z / 2),
              ),
            ),
          origin,
        });
      }
    } else if (K === 'rock') {
      for (let i = 0; i < 10; i++) {
        list.push({
          geo: new THREE.DodecahedronGeometry(rnd(0.4, 1.1), 0),
          pos: c.clone().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-1.5, 1.5))),
          origin,
        });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        list.push({
          geo: new THREE.BoxGeometry(0.6, rnd(0.8, 1.6), 0.6),
          pos: c.clone().add(new THREE.Vector3(rnd(-0.3, 0.3), rnd(-2, 2), rnd(-0.3, 0.3))),
          origin,
        });
      }
    }
    this.explosion(c, K === 'rock' ? 3 : 2.5, K === 'rock' ? 0xc0b090 : 0xffa040, false);
    this.dust(c.clone().setY(world.terrainHeight(c.x, c.z) + 0.1), 3, 8);
    SFX.explode(false, c);
    this.debrisPieces(list, p.color, { world });
  },
  shatterVehicle(v) {
    const world = v.game.world;
    const list = [];
    for (let i = 0; i < v.cars; i++) {
      const cp = v.carPos(i).add(new THREE.Vector3(0, 1.5, 0));
      for (let k = 0; k < 8; k++)
        list.push({
          geo: new THREE.BoxGeometry(rnd(0.6, 2.2), rnd(0.15, 0.5), rnd(0.8, 2.4)),
          pos: cp.clone().add(new THREE.Vector3(rnd(-1.5, 1.5), rnd(-1, 1), rnd(-3, 3))),
          origin: cp,
        });
    }
    this.debrisPieces(list, v.kind === 'train' ? 0x4a4a44 : 0x2b4a8a, { world });
  },
});
