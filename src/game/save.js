// Game：存檔（localStorage rubicon_save）
import { START_ASM, START_OWNED } from '../data/parts.js';
import { Game } from './game.js';

Object.assign(Game.prototype, {
  // ---------- save ----------
  newSave() {
    return {
      coam: 60000,
      owned: START_OWNED.slice(),
      asm: Object.assign({}, START_ASM),
      items: { cs_bomber: 2, cs_ally: 1 },
      level: 1,
      kills: 0,
      bosses: 0,
      missionsDone: 0,
    };
  },
  loadSave() {
    try {
      const s = localStorage.getItem('rubicon_save');
      const o = s ? JSON.parse(s) : null;
      if (o) {
        o.items = o.items || { cs_bomber: 2, cs_ally: 1 };
        o.asm.c1 = o.asm.c1 || 'cs_bomber';
        o.asm.c2 = o.asm.c2 || 'cs_ally';
        for (const id of ['cs_none', 'cs_bomber', 'cs_ally']) if (!o.owned.includes(id)) o.owned.push(id);
      }
      return o;
    } catch (e) {
      return null;
    }
  },
  writeSave() {
    try {
      localStorage.setItem('rubicon_save', JSON.stringify(this.save));
    } catch (e) {}
  },
});
