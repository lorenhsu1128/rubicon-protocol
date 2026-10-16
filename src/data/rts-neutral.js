// Coral 戰爭（RTS）的中立（docs/rts-design.md 13.6；D 包負責內容）：野怪、營地編成、掉寶、傭兵、中立建築。
// 不可 import rts-units.js（rts-units.js 在檔尾把 RTS_CREEP_DEFS、RTS_NEUTRAL_DEFS 併進 RTS_DEFS）。
//
// RTS_CREEP_DEFS[id]：kind 'unit'、creep: true、faction 'neutral'、name、asm／modelKind／vehKey、atk、arm、armor、hp、dps、
//   range、speed、sight、lv、slots
// RTS_NEUTRAL_DEFS[id]：kind 'bld'、faction 'neutral'、inv: true（打不壞、noLock）、name、foot、height、sight、
//   buildModel(pal)（模型；沒有時用 render/rts-models.js 的 buildRtsBuilding）；n_tavern、n_shop、n_merc
export const RTS_CREEP_DEFS = {};
export const RTS_NEUTRAL_DEFS = {};
// 營地編成 RTS_CAMPS[主題][tier]＝[[野怪 id, ...], ...]（2～3 套）；掉寶表；傭兵 RTS_MERCS[主題]
export const RTS_CAMPS = {};
export const RTS_LOOT = {};
export const RTS_MERCS = {};
