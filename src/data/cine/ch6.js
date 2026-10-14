// 第 6 章 軌道：開場（第 6 章沒有章末，接結局畫面）與最後的抉擇的演出（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[6]
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
  hero,
  rival,
  shootout,
  timeline,
  vista,
} from './kit.js';

const ORBIT = W('orbit', { seed: 6601 });
const ORBITN = W('orbit', { seed: 6602, variant: 'nightside' });
const PORT = W('spaceport', { seed: 6402, tod: 'dusk' });
const SEA = W('xylem', { seed: 6501 });
const WASTE = W('wasteland', { tod: 'dusk', seed: 6101 });
const SPACE = { k: 'space' };

// 發射：試車台噴火＋大爆炸＋震動
const ignite = [
  { t: 0.2, fx: 'flame', at: [0, 2, -12], to: [0, 30, -12], len: 26, ang: 0.3, n: 20 },
  { t: 0.2, sfx: 'thrBurst', vol: 1, rate: 0.45 },
  { t: 0.2, sfx: 'explodeBig', vol: 0.9, rate: 0.45 },
  { t: 0.25, boom: [0, 3, -12], big: true, r: 2 },
  { t: 0.3, fx: 'pillar', at: [0, 0, -12], r: 3, color: 0xffc080 },
  { t: 0.9, fx: 'pillar', at: [0, 0, -12], r: 3, color: 0xffc080 },
  { t: 1.5, fx: 'pillar', at: [0, 0, -12], r: 3, color: 0xffc080 },
  { t: 0.3, fx: 'streaks', at: [0, 2, -12], n: 80, color: 0xffc080, speed: 50, grav: -20 },
  { t: 0.3, fx: 'shockwave', at: [0, 0.5, -12], r: 20, color: 0xffb070 },
  { t: 0.3, flash: '#ffe0b0', in: 0.05, hold: 0.15, out: 0.6 },
  { t: 0.3, shake: 1.4 },
  { t: 1, fx: 'flame', at: [0, 2, -12], to: [0, 30, -12], len: 26, ang: 0.3, n: 20 },
];
// 太空：空降艙往上衝出大氣層（鏡頭在下方仰望）
const ascend = (d) => ({
  id: 'asc',
  k: 'pod',
  keys: [
    { t: 0, p: [0, -60, -30], thrust: 1, heat: 0.6, r: [180, 0, 0] },
    { t: d, p: [0, 30, -60], thrust: 1, heat: 0, r: [180, 60, 0] },
  ],
});

export function ch6Intro() {
  const L = pickLines(CHAPTER_TEXT[6].intro);
  const T = timeline();
  T.add(...black('CHAPTER VI', '軌道', 2.6, 'card', [{ t: 0.2, sfx: 'alarmBig', vol: 0.4, rate: 0.6 }]));
  // 發射：火箭點火、衝出雲海
  T.add(
    ...vista(PORT, G.dusk, 'low', null, {
      d: 2.8,
      fi: 0.3,
      ev: ignite,
      p0: [-26, 2, 22],
      p1: [-24, 2.4, 18],
      l0: [0, 10, -12],
      l1: [0, 24, -12],
    }),
  );
  T.add(
    ...vista(SPACE, {}, 'push', L[0], {
      d: 5.5,
      actors: [ascend(5.5)],
      p0: [6, -70, 10],
      p1: [4, 0, 6],
      l0: { a: 'asc' },
      l1: { a: 'asc' },
      ev: [
        { t: 0, loop: 0.8, loopKey: 'engineLoop', rate: 0.6 },
        { t: 0, shake: 0.6 },
      ],
    }),
  );
  T.add(
    ...vista(ORBIT, G.day, 'push', L[1], {
      ev: [
        { t: 0, loop: 0 },
        { t: 0.6, fx: 'pillar', at: [0, 0, -20], r: 5, color: 0xffffff },
      ],
    }),
  );
  T.add(...hero(ORBIT, G.day, 'walk', L[2]));
  T.add(
    ...comm(ORBIT, G.day, null, {
      who: 'castron',
      d: 2.8,
      ev: [{ t: 0.3, sub: '因為你最強。', who: 'castron', dur: 2.4 }],
    }),
  );
  T.add(
    ...comm(ORBIT, G.day, null, {
      who: 'aetheric',
      d: 2.8,
      yaw: 120,
      ev: [{ t: 0.3, sub: '因為你最合適。', who: 'aetheric', dur: 2.4 }],
    }),
  );
  T.add(
    ...comm(ORBIT, G.day, null, {
      who: 'veerwell',
      d: 2.8,
      yaw: 160,
      ev: [{ t: 0.3, sub: '因為你最紅。', who: 'veerwell', dur: 2.4 }],
    }),
  );
  T.add(
    ...comm(ORBIT, G.day, null, {
      who: 'sancta',
      d: 3.6,
      yaw: 220,
      ev: [{ t: 0.3, sub: '……我不知道。我也想知道。', who: 'sancta', dur: 3.2 }],
    }),
  );
  T.add(
    ...comm(ORBITN, G.night, L[7], {
      badge: 'echo',
      yaw: 260,
      ev: [{ t: 0.4, sfx: 'glitch', vol: 0.4, rate: 0.5 }],
    }),
  );
  T.add(...rival(ORBIT, G.day, 'zenith', 'ZENITH', '上一位鑰匙', 'ZENITH：「……又是你。」'));
  for (const sh of shootout(ORBIT, G.day, 'zenith', {
    rp: [-18, -6],
    hover: true,
    lines: ['ZENITH：「這一次，你能走到哪裡？」', 'ZENITH：「……不錯。那就上來吧。」'],
  }))
    T.add(...sh);
  T.add(...chapterCard(ORBIT, G.day, '第六章　軌道', 'CHAPTER VI'));
  return T.def({
    title: '第六章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

// ---------- 最後的抉擇：軌道站 ----------
export function c6Pre(ctx) {
  const opts = ctx.opts || [];
  const lines = [
    ['你守約了。……把它交給我們，傭兵。', 'castron', 3.6],
    ['……拜託。讓天空安靜下來。', 'sancta', 3.6],
  ];
  if (opts.length > 2) lines.push(['……R-07。這一次，照我們的節奏來。', 'echo', 3.8]);
  return choicePre(opts, lines);
}
export function c6Open() {
  return choicePost(
    '軌道站：交出',
    [
      cut(ORBIT, G.day, 'push', '四家代表，走進中樞。'),
      black('', '', 3.6, 'card', [
        {
          t: 0.1,
          sys: ['AUTHENTICATION : COMPLETE', 'KEY-07', 'RUBICON PROTOCOL : EXECUTE'],
          dur: 3.4,
          cls: 'file',
        },
        { t: 0.4, sub: '認證完成。KEY-07。盧比孔協定，執行。', who: 'station', dur: 3 },
        { t: 0.1, sfx: 'glitch', vol: 0.6, rate: 0.6 },
      ]),
      // 倒轉：雲、海、荒野（色差、掃描線）
      cut(ORBIT, { ...G.day, chroma: 0.8, sat: 0.4 }, 'fly', '雲。', { ov: 'scan', d: 1.6 }),
      cut(SEA, { ...G.day, chroma: 0.8, sat: 0.4 }, 'fly', '海。', { ov: 'scan', d: 1.6 }),
      cut(WASTE, { ...G.dusk, chroma: 0.9, sat: 0.4 }, 'fly', '荒野。', { ov: 'scan', d: 1.8 }),
    ],
    ['這顆星球有一段訊號。', 'PROTOCOL EXECUTED'],
  );
}
export function c6Seal() {
  return choicePost(
    '軌道站：墜落',
    [
      cut(ORBIT, G.day, 'push', '你切斷了姿態控制。', {
        ev: [{ t: 0.2, sfx: 'alarmBig', vol: 0.6, rate: 0.7 }],
      }),
      cut(SPACE, {}, 'push', '軌道站拖著長長的火光，往雲海落下去。', {
        d: 4.4,
        p0: [-60, 30, 120],
        p1: [-40, 10, 60],
        l0: { st: [0, 0, 0] },
        l1: { st: [0, -60, 0] },
        ev: [0.3, 1.0, 1.7, 2.4, 3.1, 3.8].flatMap((t, i) => {
          const at = { st: [(i % 3) * 12 - 12, 60 - i * 30, 6] };
          return [
            { t, boom: at, big: true, r: 18 },
            { t, fx: 'flash', at, r: 40, color: 0xff8040, life: 0.6 },
          ];
        }),
      }),
      black('', '', 3.2, 'card', [
        { t: 0.1, sys: ['ATTITUDE : LOST', 'FAILSAFE : ENGAGED'], dur: 3, cls: 'file' },
        { t: 0.1, sfx: 'glitch', vol: 0.6, rate: 0.5 },
      ]),
    ],
    ['天空，安靜了。', 'SILENT SKY'],
  );
}
export function c6Beyond() {
  return choicePost(
    '軌道站：彼岸',
    [
      cut(ORBIT, G.day, 'low', '所有委託方的頻道，一個一個切斷。', {
        ov: 'comm',
        ev: [
          { t: 0, badge: 'castron' },
          { t: 0.6, badge: 'aetheric' },
          { t: 1.2, badge: 'veerwell' },
          { t: 1.8, badge: 'sancta' },
          ...[0.5, 1.1, 1.7, 2.3].map((t) => ({ t, sfx: 'uiBack', vol: 0.6, rate: 0.7 })),
        ],
      }),
      comm(ORBITN, G.night, 'ECHO：「我們走吧。」', { d: 3.2 }),
      cut(SPACE, {}, 'push', '推進器一排一排亮起。星球在背後變小。', {
        d: 5,
        p0: [20, 20, 60],
        p1: [120, 260, 520],
        l0: { st: [0, 0, 0] },
        l1: [0, -600, 0],
        ev: [0.3, 0.9, 1.5, 2.1, 2.7].map((t, i) => ({
          t,
          fx: 'flash',
          at: { st: [0, 200 - i * 70, 0] },
          r: 20,
          color: 0x9fe8ff,
        })),
      }),
    ],
    ['這一次，照我們的節奏來。', 'BEYOND'],
  );
}
