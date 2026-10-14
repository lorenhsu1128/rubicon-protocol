// 第 1 章 荒野的訊號：開場／章末的分鏡（docs/cinematics-storyboard.md）。台詞＝CHAPTER_TEXT[1]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { G, W, black, boss, chapterCard, comm, hero, rival, shootout, timeline, vista } from './kit.js';

const DUNE = W('dunes', { seed: 6103, tod: 'dusk' });
const WASTE = W('wasteland', { tod: 'dusk', seed: 6101 });
const MINE = W('desert', { seed: 6102 });
const WASTEN = W('wasteland', { tod: 'night', seed: 6104 });
const DUNEN = W('dunes', { tod: 'night', seed: 6105, clear: 40 });
const IND = W('industrial', { seed: 6201 });
const INST = W('institute', { seed: 6302 });
const PORT = W('spaceport', { seed: 6402, tod: 'dusk' });
const DAM = W('dam', { seed: 6202 });

// 卡斯特隆的補給車隊（被砲擊的）
const convoy = [
  { id: 'cv1', k: 'type', key: 'tank', p: [-14, 6], yaw: 90, s: [{ t: 0, go: [20, 6] }], pal: 'castron' },
  { id: 'cv2', k: 'type', key: 'mt', p: [-20, 2], yaw: 90, s: [{ t: 0, go: [16, 2] }], pal: 'castron' },
  { id: 'cv3', k: 'type', key: 'mt', p: [-24, 8], yaw: 90, s: [{ t: 0, go: [12, 8] }], pal: 'castron' },
];

export function ch1Intro() {
  const L = pickLines(CHAPTER_TEXT[1].intro);
  const T = timeline();
  T.add(...black('CHAPTER I', '荒野的訊號', 2.6, 'card', [{ t: 0.2, sfx: 'glitch', vol: 0.5, rate: 0.5 }]));
  // 南部荒野：夕陽下低空飛越沙丘
  T.add(...vista(DUNE, G.dusk, 'fly', L[0], { fi: 0.6 }));
  // 舊天線：紅光一明一滅
  T.add(
    ...vista(WASTE, { ...G.dusk, bloom: 1.2 }, 'push', L[1], {
      ev: [0.3, 1.5, 2.7, 3.9, 5.1].map((t) => ({ t, fx: 'pillar', at: [0, 0, -20], r: 3, color: 0xff4030 })),
    }),
  );
  // BASTILLE 醒來：砲台抬起，卡斯特隆的車隊被炸
  T.add(
    ...boss(MINE, G.day, 'bunker', 'BASTILLE', '砲兵陣地', L[2], {
      d: 6.5,
      actors: convoy,
      ev: [
        { t: 1.2, fx: 'warnLine', at: [0, 4, -26], to: [0, 1, 6], color: 0xff3020, life: 1.2 },
        { t: 2.4, boom: { a: 'cv2' }, big: true, kill: true },
        { t: 2.5, a: 'cv2', die: true },
        { t: 3.4, boom: { a: 'cv1' }, big: true, kill: true },
        { t: 3.5, a: 'cv1', die: true },
        { t: 4.6, boom: { a: 'cv3' }, big: true },
      ],
    }),
  );
  // 所有勢力都在問：是誰叫醒了它們
  T.add(...vista(MINE, G.day, 'pan', L[3]));
  // 霍斯特的委託
  T.add(...comm(MINE, G.day, '霍斯特：「合約就是合約。礦場拿回來，報酬照付。」'));
  T.add(...hero(WASTE, G.dusk, 'walk', L[4]));
  // RUST 從廢鐵堆跳出
  T.add(
    ...rival(WASTE, G.dusk, 'rust', 'RUST', '廢鐵也是錢', 'RUST：「那座天線是我先找到的！滾回去，菜鳥！」'),
  );
  // 高潮：追尾視角對射
  for (const sh of shootout(WASTE, G.dusk, 'rust', { lines: [L[5]] })) T.add(...sh);
  T.add(...chapterCard(DUNE, G.dusk, '第一章　荒野的訊號', 'CHAPTER I'));
  return T.def({
    title: '第一章　開場',
    music: [{ at: 0, track: 'cine_drive', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch1Outro() {
  const L = pickLines(CHAPTER_TEXT[1].outro);
  const T = timeline();
  T.add(...black('第一章　完', 'AFTERMATH', 2.6));
  // 天線核心交出去
  T.add(...hero(WASTE, G.dusk, 'walk', L[0]));
  T.add(...vista(WASTEN, G.night, 'crane', L[1]));
  // 四家委託方的頻道輪流亮起
  T.add(...comm(IND, G.day, L[2], { badge: 'castron' }));
  T.add(...comm(INST, G.under, L[3], { badge: 'aetheric' }));
  T.add(...comm(PORT, G.dusk, L[4], { badge: 'veerwell' }));
  T.add(...comm(DAM, G.cold, L[5], { badge: 'sancta' }));
  // 夜空：軌道站的光點一閃
  T.add(
    ...vista(DUNEN, G.night, 'low', L[6], {
      l0: [10, 30, -40],
      l1: [10, 40, -40],
      ev: [{ t: 1, fx: 'flash', at: [30, 120, -160], r: 4, color: 0xff5040 }],
    }),
  );
  // 營火旁跪坐，鏡頭拉遠到星空
  T.add(
    ...hero(DUNEN, G.night, 'kneel', L[7], {
      d: 6,
      ev: [{ t: 0, fx: 'fire', at: [3, 0, 3], r: 1.2, life: 8 }],
      cam: {
        fov: 40,
        hand: 0.05,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'heroH', o: [5, 2, 7] }, l: { a: 'heroH', o: [0, 2, 0] } },
          { t: 6, p: { a: 'heroH', o: [9, 3, 13] }, l: { a: 'heroH', o: [0, 2.5, 0] } },
        ],
      },
    }),
  );
  T.shots[T.shots.length - 1].fo = 2;
  return T.def({
    title: '第一章　章末',
    music: [{ at: 0, track: 'cine_tension', vol: 0.9, fadeIn: 1, fadeOut: [T.at - 3, 3] }],
  });
}
