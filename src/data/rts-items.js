// Coral 戰爭（RTS）的道具與商店（docs/rts-design.md 13.5；C 包負責內容）。
// 不可 import rts-units.js。
//
// RTS_ITEMS[id]：{ id, name, tier 1～3, cost: { ore, coral }, kind 'use'｜'perm', charges, cd, mods（永久道具的數值層 item）,
//   use, drop（只掉落）, desc }
export const RTS_ITEMS = {};
// 補給商店的貨架（依主堡的層級）、中立商店的庫存規則
export const RTS_SHOP = { tiers: [[], [], []], stock: [3, 2, 1], restock: [60, 90, 120] };
