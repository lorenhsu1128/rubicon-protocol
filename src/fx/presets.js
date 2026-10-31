// ============================================================
//  特效預設（docs/vfx-design.md 第 5 期）：一個特效＝幾層發射器（照 wawa-vfx 的發射器設定），
//  內建的在 src/assets/fx/presets.json；模型庫的「特效」頁籤（library/vfx.js）可以調整、存到瀏覽器
//  （localStorage rubicon_fx_presets，遊戲也讀＝只有外觀，多人各端各自的也沒關係）、匯出 JSON 放回內建。
//  每一層的欄位（S＝呼叫端給的尺度：例如爆炸半徑 × k；長度、速度、重力都乘 S）：
//    sys    系統：sm 煙塵、gl 發光、ln 拉長、rg 地面的環、dc 焦痕
//    n      數量（呼叫端可以再乘 o.n）；chance 每顆的機率
//    life   壽命 [最短, 最長] 秒；lifeDur＝再乘 o.dur
//    pos    起點離中心的距離 [最近, 最遠]（× S，方向隨機）；ring＝起點在速度方向的水平距離（× S）
//    speed  速度 [最慢, 最快]（× S × o.spd）；dir＝方向的範圍 [[x, y, z] 最小, 最大]（取亂數後正規化），沒有＝隨機
//    inward 往中心吸進去（壽命結束時剛好到中心；蓄力）；delay 出發時間 [最早, 最晚]（× o.dur）
//    s0／s1 起訖大小 [最小, 最大]（× S）；c0／c1 起訖顏色（'$'＝呼叫端的顏色）；k 亮度倍率；a 不透明度；occ 遮蔽度
//    cells  貼圖：圖集的組或格的名稱，逗號分隔（fx/atlas.js 的 FXG、FXC）
//    fade   淡出曲線（fx/gpu.js）；g 重力（× S，負的往上飄）；drag 空氣阻力；rot 1＝隨機的角度；rv 旋轉速度；asp 拉長的比例
// ============================================================
import BUILTIN from '../assets/fx/presets.json';
import { FXC, FXG } from './atlas.js';

export const FX_LOCAL_KEY = 'rubicon_fx_presets';
const SYS = ['sm', 'gl', 'ln', 'rg', 'dc'];
const NUM2 = ['life', 'pos', 'speed', 'delay', 's0', 's1', 'rv'];
const NUM1 = ['n', 'chance', 'k', 'a', 'occ', 'fade', 'g', 'drag', 'asp', 'ring', 'rot'];
const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (x, lo, hi, d) => {
  const v = +x;
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
};
const colorOk = (c) => c === '$' || (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c));

// 讀進來的一層只留認得的欄位（瀏覽器裡的、匯入的）
export function sanitizeLayer(L) {
  if (!L || typeof L !== 'object') return null;
  const o = { sys: SYS.includes(L.sys) ? L.sys : 'gl' };
  for (const k of NUM2)
    if (Array.isArray(L[k]) && L[k].length === 2)
      o[k] = [num(L[k][0], -1e3, 1e3, 0), num(L[k][1], -1e3, 1e3, 0)];
  for (const k of NUM1) if (L[k] != null) o[k] = num(L[k], -1e3, 1e3, 0);
  if (o.n != null) o.n = Math.max(0, Math.min(200, Math.round(o.n)));
  if (Array.isArray(L.dir) && L.dir.length === 2 && L.dir.every((v) => Array.isArray(v) && v.length === 3))
    o.dir = L.dir.map((v) => v.map((x) => num(x, -10, 10, 0)));
  for (const k of ['c0', 'c1']) if (colorOk(L[k])) o[k] = L[k];
  if (typeof L.cells === 'string') o.cells = L.cells.slice(0, 80);
  for (const k of ['inward', 'lifeDur', 'flat']) if (L[k]) o[k] = true;
  return o;
}
export function sanitizePresets(raw) {
  const out = {};
  const P = raw && raw.presets;
  if (!P || typeof P !== 'object') return out;
  for (const [id, p] of Object.entries(P)) {
    if (!/^[\w-]{1,40}$/.test(id) || !p || !Array.isArray(p.layers)) continue;
    const layers = p.layers.slice(0, 8).map(sanitizeLayer).filter(Boolean);
    if (layers.length)
      out[id] = { name: String(p.name || id).slice(0, 40), note: String(p.note || '').slice(0, 200), layers };
  }
  return out;
}

// 目前的預設：內建＋瀏覽器的覆寫（同名的整個取代）
let CUR = null;
export function fxPresets() {
  if (CUR) return CUR;
  CUR = clone(BUILTIN.presets);
  try {
    const raw = localStorage.getItem(FX_LOCAL_KEY);
    if (raw) Object.assign(CUR, sanitizePresets(JSON.parse(raw)));
  } catch (e) {}
  return CUR;
}
export function fxBuiltin() {
  return clone(BUILTIN.presets);
}
// 編輯器改了：換掉目前的（save＝存到瀏覽器，只存和內建不同的）
export function setFxPresets(all, save) {
  CUR = clone(all);
  if (!save) return;
  const diff = {};
  for (const [id, p] of Object.entries(CUR))
    if (JSON.stringify(p) !== JSON.stringify(BUILTIN.presets[id])) diff[id] = p;
  try {
    if (Object.keys(diff).length) localStorage.setItem(FX_LOCAL_KEY, JSON.stringify({ v: 1, presets: diff }));
    else localStorage.removeItem(FX_LOCAL_KEY);
  } catch (e) {}
}

// 貼圖的格號清單（快取在這一層上，改了 cells 時重算）
function cellsOf(L) {
  if (L._cells && L._cs === L.cells) return L._cells;
  const out = [];
  for (const nm of String(L.cells || 'soft').split(',')) {
    const k = nm.trim();
    if (FXG[k]) out.push(...FXG[k]);
    else if (FXC[k] != null) out.push(FXC[k]);
  }
  Object.defineProperty(L, '_cells', {
    value: out.length ? out : [FXC.soft],
    writable: true,
    enumerable: false,
  });
  Object.defineProperty(L, '_cs', { value: L.cells, writable: true, enumerable: false });
  return L._cells;
}
const rr = (a, d = 0) => (Array.isArray(a) ? a[0] + Math.random() * (a[1] - a[0]) : a != null ? a : d);
const hexOf = (c, color) =>
  c === '$' ? (color != null ? color : 0xffffff) : c ? parseInt(c.slice(1), 16) : null;
const _d = new THREE.Vector3(),
  _p = new THREE.Vector3(),
  _v = new THREE.Vector3();

// 依預設產生粒子。sys：{ sm, gl, ln, rg, dc }（GpuFx）；p：中心；o：{ S 尺度, color, n 數量倍率, spd 速度倍率, lifeK 壽命倍率, dur }
export function emitPreset(sys, id, p, o = {}) {
  const pre = fxPresets()[id];
  if (!pre) return;
  const S = o.S || 1,
    dur = o.dur || 1;
  for (const L of pre.layers) {
    const G = sys[L.sys];
    if (!G) continue;
    const cells = cellsOf(L);
    const n = Math.round((L.n != null ? L.n : 1) * (o.n || 1));
    const c0 = hexOf(L.c0, o.color),
      c1 = hexOf(L.c1, o.color);
    for (let i = 0; i < n; i++) {
      if (L.chance != null && Math.random() >= L.chance) continue;
      // 方向：範圍內取亂數（沒有範圍＝球面上隨機）
      if (L.dir)
        _d.set(
          rr([L.dir[0][0], L.dir[1][0]]),
          rr([L.dir[0][1], L.dir[1][1]]),
          rr([L.dir[0][2], L.dir[1][2]]),
        );
      else _d.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
      if (_d.lengthSq() < 1e-6) _d.set(0, 1, 0);
      _d.normalize();
      const life = rr(L.life, 0.5) * (L.lifeDur ? dur : 1) * (o.lifeK || 1);
      _p.copy(p);
      let v = null;
      if (L.inward) {
        _p.addScaledVector(_d, rr(L.pos, 1) * S);
        v = _v.copy(p).sub(_p).divideScalar(life);
      } else {
        if (L.pos) {
          const r = rr(L.pos) * S;
          _p.x += (Math.random() * 2 - 1) * r;
          _p.y += (Math.random() * 2 - 1) * r;
          _p.z += (Math.random() * 2 - 1) * r;
        }
        if (L.ring) {
          const h = Math.hypot(_d.x, _d.z) || 1;
          _p.x += (_d.x / h) * L.ring * S;
          _p.z += (_d.z / h) * L.ring * S;
        }
        if (L.speed) v = _v.copy(_d).multiplyScalar(rr(L.speed) * S * (o.spd || 1));
      }
      G.emit({
        p: _p,
        v,
        life,
        delay: L.delay ? rr(L.delay) * dur : 0,
        s0: rr(L.s0, 1) * S,
        s1: (L.s1 ? rr(L.s1) : rr(L.s0, 1)) * S,
        c0: c0 != null ? c0 : 0xffffff,
        c1: c1 != null ? c1 : c0 != null ? c0 : 0xffffff,
        k: L.k,
        a: L.a,
        occ: L.occ,
        cell: cells[Math.floor(Math.random() * cells.length)],
        fade: L.fade,
        g: (L.g || 0) * S,
        drag: L.drag,
        rot: L.rot ? Math.random() * 6.28 : 0,
        rv: L.rv ? rr(L.rv) : 0,
        asp: L.asp,
      });
    }
  }
}
