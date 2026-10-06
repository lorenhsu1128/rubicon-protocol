// 全螢幕：標題畫面與暫停選單的「全螢幕」按鈕（平板沒有鍵盤，靠按鈕進出）
import { Game } from './game.js';

const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

Object.assign(Game.prototype, {
  fsSupported() {
    const d = document.documentElement;
    return !!(d.requestFullscreen || d.webkitRequestFullscreen) && document.fullscreenEnabled !== false;
  },
  setupFullscreen() {
    const btns = ['btnFullscreen', 'btnFullscreenP'].map((id) => document.getElementById(id));
    // 不支援（例如 iPhone 的 Safari）時不顯示按鈕
    if (!this.fsSupported()) {
      for (const b of btns) b.style.display = 'none';
      return;
    }
    const sync = () => {
      const on = !!fsElement();
      for (const b of btns) b.textContent = on ? '離開全螢幕' : '全螢幕';
      // Chrome／Edge：全螢幕時鎖定 Esc，讓 Esc 照常暫停（長按 Esc 才離開全螢幕）
      const kb = navigator.keyboard;
      if (kb && kb.lock) {
        if (on) kb.lock(['Escape']).catch(() => {});
        else kb.unlock();
      }
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    for (const b of btns) b.onclick = () => this.toggleFullscreen();
    sync();
  },
  toggleFullscreen() {
    const d = document.documentElement;
    if (fsElement()) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      const r = exit && exit.call(document);
      if (r && r.catch) r.catch(() => {});
    } else {
      const req = d.requestFullscreen || d.webkitRequestFullscreen;
      const r = req.call(d, { navigationUI: 'hide' });
      if (r && r.catch) r.catch(() => this.flashMsg && this.flashMsg('無法切換成全螢幕', 0xff8a8a, 1.4));
    }
  },
});
