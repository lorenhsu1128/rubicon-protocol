# Boss 改版的交接文件

給接手這項工作的 Claude。**設計看 `docs/boss-design.md`**（使用者 2026-10-29 定案的內容），這份只寫怎麼做、注意什麼、做到哪裡。每做完一期就更新最後的「進度」。

## 0. 開工前

1. `git fetch` ＋ `git pull --ff-only`，在 **main** 上開發、直接 `git push origin main`（`scale3x`、`coral-war` 分支不要動；main 已經沒有 RTS，不要提或測 RTS）。
2. node 不在工具 shell 的 PATH：Bash 先 `export PATH="/c/Program Files/nodejs:$PATH"`。
3. 讀 `CLAUDE.md`（整份，尤其「新 Boss」「第三批 Boss」「Boss 強度」「架構陷阱」「Mixin 規則」）與 `docs/boss-design.md`。

## 1. 使用者的規則（這台機器的記憶沒有，照這裡做）

- 對使用者、註解、UI 文字一律**繁體中文**。
- **不准用 sub agent／Workflow 派工**，除非使用者明確下令；長的測試自己用背景 Bash 跑。
- **每次 commit**：先 `npm run build`，把 `dist/rubicon-protocol.html`、`dist/model-library.html` 一起提交；只有改了 `server.js` 才要 `npm run build:exe` 並提交 exe。不要手改 `dist/`。
- 每期做完：`npm run lint`、`npm run format:check`、`npm test`（全套冒煙測試，約 9 分鐘）→ build → commit → push，**直接接下一期**，不用停下來問；換期時不必等 compact。
- 測試或截圖開的瀏覽器跑完要關，並檢查殘留的 headless msedge；**不要動使用者自己的程序**（msedgewebview2、VS Code、playwright MCP 的 node、Adobe 的 node）。
- **不要跑電腦對電腦的勝率對戰**；這次使用者也說**不用量測**擊破時間（O 的基準時間先一律 180 秒）。
- 所有機甲比例照 `src/assets/player-mech/`（新部位掛在機甲型 Boss 上時也一樣）。
- 不要用、也不要提 Polyfork 模型。
- commit 訊息照現有風格（中文、一行摘要＋破折號說明），結尾：

  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  ```

  （另加你自己這個 session 的 `Claude-Session:` 行，如果系統有給。）

## 2. 相關的程式

| 東西 | 位置 |
|---|---|
| Boss 定義、強度常數、`BOSS_DEFS`（22 隻的順序）、`PART_DEFS`、`bossForLevel` | `src/data/enemies.js`（約 26～720 行） |
| 主線哪一章打哪一隻 | `src/data/campaign.js` 的 `SORTIES`（區段的 `boss:`，`echo: true`＝殘響） |
| Boss 生成（`spawnBossDef`） | `src/game/mission.js` |
| 新 Boss 的生成、部位、`bossPhaseTick`（換型態、狂暴、增援） | `src/game/bosses.js` |
| 第三批 Boss 的場上判定（`later`、`addPool`、`pulseRing`、`beamAttack`） | `src/game/bosses2.js` |
| 型態、節奏、`bossTick`（不用 move 的實體）、失衡後保護、`partBreak`、`bossDefense` | `src/entities/mech-boss.js` |
| 第三批 Boss 的行為、`boss2Defense` | `src/entities/mech-boss2.js` |
| 最終型態的專屬招式 `SPECIALS`／`boss3Tick` 與共用零件 `b3*` | `src/entities/mech-boss3.js` |
| 一般大型 Boss（JUGGERNAUT、STRIDER、BALTEUS；HELIOS 是 kind heli）的 `bossAI` | `src/entities/mech-entity.js` |
| 受傷、ACS、失衡（Boss 1.5 秒）、`stagGuardT` | `mech-entity.js` 的 `takeDamage`（約 1860～2100 行） |
| 防禦掛勾的順序 | `specialDefense`（`mech-special.js`）→ `bossDefense` → `boss2Defense` |
| 完美 QB、反擊提示 | `mech-entity.js` 的 `pqbCheck`、`cueTick` |
| 風格評價 | `src/entities/mech-style.js`（`syAdd`…）、HUD `src/game/style-meter.js` |
| 可以打掉的投射物 | `src/entities/projectile.js` 的 `shootable`、`src/game/hazards2.js` |
| 區域效果、臨時障礙物 | `src/game/hazards2.js` 的 `addZone`、`addTempWall` |
| 掉落物 | `src/world/map-extras.js` 的 `PICKUP_DEFS`、`dropAmmo` |
| 橫幅、傷害數字、BREAK | `src/game/juice.js`、`src/game/textfx.js` |
| 主線結算、三選一 | `src/game/campaign.js` 的 `campEnd`、`src/game/tactics.js` |
| Boss 的程式模型（部位要掛的節點 `mounts`） | `src/render/boss-models.js`、機甲型 Boss 用 `buildMech` |
| 快照、事件、房主遷移 | `net/snapshot.js`、`game/mp-host.js`（`hostTick`、`promoteToHost`）、`game/mp-client.js` |

## 3. 做法的建議

- 新增 `src/data/boss-tier.js`：`TIER[1..8]` 放 `boss-design.md` 第 2 節所有表格的數字（純資料＋純函式 `tierOf(...)`）。
- 刁鑽度在生成時決定、存在實體（例如 `opts.tier`），隨生成紀錄同步（`bt`）；實體上用 `this.bossTier()` 取。部位跟著本體。
- 各方案的共用邏輯放新的 `entities/mech-boss-tier.js`（MechEntity 擴充）與 `game/boss-tier.js`（Game 的 mixin：HUD、雜兵小隊、評價）。**mixin 檔不能 export**、要在 `main.js` 加 import、方法名稱不能和別的 mixin 重複。
- 每隻 Boss 的專屬內容（第 3 節）做成資料表 `BOSS_KIT[種類]`（部位、破綻的招式、三個大招、可以打掉的彈體、場地變化、四種反制），種類鍵照 `mech-boss3.js` 的 `boss3Key()`（kind，沒有 kind 的用名稱開頭 JUGGERNAUT／STRIDER／BALTEUS）。
- 新的特殊攻擊呼叫 `takeDamage` 時要**傳屬性**（第 8 個參數：爆炸／衝擊波 'exp'，光束／能量環／EMP 'en'）。
- 預警與特效用會轉送給客機的 fx（`render-setup.js` 的 `wrapFx` 清單），新增的 fx 名稱要加進清單。
- 「推進遊戲時間、不等實際時間」：測試用 `freezeLoop(page)`＋`window.__pump(秒, 條件)`，亂數用 `seededRandom(page)`（見 CLAUDE.md 的冒煙測試段落）。

## 4. 要注意的坑

- **多人是房主權威**：判定只在房主；新的狀態（打斷量表、破綻、反擊點、應對中的習慣、刁鑽度、評價、破甲充能）要進快照或事件，客機只顯示；房主遷移時狀態機從頭開始也要能接手。改了協定要提高 `net/transports.js` 的 `NET_VERSION`（目前 `'11.7'`）。
- **ACS 失衡的時間**：Boss 的 ACS 失衡只有 1.5 秒，A 的表是在這個基礎上縮短；各 Boss 自己的長硬直（撞牆 5 秒、倒下 7 秒…）不受 A 影響。
- **既有的弱點倍率**（`bossDefense`／`boss2Defense` 裡的 ×0.3、×1.7…）：照 `boss-design.md` 的 D 改成「平時倍率＋破綻 ×1.6」；用部位擋住本體的（發生器、砲台、引擎、斷腳）不要動。
- **部位的模型**：新的部位要掛在 Boss 模型的節點（`mounts`）上；`render/boss-models.js` 的模型如果經過網格合併，會動或會被拆的節點必須掛在 rig 上（見 CLAUDE.md 的「網格合併」規則），`visible` 一律給布林。
- `bossVis` 是位元旗標，讀寫都用位元運算，不要用 ===。
- 鎖定、HUD 略過 `noLock` 的目標；新部位要能被鎖定。
- 新的選單狀態要加進 `game.js` 的 `loop` 的選單狀態清單（這次應該用不到）。
- 版面：新的 HUD 要用三種大小截圖（1920×1080、1180×820、844×390 觸控）。

## 5. 測試

- 現有的 Boss 測試：`testBosses`、`testBosses2`、`testBossPower`、`testBoss3`、`testMpBosses`（`:halberd`／`:citadel`／`:mirage`／`:cerberus`），都在 `scripts/smoke-test.js`；`SMOKE_ONLY=testBossPower npm test` 只跑一項。改了 Boss 的數值後這些測試的預期值可能要跟著改（例如防禦倍率）。
- 每期新增一個測試（例如 `testBossTier`）加進 `STEPS`：刁鑽度的換算、A 的遞增與重置、D 的破綻倍率、I 的打斷、K 的充能、L 的加成、O 的評價；第 3～5 期每隻 Boss 的部位停用招式、三個大招都打斷一次、打回去的彈體、場地變化、四種反制都觸發一次，並截圖（`test-results/boss-<種類>-*.png`）看預警與部位。
- 已知不穩定（和這次無關）：testSolo 的「出擊後 HUD 顯示」偶爾在平行時失敗、重跑通過；鰻魚無人機的 `skim` 檢查偶爾失敗。

## 6. 回報

- 對使用者用繁體中文，簡短：這期做了什麼、測試結果（通過幾項、失敗的原因）、commit 編號、實際花了多久。
- 設計需要改的地方（做不到、或做了發現不好玩）先問使用者，並同步改 `boss-design.md`。
- 全部完成後把 CLAUDE.md 的 Boss 段落同步（加一段「Boss 改版（刁鑽度）」並指到 `docs/boss-design.md`）。

## 7. 進度

| 期 | 狀態 | commit | 備註 |
|---|---|---|---|
| 1 共用架構 | 未開始 | | |
| 2 部位、打回去、應對、場地 | 未開始 | | |
| 3 第 1、2 章的 Boss | 未開始 | | |
| 4 第 3、4 章的 Boss | 未開始 | | |
| 5 第 5、6 章的 Boss | 未開始 | | |
| 6 收尾 | 未開始 | | |
