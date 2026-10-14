// 過場動畫的目錄：鍵和故事畫面相同（p<周目>＝序章、i<周目>_<章>＝章節開場、o<周目>_<章>＝章末），
// 值是產生器 (ctx：{ cycle, choices }) => 劇本（沒有內容時回傳 null）。播放在 game/cine.js
import { chapterCine } from './chapters.js';
import { c2Aetheric, c2Castron, c2Pre } from './ch2.js';
import { c4Pre, c4Sancta, c4Veerwell } from './ch4.js';
import { c6Beyond, c6Open, c6Pre, c6Seal } from './ch6.js';
import { prologueCine } from './prologue.js';

export const CINES = {};
for (let cyc = 1; cyc <= 3; cyc++) {
  CINES['p' + cyc] = (ctx) => prologueCine({ ...ctx, cycle: cyc });
  for (let ch = 1; ch <= 6; ch++) {
    CINES[`i${cyc}_${ch}`] = (ctx) => chapterCine(ch, 'intro', { ...ctx, cycle: cyc });
    if (ch < 6) CINES[`o${cyc}_${ch}`] = (ctx) => chapterCine(ch, 'outro', { ...ctx, cycle: cyc });
  }
}

// 抉擇演出：x_<抉擇>_pre（選前，在目前的戰場上播）、x_<抉擇>_<選項>（選後的代價）
Object.assign(CINES, {
  x_c2_pre: c2Pre,
  x_c2_castron: c2Castron,
  x_c2_aetheric: c2Aetheric,
  x_c4_pre: c4Pre,
  x_c4_veerwell: c4Veerwell,
  x_c4_sancta: c4Sancta,
  x_c6_pre: c6Pre,
  x_c6_open: c6Open,
  x_c6_seal: c6Seal,
  x_c6_beyond: c6Beyond,
});
