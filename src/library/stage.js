// 模型庫共用：渲染器、燈光、模型建立與量測、相機取景、動作預覽狀態
import { makeStudioEnv } from '../render/environment.js';
import { OUTLINE_MAT } from '../render/geometry.js';
import { measureBox, modelStats } from '../render/measure.js';

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
export function prepareModel(entry, palKey) {
  const built = entry.build(palKey || entry.pal);
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
  return { pivot, built, size, sizeOrig, scale: scale.clone(), stats: modelStats(obj, entry.measureFx) };
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
