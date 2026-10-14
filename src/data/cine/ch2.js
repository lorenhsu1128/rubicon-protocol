// 第 2 章 工業帶的契約：開場／章末（依抉擇 1）與抉擇 1 的演出（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[2]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import {
  G,
  W,
  black,
  boss,
  chapterCard,
  choicePost,
  choicePre,
  comm,
  cut,
  hero,
  rival,
  shootout,
  timeline,
  vista,
} from './kit.js';

const IND = W('industrial', { seed: 6201 });
const INDN = W('industrial', { tod: 'night', seed: 6204 });
const DAM = W('dam', { seed: 6202 });
const INST = W('institute', { seed: 6302 });
const SNOW = W('snow', { seed: 6301, variant: 'icefield' });
const SNOWN = W('snow', { seed: 6303, tod: 'night', variant: 'icefield' });

// 集散場的作業：起重機砲台、叉架 MT
const yard = [
  { id: 'y1', k: 'type', key: 'crane', p: [6, -10], yaw: 200 },
  { id: 'y2', k: 'type', key: 'forklift', p: [-6, -2], yaw: 90, s: [{ t: 0, go: [10, -2] }] },
  { id: 'y3', k: 'type', key: 'forklift', p: [-12, 3], yaw: 90, s: [{ t: 0, go: [4, 3] }] },
  { id: 'y4', k: 'type', key: 'mt', p: [-2, 8], yaw: 90, s: [{ t: 0, go: [14, 8] }], pal: 'castron' },
];
// 往西走的難民（聖域的友軍護著）
const refugees = [
  {
    id: 'r1',
    k: 'type',
    key: 'mt',
    p: [-14, 0],
    yaw: 270,
    s: [{ t: 0, go: [20, 0] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'r2',
    k: 'type',
    key: 'tank',
    p: [-20, 4],
    yaw: 270,
    s: [{ t: 0, go: [14, 4] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'r3',
    k: 'type',
    key: 'mt',
    p: [-26, 1],
    yaw: 270,
    s: [{ t: 0, go: [8, 1] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'r4',
    k: 'type',
    key: 'repair',
    p: [-18, -3],
    yaw: 270,
    s: [{ t: 0, go: [16, -3] }],
    team: 'ally',
    pal: 'ally',
  },
];
const castronMts = [
  { id: 'k1', k: 'type', key: 'mt', p: [-8, -4], yaw: 270, s: [{ t: 0, go: [16, -4] }], pal: 'castron' },
  { id: 'k2', k: 'type', key: 'mth', p: [-12, 2], yaw: 270, s: [{ t: 0, go: [12, 2] }], pal: 'castron' },
  { id: 'k3', k: 'type', key: 'tank', p: [-4, 6], yaw: 270, s: [{ t: 0, go: [20, 6] }], pal: 'castron' },
];
const aethericMts = [
  { id: 'e1', k: 'type', key: 'mt', p: [-8, -2], yaw: 270, s: [{ t: 0, go: [18, -2] }], pal: 'aetheric' },
  { id: 'e2', k: 'type', key: 'drone', p: [-12, 3], yaw: 270, s: [{ t: 0, go: [14, 3] }] },
  { id: 'e3', k: 'type', key: 'tank', p: [-16, 0], yaw: 270, s: [{ t: 0, go: [10, 0] }], pal: 'aetheric' },
];

export function ch2Intro() {
  const L = pickLines(CHAPTER_TEXT[2].intro);
  const T = timeline();
  T.add(...black('CHAPTER II', '工業帶的契約', 2.6, 'card', [{ t: 0.2, sfx: 'heavy', vol: 0.6, rate: 0.6 }]));
  T.add(...vista(IND, G.day, 'low', L[0], { actors: yard, fi: 0.5 }));
  T.add(...comm(INST, G.under, L[1], { badge: 'aetheric' }));
  T.add(...comm(DAM, G.cold, L[2], { badge: 'castron' }));
  // HALBERD：電磁砲台充能，藍光劃過河谷
  T.add(
    ...boss(DAM, G.cold, 'railgun', 'HALBERD', '超長程電磁砲台', L[3], {
      d: 6.5,
      ev: [
        { t: 1.5, sfx: 'charge', vol: 1, rate: 0.5 },
        { t: 3.2, fx: 'beam', at: [0, 8, -26], to: [60, 6, 40], color: 0x8fe0ff, w: 1.2 },
        { t: 3.2, sfx: 'laserBig', vol: 1, rate: 0.6 },
        { t: 3.2, flash: '#bfe8ff', in: 0.02, hold: 0.06, out: 0.4 },
        { t: 3.3, shake: 1 },
        { t: 3.4, boom: [40, 4, 26], big: true },
      ],
    }),
  );
  T.add(
    ...rival(
      DAM,
      G.cold,
      'sluice',
      'SLUICE',
      '水壩守備隊長',
      'SLUICE：「這座水壩後面住著三座城鎮。誰都別想碰它。」',
    ),
  );
  for (const sh of shootout(DAM, G.cold, 'sluice', { lines: [L[4]] })) T.add(...sh);
  T.add(...chapterCard(IND, G.dusk, '第二章　工業帶的契約', 'CHAPTER II'));
  return T.def({
    title: '第二章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch2Outro(ctx) {
  const pick = (ctx.choices || {}).c2 === 'aetheric' ? 'aetheric' : 'castron';
  const L = pickLines(CHAPTER_TEXT[2].outro, { c2: pick });
  const T = timeline();
  T.add(...black('第二章　完', 'AFTERMATH', 2.6));
  if (pick === 'castron') {
    T.add(...comm(INDN, G.night, L[0], { badge: 'castron', actors: castronMts }));
    T.add(...vista(DAM, G.cold, 'crane', L[1]));
    T.add(...vista(SNOW, G.cold, 'low', L[2], { actors: refugees }));
    T.add(...vista(SNOW, G.cold, 'pan', L[3], { actors: aethericMts }));
    T.add(...hero(INDN, G.night, 'walk', L[4]));
  } else {
    T.add(...comm(INST, G.under, L[0], { badge: 'aetheric' }));
    T.add(
      ...vista(DAM, G.cold, 'push', L[1], {
        ev: [0.2, 1.2, 2.2].map((t) => ({
          t,
          fx: 'smoke',
          at: [0, 6, -20],
          r: 6,
          life: 5,
          rise: 6,
          color: 0xd8dce0,
        })),
      }),
    );
    T.add(...vista(SNOW, G.cold, 'low', L[2], { actors: refugees }));
    T.add(...rival(IND, G.day, 'stevedore', 'STEVEDORE', '卡斯特隆的碼頭工頭', L[3]));
    T.add(...hero(INDN, G.night, 'walk', L[4]));
  }
  T.add(...hero(INDN, G.night, 'kneel', L[5]));
  // 冰原上一個難民營的訊號燈熄滅
  T.add(
    ...vista(SNOWN, G.night, 'push', L[6], {
      d: 5,
      ev: [0.3, 1.1, 1.9, 2.7].map((t, i) => ({
        t,
        fx: 'flash',
        at: [0, 3, -18],
        r: 2.5 - i * 0.5,
        color: 0xff5040,
      })),
    }),
  );
  T.shots[T.shots.length - 1].fo = 2;
  return T.def({
    title: '第二章　章末',
    music: [{ at: 0, track: 'cine_tension', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

// ---------- 抉擇 1：主壩的歸屬 ----------
export function c2Pre(ctx) {
  return choicePre(ctx.opts || [], [
    ['合約就是合約。主壩是卡斯特隆的，傭兵。', 'castron', 3.4],
    ['有意思。你會怎麼選呢，R-07？', 'aetheric', 3.4],
  ]);
}
export function c2Castron() {
  return choicePost(
    '主壩：卡斯特隆',
    [
      cut(DAM, G.cold, 'push', '閘門，一道一道關上。', { ev: [{ t: 0.4, sfx: 'door', vol: 1, rate: 0.5 }] }),
      cut(INDN, G.night, 'crane', '工業帶的燈，一盞一盞亮起。', { actors: castronMts }),
      cut(DAM, G.cold, 'pan', '下游的河道，開始乾涸。'),
      cut(SNOW, G.cold, 'low', '有人背起行李，往西走。', { actors: refugees }),
    ],
    ['你守住了合約。', 'CONTRACT FULFILLED'],
  );
}
export function c2Aetheric() {
  return choicePost(
    '主壩：艾瑟立克',
    [
      cut(DAM, G.cold, 'push', '主壩的電力，轉向研究機構。', {
        ev: [{ t: 0.2, fx: 'smoke', at: [0, 6, -20], r: 6, life: 4, rise: 6, color: 0xd8dce0 }],
      }),
      cut(INST, G.under, 'crane', '核心的封印，開始解開。', {
        ev: [{ t: 0.4, fx: 'pillar', at: [0, 0, -14], r: 4, color: 0x5ab8ff }],
      }),
      cut(IND, G.day, 'low', '卡斯特隆的懸賞令，貼滿了工業帶。', { actors: castronMts }),
      rival(
        IND,
        G.day,
        'stevedore',
        'STEVEDORE',
        '卡斯特隆的碼頭工頭',
        'STEVEDORE：「叛徒。我會親手把你拆了。」',
        {
          d: 3.6,
        },
      ),
    ],
    ['你背叛了委託方。', 'CONTRACT BROKEN'],
  );
}
