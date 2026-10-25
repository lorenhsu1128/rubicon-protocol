// 依武器種類的射擊動作（機甲動作改版第二期，docs/mech-animation.md）：每發子彈給彈簧一個衝量（手臂上跳、上身後仰、
// 肩上武器後座），連射與重武器另外讓下盤撐住；蓄力武器舉槍後仰、換彈時槍往下翻。
// 手臂與肩上武器的上跳在 IK 瞄準之後才套用（mech-ik.js 讀 rig.an.kk），否則手臂瞄準會把它抵消。
// arm／back＝手臂（肩上武器）上跳的衝量（rad/s）、torso＝上身後仰、brace＝撐住下盤的秒數、jit＝連射時上身震動
export const FIRE = {
  light: { arm: 3.5, torso: 0.5 },
  beam: { arm: 2.5, torso: 0.4 },
  mg: { arm: 1.6, torso: 0.25, brace: 0.25, jit: 1 },
  heavy: { arm: 8, torso: 2.4, brace: 0.35 },
  shell: { arm: 10, torso: 3.5, brace: 0.6 },
  charge: { arm: 9, torso: 3, brace: 0.5 },
  b_missile: { back: 3, torso: 0.6 },
  b_light: { back: 2, torso: 0.3 },
  b_gat: { back: 1.2, torso: 0.2, brace: 0.25, jit: 1 },
  b_cannon: { back: 7, torso: 3, brace: 0.7 },
};
const CANNON = new Set(['bw_lc', 'bw_gr', 'bw_emp_l']);
// 武器定義 → 動作種類（沒有射擊動作的回傳 null：空手、近戰、盾）
export function fireClass(def, back) {
  if (!def) return null;
  const t = def.type;
  if (t === 'none' || t === 'melee' || t === 'shield') return null;
  if (back) {
    if (t === 'missile') return 'b_missile';
    if (CANNON.has(def.id)) return 'b_cannon';
    if (def.id === 'bw_gat') return 'b_gat';
    return 'b_light';
  }
  if (t === 'bullet') return def.rof < 0.06 ? 'mg' : 'light';
  if (t === 'shotgun') return 'heavy';
  if (t === 'shell' || t === 'grenade') return 'shell';
  if (t === 'empbeam' || (t === 'laser' && def.chargeT > 0)) return 'charge';
  if (t === 'laser') return 'beam';
  return 'light';
}
