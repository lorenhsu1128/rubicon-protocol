// 第 4 章 構造體：垂直一鏡到底＋倒數（docs/cinematics-storyboard.md 第二版）。台詞＝CHAPTER_TEXT[4]
//  - 開場：整段是一次倒數（畫面角落 T−60 → 0，最後一秒遠方的發射架點火）；從 Grid 086 最底層開始一鏡到底往上升，
//    經過爬行機、底部砲塔、SPIRE，穿過雲層到雲上；中途一次滑動變焦；派克與諾拉的對話是同一個鏡頭裡兩種顏色的字幕；
//    章名直向從下往上捲
//  - 抉擇 2 選前：發射控制室的倒數 T−10、兩個按鈕的光（綠＝維爾威、黃＝聖域）
//  - 選後：維爾威＝一鏡跟著火箭升空、尾焰掃過外圍聚落；聖域＝大門關上、倒數停在 00:03 凍結
//  - 章末：依抉擇的三句 → 各勢力的頻道 → 霍斯特的手寫信（背景很淡地透出軌道站的光點）
// 效果在 game/cine-c4.js（c4tower、c4env、c4pin、c4dz、c4room、c4launch、c4gate；疊加 c4count、c4duo、c4title、c4radio、c4letter）
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { W, parseLine, timeline } from './kit.js';

// 火箭升空的高度（劇本的鏡頭與 game/cine-c4.js 的火箭共用）：t0 秒起以加速度 acc 等加速上升
export const c4RocketY = (lt, t0, acc) => (lt < t0 ? 0 : 0.5 * acc * (lt - t0) * (lt - t0));

const MUSIC = 'cine_c4';
const GRID = W('grid086', { seed: 6401, clear: 30 });
const PORT = W('spaceport', { seed: 6411, tod: 'dusk', clear: 40 });
const PORTN = W('spaceport', { seed: 6414, tod: 'night', clear: 40 });
const SEA = W('xylem', { seed: 6501 });

// 冷金屬的調色（構造體裡）
const COLD = {
  sunAz: 205,
  sunEl: 18,
  sunWarm: 0.1,
  tintLo: '#1c3246',
  tintLoK: 0.5,
  sat: 0.72,
  temp: -0.28,
  contrast: 1.14,
  fogK: 1.25,
  sky: 'grad',
  skyTop: '#3a4550',
  dust: 0.4,
  vignette: 0.5,
  hemiK: 1.6,
};
// 雲上：強光、藍天、雲海
const ABOVE = {
  sunK: 1.9,
  bloom: 1.35,
  fogK: 3,
  fogColor: '#d6e2ee',
  fogColorK: 0.92,
  skyTop: '#1a4a9a',
  sat: 1.02,
  temp: 0.06,
  sunWarm: 0.55,
  tintHi: '#fff0d6',
  tintHiK: 0.35,
  tintLoK: 0.15,
  dust: 0,
  vignette: 0.32,
};
const NIGHT = {
  sunEl: 30,
  sunK: 0.5,
  tintLo: '#18284a',
  tintLoK: 0.55,
  tintHi: '#ffd8a0',
  tintHiK: 0.25,
  exposure: 0.62,
  bloom: 1.3,
  contrast: 1.15,
  sky: 'cloud',
  skyTop: '#05080f',
  cloud: 0.3,
  fogColor: '#10161f',
  fogColorK: 0.7,
};
const DUSK = {
  sunAz: 250,
  sunEl: 7,
  sunWarm: 0.75,
  tintHi: '#ffa060',
  tintHiK: 0.4,
  tintLo: '#26384c',
  tintLoK: 0.4,
  fogK: 1.6,
};

// 這一章的長鏡頭不要動態模糊（慢的鏡頭移動，模糊只會讓構造體糊掉）
const def = (T, o) => ({ ...T.def(o), grade: { mblur: false } });
const sub = (t, text, who, dur) => ({ t, sub: text, who: who || null, dur });
// 圓柱座標（繞著高塔）：θ 度、半徑、高度 → [x, y, z]
const orb = (th, r, h) => [Math.cos((th * Math.PI) / 180) * r, h, Math.sin((th * Math.PI) / 180) * r];

// ---------- 高塔（Grid 086 往雲上延伸的部分）：層高、每層的偏移、Doser 的棚屋 ----------
const TOWER = {
  lv: [11, 21, 33, 46, 60, 75, 88, 101, 114, 127],
  off: [
    [0, 0],
    [0, 0],
    [3, 0],
    [0, -3],
    [-3, 0],
    [0, -3],
    [3, 0],
    [0, 3],
    [-3, 0],
    [0, 0],
  ],
  size: 18,
  col: 6.5,
  clearR: 46,
  // [第幾層, x, z, 轉角, 油桶]
  huts: [
    [2, 5, 4, 0],
    [2, -2, 5, 90],
    [3, -4, -6, 0, 1],
    [4, -5, 3, 0],
    [4, 2, -5, 0, 1],
    [6, 6, 5, 90],
    [8, 3, -4, 0, 1],
  ],
  cloud: { y: 100, th: 6 }, // 雲海的高度、穿過時白霧的厚度
};
const PAD = { at: [-30, -260], h: 150, r: 9, ig: 60, t0: 61, acc: 5 };
const PEOPLE = ['hooded', 'hooded', 'farmer', 'man', 'woman', 'womanc', 'casual'];

// ---------- 開場：一鏡到底 ----------
export function ch4Intro() {
  const L = pickLines(CHAPTER_TEXT[4].intro);
  const D = 68.5;
  // 鏡頭：繞著高塔往上升（θ、半徑、高度），途中盯著爬行機、砲塔、SPIRE；21.5～28.5 秒滑動變焦
  const keys = [
    { t: 0, p: orb(55, 22, 1.4), l: [2, 46, -2], fov: 62 },
    { t: 4.5, p: orb(34, 24, 2.4), l: { a: 'cr1' }, fov: 46 },
    { t: 8, p: orb(20, 25, 9), l: { a: 'cr1' }, fov: 44 },
    { t: 12, p: orb(-6, 25, 19), l: { a: 'cr1' }, fov: 44 },
    { t: 16.5, p: orb(-36, 25, 26), l: [9, 30, -4], fov: 48 },
    { t: 19.5, p: [-6, 66, -22], l: { a: 'cr2' }, fov: 26 },
    // 滑動變焦：從爬在平台外側的爬行機正上方往下看，鏡頭往下推、fov 放大，底下的地面一下子掉下去
    { t: 21.5, p: [-2, 76, -14.6], l: { a: 'cr2' }, fov: 14 },
    { t: 28.5, p: [-2, 51, -14.6], l: { a: 'cr2' }, fov: 56 },
    { t: 31.5, p: orb(-124, 19, 63), l: [-4, 82, -2], fov: 56 },
    { t: 35, p: orb(-158, 17, 81), l: { a: 'sp', at: 'head' }, fov: 42 },
    { t: 39.5, p: orb(-186, 16, 91), l: { a: 'sp', at: 'head' }, fov: 40 },
    { t: 44, p: orb(-214, 20, 108), l: [0, 136, 0], fov: 56 },
    { t: 48.5, p: orb(-246, 22, 125), l: [-2, 128, -5], fov: 48 },
    { t: 55, p: orb(-276, 27, 131), l: [-14, 126, -120], fov: 42 },
    { t: 60, p: orb(-280, 28, 132), l: [-24, 128, -230], fov: 38 },
    { t: D, p: orb(-284, 29, 132.5), l: [-28, 200, -250], fov: 42 },
  ];
  const actors = [
    // 爬行機：走到平台邊緣，貼著邊緣垂直爬上第二層
    { id: 'cr1', k: 'type', key: 'crawler', p: [17, 6], yaw: 120, s: [{ t: 0.2, go: [10.8, 2.4] }] },
    { id: 'ut1', k: 'type', key: 'underturret', p: [10, -4], yaw: 270 },
    { id: 'cr2', k: 'type', key: 'crawler', p: [-2, -11.2], h: 46, yaw: 180 },
    { id: 'ut2', k: 'type', key: 'underturret', p: [-6, -10], yaw: 90 },
    {
      id: 'sp',
      k: 'ace',
      key: 'spire',
      p: [-5.2, -2],
      h: 88,
      yaw: 90,
      s: [
        { t: 33, aim: [-30, 84, -9] },
        { t: 39.3, jump: true },
      ],
    },
    { id: 'hr', k: 'hero', p: [-6, -5], h: 127, yaw: 5 },
    // Doser 的人住在平台上（第三版分鏡：SPIRE 守的是這些人）；從平台上方往下找地面
    ...[
      // 16 秒鏡頭在第 1、2 層之間，看得到第 1 層的上面：抬頭看鏡頭的人、揮手的小孩
      ['d0', 'man', 1, 2, -1, 'Idle_Neutral'],
      ['d8', 'womanc', 1, 4, 1.5, 'Wave'],
      ['d9', 'farmer', 1, -0.5, -3, 'Interact'],
      ['d1', 'man', 2, 9.5, 5.5, 'Sitting'],
      ['d2', 'womanc', 2, 2.5, 6.8, 'Interact'],
      ['d3', 'hoodie', 3, -2.5, -7.5, 'Idle_Neutral'],
      ['d4', 'casual', 4, -6.5, 4.8, 'Wave'],
      ['d5', 'woman', 4, 0.5, -3.5, 'Idle'],
      ['d6', 'farmer', 6, 7.5, 7.2, 'Idle_Neutral'],
      ['d7', 'hooded', 8, 1.5, -2.2, 'Wave'],
    ].map(([id, who, lv, x, z, anim]) => {
      const [dx, dz] = TOWER.off[lv];
      return {
        id,
        k: 'human',
        who,
        p: [dx + x, TOWER.lv[lv] + 0.4, dz + z],
        anim,
        scale: who === 'womanc' && anim === 'Wave' ? 0.7 : 1, // 小孩
        s: [{ t: 0, face: lv === 1 ? [20, -15] : [0, 0] }],
      };
    }),
  ];
  const pin = [
    {
      id: 'cr1',
      spark: true,
      keys: [
        { t: 3.4, p: [10.6, 0.3, 2.4], yaw: 90, pitch: 0 },
        { t: 4.2, p: [10.2, 1.6, 2.4], yaw: 90, pitch: 90 },
        { t: 11.6, p: [10.2, 21.4, 2.4], yaw: 90, pitch: 90 },
        { t: 12.4, p: [8, 21.1, 2.4], yaw: 90, pitch: 0 },
      ],
    },
    // 第二隻爬行機：貼在第四層平台的外側往上爬（滑動變焦的主體）
    {
      id: 'cr2',
      spark: true,
      keys: [
        { t: 0, p: [-2, 38.5, -12.75], yaw: 180, pitch: 90 },
        { t: 29.6, p: [-2, 44.7, -12.75], yaw: 180, pitch: 90 },
        { t: 30.4, p: [-2, 46.1, -10.6], yaw: 180, pitch: 0 },
      ],
    },
    { id: 'ut1', keys: [{ t: 0, p: [10, 29.6, -4], yaw: 270 }] },
    { id: 'ut2', keys: [{ t: 0, p: [-6, 71.6, -10], yaw: 90 }] },
  ];
  const T = timeline();
  T.add(
    {
      set: GRID,
      grade: COLD,
      hook: ['c4tower', 'c4env', 'c4pin', 'c4dz'],
      ov: ['c4cloud', 'c4count', 'c4duo', 'c4title'],
      tw: TOWER,
      pad: PAD,
      pin,
      dz: { t0: 21.5, t1: 28.5, a: 'cr2', h: 7.5 },
      env: { y0: 72, y1: 118, cloudY: 100, fall: 6, lo: {}, hi: ABOVE, mul: { exposure: 1.22 } },
      cd: {
        from: 60,
        at: 0,
        label: 'VEERWELL LAUNCH CONTROL // PAD-2',
        call: [{ t: 50.5, d: 6, txt: '十、九、八——各位，往上看。' }],
      },
      duo: [
        {
          t: 12.6,
          d: 7.2,
          who: 'veerwell',
          side: 'l',
          text: '控制了唯一的路，就控制了一切。時間就是錢，傭兵！',
        },
        { t: 15.2, d: 6.6, who: 'sancta', side: 'r', text: '宇宙港旁邊住著從冰原逃來的人。……那裡住著人。' },
      ],
      vt: { t: 61.2, d: 7, text: '第四章　構造體', s: 'CHAPTER IV　//　THE STRUCTURE', x: 0.8 },
      fi: 2.2,
      fo: 1.2,
      actors,
      cam: { ease: 'lin', hand: 0.06, free: true, follow: 6, fog: 40, keys },
      ev: [
        { t: 0.3, sfx: 'heavy', vol: 0.6, rate: 0.45 },
        sub(1.2, L[0], null, 5.4),
        sub(7.2, L[1], null, 4.6),
        { t: 4.2, sfx: 'clatter1', vol: 0.5, rate: 0.7, at: { a: 'cr1' } },
        { t: 8.5, sfx: 'clatter2', vol: 0.4, rate: 0.6, at: { a: 'cr1' } },
        { t: 12.4, sfx: 'stepConc2', vol: 0.6, rate: 0.6, at: { a: 'cr1' } },
        sub(22.4, L[4], null, 5.6),
        { t: 21.6, sfx: 'thud1', vol: 0.6, rate: 0.4 },
        { t: 28.4, sfx: 'thud2', vol: 0.7, rate: 0.35 },
        { t: 34, card: 'SPIRE', s: 'Doser 的首領', style: 'name', dur: 5 },
        { t: 34, sfx: 'charge', vol: 0.5, rate: 0.6, at: { a: 'sp' } },
        sub(35.2, '這裡是我的家。闖進來的，就從最高的地方摔下去。', 'spire', 4.4),
        { t: 39.3, sfx: 'boostUp', vol: 0.8, rate: 0.8, at: { a: 'sp' } },
        { t: 43.5, sfx: 'boostDown', vol: 0.5, rate: 0.45 },
        sub(49, '所有人都在往上看。', null, 3.4),
        sub(52.8, '而你，是唯一被允許上去的人。只是你還不知道。', null, 5.6),
        // 倒數 0：遠方的發射架點火
        { t: 60, fx: 'flash', at: [PAD.at[0], 104, PAD.at[1]], r: 40, color: 0xfff0d0, life: 0.6 },
        { t: 60, flash: '#fff4e0', in: 0.05, hold: 0.06, out: 0.9 },
        { t: 60, sfx: 'explodeBig', vol: 0.8, rate: 0.4 },
        { t: 60.1, sfx: 'thrBurst', vol: 0.9, rate: 0.4 },
        { t: 60.2, shake: 0.5 },
        { t: 60.3, loop: 0.5, loopKey: 'thrustLoop', rate: 0.5 },
        { t: 67.5, loop: 0, loopKey: 'thrustLoop' },
      ],
    },
    D,
  );
  return def(T, {
    title: '第四章　開場',
    music: [{ at: 0, track: MUSIC, vol: 0.95, fadeIn: 1.5, fadeOut: [D - 2.5, 2.5] }],
  });
}

// ---------- 章末：依抉擇的三句 → 各勢力的頻道 → 霍斯特的手寫信 ----------
// 外圍聚落的位置（[x, z, 轉角, 0 棚屋／1～ 帳篷]）：發射台在 (0, −46)，聚落在它和鏡頭之間
const TOWN = [
  [-16, -22, 20, 0],
  [-6, -18, 0, 1],
  [6, -20, 90, 0],
  [16, -16, 0, 2],
  [-22, -8, 0, 3],
  [-10, -6, 30, 0],
  [2, -8, 0, 1],
  [12, -4, 70, 0],
  [22, -6, 0, 2],
  [-16, 4, 0, 1],
  [-4, 4, 15, 0],
  [8, 6, 0, 3],
  [18, 8, 0, 0],
];
const LAUNCH = { at: [0, -46], h: 40, r: 3.4, dir: [0, 1], front: 34, clearR: 75 };

export function ch4Outro(ctx) {
  const pick = (ctx.choices || {}).c4 === 'sancta' ? 'sancta' : 'veerwell';
  const L = pickLines(CHAPTER_TEXT[4].outro, { c4: pick });
  const T = timeline();
  if (pick === 'veerwell') {
    // 1. 夜裡亮起來的發射設施：從台面一路仰拍到火箭頂端（記者的閃光燈）
    T.add(
      {
        set: PORTN,
        grade: NIGHT,
        hook: 'c4launch',
        launch: { ...LAUNCH, mode: 'night', town: [] },
        fi: 1.6,
        actors: [
          {
            id: 'press',
            k: 'people',
            who: ['biz', 'casual', 'womanc', 'man', 'hoodie'],
            n: 10,
            p: [0, -11],
            box: [16, 3],
            anim: ['Idle', 'Idle_Neutral'],
            s: [{ t: 0, face: [0, -46] }],
            seed: 51,
          },
        ],
        cam: {
          ease: 'lin',
          hand: 0.05,
          free: true,
          keys: [
            { t: 0, p: [16, 1.6, 4], l: [0, 10, -46], fov: 44 },
            { t: 8.6, p: [12, 14, 0], l: [0, 34, -46], fov: 44 },
          ],
        },
        ev: [
          sub(0.6, L[0], null, 7.6),
          ...[1.2, 1.5, 2.6, 3.1, 4.4, 5.9, 6.2, 7.4].map((t, i) => ({
            t,
            fx: 'flash',
            at: [-8 + ((i * 7) % 16), 1.6, -10 - (i % 3)],
            r: 0.8,
            color: 0xffffff,
            life: 0.08,
          })),
          ...[1.2, 2.6, 4.4, 6.2].map((t) => ({ t, sfx: 'uiClick', vol: 0.3, rate: 0.7 })),
        ],
      },
      8.8,
    );
    // 2. 燒成一片黑的外圍聚落：低空沿著焦土橫移，聖域的人在灰裡找
    T.add(
      {
        set: PORT,
        grade: {
          sky: 'cloud',
          skyTop: '#241026',
          cloud: 0.6,
          fogColor: '#6a3040',
          fogColorK: 0.5,
          sunAz: 200,
          sunEl: 5,
          sunWarm: 0.85,
          tintHi: '#ff6a50',
          tintHiK: 0.45,
          tintLo: '#30183a',
          tintLoK: 0.5,
          sat: 0.6,
          fogK: 1.4,
        },
        hook: 'c4launch',
        launch: { ...LAUNCH, mode: 'burnt', town: TOWN },
        actors: [
          {
            id: 's1',
            k: 'type',
            key: 'mt',
            p: [-6, -12],
            yaw: 30,
            team: 'ally',
            pal: 'ally',
            s: [{ t: 0, go: [0, -14] }],
          },
          { id: 's2', k: 'type', key: 'repair', p: [4, -10], yaw: 0, team: 'ally', pal: 'ally' },
          { id: 's3', k: 'type', key: 'mt_shield', p: [10, -14], yaw: 300, team: 'ally', pal: 'ally' },
          {
            id: 'ash',
            k: 'people',
            who: PEOPLE,
            n: 14,
            p: [0, -6],
            box: [28, 12],
            anim: ['Interact', 'Interact', 'Idle_Neutral'],
            face: 'rnd',
            seed: 53,
          },
        ],
        cam: {
          ease: 'lin',
          hand: 0.08,
          free: true,
          keys: [
            { t: 0, p: [-24, 6.5, 20], l: [-4, 1, -10], fov: 42 },
            { t: 7.6, p: [16, 7.5, 22], l: [6, 1, -12], fov: 42 },
          ],
        },
        ev: [sub(0.5, L[1], null, 6.8), { t: 0.2, sfx: 'debris', vol: 0.4, rate: 0.6 }],
      },
      7.8,
    );
  } else {
    // 1. 封起來的大門：聖域的人輪流守著（從門腳仰拍到門頂）
    T.add(
      {
        set: PORT,
        grade: { ...DUSK, contrast: 1.1 },
        hook: 'c4gate',
        gate: { at: [0, -32], closed: true },
        fi: 1.6,
        actors: [
          { id: 'g1', k: 'type', key: 'mt_shield', p: [-6, -22], yaw: 180, team: 'ally', pal: 'ally' },
          { id: 'g2', k: 'type', key: 'mt_shield', p: [6, -22], yaw: 180, team: 'ally', pal: 'ally' },
          { id: 'g3', k: 'type', key: 'repair', p: [0, -18], yaw: 180, team: 'ally', pal: 'ally' },
          {
            id: 'gd',
            k: 'people',
            who: ['soldier', 'hooded', 'soldier'],
            n: 6,
            p: [0, -24],
            box: [12, 2],
            anim: ['Idle', 'Idle_Neutral'],
            s: [{ t: 0, face: [0, 10] }],
            seed: 55,
          },
        ],
        cam: {
          ease: 'lin',
          hand: 0.05,
          free: true,
          keys: [
            { t: 0, p: [16, 1.6, 26], l: [0, 10, -32], fov: 44 },
            { t: 8.6, p: [12, 20, 34], l: [0, 22, -32], fov: 44 },
          ],
        },
        ev: [sub(0.6, L[0], null, 7.6), { t: 0.3, sfx: 'door', vol: 0.5, rate: 0.35 }],
      },
      8.8,
    );
    // 2. 維爾威的運輸機一架一架往東飛（從大門上方往上看）
    T.add(
      {
        set: PORT,
        grade: { ...DUSK, contrast: 1.1 },
        hook: 'c4gate',
        gate: { at: [0, -32], closed: true, hideAt: [-20, 28, 30] },
        keep: true,
        actors: [
          { id: 'd1', k: 'type', key: 'dropship', p: [-30, -10], yaw: 270, s: [{ t: 0, go: [90, -20] }] },
          { id: 'd2', k: 'type', key: 'dropship', p: [-50, 4], yaw: 270, s: [{ t: 0.6, go: [80, -6] }] },
          { id: 'd3', k: 'type', key: 'heli', p: [-44, -30], yaw: 270, s: [{ t: 0.3, go: [80, -40] }] },
          {
            id: 'look',
            k: 'people',
            who: PEOPLE,
            n: 8,
            p: [-18, 22],
            box: [8, 4],
            anim: ['Idle_Neutral', 'Idle'],
            s: [{ t: 0, face: [10, -20] }],
            seed: 57,
          },
        ],
        cam: {
          ease: 'lin',
          hand: 0.06,
          free: true,
          keys: [
            { t: 0, p: [-30, 3, 30], l: [0, 18, -20], fov: 50 },
            { t: 7.6, p: [-24, 3.5, 32], l: [30, 20, -20], fov: 50 },
          ],
        },
        ev: [sub(0.5, L[1], null, 6.8), { t: 0.6, sfx: 'engineHi', vol: 0.4, rate: 0.5 }],
      },
      7.8,
    );
  }
  // 3. 洋上都市：鏡頭垂直往上拉，海平線出現
  T.add(
    {
      set: SEA,
      grade: { ...DUSK, sunAz: 120, tintLo: '#1c3450', sat: 0.85 },
      fi: 0.4,
      cam: {
        ease: 'in',
        hand: 0.05,
        free: true,
        fog: 60,
        keys: [
          { t: 0, p: [0, 3, 18], l: [0, 6, -30], fov: 50 },
          { t: 6.4, p: [0, 46, 30], l: [0, 20, -120], fov: 46 },
        ],
      },
      ev: [sub(0.5, L[2], null, 5.6), { t: 0.2, sfx: 'splash', vol: 0.3, rate: 0.5 }],
      fo: 0.6,
    },
    6.6,
  );
  // 4. 那天晚上，各勢力的頻道都在講東岸
  const R4 = [
    { t: 0.4, who: 'castron', txt: '東岸的報價，卡斯特隆再加兩成。' },
    { t: 1.1, who: 'aetheric', txt: '洋上都市的電纜，有我們要的資料。' },
    {
      t: 1.8,
      who: 'veerwell',
      txt: pick === 'veerwell' ? '校準只差最後一塊了。東岸見！' : '換個談法而已。東岸見，傭兵。',
    },
    { t: 2.5, who: 'sancta', txt: '東岸的避難船……還擠得下人嗎？' },
    { t: 3.1, who: 'enemy', txt: '……東岸……電纜……KEY……', noise: 0.25 },
    { t: 3.7, who: 'castron', txt: '所有單位，東岸集合。' },
    { t: 4.3, who: 'echo', txt: '……大家都在講東岸。' },
  ];
  T.add(
    {
      set: { k: 'black' },
      ov: 'c4radio',
      radio: R4,
      ev: [sub(0.6, L[3], null, 4.8), { t: 0.1, sfx: 'glitch', vol: 0.4, rate: 0.5 }],
    },
    5.6,
  );
  // 5. 霍斯特的私人信：手寫的字逐字寫出，背景很淡的夜空與軌道站的光點
  const H = parseLine(L[5]).text;
  const cut = H.indexOf('……');
  const p1 = cut > 0 ? H.slice(0, cut) : H;
  const rest = cut > 0 ? H.slice(cut) : '';
  // 「……還有，傭兵，」「不管上面有什麼在叫你，」「別回應它。」
  const parts = rest.split(/(?<=，)/);
  const lines = [p1, parts.slice(0, 2).join(''), parts[2] || '', parts.slice(3).join('')].filter(Boolean);
  const cps = 6.5,
    gap = 0.6;
  const writeT = 3.4;
  const nChars = lines.join('').length + 6;
  const done = writeT + nChars / cps + gap * lines.length;
  T.add(
    {
      set: { k: 'black' },
      ov: 'c4letter',
      letter: {
        t: writeT,
        cps,
        gap,
        lines,
        sign: '—— 霍斯特',
        head: ['PRIVATE MAIL // CASTRON HEAVY INDUSTRIES', 'FROM : HORST　　TO : R-07', 'ENCRYPTION : NONE'],
        sky: true,
        flare: done + 0.6,
      },
      fo: 2,
      ev: [sub(0.4, L[4], null, 2.9), { t: 0.2, sfx: 'uiOpen', vol: 0.3, rate: 0.6 }],
    },
    done + 4,
  );
  return def(T, {
    title: '第四章　章末',
    music: [{ at: 0, track: MUSIC, off: 0, vol: 0.75, fadeIn: 1.5, fadeOut: [T.at - 3, 3] }],
  });
}

// ---------- 抉擇 2：發射設施的去向 ----------
// 選前（live）：主角看著兩個出口 → 發射控制室（倒數 T−10、兩個按鈕的光）
export function c4Pre(ctx) {
  const opts = ctx.opts || [];
  const eo = opts.map((o, i) => ({ ...o, ex: i }));
  const live = { k: 'live' };
  const ROOM = [0, 300, 0];
  // 控制室是真實尺寸（公尺）：劇本座標要 ÷3（場景的倍率）
  const rp = (x, y, z) => [ROOM[0] + x / 3, ROOM[1] + y / 3, ROOM[2] + z / 3];
  const cd = { from: 10.6, at: 0, label: 'PAD-2 // LAUNCH AUTHORIZATION' };
  const T = timeline();
  T.add(
    {
      set: live,
      grade: { sat: 0.4, temp: -0.4, contrast: 1.15, vignette: 0.6, tintLo: '#20385a', tintLoK: 0.5 },
      ov: ['choice', 'c4count'],
      opts: eo,
      cd,
      cam: {
        fov: 50,
        hand: 0.05,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'player', at: 'head', o: [0, 2, 9], loc: true }, l: { ex: 0, o: [0, 3, 0] } },
          {
            t: 3,
            p: { a: 'player', at: 'head', o: [0, 3, 11], loc: true },
            l: { ex: Math.max(0, opts.length - 1), o: [0, 3, 0] },
          },
        ],
      },
      ev: [
        { t: 0, sfx: 'alarmBig', vol: 0.35, rate: 0.6 },
        ...opts.map((o, i) => ({ t: 0.2 + i * 0.3, fx: 'pillar', at: { ex: i }, r: 4, color: o.hex })),
      ],
    },
    3,
  );
  const d2 = 6.6;
  T.add(
    {
      set: live,
      grade: {
        exposure: 0.95,
        bloom: 1.35,
        contrast: 1.18,
        tintLo: '#0e1c28',
        tintLoK: 0.6,
        vignette: 0.7,
        sat: 0.95,
      },
      hook: 'c4room',
      room: ROOM,
      // 派克與諾拉：控制台後面、對著大螢幕的背影（委託方不露臉，第三版分鏡的 P2）
      actors: [
        {
          id: 'pk',
          k: 'human',
          who: 'hoodie',
          p: rp(-1.7, 0, -3.3),
          ground: false,
          dark: 0.75,
          s: [{ t: 0, face: rp(-0.6, 2.4, -4.2) }],
        },
        {
          id: 'nr',
          k: 'human',
          who: 'woman',
          p: rp(1.7, 0, -3.3),
          ground: false,
          dark: 0.75,
          s: [{ t: 0, face: rp(0.6, 2.4, -4.2) }],
        },
      ],
      ov: ['c4count', 'c4duo'],
      cd,
      duo: [
        { t: 0.2, d: 3.1, who: 'veerwell', side: 'l', text: '人類重新回到天空。你就是第一個推手，傭兵。' },
        { t: 2.5, d: 3.9, who: 'sancta', side: 'r', text: '如果你交出去，那兩千一百四十三個人會被燒掉。' },
      ],
      cam: {
        hand: 0.04,
        free: true,
        snap: true,
        keys: [
          { t: 0, p: rp(0, 2.0, 1.5), l: rp(0, 1.2, -1.8), fov: 50 },
          { t: 2.3, p: rp(-0.35, 2.05, 0.45), l: rp(-0.7, 1.0, -1.62), fov: 44 },
          { t: 4.6, p: rp(0.35, 2.05, 0.45), l: rp(0.7, 1.0, -1.62), fov: 44 },
          { t: d2, p: rp(0, 1.25, 0.1), l: rp(0, 1.95, -4), fov: 56 },
        ],
      },
      ev: [
        { t: 0, sfx: 'thud1', vol: 0.6, rate: 0.5 },
        { t: 1.6, sfx: 'thud2', vol: 0.5, rate: 0.5 },
        { t: 3.2, sfx: 'thud1', vol: 0.6, rate: 0.5 },
        { t: 4.6, sfx: 'thud2', vol: 0.55, rate: 0.5 },
        { t: 5.6, sfx: 'thud1', vol: 0.7, rate: 0.5 },
        { t: 6.1, sfx: 'thud2', vol: 0.7, rate: 0.5 },
      ],
    },
    d2,
  );
  return def(T, {
    title: '抉擇',
    music: [{ at: 0, track: MUSIC, off: 40, vol: 0.8, fadeIn: 0.5, fadeOut: [T.at - 1.2, 1.2] }],
  });
}

// 選後：維爾威＝一鏡跟著火箭升空，尾焰掃過外圍聚落
export function c4Veerwell() {
  const D = 15.6;
  const L = { ...LAUNCH, mode: 'lift', town: TOWN, ig: 3.2, t0: 4.4, acc: 5.2 };
  const ry = (t) => c4RocketY(t, L.t0, L.acc);
  // 鏡頭：聚落裡仰望火箭 → 尾焰撲過來 → 跟著火箭往上升 → 停在高處往下看燒黑的聚落
  const keys = [
    { t: 0, p: [7, 1.7, 20], l: [0, 16, -46], fov: 44 },
    { t: 3.2, p: [6, 1.9, 18], l: [0, 14, -46], fov: 46 },
  ];
  for (let t = 4.5; t <= 11; t += 0.5) {
    const y = Math.min(70, 2 + ry(t) * 0.55);
    keys.push({ t, p: [6 - (t - 4.5) * 1.2, y, 18 + (t - 4.5) * 1.4], l: [0, ry(t) + 20, -46], fov: 48 });
  }
  keys.push({ t: 13, p: [-2, 72, 28], l: [0, 30, -30], fov: 52 });
  keys.push({ t: D, p: [-3, 74, 30], l: [0, 2, -10], fov: 54 });
  const T = timeline();
  T.add(
    {
      set: PORT,
      grade: { ...DUSK, sat: 0.9, contrast: 1.15 },
      hook: 'c4launch',
      launch: L,
      ov: 'c4count',
      cd: { from: 3.2, at: 0, label: 'VEERWELL LAUNCH CONTROL // PAD-2' },
      fi: 0.6,
      actors: [
        {
          id: 'run',
          k: 'people',
          who: PEOPLE,
          n: 18,
          p: [0, -6],
          box: [30, 14],
          anim: ['Idle_Neutral', 'Idle'],
          s: [{ t: 0, face: [0, -46] }],
          go: [0, 26],
          goT: 3.3,
          stagger: 1.2,
          run: true,
          seed: 59,
        },
      ],
      cam: { ease: 'lin', hand: 0.1, free: true, follow: 8, fog: 40, keys },
      ev: [
        { t: 0.1, sfx: 'alarmBig', vol: 0.4, rate: 0.6 },
        { t: 3.2, sfx: 'explodeBig', vol: 1, rate: 0.45 },
        { t: 3.25, sfx: 'thrBurst', vol: 1, rate: 0.45 },
        { t: 3.3, shake: 1.1 },
        { t: 3.3, flash: '#ffd8a0', in: 0.05, hold: 0.05, out: 0.6 },
        { t: 3.4, loop: 0.8, loopKey: 'thrustLoop', rate: 0.5 },
        { t: 3.4, fx: 'shockwave', at: [0, 0.5, -46], r: 30, color: 0xffb070, life: 0.8 },
        // 尾焰撲到鏡頭：閃白
        { t: 5.05, flash: '#ffb070', in: 0.08, hold: 0.15, out: 0.9 },
        { t: 5.05, shake: 1.4 },
        { t: 5.1, sfx: 'explode3', vol: 0.9, rate: 0.6 },
        sub(9.4, '外圍的聚落，被尾焰掃過。', null, 3),
        sub(12.6, '聖域的人，在灰裡找名字。', null, 3),
        { t: 14, loop: 0, loopKey: 'thrustLoop' },
      ],
      fo: 1,
    },
    D,
  );
  T.add(
    {
      set: { k: 'black' },
      ev: [{ t: 0.2, card: '人類回到了天空。', s: 'LAUNCH AUTHORIZED', style: 'card', dur: 2.4 }],
    },
    2.8,
  );
  return def(T, {
    title: '發射設施：維爾威',
    music: [{ at: 0, track: MUSIC, off: 52, vol: 1, fadeOut: [T.at - 2, 2] }],
  });
}

// 選後：聖域＝大門關上，倒數停在 00:03 凍結
export function c4Sancta() {
  const D = 14.2;
  const G = { at: [0, -32], t0: 0.6, t1: 7, open: 11, freeze: 7 };
  const T = timeline();
  T.add(
    {
      set: PORT,
      grade: { ...DUSK, contrast: 1.12 },
      hook: 'c4gate',
      gate: G,
      ov: 'c4count',
      cd: { from: 10, at: 0, hold: 3, label: 'VEERWELL LAUNCH CONTROL // PAD-2' },
      fi: 0.6,
      actors: [
        { id: 'g1', k: 'type', key: 'mt_shield', p: [-7, -20], yaw: 180, team: 'ally', pal: 'ally' },
        { id: 'g2', k: 'type', key: 'mt_shield', p: [7, -20], yaw: 180, team: 'ally', pal: 'ally' },
        { id: 'g3', k: 'type', key: 'repair', p: [0, -16], yaw: 180, team: 'ally', pal: 'ally' },
        { id: 'd1', k: 'type', key: 'dropship', p: [-36, -4], yaw: 270, s: [{ t: 8, go: [90, -14] }] },
        { id: 'd2', k: 'type', key: 'dropship', p: [-52, 10], yaw: 270, s: [{ t: 8.6, go: [80, 0] }] },
        {
          id: 'in',
          k: 'people',
          who: PEOPLE,
          n: 16,
          p: [0, -37],
          box: [12, 4],
          anim: ['Idle_Neutral', 'Idle'],
          s: [{ t: 0, face: [0, 0] }],
          seed: 61,
        },
        {
          id: 'late',
          k: 'people',
          who: PEOPLE,
          n: 5,
          p: [4, -16],
          box: [8, 3],
          go: [-3, -12],
          goT: 3.5,
          stagger: 2,
          run: true,
          yaw: 180,
          seed: 63,
        },
      ],
      cam: {
        ease: 'out',
        hand: 0.05,
        free: true,
        keys: [
          { t: 0, p: [0, 2.2, 30], l: [0, 15, -40], fov: 40 },
          { t: 7, p: [0, 3.2, 8], l: [0, 14, -32], fov: 44 },
          { t: 9.5, p: [0, 3.4, 7], l: [0, 14, -32], fov: 44 },
          { t: D, p: [-2, 6, 12], l: [10, 26, -40], fov: 50 },
        ],
      },
      ev: [
        { t: 0.6, sfx: 'door', vol: 0.9, rate: 0.35 },
        { t: 0.6, loop: 0.4, loopKey: 'engineLoop', rate: 0.4 },
        sub(1.2, '發射設施的大門，關上了。', null, 4.4),
        { t: 6.95, loop: 0, loopKey: 'engineLoop' },
        { t: 7, sfx: 'heavy', vol: 1, rate: 0.4 },
        { t: 7, sfx: 'bong', vol: 0.6, rate: 0.5 },
        { t: 7.05, shake: 1.2 },
        { t: 7.05, flash: '#000000', in: 0.02, hold: 0.08, out: 0.35 },
        sub(8.4, '……謝謝你。我不知道該怎麼……謝謝你。', 'sancta', 3.4),
        sub(11.4, '維爾威的運輸機，一架一架往東飛。', null, 2.6),
      ],
      fo: 0.8,
    },
    D,
  );
  T.add(
    {
      set: { k: 'black' },
      ev: [{ t: 0.2, card: '發射台沉默了。', s: 'LAUNCH SEALED', style: 'card', dur: 2.4 }],
    },
    2.8,
  );
  return def(T, {
    title: '發射設施：聖域',
    music: [{ at: 0, track: MUSIC, off: 30, vol: 0.85, fadeOut: [T.at - 2, 2] }],
  });
}
