// ---------- MechEntity 擴充：狀態效果（鋼索鉤住、黏附炸彈、纏附、緩速、禁止跳躍、捕獲網、標定、吸取 EN） ----------
// 定義在 data/status.js；HUD 與畫面邊緣在 game/status-hud.js。
// - addStatus 只在房主／單機呼叫；狀態存在 this.sts＝{ 種類: { t 剩餘秒, T 總秒數, src 來源實體 id, o 參數, n QB 次數 } }。
// - 移動效果（速度、QB 耗能、不能跳躍、往鉤點拉、空中往下拉）在 move 裡套用，客機的自身預測也跑同一份
//   （狀態隨快照的 su 同步：statusSer／statusApply）。爆炸與持續傷害只在房主。
// - 掙脫：hook 按 QB 一次、stick／latch 按 QB 兩次（statusQB）；net／latch 近戰攻擊割開（statusMelee）。
// - 顯示（statusFx）：鋼索、黏附炸彈的閃燈與嗶聲、結霜、捕獲網、纏附物、禁止跳躍的重力環、標定的光柱、吸取的光束；
//   各端自己畫（房主與客機都跑），中招與掙脫的音效、第一次中招的說明也各端自己判斷，不轉送。
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import { DS, MS } from '../core/scale.js';
import { STATUS_DEFS, STATUS_KINDS, STATUS_MAX, STATUS_QB_N } from '../data/status.js';
import { mergeGeos } from '../render/geometry.js';
import { MechEntity } from './mech-entity.js';

const isClient = (g) => !!(g.net && g.net.role === 'client');
const now = () => performance.now() / 1000;
// 只在本機播放的特效與音效（房主呼叫時不轉送給客機：客機由快照的變化自己播）
function localFx(g, fn) {
  const n = g.fx._nested;
  g.fx._nested = true;
  try {
    fn(g.fx);
  } finally {
    g.fx._nested = n;
  }
}
function localSfx(fn) {
  const m = SFX.mirror;
  SFX.mirror = null;
  try {
    fn();
  } finally {
    SFX.mirror = m;
  }
}
// 只給本機玩家的中央訊息（flashMsg 在房主會轉送給所有客機）
function localMsg(g, txt, color, dur) {
  g.netEv = () => {};
  try {
    g.flashMsg(txt, color, dur);
  } finally {
    delete g.netEv;
  }
}

// ---------- 共用的幾何與材質 ----------
const Y = new THREE.Vector3(0, 1, 0);
const G = {};
function geo() {
  if (G.cyl) return G;
  G.cyl = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  G.sph = new THREE.SphereGeometry(1, 12, 8);
  G.ring = new THREE.RingGeometry(0.82, 1, 40);
  G.arc = new THREE.RingGeometry(0.8, 1, 16, 1, 0, Math.PI / 3);
  G.torus = new THREE.TorusGeometry(1, 0.09, 6, 28);
  G.cone = new THREE.ConeGeometry(0.28, 0.6, 4);
  G.beam = new THREE.CylinderGeometry(0.5, 2.4, 1, 20, 1, true);
  G.box = new THREE.BoxGeometry(1, 1, 1);
  G.claw = new THREE.TorusGeometry(0.32, 0.07, 5, 12, Math.PI * 1.4);
  // 捕獲網：二十面體（細分一次）的每條邊做成細的四角柱，合併成一個網格
  const ico = new THREE.IcosahedronGeometry(1, 1);
  const eg = new THREE.EdgesGeometry(ico);
  const p = eg.attributes.position;
  const list = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    q = new THREE.Quaternion();
  for (let i = 0; i < p.count; i += 2) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    const d = b.clone().sub(a),
      L = d.length();
    const cg = new THREE.CylinderGeometry(0.028, 0.028, L, 4, 1, true);
    q.setFromUnitVectors(Y, d.normalize());
    const mm = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    list.push({ geo: cg, mm });
  }
  for (let i = 0; i < ico.attributes.position.count; i += 3) {
    // 網結：每個三角形的第一個頂點放一個小方塊
    a.fromBufferAttribute(ico.attributes.position, i);
    list.push({
      geo: new THREE.BoxGeometry(0.09, 0.09, 0.09),
      mm: new THREE.Matrix4().makeTranslation(a.x, a.y, a.z),
    });
  }
  G.net = mergeGeos(list);
  return G;
}
const addMat = (color, opacity) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
const solidMat = (color) => new THREE.MeshBasicMaterial({ color });
// 結霜：機體每個網格掛一個共用幾何的子網格（略過透明、描邊與 X 光）
const FROST_MAT = new THREE.MeshBasicMaterial({
  color: 0xd8f4ff,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
});
// 蒙皮網格（render/foe-merge.js 合併的專屬敵人）的冰殼：同一副骨架、蒙皮版的材質（r128 的材質不能兩種共用）
const FROST_SKIN = FROST_MAT.clone();
FROST_SKIN.skinning = true;
const helper = (o) => {
  o.traverse((x) => {
    x.userData.helper = true;
    x.userData.stsFx = true;
    x.castShadow = x.receiveShadow = false;
    if (x.isMesh) x.raycast = () => {};
  });
  return o;
};

Object.assign(MechEntity.prototype, {
  // ---------- API（只在房主／單機呼叫） ----------
  addStatus(kind, sec, o = {}) {
    const g = this.game;
    if (!STATUS_DEFS[kind] || this.dead || isClient(g)) return false;
    sec = clamp(+sec || 0, 0, STATUS_MAX);
    if (sec <= 0) return false;
    if (!this.sts) this.sts = {};
    const s = this.sts[kind];
    const src = o.src !== undefined ? o.src : -1;
    if (s) {
      // 同種再上：取較長的時間（參數換成新的）
      if (sec > s.t) {
        s.t = sec;
        s.T = Math.max(s.T, sec);
      }
      s.o = Object.assign(s.o, o);
      if (src >= 0) s.src = src;
      return true;
    }
    this.sts[kind] = { t: sec, T: sec, src, o: Object.assign({}, o), n: 0, acc: 0 };
    this.statusOnAdd(kind);
    return true;
  },
  hasStatus(kind) {
    return !!(this.sts && this.sts[kind]);
  },
  // why：'esc' 掙脫（QB）、'cut' 近戰割開、'end' 時間到、'lost' 來源消失；clear 不給時當作 'end'
  clearStatus(kind, why = 'end') {
    const s = this.sts && this.sts[kind];
    if (!s) return;
    delete this.sts[kind];
    if (isClient(this.game) && (why === 'esc' || why === 'cut')) {
      // 客機自己預測的解除：之後一小段時間的快照還沒反映，先忽略
      this.stsGone = this.stsGone || {};
      this.stsGone[kind] = now() + 0.6;
    }
    this.statusOnRemove(kind, why, s);
    if (!Object.keys(this.sts).length) this.sts = null;
  },
  statusClearAll(silent) {
    if (this.sts && !silent) for (const k of Object.keys(this.sts)) this.clearStatus(k);
    this.sts = null;
    this.statusVisClear();
  },
  // ---------- 移動效果（move 裡呼叫；房主與客機的自身預測都跑） ----------
  stsSpeedK() {
    const S = this.sts;
    let k = 1;
    if (S.slow) k = Math.min(k, S.slow.o.k || 0.6);
    if (S.net) k = Math.min(k, S.net.o.k || 0.6);
    if (S.latch) k = Math.min(k, 0.6);
    return k;
  },
  stsQbK() {
    const S = this.sts;
    let k = 1;
    if (S.slow) k = Math.max(k, S.slow.o.qb || 1.5);
    if (S.net) k = Math.max(k, S.net.o.qb || 1.5);
    return k;
  },
  stsNoJump() {
    return !!(this.sts && (this.sts.nojump || this.sts.net));
  },
  // 有可以用 QB 掙脫的狀態（沒有方向也能 QB：原地甩動）
  stsQbEscape() {
    return !!(this.sts && (this.sts.hook || this.sts.stick || this.sts.latch));
  },
  stsSrc(s) {
    if (!(s.src >= 0)) return null;
    const e = this.game.entById(s.src);
    return e && !e.dead ? e : null;
  },
  // 每格：倒數、黏附炸彈爆炸、纏附的持續傷害、吸取 EN、鉤住的來源消失
  statusTick(dt) {
    const g = this.game,
      host = !isClient(g);
    for (const k of Object.keys(this.sts || {})) {
      const s = this.sts[k];
      if (!s) continue;
      s.t -= dt;
      if (k === 'latch' && host) {
        s.acc += dt;
        if (s.acc >= 0.5) {
          const dps = s.o.dps || 0;
          if (dps > 0)
            this.takeDamage(
              dps * s.acc,
              0,
              this.stsSrc(s),
              this.center(),
              null,
              null,
              null,
              s.o.attr || 'kin',
            );
          s.acc = 0;
        }
      }
      if (k === 'drain') {
        this.en = Math.max(0, this.en - (s.o.en || 0) * dt);
        this.enDelay = Math.max(this.enDelay || 0, 0.25);
      }
      // 來源（鉤住的、纏附的、吸取的）被擊破或離場（depart 也會設 dead）：自動解除
      if ((k === 'hook' || k === 'latch' || k === 'drain') && host && s.src >= 0 && !this.stsSrc(s)) {
        this.clearStatus(k, 'lost');
        continue;
      }
      if (this.dead || !this.sts) return;
      if (!host) {
        s.t = Math.max(0, s.t); // 客機：時間到由快照解除（自己先拿掉的話，晚到的快照會再加一次）
        continue;
      }
      if (s.t <= 0) {
        if (k === 'stick') this.statusBlast(s);
        if (this.sts) this.clearStatus(k, 'end');
      }
    }
  },
  // 黏附炸彈爆炸（房主／單機）：爆發屬性
  statusBlast(s) {
    const g = this.game,
      c = this.center();
    g.fx.explosion(c, 3.2, 0xff6030, false);
    SFX.explode(false, this.isPlayer ? null : c);
    const src = this.stsSrc(s);
    this.takeDamage(
      s.o.dmg !== undefined ? s.o.dmg : 900,
      s.o.impact !== undefined ? s.o.impact : 900,
      src,
      c,
      null,
      null,
      null,
      'exp',
    );
    if (this.isPlayer) {
      g.camShake = Math.max(g.camShake, 0.35);
      g.rumble(0.8, 0.8, 300);
    }
  },
  // QB 一次（move 的 QB 成立時）：hook 掙脫；stick／latch 累積到兩次甩掉
  statusQB() {
    const S = this.sts;
    if (!S) return;
    if (S.hook) this.clearStatus('hook', 'esc');
    for (const k of ['stick', 'latch']) {
      const s = this.sts && this.sts[k];
      if (!s) continue;
      s.n++;
      if (s.n >= STATUS_QB_N[k]) this.clearStatus(k, 'esc');
      else this.statusShake(k);
    }
  },
  // 近戰攻擊（startMeleeStage）：割開 net 與 latch
  statusMelee() {
    if (!this.sts) return;
    if (this.sts.net) this.clearStatus('net', 'cut');
    if (this.sts && this.sts.latch) this.clearStatus('latch', 'cut');
  },
  // 鉤住：往來源拉（水平），空中時往下拉；o.pull m/s（預設 14，舊尺度、這裡乘 DS），離來源 12 m 內不再拉
  statusPull(target, dt) {
    const S = this.sts;
    if (S.hook) {
      const s = S.hook;
      const src = this.stsSrc(s);
      const to = src ? src.pos : s.o.at ? new THREE.Vector3(s.o.at[0], s.o.at[1], s.o.at[2]) : null;
      if (to) {
        const d = to.clone().sub(this.pos).setY(0);
        const L = d.length();
        if (L > 4 * DS)
          target.addScaledVector(d.normalize(), (s.o.pull || 14) * DS * Math.min(1, (L - 4 * DS) / (3 * DS)));
        if (!this.grounded && !this.flying) this.vel.y -= 14 * DS * dt;
      }
    }
    if (this.stsNoJump() && !this.grounded && !this.flying) this.vel.y -= 26 * DS * dt;
  },
  // ---------- 同步 ----------
  // 快照的 su：每個狀態 [種類編號, 剩餘 ×10, 總秒數 ×10, 來源 id, QB 次數]
  statusSer() {
    const out = [];
    for (const k in this.sts) {
      const s = this.sts[k];
      out.push(STATUS_KINDS.indexOf(k), Math.max(0, Math.round(s.t * 10)), Math.round(s.T * 10), s.src, s.n);
    }
    return out;
  },
  statusApply(su) {
    const next = {};
    if (su)
      for (let i = 0; i + 4 < su.length; i += 5) {
        const k = STATUS_KINDS[su[i]];
        if (!k) continue;
        if (this.stsGone && this.stsGone[k] > now()) continue;
        next[k] = { t: su[i + 1] / 10, T: su[i + 2] / 10, src: su[i + 3], n: su[i + 4] };
      }
    const S = this.sts || {};
    for (const k of Object.keys(S)) {
      if (next[k]) continue;
      const s = S[k];
      delete S[k];
      // 還剩不少時間就消失＝掙脫／割開
      this.statusOnRemove(k, s.t > 0.25 ? (k === 'net' ? 'cut' : 'esc') : 'end', s);
    }
    for (const k in next) {
      const n = next[k];
      if (S[k]) {
        Object.assign(S[k], { t: n.t, T: n.T, src: n.src, n: Math.max(S[k].n, n.n) });
      } else {
        S[k] = Object.assign(n, { o: {}, acc: 0 });
        this.sts = S;
        this.statusOnAdd(k);
      }
    }
    this.sts = Object.keys(S).length ? S : null;
  },
  // 客機上別人的機體：只倒數（顯示用）
  statusRemoteTick(dt) {
    for (const k in this.sts) this.sts[k].t = Math.max(0, this.sts[k].t - dt);
  },
  // ---------- 回饋（各端自己播） ----------
  statusLocal() {
    const g = this.game;
    return this === g.player && !g.spectator;
  },
  statusOnAdd(kind) {
    const g = this.game,
      D = STATUS_DEFS[kind];
    if (!g.world) return;
    const c = this.center(),
      me = this.statusLocal();
    const pos = me ? null : c;
    localSfx(() => {
      if (kind === 'hook') {
        SFX.play('plate1', 0.9, 0.7, 0.05, 0.05, pos);
        SFX.play('clatter1', 0.7, 0.8, 0.05, 0.05, pos);
      } else if (kind === 'stick') {
        SFX.play('crunch1', 0.7, 1.3, 0.05, 0.05, pos);
        SFX.play('uiTick', 0.8, 0.8, 0.02, 0.05, pos);
      } else if (kind === 'latch') {
        SFX.play('crunch2', 0.9, 0.7, 0.05, 0.05, pos);
        SFX.play('splash', 0.5, 0.6, 0.05, 0.05, pos);
      } else if (kind === 'slow') {
        SFX.play('glass', 0.6, 1.4, 0.05, 0.05, pos);
        SFX.play('stepSnow1', 0.8, 0.6, 0.05, 0.05, pos);
      } else if (kind === 'nojump') {
        SFX.play('overload', 0.6, 0.6, 0.05, 0.05, pos);
      } else if (kind === 'net') {
        SFX.play('clatter2', 0.9, 1.0, 0.05, 0.05, pos);
        SFX.play('door', 0.5, 1.5, 0.05, 0.05, pos);
      } else if (kind === 'spotted') {
        SFX.play('charge', 0.5, 1.6, 0.05, 0.05, pos);
      } else if (kind === 'drain') {
        SFX.play('dome1', 0.6, 0.6, 0.05, 0.05, pos);
      }
    });
    localFx(g, (fx) => {
      fx.shockwave(c, (3.2 * (this.scale || 1)) / fx.k, D.hex, 0.35);
      fx.flash(c, 1.6, D.hex, 0.15);
    });
    if (me) {
      if (kind !== 'spotted' && kind !== 'drain') {
        SFX.alert();
        g.rumble(0.5, 0.4, 160);
        g.camShake = Math.max(g.camShake || 0, 0.12);
      }
      // 每種狀態第一次中招時說明（這次開啟遊戲）
      g.stsSeen = g.stsSeen || new Set();
      if (!g.stsSeen.has(kind)) {
        g.stsSeen.add(kind);
        localMsg(g, D.first, D.hex, 3.2);
      }
      g.stsFlash = { k: kind, t: 0.5 };
    }
  },
  statusOnRemove(kind, why, s) {
    const g = this.game;
    if (!g.world || this.dead) return;
    const c = this.center(),
      me = this.statusLocal();
    const pos = me ? null : c;
    const D = STATUS_DEFS[kind];
    if (why === 'esc' || why === 'cut') {
      localSfx(() => {
        if (why === 'cut') SFX.play('glass', 0.7, 1.1, 0.05, 0.05, pos);
        else SFX.play('plate2', 0.8, 1.2, 0.05, 0.05, pos);
        SFX.play('uiOk', 0.5, 1.3, 0.02, 0.05, me ? null : pos, me ? 'ui' : null);
      });
      localFx(g, (fx) => {
        fx.shockwave(c, (4 * (this.scale || 1)) / fx.k, 0xffffff, 0.3);
        fx.streaks(c, 10, D.hex, 14, 0.35, 20);
      });
      if (kind === 'stick' && s && why === 'esc') {
        // 甩掉的炸彈落在附近爆開（沒有傷害）
        const p = c.clone().add(new THREE.Vector3(rnd(-5, 5), -1, rnd(-5, 5)));
        localFx(g, (fx) => fx.explosion(p, 1.6, 0xff6030, false));
      }
      if (me) {
        g.stsFlash = { k: kind, t: 0.35, ok: 1 };
        g.pushPopup?.(c.clone().add(new THREE.Vector3(0, 2, 0)), why === 'cut' ? '割開！' : '掙脫！', true);
      }
    }
  },
  // QB 次數還不夠：甩動的回饋
  statusShake(kind) {
    const g = this.game;
    if (!g.world) return;
    const c = this.center();
    localFx(g, (fx) => fx.streaks(c, 6, STATUS_DEFS[kind].hex, 10, 0.25, 20));
    localSfx(() => SFX.play('clatter1', 0.6, 1.3, 0.05, 0.05, this.statusLocal() ? null : c));
  },
  // ---------- 機體上的 3D 效果（move／remoteUpdate 的結尾呼叫） ----------
  statusFx(dt) {
    const g = this.game;
    const V = (this.stsV = this.stsV || {});
    const S = this.dead ? {} : this.sts || {};
    for (const k of Object.keys(V))
      if (!S[k] || (k === 'slow' && V[k].mesh !== this.mesh)) this.stsVisRemove(k);
    if (this.dead || !this.sts || !g.world) return;
    const T = (this.stsT = (this.stsT || 0) + dt);
    const c = this.center();
    const sc = this.scale || 1;
    const h = this.model.height * sc;
    const R = Math.max(1.1 * MS, (this.radius || 1.5 * MS) * 0.95);
    // 第一人稱：自己機體上的網、纏附物、炸彈、箭頭會擋住鏡頭，改靠 HUD 與畫面邊緣（鋼索、光束照常顯示）
    const hideBody = !!g.fp && this.statusLocal();
    for (const k in S) {
      const s = S[k];
      let v = V[k];
      if (!v) v = V[k] = this.stsVisMake(k);
      const fade = clamp(s.t / 0.4, 0, 1); // 快結束時淡出
      if (k === 'hook') {
        const src = this.stsSrc(s);
        const at = src ? src.center() : s.o && s.o.at ? new THREE.Vector3(...s.o.at) : null;
        v.cable.visible = v.glow.visible = !!at;
        // 鉤爪掛在胸前，跟著機體轉
        const fw = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const a = c
          .clone()
          .addScaledVector(fw, R * 0.55)
          .add(new THREE.Vector3(0, h * 0.12, 0));
        v.claw.position.copy(a);
        v.claw.rotation.set(0, this.yaw, T * 8);
        if (at) {
          const d = at.clone().sub(a),
            L = Math.max(0.1, d.length());
          // 繃緊的鋼索微微抖動
          const mid = a
            .clone()
            .addScaledVector(d, 0.5)
            .add(new THREE.Vector3(0, Math.sin(T * 40) * 0.04, 0));
          const q = new THREE.Quaternion().setFromUnitVectors(Y, d.normalize());
          for (const m of [v.cable, v.glow]) {
            m.position.copy(mid);
            m.quaternion.copy(q);
          }
          v.cable.scale.set(0.07, L, 0.07);
          v.glow.scale.set(0.17, L, 0.17);
          v.glow.material.opacity = (0.35 + 0.25 * Math.sin(T * 18)) * fade;
        }
      } else if (k === 'stick') {
        // 背上的炸彈：閃燈越來越快、嗶聲
        const bk = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        v.g.position
          .copy(c)
          .addScaledVector(bk, R * 0.5)
          .add(new THREE.Vector3(0, h * 0.15, 0));
        v.g.rotation.y = this.yaw;
        const per = 0.1 + 0.5 * clamp(s.t / Math.max(0.5, s.T), 0, 1);
        v.ph = (v.ph || 0) + dt / per;
        if (v.ph >= 1) {
          v.ph -= Math.floor(v.ph);
          const me = this.statusLocal();
          if (me || (g.player && g.player.pos.distanceTo(this.pos) < 45 * DS))
            SFX.tone(
              s.t < 1 ? 2200 : 1700,
              s.t < 1 ? 2200 : 1700,
              0.05,
              me ? 0.35 : 0.12,
              'square',
              me ? 'ui' : 'sfx',
            );
        }
        const on = v.ph < 0.4;
        v.lamp.material.color.setHex(on ? 0xff2a1a : 0x401010);
        v.halo.visible = on;
        v.halo.scale.setScalar(0.5 + (1 - clamp(s.t / s.T, 0, 1)) * 0.5);
      } else if (k === 'latch') {
        v.g.position.copy(c);
        for (let i = 0; i < v.rings.length; i++) {
          const r = v.rings[i];
          r.rotation.set(1.2 + i * 0.7 + Math.sin(T * 2 + i) * 0.2, T * (0.8 + i * 0.3), 0.4 * i);
          r.scale.setScalar(R * (0.8 + 0.12 * i) * (1 + 0.05 * Math.sin(T * 6 + i)));
        }
        v.pulse.material.opacity = (0.25 + 0.2 * Math.sin(T * 7)) * fade;
      } else if (k === 'slow') {
        FROST_MAT.opacity = 0.38 + 0.12 * Math.sin(T * 3);
        if (Math.random() < dt * 10)
          localFx(g, (fx) =>
            fx.smoke(
              c.clone().add(new THREE.Vector3(rnd(-R, R), rnd(-h * 0.4, h * 0.4), rnd(-R, R))),
              0.5,
              0xe8f8ff,
              0.8,
              -0.6,
            ),
          );
      } else if (k === 'nojump') {
        const gy = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
        v.ring.position.set(this.pos.x, gy + 0.12, this.pos.z);
        v.ring.scale.setScalar(R * 1.5 * (1 + 0.08 * Math.sin(T * 5)));
        v.ring.material.opacity = 0.6 * fade;
        // 往下壓的箭頭：在頭上到腳下之間循環
        for (let i = 0; i < v.arrows.length; i++) {
          const ar = v.arrows[i];
          const ph = (T * 0.9 + i / v.arrows.length) % 1;
          const ang = (i / v.arrows.length) * Math.PI * 2 + T * 0.6;
          ar.position.set(
            this.pos.x + Math.cos(ang) * R * 1.2,
            this.pos.y + h * (1.25 - ph * 1.2),
            this.pos.z + Math.sin(ang) * R * 1.2,
          );
          ar.material.opacity = Math.sin(ph * Math.PI) * 0.9 * fade;
        }
      } else if (k === 'net') {
        v.m.position.copy(c);
        v.m.scale.set(R * 1.25, h * 0.62, R * 1.25);
        v.m.rotation.set(Math.sin(T * 3) * 0.05, T * 0.3, Math.cos(T * 2.6) * 0.05);
        v.m.material.opacity = 0.95 * fade;
        v.in.position.copy(c);
        v.in.scale.copy(v.m.scale).multiplyScalar(0.97);
        v.in.material.opacity = (0.1 + 0.05 * Math.sin(T * 8)) * fade;
      } else if (k === 'spotted') {
        const gy = g.world.groundAt(this.pos.x, this.pos.z, this.pos.y + 1);
        v.beam.position.set(this.pos.x, gy + 20, this.pos.z);
        v.beam.material.opacity = (0.16 + 0.06 * Math.sin(T * 9)) * fade;
        v.ring.position.set(this.pos.x, gy + 0.15, this.pos.z);
        v.ring.rotation.z = T * 1.6;
        v.ring.scale.setScalar(R * 1.7 * (1 + 0.1 * Math.sin(T * 4)));
        for (const m of v.ring.children) m.material.opacity = 0.85 * fade;
      } else if (k === 'drain') {
        const src = this.stsSrc(s);
        const to = src ? src.center() : c.clone().add(new THREE.Vector3(0, 6, 0));
        const d = to.clone().sub(c),
          L = Math.max(0.1, d.length());
        v.line.position.copy(c).addScaledVector(d, 0.5);
        v.line.quaternion.setFromUnitVectors(Y, d.clone().normalize());
        v.line.scale.set(0.1, L, 0.1);
        v.line.material.opacity = (0.3 + 0.2 * Math.sin(T * 14)) * fade;
        for (let i = 0; i < v.dots.length; i++) {
          const ph = (T * 0.8 + i / v.dots.length) % 1;
          v.dots[i].position.copy(c).addScaledVector(d, ph);
          v.dots[i].scale.setScalar(0.22 * (1 - ph * 0.5));
          v.dots[i].material.opacity = 0.9 * fade;
        }
      }
    }
    for (const k of ['net', 'latch', 'stick', 'nojump'])
      if (V[k]) for (const o of V[k].objs) o.visible = !hideBody;
    if (V.hook) V.hook.claw.visible = !hideBody;
  },
  stsVisMake(k) {
    const g = this.game,
      GG = geo(),
      D = STATUS_DEFS[k];
    const v = { objs: [] };
    const put = (o) => {
      helper(o);
      g.scene.add(o);
      v.objs.push(o);
      return o;
    };
    if (k === 'hook') {
      v.cable = put(new THREE.Mesh(GG.cyl, solidMat(0x303238)));
      v.glow = put(new THREE.Mesh(GG.cyl, addMat(D.hex, 0.5)));
      v.claw = put(new THREE.Mesh(GG.claw, solidMat(0xffa040)));
    } else if (k === 'stick') {
      v.g = put(new THREE.Group());
      const body = new THREE.Mesh(GG.box, solidMat(0x2b2d30));
      body.scale.set(0.42, 0.42, 0.26);
      const band = new THREE.Mesh(GG.box, solidMat(0xe0b020));
      band.scale.set(0.44, 0.08, 0.28);
      v.lamp = new THREE.Mesh(GG.sph, solidMat(0xff2a1a));
      v.lamp.scale.setScalar(0.12);
      v.lamp.position.set(0, 0.24, 0.05);
      v.halo = new THREE.Mesh(GG.sph, addMat(0xff3020, 0.55));
      v.halo.position.copy(v.lamp.position);
      for (const m of [body, band, v.lamp, v.halo]) v.g.add(m);
      helper(v.g);
    } else if (k === 'latch') {
      v.g = put(new THREE.Group());
      v.rings = [];
      for (let i = 0; i < 3; i++) {
        const r = new THREE.Mesh(GG.torus, solidMat(i === 1 ? 0x5a1030 : 0x3a0c22));
        v.rings.push(r);
        v.g.add(r);
      }
      v.pulse = new THREE.Mesh(GG.sph, addMat(D.hex, 0.3));
      v.pulse.scale.setScalar(1.3);
      v.g.add(v.pulse);
      helper(v.g);
    } else if (k === 'slow') {
      // 結霜：機體網格各掛一層半透明的冰殼
      v.mesh = this.mesh;
      v.frost = [];
      const list = [];
      this.mesh.traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.geometry || o.userData.xray || o.userData.stsFx) return;
        const m = o.material;
        if (
          !m ||
          Array.isArray(m) ||
          m.transparent ||
          m.isShaderMaterial ||
          m.blending === THREE.AdditiveBlending
        )
          return;
        list.push(o);
      });
      for (const o of list) {
        const x = o.isSkinnedMesh
          ? new THREE.SkinnedMesh(o.geometry, FROST_SKIN)
          : new THREE.Mesh(o.geometry, FROST_MAT);
        if (o.isSkinnedMesh) x.bind(o.skeleton, o.bindMatrix);
        x.renderOrder = 15;
        helper(x);
        o.add(x);
        v.frost.push(x);
      }
    } else if (k === 'nojump') {
      v.ring = put(new THREE.Mesh(GG.ring, addMat(D.hex, 0.6)));
      v.ring.rotation.x = -Math.PI / 2;
      v.arrows = [];
      for (let i = 0; i < 4; i++) {
        const a = put(new THREE.Mesh(GG.cone, addMat(D.hex, 0.8)));
        a.rotation.x = Math.PI; // 尖端朝下
        v.arrows.push(a);
      }
    } else if (k === 'net') {
      v.m = put(new THREE.Mesh(GG.net, solidMat(0xc8ff4a)));
      v.m.material.transparent = true;
      v.in = put(new THREE.Mesh(GG.sph, addMat(D.hex, 0.12)));
    } else if (k === 'spotted') {
      v.beam = put(new THREE.Mesh(GG.beam, addMat(D.hex, 0.18)));
      v.beam.scale.set(1, 40, 1);
      v.ring = put(new THREE.Group());
      v.ring.rotation.x = -Math.PI / 2;
      for (let i = 0; i < 4; i++) {
        const a = new THREE.Mesh(GG.arc, addMat(D.hex, 0.85));
        a.rotation.z = (i * Math.PI) / 2;
        v.ring.add(a);
      }
      helper(v.ring); // rotation.x 固定（平放），每格改 rotation.z 在地面上轉
    } else if (k === 'drain') {
      v.line = put(new THREE.Mesh(GG.cyl, addMat(D.hex, 0.4)));
      v.dots = [];
      for (let i = 0; i < 6; i++) v.dots.push(put(new THREE.Mesh(GG.sph, addMat(D.hex, 0.9))));
    }
    return v;
  },
  stsVisRemove(k) {
    const v = this.stsV && this.stsV[k];
    if (!v) return;
    for (const o of v.objs) {
      this.game.scene.remove(o);
      o.traverse((x) => {
        if (x.material && x.material !== FROST_MAT && x.material !== FROST_SKIN) x.material.dispose();
      });
    }
    if (v.frost) for (const x of v.frost) if (x.parent) x.parent.remove(x);
    delete this.stsV[k];
  },
  statusVisClear() {
    if (this.stsV) for (const k of Object.keys(this.stsV)) this.stsVisRemove(k);
  },
});
