// Coral 戰爭（RTS）的英雄（docs/rts-design.md 13.4、13.5；C 包負責內容）：英雄定義、技能、經驗表、酒館的英雄。
// 不可 import rts-units.js（rts-units.js 在檔尾把 RTS_HERO_DEFS 併進 RTS_DEFS；需要的常數各自寫）。
//
// RTS_HERO_DEFS[id]：kind 'unit'、hero: true、faction、name、asm（AC_ROSTER 的組裝）、atk 'hero'、arm 'hero'、armor、
//   hp、dps、range、speed、sight、pop 5、time 55、slots、grow { hp, dps, armor }、skills [4 個技能 id]、card（C／E）
// 卡斯特隆的三位英雄 id（主堡的英雄子選單、RTS_FACTIONS.castron.heroes 已經用這些 id）：h_bastion、h_rain、h_pile；
// 酒館：t_rust、t_sirocco、t_whiteout、t_specimen、t_spire、t_countdown、t_undertow、t_marsh（faction 'neutral'）。
export const RTS_HERO_DEFS = {};
// 技能：{ name, slot 0～3, kind 'unit'｜'point'｜'self'｜'aura'｜'passive', range, lv: [{ coral, cd, ... }], desc }
export const RTS_SKILLS = {};
// 累積經驗表（第 n 級需要的累積經驗；等級上限 10）
export const RTS_HERO_XP = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
// 擊破單位的經驗（依單位的 lv 1～6；建築 0）、擊破英雄的經驗（依英雄等級 1～10）
export const RTS_XP_UNIT = [0, 25, 40, 60, 85, 115, 150];
export const RTS_XP_HERO = [0, 100, 120, 160, 220, 300, 380, 470, 570, 680, 800];
// 野怪的經驗倍率（依英雄等級；5 級以後 0）
export const RTS_XP_CREEP_K = [0, 0.8, 0.7, 0.6, 0.5, 0, 0, 0, 0, 0, 0];
// 酒館的英雄 id（定義也放在 RTS_HERO_DEFS）
export const RTS_TAVERN = [];
