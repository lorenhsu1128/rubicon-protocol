// MechEntity 擴充：受擊反應改版（docs/hit-react-design.md）。依武器的受擊特徵（data/hit-react.js）記下這一下的
// 方向（機體座標）、高度（−1 腳～1 頭）與幅度，animateMech 以 render/hit-react-pose.js 算姿勢。只改外觀。
// 房主／單機在 takeDamage 呼叫 hrFromHit；客機收到 hr 事件呼叫 hrAdd（不再轉送）。
import { clamp } from '../core/math.js';
import { HR, HR_IDX, hrKindOf, hrWeight } from '../data/hit-react.js';
import { MechEntity } from './mech-entity.js';

const MAX_N = 4; // 同時播放的受擊動作
const NET_GAP = 0.12; // 同一種反應送給客機的最短間隔（機槍、雷射一直打中時）

Object.assign(MechEntity.prototype, {
  // takeDamage（不是近戰）：W＝武器定義、attr＝屬性、at＝命中點、dir＝子彈方向（爆炸是 undefined）、from＝攻擊者
  hrFromHit(W, attr, at, dir, from) {
    if (!this.model || this.isProp || this.dead) return null;
    const k = hrKindOf(W, attr, !dir);
    if (!k) return null;
    // 推的方向：子彈的方向，沒有時（爆炸）從爆炸點／攻擊者往機體
    let dx = 0,
      dz = 0;
    if (dir) {
      dx = dir.x;
      dz = dir.z;
    } else {
      const src = at || (from && from.pos);
      if (src) {
        dx = this.pos.x - src.x;
        dz = this.pos.z - src.z;
      }
    }
    const c = Math.cos(this.yaw),
      s = Math.sin(this.yaw);
    let lx = dx * c - dz * s,
      lz = dx * s + dz * c;
    const l = Math.hypot(lx, lz);
    if (l < 1e-4) {
      lx = 0;
      lz = 1;
    } else {
      lx /= l;
      lz /= l;
    }
    // 命中的高度：命中點相對機體中心（爆炸一律算中間）
    const h = this.model.height || 1;
    const y = dir && at ? clamp((at.y - (this.pos.y + h * 0.5)) / (h * 0.5), -1, 1) : 0;
    this.hrAdd(k, lx, lz, y, true);
    return k;
  },
  // 加一個受擊動作（房主／單機 net＝true 時送 hr 事件）
  hrAdd(k, lx, lz, y, net) {
    const S = HR[k];
    if (!S) return;
    const L = this.hrs || (this.hrs = []);
    const w = hrWeight(this);
    this.hrN = (this.hrN || 0) + 1;
    // 持續挨打的累積（機槍類）
    if (S.pr) this.hrPress = Math.min(1, (this.hrPress || 0) + S.pr);
    // 合併：霰彈的彈丸（m 秒內）、持續照射（hold：延長）、連續震（shake：重來但不另外甩）
    const same = L.find((e) => e.k === k && (S.hold || S.c === 'shake' || (S.m && e.t < S.m)));
    let sendNet = net;
    if (same) {
      if (S.hold) same.t = Math.min(same.t, S.T * 0.3);
      else if (S.c === 'shake') same.t = 0;
      same.x = lx;
      same.z = lz;
      same.y = y;
      if (net && this.t - (same.nt || -9) < NET_GAP) sendNet = false;
      if (sendNet) same.nt = this.t;
    } else {
      this.hrAlt = -(this.hrAlt || 1);
      const e = { k, t: 0, T: S.T, x: lx, z: lz, y, w, s: S.alt ? this.hrAlt : 1, n: this.hrN, nt: this.t };
      L.push(e);
      if (L.length > MAX_N) L.shift();
    }
    const g = this.game;
    if (sendNet && g.net && g.net.role === 'host')
      g.netEv({ t: 'hr', i: this.id, k: HR_IDX[k], x: +lx.toFixed(2), z: +lz.toFixed(2), y: +y.toFixed(2) });
  },
  // 每格（move／remoteUpdate）
  hrTick(dt) {
    const L = this.hrs;
    if (L && L.length) {
      for (const e of L) e.t += dt;
      for (let i = L.length - 1; i >= 0; i--) if (L[i].t >= L[i].T) L.splice(i, 1);
    }
    if (this.hrPress > 0) this.hrPress = Math.max(0, this.hrPress - dt * 0.9);
  },
  // animateMech 的 st.hr
  hrState() {
    const L = this.hrs;
    if ((!L || !L.length) && !(this.hrPress > 0)) return null;
    return { L: L || [], p: (this.hrPress || 0) * hrWeight(this) };
  },
});
