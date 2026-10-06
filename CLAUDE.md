# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

瀏覽器 3D 機甲動作遊戲（Three.js r128）＋ Windows 區網伺服器。遊戲原始碼是 `src/` 下的 ES modules，由 esbuild 打包成**單一 HTML**（CSS、JS、音效全部內嵌）；外部程式庫放在 HTML 旁的 `lib/` 資料夾。發佈形式是「`rubicon-server.exe` ＋ `rubicon-protocol.html` ＋ `lib/`」（模型庫 `model-library.html`、文字動畫 `apng/`、貼圖繪製 `paint/` 選用）。

- `src/`：遊戲原始碼（見下方架構）。`src/index.html` 是 HTML 骨架，建置時把 `styles.css` 與打包後的 JS 內嵌進去。
- `src/library/`：模型庫頁面（見下方「模型庫與 GLB」），建置成 `dist/model-library.html`。
- `rubicon_apng_gen/`：子專案「文字動畫 APNG 產生器」（TRPG 用的文字動畫素材，純靜態網站、原生 ES Modules，不需建置）。原本是獨立版本庫（`lorenhsu1128/rubicon_apng_gen`），已用 `git subtree` 連同歷史納入本專案，直接在這裡修改、和主專案一起提交（舊的遠端版本庫不再更新）。`scripts/build.js` 的 `copySubprojects` 把它的 `index.html`、`css/`、`js/` 原樣複製到 `dist/apng/`，伺服器在 `/apng/` 提供；因為是 ES Modules，必須透過 HTTP 開啟，標題畫面的「文字動畫」按鈕只在伺服器網址時顯示。
- `rubicon_paint/`：子專案「貼圖繪製」（Rubicon Paint：直接在 GLB 模型上畫貼圖，圖層、匯出 PNG／PSD／GLB）。和 APNG 產生器一樣原本是獨立版本庫（`lorenhsu1128/rubicon_paint`），已用 `git subtree` 納入本專案；`copySubprojects` 把 `index.html`、`css/`、`js/`、`lib/`（自帶 three.js r128）複製到 `dist/paint/`，伺服器在 `/paint/` 提供。它是一般 `<script>`（全域 `THREE`、`window.RP`），直接開檔也能用，所以標題畫面與模型庫上方的「貼圖繪製」按鈕一律顯示。和模型庫的連線見下方「模型庫與 GLB」的貼圖繪製。
- `dist/`：建置產物 `rubicon-protocol.html`、`model-library.html`、`lib/`（程式庫）、`apng/`（文字動畫）、`rubicon-server.exe`，**全部都要提交進 git**（每次改動 src/ 都要重新建置並一起 commit／push）。**不要手改 dist/**，改 `src/` 後重新建置。
- `server.js`：區網伺服器。遊戲 port 預設 80（提供遊戲頁、`/models` 模型庫、`/health`、`/ws` WebSocket 中繼、`/apng/` 文字動畫 APNG 產生器與 `/paint/` 貼圖繪製（同資料夾的 `apng/`、`paint/`，依副檔名給 Content-Type）、`/api/models/default/…` 伺服器預設組與 `/api/sets/<sha256>` 玩家上傳的模型組、`/api/styles` 分享的渲染風格（`styles.json`），資料在 exe 旁的 `server-models/`，環境變數 `RUBICON_MODELS_DIR` 可改位置），控制台固定 port 8090。開發時讀 `dist/` 的 HTML，打包成 exe 後讀 exe 同資料夾的檔案（以 `process.pkg` 判斷，改打包方式時要一併修改）。
- `scripts/build.js`：建置腳本；`scripts/smoke-test.js`：冒煙測試；`scripts/test-server-preload.js`：測試時讓 server.js 改聽 127.0.0.1 測試 port、不開瀏覽器。
- `docs/glb-spec.md`：給美術的 GLB 製作規格。
- 函式庫（three.js r128、PeerJS 1.5.4、three examples 的後處理／GLTFLoader／DRACOLoader；模型庫另有 OrbitControls、TransformControls、GLTFExporter）**不從 CDN 載入**：以 devDependencies 固定版本安裝（`three@0.128.0`、`peerjs@1.5.4`），各頁面 `index.html` 寫 `<script src="lib/<套件>/<路徑>">`，建置時由 `node_modules` 複製到 `dist/lib/` 同樣的路徑（新增程式庫只要加這種 script 標籤）。程式裡以全域變數 `THREE`、`Peer`、`SimplexNoise` 使用，不要改成 import。Draco 解碼器由建置產生 `dist/lib/draco/draco-decoder.js`（wasm 以 base64 內含，因為直接開檔時不能 fetch 本地檔案），`render/glb.js` 第一次遇到 Draco 壓縮的 GLB 才以 `<script>` 載入；Draco 編碼器（純 JS）複製成 `dist/lib/draco/draco-encoder.js`，GLB 編輯器輸出 Draco 時才載入。例外：減面用的 `meshoptimizer`（`meshoptimizer/simplifier`，wasm 內含在 JS 裡）以一般 import 打包進模型庫頁面。冒煙測試會把任何向 CDN 的程式庫請求當成錯誤。Google Fonts 字型仍從外部載入（連不到時改用系統字型）。

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
- 模型庫：`dist/model-library.html` 直接開啟，或伺服器上的 `/models`；網址 `#槽位 id`（例如 `#mech/player`）直接開啟該模型的檢視窗。頂端的「← 回遊戲」：從遊戲開的分頁切回遊戲並關閉自己，否則在同一分頁開遊戲（遊戲分頁重新取得焦點時，停在標題或車庫就自動重新讀取本地模型）。格狀檢視每行 3／5／7 格與「全部旋轉」記在 localStorage `rubicon_lib_grid`（5、7 格預設只轉游標停留的格子；沒有捲動、旋轉或內容變化時 `grid.js` 不重畫）。
- `dist/` 的兩個 HTML 都必須維持可以用 file:// 直接開啟：所以輸出格式是 IIFE 的一般 `<script>`，不是 `type="module"`。

### 冒煙測試（`npm test`）

用 headless Edge／Chrome（SwiftShader WebGL）跑：file:// 開啟標題畫面（全螢幕按鈕進出、讀取 file:// 模型庫的暫存）→ 單機出擊與放棄（結果畫面的駕駛員經驗）→ 存檔槽（舊版單一存檔搬進存檔 1、三槽獨立、匯出、匯入到空槽／覆蓋確認／錯誤檔案、刪除與改用另一槽、從存檔畫面與標題「繼續存檔」繼續）→ 駕駛員畫面（舊存檔遷移、配點、T2 解鎖、預設組、PvE／PvP 切換、車庫加成顯示）→ 模型庫（所有槽位建立與公尺尺寸、一行三格、改成 7／5 格與重新整理後保留、檢視窗標線、區塊範本 GLB 匯出→載入→規格檢查全通過、組合預覽、左側武器暫用右側、錯放報錯、移除、完整機甲以區塊組合、關節設定修改→保存→匯出→重設、組裝調整頁的零件切換／預組儲存匯出匯入／動作時間軸／選取與數值／對稱編輯／復原重做／方向鍵微調／穿幫提示與顯示開關、載具區塊範本）→ GLB 編輯（從檢視窗開啟、旋轉／縮放／對齊程式模型／原點、復原、刪除節點、加入 GLB 與合併節點、顯示程式模型原點與拖曳原點、存到槽位與鏡像存到另一側、還原原始檔；材質：AI 風格模型依顏色分群、框選改色槽、復原、存檔後依配色換色；刪除多邊形：矩形只選看得到的與穿透、刪除與復原、套索、筆刷與擦除、點選相連、對稱（點選與矩形）、小碎塊、反選、擴展到相連、整個網格刪除、存檔讀回、拆分模式停用；貼圖：列出共用與種類、下載目前圖／原檔／UV 線框／zip、共用替換與復原、只換這個材質、只換粗糙度通道、灰階換原圖、加入顏色與 AO 貼圖、存檔讀回；拆分整台機甲範本：合併相同材質、只勾選左手臂與左腿、姿勢對照、拖曳控制點拉長範圍框與復原、點範圍框選取、關節標記、拖曳關節點（範圍框不動）與復原、範圍框裁切、長度偏差檢查（框外移除）、調小範圍框重拆、切割補面、框選排除與復原、只存勾選的區塊與拖曳過的關節設定、組裝調整的只動關節（前臂不動、原點寫回 GLB、重建後一致、復原）、以核心為根拖曳襠部（核心不動）與自動貼地／離地微調；最佳化：減到預算、復原、WebP／PNG 與 Draco 輸出、檢視窗讀回）→ 參考圖與正交視圖（檢視窗組合預覽的 A pose 與正視、組裝調整頁載入正面圖校正後正視顯示、「模型」縮放 120% 寫回原點節點與復原、GLB 編輯器的全身參考與正視、匯出／匯入模型組帶參考圖）→ 本地模型庫（模型庫寫入暫存 → 遊戲設定開啟、分類開關、失敗清單、車庫與出擊換上機甲／子彈／轟炸機／地圖物件的 GLB、完整載具組合預覽、多人房間停用）→ 模型組（舊版連線佔住時提示並在關閉後繼續、第 3 版資料遷移成「預設」、組裝調整記住零件組合、新增空白、切換、複製、改名、匯出 → 刪除 → 匯入、重新整理後保留、遊戲設定選模型組並套用該組的 GLB）→ `?lan=local` 兩分頁多人（建房、加入、出擊、房主離線遷移）→ 貼圖繪製（直接開檔：標題畫面按鈕開啟、程式模型時停用、模型庫「回遊戲」關閉分頁、檢視窗「繪製貼圖」開啟槽位的 GLB、畫一筆、存回模型庫（原始檔保留、根節點不變）、再開接著上次的圖層、模型庫換了模型組時拒絕存回）→ 渲染風格實驗室（標題按鈕開啟、兩隊模擬戰鬥、觀看時不顯示 HUD、切換 Gundam 風格＋機體金屬、左右比較、滑桿即時改參數、吉卜力的積雲與水彩、操作模式、存成我的預設並套用、離開後存檔沒變、設定畫面顯示、出擊時使用該風格）→ 啟動 server.js 測 `/health`、`RUBICON_SERVER` 注入、`/models` 與標題畫面的模型庫按鈕、`/apng` 轉址與 ES Module 型別、`/paint/`、實驗室上傳風格到伺服器／選單顯示／刪除、不能讀到資料夾外、標題畫面「文字動畫」按鈕開啟工具（直接開檔時不顯示）、伺服器模型組（模型庫的伺服器預設組：整組發佈、直接編輯寫到伺服器資料夾、重新讀取、檢視窗標示；單人：設定顯示、車庫用伺服器組或本地模型組、敵人用伺服器組；多人：兩個瀏覽器各自上傳模型組、大廳顯示 ✓、房主與客機看到對方機甲用對方的模型組、敵人用伺服器組）、WebSocket 中繼多人。收集 pageerror 與 console.error，截圖存到 `test-results/`（gitignore）。沒有單元測試框架；改動遊戲邏輯時看截圖確認畫面。

## 原始碼架構（src/）

```
main.js              進入點：依序 import 所有 mixin，最後 new Game()
index.html／styles.css
core/                math.js（RNG、makeRng、makeNoise、withRng、clamp/lerp/rnd…）、html.js（escHtml）、zip.js（zip 讀寫）、
                     sha256.js（模型組上傳的內容雜湊；區網 http 不是安全環境，不能用 crypto.subtle）
data/                parts.js（零件、START_ASM、asmStats）、enemies.js（AC_ROSTER、BOSS_DEFS、ENEMY_TYPES）、
                     skills.js（駕駛員技能樹、熟練度加成、經驗曲線）、pilot.js（駕駛員純函式：等級、配點驗證、加成套用）
render/style/        渲染風格：params.js（參數表、內建預設）、shader.js（標準材質的著色器修改、材質分類 tagStyle）、
                     pipeline.js（後處理管線）、atmos.js（天空、塵埃）、store.js（選擇、我的預設、伺服器分享）
render/              materials.js（Canvas 貼圖、mechMats、PALETTES、palColor）、geometry.js（幾何快取與拼接工具）、
                     mech-model.js（機甲區塊、連接點、buildMech、animateMech、武器模型）、mech-joints.js（關節設定）、
                     vehicle-models.js、extra-models.js（運輸車輛、
                     掉落物、轟炸機、彈體）、environment.js（攝影棚環境貼圖）、measure.js（外框尺寸與統計）、
                     model-catalog.js（模型槽目錄）、glb.js（GLB 載入／換色／描邊／規格檢查）、
                     model-provider.js（模型來源掛勾：建模函式依槽位 id 取得取代程式模型的 GLB）、
                     local-models.js（遊戲的本地模型庫：讀取模型庫 IndexedDB 的 GLB 與關節設定）、
                     set-pack.js（.rubicon-set 打包／解開）、net-models.js（伺服器預設組 ServerModels、玩家上傳的模型組
                     RemoteSets、uploadSet）
world/               world.js（World：關卡生成、THEMES）、prop-models.js（地圖物件的網格建造，純函式）、
                     map-extras.js（Vehicle、Pickup、PICKUP_DEFS）
audio/               audio.js（SFX）、sfx-data.js（匯入 assets/sfx/*.mp3）
fx/                  effects.js（Effects 粒子／曳光／碎片）、thruster.js（推進器噴焰粒子：Effects.thruster，
                     從背包噴口連接點沿其 −Y 噴出；模型庫檢視窗共用）
entities/            projectile.js、mech-entity.js（MechEntity）、mech-remote.js（MechEntity 客機端擴充）
net/                 transports.js（NET_VERSION、PeerJS／BroadcastChannel／WebSocket 傳輸）、net.js（Net）、
                     snapshot.js（serEnt／applyEnt 快照序列化）
game/game.js         class Game：constructor、主迴圈 loop、敵我判定等核心
game/*.js            Game 的 mixin：render-setup、save（三個存檔槽與存檔畫面）、input、settings、garage、mission、player、camera、hud、
                     mp-lobby、mp-host、mp-client、map-extras、first-person、pvp、pilot（經驗與熟練度累積、結算）、
                     pilot-ui（駕駛員畫面、預設組）、local-lib（本地模型庫的設定、讀取進度、規格檢查、mechSource）、
                     mp-models（伺服器模型組：我的機甲模型組上傳、大廳狀態、出擊前備齊、客機換模型）、
                     style-lab（渲染風格實驗室：模擬戰鬥、鏡頭、調整面板）、fullscreen（標題與暫停選單的全螢幕按鈕；
                     平板沒有鍵盤靠按鈕離開，Chrome／Edge 以 Keyboard Lock 鎖 Esc，Esc 照常暫停、長按才離開）；
                     constants.js 放 mixin 共用常數
assets/sfx/*.mp3     音效原始檔（建置時以 base64 內嵌）
assets/models/       GLB 模型（<槽位 id>.glb，建置時自動內嵌，以 import ... from 'virtual:models' 取得）
library/             模型庫：library.js（入口）、grid.js（共用畫布的格狀檢視）、inspect.js（檢視窗）、
                     stage.js（建立／量測／組合）、refs.js（尺寸參考物、原點三軸、連接點標記）、store.js（GLB 來源與 IndexedDB）、
                     template.js（範本 GLB 匯出）、joint-editor.js（關節設定編輯器）、
                     workshop.js（組裝調整頁：自由預組機甲、在整台機甲上調整連接點）、
                     workshop-edit.js（組裝調整的選取、拖曳、數值、對稱、復原、鍵盤微調與吸附、顯示方式）、
                     workshop-check.js（相鄰區塊的縫隙／重疊估算）、pose.js（快速姿勢／A pose）、ref-tools.js（正交視圖、參考圖與校正、RefStore）、
                     editor-context.js（GLB 編輯器的全身參考）、model-sets.js（模型組選單、匯出／匯入、發佈到伺服器）、paint-link.js（和貼圖繪製視窗的 postMessage 連線）、glb-origin.js（區塊原點寫回 GLB 的 rubicon_origin 節點）、editor.js（GLB 編輯頁）、
                     editor-ops.js（GLB 編輯的幾何運算：外框、朝向、對齊、套用變換、鏡像、匯出）、
                     editor-mat.js（材質：色槽、依面指定、依顏色分群、灰階貼圖、預覽配色）、editor-del.js（刪除多邊形：矩形／套索／筆刷／點選相連、只選看得到的、相連、小碎塊、對稱）、editor-tex.js（貼圖：下載目前／原檔、UV 線框、zip、替換／單一通道／加入）、editor-opt.js（焊接、減面、GLB 後處理：縮貼圖、WebP、Draco）、editor-split.js（拆分成區塊）、editor-cut.js（三角形湯、平面切割補面、區塊網格輸出）
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
- **原點＝連接點的另一半**：組裝調整頁預設「只動關節」——移動連接點時，子區塊（有自己的 GLB 時）的 D＝M1⁻¹·M0 同時套到它的原點與它自己的連接點，所以畫面上區塊不動、只改轉軸；原點寫回 GLB 的方式是在場景根部包一個 `rubicon_origin` 節點（`library/glb-origin.js`，只改 JSON 區塊，GLTFLoader／flipToGame 照一般節點處理）。復原項目分 `{ s, before, after }`（連接點）與 `{ pivot, before, after }`（原點矩陣，glTF）。選取區塊時拖曳的是它接上的連接點（零件跟著動）。組裝調整頁的層級以核心為根顯示，選腿部根區塊時是反向編輯（`target().inverse`：在 torso 座標裡拖 X＝(W·T)⁻¹，換算回腰的連接點 W＝X⁻¹·T⁻¹；拖曳中 `holdCore` 暫時移動、旋轉 `lift` 讓核心不動，`refreshGround` 會把 `lift` 歸位）；內部仍以腿為根。規格檢查對機甲區塊（`pivotFree`）不再把原點偏差列為警告。
- **自動貼地**（`buildMech` 的 `lift` 群組，`refreshGround`）：腿部有非程式模型的區塊或改過腿部連接點時，以建立時的站姿（`L.pose0`）量腿的最低點，位移＝程式模型的腿（預設連接點，依腳部零件快取）最低點－實際最低點，再加腿部根區塊的 `ground` 關節設定（離地微調，`p[1]`）；全是程式模型時為 0（與原本相同）。腿與上半身（腰部連接點）都掛在 `lift` 下，動作不改它。
- **模型組**（`library/model-sets.js`、`store.js`）：機甲區塊與武器（`render/local-models.js` 的 `setScoped`：分類 mech／weapon）的 GLB、關節設定、建議零件組合（組裝調整頁 `rebuild` 時 `store.setAsm` 記下）各模型組一份；載具、地圖物件、小物件共用（記錄的 `set` 為 `''`）。IndexedDB 第 4 版：`models`（鍵 [set, id]）、`setJoints`（鍵 [set, slot]）、`sets`、`presets`，第 3 版的 `glb`／`joints` 升級時搬進 `default`（「預設」）。升級時若有其他分頁佔住舊版連線（舊版沒有處理 versionchange），`indexedDB.open` 會一直等待：`store.load` 的 `onBlocked` 顯示 `#dbNotice` 提示關閉其他模型庫分頁，連線放開後自動繼續（新版的連線都會在 versionchange 時關閉）。`GlbStore` 的 `recs` 存全部模型組，`local`／`joints` 是目前模型組看得到的（`view(id)` 重建），所以寫入一律經過 `putBuf`／`setJoint` 就會進目前模型組。目前模型組記在 localStorage `rubicon_modelset`（模型庫的設定）。切換時重建相關格子、檢視窗，組裝調整改用該組的零件組合並清空復原紀錄。匯出／匯入 `.rubicon-set`（不壓縮 zip：manifest.json＋joints.json＋models/<槽位>.glb＋orig/，`render/set-pack.js`、`core/zip.js`）。遊戲的本地模型庫設定多一個 `set`，`LocalModels` 只讀那一組（快取鍵 `${set}|${槽位}`，`template(id, set)`／`jointsOf(set)` 預留每台機甲指定模型組）；讀到舊版資料庫時當成預設模型組。
- **伺服器模型組**（只在從 rubicon-server 的網址開啟時；伺服器在遊戲頁與模型庫都注入 `window.RUBICON_SERVER`）：
  - 伺服器預設組（`SERVER_SET`＝`'@server'`，涵蓋所有分類，`setOf` 對它不分共用）：`server-models/default/manifest.json` 記錄各槽位的 `{ name, size, h(sha256), t, orig? }`、`joints`、`asm`、`rev`（每次寫入加 1），GLB 在 `glb/<槽位>.glb`（原始檔 `orig/`）。寫入排隊執行、先寫暫存檔再改名；區網內任何人都能寫。模型庫的模型組選單多一列「伺服器預設組」（`store.useSet` 第一次切換時 `loadServer` 下載全部），選它時 `putBuf`（PUT GLB 會清掉舊原始檔，有 orig 再另外 PUT）／`remove`／`setJoint`／`setAsm` 直接送到 `/api/models/default/…`，不存 IndexedDB，失敗時 `store.onError` 提示；不能改名、刪除。「發佈到伺服器預設組」（`publishToServer`）：`clear?scope=mech` 清掉機甲區塊、武器與全部關節設定，再寫入本地模型組的內容（載具／地圖物件保留）。
  - 玩家上傳的模型組：`packSetData(data, { stable: true })`（固定時間、不含原始檔與時間戳，相同內容相同位元組）→ `sha256Hex` → `GET /api/sets/<h>?check=1` 確認沒有才 PUT（伺服器驗證雜湊、上限 128 MB），30 天沒用到刪除。
  - 遊戲的模型來源：機甲一律由 `Game.mechSource(opts)` 決定 `buildMech` 的 `opts.source`（`{ model, joints }`；`buildMech` 以 `withJoints` 讓整台機甲與 `refreshGround` 用那一組的關節設定）：玩家機甲單人用 `LocalModels.mySource()`（本地模型庫選的模型組，設定 `set` 為 `'@server'` 或沒開時為 null），多人用 `RemoteSets.get(opts.ms)`；都沒有時、以及敵人／友軍／電腦 AC 用 `ServerModels.source()`。其他物件的全域來源：單人時本地模型庫的共用分類優先，再來伺服器預設組；多人只用伺服器預設組。直接開檔時 `mechSource` 回傳 null，行為和以前相同（單人本地模型庫、多人程式模型）。
  - 多人：我的機甲模型組在大廳／車庫選（`#lobbyModelsSel`／`#gModelSetSel`，和設定共用 `rubicon_localmodels` 的 on／set），`mpSyncMySet` 上傳後送 `{ t: 'mset', ms, msn }`（房主存在 player 的 `ms`／`msn`，`syncLobby` 帶給所有人，大廳各端 `mpPrefetch` 下載並顯示狀態）。生成紀錄帶 `ms`，房主出擊前 `mpStartWhenReady` 先備齊伺服器預設組與所有玩家的模型組（最多 30 秒），因為子彈發射點依玩家的模型計算；客機與觀戰者在 `clientSpawn` 開始下載，還沒好時先用伺服器預設組，下載完 `RemoteSets.listeners` 觸發 `MechEntity.swapModel`（只換外觀，保留位置與已丟出的武器）。任務中改選只影響下次出擊。網址帶 `?test` 時遊戲實例放在 `window.__game`（冒煙測試檢查各機甲的 `modelSrc`）。
- **貼圖繪製**（`library/paint-link.js` ＋ 子專案 `rubicon_paint/js/app.js` 的「和模型庫連線」段落）：檢視窗的「繪製貼圖」（槽位要有自己的 GLB）以 `window.open('paint/index.html#lib' 或 '/paint/#lib', 'rubicon-paint')` 開繪圖視窗，不靠共用 IndexedDB，以 postMessage 傳 GLB：繪圖視窗送 `rp-ready`（同名視窗已開著時只換 #，所以模型庫另外送 `rp-ping` 問）→ 模型庫送 `rp-open { slot, set, setName, slotName, name, buf }`（buf 是複製的，不能轉移模型庫存著的那份）→「存回模型庫」送 `rp-save { id, slot, set, name, buf }` → 模型庫檢查槽位、GLB 標頭、目前模型組必須和開啟時相同（否則拒絕，避免存錯組），以 `putBuf` 存進目前模型組（伺服器預設組也一樣寫到伺服器），繪製前的檔案當原始檔（已有原始檔時沿用），回覆 `rp-saved { id, ok, msg }`。繪圖端匯出時只匯出載入場景的子節點，維持 `rubicon_origin` 是唯一根節點；圖層以 `.rpaint` 專案存在它自己的 IndexedDB（`rubicon-paint` 的 `autosave`，鍵 `lib:模型組\n槽位`，記錄存回的 GLB 雜湊），下次開同一槽位且模型庫裡還是那個檔案時接著畫。匯出的 GLB 貼圖是 PNG、不再是 Draco 壓縮，檔案會變大。
- **視圖、姿勢與參考圖**（`library/ref-tools.js` 的 `RefTools`，組裝調整頁、檢視窗的組合預覽／完整機甲、GLB 編輯器各一個）：正交視圖（正視＝從 −Z 看、側視＝從右側 +X 看、背視）切換時把宿主的 `camera`／`controls` 換成正交鏡頭（宿主一律透過 `this.camera`、`this.controls` 使用；TransformControls 與檢視窗的 JointEditor 鏡頭跟著換；`resize` 改透視鏡頭的 aspect 再呼叫 `ref.resize`；檢視窗正交時不做後處理）。快速姿勢（`pose.js`：手臂張開、手肘、腿張開、膝蓋，A pose 預設）只影響顯示，套在 `restPose` 之後，存檔一律是拉直靜止姿勢（組裝調整頁只在「拉直靜止姿勢」時套用；只動關節的計算仍以靜止姿勢為準）。參考圖每個模型組一套（正面、側面＋校正值 top／bottom／cx 比例、flip、目標身高、透明度、疊在模型上），存在獨立的 IndexedDB `rubicon-ref-images`（`RefStore`，不升級模型庫資料庫），複製、刪除、匯出（`refs.json`＋`refs/<view>.<ext>`，上傳伺服器的 stable 打包不含）、匯入模型組時跟著走。平面掛在 `rig.group` 底下（`userData.helper`，點選與量測略過），腳底中心對準機甲原點；目標身高空白時用網格量出的實際高度（`bodyH`，遊戲判定用的 `height` 比外觀矮）。
- **組裝調整頁的「模型」模式**（`workshop-edit.js` 的 `modelSlot`／`commitModel`）：選有自己 GLB 的區塊，以原點為中心縮放／位移／旋轉模型（拖曳 W／E／R 或輸入增量），原點節點 W'＝T·W 寫回 GLB（和只動關節相同的 `rubicon_origin` 機制，連接點與原點不變），對稱編輯時另一側套 S·T·S，可復原。
- **GLB 編輯器的全身參考**（`editor-context.js`）：零件組合＝目前模型組記住的組合換上這個零件（`stage.js` 的 `composeAsm`，檢視窗的組合預覽也改用它），模型＝目前模型組的 GLB；整台機甲放在容器裡，容器矩陣＝這個區塊（關節群組）世界矩陣的反矩陣，所以編輯中的模型（原點）和周圍對得上；這個區塊在機甲裡隱藏。半透明／線框／實體與開關記在 localStorage `rubicon_glb_ctx`；拆分模式時隱藏。
- GLB 來源優先順序（模型庫）：瀏覽器暫存（拖曳進模型庫，IndexedDB，目前模型組）＞內建（`src/assets/models/<槽位 id>.glb`）＞程式模型；左側武器沒有 GLB 時暫用右側。完整機甲（`mech/`）不接受整台 GLB，只顯示區塊組合（`buildMech` 的 `opts.piece` 換成 GLB）。會動的載具也拆成區塊（`vehicle/<key>/hull|turret|body|rotor|tail`，`render/vehicle-models.js`），列車分機車頭／車廂；完整載具、疊放貨櫃、掩體的目錄項目有 `parts`，模型庫以區塊組合預覽（`stage.js` 的 `prepareAssembly`）；`noGlb` 且 `parts` 為空的（高台、公路、鐵路）不接受 GLB。
- **遊戲的本地模型庫**（單人模式；伺服器網址時見上面的「伺服器模型組」）：設定（`rubicon_localmodels`：總開關＋機甲區塊／武器／載具／地圖物件／小物件）開啟時，`render/local-models.js` 讀取模型庫 IndexedDB 的 GLB 與關節設定（不建立資料庫、讀完即關閉連線；同來源才讀得到），解析後快取範本。建模函式透過 `render/model-provider.js` 的 `providedModel(slot, pal, unique)` 取得實例：`buildMech` 的區塊、`vehicle-models.js` 的載具區塊（`swapPiece`）、`extra-models.js` 的運輸車輛／掉落物／轟炸機／彈體、`world/prop-models.js` 的地圖物件（`propGlb`：依隨機尺寸縮放、main 材質換成物件顏色、`propMats` 回傳材質給遮擋與閃光）。沒有設定來源時一律回傳 null（程式模型），所以這些函式仍是純函式；多人時 `LocalModels.allow()` 回傳 false，關節覆寫也以 gate 停用。進車庫、單機出擊前（`lmRefresh`）與標題的「重新載入本地模型」會重新讀取。換模型只改外觀，碰撞與判定一律用程式模型的數值。內建 GLB 遊戲目前還不讀。
- **GLB 編輯器**（模型庫的「GLB 編輯」頁籤，網址 `#editor` 或 `#editor=槽位 id`；檢視窗的「在 GLB 編輯器開啟」）：修正外部（AI 生成等）GLB 的朝向、尺寸、原點與節點。編輯中的模型保持 glTF 座標（`frame` 繞 Y 轉 180° 顯示＞`xform` 整體變換＞原始場景），存檔時 `bakeScene` 把變換寫進頂點（行列式為負時翻轉三角形順序）、輸出扁平節點的 GLB。存到槽位時在 IndexedDB 紀錄的 `orig` 保留原始檔（拖曳替換則沒有），可以還原；鏡像存到另一側不保留原始檔。選了槽位時以黃色圓環標出程式模型的原點（場景原點）；「拖曳原點」用箭頭拖一個把手，放開時把該點設為原點（`setOrigin`，可復原）。網址帶 `?test` 時模型庫把編輯器放在 `window.__glbEditor`，冒煙測試用來算控制點在畫面上的位置。不指定槽位時只能下載。**組合**：「加入 GLB…」把另一個 GLB 加成新節點；「合併成一個節點」用 `mergeByMaterial` 把子樹的變換寫進頂點並依材質合併。新增的節點登記在 `nodes` 尾端，復原到加入前的快照時（快照裡沒有它）會標成刪除。**拆分**（`editor-split.js`）：選零件組合後以程式模型（`buildMech`，各區塊不同顏色）為參考，調整它的姿勢配合模型（快速姿勢＋各區塊關節旋轉，加在 `restPose` 之上），勾選的區塊各顯示一個範圍框（程式模型的區域外框，可調整尺寸／位移與全部放大，掛在區塊上跟著姿勢；選中的框有 6 個面的控制點與中心控制點可拖曳，在 `#edView` 的捕獲階段攔截 pointerdown，不讓視角與箭頭工具接到；範圍框的調整記在編輯器的快照裡可以復原），並標出關節（連接點）位置，模型攤成三角形湯（`editor-cut.js`，每個三角形記錄區塊編號；運算一律產生新陣列，復原只保留參照）後，每個框各自裁切：先挑出外框碰得到的三角形，再依序以框的 6 個面（往外推 2 mm）與重疊平面切開、保留內側並補切面，框外的全部移除；兩框重疊時父子區塊以連接點平面切開（法線＝父框中心 → 連接點），其他以中垂面切開。拆分前可以拖曳關節點（小菱形，`jadj`：連接點位置＋子區塊在關節群組裡的位移，記在編輯器快照裡），區塊與範圍框不動；重疊平面只切兩框外框交集範圍內的三角形（範圍外標成 2，`cutSoup` 只切 0／1）。拆分後檢查各區塊沿骨頭方向（原點 → 子區塊的連接點）比程式模型短或長的程度並提示；之後可以框選改分配或排除、平面切割（只切分給兩個區塊且在半徑內的三角形，切口補面），存檔時每個區塊乘上「該區塊的關節群組（原點＝關節點）在擺好姿勢的程式模型中的反矩陣」＋轉 glTF，所以存成拉直靜止姿勢下的區塊座標，移動過的連接點同時寫進關節設定。**材質**（`editor-mat.js`）：色槽就是材質名稱；依面指定色槽是把網格改成多重材質（重排索引＋groups，產生新幾何、共用頂點屬性），色槽材質是原材質的複製（對應關係放 WeakMap，不放 userData，因為 GLTFExporter 會把 userData 寫進檔案），貼圖依模式轉灰階（亮度依該群平均正規化）或移除、材質顏色設成白色交給陣營色；依顏色分群取三角形重心在貼圖上的顏色做面積加權 k-means，各群一次套用（重排索引後三角形編號會變）；預覽配色只在繪製時換材質。快照另外記每個網格的幾何與材質參照、材質參數與貼圖參照（`allMats`：含原材質與已建立的色槽材質，換貼圖時要一起改）。**貼圖**（`editor-tex.js`）：載入時以 GLTFLoader 的 `parser.associations` 對回 GLB 裡的圖片位元組（`ORIG`，「原檔」下載用）；換圖一律建立新貼圖並沿用原圖的 flipY／encoding／wrap／變換，格式依圖片有無透明設 RGBA／RGB（r128 的 GLTFExporter 以格式決定 PNG 或 JPEG）；灰階圖記錄來源與倍率（`derivedOf`），換原圖時重算；粗糙度＋金屬感是同一張圖的 G／B（AO 是 R），可只換單一通道；加入 AO 時補 `uv2`（r128 的 AO 用第二組貼圖座標）；zip 不壓縮、自己寫（`makeZip`）。**刪除多邊形**（`editor-del.js`）：「只選看得到的」另外算繪一張三角形編號圖（不共用頂點的幾何帶 `tid` 屬性，編號＋1 編進 RGB，最多 2 倍解析度）整張讀回，再取範圍內的像素；相連以頂點位置量化後聯集；對稱在 frame（glTF 座標）以鏡像重心到已選三角形表面的距離判斷；選取標示放在場景根部的 `hl` 群組（不在模型裡，不會被匯出），每次繪製前跟著網格的 matrixWorld；在 `#edView` 捕獲階段攔截左鍵 pointerdown／pointerup（pointerup 要在那裡直接結束這一筆，因為已經停止傳遞），選取模式中 OrbitControls 改成右鍵旋轉、中鍵平移；刪除用 `removeTris` 產生新幾何（保留材質分組、清掉沒用到的頂點、保留屬性型別與 morph）。**最佳化與輸出**（`editor-opt.js`）：減面用 meshoptimizer 的 `simplifyWithAttributes`（法線、貼圖座標當屬性，每個材質群組各自減，先焊接頂點），目標留 2% 餘裕；匯出後處理直接改寫 GLB（`processGlb`：縮小貼圖、不透明的轉 WebP 並加 `EXT_texture_webp`、有透明的存 PNG、Draco 逐 primitive 壓縮並加 `KHR_draco_mesh_compression`，再重新打包 bufferView）。Draco 編碼器的 Emscripten 模組是 thenable，resolve 前要刪掉 `then`。匯出設定存在 localStorage `rubicon_glb_export`（模型庫的設定，不是遊戲存檔）。
- GLB 規格（+Z 正面、單位公尺、區塊與原點、依材質名稱換色、預算）見 `docs/glb-spec.md`；數值定義在 `render/glb.js` 的 `GLB_BUDGET`／`PALETTE_SLOTS`，區塊與連接點在 `render/mech-model.js`，修改時同步更新文件。
- GLB 載入時要逐節點轉座標系（`flipToGame`），不能只轉根節點。
- 尺寸一律以公尺標示；量測（`measureBox`）排除描邊外殼與加色發光特效。
- 模型庫的擺放要和遊戲一致：原點在地面的模型（完整機甲、組合預覽、載具、地圖物件…）以原點貼地（`stage.js` 的 `finalize`），GLB 往下超出時會沉入地面，檢視窗資訊列顯示「最低點（遊戲中離地）」；只有單一區塊（原點是旋轉中心）以最低點貼地。組裝調整頁也以原點貼地。
- 地圖物件的網格在 `world/prop-models.js`（純函式，不呼叫亂數）；關卡生成照原順序用亂數決定參數後呼叫。改動這裡或 `world.js` 時，亂數呼叫順序不可改變（多人同一 seed 必須產生相同地圖）。

### 渲染風格（render/style/、game/style-lab.js）

- **著色器**：`installStyleShader()` 改 `MeshStandardMaterial.prototype.onBeforeCompile`（遊戲在 `game/render-setup.js`、模型庫在 `library/inspect.js` 載入時呼叫），所有標準材質（含 GLB）共用同一份修改過的著色器：色階光照（攔截 `RE_Direct`，陰影另存 `stSh`）、影色、硬邊高光、邊緣光、動畫金屬反光帶、貼圖細節（高 mip 取平均色）、面板凹凸倍率、環境反射倍率、機體金屬、水彩地形、高度霧。**全部以 uniform（`SU`，全域共用物件）切換，不重新編譯**；參數為預設值時結果和原本的物理渲染相同。只有色調映射與陰影種類需要重新編譯（`applyStructural` 回傳 true 時把場景材質標 `needsUpdate`），所以左右比較時兩邊共用目前的這兩項。
- **材質分類**：機甲、武器、載具＝1（金屬只套這類），在 `buildMech`／`buildVehicle`／`buildHeli`／`buildDrone`／`buildTransport`／`buildBomberMesh` 結尾呼叫 `tagStyle(root)`；記在 WeakMap（不寫 userData）。不透明材質輸出的 alpha 記分類（環境 1、機體 0.5；`OUTLINE_MAT` 也輸出 0.5），後處理的描線與動態模糊用它分辨；canvas 沒有 alpha，畫面不受影響。
- **管線**（`StylePipeline`，取代原本的 EffectComposer 組合）：場景畫一次到含深度貼圖的 target →（SSAO：借用 `SSAOPass` 的法線與 AO 計算，不再讓它重畫場景）→ 合成（AO、以上一格 view-projection 重投影的鏡頭動態模糊、以 1/z 的拉普拉斯找輪廓與轉折的螢幕空間描線）→ Bloom → 調色（含 gamma、色溫、暗部／亮部色偏、暗角、色差、顆粒、紙紋）→ FXAA。`applyScene` 每格依參數改霧（以戰區的基準值乘倍率，換新 Fog 物件時重新記錄基準）、天空、太陽色溫與強度、`this.sunOff`（太陽方位，`camera.js`／`first-person.js` 用它擺太陽）、外殼描邊。車庫與模型庫檢視窗用 `indoor`（不改霧與天空）。模型庫同一頁有其他畫面，畫完風格預覽要 `resetStyleGlobals()`。
- **參數**：`params.js` 的 `STYLE_GROUPS` 同時是調整介面的定義（`when` 決定是否顯示）；內建預設 real（原本的畫面）、ac6、gundam、ghibli；`normalizeStyle` 補齊與限制範圍（讀別人上傳的參數時也用）。新增參數：加到 `STYLE_GROUPS` 與 `REAL`，再到 `setStyleUniforms`／管線使用。
- **選用與套用**：`StyleStore`（`rubicon_style`）＝選中的風格＋機體金屬開關（獨立於風格）＋解析度。遊戲在 `styleRefresh()` 讀取：標題設定變更、進車庫、`startMission`、客機開局；**任務中不換**（暫停選單的設定停用）。解析度是效能設定，隨時可改。
- **實驗室**（`game/style-lab.js`）：`this.lab` 存在時 `loop` 改呼叫 `labTick`（`state` 仍是 'play'，暫停選單的「放棄任務」變成離開）。兩隊：藍隊＝玩家的機體＋友軍（`allyDur` 極大）、紅隊＝敵人，具名 AC 與載具／雜兵，死亡 4 秒後重生、彈藥自動補滿；`onEnemyKilled`／`onPlayerDead` 在實驗室直接返回、消耗品停用，所以不寫存檔。觀看模式玩家機體 `ai='ac'`、`isPlayer=false`；操作模式和任務相同。面板的修改要「存成我的預設」或「套用到遊戲」才會留下（套用時有修改會先存成我的預設）。上傳到伺服器用 `PUT /api/styles/<id>`（區網內任何人可新增、刪除）。

## 架構陷阱

- 多人連線是房主權威：邏輯只在房主執行，客機送輸入、收 30 Hz 快照。新增遊戲狀態時要同時處理 `net/snapshot.js` 的 `serEnt`／`applyEnt`、快照欄位（`game/mp-host.js` 的 `hostTick`、`game/mp-client.js` 的 `clientApplySnapshot`）、事件 `netEv`／`clientEvent`，以及房主遷移（`game/mp-host.js` 的 `promoteToHost`）。
- 客機在任務中 3 秒沒收到房主訊息就判定房主失聯並遷移（`clientTick`）；本機卡住超過 1 秒（開局建地圖與模型、編譯著色器）或開局後第一次更新時重新起算，否則慢的電腦會誤判。
- 新增選單畫面（新的 `state`）時，要把它加進 `game/game.js` 的 `loop` 裡只畫背景的選單狀態清單（title、saves、result、mp、lobby…），否則會被當成任務中而讀到空的 `player`。
- 改動網路協定時要提高 `net/transports.js` 的 `NET_VERSION`（目前 `'9.0'`），否則新舊版本會互連。
- 關卡生成必須維持以種子決定（`makeRng`／`makeNoise`／`withRng`），多人各端靠同一 seed 產生相同地圖。不要在生成流程裡用 `Math.random`。
- 存檔與設定存在 localStorage：`rubicon_save_1`～`rubicon_save_3`（三個存檔槽，各自完整一份，含 PvE／PvP 駕駛員）、`rubicon_save_cur`（目前的槽位；不存在時把舊版單一存檔 `rubicon_save` 搬進存檔 1，舊鍵保留當備份）、`rubicon_keys`、`rubicon_ctrl`、`rubicon_pad`、`rubicon_post`、`rubicon_turn`、`rubicon_relay`、`rubicon_nick`、`rubicon_unmask`、`rubicon_localmodels`、`rubicon_style`（渲染風格：選用的風格、機體金屬、解析度、我的預設、伺服器清單快取）。
- 顯示暱稱、房名、房主送來的結果欄位等遠端資料時，放進 `innerHTML` 前一律用 `core/html.js` 的 `escHtml` 跳脫（或改用 `textContent`）。
- 目前所有模型、貼圖都是程式即時產生（Canvas 貼圖＋幾何拼接），只有單人模式開啟本地模型庫時才會換成瀏覽器暫存的 GLB。執行時不能依賴外部資源檔：新的素材（音效、GLB）必須在建置時內嵌進單一 HTML，程式庫放 `dist/lib/`。

## 其他

- 與使用者溝通、註解與 UI 文字一律使用繁體中文。
- UI 字串中的全形空白（U+3000）是刻意的，不要移除（ESLint 已設定略過字串）。
- 程式碼風格由 Prettier 統一（`.prettierrc.json`：單引號、寬 110）；ESLint 只開抓錯誤的規則。
- `dist/` 的檔案都要提交：每次 commit 前先跑 `npm run build`（正式版；`npm run dev` 產生的是含 source map 的開發版，不要提交），確認 `dist/` 的 HTML 已更新再一起 commit。`dist/rubicon-server.exe` 約 55 MB，修改 `server.js` 後要 `npm run build:exe` 並一併提交；exe 執行中時無法覆寫。發佈時提供 dist/ 的 exe、HTML 與 `lib/` 資料夾（加上 `README.txt`；文字動畫 `apng/`、貼圖繪製 `paint/` 選用）。伺服器的 `/lib/…`（以及 `/models/lib/…`）提供同資料夾 `lib/` 裡的檔案。
