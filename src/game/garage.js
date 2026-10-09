// Game：車庫（組裝、展示場景）
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { pick } from '../core/math.js';
import { bossForLevel, isBossLevel } from '../data/enemies.js';
import { PARTS, SLOTS, asmStats, jumpSpec, partById } from '../data/parts.js';
import { applyPilotStats, levelOf } from '../data/pilot.js';
import { PALETTES } from '../render/materials.js';
import { LocalModels } from '../render/local-models.js';
import { buildMech } from '../render/mech-model.js';
import { ServerModels } from '../render/net-models.js';
import { StylePipeline } from '../render/style/pipeline.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ---------- garage ----------
  setupGarageScene() {
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x11151b);
    s.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.7));
    const d = new THREE.DirectionalLight(0xfff4e0, 1.5);
    d.position.set(5, 10, 6);
    d.castShadow = true;
    s.add(d);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(4, 32),
      new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    s.add(floor);
    const grid = new THREE.GridHelper(30, 30, 0x2a3644, 0x1e2630);
    grid.position.y = 0.01;
    s.add(grid);
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
  },
  openGarage() {
    this.state = 'garage';
    this.styleRefresh();
    this.showScreen('garage');
    if (this.player) {
      this.clearMission();
    }
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
        : `目標：肅清隨機戰區內所有敵對兵力（預估 ${Math.round(4 + L * 1.5)} 戰力點）`) +
      '　每擊破一台即時入帳 COAM，無修理費';
    const slots = $('slots');
    slots.innerHTML = '';
    for (const [key, label, cat] of SLOTS) {
      const d = document.createElement('div');
      d.className = 'slot' + (this.garageSlot === key ? ' sel' : '');
      d.innerHTML = `<b>${label}</b>${partById(cat, asm[key]).name}`;
      d.onclick = () => {
        this.garageSlot = key;
        SFX.ui();
        this.renderGarage();
      };
      slots.appendChild(d);
    }
    const [key, label, cat] = SLOTS.find((s) => s[0] === this.garageSlot);
    const list = $('partList');
    list.innerHTML = `<div class="dim" style="font-size:12px;margin:4px 0 8px">${label} — 可用零件</div>`;
    if (cat === 'consumable') {
      S.items = S.items || {};
      for (const p of PARTS[cat]) {
        const eq = asm[key] === p.id;
        const n = S.items[p.id] || 0;
        const d = document.createElement('div');
        d.className = 'part' + (eq ? ' eq' : '');
        if (p.id === 'cs_none') {
          d.innerHTML = `<div><div class="n">${p.name}</div></div><div class="pr">${eq ? '已裝備' : '裝備'}</div>`;
          d.onclick = () => {
            asm[key] = p.id;
            this.writeSave();
            this.renderGarage();
          };
        } else {
          d.innerHTML = `<div><div class="n">${p.name}　<span style="color:var(--acc2)">持有 ×${n}</span></div><div class="s">${p.desc}</div></div><div style="display:flex;flex-direction:column;gap:4px"><button class="buy" style="padding:4px 8px;font-size:12px">購買 ${p.price.toLocaleString()} C</button><button class="eqb" style="padding:4px 8px;font-size:12px">${eq ? '已裝備' : '裝備'}</button></div>`;
          d.querySelector('.buy').onclick = (ev) => {
            ev.stopPropagation();
            if (n >= p.max) {
              this.flashMsg(`最多攜帶 ${p.max} 個`, 0xff4d4d, 1);
              return;
            }
            if (S.coam >= p.price) {
              S.coam -= p.price;
              S.items[p.id] = n + 1;
              SFX.ui();
            } else this.flashMsg('COAM 不足', 0xff4d4d, 1);
            this.writeSave();
            this.renderGarage();
          };
          d.querySelector('.eqb').onclick = (ev) => {
            ev.stopPropagation();
            asm[key] = p.id;
            const other = key === 'c1' ? 'c2' : 'c1';
            if (asm[other] === p.id) asm[other] = 'cs_none';
            this.writeSave();
            this.renderGarage();
          };
        }
        list.appendChild(d);
      }
    } else
      for (const p of PARTS[cat]) {
        const owned = S.owned.includes(p.id);
        const eq = asm[key] === p.id;
        const d = document.createElement('div');
        d.className = 'part' + (eq ? ' eq' : '') + (owned ? '' : ' locked');
        let spec = '';
        if (cat === 'arm' || cat === 'back') {
          if (p.type === 'melee')
            spec = `${p.combo.length} 段 · 總傷 ${p.combo.reduce((a, c) => a + c.dmg, 0)} · 終結衝擊 ${p.combo[p.combo.length - 1].impact}`;
          else if (p.type !== 'none' && p.type !== 'shield')
            spec = `傷 ${p.dmg} · 衝擊 ${p.impact} · 射程 ${p.range}${p.mag < 99 ? ' · 彈匣 ' + p.mag : ''}`;
          else if (p.type === 'shield') spec = '被動減傷 55%';
        } else if (cat === 'legs') spec = `AP ${p.ap} · 負重 ${p.load} · 速 ${p.speed}`;
        else if (cat === 'generator') spec = `容量 ${p.cap} · 輸出 ${p.output} · 回充 ${p.recharge}`;
        else if (cat === 'booster') spec = `推力 ×${p.thrust} · QB ${p.qb}`;
        else if (cat === 'fcs') spec = `鎖定距離 ${p.range}`;
        else spec = `AP ${p.ap} · 穩定 ${p.stab}`;
        d.innerHTML = `<div><div class="n">${p.name}</div><div class="s">${spec}${p.desc ? ' · ' + p.desc : ''}${p.weight !== undefined ? ' · 重 ' + p.weight + ' · EN ' + p.en : ''}</div></div><div class="pr">${owned ? (eq ? '已裝備' : '裝備') : p.price.toLocaleString() + ' C'}</div>`;
        d.onclick = () => {
          if (!owned) {
            if (S.coam >= p.price) {
              S.coam -= p.price;
              S.owned.push(p.id);
              asm[key] = p.id;
              SFX.ui();
            } else {
              this.flashMsg('COAM 不足', 0xff4d4d, 1);
            }
          } else asm[key] = p.id;
          this.writeSave();
          this.renderGarage();
        };
        list.appendChild(d);
      }
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
      ['防禦（核心）', fx(st.def, ef.def, (v) => Math.round(v * 1000) / 10 + '%')],
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
      ['修復套件', fx(3, 3 + ((pm && pm.kits) || 0))],
      ['腳部型式', { biped: '二足', reverse: '逆關節', quad: '四足', tank: '履帶' }[P.legs.type]],
    ];
    $('stats').innerHTML = rows
      .map((r) => `<div class="stat ${r[2] || ''}"><span>${r[0]}</span><span>${r[1]}</span></div>`)
      .join('');
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
    {
      const mc = document.getElementById('missionCard');
      const mm = document.getElementById('gMissionM');
      if (mm) {
        const narrow = innerWidth <= 1000 || innerHeight <= 540;
        mm.style.display = narrow ? '' : 'none';
        if (narrow) mm.innerHTML = mc ? mc.innerHTML.replace(/<br\s*\/?>/g, ' ') : '';
      }
    }
    this.garageMapUi();
    $('gWarn').textContent = warn.join('　');
    $('btnSortie').disabled = warn.length > 0;
    $('btnPilot').onclick = () => {
      SFX.ui();
      this.openPilot();
    };
    const mp = !!(this.net && this.net.role);
    $('btnSortie').style.display = mp ? 'none' : '';
    $('btnToTitle').style.display = mp ? 'none' : '';
    $('btnGarageLobby').style.display = mp ? '' : 'none';
    if (mp && warn.length) $('btnGarageLobby').disabled = true;
    else $('btnGarageLobby').disabled = false;
    // preview mech
    if (this.garageMech) {
      this.garageScene.remove(this.garageMech.group);
    }
    const src = this.garageSource();
    this.garageMech = buildMech(asm, PALETTES.player, 1, { source: src });
    this.garageMech.group.rotation.y = Math.PI;
    this.garageScene.add(this.garageMech.group);
    this.lmGarageNote(this.garageMech, src);
    this.garageMechsUi();
    this.mpModelsUi();
    this.writeSave();
  },
  // 出擊地圖：單人與房主可選（房主的選擇同步到大廳），客機只顯示房主選的
  garageMapUi() {
    const el = document.getElementById('gMap');
    if (!el) return;
    const n = this.net;
    const mp = !!(n && n.role);
    const host = mp && n.role === 'host';
    if (mp && !host) {
      el.innerHTML = `<span>地圖</span><span>${escHtml(this.mapName((n.pvpSet || {}).map))}（房主選擇）</span>`;
      return;
    }
    el.innerHTML = `<span>地圖</span><span><select id="gMapSel">${this.mapOptionsHtml()}</select></span>`;
    const sel = document.getElementById('gMapSel');
    sel.value = host ? n.pvpSet.map || '' : this.mapPref();
    sel.onchange = () => {
      this.setMapPref(sel.value);
      if (host) {
        n.pvpSet.map = sel.value;
        n.syncLobby();
      }
    };
  },
});
