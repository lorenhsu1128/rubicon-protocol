// ---------- MechEntity 擴充：敵人 AI 的感知、警戒狀態、仇恨（數值在 data/ai.js；權杖與節奏導演在 game/ai-director.js）----------
// 狀態 sn.st：0 待機（在原地附近走動）、1 起疑（看到一點或聽到聲音：停下轉向、前往查看）、2 交戰、3 搜索（整隊都看不到目標：
// 前往最後已知位置）。感知：視覺距離＋視角＋視線（World.losBlocked），察覺量表滿了才交戰；受到攻擊直接交戰。
// 交戰中每 LOS_DT 秒檢查視線；看不到時用附近友軍共享的目標位置，整隊都看不到 LOST_T 秒才搜索；敵對 AC 一直知道目標在哪。
// 仇恨：受到的傷害（AP 比例）＋距離＋玩家正鎖定我，目前的目標有黏著倍率。只在房主／單機執行；狀態以 sx 之外的 aw 同步顯示。
import { clamp, rnd } from '../core/math.js';
import {
  LOS_DT,
  LOST_T,
  NO_TOKEN,
  RADIO_DL,
  SEARCH_T,
  SENSE,
  SENSE_DECAY,
  SENSE_INSTANT,
  SENSE_NEAR,
  SHARE_R,
  STICKY,
  SUP_RING,
  SUSPECT_AT,
  THREAT_DECAY,
  THREAT_LOCK,
  THREAT_NEAR,
} from '../data/ai.js';
import { MechEntity } from './mech-entity.js';

const FLYERS = new Set(['drone', 'heli', 'swarm', 'minelayer']);

Object.assign(MechEntity.prototype, {
  // 這台敵人用不用感知系統：一般任務與主線的敵人（Boss、部位、目標物、支援類、PvP、實驗室、靶場照原本的方式）
  senseOn() {
    const g = this.game;
    if (this.sn) return this.sn.on;
    const on =
      this.team === 'enemy' &&
      !g.pvp &&
      !g.lab &&
      !g.cine &&
      !g.rts &&
      !g.range &&
      !g.aiOld &&
      !this.isBoss &&
      !this.opts.bossKind &&
      !NO_TOKEN.has(this.ai);
    if (!on) return false;
    this.senseInit(false);
    return true;
  },
  // idle＝一開始在待機（第一波、據點守衛）；否則一生成就在交戰（增援知道玩家在哪）
  senseInit(idle) {
    const g = this.game;
    const D = SENSE[this.ai] || SENSE.default;
    this.sn = {
      on: true,
      st: idle ? 0 : 2,
      sight: D.sight,
      fov: (D.fov * Math.PI) / 180,
      meter: 0,
      kn: null, // 最後已知的目標位置
      knT: g.time,
      los: false,
      losT: Math.random() * LOS_DT,
      blind: 0, // 自己看不到目標的累計秒數
      tgt: null,
      th: new Map(), // 仇恨：實體 id → 值
      pickT: 0,
      percT: Math.random() * 0.2,
      tok: false, // 攻擊權杖（主攻）
      tokT: 0,
      restT: rnd(0, 1.5),
      lastHeld: g.time,
      home: this.pos.clone(),
      wT: 0,
      wGoal: null,
      look: this.yaw,
      spotT: -9,
      radioT: -1,
      heard: null,
      susT: 0,
      srchT: 0,
      mv: null, // 進行中的招式（mech-moves.js）
      mvCd: rnd(0.6, 1.6),
      mvI: 0,
      vuln: 0, // 招式後的破綻（受傷 ×1.25）
      ring: rnd(SUP_RING[0], SUP_RING[1]),
    };
    if (this.guardOf) this.sn.st = 2; // 守衛：還沒出動時由 guardIdle 守在原地，出動後直接交戰
  },
  // 每格（updateAI 選目標之前）：待機／起疑／搜索時自己移動並回傳 true；交戰時更新目標、視線，回傳 false
  senseTick(dt) {
    const g = this.game,
      sn = this.sn;
    sn.restT -= dt;
    if (sn.vuln > 0) sn.vuln -= dt;
    if (sn.th.size) {
      const k = Math.max(0, 1 - THREAT_DECAY * dt);
      for (const [id, v] of sn.th) {
        if (v * k < 0.05) sn.th.delete(id);
        else sn.th.set(id, v * k);
      }
    }
    const cands = g.hostilesOfEnt(this).filter((h) => !h.dead && !h.noLock && !h.downed);
    if (sn.st === 2) {
      this.senseEngaged(dt, cands);
      return false;
    }
    this.senseIdle(dt, cands);
    return true;
  },
  senseEngaged(dt, cands) {
    const g = this.game,
      sn = this.sn;
    // 通知附近友軍（發現後 RADIO_DL 秒）
    if (sn.radioT > 0 && (sn.radioT -= dt) <= 0) g.aiRadio(this);
    // 選目標（仇恨）
    sn.pickT -= dt;
    if (sn.pickT <= 0 || !sn.tgt || sn.tgt.dead || sn.tgt.noLock || sn.tgt.downed) {
      sn.pickT = 0.5;
      let best = null,
        bs = -1;
      for (const c of cands) {
        const d = Math.max(4, Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z));
        let sc = (sn.th.get(c.id) || 0) + THREAT_NEAR / d + (c.lock === this ? THREAT_LOCK : 0);
        if (this.opts.pref === 'far') sc = d / 10 + (sn.th.get(c.id) || 0);
        else if (this.opts.pref === 'ally' && !c.isPlayer) sc += 6;
        else if (this.opts.pref === 'still' && c.vel.lengthSq() < 4) sc += 4;
        if (c === sn.tgt) sc *= STICKY;
        if (sc > bs) {
          bs = sc;
          best = c;
        }
      }
      if (best !== sn.tgt) {
        if (sn.tok) g.aiRelease(this);
        sn.tgt = best;
        sn.losT = 0;
        if (best && !sn.kn) {
          sn.kn = best.pos.clone();
          sn.knT = g.time;
        }
      }
    }
    const t = sn.tgt;
    if (!t) return;
    // 視線
    sn.losT -= dt;
    if (sn.losT <= 0) {
      sn.losT = LOS_DT;
      const d = this.pos.distanceTo(t.pos);
      sn.los = d < 160 && !g.world.losBlocked(this.eye(), t.center());
      if (sn.los) g.aiSaw(t, this);
    }
    if (sn.los) {
      sn.blind = 0;
      sn.kn = t.pos.clone();
      sn.knT = g.time;
    } else {
      sn.blind += dt;
      if (this.ace || g.aiSeenNear(t, this.pos, SHARE_R)) {
        sn.kn = t.pos.clone();
        sn.knT = g.time;
      }
    }
    // 整隊都看不到：搜索（敵對 AC 不會跟丟）
    if (!this.ace && g.time - sn.knT > LOST_T) {
      if (sn.tok) g.aiRelease(this);
      sn.st = 3;
      sn.srchT = 0;
      sn.meter = 0;
    }
  },
  // 眼睛的位置（視線的起點）：機體中心稍高
  eye() {
    const c = this.center();
    c.y += 0.6 * (this.scale || 1);
    return c;
  },
  // 待機、起疑、搜索
  senseIdle(dt, cands) {
    const g = this.game,
      sn = this.sn;
    // 感知（每 0.2 秒）
    sn.percT -= dt;
    let seen = null,
      tick = false;
    if (sn.percT <= 0) {
      sn.percT = 0.2;
      tick = true;
      const fx = -Math.sin(this.yaw),
        fz = -Math.cos(this.yaw);
      const R = sn.sight * (sn.st === 3 ? 1.15 : 1);
      let gain = 0;
      for (const c of cands) {
        const dx = c.pos.x - this.pos.x,
          dz = c.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > R) continue;
        if (d > SENSE_NEAR && sn.fov < 6.2 && (dx * fx + dz * fz) / (d || 1) < Math.cos(sn.fov / 2)) continue;
        if (g.world.losBlocked(this.eye(), c.center())) continue;
        let rate = 1 / (0.3 + (1.2 * d) / sn.sight);
        if (c.boost || c.qbT > 0) rate *= 1.5;
        if (c.firedT > 0) rate *= 2;
        if (sn.st !== 0) rate *= 1.8;
        if (d < SENSE_INSTANT) rate = 99;
        if (rate * 0.2 > gain) {
          gain = rate * 0.2;
          seen = c;
        }
      }
      if (seen) {
        sn.meter += gain;
        sn.heard = seen.pos.clone();
      }
    }
    if (tick && !seen) sn.meter = Math.max(0, sn.meter - SENSE_DECAY * 0.2);
    if (seen && sn.meter >= 1) {
      this.senseEngage(seen, true);
      this.move(dt, new THREE.Vector3(), false, false, false, null);
      return;
    }
    if (sn.st === 0 && sn.meter >= SUSPECT_AT) {
      sn.st = 1;
      sn.susT = 0;
    }
    const wish = new THREE.Vector3();
    let look = null;
    if (sn.st === 1) {
      // 起疑：轉向可疑的地方，遠的話慢慢走過去
      sn.susT += dt;
      if (sn.heard) {
        look = sn.heard;
        const to = sn.heard.clone().sub(this.pos).setY(0);
        if (to.length() > 10 && sn.meter < SUSPECT_AT * 2) wish.copy(to.normalize()).multiplyScalar(0.45);
      }
      if (sn.meter <= 0 && sn.susT > 4) {
        sn.st = 0;
        sn.home.copy(this.pos);
      }
    } else if (sn.st === 3) {
      // 搜索：前往最後已知位置，到了就在附近找
      sn.srchT += dt;
      const goal = sn.kn || sn.home;
      const to = goal.clone().sub(this.pos).setY(0);
      if (to.length() > 6) {
        wish.copy(to.normalize()).multiplyScalar(0.75);
        look = goal;
      } else this.senseWander(dt, wish, goal, 10);
      if (sn.srchT > SEARCH_T) {
        sn.st = 0;
        sn.home.copy(this.pos);
        sn.meter = 0;
      }
    } else this.senseWander(dt, wish, sn.home, 8);
    if (!look && wish.lengthSq() > 0.01) look = this.pos.clone().add(wish.clone().multiplyScalar(20));
    if (look) {
      const c = this.center();
      this.setAim(new THREE.Vector3(look.x, c.y, look.z));
    }
    const s = this.aiState;
    let hover = false;
    if (wish.lengthSq() > 0.01 && s.stuck > 0.6) {
      s.stuck = 0;
      sn.wGoal = null;
      s.jumpT = 0.5;
    }
    s.jumpT -= dt;
    if (s.jumpT > 0 && !this.flying) hover = 2;
    this.move(dt, wish, hover, false, false, null);
    if (FLYERS.has(this.ai)) this.flying = true;
  },
  // 待機時在 center 附近 r 公尺內走走停停
  senseWander(dt, wish, center, r) {
    const sn = this.sn;
    sn.wT -= dt;
    if (sn.wT <= 0) {
      sn.wT = rnd(2.5, 5.5);
      if (Math.random() < 0.45 || this.ai === 'turret' || this.ai === 'mt_gren' || this.ai === 'mortar')
        sn.wGoal = null;
      else {
        const a = Math.random() * Math.PI * 2,
          rr = rnd(0.3, 1) * r;
        sn.wGoal = new THREE.Vector3(center.x + Math.cos(a) * rr, 0, center.z + Math.sin(a) * rr);
      }
    }
    if (sn.wGoal) {
      const to = sn.wGoal.clone().sub(this.pos).setY(0);
      if (to.length() < 1.2) sn.wGoal = null;
      else wish.copy(to.normalize()).multiplyScalar(0.35);
    }
  },
  // 進入交戰；radio＝自己發現的（RADIO_DL 秒後通知附近友軍）
  senseEngage(t, radio) {
    const g = this.game,
      sn = this.sn;
    if (!sn) return;
    const was = sn.st;
    sn.st = 2;
    if (t) {
      sn.tgt = t;
      sn.kn = t.pos.clone();
    }
    sn.knT = g.time;
    sn.meter = 1;
    sn.losT = 0;
    sn.blind = 0;
    if (was !== 2) sn.spotT = g.time;
    if (radio && was !== 2) sn.radioT = RADIO_DL;
    if (this.guardOf) for (const o of g.enemies) if (o.guardOf === this.guardOf) o.guardAlert = true;
  },
  // 聽到聲音（玩家開火、QB）：src 是發出聲音的機體
  senseHear(pos, r, src) {
    const sn = this.sn;
    if (!sn || sn.st === 2 || this.dead) return;
    const d = Math.hypot(pos.x - this.pos.x, pos.z - this.pos.z);
    if (d > r) return;
    if (d < r * 0.35 && src) return this.senseEngage(src, true);
    if (sn.st !== 1) sn.susT = 0;
    sn.st = 1;
    sn.heard = pos.clone();
    sn.meter = Math.max(sn.meter, SUSPECT_AT + 0.15);
  },
  // 受到攻擊（takeDamage 開頭）：仇恨＋直接交戰
  senseHit(from, dmg) {
    const sn = this.sn;
    if (!sn || !from || from.team === this.team || from.dead === undefined) return;
    sn.th.set(from.id, (sn.th.get(from.id) || 0) + clamp((dmg / this.maxHp) * 100, 0.5, 60));
    if (sn.st !== 2) this.senseEngage(from, true);
  },
  // 自己看不到目標（地形、障礙物擋住）：往最後已知位置繞過去找射線，卡住就跳；回傳懸浮
  seekLos(wish, dt) {
    const sn = this.sn,
      s = this.aiState;
    const goal = sn.kn || (sn.tgt && sn.tgt.pos) || this.pos;
    const to = goal.clone().sub(this.pos).setY(0);
    const dist = to.length();
    if (dist > 0.01) to.normalize();
    const side = new THREE.Vector3(-to.z, 0, to.x).multiplyScalar(s.strafe);
    if (dist > 14) wish.copy(to).addScaledVector(side, 0.6);
    else wish.copy(side).addScaledVector(to, 0.3);
    if (wish.lengthSq() > 0.01) wish.normalize();
    if (s.stuck > 0.4) {
      s.strafe *= -1;
      s.stuck = 0;
      s.jumpT = 0.6;
    }
    s.jumpT -= dt;
    if (this.ai === 'drone' || this.ai === 'heli') this.flying = true;
    return s.jumpT > 0 && !this.flying ? 2 : false;
  },
  // 壓制中的衝鋒型（自爆、包圍、重踏…）：在外圈繞著目標，不衝過來
  supOrbit(wish, d, dir, perp) {
    const R = this.sn.ring;
    wish.copy(perp);
    if (d > R + 5) wish.addScaledVector(dir, 0.9);
    else if (d < R - 5) wish.addScaledVector(dir, -0.9);
    wish.normalize();
    if (this.ai === 'swarm') {
      this.flying = true;
      this.hoverH = 6;
    }
  },
  // HUD 與快照用的顯示狀態：1＋狀態（0～3）＋8×主攻；0＝沒有感知系統
  senseAw() {
    const sn = this.sn;
    if (!sn || !sn.on) return 0;
    return 1 + sn.st + (sn.tok ? 8 : 0) + (sn.vuln > 0 ? 16 : 0);
  },
});
