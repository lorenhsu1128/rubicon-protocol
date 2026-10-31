// 作戰室的玻璃指揮塔（docs/hub-ui.md）：人的尺寸（公尺），架在格納庫前段的半空（格納庫與機體在 game/hub-holo.js）。
// 正中央是全像戰略桌（render/holo-map.js），周圍是設施：機甲庫閘門、駕駛員區、模擬艙、通訊台、委託方看板、檔案櫃、ECHO 的終端、存檔終端。
// 每個設施是一個群組（spots[id].obj，點選與游標停留時的發光輪廓用；網格另外開啟圖層 spots[id].layer），
// 發光材質放在 spots[id].glow，tickHubRoom 依 hot（游標停留／有新東西）調亮。
// 建好之後每個設施的靜態網格依材質合併（mergeStatic），會動的節點標 userData.keep
import { buildHoloTable } from './holo-map.js';
import { HA, haProp } from './hangar-assets.js';

const std = (color, rough = 0.6, metal = 0.5, o = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...o });
const glowM = (color, opacity = 1) =>
  new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

// ---------- 幾何 ----------
const GC = {};
// 圓角方塊（半徑依最小邊限制）
function rbGeo(w, h, d, r) {
  const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  const k = [w, h, d, rr].map((v) => v.toFixed(3)).join(',');
  if (GC[k]) return GC[k];
  return (GC[k] =
    THREE.RoundedBoxGeometry && rr > 0.004
      ? new THREE.RoundedBoxGeometry(w, h, d, 2, rr)
      : new THREE.BoxGeometry(w, h, d));
}
function put(g, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  o.castShadow = o.receiveShadow = !m.transparent && m.type !== 'MeshBasicMaterial';
  g.add(o);
  return o;
}
const box = (g, w, h, d, m, x, y, z, rx, ry, rz) =>
  put(g, new THREE.BoxGeometry(w, h, d), m, x, y, z, rx, ry, rz);
const rbox = (g, w, h, d, m, x, y, z, rx, ry, rz, r = 0.025) =>
  put(g, rbGeo(w, h, d, r), m, x, y, z, rx, ry, rz);
const cyl = (g, r0, r1, h, m, x, y, z, seg = 24, rx, ry, rz) =>
  put(g, new THREE.CylinderGeometry(r0, r1, h, seg), m, x, y, z, rx, ry, rz);
const plane = (g, w, h, m, x, y, z, rx, ry, rz) =>
  put(g, new THREE.PlaneGeometry(w, h), m, x, y, z, rx, ry, rz);
const torus = (g, r, t, m, x, y, z, rx, ry, rz, seg = 48) =>
  put(g, new THREE.TorusGeometry(r, t, 8, seg), m, x, y, z, rx, ry, rz);
const grp = (par, x = 0, y = 0, z = 0, ry = 0) => {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = ry;
  par.add(g);
  return g;
};
// 兩點之間的圓柱（液壓桿、支柱）
function rod(g, a, b, r, m, seg = 12) {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const d = B.clone().sub(A);
  const o = put(g, new THREE.CylinderGeometry(r, r, d.length(), seg), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return o;
}
// 液壓缸：粗的缸體＋細的活塞桿＋兩端的接頭
function piston(g, a, b, r, M) {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const mid = A.clone().lerp(B, 0.55);
  rod(g, a, mid.toArray(), r, M.trim);
  rod(g, mid.toArray(), b, r * 0.5, M.chrome);
  for (const p of [A, B]) put(g, new THREE.SphereGeometry(r * 1.25, 12, 8), M.dark, p.x, p.y, p.z);
}
// 電纜（經過幾個點的平滑管子）
function cable(g, pts, r, m) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  return put(g, new THREE.TubeGeometry(c, 24, r, 6, false), m);
}

// ---------- 貼圖 ----------
function canvasTex(w, h, draw, rep) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  t.anisotropy = 4;
  if (rep) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rep[0], rep[1]);
  }
  return t;
}
const lcg = (seed) => {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
};
// 金屬面板：接縫、螺絲、磨損
function panelTex(base, seam, seed) {
  return canvasTex(256, 256, (c, w, h) => {
    const R = lcg(seed);
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},${(R() * 0.05).toFixed(3)})`;
      c.fillRect(R() * w, R() * h, 2 + R() * 30, 1 + R() * 3);
    }
    c.strokeStyle = seam;
    c.lineWidth = 2;
    c.strokeRect(4, 4, w - 8, h - 8);
    c.beginPath();
    c.moveTo(4, h * 0.62);
    c.lineTo(w - 4, h * 0.62);
    c.moveTo(w * 0.5, 4);
    c.lineTo(w * 0.5, h * 0.62);
    c.stroke();
    c.fillStyle = seam;
    for (const [x, y] of [
      [14, 14],
      [w - 14, 14],
      [14, h - 14],
      [w - 14, h - 14],
      [w * 0.5 - 10, h * 0.62 + 10],
      [w * 0.5 + 10, h * 0.62 + 10],
    ]) {
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    }
  });
}
// 地板：金屬板、接縫
function floorTex() {
  return canvasTex(
    512,
    512,
    (c, w, h) => {
      const R = lcg(7);
      c.fillStyle = '#3a434b';
      c.fillRect(0, 0, w, h);
      for (let k = 0; k < 4; k++) {
        const x0 = (k % 2) * 256,
          y0 = (k >> 1) * 256;
        c.fillStyle = k % 3 ? '#363f47' : '#3d464e';
        c.fillRect(x0 + 3, y0 + 3, 250, 250);
      }
      // 很淡的大斑塊（細的防滑紋與刮痕斜看時會產生摩爾紋、鏡頭一動就閃，不用）
      for (let i = 0; i < 120; i++) {
        c.fillStyle = `rgba(0,0,0,${(R() * 0.05).toFixed(3)})`;
        c.fillRect(R() * w, R() * h, 8 + R() * 40, 6 + R() * 20);
      }
      c.strokeStyle = '#1b2026';
      c.lineWidth = 4;
      c.strokeRect(0, 0, w, h);
      c.beginPath();
      c.moveTo(256, 0);
      c.lineTo(256, h);
      c.moveTo(0, 256);
      c.lineTo(w, 256);
      c.stroke();
      c.fillStyle = '#23292f';
      for (const x of [10, 246, 266, 502])
        for (const y of [10, 246, 266, 502]) {
          c.beginPath();
          c.arc(x, y, 4, 0, Math.PI * 2);
          c.fill();
        }
    },
    [ROOM_W / 3, ROOM_D / 3],
  );
}
// 黃黑警示條
function hazardTex(vertical) {
  return canvasTex(vertical ? 32 : 256, vertical ? 256 : 32, (c, w, h) => {
    c.fillStyle = '#111';
    c.fillRect(0, 0, w, h);
    c.save();
    if (vertical) {
      c.translate(w, 0);
      c.rotate(Math.PI / 2);
    }
    const L = vertical ? h : w,
      H = vertical ? w : h;
    for (let i = -2; i < L / 16 + 2; i++) {
      if (i % 2) continue;
      c.fillStyle = '#d8a018';
      c.beginPath();
      c.moveTo(i * 16, H);
      c.lineTo(i * 16 + 16, 0);
      c.lineTo(i * 16 + 32, 0);
      c.lineTo(i * 16 + 16, H);
      c.fill();
    }
    c.restore();
  });
}
// 螢幕：kind＝wave 波形、list 文字列、map 地圖、bars 長條、pilot 駕駛員、sim 模擬、keys 按鍵、leds 指示燈
function uiTex(kind, col, seed = 1, w = 256, h = 160) {
  return canvasTex(w, h, (c) => {
    const R = lcg(seed);
    c.fillStyle = '#04090d';
    c.fillRect(0, 0, w, h);
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(255,255,255,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = 2;
    if (kind === 'keys') {
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 10; i++) {
          c.globalAlpha = 0.25 + R() * 0.6;
          c.fillRect(8 + (i * (w - 16)) / 10, 10 + (j * (h - 20)) / 4, (w - 16) / 10 - 4, (h - 20) / 4 - 5);
        }
      c.globalAlpha = 1;
      return;
    }
    if (kind === 'leds') {
      for (let j = 0; j < 24; j++)
        for (let i = 0; i < 4; i++) {
          const r = R();
          c.fillStyle = r < 0.6 ? '#3cff90' : r < 0.85 ? '#ffb020' : '#1a2a22';
          c.fillRect(6 + i * (w / 4), 6 + j * (h / 24), w / 4 - 12, h / 24 - 6);
        }
      return;
    }
    // 外框與標題列
    c.globalAlpha = 0.9;
    c.strokeRect(3, 3, w - 6, h - 6);
    c.fillRect(3, 3, w - 6, 16);
    c.fillStyle = '#04090d';
    c.font = 'bold 11px monospace';
    c.fillText(
      {
        wave: 'COMM LINK',
        list: 'LOG',
        map: 'TACTICAL',
        bars: 'STATUS',
        pilot: 'PILOT',
        sim: 'SIM-01',
        save: 'SAVE DATA',
      }[kind] || '',
      8,
      15,
    );
    c.fillStyle = col;
    if (kind === 'wave') {
      for (let k = 0; k < 2; k++) {
        c.globalAlpha = k ? 0.45 : 0.95;
        c.beginPath();
        for (let x = 6; x < w - 6; x++)
          c.lineTo(
            x,
            h * (0.45 + k * 0.28) + Math.sin(x * (0.11 + k * 0.07) + seed) * 18 * Math.sin(x * 0.021 + k),
          );
        c.stroke();
      }
    } else if (kind === 'map') {
      c.globalAlpha = 0.35;
      for (let x = 10; x < w; x += 20) c.fillRect(x, 22, 1, h - 26);
      for (let y = 26; y < h; y += 20) c.fillRect(6, y, w - 12, 1);
      c.globalAlpha = 0.9;
      for (let i = 0; i < 4; i++) {
        c.beginPath();
        c.ellipse(
          w * (0.2 + R() * 0.6),
          h * (0.35 + R() * 0.45),
          10 + R() * 30,
          8 + R() * 18,
          R() * 3,
          0,
          Math.PI * 2,
        );
        c.stroke();
      }
      c.fillStyle = '#ff5040';
      for (let i = 0; i < 5; i++) c.fillRect(w * (0.1 + R() * 0.8), h * (0.25 + R() * 0.65), 5, 5);
    } else if (kind === 'save') {
      // 三個槽位的列＋寫入的進度條
      for (let i = 0; i < 3; i++) {
        const y = 30 + i * 30;
        c.globalAlpha = 0.9;
        c.fillRect(10, y, 18, 18);
        c.globalAlpha = 0.3;
        c.fillRect(36, y + 2, w - 48, 14);
        c.globalAlpha = 0.85;
        c.fillRect(36, y + 2, (w - 48) * (0.3 + R() * 0.7), 14);
      }
      c.globalAlpha = 0.6;
      c.fillRect(10, h - 26, w - 20, 4);
    } else if (kind === 'bars' || kind === 'pilot' || kind === 'sim') {
      const n = kind === 'bars' ? 9 : 5;
      for (let i = 0; i < n; i++) {
        const y = 28 + i * ((h - 36) / n);
        c.globalAlpha = 0.25;
        c.fillRect(kind === 'bars' ? 10 : w * 0.42, y, w * (kind === 'bars' ? 0.85 : 0.5), (h - 36) / n - 6);
        c.globalAlpha = 0.9;
        c.fillRect(
          kind === 'bars' ? 10 : w * 0.42,
          y,
          w * (kind === 'bars' ? 0.85 : 0.5) * (0.2 + R() * 0.8),
          (h - 36) / n - 6,
        );
      }
      if (kind !== 'bars') {
        // 左邊：人形或機體的線框
        c.globalAlpha = 0.85;
        const cx = w * 0.2,
          cy = h * 0.58;
        c.beginPath();
        c.arc(cx, cy - 38, 11, 0, Math.PI * 2);
        c.moveTo(cx, cy - 26);
        c.lineTo(cx, cy + 14);
        c.moveTo(cx - 22, cy - 14);
        c.lineTo(cx + 22, cy - 14);
        c.moveTo(cx, cy + 14);
        c.lineTo(cx - 14, cy + 44);
        c.moveTo(cx, cy + 14);
        c.lineTo(cx + 14, cy + 44);
        c.stroke();
      }
    } else {
      c.globalAlpha = 0.8;
      for (let i = 0; i < 9; i++) c.fillRect(8, 28 + i * 14, 20 + R() * (w - 50), 6);
    }
    c.globalAlpha = 1;
  });
}
// 文字的看板（模板字）
function signTex(lines, col, w = 512, h = 96, bg = null) {
  return canvasTex(w, h, (c) => {
    if (bg) {
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
    }
    c.fillStyle = col;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    lines.forEach(([t, px, y]) => {
      c.font = `bold ${px}px "Chakra Petch", "Noto Sans TC", sans-serif`;
      c.fillText(t, w / 2, y * h);
    });
  });
}

// ---------- 合併 ----------
// 群組裡的靜態網格依材質合併成一個網格（相對群組的座標）；userData.keep 的節點與它底下的不動
export function mergeStatic(root) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const by = new Map();
  root.traverse((o) => {
    if (!o.isMesh || o === root || Array.isArray(o.material)) return;
    for (let p = o; p && p !== root; p = p.parent) if (p.userData.keep) return;
    const k = o.material.uuid + (o.castShadow ? 's' : '') + (o.receiveShadow ? 'r' : '');
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(o);
  });
  const mm = new THREE.Matrix4();
  for (const list of by.values()) {
    if (list.length < 2) continue;
    const pos = [],
      nor = [],
      uv = [];
    for (const o of list) {
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      mm.multiplyMatrices(inv, o.matrixWorld);
      g.applyMatrix4(mm);
      if (!g.attributes.normal) g.computeVertexNormals();
      const P = g.attributes.position,
        N = g.attributes.normal,
        U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        pos.push(P.getX(i), P.getY(i), P.getZ(i));
        nor.push(N.getX(i), N.getY(i), N.getZ(i));
        uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      }
      g.dispose();
      o.parent.remove(o);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const m = new THREE.Mesh(geo, list[0].material);
    m.castShadow = list[0].castShadow;
    m.receiveShadow = list[0].receiveShadow;
    m.renderOrder = list[0].renderOrder;
    root.add(m);
  }
}

export const ROOM_W = 13,
  ROOM_D = 12,
  ROOM_H = 10;

// factions：[顏色, 縮寫, 名稱]
export function buildHubRoom(factions) {
  const root = new THREE.Group();
  root.name = 'hubRoom';
  const pTex = panelTex('#c3c9ce', 'rgba(40,48,56,0.55)', 3),
    dTex = panelTex('#5a646d', 'rgba(10,14,18,0.6)', 5);
  const M = {
    floor: std(0xffffff, 0.6, 0.55, { map: floorTex() }),
    wall: std(0x161b20, 0.85, 0.4),
    trim: std(0x3a434c, 0.45, 0.8),
    frame: std(0x262d34, 0.55, 0.7),
    panel: std(0xdfe3e6, 0.5, 0.35, { map: pTex }),
    panelD: std(0x9aa3ab, 0.5, 0.6, { map: dTex }),
    dark: std(0x101418, 0.8, 0.35),
    rubber: std(0x0b0c0e, 0.95, 0),
    chrome: std(0xc4ccd4, 0.22, 1),
    yellow: std(0xc89418, 0.55, 0.3),
    cushion: std(0x23282e, 0.92, 0.05),
    cloth: std(0x2f3d4a, 0.9, 0.05),
    orange: std(0xd0702a, 0.7, 0.1),
    white: std(0xe8ecef, 0.35, 0.2),
  };
  M.podShell = M.panel.clone();
  M.podShell.side = THREE.DoubleSide;
  M.floor.map.anisotropy = 16;
  const spots = {};
  const spin = []; // 每格轉動的節點：[節點, 軸, 速度]
  const spot = (id, anchor, glow, obj) =>
    (spots[id] = { id, anchor, glow: glow || [], hot: 0, on: true, obj });
  // ---------- 地板、牆、天花板 ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_W, ROOM_D), M.floor);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  root.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.0, 4.15, 96), glowM(0x5cc8ff, 0.35));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.012;
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
  const shell = grp(root);
  const pane = (w, h, x, y, z, ry) => plane(shell, w, h, glass, x, y, z, 0, ry);
  const strip = glowM(0x9fd8ff, 0.55);
  pane(ROOM_W, ROOM_H - 0.9, 0, 0.9 + (ROOM_H - 0.9) / 2, -ROOM_D / 2, 0);
  pane(ROOM_D, ROOM_H - 0.9, -ROOM_W / 2, 0.9 + (ROOM_H - 0.9) / 2, 0, Math.PI / 2);
  pane(ROOM_D, ROOM_H - 0.9, ROOM_W / 2, 0.9 + (ROOM_H - 0.9) / 2, 0, Math.PI / 2);
  // 腰牆：面板＋上緣的扶手＋踢腳
  rbox(shell, ROOM_W, 0.9, 0.25, M.panelD, 0, 0.45, -ROOM_D / 2, 0, 0, 0, 0.03);
  rbox(shell, ROOM_W, 0.08, 0.34, M.trim, 0, 0.92, -ROOM_D / 2 + 0.03, 0, 0, 0, 0.03);
  rbox(shell, ROOM_W, 0.12, 0.3, M.dark, 0, 0.06, -ROOM_D / 2 + 0.03);
  for (const sx of [-1, 1]) {
    rbox(shell, 0.25, 0.9, ROOM_D, M.panelD, (sx * ROOM_W) / 2, 0.45, 0, 0, 0, 0, 0.03);
    rbox(shell, 0.34, 0.08, ROOM_D, M.trim, sx * (ROOM_W / 2 - 0.03), 0.92, 0, 0, 0, 0, 0.03);
    rbox(shell, 0.3, 0.12, ROOM_D, M.dark, sx * (ROOM_W / 2 - 0.03), 0.06, 0);
  }
  // 窗框：直框（中間的細、轉角的粗）＋橫框
  for (let i = 0; i <= 6; i++) {
    const x = -ROOM_W / 2 + (i * ROOM_W) / 6,
      big = i === 0 || i === 6;
    rbox(
      shell,
      big ? 0.34 : 0.16,
      ROOM_H,
      big ? 0.34 : 0.2,
      M.trim,
      x,
      ROOM_H / 2,
      -ROOM_D / 2,
      0,
      0,
      0,
      0.03,
    );
  }
  for (const sx of [-1, 1])
    for (let i = 1; i <= 4; i++)
      rbox(
        shell,
        0.2,
        ROOM_H,
        0.16,
        M.trim,
        (sx * ROOM_W) / 2,
        ROOM_H / 2,
        -ROOM_D / 2 + (i * ROOM_D) / 4,
        0,
        0,
        0,
        0.03,
      );
  box(shell, ROOM_W, 0.1, 0.12, M.trim, 0, 6.2, -ROOM_D / 2);
  for (const sx of [-1, 1]) box(shell, 0.12, 0.1, ROOM_D, M.trim, (sx * ROOM_W) / 2, 6.2, 0);
  // 腰牆上的燈條
  box(shell, ROOM_W - 0.4, 0.04, 0.04, strip, 0, 0.98, -ROOM_D / 2 + 0.2);
  for (const sx of [-1, 1]) box(shell, 0.04, 0.04, ROOM_D - 0.4, strip, sx * (ROOM_W / 2 - 0.2), 0.98, 0);
  // 天花板的桁架（鏤空）、電纜架與吊燈
  for (const sx of [-1, 1]) box(shell, 0.3, 0.3, ROOM_D, M.trim, (sx * ROOM_W) / 2, ROOM_H, 0);
  box(shell, ROOM_W, 0.3, 0.3, M.trim, 0, ROOM_H, -ROOM_D / 2);
  for (let k = -1; k <= 1; k++) {
    box(shell, 0.18, 0.18, ROOM_D, M.panelD, k * 3.6, ROOM_H - 0.1, 0);
    box(shell, ROOM_W, 0.14, 0.14, M.panelD, 0, ROOM_H - 0.1, k * 3.6);
    // 斜撐
    for (let z = -ROOM_D / 2 + 1; z < ROOM_D / 2; z += 2)
      box(shell, 0.05, 0.05, 1.3, M.trim, k * 3.6, ROOM_H - 0.32, z, 0.5);
  }
  for (const sx of [-1, 1]) {
    rbox(shell, 0.5, 0.08, ROOM_D - 0.6, M.frame, sx * 5.0, ROOM_H - 0.45, 0);
    for (let i = 0; i < 4; i++)
      cable(
        shell,
        [
          [sx * (4.88 + i * 0.08), ROOM_H - 0.4, -ROOM_D / 2 + 0.3],
          [sx * (4.86 + i * 0.08), ROOM_H - 0.38, 0],
          [sx * (4.88 + i * 0.08), ROOM_H - 0.4, ROOM_D / 2 - 0.3],
        ],
        0.025,
        M.rubber,
      );
  }
  // 桌子上方的環形燈（在天花板的桁架上，鏡頭在它下面）
  const cl = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.06, 8, 96), glowM(0xdaf2ff));
  cl.rotation.x = Math.PI / 2;
  cl.position.y = ROOM_H - 0.3;
  shell.add(cl);
  // 聚光燈的燈罩
  const lampG = glowM(0xfff4e0);
  for (const [x, z] of [
    [-3.6, -3.6],
    [3.6, -3.6],
    [-3.6, 3.6],
    [3.6, 3.6],
  ]) {
    cyl(shell, 0.22, 0.34, 0.32, M.dark, x, ROOM_H - 0.42, z, 16);
    cyl(shell, 0.29, 0.29, 0.01, lampG, x, ROOM_H - 0.585, z, 16);
    rod(shell, [x, ROOM_H - 0.26, z], [x, ROOM_H - 0.1, z], 0.04, M.trim);
  }
  // 窗邊的低矮控制台（左右各一）
  for (const [x, z, ry] of [
    [-ROOM_W / 2 + 0.55, -0.6, Math.PI / 2],
    [ROOM_W / 2 - 0.55, -0.9, -Math.PI / 2],
  ]) {
    const c = grp(shell, x, 0, z, ry);
    rbox(c, 1.5, 0.82, 0.55, M.panelD, 0, 0.41, 0, 0, 0, 0, 0.04);
    rbox(c, 1.5, 0.06, 0.6, M.dark, 0, 0.84, 0.03, -0.3);
    plane(
      c,
      1.3,
      0.4,
      new THREE.MeshBasicMaterial({ map: uiTex('bars', '#7fd0ff', 11 + ry) }),
      0,
      0.88,
      0.04,
      -0.3 - Math.PI / 2,
    );
    box(c, 1.4, 0.03, 0.02, glowM(0x5cc8ff, 0.8), 0, 0.15, 0.28);
  }
  mergeStatic(shell);
  // ---------- 全像戰略桌 ----------
  const T = buildHoloTable();
  root.add(T.g);
  mergeStatic(T.g);
  spot('table', new THREE.Vector3(0, 1.1, 2.9), []);
  // ---------- 機甲庫閘門（後牆右側；正後方留給窗外整備架上的機體） ----------
  {
    const gate = grp(root, 4.0, 0, -ROOM_D / 2 + 0.3);
    // 門框：上緣切角的 U 形，擠出成厚框
    const s = new THREE.Shape();
    [
      [-2.35, 0],
      [-1.8, 0],
      [-1.8, 3.15],
      [-1.5, 3.45],
      [1.5, 3.45],
      [1.8, 3.15],
      [1.8, 0],
      [2.35, 0],
      [2.35, 3.6],
      [1.95, 4.0],
      [-1.95, 4.0],
      [-2.35, 3.6],
    ].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const fg = new THREE.ExtrudeGeometry(s, {
      depth: 0.5,
      bevelEnabled: true,
      bevelThickness: 0.03,
      bevelSize: 0.03,
      bevelSegments: 1,
    });
    put(gate, fg, M.panelD, 0, 0, -0.25);
    // 內側的警示條
    const hzV = std(0xffffff, 0.6, 0.3, { map: hazardTex(true) });
    for (const sx of [-1, 1]) box(gate, 0.14, 3.1, 0.04, hzV, sx * 1.95, 1.6, 0.29);
    const hzH = std(0xffffff, 0.6, 0.3, { map: hazardTex(false) });
    box(gate, 3.0, 0.2, 0.04, hzH, 0, 3.62, 0.29);
    // 門板（左右）：補強板、橫肋、外側的直補強、中縫的警示條
    for (const sx of [-1, 1]) {
      const cx = sx * 0.9;
      rbox(gate, 1.8, 3.15, 0.22, M.panel, cx, 1.575, -0.02, 0, 0, 0, 0.03);
      rbox(gate, 1.5, 1.25, 0.05, M.panelD, cx - sx * 0.05, 2.4, 0.11);
      rbox(gate, 1.25, 0.95, 0.06, M.panel, cx - sx * 0.05, 2.4, 0.14);
      for (const y of [0.45, 0.8, 1.15, 1.5]) rbox(gate, 1.5, 0.11, 0.08, M.frame, cx - sx * 0.05, y, 0.12);
      rbox(gate, 0.14, 3.0, 0.1, M.frame, sx * 1.66, 1.55, 0.13);
      box(gate, 0.1, 3.1, 0.03, hzV, sx * 0.08, 1.57, 0.105);
      for (let i = 0; i < 4; i++)
        cyl(gate, 0.025, 0.025, 0.03, M.chrome, sx * 1.66, 0.3 + i * 0.85, 0.19, 8, Math.PI / 2);
    }
    const slit = box(gate, 0.05, 3.1, 0.04, glowM(0xffd27a), 0, 1.57, 0.12);
    // 門上的模板字
    const sten = std(0xffffff, 0.7, 0.2, {
      map: signTex([['HANGAR BAY 02', 64, 0.55]], '#20262c', 1024, 128),
      transparent: true,
      alphaTest: 0.3,
    });
    plane(gate, 2.8, 0.35, sten, 0, 1.92, 0.175);
    // 兩側的液壓缸
    for (const sx of [-1, 1]) {
      rbox(gate, 0.32, 0.3, 0.3, M.frame, sx * 2.12, 0.25, 0.42);
      rbox(gate, 0.32, 0.3, 0.3, M.frame, sx * 2.12, 3.3, 0.42);
      piston(gate, [sx * 2.12, 0.42, 0.42], [sx * 2.12, 3.15, 0.42], 0.08, M);
    }
    // 上方的燈箱看板、旋轉警示燈
    rbox(gate, 2.4, 0.46, 0.18, M.dark, 0, 4.3, 0.05, 0, 0, 0, 0.04);
    const signM = new THREE.MeshBasicMaterial({
      map: signTex([['HANGAR ▸ 機甲庫', 54, 0.52]], '#ffd27a', 512, 96, '#140f06'),
    });
    plane(gate, 2.25, 0.4, signM, 0, 4.3, 0.145);
    const beaconM = glowM(0xffa020, 0.75);
    for (const sx of [-1, 1]) {
      cyl(gate, 0.13, 0.15, 0.1, M.dark, sx * 2.0, 4.06, 0.15, 16);
      cyl(gate, 0.11, 0.11, 0.2, beaconM, sx * 2.0, 4.21, 0.15, 16);
      const rf = grp(gate, sx * 2.0, 4.21, 0.15);
      rf.userData.keep = true;
      box(rf, 0.16, 0.12, 0.03, M.chrome, 0, 0, 0);
      spin.push([rf, 'y', 4 * sx]);
    }
    // 右側的控制面板
    const cp = grp(gate, 2.75, 0, 0.6);
    rbox(cp, 0.38, 1.05, 0.28, M.panelD, 0, 0.53, 0, 0, 0, 0, 0.04);
    rbox(cp, 0.5, 0.36, 0.1, M.dark, 0, 1.2, 0.05, -0.55);
    plane(
      cp,
      0.42,
      0.28,
      new THREE.MeshBasicMaterial({ map: uiTex('keys', '#ffc860', 9) }),
      0,
      1.23,
      0.105,
      -0.55,
    );
    // 門檻：警示條的地板與軌道
    const hzF = std(0xffffff, 0.6, 0.4, { map: hazardTex(false) });
    hzF.map.repeat.set(2, 1);
    hzF.map.wrapS = THREE.RepeatWrapping;
    box(gate, 3.9, 0.03, 0.55, hzF, 0, 0.015, 0.55);
    box(gate, 3.6, 0.035, 0.06, M.chrome, 0, 0.02, 0.2);
    mergeStatic(gate);
    spot('garage', new THREE.Vector3(4.0, 5.4, -ROOM_D / 2 + 0.6), [slit.material, signM, beaconM], gate);
  }
  // ---------- 駕駛員區（左牆後段：置物櫃、長椅、狀態螢幕） ----------
  {
    const pilot = grp(root, -ROOM_W / 2 + 0.75, 0, -3.6);
    rbox(pilot, 0.9, 0.1, 3.4, M.dark, 0, 0.05, 0);
    const plateM = glowM(0x5cc8ff);
    for (let k = 0; k < 4; k++) {
      const z = -1.2 + k * 0.8;
      rbox(pilot, 0.62, 2.2, 0.76, M.frame, 0, 1.2, z, 0, 0, 0, 0.03);
      rbox(pilot, 0.66, 0.06, 0.8, M.trim, 0, 2.33, z);
      const open = k === 2;
      // 門板（開著的那一扇繞鉸鏈轉開）
      const door = grp(pilot, 0.33, 0, z - 0.35, open ? -1.9 : 0);
      const dz = 0.35;
      rbox(door, 0.04, 2.05, 0.68, M.panel, 0, 1.18, dz, 0, 0, 0, 0.015);
      for (let i = 0; i < 6; i++) box(door, 0.02, 0.028, 0.42, M.dark, 0.022, 1.96 - i * 0.06, dz);
      rbox(door, 0.04, 0.24, 0.04, M.chrome, 0.04, 1.15, dz + 0.24, 0, 0, 0, 0.012);
      box(door, 0.012, 0.06, 0.34, plateM, 0.025, 1.66, dz);
      const nm = std(0xffffff, 0.6, 0.1, {
        map: signTex([[`P-0${k + 1}`, 72, 0.5]], '#1c242c', 256, 96),
        transparent: true,
        alphaTest: 0.3,
      });
      plane(door, 0.3, 0.11, nm, 0.022, 1.48, dz, 0, Math.PI / 2);
      if (open) {
        // 打開的置物櫃：駕駛服、頭盔、架子
        box(pilot, 0.02, 2.0, 0.7, M.dark, -0.29, 1.2, z);
        box(pilot, 0.55, 0.03, 0.7, M.trim, 0, 1.85, z);
        rod(pilot, [0, 1.75, z - 0.32], [0, 1.75, z + 0.32], 0.012, M.chrome);
        const suit = grp(pilot, 0.02, 0, z);
        const lp = [
          [0.02, 0.75],
          [0.13, 0.78],
          [0.16, 1.0],
          [0.17, 1.3],
          [0.22, 1.52],
          [0.12, 1.66],
          [0.04, 1.7],
        ].map(([r, y]) => new THREE.Vector2(r, y));
        const tor = put(suit, new THREE.LatheGeometry(lp, 16), M.cloth);
        tor.scale.set(0.7, 1, 1.25);
        for (const s of [-1, 1]) {
          rod(suit, [0, 1.55, s * 0.26], [0.02, 1.0, s * 0.3], 0.05, M.cloth, 8);
          rod(suit, [0, 1.05, s * 0.1], [0, 0.42, s * 0.11], 0.06, M.cloth, 8);
          box(suit, 0.02, 0.05, 0.12, M.orange, 0.11, 1.35, s * 0.1);
        }
        put(pilot, new THREE.SphereGeometry(0.14, 16, 12), M.white, 0, 2.02, z);
        put(
          pilot,
          new THREE.SphereGeometry(0.142, 16, 10, -0.9, 1.8, 0.9, 0.9),
          M.dark,
          0,
          2.02,
          z,
          0,
          Math.PI / 2,
        );
      }
    }
    // 長椅、頭盔、背包
    rbox(pilot, 0.42, 0.08, 2.4, M.cushion, 1.05, 0.46, 0.1, 0, 0, 0, 0.03);
    rbox(pilot, 0.46, 0.04, 2.45, M.trim, 1.05, 0.4, 0.1);
    for (const z of [-0.9, 1.1]) rbox(pilot, 0.36, 0.38, 0.06, M.frame, 1.05, 0.19, z);
    put(pilot, new THREE.SphereGeometry(0.155, 20, 14), M.white, 1.05, 0.65, 0.5);
    put(
      pilot,
      new THREE.SphereGeometry(0.158, 20, 12, -0.9, 1.8, 0.9, 0.9),
      M.dark,
      1.05,
      0.65,
      0.5,
      0,
      Math.PI / 2,
    );
    box(pilot, 0.06, 0.03, 0.3, M.orange, 1.05, 0.79, 0.5);
    rbox(pilot, 0.3, 0.26, 0.55, M.cloth, 1.08, 0.63, -0.45, 0, 0.2, 0, 0.1);
    // 上方的狀態螢幕
    rbox(pilot, 0.08, 0.72, 1.25, M.dark, 0.18, 2.85, 0, 0, 0, 0, 0.03);
    rod(pilot, [0.1, 2.5, 0], [0.1, 2.36, 0], 0.03, M.trim);
    const pScr = new THREE.MeshBasicMaterial({ map: uiTex('pilot', '#7fd0ff', 21) });
    plane(pilot, 1.15, 0.62, pScr, 0.225, 2.85, 0, 0, Math.PI / 2);
    const pGlow = box(pilot, 0.04, 0.04, 3.1, glowM(0x5cc8ff, 0.8), 0.35, 2.36, 0);
    mergeStatic(pilot);
    spot('pilot', new THREE.Vector3(-ROOM_W / 2 + 1.2, 3.4, -3.6), [pGlow.material, plateM, pScr], pilot);
  }
  // ---------- 模擬艙（左牆前段：底座、萬向架、蛋形的艙、掀開的艙罩） ----------
  {
    const sim = grp(root, -ROOM_W / 2 + 1.5, 0, 2.6);
    cyl(sim, 1.25, 1.32, 0.22, M.frame, 0, 0.11, 0, 8, 0, Math.PI / 8);
    cyl(sim, 1.12, 1.12, 0.04, M.panelD, 0, 0.24, 0, 8, 0, Math.PI / 8);
    const edgeM = glowM(0x5ab8ff, 0.85);
    torus(sim, 1.2, 0.015, edgeM, 0, 0.23, 0, Math.PI / 2, 0, 0, 8);
    rbox(sim, 0.5, 0.12, 0.9, M.trim, 1.45, 0.06, 0);
    box(sim, 0.46, 0.01, 0.86, std(0xffffff, 0.6, 0.3, { map: hazardTex(false) }), 1.45, 0.125, 0);
    torus(sim, 0.58, 0.06, M.trim, 0, 0.62, 0, Math.PI / 2, 0, 0, 32);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      piston(
        sim,
        [Math.sin(a) * 0.85, 0.27, Math.cos(a) * 0.85],
        [Math.sin(a) * 0.4, 0.78, Math.cos(a) * 0.4],
        0.055,
        M,
      );
    }
    // 艙：蛋形（前方 +x 開口）
    const prof = [
      [0.04, 0],
      [0.45, 0.05],
      [0.74, 0.25],
      [0.87, 0.6],
      [0.9, 0.95],
      [0.82, 1.3],
      [0.6, 1.6],
      [0.3, 1.76],
      [0.02, 1.8],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const op = 1.15;
    put(
      sim,
      new THREE.LatheGeometry(prof, 40, Math.PI / 2 + op, Math.PI * 2 - op * 2),
      M.podShell,
      0,
      0.72,
      0,
    );
    torus(sim, 0.9, 0.03, M.dark, 0, 0.72 + 0.95, 0, Math.PI / 2, 0, 0, 40);
    // 掀開的艙罩：鉸鏈在後上方
    const hinge = grp(sim, -0.25, 0.72 + 1.75, 0);
    hinge.rotation.z = 0.95;
    put(hinge, new THREE.LatheGeometry(prof, 24, Math.PI / 2 - op, op * 2), M.podShell, 0.25, -1.75, 0);
    const win = put(
      hinge,
      new THREE.LatheGeometry(
        prof.slice(3, 8).map((v) => new THREE.Vector2(v.x * 1.012, v.y)),
        16,
        Math.PI / 2 - op * 0.7,
        op * 1.4,
      ),
      glowM(0x5ab8ff, 0.5),
      0.25,
      -1.75,
      0,
    );
    win.material.side = THREE.DoubleSide;
    // 艙內：座椅、操縱桿、螢幕
    rbox(sim, 0.45, 0.12, 0.5, M.cushion, 0.05, 1.12, 0, 0, 0, 0, 0.04);
    rbox(sim, 0.12, 0.7, 0.5, M.cushion, -0.25, 1.5, 0, 0, 0, 0.2, 0.04);
    rbox(sim, 0.1, 0.18, 0.3, M.cushion, -0.33, 1.95, 0, 0, 0, 0.2, 0.04);
    for (const s of [-1, 1]) {
      rbox(sim, 0.4, 0.08, 0.1, M.trim, 0.1, 1.25, s * 0.32);
      rod(sim, [0.25, 1.28, s * 0.32], [0.3, 1.45, s * 0.32], 0.018, M.chrome);
      put(sim, new THREE.SphereGeometry(0.04, 10, 8), M.dark, 0.3, 1.47, s * 0.32);
    }
    const simScr = new THREE.MeshBasicMaterial({ map: uiTex('sim', '#7fd0ff', 31) });
    plane(sim, 0.5, 0.3, simScr, -0.62, 2.0, 0, 0, Math.PI / 2 + 0.0, 0);
    // 艙外：標誌與電纜
    const lg = std(0xffffff, 0.6, 0.1, {
      map: signTex([['SIM-01', 70, 0.5]], '#26303a', 256, 96),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
    });
    plane(sim, 0.5, 0.18, lg, -0.9, 1.6, 0, 0, -Math.PI / 2);
    for (const s of [-1, 1])
      cable(
        sim,
        [
          [-0.82, 1.2, s * 0.2],
          [-1.15, 0.9, s * 0.35],
          [-1.25, 0.35, s * 0.5],
          [-1.05, 0.26, s * 0.75],
        ],
        0.04,
        M.rubber,
      );
    // 旁邊的操作台
    const sc = grp(sim, 1.15, 0, -1.25, 0.5);
    rbox(sc, 0.32, 0.95, 0.32, M.panelD, 0, 0.5, 0, 0, 0, 0, 0.04);
    rbox(sc, 0.5, 0.06, 0.4, M.dark, 0, 1.0, 0.04, -0.4);
    plane(sc, 0.44, 0.32, simScr, 0, 1.035, 0.05, -0.4 - Math.PI / 2);
    mergeStatic(sim);
    spot('sim', new THREE.Vector3(-ROOM_W / 2 + 1.5, 3.0, 2.6), [win.material, edgeM, simScr], sim);
  }
  // ---------- 通訊台（右牆後段：弧形控制台、多面螢幕、指揮椅） ----------
  {
    const com = grp(root, ROOM_W / 2 - 1.3, 0, -3.4, -Math.PI / 2);
    const keysM = new THREE.MeshBasicMaterial({ map: uiTex('keys', '#5cc8ff', 41) });
    for (const [x, z, ry, w] of [
      [0, 0, 0, 1.3],
      [-1.18, 0.22, 0.38, 1.0],
      [1.18, 0.22, -0.38, 1.0],
    ]) {
      const m = grp(com, x, 0, z, ry);
      rbox(m, w, 0.78, 0.66, M.panelD, 0, 0.39, 0, 0, 0, 0, 0.04);
      rbox(m, w - 0.1, 0.1, 0.6, M.dark, 0, 0.05, -0.02);
      for (let i = 0; i < 3; i++) box(m, w * 0.6, 0.02, 0.01, M.dark, 0, 0.25 + i * 0.05, 0.335);
      const top = rbox(m, w, 0.06, 0.58, M.dark, 0, 0.82, 0.08, -0.22, 0, 0, 0.02);
      const kp = plane(m, w - 0.12, 0.42, keysM, 0, 0, 0);
      kp.position.copy(top.position);
      kp.rotation.set(-0.22 - Math.PI / 2, 0, 0);
      kp.translateZ(0.032);
      rbox(m, w, 0.05, 0.1, M.cushion, 0, 0.8, 0.38, 0, 0, 0, 0.02);
    }
    // 螢幕架與螢幕
    for (const sx of [-1.2, 1.2]) rod(com, [sx, 0.8, -0.3], [sx, 2.45, -0.3], 0.035, M.chrome);
    box(com, 2.6, 0.05, 0.05, M.trim, 0, 1.25, -0.32);
    box(com, 2.6, 0.05, 0.05, M.trim, 0, 2.3, -0.32);
    const screens = [];
    const scr = (x, y, w, h, ry, kind, seed, col) => {
      const s = grp(com, x, y, -0.28, ry);
      rbox(s, w + 0.06, h + 0.06, 0.05, M.dark, 0, 0, 0, 0, 0, 0, 0.015);
      const sm = new THREE.MeshBasicMaterial({ map: uiTex(kind, col, seed) });
      screens.push(sm);
      plane(s, w, h, sm, 0, 0, 0.027);
    };
    scr(-0.86, 1.55, 0.76, 0.46, 0.22, 'wave', 1, '#6fe39a');
    scr(0, 1.55, 0.8, 0.48, 0, 'map', 2, '#6fd3ff');
    scr(0.86, 1.55, 0.76, 0.46, -0.22, 'list', 3, '#6fe39a');
    scr(-0.45, 2.05, 0.8, 0.4, 0.1, 'bars', 4, '#ffc860');
    scr(0.45, 2.05, 0.8, 0.4, -0.1, 'wave', 5, '#6fd3ff');
    // 指揮椅
    const ch = grp(com, 0, 0, 0.95);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      rod(ch, [0, 0.08, 0], [Math.sin(a) * 0.32, 0.05, Math.cos(a) * 0.32], 0.025, M.trim, 6);
      put(ch, new THREE.SphereGeometry(0.035, 8, 6), M.rubber, Math.sin(a) * 0.32, 0.035, Math.cos(a) * 0.32);
    }
    cyl(ch, 0.035, 0.045, 0.36, M.chrome, 0, 0.26, 0, 10);
    rbox(ch, 0.52, 0.1, 0.5, M.cushion, 0, 0.48, 0, 0, 0, 0, 0.04);
    rbox(ch, 0.5, 0.65, 0.09, M.cushion, 0, 0.85, 0.24, 0.12, 0, 0, 0.04);
    rbox(ch, 0.3, 0.16, 0.08, M.cushion, 0, 1.25, 0.29, 0.12, 0, 0, 0.04);
    for (const s of [-1, 1]) {
      rbox(ch, 0.06, 0.05, 0.36, M.trim, s * 0.29, 0.68, 0.02);
      rod(ch, [s * 0.29, 0.5, 0.05], [s * 0.29, 0.66, 0.05], 0.02, M.chrome, 6);
    }
    // 桌上的耳機與杯子
    put(com, new THREE.TorusGeometry(0.09, 0.012, 6, 16, Math.PI), M.dark, -0.4, 0.95, 0.25, -0.2);
    for (const s of [-1, 1])
      cyl(com, 0.04, 0.04, 0.03, M.dark, -0.4 + s * 0.09, 0.9, 0.25, 12, 0, 0, Math.PI / 2);
    cyl(com, 0.04, 0.035, 0.1, M.white, 0.5, 0.92, 0.2, 12);
    // 側邊的機櫃
    const rk = grp(com, 1.95, 0, -0.1);
    rbox(rk, 0.55, 1.7, 0.6, M.frame, 0, 0.85, 0, 0, 0, 0, 0.03);
    plane(
      rk,
      0.4,
      1.4,
      new THREE.MeshBasicMaterial({ map: uiTex('leds', '#3cff90', 51, 64, 256) }),
      0,
      0.85,
      0.302,
    );
    rod(rk, [0.15, 1.7, 0], [0.15, 2.6, 0], 0.012, M.chrome, 6);
    put(rk, new THREE.SphereGeometry(0.03, 8, 6), glowM(0xff4030), 0.15, 2.62, 0);
    mergeStatic(com);
    spot('log', new THREE.Vector3(ROOM_W / 2 - 1.3, 2.9, -3.4), screens, com);
  }
  // ---------- 檔案櫃（右牆前段：作戰紀錄的兩櫃、章節回顧的展示櫃） ----------
  const arcG = [];
  {
    const rec = grp(root, ROOM_W / 2 - 0.6, 0, 2.4);
    const sto = grp(root, ROOM_W / 2 - 0.6, 0, 2.4);
    const ledM = new THREE.MeshBasicMaterial({ map: uiTex('leds', '#3cff90', 61, 64, 256) });
    for (let k = 0; k < 3; k++) {
      const g = k < 2 ? rec : sto,
        z = k * 0.95 - 0.95;
      rbox(g, 0.8, 2.4, 0.9, M.frame, 0, 1.2, z, 0, 0, 0, 0.03);
      rbox(g, 0.84, 0.08, 0.94, M.trim, 0, 2.42, z);
      rbox(g, 0.84, 0.12, 0.94, M.dark, 0, 0.06, z);
      box(g, 0.7, 0.07, 0.86, M.trim, 0.02, 2.5, z);
      for (let i = 0; i < 3; i++)
        cyl(g, 0.025, 0.025, 0.86, M.rubber, 0.05 - i * 0.12, 2.56, z, 6, Math.PI / 2);
      if (k < 2) {
        // 抽屜：把手、琥珀色的標籤燈
        for (let i = 0; i < 5; i++) {
          const y = 0.35 + i * 0.42;
          rbox(g, 0.05, 0.38, 0.7, M.panel, -0.4, y, z - 0.03, 0, 0, 0, 0.012);
          rbox(g, 0.04, 0.04, 0.3, M.chrome, -0.44, y - 0.06, z - 0.03, 0, 0, 0, 0.015);
          const gm = glowM(0xffb020, 0.75);
          arcG.push(gm);
          box(g, 0.01, 0.045, 0.22, gm, -0.43, y + 0.1, z - 0.03);
        }
        plane(g, 0.07, 2.0, ledM, -0.405, 1.2, z + 0.4, 0, -Math.PI / 2);
      } else {
        // 展示櫃：玻璃門、架上的資料核心
        const coreM = glowM(0xffb020, 0.85);
        arcG.push(coreM);
        box(g, 0.02, 2.15, 0.8, M.dark, -0.3, 1.22, z);
        for (let i = 0; i < 4; i++) {
          const y = 0.4 + i * 0.5;
          box(g, 0.6, 0.03, 0.78, M.trim, -0.05, y, z);
          for (let j = 0; j < 5; j++)
            cyl(g, 0.035, 0.035, 0.22, coreM, -0.22, y + 0.13, z - 0.3 + j * 0.15, 8);
        }
        const gl = std(0x9fd8ff, 0.05, 0.6, { transparent: true, opacity: 0.18, depthWrite: false });
        box(g, 0.02, 2.15, 0.8, gl, -0.41, 1.22, z);
        rbox(g, 0.04, 2.2, 0.06, M.trim, -0.41, 1.22, z - 0.42);
        rbox(g, 0.04, 2.2, 0.06, M.trim, -0.41, 1.22, z + 0.42);
        // 上面的全像：翻開的書
        cyl(g, 0.16, 0.2, 0.08, M.dark, -0.05, 2.66, z, 16);
        const book = grp(g, -0.05, 2.95, z);
        book.userData.keep = true;
        const bm = glowM(0xffd27a, 0.7);
        arcG.push(bm);
        for (const s of [-1, 1]) box(book, 0.01, 0.22, 0.2, bm, 0, 0, s * 0.1, 0, s * 0.35);
        spin.push([book, 'y', 0.7]);
      }
    }
    mergeStatic(rec);
    mergeStatic(sto);
    spot('record', new THREE.Vector3(ROOM_W / 2 - 0.9, 2.9, 1.9), arcG.slice(0, 10), rec);
    spot('story', new THREE.Vector3(ROOM_W / 2 - 0.9, 3.4, 3.35), arcG.slice(10), sto);
  }
  // ---------- 委託方看板（後牆左側：立架上的顯示牆） ----------
  {
    const fb = grp(root, -4.2, 0, -ROOM_D / 2 + 0.45);
    for (const sx of [-1, 1]) {
      rbox(fb, 0.16, 3.9, 0.16, M.trim, sx * 2.0, 1.95, 0, 0, 0, 0, 0.03);
      rbox(fb, 0.5, 0.08, 0.5, M.frame, sx * 2.0, 0.04, 0);
      rbox(fb, 0.08, 0.6, 0.3, M.panelD, sx * 2.0, 0.6, 0.05);
    }
    rbox(fb, 4.2, 1.65, 0.16, M.frame, 0, 2.95, 0, 0, 0, 0, 0.04);
    rbox(fb, 4.0, 1.45, 0.04, M.dark, 0, 2.95, 0.08);
    const facM = [];
    const hdr = new THREE.MeshBasicMaterial({
      map: signTex([['CLIENT REGISTRY ／ 委託方', 40, 0.55]], '#cfe6f5', 1024, 64, '#0b1218'),
    });
    facM.push(hdr);
    plane(fb, 3.8, 0.24, hdr, 0, 3.55, 0.105);
    (factions || []).forEach(([col, ch, nm], i) => {
      const t = canvasTex(256, 320, (c, w, h) => {
        c.fillStyle = '#0b1116';
        c.fillRect(0, 0, w, h);
        c.strokeStyle = col;
        c.globalAlpha = 0.35;
        c.lineWidth = 2;
        c.strokeRect(6, 6, w - 12, h - 12);
        c.globalAlpha = 1;
        c.save();
        c.translate(w / 2, 130);
        c.rotate(Math.PI / 4);
        c.lineWidth = 9;
        c.strokeRect(-60, -60, 120, 120);
        c.lineWidth = 3;
        c.strokeRect(-76, -76, 152, 152);
        c.restore();
        c.fillStyle = col;
        c.font = 'bold 84px "Chakra Petch", sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillText(ch, w / 2, 134);
        c.font = 'bold 28px "Chakra Petch", sans-serif';
        c.fillText(nm || '', w / 2, 270);
      });
      const m = new THREE.MeshBasicMaterial({ map: t });
      facM.push(m);
      const x = -1.44 + i * 0.96;
      rbox(fb, 0.9, 1.1, 0.04, M.trim, x, 2.86, 0.11, 0, 0, 0, 0.015);
      plane(fb, 0.84, 1.05, m, x, 2.86, 0.132);
    });
    // 上方的投射燈
    for (const sx of [-1, 1]) {
      rod(fb, [sx * 1.3, 3.78, 0.05], [sx * 1.3, 3.95, 0.4], 0.02, M.chrome, 6);
      cyl(fb, 0.07, 0.1, 0.16, M.dark, sx * 1.3, 3.95, 0.45, 12, -0.9);
    }
    mergeStatic(fb);
    spot('fac', new THREE.Vector3(-4.2, 4.2, -ROOM_D / 2 + 0.5), facM, fb);
  }
  // ---------- 存檔終端（後牆中央偏左，和 ECHO 的終端左右對稱：資料核心的機櫃，正面三個插槽＝三個存檔） ----------
  // 插槽的燈（R.saveSlots）每格由 game/hub-holo.js 依各槽位的狀態上色；兩側的燈條（R.saveLed）在自動存檔時閃一下
  let saveSlots, saveLed;
  {
    const sv = grp(root, -1.4, 0, -ROOM_D / 2 + 0.75, 0.12);
    rbox(sv, 0.96, 0.1, 0.66, M.frame, 0, 0.05, 0, 0, 0, 0, 0.03);
    rbox(sv, 0.82, 2.7, 0.52, M.panelD, 0, 1.45, 0, 0, 0, 0, 0.04);
    rbox(sv, 0.9, 0.1, 0.6, M.trim, 0, 2.85, 0, 0, 0, 0, 0.03);
    box(sv, 0.66, 2.36, 0.02, M.dark, 0, 1.52, 0.26);
    // 側面的散熱鰭片
    for (const sx of [-1, 1])
      for (let i = 0; i < 9; i++) box(sv, 0.02, 0.05, 0.36, M.dark, sx * 0.415, 0.5 + i * 0.22, 0);
    saveLed = glowM(0x5cc8ff, 0.9);
    for (const sx of [-1, 1]) box(sv, 0.03, 2.3, 0.03, saveLed, sx * 0.355, 1.52, 0.275);
    // 三個插槽：框、插著的資料匣、狀態燈、編號
    saveSlots = [];
    for (let i = 0; i < 3; i++) {
      const y = 2.38 - i * 0.42;
      rbox(sv, 0.58, 0.36, 0.06, M.frame, 0, y - 0.015, 0.28, 0, 0, 0, 0.02);
      box(sv, 0.5, 0.2, 0.02, M.rubber, 0, y, 0.31);
      rbox(sv, 0.44, 0.15, 0.1, M.panel, 0, y + 0.005, 0.33, 0, 0, 0, 0.02);
      box(sv, 0.04, 0.12, 0.03, M.chrome, -0.19, y + 0.005, 0.37);
      const m = glowM(0x1a2229);
      saveSlots.push(m);
      box(sv, 0.14, 0.08, 0.02, m, 0.12, y + 0.005, 0.388);
      const nm = std(0xffffff, 0.6, 0.1, {
        map: signTex([[`0${i + 1}`, 72, 0.5]], '#1c242c', 128, 96),
        transparent: true,
        alphaTest: 0.3,
      });
      plane(sv, 0.12, 0.09, nm, -0.06, y + 0.005, 0.382);
    }
    // 下方的螢幕與操作面
    rbox(sv, 0.7, 0.5, 0.06, M.frame, 0, 0.98, 0.28, 0, 0, 0, 0.02);
    const sScr = new THREE.MeshBasicMaterial({ map: uiTex('save', '#7fd0ff', 31) });
    plane(sv, 0.62, 0.42, sScr, 0, 0.98, 0.315);
    rbox(sv, 0.76, 0.06, 0.3, M.trim, 0, 0.62, 0.38, 0.35, 0, 0, 0.02);
    plane(
      sv,
      0.66,
      0.22,
      new THREE.MeshBasicMaterial({ map: uiTex('keys', '#7fd0ff', 32) }),
      0,
      0.655,
      0.39,
      0.35 - Math.PI / 2,
    );
    // 上面的看板
    const sSign = new THREE.MeshBasicMaterial({
      map: signTex([['DATA CORE ／ 存檔', 40, 0.55]], '#cfe6f5', 512, 64, '#0b1218'),
    });
    plane(sv, 0.8, 0.1, sSign, 0, 2.76, 0.27);
    // 往後接到地板的電纜
    for (const sx of [-0.2, 0, 0.2])
      cable(
        sv,
        [
          [sx, 2.6, -0.26],
          [sx, 1.4, -0.4],
          [sx * 1.4, 0.03, -0.6],
        ],
        0.025,
        M.rubber,
      );
    mergeStatic(sv);
    spot('save', new THREE.Vector3(-1.4, 3.3, -ROOM_D / 2 + 0.75), [sScr, sSign], sv);
  }
  // ---------- ECHO 的終端（後牆中央偏右：基座、投影機、浮在上面的全像） ----------
  let eHolo;
  {
    const echo = grp(root, 1.6, 0, -ROOM_D / 2 + 1.4);
    cyl(echo, 0.7, 0.76, 0.12, M.frame, 0, 0.06, 0, 8, 0, Math.PI / 8);
    cyl(echo, 0.52, 0.56, 0.1, M.panelD, 0, 0.17, 0, 8, 0, Math.PI / 8);
    cyl(echo, 0.28, 0.34, 0.62, M.panel, 0, 0.53, 0, 20);
    for (const y of [0.32, 0.52, 0.72]) torus(echo, 0.31, 0.018, M.dark, 0, y, 0, Math.PI / 2, 0, 0, 24);
    cyl(echo, 0.2, 0.22, 0.38, M.trim, 0, 1.03, 0, 16);
    cyl(echo, 0.4, 0.3, 0.12, M.panelD, 0, 1.27, 0, 20);
    cyl(echo, 0.42, 0.4, 0.05, M.dark, 0, 1.35, 0, 20);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      rbox(echo, 0.06, 0.95, 0.3, M.panelD, Math.sin(a) * 0.38, 0.7, Math.cos(a) * 0.38, 0, a, 0, 0.02);
      cable(
        echo,
        [
          [Math.sin(a + 0.6) * 0.3, 0.4, Math.cos(a + 0.6) * 0.3],
          [Math.sin(a + 0.6) * 0.6, 0.25, Math.cos(a + 0.6) * 0.6],
          [Math.sin(a + 0.6) * 0.95, 0.03, Math.cos(a + 0.6) * 0.95],
        ],
        0.03,
        M.rubber,
      );
    }
    const lensM = glowM(0xffd060, 0.9);
    put(echo, new THREE.CircleGeometry(0.2, 24), lensM, 0, 1.38, 0, -Math.PI / 2);
    const coneM = new THREE.MeshBasicMaterial({
      color: 0xffd060,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    cyl(echo, 0.45, 0.18, 0.45, coneM, 0, 1.6, 0, 24).castShadow = false;
    eHolo = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowM(0xffd060, 0.75));
    eHolo.position.y = 1.85;
    eHolo.userData.keep = true;
    echo.add(eHolo);
    const ringM = glowM(0xffd060, 0.55);
    for (const [r, ax] of [
      [0.46, 0.3],
      [0.38, -0.5],
    ]) {
      const rg = grp(echo, 0, 1.85, 0);
      rg.userData.keep = true;
      torus(rg, r, 0.008, ringM, 0, 0, 0, Math.PI / 2 + ax, 0, 0, 64);
      spin.push([rg, 'y', ax > 0 ? 1.1 : -0.8]);
    }
    mergeStatic(echo);
    spot('echo', new THREE.Vector3(1.6, 2.8, -ROOM_D / 2 + 1.4), [eHolo.material, lensM, ringM], echo);
  }
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
    sp.position.set(x, ROOM_H - 0.6, z);
    sp.target.position.set(x * 0.6, 0, z * 0.6);
    root.add(sp, sp.target);
  }
  lamp(4.0, 3, -ROOM_D / 2 + 1.2, 0xffc070, 1.2, 7);
  // 每個設施一個圖層（游標停留的發光輪廓：game/hub-holo.js 只畫這個圖層）
  let L = 1;
  for (const s of Object.values(spots)) {
    if (!s.obj) continue;
    s.layer = L++;
    s.obj.userData.hubSpot = s.id;
    s.obj.traverse((o) => o.isMesh && o.layers.enable(s.layer));
  }
  return {
    root,
    spots,
    table: T,
    lights: [strip],
    echo: eHolo,
    spin,
    base: M,
    rich: false,
    saveSlots,
    saveLed,
  };
}

// 格納庫的外部素材（HA）載入後：地板換成 PBR 金屬板、加幾個道具（監視器、工具箱、箱子）
export function hubRoomRich(R) {
  if (R.rich || !HA.ready) return;
  R.rich = true;
  const add = (name, x, y, z, ry = 0, s = 1) => {
    const p = haProp(name);
    if (!p) return null;
    p.position.set(x, y, z);
    p.rotation.y = ry;
    p.scale.setScalar(s);
    R.root.add(p);
    return p;
  };
  add('security_camera_01', -ROOM_W / 2 + 0.3, 8.2, -ROOM_D / 2 + 0.3, Math.PI * 0.75);
  add('security_camera_01', ROOM_W / 2 - 0.3, 8.2, -ROOM_D / 2 + 0.3, -Math.PI * 0.75);
  add('metal_tool_chest', 6.0, 0, -1.9, -Math.PI / 2);
  add('plastic_crate_02', -5.9, 0, 5.2, 0.3);
  add('plastic_crate_02', -5.85, 0.33, 5.2, 0.1);
  add('medical_box', -6.1, 1.3, -1.6, Math.PI / 2);
  add('power_box_01', ROOM_W / 2 - 0.25, 1.1, 4.6, -Math.PI / 2);
}

// 每格：燈條呼吸、設施的發光（hot 0～1）、ECHO 的全像與其他轉動的東西
export function tickHubRoom(R, dt, t) {
  for (const m of R.lights) m.opacity = 0.45 + 0.1 * Math.sin(t * 1.3);
  for (const s of Object.values(R.spots)) {
    const k = s.on ? 0.55 + 0.45 * s.hot : 0.12;
    for (const m of s.glow) {
      if (m.userData.c0 === undefined) m.userData.c0 = m.color.getHex();
      m.color.setHex(m.userData.c0).multiplyScalar(k + (s.hot > 0.5 ? 0.25 * Math.sin(t * 6) : 0));
    }
  }
  for (const [o, ax, v] of R.spin) o.rotation[ax] += v * dt;
  R.echo.rotation.y = t * 0.8;
  R.echo.position.y = 1.85 + Math.sin(t * 1.6) * 0.05;
}
