// 第 2 章 工業帶的契約：開場／章末（依抉擇 1）與抉擇 1 的演出（docs/cinematics-storyboard.md 第二版）。
// 手法＝分割畫面：左半邊卡斯特隆（橘）、右半邊艾瑟立克（藍），同一時間各做各的事。
// 鏡頭一律固定機位、對稱構圖、沿軌道等速平移，沒有手持晃動；剪接對準機械聲（閘門、起重機）。
// 效果在 game/cine-c2.js（render 'c2split'／'c2grid'、hook 'c2props'／'c2slug'、ov 'c2*'）。台詞＝CHAPTER_TEXT[2]
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { G, W, black, parseLine, timeline } from './kit.js';

// 多重水壩（種子 6211）：原點在壩的下游 20 m，壩體正面在 z＝−19、壩頂 y≈13.6；
// 閘門 x＝−40.4（洩洪河道，寬 16）、4.2（寬 24）、58.3
const DAM = W('dam', { seed: 6211, anchor: [0, -20], clear: 10 });
const IND = W('industrial', { seed: 6201 });
const INDN = W('industrial', { tod: 'night', seed: 6204 });
const INST = W('institute', { seed: 6302 });
const FLN = W('flooded', { tod: 'night', seed: 6210 });
const SNOW = W('snow', { seed: 6301, variant: 'icefield' });
const SNOWN = W('snow', { seed: 6303, tod: 'night', variant: 'icefield' });

// 調色：左右各一半（只改顏色，太陽的方向兩邊相同）
const GC = { temp: 0.32, tintHi: '#ffa050', tintHiK: 0.42, tintLo: '#3a2210', tintLoK: 0.35, contrast: 1.12 };
const GA = {
  temp: -0.42,
  tintHi: '#a8e0ff',
  tintHiK: 0.25,
  tintLo: '#0f3a66',
  tintLoK: 0.5,
  sat: 0.8,
  contrast: 1.14,
};
const BASE = { sunAz: 235, sunEl: 20, fogK: 1.5, dust: 0.25, vignette: 0.5, grain: 0.12, chroma: 0.08 };
// 監視器：低彩度、高對比
const GCCTV = {
  sat: 0.18,
  contrast: 1.28,
  grain: 0.45,
  vignette: 0.7,
  tintLo: '#16302a',
  tintLoK: 0.5,
  chroma: 0.3,
};

const sub = (t, text, who, dur) => ({ t, sub: text, who: who || null, dur });
// CHAPTER_TEXT 的一句（「名字：「…」」拆成說話者＋台詞）
const subL = (t, line, dur) => {
  const L = parseLine(line);
  return sub(t, L.text, L.who, dur);
};
// 每一鏡都掛上道具的掛勾：換鏡頭（包括劇場的跳轉）時一定會清掉上一鏡的道具
function done(T, o) {
  for (const sh of T.shots) {
    const h = [].concat(sh.hook || []);
    if (!h.includes('c2props')) sh.hook = ['c2props', ...h];
  }
  return T.def(o);
}
// 固定機位（可以等速平移）：p0→p1、l0→l1
const fixed = (p0, l0, d, o = {}) => ({
  fov: o.fov || 40,
  ease: 'lin',
  hand: 0,
  free: o.free,
  keys: [
    { t: 0, p: p0, l: l0 },
    { t: d, p: o.p1 || p0, l: o.l1 || l0 },
  ],
});

// ---------- 演員 ----------
const castronYard = [
  { id: 'cr', k: 'type', key: 'crane', p: [-25, -13], yaw: 160, pal: 'castron' },
  {
    id: 'fk1',
    k: 'type',
    key: 'forklift',
    p: [-40, 0],
    yaw: 90,
    s: [{ t: 0, go: [-16, 0] }],
    pal: 'castron',
  },
  { id: 'km1', k: 'type', key: 'mt', p: [-35, 6], yaw: 90, s: [{ t: 0.6, go: [-14, 6] }], pal: 'castron' },
];
const aethericCrew = [
  { id: 'am1', k: 'type', key: 'mt', p: [17, -9], yaw: 180, pal: 'aetheric' },
  { id: 'am2', k: 'type', key: 'mt', p: [41, 2], yaw: 270, pal: 'aetheric' },
  { id: 'ad1', k: 'type', key: 'drone', p: [30, -4], yaw: 200 },
];
// 往西走的難民：真的人群（第三版分鏡），聖域的盾牌 MT 與修理無人機走在旁邊護著。+X → −X
const PEOPLE = ['hooded', 'hooded', 'farmer', 'man', 'woman', 'womanc', 'casual'];
const refugees = (dx = 0) => [
  {
    id: 'r1',
    k: 'type',
    key: 'mt_shield',
    p: [12 + dx, -5],
    yaw: 270,
    s: [{ t: 0, go: [6 + dx, -5] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'r4',
    k: 'type',
    key: 'repair',
    p: [30 + dx, 5],
    yaw: 270,
    s: [{ t: 0, go: [24 + dx, 5] }],
    team: 'ally',
    pal: 'ally',
  },
  {
    id: 'rp',
    k: 'people',
    who: PEOPLE,
    n: 22,
    p: [20 + dx, 0],
    box: [18, 6],
    go: [-12, 0],
    stagger: 1.5,
    speed: 0.9,
    yaw: 270,
    seed: 7,
  },
];
const aethericConvoy = [
  { id: 'e1', k: 'type', key: 'mt', p: [8, -5], yaw: 270, s: [{ t: 0, go: [-30, -5] }], pal: 'aetheric' },
  { id: 'e2', k: 'type', key: 'drone', p: [14, -1], yaw: 270, s: [{ t: 0, go: [-26, -1] }] },
  { id: 'e3', k: 'type', key: 'tank', p: [20, -6], yaw: 270, s: [{ t: 0, go: [-20, -6] }], pal: 'aetheric' },
];

// ---------- 道具 ----------
// 洩洪閘門的門扇：開著（抬高 8 m）→ t 秒時關上
const gateLeaf = (t0, t1) => ({
  id: 'gate',
  k: 'box',
  p: [-40.4, -2.6, -18.4],
  size: [15.6, 9.6, 0.8],
  color: 0x4a5a66,
  rib: 0x22282e,
  ribs: 6,
  stripe: true,
  keys: [
    { t: 0, o: [0, 8, 0] },
    { t: t0, o: [0, 8, 0] },
    { t: t1, o: [0, 0, 0] },
  ],
});

// ================= 開場 =================
export function ch2Intro() {
  const L = pickLines(CHAPTER_TEXT[2].intro);
  const T = timeline();
  // 0. 黑畫面：中線由上往下畫出來，左右兩家的名字（對準機械聲）
  T.add(
    {
      set: { k: 'black' },
      ov: 'c2open',
      open: { a: 1.0, b: 1.5, cap: 'CENTRAL INDUSTRIAL BELT　中部工業帶', capT: 2.0 },
      ev: [
        { t: 0.2, sfx: 'heavy', vol: 0.6, rate: 0.55 },
        { t: 1.0, sfx: 'door', vol: 0.6, rate: 0.6 },
        { t: 1.5, sfx: 'door', vol: 0.6, rate: 0.75 },
        { t: 2.5, sfx: 'thud1', vol: 0.7, rate: 0.5 },
      ],
    },
    3,
  );
  // 1. 分割畫面：左＝卡斯特隆（起重機吊起貨櫃）、右＝艾瑟立克（天線核心裝上運輸車、冷卻槽灌水）
  T.add(
    {
      set: DAM,
      grade: BASE,
      gradeL: GC,
      gradeR: GA,
      render: 'c2split',
      hook: 'c2props',
      ov: 'c2split',
      fi: 0.3,
      actors: [
        ...castronYard,
        ...aethericCrew,
        {
          id: 'wk',
          k: 'people',
          who: ['worker', 'worker', 'farmer'],
          n: 7,
          p: [-31.5, -1],
          box: [6, 2],
          go: [7, 0],
          stagger: 2,
          yaw: 90,
          seed: 11,
        },
        {
          id: 'hst',
          k: 'human',
          who: 'biz',
          p: [-29, 3.5],
          anim: 'Idle_Neutral',
          dark: 0.85,
          s: [{ t: 0, face: [-30, -8] }],
        },
        {
          id: 'lab',
          k: 'people',
          who: ['suitw', 'mansuit'],
          n: 4,
          p: [33.5, -2.5],
          box: [4, 2],
          anim: ['Interact', 'Idle'],
          s: [{ t: 0, face: [38, -12] }],
          tint: { Black: 0xd8dce0, Shirt: 0xd8dce0 },
          seed: 13,
        },
        {
          id: 'sak',
          k: 'human',
          who: 'suitw',
          p: [31, 3.5],
          anim: 'Idle_Neutral',
          dark: 0.7,
          tint: { Black: 0xd8dce0 },
          s: [{ t: 0, face: [30, -1] }],
        },
      ],
      cam: fixed([-35, 7, 12], [-31, 4, -10], 9.5, { p1: [-31, 7, 12], l1: [-27, 4, -10], fov: 50 }),
      camR: fixed([35, 7, 12], [31, 4, -10], 9.5, { p1: [31, 7, 12], l1: [27, 4, -10], fov: 50 }),
      props: [
        {
          id: 'box1',
          k: 'box',
          p: { g: [-32, -7] },
          size: [6.1, 2.6, 2.44],
          color: 0xc0702c,
          ribs: 5,
          ribH: 0.07,
          keys: [
            { t: 0, o: [0, 0, 0] },
            { t: 0.8, o: [0, 0, 0] },
            { t: 4.5, o: [0, 9, 0] },
            { t: 6.5, o: [5, 9, 0] },
            { t: 9.2, o: [5, 2.6, 0] },
          ],
        },
        {
          id: 'box0',
          k: 'box',
          p: { g: [-27, -4] },
          size: [6.1, 2.6, 2.44],
          color: 0x8a4a22,
          ribs: 5,
          ribH: 0.07,
        },
        { id: 'truck', k: 'truck', p: { g: [22, -3] }, yaw: 90, cars: 2 },
        {
          id: 'core',
          k: 'core',
          p: { g: [30, -1] },
          keys: [
            { t: 0, o: [0, 0, 0] },
            { t: 1.5, o: [0, 0, 0] },
            { t: 3.5, o: [0, 4, 0] },
            { t: 5.5, o: [-8, 4, -2] },
            { t: 7, o: [-8, 1.6, -2] },
          ],
        },
        {
          id: 'tank',
          k: 'tank',
          p: { g: [38, -12] },
          r: 4,
          h: 9,
          fill: [
            { t: 0, v: 0.1 },
            { t: 9.5, v: 0.55 },
          ],
        },
      ],
      ev: [
        { t: 0.8, sfx: 'heavy', vol: 0.5, rate: 0.7 },
        { t: 1.5, sfx: 'door', vol: 0.5, rate: 0.5 },
        { t: 3.5, sfx: 'clatter1', vol: 0.6, rate: 0.6 },
        { t: 5.5, sfx: 'door', vol: 0.5, rate: 0.6 },
        { t: 7.0, sfx: 'plate1', vol: 0.7, rate: 0.6 },
        { t: 9.2, sfx: 'heavy', vol: 0.9, rate: 0.6 },
        { t: 9.2, shake: 0.5 },
        subL(0.3, L[0], 4.4),
        subL(4.9, L[1], 4.5),
      ],
    },
    9.5,
  );
  // 2. 分割畫面的近景：左＝洩洪閘門關上；右＝冷卻槽灌水。兩家的通訊互相蓋過
  T.add(
    {
      set: DAM,
      grade: BASE,
      gradeL: GC,
      gradeR: GA,
      render: 'c2split',
      hook: 'c2props',
      ov: 'c2split',
      keep: true,
      cam: fixed([-40.4, 3.4, 12], [-40.4, 5, -19], 7.5, { p1: [-40.4, 3.4, 9], fov: 44 }),
      camR: fixed([38, 3.4, 14], [38, 5, -12], 7.5, { p1: [38, 3.4, 11], fov: 44 }),
      props: [
        gateLeaf(1.2, 4.2),
        {
          id: 'tank',
          k: 'tank',
          p: { g: [38, -12] },
          r: 4,
          h: 9,
          fill: [
            { t: 0, v: 0.55 },
            { t: 7.5, v: 0.95 },
          ],
        },
      ],
      side: [
        { t: 0.4, s: 'L', who: 'castron', text: '主壩在最上游，沿著水壩一座一座往上打。', d: 4.4 },
        { t: 1.3, s: 'R', who: 'aetheric', text: 'R-07，請照預定路線推進——我會記錄你的每一個動作。', d: 4.6 },
      ],
      ev: [
        { t: 1.2, sfx: 'door', vol: 0.8, rate: 0.45 },
        { t: 4.2, sfx: 'heavy', vol: 1, rate: 0.5 },
        { t: 4.2, shake: 0.9 },
        { t: 4.2, fx: 'dust', at: [-40.4, 0, -17], r: 7, n: 18, color: 0xb0b4b8 },
        { t: 2.0, fx: 'smoke', at: [38, 9.5, -12], r: 3, life: 4, rise: 5, color: 0xdde4ea },
        { t: 4.0, fx: 'smoke', at: [38, 9.5, -12], r: 3, life: 4, rise: 5, color: 0xdde4ea },
        { t: 6.0, fx: 'smoke', at: [38, 9.5, -12], r: 3, life: 4, rise: 5, color: 0xdde4ea },
        subL(4.6, L[2], 2.8),
      ],
    },
    7.5,
  );
  // 3. HALBERD：壩頂的電磁砲台充能（正面、低角度、對稱）
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.cold, contrast: 1.18, bloom: 1.1 },
      hook: 'c2props',
      actors: [{ id: 'hb', k: 'model', key: 'railgun', p: [33, 13.6, -24], yaw: 180, scale: 1.3 }],
      cam: fixed([33, 3, 24], [33, 17, -24], 3.6, { p1: [33, 3, 20], fov: 30 }),
      ev: [
        { t: 0.1, sfx: 'charge', vol: 1, rate: 0.45 },
        { t: 0.4, card: 'HALBERD', s: '超長程電磁砲台', style: 'name', dur: 3 },
        { t: 0.6, fx: 'flash', at: [33, 19, -17], r: 0.8, color: 0x8fe0ff },
        { t: 1.6, fx: 'flash', at: [33, 19, -17], r: 1.2, color: 0x8fe0ff },
        { t: 2.6, fx: 'flash', at: [33, 19, -17], r: 1.8, color: 0xbff0ff },
        { t: 3.2, sfx: 'laserCharged', vol: 0.9, rate: 0.6 },
        subL(0.3, L[3], 6.6),
      ],
    },
    3.6,
  );
  // 4. 彈道視角：鏡頭跟著電磁砲彈飛過整個河谷，打中山壁 → 閃白
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.cold, contrast: 1.2, chroma: 0.4, bloom: 1.2 },
      hook: ['c2props', 'c2slug'],
      keep: true,
      props: [
        {
          id: 'slug',
          k: 'slug',
          p: [33, 19, -16],
          aim: [-52, 8, 140],
          speed: 85,
          t0: 0.15,
        },
      ],
      cam: fixed([33, 20, -8], [33, 19, 20], 3.4, { fov: 60, free: true }),
      ev: [
        { t: 0.15, sfx: 'laserBig', vol: 1, rate: 0.55 },
        { t: 0.15, flash: '#bfe8ff', in: 0.02, hold: 0.04, out: 0.2 },
        { t: 0.2, sfx: 'thrBurst', vol: 0.7, rate: 0.5 },
      ],
    },
    3.4,
  );
  // 5. SLUICE：壩頂的監視器（固定的俯角，最後他抬頭看鏡頭）
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.cold, ...GCCTV, sat: 0.3 },
      ov: 'c2cctv',
      feed: { label: 'CAM 03　主壩 壩頂' },
      lb: false,
      actors: [
        {
          id: 'sl',
          k: 'ace',
          key: 'sluice',
          p: [-20, 13.8, -24],
          yaw: 0,
          s: [
            { t: 0, aim: [-20, 14, 30] },
            { t: 3.4, aim: [-11.5, 21, -15] },
          ],
        },
        // 壩頂的工人：SLUICE 守的是這些人
        {
          id: 'dw',
          k: 'people',
          who: ['worker', 'soldier', 'farmer'],
          n: 4,
          p: [-27, 13.8, -23],
          box: [4, 1.2],
          go: [9, 0],
          stagger: 1.5,
          yaw: 90,
          seed: 17,
        },
      ],
      cam: fixed([-11.5, 21.5, -14.5], [-19, 15.2, -24], 5.4, { fov: 34, free: true }),
      ev: [
        { t: 0.05, sfx: 'glitch', vol: 0.4, rate: 0.8 },
        { t: 0.5, card: 'SLUICE', s: '水壩守備隊長', style: 'name', dur: 3.2 },
        sub(1.2, '這座水壩後面住著三座城鎮。誰都別想碰它。', 'sluice', 3.8),
        { t: 3.4, sfx: 'door', vol: 0.4, rate: 1.4 },
      ],
    },
    5.4,
  );
  // 6. 高潮：分割畫面——左＝主角突進、右＝SLUICE 迎擊；主角從中線跳過去，分割線碎掉
  const hk = {
    id: 'hk',
    k: 'hero',
    p: [10, 16],
    yaw: 90,
    s: [
      { t: 0, go: [48, 12] },
      { t: 0.3, qb: [1, 0] },
      { t: 1.3, qb: [1, 0.1] },
      { t: 2.2, jump: true },
      { t: 2.4, qb: [1, 0] },
    ],
  };
  const sl2 = { id: 'sl2', k: 'ace', key: 'sluice', p: [46, 6], yaw: 270, s: [{ t: 0, aim: 'hk' }] };
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.fight, chroma: 0.15 },
      gradeL: GC,
      gradeR: GA,
      render: 'c2split',
      ov: 'c2split',
      shatter: 2.75,
      actors: [hk, sl2],
      cam: fixed([14, 2.6, 30], { a: 'hk', o: [3, 1.5, 0] }, 4, { p1: [32, 3.2, 30], fov: 46 }),
      camR: fixed([37, 2.6, 22], { a: 'sl2', at: 'head' }, 4, { p1: [38, 2.6, 21], fov: 40 }),
      split: [
        { t: 0, v: 0.5 },
        { t: 2.75, v: 0.5 },
      ],
      ev: [
        { t: 0.3, sfx: 'boostUp', vol: 0.9 },
        { t: 0.5, a: 'sl2', fire: ['rarm', 'larm'], dur: 3, at: 'hk' },
        { t: 1.3, sfx: 'boostUp', vol: 0.9 },
        { t: 1.8, boom: { a: 'hk', o: [-3, 0, 4] }, r: 1.4 },
        { t: 2.2, sfx: 'thrBurst', vol: 0.9 },
        { t: 2.75, sfx: 'glass', vol: 1, rate: 0.7 },
        { t: 2.75, sfx: 'heavy', vol: 1, rate: 0.6 },
        { t: 2.75, shake: 1 },
      ],
    },
    3.6,
  );
  // 7. 整個畫面：對稱的大遠景，兩機交火
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.fight },
      keep: true,
      cam: fixed([24, 3.5, 36], [34, 4, 8], 3.4, { p1: [24, 3.7, 34], fov: 50 }),
      ev: [
        { t: 0, flash: '#ffffff', in: 0.01, hold: 0.04, out: 0.35 },
        { t: 0.1, a: 'hk', fire: ['rarm', 'larm'], dur: 3.2, at: 'sl2' },
        { t: 0.6, a: 'hk', qb: [0.4, -1] },
        { t: 0.6, sfx: 'boostUp', vol: 0.9 },
        { t: 1.4, a: 'sl2', qb: [0, 1] },
        { t: 1.6, boom: { a: 'sl2', o: [0, 1, 0] } },
        { t: 2.4, a: 'hk', fire: ['rback', 'lback'], dur: 0.6, at: 'sl2' },
        { t: 2.4, sfx: 'missile', vol: 1, rate: 0.9 },
      ],
    },
    3.4,
  );
  // 8. 追尾視角：鎖定、ACS 過載、慢動作
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.fight, bloom: 1.25, chroma: 0.4, tintHi: '#ffb070', tintHiK: 0.3 },
      ov: 'lock',
      lock: 'sl2',
      keep: true,
      cam: {
        fov: 50,
        hand: 0,
        follow: 14,
        keys: [
          { t: 0, p: { a: 'hk', at: 'head', o: [1.7, 0.9, 6.2], loc: true }, l: { a: 'sl2' } },
          { t: 4.4, p: { a: 'hk', at: 'head', o: [2.1, 1.2, 7], loc: true }, l: { a: 'sl2' } },
        ],
      },
      ev: [
        { t: 0.1, a: 'hk', aim: 'sl2' },
        { t: 0.2, a: 'hk', fire: 'all', dur: 3.8, at: 'sl2' },
        { t: 0.9, boom: { a: 'sl2', o: [1, 2, 0] }, r: 1.6 },
        { t: 0.9, fx: 'shockwave', at: { a: 'sl2' }, r: 7, color: 0xffb060 },
        { t: 0.92, slow: 0.25, dur: 0.8 },
        { t: 0.92, flash: '#ffd0a0', in: 0.03, hold: 0.05, out: 0.3 },
        subL(0.4, L[4], 3.8),
        { t: 3.6, boom: { a: 'sl2', o: [-1, 1, 1] }, big: true },
        { t: 3.6, shake: 1 },
      ],
    },
    4.4,
  );
  // 9. 章名：左右兩扇門合上（章名分成兩半跟著門走）
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...G.dusk },
      ov: 'c2title',
      title: { a: '第二章　工業帶的契約', s: 'CHAPTER II　THE INDUSTRIAL CONTRACT', t0: 0.5, close: 1.1 },
      fo: 1.4,
      cam: fixed([0, 6, 40], [0, 8, -24], 6.5, { p1: [0, 6, 36], fov: 50 }),
      ev: [
        { t: 0.5, sfx: 'door', vol: 0.8, rate: 0.5 },
        { t: 1.6, sfx: 'heavy', vol: 1, rate: 0.5 },
        { t: 1.6, sfx: 'boom1', vol: 0.7, rate: 0.6 },
        { t: 1.6, shake: 0.8 },
      ],
    },
    6.5,
  );
  return done(T, {
    title: '第二章　開場',
    music: [{ at: 0, track: 'cine_c2', vol: 0.9, fadeIn: 0.5, fadeOut: [T.at - 2.5, 2.5] }],
  });
}

// ================= 章末 =================
// 共通結尾：冰原上一個難民營的訊號燈熄滅（cctv＝卡斯特隆的監視器畫面）
function campLight(T, line, cctv, doc) {
  const blink = [0.5, 1.4, 2.3, 3.2, 4.1];
  T.add(
    {
      set: SNOWN,
      grade: cctv ? { ...G.night, ...GCCTV } : { ...G.night, temp: -0.3, vignette: 0.7 },
      ov: [cctv ? 'c2cctv' : null, doc ? 'c2bounty' : null].filter(Boolean),
      doc,
      lb: cctv ? false : undefined,
      feed: cctv ? { label: 'CAM 14　難民營　第 3 營地', die: 6.2 } : null,
      fo: 1.6,
      actors: [
        { id: 'tent', k: 'type', key: 'repair', p: [0, -14], yaw: 180, team: 'ally', pal: 'ally' },
        {
          id: 'camp',
          k: 'people',
          who: ['hooded', 'hooded', 'man', 'woman', 'farmer'],
          n: 9,
          p: [1, -9],
          r: 3,
          anim: ['Idle', 'Idle_Neutral', 'Sitting'],
          s: [{ t: 0, face: [0, -15] }],
          seed: 37,
        },
      ],
      cam: fixed([0, 4, 16], [0, 3, -14], 7.6, { p1: [0, 4, 13], fov: 38 }),
      ev: [
        ...blink.map((t, i) => ({
          t,
          fx: 'flash',
          at: [0, 4, -15],
          r: 2.6 - i * 0.35,
          color: 0xff5040,
          life: 0.25,
        })),
        ...blink.map((t, i) => ({ t, sfx: 'uiTick', vol: 0.5 - i * 0.08, rate: 0.6 })),
        sub(0.4, line, null, 5.4),
      ],
    },
    7.6,
  );
}

export function ch2Outro(ctx) {
  const pick = (ctx.choices || {}).c2 === 'aetheric' ? 'aetheric' : 'castron';
  const L = pickLines(CHAPTER_TEXT[2].outro, { c2: pick });
  return pick === 'castron' ? outroCastron(L) : outroAetheric(L);
}

// 卡斯特隆：下游城鎮的監視器畫面一格一格斷線
function outroCastron(L) {
  const T = timeline();
  T.add(
    {
      set: { k: 'black' },
      ev: [
        { t: 0.2, sys: ['CASTRON SECURITY NET', '下游監視網　連線中……', 'CAM 01–06　ONLINE'], dur: 2.6 },
        { t: 0.2, sfx: 'glitch', vol: 0.5, rate: 0.7 },
        { t: 1.6, sfx: 'uiTick', vol: 0.6, rate: 0.7 },
      ],
    },
    3,
  );
  // 監視器牆（水沒市街＝下游的城鎮，夜）
  const cell = (label, p, l, die) => ({ label, cam: fixed(p, l, 13, { fov: 50 }), die });
  T.add(
    {
      set: FLN,
      grade: { ...G.night, exposure: 1.1 },
      render: 'c2grid',
      hook: 'c2props',
      ov: 'c2grid',
      lb: false,
      cols: 3,
      rows: 2,
      actors: [
        {
          id: 'town',
          k: 'people',
          who: PEOPLE,
          n: 16,
          p: [-20, 6],
          box: [16, 6],
          go: [-14, -2],
          stagger: 3,
          yaw: 260,
          seed: 3,
        },
        {
          id: 'tw2',
          k: 'people',
          who: PEOPLE,
          n: 6,
          p: [18, -14],
          box: [10, 3],
          anim: ['Idle', 'Idle_Neutral'],
          face: 'rnd',
          seed: 5,
        },
      ],
      props: [
        {
          id: 'fac',
          k: 'facade',
          p: { g: [-14, -26] },
          size: [24, 10, 6],
          cols: 10,
          rows: 3,
          lamp: 0xffa050,
          on: [0.2, 0.05],
        },
        {
          id: 'town1',
          k: 'facade',
          p: { g: [18, -20] },
          size: [16, 8, 6],
          cols: 6,
          rows: 3,
          lamp: 0xffe2b0,
          seed: 9,
          off: [6, 0.12],
        },
        {
          id: 'town2',
          k: 'facade',
          p: { g: [4, 18] },
          size: [18, 7, 6],
          cols: 7,
          rows: 2,
          lamp: 0xffe2b0,
          seed: 13,
          yaw: 180,
          off: [7.5, 0.1],
        },
      ],
      cells: [
        cell('CAM 01　第三工廠', [-14, 6, -6], [-14, 5, -26], null),
        cell('CAM 02　下游鎮　東街', [18, 8, -2], [18, 3, -20], 8.6),
        cell('CAM 03　給水站', [30, 10, 10], [10, 0, 0], 5.6),
        cell('CAM 04　舊市街　北橋', [4, 7, 2], [4, 3, 18], 9.8),
        cell('CAM 05　避難所　入口', [-30, 9, 20], [-14, 1, 4], 7.2),
        cell('CAM 06　西側出口', [-34, 7, 12], [-52, 1, 0], null),
      ],
      ev: [subL(0.3, L[0], 5.0), subL(5.6, L[1], 6.4)],
    },
    13,
  );
  // 冰原邊緣（最後一台監視器）：難民往西走
  T.add(
    {
      set: SNOW,
      grade: { ...G.cold, ...GCCTV },
      ov: 'c2cctv',
      lb: false,
      fi: 0.4,
      feed: { label: 'CAM 11　冰原邊緣　西' },
      actors: refugees(0),
      cam: fixed([-8, 9, 18], [10, 1, 0], 6.5, { p1: [-12, 9, 18], l1: [4, 1, 0], fov: 42 }),
      ev: [subL(0.3, L[2], 5.6)],
    },
    6.5,
  );
  // 艾瑟立克的車隊也往西走
  T.add(
    {
      set: SNOW,
      grade: { ...G.cold, ...GCCTV },
      ov: 'c2cctv',
      lb: false,
      hook: 'c2props',
      feed: { label: 'CAM 12　冰原　北道' },
      actors: aethericConvoy,
      props: [
        {
          id: 'truck',
          k: 'truck',
          p: { g: [26, 6] },
          yaw: 270,
          cars: 3,
          keys: [
            { t: 0, o: [0, 0, 0] },
            { t: 6.5, o: [-30, 0, 0] },
          ],
        },
      ],
      cam: fixed([6, 11, 30], [6, 1, 2], 6.5, { fov: 46 }),
      ev: [subL(0.3, L[3], 5.8)],
    },
    6.5,
  );
  // ECHO：畫面停在空的雪原上，訊號慢慢變差
  T.add(
    {
      set: SNOW,
      grade: { ...G.cold, ...GCCTV, grain: 0.7 },
      ov: 'c2cctv',
      lb: false,
      feed: { label: 'CAM 11　冰原邊緣　西' },
      cam: fixed([-8, 9, 18], [10, 1, 0], 8.6, { p1: [-6, 9, 18], fov: 42 }),
      ev: [subL(0.3, L[4], 5.2), subL(5.6, L[5], 2.8)],
    },
    8.6,
  );
  campLight(T, L[6], true);
  return done(T, {
    title: '第二章　章末',
    music: [{ at: 0, track: 'cine_c2', off: 30, vol: 0.75, fadeIn: 1.5, fadeOut: [T.at - 3, 3] }],
  });
}

// 艾瑟立克：R-07 的懸賞檔案逐行列印，紅色印章蓋下
function outroAetheric(L) {
  const T = timeline();
  // 檔案的時間是全片的秒數（跨鏡頭逐行印下去）
  const doc = {
    t0: 1.0,
    center: 23.2,
    cx: 0.64,
    stamp: 24.4,
    lines: [
      [1.8, '懸賞令　No. C-2417', 'big'],
      [3.4, '對象：獨立傭兵　登錄號 R-07'],
      [5.4, '前雇主：卡斯特隆重工'],
      [8.5, '罪狀：違反主壩合約，將主壩移交敵對勢力', 'rule'],
      [12.5, '最後目擊：多重水壩　主壩'],
      [17.5, '賞金：████████ COAM'],
      [20.5, '生死不論。', 'big'],
    ],
  };
  const bg = { exposure: 0.8, vignette: 0.75 };
  T.add(
    {
      set: { k: 'black' },
      ov: 'c2bounty',
      doc,
      ev: [{ t: 0.4, sfx: 'clatter2', vol: 0.5, rate: 0.6 }],
    },
    3,
  );
  // 研究所的藍光
  T.add(
    {
      set: INST,
      grade: { ...G.under, ...GA, ...bg },
      ov: 'c2bounty',
      doc,
      hook: 'c2props',
      fi: 0.5,
      actors: [
        { id: 'am', k: 'type', key: 'mt', p: [-10, -8], yaw: 160, pal: 'aetheric' },
        {
          id: 'lab2',
          k: 'people',
          who: ['suitw', 'mansuit'],
          n: 4,
          p: [-2.5, -1.5],
          box: [4, 1.2],
          anim: ['Interact', 'Idle_Neutral'],
          s: [{ t: 0, face: [-4, -6] }],
          tint: { Black: 0xd8dce0, Shirt: 0xd8dce0 },
          seed: 31,
        },
      ],
      props: [
        { id: 'core', k: 'core', p: { g: [-4, -6] }, scale: 1.6 },
        { id: 't1', k: 'tank', p: { g: [-16, -14] }, r: 3, h: 8, fill: 0.8 },
        { id: 't2', k: 'tank', p: { g: [8, -14] }, r: 3, h: 8, fill: 0.7 },
      ],
      cam: fixed([-4, 3, 14], [-4, 3.5, -10], 7, { p1: [-4, 3, 11], l1: [-4, 3.5, -10], fov: 44 }),
      ev: [subL(0.3, L[0], 6.4)],
    },
    7,
  );
  // 水庫變成冷卻槽（蒸氣）
  T.add(
    {
      set: DAM,
      grade: { ...BASE, ...GA, ...bg },
      ov: 'c2bounty',
      doc,
      cam: fixed([-26, 30, -12], [-26, 0, -56], 6.5, {
        p1: [-21, 30, -12],
        l1: [-21, 0, -56],
        fov: 52,
        free: true,
      }),
      props: [{ id: 'steam', k: 'steam', p: [-24, -1, -46], n: 7, w: 34, d: 12, r: 4, rise: 26 }],
      ev: [
        ...[0, 0.7, 1.4, 2.1, 2.8, 3.5, 4.2].map((t, i) => ({
          t,
          fx: 'smoke',
          at: [-44 + i * 6, 1, -40 - (i % 3) * 6],
          r: 9,
          life: 7,
          rise: 14,
          color: 0xd8e0e8,
        })),
        subL(0.3, L[1], 5.8),
      ],
    },
    6.5,
  );
  // 難民往西走
  T.add(
    {
      set: SNOW,
      grade: { ...G.cold, ...bg },
      ov: 'c2bounty',
      doc,
      actors: refugees(0),
      cam: fixed([-20, 2, 14], [6, 2, 0], 6.5, { p1: [-24, 2, 14], l1: [2, 2, 0], fov: 40 }),
      ev: [subL(0.3, L[2], 5.6)],
    },
    6.5,
  );
  // 工業帶：懸賞令移到畫面中央，紅色印章蓋下
  T.add(
    {
      set: IND,
      grade: { ...G.day, ...GC, exposure: 0.6, vignette: 0.8 },
      ov: 'c2bounty',
      doc,
      actors: [
        { id: 'sv', k: 'ace', key: 'stevedore', p: [-4, -10], yaw: 0, s: [{ t: 0, aim: [2, 3, 30] }] },
      ],
      cam: fixed([0, 2, 6], { a: 'sv', at: 'head', o: [5, -0.5, 0] }, 7.5, { fov: 40 }),
      ev: [
        { t: 1.4, sfx: 'heavy', vol: 1, rate: 0.55 },
        { t: 1.4, sfx: 'punch1', vol: 1, rate: 0.5 },
        { t: 1.4, shake: 1 },
        { t: 1.4, flash: '#a01018', in: 0.01, hold: 0.04, out: 0.4 },
        subL(0.3, L[3], 5.2),
        subL(5.6, L[4], 5.2),
      ],
    },
    7.5,
  );
  T.add(
    {
      set: IND,
      grade: { ...G.day, ...GC, exposure: 0.5, vignette: 0.85 },
      ov: 'c2bounty',
      doc,
      keep: true,
      cam: fixed([0, 2, 6], { a: 'sv', at: 'head', o: [5, -0.5, 0] }, 6.6, { p1: [0, 2.2, 8], fov: 40 }),
      ev: [subL(3.4, L[5], 3)],
    },
    6.6,
  );
  campLight(T, L[6], false);
  return done(T, {
    title: '第二章　章末',
    music: [{ at: 0, track: 'cine_c2', off: 30, vol: 0.75, fadeIn: 1.5, fadeOut: [T.at - 3, 3] }],
  });
}

// ================= 抉擇 1：主壩的歸屬 =================
// 選前（在目前的戰場上播）：分割畫面，左＝卡斯特隆的出口、右＝艾瑟立克的出口；中線就是倒數條，兩邊的委託方輪流說話
export function c2Pre(ctx) {
  const opts = (ctx.opts || []).map((o, i) => ({ ...o, ex: i }));
  const live = { k: 'live' };
  const T = timeline();
  // 從玩家的肩後看各自的出口（左肩看左邊的出口、右肩看右邊的）
  const camL = (d, k0, k1) => ({
    fov: 44,
    ease: 'lin',
    keys: [
      { t: 0, p: { c2ex: 0, from: 'player', back: k0, side: -2.5, h: 4 }, l: { c2ex: 0, h: 4 } },
      { t: d, p: { c2ex: 0, from: 'player', back: k1, side: -2.5, h: 4 }, l: { c2ex: 0, h: 4.5 } },
    ],
  });
  const camR = (d, k0, k1) => ({
    fov: 44,
    ease: 'lin',
    keys: [
      { t: 0, p: { c2ex: 1, from: 'player', back: k0, side: 2.5, h: 4 }, l: { c2ex: 1, h: 4 } },
      { t: d, p: { c2ex: 1, from: 'player', back: k1, side: 2.5, h: 4 }, l: { c2ex: 1, h: 4.5 } },
    ],
  });
  // 一般的鏡頭（給引擎的遮擋與音效聽者）：玩家的頭後方
  const cam0 = {
    fov: 50,
    hand: 0,
    keys: [{ t: 0, p: { a: 'player', at: 'head', o: [0, 2, 9], loc: true }, l: { a: 'player', at: 'head' } }],
  };
  const shot = (d, o) => ({
    set: live,
    grade: { ...G.freeze, sat: 0.55 },
    gradeL: GC,
    gradeR: GA,
    render: 'c2split',
    ov: ['c2split', 'c2count'],
    labels: true,
    opts,
    cam: cam0,
    ...o,
  });
  T.add(
    shot(3.4, {
      camL: camL(3.4, 6, 3),
      camR: camR(3.4, 6, 3),
      dimL: 1,
      dimR: 0.45,
      side: [{ t: 0.2, s: 'L', who: 'castron', text: '合約就是合約。主壩是卡斯特隆的，傭兵。', d: 3.1 }],
      ev: [
        { t: 0, sfx: 'alarmBig', vol: 0.35, rate: 0.6 },
        ...opts.map((o, i) => ({ t: 0.1 + i * 0.25, fx: 'pillar', at: { ex: i }, r: 4, color: o.hex })),
        { t: 0.1, sfx: 'thud1', vol: 0.6, rate: 0.5 },
        { t: 1.8, sfx: 'thud2', vol: 0.5, rate: 0.5 },
      ],
    }),
    3.4,
  );
  T.add(
    shot(3.4, {
      camL: camL(3.4, 3, 1),
      camR: camR(3.4, 3, 1),
      dimL: 0.45,
      dimR: 1,
      side: [{ t: 0.2, s: 'R', who: 'aetheric', text: '走「背叛委託方」的出口，報酬是他們的兩倍。', d: 3.1 }],
      ev: [
        { t: 0, sfx: 'thud1', vol: 0.6, rate: 0.5 },
        { t: 1.4, sfx: 'thud2', vol: 0.5, rate: 0.5 },
        { t: 2.6, sfx: 'thud1', vol: 0.6, rate: 0.55 },
      ],
    }),
    3.4,
  );
  T.add(
    shot(3.6, {
      camL: camL(3.6, 1, -4),
      camR: camR(3.6, 1, -4),
      ev: [
        sub(0.1, '兩個出口只能選一個。……我不能替你選。', 'echo', 3.2),
        ...[0, 0.7, 1.3, 1.8, 2.25, 2.65, 3.0, 3.3].map((t, i) => ({
          t,
          sfx: i % 2 ? 'thud2' : 'thud1',
          vol: 0.5 + i * 0.05,
          rate: 0.5,
        })),
      ],
    }),
    3.6,
  );
  return done(T, {
    title: '抉擇',
    music: [{ at: 0, track: 'cine_c2', off: 60, vol: 0.8, fadeIn: 0.4, fadeOut: [T.at - 1, 1] }],
  });
}

// 選後：選中的那一半擴張，吃掉另一半
function choiceAfter(win, cuts, last) {
  const T = timeline();
  T.add(
    {
      set: { k: 'black' },
      ov: 'c2open',
      open: { a: 0.15, b: 0.15, t0: 0, win, out: 0.9, cap: 'DECISION LOGGED', capT: 0.9 },
      ev: [
        { t: 0.1, sfx: 'thud1', vol: 0.6, rate: 0.5 },
        { t: 0.9, sfx: 'heavy', vol: 1, rate: 0.5 },
        { t: 0.9, sfx: 'explodeBig', vol: 0.5, rate: 0.55 },
      ],
    },
    2,
  );
  for (const [s, d] of cuts) T.add(s, d);
  T.add(...black(last[0], last[1], 2.6, 'card', [{ t: 0.1, sfx: 'boom1', vol: 0.6, rate: 0.5 }]));
  return done(T, {
    title: win === 'L' ? '主壩：卡斯特隆' : '主壩：艾瑟立克',
    music: [{ at: 0, track: 'cine_c2', off: 90, vol: 0.9, fadeOut: [T.at - 2, 2] }],
  });
}

export function c2Castron() {
  return choiceAfter(
    'L',
    [
      // 閘門關上 ｜ 下游的河道乾涸
      [
        {
          set: DAM,
          grade: BASE,
          gradeL: GC,
          gradeR: { ...GA, sat: 0.5 },
          render: 'c2split',
          hook: 'c2props',
          ov: 'c2split',
          props: [gateLeaf(0.3, 1.6)],
          water: [
            { t: 1.8, v: 0 },
            { t: 4.8, v: -0.9 },
          ],
          split: [
            { t: 0, v: 0.5 },
            { t: 2.6, v: 0.5 },
            { t: 4.8, v: 0.68 },
          ],
          cam: fixed([-40.4, 2.4, 5], [-40.4, 4.6, -19], 4.8, { p1: [-40.4, 2.4, 3], fov: 46 }),
          camR: fixed([-35, 5, 12], [-40, -2.5, 60], 4.8, { p1: [-35, 5, 16], l1: [-40, -2.5, 64], fov: 46 }),
          actors: [
            {
              id: 'bank',
              k: 'people',
              who: PEOPLE,
              n: 9,
              p: [-33, 30],
              box: [6, 3],
              anim: ['Idle_Neutral', 'Idle'],
              s: [{ t: 0, face: [-40, 32] }],
              seed: 19,
            },
          ],
          ev: [
            { t: 0.3, sfx: 'door', vol: 0.8, rate: 0.5 },
            { t: 1.6, sfx: 'heavy', vol: 1, rate: 0.5 },
            { t: 1.6, shake: 0.9 },
            { t: 1.6, fx: 'dust', at: [-40.4, 0, -17], r: 7, n: 18, color: 0xb0b4b8 },
            sub(0.2, '閘門，一道一道關上。', null, 2.3),
            sub(2.6, '下游的河道，開始乾涸。', null, 2.1),
          ],
        },
        4.8,
      ],
      // 工業帶的燈一盞一盞亮起 ｜ 下游的燈一盞一盞熄滅；左半邊吃掉右半邊
      [
        {
          set: INDN,
          grade: G.night,
          gradeL: GC,
          gradeR: { ...GA, sat: 0.4 },
          render: 'c2split',
          hook: 'c2props',
          ov: 'c2split',
          actors: [
            {
              id: 'k1',
              k: 'type',
              key: 'mt',
              p: [-26, -6],
              yaw: 90,
              s: [{ t: 0, go: [-12, -6] }],
              pal: 'castron',
            },
            {
              id: 'k2',
              k: 'type',
              key: 'mth',
              p: [-30, -3],
              yaw: 90,
              s: [{ t: 0, go: [-16, -3] }],
              pal: 'castron',
            },
          ],
          props: [
            {
              id: 'fac',
              k: 'facade',
              p: { g: [-20, -14] },
              size: [22, 9, 6],
              cols: 10,
              rows: 3,
              lamp: 0xffa050,
              on: [0.2, 0.04],
            },
            {
              id: 'town',
              k: 'facade',
              p: { g: [20, -14] },
              size: [18, 7, 6],
              cols: 7,
              rows: 3,
              lamp: 0xffe2b0,
              seed: 9,
              off: [0.6, 0.06],
            },
          ],
          split: [
            { t: 0, v: 0.68 },
            { t: 1.6, v: 0.68 },
            { t: 4.0, v: 1 },
          ],
          cam: fixed([-20, 3, 10], [-20, 4.5, -14], 4.8, { p1: [-17, 3, 10], l1: [-17, 4.5, -14], fov: 48 }),
          camR: fixed([20, 3, 10], [20, 4, -14], 4.8, { p1: [17, 3, 10], l1: [17, 4, -14], fov: 48 }),
          ev: [
            { t: 0.2, sfx: 'heavy', vol: 0.7, rate: 0.6 },
            { t: 4.0, sfx: 'heavy', vol: 1, rate: 0.45 },
            { t: 4.0, shake: 0.6 },
            sub(0.3, '工業帶的燈，一盞一盞亮起。', null, 4.2),
          ],
        },
        4.8,
      ],
      // 代價：有人背起行李，往西走（整個畫面）
      [
        {
          set: SNOW,
          grade: { ...G.cold, sat: 0.6 },
          actors: refugees(0),
          fi: 0.2,
          cam: fixed([-18, 1.8, 12], [6, 2.4, 0], 3.6, { p1: [-21, 1.8, 12], l1: [3, 2.4, 0], fov: 40 }),
          ev: [{ t: 0, sfx: 'boom1', vol: 0.6, rate: 0.5 }, sub(0.3, '有人背起行李，往西走。', null, 3.1)],
        },
        3.6,
      ],
    ],
    ['你守住了合約。', 'CONTRACT FULFILLED'],
  );
}

export function c2Aetheric() {
  return choiceAfter(
    'R',
    [
      // 卡斯特隆的閘門 ｜ 水庫灌進冷卻槽、蒸氣衝天；右半邊吃掉左半邊
      [
        {
          set: DAM,
          grade: BASE,
          gradeL: { ...GC, sat: 0.5 },
          gradeR: GA,
          render: 'c2split',
          ov: 'c2split',
          actors: [{ id: 'k1', k: 'type', key: 'mt', p: [-36, -10], yaw: 180, pal: 'castron' }],
          split: [
            { t: 0, v: 0.5 },
            { t: 2.2, v: 0.5 },
            { t: 5, v: 0.3 },
          ],
          cam: fixed([-40.4, 2.4, 5], [-40.4, 4.6, -19], 5, { p1: [-40.4, 2.4, 3], fov: 46 }),
          camR: fixed([-22, 30, -12], [-22, 0, -56], 5, { p1: [-22, 31, -14], fov: 52, free: true }),
          props: [{ id: 'steam', k: 'steam', p: [-24, -1, -46], n: 7, w: 34, d: 12, r: 4, rise: 26 }],
          ev: [
            ...[0.2, 0.8, 1.4, 2.0, 2.6, 3.2, 3.8].map((t, i) => ({
              t,
              fx: 'smoke',
              at: [-34 + (i % 4) * 8, 1, -40 - (i % 3) * 6],
              r: 9,
              life: 7,
              rise: 14,
              color: 0xe0e8f0,
            })),
            { t: 0.3, sfx: 'thrBurst', vol: 0.6, rate: 0.4 },
            { t: 2.2, sfx: 'heavy', vol: 0.8, rate: 0.5 },
            sub(0.3, '主壩的電力，轉向研究機構。', null, 4.4),
          ],
        },
        5,
      ],
      // 集散場 ｜ 艾瑟立克的部隊；右半邊吃掉左半邊，懸賞令跳出
      [
        {
          set: IND,
          grade: G.day,
          gradeL: { ...GC, sat: 0.5 },
          gradeR: GA,
          render: 'c2split',
          ov: ['c2split', 'c2bounty'],
          actors: [
            { id: 'cr', k: 'type', key: 'crane', p: [-20, -12], yaw: 180, pal: 'castron' },
            {
              id: 'fk',
              k: 'type',
              key: 'forklift',
              p: [-28, -4],
              yaw: 90,
              s: [{ t: 0, go: [-12, -4] }],
              pal: 'castron',
            },
            {
              id: 'a1',
              k: 'type',
              key: 'mt',
              p: [16, -6],
              yaw: 270,
              s: [{ t: 0, go: [6, -6] }],
              pal: 'aetheric',
            },
            { id: 'a2', k: 'type', key: 'drone', p: [22, -10], yaw: 270 },
            // 被趕出廠區的工人（左半邊）、艾瑟立克的士兵（右半邊）
            {
              id: 'out',
              k: 'people',
              who: ['worker', 'worker', 'farmer', 'man'],
              n: 9,
              p: [-20, 2],
              box: [8, 2],
              go: [-10, 6],
              stagger: 1,
              yaw: 300,
              seed: 23,
            },
            {
              id: 'gd',
              k: 'people',
              who: ['soldier'],
              n: 3,
              p: [12, 0],
              box: [5, 1],
              anim: 'Idle_Gun_Pointing',
              s: [{ t: 0, face: [0, 0] }],
              seed: 29,
            },
          ],
          split: [
            { t: 0, v: 0.3 },
            { t: 0.8, v: 0.3 },
            { t: 2.6, v: 0 },
          ],
          doc: {
            t0: 9.2,
            stamp: 10.6,
            lines: [
              [9.5, '懸賞令　No. C-2417', 'big'],
              [9.8, '對象：登錄號 R-07'],
              [10.1, '罪狀：違反主壩合約'],
            ],
          },
          cam: fixed([-20, 3, 10], [-20, 4, -12], 5, { p1: [-17, 3, 10], l1: [-17, 4, -12], fov: 48 }),
          camR: fixed([16, 3, 10], [14, 4, -8], 5, { p1: [13, 3, 10], l1: [11, 4, -8], fov: 48 }),
          ev: [
            { t: 2.6, sfx: 'heavy', vol: 0.9, rate: 0.5 },
            { t: 3.6, sfx: 'punch1', vol: 1, rate: 0.5 },
            { t: 3.6, shake: 0.8 },
            sub(0.3, '卡斯特隆的懸賞令，貼滿了工業帶。', null, 4.4),
          ],
        },
        5,
      ],
      // STEVEDORE：固定的低角度、對稱
      [
        {
          set: IND,
          grade: { ...G.day, ...GC, contrast: 1.2 },
          actors: [
            { id: 'sv', k: 'ace', key: 'stevedore', p: [0, -4], yaw: 0, s: [{ t: 0.3, aim: [0, 3, 30] }] },
          ],
          cam: fixed({ a: 'sv', at: 'head', o: [0, -1.8, 6.5] }, { a: 'sv', at: 'head' }, 3.4, {
            p1: { a: 'sv', at: 'head', o: [0, -1.4, 5.2] },
            fov: 34,
          }),
          ev: [
            { t: 0, sfx: 'boom1', vol: 0.6, rate: 0.5 },
            { t: 0.2, card: 'STEVEDORE', s: '卡斯特隆的碼頭工頭', style: 'name', dur: 3 },
            sub(0.5, '叛徒。我會親手把你拆了。', 'stevedore', 2.8),
          ],
        },
        3.4,
      ],
    ],
    ['你背叛了委託方。', 'CONTRACT BROKEN'],
  );
}
