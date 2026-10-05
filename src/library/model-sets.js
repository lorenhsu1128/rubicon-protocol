// 模型組：機甲區塊與武器的 GLB、關節設定、建議零件組合各模型組一份（資料見 store.js）
// - 模型庫上方的「模型組」選單：切換、新增空白、複製目前、改名、刪除、匯出／匯入
// - 匯出成單一檔案（.rubicon-set，內容是不壓縮的 zip）：manifest.json ＋ joints.json ＋ models/<槽位>.glb
//   （＋ orig/<槽位>.glb：GLB 編輯器保留的原始檔），可以備份、分享，或在 file:// 與伺服器網址之間搬移
import { escHtml } from '../core/html.js';
import { setScoped } from '../render/local-models.js';
import { makeZip, readZip } from './zip.js';

const $ = (id) => document.getElementById(id);
export const SET_FORMAT = 'rubicon-model-set';
const enc = new TextEncoder(),
  dec = new TextDecoder();

// 打包模型組 → Blob
export function packSet(store, id) {
  const s = store.sets.get(id);
  const files = [];
  const models = [];
  for (const r of store.setRecs(id).sort((a, b) => a.id.localeCompare(b.id))) {
    const m = { slot: r.id, name: r.name, file: `models/${r.id}.glb`, t: r.t };
    files.push({ name: m.file, data: new Uint8Array(r.buf) });
    if (r.orig) {
      m.orig = { name: r.orig.name, file: `orig/${r.id}.glb` };
      files.push({ name: m.orig.file, data: new Uint8Array(r.orig.buf) });
    }
    models.push(m);
  }
  const manifest = {
    format: SET_FORMAT,
    version: 1,
    name: s ? s.name : '模型組',
    exportedAt: new Date().toISOString(),
    asm: (s && s.asm) || null,
    models,
  };
  files.unshift(
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2) + '\n') },
    { name: 'joints.json', data: enc.encode(JSON.stringify(store.jointsBy[id] || {}, null, 2) + '\n') },
  );
  return makeZip(files);
}

const isGlb = (u8) => u8.length >= 12 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'glTF';
const nums = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(+v));
const bufOf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// 解開模型組檔 → { name, asm, recs, joints, skipped }；格式不對時丟出錯誤
export async function unpackSet(buf) {
  const files = await readZip(buf);
  const mf = files.get('manifest.json');
  let manifest = null;
  try {
    manifest = mf && JSON.parse(dec.decode(mf));
  } catch (e) {}
  if (!manifest || manifest.format !== SET_FORMAT || !Array.isArray(manifest.models))
    throw new Error('不是模型組檔（缺少 manifest.json）');
  const skipped = [];
  const recs = [];
  for (const m of manifest.models) {
    const data = m && files.get(m.file);
    if (!m || typeof m.slot !== 'string' || !setScoped(m.slot) || !data || !isGlb(data)) {
      skipped.push((m && m.slot) || '?');
      continue;
    }
    const r = {
      id: m.slot,
      name: String(m.name || m.slot + '.glb'),
      buf: bufOf(data),
      t: +m.t || Date.now(),
    };
    const od = m.orig && files.get(m.orig.file);
    if (od && isGlb(od)) r.orig = { name: String(m.orig.name || 'original.glb'), buf: bufOf(od) };
    recs.push(r);
  }
  const joints = {};
  let raw = {};
  try {
    raw = files.has('joints.json') ? JSON.parse(dec.decode(files.get('joints.json'))) : {};
  } catch (e) {
    skipped.push('joints.json');
  }
  for (const [slot, conns] of Object.entries(raw || {})) {
    if (!conns || typeof conns !== 'object') continue;
    const ok = {};
    for (const [name, v] of Object.entries(conns))
      if (v && nums(v.p) && nums(v.r)) ok[name] = { p: v.p.map(Number), r: v.r.map(Number) };
    if (Object.keys(ok).length) joints[slot] = ok;
  }
  const asm = manifest.asm && typeof manifest.asm === 'object' ? manifest.asm : null;
  return { name: String(manifest.name || '匯入的模型組'), asm, recs, joints, skipped };
}

const fileName = (name) =>
  (String(name)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .trim() || 'model-set') + '.rubicon-set';

// 模型庫上方的模型組選單；onSwitch()：目前模型組換了（切換、刪除、匯入）或內容整組改變
export class SetMenu {
  constructor({ store, toast, onSwitch }) {
    this.store = store;
    this.toast = toast;
    this.onSwitch = onSwitch;
    $('setList').onclick = (e) => {
      const b = e.target.closest('[data-set]');
      if (b && b.dataset.set !== store.cur) this.switchTo(b.dataset.set);
    };
    $('setNew').onclick = () => this.create(false);
    $('setDup').onclick = () => this.create(true);
    $('setRename').onclick = async () => {
      const name = $('setName').value.trim();
      if (!name) return this.toast('請先輸入新的名稱', true);
      const s = await store.renameSet(store.cur, name);
      this.render();
      this.toast(`模型組已改名為「${s.name}」`);
    };
    $('setDel').onclick = async () => {
      const s = store.curSet();
      if (store.sets.size < 2) return this.toast('至少要保留一個模型組', true);
      const st = store.setStats(s.id);
      if (!confirm(`刪除模型組「${s.name}」？（GLB ${st.glb} 個、關節設定 ${st.joints} 個，無法復原）`))
        return;
      await store.deleteSet(s.id);
      this.changed(`已刪除模型組「${s.name}」，目前是「${store.curSet().name}」`);
    };
    $('setExport').onclick = () => this.exportSet();
    $('setImport').onclick = () => $('setImportFile').click();
    $('setImportFile').onchange = async () => {
      const f = $('setImportFile').files[0];
      $('setImportFile').value = '';
      if (f) await this.importSet(f);
    };
    this.render();
  }
  render() {
    const store = this.store;
    const cur = store.curSet();
    $('setCur').textContent = cur.name;
    $('setList').innerHTML = store
      .setList()
      .map((s) => {
        const st = store.setStats(s.id);
        return (
          `<button data-set="${escHtml(s.id)}" class="${s.id === store.cur ? 'sel' : ''}">` +
          `<b>${escHtml(s.name)}</b><span class="dim">GLB ${st.glb}・關節 ${st.joints}</span></button>`
        );
      })
      .join('');
    $('setName').value = cur.name;
    $('setDel').disabled = store.sets.size < 2;
  }
  changed(msg) {
    this.render();
    if (this.onSwitch) this.onSwitch();
    if (msg) this.toast(msg);
  }
  switchTo(id) {
    this.store.view(id);
    this.changed(`已切換到模型組「${this.store.curSet().name}」`);
  }
  async create(copy) {
    const store = this.store;
    const typed = $('setName').value.trim();
    const cur = store.curSet();
    const name = typed && typed !== cur.name ? typed : copy ? cur.name + ' 複本' : '新模型組';
    const s = copy ? await store.duplicateSet(cur.id, name) : await store.createSet(name, { asm: cur.asm });
    store.view(s.id);
    this.changed(
      copy ? `已複製成模型組「${s.name}」` : `已新增空白模型組「${s.name}」（零件組合沿用目前的）`,
    );
  }
  exportSet() {
    const s = this.store.curSet();
    const st = this.store.setStats(s.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(packSet(this.store, s.id));
    a.download = fileName(s.name);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.toast(`已匯出模型組「${s.name}」（GLB ${st.glb} 個、關節設定 ${st.joints} 個）`);
  }
  async importSet(file) {
    let data;
    try {
      data = await unpackSet(await file.arrayBuffer());
    } catch (e) {
      return this.toast(`無法匯入 ${file.name}：${e.message || e}`, true);
    }
    const s = await this.store.createSet(data.name, data);
    this.store.view(s.id);
    const nj = Object.values(data.joints).reduce((n, c) => n + Object.keys(c).length, 0);
    this.changed(
      `已匯入模型組「${s.name}」（GLB ${data.recs.length} 個、關節設定 ${nj} 個` +
        (data.skipped.length ? `，略過 ${data.skipped.length} 個：${data.skipped.join('、')}` : '') +
        '）',
    );
  }
}
