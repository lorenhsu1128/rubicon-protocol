// 模型組檔（.rubicon-set，不壓縮的 zip）：manifest.json ＋ joints.json ＋ models/<槽位>.glb（＋ orig/<槽位>.glb）
// ＋ refs.json、refs/<front|side>.<副檔名>（模型庫的參考圖與校正值，上傳到伺服器時不含）
// 模型庫匯出／匯入與遊戲上傳到伺服器共用
import { makeZip, readZip } from '../core/zip.js';
import { cleanMechs, setScoped } from './local-models.js';

export const SET_FORMAT = 'rubicon-model-set';
const enc = new TextEncoder(),
  dec = new TextDecoder();
const FIXED_DATE = new Date(1980, 0, 1);

// data：{ name, asm, recs: [{ id, name, buf, t?, orig? }], joints, refs?, mechs?, mech? }（refs 見 library/ref-tools.js）
// mechs：機甲清單；mech：單台機甲的機體包 { name, slots }（slots＝這台機甲用到的所有區塊槽位，
// 沒有 GLB 的是程式模型或內建模型，合併匯入時據此把那些槽位改回來）
// stable：相同內容產生相同位元組（上傳用：不含時間與原始檔，以內容雜湊當檔名）
export function packSetData(data, { stable = false } = {}) {
  const files = [];
  const models = [];
  for (const r of [...data.recs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const m = { slot: r.id, name: r.name, file: `models/${r.id}.glb` };
    if (!stable) m.t = r.t;
    files.push({ name: m.file, data: new Uint8Array(r.buf) });
    if (r.orig && !stable) {
      m.orig = { name: r.orig.name, file: `orig/${r.id}.glb` };
      files.push({ name: m.orig.file, data: new Uint8Array(r.orig.buf) });
    }
    models.push(m);
  }
  const manifest = { format: SET_FORMAT, version: 1, name: data.name || '模型組' };
  if (!stable) manifest.exportedAt = new Date().toISOString();
  manifest.asm = data.asm || null;
  if (data.mech) manifest.mech = { name: data.mech.name, slots: [...data.mech.slots].sort() };
  // 上傳用（stable）不含機甲清單：雜湊只取決於模型與關節設定
  if (!stable && data.mechs && data.mechs.length)
    manifest.mechs = cleanMechs(data.mechs).map((m) => ({ name: m.name, asm: m.asm }));
  manifest.models = models;
  const joints = Object.fromEntries(
    Object.keys(data.joints || {})
      .sort()
      .map((k) => [k, data.joints[k]]),
  );
  const refs = data.refs;
  if (refs && refs.views && !stable) {
    const meta = { height: refs.height || null, opacity: refs.opacity, onTop: !!refs.onTop, views: {} };
    for (const v of ['front', 'side']) {
      const iv = refs.views[v];
      if (!iv || !iv.buf) continue;
      const ext = (String(iv.type).split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '');
      const file = `refs/${v}.${ext}`;
      files.push({ name: file, data: new Uint8Array(iv.buf) });
      meta.views[v] = {
        file,
        type: iv.type,
        w: iv.w,
        h: iv.h,
        top: iv.top,
        bottom: iv.bottom,
        cx: iv.cx,
        flip: !!iv.flip,
      };
    }
    if (Object.keys(meta.views).length)
      files.push({ name: 'refs.json', data: enc.encode(JSON.stringify(meta, null, 2) + '\n') });
  }
  files.unshift(
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2) + '\n') },
    { name: 'joints.json', data: enc.encode(JSON.stringify(joints, null, 2) + '\n') },
  );
  return makeZip(files, stable ? FIXED_DATE : new Date());
}

const isGlb = (u8) => u8.length >= 12 && String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) === 'glTF';
const nums = (a) => Array.isArray(a) && a.length === 3 && a.every((v) => Number.isFinite(+v));
const bufOf = (u8) => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

// 解開模型組檔 → { name, asm, recs, joints, refs, mechs, mech, skipped }；格式不對時丟出錯誤
// anySlot：接受所有分類的槽位（伺服器預設組）；否則只接受機甲區塊與武器
export async function unpackSet(buf, { anySlot = false } = {}) {
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
    const okSlot =
      m && typeof m.slot === 'string' && (anySlot ? /^[\w-]+(\/[\w-]+)+$/.test(m.slot) : setScoped(m.slot));
    if (!okSlot || !data || !isGlb(data)) {
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
  // 參考圖（舊版的檔案沒有）
  let refs = null;
  try {
    const meta = files.has('refs.json') ? JSON.parse(dec.decode(files.get('refs.json'))) : null;
    const num = (v, d) => (Number.isFinite(+v) ? Math.min(1, Math.max(0, +v)) : d);
    if (meta && meta.views)
      for (const v of ['front', 'side']) {
        const m = meta.views[v];
        const d = m && files.get(m.file);
        if (!d || !/^image\//.test(m.type || '')) continue;
        refs = refs || {
          views: {},
          height: +meta.height > 0 ? +meta.height : null,
          opacity: num(meta.opacity, 0.55),
          onTop: !!meta.onTop,
        };
        refs.views[v] = {
          buf: bufOf(d),
          type: m.type,
          w: +m.w || 1,
          h: +m.h || 1,
          top: num(m.top, 0.05),
          bottom: num(m.bottom, 0.95),
          cx: num(m.cx, 0.5),
          flip: !!m.flip,
        };
      }
  } catch (e) {
    skipped.push('refs.json');
  }
  const mm = manifest.mech;
  const mech =
    mm && typeof mm === 'object' && Array.isArray(mm.slots)
      ? {
          name: String(mm.name || manifest.name || '機甲'),
          slots: mm.slots.filter((s) => typeof s === 'string' && setScoped(s)),
        }
      : null;
  return {
    name: String(manifest.name || '匯入的模型組'),
    asm,
    recs,
    joints,
    refs,
    mechs: cleanMechs(manifest.mechs),
    mech,
    skipped,
  };
}
