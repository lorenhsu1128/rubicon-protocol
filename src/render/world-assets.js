// 地圖物件的外部素材：Poly Haven 的 CC0 岩石、油桶、護欄，NASA 3D Resources 的雷達天線與雷達罩
// （原始檔在 src/assets/world/，來源見 CREDITS.txt）。建置成 dist/lib/world-assets.js（window.RUBICON_WORLD），
// 遊戲啟動時以 <script> 載入（game/local-lib.js 的 lmInit），不內嵌在 HTML。
// 只換外觀：建模函式照常建好程式模型，最後交給 prop-models.js 的 swapProp，它依這裡的 SLOTS 把 GLB 縮放到程式模型的範圍，
// 網格的外框設成程式模型的外框（碰撞、命中形狀、遮擋都由外框量測，所以不變）。沒載到時一律是程式模型。
// 每個人的 lib/ 都相同，所以多人時各端一樣；不使用亂數：同一張地圖依建立順序輪流挑素材（World 建立時 worldAssetsReset）。
import { markAuthoredTex } from './style/shader.js';

// off：暫時不換（模型庫的開關、和程式模型對照或量規格的參考外框）
export const WA = { ready: false, failed: false, off: false, p: null, tpl: {}, n: {} };
if (/[?&]test\b/.test(location.search)) window.__WA = WA; // 冒煙測試等素材載入完

const ROCKS = ['boulder_02', 'boulder_03', 'boulder_04', 'boulder_05'];
// 槽位（prop-models 的 propGlb 名稱）→ 換法：
//   src 依序輪流的素材；each＝程式模型的每個網格各換一塊（落石堆、冰塊）；parts＝[素材, 範圍 [x0,y0,z0,x1,y1,z1]] 各自填進範圍
//   fit：box＝長寬高分別縮放到程式模型的範圍（預設）、h＝依高度等比、w＝依寬度等比
//   tint＝貼圖轉灰階、乘上程式模型的顏色（岩石跟著主題的顏色）；light＝顏色再往白色調亮（碎塊）；ice＝換成冰的材質；
//   keepGlow＝保留程式模型裡發光的網格（汙染物桶的桶蓋）；rot＝素材先轉的角度（Euler）
export const SLOTS = {
  rock: { src: ROCKS, tint: true },
  debris: { src: ['boulder_05', 'boulder_02'], tint: true, light: 0.12 },
  rubble: { src: ['boulder_02', 'boulder_05'], tint: true, light: 0.1 },
  rock_spire: { src: ['cliff_01'], rot: [0, 0, Math.PI / 2], tint: true },
  sandstone: { src: ['boulder_04', 'cliff_01'], tint: true },
  rock_pile: { each: ROCKS, tint: true },
  ice_chunk: { each: ROCKS, ice: true },
  ice_shard: { src: ['boulder_05', 'boulder_02'], ice: true },
  barrels: {
    parts: [0, 1, 2].map((i) => {
      const x = Math.cos(i * 2.1) * 0.6,
        z = Math.sin(i * 2.1) * 0.6;
      return [i === 1 ? 'barrel_02' : 'barrel_01', [x - 0.45, 0, z - 0.45, x + 0.45, 1.33, z + 0.45]];
    }),
  },
  toxic_drum: { src: ['barrel_02'], keepGlow: true },
  barrier: {
    parts: [
      ['barrier', [-2, 0, -0.45, 0, 1.1, 0.45]],
      ['barrier', [0, 0, -0.45, 2, 1.1, 0.45]],
    ],
  },
  radar_dish: { src: ['dsn34'], fit: 'h' },
  obs_dome: { src: ['radome'], fit: 'w' },
};
// fn 執行期間一律用程式模型（量程式模型的外框、並排對照）
export function withoutAssets(fn) {
  const prev = WA.off;
  WA.off = true;
  try {
    return fn();
  } finally {
    WA.off = prev;
  }
}
// 這個物件（或它的子孫）換成了外部素材時回傳槽位名稱
export function assetOf(obj) {
  let s = null;
  obj.traverse((o) => {
    if (!s && o.userData && o.userData.asset) s = o.userData.asset;
  });
  return s;
}
// 每張地圖重新從第一個素材開始輪流（房主與客機建地圖的順序相同，挑到的也相同）
export function worldAssetsReset() {
  WA.n = {};
}
export function pickAsset(slot, list) {
  const i = WA.n[slot] || 0;
  WA.n[slot] = i + 1;
  return WA.tpl[list[i % list.length]] || null;
}

const b64buf = (s) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
function loadScript() {
  if (window.RUBICON_WORLD) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'lib/world-assets.js';
    s.onload = () => res(!!window.RUBICON_WORLD);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
const parseGlb = (u8) => new Promise((res, rej) => new THREE.GLTFLoader().parse(u8.buffer, '', res, rej));
// 量化過的頂點屬性（KHR_mesh_quantization 的 normalized 整數）換成 Float32：之後的合併、射線、外框量測都照一般網格處理
function floatAttr(a) {
  const n = a.count,
    s = a.itemSize;
  const out = new Float32Array(n * s);
  const arr = a.isInterleavedBufferAttribute ? a.data.array : a.array;
  const div = !a.normalized
    ? 1
    : arr instanceof Int8Array
      ? 127
      : arr instanceof Uint8Array
        ? 255
        : arr instanceof Int16Array
          ? 32767
          : arr instanceof Uint16Array
            ? 65535
            : 1;
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < n; i++)
    for (let c = 0; c < s; c++) {
      const v = get[c].call(a, i);
      out[i * s + c] = div > 1 ? Math.max(-1, v / div) : v;
    }
  return new THREE.BufferAttribute(out, s);
}
// 一個素材＝扁平的 [{ geo, mat }]（頂點已套上節點的變換與 rot），box＝整體外框
function makeTemplate(gltf, rot) {
  const R = rot ? new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...rot)) : null;
  gltf.scene.updateMatrixWorld(true);
  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const src = o.geometry;
    const g = new THREE.BufferGeometry();
    for (const n of ['position', 'normal', 'uv', 'uv2'])
      if (src.attributes[n]) g.setAttribute(n, floatAttr(src.attributes[n]));
    if (src.index) g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.applyMatrix4(o.matrixWorld);
    if (R) g.applyMatrix4(R);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      markAuthoredTex(m.map);
      if (m.map) m.map.anisotropy = 8;
    }
    parts.push({ geo: g, mat: o.material });
  });
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.geo.boundingBox);
  return { parts, box };
}
// 開始載入（只做一次）；回傳 Promise<boolean>
export function loadWorldAssets() {
  if (WA.p) return WA.p;
  WA.p = (async () => {
    try {
      if (!THREE.GLTFLoader || !(await loadScript())) throw new Error('沒有 lib/world-assets.js');
      const rots = {};
      for (const c of Object.values(SLOTS)) if (c.rot) for (const s of c.src || []) rots[s] = c.rot;
      for (const [k, v] of Object.entries(window.RUBICON_WORLD)) {
        if (!k.endsWith('.glb')) continue;
        const name = k.slice(0, -4);
        WA.tpl[name] = makeTemplate(await parseGlb(b64buf(v)), rots[name]);
      }
      window.RUBICON_WORLD = null;
      WA.ready = true;
    } catch (e) {
      console.warn('地圖物件素材載入失敗，改用程式模型：', e && e.message);
      WA.failed = true;
    }
    return WA.ready;
  })();
  return WA.p;
}

// ---------- 材質 ----------
// 灰階貼圖（平均亮度正規化到 0.9）：乘上程式模型的顏色，岩石跟著主題的顏色走
const GRAY = new WeakMap();
function grayMap(t) {
  if (!t || !t.image) return t;
  if (GRAY.has(t)) return GRAY.get(t);
  const img = t.image;
  const w = img.width,
    h = img.height;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.drawImage(img, 0, 0);
  const d = c.getImageData(0, 0, w, h);
  const p = d.data;
  let sum = 0;
  for (let i = 0; i < p.length; i += 4) sum += p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
  const mean = sum / (p.length / 4) || 1;
  for (let i = 0; i < p.length; i += 4) {
    const l = p[i] * 0.3 + p[i + 1] * 0.59 + p[i + 2] * 0.11;
    const v = Math.max(0, Math.min(255, 230 + (l - mean) * 1.15));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  c.putImageData(d, 0, 0);
  const g = new THREE.CanvasTexture(cv);
  g.flipY = t.flipY;
  g.wrapS = t.wrapS;
  g.wrapT = t.wrapT;
  g.encoding = t.encoding;
  g.anisotropy = 8;
  markAuthoredTex(g);
  GRAY.set(t, g);
  return g;
}
const WHITE = new THREE.Color(1, 1, 1);
// 一個實例用的材質（遮擋淡出與受擊閃光要各自一份；貼圖共用）。color＝程式模型的顏色（tint 時）
export function assetMat(m, cfg, color) {
  const c = m.clone();
  if (cfg.ice) {
    c.map = null;
    c.roughnessMap = null;
    c.metalnessMap = null;
    c.aoMap = null;
    c.color.setHex(0xcfe7f4);
    c.roughness = 0.12;
    c.metalness = 0.05;
    c.emissive.setHex(0x0b1c26);
    c.envMapIntensity = 1.6;
  } else if (cfg.tint && color) {
    c.map = grayMap(m.map);
    c.color.copy(color);
    if (cfg.light) c.color.lerp(WHITE, cfg.light);
    c.color.multiplyScalar(1.1);
  }
  return c;
}
