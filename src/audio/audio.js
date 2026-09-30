// ============================================================
//  AUDIO — 簡易合成音效
// ============================================================
import { clamp, lerp } from '../core/math.js';
import { game } from '../main.js';
import { SFX_DATA } from './sfx-data.js';

export const SFX = {
  ctx: null,
  master: null,
  on: true,
  buf: {},
  ready: false,
  lastT: {},
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.load();
    } catch (e) {
      this.on = false;
    }
  },
  load() {
    const c = this.ctx;
    let n = 0;
    const keys = Object.keys(SFX_DATA);
    for (const k of keys) {
      const bin = atob(SFX_DATA[k]);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      c.decodeAudioData(
        arr.buffer.slice(0),
        (b) => {
          this.buf[k] = b;
          if (++n === keys.length) this.ready = true;
        },
        () => {
          if (++n === keys.length) this.ready = true;
        },
      );
    }
  },
  // listener follows the player; camera yaw is fixed so world axes == screen axes (x right, -z up-screen)
  setListener(pos) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    this.lpos = pos;
    if (L.positionX) {
      L.positionX.value = pos.x;
      L.positionY.value = pos.y;
      L.positionZ.value = pos.z;
      L.forwardX.value = 0;
      L.forwardY.value = -0.6;
      L.forwardZ.value = -1;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(pos.x, pos.y, pos.z);
      L.setOrientation(0, -0.6, -1, 0, 1, 0);
    }
  },
  play(k, vol = 1, rate = 1, detune = 0.06, minGap = 0.03, pos = null) {
    if (pos && window.game && game.net && game.net.role === 'host' && !game._noMirror)
      game.netEv({
        t: 'sfx',
        k,
        v: vol,
        r: rate,
        p: [+pos.x.toFixed(1), +pos.y.toFixed(1), +pos.z.toFixed(1)],
      });
    if (!this.ctx || !this.on) return;
    const b = this.buf[k];
    if (!b) return;
    const t = this.ctx.currentTime;
    const gk = k + (pos ? '@' : '');
    if (this.lastT[gk] && t - this.lastT[gk] < minGap) return;
    this.lastT[gk] = t;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate * (1 + (Math.random() * 2 - 1) * detune);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    if (pos) {
      // 3D: distance falloff + stereo direction + far-away low-pass
      const d = this.lpos ? Math.hypot(pos.x - this.lpos.x, pos.y - this.lpos.y, pos.z - this.lpos.z) : 0;
      if (d > 140) return;
      const pn = this.ctx.createPanner();
      pn.panningModel = 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 7;
      pn.maxDistance = 160;
      pn.rolloffFactor = 1.3;
      pn.coneInnerAngle = 360;
      if (pn.positionX) {
        pn.positionX.value = pos.x;
        pn.positionY.value = pos.y;
        pn.positionZ.value = pos.z;
      } else pn.setPosition(pos.x, pos.y, pos.z);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(16000 - d * 110, 1800, 16000);
      g.connect(pn);
      pn.connect(lp);
      lp.connect(this.master);
    } else g.connect(this.master);
    s.start();
  },
  pickPlay(list, vol, rate, pos) {
    this.play(list[Math.floor(Math.random() * list.length)], vol, rate, 0.06, 0.03, pos);
  },
  // legacy synth (still used for a few accents)
  noise(dur, freq, vol, type = 'lowpass') {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const b = c.createBuffer(1, c.sampleRate * dur, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = b;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = vol * 0.5;
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start();
  },
  tone(f0, f1, dur, vol, type = 'square') {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol * 0.4, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(c.currentTime + dur);
  },
  // ---- 循環音（推進器／引擎）：玩家專用，gain 平滑 ----
  loops: {},
  loopSet(name, key, target, rate = 1) {
    if (!this.ctx || !this.on) return;
    let L = this.loops[name];
    const b = this.buf[key];
    if (!b) return;
    if (!L) {
      if (target <= 0.01) return;
      const s = this.ctx.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.playbackRate.value = rate;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      s.connect(g);
      g.connect(this.master);
      s.start();
      L = this.loops[name] = { s, g, v: 0 };
    }
    L.v = lerp(L.v, target, 0.15);
    L.g.gain.setTargetAtTime(L.v, this.ctx.currentTime, 0.05);
    L.s.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.1);
    if (target <= 0.01 && L.v < 0.02) {
      try {
        L.s.stop();
      } catch (e) {}
      delete this.loops[name];
    }
  },
  stopLoops() {
    for (const k in this.loops) {
      try {
        this.loops[k].s.stop();
      } catch (e) {}
    }
    this.loops = {};
  },
  shot(kind, id, pos) {
    const P = pos || null;
    switch (kind) {
      case 'bullet':
        if (id === 'w_mg' || id === 'bw_gat') this.play('mg', 0.6, 1.05, 0.08, 0.02, P);
        else if (id === 'w_hg') this.play('pistol', 0.75, 1.0, 0.06, 0.03, P);
        else this.pickPlay(['rifle', 'rifle2'], 0.75, 1.0, P);
        break;
      case 'shotgun':
        this.play('shotgun', 0.95, 0.95, 0.06, 0.03, P);
        break;
      case 'shell':
        this.play('heavy', 1.0, 0.85, 0.06, 0.03, P);
        this.play('boostUp', 0.35, 1.4, 0.06, 0.03, P);
        break;
      case 'grenade':
        this.play('heavy', 0.9, 0.7, 0.06, 0.03, P);
        break;
      case 'laser':
        if (id === 'w_lc' || id === 'bw_lc') this.pickPlay(['laserBig', 'laserBig2'], 0.75, 1.0, P);
        else this.pickPlay(['laser', 'laser2'], 0.65, 1.0, P);
        break;
      case 'laserCharged':
        this.play('laserCharged', 0.95, 1.0, 0.04, 0.03, P);
        this.play('explode3', 0.35, 1.5, 0.06, 0.03, P);
        break;
      case 'missile':
        this.play('missile', 0.6, 1.2, 0.06, 0.03, P);
        this.play('boostUp', 0.5, 1.2, 0.06, 0.03, P);
        break;
      case 'blade':
        this.play('boostUp', 0.6, 1.5, 0.1, 0.03, P);
        this.play('laser2', 0.3, 0.6, 0.06, 0.03, P);
        break;
    }
  },
  charge(pos) {
    this.play('charge', 0.7, 1.0, 0.03, 0.2, pos);
  },
  explode(big, pos) {
    if (big) {
      this.play('explodeBig', 1.0, 0.95, 0.05, 0.03, pos);
      this.play('distant', 0.6, 1.0, 0.05, 0.03, pos);
    } else this.pickPlay(['explode', 'explode2', 'explode3'], 0.8, 1.05, pos);
  },
  hit(pos) {
    this.pickPlay(['hit', 'hit2', 'hit3'], 0.6, 1.0, pos);
  },
  meleeHit(big, pos) {
    this.pickPlay(['hit', 'hit2'], 0.9, 0.8, pos);
    this.play(big ? 'explode2' : 'explode3', big ? 0.9 : 0.45, big ? 0.9 : 1.4, 0.06, 0.03, pos);
  },
  qb(pos) {
    this.play('boostUp', 0.8, 1.15, 0.08, 0.03, pos);
  },
  jump(pos) {
    this.play('boostUp', 0.55, 0.9, 0.08, 0.2, pos);
  },
  land(pos) {
    this.play('boostDown', 0.5, 1.1, 0.08, 0.2, pos);
  },
  ab(pos) {
    this.play('boostUp', 0.9, 0.75, 0.05, 0.3, pos);
  },
  stagger(pos) {
    this.play('overload', 0.9, 1.0, 0.04, 0.03, pos);
    this.play('stagger', 0.5, 0.9, 0.06, 0.03, pos);
  },
  ui() {
    this.play('ui', 0.6, 1.0, 0.02);
  },
  kit() {
    this.play('ui2', 0.8, 1.0);
  },
  alert() {
    this.play('ui2', 0.6, 0.7);
  },
  bomber(pos) {
    this.play('engineHi', 0.9, 0.6, 0, 0, pos);
    this.play('door', 0.6, 0.8, 0.06, 0.03, pos);
  },
  ally(pos) {
    this.play('door', 0.8, 1.0, 0.06, 0.03, pos);
    this.play('boostDown', 0.6, 0.8, 0.06, 0.03, pos);
  },
};
