// RTS 地圖產生器的預覽（開發與冒煙測試用）：g.rtsMapPreview(seed, { theme, size }) 以 planRtsMap 的結果建 World，
// 用彩色柱子標出主基地、礦脈、Coral、營地、中立建築、路口與通道，從正上方算繪一張（不經過後處理），回傳 PNG 的 dataURL。
// 呼叫端要先停住主迴圈（冒煙測試的 freezeLoop），否則下一格會照目前的 state 重畫。
import { planRtsMap } from '../world/rts-map.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const MARK = {
  base: [0x2f7bff, 0xff3b30], // 兩邊的主基地
  mine: 0xffc83a,
  coral: 0x3af0d8,
  camp: [0xffd9a0, 0xff9a40, 0xff4a20], // 營地 1～3 級
  tavern: 0xc06cff,
  shop: 0xffffff,
  merc: 0x9a6cff,
  choke: 0xffffff,
  lane: 0xffffff,
};

Object.assign(Game.prototype, {
  rtsMapPreview(seed, opt = {}) {
    const plan = planRtsMap(seed, { theme: opt.theme || 'wasteland', size: opt.size || 400 });
    this.clearMission();
    this.rtsPreviewClear();
    const w = (this.world = new World(this.scene, plan.theme, seed, 1, null, { rts: plan }));
    w.applyLight(this);
    const fogC = this.scene.fog ? this.scene.fog.color.getHex() : 0xffffff;
    this.scene.fog = new THREE.Fog(fogC, 700, 1600);
    const G = (this.rtsPrev = new THREE.Group());
    G.userData.helper = true;
    const th = (p) => w.terrainHeight(p.x, p.z);
    const mats = {};
    const mat = (c) => mats[c] || (mats[c] = new THREE.MeshBasicMaterial({ color: c }));
    const pillar = (p, c, r, h) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 12), mat(c));
      m.position.set(p.x, th(p) + h / 2, p.z);
      G.add(m);
    };
    const ring = (p, c, r) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - 1, r, 32), mat(c));
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, th(p) + 0.6, p.z);
      G.add(m);
    };
    for (const b of plan.bases) {
      pillar(b.pos, MARK.base[b.owner], 6, 40);
      ring(b.pos, MARK.base[b.owner], b.r);
      ring(b.ramp.bottom, MARK.base[b.owner], 4);
    }
    for (const m of plan.mines) pillar(m.pos, MARK.mine, m.kind === 'outer' ? 3.5 : 4.5, 24);
    for (const c of plan.corals) pillar(c.pos, MARK.coral, 3.5, 24);
    for (const c of plan.camps) pillar(c.pos, MARK.camp[c.tier - 1], 2.5 + c.tier, 16);
    for (const q of plan.neutrals) pillar(q.pos, MARK[q.kind], 4, 30);
    for (const c of plan.chokes) ring(c.pos, MARK.choke, c.w / 2);
    for (const L of plan.lanes) {
      const pts = L.map((p) => new THREE.Vector3(p.x, w.terrainHeight(p.x, p.z) + 1.5, p.z));
      G.add(
        new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({ color: MARK.lane, transparent: true, opacity: 0.6 }),
        ),
      );
    }
    this.scene.add(G);
    // 鏡頭：正上方，整張圖剛好入鏡
    const cam = this.camera;
    const sz = this.renderer.getSize(new THREE.Vector2());
    cam.aspect = sz.x / sz.y;
    cam.far = 2000;
    const fov0 = cam.fov;
    cam.fov = 24; // 窄視角從高處看：柱子不太歪
    const half = (plan.size / 2) * 1.04;
    const fovH = Math.atan(Math.tan((cam.fov * Math.PI) / 360) * Math.min(1, cam.aspect));
    const H = half / Math.tan(fovH);
    cam.position.set(0, H, 0.01);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    // 不畫陰影（整張圖的陰影貼圖解析度不夠，地面會有條紋）
    this.sun.position.set(120, 260, 80);
    this.sun.target.position.set(0, 0, 0);
    const cs = this.sun.castShadow;
    this.sun.castShadow = false;
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.sun.castShadow = cs;
    cam.up.set(0, 1, 0);
    cam.fov = fov0;
    cam.updateProjectionMatrix();
    return {
      url,
      ok: plan.ok,
      tries: plan.tries,
      ms: plan.ms,
      fail: plan.fail,
      bases: plan.bases.length,
      mines: plan.mines.length,
      corals: plan.corals.length,
      camps: plan.camps.length,
      lanes: plan.lanes.length,
      obstacles: w.obstacles.length,
      nav: !!w.nav,
      zone: w.zone.slice(),
      calls: this.renderer.info.render.calls,
    };
  },
  rtsPreviewClear() {
    if (!this.rtsPrev) return;
    this.scene.remove(this.rtsPrev);
    this.rtsPrev.traverse((o) => o.geometry && o.geometry.dispose());
    this.rtsPrev = null;
  },
});
