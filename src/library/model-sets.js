// 模型組：機甲區塊與武器的 GLB、關節設定、建議零件組合各模型組一份（資料見 store.js）
// - 模型庫上方的「模型組」選單：切換、新增空白、複製目前、改名、刪除、匯出／匯入
// - 匯出成單一檔案（.rubicon-set，內容是不壓縮的 zip）：manifest.json ＋ joints.json ＋ models/<槽位>.glb
//   （＋ orig/<槽位>.glb：GLB 編輯器保留的原始檔），可以備份、分享，或在 file:// 與伺服器網址之間搬移
import { escHtml } from '../core/html.js';
import { packSetData, unpackSet } from '../render/set-pack.js';
import { RefStore } from './ref-tools.js';

const $ = (id) => document.getElementById(id);

// 打包模型組 → Blob（含參考圖）
export async function packSet(store, id) {
  const s = store.sets.get(id);
  return packSetData({
    name: s ? s.name : '模型組',
    asm: (s && s.asm) || null,
    mechs: store.mechsOf(id),
    recs: store.setRecs(id),
    joints: store.jointsBy[id] || {},
    refs: await RefStore.get(id),
  });
}

export const fileName = (name) =>
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
      if (store.isServer()) return this.toast('伺服器預設組不能刪除', true);
      if (store.localSetCount() < 2) return this.toast('至少要保留一個模型組', true);
      const st = store.setStats(s.id);
      if (!confirm(`刪除模型組「${s.name}」？（GLB ${st.glb} 個、關節設定 ${st.joints} 個，無法復原）`))
        return;
      await store.deleteSet(s.id);
      RefStore.remove(s.id);
      this.changed(`已刪除模型組「${s.name}」，目前是「${store.curSet().name}」`);
    };
    $('setPublish').onclick = () => this.publish();
    $('setSrvReload').onclick = async () => {
      try {
        await store.loadServer();
      } catch (e) {
        return this.toast('讀不到伺服器模型組：' + (e.message || e), true);
      }
      this.changed('已重新讀取伺服器預設組');
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
        const srv = store.isServer(s.id);
        return (
          `<button data-set="${escHtml(s.id)}" class="${s.id === store.cur ? 'sel' : ''}${srv ? ' srv' : ''}">` +
          `<b>${escHtml(s.name)}</b><span class="dim">${
            srv && !store.serverLoaded ? '在伺服器上（點選讀取）' : `GLB ${st.glb}・關節 ${st.joints}`
          }</span></button>`
        );
      })
      .join('');
    const srvCur = store.isServer();
    $('setName').value = cur.name;
    $('setRename').disabled = srvCur;
    $('setDel').disabled = srvCur || store.localSetCount() < 2;
    $('setPublish').hidden = !store.server || srvCur;
    $('setSrvReload').hidden = !srvCur;
    $('setMenu').classList.toggle('srvCur', srvCur);
  }
  changed(msg) {
    this.render();
    if (this.onSwitch) this.onSwitch();
    if (msg) this.toast(msg);
  }
  async switchTo(id) {
    try {
      await this.store.useSet(id);
    } catch (e) {
      return this.toast('讀不到伺服器模型組：' + (e.message || e), true);
    }
    this.changed(
      `已切換到模型組「${this.store.curSet().name}」` +
        (this.store.isServer() ? '：之後的存檔都直接寫到伺服器' : ''),
    );
  }
  // 整組發佈到伺服器預設組（取代伺服器的機甲區塊、武器與關節設定）
  async publish() {
    const store = this.store;
    const s = store.curSet();
    const st = store.setStats(s.id);
    if (
      !confirm(
        `把模型組「${s.name}」（GLB ${st.glb} 個、關節設定 ${st.joints} 個）發佈到伺服器預設組？\n` +
          '伺服器預設組原本的機甲區塊、武器與關節設定會被取代（載具、地圖物件、小物件保留）。',
      )
    )
      return;
    try {
      const r = await store.publishToServer(s.id);
      this.render();
      this.toast(`已發佈到伺服器預設組（GLB ${r.glb} 個、關節設定 ${r.joints} 個）`);
    } catch (e) {
      this.toast('發佈失敗：' + (e.message || e), true);
    }
  }
  async create(copy) {
    const store = this.store;
    const typed = $('setName').value.trim();
    const cur = store.curSet();
    const name = typed && typed !== cur.name ? typed : copy ? cur.name + ' 複本' : '新模型組';
    const s = copy ? await store.duplicateSet(cur.id, name) : await store.createSet(name, { asm: cur.asm });
    if (copy) await RefStore.copy(cur.id, s.id);
    store.view(s.id);
    this.changed(
      copy ? `已複製成模型組「${s.name}」` : `已新增空白模型組「${s.name}」（零件組合沿用目前的）`,
    );
  }
  async exportSet() {
    const s = this.store.curSet();
    const st = this.store.setStats(s.id);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await packSet(this.store, s.id));
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
    if (data.refs) await RefStore.put(s.id, data.refs);
    this.store.view(s.id);
    const nj = Object.values(data.joints).reduce((n, c) => n + Object.keys(c).length, 0);
    this.changed(
      `已匯入模型組「${s.name}」（GLB ${data.recs.length} 個、關節設定 ${nj} 個` +
        (data.skipped.length ? `，略過 ${data.skipped.length} 個：${data.skipped.join('、')}` : '') +
        '）',
    );
  }
}
