// 第 2 章 工業帶的契約（分割畫面） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch2.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c2 開頭，避免和別章重複。
//
// 這一章的手法＝分割畫面：左半邊卡斯特隆（橘）、右半邊艾瑟立克（藍），同一時間各做各的事。
//  - c2split（render）：同一張地圖從兩個鏡頭各跑一次後處理管線（stylePipe.run → rtL／rtR，各自的調色），
//    再用自己的合成著色器依分割線拼起來；每個鏡頭以 setViewOffset 把主點移到自己那一半的中央。
//    關掉後製特效時改用 scissor／viewport 直接畫兩半。動態模糊與景深在分割時關閉（兩個鏡頭沒有共同的上一格）。
//  - c2grid（render）：監視器牆，每一格 viewport＋scissor 直接畫（不跑後處理），疊加畫布畫掃描線與斷線。
//  - c2props（hook）：劇本用的道具（貨櫃、閘門、冷卻槽、天線核心、運輸車、窗戶的燈、電磁砲彈），exit 時全部移除。
//  - 疊加：分割線與兩側的通訊字幕、碎裂、中線倒數、監視器、懸賞檔案與紅色印章、左右合上的章名。
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { SPEAKERS } from '../data/story.js';
import { buildTransport } from '../render/extra-models.js';
import { Game } from './game.js';

const D2R = Math.PI / 180;
const ORANGE = '#f0a050',
  BLUE = '#62c0ff';
const smooth = (x) => x * x * (3 - 2 * x);
const MONO = '"Share Tech Mono", monospace',
  SANS = '"Noto Sans TC", sans-serif';

// 數值或關鍵影格 [{ t, v }]（平滑）
function kv(k, t, def = 0) {
  if (k == null) return def;
  if (typeof k === 'number') return k;
  if (!k.length) return def;
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i],
      b = k[i + 1];
    if (t < b.t) return lerp(a.v, b.v, smooth((t - a.t) / Math.max(1e-3, b.t - a.t)));
  }
  return k[k.length - 1].v;
}
// 固定種子的亂數（碎片、雜訊的位置每次相同）
function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
// 中文逐字換行
function wrap(x, text, maxW) {
  const out = [];
  let line = '';
  for (const ch of text) {
    if (x.measureText(line + ch).width > maxW && line) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}
const tc = (t) => {
  const f = Math.floor((t % 1) * 24),
    s = Math.floor(t);
  return `14:${String(2 + Math.floor((s + 37) / 60)).padStart(2, '0')}:${String((s + 37) % 60).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
};

// 分割合成：左＝tA、右＝tB，各自的亮度（說話的那一邊亮）；分割線是一條暗縫
const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }
`;
const SPLIT_FRAG = /* glsl */ `
uniform sampler2D tA, tB;
uniform float split, gap;
uniform vec2 dim;
varying vec2 vUv;
void main() {
	vec3 c = vUv.x < split ? texture2D( tA, vUv ).rgb * dim.x : texture2D( tB, vUv ).rgb * dim.y;
	if ( abs( vUv.x - split ) < gap ) c = vec3( 0.012, 0.012, 0.016 );
	gl_FragColor = vec4( c, 1.0 );
}
`;

Object.assign(Game.prototype, {
  // ---------- 鏡頭 ----------
  // 點：cinePt 的寫法，另外 { c2ex: 出口, back, side, h }＝從玩家往出口的方向（back＝往玩家那側退幾公尺）
  c2Pt(p, out = new THREE.Vector3()) {
    if (p && p.c2ex !== undefined) {
      const E = this.cinePt({ ex: p.c2ex }, new THREE.Vector3());
      const P0 = this.cinePt({ a: 'player', at: 'base' }, new THREE.Vector3());
      const d = new THREE.Vector3(E.x - P0.x, 0, E.z - P0.z);
      if (d.lengthSq() < 1e-4) d.set(0, 0, -1);
      d.normalize();
      const base = p.from === 'player' ? P0 : E;
      return out
        .copy(base)
        .addScaledVector(d, -(p.back || 0))
        .add(new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(p.side || 0))
        .setY(base.y + (p.h || 0));
    }
    return this.cinePt(p, out);
  },
  // 依劇本的 cam（keys 的 p／l／fov／roll）擺好 this.camera（不晃動：這一章的鏡頭一律固定或等速）
  c2Pose(spec, lt, aspect) {
    const c = this.cine,
      cam = this.camera;
    const keys = (spec && spec.keys) || [{ t: 0, p: [0, 5, 20], l: [0, 2, 0] }];
    let i = 0;
    while (i < keys.length - 1 && keys[i + 1].t <= lt) i++;
    const a = keys[i],
      b = keys[Math.min(i + 1, keys.length - 1)];
    const u = b === a ? 0 : clamp((lt - a.t) / (b.t - a.t), 0, 1);
    const e = spec.ease === 'lin' ? u : smooth(u);
    const pos = this.c2Pt(a.p).lerp(this.c2Pt(b.p), e);
    const look = this.c2Pt(a.l).lerp(this.c2Pt(b.l), e);
    if (this.world && !spec.free) {
      const gh = this.world.terrainHeight(pos.x, pos.z);
      if (pos.y < gh + 0.8) pos.y = gh + 0.8;
    }
    // 機械的震動（閘門關上、起重機放下）：只有 c.shake，沒有手持晃動
    const sh = c.shake || 0;
    if (sh > 0) {
      pos.x += (Math.random() * 2 - 1) * sh * 0.12;
      pos.y += (Math.random() * 2 - 1) * sh * 0.12;
    }
    cam.position.copy(pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(look);
    const roll = lerp(a.roll || 0, b.roll || 0, e);
    if (roll) cam.rotateZ(roll * D2R);
    cam.fov = lerp(a.fov || spec.fov || 40, b.fov || spec.fov || 40, e);
    cam.aspect = aspect || innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // 太陽與陰影跟著這個鏡頭的注視點
    this.sun.position.copy(look).add(this.sunOff);
    this.sun.target.position.copy(look);
    this.sun.target.updateMatrixWorld();
    return look;
  },
  c2State() {
    const c = this.cine;
    if (!c.c2) c.c2 = { cams: [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()], sp: 0.5 };
    return c.c2;
  },

  // ---------- 分割畫面 ----------
  // S.cam＝左半邊、S.camR＝右半邊；S.gradeL／gradeR＝各自的調色；S.split＝分割線的位置（0～1，數值或 [{ t, v }]）；
  // S.dimL／dimR＝亮度（說話的那一邊亮）
  cineRender_c2split(S, lt) {
    const c = this.cine,
      R = this.renderer,
      pipe = this.stylePipe,
      cam = this.camera;
    const W = innerWidth,
      H = innerHeight,
      t = performance.now() / 1000;
    const st = this.c2State();
    if (this.world && this.world.weather) this.world.weather.update(cam, t, R.getPixelRatio());
    const sp = clamp(kv(S.split, lt, 0.5), 0, 1);
    st.sp = sp;
    const post = this.post.enabled && this.post.ok;
    const sides = [
      [S.camL || S.cam, S.gradeL, 0, sp * W],
      [S.camR || S.cam, S.gradeR, sp * W, W],
    ];
    if (!post) {
      R.setScissorTest(true);
      R.setScissor(0, 0, W, H);
      R.setClearColor(0x000000);
      R.clear();
    }
    sides.forEach(([spec, gr, x0, x1], i) => {
      const w = x1 - x0;
      if (w < 2) return;
      const P = { ...c.P, ...(gr || {}), mblur: false, dof: 0, ssao: 0 };
      if (post) {
        this.c2Pose(spec, lt, W / H);
        cam.setViewOffset(W, H, W / 2 - (x0 + x1) / 2, 0, W, H);
        cam.updateProjectionMatrix();
        st.cams[i].copy(cam);
        // 每一半只畫自己的像素：管線裡同尺寸的目標都設 scissor（SSAO 關掉；Bloom 的縮小圖不設，只影響接縫附近的光暈）
        const out = i ? pipe.rtR : pipe.rtL;
        const pr = R.getPixelRatio();
        const tg = [pipe.rtScene, pipe.rtA, pipe.rtB, out];
        for (const q of tg) {
          q.scissor.set(Math.floor(x0 * pr), 0, Math.ceil(w * pr) + 1, Math.ceil(H * pr));
          q.scissorTest = true;
        }
        try {
          pipe.run(P, out, t);
        } finally {
          for (const q of tg) q.scissorTest = false;
        }
        cam.clearViewOffset();
      } else {
        this.c2Pose(spec, lt, w / H);
        st.cams[i].copy(cam);
        pipe.applyScene(P, t);
        R.setRenderTarget(null);
        R.setViewport(x0, 0, w, H);
        R.setScissor(x0, 0, w, H);
        R.render(this.scene, cam);
      }
    });
    if (post) {
      if (!this.c2q) {
        const m = new THREE.ShaderMaterial({
          uniforms: {
            tA: { value: null },
            tB: { value: null },
            split: { value: 0.5 },
            gap: { value: 0.002 },
            dim: { value: new THREE.Vector2(1, 1) },
          },
          vertexShader: VERT,
          fragmentShader: SPLIT_FRAG,
          depthTest: false,
          depthWrite: false,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
        mesh.frustumCulled = false;
        this.c2q = { m, mesh };
      }
      const u = this.c2q.m.uniforms;
      u.tA.value = pipe.rtL.texture;
      u.tB.value = pipe.rtR.texture;
      u.split.value = sp;
      u.gap.value = sp > 0.002 && sp < 0.998 && !(S.shatter != null && lt >= S.shatter) ? 3 / W : 0;
      u.dim.value.set(kv(S.dimL, lt, 1), kv(S.dimR, lt, 1));
      pipe.draw(this.c2q, null);
    } else {
      R.setViewport(0, 0, W, H);
      R.setScissor(0, 0, W, H);
      R.setScissorTest(false);
    }
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    R.setRenderTarget(null);
    pipe.resetHistory();
  },
  // 分割線、兩邊的標籤與同一個時間碼、兩側的通訊字幕（S.side：[{ t, s: 'L'|'R', who, text, d }]）、碎裂（S.shatter）
  cineOv_c2split(x, W, H, lt, S) {
    const c = this.cine,
      st = this.c2State();
    const s = H / 720,
      bar = c.bar || 0;
    const sp = clamp(kv(S.split, lt, 0.5), 0, 1);
    const X = sp * W;
    const broken = S.shatter != null && lt >= S.shatter;
    x.save();
    // 分割線：左緣橘、右緣藍
    if (!broken && sp > 0.002 && sp < 0.998) {
      x.globalAlpha = 0.9;
      x.fillStyle = ORANGE;
      x.fillRect(X - 3.5, bar, 1.2, H - bar * 2);
      x.fillStyle = BLUE;
      x.fillRect(X + 2.3, bar, 1.2, H - bar * 2);
      // 中央的接縫記號
      x.fillStyle = 'rgba(230,236,242,0.8)';
      for (const yy of [0.25, 0.5, 0.75]) x.fillRect(X - 6 * s, bar + (H - bar * 2) * yy, 12 * s, 1.5);
    }
    // 兩邊的標籤：委託方與同一個時間碼（同一時間各做各的事）
    const top = bar + 14 * s;
    const lab = (txt, col, xx, al) => {
      x.font = `${11 * s}px ${MONO}`;
      x.textAlign = al;
      x.fillStyle = col;
      x.fillText(txt, xx, top + 10 * s);
      x.fillStyle = 'rgba(220,226,232,0.75)';
      x.fillText(tc(c.t), xx, top + 24 * s);
    };
    if (S.labels !== false) {
      x.globalAlpha = 0.95;
      if (X > 120 * s) lab('■ CASTRON HEAVY INDUSTRIES', ORANGE, 18 * s, 'left');
      if (W - X > 120 * s) lab('AETHERIC RESEARCH ■', BLUE, W - 18 * s, 'right');
    }
    // 兩側的通訊字幕（互相蓋過：兩句可以同時在畫面上）
    for (const L of S.side || []) {
      if (lt < L.t || lt > L.t + (L.d || 3)) continue;
      const key = c.shot + ':' + L.t + L.s;
      if (!st.fired) st.fired = new Set();
      if (!st.fired.has(key)) {
        st.fired.add(key);
        SFX.radio();
      }
      const left = L.s === 'L';
      const x0 = left ? 0 : X,
        x1 = left ? X : W;
      if (x1 - x0 < 160 * s) continue;
      const a = clamp(Math.min((lt - L.t) / 0.15, (L.t + (L.d || 3) - lt) / 0.3), 0, 1);
      const sp2 = SPEAKERS[L.who] || {};
      const name = sp2.name ? sp2.name.replace(/（.*）/, '') : '';
      x.globalAlpha = a;
      x.font = `500 ${15 * s}px ${SANS}`;
      const maxW = Math.min(x1 - x0 - 48 * s, 420 * s);
      const lines = wrap(x, L.text, maxW);
      const bx = left ? x0 + 22 * s : x1 - 22 * s - maxW;
      const by = top + 40 * s;
      const hgt = (lines.length * 21 + 30) * s;
      x.fillStyle = 'rgba(4,6,8,0.62)';
      x.fillRect(bx - 10 * s, by, maxW + 20 * s, hgt);
      x.fillStyle = left ? ORANGE : BLUE;
      x.fillRect(left ? bx - 10 * s : bx + maxW + 8 * s, by, 2 * s, hgt);
      x.textAlign = 'left';
      x.font = `700 ${12 * s}px ${SANS}`;
      x.fillStyle = sp2.color || '#ffffff';
      x.fillText(name, bx, by + 17 * s);
      // 聲紋
      x.fillStyle = sp2.color || '#ffffff';
      for (let k = 0; k < 18; k++) {
        const hh = (2 + Math.abs(Math.sin(c.t * 13 + k * 1.7) * Math.sin(c.t * 5.3 + k)) * 7) * s;
        x.fillRect(bx + maxW - (18 - k) * 4 * s, by + 12 * s - hh / 2, 2 * s, hh);
      }
      x.font = `500 ${15 * s}px ${SANS}`;
      x.fillStyle = 'rgba(240,244,248,0.96)';
      lines.forEach((ln, k) => x.fillText(ln, bx, by + (38 + k * 21) * s));
    }
    // 碎裂：分割線碎成玻璃片往兩邊飛
    if (broken) {
      const k = lt - S.shatter;
      if (k < 1.4) {
        const r = prng(77);
        const g = 900 * s;
        for (let i = 0; i < 26; i++) {
          const y0 = bar + r() * (H - bar * 2);
          const dir = r() < 0.5 ? -1 : 1;
          const vx = dir * (150 + r() * 650) * s,
            vy = (r() - 0.6) * 320 * s;
          const px = X + vx * k,
            py = y0 + vy * k + 0.5 * g * k * k;
          const sz = (10 + r() * 34) * s;
          const rot = (r() - 0.5) * 9 * k + r() * 6;
          x.globalAlpha = clamp(1 - k / 1.3, 0, 1) * 0.9;
          x.save();
          x.translate(px, py);
          x.rotate(rot);
          x.beginPath();
          x.moveTo(-sz * 0.4, -sz * 0.6);
          x.lineTo(sz * (0.2 + r() * 0.4), -sz * 0.2);
          x.lineTo(-sz * 0.1, sz * (0.4 + r() * 0.5));
          x.closePath();
          x.fillStyle = i % 2 ? 'rgba(240,160,80,0.35)' : 'rgba(98,192,255,0.35)';
          x.fill();
          x.strokeStyle = 'rgba(255,255,255,0.9)';
          x.lineWidth = 1.2;
          x.stroke();
          x.restore();
        }
        // 裂開的那一瞬間：中線的白光
        if (k < 0.25) {
          x.globalAlpha = 1 - k / 0.25;
          const gr = x.createLinearGradient(X - 60 * s, 0, X + 60 * s, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0)');
          gr.addColorStop(0.5, 'rgba(255,255,255,1)');
          gr.addColorStop(1, 'rgba(255,255,255,0)');
          x.fillStyle = gr;
          x.fillRect(X - 60 * s, bar, 120 * s, H - bar * 2);
        }
      }
    }
    x.restore();
  },
  // 抉擇的選前：中線就是倒數條（由上往下流光），兩邊的出口名牌（各自的鏡頭投影）
  cineOv_c2count(x, W, H, lt, S) {
    const c = this.cine,
      st = this.c2State();
    const s = H / 720,
      bar = c.bar || 0;
    const X = st.sp * W;
    const k = clamp(1 - c.t / Math.max(0.1, c.def.dur - 0.3), 0, 1);
    x.save();
    const y0 = bar + 46 * s,
      y1 = H - bar - 20 * s;
    x.fillStyle = 'rgba(0,0,0,0.7)';
    x.fillRect(X - 6 * s, y0, 12 * s, y1 - y0);
    const red = k < 0.25;
    const pulse = red ? 0.6 + Math.sin(c.t * 18) * 0.4 : 1;
    x.globalAlpha = pulse;
    x.fillStyle = red ? 'rgba(255,70,60,0.95)' : 'rgba(255,214,150,0.95)';
    const fh = (y1 - y0) * k;
    x.fillRect(X - 4 * s, y1 - fh, 8 * s, fh);
    x.globalAlpha = 1;
    x.font = `${12 * s}px ${MONO}`;
    x.textAlign = 'center';
    x.fillStyle = red ? 'rgba(255,110,100,1)' : 'rgba(255,214,150,0.95)';
    x.fillText('DECISION REQUIRED', X, bar + 22 * s);
    x.font = `700 ${20 * s}px ${MONO}`;
    x.fillText(Math.max(0, c.def.dur - 0.3 - c.t).toFixed(1), X, bar + 42 * s);
    x.restore();
  },
  // 黑畫面的開場：中線由上往下畫出來，左右的委託方標籤（S.open＝{ win: 'L'|'R' } 時一邊亮、一邊熄）
  cineOv_c2open(x, W, H, lt, S) {
    const s = H / 720,
      bar = this.cine.bar || 0;
    const O = S.open || {};
    x.save();
    const k = smooth(clamp((lt - (O.t0 || 0.2)) / 0.7, 0, 1));
    const y0 = bar,
      y1 = H - bar;
    x.fillStyle = 'rgba(235,238,242,0.9)';
    x.fillRect(W / 2 - 0.75, y0, 1.5, (y1 - y0) * k);
    const lab = (txt, sub, col, side, at, out) => {
      let a = clamp((lt - at) / 0.3, 0, 1);
      if (out != null) a *= 1 - clamp((lt - out) / 0.4, 0, 0.8);
      x.globalAlpha = a;
      x.textAlign = side < 0 ? 'right' : 'left';
      const xx = W / 2 + side * 28 * s;
      x.font = `700 ${22 * s}px ${MONO}`;
      x.fillStyle = col;
      x.fillText(txt, xx, H / 2 - 4 * s);
      x.font = `${13 * s}px ${SANS}`;
      x.fillStyle = 'rgba(220,226,232,0.85)';
      x.fillText(sub, xx, H / 2 + 20 * s);
    };
    lab('CASTRON', '卡斯特隆重工', ORANGE, -1, O.a || 1.0, O.win === 'R' ? O.out : null);
    lab('AETHERIC', '艾瑟立克研究機構', BLUE, 1, O.b || 1.5, O.win === 'L' ? O.out : null);
    if (O.cap) {
      x.globalAlpha = clamp((lt - (O.capT || 1.8)) / 0.4, 0, 1);
      x.textAlign = 'center';
      x.font = `${12 * s}px ${MONO}`;
      x.fillStyle = 'rgba(220,226,232,0.8)';
      x.fillText(O.cap, W / 2, H - bar - 40 * s);
    }
    x.restore();
  },
  // 章名：左右兩扇門合上，章名分成兩半跟著門走（S.title＝{ a: 章名, s: 副標, close: 秒 }）
  cineOv_c2title(x, W, H, lt, S) {
    const T = S.title || {};
    const s = H / 720;
    const close = T.close || 1.1;
    const k = lt < (T.t0 || 0) ? 0 : smooth(clamp((lt - (T.t0 || 0)) / close, 0, 1));
    const d = (W / 2) * k; // 每扇門蓋住的寬度
    x.save();
    const door = (x0, w, c0, c1, edge) => {
      const g = x.createLinearGradient(x0, 0, x0 + w, 0);
      g.addColorStop(0, c0);
      g.addColorStop(1, c1);
      x.fillStyle = g;
      x.fillRect(x0, 0, w, H);
      x.fillStyle = edge;
      x.fillRect(edge === ORANGE ? x0 + w - 3 * s : x0, 0, 3 * s, H);
    };
    door(0, d, '#0c0703', '#2a1606', ORANGE);
    door(W - d, d, '#08121e', '#030810', BLUE);
    // 章名：整句置中，左半邊跟著左門、右半邊跟著右門
    const off = W / 2 - d;
    x.font = `700 ${46 * s}px ${SANS}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const draw = (dx, clip0, clip1, col) => {
      x.save();
      x.beginPath();
      x.rect(clip0, 0, clip1 - clip0, H);
      x.clip();
      x.fillStyle = col;
      x.fillText(T.a || '', W / 2 + dx, H / 2 - 10 * s);
      x.restore();
    };
    x.globalAlpha = clamp(k * 3, 0, 1);
    draw(-off, 0, d, '#ffd2a0');
    draw(off, W - d, W, '#cfe8ff');
    // 合上的瞬間：接縫的白光、副標
    if (k >= 1) {
      const lt2 = lt - (T.t0 || 0) - close;
      x.globalAlpha = clamp(1 - lt2 / 0.5, 0, 1);
      x.fillStyle = '#ffffff';
      x.fillRect(W / 2 - 2 * s, 0, 4 * s, H);
      x.globalAlpha = clamp((lt2 - 0.3) / 0.5, 0, 1);
      x.font = `${14 * s}px ${MONO}`;
      x.fillStyle = 'rgba(230,234,240,0.9)';
      x.fillText(T.s || '', W / 2, H / 2 + 34 * s);
      x.fillStyle = 'rgba(230,234,240,0.5)';
      x.fillRect(W / 2 - 120 * s, H / 2 + 18 * s, 240 * s, 1);
    }
    x.restore();
  },

  // ---------- 監視器 ----------
  // 監視器牆：S.cells＝[{ cam, label, die（這一鏡的第幾秒斷線）}]，S.cols／rows
  c2GridRects(S, W, H) {
    const cols = S.cols || 3,
      rows = S.rows || 2;
    const m = 18 * (H / 720),
      g = 6 * (H / 720);
    const top = (this.cine.bar || 0) + m,
      bot = H - (this.cine.bar || 0) - m - (S.subRoom == null ? 44 : S.subRoom) * (H / 720);
    const cw = (W - m * 2 - g * (cols - 1)) / cols,
      ch = (bot - top - g * (rows - 1)) / rows;
    return (S.cells || []).map((cell, i) => ({
      x: m + (i % cols) * (cw + g),
      y: top + Math.floor(i / cols) * (ch + g),
      w: cw,
      h: ch,
      cell,
    }));
  },
  cineRender_c2grid(S, lt) {
    const c = this.cine,
      R = this.renderer,
      pipe = this.stylePipe,
      cam = this.camera;
    const W = innerWidth,
      H = innerHeight,
      t = performance.now() / 1000;
    const st = this.c2State();
    st.gcams = st.gcams || [];
    R.setRenderTarget(null);
    R.setScissorTest(true);
    R.setViewport(0, 0, W, H);
    R.setScissor(0, 0, W, H);
    R.setClearColor(0x030405);
    R.clear();
    const P = { ...c.P, mblur: false, dof: 0 };
    let first = true;
    const au = R.shadowMap.autoUpdate;
    for (const [i, r] of this.c2GridRects(S, W, H).entries()) {
      const die = r.cell.die;
      if (die != null && lt > die + 0.05) continue;
      this.c2Pose(r.cell.cam, lt, r.w / r.h);
      if (first) pipe.applyScene(P, t);
      // 陰影圖只在第一格更新（每一格都更新太慢）
      R.shadowMap.autoUpdate = first;
      first = false;
      const y = H - r.y - r.h;
      R.setViewport(r.x, y, r.w, r.h);
      R.setScissor(r.x, y, r.w, r.h);
      R.render(this.scene, cam);
      st.gcams[i] = st.gcams[i] || new THREE.PerspectiveCamera();
      st.gcams[i].copy(cam);
    }
    R.shadowMap.autoUpdate = au;
    R.setViewport(0, 0, W, H);
    R.setScissor(0, 0, W, H);
    R.setScissorTest(false);
    cam.aspect = W / H;
    cam.updateProjectionMatrix();
    pipe.resetHistory();
  },
  // 監視器畫面的質感：一格（x0, y0, w, h）的掃描線、綠色的濾鏡、REC、標籤與時間碼；die 之後雜訊 → NO SIGNAL
  c2Feed(x, x0, y0, w, h, label, lt, die, s, big) {
    const c = this.cine;
    x.save();
    x.beginPath();
    x.rect(x0, y0, w, h);
    x.clip();
    const dead = die != null && lt >= die;
    if (!dead) {
      x.fillStyle = 'rgba(40,90,70,0.16)';
      x.fillRect(x0, y0, w, h);
      x.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = y0; y < y0 + h; y += 3) x.fillRect(x0, y, w, 1);
      const sy = y0 + ((c.t * 0.3 + x0 * 0.001) % 1) * h;
      x.fillStyle = 'rgba(200,255,220,0.05)';
      x.fillRect(x0, sy, w, 10 * s);
      // 四角的暗角
      const g = x.createRadialGradient(
        x0 + w / 2,
        y0 + h / 2,
        Math.min(w, h) * 0.3,
        x0 + w / 2,
        y0 + h / 2,
        Math.max(w, h) * 0.7,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      x.fillStyle = g;
      x.fillRect(x0, y0, w, h);
    } else {
      const k = lt - die;
      // 斷線：先是一條白色的橫線收起來，接著雜訊，最後只剩 NO SIGNAL
      x.fillStyle = '#030405';
      x.fillRect(x0, y0, w, h);
      if (k < 0.18) {
        const hh = h * (1 - k / 0.18) * 0.5;
        x.fillStyle = 'rgba(230,255,240,0.85)';
        x.fillRect(x0, y0 + h / 2 - hh / 2, w, Math.max(2, hh));
      } else if (k < 0.9) {
        for (let i = 0; i < 260; i++) {
          const v = Math.floor(Math.random() * 200);
          x.fillStyle = `rgba(${v},${v},${v},0.8)`;
          x.fillRect(
            x0 + Math.random() * w,
            y0 + Math.random() * h,
            (2 + Math.random() * 6) * s,
            (1 + Math.random() * 2) * s,
          );
        }
      }
      if (k >= 0.6) {
        x.globalAlpha = 0.55 + 0.45 * Math.round(Math.sin(c.t * 4) * 0.5 + 0.5);
        x.textAlign = 'center';
        x.font = `${(big ? 22 : 14) * s}px ${MONO}`;
        x.fillStyle = 'rgba(220,226,232,0.85)';
        x.fillText('NO SIGNAL', x0 + w / 2, y0 + h / 2);
        x.font = `${(big ? 13 : 10) * s}px ${SANS}`;
        x.fillStyle = 'rgba(220,226,232,0.55)';
        x.fillText('訊號中斷', x0 + w / 2, y0 + h / 2 + (big ? 22 : 16) * s);
        x.globalAlpha = 1;
      }
    }
    // 標籤、REC、時間碼
    x.textAlign = 'left';
    x.font = `${(big ? 14 : 11) * s}px ${MONO}`;
    x.fillStyle = 'rgba(225,235,228,0.9)';
    x.fillText(label || '', x0 + 10 * s, y0 + (big ? 22 : 17) * s);
    x.textAlign = 'right';
    x.fillText(tc(c.t + x0 * 0.01), x0 + w - 10 * s, y0 + h - 10 * s);
    if (!dead && Math.sin(c.t * 5) > -0.2) {
      x.fillStyle = '#ff3a30';
      x.beginPath();
      x.arc(x0 + w - 44 * s, y0 + 15 * s, 4 * s, 0, Math.PI * 2);
      x.fill();
      x.fillStyle = 'rgba(255,120,110,0.95)';
      x.fillText('REC', x0 + w - 10 * s, y0 + (big ? 22 : 19) * s);
    }
    x.restore();
    x.strokeStyle = 'rgba(150,170,160,0.35)';
    x.lineWidth = 1;
    x.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  },
  cineOv_c2grid(x, W, H, lt, S) {
    const s = H / 720;
    const st = this.c2State();
    st.gfired = st.gfired || new Set();
    for (const r of this.c2GridRects(S, W, H)) {
      const die = r.cell.die;
      // 斷線的聲音
      const key = this.cine.shot + ':' + r.cell.label;
      if (die != null && lt >= die && lt < die + 0.5 && !st.gfired.has(key)) {
        st.gfired.add(key);
        SFX.play('glitch', 0.5, 0.7, 0.05, 0, null, 'ui');
      }
      this.c2Feed(x, r.x, r.y, r.w, r.h, r.cell.label, lt, die, s, false);
    }
  },
  // 單一監視器畫面（全畫面）：S.feed＝{ label, die }
  cineOv_c2cctv(x, W, H, lt, S) {
    const s = H / 720,
      bar = this.cine.bar || 0;
    const F = S.feed || {};
    const st = this.c2State();
    st.gfired = st.gfired || new Set();
    const key = this.cine.shot + ':feed';
    if (F.die != null && lt >= F.die && !st.gfired.has(key)) {
      st.gfired.add(key);
      SFX.play('glitch', 0.7, 0.5, 0.05, 0, null, 'ui');
    }
    this.c2Feed(x, 0, bar, W, H - bar * 2, F.label, lt, F.die, s, true);
  },

  // ---------- 懸賞檔案 ----------
  // S.doc＝{ t0（全片的秒數：紙出現）, lines: [[秒, 文字, 樣式]], stamp: 秒, center: 秒（移到畫面中央） }；時間都是全片的時間，
  // 所以同一份檔案可以跨好幾個鏡頭逐行印下去
  cineOv_c2bounty(x, W, H, lt, S) {
    const D = S.doc;
    if (!D) return;
    const c = this.cine,
      T = c.t;
    const s = H / 720,
      bar = c.bar || 0;
    const st = this.c2State();
    st.bfired = st.bfired || new Set();
    const cen = D.center != null ? smooth(clamp((T - D.center) / 0.8, 0, 1)) : 0;
    const pw = 340 * s * (1 + cen * 0.18),
      ph = Math.min(H - bar * 2 - 40 * s, 470 * s) * (1 + cen * 0.06);
    const slide = smooth(clamp((T - D.t0) / 0.6, 0, 1));
    const px = lerp(W + 20 * s, lerp(W - pw - 60 * s, W * (D.cx == null ? 0.5 : D.cx) - pw / 2, cen), slide);
    const py = lerp(bar + 24 * s, (H - ph) / 2 - 20 * s, cen);
    x.save();
    x.translate(px + pw / 2, py + ph / 2);
    x.rotate(lerp(1.6, -0.6, cen) * D2R);
    x.translate(-pw / 2, -ph / 2);
    // 紙
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.fillRect(8 * s, 10 * s, pw, ph);
    x.fillStyle = '#e9e4d6';
    x.fillRect(0, 0, pw, ph);
    x.fillStyle = '#1c1a16';
    x.fillRect(0, 0, pw, 44 * s);
    x.fillStyle = ORANGE;
    x.fillRect(0, 44 * s, pw, 3 * s);
    x.textAlign = 'left';
    x.font = `700 ${13 * s}px ${MONO}`;
    x.fillStyle = ORANGE;
    x.fillText('CASTRON HEAVY INDUSTRIES', 16 * s, 19 * s);
    x.font = `${11 * s}px ${SANS}`;
    x.fillStyle = '#d8d2c4';
    x.fillText('卡斯特隆重工　保安部　懸賞令', 16 * s, 35 * s);
    // 照片欄
    const fx0 = pw - 112 * s,
      fy0 = 62 * s;
    x.fillStyle = '#c9c3b4';
    x.fillRect(fx0, fy0, 96 * s, 112 * s);
    x.fillStyle = '#5a5850';
    x.beginPath();
    x.arc(fx0 + 48 * s, fy0 + 40 * s, 16 * s, 0, Math.PI * 2);
    x.fill();
    x.fillRect(fx0 + 22 * s, fy0 + 60 * s, 52 * s, 40 * s);
    x.font = `${9 * s}px ${MONO}`;
    x.fillStyle = '#3a3830';
    x.textAlign = 'center';
    x.fillText('NO IMAGE', fx0 + 48 * s, fy0 + 108 * s);
    // 逐行列印（每行一個印表機的聲音）
    x.textAlign = 'left';
    let y = 72 * s;
    D.lines.forEach(([t, text, sty], i) => {
      if (T < t) return;
      const key = 'L' + i;
      if (!st.bfired.has(key) && T - t < 0.5) {
        st.bfired.add(key);
        SFX.play('uiTick', 0.6, 0.6, 0.05, 0, null, 'ui');
        SFX.play('clatter1', 0.25, 1.6, 0.05, 0, null, 'ui');
      }
      const n = Math.floor(clamp((T - t) / 0.45, 0, 1) * text.length);
      const big = sty === 'big';
      x.font = big ? `700 ${20 * s}px ${SANS}` : `${12.5 * s}px ${SANS}`;
      x.fillStyle = sty === 'dim' ? '#6a665c' : '#1c1a16';
      const maxW = (y < 180 * s ? pw - 140 * s : pw - 32 * s) - 0;
      const lines = wrap(x, text.slice(0, n), maxW);
      for (const ln of lines) {
        x.fillText(ln, 16 * s, y);
        y += (big ? 28 : 19) * s;
      }
      if (sty === 'rule') {
        x.fillStyle = '#9a9488';
        x.fillRect(16 * s, y - 7 * s, pw - 32 * s, 1);
      }
    });
    // 紅色印章
    if (D.stamp != null && T >= D.stamp) {
      const k = clamp((T - D.stamp) / 0.12, 0, 1);
      const sc = lerp(2.4, 1, k);
      x.save();
      x.translate(pw * 0.48, ph * 0.66);
      x.rotate(-14 * D2R);
      x.scale(sc, sc);
      x.globalAlpha = 0.25 + 0.65 * k;
      x.strokeStyle = '#c8202a';
      x.lineWidth = 5 * s;
      x.strokeRect(-122 * s, -46 * s, 244 * s, 92 * s);
      x.lineWidth = 1.5 * s;
      x.strokeRect(-114 * s, -38 * s, 228 * s, 76 * s);
      x.fillStyle = '#c8202a';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.font = `900 ${40 * s}px ${SANS}`;
      x.fillText('懸賞中', 0, -6 * s);
      x.font = `700 ${13 * s}px ${MONO}`;
      x.fillText('WANTED — DEAD OR ALIVE', 0, 26 * s);
      x.restore();
    }
    x.restore();
  },

  // ---------- 道具 ----------
  // S.props：[{ id, k: 'box'|'tank'|'core'|'truck'|'facade'|'slug', p（cinePt 的點）, size, color, yaw, keys: [{ t, o: [dx, dy, dz] }], … }]
  cineHook_c2props(S, phase, lt) {
    const c = this.cine;
    if (phase === 'enter') {
      this.c2PropsClear();
      c.c2props = (S.props || []).map((sp) => this.c2PropMake(sp));
      if (S.water != null && this.world && this.world.waterMesh) c.c2water = this.world.waterMesh.position.y;
      return;
    }
    if (phase === 'exit') {
      this.c2PropsClear();
      return;
    }
    for (const P of c.c2props || []) this.c2PropTick(P, lt);
    // 水面高度（下游的河道乾涸）：S.water＝[{ t, v（相對原本的高度）}]
    if (S.water != null && this.world && this.world.waterMesh && c.c2water != null)
      this.world.waterMesh.position.y = c.c2water + kv(S.water, lt, 0);
  },
  c2PropsClear() {
    const c = this.cine;
    if (!c) return;
    for (const P of c.c2props || []) {
      if (P.obj.parent) P.obj.parent.remove(P.obj);
      P.obj.traverse((o) => {
        if (o.geometry && !o.userData.shared) o.geometry.dispose();
      });
      if (P.lampGeo) P.lampGeo.dispose();
      if (P.trail) {
        this.scene.remove(P.trail);
        P.trail.geometry.dispose();
      }
    }
    c.c2props = [];
    if (c.c2water != null && this.world && this.world.waterMesh) this.world.waterMesh.position.y = c.c2water;
    c.c2water = null;
  },
  c2PropMake(sp) {
    const mat = (col, o = {}) =>
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, metalness: 0.25, ...o });
    const g = new THREE.Group();
    const P = { spec: sp, obj: g, lamps: [] };
    const sz = sp.size || [6, 2.6, 2.4];
    if (sp.k === 'box') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sz[0], sz[1], sz[2]), mat(sp.color || 0xb86a2a));
      m.position.y = sz[1] / 2;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      // 貨櫃的肋條／閘門的橫肋
      const rib = mat(sp.rib || 0x2a2622);
      const n = sp.ribs || 0;
      for (let i = 0; i < n; i++) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(sz[0] + 0.06, sp.ribH || 0.18, sz[2] + 0.06), rib);
        r.position.y = ((i + 0.5) / n) * sz[1];
        g.add(r);
      }
      if (sp.stripe) {
        const st = new THREE.Mesh(
          new THREE.BoxGeometry(sz[0] + 0.05, 0.5, sz[2] + 0.05),
          mat(0xe0a020, { emissive: 0x402800 }),
        );
        st.position.y = 0.3;
        g.add(st);
      }
    } else if (sp.k === 'tank') {
      // 冷卻槽：半透明的外殼＋水位（發光的藍）＋鋼環
      const r = sp.r || 4,
        h = sp.h || 8;
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, h, 28, 1, true),
        mat(0x9ab8cc, { transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      );
      shell.position.y = h / 2;
      g.add(shell);
      const water = new THREE.Mesh(
        new THREE.CylinderGeometry(r * 0.96, r * 0.96, 1, 28),
        mat(0x3aa0ff, { emissive: 0x2a7acc, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 }),
      );
      g.add(water);
      P.water = water;
      P.h = h;
      const steel = mat(0x46525c, { metalness: 0.6 });
      for (let i = 0; i <= 3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.14, 6, 32), steel);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = (i / 3) * h;
        g.add(ring);
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, h, 0.4), steel);
        leg.position.set(Math.cos(a) * (r + 0.2), h / 2, Math.sin(a) * (r + 0.2));
        g.add(leg);
      }
    } else if (sp.k === 'core') {
      // 天線核心：發光的膠囊＋外框
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 1.6, 16),
        new THREE.MeshStandardMaterial({ color: 0x9fe8ff, emissive: 0x5ab8ff, emissiveIntensity: 2.2 }),
      );
      core.position.y = 0.9;
      g.add(core);
      const fr = mat(0x30363c, { metalness: 0.7 });
      for (const y of [0.05, 1.75]) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.2, 1.5), fr);
        b.position.y = y;
        g.add(b);
      }
    } else if (sp.k === 'truck') {
      g.add(buildTransport('truck', sp.cars || 2, 8.5));
    } else if (sp.k === 'facade') {
      // 建築的正面＋窗戶的燈：on＝[開始, 間隔]（一盞一盞亮）、off＝[開始, 間隔]（一盞一盞熄）
      const [w, h, d] = sz;
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        mat(sp.color || 0x2a2c30, { roughness: 0.9 }),
      );
      wall.position.y = h / 2;
      wall.castShadow = wall.receiveShadow = true;
      g.add(wall);
      const cols = sp.cols || 8,
        rows = sp.rows || 3;
      const geo = new THREE.PlaneGeometry((w / cols) * 0.5, (h / rows) * 0.42);
      const r = prng(sp.seed || 5);
      const order = [];
      for (let i = 0; i < cols * rows; i++) order.push([r(), i]);
      order.sort((a, b) => a[0] - b[0]);
      const col = sp.lamp || 0xffb060;
      for (const [, i] of order) {
        const m = new THREE.MeshStandardMaterial({ color: 0x101214, emissive: col, emissiveIntensity: 0 });
        const q = new THREE.Mesh(geo, m);
        q.userData.shared = true;
        q.position.set(
          -w / 2 + ((i % cols) + 0.5) * (w / cols),
          ((Math.floor(i / cols) + 0.5) / rows) * h,
          d / 2 + 0.02,
        );
        g.add(q);
        P.lamps.push(m);
      }
      P.lampGeo = geo;
    } else if (sp.k === 'steam') {
      // 蒸氣：幾道往上冒、越冒越大越淡的白色團塊（循環，所以跳到哪一秒都看得到）
      const r = prng(sp.seed || 3);
      const geo = new THREE.SphereGeometry(1, 16, 12);
      P.puffs = [];
      for (let i = 0; i < (sp.n || 6); i++) {
        const cx = (r() - 0.5) * (sp.w || 30),
          cz = (r() - 0.5) * (sp.d || 14);
        for (let j = 0; j < 5; j++) {
          const m = new THREE.Mesh(
            geo,
            new THREE.MeshBasicMaterial({
              color: 0xf2f6fa,
              transparent: true,
              opacity: 0.4,
              depthWrite: false,
            }),
          );
          m.userData.shared = true;
          g.add(m);
          P.puffs.push({ m, cx, cz, ph: j / 5 + r() * 0.1, sp: 0.18 + r() * 0.08 });
        }
      }
      P.lampGeo = geo;
    } else if (sp.k === 'slug') {
      // 電磁砲彈：細長的發光體＋拖在後面的光軌
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(0.25, 0.25, 4, 10),
        new THREE.MeshBasicMaterial({ color: 0xe8fbff, toneMapped: false }),
      );
      m.rotation.x = Math.PI / 2;
      g.add(m);
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.45, 12, 10),
        new THREE.MeshBasicMaterial({
          color: 0x7fd8ff,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      glow.scale.set(1, 1, 3);
      g.add(glow);
      const trail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.05, 1, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0x8fe0ff,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      this.scene.add(trail);
      P.trail = trail;
    }
    P.base = this.cinePt(sp.p || [0, 0, 0], new THREE.Vector3());
    if (sp.path) P.path = sp.path.map((k) => ({ t: k.t, p: this.cinePt(k.p, new THREE.Vector3()) }));
    if (sp.aim && this.world) {
      // 電磁砲彈：從 p 往 aim 直線飛，打到地形或障礙物（地圖外是遠景的山脊）的地方就是撞擊點
      const a = this.cinePt(sp.p, new THREE.Vector3());
      const dir = this.cinePt(sp.aim, new THREE.Vector3()).sub(a).normalize();
      const q = new THREE.Vector3();
      let d = 8;
      const maxD = (sp.speed || 80) * (sp.maxT || 2.4); // 時間到了還沒打中就在那裡爆開
      for (; d < maxD; d += 1) if (this.world.hitsWorld(q.copy(a).addScaledVector(dir, d))) break;
      const end = a.clone().addScaledVector(dir, d);
      const t0 = sp.t0 || 0;
      P.path = [
        { t: t0, p: a },
        { t: t0 + d / (sp.speed || 80), p: end },
      ];
      P.hit = end;
    }
    g.rotation.y = (sp.yaw || 0) * D2R + ((this.cine.set && this.cine.set.yaw) || 0);
    if (sp.scale) g.scale.setScalar(sp.scale);
    this.scene.add(g);
    this.c2PropTick(P, 0);
    return P;
  },
  c2PropTick(P, lt) {
    const sp = P.spec,
      g = P.obj;
    if (P.path) {
      // 沿路徑（等速）：電磁砲彈
      const k = P.path;
      let i = 0;
      while (i < k.length - 2 && k[i + 1].t <= lt) i++;
      const a = k[i],
        b = k[i + 1] || a;
      const u = clamp((lt - a.t) / Math.max(1e-3, b.t - a.t), 0, 1);
      g.position.copy(a.p).lerp(b.p, u);
      const dir = b.p.clone().sub(a.p).normalize();
      g.lookAt(g.position.clone().add(dir));
      g.visible = lt >= k[0].t && lt <= k[k.length - 1].t;
      if (P.trail) {
        const from = k[0].p;
        const len = g.position.distanceTo(from);
        P.trail.visible = g.visible && len > 0.5;
        P.trail.position.copy(from).lerp(g.position, 0.5);
        P.trail.scale.set(1, len, 1);
        P.trail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      }
    } else {
      const o = sp.keys
        ? [0, 1, 2].map((j) =>
            kv(
              sp.keys.map((q) => ({ t: q.t, v: q.o[j] })),
              lt,
            ),
          )
        : [0, 0, 0];
      g.position.set(P.base.x + o[0], P.base.y + o[1], P.base.z + o[2]);
    }
    if (P.puffs) {
      const rise = sp.rise || 22,
        sz = sp.r || 4;
      for (const q of P.puffs) {
        const f = (lt * q.sp + q.ph) % 1;
        q.m.position.set(q.cx + f * 3, f * rise, q.cz);
        q.m.scale.setScalar(sz * (0.5 + f * 1.6));
        q.m.material.opacity = 0.42 * Math.sin(f * Math.PI) * kv(sp.k0, lt, 1);
      }
    }
    if (P.water) {
      const f = clamp(kv(sp.fill, lt, 0.5), 0.02, 1);
      P.water.scale.y = f * P.h;
      P.water.position.y = (f * P.h) / 2;
    }
    if (P.lamps.length) {
      const n = P.lamps.length;
      P.lamps.forEach((m, i) => {
        let on = 1;
        if (sp.on) on = lt >= sp.on[0] + i * sp.on[1] ? 1 : 0;
        if (sp.off) on = lt >= sp.off[0] + (n - 1 - i) * sp.off[1] ? 0 : on;
        // 剛亮起的時候閃一下
        m.emissiveIntensity = on * (sp.lampI || 1.6);
      });
    }
  },
  // 電磁砲彈的彈道視角：鏡頭跟在砲彈的斜後方（S.cam 照常算，這裡覆寫位置）
  cineHook_c2slug(S, phase, lt) {
    if (phase !== 'tick') return;
    const c = this.cine;
    const P = (c.c2props || []).find((q) => q.path);
    if (!P) return;
    const k = P.path,
      t0 = k[0].t,
      t1 = k[k.length - 1].t;
    const u = clamp((lt - t0) / Math.max(1e-3, t1 - t0), 0, 1);
    const a = k[0].p,
      b = k[k.length - 1].p;
    const dir = b.clone().sub(a).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const cam = this.camera;
    if (lt < t0) return;
    // 撞擊：爆炸、衝擊波、塵土、閃白（只有一次）
    if (u >= 1 && P.hit && !P.boomed) {
      P.boomed = true;
      const h = P.hit;
      this.fx.explosion(h, 7, 0x9fe0ff, true);
      this.fx.shockwave(h, 16, 0x9fe0ff, 0.8);
      this.fx.dust(h, 12, 30, 0x8a8478);
      this.fx.streaks(h, 60, 0xbff0ff, 40, 0.8, 20);
      SFX.explode('huge', null);
      c.shake = Math.max(c.shake || 0, 1.2);
      c.flash = { color: '#ffffff', t0: c.t, in: 0.03, hold: 0.22, out: 0.7 };
    }
    // 鏡頭在砲彈的正後方稍高（砲彈在畫面中央偏下）；打中之後停在半空看著撞擊點
    const pos = a.clone().lerp(b, Math.min(u, 0.88));
    cam.position
      .copy(pos)
      .addScaledVector(dir, -8 + u * 2)
      .addScaledVector(side, 0.9)
      .add(new THREE.Vector3(0, 1.6, 0));
    cam.up.set(0, 1, 0);
    cam.lookAt(u >= 1 ? b : pos.clone().addScaledVector(dir, 14));
    cam.rotateZ(-5 * D2R * (1 - u));
    cam.fov = lerp(66, 50, u);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    c.P.dof = 0;
  },
});
