// 主線的區段排程（docs/campaign-design.md 5.5 的第 8 點）：出擊開始時替每個區段決定主題變體、地標、時間與天候、
// 作戰區域形狀，讓同一次出擊（之後擴充到同一章）看起來兩兩不同。純函式，亂數由呼叫端傳入（rand：() → [0, 1)）。
import { landmarkKeys } from '../world/landmarks.js';
import { transMode } from './campaign.js';
import { VARIANTS, variantKeys } from '../world/variants.js';

export const TODS = ['day', 'dusk', 'night', 'dawn'];
export const TOD_NAMES = { day: '白天', dusk: '黃昏', night: '夜間', dawn: '黎明' };
export const ZONE_NAMES = { full: '全區', long: '狹長地帶', arena: '小型戰場', staged: '分段開放' };
// 中途變天：各主題可以換成的天候（null＝主題預設）
const ALT_WEATHER = {
  wasteland: ['ash', 'rain', 'sand'],
  desert: ['dust', 'ash'],
  dunes: ['sand'],
  snow: ['snow'],
  industrial: ['rain'],
};

const pickBy = (rand, arr) => arr[Math.floor(rand() * arr.length) % arr.length];
// 從候選裡挑：先排除這次出擊用過的，再優先最近（recent）沒出現的
function pickFresh(rand, cands, used, recent) {
  let c = cands.filter((k) => !used.has(k));
  if (!c.length) c = cands.slice();
  const score = (k) => {
    const i = recent.lastIndexOf(k);
    return i < 0 ? -1 : i;
  };
  const best = Math.min(...c.map(score));
  return pickBy(
    rand,
    c.filter((k) => score(k) === best),
  );
}

// so：出擊定義；recent：最近用過的「主題|變體」與「主題|地標」（存檔裡，跨出擊避免重複）
export function planSortie(so, rand, recent = []) {
  const used = new Set();
  const out = [];
  let tod = Math.floor(rand() * 2); // 白天或黃昏出發，之後依區段往後推
  let prevZone = '';
  let prevTod = '';
  let depth = 0;
  so.segs.forEach((seg, i) => {
    // 深度：同一個垂直主題每往下一段 +1，換主題時歸零
    if (i > 0) depth = transMode(so.segs[i - 1], seg) === 'down' ? depth + 1 : 0;
    const th = seg.theme;
    const all = variantKeys(th);
    const border = all.filter((k) => VARIANTS[th][k].border);
    const normal = seg.variants
      ? seg.variants.filter((k) => all.includes(k))
      : all.filter((k) => !VARIANTS[th][k].border);
    let variant = seg.variant || null;
    if (!variant && seg.border && border.length) variant = pickBy(rand, border);
    if (!variant && normal.length)
      variant = pickFresh(
        rand,
        normal.map((k) => th + '|' + k),
        used,
        recent,
      ).split('|')[1];
    if (variant) used.add(th + '|' + variant);
    const lms = landmarkKeys(th).map((k) => th + '|' + k);
    let landmark = null;
    const boss = seg.pool.length === 1 && seg.pool[0] === 'boss';
    if (lms.length && !boss) {
      landmark = pickFresh(rand, lms, used, recent).split('|')[1];
      used.add(th + '|' + landmark);
    }
    // 時間：大約每兩段往後推一格（白天 → 黃昏 → 夜間 → 黎明），連續兩段不一定相同
    if (i > 0 && (i % 2 === 0 || rand() < 0.3)) tod = Math.min(TODS.length - 1, tod + 1);
    let t = TODS[tod];
    if (t === prevTod && i > 0 && rand() < 0.5) t = TODS[Math.min(TODS.length - 1, tod + 1)];
    prevTod = t;
    const alt = ALT_WEATHER[th] || [];
    const weather = alt.length && rand() < 0.3 ? pickBy(rand, alt) : null;
    // 作戰區域形狀：Boss 用全區；精英偏好小型戰場；連續兩段不同
    let zone = 'full';
    if (!boss) {
      const zs = ['full', 'long', 'arena', 'staged'].filter((z) => z !== prevZone);
      zone = pickBy(rand, zs);
    }
    prevZone = zone;
    out.push({ variant, landmark, tod: t, weather, zone, zoneAxis: rand() < 0.5 ? 0 : 1, depth });
  });
  return out;
}
// 這次出擊用到的「主題|變體」「主題|地標」（寫進存檔的 recent）
export function planKeys(so, plan) {
  const k = [];
  plan.forEach((p, i) => {
    const th = so.segs[i].theme;
    if (p.variant) k.push(th + '|' + p.variant);
    if (p.landmark) k.push(th + '|' + p.landmark);
  });
  return k;
}
