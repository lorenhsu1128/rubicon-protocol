// 近戰訓練課程（作戰室的模擬艙，docs/melee-tutorial.md）：課程、練習、假人的等級、示範腳本。純資料與純函式，可以在 node 載入。
// 遊戲端在 game/tutorial.js（教學的流程、判定、假人的行為、畫面）。
//
// 練習（step）的欄位：
//   id、t 標題、text 說明（記號見下方）、say 教官的一句話（通訊框）、tip 補充說明（灰字）
//   dummy  假人：{ lv 等級（TUT_LV）, dist 開始距離（舊尺度 m，×DS）, lunge 依武器的突進距離的倍數（突進追擊）, stag 開始時就失衡, kill 可以擊破（擊破後重生）,
//          atk 'melee'｜'shot'｜'mix'（等級 3、4 出招的種類）, every [最短, 最長] 秒（等級 4 出招的間隔）, stab 失衡門檻的倍率 }
//   setup  { en 開始時 EN 的比例（同時停止補 EN）, shield 裝上脈衝盾, swap 左手換成第二把近戰武器 }
//   goal   [{ ev 事件, tag 招式標籤, n 次數, hit 招式要打中, test(e, T) 額外條件, lbl 進度的名稱 }]（全部達成＝過關）
//          特殊：{ quiz: n }＝依序打出指定的方向起手；{ exam: 秒 }＝結業考核的技巧收集
//   bar    時機條：'queue'｜'link'｜'resume'｜'parry'｜'pqb'｜'bash'｜'exec'
//   dir    'f'｜'s'｜'b'：畫面上畫方向箭頭
//   reset  每次成功後把兩台放回開始位置
//   demo   示範腳本（也是冒煙測試的自動操作）；auto 自動操作另外寫的腳本
//   hints  [第 1 段提示, 失敗 3 次後更具體的提示]
//   touch  只在觸控時多顯示的一句（觸控的攻擊鍵會依距離自動切換射擊與斬擊）
//   skip(d, g) 回傳說明文字＝這把武器（或這個裝置）跳過這一步；opt 選修（可以直接跳過）
// 說明文字的記號：[melee] [shot] [qb] [jump] [ab] [move]＝依裝置的按鍵（移動＝WASD／左搖桿）；[f] [s] [b]＝方向；{標籤}＝這把武器的招式名稱；{w}＝武器名稱
//
// 示範腳本：陣列，每一項 [指令, 參數…]
//   ['near', 距離倍率]  朝假人移動到近戰距離×倍率以內        ['dir', 方向, 秒]  只按方向
//   ['press', 方向, 槽位]  按一下近戰（方向 ''／f／s／b）    ['chain', 方向]  連段中每到可以接招就按，直到這一招之後沒有下一招
//   ['wait', 條件或秒]  條件：queue 可以接招、half 過一半且打中、hit 打中、idle 收招、air 離地、ground 著地、
//                        stag 假人失衡、tele 假人預警中、parry 彈刀的時機、pqb 完美 QB 的時機、shield 盾擋下攻擊
//   ['qb', 方向]  QB      ['jump', 秒]  按住跳躍      ['ab', 秒]  按住突擊推進（之後的 press 在推進中）
//   ['hold', 秒]  按住近戰（處決）      ['shot', 次數]  另一隻手開槍       ['shootStag']  開槍直到假人失衡
//   ['end']  腳本結束（自動操作時從頭再來）

// 可以選的近戰武器（w_none＝空手的拳擊）
export const TUT_WEAPONS = ['w_blade', 'w_saber', 'w_claw', 'w_pile', 'w_none'];
// 結業時可以選一把免費拿的
export const TUT_PRIZES = ['w_blade', 'w_claw', 'w_pile'];
export const TUT_PRIZE_COAM = 20000; // 三把都有了：改給 COAM

// 假人的等級
export const TUT_LV = [
  { n: '靜止', d: '站著不動、不還手' },
  { n: '走動', d: '慢慢走動、繞圈，不還手' },
  { n: '閃避', d: '會走動，你靠近時偶爾 QB 拉開距離' },
  { n: '反擊', d: '連段打完、你停手時會反擊一下（有預警）' },
  { n: '進攻', d: '主動出招：揮刀或開槍（有預警）' },
];

// 結業考核收集的技巧：[標籤, 名稱]
export const EXAM_KINDS = [
  ['cEnd', '完整連段'],
  ['f', '前派生'],
  ['s', '側派生'],
  ['b', '上挑'],
  ['jc', '跳躍取消'],
  ['airEnd', '空中連段'],
  ['dash', '衝刺斬'],
  ['resume', 'QB 接回'],
  ['lunge', '突進追擊'],
  ['link', '近戰接射擊'],
  ['exec', '處決'],
  ['parry', '彈刀'],
  ['pqb', '完美 QB'],
  ['bash', '盾擊'],
];
export const EXAM_STARS = [4, 7, 10]; // 幾種技巧＝★1／★2／★3

// ---------- 招式的標籤（依武器的招式圖）----------
// c0、c1…＝預設連段的第幾招，combo＝預設連段，cEnd＝預設連段的最後一招；f／s／b＝方向起手的路線（f1、f2…＝路線的第幾招，
// fEnd＝路線的最後一招）；air／airEnd＝空中連段；dive 下劈；dash 衝刺斬；exec 處決；bash 盾擊；fin 終結技；launch 打上去的招式
const TAGS = new WeakMap();
const idxOf = (d, ref) => {
  if (ref === undefined || ref === null) return -1;
  if (typeof ref === 'number') return ref;
  const n = d.combo.length;
  const i = (d.moves || []).findIndex((m) => m.id === ref);
  return i < 0 ? -1 : n + i;
};
const moveAt = (d, i) => (i < d.combo.length ? d.combo[i] : (d.moves || [])[i - d.combo.length]);
export function meleeTags(d) {
  let T = TAGS.get(d);
  if (T) return T;
  T = new Map();
  const add = (i, t) => {
    if (i < 0) return;
    if (!T.has(i)) T.set(i, new Set());
    T.get(i).add(t);
  };
  const n = d.combo.length;
  for (let i = 0; i < n; i++) {
    add(i, 'c' + i);
    add(i, 'combo');
  }
  add(n - 1, 'cEnd');
  const route = (ref, tag) => {
    let i = idxOf(d, ref),
      k = 1;
    const seen = new Set();
    while (i >= n && !seen.has(i)) {
      seen.add(i);
      const st = moveAt(d, i);
      add(i, tag);
      add(i, tag + k);
      const nx = st.end ? -1 : st.next !== undefined ? idxOf(d, st.next) : -1;
      if (nx < n) {
        add(i, tag + 'End'); // 路線的最後一招（之後沒有或回到預設連段）
        break;
      }
      i = nx;
      k++;
    }
  };
  const S = d.start || {};
  if (S.f !== undefined) route(S.f, 'f');
  if (S.s !== undefined) route(S.s, 's');
  if (S.b !== undefined) route(S.b, 'b');
  if (d.airMoves !== undefined) route(d.airMoves, 'air');
  add(idxOf(d, d.dashMove), 'dash');
  add(idxOf(d, d.exec), 'exec');
  add(idxOf(d, 'bash'), 'bash');
  const all = [...d.combo, ...(d.moves || [])];
  all.forEach((st, i) => {
    if (st.finisher) add(i, 'fin');
    if (st.dive) add(i, 'dive');
    if (st.launch) add(i, 'launch');
  });
  TAGS.set(d, T);
  return T;
}
export function hasTag(d, stage, tag) {
  const s = meleeTags(d).get(stage);
  return !!(s && s.has(tag));
}
// 有這個標籤的第一招的名稱（說明文字的 {標籤}）
export function tagName(d, tag) {
  for (const [i, s] of meleeTags(d)) if (s.has(tag)) return moveAt(d, i).name;
  return '';
}
// 這個標籤的招式（第一個）
export function tagMove(d, tag) {
  for (const [i, s] of meleeTags(d)) if (s.has(tag)) return moveAt(d, i);
  return null;
}

// ---------- 課程 ----------
const recent = (T, k, s) => T.log[k] !== undefined && T.clock - T.log[k] <= s;
export const LESSONS = [
  {
    id: 'L1',
    n: '基本近戰',
    d: '靠近、出刀、三段連斬、抓接招的時機',
    coam: 2000,
    steps: [
      {
        id: 'near',
        t: '靠近目標',
        text: '用 [move] 靠近訓練假人。假人腳下的圈變成<b class="ok">綠色</b>＝近戰打得到。',
        say: '近戰的第一步是距離。圈變綠就是你的刀搆得到的地方。',
        dummy: { lv: 0, dist: 26 },
        goal: [{ ev: 'near', n: 1, lbl: '靠近' }],
        demo: [['near', 0.8], ['wait', 0.6], ['end']],
        hints: ['往假人的方向移動，直到腳下的圈變綠。'],
      },
      {
        id: 'first',
        t: '第一刀',
        text: '靠近後按 [melee]＝{c0}。機體會自己往前衝一小段、朝目標揮出去。',
        say: '按一下就好。看機體怎麼衝出去。',
        dummy: { lv: 0, dist: 12 },
        goal: [{ ev: 'hit', tag: 'c0', n: 3, lbl: '打中' }],
        demo: [['near', 0.8], ['press', ''], ['wait', 'idle'], ['wait', 0.5], ['end']],
        hints: ['靠近到圈變綠，再按 [melee]。', '離太遠會揮空：先把圈走到綠色再出刀。'],
      },
      {
        id: 'combo',
        t: '連段',
        text: '連按 [melee]，從 {c0} 一路打到 {cEnd}。<br>這一刀揮出去就可以按下一下（早一點按也會<b>先記住</b>），但<b>收招後太久才按</b>會從第一刀重來。',
        say: '每一刀揮出去就按下一下，按了就會記住。別等它停下來，停太久就斷了。',
        dummy: { lv: 0, dist: 12 },
        bar: 'queue',
        goal: [{ ev: 'hit', tag: 'cEnd', n: 3, lbl: '打完一套' }],
        demo: [['near', 0.8], ['press', ''], ['chain', ''], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: [
          '這一刀揮出去就按 [melee]，時機條上寫「記住了」就對了。',
          '太慢了：上一刀收招之後很快就要按，時機條走完之前都還接得上。',
        ],
      },
      {
        id: 'stun',
        t: '硬直',
        text: '假人現在會走動。追上去打中它——被近戰打中的敵人會<b>短暫停住</b>（硬直），趁這時候接下一刀。',
        say: '打中就會停一下。一般的敵人都是這樣，AC 停得很短，Boss 不會停。',
        dummy: { lv: 1, dist: 16 },
        goal: [{ ev: 'stun', n: 4, lbl: '打出硬直' }],
        demo: [['near', 0.8], ['press', ''], ['chain', ''], ['wait', 'idle'], ['wait', 0.4], ['end']],
        hints: ['靠近走動中的假人，打中它。'],
      },
      {
        id: 'chase',
        t: '驗收：追著打完一套',
        text: '對走動的假人打完一整套 {c0} → {cEnd}。',
        dummy: { lv: 1, dist: 16 },
        bar: 'queue',
        goal: [{ ev: 'hit', tag: 'cEnd', n: 2, lbl: '打完一套' }],
        demo: [['near', 0.8], ['press', ''], ['chain', ''], ['wait', 'idle'], ['wait', 0.4], ['end']],
        hints: ['先追近再出第一刀；第一刀打中後它會停住，後面就好接了。'],
      },
    ],
  },
  {
    id: 'L2',
    n: '方向派生',
    d: '按著方向再按近戰：前、側、後各是不同的招式',
    coam: 3000,
    steps: [
      {
        id: 'fwd',
        t: '前＋近戰',
        text: '按住 [f] 再按 [melee]＝{f}。之後按住 [f] 連按，一路打到 {fEnd}。',
        touch: '觸控：也可以在攻擊鍵上往上滑（上＝前、下＝後、左右＝側）。',
        say: '方向就是你按的方向：上＝前、下＝後、左右＝側，不用管目標在哪一邊。刀一律往目標身上去。',
        dummy: { lv: 0, dist: 12 },
        dir: 'f',
        bar: 'queue',
        goal: [{ ev: 'hit', tag: 'fEnd', n: 2, lbl: '打到最後一招' }],
        demo: [['near', 0.8], ['press', 'f'], ['chain', 'f'], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['按 [melee] 的那一下要按著 [f]。', '先按住方向、再按 [melee]；連按的時候也一直按著。'],
      },
      {
        id: 'side',
        t: '側＋近戰',
        text: '按住 [s] 再按 [melee]＝{s}，機體會繞到目標的側面。',
        touch: '觸控：也可以在攻擊鍵上往左或往右滑。',
        say: '側面的招式會繞開正面，對付拿盾的、正面硬的敵人很好用。',
        dummy: { lv: 0, dist: 12 },
        dir: 's',
        goal: [{ ev: 'hit', tag: 's', n: 2, lbl: '打中' }],
        demo: [['near', 0.8], ['press', 's'], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['按住 [s]，再按 [melee]。'],
        skip: (d) =>
          d.start && d.start.s !== undefined ? '' : '這把武器沒有「側」的派生：按側＋近戰＝一般的第一招。',
      },
      {
        id: 'back',
        t: '後＋近戰',
        text: '按住 [b] 再按 [melee]＝{b}，把目標<b>打到空中</b>。',
        touch: '觸控：也可以在攻擊鍵上往下滑。',
        say: '按著下出刀，是往上撈的一擊。下一課會用到它。',
        dummy: { lv: 0, dist: 12 },
        dir: 'b',
        goal: [{ ev: 'hit', tag: 'b', n: 2, lbl: '打中' }],
        demo: [['near', 0.8], ['press', 'b'], ['wait', 'idle'], ['wait', 0.8], ['end']],
        hints: ['按住 [b]，再按 [melee]。'],
      },
      {
        id: 'mid',
        t: '連段中途換方向',
        text: '先按 [melee] 出 {c0}，接招的時候再按著方向按 [melee]：連段中途也能切到派生招式。',
        say: '起手中立，看情況再轉向。這是近戰的節奏感。',
        dummy: { lv: 0, dist: 12 },
        bar: 'queue',
        goal: [
          {
            ev: 'mv',
            n: 2,
            lbl: '中途派生',
            test: (e) =>
              !e.fresh &&
              e.prev &&
              e.prev.has('combo') &&
              (e.tags.has('f') || e.tags.has('s') || e.tags.has('b')),
          },
        ],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['wait', 'queue'],
          ['press', 'f'],
          ['chain', 'f'],
          ['wait', 'idle'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: [
          '第一刀打出去後，按著方向再按一次 [melee]。',
          '換方向的那一下，方向和 [melee] 差不多同時按就好。',
        ],
      },
      {
        id: 'quiz',
        t: '小測驗',
        text: '假人會走動。照畫面上指定的方向起手，依序打中。',
        dummy: { lv: 1, dist: 14 },
        goal: [{ quiz: 4, lbl: '答對' }],
        demo: [['near', 0.8], ['press', 'quiz'], ['wait', 'idle'], ['wait', 0.5], ['end']],
        hints: ['看清楚指定的方向，按著它再按 [melee]。'],
      },
    ],
  },
  {
    id: 'L3',
    n: '浮空與空中連段',
    d: '上挑 → 跳躍取消 → 空中連段 → 下劈',
    coam: 3500,
    steps: [
      {
        id: 'launch',
        t: '打上去',
        text: '[b] ＋ [melee]＝{b}，把假人打到空中。',
        dummy: { lv: 0, dist: 12 },
        dir: 'b',
        goal: [{ ev: 'hit', tag: 'launch', n: 2, lbl: '打上去', test: (e) => e.air }],
        demo: [['near', 0.8], ['press', 'b'], ['wait', 'idle'], ['wait', 1], ['end']],
        hints: ['按住 [b] 再按 [melee]。'],
      },
      {
        id: 'jc',
        t: '跳躍取消',
        text: '{b} 打中之後立刻按 [jump]：收招被取消，機體跟著跳上去追目標。',
        say: '打上去之後別等。跳，跟上去。',
        dummy: { lv: 0, dist: 12 },
        dir: 'b',
        goal: [{ ev: 'jc', n: 2, lbl: '跳躍取消' }],
        demo: [
          ['near', 0.8],
          ['press', 'b'],
          ['wait', 'hit'],
          ['wait', 0.12],
          ['jump', 0.25],
          ['wait', 'ground'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: ['上挑打中之後按 [jump]。', '要「打中之後」才取消得了：看到假人飛起來就按 [jump]。'],
      },
      {
        id: 'airstart',
        t: '空中出招',
        text: '在空中按 [melee]＝{air}。空中出招時機體會停在空中、跟著目標的高度。',
        dummy: { lv: 0, dist: 12 },
        dir: 'b',
        goal: [{ ev: 'hit', tag: 'air', n: 2, lbl: '空中打中' }],
        demo: [
          ['near', 0.8],
          ['press', 'b'],
          ['wait', 'hit'],
          ['wait', 0.12],
          ['jump', 0.25],
          ['wait', 0.12],
          ['press', ''],
          ['wait', 'idle'],
          ['wait', 'ground'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: ['上挑 → [jump] → 還在空中時按 [melee]。'],
      },
      {
        id: 'aircombo',
        t: '完整的空中連段',
        text: '上挑 → [jump] → 空中連按 [melee]，一路打到 {airEnd}（把目標砸回地面）。',
        say: '這就是一整套浮空連段。熟了之後一口氣打完。',
        dummy: { lv: 0, dist: 12 },
        dir: 'b',
        bar: 'queue',
        goal: [{ ev: 'hit', tag: 'airEnd', n: 2, lbl: '砸回地面', test: (e, T) => recent(T, 'jc', 5) }],
        demo: [
          ['near', 0.8],
          ['press', 'b'],
          ['wait', 'hit'],
          ['wait', 0.12],
          ['jump', 0.25],
          ['wait', 0.12],
          ['press', ''],
          ['chain', ''],
          ['wait', 'idle'],
          ['wait', 'ground'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: ['空中也一樣：每一刀揮出去就按下一下。'],
      },
    ],
  },
  {
    id: 'L4',
    n: '機動連接',
    d: '衝刺斬、QB 取消後接回、對失衡的敵人突進追擊',
    coam: 4000,
    steps: [
      {
        id: 'dash',
        t: '衝刺斬',
        text: '按住 [ab]（突擊推進）衝向假人，推進中按 [melee]＝{dash}。速度越快越痛。',
        say: '從遠處一口氣切進去。突擊推進中出刀，就是衝刺斬。',
        dummy: { lv: 0, dist: 34 },
        reset: true,
        goal: [{ ev: 'hit', tag: 'dash', n: 2, lbl: '衝刺斬' }],
        demo: [['ab', 0.45], ['press', ''], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['先按住 [ab] 衝出去，衝刺途中按 [melee]。', '[ab] 要一直按住，在衝刺「中」按 [melee]。'],
        touch: '觸控：按住 QB 鍵衝出去，衝到近處、攻擊鍵變成「斬擊」時再按（太早按是開槍）。',
      },
      {
        id: 'resume',
        t: 'QB 取消、再接回',
        text: '連段打中後按 [qb] 閃開（取消收招），<b>0.6 秒內</b>再按 [melee]，從下一招接回去。',
        say: '打兩下、閃一下、再接上。對手會以為你停手了。',
        dummy: { lv: 0, dist: 12 },
        bar: 'resume',
        goal: [{ ev: 'resume', n: 2, lbl: '接回' }],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['wait', 'half'],
          ['qb', 's'],
          ['wait', 0.12],
          ['press', ''],
          ['wait', 'idle'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: [
          '第一刀打中、揮到一半以後按 [qb]，接著馬上按 [melee]。',
          'QB 太早不會取消：這一刀要揮過一半。接回的時間只有 0.6 秒。',
        ],
      },
      {
        id: 'lunge',
        t: '突進追擊',
        text: '假人已經<b>失衡</b>（頭上的黃框）。失衡中的敵人在遠處也一樣按 [melee]：機體會長距離突進貼上去。',
        say: '失衡就是破綻。再遠都追得上。',
        dummy: { lv: 0, lunge: 1.7, stag: true },
        reset: true,
        goal: [{ ev: 'hit', n: 2, lbl: '突進打中', test: (e) => e.lunge }],
        demo: [['wait', 0.3], ['press', ''], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['不用走近，直接按 [melee]。'],
      },
      {
        id: 'chk',
        t: '驗收：對會閃的假人',
        text: '假人會用 QB 拉開距離。用衝刺斬或 QB 接回黏住它，打出 2 次終結技（每條連段的最後一招）。',
        dummy: { lv: 2, dist: 20 },
        bar: 'queue',
        goal: [{ ev: 'hit', tag: 'fin', n: 2, lbl: '終結技' }],
        demo: [['ab', 0.35], ['press', 'f'], ['chain', 'f'], ['wait', 'idle'], ['wait', 0.5], ['end']],
        hints: ['它閃開時別追著走：用 [ab] 衝刺斬直接切過去。'],
      },
    ],
  },
  {
    id: 'L5',
    n: '武器連接',
    d: '近戰接射擊、射擊接近戰、左右手交替',
    coam: 4500,
    steps: [
      {
        id: 'link',
        t: '近戰接射擊',
        text: '近戰打中、揮過一半之後按 [shot]：立刻中斷近戰開火。貼著目標開的這一槍傷害提高。',
        say: '刀砍完補一槍。距離近的時候，這一槍比平常痛。',
        dummy: { lv: 0, dist: 12 },
        bar: 'link',
        goal: [{ ev: 'link', n: 2, lbl: '接射擊' }],
        demo: [['near', 0.8], ['press', ''], ['wait', 'half'], ['shot', 1], ['wait', 0.8], ['end']],
        hints: ['近戰打中後按 [shot]。', '要等這一刀揮過一半（時機條變綠）。'],
        skip: (d, g) =>
          g.vpadWanted() ? '觸控的攻擊鍵會自動切換射擊與近戰，這個連接請用鍵盤或手把練習。' : '',
      },
      {
        id: 'shotlunge',
        t: '射擊打出失衡 → 突進',
        text: '用 [shot] 的霰彈槍從遠處打到假人<b>失衡</b>（頭上出現黃框），再按 [melee] 突進追打。',
        say: '射擊累積衝擊、打出失衡，近戰收尾。這是最基本的分工。',
        dummy: { lv: 1, lunge: 1.7, stab: 0.35 },
        reset: true,
        goal: [{ ev: 'hit', n: 2, lbl: '突進打中', test: (e) => e.lunge }],
        demo: [['shootStag'], ['press', ''], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['連續按 [shot] 打到它失衡。', '黃框出現就按 [melee]，不用先走近。'],
        touch: '觸控：遠處的攻擊鍵是射擊；假人失衡後攻擊鍵自動變成「斬擊」，再按一下就突進。',
      },
      {
        id: 'swap',
        t: '左右手交替（選修）',
        text: '左手換成第二把近戰武器。右手的近戰揮過一半後按 [melee2]：換左手接下去。',
        dummy: { lv: 0, dist: 12 },
        setup: { swap: true },
        opt: true,
        goal: [{ ev: 'swap', n: 2, lbl: '換手' }],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['wait', 'half'],
          ['press', '', 'larm'],
          ['wait', 'idle'],
          ['wait', 0.6],
          ['end'],
        ],
        hints: ['右手打中後按 [melee2]。'],
        skip: (d, g) =>
          g.vpadWanted() ? '觸控只有一顆攻擊鍵（固定用右手的近戰），左右手交替請用鍵盤或手把練習。' : '',
      },
    ],
  },
  {
    id: 'L6',
    n: '處決',
    d: '打出失衡 → 長按近戰鍵處決',
    coam: 5000,
    steps: [
      {
        id: 'stag',
        t: '打出失衡',
        text: '連續打中第 3 下，或打中連段的終結技，敵人就會<b>失衡</b>（頭上的黃框）。',
        say: '失衡的敵人不能動，是處決的條件。',
        dummy: { lv: 0, dist: 12 },
        reset: true,
        goal: [{ ev: 'stag', n: 2, lbl: '打出失衡' }],
        demo: [['near', 0.8], ['press', ''], ['chain', ''], ['wait', 'idle'], ['wait', 0.8], ['end']],
        hints: ['打完一套連段就會失衡。'],
      },
      {
        id: 'exec',
        t: '處決',
        text: '敵人失衡時靠近，<b>按住</b> [melee] 不放（約 0.35 秒）＝{exec}。處決一定擊破一般敵人。',
        say: '別點，按住。處決中你不會受傷。',
        dummy: { lv: 0, dist: 12, kill: true },
        bar: 'exec',
        reset: true,
        goal: [{ ev: 'exec', n: 2, lbl: '處決' }],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['chain', ''],
          ['wait', 'stag'],
          ['wait', 'idle'],
          ['hold', 0.5],
          ['wait', 'idle'],
          ['wait', 1.6],
          ['end'],
        ],
        hints: ['先打到失衡，再按住 [melee]。', '按住不放，時機條滿了才會發動；距離要在近戰的圈裡。'],
        touch: '觸控：攻擊鍵是「斬擊」的時候按住不放。',
      },
      {
        id: 'reward',
        t: '處決的回報',
        text: '注意左下的 EN 條：處決之後 <b>EN 全滿</b>、AP 回復一點，還會掉一個<b>彈藥箱</b>。',
        tip: 'AC 與精英只會被處決扣掉一部分 AP；Boss 不能處決。',
        dummy: { lv: 0, dist: 12, kill: true },
        setup: { en: 0.3 },
        reset: true,
        goal: [
          { ev: 'execKill', n: 1, lbl: '處決擊破', test: (e, T, g) => g.player.en >= g.player.enMax * 0.98 },
        ],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['chain', ''],
          ['wait', 'stag'],
          ['wait', 'idle'],
          ['hold', 0.5],
          ['wait', 'idle'],
          ['wait', 1.6],
          ['end'],
        ],
        hints: ['和上一步一樣：打到失衡，按住 [melee]。'],
      },
      {
        id: 'chk',
        t: '驗收：對會反擊的假人',
        text: '假人現在會在你停手時<b>反擊</b>（紅光預警）。打出失衡、處決它。',
        say: '打完別發呆。對手會還手。',
        dummy: { lv: 3, dist: 14, kill: true, atk: 'melee' },
        reset: true,
        goal: [{ ev: 'exec', n: 1, lbl: '處決' }],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['chain', ''],
          ['wait', 'stag'],
          ['wait', 'idle'],
          ['hold', 0.5],
          ['wait', 'idle'],
          ['wait', 1.6],
          ['end'],
        ],
        hints: ['連段打完它會失衡，失衡時它不會反擊：趕快按住 [melee]。'],
      },
    ],
  },
  {
    id: 'L7',
    n: '防禦反擊',
    d: '彈刀、完美 QB、盾擊',
    coam: 6000,
    steps: [
      {
        id: 'parry',
        t: '彈刀',
        text: '假人會先亮紅光預備，<b>頭上出現「!」</b>就馬上揮刀。<b>看到「!」就按 [melee]</b>：刀揮過來時會被彈開，你不受傷、假人硬直。',
        say: '「!」一出現就出刀，剛好趕上。實戰裡敵人出手前也會出「!」。',
        dummy: { lv: 4, dist: 10, atk: 'melee', every: [2.2, 3] },
        bar: 'parry',
        goal: [{ ev: 'parry', n: 3, lbl: '彈刀' }],
        demo: [['wait', 'parry'], ['press', ''], ['wait', 'idle'], ['wait', 0.8], ['end']],
        hints: ['「!」出現就按 [melee]。', '「!」之前按的不算；「!」出現到刀揮下來之間都可以。'],
      },
      {
        id: 'parryfollow',
        t: '彈刀之後',
        text: '彈刀之後的<b>下一下必定打出失衡</b>。彈開後馬上接 [melee]，再按住處決。',
        dummy: { lv: 4, dist: 10, atk: 'melee', every: [2.2, 3], kill: true },
        bar: 'parry',
        reset: true,
        goal: [{ ev: 'exec', n: 1, lbl: '彈刀 → 處決', test: (e, T) => recent(T, 'parry', 6) }],
        demo: [
          ['wait', 'parry'],
          ['press', ''],
          ['wait', 'idle'],
          ['press', ''],
          ['wait', 'stag'],
          ['wait', 'idle'],
          ['hold', 0.5],
          ['wait', 'idle'],
          ['wait', 1.6],
          ['end'],
        ],
        hints: ['彈刀 → [melee] 打出失衡 → 按住 [melee] 處決。'],
      },
      {
        id: 'pqb',
        t: '完美 QB',
        text: '<b>看到「!」就按 [qb]</b>：這一擊會被完美迴避（不受傷、畫面一頓）。',
        say: '實戰裡敵人出手前也會出「!」。看到就閃。',
        dummy: { lv: 4, dist: 10, atk: 'melee', every: [2.2, 3] },
        bar: 'pqb',
        goal: [{ ev: 'pqb', n: 3, lbl: '完美迴避' }],
        demo: [['wait', 'pqb'], ['qb', 's'], ['wait', 0.8], ['end']],
        hints: ['「!」出現就按 [qb]。', '「!」之前按的不算；「!」出現到刀揮下來之間都可以。'],
      },
      {
        id: 'pqbfollow',
        t: '完美 QB 之後',
        text: '完美迴避之後 1.5 秒內的第一下近戰：<b>衝擊加倍、突進距離加長</b>。閃開後馬上按 [melee] 反打。',
        dummy: { lv: 4, dist: 10, atk: 'melee', every: [2.2, 3] },
        bar: 'pqb',
        goal: [{ ev: 'hit', n: 2, lbl: '反打', test: (e) => e.pqb }],
        demo: [
          ['wait', 'pqb'],
          ['qb', 's'],
          ['wait', 0.15],
          ['press', ''],
          ['wait', 'idle'],
          ['wait', 0.8],
          ['end'],
        ],
        hints: ['完美迴避 → 馬上 [melee]。'],
      },
      {
        id: 'bash',
        t: '盾擊',
        text: '肩上裝了脈衝盾。被打中時盾會擋下一部分傷害；<b>擋下的 0.5 秒內</b>按 [melee]＝盾擊（衝擊很大）。',
        say: '擋住，然後撞回去。',
        dummy: { lv: 4, dist: 14, atk: 'shot', every: [1.8, 2.4] },
        setup: { shield: true },
        bar: 'bash',
        goal: [{ ev: 'hit', tag: 'bash', n: 2, lbl: '盾擊' }],
        demo: [['wait', 'shield'], ['press', ''], ['wait', 'idle'], ['wait', 0.6], ['end']],
        hints: ['被子彈打中（盾發光）就按 [melee]。', '0.5 秒很短：一被打中就按。'],
        touch: '觸控：盾擋下攻擊的 0.5 秒內，攻擊鍵會變成「斬擊」，這時按就是盾擊。',
      },
      {
        id: 'mix',
        t: '綜合',
        text: '假人會隨機揮刀或開槍。用<b>彈刀</b>、<b>完美 QB</b> 或<b>盾擊</b>應對 5 次。',
        say: '看預警判斷：刀就迎上去或閃開，子彈就用盾撞回去（看到「!」按 QB 也躲得掉）。',
        dummy: { lv: 4, dist: 12, atk: 'mix', every: [2, 2.8] },
        setup: { shield: true },
        bar: 'parry',
        goal: [{ ev: 'counter', n: 5, lbl: '應對' }],
        demo: [['wait', 'tele'], ['wait', 'counter'], ['wait', 'idle'], ['wait', 0.3], ['end']],
        hints: ['紅色的刀光＝揮刀（彈刀或完美 QB），紅線＝開槍（被打中後盾擊）。'],
      },
    ],
  },
  {
    id: 'L8',
    n: '結業考核',
    d: '限時的技巧考試＋對教官的實戰',
    coam: 0,
    final: true,
    steps: [
      {
        id: 'exam',
        t: '技巧考試',
        text: '60 秒內，對會閃避與反擊的假人用出越多種技巧越好。<b>4 種</b>及格，7 種 ★★，10 種 ★★★。',
        say: '把學過的全拿出來。種類越多越好。',
        dummy: { lv: 3, dist: 14, kill: true, atk: 'mix' },
        setup: { shield: true },
        goal: [{ exam: 60, lbl: '技巧' }],
        demo: [
          ['near', 0.8],
          ['press', 'b'],
          ['wait', 'hit'],
          ['wait', 0.12],
          ['jump', 0.25],
          ['wait', 0.12],
          ['press', ''],
          ['chain', ''],
          ['wait', 'idle'],
          ['wait', 'ground'],
          ['press', 'f'],
          ['chain', 'f'],
          ['wait', 'idle'],
          ['press', ''],
          ['chain', ''],
          ['wait', 'idle'],
          ['wait', 0.5],
          ['end'],
        ],
        hints: ['上挑空中連段、前派生、處決……每一種只算一次，換著用。'],
      },
      {
        id: 'duel',
        t: '實戰：教官',
        text: '教官的訓練機會主動進攻。用學過的技巧擊敗它。',
        say: '來吧。讓我看看你學到了什麼。',
        dummy: { lv: 4, dist: 18, kill: true, atk: 'mix', every: [1.8, 2.6], duel: true },
        setup: { shield: true },
        goal: [{ ev: 'kill', n: 1, lbl: '擊敗教官' }],
        demo: [
          ['near', 0.8],
          ['press', ''],
          ['chain', ''],
          ['wait', 'stag'],
          ['wait', 'idle'],
          ['hold', 0.5],
          ['wait', 'idle'],
          ['wait', 0.5],
          ['end'],
        ],
        hints: ['打出失衡就處決，處決對它扣很多。'],
      },
    ],
  },
];
export const lessonById = (id) => LESSONS.find((L) => L.id === id) || null;
