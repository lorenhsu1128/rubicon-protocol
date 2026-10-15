# 過場動畫（劇情動畫）

> 狀態：已實作（序章＋各章開場／章末）。引擎在 `src/game/cine.js`，劇本資料在 `src/data/cine/`，太空場景與空降艙在 `src/render/cine-sets.js`，配樂在 `src/assets/music/`。

## 方針

- 運鏡、節奏、構圖參考《機戰傭兵6》的劇情預告片（`test-results/ACVI_storyboard_frames` 的影格分析），內容是本作的世界觀（訊號、R-07、ECHO、四家委託方、軌道站的回收程序），不照抄原作的台詞、造型與 Logo。
- 遊戲內即時演算：用遊戲的機甲（玩家的組裝與模型組）、地圖主題、渲染風格、特效與音效；不錄影片，HTML 不變大。
- 字幕＋無線電音效（不做語音），配樂用 CC-BY 的曲子（Gregor Quendel「Cinematic Trailer Music Collection」，`src/assets/music/CREDITS.txt`）。

## 播放流程

- 故事畫面（`game/story.js` 的 `storyNext`）：序章 `p<周目>`、章節開場 `i<周目>_<章>`、章末 `o<周目>_<章>` 有過場動畫時先播動畫，播完接下一則；**中途略過時改顯示這一則的文字畫面**（原本的全畫面逐字）。設定「劇情動畫」（`ctrl.cine`）關閉、多人時一律用文字畫面。作戰室的「章節回顧」也走同一條路。
- `state 'cine'`，主迴圈呼叫 `cineTick`。長按 Esc／Enter／空白鍵／手把 A、B、Start（觸控長按畫面）0.8 秒略過。
- 時間以配樂的 AudioContext 時間為準（換場景建地圖卡住時畫面直接跳過去，聲音不斷）；沒有配樂時用實際經過的時間。晚了 0.6 秒以上的音效與特效事件不補播。
- **過場動畫劇場**（`game/cine-lib.js`，標題的「過場動畫」，`state 'cinelib'`）：依周目與三個抉擇的選擇列出全部過場動畫（序章、各章開場／章末、抉擇的選前與選後），不寫存檔、不看「劇情動畫」設定。播放時（`cine.lib`）上方有控制列：暫停（空白鍵／P；暫停時時間與模擬都不動、配樂停止，繼續時從那一秒重新排配樂）、±5 秒（←／→）、上一鏡／下一鏡（Shift＋←／→、[ ]）、時間軸拖曳、H 隱藏、「返回清單」或長按 Esc；勾「連續播放」時播完接下一段。抉擇的選前演出原本在目前的戰場上播（`k: 'live'`），劇場改在那個抉擇的地圖（c2 水壩、c4 宇宙港、c6 荒野）上由 `cineStandIn` 擺主角與出口（`set.exits`，`cinePt` 的 `ex` 先看它）。
- 配樂不內嵌在遊戲的 HTML：建置產生 `dist/lib/cine-music.js`（`window.RUBICON_MUSIC`，約 4 MB），第一次播過場動畫時以 `<script>` 載入（`cineMusicLoad`），最多等 6 秒，載不到也照樣播。

## 劇本格式（`data/cine/*.js`）

產生器 `(ctx: { cycle, choices }) => { title, dur, lb, music, shots }`，目錄在 `data/cine/index.js`（鍵和故事畫面相同）。

- `music`：`[{ at, track, vol, off, fadeIn, fadeOut: [開始秒, 長度] }]`，曲名＝`src/assets/music/<曲名>.mp3`。
- `shots`：依 `at`（秒）排序的鏡頭，每個鏡頭：
  - `set`：`{ k: 'black' }`／`{ k: 'space', coral }`／`{ k: 'world', theme, variant, seed, tod, rail, road, clear, anchor, align: 'rail', light }`。和上一鏡相同（JSON 相同）就沿用同一張地圖與演員；不同就重建（所以換場景放在黑畫面或閃白後）。`clear`＝原點附近要多大的空地（`cineSpot`）；`align: 'rail'`＝原點在鐵路上、局部 +X 沿著鐵路。
  - `actors`：`{ id, k, ... }`：`hero`（玩家的組裝）、`ace`（`ACES` 的宿敵）、`roster`（具名 AC）、`type`（`ENEMY_TYPES`／`FOES`）＝遊戲的機甲實體；`model`（Boss 模型 `key`）、`pod`（空降艙）、`crash`（墜落現場）、`worm`（鑽地蟲，身體沿頭的軌跡）、`train`（武裝列車）＝照關鍵影格 `keys: [{ t, p, r, s, thrust, heat, lin }]` 移動的模型。`parent: 'station'` 掛在軌道站上（p 是軌道站的局部座標）。機甲的 `s`＝時間軸上的動作。`drop`：這一鏡移除的演員。
  - 演員的動作（`s` 或事件的 `a`）：`go`（走到）、`stop`、`aim`（演員 id 或點）、`fire`（武器槽或 `'all'`＋`dur`、`at`）、`qb`（[x, z] 方向的快速推進）、`ab`（突擊推進）、`hover`、`jump`、`melee`、`ai`（交給遊戲的 AI）、`warp`、`die`、`rise`（從坑裡站起來）、`hide`。演員的 AP 不會歸零，要倒下的用 `die`。
  - `cam`：`{ keys: [{ t, p, l, fov, roll }], ease: 'lin'|'in'|'out', follow, hand（手持晃動）, shake, dof（景深強度）, focus, range, fog（霧往外推）, snap, free }`。
  - 點的寫法：`[x, y, z]`（相對場景原點）、`{ g: [x, z], h }`（貼地）、`{ a: 演員, o: [x, y, z], loc（依演員朝向）, at: 'head'|'base' }`、`{ st: [x, y, z] }`（軌道站的局部座標）。
  - `ev`：`{ t, ... }`：`sfx`（`at` 有位置）、`loop`、`boom`（爆炸，`big`、`kill`）、`fx`（flash、killBurst、shockwave、beam、dust、smoke、streaks、pillar、ring、warnLine、pulse、fire、flame、muzzle）、`shake`、`slow`（慢動作，只影響模擬）、`flash`（閃白／閃色）、`sub`＋`who`（字幕；`who`＝SPEAKERS 的鍵，有說話者時播無線電音效）、`card`＋`s`＋`style`（字卡：card 黑底電影字距、logo、chapter、name 宿敵名牌、loc 地點）、`sys`（左下的機器文字，系統日誌逐字）、`call`（函式）。
  - `grade`：這一鏡的調色（渲染風格的參數，疊在玩家選的風格＋過場的基本調色 `CINE_GRADE` 上；景深 `dof` 也在這裡）。
  - `fi`／`fo`：淡入／淡出秒數，`fc` 顏色，`fade`：整鏡蓋黑（後面在建地圖）。`ov`：疊加畫面（signal 訊號波形、boot 駕駛艙開機、speed 突入的速度線、scan 監視器掃描線、lock 機戰傭兵6 式的戰鬥 HUD：準星、鎖定框套住鏡頭的 `lock` 指定的演員、目標的 AP／ACS、彈數與 EN）。`lb: false` 不要遮幅。`sun`：太空場景的太陽方向。

## 序章（`data/cine/prologue.js`，約 2 分 12 秒）

| 時間 | 段落   | 內容                                                                                                                                                                                                                                                                                       |
| ---- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00 | 訊號   | 黑畫面、紅色波形、三張字卡                                                                                                                                                                                                                                                                 |
| 0:13 | 軌道   | 行星（夜側的 Coral 紅色脈絡）、碎片帶、太陽能環、斜插的軌道電纜；機器文字「CYCLE ████ TERMINATED」                                                                                                                                                                                         |
| 0:22 | 軌道站 | 外殼的推軌、艙口的燈轉紅；軌道站語音「第 ██ 週期，終了」「投放程序，開始」                                                                                                                                                                                                                 |
| 0:30 | 投放   | 夾爪鬆開、推進器點火；「投放座標：南部荒野」                                                                                                                                                                                                                                               |
| 0:34 | 墜落   | 從上方看空降艙墜向雲層                                                                                                                                                                                                                                                                     |
| 0:38 | 突入   | 電漿外殼、速度線、震動；0:45.8 配合配樂最強的一擊閃白                                                                                                                                                                                                                                      |
| 0:46 | 世界   | CORAL 字卡 → 四家委託方與軌道站的空景（每 3 秒，對齊配樂的脈動）：卡斯特隆的 MT 縱隊、戰車、重型 MT 砲擊、直升機、起重機砲台；艾瑟立克的無人機、雷射網、護盾產生器、實驗體；維爾威的運輸機、直升機編隊、宇宙用 MT、試車台噴火；聖域的盾牌 MT、修理無人機、友軍；軌道的真空作業機、標定衛星 |
| 1:05 | 傭兵   | 「他們都需要同一種東西。不問理由的傭兵。」                                                                                                                                                                                                                                                 |
| 1:09 | 甦醒   | 駕駛艙開機（HUD 逐塊亮起）→ 墜落現場、機體站起來；ECHO 第一次通訊                                                                                                                                                                                                                          |
| 1:18 | 蒙太奇 | 水壩（MT 部隊、SLUICE）→ 夜間鐵路（武裝列車 IRON CITADEL）→ 冰原（巨型鑽地蟲；SPECIMEN 的追尾視角對射：右肩後方的鏡頭、鎖定框與 HUD、快速推進閃避、導彈命中的慢動作與失衡）；越剪越快、閃白轉場                                                                                            |
| 1:45 | ZENITH | 黑畫面後紅色天空下的 ZENITH 特寫（配樂換成鋼琴的 ident）                                                                                                                                                                                                                                   |
| 1:59 | 收尾   | 紅色天空下的剪影、Logo「RUBICON PROTOCOL」、ECHO「照你的節奏來」                                                                                                                                                                                                                           |

周目差別（`TXT`）：字卡、機器文字、開機的登錄號、ECHO 與 ZENITH 的台詞、最後一句（第 2 周目沒有「照你的節奏來」，改成旁白；第 3 周目「這一次，照我們的節奏來」）。

## 各章開場／章末與抉擇演出（`data/cine/ch1.js`～`ch6.js`、`kit.js`）

- **第二版（每章一種導演風格，`docs/cinematics-storyboard.md`）**：第 1 章西部對決、第 2 章分割畫面、第 3 章恐怖片（監視器、熱感應）、第 4 章垂直一鏡到底＋倒數、第 5 章電視牆與新聞轉播、第 6 章寂靜與駕駛艙視角；各章配樂 `cine_c1`～`cine_c6`（Kevin MacLeod，CC-BY）。各章專用的效果在 `game/cine-c<章>.js`（Game 的 mixin，名稱以 `c<章>` 開頭）：鏡頭的 `hook`（`cineHook_<名稱>(S, phase, lt, dt)`，phase＝enter／tick／exit；換鏡、`cineSeek` 與結束時呼叫 exit，掛勾建的東西放進 `set.extra` 或在 exit 清掉）、`ov`（字串或陣列，`cineOv_<名稱>(x, W, H, lt, S)` 畫在疊加畫布）、`render`（`cineRender_<名稱>(S, lt, dt)` 取代這一格的 renderMain：第 2 章的分割畫面 `c2split` 以 scissor 畫兩次、第 5 章的電視牆以多個 RenderTarget 合成）。演員的蹲低／站起（`crouch`、`rise`）每格先拿掉上一格加的量，所以暫停時不會累加。
- 每章的專屬分鏡在 `ch<章>.js`（`chapters.js` 的 `BESPOKE`；沒有專屬分鏡的才用下面的模板）。鏡頭組件 `kit.js`：`timeline`（同一張地圖連續的鏡頭自動移除上一鏡的演員，`keep` 保留）、`black` 黑底字卡／機器文字、`vista` 空景（crane／pan／push／fly／low）、`comm` 通訊分割（`ov: 'comm'`：左側徽章、名字、聲紋；`badge` 讓旁白也掛委託方）、`rival` 宿敵登場、`boss` Boss 登場、`hero` 主角（walk／boost／hover／kneel）、`shootout` 追尾視角對射兩鏡（`ov: 'lock'`）、`chapterCard`、`cut` 代價快切、`choicePre`／`choicePost` 抉擇演出。
- 抉擇演出：鍵 `x_<抉擇>_pre`（選前，`cinePlay(..., { live: true })`：場景 `{ k: 'live' }`＝目前的戰場，原點與演員 `player`＝玩家，`{ ex: i }`＝第 i 個出口，`ov: 'choice'` 畫倒數條與出口名牌；模擬暫停，播完回到原本的 state）、`x_<抉擇>_<選項>`（選後的代價蒙太奇，播完到轉場畫面）。接在 `campaign.js` 的 `campChoiceCine`（抉擇出口出現時、`campLeave`）；多人、劇情動畫關閉時不播。

### 舊的模板（`data/cine/chapters.js`）

- 台詞就是 `CHAPTER_TEXT`（依抉擇 `pickLines`，所以第 2、4 章的章末依抉擇不同），一句一個鏡頭，長度依字數（3.4～7 秒）。
- 每章的 `BEATS[章].intro／outro` 是鏡頭清單，依序配給每一句（句子比鏡頭多時重複最後一個）：`vista`（空景：crane 升起／pan 橫移／push 推近／fly 低空飛越）、`hero`（主角：walk／boost／hover）、`fight`（主角對一群敵人）、`boss`（Boss 模型登場）、`rival`（宿敵的特寫＋名牌）、`comm`（安靜的鏡頭＋掃描線，委託方的通訊）。
- 開場：黑底 CHAPTER 字卡 → 台詞 → 章名卡（主角的鏡頭）；章末：黑底章名字卡 → 台詞 → 淡出。配樂：開場 `cine_drive`、章末 `cine_tension`。
- 逐章重做的分鏡提案在 `docs/cinematics-storyboard.md`。
- 章節回顧（`storyUnlocked`）：看過的＋依進度開放的（序章、到目前章節的開場、完成的章的章末、以前周目的全部），劇本改版前的舊存檔也看得到。
- 改台詞只要改 `data/story.js`（文字畫面與過場動畫共用）；換鏡頭改 `BEATS`。

## 測試與調整

- 冒煙測試 `testCine`：36 段劇本都產生得出來、序章播到結束、各段落的截圖（`test-results/cine-*.png`）、長按略過、作戰室的接續（略過 → 文字畫面）、設定關閉、手機橫式、過場動畫劇場（清單、代替的戰場、暫停、下一鏡、返回清單）。
- 調運鏡（或直接用標題的「過場動畫」劇場）：`?test` 開啟後在主控台 `__game.cineTest = 1; __game.cinePlay('p1')`，`__game.cineSeek(秒)` 跳到指定時間；`cineTest` 是沒有配樂時的倍速。
