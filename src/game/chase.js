// ============================================================
//  CHASE VIEW — 追尾視角（機戰傭兵6）：鏡頭在機體後上方、自由轉動；機體依速度在畫面上偏移（鏡頭落後）；
//  畫面中央的鎖定框自動鎖定、目標輔助（鏡頭跟著目標、甩動換目標）、準星周圍的 HUD
//  視角：this.fp（第一人稱）、this.chase（追尾），兩者都不是＝俯視。鏡頭方向共用 fpYaw／fpPitch。
// ============================================================
import { SFX } from '../audio/audio.js';
import { usesAmmo } from '../data/parts.js';
import { angLerp, clamp, lerp, rnd } from '../core/math.js';
import { CHASE_FOV, FP_FOV, TP_FOV } from './constants.js';
import { Game } from './game.js';

const VIEWS = ['top', 'chase', 'fp'];
const VIEW_NAME = { top: '俯視視角', chase: '追尾視角', fp: '第一人稱視角' };
const PITCH_MIN = -0.85,
  PITCH_MAX = 0.75;
const LOST_T = 0.35; // 鎖定的目標離開鎖定框多久後換目標

Object.assign(Game.prototype, {
  // 鏡頭決定瞄準方向（第一人稱與追尾）
  camAim() {
    return !!(this.fp || this.chase);
  },
  viewName() {
    return this.fp ? 'fp' : this.chase ? 'chase' : 'top';
  },
  // 切換視角（quiet：不顯示訊息）
  setView(v, quiet) {
    if (!VIEWS.includes(v)) v = 'top';
    const cur = this.viewName();
    if (cur === v) return;
    const p = this.player;
    if (cur === 'top' && p) {
      this.fpYaw = p.aimYaw !== undefined ? p.aimYaw : p.yaw;
      this.fpPitch = 0;
    }
    if (v === 'chase') this.fpPitch = clamp(this.fpPitch || 0, PITCH_MIN, PITCH_MAX);
    this.fp = v === 'fp';
    this.chase = v === 'chase';
    this.camera.fov = this.fp ? FP_FOV : this.chase ? this.chaseFov() : TP_FOV;
    this.camera.updateProjectionMatrix();
    if (this.camScratch) {
      this.camScratch.fov = TP_FOV;
      this.camScratch.updateProjectionMatrix();
    }
    if (!this.fp) this.fpShow();
    this.chLag = null;
    this.chDist = null;
    this.lockLostT = 0;
    if (v !== 'chase') this.assist = false;
    document.body.classList.toggle('chaseView', this.chase);
    if (v !== 'top') {
      if (!this.spectator && !this.touchActive) {
        try {
          this.canvas.requestPointerLock();
        } catch (e) {}
      }
    } else if (document.pointerLockElement) {
      try {
        document.exitPointerLock();
      } catch (e) {}
    }
    if (!quiet) this.flashMsg(VIEW_NAME[v] + '（V 切換）', 0xffb020, 1.2);
  },
  // V：俯視 → 追尾 → 第一人稱 → 俯視
  cycleView() {
    const i = VIEWS.indexOf(this.viewName());
    this.setView(VIEWS[(i + 1) % VIEWS.length]);
  },
  // 出擊時：回到設定的預設視角
  viewReset() {
    this.fp = false;
    this.chase = false;
    this.assist = false;
    this.fpShow();
    this.camera.fov = TP_FOV;
    this.camera.updateProjectionMatrix();
    document.body.classList.remove('chaseView');
    const v = this.ctrl.view === 'fps' ? 'fp' : this.ctrl.view === 'chase' ? 'chase' : 'top';
    if (v !== 'top') this.setView(v, true);
  },
  chaseFov() {
    return this.ctrl.chaseFov || CHASE_FOV;
  },
  // 目標輔助：鏡頭自動跟著鎖定的目標（觸控一律開啟）
  assistOn() {
    return !!(this.chase && (this.assist || this.touchActive));
  },
  toggleAssist() {
    if (!this.chase || this.spectator) return;
    this.assist = !this.assist;
    SFX.ui();
    this.flashMsg(this.assist ? '目標輔助 ON' : '目標輔助 OFF', 0xffb020, 0.9, {
      k: 'sys',
      m: this.assist ? 'TARGET ASSIST' : 'ASSIST OFF',
    });
  },
  // 鏡頭轉動（滑鼠、觸控拖曳、右搖桿的增量，像素／每格的量）；目標輔助中改成甩動換目標
  camTurn(dx, dy, s) {
    const p = this.player;
    if (this.assistOn() && p && p.lock && !p.lock.dead) {
      const now = performance.now();
      if (!this.flickT || now - this.flickT > 250) {
        this.flickT = now;
        this.flickX = 0;
      }
      this.flickX += dx;
      if (Math.abs(this.flickX) > 90) {
        this.chaseFlick(Math.sign(this.flickX));
        this.flickX = 0;
        this.flickT = now + 200; // 甩一次換一個
      }
      return;
    }
    const inv = this.ctrl.invY ? -1 : 1;
    this.fpYaw -= dx * s;
    const lo = this.chase ? PITCH_MIN : -1.1,
      hi = this.chase ? PITCH_MAX : 0.9;
    this.fpPitch = clamp(this.fpPitch - dy * s * inv, lo, hi);
  },
  // 每格的瞄準輸入（第一人稱／追尾；單機 updatePlayer 與客機 buildLocalInput 共用）
  camAimInput(p, dt) {
    const pa = this.padAim && this.padAim.lengthSq() > 0.09 ? this.padAim : null;
    if (pa) {
      if (this.assistOn() && p.lock && !p.lock.dead) {
        if (Math.abs(pa.x) > 0.75) {
          if (!this.padFlick) this.chaseFlick(Math.sign(pa.x));
          this.padFlick = true;
        } else this.padFlick = false;
      } else {
        const sn = this.ctrl.sens || 1;
        const inv = this.ctrl.invY ? -1 : 1;
        this.fpYaw -= pa.x * dt * 2.6 * sn;
        const lo = this.chase ? PITCH_MIN : -1.1,
          hi = this.chase ? PITCH_MAX : 0.9;
        this.fpPitch = clamp(this.fpPitch - pa.z * dt * 1.8 * sn * inv, lo, hi);
      }
    } else this.padFlick = false;
    if (this.fp) {
      const look = this.fpLookDir(this.fpYaw, this.fpPitch);
      this.mouseWorld.copy(this.fpEye(p)).addScaledVector(look, 40);
    } else this.mouseWorld.copy(this.chaseReticle(p));
    this.autoLock(p);
  },
  // 鏡頭繞著的點（機體頭部附近）
  chasePivot(ent) {
    const h = (ent.model && ent.model.height) || 4.5;
    return ent.pos.clone().add(new THREE.Vector3(0, h * 0.95, 0));
  },
  // 追尾鏡頭：ent＝跟著的機體；yaw／pitch＝鏡頭方向
  chaseCamera(ent, dt, yaw, pitch) {
    const w = this.world;
    const h = (ent.model && ent.model.height) || 4.5;
    const look = this.fpLookDir(yaw, pitch);
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    // 速度偏移：鏡頭落後機體，所以往右移動時機體往畫面右邊、往上時往上、往前衝時變遠
    const sw = this.ctrl.chaseSway === undefined ? 1 : this.ctrl.chaseSway;
    const v = ent.vel || new THREE.Vector3();
    const qk = ent.qbT > 0 ? 1.25 : 1;
    const tR = clamp(v.dot(right) * 0.11 * qk, -3, 3) * sw,
      tU = clamp(v.y * 0.09, -1.8, 1.8) * sw,
      tF = clamp(v.dot(fwd) * 0.12 * qk, -2.5, 5) * sw;
    const L = this.chLag || (this.chLag = { r: tR, u: tU, f: tF });
    const kk = Math.min(1, dt * 4.5);
    L.r = lerp(L.r, tR, kk);
    L.u = lerp(L.u, tU, kk);
    L.f = lerp(L.f, tF, kk);
    const pivot = this.chasePivot(ent)
      .addScaledVector(right, -L.r)
      .add(new THREE.Vector3(0, -L.u, 0))
      .addScaledVector(fwd, -L.f);
    // 距離：機體身高的 2.4 倍；大型目標近時拉遠
    let dist = Math.max(8, h * 2.4) * (this.ctrl.chaseDist || 1) * (this.chaseUser || 1);
    const lk = ent.lock && !ent.lock.dead ? ent.lock : null;
    if (lk && lk.model && (lk.model.height || 0) > h * 1.8 && lk.pos.distanceTo(ent.pos) < 40) dist *= 1.3;
    const up = h * 0.32;
    // 撞牆拉近：從機體往鏡頭的方向步進，碰到地形或物件就停在前面
    const from = pivot.clone().add(new THREE.Vector3(0, up * 0.5, 0));
    const back = look.clone().multiplyScalar(-1);
    const near = w.obstacles.filter(
      (o) => Math.abs(o.x - from.x) < dist + 12 && Math.abs(o.z - from.z) < dist + 12,
    );
    const hit = (q) => {
      if (q.y < w.terrainHeight(q.x, q.z) + 0.4) return true;
      for (const o of near) {
        if (o.kind === 'box') {
          if (
            Math.abs(q.x - o.x) < o.w / 2 + 0.3 &&
            Math.abs(q.z - o.z) < o.d / 2 + 0.3 &&
            q.y < o.top &&
            q.y > o.y
          )
            return true;
        } else if (
          o.r > 1 &&
          Math.hypot(q.x - o.x, q.z - o.z) < o.r &&
          q.y < w.terrainHeight(o.x, o.z) + o.r * 2
        )
          return true;
      }
      return false;
    };
    let dWant = dist;
    for (let s = 1.5; s <= dist; s += 0.5) {
      const q = from
        .clone()
        .addScaledVector(back, s)
        .add(new THREE.Vector3(0, (up * 0.5 * s) / dist, 0));
      if (hit(q)) {
        dWant = Math.max(2.2, s - 0.6);
        break;
      }
    }
    const cur = this.chDist || dWant;
    this.chDist = lerp(cur, dWant, Math.min(1, dt * (dWant < cur ? 18 : 3)));
    const pos = pivot
      .clone()
      .addScaledVector(look, -this.chDist)
      .add(new THREE.Vector3(0, up, 0));
    const fl = w.terrainHeight(pos.x, pos.z) + 0.6;
    if (pos.y < fl) pos.y = fl;
    // 速度感：高速時視角加寬
    const spd = Math.hypot(v.x, v.z);
    const fov = this.chaseFov() + clamp((spd - 14) * 0.3, 0, 9) * Math.min(1, sw + 0.3);
    this.chFov = lerp(this.chFov || fov, fov, Math.min(1, dt * 4));
    if (Math.abs(this.camera.fov - this.chFov) > 0.05) {
      this.camera.fov = this.chFov;
      this.camera.updateProjectionMatrix();
    }
    if (this.camShake > 0) {
      this.camShake -= dt;
      const a = Math.min(1, this.camShake * 4) * 0.5;
      pos.x += rnd(-0.4, 0.4) * a;
      pos.y += rnd(-0.25, 0.25) * a;
      pos.z += rnd(-0.4, 0.4) * a;
    }
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().add(look));
    this.camera.updateMatrixWorld();
    this.camTarget.copy(ent.pos);
    this.camExtra = 14; // 霧往外推（看得比俯視遠）
    const sc = ent.pos.clone().addScaledVector(fwd, 22);
    this.sun.position.copy(sc).add(this.sunOff);
    this.sun.target.position.copy(sc);
    const shc = this.sun.shadow.camera;
    if (shc.right !== 80) {
      shc.left = -80;
      shc.right = 80;
      shc.top = 80;
      shc.bottom = -80;
      shc.updateProjectionMatrix();
    }
    const c = ent.center();
    const pts = [c, c.clone().setY(ent.pos.y + h * 0.95), c.clone().setY(ent.pos.y + 0.4)];
    // 擋住的物件淡出；鏡頭離機體很近，不顯示透視輪廓（機體自己的零件互相遮住也會變成輪廓）
    w.updateOcclusion(pos, c, dt, pts);
    w.fadeMeshes(pos, pts, dt);
    this.camXray(ent, false, dt);
    this.rangeRing.visible = false;
  },
  // 鏡頭自動轉向：近戰中的對象，或目標輔助的鎖定目標
  chaseAssistTick(p, dt) {
    let foe = null;
    if (p.melee.active && p.melee.target && !p.melee.target.dead) foe = p.melee.target;
    const lk = p.lock && !p.lock.dead ? p.lock : null;
    const tgt = foe || (this.assistOn() ? lk : null);
    if (!tgt) return;
    const d = tgt.center().sub(this.camera.position);
    const wy = Math.atan2(-d.x, -d.z);
    const wp = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), PITCH_MIN, PITCH_MAX);
    const k = Math.min(1, dt * (foe ? 6 : 5));
    this.fpYaw = angLerp(this.fpYaw, wy, k);
    this.fpPitch = lerp(this.fpPitch, wp, k);
  },
  // 準星所指的世界點：從鏡頭沿畫面中央往前，略過機體前方，碰到地形或物件就停；沒碰到取 160 m
  chaseReticle() {
    const w = this.world;
    const o = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const s0 = (this.chDist || 10) + 2;
    let prev = o.clone().addScaledVector(dir, s0);
    for (let s = s0; s <= 160; s += 1.5) {
      const q = o.clone().addScaledVector(dir, s);
      if (q.y < w.terrainHeight(q.x, q.z) || w.hitsWorld(q)) return prev;
      prev = q;
    }
    return prev;
  },
  // 鎖定框（畫面中央；火控的中距離輔助越高框越大）：回傳像素的半寬、半高
  lockBox(p) {
    const fcs = p && p.stats && p.stats.parts && p.stats.parts.fcs;
    const a = fcs && fcs.assist ? fcs.assist[1] : 0.6;
    const H = innerHeight;
    const hw = H * (0.17 + 0.1 * a);
    return { hw, hh: hw * 0.78 };
  },
  // 鎖定框裡的敵人，依離準星的遠近
  chaseLockCands(p, reach) {
    const bx = this.lockBox(p);
    const out = [];
    for (const e of this.lockPool(p)) {
      if (e.dead || e.noLock) continue;
      if (e.pos.distanceTo(p.pos) > reach) continue;
      const v = e.center().project(this.camera);
      if (v.z <= -1 || v.z >= 1) continue;
      const dx = (v.x * innerWidth) / 2 / bx.hw,
        dy = (v.y * innerHeight) / 2 / bx.hh;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      out.push({ e, k: Math.hypot(dx, dy) });
    }
    return out;
  },
  // 追尾的自動鎖定：框裡沒有鎖定中的目標一段時間就換（目標輔助中保持）
  chaseAutoLock(p) {
    const now = performance.now();
    const c = this.lockCands(p);
    if (p.lock && !c.includes(p.lock) && !this.assistOn()) {
      if (!this.lockLostT) this.lockLostT = now;
      if (now - this.lockLostT > LOST_T * 1000) {
        p.lock = c[0] || null;
        this.lockLostT = 0;
      }
    } else this.lockLostT = 0;
    if (!p.lock) p.lock = c[0] || null;
  },
  // 目標輔助中甩動：換到畫面上往那個方向最近的目標（攻擊距離內、鏡頭前方）
  chaseFlick(dir) {
    const p = this.player;
    if (!p || !p.lock) return;
    const reach = this.lockReach(p);
    const x0 = p.lock.center().project(this.camera).x;
    let best = null,
      bd = 1e9;
    for (const e of this.lockPool(p)) {
      if (e.dead || e.noLock || e === p.lock || e.pos.distanceTo(p.pos) > reach) continue;
      const v = e.center().project(this.camera);
      if (v.z >= 1) continue;
      const dx = (v.x - x0) * dir;
      if (dx <= 0.02) continue;
      if (dx < bd) {
        bd = dx;
        best = e;
      }
    }
    if (best) {
      p.lock = best;
      p.lockT = 0;
      SFX.ui();
    }
  },
  // ---------- HUD：準星、鎖定框、四把武器、EN／ACS、目標資訊 ----------
  drawChaseHud(c, W, H, p) {
    this.drawFpHud(c, W, H, p, true);
    const cx = W / 2,
      cy = H / 2;
    const bx = this.lockBox(p);
    const lk = p.lock && !p.lock.dead ? p.lock : null;
    const amber = '#ffb020';
    // 鎖定框的四個角
    c.strokeStyle = lk ? 'rgba(255,176,32,.9)' : 'rgba(255,255,255,.45)';
    c.lineWidth = 2;
    const cl = Math.min(22, bx.hw * 0.25);
    c.beginPath();
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = cx + sx * bx.hw,
        y = cy + sy * bx.hh;
      c.moveTo(x, y - sy * cl);
      c.lineTo(x, y);
      c.lineTo(x - sx * cl, y);
    }
    c.stroke();
    // 中央準星
    c.strokeStyle = 'rgba(255,255,255,.9)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(cx, cy, 5, 0, Math.PI * 2);
    c.moveTo(cx - 20, cy);
    c.lineTo(cx - 10, cy);
    c.moveTo(cx + 10, cy);
    c.lineTo(cx + 20, cy);
    c.moveTo(cx, cy + 10);
    c.lineTo(cx, cy + 20);
    c.stroke();
    // 四把武器：左右手在框的下方兩側、背部在上方兩側
    const slot = (s, x, y, al) => {
      const wp = p.weapons[s];
      if (!wp || !wp.def || wp.def.type === 'none') return;
      const d = wp.def;
      let txt;
      if (d.type === 'melee') txt = 'MELEE';
      else if (d.type === 'shield') txt = 'SHIELD';
      else if (!usesAmmo(d))
        txt = wp.charging
          ? Math.round(clamp(wp.charge / (d.chargeT || 1), 0, 1) * 100) + '%'
          : wp.cd > 0
            ? '…'
            : 'READY';
      else txt = wp.reloadT > 0 ? 'RELOAD' : String(wp.mag);
      const low = usesAmmo(d) && wp.ammo <= 0 && wp.mag <= 0;
      c.textAlign = al;
      c.font = 'bold 15px Chakra Petch';
      c.fillStyle = low ? '#ff5a5a' : wp.reloadT > 0 ? amber : '#e6edf3';
      c.fillText(txt, x, y);
      c.font = '10px Chakra Petch';
      c.fillStyle = 'rgba(230,237,243,.65)';
      const sub = usesAmmo(d) ? '×' + wp.ammo : '';
      c.fillText(d.name.split(' ')[0] + (sub ? '  ' + sub : ''), x, y + 13);
      const k =
        wp.reloadT > 0 ? 1 - wp.reloadT / (d.reload || 1) : wp.cd > 0 && d.rof ? 1 - wp.cd / d.rof : 1;
      if (k < 1) {
        const bw = 54,
          bx0 = al === 'right' ? x - bw : x;
        c.fillStyle = 'rgba(255,255,255,.18)';
        c.fillRect(bx0, y + 17, bw, 3);
        c.fillStyle = amber;
        c.fillRect(bx0, y + 17, bw * clamp(k, 0, 1), 3);
      }
    };
    const gx = bx.hw + 14;
    slot('larm', cx - gx, cy + bx.hh * 0.45, 'right');
    slot('rarm', cx + gx, cy + bx.hh * 0.45, 'left');
    slot('lback', cx - gx, cy - bx.hh * 0.55, 'right');
    slot('rback', cx + gx, cy - bx.hh * 0.55, 'left');
    // EN 與 ACS（框的下方）
    const bw = Math.min(220, bx.hw * 1.6),
      by = cy + bx.hh + 16;
    const en = clamp(p.en / (p.enMax || 1), 0, 1);
    c.fillStyle = 'rgba(8,12,18,.5)';
    c.fillRect(cx - bw / 2, by, bw, 5);
    c.fillStyle = en < 0.25 ? '#ff5a5a' : '#7fd4ff';
    c.fillRect(cx - bw / 2, by, bw * en, 5);
    const acs = clamp(p.acs / (p.acsMax || 1), 0, 1);
    if (acs > 0.01) {
      c.fillStyle = 'rgba(8,12,18,.5)';
      c.fillRect(cx - bw / 2, by + 8, bw, 3);
      c.fillStyle = acs > 0.75 ? '#ff7a3a' : amber;
      c.fillRect(cx - bw / 2, by + 8, bw * acs, 3);
    }
    // 目標資訊（框的上方）：名稱、距離、AP、ACS
    if (lk) {
      const ty = cy - bx.hh - 30,
        tw = Math.min(200, bx.hw * 1.4);
      c.textAlign = 'center';
      c.font = 'bold 12px Chakra Petch';
      c.fillStyle = amber;
      c.fillText(`${lk.name || ''}  ${Math.round(lk.pos.distanceTo(p.pos))} m`, cx, ty);
      const hp = clamp(lk.hp / (lk.maxHp || 1), 0, 1);
      c.fillStyle = 'rgba(8,12,18,.55)';
      c.fillRect(cx - tw / 2, ty + 5, tw, 5);
      c.fillStyle = '#ff5a5a';
      c.fillRect(cx - tw / 2, ty + 5, tw * hp, 5);
      const ta = clamp(lk.acs / (lk.acsMax || 1), 0, 1);
      c.fillStyle = 'rgba(8,12,18,.55)';
      c.fillRect(cx - tw / 2, ty + 12, tw, 3);
      c.fillStyle = lk.staggerT > 0 ? '#ffe36a' : '#ffa040';
      c.fillRect(cx - tw / 2, ty + 12, tw * (lk.staggerT > 0 ? 1 : ta), 3);
    }
    if (this.assistOn()) {
      c.textAlign = 'center';
      c.font = 'bold 11px Chakra Petch';
      c.fillStyle = amber;
      c.fillText('TARGET ASSIST', cx, cy + bx.hh + 38);
    }
    if (!this.plocked && !this.touchActive && !this.padActive && !this.spectator) {
      c.font = 'bold 13px Chakra Petch';
      c.textAlign = 'center';
      c.fillStyle = amber;
      c.fillText('點擊畫面鎖定滑鼠以轉動視角（Esc 釋放）', cx, cy + bx.hh + 58);
    }
  },
});
