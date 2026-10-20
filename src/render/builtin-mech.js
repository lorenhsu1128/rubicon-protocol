// 內建的玩家預設機甲：src/assets/player-mech/ 的 GLB 與關節設定（建置時內嵌，virtual:player-mech）。
// - 只給玩家操作的機甲（Game.mechSource 的玩家機甲）：沒有選自己的模型組（本地模型庫／上傳的模型組／
//   有機甲區塊的伺服器預設組）時用它；敵人、友軍、電腦 AC 照舊用程式模型（或伺服器預設組）
// - 每個人的 HTML 都內嵌同一份，所以多人時各端一致
// - 槽位以零件決定（例如 head/h_std），換成其他零件的部位改回程式模型；碰撞與判定一律維持程式模型的數值
import PLAYER_MECH from 'virtual:player-mech';
import { ModelSet } from './net-models.js';
import { parseTemplate } from './local-models.js';

export const BUILTIN_MECH_SET = '@builtin';

class BuiltinMechLib {
  constructor() {
    this.set = null;
    this.loading = null;
    this.error = null;
  }
  has() {
    return Object.keys(PLAYER_MECH.models || {}).length > 0;
  }
  // 解析全部 GLB（只做一次）；回傳模型組或 null
  load() {
    if (this.set || !this.has()) return Promise.resolve(this.set);
    if (!this.loading)
      this.loading = this._load().catch((e) => {
        this.error = e.message || String(e);
        console.warn('內建預設機甲讀取失敗', e);
        return null;
      });
    return this.loading;
  }
  async _load() {
    const set = new ModelSet(BUILTIN_MECH_SET, '內建預設機甲');
    set.joints = PLAYER_MECH.joints || {};
    for (const [slot, bytes] of Object.entries(PLAYER_MECH.models)) {
      try {
        const { root } = await parseTemplate(bytes);
        set.tpls.set(slot, { tpl: root, err: null, name: slot.split('/').pop() + '.glb' });
      } catch (e) {
        set.tpls.set(slot, { tpl: null, err: e.message || String(e), name: slot });
        console.warn('內建預設機甲：' + slot, e);
      }
    }
    this.set = set;
    return set;
  }
  // buildMech 的 opts.source（還沒讀完時為 null＝程式模型）
  source() {
    return this.set;
  }
}

export const BuiltinMech = new BuiltinMechLib();
