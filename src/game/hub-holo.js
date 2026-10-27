// Game：作戰室的指揮室場景與全像戰略桌（docs/hub-ui.md）——場景與鏡頭、區域地形的取樣（真的關卡生成 World）與快取、
// 委託的光柱與 DOM 標籤（每格投影）、設施的熱點。畫面上的其他介面（橫幅、模組、圖示列）在 hub.js 的 renderHub
import { SFX } from '../audio/audio.js';
import { escHtml } from '../core/html.js';
import { clamp } from '../core/math.js';
import { WS } from '../core/scale.js';
import { SORTIES, TRANSITIONS } from '../data/campaign.js';
import { BRIEFINGS, FACTIONS, REGIONS, briefClient } from '../data/story.js';
import {
  TABLE_Y,
  TILE_R,
  buildBeacon,
  buildHoloTile,
  buildRegionRing,
  disposeTree,
  mapToTable,
  tickHolo,
} from '../render/holo-map.js';
import { buildHubRoom, tickHubRoom } from '../render/hub-room.js';
import { StylePipeline } from '../render/style/pipeline.js';
import { World } from '../world/world.js';
import { Game } from './game.js';

const TILE_N = 64;
const DEF_CAM = { yaw: 0, pitch: 0.7, dist: 11.8 };
// 設施：[id, 名稱, 對應的按鈕]
const HUB_SPOTS = [
  ['garage', '機甲庫', 'btnHubGarage'],
  ['pilot', '駕駛員', 'btnHubPilot'],
  ['fac', '委託方與模組', 'btnHubFac'],
  ['log', '通訊台', 'btnHubLog'],
  ['echo', 'ECHO 的終端', 'btnHubEcho'],
  ['story', '章節回顧', 'btnHubStory'],
  ['sim', '模擬艙', 'btnHubSim'],
  ['record', '作戰紀錄', 'btnHubRecord'],
];
const _v = new THREE.Vector3();
const nodeCol = (s, B) =>
  s === 'done'
    ? '#7ee081'
    : s !== 'open'
      ? '#3a4a58'
      : briefClient(B) === 'echo'
        ? '#ffd060'
        : B.cycle
          ? '#c090ff'
          : '#ffb020';

Object.assign(Game.prototype, {
  hubSetup() {
    if (this.hubScene) return;
    const s = new THREE.Scene();
    s.background = new THREE.Color(0x07090c);
    s.fog = new THREE.Fog(0x07090c, 16, 34);
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x1a2026, 0.28);
    s.add(hemi);
    const d = new THREE.DirectionalLight(0xfff0dc, 0.4);
    d.position.set(4, 9, 5);
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    d.shadow.camera.left = d.shadow.camera.bottom = -12;
    d.shadow.camera.right = d.shadow.camera.top = 12;
    d.shadow.normalBias = 0.02;
    s.add(d);
    if (this.envTex) s.environment = this.envTex;
    const R = buildHubRoom(Object.values(FACTIONS).map((f) => [f.color, f.short[0]]));
    s.add(R.root);
    const holo = new THREE.Group();
    holo.position.y = TABLE_Y + 0.035;
    R.root.add(holo);
    this.hubScene = s;
    this.hubRoom = R;
    this.hubHoloG = holo;
    this.hubCamera = new THREE.PerspectiveCamera(46, 1, 0.1, 80);
    this.hubCamS = { ...DEF_CAM, tgt: new THREE.Vector3(0, TABLE_Y + 0.7, -0.8), drag: 0 };
    this.hubTiles = new Map(); // 「主題|種子|選項」→ 取樣結果
    this.hubQ = [];
    if (this.post.ok) {
      this.hubPipe = new StylePipeline(this.renderer, {
        scene: s,
        camera: this.hubCamera,
        sun: d,
        hemi,
        indoor: true,
        ssaoBase: { kernelRadius: 0.5, minDistance: 0.001, maxDistance: 0.03 },
      });
      this.hubPipe.setSize(innerWidth, innerHeight);
      this.hubPipe.applyStructural(this.styleP || {});
    }
    // 拖曳背景：繞桌子轉一點
    const el = document.getElementById('hub');
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.target !== el && !e.target.closest('#hubMap')) return;
      if (e.target.closest('.hubNode')) return;
      drag = { x: e.clientX, y: e.clientY, yaw: this.hubCamS.yaw, pitch: this.hubCamS.pitch };
    });
    addEventListener('pointermove', (e) => {
      if (!drag || this.state !== 'hub') return;
      this.hubCamS.yaw = clamp(drag.yaw - (e.clientX - drag.x) * 0.004, -0.7, 0.7);
      this.hubCamS.pitch = clamp(drag.pitch + (e.clientY - drag.y) * 0.003, 0.45, 1.15);
      this.hubCamS.drag = 3;
    });
    addEventListener('pointerup', () => (drag = null));
  },
  // ---------- 區域地形 ----------
  // 用真的關卡生成取樣：在不加入畫面的場景建 World，讀高度與大型障礙物，然後丟掉
  hubHoloSample(theme, seed, L, opt) {
    const sc = new THREE.Scene();
    const w = new World(sc, theme, seed, L, null, opt);
    const N = TILE_N,
      half = (w.size / 2) * 0.985;
    const hs = new Float32Array(N * N);
    let lo = Infinity,
      hi = -Infinity;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const h = w.terrainHeight(-half + (2 * half * i) / (N - 1), -half + (2 * half * j) / (N - 1));
        hs[j * N + i] = h;
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
    const big = (o) => (o.kind === 'box' ? o.deck || o.w * o.d > 60 * WS : o.r > 3 * WS);
    const obs = w.obstacles.filter((o) => big(o) && Math.abs(o.x) < half && Math.abs(o.z) < half);
    for (const o of obs) hi = Math.max(hi, o.top != null ? o.top : (o.y || 0) + (o.h || 0));
    const range = Math.max(hi - lo, 14 * WS);
    const S = {
      n: N,
      lo,
      range,
      half,
      h: hs.map((h) => (h - lo) / range),
      obs: obs.slice(0, 160).map((o) => {
        const w2 = o.kind === 'box' ? o.w : o.r * 2,
          d2 = o.kind === 'box' ? o.d : o.r * 2;
        const y0 = o.kind === 'box' && o.y != null ? o.y : w.terrainHeight(o.x, o.z);
        const top = o.top != null ? o.top : y0 + (o.h || 6 * WS);
        return [
          (o.x + half) / (2 * half),
          (o.z + half) / (2 * half),
          w2 / (2 * half),
          d2 / (2 * half),
          (top - y0) / range,
          (y0 - lo) / range,
        ];
      }),
      water: w.theme.water ? clamp((w.theme.water.level - lo) / range, 0, 1) : null,
    };
    w.dispose();
    return S;
  },
  // 區域要顯示的地圖：有可以接的委託時用它預排的第一段，否則這一章的代表地圖
  hubRegionSrc(R) {
    const ids = Object.keys(SORTIES).filter((sid) => SORTIES[sid].chapter === R.chapter && BRIEFINGS[sid]);
    const open = ids.find((sid) => this.hubSortieState(sid) === 'open');
    if (open) {
      const so = SORTIES[open];
      const pre = this.hubPrePlan(open);
      const opt = this.campSegWorld(so, 0, pre.type0, pre.plan[0], TRANSITIONS.drop);
      return { sid: open, theme: so.segs[0].theme, seed: pre.seeds[0], L: so.level, opt };
    }
    const so = SORTIES[ids[0]];
    return { sid: null, theme: so.segs[0].theme, seed: 1009 * R.chapter + 17, L: so.level, opt: {} };
  },
  hubTileKey(src) {
    return `${src.theme}|${src.seed}|${JSON.stringify(src.opt)}`;
  },
  // ---------- 戰略桌（renderHub 呼叫：區域、地形、光柱、DOM 標籤） ----------
  hubHoloBuild() {
    this.hubSetup();
    const G = this.hubHoloG;
    for (const c of [...G.children]) {
      G.remove(c);
      disposeTree(c);
    }
    const ch = this.hubChapter();
    this.hubReg = [];
    const wrote = !!(this.campStory().pre && Object.keys(this.campStory().pre).length);
    for (const R of REGIONS) {
      const open = R.chapter <= ch;
      const [x, z] = mapToTable(R.x, R.y);
      const g = new THREE.Group();
      g.position.set(x, 0, z);
      G.add(g);
      g.add(buildRegionRing(open));
      const info = { R, g, open, src: null, tile: null, S: null };
      if (open) {
        info.src = this.hubRegionSrc(R);
        const key = this.hubTileKey(info.src);
        info.key = key;
        const S = this.hubTiles.get(key);
        if (S) this.hubPutTile(info, S);
        else if (!this.hubQ.some((q) => q.key === key)) this.hubQ.push({ key, src: info.src });
      }
      this.hubReg.push(info);
    }
    if (this.campStory().pre && !wrote) this.writeSave(); // 第一次預排的出擊要存起來
    // 委託的光柱與 DOM 標籤
    const map = document.getElementById('hubMap');
    map.replaceChildren();
    this.hubBeacons = [];
    for (const sid in SORTIES) {
      const B = BRIEFINGS[sid];
      if (!B) continue;
      const s = this.hubSortieState(sid);
      if (s === 'hidden') continue;
      const col = nodeCol(s, B);
      const [x, z] = mapToTable(B.node.x, B.node.y);
      const bc = buildBeacon(col, s === 'open' ? 0.62 : s === 'done' ? 0.26 : 0.14, s === 'open');
      bc.position.set(x, 0, z);
      G.add(bc);
      const tip = this.guideNodeInfo(sid);
      const chs = SORTIES[sid].segs.some((sg) => sg.choice);
      const name = SORTIES[sid].name.split(' — ')[1] || SORTIES[sid].name;
      const el = document.createElement('div');
      el.className = `hubNode ${s}`;
      el.dataset.sid = sid;
      el.innerHTML =
        `<svg viewBox="0 0 20 20" class="hnI" aria-hidden="true"><title>${escHtml(tip.join('\n'))}</title><circle cx="10" cy="10" r="7" fill="#0c1218" stroke="${col}" stroke-width="2"/><text x="10" y="13.5" text-anchor="middle" font-size="9" fill="${col}">${s === 'done' ? '✓' : s === 'open' ? '!' : '×'}</text></svg>` +
        `<span class="hnT" style="color:${col}">${chs ? '<i class="hnF">⚑</i>' : ''}${escHtml(name)}</span>`;
      el.onclick = () => this.hubNodeClick(sid);
      el.onpointerenter = () => (this.hubHover = sid);
      el.onpointerleave = () => this.hubHover === sid && (this.hubHover = null);
      map.appendChild(el);
      this.hubBeacons.push({ sid, bc, el, B, s });
    }
    // 區域名稱
    for (const info of this.hubReg) {
      const el = document.createElement('div');
      el.className = 'hubReg' + (info.open ? '' : ' locked');
      el.innerHTML = `<b>${escHtml(info.R.name)}</b>${info.open ? '' : `<small>第 ${info.R.chapter} 章開放</small>`}`;
      map.appendChild(el);
      info.el = el;
    }
    this.hubBeaconY();
  },
  hubPutTile(info, S) {
    if (info.tile) {
      info.g.remove(info.tile);
      disposeTree(info.tile);
    }
    info.S = S;
    info.tile = buildHoloTile(S, info.src && info.src.sid ? 0x6fd3ff : 0x4aa6d8);
    info.g.add(info.tile);
  },
  // 光柱的底座放在地形表面
  hubBeaconY() {
    for (const b of this.hubBeacons || []) {
      const R = REGIONS.find((r) => r.chapter === SORTIES[b.sid].chapter);
      const info = this.hubReg.find((i) => i.R === R);
      let y = 0;
      if (info && info.S) {
        const [cx, cz] = mapToTable(R.x, R.y);
        const lx = b.bc.position.x - cx,
          lz = b.bc.position.z - cz;
        const u = Math.round(((lx + TILE_R) / (2 * TILE_R)) * (TILE_N - 1)),
          v = Math.round(((lz + TILE_R) / (2 * TILE_R)) * (TILE_N - 1));
        if (Math.hypot(lx, lz) < TILE_R * 0.92 && u >= 0 && v >= 0 && u < TILE_N && v < TILE_N)
          y = info.S.h[v * TILE_N + u] * 0.42;
      }
      b.bc.position.y = y;
    }
  },
  // 簡報的背景：這個委託第一段的地形，放大到整張桌子（同一份預排、同一個快取）
  hubBriefShow(sid) {
    this.hubSetup();
    const so = SORTIES[sid];
    const pre = this.hubPrePlan(sid);
    const opt = this.campSegWorld(so, 0, pre.type0, pre.plan[0], TRANSITIONS.drop);
    const src = { sid, theme: so.segs[0].theme, seed: pre.seeds[0], L: so.level, opt };
    const key = this.hubTileKey(src);
    if (this.hubBrief && this.hubBrief.g) {
      this.hubRoom.root.remove(this.hubBrief.g);
      disposeTree(this.hubBrief.g);
    }
    this.hubBrief = { sid, key, g: null };
    const S = this.hubTiles.get(key);
    if (S) this.hubBriefPut(S);
    else if (!this.hubQ.some((q) => q.key === key)) this.hubQ.unshift({ key, src });
    this.writeSave(); // 預排的出擊
  },
  hubBriefPut(S) {
    const B = this.hubBrief;
    if (!B) return;
    if (B.g) {
      this.hubRoom.root.remove(B.g);
      disposeTree(B.g);
    }
    B.g = buildHoloTile(S, 0x6fd3ff, 3.4, { hs: 0.24, alpha: 0.55 });
    B.g.position.y = TABLE_Y + 0.04;
    this.hubRoom.root.add(B.g);
  },
  hubNodeClick(sid) {
    if (this.hubSortieState(sid) === 'locked') {
      // 鎖住的委託：在上方寫出開放條件
      SFX.ui('err');
      const cap = document.getElementById('hubCap');
      cap.textContent = this.guideNodeInfo(sid).join('　');
      cap.classList.add('warn');
      return;
    }
    this.openBrief(sid);
  },
  // ---------- 每格 ----------
  hubTick(dt, t) {
    this.hubSetup();
    const R = this.hubRoom;
    // 區域地形：每格最多建一塊（第一格先畫出來）
    this.hubFrames = (this.hubFrames || 0) + 1;
    if (this.hubQ.length && this.hubFrames > 1) {
      const q = this.hubQ.shift();
      let S = this.hubTiles.get(q.key);
      if (!S) {
        try {
          S = this.hubHoloSample(q.src.theme, q.src.seed, q.src.L, q.src.opt);
        } catch (e) {
          console.warn('全像地形取樣失敗', e);
          S = { n: TILE_N, h: new Float32Array(TILE_N * TILE_N), obs: [], water: null };
        }
        this.hubTiles.set(q.key, S);
      }
      for (const info of this.hubReg || []) if (info.key === q.key) this.hubPutTile(info, S);
      if (this.hubBrief && this.hubBrief.key === q.key) this.hubBriefPut(S);
      this.hubBeaconY();
    }
    // 鏡頭：繞桌子（拖曳轉一點，停手後回到正面）；標籤要能點，所以游標停留時鏡頭不動
    const C = this.hubCamS;
    const k = 1 - Math.exp(-dt * 3);
    C.cur = C.cur || { yaw: C.yaw, pitch: C.pitch, dist: C.dist };
    if (C.drag > 0) C.drag -= dt;
    else {
      C.yaw += (0 - C.yaw) * k * 0.5;
      C.pitch += (DEF_CAM.pitch - C.pitch) * k * 0.5;
      if (Math.abs(C.yaw) < 1e-3) C.yaw = 0;
      if (Math.abs(C.pitch - DEF_CAM.pitch) < 1e-3) C.pitch = DEF_CAM.pitch;
    }
    // 簡報：桌上只留第一段的地形（慢慢轉），鏡頭靠近、畫面中心移到右側（左邊是簡報的文字）
    const brief = this.state === 'brief' && this.hubBrief;
    this.hubHoloG.visible = !brief;
    if (this.hubBrief && this.hubBrief.g) {
      this.hubBrief.g.visible = !!brief;
      if (brief) this.hubBrief.g.rotation.y += dt * 0.06;
    }
    const goalT = brief ? _v.set(0, TABLE_Y + 0.15, 0) : _v.set(0, TABLE_Y + 0.7, -0.8);
    C.tgt.lerp(goalT, k);
    if (C.tgt.distanceTo(goalT) < 1e-4) C.tgt.copy(goalT);
    const pitch = brief ? 0.66 : C.pitch;
    const dist = (brief ? 7.4 : DEF_CAM.dist) * (innerWidth < innerHeight * 1.4 ? 1.15 : 1);
    C.cur.yaw += (C.yaw - C.cur.yaw) * k;
    C.cur.pitch += (pitch - C.cur.pitch) * k;
    C.cur.dist += (dist - C.cur.dist) * k;
    if (Math.abs(C.cur.yaw - C.yaw) < 1e-4) C.cur.yaw = C.yaw;
    if (Math.abs(C.cur.pitch - pitch) < 1e-4) C.cur.pitch = pitch;
    if (Math.abs(C.cur.dist - dist) < 1e-4) C.cur.dist = dist;
    const cam = this.hubCamera;
    const cp = Math.cos(C.cur.pitch);
    cam.position.set(
      C.tgt.x + Math.sin(C.cur.yaw) * cp * C.cur.dist,
      C.tgt.y + Math.sin(C.cur.pitch) * C.cur.dist,
      C.tgt.z + Math.cos(C.cur.yaw) * cp * C.cur.dist,
    );
    cam.lookAt(C.tgt);
    if (brief && innerWidth > innerHeight * 1.2)
      cam.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.2, 0, innerWidth, innerHeight);
    else cam.clearViewOffset();
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    // 設施的發光：游標停留或有新東西
    for (const [id] of HUB_SPOTS) {
      const sp = R.spots[id];
      if (!sp) continue;
      const want = this.hubSpotHover === id ? 1 : this.hubSpotNew && this.hubSpotNew[id] ? 0.7 : 0;
      sp.hot += (want - sp.hot) * Math.min(1, dt * 8);
      sp.on = !(id === 'echo' && this.hubEchoOff);
    }
    tickHubRoom(R, dt, t);
    tickHolo(this.hubHoloG, t);
    for (const b of this.hubBeacons || []) {
      if (b.bc.userData.dot) b.bc.userData.dot.position.y = b.bc.userData.top + Math.sin(t * 3) * 0.02;
      b.bc.userData.ring.scale.setScalar(1 + ((t * 0.8) % 1) * (b.s === 'open' ? 1.6 : 0));
    }
    if (this.state === 'hub') this.hubLabels();
    if (this.post.enabled && this.hubPipe) this.hubPipe.render(this.styleP, t);
    else this.renderer.render(this.hubScene, cam);
  },
  // DOM 標籤：委託（光柱頂端）、區域名稱、設施
  hubLabels() {
    const cam = this.hubCamera;
    this.hubScene.updateMatrixWorld();
    const W = innerWidth,
      H = innerHeight;
    // edge＝貼著畫面邊緣（設施的標籤：場景裡的位置在畫面外時，停在邊上）
    const place = (el, p, edge) => {
      _v.copy(p).project(cam);
      let x = ((_v.x + 1) / 2) * W,
        y = ((1 - _v.y) / 2) * H;
      if (edge) {
        x = clamp(x, 78, W - 78);
        y = clamp(y, 96, H - 110);
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      el.style.visibility = _v.z < 1 ? '' : 'hidden';
    };
    for (const b of this.hubBeacons || []) {
      b.bc.localToWorld(_v.set(0, b.bc.userData.top, 0));
      place(b.el, _v.clone());
      b.el.classList.toggle('hot', this.hubHover === b.sid);
    }
    for (const info of this.hubReg || []) {
      info.g.localToWorld(_v.set(0, 0, TILE_R * 0.78));
      place(info.el, _v.clone());
    }
    for (const el of document.querySelectorAll('#hubSpots .hubSpot')) {
      const sp = this.hubRoom.spots[el.dataset.spot];
      if (sp) place(el, sp.anchor.clone(), true);
    }
  },
  // 設施的熱點（renderHub 呼叫）：場景裡的名稱標籤，點了＝對應的圖示列按鈕
  hubSpotsUi(sub) {
    const box = document.getElementById('hubSpots');
    box.replaceChildren();
    this.hubSpotNew = {};
    for (const [id, name, btn] of HUB_SPOTS) {
      const b = document.getElementById(btn);
      if (!b || b.style.display === 'none') continue;
      const el = document.createElement('button');
      el.className = 'hubSpot';
      el.dataset.spot = id;
      const s = sub[id];
      if (s && s.hot) this.hubSpotNew[id] = 1;
      el.innerHTML = `<b>${escHtml(name)}</b>${s ? `<small class="${s.hot ? 'hot' : ''}">${escHtml(s.t)}</small>` : ''}`;
      el.onclick = () => b.click();
      el.onpointerenter = () => (this.hubSpotHover = id);
      el.onpointerleave = () => this.hubSpotHover === id && (this.hubSpotHover = null);
      box.appendChild(el);
    }
  },
});
