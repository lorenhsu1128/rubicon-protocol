// 第 4 章 構造體：開場／章末（依抉擇 2）與抉擇 2 的演出（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[4]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import {
  G,
  W,
  black,
  chapterCard,
  choicePost,
  choicePre,
  comm,
  cut,
  rival,
  shootout,
  timeline,
  vista,
} from './kit.js';

const GRID = W('grid086', { seed: 6401 });
const PORT = W('spaceport', { seed: 6402, tod: 'dusk' });
const PORTN = W('spaceport', { seed: 6404, tod: 'night' });
const SEA = W('xylem', { seed: 6501 });
const ORBIT = W('orbit', { seed: 6601 });

const crawlers = [
  { id: 'w1', k: 'type', key: 'crawler', p: [-6, -6], yaw: 90, s: [{ t: 0, go: [10, -6] }] },
  { id: 'w2', k: 'type', key: 'crawler', p: [-12, 0], yaw: 90, s: [{ t: 0, go: [6, 0] }] },
  { id: 'w3', k: 'type', key: 'underturret', p: [4, -12], yaw: 180 },
];
const launch = [
  { id: 'l1', k: 'type', key: 'testrig', p: [4, -14], yaw: 180 },
  { id: 'l2', k: 'type', key: 'spacemt', p: [-6, -4], yaw: 270, s: [{ t: 0.2, hover: true, go: [10, -8] }] },
  { id: 'l3', k: 'type', key: 'dropship', p: [-18, -16], yaw: 270, s: [{ t: 0, go: [24, -16] }] },
];
const guards = [
  { id: 'g1', k: 'type', key: 'mt_shield', p: [-4, -6], yaw: 0, team: 'ally', pal: 'ally' },
  { id: 'g2', k: 'type', key: 'mt_shield', p: [4, -6], yaw: 0, team: 'ally', pal: 'ally' },
  { id: 'g3', k: 'type', key: 'repair', p: [0, -10], yaw: 0, team: 'ally', pal: 'ally' },
];
const leaving = [
  { id: 'd1', k: 'type', key: 'dropship', p: [-14, -12], yaw: 270, s: [{ t: 0, go: [30, -18] }] },
  { id: 'd2', k: 'type', key: 'dropship', p: [-22, -4], yaw: 270, s: [{ t: 0, go: [24, -10] }] },
  { id: 'd3', k: 'type', key: 'heli', p: [-26, -14], yaw: 270, s: [{ t: 0, go: [20, -20] }] },
];
const searchers = [
  {
    id: 's1',
    k: 'type',
    key: 'mt',
    p: [-4, -2],
    yaw: 30,
    s: [{ t: 0, go: [2, -6] }],
    team: 'ally',
    pal: 'ally',
  },
  { id: 's2', k: 'type', key: 'repair', p: [4, -4], yaw: 0, team: 'ally', pal: 'ally' },
];
// 燒過的地面
const fires = (n = 5) =>
  Array.from({ length: n }, (_, i) => ({
    t: 0.1 + i * 0.2,
    fx: 'fire',
    at: [-10 + i * 5, 0, -8 - (i % 2) * 6],
    r: 3,
    life: 8,
  }));
// 火箭點火：試車台噴火＋閃光＋震動
const ignite = [
  { t: 0.2, fx: 'flame', at: [4, 2, -14], to: [4, 30, -14], len: 26, ang: 0.3, n: 20 },
  { t: 0.2, sfx: 'thrBurst', vol: 1, rate: 0.5 },
  { t: 0.2, sfx: 'explodeBig', vol: 0.8, rate: 0.5 },
  { t: 0.25, flash: '#ffd0a0', in: 0.05, hold: 0.1, out: 0.5 },
  { t: 0.3, shake: 1.2 },
  { t: 0.25, boom: [4, 3, -14], big: true, r: 4 },
  { t: 0.3, fx: 'streaks', at: [4, 2, -14], n: 80, color: 0xffc080, speed: 50, grav: -20 },
  { t: 0.3, fx: 'shockwave', at: [4, 0.5, -14], r: 18, color: 0xffb070 },
  { t: 0.8, fx: 'flame', at: [4, 2, -14], to: [4, 30, -14], len: 26, ang: 0.3, n: 20 },
  { t: 1.4, fx: 'flame', at: [4, 2, -14], to: [4, 30, -14], len: 26, ang: 0.3, n: 20 },
];

export function ch4Intro() {
  const L = pickLines(CHAPTER_TEXT[4].intro);
  const T = timeline();
  T.add(...black('CHAPTER IV', '構造體', 2.6, 'card', [{ t: 0.2, sfx: 'heavy', vol: 0.7, rate: 0.5 }]));
  // 仰拍 Grid 086：平台一層層延伸到雲裡
  T.add(
    ...vista(GRID, G.day, 'low', L[0], {
      fi: 0.6,
      p0: [-6, 1.2, 10],
      p1: [-4, 1.4, 6],
      l0: [4, 12, -20],
      l1: [4, 20, -20],
    }),
  );
  T.add(
    ...vista(PORT, G.dusk, 'push', L[1], {
      actors: launch,
      ev: [{ t: 1, fx: 'flame', at: [4, 2, -14], to: [4, 20, -14], len: 18, ang: 0.25, n: 14 }],
    }),
  );
  T.add(...comm(PORT, G.dusk, L[2], { badge: 'veerwell' }));
  T.add(...comm(PORT, G.dusk, L[3], { badge: 'sancta', yaw: 150 }));
  T.add(...vista(GRID, G.day, 'low', L[4], { actors: crawlers }));
  T.add(
    ...rival(
      GRID,
      G.day,
      'spire',
      'SPIRE',
      'Doser 的首領',
      'SPIRE：「這裡是我的家。闖進來的，就從最高的地方摔下去。」',
    ),
  );
  for (const sh of shootout(GRID, G.day, 'spire', { hover: true, lines: [L[5]] })) T.add(...sh);
  T.add(
    ...rival(
      PORT,
      G.dusk,
      'countdown',
      'COUNTDOWN',
      '維爾威的發射技師',
      'COUNTDOWN：「倒數開始了喔，傭兵。十、九、八——」',
      {
        d: 3.8,
      },
    ),
  );
  T.add(...chapterCard(GRID, G.day, '第四章　構造體', 'CHAPTER IV'));
  return T.def({
    title: '第四章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch4Outro(ctx) {
  const pick = (ctx.choices || {}).c4 === 'sancta' ? 'sancta' : 'veerwell';
  const L = pickLines(CHAPTER_TEXT[4].outro, { c4: pick });
  const T = timeline();
  T.add(...black('第四章　完', 'AFTERMATH', 2.6));
  if (pick === 'veerwell') {
    T.add(...comm(PORT, G.dusk, L[0], { badge: 'veerwell', actors: launch, ev: ignite }));
    T.add(...vista(PORTN, G.red, 'low', L[1], { actors: searchers, ev: fires() }));
  } else {
    T.add(
      ...vista(PORT, G.dusk, 'push', L[0], {
        actors: guards,
        ev: [{ t: 0.4, sfx: 'door', vol: 1, rate: 0.5 }],
      }),
    );
    T.add(...vista(PORT, G.dusk, 'low', L[1], { actors: leaving }));
  }
  T.add(...vista(SEA, G.day, 'fly', L[2]));
  T.add(...vista(SEA, G.dusk, 'crane', L[3]));
  // 霍斯特的私人信
  T.add(
    ...black('', '', 3.6, 'card', [
      { t: 0.2, sys: ['PRIVATE MAIL // CASTRON HEAVY INDUSTRIES', 'FROM : HORST', 'TO : R-07'], dur: 3.4 },
      { t: 0.4, sub: L[4], dur: 3 },
    ]),
  );
  T.add(...comm(PORTN, G.night, L[5], { d: 7 }));
  // 天空中軌道站的光點，比上一章大了一點
  T.add(
    ...vista(ORBIT, G.night, 'low', null, {
      d: 3.4,
      l0: [0, 40, -60],
      l1: [0, 50, -60],
      ev: [0.4, 1.2, 2.0, 2.8].map((t) => ({
        t,
        fx: 'flash',
        at: [0, 150, -220],
        r: 22,
        color: 0xff5040,
        life: 0.5,
      })),
    }),
  );
  T.shots[T.shots.length - 1].fo = 2;
  return T.def({
    title: '第四章　章末',
    music: [{ at: 0, track: 'cine_tension', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

// ---------- 抉擇 2：發射設施的去向 ----------
export function c4Pre(ctx) {
  return choicePre(ctx.opts || [], [
    ['人類重新回到天空，你就是第一個推手。時間就是錢，傭兵。', 'veerwell', 3.8],
    ['如果你交出去，住在這裡的人會被燒掉。……拜託。', 'sancta', 3.8],
  ]);
}
export function c4Veerwell() {
  return choicePost(
    '發射設施：維爾威',
    [
      cut(PORT, G.dusk, 'push', '點火。', { actors: launch, ev: ignite, d: 2.8 }),
      cut(PORTN, G.red, 'low', '外圍的聚落，被尾焰掃過。', { ev: fires(6) }),
      cut(PORTN, G.red, 'pan', '聖域的人，在灰裡找名字。', { actors: searchers }),
      rival(
        PORT,
        G.dusk,
        'countdown',
        'COUNTDOWN',
        '維爾威的發射技師',
        'COUNTDOWN：「下一個目標：避難船。倒數開始。」',
        {
          d: 3.6,
        },
      ),
    ],
    ['人類回到了天空。', 'LAUNCH AUTHORIZED'],
  );
}
export function c4Sancta() {
  return choicePost(
    '發射設施：聖域',
    [
      cut(PORT, G.dusk, 'push', '發射設施的大門，關上了。', {
        ev: [{ t: 0.3, sfx: 'door', vol: 1, rate: 0.4 }],
      }),
      cut(PORT, G.dusk, 'low', '聖域的人，輪流守著門。', { actors: guards }),
      cut(PORT, G.dusk, 'pan', '維爾威的運輸機，一架一架往東飛。', { actors: leaving }),
      rival(PORT, G.dusk, 'whiteout', 'WHITEOUT', '難民營的狙擊手', 'WHITEOUT：「……聖域的錢，我收下了。」', {
        d: 3.6,
      }),
    ],
    ['發射台沉默了。', 'LAUNCH SEALED'],
  );
}
