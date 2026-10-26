import { ATTRS, ATTR_KEYS, directOf, weaponAttr } from '../data/attrs.js';
// Game：車庫（組裝、展示場景）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { pick } from '../core/math.js';
import { bossForLevel, isBossLevel } from '../data/enemies.js';
import { PARTS, SLOTS, asmStats, jumpSpec, partById, usesAmmo } from '../data/parts.js';
import { applyPilotStats, levelOf } from '../data/pilot.js';
import { MECH_COLORS, PALETTES } from '../render/materials.js';
import { loadHangarAssets } from '../render/hangar-assets.js';
import { LocalModels } from '../render/local-models.js';
import { buildMech } from '../render/mech-model.js';
import { VARIANTS, variantKeys } from '../world/variants.js';
import { ServerModels } from '../render/net-models.js';
import { StylePipeline } from '../render/style/pipeline.js';
import { Game } from './game.js';
import { MB } from '../core/scale.js';

Object.assign(Game.prototype, {
  // ---------- garage ----------
  setupGarageScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x11151b);
    s.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.7));
    const d = new THREE.DirectionalLight(0xfff4e0, 1.5);
    d.position.set(5, 10, 6);
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    d.shadow.bias = -0.0005;
    d.shadow.normalBias = 0.02; // 沒有它時 GLB 區塊表面會出現自我陰影的條紋
    s.add(d);
    // 地板與場景是格納庫（game/hangar.js 的 hangarEnsure，依場合）；換裝的掃描用材質的剪裁平面
    this.renderer.localClippingEnabled = true;
    this.garageScene = s;
    if (this.envTex) s.environment = this.envTex;
    this.garageCam = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    this.garageSun = d;
    this.garageHemi = s.children.find((o) => o.isHemisphereLight);
    if (this.post.ok) {
      // 車庫也套用渲染風格（室內：不改霧、天空、太陽方位）
      this.garagePipe = new StylePipeline(this.renderer, {
        scene: s,
        camera: this.garageCam,
        sun: d,
        hemi: this.garageHemi,
        indoor: true,
        ssaoBase: { kernelRadius: 0.5, minDistance: 0.001, maxDistance: 0.03 },
      });
      this.garagePipe.setSize(innerWidth, innerHeight);
    }
    this.garageCam.position.set(3.8, 3.4, 6.2);
    this.garageCam.lookAt(0, 1.9, 0);
    this.garageMech = null;
    this.garageSlot = 'rarm';
    // 格納庫的外部素材（約 17 MB）：啟動後稍等再開始載入，第一次進機甲庫時多半已經好了
    setTimeout(() => loadHangarAssets(), 1500);
  },
  openGarage() {
    this.state = 'garage';
    this.gTab = 'eq'; // 進來時一律在裝備頁、零件格子打開（docs/garage-ui.md）
    this.gFlyOpen = true;
    this.styleRefresh();
    this.showScreen('garage');
    if (this.player) {
      this.clearMission();
    }
    this.hangarOpen(); // 進來時不播換裝
    this.renderGarage();
    // 單人模式：重新讀取本地模型庫（有變動才解析）；伺服器網址時也讀伺服器預設組；讀完再重建預覽
    const rev = ServerModels.rev;
    const again = (st) => {
      if (this.state === 'garage' && ((st && st.on) || ServerModels.rev !== rev)) this.renderGarage();
    };
    LocalModels.listSets().then(() => this.state === 'garage' && this.garageMechsUi());
    if (!(this.net && this.net.role)) this.lmRefresh().then(again);
    else this.mpModelsRefresh().then(() => again(null));
  },
  randomAsm() {
    const o = this.save.owned;
    const pk = (cat) => pick(PARTS[cat].filter((p) => o.includes(p.id))).id;
    this.save.asm = {
      head: pk('head'),
      core: pk('core'),
      arms: pk('arms'),
      legs: pk('legs'),
      booster: pk('booster'),
      generator: pk('generator'),
      fcs: pk('fcs'),
      rarm: pk('arm'),
      larm: pk('arm'),
      rback: pk('back'),
      lback: pk('back'),
    };
  },
  renderGarage() {
    const S = this.save,
      asm = S.asm,
      st = asmStats(asm);
    const $ = (id) => document.getElementById(id);
    $('gCoam').textContent = S.coam.toLocaleString();
    const L = S.level,
      boss = isBossLevel(L);
    $('mcTitle').textContent = (boss ? '決戰任務 ' : '任務 ') + String(L).padStart(2, '0');
    $('mcDesc').textContent =
      (boss
        ? `目標：擊破 ${bossForLevel(L).name}`
        : `目標：肅清隨機戰區內所有敵對兵力（預估 ${Math.round(6 + L * 2.2)} 戰力點，分波來襲）`) +
      '　每擊破一台即時入帳 COAM，無修理費';
    this.garageFireCache = null; // 理論火力（range.js）：每次重畫重新計算
    // 部位格、零件格子與小卡片、量表與六角圖（game/garage-ui.js）
    this.garageUiInit();
    if (!SLOTS.some((x) => x[0] === this.garageSlot)) this.garageSlot = 'rarm';
    this.garageSlotsUi();
    this.garageFlyUi();
    // stats：顯示套用駕駛員技能後的數值（出擊條件仍以原始數值判斷）
    const P = st.parts;
    const pMode = this.pilotCtxMode();
    const pm = this.pilotLocalMods(pMode);
    const ef = applyPilotStats(st, pm);
    const JS = jumpSpec(P.legs),
      JE = jumpSpec(ef.parts.legs),
      m1 = (v) => v.toFixed(1) + ' m';
    const fx = (base, eff, fmt = (v) => Math.round(v)) =>
      Math.abs(eff - base) > 1e-6
        ? `${fmt(eff)} <span class="up">(${eff > base ? '+' : '−'}${fmt(Math.abs(eff - base))})</span>`
        : fmt(base);
    const rows = [
      ['駕駛員（' + (pMode === 'pvp' ? 'PvP' : 'PvE') + '）', 'Lv ' + levelOf(this.save.pilot[pMode].xp)],
      ['AP（總裝甲）', fx(st.ap, ef.ap)],
      [
        '減傷（實彈／爆發／能量）',
        ATTR_KEYS.map((k) => fx(st.defs[k], ef.defs[k], (v) => Math.round(v * 1000) / 10 + '%')).join(' ／ '),
      ],
      ['能量武器適性', fx(st.enAdapt, ef.enAdapt, (v) => Math.round(v * 100) + '%')],
      ['姿態穩定', fx(st.stab, ef.stab)],
      [
        '總重量 / 負重',
        `${st.weight.toLocaleString()} / ${st.load.toLocaleString()}`,
        st.overWeight ? 'bad' : 'ok',
      ],
      ['EN 負載 / 輸出', `${st.enLoad} / ${st.enOut}`, st.overEn ? 'bad' : 'ok'],
      ['EN 容量', fx(st.enCap, ef.enCap)],
      ['EN 回復', fx(P.generator.recharge, ef.parts.generator.recharge)],
      ['地面速度', fx(st.speed, ef.speed, (v) => v.toFixed(1))],
      [
        'QB 速度 / 消耗',
        `${fx(P.booster.qb, ef.parts.booster.qb)} / ${fx(P.booster.qbCost, ef.parts.booster.qbCost)}`,
      ],
      ['跳躍高度（地面 / 空中）', `${fx(JS.height, JE.height, m1)} / ${fx(JS.airH, JE.airH, m1)}`],
      ['空中跳躍 / 懸浮耗能', `${JS.air} 次 / ${JS.canHover ? JS.hover + '/s' : '不能懸浮'}`],
      ['鎖定距離', fx(st.lockRange, ef.lockRange)],
      [
        '火控輔助（近／中／遠）',
        (P.fcs.assist || [0.6, 0.6, 0.45]).map((v) => Math.round(v * 100) + '%').join(' ／ '),
      ],
      ['射擊適性（手臂）', Math.round((P.arms.aim || 0.6) * 100) + '%'],
      ['導彈鎖定時間', (1 / (P.fcs.lockSpeed || 1)).toFixed(1) + ' 秒'],
      ['修復套件', fx(3, 3 + ((pm && pm.kits) || 0))],
      ['腳部型式', { biped: '二足', reverse: '逆關節', quad: '四足', tank: '履帶' }[P.legs.type]],
    ];
    $('stats').innerHTML = rows
      .map((r) => `<div class="stat ${r[2] || ''}"><span>${r[0]}</span><span>${r[1]}</span></div>`)
      .join('');
    $('gFire').innerHTML = this.garageFireHtml();
    $('gSpecPm').checked = this.rangePmOn();
    $('gSpecPm').onchange = (e) => {
      const cfg = this.rangeCfgGet();
      cfg.pm = e.target.checked;
      try {
        localStorage.setItem('rubicon_range', JSON.stringify(cfg));
      } catch {
        /* 不記住也沒關係 */
      }
      this.renderGarage();
    };
    const warn = [];
    if (st.overWeight) warn.push('超重：無法出擊');
    if (st.overEn) warn.push('EN 輸出不足：無法出擊');
    if (
      P.rarm.type === 'none' &&
      P.larm.type === 'none' &&
      P.rback.type === 'none' &&
      P.lback.type === 'none'
    )
      warn.push('未裝備任何武器');
    this.garageMapUi();
    this.garagePalUi();
    $('gWarn').textContent = warn.join('　');
    $('btnSortie').disabled = warn.length > 0;
    $('btnPilot').onclick = () => {
      SFX.ui();
      this.openPilot();
    };
    const mp = !!(this.net && this.net.role);
    $('btnSortie').style.display = mp ? 'none' : '';
    $('btnRange').style.display = mp ? 'none' : '';
    $('btnRange').disabled = warn.length > 0;
    $('btnToTitle').style.display = mp ? 'none' : '';
    $('btnGarageLobby').style.display = mp ? '' : 'none';
    if (mp && warn.length) $('btnGarageLobby').disabled = true;
    else $('btnGarageLobby').disabled = false;
    this.campGarageUi(warn);
    this.gHoverPid = undefined;
    this.garageHover(null);
    this.garageTab(this.gTab || 'eq');
    // 整備架上的機體：組裝變了時舊的機體留著播換裝（hangar.js），否則直接換掉
    this.hangarEnsure();
    this.hangarFinish();
    this.hangarPreviewClear();
    const prev = this.garageMech;
    const sig = JSON.stringify(asm);
    const swap = !!(prev && this.hgAsm && this.hgAsm !== sig && this.state === 'garage');
    if (prev && !swap) this.garageScene.remove(prev.group);
    this.hgAsm = sig;
    const src = this.garageSource();
    this.garageMech = buildMech(asm, this.myPal(), 1 / MB, { source: src }); // 格納庫照舊尺度
    this.garageMech.group.rotation.y = Math.PI;
    this.garageScene.add(this.garageMech.group);
    if (swap) this.hangarSwapStart(prev, this.garageMech);
    this.hangarAfterBuild(); // 受損的外觀與維修（hangar.js）
    this.lmGarageNote(this.garageMech, src);
    this.garageMechsUi();
    this.mpModelsUi();
    this.writeSave();
  },
  // 玩家機甲的配色（存檔的 mechPal，預設白色＝內建預設機甲的原色）。多人時照舊依玩家順序的配色（PLAYER_PALS）
  myPalKey() {
    const k = this.save && this.save.mechPal;
    return MECH_COLORS.some((c) => c[0] === k) ? k : MECH_COLORS[0][0];
  },
  myPal() {
    return PALETTES[this.myPalKey()];
  },
  garagePalUi() {
    const el = document.getElementById('gPal');
    if (!el) return;
    if (this.net && this.net.role) {
      el.innerHTML = '<span>機體配色</span><span class="dim">多人時依玩家順序</span>';
      return;
    }
    const hex = (k) => '#' + new THREE.Color(PALETTES[k].main).getHexString();
    const cur = this.myPalKey();
    el.innerHTML = `<span>機體配色</span><span class="gSws">${MECH_COLORS.map(
      ([k, n]) =>
        `<button class="gSw${k === cur ? ' on' : ''}" data-pal="${k}" title="${escHtml(n)}" style="--c:${hex(k)}"><i></i><span>${escHtml(n)}</span></button>`,
    ).join('')}</span>`;
    for (const b of el.querySelectorAll('[data-pal]'))
      b.onclick = () => {
        this.save.mechPal = b.dataset.pal;
        SFX.ui();
        this.renderGarage();
      };
  },
  // 出擊地圖：單人與房主可選（房主的選擇同步到大廳），客機只顯示房主選的
  garageMapUi() {
    const el = document.getElementById('gMap');
    if (!el) return;
    const n = this.net;
    const mp = !!(n && n.role);
    const host = mp && n.role === 'host';
    const vName = (map, v) =>
      v === 'base' ? '標準' : (map && this.variantName(map, v)) || (v ? '' : '隨機');
    if (mp && !host) {
      const ps = n.pvpSet || {};
      el.innerHTML = `<span>地圖</span><span>${escHtml(this.mapName(ps.map))}・${escHtml(vName(ps.map, ps.variant) || '隨機')}（房主選擇）</span>`;
      return;
    }
    el.innerHTML = `<span>地圖</span><span><select id="gMapSel">${this.mapOptionsHtml()}</select><select id="gVarSel" title="主題變體"></select></span>`;
    const sel = document.getElementById('gMapSel');
    const vs = document.getElementById('gVarSel');
    sel.value = host ? n.pvpSet.map || '' : this.mapPref();
    // 主題變體：隨機／標準／該主題的變體（隨機地圖時只能選隨機或標準）
    const fillVar = () => {
      const map = sel.value;
      const ks = map ? variantKeys(map).filter((k) => !VARIANTS[map][k].border) : [];
      vs.innerHTML =
        '<option value="">隨機</option><option value="base">標準</option>' +
        ks.map((k) => `<option value="${k}">${escHtml(VARIANTS[map][k].name)}</option>`).join('');
      const cur = host ? n.pvpSet.variant || '' : this.variantPref();
      vs.value = cur === 'base' || ks.includes(cur) ? cur : '';
      vs.style.display = map && !ks.length ? 'none' : '';
    };
    fillVar();
    const sync = () => {
      if (host) {
        n.pvpSet.map = sel.value;
        n.pvpSet.variant = vs.value;
        n.syncLobby();
      }
    };
    sel.onchange = () => {
      this.setMapPref(sel.value);
      fillVar();
      this.setVariantPref(vs.value);
      sync();
    };
    vs.onchange = () => {
      this.setVariantPref(vs.value);
      sync();
    };
  },
});
