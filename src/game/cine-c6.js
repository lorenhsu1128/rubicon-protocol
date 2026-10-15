// 第 6 章 軌道（寂靜與駕駛艙視角） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch6.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c6 開頭，避免和別章重複。
//  - c6cockpit（疊加）：駕駛艙的框與儀表（高度、速度、熱罩溫度、狀態列、頻道徽章、無聲的通訊視窗）
//  - c6snd（掛勾）：駕駛艙的機械聲（引擎的低鳴與艙內的嗡聲，每格設定音量；衝出大氣層後只剩嗡聲）
//  - c6sky（掛勾）：上升時天空一路變黑（雲海往下掉）
//  - c6duel（掛勾）：外環上的 ZENITH 對決：無重力的漂浮姿勢、舉槍、眼燈，以及依軌道站座標的鏡頭（眼燈／武器／遠景／槍口對槍口）
//  - c6count（疊加）：軌道站的倒數（取代章名卡）
//  - c6pre（疊加＋掛勾）：最後的抉擇的選前：中樞的門的光、委託方的頻道一個個亮起、倒數條
//  - c6vhs（疊加）：錄影帶倒轉（掃描線、追蹤雜訊、◀◀、倒退的時間碼）
//  - c6fall（掛勾）／c6fail（疊加）：軌道站拖著火光墜落、故障保險的紅字
//  - c6thrust（掛勾）：彼岸：推進器一排排亮起、星球在背後變小
import { SFX } from '../audio/audio.js';
import { clamp, lerp } from '../core/math.js';
import { SPEAKERS } from '../data/story.js';
import { PLANET_C, glowTex } from '../render/cine-sets.js';
import { PALETTES } from '../render/materials.js';
import { animateMech } from '../render/mech-model.js';
import { tagStyle } from '../render/style/shader.js';
import { Game } from './game.js';

const smooth = (u) => u * u * (3 - 2 * u);
const MONO = '"Share Tech Mono", monospace';
const SANS = '"Noto Sans TC", sans-serif';
const cyan = (a) => `rgba(150,225,255,${a})`;
// 數值的內插：v 是數字或 [起, 迄]
const iv = (v, u) => (Array.isArray(v) ? lerp(v[0], v[1], u) : v || 0);
const easeOf = (e, u) =>
  e === 'in' ? u * u : e === 'out' ? 1 - (1 - u) * (1 - u) : e === 'lin' ? u : smooth(u);
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
// '#rrggbb' → rgba(…, a)
const rgbaOf = (hex, a) => {
  const n = parseInt((hex || '#ffffff').slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

function addGlow(parent, color, size, pos) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex(),
      color,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      fog: false,
    }),
  );
  s.scale.set(size, size, 1);
  if (pos) s.position.set(pos[0], pos[1], pos[2]);
  s.userData.helper = true;
  parent.add(s);
  return s;
}

Object.assign(Game.prototype, {
  // 這一鏡的長度（秒）
  cineC6Dur(S) {
    const c = this.cine;
    const sh = c.def.shots;
    const i = sh.indexOf(S);
    return (sh[i + 1] ? sh[i + 1].at : c.def.dur) - S.at;
  },
  // 每段過場動畫自己的狀態（換一段就重來）
  cineC6St() {
    const c = this.cine;
    return c.c6 || (c.c6 = {});
  },
  // 心跳（劇本的 call 事件用）：k 越大越重
  cineC6Beat(k = 0.6) {
    SFX.tone(68, 40, 0.16, 0.5 + k * 0.5, 'sine', 'ui');
    SFX.tone(62, 36, 0.14, 0.35 + k * 0.4, 'sine', 'ui', 0.17);
  },

  // ---------- 駕駛艙的聲音：S.snd＝{ eng: [音量起, 迄], hum, rate } ----------
  cineHook_c6snd(S, phase, lt) {
    const d = S.snd || {};
    // kill：這一鏡一開始引擎聲就整個斷掉（衝出大氣層的那一刻）
    if (phase === 'enter' && d.kill && SFX.loops && SFX.loops.c6eng) {
      try {
        SFX.loops.c6eng.s.stop();
      } catch (e) {
        /* 已經停了 */
      }
      delete SFX.loops.c6eng;
    }
    if (phase !== 'tick') return;
    const u = clamp(lt / Math.max(0.1, this.cineC6Dur(S)), 0, 1);
    SFX.loopSet('c6eng', 'engineLoop', iv(d.eng, u), iv(d.rate, u) || 0.6);
    SFX.loopSet('c6hum', 'ambHum', iv(d.hum, u), 0.5);
  },

  // ---------- 上升：天空一路變黑（S.sky＝{ col: { 參數: [色, 色] }, num: { 參數: [起, 迄] } }，改這一鏡的調色）----------
  cineHook_c6sky(S, phase, lt) {
    if (phase !== 'tick') return;
    const c = this.cine,
      d = S.sky || {};
    const u = smooth(clamp(lt / Math.max(0.1, this.cineC6Dur(S)), 0, 1));
    for (const k in d.col || {})
      c.P[k] = '#' + new THREE.Color(d.col[k][0]).lerp(new THREE.Color(d.col[k][1]), u).getHexString();
    for (const k in d.num || {}) c.P[k] = iv(d.num[k], u);
  },

  // ---------- 駕駛艙（疊加）----------
  cineOv_c6cockpit(x, W, H, lt, S) {
    const c = this.cine;
    const K = S.ck || {};
    const s = H / 720;
    const dur = this.cineC6Dur(S);
    const u = easeOf(K.ease, clamp(lt / Math.max(0.1, dur), 0, 1));
    const heat = iv(K.heat, u);
    // 震動：整個儀表一起抖
    const sh = (c.shake || 0) + (K.shake || 0);
    const jx = sh ? (Math.random() * 2 - 1) * sh * 5 * s : 0,
      jy = sh ? (Math.random() * 2 - 1) * sh * 5 * s : 0;
    x.save();
    // 熱罩：畫面邊緣的紅光（越熱越往內）
    if (heat > 0.01) {
      const fl = 0.85 + Math.sin(c.t * 31) * 0.08 + Math.sin(c.t * 13) * 0.07;
      const g = x.createRadialGradient(
        W / 2,
        H * 0.55,
        Math.min(W, H) * (0.55 - heat * 0.3),
        W / 2,
        H * 0.55,
        Math.max(W, H) * 0.72,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.55, `rgba(255,90,30,${0.35 * heat * fl})`);
      g.addColorStop(1, `rgba(255,150,70,${0.85 * heat * fl})`);
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over';
    }
    // 艙罩的框：四角的暗色框架與兩條支柱
    x.translate(jx, jy);
    x.fillStyle = 'rgba(6,8,10,0.94)';
    const fr = (pts) => {
      x.beginPath();
      x.moveTo(pts[0] * W, pts[1] * H);
      for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i] * W, pts[i + 1] * H);
      x.closePath();
      x.fill();
    };
    fr([-0.02, -0.02, 0.2, -0.02, 0.06, 0.16, -0.02, 0.3]);
    fr([1.02, -0.02, 0.8, -0.02, 0.94, 0.16, 1.02, 0.3]);
    fr([-0.02, 1.02, -0.02, 0.8, 0.09, 0.9, 0.3, 1.02]);
    fr([1.02, 1.02, 1.02, 0.8, 0.91, 0.9, 0.7, 1.02]);
    x.strokeStyle = 'rgba(40,48,56,0.9)';
    x.lineWidth = 3 * s;
    x.beginPath();
    x.moveTo(0.06 * W, 0.16 * H);
    x.lineTo(0.2 * W, -0.02 * H);
    x.moveTo(0.94 * W, 0.16 * H);
    x.lineTo(0.8 * W, -0.02 * H);
    x.moveTo(0.09 * W, 0.9 * H);
    x.lineTo(0.3 * W, 1.02 * H);
    x.moveTo(0.91 * W, 0.9 * H);
    x.lineTo(0.7 * W, 1.02 * H);
    x.stroke();
    // 艙罩玻璃的反光
    x.strokeStyle = 'rgba(200,230,255,0.035)';
    x.lineWidth = 26 * s;
    x.beginPath();
    x.moveTo(0.62 * W, 0.08 * H);
    x.lineTo(0.84 * W, 0.42 * H);
    x.stroke();
    if (K.off) {
      x.restore();
      return;
    }
    const hud = K.dim == null ? 0.85 : K.dim;
    // 固定的準星（機首方向）
    x.strokeStyle = cyan(0.5 * hud);
    x.lineWidth = 1.2 * s;
    x.beginPath();
    x.moveTo(W / 2 - 16 * s, H / 2);
    x.lineTo(W / 2 - 6 * s, H / 2);
    x.moveTo(W / 2 + 6 * s, H / 2);
    x.lineTo(W / 2 + 16 * s, H / 2);
    x.moveTo(W / 2, H / 2 + 6 * s);
    x.lineTo(W / 2, H / 2 + 12 * s);
    x.stroke();
    // 高度（左）與速度（右）的刻度帶
    const tape = (cx, label, val, unit, step, right) => {
      const top = H * 0.3,
        h = H * 0.36;
      x.strokeStyle = cyan(0.45 * hud);
      x.lineWidth = 1 * s;
      x.beginPath();
      x.moveTo(cx, top);
      x.lineTo(cx, top + h);
      x.stroke();
      const off = ((val / step) % 1) * (h / 6);
      x.font = `${10 * s}px ${MONO}`;
      x.fillStyle = cyan(0.55 * hud);
      x.textAlign = right ? 'left' : 'right';
      for (let i = -1; i <= 7; i++) {
        const y = top + i * (h / 6) + off;
        if (y < top || y > top + h) continue;
        x.fillRect(right ? cx : cx - 8 * s, y, 8 * s, 1 * s);
      }
      x.font = `${18 * s}px ${MONO}`;
      x.fillStyle = cyan(0.95 * hud);
      const big = unit === 'm' && val >= 10000 ? `${(val / 1000).toFixed(1)} km` : `${fmtN(val)} ${unit}`;
      x.fillText(big, right ? cx + 14 * s : cx - 14 * s, top + h / 2 + 6 * s);
      x.font = `${11 * s}px ${MONO}`;
      x.fillStyle = cyan(0.6 * hud);
      x.fillText(label, right ? cx + 14 * s : cx - 14 * s, top + h / 2 - 16 * s);
    };
    if (!K.min) {
      tape(W * 0.2, 'ALT', iv(K.alt, u), 'm', 500, false);
      tape(W * 0.8, 'SPD', iv(K.spd, u), 'm/s', 100, true);
    }
    // 熱罩溫度（下）
    const bw = W * 0.24,
      bx = W / 2 - bw / 2,
      by = H * 0.8;
    x.fillStyle = 'rgba(0,0,0,0.4)';
    if (!K.min) x.fillRect(bx, by, bw, 5 * s);
    if (!K.min)
      x.fillStyle =
        heat > 0.6 ? `rgba(255,90,60,${hud})` : heat > 0.3 ? `rgba(255,170,80,${hud})` : cyan(hud);
    x.font = `${11 * s}px ${MONO}`;
    x.textAlign = 'left';
    if (!K.min) {
      x.fillRect(bx, by, bw * clamp(heat, 0, 1), 5 * s);
      x.fillStyle = heat > 0.6 && Math.sin(c.t * 14) > 0 ? 'rgba(255,110,80,1)' : cyan(0.7 * hud);
      x.fillText(`HEAT SHIELD  ${fmtN(40 + heat * 1580)}°C`, bx, by - 6 * s);
    }
    if (K.vac) {
      x.textAlign = 'right';
      x.fillStyle = cyan(0.55 * hud);
      x.fillText('EXT.PRESS 0.00 kPa  //  EXT.AUDIO —', bx + bw, by + 20 * s);
    }
    // 狀態列（左上）與倒數
    x.textAlign = 'left';
    if (K.st) {
      x.font = `${12 * s}px ${MONO}`;
      x.fillStyle = K.stc || cyan(0.85 * hud);
      const lines = [].concat(K.st);
      lines.forEach((l, i) => x.fillText(l, W * 0.1, H * 0.2 + i * 16 * s));
    }
    if (K.count != null) {
      const n = Math.max(0, K.count - lt);
      x.font = `${26 * s}px ${MONO}`;
      x.textAlign = 'center';
      x.fillStyle = n <= 0 ? 'rgba(255,200,120,1)' : cyan(0.95);
      x.fillText(n <= 0 ? 'LIFT OFF' : `T−${n.toFixed(1).padStart(4, '0')}`, W / 2, H * 0.3);
    }
    // 頻道徽章（右上）：[說話者, 亮起, 熄滅]
    if (K.chans) this.cineC6Chans(x, W, H, lt, K.chans, s);
    // 無聲的通訊視窗：徽章＋名字，聲紋是平的（ECHO 只有雜訊）
    if (K.win) this.cineC6Win(x, W, H, lt, K.win, s);
    x.restore();
  },
  // 右上的頻道徽章：亮起時閃一下，熄滅時閃爍後變暗
  cineC6Chans(x, W, H, lt, chans, s) {
    const R = 15 * s,
      gap = 40 * s;
    const x0 = W * 0.9 - (chans.length - 1) * gap;
    const y = H * 0.2;
    x.save();
    chans.forEach(([who, on, off], i) => {
      const S = SPEAKERS[who];
      if (!S) return;
      const cx = x0 + i * gap;
      let a = 0.12;
      if (lt >= on) a = lt - on < 0.25 ? (Math.floor((lt - on) * 24) % 2 ? 0.3 : 1) : 1;
      if (off != null && lt >= off)
        a = lt - off < 0.35 ? (Math.floor((lt - off) * 20) % 2 ? 0.9 : 0.2) : 0.08;
      x.globalAlpha = a;
      x.strokeStyle = S.color;
      x.lineWidth = 1.6 * s;
      x.strokeRect(cx - R, y - R, R * 2, R * 2);
      x.fillStyle = 'rgba(6,10,14,0.8)';
      x.fillRect(cx - R + 1.5 * s, y - R + 1.5 * s, R * 2 - 3 * s, R * 2 - 3 * s);
      x.fillStyle = S.color;
      x.font = `700 ${16 * s}px ${SANS}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(S.mark, cx, y + 1 * s);
      // 熄滅後畫一條斜線
      if (off != null && lt >= off + 0.35) {
        x.globalAlpha = 0.6;
        x.strokeStyle = 'rgba(255,90,80,0.9)';
        x.beginPath();
        x.moveTo(cx - R, y + R);
        x.lineTo(cx + R, y - R);
        x.stroke();
      }
    });
    x.globalAlpha = 1;
    x.textBaseline = 'alphabetic';
    x.font = `${9 * s}px ${MONO}`;
    x.textAlign = 'right';
    x.fillStyle = cyan(0.55);
    x.fillText('CHANNELS', W * 0.9 + R, y + R + 14 * s);
    x.restore();
  },
  cineC6Win(x, W, H, lt, who, s) {
    const S = SPEAKERS[who];
    if (!S) return;
    const k = clamp(lt / 0.12, 0, 1);
    const w = 230 * s,
      h = 78 * s,
      wx = W * 0.5 - w / 2,
      wy = H * 0.62;
    x.save();
    x.globalAlpha = k;
    x.fillStyle = 'rgba(4,8,12,0.78)';
    x.fillRect(wx, wy, w, h);
    x.strokeStyle = S.color;
    x.lineWidth = 1.4 * s;
    x.strokeRect(wx, wy, w, h);
    // 徽章
    const R = 24 * s,
      cx = wx + 14 * s + R,
      cy = wy + h / 2;
    x.strokeRect(cx - R, cy - R, R * 2, R * 2);
    if (who === 'echo') {
      // ECHO：只有雜訊
      for (let i = 0; i < 90; i++) {
        x.fillStyle = `rgba(200,220,240,${Math.random() * 0.7})`;
        x.fillRect(cx - R + Math.random() * R * 2, cy - R + Math.random() * R * 2, 2 * s, 2 * s);
      }
    } else {
      x.fillStyle = S.color;
      x.font = `700 ${26 * s}px ${SANS}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(S.mark, cx, cy + 1 * s);
    }
    x.textBaseline = 'alphabetic';
    x.textAlign = 'left';
    x.fillStyle = S.color;
    x.font = `${13 * s}px ${SANS}`;
    x.fillText(who === 'echo' ? 'ECHO' : S.name.replace(/（.*）/, ''), cx + R + 12 * s, wy + 26 * s);
    x.font = `${10 * s}px ${MONO}`;
    x.fillStyle = 'rgba(200,215,230,0.7)';
    x.fillText(who === 'echo' ? 'SIGNAL ... NO DATA' : 'AUDIO : MUTED', cx + R + 12 * s, wy + 42 * s);
    // 聲紋：平的一條線（ECHO 是雜訊）
    x.strokeStyle = who === 'echo' ? 'rgba(200,220,240,0.6)' : S.color;
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const px = cx + R + 12 * s + i * 3.5 * s;
      const py = wy + 60 * s + (who === 'echo' ? (Math.random() * 2 - 1) * 6 * s : 0);
      if (i) x.lineTo(px, py);
      else x.moveTo(px, py);
    }
    x.stroke();
    x.restore();
  },

  // ---------- 軌道站的倒數（取代章名卡）：S.cd＝開始的秒數 ----------
  cineOv_c6count(x, W, H, lt, S) {
    const s = H / 720;
    const n = Math.max(0, (S.cd || 0) - lt);
    const hh = Math.floor(n / 3600),
      mm = Math.floor((n % 3600) / 60),
      ss = Math.floor(n % 60),
      cs = Math.floor((n % 1) * 100);
    const p2 = (v) => String(v).padStart(2, '0');
    const a = clamp(lt / 0.8, 0, 1);
    x.save();
    x.globalAlpha = a;
    x.textAlign = 'center';
    x.font = `${11 * s}px ${MONO}`;
    x.fillStyle = 'rgba(232,238,244,0.6)';
    const cy = H * 0.74;
    x.fillText('ORBITAL STATION  //  PROTOCOL', W / 2, cy - 40 * s);
    x.font = `${44 * s}px ${MONO}`;
    x.fillStyle = 'rgba(240,244,248,0.95)';
    x.shadowColor = 'rgba(160,210,255,0.6)';
    x.shadowBlur = 14 * s;
    x.fillText(`${p2(hh)}:${p2(mm)}:${p2(ss)}`, W / 2 - 18 * s, cy + 6 * s);
    x.shadowBlur = 0;
    x.font = `${24 * s}px ${MONO}`;
    x.textAlign = 'left';
    x.fillStyle = 'rgba(240,244,248,0.5)';
    x.fillText(`.${p2(cs)}`, W / 2 + 74 * s, cy + 6 * s);
    x.restore();
  },

  // ---------- ZENITH 的對決：外環上的兩台機體（模型演員 hz＝主角、zz＝ZENITH，掛在軌道站上） ----------
  // S.dc＝{ k: 'eye'|'gun'|'wide'|'far'|'end', who, d: [距離起, 迄], fov, side, up }；S.aim＝[起, 迄]（舉槍的比例）
  cineHook_c6duel(S, phase, lt, dt) {
    const c = this.cine;
    if (phase === 'exit') return;
    const hz = c.actors.get('hz'),
      zz = c.actors.get('zz');
    if (!hz || !zz || !hz.rig || !zz.rig) return;
    const st = this.cineC6St();
    // 眼燈：加在頭部網格的正面（只加一次；顏色＝配色的 visor）
    if (!st.eyes) {
      st.eyes = true;
      for (const A of [hz, zz]) {
        const hd = A.rig.head;
        const box = new THREE.Box3();
        hd.updateMatrixWorld(true);
        const inv = new THREE.Matrix4().copy(hd.matrixWorld).invert();
        const m4 = new THREE.Matrix4();
        hd.traverse((o) => {
          if (!o.isMesh || !o.geometry || o.userData.helper) return;
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          box.union(o.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld)));
        });
        if (box.isEmpty()) box.set(new THREE.Vector3(-0.4, 0, -0.4), new THREE.Vector3(0.4, 0.8, 0.4));
        const pal = PALETTES[A.spec.pal] || PALETTES.player;
        // 有 visor 顏色的網格就以它為準（眼燈的位置）
        const vb = new THREE.Box3();
        const vc = new THREE.Color(pal.visor || 0xff3020);
        // 護目鏡：visor 顏色或明顯自發光的材質（有些頭部的護目鏡用自己的紅色）
        const isV = (mt) =>
          mt &&
          ((mt.color && mt.color.equals(vc)) ||
            (mt.emissive && (mt.emissive.equals(vc) || mt.emissive.r + mt.emissive.g + mt.emissive.b > 0.6)));
        const v3 = new THREE.Vector3();
        hd.traverse((o) => {
          if (!o.isMesh || !o.geometry || o.userData.helper) return;
          const mt = o.material;
          m4.multiplyMatrices(inv, o.matrixWorld);
          if (!Array.isArray(mt)) {
            if (isV(mt)) vb.union(o.geometry.boundingBox.clone().applyMatrix4(m4));
            return;
          }
          // 合併過的網格（多重材質）：只取 visor 那一組的頂點
          const pos = o.geometry.attributes.position,
            idx = o.geometry.index;
          for (const gr of o.geometry.groups || []) {
            if (!isV(mt[gr.materialIndex])) continue;
            for (let i = gr.start; i < gr.start + gr.count; i++) {
              const k = idx ? idx.getX(i) : i;
              vb.expandByPoint(v3.fromBufferAttribute(pos, k).applyMatrix4(m4));
            }
          }
        });
        if (!vb.isEmpty()) {
          box.min.y = vb.min.y - (vb.max.y - vb.min.y) * 0.45;
          box.max.y = vb.max.y + (vb.max.y - vb.min.y) * 0.45;
          box.min.z = vb.min.z;
        }
        const w = Math.min(box.max.x - box.min.x, 1.2);
        A.c6eye = addGlow(hd, pal.visor || 0xff3020, w * 0.9, [
          (box.min.x + box.max.x) / 2,
          box.min.y + (box.max.y - box.min.y) * 0.55,
          box.min.z - 0.03,
        ]);
      }
    }
    if (phase === 'enter') return;
    const dur = this.cineC6Dur(S);
    const u = clamp(lt / Math.max(0.1, dur), 0, 1);
    const aim = iv(S.aim, smooth(u));
    // 姿勢：無重力的漂浮（雙腿外展），舉槍的手臂往前伸
    for (const A of [hz, zz]) {
      const m = A.rig;
      animateMech(m, dt || 0.016, { t: c.t + (A === zz ? 1.7 : 0), grounded: false, hover: true });
      const a = m.arms.r;
      a.up.rotation.x = lerp(a.up.rotation.x, 1.52, aim);
      a.up.rotation.z = lerp(a.up.rotation.z, 0.12, aim);
      a.up.rotation.y = lerp(a.up.rotation.y, 0, aim);
      a.fore.rotation.x = lerp(a.fore.rotation.x, 0.06, aim);
      if (A.c6eye) A.c6eye.material.opacity = 0.75 + Math.sin(c.t * 3 + (A === zz ? 1 : 0)) * 0.15;
    }
    // 鏡頭：以軌道站的「上方」當鏡頭的上方（沒有固定的上下）
    const D = S.dc;
    if (!D) return;
    const cam = this.camera;
    const station = c.set && c.set.space && c.set.space.station.group;
    const U = new THREE.Vector3(0, 1, 0);
    if (station) U.applyQuaternion(station.getWorldQuaternion(new THREE.Quaternion()));
    const wp = (o) => o.getWorldPosition(new THREE.Vector3());
    const hp = wp(hz.obj),
      zp = wp(zz.obj);
    const mid = hp.clone().add(zp).multiplyScalar(0.5);
    const axis = zp.clone().sub(hp).normalize(); // 主角 → ZENITH
    const side = axis.clone().cross(U).normalize();
    // 側向一律朝外環的內側：鏡頭在內側往外看，背景是太空與行星（far＝外側的極遠景，看得到整座站）
    if (station) {
      const out = mid.clone().sub(wp(station));
      out.addScaledVector(U, -out.dot(U));
      if (out.dot(side) > 0 !== (D.k === 'far')) side.negate();
    }
    const A = D.who === 'hz' ? hz : zz;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(A.obj.getWorldQuaternion(new THREE.Quaternion()));
    const dd = iv(D.d, smooth(u));
    const sd = D.side == null ? 0.35 : D.side;
    let pos, look;
    if (D.k === 'eye') {
      const eye = wp(A.c6eye || A.rig.head);
      pos = eye
        .clone()
        .addScaledVector(fwd, dd)
        .addScaledVector(side, sd * dd)
        .addScaledVector(U, 0.05 * dd);
      look = eye.clone();
    } else if (D.k === 'gun') {
      const g = wp(A.rig.arms.r.weapon);
      // 武器的特寫：越過槍身看向對手（槍在前景、對手在背景）
      const right = fwd.clone().cross(U).normalize();
      const foe = wp((A === hz ? zz : hz).rig.head);
      pos = g
        .clone()
        .addScaledVector(right, 0.4 * dd)
        .addScaledVector(U, 0.18 * dd)
        .addScaledVector(fwd, -0.7 * dd);
      look = g.clone().lerp(foe, 0.22);
    } else {
      // wide／far／end：從兩台的側面（end＝槍口的高度，貼近）
      const h = (hz.rig.height || 4) * (D.k === 'end' ? 0.62 : 0.5);
      const up = D.up == null ? (D.k === 'far' ? 0.3 : 0.15) : D.up;
      pos = mid
        .clone()
        .addScaledVector(side, dd)
        .addScaledVector(U, h + up * dd);
      if (D.k === 'far') pos.addScaledVector(axis, -dd * 0.35);
      look = mid.clone().addScaledVector(U, h);
    }
    cam.position.copy(pos);
    cam.up.copy(U);
    cam.lookAt(look);
    if (D.roll) cam.rotateZ((iv(D.roll, u) * Math.PI) / 180);
    const fov = iv(D.fov || 30, u);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    c.look.copy(look);
    this.sun.position.copy(look).addScaledVector(c.set.space.pu.sunDir.value, 120);
    this.sun.target.position.copy(look);
  },

  // ---------- 太空場景：藏起碎片帶（純黑的寂靜）----------
  cineHook_c6clean(S, phase) {
    const sp = this.cine.set && this.cine.set.space;
    if (sp && sp.debris) sp.debris.visible = phase === 'exit';
  },

  // ---------- 發射台：駕駛艙旁邊的發射塔（上升時往下滑過窗外）。加進 set.extra，換場景時由引擎移除 ----------
  cineHook_c6pad(S, phase) {
    const c = this.cine;
    if (phase !== 'enter' || !c.set || c.set.c6pad) return;
    const g = new THREE.Group();
    const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.6, metalness: 0.6 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xc9572c, roughness: 0.6, metalness: 0.3 });
    const lamp = new THREE.MeshBasicMaterial({ color: 0xff3020 });
    const box = (m, w, h, d, x, y, z, rz = 0) => {
      const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      o.position.set(x, y, z);
      o.rotation.z = rz;
      g.add(o);
      return o;
    };
    const H = 90;
    for (const [x, z] of [
      [0, -2],
      [4, -2],
      [0, 2],
      [4, 2],
    ])
      box(steel, 0.5, H, 0.5, x, H / 2, z);
    for (let y = 2; y < H; y += 4) {
      box(y % 12 === 2 ? orange : steel, 4.4, 0.35, 0.35, 2, y, -2);
      box(steel, 4.4, 0.35, 0.35, 2, y, 2);
      box(steel, 0.35, 0.35, 4.4, 0, y, 0);
      box(steel, 0.35, 0.35, 4.4, 4, y, 0);
      box(steel, 0.25, 5.6, 0.25, 2, y + 2, -2, (y / 4) % 2 ? 0.78 : -0.78);
      if (y % 8 === 2) box(lamp, 0.3, 0.3, 0.3, -0.3, y, -2.3);
    }
    // 連接駕駛艙的臂（窗外近處）
    for (const y of [20, 28]) {
      box(orange, 6, 0.8, 1.2, -2.6, y, 0);
      box(steel, 0.6, 2.4, 0.6, -5.4, y - 1.2, 0);
    }
    const A = c.set.anchor;
    g.position.set(A.x + 6, A.y, A.z - 4);
    tagStyle(g);
    this.scene.add(g);
    c.set.extra.push(g);
    c.set.c6pad = g;
  },

  // ---------- 最後的抉擇：選前（live）----------
  // 遊戲的聲音整個悶掉（寂靜）；結束時還原
  cineHook_c6pre(S, phase) {
    const c = this.cine;
    // 出口原本的光環與名牌（戰場上的）先藏起來，改由疊加畫面畫成「門」
    const rings = [];
    for (const e of (c.set && c.set.exits) || (this.camp && this.camp.exits) || [])
      if (e.group) rings.push(e.group);
    if (c.set && c.set.extra) rings.push(...c.set.extra);
    if (phase === 'enter') {
      SFX.setMuffle(0.92);
      for (const g of rings) g.visible = false;
    } else if (phase === 'exit') {
      SFX.setMuffle(0);
      for (const g of rings) g.visible = true;
    }
  },
  // 中樞的門（出口）的光、名牌、整段的倒數條，以及頻道徽章（駕駛艙的框另外由 c6cockpit 畫）
  cineOv_c6pre(x, W, H, lt, S) {
    const c = this.cine;
    const s = H / 720;
    const k = clamp(1 - c.t / Math.max(0.1, c.def.dur - 0.3), 0, 1);
    x.save();
    // 寂靜：整個戰場壓暗，只剩門的光
    const vg = x.createRadialGradient(W / 2, H * 0.5, H * 0.1, W / 2, H * 0.5, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0.62)');
    vg.addColorStop(1, 'rgba(0,0,0,0.9)');
    x.fillStyle = vg;
    x.fillRect(0, 0, W, H);
    // 門：出口的位置畫一道直立的光（委託方的顏色），越接近越亮
    for (const o of S.opts || []) {
      const on = clamp((c.t - (o.lit || 0)) / 0.8, 0, 1);
      if (on <= 0) continue;
      const p0 = this.cinePt({ ex: o.ex, o: [0, 0, 0] }).project(this.camera),
        p1 = this.cinePt({ ex: o.ex, o: [0, 9, 0] }).project(this.camera);
      if (p0.z > 1 || Math.abs(p0.x) > 1.3) continue;
      const sx = (p0.x * 0.5 + 0.5) * W,
        sy0 = (-p0.y * 0.5 + 0.5) * H,
        sy1 = (-p1.y * 0.5 + 0.5) * H;
      const hh = Math.max(40 * s, sy0 - sy1);
      const ww = hh * 0.3;
      const fl = (0.85 + Math.sin(c.t * 2.3 + o.ex) * 0.1) * on;
      x.globalCompositeOperation = 'lighter';
      const g = x.createRadialGradient(sx, sy0 - hh / 2, 0, sx, sy0 - hh / 2, hh * 0.9);
      g.addColorStop(0, rgbaOf(o.color, 0.55 * fl));
      g.addColorStop(1, rgbaOf(o.color, 0));
      x.fillStyle = g;
      x.fillRect(sx - hh, sy0 - hh * 1.4, hh * 2, hh * 1.8);
      x.fillStyle = rgbaOf(o.color, 0.75 * fl);
      x.fillRect(sx - ww / 2, sy0 - hh, ww, hh);
      x.fillStyle = `rgba(255,255,255,${0.5 * fl})`;
      x.fillRect(sx - ww * 0.18, sy0 - hh, ww * 0.36, hh);
      x.globalCompositeOperation = 'source-over';
      // 名牌
      x.globalAlpha = on;
      x.textAlign = 'center';
      x.font = `700 ${14 * s}px ${SANS}`;
      x.fillStyle = o.color;
      x.fillText(o.name, sx, sy0 + 22 * s);
      x.font = `${10 * s}px ${SANS}`;
      x.fillStyle = 'rgba(230,236,242,0.85)';
      x.fillText(o.sub, sx, sy0 + 38 * s);
      x.globalAlpha = 1;
    }
    // 倒數條（整段一條）
    const top = H * 0.1;
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.fillRect(W * 0.35, top, W * 0.3, 3 * s);
    x.fillStyle = k < 0.3 ? 'rgba(255,90,80,0.95)' : 'rgba(230,236,242,0.9)';
    x.fillRect(W * 0.35, top, W * 0.3 * k, 3 * s);
    x.font = `${11 * s}px ${MONO}`;
    x.textAlign = 'center';
    x.fillStyle = 'rgba(230,236,242,0.75)';
    x.fillText('CORE ACCESS  //  DECISION REQUIRED', W / 2, top - 7 * s);
    x.restore();
  },

  // ---------- 錄影帶倒轉（疊加）：S.vhs＝{ tc: 起始的時間碼（秒）, k: 強度 } ----------
  cineOv_c6vhs(x, W, H, lt, S) {
    const c = this.cine;
    const s = H / 720;
    const V = S.vhs || {};
    const k = V.k == null ? 1 : V.k;
    x.save();
    // 掃描線
    x.fillStyle = `rgba(0,0,0,${0.22 * k})`;
    for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1.2);
    // 追蹤雜訊：往上捲的亮帶＋橫向撕裂
    for (let i = 0; i < 3; i++) {
      const y = H - ((c.t * (0.9 + i * 0.37) * H + i * 211) % (H * 1.3));
      const h = (14 + i * 9) * s;
      const g = x.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(235,240,255,${0.22 * k})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, y, W, h);
      for (let j = 0; j < 14; j++) {
        x.fillStyle = `rgba(255,255,255,${Math.random() * 0.35 * k})`;
        x.fillRect(Math.random() * W, y + Math.random() * h, (20 + Math.random() * 120) * s, 1.5 * s);
      }
    }
    // 底部的雜訊條
    for (let j = 0; j < 60; j++) {
      x.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 * k})`;
      x.fillRect(
        Math.random() * W,
        H - (c.bar || 0) - Math.random() * 18 * s,
        (4 + Math.random() * 30) * s,
        1.5 * s,
      );
    }
    // ◀◀ 與倒退的時間碼
    const blink = Math.floor(c.t * 2) % 2 === 0;
    x.font = `${22 * s}px ${MONO}`;
    x.textAlign = 'left';
    x.fillStyle = 'rgba(240,244,248,0.92)';
    x.shadowColor = 'rgba(0,0,0,0.8)';
    x.shadowBlur = 4 * s;
    const y0 = (c.bar || 0) + 40 * s;
    if (blink || V.stop) x.fillText(V.stop ? '■ STOP' : '◀◀ REW', W * 0.07, y0);
    if (V.tc != null) {
      const t = Math.max(0, V.tc - lt * 37);
      const hh = Math.floor(t / 3600),
        mm = Math.floor((t % 3600) / 60),
        ss = Math.floor(t % 60),
        ff = Math.floor((t % 1) * 30);
      const p2 = (v) => String(v).padStart(2, '0');
      x.textAlign = 'right';
      x.fillText(`${p2(hh)}:${p2(mm)}:${p2(ss)}:${p2(ff)}`, W * 0.93, H - (c.bar || 0) - 34 * s);
    }
    x.restore();
  },

  // ---------- 墜落：軌道站往雲海落下去、拖著火光（S.fall＝{ t0: 開始墜落的絕對秒數, d: 秒 }）----------
  cineHook_c6fall(S, phase, lt, dt) {
    const c = this.cine;
    const sp = c.set && c.set.space;
    if (!sp) return;
    const g = sp.station.group;
    const st = this.cineC6St();
    if (!st.fall0) st.fall0 = { p: g.position.clone(), r: g.rotation.clone() };
    if (phase === 'exit') {
      g.position.copy(st.fall0.p);
      g.rotation.copy(st.fall0.r);
      for (const o of st.fallFx || []) o.parent && o.parent.remove(o);
      st.fallFx = null;
      return;
    }
    if (phase === 'enter') {
      // 火光：前端（艙口那一頭，往行星）的大光暈、沿著脊柱的火焰，以及往後拖的電漿尾巴
      const trail = new THREE.Mesh(
        new THREE.ConeGeometry(46, 620, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: 0xff6a28,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      trail.rotation.x = Math.PI; // 尖端在艙口、往脊柱的另一頭張開
      trail.position.y = -130 + 310;
      trail.userData.helper = true;
      g.add(trail);
      st.fallFx = [
        addGlow(g, 0xff6a30, 60, [0, -120, 0]),
        addGlow(g, 0xffa050, 34, [0, -60, 0]),
        addGlow(g, 0xff5020, 50, [0, 40, 0]),
        addGlow(g, 0xff8040, 30, [0, 150, 0]),
        trail,
      ];
      st.fallBoom = 0;
    }
    const F = S.fall || {};
    const ft = Math.max(0, c.t - (F.t0 == null ? S.at : F.t0));
    const u = clamp(ft / (F.d || 10), 0, 1);
    const e = Math.pow(u, 1.6);
    // 往行星（雲海）落下，整座站慢慢翻倒
    const dir = PLANET_C.clone().sub(st.fall0.p).normalize();
    g.position
      .copy(st.fall0.p)
      .addScaledVector(dir, e * 560)
      .add(new THREE.Vector3(220 * e, 0, -320 * e));
    g.rotation.set(st.fall0.r.x + e * 0.9, st.fall0.r.y + e * 0.3, st.fall0.r.z - e * 1.1);
    const heat = clamp(u * 1.5, 0, 1);
    (st.fallFx || []).forEach((o, i) => {
      const f = 0.85 + Math.sin(c.t * (17 + i * 5)) * 0.15;
      if (i === 4) {
        o.material.opacity = heat * heat * 0.3 * f;
        o.scale.set(0.6 + heat * 0.6, 0.3 + heat * 0.9 * f, 0.6 + heat * 0.6);
        return;
      }
      const base = [60, 34, 50, 30][i] || 30;
      o.scale.setScalar(base * (0.3 + heat * (i ? 1.4 : 3)) * f);
      o.material.opacity = Math.min(1, 0.25 + heat) * f;
    });
    // 外殼上陸續爆炸（沒有聲音）
    st.fallBoom -= dt;
    if (st.fallBoom <= 0 && !c.paused && phase === 'tick') {
      st.fallBoom = lerp(0.6, 0.18, u);
      const p = new THREE.Vector3(
        (Math.random() * 2 - 1) * 16,
        -100 + Math.random() * 360,
        (Math.random() * 2 - 1) * 16,
      );
      g.updateMatrixWorld();
      p.applyMatrix4(g.matrixWorld);
      this.fx.explosion(p, 12 + Math.random() * 16, 0xff8040, true);
      this.fx.flash(p, 34, 0xffa060, 0.5);
    }
  },
  // 故障保險的紅字
  cineOv_c6fail(x, W, H, lt) {
    const s = H / 720;
    const on = Math.floor(lt * 9) % 3 !== 0 || lt > 1.2;
    x.save();
    x.fillStyle = `rgba(120,0,0,${0.18 + Math.sin(lt * 10) * 0.06})`;
    x.fillRect(0, 0, W, H);
    if (on) {
      x.textAlign = 'center';
      x.font = `${30 * s}px ${MONO}`;
      x.fillStyle = 'rgba(255,60,50,0.95)';
      x.shadowColor = 'rgba(255,0,0,0.8)';
      x.shadowBlur = 18 * s;
      x.fillText('ATTITUDE : LOST', W / 2, H * 0.4);
      x.fillText('FAILSAFE : ENGAGED', W / 2, H * 0.4 + 40 * s);
      x.font = `700 ${18 * s}px ${SANS}`;
      x.fillText('姿態喪失。故障保險：啟動。', W / 2, H * 0.4 + 80 * s);
    }
    x.restore();
  },

  // ---------- 彼岸：推進器一排排亮起、星球在背後變小 ----------
  // S.thr＝{ rows: 亮起的間隔秒, shrink: [開始秒, 長度, 最後的比例] }
  cineHook_c6thrust(S, phase, lt) {
    const c = this.cine;
    const sp = c.set && c.set.space;
    if (!sp) return;
    const st = this.cineC6St();
    const g = sp.station.group;
    const shrinkObjs = [sp.planet, sp.atmo, sp.ring, sp.debris];
    if (phase === 'enter') {
      st.thrRows = [];
      // 推進器：艙口那一頭（−Y）往外一圈一圈
      const rows = [
        [-104, 10, 6],
        [-84, 18, 8],
        [-40, 20, 10],
        [40, 50, 12],
        [150, 50, 12],
        [250, 50, 12],
      ];
      for (const [y, r, n] of rows) {
        const row = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const sp2 = addGlow(g, 0x9fe8ff, 16, [Math.cos(a) * r, y - 4, Math.sin(a) * r]);
          sp2.material.opacity = 0;
          row.push(sp2);
        }
        st.thrRows.push(row);
      }
      st.thr0 = shrinkObjs.map((o) => ({ o, p: o.position.clone(), s: o.scale.clone() }));
      // 軌道電纜：站離開之後就斷了（藏起來）
      st.cable = sp.root.children.find(
        (o) => o.geometry && o.geometry.parameters && o.geometry.parameters.height === 2600,
      );
      if (st.cable) st.cable.visible = false;
      return;
    }
    if (phase === 'exit') {
      for (const row of st.thrRows || []) for (const o of row) o.parent && o.parent.remove(o);
      st.thrRows = null;
      for (const r of st.thr0 || []) {
        r.o.position.copy(r.p);
        r.o.scale.copy(r.s);
      }
      st.thr0 = null;
      if (st.cable) st.cable.visible = true;
      return;
    }
    const T = S.thr || {};
    const gap = T.rows || 0.55;
    (st.thrRows || []).forEach((row, i) => {
      const k = clamp((lt - 0.4 - i * gap) / 0.3, 0, 1);
      const f = 0.85 + Math.sin(c.t * 40 + i) * 0.15;
      for (const o of row) {
        o.material.opacity = k * f;
        o.scale.setScalar((10 + k * 14) * f);
      }
    });
    // 星球變小：行星、大氣、太陽能環、碎片帶在原地縮小（距離不變、半徑變小＝越離越遠）
    const [s0, sd, sk] = T.shrink || [2, 6, 0.25];
    const u = clamp((lt - s0) / sd, 0, 1);
    const k = lerp(1, sk, u * u);
    for (const r of st.thr0 || []) r.o.scale.copy(r.s).multiplyScalar(k);
  },
});
