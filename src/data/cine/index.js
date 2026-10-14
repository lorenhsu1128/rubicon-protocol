// 過場動畫的目錄：鍵和故事畫面相同（p<周目>＝序章、i<周目>_<章>＝章節開場、o<周目>_<章>＝章末），
// 值是產生器 (ctx：{ cycle, choices }) => 劇本（沒有內容時回傳 null）。播放在 game/cine.js
import { chapterCine } from './chapters.js';
import { prologueCine } from './prologue.js';

export const CINES = {};
for (let cyc = 1; cyc <= 3; cyc++) {
  CINES['p' + cyc] = (ctx) => prologueCine({ ...ctx, cycle: cyc });
  for (let ch = 1; ch <= 6; ch++) {
    CINES[`i${cyc}_${ch}`] = (ctx) => chapterCine(ch, 'intro', { ...ctx, cycle: cyc });
    if (ch < 6) CINES[`o${cyc}_${ch}`] = (ctx) => chapterCine(ch, 'outro', { ...ctx, cycle: cyc });
  }
}
