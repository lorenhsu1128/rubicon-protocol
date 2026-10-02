// Game：設定畫面與按鍵綁定
import { Game } from './game.js';

Object.assign(Game.prototype, {
  openSettings(from) {
    this.settingsFrom = from;
    this.state = 'settings';
    this.showScreen('settings');
    this.renderSettings();
  },
  renderSettings() {
    const $ = (id) => document.getElementById(id);
    const rows = [
      ['up', '向前'],
      ['down', '向後'],
      ['left', '向左'],
      ['right', '向右'],
      ['qb', 'Quick Boost'],
      ['jump', '跳躍／懸浮'],
      ['ab', '突擊推進'],
      ['fireR', '右手武器'],
      ['fireL', '左手武器'],
      ['backL', '左背武器'],
      ['backR', '右背武器'],
      ['lock', '切換鎖定'],
      ['kit', '修復套件'],
      ['cs1', '消耗品 1'],
      ['cs2', '消耗品 2'],
      ['pause', '暫停'],
    ];
    const padOnly = { up: '左搖桿', down: '左搖桿', left: '左搖桿', right: '左搖桿' };
    $('keyRows').innerHTML =
      `<div class="krow dim" style="font-size:11px"><span>動作</span><span style="display:flex;gap:8px"><span style="min-width:120px;text-align:center">鍵盤／滑鼠</span><span style="min-width:120px;text-align:center">手把</span></span></div>` +
      rows
        .map(
          ([k, l]) =>
            `<div class="krow"><span>${l}</span><span style="display:flex;gap:8px"><button data-k="${k}" class="kbtn ${this.rebinding === k ? 'wait' : ''}">${this.rebinding === k ? '請按鍵…' : this.keyLabel(this.keymap[k])}</button><span class="kbtn dim" style="display:inline-block;text-align:center;padding:8px 6px;border:1px solid var(--line)">${padOnly[k] || this.padLabel(this.padmap[k])}</span></span></div>`,
        )
        .join('') +
      `<p class="dim" style="font-size:11px">手把：左搖桿移動、右搖桿瞄準（放開時自動瞄準鎖定目標）；改鍵時直接按手把按鈕即可指定給手把。${this.padConnected ? '　✔ 已連接' : '　（尚未偵測到手把，按任一鍵喚醒）'}</p>`;
    for (const b of $('keyRows').querySelectorAll('.kbtn'))
      b.onclick = (ev) => {
        ev.stopPropagation();
        this.rebinding = b.dataset.k;
        this.renderSettings();
      };
    $('ctrlAim').value = this.ctrl.aim;
    $('ctrlMove').value = this.ctrl.moveRel;
    $('ctrlHold').checked = this.ctrl.holdFire;
    $('ctrlRumble').checked = this.ctrl.rumble;
    $('ctrlTouch').value = this.ctrl.touch || 'auto';
    $('ctrlAuto').checked = !!this.ctrl.autoFire;
    $('ctrlView').value = this.ctrl.view || 'tps';
    $('ctrlSens').value = this.ctrl.sens || 1;
    $('ctrlPace').value = String(this.ctrl.pace || 0.85);
    this.renderLocalModels();
  },
  captureBinding(code) {
    if (!this.rebinding) return false;
    if (code === 'Escape') {
      this.rebinding = null;
      this.renderSettings();
      return true;
    }
    const map = code.startsWith('Pad') ? this.padmap : this.keymap;
    for (const k in map) if (map[k] === code && k !== this.rebinding) map[k] = '';
    map[this.rebinding] = code;
    this.rebinding = null;
    this.saveKeys();
    this.renderSettings();
    return true;
  },
  closeSettings() {
    this.rebinding = null;
    if (this.settingsFrom === 'pause') {
      this.state = 'pause';
      this.showScreen('pause');
    } else {
      this.state = 'title';
      this.showScreen('title');
    }
  },
});
