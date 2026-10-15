import { weaponAttr } from './attrs.js';
import { usesAmmo } from './parts.js';
// 主線的戰術模組（docs/campaign-design.md 7.1）：4 家委託方各自的風格，三選一取得，延續到整章結束。
// fx 用駕駛員加成同一套增量表（data/pilot.js 的 computePilotMods／applyPilotStats／pilotWeaponDef 與實體的 pmv），
// 另加主線專用：killHeal（擊破時回復 AP 比例）、airN（空中跳次數），
// 以及改變打法的：killBlast（擊破的敵人爆炸）、killStag（擊破時周圍的敵人失衡）、hitEn（命中回復 EN）、
// qbRam（QB 衝撞）、lastStand（AP 低於 30% 時緊急障壁）。這些的說明用 lbl 產生。
// 等級 lv 1～3：數值 × LV_MUL[lv]；已經有的模組再選一次＝升一級。
// 雙重模組：同時持有 need 裡兩家的模組時才會出現在選項裡。

// 第 13 期起各模組的數值是原本的 1.5 倍（強化要有感）
export const LV_MUL = [0, 1, 1.6, 2.2];
export const MOD_MAX_LV = 3;

export const MODULES = {
  // ---- 卡斯特隆重工：實彈與衝擊 ----
  c_impact: { faction: 'castron', name: '重擊彈頭', desc: '衝擊力', fx: { imp: 0.225 } },
  c_mag: { faction: 'castron', name: '擴充彈匣', desc: '彈匣與攜彈量', fx: { mag: 0.225, ammo: 0.225 } },
  c_reload: { faction: 'castron', name: '快速裝填', desc: '換彈時間', fx: { rld: 0.18 } },
  c_breaker: { faction: 'castron', name: '破甲射擊', desc: '對失衡目標的傷害', fx: { stagDmg: 0.225 } },
  c_power: { faction: 'castron', name: '高壓火藥', desc: '武器傷害', fx: { dmg: 0.105 } },
  c_rifling: { faction: 'castron', name: '穩定膛線', desc: '實彈的理想射程', fx: { ideal: 0.3 } },
  c_chain: {
    faction: 'castron',
    name: '連鎖殉爆',
    desc: '擊破的敵人爆炸、波及周圍',
    fx: { killBlast: 1 },
    lbl: (x) => `擊破的敵人爆炸：傷害＝它的 AP 的 ${Math.round(35 * x)}%、半徑 ${Math.round(6 + x * 2)} m`,
  },
  // ---- 艾瑟立克研究機構：能量 ----
  a_cap: { faction: 'aetheric', name: '高密度電容', desc: 'EN 容量', fx: { enCap: 0.225 } },
  a_amp: { faction: 'aetheric', name: '能量增幅器', desc: '能量武器適性', fx: { enAd: 0.06 } },
  a_recharge: { faction: 'aetheric', name: '回充迴路', desc: 'EN 回復速度', fx: { rch: 0.225 } },
  a_charge: { faction: 'aetheric', name: '瞬間充能', desc: '充能時間', fx: { chg: 0.225 } },
  a_eff: { faction: 'aetheric', name: '能量效率化', desc: '能量武器的 EN 消耗', fx: { enWpn: 0.225 } },
  a_siphon: {
    faction: 'aetheric',
    name: '能量虹吸',
    desc: '命中時回復 EN',
    fx: { hitEn: 1 },
    lbl: (x) => `近戰命中回復 EN ${Math.round(15 * x)}%、射擊命中 ${Math.round(4 * x) / 10}%`,
  },
  a_focus: {
    faction: 'aetheric',
    name: '聚焦透鏡',
    desc: '擴散減少、射程',
    fx: { spread: 0.18, range: 0.09 },
  },
  // ---- 維爾威動態：機動 ----
  v_qb: { faction: 'veerwell', name: '強化推進器', desc: 'QB 推力', fx: { qb: 0.15 } },
  v_qbc: { faction: 'veerwell', name: '節能噴嘴', desc: 'QB 消耗', fx: { qbc: 0.18 } },
  v_speed: { faction: 'veerwell', name: '輕量化框架', desc: '地面速度', fx: { spd: 0.105 } },
  v_jump: { faction: 'veerwell', name: '彈射腳部', desc: '跳躍高度', fx: { jump: 0.225 } },
  v_ram: {
    faction: 'veerwell',
    name: '衝撞推進',
    desc: 'QB 撞上敵人時造成傷害與衝擊',
    fx: { qbRam: 1 },
    lbl: (x) => `QB 撞上敵人：傷害 ${Math.round(600 * x)}、衝擊 ${Math.round(1100 * x)}`,
  },
  v_air: {
    faction: 'veerwell',
    name: '空中機動',
    desc: '空中跳次數 +1（升級不再增加）',
    fx: { airN: 1 },
    flat: true,
  },
  // ---- 聖域互助同盟：防禦與修理 ----
  s_ap: { faction: 'sancta', name: '追加裝甲', desc: 'AP', fx: { ap: 0.12 } },
  s_def: { faction: 'sancta', name: '偏向板', desc: '防禦', fx: { def: 0.045 } },
  s_ward: { faction: 'sancta', name: '能量偏向場', desc: '能量防禦', fx: { defEn: 0.07 } },
  s_plate: { faction: 'sancta', name: '耐爆裝甲', desc: '爆發防禦', fx: { defExp: 0.07 } },
  s_kits: {
    faction: 'sancta',
    name: '修復套件包',
    desc: '修復套件 +1（升級每級 +1）',
    fx: { kits: 1 },
    flat: true,
    step: true,
  },
  s_heal: { faction: 'sancta', name: '回收迴路', desc: '擊破敵人時回復 AP', fx: { killHeal: 0.038 } },
  s_stab: { faction: 'sancta', name: '姿勢穩定器', desc: '姿勢穩定', fx: { stab: 0.15 } },
  s_last: {
    faction: 'sancta',
    name: '緊急障壁',
    desc: 'AP 低於 30% 時無敵並回復',
    fx: { lastStand: 1 },
    lbl: (x) => `AP 低於 30% 時 3 秒無敵並回復 AP ${Math.round(15 * x)}%（冷卻 ${Math.round(60 / x)} 秒）`,
  },
  // ---- 雙重模組 ----
  d_ram: {
    faction: 'duo',
    need: ['castron', 'veerwell'],
    name: '衝鋒火線',
    desc: '衝擊力與 QB 推力',
    fx: { imp: 0.225, qb: 0.12 },
  },
  d_siege: {
    faction: 'duo',
    need: ['castron', 'sancta'],
    name: '重裝砲台',
    desc: '武器傷害與姿勢穩定',
    fx: { dmg: 0.09, stab: 0.18 },
  },
  d_overload: {
    faction: 'duo',
    need: ['aetheric', 'castron'],
    name: '過載射擊',
    desc: '武器傷害與充能時間',
    fx: { dmg: 0.09, chg: 0.18 },
  },
  d_phase: {
    faction: 'duo',
    need: ['aetheric', 'veerwell'],
    name: '相位推進',
    desc: 'EN 回復與 QB 消耗',
    fx: { rch: 0.225, qbc: 0.18 },
  },
  d_barrier: {
    faction: 'duo',
    need: ['aetheric', 'sancta'],
    name: '能量障壁',
    desc: '防禦與 EN 容量',
    fx: { def: 0.045, enCap: 0.18 },
  },
  d_shock: {
    faction: 'duo',
    need: ['castron', 'aetheric'],
    name: '殉爆脈衝',
    desc: '擊破時周圍的敵人失衡',
    fx: { killStag: 1 },
    lbl: (x) => `擊破時 ${Math.round(8 + x * 2)} m 內的敵人（Boss 除外）失衡`,
  },
  d_rescue: {
    faction: 'duo',
    need: ['veerwell', 'sancta'],
    name: '游擊回收',
    desc: '擊破回復 AP 與地面速度',
    fx: { killHeal: 0.03, spd: 0.075 },
  },
};

// 某個模組在 lv 級時的數值（flat：固定數值；step：每級加同樣的數值）
export function modFx(id, lv) {
  const M = MODULES[id];
  if (!M) return {};
  const out = {};
  for (const k in M.fx) out[k] = M.flat ? (M.step ? M.fx[k] * lv : M.fx[k]) : M.fx[k] * LV_MUL[lv];
  return out;
}
// 持有的模組合計成增量表
export function modsPm(list) {
  const pm = {};
  for (const m of list || []) {
    const fx = modFx(m.id, m.lv);
    for (const k in fx) pm[k] = (pm[k] || 0) + fx[k];
  }
  return pm;
}
// ---------- 顯示用的說明 ----------
// 一句白話的效果（三選一的卡片、委託方面板）
export const MOD_TIPS = {
  c_impact: '讓敵人更快失衡',
  c_mag: '彈匣更大、帶更多子彈',
  c_reload: '換彈匣更快',
  c_breaker: '打失衡中的敵人更痛',
  c_power: '射擊武器的傷害提高',
  c_rifling: '實彈武器在更遠的距離也不會掉傷害',
  a_amp: '能量武器的傷害提高（和發電機的能量適性相加）',
  s_ward: '受到的能量攻擊（雷射、光束、能量刀）減少',
  s_plate: '受到的爆發攻擊（爆炸、導彈、衝擊波）減少',
  c_chain: '擊破的敵人會爆炸，波及周圍的敵人',
  a_cap: 'EN 上限提高（QB、懸浮、能量武器都用 EN）',
  a_recharge: 'EN 回復更快',
  a_charge: '需要蓄力的武器蓄得更快',
  a_eff: '雷射類武器耗的 EN 更少',
  a_siphon: '打中敵人會回復 EN（近戰回得多）',
  a_focus: '子彈更集中、射程更遠',
  v_qb: 'QB 衝刺得更遠更快',
  v_qbc: 'QB 耗的 EN 更少',
  v_speed: '地面移動更快',
  v_jump: '跳得更高',
  v_ram: '用 QB 撞敵人會造成傷害並讓它失衡',
  v_air: '空中可以多跳一次',
  s_ap: 'AP 上限提高',
  s_def: '受到的傷害減少',
  s_kits: '多帶修復套件',
  s_heal: '擊破敵人時回復 AP',
  s_stab: '不容易被打到失衡',
  s_last: '快被擊破時自動張開障壁',
  d_ram: '衝擊力與 QB 推力一起提升',
  d_siege: '傷害提高，而且不容易失衡',
  d_overload: '傷害提高，蓄力也更快',
  d_phase: 'EN 回復更快，QB 也更省',
  d_barrier: '減傷，EN 上限也提高',
  d_shock: '擊破敵人時讓周圍的敵人失衡',
  d_rescue: '擊破回復 AP，移動也更快',
};
// 數值的名稱；DOWN 的是「減少」（換彈、充能、消耗、擴散）
const FX_NAMES = {
  imp: '衝擊力',
  mag: '彈匣',
  ammo: '攜彈量',
  rld: '換彈時間',
  stagDmg: '對失衡目標的傷害',
  dmg: '傷害',
  enCap: 'EN 容量',
  rch: 'EN 回復',
  chg: '充能時間',
  enWpn: '雷射的 EN 消耗',
  spread: '擴散',
  range: '射程',
  qb: 'QB 推力',
  qbc: 'QB 消耗',
  spd: '地面速度',
  jump: '跳躍高度',
  ap: 'AP',
  def: '防禦',
  defEn: '能量防禦',
  defExp: '爆發防禦',
  defKin: '實彈防禦',
  enAd: '能量武器適性',
  ideal: '理想射程',
  killHeal: '擊破時回復 AP',
  stab: '姿勢穩定',
  kits: '修復套件',
  airN: '空中跳',
};
const FX_DOWN = new Set(['rld', 'chg', 'enWpn', 'spread', 'qbc']);
function fxVal(k, x) {
  if (k === 'airN' || k === 'kits') return `+${x}`;
  return `${FX_DOWN.has(k) ? '−' : '+'}${Math.max(1, Math.round(x * 100))}%`;
}
// 各數值的文字：['衝擊力 +23%', …]（lbl 的模組回傳一句）
export function modFxText(id, lv) {
  const M = MODULES[id];
  if (!M || lv < 1) return [];
  const fx = modFx(id, lv);
  if (M.lbl) return [M.lbl(Object.values(fx)[0])];
  return Object.entries(fx).map(([k, x]) => `${FX_NAMES[k] || k} ${fxVal(k, x)}`);
}
// 升級的前後比較：['衝擊力 +23% → +37%']
export function modFxCompare(id, lv) {
  const M = MODULES[id];
  if (!M || lv < 2) return modFxText(id, lv);
  if (M.lbl) return [`${modFxText(id, lv)[0]}`, `（Lv${lv - 1}：${modFxText(id, lv - 1)[0]}）`];
  const a = modFx(id, lv - 1),
    b = modFx(id, lv);
  return Object.keys(b).map((k) => `${FX_NAMES[k] || k} ${fxVal(k, a[k])} → ${fxVal(k, b[k])}`);
}
// 持有的模組合計的文字（作戰室、轉場）：數值合計＋改變打法的模組名稱
export function modsSumText(list) {
  const pm = {},
    special = [];
  for (const m of list || []) {
    const M = MODULES[m.id];
    if (!M) continue;
    if (M.lbl) {
      special.push(`${M.name} ${m.lv}`);
      continue;
    }
    const fx = modFx(m.id, m.lv);
    for (const k in fx) pm[k] = (pm[k] || 0) + fx[k];
  }
  return [...Object.entries(pm).map(([k, x]) => `${FX_NAMES[k] || k} ${fxVal(k, x)}`), ...special];
}
// 數值對哪些武器有效（照 data/pilot.js 的 pilotWeaponDef）；沒有列出的＝對機體、一律有效
const FIT = {
  imp: (d) => d.type !== 'melee' && d.impact > 0,
  mag: (d) => usesAmmo(d),
  ammo: (d) => usesAmmo(d),
  rld: (d) => d.type !== 'melee' && d.reload > 0,
  dmg: (d) => d.type !== 'melee' && (d.dmg > 0 || d.chargeDmg > 0),
  chg: (d) => d.chargeT > 0,
  enWpn: (d) => d.type === 'laser' || d.enPerSec > 0 || d.enShot > 0,
  spread: (d) => d.spread > 0,
  range: (d) => d.type !== 'melee' && d.range > 0,
  ideal: (d) => d.ideal > 0,
  enAd: (d) => weaponAttr(d) === 'en',
};
// 這個模組對裝備的武器（defs）有沒有用：null＝和武器無關；否則 { n 有效的把數, total }
export function modFit(id, defs) {
  const M = MODULES[id];
  if (!M) return null;
  const keys = Object.keys(M.fx).filter((k) => FIT[k]);
  if (!keys.length) return null;
  const ws = (defs || []).filter((d) => d && d.type && d.type !== 'none' && d.type !== 'shield');
  return { n: ws.filter((d) => keys.some((k) => FIT[k](d))).length, total: ws.length };
}
// 顯示用：「重擊彈頭 Lv2（衝擊力 +37%）」
export function modLabel(id, lv) {
  const M = MODULES[id];
  if (!M) return id;
  return `${M.name} Lv${lv}（${modFxText(id, lv).join('、')}）`;
}
// 三選一的選項：faction 指定委託方（null＝任意）；已滿級的不出現；持有兩家以上時有機會出現雙重模組
export function modOffer(list, faction, rand, n = 3) {
  const have = new Map((list || []).map((m) => [m.id, m.lv]));
  const facs = new Set((list || []).map((m) => MODULES[m.id] && MODULES[m.id].faction));
  const okLv = (id) => (have.get(id) || 0) < MOD_MAX_LV;
  let pool = Object.keys(MODULES).filter(
    (id) => MODULES[id].faction !== 'duo' && (!faction || MODULES[id].faction === faction) && okLv(id),
  );
  const duos = Object.keys(MODULES).filter(
    (id) => MODULES[id].faction === 'duo' && okLv(id) && MODULES[id].need.every((f) => facs.has(f)),
  );
  const out = [];
  if (duos.length && rand() < 0.35) out.push(duos[Math.floor(rand() * duos.length)]);
  pool = pool.sort(() => rand() - 0.5);
  for (const id of pool) {
    if (out.length >= n) break;
    if (!out.includes(id)) out.push(id);
  }
  return out.map((id) => ({ id, lv: (have.get(id) || 0) + 1 }));
}
