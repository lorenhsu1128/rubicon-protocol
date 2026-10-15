// 第 5 章 洋上的抉擇（電視牆與新聞轉播） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch5.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c5 開頭，避免和別章重複。
//
// 電視牆（render 'c5wall'、ov 'c5wall'，鏡頭的 S.wall）：
//   同一張地圖、不同機位。每一格有自己的 RenderTarget（格子大小），每格輪流更新（rate 格更新一次，
//   像電視訊號的延遲），只畫場景、不跑後處理；合成時以 viewport＋scissor 把各格貼到畫面上，
//   在合成的著色器裡做 gamma、頻道的色偏、掃描線與雜訊。螢幕框、台標、跑馬燈畫在 2D 疊加畫布。
//   放大成全畫面（S.wall.zoom）的那一格改用全畫面大小的 RenderTarget、每格都更新。
//   GPU 資源（各格的 RenderTarget、合成網格）放在遊戲實例的 c5pool，重複播放共用，不會越播越多。
// 其他：c5sea（洋上都市的佈景：軌道電纜、探照燈、AEGIS 的護盾，放進 set.extra，換場景時由引擎移除；
//   演員的顯示 c5hide／c5gone／surf 依這一鏡的時間決定，所以劇場跳鏡頭也一致）、c5heli（直升機轉播的晃動）、
//   c5stage（章末的會議桌舞台）、疊加的頻道畫面、新聞頭條、倒數、ECHO 沒有雜訊的聲紋。
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { escHtml } from '../core/html.js';
import { FACTIONS } from '../data/story.js';
import { Game } from './game.js';

const $ = (id) => document.getElementById(id);
const smooth = (x) => x * x * (3 - 2 * x);
const D2R = Math.PI / 180;
const MONO = '"Share Tech Mono", "Noto Sans TC", monospace';
const SANS = '"Noto Sans TC", "Microsoft JhengHei", sans-serif';

// 頻道：台標、顏色、跑馬燈的預設文字
const CH = {
  castron: { name: 'CASTRON NEWS', mark: 'C', color: FACTIONS.castron.color, tint: [1.15, 0.92, 0.72] },
  aetheric: { name: 'AETHERIC NET', mark: 'A', color: FACTIONS.aetheric.color, tint: [0.78, 0.95, 1.2] },
  veerwell: { name: 'VEERWELL LIVE', mark: 'V', color: FACTIONS.veerwell.color, tint: [0.88, 1.12, 0.84] },
  sancta: { name: 'SANCTA RELIEF', mark: 'S', color: FACTIONS.sancta.color, tint: [1.1, 1.05, 0.78] },
  xylem: { name: 'XYLEM LOCAL', mark: 'X', color: '#58e0d0', tint: [0.82, 1.05, 1.08] },
  echo: { name: 'R-07 FEED', mark: 'E', color: '#7fc8ff', tint: [0.9, 1, 1.1] },
  station: { name: '◎ ORBITAL', mark: '◎', color: '#e8eef4', tint: [1, 1, 1] },
};
const chOf = (k) => CH[k] || CH.xylem;

// 電視牆合成用的著色器：gamma、彩度、頻道色偏、掃描線、雜訊、訊號中斷、變白
const WALL_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const WALL_FS = `
varying vec2 vUv;
uniform sampler2D tex;
uniform vec3 tint;
uniform float time, sat, lost, white, bright, crt;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  // 訊號不穩：橫向的撕裂
  float tear = lost * 0.04 * sin(uv.y * 40.0 + time * 30.0) * step(0.7, hash(vec2(floor(uv.y * 30.0), floor(time * 12.0))));
  uv.x += tear;
  vec3 c = texture2D(tex, uv).rgb;
  c = pow(max(c, 0.0), vec3(1.0 / 2.2));
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, sat) * tint * bright;
  c = (c - 0.5) * 1.12 + 0.5;
  c *= 0.84 + 0.16 * sin(gl_FragCoord.y * 2.1);
  float n = hash(gl_FragCoord.xy + fract(time) * 917.0);
  c += (n - 0.5) * 0.07;
  vec2 q = vUv - 0.5;
  c *= 1.0 - dot(q, q) * 0.9;
  c = mix(c, vec3(n) * vec3(0.55, 0.75, 1.0), lost);
  c = mix(c, vec3(1.0), white);
  // 開機：中間一條亮線往上下打開
  float open = smoothstep(0.0, 0.02, crt * 0.5 - abs(vUv.y - 0.5));
  c = mix(vec3(0.0), c + (1.0 - crt) * 0.8, open);
  gl_FragColor = vec4(c, 1.0);
}`;

// 2D：每一格／全畫面頻道的畫圖工具
function noise(x, r, a = 1) {
  const n = Math.max(40, Math.round((r.w * r.h) / 260));
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 200) | 0;
    x.fillStyle = `rgba(${v},${v},${v + 20},${a})`;
    x.fillRect(
      r.x + Math.random() * r.w,
      r.y + Math.random() * r.h,
      2 + Math.random() * 6,
      1 + Math.random() * 2,
    );
  }
}
// 跑馬燈：rect 底部的暗色條，左邊是頻道顏色的標籤
function ticker(x, r, text, col, lt, label, sz) {
  const h = sz || Math.max(10, Math.min(26, r.h * 0.11));
  const y = r.y + r.h - h;
  x.save();
  x.beginPath();
  x.rect(r.x, y, r.w, h);
  x.clip();
  x.fillStyle = 'rgba(6,10,16,0.88)';
  x.fillRect(r.x, y, r.w, h);
  x.font = `${Math.round(h * 0.66)}px ${SANS}`;
  x.textBaseline = 'middle';
  const lw = label ? x.measureText(label).width + h * 0.8 : 0;
  const msg = text + '　　◆　　';
  const mw = x.measureText(msg).width;
  const sp = h * 4;
  let off = -((lt * sp) % mw);
  x.fillStyle = '#eef3f7';
  for (let px = r.x + lw + off; px < r.x + r.w; px += mw) x.fillText(msg, px, y + h * 0.53);
  if (label) {
    x.fillStyle = col;
    x.fillRect(r.x, y, lw, h);
    x.fillStyle = '#081018';
    x.font = `700 ${Math.round(h * 0.62)}px ${MONO}`;
    x.fillText(label, r.x + h * 0.4, y + h * 0.53);
  }
  x.restore();
}
// 台標（左上）：頻道顏色的方塊＋名稱；live＝紅點 LIVE
function bug(x, r, ch, lt, live, k = 1) {
  const C = chOf(ch);
  const h = Math.max(9, Math.min(24, r.h * 0.085)) * k;
  const px = r.x + h * 0.5,
    py = r.y + h * 0.5;
  x.save();
  x.font = `700 ${Math.round(h * 0.7)}px ${MONO}`;
  x.textBaseline = 'middle';
  const w = x.measureText(C.name).width + h * 1.6;
  x.fillStyle = 'rgba(4,8,12,0.75)';
  x.fillRect(px, py, w, h);
  x.fillStyle = C.color;
  x.fillRect(px, py, h, h);
  x.fillStyle = '#081018';
  x.textAlign = 'center';
  x.fillText(C.mark, px + h / 2, py + h * 0.54);
  x.textAlign = 'left';
  x.fillStyle = '#f0f4f8';
  x.fillText(C.name, px + h * 1.3, py + h * 0.54);
  if (live) {
    const on = Math.floor(lt * 2) % 2 === 0;
    x.fillStyle = on ? '#ff3030' : '#802020';
    x.beginPath();
    x.arc(px + w + h * 0.7, py + h / 2, h * 0.22, 0, 7);
    x.fill();
    x.fillStyle = '#ffdede';
    x.fillText('LIVE', px + w + h * 1.05, py + h * 0.54);
  }
  x.restore();
}
// 沒有 3D 機位的格子：各家的宣傳畫面
const GFX = {
  // 維爾威：行情圖
  market(x, r, lt) {
    x.fillStyle = '#071810';
    x.fillRect(r.x, r.y, r.w, r.h);
    x.strokeStyle = 'rgba(155,224,112,0.12)';
    x.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      x.beginPath();
      x.moveTo(r.x, r.y + (r.h * i) / 6);
      x.lineTo(r.x + r.w, r.y + (r.h * i) / 6);
      x.stroke();
    }
    x.strokeStyle = '#9be070';
    x.lineWidth = Math.max(1.5, r.h * 0.012);
    x.beginPath();
    for (let i = 0; i <= 60; i++) {
      const u = i / 60,
        v = u * 9 + lt * 1.4;
      const y = r.y + r.h * (0.72 - u * 0.38 + Math.sin(v * 1.7) * 0.05 + Math.sin(v * 4.3) * 0.025);
      if (i) x.lineTo(r.x + r.w * (0.06 + u * 0.88), y);
      else x.moveTo(r.x + r.w * 0.06, y);
    }
    x.stroke();
    const s = r.h / 200;
    x.fillStyle = '#c8f5a8';
    x.font = `700 ${Math.round(18 * s)}px ${MONO}`;
    x.fillText(`VWL ▲ +${(12.4 + Math.sin(lt * 3) * 0.3).toFixed(1)}%`, r.x + r.w * 0.06, r.y + r.h * 0.3);
    x.font = `${Math.round(11 * s)}px ${SANS}`;
    x.fillStyle = 'rgba(200,240,180,0.8)';
    x.fillText('軌道校準 期貨', r.x + r.w * 0.06, r.y + r.h * 0.42);
  },
  // 聖域：避難路線圖
  evac(x, r, lt) {
    x.fillStyle = '#18160a';
    x.fillRect(r.x, r.y, r.w, r.h);
    x.strokeStyle = 'rgba(224,208,112,0.5)';
    x.lineWidth = 1.5;
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const px = r.x + r.w * (0.55 + Math.sin(u * 7) * 0.08 + u * 0.2),
        py = r.y + r.h * u;
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
    x.setLineDash([6, 5]);
    x.lineDashOffset = -lt * 20;
    x.strokeStyle = '#e0d070';
    x.lineWidth = Math.max(1.5, r.h * 0.012);
    for (let k = 0; k < 3; k++) {
      x.beginPath();
      x.moveTo(r.x + r.w * 0.75, r.y + r.h * (0.25 + k * 0.22));
      x.quadraticCurveTo(
        r.x + r.w * 0.45,
        r.y + r.h * (0.2 + k * 0.25),
        r.x + r.w * 0.12,
        r.y + r.h * (0.35 + k * 0.18),
      );
      x.stroke();
    }
    x.setLineDash([]);
    for (let k = 0; k < 5; k++) {
      if (Math.sin(lt * 5 + k * 2) < 0) continue;
      x.fillStyle = '#ff5040';
      x.beginPath();
      x.arc(r.x + r.w * (0.6 + (k % 3) * 0.1), r.y + r.h * (0.2 + k * 0.13), Math.max(2, r.h * 0.018), 0, 7);
      x.fill();
    }
    const s = r.h / 200;
    x.fillStyle = '#f5ecb0';
    x.font = `700 ${Math.round(15 * s)}px ${SANS}`;
    x.fillText('避難路線　東岸', r.x + r.w * 0.06, r.y + r.h * 0.2);
  },
  // 卡斯特隆：宣傳標語
  emblem(x, r, lt) {
    const g = x.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, '#3a1e08');
    g.addColorStop(1, '#120802');
    x.fillStyle = g;
    x.fillRect(r.x, r.y, r.w, r.h);
    const cx = r.x + r.w * 0.3,
      cy = r.y + r.h * 0.46,
      R = r.h * 0.26;
    x.save();
    x.translate(cx, cy);
    x.rotate(lt * 0.4);
    x.strokeStyle = '#d8903a';
    x.lineWidth = R * 0.18;
    x.setLineDash([R * 0.32, R * 0.18]);
    x.beginPath();
    x.arc(0, 0, R, 0, 7);
    x.stroke();
    x.restore();
    x.fillStyle = '#d8903a';
    x.font = `900 ${Math.round(R * 1.1)}px ${SANS}`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('C', cx, cy + R * 0.05);
    x.textAlign = 'left';
    x.fillStyle = '#ffd8a8';
    x.font = `700 ${Math.round(r.h * 0.1)}px ${SANS}`;
    x.fillText('秩序。', r.x + r.w * 0.52, r.y + r.h * 0.3);
    x.fillText('生產。', r.x + r.w * 0.52, r.y + r.h * 0.45);
    x.fillText('合約。', r.x + r.w * 0.52, r.y + r.h * 0.6);
    x.textBaseline = 'alphabetic';
  },
  // 艾瑟立克：軌道纜索的共振圖
  lab(x, r, lt) {
    x.fillStyle = '#06111c';
    x.fillRect(r.x, r.y, r.w, r.h);
    const cx = r.x + r.w * 0.5,
      cy = r.y + r.h * 0.62,
      R = r.h * 0.28;
    x.strokeStyle = 'rgba(90,184,255,0.8)';
    x.lineWidth = 1.5;
    x.beginPath();
    x.arc(cx, cy, R, 0, 7);
    x.stroke();
    x.beginPath();
    x.ellipse(cx, cy, R * 1.9, R * 0.5, -0.2, 0, 7);
    x.stroke();
    x.beginPath();
    x.moveTo(cx, cy - R);
    x.lineTo(cx + R * 0.3, r.y + r.h * 0.05);
    x.stroke();
    const a = lt * 1.3;
    x.fillStyle = '#bfe6ff';
    x.beginPath();
    x.arc(cx + Math.cos(a) * R * 1.9 * 0.98, cy + Math.sin(a) * R * 0.5, Math.max(2, r.h * 0.02), 0, 7);
    x.fill();
    const s = r.h / 200;
    x.font = `${Math.round(12 * s)}px ${MONO}`;
    x.fillStyle = '#9fd8ff';
    x.fillText(
      `TETHER RESONANCE ${(87.2 + Math.sin(lt * 2) * 1.5).toFixed(1)}%`,
      r.x + r.w * 0.05,
      r.y + r.h * 0.2,
    );
  },
  // 主角的檔案（所有頻道都在播 R-07）
  r07(x, r, lt, cl) {
    const C = chOf(cl.ch);
    x.fillStyle = '#070b10';
    x.fillRect(r.x, r.y, r.w, r.h);
    x.strokeStyle = C.color;
    x.globalAlpha = 0.25;
    x.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      x.beginPath();
      x.arc(r.x + r.w * 0.28, r.y + r.h * 0.5, r.h * (0.08 + i * 0.05), 0, 7);
      x.stroke();
    }
    x.globalAlpha = 1;
    x.fillStyle = C.color;
    x.font = `900 ${Math.round(r.h * 0.3)}px ${MONO}`;
    x.textBaseline = 'middle';
    x.fillText('R-07', r.x + r.w * 0.44, r.y + r.h * 0.42);
    x.font = `${Math.round(r.h * 0.075)}px ${SANS}`;
    x.fillStyle = '#e8eef4';
    x.fillText(cl.cap || '獨立傭兵', r.x + r.w * 0.45, r.y + r.h * 0.62);
    x.textBaseline = 'alphabetic';
    const blink = Math.floor(lt * 3) % 2;
    if (blink) {
      x.fillStyle = '#ff4040';
      x.fillRect(r.x + r.w * 0.45, r.y + r.h * 0.7, r.w * 0.2, r.h * 0.03);
    }
  },
  // 測試圖（彩條）
  bars(x, r) {
    const cols = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
    cols.forEach((c, i) => {
      x.fillStyle = c;
      x.fillRect(r.x + (r.w * i) / 7, r.y, r.w / 7 + 1, r.h * 0.7);
    });
    x.fillStyle = '#101010';
    x.fillRect(r.x, r.y + r.h * 0.7, r.w, r.h * 0.3);
    x.fillStyle = '#e0e0e0';
    x.font = `700 ${Math.round(r.h * 0.1)}px ${MONO}`;
    x.textAlign = 'center';
    x.fillText('NO SIGNAL', r.x + r.w / 2, r.y + r.h * 0.88);
    x.textAlign = 'left';
  },
};
// 六角形的護盾紋（2D）：中心 cx、cy，半徑 R
function hexShield(x, W, H, cx, cy, R, a) {
  if (R <= 0 || a <= 0) return;
  x.save();
  x.beginPath();
  x.arc(cx, cy, R, 0, 7);
  x.clip();
  x.fillStyle = `rgba(60,150,255,${0.2 * a})`;
  x.fillRect(0, 0, W, H);
  const s = Math.max(18, H / 24);
  x.strokeStyle = `rgba(150,220,255,${0.38 * a})`;
  x.lineWidth = 1.2;
  const hw = s * Math.sqrt(3);
  for (let row = -1; row < H / (s * 1.5) + 1; row++)
    for (let col = -1; col < W / hw + 1; col++) {
      const px = col * hw + (row % 2 ? hw / 2 : 0),
        py = row * s * 1.5;
      if (Math.hypot(px - cx, py - cy) > R + s) continue;
      x.beginPath();
      for (let k = 0; k < 6; k++) {
        const an = Math.PI / 6 + (k * Math.PI) / 3;
        const qx = px + Math.cos(an) * s,
          qy = py + Math.sin(an) * s;
        if (k) x.lineTo(qx, qy);
        else x.moveTo(qx, qy);
      }
      x.closePath();
      x.stroke();
    }
  x.restore();
  // 邊緣的亮環
  x.save();
  x.globalCompositeOperation = 'lighter';
  x.strokeStyle = `rgba(170,230,255,${0.8 * a})`;
  x.shadowColor = '#60c0ff';
  x.shadowBlur = 24;
  x.lineWidth = 4;
  x.beginPath();
  x.arc(cx, cy, R, 0, 7);
  x.stroke();
  x.restore();
}
const fmtCount = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    ss = s % 60;
  return [h, m, ss].map((v) => String(v).padStart(2, '0')).join(':');
};

Object.assign(Game.prototype, {
  // ---------- 共用 ----------
  // 這一鏡的長度
  c5Dur(S) {
    const c = this.cine;
    const i = c.def.shots.indexOf(S);
    const n = c.def.shots[i + 1];
    return (n ? n.at : c.def.dur) - S.at;
  },
  // 電視牆各格的位置（CSS 像素）：3×3（或 S.wall.grid）的格子，16:9；push＝整面牆慢慢推近，
  // zoom＝某一格放大成全畫面
  c5Rects(S, lt) {
    const W = innerWidth,
      H = innerHeight;
    const wl = S.wall;
    const n = wl.grid || 3;
    const gap = Math.max(3, H * 0.008);
    let ch = (H * 0.76 - gap * (n - 1)) / n,
      cw = (ch * 16) / 9;
    if (cw * n + gap * (n - 1) > W * 0.94) {
      cw = (W * 0.94 - gap * (n - 1)) / n;
      ch = (cw * 9) / 16;
    }
    const aw = cw * n + gap * (n - 1),
      ah = ch * n + gap * (n - 1);
    const x0 = (W - aw) / 2,
      y0 = H * 0.05 + (H * 0.76 - ah) / 2;
    const d = this.c5Dur(S);
    const pk = wl.push ? lerp(wl.push[0], wl.push[1], smooth(clamp(lt / d, 0, 1))) : 1;
    const pcx = W / 2,
      pcy = y0 + ah / 2;
    const z = wl.zoom;
    const zk = z ? smooth(clamp((lt - z.t) / z.d, 0, 1)) : 0;
    return wl.cells.map((cl, i) => {
      const g = cl.r || [i % n, Math.floor(i / n), 1, 1];
      let r = {
        x: x0 + g[0] * (cw + gap),
        y: y0 + g[1] * (ch + gap),
        w: g[2] * cw + (g[2] - 1) * gap,
        h: g[3] * ch + (g[3] - 1) * gap,
      };
      r = { x: pcx + (r.x - pcx) * pk, y: pcy + (r.y - pcy) * pk, w: r.w * pk, h: r.h * pk };
      if (z && z.cell === i && zk > 0)
        r = { x: lerp(r.x, 0, zk), y: lerp(r.y, 0, zk), w: lerp(r.w, W, zk), h: lerp(r.h, H, zk) };
      r.zk = z && z.cell === i ? zk : 0;
      return r;
    });
  },
  // 格子的狀態：開機（crt 0→1）、護盾經過後訊號中斷（lost）、軌道站的廣播（white）
  c5CellState(S, lt, i, r) {
    const wl = S.wall;
    const boot = wl.boot == null ? -1 : wl.boot;
    const crt = boot < 0 ? 1 : clamp((lt - boot - (wl.order ? wl.order[i] : i) * 0.13) / 0.35, 0, 1);
    let lost = 0;
    const sh = wl.shield;
    if (sh) {
      const R = this.c5ShieldR(S, lt);
      const o = this.c5ShieldO(S, lt);
      const dd = Math.hypot(r.x + r.w / 2 - o.x, r.y + r.h / 2 - o.y);
      if (i !== sh.cell) lost = clamp((R - dd) / (r.h * 0.6), 0, 1);
    }
    if (wl.cells[i].lost != null && lt >= wl.cells[i].lost) lost = Math.max(lost, 1);
    const white = wl.white != null ? clamp((lt - wl.white - (wl.whiteStep || 0) * i) / 0.12, 0, 1) : 0;
    return { crt, lost, white };
  },
  c5ShieldO(S, lt) {
    const sh = S.wall.shield;
    const r = this.c5Rects({ ...S, wall: { ...S.wall, shield: null } }, lt)[sh.cell];
    return { x: r.x + r.w * (sh.ox == null ? 0.5 : sh.ox), y: r.y + r.h * (sh.oy == null ? 0.55 : sh.oy) };
  },
  c5ShieldR(S, lt) {
    const sh = S.wall.shield;
    const k = clamp((lt - sh.t) / sh.d, 0, 1);
    const r0 = sh.r0 || 0;
    return lerp(r0, Math.hypot(innerWidth, innerHeight) * 1.05, k * k * k);
  },
  // RenderTarget 與合成用的網格（遊戲實例上共用一份，不隨每次播放重建）
  c5Pool() {
    if (this.c5pool) return this.c5pool;
    const mat = new THREE.ShaderMaterial({
      vertexShader: WALL_VS,
      fragmentShader: WALL_FS,
      uniforms: {
        tex: { value: null },
        tint: { value: new THREE.Vector3(1, 1, 1) },
        time: { value: 0 },
        sat: { value: 1.1 },
        lost: { value: 0 },
        white: { value: 0 },
        bright: { value: 1 },
        crt: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const q = new THREE.Scene();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    mesh.frustumCulled = false;
    q.add(mesh);
    this.c5pool = {
      mat,
      q,
      cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      rt: [],
      big: null,
      has: [],
      key: [],
      frame: 0,
    };
    return this.c5pool;
  },
  c5RT(pool, i, w, h) {
    const mk = () =>
      new THREE.WebGLRenderTarget(4, 4, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RGBAFormat,
      });
    const rt = i < 0 ? pool.big || (pool.big = mk()) : pool.rt[i] || (pool.rt[i] = mk());
    w = Math.max(16, Math.round(w));
    h = Math.max(16, Math.round(h));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    return rt;
  },
  // 一格的機位：cam＝{ p0, p1, l0, l1, fov（數字或 [起, 迄]）, hand（晃動）}，u＝這一鏡的進度
  c5CellCam(cl, u, ar, t) {
    const cam = this.camera,
      C = cl.cam;
    const e = C.ease === 'lin' ? u : smooth(u);
    const p = this.cinePt(C.p0).lerp(this.cinePt(C.p1 || C.p0), e);
    const l = this.cinePt(C.l0).lerp(this.cinePt(C.l1 || C.l0), e);
    cam.position.copy(p);
    cam.up.set(0, 1, 0);
    cam.lookAt(l);
    const hd = C.hand || 0;
    if (hd) {
      cam.rotateY((Math.sin(t * 1.9 + p.x) * 0.6 + Math.sin(t * 4.3) * 0.3) * hd * 0.01);
      cam.rotateX((Math.sin(t * 2.3 + 1) * 0.6 + Math.sin(t * 5.1) * 0.25) * hd * 0.01);
    }
    cam.fov = Array.isArray(C.fov) ? lerp(C.fov[0], C.fov[1], e) : C.fov || 40;
    cam.aspect = ar;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  },
  // ---------- 電視牆的渲染 ----------
  cineRender_c5wall(S, lt) {
    const c = this.cine,
      R = this.renderer,
      cam = this.camera;
    const W = innerWidth,
      H = innerHeight;
    const pool = this.c5Pool();
    const rects = this.c5Rects(S, lt);
    const cells = S.wall.cells;
    const pr = R.getPixelRatio();
    const P = c.P;
    const now = performance.now() / 1000;
    const d = this.c5Dur(S);
    const u = clamp(lt / d, 0, 1);
    // 主鏡頭的狀態先存起來（每一格借用同一個鏡頭）
    const sp = cam.position.clone(),
      sq = cam.quaternion.clone(),
      sf = cam.fov,
      sa = cam.aspect;
    pool.frame++;
    const auto = R.shadowMap.autoUpdate;
    let first = true;
    const key = c.key + ':' + S.at;
    cells.forEach((cl, i) => {
      if (!cl.cam) return;
      const r = rects[i];
      if (r.x > W || r.y > H || r.x + r.w < 0 || r.y + r.h < 0) return;
      const big = r.zk > 0;
      const fresh = pool.key[i] !== key;
      const due = big || fresh || (pool.frame + i) % (cl.rate || S.wall.rate || 3) === 0;
      if (!due) return;
      const q = big ? 1 : 0.9;
      const rt = this.c5RT(pool, big ? -1 : i, r.w * pr * q, r.h * pr * q);
      this.c5CellCam(cl, u, r.w / r.h, now);
      // 影子只在第一格更新（其他格沿用，省時間）
      if (!first) R.shadowMap.autoUpdate = false;
      this.stylePipe.applyScene(P, now);
      R.setRenderTarget(rt);
      R.render(this.scene, cam);
      first = false;
      pool.key[i] = key;
      pool.has[i] = rt;
    });
    R.shadowMap.autoUpdate = auto;
    cam.position.copy(sp);
    cam.quaternion.copy(sq);
    cam.fov = sf;
    cam.aspect = sa;
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    // 合成：牆面的底色 → 各格（放大中的最後畫，蓋在上面）
    R.setRenderTarget(null);
    const cc = R.getClearColor(new THREE.Color()),
      ca = R.getClearAlpha();
    R.setScissorTest(false);
    R.setViewport(0, 0, W, H);
    R.setClearColor(S.wall.bg == null ? 0x05070a : S.wall.bg, 1);
    R.clear();
    R.setScissorTest(true);
    const U = pool.mat.uniforms;
    const order = cells.map((_, i) => i).sort((a, b) => rects[a].zk - rects[b].zk);
    for (const i of order) {
      const cl = cells[i],
        r = rects[i];
      const rt = pool.has[i];
      if (!cl.cam || !rt || pool.key[i] !== key) continue;
      const st = this.c5CellState(S, lt, i, r);
      const C = chOf(cl.ch);
      U.tex.value = (r.zk > 0 && pool.big ? pool.big : rt).texture;
      const tk = 1 - r.zk; // 放大成全畫面時色偏與掃描線慢慢退掉
      U.tint.value.set(
        lerp(1, C.tint[0], tk * 0.8),
        lerp(1, C.tint[1], tk * 0.8),
        lerp(1, C.tint[2], tk * 0.8),
      );
      U.time.value = now;
      U.sat.value = cl.sat == null ? 1.15 : cl.sat;
      U.lost.value = st.lost;
      U.white.value = st.white;
      U.bright.value = cl.bright || 1.08;
      U.crt.value = st.crt;
      const x0 = Math.floor(r.x),
        y0 = Math.floor(H - r.y - r.h),
        w = Math.ceil(r.w),
        h = Math.ceil(r.h);
      R.setViewport(x0, y0, w, h);
      R.setScissor(x0, y0, w, h);
      R.render(pool.q, pool.cam);
    }
    R.setScissorTest(false);
    R.setViewport(0, 0, W, H);
    R.setClearColor(cc, ca);
    this.stylePipe.resetHistory();
  },
  // ---------- 電視牆的疊加：螢幕框、台標、跑馬燈、沒有機位的格子、開機、護盾、廣播 ----------
  cineOv_c5wall(x, W, H, lt, S) {
    const wl = S.wall;
    const rects = this.c5Rects(S, lt);
    const s = H / 720;
    // 牆面上方的監看標題（整面牆的時間碼）
    const top = rects.reduce((m, r) => Math.min(m, r.y), H);
    if (top > 14 * s && !wl.zoom) {
      x.save();
      x.font = `${11 * s}px ${MONO}`;
      x.fillStyle = 'rgba(160,200,230,0.6)';
      x.fillText(wl.title || 'EAST COAST // MULTI-FEED MONITOR', rects[0].x, top - 6 * s);
      x.textAlign = 'right';
      const tc = 3600 * 23 + 12 * 60 + 40 + this.cine.t;
      x.fillText(
        `${fmtCount(tc)}:${String(Math.floor((this.cine.t * 30) % 30)).padStart(2, '0')}`,
        rects[rects.length - 1].x + rects[rects.length - 1].w,
        top - 6 * s,
      );
      x.restore();
    }
    const hl = wl.hl || [];
    // 放大中的格子蓋在其他格子上面：其他格子的疊加畫面不畫進它的範圍
    const zi = rects.findIndex((r) => r.zk > 0);
    const zr = zi >= 0 ? rects[zi] : null;
    wl.cells.forEach((cl, i) => {
      const r = rects[i];
      if (r.zk >= 1) return;
      const st = this.c5CellState(S, lt, i, r);
      const C = chOf(cl.ch);
      x.save();
      if (zr && i !== zi) {
        x.beginPath();
        x.rect(0, 0, W, H);
        x.rect(zr.x, zr.y, zr.w, zr.h);
        x.clip('evenodd');
      }
      x.save();
      x.beginPath();
      x.rect(r.x, r.y, r.w, r.h);
      x.clip();
      // 沒有機位的格子：宣傳畫面
      if (!cl.cam) {
        (GFX[cl.g] || GFX.bars)(x, r, lt + i * 1.7, cl);
        // 2D 的格子也要有掃描線與暗角，和 3D 的格子一致
        x.fillStyle = 'rgba(0,0,0,0.14)';
        for (let y = r.y; y < r.y + r.h; y += 3) x.fillRect(r.x, y, r.w, 1);
        if (st.lost > 0) {
          x.fillStyle = `rgba(20,40,70,${st.lost})`;
          x.fillRect(r.x, r.y, r.w, r.h);
          noise(x, r, st.lost * 0.8);
        }
        if (st.white > 0) {
          x.fillStyle = `rgba(255,255,255,${st.white})`;
          x.fillRect(r.x, r.y, r.w, r.h);
        }
        if (st.crt < 1) {
          x.fillStyle = '#000';
          const oh = r.h * st.crt;
          x.fillRect(r.x, r.y, r.w, (r.h - oh) / 2);
          x.fillRect(r.x, r.y + (r.h + oh) / 2, r.w, (r.h - oh) / 2);
        }
      }
      const fade = Math.max(0, 1 - r.zk * 2.5);
      x.globalAlpha = fade;
      // 開機前：雜訊
      if (st.crt <= 0) {
        x.fillStyle = '#05070a';
        x.fillRect(r.x, r.y, r.w, r.h);
        if (lt > (wl.boot || 0) - 0.4) noise(x, r, 0.5);
      } else if (st.white < 0.5) {
        if (st.lost < 0.6) {
          bug(x, r, cl.ch, lt + i, !!cl.cam);
          if (cl.tick && r.h > 50) ticker(x, r, cl.tick, C.color, lt + i * 3, cl.tag);
          if (cl.cap && cl.cam && r.h > 50) {
            // 標題字幕（格子左下，跑馬燈上方）
            const hh = Math.max(10, r.h * 0.1);
            x.font = `700 ${Math.round(hh * 0.8)}px ${SANS}`;
            const tw = x.measureText(cl.cap).width;
            const yy = r.y + r.h - hh * (cl.tick ? 2.4 : 1.4);
            x.fillStyle = 'rgba(6,10,16,0.82)';
            x.fillRect(r.x + hh * 0.5, yy, tw + hh * 0.8, hh * 1.2);
            x.fillStyle = C.color;
            x.fillRect(r.x + hh * 0.5, yy, hh * 0.2, hh * 1.2);
            x.fillStyle = '#f2f6fa';
            x.textBaseline = 'middle';
            x.fillText(cl.cap, r.x + hh * 0.95, yy + hh * 0.62);
            x.textBaseline = 'alphabetic';
          }
        } else {
          x.font = `700 ${Math.max(9, r.h * 0.09)}px ${MONO}`;
          x.fillStyle = 'rgba(190,225,255,0.9)';
          x.textAlign = 'center';
          x.fillText('SIGNAL LOST', r.x + r.w / 2, r.y + r.h / 2);
          x.font = `${Math.max(8, r.h * 0.06)}px ${SANS}`;
          x.fillText('訊號中斷', r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.1);
          x.textAlign = 'left';
        }
      }
      // 軌道站的廣播：白底黑字
      if (st.white > 0.5) {
        x.fillStyle = '#111';
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.font = `700 ${Math.round(r.h * 0.2)}px ${MONO}`;
        x.fillText('KEY-07', r.x + r.w / 2, r.y + r.h * 0.42);
        x.font = `${Math.round(r.h * 0.085)}px ${SANS}`;
        x.fillText('請前往中樞。', r.x + r.w / 2, r.y + r.h * 0.62);
        x.textAlign = 'left';
        x.textBaseline = 'alphabetic';
      }
      x.restore();
      // 螢幕框與強調（說到這一家時框變成頻道的顏色）
      x.save();
      x.globalAlpha = fade;
      let glow = 0;
      for (const h of hl)
        if (h.cell === i && lt >= h.t && lt < h.t + (h.d || 1.6)) glow = 1 - (lt - h.t) / (h.d || 1.6);
      x.strokeStyle = glow > 0 ? C.color : 'rgba(40,48,58,0.95)';
      x.lineWidth = (glow > 0 ? 2 + glow * 3 : 2) * s;
      if (glow > 0) {
        x.shadowColor = C.color;
        x.shadowBlur = 18 * glow;
      }
      x.strokeRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      x.restore();
      x.restore();
    });
    // 護盾：從一格長大到蓋滿整個畫面
    if (wl.shield && lt >= wl.shield.t) {
      const o = this.c5ShieldO(S, lt);
      hexShield(x, W, H, o.x, o.y, this.c5ShieldR(S, lt), 1);
    }
    // 全部變白時，房間也被照亮
    if (wl.white != null && lt >= wl.white) {
      const k = clamp((lt - wl.white) / 0.4, 0, 1);
      x.fillStyle = `rgba(235,242,250,${0.12 * k})`;
      x.fillRect(0, 0, W, H);
    }
  },
  // ---------- 護盾蓋滿畫面之後：六角紋從整個畫面退開（接電視牆的護盾） ----------
  cineOv_c5hex(x, W, H, lt) {
    const k = clamp(1 - lt / 1.4, 0, 1);
    if (k <= 0) return;
    hexShield(x, W, H, W / 2, H / 2, Math.hypot(W, H) * (0.55 + (1 - k) * 0.6), k);
  },
  // ---------- 全畫面的頻道（宣傳頻道的單一畫面）：台標、標題字幕、跑馬燈 ----------
  cineOv_c5chan(x, W, H, lt, S) {
    const o = S.chan;
    if (!o) return;
    const C = chOf(o.ch);
    const s = H / 720;
    x.save();
    // 掃描線
    x.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
    if (!o.nobug) bug(x, { x: 24 * s, y: 20 * s, w: W, h: 260 * s }, o.ch, lt, o.live !== false, 1);
    // 標題字幕：從左邊滑進來
    const k = smooth(clamp((lt - 0.25) / 0.35, 0, 1));
    const by = H * 0.67;
    const bh = 46 * s;
    x.font = `700 ${Math.round(24 * s)}px ${SANS}`;
    const tw = Math.max(x.measureText(o.head).width + 40 * s, 360 * s);
    const bx = 40 * s - (1 - k) * (tw + 80 * s);
    x.fillStyle = 'rgba(8,12,18,0.9)';
    x.fillRect(bx, by, tw, bh);
    x.fillStyle = C.color;
    x.fillRect(bx, by, 8 * s, bh);
    x.fillStyle = '#f4f7fa';
    x.textBaseline = 'middle';
    x.fillText(o.head, bx + 22 * s, by + bh / 2 + 1);
    if (o.sub) {
      x.font = `${Math.round(14 * s)}px ${SANS}`;
      const sw = x.measureText(o.sub).width + 36 * s;
      x.fillStyle = C.color;
      x.fillRect(bx, by + bh, sw, 24 * s);
      x.fillStyle = '#0a0e14';
      x.fillText(o.sub, bx + 18 * s, by + bh + 12 * s);
    }
    x.textBaseline = 'alphabetic';
    ticker(x, { x: 0, y: 0, w: W, h: H * 0.835 }, o.tick || '', C.color, lt, o.tag || C.name, 26 * s);
    x.restore();
    noise(x, { x: 0, y: 0, w: W, h: H }, 0.04);
  },
  // ---------- 直升機轉播：LIVE、時間碼、倍率、標題字幕 ----------
  cineOv_c5live(x, W, H, lt, S) {
    const o = S.live || {};
    const s = H / 720;
    x.save();
    // LIVE（左上）
    const on = Math.floor(lt * 1.6) % 2 === 0;
    x.fillStyle = '#d01818';
    x.fillRect(30 * s, 26 * s, 74 * s, 28 * s);
    x.fillStyle = '#fff';
    x.font = `700 ${Math.round(18 * s)}px ${MONO}`;
    x.textBaseline = 'middle';
    x.fillText('LIVE', 44 * s, 41 * s);
    x.fillStyle = on ? '#ff4040' : 'rgba(255,64,64,0.25)';
    x.beginPath();
    x.arc(118 * s, 40 * s, 6 * s, 0, 7);
    x.fill();
    x.fillStyle = 'rgba(240,244,248,0.9)';
    x.font = `${Math.round(13 * s)}px ${MONO}`;
    x.fillText(o.src || 'NEWS HELI 3 // XYLEM', 132 * s, 41 * s);
    // 右上：時間碼與倍率
    x.textAlign = 'right';
    x.fillText(`ZOOM x${o.zoom || 24}`, W - 30 * s, 34 * s);
    const tc = 3600 * 23 + 14 * 60 + this.cine.t;
    x.fillText(
      `${fmtCount(tc)}:${String(Math.floor((this.cine.t * 30) % 30)).padStart(2, '0')}`,
      W - 30 * s,
      52 * s,
    );
    x.textAlign = 'left';
    // 攝影機的對焦框
    x.strokeStyle = 'rgba(240,244,248,0.55)';
    x.lineWidth = 1.5 * s;
    const fw = W * 0.18,
      fh = H * 0.18,
      L = 18 * s;
    for (const [px, py, dx, dy] of [
      [W / 2 - fw, H / 2 - fh, 1, 1],
      [W / 2 + fw, H / 2 - fh, -1, 1],
      [W / 2 + fw, H / 2 + fh, -1, -1],
      [W / 2 - fw, H / 2 + fh, 1, -1],
    ]) {
      x.beginPath();
      x.moveTo(px, py + dy * L);
      x.lineTo(px, py);
      x.lineTo(px + dx * L, py);
      x.stroke();
    }
    x.textBaseline = 'alphabetic';
    x.restore();
    if (o.head)
      this.cineOv_c5chan(x, W, H, lt, {
        chan: { ch: o.ch || 'xylem', head: o.head, sub: o.sub, tick: o.tick, nobug: true, tag: o.tag },
      });
    // 訊號不穩（爆炸的衝擊）
    if (o.glitch && lt >= o.glitch && lt < o.glitch + 0.5) {
      noise(x, { x: 0, y: 0, w: W, h: H }, 0.6);
      x.fillStyle = 'rgba(120,180,255,0.15)';
      x.fillRect(0, H * Math.random(), W, H * 0.08);
    }
  },
  // ---------- 新聞頭條：章名 ----------
  cineOv_c5head(x, W, H, lt, S) {
    const o = S.head;
    const s = H / 720;
    x.save();
    const k1 = smooth(clamp((lt - (o.t || 0.4)) / 0.3, 0, 1));
    const k2 = smooth(clamp((lt - (o.t || 0.4) - 0.35) / 0.45, 0, 1));
    const by = H * 0.6;
    // BREAKING
    x.fillStyle = '#c81414';
    const bw = 190 * s * k1;
    x.fillRect(48 * s, by, bw, 40 * s);
    if (k1 > 0.6) {
      x.fillStyle = '#fff';
      x.font = `900 ${Math.round(22 * s)}px ${MONO}`;
      x.textBaseline = 'middle';
      x.fillText(o.tag || 'BREAKING', 62 * s, by + 21 * s);
    }
    // 頭條（章名）
    x.font = `900 ${Math.round(46 * s)}px ${SANS}`;
    const tw = x.measureText(o.title).width + 70 * s;
    x.save();
    x.beginPath();
    x.rect(48 * s, by + 44 * s, tw * k2, 72 * s);
    x.clip();
    x.fillStyle = 'rgba(246,248,250,0.96)';
    x.fillRect(48 * s, by + 44 * s, tw, 72 * s);
    x.fillStyle = '#0a1018';
    x.textBaseline = 'middle';
    x.fillText(o.title, 78 * s, by + 82 * s);
    x.restore();
    if (o.s && k2 > 0.8) {
      x.font = `700 ${Math.round(15 * s)}px ${MONO}`;
      const sw = x.measureText(o.s).width + 30 * s;
      x.fillStyle = '#0a1018';
      x.fillRect(48 * s, by + 116 * s, sw, 26 * s);
      x.fillStyle = '#58e0d0';
      x.textBaseline = 'middle';
      x.fillText(o.s, 63 * s, by + 129 * s);
    }
    x.textBaseline = 'alphabetic';
    x.restore();
    if (k2 > 0)
      ticker(x, { x: 0, y: 0, w: W, h: H * 0.835 }, o.tick || o.title, '#c81414', lt, 'BREAKING', 26 * s);
  },
  // ---------- 倒數：72:00:00 開始跳；big＝畫面中央的大字，corner＝移到右上角 ----------
  cineOv_c5count(x, W, H, lt, S) {
    const o = S.count;
    const left = 72 * 3600 - (this.cine.t - o.t0);
    const s = H / 720;
    const mv = o.mv ? smooth(clamp((lt - o.mv[0]) / o.mv[1], 0, 1)) : o.mode === 'corner' ? 1 : 0;
    const big = lerp(110, 22, mv) * s;
    const cx = lerp(W / 2, W - 40 * s, mv),
      cy = lerp(H * 0.46, (this.cine.bar || 0) + 36 * s, mv);
    x.save();
    x.globalAlpha = o.a == null ? 1 : o.a;
    if (o.fade) x.globalAlpha *= clamp(1 - (lt - o.fade[0]) / o.fade[1], 0, 1);
    x.textAlign = mv > 0.5 ? 'right' : 'center';
    x.textBaseline = 'middle';
    x.font = `${Math.round(big)}px ${MONO}`;
    x.fillStyle = '#f2f6fa';
    x.shadowColor = 'rgba(255,90,70,0.8)';
    x.shadowBlur = 20 * s * (1 - mv * 0.6);
    x.fillText(fmtCount(left), cx, cy);
    x.shadowBlur = 0;
    x.font = `${Math.round(lerp(16, 10, mv) * s)}px ${MONO}`;
    x.fillStyle = 'rgba(255,130,110,0.95)';
    x.fillText('T-MINUS // ORBITAL STATION', cx, cy - big * 0.75);
    x.restore();
  },
  // ---------- ECHO：沒有雜訊的聲紋（一條乾淨的正弦） ----------
  cineOv_c5echo(x, W, H, lt) {
    const c = this.cine;
    const talking = c.c5echoUntil && c.t < c.c5echoUntil;
    const s = H / 720;
    const a = clamp(lt / 0.8, 0, 1);
    x.save();
    x.strokeStyle = `rgba(127,200,255,${0.85 * a})`;
    x.lineWidth = 1.6 * s;
    x.shadowColor = '#7fc8ff';
    x.shadowBlur = 10 * s;
    x.beginPath();
    const amp = (talking ? 14 + 10 * Math.abs(Math.sin(c.t * 2.2)) : 1.5) * s;
    for (let i = 0; i <= 160; i++) {
      const u = i / 160;
      const px = W * 0.3 + u * W * 0.4;
      const py = H * 0.5 + Math.sin(u * 18 - c.t * 4) * amp * Math.sin(u * Math.PI);
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
    x.restore();
  },
  // 字幕：ECHO 的聲音，第一次沒有無線電雜訊（不播 SFX.radio、不用無線電的字型）
  c5Echo(text, dur) {
    const c = this.cine;
    const el = $('cineSub');
    el.innerHTML = `<b style="color:#7fc8ff">ECHO</b><span>${escHtml(text)}</span>`;
    el.classList.remove('radio');
    el.classList.add('on');
    c.subUntil = c.t + dur;
    c.c5echoUntil = c.t + dur;
    SFX.play('bell', 0.18, 1.6, 0, 0, null, 'ui');
  },
  // ---------- 佈景：洋上都市（軌道電纜、探照燈、AEGIS 的護盾） ----------
  // S.sea：{ cable: [x, z], lights: [[x, z, 相位], …], dome: { at: [x, z], r: [起, 迄], t: [起, 迄] } }
  cineHook_c5sea(S, phase, lt, dt) {
    const c = this.cine;
    const set = c.set;
    if (!set || !this.world) return;
    const o = S.sea || {};
    let D = set.c5;
    if (!D) {
      D = set.c5 = { lights: [] };
      // 軌道電纜：海底一路伸進雲層（發光的細柱＋光暈）
      if (o.cable) {
        const g = new THREE.Group();
        const core = new THREE.Mesh(
          new THREE.CylinderGeometry(1.1, 1.6, 900, 10, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x9fe8ff, fog: false }),
        );
        core.position.y = 440;
        const halo = new THREE.Mesh(
          new THREE.CylinderGeometry(4, 6, 900, 12, 1, true),
          new THREE.MeshBasicMaterial({
            color: 0x40a0ff,
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        halo.position.y = 440;
        g.add(core, halo);
        // 纜索上的燈（往上一節一節）
        for (let i = 0; i < 14; i++) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(3.2, 0.35, 6, 16),
            new THREE.MeshBasicMaterial({ color: 0xff6040, fog: false }),
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.y = 20 + i * i * 3.2;
          g.add(ring);
        }
        g.position.copy(this.cinePt({ g: o.cable }));
        g.position.y -= 6;
        this.scene.add(g);
        set.extra.push(g);
        D.cable = g;
      }
      // 探照燈：加色的光錐，每一盞自己掃動
      for (const L of o.lights || []) {
        const geo = new THREE.ConeGeometry(9, 170, 18, 1, true);
        geo.translate(0, -85, 0);
        geo.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({
            color: 0xfff2d0,
            transparent: true,
            opacity: 0.16,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        m.position.copy(this.cinePt({ g: [L[0], L[1]], h: L[3] || 3 }));
        this.scene.add(m);
        set.extra.push(m);
        D.lights.push({ m, ph: L[2] || 0 });
      }
      // AEGIS 的護盾：半透明的球殼＋六角網格
      if (o.dome) {
        const g = new THREE.Group();
        const shell = new THREE.Mesh(
          new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
          new THREE.MeshBasicMaterial({
            color: 0x50b8ff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        );
        const wire = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.005, 3),
          new THREE.MeshBasicMaterial({
            color: 0x8fe0ff,
            wireframe: true,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        g.add(shell, wire);
        g.renderOrder = 4;
        g.position.copy(this.cinePt({ g: o.dome.at }));
        g.scale.setScalar(0.01);
        g.visible = false;
        this.scene.add(g);
        set.extra.push(g);
        D.dome = g;
        D.wire = wire;
        D.shell = shell;
      }
    }
    if (phase !== 'tick') return;
    const t = c.t;
    // 演員的顯示：c5hide＝這一鏡藏起來、c5gone＝{ id: 秒 } 之後藏起來（擊破）、
    // surf＝{ id, t, d, depth } 從水裡浮上來（t 之前藏著）。都依這一鏡的時間決定，所以跳鏡頭也一致
    const vis = (id, on) => {
      const A = c.actors.get(id);
      const m = A && (A.e ? A.e.mesh : A.obj);
      if (m) m.visible = on;
      return A;
    };
    for (const id of S.c5hide || []) vis(id, false);
    for (const id in S.c5gone || {}) vis(id, lt < S.c5gone[id]);
    const sf = S.surf;
    if (sf) {
      const A = vis(sf.id, lt >= sf.t);
      if (A && A.e && lt >= sf.t) {
        const k = 1 - smooth(clamp((lt - sf.t) / sf.d, 0, 1));
        A.e.mesh.position.y -= k * sf.depth;
        A.e.mesh.rotation.x += k * 0.4;
      }
    }
    for (const L of D.lights) {
      const a = t * 0.35 + L.ph;
      L.m.rotation.set(-0.55 - Math.sin(a * 1.3) * 0.25, Math.sin(a) * 1.1 + L.ph, 0);
    }
    // 護盾的大小：S.dome＝{ r: [起, 迄], t: [起, 迄] }（沒有時維持上一鏡的大小）
    if (D.dome) {
      const dm = S.dome;
      if (dm) {
        const k = smooth(clamp((lt - dm.t[0]) / (dm.t[1] - dm.t[0]), 0, 1));
        const r = lerp(dm.r[0], dm.r[1], k);
        D.dome.visible = r > 0.05;
        D.dome.scale.setScalar(Math.max(0.01, r));
      }
      D.dome.rotation.y += dt * 0.1;
      D.wire.material.opacity = 0.22 + 0.08 * Math.sin(t * 3);
      // 穿過護盾的瞬間：網格亮起
      if (S.domeHit != null && lt >= S.domeHit && lt < S.domeHit + 0.6) {
        D.wire.material.opacity = 0.9 - (lt - S.domeHit);
        D.shell.material.opacity = 0.35 - (lt - S.domeHit) * 0.4;
      } else D.shell.material.opacity = 0.12;
    }
  },
  // ---------- 直升機轉播的鏡頭：長焦＋晃動（在 cineCamera 之後轉一點點） ----------
  cineHook_c5heli(S, phase, lt) {
    if (phase !== 'tick') return;
    const cam = this.camera;
    const k = S.heli == null ? 1 : S.heli;
    const t = this.cine.t;
    cam.rotateY(
      (Math.sin(t * 1.1) * 0.5 + Math.sin(t * 2.7 + 1) * 0.3 + Math.sin(t * 6.1) * 0.08) * k * 0.006,
    );
    cam.rotateX(
      (Math.sin(t * 1.4 + 2) * 0.5 + Math.sin(t * 3.3) * 0.25 + Math.sin(t * 7.3) * 0.06) * k * 0.005,
    );
    cam.updateMatrixWorld();
  },
  // ---------- 章末的舞台：四張椅子的會議桌（黑色的空間、頂光） ----------
  // S.stage：{ turn: [起, 長度]（所有人轉頭看鏡頭）, empty: 秒（第四張椅子的頂光亮起）, dim: [起, 長度]（燈熄） }
  cineHook_c5stage(S, phase, lt) {
    const c = this.cine;
    const set = c.set;
    if (!set) return;
    let D = set.c5stage;
    if (!D) {
      D = set.c5stage = {};
      const g = new THREE.Group();
      const dark = new THREE.MeshStandardMaterial({
        color: 0x101216,
        roughness: 1,
        metalness: 0,
        envMapIntensity: 0,
      });
      const wood = new THREE.MeshStandardMaterial({
        color: 0x2a1c12,
        roughness: 0.75,
        metalness: 0,
        envMapIntensity: 0.05,
      });
      const seatM = new THREE.MeshStandardMaterial({
        color: 0x3a302a,
        roughness: 0.9,
        metalness: 0,
        envMapIntensity: 0.05,
      });
      const floor = new THREE.Mesh(new THREE.CircleGeometry(26, 48), dark);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      g.add(floor);
      // 長桌（沿 Z，從 z -5 到 -15）
      const top = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 10), wood);
      top.position.set(0, 1.5, -10);
      top.castShadow = top.receiveShadow = true;
      g.add(top);
      for (const z of [-6, -14]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 0.4), dark);
        leg.position.set(0, 0.7, z);
        g.add(leg);
      }
      // 四張高背椅：左前、右前、左後、右後（右前＝聖域，空著）。代表的機體往下沉，座面蓋住腰，看起來像坐著
      D.seats = [
        [-3.1, -7.5],
        [3.1, -7.5],
        [-3.1, -12.5],
        [3.1, -12.5],
      ];
      for (const [cx, cz] of D.seats) {
        const sd = Math.sign(cx);
        const seat = new THREE.Mesh(new THREE.BoxGeometry(2, 0.35, 2), seatM);
        seat.position.set(cx, 0.6, cz);
        const back = new THREE.Mesh(new THREE.BoxGeometry(0.35, 3.8, 2.1), seatM);
        back.position.set(cx + sd * 1.15, 2.6, cz);
        const crest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 2.3), wood);
        crest.position.set(cx + sd * 1.15, 4.55, cz);
        for (const m of [seat, back, crest]) {
          m.castShadow = m.receiveShadow = true;
          g.add(m);
        }
      }
      // 頂光：桌子正上方＋每張椅子各一盞（空椅子的那一盞之後才亮）
      const key = new THREE.SpotLight(0xffe6c8, 0.7, 50, 0.42, 0.7, 1);
      key.position.set(0, 18, -10);
      key.target.position.set(0, 0, -10);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      g.add(key, key.target);
      D.spots = D.seats.map(([cx, cz], i) => {
        const L = new THREE.SpotLight(i === 1 ? 0xe8d880 : 0xffd8a8, 0, 30, 0.2, 0.6, 1);
        // 空椅子的燈從桌子那一側斜照，照得到椅背
        if (i === 1) L.position.set(0.4, 12, cz);
        else L.position.set(cx, 14, cz + 1);
        L.target.position.set(cx, 1, cz);
        g.add(L, L.target);
        return L;
      });
      const rim = new THREE.DirectionalLight(0x6a88c0, 0.7);
      const fill = new THREE.DirectionalLight(0x8090b0, 0.22);
      fill.position.set(0, 6, 20);
      g.add(fill);
      rim.position.set(0, 10, -40);
      rim.target.position.set(0, 0, 0);
      g.add(rim, rim.target);
      g.position.copy(set.anchor);
      this.scene.add(g);
      set.extra.push(g);
      D.g = g;
      D.key = key;
      D.rim = rim;
    }
    if (phase !== 'tick') return;
    const st = S.stage || {};
    const dim = st.dim ? clamp(1 - (lt - st.dim[0]) / st.dim[1], 0, 1) : 1;
    D.key.intensity = 0.7 * dim;
    D.rim.intensity = 0.7 * dim;
    // 每張椅子的頂光：有人坐的一直亮，空椅子在 st.empty 秒亮起（負數＝一開始就亮）
    D.spots.forEach((L, i) => {
      if (i !== 1) L.intensity = 1.4 * dim;
      else L.intensity = st.empty != null ? 4 * smooth(clamp((lt - st.empty) / 0.6, 0, 1)) * dim : 0;
    });
    // 轉頭看鏡頭：整台轉 50%、上身 20%、頭 30%
    const turn = st.turn ? smooth(clamp((lt - st.turn[0]) / st.turn[1], 0, 1)) : st.looking ? 1 : 0;
    const cam = this.camera.position;
    for (const id of ['repC', 'repA', 'repV']) {
      const A = c.actors.get(id);
      if (!A || !A.rig) continue;
      const o = A.obj;
      const want = Math.atan2(-(cam.x - o.position.x), -(cam.z - o.position.z));
      if (A.c5yaw0 == null) A.c5yaw0 = o.rotation.y;
      let dd = want - A.c5yaw0;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      // 每一台轉頭的時間錯開一點
      const lag = id === 'repV' ? 0 : id === 'repC' ? 0.12 : 0.24;
      const k = st.turn ? smooth(clamp((lt - st.turn[0] - lag) / st.turn[1], 0, 1)) : turn;
      o.rotation.y = A.c5yaw0 + dd * 0.5 * k;
      if (A.rig.torso) A.rig.torso.rotation.y = dd * 0.2 * k;
      if (A.rig.head) A.rig.head.rotation.y = dd * 0.3 * k;
    }
  },
});
