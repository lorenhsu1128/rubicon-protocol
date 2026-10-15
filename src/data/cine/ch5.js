// 第 5 章 洋上的抉擇：開場／章末（docs/cinematics-storyboard.md 第二版：電視牆與新聞轉播）。台詞＝CHAPTER_TEXT[5]
// 專用的效果在 game/cine-c5.js：電視牆（render／ov 'c5wall'）、全畫面的頻道（ov 'c5chan'）、直升機轉播（hook 'c5heli'、
// ov 'c5live'）、新聞頭條的章名（ov 'c5head'）、洋上都市的佈景（hook 'c5sea'：軌道電纜、探照燈、AEGIS 的護盾）、
// 章末的會議桌舞台（hook 'c5stage'）、倒數（ov 'c5count'）、ECHO 沒有雜訊的聲音（ov 'c5echo'、c5Echo）。
// 結構：開場＝電視牆 → 各台快切 → 電視牆（UNDERTOW 浮出、切到現場）→ 電視牆（AEGIS 的護盾吃掉每一格）→ 護盾裡 →
// 直升機轉播的突擊 → 所有頻道都在播 R-07 → 新聞頭條的章名。章末＝電視牆 → 全世界的螢幕同時變白 → 倒數 →
// 舞台劇式的會議桌（第四張椅子空著、所有人轉頭看鏡頭）→ 黑畫面裡 ECHO 乾淨的聲音。
import { AC_ROSTER, BOSS_DEFS } from '../enemies.js';
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { parseLine, timeline } from './kit.js';

// 洋上都市（藍色的夜：螢幕的藍白、探照燈）。原點＝中央的島；北邊的島是 AEGIS，中間有南北向的長橋（x≈22）
const SEA = {
  k: 'world',
  theme: 'xylem',
  seed: 6501,
  clear: 30,
  tod: 'night',
  light: { sky: 0x0c1830, fog: 0x13223a, sun: 0x9fb8e8, sunI: 0.75, hemi: 0x3a5a8a, hemiI: 0.6, far: 420 },
  far: 900,
};
// 佈景：軌道電纜（西北的海上）、探照燈 [x, z, 相位, 高度]、AEGIS 的護盾
const DRESS = {
  cable: [-50, -95],
  lights: [
    [-62, 22, 0, 6],
    [-30, -48, 1.5, 8],
    [44, -8, 3, 10],
    [-4, 34, 4.5, 6],
    [62, -72, 2, 12],
    [-80, -20, 5.2, 6],
  ],
  dome: { at: [54, -52] },
};
const STAGE = { k: 'black', stage: 5 };
const BLACK = { k: 'black' };

// 夜（洋上的每一鏡共用，電視牆的格子也用它決定曝光與霧）
const NIGHT = {
  exposure: 0.58,
  sunK: 0.5,
  hemiK: 0.5,
  sky: 'cloud',
  skyTop: '#03070f',
  cloud: 0.25,
  fogColor: '#0a1322',
  fogColorK: 0.8,
  tintLo: '#08182c',
  tintLoK: 0.5,
  dust: 0,
};
// 調色：螢幕的藍白（現場）、直升機轉播（粗粒子、低彩度）、舞台（暖色的頂光、很暗）
const GR = {
  field: {
    tintLo: '#10243a',
    tintLoK: 0.55,
    tintHi: '#d8ecff',
    tintHiK: 0.25,
    contrast: 1.16,
    bloom: 1.15,
    sat: 0.9,
    fogK: 1.6,
    dust: 0,
  },
  heli: {
    tintLo: '#0c1c2c',
    tintLoK: 0.4,
    sat: 0.78,
    contrast: 1.22,
    grain: 0.32,
    chroma: 0.32,
    vignette: 0.3,
    bloom: 1.1,
    mblur: false,
    fogK: 1.8,
    dust: 0,
  },
  stage: {
    sunK: 0.02,
    hemiK: 0.08,
    contrast: 1.2,
    sat: 0.85,
    tintHi: '#ffe0b0',
    tintHiK: 0.25,
    tintLo: '#101420',
    tintLoK: 0.5,
    vignette: 0.75,
    bloom: 0.9,
    ssao: 0,
  },
};

// AEGIS 的組裝與配色（data/enemies.js 的 BOSS_DEFS）
const AEGIS = BOSS_DEFS.find((b) => b.kind === 'flagship') || {};

// 演員：四家的部隊、都市的守衛、UNDERTOW、AEGIS、發生器、主角
const CAST = [
  { id: 'h', k: 'hero', p: [8, -4], yaw: 0 },
  // 卡斯特隆：西邊的島上插旗的 MT 縱隊＋海上的艦隊
  { id: 'm1', k: 'type', key: 'mt', p: [-82, -20], yaw: -90, pal: 'castron', s: [{ t: 0, go: [-56, -20] }] },
  {
    id: 'm2',
    k: 'type',
    key: 'mt',
    p: [-86, -13],
    yaw: -90,
    pal: 'castron',
    s: [{ t: 0.4, go: [-60, -13] }],
  },
  {
    id: 'm3',
    k: 'type',
    key: 'mt',
    p: [-86, -27],
    yaw: -90,
    pal: 'castron',
    s: [{ t: 0.8, go: [-60, -27] }],
  },
  { id: 'tk', k: 'type', key: 'tank', p: [-78, -6], yaw: -90, pal: 'castron', s: [{ t: 0, go: [-58, -6] }] },
  {
    id: 'w1',
    k: 'model',
    key: 'gunboat',
    pal: 'castron',
    scale: 3.4,
    yaw: -90,
    keys: [
      { t: 0, p: [-118, -2.8, 20], lin: true },
      { t: 80, p: [-38, -2.8, 20], lin: true },
    ],
  },
  {
    id: 'w2',
    k: 'model',
    key: 'gunboat',
    pal: 'castron',
    scale: 3,
    yaw: -90,
    keys: [
      { t: 0, p: [-132, -2.8, 33], lin: true },
      { t: 80, p: [-52, -2.8, 33], lin: true },
    ],
  },
  // 維爾威：運輸機與直升機
  {
    id: 'd1',
    k: 'type',
    key: 'dropship',
    pal: 'veerwell',
    p: [-70, -50],
    yaw: -110,
    s: [{ t: 0, go: [30, -4] }],
  },
  {
    id: 'd2',
    k: 'type',
    key: 'dropship',
    pal: 'veerwell',
    p: [-96, -36],
    yaw: -110,
    s: [{ t: 0.6, go: [10, 6] }],
  },
  { id: 'hv', k: 'type', key: 'heli', pal: 'veerwell', p: [-60, 30], yaw: -70, s: [{ t: 0, go: [16, 22] }] },
  // 艾瑟立克：無人機
  { id: 'dr1', k: 'type', key: 'drone', pal: 'aetheric', p: [46, 40], yaw: 135, s: [{ t: 0, go: [12, 4] }] },
  {
    id: 'dr2',
    k: 'type',
    key: 'drone',
    pal: 'aetheric',
    p: [56, 30],
    yaw: 135,
    s: [{ t: 0.5, go: [22, 0] }],
  },
  // 聖域：被夾在中間的盾牌 MT
  { id: 'sa1', k: 'type', key: 'mt_shield', team: 'ally', pal: 'ally', p: [-2, 14], yaw: 90 },
  { id: 'sa2', k: 'type', key: 'mt_shield', team: 'ally', pal: 'ally', p: [-2, 4], yaw: 90 },
  // 都市的守衛：衝撞無人機、艦載防空砲
  { id: 'r1', k: 'type', key: 'rammer', p: [6, -8], yaw: 90, s: [{ t: 0, go: [-10, -10] }] },
  { id: 'r2', k: 'type', key: 'rammer', p: [12, -2], yaw: 90, s: [{ t: 0.3, go: [-6, 0] }] },
  { id: 'fl', k: 'type', key: 'flak', p: [48, 2], yaw: 90 },
  // UNDERTOW：中央的島的南岸（從海裡浮上來之前藏著：鏡頭的 c5hide／surf）
  { id: 'ut', k: 'ace', key: 'undertow', p: [-16, 22], yaw: 0 },
  // AEGIS 護盾指揮艦（北島）與第一座發生器
  {
    id: 'ag',
    k: 'model',
    mech: true,
    asm: AEGIS.asm,
    pal: AEGIS.pal || 'command',
    scale: AEGIS.scale || 2.8,
    p: [54, 0, -52],
    yaw: 135,
  },
  { id: 'py', k: 'model', key: 'pylon', pal: 'command', p: [32, 0, -44], yaw: 0, scale: 1.2 },
];

// 電視牆的一格：ch＝頻道（委託方或 xylem）、cam＝機位、g＝沒有機位時的宣傳畫面、cap＝標題字幕、tick＝跑馬燈
const cell = (ch, cam, o = {}) => ({ ch, cam, ...o });
const gfx = (ch, g, o = {}) => ({ ch, g, ...o });
const cm = (p0, l0, fov, o = {}) => ({ p0, l0, fov, ...o });
const sub = (t, text, who, dur) => ({ t, sub: text, who: who || null, dur });

// 每一鏡共用：佈景的掛勾、洋上的場景
const sea = (s) => ({
  set: SEA,
  sea: DRESS,
  keep: true,
  ...s,
  hook: ['c5sea', ...[].concat(s.hook || [])],
  grade: { ...NIGHT, ...(s.grade || {}) },
});
// 跑馬燈的文字
const TK = {
  castron: '卡斯特隆重工　第三艦隊　抵達東岸海域　◆　股價 CSTN ▲ 3.2%　◆　「秩序就是生產」',
  aetheric: '艾瑟立克研究機構　軌道纜索出現週期性共振　◆　研究所呼籲各方保持距離',
  veerwell: '維爾威動態　軌道校準作業　今晚開始　◆　VWL 指數創新高',
  sancta: '聖域互助同盟　東岸避難所　收容已達上限　◆　請沿黃色路線移動',
  xylem: 'Xylem 市議會：本市不屬於任何勢力　◆　居民自衛隊　全區戒備',
};

export function ch5Intro() {
  const L = pickLines(CHAPTER_TEXT[5].intro);
  const T = timeline();
  // 1. 電視牆開機：每一格是一家的宣傳頻道，同一個晚上、同一座海上都市
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      actors: CAST,
      c5hide: ['ut'],
      cam: { keys: [{ t: 0, p: [0, 40, 40], l: [0, 0, 0] }] },
      wall: {
        boot: 0.3,
        push: [1, 1.05],
        title: 'EAST COAST // MULTI-FEED MONITOR // 9 CH',
        cells: [
          cell('castron', cm([-36, 5, 48], { a: 'w1' }, 26, { p1: [-42, 5, 46], hand: 1 }), {
            cap: '第三艦隊　東岸抵達',
            tick: TK.castron,
            tag: 'CSTN',
          }),
          cell('aetheric', cm([-14, 2, 6], [-50, 60, -95], 38, { l1: [-50, 150, -95] }), {
            cap: '軌道纜索　異常共振',
            tick: TK.aetheric,
            tag: 'AETH',
          }),
          cell('veerwell', cm([-30, 4, -24], { a: 'd1' }, 40, { hand: 1.4 }), {
            cap: '運輸機隊　進入空域',
            tick: TK.veerwell,
            tag: 'VWL',
          }),
          cell('xylem', cm([34, 26, 46], [-10, 6, -30], 56, { p1: [26, 24, 48] }), {
            cap: '探照燈　全區點亮',
            tick: TK.xylem,
            tag: 'LOCAL',
          }),
          cell('xylem', cm([-40, 70, 96], [10, 0, -24], 46, { p1: [-20, 62, 90], ease: 'lin' }), {
            cap: 'XYLEM　洋上都市',
          }),
          cell('sancta', cm({ a: 'sa1', o: [7, 3, 9] }, { a: 'sa1', at: 'head' }, 34), {
            cap: '難民　再度受困',
            tick: TK.sancta,
            tag: 'SNCT',
          }),
          gfx('veerwell', 'market'),
          gfx('castron', 'emblem'),
          gfx('sancta', 'evac'),
        ],
      },
      ev: [
        { t: 0, sfx: 'glitch', vol: 0.5, rate: 0.7 },
        { t: 0.3, sfx: 'ui2', vol: 0.4, rate: 0.6 },
        { t: 0.9, sfx: 'ui2', vol: 0.3, rate: 0.8 },
        sub(1.2, L[0], null, 4.4),
        sub(5.8, L[1], null, 2.2),
      ],
    }),
    8,
  );
  // 2～4. 各台的快切：一家一個全畫面（台標、標題字幕、跑馬燈）；台詞跨三鏡
  T.add(
    sea({
      ov: 'c5chan',
      lb: false,
      grade: { ...GR.field, mblur: false, tintHi: '#ffb070', tintHiK: 0.3 },
      c5hide: ['ut'],
      chan: {
        ch: 'castron',
        head: '卡斯特隆重工　東岸登陸',
        sub: '「在上面插旗。」',
        tick: TK.castron,
        tag: 'CSTN',
      },
      cam: {
        fov: 30,
        hand: 0.3,
        ease: 'lin',
        keys: [
          { t: 0, p: [-44, 3, -30], l: { a: 'm1', o: [0, 2, 0] } },
          { t: 2.2, p: [-46, 3, -27], l: { a: 'm2', o: [0, 2, 0] } },
        ],
      },
      ev: [{ t: 0, sfx: 'glitch', vol: 0.3, rate: 1.2 }, sub(0.15, L[2], null, 6.2)],
    }),
    2.2,
  );
  T.add(
    sea({
      ov: 'c5chan',
      lb: false,
      grade: { ...GR.field, mblur: false, tintHi: '#c8ffb0', tintHiK: 0.25 },
      c5hide: ['ut'],
      chan: {
        ch: 'veerwell',
        head: '維爾威動態　軌道校準開始',
        sub: '運輸機隊　12 架',
        tick: TK.veerwell,
        tag: 'VWL',
      },
      cam: {
        fov: 46,
        hand: 0.25,
        follow: 6,
        keys: [
          { t: 0, p: { a: 'd1', o: [-12, -4, 14] }, l: { a: 'd1' } },
          { t: 2, p: { a: 'd1', o: [-9, -4, 12] }, l: { a: 'd1' } },
        ],
      },
      ev: [{ t: 0, sfx: 'glitch', vol: 0.3, rate: 1.4 }],
    }),
    2,
  );
  T.add(
    sea({
      ov: 'c5chan',
      lb: false,
      grade: { ...GR.field, mblur: false, tintHi: '#fff0a0', tintHiK: 0.25 },
      c5hide: ['ut'],
      chan: {
        ch: 'sancta',
        head: '聖域互助同盟　避難所滿載',
        sub: '又一次被夾在中間',
        tick: TK.sancta,
        tag: 'SNCT',
      },
      cam: {
        fov: 32,
        hand: 0.2,
        ease: 'lin',
        keys: [
          { t: 0, p: [-20, 3.5, 24], l: [-2, 2.4, 9] },
          { t: 2.4, p: [-21, 3.6, 22], l: [-2, 2.6, 8] },
        ],
      },
      ev: [{ t: 0, sfx: 'glitch', vol: 0.3, rate: 1.1 }],
    }),
    2.4,
  );
  // 5. 電視牆：居民的防線；中央的格子拍到南岸的海面 → UNDERTOW 浮出 → 這一格放大成全畫面（切到現場）
  const UTCAM = cm([-15, 3.6, 9], { a: 'ut', at: 'head' }, 34, { p1: [-15.5, 3.4, 11] });
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      surf: { id: 'ut', t: 3.6, d: 1.8, depth: 7 },
      cam: { keys: [{ t: 0, p: [0, 40, 40], l: [0, 0, 0] }] },
      wall: {
        push: [1.03, 1.08],
        title: 'EAST COAST // MULTI-FEED MONITOR // 9 CH',
        zoom: { cell: 4, t: 5.9, d: 1.0 },
        hl: [{ cell: 4, t: 3.6, d: 2.2 }],
        cells: [
          cell('castron', cm([-50, 6, 4], { a: 'w1' }, 22, { hand: 1 }), {
            cap: '艦隊　市區外 2 km',
            tick: TK.castron,
          }),
          cell('xylem', cm({ a: 'r1', o: [0, 3, 9] }, { a: 'r1' }, 40, { hand: 1.2 }), {
            cap: '自衛隊　巡邏無人機',
          }),
          gfx('aetheric', 'lab'),
          cell('xylem', cm([30, 5, 16], { a: 'fl', o: [0, 2, 0] }, 34), {
            cap: '防空砲　展開',
            tick: TK.xylem,
          }),
          cell('xylem', UTCAM, { cap: '水道　未確認機影' }),
          cell('sancta', cm([-22, 3, 22], { a: 'sa1', o: [0, 2, 0] }, 30, { p1: [-24, 3, 20] }), {
            cap: '盾牌部隊　佈陣',
            tick: TK.sancta,
          }),
          cell('veerwell', cm([-30, 10, 40], { a: 'hv' }, 36, { hand: 1.5 }), { cap: '空拍　維爾威 3 號機' }),
          cell('aetheric', cm({ a: 'dr1', o: [2, 1, 6] }, { a: 'dr1' }, 44, { hand: 1.2 }), {
            cap: '無人機　觀測中',
            tick: TK.aetheric,
          }),
          gfx('xylem', 'bars'),
        ],
      },
      ev: [
        sub(0.3, L[3], null, 5.2),
        { t: 3.6, sfx: 'splash', vol: 0.9, rate: 0.7, at: { a: 'ut' } },
        {
          t: 3.7,
          fx: 'streaks',
          at: { a: 'ut', o: [0, -1, 0] },
          n: 50,
          color: 0xb0e0ff,
          speed: 14,
          grav: 18,
        },
        { t: 3.7, fx: 'dust', at: { a: 'ut', o: [0, -1.5, 0] }, r: 4, n: 18, color: 0xd0eaff },
        { t: 5.9, sfx: 'glitch', vol: 0.6, rate: 0.8 },
        { t: 5.9, sfx: 'boostUp', vol: 0.5, rate: 0.6 },
      ],
    }),
    7.2,
  );
  // 6. 切到現場：UNDERTOW（遮幅出現，電影的畫面）
  const UT = parseLine('UNDERTOW：「這座都市，不是誰的旗子。滾出去。」');
  T.add(
    sea({
      grade: { ...GR.field, contrast: 1.22 },
      cam: {
        fov: 34,
        hand: 0.12,
        dof: 0.8,
        snap: true,
        keys: [
          { t: 0, p: [-15.5, 3.4, 11], l: { a: 'ut', at: 'head' } },
          { t: 4.8, p: { a: 'ut', at: 'head', o: [2.5, -1.8, -6.5] }, l: { a: 'ut', at: 'head' } },
        ],
      },
      ev: [
        { t: 0, flash: '#ffffff', in: 0.01, hold: 0.04, out: 0.3 },
        { t: 0.2, a: 'ut', aim: [-40, 4, 10] },
        { t: 0.4, card: 'UNDERTOW', s: '洋上都市的守衛', style: 'name', dur: 3.8 },
        { t: 0.6, sfx: 'charge', vol: 0.6, rate: 0.6, at: { a: 'ut' } },
        sub(1.1, UT.text, 'undertow', 3.5),
      ],
    }),
    4.8,
  );
  // 7. 電視牆：右上的格子裡 AEGIS 升起護盾，護盾從那一格長大，經過的格子一個個斷訊
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      cam: { keys: [{ t: 0, p: [30, 30, 10], l: [54, 0, -52] }] },
      dome: { r: [0, 44], t: [0.6, 3.8] },
      wall: {
        push: [1.0, 1.06],
        title: 'EAST COAST // MULTI-FEED MONITOR // 9 CH',
        shield: { cell: 2, t: 2.6, d: 2.8 },
        cells: [
          cell('xylem', cm({ a: 'ut', o: [6, 2, 8] }, { a: 'ut', at: 'head' }, 36, { hand: 1.2 }), {
            cap: 'UNDERTOW　交戰中',
          }),
          cell('castron', cm([-60, 4, 12], { a: 'w1' }, 26, { hand: 1 }), {
            cap: '艦砲　射擊開始',
            tick: TK.castron,
          }),
          cell('aetheric', cm([14, 14, 2], { a: 'ag', o: [0, 6, 0] }, 50, { p1: [10, 16, 6] }), {
            cap: 'AEGIS　護盾展開',
            tick: TK.aetheric,
            tag: 'AETH',
          }),
          cell('veerwell', cm([-20, 6, -20], { a: 'd2' }, 40, { hand: 1.4 }), { cap: '運輸機　降下中' }),
          cell('xylem', cm([-30, 50, 70], [30, 0, -40], 48), { cap: '北港上空', tick: TK.xylem }),
          cell('castron', cm([-48, 4, -36], { a: 'm1', o: [0, 2, 0] }, 30), { cap: '登陸部隊　前進' }),
          cell('sancta', cm({ a: 'sa2', o: [5, 2.6, 7] }, { a: 'sa2', at: 'head' }, 34), { tick: TK.sancta }),
          cell('aetheric', cm({ a: 'dr2', o: [2, 1, 6] }, { a: 'dr2' }, 44, { hand: 1.2 }), {
            cap: '無人機　接近北港',
          }),
          gfx('veerwell', 'market'),
        ],
      },
      ev: [
        { t: 0.2, boom: [-20, 2, 14] },
        { t: 0.7, sfx: 'dome1', vol: 0.8, rate: 0.7 },
        { t: 1.0, card: 'AEGIS', s: '護盾指揮艦', style: 'name', dur: 3.4 },
        { t: 2.6, sfx: 'shield', vol: 0.8, rate: 0.5 },
        { t: 3.4, sfx: 'glitch', vol: 0.6, rate: 0.6 },
        { t: 4.4, sfx: 'glitch', vol: 0.7, rate: 0.5 },
        { t: 5.2, sfx: 'dome2', vol: 0.9, rate: 0.6 },
      ],
    }),
    5.6,
  );
  // 8. 護盾裡：遮幅、從中央的島仰望蓋住北港的護盾
  T.add(
    sea({
      ov: 'c5hex',
      grade: { ...GR.field, tintLo: '#0a2a48', tintLoK: 0.6, bloom: 1.3 },
      cam: {
        fov: 52,
        hand: 0.1,
        ease: 'lin',
        keys: [
          { t: 0, p: [10, 2.2, 16], l: [46, 26, -48] },
          { t: 4.2, p: [12, 2.6, 10], l: [50, 34, -50] },
        ],
      },
      ev: [
        { t: 0.4, sfx: 'ambHum', vol: 0.5, rate: 0.6 },
        { t: 1.4, sys: ['AEGIS SHIELD // RADIUS 0.42 km', '港口　封鎖'], dur: 2.6 },
      ],
    }),
    4.2,
  );
  // 9～11. 直升機轉播：長焦、晃動、LIVE。主角沿著長橋低空突擊推進 → 穿過護盾的邊緣（閃白）→ 第一座發生器
  T.add(
    sea({
      hook: 'c5heli',
      ov: 'c5live',
      lb: false,
      grade: GR.heli,
      heli: 1,
      live: {
        zoom: 24,
        ch: 'xylem',
        head: '獨立傭兵 R-07　接近護盾',
        sub: '現場直擊　XYLEM 北港',
        tick: '洋上都市　北港上空　◆　AEGIS 護盾　半徑 420 m　◆　R-07 單機突入',
        tag: 'LIVE',
      },
      cam: {
        fov: 13,
        hand: 0.3,
        follow: 5,
        keys: [
          { t: 0, p: [-70, 34, 26], l: { a: 'h', o: [0, 2, 0] } },
          { t: 5.2, p: [-74, 36, 14], l: { a: 'h', o: [0, 2, -4] } },
        ],
      },
      ev: [
        { t: 0, a: 'h', warp: [22, 18] },
        { t: 0.1, a: 'h', go: [22, -40], ab: true },
        { t: 0.2, sfx: 'boostUp', vol: 0.7, rate: 0.7, at: { a: 'h' } },
        { t: 0, loop: 0.25, loopKey: 'engineLoop', rate: 1.6 },
        sub(0.5, L[4], null, 4.4),
      ],
    }),
    5.2,
  );
  T.add(
    sea({
      hook: 'c5heli',
      ov: 'c5live',
      lb: false,
      grade: GR.heli,
      heli: 1.4,
      domeHit: 1.0,
      live: { zoom: 40, ch: 'xylem', tick: '洋上都市　北港上空　◆　R-07　突入護盾內部', tag: 'LIVE' },
      cam: {
        fov: 9,
        hand: 0.3,
        follow: 6,
        keys: [
          { t: 0, p: [-50, 30, -6], l: { a: 'h', o: [0, 2, -3] } },
          { t: 2.8, p: [-52, 31, -14], l: { a: 'h', o: [0, 2, -6] } },
        ],
      },
      ev: [
        { t: 0, a: 'h', warp: [22, -10] },
        { t: 0.05, a: 'h', go: [26, -42], ab: true },
        { t: 1.0, flash: '#e8f6ff', in: 0.02, hold: 0.08, out: 0.4 },
        { t: 1.0, sfx: 'shield', vol: 1, rate: 0.8 },
        { t: 1.0, fx: 'ring', at: { a: 'h' }, r: 8, color: 0x8fe0ff },
        { t: 1.05, shake: 0.5 },
      ],
    }),
    2.8,
  );
  T.add(
    sea({
      hook: 'c5heli',
      ov: 'c5live',
      lb: false,
      grade: GR.heli,
      heli: 1.2,
      c5gone: { py: 1.55 },
      live: {
        zoom: 32,
        ch: 'xylem',
        glitch: 1.5,
        head: '北港　護盾發生器　爆炸',
        sub: '第一座　破壞',
        tick: 'AEGIS 護盾　出力低下　◆　R-07　破壞第一座發生器',
        tag: 'LIVE',
      },
      cam: {
        fov: 14,
        hand: 0.3,
        follow: 5,
        keys: [
          { t: 0, p: [-40, 26, -14], l: { a: 'py', o: [-4, 3, 4] } },
          { t: 4.2, p: [-42, 27, -20], l: { a: 'py', o: [-2, 3, 2] } },
        ],
      },
      ev: [
        { t: 0, a: 'h', warp: [24, -32] },
        { t: 0.05, a: 'h', stop: true, aim: 'py', ab: false },
        { t: 0.3, a: 'h', fire: 'all', dur: 1.2, at: 'py' },
        { t: 1.5, boom: { a: 'py', o: [0, 3, 0] }, big: true, kill: true, r: 5 },
        { t: 1.5, fx: 'pillar', at: { a: 'py' }, r: 5, color: 0x9fe8ff },
        { t: 1.6, shake: 0.9 },
        { t: 1.6, sfx: 'explodeBig', vol: 1, rate: 0.8 },
        { t: 2.2, fx: 'smoke', at: { a: 'py', o: [0, 2, 0] }, r: 4, life: 5, rise: 6 },
        { t: 3.6, loop: 0 },
      ],
    }),
    4.2,
  );
  // 12. 電視牆：所有頻道都在播 R-07
  const heroCam = (o, fov, hand) => cm({ a: 'h', o }, { a: 'h', o: [0, 2.4, 0] }, fov, { hand });
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      dome: { r: [44, 44], t: [0, 1] },
      c5gone: { py: 0 },
      cam: { keys: [{ t: 0, p: [0, 30, 30], l: [24, 0, -32] }] },
      wall: {
        push: [1.12, 1.0],
        title: 'ALL CHANNELS // R-07',
        hl: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ cell: i, t: 0.15 * i, d: 1 })),
        cells: [
          cell('castron', heroCam([6, 2, 9], 34, 1), {
            cap: 'R-07',
            tick: '卡斯特隆：與 R-07 的合約　持續中',
          }),
          gfx('veerwell', 'r07', { cap: '人氣指數　第 1 位' }),
          cell('aetheric', heroCam([-7, 3, 7], 30, 1), { cap: 'R-07', tick: TK.aetheric }),
          gfx('castron', 'r07', { cap: '合約完成率　100%' }),
          cell('xylem', cm([-40, 26, -16], { a: 'h', o: [0, 2, 0] }, 12, { hand: 2 }), {
            cap: 'R-07　現場直擊',
          }),
          gfx('aetheric', 'r07', { cap: '觀測對象　KEY-07？' }),
          cell('veerwell', heroCam([0, 8, 14], 40, 1.4), { cap: 'R-07', tick: TK.veerwell }),
          cell('sancta', heroCam([9, 1.4, -5], 34, 1), { cap: 'R-07' }),
          cell('xylem', heroCam([2, 1.2, -9], 44, 1), { cap: 'R-07', tick: TK.xylem }),
        ],
      },
      ev: [{ t: 0, sfx: 'glitch', vol: 0.5, rate: 0.9 }, sub(0.7, L[5], null, 4.2)],
    }),
    5.2,
  );
  // 13. 新聞頭條＝章名：直升機的遠景（冒煙的北港、護盾），跑馬燈
  T.add(
    sea({
      hook: 'c5heli',
      ov: ['c5live', 'c5head'],
      lb: false,
      grade: GR.heli,
      heli: 0.8,
      fo: 1.4,
      c5gone: { py: 0 },
      live: { zoom: 8 },
      head: {
        t: 0.5,
        title: '第五章　洋上的抉擇',
        s: 'CHAPTER V',
        tick: '第五章　洋上的抉擇　◆　東岸 Xylem　四大勢力集結　◆　AEGIS 護盾展開　◆　R-07　第一座發生器破壞',
      },
      cam: {
        fov: 30,
        hand: 0.2,
        ease: 'lin',
        keys: [
          { t: 0, p: [-90, 44, 40], l: [30, 6, -40] },
          { t: 6.2, p: [-96, 46, 30], l: [30, 8, -44] },
        ],
      },
      ev: [
        { t: 0.4, sfx: 'boom1', vol: 0.8, rate: 0.6 },
        { t: 0.5, fx: 'smoke', at: [32, 4, -44], r: 6, life: 6, rise: 8 },
        { t: 2, fx: 'smoke', at: [32, 4, -44], r: 6, life: 6, rise: 8 },
      ],
    }),
    6.2,
  );
  return T.def({
    title: '第五章　開場',
    music: [{ at: 0, track: 'cine_c5', vol: 0.9, fadeIn: 0.4, fadeOut: [T.at - 2.5, 2.5] }],
  });
}

// 章末：會議桌的代表（卡斯特隆、艾瑟立克、維爾威），不帶武器。第四張椅子（聖域）空著
const unarmed = (asm) => ({ ...asm, rarm: 'w_none', larm: 'w_none', rback: 'bw_none', lback: 'bw_none' });
const REPS = [
  {
    id: 'repC',
    k: 'model',
    mech: true,
    asm: unarmed(AC_ROSTER.bastion.asm),
    pal: 'castron',
    p: [-2.9, -1.3, -12.5],
    yaw: -90,
  },
  {
    id: 'repA',
    k: 'model',
    mech: true,
    asm: unarmed(AC_ROSTER.longshot.asm),
    pal: 'aetheric',
    p: [2.9, -1.3, -12.5],
    yaw: 90,
  },
  {
    id: 'repV',
    k: 'model',
    mech: true,
    asm: unarmed(AC_ROSTER.rain.asm),
    pal: 'veerwell',
    p: [-2.9, -1.3, -7.5],
    yaw: -90,
  },
];
// 舞台的固定機位（對稱：桌子的正前方）
const STAGE_CAM = { fov: 32, hand: 0, keys: [{ t: 0, p: [0, 5.2, 6.5], l: [0, 1.6, -10] }] };

export function ch5Outro() {
  const L = pickLines(CHAPTER_TEXT[5].outro);
  const T = timeline();
  const T0 = 10.6; // 倒數 72:00:00 開始跳的時間
  // 1. 電視牆：戰後的夜，各台還在播 → 一格格出現雜訊 → 全世界的螢幕同時變白
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      fi: 0.8,
      dome: { r: [0, 0], t: [0, 1] },
      actors: [
        { id: 'h', k: 'hero', p: [16, 12], yaw: 200, s: [{ t: 0, crouch: true }] },
        {
          id: 'w1',
          k: 'model',
          key: 'gunboat',
          pal: 'castron',
          scale: 3.4,
          yaw: -90,
          keys: [
            { t: 0, p: [-60, -2.8, 22], lin: true },
            { t: 40, p: [-48, -2.8, 22], lin: true },
          ],
        },
        { id: 'sa1', k: 'type', key: 'mt_shield', team: 'ally', pal: 'ally', p: [-12, 14], yaw: 90 },
        {
          id: 'ag',
          k: 'model',
          mech: true,
          asm: AEGIS.asm,
          pal: AEGIS.pal || 'command',
          scale: AEGIS.scale || 2.8,
          p: [54, 0, -52],
          yaw: 135,
        },
      ],
      cam: { keys: [{ t: 0, p: [0, 40, 40], l: [0, 0, 0] }] },
      wall: {
        push: [1.0, 1.04],
        title: 'EAST COAST // MULTI-FEED MONITOR // AFTER ACTION',
        white: 5.0,
        cells: [
          cell('castron', cm([-30, 5, 40], { a: 'w1' }, 26, { hand: 1 }), {
            cap: '艦隊　待機',
            tick: TK.castron,
          }),
          cell('aetheric', cm([-14, 2, 6], [-50, 120, -95], 40), {
            cap: '軌道纜索　共振增強',
            tick: TK.aetheric,
          }),
          cell('xylem', cm([10, 30, 20], [50, 4, -50], 40), { cap: '北港　戰鬥結束', lost: 4.3 }),
          gfx('veerwell', 'market', { lost: 4.6 }),
          cell('xylem', cm({ a: 'h', o: [6, 2.4, 9] }, { a: 'h', o: [0, 2, 0] }, 34), {
            cap: 'R-07',
            tick: TK.xylem,
          }),
          cell('sancta', cm({ a: 'sa1', o: [5, 2.6, 7] }, { a: 'sa1', at: 'head' }, 34), {
            cap: '負傷者　搬送中',
            lost: 4.1,
          }),
          gfx('castron', 'emblem', { lost: 4.7 }),
          cell('veerwell', cm([-40, 40, 70], [10, 0, -10], 44), { cap: '空拍　夜間的北港', lost: 4.4 }),
          gfx('sancta', 'evac', { lost: 4.5 }),
        ],
      },
      ev: [
        { t: 0.3, fx: 'smoke', at: [32, 4, -44], r: 6, life: 7, rise: 8 },
        sub(0.8, L[0], null, 3.6),
        { t: 4.1, sfx: 'glitch', vol: 0.6, rate: 0.6 },
        { t: 5.0, sfx: 'alarmBig', vol: 0.5, rate: 0.5 },
      ],
    }),
    5.6,
  );
  // 2. 軌道站的廣播：每一格都是白底的「KEY-07」，房間被照亮；最後整個畫面白掉
  T.add(
    sea({
      render: 'c5wall',
      ov: 'c5wall',
      lb: false,
      cam: { keys: [{ t: 0, p: [0, 40, 40], l: [0, 0, 0] }] },
      wall: {
        push: [1.04, 1.22],
        title: 'ALL CHANNELS // ORBITAL BROADCAST',
        white: 0,
        cells: Array.from({ length: 9 }, () => gfx('station', 'bars')),
      },
      ev: [
        { t: 0.1, sfx: 'glitch', vol: 0.4, rate: 0.4 },
        sub(0.5, L[1].replace(/^「|」$/g, ''), 'station', 3.4),
        { t: 3.9, flash: '#ffffff', in: 0.25, hold: 0.5, out: 0.5 },
      ],
    }),
    4.6,
  );
  // 3. 倒數：黑底的大字，從 72:00:00 開始跳 → 縮到右上角（之後一直在）
  T.add(
    {
      set: BLACK,
      ov: 'c5count',
      lb: false,
      count: { t0: T0, mv: [4.4, 1.0] },
      ev: [
        sub(1.0, L[2], null, 3.6),
        ...[0.4, 1.4, 2.4, 3.4, 4.4].map((t) => ({ t, sfx: 'ui2', vol: 0.35, rate: 0.5 })),
      ],
    },
    5.8,
  );
  // 4～6. 舞台劇式的固定鏡頭：四張椅子的會議桌，第四張空著；所有人轉頭看鏡頭
  T.add(
    {
      set: STAGE,
      hook: 'c5stage',
      ov: 'c5count',
      grade: GR.stage,
      fi: 1.2,
      count: { t0: T0, mode: 'corner' },
      actors: REPS,
      keep: true,
      stage: {},
      cam: STAGE_CAM,
      ev: [{ t: 0.2, sfx: 'thud1', vol: 0.5, rate: 0.5 }, sub(0.8, L[3], null, 5.2)],
    },
    6.4,
  );
  T.add(
    {
      set: STAGE,
      hook: 'c5stage',
      ov: 'c5count',
      grade: GR.stage,
      count: { t0: T0, mode: 'corner' },
      keep: true,
      stage: { empty: 4.4 },
      cam: STAGE_CAM,
      ev: [sub(0.3, L[4], null, 6.2), { t: 4.4, sfx: 'thud2', vol: 0.6, rate: 0.5 }],
    },
    6.8,
  );
  // 空著的椅子（同樣是對稱的正面，近一點）
  T.add(
    {
      set: STAGE,
      hook: 'c5stage',
      ov: 'c5count',
      grade: GR.stage,
      count: { t0: T0, mode: 'corner' },
      keep: true,
      stage: { empty: -1 },
      cam: { fov: 30, hand: 0, keys: [{ t: 0, p: [-0.4, 3.2, -7.5], l: [3.1, 1.5, -7.5] }] },
    },
    2.6,
  );
  T.add(
    {
      set: STAGE,
      hook: 'c5stage',
      ov: 'c5count',
      grade: GR.stage,
      count: { t0: T0, mode: 'corner' },
      keep: true,
      stage: { empty: -1, turn: [2.4, 1.1], dim: [5.4, 0.9] },
      cam: STAGE_CAM,
      ev: [
        sub(0.3, L[5], null, 5.2),
        { t: 2.4, sfx: 'heavy', vol: 0.35, rate: 0.5 },
        { t: 2.5, sfx: 'stepConc1', vol: 0.4, rate: 0.6 },
      ],
    },
    6.4,
  );
  // 7. 黑畫面：ECHO 的聲音，第一次沒有無線電雜訊（一條乾淨的聲紋）
  const E = parseLine(L[6]);
  T.add(
    {
      set: BLACK,
      ov: ['c5echo', 'c5count'],
      lb: false,
      count: { t0: T0, mode: 'corner', a: 0.6 },
      ev: [{ t: 0.9, call: (g) => g.c5Echo(E.text, 5) }],
    },
    6.6,
  );
  // 8. 旁白
  T.add(
    {
      set: BLACK,
      ov: 'c5count',
      lb: false,
      fo: 1,
      count: { t0: T0, mode: 'corner', a: 0.6, fade: [3.8, 1.2] },
      ev: [sub(0.4, L[7], null, 4.2)],
    },
    5.2,
  );
  return T.def({
    title: '第五章　章末',
    music: [{ at: 0, track: 'cine_c5', off: 0, vol: 0.85, fadeIn: 1, fadeOut: [26, 6] }],
  });
}
