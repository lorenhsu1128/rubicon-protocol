// 作戰室的玻璃指揮塔（docs/hub-ui.md）：人的尺寸（公尺），架在格納庫前段的半空（格納庫與機體在 game/hub-holo.js）。
// 正中央是全像戰略桌（render/holo-map.js），周圍是設施：機甲庫閘門、駕駛員區、模擬艙、通訊台、委託方看板、檔案櫃、ECHO 的終端。
// 設施的發光材質放在 spots[id].glow，tickHubRoom 依 hot（游標停留／有新東西）調亮
import { buildHoloTable } from './holo-map.js';

const std = (color, rough = 0.6, metal = 0.5, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o });
const glowM = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
function box(g, w, h, d, m, x, y, z) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  b.castShadow = b.receiveShadow = true;
  g.add(b);
  return b;
}
function cyl(g, r0, r1, h, m, x, y, z, seg = 24) {
  const c = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), m);
  c.position.set(x, y, z);
  c.castShadow = c.receiveShadow = true;
  g.add(c);
  return c;
}
// 畫布貼圖（看板、螢幕）
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  return t;
}

export const ROOM_W = 13,
  ROOM_D = 12,
  ROOM_H = 10;

export function buildHubRoom(factions) {
  const root = new THREE.Group();
  root.name = 'hubRoom';
  const M = {
    floor: std(0x2a3138, 0.55, 0.55),
    wall: std(0x161b20, 0.85, 0.4),
    panel: std(0x2a323a, 0.6, 0.6),
    dark: std(0x101418, 0.85, 0.3),
    trim: std(0x3a434c, 0.45, 0.8),
    yellow: std(0xc89418, 0.6, 0.3),
  };
  const spots = {};
  const spot = (id, anchor, glow) => (spots[id] = { id, anchor, glow: glow || [], hot: 0, on: true });
  // ---------- 地板、牆、天花板 ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  // 地板的接縫與桌子周圍的警示圈
  const seams = [];
  for (let x = -ROOM_W / 2; x <= ROOM_W / 2; x += 1.5)
    seams.push(x, 0.005, -ROOM_D / 2, x, 0.005, ROOM_D / 2);
  for (let z = -ROOM_D / 2; z <= ROOM_D / 2; z += 1.5)
    seams.push(-ROOM_W / 2, 0.005, z, ROOM_W / 2, 0.005, z);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(seams, 3));
  root.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: 0x0d1115 })));
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.15, 96), glowM(0x5cc8ff, 0.35));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  root.add(ring);
  // 玻璃指揮塔（docs/hub-ui.md）：三面是大片玻璃（窗框＋半透明玻璃），外面是格納庫；天花板是鏤空的桁架與吊燈，
  // 所以轉視角時不會被牆或天花板擋住
  const glass = new THREE.MeshStandardMaterial({
    color: 0x9fd8ff,
    roughness: 0.05,
    metalness: 0.6,
    transparent: true,
    opacity: 0.1,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const pane = (w, h, x, y, z, ry) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    root.add(m);
  };
  const lights = [];
  const strip = glowM(0x9fd8ff, 0.55);
  // 後面（閘門兩側）與左右：腰牆＋玻璃＋直窗框
  pane(ROOM_W, ROOM_H - 0.9, 0, 0.9 + (ROOM_H - 0.9) / 2, -ROOM_D / 2, 0);
  pane(ROOM_D, ROOM_H - 0.9, -ROOM_W / 2, 0.9 + (ROOM_H - 0.9) / 2, 0, Math.PI / 2);
  pane(ROOM_D, ROOM_H - 0.9, ROOM_W / 2, 0.9 + (ROOM_H - 0.9) / 2, 0, Math.PI / 2);
  box(root, ROOM_W, 0.9, 0.25, M.trim, 0, 0.45, -ROOM_D / 2);
  for (const sx of [-1, 1]) box(root, 0.25, 0.9, ROOM_D, M.trim, (sx * ROOM_W) / 2, 0.45, 0);
  for (let x = -ROOM_W / 2; x <= ROOM_W / 2 + 0.01; x += ROOM_W / 6)
    box(root, 0.16, ROOM_H, 0.16, M.trim, x, ROOM_H / 2, -ROOM_D / 2);
  for (const sx of [-1, 1])
    for (let z = -ROOM_D / 2; z <= ROOM_D / 2 + 0.01; z += ROOM_D / 4)
      box(root, 0.16, ROOM_H, 0.16, M.trim, (sx * ROOM_W) / 2, ROOM_H / 2, z);
  // 腰牆上的燈條
  lights.push(box(root, ROOM_W - 0.4, 0.04, 0.04, strip, 0, 0.92, -ROOM_D / 2 + 0.14));
  for (const sx of [-1, 1])
    lights.push(box(root, 0.04, 0.04, ROOM_D - 0.4, strip, sx * (ROOM_W / 2 - 0.14), 0.92, 0));
  // 天花板的桁架（鏤空）與吊燈
  for (const sx of [-1, 1]) box(root, 0.3, 0.3, ROOM_D, M.trim, (sx * ROOM_W) / 2, ROOM_H, 0);
  box(root, ROOM_W, 0.3, 0.3, M.trim, 0, ROOM_H, -ROOM_D / 2);
  for (let k = -1; k <= 1; k++) box(root, 0.18, 0.18, ROOM_D, M.panel, k * 3.6, ROOM_H - 0.1, 0);
  for (let k = -1; k <= 1; k++) box(root, ROOM_W, 0.14, 0.14, M.panel, 0, ROOM_H - 0.1, k * 3.6);
  // 桌子上方的環形燈（在天花板的桁架上，鏡頭在它下面）
  const cl = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.06, 8, 96), glowM(0xdaf2ff));
  cl.rotation.x = Math.PI / 2;
  cl.position.y = ROOM_H - 0.3;
  root.add(cl);
  // ---------- 全像戰略桌 ----------
  const T = buildHoloTable();
  root.add(T.g);
  spot('table', new THREE.Vector3(0, 1.1, 2.9), []);
  // ---------- 機甲庫閘門（後牆中央） ----------
  const gate = new THREE.Group();
  gate.position.set(4.0, 0, -ROOM_D / 2 + 0.2); // 偏右：正後方留給窗外整備架上的機體
  root.add(gate);
  box(gate, 4.0, 3.4, 0.3, M.trim, 0, 1.7, 0);
  const doorL = box(gate, 1.75, 3.0, 0.2, M.panel, -0.9, 1.5, 0.2);
  const doorR = box(gate, 1.75, 3.0, 0.2, M.panel, 0.9, 1.5, 0.2);
  // 門縫透出格納庫的光、黃黑警示條
  const slit = box(gate, 0.06, 3.0, 0.05, glowM(0xffd27a), 0, 1.5, 0.32);
  const hazard = canvasTex(256, 32, (c, w, h) => {
    for (let i = -2; i < 20; i++) {
      c.fillStyle = i % 2 ? '#111' : '#d8a018';
      c.beginPath();
      c.moveTo(i * 16, h);
      c.lineTo(i * 16 + 16, 0);
      c.lineTo(i * 16 + 32, 0);
      c.lineTo(i * 16 + 16, h);
      c.fill();
    }
  });
  box(gate, 4.0, 0.25, 0.32, new THREE.MeshBasicMaterial({ map: hazard }), 0, 3.3, 0.05);
  const gateLamp = box(gate, 0.5, 0.2, 0.1, glowM(0xffb020), 0, 3.65, 0.1);
  spot('garage', new THREE.Vector3(4.0, 3.6, -ROOM_D / 2 + 0.6), [slit.material, gateLamp.material]);
  // ---------- 駕駛員區（左牆後段：置物櫃與座椅） ----------
  const pilot = new THREE.Group();
  pilot.position.set(-ROOM_W / 2 + 0.7, 0, -3.6);
  root.add(pilot);
  for (let k = 0; k < 3; k++) {
    box(pilot, 0.6, 2.2, 0.8, M.trim, 0, 1.1, k * 0.85 - 0.85);
    box(pilot, 0.02, 0.08, 0.5, glowM(0x5cc8ff), 0.31, 1.8, k * 0.85 - 0.85);
  }
  const seat = new THREE.Group();
  seat.position.set(1.6, 0, 0.2);
  pilot.add(seat);
  cyl(seat, 0.12, 0.2, 0.45, M.dark, 0, 0.22, 0);
  box(seat, 0.6, 0.12, 0.6, M.panel, 0, 0.5, 0);
  box(seat, 0.6, 0.7, 0.1, M.panel, -0.28, 0.85, 0).rotation.y = Math.PI / 2;
  const pGlow = box(pilot, 0.04, 0.04, 2.4, glowM(0x5cc8ff, 0.8), 0.32, 2.3, 0);
  spot('pilot', new THREE.Vector3(-ROOM_W / 2 + 1.2, 2.7, -3.6), [pGlow.material]);
  // ---------- 模擬艙（左牆前段） ----------
  const sim = new THREE.Group();
  sim.position.set(-ROOM_W / 2 + 1.5, 0, 2.6);
  root.add(sim);
  cyl(sim, 0.95, 1.05, 0.25, M.trim, 0, 0.12, 0, 32);
  const pod = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    M.panel,
  );
  pod.scale.set(1, 1.35, 1);
  pod.position.y = 0.3;
  pod.castShadow = true;
  sim.add(pod);
  const win = new THREE.Mesh(
    new THREE.SphereGeometry(0.92, 24, 12, -0.6, 1.2, 0.5, 0.7),
    glowM(0x5ab8ff, 0.55),
  );
  win.scale.set(1, 1.35, 1);
  win.position.y = 0.3;
  win.rotation.y = Math.PI / 2;
  sim.add(win);
  spot('sim', new THREE.Vector3(-ROOM_W / 2 + 1.5, 2.6, 2.6), [win.material]);
  // ---------- 通訊台（右牆後段：控制台與螢幕） ----------
  const com = new THREE.Group();
  com.position.set(ROOM_W / 2 - 1.2, 0, -3.4);
  com.rotation.y = -Math.PI / 2;
  root.add(com);
  box(com, 2.6, 0.95, 0.9, M.trim, 0, 0.48, 0);
  box(com, 2.6, 0.08, 1.0, M.dark, 0, 0.98, 0.05).rotation.x = -0.25;
  const scr = canvasTex(256, 96, (c, w, h) => {
    c.fillStyle = '#061a12';
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#6fe39a';
    c.lineWidth = 2;
    c.beginPath();
    for (let x = 0; x < w; x++) c.lineTo(x, h / 2 + Math.sin(x * 0.12) * 18 * Math.sin(x * 0.02));
    c.stroke();
  });
  const screens = [];
  for (const sx of [-0.85, 0, 0.85]) {
    const sm = new THREE.MeshBasicMaterial({ map: scr });
    screens.push(sm);
    const s = box(com, 0.78, 0.5, 0.04, sm, sx, 1.55, -0.3);
    s.rotation.x = -0.12;
  }
  spot('log', new THREE.Vector3(ROOM_W / 2 - 1.2, 2.4, -3.4), screens);
  // ---------- 檔案櫃（右牆前段：作戰紀錄、章節回顧） ----------
  const arc = new THREE.Group();
  arc.position.set(ROOM_W / 2 - 0.6, 0, 2.4);
  root.add(arc);
  const arcG = [];
  for (let k = 0; k < 3; k++) {
    box(arc, 0.8, 2.4, 0.9, M.trim, 0, 1.2, k * 0.95 - 0.95);
    for (let r = 0; r < 4; r++) {
      const gm = glowM(0xffb020, 0.7);
      arcG.push(gm);
      box(arc, 0.02, 0.04, 0.4, gm, -0.41, 0.4 + r * 0.55, k * 0.95 - 0.95);
    }
  }
  spot('record', new THREE.Vector3(ROOM_W / 2 - 0.9, 2.9, 1.5), arcG.slice(0, 4));
  spot('story', new THREE.Vector3(ROOM_W / 2 - 0.9, 2.9, 3.3), arcG.slice(4));
  // ---------- 委託方看板（後牆左側） ----------
  const fac = canvasTex(512, 160, (c, w, h) => {
    c.fillStyle = '#0d1216';
    c.fillRect(0, 0, w, h);
    (factions || []).forEach(([col, ch], i) => {
      const cx = 64 + i * 128,
        cy = h / 2;
      c.save();
      c.translate(cx, cy);
      c.rotate(Math.PI / 4);
      c.strokeStyle = col;
      c.lineWidth = 6;
      c.strokeRect(-34, -34, 68, 68);
      c.restore();
      c.fillStyle = col;
      c.font = 'bold 44px "Chakra Petch", sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(ch, cx, cy + 2);
    });
  });
  const facM = new THREE.MeshBasicMaterial({ map: fac });
  box(root, 3.6, 1.15, 0.05, facM, -4.2, 3.0, -ROOM_D / 2 + 0.3);
  spot('fac', new THREE.Vector3(-4.2, 4.0, -ROOM_D / 2 + 0.4), [facM]);
  // ---------- ECHO 的終端（後牆右側：細柱＋全像） ----------
  const echo = new THREE.Group();
  echo.position.set(1.6, 0, -ROOM_D / 2 + 1.4);
  root.add(echo);
  cyl(echo, 0.35, 0.45, 1.0, M.trim, 0, 0.5, 0);
  const eHolo = new THREE.Mesh(new THREE.OctahedronGeometry(0.32, 0), glowM(0xffd060, 0.75));
  eHolo.position.y = 1.65;
  echo.add(eHolo);
  spot('echo', new THREE.Vector3(1.6, 2.5, -ROOM_D / 2 + 1.4), [eHolo.material]);
  // 燈
  const lamp = (x, y, z, c, i, d) => {
    const p = new THREE.PointLight(c, i, d, 2);
    p.position.set(x, y, z);
    root.add(p);
    return p;
  };
  lamp(0, 2.6, 0, 0x5cc8ff, 2.6, 10); // 全像桌的光
  for (const [x, z] of [
    [-3.6, -3.6],
    [3.6, -3.6],
    [-3.6, 3.6],
    [3.6, 3.6],
  ]) {
    const sp = new THREE.SpotLight(0xfff0dc, 1.8, 16, 0.6, 0.6, 1.5);
    sp.position.set(x, ROOM_H - 0.3, z);
    sp.target.position.set(x * 0.6, 0, z * 0.6);
    root.add(sp, sp.target);
  }
  lamp(4.0, 3, -ROOM_D / 2 + 1.2, 0xffc070, 1.2, 7);
  return { root, spots, table: T, lights, doors: [doorL, doorR], echo: eHolo, base: M };
}

// 每格：燈條呼吸、設施的發光（hot 0～1）、ECHO 的全像轉動
export function tickHubRoom(R, dt, t) {
  for (const L of R.lights) L.material.opacity = 0.45 + 0.1 * Math.sin(t * 1.3);
  for (const s of Object.values(R.spots)) {
    const k = s.on ? 0.55 + 0.45 * s.hot : 0.12;
    for (const m of s.glow) {
      if (m.userData.c0 === undefined) m.userData.c0 = m.color.getHex();
      m.color.setHex(m.userData.c0).multiplyScalar(k + (s.hot > 0.5 ? 0.25 * Math.sin(t * 6) : 0));
    }
  }
  R.echo.rotation.y = t * 0.8;
  R.echo.position.y = 1.65 + Math.sin(t * 1.6) * 0.05;
}
