// Coral 戰爭（RTS）的靜態平衡分析（docs/rts-design.md 17.5）：純 node，不開瀏覽器、不跑對局。
//   node scripts/rts-balance.js [--faction=castron] [--tier=1|2|3] [--seeds=8] [--themes=wasteland,snow] [--size=400|300]
//                               [--check] [--md] [--json=路徑] [--quiet]
//   npm run balance:rts
// 內容：單兵（EHP、有效 dps、強度 S＝√(EHP×D)、成本效率）、相剋矩陣（Lanchester 平方律＋射程修正）、陣營部隊（開局的兵種比例）、
// 經濟曲線與時間軸（1 秒一步的確定性模擬，照電腦普通難度的流程）、英雄技能的預算、攻城與防禦塔；--check 依 17.5 的範圍檢查，
// 超出時結束碼 1。換算與假設的常數都在 CONST（改了要寫進 docs 的實作紀錄）；KEEP＝檢查過、決定留著的項目（附原因，不算失敗）。
// 冒煙測試 testRtsBalance（scripts/smoke-rts-r6-a.js）以 require 呼叫 run({ check: true })。
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const src = (p) => pathToFileURL(path.join(ROOT, 'src', p)).href;

// ---------- 換算與假設（docs 17.5；改了要記在實作紀錄） ----------
const CONST = {
  CORAL_ORE: 2.5, // 1 Coral＝2.5 礦石
  PARTS_ORE: 4, // 1 零件＝4 礦石
  SPLASH_K: 0.35, // 範圍係數 1 ＋ SPLASH_K × 半徑（上限 SPLASH_MAX）
  SPLASH_MAX: 2.5,
  MELEE_SPLASH: 0.5, // 近戰的 melee.splash 只算 50%（實際範圍內 50% 傷害）
  ARMY_C: 1000, // 相剋與部隊對打的等成本
  RANGE_GAP: 4, // 射程差超過這麼多才算接近的損失
  RANGE_LOSS: 0.3, // 接近時最多損失總血量的 30%
  // 技能的預算
  DENS: 0.04, // 範圍內的目標密度（台／m²）
  N_MAX: 8, // 範圍內最多幾個目標
  TGT_DPS: 15, // 一般單位的 dps（暈眩、射程縮短的等效傷害）
  TGT_HP: 700, // 一般單位的血量（百分比治療、護甲換算）
  TGT_ARMOR: 1, // 一般單位的護甲
  FOCUS_DPS: 60, // 集火一個目標的友軍 dps（易傷類）
  HERO_IN_DPS: 60, // 英雄被集火時受到的 dps（自身減傷）
  // 經濟
  DROP_DELAY: 8, // 維爾威：空投運輸機起飛到地基落地（秒）
  SELF_BUILD_AWAY: 8, // 艾瑟立克（selfBuild）：工人放地基離開採礦的秒數
  BUILD_WALK: 8, // 卡斯特隆、聖域：工人走去工地與回來的秒數（加在建造時間上）
  HAUL_DELAY: 15, // 維爾威：集貨站的入帳延遲（RTS_VEER.haul.t）
  // 聖域的拾荒（估計；報表另列「不含拾荒」）：[起始秒, 每分鐘礦石, 每分鐘零件]
  SALV_ASSUME: [
    [180, 60, 6],
    [480, 150, 15],
  ],
  SIM_T: 1200, // 經濟模擬 20 分鐘
  // 單位本身的主要傷害來自自動施放的技能時，換算成每秒（技能傷害／冷卻；地面、實彈）
  ABIL_DPS: { ab_ram: 90 / 8 },
};

// 檢查過、決定留著的項目（鍵＝檢查項目的 key；值＝原因）。--check 不把它們算成失敗，報表標「留著」。
// R6 A 包兩批調整之後的結果（docs 17.9）；之後要改由使用者決定，不跑勝率對局來決定。
const WHY = {
  r1: 'R1 的 c_mt、c_shield 不動（17.5 規則 2）：兩者的 S／C 差 1.68 倍，同階中位數不可能同時容下；盾牌 MT 的正面大盾不算進 EHP',
  fuse: '融合單位：成本只算材料＋Coral，融合的需求（T2＋培養槽／T3＋研究）、集合與引導（宿主受傷 ×1.25）的時間與風險沒算；第 1 批已降血量 10%',
  air: '空中單位：飛越地形、只有對空打得到，靜態強度不算機動；維爾威 T3 只有突擊機，降價會讓 T3 部隊更強（陣營部隊已經 1.3～1.5）',
  militia:
    '民兵 MT 綁 MT（16.9：每 100 礦石 0.95～1.15），聖域 T1 中位數 ≥ 民兵 ÷ 1.25；卡斯特隆 T1 的中位數（叉架 MT）比 MT 低 30%，兩個範圍不能同時成立',
  colossus: '聖域 T3 只有拼裝巨像（要研究巨像骨架＋零件）；兩批已漲價 21%',
  antiAir:
    '維爾威的空中與對空：聖域、艾瑟立克 T2 以後沒有地面的對空兵種（聖域靠改裝的對空支架、艾瑟立克靠浮游砲），靜態的兵種比例不算改裝與防空塔',
  fuseArmy: '嵌合體（融合）在混合部隊裡照 14.17 的換算；融合的時間與風險沒算',
  salv: 'SALV_ASSUME 在 5 分鐘只多 120 礦石（2%），「不含拾荒」0.78～0.9 與「含拾荒」0.92～1.1 不能同時成立；拾荒的收入在 8 分鐘後才明顯（10 分鐘 +5%）',
  tower:
    '平方律對一座高血量、範圍傷害的塔有利（同成本只有 1～2 台）；卡斯特隆的起重機砲台是基準不動，其他陣營降建築血量兩批也只到約 1.9',
  siege:
    '等成本 1000 的 T2 部隊只有 3～6 台；8 分鐘時的部隊強度約是它的 2～4 倍（經濟表），實際攻城約 30～60 秒；卡斯特隆的主堡是基準不動',
  duel: '單一兵種對單一兵種的等成本平方律：泛用型（各陣營的 MT）沒有 1.5 倍的剋星；技能（盾牆、衝撞、外殼、融合）與改裝不在靜態模型裡',
  noDmg:
    '效果不是直接傷害（治療、護盾、暈眩、護甲、易傷、射程縮短）：17.5 只准改 dmg、coral、cd，每次施放的期望值改不到',
  big: '超出的幅度大於兩批的上限（約 19%）；範圍與機制不能改',
  near: '兩批（−19%）之後只差 2%',
  coral:
    '治療與護盾類（聖域、維爾威、艾瑟立克）的等效血量偏高；只能改 Coral，兩批 −19% 不夠，而且會讓每冷卻秒的期望值更偏',
};
const KEEP = {
  'eff:c_mt': WHY.r1,
  'eff:a_chimera': WHY.fuse,
  'eff:a_proto': WHY.fuse,
  'effFac:veerwell:3': WHY.air,
  'effFac:sancta:1': WHY.militia,
  'effFac:sancta:3': WHY.colossus,
  'army:sancta:veerwell:1': WHY.antiAir,
  'army:sancta:veerwell:2': WHY.antiAir,
  'army:sancta:veerwell:3': WHY.antiAir,
  'army:aetheric:veerwell:3': WHY.antiAir,
  'army:aetheric:sancta:2': WHY.fuseArmy,
  'inc5:sancta': WHY.salv,
  skillCoral: WHY.coral,
  'ult:sk_fortress': WHY.big,
  'ult:sk_carpet': WHY.big,
  'ult:sk_refuge': WHY.noDmg,
  'sk:sk_rain:3': WHY.near,
};
for (const f of ['castron', 'aetheric', 'veerwell', 'sancta']) {
  KEEP['tower:' + f] = WHY.tower;
  for (const g of ['castron', 'aetheric', 'veerwell', 'sancta'])
    if (f !== g) KEEP[`siege:${f}:${g}`] = WHY.siege;
}
for (const k of [
  'counter:c_mt:aetheric counter:c_mt:veerwell counter:c_mt:sancta counter:c_arty:sancta counter:c_heli:veerwell',
  'counter:c_heli:sancta counter:a_blob:castron counter:a_chimera:castron counter:a_chimera:sancta counter:a_bit:castron',
  'counter:a_bit:veerwell counter:a_bit:sancta counter:a_proto:sancta counter:v_mt:castron counter:v_mt:aetheric',
  'counter:v_mt:sancta counter:v_drone:aetheric counter:v_jet:aetheric counter:v_jet:sancta counter:s_militia:castron',
  'counter:s_militia:aetheric counter:s_militia:veerwell counter:s_scav:castron counter:s_scav:aetheric',
  'dominant:c_mt:aetheric dominant:c_stomper:veerwell dominant:a_chimera:castron dominant:a_chimera:veerwell',
  'dominant:a_chimera:sancta dominant:a_bit:castron dominant:a_proto:castron dominant:a_proto:sancta',
  'dominant:v_mt:castron dominant:v_mt:aetheric dominant:v_heli:castron dominant:v_rammer:castron',
  'dominant:s_militia:castron dominant:s_militia:aetheric dominant:s_junk:veerwell',
]
  .join(' ')
  .split(' '))
  KEEP[k] = WHY.duel;
for (const [sk, lvs, why] of [
  ['sk_plate', [1], WHY.noDmg],
  ['sk_mark', [1, 2], WHY.noDmg],
  ['sk_rush', [1, 2, 3], WHY.big],
  ['sk_catalyze', [2, 3], WHY.noDmg],
  ['sk_drop', [1, 2, 3], WHY.noDmg],
  ['sk_jam', [1, 2, 3], WHY.noDmg],
  ['sk_triage', [1, 2, 3], WHY.noDmg],
  ['sk_magnet', [1, 2, 3], WHY.noDmg],
  ['sk_haven', [1, 2, 3], WHY.noDmg],
  ['sk_shove', [1, 2, 3], WHY.big],
  ['sk_refract', [2, 3], WHY.big],
  ['sk_emp', [1, 2, 3], WHY.big],
  ['sk_junk', [3], WHY.big],
  ['sk_homing', [1], WHY.big],
  ['sk_burner', [1, 2, 3], WHY.big],
  ['sk_acid', [1, 2, 3], WHY.big],
])
  for (const l of lvs) KEEP[`sk:${sk}:${l}`] = why;

// ---------- 工具 ----------
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length & 1 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const gmean = (a) => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / Math.max(1, a.length));
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : v);
const fmtT = (s) =>
  Number.isFinite(s) ? Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') : '—';

function parseArgs(argv) {
  const o = {};
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}

// 資料檔要能在純 node 載入（docs 17.1：data/ 不能 import render/）：先掃一遍 import，找出是哪個檔
function renderImports() {
  const seen = new Set(),
    bad = [];
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let txt = '';
    try {
      txt = fs.readFileSync(file, 'utf8');
    } catch (e) {
      return;
    }
    for (const m of txt.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const p = m[1];
      if (!p.startsWith('.')) continue;
      const f = path.resolve(path.dirname(file), p);
      if (/[\\/]render[\\/]/.test(f) || /[\\/]game[\\/]/.test(f) || /[\\/]entities[\\/]/.test(f))
        bad.push(`${path.relative(ROOT, file)} → ${path.relative(ROOT, f)}`);
      else walk(f);
    }
  };
  for (const f of ['rts-units.js', 'rts-combat.js', 'rts-heroes.js', 'rts-ai.js'])
    walk(path.join(ROOT, 'src', 'data', f));
  return bad;
}

async function loadData() {
  const bad = renderImports();
  if (bad.length) throw new Error('資料檔 import 了瀏覽器端的模組（docs 17.1）：\n  ' + bad.join('\n  '));
  // 純 node 載入 ESM 原始碼（package.json 沒有 type: module）：關掉重新解析的警告
  const emit = process.emitWarning;
  process.emitWarning = (w, ...a) =>
    String(w && w.message ? w.message : w).includes('Module type') ? undefined : emit.call(process, w, ...a);
  try {
    const [U, C, H, AI, AE, MAP] = await Promise.all([
      import(src('data/rts-units.js')),
      import(src('data/rts-combat.js')),
      import(src('data/rts-heroes.js')),
      import(src('data/rts-ai.js')),
      import(src('data/rts-aetheric.js')),
      import(src('world/rts-map.js')),
    ]);
    return { U, C, H, AI, AE, MAP };
  } finally {
    process.emitWarning = emit;
  }
}

// ---------- 單兵 ----------
function makeUnits(data) {
  const { U, C, AE } = data;
  const D = U.RTS_DEFS;
  const { armorK, typeK } = C;
  const fuseOf = {};
  for (const r of Object.values(AE.RTS_FUSE || {})) fuseOf[r.to] = r;
  const costOf = (id) => {
    const d = D[id];
    if (fuseOf[id]) {
      const r = fuseOf[id];
      const b = costOf(r.from);
      return { ore: b.ore * r.n, coral: b.coral * r.n + r.coral, parts: b.parts * r.n };
    }
    const c = d.cost || {};
    return { ore: c.ore || 0, coral: c.coral || 0, parts: c.parts || 0 };
  };
  const C1 = (c) => c.ore + CONST.CORAL_ORE * c.coral + CONST.PARTS_ORE * c.parts;
  const splashK = (r, melee) =>
    Math.min(CONST.SPLASH_MAX, 1 + CONST.SPLASH_K * (r || 0) * (melee ? CONST.MELEE_SPLASH : 1));
  // 各開火槽：{ dps, atk, ground, air, sk }（rts.js 的 rtsBaseStats：slotDps 的槽各自、其他槽平分 dps）
  const slotsOf = (d) => {
    const slots = d.melee ? ['melee'] : d.slots || ['rarm'];
    const sd = d.slotDps || {};
    const mainN = slots.filter((s) => !sd[s]).length;
    const out = [];
    for (const s of slots) {
      const dps = sd[s] ? sd[s] : mainN ? (d.dps || 0) / mainN : 0;
      if (!(dps > 0)) continue;
      const aa = (d.slotAa && d.slotAa[s]) || (d.melee ? 'ground' : d.aa) || 'ground';
      const main = !sd[s];
      out.push({
        s,
        dps,
        atk: (d.slotAtk && d.slotAtk[s]) || d.atk || 'kin',
        ground: aa !== 'air',
        air: aa === 'both' || aa === 'air',
        sk: main ? (d.melee ? splashK(d.melee.splash, true) : splashK(d.splash)) : 1,
      });
    }
    for (const ab of d.abil || [])
      if (CONST.ABIL_DPS[ab])
        out.push({ s: ab, dps: CONST.ABIL_DPS[ab], atk: 'kin', ground: true, air: false, sk: 1 });
    return out;
  };
  const info = (id) => {
    const d = D[id];
    const c = costOf(id);
    const sl = slotsOf(d);
    const Dg = sl.filter((s) => s.ground).reduce((a, s) => a + s.dps * s.sk, 0);
    const Da = sl.filter((s) => s.air).reduce((a, s) => a + s.dps * s.sk, 0);
    const ehp = d.hp / armorK(d.armor || 0);
    const Dm = Math.max(Dg, Da); // 對空專精（防空架）以對空的 dps 算
    const S = Math.sqrt(ehp * Dm);
    const cost = C1(c);
    return {
      id,
      name: d.name,
      faction: d.faction,
      tier: d.tier || 1,
      cost,
      c,
      pop: d.pop || 1,
      time: d.time || 0,
      hp: d.hp,
      armor: d.armor || 0,
      arm: d.arm || 'med',
      ehp,
      Dg,
      Da,
      D: Dm,
      S,
      eff: (S / Math.max(1, cost)) * 100,
      perPop: S / (d.pop || 1),
      dHp: Dm / d.hp,
      range: d.range || (d.melee && d.melee.r) || 0,
      speed: d.speed || 6,
      flying: !!d.flying,
      support: !!d.support || !(Dm > 0),
      fused: !!d.fused,
      slots: sl,
    };
  };
  // i 對 j 的每秒傷害（相剋、護甲、打不打得到空中）；single＝不算範圍（打建築）
  const aOf = (i, j, single = false) => {
    let a = 0;
    for (const s of i.slots) {
      if (j.flying ? !s.air : !s.ground) continue;
      a += s.dps * (single ? 1 : s.sk) * typeK(s.atk, j.arm) * armorK(j.armor);
    }
    return a;
  };
  return { info, aOf, costOf, C1, slotsOf, splashK };
}

// 兩支等成本的同種部隊：Lanchester 平方律的優勢（i 的角度）；打不到的組合回傳 null
function duel(i, j, aOf) {
  const ni = CONST.ARMY_C / i.cost,
    nj = CONST.ARMY_C / j.cost;
  const aij = aOf(i, j),
    aji = aOf(j, i);
  if (!(aij > 0) && !(aji > 0)) return null;
  let HPi = ni * i.hp,
    HPj = nj * j.hp;
  // 射程修正：射程長的一方在對方接近的期間先打
  if (i.range > j.range + CONST.RANGE_GAP && aij > 0) {
    const t = (i.range - j.range) / Math.max(1, j.speed);
    HPj -= Math.min(CONST.RANGE_LOSS * HPj, ni * aij * t);
  } else if (j.range > i.range + CONST.RANGE_GAP && aji > 0) {
    const t = (j.range - i.range) / Math.max(1, i.speed);
    HPi -= Math.min(CONST.RANGE_LOSS * HPi, nj * aji * t);
  }
  if (!(aji > 0)) return { adv: Infinity, nohit: 'j' };
  if (!(aij > 0)) return { adv: 0, nohit: 'i' };
  const adv = (ni * aij * HPi) / (nj * aji * HPj);
  // 交換比：輸方全滅、贏方損失 1 − √(1 − 1／adv)
  const w = adv >= 1 ? adv : 1 / adv;
  const loss = 1 - Math.sqrt(Math.max(0, 1 - 1 / w));
  return { adv, xr: 1 / Math.max(1e-6, loss) };
}

// ---------- 陣營部隊（開局的兵種比例） ----------
function armyOf(op, tier, units, data) {
  const mix = tier === 1 ? op.mix : tier === 2 ? op.mix2 || op.mix : op.mix3 || op.mix2 || op.mix;
  const w = {};
  for (const id in mix || {}) {
    const d = data.U.RTS_DEFS[id];
    if (!d || (d.tier || 1) > tier) continue;
    w[id] = (w[id] || 0) + mix[id];
  }
  // 艾瑟立克（14.17）：T2 起實驗體融合成嵌合體（3 隻＝1 隻，留 keep 隻不融合）、T3 有 proto 時嵌合體兩隻一隻原型體
  if (op.fuse && w.a_blob && tier >= 2) {
    const b = w.a_blob;
    const keepK = Math.min(0.5, (op.fuse.keep || 0) / 12); // 留下的比例（一支部隊約 12 隻實驗體時）
    w.a_blob = b * keepK;
    let ch = (b * (1 - keepK)) / 3;
    if (tier >= 3 && op.fuse.proto) {
      w.a_proto = (w.a_proto || 0) + ch / 4;
      ch = ch / 2;
    }
    w.a_chimera = (w.a_chimera || 0) + ch;
  }
  const list = Object.entries(w)
    .filter(([id, x]) => x > 0 && units[id])
    .map(([id, x]) => ({ u: units[id], w: x }));
  const per = list.reduce((s, x) => s + x.w * x.u.cost, 0);
  return list.map((x) => ({ u: x.u, n: (x.w * CONST.ARMY_C) / Math.max(1, per) }));
}
// 混合部隊的戰力 F＝(Σ n_k √(ā_k hp_k))²；ā_k＝對對方組成（依總血量加權）的平均 a
function armyF(A, B, aOf) {
  const hpB = B.reduce((s, x) => s + x.n * x.u.hp, 0) || 1;
  let f = 0;
  for (const x of A) {
    let a = 0;
    for (const y of B) a += aOf(x.u, y.u) * ((y.n * y.u.hp) / hpB);
    f += x.n * Math.sqrt(Math.max(0, a) * x.u.hp);
  }
  return f * f;
}

// ---------- 經濟模擬 ----------
function econSim(fac, data, o = {}) {
  const { U, AI, C, MAP } = data;
  const D = U.RTS_DEFS;
  const F = U.RTS_FACTIONS[fac];
  const op = (AI.RTS_AI_OPENERS[fac] || [])[o.opener || 0];
  const P = AI.RTS_AI_DIFFS[o.diff || 'normal'];
  const ro = AI.RTS_AI_ROLES[fac];
  const G = U.RTS_GATHER;
  const W = D[F.worker];
  const hq0 = D[F.hq];
  const air = !!F.airdrop;
  const self = (id) => !!(D[id] && D[id].selfBuild);
  const salv = !!F.salvage && o.salvage !== false;
  // 主礦到主堡佔地邊緣的距離：地圖的主礦到基地中心（主堡蓋在主礦旁，約 13 m；docs 13.2）
  const dist = o.mineD || 7;
  const trip = W.trip || G.trip;
  const perW = trip / (G.time + G.drop + (2 * dist) / (W.speed || 5.5));
  const mineCap = (G.sat * trip) / G.time; // 一座礦脈同時 sat 個工人採（其他人在路上）
  const st = {
    t: 0,
    ore: U.RTS_START.ore,
    coral: U.RTS_START.coral,
    parts: 0,
    workers: U.RTS_START.workers,
    building: [], // { id, done }
    blds: { [F.hq]: 1 },
    busyW: [], // 離開採礦的工人到這個時間
    army: [],
    armyPop: 0,
    prod: [], // 生產中 { id, done, b }
    heroes: 0,
    tier: 1,
    upg: null,
    res: {},
    resBusy: null,
    log: [],
    inc: [],
    incOre: 0,
    incCoral: 0,
    coralWait: { 2: 0, 3: 0 },
    tierT: { 1: 0 },
    hqs: 1,
    drops: 0,
    bad: [],
  };
  const has = (id) => (st.blds[id] || 0) > 0;
  const pending = (id) => st.building.filter((b) => b.id === id).length;
  const count = (id) => (st.blds[id] || 0) + pending(id);
  const popOf = () => st.workers + st.armyPop + st.heroes * 5 + st.prod.reduce((s, q) => s + (q.pop || 0), 0);
  const cap = () => {
    let c = 0;
    for (const id in st.blds) c += (D[id].popCap || 0) * st.blds[id];
    return Math.min(U.RTS_POP_MAX, c);
  };
  const afford = (c, keep = { ore: 0, coral: 0 }) =>
    st.ore - (c.ore || 0) >= keep.ore - 1e-9 &&
    st.coral - (c.coral || 0) >= keep.coral - 1e-9 &&
    st.parts >= (c.parts || 0);
  const pay = (c) => {
    st.ore -= c.ore || 0;
    st.coral -= c.coral || 0;
    st.parts -= c.parts || 0;
  };
  // 蓋建築（kp＝要讓路的保留資源；開局步驟不讓路）
  const build = (id, why, kp = null) => {
    const d = D[id];
    if (!afford(d.cost, kp || undefined)) return false;
    if (air && st.building.filter((b) => b.t0 > st.t - CONST.DROP_DELAY).length >= 2 + (st.tier - 1))
      return false;
    pay(d.cost);
    const extra = air ? CONST.DROP_DELAY : self(id) ? 0 : 0;
    st.building.push({ id, done: st.t + d.time + extra, t0: st.t });
    if (!air) st.busyW.push(st.t + (self(id) ? CONST.SELF_BUILD_AWAY : d.time + CONST.BUILD_WALK));
    st.log.push(`${fmtT(st.t)} 蓋 ${d.name}${why ? '（' + why + '）' : ''}`);
    return true;
  };
  const trainsAt = (uid) =>
    Object.keys(st.blds).filter((b) => (D[b].trains || []).includes(uid) && st.blds[b]);
  const reqOk = (d) => {
    const r = U.reqOf(d);
    if (!r) return true;
    if (r.tier && st.tier < r.tier) return false;
    for (const b of r.blds || [])
      if (!Object.keys(st.blds).some((h) => st.blds[h] && U.bldSatisfies(h, b))) return false;
    for (const x of r.res || []) if (!st.res[x]) return false;
    return true;
  };
  let si = 0; // 開局步驟
  const expandT = P.expandT * (op.expandK || 1);
  const coralSrc = () => {
    let r = 0;
    for (const id in st.blds) {
      const d = D[id];
      if (d.coralRate) r += d.coralRate * st.blds[id];
    }
    return r;
  };
  const mixNow = () => (st.tier >= 3 ? op.mix3 : st.tier >= 2 ? op.mix2 : op.mix) || op.mix;
  const armyCnt = {};
  const resList = [];
  {
    const cnt = {};
    for (const id of op.research || []) {
      cnt[id] = (cnt[id] || 0) + 1;
      resList.push({ id, lv: cnt[id] });
    }
  }
  const resMax = (id) => {
    if (!P.resMax) return 9;
    if (P.resMax[id] !== undefined) return P.resMax[id];
    if (fac === 'castron') return 0;
    if (id === (op.research || [])[0]) return P.resMax.r_kin || 0;
    if (air && (id === 'r_haul' || id === 'r_lift' || id === 'r_pod')) return 1;
    if (F.salvage && (id === 'r_salv' || id === 'r_stock')) return 1;
    if (F.salvage && (id === 'r_mend' || id === 'r_titan')) return P.resMax.r_arm ? 1 : 0;
    if (id === 'r_bio') return P.resMax.r_arm || 0;
    return 0;
  };
  const RES = U.RTS_DEFS && data.C.RTS_RESEARCH;
  const strength = () => st.army.reduce((s, x) => s + x.S, 0);
  const snap = {};
  for (let t = 1; t <= (o.T || CONST.SIM_T); t++) {
    st.t = t;
    // 完成的建築、升級、研究、生產
    for (const b of st.building.filter((b) => b.done <= t)) {
      st.blds[b.id] = (st.blds[b.id] || 0) + 1;
      if (D[b.id].heroes) st.hqs++;
    }
    st.building = st.building.filter((b) => b.done > t);
    st.busyW = st.busyW.filter((x) => x > t);
    if (st.upg && st.upg.done <= t) {
      st.blds[st.upg.from]--;
      st.blds[st.upg.to] = (st.blds[st.upg.to] || 0) + 1;
      st.tier = D[st.upg.to].tier;
      st.tierT[st.tier] = t;
      st.log.push(`${fmtT(t)} T${st.tier}`);
      st.upg = null;
    }
    if (st.resBusy && st.resBusy.done <= t) {
      st.res[st.resBusy.id] = st.resBusy.lv;
      st.resBusy = null;
    }
    for (const q of st.prod.filter((q) => q.done <= t)) {
      if (q.k === 'worker') st.workers++;
      else if (q.k === 'hero') st.heroes++;
      else {
        st.army.push(q.u);
        st.armyPop += q.pop;
      }
    }
    st.prod = st.prod.filter((q) => q.done > t);
    // 收入
    const pop = popOf();
    const upk = U.upkeepOf(pop).k;
    const minesOpen = Math.min(st.hqs, 3);
    const miners = Math.max(0, st.workers - st.busyW.length);
    const oreRaw = Math.min(miners * perW, minesOpen * mineCap) * (P.income || 1);
    let ore = oreRaw * upk;
    let coral = coralSrc() * (P.income || 1);
    if (air && st.hqs > 1) ore -= (oreRaw * upk * (st.hqs - 1)) / st.hqs / Math.max(1, CONST.HAUL_DELAY); // 集貨站的延遲（很小）
    let parts = 0;
    // 聖域的拾荒（假設的常數；後面的一段取代前面的）
    let sv = null;
    if (salv) for (const a of CONST.SALV_ASSUME) if (t >= a[0]) sv = a;
    if (sv) {
      ore += ((sv[1] / 60) * (1 + upk)) / 2; // 拾荒的維持費減半
      parts += sv[2] / 60;
    }
    st.ore += ore;
    st.coral += coral;
    st.parts += parts;
    st.incOre += ore;
    st.incCoral += coral;
    if (!(Number.isFinite(st.ore) && Number.isFinite(st.coral)) || st.ore < -1e-6 || st.coral < -1e-6)
      st.bad.push(`${fmtT(t)} 資源 ${st.ore}／${st.coral}`);
    if (t % 60 === 0) st.inc.push({ t, ore: r1(st.incOre), coral: r1(st.incCoral) });
    // ----- 支出（照電腦的順序：步驟 → 工人 → 英雄 → 升級 → 研究所／需求 → 研究 → 部隊） -----
    const keep = { ore: 0, coral: 0 };
    const keepAdd = (c) => {
      keep.ore += c.ore || 0;
      keep.coral += c.coral || 0;
    };
    // 開局步驟（資源先保留）
    while (si < op.steps.length && popOf() >= op.steps[si].pop) {
      const s = op.steps[si];
      const want = op.steps.slice(0, si + 1).filter((x) => x.b === s.b).length;
      if (count(s.b) >= want + (s.b === F.hq ? 1 : 0)) {
        si++;
        continue;
      }
      if (build(s.b, '開局')) si++;
      else {
        keep.ore += D[s.b].cost.ore || 0;
        keep.coral += D[s.b].cost.coral || 0;
        break;
      }
    }
    const stepsDone = si >= op.steps.length;
    // 抽取站（rts-ai.js 的 rtsAiMacro：100 秒起自己的湧出點、之後自己這一側外圍的（艾瑟立克 120 秒、其他 180 秒））
    {
      const vents = t > (fac === 'aetheric' ? 120 : 180) ? 2 : t > 100 ? 1 : 0;
      if (count(ro.extractor) < vents) build(ro.extractor, 'Coral', keep);
    }
    // 人口：快滿時蓋補給
    if (cap() - popOf() < 4 && cap() < U.RTS_POP_MAX && !pending(ro.depot) && stepsDone)
      build(ro.depot, '人口', keep);
    // 分礦（普通：expandT 之後，最多 hqMax）
    const expDef = F.yard && fac === 'veerwell' ? F.yard : F.hq;
    // （要升級（前 150 秒起）、升級中、T2 後重工廠／研究所還沒有時不開：rts-ai.js 的 Coral 保留）
    const nT = st.tier === 1 ? P.t2T : st.tier === 2 ? P.t3T : 1e9;
    const techBusy =
      st.upg ||
      (t >= nT - 150 && t < nT + 120) ||
      (st.tier >= 2 &&
        ((ro.heavy && !count(ro.heavy)) ||
          (ro.works && !count(ro.works)) ||
          (F.salvage && ro.factory2 && !count(ro.factory2))));
    if (
      stepsDone &&
      !techBusy &&
      t >= expandT &&
      st.hqs + pending(expDef) < Math.min(P.hqMax, t >= 600 ? 3 : 2)
    ) {
      if (!build(expDef, '分礦', keep)) keepAdd(D[expDef].cost);
      else if (D[expDef] && !D[expDef].heroes) st.hqs++; // 集貨站：當成回收點
    }
    // 工人
    const wkCap = stepsDone ? P.wkMax : op.wk0;
    const wkQ = st.prod.filter((q) => q.k === 'worker').length;
    if (st.workers + wkQ < wkCap && wkQ < st.hqs && !st.upg && popOf() + 1 <= cap() && afford(W.cost, keep)) {
      pay(W.cost);
      st.prod.push({ k: 'worker', done: t + W.time, pop: 1 });
    }
    // 英雄（第 1 個免費；第 2、3 個要升階）
    const heroQ = st.prod.some((q) => q.k === 'hero');
    const heroWant =
      (st.heroes < 1 && t >= P.hero1T) || (st.heroes < Math.min(P.heroMax, st.tier) && st.heroes >= 1);
    if (heroWant && !heroQ && popOf() + 5 <= cap()) {
      const c = st.heroes ? U.RTS_HERO_COST : { ore: 0, coral: 0 };
      if (afford(c, keep)) {
        pay(c);
        st.prod.push({ k: 'hero', done: t + 55, pop: 5 });
      } else if (st.heroes < 1) {
        keep.ore += c.ore;
        keep.coral += c.coral;
      }
    }
    // 補給商店（有英雄之後、200 秒起）
    if (ro.market && P.items !== 'none' && st.heroes && t > 200 && !count(ro.market) && stepsDone)
      build(ro.market, '商店', keep);
    // 升級主堡
    const nextT = st.tier === 1 ? P.t2T : st.tier === 2 ? P.t3T : 1e9;
    const toId = st.tier === 1 ? ro.hq2 : st.tier === 2 ? ro.hq3 : null;
    const U0 = toId && D[toId];
    const reqBlds = U0 ? (U.reqOf(U0) || {}).blds || [] : [];
    const reqMissing = reqBlds.filter(
      (b) => !Object.keys(st.blds).some((h) => st.blds[h] && U.bldSatisfies(h, b)),
    );
    if (U0 && !st.upg && stepsDone) {
      // 需求的建築（升級前 120 秒起）
      if (t >= nextT - 120)
        for (const b of reqMissing) if (!pending(b) && !build(b, '升級需求', keep)) keepAdd(D[b].cost);
      if (t >= nextT - 150 && t < nextT && !reqMissing.length)
        keep.coral += Math.min(U0.cost.coral, st.coral);
      const popNeed = st.tier === 1 ? op.tech.t2 : op.tech.t3;
      const want = t >= nextT && (popOf() >= popNeed || t >= nextT + 90) && !reqMissing.length;
      if (want) {
        if (afford(U0.cost, keep)) {
          pay(U0.cost);
          st.upg = { from: st.tier === 1 ? F.hq : ro.hq2, to: toId, done: t + U0.time };
          st.log.push(`${fmtT(t)} 升級 ${U0.name}`);
        } else {
          if (st.ore - keep.ore > 400 && st.coral - keep.coral < U0.cost.coral) st.coralWait[st.tier + 1]++;
          keep.ore += U0.cost.ore;
          keep.coral += U0.cost.coral;
        }
      }
    }
    // 研究所（t2T − 90 起；T3 的需求）、重工廠、停機坪
    if (ro.works && !count(ro.works) && (t > P.t2T - 90 || st.tier >= 2) && stepsDone && reqOk(D[ro.works]))
      if (!build(ro.works, '研究', keep)) keepAdd(D[ro.works].cost);
    if (ro.heavy && st.tier >= 2 && !count(ro.heavy))
      if (!build(ro.heavy, 'T2', keep)) keepAdd(D[ro.heavy].cost);
    if (F.salvage && st.tier >= 2 && ro.factory2 && !count(ro.factory2))
      if (!build(ro.factory2, 'T2', keep)) keepAdd(D[ro.factory2].cost);
    if (ro.pad && st.tier >= 3 && !count(ro.pad) && (D[ro.pad].trains || []).some((u) => (op.mix3 || {})[u]))
      build(ro.pad, 'T3', keep);
    // 研究（不保留：錢夠才做）
    if (ro.works && has(ro.works) && !st.resBusy) {
      for (const w of resList) {
        if (resMax(w.id) < w.lv || (st.res[w.id] || 0) >= w.lv) continue;
        const R = RES[w.id];
        const L = R && R.lv[w.lv - 1];
        if (!L) continue;
        if ((L.tier || 1) > st.tier) continue;
        if (afford(L.cost, keep)) {
          pay(L.cost);
          st.resBusy = { id: w.id, lv: w.lv, done: t + L.time };
        }
        break;
      }
    }
    // 部隊：每座生產建築一次一台，照比例（依台數的缺額），Coral 不夠時改不用 Coral 的
    const mix = mixNow();
    // 部隊上限（難度的 armyMax；聖域以人口比較：popK 2）
    const armyN = F.salvage ? st.armyPop / 2 : st.army.length;
    if (!P.armyMax || armyN < P.armyMax) {
      const facs = {};
      for (const q of st.prod) if (q.b) facs[q.b] = (facs[q.b] || 0) + 1;
      const ids = Object.keys(mix || {}).filter((id) => D[id] && reqOk(D[id]) && trainsAt(id).length);
      ids.sort((a, b) => (armyCnt[a] || 0) / mix[a] - (armyCnt[b] || 0) / mix[b]);
      for (const id of ids) {
        const d = D[id];
        const fb = trainsAt(id).find((b) => (facs[b] || 0) < st.blds[b]);
        if (!fb) continue;
        if (popOf() + (d.pop || 1) > cap()) break;
        if (!afford(data.unitCost(id), keep)) continue;
        pay(data.unitCost(id));
        facs[fb] = (facs[fb] || 0) + 1;
        armyCnt[id] = (armyCnt[id] || 0) + 1;
        st.prod.push({
          k: 'unit',
          b: fb,
          done: t + d.time,
          pop: d.pop || 1,
          u: { id, S: data.units[id] ? data.units[id].S : 0 },
        });
      }
    }
    if (t === 300 || t === 480 || t === 600 || t === 720)
      snap[t] = { pop: st.armyPop, n: st.army.length, S: Math.round(strength()), workers: st.workers };
  }
  void C;
  void MAP;
  return {
    fac,
    opener: op.id,
    salvage: salv,
    inc: st.inc,
    inc5: st.inc[4] ? st.inc[4].ore + CONST.CORAL_ORE * st.inc[4].coral : NaN,
    inc10: st.inc[9] ? st.inc[9].ore + CONST.CORAL_ORE * st.inc[9].coral : NaN,
    t2: st.tierT[2] || Infinity,
    t3: st.tierT[3] || Infinity,
    coralWait2: st.coralWait[2],
    coralWait3: st.coralWait[3],
    snap,
    log: st.log,
    bad: st.bad,
    perW: r2(perW),
    mineD: r1(dist),
  };
}

// 主礦到主堡佔地邊緣的平均距離（--seeds 張地圖）
function mineDist(data, seeds, themes, size) {
  const { MAP, U } = data;
  const out = {};
  for (const f in U.RTS_FACTIONS) {
    const foot = U.RTS_DEFS[U.RTS_FACTIONS[f].hq].foot[0];
    let s = 0,
      n = 0;
    for (const th of themes)
      for (let i = 0; i < seeds; i++) {
        const p = MAP.planRtsMap(1000 + i * 7919, { theme: th, size });
        for (const b of p.bases) {
          const m = p.mines.find((x) => x.kind === 'main' && x.owner === b.owner);
          if (!m) continue;
          // 主堡蓋在主礦旁（rts.js 的 rtsFindSpot：外形離主礦中心約 13 m），工人走主礦表面到佔地邊緣
          const d = Math.min(Math.hypot(m.pos.x - b.pos.x, m.pos.z - b.pos.z), 13 + foot / 2) - foot / 2;
          s += Math.max(3, d - data.U.RTS_GATHER.mineR + data.U.RTS_GATHER.reach);
          n++;
        }
      }
    out[f] = n ? s / n : 7;
  }
  return out;
}

// ---------- 英雄技能的預算 ----------
function skillBudget(data) {
  const { armorK } = data.C;
  const area = (R) => Math.min(CONST.N_MAX, Math.PI * R * R * CONST.DENS);
  const stunV = (n, s) => n * CONST.TGT_DPS * s;
  const armorV = (x) => CONST.TGT_HP * (armorK(CONST.TGT_ARMOR) / armorK(CONST.TGT_ARMOR + x) - 1);
  // 每次施放的期望值（傷害或等效血量）；P＝這一級的參數、H＝英雄定義
  return {
    // 卡斯特隆
    sk_plate: (P) => armorV(P.armor),
    sk_fortress: (P) => (P.t / P.every) * area(P.R) * P.dmg + CONST.HERO_IN_DPS * P.t * (1 - P.taken),
    sk_rain: (P) => P.n * P.dmg * Math.min(1, area(4) * 0.5) * 1, // 8 m 內散落：每發約半個目標（爆炸 4 m）
    sk_mark: (P) => CONST.FOCUS_DPS * (P.taken - 1) * P.t,
    sk_barrage: (P) => (P.dur / P.gap) * P.dmg * 0.25 + P.end * 40 * 0.5, // 直線上每發平均 0.25 個目標＋終點的飛彈雨
    sk_rush: (P) => P.dmg + stunV(1, P.stun),
    sk_pile: (P) => P.dmg * 1.25, // 穿甲對重甲（平均 ×1.25）
    sk_quake: (P) => P.n * P.dmg * area(P.R) * 0.5 + stunV(area(P.R) * 0.5, P.stun),
    // 艾瑟立克
    sk_refract: (P) => P.dmg * Math.min(CONST.N_MAX, P.len * P.w * CONST.DENS),
    sk_prism: (P) => P.n,
    sk_skylight: (P) => P.n * P.dmg * area(P.r) * 0.5 + P.dmg2 * area(P.r2) * 0.5,
    sk_catalyze: (P) => P.heal * CONST.TGT_HP,
    sk_emp: (P) => (P.dmg + CONST.TGT_DPS * P.stun) * area(P.R),
    // 維爾威
    sk_blitz: (P) => P.dmg * Math.min(CONST.N_MAX, 25 * P.w * CONST.DENS),
    sk_drop: (P) => P.heal * area(P.R),
    sk_pod: (P) => (P.dmg + CONST.TGT_DPS * P.stun) * area(P.R),
    sk_carpet: (P) => P.n * P.dmg * area(P.R) * 0.5,
    sk_flak: (P) => P.dmg * area(P.R) * 0.5 * (1 + P.gK) * 0.5, // 空中＋地面 50%
    sk_jam: (P) => CONST.TGT_DPS * P.t * (1 - P.rangeK),
    // 聖域
    sk_mend: (P) => P.heal,
    sk_triage: (P) => P.heal * CONST.TGT_HP * area(P.R),
    sk_magnet: (P) => stunV(1, P.stun) + CONST.FOCUS_DPS * P.stun * 0.5,
    sk_minefield: (P) => P.n * P.dmg * 0.6, // 地雷約六成被踩到
    sk_haven: (P) => P.cap,
    sk_refuge: (P) => CONST.HERO_IN_DPS * 4 * P.t * (1 - P.taken),
    // 酒館
    sk_junk: (P) => P.dmg * area(P.R),
    sk_storm: (P) => P.t * P.dmg * area(P.R) * 0.5,
    sk_ambush: (P) => P.dmg * area(P.R) + stunV(area(P.R), P.stun),
    sk_snipe: (P) => P.dmg * 1.25,
    sk_parasite: (P) => P.dps * P.t,
    sk_homing: (P) => P.n * P.dmg,
    sk_burner: (P) => P.t * P.dps * 2,
    sk_launch: (P) => P.dmg * area(P.R) * 0.5,
    sk_shove: (P) => P.dmg,
    sk_undertow: (P) => (P.dmg + CONST.TGT_DPS * P.stun) * area(P.R),
    sk_acid: (P) => P.t * P.dps * area(P.R) * 0.5,
    sk_swamp: (P) => P.t * P.dps * area(P.R) * 0.5,
  };
}

// ---------- 主程式 ----------
async function run(opts = {}) {
  const t0 = Date.now();
  const data = await loadData();
  const { U, C, H, AI } = data;
  const D = U.RTS_DEFS;
  const M = makeUnits(data);
  const facs = Object.keys(U.RTS_FACTIONS).filter((f) => !opts.faction || f === opts.faction);
  const allFacs = Object.keys(U.RTS_FACTIONS);
  const out = {
    const: CONST,
    units: {},
    checks: [],
    matrix: {},
    army: {},
    econ: {},
    skills: [],
    siege: [],
    towers: [],
    tavern: [],
  };
  // 單兵
  const units = {};
  for (const f of allFacs)
    for (const id of U.RTS_FACTIONS[f].units) {
      const d = D[id];
      if (!d || d.kind !== 'unit' || d.worker || d.hero || d.militia) continue;
      units[id] = M.info(id);
    }
  data.units = units;
  data.unitCost = (id) => {
    const d = D[id];
    if (d.fused) return { ore: 1e9, coral: 1e9 }; // 融合產生：不能直接生產
    return d.cost || {};
  };
  out.units = Object.fromEntries(
    Object.values(units).map((u) => [
      u.id,
      {
        name: u.name,
        faction: u.faction,
        tier: u.tier,
        cost: r1(u.cost),
        pop: u.pop,
        ehp: Math.round(u.ehp),
        D: r1(u.D),
        Dair: r1(u.Da),
        S: r1(u.S),
        eff: r2(u.eff),
        perPop: r1(u.perPop),
        dHp: r2(u.dHp * 100),
        range: u.range,
        speed: u.speed,
        support: u.support,
      },
    ]),
  );
  const check = (key, ok, msg, val) => {
    const keep = !ok && KEEP[key];
    out.checks.push({ key, ok: !!ok, keep: keep || null, msg, val });
  };
  const inRange = (v, a, b) => Number.isFinite(v) && v >= a - 1e-9 && v <= b + 1e-9;
  // 同陣營同階的成本效率
  const fu = (f, tier) =>
    Object.values(units).filter((u) => u.faction === f && u.tier === tier && !u.support);
  const med = {};
  for (const f of allFacs)
    for (const tier of [1, 2, 3]) {
      const L = fu(f, tier);
      med[f + tier] = median(L.map((u) => u.eff));
      if (!facs.includes(f) || (opts.tier && +opts.tier !== tier)) continue;
      for (const u of L) {
        const k = u.eff / med[f + tier];
        check(
          `eff:${u.id}`,
          inRange(k, 0.75, 1.25),
          `${u.name}（${u.id}）S／C 是同階中位數的 ${r2(k)} 倍（0.75～1.25）`,
          r2(k),
        );
      }
    }
  for (const f of facs) {
    if (f === 'castron') continue;
    for (const tier of [1, 2, 3]) {
      if (opts.tier && +opts.tier !== tier) continue;
      const k = med[f + tier] / med['castron' + tier];
      check(
        `effFac:${f}:${tier}`,
        inRange(k, 0.88, 1.12),
        `${f} T${tier} 成本效率中位數是卡斯特隆的 ${r2(k)} 倍（0.88～1.12）`,
        r2(k),
      );
    }
  }
  if (facs.includes('sancta') && units.s_militia && units.c_mt) {
    const a = units.s_militia,
      b = units.c_mt;
    check(
      'militia:ore',
      inRange(a.eff / b.eff, 0.95, 1.15),
      `民兵 MT 對 MT：每 100 礦石 ${r2(a.eff / b.eff)}（0.95～1.15）`,
      r2(a.eff / b.eff),
    );
    check(
      'militia:pop',
      inRange(a.perPop / b.perPop, 1.05, 1.3),
      `民兵 MT 對 MT：每人口 ${r2(a.perPop / b.perPop)}（1.05～1.3）`,
      r2(a.perPop / b.perPop),
    );
  }
  // 相剋矩陣
  const combat = Object.values(units).filter((u) => !u.support);
  for (const i of combat) {
    out.matrix[i.id] = {};
    for (const j of combat) {
      const r = duel(i, j, M.aOf);
      out.matrix[i.id][j.id] = r
        ? Number.isFinite(r.adv) && r.adv > 0
          ? r2(Math.log2(r.adv))
          : r.adv > 0
            ? '打不到（j）'
            : '打不到（i）'
        : null;
    }
  }
  for (const j of combat) {
    if (!facs.includes(j.faction) || (opts.tier && +opts.tier !== j.tier)) continue;
    for (const X of allFacs) {
      if (X === j.faction) continue;
      const cands = combat.filter((i) => i.faction === X && (i.tier === j.tier || i.tier === j.tier - 1));
      let best = 0,
        who = null;
      for (const i of cands) {
        const r = duel(i, j, M.aOf);
        if (r && r.adv > best) ((best = r.adv), (who = i.id));
      }
      check(
        `counter:${j.id}:${X}`,
        best >= 1.5,
        `${j.name}（${j.id}）在 ${X} 的剋星：${who || '沒有'} adv ${r2(best)}（≥ 1.5）`,
        r2(best),
      );
    }
  }
  for (const i of combat) {
    if (!facs.includes(i.faction) || (opts.tier && +opts.tier !== i.tier)) continue;
    for (const Y of allFacs) {
      if (Y === i.faction) continue;
      const tgt = combat.filter((j) => j.faction === Y && j.tier === i.tier);
      let all = tgt.length > 0,
        n = 0;
      for (const j of tgt) {
        const r = duel(i, j, M.aOf);
        if (!r || r.nohit) continue; // 打不到的不算
        n++;
        if (!(r.adv >= 1.25)) all = false;
      }
      check(
        `dominant:${i.id}:${Y}`,
        !(all && n > 0),
        `${i.name}（${i.id}）對 ${Y} 同階的全部單位 adv ≥ 1.25`,
        n,
      );
    }
  }
  // 陣營部隊
  const ops = (f) => AI.RTS_AI_OPENERS[f] || [];
  for (const tier of [1, 2, 3]) {
    for (const A of allFacs)
      for (const B of allFacs) {
        const advs = [];
        for (const oa of ops(A))
          for (const ob of ops(B)) {
            const xa = armyOf(oa, tier, units, data),
              xb = armyOf(ob, tier, units, data);
            const fa = armyF(xa, xb, M.aOf),
              fb = armyF(xb, xa, M.aOf);
            if (fa > 0 && fb > 0) advs.push(fa / fb);
          }
        const g = gmean(advs);
        out.army[`${A}>${B}:${tier}`] = r2(g);
        if (A < B && (facs.includes(A) || facs.includes(B)) && !(opts.tier && +opts.tier !== tier))
          check(
            `army:${A}:${B}:${tier}`,
            inRange(g, 0.8, 1.25),
            `T${tier} ${A} 對 ${B} 的部隊 adv ${r2(g)}（0.8～1.25）`,
            r2(g),
          );
      }
  }
  // 經濟
  const seeds = +opts.seeds || 8;
  const themes = (opts.themes ? String(opts.themes).split(',') : ['wasteland']).filter(
    (t) => data.MAP.RTS_THEMES[t],
  );
  const size = +opts.size || 400;
  const md = mineDist(data, seeds, themes, size);
  for (const f of allFacs) {
    out.econ[f] = econSim(f, data, { mineD: md[f] });
    if (U.RTS_FACTIONS[f].salvage)
      out.econ[f + ':noSalv'] = econSim(f, data, { mineD: md[f], salvage: false });
    for (const r of out.econ[f].bad) check(`econBad:${f}`, false, `${f} 經濟模擬：${r}`, null);
  }
  const base5 = out.econ.castron.inc5;
  for (const f of facs) {
    const E = out.econ[f];
    if (f !== 'castron') {
      if (U.RTS_FACTIONS[f].salvage) {
        const k0 = out.econ[f + ':noSalv'].inc5 / base5,
          k1 = E.inc5 / base5;
        check(
          `inc5:${f}:noSalv`,
          inRange(k0, 0.78, 0.9),
          `${f} 5 分鐘累計收入（不含拾荒）是卡斯特隆的 ${r2(k0)}（0.78～0.9）`,
          r2(k0),
        );
        check(
          `inc5:${f}`,
          inRange(k1, 0.92, 1.1),
          `${f} 5 分鐘累計收入（含拾荒）是卡斯特隆的 ${r2(k1)}（0.92～1.1）`,
          r2(k1),
        );
      } else {
        const k = E.inc5 / base5;
        check(
          `inc5:${f}`,
          inRange(k, 0.9, 1.1),
          `${f} 5 分鐘累計收入是卡斯特隆的 ${r2(k)}（0.9～1.1）`,
          r2(k),
        );
      }
    }
    check(`t2:${f}`, inRange(E.t2, 300, 480), `${f} T2 ${fmtT(E.t2)}（5:00～8:00）`, E.t2);
    check(`t3:${f}`, inRange(E.t3, 540, 780), `${f} T3 ${fmtT(E.t3)}（9:00～13:00）`, E.t3);
    check(`cw2:${f}`, E.coralWait2 < 60, `${f} T2 前等 Coral ${E.coralWait2} 秒（< 60）`, E.coralWait2);
    check(`cw3:${f}`, E.coralWait3 < 90, `${f} T3 前等 Coral ${E.coralWait3} 秒（< 90）`, E.coralWait3);
  }
  {
    const t2s = allFacs.map((f) => out.econ[f].t2),
      t3s = allFacs.map((f) => out.econ[f].t3);
    check(
      't2spread',
      Math.max(...t2s) - Math.min(...t2s) <= 90,
      `T2 時間的差 ${Math.max(...t2s) - Math.min(...t2s)} 秒（≤ 90）`,
      null,
    );
    check(
      't3spread',
      Math.max(...t3s) - Math.min(...t3s) <= 90,
      `T3 時間的差 ${Math.max(...t3s) - Math.min(...t3s)} 秒（≤ 90）`,
      null,
    );
  }
  // 攻城與防禦塔
  const hqOf = (f) => {
    const d = D[U.RTS_FACTIONS[f].hq];
    return {
      id: d.id,
      name: d.name,
      hp: d.hp,
      armor: d.armor || 0,
      arm: d.arm || 'fort',
      flying: false,
      slots: [],
      range: 0,
      speed: 0,
    };
  };
  for (const A of facs)
    for (const B of allFacs) {
      if (A === B) continue;
      const times = [];
      for (const oa of ops(A)) {
        const xa = armyOf(oa, 2, units, data);
        const dps = xa.reduce((s, x) => s + x.n * M.aOf(x.u, hqOf(B), true), 0);
        times.push(hqOf(B).hp / Math.max(1e-6, dps));
      }
      const tt = gmean(times);
      out.siege.push({ A, B, t: r1(tt) });
      check(
        `siege:${A}:${B}`,
        inRange(tt, 40, 90),
        `${A} 的 T2 部隊拆 ${B} 的 T1 主堡 ${r1(tt)} 秒（40～90）`,
        r1(tt),
      );
    }
  for (const A of facs) {
    const tid = AI.RTS_AI_ROLES[A].tower;
    if (!tid) continue;
    const td = D[tid];
    const tw = {
      id: tid,
      name: td.name,
      hp: td.hp,
      armor: td.armor || 0,
      arm: td.arm || 'fort',
      cost: M.C1(M.costOf(tid)),
      range: td.range || 0,
      speed: 0,
      flying: false,
      slots: M.slotsOf(td),
    };
    const advs = [];
    for (const B of allFacs)
      for (const ob of ops(B)) {
        const xb = armyOf(ob, 1, units, data);
        const k = tw.cost / CONST.ARMY_C;
        const army = xb.map((x) => ({ u: x.u, n: x.n * k }));
        let fa = armyF([{ u: tw, n: 1 }], army, M.aOf);
        let HPb = army.reduce((s, x) => s + x.n * x.u.hp, 0);
        // 射程修正：部隊接近期間塔先打
        const rB =
          army.reduce((s, x) => s + x.n * x.u.range, 0) /
          Math.max(
            1e-6,
            army.reduce((s, x) => s + x.n, 0),
          );
        const spB =
          army.reduce((s, x) => s + x.n * x.u.speed, 0) /
          Math.max(
            1e-6,
            army.reduce((s, x) => s + x.n, 0),
          );
        if (tw.range > rB + CONST.RANGE_GAP) {
          const a = army.reduce((s, x) => s + M.aOf(tw, x.u) * ((x.n * x.u.hp) / Math.max(1, HPb)), 0);
          const loss = Math.min(
            CONST.RANGE_LOSS,
            (a * (tw.range - rB)) / Math.max(1, spB) / Math.max(1, HPb),
          );
          fa /= 1 - loss;
        }
        const fb = armyF(army, [{ u: tw, n: 1 }], M.aOf);
        if (fa > 0 && fb > 0) advs.push(fa / fb);
      }
    const g = gmean(advs);
    out.towers.push({ fac: A, tower: tid, adv: r2(g) });
    check(
      `tower:${A}`,
      inRange(g, 1.1, 1.7),
      `${A} 的防禦塔 ${td.name} 對同成本 T1 部隊 adv ${r2(g)}（1.1～1.7）`,
      r2(g),
    );
  }
  // 英雄技能
  const SB = skillBudget(data);
  const heroDps = (h, lv) => h.dps + (h.grow ? h.grow.dps : 0) * (lv - 1);
  const perCoral = {};
  const facHeroes = H.RTS_FACTION_HEROES || {};
  const heroIds = [
    ...Object.values(facHeroes).flat(),
    ...Object.values(H.RTS_TAVERN || {}).map((x) => (typeof x === 'string' ? x : x.id)),
  ];
  for (const hid of heroIds) {
    const h = H.RTS_HERO_DEFS[hid];
    if (!h) continue;
    const fac = h.faction;
    for (const sid of h.skills || []) {
      const S = H.RTS_SKILLS[sid];
      if (!S) continue;
      const fn = SB[sid];
      S.lv.forEach((P, li) => {
        const lv = S.slot === 3 ? 6 : 2 * li + 1;
        const hd = heroDps(h, lv);
        if (!fn) {
          if (li === 0) out.skills.push({ hero: hid, skill: sid, name: S.name, budget: '沒有預算' });
          return;
        }
        const v = fn(P, h);
        const sec = v / hd;
        const row = {
          hero: hid,
          skill: sid,
          name: S.name,
          lv: li + 1,
          v: Math.round(v),
          sec: r1(sec),
          perCoral: r1(v / Math.max(1, P.coral || 0)),
          perCd: r1(v / Math.max(1, P.cd || 1)),
        };
        out.skills.push(row);
        if (fac !== 'neutral') (perCoral[fac] || (perCoral[fac] = [])).push(v / Math.max(1, P.coral || 1));
        if (!facs.includes(fac) && fac !== 'neutral') return;
        if (fac === 'neutral' && opts.faction) return;
        if (S.slot === 3)
          check(
            `ult:${sid}`,
            inRange(sec, 25, 45),
            `${h.name} ${S.name}：期望 ${Math.round(v)}＝6 級 dps 的 ${r1(sec)} 秒（25～45）`,
            r1(sec),
          );
        else
          check(
            `sk:${sid}:${li + 1}`,
            inRange(sec, 8, 16),
            `${h.name} ${S.name} ${li + 1} 級：期望 ${Math.round(v)}＝${lv} 級 dps 的 ${r1(sec)} 秒（8～16）`,
            r1(sec),
          );
      });
    }
  }
  {
    const avg = Object.fromEntries(Object.entries(perCoral).map(([f, a]) => [f, median(a)]));
    out.skillPerCoral = Object.fromEntries(Object.entries(avg).map(([f, v]) => [f, r1(v)]));
    const vs = Object.values(avg);
    const k = Math.max(...vs) / Math.min(...vs);
    check('skillCoral', k <= 1.3, `每 Coral 的技能期望值（各陣營中位數）最大／最小 ${r2(k)}（≤ 1.3）`, r2(k));
  }
  // 酒館英雄：1 級的血量、dps、每級成長在陣營英雄的範圍內
  if (!opts.faction) {
    const fh = Object.values(facHeroes)
      .flat()
      .map((id) => H.RTS_HERO_DEFS[id])
      .filter(Boolean);
    const rng = (f) => [Math.min(...fh.map(f)), Math.max(...fh.map(f))];
    const keys = {
      hp: (h) => h.hp,
      dps: (h) => h.dps,
      'grow.hp': (h) => h.grow.hp,
      'grow.dps': (h) => h.grow.dps,
      'grow.armor': (h) => h.grow.armor,
    };
    for (const t of Object.values(H.RTS_TAVERN || {})) {
      const h = H.RTS_HERO_DEFS[typeof t === 'string' ? t : t.id];
      if (!h) continue;
      for (const [k, f] of Object.entries(keys)) {
        const [a, b] = rng(f);
        const v = f(h);
        out.tavern.push({ hero: h.id, k, v, min: a, max: b });
        check(
          `tavern:${h.id}:${k}`,
          inRange(v, a, b),
          `酒館 ${h.name} 的 ${k} ${v}（陣營英雄 ${a}～${b}）`,
          v,
        );
      }
    }
  }
  out.ms = Date.now() - t0;
  out.fail = out.checks.filter((c) => !c.ok && !c.keep);
  out.kept = out.checks.filter((c) => !c.ok && c.keep);
  if (opts.json !== false) {
    const file =
      typeof opts.json === 'string' ? opts.json : path.join(ROOT, 'test-results', 'rts-balance.json');
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(out, null, 1));
    } catch (e) {}
  }
  return out;
}

// ---------- 報表 ----------
function report(out, opts) {
  const L = [];
  const md = !!opts.md;
  const table = (head, rows) => {
    if (md) {
      L.push('| ' + head.join(' | ') + ' |');
      L.push('|' + head.map(() => '---').join('|') + '|');
      for (const r of rows) L.push('| ' + r.join(' | ') + ' |');
    } else {
      const w = head.map((h, i) => Math.max(String(h).length, ...rows.map((r) => String(r[i]).length)));
      L.push(head.map((h, i) => String(h).padEnd(w[i])).join('  '));
      for (const r of rows) L.push(r.map((c, i) => String(c).padEnd(w[i])).join('  '));
    }
    L.push('');
  };
  L.push(md ? '#### 單兵' : '== 單兵 ==');
  const U = Object.entries(out.units).filter(([, u]) => !opts.faction || u.faction === opts.faction);
  table(
    [
      'id',
      '陣營',
      '階',
      '成本',
      '人口',
      'EHP',
      'D',
      'S',
      'S/C×100',
      'S/人口',
      'D/hp%',
      '射程',
      '速度',
      '備註',
    ],
    U.map(([id, u]) => [
      id,
      u.faction,
      u.tier,
      u.cost,
      u.pop,
      u.ehp,
      u.D + (u.Dair && u.Dair !== u.D ? '／空' + u.Dair : ''),
      u.S,
      u.eff,
      u.perPop,
      u.dHp,
      u.range,
      u.speed,
      u.support ? '支援' : '',
    ]),
  );
  L.push(md ? '#### 陣營部隊（三套開局的幾何平均）' : '== 陣營部隊 ==');
  const facs = [...new Set(Object.values(out.units).map((u) => u.faction))];
  for (const t of [1, 2, 3])
    table(
      [`T${t}`, ...facs],
      facs.map((a) => [a, ...facs.map((b) => out.army[`${a}>${b}:${t}`])]),
    );
  L.push(md ? '#### 經濟（普通、標準開局）' : '== 經濟 ==');
  table(
    [
      '陣營',
      '5 分累計',
      '10 分累計',
      'T2',
      'T3',
      'T2 前等 Coral',
      'T3 前等 Coral',
      '5 分部隊人口／強度',
      '8 分',
      '12 分',
    ],
    Object.entries(out.econ).map(([f, E]) => [
      f,
      Math.round(E.inc5),
      Math.round(E.inc10),
      fmtT(E.t2),
      fmtT(E.t3),
      E.coralWait2,
      E.coralWait3,
      E.snap[300] ? `${E.snap[300].pop}／${E.snap[300].S}` : '—',
      E.snap[480] ? `${E.snap[480].pop}／${E.snap[480].S}` : '—',
      E.snap[720] ? `${E.snap[720].pop}／${E.snap[720].S}` : '—',
    ]),
  );
  L.push(md ? '#### 攻城與防禦塔' : '== 攻城與防禦塔 ==');
  table(
    ['攻方', '守方 T1 主堡', '秒'],
    out.siege.map((s) => [s.A, s.B, s.t]),
  );
  table(
    ['陣營', '防禦塔', 'adv'],
    out.towers.map((s) => [s.fac, s.tower, s.adv]),
  );
  L.push(md ? '#### 英雄技能' : '== 英雄技能 ==');
  table(
    ['英雄', '技能', '級', '期望值', '同級 dps 秒', '每 Coral', '每冷卻秒'],
    out.skills
      .filter((s) => s.budget !== '沒有預算')
      .map((s) => [s.hero, s.name, s.lv, s.v, s.sec, s.perCoral, s.perCd]),
  );
  L.push(
    '沒有預算：' +
      out.skills
        .filter((s) => s.budget)
        .map((s) => s.name)
        .join('、'),
  );
  L.push('每 Coral 的中位數：' + JSON.stringify(out.skillPerCoral));
  L.push('');
  L.push(md ? '#### 檢查' : '== 檢查 ==');
  for (const c of out.checks.filter((c) => !c.ok))
    L.push(`${c.keep ? '留著' : '超出'}：${c.msg}${c.keep ? '（' + c.keep + '）' : ''}`);
  L.push(
    `共 ${out.checks.length} 項：通過 ${out.checks.filter((c) => c.ok).length}、留著 ${out.kept.length}、超出 ${out.fail.length}（${out.ms} ms）`,
  );
  return L.join('\n');
}

module.exports = { run, CONST, KEEP };

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  run(opts)
    .then((out) => {
      if (!opts.quiet) console.log(report(out, opts));
      else console.log(`超出 ${out.fail.length}、留著 ${out.kept.length}／${out.checks.length}`);
      if (opts.check && out.fail.length) process.exit(1);
    })
    .catch((e) => {
      console.error(e && e.stack ? e.stack : e);
      process.exit(2);
    });
}
