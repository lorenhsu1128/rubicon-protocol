// GLB 模型：解析、轉成遊戲座標系、依材質名稱套用陣營配色、補墨線描邊、規格檢查。
// 機甲的 GLB 是一塊塊「區塊」（原點＝旋轉中心），由 buildMech 依連接點組裝。規格說明見 docs/glb-spec.md。
import { OUTLINE_MAT } from './geometry.js';
import { palColor } from './materials.js';
import { isFxMaterial, measureBox, modelStats } from './measure.js';

// ---------- 規格 ----------
// 依材質名稱換色的槽位（名稱不分大小寫，可帶 Blender 的 .001 等後綴）
export const PALETTE_SLOTS = [
  'main',
  'main2',
  'main3',
  'sub',
  'acc',
  'joint',
  'visor',
  'glow',
  'gun',
  'grey',
];
// 預算：三角面、繪製次數（含自動補上的描邊，約為網格數 ×2）、最大貼圖邊長（px）、檔案大小（MB）
// part：頭、核心、背包、襠部／主體；piece：四肢的每一節（上臂、前臂、手、大腿、小腿、腳掌）
export const GLB_BUDGET = {
  part: { tris: 3000, draws: 40, tex: 1024, mb: 2 },
  piece: { tris: 1500, draws: 20, tex: 1024, mb: 1 },
  weapon: { tris: 2000, draws: 30, tex: 1024, mb: 1.5 },
  mech: { tris: 25000, draws: 200, tex: 1024, mb: 4 },
  'mech-boss': { tris: 40000, draws: 240, tex: 2048, mb: 8 },
  vehicle: { tris: 8000, draws: 100, tex: 1024, mb: 3 },
  'vehicle-boss': { tris: 40000, draws: 160, tex: 2048, mb: 8 },
  prop: { tris: 2000, draws: 30, tex: 1024, mb: 1.5 },
  small: { tris: 500, draws: 8, tex: 512, mb: 0.5 },
};
export const budgetFor = (spec) =>
  GLB_BUDGET[spec] ||
  GLB_BUDGET[spec.split('-')[0]] ||
  (spec.startsWith('part') ? GLB_BUDGET.part : GLB_BUDGET.prop);
// ---------- 解析 ----------
// Draco 網格壓縮（KHR_draco_mesh_compression，例如 glb-shrink 的輸出）：解碼器從 CDN 載入（需要網路），全頁共用一個
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/libs/draco/gltf/';
let draco = null;
function dracoLoader() {
  if (!draco && THREE.DRACOLoader) {
    draco = new THREE.DRACOLoader();
    draco.setDecoderPath(DRACO_PATH);
  }
  return draco;
}
export function parseGlb(buf) {
  return new Promise((resolve, reject) => {
    if (!THREE.GLTFLoader) return reject(new Error('GLTFLoader 未載入'));
    const data =
      buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const loader = new THREE.GLTFLoader();
    const d = dracoLoader();
    if (d) loader.setDRACOLoader(d);
    loader.parse(data, '', resolve, (e) => reject(e instanceof Error ? e : new Error(String(e))));
  });
}

// glTF 正面為 +Z，遊戲為 −Z：把每個節點的座標系繞 Y 軸轉 180°（位置、旋轉、網格頂點），
// 而不是只轉根節點——這樣關節的區域旋轉方向才與程式模型一致（animateMech 直接設定關節角度）
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const FLIP_M = new THREE.Matrix4().makeRotationY(Math.PI);
// 這個轉換轉兩次會回到原狀，所以匯出 GLB 範本時也用它把遊戲座標轉回 glTF 座標
export function flipToGame(root) {
  const geos = new Set();
  root.traverse((o) => {
    o.position.set(-o.position.x, o.position.y, -o.position.z);
    o.quaternion.premultiply(FLIP).multiply(FLIP.clone().invert());
    if (o.isMesh && !geos.has(o.geometry)) {
      geos.add(o.geometry);
      o.geometry.applyMatrix4(FLIP_M);
    }
  });
}

export const materialSlot = (name) => slotOf(name);
const slotOf = (name) => {
  const n = String(name || '')
    .toLowerCase()
    .replace(/\.\d+$/, '');
  return PALETTE_SLOTS.includes(n) ? n : null;
};

// 依材質名稱套用配色：回傳換色後的複製材質；名稱不在換色槽位（或沒有配色）時回傳原材質
export function tintMaterial(m, pal) {
  const slot = slotOf(m.name);
  const col = slot && pal ? palColor(pal, slot) : undefined;
  if (col === undefined) return m;
  const c = m.clone();
  c.color.set(col);
  if ((slot === 'visor' || slot === 'glow') && c.emissive) {
    c.emissive.set(col);
    c.emissiveIntensity = Math.max(c.emissiveIntensity || 0, 1.2);
  }
  return c;
}

// 平滑法線（外推描邊用），寫入 onormal 屬性
function addOutlineNormals(g) {
  if (g.attributes.onormal) return;
  if (!g.attributes.normal) g.computeVertexNormals();
  const p = g.attributes.position,
    n = g.attributes.normal;
  const key = (i) => p.getX(i).toFixed(3) + ',' + p.getY(i).toFixed(3) + ',' + p.getZ(i).toFixed(3);
  const acc = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const e = acc.get(k) || [0, 0, 0];
    e[0] += n.getX(i);
    e[1] += n.getY(i);
    e[2] += n.getZ(i);
    acc.set(k, e);
  }
  const sm = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const e = acc.get(key(i));
    const L = Math.hypot(e[0], e[1], e[2]) || 1;
    sm[i * 3] = e[0] / L;
    sm[i * 3 + 1] = e[1] / L;
    sm[i * 3 + 2] = e[2] / L;
  }
  g.setAttribute('onormal', new THREE.BufferAttribute(sm, 3));
}

// 解析後的 glTF → 可放進遊戲的根節點：轉座標系、套配色、補描邊、開陰影。回傳 { root, info }
export function glbScene(gltf, pal) {
  const root = gltf.scene;
  flipToGame(root);
  const info = {
    tinted: new Set(),
    kept: new Set(),
    skinned: 0,
    unlit: 0,
    materials: 0,
    animations: (gltf.animations || []).length,
  };
  const meshes = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh) info.skinned++;
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    const list = Array.isArray(o.material) ? o.material : [o.material];
    const out = list.map((m) => {
      info.materials++;
      if (m.type === 'MeshBasicMaterial') info.unlit++;
      const c = tintMaterial(m, pal);
      if (c === m) info.kept.add(m.name || '（未命名）');
      else info.tinted.add(slotOf(m.name));
      return c;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    o.castShadow = true;
    o.receiveShadow = true;
    if (!o.isSkinnedMesh && !isFxMaterial(o.material)) {
      addOutlineNormals(o.geometry);
      const ol = new THREE.Mesh(o.geometry, OUTLINE_MAT);
      ol.castShadow = false;
      o.add(ol);
    }
  }
  return { root, info };
}

// 會受擊閃光的材質（有 emissive 的）：組裝機甲時加進 rig.mats
export const matsOf = (root) => {
  const s = new Set();
  root.traverse((o) => {
    if (!o.isMesh || o.material === OUTLINE_MAT) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m.emissive) {
        if (!m.userData.emis0) m.userData.emis0 = m.emissive.clone(); // 受擊閃光後還原
        s.add(m);
      }
  });
  return [...s];
};

// ---------- 規格檢查 ----------
// ref：同槽位程式模型在「製作尺寸」下的外框（Box3，原點與 GLB 相同的座標系）
// 回傳 [{ lv: 'error'|'warn'|'ok'|'info', text }]
// origin：原點應該在哪裡的說明（例：「手肘轉軸」「地面中心」）
export function checkGlb({ root, info, bytes, spec, ref, origin }) {
  const out = [];
  const add = (lv, text) => out.push({ lv, text });
  const B = budgetFor(spec);
  const st = modelStats(root);
  const box = measureBox(root);
  const size = box.getSize(new THREE.Vector3());
  const mb = bytes / 1048576;
  add(mb <= B.mb ? 'ok' : 'warn', `檔案大小 ${mb.toFixed(2)} MB（建議 ≤ ${B.mb} MB）`);
  add(
    st.tris <= B.tris ? 'ok' : st.tris <= B.tris * 1.5 ? 'warn' : 'error',
    `三角面 ${st.tris.toLocaleString()}（建議 ≤ ${B.tris.toLocaleString()}）`,
  );
  add(
    st.draws <= B.draws ? 'ok' : 'warn',
    `繪製次數 ${st.draws}（含描邊；建議 ≤ ${B.draws}，可合併同材質網格）`,
  );
  if (st.textures)
    add(
      st.maxTex <= B.tex ? 'ok' : 'warn',
      `貼圖 ${st.textures} 張，最大 ${st.maxTex}px（建議 ≤ ${B.tex}px）`,
    );
  else add('info', '沒有貼圖（只用材質顏色）');
  // 貼花等少量無光照材質可接受；主體大多是無光照時受擊閃光與光線都不會作用
  if (info.unlit)
    add(
      info.unlit > info.materials / 2 ? 'warn' : 'info',
      info.unlit > info.materials / 2
        ? `${info.unlit}／${info.materials} 個材質是無光照（unlit），受擊閃光與光線不會作用；主體請用 PBR 材質`
        : `${info.unlit} 個無光照材質（貼花、發光面等可接受）`,
    );
  if (info.skinned)
    add('error', `含 ${info.skinned} 個蒙皮網格：遊戲不使用骨架蒙皮，每個會動的部位請拆成獨立區塊`);
  if (info.animations) add('info', `內含 ${info.animations} 段動畫：遊戲不使用，動作由程式驅動`);
  if (info.tinted.size) add('ok', `依配色換色的材質：${[...info.tinted].join('、')}`);
  else add('info', '沒有依規則命名的換色材質（main／sub／acc…），將保留原色、不隨陣營改變');
  if (!(size.x > 0 && size.y > 0 && size.z > 0)) add('error', '模型沒有可見的網格');
  if (ref && size.x > 0) {
    const rs = ref.getSize(new THREE.Vector3());
    const diffs = ['x', 'y', 'z'].map((k) => (rs[k] > 0.05 ? Math.abs(size[k] - rs[k]) / rs[k] : 0));
    const worst = Math.max(...diffs);
    const txt = `尺寸 ${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m，與程式模型（${rs.x.toFixed(2)} × ${rs.y.toFixed(2)} × ${rs.z.toFixed(2)} m）最大相差 ${Math.round(worst * 100)}%`;
    add(worst <= 0.15 ? 'ok' : worst <= 0.5 ? 'warn' : 'error', txt);
    // 寬深對調比較接近 → 可能轉了 90°
    const swapped = Math.max(
      rs.z > 0.05 ? Math.abs(size.x - rs.z) / rs.z : 0,
      rs.x > 0.05 ? Math.abs(size.z - rs.x) / rs.x : 0,
    );
    if (worst > 0.25 && swapped < worst * 0.5) add('warn', '寬與深對調後才接近程式模型：模型可能轉了 90°');
    const off = box.getCenter(new THREE.Vector3()).sub(ref.getCenter(new THREE.Vector3()));
    const span = Math.max(rs.x, rs.y, rs.z, 0.1);
    add(
      off.length() / span <= 0.2 ? 'ok' : 'warn',
      off.length() / span <= 0.2
        ? '原點位置與程式模型一致'
        : `外框中心與程式模型差 ${off.length().toFixed(2)} m：原點可能放錯位置${origin ? '（應在' + origin + '）' : ''}`,
    );
    if (Math.abs(box.min.y - ref.min.y) > Math.max(0.15, rs.y * 0.08))
      add(
        'warn',
        `底部高度 y = ${box.min.y.toFixed(2)} m，程式模型為 ${ref.min.y.toFixed(2)} m：原點高度可能不對${origin ? '（原點應在' + origin + '）' : ''}`,
      );
  }
  add('info', '正面朝向請在「並排對照」中確認（GLB 應以 +Z 為正面匯出）');
  return out;
}
export const checkSummary = (list) => ({
  errors: list.filter((c) => c.lv === 'error').length,
  warns: list.filter((c) => c.lv === 'warn').length,
});
