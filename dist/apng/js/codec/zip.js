// 不壓縮（STORE）的 ZIP：PNG/APNG/WebP 本身已壓縮過，再壓縮沒有意義

import { crc32 } from './png.js';

export class ZipWriter {
  constructor() {
    this.entries = [];
    this.parts = [];
    this.offset = 0;
    const d = new Date();
    this.time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    this.date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  }

  async add(name, blob) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const nameBytes = new TextEncoder().encode(this.unique(name));
    const crc = crc32(data);
    const head = new Uint8Array(30 + nameBytes.length);
    const v = new DataView(head.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 檔名
    v.setUint16(8, 0, true);
    v.setUint16(10, this.time, true);
    v.setUint16(12, this.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, nameBytes.length, true);
    head.set(nameBytes, 30);
    this.entries.push({ nameBytes, crc, size: data.length, offset: this.offset });
    this.parts.push(head, data);
    this.offset += head.length + data.length;
  }

  unique(name) {
    this.used ??= new Set();
    let n = name, i = 2;
    const dot = name.lastIndexOf('.');
    while (this.used.has(n)) n = dot > 0 ? `${name.slice(0, dot)}_${i++}${name.slice(dot)}` : `${name}_${i++}`;
    this.used.add(n);
    return n;
  }

  finish() {
    const central = [];
    let size = 0;
    for (const e of this.entries) {
      const c = new Uint8Array(46 + e.nameBytes.length);
      const v = new DataView(c.buffer);
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0800, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, this.time, true);
      v.setUint16(14, this.date, true);
      v.setUint32(16, e.crc, true);
      v.setUint32(20, e.size, true);
      v.setUint32(24, e.size, true);
      v.setUint16(28, e.nameBytes.length, true);
      v.setUint32(42, e.offset, true);
      c.set(e.nameBytes, 46);
      central.push(c);
      size += c.length;
    }
    const end = new Uint8Array(22);
    const v = new DataView(end.buffer);
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, this.entries.length, true);
    v.setUint16(10, this.entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, this.offset, true);
    return new Blob([...this.parts, ...central, end], { type: 'application/zip' });
  }
}
