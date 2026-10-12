import { directOf, weaponAttr } from './attrs.js';
// 理論火力（機甲庫與靶場顯示用，純函式）：照 MechEntity 的開火方式換算
// burst＝彈匣打完前（或 EN 用完前）的 DPS、sus＝算進換彈／EN 回復的持續 DPS、imp＝每秒衝擊（持續）
// d 是套用駕駛員加成後的武器定義（data/pilot.js 的 pilotWeaponDef），gen 是發電機（recharge：每秒 EN 回復）
const LASER_EN = 60; // 雷射每發的 EN（mech-entity.js 的 useEn）
const GROUND_EN = 1.6; // 站在地面時 EN 回復 ×1.6（射擊時多半在地面）
const MELEE_GAP = 0.35; // 近戰連段之間的空檔

export function weaponDps(d, gen, enWpn = 0) {
  const v = weaponDps0(d, gen, enWpn);
  if (!v) return null;
  const attr = weaponAttr(d);
  const k = attr === 'en' ? (gen && gen.enAdapt) || 1 : 1; // 能量武器適性
  return {
    ...v,
    attr,
    burst: v.burst * k,
    sus: v.sus * k,
    charge: (v.charge || 0) * k,
    direct: directOf(d),
    ideal: d.ideal || 0,
  };
}
function weaponDps0(d, gen, enWpn = 0) {
  if (!d || ['none', 'shield', 'emp'].includes(d.type)) return null;
  const rch = ((gen && gen.recharge) || 0) * GROUND_EN;
  if (d.type === 'melee') {
    const c = d.combo || [];
    const dur = c.reduce((a, s) => a + s.dur, 0) + MELEE_GAP;
    const dmg = c.reduce((a, s) => a + s.dmg, 0),
      imp = c.reduce((a, s) => a + s.impact, 0);
    return { burst: dmg / dur, sus: dmg / dur, imp: imp / dur, note: '整套連段' };
  }
  if (d.type === 'empbeam') {
    // 持續光束：EN 用完過載，要等 EN 回滿
    const cap = (gen && gen.cap) || 1000;
    const run = cap / d.enPerSec,
      rec = cap / Math.max(1, rch);
    const k = run / (run + rec);
    return { burst: d.dmg, sus: d.dmg * k, imp: d.impact * k, note: `連續 ${run.toFixed(1)} 秒後過載` };
  }
  if (d.type === 'laser') {
    const burst = d.dmg / d.rof;
    const enRate = (LASER_EN * (1 - enWpn)) / d.rof;
    const k = Math.min(1, rch / Math.max(1, enRate));
    const charge = d.chargeDmg && d.chargeT ? d.chargeDmg / (d.chargeT + d.rof * 1.6) : 0;
    return {
      burst,
      sus: burst * k,
      imp: (d.impact / d.rof) * k,
      charge,
      note: k < 1 ? 'EN 回復跟不上連射' : '',
    };
  }
  if (d.enShot) {
    // 能量霰彈：不用彈藥、每發耗 EN
    const per = d.dmg * (d.pellets || 1);
    const burst = per / d.rof;
    const k = Math.min(1, rch / Math.max(1, (d.enShot * (1 - enWpn)) / d.rof));
    return { burst, sus: burst * k, imp: ((d.impact * (d.pellets || 1)) / d.rof) * k, note: '' };
  }
  const n = (d.pellets || 1) * (d.count || 1);
  const per = d.dmg * n,
    ip = d.impact * n;
  const burst = per / d.rof;
  const mag = d.mag < 99 ? d.mag : 0;
  const cycle = mag ? mag * d.rof + d.reload : d.rof;
  const k = mag ? (mag * d.rof) / cycle : 1;
  return {
    burst,
    sus: burst * k,
    imp: (ip / d.rof) * k,
    note: mag ? `彈匣 ${mag} 發、換彈 ${d.reload.toFixed(1)} 秒` : '',
  };
}

// 有效 AP：防禦換算進去的 AP（受到 1 點傷害實際扣 1−def）
export function effectiveAp(ap, def) {
  return ap / Math.max(0.05, 1 - (def || 0));
}
