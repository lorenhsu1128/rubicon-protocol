// 駕駛員成長：等級、技能配點驗證、加成計算與套用（純函式，房主與客機共用）
import { PARTS } from './parts.js';
import {
  PILOT_MAX_LEVEL,
  PRESET_MAX,
  PROF_BONUS,
  PROF_MAX,
  PROF_THRESH,
  SKILLS,
  SKILL_BY_ID,
  TIER_REQ,
  skillView,
  xpToNext,
} from './skills.js';

export const PILOT_MODES = ['pve', 'pvp'];
export const WEAPON_SLOTS = ['rarm', 'larm', 'rback', 'lback'];
// 可累積熟練度的武器零件（不含空槽）
export const WEAPON_IDS = new Set(
  [...PARTS.arm, ...PARTS.back].filter((p) => p.type !== 'none').map((p) => p.id),
);
export const weaponPart = (id) => PARTS.arm.find((p) => p.id === id) || PARTS.back.find((p) => p.id === id);
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));

// ---------- 等級 ----------
export function levelOf(xp) {
  let L = 1,
    left = Math.max(0, xp || 0);
  while (L < PILOT_MAX_LEVEL && left >= xpToNext(L)) {
    left -= xpToNext(L);
    L++;
  }
  return L;
}
// 目前等級內的進度（滿級時 need 為 0）
export function xpProgress(xp) {
  let L = 1,
    left = Math.max(0, xp || 0);
  while (L < PILOT_MAX_LEVEL && left >= xpToNext(L)) {
    left -= xpToNext(L);
    L++;
  }
  return { level: L, into: L < PILOT_MAX_LEVEL ? left : 0, need: L < PILOT_MAX_LEVEL ? xpToNext(L) : 0 };
}
export const pointsAt = (level) => Math.max(0, level - 1);
export const spentPoints = (skills) => Object.values(skills || {}).reduce((a, r) => a + (r || 0), 0);

// ---------- 配點驗證 ----------
// 同分支中階層低於 tier 的已投點數
function lowerSpent(skills, br, tier) {
  let n = 0;
  for (const s of SKILLS) if (s.br === br && s.tier < tier) n += skills[s.id] || 0;
  return n;
}
// 技能目前是否滿足解鎖條件（不含點數），不滿足時回傳原因
export function gateReason(skills, id) {
  const s = SKILL_BY_ID[id];
  const need = TIER_REQ[s.tier];
  if (lowerSpent(skills, s.br, s.tier) < need) return `本分支前段需投入 ${need} 點`;
  if (s.req && (skills[s.req] || 0) < SKILL_BY_ID[s.req].max) return `需要「${SKILL_BY_ID[s.req].name}」滿級`;
  return '';
}
export function isValidAlloc(skills, level) {
  let total = 0;
  for (const id in skills) {
    const s = SKILL_BY_ID[id],
      r = skills[id];
    if (!s || !Number.isInteger(r) || r < 0 || r > s.max) return false;
    if (!r) continue;
    total += r;
    if (gateReason(skills, id)) return false;
  }
  return total <= pointsAt(level);
}
const withRank = (skills, id, r) => {
  const o = { ...skills };
  if (r > 0) o[id] = r;
  else delete o[id];
  return o;
};
export const canInc = (skills, id, level) =>
  (skills[id] || 0) < SKILL_BY_ID[id].max && isValidAlloc(withRank(skills, id, (skills[id] || 0) + 1), level);
export const canDec = (skills, id, level) =>
  (skills[id] || 0) > 0 && isValidAlloc(withRank(skills, id, skills[id] - 1), level);
export const incSkill = (skills, id) => withRank(skills, id, (skills[id] || 0) + 1);
export const decSkill = (skills, id) => withRank(skills, id, (skills[id] || 0) - 1);

// 修正不合法的配點（技能表改版、等級不足、資料損壞）：先移除解鎖條件不符的技能，再從高階層往回退點
export function sanitizeSkills(skills, level) {
  const out = {};
  for (const id in skills || {}) {
    const s = SKILL_BY_ID[id];
    const r = s ? clampInt(skills[id], 0, s.max) : 0;
    if (r) out[id] = r;
  }
  const dropGated = () => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of SKILLS)
        if (out[s.id] && gateReason(out, s.id)) {
          delete out[s.id];
          changed = true;
        }
    }
  };
  dropGated();
  let over = spentPoints(out) - pointsAt(level);
  for (const s of [...SKILLS].reverse().sort((a, b) => b.tier - a.tier)) {
    while (over > 0 && out[s.id]) {
      out[s.id]--;
      if (!out[s.id]) delete out[s.id];
      over--;
    }
  }
  dropGated();
  return out;
}

// ---------- 熟練度 ----------
// prof 存累積的有效傷害；每 10 點 = 1 熟練度點
export function profLevel(v) {
  const pts = (v || 0) / 10;
  let n = 0;
  for (const t of PROF_THRESH) if (pts >= t) n++;
  return n;
}
export function profProgress(v) {
  const pts = (v || 0) / 10;
  const lv = profLevel(v);
  if (lv >= PROF_MAX) return { lv, into: 0, need: 0 };
  const lo = lv ? PROF_THRESH[lv - 1] : 0;
  return { lv, into: pts - lo, need: PROF_THRESH[lv] - lo };
}

// ---------- 存檔 ----------
const newModePilot = () => ({ xp: 0, skills: {}, prof: {}, presets: Array(PRESET_MAX).fill(null) });
export const newPilot = () => ({ v: 1, pve: newModePilot(), pvp: newModePilot() });
function normalizePreset(p) {
  if (!p || typeof p !== 'object' || !p.asm || typeof p.asm !== 'object') return null;
  return {
    name: String(p.name || '').slice(0, 16),
    asm: { ...p.asm },
    skills: p.skills && typeof p.skills === 'object' ? { ...p.skills } : {},
    t: p.t || 0,
  };
}
// 讀檔時補齊欄位並修正配點；舊存檔沒有 pilot 時從 Lv1 開始
export function normalizePilot(p) {
  if (!p || typeof p !== 'object') return newPilot();
  const out = { v: 1 };
  for (const mode of PILOT_MODES) {
    const m = p[mode] && typeof p[mode] === 'object' ? p[mode] : {};
    const xp = Math.max(0, Number(m.xp) || 0);
    const prof = {};
    for (const id in m.prof || {}) if (WEAPON_IDS.has(id)) prof[id] = Math.max(0, Number(m.prof[id]) || 0);
    const presets = Array.from({ length: PRESET_MAX }, (_, i) =>
      normalizePreset(Array.isArray(m.presets) ? m.presets[i] : null),
    );
    out[mode] = { xp, skills: sanitizeSkills(m.skills, levelOf(xp)), prof, presets };
  }
  return out;
}

// ---------- 網路傳送 ----------
// 客機送給房主：兩種模式的等級、配點，以及目前裝備武器的熟練度等級
export function pilotPayload(save) {
  const out = {};
  for (const mode of PILOT_MODES) {
    const m = save.pilot[mode];
    const pf = {};
    for (const s of WEAPON_SLOTS) {
      const id = save.asm[s];
      if (WEAPON_IDS.has(id)) {
        const lv = profLevel(m.prof[id]);
        if (lv) pf[id] = lv;
      }
    }
    out[mode] = { lv: levelOf(m.xp), s: { ...m.skills }, pf };
  }
  return out;
}
// 房主收到後修正範圍，避免異常資料
export function sanitizePayload(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {};
  for (const mode of PILOT_MODES) {
    const m = p[mode] && typeof p[mode] === 'object' ? p[mode] : {};
    const lv = clampInt(m.lv, 1, PILOT_MAX_LEVEL);
    const pf = {};
    for (const id in m.pf || {}) if (WEAPON_IDS.has(id)) pf[id] = clampInt(m.pf[id], 0, PROF_MAX);
    out[mode] = { lv, s: sanitizeSkills(m.s, lv), pf };
  }
  return out;
}

// ---------- 加成 ----------
// 把配點展開成扁平的增量表 pm（例如 { dmg: 0.06, kits: 1, pf: { w_rifle: 2 } }）
export function computePilotMods(mp, mode) {
  if (!mp) return null;
  const pm = { pf: { ...(mp.pf || {}) } };
  for (const id in mp.s || {}) {
    const s = SKILL_BY_ID[id];
    if (!s) continue;
    const fx = skillView(s, mode).fx;
    for (const k in fx) pm[k] = (pm[k] || 0) + fx[k] * mp.s[id];
  }
  return pm;
}
const upF = (f, k) => 1 + (f[k] || 0);
const downF = (f, k) => Math.max(0.2, 1 - (f[k] || 0));

// 回傳套用技能後的新 stats（parts 內會修改的零件先複製，不動共用的 PARTS 資料）
export function applyPilotStats(st, pm) {
  if (!pm) return st;
  const P = st.parts;
  const parts = {
    ...P,
    legs: { ...P.legs, jumpH: P.legs.jumpH * upF(pm, 'jump'), airH: P.legs.airH * upF(pm, 'jump') },
    booster: { ...P.booster, qb: P.booster.qb * upF(pm, 'qb'), qbCost: P.booster.qbCost * downF(pm, 'qbc') },
    generator: {
      ...P.generator,
      cap: P.generator.cap * upF(pm, 'enCap'),
      recharge: P.generator.recharge * upF(pm, 'rch'),
      delay: P.generator.delay * downF(pm, 'dly'),
    },
  };
  return {
    ...st,
    parts,
    ap: Math.round(st.ap * upF(pm, 'ap')),
    stab: Math.round(st.stab * upF(pm, 'stab')),
    def: Math.min(0.35, st.def + (pm.def || 0)),
    speed: st.speed * upF(pm, 'spd'),
    jump: st.jump * upF(pm, 'jump'),
    enCap: Math.round(st.enCap * upF(pm, 'enCap')),
    lockRange: st.lockRange * upF(pm, 'lock'),
  };
}

// 會影響武器定義的技能效果
const WEAPON_KEYS = [
  'dmg',
  'rld',
  'mag',
  'ammo',
  'turn',
  'spread',
  'pspd',
  'mDmg',
  'mEn',
  'mImp',
  'mRch',
  'chg',
  'enWpn',
];
// 武器熟練度 lv 級的累積加成
export function profBonus(type, lv) {
  const f = {};
  const list = PROF_BONUS[type] || [];
  for (let i = 0; i < Math.min(lv, list.length); i++)
    for (const k in list[i]) f[k] = (f[k] || 0) + list[i][k];
  return f;
}
// 回傳套用技能與熟練度後的武器定義副本；沒有任何加成時回傳原物件
export function pilotWeaponDef(def, pm) {
  if (!pm || !def || def.type === 'none') return def;
  const f = profBonus(def.type, (pm.pf && pm.pf[def.id]) || 0);
  for (const k of WEAPON_KEYS) if (pm[k]) f[k] = (f[k] || 0) + pm[k];
  if (!Object.keys(f).length) return def;
  const d = { ...def };
  if (d.type === 'melee') {
    d.enCost = d.enCost * downF(f, 'mEn');
    d.combo = def.combo.map((st) => ({
      ...st,
      dmg: st.dmg * upF(f, 'mDmg'),
      impact: st.impact * upF(f, 'mImp'),
      reach: st.reach * upF(f, 'mRch'),
    }));
    return d;
  }
  if (d.dmg) d.dmg *= upF(f, 'dmg');
  if (d.chargeDmg) d.chargeDmg *= upF(f, 'dmg');
  if (d.impact) d.impact *= upF(f, 'imp');
  if (d.reload) d.reload *= downF(f, 'rld');
  if (d.rof) d.rof *= downF(f, 'rof');
  if (d.mag && d.mag < 99) {
    d.mag = Math.max(1, Math.round(d.mag * upF(f, 'mag')));
    d.ammo = Math.max(d.mag, Math.round(d.ammo * upF(f, 'ammo')));
  }
  if (d.spread) d.spread *= downF(f, 'spread');
  if (d.speed) d.speed *= upF(f, 'pspd');
  if (d.range) d.range *= upF(f, 'range');
  if (d.turn) d.turn *= upF(f, 'turn');
  if (d.splash) d.splash *= upF(f, 'splash');
  if (d.chargeT) d.chargeT *= downF(f, 'chg');
  if (d.enPerSec) d.enPerSec *= downF(f, 'eps') * downF(f, 'enWpn');
  if (d.radius) d.radius *= upF(f, 'radius');
  if (d.stun) d.stun *= upF(f, 'stun');
  if (d.absorb) d.absorb = Math.min(0.6, d.absorb + (f.absorb || 0));
  return d;
}
