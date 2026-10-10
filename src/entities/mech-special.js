// ---------- MechEntity 擴充：特殊一般敵人 ----------
// 盾牌 MT（shield）、迫擊砲 MT（mortar）、布雷無人機（minelayer）、重踏機甲（stomper，衝擊波在 aiShock）、
// 修理無人機（repair）、護盾產生器（dome）、運輸機（dropship）、指揮官 MT（commander）。
// 行為與傷害只在房主／單機執行；客機靠快照的 sx（護盾比例、連線目標與種類、旗標、Boss 顯示狀態）與 gn（離場）顯示。
// 投射物、雷射、地雷、迫擊砲彈在 game/support.js；新 Boss 在 mech-boss.js（這裡的掛勾轉過去）。
import { SFX } from '../audio/audio.js';
import { clamp, rnd } from '../core/math.js';
import { MechEntity } from './mech-entity.js';

const DOME_R = 9; // 護盾半徑（以產生器腳底為中心的球）
const CMD_R = 30; // 指揮官強化範圍（擊破時混亂的範圍是 40 m）
const HEAL_R = 18; // 修理光束的最遠距離
const FOE_FX = new Set([
  'burrow',
  'junk',
  'crane',
  'forklift',
  'gategun',
  'gunboat',
  'marsh',
  'lurker',
  'whiteout',
  'laserpost',
  'specimen',
]); // 主題專屬敵人的顯示（mech-foe.js 的 foeFx）
const SHIELD_DOT = 0.35; // 盾牌涵蓋的正面角度（cos，約 ±70°）

// 連線光束的顏色（linkKind）：0 修理、1 電磁牽引、2 護盾發生器 → 指揮艦
const LINK_COL = [0x60ff9a, 0x60a8ff, 0x60e0ff];

const glowMat = (color, opacity = 0.9) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

Object.assign(MechEntity.prototype, {
  // 附加模型與狀態（建構時呼叫，房主與客機都會）
  specialInit() {
    this.sx = null; // 附加的網格與顯示狀態
    this.linkId = -1; // 連線光束的目標（修理、牽引、護盾發生器）
    this.linkKind = 0;
    this.domeFrac = 0;
    this.bossVis = 0; // Boss 的顯示狀態（mech-boss.js）
    this.sxFlags = 0; // 客機：快照給的旗標（1 強化、2 混亂、4 電磁封鎖）
    this.bossInit();
    const k = 1 / (this.mesh.scale.x || 1); // 機體根節點有縮放：附加物以世界尺寸換算
    const h = this.model.height;
    if (this.ai === 'shield') {
      // 正面大盾：掛在機體根節點前方（不跟手臂動作，判定也用這個位置）
      const grp = new THREE.Group();
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(2.0, 2.6, 0.18),
        new THREE.MeshStandardMaterial({ color: 0x5a5f66, roughness: 0.5, metalness: 0.65 }),
      );
      grp.add(plate);
      const lit = new THREE.MeshStandardMaterial({
        color: 0xffb020,
        emissive: 0xff9010,
        emissiveIntensity: 0.9,
      });
      for (const y of [-1.25, 1.25]) {
        const rim = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 0.24), lit);
        rim.position.y = y;
        grp.add(rim);
      }
      const slit = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.05), glowMat(0xff4020));
      slit.position.set(0, 0.7, -0.12);
      grp.add(slit);
      grp.position.set(0.15 * this.scale * k, h * 0.5 * k, -1.25 * this.scale * k);
      grp.scale.setScalar(this.scale * k);
      this.mesh.add(grp);
      this.yawRate = 1.8; // 轉身慢：繞背才有機會
      this.sx = { plate: grp };
    } else if (this.ai === 'commander' || this.ai === 'dome') {
      // 指揮官：頭上的天線與旋轉標記；護盾產生器：背上的發光球
      const grp = new THREE.Group();
      grp.position.set(0, (h + 0.3) * k, 0.2 * k);
      grp.scale.setScalar(this.scale * k);
      this.mesh.add(grp);
      const col = this.ai === 'commander' ? 0xffc040 : 0x60e0ff;
      if (this.ai === 'commander') {
        const ant = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 1.6, 6),
          new THREE.MeshStandardMaterial({ color: 0x30343c, metalness: 0.6, roughness: 0.4 }),
        );
        ant.position.set(0.45, 0.5, 0.3);
        grp.add(ant);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), glowMat(col));
        tip.position.set(0.45, 1.32, 0.3);
        grp.add(tip);
      }
      const mark = new THREE.Mesh(
        this.ai === 'commander'
          ? new THREE.TorusGeometry(0.55, 0.06, 6, 24)
          : new THREE.SphereGeometry(0.45, 12, 8),
        glowMat(col, 0.8),
      );
      mark.position.y = this.ai === 'commander' ? 1.4 : -0.1;
      if (this.ai === 'commander') mark.rotation.x = Math.PI / 2;
      grp.add(mark);
      this.sx = { top: grp, mark };
    }
  },
  // 這台的友軍名單（敵人＝enemies、友軍＝allies）
  friendsOf() {
    const g = this.game;
    return this.team === 'enemy' ? g.enemies : g.allies;
  },
  guardUp() {
    return this.ai === 'shield' && !this.dead && this.staggerT <= 0 && !(this.guardBreakT > 0);
  },
  // 護盾：護盾產生器（dome）與護盾指揮艦（domeR、domeInf：發生器還在就不會被打破）
  domeUp() {
    return (this.ai === 'dome' || this.domeR > 0) && !this.dead && this.domeFrac > 0;
  },
  domeRadius() {
    return this.domeR || DOME_R;
  },
  insideDome(p) {
    return p.distanceTo(this.pos) < this.domeRadius();
  },
  // 護盾吸收傷害（房主）
  domeAbsorb(dmg, at) {
    const g = this.game;
    this.domeHitT = 0.25;
    if (this.domeInf) {
      if (at) g.fx.spark(at, 0x80e0ff);
      return;
    }
    this.domeHp -= dmg;
    this.domeHitT = 0.25;
    if (at) g.fx.spark(at, 0x80e0ff);
    if (this.domeHp <= 0) {
      this.domeHp = 0;
      this.domeCd = 12;
      this.domeFrac = 0;
      this.acs = this.acsMax;
      this.staggerT = 2.2;
      g.fx.ring(this.center(), DOME_R, 0x80e0ff);
      g.fx.flash(this.center(), 4, 0xbfefff, 0.25);
      SFX.play('overload', 0.9, 1.2, 0.05, 0.05, this.center());
      g.msgAll('護盾破壞 — 產生器過載', 0x80e0ff);
      g.netEv({ t: 'stag', i: this.id });
    } else this.domeFrac = this.domeHp / this.domeMax;
  },
  // 受傷前的修正：回傳 [傷害, 衝擊]，或 null 表示完全擋下
  specialDefense(dmg, impact, from, at, melee, wid) {
    const g = this.game;
    [dmg, impact] = this.foeDefense(dmg, impact, from, at, melee); // 主題專屬敵人的外殼、貨櫃盾（mech-foe.js）
    const bd = this.bossDefense(dmg, impact, from, at, wid, melee);
    if (!bd) return null;
    [dmg, impact] = bd;
    const src = from && from.pos && from !== this ? from.pos : at;
    // 在友方護盾裡：攻擊者在護盾外 → 護盾吸收
    if (src && g.domeCovering) {
      const dome = g.domeCovering(this);
      if (dome && !dome.insideDome(src)) {
        dome.domeAbsorb(dmg, at);
        return null;
      }
    }
    // 盾牌看命中點在哪一側（爆炸在背後就擋不到）；命中點太靠近中心（雷射）時改看攻擊者
    let hp = at;
    if (!hp || hp.clone().sub(this.center()).setY(0).length() < 0.6) hp = src;
    if (this.guardUp() && hp) {
      const fy = from && from.center && from !== this ? from.center().y : hp.y;
      const to = hp.clone().sub(this.pos);
      to.y = 0;
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      // 從正面而且不是從高處（4 m 以上）往下打
      if (to.lengthSq() > 0.01 && to.normalize().dot(fwd) > SHIELD_DOT && fy - this.center().y < 4) {
        const p = at || this.center();
        if (melee) {
          // 近戰破盾：全額傷害、衝擊加重，盾放下 2.5 秒
          this.guardBreakT = 2.5;
          g.fx.flash(p, 1.6, 0xffb020, 0.18);
          g.fx.streaks(p, 12, 0xffd080, 16, 0.35, 20);
          SFX.play('shield', 1, 0.7, 0.05, 0.03, p);
          g.popDamage(p, 'GUARD BREAK', false, true, false, 0);
          return [dmg, impact * 1.6];
        }
        g.fx.spark(p, 0xffd080);
        SFX.play('shield', 0.5, 1.3, 0.1, 0.06, p);
        return [dmg * 0.12, impact * 0.4];
      }
    }
    return [dmg, impact];
  },
  specialDie(from) {
    const g = this.game;
    if (this.ai === 'commander' && !this.gone) {
      // 指揮官擊破：附近的敵機混亂 4 秒
      let n = 0;
      for (const f of this.friendsOf()) {
        if (f === this || f.dead || f.isBoss || f.ai === 'part' || f.pos.distanceTo(this.pos) > 40) continue;
        f.confuseT = 4;
        f.buffT = 0;
        n++;
      }
      if (n) g.msgAll(`指揮官擊破 — ${n} 台敵機陷入混亂`, 0xffc040);
    }
    if (this.ai === 'dropship' && !this.gone && !this.aiState.dropped && from)
      g.msgAll('運輸機擊落 — 投放阻止', 0x7ee081);
    this.bossDie(from);
    this.domeFrac = 0;
    this.linkId = -1;
    this.specialFx(0);
  },
  specialCleanup() {
    const g = this.game;
    if (!this.sx) return;
    for (const k of ['dome', 'beam', 'marker']) {
      const m = this.sx[k];
      if (m) {
        g.scene.remove(m);
        this.sx[k] = null;
      }
    }
    this.bossCleanup();
  },
  // 離場（運輸機投放完飛走）：不算擊破、不給賞金
  depart() {
    this.gone = true;
    this.dead = true;
    this.mesh.visible = false;
    this.specialCleanup();
  },
  // 顯示：護盾、修理光束、強化／混亂標記（房主與客機每格呼叫）
  specialFx(dt) {
    const g = this.game;
    if (FOE_FX.has(this.ai) || (this.opts && this.opts.vehKey === 'jammer')) this.foeFx(); // 主題專屬敵人的顯示（mech-foe.js）
    const host = !this.remote;
    const sx = this.sx || (this.sx = {});
    if (this.guardBreakT > 0) this.guardBreakT -= dt;
    if (sx.plate) sx.plate.visible = !(this.guardBreakT > 0) && this.staggerT <= 0;
    if (sx.mark) {
      sx.mark.rotation.z += dt * 2;
      sx.mark.material.opacity = 0.5 + 0.35 * Math.sin(this.t * 4);
    }
    // 護盾
    const df = this.dead ? 0 : this.domeFrac;
    if (df > 0) {
      if (!sx.dome) {
        const grp = new THREE.Group();
        const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18), glowMat(0x50b8ff, 0.16));
        shell.material.side = THREE.DoubleSide;
        const wire = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.005, 2),
          new THREE.MeshBasicMaterial({
            color: 0x8fe0ff,
            wireframe: true,
            transparent: true,
            opacity: 0.22,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        grp.add(shell, wire);
        grp.renderOrder = 4;
        g.scene.add(grp);
        sx.dome = grp;
        sx.domeShell = shell;
        sx.domeWire = wire;
      }
      if (!host && sx.lastDf !== undefined && df < sx.lastDf - 0.001) this.domeHitT = 0.25;
      sx.dome.visible = true;
      sx.dome.position.copy(this.pos);
      sx.dome.scale.setScalar(this.domeRadius());
      sx.dome.rotation.y += dt * 0.15;
      const hit = this.domeHitT > 0 ? this.domeHitT * 2 : 0;
      sx.domeShell.material.opacity = 0.08 + 0.1 * df + hit * 0.25;
      sx.domeWire.material.opacity = 0.12 + 0.18 * df + hit * 0.4;
    } else if (sx.dome) sx.dome.visible = false;
    sx.lastDf = df;
    if (this.domeHitT > 0) this.domeHitT -= dt;
    // 連線光束（修理、電磁牽引、護盾發生器）
    const tgt = !this.dead && this.linkId >= 0 ? g.entById(this.linkId) : null;
    if (tgt && !tgt.dead) {
      if (!sx.beam) {
        sx.beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true),
          glowMat(0x60ff9a, 0.7),
        );
        g.scene.add(sx.beam);
      }
      sx.beam.material.color.set(LINK_COL[this.linkKind] || LINK_COL[0]);
      const a =
          this.linkKind === 2 ? this.pos.clone().setY(this.pos.y + this.model.height * 0.9) : this.center(),
        b = tgt.center();
      // 客機：被電磁牽引的是自己的機體時，移動預測也要算牽引
      if (this.linkKind === 1 && this.remote) {
        tgt.pullT = 0.2;
        tgt.pullSrc = this;
      }
      sx.beam.visible = true;
      sx.beam.position.copy(a).lerp(b, 0.5);
      sx.beam.scale.set(1 + 0.4 * Math.sin(this.t * 18), a.distanceTo(b), 1 + 0.4 * Math.sin(this.t * 18));
      sx.beam.lookAt(b);
      sx.beam.rotateX(Math.PI / 2);
      if (Math.random() < dt * 8) g.fx.streaks(b, 1, LINK_COL[this.linkKind] || 0x7dffb0, 3, 0.4, -4);
    } else if (sx.beam) sx.beam.visible = false;
    // 強化（橘色菱形）／混亂（黃色，晃動）標記
    const fl = (host ? (this.buffT > 0 ? 1 : 0) | (this.confuseT > 0 ? 2 : 0) : this.sxFlags) & 3;
    if (fl && !this.dead) {
      if (!sx.marker) {
        sx.marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.28, 0), glowMat(0xffa030, 0.9));
        g.scene.add(sx.marker);
      }
      const m = sx.marker;
      m.visible = true;
      m.material.color.set(fl & 2 ? 0xfff040 : 0xffa030);
      m.position.copy(this.pos);
      m.position.y += this.model.height + 0.9 + Math.sin(this.t * 3) * 0.1;
      if (fl & 2) m.position.x += Math.sin(this.t * 9) * 0.3;
      m.rotation.y += dt * 3;
    } else if (sx.marker) sx.marker.visible = false;
    // 電磁封鎖中：身上的電弧
    if (this.empLockT > 0 && !this.dead && Math.random() < dt * 12)
      g.fx.spark(this.center().add(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1))), 0x80c8ff);
    this.bossFx(dt);
  },
  // 移動：特殊敵人回傳 { hover, qb, ab, done }（done＝已經自己呼叫 move），其他回傳 null
  aiSpecialMove(dt, d, dir, perp, wish, pl) {
    const g = this.game,
      s = this.aiState;
    const r = { hover: false, qb: false, ab: false, done: false };
    switch (this.ai) {
      case 'shield':
        // 舉盾慢慢推進到中距離
        if (d > s.want + 3) wish.copy(dir).multiplyScalar(0.8);
        else if (d < s.want - 4) wish.copy(dir).multiplyScalar(-0.5);
        else wish.copy(perp).multiplyScalar(0.25);
        this.stuckJump(dt, r);
        return r;
      case 'stomper':
        // 衝向目標，近身踏地（aiShock）
        if (d > 5) wish.copy(dir);
        else wish.copy(perp).multiplyScalar(0.4);
        if (d > 18 && Math.random() < dt * 0.8) r.qb = true;
        this.stuckJump(dt, r);
        return r;
      case 'mortar':
        // 保持遠距離，多半站著不動
        if (d < 25) wish.copy(dir).multiplyScalar(-1);
        else if (d > 75) wish.copy(dir);
        else if (s.stuck > 0.4) wish.copy(perp);
        return r;
      case 'commander': {
        // 待在友軍後方（相對玩家）；沒有友軍時保持距離橫移
        const c = new THREE.Vector3();
        let n = 0;
        for (const f of this.friendsOf()) {
          if (f === this || f.dead || f.flying || f.pos.distanceTo(this.pos) > 50) continue;
          c.add(f.pos);
          n++;
        }
        if (n) {
          c.divideScalar(n).addScaledVector(dir, -8);
          const to = c.sub(this.pos).setY(0);
          if (to.length() > 3) wish.copy(to.normalize());
          else wish.copy(perp).multiplyScalar(0.3);
        } else if (d > s.want + 6) wish.copy(dir);
        else if (d < s.want - 8) wish.copy(dir).negate().add(perp.clone().multiplyScalar(0.5));
        else wish.copy(perp).multiplyScalar(0.5);
        if (d < 15) wish.addScaledVector(dir, -1);
        if (wish.lengthSq() > 1) wish.normalize();
        this.stuckJump(dt, r);
        for (const f of this.friendsOf())
          if (f !== this && !f.dead && !f.isBoss && f.ai !== 'part' && f.pos.distanceTo(this.pos) < CMD_R)
            f.buffT = 0.3;
        return r;
      }
      case 'minelayer':
        // 在目標周圍盤旋
        wish.copy(perp).multiplyScalar(0.9);
        if (d > s.want + 4) wish.add(dir.clone().multiplyScalar(0.8));
        else if (d < s.want - 6) wish.sub(dir.clone().multiplyScalar(0.8));
        wish.normalize();
        this.flying = true;
        return r;
      case 'repair':
        this.repairAI(dt, d, dir, wish, pl);
        return r;
      case 'dome':
        this.domeAI(dt, d, dir, wish);
        return r;
      case 'dropship':
        this.dropshipAI(dt, dir, wish, pl);
        if (this.gone) r.done = true;
        return r;
      case 'drill':
      case 'junk':
      case 'burrow':
      case 'crane':
      case 'forklift':
      case 'gategun':
      case 'gunboat':
      case 'sprayer':
      case 'marsh':
      case 'lurker':
      case 'skater':
      case 'whiteout':
      case 'blob':
      case 'laserpost':
      case 'specimen':
      case 'crawler':
      case 'underturret':
      case 'spire':
      case 'testrig':
      case 'hopper':
      case 'rammer':
      case 'flak':
      case 'undertow':
        return this.foeMove(dt, d, dir, perp, wish, pl); // 主題專屬敵人（mech-foe.js）
    }
    return this.bossMove(dt, d, dir, perp, wish, pl);
  },
  // 卡住時跳起爬升（同一般 MT）
  stuckJump(dt, r) {
    const s = this.aiState;
    if (s.stuck > 0.4) {
      s.stuck = 0;
      s.jumpT = 0.5;
      s.climb = true;
    }
    s.jumpT -= dt;
    if (s.jumpT > 0) r.hover = s.climb ? 2 : true;
  },
  // 開火：自己處理時回傳 true（一般武器迴圈略過）
  aiSpecialFire(dt, d, aimPos, pl) {
    const g = this.game,
      s = this.aiState;
    switch (this.ai) {
      case 'mortar': {
        s.mortT = (s.mortT === undefined ? rnd(1.5, 3) : s.mortT) - dt;
        if (s.mortT <= 0 && d > 12 && d < 85 && this.canAct()) {
          s.mortT = rnd(3.5, 5);
          // 落點：目標腳下＋一點預判（最多 6 m）＋亂數
          const lead = pl.vel.clone().setY(0).multiplyScalar(0.5);
          if (lead.length() > 6) lead.setLength(6);
          const tp = pl.pos
            .clone()
            .add(lead)
            .add(new THREE.Vector3(rnd(-1.5, 1.5), 0, rnd(-1.5, 1.5)));
          g.mortarShot(this, tp, { dmg: 560 * this.dmgMul, im: 760 * this.dmgMul, R: 5.5 });
        }
        const w = this.weapons.rarm;
        if (w.def.type === 'bullet' && d < Math.min(30, w.def.range) && Math.random() < dt * 4)
          this.fire('rarm', aimPos, pl);
        return true;
      }
      case 'minelayer': {
        s.mineT = (s.mineT === undefined ? rnd(1, 2) : s.mineT) - dt;
        if (s.mineT <= 0 && d < 32 && this.canAct()) {
          s.mineT = rnd(2.2, 3.5);
          if (g.minesOf(this) < 6) {
            // 撒在目標前進方向上
            const lead = pl.vel.clone().setY(0).multiplyScalar(0.8);
            if (lead.length() > 8) lead.setLength(8);
            const p = pl.pos
              .clone()
              .add(lead)
              .add(new THREE.Vector3(rnd(-3, 3), 0, rnd(-3, 3)));
            g.layMine(this, p, { dmg: 460 * this.dmgMul, im: 700 * this.dmgMul, R: 4.5 });
          }
        }
        return true;
      }
      case 'repair':
      case 'dome':
      case 'dropship':
        return true;
      case 'crane':
        return this.foeFire(dt, d, aimPos, pl); // 起重機砲台（mech-foe.js）
      case 'flak':
        return this.foeFlakFire(dt, d, aimPos, pl);
      case 'rammer':
        return true;
      case 'blob':
      case 'laserpost':
      case 'testrig':
        return true; // 實驗體只會咬、雷射網只有柵欄
    }
    return this.bossFire(dt, d, aimPos, pl);
  },
  // 修理無人機：找 AP 比例最低的友軍，躲在它背後（相對玩家）持續回復
  repairAI(dt, d, dir, wish, pl) {
    const s = this.aiState;
    this.flying = true;
    s.healPick = (s.healPick || 0) - dt;
    let tgt = s.healTgt && !s.healTgt.dead ? s.healTgt : null;
    if (s.healPick <= 0 || !tgt) {
      s.healPick = 1;
      let best = null,
        br = 2;
      for (const f of this.friendsOf()) {
        if (f === this || f.dead || f.noLock || f.ai === 'repair' || f.ai === 'dropship' || f.ai === 'holo')
          continue;
        if (f.pos.distanceTo(this.pos) > 50) continue;
        const ratio = f.hp / f.maxHp + (f.hp < f.maxHp ? 0 : 1); // 有受傷的優先
        if (ratio < br) {
          br = ratio;
          best = f;
        }
      }
      tgt = s.healTgt = best;
    }
    this.linkId = -1;
    this.linkKind = 0;
    if (tgt) {
      const away = tgt.pos.clone().sub(pl.pos).setY(0);
      if (away.lengthSq() < 0.01) away.set(1, 0, 0);
      const goal = tgt.pos.clone().add(away.normalize().multiplyScalar(5));
      const to = goal.sub(this.pos).setY(0);
      if (to.length() > 2) wish.copy(to.normalize());
      this.hoverH = clamp((tgt.flying ? tgt.hoverH : 0) + 4.5, 4.5, 14);
      const dist = tgt.center().distanceTo(this.center());
      if (dist < HEAL_R && tgt.hp < tgt.maxHp && this.canAct()) {
        this.linkId = tgt.id;
        tgt.hp = Math.min(tgt.maxHp, tgt.hp + tgt.maxHp * (tgt.isBoss ? 0.006 : 0.035) * dt);
      }
    }
    if (d < 12) wish.addScaledVector(dir, -1.2); // 玩家靠近就躲開
    if (wish.lengthSq() > 1) wish.normalize();
  },
  // 護盾產生器：往友軍聚集處移動，和玩家保持距離；護盾被打破後 12 秒重新展開
  domeAI(dt, d, dir, wish) {
    const g = this.game;
    if (this.domeMax === undefined) {
      this.domeMax = this.maxHp * 1.5;
      this.domeHp = this.domeMax;
      this.domeFrac = 1;
    }
    if (this.domeHp <= 0) {
      this.domeCd -= dt;
      if (this.domeCd <= 0) {
        this.domeHp = this.domeMax;
        this.domeFrac = 1;
        g.fx.ring(this.center(), DOME_R, 0x80e0ff);
        SFX.play('charge', 0.8, 1.2, 0.05, 0.05, this.center());
      }
    }
    const c = new THREE.Vector3();
    let n = 0;
    for (const f of this.friendsOf()) {
      if (f === this || f.dead || f.flying || f.pos.distanceTo(this.pos) > 35) continue;
      c.add(f.pos);
      n++;
    }
    if (n) {
      const to = c.divideScalar(n).sub(this.pos).setY(0);
      if (to.length() > 3) wish.copy(to.normalize()).multiplyScalar(0.8);
    }
    if (d < 20) wish.addScaledVector(dir, -1);
    if (wish.lengthSq() > 1) wish.normalize();
  },
  // 運輸機：飛到玩家附近 → 降低高度投放 → 飛走離場
  dropshipAI(dt, dir, wish, pl) {
    const g = this.game,
      s = this.aiState;
    this.flying = true;
    if (!s.ds) s.ds = 'in';
    if (s.ds === 'in') {
      // 目標點：玩家朝運輸機方向 18 m
      const goal = pl.pos.clone().addScaledVector(dir, -18);
      const to = goal.sub(this.pos).setY(0);
      this.hoverH = 14;
      if (to.length() > 4) wish.copy(to.normalize());
      else {
        s.ds = 'drop';
        s.dsT = 2.2;
        g.alertAll('運輸機投放中 — 現在擊落！');
      }
    } else if (s.ds === 'drop') {
      this.hoverH = 7;
      s.dsT -= dt;
      if (s.dsT <= 0 && this.canAct()) {
        s.ds = 'out';
        s.dsT = 7;
        s.dropped = true;
        s.outDir = dir.clone().negate();
        g.dropCargo(this);
      }
    } else {
      wish.copy(s.outDir);
      this.hoverH = Math.min(40, this.hoverH + dt * 5);
      s.dsT -= dt;
      if (s.dsT <= 0) this.depart();
    }
  },
});
