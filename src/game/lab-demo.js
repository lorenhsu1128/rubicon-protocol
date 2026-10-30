// Game：渲染風格實驗室的「動作展示」（docs/mech-animation.md）：清掉兩隊機甲，在空曠的地方由腳本操作玩家的機體，
// 依序表演移動、機動、射擊、近戰、受擊與擊破的各種動作。只在實驗室（this.lab）裡，不寫存檔。
// 每一段：n 名稱、d 秒數、s 說明、w 武器（換掉玩家機體的武器槽，下一段沒寫的照原本的組裝）、run(D, t, dt)。
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { MechEntity } from '../entities/mech-entity.js';
import { PALETTES } from '../render/materials.js';
import { mechFlash } from '../render/mech-model.js';
import { hrKindOf } from '../data/hit-react.js';
import { REACT_T, meleeAll, meleeReactOf } from '../data/melee.js';
import { FIST_DEF, partById } from '../data/parts.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
// 每 half 秒換一次方向（1／−1）
const flip = (t, half) => (Math.floor(t / half) % 2 ? -1 : 1);
// 在 t 經過 at 的那一格
const at = (D, t, x) => D.t0 < x && t >= x;
const CLEAR_R = 42; // 拿掉地圖物件的半徑（m）
const CAMS = [
  [-Math.PI / 4, '斜前'],
  [-Math.PI / 2, '側面'],
  [0, '正面'],
  [Math.PI * 0.8, '背面'],
];

// 射擊的段落：一直開火（蓄力武器蓄滿才放）
const shoot = (slots) => (D, t, dt, g) => {
  g.labDemoMove(dt, 0, 0, { face: true });
  for (const s of slots) g.labDemoFire(s, dt);
};
// 近戰的段落：依序打完整個連段（每段結束後接下一段），打完停 0.8 秒再來一次
const melee = (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const def = p.weapons.rarm.def;
  if (!def.combo || p.melee.active) return;
  D.mWait = (D.mWait || 0) - dt;
  if (D.mWait > 0) return;
  const i = D.mi || 0;
  if (i >= def.combo.length) {
    D.mi = 0;
    D.mWait = 0.8;
    p.pos.copy(D.C);
    return;
  }
  p.startMeleeStage('rarm', i, g.labDemoAhead(30), null);
  D.mi = i + 1;
};
// 派生招式的段落：依序打出武器的每一個派生招式（data/melee.js 的 moves）
const meleeMoves = (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const def = p.weapons.rarm.def;
  if (!def.moves || p.melee.active) return;
  D.mWait = (D.mWait || 0) - dt;
  if (D.mWait > 0) return;
  const i = D.mi || 0;
  if (i >= def.moves.length) {
    D.mi = 0;
    D.mWait = 0.8;
    p.pos.copy(D.C);
    return;
  }
  p.startMeleeStage('rarm', def.combo.length + i, g.labDemoAhead(30), null);
  D.mi = i + 1;
  D.mWait = 0.15;
};
// 受擊反應的段落（docs/melee-combo-design.md 的打擊感改版第 2 期）：依序做每一種反應，最後被挑飛
const REACTS = ['light', 'slash', 'thrust', 'spin', 'blow', 'down', 'held'];
const reacts = (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const i = Math.floor(t / 1.1);
  if (i === D.ri) return;
  D.ri = i;
  if (i < REACTS.length) {
    p.reactSet(REACTS[i], 0.95, i % 2 ? -1 : 1);
    mechFlash(p.model);
  } else if (i === REACTS.length) {
    p.vel.y = 22 * p.dk; // 被挑飛：空中往後翻，落地蹲一下
    p.grounded = false;
    p.reactSet('launch', 1, 1);
    mechFlash(p.model);
  }
};
// ---------- 受擊展示（docs/hit-react-design.md 第 6 期）：依序被每把武器、每一招打，說明列顯示現在是哪一個 ----------
const HR_ARM = ['w_rifle', 'w_mg', 'w_hg', 'w_sg', 'w_lsg', 'w_bz', 'w_gl', 'w_emp', 'w_lr', 'w_lc'];
const HR_BACK = ['bw_ms', 'bw_ms8', 'bw_pm', 'bw_gr', 'bw_emp_s', 'bw_emp_l', 'bw_lc', 'bw_gat'];
const HR_SLOT = 1.5; // 每一個的秒數
const HR_CONT = new Set(['w_mg', 'bw_gat', 'w_lr', 'bw_lc']); // 連射／持續照射：這段時間一直打
// 屬性反應與放大版：[說明, 做法]
const HR_EXTRA = [
  ['過熱（屬性反應）', (e) => e.hrAdd('rxHot', 0, 1, 0, false, 1)],
  ['EMP 干擾（屬性反應）', (e) => e.hrAdd('rxJam', 0, 1, 0, false, 1)],
  ['破甲爆裂（屬性反應）', (e) => e.hrAdd('rxBurst', 0, 1, 0, false, 1)],
  ['步槍：打中弱點 CRITICAL', (e) => e.hrAdd('rifle', 0, 1, 0.2, false, 1, 1.5)],
  ['霰彈：蓄力強力彈', (e) => e.hrAdd('shotgun', 0, 1, 0, false, 1, 1.5)],
  ['打在頭（步槍）', (e) => e.hrAdd('rifle', 0, 1, 0.9, false, 1)],
  ['打在腳（步槍）', (e) => e.hrAdd('rifle', 0, 1, -0.9, false, 1)],
  ['從右側打（步槍）', (e) => e.hrAdd('rifle', -1, 0, 0, false, 1)],
];
// 說明列的第二行換成現在這一個
const hrCap = (D, txt) => {
  if (D.hrCapTxt === txt) return;
  D.hrCapTxt = txt;
  const s = document.querySelector('#labDemoCap span');
  if (s) s.textContent = txt;
};
// 遠程武器：玩家的機體被打（幅度照一般敵人，看得清楚）
const hrRanged = (list) => (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const i = Math.min(list.length - 1, Math.floor(t / HR_SLOT));
  const id = list[i],
    W = partById(id.startsWith('bw_') ? 'back' : 'arm', id);
  hrCap(D, `${i + 1}／${list.length}　${W ? W.name : id}`);
  const ti = t - i * HR_SLOT;
  const fire = i !== D.ri ? ti < 0.6 : HR_CONT.has(id) && ti < 0.9 && (D.hrT = (D.hrT || 0) - dt) <= 0;
  if (i !== D.ri) D.ri = i;
  else if (!fire) return;
  D.hrT = id === 'w_mg' || id === 'bw_gat' ? 0.07 : 0.1;
  const k = hrKindOf(W, null, false);
  p.hrAdd(k, 0.25 * flip(i, 1), 1, 0, false, 1);
  mechFlash(p.model);
};
const hrExtra = (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const i = Math.min(HR_EXTRA.length - 1, Math.floor(t / HR_SLOT));
  hrCap(D, `${i + 1}／${HR_EXTRA.length}　${HR_EXTRA[i][0]}`);
  if (i === D.ri) return;
  D.ri = i;
  HR_EXTRA[i][1](p);
  mechFlash(p.model);
};
// 近戰：被這把武器的每一招打（招式的基本反應＋這一招自己的變化）
const hrMelee = (wid) => (D, t, dt, g) => {
  const p = g.player;
  g.labDemoMove(dt, 0, 0, { face: true });
  const d = wid === 'w_fist' ? FIST_DEF : partById('arm', wid);
  const all = meleeAll(d);
  const i = Math.min(all.length - 1, Math.floor(t / 1.2));
  hrCap(D, `${i + 1}／${all.length}　${all[i].name}`);
  if (i === D.ri) return;
  D.ri = i;
  let rk = meleeReactOf(all[i]);
  if (rk === 'slam' || rk === 'launch') rk = rk === 'slam' ? 'down' : 'blow'; // 展示不讓它飛起來
  p.reactSet(rk, REACT_T[rk] || 0.4, i % 2 ? -1 : 1, false, wid + ':' + i);
  mechFlash(p.model);
};
const hrMeleeT = (wid) => meleeAll(wid === 'w_fist' ? FIST_DEF : partById('arm', wid)).length * 1.2 + 0.4;
// 其他身體：在旁邊生成一台（不動、AP 無限），鏡頭看它；每一台被火箭筒、霰彈、EMP、近戰打
const HR_BODIES = [
  ['mth', '戰車腳的 MT'],
  ['strider', '四足的步行砲台'],
  ['tank', '裝甲車'],
  ['heli', '直升機'],
  ['swarm', '無人機'],
  ['blob', '實驗體（壓扁回彈）'],
  ['crane', '起重機砲台（吊臂與貨櫃擺）'],
  ['buoy', '漂流水雷浮標（翻過來）'],
  ['eel', '電鰻無人機（身體扭）'],
  ['underturret', '平台底部砲塔（像鐘擺）'],
  ['skater', '冰面滑行砲車（打轉）'],
];
const HR_BODY_T = 2.6;
const hrBodies = (D, t, dt, g) => {
  g.labDemoMove(dt, 0, 0, { face: true });
  const i = Math.min(HR_BODIES.length - 1, Math.floor(t / HR_BODY_T));
  const [type, name] = HR_BODIES[i];
  hrCap(D, `${i + 1}／${HR_BODIES.length}　${name}`);
  if (i !== D.ri) {
    D.ri = i;
    g.labDemoBody(type);
    D.hrStep = 0;
  }
  const e = D.dummy;
  if (!e) return;
  const ti = t - i * HR_BODY_T;
  const steps = [0.2, 0.85, 1.5, 2.1];
  if (D.hrStep < steps.length && ti >= steps[D.hrStep]) {
    const s = D.hrStep++;
    if (s === 0) e.hrAdd('rocket', 0.3, 1, 0, false);
    else if (s === 1) e.hrAdd('shotgun', -0.4, 1, 0, false);
    else if (s === 2) e.hrAdd('emp', 0, 1, 0, false);
    else e.reactSet('blow', 0.65, 1, false, 'w_pile:1');
    mechFlash(e.model);
  }
  g.labDemoBodyTick(dt);
};

const comboT = (id) => {
  // 段落長度：整個連段兩次＋休息
  const d = { w_blade: 1.08, w_saber: 1.99, w_pile: 1.1, w_none: 0.9 }[id] || 1.2;
  return d * 2 + 2.2;
};

const DEMO_SEGS = [
  { n: '待機', d: 3.5, s: '呼吸、重心晃動', run: (D, t, dt, g) => g.labDemoMove(dt, 0, 0) },
  {
    n: '走路',
    d: 4,
    s: '低速時踏步走；轉向時下半身先轉',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, 0.22 * flip(t, 2)),
  },
  {
    n: '跑步',
    d: 4,
    s: '中速：抬腳更高、擺臂更大、上身前傾',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, 0.55 * flip(t, 2)),
  },
  {
    n: '滑行',
    d: 5,
    s: '高速（機體速度 80% 以上 0.3 秒）：兩腳前後錯開貼地滑、上身前傾、推進器噴焰',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, flip(t, 1.6)),
  },
  {
    n: '煞車',
    d: 4.4,
    s: '急減速：前腳撐住、後腳屈膝、上身後仰（彈簧的過衝與回彈）',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, t % 2.2 < 1.2 ? 1 : 0),
  },
  {
    n: '側移（上下半身分離）',
    d: 5,
    s: '上身朝準星、下半身朝移動方向',
    run: (D, t, dt, g) => g.labDemoMove(dt, flip(t, 1.6), 0, { face: true }),
  },
  {
    n: '斜向移動',
    d: 4,
    s: '往斜前方跑，腿朝移動方向、上身朝準星',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0.45 * flip(t, 2), 0.45, { face: true }),
  },
  {
    n: '倒退',
    d: 4,
    s: '面向準星往後退（倒退跑／滑行）',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, -0.8 * flip(t, 2), { face: true }),
  },
  {
    n: '原地轉身',
    d: 5,
    s: '腳先留在地面上，角度大了兩腳交替踏步轉過去',
    run: (D, t, dt, g) => {
      const k = Math.floor(t / 1.25);
      g.labDemoMove(dt, 0, 0, { face: true, aim: [0, 1.1, 0, -1.1][k % 4] });
    },
  },
  {
    n: 'QB（前、側、後）',
    d: 4.5,
    s: '依方向：前衝壓低、側衝往移動方向傾、後退後仰；背包與肩上武器往後甩',
    run: (D, t, dt, g) => {
      const q = at(D, t, 0.3) ? [0, 1] : at(D, t, 1.8) ? [1, 0] : at(D, t, 3.3) ? [0, -1] : null;
      g.labDemoMove(dt, q ? q[0] : 0, q ? q[1] : 0, { face: true, qb: !!q });
    },
  },
  {
    n: '跳躍與落地',
    d: 4.4,
    s: '起跳伸腿、上升時一腳收高、下落時雙腳往前下伸、依下落速度蹲踞',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, 0, { face: true, hover: at(D, t, 0.2) || at(D, t, 2.4) }),
  },
  {
    n: '懸浮',
    d: 4,
    s: '按住跳躍：定高懸浮',
    run: (D, t, dt, g) => g.labDemoMove(dt, 0, 0, { face: true, hover: t > 0.2 && t < 2.6 }),
  },
  { n: '射擊：步槍', d: 3, s: '輕後座：槍口小跳', w: { rarm: 'w_rifle' }, run: shoot(['rarm']) },
  {
    n: '射擊：加特林',
    d: 3.5,
    s: '連射：下盤撐住、上身震動、槍管轉動',
    w: { rarm: 'w_mg' },
    run: shoot(['rarm']),
  },
  { n: '射擊：霰彈', d: 3.5, s: '重後座：槍口大跳、上身後仰', w: { rarm: 'w_sg' }, run: shoot(['rarm']) },
  {
    n: '射擊：火箭筒',
    d: 3.5,
    s: '很重的後座：上身後仰、撐住下盤',
    w: { rarm: 'w_bz' },
    run: shoot(['rarm']),
  },
  {
    n: '射擊：蓄力雷射',
    d: 4,
    s: '蓄力時舉槍後仰，發射時大反衝',
    w: { rarm: 'w_lr' },
    run: shoot(['rarm']),
  },
  {
    n: '換彈',
    d: 3.5,
    s: '槍往下、往內翻，瞄準放鬆',
    w: { rarm: 'w_rifle' },
    run: (D, t, dt, g) => {
      g.labDemoMove(dt, 0, 0, { face: true });
      const w = g.player.weapons.rarm;
      if (at(D, t, 0.4)) {
        w.mag = 0;
        w.reloadT = w.def.reload;
      }
    },
  },
  {
    n: '肩上武器',
    d: 4,
    s: '導彈與背雷射砲：肩上武器後座、重的撐住下盤',
    w: { rback: 'bw_ms', lback: 'bw_lc' },
    run: shoot(['rback', 'lback']),
  },
  { n: '近戰：脈衝刀', d: comboT('w_blade'), s: '橫斬 → 逆斬 → 突刺', w: { rarm: 'w_blade' }, run: melee },
  {
    n: '近戰：光束大劍',
    d: comboT('w_saber'),
    s: '大斬 → 大逆斬 → 迴旋斬 → 下劈',
    w: { rarm: 'w_saber' },
    run: melee,
  },
  { n: '近戰：打樁機', d: comboT('w_pile'), s: '撞擊 → 樁擊', w: { rarm: 'w_pile' }, run: melee },
  { n: '近戰：拳擊', d: comboT('w_none'), s: '直拳 → 勾拳 → 重擊', w: { rarm: 'w_none' }, run: melee },
  {
    n: '近戰：派生招式（脈衝刀）',
    d: 9.5,
    s: '前＝突刺連打 → 踢開、側＝側滑迴旋斬、後＝上挑、空中連段、衝刺斬（docs/melee-combo-design.md）',
    w: { rarm: 'w_blade' },
    run: meleeMoves,
  },
  {
    n: '近戰：派生招式（光束大劍）',
    d: 7.5,
    s: '突進刺、大迴旋（轉兩圈）、斬上、空中大斬、大衝刺斬、處決・兩斷',
    w: { rarm: 'w_saber' },
    run: meleeMoves,
  },
  {
    n: '近戰：派生招式（破碎爪）',
    d: 8.5,
    s: '抓住 → 撕扯 → 撕開、迴旋爪、上撈、空中爪、下撕、衝刺爪、處決・撕裂',
    w: { rarm: 'w_claw' },
    run: meleeMoves,
  },
  {
    n: '近戰：派生招式（打樁機）',
    d: 6.5,
    s: '衝刺樁擊、上頂、空中樁擊、肩撞、處決・打穿',
    w: { rarm: 'w_pile' },
    run: meleeMoves,
  },
  {
    n: '近戰：派生招式（拳擊）',
    d: 7,
    s: '肘擊、迴旋踢、上勾拳、空中拳、下踢、衝刺拳、處決・連打',
    w: { rarm: 'w_none' },
    run: meleeMoves,
  },
  {
    n: '受擊反應（依招式）',
    d: 10.5,
    s: '輕擊、被斬、被刺、被轉開、被打飛、倒地、被處決中、被挑飛',
    run: reacts,
  },
  {
    n: '受擊（前、側、背）',
    d: 4.2,
    s: '依推力方向後仰／側傾、扭轉，背包晃動；重擊時踉蹌',
    run: (D, t, dt, g) => {
      g.labDemoMove(dt, 0, 0, { face: true });
      const d = at(D, t, 0.3) ? [0, 1] : at(D, t, 1.6) ? [1, 0] : at(D, t, 2.9) ? [0, -1] : null;
      if (d) g.labDemoHit(d, 1.1);
    },
  },
  { n: '受擊：手持武器', d: HR_ARM.length * HR_SLOT, s: '', run: hrRanged(HR_ARM) },
  { n: '受擊：肩上武器', d: HR_BACK.length * HR_SLOT, s: '', run: hrRanged(HR_BACK) },
  { n: '受擊：屬性反應、弱點、強力彈、命中位置', d: HR_EXTRA.length * HR_SLOT, s: '', run: hrExtra },
  { n: '受擊：脈衝刀的每一招', d: hrMeleeT('w_blade'), s: '', run: hrMelee('w_blade') },
  { n: '受擊：光束大劍的每一招', d: hrMeleeT('w_saber'), s: '', run: hrMelee('w_saber') },
  { n: '受擊：破碎爪的每一招', d: hrMeleeT('w_claw'), s: '', run: hrMelee('w_claw') },
  { n: '受擊：打樁機的每一招', d: hrMeleeT('w_pile'), s: '', run: hrMelee('w_pile') },
  { n: '受擊：拳擊的每一招', d: hrMeleeT('w_fist'), s: '', run: hrMelee('w_fist') },
  { n: '受擊：其他身體', d: HR_BODIES.length * HR_BODY_T, s: '', cam: 'dummy', run: hrBodies },
  {
    n: '失衡（前面打）',
    d: 3.6,
    s: '往後仰、屈膝撐住、手往外甩',
    run: (D, t, dt, g) => {
      if (at(D, t, 0.3)) g.labDemoHit([0, 1], 1, 2.4);
      g.labDemoMove(dt, 0, 0, { face: true });
    },
  },
  {
    n: '失衡（背後打）',
    d: 3.6,
    s: '往前跪、一腳跪地',
    run: (D, t, dt, g) => {
      if (at(D, t, 0.3)) g.labDemoHit([0, -1], 1, 2.4);
      g.labDemoMove(dt, 0, 0, { face: true });
    },
  },
  {
    n: '檢查武器',
    d: 4,
    s: '待機一陣子後右手把槍舉到面前看一下（平常 7～19 秒）',
    w: { rarm: 'w_rifle' },
    run: (D, t, dt, g) => {
      const an = g.player.model.an;
      if (an && t < 0.1) an.chkN = 0.25;
      g.labDemoMove(dt, 0, 0);
    },
  },
  {
    n: '擊破倒下',
    d: 4.5,
    s: '人形機甲先跪倒崩落、冒火花，0.55 秒後碎裂與爆炸',
    run: (D, t, dt, g) => {
      g.labDemoMove(dt, 0, 0, { face: true });
      if (at(D, t, 0.05)) g.labDemoDummy();
      const e = D.dummy;
      if (e && !e.dead) e.move(dt, V(), false, false, false, null);
      if (e && at(D, t, 1.3)) e.die(null);
    },
  },
];

Object.assign(Game.prototype, {
  // 進入：清掉兩隊、找空曠的地方、玩家的機體改由腳本操作
  labDemoEnter() {
    const L = this.lab;
    for (const e of [...this.enemies, ...this.allies]) e.cleanup();
    this.enemies = [];
    this.allies = [];
    this.projectiles.length = 0;
    const p = this.player;
    if (p.dead) p.respawnAt(p.pos.clone());
    p.ai = null;
    p.isPlayer = false;
    p.hp = p.maxHp = 1e9;
    p.iFrames = 0;
    const C = this.labDemoSpot();
    // 中心 CLEAR_R 內的地圖物件拿掉（隱藏、取消碰撞；離開展示時 labStart 會重建戰場）
    const w = this.world,
      R2 = CLEAR_R * CLEAR_R;
    const near = (x, z) => (x - C.x) ** 2 + (z - C.z) ** 2 < R2;
    for (const g of w.meshes)
      if (g !== w.terrainMesh && !g.userData.noFade && near(g.position.x, g.position.z)) g.visible = false;
    w.obstacles = w.obstacles.filter((o) => {
      if (!near(o.x, o.z)) return true;
      if (o.group) o.group.visible = false;
      return false;
    });
    L.demo = {
      i: L.demo ? L.demo.i : 0,
      auto: L.demo ? L.demo.auto : true,
      cam: L.demo ? L.demo.cam : 0,
      camA: L.demo ? L.demo.camA : CAMS[0][0],
      camH: L.demo ? L.demo.camH : 2.4,
      camD: L.demo ? L.demo.camD : 10,
      asm: { ...this.save.asm },
      C,
      B: 0,
    };
    this.labDemoUi();
    this.labDemoGo(L.demo.i);
  },
  labDemoExit() {
    const L = this.lab;
    if (!L || !L.demo) return;
    if (L.demo.dummy) this.labDemoDummyClear();
    $('labDemo').hidden = true;
    $('labDemoCap').hidden = true;
    L.demo = null;
  },
  // 空曠又平的地方：離障礙物最遠、周圍高低差小
  labDemoSpot() {
    const w = this.world,
      lim = w.lim * 0.6;
    let best = null,
      bs = -1e9;
    for (let k = 0; k < 400; k++) {
      const x = (Math.random() * 2 - 1) * lim,
        z = (Math.random() * 2 - 1) * lim;
      if (w.onCorridor(x, z, 3) || !w.slopeOK(x, z) || w.isVoid(x, z)) continue;
      let d = 40;
      for (const o of w.obstacles) {
        const e =
          o.kind === 'box'
            ? Math.max(Math.abs(x - o.x) - o.w / 2, Math.abs(z - o.z) - o.d / 2)
            : Math.hypot(x - o.x, z - o.z) - o.r;
        d = Math.min(d, e);
      }
      // 周圍 10／20／30 m 八個方向的高低差（山脊、斷崖會擋住鏡頭）
      const h = w.terrainHeight(x, z);
      let bump = 0;
      for (const r of [10, 20, 30])
        for (let k2 = 0; k2 < 8; k2++) {
          const an = (k2 / 8) * Math.PI * 2;
          bump += Math.abs(w.terrainHeight(x + Math.cos(an) * r, z + Math.sin(an) * r) - h) / r;
        }
      const s = Math.min(d, 30) - bump * 6;
      if (s > bs) {
        bs = s;
        best = V(x, h, z);
      }
    }
    return best || V(0, w.terrainHeight(0, 0), 0);
  },
  // 換到第 i 段：機體回到中心、換武器
  labDemoGo(i) {
    const L = this.lab,
      D = L.demo,
      p = this.player;
    D.i = (i + DEMO_SEGS.length) % DEMO_SEGS.length;
    D.t = 0;
    D.t0 = -1;
    D.mi = 0;
    D.ri = -1;
    D.mWait = 0.3;
    D.hrCapTxt = null;
    if (D.dummy) this.labDemoDummyClear();
    const seg = DEMO_SEGS[D.i];
    const want = { ...D.asm, ...(seg.w || {}) };
    if (['rarm', 'larm', 'rback', 'lback'].some((k) => p.asm[k] !== want[k])) {
      p.asm = want;
      p.swapModel();
      p.initWeapons();
    }
    p.melee.active = false;
    p.staggerT = 0;
    p.downed = false;
    p.vel.set(0, 0, 0);
    p.pos.copy(D.C);
    p.pos.y = this.world.terrainHeight(D.C.x, D.C.z);
    p.yaw = p.aimYaw = D.B;
    p.mesh.position.copy(p.pos);
    if (p.model.an) p.model.an.chkN = 30; // 不在其他段落檢查武器
    $('labDemoCap').innerHTML = `<b>${D.i + 1}. ${escHtml(seg.n)}</b><span>${escHtml(seg.s)}</span>`;
    for (const el of $('labDemoList').children) el.classList.toggle('on', +el.dataset.i === D.i);
    const cur = $('labDemoList').children[D.i];
    if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  },
  // 每格（實驗室的 labTick 在動作展示時呼叫）
  labDemoTick(dt) {
    const D = this.lab.demo;
    if (!D) return;
    const seg = DEMO_SEGS[D.i];
    D.t0 = D.t;
    D.t += dt;
    seg.run(D, D.t, dt, this);
    // 彈藥與 AP 一直補滿
    const p = this.player;
    for (const k in p.weapons) {
      const w = p.weapons[k];
      if (w.def && w.def.ammo) w.ammo = w.def.ammo;
    }
    p.hp = p.maxHp;
    p.en = p.enMax;
    if (D.t >= seg.d) this.labDemoGo(D.auto ? D.i + 1 : D.i);
  },
  // 移動：x＝往右、z＝往前（以這一段開始時的朝向為準）；face＝面向準星（側移、倒退），aim＝準星轉幾 rad
  labDemoMove(dt, x, z, o = {}) {
    const D = this.lab.demo,
      p = this.player,
      B = D.B;
    const wish = V(-Math.sin(B) * z + Math.cos(B) * x, 0, -Math.cos(B) * z - Math.sin(B) * x);
    p.aimYaw = B + (o.aim || 0);
    p.aimPitch = 0;
    p.fpFace = !!o.face;
    p.move(dt, wish, !!o.hover, !!o.qb, false, null);
    // 跑出太遠就拉回來（不撞到場地邊界與障礙物）
    if (p.pos.distanceTo(D.C) > 40 && !p.melee.active) {
      p.pos.copy(D.C);
      p.vel.set(0, 0, 0);
    }
  },
  // 前方的點（開火、近戰的目標）
  labDemoAhead(d) {
    const p = this.player;
    return p.pos.clone().add(V(-Math.sin(p.aimYaw) * d, 2.2, -Math.cos(p.aimYaw) * d));
  },
  labDemoFire(slot, dt) {
    const p = this.player,
      w = p.weapons[slot];
    if (!w || !w.def || w.dropped) return;
    if (w.def.mag) w.mag = Math.max(w.mag, 1);
    if (w.def.chargeT > 0) {
      w.charge += dt;
      if (w.charge < w.def.chargeT) return;
    }
    if (w.cd <= 0 && w.reloadT <= 0) p.fire(slot, this.labDemoAhead(45), null);
  },
  // 受擊：d＝[往右, 往前] 的推力方向（以機體座標，[0, 1]＝從前面打）；stag＝失衡秒數
  labDemoHit(d, k, stag) {
    const p = this.player,
      B = p.yaw;
    // 機體座標 → 世界：從前面打＝推力往機體後方（+Z）
    const dir = V(Math.cos(B) * d[0] + Math.sin(B) * d[1], 0, -Math.sin(B) * d[0] + Math.cos(B) * d[1]);
    p.hitAnim(dir, k);
    mechFlash(p.model);
    this.fx.flash(p.center().addScaledVector(dir, -1.5), 1.4, 0xffc070, 0.12);
    if (stag) {
      p.staggerT = stag;
      p.knockSide = Math.random() < 0.5 ? -1 : 1;
    }
  },
  // 擊破示範用的假人（玩家的組裝、敵方配色），在旁邊面向玩家
  labDemoDummy() {
    const D = this.lab.demo,
      p = this.player;
    const e = new MechEntity(this, { ...D.asm }, PALETTES.enemy, {
      team: 'enemy',
      name: 'DUMMY',
      palKey: 'enemy',
    });
    const B = D.B;
    const x = D.C.x + Math.cos(B) * 3 - Math.sin(B) * 9,
      z = D.C.z - Math.sin(B) * 3 - Math.cos(B) * 9;
    e.pos.set(x, this.world.terrainHeight(x, z), z);
    e.yaw = e.aimYaw = Math.atan2(-(p.pos.x - x), -(p.pos.z - z));
    e.mesh.position.copy(e.pos);
    e.mesh.rotation.y = e.yaw;
    D.dummy = e;
  },
  // 受擊展示的其他身體：spawnType 生成一台（不記成遇過、不跳介紹，實驗室不寫存檔），從敵人清單拿掉、由展示自己更新
  labDemoBody(type) {
    const D = this.lab.demo,
      p = this.player;
    this.labDemoDummyClear();
    if (!this.introSeen) this.introSeen = new Set();
    this.introSeen.add(type);
    const sim0 = this.sim;
    this.sim = sim0 || { labDemo: true }; // spawnType 的 simMark 只在不是模擬器時記錄
    let e = null;
    const n0 = this.enemies.length;
    try {
      e = this.spawnType(type, 1, 1, null, 1); // 只要 1 台（無人機這類平常一次一群）
    } finally {
      this.sim = sim0;
    }
    // 生成的全部從敵人清單拿掉（展示自己更新），多出來的清掉
    for (const x of this.enemies.slice(n0)) if (x !== e) x.cleanup();
    this.enemies.length = n0;
    if (!e) return;
    e.ai = 'none';
    e.hp = e.maxHp = 1e9;
    const B = D.B,
      dd = 9 * p.dk;
    const x = D.C.x - Math.sin(B) * dd,
      z = D.C.z - Math.cos(B) * dd;
    e.hrFly = e.flying ? 5 * p.dk : 0;
    e.pos.set(x, this.world.terrainHeight(x, z) + e.hrFly, z);
    e.yaw = e.aimYaw = Math.atan2(-(p.pos.x - x), -(p.pos.z - z));
    e.vel.set(0, 0, 0);
    e.mesh.position.copy(e.pos);
    const box = new THREE.Box3().setFromObject(e.mesh);
    e.hrSize = Math.max(box.max.y - box.min.y, box.max.x - box.min.x, box.max.z - box.min.z); // 鏡頭的距離
    D.dummy = e;
  },
  labDemoBodyTick(dt) {
    const e = this.lab.demo.dummy;
    if (!e || e.dead) return;
    const pos = e.pos.clone();
    e.move(dt, V(), false, false, false, null);
    e.pos.copy(pos); // 不動
    e.vel.set(0, 0, 0);
    e.hp = e.maxHp;
  },
  labDemoDummyClear() {
    const D = this.lab.demo;
    const e = D.dummy;
    D.dummy = null;
    if (!e) return;
    e.cleanup();
    this.scene.remove(e.mesh);
  },
  // 鏡頭：看著機體，角度以這一段開始時的朝向為準（camA），拖曳旋轉、滾輪縮放
  labDemoCamera(dt) {
    const L = this.lab,
      D = L.demo,
      p = this.player,
      cam = this.camera;
    const c = p.center();
    const focus = D.dummy && DEMO_SEGS[D.i].cam === 'dummy'; // 受擊展示的其他身體：看假人
    const D2 = focus
      ? D.dummy.center()
      : D.dummy && D.i === DEMO_SEGS.length - 1
        ? D.dummy.center().lerp(c, 0.5)
        : c;
    const a = D.B + D.camA + (focus ? Math.PI * 0.7 : 0); // 假人在玩家前方：從它的斜側面看（不和玩家排成一直線）
    // 擊破示範：拉遠看到兩台；受擊展示的其他身體：依它的外框大小（labDemoBody 量的 hrSize）
    const cd = focus ? Math.max(D.camD * 1.5, (D.dummy.hrSize || 10) * 3.5) : D.camD * (D.dummy ? 1.5 : 1);
    const pos = V(
      D2.x - Math.sin(a) * cd,
      D2.y + D.camH + (focus ? (D.dummy.hrSize || 10) * 0.35 : 0),
      D2.z - Math.cos(a) * cd,
    );
    pos.y = Math.max(pos.y, this.world.terrainHeight(pos.x, pos.z) + 1.2);
    const k = Math.min(1, dt * 10);
    if (L.snap) {
      cam.position.copy(pos);
      L.look.copy(D2);
      L.snap = false;
    } else {
      cam.position.lerp(pos, k);
      L.look.lerp(D2, k);
    }
    cam.lookAt(L.look);
    this.camTarget.copy(p.pos);
    this.sun.position.copy(p.pos).add(this.sunOff);
    this.sun.target.position.copy(p.pos);
    this.world.updateOcclusion(cam.position, L.look, dt);
    this.rangeRing.visible = false;
    this.camFocus = p;
  },
  labDemoPointer(type, e) {
    const L = this.lab,
      D = L.demo;
    if (type === 'down') L.drag = { x: e.clientX, y: e.clientY };
    else if (type === 'up') L.drag = null;
    else if (type === 'move' && L.drag) {
      D.camA -= (e.clientX - L.drag.x) * 0.006;
      D.camH = clamp(D.camH + (e.clientY - L.drag.y) * 0.02, -1, 12);
      L.drag.x = e.clientX;
      L.drag.y = e.clientY;
    } else if (type === 'wheel') D.camD = clamp(D.camD * (e.deltaY > 0 ? 1.1 : 0.9), 4, 40);
    return true;
  },
  labDemoUi() {
    const D = this.lab.demo;
    const box = $('labDemo');
    box.hidden = false;
    $('labDemoCap').hidden = false;
    box.innerHTML =
      `<div class="ldhead"><b>動作展示</b>` +
      `<button id="ldPrev" title="上一段（←）">◀</button><button id="ldRe" title="重播這一段（R）">↻</button><button id="ldNext" title="下一段（→）">▶</button></div>` +
      `<div class="ldrow"><label><input type="checkbox" id="ldAuto"${D.auto ? ' checked' : ''}> 連續播放</label>` +
      `<select id="ldCam" title="鏡頭（拖曳畫面旋轉、滾輪縮放）">${CAMS.map((c, i) => `<option value="${i}"${i === D.cam ? ' selected' : ''}>${c[1]}</option>`).join('')}</select></div>` +
      `<div id="labDemoList">${DEMO_SEGS.map((s, i) => `<button data-i="${i}">${i + 1}. ${escHtml(s.n)}</button>`).join('')}</div>`;
    $('ldPrev').onclick = () => this.labDemoGo(this.lab.demo.i - 1);
    $('ldNext').onclick = () => this.labDemoGo(this.lab.demo.i + 1);
    $('ldRe').onclick = () => this.labDemoGo(this.lab.demo.i);
    $('ldAuto').onchange = (e) => (this.lab.demo.auto = e.target.checked);
    $('ldCam').onchange = (e) => {
      const d = this.lab.demo;
      d.cam = +e.target.value;
      d.camA = CAMS[d.cam][0];
      d.camH = 2.4;
      d.camD = 10;
    };
    for (const b of $('labDemoList').querySelectorAll('button'))
      b.onclick = () => this.labDemoGo(+b.dataset.i);
  },
  labDemoKey(e) {
    if (e.code === 'ArrowLeft') this.labDemoGo(this.lab.demo.i - 1);
    else if (e.code === 'ArrowRight') this.labDemoGo(this.lab.demo.i + 1);
    else if (e.code === 'KeyR') this.labDemoGo(this.lab.demo.i);
    else return false;
    return true;
  },
});
