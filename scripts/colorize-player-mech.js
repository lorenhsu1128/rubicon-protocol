// 內建的玩家預設機甲（src/assets/player-mech/）改成可以換色：
// node scripts/colorize-player-mech.js [--src=原本的彩色 GLB 資料夾] [--out=輸出資料夾]（預設都是 src/assets/player-mech）
// - 每個 GLB 只有一個彩色貼圖的材質（AI 生成等），遊戲依材質名稱換色（render/glb.js 的 tintMaterial），所以：
//   1. 取每個三角形在貼圖上的顏色，依亮度與色相分成色槽 main／sub／joint／acc：顏色一致的 UV 島整個島一起分，
//      不一致的島逐三角形分，再以相鄰三角形的面積多數決平滑（不會一塊板子碎成好幾色）
//   2. 貼圖改成灰階：各色槽的亮度乘同一個倍率（平均亮度正規化到 0.85，最多 ×3），換色＝陣營色 × 灰階
//   3. UV 島外的空白往外擴色 8 px（遠看時 mip 不滲進灰底），其餘填平均值
//   4. 網格依色槽拆成多個 primitive（共用頂點），材質名稱＝色槽、顏色白色；法線貼圖等照舊
// - 最後印出「白色」配色（render/materials.js 的 PALETTES.white）：色槽顏色 × 灰階貼圖 ≈ 原本的彩色貼圖。
//   three.js r128 的 Color.set(hex) 不做 sRGB 轉換，所以配色的數值是線性值
// - 已經轉換過的 GLB（材質名稱是色槽）不能再轉：要從原本的彩色 GLB 開始
// 用 headless Edge／Chrome 解碼與編碼 JPEG（不需要額外的套件）
/* global createImageBitmap, OffscreenCanvas */ // pageColors／pageGray 在頁面裡執行
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const ROOT = path.resolve(__dirname, '..');
const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith('--' + k + '='));
  return a ? path.resolve(a.slice(k.length + 3)) : d;
};
const SRC = arg('src', path.join(ROOT, 'src/assets/player-mech'));
const OUT = arg('out', SRC);
const BROWSERS = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const SLOTS = ['main', 'sub', 'joint', 'acc'];
const TH = { joint: 0.3, sub: 0.52 }; // sRGB 亮度的門檻
const MIXED_SD = 0.15; // UV 島的亮度標準差超過它＝逐三角形分
const JPEG_Q = 0.85;

// ---------- GLB 讀寫（單一 mesh、單一 primitive） ----------
const CT = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array, 5121: Uint8Array };
const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
function readGlb(f) {
  const b = fs.readFileSync(f);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.slice(20, 20 + jl).toString());
  const binOff = 20 + jl + 8;
  const bin = b.slice(binOff, binOff + b.readUInt32LE(20 + jl));
  const acc = (i) => {
    const a = j.accessors[i],
      bv = j.bufferViews[a.bufferView];
    const T = CT[a.componentType],
      n = NC[a.type];
    const stride = bv.byteStride ? bv.byteStride / T.BYTES_PER_ELEMENT : n;
    const src = new T(
      bin.buffer,
      bin.byteOffset + (bv.byteOffset || 0) + (a.byteOffset || 0),
      (a.count - 1) * stride + n,
    );
    const out = new T(a.count * n);
    for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) out[k * n + c] = src[k * stride + c];
    return out;
  };
  const view = (i) => {
    const bv = j.bufferViews[i];
    return bin.slice(bv.byteOffset || 0, (bv.byteOffset || 0) + bv.byteLength);
  };
  return { j, acc, view };
}
// json＋各 bufferView 的資料（views[i]＝第 i 個 bufferView）重新打包
function writeGlb(f, j, views) {
  const parts = [];
  let off = 0;
  j.bufferViews.forEach((bv, i) => {
    const d = views[i];
    bv.byteOffset = off;
    bv.byteLength = d.length;
    bv.buffer = 0;
    parts.push(d);
    off += d.length;
    const pad = (4 - (off % 4)) % 4;
    if (pad) {
      parts.push(Buffer.alloc(pad));
      off += pad;
    }
  });
  const bin = Buffer.concat(parts);
  j.buffers = [{ byteLength: bin.length }];
  let js = Buffer.from(JSON.stringify(j));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
  const c0 = Buffer.alloc(8);
  c0.writeUInt32LE(js.length, 0);
  c0.writeUInt32LE(0x4e4f534a, 4);
  const c1 = Buffer.alloc(8);
  c1.writeUInt32LE(bin.length, 0);
  c1.writeUInt32LE(0x004e4942, 4);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.concat([h, c0, js, c1, bin]));
}

// ---------- 頁面裡做的事（解碼／編碼 JPEG） ----------
// 每個三角形的顏色（sRGB 0～1）：重心 ×2 加上重心與各頂點的中點，取平均
async function pageColors({ uv, idx, img }) {
  const bm = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + img)).blob());
  const W = bm.width,
    H = bm.height;
  const c = new OffscreenCanvas(W, H),
    g = c.getContext('2d');
  g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, W, H).data;
  const smp = (u, v) => {
    const x = Math.min(W - 1, Math.max(0, Math.floor(u * W))),
      y = Math.min(H - 1, Math.max(0, Math.floor(v * H)));
    const o = (y * W + x) * 4;
    return [d[o], d[o + 1], d[o + 2]];
  };
  const col = [];
  for (let t = 0; t < idx.length / 3; t++) {
    const U = [0, 1, 2].map((k) => [uv[idx[t * 3 + k] * 2], uv[idx[t * 3 + k] * 2 + 1]]);
    const cu = (U[0][0] + U[1][0] + U[2][0]) / 3,
      cv = (U[0][1] + U[1][1] + U[2][1]) / 3;
    const s = [0, 0, 0];
    const add = (u, v, k) => smp(u, v).forEach((x, i) => (s[i] += x * k));
    add(cu, cv, 2);
    for (const [u, v] of U) add((cu + u) / 2, (cv + v) / 2, 1);
    col.push(s.map((x) => x / 5 / 255));
  }
  return col;
}
// 灰階貼圖：三角形蓋到的像素＝亮度 × 它色槽的倍率，其餘擴色；回傳 JPEG 的 base64
async function pageGray({ uv, idx, img, kt, q }) {
  const bm = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + img)).blob());
  const W = bm.width,
    H = bm.height;
  const c = new OffscreenCanvas(W, H),
    g = c.getContext('2d');
  g.drawImage(bm, 0, 0);
  const d = g.getImageData(0, 0, W, H),
    a = d.data;
  let cur = new Float32Array(W * H).fill(-1);
  for (let t = 0; t < idx.length / 3; t++) {
    const P = [0, 1, 2].map((k) => [uv[idx[t * 3 + k] * 2] * W, uv[idx[t * 3 + k] * 2 + 1] * H]);
    // 往外推 1.5 px：邊緣的像素也算（雙線性取樣會取到）
    const cx = (P[0][0] + P[1][0] + P[2][0]) / 3,
      cy = (P[0][1] + P[1][1] + P[2][1]) / 3;
    const [A, B, C] = P.map(([x, y]) => {
      const l = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / l) * 1.5, y + ((y - cy) / l) * 1.5];
    });
    const den = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1]);
    if (Math.abs(den) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0]))),
      x1 = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const y0 = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1]))),
      y1 = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5,
          py = y + 0.5;
        const w0 = ((B[1] - C[1]) * (px - C[0]) + (C[0] - B[0]) * (py - C[1])) / den;
        const w1 = ((C[1] - A[1]) * (px - C[0]) + (A[0] - C[0]) * (py - C[1])) / den;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const o = (y * W + x) * 4;
        cur[y * W + x] = Math.min(255, (0.2126 * a[o] + 0.7152 * a[o + 1] + 0.0722 * a[o + 2]) * kt[t]);
      }
  }
  for (let it = 0; it < 8; it++) {
    const nx = cur.slice();
    let changed = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (cur[i] >= 0) continue;
        let s = 0,
          n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx,
              Y = y + dy;
            if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
            const v = cur[Y * W + X];
            if (v >= 0) {
              s += v;
              n++;
            }
          }
        if (n) {
          nx[i] = s / n;
          changed++;
        }
      }
    cur = nx;
    if (!changed) break;
  }
  let sum = 0,
    cnt = 0;
  for (const v of cur)
    if (v >= 0) {
      sum += v;
      cnt++;
    }
  const avg = cnt ? sum / cnt : 200;
  for (let i = 0; i < W * H; i++) {
    a[i * 4] = a[i * 4 + 1] = a[i * 4 + 2] = Math.round(cur[i] >= 0 ? cur[i] : avg);
    a[i * 4 + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  const u8 = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer());
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------- 分色 ----------
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const toLin = (x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
function slotOf(c) {
  const [r, g, b] = c,
    mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  let h = 0;
  if (mx - mn > 1e-6) {
    if (mx === r) h = ((g - b) / (mx - mn) + 6) % 6;
    else if (mx === g) h = (b - r) / (mx - mn) + 2;
    else h = (r - g) / (mx - mn) + 4;
  }
  h *= 60;
  if (mx > 0.3 && (mx - mn) / mx > 0.35 && h >= 20 && h <= 70) return 'acc'; // 黃色系
  const L = lum(c);
  return L < TH.joint ? 'joint' : L < TH.sub ? 'sub' : 'main';
}
function classify(idx, nv, pos, col) {
  const nt = idx.length / 3;
  const area = new Float64Array(nt);
  for (let t = 0; t < nt; t++) {
    const p = [0, 1, 2].map((k) => [0, 1, 2].map((c) => pos[idx[t * 3 + k] * 3 + c]));
    const e1 = p[1].map((x, i) => x - p[0][i]),
      e2 = p[2].map((x, i) => x - p[0][i]);
    area[t] =
      Math.hypot(
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ) / 2;
  }
  // UV 島＝共用頂點相連的三角形（貼圖接縫的頂點是分開的）
  const par = Int32Array.from({ length: nv }, (_, i) => i);
  const find = (x) => {
    while (par[x] !== x) x = par[x] = par[par[x]];
    return x;
  };
  for (let t = 0; t < nt; t++) {
    const a = find(idx[t * 3]);
    par[find(idx[t * 3 + 1])] = a;
    par[find(idx[t * 3 + 2])] = a;
  }
  const isl = Array.from({ length: nt }, (_, t) => find(idx[t * 3]));
  const st = new Map();
  isl.forEach((id, t) => {
    const e = st.get(id) || { a: 0, l: 0, l2: 0, c: [0, 0, 0] };
    const L = lum(col[t]);
    e.a += area[t];
    e.l += L * area[t];
    e.l2 += L * L * area[t];
    for (let i = 0; i < 3; i++) e.c[i] += col[t][i] * area[t];
    st.set(id, e);
  });
  const islSlot = new Map();
  for (const [id, e] of st) {
    const a = e.a || 1,
      mu = e.l / a;
    const sd = Math.sqrt(Math.max(0, e.l2 / a - mu * mu));
    islSlot.set(id, sd > MIXED_SD ? null : slotOf(e.c.map((x) => x / a)));
  }
  let labels = isl.map((id, t) => islSlot.get(id) || slotOf(col[t]));
  const byV = new Map();
  for (let t = 0; t < nt; t++)
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      if (!byV.has(v)) byV.set(v, []);
      byV.get(v).push(t);
    }
  for (let it = 0; it < 3; it++) {
    const nx = labels.slice();
    for (let t = 0; t < nt; t++) {
      if (islSlot.get(isl[t]) || labels[t] === 'acc') continue;
      const w = { [labels[t]]: area[t] * 1.2 };
      const seen = new Set([t]);
      for (let k = 0; k < 3; k++)
        for (const u of byV.get(idx[t * 3 + k])) {
          if (seen.has(u)) continue;
          seen.add(u);
          w[labels[u]] = (w[labels[u]] || 0) + area[u];
        }
      nx[t] = Object.entries(w).sort((x, y) => y[1] - x[1])[0][0];
    }
    labels = nx;
  }
  return { labels, area };
}

function walk(d) {
  return fs
    .readdirSync(d, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.glb') ? [path.join(d, e.name)] : [],
    );
}

(async () => {
  const exe = BROWSERS.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Edge／Chrome');
  const browser = await chromium.launch({ executablePath: exe, headless: true });
  const page = await browser.newPage();
  const jobs = [];
  for (const f of walk(SRC)) {
    const G = readGlb(f);
    const prims = G.j.meshes.flatMap((m) => m.primitives);
    if (G.j.meshes.length !== 1 || prims.length !== 1)
      throw new Error(`${f}：只處理單一網格、單一材質的 GLB（已經轉換過的要從原本的彩色 GLB 開始）`);
    const prim = prims[0];
    const mat = G.j.materials[prim.material];
    if (SLOTS.includes(String(mat.name || '').toLowerCase())) throw new Error(`${f}：已經轉換過`);
    const tex = mat.pbrMetallicRoughness && mat.pbrMetallicRoughness.baseColorTexture;
    const image = G.j.images[G.j.textures[tex.index].source];
    const idx = Array.from(G.acc(prim.indices));
    const uv = Array.from(G.acc(prim.attributes.TEXCOORD_0));
    const pos = Array.from(G.acc(prim.attributes.POSITION));
    const img = G.view(image.bufferView).toString('base64');
    const col = await page.evaluate(pageColors, { uv, idx, img });
    const { labels, area } = classify(idx, pos.length / 3, pos, col);
    jobs.push({ f, G, prim, mat, image, idx, uv, img, col, labels, area });
  }
  // 各色槽的平均亮度（全部區塊、面積加權）→ 灰階倍率；白色配色＝原本的平均顏色（線性）÷ 灰階的平均（線性）
  const st = {};
  for (const J of jobs)
    J.labels.forEach((s, t) => {
      const e = (st[s] = st[s] || { a: 0, l: 0, c: [0, 0, 0], ls: [] });
      const ar = J.area[t],
        c = J.col[t];
      e.a += ar;
      e.l += lum(c) * ar;
      e.ls.push([lum(c), ar]);
      for (let i = 0; i < 3; i++) e.c[i] += toLin(c[i]) * ar;
    });
  const K = {},
    PAL = {};
  for (const s of SLOTS) {
    const e = st[s];
    if (!e) continue;
    K[s] = Math.min(3, 0.85 / (e.l / e.a));
    const g = e.ls.reduce((q, [L, ar]) => q + toLin(Math.min(1, L * K[s])) * ar, 0) / e.a;
    PAL[s] = e.c.map((x) => Math.min(1, x / e.a / g));
  }
  for (const J of jobs) {
    const { G, prim, mat, image, idx, uv, img, labels } = J;
    const j = G.j;
    const kt = labels.map((s) => K[s]);
    const jpg = await page.evaluate(pageGray, { uv, idx, img, kt, q: JPEG_Q });
    const views = j.bufferViews.map((_, i) => G.view(i));
    views[image.bufferView] = Buffer.from(jpg, 'base64');
    image.mimeType = 'image/jpeg';
    const ia = j.accessors[prim.indices];
    const T = ia.componentType === 5125 ? Uint32Array : ia.componentType === 5121 ? Uint8Array : Uint16Array;
    const used = SLOTS.filter((s) => labels.includes(s));
    const prims = [];
    j.materials = [];
    used.forEach((s, si) => {
      const list = [];
      labels.forEach((l, t) => {
        if (l === s) list.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
      });
      const buf = Buffer.from(new T(list).buffer);
      let aci = prim.indices;
      if (si === 0) views[ia.bufferView] = buf;
      else {
        j.bufferViews.push({ buffer: 0, byteLength: buf.length, target: 34963 });
        views.push(buf);
        aci = j.accessors.length;
        j.accessors.push({
          bufferView: j.bufferViews.length - 1,
          componentType: ia.componentType,
          type: 'SCALAR',
        });
      }
      const A = j.accessors[aci];
      A.count = list.length;
      A.byteOffset = 0;
      delete A.min;
      delete A.max;
      const m = JSON.parse(JSON.stringify(mat));
      m.name = s;
      m.pbrMetallicRoughness = Object.assign({}, m.pbrMetallicRoughness, { baseColorFactor: [1, 1, 1, 1] });
      j.materials.push(m);
      prims.push(Object.assign({}, prim, { indices: aci, material: si }));
    });
    j.meshes[0].primitives = prims;
    const rel = path.relative(SRC, J.f);
    writeGlb(path.join(OUT, rel), j, views);
    const cnt = used.map((s) => `${s} ${labels.filter((l) => l === s).length}`).join('、');
    console.log(rel.split(path.sep).join('/').padEnd(24), cnt);
  }
  if (OUT !== SRC && fs.existsSync(path.join(SRC, 'joints.json')))
    fs.copyFileSync(path.join(SRC, 'joints.json'), path.join(OUT, 'joints.json'));
  const hex = (c) =>
    '0x' +
    c
      .map((x) =>
        Math.round(x * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  console.log('灰階倍率', Object.fromEntries(Object.entries(K).map(([s, k]) => [s, +k.toFixed(2)])));
  console.log('PALETTES.white 的色槽（線性值）：');
  for (const [s, c] of Object.entries(PAL)) console.log(`  ${s}: ${hex(c)},`);
  await browser.close();
})().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
