// 自訂關卡的可擺放物件：結構（尺寸可調的方塊、牆、坡道、橋面板、支柱、貨櫃、高柱）＋模型庫目錄裡的
// 所有地圖物件（render/model-catalog.js 的 prop/…，含各主題物件、變體物件、地標）。
// 每個物件包成一個「底面中心」為原點的群組；碰撞由外框產生（方塊／圓柱／無），可破壞時登記成地圖物件。
import { MODEL_CATALOG } from '../render/model-catalog.js';
import { isOutline } from '../render/geometry.js';
import { LANDMARKS } from '../world/landmarks.js';
import {
  box,
  buildContainer,
  buildDeck,
  buildGridPillar,
  buildPillar,
  buildThemeDeck,
  buildThemePillar,
  buildThemePlatform,
  buildThemeRamp,
  buildThemeWall,
  deckMats,
  featureStyles,
  mat,
} from '../world/prop-models.js';
import { THEMES } from '../world/world.js';
import { MS } from '../core/scale.js';

// 結構：dims＝預設尺寸 [寬 X, 高 Y, 深 Z]（坡道是 [長, 高低差, 寬]），s 是倍率。
// 三倍高改版：給機甲用的結構照機甲尺度（×MS），貨櫃是現實的 40 呎貨櫃
export const STRUCTS = [
  { id: 'ed/block', name: '方塊／台座', dims: [10 * MS, 4 * MS, 10 * MS], note: '可以站上去' },
  { id: 'ed/wall', name: '牆', dims: [10 * MS, 5 * MS, 0.8 * MS], note: '掩體' },
  {
    id: 'ed/ramp',
    name: '坡道',
    dims: [12 * MS, 5 * MS, 6 * MS],
    note: '往 +X 升高（旋轉 90° 換方向）',
    ramp: true,
  },
  { id: 'ed/deck', name: '橋面板', dims: [8 * MS, 0.7 * MS, 20 * MS], note: '可以從下方通過', deck: true },
  { id: 'ed/pillar', name: '支柱', dims: [1.2 * MS, 6 * MS, 1.2 * MS], col: 'circle' },
  { id: 'ed/container', name: '貨櫃（40 呎）', dims: [12.19, 2.59, 2.44], hp: 900 },
  { id: 'ed/tower', name: '方格高柱', dims: [5 * MS, 13 * MS, 5 * MS] },
];
const EXCLUDE = new Set(['prop/road', 'prop/rail', 'prop/platform', 'prop/deck', 'prop/pillar']);

let LIST = null;
// 全部可擺放的物件：{ id, name, cat 分類, note, struct?, build }
export function placeList() {
  if (LIST) return LIST;
  const byTheme = {};
  for (const [tk, T] of Object.entries(THEMES)) {
    for (const c of T.catalog || []) byTheme['prop/' + c[0]] = T.name;
    if (T.props)
      for (const k of ['deck', 'pillar', 'wall', 'platform', 'ramp', 'tunnel'])
        byTheme[`prop/${T.props}_${k}`] = T.name;
    for (const k in LANDMARKS[tk] || {}) byTheme[`prop/lm_${tk}_${k}`] = '地標・' + T.name;
  }
  for (const st of featureStyles()) {
    const T = Object.values(THEMES).find((x) => x.props === st);
    for (const k of ['deck', 'pillar', 'wall', 'platform', 'ramp', 'tunnel'])
      byTheme[`prop/${st}_${k}`] = byTheme[`prop/${st}_${k}`] || (T ? T.name : st);
  }
  LIST = STRUCTS.map((s) => ({ ...s, cat: '結構', struct: true }));
  for (const e of MODEL_CATALOG) {
    if (e.cat !== 'prop' || EXCLUDE.has(e.id)) continue;
    LIST.push({
      id: e.id,
      name: e.name,
      cat: byTheme[e.id] || '一般',
      note: e.note || '',
      build: () => e.build().obj,
    });
  }
  return LIST;
}
const BY_ID = new Map();
export function placeById(id) {
  if (!BY_ID.size) for (const d of placeList()) BY_ID.set(d.id, d);
  return BY_ID.get(id) || null;
}
export const placeIds = () => new Set(placeList().map((d) => d.id));

// 主題的結構樣式（荒野、沙丘、冰原與新主題有自己的高台、牆、坡道、橋面板）
function styleOf(T) {
  return T && T.props && featureStyles().includes(T.props) ? T.props : null;
}
// 建立物件的群組：回傳 { group（原點＝底面中心）, bounds（區域座標的外框，已含倍率）, ramp?, deck? }
export function buildPlaced(def, p, T) {
  const s = p.s || [1, 1, 1];
  const inner = new THREE.Group();
  let ramp = null;
  if (def.struct) {
    const [w, h, d] = def.dims.map((v, i) => v * s[i]);
    const st = styleOf(T);
    const rockC = (T && T.rock) || 0x6a6f77;
    let o;
    if (def.id === 'ed/block') {
      o = st ? buildThemePlatform(st, w, h, d) : box(w, h, d, mat(rockC, { roughness: 0.9 }), 0, h / 2, 0);
    } else if (def.id === 'ed/wall') {
      if (st) {
        o = buildThemeWall(st, w, h, d);
        o.position.y = h / 2;
      } else o = box(w, h, d, mat(0x8c8a80, { roughness: 0.9 }), 0, h / 2, 0);
    } else if (def.id === 'ed/ramp') {
      // 長 w 沿 X、往 +X 升高 h、寬 d；板的中心在半高
      const g = st ? buildThemeRamp(st, w, d) : box(w, 0.4 * MS, d, mat(0x7a7f88, { roughness: 0.9 }));
      const ang = Math.atan2(h, w);
      g.rotation.z = ang;
      g.position.y = h / 2 - 0.15 * MS;
      o = g;
      ramp = { len: w, rise: h, wid: d };
    } else if (def.id === 'ed/deck') {
      const g = st ? buildThemeDeck(st, w, d, h, false) : buildDeck(w, d, h, false, deckMats()).group;
      g.position.y = h; // 橋面板的原點在頂面
      o = g;
    } else if (def.id === 'ed/pillar') {
      if (st) {
        o = buildThemePillar(st, w / 2, h);
        o.position.y = h / 2;
      } else o = buildPillar(w / 2, h, deckMats().pillar);
    } else if (def.id === 'ed/container') {
      const cm = mat((T && T.container2) || 0xd7a23c);
      o = buildContainer(w, h, d, false, cm, mat(0x2a2d31));
    } else {
      o = buildGridPillar(w, h, d, mat(0xc9cdd5, { roughness: 0.9, metalness: 0.05 })).mesh;
      o.position.y = h / 2;
    }
    inner.add(o);
  } else {
    const o = def.build();
    o.scale.set(s[0], s[1], s[2]);
    inner.add(o);
  }
  // 原點移到底面中心（坡道與結構本來就是）
  inner.updateMatrixWorld(true);
  const b = measure(inner);
  if (!def.struct) {
    const c = b.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -b.min.y, -c.z);
    b.translate(inner.position);
  } else if (ramp) {
    b.min.y = 0;
  }
  const group = new THREE.Group();
  group.add(inner);
  group.userData.levelProp = true;
  return {
    group,
    bounds: b,
    ramp,
    deck: !!def.deck,
  };
}
// 外框（略過描邊外殼）
function measure(obj) {
  const b = new THREE.Box3();
  const tmp = new THREE.Box3();
  obj.traverse((o) => {
    if (!o.isMesh || isOutline(o.material) || !o.geometry) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
    b.union(tmp);
  });
  if (b.isEmpty()) b.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  return b;
}
// 每個物件自己的材質（擋住鏡頭時各自半透明；共用的快取材質不能直接改透明度）
export function ownMats(group) {
  const out = [];
  const map = new Map();
  group.traverse((o) => {
    if (!o.isMesh || isOutline(o.material)) return;
    const one = (m) => {
      if (!map.has(m)) {
        const c = m.clone();
        c.transparent = true;
        map.set(m, c);
        out.push(c);
      }
      return map.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });
  return out;
}
