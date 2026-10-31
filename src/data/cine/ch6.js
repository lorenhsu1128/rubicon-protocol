// 第 6 章 軌道——寂靜（docs/cinematics-storyboard.md 第二版）：開場（第 6 章沒有章末，接結局畫面）與最後的抉擇的演出。
// 鏡頭語言：《2001》《地心引力》——純黑、強光、高反差、極長鏡頭。開場全程從駕駛艙看出去（game/cine-c6.js 的 c6cockpit），
// 衝出大氣層的那一刻配樂與引擎聲全部斷掉；ZENITH 的對決刻意呼應第 1 章（眼燈／武器／遠景來回切、越切越快），
// 最後槍口對槍口停住、不開槍；沒有章名卡，只有軌道站的倒數。台詞＝CHAPTER_TEXT[6]、data/story.js 的結局。
import { ACES } from '../foes.js';
import { CHAPTER_TEXT } from '../story.js';

// ---------- 小工具 ----------
// 依序排鏡頭：add(鏡頭, 秒數)；at 自動累加（同一個場景的演員不會自動移除）
function seq() {
  let at = 0;
  const shots = [];
  return {
    shots,
    get at() {
      return at;
    },
    add(s, d) {
      const sh = { ...s, at };
      // 太空場景一律藏起碎片帶（純黑的寂靜）
      if (s.set === SPACE) sh.hook = [...[].concat(s.hook || []), 'c6clean'];
      shots.push(sh);
      at += d;
    },
  };
}
const SPACE = { k: 'space' };
const BLACK = { k: 'black' };
// 太空的基本調色：純黑、強光、高反差
const VOID = {
  contrast: 1.3,
  exposure: 0.9,
  bloom: 1.15,
  vignette: 0.55,
  grain: 0.1,
  chroma: 0.08,
  sat: 0.85,
};
const sub = (t, text, who, dur) => ({ t, sub: text, who: who || null, dur });
// 駕駛艙的機械聲（每一鏡都掛 c6snd，音量每格設定）
const SND = (eng, hum, rate) => ({ eng, hum, rate });
// 黑底字卡
const card = (title, s, d = 3) => ({
  set: BLACK,
  hook: 'c6snd',
  snd: SND(0, 0),
  ev: [{ t: 0.4, card: title, s, style: 'card', dur: d - 0.6 }],
});
const STATION_W = [330, 70, -560]; // 軌道站在太空場景的位置（render/cine-sets.js）
const PEOPLE = ['hooded', 'hooded', 'farmer', 'man', 'woman', 'womanc', 'casual'];
// 地上抬頭看天空的人（第三版分鏡：結局落在地上的人身上）；天上的光 sky＝[x, y, z]
const skyWatch = (set, grade, sky, color, n = 10) => ({
  set,
  grade,
  hook: 'c6snd',
  snd: SND(0, 0),
  fi: 0.5,
  actors: [
    {
      id: 'sw',
      k: 'people',
      who: PEOPLE,
      n,
      p: [-0.3, 2.2],
      box: [4.5, 1.5],
      anim: ['Idle_Neutral', 'Idle'],
      s: [{ t: 0, face: [sky[0], sky[2]] }],
      dark: 0.6,
      seed: 81,
    },
  ],
  cam: {
    fov: 40,
    hand: 0.06,
    ease: 'lin',
    keys: [
      { t: 0, p: [-1.5, 0.5, 4.5], l: [sky[0] * 0.15, 4, sky[2] * 0.15] },
      { t: 3.6, p: [-1.2, 0.6, 3.8], l: [sky[0] * 0.15, 4.4, sky[2] * 0.15] },
    ],
  },
  ev: [0.2, 0.9, 1.6, 2.3, 3.0].map((t, i) => ({
    t,
    fx: 'flash',
    at: [sky[0] + i * 4, sky[1] - i * 6, sky[2]],
    r: 6 - i * 0.6,
    color,
    life: 0.9,
  })),
});

// ---------- 開場 ----------
export function ch6Intro(ctx) {
  const L = CHAPTER_TEXT[6].intro;
  const c4 = (ctx.choices && ctx.choices.c4) || 'veerwell';
  const sancta = c4 === 'sancta';
  const T = seq();
  // 1. 發射台（駕駛艙）：維爾威的發射設施（黃昏、旗號）或聖域解封一次（夜、封印解除）
  const PAD = {
    k: 'world',
    theme: 'spaceport',
    seed: sancta ? 6412 : 6402,
    tod: sancta ? 'night' : 'dusk',
    clear: 30,
    far: 2600,
  };
  const padG = sancta
    ? { sunEl: 30, exposure: 0.8, tintLo: '#1a2a48', tintLoK: 0.5, contrast: 1.25, bloom: 1.1 }
    : {
        sunAz: 250,
        sunEl: 5,
        sunWarm: 0.75,
        tintHi: '#ffa060',
        tintHiK: 0.4,
        contrast: 1.2,
        fogK: 3,
        sky: 'cloud',
        skyTop: '#3a2838',
        cloud: 0.55,
        fogColor: '#c0805a',
        fogColorK: 0.35,
      };
  const padSt = sancta
    ? ['SANCTA LAUNCH FACILITY', 'SEAL RELEASE ...... 1 / 1', 'NO SECOND LAUNCH']
    : ['VEERWELL LAUNCH COMPLEX // PAD 02', 'PAYLOAD : AC  R-07', 'COMMERCIAL FLIGHT 0001'];
  const padLines = sancta
    ? [
        ['我們封鎖的發射設施，只能解封一次。', 'sancta'],
        ['回來的時候，告訴我上面有什麼。', 'sancta'],
      ]
    : [
        ['歷史性的一刻，傭兵！維爾威的發射設施，為你準備好了。', 'veerwell'],
        ['……說真的，你上去之後還會回來吧？', 'veerwell'],
      ];
  const IGN = 6.2;
  T.add(
    {
      set: PAD,
      lb: false,
      fi: 1.2,
      grade: padG,
      ov: ['c6cockpit'],
      hook: ['c6snd', 'c6pad'],
      snd: SND([0.05, 0.35], 0.18, [0.4, 0.55]),
      ck: { alt: 0, spd: 0, heat: 0.02, st: padSt, stc: sancta ? 'rgba(240,220,120,0.9)' : null, count: IGN },
      actors: [
        {
          id: 'see',
          k: 'people',
          who: sancta ? PEOPLE : ['crew', 'hoodie', 'casual', 'worker'],
          n: 40,
          p: [-8, -70],
          box: [30, 12],
          anim: ['Wave', 'Idle_Neutral', 'Wave'],
          s: [{ t: 0, face: [0, 6] }],
          seed: 83,
        },
      ],
      cam: {
        fov: 52,
        hand: 0.04,
        free: true,
        ease: 'lin',
        keys: [
          { t: 0, p: [0, 24, 6], l: [-10, 16, -120] },
          { t: 7, p: [0, 24.2, 6], l: [-6, 16.5, -120] },
        ],
      },
      ev: [
        sub(0.8, padLines[0][0], padLines[0][1], 2.8),
        sub(3.6, padLines[1][0], padLines[1][1], 2.3),
        { t: 0.6, sfx: 'heavy', vol: 0.4, rate: 0.5 },
        ...(sancta ? [{ t: 1.4, sfx: 'door', vol: 0.6, rate: 0.45 }] : []),
        { t: 3.0, sfx: 'charge', vol: 0.4, rate: 0.5 },
        { t: 4.6, shake: 0.25 },
        { t: IGN - 0.4, sfx: 'thrBurst', vol: 1, rate: 0.45 },
        { t: IGN, sfx: 'explodeBig', vol: 0.9, rate: 0.45 },
        { t: IGN, flash: '#ffd6a0', in: 0.04, hold: 0.1, out: 0.7 },
        { t: IGN, shake: 1.6 },
        { t: IGN, fx: 'smoke', at: [-14, 2, -26], r: 9, life: 5, rise: 6, color: 0xb0a898 },
        { t: IGN, fx: 'smoke', at: [16, 2, -30], r: 10, life: 5, rise: 6, color: 0xb0a898 },
        { t: IGN, fx: 'streaks', at: [0, 4, -18], n: 70, color: 0xffc080, speed: 40, grav: -10 },
        { t: IGN, fx: 'shockwave', at: [0, 1, -10], r: 40, color: 0xffb070, life: 0.8 },
      ],
    },
    7,
  );
  // 2. 上升：地面往下掉，熱罩開始發紅
  T.add(
    {
      set: PAD,
      lb: false,
      grade: { ...padG, mblurK: 0.4 },
      ov: ['c6cockpit'],
      hook: ['c6snd', 'c6sky', 'c6pad'],
      snd: SND(0.95, 0.1, [0.55, 0.85]),
      sky: sancta
        ? { col: { skyTop: ['#101a30', '#02040a'] }, num: { fogK: [1, 4] } }
        : { col: { skyTop: ['#3a2838', '#141a30'] }, num: { fogK: [3, 6], cloud: [0.55, 0.3] } },
      ck: { alt: [40, 11800], spd: [30, 980], heat: [0.08, 0.55], ease: 'in', shake: 0.6 },
      cam: {
        fov: 56,
        hand: 0.05,
        shake: 0.5,
        free: true,
        fog: 300,
        ease: 'in',
        keys: [
          { t: 0, p: [0, 24.3, 6], l: [-6, 16.5, -120] },
          { t: 6.4, p: [0, 1300, -200], l: [-120, 1500, -1400], roll: -4 },
        ],
      },
      ev: [{ t: 0, shake: 1.2 }],
    },
    6.4,
  );
  // 3. 雲海往下掉：太空場景的行星（雲層）從低空看出去，地平線一路往下沉，熱罩最紅 → 下一鏡衝出大氣層
  T.add(
    {
      set: SPACE,
      lb: false,
      fi: 0.4,
      fc: '#ffffff',
      sun: [0.55, 0.35, -0.75],
      grade: { contrast: 1.25, exposure: 0.95, bloom: 1.2, tintHi: '#ffb080', tintHiK: 0.25 },
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: SND(0.95, 0.1, [0.85, 1]),
      ck: { alt: [24000, 96000], spd: [1700, 7400], heat: [0.95, 0.5], shake: 0.8 },
      cam: {
        fov: 58,
        hand: 0.05,
        shake: 0.6,
        ease: 'in',
        keys: [
          { t: 0, p: [0, -500, 300], l: [-200, -640, -1400], roll: 8 },
          { t: 5, p: [0, -60, 200], l: [-200, -640, -1400], roll: -4 },
        ],
      },
      ev: [{ t: 0, shake: 1 }],
    },
    5,
  );
  // 4. 寂靜：衝出大氣層的那一刻聲音全部消失；軌道站用極長的鏡頭慢慢轉進畫面，鏡頭翻滾（沒有固定的上方）
  const dS = 11;
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.22, kill: true },
      ck: { alt: [102000, 118000], spd: [7600, 7700], heat: [0.35, 0], vac: true, ease: 'out' },
      cam: {
        fov: 40,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-40, 10, 60], l: [-300, -700, -700], roll: -32, fov: 42 },
          { t: dS, p: [-12, 6, 4], l: STATION_W, roll: 9, fov: 30 },
        ],
      },
      ev: [
        sub(2.2, L[0], null, 4),
        sub(6.8, L[1], null, 4),
        { t: 4.5, sfx: 'glitch', vol: 0.1, rate: 0.35 },
        { t: 8.6, sfx: 'ui2', vol: 0.12, rate: 0.6 },
      ],
    },
    dS,
  );
  // 5. 你問：為什麼是我？
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.22 },
      ck: { alt: 118400, spd: 7700, heat: 0, vac: true, st: 'KEY-07 // QUERY' },
      cam: {
        fov: 26,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-12, 6, 4], l: STATION_W, roll: 9 },
          { t: 2.6, p: [-10, 6, 0], l: STATION_W, roll: 10 },
        ],
      },
      ev: [sub(0.3, L[2], null, 2.2)],
    },
    2.6,
  );
  // 6. 四個委託方的回答：無聲的快切，只有字幕（通訊視窗的聲紋是平的）
  const ANS = [
    ['castron', '因為你最強。', [80, -40, -700], 18, -6, 1.6],
    ['aetheric', '因為你最合適。', [-200, -900, -1500], 34, 14, 1.6],
    ['veerwell', '因為你最紅。', [-600, 700, -900], 28, -18, 1.6],
    ['sancta', '……我不知道。我也想知道。', [400, -1100, 500], 40, 4, 2.6],
  ];
  for (const [who, line, look, fov, roll, d] of ANS)
    T.add(
      {
        set: SPACE,
        lb: false,
        sun: [0.8, 0.15, -0.55],
        grade: VOID,
        ov: ['c6cockpit'],
        hook: 'c6snd',
        snd: { eng: 0, hum: 0.22 },
        ck: { alt: 118400, spd: 7700, heat: 0, vac: true, win: who, dim: 0.5 },
        cam: {
          fov,
          hand: 0.02,
          ease: 'lin',
          keys: [
            { t: 0, p: [-10, 6, 0], l: look, roll },
            { t: d, p: [-10, 6, 0], l: look, roll: roll + 1.5 },
          ],
        },
        ev: [sub(0.12, line, null, d - 0.2)],
      },
      d,
    );
  // 7. 只有 ECHO 什麼都沒說（雜訊）
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.22 },
      ck: { alt: 118400, spd: 7700, heat: 0, vac: true, win: 'echo', dim: 0.5 },
      cam: {
        fov: 22,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: STATION_W, roll: 10 },
          { t: 3.2, p: [-9, 6, -2], l: STATION_W, roll: 11 },
        ],
      },
      ev: [
        sub(0.4, L[7], null, 2.6),
        { t: 0.1, sfx: 'glitch', vol: 0.22, rate: 0.4 },
        { t: 1.8, sfx: 'glitch', vol: 0.15, rate: 0.35 },
      ],
    },
    3.2,
  );
  // 8. ZENITH：無重力的外環，第 1 章的對決剪法（眼燈／武器／遠景來回切、越切越快），最後槍口對槍口停住
  duel(T);
  // 9. 沒有章名卡，只有軌道站的倒數
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      fo: 1.6,
      ov: ['c6cockpit', 'c6count'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.2 },
      cd: 3 * 3600 + 14 * 60 + 7.6,
      ck: { off: true },
      cam: {
        fov: 30,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-30, 8, 40], l: STATION_W, roll: 4 },
          { t: 5.4, p: [-26, 8, 30], l: STATION_W, roll: 6 },
        ],
      },
      ev: [{ t: 0.2, sfx: 'uiTick', vol: 0.3, rate: 0.6 }],
    },
    5.4,
  );
  const dur = T.at + 0.3;
  const zEnd = T.shots.find((s) => s.dc && s.dc.k === 'end').at;
  return {
    title: '第六章　開場',
    dur,
    lb: 2.39,
    music: [
      // 發射到衝出大氣層：一到太空就整個斷掉
      { at: 0, track: 'cine_c6', vol: 0.85, fadeIn: 1.5, fadeOut: [T.shots[3].at - 0.05, 0.08] },
      // 槍口對槍口之後才慢慢回來
      { at: zEnd + 1.5, track: 'cine_c6', off: 60, vol: 0.6, fadeIn: 3, fadeOut: [dur - 2, 1.8] },
    ],
    shots: T.shots,
  };
}

// ZENITH 的對決：主角（hz）與 ZENITH（zz）是掛在軌道站上的模型演員，站在外環的兩個模組上（軌道站座標）
// 外環：y＝40、半徑 44 的一圈模組（頂面 y＝43.5）。兩台在 0 號與 2 號模組上，相距約 34 m，最後靠到槍口對槍口
function duel(T) {
  const H0 = [44, 44.6, 0],
    Z0 = [31.1, 45.2, 31.1];
  // 主角 → ZENITH 的方向（軌道站座標的水平面）與側向
  const ax = [-0.3831, 0.9237],
    sd = [-0.9237, -0.3831];
  const mid = [37.55, 15.55];
  const half = 3.5;
  const H1 = [mid[0] - ax[0] * half, 44.9, mid[1] - ax[1] * half],
    // ZENITH 往側邊錯開，讓兩把右手的槍在同一條線上
    Z1 = [mid[0] + ax[0] * half + sd[0] * 2.2, 45.5, mid[1] + ax[1] * half + sd[1] * 2.2];
  const at = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
  const DUR = [5, 2.4, 1.9, 1.5, 1.2, 0.9, 0.7, 0.5, 0.4, 0.3, 6.2];
  const t12 = DUR.slice(0, 5).reduce((a, b) => a + b, 0) + 0.6; // 開始逼近
  const tFin = DUR.slice(0, 10).reduce((a, b) => a + b, 0); // 停住
  const total = DUR.reduce((a, b) => a + b, 0);
  const zen = ACES.zenith;
  const actors = [
    {
      id: 'hz',
      k: 'model',
      mech: true,
      pal: 'player',
      parent: 'station',
      keys: [
        { t: 0, p: H0, r: [4, 157.5, -5] },
        { t: t12, p: at(H0, H1, 0.15), r: [2, 157.5, -3] },
        { t: tFin, p: H1, r: [0, 157.5, 0] },
        { t: total, p: [H1[0], H1[1] + 0.15, H1[2]], r: [0.4, 157.5, 0.4] },
      ],
    },
    {
      id: 'zz',
      k: 'model',
      mech: true,
      asm: zen.asm,
      pal: zen.pal,
      parent: 'station',
      keys: [
        { t: 0, p: Z0, r: [-5, -22.5, 6] },
        { t: t12, p: at(Z0, Z1, 0.15), r: [-3, -22.5, 3] },
        { t: tFin, p: Z1, r: [0, -22.5, 0] },
        { t: total, p: [Z1[0], Z1[1] - 0.12, Z1[2]], r: [-0.4, -22.5, -0.4] },
      ],
    },
  ];
  // 每一鏡：[鏡頭的種類, 誰, 距離, fov, 舉槍]
  const CUTS = [
    { k: 'far', who: 'hz', d: [100, 86], fov: 24, aim: 0, up: 0.22 },
    { k: 'eye', who: 'zz', d: [3.4, 2.7], fov: 22, aim: 0 },
    { k: 'eye', who: 'hz', d: [3.2, 2.7], fov: 22, aim: 0 },
    { k: 'gun', who: 'zz', d: [2.6, 2.3], fov: 32, aim: 0 },
    { k: 'wide', who: 'hz', d: [18, 16], fov: 52, aim: 0, up: 0.9 },
    { k: 'eye', who: 'zz', d: [2.6, 2.3], fov: 22, aim: [0, 0.2] },
    { k: 'gun', who: 'hz', d: [2.5, 2.2], fov: 32, aim: [0.2, 0.45] },
    { k: 'eye', who: 'hz', d: [2.4, 2.2], fov: 22, aim: [0.45, 0.6] },
    { k: 'wide', who: 'hz', d: [13, 11.5], fov: 36, aim: [0.6, 1] },
    { k: 'eye', who: 'zz', d: [2.0, 1.9], fov: 22, aim: 1 },
    { k: 'end', who: 'hz', d: [13, 11.5], fov: 30, aim: 1, up: 0.03 },
  ];
  CUTS.forEach((C, i) => {
    const d = DUR[i];
    const ev = [];
    if (i === 0) {
      ev.push(
        { t: 0.6, card: 'ZENITH', s: '上一位鑰匙', style: 'name', dur: 3.8 },
        sub(2.2, '……又是你。', 'zenith', 2.6),
      );
    } else if (i < 10) {
      // 第 1 章的剪法：每切一次，心跳更快更重
      ev.push({ t: 0, call: (g) => g.cineC6Beat(i / 10) });
    } else {
      // 槍口對槍口：心跳停了，全靜
      ev.push(sub(1.0, '這一次，你能走到哪裡？', 'zenith', 3.8), {
        t: 0,
        sfx: 'uiTick',
        vol: 0.25,
        rate: 0.4,
      });
    }
    T.add(
      {
        set: SPACE,
        sun: [0.95, 0.25, 0.15],
        grade: { ...VOID, contrast: 1.38, exposure: 0.95, dof: 0 },
        hook: ['c6snd', 'c6duel'],
        snd: { eng: 0, hum: i === 10 ? 0.05 : 0.18 },
        dc: { k: C.k, who: C.who, d: C.d, fov: C.fov, up: C.up },
        aim: C.aim,
        ...(i === 0 ? { actors } : {}),
        cam: { keys: [{ t: 0, p: [0, 0, 0], l: STATION_W }] },
        ev,
      },
      d,
    );
  });
}

// ---------- 最後的抉擇：選前（live：目前的戰場、遊戲暫停）----------
// 寂靜、駕駛艙視角（主角的頭上），中樞的門（出口；第 3 周目三扇）的光、委託方的頻道一個個亮起、ECHO 沉默
export function c6Pre(ctx) {
  const opts = ctx.opts || [];
  const n = opts.length;
  const third = n > 2;
  const T = seq();
  const live = { k: 'live' };
  const lit = (i) => (i < 2 ? 0.3 + i * 0.6 : 11.2); // 第三扇門最後才亮
  const eo = opts.map((o, i) => ({ ...o, ex: i, lit: lit(i) }));
  const chans = [
    ['castron', 0.5],
    ['aetheric', 1.0],
    ['veerwell', 1.5],
    ['sancta', 2.0],
    ['echo', 2.6],
  ];
  const GR = {
    exposure: 0.5,
    sat: 0.3,
    contrast: 1.4,
    vignette: 0.85,
    fogColor: '#000000',
    fogColorK: 0.9,
    fogK: 0.5,
    bloom: 1.15,
    temp: -0.3,
  };
  const head = (o) => ({ a: 'player', at: 'head', o });
  const base = (d, i, ev, look0, look1) => ({
    set: live,
    lb: false,
    grade: GR,
    ov: ['c6pre', 'c6cockpit'],
    hook: 'c6pre',
    opts: eo,
    ck: {
      min: true,
      st: 'STATION CORE',
      chans: chans.map(([w, t]) => [w, t - (i ? 99 : 0)]),
      dim: 0.55,
    },
    cam: {
      fov: 44,
      hand: 0.03,
      ease: 'lin',
      keys: [
        { t: 0, p: head([0, 1.3, 0]), l: look0 },
        { t: d, p: head([0, 1.2, 0]), l: look1 },
      ],
    },
    ev,
  });
  const beats = (d, from, gap) => {
    const out = [];
    for (let t = from; t < d; t += gap) out.push({ t, call: (g) => g.cineC6Beat(0.4) });
    return out;
  };
  const exL = (i) => ({ ex: Math.min(i, n - 1), o: [0, 4, 0] });
  // 1. 門的光、頻道一個個亮起
  T.add(
    base(
      3.4,
      0,
      [...chans.map(([, t]) => ({ t, sfx: 'ui2', vol: 0.25, rate: 0.6 })), ...beats(3.4, 0.4, 1.1)],
      exL(0),
      exL(1),
    ),
    3.4,
  );
  // 2. 霍斯特
  T.add(
    base(
      3.9,
      1,
      [sub(0.2, '你守約了。……把它交給我們，傭兵。', 'castron', 3.5), ...beats(3.9, 0.6, 1)],
      exL(0),
      exL(0),
    ),
    3.9,
  );
  // 3. 諾拉
  T.add(
    base(
      3.9,
      1,
      [sub(0.2, '……拜託。讓天空安靜下來。', 'sancta', 3.5), ...beats(3.9, 0.5, 0.9)],
      exL(1),
      exL(1),
    ),
    3.9,
  );
  // 4. 第 3 周目：第三扇門亮起。ECHO 什麼都沒說
  if (third)
    T.add(
      base(
        3,
        1,
        [sub(0.6, '……', 'echo', 2.2), { t: 0, sfx: 'charge', vol: 0.3, rate: 0.4 }, ...beats(3, 0.4, 0.8)],
        exL(2),
        exL(2),
      ),
      3,
    );
  return { title: '最後的抉擇', dur: T.at + 0.3, lb: 2.39, music: [], shots: T.shots };
}

// ---------- 選後 ----------
// 交出：認證完成 → 錄影帶倒轉（雲、海、荒野）
export function c6Open() {
  const T = seq();
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.2 },
      ck: {
        alt: 118400,
        spd: 0,
        heat: 0,
        vac: true,
        st: ['CORE ACCESS : 4 SIGNATORIES', 'KEY-07 : AUTHENTICATING'],
      },
      cam: {
        fov: 22,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: { st: [0, -40, 0] }, roll: 6 },
          { t: 4.6, p: [-6, 5, -10], l: { st: [0, -60, 0] }, roll: 8 },
        ],
      },
      ev: [
        sub(0.3, '四家代表，走進中樞。', null, 1.7),
        { t: 1.9, call: (g) => g.cineStationLamps(0xffffff) },
        { t: 1.9, sfx: 'glitch', vol: 0.5, rate: 0.6 },
        sub(2.0, '認證完成。KEY-07。盧比孔協定，執行。', 'station', 2.5),
        { t: 4.35, flash: '#ffffff', in: 0.1, hold: 0.15, out: 0.1 },
      ],
    },
    4.6,
  );
  // 倒轉開始（黑畫面上的 ■ STOP → ◀◀）
  T.add(
    {
      set: BLACK,
      ov: ['c6vhs'],
      vhs: { stop: true },
      hook: 'c6snd',
      snd: SND(0, 0),
      ev: [{ t: 0.1, sfx: 'uiTick', vol: 0.6, rate: 0.5 }],
    },
    0.6,
  );
  const RW = { sat: 0.35, chroma: 1, grain: 0.4, contrast: 1.15, vignette: 0.6 };
  // 雲：鏡頭倒退著落回雲海
  T.add(
    {
      set: { k: 'world', theme: 'orbit', seed: 6601, clear: 26, far: 2400 },
      grade: { ...RW, sky: 'cloud', skyTop: '#6f8fc0', cloud: 0.4 },
      ov: ['c6vhs'],
      vhs: { tc: 47 * 60 + 12 },
      hook: 'c6snd',
      snd: SND(0, 0),
      cam: {
        fov: 50,
        hand: 0.1,
        free: true,
        fog: 300,
        ease: 'out',
        keys: [
          { t: 0, p: [0, 700, -200], l: [0, 560, -1600] },
          { t: 2.8, p: [0, -4, 60], l: [0, -30, -400] },
        ],
      },
      ev: [{ t: 0, sfx: 'boostDown', vol: 0.6, rate: 0.35 }],
    },
    2.8,
  );
  // 海
  T.add(
    {
      set: { k: 'world', theme: 'xylem', seed: 6501, clear: 26 },
      grade: RW,
      ov: ['c6vhs'],
      vhs: { tc: 31 * 60 + 40 },
      hook: 'c6snd',
      snd: SND(0, 0),
      cam: {
        fov: 46,
        hand: 0.15,
        free: true,
        ease: 'lin',
        keys: [
          { t: 0, p: [40, 6, -40], l: [80, 2, -120] },
          { t: 2.8, p: [-40, 9, 40], l: [0, 4, -40] },
        ],
      },
      ev: [{ t: 0, sfx: 'boostDown', vol: 0.6, rate: 0.3 }],
    },
    2.8,
  );
  // 荒野：主角倒退著走回去（錄影帶倒轉）
  T.add(
    {
      set: { k: 'world', theme: 'wasteland', seed: 6101, tod: 'dawn', clear: 26 },
      grade: { ...RW, sunAz: 95, sunEl: 7, sunWarm: 0.7 },
      ov: ['c6vhs'],
      vhs: { tc: 2 * 60 + 3 },
      hook: 'c6snd',
      snd: SND(0, 0),
      actors: [{ id: 'rw', k: 'hero', p: [0, 2], yaw: 0, s: [{ t: 0, aim: [0, 3, -40], go: [0, 26] }] }],
      cam: {
        fov: 34,
        hand: 0.1,
        ease: 'lin',
        keys: [
          { t: 0, p: [4, 2.2, -14], l: { a: 'rw', at: 'head' } },
          { t: 3, p: [4, 2.6, -10], l: { a: 'rw', at: 'head' } },
        ],
      },
      ev: [{ t: 0, sfx: 'boostDown', vol: 0.6, rate: 0.25 }],
    },
    3,
  );
  T.add(
    {
      ...card('這顆星球有一段訊號。', 'PROTOCOL EXECUTED', 3.2),
      ov: ['c6vhs'],
      vhs: { k: 0.5 },
    },
    3.2,
  );
  return { title: '軌道站：交出', dur: T.at + 0.3, lb: 2.39, music: [], shots: T.shots };
}

// 墜落：駕駛艙看著軌道站拖著火光落進雲海 → 故障保險的紅字
export function c6Seal() {
  const T = seq();
  const ck = { alt: 118400, spd: 0, heat: 0, vac: true };
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.2 },
      ck: { ...ck, st: 'ATTITUDE CONTROL : SEVERED', stc: 'rgba(255,90,80,0.95)' },
      cam: {
        fov: 30,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: STATION_W, roll: 6 },
          { t: 2.8, p: [-10, 6, 0], l: STATION_W, roll: 7 },
        ],
      },
      ev: [
        { t: 0, call: (g) => g.cineStationLamps(0xff3020) },
        { t: 0.1, sfx: 'alarmBig', vol: 0.45, rate: 0.6 },
        sub(0.4, '你切斷了站的姿態控制。', null, 2.2),
      ],
    },
    2.8,
  );
  const fall = { t0: 2.8, d: 12 };
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: { ...VOID, bloom: 1.25 },
      ov: ['c6cockpit'],
      hook: ['c6snd', 'c6fall'],
      snd: { eng: 0, hum: 0.2 },
      fall,
      ck: { ...ck, st: 'STATION : DESCENDING', stc: 'rgba(255,170,90,0.9)' },
      cam: {
        fov: 30,
        hand: 0.02,
        follow: 30,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: { st: [0, 40, 0] }, roll: 7, fov: 32 },
          { t: 8.6, p: [-10, 6, 0], l: { st: [0, 40, 0] }, roll: 2, fov: 18 },
        ],
      },
      ev: [
        sub(0.6, '軌道站拖著長長的火光，往雲海落下去。', null, 3.4),
        sub(4.6, '……謝謝你。結束了。終於結束了。', 'sancta', 3.6),
      ],
    },
    8.6,
  );
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: { ...VOID, bloom: 1.25 },
      ov: ['c6cockpit', 'c6fail'],
      hook: ['c6snd', 'c6fall'],
      snd: { eng: 0, hum: 0.2 },
      fall,
      ck: { ...ck, st: 'FAILSAFE', stc: 'rgba(255,60,50,1)' },
      cam: {
        fov: 18,
        hand: 0.03,
        follow: 30,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: { st: [0, 40, 0] }, roll: 2 },
          { t: 2.8, p: [-10, 6, 0], l: { st: [0, 40, 0] }, roll: 1 },
        ],
      },
      ev: [
        { t: 0, sfx: 'glitch', vol: 0.7, rate: 0.5 },
        { t: 0.05, sfx: 'alarm', vol: 0.5, rate: 0.8 },
        sub(1.0, '盧比孔協定，強制執行。', 'station', 1.7),
      ],
    },
    2.8,
  );
  T.add(
    skyWatch(
      { k: 'world', theme: 'dunes', seed: 6115, tod: 'night', clear: 30 },
      { exposure: 0.7, tintHi: '#ff8050', tintHiK: 0.5, tintLo: '#101830', tintLoK: 0.5, bloom: 1.3 },
      [30, 70, -160],
      0xff8a40,
    ),
    3.6,
  );
  T.add(card('天空，安靜了。', 'SILENT SKY', 3), 3);
  return { title: '軌道站：墜落', dur: T.at + 0.3, lb: 2.39, music: [], shots: T.shots };
}

// 彼岸：頻道徽章一個個熄滅 → ECHO「我們走吧。」→ 推進器一排排亮起、星球在背後變小
export function c6Beyond() {
  const T = seq();
  const chans = [
    ['castron', 0, 1.5],
    ['aetheric', 0, 2.9],
    ['veerwell', 0, 4.3],
    ['sancta', 0, 6.1],
    ['echo', 0],
  ];
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.22 },
      ck: { alt: 118400, spd: 0, heat: 0, vac: true, st: 'THIRD DOOR // ALL CHANNELS', chans },
      cam: {
        fov: 34,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: [-200, -700, -1400], roll: -8 },
          { t: 6.6, p: [-10, 6, 0], l: [-120, -640, -1400], roll: -5 },
        ],
      },
      ev: [
        sub(0.3, '傭兵，等等——', 'castron', 1.15),
        sub(1.7, 'R-07，你沒有權限——', 'aetheric', 1.15),
        sub(3.1, '喂，你要把它開去哪——', 'veerwell', 1.15),
        sub(4.5, '……去吧。我會記下你的名字。', 'sancta', 1.55),
        ...[1.5, 2.9, 4.3, 6.1].map((t) => ({ t, sfx: 'uiBack', vol: 0.5, rate: 0.6 })),
        ...[1.5, 2.9, 4.3].map((t) => ({ t, sfx: 'glitch', vol: 0.25, rate: 0.7 })),
      ],
    },
    6.6,
  );
  T.add(
    {
      set: SPACE,
      lb: false,
      sun: [0.8, 0.15, -0.55],
      grade: VOID,
      ov: ['c6cockpit'],
      hook: 'c6snd',
      snd: { eng: 0, hum: 0.15 },
      ck: {
        alt: 118400,
        spd: 0,
        heat: 0,
        vac: true,
        chans: chans.map(([w, a, b]) => [w, a, b == null ? null : -1]),
      },
      cam: {
        fov: 26,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-10, 6, 0], l: { st: [0, 60, 0] }, roll: 3 },
          { t: 3, p: [-10, 6, 0], l: { st: [0, 60, 0] }, roll: 4 },
        ],
      },
      ev: [sub(0.5, '我們走吧。', 'echo', 2.3)],
    },
    3,
  );
  T.add(
    {
      set: SPACE,
      sun: [0.8, 0.15, -0.55],
      grade: { ...VOID, bloom: 1.3 },
      hook: ['c6snd', 'c6thrust'],
      snd: { eng: 0, hum: 0.1 },
      thr: { rows: 0.5, shrink: [2, 4.4, 0.15] },
      cam: {
        fov: 40,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: { st: [150, 520, 280] }, l: { st: [0, -40, 0] } },
          { t: 6.4, p: { st: [180, 600, 340] }, l: { st: [0, -40, 0] } },
        ],
      },
      ev: [
        sub(0.6, '軌道站的推進器，一個接一個亮起。', null, 2.4),
        sub(3.4, '星球在背後，慢慢變小。', null, 2.6),
        ...[0.4, 0.9, 1.4, 1.9, 2.4, 2.9].map((t) => ({ t, sfx: 'boom1', vol: 0.25, rate: 0.4 })),
      ],
    },
    6.4,
  );
  T.add(
    skyWatch(
      { k: 'world', theme: 'dunes', seed: 6115, tod: 'dawn', clear: 30 },
      { sunAz: 95, sunEl: 7, sunWarm: 0.7, tintHi: '#ffb070', tintHiK: 0.35, bloom: 1.2 },
      [30, 70, -160],
      0x9fe0ff,
      3,
    ),
    3.6,
  );
  T.add(card('這一次，照我們的節奏來。', 'BEYOND', 3), 3);
  return {
    title: '軌道站：彼岸',
    dur: T.at + 0.3,
    lb: 2.39,
    music: [{ at: 6.6, track: 'cine_c6', off: 60, vol: 0.8, fadeIn: 2.5, fadeOut: [T.at - 1.5, 1.5] }],
    shots: T.shots,
  };
}
