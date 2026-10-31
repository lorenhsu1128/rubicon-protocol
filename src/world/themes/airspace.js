// 主題：空域（空戰，docs/air-combat-design.md）——約 6 km 見方的海上空域，散布幾座有山的島嶼。
// 只在自由出擊的單人選得到：world.js 把它登記成不可列舉的 THEMES.airspace（隨機選圖、編輯器、實驗室、多人都不會列出）。
// 地形格子 30 m（一般地圖 5 m），霧與鏡頭距離放遠；地圖物件很少（空戰的目標之後另外放）。
import { clamp } from '../../core/math.js';

// 島嶼的地形：低頻的雜訊高於門檻的地方隆起成島（山頂約 200～450 m），其他是海底（-45 m 左右）
function planTerrain(w) {
  const n = w.noise,
    n2 = w.noise2;
  return (x, z) => {
    const a =
      n(x / 1500 + 11.3, z / 1500 + 4.7) * 0.62 +
      n(x / 520 + 2.1, z / 520 + 7.9) * 0.28 +
      n2(x / 150, z / 150) * 0.1;
    const t = (a - 0.56) / 0.3; // 0＝海岸線
    if (t <= 0) return -45 + clamp(t + 1, 0, 1) * 30;
    const m = Math.min(1, t);
    return -15 + m * m * (3 - 2 * m) * 260 + Math.max(0, t - 0.6) * 380 + n2(x / 60, z / 60) * 18 * m;
  };
}

export const AIRSPACE = {
  name: '空域（空戰）',
  air: true, // 進場就是飛行狀態（game/air.js）
  size: 6000, // 公尺（不乘 WS）
  cell: 30,
  ground: 0x5f7a45,
  slope: 0x7a7468,
  rock: 0x8a8a86,
  fog: 0xa9c4dc,
  sky: 0x6f9fd0,
  sun: 0xfff4e0,
  amb: 0x93a9c2,
  container: 0xc8ccd0,
  container2: 0xd8a020,
  hasRocks: false,
  rockY: [150, 140], // 上色：150 m 以上漸漸變成岩石、330 m 以上積雪、海岸沙灘
  snowY: 330,
  shore: [9, 0xc9b98e],
  props: 'airspace',
  water: { level: 0, color: 0x2d5f86, opacity: 0.9, rough: 0.2, wide: true },
  sunI: 1.25,
  fogNear: 140, // ×DS（scaleTheme）：約 420 m～2.7 km
  fogFar: 900,
  featureKinds: [],
  noCorridor: true,
  noTod: true,
  planTerrain,
  buildProps() {},
  propNames: {},
  catalog: [],
};
