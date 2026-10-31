// Game：空域的空戰（docs/air-combat-design.md）。自由出擊選「空域」（world/themes/airspace.js，只有單人）時：
//   進場（airBegin）＝玩家機體進入飛行狀態（entities/mech-air.js）、固定追尾視角、鏡頭看得遠；
//   鏡頭 airCamera（追尾視角的空中版：可以往上下看到底、跟著速度拉開、橫滾時鏡頭微微傾斜）、準星 airReticle；
//   輸入 airInput（W／S＝推力、A／D＝橫移、滑鼠＝方向；手把與觸控照同一套：左搖桿＝推力與橫移、右搖桿／拖曳＝方向）；
//   飛行的 HUD（速度、高度、機首標記、俯仰刻度、低空警告）；第 1 期的敵人：空中的無人機、直升機、蜂群（airSpawn）。
import { clamp, lerp, makeRng, rnd } from '../core/math.js';
import { GpuFx } from '../fx/gpu.js';
import { FXG, pickCell } from '../fx/atlas.js';
import { DS } from '../core/scale.js';
import { AIR } from '../data/air.js';
import { Game } from './game.js';

const CAM_FAR = 3600, // 空域的鏡頭可視距離（m）
  START_ALT = 320, // 進場的高度
  PITCH_LIM = 1.4;
// 雲：兩層（中層 380～560 m、高層 760～940 m），依地圖種子固定擺放
const CLOUD_LAYERS = [
  [380, 560, 34],
  [760, 940, 22],
];
const _v = new THREE.Vector3(),
  _d = new THREE.Vector3(),
  _p = new THREE.Vector3();

Object.assign(Game.prototype, {
  // 現在是空域的飛行
  airOn() {
    return !!(this.airMode && this.player && this.player.air);
  },
  // 鏡頭的俯仰範圍（chase.js 的 camTurn／camAimInput）
  airPitchLim() {
    return this.airMode ? PITCH_LIM : 0;
  },
  // 進場：玩家機體進入飛行狀態、固定追尾視角
  airBegin() {
    const p = this.player;
    this.airMode = true;
    p.airInit(START_ALT);
    this.camera.far = CAM_FAR;
    this.camera.updateProjectionMatrix();
    document.body.classList.add('airMode');
    this.airCloudsInit(this.worldSeed || 1);
    // 觸控的跳躍鍵在空中是急轉彎
    const jb = document.querySelector('#vpad .vbtn[data-a="jump"]');
    if (jb) {
      if (this.airJumpHtml === undefined) this.airJumpHtml = jb.innerHTML;
      jb.innerHTML = '急轉<span class="k">HIGH-G</span>';
    }
  },
  // 離開空域（clearMission）
  airEnd() {
    if (!this.airMode) return;
    this.airMode = false;
    this.camera.far = 400 * DS;
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('airMode');
    if (this.airCloud) this.airCloud.clear();
    this.airBanks = [];
    const jb = document.querySelector('#vpad .vbtn[data-a="jump"]');
    if (jb && this.airJumpHtml !== undefined) jb.innerHTML = this.airJumpHtml;
  },
  // 每格的輸入（updatePlayer 在轉成世界方向之前呼叫）：推力與橫移照按鍵本身，方向＝鏡頭
  airInput(p, wish) {
    p.airIn = { thr: clamp(-wish.z, -1, 1), side: clamp(wish.x, -1, 1) };
    p.airAim = this.fpLookDir(this.fpYaw, this.fpPitch);
    p.fpFace = true;
  },
  // 後空翻：鏡頭跟著轉 180°（機首跟著鏡頭的方向，不轉的話翻完又轉回去）
  airRevCam() {
    this.fpYaw += Math.PI;
    this.fpPitch = clamp(-this.fpPitch * 0.5, -PITCH_LIM, PITCH_LIM);
  },
  // 準星所指的點：沿畫面中央往前，碰到地形或海面就停，最遠 2 km
  airReticle() {
    const o = this.camera.position;
    this.camera.getWorldDirection(_d);
    const p = this.player;
    for (let s = 40; s <= 2000; s += 20) {
      _v.copy(o).addScaledVector(_d, s);
      if (p && _v.y < p.airFloor(_v.x, _v.z)) return _v.clone();
    }
    return o.clone().addScaledVector(_d, 2000);
  },
  // 鏡頭：機體後方、沿鏡頭方向；速度越快拉得越開、視角越寬；橫滾時微微傾斜
  airCamera(ent, dt, yaw, pitch) {
    const h = (ent.model && ent.model.height) || 9.7;
    const look = this.fpLookDir(yaw, pitch);
    const v = ent.airV || 0;
    const fk = clamp((v - AIR.CRUISE) / (AIR.AB - AIR.CRUISE), -1, 1);
    const L = this.chLag || (this.chLag = { r: 0, u: 0, f: 0 });
    // 速度的落後：鏡頭比機體慢一點跟上（往前衝時機體往前拉開）
    _d.copy(ent.vel).multiplyScalar(0.06);
    L.r = lerp(L.r, _d.x, Math.min(1, dt * 3));
    L.u = lerp(L.u, _d.y, Math.min(1, dt * 3));
    L.f = lerp(L.f, _d.z, Math.min(1, dt * 3));
    const dist = h * (3.1 + 0.7 * Math.max(0, fk)) * (this.ctrl.chaseDist || 1) * (this.chaseUser || 1);
    const pivot = ent.center().add(_p.set(0, h * 0.35, 0));
    const pos = pivot
      .clone()
      .addScaledVector(look, -dist)
      .sub(_v.set(L.r, L.u, L.f))
      .add(_p.set(0, h * 0.25, 0));
    const fl = ent.airFloor ? ent.airFloor(pos.x, pos.z) + 3 : -1e9;
    if (pos.y < fl) pos.y = fl;
    if (this.camShake > 0) {
      this.camShake -= dt;
      const a = Math.min(1, this.camShake * 4) * 1.5;
      pos.x += rnd(-0.4, 0.4) * a;
      pos.y += rnd(-0.25, 0.25) * a;
      pos.z += rnd(-0.4, 0.4) * a;
    }
    this.camKickTick(pos, dt, 1.5);
    const fov = this.chaseFov() + Math.max(0, fk) * 10 + (ent.qbT > 0 ? 3 : 0);
    this.chFov = lerp(this.chFov || fov, fov, Math.min(1, dt * 4));
    if (Math.abs(this.camera.fov - this.chFov) > 0.05) {
      this.camera.fov = this.chFov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.position.copy(pos);
    // 橫滾：鏡頭的上方跟著機體的橫滾傾斜一點（只有 15%）
    const roll = (ent.airRoll || 0) * 0.15 * (ent.airTilt || 0);
    _v.set(0, 1, 0).applyAxisAngle(look, -roll);
    this.camera.up.copy(_v);
    this.camera.lookAt(pos.clone().add(look));
    this.camera.up.set(0, 1, 0);
    this.camera.updateMatrixWorld();
    this.chDist = dist;
    this.camTarget.copy(ent.pos);
    this.camExtra = 0;
    // 陰影跟著機體
    const sc = ent.pos.clone().addScaledVector(look, 60);
    this.sun.position.copy(sc).add(this.sunOff);
    this.sun.target.position.copy(sc);
    this.rangeRing.visible = false;
  },
  // 第 1 期的敵人：空中的無人機、直升機、蜂群，在玩家周圍 500～1100 m、高度 220～480 m
  airSpawn(L, scaleHp, scaleDmg) {
    const n = clamp(4 + Math.floor(L / 2), 4, 10);
    const kinds = ['drone', 'drone', 'heli', 'swarm'];
    const pl = this.player.pos;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3),
        r = rnd(500, 1100);
      const x = pl.x + Math.cos(a) * r,
        z = pl.z + Math.sin(a) * r;
      const at = new THREE.Vector3(x, Math.max(rnd(220, 480), this.player.airFloor(x, z) + 120), z);
      const e = this.spawnType(kinds[i % kinds.length], scaleHp, scaleDmg, at, 1);
      if (e) e.airAlt = at.y;
    }
    this.waves = [];
    this.wavePend = null;
  },
  // 雲團：每團是十幾顆很大的煙霧粒子（顯示卡粒子、一般混合、壽命很長＝一直留著）；上面亮、底下偏灰
  airCloudsInit(seed) {
    if (!this.airCloud) this.airCloud = new GpuFx(this.scene, { add: false, cap: 4096, order: 1 });
    const C = this.airCloud;
    C.clear();
    this.airCloudT = 0;
    const r = makeRng(seed * 71 + 5),
      R = (a, b) => a + (b - a) * r();
    const lim = this.world.lim;
    this.airBanks = [];
    const top = new THREE.Color(0xffffff),
      low = new THREE.Color(0xaeb9c8);
    for (const [y0, y1, n] of CLOUD_LAYERS)
      for (let i = 0; i < n; i++) {
        const b = { x: R(-lim, lim), z: R(-lim, lim), y: R(y0, y1), r: R(120, 280), h: R(35, 70) };
        this.airBanks.push(b);
        const m = Math.round(b.r / 9);
        for (let k = 0; k < m; k++) {
          const a = r() * Math.PI * 2,
            d = Math.sqrt(r()) * b.r * 0.8,
            dy = (r() * 2 - 1) * b.h * 0.5;
          const s = R(130, 230) * (1 - (d / b.r) * 0.35);
          const c = low.clone().lerp(top, clamp(0.5 + dy / b.h, 0, 1));
          C.emit({
            p: _p.set(b.x + Math.cos(a) * d, b.y + dy, b.z + Math.sin(a) * d),
            life: 1e6,
            s0: s,
            c0: c.getHex(),
            a: 0.8,
            occ: 1,
            cell: pickCell(FXG.smoke),
            fade: 5,
            rot: r() * 6.28,
          });
        }
      }
  },
  // 每格（water.js 的 waterTick）：雲的時鐘
  airCloudTick(dt) {
    if (!this.airCloud || !this.airMode) return;
    this.airCloudT += dt;
    this.airCloud.update(this.airCloudT, dt);
  },
  // 在不在雲裡（第 3 期：雲裡不能鎖定）
  airInCloud(pos) {
    for (const b of this.airBanks || []) {
      const dx = (pos.x - b.x) / b.r,
        dz = (pos.z - b.z) / b.r,
        dy = (pos.y - b.y) / b.h;
      if (dx * dx + dz * dz + dy * dy < 1) return true;
    }
    return false;
  },
  // ---------- HUD ----------
  drawAirHud(c, W, H, p) {
    if (!p.air) return;
    const S = Math.min(W, H) / 900;
    c.save();
    c.font = `${Math.round(15 * S)}px "Share Tech Mono", monospace`;
    c.lineWidth = Math.max(1, 1.4 * S);
    const col = 'rgba(120,255,190,0.9)',
      warn = 'rgba(255,90,70,0.95)';
    c.strokeStyle = col;
    c.fillStyle = col;
    // 速度（左）、高度（右）
    const kmh = Math.round((p.airV || 0) * 3.6),
      alt = Math.round(p.pos.y);
    const yC = H * 0.5,
      xl = W * 0.5 - 380 * S,
      xr = W * 0.5 + 380 * S;
    const box = (x, txt, lbl, al) => {
      c.strokeRect(x - 52 * S, yC - 16 * S, 104 * S, 32 * S);
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(txt, x, yC);
      c.font = `${Math.round(11 * S)}px "Share Tech Mono", monospace`;
      c.fillText(lbl, x, yC - 28 * S);
      c.font = `${Math.round(15 * S)}px "Share Tech Mono", monospace`;
      void al;
    };
    box(xl, String(kmh), 'SPEED km/h');
    box(xr, String(alt), 'ALT m');
    // 推力的狀態
    const st =
      p.abT > 0 ? 'ASSAULT' : p.airG ? 'HIGH-G' : p.airV < 20 ? 'HOVER' : p.boost ? 'BOOST' : 'CRUISE';
    c.textAlign = 'center';
    c.fillText(st, xl, yC + 30 * S);
    // 俯仰刻度（畫面中央兩側的短線，跟著機首的俯仰）
    const pit = p.airPit || 0;
    c.textAlign = 'left';
    for (let d = -60; d <= 60; d += 15) {
      const dy = (pit * 180) / Math.PI - d;
      const y = yC + dy * 5 * S;
      if (Math.abs(y - yC) > 170 * S) continue;
      const half = d === 0 ? 70 * S : 38 * S;
      c.globalAlpha = d === 0 ? 0.8 : 0.45;
      c.beginPath();
      c.moveTo(W / 2 - 250 * S - half, y);
      c.lineTo(W / 2 - 250 * S, y);
      c.moveTo(W / 2 + 250 * S, y);
      c.lineTo(W / 2 + 250 * S + half, y);
      c.stroke();
      if (d) c.fillText(String(d), W / 2 + 250 * S + half + 4 * S, y);
    }
    c.globalAlpha = 1;
    // 機首標記（機體往哪裡飛）：沿機首方向 600 m 投影到畫面
    const f = p.airDirNow ? p.airDirNow() : null;
    if (f) {
      const q = this.proj(p.center().addScaledVector(f, 600));
      if (q && q.in) {
        c.beginPath();
        c.arc(q.x, q.y, 9 * S, 0, Math.PI * 2);
        c.moveTo(q.x - 20 * S, q.y);
        c.lineTo(q.x - 9 * S, q.y);
        c.moveTo(q.x + 9 * S, q.y);
        c.lineTo(q.x + 20 * S, q.y);
        c.moveTo(q.x, q.y - 9 * S);
        c.lineTo(q.x, q.y - 16 * S);
        c.stroke();
      }
    }
    // 低空警告：離地面或海面很近而且往下
    const low = p.airLow !== undefined && p.airLow < 60 && p.vel.y < -4;
    if (low && Math.floor(performance.now() / 250) % 2 === 0) {
      c.fillStyle = warn;
      c.textAlign = 'center';
      c.font = `bold ${Math.round(26 * S)}px "Share Tech Mono", monospace`;
      c.fillText('PULL UP', W / 2, H * 0.36);
    }
    c.restore();
  },
});
