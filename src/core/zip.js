// zip 讀寫：寫入一律不壓縮（PNG／JPG／WebP／GLB 本身已經壓縮過或壓縮效益低）；讀取支援不壓縮與 deflate
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(a) {
  let c = 0xffffffff;
  for (let i = 0; i < a.length; i++) c = CRC[(c ^ a[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// d：檔案時間（預設現在；要讓相同內容產生相同位元組時傳固定日期）
export function makeZip(files, d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const enc = new TextEncoder();
  const parts = [],
    central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const head = (sig, extra) => {
      const b = new Uint8Array(extra + name.length);
      const v = new DataView(b.buffer);
      v.setUint32(0, sig, true);
      return [b, v];
    };
    const [lh, lv] = head(0x04034b50, 30);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // 檔名是 UTF-8
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const [ch, cv] = head(0x02014b50, 46);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, off, true);
    ch.set(name, 46);
    parts.push(lh, f.data);
    central.push(ch);
    off += lh.length + f.data.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, off, true);
  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// 讀取 zip：回傳 Map(檔名 → Uint8Array)；以中央目錄為準（本地標頭的大小可能寫在資料描述區）
export async function readZip(buf) {
  const u8 = new Uint8Array(buf);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let end = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error('不是有效的 zip 檔');
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  const dec = new TextDecoder();
  const out = new Map();
  for (let k = 0; k < count; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('zip 中央目錄損毀');
    const method = v.getUint16(p + 10, true),
      csize = v.getUint32(p + 20, true),
      nlen = v.getUint16(p + 28, true),
      xlen = v.getUint16(p + 30, true),
      clen = v.getUint16(p + 32, true),
      off = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8 && typeof DecompressionStream !== 'undefined') {
      const s = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(s).arrayBuffer()));
    } else throw new Error(`不支援的 zip 壓縮方式（${method}）：${name}`);
  }
  return out;
}
