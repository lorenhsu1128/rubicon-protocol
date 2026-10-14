// 過場動畫的鏡頭組件（各章的開場／章末、抉擇演出共用；分鏡見 docs/cinematics-storyboard.md）。
// 用法：const T = timeline(); T.add(shot, 秒數)……；T.def({ music }) 產生劇本。
// 同一個場景連續的鏡頭：前一鏡的演員自動移除（keep: true 時保留），所以每個組件都可以放自己的演員。

// 調色
export const G = {
  dusk: { sunAz: 250, sunEl: 8, sunWarm: 0.7, tintHi: '#ffa060', tintHiK: 0.4, fogK: 1.5, dust: 0.5 },
  day: { sunAz: 210, sunEl: 26, sunWarm: 0.3, tintLo: '#2f5a70', tintLoK: 0.3, fogK: 1.4, dust: 0.35 },
  cold: { sunAz: 140, sunEl: 12, tintLo: '#2a4a66', tintLoK: 0.45, contrast: 1.12, fogK: 1.2 },
  night: {
    sunEl: 35,
    tintLo: '#18284a',
    tintLoK: 0.5,
    tintHi: '#ffa070',
    tintHiK: 0.25,
    exposure: 0.85,
    bloom: 1,
    sky: 'cloud',
    skyTop: '#060a18',
    cloud: 0.35,
    fogColor: '#141c2c',
    fogColorK: 0.6,
  },
  under: { tintLo: '#20405a', tintLoK: 0.5, fogK: 1.4, contrast: 1.1, exposure: 0.95, bloom: 1 },
  red: {
    sky: 'cloud',
    skyTop: '#2a1030',
    cloud: 0.6,
    fogColor: '#8a3848',
    fogColorK: 0.45,
    sunAz: 200,
    sunEl: 5,
    sunWarm: 0.8,
    tintHi: '#ff6a50',
    tintHiK: 0.5,
    tintLo: '#40204a',
    tintLoK: 0.5,
    bloom: 1.1,
    fogK: 1.6,
  },
  // 抉擇的倒數：冷色、低彩度
  freeze: { sat: 0.35, temp: -0.45, contrast: 1.15, vignette: 0.6, tintLo: '#20385a', tintLoK: 0.5 },
  // 戰鬥的高潮：對比、色差、Bloom
  fight: { contrast: 1.2, chroma: 0.35, bloom: 1.15 },
};
export const W = (theme, o = {}) => ({
  k: 'world',
  theme,
  seed: o.seed || 5000 + theme.length * 31,
  clear: 30,
  ...o,
});

const sub = (text, who, t = 0.3, dur) => ({ t, sub: text, who: who || null, dur });

// ---------- 時間軸 ----------
export function timeline() {
  let at = 0;
  const shots = [];
  let prevKey = '',
    prevIds = [];
  return {
    shots,
    get at() {
      return at;
    },
    add(s, d) {
      const key = JSON.stringify(s.set || { k: 'black' });
      const ids = (s.actors || []).map((a) => a.id);
      const same = key === prevKey;
      const sh = { ...s, at };
      if (same && !s.keep) sh.drop = [...(s.drop || []), ...prevIds];
      shots.push(sh);
      prevKey = key;
      prevIds = s.keep ? [...prevIds, ...ids] : ids;
      at += d;
      return sh;
    },
    def(o) {
      return { title: o.title || '', dur: at + 0.3, lb: 2.39, music: o.music || [], shots };
    },
  };
}

// 一句台詞的秒數
export const lineDur = (s) => Math.max(3.2, Math.min(7, 1.5 + (s || '').length * 0.13));
// 「名字：「…」」→ { text, who }
const WHO = {
  ECHO: 'echo',
  霍斯特: 'castron',
  薩奇: 'aetheric',
  派克: 'veerwell',
  諾拉: 'sancta',
  米拉: 'mira',
};
export function parseLine(l) {
  const m = /^([^「」：]{1,14})：「(.+)」$/.exec(l || '');
  if (!m) return { text: l || '', who: null };
  const n = m[1].replace(/（.*）$/, '');
  return { text: m[2], who: WHO[n] || (/^[A-Z &]+$/.test(n) ? n.toLowerCase() : null) };
}

// ---------- 組件（回傳 [鏡頭, 秒數]）----------
// 黑底字卡
export function black(card, s, d = 2.6, style = 'card', ev = []) {
  return [
    {
      set: { k: 'black' },
      ev: [...(card ? [{ t: 0.25, card, s: s || '', style, dur: d - 0.4 }] : []), ...ev],
    },
    d,
  ];
}
// 空景：crane 升起／pan 橫移／push 推近／fly 低空飛越／orbit 環繞；line＝字幕
const MOVES = {
  crane: [
    [-26, 3, 26],
    [-20, 16, 20],
    [10, 6, -14],
    [10, 4, -16],
  ],
  pan: [
    [-30, 5, 20],
    [-6, 5, 30],
    [10, 4, -10],
    [20, 4, -2],
  ],
  push: [
    [0, 7, 34],
    [0, 6, 22],
    [0, 5, -20],
    [0, 6, -20],
  ],
  fly: [
    [-40, 16, 30],
    [10, 9, 10],
    [10, 2, -30],
    [40, 0, -30],
  ],
  low: [
    [-18, 1.4, 16],
    [-12, 1.8, 12],
    [6, 5, -8],
    [8, 6, -8],
  ],
};
export function vista(set, grade, mv, line, o = {}) {
  const P = MOVES[mv] || MOVES.crane;
  const L = parseLine(line);
  const d = o.d || lineDur(L.text);
  return [
    {
      set,
      grade,
      ov: o.ov,
      fi: o.fi,
      fo: o.fo,
      actors: o.actors || [],
      cam: {
        fov: o.fov || 46,
        hand: 0.1,
        fog: 30,
        ease: 'lin',
        keys: [
          { t: 0, p: o.p0 || P[0], l: o.l0 || P[2] },
          { t: d, p: o.p1 || P[1], l: o.l1 || P[3] },
        ],
      },
      ev: [...(line ? [sub(L.text, L.who, 0.3, d - 0.4)] : []), ...(o.ev || [])],
    },
    d,
  ];
}
// 委託方的通訊：主角站在戰場上，左側是說話者的徽章與聲紋
export function comm(set, grade, line, o = {}) {
  const L = parseLine(line);
  const who = o.who || L.who;
  const d = o.d || lineDur(L.text) + 0.3;
  return [
    {
      set,
      grade: { ...grade, ...(o.grade || {}) },
      ov: 'comm',
      actors: [{ id: 'heroC', k: 'hero', p: [0, 0], yaw: o.yaw == null ? 200 : o.yaw }, ...(o.actors || [])],
      cam: {
        fov: 34,
        hand: 0.06,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'heroC', o: [7, 2.5, 9] }, l: { a: 'heroC', o: [-3, 3, 0] } },
          { t: d, p: { a: 'heroC', o: [9, 3, 12] }, l: { a: 'heroC', o: [-3, 3.5, 0] } },
        ],
      },
      ev: [sub(L.text, who, 0.35, d - 0.4), ...(o.badge ? [{ t: 0, badge: o.badge }] : []), ...(o.ev || [])],
    },
    d,
  ];
}
// 宿敵登場：低角度仰拍＋左下名牌，背景爆炸
export function rival(set, grade, key, name, tag, line, o = {}) {
  const L = parseLine(line);
  const d = o.d || Math.max(3.4, lineDur(L.text));
  return [
    {
      set,
      grade: { ...grade, contrast: 1.18 },
      actors: [{ id: 'rv', k: 'ace', key, p: [0, -2], yaw: 180, s: [{ t: 0.3, aim: [0, 3, 30] }] }],
      cam: {
        fov: 30,
        hand: 0.08,
        dof: 0.9,
        keys: [
          { t: 0, p: { a: 'rv', at: 'head', o: [2.2, -1.6, 7] }, l: { a: 'rv', at: 'head' } },
          { t: d, p: { a: 'rv', at: 'head', o: [1.3, -1.0, 4.8] }, l: { a: 'rv', at: 'head' } },
        ],
      },
      ev: [
        { t: 0.1, sfx: 'charge', vol: 0.6, rate: 0.6, at: { a: 'rv' } },
        { t: 0.3, card: name, s: tag, style: 'name', dur: d - 0.5 },
        { t: 0.8, boom: [-12, 2, -16] },
        { t: 1.6, boom: [10, 2, -20], big: true },
        ...(line ? [sub(L.text, L.who || o.who, 1.0, d - 1.2)] : []),
        ...(o.ev || []),
      ],
    },
    d,
  ];
}
// Boss 登場：model＝boss-models 的鍵、worm、train
export function boss(set, grade, model, name, tag, line, o = {}) {
  const L = parseLine(line);
  const d = o.d || Math.max(4, lineDur(L.text));
  const actor =
    model === 'worm'
      ? {
          id: 'boss',
          k: 'worm',
          n: 14,
          scale: 2.4,
          keys: [
            { t: 0, p: [0, -30, -30] },
            { t: 1.6, p: [0, 16, -28] },
            { t: d, p: [10, 22, -16] },
          ],
        }
      : model === 'train'
        ? {
            id: 'boss',
            k: 'train',
            yaw: 90,
            keys: [
              { t: 0, p: [70, 0, 0], lin: true },
              { t: d + 3, p: [-90, 0, 0], lin: true },
            ],
          }
        : {
            id: 'boss',
            k: 'model',
            key: model,
            p: o.p || [0, 0, -26],
            yaw: o.yaw || 0,
            scale: o.scale || 1.4,
          };
  return [
    {
      set: model === 'train' ? { ...set, rail: true, align: 'rail', clear: 8 } : set,
      grade: { ...grade, contrast: 1.15 },
      actors: [actor, ...(o.actors || [])],
      cam: {
        fov: 50,
        hand: 0.2,
        follow: 5,
        keys: [
          { t: 0, p: model === 'train' ? [-8, 1.3, 6] : [-8, 1.2, 14], l: { a: 'boss', o: [0, 4, 0] } },
          { t: d, p: model === 'train' ? [-9, 1.5, 6.5] : [-11, 1.8, 19], l: { a: 'boss', o: [0, 7, 0] } },
        ],
      },
      ev: [
        { t: 0.1, sfx: model === 'worm' ? 'rock1' : 'heavy', vol: 1, rate: 0.55 },
        { t: 0.2, shake: 0.6 },
        ...(model === 'worm' ? [{ t: 0.3, boom: [0, 0, -30], big: true }] : []),
        { t: 0.5, card: name, s: tag, style: 'name', dur: d - 0.7 },
        { t: d * 0.35, boom: { a: 'boss', o: [6, 1, 8] } },
        { t: d * 0.7, boom: { a: 'boss', o: [-7, 1, 10] }, big: true },
        ...(line ? [sub(L.text, L.who, 1.0, d - 1.2)] : []),
        ...(o.ev || []),
      ],
    },
    d,
  ];
}
// 主角：walk 走向鏡頭／boost 快速推進穿過／hover 懸浮／kneel 跪坐（蹲低）
export function hero(set, grade, mode, line, o = {}) {
  const L = parseLine(line);
  const d = o.d || lineDur(L.text);
  const s =
    mode === 'boost'
      ? [
          { t: 0.1, go: [40, -10] },
          { t: 0.3, qb: [1, 0] },
          { t: 1.2, qb: [1, -0.2] },
          { t: 2.1, qb: [1, 0.2] },
        ]
      : mode === 'hover'
        ? [{ t: 0, hover: true, aim: [20, 10, -40] }]
        : mode === 'kneel'
          ? [{ t: 0, crouch: true }]
          : [{ t: 0, go: [0, 14] }];
  return [
    {
      set,
      grade,
      ov: o.ov,
      actors: [
        {
          id: 'heroH',
          k: 'hero',
          p: mode === 'boost' ? [-30, 0] : [0, -6],
          yaw: mode === 'boost' ? 270 : 0,
          s,
        },
        ...(o.actors || []),
      ],
      cam:
        o.cam ||
        (mode === 'boost'
          ? {
              fov: 44,
              hand: 0.15,
              follow: 8,
              keys: [
                { t: 0, p: [-8, 2, 16], l: { a: 'heroH' } },
                { t: d, p: [6, 3, 16], l: { a: 'heroH', o: [6, 0, 0] } },
              ],
            }
          : {
              fov: 34,
              hand: 0.1,
              dof: 0.5,
              keys: [
                { t: 0, p: { a: 'heroH', o: [3, 1.2, 9] }, l: { a: 'heroH', at: 'head' } },
                { t: d, p: { a: 'heroH', o: [2.4, 1.0, 6.5] }, l: { a: 'heroH', at: 'head' } },
              ],
            }),
      ev: [
        ...(line ? [sub(L.text, L.who, 0.3, d - 0.4)] : []),
        ...(mode === 'boost' ? [{ t: 0.3, sfx: 'boostUp', vol: 0.8, rate: 0.8 }] : []),
        ...(o.ev || []),
      ],
    },
    d,
  ];
}
// 追尾視角對射（高潮）：右肩後方 → 反打（慢動作與失衡）；回傳兩個鏡頭 [[鏡頭, 秒數], [鏡頭, 秒數]]
// o.rp＝宿敵的位置（[x, z]，相對原點），o.lines＝[第一鏡的字幕, 第二鏡的字幕]
export function shootout(set, grade, key, o = {}) {
  const rp = o.rp || [-26, -6];
  const d1 = o.d1 || 3,
    d2 = o.d2 || 3;
  const gr = { ...grade, ...G.fight };
  const lines = (o.lines || []).map(parseLine);
  const ace = {
    id: 'foe',
    k: o.k || 'ace',
    key,
    p: rp,
    yaw: o.yaw == null ? 270 : o.yaw,
    s: [
      { t: 0, aim: 'hs', hover: !!o.hover },
      { t: 0.2, fire: ['rarm', 'larm'], dur: d1 + d2 },
      { t: 0.7, qb: [1, 0] },
      { t: 1.5, qb: [-1, 0.3] },
      { t: 2.1, fire: ['rback', 'lback'], dur: 0.6 },
      { t: 2.6, qb: [1, -0.2] },
    ],
  };
  const heroS = {
    id: 'hs',
    k: 'hero',
    p: o.hp || [0, 10],
    yaw: o.hyaw == null ? 120 : o.hyaw,
    s: [{ t: 0, aim: 'foe' }],
  };
  const shot1 = {
    set,
    grade: gr,
    ov: 'lock',
    lock: 'foe',
    actors: [heroS, ace, ...(o.actors || [])],
    cam: {
      fov: 52,
      hand: 0.22,
      follow: 18,
      keys: [
        { t: 0, p: { a: 'hs', at: 'head', o: [1.7, 0.9, 6.2], loc: true }, l: { a: 'foe' } },
        { t: d1, p: { a: 'hs', at: 'head', o: [1.9, 1.1, 5.6], loc: true }, l: { a: 'foe' } },
      ],
    },
    ev: [
      { t: 0.15, sfx: 'alarm', vol: 0.5, rate: 1.2 },
      { t: 0.25, a: 'hs', fire: ['rarm', 'larm'], dur: d1 + d2 - 0.5, at: 'foe' },
      { t: 0.6, a: 'hs', qb: [-1, -0.2] },
      { t: 0.6, sfx: 'boostUp', vol: 0.9 },
      { t: 1.1, boom: { a: 'hs', o: [-5, 0, -3] }, r: 1.4, near: true },
      { t: 1.25, a: 'hs', qb: [1, -0.3] },
      { t: 1.25, sfx: 'boostUp', vol: 0.9 },
      { t: 1.7, boom: { a: 'foe', o: [0, 1, 0] } },
      { t: 1.7, fx: 'streaks', at: { a: 'foe' }, n: 40, color: 0xffd080 },
      { t: 2.0, a: 'hs', fire: ['rback', 'lback'], dur: 0.6, at: 'foe' },
      { t: 2.0, sfx: 'missile', vol: 1, rate: 0.9 },
      { t: d1 - 0.6, boom: { a: 'hs', o: [-6, 1, 1] }, r: 2, big: true, near: true },
      { t: d1 - 0.6, shake: 0.9 },
      ...(lines[0] ? [sub(lines[0].text, lines[0].who || o.who, 0.3, d1 - 0.2)] : []),
    ],
  };
  const shot2 = {
    set,
    grade: { ...gr, chroma: 0.4, bloom: 1.25, tintHi: '#ffb070', tintHiK: 0.3 },
    ov: 'lock',
    lock: 'foe',
    keep: true,
    cam: {
      fov: 46,
      hand: 0.25,
      follow: 14,
      keys: [
        { t: 0, p: { a: 'hs', at: 'head', o: [-1.8, 1.0, 6], loc: true }, l: { a: 'foe' }, roll: -4 },
        { t: d2, p: { a: 'hs', at: 'head', o: [-2.4, 1.6, 7], loc: true }, l: { a: 'foe' }, roll: 3 },
      ],
    },
    ev: [
      { t: 0.1, a: 'hs', qb: [-1, 0] },
      { t: 0.1, sfx: 'boostUp', vol: 1 },
      { t: 0.3, a: 'hs', fire: 'all', dur: d2 - 0.4, at: 'foe' },
      { t: 0.8, boom: { a: 'hs', o: [-4, 0, 3] }, r: 1.4, near: true },
      { t: 1.2, boom: { a: 'foe', o: [1, 2, 0] }, big: true },
      { t: 1.2, fx: 'shockwave', at: { a: 'foe' }, r: 7, color: 0xffb060 },
      { t: 1.2, fx: 'streaks', at: { a: 'foe' }, n: 60, color: 0xffc070, speed: 40 },
      { t: 1.22, slow: 0.25, dur: 0.7 },
      { t: 1.22, flash: '#ffd0a0', in: 0.03, hold: 0.05, out: 0.3 },
      ...(lines[1]
        ? [sub(lines[1].text, lines[1].who || 'echo', 1.5, d2 - 1.5)]
        : [sub('ACS 過載——對方失衡！', 'echo', 1.5, 1.4)]),
      { t: d2 - 1, a: 'hs', qb: [1, -1] },
      { t: d2 - 0.7, boom: { a: 'foe', o: [-1, 1, 1] }, big: true },
      { t: d2 - 0.7, shake: 1 },
      { t: d2 - 0.15, flash: '#ffffff', in: 0.05, hold: 0.1, out: 0.25 },
    ],
  };
  return [
    [shot1, d1],
    [shot2, d2],
  ];
}
// 章名卡（主角的剪影＋章名）
export function chapterCard(set, grade, title, s) {
  return [
    {
      set,
      grade,
      actors: [{ id: 'heroT', k: 'hero', p: [0, 0], yaw: 200 }],
      fo: 1.4,
      cam: {
        fov: 36,
        hand: 0.06,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'heroT', o: [-7, 1.5, 9] }, l: { a: 'heroT', o: [0, 3, 0] } },
          { t: 5, p: { a: 'heroT', o: [-11, 3, 14] }, l: { a: 'heroT', o: [0, 4, 0] } },
        ],
      },
      ev: [
        { t: 0.2, card: title, s, style: 'logo', dur: 4.2 },
        { t: 0.2, sfx: 'boom1', vol: 0.7, rate: 0.6 },
      ],
    },
    5.2,
  ];
}
// 快切（代價蒙太奇）：每切一記重低音
export function cut(set, grade, mv, line, o = {}) {
  const [s, d] = vista(set, grade, mv, line, { d: o.d || 2.4, ...o });
  s.ev.push(
    { t: 0, sfx: 'boom1', vol: 0.6, rate: 0.5 },
    { t: 0, flash: '#000000', in: 0.01, hold: 0.05, out: 0.15 },
  );
  return [s, d];
}

// ---------- 抉擇演出 ----------
// 選前（在目前的戰場上播，live）：出口的光柱、委託方輪流說話、倒數
// opts：[{ name, sub, color }]（順序＝出口），lines：[[台詞, 說話者], …]
export function choicePre(opts, lines) {
  const T = timeline();
  const live = { k: 'live' };
  let d = 0;
  for (const [, , dd] of lines) d += dd || 3;
  const eo = opts.map((o, i) => ({ ...o, ex: i }));
  // 1. 從主角身後看向出口
  T.add(
    {
      set: live,
      grade: G.freeze,
      ov: 'choice',
      opts: eo,
      cam: {
        fov: 50,
        hand: 0.05,
        ease: 'lin',
        keys: [
          { t: 0, p: { a: 'player', at: 'head', o: [0, 2, 9], loc: true }, l: { ex: 0, o: [0, 3, 0] } },
          {
            t: 3,
            p: { a: 'player', at: 'head', o: [0, 3, 11], loc: true },
            l: { ex: opts.length - 1, o: [0, 3, 0] },
          },
        ],
      },
      ev: [
        { t: 0, sfx: 'alarmBig', vol: 0.4, rate: 0.7 },
        ...opts.map((o, i) => ({ t: 0.2 + i * 0.3, fx: 'pillar', at: { ex: i }, r: 4, color: o.hex })),
        { t: 0.3, card: '抉擇', s: 'DECISION', style: 'name', dur: 2.6 },
      ],
    },
    3,
  );
  // 2. 每個出口一鏡：委託方的台詞（通訊分割＋倒數）
  lines.forEach(([text, who, dd], i) => {
    const ex = Math.min(i, opts.length - 1);
    const dur = dd || 3;
    T.add(
      {
        set: live,
        grade: G.freeze,
        ov: 'choice',
        opts: eo,
        cam: {
          fov: 38,
          hand: 0.08,
          ease: 'lin',
          keys: [
            { t: 0, p: { ex, o: [8, 4, 10] }, l: { ex, o: [0, 4, 0] } },
            { t: dur, p: { ex, o: [5, 3, 7] }, l: { ex, o: [0, 5, 0] } },
          ],
        },
        ev: [
          sub(text, who, 0.2, dur - 0.3),
          { t: 0, sfx: 'thud1', vol: 0.5, rate: 0.5 },
          { t: dur * 0.5, sfx: 'thud2', vol: 0.4, rate: 0.5 },
        ],
      },
      dur,
    );
  });
  return T.def({
    title: '抉擇',
    music: [{ at: 0, track: 'cine_tension', off: 20, vol: 0.85, fadeIn: 0.5, fadeOut: [T.at - 1.2, 1.2] }],
  });
}
// 選後（代價蒙太奇，重建場景）：cuts＝[[組件]]，最後一句接黑畫面
export function choicePost(title, cuts, last) {
  const T = timeline();
  T.add(
    ...black(title, 'DECISION LOGGED', 2.2, 'card', [{ t: 0.1, sfx: 'explodeBig', vol: 0.7, rate: 0.6 }]),
  );
  for (const c of cuts) T.add(...c);
  if (last) T.add(...black(last[0], last[1] || '', 3, 'card'));
  return T.def({
    title,
    music: [{ at: 0, track: 'cine_suspense', off: 43, vol: 1, fadeOut: [T.at - 2, 2] }],
  });
}
