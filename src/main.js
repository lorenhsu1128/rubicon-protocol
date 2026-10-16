// 進入點：載入所有 Game／MechEntity 擴充後建立遊戲實例
import { Game } from './game/game.js';

import './game/render-setup.js';
import './game/save.js';
import './game/input.js';
import './game/settings.js';
import './game/local-lib.js';
import './game/garage.js';
import './game/pilot.js';
import './game/pilot-ui.js';
import './game/mission.js';
import './game/player.js';
import './game/camera.js';
import './game/hud.js';
import './game/mp-lobby.js';
import './game/mp-host.js';
import './game/mp-client.js';
import './entities/mech-remote.js';
import './entities/mech-special.js';
import './entities/mech-boss.js';
import './entities/mech-boss2.js';
import './entities/mech-boss3.js';
import './game/map-extras.js';
import './game/shockwave.js';
import './game/support.js';
import './game/bosses.js';
import './game/bosses2.js';
import './game/hazards2.js';
import './game/first-person.js';
import './game/chase.js';
import './game/pad-ui.js';
import './game/pvp.js';
import './game/mp-models.js';
import './game/style-lab.js';
import './game/fullscreen.js';
import './game/campaign.js';
import './game/comms.js';
import './game/hub.js';
import './game/story.js';
import './game/cine.js';
import './game/cine-lib.js';
import './game/cine-c1.js';
import './game/cine-c2.js';
import './game/cine-c3.js';
import './game/cine-c4.js';
import './game/cine-c5.js';
import './game/cine-c6.js';
import './game/tactics.js';
import './game/guide.js';
import './game/range.js';
import './game/campaign-mp.js';
import './entities/mech-objective.js';
import './entities/mech-foe.js';
import './entities/mech-status.js';
import './entities/mech-foe-d2.js';
import './entities/mech-foe-b1.js';
import './entities/mech-foe-b2.js'; // 擴充：第 2 章的新敵人（B2）
import './entities/mech-foe-c1.js';
import './entities/mech-foe-c2.js'; // 地圖專屬敵人擴充（C2 組）
import './game/sim.js';
import './game/waves.js';
import './game/ai-director.js';
import './game/goals.js';
import './entities/mech-sense.js';
import './entities/mech-moves.js';
import './game/outposts.js';
import './game/feedback.js';
import './game/juice.js';
import './game/status-hud.js';
import './game/textfx.js';
import './game/level-play.js';
import './game/level-net.js';
import './game/levels.js';
import './game/editor.js';
import './game/editor-ui.js';
import './game/editor-trig.js';
import './game/editor-pick.js';
import './game/rts-preview.js';
import './game/rts-fog.js'; // Coral 戰爭的戰爭迷霧
import './game/rts-input.js'; // Coral 戰爭的鏡頭、選取、快捷鍵
import './game/rts-hud.js'; // Coral 戰爭的 HUD（資源列、小地圖、選取面板、指令卡）
import './game/rts.js'; // Coral 戰爭的核心：選單、開局、資源、生產、建造、勝敗
import './game/rts-orders.js'; // Coral 戰爭的指令發佈、尋路排隊
import './game/rts-grid.js'; // Coral 戰爭 R3：艾瑟立克的導管網、融合、幻象、結晶護壁
import './entities/mech-rts.js'; // Coral 戰爭的單位行為
import './entities/mech-rts-aeth.js'; // Coral 戰爭 R3：艾瑟立克的兵種行為（近戰、技能、雷射網、融合的外觀）
import './game/rts-ai.js'; // Coral 戰爭的電腦對手
import './game/rts-pilot.js'; // Coral 戰爭的親自駕駛、自動管家
import './game/rts-neutral.js'; // Coral 戰爭的中立：野怪營地、酒館、商店、傭兵營
import './entities/mech-rts-creep.js'; // Coral 戰爭的野怪行為
import './game/rts-hero.js'; // Coral 戰爭的英雄與道具（經驗、光環、道具、商店、酒館）
import './entities/mech-rts-hero.js'; // Coral 戰爭的英雄：技能的施放與實體端

new Game();
