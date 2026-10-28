// 遠程射擊改版第 2 期「反擊與弱點」（docs/ranged-design.md）：一般敵人的弱點（純資料）。
// 有鎖定時子彈一律瞄準目標中心，所以弱點不靠手動瞄準：
// - 方向型：弱點固定在機體的某一面，依子彈「從哪個方向打進來」判斷（back 背後、top 頭頂、side 側面）；
// - 時機型：預警招式的準備期間（mech-moves.js 的 wind）整台露出弱點；
// - 追尾視角與第一人稱：準星壓在弱點上時改瞄那個弱點（game/weak.js）。
// 只算玩家操作的機體打的遠程攻擊（近戰照原本的規則）。
export const WP = {
  CRIT: 1.5, // CRITICAL 的傷害倍率（同一發只算一次）
  BREAK_HP: 0.18, // 弱點的耐久＝機體 AP 上限的比例（累積打在弱點上的傷害）
  BACK: -0.5, // 背後：攻擊方向和機體正面的內積小於這個值
  SIDE: 0.8, // 側面：和機體右方的內積的絕對值大於這個值
  TOP: 0.35, // 頭頂：攻擊方向往下的分量大於這個值
  TOP_DY: 4, // 沒有子彈方向（爆炸）時：攻擊者比目標高這麼多（× dk）
  OPEN_BRK: 0.35, // 準備中累積的衝擊達到 ACS 上限的這個比例 → 打斷招式
  OPEN_STAG: 1.1, // 打斷後的失衡秒數
  YAW: 3.2, // 有方向型弱點的敵人轉身的速度（rad/s；原本 10）
  YAW_AC: 4.5,
  MSL_T: 0.45, // 導彈還有幾秒打到時 QB 可以甩掉
  AIM_PX: 48, // 追尾／第一人稱：準星離弱點在畫面上幾像素以內改瞄弱點
  // 打壞之後
  THR_SPD: 0.8, // 推進器：不能 QB、突擊推進，速度 ×0.8
  SEN_SPREAD: 1.6, // 感測器：擴散 ×1.6、預判變差
  RAD_CD: 1.4, // 散熱片：開火後的冷卻 ×1.4
  AMMO_SELF: 0.3, // 彈藥箱：殉爆，自己受到 AP 上限 30% 的傷害
  AMMO_SPLASH: 9, // 殉爆的範圍（× dk）
};

// 弱點的種類：face＝打得到的方向，pos＝畫在機體上的位置（[前後, 高度] 依半徑／身高的比例；side 兩側都畫）
export const WP_KINDS = {
  thr: { name: '推進器', face: 'back', pos: [-0.9, 0.62], eff: '打壞：不能 QB 與突擊推進' },
  sen: { name: '感測器', face: 'top', pos: [0.1, 1.02], eff: '打壞：命中變差' },
  rad: { name: '散熱片', face: 'side', pos: [0, 0.55], eff: '打壞：開火後過熱更久' },
  ammo: { name: '彈藥箱', face: 'back', pos: [-0.85, 0.5], eff: '打壞：殉爆' },
};

// 各敵人種類（ENEMY_TYPES 的鍵；敵對 AC 一律 'ac'）的弱點：每一面最多一個
export const WEAK_OF = {
  mt: ['thr', 'sen'],
  mth: ['rad', 'sen'],
  mt_shot: ['thr', 'rad'],
  mt_gren: ['ammo', 'sen'],
  mt_mortar: ['ammo', 'sen'],
  mt_stomp: ['thr', 'rad'],
  mt_cmd: ['thr', 'sen'],
  mt_shield: ['thr'],
  mt_dome: ['rad'],
  tank: ['thr', 'sen'],
  strider: ['rad', 'sen'],
  turret: ['ammo', 'rad'],
  heli: ['rad', 'ammo'],
  ac: ['thr', 'sen'],
};

export function weakList(etype) {
  if (!etype) return null;
  if (etype === 'ac' || etype.startsWith('ac_')) return WEAK_OF.ac;
  return WEAK_OF[etype] || null;
}
