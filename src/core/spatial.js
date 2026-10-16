// 均勻格雜湊（RTS 的空間索引：取代 O(N²) 的推擠與索敵掃描）。
// 物件以 (x, z) 放進邊長 cell 的格子；query 回傳範圍內「可能」的物件（同格與相鄰格），呼叫端自己再精算距離。
// 每個物件的格子記在內部的 Map（不寫進物件本身）；格子陣列重複使用，查詢不配置新物件（out 可以傳入重用）。
export class SpatialHash {
  constructor(cell = 8) {
    this.cell = cell;
    this.inv = 1 / cell;
    this.cells = new Map(); // 格子鍵 → 物件陣列
    this.where = new Map(); // 物件 → 格子鍵
    this.pool = []; // 空掉的陣列（重複使用）
  }
  key(cx, cz) {
    // 兩個 16 位元的格子座標合成一個數字鍵（地圖 ±26 萬格以內）
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }
  keyOf(x, z) {
    return this.key(Math.floor(x * this.inv), Math.floor(z * this.inv));
  }
  insert(obj, x, z) {
    if (this.where.has(obj)) return this.update(obj, x, z);
    const k = this.keyOf(x, z);
    let a = this.cells.get(k);
    if (!a) {
      a = this.pool.pop() || [];
      this.cells.set(k, a);
    }
    a.push(obj);
    this.where.set(obj, k);
  }
  update(obj, x, z) {
    const k0 = this.where.get(obj);
    if (k0 === undefined) return this.insert(obj, x, z);
    const k = this.keyOf(x, z);
    if (k === k0) return;
    this.detach(obj, k0);
    let a = this.cells.get(k);
    if (!a) {
      a = this.pool.pop() || [];
      this.cells.set(k, a);
    }
    a.push(obj);
    this.where.set(obj, k);
  }
  detach(obj, k) {
    const a = this.cells.get(k);
    if (!a) return;
    const i = a.indexOf(obj);
    if (i >= 0) {
      a[i] = a[a.length - 1];
      a.pop();
    }
    if (!a.length) {
      this.cells.delete(k);
      this.pool.push(a);
    }
  }
  remove(obj) {
    const k = this.where.get(obj);
    if (k === undefined) return;
    this.detach(obj, k);
    this.where.delete(obj);
  }
  has(obj) {
    return this.where.has(obj);
  }
  get size() {
    return this.where.size;
  }
  // 半徑 r 內（以格子粗篩：涵蓋圓的外接方形的所有格子）的物件，附加到 out（會先清空）
  query(x, z, r, out = []) {
    out.length = 0;
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv),
      x1 = Math.floor((x + r) * inv),
      z0 = Math.floor((z - r) * inv),
      z1 = Math.floor((z + r) * inv);
    for (let cx = x0; cx <= x1; cx++)
      for (let cz = z0; cz <= z1; cz++) {
        const a = this.cells.get(this.key(cx, cz));
        if (!a) continue;
        for (let i = 0; i < a.length; i++) out.push(a[i]);
      }
    return out;
  }
  clear() {
    for (const a of this.cells.values()) {
      a.length = 0;
      this.pool.push(a);
    }
    this.cells.clear();
    this.where.clear();
  }
}
