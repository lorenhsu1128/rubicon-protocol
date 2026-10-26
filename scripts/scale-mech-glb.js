// 機甲 GLB 與關節設定整體放大（機甲三倍高改版：內建預設機甲從 3.24 m 換成 9.72 m）
// node scripts/scale-mech-glb.js <資料夾或 .glb …> [--k=3]
//   GLB：POSITION 的頂點與所有節點的位移乘 k（等比，不改旋轉與縮放；不支援 Draco／量化壓縮）
//   joints.json：每個連接點的 p 乘 k（r 是角度，不變）
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const K = +(args.find((a) => a.startsWith('--k=')) || '--k=3').slice(4);
const files = [];
const walk = (p) => {
  if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) walk(path.join(p, f));
  else if (/\.glb$/i.test(p) || path.basename(p) === 'joints.json') files.push(p);
};
for (const a of args.filter((a) => !a.startsWith('--'))) walk(a);

function scaleGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(file + '：不是 GLB');
  const jl = b.readUInt32LE(12);
  const J = JSON.parse(b.slice(20, 20 + jl).toString());
  if ((J.extensionsUsed || []).some((e) => /draco|meshopt|quantiz/i.test(e)))
    throw new Error(file + '：壓縮過的 GLB');
  const binOff = 20 + jl + 8;
  const bin = b.slice(binOff, binOff + b.readUInt32LE(20 + jl));
  const done = new Set();
  for (const m of J.meshes || [])
    for (const p of m.primitives) {
      const ids = [p.attributes.POSITION, ...(p.targets || []).map((t) => t.POSITION)].filter(
        (i) => i !== undefined,
      );
      for (const ai of ids) {
        if (done.has(ai)) continue;
        done.add(ai);
        const a = J.accessors[ai];
        if (a.componentType !== 5126 || a.normalized || a.sparse)
          throw new Error(file + '：POSITION 不是 float');
        const bv = J.bufferViews[a.bufferView];
        const stride = bv.byteStride || 12;
        const base = (bv.byteOffset || 0) + (a.byteOffset || 0);
        for (let i = 0; i < a.count; i++)
          for (let c = 0; c < 3; c++) {
            const o = base + i * stride + c * 4;
            bin.writeFloatLE(bin.readFloatLE(o) * K, o);
          }
        if (a.min) a.min = a.min.map((v) => v * K);
        if (a.max) a.max = a.max.map((v) => v * K);
      }
    }
  for (const n of J.nodes || []) {
    if (n.translation) n.translation = n.translation.map((v) => v * K);
    if (n.matrix) for (const i of [12, 13, 14]) n.matrix[i] *= K;
  }
  let js = Buffer.from(JSON.stringify(J));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = b.slice(20 + jl);
  const out = Buffer.alloc(20 + js.length + rest.length);
  b.copy(out, 0, 0, 12);
  out.writeUInt32LE(out.length, 8);
  out.writeUInt32LE(js.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  js.copy(out, 20);
  rest.copy(out, 20 + js.length);
  fs.writeFileSync(file, out);
}
function scaleJoints(file) {
  const J = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const slot of Object.values(J))
    for (const c of Object.values(slot))
      if (c && Array.isArray(c.p)) c.p = c.p.map((v) => Math.round(v * K * 1e4) / 1e4);
  fs.writeFileSync(file, JSON.stringify(J, null, 1) + '\n');
}
for (const f of files) (f.endsWith('.json') ? scaleJoints : scaleGlb)(f);
console.log(`放大 ${K} 倍：${files.length} 個檔案`);
