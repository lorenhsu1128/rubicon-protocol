// 進入點：載入所有 Game／MechEntity 擴充後建立遊戲實例
import { Game } from './game/game.js';

import './game/render-setup.js';
import './game/save.js';
import './game/input.js';
import './game/settings.js';
import './game/garage.js';
import './game/mission.js';
import './game/player.js';
import './game/camera.js';
import './game/hud.js';
import './game/mp-lobby.js';
import './game/mp-host.js';
import './game/mp-client.js';
import './entities/mech-remote.js';
import './game/map-extras.js';
import './game/first-person.js';
import './game/pvp.js';

export const game = new Game();
