// Boss 改版（docs/boss-design.md）：刁鑽度 1～8 與各方案的參數，純資料與純函式。
// 刁鑽度在生成時決定（mission.js 的 spawnBossDef），存在實體的 opts.tier、隨生成紀錄（bt）同步；
// 實體上用 bossTier() 取（部位跟著本體）。0＝不套用（靶場、實驗室）。
import { BOSS_DEFS } from './enemies.js';

// 每一列＝一個刁鑽度（索引 1～8；0 不用）。欄位依方案：
//   A 失衡越打越難：aFree 不變的次數、aUp 之後每次需要的 ACS 增加、aCut 之後每次失衡時間縮短、aMin 最短秒數
//   D 破綻：dBase 平時受到的傷害、dOpenT 破綻持續秒數、dWhich 'all'（所有大招收招）／'two'／'one'／'fake'
//   I 打斷大招：iCharge 蓄力秒數、iNeed 打斷要的傷害（最大 AP 比例）、iStun 打斷後失衡秒數、iTrick 刁鑽之處
//   J 部位：jParts 部位數、jHp 部位血量（本體比例）、jRebuild 重建秒數（0＝不重建）、jSwap 重建後換招
//   K 雜兵是燃料：kNeed 充滿要擊破幾台、kDecay 幾秒沒擊破開始減少（0＝不減少）、kSquad [最少, 最多] 台、kElite、kSmart
//   L 風格評價：lDrop 被打中掉幾級、lRepeat 重複同一招的額外倍率
//   M 打回去：mHits 要打幾發、mFake 混進假彈、mDodge 飛回去的彈 Boss 會躲（要在 mNear 公尺內打掉）、mCounter 反擊點秒數
//   O 擊破速度：oS S 級的時間倍率
//   C 應對玩家：cKinds 偵測幾種、cWin 觀察秒數、cMax 同時應對幾種
//   E 場地：eWhen 哪些型態會變（[2,3] 等）、eZone 作戰區域縮小比例、eMove 不利的區域會移動
const row = (o) => o;
export const TIER = [
  null,
  row({
    ...{ aFree: 3, aUp: 0.15, aCut: 0, aMin: 1.5 },
    ...{ dBase: 0.8, dOpenT: 4, dWhich: 'all' },
    ...{ iCharge: 3, iNeed: 0.03, iStun: 5, iTrick: '' },
    ...{ jParts: 2, jHp: 0.08, jRebuild: 0, jSwap: false },
    ...{ kNeed: 5, kDecay: 0, kSquad: [3, 3], kElite: false, kSmart: false },
    ...{ lDrop: 1, lRepeat: 1 },
    ...{ mHits: 1, mFake: false, mDodge: false, mCounter: 2 },
    ...{ oS: 1.3 },
    ...{ cKinds: 1, cWin: 15, cMax: 1 },
    ...{ eWhen: [3], eZone: 1, eMove: false },
  }),
];
// 刁鑽度 2 照 1；之後每兩級一組（3～4、5～6、7～8）
TIER[2] = { ...TIER[1] };
TIER[3] = {
  ...TIER[1],
  ...{ aFree: 2, aUp: 0.25, aCut: 0.1, aMin: 1.2 },
  ...{ dBase: 0.65, dOpenT: 3, dWhich: 'two' },
  ...{ iCharge: 2.4, iNeed: 0.05, iStun: 4.5, iTrick: 'retreat' },
  ...{ jParts: 3, jHp: 0.1 },
  ...{ kNeed: 6, kDecay: 10, kSquad: [3, 4] },
  ...{ mHits: 2.5, mCounter: 1.5 },
  ...{ oS: 1.1 },
  ...{ cKinds: 2, cWin: 10 },
  ...{ eWhen: [2, 3] },
};
TIER[4] = { ...TIER[3] };
TIER[5] = {
  ...TIER[3],
  ...{ aFree: 1, aUp: 0.3, aCut: 0.15, aMin: 1.0 },
  ...{ dBase: 0.55, dOpenT: 2.2, dWhich: 'one' },
  ...{ iCharge: 2, iNeed: 0.06, iStun: 4, iTrick: 'guard' },
  ...{ jHp: 0.11, jRebuild: 45 },
  ...{ kNeed: 8, kDecay: 6, kSquad: [4, 4], kElite: true },
  ...{ lDrop: 2 },
  ...{ mFake: true, mCounter: 1.2 },
  ...{ oS: 0.9 },
  ...{ cKinds: 4, cWin: 6 },
  ...{ eWhen: [1, 2, 3], eZone: 0.75 },
};
TIER[6] = { ...TIER[5] };
TIER[7] = {
  ...TIER[5],
  ...{ aFree: 0, aUp: 0.35, aCut: 0.2, aMin: 0.9 },
  ...{ dBase: 0.5, dOpenT: 1.8, dWhich: 'fake' },
  ...{ iCharge: 1.8, iNeed: 0.07, iStun: 3.5, iTrick: 'double' },
  ...{ jHp: 0.12, jRebuild: 30, jSwap: true },
  ...{ kElite: false, kSmart: true },
  ...{ lRepeat: 0.5 },
  ...{ mDodge: true, mNear: 25, mCounter: 1 },
  ...{ oS: 0.8 },
  ...{ cWin: 4, cMax: 2 },
  ...{ eMove: true },
};
TIER[8] = { ...TIER[7] };

// 共用常數
export const A_MAX = 2; // A：需要的 ACS 累加上限 ×2
export const D_OPEN = 1.6; // D：破綻時受到的傷害
export const D_FAKE_T = 0.4; // D：假收招之後 0.4 秒接下一招
export const I_CD = [9, 16]; // I：大招的間隔秒數（型態開頭先等 I_CD[0]，之後 I_CD[1]）
export const K_HIT = 0.04; // K：破甲彈的額外傷害（Boss 最大 AP 比例）
export const K_SQUAD_T = 25; // K：Boss 戰的雜兵小隊間隔
export const K_SQUAD_MAX = 8; // K：場上的雜兵已經這麼多時不派
export const L_BONUS = { 4: 0.2, 5: 0.28, 6: 0.35 }; // L：S／SS／SSS（風格評價的等級索引）對 Boss 的傷害加成
export const O_PAR = 180; // O：擊破的基準時間（每隻 Boss 的 par 沒寫時）
export const O_A = 1.5; // O：A 級＝基準 × 1.5
export const O_COAM = { S: 1.5, A: 1.2, B: 1 }; // O：Boss 擊破獎金的倍率

export function tierRow(t) {
  return TIER[Math.max(1, Math.min(8, t | 0))];
}
// 主線：出擊所在的章＋周目（第 2 周目 +1、第 3 周目 +2，上限 8）；ECHO 的殘響 Boss 固定 8
export function campaignTier(chapter, cycle, echo) {
  if (echo) return 8;
  return Math.max(1, Math.min(8, (chapter || 1) + Math.max(0, (cycle || 1) - 1)));
}
// 自由出擊：BOSS_DEFS 的索引 i → 1＋⌊i×6／22⌋；繞完一輪之後固定 6
export function freeTier(i) {
  if (i < 0) return 3;
  if (i >= BOSS_DEFS.length) return 6;
  return 1 + Math.floor((i * 6) / BOSS_DEFS.length);
}
// 這個 Boss 定義在 BOSS_DEFS 的索引（自由出擊的第 n 場 Boss 關、自訂關卡用）
export function bossDefIndex(bd) {
  if (!bd) return -1;
  return BOSS_DEFS.findIndex((b) => b === bd || (b.name === bd.name && b.kind === bd.kind));
}
// A：第 n 次失衡（從 0 起算；前 aFree 次不變，之後每次加重）需要的 ACS 倍率與失衡秒數
export function aNeedK(t, n) {
  const T = tierRow(t);
  const over = Math.max(0, n + 1 - T.aFree);
  return Math.min(A_MAX, 1 + T.aUp * over);
}
export function aStagT(t, n, base = 1.5) {
  const T = tierRow(t);
  const over = Math.max(0, n + 1 - T.aFree);
  return Math.max(Math.min(base, T.aMin), base * (1 - T.aCut * over));
}
// O：擊破時間 → 'S'／'A'／'B'
export function oRank(t, sec, par = O_PAR) {
  const T = tierRow(t);
  if (sec <= par * T.oS) return 'S';
  if (sec <= par * O_A) return 'A';
  return 'B';
}
// K：Boss 戰的雜兵小隊（刁鑽度 → 台數與種類；第一台是精英時用重型 MT）
export function kSquad(t, rand = Math.random) {
  const T = tierRow(t);
  const n = T.kSquad[0] + Math.floor(rand() * (T.kSquad[1] - T.kSquad[0] + 1));
  const pool = ['mt', 'mt', 'mt_shot', 'drone', 'mt_gren'];
  const out = [];
  for (let i = 0; i < n; i++) out.push(i === 0 && T.kElite ? 'mth' : pool[Math.floor(rand() * pool.length)]);
  return out;
}
