// 主題模組共用的小工具（world/themes/*.js）：網格建造工具從 prop-models.js 轉出，另加貼圖產生器。
// 主題模組不可 import world.js（world.js 會 import 主題模組）；需要 World 時一律用參數 w。
export { box, cyl, fadeMat, mat, propGlb, registerFeatureStyle } from '../prop-models.js';

// 簡單的 32 位元雜湊亂數（給貼圖用：同一個 seed 每次畫出一樣的圖）
export function hashRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// 窗格貼圖：底色＋規則排列的窗；lit 為點亮窗的比例與顏色（地下都市用發光窗）；結果依參數快取
const TEX = new Map();
export function windowTexture({
  base = '#7d807c',
  win = '#2a2f33',
  lit = 0,
  litColor = '#ff5040',
  broken = 0.12,
  seed = 1,
} = {}) {
  const key = [base, win, lit, litColor, broken, seed].join('|');
  if (TEX.has(key)) return TEX.get(key);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.fillStyle = base;
  c.fillRect(0, 0, 128, 128);
  const r = hashRng(seed * 7919 + 13);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      const q = r();
      c.fillStyle = q < lit ? litColor : q < lit + broken ? '#9aa0a0' : win;
      c.fillRect(x * 32 + 6, y * 32 + 7, 20, 16);
    }
  // 髒污與水漬
  c.globalAlpha = 0.18;
  c.fillStyle = '#000';
  for (let i = 0; i < 6; i++) c.fillRect(r() * 128, 0, 2 + r() * 5, 128);
  c.globalAlpha = 1;
  const t = new THREE.CanvasTexture(cv);
  t.encoding = THREE.sRGBEncoding;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  TEX.set(key, t);
  return t;
}
// 貼窗格的大樓材質（每棟一份，依尺寸設定重複次數；transparent 供鏡頭遮擋半透明）
export function windowMat(opts, w, h, emissive) {
  const t = windowTexture(opts).clone();
  t.needsUpdate = true;
  t.repeat.set(Math.max(1, Math.round(w / 6)), Math.max(1, Math.round(h / 4)));
  const m = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: t,
    roughness: 0.85,
    metalness: 0.1,
    flatShading: true,
    transparent: true,
  });
  if (emissive) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveMap = t;
  }
  return m;
}
