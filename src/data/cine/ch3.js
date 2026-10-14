// 第 3 章 冰原之下：開場／章末（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[3]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { G, W, black, chapterCard, comm, hero, rival, shootout, timeline, vista } from './kit.js';

const SNOW = W('snow', { seed: 6301, variant: 'icefield' });
const STORM = W('snow', { seed: 6305, variant: 'blizzard' });
const SNOWN = W('snow', { seed: 6303, tod: 'night', variant: 'icefield' });
const INST = W('institute', { seed: 6302 });
const IND = W('industrial', { seed: 6201 });
const PORT = W('spaceport', { seed: 6402, tod: 'dusk' });
const ORBIT = W('orbit', { seed: 6601 });

const camp = [
  { id: 'c1', k: 'type', key: 'mt_shield', p: [-4, -4], yaw: 30, team: 'ally', pal: 'ally' },
  { id: 'c2', k: 'type', key: 'repair', p: [2, -8], yaw: 0, team: 'ally', pal: 'ally' },
  { id: 'c3', k: 'type', key: 'tank', p: [-10, -10], yaw: 60, team: 'ally', pal: 'ally' },
];
// 雪原上的伏兵：雪中潛伏 MT、冰面滑行砲車
const ambush = [
  { id: 'a1', k: 'type', key: 'lurker', p: [-6, -10], yaw: 0 },
  { id: 'a2', k: 'type', key: 'skater', p: [8, -14], yaw: 270, s: [{ t: 0, go: [-14, -14] }] },
  { id: 'a3', k: 'type', key: 'skater', p: [14, -6], yaw: 270, s: [{ t: 0, go: [-8, -4] }] },
];
const northbound = [
  { id: 'n1', k: 'type', key: 'dropship', p: [-20, -10], yaw: 270, s: [{ t: 0, go: [30, -10] }] },
  { id: 'n2', k: 'type', key: 'heli', p: [-26, -4], yaw: 270, s: [{ t: 0, go: [24, -4] }] },
  {
    id: 'n3',
    k: 'type',
    key: 'mt',
    p: [-8, 4],
    yaw: 270,
    s: [{ t: 0, go: [14, 4] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'n4',
    k: 'type',
    key: 'mt',
    p: [-13, 7],
    yaw: 270,
    s: [{ t: 0, go: [9, 7] }],
    team: 'ally',
    pal: 'ally',
  },
];

export function ch3Intro() {
  const L = pickLines(CHAPTER_TEXT[3].intro);
  const T = timeline();
  T.add(...black('CHAPTER III', '冰原之下', 2.6, 'card', [{ t: 0.2, sfx: 'distant', vol: 0.7, rate: 0.6 }]));
  T.add(...vista(STORM, G.cold, 'fly', L[0], { fi: 0.6 }));
  T.add(...vista(SNOWN, G.night, 'low', L[1], { actors: camp }));
  T.add(...comm(SNOW, G.cold, L[2], { badge: 'sancta' }));
  T.add(...comm(SNOW, G.cold, L[3], { badge: 'sancta', yaw: 150 }));
  // 雪原上的伏兵
  T.add(...vista(SNOW, G.cold, 'low', L[4], { actors: ambush }));
  // WHITEOUT：瞄準鏡的反光
  T.add(
    ...rival(
      STORM,
      G.cold,
      'whiteout',
      'WHITEOUT',
      '難民營的狙擊手',
      'WHITEOUT：「你就是那個傭兵。我在瞄準鏡裡，記得你的機體。」',
      {
        ev: [
          {
            t: 0.4,
            fx: 'flash',
            at: { a: 'rv', at: 'head', o: [0.6, 0, -1], loc: true },
            r: 1.2,
            color: 0xffffff,
          },
        ],
      },
    ),
  );
  for (const sh of shootout(SNOW, G.cold, 'whiteout', { lines: ['WHITEOUT：「……看得到我嗎？」'] }))
    T.add(...sh);
  T.add(...chapterCard(SNOW, G.cold, '第三章　冰原之下', 'CHAPTER III'));
  return T.def({
    title: '第三章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch3Outro() {
  const L = pickLines(CHAPTER_TEXT[3].outro);
  const T = timeline();
  T.add(...black('第三章　完', 'AFTERMATH', 2.6));
  T.add(...vista(INST, { ...G.under, exposure: 0.7 }, 'push', L[0], { fo: 0.8 }));
  // 塗掉名字的檔案、跳動的週期數
  T.add(
    ...black('', '', 4.2, 'card', [
      { t: 0.2, sys: ['FILE ██████████', 'SUBJECT : KEY-██', 'STATUS : GOOD'], dur: 3.8, cls: 'file' },
      { t: 0.4, sub: L[1], dur: 3.6 },
      { t: 0.2, sfx: 'glitch', vol: 0.5, rate: 0.8 },
    ]),
  );
  T.add(
    ...black('', '', 4.4, 'card', [
      {
        t: 0.1,
        sys: ['CYCLE : 0x0000', 'CYCLE : 0x01A3', 'CYCLE : 0x2F7C', 'CYCLE : ███████'],
        dur: 4.2,
        cls: 'file',
      },
      { t: 0.3, sub: L[2], dur: 3.8 },
      { t: 0.1, sfx: 'glitch', vol: 0.6, rate: 0.5 },
      { t: 3.2, sfx: 'boom1', vol: 0.7, rate: 0.5 },
    ]),
  );
  // 軌道站的座標
  T.add(
    ...vista(ORBIT, G.day, 'push', L[3], {
      ev: [{ t: 0.5, fx: 'pillar', at: [0, 0, -20], r: 4, color: 0xffffff }],
    }),
  );
  T.add(...comm(IND, G.day, L[4], { badge: 'castron' }));
  T.add(...vista(PORT, G.dusk, 'low', L[5], { actors: northbound }));
  T.add(...hero(INST, G.under, 'walk', L[6]));
  // SPECIMEN 在黑暗中站起來
  T.add(
    ...rival(INST, { ...G.under, exposure: 0.75 }, 'specimen', 'SPECIMEN', '「為什麼被選上的是你？」', L[7], {
      d: 5,
    }),
  );
  T.shots[T.shots.length - 1].fo = 2;
  return T.def({
    title: '第三章　章末',
    music: [{ at: 0, track: 'cine_tension', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}
