// 遠程射擊改版第 5 期「手感與回饋」（docs/ranged-design.md）：依武器的受擊反應與主動裝填的數值（純資料）。
// 判定在 entities/mech-feel.js（房主／單機），畫面在 game/feel.js。
export const FEEL = {
  // 依武器種類的受擊反應（只對一般敵人：Boss、部位、目標物不動）
  SG_PUSH: 0.8, // 霰彈：每顆彈丸把目標往後推（m/s × dk）
  LAUNCH_V: 7, // 火箭筒／榴彈：小型敵人往上彈（m/s × dk）
  LAUNCH_PUSH: 6, //  往外推
  SMALL_R: 2.6, //  半徑（× dk）以下算小型
  MG_FLINCH: 0.35, // 機槍：被打中後幾秒內移動變慢（持續抖動）
  MG_SLOW: 0.75,
  HEAVY_IMP: 380, // 衝擊這麼大以上的一發（穿甲彈、獨頭彈、蓄力雷射）：目標頓格
  HEAVY_STOP: 0.07,
  // 命中標記（準星上的 ×）
  MARK_T: 0.18,
  // 主動裝填：換彈中按開火鍵，在亮區（進度 AR_A～AR_B）＝瞬間裝填＋下一個彈匣傷害 ×AR_DMG；按錯＝卡彈 AR_JAM 秒
  AR_A: 0.42,
  AR_B: 0.6,
  AR_MIN: 0.7, // 換彈時間比這個短的武器沒有（機槍以外很快的）
  AR_DMG: 1.15,
  AR_JAM: 0.6,
};
