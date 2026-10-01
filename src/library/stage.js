// 模型庫共用：渲染器、燈光、模型建立與量測、相機取景、動作預覽狀態
import { makeStudioEnv } from '../render/environment.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { checkGlb, checkSummary, glbScene, matsOf, parseGlb } from '../render/glb.js';
import { PALETTES } from '../render/materials.js';
import { measureBox, modelStats } from '../render/measure.js';
import { START_ASM } from '../data/parts.js';
import { PIECE_ORIGIN, buildMech, mechPieces } from '../render/mech-model.js';

let ENV = null;
export const studioEnv = () => ENV || (ENV = makeStudioEnv());

// 與遊戲相同的輸出設定（sRGB＋ACES、曝光 0.68）
export function makeRenderer(canvas, shadows) {
  const r = new THREE.WebGLRenderer({ canvas, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  r.outputEncoding = THREE.sRGBEncoding;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 0.68;
  if (shadows) {
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
  }
  return r;
}

// 車庫同款燈光：半球光＋主光（可切換成戰區主題）
export function addLights(scene) {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.7);
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.5);
  sun.position.set(5, 10, -6);
  scene.add(hemi, sun, sun.target);
  scene.environment = studioEnv();
  return { hemi, sun };
}
export const GARAGE_BG = 0x11151b;
export function applyLight(scene, lights, theme) {
  if (!theme) {
    scene.background = new THREE.Color(GARAGE_BG);
    lights.hemi.color.set(0xffffff);
    lights.hemi.groundColor.set(0x334455);
    lights.hemi.intensity = 0.7;
    lights.sun.color.set(0xfff4e0);
    return;
  }
  scene.background = new THREE.Color(theme.sky);
  lights.hemi.color.set(theme.sky);
  lights.hemi.groundColor.set(theme.amb);
  lights.hemi.intensity = 0.9;
  lights.sun.color.set(theme.sun);
}

// 釋放幾何與材質（貼圖由所有模型共用，不釋放；描邊材質共用也不釋放）
export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (m !== OUTLINE_MAT) m.dispose();
  });
}

// 建立模型並量測。回傳的 pivot 以模型底面中心為原點（放在地面上、可繞 Y 軸旋轉）
// 量測並置中：回傳的 pivot 以模型底面中心為原點（放在地面上、可繞 Y 軸旋轉）
function finalize(entry, built, extra = {}) {
  const { obj, scaleNode, scale } = built;
  // 原始尺寸：暫時把遊戲縮放設為 1
  scaleNode.scale.set(1, 1, 1);
  const sizeOrig = measureBox(obj, entry.measureFx).getSize(new THREE.Vector3());
  scaleNode.scale.copy(scale);
  const box = measureBox(obj, entry.measureFx);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  obj.position.set(-c.x, -box.min.y, -c.z);
  const pivot = new THREE.Group();
  pivot.add(obj);
  obj.traverse((o) => {
    if (o.isMesh && o.material !== OUTLINE_MAT) o.castShadow = true;
  });
  return {
    pivot,
    built,
    size,
    sizeOrig,
    scale: scale.clone(),
    stats: modelStats(obj, entry.measureFx),
    ...extra,
  };
}

// 程式模型
export function prepareModel(entry, palKey) {
  return finalize(entry, entry.build(palKey || entry.pal), { source: { kind: 'proc' } });
}

const ONE = () => new THREE.Vector3(1, 1, 1);
const palOf = (entry, palKey) => (entry.noPal ? null : PALETTES[palKey || entry.pal] || PALETTES.player);
// 程式模型在「GLB 製作尺寸」（×1）下的外框，作為規格檢查的參考
function referenceBox(entry, palKey) {
  const b = entry.build(palKey || entry.pal);
  b.scaleNode.scale.set(1, 1, 1);
  let box = measureBox(b.obj);
  if (box.isEmpty()) box = measureBox(b.obj, true);
  disposeObject(b.obj);
  return box;
}
export const originText = (entry) =>
  entry.piece ? PIECE_ORIGIN[entry.piece.kind] : '地面中心（模型底面中心）';

// GLB：解析、轉座標系、套配色，並對照程式模型做規格檢查
export async function prepareGlbModel(entry, palKey, src) {
  const gltf = await parseGlb(src.buf);
  const { root, info } = glbScene(gltf, palOf(entry, palKey));
  const checks = checkGlb({
    root,
    info,
    bytes: src.size,
    spec: entry.spec,
    ref: referenceBox(entry, palKey),
    origin: originText(entry),
  });
  if (src.fallback) checks.unshift({ lv: 'info', text: `沒有左側專用的 GLB，暫用右側的檔案（${src.name}）` });
  const obj = new THREE.Group();
  obj.add(root);
  const scale = entry.gameScale ? new THREE.Vector3().setScalar(entry.gameScale) : ONE();
  obj.scale.copy(scale);
  return finalize(
    entry,
    { obj, scaleNode: obj, scale, rig: null, piece: entry.piece },
    { source: src, checks, summary: checkSummary(checks), info },
  );
}

// 機甲組裝：每個區塊有 GLB 就用 GLB（瀏覽器暫存＞內建），沒有就用程式模型；連接點套用關節設定
// 回傳 { rig, glbSlots: 用了 GLB 的槽位, errors: 解析失敗的槽位 }
// useGlb(slot)：回傳 false 時該區塊強制用程式模型（組裝調整頁的來源切換）
export async function buildMechWithGlb(asm, pal, store, scale = 1, useGlb = null) {
  const roots = {},
    errors = [];
  for (const info of mechPieces(asm)) {
    const src = store.source(info.slot);
    if (src.kind !== 'glb' || (useGlb && !useGlb(info.slot))) continue;
    try {
      roots[info.slot] = glbScene(await parseGlb(src.buf), pal).root;
    } catch (e) {
      errors.push(`${info.slot}：${e.message || e}`);
    }
  }
  const extraMats = Object.values(roots).flatMap(matsOf);
  const rig = buildMech(asm, pal, scale, { piece: (info) => roots[info.slot] || null, extraMats });
  return { rig, glbSlots: Object.keys(roots), errors };
}
// 完整機甲：區塊組合結果
export async function prepareMech(entry, palKey, store) {
  const scale = entry.gameScale ? new THREE.Vector3().setScalar(entry.gameScale) : ONE();
  const { rig, glbSlots, errors } = await buildMechWithGlb(
    entry.asm,
    palOf(entry, palKey) || PALETTES.player,
    store,
  );
  rig.group.scale.copy(scale);
  return finalize(
    entry,
    { obj: rig.group, scaleNode: rig.group, scale, rig },
    { source: { kind: 'composite', glbSlots, errors } },
  );
}

export const prepareSource = (entry, palKey, src, store) =>
  entry.cat === 'mech'
    ? prepareMech(entry, palKey, store)
    : src && src.kind === 'glb'
      ? prepareGlbModel(entry, palKey, src)
      : Promise.resolve(prepareModel(entry, palKey));

// 組合預覽：玩家初始機（START_ASM）換上此區塊所屬的零件，所有區塊依各自來源（GLB／程式模型）組裝
export const COMPOSE_CATS = ['head', 'core', 'arms', 'legs', 'booster', 'weapon', 'back'];
function composeAsm(entry) {
  const k = entry.piece && entry.piece.key;
  if (entry.cat === 'weapon') return { ...START_ASM, [k === 'l' ? 'larm' : 'rarm']: entry.part };
  if (entry.cat === 'back') return { ...START_ASM, [k === 'l' ? 'lback' : 'rback']: entry.part };
  return { ...START_ASM, [entry.cat]: entry.part };
}
export async function prepareComposite(entry, palKey, store) {
  const { rig, glbSlots, errors } = await buildMechWithGlb(
    composeAsm(entry),
    palOf(entry, palKey) || PALETTES.player,
    store,
  );
  const notes = errors.map((t) => 'GLB 解析失敗：' + t);
  return finalize(
    entry,
    { obj: rig.group, scaleNode: rig.group, scale: ONE(), rig },
    { source: { kind: 'composite', glbSlots, errors }, notes },
  );
}

// 縮放倍率文字：等比例「×2.6」；武器掛點等非等比例「×0.72／0.72／0.5」
export function scaleText(s) {
  const r = (v) => Math.round(v * 100) / 100;
  if (Math.abs(s.x - s.y) < 1e-6 && Math.abs(s.y - s.z) < 1e-6)
    return Math.abs(s.x - 1) < 1e-6 ? '' : `×${r(s.x)}`;
  return `×${r(s.x)}／${r(s.y)}／${r(s.z)}`;
}

// 相機取景：從模型正面（−Z）偏右上方看過去
export function fitCamera(cam, size, aspect, k = 1.25) {
  const radius = Math.max(0.2, size.length() / 2);
  const fov = (cam.fov * Math.PI) / 180;
  const fitH = radius / Math.sin(fov / 2);
  const fitW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
  const dist = Math.max(fitH, fitW) * k;
  const dir = new THREE.Vector3(0.75, 0.45, -1).normalize();
  const target = new THREE.Vector3(0, size.y / 2, 0);
  cam.position.copy(target).addScaledVector(dir, dist);
  cam.near = dist / 100;
  cam.far = dist * 20 + 50;
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return target;
}

// ---------- 動作預覽：產生 animateMech 需要的狀態 ----------
export const ANIMS = [
  ['garage', '展示姿勢'],
  ['idle', '待機'],
  ['walk', '行走'],
  ['strafe', '側移'],
  ['jump', '跳躍／懸停'],
  ['qb', 'QB 衝刺'],
  ['shoot', '射擊'],
  ['melee', '近戰'],
  ['stagger', '失衡'],
];
export function animState(mode, t) {
  const st = {
    t,
    grounded: true,
    moving: false,
    hover: false,
    boost: false,
    qb: false,
    aimPitch: 0,
    recoil: { l: 0, r: 0 },
    swing: { l: 0, r: 0 },
    knock: 0,
    knockSide: 1,
    strafe: 0,
    fwd: 0,
    melee: null,
    turn: 0,
    landT: 9,
    aimRel: 0,
    leanZ: 0,
    leanX: 0,
  };
  switch (mode) {
    case 'garage':
      st.pose = 'garage';
      break;
    case 'walk':
      st.moving = true;
      st.fwd = 1;
      break;
    case 'strafe':
      st.moving = true;
      st.strafe = 1;
      break;
    case 'jump':
      st.grounded = false;
      st.hover = true;
      break;
    case 'qb':
      st.moving = true;
      st.fwd = 1;
      st.boost = true;
      st.qb = (t * 1.5) % 1 < 0.3;
      break;
    case 'shoot': {
      const p = (t * 3) % 1;
      st.recoil = { r: p < 0.25 ? 0.6 * (1 - p * 4) : 0, l: 0 };
      break;
    }
    case 'melee': {
      const ph = (t * 1.2) % 1;
      st.melee = { kind: 'slash', ph, mirror: false, side: 1 };
      st.swing = { l: -0.3, r: 1 };
      break;
    }
    case 'stagger':
      st.knock = 1;
      break;
  }
  return st;
}
