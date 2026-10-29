// Boss 改版（docs/boss-design.md 第 3 節）：每隻 Boss 的專屬內容，純資料。鍵＝MechEntity.boss3Key()
// （kind，沒有 kind 的用名稱開頭 JUGGERNAUT／STRIDER／BALTEUS）。
// 欄位（都可以省略，省略時用 mech-boss-tier.js 的共用版本）：
//   star：刁鑽度 1～2 只偵測的那一種習慣（'air'／'close'／'far'／'cover'）
//   habits：刁鑽度 3～4 偵測的兩種（第一個是 star）
//   parts：部位 [{ id, name, off: [x, y, z]（Boss 身高的倍數，Boss 的座標：+Z 往前）, stops: [招式 id], back, expose }]
//   reflect：可以打掉的彈體種類（Projectile 的 kind：'missile'／'shell'／'grenade'…）
//   open2／open1：有破綻的大招（刁鑽度 3～4／5～8）
//   big：[第一型態, 第二型態]（第三型態＝mech-boss3.js 的 SPECIALS）的 [名稱, fn]——放在 mech-boss-tier.js
//   field：{ 2: 'cover'|'fire'|'smoke'|…, 3: … }（換型態的場地）
// 第 3～5 期依 docs/boss-design.md 逐隻補上。

// 刁鑽度 1～2 的應對（設計文件標★的那一種；沒有標的依 Boss 的打法）
export const C_STAR = {
  artillery: 'close',
  worm: 'air',
  JUGGERNAUT: 'close',
  railgun: 'cover',
  heli: 'close',
  rampart: 'far',
  train: 'close',
  furnace: 'air',
  STRIDER: 'close',
  phantom: 'far',
  ibis: 'far',
  spider: 'air',
  trinity: 'far',
  hunter: 'air',
  orbital: 'cover',
  flagship: 'far',
  fortress: 'close',
  interceptor: 'air',
  duo: 'cover',
  funnel: 'cover',
  mirror: 'close',
  BALTEUS: 'far',
};
export const HABITS = ['air', 'close', 'far', 'cover'];
export const HABIT_NAMES = { air: '空中', close: '貼身', far: '遠距', cover: '掩體' };

export const BOSS_KIT = {};
// ---------- 第 1、2 章的 Boss（第 3 期）----------
// big／counter／field 的函式：(b＝Boss, pl＝目標) 或 (g＝Game, b, T＝刁鑽度的參數)；部位的 off＝Boss 身高的倍數（+Z 往前）
// flag＝打壞時停用的機能（各 Boss 的 AI 用 b.tierFlag(flag) 看），slots＝停用的武器，speedK／hoverK＝移動與高度的倍率
const K1 = {};
// BASTILLE 砲兵陣地
K1.artillery = {
  tip: 'BASTILLE — 飽和砲擊之後砲管冷卻是破綻；雷達天線壞了砲擊不再預判落點、布雷器壞了不再補地雷',
  parts: [
    { id: 'radar', name: '雷達天線', off: [0, 1.05, 0.05], flag: 'lead' },
    { id: 'mine', name: '布雷器', off: [0, 0.55, -0.5], flag: 'mines', back: true },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['集中砲擊', (b, pl) => b.b3Rain(pl, 7, 5, 0.18)],
    ['追蹤彈幕', (b, pl) => b.b3Rain(pl, 10, 9, 0.3)],
  ],
  reflect: ['mortar'],
  field: {
    // 二型：地雷區擴大、壞掉的砲台變成掩體
    2: (g, b) => {
      if (!b.tierFlag('mines')) b.b3Mines(g.playersAlive()[0] || b, 6, 14);
      for (const c of g.enemies.filter(
        (e) => e.dead && e.opts.parent === b.id && e.opts.partKind === 'cannon',
      ))
        g.addTempWall(c.pos.clone(), {
          kind: 'rock',
          w: 8 * g.fx.k,
          h: 4 * g.fx.k,
          d: 2 * g.fx.k,
          hp: 1600,
          life: 90,
        });
      g.flashAlert('戰場改變 — 地雷區擴大，壞掉的砲台成為掩體');
    },
    // 三型：塵土煙霧、作戰區域縮到陣地周圍
    3: (g, b, T) => {
      g.tierSmoke(b, 18, T.eMove);
      g.tierShrinkZone(Math.min(T.eZone, 0.6), b.pos);
    },
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 3, 0.12), // 防空砲彈
    close: (b) => b.b3Shock(16), // 指揮所周圍的噴射衝擊波
    far: (b, pl) => b.b3Rain(pl, 5, 4, 0.25), // 砲擊改成追蹤落點
    cover: (b, pl) => b.b3Rain(pl, 6, 3, 0.3), // 曲射越過掩體
  },
};
// SANDWORM 巨型鑽地蟲
K1.worm = {
  tip: 'SANDWORM — 鑽出撲空時身體卡在地上是破綻；頭部感測器壞了鑽出點不再追著你、鑽頭顎壞了沒有地下衝刺',
  parts: [
    { id: 'sensor', name: '頭部感測器', off: [0, 0.75, 0.35], flag: 'track' },
    { id: 'jaw', name: '鑽頭顎', off: [0, 0.3, 0.55], flag: 'bite' },
    { id: 'vent', name: '背部排氣孔', off: [0, 0.7, -0.45], stops: ['p3'], back: true },
  ],
  canCharge: (b) => b.aiState.wm === 'up', // 只在鑽出來的時候蓄力（地下打不到）
  open2: ['p1', 'p3'],
  open1: ['p3'],
  big: [
    ['噴砂吐息', (b, pl) => b.b3Fan(pl, 3, 0.25)],
    ['連續鑽出', (b, pl) => b.b3Erupt(pl, 3, 7)],
  ],
  field: {
    // 二型：流沙區（往中心吸、緩速）、碎掉的岩柱成為高台
    2: (g, b) => {
      const pl = g.playersAlive()[0];
      if (pl)
        g.addZone('suction', pl.pos.clone(), 14 * g.fx.k, 30, {
          src: b,
          to: pl.pos.clone(),
          pull: 5 * g.fx.k,
        });
      g.tierWalls(b, 2, { h: 7, w: 6, d: 6, life: 80 });
      g.flashAlert('戰場改變 — 流沙區，碎掉的岩柱成為高台');
    },
    3: (g, b, T) => {
      g.tierPools(b, 3, 'player', 7);
      g.tierShrinkZone(Math.min(T.eZone, 0.7));
    },
  },
  counter: {
    air: (b, pl) => b.b3Erupt(pl, 1, 0), // 從地下撲向空中
    close: (b) => b.b3Shock(16), // 鑽出時周圍的衝擊波
    far: (b, pl) => b.b3Erupt(pl, 2, 4), // 地下高速移動到你腳下
    cover: (b, pl) => b.b3Erupt(pl, 2, 3), // 從掩體下方鑽出
  },
};
// JUGGERNAUT 戰略級移動要塞
K1.JUGGERNAUT = {
  tip: 'JUGGERNAUT — 衝撞撞空的滑停、齊射之後是破綻；肩上飛彈莢艙、主砲、履帶可以打壞',
  parts: [
    { id: 'pod', name: '肩上飛彈莢艙', off: [0.42, 0.95, 0], slots: ['rback'], stops: ['p2'] },
    { id: 'gun', name: '主砲', off: [-0.42, 0.85, 0.15], slots: ['larm'], stops: ['p3'] },
    { id: 'track', name: '履帶', off: [0, 0.12, -0.4], speedK: 0.65, back: true },
  ],
  open2: ['p2', 'p3'],
  open1: ['p2'],
  big: [
    ['主砲蓄力', (b, pl) => b.b3Line(pl, 5, 4.5, 0.12)],
    ['齊射', (b, pl) => b.b3Volley(pl, 3, 0.3, ['rback', 'lback'])],
  ],
  reflect: ['missile'],
  field: {
    2: (g, b) => {
      g.tierWalls(b, 4, { h: 2.4, w: 5, d: 2, life: 90, spread: 22 }); // 彈坑的土堤
      g.flashAlert('戰場改變 — 砲擊留下的彈坑可以當掩體');
    },
    3: (g, b) => g.tierPools(b, 4, 'line', 6),
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.15, ['rarm']), // 對空機槍
    close: (b) => b.tierRush(), // 履帶輾壓衝撞
    far: (b, pl) => b.b3Line(pl, 4, 5, 0.15), // 長程砲
    cover: (b, pl) => b.b3Rain(pl, 5, 4, 0.25), // 曲射榴彈
  },
};
// HALBERD 超長程電磁砲台
K1.railgun = {
  tip: 'HALBERD — 貫穿砲擊後散熱片打開是破綻；散熱片壞了冷卻更久、電容器組壞了充能變慢、瞄準感測器壞了瞄準線跟得慢',
  parts: [
    { id: 'cap', name: '電容器組', off: [0.45, 0.45, 0], flag: 'cap' },
    { id: 'sensor', name: '瞄準感測器', off: [0, 1.0, 0.3], flag: 'aim' },
    { id: 'fin', name: '散熱片', off: [0, 0.7, -0.45], flag: 'vent', back: true },
  ],
  open2: ['p1', 'p3'],
  open1: ['p1'],
  big: [
    ['貫穿砲擊', (b, pl) => b.b3Fan(pl, 1, 0)],
    ['連射', (b, pl) => b.b3Fan(pl, 3, 0.1)],
  ],
  field: {
    // 二型：被貫穿的掩體碎掉、新的臨時掩體牆升起
    2: (g, b) => {
      g.tierWalls(b, 3, { h: 4.5, w: 7, d: 1.6, life: 70 });
      g.flashAlert('戰場改變 — 新的掩體牆升起');
    },
    3: (g, b, T) => {
      g.tierSmoke(b, 16, T.eMove);
      g.tierShrinkZone(Math.min(T.eZone, 0.75));
    },
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 3, 0.15), // 散射對空
    close: (b) => b.b3Ring(14), // 近防電弧
    far: (b, pl) => b.b3Fan(pl, 1, 0), // 充能加速
    cover: (b, pl) => b.b3Pillars(pl, 2, 3), // 穿甲彈打穿掩體
  },
};
// HELIOS 重武裝母艦直升機
K1.heli = {
  tip: 'HELIOS — 地毯轟炸後拉高、投放空降兵時艙門打開是破綻；主旋翼壞了高度下降、機槍莢艙與炸彈艙可以打壞',
  parts: [
    { id: 'pod', name: '側邊機槍莢艙', off: [0.5, 0.35, 0.1], slots: ['rarm'] },
    { id: 'rotor', name: '主旋翼', off: [0, 1.0, 0], hoverK: 0.45 },
    { id: 'bay', name: '炸彈艙', off: [0, 0.02, -0.15], stops: ['p3'], back: true },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['投放空降兵', (b) => b.game.tierDrop(b, 2)],
    ['火箭齊射', (b, pl) => b.b3Volley(pl, 3, 0.25, ['larm'])],
  ],
  reflect: ['shell', 'missile'],
  field: {
    2: (g, b) => g.tierPools(b, 4, 'line', 6),
    3: (g, b, T) => g.tierSmoke(b, 18, T.eMove),
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.15, ['rarm']), // 機槍掃射上方
    close: (b, pl) => {
      // 下洗氣流推開＋燃燒彈
      const d = pl.pos.clone().sub(b.pos).setY(0);
      if (d.lengthSq() > 0.01) pl.vel.addScaledVector(d.normalize(), 22 * b.dk);
      b.b3Pools(pl, 2, 5);
    },
    far: (b, pl) => b.b3Volley(pl, 2, 0.3, ['larm']), // 飛彈
    cover: (b, pl) => b.b3Line(pl, 5, 4, 0.1), // 轟炸掩體
  },
};
// BEHEMOTH 衝撞推土要塞
K1.rampart = {
  tip: 'BEHEMOTH — 撞牆硬直、衝撞落空的滑停是破綻；推土鏟壞了撞不碎掩體、排氣管壞了不能連續衝撞',
  parts: [
    { id: 'blade', name: '推土鏟', off: [0, 0.35, 0.6], flag: 'blade' },
    { id: 'turret', name: '側面砲塔', off: [0.5, 0.75, 0], flag: 'side' },
    { id: 'exhaust', name: '排氣管', off: [0, 0.9, -0.45], flag: 'exhaust', back: true },
  ],
  open2: ['p1', 'p2'],
  open1: ['p2'],
  big: [
    ['引擎蓄力衝撞', (b) => (b.b3Shock(24), b.tierRush())],
    ['連續衝撞', (b) => (b.b3Shocks(2, 0.8), b.tierRush())],
  ],
  field: {
    // 二型：多出可以打碎的混凝土牆（誘它撞）
    2: (g, b) => {
      g.tierWalls(b, 4, { h: 4, w: 8, d: 2, hp: 900, life: 90, spread: 26 });
      g.flashAlert('戰場改變 — 混凝土牆：誘它撞上去');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 3, 0.2), // 散彈對空
    close: (b) => b.b3Shock(14), // 原地旋轉甩尾
    far: (b) => b.tierRush(), // 連續衝撞
    cover: (b) => b.tierRush(), // 衝撞撞碎掩體
  },
};
// IRON CITADEL 武裝列車
K1.train = {
  tip: 'IRON CITADEL — 衝撞後鍋爐過熱是破綻；煙囪閥壞了過熱更久，四節車廂各負責一種攻擊',
  parts: [{ id: 'valve', name: '煙囪閥', off: [0, 1.05, 0.25], flag: 'valve' }],
  canCharge: (b) => !b.inTunnel(),
  open2: ['p1', 'p3'],
  open1: ['p3'],
  big: [
    ['停車的雷射舷砲', (b, pl) => b.b3Fan(pl, 3, 0.2)],
    ['飛彈齊射', (b, pl) => b.b3Rain(pl, 8, 12, 0.25)],
  ],
  field: {
    2: (g, b) => {
      g.tierWalls(b, 3, { h: 4, w: 7, d: 1.6, life: 90 });
      g.flashAlert('戰場改變 — 鐵路旁升起掩體');
    },
    3: (g, b) => {
      g.tierPools(b, 4, 'boss', 10);
      g.flashAlert('戰場改變 — 軌道兩側起火');
    },
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.15), // 防空車廂集中射擊
    close: (b, pl) => b.b3Line(pl, 5, 4, 0.08), // 站在軌道上：加速衝撞
    far: (b, pl) => b.b3Fan(pl, 3, 0.18), // 雷射舷砲
    cover: (b, pl) => b.b3Mines(pl, 4, 8), // 布雷
  },
};
// CINDER 熔爐清掃機
K1.furnace = {
  tip: 'CINDER — 爐口打開是破綻（打掉的熔渣落回它腳下）；熔渣砲、噴火口可以打壞，爐門鉸鏈壞了爐口開得更久',
  parts: [
    { id: 'slag', name: '熔渣砲', off: [0.4, 0.8, 0.1], flag: 'slag' },
    { id: 'flame', name: '噴火口', off: [0, 0.4, 0.55], flag: 'flame' },
    { id: 'hinge', name: '爐門鉸鏈', off: [-0.4, 0.6, -0.4], flag: 'hinge', back: true },
  ],
  open2: ['p1', 'p3'],
  open1: ['p3'],
  big: [
    ['熔渣連射', (b, pl) => b.b3Pools(pl, 3, 8)],
    ['火牆', (b) => b.b3Ring(30)],
  ],
  reflect: ['mortar'],
  reflectPool: true,
  field: {
    2: (g, b) => g.tierPools(b, 5, 'player', 10),
    // 三型：冷卻水管破裂，蒸氣煙霧（另有熄火的安全區：掩體牆）
    3: (g, b, T) => {
      g.tierSmoke(b, 18, T.eMove);
      g.tierWalls(b, 2, { h: 4, w: 6, d: 1.5, life: 60 });
    },
  },
  counter: {
    air: (b) => b.b3Ring(20), // 熱浪
    close: (b) => b.b3Shock(14), // 近身火焰
    far: (b, pl) => b.b3Pools(pl, 2, 6), // 熔渣砲
    cover: (b) => b.b3Ring(30), // 火牆繞過掩體
  },
};
Object.assign(BOSS_KIT, K1);

export function bossKitOf(key) {
  return BOSS_KIT[key] || null;
}
