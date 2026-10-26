// 機甲庫的零件縮圖（docs/garage-ui.md 第二期）：離屏的小場景，buildMech 換上那個零件、只留那個零件的區塊，
// 拍成 128×128 的透明 PNG（data URL）。依「部位＋零件＋模型來源＋配色」快取；發電機、火控、消耗品、空的武器槽沒有外觀
import { START_ASM } from '../data/parts.js';
import { isOutline } from './geometry.js';
import { buildMech } from './mech-model.js';

const SIZE = 128,
  RS = 256; // 拍 256 再縮成 128（離屏的 render target 沒有反鋸齒）
// 部位 → 區塊的分類與左右
const PIECE = {
  head: ['head'],
  core: ['core'],
  arms: ['arms'],
  legs: ['legs'],
  booster: ['booster'],
  rarm: ['weapon', 'r'],
  larm: ['weapon', 'l'],
  rback: ['back', 'r'],
  lback: ['back', 'l'],
};
let S = null;
const cache = new Map(); // key → data URL（'' ＝沒有外觀）
const srcIds = new WeakMap();
let srcN = 0;

// 這個部位有沒有縮圖可拍
export function hasThumb(slot, pid) {
  return !!PIECE[slot] && !/_none$/.test(pid);
}
export function thumbKey(slot, pid, palKey, source) {
  let sid = 0;
  if (source) {
    if (!srcIds.has(source)) srcIds.set(source, ++srcN);
    sid = srcIds.get(source);
  }
  return `${slot}|${pid}|${palKey}|${sid}`;
}
export function thumbCached(key) {
  return cache.get(key);
}
function setup(env) {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x56606c, 2.4));
  const d = new THREE.DirectionalLight(0xfff4e0, 2.8);
  d.position.set(3, 6, 5);
  scene.add(d);
  const r = new THREE.DirectionalLight(0x9fd8ff, 1.4);
  r.position.set(-4, 2, -3);
  scene.add(r);
  if (env) scene.environment = env;
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  const rt = new THREE.WebGLRenderTarget(RS, RS);
  rt.texture.encoding = THREE.sRGBEncoding; // 輸出 sRGB（直接當圖片用）
  const big = document.createElement('canvas');
  big.width = big.height = RS;
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  return { scene, cam, rt, big, cv, buf: new Uint8Array(RS * RS * 4) };
}
// 拍一張：asm＝目前的組裝（只換這個部位），回傳 data URL（沒有外觀時 ''）
export function renderThumb(renderer, { slot, pid, asm, pal, palKey, source, env }) {
  const key = thumbKey(slot, pid, palKey, source);
  if (cache.has(key)) return cache.get(key);
  const [cat, side] = PIECE[slot] || [];
  if (!cat) {
    cache.set(key, '');
    return '';
  }
  if (!S) S = setup(env);
  let m;
  try {
    m = buildMech({ ...START_ASM, ...asm, [slot]: pid }, pal, 1, { source, noGround: true });
  } catch {
    cache.set(key, '');
    return '';
  }
  const keep = [];
  for (const [k, o] of Object.entries(m.pieces)) {
    const [c, id, s] = k.split('/');
    const on = c === cat && id === pid && (!side || s === side);
    o.visible = on;
    if (on) keep.push(o);
  }
  if (!keep.length) {
    cache.set(key, '');
    return '';
  }
  m.group.rotation.y = Math.PI;
  m.group.updateMatrixWorld(true);
  // 外框（描邊外殼不算）
  const box = new THREE.Box3();
  for (const o of keep)
    o.traverse((x) => {
      if (x.isMesh && !isOutline(x.material) && x.visible !== false) box.expandByObject(x);
    });
  if (box.isEmpty()) {
    cache.set(key, '');
    return '';
  }
  const c = box.getCenter(new THREE.Vector3());
  const rad = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = new THREE.Vector3(0.62, 0.38, 1).normalize();
  const dist = (rad / Math.sin(THREE.MathUtils.degToRad(S.cam.fov / 2))) * 1.02;
  S.cam.position.copy(c).addScaledVector(dir, dist);
  S.cam.near = Math.max(0.01, dist - rad * 2);
  S.cam.far = dist + rad * 2;
  S.cam.lookAt(c);
  S.cam.updateProjectionMatrix();
  S.scene.add(m.group);
  const prevRt = renderer.getRenderTarget();
  const prevCol = renderer.getClearColor(new THREE.Color());
  const prevA = renderer.getClearAlpha();
  const prevShadow = renderer.shadowMap.enabled;
  renderer.shadowMap.enabled = false;
  renderer.setRenderTarget(S.rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, true, true);
  renderer.render(S.scene, S.cam);
  renderer.readRenderTargetPixels(S.rt, 0, 0, RS, RS, S.buf);
  renderer.setRenderTarget(prevRt);
  renderer.setClearColor(prevCol, prevA);
  renderer.shadowMap.enabled = prevShadow;
  S.scene.remove(m.group);
  // 讀回的像素是由下往上：翻過來畫到畫布
  const bx = S.big.getContext('2d');
  const img = bx.createImageData(RS, RS);
  for (let y = 0; y < RS; y++)
    img.data.set(S.buf.subarray((RS - 1 - y) * RS * 4, (RS - y) * RS * 4), y * RS * 4);
  bx.putImageData(img, 0, 0);
  const ctx = S.cv.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(S.big, 0, 0, SIZE, SIZE);
  const url = S.cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
