# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

瀏覽器 3D 機甲動作遊戲（Three.js r128）＋ Windows 區網伺服器。遊戲原始碼是 `src/` 下的 ES modules，由 esbuild 打包成**單一 HTML**（CSS、JS、音效全部內嵌）；外部程式庫放在 HTML 旁的 `lib/` 資料夾。發佈形式是「`rubicon-server.exe` ＋ `rubicon-protocol.html` ＋ `lib/`」（模型庫 `model-library.html` 選用）。

- `src/`：遊戲原始碼（見下方架構）。`src/index.html` 是 HTML 骨架，建置時把 `styles.css` 與打包後的 JS 內嵌進去。
- `src/library/`：模型庫頁面（見下方「模型庫與 GLB」），建置成 `dist/model-library.html`。
- `dist/`：建置產物 `rubicon-protocol.html`、`model-library.html`、`lib/`（程式庫）、`rubicon-server.exe`，**全部都要提交進 git**（每次改動 src/ 都要重新建置並一起 commit／push）。**不要手改 dist/**，改 `src/` 後重新建置。
- `server.js`：區網伺服器。遊戲 port 預設 80（提供遊戲頁、`/models` 模型庫、`/health`、`/ws` WebSocket 中繼），控制台固定 port 8090。開發時讀 `dist/` 的 HTML，打包成 exe 後讀 exe 同資料夾的檔案（以 `process.pkg` 判斷，改打包方式時要一併修改）。
- `scripts/build.js`：建置腳本；`scripts/smoke-test.js`：冒煙測試；`scripts/test-server-preload.js`：測試時讓 server.js 改聽 127.0.0.1 測試 port、不開瀏覽器。
- `docs/glb-spec.md`：給美術的 GLB 製作規格。
- 函式庫（three.js r128、PeerJS 1.5.4、three examples 的後處理／GLTFLoader／DRACOLoader；模型庫另有 OrbitControls、TransformControls、GLTFExporter）**不從 CDN 載入**：以 devDependencies 固定版本安裝（`three@0.128.0`、`peerjs@1.5.4`），各頁面 `index.html` 寫 `<script src="lib/<套件>/<路徑>">`，建置時由 `node_modules` 複製到 `dist/lib/` 同樣的路徑（新增程式庫只要加這種 script 標籤）。程式裡以全域變數 `THREE`、`Peer`、`SimplexNoise` 使用，不要改成 import。Draco 解碼器由建置產生 `dist/lib/draco/draco-decoder.js`（wasm 以 base64 內含，因為直接開檔時不能 fetch 本地檔案），`render/glb.js` 第一次遇到 Draco 壓縮的 GLB 才以 `<script>` 載入。冒煙測試會把任何向 CDN 的程式庫請求當成錯誤。Google Fonts 字型仍從外部載入（連不到時改用系統字型）。

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

用 headless Edge／Chrome（SwiftShader WebGL）跑：file:// 開啟標題畫面（含讀取 file:// 模型庫的暫存）→ 單機出擊與放棄（結果畫面的駕駛員經驗）→ 駕駛員畫面（舊存檔遷移、配點、T2 解鎖、預設組、PvE／PvP 切換、車庫加成顯示）→ 模型庫（所有槽位建立與公尺尺寸、一行三格、檢視窗標線、區塊範本 GLB 匯出→載入→規格檢查全通過、組合預覽、左側武器暫用右側、錯放報錯、移除、完整機甲以區塊組合、關節設定修改→保存→匯出→重設、組裝調整頁的零件切換／預組儲存匯出匯入／動作時間軸／選取與數值／對稱編輯／復原重做／方向鍵微調／穿幫提示與顯示開關、載具區塊範本）→ GLB 編輯（從檢視窗開啟、旋轉／縮放／對齊程式模型／原點、復原、刪除節點、加入 GLB 與合併節點、存到槽位與鏡像存到另一側、還原原始檔；拆分整台機甲範本：姿勢對照、自動分配、切割補面、框選排除與復原、全部存檔）→ 本地模型庫（模型庫寫入暫存 → 遊戲設定開啟、分類開關、失敗清單、車庫與出擊換上機甲／子彈／轟炸機／地圖物件的 GLB、完整載具組合預覽、多人房間停用）→ `?lan=local` 兩分頁多人（建房、加入、出擊、房主離線遷移）→ 啟動 server.js 測 `/health`、`RUBICON_SERVER` 注入、`/models` 與標題畫面的模型庫按鈕、WebSocket 中繼多人。收集 pageerror 與 console.error，截圖存到 `test-results/`（gitignore）。沒有單元測試框架；改動遊戲邏輯時看截圖確認畫面。

## 原始碼架構（src/）

```
main.js              進入點：依序 import 所有 mixin，最後 new Game()
index.html／styles.css
core/                math.js（RNG、makeRng、makeNoise、withRng、clamp/lerp/rnd…）、html.js（escHtml）
data/                parts.js（零件、START_ASM、asmStats）、enemies.js（AC_ROSTER、BOSS_DEFS、ENEMY_TYPES）、
                     skills.js（駕駛員技能樹、熟練度加成、經驗曲線）、pilot.js（駕駛員純函式：等級、配點驗證、加成套用）
render/              materials.js（Canvas 貼圖、mechMats、PALETTES、palColor）、geometry.js（幾何快取與拼接工具）、
                     mech-model.js（機甲區塊、連接點、buildMech、animateMech、武器模型）、mech-joints.js（關節設定）、
                     vehicle-models.js、extra-models.js（運輸車輛、
                     掉落物、轟炸機、彈體）、environment.js（攝影棚環境貼圖）、measure.js（外框尺寸與統計）、
                     model-catalog.js（模型槽目錄）、glb.js（GLB 載入／換色／描邊／規格檢查）、
                     model-provider.js（模型來源掛勾：建模函式依槽位 id 取得取代程式模型的 GLB）、
                     local-models.js（遊戲的本地模型庫：讀取模型庫 IndexedDB 的 GLB 與關節設定）
world/               world.js（World：關卡生成、THEMES）、prop-models.js（地圖物件的網格建造，純函式）、
                     map-extras.js（Vehicle、Pickup、PICKUP_DEFS）
audio/               audio.js（SFX）、sfx-data.js（匯入 assets/sfx/*.mp3）
fx/                  effects.js（Effects 粒子／曳光／碎片）、thruster.js（推進器噴焰粒子：Effects.thruster，
                     從背包噴口連接點沿其 −Y 噴出；模型庫檢視窗共用）
entities/            projectile.js、mech-entity.js（MechEntity）、mech-remote.js（MechEntity 客機端擴充）
net/                 transports.js（NET_VERSION、PeerJS／BroadcastChannel／WebSocket 傳輸）、net.js（Net）、
                     snapshot.js（serEnt／applyEnt 快照序列化）
game/game.js         class Game：constructor、主迴圈 loop、敵我判定等核心
game/*.js            Game 的 mixin：render-setup、save、input、settings、garage、mission、player、camera、hud、
                     mp-lobby、mp-host、mp-client、map-extras、first-person、pvp、pilot（經驗與熟練度累積、結算）、
                     pilot-ui（駕駛員畫面、預設組）、local-lib（本地模型庫的設定、讀取進度、規格檢查）；
                     constants.js 放 mixin 共用常數
assets/sfx/*.mp3     音效原始檔（建置時以 base64 內嵌）
assets/models/       GLB 模型（<槽位 id>.glb，建置時自動內嵌，以 import ... from 'virtual:models' 取得）
library/             模型庫：library.js（入口）、grid.js（共用畫布的格狀檢視）、inspect.js（檢視窗）、
                     stage.js（建立／量測／組合）、refs.js（尺寸參考物、原點三軸、連接點標記）、store.js（GLB 來源與 IndexedDB）、
                     template.js（範本 GLB 匯出）、joint-editor.js（關節設定編輯器）、
                     workshop.js（組裝調整頁：自由預組機甲、在整台機甲上調整連接點）、
                     workshop-edit.js（組裝調整的選取、拖曳、數值、對稱、復原、鍵盤微調與吸附、顯示方式）、
                     workshop-check.js（相鄰區塊的縫隙／重疊估算）、editor.js（GLB 編輯頁）、
                     editor-ops.js（GLB 編輯的幾何運算：外框、朝向、對齊、套用變換、鏡像、匯出）、
                     editor-split.js（拆分成區塊）、editor-cut.js（三角形湯、平面切割補面、區塊網格輸出）
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

- 每個 3D 模型都是 `render/model-catalog.js` 的一個**模型槽**（槽位 id，例如 `head/h_std`、`arms/a_std/r_fore`）。新增模型或零件時要在目錄登記，模型庫才會列出。
- **機甲由區塊組成**（`render/mech-model.js`）：`partPieces(cat, part)` 把零件拆成區塊（手臂左右各 上臂含肩甲／前臂／手；二足腳 襠部＋左右 大腿／小腿／腳掌；四足 主體＋4×大腿／小腿含腳；履帶整塊；武器分左右），左右各自建模、不用鏡像。每個區塊的原點是它的旋轉中心；`pieceConns(info)` 定義父區塊上的連接點預設值（核心→肩／脖子／背包／肩上武器座、襠部→腰／髖、上臂→手肘…），`buildMech` 依連接點組裝：連接點群組（`mounts`）下掛關節群組（`legs`／`arms`／`head`／`torso`，`animateMech` 只改它們的旋轉），區塊掛在關節群組底下。
- 連接點可被關節設定覆寫（`render/mech-joints.js`）：內建 `src/assets/models/joints.json`（建置時以 `virtual:joints` 內嵌，遊戲與模型庫都讀）＞程式預設值；檔案用 glTF 座標（+Z 正面、角度）。模型庫的關節設定編輯器（拖曳箭頭／數值）把修改存在瀏覽器（IndexedDB `joints`，只影響模型庫），「匯出關節設定」輸出合併後的 joints.json。遊戲只讀內建檔，不讀瀏覽器暫存（多人各端必須一致）。機甲身高 `height`、`hipY` 是遊戲判定用的常數，不隨連接點改變。
- GLB 來源優先順序（模型庫）：瀏覽器暫存（拖曳進模型庫，IndexedDB）＞內建（`src/assets/models/<槽位 id>.glb`）＞程式模型；左側武器沒有 GLB 時暫用右側。完整機甲（`mech/`）不接受整台 GLB，只顯示區塊組合（`buildMech` 的 `opts.piece` 換成 GLB）。會動的載具也拆成區塊（`vehicle/<key>/hull|turret|body|rotor|tail`，`render/vehicle-models.js`），列車分機車頭／車廂；完整載具、疊放貨櫃、掩體的目錄項目有 `parts`，模型庫以區塊組合預覽（`stage.js` 的 `prepareAssembly`）；`noGlb` 且 `parts` 為空的（高台、公路、鐵路）不接受 GLB。
- **遊戲的本地模型庫**（只在單人模式）：設定（`rubicon_localmodels`：總開關＋機甲區塊／武器／載具／地圖物件／小物件）開啟時，`render/local-models.js` 讀取模型庫 IndexedDB 的 GLB 與關節設定（不建立資料庫、讀完即關閉連線；同來源才讀得到），解析後快取範本。建模函式透過 `render/model-provider.js` 的 `providedModel(slot, pal, unique)` 取得實例：`buildMech` 的區塊、`vehicle-models.js` 的載具區塊（`swapPiece`）、`extra-models.js` 的運輸車輛／掉落物／轟炸機／彈體、`world/prop-models.js` 的地圖物件（`propGlb`：依隨機尺寸縮放、main 材質換成物件顏色、`propMats` 回傳材質給遮擋與閃光）。沒有設定來源時一律回傳 null（程式模型），所以這些函式仍是純函式；多人時 `LocalModels.allow()` 回傳 false，關節覆寫也以 gate 停用。進車庫、單機出擊前（`lmRefresh`）與標題的「重新載入本地模型」會重新讀取。換模型只改外觀，碰撞與判定一律用程式模型的數值。內建 GLB 遊戲目前還不讀。
- **GLB 編輯器**（模型庫的「GLB 編輯」頁籤，網址 `#editor` 或 `#editor=槽位 id`；檢視窗的「在 GLB 編輯器開啟」）：修正外部（AI 生成等）GLB 的朝向、尺寸、原點與節點。編輯中的模型保持 glTF 座標（`frame` 繞 Y 轉 180° 顯示＞`xform` 整體變換＞原始場景），存檔時 `bakeScene` 把變換寫進頂點（行列式為負時翻轉三角形順序）、輸出扁平節點的 GLB。存到槽位時在 IndexedDB 紀錄的 `orig` 保留原始檔（拖曳替換則沒有），可以還原；鏡像存到另一側不保留原始檔。不指定槽位時只能下載。**組合**：「加入 GLB…」把另一個 GLB 加成新節點；「合併成一個節點」用 `mergeByMaterial` 把子樹的變換寫進頂點並依材質合併。新增的節點登記在 `nodes` 尾端，復原到加入前的快照時（快照裡沒有它）會標成刪除。**拆分**（`editor-split.js`）：選零件組合後以程式模型（`buildMech`，各區塊不同顏色）為參考，調整它的姿勢配合模型（快速姿勢＋各區塊關節旋轉，加在 `restPose` 之上），模型攤成三角形湯（`editor-cut.js`，每個三角形記錄區塊編號；運算一律產生新陣列，復原只保留參照），自動分配（到區塊外框的距離，相近時比到表面的距離）、框選、平面切割（只切分給兩個區塊且在半徑內的三角形，切口補面），存檔時每個區塊乘上「該區塊在擺好姿勢的程式模型中的反矩陣」＋轉 glTF，所以存成拉直靜止姿勢下的區塊座標。規劃中的後續階段：材質、最佳化（減面等）。
- GLB 規格（+Z 正面、單位公尺、區塊與原點、依材質名稱換色、預算）見 `docs/glb-spec.md`；數值定義在 `render/glb.js` 的 `GLB_BUDGET`／`PALETTE_SLOTS`，區塊與連接點在 `render/mech-model.js`，修改時同步更新文件。
- GLB 載入時要逐節點轉座標系（`flipToGame`），不能只轉根節點。
- 尺寸一律以公尺標示；量測（`measureBox`）排除描邊外殼與加色發光特效。
- 模型庫的擺放要和遊戲一致：原點在地面的模型（完整機甲、組合預覽、載具、地圖物件…）以原點貼地（`stage.js` 的 `finalize`），GLB 往下超出時會沉入地面，檢視窗資訊列顯示「最低點（遊戲中離地）」；只有單一區塊（原點是旋轉中心）以最低點貼地。組裝調整頁也以原點貼地。
- 地圖物件的網格在 `world/prop-models.js`（純函式，不呼叫亂數）；關卡生成照原順序用亂數決定參數後呼叫。改動這裡或 `world.js` 時，亂數呼叫順序不可改變（多人同一 seed 必須產生相同地圖）。

## 架構陷阱

- 多人連線是房主權威：邏輯只在房主執行，客機送輸入、收 30 Hz 快照。新增遊戲狀態時要同時處理 `net/snapshot.js` 的 `serEnt`／`applyEnt`、快照欄位（`game/mp-host.js` 的 `hostTick`、`game/mp-client.js` 的 `clientApplySnapshot`）、事件 `netEv`／`clientEvent`，以及房主遷移（`game/mp-host.js` 的 `promoteToHost`）。
- 改動網路協定時要提高 `net/transports.js` 的 `NET_VERSION`（目前 `'8.0'`），否則新舊版本會互連。
- 關卡生成必須維持以種子決定（`makeRng`／`makeNoise`／`withRng`），多人各端靠同一 seed 產生相同地圖。不要在生成流程裡用 `Math.random`。
- 存檔與設定存在 localStorage：`rubicon_save`、`rubicon_keys`、`rubicon_ctrl`、`rubicon_pad`、`rubicon_post`、`rubicon_turn`、`rubicon_relay`、`rubicon_nick`、`rubicon_unmask`、`rubicon_localmodels`。
- 顯示暱稱、房名、房主送來的結果欄位等遠端資料時，放進 `innerHTML` 前一律用 `core/html.js` 的 `escHtml` 跳脫（或改用 `textContent`）。
- 目前所有模型、貼圖都是程式即時產生（Canvas 貼圖＋幾何拼接），只有單人模式開啟本地模型庫時才會換成瀏覽器暫存的 GLB。執行時不能依賴外部資源檔：新的素材（音效、GLB）必須在建置時內嵌進單一 HTML，程式庫放 `dist/lib/`。

## 其他

- 與使用者溝通、註解與 UI 文字一律使用繁體中文。
- UI 字串中的全形空白（U+3000）是刻意的，不要移除（ESLint 已設定略過字串）。
- 程式碼風格由 Prettier 統一（`.prettierrc.json`：單引號、寬 110）；ESLint 只開抓錯誤的規則。
- `dist/` 的檔案都要提交：每次 commit 前先跑 `npm run build`（正式版；`npm run dev` 產生的是含 source map 的開發版，不要提交），確認 `dist/` 的 HTML 已更新再一起 commit。`dist/rubicon-server.exe` 約 55 MB，修改 `server.js` 後要 `npm run build:exe` 並一併提交；exe 執行中時無法覆寫。發佈時提供 dist/ 的 exe、HTML 與 `lib/` 資料夾（加上 `README.txt`）。伺服器的 `/lib/…`（以及 `/models/lib/…`）提供同資料夾 `lib/` 裡的檔案。
