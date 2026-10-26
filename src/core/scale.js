// 遊戲的尺度（機甲三倍高改版，docs/world-scale.md）：機甲照內建 GLB 建模（身高 3.24 m），遊戲裡一律放大 MS 倍（9.7 m）；
// 地圖範圍與地形放大 WS 倍（物件照現實尺寸，不跟著放大）；速度、射程、重力、跳躍、AI 的距離、鏡頭、霧放大 DS 倍。
// 程式裡寫死的距離一律寫成「舊數字 * 倍率」，資料表（零件、敵人）的數字照舊、載入時由 scaleKeys 乘上。
export const MS = 3; // 機體：所有 MechEntity（機甲、MT、Boss、戰鬥載具、無人機、部位）
export const WS = 3; // 世界：地圖範圍、地形起伏與地形特徵
export const DS = 3; // 動態：速度、QB、重力、跳躍與懸浮、射程、彈速、鎖定、AI 與鏡頭的距離
// 機甲的建模倍率：內建 GLB、關節設定、骨架數值都是新尺度（9.72 m）；程式模型照舊造型建立後整塊放大 MB。
// 機甲實體的 scale 照舊是 MS（判定用），buildMech 收到的倍率是 scale ／ MB
export const MB = 3;

// 物件 o 的 keys 欄位（數字或數字陣列）乘上 k；回傳 o
export function scaleKeys(o, keys, k) {
  if (!o) return o;
  for (const key of keys) {
    const v = o[key];
    if (typeof v === 'number') o[key] = v * k;
    else if (Array.isArray(v) && v.every((x) => typeof x === 'number')) o[key] = v.map((x) => x * k);
  }
  return o;
}
