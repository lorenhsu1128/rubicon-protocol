// 第 5 章 洋上的抉擇：開場／章末（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[5]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { G, W, black, boss, chapterCard, comm, hero, rival, shootout, timeline, vista } from './kit.js';

const SEA = W('xylem', { seed: 6501 });
const SEAR = W('xylem', {
  seed: 6502,
  tod: 'dusk',
  light: { sky: 0x4a2238, fog: 0x6a2c3a, sun: 0xff7a50, sunI: 1.2, hemi: 0x6a3050, hemiI: 0.5 },
});
const ORBIT = W('orbit', { seed: 6601 });

// 四家的部隊同時抵達
const fleet = [
  { id: 'f1', k: 'type', key: 'mt', p: [-8, -4], yaw: 270, s: [{ t: 0, go: [12, -4] }], pal: 'castron' },
  { id: 'f2', k: 'type', key: 'tank', p: [-14, 2], yaw: 270, s: [{ t: 0, go: [8, 2] }], pal: 'castron' },
  { id: 'f3', k: 'type', key: 'dropship', p: [-22, -12], yaw: 270, s: [{ t: 0, go: [24, -12] }] },
  { id: 'f4', k: 'type', key: 'heli', p: [-26, -6], yaw: 270, s: [{ t: 0, go: [20, -6] }] },
  { id: 'f5', k: 'type', key: 'drone', p: [-6, -14], yaw: 270, s: [{ t: 0, go: [16, -14] }] },
  { id: 'f6', k: 'type', key: 'mt_shield', p: [4, 6], yaw: 200, team: 'ally', pal: 'ally' },
];
// 都市的守衛：衝撞無人機、艦載防空砲
const guards = [
  { id: 'u1', k: 'type', key: 'rammer', p: [-6, -8], yaw: 90, s: [{ t: 0, go: [10, -10] }] },
  { id: 'u2', k: 'type', key: 'rammer', p: [-10, -2], yaw: 90, s: [{ t: 0, go: [8, -2] }] },
  { id: 'u3', k: 'type', key: 'flak', p: [6, -12], yaw: 180 },
];
// 探照燈交錯
const beams = [0.3, 1.1, 1.9, 2.7].map((t, i) => ({
  t,
  fx: 'beam',
  at: [-30 + i * 20, 2, -40],
  to: [10 - i * 8, 40, 10],
  color: 0xfff0c0,
  w: 0.5,
}));

export function ch5Intro() {
  const L = pickLines(CHAPTER_TEXT[5].intro);
  const T = timeline();
  T.add(...black('CHAPTER V', '洋上的抉擇', 2.6, 'card', [{ t: 0.2, sfx: 'splash', vol: 0.8, rate: 0.6 }]));
  // 海上都市與伸進雲層的電纜
  T.add(...vista(SEA, G.day, 'fly', L[0], { fi: 0.6, l1: [40, 30, -30] }));
  T.add(...vista(SEA, { ...G.dusk, bloom: 1.2 }, 'low', L[1], { actors: fleet, ev: beams }));
  T.add(
    ...comm(SEA, G.day, L[2], {
      badge: 'castron',
      ev: [
        { t: 1.6, badge: 'veerwell' },
        { t: 3.2, badge: 'sancta' },
      ],
    }),
  );
  T.add(...vista(SEA, G.day, 'low', L[3], { actors: guards }));
  T.add(
    ...rival(
      SEA,
      G.day,
      'undertow',
      'UNDERTOW',
      '洋上都市的守衛',
      'UNDERTOW：「這座都市，不是誰的旗子。滾出去。」',
    ),
  );
  // LEVIATHAN：空中要塞從雲裡降下來
  T.add(...boss(SEA, G.day, 'fortress', 'LEVIATHAN', '空中要塞', L[4], { p: [0, 16, -36], scale: 1.2 }));
  for (const sh of shootout(SEA, G.day, 'undertow', { lines: [L[5]] })) T.add(...sh);
  T.add(...chapterCard(SEA, G.dusk, '第五章　洋上的抉擇', 'CHAPTER V'));
  return T.def({
    title: '第五章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch5Outro() {
  const L = pickLines(CHAPTER_TEXT[5].outro);
  const T = timeline();
  T.add(...black('第五章　完', 'AFTERMATH', 2.6));
  T.add(
    ...vista(ORBIT, G.day, 'push', L[0], {
      ev: [{ t: 0.6, fx: 'pillar', at: [0, 0, -20], r: 5, color: 0xffffff }],
    }),
  );
  // 全世界的螢幕同時變白：軌道站的廣播
  T.add(
    ...black('', '', 3.8, 'card', [
      { t: 0, flash: '#ffffff', in: 0.05, hold: 0.6, out: 1.2 },
      { t: 0, sfx: 'alarmBig', vol: 0.6, rate: 0.6 },
      { t: 0.5, sys: ['// ORBITAL BROADCAST //', 'KEY-07', '請前往中樞'], dur: 3.2, cls: 'file' },
      { t: 0.6, sub: L[1].replace(/^「|」$/g, ''), who: 'station', dur: 3 },
    ]),
  );
  T.add(
    ...black('', '', 4, 'card', [
      { t: 0.1, sys: ['T-MINUS 72:00:00', 'T-MINUS 71:59:59', 'T-MINUS 71:59:58'], dur: 3.8, cls: 'file' },
      { t: 0.3, sub: L[2], dur: 3.4 },
      { t: 0.2, sfx: 'bell', vol: 0.5, rate: 0.5 },
      { t: 1.2, sfx: 'bell', vol: 0.5, rate: 0.5 },
      { t: 2.2, sfx: 'bell', vol: 0.5, rate: 0.5 },
    ]),
  );
  T.add(...vista(SEAR, G.red, 'crane', L[3]));
  T.add(
    ...comm(SEAR, G.red, L[4], {
      badge: 'castron',
      ev: [
        { t: 1.4, badge: 'aetheric' },
        { t: 2.6, badge: 'veerwell' },
      ],
    }),
  );
  T.add(...hero(SEAR, G.red, 'walk', L[5]));
  T.add(...comm(SEAR, G.red, L[6], { yaw: 160 }));
  T.add(...hero(SEAR, G.red, 'kneel', L[7], { d: 5.5 }));
  T.shots[T.shots.length - 1].fo = 2;
  return T.def({
    title: '第五章　章末',
    music: [{ at: 0, track: 'cine_tension', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}
