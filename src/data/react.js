// 遠程射擊改版第 4 期「屬性反應」（docs/ranged-design.md）：換武器輪流打，鼓勵帶不同屬性的武器搭配。
// 玩家操作的機體的攻擊（射擊與近戰）在 RX.WIN 秒內以「先 A 後 B」打中同一個目標 → 觸發反應；Boss 的效果減半。
// 純資料；判定在 entities/mech-react.js。
export const RX = {
  WIN: 3, // 前一個屬性留在目標上幾秒
  CD: 1.5, // 觸發後同一個目標多久不再觸發
  BOSS: 0.5, // Boss 的效果倍率
  HOT_T: 4, // 過熱裝甲：秒數
  HOT_K: 1.2, //  受到的傷害倍率
  BURST_HP: 0.08, // 破甲爆裂：目標 AP 上限的比例（上限 BURST_MAX）
  BURST_MAX: 1600,
  BURST_IMP: 700,
  BURST_R: 5, //  爆炸範圍（× dk），附近的敵人一起受傷
  JAM_T: 1.5, // EMP 干擾：不能開火、QB、突擊推進的秒數
};

// [先打的屬性, 後打的屬性] → 反應
export const REACTIONS = {
  'en>kin': { id: 'hot', name: '過熱裝甲', color: '#ff9a40', desc: '4 秒內受到的傷害 ×1.2' },
  'kin>exp': { id: 'burst', name: '破甲爆裂', color: '#ffd040', desc: '額外一次爆炸，衝擊大' },
  'exp>en': { id: 'jam', name: 'EMP 干擾', color: '#7fc8ff', desc: '1.5 秒不能開火與 QB' },
};

export function reactionOf(prev, cur) {
  return REACTIONS[prev + '>' + cur] || null;
}

// 機甲庫的武器說明：這把武器（屬性 a）能接的搭配
export function comboText(a, names) {
  const out = [];
  for (const k in REACTIONS) {
    const [p, c] = k.split('>');
    const r = REACTIONS[k];
    if (p === a) out.push(`先用這把再接${names[c]}＝${r.name}`);
    else if (c === a) out.push(`先用${names[p]}再接這把＝${r.name}`);
  }
  return out;
}
