// 初始值、模板、樣式預設

import { clone, merge } from './util.js';

export const BASE = {
  mode: 'message',
  text: '',
  subText: '',
  subPosition: 'below',
  width: 1280,
  height: 720,
  anchor: 'mc',
  marginX: 64,
  marginY: 56,
  offsetX: 0,
  offsetY: 0,
  writing: 'h',
  align: 'center',
  autoFit: true,
  wrapChars: 0,
  pageSplit: true,
  fontId: 'noto-serif-tc',
  weight: 900,
  italic: false,
  fontSize: 120,
  letterSpacing: 0.1,
  lineHeight: 1.5,
  subFontId: 'same',
  subWeight: 400,
  subItalic: false,
  subSize: 0.3,
  subLetterSpacing: 0.3,
  subGap: 0.3,
  subColorOn: false,
  subColor: '#ffffff',
  fill: { type: 'solid', color: '#ffffff', color2: '#ffd36b', color3: '', dir: 'v' },
  fillOpacity: 1,
  stroke: { on: true, width: 5, color: '#16161c' },
  stroke2: { on: false, width: 6, color: '#ffffff' },
  shadow: { on: true, color: '#000000', opacity: 0.55, blur: 12, x: 0, y: 5 },
  glow: { on: false, color: '#7cb2ff', size: 26, strength: 1 },
  glitchColor: '#ff2d6a',
  glitchColor2: '#2de2ff',
  cursorColor: '',
  deco: {
    type: 'none', color: '#000000', opacity: 0.55, color2: '#ffffff', pad: 0.4, extend: 0.8, thickness: 3, outline: false,
    soft: 0.5, sideFade: 0.3, radius: 0.2, anim: 'grow', dur: 0.45,
    tapeColor: '#f6c200', tapeStripe: '#141414', tapeSize: 40, tapeSpeed: 90, tapeBlink: 0.4
  },
  bg: { type: 'none', color: '#000000', opacity: 0.45, sync: true },
  inEnabled: true,
  inFx: 'fade', inDur: 0.6, inStagger: 0, inOrder: 'forward', inEase: 'auto', inPower: 1, inDir: 'left',
  hold: 1.5, holdFx: 'none', holdPower: 1,
  outEnabled: true,
  outFx: 'fade', outDur: 0.6, outStagger: 0, outOrder: 'forward', outEase: 'auto', outPower: 1, outDir: 'left',
  subFx: 'same', subDelay: -0.2,
  startDelay: 0.1, endDelay: 0.3,
  reveal: 'char', cps: 12, glyphDur: 0.35, punctPause: 0.25, linePause: 0.35, lineInterval: 0.9, sweepDur: 1.2,
  pageGap: 0.3, cursor: false, scrollSpeed: 90, scrollFade: true,
  soloSize: 0.55, soloPause: 0.4, soloImpact: 1, spreadHold: 0.5, spreadDur: 0.9,
  // 輸出設定（模板會指定循環方式）
  loop: 'once'
};

const MODE_BASE = {
  message: {},
  trailer: {
    fontId: 'noto-serif-tc', weight: 500, fontSize: 52, letterSpacing: 0.12, lineHeight: 1.9, align: 'center',
    stroke: { on: false }, shadow: { on: true, opacity: 0.7, blur: 10, y: 2 },
    inFx: 'fade', outFx: 'fade', outDur: 0.8, hold: 2, wrapChars: 24, startDelay: 0.3, endDelay: 0.4
  },
  caption: {
    fontId: 'noto-serif-tc', weight: 700, fontSize: 64, letterSpacing: 0.12, anchor: 'bl', marginX: 72, marginY: 64,
    align: 'left', subSize: 0.38, subGap: 0.25, stroke: { on: false }, shadow: { on: true, opacity: 0.75, blur: 10, y: 3 },
    inFx: 'rise', inDur: 0.7, inStagger: 0.05, outFx: 'fade', outDur: 0.7, hold: 2.5, subFx: 'fade', subDelay: -0.3
  }
};

export function defaults(mode) {
  return merge(merge(clone(BASE), MODE_BASE[mode] || {}), { mode });
}

const L = (zh, en) => ({ 'zh-TW': zh, en });

/* ---------- 訊息模式的分類 ---------- */
export const MESSAGE_GROUPS = [
  { id: 'combat', label: L('戰鬥', 'Combat') },
  { id: 'investigation', label: L('探索・事件', 'Investigation') },
  { id: 'gm', label: L('GM', 'GM') },
  { id: 'scene', label: L('場景・時間', 'Scene & Time') },
  { id: 'dice', label: L('檢定', 'Dice'), systems: [
    { id: 'coc7', label: L('CoC 7版', 'CoC 7e') },
    { id: 'coc6', label: L('CoC 6版', 'CoC 6e') },
    { id: 'dnd', label: L('D&D 5e', 'D&D 5e') },
    { id: 'generic', label: L('通用', 'Generic') }
  ] }
];

/* ---------- 共用設計 ---------- */
const BATTLE = {
  fontId: 'noto-serif-tc', weight: 900, fontSize: 128, letterSpacing: 0.14,
  subFontId: 'cinzel', subWeight: 700, subSize: 0.2, subLetterSpacing: 0.6, subGap: 0.55,
  fill: { type: 'solid', color: '#ffffff' }, stroke: { on: false }, stroke2: { on: false },
  shadow: { on: true, opacity: 0.4, blur: 10, y: 3 },
  deco: { type: 'frame', color: '#000000', opacity: 0, color2: '#ffffff', thickness: 3, pad: 0.3, extend: 12, anim: 'grow', dur: 0.6 },
  inFx: 'drop', inDur: 0.55, inStagger: 0.09, inPower: 1.1, hold: 1.4, outFx: 'zoomThrough', outDur: 0.5, subFx: 'fade', subDelay: -0.1
};
const ROUND = {
  fontId: 'cinzel', weight: 900, fontSize: 132, letterSpacing: 0.08,
  subFontId: 'noto-serif-tc', subWeight: 700, subSize: 0.28, subLetterSpacing: 0.5, subGap: 0.35,
  fill: { type: 'gradient', color: '#fff6d8', color2: '#d9a441', dir: 'v' }, stroke: { on: true, width: 3, color: '#2a1a05' },
  shadow: { on: true, opacity: 0.6, blur: 14, y: 4 }, glow: { on: true, color: '#ffb84d', size: 30, strength: 0.6 },
  deco: { type: 'sides', color2: '#e8c06a', thickness: 3, extend: 2.2, pad: 0.4, anim: 'grow', dur: 0.5 },
  inFx: 'slam', inDur: 0.6, hold: 1.2, outFx: 'fade', outDur: 0.45, subFx: 'fade', subDelay: -0.1
};
const ALERT = {
  fontId: 'noto-sans-tc', weight: 900, fontSize: 110, letterSpacing: 0.08,
  subFontId: 'oswald', subWeight: 700, subSize: 0.26, subLetterSpacing: 0.45, subGap: 0.45,
  fill: { type: 'solid', color: '#ffffff' }, stroke: { on: true, width: 3, color: '#2a0006' }, shadow: { on: true, opacity: 0.6, blur: 8, y: 4 },
  deco: { type: 'band', color: '#c4001d', opacity: 0.85, pad: 0.35, soft: 0.15, sideFade: 0.25, anim: 'grow', dur: 0.4 },
  inFx: 'shrinkIn', inDur: 0.45, inStagger: 0.04, holdFx: 'shake', holdPower: 0.6, hold: 1.6, outFx: 'glitch', outDur: 0.45, subFx: 'tracking'
};
const SYSTEM = {
  fontId: 'noto-sans-tc', weight: 700, fontSize: 70, letterSpacing: 0.12,
  subPosition: 'above', subFontId: 'share-tech-mono', subWeight: 400, subSize: 0.32, subLetterSpacing: 0.35, subGap: 0.45,
  fill: { type: 'solid', color: '#ffffff' }, stroke: { on: false }, shadow: { on: true, color: '#00081a', opacity: 0.6, blur: 8, y: 2 },
  glow: { on: true, color: '#3d8bff', size: 12, strength: 0.5 }, subColorOn: true, subColor: '#93c5ff',
  deco: { type: 'box', color: '#071a35', opacity: 0.86, color2: '#3d8bff', pad: 0.55, thickness: 2, radius: 0.12, anim: 'grow', dur: 0.4 },
  inFx: 'wipe', inDir: 'lr', inDur: 0.5, hold: 2, outFx: 'wipe', outDir: 'lr', outDur: 0.4, subFx: 'typewriter', subDelay: -0.3, loop: 'infinite'
};
const CHAPTER = {
  fontId: 'noto-serif-tc', weight: 700, fontSize: 96, letterSpacing: 0.3,
  subFontId: 'cormorant-garamond', subWeight: 700, subSize: 0.3, subLetterSpacing: 0.4, subGap: 0.5, subPosition: 'above',
  stroke: { on: false }, shadow: { on: true, opacity: 0.6, blur: 14, y: 3 },
  deco: { type: 'lines', color2: '#ffffff', thickness: 1.5, extend: 1.2, pad: 0.45, anim: 'grow', dur: 0.9 },
  inFx: 'blurIn', inDur: 1.1, inStagger: 0.08, hold: 2, outFx: 'blurOut', outDur: 0.9, subFx: 'fade', subDelay: -0.4
};
const DICE_GOOD = {
  fontId: 'noto-serif-tc', weight: 900, fontSize: 140, letterSpacing: 0.1,
  subFontId: 'cinzel', subWeight: 700, subSize: 0.22, subLetterSpacing: 0.55, subGap: 0.4,
  fill: { type: 'gradient', color: '#fffbe6', color2: '#f2b632', dir: 'v' }, stroke: { on: true, width: 4, color: '#3b2400' },
  glow: { on: true, color: '#ffcf4d', size: 40, strength: 1 }, shadow: { on: true, opacity: 0.5, blur: 10, y: 4 },
  inFx: 'flash', inDur: 0.6, holdFx: 'glow', holdPower: 1, hold: 1.6, outFx: 'growOut', outDur: 0.5, subFx: 'tracking', loop: 'infinite'
};
const DICE_BAD = {
  fontId: 'yuji-boku', weight: 400, fontSize: 150, letterSpacing: 0.05,
  subFontId: 'cinzel', subWeight: 700, subSize: 0.2, subLetterSpacing: 0.55, subGap: 0.35,
  fill: { type: 'gradient', color: '#ff6b6b', color2: '#7a0010', dir: 'v' }, stroke: { on: true, width: 4, color: '#140003' },
  shadow: { on: true, opacity: 0.8, blur: 16, y: 6 }, glow: { on: false },
  inFx: 'slam', inDur: 0.7, holdFx: 'shake', holdPower: 0.8, hold: 1.6, outFx: 'sink', outDur: 0.6, subFx: 'fade', loop: 'infinite'
};
const DICE_PLAIN = {
  fontId: 'noto-serif-tc', weight: 900, fontSize: 120, letterSpacing: 0.12,
  subFontId: 'cinzel', subWeight: 700, subSize: 0.22, subLetterSpacing: 0.5, subGap: 0.4,
  fill: { type: 'solid', color: '#ffffff' }, stroke: { on: true, width: 4, color: '#14141a' },
  inFx: 'pop', inDur: 0.45, inStagger: 0.06, hold: 1.4, outFx: 'fade', outDur: 0.4, subFx: 'fade', loop: 'infinite'
};
const SAN = {
  fontId: 'zen-antique', weight: 400, fontSize: 120, letterSpacing: 0.1,
  subFontId: 'unifrakturmaguntia', subWeight: 400, subSize: 0.28, subLetterSpacing: 0.25, subGap: 0.35,
  fill: { type: 'solid', color: '#e9e2ff' }, stroke: { on: false }, glow: { on: true, color: '#8a3dff', size: 36, strength: 1.2 },
  shadow: { on: true, opacity: 0.8, blur: 18, y: 0 },
  inFx: 'glitch', inDur: 0.8, holdFx: 'glitch', holdPower: 1, hold: 2, outFx: 'glitch', outDur: 0.6, subFx: 'fade', loop: 'infinite'
};

/* ---------- 新世紀福音戰士（EVA）風格 ---------- */
const EVA_ORANGE = '#ff8a00';
const EVA_TITLE = {
  fontId: 'shippori-mincho-b1', weight: 800, fontSize: 112, letterSpacing: 0.06,
  subFontId: 'cinzel', subWeight: 700, subSize: 0.22, subLetterSpacing: 0.5, subGap: 0.5,
  fill: { type: 'solid', color: '#ffffff' }, stroke: { on: false }, stroke2: { on: false }, shadow: { on: false }, glow: { on: false },
  bg: { type: 'solid', color: '#000000', opacity: 1, sync: false },
  inFx: 'flash', inDur: 0.35, hold: 2, outFx: 'none', outDur: 0.05, subFx: 'fade', subDelay: -0.1, startDelay: 0.3, endDelay: 0.1
};
const EVA_MAGI = {
  ...SYSTEM, fontSize: 72, subFontId: 'share-tech-mono',
  glow: { on: true, color: EVA_ORANGE, size: 14, strength: 0.6 }, subColor: '#ffc27a',
  deco: { ...SYSTEM.deco, color: '#1a0c00', color2: EVA_ORANGE, radius: 0 }
};
const EVA_ALERT = {
  ...ALERT, fontId: 'shippori-mincho-b1', weight: 800,
  deco: { type: 'band', color: '#b00012', opacity: 0.88, pad: 0.35, soft: 0.1, sideFade: 0.2, anim: 'grow', dur: 0.35 }
};

const msg = (id, group, label, text, subText, patch, extra = {}) => ({ id, group, label, text, subText, patch, ...extra });

export const TEMPLATES = {
  message: [
    msg('battle', 'combat', L('戰鬥開始', 'Battle Start'), '戰鬥開始', 'BATTLE START', BATTLE),
    msg('battleEnd', 'combat', L('戰鬥結束', 'Battle End'), '戰鬥結束', 'BATTLE END', { ...BATTLE, inFx: 'fade', inStagger: 0.05, outFx: 'fade' }),
    msg('victory', 'combat', L('勝利', 'Victory'), '勝利', 'VICTORY', { ...ROUND, fontId: 'noto-serif-tc', fontSize: 150, subFontId: 'cinzel', inFx: 'flash', holdFx: 'glow' }),
    msg('finalRound', 'combat', L('最終回合', 'Final Round'), '最終回合', 'FINAL ROUND', {
      ...ALERT, deco: { type: 'tape', pad: 0.35, tapeSize: 36, tapeSpeed: 120, tapeBlink: 0.3, anim: 'grow', dur: 0.45 }
    }),
    ...[1, 2, 3, 4, 5].map(n => msg(`round${n}`, 'combat', L(`第${n}回合`, `Round ${n}`), `ROUND ${n}`, `第${['一', '二', '三', '四', '五'][n - 1]}回合`, ROUND)),
    msg('defeat', 'combat', L('敗北', 'Defeat'), '敗北', 'DEFEAT', { ...DICE_BAD, loop: 'once', holdFx: 'none', outFx: 'blurOut' }),

    msg('evaOperation', 'combat', L('EVA・作戰開始', 'EVA: Operation Start'), '作戰開始', 'OPERATION START', {
      ...BATTLE, fontId: 'shippori-mincho-b1', weight: 800, glow: { on: true, color: EVA_ORANGE, size: 22, strength: 0.6 },
      deco: { ...BATTLE.deco, color2: EVA_ORANGE }
    }),
    msg('evaAtField', 'combat', L('EVA・A.T. 力場', 'EVA: A.T. Field'), 'A.T. 力場全開', 'A.T. FIELD FULL POWER', {
      ...ROUND, fontId: 'shippori-mincho-b1', weight: 800, fontSize: 110, subFontId: 'oswald',
      fill: { type: 'gradient', color: '#fff3e0', color2: '#ffae42', dir: 'v' }, stroke: { on: true, width: 3, color: '#2a1000' },
      glow: { on: true, color: EVA_ORANGE, size: 36, strength: 1 }, deco: { ...ROUND.deco, color2: EVA_ORANGE },
      inFx: 'pop', inStagger: 0.05, holdFx: 'pulse', holdPower: 1, hold: 1.6, outFx: 'shrink', loop: 'infinite'
    }),
    msg('evaBerserk', 'combat', L('EVA・暴走', 'EVA: Berserk'), '暴走', 'BERSERK', {
      ...DICE_BAD, fontId: 'shippori-mincho-b1', weight: 800, fontSize: 170, subFontId: 'oswald',
      inFx: 'slam', holdFx: 'shake', holdPower: 1, outFx: 'glitch', outDur: 0.5
    }),
    msg('explore', 'investigation', L('探索開始', 'Exploration'), '探索開始', 'EXPLORATION', {
      ...CHAPTER, fontSize: 110, letterSpacing: 0.2, subPosition: 'below', inFx: 'rise', inDur: 0.8, inStagger: 0.07, outFx: 'rise'
    }),
    msg('research', 'investigation', L('調查開始', 'Research'), '調查開始', 'RESEARCH', {
      ...SYSTEM, loop: 'once', deco: { ...SYSTEM.deco, color: '#0d1f12', color2: '#3ddc84' }, glow: { on: true, color: '#3ddc84', size: 12, strength: 0.5 }, subColor: '#9cf0bf'
    }),
    msg('emergency', 'investigation', L('緊急事態', 'Emergency'), '緊急事態', 'EMERGENCY', {
      ...ALERT, deco: { type: 'tape', pad: 0.3, tapeSize: 34, tapeSpeed: 140, tapeBlink: 0.5, anim: 'grow', dur: 0.4 }
    }),
    msg('incident', 'investigation', L('事件發生', 'Incident'), '事件發生', 'INCIDENT', ALERT),
    msg('chase', 'investigation', L('追逐開始', 'Chase'), '追逐開始', 'CHASE', {
      ...ALERT, fontId: 'rocknroll-one', inFx: 'slide', inDir: 'right', inStagger: 0.05, holdFx: 'none', outFx: 'slide', outDir: 'left',
      deco: { type: 'band', color: '#111111', opacity: 0.8, pad: 0.3, soft: 0.1, sideFade: 0.5, anim: 'grow', dur: 0.35 }
    }),
    msg('newMessage', 'investigation', L('收到訊息', 'New Message'), '收到一則訊息', 'NEW MESSAGE', { ...SYSTEM, fontSize: 64, loop: 'once' }),
    msg('call', 'investigation', L('來電', 'Incoming Call'), '來電中…', 'INCOMING CALL', {
      ...SYSTEM, fontSize: 70, inFx: 'fade', holdFx: 'pulse', holdPower: 1.2, outFx: 'fade',
      deco: { ...SYSTEM.deco, color: '#0d2416', color2: '#4ade80', radius: 0.6 }, glow: { on: true, color: '#4ade80', size: 12, strength: 0.5 }, subColor: '#a7f3c8'
    }),
    msg('missionClear', 'investigation', L('任務完成', 'Mission Clear'), '任務完成', 'MISSION CLEAR', { ...DICE_GOOD, loop: 'once', holdFx: 'none' }),

    msg('evaAngel', 'investigation', L('EVA・使徒襲來', 'EVA: Angel Attack'), '使徒襲來', 'ANGEL ATTACK', EVA_ALERT),
    msg('evaStations', 'investigation', L('EVA・第一種戰鬥配置', 'EVA: Battle Stations'), '總員第一種戰鬥配置', 'LEVEL-1 BATTLE STATIONS', {
      ...EVA_ALERT, fontSize: 88, deco: { type: 'tape', pad: 0.35, tapeSize: 36, tapeSpeed: 120, tapeBlink: 0.4, anim: 'grow', dur: 0.45 }
    }),
    msg('evaPattern', 'investigation', L('EVA・圖形：藍', 'EVA: Pattern Blue'), '圖形：藍', 'PATTERN BLUE', { ...EVA_MAGI, holdFx: 'blink', holdPower: 0.5 }),
    msg('evaMagi', 'investigation', L('EVA・MAGI 決議', 'EVA: MAGI Approved'), 'MAGI 全員一致：可決', 'MAGI SYSTEM — APPROVED', { ...EVA_MAGI, fontSize: 64, loop: 'once' }),
    msg('evaSync', 'investigation', L('EVA・同步率', 'EVA: Sync Ratio'), '同步率 400%', 'SYNCHRONIZATION RATIO', {
      fontId: 'orbitron', weight: 900, fontSize: 96, letterSpacing: 0.08, subPosition: 'above',
      subFontId: 'share-tech-mono', subWeight: 400, subSize: 0.3, subLetterSpacing: 0.35, subGap: 0.4, subColorOn: true, subColor: '#a6ffb8',
      fill: { type: 'solid', color: '#eaffef' }, stroke: { on: false }, shadow: { on: false }, glow: { on: true, color: '#2bff6a', size: 22, strength: 0.8 },
      inFx: 'flicker', inDur: 0.8, holdFx: 'flicker', holdPower: 0.4, hold: 1.8, outFx: 'flicker', subFx: 'typewriter', loop: 'infinite'
    }),
    msg('evaLimit', 'investigation', L('EVA・活動限界', 'EVA: Active Limit'), '活動限界　05:00', 'INTERNAL BATTERY', {
      fontId: 'orbitron', weight: 700, fontSize: 88, letterSpacing: 0.08, subPosition: 'above',
      subFontId: 'share-tech-mono', subWeight: 400, subSize: 0.32, subLetterSpacing: 0.35, subGap: 0.4, subColorOn: true, subColor: '#ffb0b0',
      fill: { type: 'solid', color: '#ffe4e4' }, stroke: { on: false }, shadow: { on: false }, glow: { on: true, color: '#ff2a2a', size: 18, strength: 0.8 },
      inFx: 'flicker', inDur: 0.6, holdFx: 'blink', holdPower: 0.6, hold: 2, outFx: 'flicker', loop: 'infinite'
    }),
    msg('secret', 'gm', L('請確認祕匿', 'Check Secrets'), '請確認祕匿資訊', 'SECRET', SYSTEM),
    msg('processing', 'gm', L('祕匿處理中', 'Processing'), '祕匿處理中', 'PROCESSING', { ...SYSTEM, holdFx: 'blink', holdPower: 0.5 }),
    msg('roleplay', 'gm', L('請角色扮演', 'Roleplay'), '請自由角色扮演', 'ROLEPLAY TIME', {
      fontId: 'huninn', weight: 400, fontSize: 84, letterSpacing: 0.08, subFontId: 'righteous', subWeight: 400, subSize: 0.3, subGap: 0.4,
      fill: { type: 'solid', color: '#ffffff' }, stroke: { on: true, width: 5, color: '#ff7a59' }, stroke2: { on: false },
      shadow: { on: true, opacity: 0.35, blur: 6, y: 4 }, inFx: 'pop', inDur: 0.5, inStagger: 0.05, holdFx: 'float', hold: 2, outFx: 'shrink', loop: 'infinite'
    }),
    msg('break', 'gm', L('休息中', 'On Break'), '休息中', 'BREAK TIME', {
      fontId: 'huninn', weight: 400, fontSize: 110, letterSpacing: 0.1, subFontId: 'righteous', subWeight: 400, subSize: 0.28, subGap: 0.4,
      fill: { type: 'solid', color: '#ffffff' }, stroke: { on: true, width: 6, color: '#6b4a2b' }, shadow: { on: true, opacity: 0.3, blur: 4, y: 5 },
      deco: { type: 'box', color: '#f4e4c9', opacity: 0.92, color2: '#6b4a2b', thickness: 4, pad: 0.5, radius: 0.5, anim: 'grow', dur: 0.45 },
      inFx: 'bounce', inDur: 0.9, inStagger: 0.08, holdFx: 'wave', hold: 2.4, outFx: 'fade', loop: 'infinite'
    }),
    msg('xcard', 'gm', L('X卡', 'X-Card'), 'X卡', 'X-CARD', {
      fontId: 'noto-sans-tc', weight: 900, fontSize: 150, subFontId: 'oswald', subWeight: 700, subSize: 0.22, subLetterSpacing: 0.6, subGap: 0.35,
      fill: { type: 'solid', color: '#ffffff' }, stroke: { on: false }, shadow: { on: true, opacity: 0.5, blur: 10, y: 3 },
      deco: { type: 'box', color: '#2b2f3a', opacity: 0.9, color2: '#ffffff', thickness: 3, pad: 0.45, radius: 0.15, anim: 'fade', dur: 0.4 },
      inFx: 'fade', hold: 3, outFx: 'fade', loop: 'infinite'
    }),
    msg('loading', 'gm', L('Now Loading', 'Now Loading'), 'Now Loading...', '', {
      fontId: 'orbitron', weight: 700, fontSize: 72, letterSpacing: 0.12, fill: { type: 'solid', color: '#e8f4ff' }, stroke: { on: false },
      glow: { on: true, color: '#4cc3ff', size: 18, strength: 0.8 }, inFx: 'typewriter', inStagger: 0.08, holdFx: 'wave', hold: 1.2, outFx: 'fade', loop: 'infinite'
    }),
    msg('simple', 'gm', L('簡單文字', 'Simple Text'), '簡單文字', '', {
      fontId: 'noto-sans-tc', weight: 700, fontSize: 96, inFx: 'fade', outFx: 'fade'
    }),

    msg('chapter', 'scene', L('章節標題', 'Chapter'), '第一章　霧中之館', 'CHAPTER I', CHAPTER),
    msg('prologue', 'scene', L('序章', 'Prologue'), '序章', 'PROLOGUE', { ...CHAPTER, fontSize: 130 }),
    msg('epilogue', 'scene', L('尾聲', 'Epilogue'), '尾聲', 'EPILOGUE', { ...CHAPTER, fontSize: 130, inFx: 'fade', inDur: 1.4 }),
    msg('intermission', 'scene', L('幕間', 'Intermission'), '幕間', 'INTERMISSION', {
      ...CHAPTER, fontSize: 120, deco: { type: 'band', color: '#000000', opacity: 0.6, pad: 0.55, soft: 0.6, sideFade: 0.6, anim: 'grow', dur: 0.8 }, inFx: 'shutter', inDir: 'v', inDur: 0.8, outFx: 'shutter', outDir: 'v'
    }),
    msg('flashback', 'scene', L('回憶', 'Flashback'), '回憶', 'FLASHBACK', {
      ...CHAPTER, fontId: 'lxgw-wenkai-tc', weight: 400, fontSize: 120, fill: { type: 'solid', color: '#f3e6c8' }, glow: { on: true, color: '#f3e6c8', size: 30, strength: 0.6 },
      bg: { type: 'vignette', color: '#2a1d0f', opacity: 0.7, sync: true }, inFx: 'emerge', inDur: 1.4, outFx: 'blurOut', outDur: 1.2
    }),
    msg('day1', 'scene', L('第一天', 'Day 1'), '第一天', 'DAY 1', { ...CHAPTER, fontSize: 120, subPosition: 'below', inFx: 'tracking', inDur: 1.2, outFx: 'tracking' }),
    msg('dayLater', 'scene', L('一天後', 'One Day Later'), '一天後', 'ONE DAY LATER', { ...CHAPTER, fontSize: 110, subPosition: 'below', inFx: 'fade', inDur: 1 }),
    msg('nextMorning', 'scene', L('隔天早上', 'Next Morning'), '隔天早上', 'NEXT MORNING', {
      ...CHAPTER, fontSize: 110, subPosition: 'below', fill: { type: 'gradient', color: '#fff9e6', color2: '#ffc36b', dir: 'v' }, glow: { on: true, color: '#ffcf80', size: 30, strength: 0.6 }, inFx: 'rise'
    }),
    msg('midnight', 'scene', L('深夜', 'Midnight'), '深夜', 'MIDNIGHT', {
      ...CHAPTER, fontSize: 130, subPosition: 'below', fill: { type: 'solid', color: '#dfe6ff' }, glow: { on: true, color: '#5c6bff', size: 34, strength: 0.8 },
      bg: { type: 'vignette', color: '#020414', opacity: 0.6, sync: true }, inFx: 'blurIn'
    }),
    msg('timeSkip', 'scene', L('時間流逝', 'Time Skip'), '數小時後', 'SOME HOURS LATER', { ...CHAPTER, fontSize: 100, subPosition: 'below', inFx: 'flicker', inDur: 0.9, outFx: 'flicker' }),

    msg('evaTitle', 'scene', L('EVA・標題卡', 'EVA: Title Card'), '第壹話　使徒、襲來', 'ANGEL ATTACK', EVA_TITLE),
    msg('evaNext', 'scene', L('EVA・次回預告', 'EVA: Next Episode'), '次回預告', 'NEXT EPISODE', { ...EVA_TITLE, fontSize: 150, letterSpacing: 0.12 }),
    msg('evaCongrats', 'scene', L('EVA・恭喜', 'EVA: Congratulations'), '恭喜', 'CONGRATULATIONS', {
      ...CHAPTER, fontId: 'shippori-mincho-b1', weight: 800, fontSize: 140, subPosition: 'below',
      fill: { type: 'gradient', color: '#fffbe8', color2: '#e8b54a', dir: 'v' }, glow: { on: true, color: '#ffd77a', size: 30, strength: 0.6 },
      inFx: 'blurIn', inDur: 1.4, outFx: 'blurOut', outDur: 1.2
    }),
    msg('coc7Critical', 'dice', L('大成功', 'Critical'), '大成功', 'CRITICAL', DICE_GOOD, { system: 'coc7' }),
    msg('coc7Extreme', 'dice', L('極難成功', 'Extreme'), '極難成功', 'EXTREME SUCCESS', { ...DICE_GOOD, fontSize: 120 }, { system: 'coc7' }),
    msg('coc7Hard', 'dice', L('困難成功', 'Hard'), '困難成功', 'HARD SUCCESS', { ...DICE_GOOD, fontSize: 120, glow: { on: true, color: '#ffd76b', size: 26, strength: 0.6 }, holdFx: 'none' }, { system: 'coc7' }),
    msg('coc7Regular', 'dice', L('一般成功', 'Regular'), '成功', 'REGULAR SUCCESS', DICE_PLAIN, { system: 'coc7' }),
    msg('coc7Failure', 'dice', L('失敗', 'Failure'), '失敗', 'FAILURE', { ...DICE_PLAIN, fill: { type: 'solid', color: '#c9d1e0' }, inFx: 'drop', outFx: 'sink' }, { system: 'coc7' }),
    msg('coc7Fumble', 'dice', L('大失敗', 'Fumble'), '大失敗', 'FUMBLE', DICE_BAD, { system: 'coc7' }),
    msg('coc7San', 'dice', L('SAN CHECK', 'SAN Check'), 'SAN CHECK', '理智檢定', { ...SAN, fontId: 'cinzel', weight: 900, subFontId: 'noto-serif-tc', subWeight: 700 }, { system: 'coc7' }),

    msg('coc6Critical', 'dice', L('大成功', 'Critical'), '大成功', 'CRITICAL', DICE_GOOD, { system: 'coc6' }),
    msg('coc6Special', 'dice', L('特殊成功', 'Special'), '特殊成功', 'SPECIAL', { ...DICE_GOOD, fontSize: 120, holdFx: 'none' }, { system: 'coc6' }),
    msg('coc6Success', 'dice', L('成功', 'Success'), '成功', 'SUCCESS', DICE_PLAIN, { system: 'coc6' }),
    msg('coc6Failure', 'dice', L('失敗', 'Failure'), '失敗', 'FAILURE', { ...DICE_PLAIN, fill: { type: 'solid', color: '#c9d1e0' }, inFx: 'drop', outFx: 'sink' }, { system: 'coc6' }),
    msg('coc6Fumble', 'dice', L('大失敗', 'Fumble'), '大失敗', 'FUMBLE', DICE_BAD, { system: 'coc6' }),
    msg('coc6San', 'dice', L('SAN 值檢定', 'Sanity Roll'), 'SAN 值檢定', 'SANITY ROLL', SAN, { system: 'coc6' }),

    msg('nat20', 'dice', L('Natural 20', 'Natural 20'), 'NATURAL 20', '大成功', { ...DICE_GOOD, fontId: 'cinzel-decorative', weight: 900, subFontId: 'noto-serif-tc' }, { system: 'dnd' }),
    msg('nat1', 'dice', L('Natural 1', 'Natural 1'), 'NATURAL 1', '大失敗', { ...DICE_BAD, fontId: 'cinzel-decorative', weight: 900, subFontId: 'noto-serif-tc', subWeight: 700 }, { system: 'dnd' }),
    msg('initiative', 'dice', L('擲先攻', 'Initiative'), '擲先攻！', 'ROLL INITIATIVE', { ...ROUND, fontId: 'noto-serif-tc', fontSize: 120 }, { system: 'dnd' }),
    msg('savingThrow', 'dice', L('豁免檢定', 'Saving Throw'), '豁免檢定', 'SAVING THROW', { ...DICE_PLAIN, deco: { type: 'corners', color2: '#ffffff', thickness: 3, pad: 0.4, anim: 'grow', dur: 0.5 } }, { system: 'dnd' }),

    msg('genSuccess', 'dice', L('成功', 'Success'), '成功', 'SUCCESS', DICE_PLAIN, { system: 'generic' }),
    msg('genFailure', 'dice', L('失敗', 'Failure'), '失敗', 'FAILURE', { ...DICE_PLAIN, fill: { type: 'solid', color: '#c9d1e0' }, inFx: 'drop', outFx: 'sink' }, { system: 'generic' }),
    msg('genCritical', 'dice', L('大成功', 'Critical'), '大成功', 'CRITICAL', DICE_GOOD, { system: 'generic' }),
    msg('genFumble', 'dice', L('大失敗', 'Fumble'), '大失敗', 'FUMBLE', DICE_BAD, { system: 'generic' })
  ],

  trailer: [
    msg('cinematic', null, L('電影感', 'Cinematic'), '那一夜，霧從海上漫進了小鎮。\n沒有人注意到，\n燈塔的光，已經熄滅了。\n\n──而你們，正站在門前。', '', {
      fontId: 'noto-serif-tc', weight: 500, reveal: 'char', cps: 10, glyphDur: 0.5, inFx: 'blurIn', inPower: 0.8, hold: 2.2, outFx: 'fade', outDur: 1,
      bg: { type: 'solid', color: '#000000', opacity: 0.55, sync: true }
    }),
    msg('typewriter', null, L('打字機', 'Typewriter'), '1925年10月3日\n收到一封沒有寄件人的信。\n信上只寫著一個地址。', '', {
      fontId: 'special-elite', weight: 400, align: 'left', reveal: 'char', cps: 14, inFx: 'typewriter', cursor: true, punctPause: 0.3, linePause: 0.5,
      fill: { type: 'solid', color: '#f1e9d6' }, shadow: { on: true, opacity: 0.6, blur: 4, y: 2 }, outFx: 'fade'
    }),
    msg('syslog', null, L('系統日誌', 'System Log'), '> 連線中……\n> 認證成功\n> 警告：偵測到未知的訊號\n> 正在解析來源──', '', {
      fontId: 'share-tech-mono', weight: 400, align: 'left', anchor: 'ml', reveal: 'char', cps: 22, inFx: 'typewriter', cursor: true, cursorColor: '#4dff9a',
      fill: { type: 'solid', color: '#7dffb2' }, glow: { on: true, color: '#20ff7a', size: 14, strength: 0.6 }, shadow: { on: false },
      bg: { type: 'solid', color: '#020a05', opacity: 0.85, sync: true }, outFx: 'glitch', outDur: 0.5, holdFx: 'flicker'
    }),
    msg('lines', null, L('逐行浮現', 'Line by Line'), '這是一個關於失去的故事。\n也是一個關於找回的故事。\n你準備好了嗎？', '', {
      reveal: 'line', lineInterval: 1, glyphDur: 0.9, inFx: 'rise', outFx: 'fade'
    }),
    msg('sweep', null, L('流暢掃過', 'Smooth Sweep'), '星辰墜落之時\n古老的契約將再次甦醒\n選擇吧，旅人', '', {
      reveal: 'sweep', lineInterval: 1.1, sweepDur: 1.2, glyphDur: 0.6, inFx: 'blurIn', fill: { type: 'gradient', color: '#ffffff', color2: '#b8c8ff', dir: 'h' }, glow: { on: true, color: '#8aa2ff', size: 20, strength: 0.5 }
    }),
    msg('spread', null, L('從中央展開', 'Center Spread'), '命運的齒輪開始轉動', '', {
      reveal: 'spread', fontSize: 72, spreadHold: 0.5, spreadDur: 1, wrapChars: 0, outFx: 'tracking', outDur: 0.9
    }),
    msg('solo', null, L('中央逐字', 'One by One'), '最後的審判', '', {
      reveal: 'solo', fontSize: 96, fontId: 'noto-serif-tc', weight: 900, cps: 3, soloSize: 0.5, soloPause: 0.4, soloImpact: 1.2,
      stroke: { on: true, width: 4, color: '#1a0000' }, fill: { type: 'gradient', color: '#ffffff', color2: '#ff9c9c', dir: 'v' }, outFx: 'zoomThrough', outDur: 0.6
    }),
    msg('allAtOnce', null, L('全文同時', 'All at Once'), '請注意\n本劇本含有恐怖、暴力等描寫', '', {
      reveal: 'all', glyphDur: 1, inFx: 'fade', hold: 3, fontId: 'noto-sans-tc', weight: 500
    }),
    msg('credits', null, L('片尾捲動', 'End Credits'), 'KEEPER\n某某\n\nPLAYERS\n甲　乙　丙　丁\n\nSCENARIO\n霧之館殺人事件\n\nThank you for playing!', '', {
      reveal: 'scroll', scrollSpeed: 80, wrapChars: 0, fontSize: 44, lineHeight: 1.8, inFx: 'fade'
    })
  ],

  caption: [
    msg('converge', null, L('上下匯合', 'Converge'), '舊校舍　二樓走廊', '放學後 16:30', { inFx: 'converge', inDur: 0.8, inStagger: 0.03, outFx: 'diverge' }),
    msg('float', null, L('浮現', 'Float Up'), '圖書室', '下午 5:12', { inFx: 'rise', inStagger: 0.06 }),
    msg('cinema', null, L('電影字距', 'Cinematic Tracking'), '東京・新宿', 'TOKYO / SHINJUKU', {
      anchor: 'mc', align: 'center', fontSize: 72, letterSpacing: 0.3, inFx: 'tracking', inDur: 1.6, outFx: 'tracking', outDur: 1.2, subFontId: 'cormorant-garamond', subWeight: 700, subLetterSpacing: 0.5
    }),
    msg('clock', null, L('時刻顯示', 'Time Stamp'), '23:47', '某處的公寓', {
      fontId: 'orbitron', weight: 700, fontSize: 88, subFontId: 'noto-sans-tc', subWeight: 500, subPosition: 'above', inFx: 'flicker', inDur: 0.8, outFx: 'flicker',
      glow: { on: true, color: '#ff4d4d', size: 16, strength: 0.7 }, fill: { type: 'solid', color: '#ffdede' }
    }),
    msg('underline', null, L('底線滑入（左下）', 'Underline (bottom left)'), '港口倉庫', '午夜 0:15', {
      inFx: 'slide', inDir: 'left', inStagger: 0.03, outFx: 'slide', outDir: 'left',
      deco: { type: 'underline', color2: '#ffffff', thickness: 2, pad: 0.2, extend: 0.6, anim: 'grow', dur: 0.7 }
    }),
    msg('vertical', null, L('直排（右上）', 'Vertical (top right)'), '神社　本殿', '夜半', {
      writing: 'v', anchor: 'tr', align: 'left', fontId: 'zen-old-mincho', weight: 700, inFx: 'wipe', inDir: 'tb', inDur: 1, outFx: 'fade',
      deco: { type: 'bar', color2: '#c8102e', thickness: 3, pad: 0.35, anim: 'grow', dur: 0.8 }
    }),
    msg('boxed', null, L('方框（左上）', 'Boxed (top left)'), '地下研究所　B3', 'LABORATORY', {
      anchor: 'tl', fontId: 'noto-sans-tc', weight: 700, fontSize: 52, subFontId: 'share-tech-mono', subWeight: 400, subPosition: 'above', subColorOn: true, subColor: '#7fd1ff',
      deco: { type: 'box', color: '#06121f', opacity: 0.8, color2: '#7fd1ff', thickness: 1.5, pad: 0.45, radius: 0.08, anim: 'grow', dur: 0.5 }, inFx: 'wipe', inDir: 'lr', outFx: 'wipe', outDir: 'lr'
    }),
    msg('bandCaption', null, L('色帶（下方）', 'Band (bottom)'), '某大學　醫學部', '2月14日　晴', {
      anchor: 'bc', align: 'center', inFx: 'fade', inStagger: 0.04,
      deco: { type: 'band', color: '#000000', opacity: 0.6, pad: 0.4, soft: 0.5, sideFade: 0.6, anim: 'grow', dur: 0.6 }
    })
  ]
};

/* ---------- 裝飾分頁的樣式預設（一鍵配色） ---------- */
export const STYLE_PRESETS = [
  { id: 'plain', label: L('白字黑邊', 'White + outline'), patch: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 1, stroke: { on: true, width: 5, color: '#16161c' }, stroke2: { on: false }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.55, blur: 12, x: 0, y: 5 } } },
  { id: 'gold', label: L('金', 'Gold'), patch: { fill: { type: 'gradient', color: '#fff6cf', color2: '#d49a2a', color3: '', dir: 'v' }, fillOpacity: 1, stroke: { on: true, width: 3, color: '#3a2200' }, stroke2: { on: false }, glow: { on: true, color: '#ffbf47', size: 26, strength: 0.6 }, shadow: { on: true, color: '#000000', opacity: 0.5, blur: 10, x: 0, y: 4 } } },
  { id: 'silver', label: L('銀', 'Silver'), patch: { fill: { type: 'gradient', color: '#ffffff', color2: '#8e99a8', color3: '', dir: 'v' }, fillOpacity: 1, stroke: { on: true, width: 3, color: '#1d232c' }, stroke2: { on: false }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.5, blur: 10, x: 0, y: 4 } } },
  { id: 'blood', label: L('血', 'Blood'), patch: { fill: { type: 'gradient', color: '#ff5a5a', color2: '#6b0010', color3: '', dir: 'v' }, fillOpacity: 1, stroke: { on: true, width: 3, color: '#120002' }, stroke2: { on: false }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.8, blur: 16, x: 0, y: 6 } } },
  { id: 'neon', label: L('霓虹', 'Neon'), patch: { fill: { type: 'solid', color: '#f5fbff' }, fillOpacity: 1, stroke: { on: true, width: 2, color: '#26c6ff' }, stroke2: { on: false }, glow: { on: true, color: '#18b4ff', size: 34, strength: 1.4 }, shadow: { on: false } } },
  { id: 'eerie', label: L('詭譎紫', 'Eerie purple'), patch: { fill: { type: 'solid', color: '#efe4ff' }, fillOpacity: 1, stroke: { on: false }, stroke2: { on: false }, glow: { on: true, color: '#8f3dff', size: 36, strength: 1.2 }, shadow: { on: true, color: '#000000', opacity: 0.7, blur: 18, x: 0, y: 0 } } },
  { id: 'pop', label: L('普普風', 'Pop'), patch: { fill: { type: 'solid', color: '#fff36b' }, fillOpacity: 1, stroke: { on: true, width: 6, color: '#ff3d7f' }, stroke2: { on: true, width: 6, color: '#ffffff' }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.35, blur: 0, x: 6, y: 6 } } },
  { id: 'ghost', label: L('幽魂', 'Ghost'), patch: { fill: { type: 'solid', color: '#d9f3ff' }, fillOpacity: 0.75, stroke: { on: false }, stroke2: { on: false }, glow: { on: true, color: '#b8ecff', size: 40, strength: 0.8 }, shadow: { on: false } } },
  { id: 'ink', label: L('墨（亮背景用）', 'Ink (light BG)'), patch: { fill: { type: 'solid', color: '#141414' }, fillOpacity: 1, stroke: { on: true, width: 5, color: '#ffffff' }, stroke2: { on: false }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.25, blur: 8, x: 0, y: 2 } } },
  { id: 'hollow', label: L('鏤空', 'Hollow'), patch: { fill: { type: 'solid', color: '#ffffff' }, fillOpacity: 0, stroke: { on: true, width: 2.5, color: '#ffffff' }, stroke2: { on: false }, glow: { on: false }, shadow: { on: true, color: '#000000', opacity: 0.6, blur: 8, x: 0, y: 2 } } }
];

export const GRADIENT_PRESETS = [
  ['#fff6cf', '#d49a2a', ''], ['#ffffff', '#8e99a8', ''], ['#ff5a5a', '#6b0010', ''], ['#e0f7ff', '#3a7bff', ''],
  ['#fdfbff', '#b07cff', ''], ['#fff0f6', '#ff5fa2', ''], ['#ffe259', '#ffa751', ''], ['#a8ff78', '#2fb36b', ''],
  ['#ff6b6b', '#ffd93d', '#6bcbff']
];

export const SIZE_PRESETS = [
  { id: '1920x1080', w: 1920, h: 1080, label: '1920 × 1080（16:9 FHD）' },
  { id: '1280x720', w: 1280, h: 720, label: '1280 × 720（16:9 HD）' },
  { id: '960x540', w: 960, h: 540, label: '960 × 540（16:9 輕量）' },
  { id: '1280x360', w: 1280, h: 360, label: '1280 × 360（橫長帶狀）' },
  { id: '1024x256', w: 1024, h: 256, label: '1024 × 256（字幕條）' },
  { id: '1080x1080', w: 1080, h: 1080, label: '1080 × 1080（正方形）' },
  { id: '720x1280', w: 720, h: 1280, label: '720 × 1280（直式 9:16）' }
];

export function findTemplate(mode, id) {
  return (TEMPLATES[mode] || []).find(t => t.id === id) || null;
}

// 套用模板：模式預設 → 模板設計 → 保留尺寸（使用者可能已改過）
export function applyTemplate(mode, tpl, keep = {}) {
  const s = defaults(mode);
  merge(s, tpl.patch || {});
  s.text = tpl.text;
  s.subText = tpl.subText || '';
  s.template = tpl.id;
  s.loop = tpl.patch?.loop || 'once';
  if (keep.width) { s.width = keep.width; s.height = keep.height; }
  return s;
}
