# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

瀏覽器 3D 機甲動作遊戲（Three.js r128）＋ Windows 區網伺服器。遊戲原始碼是 `src/` 下的 ES modules，由 esbuild 打包成**單一 HTML**（CSS、JS、音效全部內嵌）；發佈形式是「`rubicon-server.exe` ＋ `rubicon-protocol.html`」兩個檔案（模型庫 `model-library.html` 選用）。

- `src/`：遊戲原始碼（見下方架構）。`src/index.html` 是 HTML 骨架，建置時把 `styles.css` 與打包後的 JS 內嵌進去。
- `src/library/`：模型庫頁面（見下方「模型庫與 GLB」），建置成 `dist/model-library.html`。
- `dist/`：建置產物 `rubicon-protocol.html`、`model-library.html`、`rubicon-server.exe`，**全部都要提交進 git**（每次改動 src/ 都要重新建置並一起 commit／push）。**不要手改 dist/**，改 `src/` 後重新建置。
- `server.js`：區網伺服器。遊戲 port 預設 80（提供遊戲頁、`/models` 模型庫、`/health`、`/ws` WebSocket 中繼），控制台固定 port 8090。開發時讀 `dist/` 的 HTML，打包成 exe 後讀 exe 同資料夾的檔案（以 `process.pkg` 判斷，改打包方式時要一併修改）。
- `scripts/build.js`：建置腳本；`scripts/smoke-test.js`：冒煙測試；`scripts/test-server-preload.js`：測試時讓 server.js 改聽 127.0.0.1 測試 port、不開瀏覽器。
- `docs/glb-spec.md`：給美術的 GLB 製作規格。
- 函式庫（three、peerjs、three examples 後處理；模型庫另有 OrbitControls、GLTFLoader、GLTFExporter）仍由各頁面的 `index.html` 從 CDN 以一般 `<script>` 載入，程式裡以全域變數 `THREE`、`Peer`、`SimplexNoise` 使用，不要改成 import。

## 指令

```bash
npm install

npm run build        # src/ → dist/rubicon-protocol.html 與 dist/model-library.html（壓縮）
npm run dev          # 監看 src/ 自動重建（不壓縮、附 source map）
npm run lint         # ESLint：server.js、scripts/、src/
npm run format       # Prettier 排版（format:check 只檢查）
npm test             # 先 build，再跑冒煙測試（見下方）
npm start            # 先 build，再啟動伺服器：控制台 http://localhost:8090/、遊戲 http://localhost/
npm run build:exe    # build ＋ 用 @yao-pkg/pkg 打包 dist/rubicon-server.exe（目標 Node 22）
```

- 每次修改後執行 `npm run lint`、`npm run format:check`，以及 `npm test`。
- port 80 被佔用時在控制台改 port，設定寫入 `rubicon-server.json`（已 gitignore）。
- 伺服器會在 `<head>` 注入 `window.RUBICON_SERVER`，遊戲據此改用 WebSocket 中繼模式；直接開 HTML 檔則走 PeerJS 模式。同一瀏覽器多分頁測試多人可加 `?lan=local`，觀戰用 `?spectate=<peerId>`。
- 模型庫：`dist/model-library.html` 直接開啟，或伺服器上的 `/models`；網址 `#槽位 id`（例如 `#mech/player`）直接開啟該模型的檢視窗。
- `dist/` 的兩個 HTML 都必須維持可以用 file:// 直接開啟：所以輸出格式是 IIFE 的一般 `<script>`，不是 `type="module"`。

### 冒煙測試（`npm test`）

用 headless Edge／Chrome（SwiftShader WebGL）跑：file:// 開啟標題畫面 → 單機出擊與放棄（結果畫面的駕駛員經驗）→ 駕駛員畫面（舊存檔遷移、配點、T2 解鎖、預設組、PvE／PvP 切換、車庫加成顯示）→ 模型庫（所有槽位建立與公尺尺寸、一行三格、檢視窗標線、範本 GLB 匯出→載入→規格檢查全通過、錯放報錯、組合預覽、移除）→ `?lan=local` 兩分頁多人（建房、加入、出擊、房主離線遷移）→ 啟動 server.js 測 `/health`、`RUBICON_SERVER` 注入、`/models` 與標題畫面的模型庫按鈕、WebSocket 中繼多人。收集 pageerror 與 console.error，截圖存到 `test-results/`（gitignore）。沒有單元測試框架；改動遊戲邏輯時看截圖確認畫面。

## 原始碼架構（src/）

```
main.js              進入點：依序 import 所有 mixin，最後 new Game()
index.html／styles.css
core/                math.js（RNG、makeRng、makeNoise、withRng、clamp/lerp/rnd…）、html.js（escHtml）
data/                parts.js（零件、START_ASM、asmStats）、enemies.js（AC_ROSTER、BOSS_DEFS、ENEMY_TYPES）、
                     skills.js（駕駛員技能樹、熟練度加成、經驗曲線）、pilot.js（駕駛員純函式：等級、配點驗證、加成套用）
render/              materials.js（Canvas 貼圖、mechMats、PALETTES、palColor）、geometry.js（幾何快取與拼接工具）、
                     mech-model.js（buildMech、animateMech、武器模型）、vehicle-models.js、extra-models.js（運輸車輛、
                     掉落物、轟炸機、彈體）、environment.js（攝影棚環境貼圖）、measure.js（外框尺寸與統計）、
                     model-catalog.js（模型槽目錄）、glb.js（GLB 載入／換色／描邊／骨架／組合／規格檢查）
world/               world.js（World：關卡生成、THEMES）、prop-models.js（地圖物件的網格建造，純函式）、
                     map-extras.js（Vehicle、Pickup、PICKUP_DEFS）
audio/               audio.js（SFX）、sfx-data.js（匯入 assets/sfx/*.mp3）
fx/effects.js        Effects 粒子／曳光／碎片
entities/            projectile.js、mech-entity.js（MechEntity）、mech-remote.js（MechEntity 客機端擴充）
net/                 transports.js（NET_VERSION、PeerJS／BroadcastChannel／WebSocket 傳輸）、net.js（Net）、
                     snapshot.js（serEnt／applyEnt 快照序列化）
game/game.js         class Game：constructor、主迴圈 loop、敵我判定等核心
game/*.js            Game 的 mixin：render-setup、save、input、settings、garage、mission、player、camera、hud、
                     mp-lobby、mp-host、mp-client、map-extras、first-person、pvp、pilot（經驗與熟練度累積、結算）、
                     pilot-ui（駕駛員畫面、預設組）；constants.js 放 mixin 共用常數
assets/sfx/*.mp3     音效原始檔（建置時以 base64 內嵌）
assets/models/       GLB 模型（<槽位 id>.glb，建置時自動內嵌，以 import ... from 'virtual:models' 取得）
library/             模型庫：library.js（入口）、grid.js（共用畫布的格狀檢視）、inspect.js（檢視窗）、
                     stage.js（建立／量測／組合）、refs.js（尺寸參考物）、store.js（GLB 來源與 IndexedDB）、
                     template.js（範本 GLB 匯出）
```

### Mixin 規則（重要）

`Game` 的方法分散在 `game/*.js`，每個檔案是 `Object.assign(Game.prototype, { ... })`；`MechEntity`、`Effects` 也有同樣的擴充。

- **mixin 檔不能 export 任何東西**，只能由 `main.js` 以副作用 import 載入。否則別的模組 import 它時會在 `Game` 定義前執行 `Object.assign`（循環相依 → TDZ 錯誤）。mixin 需要共用的常數放 `game/constants.js`。
- 新增 mixin 檔要在 `main.js` 加 import；方法名稱不可與其他 mixin 或類別重複（後載入的會默默覆蓋）。
- 新方法放進對應主題的 mixin；`game.js` 只留核心。

### 模組相依

- 各模組明確 import 所需名稱；ESLint（`no-undef`）會抓到漏 import。
- ES module 匯入的綁定是唯讀的：`let` 狀態（如 `RNG`、`MECH_ID`、`VEH_ID`）只能在定義它的模組內重新賦值，跨模組要改就提供函式。
- 不要 import `main.js`（會造成循環相依）。需要 `Game` 實例時用 `this.game` 或參數傳入；底層模組要回呼 Game 時用 hook，例如 `SFX.mirror` 由 `Game.netInit` 設定。遊戲實例沒有掛在 `window` 上。
- 新增音效：把 mp3 放到 `src/assets/sfx/`，在 `audio/sfx-data.js` 加 import 並放進 `SFX_DATA`。

### 駕駛員系統（技能樹／熟練度）

- PvE 與 PvP 各有一組駕駛員：`save.pilot = { v, pve, pvp }`，每組有 `xp`（累積經驗，等級一律由 `levelOf(xp)` 推算）、`skills`（{技能 id: 級數}）、`prof`（{武器零件 id: 累積有效傷害}）、`presets`（5 組：機體裝備＋配點）。COAM 與零件倉庫兩模式共用。
- 加成流程：`computePilotMods(payload, mode)` 產生扁平增量表 `pm` → `new MechEntity(..., { pilot: pm })`。`applyPilotStats` 回傳複製後的 stats，`pilotWeaponDef` 回傳複製後的武器定義；**不可修改共用的 `PARTS`／`FIST_DEF`**。實體上用 `e.pmv(key)` 取增量（敵人為 0）。
- 新增技能：在 `data/skills.js` 的 `SKILLS` 加節點（`fx` 是每級增量），再到實際使用數值的地方讀 `pm`（stats／武器類在 `data/pilot.js`，實體行為用 `pmv`）。改技能表不用遷移存檔，`sanitizeSkills` 讀檔時會自動退還不合法的配點。
- 多人：客機在 `ready` 訊息附上 `pilotPayload(save)`（兩種模式），房主以 `sanitizePayload` 校正；房主自己的加成直接讀本機存檔（`pilotModsForPlayer`）。生成紀錄帶 `pm`，客機據此建立一致的實體（HUD 上限、自身移動預測）。
- 經驗與熟練度只在房主／單機累積到 `mpStats[slot].xp/pf`（隨快照同步、房主遷移後保留），結算時以 `end`／`abort` 訊息的 `xpBySlot` 發給各玩家，各自 `pilotGrant` 寫入自己的存檔。命中要把武器 id 當 `takeDamage` 第 7 個參數傳入才會累積熟練度。

### 模型庫與 GLB

- 每個 3D 模型都是 `render/model-catalog.js` 的一個**模型槽**（槽位 id，例如 `head/h_std`、`mech/boss_juggernaut`）。新增模型或零件時要在目錄登記，模型庫才會列出。機甲部件依零件編號逐一列出（即使外觀相同），之後每個零件可以有自己的 GLB。
- GLB 來源優先順序：瀏覽器暫存（拖曳進模型庫，IndexedDB）＞內建（`src/assets/models/<槽位 id>.glb`）＞程式模型。目前遊戲本身還沒有讀 GLB，之後換模型時沿用 `render/glb.js` 與目錄。
- GLB 規格（+Z 正面、單位公尺、原點、節點命名、依材質名稱換色、預算）見 `docs/glb-spec.md`；數值定義在 `render/glb.js` 的 `GLB_BUDGET`／`MECH_NODES`／`PALETTE_SLOTS`，修改時同步更新文件。
- GLB 載入時要逐節點轉座標系（`flipToGame`），不能只轉根節點，否則 `animateMech` 設定的關節角度方向會相反。
- 尺寸一律以公尺標示；量測（`measureBox`）排除描邊外殼與加色發光特效。
- 地圖物件的網格在 `world/prop-models.js`（純函式，不呼叫亂數）；關卡生成照原順序用亂數決定參數後呼叫。改動這裡或 `world.js` 時，亂數呼叫順序不可改變（多人同一 seed 必須產生相同地圖）。

## 架構陷阱

- 多人連線是房主權威：邏輯只在房主執行，客機送輸入、收 30 Hz 快照。新增遊戲狀態時要同時處理 `net/snapshot.js` 的 `serEnt`／`applyEnt`、快照欄位（`game/mp-host.js` 的 `hostTick`、`game/mp-client.js` 的 `clientApplySnapshot`）、事件 `netEv`／`clientEvent`，以及房主遷移（`game/mp-host.js` 的 `promoteToHost`）。
- 改動網路協定時要提高 `net/transports.js` 的 `NET_VERSION`（目前 `'8.0'`），否則新舊版本會互連。
- 關卡生成必須維持以種子決定（`makeRng`／`makeNoise`／`withRng`），多人各端靠同一 seed 產生相同地圖。不要在生成流程裡用 `Math.random`。
- 存檔與設定存在 localStorage：`rubicon_save`、`rubicon_keys`、`rubicon_ctrl`、`rubicon_pad`、`rubicon_post`、`rubicon_turn`、`rubicon_relay`、`rubicon_nick`、`rubicon_unmask`。
- 顯示暱稱、房名、房主送來的結果欄位等遠端資料時，放進 `innerHTML` 前一律用 `core/html.js` 的 `escHtml` 跳脫（或改用 `textContent`）。
- 目前所有模型、貼圖都是程式即時產生（Canvas 貼圖＋幾何拼接）。執行時不能依賴外部資源檔：新的素材（音效、GLB）必須在建置時內嵌進單一 HTML。

## 其他

- 與使用者溝通、註解與 UI 文字一律使用繁體中文。
- UI 字串中的全形空白（U+3000）是刻意的，不要移除（ESLint 已設定略過字串）。
- 程式碼風格由 Prettier 統一（`.prettierrc.json`：單引號、寬 110）；ESLint 只開抓錯誤的規則。
- `dist/` 的檔案都要提交：每次 commit 前先跑 `npm run build`（正式版；`npm run dev` 產生的是含 source map 的開發版，不要提交），確認 `dist/` 的 HTML 已更新再一起 commit。`dist/rubicon-server.exe` 約 55 MB，修改 `server.js` 後要 `npm run build:exe` 並一併提交；exe 執行中時無法覆寫。發佈時提供 dist/ 的 exe 與 HTML（加上 `README.txt`）。
