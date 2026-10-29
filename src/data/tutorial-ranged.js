// 遠程訓練課程（作戰室的模擬艙，docs/ranged-tutorial.md）：課程、練習、示範腳本。純資料與純函式，可以在 node 載入。
// 框架和近戰訓練共用（data/tutorial.js 的欄位、game/tutorial.js 的流程）；遠程專用的假人、腳本、時機條在 game/tutorial-ranged.js。
//
// 和近戰不同的欄位：
//   課程：course 'r'、pick 開始前挑主武器（RT_WEAPONS；否則用 kit）、kit 固定組合 { rarm, larm, rback, lback }、skippable 可以直接跳過（不給獎勵）
//   dummy  { type 敵人類型（ENEMY_TYPES）, lv 0 靜止／1 走動, dist 開始距離（m，新尺度）, n 幾台（排成扇形）, far 理想射程外（ideal 練習）}
//   setup  { fcs 換火控（理想射程的練習要長距離的鎖定）}
//   ring   'ideal'＝假人腳下畫主武器的理想射程（圈裡＝理想射程內）
//   goal 的 distinct(o)＝回傳這一次的種類（字串或陣列），只有新的種類才算
// 說明文字的記號：[fire] [fire2] [lock]＝依裝置的按鍵（其他同近戰）
// 示範腳本（近戰的指令都能用，另外）：
//   ['fire', 秒]  按住主武器開火      ['tap']  等武器能開火時按一下      ['lock']  換鎖定目標
//   ['empty']  按住開火直到開始換彈再放開      ['arTap', 'ok'｜'bad']  換彈中在亮區（ok）或太早（bad）按一下
//   ['approach', 倍率]  走到離假人「理想射程 × 倍率」以內      ['orbit', 秒]  繞著假人橫移，環滿了就一直按一下開火
//   ['wait', 'apex']  到了最高點的前後（其他條件同近戰）
import { RB_APEX, RB_CTR, RB_LAND, RB_ORBIT, RB_QB } from './ranged.js';

// 第 1～2 課可以挑的主武器
export const RT_WEAPONS = ['w_rifle', 'w_hg', 'w_sg', 'w_bz', 'w_mg'];
// 結業時可以選一把免費拿的
export const RT_PRIZES = ['w_lsg', 'w_lc', 'w_gl'];
export const RT_PRIZE_COAM = 20000;

// 邊閃邊打的加成（位元 → 標籤名稱，goal 的 tag 用）
export const RB_TAG = [
  [RB_QB, 'qb'],
  [RB_CTR, 'ctr'],
  [RB_APEX, 'apex'],
  [RB_LAND, 'land'],
  [RB_ORBIT, 'orbit'],
];
export const rbTags = (mask) => new Set(RB_TAG.filter(([b]) => mask & b).map(([, t]) => t));
export const RB_NAME = { qb: 'QB 射擊', ctr: '反擊', apex: '頂點射擊', land: '落地反擊', orbit: '繞射' };

export const R_LESSONS = [
  {
    id: 'R1',
    course: 'r',
    n: '基本射擊',
    d: '鎖定與換目標、理想射程、命中標記、主動裝填',
    coam: 2000,
    pick: true,
    skippable: true,
    steps: [
      {
        id: 'fire',
        t: '開火與命中標記',
        text: '機體會自動鎖定前方攻擊距離內的敵人（目標上的框）。按住 [fire] 開火，打中時準星上出現<b>命中標記</b>、聽到確認音。',
        say: '先打中再說。看準星：打中會有標記。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        goal: [{ ev: 'shot', n: 3, lbl: '打中' }],
        demo: [['fire', 1], ['wait', 0.6], ['end']],
        hints: ['按住 [fire]。子彈會自動瞄準鎖定的目標。'],
      },
      {
        id: 'lock',
        t: '換鎖定目標',
        text: '有好幾台敵人時，按 [lock] 依序換下一個目標（近的先）。換目標、每一台都打中一次。',
        say: '別只盯著一台。想打誰，就先鎖誰。',
        dummy: { type: 'mt', lv: 0, dist: 45, n: 3 },
        goal: [
          { ev: 'lockSw', n: 2, lbl: '換目標' },
          { ev: 'shot', n: 3, distinct: (o) => String(o.tgt.id), lbl: '打中不同的目標' },
        ],
        demo: [
          ['fire', 0.5],
          ['wait', 0.4],
          ['lock'],
          ['wait', 0.3],
          ['fire', 0.5],
          ['wait', 0.4],
          ['lock'],
          ['wait', 0.3],
          ['fire', 0.5],
          ['wait', 0.5],
          ['end'],
        ],
        hints: ['按 [lock]：鎖定框會跳到下一台。', '換好目標再開火，每一台都要打中。'],
        touch: '觸控：點一下畫面上的敵人就鎖定它。',
      },
      {
        id: 'ideal',
        t: '理想射程',
        text: '實彈武器有<b>理想射程</b>（假人腳下的圈：你站進圈裡＝在理想射程內）。圈外打中傷害會變小，越遠越小。先在圈外打中一次，再走進圈裡打中 2 次，比較傷害數字。',
        say: '子彈飛得越遠越沒力。站對距離。',
        tip: '這一步換上長距離火控，遠一點也鎖得到。',
        dummy: { type: 'mt', lv: 0, far: true },
        setup: { fcs: 'f_snipe' },
        ring: 'ideal',
        goal: [
          { ev: 'shot', n: 1, test: (o) => o.out, lbl: '圈外' },
          { ev: 'shot', n: 2, test: (o) => !o.out, lbl: '圈內' },
        ],
        demo: [['tap'], ['wait', 0.8], ['approach', 0.7], ['fire', 0.8], ['wait', 0.6], ['end']],
        hints: ['先在原地開火，再往假人走、進了圈再打。'],
        skip: (d) =>
          d.ideal ? '' : `${d.name || '這把武器'}是爆發屬性：沒有理想射程，遠近傷害一樣。這一步跳過。`,
      },
      {
        id: 'ar',
        t: '主動裝填',
        text: '彈匣打空會自動換彈。換彈中武器欄下方出現<b>亮區</b>：在亮區按 [fire]＝瞬間裝填，下一個彈匣傷害 ×1.15；太早或太晚按＝卡彈。成功 2 次，再故意卡彈一次看看。',
        say: '換彈不是發呆的時間。抓準了就馬上回到戰鬥。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        bar: 'ar',
        goal: [
          { ev: 'ar', n: 2, test: (o) => o.ok, lbl: '瞬間裝填' },
          { ev: 'ar', n: 1, test: (o) => !o.ok, lbl: '卡彈' },
        ],
        demo: [
          ['empty'],
          ['arTap', 'ok'],
          ['wait', 0.6],
          ['empty'],
          ['arTap', 'ok'],
          ['wait', 0.6],
          ['empty'],
          ['arTap', 'bad'],
          ['wait', 1.2],
          ['end'],
        ],
        hints: [
          '打空彈匣後先放開 [fire]，等時機條走進綠色再按一下。',
          '一直按著不算：要放開再按。每次換彈只有一次機會。',
        ],
        skip: (d, g) =>
          g.ctrl.activeReload === 'off' ? '設定裡的「主動裝填」關掉了：這一步跳過（可以在設定打開）。' : '',
      },
    ],
  },
  {
    id: 'R2',
    course: 'r',
    n: '邊閃邊打',
    d: '射擊的那一刻機體在做什麼，決定這一發的效果',
    coam: 3000,
    pick: true,
    steps: [
      {
        id: 'qbshot',
        t: 'QB 射擊',
        text: '按 [qb] 之後 <b>0.35 秒內</b>開火＝QB 射擊（衝擊 ×1.4）。打中時目標上方出現「QB SHOT」。',
        say: '閃開的同時就開火。不要等站穩。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        bar: 'qb',
        goal: [{ ev: 'rb', tag: 'qb', n: 3, lbl: 'QB 射擊' }],
        demo: [['qb', 's'], ['wait', 0.06], ['tap'], ['wait', 0.9], ['end']],
        hints: ['[qb] → 馬上 [fire]。', '0.35 秒很短：QB 按下去就開火。'],
      },
      {
        id: 'apex',
        t: '頂點射擊',
        text: '按 [jump] 跳起來，在<b>最高點的前後</b>開火＝頂點射擊（擴散 ×0.5、衝擊 ×1.3）。',
        say: '跳到最高的那一下，槍最穩。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        bar: 'apex',
        goal: [{ ev: 'rb', tag: 'apex', n: 3, lbl: '頂點射擊' }],
        demo: [
          ['jump', 0.2],
          ['wait', 'air'],
          ['wait', 'apex'],
          ['tap'],
          ['wait', 'ground'],
          ['wait', 0.5],
          ['end'],
        ],
        hints: ['跳起來，看時機條走到綠色再開火。', '太早：還在往上衝；太晚：已經掉下來了。'],
      },
      {
        id: 'land',
        t: '落地反擊',
        text: '在空中待 0.35 秒以上，<b>落地後 0.5 秒內</b>的第一輪射擊＝落地反擊（衝擊 ×1.4）。',
        say: '落地的瞬間就還手，對手最想不到。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        bar: 'land',
        goal: [{ ev: 'rb', tag: 'land', n: 3, lbl: '落地反擊' }],
        demo: [['jump', 0.2], ['wait', 'air'], ['wait', 'ground'], ['tap'], ['wait', 0.9], ['end']],
        hints: ['跳起來，腳一碰地就開火。', '在空中開火不算：等落地。'],
      },
      {
        id: 'orbit',
        t: '繞射',
        text: '鎖定目標時繞著它<b>橫向</b>快速移動，目標周圍的青色環會累積，滿了＝ORBIT（擴散 ×0.5、判定加大）。按住 [move] 往左或右繞，環滿了再開火。',
        say: '繞著它跑，一直打。站著不動的傭兵活不久。',
        dummy: { type: 'mt', lv: 0, dist: 45 },
        bar: 'orbit',
        goal: [{ ev: 'rb', tag: 'orbit', n: 3, lbl: '繞射' }],
        demo: [['orbit', 3.2], ['end']],
        hints: ['左右移動，和目標的方向保持垂直。', '速度不夠快、或往目標靠近不算：保持距離、一直橫著跑。'],
      },
      {
        id: 'mix',
        t: '驗收：走動的目標',
        text: '假人會走動。打出 <b>3 種不同</b>的加成（QB 射擊、頂點射擊、落地反擊、繞射，一發有兩種也算）。',
        say: '把剛才的全部混著用。',
        dummy: { type: 'mt', lv: 1, dist: 45 },
        goal: [{ ev: 'rb', n: 3, distinct: (o) => [...o.tags], lbl: '加成的種類' }],
        demo: [
          ['qb', 's'],
          ['wait', 0.06],
          ['tap'],
          ['wait', 0.6],
          ['jump', 0.2],
          ['wait', 'air'],
          ['wait', 'apex'],
          ['tap'],
          ['wait', 'ground'],
          ['tap'],
          ['wait', 0.9],
          ['end'],
        ],
        hints: ['QB → 開火、跳起來 → 最高點開火、落地 → 開火，換著來。'],
      },
    ],
  },
];
