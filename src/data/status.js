// 狀態效果（地圖專屬敵人讓機體失去行動自由的招式）：定義與顯示用的文字、顏色。
// 套用與移動效果在 entities/mech-status.js（MechEntity 的擴充），HUD 與畫面邊緣在 game/status-hud.js。
// esc：掙脫方式（qb1＝QB 一次、qb2＝QB 兩次、melee＝近戰割開、mq＝近戰或 QB 兩次、null＝只能等）
export const STATUS_MAX = 4; // 每種狀態最長幾秒（addStatus 的 sec 會被夾住）
export const STATUS_KINDS = ['hook', 'stick', 'latch', 'slow', 'nojump', 'net', 'spotted', 'drain'];
export const STATUS_DEFS = {
  hook: {
    name: '鋼索鉤住',
    ch: '鉤',
    hex: 0xff9a3a,
    esc: 'qb1',
    desc: '被往敵人拉過去',
    first: '鋼索鉤住 — 按一次 QB 掙脫，否則會被拉過去',
  },
  stick: {
    name: '黏附炸彈',
    ch: '彈',
    hex: 0xff3b30,
    esc: 'qb2',
    desc: '時間到會爆炸',
    first: '黏附炸彈 — 連按兩次 QB 甩掉，時間到會爆炸',
  },
  latch: {
    name: '纏附',
    ch: '纏',
    hex: 0xff4fa8,
    esc: 'mq',
    desc: '持續受損、移動變慢',
    first: '被纏住 — 近戰攻擊割開，或連按兩次 QB 甩掉',
  },
  slow: {
    name: '行動遲緩',
    ch: '緩',
    hex: 0x8fdcff,
    esc: null,
    desc: '移動變慢・QB 耗能增加',
    first: '行動遲緩 — 移動變慢、QB 耗能增加，數秒後解除',
  },
  nojump: {
    name: '無法跳躍',
    ch: '重',
    hex: 0xa98bff,
    esc: null,
    desc: '不能跳躍與懸浮・空中被往下拉',
    first: '無法跳躍 — 不能跳躍與懸浮，空中會被往下拉',
  },
  net: {
    name: '捕獲網',
    ch: '網',
    hex: 0xc8ff4a,
    esc: 'melee',
    desc: '移動變慢・不能跳躍',
    first: '捕獲網 — 移動變慢、不能跳躍，用近戰攻擊割開',
  },
  spotted: {
    name: '被標定',
    ch: '照',
    hex: 0xffe040,
    esc: null,
    desc: '全場敵人知道你的位置',
    first: '被標定 — 全場敵人都知道你的位置，快離開照射範圍',
  },
  drain: {
    name: 'EN 吸取',
    ch: '吸',
    hex: 0x3df0c8,
    esc: null,
    desc: 'EN 持續流失',
    first: 'EN 被吸取 — 能量持續流失，遠離吸取源',
  },
};
// QB 掙脫需要的次數（hook 一次；stick、latch 兩次）
export const STATUS_QB_N = { hook: 1, stick: 2, latch: 2 };
