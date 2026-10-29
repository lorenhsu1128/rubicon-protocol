// 進入點：載入所有 Game／MechEntity 擴充後建立遊戲實例
import { Game } from './game/game.js';

import './game/render-setup.js';
import './game/save.js';
import './game/input.js';
import './game/settings.js';
import './game/local-lib.js';
import './game/garage.js';
import './game/garage-ui.js';
import './game/hangar.js';
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
import './game/lab-demo.js';
import './game/fullscreen.js';
import './game/campaign.js';
import './game/comms.js';
import './game/hub.js';
import './game/hub-holo.js';
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
import './entities/mech-ranged.js'; // 遠程射擊：邊閃邊打的加成（docs/ranged-design.md）
import './entities/mech-weak.js'; // 遠程射擊：弱點、打斷預警、QB 甩掉導彈
import './entities/mech-charge.js'; // 遠程射擊：蓄力射擊（強力彈、連發、充能）
import './entities/mech-react.js'; // 遠程射擊：屬性反應
import './entities/mech-feel.js'; // 遠程射擊：手感（受擊反應、命中標記、主動裝填）
import './entities/mech-style.js'; // 遠程射擊：風格評價（射擊與近戰共用）
import './entities/mech-trails.js'; // 動作的特效：刀光、地面的推進氣流帶、腳印（機甲動作第四期）
import './entities/mech-trails.js'; // 動作的特效：刀光、地面的推進氣流帶、腳印（機甲動作第四期）
import './entities/mech-foe-d2.js';
import './entities/mech-foe-b1.js';
import './entities/mech-foe-b2.js'; // 擴充：第 2 章的新敵人（B2）
import './entities/mech-foe-c1.js';
import './entities/mech-foe-c2.js'; // 地圖專屬敵人擴充（C2 組）
import './game/sim.js';
import './game/tutorial.js';
import './game/tutorial-ranged.js';
import './game/waves.js';
import './game/ai-director.js';
import './game/goals.js';
import './entities/mech-sense.js';
import './entities/mech-moves.js';
import './game/outposts.js';
import './game/feedback.js';
import './game/juice.js';
import './game/ranged.js'; // 遠程射擊：邊閃邊打的回饋與 HUD
import './game/weak.js'; // 遠程射擊：弱點的 HUD 與追尾視角的改瞄
import './game/feel.js'; // 遠程射擊：命中標記與主動裝填的畫面
import './game/style-meter.js'; // 遠程射擊：風格評價的 HUD
import './game/status-hud.js';
import './game/textfx.js';
import './game/level-play.js';
import './game/level-net.js';
import './game/levels.js';
import './game/editor.js';
import './game/editor-ui.js';
import './game/editor-trig.js';
import './game/editor-pick.js';

new Game();
