// 第 3 章 冰原之下：開場／章末（docs/cinematics-storyboard.md 第二版：恐怖片）。台詞＝CHAPTER_TEXT[3]
// 幾乎黑白、藍灰、霧很近；配樂幾乎沒有（cine_c3，很小聲），改用低頻嗡聲、呼吸、無線電雜訊（game/cine-c3.js 的 c3amb）；
// 節奏不規則：靜很久，然後突然。專屬手法：監視器錄影、熱感應視角、終端機的檔案。
import { CHAPTER_TEXT, pickLines } from '../story.js';
import { W, parseLine, timeline } from './kit.js';

// 場景
const CAMP = W('snow', { seed: 6301, tod: 'night', variant: 'icefield', clear: 24, anchor: [-30, -28] });
const ICE = W('snow', { seed: 6301, variant: 'icefield', clear: 12, anchor: [-33, -31] });
const STORM = W('snow', { seed: 6305, variant: 'blizzard', clear: 30 });
const LAB = W('institute', { seed: 6302, variant: 'core', clear: 34 });
const DARK = W('institute', { seed: 6304, variant: 'blackout', clear: 24 });

// 調色：幾乎黑白、藍灰、霧很近（約 20 m）
const HG = {
  sat: 0.14,
  temp: -0.3,
  contrast: 1.22,
  tintLo: '#18242f',
  tintLoK: 0.5,
  tintHi: '#c8d2da',
  tintHiK: 0.15,
  exposure: 0.85,
  grain: 0.34,
  vignette: 0.62,
  bloom: 0.5,
  chroma: 0.1,
  fogK: 0.3,
  fogColor: '#8c98a2',
  fogColorK: 0.55,
  dust: 0.5,
  sunEl: 18,
  sunK: 0.35,
  hemiK: 1.15,
  mblurK: 0.07,
  mblurMech: 0.8,
};
// 監視器：黑白、粗粒子
const CCTV = {
  sat: 0,
  contrast: 1.35,
  exposure: 1.25,
  grain: 0.6,
  vignette: 0.55,
  bloom: 0.25,
  chroma: 0.3,
  mblur: false,
  fogK: 0.9,
  fogColor: '#5a6066',
  fogColorK: 0.5,
  dust: 0,
};
// 熱感應：冷的場景（深紫）＋熱色盤的機體；霧是黑紫色
const THERM = {
  sat: 1.1,
  temp: 0,
  contrast: 1.1,
  tintLoK: 0,
  tintHiK: 0,
  exposure: 1,
  bloom: 1.3,
  grain: 0.4,
  vignette: 0.5,
  chroma: 0.2,
  fogK: 0.55,
  fogColor: '#0c0618',
  fogColorK: 1,
  sky: 'grad',
  skyTop: '#05020c',
  dust: 0,
  hfog: 0,
  ssao: 0,
  hull: 0,
  ink: 0,
  mblur: false,
};
// 白茫茫的暴風雪（章名）
const WHITE = {
  ...HG,
  sat: 0.05,
  exposure: 1.15,
  contrast: 0.95,
  fogK: 0.09,
  fogColor: '#dfe5ea',
  fogColorK: 0.9,
};
// 研究所：冷的螢光燈
const LABG = {
  ...HG,
  sat: 0.1,
  temp: -0.2,
  fogK: 0.6,
  fogColor: '#0a0d10',
  fogColorK: 0.8,
  bloom: 0.9,
  dust: 0.3,
};

const sub = (line, t, dur, who) => {
  const L = parseLine(line);
  return { t, sub: L.text, who: who || L.who, dur };
};
// 每個鏡頭都疊上細的雜訊（c3grain）
function grainy(T, o) {
  const d = T.def(o);
  for (const s of d.shots) s.ov = [].concat(s.ov || [], 'c3grain');
  return d;
}
// 恐怖片的聲音：drone＝低頻嗡聲、breath＝呼吸、hiss＝無線電嘶聲
const amb = (drone, breath = 0, hiss = 0) => ({ drone, breath, hiss });

export function ch3Intro() {
  const L = pickLines(CHAPTER_TEXT[3].intro);
  const T = timeline();
  // 0. 黑畫面：只有低頻與遠處的聲音
  T.add(
    {
      set: { k: 'black' },
      hook: 'c3amb',
      amb: amb(0.5),
      ev: [{ t: 0.2, sfx: 'distant', vol: 0.5, rate: 0.4 }, sub(L[0], 0.9, 3.4)],
    },
    4.6,
  );
  // 1. 難民營的監視器錄影：帳篷被雪埋了一半；右下的人影，一跳格就不見了
  T.add(
    {
      set: CAMP,
      grade: CCTV,
      lb: false,
      hook: ['c3amb', 'c3cctv'],
      render: 'c3cctv',
      ov: 'c3cctv',
      amb: amb(0.35, 0, 0.12),
      cctv: {
        fps: 7,
        cam: 'CAM 03',
        place: '第 7 營地　北側',
        org: 'SANCTA MUTUAL AID',
        date: '0118-02-14',
        t0: 11564,
        tents: [
          [-3, -3, 20, 1],
          [3, -6, -15, 1.1],
          [-7, 2, 70, 0.9],
          [1.5, 1, 5, 1],
          [-1, -10, 40, 1.2],
        ],
        lamp: [-2.2, -0.5],
        vanish: 6.4,
        glitch: [
          [3.1, 0.12],
          [6.25, 0.18],
        ],
        lost: 10,
      },
      // 人物（第三版分鏡）：右下的人影跳格後不見了；燈旁坐著兩個人
      actors: [
        {
          id: 'cp',
          k: 'human',
          who: 'hooded',
          p: [6.2, -0.4],
          yaw: 40,
          anim: 'Idle_Neutral',
          s: [{ t: 6.4, hide: true }],
        },
        {
          id: 'cs',
          k: 'people',
          who: ['hooded', 'man', 'woman'],
          n: 3,
          p: [-2.6, 0.6],
          r: 0.7,
          anim: 'Sitting',
          s: [{ t: 0, face: [-2.2, -0.5] }],
          seed: 41,
        },
      ],
      cam: { fov: 52, hand: 0, snap: true, keys: [{ t: 0, p: [14, 9, 16], l: [0, 0, 0] }] },
      ev: [
        sub(L[1], 0.5, 5.4),
        { t: 3.1, sfx: 'glitch', vol: 0.3, rate: 0.7 },
        { t: 6.25, sfx: 'glitch', vol: 0.5, rate: 0.5 },
        { t: 10, sfx: 'uiErr', vol: 0.3, rate: 0.5 },
      ],
    },
    11,
  );
  // 2. 諾拉的通訊：雜訊很重、斷斷續續
  T.add(
    {
      set: { k: 'black' },
      hook: ['c3amb', 'c3radio'],
      ov: 'c3radio',
      amb: amb(0.3, 0, 0.45),
      radio: { name: '聖域互助同盟　協調人 諾拉', freq: '7.310 MHz' },
      drops: [
        [2.5, 0.4],
        [5.6, 0.3],
      ],
      ev: [
        { t: 0.1, sfx: 'glitch', vol: 0.4, rate: 0.6 },
        sub('……這裡是聖域互助同盟……協調人，諾拉。……營地，三天沒有回訊。', 0.4, 2.1, 'sancta'),
        sub('我知道你是誰。讓那些人走進冰原的……就是你。', 3.0, 2.5, 'sancta'),
        sub(L[2], 5.9, 2.3),
      ],
    },
    8.4,
  );
  // 3. 暴風雪中前進：手持晃動；畫面邊緣有白色的東西一閃而過
  T.add(
    {
      set: STORM,
      grade: HG,
      hook: 'c3amb',
      amb: amb(0.45, 0.55),
      actors: [
        {
          id: 'h',
          k: 'hero',
          p: [0, 6],
          yaw: 0,
          s: [
            { t: 0, go: [0, -6] },
            { t: 2.6, go: [0, -14] },
          ],
        },
        {
          id: 'wo',
          k: 'ace',
          key: 'whiteout',
          p: [-8, -22],
          yaw: 90,
          s: [
            { t: 0, hide: true },
            { t: 5.0, hide: false, qb: [-1, -0.2] },
            { t: 5.85, hide: true },
          ],
        },
      ],
      cam: {
        fov: 40,
        hand: 0.4,
        follow: 6,
        keys: [
          {
            t: 0,
            p: { a: 'h', at: 'head', o: [3.4, 0.2, 9] },
            l: { a: 'h', at: 'head', o: [-2.5, -1, -12] },
          },
          {
            t: 8.6,
            p: { a: 'h', at: 'head', o: [3, 0.1, 7.6] },
            l: { a: 'h', at: 'head', o: [-4, -1, -12] },
          },
        ],
      },
      ev: [
        sub('……我還是付了錢。這片冰原上，沒有別人能去。', 0.6, 3.6, 'sancta'),
        { t: 4.9, sfx: 'boostDown', vol: 0.35, rate: 0.6, at: { a: 'wo' } },
        { t: 6.4, a: 'h', aim: [-20, 3, -14] },
        { t: 6.6, sfx: 'stepSnow1', vol: 0.6, rate: 0.7 },
      ],
    },
    8.6,
  );
  // 4. 冰面下，巨大的黑影游過（不露臉）＋冰裂聲
  T.add(
    {
      set: ICE,
      grade: { ...HG, fogK: 0.42, exposure: 0.95, sunK: 0.12, hemiK: 1.4 },
      hook: ['c3amb', 'c3shadow'],
      amb: amb(0.75, 0.3),
      shadow: { from: [30, 10], to: [-36, -6], t0: 0.6, t1: 6.2, n: 30, w: 11, gap: 2.2, amp: 2.4, op: 0.65 },
      actors: [
        {
          id: 'hi',
          k: 'hero',
          p: [0, 2],
          yaw: 160,
          s: [
            { t: 0, go: [3, -8] },
            { t: 2.2, stop: true },
          ],
        },
      ],
      cam: {
        fov: 44,
        hand: 0.08,
        ease: 'lin',
        keys: [
          { t: 0, p: [4, 24, 16], l: [0, 0, -1] },
          { t: 7.4, p: [3, 22, 13], l: [0, 0, -2] },
        ],
      },
      ev: [
        { t: 0.4, sfx: 'rock1', vol: 0.9, rate: 0.3 },
        { t: 2.6, sfx: 'glass', vol: 0.6, rate: 0.45 },
        { t: 2.6, shake: 0.18 },
        { t: 3.6, sfx: 'crunch2', vol: 0.6, rate: 0.4 },
        { t: 4.4, sfx: 'rock2', vol: 0.7, rate: 0.28 },
      ],
    },
    7.4,
  );
  // 5. 靜止：主角四下張望，身後什麼都看不到
  const still = {
    fov: 32,
    hand: 0.12,
    keys: [
      {
        t: 0,
        p: { a: 'hs', at: 'head', o: [-3.6, -0.8, -13] },
        l: { a: 'hs', at: 'head', o: [-0.6, -1.2, 3] },
      },
      {
        t: 6,
        p: { a: 'hs', at: 'head', o: [-3.2, -0.8, -11.5] },
        l: { a: 'hs', at: 'head', o: [-0.6, -1.2, 3] },
      },
    ],
  };
  T.add(
    {
      set: STORM,
      grade: HG,
      hook: 'c3amb',
      amb: amb(0.6, 0.85),
      actors: [
        {
          id: 'hs',
          k: 'hero',
          p: [0, 0],
          yaw: 0,
          s: [
            { t: 0.4, aim: [-14, 3, -12] },
            { t: 1.8, aim: [14, 3, -10] },
          ],
        },
        { id: 'wo', k: 'ace', key: 'whiteout', p: [-2.6, 9], yaw: 0, s: [{ t: 0, hide: true, aim: 'hs' }] },
        // 縮在暴風雪裡的難民：WHITEOUT 是從這裡出來的
        {
          id: 'hud',
          k: 'people',
          who: ['hooded', 'hooded', 'man', 'woman', 'womanc'],
          n: 9,
          p: [3, 36],
          r: 1.6,
          anim: ['Sitting', 'Idle', 'Idle_Neutral'],
          s: [{ t: 0, face: [3, 36] }],
          seed: 43,
        },
      ],
      cam: still,
      ev: [{ t: 1.2, sfx: 'stepSnow2', vol: 0.4, rate: 0.6 }],
    },
    3.6,
  );
  // 6. 熱感應：同一個鏡頭，切成熱感應才看到 WHITEOUT 就站在主角身後 → 打擊
  T.add(
    {
      set: STORM,
      grade: THERM,
      keep: true,
      hook: ['c3amb', 'c3thermal'],
      ov: 'c3thermal',
      amb: amb(0.85, 0.9),
      thermal: { tag: 'wo', tagT: 0.7 },
      cam: { ...still, keys: still.keys.map((k) => ({ ...k, t: k.t - 3.6 })) },
      ev: [
        { t: 0, sfx: 'uiOpen', vol: 0.35, rate: 0.6 },
        { t: 0, a: 'wo', hide: false },
        { t: 1.9, a: 'wo', aim: 'hs' },
        { t: 2.3, sfx: 'heavy', vol: 1, rate: 0.5 },
        { t: 2.3, sfx: 'boom1', vol: 0.9, rate: 0.35 },
        { t: 2.3, sfx: 'glitch', vol: 0.6, rate: 0.4 },
        { t: 2.3, shake: 0.5 },
        { t: 2.3, flash: '#ffffff', in: 0.02, hold: 0.04, out: 0.25 },
      ],
    },
    2.9,
  );
  // 7. 對射：WHITEOUT 現形開火，主角轉身還擊（快切）
  T.add(
    {
      set: STORM,
      grade: { ...HG, contrast: 1.3, chroma: 0.25, exposure: 0.95 },
      keep: true,
      hook: 'c3amb',
      amb: amb(0.5, 0.4),
      cam: {
        fov: 46,
        hand: 0.5,
        follow: 10,
        keys: [
          // 主角的肩後（WHITEOUT 在 +Z 那一側）
          { t: 0, p: { a: 'hs', at: 'head', o: [5.6, 0.5, -2.6] }, l: { a: 'wo', at: 'head' }, roll: -6 },
          { t: 2.6, p: { a: 'hs', at: 'head', o: [6.4, 0.8, -3.4] }, l: { a: 'wo', at: 'head' }, roll: 4 },
        ],
      },
      ev: [
        { t: 0, a: 'wo', fire: ['rarm', 'larm'], dur: 2.4, at: 'hs' },
        { t: 0, a: 'hs', aim: 'wo' },
        { t: 0.6, a: 'hs', fire: ['rarm', 'larm'], dur: 2, at: 'wo' },
        { t: 1.1, sfx: 'hit2', vol: 0.8, rate: 0.7 },
        { t: 1.6, fx: 'flash', at: { a: 'wo', at: 'head' }, r: 1.6, color: 0xffffff },
        sub('WHITEOUT：「營地的人是我在守。你來，是要拿走什麼？」', 0.3, 4.6),
      ],
    },
    2.6,
  );
  T.add(
    {
      set: STORM,
      grade: { ...HG, contrast: 1.3, chroma: 0.25, exposure: 0.95 },
      keep: true,
      hook: 'c3amb',
      amb: amb(0.5, 0.3),
      cam: {
        fov: 38,
        hand: 0.45,
        follow: 10,
        keys: [
          // 反打：WHITEOUT 的肩後
          { t: 0, p: { a: 'wo', at: 'head', o: [-1.6, 0.3, 4] }, l: { a: 'hs', at: 'head' } },
          { t: 2.8, p: { a: 'wo', at: 'head', o: [-2.2, 0.6, 5] }, l: { a: 'hs', at: 'head' } },
        ],
      },
      ev: [
        { t: 0.6, boom: { a: 'wo', o: [0.8, 1.5, 0.8] }, r: 1.3 },
        { t: 0.65, a: 'wo', qb: [-1, 0.5] },
        { t: 0.7, fx: 'dust', at: { a: 'wo' }, r: 8, n: 40, color: 0xe8eef2 },
        { t: 1.1, a: 'wo', hide: true },
        { t: 1.1, fx: 'smoke', at: { a: 'wo' }, r: 3, color: 0xdfe6ea },
        { t: 1.1, a: 'hs', stop: true },
      ],
    },
    2.8,
  );
  // 8. 章名被雪慢慢蓋住：主角走進白茫茫的冰湖裡
  T.add(
    {
      set: ICE,
      grade: WHITE,
      hook: 'c3amb',
      ov: 'c3title',
      amb: amb(0.3),
      title: { main: '冰原之下', sub: 'CHAPTER III', t0: 0.6, t1: 2.4, t2: 7 },
      actors: [{ id: 'ht', k: 'hero', p: [0, -3], yaw: 0, s: [{ t: 4.8, go: [0, -70] }] }],
      fo: 1.2,
      cam: {
        fov: 40,
        hand: 0.1,
        ease: 'lin',
        keys: [
          { t: 0, p: { g: [1, 7], h: 2.6 }, l: { g: [0, -14], h: 2.4 } },
          { t: 8.4, p: { g: [1, 6], h: 2.6 }, l: { g: [0, -16], h: 2.4 } },
        ],
      },
      ev: [{ t: 0.6, sfx: 'thud2', vol: 0.5, rate: 0.4 }],
    },
    8.4,
  );
  return grainy(T, {
    title: '第三章　開場',
    music: [{ at: 0, track: 'cine_c3', vol: 0.35, fadeIn: 3, fadeOut: [T.at - 3, 3] }],
  });
}

export function ch3Outro(ctx = {}) {
  const L = pickLines(CHAPTER_TEXT[3].outro, ctx.choices || {});
  const c2 = (ctx.choices && ctx.choices.c2) || 'castron';
  const T = timeline();
  // 0. 研究所的燈一盞一盞往鏡頭方向熄滅
  T.add(
    {
      set: LAB,
      grade: LABG,
      hook: ['c3amb', 'c3lamps'],
      amb: amb(0.45),
      lamps: { xs: [-5.5, 5.5], y: 7, z0: -64, z1: -6, n: 8, t0: 2.2, step: 0.85, exp0: 0.75 },
      actors: [
        {
          id: 'rs',
          k: 'people',
          who: ['suitw', 'mansuit'],
          n: 3,
          p: [0, -12],
          box: [5, 2],
          go: [0, -20],
          stagger: 1.2,
          yaw: 180,
          tint: { Black: 0xd8dce0, Shirt: 0xd8dce0 },
          seed: 47,
        },
      ],
      cam: {
        fov: 44,
        hand: 0.05,
        ease: 'lin',
        keys: [
          { t: 0, p: [0, 2.4, 6], l: [0, 3.2, -40] },
          { t: 10, p: [0, 2.4, 3.5], l: [0, 3.2, -40] },
        ],
      },
      ev: [sub(L[0], 0.6, 3.6)],
    },
    10,
  );
  // 1. 終端機的檔案：打字、塗黑、週期數字瘋狂跳動、資料毀損
  const core =
    c2 === 'aetheric'
      ? '核心 .............. 重新啟動　機體認證：R-07　✓'
      : '核心資料 .......... 已銷毀　執行者：R-07';
  T.add(
    {
      set: { k: 'black' },
      hook: ['c3amb', 'c3term'],
      ov: 'c3term',
      amb: amb(0.4),
      term: {
        glitch: 22.6,
        end: 26.2,
        lines: [
          { t: 0.2, s: 'AETHERIC INSTITUTE // CORE ARCHIVE　終端 07', dim: true, cps: 60 },
          { t: 1.1, s: '> open /core/subjects/key', cps: 26 },
          // 塗黑：red 是要蓋掉的字（打出來的同時就蓋上）
          { t: 2.3, s: '檔案名稱 .......... PROJECT XXXXXXXXX', red: ['XXXXXXXXX'], redT: 2.3 },
          {
            t: 3.2,
            s: '受試者 ............ KEY-XX　XXXXXX XXXXXXXX',
            red: ['XX　XXXXXX XXXXXXXX'],
            redT: 3.2,
          },
          { t: 4.4, s: '狀態 .............. 運作中' },
          { t: 5.3, s: '週期 .............. {N}', spin: [5.9, 10.6], cps: 60 },
          { t: 11.2, s: '> trace /broadcast/orbital', cps: 26 },
          { t: 12.2, s: '軌道站座標 ........ 81.4N 012.0E　高度 36,000 km' },
          { t: 14.4, s: '收件人 卡斯特隆 ... 已讀　——　無回應', dim: true },
          { t: 15.3, s: '收件人 艾瑟立克 ... 已讀　——　無回應', dim: true },
          { t: 17.6, s: '收件人 維爾威 ..... 運輸機群　→ 北' },
          { t: 18.5, s: '收件人 聖域 ....... 營地遷移　→ 北' },
          { t: 20.2, s: core, warn: true },
        ],
      },
      ev: [
        sub(L[1], 2.2, 3.8),
        sub(L[2], 6.4, 4.8),
        sub(L[3], 11.6, 2.8),
        sub(L[4], 14.6, 2.8),
        sub(L[5], 17.6, 4.6),
        sub(L[6], 22.8, 3.4),
        { t: 22.6, sfx: 'glitch', vol: 0.6, rate: 0.5 },
        { t: 25.9, sfx: 'uiErr', vol: 0.4, rate: 0.4 },
      ],
    },
    27,
  );
  // 2. 黑暗中，SPECIMEN 的紅色眼燈亮起（台詞依抉擇 1）
  const spLine =
    c2 === 'aetheric'
      ? '核心讀了你的資料。它認得你。……為什麼被選上的是你？'
      : '你把核心毀了。……可是我還記得。為什麼被選上的是你？';
  T.add(
    {
      set: DARK,
      grade: { ...LABG, sat: 0.9, exposure: 0.35, hemiK: 0.25, sunK: 0.1, bloom: 1.4, fogK: 0.35 },
      hook: ['c3amb', 'c3eyes'],
      amb: amb(0.7, 0),
      eyes: { a: 'sp', t: 1.1 },
      actors: [
        {
          id: 'sp',
          k: 'ace',
          key: 'specimen',
          p: [0, -4],
          yaw: 0,
          s: [
            { t: 0, crouch: true },
            { t: 2.2, crouch: false, rise: 2.6 },
          ],
        },
      ],
      fo: 2.4,
      cam: {
        fov: 30,
        hand: 0.06,
        ease: 'lin',
        keys: [
          // 蹲著時頭比站姿低約 3 m：先看低處，站起來時跟著往上
          { t: 0, p: { a: 'sp', o: [0.8, 1.2, -9] }, l: { a: 'sp', at: 'head', o: [0, -3, 0] } },
          { t: 2.2, p: { a: 'sp', o: [0.8, 1.2, -8.6] }, l: { a: 'sp', at: 'head', o: [0, -2.8, 0] } },
          { t: 5, p: { a: 'sp', o: [0.6, 2, -7.2] }, l: { a: 'sp', at: 'head', o: [0, -0.5, 0] } },
          { t: 9.6, p: { a: 'sp', o: [0.5, 2.2, -6.2] }, l: { a: 'sp', at: 'head', o: [0, -0.3, 0] } },
        ],
      },
      ev: [
        { t: 1.1, sfx: 'heavy', vol: 0.6, rate: 0.4 },
        { t: 2.3, sfx: 'stagger', vol: 0.4, rate: 0.5 },
        { t: 3.0, sub: spLine, who: 'specimen', dur: 3.4 },
        sub(L[7], 6.6, 2.8),
      ],
    },
    9.6,
  );
  return grainy(T, {
    title: '第三章　章末',
    music: [{ at: 0, track: 'cine_c3', off: 30, vol: 0.3, fadeIn: 3, fadeOut: [T.at - 3, 3] }],
  });
}
