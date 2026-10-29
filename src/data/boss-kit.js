// Boss 改版（docs/boss-design.md 第 3 節）：每隻 Boss 的專屬內容，純資料。鍵＝MechEntity.boss3Key()
// （kind，沒有 kind 的用名稱開頭 JUGGERNAUT／STRIDER／BALTEUS）。
// 欄位（都可以省略，省略時用 mech-boss-tier.js 的共用版本）：
//   star：刁鑽度 1～2 只偵測的那一種習慣（'air'／'close'／'far'／'cover'）
//   habits：刁鑽度 3～4 偵測的兩種（第一個是 star）
//   parts：部位 [{ id, name, model（造型：render/boss-models.js 的 BP），off: [x, y, z]（Boss 身高的倍數，Boss 的座標：+Z 往前）, size（模型的倍率）, stops: [招式 id], back, expose }]
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
    { id: 'radar', name: '雷達天線', model: 'radar', off: [0, 1.05, 0.05], flag: 'lead' },
    { id: 'mine', name: '布雷器', model: 'mines', off: [0, 0.55, -0.5], flag: 'mines', back: true },
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
    { id: 'sensor', name: '頭部感測器', model: 'sensor', off: [0, 0.75, 0.35], flag: 'track' },
    { id: 'jaw', name: '鑽頭顎', model: 'jaw', off: [0, 0.3, 0.55], flag: 'bite' },
    { id: 'vent', name: '背部排氣孔', model: 'vent', off: [0, 0.7, -0.45], stops: ['p3'], back: true },
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
    {
      id: 'pod',
      name: '肩上飛彈莢艙',
      model: 'missiles',
      off: [0.42, 0.95, 0],
      slots: ['rback'],
      stops: ['p2'],
    },
    { id: 'gun', name: '主砲', model: 'cannon', off: [-0.42, 0.85, 0.15], slots: ['larm'], stops: ['p3'] },
    { id: 'track', name: '履帶', model: 'track', off: [0, 0.12, -0.4], speedK: 0.65, back: true },
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
    { id: 'cap', name: '電容器組', model: 'capacitor', off: [0.45, 0.45, 0], flag: 'cap' },
    { id: 'sensor', name: '瞄準感測器', model: 'sensor', off: [0, 1.0, 0.3], flag: 'aim' },
    { id: 'fin', name: '散熱片', model: 'fins', off: [0, 0.7, -0.45], flag: 'vent', back: true },
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
    { id: 'pod', name: '側邊機槍莢艙', model: 'gunpod', off: [0.5, 0.35, 0.1], slots: ['rarm'] },
    { id: 'rotor', name: '主旋翼', model: 'rotor', off: [0, 1.0, 0], hoverK: 0.45 },
    { id: 'bay', name: '炸彈艙', model: 'bombbay', off: [0, 0.02, -0.15], stops: ['p3'], back: true },
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
    { id: 'blade', name: '推土鏟', model: 'blade', off: [0, 0.35, 0.6], flag: 'blade' },
    { id: 'turret', name: '側面砲塔', model: 'turret', off: [0.5, 0.75, 0], flag: 'side' },
    { id: 'exhaust', name: '排氣管', model: 'vent', off: [0, 0.9, -0.45], flag: 'exhaust', back: true },
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
  parts: [{ id: 'valve', name: '煙囪閥', model: 'valve', off: [0, 1.05, 0.25], flag: 'valve' }],
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
    { id: 'slag', name: '熔渣砲', model: 'slag', off: [0.4, 0.8, 0.1], flag: 'slag' },
    { id: 'flame', name: '噴火口', model: 'nozzle', off: [0, 0.4, 0.55], flag: 'flame' },
    { id: 'hinge', name: '爐門鉸鏈', model: 'hinge', off: [-0.4, 0.6, -0.4], flag: 'hinge', back: true },
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
// ---------- 第 3、4 章的 Boss（第 4 期）----------
const K2 = {};
// STRIDER 巡邏用超大型四足
K2.STRIDER = {
  tip: 'STRIDER — 十字雷射後砲管過熱、跳躍落地是破綻；背部雷射砲可以打壞，左右前腳都壞了會跪下 6 秒',
  parts: [
    {
      id: 'laser',
      name: '背部雷射砲',
      model: 'laser',
      off: [0, 0.95, -0.15],
      slots: ['lback'],
      stops: ['p3'],
    },
    { id: 'legL', name: '左前腳', model: 'legplate', off: [-0.45, 0.25, 0.35], flag: 'legL' },
    { id: 'legR', name: '右前腳', model: 'legplate', off: [0.45, 0.25, 0.35], flag: 'legR', back: false },
  ],
  // 兩隻前腳都壞了：跪下 6 秒（破綻），之後重新站起
  onLost: (g, b) => {
    if (!b.tierFlag('legL') || !b.tierFlag('legR') || b.aiState.knelt) return;
    b.aiState.knelt = true;
    b.stagGuardT = 0;
    b.acs = b.acsMax;
    b.staggerT = Math.max(b.staggerT, 6);
    b.bossOpen(6);
    g.netEv({ t: 'stag', i: b.id });
    g.flashMsg('STRIDER 跪下 — 前腳全毀！', 0x7ee081, 2);
  },
  open2: ['p3', 'p2'],
  open1: ['p3'],
  big: [
    ['雷射蓄力', (b, pl) => b.b3Fan(pl, 1, 0)],
    ['跳躍踩踏', (b) => b.b3Shocks(2, 0.6)],
  ],
  reflect: ['grenade', 'missile'],
  field: {
    2: (g, b) => {
      const pl = g.playersAlive()[0];
      if (pl)
        g.addZone('suction', pl.pos.clone(), 18 * g.fx.k, 30, {
          src: b,
          to: b.pos.clone(),
          pull: 3 * g.fx.k,
        });
      g.flashAlert('戰場改變 — 冰面：腳下會滑');
    },
    3: (g, b, T) => {
      g.tierSmoke(b, 20, T.eMove);
      g.tierShrinkZone(Math.min(T.eZone, 0.75));
    },
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 2, 0.12), // 對空雷射
    close: (b) => b.b3Shock(18), // 腹下：踩踏衝擊波
    far: (b, pl) => b.b3Fan(pl, 1, 0), // 雷射
    cover: (b, pl) => b.b3Rain(pl, 5, 4, 0.25), // 榴彈
  },
};
// MIRAGE 光學迷彩電戰機
K2.phantom = {
  tip: 'MIRAGE — 現形開火之後、分身突襲收招是破綻；迷彩發生器、分身投影器、干擾天線可以打壞',
  parts: [
    { id: 'gen', name: '迷彩發生器', model: 'cloak', off: [0, 0.75, -0.3], flag: 'cloak' },
    { id: 'proj', name: '分身投影器', model: 'projector', off: [0.4, 0.7, 0.1], flag: 'holo' },
    { id: 'jam', name: '干擾天線', model: 'jammer', off: [0, 1.05, 0], stops: ['p1'] },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['鎖定干擾', (b) => b.b3Ring(26)],
    ['分身展開', (b) => b.game.spawnHolos(b, b.tierFlag('holo') ? 1 : 2)],
  ],
  field: {
    2: (g, b, T) => g.tierSmoke(b, 18, T.eMove),
    3: (g, b) => {
      g.spawnHolos(b, b.tierFlag('holo') ? 1 : 2);
      g.tierPools(b, 3, 'player', 6);
      g.flashAlert('戰場改變 — 全場變暗、分身增加');
    },
  },
  counter: {
    air: (b, pl) => b.b3Pillars(pl, 2, 4), // 分身從上方突襲
    close: (b) => b.b3Ring(16), // 迷彩後退
    far: (b) => b.game.spawnHolos(b, 1), // 分身突襲
    cover: (b, pl) => b.b3Rain(pl, 4, 3, 0.25), // 繞到背後
  },
};
// PULSAR 脈衝刃翼
K2.ibis = {
  tip: 'PULSAR — 過熱是破綻；穿過能量環的 QB 一定給反擊點；左右翼刃各負責一種斬擊、環發生器壞了能量環變慢',
  parts: [
    { id: 'wingL', name: '左翼刃', model: 'wingblade', off: [-0.55, 0.6, 0], flag: 'wingL' },
    { id: 'wingR', name: '右翼刃', model: 'wingblade', off: [0.55, 0.6, 0], flag: 'wingR' },
    { id: 'ring', name: '環發生器', model: 'ringgen', off: [0, 0.5, -0.4], flag: 'ring', back: true },
  ],
  open2: ['p1', 'p3'],
  open1: ['p3'],
  big: [
    ['雷射扇形', (b, pl) => b.b3Fan(pl, 4, 0.18)],
    ['直線突刺', (b, pl) => b.b3Line(pl, 6, 4, 0.08)],
  ],
  field: {
    2: (g, b) => {
      const pl = g.playersAlive()[0];
      if (pl) g.tierPools(b, 3, 'player', 6);
      g.flashAlert('戰場改變 — 能量殘留區');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b) => b.b3Ring(30), // 向上的能量環
    close: (b) => b.b3Shock(14), // 翼刃迴旋
    far: (b, pl) => b.b3Line(pl, 5, 4, 0.08), // 直線突刺
    cover: (b, pl) => b.b3Fan(pl, 4, 0.2), // 雷射扇形掃過掩體
  },
};
// ARACHNE 多足要塞
K2.spider = {
  tip: 'ARACHNE — 倒下、跳躍落地是破綻；六條腳斷三條會倒下，背部砲塔壞了沒有布雷與砲擊',
  parts: [
    { id: 'turret', name: '背部砲塔', model: 'mortar', off: [0, 1.0, -0.1], flag: 'mines', stops: ['p1'] },
  ],
  canCharge: (b) => b.grounded,
  open2: ['p2', 'p3'],
  open1: ['p2'],
  big: [
    ['砲塔齊射', (b, pl) => b.b3Rain(pl, 7, 10, 0.25)],
    ['跳躍', (b) => b.b3Shocks(2, 0.7)],
  ],
  reflect: ['missile', 'grenade', 'shell'],
  field: {
    2: (g, b) => {
      g.tierPools(b, 3, 'player', 8);
      g.flashAlert('戰場改變 — 平台崩落一部分');
    },
    3: (g, b, T) => {
      g.tierSmoke(b, 18, T.eMove);
      g.tierShrinkZone(Math.min(T.eZone, 0.75));
    },
  },
  counter: {
    air: (b) => b.b3Shock(22), // 跳躍撲擊
    close: (b) => b.b3Shocks(2, 0.6), // 震地
    far: (b, pl) => b.b3Rain(pl, 5, 6, 0.25), // 砲塔
    cover: (b, pl) => b.b3Rain(pl, 5, 3, 0.25), // 曲射
  },
};
// CERBERUS 三機合體
K2.trinity = {
  tip: 'CERBERUS — 合體動作中、分離的瞬間是破綻；α 的刃、β 的狙擊砲、γ 的修理臂打壞了，分離之後那一台變弱',
  parts: [
    { id: 'a', name: 'α 的刃', model: 'saber', off: [-0.45, 0.6, 0.2], flag: 'alpha' },
    { id: 'b', name: 'β 的狙擊砲', model: 'sniper', off: [0.45, 0.85, 0.1], flag: 'beta' },
    { id: 'c', name: 'γ 的修理臂', model: 'repair', off: [0, 0.7, -0.45], flag: 'gamma', back: true },
  ],
  canCharge: (b) => !b.noLock,
  open2: ['p2', 'p3'],
  open1: ['p2'],
  big: [
    ['三連射', (b, pl) => b.b3Volley(pl, 3, 0.25)],
    ['分離前的集結', (b) => b.b3Ring(30)],
  ],
  field: {
    2: (g, b) => {
      g.tierWalls(b, 3, { h: 5, w: 6, d: 2.5, life: 90 });
      g.flashAlert('戰場改變 — 吊掛的貨櫃落下');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 1, 0), // β 對空狙擊
    close: (b) => b.tierRush(), // α 突進
    far: (b, pl) => b.b3Fan(pl, 1, 0), // β 狙擊
    cover: (b, pl) => b.b3Mines(pl, 4, 8), // γ 布雷
  },
};
// NULLIFIER 電磁狩獵機
K2.hunter = {
  tip: 'NULLIFIER — EMP 放完的散熱是破綻；EMP 線圈壞了範圍變小、牽引錨壞了沒有牽引、背部電容壞了電磁風暴變弱',
  parts: [
    { id: 'coil', name: 'EMP 線圈', model: 'coil', off: [0, 0.8, 0.2], flag: 'coil' },
    { id: 'anchor', name: '牽引錨', model: 'anchor', off: [0.45, 0.5, 0.1], flag: 'anchor' },
    { id: 'cap', name: '背部電容', model: 'capacitor', off: [0, 0.7, -0.45], weak: ['p3'], back: true },
  ],
  open2: ['p1', 'p3'],
  open1: ['p1'],
  big: [
    ['EMP 充能', (b) => b.game.hunterEmp(b, (b.tierFlag('coil') ? 12 : 20) * b.dk)],
    ['牽引', (b, pl) => (b.tierFlag('anchor') ? b.b3Mines(pl, 4, 8) : ((pl.pullT = 2), (pl.pullSrc = b)))],
  ],
  field: {
    2: (g, b) => {
      g.tierPools(b, 3, 'player', 7);
      g.flashAlert('戰場改變 — 電擊地面');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => {
      // 牽引拉下來
      if (!b.tierFlag('anchor')) {
        pl.pullT = 1.2;
        pl.pullSrc = b;
      }
      b.b3Fan(pl, 1, 0);
    },
    close: (b) => b.game.hunterEmp(b, (b.tierFlag('coil') ? 8 : 12) * b.dk), // 近身 EMP
    far: (b, pl) => b.b3Volley(pl, 2, 0.25), // 電磁彈
    cover: (b, pl) => {
      // 牽引把你拉出掩體
      if (!b.tierFlag('anchor')) {
        pl.pullT = 1.5;
        pl.pullSrc = b;
      } else b.b3Rain(pl, 4, 3, 0.25);
    },
  },
};
// JUDGEMENT 衛星砲導引塔
K2.orbital = {
  tip: 'JUDGEMENT — 光柱結束後導引鏡冷卻是破綻；導引天線壞了光柱追得慢、中繼碟壞了沒有格子砲擊',
  parts: [
    { id: 'ant', name: '導引天線', model: 'beacon', off: [0.35, 1.0, 0], flag: 'antenna' },
    {
      id: 'relay',
      name: '中繼碟',
      model: 'dish',
      off: [0, 0.8, -0.4],
      flag: 'relay',
      stops: ['p2'],
      back: true,
    },
    { id: 'ant2', name: '導引天線（副）', model: 'beacon', off: [-0.35, 1.0, 0], flag: 'antenna' },
  ],
  open2: ['p1', 'p3'],
  open1: ['p1'],
  big: [
    ['追蹤光柱', (b, pl) => b.b3Pillars(pl, 3, 8)],
    ['格子砲擊', (b, pl) => b.b3Rain(pl, 10, 14, 0.15)],
  ],
  field: {
    2: (g, b) => {
      g.tierPools(b, 4, 'player', 7);
      g.flashAlert('戰場改變 — 光柱打過的地面燃燒');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Pillars(pl, 2, 3), // 光柱往上掃
    close: (b) => b.b3Ring(16), // 塔基的放電
    far: (b, pl) => b.b3Rain(pl, 6, 8, 0.15), // 格子砲擊
    cover: (b, pl) => b.b3Pillars(pl, 2, 2), // 光柱打穿掩體
  },
};
Object.assign(BOSS_KIT, K2);
// ---------- 第 5、6 章的 Boss（第 5 期）----------
const K3 = {};
// AEGIS 護盾指揮艦
K3.flagship = {
  tip: 'AEGIS — 艦砲齊射之後、護盾發生器重建中是破綻；發生器全毀才打得動本體，艦砲可以打壞',
  parts: [{ id: 'gun', name: '艦砲', model: 'navalgun', off: [0, 0.85, 0.45], stops: ['p3'] }],
  open2: ['p3', 'p2'],
  open1: ['p3'],
  big: [
    ['護盾強化', (b) => b.b3Ring(30)],
    ['艦砲連射', (b, pl) => b.b3Line(pl, 5, 4.5, 0.15)],
  ],
  reflect: ['missile', 'shell', 'grenade'],
  field: {
    2: (g, b, T) => {
      g.tierShrinkZone(Math.min(T.eZone, 0.85));
      g.tierPools(b, 2, 'player', 6);
      g.flashAlert('戰場改變 — 甲板邊緣崩落');
    },
    3: (g, b, T) => {
      g.tierSmoke(b, 18, T.eMove);
      g.tierShrinkZone(Math.min(T.eZone, 0.7));
    },
  },
  counter: {
    air: (b, pl) => b.b3Fan(pl, 3, 0.15), // 防空砲
    close: (b) => b.b3Shock(16), // 護盾衝擊
    far: (b, pl) => b.b3Line(pl, 4, 5, 0.15), // 艦砲
    cover: (b, pl) => b.b3Rain(pl, 5, 4, 0.25), // 曲射
  },
};
// LEVIATHAN 空中要塞
K3.fortress = {
  tip: 'LEVIATHAN — 引擎全毀降下之後、全彈發射之後是破綻；四具引擎在時機身打不動，下方砲台壞了全彈發射變弱',
  parts: [
    { id: 'under', name: '下方砲台', model: 'ballturret', off: [0, -0.05, 0], weak: ['p3'], back: false },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['轟炸', (b, pl) => b.b3Line(pl, 6, 4, 0.12)],
    ['飛彈雨', (b, pl) => b.b3Rain(pl, 9, 14, 0.2)],
  ],
  reflect: ['mortar', 'missile'],
  field: {
    2: (g, b) => g.tierPools(b, 4, 'player', 7),
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.15), // 機槍掃射
    close: (b, pl) => b.b3Line(pl, 4, 3, 0.1), // 下方：轟炸
    far: (b, pl) => b.b3Rain(pl, 6, 10, 0.2), // 飛彈雨
    cover: (b, pl) => b.b3Line(pl, 5, 4, 0.1), // 轟炸掩體
  },
};
// VIPER 高速突擊機
K3.interceptor = {
  tip: 'VIPER — 掃射後掉頭減速是破綻；左右機翼壞了掉頭更慢、機砲壞了掃射變短',
  parts: [
    { id: 'wing', name: '左右機翼', model: 'wing', off: [0.5, 0.45, -0.1], flag: 'wing' },
    { id: 'gun', name: '機砲', model: 'autocannon', off: [0, 0.3, 0.55], flag: 'gun' },
  ],
  open2: ['p1', 'p3'],
  open1: ['p1'],
  big: [
    ['進場掃射', (b, pl) => b.b3Line(pl, 6, 4, 0.08)],
    ['音爆', (b) => b.b3Ring(32)],
  ],
  field: {
    2: (g, b) => {
      const pl = g.playersAlive()[0];
      if (pl) b.b3Mines(pl, 6, 14, true);
      g.flashAlert('戰場改變 — 空雷殘留區');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Mines(pl, 4, 8, true), // 空雷
    close: (b) => b.b3Ring(18), // 貼近時的音爆
    far: (b, pl) => b.b3Line(pl, 5, 5, 0.08), // 遠距掃射
    cover: (b, pl) => b.b3Line(pl, 4, 3, 0.1), // 俯衝轟炸
  },
};
// IGUAZU & VOLTA 雙 AC 小隊
K3.duo = {
  tip: 'IGUAZU & VOLTA — 連攜齊射之後是破綻；一台被打出失衡時另一台會來救（救的路上是破綻），肩上武器可以打壞',
  parts: [
    {
      id: 'ms',
      name: 'IGUAZU 的肩上飛彈',
      model: 'missiles',
      on: 'IGUAZU',
      off: [0.42, 0.95, 0],
      slots: ['rback'],
      weak: ['p3'],
    },
    {
      id: 'gr',
      name: 'VOLTA 的肩上榴彈',
      model: 'grenade',
      on: 'VOLTA',
      off: [-0.42, 0.95, 0],
      slots: ['lback', 'rback'],
      weak: ['p3'],
    },
  ],
  // 一台被打出失衡：另一台來救（救的路上是破綻）
  onStag: (b) => {
    const g = b.game;
    for (const o of g.bosses || []) if (o !== b && !o.dead && o.bossOpen) o.bossOpen(2.5);
  },
  open2: ['p3', 'p2'],
  open1: ['p3'],
  big: [
    ['夾擊', (b, pl) => b.b3Volley(pl, 2, 0.3)],
    ['交叉火線', (b, pl) => b.b3Cross(pl)],
  ],
  reflect: ['missile', 'grenade'],
  field: {
    2: (g, b) => {
      g.tierPools(b, 2, 'line', 6);
      g.flashAlert('戰場改變 — 掩體被打碎');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.2), // 兩台同時對空
    close: (b) => b.tierRush(), // 另一台從背後
    far: (b) => b.tierRush(), // 一台突進一台狙擊
    cover: (b, pl) => b.b3Rain(pl, 4, 4, 0.25), // 分頭包夾
  },
};
// SERAPHIM 浮游砲指揮機
K3.funnel = {
  tip: 'SERAPHIM — 回收浮游砲充能時是破綻；浮游砲被 EMP 打中會墜毀，浮游砲艙壞了補充變少',
  parts: [{ id: 'bay', name: '浮游砲艙', model: 'bay', off: [0, 0.7, -0.45], flag: 'bay', back: true }],
  open2: ['p1', 'p3'],
  open1: ['p3'],
  big: [
    ['包圍', (b, pl) => b.b3Cage(pl, 4, 14)],
    ['全方位開火', (b) => b.b3Ring(34)],
  ],
  field: {
    2: (g, b) => {
      g.tierPools(b, 3, 'player', 6);
      g.flashAlert('戰場改變 — 浮游砲殘骸變成電擊區');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    air: (b, pl) => b.b3Pillars(pl, 2, 4), // 浮游砲從上方
    close: (b) => b.b3Shock(14), // 本體近身光劍
    far: (b, pl) => b.b3Cage(pl, 3, 10), // 浮游砲追擊
    cover: (b, pl) => b.b3Cage(pl, 3, 6), // 浮游砲繞到掩體後
  },
};
// DOPPEL 複製 AC
K3.mirror = {
  tip: 'DOPPEL — 適應過載之後是破綻；它複製你的裝備：打壞的那一把武器不能用',
  parts: [
    { id: 'r', name: '右手武器', model: 'replica', off: [0.42, 0.55, 0.15], slots: ['rarm'] },
    { id: 'l', name: '左手武器', model: 'replica', off: [-0.42, 0.55, 0.15], slots: ['larm'] },
    {
      id: 'back',
      name: '肩上武器',
      model: 'replica',
      off: [0, 0.95, -0.35],
      slots: ['rback', 'lback'],
      back: true,
    },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['照你的武器連射', (b, pl) => b.b3Volley(pl, 3, 0.3)],
    ['適應裝甲強化', (b) => b.b3Shock(22)],
  ],
  reflect: ['missile'],
  field: {
    2: (g, b) => {
      const pl = g.playersAlive()[0];
      if (pl) b.b3Mines(pl, 6, 12);
      g.flashAlert('戰場改變 — 布雷區');
    },
    3: (g, b, T) => g.tierShrinkZone(Math.min(T.eZone, 0.7)),
  },
  counter: {
    // 複製你的習慣
    air: (b, pl) => b.b3Fan(pl, 2, 0.12), // 跟著你飛
    close: (b) => b.tierRush(), // 改用近戰
    far: (b) => b.tierRush(), // 突進
    cover: (b, pl) => b.b3Rain(pl, 4, 4, 0.25), // 繞到側面
  },
};
// BALTEUS 自律型艦載機動兵器
K3.BALTEUS = {
  tip: 'BALTEUS — 脈衝裝甲被打破之後、導彈牆之後是破綻；飛彈莢艙壞了導彈牆變一半、火焰噴射器與脈衝裝甲發生器可以打壞',
  parts: [
    {
      id: 'pods',
      name: '左右飛彈莢艙',
      model: 'missiles',
      off: [0, 0.95, -0.1],
      slots: ['rback', 'lback'],
      weak: ['p3'],
    },
    { id: 'flame', name: '火焰噴射器', model: 'flamer', off: [0.45, 0.5, 0.25], flag: 'flame' },
    { id: 'pa', name: '脈衝裝甲發生器', model: 'pulse', off: [0, 0.7, -0.45], stops: ['p1'], back: true },
  ],
  open2: ['p3', 'p1'],
  open1: ['p3'],
  big: [
    ['脈衝裝甲展開', (b) => (b.b3Ring(28), b.tierArmor(0.05, 10))],
    ['脈衝爆發', (b) => b.b3Shock(26)],
  ],
  reflect: ['missile'],
  field: {
    2: (g, b) => g.tierPools(b, 4, 'player', 7),
    3: (g, b, T) => {
      g.tierShrinkZone(Math.min(T.eZone, 0.75));
      g.tierPools(b, 4, 'line', 6);
      g.tierSmoke(b, 14, true); // 移動的燃燒帶（跟著 Boss）
    },
  },
  counter: {
    air: (b, pl) => b.b3Volley(pl, 2, 0.25, ['rback', 'lback']), // 導彈追擊
    close: (b, pl) => (b.tierFlag('flame') ? b.b3Shock(12) : b.b3Pools(pl, 2, 4)), // 火焰噴射
    far: (b) => b.tierRush(), // 突進
    cover: (b, pl) => b.b3Rain(pl, 5, 4, 0.25), // 導彈從上方
  },
};
Object.assign(BOSS_KIT, K3);

export function bossKitOf(key) {
  return BOSS_KIT[key] || null;
}
