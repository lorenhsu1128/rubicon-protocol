// 遠程射擊改版第 1 期「邊閃邊打」（docs/ranged-design.md）：玩家一邊側移、跳、QB 閃躲一邊射擊時的加成。
// 不加新按鍵：射擊的那一刻機體在做什麼，決定這一發的效果。只給玩家操作的機體（pilotEnt），電腦不套用。
export const RB = {
  QB_T: 0.35, // QB 射擊：QB 開始後幾秒內開火
  QB_IMP: 1.4,
  CTR_DMG: 1.25, // 完美 QB 反擊（完美 QB 之後 PQB_BUFF 秒內；和近戰共用，誰先出手由誰用掉）
  CTR_IMP: 1.8,
  CTR_BEND: 2.5, // 彈道修正的倍率
  CTR_HITR: 0.25, // 命中判定半徑另外加大（× 實體的 dk）
  CTR_SLOW: 0.45, // 反擊開始時畫面稍微變慢（單人）：秒數
  CTR_SLOW_K: 0.6, // 變慢時的時間倍率
  APEX_T: 0.4, // 頂點射擊：跳到最高點的前後幾秒
  APEX_SPREAD: 0.5,
  APEX_IMP: 1.3,
  LAND_AIR: 0.35, // 落地反擊：至少在空中這麼久才算
  LAND_T: 0.5, // 落地後幾秒內的第一輪射擊
  LAND_IMP: 1.4,
  ORBIT_T: 1.5, // 繞射：繞著鎖定的目標側移幾秒到滿
  ORBIT_V: 5, // 水平速度至少這麼快（× dk）
  ORBIT_SIN: 0.7, // 移動方向和目標方向的夾角正弦至少這麼大（接近垂直）
  ORBIT_DECAY: 1.5, // 沒在繞時每秒消退的倍率
  ORBIT_SPREAD: 0.5, // 滿的時候擴散 ×0.5
  ORBIT_HITR: 0.15, // 滿的時候命中判定加大（× dk）
  IMP_MAX: 2, // 加成合計的衝擊倍率上限
};

// 加成的種類（位元）與提示文字
export const RB_QB = 1,
  RB_CTR = 2,
  RB_APEX = 4,
  RB_LAND = 8,
  RB_ORBIT = 16;
export const RB_TAGS = [
  [RB_CTR, 'COUNTER'],
  [RB_QB, 'QB SHOT'],
  [RB_APEX, 'APEX'],
  [RB_LAND, 'LANDING'],
  [RB_ORBIT, 'ORBIT'],
];
// 有加成的武器種類（持續照射的電磁槍、EMP、近戰、盾不算）
export const RB_TYPES = new Set(['bullet', 'shotgun', 'shell', 'grenade', 'missile', 'laser']);

export function rbLabel(tags) {
  return RB_TAGS.filter(([b]) => tags & b)
    .map(([, s]) => s)
    .join(' + ');
}
