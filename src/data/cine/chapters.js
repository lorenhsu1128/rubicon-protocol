// 各章的開場／章末過場動畫（game/cine.js 播放）。台詞＝data/story.js 的 CHAPTER_TEXT（依抉擇 pickLines），
// 每一句配一個鏡頭（beat）：鏡頭由各章的 BEATS 依序取用（句子比鏡頭多時重複最後一個），同一個場景的鏡頭沿用同一張地圖。
// 角色的台詞（「名字：「…」」）變成無線電字幕，其他是旁白。
import { CHAPTER_NAMES, CHAPTER_TEXT, pickLines } from '../story.js';
import { ch1Intro, ch1Outro } from './ch1.js';

const NUM = ['', '一', '二', '三', '四', '五', '六'];
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
// 台詞的說話者（名字 → SPEAKERS 的鍵）
const WHO = {
  ECHO: 'echo',
  霍斯特: 'castron',
  薩奇: 'aetheric',
  派克: 'veerwell',
  諾拉: 'sancta',
  米拉: 'mira',
};

// ---------- 場景與調色 ----------
const W = (theme, o = {}) => ({
  k: 'world',
  theme,
  seed: o.seed || 5000 + theme.length * 31,
  clear: o.clear || 30,
  ...o,
});
const G = {
  dusk: { sunAz: 250, sunEl: 8, sunWarm: 0.7, tintHi: '#ffa060', tintHiK: 0.4, fogK: 1.5, dust: 0.5 },
  day: { sunAz: 210, sunEl: 26, sunWarm: 0.3, tintLo: '#2f5a70', tintLoK: 0.3, fogK: 1.4, dust: 0.35 },
  cold: { sunAz: 140, sunEl: 12, tintLo: '#2a4a66', tintLoK: 0.45, contrast: 1.12, fogK: 1.2 },
  night: {
    sunEl: 35,
    tintLo: '#18284a',
    tintLoK: 0.5,
    tintHi: '#ffa070',
    tintHiK: 0.25,
    exposure: 0.85,
    bloom: 1,
  },
  red: {
    sky: 'cloud',
    skyTop: '#2a1030',
    cloud: 0.6,
    fogColor: '#8a3848',
    fogColorK: 0.45,
    sunAz: 200,
    sunEl: 5,
    sunWarm: 0.8,
    tintHi: '#ff6a50',
    tintHiK: 0.5,
    tintLo: '#40204a',
    tintLoK: 0.5,
    bloom: 1.1,
    fogK: 1.6,
  },
  under: { tintLo: '#20405a', tintLoK: 0.5, fogK: 1.4, contrast: 1.1, exposure: 0.95, bloom: 1 },
};

// ---------- 鏡頭的種類（beat）：回傳 { set, grade, actors, cam(dur), ev(dur) } ----------
// 空景：crane 升起／pan 橫移／push 推近／fly 低空飛越
function vista(set, grade, mv = 'crane', o = {}) {
  const P = {
    crane: [
      [-26, 3, 26],
      [-20, 16, 20],
      [10, 6, -14],
      [10, 4, -16],
    ],
    pan: [
      [-30, 5, 20],
      [-6, 5, 30],
      [10, 4, -10],
      [20, 4, -2],
    ],
    push: [
      [0, 7, 34],
      [0, 6, 22],
      [0, 5, -20],
      [0, 6, -20],
    ],
    fly: [
      [-40, 16, 30],
      [10, 9, 10],
      [10, 2, -30],
      [40, 0, -30],
    ],
  }[mv];
  return {
    set,
    grade,
    actors: o.actors || [],
    cam: (d) => ({
      fov: o.fov || 46,
      hand: 0.1,
      fog: 30,
      ease: 'lin',
      keys: [
        { t: 0, p: P[0], l: P[2] },
        { t: d, p: P[1], l: P[3] },
      ],
    }),
    ev: o.ev || (() => []),
  };
}
// 主角：walk 走向鏡頭／boost 突擊推進飛過／hover 懸浮
function hero(set, grade, mode = 'walk', o = {}) {
  const s =
    mode === 'boost'
      ? [
          { t: 0.1, go: [40, -10] },
          { t: 0.3, qb: [1, 0] },
          { t: 1.2, qb: [1, -0.2] },
          { t: 2.1, qb: [1, 0.2] },
        ]
      : mode === 'hover'
        ? [{ t: 0, hover: true, aim: [20, 10, -40] }]
        : [{ t: 0, go: [0, 14] }];
  return {
    set,
    grade,
    actors: [
      { id: 'hero', k: 'hero', p: mode === 'boost' ? [-30, 0] : [0, -6], yaw: mode === 'boost' ? 270 : 0, s },
    ],
    cam: (d) =>
      mode === 'boost'
        ? {
            fov: 44,
            hand: 0.15,
            follow: 8,
            keys: [
              { t: 0, p: [-8, 2, 16], l: { a: 'hero' } },
              { t: d, p: [6, 3, 16], l: { a: 'hero', o: [6, 0, 0] } },
            ],
          }
        : {
            fov: 34,
            hand: 0.1,
            dof: 0.5,
            keys: [
              { t: 0, p: { a: 'hero', o: [3, 1.2, 9] }, l: { a: 'hero', at: 'head' } },
              { t: d, p: { a: 'hero', o: [2.4, 1.0, 6.5] }, l: { a: 'hero', at: 'head' } },
            ],
          },
    ev: o.ev || (() => (mode === 'boost' ? [{ t: 0.2, sfx: 'boostUp', vol: 0.8, rate: 0.8 }] : [])),
  };
}
// 戰鬥：主角對一群敵人（雙方照劇本開火，最後擊破一台）
function fight(set, grade, foes, o = {}) {
  const actors = [
    {
      id: 'hero',
      k: 'hero',
      p: [-16, 6],
      yaw: 270,
      s: [
        { t: 0, go: [16, 8], aim: 'f0' },
        { t: 0.3, fire: ['rarm', 'larm'], dur: 3, at: 'f0' },
        { t: 0.9, qb: [1, -0.3] },
        { t: 1.6, fire: ['rback', 'lback'], dur: 0.8, at: 'f0' },
      ],
    },
    ...foes.map((k, i) => ({
      id: 'f' + i,
      k: k.startsWith('ac_') ? 'roster' : 'type',
      key: k.replace(/^ac_/, ''),
      p: [6 + i * 7, -18 - (i % 2) * 6],
      yaw: 0,
      s: [{ t: 0.2 + i * 0.3, aim: 'hero', fire: 'all', dur: 3 }],
    })),
  ];
  return {
    set,
    grade,
    actors,
    cam: (d) => ({
      fov: 46,
      hand: 0.18,
      follow: 9,
      keys: [
        { t: 0, p: { a: 'hero', o: [-5, 3, 12] }, l: { a: 'hero', o: [6, 0, -10] } },
        { t: d, p: { a: 'hero', o: [-3, 3.5, 11] }, l: { a: 'hero', o: [8, 0, -10] } },
      ],
    }),
    ev: (d) => [
      { t: d * 0.55, a: 'f0', die: true },
      { t: d * 0.6, boom: { a: 'f0' }, kill: true },
      { t: d * 0.62, slow: 0.35, dur: 0.5 },
    ],
  };
}
// Boss（模型）登場：低角度仰拍，周圍爆炸
function boss(set, grade, model, o = {}) {
  const actor =
    model === 'worm'
      ? {
          id: 'boss',
          k: 'worm',
          n: 10,
          keys: [
            { t: 0, p: [0, -24, -30] },
            { t: 1.6, p: [0, 16, -28] },
            { t: 5, p: [10, 20, -16] },
          ],
        }
      : model === 'train'
        ? {
            id: 'boss',
            k: 'train',
            yaw: 90,
            keys: [
              { t: 0, p: [80, 0, 0], lin: true },
              { t: 9, p: [-60, 0, 0], lin: true },
            ],
          }
        : { id: 'boss', k: 'model', key: model, p: [0, 0, -26], yaw: o.yaw || 0, scale: o.scale || 1 };
  return {
    set: model === 'train' ? { ...set, rail: true, align: 'rail', clear: 8 } : set,
    grade,
    actors: [actor, ...(o.actors || [])],
    cam: (d) => ({
      fov: 48,
      hand: 0.2,
      keys: [
        { t: 0, p: model === 'train' ? [-12, 1.2, 8] : [-8, 1.2, 14], l: { a: 'boss', o: [0, 4, 0] } },
        { t: d, p: model === 'train' ? [-14, 1.4, 9] : [-10, 1.6, 18], l: { a: 'boss', o: [0, 6, 0] } },
      ],
      follow: 5,
    }),
    ev: (d) => [
      { t: 0.1, sfx: model === 'worm' ? 'rock1' : 'heavy', vol: 1, rate: 0.55 },
      { t: 0.3, shake: 0.5 },
      ...(model === 'worm' ? [{ t: 0.3, boom: [0, 0, -30], big: true }] : []),
      { t: d * 0.35, boom: { a: 'boss', o: [6, 1, 8] } },
      { t: d * 0.7, boom: { a: 'boss', o: [-7, 1, 10] }, big: true },
      ...(o.name ? [{ t: 0.5, card: o.name[0], s: o.name[1], style: 'name', dur: 2.6 }] : []),
    ],
  };
}
// 宿敵：近拍＋名牌
function rival(set, grade, key, name, line) {
  return {
    set,
    grade,
    actors: [{ id: 'rv', k: 'ace', key, p: [0, -2], yaw: 180, s: [{ t: 0.3, aim: [0, 3, 30] }] }],
    cam: (d) => ({
      fov: 28,
      hand: 0.08,
      dof: 1,
      keys: [
        { t: 0, p: { a: 'rv', at: 'head', o: [1.6, -0.6, 5.5] }, l: { a: 'rv', at: 'head' } },
        { t: d, p: { a: 'rv', at: 'head', o: [1.1, -0.4, 4.2] }, l: { a: 'rv', at: 'head' } },
      ],
    }),
    ev: () => [
      { t: 0.2, sfx: 'charge', vol: 0.5, rate: 0.6, at: { a: 'rv' } },
      { t: 0.4, card: name, s: line || '', style: 'name', dur: 2.6 },
    ],
  };
}
// 通訊：安靜的鏡頭＋監視器掃描線（委託方的頻道）
function comm(set, grade, o = {}) {
  return {
    set,
    grade,
    ov: 'scan',
    actors: [{ id: 'hero', k: 'hero', p: [0, 0], yaw: o.yaw == null ? 30 : o.yaw }],
    cam: (d) => ({
      fov: 36,
      hand: 0.05,
      ease: 'lin',
      keys: [
        { t: 0, p: { a: 'hero', o: [-10, 3, 12] }, l: { a: 'hero', o: [0, 3, 0] } },
        { t: d, p: { a: 'hero', o: [-12, 4, 15] }, l: { a: 'hero', o: [0, 3.5, 0] } },
      ],
    }),
    ev: o.ev || (() => []),
  };
}

// ---------- 各章 ----------
const WASTE = W('wasteland', { tod: 'dusk', seed: 6101 });
const MINE = W('desert', { seed: 6102 });
const DUNE = W('dunes', { seed: 6103, tod: 'dusk' });
const WASTEN = W('wasteland', { tod: 'night', seed: 6104 });
const IND = W('industrial', { seed: 6201 });
const DAM = W('dam', { seed: 6202 });
const FLOOD = W('flooded', { seed: 6203 });
const INDN = W('industrial', { tod: 'night', seed: 6204 });
const SNOW = W('snow', { seed: 6301 });
const INST = W('institute', { seed: 6302 });
const GRID = W('grid086', { seed: 6401 });
const PORT = W('spaceport', { seed: 6402, tod: 'dusk' });
const SEA = W('xylem', { seed: 6501 });
const SEAR = W('xylem', {
  seed: 6502,
  tod: 'dusk',
  light: { sky: 0x4a2238, fog: 0x6a2c3a, sun: 0xff7a50, sunI: 1.2, hemi: 0x6a3050, hemiI: 0.5 },
});
const ORBIT = W('orbit', { seed: 6601 });

const BEATS = {
  1: {
    intro: [
      vista(WASTE, G.dusk, 'crane'),
      vista(WASTE, { ...G.dusk, bloom: 1.2 }, 'push', {
        ev: (d) =>
          [0.2, 1.4, 2.6, 3.8]
            .filter((t) => t < d)
            .map((t) => ({ t, fx: 'pillar', at: [0, 0, -20], r: 3, color: 0xff4030 })),
      }),
      boss(MINE, G.day, 'bunker', { name: ['BASTILLE', '砲兵陣地'], scale: 1.4 }),
      vista(MINE, G.day, 'pan'),
      fight(MINE, G.day, ['mt', 'mt_shot']),
      hero(DUNE, G.dusk, 'boost'),
    ],
    outro: [
      hero(WASTE, G.dusk, 'walk'),
      comm(WASTEN, G.night),
      vista(IND, G.day, 'crane'),
      vista(INST, G.under, 'crane'),
      vista(PORT, G.dusk, 'pan'),
      vista(DAM, G.cold, 'crane'),
      comm(WASTEN, G.night, { yaw: 160 }),
      comm(WASTEN, G.night, { yaw: 200 }),
    ],
  },
  2: {
    intro: [
      vista(IND, G.day, 'fly'),
      vista(DAM, G.cold, 'crane'),
      fight(IND, G.day, ['mt', 'tank', 'mt_shield']),
      boss(DAM, G.cold, 'railgun', { name: ['HALBERD', '超長程電磁砲台'] }),
      rival(DAM, G.cold, 'sluice', 'SLUICE', '水壩守備隊長'),
    ],
    outro: [
      vista(INDN, G.night, 'crane'),
      vista(DAM, G.cold, 'pan'),
      vista(SNOW, G.cold, 'push'),
      hero(SNOW, G.cold, 'walk'),
      comm(INDN, G.night),
      comm(INDN, G.night, { yaw: 120 }),
      vista(SNOW, { ...G.cold, exposure: 0.6 }, 'pan'),
    ],
  },
  3: {
    intro: [
      vista(SNOW, G.cold, 'fly'),
      vista(SNOW, G.cold, 'pan'),
      comm(SNOW, G.cold),
      rival(SNOW, G.cold, 'whiteout', 'WHITEOUT', '難民營的狙擊手'),
      boss(SNOW, G.cold, 'worm', { name: ['SANDWORM', '巨型鑽地蟲'] }),
    ],
    outro: [
      vista(INST, G.under, 'crane'),
      hero(INST, G.under, 'walk'),
      vista(INST, G.under, 'crane'),
      vista(GRID, G.day, 'crane'),
      comm(SNOW, G.cold),
      vista(SNOW, G.cold, 'pan'),
      comm(SNOW, G.cold, { yaw: 200 }),
      rival(INST, G.under, 'specimen', 'SPECIMEN', '「為什麼被選上的是你？」'),
    ],
  },
  4: {
    intro: [
      vista(GRID, G.day, 'crane'),
      vista(PORT, G.dusk, 'push'),
      fight(PORT, G.dusk, ['mt', 'strider']),
      vista(PORT, G.dusk, 'pan'),
      rival(GRID, G.day, 'spire', 'SPIRE', 'Doser 的首領'),
      hero(GRID, G.day, 'hover'),
    ],
    outro: [
      vista(PORT, G.red, 'crane'),
      vista(PORT, G.red, 'pan'),
      vista(SEA, G.day, 'fly'),
      comm(PORT, G.red),
      comm(PORT, G.red, { yaw: 140 }),
      comm(PORT, G.red, { yaw: 220 }),
    ],
  },
  5: {
    intro: [
      vista(SEA, G.day, 'fly'),
      vista(SEA, G.day, 'crane'),
      fight(SEA, G.day, ['mt', 'heli']),
      rival(SEA, G.day, 'undertow', 'UNDERTOW', '洋上都市的守衛'),
      hero(SEA, G.day, 'boost'),
      hero(SEA, G.dusk, 'hover'),
    ],
    outro: [
      vista(SEAR, G.red, 'push'),
      comm(SEAR, G.red),
      vista(SEAR, G.red, 'crane'),
      vista(ORBIT, G.day, 'push'),
      vista(SEAR, G.red, 'pan'),
      comm(SEAR, G.red, { yaw: 150 }),
      comm(SEAR, G.red, { yaw: 200 }),
      hero(SEAR, G.red, 'walk'),
    ],
  },
  6: {
    intro: [
      vista(ORBIT, G.day, 'fly'),
      vista(ORBIT, G.day, 'push'),
      comm(ORBIT, G.day),
      comm(ORBIT, G.day, { yaw: 100 }),
      comm(ORBIT, G.day, { yaw: 160 }),
      comm(ORBIT, G.day, { yaw: 220 }),
      comm(ORBIT, G.day, { yaw: 280 }),
      rival(ORBIT, G.day, 'zenith', 'ZENITH', '上一位鑰匙'),
    ],
    outro: [],
  },
};

// 一句的長度 → 鏡頭秒數
const lineDur = (s) => Math.max(3.4, Math.min(7, 1.6 + s.length * 0.13));
function parseLine(l) {
  const m = /^([^「」：]{1,14})：「(.+)」$/.exec(l);
  if (!m) return { text: l, who: null };
  const name = m[1].replace(/（.*）$/, '');
  return { text: m[2], who: WHO[name] || null, name };
}

// 逐章重做的分鏡（data/cine/ch<章>.js）；沒有的章用下面的模板
const BESPOKE = {
  1: { intro: ch1Intro, outro: ch1Outro },
};

// kind：'intro'｜'outro'
export function chapterCine(ch, kind, ctx) {
  const B = BESPOKE[ch] && BESPOKE[ch][kind];
  if (B) return B(ctx);
  const T = CHAPTER_TEXT[ch];
  const lines = pickLines(T && T[kind], ctx.choices || {});
  const beats = (BEATS[ch] && BEATS[ch][kind]) || [];
  if (!lines.length || !beats.length) return null;
  const shots = [];
  const title = (CHAPTER_NAMES[ch] || '').replace(/^第 \d 章\s*/, '');
  // 開頭：黑底的章節字卡
  let at = 0;
  shots.push({
    at,
    set: { k: 'black' },
    ev: [
      {
        t: 0.3,
        card: kind === 'intro' ? `CHAPTER ${ROMAN[ch]}` : `第${NUM[ch]}章　${title}`,
        s: kind === 'intro' ? '' : 'AFTERMATH',
        dur: 2.2,
      },
      { t: 0.3, sfx: 'thud1', vol: 0.6, rate: 0.6 },
    ],
  });
  at += 3;
  let prevIds = [];
  lines.forEach((line, i) => {
    const b = beats[Math.min(i, beats.length - 1)];
    const L = parseLine(line);
    const d = lineDur(L.text);
    const ids = b.actors.map((a) => a.id);
    // 換場景時演員全部重建；同一個場景時把這一鏡不需要的拿掉、同 id 的重新出場
    const same =
      i > 0 && JSON.stringify(beats[Math.min(i - 1, beats.length - 1)].set) === JSON.stringify(b.set);
    const drop = same ? prevIds : [];
    prevIds = ids;
    const nextB = beats[Math.min(i + 1, beats.length - 1)];
    const cut = i === lines.length - 1 || JSON.stringify(nextB.set) !== JSON.stringify(b.set);
    shots.push({
      at,
      set: b.set,
      grade: b.grade,
      ov: b.ov,
      fi: i === 0 || !same ? 0.5 : 0,
      fo: cut ? 0.35 : 0,
      drop,
      actors: b.actors,
      cam: b.cam(d),
      ev: [{ t: 0.35, sub: L.text, who: L.who, dur: d - 0.5 }, ...(b.ev ? b.ev(d) : [])],
    });
    at += d;
  });
  // 結尾：章名卡（開場）／淡出（章末）
  if (kind === 'intro') {
    const last = shots[shots.length - 1];
    last.fo = 0;
    shots.push({
      at,
      set: last.set,
      grade: last.grade,
      drop: prevIds,
      actors: [{ id: 'heroT', k: 'hero', p: [0, 0], yaw: 200 }],
      fo: 1.4,
      cam: {
        fov: 36,
        hand: 0.06,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'heroT', o: [-7, 1.5, 9] }, l: { a: 'heroT', o: [0, 3, 0] } },
          { t: 5, p: { a: 'heroT', o: [-11, 3, 14] }, l: { a: 'heroT', o: [0, 4, 0] } },
        ],
      },
      ev: [
        { t: 0.2, card: `第${NUM[ch]}章　${title}`, s: `CHAPTER ${ROMAN[ch]}`, style: 'logo', dur: 4.2 },
        { t: 0.2, sfx: 'boom1', vol: 0.7, rate: 0.6 },
      ],
    });
    at += 5.2;
  } else {
    shots[shots.length - 1].fo = 1.6;
  }
  const track = kind === 'intro' ? 'cine_drive' : 'cine_tension';
  return {
    title: kind === 'intro' ? `第${NUM[ch]}章　開場` : `第${NUM[ch]}章　章末`,
    dur: at + 0.3,
    lb: 2.39,
    music: [{ at: 0, track, vol: 0.9, fadeIn: 1, fadeOut: [Math.max(1, at - 3), 3] }],
    shots,
  };
}
