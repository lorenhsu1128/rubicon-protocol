// 機體包：組裝調整頁畫面上的這一台機甲（.rubicon-set，格式和模型組檔相同，manifest 多了 mech）
// - 匯出：這台機甲用到的區塊槽位裡、目前模型組自己的 GLB（含原始檔）、這些槽位的關節設定、零件組合，
//   參考圖可選；manifest.mech.slots 記錄全部用到的槽位（沒有 GLB 的是程式模型或內建模型）
// - 匯入：建立新模型組（同零件不同外觀的機甲可以並存），或合併到目前模型組（先列出會改到的槽位確認）
import { packSetData, unpackSet } from '../render/set-pack.js';
import { fileName } from './model-sets.js';
import { RefStore } from './ref-tools.js';

const rightOf = (slot) => {
  const m = /^((?:weapon|back)\/[^/]+)\/l$/.exec(slot);
  return m ? m[1] + '/r' : null;
};
const sameBuf = (a, b) => {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};
const sameJson = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});

export async function exportMech(ws, withRefs) {
  const store = ws.store;
  const name = document.getElementById('wsPresetName').value.trim() || '機甲';
  const slots = new Set(ws.mechSlots());
  const recs = new Map();
  for (const slot of [...slots]) {
    if (ws.srcOff.has(slot)) continue; // 畫面上切成程式模型的區塊
    const src = store.source(slot);
    if (src.kind !== 'glb' || src.origin !== 'browser') continue;
    // 左側武器暫用右側的 GLB：連右側一起帶上
    const id = src.fallback ? rightOf(slot) : slot;
    slots.add(id);
    const r = store.local.get(id);
    if (r) recs.set(id, r);
  }
  const joints = {};
  for (const slot of slots) if (store.joints[slot]) joints[slot] = store.joints[slot];
  const blob = packSetData({
    name,
    asm: ws.asm,
    recs: [...recs.values()],
    joints,
    refs: withRefs ? await RefStore.get(store.cur) : null,
    mechs: [{ name, asm: ws.asm }],
    mech: { name, slots: [...slots] },
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName(name);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  const nj = Object.values(joints).reduce((n, c) => n + Object.keys(c).length, 0);
  ws.toast(`已匯出機甲「${name}」（GLB ${recs.size} 個、關節設定 ${nj} 個${withRefs ? '、含參考圖' : ''}）`);
  return { name, glb: recs.size, joints: nj };
}

// mode：'new' 建立新模型組；'merge' 合併到目前模型組
export async function importMech(ws, file, mode) {
  const store = ws.store;
  let data;
  try {
    data = await unpackSet(await file.arrayBuffer());
  } catch (e) {
    return ws.toast(`無法匯入 ${file.name}：${e.message || e}`, true);
  }
  const name = (data.mech && data.mech.name) || data.name;
  const asm = data.asm || (data.mechs[0] && data.mechs[0].asm) || null;
  const mechs = data.mechs.length ? data.mechs : asm ? [{ name, asm }] : [];
  const skipped = data.skipped.length ? `，略過 ${data.skipped.length} 個：${data.skipped.join('、')}` : '';
  if (mode !== 'merge') {
    const s = await store.createSet(name, { ...data, asm, mechs });
    if (data.refs) await RefStore.put(s.id, data.refs);
    store.view(s.id);
    ws.onSets(`已匯入機甲「${name}」成新的模型組「${s.name}」（GLB ${data.recs.length} 個${skipped}）`);
    return s;
  }
  // 合併：機體包有 slots 時，這些槽位整個換成包裡的內容（沒有 GLB 的改回內建／程式模型、關節設定照包裡的）；
  // 舊版的模型組檔沒有 slots，只寫入包裡有的
  const own = (slot) => {
    const r = store.local.get(slot);
    return r && r.set === store.cur ? r : null;
  };
  const pack = new Map(data.recs.map((r) => [r.id, r]));
  const slots = data.mech ? data.mech.slots : [...new Set([...pack.keys(), ...Object.keys(data.joints)])];
  const glbOps = [],
    jointSlots = [],
    lines = [];
  for (const slot of slots) {
    const r = pack.get(slot),
      cur = own(slot);
    if (r && !(cur && sameBuf(cur.buf, r.buf))) {
      glbOps.push({ slot, r });
      if (cur) lines.push(`覆蓋 GLB：${slot}`);
    } else if (!r && cur && data.mech) {
      glbOps.push({ slot, r: null });
      lines.push(`移除 GLB（改回內建或程式模型）：${slot}`);
    }
    const want = data.joints[slot];
    if (!sameJson(want, store.joints[slot]) && (want || data.mech)) {
      jointSlots.push(slot);
      if (store.joints[slot]) lines.push(`取代關節設定：${slot}`);
    }
  }
  const target = store.curSet().name + (store.isServer() ? '（寫到伺服器）' : '');
  if (
    lines.length &&
    !confirm(
      `把機甲「${name}」合併到模型組「${target}」，會改掉這些槽位：\n` +
        lines.slice(0, 30).join('\n') +
        (lines.length > 30 ? `\n…還有 ${lines.length - 30} 項` : ''),
    )
  )
    return null;
  for (const { slot, r } of glbOps)
    if (r) await store.putBuf(slot, r.name, r.buf, r.orig || null);
    else await store.remove(slot);
  for (const slot of jointSlots) {
    const want = data.joints[slot] || {};
    for (const n of new Set([...Object.keys(want), ...Object.keys(store.joints[slot] || {})]))
      await store.setJoint(slot, n, want[n] || null);
  }
  for (const m of mechs) await store.putMech(m.name, m.asm);
  if (asm) await store.setAsm(asm);
  ws.onSets(
    `已把機甲「${name}」合併到模型組「${store.curSet().name}」（GLB ${glbOps.filter((o) => o.r).length} 個、` +
      `關節設定 ${jointSlots.length} 個槽位${skipped}）`,
  );
  return store.curSet();
}
