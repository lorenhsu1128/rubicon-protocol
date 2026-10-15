// 第 1 章 荒野的訊號：開場／章末（docs/cinematics-storyboard.md 第二版「西部對決」）。台詞＝CHAPTER_TEXT[1]
// 鏡頭語言照 Leone 的西部片：極遠景的剪影、長停留（8～12 秒）、對決時在眼燈／武器／遠景之間來回切、越切越短，
// 槍響 → 全黑 → 宿敵跪倒；章名是西部片的大字直接壓在遠景上；章末是營火旁一鏡到底拉遠到星空。
// 專用的效果在 game/cine-c1.js（c1ecu、c1antenna、c1fire、c1sand、c1glint、c1scope、c1pulse、c1title、c1chan、c1stars、c1heat）。
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { W, parseLine, timeline } from './kit.js';

// 場景：開場整段在同一張荒野（只建一次地圖，換鏡頭不會卡住）；章末是夜裡的沙丘
// 荒野（seed 6121）：原點在地圖的西北角，+X／+Z 是地圖內，北邊（−Z）與西邊（−X）是邊界外的空曠沙地；
// 演員要留在地圖內（局部 x ≥ −5、z ≥ −28）。局部 x 60～90、z ≤ −50 是高 16 m 的台地（BASTILLE 的砲台），
// 西緣 x ≈ −2 一帶是平的（遠景、對決）。地圖物件由 c1bare 藏起來，只剩地形
const WASTE = W('wasteland', { seed: 6121, tod: 'dusk', clear: 45 });
const NIGHT = W('dunes', { seed: 6115, tod: 'night', clear: 30 });

// 調色：暖橘、高對比、顆粒、暗角。太陽的方向每一鏡依鏡頭擺（逆光剪影）：WEST 在 −Z（sunAz 270）、EAST 在 +X
const WEST = {
  sunAz: 270,
  sunEl: 6,
  sunWarm: 0.95,
  sunK: 1.15,
  temp: 0.42,
  contrast: 1.3,
  sat: 0.82,
  tintHi: '#ffa050',
  tintHiK: 0.5,
  tintLo: '#2a1206',
  tintLoK: 0.45,
  grain: 0.42,
  vignette: 0.62,
  chroma: 0.1,
  fogK: 2.2,
  fogColor: '#d08850',
  fogColorK: 0.55,
  dust: 0.5,
  bloom: 1.05,
};
// 對決的大特寫：更硬、更暖、顆粒更粗
const EAST = { ...WEST, sunAz: 0 };
const DUEL = { ...EAST, mblur: false, contrast: 1.42, sat: 0.72, grain: 0.55, vignette: 0.75, tintHiK: 0.6 };
// BASTILLE 的瞄準鏡：紅、低彩度
const SCOPE = {
  ...WEST,
  sat: 0.35,
  temp: 0.2,
  tintHi: '#ff6040',
  tintHiK: 0.6,
  contrast: 1.45,
  grain: 0.6,
  vignette: 0.3,
};
// 營火的夜：冷藍的暗部＋火光的暖色
const FIRE = {
  sunAz: 270,
  sunEl: 30,
  sunK: 0.22,
  hemiK: 0.4,
  exposure: 0.9,
  sky: 'cloud',
  skyTop: '#0a1636',
  cloud: 0.06,
  fogColor: '#0c1220',
  fogColorK: 0.75,
  fogK: 1.6,
  tintLo: '#0c1630',
  tintLoK: 0.55,
  tintHi: '#ffa060',
  tintHiK: 0.35,
  contrast: 1.2,
  sat: 0.85,
  grain: 0.4,
  vignette: 0.6,
  bloom: 1.2,
  dust: 0,
};

// 每個地圖鏡頭都掛 c1bare：原點附近的地圖物件藏起來（空無一物的荒野）；半徑依場景
const BARE_R = { wasteland: 130, desert: 70, dunes: 60 };
// 同時把 drop 補齊：同一張地圖前面所有鏡頭的演員（不只上一鏡）都列進去，
// 這樣跳著看（劇場的下一鏡、換場景卡住跳過幾鏡）也不會留下別鏡的演員；keep 的鏡頭保留同一組的演員
function bare(T) {
  let key = '',
    seen = new Set(),
    group = new Set();
  for (const s of T.shots) {
    const k = JSON.stringify(s.set || { k: 'black' });
    if (k !== key) {
      key = k;
      seen = new Set();
      group = new Set();
    }
    const own = (s.actors || []).map((a) => a.id);
    if (!s.keep) group = new Set();
    const drop = [...seen].filter((id) => !group.has(id) && !own.includes(id));
    if (drop.length) s.drop = drop;
    for (const id of own) {
      seen.add(id);
      group.add(id);
    }
    if (s.set && s.set.k === 'world') {
      s.hook = ['c1bare', ...[].concat(s.hook || [])];
      if (s.bare == null) s.bare = BARE_R[s.set.theme] || 80;
    }
  }
  return T;
}
const sub = (line, t, dur, who) => {
  const L = parseLine(line);
  return { t, sub: L.text, who: who === undefined ? L.who : who, dur };
};
// 對決的一鏡：大特寫（眼燈或武器），鏡頭由 c1ecu 擺；cam 只是佔位
const ecu = (a, part, o, o1, l, fov, extra = {}) => ({
  set: WASTE,
  grade: DUEL,
  keep: true,
  hook: 'c1ecu',
  ecu: { a, part, o, o1, l, fov },
  cam: { fov, dof: 0.9, keys: [{ t: 0, p: [0, 6, 30], l: [0, 3, 0] }] },
  ...extra,
});
const RUST_C = '255,110,50',
  HERO_C = '120,220,255';

export function ch1Intro() {
  const L = pickLines(CHAPTER_TEXT[1].intro);
  const T = timeline();

  // 1. 極遠景：地平線、熱浪、一台小小的機體剪影走過；8 秒只有風聲
  T.add(
    {
      set: WASTE,
      grade: { ...EAST, fogK: 3, dust: 0.65 },
      fi: 2.5,
      render: 'c1heat',
      heat: [0.42, 0.72],
      heatAmp: 2.4,
      ov: 'c1sand',
      sand: 0.6,
      actors: [{ id: 'h1', k: 'hero', p: [-2, 36], yaw: 0, s: [{ t: 0, go: [-2, -26] }] }],
      cam: {
        fov: 17,
        hand: 0.03,
        fog: 160,
        follow: 1.5,
        ease: 'lin',
        keys: [
          { t: 0, p: [-100, 1.5, 12], l: { a: 'h1', o: [0, 1.5, 0] } },
          { t: 9, p: [-100, 1.5, 4], l: { a: 'h1', o: [0, 1.5, 0] } },
        ],
      },
      ev: [
        { t: 0.2, sfx: 'distant', vol: 0.35, rate: 0.5 },
        { t: 4.5, sfx: 'distant', vol: 0.3, rate: 0.45 },
        sub(L[0], 7.6, 5.2),
      ],
    },
    9,
  );

  // 2. 舊天線的紅光：從信號燈的大特寫慢慢拉開，看到斜插在沙裡的桅杆
  T.add(
    {
      set: WASTE,
      grade: { ...WEST, bloom: 1.3 },
      hook: 'c1antenna',
      antenna: { at: [60, -20], tilt: 0.32 },
      ov: ['c1pulse', 'c1sand'],
      sand: 0.35,
      cam: {
        fov: 18,
        hand: 0.04,
        ease: 'out',
        dof: 0.6,
        keys: [
          { t: 0, p: { g: [59.4, -10.8], h: 10.8 }, l: { g: [58.1, -14.9], h: 10.2 }, fov: 16 },
          { t: 8.5, p: { g: [72, 14], h: 2.2 }, l: { g: [58, -16], h: 6.5 }, fov: 34 },
        ],
      },
      ev: [
        ...[0.1, 1.35, 2.6, 3.85, 5.1, 6.35, 7.6].map((t) => ({ t, sfx: 'glitch', vol: 0.18, rate: 0.35 })),
        { t: 0.4, sfx: 'charge', vol: 0.25, rate: 0.3 },
        sub(L[1], 2.2, 6.2),
      ],
    },
    8.5,
  );

  // 3. BASTILLE：砲台的瞄準鏡 → 砲管後方，預警紅圈落在卡斯特隆的車隊上，連鎖爆炸
  // 砲台在北邊的台地（局部 x 60～90、z ≤ −50，高 16 m）上，往南看台地下的乾河道；車隊由東往西開
  const ROAD_YAW = 90;
  const convoy = [
    {
      id: 'cv1',
      k: 'type',
      key: 'tank',
      p: [80, -27],
      yaw: ROAD_YAW,
      s: [{ t: 0, go: [50, -27] }],
      pal: 'castron',
    },
    {
      id: 'cv2',
      k: 'type',
      key: 'mt',
      p: [89, -28],
      yaw: ROAD_YAW,
      s: [{ t: 0, go: [59, -28] }],
      pal: 'castron',
    },
    {
      id: 'cv3',
      k: 'type',
      key: 'mt',
      p: [98, -26],
      yaw: ROAD_YAW,
      s: [{ t: 0, go: [68, -26] }],
      pal: 'castron',
    },
  ];
  const GUN = [67, 21, -50],
    GUN2 = [79, 21, -51];
  T.add(
    {
      set: WASTE,
      grade: SCOPE,
      fi: 0.4,
      ov: 'c1scope',
      scope: { a: 'cv2' },
      actors: convoy,
      cam: {
        fov: 12,
        snap: true,
        hand: 0.02,
        follow: 4,
        fog: 120,
        keys: [
          { t: 0, p: { g: [69, -51], h: 5 }, l: { a: 'cv2' } },
          { t: 5, p: { g: [69, -51], h: 5 }, l: { a: 'cv2' } },
        ],
      },
      ev: [
        { t: 0.1, sfx: 'heavy', vol: 0.6, rate: 0.5 },
        { t: 0.8, sfx: 'alarm', vol: 0.35, rate: 0.6 },
        { t: 1.8, fx: 'ring', at: { a: 'cv1', at: 'base' }, r: 6, color: 0xff2a1a },
        { t: 2.2, fx: 'ring', at: { a: 'cv2', at: 'base' }, r: 6, color: 0xff2a1a },
        { t: 2.6, fx: 'ring', at: { a: 'cv3', at: 'base' }, r: 6, color: 0xff2a1a },
        { t: 3.4, sfx: 'thud1', vol: 0.6, rate: 0.6 },
        sub(L[2], 0.4, 6.6),
      ],
    },
    5,
  );
  T.add(
    {
      set: WASTE,
      grade: { ...WEST, contrast: 1.38, sat: 0.7 },
      keep: true,
      actors: [
        { id: 'gun1', k: 'model', key: 'cannon', p: [68, -52], yaw: -104, scale: 1.0, pal: 'boss' },
        { id: 'gun2', k: 'model', key: 'cannon', p: [80, -53], yaw: -110, scale: 1.0, pal: 'boss' },
        { id: 'bunk', k: 'model', key: 'bunker', p: [76, -80], yaw: 0, scale: 1.2, pal: 'boss' },
      ],
      cam: {
        fov: 44,
        hand: 0.05,
        fog: 120,
        ease: 'lin',
        keys: [
          { t: 0, p: { g: [60, 12], h: 9 }, l: { g: [68, -38], h: 4 } },
          { t: 7, p: { g: [62, 10], h: 9.5 }, l: { g: [69, -38], h: 4.5 } },
        ],
      },
      ev: [
        { t: 0.2, fx: 'flash', at: GUN, r: 4, color: 0xffc070 },
        { t: 0.2, fx: 'smoke', at: GUN, r: 2, life: 3, rise: 2 },
        { t: 0.2, sfx: 'heavy', vol: 1, rate: 0.6 },
        { t: 0.25, sfx: 'boom1', vol: 0.9, rate: 0.5 },
        { t: 0.25, shake: 0.5 },
        { t: 0.35, fx: 'warnLine', at: GUN, to: { a: 'cv2' }, color: 0xff3020, life: 1.2 },
        { t: 1.4, boom: { a: 'cv2' }, big: true, kill: true },
        { t: 1.45, a: 'cv2', die: true },
        { t: 1.5, fx: 'smoke', at: { a: 'cv2', at: 'base' }, r: 3, life: 7, rise: 9 },
        { t: 1.9, fx: 'flash', at: GUN2, r: 4, color: 0xffc070 },
        { t: 1.9, fx: 'smoke', at: GUN2, r: 2, life: 3, rise: 2 },
        { t: 1.9, sfx: 'heavy', vol: 0.9, rate: 0.55 },
        { t: 2.0, shake: 0.35 },
        { t: 2.0, fx: 'warnLine', at: GUN2, to: { a: 'cv1' }, color: 0xff3020, life: 1 },
        { t: 2.9, boom: { a: 'cv1' }, big: true, kill: true },
        { t: 2.95, a: 'cv1', die: true },
        { t: 3.0, fx: 'smoke', at: { a: 'cv1', at: 'base' }, r: 3, life: 6, rise: 9 },
        { t: 3.7, boom: { a: 'cv3' }, big: true, kill: true },
        { t: 3.75, a: 'cv3', die: true },
        { t: 3.8, fx: 'smoke', at: { a: 'cv3', at: 'base' }, r: 3, life: 5, rise: 9 },
        { t: 4.4, fx: 'smoke', at: { a: 'cv2', at: 'base' }, r: 5, life: 6, rise: 6 },
        sub(L[3], 3.0, 4.2),
      ],
    },
    7,
  );

  // 4. 霍斯特的委託：只有聲音；畫面是主角的腳踩過沙地（低角度），最後抬起來看到逆光的機體
  T.add(
    {
      set: WASTE,
      grade: WEST,
      fi: 0.3,
      hook: 'c1fxclear',
      ov: 'c1sand',
      sand: 0.8,
      actors: [{ id: 'hw', k: 'hero', p: [-2, 60], yaw: 0, s: [{ t: 0, go: [-2, -20] }] }],
      cam: {
        fov: 30,
        hand: 0.08,
        follow: 10,
        keys: [
          {
            t: 0,
            p: { a: 'hw', at: 'base', o: [3.2, 0.7, 4.2], loc: true },
            l: { a: 'hw', at: 'base', o: [0, 1.2, -1.5], loc: true },
          },
          {
            t: 6.5,
            p: { a: 'hw', at: 'base', o: [3.4, 0.7, 4.4], loc: true },
            l: { a: 'hw', at: 'base', o: [0, 1.3, -1.5], loc: true },
          },
          {
            t: 10,
            p: { a: 'hw', at: 'base', o: [2.2, 0.6, 6.5], loc: true },
            l: { a: 'hw', at: 'head', o: [0, 0.4, 0] },
            fov: 34,
          },
        ],
      },
      ev: [sub(L[4], 0.6, 3.8), sub('霍斯特：「合約就是合約。礦場拿回來，報酬照付。」', 4.8, 4.8)],
    },
    10,
  );

  // 5. 對決：隔著 40 m 站定；遠景 → 越肩 → 眼燈／武器的大特寫來回切，越切越短 → 槍響 → 全黑 → RUST 跪倒
  T.add(
    {
      set: WASTE,
      grade: EAST,
      ov: 'c1sand',
      sand: 1,
      actors: [
        { id: 'hd', k: 'hero', p: [-2, -24], yaw: 180 },
        { id: 'rv', k: 'ace', key: 'rust', p: [-2, 16], yaw: 0 },
      ],
      cam: {
        fov: 34,
        hand: 0.03,
        ease: 'lin',
        keys: [
          { t: 0, p: [-60, 1.3, -4], l: [-2, 3.2, -4] },
          { t: 5, p: [-56, 1.4, -4], l: [-2, 3.2, -4] },
        ],
      },
      ev: [
        { t: 0.1, sfx: 'distant', vol: 0.4, rate: 0.4 },
        sub('RUST：「那座天線是我先找到的！滾回去，菜鳥！」', 1.0, 3.8),
      ],
    },
    5,
  );
  T.add(
    {
      set: WASTE,
      grade: EAST,
      keep: true,
      ov: 'c1sand',
      sand: 0.7,
      cam: {
        fov: 20,
        hand: 0.04,
        dof: 0.6,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'hd', at: 'head', o: [3.0, 0.8, 7.0], loc: true }, l: { a: 'rv', o: [0, 0.5, 0] } },
          {
            t: 2.6,
            p: { a: 'hd', at: 'head', o: [2.8, 0.8, 6.4], loc: true },
            l: { a: 'rv', o: [0, 0.5, 0] },
          },
        ],
      },
    },
    2.6,
  );
  // 大特寫的節奏：2.4 → 2.0 → 1.6 → 1.3 → 1.1 → 0.8 → 0.6 → 0.45 → 0.35 秒
  const eyeR = (d, o, o1, fov) =>
    ecu('rv', 'head', o, o1, [0, 0, 0], fov, {
      ov: ['c1glint', 'c1sand'],
      sand: 0.5,
      glint: { a: 'rv', t: [0.15, 99], c: RUST_C },
      ev: [{ t: 0.1, sfx: 'charge', vol: 0.18, rate: 0.35 + 0.5 / d }],
    });
  const eyeH = (d, o, o1, fov) =>
    ecu('hd', 'head', o, o1, [0, -0.3, 0], fov, {
      ov: ['c1glint', 'c1sand'],
      sand: 0.5,
      glint: { a: 'hd', t: [0.15, 99], c: HERO_C, o: [0, -0.48, 0] },
      ev: [{ t: 0.05, sfx: 'thud2', vol: 0.25, rate: 0.5 }],
    });
  const gunR = (o, o1, fov, extra) =>
    ecu('rv', 'rarm', o, o1, [0, 0, -0.3], fov, {
      ...extra,
      ev: [{ t: 0, sfx: 'clatter1', vol: 0.3, rate: 0.6 }, ...((extra && extra.ev) || [])],
    });
  const gunH = (o, o1, fov, extra) =>
    ecu('hd', 'rarm', o, o1, [0, 0, -0.3], fov, {
      ...extra,
      ev: [{ t: 0, sfx: 'clatter2', vol: 0.3, rate: 0.6 }, ...((extra && extra.ev) || [])],
    });
  T.add(eyeR(2.4, [1.3, 0.15, -2.2], [1.0, 0.15, -1.7], 16), 2.4);
  T.add(eyeH(2.0, [-1.3, -0.3, -2.2], [-1.0, -0.3, -1.8], 16), 2.0);
  T.add(gunR([2.6, 0.3, -1.2], [2.2, 0.25, -1.0], 26), 1.6);
  T.add(
    {
      set: WASTE,
      grade: EAST,
      keep: true,
      ov: 'c1sand',
      sand: 1.2,
      cam: {
        fov: 52,
        hand: 0.02,
        keys: [
          { t: 0, p: [-28, 0.9, -4], l: [-2, 2.6, -4] },
          { t: 1.3, p: [-27.4, 0.9, -4], l: [-2, 2.6, -4] },
        ],
      },
      ev: [{ t: 0, sfx: 'distant', vol: 0.3, rate: 0.6 }],
    },
    1.3,
  );
  T.add(gunH([2.6, 0.3, -1.2], [2.2, 0.25, -1.0], 26), 1.1);
  T.add(eyeR(0.8, [0.8, 0.12, -1.4], [0.75, 0.12, -1.3], 13), 0.8);
  T.add(eyeH(0.6, [-0.8, -0.3, -1.4], [-0.75, -0.3, -1.3], 13), 0.6);
  // 拔槍：RUST 先抬手，主角更快
  T.add(gunR([2.1, 0.3, -0.7], [2.0, 0.3, -0.65], 20, { ev: [{ t: 0.05, a: 'rv', aim: 'hd' }] }), 0.45);
  // 主角先開槍：閃光＋槍響，接全黑
  T.add(
    gunH([2.3, 0.35, -0.5], [2.2, 0.35, -0.45], 20, {
      ev: [
        { t: 0, a: 'hd', aim: 'rv' },
        { t: 0.24, flash: '#fff4e0', in: 0.02, hold: 0.05, out: 0.04 },
        { t: 0.24, sfx: 'rifle2', vol: 1 },
        { t: 0.24, sfx: 'heavy', vol: 0.9, rate: 0.7 },
      ],
    }),
    0.35,
  );
  // 全黑：槍聲的回音；RUST 在黑暗中跪下
  T.add(
    {
      set: WASTE,
      grade: EAST,
      keep: true,
      fade: 1,
      cam: { fov: 40, keys: [{ t: 0, p: [0, 3, 30], l: [0, 2, 0] }] },
      ev: [
        { t: 0.05, sfx: 'distant', vol: 0.7, rate: 0.55 },
        { t: 0.4, sfx: 'hit3', vol: 0.6, rate: 0.6 },
        { t: 0.3, a: 'rv', aim: null },
        { t: 0.3, a: 'hd', aim: 'rv' },
      ],
    },
    1.3,
  );
  // RUST 跪倒：從 RUST 的背後看過去，遠處的主角還舉著槍；胸口冒煙、火花
  T.add(
    {
      set: WASTE,
      grade: { ...EAST, contrast: 1.36 },
      keep: true,
      hook: 'c1kneel',
      kneel: { rv: [1.2, 0.32] },
      ov: 'c1sand',
      sand: 0.6,
      cam: {
        fov: 30,
        hand: 0.04,
        dof: 0.25,
        ease: 'lin',
        keys: [
          {
            t: 0,
            p: { a: 'rv', at: 'base', o: [4.5, 1.4, 8], loc: true },
            l: { a: 'rv', o: [-1, 0.8, -6], loc: true },
          },
          {
            t: 4.5,
            p: { a: 'rv', at: 'base', o: [5.2, 1.6, 9.5], loc: true },
            l: { a: 'rv', o: [-1, 0.8, -6], loc: true },
          },
        ],
      },
      ev: [
        // 黑畫面那一鏡被跳過時（劇場的下一鏡、卡住）也要放下手臂
        { t: 0, a: 'rv', aim: null },
        { t: 0, fx: 'streaks', at: { a: 'rv', o: [0, 2.6, 0] }, n: 18, color: 0xffb060, speed: 9 },
        { t: 0.1, fx: 'smoke', at: { a: 'rv', o: [0, 2.4, 0] }, r: 1.2, life: 4, rise: 3 },
        { t: 1.4, fx: 'smoke', at: { a: 'rv', o: [0, 2.4, 0] }, r: 1.1, life: 4, rise: 3 },
        { t: 2.8, fx: 'smoke', at: { a: 'rv', o: [0, 2.4, 0] }, r: 1, life: 4, rise: 3 },
        { t: 0.6, sfx: 'debris', vol: 0.5, rate: 0.7 },
        { t: 1.6, sfx: 'clatter1', vol: 0.4, rate: 0.5 },
      ],
    },
    4.5,
  );
  // 6. 章名：西部片的大字砸在極遠景上（站著的主角、跪著的 RUST、夕陽）
  T.add(
    {
      set: WASTE,
      grade: { ...EAST, fogK: 2.6 },
      keep: true,
      hook: 'c1kneel',
      kneel: { rv: [1.2, 0.32] },
      ov: ['c1title', 'c1sand'],
      sand: 0.7,
      title: { at: 0.5, big: '荒野的訊號', sub: 'CHAPTER  I', en: 'The Signal in the Wastes', y: 0.38 },
      fo: 1.6,
      cam: {
        fov: 30,
        hand: 0.02,
        ease: 'lin',
        keys: [
          { t: 0, p: [-100, 2.2, -4], l: [-2, 8, -4] },
          { t: 8, p: [-94, 2.4, -4], l: [-2, 8, -4] },
        ],
      },
      ev: [
        { t: 0.5, sfx: 'heavy', vol: 1, rate: 0.45 },
        { t: 0.5, sfx: 'boom1', vol: 0.7, rate: 0.4 },
        { t: 0.5, shake: 0.25 },
        sub(L[5], 4.2, 3.2),
      ],
    },
    8,
  );
  return bare(T).def({
    title: '第一章　開場',
    music: [{ at: 0, track: 'cine_c1', vol: 0.9, fadeIn: 2, fadeOut: [T.at - 3, 3] }],
  });
}

// 章末：營火旁的一鏡到底（不剪接），從火光裡的主角慢慢拉遠、抬到星空；四家委託方只有聲音（攔截的頻道），
// 最後 3 秒軌道站的光點閃一下
export function ch1Outro() {
  const L = pickLines(CHAPTER_TEXT[1].outro);
  const T = timeline();
  const D = 38;
  T.add(
    {
      set: NIGHT,
      grade: FIRE,
      fi: 3,
      fo: 2.5,
      hook: ['c1fire', 'c1kneel'],
      kneel: { hk: [1.0, -0.14] },
      fire: { at: [0, 0] },
      ov: ['c1stars', 'c1chan'],
      stars: { on: [10, 22], station: [33, 36], dir: [-0.44, 0.5, -0.74] },
      chans: [
        { t: 11.6, d: 4, who: 'castron', n: 1 },
        { t: 15.8, d: 4, who: 'aetheric', n: 2 },
        { t: 20, d: 3.6, who: 'veerwell', n: 3 },
        { t: 23.8, d: 4.4, who: 'sancta', n: 4 },
      ],
      actors: [{ id: 'hk', k: 'hero', p: [-3.2, 0], yaw: 270, s: [] }],
      cam: {
        fov: 30,
        hand: 0.03,
        ease: 'lin',
        keys: [
          { t: 0, p: [4.4, 1.1, 0.9], l: { a: 'hk', at: 'head', o: [0, -0.6, 0] } },
          { t: 9, p: [6.5, 3.6, 6], l: { a: 'hk', o: [0, 1.2, 0] }, fov: 33 },
          { t: 19, p: [12, 8, 14], l: [-2, 0.5, 0], fov: 40 },
          { t: 29, p: [18, 13, 22], l: [-10, 14, -18], fov: 46 },
          { t: D, p: [21, 16, 26], l: [-30, 62, -56], fov: 50 },
        ],
      },
      ev: [
        { t: 0.2, sfx: 'distant', vol: 0.2, rate: 0.35 },
        sub(L[0], 1.6, 4.4),
        sub(L[1], 6.4, 4.6),
        sub(L[2], 11.8, 3.8, null),
        sub(L[3], 16, 3.8, null),
        sub(L[4], 20.2, 3.4, null),
        sub(L[5], 24, 4.2, null),
        sub(L[6], 28.6, 3.4),
        sub(L[7], 32.4, 4.2),
        { t: 34.2, sfx: 'glitch', vol: 0.25, rate: 0.5 },
      ],
    },
    D,
  );
  return bare(T).def({
    title: '第一章　章末',
    music: [{ at: 0, track: 'cine_c1', vol: 0.8, fadeIn: 3, fadeOut: [T.at - 4, 4] }],
  });
}
