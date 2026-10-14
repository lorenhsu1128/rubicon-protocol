// 序章的過場動畫（game/cine.js 播放；運鏡參考 AC6 的預告片，內容是本作的世界觀，劇本 docs/story-script.md 的序章）
// 時間對齊配樂 cine_suspense（0:22 起伏、0:30 重拍、0:45.8 最強的一擊、0:50～1:09 每兩秒一下的脈動、1:18 第二次高潮）
// 與 cine_ident（1:46 開始：+4.4 秒、+13.1 秒兩記鋼琴重音）。
// 鏡頭的 at／dur 是秒；ev、s 的 t 是該鏡頭（演員：出場那一鏡）開始後的秒數。點的寫法見 game/cine.js 的 cinePt。

// 各周目不同的文字
const TXT = {
  1: {
    cards: ['這顆星球有一段訊號。', '沒有人知道是誰發的。', '只知道每次它響起，荒野就會醒過來。'],
    sys: [
      'ORBITAL CONTROL // LINK ESTABLISHED',
      'CYCLE ████ : TERMINATED',
      'RECALL PROCEDURE ...... COMPLETE',
    ],
    boot: '登錄號：R-07。經歷：無。',
    echo1: '醒了？我是 ECHO，你的作戰管制官。',
    echo2: '第一份委託已經在等你了。',
    zen1: '……又是你。',
    zen2: '這一次，你能走到哪裡？',
    last: ['echo', '照你的節奏來。'],
  },
  2: {
    cards: ['這顆星球有一段訊號。', '你聽過它。', '——又一次。'],
    sys: [
      'ORBITAL CONTROL // LINK ESTABLISHED',
      'CYCLE 0x02 : TERMINATED',
      'KEY-07 : RECALLED / MEMORY WIPE ... INCOMPLETE',
    ],
    boot: '登錄號：R-07。經歷：無。——不。經歷：有。',
    echo1: '……醒了？我是 ECHO，你的作戰管制官。',
    echo2: '第一份委託已經在等你了。',
    zen1: '……你也開始記得了。',
    zen2: '那就看清楚，是誰把你丟下來的。',
    last: [null, '她沒有說「照你的節奏來」。'],
  },
  3: {
    cards: ['這顆星球有一段訊號。', '這一次，', '你聽得出它在說什麼。'],
    sys: ['PRIVATE CHANNEL // OPEN', 'CYCLE 0x03', 'KEY-07 : AWAKE / MEMORY ...... RETAINED'],
    boot: '登錄號：R-07。',
    echo1: 'R-07。這是私人頻道，委託方聽不到。',
    echo2: '我知道你記得。我也記得。',
    zen1: '……這次，連她也站在你那邊。',
    zen2: '那就去吧。別回頭。',
    last: ['echo', '這一次，照我們的節奏來。'],
  },
};

// 世界觀的空景（四家委託方與軌道站）：每張 3 秒，對齊配樂的脈動
const VISTAS = [
  {
    set: { k: 'world', theme: 'industrial', seed: 3101, tod: 'dusk', clear: 18 },
    grade: {
      sunAz: 250,
      sunEl: 6,
      sunWarm: 0.75,
      tintHi: '#ffb070',
      tintHiK: 0.4,
      fogK: 1.6,
      sky: 'cloud',
      skyTop: '#3a2838',
      cloud: 0.55,
      fogColor: '#c0805a',
      fogColorK: 0.35,
      contrast: 1.15,
      sat: 0.9,
      dust: 0.6,
    },
    cam: [
      [0, [-30, 3, 26], [10, 8, -10]],
      [3, [-24, 12, 20], [12, 9, -14]],
    ],
    name: '卡斯特隆重工',
    s: '挖掘它。',
  },
  {
    set: { k: 'world', theme: 'institute', seed: 3102, clear: 16 },
    grade: { tintLo: '#20405a', tintLoK: 0.5, fogK: 1.3 },
    cam: [
      [0, [18, 2, 18], [-6, 6, -8]],
      [3, [10, 4, 22], [-8, 7, -10]],
    ],
    name: '艾瑟立克研究機構',
    s: '研究它。',
  },
  {
    set: { k: 'world', theme: 'spaceport', seed: 3103, tod: 'dusk', clear: 18 },
    grade: {
      sunAz: 200,
      sunEl: 8,
      sunWarm: 0.6,
      tintHi: '#ff9a70',
      tintHiK: 0.4,
      sky: 'cloud',
      skyTop: '#2a1838',
      cloud: 0.55,
      fogK: 1.8,
    },
    cam: [
      [0, [-12, 1.5, 30], [4, 16, -20]],
      [3, [-14, 1.5, 22], [4, 20, -20]],
    ],
    name: '維爾威動態',
    s: '買賣它。',
  },
  {
    set: { k: 'world', theme: 'snow', seed: 3104, clear: 16 },
    grade: {
      sunAz: 160,
      sunEl: 12,
      tintLo: '#30506a',
      tintLoK: 0.4,
      fogK: 1.2,
      sky: 'cloud',
      skyTop: '#5a7898',
      cloud: 0.5,
      contrast: 1.1,
    },
    cam: [
      [0, [20, 6, 20], [-10, 4, -10]],
      [3, [26, 8, 10], [-10, 4, -12]],
    ],
    name: '聖域互助同盟',
    s: '收容被它燒過的人。',
  },
  {
    set: { k: 'world', theme: 'orbit', seed: 3105, clear: 14 },
    grade: { sunAz: 30, sunEl: 6, sunWarm: 0.3, bloom: 1.1 },
    cam: [
      [0, [0, 3, 26], [0, 14, -30]],
      [3, [0, 2, 18], [0, 24, -30]],
    ],
    name: '而在所有人的頭上',
    s: '有一座沒有人提起的站。',
  },
];

export function prologueCine(ctx) {
  const T = TXT[ctx.cycle] || TXT[1];
  const shots = [];
  // ---- 0:00 訊號（黑畫面、波形、字卡）----
  shots.push({
    at: 0,
    set: { k: 'black' },
    ov: 'signal',
    lb: false,
    ev: [
      { t: 0.2, sfx: 'glitch', vol: 0.5, rate: 0.6 },
      { t: 1.5, card: T.cards[0], dur: 3.2 },
      { t: 4.2, sfx: 'glitch', vol: 0.35, rate: 0.5 },
      { t: 5.6, card: T.cards[1], dur: 3 },
      { t: 9.2, card: T.cards[2], dur: 3.6 },
      { t: 11.4, sfx: 'glitch', vol: 0.5, rate: 0.4 },
    ],
  });
  // ---- 0:13.5 軌道：太陽能環後方往行星推近 ----
  shots.push({
    at: 13.5,
    set: { k: 'space' },
    fi: 2.2,
    cam: {
      fov: 50,
      hand: 0.05,
      keys: [
        { t: 0, p: [-70, 46, 190], l: [90, -540, -900], fov: 52 },
        { t: 8.5, p: [-26, 22, 70], l: [80, -560, -900], fov: 47 },
      ],
      ease: 'lin',
    },
    ev: [
      { t: 0.5, sfx: 'distant', vol: 0.5, rate: 0.5 },
      { t: 2.6, sys: T.sys, dur: 5.4 },
    ],
  });
  // ---- 0:22 軌道站的外殼（近拍推軌），艙口的燈轉紅 ----
  shots.push({
    at: 22,
    set: { k: 'space' },
    actors: [{ id: 'podS', k: 'pod', parent: 'station', p: [0, -118, 0], keys: [{ t: 0, p: [0, -118, 0] }] }],
    cam: {
      fov: 36,
      hand: 0.08,
      keys: [
        { t: 0, p: { st: [34, 70, 30] }, l: { st: [0, -10, 0] } },
        { t: 8, p: { st: [30, -70, 34] }, l: { st: [0, -118, 0] } },
      ],
      ease: 'lin',
    },
    ev: [
      { t: 0, call: (g) => g.cineStationLamps(0xff3020) },
      { t: 0, sfx: 'alarm', vol: 0.25, rate: 0.6 },
      { t: 0.2, sfx: 'heavy', vol: 0.6, rate: 0.6 },
      { t: 1.2, sub: '第 ██ 週期，終了。', who: 'station', dur: 3 },
      { t: 4.6, sub: '投放程序，開始。', who: 'station', dur: 2.8 },
      { t: 5.5, sfx: 'door', vol: 0.6, rate: 0.5 },
    ],
  });
  // ---- 0:30 投放：夾爪鬆開、空降艙落下、推進器點火 ----
  shots.push({
    at: 30,
    set: { k: 'space' },
    drop: ['podS'],
    actors: [
      {
        id: 'podR',
        k: 'pod',
        parent: 'station',
        keys: [
          { t: 0, p: [0, -118, 0] },
          { t: 0.7, p: [0, -127, 0], thrust: 0 },
          { t: 0.9, p: [0, -130, 0], thrust: 1 },
          { t: 4.2, p: [0, -230, -12], thrust: 1 },
        ],
      },
    ],
    cam: {
      fov: 40,
      hand: 0.1,
      keys: [
        { t: 0, p: { st: [12, -104, 26] }, l: { a: 'podR' } },
        { t: 4.2, p: { st: [10, -112, 22] }, l: { a: 'podR' } },
      ],
      follow: 6,
    },
    ev: [
      { t: 0, sfx: 'heavy', vol: 1, rate: 0.7 },
      { t: 0, sfx: 'door', vol: 0.9, rate: 0.6 },
      { t: 0, shake: 0.35 },
      { t: 0.85, sfx: 'thrBurst', vol: 1, rate: 0.7 },
      { t: 0.9, sfx: 'boostUp', vol: 0.9, rate: 0.6 },
      { t: 0.9, shake: 0.5 },
      { t: 1, loop: 0.5, loopKey: 'thrustLoop', rate: 0.7 },
      { t: 1.2, sub: '投放座標：南部荒野。', who: 'station', dur: 2.8 },
    ],
  });
  // ---- 0:34.2 俯視：空降艙往雲層墜落（太陽在上方，看得到下面的雲與海）----
  shots.push({
    at: 34.2,
    set: { k: 'space' },
    sun: [0.35, 0.8, -0.45],
    actors: [
      {
        id: 'pod2',
        k: 'pod',
        keys: [
          { t: 0, p: [0, -40, -30], thrust: 1, heat: 0, r: [0, 0, 0] },
          { t: 3.8, p: [0, -170, -60], thrust: 1, heat: 0.35, r: [8, 40, 0] },
        ],
      },
    ],
    cam: {
      fov: 46,
      hand: 0.1,
      keys: [
        { t: 0, p: [4, -10, -16], l: { a: 'pod2' } },
        { t: 3.8, p: [4, -24, -22], l: { a: 'pod2' } },
      ],
      follow: 8,
    },
    ev: [{ t: 0.2, sfx: 'boostDown', vol: 0.7, rate: 0.5 }],
  });
  // ---- 0:38 大氣層突入：熱罩發紅、速度線、震動 → 0:45.8 撞擊的閃白 ----
  shots.push({
    at: 38,
    set: { k: 'space' },
    sun: [0.55, 0.22, -0.8],
    ov: 'speed',
    grade: { bloom: 0.85, bloomTh: 0.78, tintHi: '#ff8a50', tintHiK: 0.45, chroma: 0.35, exposure: 0.6 },
    actors: [
      {
        id: 'pod3',
        k: 'pod',
        keys: [
          { t: 0, p: [0, -200, 0], thrust: 0.3, heat: 0.7, r: [-10, 20, 6] },
          { t: 7.8, p: [0, -250, -24], thrust: 0.3, heat: 1, r: [-6, 70, -4] },
        ],
      },
    ],
    cam: {
      fov: 55,
      hand: 0.2,
      shake: 0.28,
      keys: [
        { t: 0, p: { a: 'pod3', o: [10, 3, 10] }, l: { a: 'pod3', o: [-4, -12, -24] }, roll: -8 },
        { t: 7.8, p: { a: 'pod3', o: [8, 2.5, 8] }, l: { a: 'pod3', o: [-4, -14, -22] }, roll: 5 },
      ],
      snap: true,
    },
    ev: [
      { t: 0, loop: 0.8, loopKey: 'engineLoop', rate: 0.6 },
      { t: 0.3, sfx: 'debris', vol: 0.8, rate: 0.6 },
      { t: 3, sfx: 'distant', vol: 0.8, rate: 0.7 },
      { t: 7.2, loop: 0 },
      { t: 7.78, flash: '#ffffff', in: 0.04, hold: 0.45, out: 0.9 },
      { t: 7.78, sfx: 'explodeBig', vol: 1, rate: 0.75 },
      { t: 7.8, sfx: 'boom2', vol: 1, rate: 0.6 },
      { t: 7.78, shake: 1.2 },
    ],
  });
  // ---- 0:46 Coral（黑底字卡）----
  shots.push({
    at: 46,
    set: { k: 'black' },
    ev: [{ t: 1.0, card: 'CORAL', s: '這顆星球唯一的燃料，也是唯一的戰爭理由。', dur: 3 }],
  });
  // ---- 0:50 世界觀的空景（四家委託方、軌道站），配樂每兩秒一下的脈動 ----
  let at = 50.1;
  VISTAS.forEach((v, i) => {
    shots.push({
      at,
      set: v.set,
      fi: 0.35,
      fo: 0.3,
      grade: v.grade,
      cam: {
        fov: 44,
        hand: 0.1,
        fog: 30,
        keys: v.cam.map(([t, p, l]) => ({ t, p, l })),
        ease: 'lin',
      },
      ev: [
        { t: 0.25, card: v.name, s: v.s, style: 'loc', dur: 2.3 },
        { t: 0, sfx: i % 2 ? 'thud2' : 'thud1', vol: 0.5, rate: 0.6 },
      ],
    });
    at += 3;
  });
  // ---- 1:05 傭兵（黑底字卡）----
  shots.push({
    at: 65.1,
    set: { k: 'black' },
    ev: [
      { t: 0.25, card: '他們都需要同一種東西。', dur: 1.7 },
      { t: 2.0, card: '不問理由的傭兵。', dur: 1.8 },
    ],
  });
  // ---- 1:09 甦醒：駕駛艙開機（地圖在黑畫面後面建好）----
  const crash = { k: 'world', theme: 'wasteland', seed: 3201, tod: 'dawn', clear: 26 };
  const dawn = {
    sunAz: 95,
    sunEl: 7,
    sunWarm: 0.7,
    sunK: 1.3,
    tintHi: '#ffb070',
    tintHiK: 0.35,
    fogK: 1.4,
    dust: 0.6,
  };
  shots.push({
    at: 69,
    set: crash,
    fade: 1,
    ov: 'boot',
    grade: dawn,
    actors: [
      { id: 'site', k: 'crash', p: [7, 0, -9] },
      { id: 'hero', k: 'hero', p: [0, 0], yaw: 200, s: [] },
    ],
    cam: { keys: [{ t: 0, p: [-8, 2, 10], l: [0, 3, 0] }] },
    ev: [
      {
        t: 0.1,
        sys: ['R-07 // NEURAL LINK ...... OK', 'GENERATOR ONLINE', 'FCS ONLINE'],
        dur: 3,
        cls: 'boot',
      },
      { t: 0.1, sfx: 'uiOpen', vol: 0.6, rate: 0.6 },
      { t: 1.0, sfx: 'charge', vol: 0.5, rate: 0.7 },
      { t: 1.3, sub: T.boot, dur: 2.1 },
      { t: 2.2, sfx: 'ui2', vol: 0.6, rate: 0.8 },
      { t: 0, a: 'hero', rise: 3.2 },
    ],
  });
  // ---- 1:12 墜落現場：機體從坑裡站起來 ----
  shots.push({
    at: 72.2,
    set: crash,
    grade: dawn,
    fi: 0.5,
    cam: {
      fov: 34,
      hand: 0.12,
      dof: 0.6,
      keys: [
        { t: 0, p: [-9, 1.0, 12], l: { a: 'hero', at: 'head', o: [0, -1, 0] } },
        { t: 3, p: [-6.5, 1.4, 8.5], l: { a: 'hero', at: 'head' } },
      ],
    },
    ev: [
      { t: 0, fx: 'smoke', at: [7, 2, -9], r: 3, life: 4, rise: 3 },
      { t: 0.2, sfx: 'heavy', vol: 0.8, rate: 0.6, at: [0, 1, 0] },
      { t: 0.4, sub: T.echo1, who: 'echo', dur: 3.2 },
      { t: 0.9, fx: 'smoke', at: [0, 0.6, 1], r: 2.2, life: 3, rise: 1.5, color: 0x8a7a68 },
      { t: 1.1, fx: 'smoke', at: [-1.5, 0.6, -1], r: 1.8, life: 3, rise: 1.2, color: 0x8a7a68 },
      { t: 1.4, fx: 'smoke', at: [8, 2.5, -9], r: 2.5, life: 4, rise: 4 },
      { t: 1.8, sfx: 'boostDown', vol: 0.6, rate: 0.7, at: [0, 3, 0] },
    ],
  });
  // ---- 1:15 頭部特寫，轉向遠方 → 閃白進入蒙太奇 ----
  shots.push({
    at: 75.2,
    set: crash,
    grade: { ...dawn, tintHiK: 0.45 },
    cam: {
      fov: 28,
      hand: 0.1,
      dof: 0.9,
      keys: [
        { t: 0, p: { a: 'hero', at: 'head', o: [3.5, -0.5, -4.5], loc: true }, l: { a: 'hero', at: 'head' } },
        {
          t: 2.8,
          p: { a: 'hero', at: 'head', o: [2.6, -0.2, -3.6], loc: true },
          l: { a: 'hero', at: 'head' },
        },
      ],
    },
    ev: [
      { t: 0.2, a: 'hero', aim: [-40, 6, -60] },
      { t: 0.3, sub: T.echo2, who: 'echo', dur: 2.4 },
      { t: 0.6, sfx: 'stepConc1', vol: 0.7, rate: 0.7, at: [0, 0, 0] },
      { t: 2.65, flash: '#ffffff', in: 0.12, hold: 0.1, out: 0.35 },
      { t: 2.6, sfx: 'boostUp', vol: 0.8, rate: 0.8 },
    ],
  });
  // ---- 1:18 蒙太奇 A：雪中的多重水壩 ----
  const dam = { k: 'world', theme: 'dam', seed: 3301, clear: 30 };
  const damG = { sunAz: 220, sunEl: 20, tintLo: '#284860', tintLoK: 0.35, contrast: 1.12 };
  shots.push({
    at: 78,
    set: dam,
    grade: damG,
    actors: [
      {
        id: 'h',
        k: 'hero',
        p: [-28, 2],
        yaw: 270,
        s: [
          { t: 0, go: [30, 2], aim: 'mt1' },
          { t: 0.2, qb: [1, 0] },
          { t: 0.3, fire: ['rarm', 'larm'], dur: 2.2, at: 'mt1' },
          { t: 1.3, qb: [1, 0.2] },
        ],
      },
      { id: 'mt1', k: 'type', key: 'mt', p: [8, -22], yaw: 0, s: [{ t: 0, aim: 'h', fire: 'rarm', dur: 2 }] },
      {
        id: 'mt2',
        k: 'type',
        key: 'mt',
        p: [18, -26],
        yaw: 0,
        s: [{ t: 0.3, aim: 'h', fire: 'rarm', dur: 2 }],
      },
      { id: 'tk', k: 'type', key: 'tank', p: [-4, -30], yaw: 0, s: [{ t: 0.5, aim: 'h' }] },
    ],
    cam: {
      fov: 46,
      hand: 0.15,
      keys: [
        { t: 0, p: { a: 'h', o: [-6, 3, 14] }, l: { a: 'h', o: [6, 0, -8] } },
        { t: 2.6, p: { a: 'h', o: [-4, 3.5, 13] }, l: { a: 'h', o: [8, 0, -8] } },
      ],
      follow: 10,
    },
    ev: [
      { t: 1.9, a: 'mt1', die: true },
      { t: 2.2, boom: { a: 'mt1' }, big: false, kill: true },
    ],
  });
  shots.push({
    at: 80.6,
    set: dam,
    grade: damG,
    cam: {
      fov: 30,
      hand: 0.2,
      keys: [
        { t: 0, p: { a: 'h', o: [5, 0.8, -6], loc: true }, l: { a: 'h' } },
        { t: 2.4, p: { a: 'h', o: [4, 1.2, -5], loc: true }, l: { a: 'h' } },
      ],
      follow: 16,
    },
    ev: [
      { t: 0.4, a: 'h', qb: [0.2, -1] },
      { t: 0.4, sfx: 'boostUp', vol: 0.9 },
      { t: 0.8, a: 'h', fire: 'lback', dur: 0.6, at: 'mt2' },
      { t: 1.5, a: 'h', fire: 'rback', dur: 0.6, at: 'tk' },
      { t: 2.0, a: 'tk', die: true },
    ],
  });
  shots.push({
    at: 83,
    set: dam,
    grade: { ...damG, contrast: 1.2 },
    actors: [
      {
        id: 'sl',
        k: 'ace',
        key: 'sluice',
        p: [6, -40],
        yaw: 0,
        h: 0,
        s: [
          { t: 0, aim: 'h', hover: true },
          { t: 0.4, fire: 'all', dur: 2.4 },
        ],
      },
    ],
    cam: {
      fov: 32,
      hand: 0.12,
      dof: 0.5,
      keys: [
        { t: 0, p: { a: 'h', o: [1.8, 2.2, 5.5], loc: true }, l: { a: 'sl' } },
        { t: 3, p: { a: 'h', o: [2.4, 2.6, 6.2], loc: true }, l: { a: 'sl' } },
      ],
    },
    ev: [
      { t: 0, a: 'h', aim: 'sl', stop: true },
      { t: 0.3, card: 'SLUICE', s: '水壩守備隊長', style: 'name', dur: 2.3 },
      { t: 0.6, a: 'h', fire: 'rarm', dur: 2, at: 'sl' },
      { t: 1.4, a: 'mt2', die: true },
      { t: 2.6, flash: '#ffffff', in: 0.05, hold: 0.12, out: 0.25 },
    ],
  });
  // ---- 1:26 蒙太奇 B：夜間的鐵路（武裝列車衝出隧道）----
  const rail = {
    k: 'world',
    theme: 'industrial',
    seed: 3302,
    tod: 'night',
    rail: true,
    align: 'rail',
    clear: 8,
  };
  const railG = {
    sunEl: 30,
    tintLo: '#18284a',
    tintLoK: 0.5,
    tintHi: '#ff9a60',
    tintHiK: 0.3,
    bloom: 1,
    exposure: 0.85,
  };
  shots.push({
    at: 86,
    set: rail,
    grade: railG,
    fi: 0.2,
    actors: [
      {
        id: 'train',
        k: 'train',
        yaw: 90,
        // 從遠方沿著鐵路衝過來，3 秒左右從鏡頭旁邊擦過
        keys: [
          { t: 0, p: [70, 0, 0], lin: true },
          { t: 7.8, p: [-90, 0, 0], lin: true },
        ],
      },
      {
        id: 'h',
        k: 'hero',
        p: [-14, -9],
        h: 0,
        yaw: 90,
        s: [
          { t: 0, aim: 'train', hover: true },
          { t: 0.5, fire: 'all', dur: 3.2, at: 'train' },
        ],
      },
    ],
    cam: {
      fov: 38,
      hand: 0.16,
      keys: [
        { t: 0, p: [-8, 1.3, 6], l: { a: 'train', o: [0, 3, 0] } },
        { t: 3.9, p: [-9, 1.5, 6.5], l: { a: 'train', o: [-6, 3, 0] } },
      ],
      follow: 6,
    },
    ev: [
      { t: 0, sfx: 'engineHi', vol: 1, rate: 0.45, at: { a: 'train' } },
      { t: 0.5, card: 'IRON CITADEL', s: '武裝列車', style: 'name', dur: 2.4 },
      { t: 1.4, boom: { a: 'train', o: [3, 4, 2] } },
      { t: 2.2, boom: { a: 'train', o: [12, 5, -2] } },
      { t: 2.9, shake: 0.7 },
      { t: 2.9, sfx: 'heavy', vol: 1, rate: 0.5 },
      { t: 3.2, fx: 'streaks', at: { a: 'train', o: [6, 2, 3] }, n: 40 },
    ],
  });
  shots.push({
    at: 89.9,
    set: rail,
    grade: railG,
    cam: {
      fov: 46,
      hand: 0.2,
      keys: [
        { t: 0, p: { a: 'h', o: [-5, 2.5, 7], loc: true }, l: { a: 'train', o: [4, 2, 0] }, roll: -5 },
        { t: 3.9, p: { a: 'h', o: [-6, 3, 8], loc: true }, l: { a: 'train', o: [10, 2, 0] }, roll: 4 },
      ],
      follow: 8,
    },
    ev: [
      { t: 0.2, a: 'h', hover: true, aim: 'train' },
      { t: 0.8, a: 'h', qb: [-0.3, -1] },
      { t: 0.8, sfx: 'boostUp', vol: 0.9 },
      { t: 1.3, boom: { a: 'train', o: [16, 4, 0] } },
      { t: 2.0, a: 'h', fire: 'all', dur: 1.6, at: 'train' },
      { t: 2.8, boom: { a: 'train', o: [24, 3, 1] }, big: true },
      { t: 3.0, slow: 0.3, dur: 0.6 },
      { t: 3.75, flash: '#ffffff', in: 0.05, hold: 0.2, out: 0.3 },
    ],
  });
  // ---- 1:33.8 蒙太奇 C：冰原的巨型鑽地蟲 ----
  const snow = { k: 'world', theme: 'snow', variant: 'icefield', seed: 3303, clear: 34 };
  const snowG = { sunAz: 140, sunEl: 14, tintLo: '#2a4860', tintLoK: 0.4, contrast: 1.15, dust: 0.5 };
  shots.push({
    at: 93.8,
    set: snow,
    grade: snowG,
    actors: [
      {
        id: 'worm',
        k: 'worm',
        n: 14,
        scale: 2.4,
        keys: [
          { t: 0, p: [0, -26, -30] },
          { t: 1.3, p: [0, 16, -28] },
          { t: 3.2, p: [8, 20, -18] },
        ],
      },
      {
        id: 'h',
        k: 'hero',
        p: [-4, 16],
        yaw: 180,
        s: [
          { t: 0.6, aim: 'worm', hover: true },
          { t: 1.4, qb: [-1, 0.4] },
        ],
      },
    ],
    cam: {
      fov: 50,
      hand: 0.25,
      keys: [
        { t: 0, p: [-10, 2, 30], l: [0, 6, -28] },
        { t: 3.2, p: [-14, 3, 32], l: [2, 16, -24] },
      ],
    },
    ev: [
      { t: 0, sfx: 'rock1', vol: 1, rate: 0.5 },
      { t: 0, shake: 0.8 },
      { t: 0.3, boom: [0, 0, -30], big: true },
      { t: 0.3, fx: 'dust', at: [0, 0, -30], r: 16, n: 40, color: 0xdde6ee },
      { t: 0.5, card: 'SANDWORM', s: '巨型鑽地蟲', style: 'name', dur: 2.4 },
      { t: 0.6, sfx: 'rock2', vol: 1, rate: 0.6 },
      { t: 1.0, fx: 'dust', at: [6, 0, -24], r: 10, n: 30, color: 0xdde6ee },
    ],
  });
  shots.push({
    at: 97,
    set: snow,
    grade: snowG,
    cam: {
      fov: 46,
      hand: 0.18,
      keys: [
        { t: 0, p: { a: 'h', o: [-3, 2.5, 8], loc: true }, l: { a: 'worm' } },
        { t: 3, p: { a: 'h', o: [-4, 3, 9], loc: true }, l: { a: 'worm' } },
      ],
      follow: 8,
    },
    ev: [
      { t: 0, a: 'h', go: [20, 0], aim: 'worm' },
      { t: 0.2, a: 'h', qb: [1, 0] },
      { t: 1.4, a: 'h', qb: [1, -0.3] },
      { t: 0.3, a: 'h', fire: 'all', dur: 2.4, at: 'worm' },
      { t: 1.2, boom: { a: 'worm', o: [0, 2, 0] }, big: false },
      { t: 2.1, boom: { a: 'worm', o: [2, -3, 1] }, big: false },
    ],
  });
  shots.push({
    at: 100,
    set: snow,
    grade: { ...snowG, contrast: 1.25 },
    actors: [
      {
        id: 'sp',
        k: 'ace',
        key: 'specimen',
        p: [26, -6],
        yaw: 90,
        s: [{ t: 0, aim: 'h', ab: true, go: [16, 2] }],
      },
    ],
    cam: {
      fov: 34,
      hand: 0.22,
      keys: [
        { t: 0, p: { a: 'h', o: [3, 1.5, 7] }, l: { a: 'sp' } },
        { t: 2.2, p: { a: 'h', o: [5, 2, 6] }, l: { a: 'sp' } },
      ],
      follow: 14,
    },
    ev: [
      { t: 0, a: 'h', ab: false, stop: true, aim: 'sp' },
      { t: 0.2, card: 'SPECIMEN', s: '「為什麼被選上的是你？」', style: 'name', dur: 2 },
      { t: 0.9, a: 'h', qb: [1, -0.2] },
      { t: 1.1, fx: 'flash', at: { a: 'sp', o: [-2, 0, 0] }, r: 2.2, color: 0x9fe8ff },
      { t: 1.1, sfx: 'shield', vol: 1, rate: 0.7 },
      { t: 1.1, shake: 0.6 },
      { t: 1.15, slow: 0.25, dur: 0.6 },
    ],
  });
  shots.push({
    at: 102.2,
    set: snow,
    grade: { ...snowG, bloom: 1.2 },
    cam: {
      fov: 58,
      hand: 0.25,
      keys: [
        { t: 0, p: { a: 'h', o: [-4, 1.5, 7] }, l: { a: 'worm' } },
        { t: 2.8, p: { a: 'h', o: [-6, 2.5, 9] }, l: { a: 'worm', o: [0, -4, 0] } },
      ],
    },
    ev: [
      { t: 0, a: 'h', hover: true, fire: 'all', dur: 2, at: 'worm' },
      { t: 0.8, boom: { a: 'worm' }, big: true, kill: true, shake: 0.8 },
      { t: 1.2, call: (g) => g.cineHide('worm') },
      { t: 1.2, boom: { a: 'worm', o: [0, -6, 4] }, big: true },
      { t: 1.25, slow: 0.35, dur: 0.8 },
      { t: 2.3, flash: '#ffffff', in: 0.08, hold: 0.3, out: 0.3 },
    ],
  });
  // ---- 1:45 黑畫面（洋上都市在後面建好）→ 1:50.4 ZENITH ----
  const sea = {
    k: 'world',
    theme: 'dunes',
    seed: 3401,
    tod: 'dusk',
    clear: 40,
    light: { sky: 0x4a2238, fog: 0x7a3040, sun: 0xff7a50, sunI: 1.2, hemi: 0x6a3050, hemiI: 0.5 },
  };
  const red = {
    sky: 'cloud',
    skyTop: '#2a1030',
    cloud: 0.65,
    fogColor: '#8a3848',
    fogColorK: 0.5,
    sunAz: 200,
    sunEl: 4,
    sunWarm: 0.8,
    sunK: 1.2,
    tintHi: '#ff6a50',
    tintHiK: 0.55,
    tintLo: '#40204a',
    tintLoK: 0.55,
    contrast: 1.12,
    bloom: 1.1,
    fogK: 1.6,
  };
  shots.push({
    at: 105,
    set: sea,
    fade: 1,
    grade: red,
    actors: [
      { id: 'zen', k: 'ace', key: 'zenith', p: [0, -4], yaw: 160 },
      { id: 'hero', k: 'hero', p: [-30, 10], yaw: 120 },
    ],
    cam: { keys: [{ t: 0, p: [3, 3, 4], l: [0, 3, -4] }] },
  });
  shots.push({
    at: 110.4,
    set: sea,
    grade: { ...red, contrast: 1.2 },
    cam: {
      fov: 26,
      hand: 0.08,
      dof: 1,
      keys: [
        { t: 0, p: { a: 'zen', at: 'head', o: [1.4, -0.8, -5.5], loc: true }, l: { a: 'zen', at: 'head' } },
        { t: 4.3, p: { a: 'zen', at: 'head', o: [1.0, -0.6, -4.2], loc: true }, l: { a: 'zen', at: 'head' } },
      ],
    },
    ev: [
      { t: 0, sfx: 'charge', vol: 0.6, rate: 0.6, at: { a: 'zen' } },
      { t: 1.1, sub: T.zen1, who: 'zenith', dur: 2.6 },
    ],
  });
  shots.push({
    at: 114.7,
    set: sea,
    grade: red,
    cam: {
      fov: 40,
      hand: 0.1,
      keys: [
        { t: 0, p: { a: 'zen', o: [-4, 1.5, 7] }, l: { a: 'zen', o: [0, 1, 0] } },
        { t: 4.4, p: { a: 'zen', o: [-5, 2, 9] }, l: { a: 'zen', o: [0, 4, 0] } },
      ],
      follow: 4,
    },
    ev: [
      { t: 0.2, sub: T.zen2, who: 'zenith', dur: 3.6 },
      { t: 2.2, a: 'zen', hover: true, ab: true, go: [10, -60] },
      { t: 2.2, sfx: 'boostUp', vol: 0.8, rate: 0.7, at: { a: 'zen' } },
    ],
  });
  // ---- 1:59 收尾：紅色天空下的剪影、Logo ----
  shots.push({
    at: 119.1,
    set: sea,
    grade: { ...red, exposure: 0.75, tintHiK: 0.6 },
    drop: ['zen'],
    fo: 3,
    cam: {
      fov: 38,
      hand: 0.05,
      keys: [
        { t: 0, p: { a: 'hero', o: [-3, 2.5, 9] }, l: { a: 'hero', o: [9, 5, -24] } },
        { t: 12.4, p: { a: 'hero', o: [-8, 4, 17] }, l: { a: 'hero', o: [9, 7, -24] } },
      ],
      ease: 'lin',
    },
    ev: [
      { t: 0, a: 'hero', aim: [40, 8, -80] },
      { t: 0.4, card: 'RUBICON PROTOCOL', s: '盧比孔協定', style: 'logo', dur: 4 },
      { t: 6.4, sub: T.last[1], who: T.last[0], dur: 3.4 },
    ],
  });
  return {
    title: '序章',
    dur: 131.6,
    lb: 2.39,
    music: [
      { at: 0, track: 'cine_suspense', vol: 1 },
      { at: 106, track: 'cine_ident', vol: 1 },
    ],
    shots,
  };
}
