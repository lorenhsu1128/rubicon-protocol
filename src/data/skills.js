// 駕駛員技能樹與武器熟練度資料（PvE／PvP 共用同一棵樹，各自配點）
// 效果 fx 是「每一級」的增量，computePilotMods 會把所有已投點技能的增量乘上等級後加總：
//   比例類（dmg、rld…）是 ±比例，例如 0.03 = +3%、rld 0.06 = 換彈時間 −6%
//   固定值類（def、kits、qbIF…）直接加在基準值上
export const PILOT_MAX_LEVEL = 35;
export const PRESET_MAX = 5;
// 從 L 級升到 L+1 級所需經驗
export const xpToNext = (L) => 250 + 120 * L;
// 各階層需要在同分支「較低階層」投入的點數
export const TIER_REQ = { 1: 0, 2: 3, 3: 7 };

export const BRANCHES = [
  { id: 'gun', name: '射擊' },
  { id: 'melee', name: '近戰' },
  { id: 'mob', name: '機動' },
  { id: 'en', name: '能源' },
  { id: 'armor', name: '裝甲' },
  { id: 'sup', name: '支援' },
];

const pct = (v) => Math.round(v * 1000) / 10 + '%';

// desc(r) 回傳 r 級時的效果說明
export const SKILLS = [
  // ---------- 射擊 ----------
  {
    id: 'g_dmg',
    br: 'gun',
    tier: 1,
    max: 3,
    name: '火力校準',
    fx: { dmg: 0.03 },
    desc: (r) => `射擊武器傷害 +${pct(0.03 * r)}`,
  },
  {
    id: 'g_rld',
    br: 'gun',
    tier: 1,
    max: 3,
    name: '快速裝填',
    fx: { rld: 0.06 },
    desc: (r) => `換彈時間 −${pct(0.06 * r)}`,
  },
  {
    id: 'g_mag',
    br: 'gun',
    tier: 2,
    max: 2,
    name: '擴充彈匣',
    fx: { mag: 0.1, ammo: 0.1 },
    desc: (r) => `彈匣容量與攜彈量 +${pct(0.1 * r)}`,
  },
  {
    id: 'g_fcs',
    br: 'gun',
    tier: 2,
    max: 2,
    name: '火控連動',
    fx: { lock: 0.05, turn: 0.08 },
    desc: (r) => `鎖定距離 +${pct(0.05 * r)}、飛彈追蹤 +${pct(0.08 * r)}`,
  },
  {
    id: 'g_cap',
    br: 'gun',
    tier: 3,
    max: 1,
    req: 'g_dmg',
    name: '彈道專家',
    fx: { spread: 0.25, pspd: 0.1 },
    desc: () => '射擊擴散 −25%、彈速 +10%',
  },
  // ---------- 近戰 ----------
  {
    id: 'm_dmg',
    br: 'melee',
    tier: 1,
    max: 3,
    name: '刃鋒',
    fx: { mDmg: 0.04 },
    desc: (r) => `近戰傷害 +${pct(0.04 * r)}`,
  },
  {
    id: 'm_en',
    br: 'melee',
    tier: 1,
    max: 3,
    name: '省能連斬',
    fx: { mEn: 0.1 },
    desc: (r) => `近戰 EN 消耗 −${pct(0.1 * r)}`,
  },
  {
    id: 'm_imp',
    br: 'melee',
    tier: 2,
    max: 2,
    name: '重擊衝擊',
    fx: { mImp: 0.08 },
    desc: (r) => `近戰衝擊力 +${pct(0.08 * r)}`,
  },
  {
    id: 'm_rch',
    br: 'melee',
    tier: 2,
    max: 2,
    name: '延伸斬擊',
    fx: { mRch: 0.05 },
    desc: (r) => `近戰攻擊範圍 +${pct(0.05 * r)}`,
  },
  {
    id: 'm_cap',
    br: 'melee',
    tier: 3,
    max: 1,
    req: 'm_dmg',
    name: '斬擊大師',
    fx: { mChain: -0.3 },
    desc: () => '連段後續 EN 消耗 60% → 30%',
  },
  // ---------- 機動 ----------
  {
    id: 'v_spd',
    br: 'mob',
    tier: 1,
    max: 3,
    name: '推進調校',
    fx: { spd: 0.02 },
    desc: (r) => `地面速度 +${pct(0.02 * r)}`,
  },
  {
    id: 'v_qbc',
    br: 'mob',
    tier: 1,
    max: 3,
    name: 'QB 省能',
    fx: { qbc: 0.08 },
    desc: (r) => `QB／突擊推進 EN 消耗 −${pct(0.08 * r)}`,
  },
  {
    id: 'v_qb',
    br: 'mob',
    tier: 2,
    max: 2,
    name: 'QB 爆發',
    fx: { qb: 0.05 },
    desc: (r) => `QB 速度 +${pct(0.05 * r)}`,
  },
  {
    id: 'v_air',
    br: 'mob',
    tier: 2,
    max: 2,
    name: '滯空',
    fx: { jump: 0.06, hover: 0.1 },
    desc: (r) => `跳躍力 +${pct(0.06 * r)}、懸停 EN −${pct(0.1 * r)}`,
  },
  {
    id: 'v_cap',
    br: 'mob',
    tier: 3,
    max: 1,
    req: 'v_qbc',
    name: '殘影',
    fx: { qbIF: 0.08 },
    desc: () => 'QB 無敵時間 0.14 → 0.22 秒',
  },
  // ---------- 能源 ----------
  {
    id: 'e_cap',
    br: 'en',
    tier: 1,
    max: 3,
    name: '擴容',
    fx: { enCap: 0.05 },
    desc: (r) => `EN 容量 +${pct(0.05 * r)}`,
  },
  {
    id: 'e_rch',
    br: 'en',
    tier: 1,
    max: 3,
    name: '回充',
    fx: { rch: 0.06 },
    desc: (r) => `EN 回復速度 +${pct(0.06 * r)}`,
  },
  {
    id: 'e_dly',
    br: 'en',
    tier: 2,
    max: 2,
    name: '快速復電',
    fx: { dly: 0.12 },
    desc: (r) => `EN 回復延遲 −${pct(0.12 * r)}`,
  },
  {
    id: 'e_wpn',
    br: 'en',
    tier: 2,
    max: 2,
    name: '能源武器效率',
    fx: { enWpn: 0.1, chg: 0.08 },
    desc: (r) => `雷射／電磁槍 EN 消耗 −${pct(0.1 * r)}、充能時間 −${pct(0.08 * r)}`,
  },
  {
    id: 'e_gnd',
    br: 'en',
    tier: 3,
    max: 1,
    req: 'e_rch',
    name: '地面急充',
    fx: { gnd: 0.4 },
    desc: () => '著地時 EN 回復倍率 ×1.6 → ×2.0',
  },
  // ---------- 裝甲 ----------
  {
    id: 'a_ap',
    br: 'armor',
    tier: 1,
    max: 3,
    name: '追加裝甲',
    fx: { ap: 0.03 },
    desc: (r) => `AP +${pct(0.03 * r)}`,
  },
  {
    id: 'a_stb',
    br: 'armor',
    tier: 1,
    max: 3,
    name: '姿態穩定',
    fx: { stab: 0.05 },
    desc: (r) => `姿態穩定（ACS 上限）+${pct(0.05 * r)}`,
  },
  {
    id: 'a_def',
    br: 'armor',
    tier: 2,
    max: 2,
    name: '裝甲塗層',
    fx: { def: 0.015 },
    desc: (r) => `防禦 +${pct(0.015 * r)}（上限 35%）`,
  },
  {
    id: 'a_rec',
    br: 'armor',
    tier: 2,
    max: 2,
    name: '姿態回復',
    fx: { acsDec: 0.12, stagT: 0.08 },
    desc: (r) => `ACS 衰減 +${pct(0.12 * r)}、失衡時間 −${pct(0.08 * r)}`,
  },
  {
    id: 'a_cap',
    br: 'armor',
    tier: 3,
    max: 1,
    req: 'a_ap',
    name: '不屈',
    fx: { stagDmg: -0.2 },
    desc: () => '失衡時受到的傷害 ×1.5 → ×1.3',
  },
  // ---------- 支援（部分技能 PvE／PvP 效果不同）----------
  {
    id: 's_kit',
    br: 'sup',
    tier: 1,
    max: 3,
    name: '修復效率',
    fx: { kitHeal: 0.04 },
    desc: (r) => `修補包回復量 40% → ${40 + 4 * r}%`,
  },
  { id: 's_kitn', br: 'sup', tier: 1, max: 1, name: '備用套件', fx: { kits: 1 }, desc: () => '修補包 +1' },
  {
    id: 's_x1',
    br: 'sup',
    tier: 2,
    max: 2,
    pve: { name: '堅守', fx: { downHp: 0.1 }, desc: (r) => `多人倒地時的耐久 30% → ${30 + 10 * r}%` },
    pvp: { name: '快速重整', fx: { respawn: 0.1 }, desc: (r) => `重生等待時間 −${pct(0.1 * r)}` },
  },
  {
    id: 's_x2',
    br: 'sup',
    tier: 2,
    max: 2,
    pve: { name: '報酬交涉', fx: { coam: 0.05 }, desc: (r) => `任務完成獎金 +${pct(0.05 * r)}` },
    pvp: { name: '重生護盾', fx: { spawnIF: 0.75 }, desc: (r) => `重生無敵時間 +${0.75 * r} 秒` },
  },
  {
    id: 's_cap',
    br: 'sup',
    tier: 3,
    max: 1,
    req: 's_kit',
    pve: { name: '急救專家', fx: { reviveHp: 0.2 }, desc: () => '救援隊友時回復 40% → 60%' },
    pvp: { name: '應急修復', fx: { kitEn: 0.3 }, desc: () => '使用修補包時同時回復 30% EN' },
  },
];
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
// 依模式取得技能的名稱／效果／說明
export function skillView(s, mode) {
  const v = s[mode] || s;
  return { name: v.name, fx: v.fx, desc: v.desc };
}

// ---------- 武器熟練度（依個別武器零件，各模式分開累積）----------
// 熟練度點數：每 10 點有效傷害 = 1 點；EMP 暈眩、護盾吸收另有換算（見 game/pilot.js）
export const PROF_THRESH = [1500, 5000, 12000, 25000, 45000];
export const PROF_MAX = PROF_THRESH.length;
// 每一級新增的加成（累加），鍵值與技能的武器類效果相同
export const PROF_BONUS = {
  bullet: [{ rld: 0.05 }, { spread: 0.08 }, { mag: 0.1 }, { rld: 0.05 }, { dmg: 0.03 }],
  shotgun: [{ rld: 0.05 }, { spread: 0.06 }, { mag: 0.1 }, { rof: 0.04 }, { dmg: 0.03 }],
  shell: [{ rld: 0.06 }, { splash: 0.05 }, { ammo: 0.1 }, { rld: 0.06 }, { dmg: 0.03 }],
  grenade: [{ rld: 0.06 }, { splash: 0.05 }, { ammo: 0.1 }, { rld: 0.06 }, { dmg: 0.03 }],
  missile: [{ rld: 0.05 }, { turn: 0.08 }, { ammo: 0.1 }, { rld: 0.05 }, { dmg: 0.03 }],
  laser: [{ rof: 0.04 }, { chg: 0.06 }, { range: 0.05 }, { rof: 0.04 }, { dmg: 0.03 }],
  empbeam: [{ eps: 0.05 }, { range: 0.05 }, { eps: 0.05 }, { imp: 0.05 }, { dmg: 0.03 }],
  melee: [{ mEn: 0.06 }, { mRch: 0.04 }, { mImp: 0.06 }, { mEn: 0.06 }, { mDmg: 0.03 }],
  emp: [{ rof: 0.05 }, { radius: 0.05 }, { stun: 0.08 }, { rof: 0.05 }, { radius: 0.05 }],
  shield: [{ absorb: 0.01 }, { absorb: 0.01 }, { absorb: 0.01 }, { absorb: 0.01 }, { absorb: 0.01 }],
};
// 熟練度加成的顯示文字
export const FX_LABEL = {
  dmg: '傷害',
  rld: '換彈時間',
  spread: '擴散',
  mag: '彈匣',
  ammo: '攜彈量',
  rof: '射擊間隔',
  splash: '爆炸範圍',
  turn: '追蹤',
  chg: '充能時間',
  range: '射程',
  eps: 'EN 消耗',
  imp: '衝擊力',
  mEn: 'EN 消耗',
  mRch: '攻擊範圍',
  mImp: '衝擊力',
  mDmg: '傷害',
  radius: '範圍',
  stun: '暈眩時間',
  absorb: '吸收率',
};
// 數值變小才是強化的效果
export const FX_LOWER = new Set(['rld', 'spread', 'rof', 'chg', 'eps', 'mEn']);
