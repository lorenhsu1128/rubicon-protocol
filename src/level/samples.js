// 內建的範例關卡（關卡選單的「範例」）：可以直接玩，也可以複製到我的關卡再編輯，示範巡邏與警戒、
// 依序的增援波次、護送與伏擊。高度圖留空（n＝0），載入時由底圖重新產生。讀取時一樣經過 loadLevel。
const T0 = Date.UTC(2026, 9, 1);
const wall = (x, z, yaw = 0, w = 1, h = 1) => ({
  t: 'ed/wall',
  x,
  y: 0,
  z,
  g: true,
  yaw,
  s: [w, h, 1],
  col: 'box',
  hp: 0,
  tag: '',
});
const block = (x, z, w = 1, h = 1, d = 1) => ({
  t: 'ed/block',
  x,
  y: 0,
  z,
  g: true,
  yaw: 0,
  s: [w, h, d],
  col: 'box',
  hp: 0,
  tag: '',
});
const cont = (x, z, yaw = 0) => ({
  t: 'ed/container',
  x,
  y: 0,
  z,
  g: true,
  yaw,
  s: [1, 1, 1],
  col: 'box',
  hp: 900,
  tag: '',
});
let uid = 0;
const unit = (kind, type, x, z, g, beh = {}, at = 'start') => ({
  id: 'u' + ++uid,
  kind,
  type,
  x,
  y: 0,
  z,
  yaw: 0,
  g,
  at,
  k: 1,
  beh: { k: 'attack', path: '', r: 35, m: '', back: false, speed: 0.6, ...beh },
});
const trig = (id, name, ev, act, cond = []) => ({
  id,
  name,
  on: true,
  once: true,
  any: false,
  ev,
  cond,
  act,
});
const base = (theme, level, np = 1) => ({
  theme,
  variant: '',
  seed: 1,
  blank: true,
  props: 'none',
  tod: '',
  weather: '',
  zone: null,
  level,
  np,
});
const meta = (id, name, desc) => ({
  format: 'rubicon-level',
  v: 1,
  gen: '1',
  id,
  name,
  desc,
  author: 'RUBICON',
  created: T0,
  updated: T0,
  thumb: '',
  terrain: { n: 0, h: '', water: null },
  removed: [],
  segs: null,
  clear: { by: 'RUBICON', t: 1, at: T0 },
});

function patrolDemo() {
  uid = 0;
  const L = meta(
    'lvsamplepatrol01',
    '範例：巡邏與警戒',
    '巡邏隊沿著圍牆外繞圈，看到你才會出動；倉庫守衛在你靠近 30 m 內或被打中時整隊出動。全滅守衛後出口開啟。',
  );
  L.base = base('industrial', 3);
  L.props = [
    wall(30, -16, 0, 2.6),
    wall(30, 16, 0, 2.6),
    wall(17, -8, Math.PI / 2, 0.9),
    wall(43, 0, Math.PI / 2, 2.6),
    block(30, 0, 0.6, 0.6, 0.6),
    cont(22, 8),
    cont(-10, -20, Math.PI / 2),
    block(-20, 10, 0.5, 0.45, 0.5),
    cont(5, 30),
  ];
  L.marks = [
    { k: 'spawn', id: 'm1', name: '出生點', x: -55, y: 0, z: -40, yaw: -0.8 },
    { k: 'cache', id: 'm2', name: '倉庫的補給箱', x: 34, y: 0, z: 4, yaw: 0, cache: 'repair' },
    { k: 'exit', id: 'm3', name: '撤離點', x: 70, y: 0, z: 55, yaw: 0, open: false },
  ];
  L.paths = [
    {
      id: 'p1',
      name: '外圍巡邏',
      pts: [
        [0, -30, 2],
        [60, -30, 0],
        [60, 30, 2],
        [0, 30, 0],
      ],
      loop: true,
    },
  ];
  L.areas = [
    {
      id: 'a1',
      name: '倉庫',
      sh: 'circle',
      x: 30,
      z: 0,
      w: 20,
      d: 20,
      r: 20,
      yaw: 0,
      show: false,
      color: 0xffb020,
    },
  ];
  L.groups = [
    { id: 'g1', name: '巡邏隊', color: 0xff5050 },
    { id: 'g2', name: '倉庫守衛', color: 0xffb020 },
  ];
  L.units = [
    unit('enemy', 'mt', 0, -30, 'g1', { k: 'patrol', path: 'p1', r: 40, back: true }),
    unit('enemy', 'mt_shot', 4, -30, 'g1', { k: 'patrol', path: 'p1', r: 40, back: true }),
    unit('enemy', 'mth', 28, 4, 'g2', { k: 'guard', r: 30 }),
    unit('enemy', 'turret', 36, -6, 'g2', { k: 'guard', r: 30 }),
    unit('enemy', 'mt_shield', 24, -6, 'g2', { k: 'guard', r: 30 }),
  ];
  L.counters = [];
  L.triggers = [
    trig('t1', '開場', { k: 'start' }, [
      { k: 'obj', text: '清除倉庫守衛' },
      { k: 'comm', who: 'echo', name: '', text: '倉庫外圍有巡邏隊。守衛在倉庫裡，靠近就會被發現。' },
    ]),
    trig('t2', '接近倉庫', { k: 'enter', a: 'a1', who: 'any' }, [
      { k: 'comm', who: 'enemy', name: '', text: '入侵者！守衛全員迎擊！' },
    ]),
    trig('t3', '守衛全滅', { k: 'gdead', g: 'g2' }, [
      { k: 'tfx', cue: 'clear', m: '倉庫清除', s: '前往撤離點' },
      { k: 'open', m: 'm3' },
      { k: 'obj', text: '前往撤離點' },
    ]),
  ];
  return L;
}
function defendDemo() {
  uid = 0;
  const L = meta(
    'lvsampledefend01',
    '範例：據點防衛',
    '守住中央的發電設施，撐過三波增援。每一波全滅後 3 秒，下一波從不同方向進入或空降，ECHO 會預告方向。',
  );
  L.base = base('snow', 4);
  L.props = [
    wall(0, -14, 0, 1.4),
    wall(0, 14, 0, 1.4),
    wall(-14, 0, Math.PI / 2, 1.4),
    wall(14, 0, Math.PI / 2, 1.4),
    block(-25, -25, 0.5, 0.6, 0.5),
    block(25, 25, 0.5, 0.6, 0.5),
    cont(-30, 18),
    cont(30, -18, Math.PI / 2),
  ];
  L.marks = [
    { k: 'spawn', id: 'm1', name: '出生點', x: 0, y: 0, z: 8, yaw: 0 },
    { k: 'defend', id: 'm2', name: '發電設施', x: 0, y: 0, z: 0, yaw: 0, hp: 1.6 },
    { k: 'spawnpt', id: 'm3', name: '北方', x: 0, y: 0, z: -75, yaw: 0 },
    { k: 'spawnpt', id: 'm4', name: '東方', x: 60, y: 0, z: 20, yaw: 0 },
    { k: 'spawnpt', id: 'm5', name: '西方', x: -75, y: 0, z: 0, yaw: 0 },
    { k: 'supply', id: 'm6', name: '補給台', x: 20, y: 0, z: 30, yaw: 0, once: true },
  ];
  L.paths = [];
  L.areas = [];
  L.groups = [
    { id: 'g1', name: '第 1 波', color: 0xff5050 },
    { id: 'g2', name: '第 2 波', color: 0xffb020 },
    { id: 'g3', name: '第 3 波', color: 0xc090ff },
  ];
  L.units = [
    unit('enemy', 'mt', 0, -70, 'g1', {}, 'trig'),
    unit('enemy', 'mt', 4, -70, 'g1', {}, 'trig'),
    unit('enemy', 'mt_gren', -4, -70, 'g1', {}, 'trig'),
    unit('enemy', 'mt_shot', 60, 20, 'g2', {}, 'trig'),
    unit('enemy', 'drone', 62, 22, 'g2', {}, 'trig'),
    unit('enemy', 'mt_mortar', 58, 18, 'g2', {}, 'trig'),
    unit('enemy', 'ac_berserker', -70, 0, 'g3', {}, 'trig'),
    unit('enemy', 'mt', -70, 4, 'g3', {}, 'trig'),
    unit('enemy', 'mt_shield', -70, -4, 'g3', {}, 'trig'),
  ];
  L.counters = [{ id: 'c1', name: '波次', v: 0 }];
  L.triggers = [
    trig('t1', '第 1 波', { k: 'time', t: 3 }, [
      { k: 'obj', text: '守住發電設施（第 1／3 波）' },
      { k: 'spawn', g: 'g1', how: 'edge', m: 'm3', warn: '1' },
      { k: 'set', c: 'c1', v: 1 },
    ]),
    trig('t2', '第 2 波', { k: 'gdead', g: 'g1' }, [
      { k: 'wait', t: 3 },
      { k: 'obj', text: '守住發電設施（第 2／3 波）' },
      { k: 'spawn', g: 'g2', how: 'drop', m: 'm4', warn: '1' },
      { k: 'set', c: 'c1', v: 2 },
    ]),
    trig('t3', '第 3 波', { k: 'gdead', g: 'g2' }, [
      { k: 'wait', t: 3 },
      { k: 'tfx', cue: 'warning', m: 'WARNING', s: '敵對 AC 接近' },
      { k: 'obj', text: '守住發電設施（最終波）' },
      { k: 'spawn', g: 'g3', how: 'edge', m: 'm5', warn: '1' },
      { k: 'set', c: 'c1', v: 3 },
    ]),
    trig('t4', '勝利', { k: 'gdead', g: 'g3' }, [{ k: 'win' }], [{ k: 'counter', c: 'c1', op: '=', v: 3 }]),
  ];
  return L;
}
function convoyDemo() {
  uid = 0;
  const L = meta(
    'lvsampleconvoy01',
    '範例：護送車隊',
    '兩台裝甲車沿著路線前進，抵達終點就完成；車隊全毀就失敗。經過峽谷入口時會遭到伏擊。',
  );
  L.base = base('dunes', 4);
  L.props = [
    block(-20, -30, 1.4, 1.6, 0.6),
    block(-20, 10, 1.4, 1.6, 0.6),
    wall(30, -5, Math.PI / 2, 1.2),
    cont(45, 35),
    cont(-55, 20, Math.PI / 2),
  ];
  L.marks = [
    { k: 'spawn', id: 'm1', name: '出生點', x: -72, y: 0, z: -52, yaw: -0.6 },
    { k: 'spawnpt', id: 'm2', name: '伏擊點', x: -5, y: 0, z: -70, yaw: 0 },
    { k: 'spawnpt', id: 'm3', name: '第二伏擊點', x: 70, y: 0, z: -10, yaw: 0 },
    { k: 'supply', id: 'm4', name: '中途補給', x: 0, y: 0, z: 0, yaw: 0, once: true },
  ];
  L.paths = [
    {
      id: 'p1',
      name: '車隊路線',
      pts: [
        [-75, -60, 0],
        [-40, -10, 0],
        [0, -10, 0],
        [40, 20, 0],
        [75, 60, 0],
      ],
      loop: false,
    },
  ];
  L.areas = [
    {
      id: 'a1',
      name: '峽谷入口',
      sh: 'box',
      x: -20,
      z: -10,
      w: 30,
      d: 26,
      r: 10,
      yaw: 0,
      show: true,
      color: 0xff5050,
    },
    {
      id: 'a2',
      name: '後半段',
      sh: 'circle',
      x: 40,
      z: 20,
      w: 20,
      d: 20,
      r: 16,
      yaw: 0,
      show: false,
      color: 0xffb020,
    },
  ];
  L.groups = [
    { id: 'g1', name: '車隊', color: 0x7ee081 },
    { id: 'g2', name: '伏擊隊', color: 0xff5050 },
    { id: 'g3', name: '追兵', color: 0xffb020 },
  ];
  L.units = [
    unit('convoy', 'convoy', -75, -60, 'g1', { k: 'patrol', path: 'p1', speed: 0.6 }),
    unit('convoy', 'convoy', -80, -66, 'g1', { k: 'patrol', path: 'p1', speed: 0.6 }),
    unit('enemy', 'mt', -5, -70, 'g2', {}, 'trig'),
    unit('enemy', 'mt_gren', -2, -70, 'g2', {}, 'trig'),
    unit('enemy', 'tank', -8, -70, 'g2', {}, 'trig'),
    unit('enemy', 'heli', 70, -10, 'g3', {}, 'trig'),
    unit('enemy', 'mt_shot', 70, -6, 'g3', {}, 'trig'),
  ];
  L.counters = [];
  L.triggers = [
    trig('t1', '開場', { k: 'start' }, [
      { k: 'obj', text: '護送車隊抵達終點' },
      { k: 'comm', who: 'ally', name: '', text: '車隊出發。前面的峽谷入口要小心。' },
    ]),
    trig('t2', '伏擊', { k: 'enter', a: 'a1', who: 'any' }, [
      { k: 'spawn', g: 'g2', how: 'edge', m: 'm2', warn: '1' },
      { k: 'area', a: 'a1', on: '0' },
    ]),
    trig('t3', '追兵', { k: 'enter', a: 'a2', who: 'any' }, [
      { k: 'spawn', g: 'g3', how: 'drop', m: 'm3', warn: '1' },
    ]),
  ];
  return L;
}
export const SAMPLES = [patrolDemo, defendDemo, convoyDemo];
