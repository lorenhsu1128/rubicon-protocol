// 第 6 章 軌道（寂靜與駕駛艙視角） 過場動畫專用的效果（Game 的 mixin，不 export）。
// 劇本（data/cine/ch6.js）的鏡頭以 hook／ov／render 指定：
//   cineHook_<名稱>(S, phase, lt, dt)：phase＝'enter'／'tick'／'exit'
//   cineOv_<名稱>(x, W, H, lt, S)：在疊加畫布（2D）上畫
//   cineRender_<名稱>(S, lt, dt)：取代這一格的 renderMain
// 名稱一律以 c6 開頭，避免和別章重複。
import { Game } from './game.js';

Object.assign(Game.prototype, {});
