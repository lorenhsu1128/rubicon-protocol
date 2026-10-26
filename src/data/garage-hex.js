// 機甲庫的六角性能圖（docs/garage-ui.md）：火力、裝甲、機動、EN、穩定、射程，各 0～1，
// 依全部零件的範圍正規化（純函式，範圍第一次呼叫時由 PARTS 算一次）
import { ATTR_KEYS, defCut } from './attrs.js';
import { effectiveAp, weaponDps } from './firepower.js';
import { PARTS, asmStats } from './parts.js';
import { applyPilotStats, pilotWeaponDef } from './pilot.js';

export const HEX_AXES = [
  ['fire', '火力'],
  ['armor', '裝甲'],
  ['mobi', '機動'],
  ['en', 'EN'],
  ['stab', '穩定'],
  ['range', '射程'],
];
const WSLOTS = ['rarm', 'larm', 'rback', 'lback'];
const FRAME = ['head', 'core', 'arms', 'legs'];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ranged = (p) => p && p.range > 0 && !['none', 'shield', 'melee'].includes(p.type);

let B = null;
// 各數值的範圍（量表與規格頁的長條也用）
export function hexBounds() {
  return bounds();
}
function bounds() {
  if (B) return B;
  const gen = PARTS.generator.find((g) => g.id === 'g_std') || PARTS.generator[0];
  const sus = (p) => (weaponDps(p, gen) || { sus: 0 }).sus;
  const best = (cat) => Math.max(...PARTS[cat].map(sus));
  const ext = (cat, f) => {
    const v = PARTS[cat].map(f);
    return [Math.min(...v), Math.max(...v)];
  };
  const sumExt = (f) => FRAME.map((c) => ext(c, f)).reduce((a, [lo, hi]) => [a[0] + lo, a[1] + hi], [0, 0]);
  const ap = sumExt((p) => p.ap);
  const defAvg = (i) => sumExt((p) => (p.defs || [])[i] || 0);
  const dv = [0, 1, 2].map(defAvg);
  const defOf = (k) => dv.reduce((a, r) => a + defCut(r[k]), 0) / 3;
  const legSp = ext('legs', (p) => p.speed),
    thr = ext('booster', (p) => p.thrust);
  const wr = PARTS.arm.concat(PARTS.back).filter(ranged);
  B = {
    fire: [0, best('arm') * 2 + best('back') * 2],
    armor: [effectiveAp(ap[0], defOf(0)), effectiveAp(ap[1], defOf(1))],
    apMax: ap[1],
    speed: [legSp[0] * thr[0] * 0.8, legSp[1] * thr[1] * 1.15],
    qb: ext('booster', (p) => p.qb),
    cap: ext('generator', (p) => p.cap),
    rec: ext('generator', (p) => p.recharge),
    stab: sumExt((p) => p.stab),
    lock: [Math.min(...PARTS.fcs.map((p) => p.range)), Math.max(...PARTS.fcs.map((p) => p.range)) * 1.15],
    wrange: [Math.min(...wr.map((p) => p.range)), Math.max(...wr.map((p) => p.range))],
  };
  return B;
}
const norm = (v, [lo, hi]) => clamp01((v - lo) / Math.max(1e-6, hi - lo));

// asm＝組裝、pm＝駕駛員加成（可以是 null）。回傳 { fire, armor, mobi, en, stab, range }（0～1）與 raw（顯示用的數值）
export function hexScores(asm, pm) {
  const b = bounds();
  const st = asmStats(asm);
  const ef = applyPilotStats(st, pm);
  const gen = ef.parts.generator;
  let sus = 0;
  const rs = [];
  for (const k of WSLOTS) {
    const p = st.parts[k];
    if (!p || p.type === 'none') continue;
    const v = weaponDps(pilotWeaponDef(p, pm), gen, (pm && pm.enWpn) || 0);
    if (v) sus += v.sus;
    if (ranged(p)) rs.push(p.range);
  }
  const eap = effectiveAp(ef.ap, ef.def);
  const qb = ef.parts.booster.qb;
  const enK = st.enOut > 0 ? st.enLoad / st.enOut : 1;
  const wAvg = rs.length ? rs.reduce((a, v) => a + v, 0) / rs.length : 0;
  const raw = {
    fire: sus,
    armor: eap,
    speed: ef.speed,
    qb,
    cap: ef.enCap,
    rec: gen.recharge,
    enK,
    stab: ef.stab,
    lock: ef.lockRange,
    wrange: wAvg,
    defs: ATTR_KEYS.map((k) => ef.defs[k]),
  };
  return {
    fire: norm(sus, b.fire),
    armor: norm(eap, b.armor),
    mobi: (norm(ef.speed, b.speed) + norm(qb, b.qb)) / 2,
    en: clamp01(((norm(ef.enCap, b.cap) + norm(gen.recharge, b.rec)) / 2) * (1 - 0.35 * clamp01(enK))),
    stab: norm(ef.stab, b.stab),
    range: rs.length
      ? (norm(ef.lockRange, b.lock) + norm(wAvg, b.wrange)) / 2
      : norm(ef.lockRange, b.lock) / 2,
    raw,
  };
}
