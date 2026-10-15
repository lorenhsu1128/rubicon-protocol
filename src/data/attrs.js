// 武器屬性（第 15 期，照《機戰傭兵6》）：實彈 kin、爆發 exp、能量 en 三種攻擊與三種防禦
// - 防禦：頭、核心、手臂、腳部的 defs＝[實彈, 爆發, 能量] 防禦值，合計後換成減傷 D/(D+DEF_K)
// - 實彈：超過理想射程 ideal 傷害遞減（到最大射程時剩 KIN_FALL_MIN）
// - 爆發：範圍、沒有距離衰減，直擊補正（打失衡中的目標的倍率）最高
// - 能量：傷害依發電機的能量武器適性 enAdapt 浮動
// - 'none'＝沒有屬性（水流、虛空等環境傷害），不看防禦
export const ATTRS = {
  kin: { name: '實彈', short: '實', color: '#e8c070' },
  exp: { name: '爆發', short: '爆', color: '#ff8a50' },
  en: { name: '能量', short: '能', color: '#7fc8ff' },
};
export const ATTR_KEYS = ['kin', 'exp', 'en'];
export const DEF_K = 10000;
export const KIN_FALL_MIN = 0.55;
const TYPE_ATTR = {
  bullet: 'kin',
  shotgun: 'kin',
  melee: 'kin',
  shell: 'exp',
  grenade: 'exp',
  missile: 'exp',
  laser: 'en',
  empbeam: 'en',
  emp: 'en',
};
// 失衡連攜：打出失衡的人改用不同種類的武器打失衡中的目標時，直擊補正再乘這個倍率（mech-entity.js 的 takeDamage）
export const LINK_K = 1.2;
const DIRECT_BASE = { kin: 1.4, exp: 1.8, en: 1.6 };

export function defCut(D) {
  return D > 0 ? D / (D + DEF_K) : 0;
}
export function weaponAttr(d) {
  if (!d) return 'kin';
  return d.attr || TYPE_ATTR[d.type] || 'kin';
}
// 直擊補正：打失衡中的目標的倍率
export function directOf(d) {
  if (!d) return 1.5;
  return d.direct || DIRECT_BASE[weaponAttr(d)] || 1.5;
}
// 實彈的距離衰減（dist＝飛行距離）
export function kinFall(d, dist) {
  if (!d || weaponAttr(d) !== 'kin' || !d.ideal || !d.range || dist <= d.ideal) return 1;
  const k = Math.min(1, (dist - d.ideal) / Math.max(1, d.range - d.ideal));
  return 1 - (1 - KIN_FALL_MIN) * k;
}
// 敵人的弱點文字：res＝[實彈, 爆發, 能量] 的額外減傷（負的＝弱點）
export function weakText(res) {
  if (!res) return '';
  const w = ATTR_KEYS.filter((k, i) => res[i] <= -0.08).map((k) => ATTRS[k].name);
  const s = ATTR_KEYS.filter((k, i) => res[i] >= 0.12).map((k) => ATTRS[k].name);
  return [w.length ? '弱：' + w.join('・') : '', s.length ? '抗：' + s.join('・') : '']
    .filter(Boolean)
    .join('　');
}
