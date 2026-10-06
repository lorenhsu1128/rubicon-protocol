// 檔案格式：不壓縮的 zip（專案檔）與 PSD（含圖層）。
(function () {
  'use strict';
  const RP = (window.RP = window.RP || {});

  // ---------- zip（只用 store，不壓縮：圖層本身已經是 PNG） ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(data) {
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, data: Uint8Array }] → Blob
  RP.makeZip = function (files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // 檔名是 UTF-8
      local.setUint16(8, 0, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, f.data.length, true);
      local.setUint32(22, f.data.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, f.data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, f.data.length, true);
      cen.setUint32(24, f.data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, name);
      offset += 30 + name.length + f.data.length;
    }
    const cenSize = central.reduce((n, b) => n + b.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  };

  // ArrayBuffer → Map(name → Uint8Array)；只支援不壓縮的項目（本程式存的檔）
  RP.readZip = function (buf) {
    const dv = new DataView(buf);
    let e = buf.byteLength - 22;
    while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('不是 zip 檔');
    const count = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const dec = new TextDecoder();
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 目錄損壞');
      const method = dv.getUint16(p + 10, true);
      const size = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      if (method !== 0) throw new Error(`zip 項目「${name}」有壓縮，不支援`);
      const lNameLen = dv.getUint16(local + 26, true);
      const lExtraLen = dv.getUint16(local + 28, true);
      out.set(name, new Uint8Array(buf, local + 30 + lNameLen + lExtraLen, size));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  };

  // ---------- PSD ----------
  const PSD_BLEND = {
    normal: 'norm',
    multiply: 'mul ',
    screen: 'scrn',
    overlay: 'over',
    softlight: 'sLit',
    hardlight: 'hLit',
    dodge: 'div ',
    burn: 'idiv',
    darken: 'dark',
    lighten: 'lite',
    difference: 'diff',
    exclusion: 'smud',
    add: 'lddg',
    subtract: 'fsub',
    linearburn: 'lbrn',
    hue: 'hue ',
    saturation: 'sat ',
    color: 'colr',
    luminosity: 'lum ',
  };

  class Writer {
    constructor() {
      this.chunks = [];
      this.len = 0;
    }
    bytes(u8) {
      this.chunks.push(u8);
      this.len += u8.length;
    }
    u8(v) {
      this.bytes(new Uint8Array([v & 0xff]));
    }
    u16(v) {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setUint16(0, v);
      this.bytes(b);
    }
    i16(v) {
      const b = new Uint8Array(2);
      new DataView(b.buffer).setInt16(0, v);
      this.bytes(b);
    }
    u32(v) {
      const b = new Uint8Array(4);
      new DataView(b.buffer).setUint32(0, v >>> 0);
      this.bytes(b);
    }
    str(s) {
      this.bytes(new Uint8Array([...s].map((c) => c.charCodeAt(0))));
    }
    // 先寫長度位置，之後回填
    beginLen() {
      const b = new Uint8Array(4);
      this.bytes(b);
      return { b, start: this.len };
    }
    endLen(mark, padTo) {
      let n = this.len - mark.start;
      if (padTo) {
        while (n % padTo) {
          this.u8(0);
          n++;
        }
      }
      new DataView(mark.b.buffer).setUint32(0, n);
    }
    blob() {
      return new Blob(this.chunks, { type: 'image/vnd.adobe.photoshop' });
    }
  }

  // 拆成平面的單一通道（R、G、B、A）
  function planes(px, w, h) {
    const n = w * h;
    const out = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
    for (let i = 0; i < n; i++) {
      out[0][i] = px[i * 4];
      out[1][i] = px[i * 4 + 1];
      out[2][i] = px[i * 4 + 2];
      out[3][i] = px[i * 4 + 3];
    }
    return out;
  }

  // layers：由下往上 [{ name, visible, opacity, blend, lockAlpha, clip, pixels（RGBA 直接 alpha，第 0 列在最上面） }]
  // composite：合成結果（同格式）
  RP.makePSD = function (w, h, layers, composite) {
    const W = new Writer();
    // 檔頭
    W.str('8BPS');
    W.u16(1);
    W.bytes(new Uint8Array(6));
    W.u16(4); // RGBA
    W.u32(h);
    W.u32(w);
    W.u16(8);
    W.u16(3); // RGB
    W.u32(0); // 色彩模式資料
    W.u32(0); // 影像資源
    // 圖層與遮色片
    const lm = W.beginLen();
    const li = W.beginLen();
    W.i16(-layers.length); // 負數：合成影像的第一個 alpha 通道是透明度
    const chanLen = 2 + w * h;
    for (const L of layers) {
      W.u32(0);
      W.u32(0);
      W.u32(h);
      W.u32(w);
      W.u16(4);
      for (const id of [-1, 0, 1, 2]) {
        W.i16(id);
        W.u32(chanLen);
      }
      W.str('8BIM');
      W.str(PSD_BLEND[L.blend] || 'norm');
      W.u8(Math.round(L.opacity * 255));
      W.u8(L.clip ? 1 : 0);
      W.u8((L.lockAlpha ? 1 : 0) | (L.visible ? 0 : 2));
      W.u8(0);
      const extra = W.beginLen();
      W.u32(0); // 圖層遮色片
      W.u32(0); // 混合範圍
      // Pascal 字串（ASCII 名稱，補到 4 的倍數）
      const ascii = [...L.name].map((c) => (c.charCodeAt(0) < 128 ? c : '_')).join('').slice(0, 255);
      W.u8(ascii.length);
      W.str(ascii);
      for (let n = ascii.length + 1; n % 4; n++) W.u8(0);
      // luni：Unicode 名稱（中文名稱用這個）
      W.str('8BIM');
      W.str('luni');
      const lu = W.beginLen();
      W.u32(L.name.length);
      for (let i = 0; i < L.name.length; i++) W.u16(L.name.charCodeAt(i)); // UTF-16
      W.endLen(lu, 4);
      W.endLen(extra);
    }
    // 各圖層的通道資料（不壓縮）
    for (const L of layers) {
      const p = planes(L.pixels, w, h);
      for (const ch of [p[3], p[0], p[1], p[2]]) {
        W.u16(0);
        W.bytes(ch);
      }
    }
    W.endLen(li, 2);
    W.u32(0); // 全域遮色片
    W.endLen(lm);
    // 合成影像
    W.u16(0);
    const c = planes(composite, w, h);
    for (const ch of c) W.bytes(ch);
    return W.blob();
  };
})();
