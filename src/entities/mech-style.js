// MechEntity 擴充：遠程射擊改版第 6 期「風格評價」（docs/ranged-design.md、data/style-meter.js）。
// 玩家操作的機體的 Style 量表：syAdd 加分（同一招重複越多加得越少）、syHit 射擊打中、syEv 近戰的事件（沿用 tutE）、
// syHurt 被打中掉分、syTick 隨時間掉分與升級時的 ACS 回復。只在房主／單機計算，客機由 fb 事件 'sty' 顯示。
import { SY, SY_EV, SY_HIT_MAX, syRank } from '../data/style-meter.js';
import { MechEntity } from './mech-entity.js';
import { tierRow } from '../data/boss-tier.js';

Object.assign(MechEntity.prototype, {
  syOn() {
    const g = this.game;
    return this.pilotEnt() && !g.pvp && !g.cine && !(g.net && g.net.role === 'client');
  },
  syState() {
    if (!this.sy) this.sy = { pts: 0, idle: 0, hist: [], labels: [], rank: -1, cls: '', sendT: 0 };
    return this.sy;
  },
  // key＝招式（重複判斷用），base＝基本分，label＝顯示的文字（空字串不顯示）
  syAdd(key, base, label) {
    if (!this.syOn()) return;
    const s = this.syState();
    let n = 0;
    for (const k of s.hist) if (k === key) n++;
    // Boss 改版的 L（刁鑽度 7～8）：Boss 戰中重複同一招的加分再少一半
    const bt = n > 0 ? this.game.tierFightTier() : 0;
    const gain = base * Math.pow(SY.REPEAT, n) * (bt ? tierRow(bt).lRepeat : 1);
    s.hist.push(key);
    if (s.hist.length > SY.HIST) s.hist.shift();
    s.pts = Math.min(SY.MAX, s.pts + gain);
    s.idle = SY.IDLE;
    if (label && gain >= base * 0.5) {
      s.labels.unshift({ txt: label, t: 1.6 });
      if (s.labels.length > 4) s.labels.length = 4;
    }
    this.syRankCheck();
  },
  syEvent(k, label) {
    const e = SY_EV[k];
    if (e) this.syAdd(k, e[0], label !== undefined ? label : e[1]);
  },
  // 射擊打中（takeDamage）：依傷害佔目標 AP 的比例；換了武器種類另外加分
  syHit(t, real, wid) {
    if (!this.syOn() || !t || t.team === this.team || !t.maxHp) return;
    const s = this.syState();
    const cls = 'w:' + (wid || '');
    if (s.cls && s.cls !== cls && wid) this.syEvent('swap');
    if (wid) s.cls = cls;
    const v = Math.max(1, Math.min(SY_HIT_MAX, (real / t.maxHp) * 150));
    this.syAdd(cls, SY_EV.hit[0] + v, '');
  },
  // 近戰訓練的事件（tutE）也拿來算分：近戰打中、打出失衡、完美 QB、彈刀、連接、處決…
  syEv(k, o) {
    if (!this.syOn()) return;
    if (k === 'hit') {
      const s = this.syState();
      const id = (o && o.st && o.st.id) || '';
      if (s.cls && s.cls !== 'melee') this.syEvent('swap');
      s.cls = 'melee';
      this.syAdd('m:' + id, SY_EV.melee[0], (o && o.st && o.st.name) || SY_EV.melee[1]);
      if (o && o.air) this.syEvent('air');
      if (o && o.lunge) this.syEvent('lunge');
    } else if (
      k === 'stag' ||
      k === 'pqb' ||
      k === 'parry' ||
      k === 'link' ||
      k === 'resume' ||
      k === 'jc' ||
      k === 'exec'
    )
      this.syEvent(k);
  },
  // 被打中：掉一截
  syHurt(real) {
    if (!this.sy || real < this.maxHp * 0.01) return;
    const s = this.sy;
    s.pts = Math.max(0, s.pts * SY.HURT_K - SY.HURT_PTS);
    // Boss 改版的 L：Boss 戰中被打中掉 1～2 級（刁鑽度 5 起掉 2 級）
    const bt = this.game.tierFightTier();
    if (bt && s.rank >= 0) {
      const to = s.rank - tierRow(bt).lDrop;
      s.pts = Math.min(s.pts, to >= 0 ? SY.RANKS[to][0] + 1 : 0);
    }
    this.syRankCheck();
  },
  syTick(dt) {
    const s = this.sy;
    if (!s) return;
    if (s.idle > 0) s.idle -= dt;
    else if (s.pts > 0) {
      s.pts = Math.max(0, s.pts - (SY.DECAY + SY.DECAY_RANK * Math.max(0, s.rank)) * dt);
      this.syRankCheck();
    }
    for (const l of s.labels) l.t -= dt;
    while (s.labels.length && s.labels[s.labels.length - 1].t <= 0) s.labels.pop();
    // 客機：每 0.25 秒送一次給本人
    const g = this.game;
    if (!this.isPlayer && this.slot !== undefined && g.net && g.net.role === 'host' && (s.sendT -= dt) <= 0) {
      s.sendT = 0.25;
      g.netEv({
        t: 'fb',
        s: this.slot,
        k: 'sty',
        v: Math.round(s.pts),
        a: s.labels.length ? s.labels[0].txt : '',
      });
    }
  },
  // 等級改變：升級時 ACS 回復
  syRankCheck() {
    const s = this.sy;
    const r = syRank(s.pts);
    if (r > s.rank && r >= 0) this.acs = Math.max(0, this.acs - this.acsMax * SY.ACS_UP * r);
    s.rank = r;
  },
  // 主線：擊破獎金的倍率（擊破時的等級）
  syCoamK() {
    return SY.COAM[(this.sy ? this.sy.rank : -1) + 1] || 1;
  },
});
