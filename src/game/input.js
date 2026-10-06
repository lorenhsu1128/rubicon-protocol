// Game：鍵盤／滑鼠、手把、觸控虛擬搖桿與震動
import { SFX } from '../audio/audio.js';
import { clamp } from '../core/math.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ---------- 自訂按鍵 ----------
  defaultKeys() {
    return {
      up: 'KeyW',
      down: 'KeyS',
      left: 'KeyA',
      right: 'KeyD',
      qb: 'ShiftLeft',
      jump: 'Space',
      ab: 'KeyF',
      fireR: 'Mouse0',
      fireL: 'Mouse2',
      backL: 'KeyQ',
      backR: 'KeyE',
      lock: 'Tab',
      kit: 'KeyR',
      cs1: 'Digit1',
      cs2: 'Digit2',
      pause: 'Escape',
    };
  },
  loadKeys() {
    try {
      const k = JSON.parse(localStorage.getItem('rubicon_keys') || 'null');
      const o = JSON.parse(localStorage.getItem('rubicon_ctrl') || 'null');
      this.keymap = Object.assign(this.defaultKeys(), k || {});
      this.ctrl = Object.assign(
        {
          aim: 'mouse',
          moveRel: 'screen',
          holdFire: true,
          rumble: true,
          touch: 'auto',
          autoFire: false,
          view: 'tps',
          sens: 1,
          pace: 0.85,
        },
        o || {},
      );
      const pm = JSON.parse(localStorage.getItem('rubicon_pad') || 'null');
      this.padmap = Object.assign(this.defaultPad(), pm || {});
    } catch (e) {
      this.keymap = this.defaultKeys();
      this.padmap = this.defaultPad();
      this.ctrl = { aim: 'mouse', moveRel: 'screen', holdFire: true, rumble: true, touch: 'auto' };
    }
  },
  saveKeys() {
    try {
      localStorage.setItem('rubicon_keys', JSON.stringify(this.keymap));
      localStorage.setItem('rubicon_ctrl', JSON.stringify(this.ctrl));
      localStorage.setItem('rubicon_pad', JSON.stringify(this.padmap));
    } catch (e) {}
  },
  act(name) {
    return (
      !!this.down[this.keymap[name]] ||
      !!this.down[this.padmap[name]] ||
      !!(this.touchmap && this.down[this.touchmap[name]]) ||
      (name === 'fireR' && !!this.down['Touch_meleeR']) ||
      (name === 'fireL' && !!this.down['Touch_meleeL'])
    );
  },
  // ---------- Xbox 360 / 標準手把（Gamepad API） ----------
  defaultPad() {
    return {
      qb: 'Pad1',
      jump: 'Pad0',
      ab: 'Pad3',
      fireR: 'Pad7',
      fireL: 'Pad6',
      backR: 'Pad5',
      backL: 'Pad4',
      lock: 'Pad11',
      kit: 'Pad2',
      cs1: 'Pad12',
      cs2: 'Pad13',
      pause: 'Pad9',
    };
  },
  padLabel(code) {
    const n = {
      Pad0: 'A',
      Pad1: 'B',
      Pad2: 'X',
      Pad3: 'Y',
      Pad4: 'LB',
      Pad5: 'RB',
      Pad6: 'LT',
      Pad7: 'RT',
      Pad8: 'Back',
      Pad9: 'Start',
      Pad10: 'LS 按下',
      Pad11: 'RS 按下',
      Pad12: '十字鍵上',
      Pad13: '十字鍵下',
      Pad14: '十字鍵左',
      Pad15: '十字鍵右',
    };
    return n[code] || code || '—';
  },
  // ---------- 震動回饋（Chrome/Edge: vibrationActuator；Firefox: hapticActuators） ----------
  rumble(strong, weak, ms) {
    if (!this.ctrl.rumble) return;
    if (this.touchActive || (this.touchAvailable() && !this.padConnected)) {
      const s = Math.max(strong, weak * 0.6);
      if (s > 0.12) this.vibrate(Math.round(clamp(ms * s, 15, 400)));
      if (!this.padConnected) return;
    }
    if (!this.padConnected) return;
    const gps = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!gps) return;
    let gp = null;
    for (const g of gps) {
      if (g && g.connected) {
        gp = g;
        break;
      }
    }
    if (!gp) return;
    const now = performance.now();
    if (this.rumbleUntil > now && this.rumbleStrong > strong + 0.15) return; // 正在播放更強的回饋就不打斷
    this.rumbleUntil = now + ms;
    this.rumbleStrong = strong;
    const s = clamp(strong, 0, 1),
      w = clamp(weak, 0, 1);
    try {
      if (gp.vibrationActuator && gp.vibrationActuator.playEffect) {
        gp.vibrationActuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: ms,
          strongMagnitude: s,
          weakMagnitude: w,
        });
      } else if (gp.hapticActuators && gp.hapticActuators[0] && gp.hapticActuators[0].pulse) {
        gp.hapticActuators[0].pulse(Math.max(s, w), ms);
      }
    } catch (e) {}
  },
  // 依距離衰減的爆炸震動
  rumbleAt(pos, strong, weak, ms, radius = 30) {
    if (!this.player) return;
    const d = this.player.center().distanceTo(pos);
    if (d > radius) return;
    const k = 1 - d / radius;
    this.rumble(strong * k, weak * k, ms);
  },
  // ---------- 觸控虛擬手把 ----------
  touchAvailable() {
    return 'ontouchstart' in window || (navigator.maxTouchPoints || 0) > 0;
  },
  vpadWanted() {
    const m = this.ctrl.touch || 'auto';
    return m === 'on' || (m === 'auto' && this.touchAvailable() && !this.padConnected);
  },
  setupTouch() {
    const vp = document.getElementById('vpad');
    this.vpadEl = vp;
    this.touchMove = new THREE.Vector3();
    this.touchAim = new THREE.Vector3();
    const stick = (el, vec) => {
      let id = null;
      const knob = el.querySelector('.knob');
      const R = 55;
      const upd = (t) => {
        const r = el.getBoundingClientRect();
        const dx = t.clientX - (r.left + r.width / 2),
          dy = t.clientY - (r.top + r.height / 2);
        const L = Math.hypot(dx, dy) || 1;
        const k = Math.min(1, L / R);
        const nx = (dx / L) * k,
          ny = (dy / L) * k;
        vec.set(Math.abs(nx) < 0.12 ? 0 : nx, 0, Math.abs(ny) < 0.12 ? 0 : ny);
        knob.style.transform = `translate(${nx * R}px,${ny * R}px)`;
      };
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          SFX.init();
          this.touchActive = true;
          const t = e.changedTouches[0];
          id = t.identifier;
          upd(t);
        },
        { passive: false },
      );
      el.addEventListener(
        'touchmove',
        (e) => {
          e.preventDefault();
          for (const t of e.changedTouches) if (t.identifier === id) upd(t);
        },
        { passive: false },
      );
      const end = (e) => {
        for (const t of e.changedTouches)
          if (t.identifier === id) {
            id = null;
            vec.set(0, 0, 0);
            knob.style.transform = '';
          }
      };
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
    };
    stick(document.getElementById('vsL'), this.touchMove);
    const one = ['lock', 'kit', 'cs1', 'cs2', 'pause'];
    for (const b of vp.querySelectorAll('.vbtn')) {
      const a = b.dataset.a;
      const code = 'Touch_' + a;
      if (a === 'qbab') {
        let t0 = 0;
        b.addEventListener(
          'touchstart',
          (e) => {
            e.preventDefault();
            SFX.init();
            this.touchActive = true;
            b.classList.add('act');
            t0 = performance.now();
            this.down['Touch_qbHold'] = true;
            this.vibrate(8);
          },
          { passive: false },
        );
        const rel = (e) => {
          e.preventDefault();
          b.classList.remove('act');
          this.down['Touch_qbHold'] = false;
          this.down['Touch_ab'] = false;
          if (performance.now() - t0 < 400) {
            this.qbPulse = 2;
          }
        };
        b.addEventListener('touchend', rel);
        b.addEventListener('touchcancel', rel);
        continue;
      }
      const press = (e) => {
        e.preventDefault();
        SFX.init();
        this.touchActive = true;
        b.classList.add('act');
        if (one.includes(a)) {
          if (a === 'pause') {
            if (this.state === 'play') {
              this.state = 'pause';
              this.showScreen('pause');
            } else if (this.state === 'pause') this.resume();
          } else if (this.state === 'play') {
            if (a === 'lock') this.cycleLock();
            if (a === 'kit') this.useKit();
            if (a === 'cs1') this.useConsumable('c1');
            if (a === 'cs2') this.useConsumable('c2');
          }
          this.vibrate(15);
        } else {
          this.down[code] = true;
          this.vibrate(8);
        }
      };
      const rel = (e) => {
        e.preventDefault();
        b.classList.remove('act');
        this.down[code] = false;
      };
      b.addEventListener('touchstart', press, { passive: false });
      b.addEventListener('touchend', rel);
      b.addEventListener('touchcancel', rel);
    }
    this.touchmap = {
      qb: 'Touch_qb',
      jump: 'Touch_jump',
      ab: 'Touch_ab',
      fireR: 'Touch_fireR',
      fireL: 'Touch_fireL',
      backR: 'Touch_backR',
      backL: 'Touch_backL',
    };
    const tapLock = (e) => {
      if (!this.vpadWanted() || this.state !== 'play') return;
      const t = e.changedTouches[0];
      if (!t) return;
      const el = document.elementFromPoint(t.clientX, t.clientY);
      if (el && el.closest && el.closest('#vpad')) return;
      this.touchActive = true;
      this.tryClickLock(t.clientX, t.clientY, 60);
    };
    document.getElementById('gl').addEventListener('touchstart', tapLock, { passive: true });
    document.getElementById('hud').addEventListener('touchstart', tapLock, { passive: true });
  },
  // 智慧攻擊鍵：射擊 ↔ 近戰 自動切換；肩部鍵＝雙背齊射；QB 長按＝突擊；自動攻擊
  applySmartAttack(p, dt) {
    const d = this.down;
    if (!this.vpadWanted() && !this.padActive) return;
    const lock = p.lock && !p.lock.dead ? p.lock : null;
    const dist = lock ? lock.pos.distanceTo(p.pos) : 1e9;
    let meleeSlot = null;
    for (const s of ['rarm', 'larm']) {
      const w = p.weapons[s];
      if (w.def.type === 'melee') {
        const st = w.def.combo[0];
        const rng = (st.dash || 0) + (st.reach || 3) + 2;
        if (dist <= rng || (p.melee.active && p.melee.slot === s)) {
          meleeSlot = s;
          break;
        }
      }
    }
    const held = !!d['Touch_attack'];
    const auto = !!this.ctrl.autoFire;
    const ranged = ['rarm', 'larm'].filter((s) => {
      const t = p.weapons[s].def.type;
      return t !== 'none' && t !== 'melee';
    });
    const inRange = lock && ranged.some((s) => dist <= p.weapons[s].def.range + 4);
    d['Touch_fireR'] = d['Touch_fireL'] = false;
    d['Touch_meleeR'] = d['Touch_meleeL'] = false;
    if (meleeSlot) {
      if (held && !this._atkPrev) d[meleeSlot === 'rarm' ? 'Touch_meleeR' : 'Touch_meleeL'] = true;
    } else if (held || (auto && inRange)) {
      for (const s of ranged) d[s === 'rarm' ? 'Touch_fireR' : 'Touch_fireL'] = true;
    }
    this._atkPrev = held;
    this.smartMode = meleeSlot ? 'melee' : 'fire';
    this.meleeSlotNow = meleeSlot;
    d['Touch_backR'] = d['Touch_backL'] = !!d['Touch_shoulder'];
    if (d['Touch_qbHold']) {
      this.qbHoldT = (this.qbHoldT || 0) + dt;
      if (this.qbHoldT >= 0.4) d['Touch_ab'] = true;
    } else this.qbHoldT = 0;
    d['Touch_qb'] = false;
    if (this.qbPulse > 0) {
      this.qbPulse--;
      d['Touch_qb'] = true;
    }
    const btn = document.getElementById('vbAttack');
    if (btn) {
      const txt = meleeSlot ? '斬擊' : auto ? '近戰' : '射擊';
      if (btn.firstChild.nodeValue !== txt) {
        btn.firstChild.nodeValue = txt;
      }
      btn.classList.toggle('melee', !!meleeSlot);
      btn.classList.toggle('dim', auto && !meleeSlot);
    }
    const sb = document.getElementById('vbShoulder');
    if (sb)
      sb.style.display =
        p.weapons.rback.def.type === 'none' && p.weapons.lback.def.type === 'none' ? 'none' : '';
  },
  vibrate(ms) {
    if (!this.ctrl.rumble || !navigator.vibrate) return;
    if (!this.touchActive && !this.touchAvailable()) return;
    try {
      const ok = navigator.vibrate([Math.max(10, Math.round(ms))]);
      this.lastVib = ok;
    } catch (e) {}
  },
  updateVpad() {
    const on = this.vpadWanted() && this.state === 'play';
    if (this.vpadEl) this.vpadEl.classList.toggle('on', on);
    document.body.classList.toggle('vpad', on);
  },
  pollGamepad(dt) {
    const gps = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!gps) return;
    let gp = null;
    for (const g of gps) {
      if (g && g.connected) {
        gp = g;
        break;
      }
    }
    if (!gp) {
      if (this.padConnected) {
        this.padConnected = false;
        for (let i = 0; i < 16; i++) this.down['Pad' + i] = false;
      }
      return;
    }
    if (!this.padConnected) {
      this.padConnected = true;
      this.flashMsg('已偵測到手把：' + (gp.id || '').slice(0, 28), 0x7ee081, 1.6);
    }
    const dz = (v) => (Math.abs(v) < 0.2 ? 0 : v);
    this.padMove = new THREE.Vector3(dz(gp.axes[0] || 0), 0, dz(gp.axes[1] || 0));
    this.padAim = new THREE.Vector3(dz(gp.axes[2] || 0), 0, dz(gp.axes[3] || 0));
    if (this.padMove.length() > 0.01 || this.padAim.length() > 0.01) this.padActive = true;
    const prev = this.padPrev || {};
    const one = ['lock', 'kit', 'cs1', 'cs2', 'pause'];
    for (let i = 0; i < gp.buttons.length && i < 16; i++) {
      const b = gp.buttons[i];
      const pressed = b.pressed || b.value > 0.5;
      const code = 'Pad' + i;
      const edge = pressed && !prev[code];
      prev[code] = pressed;
      if (this.state === 'settings') {
        if (edge && this.rebinding) this.captureBinding(code);
        continue;
      }
      this.down[code] = pressed;
      if (pressed) this.padActive = true;
      if (edge && this.net && this.net.role && this.state === 'play') {
        if (code === 'Pad14') this.net.signal(0);
        if (code === 'Pad15') this.net.signal(1);
      }
      if (edge) {
        for (const nm of one) {
          if (this.padmap[nm] === code) {
            if (nm === 'pause') {
              if (this.state === 'play') {
                this.state = 'pause';
                this.showScreen('pause');
              } else if (this.state === 'pause') this.resume();
            } else if (this.state === 'play') {
              if (nm === 'lock') this.cycleLock();
              if (nm === 'kit') this.useKit();
              if (nm === 'cs1') this.useConsumable('c1');
              if (nm === 'cs2') this.useConsumable('c2');
            }
          }
        }
      }
    }
    this.padPrev = prev;
  },
  keyLabel(code) {
    if (!code) return '—';
    if (code === 'Mouse0') return '滑鼠左鍵';
    if (code === 'Mouse1') return '滑鼠中鍵';
    if (code === 'Mouse2') return '滑鼠右鍵';
    return code
      .replace(/^Key/, '')
      .replace(/^Digit/, '')
      .replace('ShiftLeft', '左 Shift')
      .replace('ShiftRight', '右 Shift')
      .replace('ControlLeft', '左 Ctrl')
      .replace('Space', '空白鍵')
      .replace('Escape', 'Esc')
      .replace('Arrow', '方向鍵 ');
  },
  bindInput() {
    this.down = {};
    this.loadKeys();
    this.setupTouch();
    document.getElementById('btnSettings').onclick = () => {
      SFX.init();
      this.openSettings('title');
    };
    // 模型庫：伺服器上是 /model-library.html，直接開檔時是同資料夾的 model-library.html
    document.getElementById('btnLibrary').onclick = () => window.open('model-library.html', '_blank');
    // 文字動畫 APNG 產生器：原生 ES Modules，只有從伺服器開啟時才能用（/apng/）
    const apng = document.getElementById('btnApng');
    if (window.RUBICON_SERVER) apng.style.display = '';
    apng.onclick = () => window.open('/apng/', '_blank');
    // 貼圖繪製（Rubicon Paint）：一般 script，直接開檔也能用（同資料夾的 paint/）
    document.getElementById('btnPaint').onclick = () =>
      window.open(window.RUBICON_SERVER ? '/paint/' : 'paint/index.html', '_blank');
    document.getElementById('btnLmReload').onclick = () => this.lmRefresh(true);
    document.getElementById('btnSettingsP').onclick = () => this.openSettings('pause');
    document.getElementById('btnSettingsBack').onclick = () => this.closeSettings();
    document.getElementById('btnKeysReset').onclick = () => {
      this.keymap = this.defaultKeys();
      this.padmap = this.defaultPad();
      this.ctrl = { aim: 'mouse', moveRel: 'screen', holdFire: true, rumble: true, touch: 'auto' };
      this.saveKeys();
      this.renderSettings();
    };
    document.getElementById('ctrlAim').onchange = (e) => {
      this.ctrl.aim = e.target.value;
      this.saveKeys();
    };
    document.getElementById('ctrlMove').onchange = (e) => {
      this.ctrl.moveRel = e.target.value;
      this.saveKeys();
    };
    document.getElementById('ctrlHold').onchange = (e) => {
      this.ctrl.holdFire = e.target.checked;
      this.saveKeys();
    };
    document.getElementById('ctrlRumble').onchange = (e) => {
      this.ctrl.rumble = e.target.checked;
      this.saveKeys();
      if (e.target.checked) {
        this.rumble(0.6, 0.6, 200);
        this.vibrate(120);
      }
    };
    document.getElementById('btnVibTest').onclick = () => {
      let msg = 'navigator.vibrate ' + (navigator.vibrate ? '可用' : '不支援');
      if (navigator.vibrate) {
        try {
          const ok = navigator.vibrate([200, 100, 300]);
          msg +=
            ' → 呼叫結果 ' +
            ok +
            '（若手機沒震：檢查系統「觸覺回饋／震動」設定、靜音模式，或此瀏覽器不支援）';
        } catch (err) {
          msg += ' 錯誤 ' + err;
        }
      }
      document.getElementById('vibMsg').textContent = msg;
    };
    document.getElementById('ctrlTouch').onchange = (e) => {
      this.ctrl.touch = e.target.value;
      this.saveKeys();
    };
    document.getElementById('ctrlAuto').onchange = (e) => {
      this.ctrl.autoFire = e.target.checked;
      this.saveKeys();
    };
    document.getElementById('ctrlView').onchange = (e) => {
      this.ctrl.view = e.target.value;
      this.saveKeys();
    };
    document.getElementById('ctrlSens').onchange = (e) => {
      this.ctrl.sens = clamp(parseFloat(e.target.value) || 1, 0.2, 4);
      this.saveKeys();
    };
    document.getElementById('ctrlPace').onchange = (e) => {
      this.ctrl.pace = parseFloat(e.target.value) || 0.85;
      this.saveKeys();
    };
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      SFX.init();
      if (this.state === 'settings') {
        e.preventDefault();
        if (this.captureBinding(e.code)) return;
        if (e.code === 'Escape') this.closeSettings();
        return;
      }
      this.keys[e.code] = true;
      this.down[e.code] = true;
      const km = this.keymap;
      if (e.code === km.lock || e.code === 'Tab') e.preventDefault();
      if (e.code === 'KeyV' && this.state === 'play') {
        this.setFp(!this.fp);
      }
      if (e.code === km.lock && this.state === 'play') {
        if (this.fp && !this.spectator && this.player) this.fpPickLock(this.player, true);
        else this.cycleLock();
      }
      if (this.spectator && this.state === 'play' && e.code === 'KeyD') {
        this.specDetail = !this.specDetail;
      }
      if (this.spectator && this.state === 'play') {
        const modes = ['follow', 'director', 'all', 'free', 'boss'];
        const names = {
          follow: '跟隨玩家',
          director: '導演視角（自動切到最激烈的玩家）',
          all: '全景（納入所有玩家）',
          free: '自由視角（拖曳平移、滾輪縮放）',
          boss: '跟隨魔王',
        };
        let m = null;
        if (e.code === 'KeyC') {
          m = modes[(modes.indexOf(this.specMode || 'follow') + 1) % modes.length];
        }
        const num = { Digit1: 'follow', Digit2: 'director', Digit3: 'all', Digit4: 'free', Digit5: 'boss' }[
          e.code
        ];
        if (num) m = num;
        if (m) {
          if (m === 'boss' && !(this.bosses && this.bosses.some((b) => !b.dead))) {
            this.flashMsg('此關沒有魔王', 0xff8a8a, 1);
          } else {
            if (m === 'free' && this.player) this.specPos = this.player.pos.clone();
            this.specMode = m;
            this.flashMsg('鏡頭：' + names[m], 0xffb020, 1.4);
          }
        }
      }
      if (e.code === km.pause) {
        if (this.net && this.net.role) {
          if (this.state === 'play') {
            this.menuOpen = !this.menuOpen;
            for (const s of document.querySelectorAll('#ui .screen'))
              s.classList.toggle('on', this.menuOpen && s.id === 'pause');
          }
        } else {
          if (this.state === 'play') {
            this.state = 'pause';
            this.showScreen('pause');
          } else if (this.state === 'pause') {
            this.resume();
          }
        }
      }
      if (this.net && this.net.role && this.state === 'play' && /^F[1-6]$/.test(e.code)) {
        e.preventDefault();
        this.net.signal(parseInt(e.code.slice(1)) - 1);
      }
      if (e.code === km.kit && this.state === 'play') this.useKit();
      if (e.code === km.cs1 && this.state === 'play') this.useConsumable('c1');
      if (e.code === km.cs2 && this.state === 'play') this.useConsumable('c2');
    });
    addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
      this.down[e.code] = false;
    });
    addEventListener('mousemove', (e) => {
      if (this.touchActive && e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.padActive = false;
      this.touchActive = false;
    });
    addEventListener('mousedown', (e) => {
      SFX.init();
      if (this.state === 'settings') {
        if (this.rebinding) {
          e.preventDefault();
          this.captureBinding('Mouse' + e.button);
        }
        return;
      }
      if (this.state !== 'play') return;
      if (this.spectator) {
        if (this.specMode === 'free' && e.button === 0) {
          this.specDrag = { x: e.clientX, y: e.clientY };
          return;
        }
        if (e.button === 0) {
          let best = null,
            bd = 1e9;
          this.players.forEach((q, i) => {
            if (q.dead) return;
            const s = this.proj(q.center());
            const d = Math.hypot(s.x - e.clientX, s.y - e.clientY);
            if (d < 50 && d < bd) {
              bd = d;
              best = i;
            }
          });
          if (best !== null) {
            const alive = this.players.filter((x) => !x.dead);
            this.spectateIdx = alive.indexOf(this.players[best]);
          }
        }
        return;
      }
      const code = 'Mouse' + e.button;
      this.down[code] = true;
      if (code === this.keymap.fireR || code === this.keymap.fireL) this.tryClickLock(e.clientX, e.clientY);
      if (code === this.keymap.lock) this.cycleLock();
      if (code === this.keymap.kit) this.useKit();
      if (code === this.keymap.cs1) this.useConsumable('c1');
      if (code === this.keymap.cs2) this.useConsumable('c2');
    });
    addEventListener('mouseup', (e) => {
      this.down['Mouse' + e.button] = false;
      this.specDrag = null;
    });
    addEventListener('mousemove', (e) => {
      if (this.specDrag && this.specPos) {
        const k = 0.09 * (this.camZoom || 1);
        this.specPos.x -= (e.clientX - this.specDrag.x) * k;
        this.specPos.z -= (e.clientY - this.specDrag.y) * k;
        this.specDrag = { x: e.clientX, y: e.clientY };
      }
    });
    addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.flashMsg('顯示卡記憶體不足，繪圖環境中斷 — 請重新整理頁面', 0xff4d4d, 6);
      console.error('WebGL context lost');
    });
    addEventListener(
      'wheel',
      (e) => {
        if (this.spectator && this.state === 'play') {
          this.specZoom = clamp((this.specZoom || 1) * (e.deltaY > 0 ? 1.12 : 0.9), 0.5, 4);
        }
      },
      { passive: true },
    );
    addEventListener('gamepadconnected', (e) => {
      SFX.init();
      this.flashMsg('手把已連接：' + (e.gamepad.id || '').slice(0, 28), 0x7ee081, 1.8);
    });
    addEventListener('blur', () => {
      this.keys = {};
      this.down = {};
    });
    const $ = (id) => document.getElementById(id);
    $('btnNew').onclick = () => {
      SFX.init();
      this.save = this.newSave();
      this.writeSave();
      this.openGarage();
    };
    $('btnContinue').onclick = () => {
      SFX.init();
      this.save = this.loadSave() || this.newSave();
      this.openGarage();
    };
    $('btnSortie').onclick = () => {
      // 單機出擊前重新讀取本地模型庫
      if (this.lmBusy) return;
      this.lmBusy = true;
      this.lmRefresh()
        .catch((e) => console.warn('本地模型庫讀取失敗', e))
        .then(() => {
          this.lmBusy = false;
          if (this.state === 'garage') this.startMission();
        });
    };
    $('btnRandomAsm').onclick = () => {
      this.randomAsm();
      this.renderGarage();
    };
    $('btnToTitle').onclick = () => {
      this.state = 'title';
      this.showScreen('title');
    };
    $('btnResultOk').onclick = () => {
      if (this.net && this.net.role) {
        this.clearMission();
        this.state = 'lobby';
        this.showScreen('lobby');
        if (this.net.role === 'host') this.net.syncLobby();
        this.renderLobby();
      } else this.openGarage();
    };
    $('btnResume').onclick = () => {
      if (this.net && this.net.role && this.state === 'play') {
        this.menuOpen = false;
        document.getElementById('pause').classList.remove('on');
      } else this.resume();
    };
    $('optPost').checked = this.post.enabled;
    $('optPost').onchange = (e) => this.setPost(e.target.checked);
    $('btnAbort').onclick = () => {
      if (this.net && this.net.role === 'client') {
        this.net.leave(true);
        this.clearMission();
        this.state = 'title';
        this.showScreen('title');
        return;
      }
      if (this.net && this.net.role === 'host') {
        // 放棄時沒有任務經驗，但擊破／支援經驗與熟練度照常發給每位玩家
        this.net.tr.broadcast({ t: 'abort', pvp: !!this.pvp, xpBySlot: this.pilotEndXpPve(false, true) });
      }
      this.endMission(false, true);
    };
  },
  tryClickLock(mx, my, rad) {
    const p = this.player;
    if (!p || p.dead) return;
    let best = null,
      bd = 1e9;
    for (const e of this.hostilesOfEnt(p)) {
      if (e.dead) continue;
      const s = this.proj(e.center());
      if (!s.in) continue;
      const r = (rad || (e.isBoss ? 70 : 40)) * (e.scale || 1);
      const d = Math.hypot(s.x - mx, s.y - my);
      if (d < r && d < bd) {
        bd = d;
        best = e;
      }
    }
    if (best && best !== p.lock) {
      p.lock = best;
      p.lockT = 0;
      SFX.ui();
    }
  },
  resume() {
    this.state = 'play';
    this.showScreen('');
    this.lastT = performance.now();
  },
});
