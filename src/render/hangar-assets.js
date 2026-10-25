// 機甲庫格納庫的外部素材（docs/garage-hangar.md）：Poly Haven 的 CC0 道具與 PBR 貼圖、Quaternius 的 CC0 人物（骨架動畫）。
// 原始檔在 src/assets/hangar/（來源與授權見 CREDITS.txt），建置成 dist/lib/hangar-assets.js（window.RUBICON_HANGAR＝{ 檔名: base64 }），
// 不內嵌在遊戲的 HTML 裡：第一次需要時以 <script> 載入、解析成範本。沒載到時格納庫照舊用程式模型。
export const HA = { ready: false, failed: false, glb: {}, tex: {}, p: null, listeners: [] };
if (/[?&]test\b/.test(location.search)) window.__HA = HA; // 冒煙測試等素材載入完

const b64buf = (s) => {
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
};
function loadScript() {
  if (window.RUBICON_HANGAR) return Promise.resolve(true);
  return new Promise((res) => {
    const s = document.createElement('script');
    s.src = 'lib/hangar-assets.js';
    s.onload = () => res(!!window.RUBICON_HANGAR);
    s.onerror = () => res(false);
    document.head.appendChild(s);
  });
}
function parseGlb(u8) {
  return new Promise((res, rej) => new THREE.GLTFLoader().parse(u8.buffer, '', res, rej));
}
function loadImage(u8, type) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(new Blob([u8], { type }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      res(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      rej(e);
    };
    img.src = url;
  });
}
// 開始載入（只做一次）；回傳 Promise<boolean>
export function loadHangarAssets() {
  if (HA.p) return HA.p;
  HA.p = (async () => {
    try {
      if (!THREE.GLTFLoader || !(await loadScript())) throw new Error('沒有 lib/hangar-assets.js');
      const D = window.RUBICON_HANGAR;
      for (const [k, v] of Object.entries(D)) {
        const u8 = b64buf(v);
        if (k.endsWith('.glb')) {
          const g = await parseGlb(u8);
          g.scene.updateMatrixWorld(true);
          g.scene.traverse((o) => {
            if (o.isMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });
          HA.glb[k.slice(0, -4)] = g;
        } else if (k.startsWith('tex/')) {
          const img = await loadImage(u8, 'image/webp');
          HA.tex[k.slice(4).replace(/\.webp$/, '')] = img;
        }
      }
      window.RUBICON_HANGAR = null; // base64 字串不再需要
      HA.ready = true;
    } catch (e) {
      console.warn('格納庫素材載入失敗，改用程式模型：', e && e.message);
      HA.failed = true;
    }
    for (const f of HA.listeners.splice(0)) f(HA.ready);
    return HA.ready;
  })();
  return HA.p;
}

// ---------- 貼圖 ----------
const TEXC = {};
// 一組 PBR 貼圖（name_d 顏色、name_n 法線、name_r＝AO／粗糙度／金屬感）；同名共用同一個貼圖物件
function texOf(key, srgb) {
  if (TEXC[key]) return TEXC[key];
  const img = HA.tex[key];
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  t.haShared = true; // 共用的貼圖：disposeHangar 不釋放
  t.needsUpdate = true;
  return (TEXC[key] = t);
}
// PBR 材質：tile＝貼圖一格幾公尺（靜態合併時依世界座標投影 UV，見 render/hangar.js 的 boxUV）
export function pbrMat(name, color = 0xffffff, o = {}) {
  const map = texOf(name + '_d', true);
  if (!map) return null;
  const m = new THREE.MeshStandardMaterial({
    color,
    map,
    normalMap: texOf(name + '_n'),
    roughnessMap: texOf(name + '_r'),
    metalnessMap: o.metal != null ? texOf(name + '_r') : null,
    roughness: o.rough != null ? o.rough : 1,
    metalness: o.metal != null ? o.metal : 0,
    side: o.side || THREE.FrontSide,
  });
  m.normalScale.set(o.nk || 1, -(o.nk || 1));
  m.userData.tile = o.tile || 2;
  return m;
}

// ---------- 道具 ----------
// 道具的複本（node＝只取這個名稱的節點，以它在原檔的世界座標放在原點附近）
export function haProp(name, node) {
  const g = HA.glb[name];
  if (!g) return null;
  let src = g.scene;
  if (node) {
    src = g.scene.getObjectByName(node);
    if (!src) return null;
    const o = src.clone(true);
    const wrap = new THREE.Group();
    o.applyMatrix4(src.parent.matrixWorld);
    // 原點移到底面中心
    const b = new THREE.Box3().setFromObject(o);
    const c = b.getCenter(new THREE.Vector3());
    o.position.x -= c.x;
    o.position.z -= c.z;
    o.position.y -= b.min.y;
    wrap.add(o);
    return wrap;
  }
  const o = src.clone(true);
  const wrap = new THREE.Group();
  const b = new THREE.Box3().setFromObject(o);
  const c = b.getCenter(new THREE.Vector3());
  o.position.set(-c.x, -b.min.y, -c.z);
  wrap.add(o);
  return wrap;
}
// 依高度把網格切成兩半（天車的捲揚機：吊鉤另外做成會升降的零件）。回傳 { keep, cut } 兩個新網格（世界座標）
// 頂點屬性轉成 Float32（量化過的 normalized 整數要自己換算；r128 的 getX 不會）
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
export function splitMeshY(mesh, keepAbove, cutBelow) {
  mesh.updateWorldMatrix(true, false);
  const src = mesh.geometry;
  const g0 = new THREE.BufferGeometry();
  for (const [n, a] of Object.entries(src.attributes))
    if (n === 'position' || n === 'normal' || n === 'uv') g0.setAttribute(n, floatAttr(a));
  if (src.index) g0.setIndex(src.index);
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.applyMatrix4(mesh.matrixWorld);
  const pos = g.attributes.position;
  const names = Object.keys(g.attributes);
  const pick = (test) => {
    const out = {};
    for (const n of names) out[n] = [];
    for (let i = 0; i < pos.count; i += 3) {
      const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
      if (!test(ys)) continue;
      for (const n of names) {
        const a = g.attributes[n];
        for (let j = 0; j < 3; j++)
          for (let c = 0; c < a.itemSize; c++) out[n].push(a.array[(i + j) * a.itemSize + c]);
      }
    }
    const ng = new THREE.BufferGeometry();
    for (const n of names) {
      const a = g.attributes[n];
      ng.setAttribute(n, new THREE.Float32BufferAttribute(out[n], a.itemSize));
    }
    return new THREE.Mesh(ng, mesh.material);
  };
  return {
    keep: pick((ys) => Math.min(...ys) > keepAbove),
    cut: pick((ys) => Math.max(...ys) < cutBelow),
  };
}

// ---------- 人物 ----------
// 人物的複本（SkeletonUtils 複製骨架）＋動作；回傳 { g, mixer, act(name), hand: {l, r} }
export function haChar(name) {
  const src = HA.glb[name];
  if (!src || !THREE.SkeletonUtils) return null;
  const o = THREE.SkeletonUtils.clone(src.scene);
  o.traverse((c) => {
    if (c.isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
      c.frustumCulled = false;
    }
  });
  const g = new THREE.Group();
  g.add(o);
  const mixer = new THREE.AnimationMixer(o);
  const acts = {};
  for (const clip of src.animations) acts[clip.name.split('|').pop()] = mixer.clipAction(clip);
  let cur = null;
  const act = (n, fade = 0.25) => {
    const a = acts[n] || acts.Idle;
    if (!a || a === cur) return;
    a.reset().play();
    if (cur) cur.crossFadeTo(a, fade, false);
    cur = a;
  };
  return {
    g,
    mixer,
    acts,
    act,
    bone: (n) => o.getObjectByName(n),
  };
}
