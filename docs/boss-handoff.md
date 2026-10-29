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
| 1 共用架構 | 完成 | ab0c28f | 見下方「第 1 期的實作」 |
| 2 部位、打回去、應對、場地 | 完成 | ecef294 | 見下方「第 2 期的實作」 |
| 3 第 1、2 章的 Boss | 完成 | 1ba92c8 | 見下方「第 3 期的實作」 |
| 4 第 3、4 章的 Boss | 完成 | （見 git log） | 見下方「第 4 期的實作」 |
| 5 第 5、6 章的 Boss | 未開始 | | |
| 6 收尾 | 未開始 | | |

### 第 1 期的實作（接手的人先看）

- **檔案**：`src/data/boss-tier.js`（`TIER[1..8]` 的全部數字、`campaignTier`／`freeTier`／`aNeedK`／`aStagT`／`oRank`／`kSquad`）、`src/entities/mech-boss-tier.js`（A、D、I、K 的破甲彈、L 的加成、同步 `serTier`／`tierView`、破綻光環 `tierFx`）、`src/game/boss-tier.js`（K 的雜兵小隊與充能、O 的評價與獎勵、`tierIntro`、HUD `tierHud`）。網路版本 `11.8`。
- **刁鑽度的來源**：`spawnBossDef(bd, sh, sd, tier)` 的第 4 個參數（沒給時照自由出擊的索引；`0`＝不套用，靶場傳 0）→ `this.spawnTier` → `spawnEnemy` 給 `isBoss` 的實體設 `opts.tier` → 生成紀錄 `bt`。主線在 `campSpawnType`（`campaignTier`），模擬器照 `simSeen().bossT[kind]`（主線第一次遇到時 `simMark('bosses', kind, tier)` 記下），自訂關卡照 BOSS_DEFS 的索引。`g.tierTestOff = true` 時生成的 Boss 不套用（舊的 testBosses／testBosses2 用它檢查各 Boss 原本的機制）。
- **A**：`takeDamage` 的過載門檻乘 `tierAcsK()`，失衡秒數 `tierStagT(1.5)`（計入 `bt.stagN`）；`bossPhaseShift` 呼叫 `tierPhaseReset`。打斷與破甲彈直接設 `staggerT`，不算次數。
- **D**：`bossDefense` 最後乘 `tierDmgK()`（破綻 1.6、平時 `dBase`），**只改傷害、不改衝擊**。破綻＝`bt.openT`（`bossOpen(秒)`）或 `boss2Open()`（第三批 Boss 原本的弱點時機：散熱、爐口、冷卻、回收充能、過熱、撞牆、掉頭／失速、鍋爐過熱）。這 8 隻的 `boss2Defense` 在有刁鑽度時回傳 1（推土要塞保留正面 0.6／背後 1.3），原本的倍率只在沒有刁鑽度時用。大招收招 `tierMoveEnd(id)` 依 `dWhich` 決定（'two'／'one' 的招式清單先用 `OPEN_DEF`，第 3～5 期由 `BOSS_KIT` 的 `open2`／`open1` 覆寫；`game.bossKit(key)` 還沒有實作，`tierKit()` 回傳空物件）。
- **I**：`updateAI` 有刁鑽度時改呼叫 `tierTick`（第三型態的專屬招式也走這裡，沒有刁鑽度時照舊 `boss3Tick`）。每個型態先等 `I_CD[0]` 秒、之後每 `I_CD[1]` 秒蓄力一次；第一、二型態的大招先放在 `mech-boss-tier.js` 的 `BIG`（名稱照設計文件，內容是共用零件組成的暫代版本），第三型態＝`boss3Spec()`。**第 3～5 期把 `BIG` 換成每隻的專屬招式**（`BOSS_KIT[key].big`）。量表：本體與部位的 `takeDamage` → `tierGauge`；刁鑽度 3～4 後退／升高、5～6 正面護盾（`tierGuardK`，傷害與量表 ×0.25）、7～8 連續兩次（只斷一次＝`halfT` 讓 `b3Dm` 減半）。
- **K**：`onEnemyKilled` → `tierOnKill` → 玩家實體的 `bkAdd`（`this.bk`，快照 `bk` 給客機）；破甲彈在 `tierHitMods`（只打本體）。小隊在 `bossPhaseTick` → `bossTierTick`（`spawnType(..., null, 1)` 一台一台）。
- **L**：`tierHitMods` 依風格評價等級加成（本體與部位）；`syHurt` 在 Boss 戰中掉 `lDrop` 級、`syAdd` 重複的加分乘 `lRepeat`。
- **O**：最後一個 Boss 的 `die` → `tierBossRank`（`bossRank`），橫幅與 `bossDown` 事件帶評價；擊破獎金乘 `tierBountyK`；結算畫面多一列「Boss 擊破評價」；主線評價 S＝`camp.bossS` → `campEnd` 多一個三選一（`modPickQ` 排在 `endPick` 之後；**只有單人與房主**，客機沒有）。
- **還沒做（排在之後的期）**：J、M（反擊點的 `cpHitK` 已在 `tierGauge` 預留）、C、E、每隻 Boss 的 `intro` 多一句、`BOSS_KIT`、每隻的 `par`。

### 第 2 期的實作

- **每隻 Boss 的資料**：`src/data/boss-kit.js` 的 `BOSS_KIT[key]`（現在是空的，第 3～5 期逐隻補）＋`C_STAR`（刁鑽度 1～2 偵測的那一種習慣，已照設計文件的★填好）。`MechEntity.tierKit()` → `game.bossKit(key)`。欄位說明寫在檔頭（`parts`、`reflect`、`open2`／`open1`、`big`、`field`、`counter`、`star`、`habits`）。
- **J 部位**：`tierSetupParts(b)`（spawnBossDef 的最後）補到 `jParts` 個；原本就有部位的 Boss（`J_KINDS`：砲台、引擎、發生器、腳部關節、懸吊砲塔、列車車廂；浮游砲整群算一個）只補不夠的。還沒有 `BOSS_KIT.parts` 的用 `GENERIC_PARTS`（左肩／右肩／背部，各停用 p1／p2／p3）。部位是 `partKind 'bpart'` 的實體（模型暫用腳部關節），`opts.off`＝Boss 座標的偏移（Boss 身高的倍數，+Z 往前，`partFollowOff`）、`opts.hpAbs`＝血量（Boss 的 `jHp`）；生成紀錄帶 `off`／`ha`。`tierExpose` 的部位在 Boss 沒蓄力、沒破綻時 `bossVis` 1（隱藏、`noLock`、打不到）。打壞：`onEnemyKilled` → `tierPartDown`（`bt.lost` 停用 `stops` 的招式、掉 `bossPart`、`tierPartsBroken` → 結算 `tierPartsK()`），刁鑽度 5 起 `tierReb` 重建（7～8 換招）。刁鑽度 1～2 的部位在 HUD 有黃色菱形與名稱。
- **M**：Boss 與部位的 `foeShotOpt(dmg, kind)` → `tierShotOpt`（金色、`reflect`＝Boss id、`hitsNeed`；刁鑽度 5 起 35% 是紅色的假彈、不能打）。`damageProp`／`shotDamage` 多了第 5 個參數 `from`（射擊、雷射、近戰、投射物都有傳）；打掉時 `tierReflect` 生成一顆追著 Boss 的彈（最大 AP 1.5%、ACS 上限 60% 的衝擊）。刁鑽度 7～8 離 Boss 25 m×DS 以外打掉的，Boss 在快到時 `tierDodgeTick` 躲開。反擊點：`pqbCheck` → `from.tierCounterOn(玩家)` → `bt.cp`；那個玩家下一次打中＝傷害 ×2、打斷量表 ×2（`cpHitK`），HUD 是 Boss 頭上的藍字、Boss 身上的藍光。
- **C**：`tierHabitTick`（在 `tierTick` 裡）每 0.25 秒取樣目標玩家：離地 4 m×DS、15 m×DS 內、60 m×DS 外、`losBlocked`；超過 `C_THR` 就應對 12 秒，期間每 4 秒 `tierCounterMove`（`BOSS_KIT.counter[習慣]` 或共用的：對空掃射、衝擊波、砲擊、曲射）。HUD `#bossHabit`。同步在 `bt` 的第 7 格（位元）。
- **E**：`bossPhaseShift` → `tierFieldShift(b, ph)`（`BOSS_KIT.field[ph]` 是函式時用它）：有利＝3 道岩牆＋2 個彈藥箱；不利＝3 處燃燒地面＋（第三型態或刁鑽度 7～8）煙霧，7～8 的煙霧跟著 Boss（`bt.fzone`）；刁鑽度 5 起第二型態作戰區域縮到 75%（`world.zoneGoal`，客機收到 `tzone` 直接套用）。`tierFieldTick` 在 `bossTierTick` 裡（重建、移動的區域、`tickZone`）。
- 測試：`testBossTier2`。

### 第 3 期的實作

- **`BOSS_KIT` 已填**：artillery、worm、JUGGERNAUT、railgun、heli、rampart、train、furnace（`src/data/boss-kit.js` 的 `K1`）。每隻有 `tip`（開打 5 秒後的說明）、`parts`、`open2`／`open1`、`big`（第一、二型態的大招，取代 `mech-boss-tier.js` 的暫代 `BIG`）、`reflect`、`field[2]`／`field[3]`（函式 `(g, b, T)`）、`counter`（四種）、需要時 `canCharge`（鑽地蟲只在鑽出來時、列車不在隧道時）。
- **部位的機能**（`parts[]`）：`stops`（停用大招）、`flag`（各 Boss 的 AI 用 `b.tierFlag(flag)` 看）、`slots`（停用武器：`fire()` 看 `w.tierOff`）、`speedK`、`hoverK`；`tierPartLost(sp, on)` 統一處理，重建時（`tierSpawnPart(..., true)`）才恢復。部位數的計算改成「原本就有的部位一種算一個」（四座砲台＝1、四節車廂＝1）。
- **接到各 Boss 的 AI 的機能**：BASTILLE 的 `lead`（砲台與 `b3Rain` 不預判）／`mines`（不補布雷無人機）；SANDWORM 的 `track`（鑽出點不追）／`bite`（沒有地下衝刺）、鑽出撲空＝停留 +2 秒＋破綻；JUGGERNAUT 衝撞撞空＝破綻；HALBERD 的 `aim`／`cap`／`vent`；BEHEMOTH 的 `blade`／`side`／`exhaust`、衝撞落空＝破綻；CITADEL 的 `valve`；CINDER 的 `slag`／`flame`／`hinge`。`b.tierRush()`＝一般大型 Boss 的突進或推土要塞的衝撞（大招與應對用）。
- **打回去**：`tierReflects(kind)`（`reflect` 沒寫時：飛彈、榴彈、砲彈；迫擊砲彈 `'mortar'` 要寫明）；`mortarShot` 也會帶 `tierShotOpt`。CINDER 的 `reflectPool`：打掉的熔渣落在它腳下變成燃燒地面。
- **打斷量表**：本體被自己的裝甲（`bossDefense` 的 k，例如 BASTILLE 砲台在時 ×0.12）擋掉的部分也算（`tkArmor`），否則有部位擋住本體的 Boss 打不斷。
- 場地的小工具：`g.tierWalls(b, n, o)`、`g.tierPools(b, n, 'player'|'boss'|'line', R)`、`g.tierSmoke(b, R, follow)`、`g.tierShrinkZone(k, at)`。
- 測試：`testBossKit12`（`testBossKit(browser, base, [[等級, 標籤], …], 名稱)`：部位與機能、三個大招都打斷、打回去、場地、四種反制、截圖 `test-results/boss-<種類>-kit.png`）；`testBossTier2` 以 `g.bossKit = () => null` 只測共用的框架。

### 第 4 期的實作

- `BOSS_KIT` 加上 STRIDER、phantom、ibis、spider、trinity、hunter、orbital（`K2`）。新的欄位：部位的 `weak`（負責的大招放出時減半：`bt.lostW` → `halfT`）、`kit.onLost(g, b, sp)`（STRIDER 兩隻前腳都壞了跪下 6 秒＋破綻）。
- 接到 AI 的機能：ARACHNE 倒下與跳躍落地＝破綻、背部砲塔 `mines`（`b3Mines` 都看這個旗標）；NULLIFIER 的 `coil`（EMP 範圍 20 → 12）／`anchor`（沒有牽引）、EMP 放完＝破綻；JUDGEMENT 的 `antenna`（光柱追得慢）／`relay`（沒有格子砲擊）；MIRAGE 的 `cloak`（迷彩時間 ×0.55）／`holo`（分身最多 1 台）、現形開火結束＝破綻；PULSAR 的 `wingL`／`wingR`（各少一種招式）／`ring`（能量環變慢），能量環被 QB 的無敵時間穿過＝反擊點（`bosses2.js` 的能量環判定）；CERBERUS 分離的瞬間＝破綻，`alpha`／`beta`／`gamma` 讓分離後那一台變弱（武器 `tierOff`、`repairOff`）。
- `canCharge`：ARACHNE 要在地上、CERBERUS 分離中（本體藏起來）不蓄力。
- 測試：`testBossKit34`。另外修正 testBosses 的 NULLIFIER 牽引檢查（玩家放在距離下限上，時有時無）。
