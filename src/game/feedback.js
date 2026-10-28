// ============================================================
//  聲音與打擊回饋：環境音與殘響（依地圖主題）、腳步、低 AP 心跳、
//  擊破確認與連殺、打出失衡、Boss 第二型態的提示
// ============================================================
import { Game } from './game.js';
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { DS, MS } from '../core/scale.js';

const STREAK_T = 4; // 連殺：上一次擊破後幾秒內再擊破才算連續

// 各主題的環境音（k＝循環檔、syn＝合成的風聲／海浪；v＝音量）與殘響（秒數、送出量）
const AMB = {
  industrial: {
    L: [
      { k: 'ambMach', v: 0.3 },
      { syn: 'wind', v: 0.18 },
    ],
    rev: [1.3, 0.16],
  },
  grid: { L: [{ k: 'ambHum', v: 0.35 }], rev: [1.0, 0.12] },
  desert: {
    L: [
      { k: 'ambLow', v: 0.35 },
      { syn: 'wind', v: 0.25 },
    ],
    rev: [1.2, 0.14],
  },
  snow: {
    L: [
      { syn: 'gust', v: 0.45 },
      { syn: 'wind', v: 0.3 },
    ],
    rev: [0.7, 0.07],
  },
  wasteland: {
    L: [
      { syn: 'wind', v: 0.35 },
      { k: 'ambLow', v: 0.25 },
    ],
    rev: [0.8, 0.09],
  },
  dunes: {
    L: [
      { syn: 'wind', v: 0.45 },
      { syn: 'gust', v: 0.15 },
    ],
    rev: [0.6, 0.06],
  },
  flooded: {
    L: [
      { k: 'ambRain', v: 0.35 },
      { k: 'ambLow', v: 0.2 },
    ],
    rev: [1.3, 0.16],
  },
  dam: {
    L: [
      { k: 'ambWater', v: 0.45 },
      { syn: 'wind', v: 0.15 },
    ],
    rev: [1.4, 0.16],
  },
  spaceport: {
    L: [
      { k: 'ambMach', v: 0.25 },
      { k: 'ambHum', v: 0.25 },
    ],
    rev: [1.3, 0.15],
  },
  grid086: {
    L: [
      { k: 'ambHum', v: 0.4 },
      { k: 'ambMach', v: 0.15 },
    ],
    rev: [2.2, 0.26],
  },
  xylem: {
    L: [
      { syn: 'sea', v: 0.5 },
      { syn: 'wind', v: 0.2 },
    ],
    rev: [0.8, 0.08],
  },
  orbit: { L: [{ k: 'ambHum', v: 0.3, r: 0.7 }], rev: [0.4, 0.04] },
  institute: {
    L: [
      { k: 'ambCave', v: 0.4 },
      { k: 'ambMach', v: 0.2 },
    ],
    rev: [2.6, 0.3],
  },
};
// 地面材質：金屬地板的主題（一般地面也是金屬／混凝土構造）
const METAL_THEMES = { grid: 1, grid086: 1, orbit: 1, xylem: 1, spaceport: 1, institute: 1 };

Object.assign(Game.prototype, {
  // 進入戰區（startMission／客機開局／主線每段）後每格呼叫：主題變了才換環境音
  audioScene() {
    const w = this.world;
    if (!w) return;
    const T = w.theme || {};
    const key = `${w.themeKey}|${T.roof ? 1 : 0}|${T.weather || ''}`;
    if (SFX.ambKey === key) return;
    const A = AMB[w.themeKey] || AMB.industrial;
    let L = A.L.slice(),
      rev = A.rev;
    if (T.roof) {
      // 地下（岩頂）：沒有風，改成洞窟的低鳴與長殘響
      L = L.filter((x) => !x.syn).concat([{ k: 'ambCave', v: 0.4 }]);
      rev = [2.6, 0.3];
    }
    if (T.weather === 'rain' && !L.some((x) => x.k === 'ambRain')) L.push({ k: 'ambRain', v: 0.3 });
    SFX.ambient(L, key);
    SFX.setReverb(rev[0], rev[1]);
  },
  // 主迴圈（任務中）每格：環境音、低 AP 心跳、Boss 第二型態
  audioTick(dt) {
    this.audioScene();
    const p = this.player;
    const k = p && !p.dead && !this.lab ? clamp((0.3 - p.hp / p.maxHp) / 0.3, 0, 1) : 0;
    SFX.heartbeat(k, dt);
    for (const b of this.bosses || []) {
      if (b.dead || !b.bossPhase) continue;
      const ph = b.bossPhase();
      if (b.phCue === undefined) b.phCue = b.forceP2 ? 2 : 1; // 一開始就是第二型態（危險條款）不提示
      if (ph <= b.phCue) continue;
      b.phCue = ph;
      SFX.cue('phase');
      this.camShake = Math.max(this.camShake, 0.25);
      this.showBanner(ph >= 3 ? '最終型態' : '第二型態', b.name, '#ff4030', 2.2, { k: 'phase' });
    }
  },
  // 腳步（MechEntity.ikGait 每半個步伐呼叫）：玩家與聽得到的距離內的機體
  mechStep(e) {
    const L = e.stats && e.stats.parts && e.stats.parts.legs;
    if (!L || L.type === 'tank' || e.flying || !this.world || !SFX.ctx) return;
    if (!e.isPlayer && SFX.dist(e.pos) > 40 * DS) return;
    const w = this.world,
      x = e.pos.x,
      z = e.pos.z;
    let surf = 'conc';
    if (w.waterDepth(x, z) > 0.3 * MS && e.pos.y < w.terrainHeight(x, z) + 1.5 * MS) surf = 'water';
    else if (e.pos.y > w.terrainHeight(x, z) + 0.6 || METAL_THEMES[w.themeKey]) surf = 'metal';
    else if (w.onIce(x, z)) surf = 'ice';
    else if (w.themeKey === 'snow') surf = 'snow';
    else if (w.themeKey === 'dunes' || w.themeKey === 'desert') surf = 'sand';
    const wt = e.isBoss ? 1 : L.type === 'reverse' ? 0.25 : L.type === 'quad' ? 0.8 : 0.5;
    // 房主與客機各自依步伐算腳步聲，不轉送
    const m = SFX.mirror;
    SFX.mirror = null;
    SFX.step(surf, clamp(wt * (e.scale || 1), 0, 1), e.isPlayer ? null : e.pos);
    SFX.mirror = m;
  },
  // 擊破的回饋（房主／單機，onEnemyKilled）：自己的連殺與確認音；客機玩家的以事件送過去
  fbKill(e, from) {
    if (!from || from.team !== 'player' || this.pvp) return;
    const big = !!(e.isBoss || e.isElite || e.ai === 'ac' || e.ai === 'duelist');
    const by = (this.kStreakBy = this.kStreakBy || {});
    const key = from.slot !== undefined ? from.slot : 'me';
    const s = by[key] && this.time - by[key].t < STREAK_T ? by[key] : { n: 0 };
    s.n++;
    s.t = this.time;
    by[key] = s;
    if (from.isPlayer) this.fbKillLocal(s.n, big);
    else if (from.slot !== undefined && this.net && this.net.role === 'host')
      this.netEv({ t: 'fb', s: from.slot, k: 'kill', n: s.n, b: big ? 1 : 0 });
  },
  fbKillLocal(n, big) {
    SFX.killConfirm(n, big);
    this.killStreak = { n, t: STREAK_T, pop: 1, big }; // HUD 的連殺計數
  },
  // 打出失衡的回饋
  fbBreak(t, from) {
    if (!from || from.team !== 'player' || t.team !== 'enemy' || this.pvp) return;
    if (from.isPlayer) {
      SFX.breakFx();
      this.popBreak(t);
    } else if (from.slot !== undefined && this.net && this.net.role === 'host')
      this.netEv({ t: 'fb', s: from.slot, k: 'break', i: t.id });
  },
  // 客機收到回饋事件（mp-client.js 的 clientEvent）
  fbEvent(e) {
    if (e.s !== this.net.me) return;
    if (e.k === 'kill') this.fbKillLocal(e.n, !!e.b);
    else if (e.k === 'break') {
      SFX.breakFx();
      const t = this.entById(e.i);
      if (t) this.popBreak(t);
    } else if (e.k === 'pqb') {
      const p = this.entById(e.i);
      if (p) this.pqbFx(p);
    } else if (e.k === 'ctr') {
      const p = this.entById(e.i);
      if (p) this.rbCtrFx(p, e.d); // 完美 QB 反擊的射擊（game/ranged.js）
    } else if (e.k === 'rb') SFX.rangedBonus(e.b);
  },
  // 完美 QB 的回饋（只給本人：房主／單機直接呼叫，客機由 fb 事件）
  pqbFx(p) {
    const c = p.center();
    this.fx.flash(c, 2.2, 0x9fe8ff, 0.18);
    this.fx.shockwave(c, 6, 0x9fe8ff, 0.35);
    SFX.play('thrBurst', 1.2, 1.3, 0.04, 0.03, null, 'ui');
    this.popDamage(c.clone().add(new THREE.Vector3(0, 2 * p.dk, 0)), '完美迴避', false, true, false, 0, p.id);
    this.rumble(0.4, 0.9, 140);
  },
});
