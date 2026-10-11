// ===== SOUND DATA — CC0/CC-BY: Free Firearm Sound Library, Kenney Sci-Fi, JC Sounds Sci-Fi Pack Vol 1 (CC-BY 4.0), elnineo/NenadSimic explosions (CC0), dklon Big Explosion (CC-BY 3.0), EZduzziteh thruster (CC0) =====
// 第 14 期追加（全部 CC0）：Kenney Impact Sounds／Sci-Fi Sounds／Interface Sounds（kenney.nl）、OpenGameArt 的 rubberduck「100 CC0 SFX」「100 CC0 SFX 2」「30 CC0 SFX loops」、
// Spring Spring「Mechanical Explosion」、JaggedStone「Loopable Dungeon Ambience」、alxl「Rain on Window Loop」
// 建置時 esbuild 以 base64 loader 把 mp3 內嵌成字串
import alarm from '../assets/sfx/alarm.mp3';
import alarmBig from '../assets/sfx/alarmBig.mp3';
import ambCave from '../assets/sfx/ambCave.mp3';
import ambHum from '../assets/sfx/ambHum.mp3';
import ambLow from '../assets/sfx/ambLow.mp3';
import ambMach from '../assets/sfx/ambMach.mp3';
import ambRain from '../assets/sfx/ambRain.mp3';
import ambWater from '../assets/sfx/ambWater.mp3';
import armor1 from '../assets/sfx/armor1.mp3';
import armor2 from '../assets/sfx/armor2.mp3';
import armor3 from '../assets/sfx/armor3.mp3';
import bell from '../assets/sfx/bell.mp3';
import bong from '../assets/sfx/bong.mp3';
import boom1 from '../assets/sfx/boom1.mp3';
import boom2 from '../assets/sfx/boom2.mp3';
import boostDown from '../assets/sfx/boostDown.mp3';
import boostUp from '../assets/sfx/boostUp.mp3';
import charge from '../assets/sfx/charge.mp3';
import clatter1 from '../assets/sfx/clatter1.mp3';
import clatter2 from '../assets/sfx/clatter2.mp3';
import crunch1 from '../assets/sfx/crunch1.mp3';
import crunch2 from '../assets/sfx/crunch2.mp3';
import crunch3 from '../assets/sfx/crunch3.mp3';
import debris from '../assets/sfx/debris.mp3';
import distant from '../assets/sfx/distant.mp3';
import dome1 from '../assets/sfx/dome1.mp3';
import dome2 from '../assets/sfx/dome2.mp3';
import door from '../assets/sfx/door.mp3';
import doorOpen from '../assets/sfx/doorOpen.mp3';
import engineHi from '../assets/sfx/engineHi.mp3';
import engineLoop from '../assets/sfx/engineLoop.mp3';
import explode from '../assets/sfx/explode.mp3';
import explode2 from '../assets/sfx/explode2.mp3';
import explode3 from '../assets/sfx/explode3.mp3';
import explodeBig from '../assets/sfx/explodeBig.mp3';
import glass from '../assets/sfx/glass.mp3';
import glitch from '../assets/sfx/glitch.mp3';
import heavy from '../assets/sfx/heavy.mp3';
import hit from '../assets/sfx/hit.mp3';
import hit2 from '../assets/sfx/hit2.mp3';
import hit3 from '../assets/sfx/hit3.mp3';
import laser from '../assets/sfx/laser.mp3';
import laser2 from '../assets/sfx/laser2.mp3';
import laserBig from '../assets/sfx/laserBig.mp3';
import laserBig2 from '../assets/sfx/laserBig2.mp3';
import laserCharged from '../assets/sfx/laserCharged.mp3';
import mg from '../assets/sfx/mg.mp3';
import missile from '../assets/sfx/missile.mp3';
import overload from '../assets/sfx/overload.mp3';
import pistol from '../assets/sfx/pistol.mp3';
import plate1 from '../assets/sfx/plate1.mp3';
import plate2 from '../assets/sfx/plate2.mp3';
import punch1 from '../assets/sfx/punch1.mp3';
import punch2 from '../assets/sfx/punch2.mp3';
import rifle from '../assets/sfx/rifle.mp3';
import rifle2 from '../assets/sfx/rifle2.mp3';
import rock1 from '../assets/sfx/rock1.mp3';
import rock2 from '../assets/sfx/rock2.mp3';
import shield from '../assets/sfx/shield.mp3';
import shotgun from '../assets/sfx/shotgun.mp3';
import splash from '../assets/sfx/splash.mp3';
import stagger from '../assets/sfx/stagger.mp3';
import stepConc1 from '../assets/sfx/stepConc1.mp3';
import stepConc2 from '../assets/sfx/stepConc2.mp3';
import stepConc3 from '../assets/sfx/stepConc3.mp3';
import stepSnow1 from '../assets/sfx/stepSnow1.mp3';
import stepSnow2 from '../assets/sfx/stepSnow2.mp3';
import stepWet1 from '../assets/sfx/stepWet1.mp3';
import stepWet2 from '../assets/sfx/stepWet2.mp3';
import thrBurst from '../assets/sfx/thrBurst.mp3';
import thrustLoop from '../assets/sfx/thrustLoop.mp3';
import thud1 from '../assets/sfx/thud1.mp3';
import thud2 from '../assets/sfx/thud2.mp3';
import ui from '../assets/sfx/ui.mp3';
import ui2 from '../assets/sfx/ui2.mp3';
import uiBack from '../assets/sfx/uiBack.mp3';
import uiClick from '../assets/sfx/uiClick.mp3';
import uiErr from '../assets/sfx/uiErr.mp3';
import uiOk from '../assets/sfx/uiOk.mp3';
import uiOpen from '../assets/sfx/uiOpen.mp3';
import uiSel from '../assets/sfx/uiSel.mp3';
import uiTick from '../assets/sfx/uiTick.mp3';
import uiTog from '../assets/sfx/uiTog.mp3';

export const SFX_DATA = {
  alarm,
  alarmBig,
  ambCave,
  ambHum,
  ambLow,
  ambMach,
  ambRain,
  ambWater,
  armor1,
  armor2,
  armor3,
  bell,
  bong,
  boom1,
  boom2,
  boostDown,
  boostUp,
  charge,
  clatter1,
  clatter2,
  crunch1,
  crunch2,
  crunch3,
  debris,
  distant,
  dome1,
  dome2,
  door,
  doorOpen,
  engineHi,
  engineLoop,
  explode,
  explode2,
  explode3,
  explodeBig,
  glass,
  glitch,
  heavy,
  hit,
  hit2,
  hit3,
  laser,
  laser2,
  laserBig,
  laserBig2,
  laserCharged,
  mg,
  missile,
  overload,
  pistol,
  plate1,
  plate2,
  punch1,
  punch2,
  rifle,
  rifle2,
  rock1,
  rock2,
  shield,
  shotgun,
  splash,
  stagger,
  stepConc1,
  stepConc2,
  stepConc3,
  stepSnow1,
  stepSnow2,
  stepWet1,
  stepWet2,
  thrBurst,
  thrustLoop,
  thud1,
  thud2,
  ui,
  ui2,
  uiBack,
  uiClick,
  uiErr,
  uiOk,
  uiOpen,
  uiSel,
  uiTick,
  uiTog,
};
