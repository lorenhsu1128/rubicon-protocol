// ---------- 敵人 AI 的感知、警戒、仇恨與攻擊權杖的數值（entities/mech-sense.js、game/ai-director.js、entities/mech-moves.js）----------
// 感知：一般敵人有視覺距離與視角（360＝全方位），看得到（視線沒被地形與障礙物擋住）時察覺量表上升，滿了才進入交戰；
// 近距離（SENSE_NEAR 以內）不看視角。玩家開火、QB 的聲音讓附近的敵人起疑並前往查看，受到攻擊直接交戰。
export const SENSE = {
  default: { sight: 58, fov: 130 },
  mt: { sight: 55, fov: 120 },
  shield: { sight: 50, fov: 120 },
  commander: { sight: 60, fov: 140 },
  sniper: { sight: 95, fov: 70 },
  rain: { sight: 75, fov: 140 },
  drone: { sight: 70, fov: 360 },
  turret: { sight: 65, fov: 360 },
  heli: { sight: 80, fov: 360 },
  strider: { sight: 75, fov: 160 },
  flank: { sight: 50, fov: 130 },
  mt_gren: { sight: 60, fov: 130 },
  mortar: { sight: 70, fov: 140 },
  kamikaze: { sight: 45, fov: 160 },
  swarm: { sight: 60, fov: 360 },
  minelayer: { sight: 55, fov: 360 },
};
export const SENSE_NEAR = 9; // 這個距離內不看視角（聽得到腳步）
export const SENSE_INSTANT = 6; // 這個距離內看得到就立刻交戰
export const SENSE_DECAY = 0.45; // 看不到時察覺量表每秒下降
export const SUSPECT_AT = 0.25; // 察覺量表到這裡就起疑（停下來轉向）
export const LOS_DT = 0.25; // 每台敵人多久檢查一次視線
export const SHARE_R = 60; // 交戰中的友軍在這個距離內看得到目標時，共享目標位置
export const LOST_T = 8; // 整個小隊都看不到目標這麼久就轉成搜索
export const SEARCH_T = 14; // 搜索這麼久找不到就回到待機
export const RADIO_R = 35; // 發現目標後通知附近友軍的距離（指揮官 MT 在場時 ×2）
export const RADIO_DL = 0.8; // 通知的延遲
export const STALL_T = 15; // 場上沒有交戰中的敵人這麼久，最近的待機小隊開始搜索玩家
// 聲音：開火的武器類型 → 聽得到的距離
export const NOISE = {
  bullet: 45,
  shotgun: 40,
  laser: 40,
  empbeam: 35,
  shell: 55,
  missile: 55,
  grenade: 55,
  melee: 14,
  emp: 30,
};
export const NOISE_QB = 18;

// 仇恨：每受到 1% AP 的傷害 +1，每秒衰減；目前的目標要被超過 STICKY 倍才換
export const THREAT_DECAY = 0.15;
export const THREAT_NEAR = 30; // 距離加成＝THREAT_NEAR／距離
export const THREAT_LOCK = 8; // 玩家正鎖定我
export const STICKY = 1.3;

// 攻擊權杖：每個目標同時最多 TOKEN_MAX 台「主攻」，權重合計不超過預算（節奏導演依壓力在 TOKEN_BUDGET 的範圍裡調整）；
// 敵對 AC 一律主攻（不佔名額，但在場時其他人的預算少 1）。沒拿到權杖的「壓制」：退到外圈、少量且散的射擊、不放招式。
export const TOKEN_MAX = 3;
export const TOKEN_BUDGET = [1.5, 4]; // 壓力最高／最低時
export const TOKEN_HOLD = [4, 7]; // 拿著權杖的秒數
export const TOKEN_REST = [2, 3.5]; // 交出後多久才能再拿
export const TOKEN_W = { mth: 2, tank: 2, strider: 2, heli: 2, mt_stomp: 2, mt_mortar: 1, mt_shield: 1 }; // 其他＝1
export const SUP_FIRE = 0.3; // 壓制時的開火機率倍率
export const SUP_SPREAD = 1.7; // 壓制時的擴散倍率
export const SUP_RING = [34, 48]; // 壓制時保持的距離
export const SUP_SPECIAL_DT = 0.4; // 壓制時特殊敵人（迫擊砲、主題專屬敵人）攻擊計時的速度
export const HOLDER_IDLE_FIRE = 0.4; // 主攻但招式冷卻中的一般射擊倍率
// 不參與權杖（一直照原本的方式行動）：支援類、部位、目標物、分身
export const NO_TOKEN = new Set([
  'repair',
  'dome',
  'dropship',
  'part',
  'objective',
  'convoy',
  'holo',
  'laserpost',
]);
// 有預警的招式（主攻時才放，mech-moves.js）：依類型（ENEMY_TYPES 的鍵），沒有的依 ai
export const MOVES = {
  mt: ['burst'],
  mth: ['aimShot', 'volley'],
  turret: ['sweep', 'volley'],
  drone: ['charge'],
  tank: ['aimShot', 'sweep'],
  strider: ['charge'],
  mt_shot: ['dash'],
  mt_gren: ['lob'],
  kami: ['beep'],
  swarm: ['beep'],
  heli: ['strafeRun', 'aimShot'],
  mt_shield: ['burst'],
  mt_cmd: ['burst'],
};
// 節奏導演：最近 STRESS_T 秒受到的傷害（AP 比例）與目前 AP 決定壓力 0～1
export const STRESS_T = 6;
// 一直照原本方式行動的支援類（壓制時不放慢）
export const SUPPORT_AI = new Set(['repair', 'dome', 'dropship', 'commander']);
// 看不到目標時移動去找射線的（其他的照自己的移動方式）
export const SEEK_AI = new Set([
  'mt',
  'ac',
  'sniper',
  'rain',
  'bastion',
  'duelist',
  'rusher',
  'flank',
  'strider',
  'drone',
  'heli',
  'shield',
  'commander',
  'stomper',
]);
// 壓制時不衝過來、改在外圈繞的
export const CHARGE_AI = new Set(['rusher', 'kamikaze', 'swarm', 'flank', 'stomper']);
