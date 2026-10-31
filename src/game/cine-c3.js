// 第 3 章 冰原之下（恐怖片） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch3.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c3 開頭，避免和別章重複。
//  - c3amb：恐怖片的聲音（低頻嗡聲、呼吸、無線電嘶聲；以 WebAudio 合成，跨鏡頭延續）
//  - c3cctv：難民營監視器的錄影（低格率、時間碼、雜訊、跳格時人影消失、訊號中斷）
//  - c3radio：雜訊很重、斷斷續續的通訊
//  - c3shadow：冰面下游過的巨大黑影（鑽地蟲不露臉）
//  - c3thermal：熱感應視角（場景換成冷色、機體換成熱色盤的材質，一般畫面看不到的熱源）
//  - c3title：章名被雪慢慢蓋住
//  - c3lamps：研究所的燈一盞盞往鏡頭方向熄滅
//  - c3term：研究所終端機的檔案（打字、塗黑、週期數字瘋狂跳動、資料毀損）
//  - c3eyes：黑暗中的紅色眼燈
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { Game } from './game.js';

const smooth = (x) => x * x * (3 - 2 * x);
// 固定的偽亂數（同一個 i 每格相同）
const hash = (i) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const MONO = '"Share Tech Mono", "Noto Sans TC", monospace';

// 共用的放射狀漸層貼圖（光暈、地上的光、黑影）
let RADIAL = null;
function radialTex() {
  if (RADIAL) return RADIAL;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  RADIAL = new THREE.CanvasTexture(cv);
  return RADIAL;
}
// 黑影用：邊緣很軟、中間平的貼圖（多片重疊時不會一顆一顆）
let SOFT = null;
function softTex() {
  if (SOFT) return SOFT;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  SOFT = new THREE.CanvasTexture(cv);
  return SOFT;
}
// 雜訊的小畫布（放大畫在全畫面）
let NOISE = null;
function noiseCanvas(k) {
  if (!NOISE) {
    NOISE = document.createElement('canvas');
    NOISE.width = 192;
    NOISE.height = 108;
  }
  const x = NOISE.getContext('2d');
  const im = x.createImageData(192, 108);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.random() * 255;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = Math.random() < k ? 255 : 0;
  }
  x.putImageData(im, 0, 0);
  return NOISE;
}
function drawNoise(x, W, H, alpha, k = 1) {
  if (alpha <= 0) return;
  x.save();
  x.globalAlpha = alpha;
  x.imageSmoothingEnabled = false;
  x.drawImage(noiseCanvas(k), 0, 0, W, H);
  x.restore();
}
function scanlines(x, W, H, a = 0.18, step = 3) {
  x.fillStyle = `rgba(0,0,0,${a})`;
  for (let y = 0; y < H; y += step) x.fillRect(0, y, W, 1);
}

// 熱感應：機體的材質（依法線與視線的夾角、越正對越熱；ironbow 色盤）
const HOT_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	vN = normalize( normalMatrix * normal );
	vV = normalize( - mv.xyz );
	vY = ( modelMatrix * vec4( position, 1.0 ) ).y;
	gl_Position = projectionMatrix * mv;
}
`;
const HOT_FRAG = /* glsl */ `
uniform float time, base;
varying vec3 vN;
varying vec3 vV;
varying float vY;
vec3 iron( float h ) {
	h = clamp( h, 0.0, 1.0 );
	vec3 c0 = vec3( 0.02, 0.0, 0.06 ), c1 = vec3( 0.28, 0.02, 0.38 ), c2 = vec3( 0.8, 0.1, 0.12 ),
		c3 = vec3( 1.0, 0.5, 0.04 ), c4 = vec3( 1.0, 0.96, 0.7 );
	if ( h < 0.25 ) return mix( c0, c1, h / 0.25 );
	if ( h < 0.5 ) return mix( c1, c2, ( h - 0.25 ) / 0.25 );
	if ( h < 0.75 ) return mix( c2, c3, ( h - 0.5 ) / 0.25 );
	return mix( c3, c4, ( h - 0.75 ) / 0.25 );
}
void main() {
	float f = abs( dot( normalize( vN ), normalize( vV ) ) );
	float h = base + 0.38 * f + 0.04 * sin( time * 6.0 + vY * 2.5 );
	gl_FragColor = vec4( iron( h ), 1.0 );
}
`;

Object.assign(Game.prototype, {
  // ---------- 聲音：低頻嗡聲、呼吸、無線電嘶聲（S.amb＝{ drone, breath, hiss } 目標音量）----------
  c3AmbEnsure() {
    if (this.c3a) return this.c3a;
    const c = SFX.ctx;
    if (!c || !SFX.on) return null;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(SFX.uiBus);
    const srcs = [];
    // 低頻嗡聲：幾個不協和的低頻正弦＋一點鋸齒波，低通
    const dg = c.createGain();
    dg.gain.value = 0;
    dg.connect(out);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 170;
    lp.connect(dg);
    for (const [f, ty, v] of [
      [41, 'sine', 0.9],
      [43.6, 'sine', 0.6],
      [61.7, 'sine', 0.4],
      [82.4, 'sawtooth', 0.16],
    ]) {
      const o = c.createOscillator();
      o.type = ty;
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = v;
      o.connect(g);
      g.connect(lp);
      o.start();
      srcs.push(o);
    }
    // 雜訊（呼吸與嘶聲共用）
    const len = c.sampleRate * 2,
      b = c.createBuffer(1, len, c.sampleRate),
      d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.55 + (Math.random() * 2 - 1) * 0.45;
      d[i] = last;
    }
    const mk = (type, freq, q) => {
      const s = c.createBufferSource();
      s.buffer = b;
      s.loop = true;
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f);
      f.connect(g);
      g.connect(out);
      s.start(c.currentTime, Math.random());
      srcs.push(s);
      return { f, g };
    };
    const br = mk('bandpass', 700, 0.9);
    const hs = mk('highpass', 2600, 0.7);
    this.c3a = { c, out, dg, br, hs, srcs, hissK: 1 };
    return this.c3a;
  },
  c3AmbStop() {
    const A = this.c3a;
    if (!A) return;
    this.c3a = null;
    const t = A.c.currentTime;
    A.out.gain.setTargetAtTime(0, t, 0.15);
    setTimeout(() => {
      for (const s of A.srcs)
        try {
          s.stop();
        } catch (e) {}
      try {
        A.out.disconnect();
      } catch (e) {}
    }, 900);
  },
  cineHook_c3amb(S, phase, lt) {
    if (phase === 'exit') {
      // 下一個鏡頭也有 c3amb 就延續（不中斷）
      setTimeout(() => {
        const c = this.cine;
        const S2 = c && c.def.shots[c.shot];
        if (!S2 || ![].concat(S2.hook || []).includes('c3amb')) this.c3AmbStop();
      }, 60);
      return;
    }
    const A = this.c3AmbEnsure();
    if (!A) return;
    const am = S.amb || {};
    const now = A.c.currentTime;
    const t = this.cine ? this.cine.t : lt;
    const paused = this.cine && this.cine.paused;
    A.out.gain.setTargetAtTime(paused ? 0 : 1, now, 0.1);
    A.dg.gain.setTargetAtTime((am.drone || 0) * (0.85 + 0.15 * Math.sin(t * 0.7)), now, 0.6);
    // 呼吸：吸（短、高）→ 停 → 吐（長、低）
    const per = am.per || 3.6;
    const p = (t % per) / per;
    let env = 0,
      fq = 700;
    if (p < 0.32) {
      env = Math.sin((Math.PI * p) / 0.32);
      fq = 950;
    } else if (p > 0.42 && p < 0.86) {
      env = 0.8 * Math.sin((Math.PI * (p - 0.42)) / 0.44);
      fq = 520;
    }
    A.br.g.gain.setTargetAtTime((am.breath || 0) * env * env, now, 0.06);
    A.br.f.frequency.setTargetAtTime(fq, now, 0.2);
    // 嘶聲：訊號斷斷續續
    const drop = (S.drops || []).some(([a, d]) => lt >= a && lt < a + d);
    const hk = (am.hiss || 0) * (drop ? 2.2 : 0.6 + 0.4 * Math.random());
    A.hs.g.gain.setTargetAtTime(hk, now, 0.03);
  },

  // 每個鏡頭都有的細雜訊（底片顆粒之外，類比訊號的質感）
  cineOv_c3grain(x, W, H) {
    drawNoise(x, W, H, 0.035, 0.5);
  },

  // ---------- 監視器錄影 ----------
  // S.cctv＝{ tents: [[x, z, 角度, 大小]], person: [x, z], vanish: 秒, glitch: [[秒, 長度]], lost: 秒, cam, place, date }
  cineHook_c3cctv(S, phase, lt) {
    const c = this.cine;
    const C = S.cctv || {};
    if (phase === 'enter') {
      if (c.c3cctv) this.cineHook_c3cctv(S, 'exit'); // 重複進入（跳時間）時先收掉
      const objs = (c.c3cctv = []);
      const add = (o) => {
        this.scene.add(o);
        objs.push(o);
        return o;
      };
      const canvas = new THREE.MeshLambertMaterial({ color: 0x8a8f86 });
      const snowM = new THREE.MeshLambertMaterial({ color: 0xe8edf2 });
      for (const [tx, tz, ry, s] of C.tents || []) {
        const p = this.cinePt({ g: [tx, tz] });
        const g = new THREE.Group();
        // 三角形的帳篷（擠出的三角柱），一半埋在雪裡
        const sh = new THREE.Shape();
        sh.moveTo(-1.4, 0);
        sh.lineTo(0, 1.7);
        sh.lineTo(1.4, 0);
        sh.lineTo(-1.4, 0);
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 2.6, bevelEnabled: false });
        geo.translate(0, 0, -1.3);
        const m = new THREE.Mesh(geo, canvas);
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        // 積雪：斜面上的雪堆＋埋住下半部的雪丘
        const drift = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), snowM);
        drift.scale.set(1.25, 0.55, 1.15);
        drift.position.set(0.5, 0.1, 0.4);
        g.add(drift);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 2.5), snowM);
        cap.position.set(0, 1.64, 0);
        g.add(cap);
        g.position.copy(p).y -= 0.35;
        g.rotation.y = ((ry || 0) * Math.PI) / 180;
        g.scale.setScalar(s || 1);
        add(g);
      }
      // 營地的燈（一根桿子＋發亮的燈泡）
      if (C.lamp) {
        const p = this.cinePt({ g: C.lamp });
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 3.2, 6), canvas);
        pole.position.copy(p).y += 1.6;
        add(pole);
        const bulb = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: radialTex(),
            color: 0xfff2d0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
          }),
        );
        bulb.scale.setScalar(2.4);
        bulb.position.copy(p).y += 3.2;
        add(bulb);
        const pool = new THREE.Mesh(
          new THREE.PlaneGeometry(9, 9),
          new THREE.MeshBasicMaterial({
            map: radialTex(),
            color: 0x9a9070,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
          }),
        );
        pool.rotation.x = -Math.PI / 2;
        pool.position.copy(p).y += 0.08;
        add(pool);
      }
      // 人影：深色的人形（身體、頭），站著不動
      if (C.person) {
        const p = this.cinePt({ g: C.person });
        const g = new THREE.Group();
        const dark = new THREE.MeshLambertMaterial({ color: 0x1c1d1f });
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.25, 8), dark);
        body.position.y = 0.75;
        g.add(body);
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), dark);
        head.position.y = 1.55;
        g.add(head);
        for (const sx of [-0.1, 0.1]) {
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.35, 6), dark);
          leg.position.set(sx, 0.12, 0);
          g.add(leg);
        }
        g.position.copy(p);
        g.rotation.y = ((C.personYaw || 0) * Math.PI) / 180;
        c.c3person = add(g);
      }
      c.c3frame = -1;
      return;
    }
    if (phase === 'exit') {
      for (const o of c.c3cctv || []) this.scene.remove(o);
      c.c3cctv = null;
      c.c3person = null;
      return;
    }
    // 跳格：那一格之後人影不見了
    if (c.c3person) c.c3person.visible = !(C.vanish != null && lt >= C.vanish);
  },
  // 低格率（每秒 fps 格）：其他格不重畫，畫面停在上一格
  cineRender_c3cctv(S, lt) {
    const c = this.cine;
    const fps = (S.cctv && S.cctv.fps) || 7;
    const f = Math.floor(lt * fps);
    if (f === c.c3frame) return;
    c.c3frame = f;
    this.renderMain();
  },
  cineOv_c3cctv(x, W, H, lt, S) {
    const C = S.cctv || {};
    const s = H / 720;
    const fps = C.fps || 7;
    const fl = Math.floor(lt * fps) / fps; // 文字也跟著低格率
    x.save();
    // 訊號中斷
    if (C.lost != null && lt >= C.lost) {
      x.fillStyle = '#05070a';
      x.fillRect(0, 0, W, H);
      drawNoise(x, W, H, 0.22, 0.6);
      x.fillStyle = 'rgba(220,226,232,0.9)';
      x.font = `${22 * s}px ${MONO}`;
      x.textAlign = 'center';
      x.fillText('NO SIGNAL　訊號中斷', W / 2, H / 2);
      x.font = `${13 * s}px ${MONO}`;
      x.fillText(C.cam || 'CAM 03', W / 2, H / 2 + 26 * s);
      x.restore();
      return;
    }
    // 跳格的雜訊（整個畫面）
    const g = (C.glitch || []).find(([a, d]) => lt >= a && lt < a + d);
    if (g) {
      x.fillStyle = '#000';
      x.fillRect(0, 0, W, H);
      drawNoise(x, W, H, 0.9, 1);
      x.fillStyle = 'rgba(255,255,255,0.5)';
      x.fillRect(0, H * (0.3 + Math.random() * 0.4), W, 3 * s);
    } else {
      drawNoise(x, W, H, 0.1, 0.5);
      // 偶爾的水平撕裂線
      if (hash(Math.floor(lt * fps)) > 0.8) {
        x.fillStyle = 'rgba(230,236,240,0.18)';
        x.fillRect(0, H * hash(Math.floor(lt * fps) + 7), W, 2 * s);
      }
    }
    scanlines(x, W, H, 0.22, 3);
    // 往下捲的亮帶
    const by = ((lt * 0.18) % 1) * H;
    x.fillStyle = 'rgba(255,255,255,0.04)';
    x.fillRect(0, by, W, H * 0.08);
    // 文字：攝影機、地點、時間碼、REC
    x.font = `${17 * s}px ${MONO}`;
    x.fillStyle = 'rgba(235,240,242,0.9)';
    x.shadowColor = 'rgba(0,0,0,0.9)';
    x.shadowBlur = 3 * s;
    const m = 34 * s;
    x.fillText(C.cam || 'CAM 03', m, m + 12 * s);
    x.font = `${14 * s}px ${MONO}`;
    x.fillText(C.place || '', m, m + 32 * s);
    const sec = (C.t0 || 11564) + fl;
    const hh = String(Math.floor(sec / 3600) % 24).padStart(2, '0'),
      mm = String(Math.floor(sec / 60) % 60).padStart(2, '0'),
      ss = String(Math.floor(sec) % 60).padStart(2, '0'),
      ff = String(Math.floor((sec % 1) * 30)).padStart(2, '0');
    x.font = `${17 * s}px ${MONO}`;
    x.fillText(`${C.date || '0118-02-14'}  ${hh}:${mm}:${ss}:${ff}`, m, H - m);
    x.textAlign = 'right';
    if (Math.floor(lt * 1.6) % 2 === 0) {
      x.fillStyle = 'rgba(255,50,40,0.95)';
      x.beginPath();
      x.arc(W - m - 58 * s, m + 6 * s, 6 * s, 0, 7);
      x.fill();
    }
    x.fillStyle = 'rgba(235,240,242,0.9)';
    x.fillText('REC', W - m, m + 12 * s);
    x.font = `${13 * s}px ${MONO}`;
    x.fillText(C.org || '', W - m, H - m);
    x.restore();
  },

  // ---------- 斷斷續續的通訊 ----------
  // S.radio＝{ name, freq }、S.drops＝[[秒, 長度]]（訊號中斷）
  cineHook_c3radio(S, phase, lt) {
    if (phase !== 'tick') return;
    const c = this.cine;
    for (const [i, [a]] of (S.drops || []).entries()) {
      const k = 'c3drop' + c.shot + ':' + i;
      if (lt >= a && !(c.c3fired || (c.c3fired = new Set())).has(k)) {
        c.c3fired.add(k);
        SFX.noise(0.35, 3000, 0.5, 'highpass', 'ui');
        SFX.play('glitch', 0.4, 0.7 + Math.random() * 0.3, 0.1, 0.05, null, 'ui');
      }
    }
  },
  cineOv_c3radio(x, W, H, lt, S) {
    const R = S.radio || {};
    const s = H / 720;
    const drop = (S.drops || []).some(([a, d]) => lt >= a && lt < a + d);
    x.save();
    drawNoise(x, W, H, drop ? 0.55 : 0.12 + Math.random() * 0.05, drop ? 1 : 0.5);
    // 聲紋：中央一條會斷掉的波形
    const cy = H * 0.44;
    const talking = this.cine.subUntil && this.cine.t < this.cine.subUntil;
    x.strokeStyle = drop ? 'rgba(255,255,255,0.35)' : 'rgba(200,220,190,0.75)';
    x.lineWidth = 1.4 * s;
    x.beginPath();
    for (let i = 0; i <= 240; i++) {
      const u = i / 240;
      const px = W * 0.22 + u * W * 0.56;
      const gap = hash(Math.floor(u * 18) + Math.floor(lt * 5) * 31) < 0.18; // 斷訊的段落
      const a = talking && !gap ? 1 : 0.08;
      const n =
        (Math.sin(u * 70 + lt * 21) * 0.5 + Math.sin(u * 153 - lt * 37) * 0.3 + (Math.random() - 0.5) * 0.6) *
        Math.sin(u * Math.PI);
      const py = cy + n * H * 0.06 * a * (drop ? 2.5 : 1);
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
    // 頻道資訊
    x.font = `${14 * s}px ${MONO}`;
    x.fillStyle = 'rgba(200,215,200,0.85)';
    x.textAlign = 'center';
    x.fillText(R.name || '', W / 2, cy - H * 0.11);
    x.font = `${12 * s}px ${MONO}`;
    x.fillStyle = 'rgba(170,185,175,0.7)';
    const bars = drop ? '▁＿＿＿＿' : ['▁▃＿＿＿', '▁▃▅＿＿', '▁＿＿＿＿', '▁▃▅▂＿'][Math.floor(lt * 3) % 4];
    x.fillText(`${R.freq || ''}　訊號 ${bars}`, W / 2, cy - H * 0.11 + 20 * s);
    if (drop) {
      x.font = `${16 * s}px ${MONO}`;
      x.fillStyle = 'rgba(255,90,80,0.9)';
      x.fillText('— SIGNAL LOST —', W / 2, cy + H * 0.12);
    }
    scanlines(x, W, H, 0.2, 3);
    x.restore();
  },

  // ---------- 冰面下的黑影 ----------
  // S.shadow＝{ from: [x, z], to: [x, z], t0, t1, n 節數, w 寬, gap 間距, amp 擺動, op 濃度 }
  cineHook_c3shadow(S, phase, lt) {
    const c = this.cine;
    const D = S.shadow || {};
    if (phase === 'enter') {
      if (c.c3shadow) this.cineHook_c3shadow(S, 'exit');
      const mat = new THREE.MeshBasicMaterial({
        map: softTex(),
        color: 0x000000,
        transparent: true,
        opacity: D.op || 0.55,
        depthWrite: false,
        fog: true,
      });
      const g = new THREE.Group();
      const parts = [];
      const n = D.n || 14;
      for (let i = 0; i < n; i++) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
        m.rotation.x = -Math.PI / 2;
        m.renderOrder = 6;
        const k = 1 - Math.pow(i / n, 1.6) * 0.75; // 頭大尾小
        m.scale.set((D.w || 9) * k, (D.gap || 4) * 2.2, 1);
        g.add(m);
        parts.push(m);
      }
      this.scene.add(g);
      c.c3shadow = { g, parts, mat };
      return;
    }
    if (phase === 'exit') {
      if (c.c3shadow) this.scene.remove(c.c3shadow.g);
      c.c3shadow = null;
      return;
    }
    const Z = c.c3shadow;
    if (!Z) return;
    const a = this.cinePt({ g: D.from }),
      b = this.cinePt({ g: D.to });
    const dir = b.clone().sub(a);
    const L = dir.length();
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const u = clamp((lt - (D.t0 || 0)) / ((D.t1 || 5) - (D.t0 || 0)), 0, 1.4);
    const gap = D.gap || 4;
    const w = this.world;
    Z.parts.forEach((m, i) => {
      const d = u * L - i * gap; // 沿路線的距離（頭在最前面）
      const sw = Math.sin(d * 0.12 - lt * 1.6) * (D.amp || 2.5);
      m.position.copy(a).addScaledVector(dir, d).addScaledVector(side, sw);
      // 貼著冰面（冰層 −0.65）或地面
      m.position.y = Math.max(w ? w.terrainHeight(m.position.x, m.position.z) : 0, -0.65) + 0.06;
      m.rotation.z = -Math.atan2(dir.z, dir.x) + Math.PI / 2;
      // 進場與離場時淡入淡出（整條身體在路線外時看不到）
      m.visible = d > -gap && d < L + gap;
    });
    Z.mat.opacity = (D.op || 0.55) * (0.85 + 0.15 * Math.sin(lt * 3));
  },

  // ---------- 熱感應 ----------
  // S.thermal＝{ tag: 演員 id（標出熱源）, tagT: 秒 }
  cineHook_c3thermal(S, phase, lt) {
    const c = this.cine;
    if (phase === 'enter') {
      if (c.c3th) this.cineHook_c3thermal(S, 'exit');
      const swap = new Map();
      const cold = new THREE.MeshLambertMaterial({ color: 0x2a1e4a });
      const coldT = new THREE.MeshLambertMaterial({ color: 0x3a2a60, transparent: true, opacity: 0.5 });
      const hot = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, base: { value: 0.5 } },
        vertexShader: HOT_VERT,
        fragmentShader: HOT_FRAG,
      });
      const isStd = (m) =>
        m &&
        (m.isMeshStandardMaterial ||
          m.isMeshLambertMaterial ||
          m.isMeshPhongMaterial ||
          m.isMeshBasicMaterial);
      const seen = new Set();
      const put = (o, f) => {
        if (!o.isMesh || seen.has(o)) return;
        seen.add(o);
        const ms = [].concat(o.material);
        if (!ms.every(isStd)) return;
        const nm = f(ms, o);
        if (!nm) return;
        swap.set(o, o.material);
        o.material = Array.isArray(o.material) ? o.material.map(() => nm) : nm;
      };
      // 機體（演員）＝熱：不透明的換成熱色盤；發光的特效照舊
      // 人物（game/cine-people.js）是骨架網格：要支援骨架的材質（不然會以綁定姿勢的公分尺寸畫出來），
      // 而且不受霧影響——一般畫面被暴風雪蓋住，熱感應才看得到
      const hotSkin = new THREE.MeshBasicMaterial({ color: 0xffa040, skinning: true, fog: false });
      for (const A of c.actors.values()) {
        if (A.hum) {
          for (const H of A.hum) if (H.ch) H.ch.g.traverse((o) => put(o, () => hotSkin));
          continue;
        }
        const root = A.e ? A.e.mesh : A.obj;
        if (!root) continue;
        root.traverse((o) => put(o, (ms) => (ms.some((m) => m.transparent) ? null : hot)));
      }
      // 其他（地形、物件、冰面）＝冷
      this.scene.traverse((o) =>
        put(o, (ms) =>
          ms.some((m) => m.transparent || m.blending === THREE.AdditiveBlending) ? coldT : cold,
        ),
      );
      const wt = this.world && this.world.weather && this.world.weather.points;
      if (wt) wt.visible = false;
      c.c3th = { swap, mats: [cold, coldT, hot, hotSkin], hot, wt };
      return;
    }
    const T = c.c3th;
    if (!T) return;
    if (phase === 'exit') {
      for (const [o, m] of T.swap) o.material = m;
      for (const m of T.mats) m.dispose();
      if (T.wt) T.wt.visible = true;
      c.c3th = null;
      return;
    }
    T.hot.uniforms.time.value = lt;
  },
  cineOv_c3thermal(x, W, H, lt, S) {
    const c = this.cine;
    const s = H / 720;
    const TH = S.thermal || {};
    const top = (c.bar || 0) + 22 * s,
      bot = H - (c.bar || 0) - 22 * s;
    x.save();
    drawNoise(x, W, H, 0.08, 0.6);
    scanlines(x, W, H, 0.12, 2);
    // 開機的閃爍
    if (lt < 0.18) {
      x.fillStyle = `rgba(255,255,255,${0.6 * (1 - lt / 0.18)})`;
      x.fillRect(0, 0, W, H);
    }
    x.font = `${14 * s}px ${MONO}`;
    x.fillStyle = 'rgba(255,240,220,0.9)';
    x.fillText('熱感應　THERMAL / IRONBOW', 40 * s, top + 14 * s);
    x.font = `${12 * s}px ${MONO}`;
    x.fillText(`增益 AUTO　感測器 −${(24 + Math.sin(lt * 3) * 0.6).toFixed(1)}°C`, 40 * s, top + 32 * s);
    // 右側的色盤刻度
    const bx = W - 60 * s,
      bh = (bot - top) * 0.55,
      by = top + 40 * s;
    const gr = x.createLinearGradient(0, by + bh, 0, by);
    gr.addColorStop(0, '#05000f');
    gr.addColorStop(0.25, '#47065f');
    gr.addColorStop(0.5, '#cc1a1f');
    gr.addColorStop(0.75, '#ff800a');
    gr.addColorStop(1, '#fff6b0');
    x.fillStyle = gr;
    x.fillRect(bx, by, 10 * s, bh);
    x.textAlign = 'right';
    x.fillStyle = 'rgba(255,240,220,0.85)';
    x.fillText('120°', bx - 6 * s, by + 8 * s);
    x.fillText('−40°', bx - 6 * s, by + bh);
    // 中央的十字
    x.strokeStyle = 'rgba(255,240,220,0.7)';
    x.lineWidth = 1.2 * s;
    x.beginPath();
    x.moveTo(W / 2 - 18 * s, H / 2);
    x.lineTo(W / 2 - 6 * s, H / 2);
    x.moveTo(W / 2 + 6 * s, H / 2);
    x.lineTo(W / 2 + 18 * s, H / 2);
    x.moveTo(W / 2, H / 2 - 18 * s);
    x.lineTo(W / 2, H / 2 - 6 * s);
    x.moveTo(W / 2, H / 2 + 6 * s);
    x.lineTo(W / 2, H / 2 + 18 * s);
    x.stroke();
    // 熱源的框（慢慢收緊、閃爍）
    const A = TH.tag && c.actors.get(TH.tag);
    if (A && A.e && lt >= (TH.tagT || 0)) {
      const p = A.e.center().project(this.camera);
      if (p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1) {
        const sx = (p.x * 0.5 + 0.5) * W,
          sy = (-p.y * 0.5 + 0.5) * H;
        const k = clamp((lt - (TH.tagT || 0)) / 0.5, 0, 1);
        const r = lerp(110, 52, smooth(k)) * s;
        const blink = Math.floor(lt * 8) % 2 ? 1 : 0.45;
        x.strokeStyle = `rgba(255,255,255,${0.95 * blink})`;
        x.lineWidth = 1.8 * s;
        const cc = r * 0.35;
        for (const [dx, dy] of [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ]) {
          x.beginPath();
          x.moveTo(sx + dx * r, sy + dy * (r - cc));
          x.lineTo(sx + dx * r, sy + dy * r * 1.5 - dy * (dy > 0 ? r * 0.5 : r * 0.5));
          x.lineTo(sx + dx * (r - cc), sy + dy * r);
          x.stroke();
        }
        x.textAlign = 'left';
        x.font = `${12 * s}px ${MONO}`;
        x.fillStyle = `rgba(255,255,255,${blink})`;
        x.fillText('熱源　未識別', sx + r + 8 * s, sy - r + 10 * s);
        x.fillText('37.2°C', sx + r + 8 * s, sy - r + 26 * s);
      }
    }
    x.restore();
  },

  // ---------- 章名被雪蓋住 ----------
  // S.title＝{ main, sub, t0 出現, t1 開始積雪, t2 全部蓋住 }
  cineOv_c3title(x, W, H, lt, S) {
    const T = S.title || {};
    const s = H / 720;
    const t0 = T.t0 || 0.4,
      t1 = T.t1 || 2.2,
      t2 = T.t2 || 7;
    if (lt < t0) return;
    const cx = W / 2,
      cy = H * 0.47;
    const k = clamp((lt - t1) / (t2 - t1), 0, 1); // 積雪的進度
    x.save();
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const fs = 72 * s;
    x.globalAlpha = clamp((lt - t0) / 0.5, 0, 1) * (1 - smooth(k) * 0.92);
    x.fillStyle = '#141a20';
    x.font = `700 ${fs}px "Noto Serif TC", "Noto Sans TC", serif`;
    x.fillText(T.main || '', cx, cy);
    x.font = `${15 * s}px ${MONO}`;
    x.fillStyle = '#2a323a';
    x.fillText(T.sub || '', cx, cy - fs * 0.85);
    x.globalAlpha = 1;
    // 雪：每片有落下的時間（越晚越密），落到字的範圍裡就停住
    const bw = Math.max(fs * 4.6, 380 * s),
      bh = fs * 1.4;
    const N = 1600;
    for (let i = 0; i < N; i++) {
      const land = t1 - 0.6 + Math.pow(hash(i), 0.7) * (t2 - t1 + 0.6);
      const fall = 0.9;
      if (lt < land - fall) continue;
      const px = cx + (hash(i + 0.37) - 0.5) * bw,
        py = cy + (hash(i + 0.71) - 0.5) * bh;
      const r = (0.8 + hash(i + 0.13) * 2.2) * s;
      let yy = py,
        a = 0.85;
      if (lt < land) {
        const u = (lt - (land - fall)) / fall;
        yy = py - (1 - u) * H * 0.25;
        a = 0.55;
      }
      x.fillStyle = `rgba(246,249,252,${a})`;
      x.beginPath();
      x.arc(px + Math.sin(i + lt) * (lt < land ? 4 * s : 0), yy, r, 0, 7);
      x.fill();
    }
    x.restore();
  },

  // ---------- 研究所的燈 ----------
  // S.lamps＝{ xs: [x…], y, z0（遠）, z1（近）, n, t0, step, exp0（全亮時的曝光）}
  cineHook_c3lamps(S, phase, lt) {
    const c = this.cine;
    const L = S.lamps || {};
    if (phase === 'enter') {
      if (c.c3lamps) this.cineHook_c3lamps(S, 'exit');
      const list = [];
      const n = L.n || 8;
      const fixM = new THREE.MeshBasicMaterial({ color: 0xf2f6ff });
      for (let i = 0; i < n; i++) {
        const z = lerp(L.z0 || -60, L.z1 || -6, i / (n - 1));
        for (const lx of L.xs || [-6, 6]) {
          const p = this.cinePt([lx, L.y || 7, z]);
          const g = new THREE.Group();
          const fix = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.5), fixM.clone());
          g.add(fix);
          const glow = new THREE.Sprite(
            new THREE.SpriteMaterial({
              map: radialTex(),
              color: 0xd8e6ff,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              transparent: true,
              opacity: 0.8,
            }),
          );
          glow.scale.set(5, 2.6, 1);
          g.add(glow);
          const gp = this.cinePt({ g: [lx * 0.6, z] });
          const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(10, 10),
            new THREE.MeshBasicMaterial({
              map: radialTex(),
              color: 0x8090a0,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              transparent: true,
            }),
          );
          pool.rotation.x = -Math.PI / 2;
          pool.position.copy(gp).sub(p);
          pool.position.y += 0.1;
          g.add(pool);
          g.position.copy(p);
          this.scene.add(g);
          list.push({ g, fix, glow, pool, i, off: (L.t0 || 1.5) + i * (L.step || 0.8) });
        }
      }
      c.c3lamps = list;
      c.c3lampN = list.length;
      return;
    }
    if (phase === 'exit') {
      for (const l of c.c3lamps || []) this.scene.remove(l.g);
      c.c3lamps = null;
      return;
    }
    let on = 0;
    for (const l of c.c3lamps || []) {
      const d = lt - l.off;
      // 熄滅前閃兩下
      let k = 1;
      if (d > -0.35 && d < 0) k = Math.floor(d * 22) % 2 ? 0.15 : 1;
      else if (d >= 0) k = 0;
      if (d >= 0 && !l.done) {
        l.done = true;
        if (l.g.position.x < c.set.anchor.x + 0.01) {
          // 每一對只播一次聲音
          SFX.play('thud2', 0.7, 0.45 + Math.random() * 0.1, 0.05, 0.05, null, 'ui');
          SFX.play('door', 0.25, 0.5, 0.05, 0.05, null, 'ui');
        }
      }
      l.fix.material.color.setScalar(lerp(0.04, 1, k));
      l.glow.material.opacity = 0.8 * k;
      l.pool.material.opacity = k;
      on += k;
    }
    // 整個場景跟著變暗
    const f = c.c3lampN ? on / c.c3lampN : 0;
    c.P.exposure = (L.exp0 || 0.7) * lerp(0.12, 1, f);
    c.P.hemiK = lerp(0.1, L.hemi0 || 0.7, f);
    c.P.sunK = lerp(0.05, L.sun0 || 0.5, f);
  },

  // ---------- 終端機的檔案 ----------
  // S.term＝{ lines: [{ t, s, cps, red: [[起, 迄]], redT, spin: [起, 迄] }], glitch: 秒, head }
  // 文字裡的 {N}＝週期數（spin 期間瘋狂跳動，之後顯示溢位）
  c3TermText(l, lt) {
    let s = l.s;
    if (s.includes('{N}')) {
      const [a, b] = l.spin || [l.t + 0.5, l.t + 4];
      let v = '';
      if (lt < a) v = '0';
      else if (lt < b) {
        const n = Math.min(26, 1 + Math.floor(Math.pow((lt - a) / (b - a), 1.3) * 26));
        for (let i = 0; i < n; i++) v += Math.floor(Math.random() * 10);
      } else v = '██████████████████████████　OVERFLOW';
      s = s.replace('{N}', v);
    }
    return s;
  },
  c3TermVis(l, lt) {
    return Math.max(0, Math.floor((lt - l.t) * (l.cps || 38)));
  },
  cineHook_c3term(S, phase, lt) {
    if (phase !== 'tick') return;
    const c = this.cine;
    const T = S.term || {};
    let n = 0;
    for (const l of T.lines || []) n += Math.min(this.c3TermVis(l, lt), l.s.length);
    if (c.c3typed == null || phase === 'enter' || n < c.c3typed) c.c3typed = n;
    const now = performance.now();
    if (n > c.c3typed && now - (c.c3typeT || 0) > 45 && !(T.glitch && lt > T.glitch + 2)) {
      c.c3typeT = now;
      SFX.play('uiClick', 0.14, 1.5 + Math.random() * 0.5, 0.05, 0.02, null, 'ui');
    }
    c.c3typed = n;
    if (T.glitch && lt > T.glitch && lt < T.glitch + 3 && Math.random() < 0.06)
      SFX.play('glitch', 0.25, 0.5 + Math.random() * 0.6, 0.1, 0.05, null, 'ui');
  },
  cineOv_c3term(x, W, H, lt, S) {
    const T = S.term || {};
    const s = H / 720;
    const gl = T.glitch != null ? clamp((lt - T.glitch) / 2.6, 0, 1) : 0;
    const end = T.end != null && lt >= T.end;
    x.save();
    x.fillStyle = '#020403';
    x.fillRect(0, 0, W, H);
    if (end) {
      x.restore();
      return;
    }
    const col = (a) => `rgba(150,255,190,${a})`;
    const fs = 16 * s,
      lh = fs * 1.6;
    const x0 = W * 0.13,
      y0 = (this.cine.bar || 0) + H * 0.08;
    x.font = `${fs}px ${MONO}`;
    x.textBaseline = 'alphabetic';
    x.shadowColor = 'rgba(80,255,150,0.6)';
    x.shadowBlur = 6 * s;
    let row = 0,
      cursor = null;
    for (const l of T.lines || []) {
      if (lt < l.t) break;
      const full = this.c3TermText(l, lt);
      const n = Math.min(this.c3TermVis(l, lt), full.length);
      let txt = full.slice(0, n);
      // 資料毀損：隨機換字、整行橫移
      let dx = 0;
      if (gl > 0) {
        const chars = [...txt];
        for (let i = 0; i < chars.length; i++)
          if (Math.random() < gl * 0.5) chars[i] = '▓▒░#%&@$'[Math.floor(Math.random() * 8)];
        txt = chars.join('');
        if (Math.random() < gl * 0.3) dx = (Math.random() - 0.5) * 60 * s * gl;
      }
      const y = y0 + row * lh;
      x.fillStyle = col(l.dim ? 0.55 : 0.92);
      if (l.warn) x.fillStyle = 'rgba(255,120,100,0.95)';
      x.fillText(txt, x0 + dx, y);
      // 塗黑：在字上蓋實心的條
      if (l.red && lt >= (l.redT || l.t + 1)) {
        const k = clamp((lt - (l.redT || l.t + 1)) / 0.35, 0, 1);
        for (const r of l.red) {
          // [起, 迄] 或要蓋掉的字串
          const a = typeof r === 'string' ? full.indexOf(r) : r[0],
            b = typeof r === 'string' ? a + r.length : r[1];
          if (a < 0) continue;
          const xa = x0 + x.measureText(full.slice(0, a)).width,
            xb = x0 + x.measureText(full.slice(0, Math.min(b, n))).width;
          if (xb <= xa) continue;
          x.shadowBlur = 0;
          x.fillStyle = col(0.95);
          x.fillRect(xa, y - fs * 0.85, (xb - xa) * k, fs * 1.05);
          x.shadowBlur = 6 * s;
        }
      }
      if (n < full.length) cursor = [x0 + x.measureText(txt).width + 2 * s, y];
      row++;
    }
    // 游標
    if (Math.floor(lt * 2.4) % 2 === 0) {
      const [cx, cy] = cursor || [x0, y0 + row * lh];
      x.fillStyle = col(0.9);
      x.fillRect(cx, cy - fs * 0.8, fs * 0.55, fs);
    }
    // 毀損的大字
    if (gl > 0.35) {
      x.textAlign = 'center';
      x.font = `700 ${34 * s}px ${MONO}`;
      x.fillStyle = `rgba(255,90,80,${Math.random() < 0.15 ? 0.3 : 0.95})`;
      x.shadowColor = 'rgba(255,40,30,0.8)';
      x.fillText('資料毀損　DATA CORRUPTED', W / 2 + (Math.random() - 0.5) * 8 * s * gl, H * 0.5);
      x.textAlign = 'left';
    }
    x.shadowBlur = 0;
    drawNoise(x, W, H, 0.05 + gl * 0.45, 0.4 + gl * 0.6);
    scanlines(x, W, H, 0.25, 3);
    // 映像管的暗角
    const vg = x.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.75)');
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);
    x.restore();
  },

  // ---------- 黑暗中的紅色眼燈 ----------
  // S.eyes＝{ a: 演員 id, t: 亮起的秒數, sep: 兩眼的間距（頭寬的比例）}
  // 光點掛在機體的頭部關節上（跟著動作），頭的大小與正面從網格量
  cineHook_c3eyes(S, phase, lt) {
    const c = this.cine;
    const E = S.eyes || {};
    if (phase === 'enter') {
      if (c.c3eyes) this.cineHook_c3eyes(S, 'exit');
      c.c3eyes = { list: [], on: false };
      return;
    }
    const Z = c.c3eyes;
    if (!Z) return;
    if (phase === 'exit') {
      for (const sp of Z.list) if (sp.parent) sp.parent.remove(sp);
      c.c3eyes = null;
      return;
    }
    const A = c.actors.get(E.a);
    const head = A && A.e && A.e.model && A.e.model.head;
    if (!head) return;
    if (!Z.list.length) {
      // 頭的外框（頭部關節的座標）：正面＝−Z
      head.updateWorldMatrix(true, true);
      const inv = new THREE.Matrix4().copy(head.matrixWorld).invert();
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      head.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const pos = o.geometry.attributes.position;
        if (!pos) return;
        const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0; i < pos.count; i += 3)
          box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
      });
      if (box.isEmpty()) box.set(new THREE.Vector3(-0.3, 0, -0.3), new THREE.Vector3(0.3, 0.6, 0.3));
      const sz = box.getSize(new THREE.Vector3());
      const cx = (box.min.x + box.max.x) / 2,
        cy = box.min.y + sz.y * 0.55,
        fz = box.min.z - 0.04;
      const sep = sz.x * (E.sep || 0.22);
      const mk = (sc, x, z) => {
        const sp = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: radialTex(),
            color: 0xff2014,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            depthTest: false,
            transparent: true,
            opacity: 0,
          }),
        );
        sp.scale.setScalar(sc);
        sp.position.set(x, cy, z);
        sp.renderOrder = 20;
        head.add(sp);
        return sp;
      };
      const r = Math.max(0.18, sz.x * 0.24);
      Z.list.push(mk(r, cx + sep, fz), mk(r, cx - sep, fz), mk(r * 6, cx, fz - 0.1));
    }
    // 亮起：閃兩下再穩定（之後慢慢呼吸）
    const d = lt - (E.t || 1);
    let k = 0;
    if (d >= 0) k = d < 0.5 ? (Math.floor(d * 12) % 3 === 0 ? 0 : 1) : 0.85 + 0.15 * Math.sin(lt * 2.2);
    if (d >= 0 && !Z.on) {
      Z.on = true;
      SFX.play('charge', 0.5, 0.35, 0.02, 0.05, null, 'ui');
    }
    for (const [i, sp] of Z.list.entries()) sp.material.opacity = k * (i === 2 ? 0.3 : 1);
  },
});
