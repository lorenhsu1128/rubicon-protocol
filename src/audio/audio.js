// ============================================================
//  AUDIO — 簡易合成音效
// ============================================================
import { clamp, lerp, makeRng } from '../core/math.js';
import { DS } from '../core/scale.js';
import { SFX_DATA } from './sfx-data.js';

// 音效自己的亂數（音高變化、隨機選檔、雜訊）：不用 Math.random，因為遊戲邏輯共用它，而音效依 AudioContext 的
// 實際時間節流（minGap）——播不播會改變遊戲邏輯之後拿到的亂數（冒煙測試固定種子快轉模擬時結果每次不同）
const arnd = makeRng(0x5f3759df);

// 混音：音效（sfx）與環境音（amb）→ world（低 AP 時低通變悶）→ duck（大爆炸、通訊時壓低）→ master；
// 介面與通訊（ui）不受影響直接進 master。音效另外送一份到殘響（依地圖主題，地下長、空曠短）。
// 配樂（mus，過場動畫用）也直接進 master；曲子由 musicDecode 解碼快取、musicPlay 依 ctx 時間排程。
export const SFX = {
  dk: DS, // 3D 音效的距離倍率（Coral 戰爭的 rtsStart 設成 1，rtsClear 還原）
  ctx: null,
  master: null,
  on: true,
  buf: {},
  ready: false,
  lastT: {},
  mirror: null, // 房主把有位置的音效轉送給客機：(k, vol, rate, pos) => void，由 Game.netInit 設定
  init() {
    if (this.ctx) return;
    try {
      const c = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
      this.master = c.createGain();
      this.master.gain.value = 0.7;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp);
      comp.connect(c.destination);
      this.duckG = c.createGain();
      this.duckG.connect(this.master);
      this.muf = c.createBiquadFilter();
      this.muf.type = 'lowpass';
      this.muf.frequency.value = 20000;
      this.muf.connect(this.duckG);
      this.world = c.createGain();
      this.world.connect(this.muf);
      this.sfx = c.createGain();
      this.sfx.connect(this.world);
      this.amb = c.createGain();
      this.amb.gain.value = 0;
      this.amb.connect(this.world);
      this.uiBus = c.createGain();
      this.uiBus.connect(this.master);
      // 配樂（過場動畫，game/cine.js）：直接進 master，不受壓低與變悶
      // 曲子的安靜段落（預告片的開頭）與高潮差 20 dB 以上：先壓縮再補增益，整段都聽得到
      this.mus = c.createGain();
      this.mus.gain.value = 1;
      const mc = c.createDynamicsCompressor();
      mc.threshold.value = -32;
      mc.knee.value = 12;
      mc.ratio.value = 3;
      mc.attack.value = 0.05;
      mc.release.value = 0.6;
      const mg = c.createGain();
      mg.gain.value = 2.2;
      this.mus.connect(mc);
      mc.connect(mg);
      mg.connect(this.master);
      this.revIn = c.createGain();
      this.revIn.gain.value = 0;
      this.conv = c.createConvolver();
      this.sfx.connect(this.revIn);
      this.revIn.connect(this.conv);
      this.conv.connect(this.world);
      this.setReverb(1.0, 0.1);
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
  // 殘響：以衰減的雜訊產生脈衝響應（decay 秒），wet＝送出量；殘響長度沒變就只改送出量
  setReverb(decay, wet) {
    if (!this.ctx) return;
    if (!this.revDecay || Math.abs(this.revDecay - decay) > 0.05) {
      const c = this.ctx,
        len = Math.max(1, Math.floor(c.sampleRate * decay)),
        b = c.createBuffer(2, len, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / len;
          // 前段稀疏的早期反射＋指數衰減的尾巴
          d[i] = (arnd() * 2 - 1) * Math.pow(1 - t, 3.2) * (i < 600 && i % 97 ? 0.3 : 1);
        }
      }
      this.conv.buffer = b;
      this.revDecay = decay;
    }
    this.revIn.gain.setTargetAtTime(wet, this.ctx.currentTime, 0.2);
  },
  // 大爆炸、通訊時把世界的聲音暫時壓低（amt＝壓掉的比例）
  duck(amt, dur = 0.35) {
    if (!this.ctx) return;
    const g = this.duckG.gain,
      t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(1 - amt, t + 0.03);
    g.setTargetAtTime(1, t + dur, dur * 0.6);
  },
  // 低 AP：世界的聲音變悶（k 0～1）
  setMuffle(k) {
    if (!this.ctx) return;
    const f = k <= 0 ? 20000 : lerp(4000, 650, k);
    if (Math.abs((this.mufF || 20000) - f) < 50) return;
    this.mufF = f;
    this.muf.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.15);
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
  // 過場動畫：聽者跟著鏡頭（位置與朝向）
  setListenerCam(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener,
      p = cam.position;
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion),
      u = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
    this.lpos = p;
    if (L.positionX) {
      L.positionX.value = p.x;
      L.positionY.value = p.y;
      L.positionZ.value = p.z;
      L.forwardX.value = f.x;
      L.forwardY.value = f.y;
      L.forwardZ.value = f.z;
      L.upX.value = u.x;
      L.upY.value = u.y;
      L.upZ.value = u.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
    }
  },
  // ---- 配樂：base64 的 mp3 解碼一次後快取；musicPlay 在 ctx 時間 at 從 offset 秒開始播 ----
  mbuf: {},
  mplay: [],
  musicDecode(name, b64) {
    if (this.mbuf[name]) return Promise.resolve(this.mbuf[name]);
    if (!this.ctx || !b64) return Promise.resolve(null);
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Promise((res) =>
      this.ctx.decodeAudioData(
        arr.buffer,
        (b) => res((this.mbuf[name] = b)),
        () => res(null),
      ),
    );
  },
  musicPlay(name, at, offset = 0, vol = 1, fadeIn = 0) {
    const b = this.mbuf[name];
    if (!this.ctx || !this.on || !b || offset >= b.duration) return null;
    const c = this.ctx,
      s = c.createBufferSource(),
      g = c.createGain();
    s.buffer = b;
    s.connect(g);
    g.connect(this.mus);
    const t = Math.max(at, c.currentTime);
    g.gain.setValueAtTime(fadeIn > 0 ? 0.0001 : vol, t);
    if (fadeIn > 0) g.gain.exponentialRampToValueAtTime(vol, t + fadeIn);
    s.start(t, offset + (t - at));
    const h = { s, g, name };
    this.mplay.push(h);
    s.onended = () => (this.mplay = this.mplay.filter((x) => x !== h));
    return h;
  },
  // 一首曲子在 ctx 時間 at 開始淡出（dur 秒）
  musicFadeAt(h, at, dur) {
    if (!h || !this.ctx) return;
    const g = h.g.gain,
      t = Math.max(at, this.ctx.currentTime);
    try {
      g.setTargetAtTime(0, t, Math.max(0.05, dur / 4));
      h.s.stop(t + dur + 0.1);
    } catch (e) {}
  },
  musicStop(fade = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const h of this.mplay) {
      try {
        h.g.gain.cancelScheduledValues(t);
        h.g.gain.setValueAtTime(h.g.gain.value, t);
        h.g.gain.linearRampToValueAtTime(0, t + fade);
        h.s.stop(t + fade + 0.05);
      } catch (e) {}
    }
    this.mplay = [];
  },
  dist(pos) {
    return pos && this.lpos ? Math.hypot(pos.x - this.lpos.x, pos.y - this.lpos.y, pos.z - this.lpos.z) : 0;
  },
  // bus：'ui' 不受壓低與變悶；delay：延遲秒數（分層的尾音）
  play(k, vol = 1, rate = 1, detune = 0.06, minGap = 0.03, pos = null, bus = null, delay = 0) {
    if (pos && this.mirror) this.mirror(k, vol, rate, pos);
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
    s.playbackRate.value = rate * (1 + (arnd() * 2 - 1) * detune);
    const g = this.ctx.createGain();
    g.gain.value = vol;
    s.connect(g);
    const out = bus === 'ui' ? this.uiBus : this.sfx;
    if (pos) {
      // 3D: distance falloff + stereo direction + far-away low-pass
      const d = this.dist(pos);
      if (d > 140 * this.dk) return;
      const pn = this.ctx.createPanner();
      pn.panningModel = 'equalpower';
      pn.distanceModel = 'inverse';
      pn.refDistance = 7 * this.dk;
      pn.maxDistance = 160 * this.dk;
      pn.rolloffFactor = 1.3;
      pn.coneInnerAngle = 360;
      if (pn.positionX) {
        pn.positionX.value = pos.x;
        pn.positionY.value = pos.y;
        pn.positionZ.value = pos.z;
      } else pn.setPosition(pos.x, pos.y, pos.z);
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(16000 - (d / this.dk) * 110, 1800, 16000);
      g.connect(pn);
      pn.connect(lp);
      lp.connect(out);
    } else g.connect(out);
    s.start(t + delay);
  },
  pickPlay(list, vol, rate, pos, detune = 0.06, minGap = 0.03) {
    this.play(list[Math.floor(arnd() * list.length)], vol, rate, detune, minGap, pos);
  },
  // ---- 合成音（短促的提示音、心跳、無線電雜訊）----
  noise(dur, freq, vol, type = 'lowpass', bus = 'sfx', q = 1, delay = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx;
    const b = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (arnd() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = b;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = vol * 0.5;
    s.connect(f);
    f.connect(g);
    g.connect(bus === 'ui' ? this.uiBus : this.sfx);
    s.start(c.currentTime + delay);
  },
  tone(f0, f1, dur, vol, type = 'square', bus = 'sfx', delay = 0) {
    if (!this.ctx || !this.on) return;
    const c = this.ctx,
      t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol * 0.4, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(bus === 'ui' ? this.uiBus : this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
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
      g.connect(this.sfx);
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
    this.ambStop();
    this.setMuffle(0);
    this.hbT = 0;
  },
  // ---- 環境音：依地圖主題疊幾層循環（檔案或合成的風聲／海浪），淡入 ----
  ambNodes: [],
  ambKey: '',
  ambient(layers, key) {
    if (!this.ctx || !this.on || key === this.ambKey) return;
    this.ambStop();
    this.ambKey = key;
    const c = this.ctx;
    for (const L of layers) {
      const g = c.createGain();
      g.gain.value = L.v;
      g.connect(this.amb);
      const nodes = [g];
      if (L.k) {
        const b = this.buf[L.k];
        if (!b) continue;
        const s = c.createBufferSource();
        s.buffer = b;
        s.loop = true;
        // mp3 開頭與結尾的編碼補白略過（循環檔本身已交叉淡化）
        s.loopStart = Math.min(0.05, b.duration * 0.1);
        s.loopEnd = b.duration - Math.min(0.05, b.duration * 0.1);
        s.playbackRate.value = L.r || 1;
        s.connect(g);
        s.start(c.currentTime, s.loopStart + arnd() * b.duration * 0.5);
        nodes.push(s);
      } else nodes.push(...this.synthAmb(L.syn, g));
      this.ambNodes.push(nodes);
    }
    this.amb.gain.cancelScheduledValues(c.currentTime);
    this.amb.gain.setValueAtTime(0, c.currentTime);
    this.amb.gain.linearRampToValueAtTime(1, c.currentTime + 2.5);
  },
  ambStop() {
    if (!this.ctx) return;
    this.ambKey = '';
    for (const nodes of this.ambNodes)
      for (const n of nodes) {
        try {
          if (n.stop) n.stop();
          n.disconnect();
        } catch (e) {}
      }
    this.ambNodes = [];
  },
  // 合成環境音：wind／gust（帶通雜訊，中心頻率與音量慢慢飄）、sea（低通雜訊，音量像浪一樣起伏）
  synthAmb(kind, out) {
    const c = this.ctx,
      len = c.sampleRate * 3,
      b = c.createBuffer(1, len, c.sampleRate),
      d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.6 + (arnd() * 2 - 1) * 0.4; // 偏粉紅的雜訊
      d[i] = last;
    }
    // 頭尾交叉淡化，循環不會喀一聲
    const n = 4000;
    for (let i = 0; i < n; i++) d[len - n + i] = d[len - n + i] * (1 - i / n) + d[i] * (i / n);
    const s = c.createBufferSource();
    s.buffer = b;
    s.loop = true;
    s.loopStart = n / c.sampleRate;
    const f = c.createBiquadFilter();
    const g = c.createGain();
    const lfo = c.createOscillator(),
      lg = c.createGain(),
      lfo2 = c.createOscillator(),
      lg2 = c.createGain();
    if (kind === 'sea') {
      f.type = 'lowpass';
      f.frequency.value = 520;
      g.gain.value = 0.9;
      lfo.frequency.value = 0.11;
      lg.gain.value = 0.55;
      lfo.connect(lg).connect(g.gain);
      lfo2.frequency.value = 0.07;
      lg2.gain.value = 260;
      lfo2.connect(lg2).connect(f.frequency);
    } else {
      f.type = 'bandpass';
      f.frequency.value = kind === 'gust' ? 900 : 520;
      f.Q.value = 0.8;
      g.gain.value = 1.1;
      lfo.frequency.value = 0.09;
      lg.gain.value = kind === 'gust' ? 500 : 280;
      lfo.connect(lg).connect(f.frequency);
      lfo2.frequency.value = 0.13;
      lg2.gain.value = 0.45;
      lfo2.connect(lg2).connect(g.gain);
    }
    s.connect(f).connect(g).connect(out);
    s.start();
    lfo.start();
    lfo2.start();
    return [s, lfo, lfo2];
  },
  // ---- 低 AP：心跳與變悶（k 0～1，每格呼叫；越低越快） ----
  hbT: 0,
  heartbeat(k, dt) {
    this.setMuffle(k * 0.85);
    if (k <= 0) {
      this.hbT = 0;
      return;
    }
    this.hbT -= dt;
    if (this.hbT > 0) return;
    this.hbT = lerp(1.05, 0.55, k);
    this.tone(70, 40, 0.16, 0.9 * (0.5 + k * 0.5), 'sine', 'ui');
    this.tone(64, 38, 0.14, 0.6 * (0.5 + k * 0.5), 'sine', 'ui', 0.17);
  },
  // ---- 武器 ----
  mgHeat: 0,
  mgT: 0,
  shot(kind, id, pos) {
    const P = pos || null;
    const own = !P; // 自己開火：多一層低頻的衝擊感
    const far = P && this.dist(P) > 45; // 遠處的槍聲多一點回音尾巴
    switch (kind) {
      case 'bullet': {
        if (id === 'w_mg' || id === 'bw_gat') {
          // 機槍連射越打越熱：音高慢慢往上
          const t = this.ctx ? this.ctx.currentTime : 0;
          this.mgHeat = t - this.mgT < 0.25 ? Math.min(24, this.mgHeat + 1) : 0;
          this.mgT = t;
          this.play('mg', 0.6, 1.05 * (1 + this.mgHeat * 0.004), 0.08, 0.02, P);
          if (own && this.mgHeat % 3 === 0) this.play('thud2', 0.18, 1.8, 0.1, 0.05);
        } else if (id === 'w_hg') this.play('pistol', 0.75, 1.0, 0.06, 0.03, P);
        else {
          this.pickPlay(['rifle', 'rifle2'], 0.75, 1.0, P);
          if (own) this.play('thud1', 0.3, 1.5, 0.08, 0.05);
        }
        if (far) this.play('distant', 0.12, 1.6, 0.1, 0.15, P, null, 0.05);
        break;
      }
      case 'shotgun':
        this.play('shotgun', 0.95, 0.95, 0.06, 0.03, P);
        if (own) this.play('thud1', 0.5, 1.1, 0.06, 0.05);
        if (far) this.play('distant', 0.15, 1.4, 0.1, 0.15, P, null, 0.05);
        break;
      case 'shell':
        this.play('heavy', 1.0, 0.85, 0.06, 0.03, P);
        this.play('boostUp', 0.35, 1.4, 0.06, 0.03, P);
        if (own) this.play('boom2', 0.35, 1.6, 0.06, 0.05);
        else this.play('distant', 0.25, 1.2, 0.08, 0.1, P, null, 0.08);
        break;
      case 'grenade':
        this.play('heavy', 0.9, 0.7, 0.06, 0.03, P);
        if (own) this.play('thud2', 0.45, 0.9, 0.06, 0.05);
        break;
      case 'laser':
        if (id === 'w_lc' || id === 'bw_lc') this.pickPlay(['laserBig', 'laserBig2'], 0.75, 1.0, P);
        else this.pickPlay(['laser', 'laser2'], 0.65, 1.0, P);
        if (own) this.play('dome2', 0.12, 2.2, 0.1, 0.05);
        break;
      case 'laserCharged':
        this.play('laserCharged', 0.95, 1.0, 0.04, 0.03, P);
        this.play('explode3', 0.35, 1.5, 0.06, 0.03, P);
        this.play('boom2', own ? 0.5 : 0.3, 1.3, 0.06, 0.05, P);
        break;
      case 'missile':
        this.play('missile', 0.6, 1.2, 0.06, 0.03, P);
        this.play('boostUp', 0.5, 1.2, 0.06, 0.03, P);
        if (own) this.play('thrBurst', 0.25, 1.6, 0.1, 0.06);
        break;
      case 'blade':
        this.play('boostUp', 0.6, 1.5, 0.1, 0.03, P);
        this.play('laser2', 0.3, 0.6, 0.06, 0.03, P);
        this.play('thrBurst', 0.3, 2.0, 0.1, 0.05, P);
        break;
    }
  },
  charge(pos) {
    this.play('charge', 0.7, 1.0, 0.03, 0.2, pos);
  },
  // 爆炸：false 小、true 大、'huge' Boss 等級（大的近距離時把其他聲音壓低）
  explode(big, pos) {
    const d = this.dist(pos);
    if (big === 'huge') {
      this.play('explodeBig', 1.0, 0.8, 0.05, 0.03, pos);
      this.play('boom1', 1.0, 0.8, 0.05, 0.03, pos);
      this.play('debris', 0.8, 0.8, 0.05, 0.03, pos, null, 0.08);
      this.play('distant', 0.8, 0.8, 0.05, 0.03, pos, null, 0.15);
      this.pickPlay(['clatter1', 'clatter2'], 0.5, 0.7, pos);
      this.duck(0.55, 0.7);
    } else if (big) {
      this.play('explodeBig', 1.0, 0.95, 0.05, 0.03, pos);
      this.pickPlay(['crunch1', 'crunch2', 'crunch3'], 0.7, 0.9, pos);
      this.play('boom2', 0.8, 1.0, 0.06, 0.05, pos);
      this.play('distant', 0.6, 1.0, 0.05, 0.03, pos, null, 0.06);
      if (d < 30) this.duck(0.35, 0.35);
    } else {
      this.pickPlay(['explode', 'explode2', 'explode3'], 0.8, 1.05, pos);
      this.pickPlay(['crunch1', 'crunch2', 'crunch3'], 0.35, 1.3, pos, 0.1, 0.05);
    }
  },
  // 擊破時的殘骸散落（爆炸之後）
  wreck(pos) {
    this.play('debris', 0.7, 1.0, 0.08, 0.05, pos, null, 0.05);
    this.pickPlay(['clatter1', 'clatter2'], 0.45, 0.9, pos, 0.1, 0.05);
  },
  // 命中：依目標分類（t 是被打中的實體；自己被打中＝駕駛艙的悶響）
  hit(pos, t) {
    if (t && t.isPlayer) {
      this.pickPlay(['hit', 'hit2', 'hit3'], 0.55, 0.9, null);
      this.pickPlay(['punch1', 'punch2'], 0.55, 0.8, null, 0.08, 0.06);
      this.play('thud1', 0.4, 0.8, 0.08, 0.08);
      return;
    }
    if (t && t.isProp) {
      this.pickPlay(['rock1', 'rock2'], 0.55, 1.0, pos, 0.1, 0.04);
      return;
    }
    this.pickPlay(['hit', 'hit2', 'hit3'], 0.5, 1.0, pos);
    this.pickPlay(['armor1', 'armor2', 'armor3'], 0.45, 0.85, pos, 0.1, 0.04);
  },
  // 子彈打到地形、建築
  hitWorld(pos) {
    this.pickPlay(['rock1', 'rock2'], 0.28, 1.2, pos, 0.12, 0.06);
  },
  hitShield(pos, big) {
    this.pickPlay(['plate1', 'plate2'], big ? 0.9 : 0.5, big ? 0.7 : 1.0, pos, 0.08, 0.04);
  },
  hitDome(pos) {
    this.pickPlay(['dome1', 'dome2'], 0.5, 1.4, pos, 0.1, 0.06);
  },
  // 近戰的揮擊音（docs/melee-combo-design.md 的「打擊感改版」）：fam＝武器的音色（blade／saber／claw／pile／fist），
  // cat＝派生的種類（data/melee.js 的 meleeCat：n 連段、f 前、s 側、b 後（上挑）、a 空中、d 下劈、x 衝刺斬、e 處決、h 盾擊）
  meleeSwing(fam, cat, st, pos) {
    const P = (k, v, r, dl = 0) => this.play(k, v, r, 0.08, 0.02, pos, null, dl);
    switch (fam) {
      case 'saber':
        P('laserBig2', 0.35, 0.75);
        P('boostUp', 0.55, 1.15);
        break;
      case 'claw':
        P('boostUp', 0.45, 1.9);
        P('crunch1', 0.22, 1.7);
        break;
      case 'pile':
        P('thrBurst', 0.5, 1.0);
        P('heavy', 0.3, 1.35);
        break;
      case 'fist':
        P('boostUp', 0.5, 1.3);
        break;
      default:
        P('boostUp', 0.55, 1.5);
        P('laser2', 0.3, 0.65);
    }
    const own = !pos;
    switch (cat) {
      case 'f': // 前派生：短促、尖的突刺聲
        P('laser', 0.28, 1.8);
        P('thrBurst', 0.4, 2.5);
        if (own) this.noise(0.1, 3400, 0.5, 'bandpass', 'sfx', 2);
        break;
      case 's': // 側派生：拉長、轉一圈的風切聲
        P('boostUp', 0.45, 0.85, 0.12);
        P('thrBurst', 0.35, 1.2, 0.05);
        if (own) this.noise(0.42, 900, 0.55, 'bandpass', 'sfx', 1.5);
        break;
      case 'b': // 後派生（上挑）：往上爬的音
        P('charge', 0.32, 2.6);
        P('boostUp', 0.5, 2.1, 0.04);
        break;
      case 'a': // 空中：推進器噴一下
        P('thrBurst', 0.45, 1.5);
        P('laser2', 0.22, 1.25);
        break;
      case 'd': // 下劈：往下衝
        P('boostDown', 0.7, 0.9);
        P('thrBurst', 0.5, 0.85);
        break;
      case 'x': // 衝刺斬：推進器的爆發
        P('boostUp', 0.75, 1.0);
        P('thrBurst', 0.6, 1.3);
        if (own) this.noise(0.25, 600, 0.5, 'lowpass', 'sfx', 1);
        break;
      case 'e': // 處決
        P('charge', 0.5, 1.2);
        P('overload', 0.3, 1.4);
        break;
      case 'h': // 盾擊
        P('shield', 0.5, 1.4);
        P('thud1', 0.5, 0.9);
        break;
      default:
        P('thrBurst', 0.3, st && st.finisher ? 1.5 : 2.0);
    }
  },
  // 近戰命中：big＝終結技；cat／fam 同 meleeSwing；w＝重量（data/melee.js 的 meleeWeight，0 輕～3 極重）
  meleeHit(big, pos, cat, fam, w) {
    if (w === undefined) w = big ? 2 : 1;
    const P = (k, v, r, dl = 0) => this.play(k, v, r, 0.06, 0.02, pos, null, dl);
    this.pickPlay(['hit', 'hit2'], 0.9, 0.8, pos);
    switch (fam) {
      case 'saber':
        P('laserBig', 0.3, 1.7);
        P('armor1', 0.45, 0.95);
        break;
      case 'claw':
        this.pickPlay(['crunch1', 'crunch2', 'crunch3'], 0.75, 1.1, pos);
        break;
      case 'pile':
        P('heavy', 0.85, 0.9);
        P('armor3', 0.6, 0.8);
        break;
      case 'fist':
        this.pickPlay(['punch1', 'punch2'], 1, 0.8, pos);
        P('thud2', 0.5, 0.9);
        break;
      default:
        this.pickPlay(['punch1', 'punch2'], 0.7, 0.85, pos);
        P('armor1', 0.4, 1.3);
    }
    switch (cat) {
      case 'f': // 突刺：貫穿
        P('armor2', 0.5, 1.5);
        break;
      case 's': // 迴旋：刮過裝甲
        P('plate1', 0.55, 1.2);
        break;
      case 'b': // 上挑：鏗一聲＋往上飛
        P('plate2', 0.5, 1.0);
        P('boostUp', 0.3, 2.4, 0.03);
        break;
      case 'd': // 下劈：砸進地面
        P('rock1', 0.7, 0.8);
        P('boom1', 0.7, 0.9);
        P('debris', 0.4, 1.0, 0.05);
        break;
      case 'x': // 衝刺斬：衝撞
        P('thud1', 0.7, 0.75);
        break;
      case 'h':
        P('shield', 0.6, 0.9);
        P('thud2', 0.6, 0.8);
        break;
    }
    if (w <= 0) P('explode3', 0.3, 1.6);
    else if (w === 1) P('explode3', 0.45, 1.4);
    else {
      P('explode2', w >= 3 ? 1 : 0.9, w >= 3 ? 0.75 : 0.9);
      P('boom2', w >= 3 ? 0.8 : 0.6, w >= 3 ? 0.85 : 1.1, 0.02);
      if (w >= 3) P('explodeBig', 0.4, 1.2, 0.03);
    }
  },
  qb(pos) {
    this.play('boostUp', 0.8, 1.15, 0.08, 0.03, pos);
    this.play('thrBurst', 0.55, 1.1, 0.08, 0.05, pos);
  },
  jump(pos) {
    this.play('boostUp', 0.55, 0.9, 0.08, 0.2, pos);
    this.play('thrBurst', 0.3, 0.85, 0.08, 0.2, pos);
  },
  // 落地：依落下速度決定重量（v 0～1）
  land(pos, v = 0.5) {
    this.play('boostDown', 0.5, 1.1, 0.08, 0.2, pos);
    this.pickPlay(['thud1', 'thud2'], 0.4 + v * 0.6, 0.9 - v * 0.25, pos, 0.06, 0.15);
    if (v > 0.6) this.pickPlay(['plate1', 'plate2'], 0.35, 0.55, pos, 0.06, 0.15);
  },
  // 腳步：surf＝地面材質，w＝機體重量（0 輕～1 重）
  step(surf, w, pos) {
    const r = 1.15 - w * 0.4;
    this.pickPlay(['thud1', 'thud2'], 0.32 + w * 0.3, r * 0.9, pos, 0.08, 0.05);
    const v = pos ? 0.5 : 0.35;
    if (surf === 'water') this.pickPlay(['stepWet1', 'stepWet2', 'splash'], v * 1.3, r * 0.8, pos, 0.1, 0.05);
    else if (surf === 'snow') this.pickPlay(['stepSnow1', 'stepSnow2'], v * 1.1, r * 0.75, pos, 0.1, 0.05);
    else if (surf === 'sand') this.pickPlay(['stepSnow1', 'stepSnow2'], v * 0.8, r * 0.5, pos, 0.1, 0.05);
    else if (surf === 'metal')
      this.pickPlay(['armor1', 'armor2', 'armor3'], v * 0.45, r * 0.55, pos, 0.1, 0.05);
    else if (surf === 'ice')
      this.pickPlay(['stepConc1', 'stepConc2', 'stepConc3'], v, r * 1.1, pos, 0.1, 0.05);
    else this.pickPlay(['stepConc1', 'stepConc2', 'stepConc3'], v, r * 0.6, pos, 0.1, 0.05);
  },
  ab(pos) {
    this.play('boostUp', 0.9, 0.75, 0.05, 0.3, pos);
    this.play('thrBurst', 0.6, 0.7, 0.05, 0.3, pos);
  },
  stagger(pos) {
    this.play('overload', 0.9, 1.0, 0.04, 0.03, pos);
    this.play('stagger', 0.5, 0.9, 0.06, 0.03, pos);
  },
  // ---- 回饋音（自己打出的效果，不分位置） ----
  // 打出失衡：低音重擊＋鐘聲＋碎裂
  breakFx() {
    this.play('bell', 0.55, 0.75, 0.03, 0.1, null, 'ui');
    this.play('glass', 0.6, 0.8, 0.05, 0.1, null, 'ui');
    this.play('boom2', 0.55, 1.2, 0.05, 0.1);
  },
  // 邊閃邊打的加成打中（data/ranged.js 的位元）：清脆的金屬聲，反擊多一聲鐘
  rangedBonus(tags) {
    this.play('uiTick', 0.45, 1.5, 0.03, 0.07, null, 'ui');
    this.play('plate1', 0.35, 1.25, 0.05, 0.07, null, 'ui');
    if (tags & 2) this.play('bell', 0.3, 1.4, 0.02, 0.15, null, 'ui');
  },
  // 擊破確認：連續擊破時音高一級級往上（n＝連擊數），精英／AC 多一聲重音並短暫壓低其他聲音
  killConfirm(n, big) {
    const st = Math.min(Math.max(0, n - 1), 9);
    const f = 660 * Math.pow(2, (st * 2) / 12);
    this.tone(f, f * 0.98, 0.22, 0.32, 'sine', 'ui');
    this.tone(f * 1.5, f * 1.49, 0.16, 0.16, 'triangle', 'ui', 0.04);
    this.play('uiTick', 0.5, 0.9 + st * 0.05, 0, 0.03, null, 'ui');
    if (big) {
      this.play('bell', 0.7, 0.6, 0.02, 0.1, null, 'ui');
      this.play('boom1', 0.6, 1.0, 0.05, 0.1);
      this.duck(0.5, 0.45);
    }
  },
  // ---- 介面與通訊 ----
  // 按鈕（input.js 的全域監聽，在各按鈕自己的 SFX.ui() 之前）：依按鈕種類換聲音，之後的 SFX.ui() 不重複
  btnT: 0,
  uiBtn(kind) {
    if (!this.ctx) return;
    this.btnT = this.ctx.currentTime;
    this.ui(kind || 'click');
  },
  ui(kind) {
    if (!kind && this.ctx && this.ctx.currentTime - this.btnT < 0.1) return;
    if (kind === 'back') this.play('uiBack', 0.7, 1.0, 0.02, 0.03, null, 'ui');
    else if (kind === 'ok') this.play('uiOk', 0.55, 1.0, 0.02, 0.05, null, 'ui');
    else if (kind === 'err') this.play('uiErr', 0.6, 1.0, 0.02, 0.05, null, 'ui');
    else if (kind === 'tog') this.play('uiTog', 0.6, 1.0, 0.04, 0.03, null, 'ui');
    else if (kind === 'hover') this.play('uiTick', 0.22, 1.2, 0.05, 0.06, null, 'ui');
    else this.play('uiClick', 0.7, 1.0, 0.04, 0.03, null, 'ui');
  },
  kit() {
    this.play('ui2', 0.8, 1.0, 0.06, 0.03, null, 'ui');
    this.play('uiOpen', 0.4, 0.8, 0.03, 0.05, null, 'ui');
  },
  alert() {
    this.play('ui2', 0.6, 0.7, 0.06, 0.03, null, 'ui');
  },
  // 無線電開頭：雜訊＋嗶（通訊期間世界的聲音稍微壓低）
  radio() {
    this.noise(0.09, 2400, 0.35, 'bandpass', 'ui', 1.5);
    this.play('glitch', 0.35, 1.0, 0.1, 0.1, null, 'ui');
    this.tone(1320, 1320, 0.07, 0.25, 'square', 'ui', 0.08);
    this.duck(0.2, 1.2);
  },
  // 增援預告（pan：-1 左～1 右，依預告方向）；last＝最後一波
  waveAlert(pan, last) {
    if (!this.ctx || !this.on) return;
    const b = this.buf[last ? 'alarmBig' : 'alarm'];
    if (!b) return;
    const c = this.ctx,
      s = c.createBufferSource(),
      g = c.createGain();
    s.buffer = b;
    g.gain.value = last ? 0.55 : 0.45;
    s.connect(g);
    if (c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1) * 0.8;
      g.connect(p).connect(this.uiBus);
    } else g.connect(this.uiBus);
    s.start();
    if (last) this.play('boom1', 0.5, 0.7, 0.03, 0.2);
  },
  // 事件提示：出口開啟、開箱、拾取、Boss 第二型態、戰術模組、區域清除
  cue(kind) {
    if (kind === 'exit') {
      this.play('uiOpen', 0.6, 0.7, 0.02, 0.1, null, 'ui');
      this.play('dome1', 0.4, 0.9, 0.02, 0.1, null, 'ui');
    } else if (kind === 'cache') {
      this.play('doorOpen', 0.7, 0.8, 0.03, 0.1, null, 'ui');
      this.play('uiOk', 0.5, 1.2, 0.03, 0.1, null, 'ui', 0.15);
    } else if (kind === 'pickup') {
      this.play('uiOk', 0.5, 1.4, 0.03, 0.08, null, 'ui');
    } else if (kind === 'phase') {
      this.play('alarmBig', 0.45, 0.8, 0.02, 0.5, null, 'ui');
      this.play('boom1', 0.8, 0.7, 0.03, 0.5);
      this.duck(0.4, 0.8);
    } else if (kind === 'mod') {
      this.play('bong', 0.6, 0.8, 0.02, 0.2, null, 'ui');
      this.play('uiOpen', 0.5, 1.0, 0.02, 0.2, null, 'ui', 0.06);
    } else if (kind === 'clear') {
      this.tone(523, 523, 0.25, 0.3, 'triangle', 'ui');
      this.tone(784, 784, 0.4, 0.3, 'triangle', 'ui', 0.12);
    }
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
