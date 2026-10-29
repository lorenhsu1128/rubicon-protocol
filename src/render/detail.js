// 程式模型的精細化工具（docs/model-detail.md）：純函式，不使用亂數（需要變化時由呼叫端給種子）。
// - 幾何（D.*）：倒角方塊、圓角圓柱、剖面旋轉、截面擠出、沿折線掃出、輪胎、輪框、齒輪、旋翼葉片、雜訊岩石。
//   一律回傳沒有索引的 BufferGeometry（position／normal／uv），同樣的參數共用同一份（快取），不要修改回傳的幾何。
// - 頂點色烘焙（tintMerge）：合併時依零件之間的距離算遮蔽、依凸邊算磨損、依高度算貼地的髒污，寫成 color 屬性；
//   材質要開 vertexColors（vcMat：共用顏色的複本；或建模時自己的材質直接打開）。
// - 小細節分級（fineReg／fineTick）：螺栓、把手、纜線這類小零件放在另一個網格，鏡頭遠了就隱藏。
const HP = Math.PI / 2;
const CACHE = new Map();
const cached = (k, make) => {
  let g = CACHE.get(k);
  if (!g) CACHE.set(k, (g = make()));
  return g;
};
const r3 = (x) => Math.round(x * 1000) / 1000;
const key = (n, a) => n + ':' + a.map((x) => (typeof x === 'number' ? r3(x) : JSON.stringify(x))).join(',');
const _v = new THREE.Vector3(),
  _w = new THREE.Vector3(),
  _n = new THREE.Vector3(),
  _m3 = new THREE.Matrix3();

// ---------- 幾何的基本工具 ----------
// 三角形列表（[x,y,z,...] 每 9 個一個三角形）→ 幾何；法線依面（平面著色），uv 依法線的主軸投影（1 單位＝1）
function fromTris(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  boxUV(g, 1);
  return g;
}
// uv：依面的法線主軸投影（s＝每單位幾個 uv）
export function boxUV(g, s = 1) {
  const p = g.attributes.position,
    n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)),
      ay = Math.abs(n.getY(i)),
      az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) ((u = p.getX(i)), (v = p.getZ(i)));
    else if (ax >= az) ((u = p.getZ(i)), (v = p.getY(i)));
    else ((u = p.getX(i)), (v = p.getY(i)));
    uv[i * 2] = u * s;
    uv[i * 2 + 1] = v * s;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const nonIdx = (g) => {
  const o = g.index ? g.toNonIndexed() : g;
  if (!o.attributes.normal) o.computeVertexNormals();
  if (!o.attributes.uv) boxUV(o);
  return o;
};
// 格狀曲面：rows × cols 個點（P(i, j) 回傳 [x,y,z]），closeU：j 方向頭尾相接
function gridTris(rows, cols, P, closeU, out) {
  const cj = closeU ? cols : cols - 1;
  for (let i = 0; i < rows - 1; i++)
    for (let j = 0; j < cj; j++) {
      const j2 = (j + 1) % cols;
      const a = P(i, j),
        b = P(i + 1, j),
        c = P(i + 1, j2),
        d = P(i, j2);
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  return out;
}
// 繞軸旋轉剖面：prof＝[[s, r]...]（s＝沿軸、r＝半徑），axis 'y'｜'x'，seg 段，角度 a0～a1；
// 面的方向照剖面的走向：沿剖面前進時右手邊（(−dr, ds)，以 s 為 Y 時就是 (dy, −dr)）是外面
function revolve(prof, seg, axis, a0 = 0, a1 = Math.PI * 2, bump = null) {
  const full = Math.abs(a1 - a0 - Math.PI * 2) < 1e-6;
  const cols = full ? seg : seg + 1;
  const P = (i, j) => {
    const a = a0 + ((a1 - a0) * (j % cols)) / seg;
    let [sv, r] = prof[i];
    if (bump) r += bump(i, j);
    const c = Math.cos(a) * r,
      sn = Math.sin(a) * r;
    return axis === 'x' ? [sv, c, sn] : [sn, sv, c];
  };
  const pos = [];
  const cj = full ? cols : cols - 1;
  for (let i = 0; i < prof.length - 1; i++) {
    const ds = prof[i + 1][0] - prof[i][0],
      dr = prof[i + 1][1] - prof[i][1];
    for (let j = 0; j < cj; j++) {
      const j2 = (j + 1) % cols;
      const A = P(i, j),
        B = P(i + 1, j),
        C2 = P(i + 1, j2),
        E = P(i, j2);
      // 這一格的外側法線：沿軸分量 −dr、徑向分量 ds（徑向＝這一格的中心角度）
      const a = a0 + ((a1 - a0) * (j + 0.5)) / seg;
      const ns = -dr,
        nr = ds;
      const want =
        axis === 'x' ? [ns, Math.cos(a) * nr, Math.sin(a) * nr] : [Math.sin(a) * nr, ns, Math.cos(a) * nr];
      for (const [p0, p1, p2] of [
        [A, B, C2],
        [A, C2, E],
      ]) {
        const ux = p1[0] - p0[0],
          uy = p1[1] - p0[1],
          uz = p1[2] - p0[2],
          vx = p2[0] - p0[0],
          vy = p2[1] - p0[1],
          vz = p2[2] - p0[2];
        const nx = uy * vz - uz * vy,
          ny = uz * vx - ux * vz,
          nz = ux * vy - uy * vx;
        if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) < 1e-12) continue; // 軸上退化的三角形
        if (nx * want[0] + ny * want[1] + nz * want[2] < 0) pos.push(...p0, ...p2, ...p1);
        else pos.push(...p0, ...p1, ...p2);
      }
    }
  }
  return pos;
}
// 以中心點把三角形翻成朝外（凸的形體用）
function outward(pos, cx = 0, cy = 0, cz = 0) {
  for (let i = 0; i < pos.length; i += 9) {
    const ux = pos[i + 3] - pos[i],
      uy = pos[i + 4] - pos[i + 1],
      uz = pos[i + 5] - pos[i + 2],
      vx = pos[i + 6] - pos[i],
      vy = pos[i + 7] - pos[i + 1],
      vz = pos[i + 8] - pos[i + 2];
    const nx = uy * vz - uz * vy,
      ny = uz * vx - ux * vz,
      nz = ux * vy - uy * vx;
    const mx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3 - cx,
      my = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3 - cy,
      mz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0)
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
  }
  return pos;
}

// ---------- 幾何 ----------
export const D = {
  // 倒角方塊（12 條邊切角 c）
  box(w, h, d, c = 0.05) {
    return cached(key('box', [w, h, d, c]), () => {
      const H = [w / 2, h / 2, d / 2];
      c = Math.max(0.001, Math.min(c, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9));
      const P = (a, s) => s.map((sv, i) => sv * (i === a ? H[i] : H[i] - c));
      const pos = [];
      const quad = (A, B, C2, E) => pos.push(...A, ...B, ...C2, ...A, ...C2, ...E);
      for (let a = 0; a < 3; a++)
        for (const s of [-1, 1]) {
          const o = [0, 1, 2].filter((i) => i !== a);
          const v = (s1, s2) => {
            const q = [0, 0, 0];
            q[a] = s;
            q[o[0]] = s1;
            q[o[1]] = s2;
            return P(a, q);
          };
          quad(v(1, 1), v(1, -1), v(-1, -1), v(-1, 1));
        }
      for (let a = 0; a < 3; a++)
        for (let b = a + 1; b < 3; b++) {
          const t = 3 - a - b;
          for (const sa of [-1, 1])
            for (const sb of [-1, 1]) {
              const s = (st) => {
                const q = [0, 0, 0];
                q[a] = sa;
                q[b] = sb;
                q[t] = st;
                return q;
              };
              quad(P(a, s(1)), P(a, s(-1)), P(b, s(-1)), P(b, s(1)));
            }
        }
      for (const sx of [-1, 1])
        for (const sy of [-1, 1])
          for (const sz of [-1, 1]) {
            const s = [sx, sy, sz];
            pos.push(...P(0, s), ...P(1, s), ...P(2, s));
          }
      return fromTris(outward(pos));
    });
  },
  // 剖面旋轉：prof＝[[半徑, y]...]（由下往上走的剖面，外面在右手邊），軸沿 Y；要封口時剖面的頭尾回到半徑 0；
  // seg 段；a0／a1 只轉一段角度
  lathe(prof, seg = 16, a0 = 0, a1 = Math.PI * 2) {
    return cached(key('lathe', [prof, seg, a0, a1]), () =>
      fromTris(
        revolve(
          prof.map(([r, y]) => [y, r]),
          seg,
          'y',
          a0,
          a1,
        ),
      ),
    );
  },
  // 圓角圓柱（軸沿 Y、置中）：上下邊倒角 c
  cyl(rt, rb, h, seg = 16, c = 0) {
    c = Math.min(c, h / 3, rt * 0.5, rb * 0.5);
    const y = h / 2;
    const prof =
      c > 0
        ? [
            [0, -y],
            [rb - c, -y],
            [rb, -y + c],
            [rt, y - c],
            [rt - c, y],
            [0, y],
          ]
        : [
            [0, -y],
            [rb, -y],
            [rt, y],
            [0, y],
          ];
    return D.lathe(prof, seg);
  },
  // 截面擠出：shape＝[[x, y]...]（XY 平面，逆時針），沿 Z 擠出 depth（置中），bevel＝倒角
  extrude(shape, depth, bevel = 0) {
    return cached(key('ext', [shape, depth, bevel]), () => {
      const sh = new THREE.Shape(shape.map(([x, y]) => new THREE.Vector2(x, y)));
      const b = Math.min(bevel, depth / 3);
      const g = new THREE.ExtrudeGeometry(sh, {
        depth: depth - b * 2,
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelSegments: 1,
        steps: 1,
      });
      g.translate(0, 0, -(depth - b * 2) / 2);
      return boxUV(nonIdx(g));
    });
  },
  // 沿折線掃出：path＝[[x,y,z]...]、sec＝截面 [[x, y]...]（逆時針；圓管用 D.ring(r, n)）、closed＝頭尾相接、
  // caps＝封口；uv 的 u 依長度（米）
  sweep(path, sec, closed = false, caps = true) {
    return cached(key('sweep', [path, sec, closed, caps]), () => {
      const n = path.length,
        V = (i) => new THREE.Vector3(...path[(i + n) % n]);
      const frames = [];
      let prevN = null;
      // 平面的路徑（履帶、欄杆）：截面的寬度方向固定在平面的法線上（Newell 法）；不是平面時照平行移動
      const N = new THREE.Vector3();
      for (let i = 0; i < n; i++) {
        const a = path[i],
          b = path[(i + 1) % n];
        N.x += (a[1] - b[1]) * (a[2] + b[2]);
        N.y += (a[2] - b[2]) * (a[0] + b[0]);
        N.z += (a[0] - b[0]) * (a[1] + b[1]);
      }
      let planar = N.length() > 1e-6;
      if (planar) {
        N.normalize();
        const c = V(0);
        for (let i = 1; i < n && planar; i++) if (Math.abs(V(i).sub(c).dot(N)) > 1e-3) planar = false;
      }
      for (let i = 0; i < n; i++) {
        const t = new THREE.Vector3();
        if (closed || (i > 0 && i < n - 1)) t.subVectors(V(i + 1), V(i - 1));
        else if (i === 0) t.subVectors(V(1), V(0));
        else t.subVectors(V(i), V(i - 1));
        t.normalize();
        let nn;
        if (planar) nn = new THREE.Vector3().crossVectors(N, t).normalize();
        else if (!prevN) {
          nn = Math.abs(t.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
          nn.sub(t.clone().multiplyScalar(nn.dot(t))).normalize();
        } else
          nn = prevN
            .clone()
            .sub(t.clone().multiplyScalar(prevN.dot(t)))
            .normalize();
        prevN = nn;
        const bn = new THREE.Vector3().crossVectors(t, nn);
        // 轉角處的截面放大（斜接），保持管壁厚度
        let k = 1;
        if (closed || (i > 0 && i < n - 1)) {
          const a = V(i)
              .sub(V(i - 1))
              .normalize(),
            b = V(i + 1)
              .sub(V(i))
              .normalize();
          k = 1 / Math.max(0.5, Math.sqrt((1 + a.dot(b)) / 2));
        }
        frames.push({ p: V(i), nn, bn, k });
      }
      const ring = (i, j) => {
        const f = frames[i % n],
          [sx, sy] = sec[j % sec.length];
        return [
          f.p.x + (f.nn.x * sy + f.bn.x * sx) * f.k,
          f.p.y + (f.nn.y * sy + f.bn.y * sx) * f.k,
          f.p.z + (f.nn.z * sy + f.bn.z * sx) * f.k,
        ];
      };
      // 沿長度的 u（米）、沿截面周長的 v
      const rows = closed ? n + 1 : n;
      const U = [0];
      for (let i = 1; i < rows; i++) U.push(U[i - 1] + frames[i % n].p.distanceTo(frames[i - 1].p));
      const ns = sec.length;
      const Vv = [0];
      for (let j = 1; j <= ns; j++)
        Vv.push(Vv[j - 1] + Math.hypot(sec[j % ns][0] - sec[j - 1][0], sec[j % ns][1] - sec[j - 1][1]));
      // 截面的方向：第一格的法線要朝外（離開路徑），否則整個翻面
      const a0 = ring(0, 0),
        b0 = ring(1, 0),
        c0 = ring(1, 1);
      _v.set(b0[0] - a0[0], b0[1] - a0[1], b0[2] - a0[2]);
      _w.set(c0[0] - a0[0], c0[1] - a0[1], c0[2] - a0[2]);
      _n.crossVectors(_v, _w);
      const mid = [
        (a0[0] + c0[0]) / 2 - frames[0].p.x,
        (a0[1] + c0[1]) / 2 - frames[0].p.y,
        (a0[2] + c0[2]) / 2 - frames[0].p.z,
      ];
      const flip = _n.x * mid[0] + _n.y * mid[1] + _n.z * mid[2] < 0;
      const pos = [],
        uv = [];
      const tri = (A, B, C2, ua, ub, uc) => {
        if (flip) {
          pos.push(...A, ...C2, ...B);
          uv.push(...ua, ...uc, ...ub);
        } else {
          pos.push(...A, ...B, ...C2);
          uv.push(...ua, ...ub, ...uc);
        }
      };
      for (let i = 0; i < rows - 1; i++)
        for (let j = 0; j < ns; j++) {
          const A = ring(i, j),
            B = ring(i + 1, j),
            C2 = ring(i + 1, j + 1),
            E = ring(i, j + 1);
          const ua = [U[i], Vv[j]],
            ub = [U[i + 1], Vv[j]],
            uc = [U[i + 1], Vv[j + 1]],
            ue = [U[i], Vv[j + 1]];
          tri(A, B, C2, ua, ub, uc);
          tri(A, C2, E, ua, uc, ue);
        }
      if (caps && !closed)
        for (const [i, sgn] of [
          [0, -1],
          [n - 1, 1],
        ]) {
          const c = frames[i].p;
          for (let j = 0; j < ns; j++) {
            const a = ring(i, j),
              b = ring(i, j + 1);
            // 封口：朝外＝沿路徑的方向（頭端往後、尾端往前）
            const t = frames[i].nn.clone().cross(frames[i].bn).multiplyScalar(sgn);
            _v.set(a[0] - c.x, a[1] - c.y, a[2] - c.z);
            _w.set(b[0] - c.x, b[1] - c.y, b[2] - c.z);
            const o = _v.clone().cross(_w).dot(t) >= 0;
            if (o) pos.push(c.x, c.y, c.z, ...a, ...b);
            else pos.push(c.x, c.y, c.z, ...b, ...a);
            uv.push(0, 0, 0, 0, 0, 0);
          }
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      return g;
    });
  },
  // 圓形截面（sweep 用）
  ring(r, n = 8) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
  },
  // 兩點之間下垂的纜線（sag＝中間往下幾米）
  cable(a, b, r = 0.03, sag = 0.2, segs = 6) {
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      pts.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t),
        a[2] + (b[2] - a[2]) * t,
      ]);
    }
    return D.sweep(pts, D.ring(r, 5));
  },
  // 輪胎（軸沿 X、置中）：R 外徑、w 寬、胎紋 lugs 塊（0＝光面）、深 depth
  tire(R, w, lugs = 20, depth = 0.05, seg = 0) {
    return cached(key('tire', [R, w, lugs, depth, seg]), () => {
      const hw = w / 2,
        rin = R * 0.62;
      // 截面（x 寬、r 半徑）：內側胎壁 → 胎肩 → 胎面 → 胎肩 → 外側胎壁
      const prof = [
        [-hw * 0.92, rin],
        [-hw, R * 0.8],
        [-hw * 0.96, R - depth * 1.4],
        [-hw * 0.72, R],
        [hw * 0.72, R],
        [hw * 0.96, R - depth * 1.4],
        [hw, R * 0.8],
        [hw * 0.92, rin],
      ];
      const N = lugs > 0 ? lugs * 2 : seg || 20;
      // 胎紋：胎面的點在溝的位置往內縮（左右兩排錯開，像越野胎）
      const bump =
        lugs > 0 ? (i, j) => ((i === 3 || i === 4) && (j + (i === 3 ? 0 : 1)) % 2 === 1 ? -depth : 0) : null;
      // 剖面依 s（沿軸）由內側往外側走，外面（胎面）在右手邊
      return fromTris(revolve(prof, N, 'x', 0, Math.PI * 2, bump));
    });
  },
  // 輪框（軸沿 X、置中、面朝 +X）：R 半徑、w 寬、輻條 n、螺帽 nuts（0＝沒有）
  rim(R, w, n = 6, nuts = 6) {
    return cached(key('rim', [R, w, n, nuts]), () => {
      const hw = w / 2;
      const parts = [];
      // 碗形的輪框（剖面旋轉後轉成沿 X）
      const lath = D.lathe(
        [
          [R, -hw],
          [R * 0.98, hw * 0.6],
          [R * 0.86, hw * 0.75],
          [R * 0.45, hw * 0.55],
          [R * 0.3, hw * 0.85],
          [R * 0.18, hw * 0.95],
          [0, hw * 0.95],
        ],
        Math.max(12, n * 3),
      );
      parts.push([lath, new THREE.Matrix4().makeRotationZ(-HP)]);
      // 輻條之間的開孔用暗色的凹塊表示（另一個材質由呼叫端畫）；這裡加螺帽
      for (let i = 0; i < nuts; i++) {
        const a = (i / nuts) * Math.PI * 2;
        const nut = D.cyl(R * 0.05, R * 0.05, R * 0.06, 6);
        parts.push([
          nut,
          new THREE.Matrix4()
            .makeRotationZ(-HP)
            .setPosition(hw * 0.95 + R * 0.02, Math.cos(a) * R * 0.24, Math.sin(a) * R * 0.24),
        ]);
      }
      return mergeRaw(parts);
    });
  },
  // 齒輪（驅動輪；軸沿 X、置中）：R 外徑、teeth 齒、w 寬
  gear(R, teeth, w, inner = 0.82) {
    const pts = [];
    for (let i = 0; i < teeth * 2; i++) {
      const a0 = (i / (teeth * 2)) * Math.PI * 2,
        a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
      const r = i % 2 ? R * inner : R;
      pts.push(
        [Math.cos(a0 + 0.08) * r, Math.sin(a0 + 0.08) * r],
        [Math.cos(a1 - 0.08) * r, Math.sin(a1 - 0.08) * r],
      );
    }
    return cached(key('gear', [R, teeth, w, inner]), () =>
      rotGeo(D.extrude(pts, w, Math.min(w * 0.15, R * 0.05)), 0, HP, 0),
    );
  },
  // 旋翼葉片（從原點往 +X 長 len）：根部寬 w0、尖端寬 w1、厚 t、扭轉 tw（弧度）
  blade(len, w0, w1, t = 0.04, tw = 0.25, n = 4) {
    return cached(key('blade', [len, w0, w1, t, tw, n]), () => {
      const pos = [];
      const sec = (i) => {
        const u = i / n,
          x = len * (0.08 + 0.92 * u),
          w = w0 + (w1 - w0) * u,
          a = tw * (1 - u);
        const c = Math.cos(a),
          s = Math.sin(a);
        // 翼型：前緣厚、後緣薄的四邊形
        return [
          [-w * 0.35, t * 0.5],
          [w * 0.65, t * 0.15],
          [w * 0.65, -t * 0.15],
          [-w * 0.35, -t * 0.5],
        ].map(([z, y]) => [x, y * c - z * s, z * c + y * s]);
      };
      const S = [];
      for (let i = 0; i <= n; i++) S.push(sec(i));
      gridTris(n + 1, 4, (i, j) => S[i][j], true, pos);
      for (const [i, s] of [
        [0, -1],
        [n, 1],
      ]) {
        const q = S[i];
        if (s > 0) pos.push(...q[0], ...q[1], ...q[2], ...q[0], ...q[2], ...q[3]);
        else pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
      }
      // 方向：以這個 x 的截面中心為準朝外
      for (let i = 0; i < pos.length; i += 9) {
        const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3;
        const u = Math.max(0, Math.min(1, (cx / len - 0.08) / 0.92));
        const k = Math.round(u * n);
        let cy = 0,
          cz = 0;
        for (const q of S[k]) ((cy += q[1] / 4), (cz += q[2] / 4));
        const t = pos.slice(i, i + 9);
        outward(t, cx, cy, cz);
        for (let q = 0; q < 9; q++) pos[i + q] = t[q];
      }
      return fromTris(pos);
    });
  },
  // 雜訊岩石（中心在原點、半徑約 1，呼叫端縮放）：seed 決定形狀，flat＝底部壓平，strata＝層理（0～1）
  rock(seed = 1, detail = 2, rough = 0.35, flat = 0.4, strata = 0.3) {
    return cached(key('rock', [seed, detail, rough, flat, strata]), () => {
      const g = new THREE.IcosahedronGeometry(1, detail);
      const p = g.attributes.position;
      const noise = valueNoise(seed);
      for (let i = 0; i < p.count; i++) {
        _v.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
        let d = 0,
          amp = 1,
          fq = 1.3;
        for (let o = 0; o < 4; o++) {
          d += amp * noise(_v.x * fq + seed, _v.y * fq, _v.z * fq - seed);
          amp *= 0.5;
          fq *= 2.1;
        }
        let r = 1 + d * rough;
        // 大的切面：把幾個方向削平
        for (let k = 0; k < 3; k++) {
          const a = seed * 1.7 + k * 2.1;
          _w.set(Math.cos(a), 0.35 * Math.sin(a * 1.3), Math.sin(a)).normalize();
          const dot = _v.dot(_w);
          if (dot > 0.62) r = Math.min(r, 0.9 / Math.max(0.6, dot));
        }
        _v.multiplyScalar(r);
        if (strata > 0) {
          const L = 0.22;
          const yq = Math.round(_v.y / L) * L;
          _v.y += (yq - _v.y) * strata;
        }
        if (_v.y < -flat) _v.y = -flat + (_v.y + flat) * 0.15;
        p.setXYZ(i, _v.x, _v.y, _v.z);
      }
      return nonIdx(g);
    });
  },
};
function flipIfIn(p, i, c) {
  const ax = p.getX(i),
    ay = p.getY(i),
    az = p.getZ(i);
  const ux = p.getX(i + 1) - ax,
    uy = p.getY(i + 1) - ay,
    uz = p.getZ(i + 1) - az,
    vx = p.getX(i + 2) - ax,
    vy = p.getY(i + 2) - ay,
    vz = p.getZ(i + 2) - az;
  const nx = uy * vz - uz * vy,
    ny = uz * vx - ux * vz,
    nz = ux * vy - uy * vx;
  const mx = (ax + p.getX(i + 1) + p.getX(i + 2)) / 3 - c.x,
    my = (ay + p.getY(i + 1) + p.getY(i + 2)) / 3 - c.y,
    mz = (az + p.getZ(i + 1) + p.getZ(i + 2)) / 3 - c.z;
  if (nx * mx + ny * my + nz * mz < 0) {
    const x = p.getX(i + 1),
      y = p.getY(i + 1),
      z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
}
export function rotGeo(g, rx, ry, rz) {
  const o = g.clone();
  o.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  return o;
}
// [幾何, 矩陣] 的清單合併成一個沒有索引的幾何（只合併 position／normal／uv）
export function mergeRaw(parts) {
  let n = 0;
  for (const [g] of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2);
  let o = 0;
  for (const [g0, mm] of parts) {
    const g = nonIdx(g0);
    const p = g.attributes.position,
      nn = g.attributes.normal,
      u = g.attributes.uv;
    _m3.getNormalMatrix(mm);
    const flip = mm.determinant() < 0;
    for (let i = 0; i < p.count; i++) {
      const j = flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i;
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(mm);
      pos.set([_v.x, _v.y, _v.z], (o + j) * 3);
      _v.set(nn.getX(i), nn.getY(i), nn.getZ(i)).applyMatrix3(_m3).normalize();
      nor.set([_v.x, _v.y, _v.z], (o + j) * 3);
      uv.set([u.getX(i), u.getY(i)], (o + j) * 2);
    }
    o += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// 以種子決定的 3D 值雜訊（-1～1）
function valueNoise(seed) {
  const h = (x, y, z) => {
    let n = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 144269504) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    n = n ^ (n >>> 16);
    return ((n & 0xffff) / 0xffff) * 2 - 1;
  };
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x),
      yi = Math.floor(y),
      zi = Math.floor(z);
    const xf = s(x - xi),
      yf = s(y - yi),
      zf = s(z - zi);
    const L = (a, b, t) => a + (b - a) * t;
    return L(
      L(L(h(xi, yi, zi), h(xi + 1, yi, zi), xf), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf),
      L(
        L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf),
        L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf),
        yf,
      ),
      zf,
    );
  };
}

// ---------- 基本形體的自動升級 ----------
// 精細版合併時把舊的基本形體換成精細的：方塊（最短邊 ≥ 0.12 m）→ 倒角方塊、圓柱（半徑 ≥ 0.12 m、段數不夠）→
// 段數加倍＋頂底倒角、球（半徑 ≥ 0.15 m）→ 段數加倍。尺寸以 mm 的縮放換算成實際大小。回傳 [幾何, 矩陣]
const _t = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _s = new THREE.Vector3();
export function upgradeGeo(geo, mm, k = 1) {
  const P = geo.parameters;
  if (!P) return [geo, mm];
  const t = geo.userData.ptype || geo.type;
  if (t === 'BoxGeometry') {
    mm.decompose(_t, _q, _s);
    const w = P.width * Math.abs(_s.x),
      h = P.height * Math.abs(_s.y),
      d = P.depth * Math.abs(_s.z);
    const m = Math.min(w, h, d) * k;
    if (m < 0.12 || mm.determinant() < 0) return [geo, mm];
    const c = Math.max(0.012, Math.min(0.06, m * 0.12));
    return [D.box(w, h, d, c), new THREE.Matrix4().compose(_t, _q, _s.set(1, 1, 1))];
  }
  if (t === 'CylinderGeometry') {
    if (P.openEnded || Math.abs(P.thetaLength - Math.PI * 2) > 1e-4) return [geo, mm];
    mm.decompose(_t, _q, _s);
    const sr = Math.max(Math.abs(_s.x), Math.abs(_s.z)),
      r = Math.max(P.radiusTop, P.radiusBottom) * sr * k;
    if (r < 0.12) return [geo, mm];
    const seg = r >= 0.6 ? 24 : r >= 0.3 ? 18 : 14;
    if (P.radialSegments >= seg) return [geo, mm];
    const h = P.height * Math.abs(_s.y);
    const c = h > 0.08 ? Math.min(0.04, r * 0.08, h * 0.2) / Math.abs(_s.y || 1) : 0;
    return [D.cyl(P.radiusTop, P.radiusBottom, P.height, seg, c), mm];
  }
  if (t === 'SphereGeometry') {
    mm.decompose(_t, _q, _s);
    const r = P.radius * Math.max(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z)) * k;
    if (r < 0.15 || P.widthSegments >= 16) return [geo, mm];
    const seg = r >= 0.6 ? 20 : 16;
    return [
      cached(key('sph', [P.radius, seg]), () => nonIdx(new THREE.SphereGeometry(P.radius, seg, seg >> 1))),
      mm,
    ];
  }
  return [geo, mm];
}

// ---------- 頂點色烘焙 ----------
// list：[{ geo, mm, wm?, col? }]（同一個合併網格的零件，mm＝到合併後座標的矩陣、col＝一起烘進去的顏色）；ctx：整個模型共用的遮蔽資料
// （tintCtx 建立，所有零件的外框都在裡面，不同材質的零件也互相遮蔽）。回傳合併後的幾何（含 color）。
// opts：{ ao 遮蔽強度（預設 0.55）, wear 凸邊變亮（0.16）, grime 貼地髒污（0.22）, gh 髒污的高度（1.2 m）, y0 地面高度 }
export function tintCtx(all, opts = {}) {
  // all：[{ geo, mm }]（整個模型的零件）；外框在合併後的座標
  const boxes = [];
  let y0 = Infinity,
    y1 = -Infinity;
  for (const it of all) {
    const g = it.geo;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox.clone().applyMatrix4(it.mm);
    it._box = b;
    boxes.push(b);
    y0 = Math.min(y0, b.min.y);
    y1 = Math.max(y1, b.max.y);
  }
  const ctx = Object.assign({ ao: 0.55, wear: 0.16, grime: 0.22, gh: Math.min(1.2, (y1 - y0) * 0.4) }, opts);
  ctx.boxes = boxes;
  if (ctx.y0 === undefined) ctx.y0 = y0;
  // 每個外框的遮蔽半徑：第二大的邊的一半（細長的零件不會遮蔽太遠），限制在 0.08～1.5 m
  ctx.rad = boxes.map((b) => {
    const s = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z].sort((a, c) => a - c);
    return Math.max(0.08, Math.min(1.5, s[1] * 0.5));
  });
  // 空間格子：每格列出碰得到的外框（加上遮蔽半徑）
  const cell = 1.5;
  ctx.cell = cell;
  ctx.grid = new Map();
  boxes.forEach((b, i) => {
    const r = ctx.rad[i];
    for (let x = Math.floor((b.min.x - r) / cell); x <= Math.floor((b.max.x + r) / cell); x++)
      for (let y = Math.floor((b.min.y - r) / cell); y <= Math.floor((b.max.y + r) / cell); y++)
        for (let z = Math.floor((b.min.z - r) / cell); z <= Math.floor((b.max.z + r) / cell); z++) {
          const k = x + ',' + y + ',' + z;
          let a = ctx.grid.get(k);
          if (!a) ctx.grid.set(k, (a = []));
          a.push(i);
        }
  });
  ctx.index = new Map(all.map((it, i) => [it, i]));
  return ctx;
}
const _cp = new THREE.Vector3();
function occlusion(ctx, self, p, n) {
  const a = ctx.grid.get(
    Math.floor(p.x / ctx.cell) + ',' + Math.floor(p.y / ctx.cell) + ',' + Math.floor(p.z / ctx.cell),
  );
  if (!a) return 0;
  let occ = 0;
  for (const i of a) {
    if (i === self) continue;
    const b = ctx.boxes[i],
      r = ctx.rad[i];
    b.clampPoint(p, _cp);
    _cp.sub(p);
    const d = _cp.length();
    if (d >= r) continue;
    let nd;
    if (d < 1e-4) {
      // 在外框上或裡面（插進別的零件）：縫隙
      nd = 0.7;
    } else nd = n.dot(_cp) / d;
    if (nd <= -0.2) continue;
    const f = 1 - d / r;
    occ += f * f * (0.35 + 0.65 * Math.max(0, nd));
  }
  return occ;
}
// 一個零件的凸邊（磨損）：同一個零件裡位置相同、法線差超過 25° 的面，對面在自己的平面後方＝凸邊
function edgeWear(pos, nor, n) {
  const map = new Map();
  const q = (i) =>
    Math.round(pos[i * 3] * 500) +
    ',' +
    Math.round(pos[i * 3 + 1] * 500) +
    ',' +
    Math.round(pos[i * 3 + 2] * 500);
  for (let i = 0; i < n; i++) {
    const k = q(i);
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  }
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = map.get(q(i));
    if (a.length < 2) continue;
    const t = i - (i % 3);
    for (const j of a) {
      if (j - (j % 3) === t) continue;
      const dot = nor[i * 3] * nor[j * 3] + nor[i * 3 + 1] * nor[j * 3 + 1] + nor[i * 3 + 2] * nor[j * 3 + 2];
      if (dot > 0.9) continue;
      // 對面三角形的中心在這個面的後方＝凸
      const tj = j - (j % 3);
      const cx = (pos[tj * 3] + pos[tj * 3 + 3] + pos[tj * 3 + 6]) / 3 - pos[i * 3],
        cy = (pos[tj * 3 + 1] + pos[tj * 3 + 4] + pos[tj * 3 + 7]) / 3 - pos[i * 3 + 1],
        cz = (pos[tj * 3 + 2] + pos[tj * 3 + 5] + pos[tj * 3 + 8]) / 3 - pos[i * 3 + 2];
      if (cx * nor[i * 3] + cy * nor[i * 3 + 1] + cz * nor[i * 3 + 2] < -1e-4) {
        w[i] = 1;
        break;
      }
    }
  }
  return w;
}
// 合併並烘焙頂點色（list 的零件都在 ctx 裡）；outline＝另外產生描邊用的 onormal
export function tintMerge(list, ctx, outline = false) {
  let n = 0;
  for (const it of list) n += nonIdx(it.geo).attributes.position.count;
  const pos = new Float32Array(n * 3),
    nor = new Float32Array(n * 3),
    uv = new Float32Array(n * 2),
    col = new Float32Array(n * 3);
  let o = 0;
  for (const it of list) {
    const g = nonIdx(it.geo);
    const p = g.attributes.position,
      nn = g.attributes.normal,
      u = g.attributes.uv;
    _m3.getNormalMatrix(it.mm);
    const flip = it.mm.determinant() < 0;
    const self = ctx.index.has(it) ? ctx.index.get(it) : -1;
    const c0 = o;
    for (let i = 0; i < p.count; i++) {
      const j = o + (flip ? (i % 3 === 1 ? i + 1 : i % 3 === 2 ? i - 1 : i) : i);
      _v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(it.mm);
      pos[j * 3] = _v.x;
      pos[j * 3 + 1] = _v.y;
      pos[j * 3 + 2] = _v.z;
      _n.set(nn.getX(i), nn.getY(i), nn.getZ(i)).applyMatrix3(_m3).normalize();
      nor[j * 3] = _n.x;
      nor[j * 3 + 1] = _n.y;
      nor[j * 3 + 2] = _n.z;
      if (u) {
        uv[j * 2] = u.getX(i);
        uv[j * 2 + 1] = u.getY(i);
      }
    }
    // 遮蔽、髒污、凸邊
    const cnt = p.count;
    const wear =
      ctx.wear > 0 && cnt < 6000 ? edgeWear(pos.subarray(c0 * 3), nor.subarray(c0 * 3), cnt) : null;
    // wm：零件到遮蔽資料（ctx）座標的矩陣（合併的網格在子群組裡時和 mm 不同）
    const W =
      it.wm && it.wm !== it.mm
        ? new THREE.Matrix4().multiplyMatrices(it.wm, new THREE.Matrix4().copy(it.mm).invert())
        : null;
    const WN = W ? new THREE.Matrix3().getNormalMatrix(W) : null;
    for (let i = 0; i < cnt; i++) {
      const j = c0 + i;
      _v.set(pos[j * 3], pos[j * 3 + 1], pos[j * 3 + 2]);
      _n.set(nor[j * 3], nor[j * 3 + 1], nor[j * 3 + 2]);
      if (W) {
        _v.applyMatrix4(W);
        _n.applyMatrix3(WN).normalize();
      }
      const occ = ctx.ao > 0 ? occlusion(ctx, self, _v, _n) : 0;
      let k = 1 - Math.min(0.7, occ * ctx.ao);
      if (ctx.grime > 0) {
        const t = Math.max(0, Math.min(1, (_v.y - ctx.y0) / ctx.gh));
        k *= 1 - ctx.grime * (1 - t * t * (3 - 2 * t));
        // 朝下的面暗一點（地面反光少）
        if (_n.y < -0.5) k *= 0.85;
      }
      if (wear && wear[i]) k *= 1 + ctx.wear;
      if (it.col) {
        // 材質的顏色也烘進頂點色（同類的材質合併成一個網格時）
        col[j * 3] = k * it.col.r;
        col[j * 3 + 1] = k * it.col.g;
        col[j * 3 + 2] = k * it.col.b;
      } else col[j * 3] = col[j * 3 + 1] = col[j * 3 + 2] = k;
    }
    o += cnt;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (outline) g.setAttribute('onormal', smoothNormals(pos, nor));
  return g;
}
export function smoothNormals(pos, nor) {
  const map = new Map();
  const sm = new Float32Array(pos.length);
  const k = (i) => pos[i].toFixed(3) + ',' + pos[i + 1].toFixed(3) + ',' + pos[i + 2].toFixed(3);
  for (let i = 0; i < pos.length; i += 3) {
    const kk = k(i);
    const e = map.get(kk) || [0, 0, 0];
    e[0] += nor[i];
    e[1] += nor[i + 1];
    e[2] += nor[i + 2];
    map.set(kk, e);
  }
  for (let i = 0; i < pos.length; i += 3) {
    const e = map.get(k(i));
    const L = Math.hypot(e[0], e[1], e[2]) || 1;
    sm[i] = e[0] / L;
    sm[i + 1] = e[1] / L;
    sm[i + 2] = e[2] / L;
  }
  return new THREE.BufferAttribute(sm, 3);
}
// 開了 vertexColors 的材質複本：顏色、自發光與原材質共用同一個物件，透明度等跟著原材質（遮擋淡出改的是原材質）
const VC = new WeakMap();
export function vcMat(m) {
  if (m.vertexColors) return m;
  let t = VC.get(m);
  if (t) return t;
  t = m.clone();
  t.vertexColors = true;
  t.color = m.color;
  if (m.emissive) t.emissive = m.emissive;
  for (const p of ['opacity', 'transparent', 'depthWrite', 'visible', 'emissiveIntensity'])
    Object.defineProperty(t, p, {
      get: () => m[p],
      set: (v) => {
        m[p] = v;
      },
      configurable: true,
    });
  t.userData.vcOf = m;
  VC.set(m, t);
  return t;
}

// ---------- 小細節分級 ----------
// 小零件的網格登記在這裡（不放 userData：合併網格的工具看到 userData 就不合併），fineTick 依鏡頭距離切換顯示
const FINE = new Map();
let fineN = 0;
export const FINE_DIST = 70; // 公尺
export function fineReg(mesh, dist = FINE_DIST) {
  mesh.castShadow = false;
  FINE.set(mesh, dist);
}
export const isFine = (mesh) => FINE.has(mesh);
// 同類材質的合併（地圖物件的 PK.tint）：沒有貼圖、不發光、正面、不透明度 1 的標準材質，依粗糙度與金屬感分成 3×3 類，
// 顏色烘進頂點色；回傳類別的鍵（null＝不能合併，照原本的材質）
const bin = (v) => (v < 0.35 ? 0 : v < 0.65 ? 1 : 2);
export function matClass(m) {
  if (!m.isMeshStandardMaterial || m.map || m.normalMap || m.side !== THREE.FrontSide || m.alphaTest > 0)
    return null;
  if (m.depthWrite === false || m.polygonOffset || m.opacity < 1) return null;
  if (m.emissive && (m.emissive.r > 0.01 || m.emissive.g > 0.01 || m.emissive.b > 0.01)) return null;
  return bin(m.roughness) * 3 + bin(m.metalness);
}
const CLS = new Map();
const BINV = [0.2, 0.5, 0.82];
// 類別的材質（白色＋頂點色）：可以淡出（fade）的每次建立一份（每個物件各自淡出），其他共用
export function classMat(c, fade) {
  const make = () =>
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: BINV[Math.floor(c / 3)],
      metalness: BINV[c % 3] * 0.8,
      flatShading: true,
      vertexColors: true,
      transparent: !!fade,
    });
  if (fade) return make();
  let m = CLS.get(c);
  if (!m) CLS.set(c, (m = make()));
  return m;
}
const _fp = new THREE.Vector3();
// 每格（renderMain）：用上一格算好的 matrixWorld（不往上更新），k＝距離倍率
export function fineTick(cam, k = 1) {
  if (!FINE.size) return;
  const prune = ++fineN % 120 === 0;
  const cp = cam.position;
  for (const [m, d] of FINE) {
    if (prune) {
      let r = m;
      while (r.parent) r = r.parent;
      if (!r.isScene) {
        // 不在場景裡（模型拿掉了）：不再管它（之後再加進場景也只是一直顯示）
        FINE.delete(m);
        m.visible = true;
        continue;
      }
    }
    _fp.setFromMatrixPosition(m.matrixWorld);
    m.visible = _fp.distanceToSquared(cp) < (d * k) ** 2;
  }
}
export const fineCount = () => FINE.size;
