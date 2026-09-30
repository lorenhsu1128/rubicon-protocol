# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 專案概要

瀏覽器 3D 機甲動作遊戲（Three.js r128）＋ Windows 區網伺服器。遊戲原始碼是 `src/` 下的 ES modules，由 esbuild 打包成**單一 HTML**（CSS、JS、音效全部內嵌）；發佈形式是「`rubicon-server.exe` ＋ `rubicon-protocol.html`」兩個檔案。

- `src/`：遊戲原始碼（見下方架構）。`src/index.html` 是 HTML 骨架，建置時把 `styles.css` 與打包後的 JS 內嵌進去。
- `dist/`：建置產物 `rubicon-protocol.html`、`rubicon-server.exe`（只有 exe 進 git）。**不要手改 dist/**，改 `src/` 後重新建置。
- `server.js`：區網伺服器。遊戲 port 預設 80（提供遊戲頁、`/health`、`/ws` WebSocket 中繼），控制台固定 port 8090。開發時讀 `dist/rubicon-protocol.html`，打包成 exe 後讀 exe 同資料夾的檔案（以 `process.pkg` 判斷，改打包方式時要一併修改）。
- `scripts/build.js`：建置腳本；`scripts/smoke-test.js`：冒煙測試；`scripts/test-server-preload.js`：測試時讓 server.js 改聽 127.0.0.1 測試 port、不開瀏覽器。
- 函式庫（three、peerjs、three examples 後處理）仍由 `src/index.html` 從 CDN 以一般 `<script>` 載入，程式裡以全域變數 `THREE`、`Peer`、`SimplexNoise` 使用，不要改成 import。

## 指令

```bash
npm install

npm run build        # src/ → dist/rubicon-protocol.html（壓縮）
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
- `dist/rubicon-protocol.html` 必須維持可以用 file:// 直接開啟：所以輸出格式是 IIFE 的一般 `<script>`，不是 `type="module"`。

### 冒煙測試（`npm test`）

用 headless Edge／Chrome（SwiftShader WebGL）跑：file:// 開啟標題畫面 → 單機出擊 → `?lan=local` 兩分頁多人（建房、加入、出擊、房主離線遷移）→ 啟動 server.js 測 `/health`、`RUBICON_SERVER` 注入、WebSocket 中繼多人。收集 pageerror 與 console.error，截圖存到 `test-results/`（gitignore）。沒有單元測試框架；改動遊戲邏輯時看截圖確認畫面。

## 原始碼架構（src/）

```
main.js              進入點：依序 import 所有 mixin，最後 new Game()
index.html／styles.css
core/math.js         RNG、makeRng、makeNoise、withRng、clamp/lerp/rnd…
data/                parts.js（零件、START_ASM、asmStats）、enemies.js（AC_ROSTER、BOSS_DEFS、ENEMY_TYPES）
render/              materials.js（Canvas 貼圖、mechMats、PALETTES）、geometry.js（幾何快取與拼接工具）、
                     mech-model.js（buildMech、animateMech、武器模型）、vehicle-models.js
world/               world.js（World：關卡生成、THEMES）、map-extras.js（Vehicle、Pickup、PICKUP_DEFS）
audio/               audio.js（SFX）、sfx-data.js（匯入 assets/sfx/*.mp3）
fx/effects.js        Effects 粒子／曳光／碎片
entities/            projectile.js、mech-entity.js（MechEntity）、mech-remote.js（MechEntity 客機端擴充）
net/                 transports.js（NET_VERSION、PeerJS／BroadcastChannel／WebSocket 傳輸）、net.js（Net）、
                     snapshot.js（serEnt／applyEnt 快照序列化）
game/game.js         class Game：constructor、主迴圈 loop、敵我判定等核心
game/*.js            Game 的 mixin：render-setup、save、input、settings、garage、mission、player、camera、hud、
                     mp-lobby、mp-host、mp-client、map-extras、first-person、pvp；constants.js 放 mixin 共用常數
assets/sfx/*.mp3     音效原始檔（建置時以 base64 內嵌）
```

### Mixin 規則（重要）

`Game` 的方法分散在 `game/*.js`，每個檔案是 `Object.assign(Game.prototype, { ... })`；`MechEntity`、`Effects` 也有同樣的擴充。

- **mixin 檔不能 export 任何東西**，只能由 `main.js` 以副作用 import 載入。否則別的模組 import 它時會在 `Game` 定義前執行 `Object.assign`（循環相依 → TDZ 錯誤）。mixin 需要共用的常數放 `game/constants.js`。
- 新增 mixin 檔要在 `main.js` 加 import；方法名稱不可與其他 mixin 或類別重複（後載入的會默默覆蓋）。
- 新方法放進對應主題的 mixin；`game.js` 只留核心。

### 模組相依

- 各模組明確 import 所需名稱；ESLint（`no-undef`）會抓到漏 import。
- ES module 匯入的綁定是唯讀的：`let` 狀態（如 `RNG`、`MECH_ID`、`VEH_ID`）只能在定義它的模組內重新賦值，跨模組要改就提供函式。
- 全域 `game` 由 `main.js` export；只能在執行期（函式內）使用，不要在模組頂層使用。`const game` 不是 `window.game`。
- 新增音效：把 mp3 放到 `src/assets/sfx/`，在 `audio/sfx-data.js` 加 import 並放進 `SFX_DATA`。

## 架構陷阱

- 多人連線是房主權威：邏輯只在房主執行，客機送輸入、收 30 Hz 快照。新增遊戲狀態時要同時處理 `net/snapshot.js` 的 `serEnt`／`applyEnt`、快照欄位（`game/mp-host.js` 的 `hostTick`、`game/mp-client.js` 的 `clientApplySnapshot`）、事件 `netEv`／`clientEvent`，以及房主遷移（`game/mp-host.js` 的 `promoteToHost`）。
- 改動網路協定時要提高 `net/transports.js` 的 `NET_VERSION`（目前 `'7.0'`），否則新舊版本會互連。
- 關卡生成必須維持以種子決定（`makeRng`／`makeNoise`／`withRng`），多人各端靠同一 seed 產生相同地圖。不要在生成流程裡用 `Math.random`。
- 存檔與設定存在 localStorage：`rubicon_save`、`rubicon_keys`、`rubicon_ctrl`、`rubicon_pad`、`rubicon_post`、`rubicon_turn`、`rubicon_relay`、`rubicon_nick`、`rubicon_unmask`。
- 顯示暱稱、房名等遠端資料時要跳脫 HTML（現有 `innerHTML` 多處未跳脫）。
- 所有模型、貼圖都是程式即時產生（Canvas 貼圖＋幾何拼接）。執行時不能依賴外部資源檔：新的素材必須在建置時內嵌進單一 HTML。

## 其他

- 與使用者溝通、註解與 UI 文字一律使用繁體中文。
- UI 字串中的全形空白（U+3000）是刻意的，不要移除（ESLint 已設定略過字串）。
- 程式碼風格由 Prettier 統一（`.prettierrc.json`：單引號、寬 110）；ESLint 只開抓錯誤的規則。
- `dist/rubicon-server.exe` 約 55 MB，會提交進 git（`.gitignore` 只放行這個檔；dist/ 其他產物不進 git）。修改 `server.js` 後要 `npm run build:exe` 並一併提交 exe；exe 執行中時無法覆寫。發佈時提供 exe 與 `npm run build` 產生的 HTML（加上 `README.txt`）。
